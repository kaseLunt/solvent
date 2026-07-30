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

-- +goose Down
ALTER TABLE derive_cursors
    DROP COLUMN decoder_revision,
    DROP COLUMN covered_from_block;
