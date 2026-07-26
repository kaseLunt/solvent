# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `1b89fb5b1fe194c5add27843532b1001326e2c89`**  (docs(prices): prose sweep â€” the bracketing-hash mismatch is ambiguous, never asserted as a reorg)
- started (UTC): 2026-07-26T10:00:53+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W3M1 — the seam is severed: the deferred outcome handler no longer advances on non-landing exits

**Property under attack:** LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT: every post-resolution non-landing exit of readRound advances the caller-scoped exploration start through the one deferred seam

```diff
--- internal/prices/poller.go:942
-		if !landed {
-			p.routeNextRoundPastNonLanding(servedBy)
-		}
+		if false && !landed { // MUTANT: the seam no longer advances on non-landing exits
+			p.routeNextRoundPastNonLanding(servedBy)
+		}
```
APPLIED at internal/prices/poller.go:942 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`
  - `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`
  - `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close`
  - `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`
  - `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer`

**Result: KILLED**

## W3M1s — W3M1 again, test run scoped to the principle test alone (the class-closer)

**Property under attack:** the principle test kills the severed seam BY ITSELF: the invariant is pinned by the table-driven class-closer, not by incidental coverage from the named regression fleet

```diff
--- internal/prices/poller.go:942
-		if !landed {
-			p.routeNextRoundPastNonLanding(servedBy)
-		}
+		if false && !landed { // MUTANT: the seam no longer advances on non-landing exits
+			p.routeNextRoundPastNonLanding(servedBy)
+		}
```
APPLIED at internal/prices/poller.go:942 (1 occurrence, asserted)

`go test -run ^TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint$ ./internal/prices/ -count=1`

Killed by:
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close`

**Result: KILLED**

## W3M2 — W2M5 REVERSED: the ambiguous bracketing-hash-mismatch arm dodges the seam and keeps the starting point (wave-2 behavior restored)

**Property under attack:** the before/after hash mismatch is AMBIGUOUS (chain movement and a stable same-token backend split are indistinguishable) and MUST advance the start: wave 2's exclusion starved the poller under a stable split while a healthy peer sat idle (round-2 finding 1)

```diff
--- internal/prices/poller.go:1037
-			"before", hashBefore, "after", hashAfter)
-		return none, false, nil // ambiguous discard; next cadence retries elsewhere
+			"before", hashBefore, "after", hashAfter)
+		landed = true // MUTANT: the mismatch arm keeps the starting point (wave-2 behavior)
+		return none, false, nil // ambiguous discard; next cadence retries elsewhere
```
APPLIED at internal/prices/poller.go:1037 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`
  - `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer`

**Result: KILLED**

## W3M3 — the hash-pin-rejection discard dodges the seam

**Property under attack:** a recognized pin rejection still moves the start: only exploration ends the private-fork round-shape, and the discard posture must not become a keep-the-start posture just because the wording was recognized

```diff
--- internal/prices/poller.go:973
-				"engine", p.engine, "block", pin, "hash", hashBefore, "endpoint", servedBy.Index, "err", err)
-			return none, false, nil // round discarded; next cadence retries elsewhere
+				"engine", p.engine, "block", pin, "hash", hashBefore, "endpoint", servedBy.Index, "err", err)
+			landed = true // MUTANT: the rejection discard keeps the starting point
+			return none, false, nil // round discarded; next cadence retries elsewhere
```
APPLIED at internal/prices/poller.go:973 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W3M4 — the multicall-coherence discard dodges the seam

**Property under attack:** a round whose pinned multicall was answered by another endpoint still moves the start: dropping this arm's advance restores the round-1 [high] starvation verbatim

```diff
--- internal/prices/poller.go:986
-"servedBy", calledOn.Index)
-		return none, false, nil // round discarded; next cadence retries
+"servedBy", calledOn.Index)
+		landed = true // MUTANT: the multicall-coherence discard keeps the starting point
+		return none, false, nil // round discarded; next cadence retries
```
APPLIED at internal/prices/poller.go:986 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`

**Result: KILLED**

## W3M5 — the pin-divergence discard dodges the seam

**Property under attack:** a multicall reporting a different execution height than the pinned block still moves the start: a backend persistently mis-serving the pinned state must not re-resolve itself every cadence

```diff
--- internal/prices/poller.go:1001
-"executed", block, "endpoint", servedBy.Index)
-		return none, false, nil // round discarded; next cadence retries
+"executed", block, "endpoint", servedBy.Index)
+		landed = true // MUTANT: the pin-divergence discard keeps the starting point
+		return none, false, nil // round discarded; next cadence retries
```
APPLIED at internal/prices/poller.go:1001 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`

**Result: KILLED**

## W3M6 — the closing-recheck-coherence discard dodges the seam

**Property under attack:** a round whose closing header re-read was answered by another endpoint still moves the start: an endpoint that cannot close its own round must not re-resolve itself every cadence

```diff
--- internal/prices/poller.go:1017
-"servedBy", recheckOn.Index)
-		return none, false, nil // round discarded; next cadence retries
+"servedBy", recheckOn.Index)
+		landed = true // MUTANT: the closing-recheck discard keeps the starting point
+		return none, false, nil // round discarded; next cadence retries
```
APPLIED at internal/prices/poller.go:1017 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`

