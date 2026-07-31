package store

// P5 Task B1: the batch-stable position table read (GET /v1/positions).
//
// BATCH-STABLE means the page is pinned to ONE risk batch for its entire
// pagination: the cursor carries (batch, engine, sort, rank), every page
// re-ranks the SAME immutable batch (a committed batch's rows never change),
// and a newer batch arriving mid-pagination NEVER leaks rows into the walk.
// The caller detects supersession with BatchStillNewestServable and restarts
// honestly (409 BATCH_SUPERSEDED at the API) — a mixed-batch page is the lie
// this design exists to prevent.
//
// RANK, NOT KEYSET: the cursor encodes the ROW_NUMBER rank within the pinned
// (batch, engine, sort) ordering, per the plan's contract ("cursor encodes
// (batch_id, rank)"). That is sound ONLY because the ranked set is immutable;
// position_events-style keysets are used everywhere the underlying set grows.

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// PositionSort is the closed sort vocabulary of /v1/positions.
type PositionSort string

const (
	PositionSortLiqDistance PositionSort = "liq_distance"
	PositionSortDebt        PositionSort = "debt"
	PositionSortHF          PositionSort = "hf"
	PositionSortStatus      PositionSort = "status"
)

var (
	// ErrPositionsBatchMissing: the pinned batch no longer exists (retention
	// pruned it mid-pagination). An empty page here would read as "book is
	// empty", the false-safety direction — so it is a typed refusal instead.
	ErrPositionsBatchMissing = errors.New("positions page: the pinned batch no longer exists (superseded and pruned) — restart pagination from the newest servable batch")
	// ErrPositionsCursorMismatch: the cursor was minted for a different
	// (batch, engine, sort) than the request — replaying it would silently
	// re-rank into garbage, so it is refused.
	ErrPositionsCursorMismatch = errors.New("positions page: cursor does not match the requested batch/engine/sort")
	// ErrPositionsSortUnsupported: the sort key does not exist on this
	// engine's comparator (there is no Debt Manager health factor; inventing
	// an ordering for it would blend the engines' semantics).
	ErrPositionsSortUnsupported = errors.New("positions page: sort key is not defined for this engine")
)

// positionsOrder maps (engine, sort) to the deterministic ORDER BY fragment.
// The fragments are SERVER-OWNED CONSTANTS keyed by validated enums — no
// caller string ever reaches the SQL text — and every fragment ends in
// `p.account ASC`, the total tiebreak (account is unique per (batch,engine)),
// so equal sort keys still order deterministically across pages.
//
// Refused rows: a value sort cannot rank an unknown value, so refused rows
// order AFTER computed rows (visible, never dropped — they are still rows on
// late pages, and the `status` sort surfaces them FIRST for triage).
var positionsOrder = map[string]map[PositionSort]string{
	EngineAave: {
		// Closest to liquidation first: the wad composite ascending; zero-debt
		// (hf_infinite) rows are farthest by definition, refused rows last.
		PositionSortLiqDistance: `(p.status = 'refused') ASC, p.hf_infinite ASC, p.hf_wad ASC NULLS LAST, p.account ASC`,
		PositionSortHF:          `(p.status = 'refused') ASC, p.hf_infinite ASC, p.hf_wad ASC NULLS LAST, p.account ASC`,
		PositionSortDebt:        `(p.status = 'refused') ASC, p.total_debt_base DESC NULLS LAST, p.account ASC`,
		PositionSortStatus:      `(p.status = 'refused') DESC, p.hf_infinite ASC, p.hf_wad ASC NULLS LAST, p.account ASC`,
	},
	EngineDebtManager: {
		// The DM comparator is a strict boolean over borrowings vs
		// max_borrow_lt; "distance" is the exact USD headroom
		// (max_borrow_lt - borrowings) ascending — liquidatable rows have
		// negative headroom and therefore lead. No wad, no normalization.
		PositionSortLiqDistance: `(p.status = 'refused') ASC, (p.max_borrow_lt - p.borrowings) ASC NULLS LAST, p.account ASC`,
		PositionSortDebt:        `(p.status = 'refused') ASC, p.borrowings DESC NULLS LAST, p.account ASC`,
		PositionSortStatus:      `(p.status = 'refused') DESC, p.liquidatable DESC NULLS LAST, (p.max_borrow_lt - p.borrowings) ASC NULLS LAST, p.account ASC`,
		// PositionSortHF deliberately absent: ErrPositionsSortUnsupported.
	},
}

