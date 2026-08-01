-- +goose Up
-- Wave H6b (Codex round-5 finding 3): the 00018 sweep-stamp CHECK is VACUOUS
-- against an illegal FOURTH state, and this migration re-adds it two-valued.
-- FORWARD migration only; 00018 is applied to the live database and is not
-- edited in place (00003 incident law — a scratch DB re-derived from an
-- edited applied migration silently diverges from live).
--
-- WHAT 00018 ADMITTED. PostgreSQL CHECK constraints pass on UNKNOWN, and
-- 00018's second and third disjuncts are spelled over a bare
-- `sweep_applicable`. For a row with sweep_applicable = NULL and a POPULATED
-- stamp payload the three disjuncts evaluate false / UNKNOWN / false, the OR
-- is UNKNOWN, and the row is ADMITTED — a state outside the three the header
-- declared legal (UNRECORDED / NO SWEEPER / STAMPED). The store reader keys
-- on applicability alone, so it reports such a row as UNRECORDED while a
-- populated stamp sits under it: recorded data, served as data that does not
-- exist.
--
-- THE FIX IS SPELLING, NOT SEMANTICS. `x IS TRUE` / `x IS FALSE` are
-- two-valued (NULL IS TRUE = false, never UNKNOWN), so with them the whole
-- CHECK is two-valued and the fourth state fails every disjunct and is
-- REJECTED. The three legal states are unchanged, including 00013's
-- sweep_max_updated_at carve-out on the STAMPED arm (a swept engine with
-- zero attempted accounts has no most-recent write).
--
-- ADD CONSTRAINT VALIDATES EXISTING ROWS, DELIBERATELY. No honest writer can
-- have produced the fourth state (the 00016 rollup writer and the 00018
-- backfill both copy sweep_applicable from risk_batch_watermarks, where it
-- is NOT NULL) — so if this migration fails on existing rows, the database
-- holds hand-written or torn state and the failure is the disclosure, not a
-- nuisance to be COALESCEd away.
ALTER TABLE observatory_points
    DROP CONSTRAINT observatory_points_sweep_all_or_nothing;
ALTER TABLE observatory_points
    ADD CONSTRAINT observatory_points_sweep_all_or_nothing CHECK (
        (sweep_applicable IS NULL AND sweep_rows IS NULL
                                  AND sweep_failed IS NULL
                                  AND sweep_success_sum IS NULL
                                  AND sweep_max_updated_at IS NULL
                                  AND sweep_generation IS NULL
                                  AND sweep_generation_open IS NULL)
        OR
        (sweep_applicable IS TRUE AND sweep_rows IS NOT NULL
                                  AND sweep_failed IS NOT NULL
                                  AND sweep_success_sum IS NOT NULL
                                  AND sweep_generation IS NOT NULL
                                  AND sweep_generation_open IS NOT NULL)
        OR
        (sweep_applicable IS FALSE AND sweep_rows IS NULL
                                   AND sweep_failed IS NULL
                                   AND sweep_success_sum IS NULL
                                   AND sweep_max_updated_at IS NULL
                                   AND sweep_generation IS NULL
                                   AND sweep_generation_open IS NULL)
    );

-- +goose Down
-- The 00018 form, verbatim — down restores the prior (vacuous) constraint
-- rather than inventing a third variant.
ALTER TABLE observatory_points
    DROP CONSTRAINT observatory_points_sweep_all_or_nothing;
ALTER TABLE observatory_points
    ADD CONSTRAINT observatory_points_sweep_all_or_nothing CHECK (
        (sweep_applicable IS NULL AND sweep_rows IS NULL
                                  AND sweep_failed IS NULL
                                  AND sweep_success_sum IS NULL
                                  AND sweep_max_updated_at IS NULL
                                  AND sweep_generation IS NULL
                                  AND sweep_generation_open IS NULL)
        OR
        (sweep_applicable AND sweep_rows IS NOT NULL
                          AND sweep_failed IS NOT NULL
                          AND sweep_success_sum IS NOT NULL
                          AND sweep_generation IS NOT NULL
                          AND sweep_generation_open IS NOT NULL)
        OR
        (NOT sweep_applicable AND sweep_rows IS NULL
                              AND sweep_failed IS NULL
                              AND sweep_success_sum IS NULL
                              AND sweep_max_updated_at IS NULL
                              AND sweep_generation IS NULL
                              AND sweep_generation_open IS NULL)
    );
