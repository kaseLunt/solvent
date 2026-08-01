# Mutation transcript — Wave H8 (the readBatchAccounts prune-race sibling)

Durable mutation evidence for the batch read layer's snapshot/cardinality fix
(`cmd/api/read.go` `readBatchAccounts`, plus the store's querier-parameterized
`NewestCompleteBatchQ`) — the shape-sibling of H6b's batch-permalink finding,
promoted from that wave's report-only survey. Both designed mutants live in
`cmd/api/read.go`. Each mutant was designed BEFORE the loop (this spec section
was written and hashed before any mutant was applied; committing is outside
this wave's mandate — IMPLEMENT AND TEST, NEVER COMMIT — so the before-hash
discipline substitutes for the spec-committed-first step). Follows
`wave-h6b.md`.

## Tested tree

- Branch `main`, HEAD `3984995`, PLUS this wave's uncommitted H8 files
  (read.go, main.go's `bookInterleave` seam, internal/store/risk.go's
  `NewestCompleteBatchQ`, book_prune_race_db_test.go).
- Fixed-file sha256 (the before-hash AND the after-restore hash for every
  mutant below):
  - `read.go`
    `3b4f8d753807d5c2ab03a19e4be6b9174919d9dab9ed2d96994faff5e4b425c6`
- Kill-suite command (live scratch DB, `.env` sourced, serialized per the
  house discipline):
  - M1 and M2: `go test ./cmd/api -run 'TestBook' -p 1 -count=1`

## M1 — batch resolution moved back to the pool (spec, designed before the loop)

Spec (behavioural, cut after green): `readBatchAccounts` reverts to resolving
the newest complete batch through `s.store.NewestCompleteBatch(ctx)` on the
POOL, before `BeginRiskSnapshot` opens, with the `bookInterleave` seam fired
between those two statements — the exact pre-H8 shape. The cardinality
refusals STAY in place under this mutant, so the direct cardinality
regression cannot kill it — the kill must come from the interleave regression
`TestBookSurvivesARetentionPruneInterleave`, whose mid-request prune deletes
the resolved batch between the pool resolution and the snapshot: every child
read then returns empty without error, the stamped-engine check passes
vacuously over zero rows, and /v1/book serves `engines: []` with a 200 on the
pruned batch id... EXCEPT that the aggregates-cardinality refusal (kept under
this mutant) now catches that empty read and turns it into a 500 — so the
kill shows as the interleave test's `getJSON` demanding 200 and both engines'
exact rollups, and failing on the refusal instead. Either failure mode — the
empty-book 200 or the cardinality 500 where a whole book was owed — is the
finding's wrong answer; the regression demands the only right one (the
pre-prune batch served WHOLE from one snapshot). Expected kill:
`TestBookSurvivesARetentionPruneInterleave` alone;
`TestBookRefusesACompleteBatchWithNoAggregates` must stay green under the
mutant (the refusal is untouched), proving the in-snapshot resolution is
load-bearing and not shadowed by the cardinality defense.

## M2 — the cardinality refusal dropped (spec, designed before the loop)

Spec: `readBatchAccounts` loses the fail-closed refusal of a COMPLETE batch
whose aggregate rows read back EMPTY inside the serving snapshot (and the
sibling stamp-vector refusal) — the read quietly serves `engines: []` on a
batch whose completeness was already established, which is the H8 wrong
answer for the state no snapshot can repair (a hand-written or torn
"complete" batch with zero aggregate rows). The repeatable-read transaction
AND the in-snapshot batch resolution STAY in place under this mutant, so the
interleave regression alone cannot kill it — the kill must come from the
direct cardinality regression `TestBookRefusesACompleteBatchWithNoAggregates`,
whose hand-written batch passes the store's completeness predicate with zero
aggregate rows (a state only a restore or hand-write can produce) and is
asserted to be the NEWEST complete batch. Expected kill: that test alone; the
interleave test must stay green under the mutant (snapshot isolation still
pins the pre-prune batch whole), proving the cardinality regression is
load-bearing and not shadowed by the transaction.

---

## M1 — RESULT

Mutated-file sha256 (`read.go`):
`9bc79c7f8a1212f735f12141ebc233778c069587bad4f51f402244a6f1c5e63b`

