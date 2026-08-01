-- +goose Up
-- Wave H5b (Codex round-4 finding 2): the observatory rollup gains the SWEEP
-- STAMP. FORWARD migration only; nothing in 00001-00017 is edited (00003
-- incident law).
--
-- WHAT WAS MISSING. Migration 00016 copied the engine's watermark VECTOR
-- (chain_id, last_block, acked_epoch, max_epoch_at_compute) from
-- risk_batch_watermarks into each point — but NOT the sweep stamp that sits
-- beside it in the same row (sweep_rows … sweep_generation_open,
-- sweep_applicable; migration 00013). Debt Manager collateral is produced by
-- the ~1h snapshot sweep, so a point's liquidatable count aggregates a
-- SWEEP-CUT the point never named: an honest consumer reads the count as
-- belonging to the bucket's block/time clocks while its collateral side is
-- worst-case ~1.5h behind them. The stamp joins the copy for the same reason
-- the cursor pair did — a serving surface must be able to say which sweep
-- state the number was computed under.
--
-- COPIED, NEVER JOINED AT READ TIME, exactly as 00016's header rules: the
-- batch row is prunable and a serve-time join is the TOCTOU class
-- risk_price_inputs exists to prevent. From this migration on the rollup
-- writer copies the stamp forward with every point.
--
-- THREE STATES, AND THE THIRD IS HONEST ABSENCE. On risk_batch_watermarks,
-- sweep_applicable is NOT NULL: true = a full stamp, false = "this engine has
-- no sweeper" (Aave). Here it is NULLABLE, deliberately, because this table
-- has rows the store can no longer speak for: points written before this
-- migration whose observed batch retention has already pruned. The backfill
-- below fills every pre-existing point whose batch is STILL RETAINED by
-- joining the stamp it observed; a point whose batch is gone keeps
-- sweep_applicable NULL — the record genuinely does not exist, and absence is
-- disclosed as absence. Backfilling those rows with false would FABRICATE the
-- claim "this engine has no sweeper" for an engine that may very well have
-- one; fabricating an empty stamp would be worse. NULL means UNRECORDED, and
-- nothing else.
ALTER TABLE observatory_points
    ADD COLUMN sweep_applicable      BOOLEAN,
    ADD COLUMN sweep_rows            BIGINT,
    ADD COLUMN sweep_failed          BIGINT,
    ADD COLUMN sweep_success_sum     NUMERIC,
    ADD COLUMN sweep_max_updated_at  TIMESTAMPTZ,
    ADD COLUMN sweep_generation      BIGINT,
    ADD COLUMN sweep_generation_open BOOLEAN;

-- BACKFILL from still-retained batches: the stamp the point's batch actually
-- carried, verbatim. The join key is (batch_id, engine) — the same identity
-- the 00016 writer copies under. Points whose batch is pruned match no row
-- and stay NULL (unrecorded), which is the honest state — see above.
UPDATE observatory_points p
   SET sweep_applicable      = w.sweep_applicable,
       sweep_rows            = w.sweep_rows,
       sweep_failed          = w.sweep_failed,
       sweep_success_sum     = w.sweep_success_sum,
       sweep_max_updated_at  = w.sweep_max_updated_at,
       sweep_generation      = w.sweep_generation,
       sweep_generation_open = w.sweep_generation_open
  FROM risk_batch_watermarks w
 WHERE w.batch_id = p.batch_id AND w.engine = p.engine;

-- ALL-OR-NOTHING per state, the same discipline as 00013's watermark CHECK:
-- a partial sweep payload is not a degraded disclosure, it is an
-- uninterpretable one. The three legal states:
--   * UNRECORDED (pre-00018 point, batch pruned before backfill):
--     everything NULL;
--   * NO SWEEPER (sweep_applicable false): every stamp column NULL;
--   * STAMPED (sweep_applicable true): every stamp column present, except
--     sweep_max_updated_at — a swept engine with zero attempted accounts
--     legitimately has no most-recent write (00013's same carve-out).
ALTER TABLE observatory_points
    ADD CONSTRAINT observatory_points_sweep_all_or_nothing CHECK (
        (sweep_applicable IS NULL AND sweep_rows IS NULL
                                  AND sweep_failed IS NULL
                                  AND sweep_success_sum IS NULL
                                  AND sweep_max_updated_at IS NULL
                                  AND sweep_generation IS NULL
                                  AND sweep_generation_open IS NULL)
        OR
        (sweep_applicable AND sweep_rows IS NOT NULL
                          AND sweep_failed IS NOT NULL
                          AND sweep_success_sum IS NOT NULL
                          AND sweep_generation IS NOT NULL
                          AND sweep_generation_open IS NOT NULL)
        OR
        (NOT sweep_applicable AND sweep_rows IS NULL
                              AND sweep_failed IS NULL
                              AND sweep_success_sum IS NULL
                              AND sweep_max_updated_at IS NULL
                              AND sweep_generation IS NULL
                              AND sweep_generation_open IS NULL)
    );

-- +goose Down
ALTER TABLE observatory_points
    DROP CONSTRAINT observatory_points_sweep_all_or_nothing;
ALTER TABLE observatory_points
    DROP COLUMN sweep_applicable,
    DROP COLUMN sweep_rows,
    DROP COLUMN sweep_failed,
    DROP COLUMN sweep_success_sum,
    DROP COLUMN sweep_max_updated_at,
    DROP COLUMN sweep_generation,
    DROP COLUMN sweep_generation_open;
