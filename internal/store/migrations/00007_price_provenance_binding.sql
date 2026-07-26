-- +goose Up
-- FORWARD migration for Task 8 wave 10 (Codex round 8, findings 2, 4 and 5).
-- Nothing in 00001-00006 is edited: those versions are applied, and goose tracks
-- applied versions by number only, so an in-place edit would silently never run
-- on a database that already recorded the version (the 00003 incident, corrected
-- by 00004). Everything this wave needs lands here as version 7.
--
-- Three independent shapes, all ADDITIVE — no column is dropped, no row is
-- rewritten, no constraint is tightened over existing data, so the upgrade cannot
-- fail on anything already stored:
--
--   1) prices.anchor_block   — round-8 finding 2: bind provenance to the OBSERVATION
--      instead of inferring it from the height, so a later round's anchor cannot
--      become provenance for an older row it never covered.
--   2) price_poll_anchor_prune — round-8 finding 4: a per-engine prune frontier, so
--      permanently-protected anchors are considered once and never reconsidered.
--   3) prices_neutralized_backlog_idx — round-8 finding 5: the partial covering index
--      D-012 clause 6 requires, so the backlog aggregate costs the BACKLOG rather than
--      the engine's whole price history.

-- ---------------------------------------------------------------------------
-- 1) prices.anchor_block: provenance bound per observation, not per height.
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG. applyPrices writes one height-wide anchor per round, and every
-- read that asked "does this row have provenance?" asked it of the HEIGHT:
-- `EXISTS (SELECT 1 FROM price_poll_anchors a WHERE a.block_number = p.block_number)`.
-- Those two are not the same question. A row written at H by a round that recorded
-- NO anchor (legacy history, or a round predating the anchor table) and later
-- neutralized becomes, the moment any subsequent round executes at H and anchors
-- there, indistinguishable on disk from a row that anchor actually vouches for.
-- D-012 clause 2 retains anchors precisely so an OFFLINE reconciliation has a TRUE
-- input; a fabricated one hands that future tool a hash the row's round never
-- witnessed. Removing the ONLINE consumer (clause 3) removed the exploitation path
-- and left the write-side corruption untouched.
--
-- WHAT NULL MEANS, STATED EXACTLY, BECAUSE THE BACKFILL CANNOT DO BETTER:
--
--     anchor_block IS NULL  =  "no anchor is known to vouch for this observation."
--
-- It does NOT mean "vouched by whatever anchor sits at this height". That inference
-- is the very fabrication this column exists to stop, and it is unavailable
-- retroactively: whether the round that wrote a given pre-migration row also wrote an
-- anchor in the same transaction was never recorded, and an anchor at the same height
-- may have been written by a different round entirely. So NULL is UNPROVABLE, and
-- every consumer treats it as such — a row with NULL counts as unanchored in the
-- neutralization split, and no read may promote it. That strands genuinely-anchored
-- pre-migration rows in the unprovable class; failing toward unprovable is the only
-- direction that cannot manufacture a proof.
--
-- NO BACKFILL IS ATTEMPTED, and the absence is the point. A backfill of
-- `anchor_block = block_number WHERE an anchor exists there` would write exactly the
-- fabricated binding the column exists to prevent, permanently and invisibly.
--
-- The column is NULLABLE FOREVER. It is genuinely absent for two ongoing populations,
-- not merely for legacy rows: the event-derived Chainlink feed writer records no
-- anchors at all (ApplyPrices passes none), and any future writer with no witnessed
-- execution block is in the same position. A NOT NULL constraint would force those
-- writers to invent a value.
ALTER TABLE prices ADD COLUMN anchor_block BIGINT;

COMMENT ON COLUMN prices.anchor_block IS
    'Block of the poll anchor written in the SAME transaction as this observation, or NULL when no anchor is known to vouch for it. NULL is unprovable and must never be read as "vouched by the anchor at this row''s height" — that inference is what D-012 clause 2 forbids. Pre-00007 rows are all NULL by construction: the fact was never recorded.';

