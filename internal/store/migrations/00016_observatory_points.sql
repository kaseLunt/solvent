-- +goose Up
-- P5 Task B2: the OBSERVATORY ROLLUP. FORWARD migration only; nothing in
-- 00001-00015 is edited (00003 incident law).
--
-- WHAT A POINT IS — AND IS NOT. One row per (hour bucket, engine): the
-- per-engine aggregate of the newest COMPLETE risk batch as it stood when the
-- daemon's rollup tick observed it. Points are OBSERVATIONS OF A SERVABLE
-- BATCH AT WRITE TIME, not re-derivable history: risk batches are retained
-- only to SOLVENT_RISK_RETENTION and then pruned, so a point routinely
-- outlives the batch it observed — which is the whole reason this table
-- exists (the migration record must persist beyond the batch-retention
-- window). Nothing can rebuild a point after the fact, and nothing tries.
--
-- THE SOURCE IS THE BATCH, NEVER RAW DERIVED STATE. A point is copied from
-- risk_batch_aggregates/risk_batch_watermarks of a batch that passes the SAME
-- completeness predicate cmd/api serves by — never recomputed from
-- position_balances/prices at tick time. Recomputing would bypass everything
-- the batch pipeline enforces (degradation gates, refusal rows, the price
-- snapshot, the watermark stamps) and could disagree with the public Book
-- over the very numbers this series claims to be the history of. When no
-- complete batch exists, the bucket is ABSENT — honest — never a
-- freshly-computed stand-in.
--
-- REWINDS DO NOT RETRO-EDIT PAST BUCKETS. A reorg rewind changes what future
-- batches derive, and therefore what FUTURE points observe; the points already
-- written stand as the record of what was observed when they were written.
-- Retro-editing them would forge an observation nobody made. The only row a
-- tick may touch is the CURRENT hour's bucket, and only to refresh it with a
-- NEWER batch observation (last-write-wins within the open bucket); a closed
-- (past) bucket is never rewritten by any write path.
--
-- TIME SEMANTICS, stated so nobody infers the wrong law: bucket_start and
-- observed_at are DATABASE-CLOCK observation times — this is CORRECT here,
-- not a violation of the block-time custody law in 00015, because they date
-- the OBSERVATION (an act this system performed, on its own clock authority,
-- the same authority risk_batches.computed_at uses), not any chain fact. No
-- column in this table claims to be a chain time. The chain-side anchor is
-- last_block, the engine's watermark block, in the unit the chain actually
-- provides.
--
-- ENGINES ARE NEVER BLENDED (spec §5.2): one row per engine, each in its own
-- value_decimals scale, exactly as risk_batch_aggregates keeps them. A refused
-- engine's point carries its refusal_code — zero positions with a code is a
-- WITHHELD book, not an empty one, and a series that dropped the distinction
-- would render a refusal as "no risk" (the false-safety direction).
--
-- NO FK TO risk_batches, deliberately: retention deletes old batches, and a
-- point must survive its batch (see above). batch_id is provenance — which
-- batch was observed — and may dangle after retention; that is by design.
CREATE TABLE observatory_points (
    -- The hour this observation falls in: date_trunc('hour', now()) under the
    -- database clock at write time.
    bucket_start      TIMESTAMPTZ NOT NULL,
    engine            TEXT        NOT NULL,
    -- When the newest write to this row happened (refreshed when a newer
    -- batch lands inside the same open bucket). Observation provenance, never
    -- a chain as-of.
    observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Provenance: the complete batch this point observed, that batch's own
    -- computed_at, and its DETERMINISTIC materialization key (risk_batches
    -- .materialization_key) — so a point remains traceable to WHAT was
    -- materialized even after retention prunes the batch row itself. A reader
    -- can tell a fresh observation of a stale batch (riskd idle:
    -- batch_computed_at falls behind bucket_start) from a fresh batch — the
    -- two must never be conflated.
    batch_id            BIGINT      NOT NULL,
    batch_computed_at   TIMESTAMPTZ NOT NULL,
    materialization_key TEXT        NOT NULL,
    -- The engine's WATERMARK VECTOR in the observed batch, copied from
    -- risk_batch_watermarks: the chain-side anchor (last_block) plus the
    -- reorg-honesty stamp pair (acked_epoch, max_epoch_at_compute) on the
    -- engine's chain. Copied — not joined at read time — because the batch
    -- row is prunable and a serve-time join would be the TOCTOU class
    -- migration 00013's risk_price_inputs exists to prevent.
    chain_id             BIGINT NOT NULL,
    last_block           BIGINT NOT NULL,
    acked_epoch          BIGINT NOT NULL,
    max_epoch_at_compute BIGINT NOT NULL,

    -- The engine's own money scale (risk_batch_aggregates.value_decimals);
    -- totals below are NUMERIC decimal integers in this scale, copied exactly.
    value_decimals    SMALLINT    NOT NULL,

    -- Account counts, copied from the engine's aggregate row.
    positions              INT NOT NULL,
    computed_positions     INT NOT NULL,
    refused_positions      INT NOT NULL,
    flagged_positions      INT NOT NULL,
    liquidatable_positions INT NOT NULL,

    -- Debt- and collateral-side totals over COMPUTED rows only (refused rows
    -- contribute nothing and are counted above — folding them in as zero is
    -- the understatement a refusal exists to prevent). The Debt Manager's
    -- collateral side is sweep-sourced; both engines' aggregates carry both
    -- totals, and they are copied as the aggregate row states them.
    total_collateral NUMERIC NOT NULL,
    total_debt       NUMERIC NOT NULL,

    -- The ENGINE-SCOPED refusal (migration 00014), copied so a withheld book
    -- stays visibly withheld in the series. Empty = not refused.
    refusal_code   TEXT NOT NULL DEFAULT '',
    refusal_detail TEXT NOT NULL DEFAULT '',

    -- RATES SNAPSHOT: the newest rate_indexes observation per (asset, kind)
    -- for this engine at write time, as
    --   { "<asset-hex>": { "<kind>": { "value": "<decimal string>", "block": <n> } } }
    -- Values are DECIMAL STRINGS (never JSON numbers — the house no-floats
    -- law), each with its own as-of BLOCK, because rate observations genuinely
    -- vary per asset and only appear when the chain emitted them. An engine
    -- with no rate observations carries '{}' — absence, not zero.
    rates JSONB NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (bucket_start, engine)
);

-- The series read is per engine over a time range.
CREATE INDEX observatory_points_engine_idx
    ON observatory_points (engine, bucket_start);

-- +goose Down
DROP TABLE observatory_points;
