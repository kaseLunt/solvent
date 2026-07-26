-- +goose Up
-- FORWARD migration for round 9's restart-continuity finding: "the adaptive
-- collateral bound is lost after restart during an open generation". Nothing in
-- 00001-00007 is edited — those versions are pushed and goose tracks applied
-- versions by NUMBER only, so an in-place edit would silently never run on a
-- database that already recorded the version (the 00003 incident, corrected by
-- 00004). Everything this wave needs lands here as version 8.
--
-- WHAT WAS LOST, AND WHY THE EXISTING COLUMNS COULD NOT HOLD IT. The daemon's
-- collateral staleness bound is max(2*(interval + lastPass), noProgressBound) —
-- relative to the sweep cadence the deployment actually achieves, because a
-- constant bound is permanently exceeded on any sizable registry. Its second
-- input, the achieved pass duration, was derived as completed_at - opened_at of
-- sweep_generations. But that row is ONE row per engine, and both
-- OpenSweepGeneration and RewindDerived's bump set completed_at = NULL: the
-- moment a new generation opens, the only durable record of how long the last
-- pass took is destroyed. In-process retention (collateralBoundState) covered a
-- running daemon and nothing else, so a RESTART during a long healthy sweep
-- collapsed the bound to the naive formula for the rest of that generation —
-- hours or days of false-red readiness on a large registry, after every restart.
-- That is process-memory-equivalence in a surface whose entire premise is that a
-- restart must not grant or destroy a verdict.
--
-- WHY A SEPARATE COLUMN AND NOT RETAINED HISTORY. sweep_generations is keyed on
-- engine alone, so there IS no history to retain: each open overwrites the row in
-- place. Widening the key to (engine, generation) would turn a single-row lookup
-- read every daemon round into a scan-and-order over unbounded history and would
-- require a retention policy nobody has derived. One additive column carries the
-- one fact the bound needs.
--
-- SECONDS, and stated in seconds rather than an interval, because the value is
-- consumed as a Go time.Duration by exactly one caller and a whole-second
-- resolution is four orders of magnitude finer than anything the doubled bound
-- can distinguish. Storing it explicitly also makes it the SINGLE source of the
-- reported duration for both open and closed generations, so the value a restart
-- reads back is bit-identical to the one the pre-restart process was judging with
-- — which is the property the restart test asserts.
ALTER TABLE sweep_generations ADD COLUMN last_pass_seconds BIGINT;

-- BACKFILL from the one place the fact still survives: a generation that is
-- currently CLOSED still carries both of its own timestamps, so its duration is
-- recoverable exactly. A generation that is currently OPEN carries completed_at
-- IS NULL and its predecessor's duration was already overwritten before this
-- migration ran — there is nothing to recover, and inventing a number for it
-- would be worse than the NULL. NULL degrades to the same naive bound the daemon
-- uses today, so the upgrade is never worse than the behaviour it replaces and
-- becomes correct as soon as the first generation completes under the new code.
UPDATE sweep_generations
   SET last_pass_seconds = GREATEST(0, EXTRACT(EPOCH FROM (completed_at - opened_at))::bigint)
 WHERE completed_at IS NOT NULL AND opened_at IS NOT NULL AND completed_at > opened_at;

-- +goose Down
ALTER TABLE sweep_generations DROP COLUMN last_pass_seconds;
