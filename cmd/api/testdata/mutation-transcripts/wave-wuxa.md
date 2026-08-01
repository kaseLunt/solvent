# Mutation transcript — wave W-UX-A (contract 1.3.0: dir + min_value + limit 1000)

Durable mutation evidence for the /v1/positions contract train: `min_value`
(the exclusion law), `dir` (canonical-direction reversal), and the extended
cursor binding (engine, sort, dir, min_value). Three behavioural mutants, each
designed BEFORE the loop, each the "helpful-looking" version of a bug this
wave's laws exist to forbid. All three live in
`internal/store/p5_positions_page.go` — the one file that owns the exclusion
predicate, the direction resolution and the cursor binding. Follows
`p5-c2.md`.

## Tested tree

- Branch `main`, HEAD `e794bb06` (dispatch HEAD `98faf77` plus intervening
  landings), PLUS this wave's uncommitted W-UX-A files (api/openapi.yaml
  1.3.0, internal/store/p5_positions_page.go + tests, cmd/api/p5_positions.go
  + main.go + tests, the regenerated packages/client-ts). NOTE: the tree
  concurrently carries the parallel web wave's uncommitted work in `web/**`
  and pre-existing `cmd/reconcile/**` changes (disjoint from every file
  below).
- Fixed-file sha256 (the before-hash AND the after-restore hash for every
  mutant below — every restore verified byte-identical):
  - `internal/store/p5_positions_page.go`
    `3da12e2650d05d8300b603b9e7fc5c2cc5a6f2704de852cdba99914ceebf08ce`
- Kill-suite commands (live scratch DB, `TEST_DATABASE_URL` → `solvent_test`,
  serialized per the house discipline):
  - M1: `go test ./internal/store -run 'TestPositionsPageMinValueExclusionLaw' -p 1 -count=1`
  - M2: `go test ./internal/store -run 'TestPositionsPageDirReversesEachSortWithAccountTiebreakStillAsc' -p 1 -count=1`
  - M3: `go test ./internal/store -run 'TestPositionsPageCursorBindsDirAndMinValue' -p 1 -count=1`

## The designed mutants (spec cut BEFORE the loop)

### M1 — the refused-never-excluded arm dropped

Spec: `positionsQualifyPredicate` loses its `p.status = 'computed'` conjunct
— the filter becomes "exclude any row whose non-null totals sit below the
floor", the plausible reading of a size filter. Its lie is exactly the
never-excluded law: a REFUSED row that happens to carry dust-sized persisted
totals is then hidden by `min_value`, and the size filter has silently
un-counted a position the book could not honestly value. Kill expected from
the refused-dust regression (`p5BookWithDustRefusal`'s account 06 must stay
on the page and in the qualifying count).

### M2 — dir ignored (every walk canonical)

Spec: the direction resolution stops honoring the caller's dir and resolves
EVERY request to the sort's canonical direction — the "the default is
probably what they want" shortcut. Kill expected from the reversal
regressions (aave debt asc, dm liq_distance desc, etc.: the reversed
rankings never materialize).

### M3 — the cursor stops binding min_value

Spec: the cursor-mismatch check drops its `fields[4] != minValue` conjunct —
a cursor minted under one min_value replays cleanly under another (or under
none), silently walking rank N of a DIFFERENT qualifying set. Kill expected
from the binding regression (presenting the desc/min_value cursor under a
different or absent min_value must be ErrPositionsCursorMismatch).

---

## M1 — RESULT

Mutated-file sha256:
`120044773bc1fa577e540cceaf5bd98cecc303ee2ba9ece7c1f9acc211968dff`

