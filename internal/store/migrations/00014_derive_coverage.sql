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
    ADD COLUMN decoder_revision   INT NOT NULL DEFAULT 0,
    -- coverage_binding identifies WHAT WAS WALKED: a digest over the engine's chain
    -- and the (address, startBlock) pairs of its streams (store.CoverageBindingOf).
    --
    -- The other two columns answer "from when, by which decoder" and cannot answer
    -- "over which contracts". That gap was a live hole with no loud failure: an
    -- operator who ADDS an Aave aToken stream at the audited genesis leaves the
    -- engine cursor at head, so the runner never walks history for the new address
    -- (it resumes at H+1) while the inherited covered_from_block still reads
    -- "genesis" under an unchanged decoder revision. Every gate passed and riskd
    -- would serve a book missing that stream's entire history.
    --
    -- Empty string is "no claim", exactly as decoder_revision 0 is, so every
    -- pre-existing row stays UNPROVEN under the same fail-closed default.
    ADD COLUMN coverage_binding   TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN derive_cursors.covered_from_block IS
    'Low end of the contiguous block range the current derived state was walked over under decoder_revision. NULL = unknown/unproven (pre-00014 state, or rewound below the covered range).';
COMMENT ON COLUMN derive_cursors.coverage_binding IS
    'Digest over the engine chain + sorted (address, startBlock) pairs actually walked (store.CoverageBindingOf). Empty = unknown/unproven. A reader must require it to equal the binding the LIVE config implies: inherited coverage cannot vouch for a contract it never read.';
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

-- LEGACY AAVE ROLLUPS FAIL CLOSED (round-3 [medium]).
--
-- The DEFAULT above is the right answer for rows written AFTER this migration and
-- the WRONG answer for rows written before it. This same migration has just
-- declared every pre-existing derive cursor coverage-UNKNOWN — so an Aave batch
-- that predates it was computed by a binary whose flag-ledger provenance cannot be
-- established, and an empty refusal_code on it would AFFIRM it as healthy. That is
-- not a neutral default; it is a claim, and it is one this migration is in no
-- position to make.
--
-- It matters on the ordinary v13→v14 upgrade path, not only in the replay window:
-- `NewestCompleteBatch` will happily return the newest legacy batch with
-- RefusedEngines empty until a replacement pass runs, and INDEFINITELY if that pass
-- is gated (a required cursor missing, an unacked epoch) or simply fails. A
-- committed consumer reading during that gap gets the wrong answer.
--
-- SCOPED TO THE AAVE ENGINE, DELIBERATELY. Coverage is nulled for every cursor, but
-- it is a PRECONDITION only for a law that reads ABSENCE as chain truth, and Aave's
-- collateral flag is the only one. The Debt Manager's params come from its own
-- position_events where a MISSING row already refuses per position, so its legacy
-- rollups are not unproven and blanket-refusing them would withhold a correct book.
--
-- The engine name is a literal here, which couples this migration to
-- internal/risk.AaveEngine. That coupling is intentional and cheap to honour: a
-- SECOND engine that ever reads absence as truth must add itself to this list, and
-- riskfeed's TestAggregateRefusalVocabularyIsClosed is the reminder.
--
-- Rows written after this point are never touched: the UPDATE runs once, and the
-- current binary always writes an explicit value.
UPDATE risk_batch_aggregates
   SET refusal_code   = 'FLAG_CUSTODY_UNPROVEN',
       refusal_detail = 'engine aave_v3_etherfi was rolled up by a binary that recorded no '
                     || 'derivation-coverage provenance (pre-migration-00014), so its flag ledger '
                     || 'cannot be shown to have been walked from the engine start block under a '
                     || 'decode registry that includes the ReserveUsedAsCollateral* events. This '
                     || 'batch is therefore NOT affirmed healthy. Re-derive the engine from its '
                     || 'start block (rewind-and-rederive) and let riskd rematerialize.'
 WHERE engine = 'aave_v3_etherfi';

-- +goose Down
ALTER TABLE risk_batch_aggregates
    DROP COLUMN refusal_detail,
    DROP COLUMN refusal_code;
ALTER TABLE derive_cursors
    DROP COLUMN coverage_binding,
    DROP COLUMN decoder_revision,
    DROP COLUMN covered_from_block;
