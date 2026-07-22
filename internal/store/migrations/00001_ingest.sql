-- +goose Up
CREATE TABLE ingest_cursors (
    stream          TEXT PRIMARY KEY,
    chain_id        BIGINT      NOT NULL,
    last_block      BIGINT      NOT NULL,
    last_block_hash BYTEA       NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE raw_logs (
    chain_id     BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   BYTEA  NOT NULL,
    tx_hash      BYTEA  NOT NULL,
    log_index    INT    NOT NULL,
    address      BYTEA  NOT NULL,
    topics       BYTEA[] NOT NULL,
    data         BYTEA  NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX raw_logs_block_idx ON raw_logs (chain_id, block_number);
CREATE INDEX raw_logs_address_idx ON raw_logs (chain_id, address, block_number);

-- +goose Down
DROP TABLE raw_logs;
DROP TABLE ingest_cursors;
