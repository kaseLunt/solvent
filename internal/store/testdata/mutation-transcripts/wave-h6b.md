# Mutation transcript — Wave H6b, store half (Codex round-5 finding 3)

Durable mutation evidence for migration 00019 (the observatory sweep CHECK
re-added with IS TRUE / IS FALSE semantics so NULL applicability with any
populated stamp payload is REJECTED — the 00018 form admitted it because a
CHECK evaluating to UNKNOWN passes). One designed mutant lives in this
package; the wave's other two (M1, M3) live in `cmd/api` and are transcribed
in `cmd/api/testdata/mutation-transcripts/wave-h6b.md`. Designed BEFORE the
loop (this spec section was written and hashed before the mutant was applied;
committing is outside this wave's mandate — IMPLEMENT AND TEST, NEVER COMMIT —
so the before-hash discipline substitutes for the spec-committed-first step).
Follows `h5b.md`.

## Tested tree

- Branch `main`, HEAD `7927216`, PLUS this wave's uncommitted H6b files.
- Fixed-file sha256 (the before-hash AND the after-restore hash):
  - `migrations/00019_observatory_sweep_check_states.sql`
    `7543058004b783de711d7ec6244f449ee99fe8d13995db518a329e522b5f6de6`
- Kill-suite command (live scratch DB, `.env` sourced, serialized):
  - M2: `go test ./internal/store -run 'TestMigrate00019' -p 1 -count=1`

## M2 — the 00019 constraint reverted to the 00018 form (spec, designed before the loop)

Spec: 00019's re-added `observatory_points_sweep_all_or_nothing` CHECK loses
its `IS TRUE` / `IS FALSE` spellings and reverts to the 00018 disjuncts
(`sweep_applicable AND …` / `NOT sweep_applicable AND …`). Under SQL
three-valued logic the whole CHECK then evaluates UNKNOWN for a row with
`sweep_applicable = NULL` and a populated stamp payload, and PostgreSQL
admits it — the illegal fourth state the store reader would misreport as
"unrecorded" while silently ignoring a populated stamp. The migration still
applies cleanly and every positive-state test stays green under this mutant
(the three legal states satisfy both forms), so the kill must come from the
negative regressions alone:
`TestMigrate00019RefusesNullApplicabilityWithPopulatedStamp` (full payload
under NULL applicability REJECTED; partial payload under NULL applicability
REJECTED). Expected kill: those negative assertions and ONLY those — proving
the IS TRUE / IS FALSE semantics are load-bearing, not decorative.

---

## M2 — RESULT

Mutated-file sha256 (`migrations/00019_observatory_sweep_check_states.sql`):
`9e0efea24da008f8e1dd79ef48c37c938badc5bb6523f2c3f95c6fcaf34dcccb`

```diff
-        (sweep_applicable IS TRUE AND sweep_rows IS NOT NULL
+        (sweep_applicable AND sweep_rows IS NOT NULL
 …
-        (sweep_applicable IS FALSE AND sweep_rows IS NULL
+        (NOT sweep_applicable AND sweep_rows IS NULL
```

The mutated migration APPLIED CLEANLY (fresh scratch schema, migrateUpTo 18 →
Migrate to 19) and the version assertion and every positive-state assertion
passed under it, exactly as the spec predicted — the three legal states
satisfy both spellings. KILLED (exit 1) by the negative regression alone:

```
--- FAIL: TestMigrate00019RefusesNullApplicabilityWithPopulatedStamp (1.64s)
    migrate_upgrade_observatory_sweep_states_test.go:101:
        An error is expected but got nil.
        NULL sweep_applicable with a FULLY populated stamp payload must be
        REJECTED: unrecorded means the record does not exist, and a populated
        stamp under it is a row the reader would silently misreport as
        unrecorded
```

(the same insert the RED run proved ADMITTED at the 00018 baseline — the
mutant reproduces the original defect byte-for-byte in behaviour).

Restore verified byte-identical (`75430580…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/internal/store 1.883s`).

## Verdict

1/1 designed mutant in this package KILLED (the wave's other two, M1 and M3,
are killed in `cmd/api/testdata/mutation-transcripts/wave-h6b.md` — 3/3
overall), zero survivors, restore verified byte-identical by sha256. The full
`go test -p 1 ./internal/store/... -count=1` run is green on the final tree
(`ok … 267.699s`, recorded in the wave report).
