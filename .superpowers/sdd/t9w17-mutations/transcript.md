# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `93334b23ff0f55db8ff4156d1ae7d8d2dc0ba280`**  (test(sdd): task-9 wave-17 mutation spec committed BEFORE the loop (10 mutants: consult rows R-A..R-G + wave-14 trio re-anchored))
- started (UTC): 2026-07-27T03:57:45+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W17M1 — caught-up probe leaves the armed lease untouched (revert R15-1)

**Property under attack:** R15-1 (consult row R-A): a CAUGHT-UP probe is REJECTED - the lease re-arms in full and the armed state lives exactly ONE Step. Reverting to the wave-14 shape (caught-up leaves the armed lease untouched) restores the frozen-neighbour capture: every subsequent Step probes the frozen peer, returns caught-up forever, the cursor freezes while the healthy incumbent is never revisited.

```diff
--- internal/ingest/walker.go:657
-				w.rejectProbe("caught-up")
+				_ = incumbent // W17M1: caught-up probe leaves the armed lease untouched (wave-14 shape)
```
APPLIED at internal/ingest/walker.go:657 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestFrozenNeighbourCaughtUpProbeIsRejectedAndTheLeaseReArms`

Killed by:
  - `TestFrozenNeighbourCaughtUpProbeIsRejectedAndTheLeaseReArms`

**Result: KILLED**

## W17M2 — fall-through probe keeps the lease spent (revert R15-2a)

**Property under attack:** R15-2a (consult row R-B): a FALL-THROUGH probe (the walk answered from the incumbent because the probed neighbour was down/hung) re-arms the lease in full - the liveness owed a recovering neighbour is paid ONCE per spent lease. Reverting (lease stays spent) re-probes the hung neighbour EVERY Step and pays its attempt timeout every Step: finding 2's ~17-minute round.

```diff
--- internal/ingest/walker.go:506
-		w.rejectProbe("fall-through")
+		// W17M2: fall-through keeps the lease spent (wave-14 shape restored)
```
APPLIED at internal/ingest/walker.go:506 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease`

Killed by:
  - `TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease`

**Result: KILLED**

## W17M3 — witness-less total failure resets the lease

**Property under attack:** R15-2b (consult row R-C, mutant i): the witness-less arm PRESERVES the lease - a total resolution failure is evidence about nobody, and the landings on either side of it are still consecutive landings on the retained endpoint. Resetting instead lets a flapping network (one blip every < MaxConsecutiveSlowLandings landings) suppress probes forever with no compensating routing move.

