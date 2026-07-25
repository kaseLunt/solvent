-- +goose Up
-- FORWARD migration for the Task 8 fix wave (Codex round 1, findings A1/A2/D1).
-- Nothing in 00001-00004 is edited: those versions are pushed, and goose tracks
-- applied versions by number only, so an in-place edit would silently never run
-- on a database that already recorded the version (the 00003 incident, corrected
-- by 00004). Everything this wave needs lands here as version 5.
--
-- Three independent shapes, one migration because they all touch `prices`:
--
--   1) owner_engine  — A2: rewind price rows by the ENGINE that wrote them
--      instead of by the currently-loaded registry's source list.
--   2) valid/invalid_reason — D1: a non-positive oracle answer stays recorded as
--      a raw fact but can never be selected as a usable price.
--   3) price_poll_anchors — A1: durable (block, hash) anchors for poll rounds,
--      so reorg repair can delete only the suffix it cannot hash-verify.

-- ---------------------------------------------------------------------------
-- 1) owner_engine: durable engine→row ownership.
-- ---------------------------------------------------------------------------
-- RewindPrices previously deleted rows whose `source` appeared in the CALLER'S
-- CURRENTLY LOADED registry. After a manual Chainlink phase update the feed
-- deriver owns only chainlink:<new-aggregator>, so historical
-- chainlink:<old-aggregator> rows fell out of that list: a later deep reorg
-- crossing the phase boundary left them above the effective target while the
-- transaction advanced acked_epoch, and once the epoch was pruned no repair
-- trigger remained. The writer's pseudo-engine key does not change across a
-- phase update, so recording it on the row makes ownership immune to registry
-- edits.
ALTER TABLE prices ADD COLUMN owner_engine TEXT NOT NULL DEFAULT '';

-- Backfill from the source families this codebase has ever written, using the
-- exact same key shapes internal/prices constructs (PollCursorEngine /
-- FeedCursorEngine): "prices:poll:<chain>" for the engine-exact PriceProviderV2
-- poll and for polled ratio views, "prices:chainlink_feed:<chain>" for a raw
-- aggregator's AnswerUpdated stream.
UPDATE prices SET owner_engine = 'prices:chainlink_feed:' || chain_id::text
    WHERE source LIKE 'chainlink:%';
UPDATE prices SET owner_engine = 'prices:poll:' || chain_id::text
    WHERE source = 'priceproviderv2' OR source LIKE 'ratio:%';

-- FAIL LOUD rather than leave an unowned row: an unrecognised source would
-- produce exactly the orphan A2 is about, only now permanently invisible to an
-- owner-scoped rewind. Whoever adds a source family must extend the backfill.
-- +goose StatementBegin
DO $$
DECLARE unowned BIGINT;
BEGIN
    SELECT count(*) INTO unowned FROM prices WHERE owner_engine = '';
    IF unowned > 0 THEN
        RAISE EXCEPTION 'migration 00005: % prices row(s) carry a source this backfill does not recognise; extend the owner_engine backfill before upgrading', unowned;
    END IF;
END $$;
-- +goose StatementEnd

-- With the backfill proven complete, an owner becomes MANDATORY: dropping the
-- default forces every future insert to name its writer, and the CHECK makes an
-- unowned row structurally impossible rather than merely unlikely.
ALTER TABLE prices ALTER COLUMN owner_engine DROP DEFAULT;
ALTER TABLE prices ADD CONSTRAINT prices_owner_engine_present CHECK (owner_engine <> '');

-- The rewind's delete predicate, and the freshness read's scan path.
CREATE INDEX prices_owner_idx ON prices (chain_id, owner_engine, block_number);

-- ---------------------------------------------------------------------------
-- 2) valid / invalid_reason: a recorded fact that can never be read as usable.
-- ---------------------------------------------------------------------------
-- A zero or negative oracle answer must still be RECORDED (refusing it would
-- wedge the feed deriver forever on a log that already exists in raw_logs) and
-- the cursor must still advance, but a latest-price query must not be able to
-- return it: divide-by-zero, inverted valuation and invalid liquidation maths
-- all follow from treating one as an ordinary price.
--
-- The CHECK is the load-bearing part: `valid` may be false for any future
-- reason, but a NON-POSITIVE row can never be marked valid, so no writer — this
-- one or a later one — can reintroduce the hole.
ALTER TABLE prices
    ADD COLUMN valid          BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN invalid_reason TEXT    NOT NULL DEFAULT '';

UPDATE prices SET valid = FALSE, invalid_reason = 'non-positive oracle answer'
    WHERE price <= 0;

ALTER TABLE prices ADD CONSTRAINT prices_valid_is_positive CHECK (NOT valid OR price > 0);
-- A reason is required exactly when the row is invalid, and forbidden when it is
-- not: "invalid with no reason" and "valid with a reason" are both incoherent.
ALTER TABLE prices ADD CONSTRAINT prices_invalid_reason_iff_invalid
    CHECK ((valid AND invalid_reason = '') OR (NOT valid AND invalid_reason <> ''));

-- Serves the latest-USABLE-price read directly: the partial predicate means an
-- invalid row is not merely filtered out, it is not in the index at all.
CREATE INDEX prices_usable_latest_idx ON prices (chain_id, asset, source, block_number DESC)
    WHERE valid;

-- ---------------------------------------------------------------------------
-- 3) price_poll_anchors: durable hash anchors for poll rounds.
-- ---------------------------------------------------------------------------
-- A polled price cannot be re-derived (the poller only ever reads `latest`), so
-- a reorg rewind that lowered the poll cursor to the raw-log walker's deepest
-- sparse-log ancestor could delete every polled row — canonical history
-- included — because that ancestor is unrelated to the blocks where polls
-- actually happened. multicall3's tryBlockAndAggregate already returns the
-- execution block HASH alongside the number; persisting it turns each round into
-- an independently verifiable anchor, so repair can walk down from the newest
-- anchor, find the first one whose hash still matches the live chain, and delete
-- only the suffix above it.
--
-- One row per landed round, written in the SAME transaction as that round's
-- rows and cursor move, so an anchor can never describe a round that did not
-- commit. Retention is bounded in ApplyPolledPrices (see pollAnchorRetention):
-- anchors far below any plausible reorg depth are pruned, and their absence
-- degrades repair to the conservative walker target rather than corrupting it.
CREATE TABLE price_poll_anchors (
    engine       TEXT   NOT NULL,
    chain_id     BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   BYTEA  NOT NULL,
    observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, block_number)
);
CREATE INDEX price_poll_anchors_scan_idx ON price_poll_anchors (chain_id, engine, block_number DESC);

-- +goose Down
DROP TABLE price_poll_anchors;
DROP INDEX prices_usable_latest_idx;
ALTER TABLE prices DROP CONSTRAINT prices_invalid_reason_iff_invalid;
ALTER TABLE prices DROP CONSTRAINT prices_valid_is_positive;
ALTER TABLE prices DROP COLUMN invalid_reason;
ALTER TABLE prices DROP COLUMN valid;
DROP INDEX prices_owner_idx;
ALTER TABLE prices DROP CONSTRAINT prices_owner_engine_present;
ALTER TABLE prices DROP COLUMN owner_engine;
