-- +goose Up
-- Durable sweep state for the collateral snapshotter: per-account sweep
-- status (snapshot_sweeps) plus per-engine sweep generations
-- (sweep_generations) — together the snapshotter's DURABLE work queue.
--
-- DEV-ONLY EDIT-IN-PLACE (goose cycle): this migration has never shipped
-- beyond local dev databases, so the sweep-durability wave extended it IN
-- PLACE (generation/attempts columns + the sweep_generations table) instead
-- of adding a 00004. goose tracks applied versions by number only, so a local
-- database that already applied the old shape must be cycled once:
--
--   docker compose exec db psql -U solvent -d solvent -c \
--     "DROP TABLE IF EXISTS snapshot_sweeps, sweep_generations;
--      DELETE FROM goose_db_version WHERE version_id = 3;"
--
-- after which any store.Migrate call (test run or indexer start) re-applies
-- this file. Schema-isolated test suites (DROP SCHEMA ... CASCADE per run)
-- need nothing.
--
-- SWEEP MODEL: opening a sweep = incrementing sweep_generations.
-- current_generation (one durable statement; done by the snapshotter's
-- cadence/startup path and — post-reorg — inside RewindDerived's own
-- transaction, atomic with the epoch ack). Per-account durable progress is
-- the snapshot_sweeps row's generation stamp: an account whose row carries
-- generation < current (or no row at all) LAGS and owes work; the lagging
-- set IS the queue, so a restarted process resumes exactly where the previous
-- one stopped and never re-reads accounts already stamped current. A sweep is
-- COMPLETE when no registry account lags; completion stamps completed_at
-- (the cadence anchor for the next generation).
--
-- snapshot_sweeps: one row per (engine, account) the snapshotter has ever
-- ATTEMPTED, disambiguating the three states that used to collapse into
-- "no rows in position_balances":
--
--   - zero-collateral SUCCESS: status='success' row + empty snapshot
--     balances (the sweep read the account and it genuinely holds nothing);
--   - never swept: NO row (the account has not been attempted);
--   - FAILED: status='failed' row (collateralOf reverted; last_success_block
--     says how stale the surviving snapshot rows are).
--
-- generation is the sweep generation of the LAST attempt; attempts counts
-- attempts WITHIN that generation (reset to 1 when a new generation first
-- touches the account) — the durable per-generation retry budget. status is
-- 'success' or 'failed', always the outcome of the last attempt.
-- last_attempt_block / last_success_block are the multicall EXECUTION blocks
-- of the most recent attempt / most recent success (0 = never succeeded).
CREATE TABLE snapshot_sweeps (
    engine             TEXT   NOT NULL,
    account            BYTEA  NOT NULL,
    generation         BIGINT NOT NULL DEFAULT 0,
    last_attempt_block BIGINT NOT NULL,
    last_success_block BIGINT NOT NULL DEFAULT 0,
    status             TEXT   NOT NULL,
    attempts           BIGINT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, account)
);

-- sweep_generations: one row per engine. current_generation is the OPEN or
-- most recent sweep generation; completed_at IS NULL while it is open (the
-- restart-resume signal) and carries the completion time otherwise (the
-- cadence anchor).
CREATE TABLE sweep_generations (
    engine             TEXT PRIMARY KEY,
    current_generation BIGINT NOT NULL,
    opened_at          TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ
);

-- +goose Down
DROP TABLE sweep_generations;
DROP TABLE snapshot_sweeps;