```diff
-	return fmt.Sprintf(`NOT (p.status = 'computed'
-				  AND %[1]s IS NOT NULL AND %[2]s IS NOT NULL
+	// MUTANT M1: the "size filter is a size filter" shortcut — any row with
+	// non-null totals below the floor is excluded, refused or not.
+	return fmt.Sprintf(`NOT (%[1]s IS NOT NULL AND %[2]s IS NOT NULL
 				  AND GREATEST(%[1]s, %[2]s) < $%[3]d::numeric)`, cols.coll, cols.debt, minValueIdx)
```

KILLED (exit 1) by `TestPositionsPageMinValueExclusionLaw`:

```
--- FAIL: TestPositionsPageMinValueExclusionLaw (1.07s)
    Error Trace: p5_positions_page_test.go:398
    Error:	Not equal:
          	expected: []string{"01", "02", "03", "04", "06"}
          	actual  : []string{"01", "02", "03", "04"}
    (the REFUSED dust-total row 06 was excluded by the size floor)
```

Restore verified byte-identical (`3da12e26…`).

## M2 — RESULT

Mutated-file sha256:
`27128bc5cc31e81b1ac6e7b7b8b88221c424644a239f09debcaf7e82fd4447fb`

```diff
 	switch dir {
 	case PositionDirCanonical:
 		dir = positionsCanonicalDir[sort]
 	case PositionDirAsc, PositionDirDesc:
+		// MUTANT M2: the caller's direction is ignored — every walk serves
+		// the sort's canonical ranking.
+		dir = positionsCanonicalDir[sort]
 	default:
```

KILLED (exit 1) by `TestPositionsPageDirReversesEachSortWithAccountTiebreakStillAsc`:

```
--- FAIL: TestPositionsPageDirReversesEachSortWithAccountTiebreakStillAsc (0.87s)
    --- FAIL: …/aave_liq_distance_desc  expected [04 03 02 01 05], actual [01 05 02 03 04]
    --- FAIL: …/aave_hf_desc            expected [04 03 02 01 05], actual [01 05 02 03 04]
    --- FAIL: …/aave_debt_asc           expected [04 03 05 01 02], actual [02 01 05 03 04]
    --- FAIL: …/aave_status_asc         expected [03 02 01 05 04], actual [04 01 05 02 03]
    --- FAIL: …/dm_liq_distance_desc    expected [13 16 12 11],    actual [11 12 16 13]
    --- FAIL: …/dm_debt_asc             expected [13 16 12 11],    actual [11 12 16 13]
    --- FAIL: …/dm_status_asc           expected [16 12 11 13],    actual [13 11 12 16]
    (ALL SEVEN reversal subtests failed identically: the canonical order
    served under an explicit non-canonical dir)
```

Restore verified byte-identical (`3da12e26…`).

## M3 — RESULT

Mutated-file sha256:
`7a8449bf0674b97a063420cd47b0ba4a673c2547ed3a04fd009c92f0de9227c9`

```diff
-		if cursorBatch != batchID || fields[1] != engine || fields[2] != string(sort) || fields[3] != string(dir) || fields[4] != minValue {
+		// MUTANT M3: the cursor stops binding min_value — a rank minted over
+		// one qualifying set replays into another.
+		if cursorBatch != batchID || fields[1] != engine || fields[2] != string(sort) || fields[3] != string(dir) {
```

KILLED (exit 1) by `TestPositionsPageCursorBindsDirAndMinValue`:

```
--- FAIL: TestPositionsPageCursorBindsDirAndMinValue (0.57s)
    Error Trace: p5_positions_page_test.go:469
    Error:	Target error should be in err chain:
          	expected: "positions page: cursor does not match the requested batch/engine/sort"
          	in chain:
    (line 469 is the "different min_value" arm: the cursor minted under
    min_value=300000000000 replayed cleanly under 300000000001 — no
    mismatch was raised)
```

Restore verified byte-identical (`3da12e26…`).

## Verdict

3/3 designed mutants KILLED, zero survivors, every restore verified
byte-identical by sha256 (`3da12e26…`). `go build ./...` green after the
final restore; the full serialized `go test -p 1 ./cmd/api/...
./internal/store/... -count=1` run (green) is recorded in the wave report.
