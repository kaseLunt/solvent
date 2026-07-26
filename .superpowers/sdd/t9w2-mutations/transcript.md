# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `2981f3e2a1a988ec7edc31e0c2b043d943c1eef8`**  (docs(sdd): task-9 wave 2 mutation matrix spec for the wave-16 committed applier)
- started (UTC): 2026-07-26T09:07:04+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W2M1 — hash-to-number pin regression: PollChain and readRound revert to the number-pinned CallAtFrom

**Property under attack:** execution is bound to the round's verified block IDENTITY (hashBefore, EIP-1898), not to a height -- a same-height split backend behind one endpoint token (headers fork A, state fork B) must NEVER land B's observations under A's hash

```diff
--- internal/prices/prices.go:770
-	CallAtHashFrom(ctx context.Context, startIndex int, to common.Address, data []byte, blockHash common.Hash) ([]byte, chain.EndpointToken, error)
+	CallAtFrom(ctx context.Context, startIndex int, to common.Address, data []byte, block uint64) ([]byte, chain.EndpointToken, error)
```
APPLIED at internal/prices/prices.go:770 (1 occurrence, asserted)

```diff
--- internal/prices/poller.go:930
-	out, calledOn, err := p.chain.CallAtHashFrom(ctx, servedBy.Index, Multicall3Address, input, hashBefore)
+	out, calledOn, err := p.chain.CallAtFrom(ctx, servedBy.Index, Multicall3Address, input, pin)
```
APPLIED at internal/prices/poller.go:930 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`
  - `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`

**Result: KILLED**

## W2M1s — W2M1 again, test run scoped to the split-fork regression alone (the brief's mandated killer)

**Property under attack:** the same-height split-fork regression test kills the hash-to-number pin regression BY ITSELF -- the property is pinned by that one test, not by incidental fleet coverage

```diff
--- internal/prices/prices.go:770
-	CallAtHashFrom(ctx context.Context, startIndex int, to common.Address, data []byte, blockHash common.Hash) ([]byte, chain.EndpointToken, error)
+	CallAtFrom(ctx context.Context, startIndex int, to common.Address, data []byte, block uint64) ([]byte, chain.EndpointToken, error)
```
APPLIED at internal/prices/prices.go:770 (1 occurrence, asserted)

```diff
--- internal/prices/poller.go:930
-	out, calledOn, err := p.chain.CallAtHashFrom(ctx, servedBy.Index, Multicall3Address, input, hashBefore)
+	out, calledOn, err := p.chain.CallAtFrom(ctx, servedBy.Index, Multicall3Address, input, pin)
```
APPLIED at internal/prices/poller.go:930 (1 occurrence, asserted)

`go test -run ^TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight$ ./internal/prices/ -count=1`

Killed by:
  - `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`

**Result: KILLED**

## W2M2 — the rejection-to-discard arm is severed: a 'block not found' pin rejection falls through to the ERROR posture

**Property under attack:** a 'block not found'-class pin rejection is a DISCARD that moves the next round's start (the serving node may genuinely lack the fork -- exploration-worthy information), never an error that burns the daemon's backoff retrying the same view

```diff
--- internal/prices/poller.go:932
-		if isBlockNotFoundErr(err) {
+		if false && isBlockNotFoundErr(err) {
```
APPLIED at internal/prices/poller.go:932 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W2M3 — the F1 routing transition is severed: routeNextRoundPastDiscard becomes a no-op

**Property under attack:** a coherence/serving-inconsistency discard ADVANCES the next round's caller-scoped start (fail-closed-not-fail-forever): an endpoint serving heads while permanently failing pinned calls must not re-resolve itself every cadence while a healthy peer sits idle

```diff
--- internal/prices/poller.go:1059
-func (p *Poller) routeNextRoundPastDiscard(servedBy chain.EndpointToken) {
-	p.advanceExploration(servedBy)
-}
+func (p *Poller) routeNextRoundPastDiscard(servedBy chain.EndpointToken) {
+	_ = servedBy // MUTANT: the discard no longer moves the next round's start
+}
```
APPLIED at internal/prices/poller.go:1059 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## W2M4 — the chain layer silently degrades the hash pin to a latest call

**Property under attack:** CallAtHashFrom forwards the EIP-1898 block-hash pin to eth_call -- the mechanism layer can never silently degrade identity-pinned execution to 'latest'

```diff
--- internal/chain/chain.go:458
-		res, err := c.CallContractAtHash(ctx, ethereum.CallMsg{To: &to, Data: data}, blockHash)
+		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
```
APPLIED at internal/chain/chain.go:458 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestCallAtHashFromPinsHashAndLeavesSharedHintAlone`
  - `TestCallAtHashFromWrapsModuloAndRotatesOnError`

**Result: KILLED**

## W2M5 — the mid-round-reorg exclusion is violated: the tip-changed discard also advances routing

**Property under attack:** a mid-round reorg discard implicates the CHAIN, not the endpoint -- the routing state must NOT move on it (advancing would flee a healthy endpoint on false attribution); the exclusion is pinned in BOTH directions, not just implied by the advance arms

```diff
--- internal/prices/poller.go:993
-			"before", hashBefore, "after", hashAfter)
-		return none, false, nil // mid-round reorg; next cadence retries
+			"before", hashBefore, "after", hashAfter)
+		p.routeNextRoundPastDiscard(servedBy)
+		return none, false, nil // mid-round reorg; next cadence retries
```
APPLIED at internal/prices/poller.go:993 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundOnMidRoundReorg`

**Result: KILLED**

## W2M6 — the closing-recheck arm's advance is dropped (discard kept, routing untouched)

**Property under attack:** EVERY serving-inconsistency arm advances the next round's start -- dropping the closing-recheck arm alone re-opens per-arm starvation for an endpoint that serves heads and calls but cannot close its own round

```diff
--- internal/prices/poller.go:980
-"servedBy", recheckOn.Index)
-		p.routeNextRoundPastDiscard(servedBy)
+"servedBy", recheckOn.Index)
```
APPLIED at internal/prices/poller.go:980 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`

