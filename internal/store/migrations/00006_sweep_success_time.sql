-- +goose Up
-- FORWARD migration for the health/readiness wave (Codex round 5's still-open
-- [high]: "snapshot readiness remains green while collateral is failed or
-- absent"). Nothing in 00001-00005 is edited: those versions are pushed and
-- goose tracks applied versions by NUMBER only, so an in-place edit would
-- silently never run on a database that already recorded the version (the 00003
-- incident, corrected by 00004). Everything this wave needs lands here as
-- version 6.
--
-- WHY A TIMESTAMP AND NOT JUST THE BLOCK. snapshot_sweeps already records
-- last_success_block, but a block number cannot answer "is this account's
-- collateral snapshot too OLD to serve": it says which chain state was read, not
-- when. The readiness gate this wave adds (collateral_unusable) asks the second
-- question, so the successful-read TIME has to be durable — daemon memory would
-- reset on restart, which is the whole class of defect the health work is
-- closing.
ALTER TABLE snapshot_sweeps ADD COLUMN last_success_at TIMESTAMPTZ;

-- BACKFILL, FAIL-CLOSED BY CONSTRUCTION. A status='success' row's updated_at IS
-- the time that success landed (ApplySweepBatch stamps updated_at = now() in the
-- same statement that writes last_success_block), so it is the honest value.
--
-- The status predicate is LOAD-BEARING, not a filter for tidiness. A row that
-- ended status='failed' may still carry last_success_block > 0 from an earlier
-- generation, and its updated_at is the time of the FAILURE — copying that in
-- would date the account's collateral to a moment no collateral was read, and a
-- backfill missing this predicate would therefore certify exactly the accounts
-- whose snapshots are most likely stale. Those rows stay NULL, and NULL counts as
-- STALE in the readiness gate: the upgrade goes red for them until each one
-- succeeds again, which is the correct direction for an unknown.
UPDATE snapshot_sweeps SET last_success_at = updated_at WHERE status = 'success';

-- The usability count's scan path: the gate reads (engine, last_success_block,
-- last_success_at) for every registry account each daemon round, so it must not
-- degrade into a sequential scan of the sweep table as the registry grows.
CREATE INDEX snapshot_sweeps_usability_idx
    ON snapshot_sweeps (engine, last_success_block, last_success_at);

-- +goose Down
DROP INDEX snapshot_sweeps_usability_idx;
ALTER TABLE snapshot_sweeps DROP COLUMN last_success_at;
