-- +goose Up
CREATE TABLE position_events (
    chain_id     BIGINT  NOT NULL,
    engine       TEXT    NOT NULL,
    block_number BIGINT  NOT NULL,
    tx_hash      BYTEA   NOT NULL,
    log_index    INT     NOT NULL,
    event_type   TEXT    NOT NULL,
    account      BYTEA   NOT NULL,
    asset        BYTEA,
    side         TEXT    NOT NULL DEFAULT '',
    delta        NUMERIC,
    payload      JSONB   NOT NULL DEFAULT '{}'::jsonb,
    derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX position_events_account_idx ON position_events (engine, account, block_number);
CREATE INDEX position_events_block_idx ON position_events (engine, chain_id, block_number);

CREATE TABLE position_balances (
    engine        TEXT   NOT NULL,
    account       BYTEA  NOT NULL,
    asset         BYTEA  NOT NULL,
    side          TEXT   NOT NULL,
    amount        NUMERIC NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (engine, account, asset, side)
);
CREATE INDEX position_balances_asset_idx ON position_balances (engine, asset, side);

CREATE TABLE derive_cursors (
    engine     TEXT PRIMARY KEY,
    chain_id   BIGINT NOT NULL,
    last_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
DROP TABLE derive_cursors;
DROP TABLE position_balances;
DROP TABLE position_events;
