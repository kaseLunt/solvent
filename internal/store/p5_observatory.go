package store

// P5 Task B2: the OBSERVATORY ROLLUP writer — the store surface over
// migration 00016's observatory_points table (extended by 00018, which adds
// the per-engine SWEEP STAMP to the copied watermark vector; wave H5b).
//
// A point is an OBSERVATION of the newest COMPLETE risk batch at write time
// (the migration documents the full posture: points outlive their batches,
// rewinds never retro-edit past buckets, engines are never blended). The
// writer here is deliberately ONE statement over the same completeness
// predicate NewestCompleteBatch serves by (riskBatchCompleteConjuncts), so
// the rollup can never observe a torn batch the API would refuse to serve.
//
// THE SOURCE IS THE BATCH, NEVER RAW DERIVED STATE. Every value a point
// carries is COPIED from risk_batches / risk_batch_aggregates /
// risk_batch_watermarks — nothing is recomputed from position_balances or
// prices at tick time. Recomputing would bypass the batch pipeline's gates,
// refusal rows, price snapshot and watermark stamps, and could disagree with
// the public Book over the numbers this series claims to be the history of
// (the m4 mutant). No complete batch, no point — absence over a stand-in.
//
// IDEMPOTENT PER (BUCKET, ENGINE), AND SELF-LIMITING: the conflict arm
// replaces the open bucket's row ONLY when the observed batch id changed.
// A daemon tick re-observing the same batch inside the same hour writes
// nothing at all — zero churn — and a double tick can never double a bucket
// (the m3 mutant this file's tests exist to kill).

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// ObservatoryWriteResult reports one rollup tick. Engines lists the engines
// whose point was actually written or refreshed THIS call (empty when the
// bucket already holds this batch's observation); BatchID is the newest
// complete batch the tick observed; Bucket is the hour written into (zero
// when nothing was written).
type ObservatoryWriteResult struct {
	BatchID int64
	Bucket  time.Time
	Engines []string
}

