-- +goose Up
-- P5 Task B2: BLOCK-TIME CUSTODY. FORWARD migration only; nothing in
-- 00001-00014 is edited, per the 00003 incident's law (goose tracks applied
-- versions by NUMBER, so an in-place edit of an already-applied file silently
-- never runs).
--
-- WHAT THIS TABLE IS. One row per (chain, block) whose header this deployment
-- has FETCHED FROM THE CHAIN AND HASH-VALIDATED. It exists because this schema
-- deliberately held NO wall-clock times for chain state (raw_logs records no
-- header timestamp; migration 00013's risk_position_legs stamps as-ofs as
-- BLOCKS for exactly that reason), and P5's event feed wants human-readable
-- times. The only honest way to get one is to ask the chain for the block's
-- own header and store the header's OWN timestamp.
--
-- THE CHAIN-ASSERTED-ONLY LAW. block_time is the header's `timestamp` field,
-- unix seconds, exactly as the chain asserted it — NEVER a process clock,
-- NEVER a database clock, NEVER an insertion time. Fabricating a block time
-- from when a row happened to be written is the fabricated-freshness class
-- migration 00012 exists to close, and nothing writing this table may do it.
--
-- ABSENCE IS THE HONEST STATE. A block whose header has not been fetched (or
-- whose fetch failed, or whose fetch was REFUSED by the pin check below)
-- simply has no row, and every downstream surface renders block-number-only
-- for it. A header fetch failure never blocks or fails ingest; the row is
-- absent until the daemon's bounded custody pass or the one-shot
-- cmd/backfill-blocktimes closes the gap. NULL/absent is never rendered as a
-- time, and no default exists that could invent one.
--
-- HASH-VALIDATED, REFUSE-DON'T-OVERWRITE. block_hash is the hash of the
-- header the time was read from, and every write path validates it against
-- the STORED PIN for that block — the block_hash raw_logs committed when the
-- walker verified and landed the window. A fetched header whose hash does not
-- match the pin is a refusal-to-write (a failover endpoint on a different
-- fork, or a stale view), logged, never stored. An EXISTING row whose hash
-- disagrees with the current pin (a deep reorg re-walked the range after this
-- row was written) is likewise never silently overwritten: the writer refuses,
-- logs the divergence, and an operator resolves it by deleting the stale row
-- (custody or backfill then re-fetches under the current pin). Silent
-- supersession of custody evidence is not a thing this table does.
--
-- TWO WRITERS, ONE CONVERGENT VALUE — deliberately outside the D-004 advisory
-- writer lock. The indexer's per-round custody pass and the one-shot
-- cmd/backfill-blocktimes may both upsert here concurrently. That is safe
-- because both validate against the SAME durable pin before writing, so a
-- concurrent write is either byte-identical (idempotent no-op) or a refused
-- divergence — no lost-update class exists for chain-asserted facts keyed by
-- (chain, block).
CREATE TABLE block_headers (
    chain_id     BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    -- The fetched header's own hash, validated against the raw_logs pin at
    -- write time (see above).
    block_hash   BYTEA  NOT NULL,
    -- The header's OWN timestamp, unix seconds, exactly as the chain asserted
    -- it. See the chain-asserted-only law above.
    block_time   BIGINT NOT NULL,
    -- Fetch PROVENANCE only: when this deployment took custody of the header.
    -- It is NEVER an as-of for anything and no serving surface may substitute
    -- it for block_time (migration 00012's law).
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, block_number),
    -- A zero block_time is not a fact this table can hold: no event-bearing
    -- block on either configured chain predates 2015, so a zero here could
    -- only be an unset value smuggled in as data. Fail closed.
    CONSTRAINT block_headers_time_positive CHECK (block_time > 0)
);

-- +goose Down
DROP TABLE block_headers;