**Result: KILLED**

## W3M7 — the post-call ERROR return (out-of-class rejection / trailing transport failure) dodges the seam

**Property under attack:** routing must not depend on RECOGNIZING the failure (round-2 finding 2): a pin failure whose final surfaced error is transport or out-of-class wording takes the error posture AND still moves the start -- the error posture is fail-closed for correctness, never fail-forever for routing

```diff
--- internal/prices/poller.go:982
-		return none, false, fmt.Errorf("price poller %q: multicall (%d oracles) pinned to %s (block %d): %w", p.engine, len(p.targets), hashBefore, pin, err)
+		landed = true // MUTANT: the masked/out-of-class pin failure keeps the starting point
+		return none, false, fmt.Errorf("price poller %q: multicall (%d oracles) pinned to %s (block %d): %w", p.engine, len(p.targets), hashBefore, pin, err)
```
APPLIED at internal/prices/poller.go:982 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`

**Result: KILLED**

## W3M8 — the malformed-envelope ERROR return dodges the seam

**Property under attack:** an undecodable multicall envelope takes the error posture AND still moves the start: the endpoint that served garbage must not re-resolve itself every cadence (round-2 finding 2's named shape)

```diff
--- internal/prices/poller.go:991
-		return none, false, fmt.Errorf("price poller %q: %w", p.engine, err)
+		landed = true // MUTANT: the malformed-envelope failure keeps the starting point
+		return none, false, fmt.Errorf("price poller %q: %w", p.engine, err)
```
APPLIED at internal/prices/poller.go:991 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`
  - `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W3M9 — the closing-header-failure ERROR return dodges the seam

**Property under attack:** a closing re-read that no endpoint can answer takes the error posture AND still moves the start: the next cadence must be free to land through a peer's own head (round-2 finding 2's named shape)

```diff
--- internal/prices/poller.go:1013
-		return none, false, fmt.Errorf("price poller %q: re-read header %d after the pinned multicall: %w", p.engine, pin, err)
+		landed = true // MUTANT: the closing-header failure keeps the starting point
+		return none, false, fmt.Errorf("price poller %q: re-read header %d after the pinned multicall: %w", p.engine, pin, err)
```
APPLIED at internal/prices/poller.go:1013 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`

**Result: KILLED**

## W3M10 — the seam's routing half becomes a no-op: routeNextRoundPastNonLanding does nothing

**Property under attack:** the seam's advance is real, not ceremonial: the helper the deferred handler calls actually moves the caller-scoped exploration start

