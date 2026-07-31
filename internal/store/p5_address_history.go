package store

// P5 Task B1: per-address HF/collateral/debt history across retained batches
// (GET /v1/address/{addr}/history) — the read risk_positions_account_idx
// (account, batch_id) was built for and nothing consumed until now.
//
// ONLY COMPLETE BATCHES APPEAR. A torn or partially-restored batch is
// unservable everywhere else (riskBatchCompleteConjuncts), and a history
// point from one would present a health factor with no input evidence behind
// it — so the same conjuncts gate every point here.
//
// STATUS AND REFUSAL TRAVEL WITH EVERY POINT. An account refused in batch N
// and computed in batch N+1 is a story the sparkline must tell as a refusal
// marker, never as a gap (a missing point reads as "no risk here", the
// false-safety direction).

import (
	"context"
	"fmt"
	"time"
)

// AddressHistoryPoint is one batch's verdict on one account, on one engine.
// An account with rows on both engines yields two points per batch — the
// engines are never blended into one point.
type AddressHistoryPoint struct {
	BatchID int64
	// ComputedAt is the batch's database-clock stamp (risk_batches.computed_at).
	ComputedAt time.Time
	Position   RiskBatchPosition
}

// AddressHistory reads the account's per-batch points, newest batch first
// (engine ASC within a batch). limit bounds the number of BATCHES consulted,
// not rows — an account on both engines returns up to 2*limit points.
func (s *Store) AddressHistory(ctx context.Context, account []byte, limit int) ([]AddressHistoryPoint, error) {
	if len(account) == 0 {
		return nil, fmt.Errorf("address history: account is required")
	}
	if limit <= 0 {
		return nil, fmt.Errorf("address history: limit must be positive, got %d", limit)
	}

	// Inner query: the newest `limit` COMPLETE batches carrying this account,
	// via risk_positions_account_idx. The conjuncts alias risk_batches as b.
	q := `
		SELECT p.batch_id, b2.computed_at,
		       p.engine, p.account, p.status, p.refusal_code, p.refusal_detail, p.flags,
		       p.value_decimals, p.hf_num::text, p.hf_den::text, p.hf_wad::text, p.hf_infinite,
		       p.total_collateral_base::text, p.total_debt_base::text,
		       p.collateral_value_usd::text, p.max_borrow_lt::text, p.borrowings::text, p.liquidatable,
		       p.balances_block, p.params_block, p.sweep_block, p.oldest_price_input, p.stale_price_inputs
		FROM risk_positions p
		JOIN risk_batches b2 ON b2.id = p.batch_id
		WHERE p.account = $1
		  AND p.batch_id IN (
		      SELECT DISTINCT p2.batch_id
		      FROM risk_positions p2
		      JOIN risk_batches b ON b.id = p2.batch_id
		      WHERE p2.account = $1
		        AND ` + riskBatchCompleteConjuncts + `
		      ORDER BY p2.batch_id DESC
		      LIMIT $2)
		ORDER BY p.batch_id DESC, p.engine ASC`

	rows, err := s.pool.Query(ctx, q, account, limit)
	if err != nil {
		return nil, fmt.Errorf("address history: %w", err)
	}
	defer rows.Close()

	var out []AddressHistoryPoint
	for rows.Next() {
		var pt AddressHistoryPoint
		p := &pt.Position
		var hfNum, hfDen, hfWad, tc, td, cv, mb, bw *string
		if err := rows.Scan(&pt.BatchID, &pt.ComputedAt,
			&p.Engine, &p.Account, &p.Status, &p.RefusalCode, &p.RefusalDetail, &p.Flags,
			&p.ValueDecimals, &hfNum, &hfDen, &hfWad, &p.HFInfinite,
			&tc, &td, &cv, &mb, &bw, &p.Liquidatable,
			&p.BalancesBlock, &p.ParamsBlock, &p.SweepBlock, &p.OldestPriceInput, &p.StalePriceInputs); err != nil {
			return nil, fmt.Errorf("scan address history point: %w", err)
		}
		pt.ComputedAt = pt.ComputedAt.UTC()
		if p.HFNum, err = p5BigFromText("hf_num", hfNum); err != nil {
			return nil, err
		}
		if p.HFDen, err = p5BigFromText("hf_den", hfDen); err != nil {
			return nil, err
		}
		if p.HFWad, err = p5BigFromText("hf_wad", hfWad); err != nil {
			return nil, err
		}
		if p.TotalCollateralBase, err = p5BigFromText("total_collateral_base", tc); err != nil {
			return nil, err
		}
		if p.TotalDebtBase, err = p5BigFromText("total_debt_base", td); err != nil {
			return nil, err
		}
		if p.CollateralValueUSD, err = p5BigFromText("collateral_value_usd", cv); err != nil {
			return nil, err
		}
		if p.MaxBorrowLT, err = p5BigFromText("max_borrow_lt", mb); err != nil {
			return nil, err
		}
		if p.Borrowings, err = p5BigFromText("borrowings", bw); err != nil {
			return nil, err
		}
		out = append(out, pt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate address history: %w", err)
	}
	return out, nil
}
