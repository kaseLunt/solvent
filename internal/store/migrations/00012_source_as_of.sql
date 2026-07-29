-- +goose Up
-- P3 Task 2: DURABLE TRUTHFUL AS-OF for price rows. FORWARD migration only —
-- nothing in 00001-00011 is edited, per the 00003 incident's law (goose tracks
-- applied versions by NUMBER, so an in-place edit of an already-applied file
-- silently never runs).
--
-- WHAT WAS WRONG. `prices.observed_at` is the DATABASE INSERTION TIME and
-- nothing else. It answers "when did this writer land a row", which is the
-- right clock for health (a writer that stopped writing) and the WRONG clock
-- for valuation (how old is the number itself). The two coincide only while
-- ingestion is instantaneous, and they diverge exactly when it is not: a poll
-- round that lands minutes after its anchor block, a feed window derived out of
-- a backfill hours or years after the aggregator published. A P3 risk read that
-- took `observed_at` for an as-of would report a stale price as fresh, and with
-- riskd forbidden from making its own RPC calls there is no recovery path at
-- read time. The chain's own timestamp has to be CUSTODIED at write time or it
-- is gone.
--
-- WHAT source_as_of IS, PER WRITER — in both cases a fact the CHAIN asserted,
-- never a clock this process read:
--
--   * poll rows  — the header timestamp of the block the round's multicall
--     executed at, i.e. the anchor block's own `timestamp` field. It costs zero
--     extra RPC: the round already reads that header to resolve its serving
--     endpoint and its EIP-1898 pin (chain.Head carries Number, Time and Hash
--     together), and the timestamp was simply being discarded. It is
--     ROUND-SCOPED: every row a round produced is as-of that one block, whatever
--     mechanism produced it.
--   * feed rows  — `AnswerUpdated.updatedAt`, the aggregator's own statement of
--     when the answer it is publishing was agreed. It is decoded from raw_logs
--     by the strict decoder either way; it was simply not being persisted.
--
-- WHAT NULL MEANS, STATED EXACTLY: "no chain-asserted as-of is known for this
-- row." It is NOT "use observed_at instead" — that substitution is the
-- fabrication this column exists to prevent, and a consumer that performs it has
-- reintroduced the defect. Consumers treat NULL as a MISSING INPUT (riskd's G1
-- handling) rather than as a permissive default.
--
-- THREE POPULATIONS ARE NULL, and only the first is repairable:
--
--   1. FEED rows written before this migration. Their witness — the
--      AnswerUpdated log — is still in raw_logs, so a one-time healing pass owned
--      by the FeedDeriver replays the STRICT Go decoder over those logs and fills
--      the column. The pass never touches values, never touches rows it does not
--      own, and writes only where the column IS NULL, so it is idempotent and a
--      second run fills nothing. There is deliberately NO SQL backfill here: a
--      substring() over `data` would be a second, unreviewed decoder sitting
--      beside the strict one, and a parser differential in a money-adjacent
--      column is exactly the class this repo refuses.
--   2. POLL rows written before this migration. Their witness was a
--      point-in-time header read that nothing on disk reproduces — the anchor
--      records the block's HASH, not its timestamp — so recovering them would take
--      one archival RPC call per anchored height. That is the D-012 offline
--      batch-tool option, correctly not built now. Poll history is FORWARD-ONLY:
--      those rows stay NULL permanently, and saying so is more honest than a
--      backfill that guesses.
--   3. Any future row whose writer genuinely has no chain-asserted as-of. Hence
--      the column is NULLABLE FOREVER; a NOT NULL constraint would force such a
--      writer to invent a value, which is the whole defect again.
--
-- ADDITIVE AND UNCONDITIONAL: one nullable column, no rewrite of existing rows,
-- no constraint tightened over stored data, so the upgrade cannot fail on
-- anything already persisted.
ALTER TABLE prices ADD COLUMN source_as_of TIMESTAMPTZ;

COMMENT ON COLUMN prices.source_as_of IS
    'The CHAIN''s own statement of when this observation was true: the anchor block''s header timestamp for a polled row, AnswerUpdated.updatedAt for a Chainlink feed row. NULL means no chain-asserted as-of is known — it must NEVER be read as "fall back to observed_at", which is database insertion time and would report a stale price as fresh. Pre-00012 poll rows are permanently NULL (their header timestamp was never recorded); pre-00012 feed rows are filled once by the FeedDeriver''s decoder-replay healing pass.';

-- The healing pass's guard ("does this engine still own un-stamped rows on this
-- chain?") runs once per FeedDeriver startup, and `prices` only ever grows —
-- polled rows are never deleted. Without an index that guard is a sequential
-- scan over all price history on every daemon restart.
--
-- Partial on the NULL predicate, which is what makes it CONVERGENT rather than
-- another ever-growing index: from this migration forward BOTH writers stamp the
-- column, so no new row enters this index. It covers exactly the finite legacy
-- population described above, shrinks as the feed pass fills it, and thereafter
-- holds only the permanently-NULL poll history.
CREATE INDEX prices_missing_source_as_of_idx
    ON prices (chain_id, owner_engine, block_number)
    WHERE source_as_of IS NULL;

-- +goose Down
DROP INDEX prices_missing_source_as_of_idx;
ALTER TABLE prices DROP COLUMN source_as_of;