```diff
-	// ONE SNAPSHOT FOR EVERY STAGE, BATCH RESOLUTION INCLUDED (wave H8 …
-	tx, err := s.store.BeginRiskSnapshot(ctx)
-	…
-	batch, found, err := store.NewestCompleteBatchQ(ctx, tx)
-	…
-	// TEST SEAM … after the batch resolution, before the child reads …
+	// MUTANT M1: batch resolution moved back to the POOL — the pre-H8 shape.
+	// The cardinality refusals stay; only the one-snapshot coherence is gone.
+	batch, found, err := s.store.NewestCompleteBatch(ctx)
+	…seam fired between the pool resolution and BeginRiskSnapshot…
```

KILLED (exit 1), and EXACTLY per the spec's shadowing argument — the
cardinality refusals stayed in place, the direct cardinality regression and
the seeded-values control stayed GREEN under the mutant, and the kill came
from the interleave regression alone:

```
--- FAIL: TestBookSurvivesARetentionPruneInterleave (0.28s)
--- PASS: TestBookRefusesACompleteBatchWithNoAggregates (0.26s)
--- PASS: TestBookServesExactSeededValues (0.23s)
```

The kill mode was the spec's predicted ALTERNATE mode: with the refusal kept,
the torn read surfaced as the 500

```
{"error":{"code":"internal","message":"batch 2 passed the completeness
predicate but carries no aggregate rows — refusing to serve a complete batch
as an empty healthy book (a hand-written or torn state)"}}
```

where the regression demands the pre-prune batch served WHOLE with a 200 —
proving the two defenses are complementary, not redundant: without the
in-snapshot resolution an honest retained batch turns into a refused request,
and without the refusal it turns into the empty-book 200.

Restore verified byte-identical (`3b4f8d75…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 1.594s`).

## M2 — RESULT

Mutated-file sha256 (`read.go`):
`ec66f44f2ca6b5ace697f2377d6818145c7f7a939a0005318274eb1ebdac304b`

```diff
-	// FAIL CLOSED ON THE STAMP VECTOR (H6b's second remedy, ported): …
-	if len(batch.Watermarks) == 0 {
-		return nil, fmt.Errorf("batch %d %w", batch.ID, errCompleteBatchNoStamps)
-	}
+	// MUTANT M2: the stamp-vector rejection dropped.
-	// FAIL CLOSED ON CARDINALITY (H6b's second remedy, ported). …
-	if len(v.Aggregates) == 0 {
-		return nil, fmt.Errorf("batch %d %w", batch.ID, errCompleteBatchNoAggregates)
-	}
+	// MUTANT M2: the cardinality rejection dropped — a "complete" batch with
+	// zero aggregate rows quietly serves an empty engines list.
```

KILLED (exit 1), and EXACTLY per the spec's shadowing argument — the
repeatable-read transaction and the in-snapshot resolution stayed in place,
the interleave regression and the seeded-values control stayed GREEN under
the mutant, and the kill came from the direct cardinality regression alone:

```
--- PASS: TestBookSurvivesARetentionPruneInterleave (0.30s)
--- FAIL: TestBookRefusesACompleteBatchWithNoAggregates (0.24s)
--- PASS: TestBookServesExactSeededValues (0.22s)
```

The served wrong answer under the mutant was the finding verbatim — a 200 on
the hand-restored "complete" batch with `"refused_engines":[],"engines":[]`
and an all-empty histogram/waterfall — where the regression demands the 500
naming "no aggregate rows".

Restore verified byte-identical (`3b4f8d75…`); kill suite green after restore
(`ok github.com/kaselunt/solvent/cmd/api 1.572s`).

## Verdict

2/2 designed mutants KILLED, zero survivors, every restore verified
byte-identical by sha256. `go build ./...`,
`go vet ./cmd/api/... ./internal/store/...` and the full serialized
`go test -p 1 ./cmd/api/... ./internal/store/... -count=1` run are recorded
in the wave report on the final restored tree. Known environmental
exception, unrelated to this wave: TestEvidenceServesTheDeployBoundManifest,
TestEvidenceTwoSubjectsSplit and TestEvidenceLiveSubjectNoBatchIsAFirstClass-
State fail on the dispatch tree because the working copy of
`roadmap/evidence/artifacts/w1-reconcile/drift-report.{json,txt}` carries
uncommitted local modifications (present in `git status` at dispatch; HEAD's
copy says `result: pass`, the modified copy says `result: fail`, and these
tests assert the COMMITTED receipt verbatim). They fail identically with and
without the H8 change.