// WriteObservatoryPoints observes the newest complete risk batch into the
// current hour's bucket, one row per aggregate engine. found is false — and
// nothing is written — when no complete batch exists: a fabricated zero
// point would read as "no risk", the false-safety direction.
func (s *Store) WriteObservatoryPoints(ctx context.Context) (ObservatoryWriteResult, bool, error) {
	var res ObservatoryWriteResult
	err := s.pool.QueryRow(ctx, `
		SELECT b.id FROM risk_batches b
		WHERE `+riskBatchCompleteConjuncts+`
		ORDER BY b.id DESC LIMIT 1`).Scan(&res.BatchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObservatoryWriteResult{}, false, nil
	}
	if err != nil {
		return ObservatoryWriteResult{}, false, fmt.Errorf("observatory rollup: find newest complete batch: %w", err)
	}

	// One statement, so the batch selection and the write share a snapshot.
	// The rates snapshot is the newest rate_indexes observation per
	// (asset, kind) for the row's engine — decimal STRINGS with their own
	// as-of blocks (the house no-floats law), '{}' when the engine has none.
	//
	// The conflict arm's WHERE clause is the idempotency law: only a CHANGED
	// batch id may touch the open bucket, and it REPLACES the observation
	// (accumulating instead is the m3 mutant). Past buckets are structurally
	// unreachable — the target key is always the CURRENT hour.
	rows, err := s.pool.Query(ctx, `
		WITH newest AS (
		    SELECT b.id, b.computed_at, b.materialization_key FROM risk_batches b
		    WHERE `+riskBatchCompleteConjuncts+`
		    ORDER BY b.id DESC LIMIT 1
		)
		INSERT INTO observatory_points
		    (bucket_start, engine, observed_at, batch_id, batch_computed_at, materialization_key,
		     chain_id, last_block, acked_epoch, max_epoch_at_compute,
		     sweep_applicable, sweep_rows, sweep_failed, sweep_success_sum,
		     sweep_max_updated_at, sweep_generation, sweep_generation_open,
		     value_decimals, positions, computed_positions, refused_positions,
		     flagged_positions, liquidatable_positions, total_collateral, total_debt,
		     refusal_code, refusal_detail, rates)
		SELECT date_trunc('hour', now()), a.engine, now(), n.id, n.computed_at, n.materialization_key,
		       w.chain_id, w.last_block, w.acked_epoch, w.max_epoch_at_compute,
		       -- The SWEEP STAMP travels with the vector (migration 00018): the
		       -- liquidatable count below aggregates a sweep-cut, and a point that
		       -- copied the cursor pair but dropped the sweep state would serve
		       -- that count with no clock naming the cut. Copied VERBATIM from the
		       -- batch's own stamp — never re-read from live sweep tables, for the
		       -- same reason the totals are never recomputed (the m5 mutant).
		       w.sweep_applicable, w.sweep_rows, w.sweep_failed, w.sweep_success_sum,
		       w.sweep_max_updated_at, w.sweep_generation, w.sweep_generation_open,
		       a.value_decimals, a.positions, a.computed_positions, a.refused_positions,
		       a.flagged_positions, a.liquidatable_positions, a.total_collateral, a.total_debt,
		       a.refusal_code, a.refusal_detail,
		       COALESCE((SELECT jsonb_object_agg(x.asset_hex, x.per_asset)
		                 FROM (SELECT encode(ri.asset, 'hex') AS asset_hex,
		                              jsonb_object_agg(ri.kind, jsonb_build_object(
		                                  'value', ri.value::text, 'block', ri.block_number)) AS per_asset
		                       FROM (SELECT DISTINCT ON (asset, kind) asset, kind, value, block_number
		                             FROM rate_indexes
		                             WHERE engine = a.engine
		                             ORDER BY asset, kind, block_number DESC) ri
		                       GROUP BY ri.asset) x), '{}'::jsonb)
		FROM newest n
		JOIN risk_batch_aggregates a ON a.batch_id = n.id
		JOIN risk_batch_watermarks w ON w.batch_id = n.id AND w.engine = a.engine
		ON CONFLICT (bucket_start, engine) DO UPDATE SET
		    observed_at            = EXCLUDED.observed_at,
		    batch_id               = EXCLUDED.batch_id,
		    batch_computed_at      = EXCLUDED.batch_computed_at,
		    materialization_key    = EXCLUDED.materialization_key,
		    chain_id               = EXCLUDED.chain_id,
		    last_block             = EXCLUDED.last_block,
		    acked_epoch            = EXCLUDED.acked_epoch,
		    max_epoch_at_compute   = EXCLUDED.max_epoch_at_compute,
		    sweep_applicable       = EXCLUDED.sweep_applicable,
		    sweep_rows             = EXCLUDED.sweep_rows,
		    sweep_failed           = EXCLUDED.sweep_failed,
		    sweep_success_sum      = EXCLUDED.sweep_success_sum,
		    sweep_max_updated_at   = EXCLUDED.sweep_max_updated_at,
		    sweep_generation       = EXCLUDED.sweep_generation,
		    sweep_generation_open  = EXCLUDED.sweep_generation_open,
		    value_decimals         = EXCLUDED.value_decimals,
		    positions              = EXCLUDED.positions,
		    computed_positions     = EXCLUDED.computed_positions,
		    refused_positions      = EXCLUDED.refused_positions,
		    flagged_positions      = EXCLUDED.flagged_positions,
		    liquidatable_positions = EXCLUDED.liquidatable_positions,
		    total_collateral       = EXCLUDED.total_collateral,
		    total_debt             = EXCLUDED.total_debt,
		    refusal_code           = EXCLUDED.refusal_code,
		    refusal_detail         = EXCLUDED.refusal_detail,
		    rates                  = EXCLUDED.rates
		WHERE observatory_points.batch_id IS DISTINCT FROM EXCLUDED.batch_id
		RETURNING engine, bucket_start`)
	if err != nil {
		return ObservatoryWriteResult{}, false, fmt.Errorf("observatory rollup: write points: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var engine string
		var bucket time.Time
		if err := rows.Scan(&engine, &bucket); err != nil {
			return ObservatoryWriteResult{}, false, fmt.Errorf("observatory rollup: scan written point: %w", err)
		}
		res.Engines = append(res.Engines, engine)
		res.Bucket = bucket
	}
	if err := rows.Err(); err != nil {
		return ObservatoryWriteResult{}, false, fmt.Errorf("observatory rollup: iterate written points: %w", err)
	}
	sort.Strings(res.Engines)
	return res, true, nil
}
