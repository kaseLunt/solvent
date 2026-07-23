-- +goose Up
-- Snapshot sweep status: one row per (engine, account) the collateral
-- snapshotter has ever ATTEMPTED, so readers can disambiguate the three
-- states that used to collapse into "no rows in position_balances":
--
--   - zero-collateral SUCCESS: status='success' row + empty snapshot
--     balances (the sweep read the account and it genuinely holds nothing);
--   - never swept: NO row (the account has not been attempted);
--   - FAILED: status='failed' row (collateralOf reverted through the bounded
--     retry budget; last_success_block says how stale the surviving snapshot
--     rows are).
--
-- last_attempt_block / last_success_block are the multicall EXECUTION blocks
-- of the most recent attempt / most recent success (0 = never succeeded).
-- status is 'success' or 'failed' — always the outcome of the LAST attempt.
CREATE TABLE snapshot_sweeps (
    engine             TEXT   NOT NULL,
    account            BYTEA  NOT NULL,
    last_attempt_block BIGINT NOT NULL,
    last_success_block BIGINT NOT NULL DEFAULT 0,
    status             TEXT   NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, account)
);

-- +goose Down
DROP TABLE snapshot_sweeps;