**Result: KILLED**

## W2M7 — the pin-divergence arm's advance is dropped (discard kept, routing untouched)

**Property under attack:** EVERY serving-inconsistency arm advances the next round's start -- dropping the blockNumber-divergence arm alone re-opens per-arm starvation for a backend that persistently mis-serves the pinned state

```diff
--- internal/prices/poller.go:963
-"executed", block, "endpoint", servedBy.Index)
-		p.routeNextRoundPastDiscard(servedBy)
+"executed", block, "endpoint", servedBy.Index)
```
APPLIED at internal/prices/poller.go:963 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`

**Result: KILLED**

## W2M8 — the multicall-coherence arm's advance is dropped (discard kept, routing untouched)

**Property under attack:** EVERY serving-inconsistency arm advances the next round's start -- dropping the multicall token-mismatch arm alone restores the round-1 [high] starvation verbatim: heads from endpoint 0, calls failed over, discard, same endpoint next cadence, forever

```diff
--- internal/prices/poller.go:947
-"servedBy", calledOn.Index)
-		p.routeNextRoundPastDiscard(servedBy)
+"servedBy", calledOn.Index)
```
APPLIED at internal/prices/poller.go:947 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`

**Result: KILLED**

## W2M9 — the rejection arm's advance is dropped (discard kept, routing untouched)

**Property under attack:** the pin-rejection discard MOVES the next round's start: a serving endpoint whose head no reachable backend can execute at may be alone on its fork, and only exploration ends that round-shape

```diff
--- internal/prices/poller.go:940
-			p.routeNextRoundPastDiscard(servedBy)
-			return none, false, nil // round discarded; next cadence retries elsewhere
+			return none, false, nil // round discarded; next cadence retries elsewhere
```
APPLIED at internal/prices/poller.go:940 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 3 mutated file(s) is EMPTY: every file is byte-identical to `2981f3e`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W2M1 | **KILLED** | execution is bound to the round's verified block IDENTITY (hashBefore, EIP-1898), not to a height -- a same-height split backend behind one endpoint token (headers fork A, state fork B) must NEVER land B's observations under A's hash | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere`<br>`TestPollerRoundIsEndpointCoherentAndPinnedAtHead` |
| W2M1s | **KILLED** | the same-height split-fork regression test kills the hash-to-number pin regression BY ITSELF -- the property is pinned by that one test, not by incidental fleet coverage | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight` |
| W2M2 | **KILLED** | a 'block not found'-class pin rejection is a DISCARD that moves the next round's start (the serving node may genuinely lack the fork -- exploration-worthy information), never an error that burns the daemon's backoff retrying the same view | `TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W2M3 | **KILLED** | a coherence/serving-inconsistency discard ADVANCES the next round's caller-scoped start (fail-closed-not-fail-forever): an endpoint serving heads while permanently failing pinned calls must not re-resolve itself every cadence while a healthy peer sits idle | `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`<br>`TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`<br>`TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |
| W2M4 | **KILLED** | CallAtHashFrom forwards the EIP-1898 block-hash pin to eth_call -- the mechanism layer can never silently degrade identity-pinned execution to 'latest' | `TestCallAtHashFromPinsHashAndLeavesSharedHintAlone`<br>`TestCallAtHashFromWrapsModuloAndRotatesOnError` |
| W2M5 | **KILLED** | a mid-round reorg discard implicates the CHAIN, not the endpoint -- the routing state must NOT move on it (advancing would flee a healthy endpoint on false attribution); the exclusion is pinned in BOTH directions, not just implied by the advance arms | `TestPollerDiscardsRoundOnMidRoundReorg` |
| W2M6 | **KILLED** | EVERY serving-inconsistency arm advances the next round's start -- dropping the closing-recheck arm alone re-opens per-arm starvation for an endpoint that serves heads and calls but cannot close its own round | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` |
| W2M7 | **KILLED** | EVERY serving-inconsistency arm advances the next round's start -- dropping the blockNumber-divergence arm alone re-opens per-arm starvation for a backend that persistently mis-serves the pinned state | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` |
| W2M8 | **KILLED** | EVERY serving-inconsistency arm advances the next round's start -- dropping the multicall token-mismatch arm alone restores the round-1 [high] starvation verbatim: heads from endpoint 0, calls failed over, discard, same endpoint next cadence, forever | `TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| W2M9 | **KILLED** | the pin-rejection discard MOVES the next round's start: a serving endpoint whose head no reachable backend can execute at may be alone on its fork, and only exploration ends that round-shape | `TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere` |

10 mutants, 10 killed, 0 survived.