```diff
--- internal/prices/poller.go:1116
-func (p *Poller) routeNextRoundPastNonLanding(servedBy chain.EndpointToken) {
-	p.advanceExploration(servedBy)
-}
+func (p *Poller) routeNextRoundPastNonLanding(servedBy chain.EndpointToken) {
+	_ = servedBy // MUTANT: the non-landing outcome no longer moves the next round's start
+}
```
APPLIED at internal/prices/poller.go:1116 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`
  - `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`
  - `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close`
  - `TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`
  - `TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer`

**Result: KILLED**

## W3M11 — oscillation lock: advanceExploration refuses to move an already-active exploration hint

**Property under attack:** LIVENESS UNDER BOTH ENDPOINTS HALF-BROKEN (round-2 question (a)): the advance must keep ping-ponging across a fully failing fleet so every endpoint is revisited and a recovered endpoint is observed within one rotation -- a hint that locks in place excludes half the fleet forever

```diff
--- internal/prices/poller.go:2577
-func (p *Poller) advanceExploration(servedBy chain.EndpointToken) {
-	n := p.chain.EndpointCount()
+func (p *Poller) advanceExploration(servedBy chain.EndpointToken) {
+	if p.exploreStart >= 0 {
+		return // MUTANT: oscillation lock -- an active hint is never advanced again
+	}
+	n := p.chain.EndpointCount()
```
APPLIED at internal/prices/poller.go:2577 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress`

**Result: KILLED**

## W3M12 — the KEEP side violated: the landed flag is never set, so even a landed round advances

**Property under attack:** LANDING KEEPS THE STARTING POINT -- the invariant's other half: a round that landed must leave the exploration start alone even when its APPLY later errs ambiguously (the lease machinery owns that arm, d1e7d54; the seam owns only the round read)

```diff
--- internal/prices/poller.go:1080
-	// THE ONE LANDED RETURN — the only exit that keeps the starting point.
-	landed = true
-	return pollRound{
+	// THE ONE LANDED RETURN — the only exit that keeps the starting point.
+	// MUTANT: the flag is never set, so even a landed round advances.
+	return pollRound{
```
APPLIED at internal/prices/poller.go:1080 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAmbiguousApplyWithoutPinConsumesNoLease`

**Result: KILLED**

## W3M13 — classification loses its bound: every failure is classified as the recognized rejection

**Property under attack:** classification decides POSTURE ONLY, and its unknown-wording bound is fail-closed ERROR: a transport failure must surface as an error for the daemon's backoff, never be silently swallowed as a discard -- while routing is indifferent either way (the seam advances regardless), which is exactly round 2's separation of posture from routing

```diff
--- internal/prices/poller.go:1143
-	s := strings.ToLower(err.Error())
-	if !strings.Contains(s, "not found") && !strings.Contains(s, "unknown block") {
-		return false
-	}
-	return strings.Contains(s, "block") || strings.Contains(s, "header") || strings.Contains(s, "hash")
+	_ = strings.ToLower(err.Error()) // MUTANT: every failure is classified as the recognized rejection
+	return true
```
APPLIED at internal/prices/poller.go:1143 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`
  - `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`
  - `TestPollerFailedRoundConsumesCadenceSlot`
  - `TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 1 mutated file(s) is EMPTY: every file is byte-identical to `1b89fb5`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W3M1 | **KILLED** | LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT: every post-resolution non-landing exit of readRound advances the caller-scoped exploration start through the one deferred seam | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`<br>`TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`<br>`TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`<br>`TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close`<br>`TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`<br>`TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer` |
| W3M1s | **KILLED** | the principle test kills the severed seam BY ITSELF: the invariant is pinned by the table-driven class-closer, not by incidental coverage from the named regression fleet | `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close` |
| W3M2 | **KILLED** | the before/after hash mismatch is AMBIGUOUS (chain movement and a stable same-token backend split are indistinguishable) and MUST advance the start: wave 2's exclusion starved the poller under a stable split while a healthy peer sat idle (round-2 finding 1) | `TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`<br>`TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer` |
| W3M3 | **KILLED** | a recognized pin rejection still moves the start: only exploration ends the private-fork round-shape, and the discard posture must not become a keep-the-start posture just because the wording was recognized | `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W3M4 | **KILLED** | a round whose pinned multicall was answered by another endpoint still moves the start: dropping this arm's advance restores the round-1 [high] starvation verbatim | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint` |
| W3M5 | **KILLED** | a multicall reporting a different execution height than the pinned block still moves the start: a backend persistently mis-serving the pinned state must not re-resolve itself every cadence | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin` |
| W3M6 | **KILLED** | a round whose closing header re-read was answered by another endpoint still moves the start: an endpoint that cannot close its own round must not re-resolve itself every cadence | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint` |
| W3M7 | **KILLED** | routing must not depend on RECOGNIZING the failure (round-2 finding 2): a pin failure whose final surfaced error is transport or out-of-class wording takes the error posture AND still moves the start -- the error posture is fail-closed for correctness, never fail-forever for routing | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |
| W3M8 | **KILLED** | an undecodable multicall envelope takes the error posture AND still moves the start: the endpoint that served garbage must not re-resolve itself every cadence (round-2 finding 2's named shape) | `TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`<br>`TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere` |
| W3M9 | **KILLED** | a closing re-read that no endpoint can answer takes the error posture AND still moves the start: the next cadence must be free to land through a peer's own head (round-2 finding 2's named shape) | `TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint` |
| W3M10 | **KILLED** | the seam's advance is real, not ceremonial: the helper the deferred handler calls actually moves the caller-scoped exploration start | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerBracketingHashMismatchDiscardsAndMovesTheStart`<br>`TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere`<br>`TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`<br>`TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/ambiguous_bracketing-hash_mismatch:_the_close_reads_another_fork`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_header_re-read_fails_on_every_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/closing_re-read_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/execution_block_diverged_from_the_pin`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/hash-pin_rejection:_no_reachable_backend_has_the_serving_head's_block`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/malformed_multicall_envelope`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/multicall_answered_by_another_endpoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_at_the_head_read_(provider_protocol_violation)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/zero_header_hash_on_the_close`<br>`TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`<br>`TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer` |
| W3M11 | **KILLED** | LIVENESS UNDER BOTH ENDPOINTS HALF-BROKEN (round-2 question (a)): the advance must keep ping-ponging across a fully failing fleet so every endpoint is revisited and a recovered endpoint is observed within one rotation -- a hint that locks in place excludes half the fleet forever | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress` |
| W3M12 | **KILLED** | LANDING KEEPS THE STARTING POINT -- the invariant's other half: a round that landed must leave the exploration start alone even when its APPLY later errs ambiguously (the lease machinery owns that arm, d1e7d54; the seam owns only the round read) | `TestPollerAmbiguousApplyWithoutPinConsumesNoLease` |
| W3M13 | **KILLED** | classification decides POSTURE ONLY, and its unknown-wording bound is fail-closed ERROR: a transport failure must surface as an error for the daemon's backoff, never be silently swallowed as a discard -- while routing is indifferent either way (the seam advances regardless), which is exactly round 2's separation of posture from routing | `TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/out-of-class_rejection_wording_(fail-closed_error_posture)`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/total_transport_failure_on_the_pinned_call`<br>`TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint/trailing_transport_failure_masks_a_recognized_rejection`<br>`TestPollerFailedRoundConsumesCadenceSlot`<br>`TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead` |

14 mutants, 14 killed, 0 survived.