type PositionsPageResult struct {
	BatchID   int64
	Positions []RiskBatchPosition
	// NextCursor is "" when the ranked set is exhausted.
	NextCursor string
}

const positionsCursorTag = "p5pos1"

// PositionsCursorBatch extracts the batch id a positions cursor pins,
// WITHOUT running the page query — the API resolves the pinned batch from
// the cursor first, then judges supersession (BatchStillNewestServable)
// before paging.
func PositionsCursorBatch(cursor string) (int64, error) {
	fields, err := p5DecodeCursor(cursor, positionsCursorTag, 4)
	if err != nil {
		return 0, fmt.Errorf("positions cursor: %w", err)
	}
	batch, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil || batch <= 0 {
		return 0, fmt.Errorf("positions cursor batch %q is not a positive integer", fields[0])
	}
	return batch, nil
}

// PositionsPage serves one page of the pinned batch's book for one engine.
func (s *Store) PositionsPage(ctx context.Context, batchID int64, engine string, sort PositionSort, cursor string, limit int) (PositionsPageResult, error) {
	if limit <= 0 {
		return PositionsPageResult{}, fmt.Errorf("positions page: limit must be positive, got %d", limit)
	}
	engineOrders, ok := positionsOrder[engine]
	if !ok {
		return PositionsPageResult{}, fmt.Errorf("positions page: unknown engine %q", engine)
	}
	orderBy, ok := engineOrders[sort]
	if !ok {
		if _, known := positionsOrder[EngineAave][sort]; !known {
			return PositionsPageResult{}, fmt.Errorf("positions page: unknown sort %q", sort)
		}
		return PositionsPageResult{}, fmt.Errorf("%w: %q on %q", ErrPositionsSortUnsupported, sort, engine)
	}

	afterRank := int64(0)
	if cursor != "" {
		fields, err := p5DecodeCursor(cursor, positionsCursorTag, 4)
		if err != nil {
			return PositionsPageResult{}, fmt.Errorf("positions page: %w", err)
		}
		cursorBatch, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			return PositionsPageResult{}, fmt.Errorf("positions page: cursor batch %q is not an integer", fields[0])
		}
		if cursorBatch != batchID || fields[1] != engine || fields[2] != string(sort) {
			return PositionsPageResult{}, fmt.Errorf("%w: cursor pins (batch %d, engine %q, sort %q), request asks (batch %d, engine %q, sort %q)",
				ErrPositionsCursorMismatch, cursorBatch, fields[1], fields[2], batchID, engine, sort)
		}
		if afterRank, err = strconv.ParseInt(fields[3], 10, 64); err != nil || afterRank < 0 {
			return PositionsPageResult{}, fmt.Errorf("positions page: cursor rank %q is not a non-negative integer", fields[3])
		}
	}

	// The pinned batch must still EXIST: retention can prune a superseded
	// batch mid-pagination, and the resulting empty page would read as an
	// empty book. Existence is checked per page; full servability is the
	// caller's BatchStillNewestServable call.
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM risk_batches WHERE id = $1)`, batchID).Scan(&exists); err != nil {
		return PositionsPageResult{}, fmt.Errorf("positions page: check batch %d: %w", batchID, err)
	}
	if !exists {
		return PositionsPageResult{}, fmt.Errorf("%w (batch %d)", ErrPositionsBatchMissing, batchID)
	}

	// orderBy comes from the fixed map above — never caller input — so the
	// Sprintf is a lookup of server-owned SQL, not string interpolation of
	// user data.
	q := fmt.Sprintf(`
		WITH ranked AS (
			SELECT p.engine, p.account, p.status, p.refusal_code, p.refusal_detail, p.flags,
			       p.value_decimals, p.hf_num::text, p.hf_den::text, p.hf_wad::text, p.hf_infinite,
			       p.total_collateral_base::text, p.total_debt_base::text,
			       p.collateral_value_usd::text, p.max_borrow_lt::text, p.borrowings::text, p.liquidatable,
			       p.balances_block, p.params_block, p.sweep_block, p.oldest_price_input, p.stale_price_inputs,
			       ROW_NUMBER() OVER (ORDER BY %s) AS rn
			FROM risk_positions p
			WHERE p.batch_id = $1 AND p.engine = $2
		)
		SELECT * FROM ranked WHERE rn > $3 ORDER BY rn LIMIT $4`, orderBy)

	rows, err := s.pool.Query(ctx, q, batchID, engine, afterRank, limit+1)
	if err != nil {
		return PositionsPageResult{}, fmt.Errorf("positions page: %w", err)
	}
	defer rows.Close()

	var out []RiskBatchPosition
	for rows.Next() {
		// Same column set and decode discipline as RiskBatchPositions
		// (risk.go) — that method is the source of truth for the scan shape;
		// re-scanned here because this query adds the window rank and this
		// wave does not modify existing store files.
		var p RiskBatchPosition
		var hfNum, hfDen, hfWad, tc, td, cv, mb, bw *string
		var rn int64
		if err := rows.Scan(&p.Engine, &p.Account, &p.Status, &p.RefusalCode, &p.RefusalDetail, &p.Flags,
			&p.ValueDecimals, &hfNum, &hfDen, &hfWad, &p.HFInfinite,
			&tc, &td, &cv, &mb, &bw, &p.Liquidatable,
			&p.BalancesBlock, &p.ParamsBlock, &p.SweepBlock, &p.OldestPriceInput, &p.StalePriceInputs,
			&rn); err != nil {
			return PositionsPageResult{}, fmt.Errorf("scan positions page row: %w", err)
		}
		if p.HFNum, err = p5BigFromText("hf_num", hfNum); err != nil {
			return PositionsPageResult{}, err
		}
		if p.HFDen, err = p5BigFromText("hf_den", hfDen); err != nil {
			return PositionsPageResult{}, err
		}
		if p.HFWad, err = p5BigFromText("hf_wad", hfWad); err != nil {
			return PositionsPageResult{}, err
		}
		if p.TotalCollateralBase, err = p5BigFromText("total_collateral_base", tc); err != nil {
			return PositionsPageResult{}, err
		}
		if p.TotalDebtBase, err = p5BigFromText("total_debt_base", td); err != nil {
			return PositionsPageResult{}, err
		}
		if p.CollateralValueUSD, err = p5BigFromText("collateral_value_usd", cv); err != nil {
			return PositionsPageResult{}, err
		}
		if p.MaxBorrowLT, err = p5BigFromText("max_borrow_lt", mb); err != nil {
			return PositionsPageResult{}, err
		}
		if p.Borrowings, err = p5BigFromText("borrowings", bw); err != nil {
			return PositionsPageResult{}, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return PositionsPageResult{}, fmt.Errorf("iterate positions page: %w", err)
	}

	next := ""
	if len(out) > limit {
		out = out[:limit]
		next = p5EncodeCursor(positionsCursorTag,
			strconv.FormatInt(batchID, 10), engine, string(sort),
			strconv.FormatInt(afterRank+int64(limit), 10))
	}
	return PositionsPageResult{BatchID: batchID, Positions: out, NextCursor: next}, nil
}

// BatchStillNewestServable reports whether batchID is STILL the newest
// complete servable batch — the supersession probe a paginating caller runs
// per page. false with a nil error means either a newer servable batch
// exists or none does; both are "do not keep serving this pagination as
// current".
func (s *Store) BatchStillNewestServable(ctx context.Context, batchID int64) (bool, error) {
	var newest int64
	err := s.pool.QueryRow(ctx, `
		SELECT b.id FROM risk_batches b
		WHERE `+riskBatchCompleteConjuncts+`
		ORDER BY b.id DESC LIMIT 1`).Scan(&newest)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("newest servable batch probe: %w", err)
	}
	return newest == batchID, nil
}
