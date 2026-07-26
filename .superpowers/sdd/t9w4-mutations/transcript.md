# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `a68b991d3786207560a69e6fda363ee67a0fbb59`**  (docs(sdd): task-9 wave 4 mutation matrix spec for the wave-16 committed applier)
- started (UTC): 2026-07-26T10:56:40+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W4M1 — last-error-wins restored: the classification site consults the surfaced (last) error instead of the per-attempt aggregate

**Property under attack:** ONE CLASSIFICATION AUTHORITY PER ROUND OUTCOME: the posture is computed from the AGGREGATE of per-attempt outcomes and is therefore order-independent -- the same persistent mixed outage must take the ERROR posture whichever failure the walk surfaces last

```diff
--- internal/prices/poller.go:986
-		if allAttemptsRejectedPin(err) {
+		if isBlockNotFoundErr(err) { // MUTANT: last-error-wins restored -- the posture is whichever attempt ran last
```
APPLIED at internal/prices/poller.go:986 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`
  - `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`
  - `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`

**Result: KILLED**

## W4M2 — unanimity flipped to any-rejection-wins: one recognized rejection anywhere in the walk earns the discard posture

**Property under attack:** ANY TRANSPORT OR UNKNOWN INVOLVEMENT RETAINS THE ERROR POSTURE: the discard requires the recognized rejection on EVERY attempted endpoint, so a mixed outage keeps growing the daemon's backoff streak and keeps step_error visible

```diff
--- internal/prices/poller.go:1191
-	for _, a := range walk.Attempts {
-		if !isBlockNotFoundErr(a.Err) {
-			return false // transport or unknown involvement: ERROR posture
-		}
-	}
-	return true
+	for _, a := range walk.Attempts {
+		if isBlockNotFoundErr(a.Err) { // MUTANT: ANY recognized rejection wins the discard posture
+			return true
+		}
+	}
+	return false
```
APPLIED at internal/prices/poller.go:1191 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`
  - `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`

**Result: KILLED**

## W4M3 — the aggregate is never consulted: every total pinned-call failure takes the error posture

**Property under attack:** THE ALL-REJECTIONS ROUND STILL DISCARDS CLEANLY: a unanimous recognized rejection is the WARN-discard posture (the serving node may be alone on its fork -- not a fault to burn the daemon's backoff on), and severing that arm turns an honest discard into a spurious error

```diff
--- internal/prices/poller.go:1186
-	if !errors.As(err, &walk) || len(walk.Attempts) == 0 {
+	if true || !errors.As(err, &walk) || len(walk.Attempts) == 0 { // MUTANT: the aggregate is never consulted
```
APPLIED at internal/prices/poller.go:1186 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W4M4 — the chain layer forgets the aggregate: CallAtHashFrom walks through doFrom again (last-error-wins at the source)

**Property under attack:** THE PINNED-CALL PATH RETAINS PER-ATTEMPT OUTCOMES: the real Failover must return the *PinnedCallError aggregate the fake models and the poller classifies over -- without it every total failure is unclassifiable and the discard posture is unreachable in production

```diff
--- internal/chain/chain.go:549
-	idx, err := f.doFromAttempts(ctx, "callAtHash", start, func(ctx context.Context, c rpcClient) error {
+	idx, err := f.doFrom(ctx, "callAtHash", start, func(ctx context.Context, c rpcClient) error { // MUTANT: the pinned path forgets per-attempt outcomes
```
APPLIED at internal/chain/chain.go:549 (1 occurrence, asserted)

`go test ./internal/chain/ ./internal/prices/ -count=1`

Killed by:
  - `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders`

**Result: KILLED**

## W4M5 — the aggregate degenerates to a window of one: doFromAttempts keeps only the LAST attempt

**Property under attack:** THE AGGREGATE CARRIES EVERY ATTEMPTED ENDPOINT'S OUTCOME: a last-attempt window is last-error-wins wearing the aggregate's type, and unanimity judged over it re-creates the order dependence at the chain layer

```diff
--- internal/chain/chain.go:208
-			attempts = append(attempts, AttemptError{Endpoint: idx, Err: err})
+			attempts = []AttemptError{{Endpoint: idx, Err: err}} // MUTANT: the aggregate keeps only the last attempt
```
APPLIED at internal/chain/chain.go:208 (1 occurrence, asserted)

`go test ./internal/chain/ ./internal/prices/ -count=1`

Killed by:
  - `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders`

**Result: KILLED**

## W4M6 — only the FIRST attempt is judged: front-biased order dependence injected into the classification

**Property under attack:** ORDER-INDEPENDENCE, ATTACKED FROM THE FRONT: a classification that samples any single attempt -- first or last -- re-creates the alternation, because the deferred routing advance rotates which endpoint leads the walk every cadence

```diff
--- internal/prices/poller.go:1191
-	for _, a := range walk.Attempts {
+	for _, a := range walk.Attempts[:1] { // MUTANT: only the FIRST attempt is judged
```
APPLIED at internal/prices/poller.go:1191 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`
  - `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`

**Result: KILLED**

## W4M7 — the rewritten unanimous-rejection discard dodges the routing seam (landed = true before the nil return)

**Property under attack:** THE SEAM IS CLOSED LAW AT THE REWRITTEN SITE: the deferred routing advance applies unconditionally to every non-landing round, discard posture included -- wave 4's edit of the classification arm must not have reopened the dodge wave 3 closed

```diff
--- internal/prices/poller.go:994
-				"engine", p.engine, "block", pin, "hash", hashBefore, "endpoint", servedBy.Index, "err", err)
-			return none, false, nil // round discarded; next cadence retries elsewhere
+				"engine", p.engine, "block", pin, "hash", hashBefore, "endpoint", servedBy.Index, "err", err)
+			landed = true // MUTANT: the unanimous-rejection discard keeps the starting point
+			return none, false, nil // round discarded; next cadence retries elsewhere
```
APPLIED at internal/prices/poller.go:994 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W4M8 — the rewritten post-call ERROR return dodges the routing seam (landed = true before the error return)

**Property under attack:** THE SEAM IS CLOSED LAW AT THE REWRITTEN SITE, ERROR SIDE: the mixed-outage error posture must still advance the start every round (fail-closed for correctness, never fail-forever for routing) -- otherwise the mixed outage parks the walk on one endpoint and the alternation the daemon-wrapper tests pin never happens

```diff
--- internal/prices/poller.go:1003
-		return none, false, fmt.Errorf("price poller %q: multicall (%d oracles) pinned to %s (block %d): %w", p.engine, len(p.targets), hashBefore, pin, err)
+		landed = true // MUTANT: the post-call error return keeps the starting point
+		return none, false, fmt.Errorf("price poller %q: multicall (%d oracles) pinned to %s (block %d): %w", p.engine, len(p.targets), hashBefore, pin, err)
```
APPLIED at internal/prices/poller.go:1003 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`
  - `TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 2 mutated file(s) is EMPTY: every file is byte-identical to `a68b991`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W4M1 | **KILLED** | ONE CLASSIFICATION AUTHORITY PER ROUND OUTCOME: the posture is computed from the AGGREGATE of per-attempt outcomes and is therefore order-independent -- the same persistent mixed outage must take the ERROR posture whichever failure the walk surfaces last | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`<br>`TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`<br>`TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff` |