```diff
--- internal/ingest/walker.go:676
-				return // witness-less: startPref and the lease survive untouched (ledger :80 antecedent unsatisfied)
+				w.slowLandings, w.slowBaseline = 0, 0; return // W17M3: witness-less resets the lease
```
APPLIED at internal/ingest/walker.go:676 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestWitnessLessFailurePreservesTheLeaseMidSpend|TestWitnessLessFailureWhileArmedPreservesTheArmedProbe`

Killed by:
  - `TestWitnessLessFailurePreservesTheLeaseMidSpend`
  - `TestWitnessLessFailureWhileArmedPreservesTheArmedProbe`

**Result: KILLED**

## W17M4 — witness-less guard deleted: total failure flows into the witnessed non-landing arm

**Property under attack:** R15-2b (consult row R-C, adjacent killable shape of mutant ii): witness-less Steps take the WITNESS-LESS arm, never the witnessed non-landing advance. Deleting the guard routes the -1 token through routeNextStepPastNonLanding - startPref is dragged to endpoint 0 by a failure that named no witness, and the lease is reset on top (the schedule pins an incumbent at endpoint 1 so the mis-advance is visible).

```diff
--- internal/ingest/walker.go:666
-			if servedBy.Index < 0 {
+			if false { // W17M4: witness-less failures take the witnessed-non-landing arm
```
APPLIED at internal/ingest/walker.go:666 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestWitnessLessFailurePreservesTheLeaseMidSpend|TestWitnessLessFailureWhileArmedPreservesTheArmedProbe`

Killed by:
  - `TestWitnessLessFailurePreservesTheLeaseMidSpend`
  - `TestWitnessLessFailureWhileArmedPreservesTheArmedProbe`

**Result: KILLED**

## W17M5 — adjudicate on the whole-Step wall (revert R15-3; re-includes store time, R15-4)

**Property under attack:** R15-3/R15-4 (consult rows R-D and R-E): adjudication is on the SERVING WITNESS'S OWN sigma-attempts, never the Step wall. On wall, (a) a five-times-faster third endpoint behind a hung neighbour is judged 'no faster' forever (finding 3 half one), (b) an adopted endpoint inherits a slow landing from the neighbour's hang (half two), and (c) slow store commits arm the lease although no endpoint is at fault (finding 4 - store time enters via wall, never via sigma).

```diff
--- internal/ingest/walker.go:649
-			w.recordLanding(servedBy, served, wall, probing, incumbent)
+			w.recordLanding(servedBy, wall, wall, probing, incumbent) // W17M5: wall adjudication
```
APPLIED at internal/ingest/walker.go:649 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall|TestSlowStoreCommitsNeverArmTheLease`

Killed by:
  - `TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall`
  - `TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall/adopted_despite_the_walk_wall_exceeding_the_baseline`
  - `TestSlowStoreCommitsNeverArmTheLease`

**Result: KILLED**

## W17M6 — probe rewind authority restored (revert R15-6)

**Property under attack:** R15-6 (consult row R-F): a probe Step carries NO rewind authority - a cursor-hash mismatch reported by a probed witness is a DISCARD, and store.Rewind is never called on that witness's sole word. Restoring the authority lets an unvetted neighbour on a minority view trigger a destructive rewind (and be adopted off the churn it caused) once per spent lease.

```diff
--- internal/ingest/walker.go:736
-			if probing && servedBy.Index != incumbent {
+			if false { // W17M6: probe rewind authority restored
```
APPLIED at internal/ingest/walker.go:736 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestProbedWitnessCursorMismatchDiscardsInsteadOfRewinding|TestGenuineReorgRewindsOnTheIncumbentStepNotTheProbeStep`

Killed by:
  - `TestGenuineReorgRewindsOnTheIncumbentStepNotTheProbeStep`
  - `TestProbedWitnessCursorMismatchDiscardsInsteadOfRewinding`

**Result: KILLED**

## W17M7 — probe-target cursor never advances (revert R15-7)

**Property under attack:** R15-7 (consult row R-G): every rejected probe ADVANCES the probe-target cursor, so a rejected-but-non-failing neighbour cannot shield the peers behind it and the escape bound (n-1)(MaxConsecutiveSlowLandings+1) holds at n>=3. Frozen cursor = the probe target is a pure function of startPref again: the fast third peer is never probed, the round-12 pin recreated one level up.

```diff
--- internal/ingest/walker.go:405
-	w.probeOffset = (w.probeOffset + 1) % (n - 1)
+	_ = n // W17M7: probe-target cursor never advances
```
APPLIED at internal/ingest/walker.go:405 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer`

Killed by:
  - `TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer`

**Result: KILLED**

## W17M8 — budget-removed: the seam's landed arm bypasses recordLanding and retains unconditionally (W14M1 re-anchored)

**Property under attack:** Wave-14 W14M1, RE-ANCHORED (the landed-arm call moved to the sigma-attempts signature): retention is BOUNDED - removing the lease (unconditional retention in the landed arm) restores Codex round-12's pin, fail-forever for latency.

```diff
--- internal/ingest/walker.go:649
-			w.recordLanding(servedBy, served, wall, probing, incumbent)
+			w.startPref, _, _, _ = servedBy.Index, served, wall, probing // W17M8: lease removed - unconditional retention
```
APPLIED at internal/ingest/walker.go:649 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound|TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

Killed by:
  - `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`
  - `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

**Result: KILLED**

## W17M9 — probe-adopts-unconditionally: the baseline comparison is forced true (W14M2 re-anchored)

**Property under attack:** Wave-14 W14M2, RE-ANCHORED (the comparison now reads served, same shape): a probe landing is ADJUDICATED, never blindly retained - unconditional adoption recreates the A-bounce pole the annex closed.

```diff
--- internal/ingest/walker.go:484
-		if served < w.slowBaseline {
+		if true { // W17M9: probe adopts unconditionally
```
APPLIED at internal/ingest/walker.go:484 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

Killed by:
  - `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`

**Result: KILLED**

## W17M10 — budget-derivation drift: slowStepBudget raised to the blind-spot ceiling (W14M3 re-anchored)

**Property under attack:** Wave-14 W14M3, RE-ANCHORED (chainAttemptTimeout is now the compile-time alias of chain.AttemptTimeout; the derivation relation is unchanged and still load-bearing): drifting the budget up to the blind-spot ceiling makes the just-below-timeout posture invisible and the round-12 pin returns. This guards the DERIVATION; the mirror's equality needs no test - the alias makes drift unrepresentable.

```diff
--- internal/ingest/walker.go:304
-const slowStepBudget = chainAttemptTimeout
+const slowStepBudget = stepMaxPinnedReads * chainAttemptTimeout // W17M10: budget drifted to the blind-spot ceiling
```
APPLIED at internal/ingest/walker.go:304 (1 occurrence, asserted)

`go test ./internal/ingest/ -count=1 -run TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`

Killed by:
  - `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `93334b2`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W17M1 | **KILLED** | R15-1 (consult row R-A): a CAUGHT-UP probe is REJECTED - the lease re-arms in full and the armed state lives exactly ONE Step. Reverting to the wave-14 shape (caught-up leaves the armed lease untouched) restores the frozen-neighbour capture: every subsequent Step probes the frozen peer, returns caught-up forever, the cursor freezes while the healthy incumbent is never revisited. | `TestFrozenNeighbourCaughtUpProbeIsRejectedAndTheLeaseReArms` |
| W17M2 | **KILLED** | R15-2a (consult row R-B): a FALL-THROUGH probe (the walk answered from the incumbent because the probed neighbour was down/hung) re-arms the lease in full - the liveness owed a recovering neighbour is paid ONCE per spent lease. Reverting (lease stays spent) re-probes the hung neighbour EVERY Step and pays its attempt timeout every Step: finding 2's ~17-minute round. | `TestFallThroughProbeReArmsAndTheTimeoutTaxIsPaidOncePerLease` |
| W17M3 | **KILLED** | R15-2b (consult row R-C, mutant i): the witness-less arm PRESERVES the lease - a total resolution failure is evidence about nobody, and the landings on either side of it are still consecutive landings on the retained endpoint. Resetting instead lets a flapping network (one blip every < MaxConsecutiveSlowLandings landings) suppress probes forever with no compensating routing move. | `TestWitnessLessFailurePreservesTheLeaseMidSpend`<br>`TestWitnessLessFailureWhileArmedPreservesTheArmedProbe` |
| W17M4 | **KILLED** | R15-2b (consult row R-C, adjacent killable shape of mutant ii): witness-less Steps take the WITNESS-LESS arm, never the witnessed non-landing advance. Deleting the guard routes the -1 token through routeNextStepPastNonLanding - startPref is dragged to endpoint 0 by a failure that named no witness, and the lease is reset on top (the schedule pins an incumbent at endpoint 1 so the mis-advance is visible). | `TestWitnessLessFailurePreservesTheLeaseMidSpend`<br>`TestWitnessLessFailureWhileArmedPreservesTheArmedProbe` |
| W17M5 | **KILLED** | R15-3/R15-4 (consult rows R-D and R-E): adjudication is on the SERVING WITNESS'S OWN sigma-attempts, never the Step wall. On wall, (a) a five-times-faster third endpoint behind a hung neighbour is judged 'no faster' forever (finding 3 half one), (b) an adopted endpoint inherits a slow landing from the neighbour's hang (half two), and (c) slow store commits arm the lease although no endpoint is at fault (finding 4 - store time enters via wall, never via sigma). | `TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall`<br>`TestProbeAdjudicatesOnTheServingWitnessOwnElapsedNotTheWalkWall/adopted_despite_the_walk_wall_exceeding_the_baseline`<br>`TestSlowStoreCommitsNeverArmTheLease` |
| W17M6 | **KILLED** | R15-6 (consult row R-F): a probe Step carries NO rewind authority - a cursor-hash mismatch reported by a probed witness is a DISCARD, and store.Rewind is never called on that witness's sole word. Restoring the authority lets an unvetted neighbour on a minority view trigger a destructive rewind (and be adopted off the churn it caused) once per spent lease. | `TestGenuineReorgRewindsOnTheIncumbentStepNotTheProbeStep`<br>`TestProbedWitnessCursorMismatchDiscardsInsteadOfRewinding` |
| W17M7 | **KILLED** | R15-7 (consult row R-G): every rejected probe ADVANCES the probe-target cursor, so a rejected-but-non-failing neighbour cannot shield the peers behind it and the escape bound (n-1)(MaxConsecutiveSlowLandings+1) holds at n>=3. Frozen cursor = the probe target is a pure function of startPref again: the fast third peer is never probed, the round-12 pin recreated one level up. | `TestRejectedProbeCyclesTheTargetPastTheShieldToTheFastPeer` |
| W17M8 | **KILLED** | Wave-14 W14M1, RE-ANCHORED (the landed-arm call moved to the sigma-attempts signature): retention is BOUNDED - removing the lease (unconditional retention in the landed arm) restores Codex round-12's pin, fail-forever for latency. | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`<br>`TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W17M9 | **KILLED** | Wave-14 W14M2, RE-ANCHORED (the comparison now reads served, same shape): a probe landing is ADJUDICATED, never blindly retained - unconditional adoption recreates the A-bounce pole the annex closed. | `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W17M10 | **KILLED** | Wave-14 W14M3, RE-ANCHORED (chainAttemptTimeout is now the compile-time alias of chain.AttemptTimeout; the derivation relation is unchanged and still load-bearing): drifting the budget up to the blind-spot ceiling makes the just-below-timeout posture invisible and the round-12 pin returns. This guards the DERIVATION; the mirror's equality needs no test - the alias makes drift unrepresentable. | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound` |

10 mutants, 10 killed, 0 survived.
