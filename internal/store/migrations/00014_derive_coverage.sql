-- +goose Up
-- DERIVATION-COVERAGE PROVENANCE (P3 collateral-flag wave, round-1 [high]).
--
-- Two additive columns on derive_cursors. They answer a question the cursor
-- alone cannot: not "how far has this engine derived", but "WHAT CODE derived
-- it, and FROM WHERE".
--
-- The question became load-bearing the moment a derived law started reading
-- ABSENCE as chain truth. `internal/riskfeed`'s collateral law treats "no
-- ReserveUsedAsCollateral* event for this (reserve, user)" as the chain fact
-- "never enabled as collateral" — which is exact, but ONLY if the flag events
-- were in the decoder's allowlist for the whole walk that produced the current
-- derived state. A cursor at head proves neither. A database derived by a
-- binary that predates the flag registration carries a cursor at head and an
-- EMPTY flag ledger, and the law would read that emptiness as "nobody has ever
-- used anything as collateral" — publishing zero collateral, and health factor
-- zero, for borrowers who are perfectly healthy. That is a false liquidation
-- alarm manufactured out of a missing backfill.
--
-- covered_from_block is the LOW END of the contiguous block range the current
-- derived state was walked over UNDER decoder_revision. It is NOT the engine's
-- configured start block: it is where this code actually began, so a registry
-- change restarts it (see store.DerivationCoverage) and a rewind below it
-- clears it.
--
-- decoder_revision is the decode-registry revision in force for that walk
-- (internal/decode.RegistryRevision).
--
-- THE DEFAULTS ARE THE POINT, AND THEY FAIL CLOSED. Every row that exists when
-- this migration runs was written by a binary that never recorded coverage, so
-- its true provenance is UNKNOWN — and NULL / 0 is exactly how a consumer must
-- read that. An upgraded daemon therefore finds its pre-existing Aave state
-- UNPROVEN and refuses the Aave book until a rewind-and-rederive re-establishes
-- coverage, rather than silently serving the absence-is-truth reading over a
-- ledger that was never walked for those events. A DEFAULT that claimed
-- coverage would have made this migration the bug.
ALTER TABLE derive_cursors
    ADD COLUMN covered_from_block BIGINT,
    ADD COLUMN decoder_revision   INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN derive_cursors.covered_from_block IS
    'Low end of the contiguous block range the current derived state was walked over under decoder_revision. NULL = unknown/unproven (pre-00014 state, or rewound below the covered range).';
COMMENT ON COLUMN derive_cursors.decoder_revision IS
    'internal/decode.RegistryRevision in force for the walk that produced the current derived state. 0 = unknown/unproven.';

-- ENGINE-LEVEL REFUSAL (round-2 [high]).
--
-- DEV-ONLY IN-PLACE EDIT of this same migration, per the 00002 precedent: 00014
-- has only ever been applied to disposable local databases (the live database is
-- at version 12), so it is amended rather than superseded. Cycle a dev db by
-- dropping the four columns this migration adds and deleting goose_db_version's
-- version_id=14 row, then let store.Migrate re-apply. NEVER edit an applied
-- migration once any shared or production database has run it.
--
-- Why a refusal on the AGGREGATE row and not only on positions: a refusal that
-- lives exclusively in `risk_positions` cannot be expressed when there are no
-- positions, and there is a real, scheduled state where that happens. The
-- owner-gated flag replay begins with RewindDerived(StartBlock-1), which deletes
-- every event-sourced Aave balance; a riskd tick landing in that window finds an
-- EMPTY account set over an explicitly UNPROVEN ledger, iterates zero accounts,
-- and would otherwise persist an Aave aggregate of positions=0 /
-- refused_positions=0 / totals=0 — a batch that is structurally complete and
-- reads as "this engine has no risk", which is the false-safety direction and a
-- vacuous green in precisely the repair window.
--
-- These two columns make that state REPRESENTABLE and therefore unable to
-- masquerade: an engine whose custody is unproven carries its refusal on its own
-- rollup row, independent of how many accounts happen to exist. Empty string is
-- "not refused", so every pre-existing row and every healthy engine reads exactly
-- as before.
ALTER TABLE risk_batch_aggregates
    ADD COLUMN refusal_code   TEXT NOT NULL DEFAULT '',
    ADD COLUMN refusal_detail TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN risk_batch_aggregates.refusal_code IS
    'Engine-SCOPED refusal (e.g. FLAG_CUSTODY_UNPROVEN): the whole engine book is withheld regardless of position count. Empty = not refused. An engine with zero positions AND an empty refusal_code is a genuinely empty book; with a code set it is a withheld one, and the two must never be confused.';
COMMENT ON COLUMN risk_batch_aggregates.refusal_detail IS
    'Human-readable reason and remedy for refusal_code.';

-- +goose Down
ALTER TABLE risk_batch_aggregates
    DROP COLUMN refusal_detail,
    DROP COLUMN refusal_code;
ALTER TABLE derive_cursors
    DROP COLUMN decoder_revision,
    DROP COLUMN covered_from_block;
