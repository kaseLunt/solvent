package store

// P5 Task B2: BLOCK-TIME CUSTODY — the store surface over migration 00015's
// block_headers table.
//
// THE LAW, restated where the writes happen: block_time is CHAIN-ASSERTED
// ONLY. The writer stores exactly the header timestamp its caller fetched and
// hash-validated; nothing in this file consults any clock, and the one
// now()-defaulted column (fetched_at) is fetch provenance that no serving
// surface may substitute for a chain time. Absence is the honest state for an
// unfetched block, and a divergent existing row is REFUSED, never overwritten
// (see the migration's header for the full posture).
//
// WHO WRITES: the indexer's bounded per-round custody pass
// (cmd/indexer/blocktimes.go) and the one-shot cmd/backfill-blocktimes. Both
// validate a fetched header against the SAME durable raw_logs pin before
// calling UpsertBlockHeader, so their concurrent upserts are either
// byte-identical no-ops or refused divergences — the reason this table sits
// safely outside the D-004 advisory writer lock.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// BlockHeaderWrite is one hash-validated header, ready to store. Time is the
// header's OWN timestamp in unix seconds — the caller must have read it from
// the same header whose hash it validated against the stored pin.
type BlockHeaderWrite struct {
	ChainID uint64
	Block   uint64
	Hash    []byte
	Time    int64
}

// BlockHeaderUpsert reports what the write did. Stored covers both the fresh
// insert and the byte-identical re-write (idempotent no-op); when an EXISTING
// row disagrees with the write, Stored is false and the existing row's values
// are returned so the caller can log the divergence it is refusing to paper
// over.
type BlockHeaderUpsert struct {
	Stored       bool
	ExistingHash []byte
	ExistingTime int64
}

