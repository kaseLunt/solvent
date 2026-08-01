# Mutation transcript — Wave H6b (Codex round-5 findings 2 and 4)

Durable mutation evidence for the batch-permalink snapshot/cardinality fix
(`cmd/api/p5_batches.go`, finding 2) and the merged-allOf sweep-law walker
(`cmd/api/contract_sweep_law_test.go`, finding 4). Two of the wave's three
designed mutants live in this package (the third, M2, mutates
`internal/store/migrations/00019_*.sql` and is transcribed in
`internal/store/testdata/mutation-transcripts/wave-h6b.md`). Each mutant was
designed BEFORE the loop (this spec section was written and hashed before any
mutant was applied; committing is outside this wave's mandate — IMPLEMENT AND
TEST, NEVER COMMIT — so the before-hash discipline substitutes for the
spec-committed-first step). Follows `wave-h4b.md`.

## Tested tree

- Branch `main`, HEAD `7927216`, PLUS this wave's uncommitted H6b files
  (p5_batches.go, p5_batches_prune_race_db_test.go, contract_sweep_law_test.go,
  the 00019 migration + its upgrade test, and the three schema-version welds).
- Fixed-file sha256 (the before-hash AND the after-restore hash for every
  mutant below):
  - `p5_batches.go`
    `79ccbbc93944c683d28361499aa3a9cb1888b8ecc12758c820468eb2b93ac4fb`
  - `contract_sweep_law_test.go`
    `03eb02f471e24c0b957cfd407d480503bd2207aea175bde93e31ae0735a2e9e2`
- Kill-suite commands (live scratch DB, `.env` sourced, serialized per the
  house discipline):
  - M1: `go test ./cmd/api -run 'TestBatchPermalink' -p 1 -count=1`
  - M3: `go test ./cmd/api -run 'TestLiquidatableDisclosureLaw' -p 1 -count=1`

## M1 — the cardinality rejection dropped (spec, designed before the loop)

Spec (behavioural, cut after green): `handleBatch` loses the fail-closed
refusal of a COMPLETE batch whose aggregate rows (or watermark vector) read
back EMPTY inside the serving snapshot — the handler quietly reverts to
serving `aggregates: []` on a batch whose completeness was already
established, which is exactly the round-5 finding-2 wrong answer (a
"complete" book that reads as no book at all). The repeatable-read
transaction STAYS in place under this mutant, so the interleave regression
alone cannot kill it — the kill must come from the direct cardinality
regression `TestBatchPermalinkRefusesACompleteBatchWithNoAggregates`, whose
hand-written batch passes the store's completeness predicate with zero
aggregate rows (a state only a restore or hand-write can produce). Expected
kill: that test alone; the interleave test and the servability suite must
stay green under the mutant, proving the cardinality regression is
load-bearing and not shadowed by the transaction.

## M3 — per-arm allOf analysis restored (spec, designed before the loop)

Spec: `sweepState.walk` reverts to the pre-H6b shape — the license transition
(attach/re-clock) is computed from the node's OWN `Required` list only, and
each `allOf` member is visited independently with the inherited license, no
merged required/properties view. This is the exact round-5 finding-4 bypass:
a schema that splits `batch_id` into one allOf arm and a bare
`liquidatable_positions` into a sibling arm is self-clocked once merged, but
no single arm both re-clocks and carries the count, so the walk keeps the
outer envelope's license and the law passes vacuously. Expected kill:
`TestLiquidatableDisclosureLawMergesAllOfArmsBeforeLicensing` (the sibling-arm
negative control) alone — the whole-contract sweep, the union-arm control,
the nullable-hop control and the emptyable-array control must stay green
under the mutant, proving the merged analysis is load-bearing.

---

## M1 — RESULT

Mutated-file sha256 (`p5_batches.go`):
`8c8f651aa8f43f2e43b5ade15307c36dbd5b214fad26aeaeb5cba3daad134423`

