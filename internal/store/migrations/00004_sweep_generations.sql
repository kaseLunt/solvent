-- +goose Up
-- Forward migration for the sweep-durability wave. The wave's schema was
-- briefly landed as an IN-PLACE edit of 00003 — an unsafe upgrade: a database
-- at the pushed 00003 baseline recorded version 3 WITHOUT these shapes, and
-- goose tracks applied versions by number only, so the edited content would
-- silently never run (runtime column-missing failures, rolling back even
-- rewinds). 00003 is restored to its as-first-pushed content and everything
-- the wave added lands here as version 4, upgrade-safe from that baseline.

-- 1) snapshot_sweeps grows the durable generation machinery:
--    generation is the sweep generation of the LAST attempt; attempts counts
--    attempts WITHIN that generation (reset to 1 when a new generation first
--    touches the account) — the durable per-generation retry budget.
--    Backfill semantics: generation 0 lags ANY opened generation
--    (OpenSweepGeneration starts at 1, and sweep_generations starts empty
--    below), so every pre-existing sweep row correctly owes work on the first
--    post-upgrade sweep — cold-start semantics, no data loss: block stamps
--    and status survive untouched. attempts 0 grants a fresh retry budget.
ALTER TABLE snapshot_sweeps
    ADD COLUMN generation BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN attempts   BIGINT NOT NULL DEFAULT 0;

-- 2) sweep_generations: one row per engine. current_generation is the OPEN or
--    most recent sweep generation; completed_at IS NULL while it is open (the
--    restart-resume signal) and carries the completion time otherwise (the
--    cadence anchor). Starts empty: the first post-upgrade Step opens
--    generation 1 (no sweep has ever been opened, cadence-due immediately).
CREATE TABLE sweep_generations (
    engine             TEXT PRIMARY KEY,
    current_generation BIGINT NOT NULL,
    opened_at          TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ
);

-- 3) side joins the snapshots history key. The old PK
--    (engine, account, block_number) let the debt writer (the runner's
--    SaveSnapshots at its derive through-block) and the collateral writer
--    (ApplySweepBatch at its multicall execution block) wholesale-overwrite
--    each other whenever both observed the same block — losing one side's
--    history. Documents are single-side by the enforced as-of discipline, so
--    side completes the key: both writers keep their own rows.
--    Backfill: from the document's own side marker where present (both
--    writers have stamped it since the fix wave); anything without one is a
--    legacy debt document ('debt' default).
ALTER TABLE snapshots ADD COLUMN side TEXT NOT NULL DEFAULT 'debt';
UPDATE snapshots SET side = balances->>'side' WHERE balances->>'side' IN ('debt', 'collateral');
ALTER TABLE snapshots DROP CONSTRAINT snapshots_pkey;
ALTER TABLE snapshots ADD PRIMARY KEY (engine, account, block_number, side);

-- +goose Down
-- Collapsing side back into the old PK keeps the debt row wherever both
-- sides exist at one (engine, account, block) — the old key's semantics.
DELETE FROM snapshots s USING snapshots d
    WHERE s.engine = d.engine AND s.account = d.account
      AND s.block_number = d.block_number
      AND s.side = 'collateral' AND d.side = 'debt';
ALTER TABLE snapshots DROP CONSTRAINT snapshots_pkey;
ALTER TABLE snapshots DROP COLUMN side;
ALTER TABLE snapshots ADD PRIMARY KEY (engine, account, block_number);
DROP TABLE sweep_generations;
ALTER TABLE snapshot_sweeps
    DROP COLUMN generation,
    DROP COLUMN attempts;
