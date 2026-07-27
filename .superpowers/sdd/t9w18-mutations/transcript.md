# mutation transcript

- spec: `mutations.json`
- repo: `C:\wt-t9w18-mut`
- **tested SHA: `748c09df9562477ff8d692a465ff44f269e02617`**  (test(sdd): task-9 wave-18 mutation spec committed BEFORE the loop (1 mutant: the witness-scoped conjunct restored; killed only by the round-17 fall-through regression))
- started (UTC): 2026-07-27T04:44:15+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W18M1 — the servedBy != incumbent conjunct restored (revert to the wave-17 witness-scoped deviation)

**Property under attack:** R15-6 UNQUALIFIED (the round-17 adjudication, wave 18's one fix): a cursor mismatch on a probe Step is a DISCARD regardless of which endpoint served it - the refusal applies whenever probing is true, full stop. Restoring wave 17's 'servedBy.Index != incumbent' conjunct re-opens the reviewer's exact fall-through path: the probe target fails the head read, resolution wraps to the incumbent, probing remains true yet the conjunct is false, and the Step calls rewindToVerifiedAncestor / store.Rewind - the destructive probe-Step path (delete + re-ingest a suffix, derived reorg churn) that the adjudication closed without exception.

```diff
--- internal/ingest/walker.go:739
-			if probing { // no exceptions, no witness attribution (round 17)
+			if probing && servedBy.Index != incumbent { // W18M1: the wave-17 witness-scoped refusal restored
```
APPLIED at internal/ingest/walker.go:739 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep`

Killed by:
  - `TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `748c09d`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W18M1 | **KILLED** | R15-6 UNQUALIFIED (the round-17 adjudication, wave 18's one fix): a cursor mismatch on a probe Step is a DISCARD regardless of which endpoint served it - the refusal applies whenever probing is true, full stop. Restoring wave 17's 'servedBy.Index != incumbent' conjunct re-opens the reviewer's exact fall-through path: the probe target fails the head read, resolution wraps to the incumbent, probing remains true yet the conjunct is false, and the Step calls rewindToVerifiedAncestor / store.Rewind - the destructive probe-Step path (delete + re-ingest a suffix, derived reorg churn) that the adjudication closed without exception. | `TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep` |

1 mutants, 1 killed, 0 survived.