```diff
-		// FAIL CLOSED ON CARDINALITY (finding 2's second remedy). …
-		if len(aggs) == 0 {
-			writeError(w, http.StatusInternalServerError, codeInternal,
-				"batch "+strconv.FormatInt(id, 10)+" passed the completeness predicate but carries no aggregate rows — …", nil)
-			return
-		}
-		if len(vectors[id]) == 0 {
-			writeError(w, http.StatusInternalServerError, codeInternal,
-				"batch "+strconv.FormatInt(id, 10)+" passed the completeness predicate but carries no watermark stamps — …", nil)
-			return
-		}
+		// MUTANT M1: the cardinality rejection dropped — a "complete" batch
+		// with zero aggregate rows quietly serves `aggregates: []`.
```

KILLED (exit 1), and EXACTLY per the spec's shadowing argument — the
transaction stayed in place, the interleave regression and the whole
servability suite stayed GREEN under the mutant, and the kill came from the
direct cardinality regression alone:

```
--- PASS: TestBatchPermalinkSurvivesARetentionPruneInterleave (0.37s)
--- FAIL: TestBatchPermalinkRefusesACompleteBatchWithNoAggregates (0.45s)
--- PASS: TestBatchPermalinkNewestServable (0.43s)
--- PASS: TestBatchPermalinkSupersededBatchStaysResolvable (0.46s)
--- PASS: TestBatchPermalinkPrunedIdIsARetentionDisclosure (0.57s)
--- PASS: TestBatchPermalinkIncompleteBatchWithholdsAggregates (0.41s)
--- PASS: TestBatchPermalinkWithheldEngineAggregateIsRefusedNeverZero (2.47s)
--- PASS: TestBatchPermalinkParameterRefusals (0.58s)
```

Restore verified byte-identical (`79ccbbc9…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 5.157s`).

## M3 — RESULT

Mutated-file sha256 (`contract_sweep_law_test.go`):
`cad9882d1f442f5a4c6ccb152dab5554339cde45d32b29e59591d18eee2094c8`

The mutant replaced `flattenAllOf` + the merged walk with the pre-H6b walk
verbatim (license transition from the node's own Required list; allOf members
visited independently with the inherited license). As designed, EVERY other
law test stayed green under it — the whole-contract sweep, the bare-boolean
control, the Codex-finding regression, the emptyable-array control, the
nullable-hop control and the union-arm control — which is precisely the
round-5 vacuous pass. KILLED (exit 1) by the sibling-arm control alone:

```
--- PASS: TestLiquidatableDisclosureLawSweepsTheWholeContract (0.03s)
--- PASS: TestLiquidatableDisclosureLawCatchesABareBoolean (0.03s)
--- PASS: TestLiquidatableDisclosureLawDerivesTheCodexFinding (0.02s)
--- PASS: TestLiquidatableDisclosureLawRefusesAnEmptyableWatermarkArray (0.02s)
--- PASS: TestLiquidatableDisclosureLawRefusesANullableCarrierHop (0.02s)
--- PASS: TestLiquidatableDisclosureLawChecksEachUnionArmIndependently (0.02s)
--- FAIL: TestLiquidatableDisclosureLawMergesAllOfArmsBeforeLicensing (0.02s)
```

Restore verified byte-identical (`03eb02f4…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 1.396s`).

## Verdict

2/2 designed mutants in this package KILLED (the wave's third, M2, is killed
in `internal/store/testdata/mutation-transcripts/wave-h6b.md` — 3/3 overall),
zero survivors, every restore verified byte-identical by sha256.
`go build ./...`, `go vet ./cmd/api/... ./internal/store/...`, the full
`go test -p 1 ./cmd/api/... -count=1` run (`ok … 79.435s`) and the full
`go test -p 1 ./internal/store/... -count=1` run (`ok … 267.699s`) are green
on the final restored tree (recorded in the wave report).