| W4M2 | **KILLED** | ANY TRANSPORT OR UNKNOWN INVOLVEMENT RETAINS THE ERROR POSTURE: the discard requires the recognized rejection on EVERY attempted endpoint, so a mixed outage keeps growing the daemon's backoff streak and keeps step_error visible | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`<br>`TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |
| W4M3 | **KILLED** | THE ALL-REJECTIONS ROUND STILL DISCARDS CLEANLY: a unanimous recognized rejection is the WARN-discard posture (the serving node may be alone on its fork -- not a fault to burn the daemon's backoff on), and severing that arm turns an honest discard into a spurious error | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W4M4 | **KILLED** | THE PINNED-CALL PATH RETAINS PER-ATTEMPT OUTCOMES: the real Failover must return the *PinnedCallError aggregate the fake models and the poller classifies over -- without it every total failure is unclassifiable and the discard posture is unreachable in production | `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders` |
| W4M5 | **KILLED** | THE AGGREGATE CARRIES EVERY ATTEMPTED ENDPOINT'S OUTCOME: a last-attempt window is last-error-wins wearing the aggregate's type, and unanimity judged over it re-creates the order dependence at the chain layer | `TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders` |
| W4M6 | **KILLED** | ORDER-INDEPENDENCE, ATTACKED FROM THE FRONT: a classification that samples any single attempt -- first or last -- re-creates the alternation, because the deferred routing advance rotates which endpoint leads the walk every cadence | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`<br>`TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |
| W4M7 | **KILLED** | THE SEAM IS CLOSED LAW AT THE REWRITTEN SITE: the deferred routing advance applies unconditionally to every non-landing round, discard posture included -- wave 4's edit of the classification arm must not have reopened the dodge wave 3 closed | `TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W4M8 | **KILLED** | THE SEAM IS CLOSED LAW AT THE REWRITTEN SITE, ERROR SIDE: the mixed-outage error posture must still advance the start every round (fail-closed for correctness, never fail-forever for routing) -- otherwise the mixed outage parks the walk on one endpoint and the alternation the daemon-wrapper tests pin never happens | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation`<br>`TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |

8 mutants, 8 killed, 0 survived.