// UpsertBlockHeader stores one header, refusing to silently overwrite a
// divergent existing row (refuse-don't-overwrite; the migration documents the
// operator repair path). An identical re-write is an idempotent no-op that
// preserves the original fetched_at.
func (s *Store) UpsertBlockHeader(ctx context.Context, w BlockHeaderWrite) (BlockHeaderUpsert, error) {
	if len(w.Hash) == 0 {
		return BlockHeaderUpsert{}, fmt.Errorf("upsert block header %d/%d: a header write without its hash cannot be pin-validated", w.ChainID, w.Block)
	}
	if w.Time <= 0 {
		return BlockHeaderUpsert{}, fmt.Errorf("upsert block header %d/%d: block_time %d is not a chain-asserted timestamp (zero/negative is an unset value smuggled in as data)", w.ChainID, w.Block, w.Time)
	}
	// The conflict arm "updates" the row to its existing values ONLY when the
	// incoming write is byte-identical — which is how the statement returns a
	// row for the idempotent no-op without ever changing anything (fetched_at
	// is deliberately not in the SET list, so the FIRST custody instant
	// survives replays). A divergent write matches the WHERE clause on
	// nothing, returns no row, and is reported as a refusal.
	var stored bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO block_headers (chain_id, block_number, block_hash, block_time)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chain_id, block_number) DO UPDATE
		    SET block_hash = EXCLUDED.block_hash,
		        block_time = EXCLUDED.block_time
		    WHERE block_headers.block_hash = EXCLUDED.block_hash
		      AND block_headers.block_time = EXCLUDED.block_time
		RETURNING true`,
		w.ChainID, w.Block, w.Hash, w.Time).Scan(&stored)
	if err == nil {
		return BlockHeaderUpsert{Stored: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return BlockHeaderUpsert{}, fmt.Errorf("upsert block header %d/%d: %w", w.ChainID, w.Block, err)
	}
	// Refused: read what stands so the caller can name it in its log.
	out := BlockHeaderUpsert{Stored: false}
	if err := s.pool.QueryRow(ctx,
		`SELECT block_hash, block_time FROM block_headers WHERE chain_id = $1 AND block_number = $2`,
		w.ChainID, w.Block).Scan(&out.ExistingHash, &out.ExistingTime); err != nil {
		return BlockHeaderUpsert{}, fmt.Errorf("read conflicting block header %d/%d: %w", w.ChainID, w.Block, err)
	}
	return out, nil
}

// EventBlockSource names which event ledger a custody scan walks. These are
// the two cohorts the P5 API serves block_time for: the chain-action feed
// reads position_events, and the parameter timeline reads param_history.
// Chainlink feed blocks are DELIBERATELY not a source — price rows carry
// their own chain-asserted source_as_of (migration 00012), so fetching their
// headers would be chain load nothing serves.
type EventBlockSource string

const (
	EventBlocksPositionEvents EventBlockSource = "position_events"
	EventBlocksParamHistory   EventBlockSource = "param_history"
)

// HeaderNeedQuery scopes one custody scan: one engine's ledger on one chain,
// over (FromExclusive, ToInclusive], bottom-up, at most Limit blocks.
type HeaderNeedQuery struct {
	Engine        string
	ChainID       uint64
	Source        EventBlockSource
	FromExclusive uint64
	ToInclusive   uint64
	Limit         int
}

// HeaderNeed is one event-bearing block that lacks a matching header row.
// PinHashes carries every DISTINCT raw-log block hash stored for the block —
// more than one means the pin is AMBIGUOUS (streams landed the block under
// different forks) and custody must refuse until ingest converges.
// ExistingHash/ExistingTime carry a stored header row that no longer matches
// the pin (a deep-reorg re-walk moved the pin after the header was written):
// surfaced so the caller can log the refusal loudly, never silently skipped.
type HeaderNeed struct {
	Block        uint64
	PinHashes    [][]byte
	ExistingHash []byte
	ExistingTime int64
}

// eventBlockSourceSQL returns the FROM/JOIN/WHERE shape for a source. Both
// shapes join the event ledger back to raw_logs by the LOG'S OWN IDENTITY —
// (chain_id, tx_hash, log_index) — which is what makes every selected block
// carry the pin the walker verified when it landed the window. An event with
// NO raw-log pin (the Debt Manager's calldata-sourced genesis seeds) is
// deliberately invisible here: with no pin there is nothing to validate a
// fetched header against, so its header stays honestly absent
// (BlockHeaderCohorts counts it as Unpinned).
func eventBlockSourceSQL(source EventBlockSource) (string, error) {
	switch source {
	case EventBlocksPositionEvents:
		return `
			FROM position_events e
			JOIN raw_logs r ON r.chain_id = e.chain_id AND r.tx_hash = e.tx_hash AND r.log_index = e.log_index
			LEFT JOIN block_headers h ON h.chain_id = e.chain_id AND h.block_number = e.block_number
			WHERE e.engine = $1 AND e.chain_id = $2
			  AND e.block_number > $3 AND e.block_number <= $4
			GROUP BY e.block_number, h.block_hash, h.block_time`, nil
	case EventBlocksParamHistory:
		return `
			FROM param_history e
			JOIN raw_logs r ON r.chain_id = e.chain_id AND r.tx_hash = e.tx_hash AND r.log_index = e.effective_log_index
			LEFT JOIN block_headers h ON h.chain_id = e.chain_id AND h.block_number = e.effective_block
			WHERE e.engine = $1 AND e.chain_id = $2
			  AND e.effective_block > $3 AND e.effective_block <= $4
			GROUP BY e.effective_block, h.block_hash, h.block_time`, nil
	default:
		return "", fmt.Errorf("unknown event block source %q", source)
	}
}

// EventBlocksNeedingHeaders lists the blocks in range whose header custody is
// OWED: no header row at all, an ambiguous pin (surfaced for refusal), or a
// stored row that diverges from the current pin (surfaced for a loud
// refusal-to-overwrite). Blocks whose stored header matches their single pin
// are custody-complete and never returned.
func (s *Store) EventBlocksNeedingHeaders(ctx context.Context, q HeaderNeedQuery) ([]HeaderNeed, error) {
	if q.Limit <= 0 {
		return nil, fmt.Errorf("event blocks needing headers: limit %d cannot express a bounded scan", q.Limit)
	}
	shape, err := eventBlockSourceSQL(q.Source)
	if err != nil {
		return nil, err
	}
	blockCol := "e.block_number"
	if q.Source == EventBlocksParamHistory {
		blockCol = "e.effective_block"
	}
	// HAVING keeps: absent header, ambiguous pin, or header<>pin. The [1]
	// element of a single-distinct-pin aggregate IS the pin (no min(bytea)
	// exists in Postgres); under ambiguity the count clause already selects
	// the row, so the element choice never decides anything.
	rows, err := s.pool.Query(ctx, `
		SELECT `+blockCol+`,
		       array_agg(DISTINCT r.block_hash),
		       h.block_hash, COALESCE(h.block_time, 0)
		`+shape+`
		HAVING h.block_hash IS NULL
		    OR count(DISTINCT r.block_hash) > 1
		    OR h.block_hash <> (array_agg(DISTINCT r.block_hash))[1]
		ORDER BY `+blockCol+`
		LIMIT $5`,
		q.Engine, q.ChainID, q.FromExclusive, q.ToInclusive, q.Limit)
	if err != nil {
		return nil, fmt.Errorf("event blocks needing headers (%s/%s): %w", q.Engine, q.Source, err)
	}
	defer rows.Close()
	var out []HeaderNeed
	for rows.Next() {
		var n HeaderNeed
		if err := rows.Scan(&n.Block, &n.PinHashes, &n.ExistingHash, &n.ExistingTime); err != nil {
			return nil, fmt.Errorf("scan header need: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate header needs: %w", err)
	}
	return out, nil
}

// BlockHeaderCohorts is the honest census one (engine, source) custody cohort:
// every count is stated, including the blocks custody CANNOT cover (Unpinned)
// and the ones it REFUSES to cover (Mismatched, Ambiguous), so a backfill run
// can print what it did and what remains without inventing a success rate.
type BlockHeaderCohorts struct {
	// EventBlocks is every DISTINCT event-bearing block in the ledger.
	EventBlocks int64
	// WithHeader: a header row exists and matches the block's single pin.
	WithHeader int64
	// Missing: pinned, unambiguous, and no header row yet — the fetchable set.
	Missing int64
	// Mismatched: a header row exists but diverges from the current pin
	// (deep-reorg legacy; repair is a manual delete, never an overwrite).
	Mismatched int64
	// Ambiguous: more than one distinct pin hash (fork-split ingest state).
	Ambiguous int64
	// Unpinned: no raw-log pin at all (calldata-sourced events) — headers for
	// these can never be hash-validated and stay honestly absent.
	Unpinned int64
}

// BlockHeaderCohorts computes the census for one engine's ledger on one chain.
func (s *Store) BlockHeaderCohorts(ctx context.Context, engine string, chainID uint64, source EventBlockSource) (BlockHeaderCohorts, error) {
	var eventTable, blockCol, logIdxCol string
	switch source {
	case EventBlocksPositionEvents:
		eventTable, blockCol, logIdxCol = "position_events", "block_number", "log_index"
	case EventBlocksParamHistory:
		eventTable, blockCol, logIdxCol = "param_history", "effective_block", "effective_log_index"
	default:
		return BlockHeaderCohorts{}, fmt.Errorf("unknown event block source %q", source)
	}
	var c BlockHeaderCohorts
	err := s.pool.QueryRow(ctx, `
		WITH blocks AS (
		    SELECT e.`+blockCol+` AS block_number,
		           count(DISTINCT r.block_hash)            AS pins,
		           (array_agg(DISTINCT r.block_hash))[1]   AS pin,
		           h.block_hash                  AS header_hash
		    FROM `+eventTable+` e
		    LEFT JOIN raw_logs r ON r.chain_id = e.chain_id AND r.tx_hash = e.tx_hash AND r.log_index = e.`+logIdxCol+`
		    LEFT JOIN block_headers h ON h.chain_id = e.chain_id AND h.block_number = e.`+blockCol+`
		    WHERE e.engine = $1 AND e.chain_id = $2
		    GROUP BY e.`+blockCol+`, h.block_hash
		)
		SELECT count(*),
		       count(*) FILTER (WHERE pins = 1 AND header_hash = pin),
		       count(*) FILTER (WHERE pins = 1 AND header_hash IS NULL),
		       count(*) FILTER (WHERE pins >= 1 AND header_hash IS NOT NULL AND header_hash <> pin),
		       count(*) FILTER (WHERE pins > 1 AND header_hash IS NULL),
		       count(*) FILTER (WHERE pins = 0)
		FROM blocks`, engine, chainID).
		Scan(&c.EventBlocks, &c.WithHeader, &c.Missing, &c.Mismatched, &c.Ambiguous, &c.Unpinned)
	if err != nil {
		return BlockHeaderCohorts{}, fmt.Errorf("block header cohorts (%s/%s): %w", engine, source, err)
	}
	return c, nil
}

// MaxBlockHeaderBlock returns the highest custodied block for a chain, or
// found=false when the chain has none. The indexer's custody pass uses it at
// startup to resume roughly where custody left off; everything below it that
// is still missing is the backfill tool's cohort by design.
func (s *Store) MaxBlockHeaderBlock(ctx context.Context, chainID uint64) (uint64, bool, error) {
	var max *int64
	if err := s.pool.QueryRow(ctx,
		`SELECT max(block_number) FROM block_headers WHERE chain_id = $1`, chainID).Scan(&max); err != nil {
		return 0, false, fmt.Errorf("max block header block for chain %d: %w", chainID, err)
	}
	if max == nil {
		return 0, false, nil
	}
	return uint64(*max), true, nil
}