-- Serves the per-observation provenance reads (the neutralization split, and any
-- offline reconciliation walking marked rows back to the anchors that vouch for
-- them). Partial, because a NULL binding is never joined to an anchor.
CREATE INDEX prices_anchor_binding_idx ON prices (chain_id, owner_engine, anchor_block)
    WHERE anchor_block IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) price_poll_anchor_prune: the incremental prune frontier.
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG. pruneOldPollAnchors runs inside every anchored round and deleted
-- with a correlated NOT EXISTS over every anchor below the retention window. Anchors
-- at neutralized heights are exempt and therefore survive forever — so each one stays
-- a candidate on every later invocation, and the per-round cost grew with the ALL-TIME
-- number of classified heights. D-012 clause 6 requires permanent state to be cheap to
-- carry; this made permanence quadratic in the cadence.
--
-- WHAT THE FRONTIER MEANS:
--
--     "every anchor for this engine strictly below `frontier` has already been
--      considered by prune, and whatever survives there is permanently protected."
--
-- Absent row = frontier 0 = nothing has been considered yet.
--
-- WHY "PERMANENTLY" IS TRUE AND NOT AN ASSUMPTION. The frontier only ever advances to
-- the retention cutoff, i.e. to pollAnchorRetention anchors BELOW the newest. An
-- anchor's exemption is released only when the marker on the rows at its height is
-- cleared, and exactly one thing clears one in the running system: insertPrice's
-- supersede arm, which needs a CURRENT poll to land at that exact height. The cursor's
-- monotonic guard refuses a batch below the cursor, so a height the cursor has already
-- passed by a full retention window can never receive one. Below the frontier, release
-- is unreachable — which is what makes considering those heights once and never again
-- lossless rather than merely cheap. (Asserted, not reasoned: the cursor-guard refusal
-- is driven by TestPollAnchorRetentionExemptsNeutralizedHeights.)
CREATE TABLE price_poll_anchor_prune (
    engine     TEXT   PRIMARY KEY,
    frontier   BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3) prices_neutralized_backlog_idx: the backlog aggregate's covering index.
-- ---------------------------------------------------------------------------
-- D-012 clause 6: the gap must stay visible, and "the stats surface must be cheap —
-- its cost may not scale with total price history... incremental accounting or a
-- partial index, with measured evidence." NeutralizedPriceStats reads
-- count/min(observed_at)/max(observed_at)/max(block_number) over the marker, and no
-- index carried that predicate, so every call scanned the engine's entire history —
-- a table that only ever grows, because polled rows are never deleted.
--
-- Partial on the marker and covering the four projected columns, so the read is an
-- index-only scan over exactly the backlog rows.
--
-- THE PREDICATE IS A LITERAL, AND THE QUERY THAT USES IT MUST BE ONE TOO. PostgreSQL
-- can only use a partial index when it can PROVE the query's predicate implies the
-- index's, and it cannot prove that of a bound parameter under a generic plan — so a
-- `WHERE invalid_reason = $3` query would silently fall back to the full scan this
-- index exists to remove. NeutralizedPriceStats therefore inlines the marker as a
-- compile-time constant (see neutralizedBacklogQuery), and
-- TestNeutralizedBacklogAggregateUsesItsCoveringIndex reads the live EXPLAIN to prove
-- the two texts still agree. The literal below must stay byte-identical to
-- store.InvalidReasonUnverifiableReorg.
CREATE INDEX prices_neutralized_backlog_idx
    ON prices (chain_id, owner_engine, observed_at, block_number)
    WHERE invalid_reason = 'unverifiable after a reorg: no surviving poll anchor covers this observation';

-- +goose Down
DROP INDEX prices_neutralized_backlog_idx;
DROP TABLE price_poll_anchor_prune;
DROP INDEX prices_anchor_binding_idx;
ALTER TABLE prices DROP COLUMN anchor_block;
