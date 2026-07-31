-- +goose Up
-- P5 Task B1: read-path indexes for the public feed endpoints. FORWARD
-- migration only; nothing in 00001-00014 is edited, per the 00003 incident's
-- law (goose tracks applied versions by NUMBER, so an in-place edit of an
-- already-applied file silently never runs).
--
-- NUMBERING NOTE: 00015 and 00016 are RESERVED by the parallel Task B2 wave
-- (block_headers, observatory_points). This tree deliberately carries the
-- gap; goose applies by version number, and 17 lands independently of 15/16.
-- A database that records 17 BEFORE 15/16 exist in its binary will NOT
-- retro-apply them with a plain `goose up` — the integrator resets scratch
-- databases (or runs allow-missing) at merge. Stated here so the gap is a
-- decision, not an accident.
--
-- ADDITIVE AND READ-ONLY IN EFFECT: two indexes, no table or row changes,
-- so the upgrade cannot fail on anything already persisted.

-- ---------------------------------------------------------------------------
-- 1) The cross-engine feed order.
-- ---------------------------------------------------------------------------
-- GET /v1/events pages position_events in the contract's total order
-- (block_number, chain_id, tx_hash, log_index, seq) DESC with a row-wise
-- keyset (`(cols) < (cursor)`). Neither existing index serves it:
-- position_events_account_idx leads with (engine, account) and
-- position_events_block_idx with (engine, chain_id), so the cross-engine
-- page is a full sort. Measured on the live database (2026-07-30, ~377k
-- rows): seq scan + top-N heapsort, ~46 ms per page — and position_events
-- grows without bound (~330k DM borrows alone), so that cost only rises.
-- A btree in the exact ORDER BY column order serves the page as a bounded
-- backward index scan with early termination (ASC index read backward ==
-- all-DESC order; the same index serves the keyset predicate).
CREATE INDEX position_events_feed_order_idx
    ON position_events (block_number, chain_id, tx_hash, log_index, seq);

-- ---------------------------------------------------------------------------
-- 2) The liquidation scan.
-- ---------------------------------------------------------------------------
-- The liquidations-ledger view and per-engine liquidation feeds select ONLY
-- the liquidation classes: 786 seq-0 liquidation rows (+9.2k seize-detail
-- rows) out of ~377k — a 0.2% selectivity the feed-order index cannot help
-- (it would walk ~500 non-matching rows per hit). Measured on the live
-- database: ~30 ms seq scan filtering out ~378k rows to find 262 per worker.
-- Partial on exactly the liquidation event types, (engine, block_number
-- DESC) so a per-engine ledger walks its own suffix directly; the predicate
-- names the three liquidation types explicitly — this set is CLOSED by the
-- derivers (a new liquidation type is a deriver change and extends this
-- predicate with it).
CREATE INDEX position_events_liquidation_idx
    ON position_events (engine, block_number DESC)
    WHERE event_type IN ('liquidation', 'liquidation_collateral', 'aave_liquidation_call');

-- +goose Down
DROP INDEX position_events_liquidation_idx;
DROP INDEX position_events_feed_order_idx;
