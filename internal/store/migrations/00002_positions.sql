-- +goose Up
-- DEV-ONLY IN-PLACE EDIT (Phase 2 Task 3b): this migration was amended after
-- first landing — seq PK column, position_balances.source, rate_indexes,
-- reorg_epochs, derive_cursors.acked_epoch — while it had only ever been
-- applied to disposable local dev databases. Cycle a dev db by dropping the
-- version-2 tables and deleting goose_db_version's version_id=2 row, then let
-- store.Migrate re-apply. NEVER edit an applied migration once any shared or
-- production database has run it.
CREATE TABLE position_events (
    chain_id     BIGINT  NOT NULL,
    engine       TEXT    NOT NULL,
    block_number BIGINT  NOT NULL,
    tx_hash      BYTEA   NOT NULL,
    log_index    INT     NOT NULL,
    -- seq discriminates multiple derived events fanned out from ONE raw log
    -- (e.g. a liquidation log interpreted into several seize movements);
    -- 0 for the common one-event-per-log case.
    seq          INT     NOT NULL DEFAULT 0,
    event_type   TEXT    NOT NULL,
    account      BYTEA   NOT NULL,
    asset        BYTEA,
    side         TEXT    NOT NULL DEFAULT '',
    delta        NUMERIC,
    payload      JSONB   NOT NULL DEFAULT '{}'::jsonb,
    derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The PK deliberately EXCLUDES engine (reviewer suggestion adjudicated
    -- and REFUSED): under the engine←stream←contract-address topology, two
    -- engines never derive from the same raw log, so engine adds no
    -- uniqueness — (chain_id, tx_hash, log_index, seq) is already unique
    -- across engines.
    PRIMARY KEY (chain_id, tx_hash, log_index, seq)
);
CREATE INDEX position_events_account_idx ON position_events (engine, account, block_number);
CREATE INDEX position_events_block_idx ON position_events (engine, chain_id, block_number);

CREATE TABLE position_balances (
    engine        TEXT   NOT NULL,
    account       BYTEA  NOT NULL,
    asset         BYTEA  NOT NULL,
    side          TEXT   NOT NULL,
    -- source discriminates event-derived rows ('event': maintained by
    -- ApplyDerived, rebuilt by RewindDerived) from snapshot-derived rows
    -- ('snapshot': replaced wholesale per account by UpsertSnapshotBalances,
    -- never touched by rewinds). Both sources may hold the same logical key,
    -- so source is part of the PK.
    source        TEXT   NOT NULL DEFAULT 'event',
    amount        NUMERIC NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (engine, account, asset, side, source)
);
CREATE INDEX position_balances_asset_idx ON position_balances (engine, asset, side);

CREATE TABLE derive_cursors (
    engine      TEXT PRIMARY KEY,
    chain_id    BIGINT NOT NULL,
    last_block  BIGINT NOT NULL,
    -- Highest reorg_epochs.epoch on this cursor's chain that the engine has
    -- acknowledged — set to the chain's max by RewindDerived (explicit ack)
    -- and on first cursor insert (implicit ack: a brand-new engine has no
    -- derived state a reorg could have invalidated). ApplyDerived refuses to
    -- advance while acked_epoch < the chain's max epoch.
    acked_epoch BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Engine rate observations (e.g. Aave liquidity/borrow indexes, APYs) keyed
-- by block. kind is one of: borrow_index, variable_borrow_index,
-- liquidity_index, borrow_apy.
CREATE TABLE rate_indexes (
    engine       TEXT   NOT NULL,
    asset        BYTEA  NOT NULL,
    block_number BIGINT NOT NULL,
    kind         TEXT   NOT NULL,
    value        NUMERIC NOT NULL,
    PRIMARY KEY (engine, asset, block_number, kind)
);

-- Durable reorg coordination: store.Rewind inserts one row per raw rewind,
-- atomically (same transaction) with the raw-log deletion. An epoch
-- invalidates derived state CHAIN-WIDE — every engine whose derive cursor
-- sits on chain_id must acknowledge (RewindDerived) before ApplyDerived may
-- advance it again. This survives a crash between the raw rewind and the
-- derived rewind: the marker is a row, not process memory.
CREATE TABLE reorg_epochs (
    chain_id   BIGINT NOT NULL,
    epoch      BIGSERIAL,
    rewound_to BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, epoch)
);

CREATE TABLE prices (
    chain_id       BIGINT NOT NULL,
    asset          BYTEA  NOT NULL,
    source         TEXT   NOT NULL,
    price          NUMERIC NOT NULL,
    price_decimals INT    NOT NULL,
    block_number   BIGINT NOT NULL,
    observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, asset, source, block_number)
);

CREATE TABLE snapshots (
    engine       TEXT  NOT NULL,
    account      BYTEA NOT NULL,
    block_number BIGINT NOT NULL,
    balances     JSONB NOT NULL,
    taken_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, account, block_number)
);

-- +goose Down
DROP TABLE snapshots;
DROP TABLE prices;
DROP TABLE reorg_epochs;
DROP TABLE rate_indexes;
DROP TABLE derive_cursors;
DROP TABLE position_balances;
DROP TABLE position_events;
