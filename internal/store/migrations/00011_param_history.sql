-- +goose Up
-- P3 Task 2: risk-parameter custody (the `aave_param` engine, PoolConfigurator
-- stream). FORWARD migration only — nothing in 00001-00010 is edited, per the
-- 00003 incident's law (goose tracks applied versions by NUMBER, so an in-place
-- edit of an already-applied file silently never runs).
--
-- WHAT THIS TABLE IS. An APPEND-ONLY LEDGER of risk-parameter facts, one row
-- per param-bearing configurator log, addressed by the log's own identity. It
-- is deliberately NOT a current-state table: a liquidation post-mortem asks
-- "what was the liquidation threshold at block N", and only a ledger can
-- answer that. The single CollateralConfigurationChanged this instance has ever
-- emitted (weETH, LTV 7800 / LT 8100 / bonus 10600, at reserve-init, never
-- re-tuned) would look identical either way today; the ledger is what keeps it
-- answerable after the first governance change.
--
-- DENOMINATORS ARE STORED RAW, exactly as emitted (plan Task 2 interface note).
-- Aave's ltv / liq_threshold / liq_bonus are BASIS POINTS (1e4); the Debt
-- Manager's equivalents are HUNDRED_PERCENT = 100e18. Normalizing at write time
-- would destroy the only evidence of which convention a row came from, and the
-- two conventions differ by 1e16 — a silent unit mix here is a mispriced
-- liquidation. Conversion lives in internal/risk, at read time, per engine.
--
-- WHY NUMERIC AND NOT NUMERIC(p,s) / BIGINT. Same discipline as
-- position_events.delta: these are uint256 values from the wire. BIGINT would
-- overflow on a HUNDRED_PERCENT-denominated bonus, and a fixed scale would
-- invite a silent rescale. Every value written binds a *big.Int via
-- pgtype.Numeric{Exp: 0} and every read casts ::text back to *big.Int, so
-- NUMERIC's scale is never interpreted.
--
-- PER-FIELD NULLS ARE MEANINGFUL. A row records what ITS event said and
-- nothing else: a CollateralConfigurationChanged row carries ltv/liq_threshold/
-- liq_bonus and NULL registry columns; a ReserveInitialized row carries the
-- registry addresses and NULL ratios; an EModeAssetCategoryChanged row carries
-- emode_category alone. NULL means "this event did not speak to this field",
-- never "zero" — which is why folding the ledger into an effective view is
-- last-non-NULL PER FIELD (store.ParamsAsOf returns the ordered ledger prefix
-- and documents the fold; it deliberately does not fold, because a
-- last-row-wins fold would let a registry row mask a live liquidation
-- threshold).
--
-- THE PRIMARY KEY IS THE LOG'S IDENTITY: (chain_id, tx_hash, log_index). It
-- matches position_events' key minus `seq` — one configurator log fans out to
-- at most one param row, unlike a liquidation log — and, exactly as there,
-- `engine` is deliberately NOT part of it: under the
-- engine←stream←contract-address topology two engines never derive from the
-- same raw log, so engine adds no uniqueness. The key is what makes
-- ApplyParamEvents' divergent-replay refusal possible: an identical replay of a
-- key is a no-op, a replay with different bytes aborts the batch.
CREATE TABLE param_history (
    engine              TEXT   NOT NULL,
    chain_id            BIGINT NOT NULL,
    -- asset is the reserve the row speaks about, raw 20 bytes (BYTEA, the
    -- house address encoding — see position_events.account/asset).
    asset               BYTEA  NOT NULL,

    -- Risk ratios, RAW in the emitting protocol's denominator (see above).
    ltv                 NUMERIC,
    liq_threshold       NUMERIC,
    liq_bonus           NUMERIC,

    -- eMode category selector (uint8 on the wire). Every occurrence on this
    -- instance is 0, but it is RECORDED rather than assumed: the category
    -- selects which liquidation threshold applies, and assuming it is the whole
    -- reason to custody it.
    emode_category      SMALLINT,

    -- Reserve registry, from ReserveInitialized. Nullable because only that
    -- event sets them. The STABLE debt token is deliberately absent: it is
    -- decoded (internal/decode.AaveCfgReserveInitialized carries it) and its
    -- bytes live in raw_logs forever, but this deployment's risk model has no
    -- stable-rate leg, so a column nothing reads would only invite a reader to
    -- believe it means something.
    atoken              BYTEA,
    variable_debt_token BYTEA,
    strategy            BYTEA,

    -- Effective ordering AND log identity, in the same two columns because on
    -- an EVM chain they are the same thing: a param row takes effect exactly
    -- where its log sits, and (block_number, log_index) is a TOTAL order
    -- (log_index is block-unique). This is what lets two param changes in ONE
    -- block be ranked instead of tying.
    effective_block     BIGINT NOT NULL,
    effective_log_index INT    NOT NULL,

    -- The decoded event type that produced the row (decode.Event.Name()), so a
    -- reader can tell WHICH fact a row is asserting without inferring it from
    -- which columns happen to be non-NULL.
    source_event        TEXT   NOT NULL,
    tx_hash             BYTEA  NOT NULL,
    derived_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (chain_id, tx_hash, effective_log_index)
);

-- The as-of read (ParamsAsOf) and the rewind delete both scan
-- engine + chain + a block bound, in effective order.
CREATE INDEX param_history_asof_idx
    ON param_history (engine, chain_id, effective_block, effective_log_index);

-- The per-reserve history read (a post-mortem asking one asset's parameter
-- timeline, and the Task-6 reserve-set weld against feeds.json).
CREATE INDEX param_history_asset_idx
    ON param_history (engine, chain_id, asset, effective_block, effective_log_index);

-- +goose Down
DROP TABLE param_history;
