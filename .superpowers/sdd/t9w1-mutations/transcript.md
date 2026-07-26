# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `53c0688cc1f61fea0ac454e31ec74f767f2fb205`**  (docs(sdd): task-9 wave 1 mutation matrix spec for the wave-16 committed applier)
- started (UTC): 2026-07-26T08:05:15+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## M1 — the multicall decoder refuses the zero blockHash again (the live P0 restored)

**Property under attack:** the real-EVM zero multicall hash decodes cleanly — tryBlockAndAggregate's blockHash is blockhash(block.number), out of BLOCKHASH range, deterministically zero on every real chain; refusing it refuses every round on every real chain

```diff
--- internal/prices/prices.go:512
-if _, ok := vals[1].([32]byte); !ok {
+if h, ok := vals[1].([32]byte); !ok || h == ([32]byte{}) {
```
APPLIED at internal/prices/prices.go:512 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestFailedRecountAfterANeutralizationReportsUnknownAndTheNextRoundCorrectsIt`
  - `TestFailedRecountAfterASupersedeReportsUnknownAndTheNextRoundCorrectsIt`
  - `TestPollerAllEndpointsBehindWarns`
  - `TestPollerAllFailedStillAdvancesCursor`
  - `TestPollerAmbiguousApplyRetainsPinThenRotates`
  - `TestPollerAnchorDivergenceIsTreatedAsReorg`
  - `TestPollerCadenceGate`
  - `TestPollerCauseUnknownWithOneEndpointCannotExplore`
  - `TestPollerDiscardsRoundOnMidRoundReorg`
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerDoesNotRecountTheBacklogOnAnOrdinaryRound`
  - `TestPollerETHRatioRow`
  - `TestPollerFailedRehydrationMarksVerdictUntrusted`
  - `TestPollerFrozenEndpointAtCursorRefreshesNothing`
  - `TestPollerHealthFailsForOneStaleAssetWhileOthersLand`
  - `TestPollerHealthFailsWhenEveryOracleKeepsFailing`
  - `TestPollerHealthIsRecoverable`
  - `TestPollerLiveRoundWritesAnchorAndBoundObservations`
  - `TestPollerMarksOnAOneEndpointFleetAndDisclosesTheHeightRange`
  - `TestPollerNeutralizedBacklogSurvivesAndIsRefreshedByANewerRound`
  - `TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates`
  - `TestPollerQuarantinedAnswerDoesNotRefreshUsableFreshness`
  - `TestPollerReactiveEpochRewind`
  - `TestPollerRecordsObservations`
  - `TestPollerRefusesZeroHeaderHash`
  - `TestPollerRefusesZeroHeaderHash/after`
  - `TestPollerRegressionDuringWalkerBackoffSuppressesEndpointBlame`
  - `TestPollerRegressionWithFailedAncestryProbeSuppressesRotation`
  - `TestPollerRegressionWithFrontierBelowCursorIsCauseUnknown`
  - `TestPollerRegressionWithRecordedEpochNeedsNoProbe`
  - `TestPollerRegressionWithUndeterminedCauseSuppressesRotation`
  - `TestPollerRehydratesFreshnessAfterAmbiguousApply`
  - `TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress`
  - `TestPollerRevertIsPerAsset`
  - `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`
  - `TestPollerRoundPersistsHashAnchor`
  - `TestPollerRoundRequestShape`
  - `TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier`
  - `TestPollerUndecodableInnerReturnIsPerAsset`
  - `TestUnpackHardening`
  - `TestUnpackMulticallAcceptsRealChainZeroBlockHash`

**Result: KILLED**

## M2 — the blockNumber==pin guard is disabled

**Property under attack:** a multicall that reports executing at a different height than the block it was pinned to (a serving inconsistency behind one URL) can never land: the round is discarded, nothing is applied

```diff
--- internal/prices/poller.go:914
-if block != pin {
+if false && block != pin {
```
APPLIED at internal/prices/poller.go:914 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`

**Result: KILLED**

## M3 — the hashAfter==hashBefore close is disabled

**Property under attack:** a mid-round reorg — the header hash at the pin changing between the two reads that bracket the multicall — discards the round: no anchor is ever written for a block the serving endpoint no longer carries

```diff
--- internal/prices/poller.go:936
-if hashAfter != hashBefore {
+if false && hashAfter != hashBefore {
```
APPLIED at internal/prices/poller.go:936 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundOnMidRoundReorg`

**Result: KILLED**

## M4 — the multicall endpoint-coherence check is disabled

**Property under attack:** a pinned multicall the failover client served from a DIFFERENT endpoint than the round's own is another chain view's answer and discards the round — one endpoint serves every read, or nothing lands

```diff
--- internal/prices/poller.go:900
-if calledOn.Index != servedBy.Index {
+if false && calledOn.Index != servedBy.Index {
```
APPLIED at internal/prices/poller.go:900 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`

**Result: KILLED**

## M5 — the closing re-read's endpoint-coherence check is disabled

**Property under attack:** a closing HeaderHash(N) re-read answered by another endpoint cannot confirm the round's own chain view and discards the round — a second node agreeing on a hash is a different fact than one node bracketing its own answer

```diff
--- internal/prices/poller.go:928
-if recheckOn.Index != servedBy.Index {
+if false && recheckOn.Index != servedBy.Index {
```
APPLIED at internal/prices/poller.go:928 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`

**Result: KILLED**

## M6 — the zero-hash refusal on the OPENING header read is disabled

**Property under attack:** a zero header hash is a provider protocol violation and is refused BEFORE any multicall is issued — the guard that used to sit (wrongly) in the multicall decoder now protects the hash the anchor actually rests on

*The before-arm test's load-bearing assertion is require.Empty(ch.calls): under this mutant the round proceeds to the multicall and may still error later for a different reason, so the refusal's POSITION (before any RPC spend) is part of the property.*

```diff
--- internal/prices/poller.go:887
-if hashBefore == (common.Hash{}) {
+if false && hashBefore == (common.Hash{}) {
```
APPLIED at internal/prices/poller.go:887 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerRefusesZeroHeaderHash`
  - `TestPollerRefusesZeroHeaderHash/before`

**Result: KILLED**

## M7 — the zero-hash refusal on the CLOSING header read is disabled

**Property under attack:** a zero header hash on the closing read is an ERROR (a broken provider, operator-visible as a fault), never a silent discard-and-retry

```diff
--- internal/prices/poller.go:933
-if hashAfter == (common.Hash{}) {
+if false && hashAfter == (common.Hash{}) {
```
APPLIED at internal/prices/poller.go:933 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerRefusesZeroHeaderHash`
  - `TestPollerRefusesZeroHeaderHash/after`

**Result: KILLED**

## M8 — Step treats a discarded round as landed

**Property under attack:** a discarded round records NOTHING: Step's discard arm is what stands between an incoherent round and ApplyPolledPrices — removing it must be caught by every discard test's 'nothing reached the store' assertion

```diff
--- internal/prices/poller.go:562
-if !ok {
+if !ok && false {
```
APPLIED at internal/prices/poller.go:562 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerDiscardsRoundOnMidRoundReorg`
  - `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`
  - `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`
  - `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint`

**Result: KILLED**

## M9 — the anchor's hash is zeroed at Step's composition site

**Property under attack:** the durable anchor persists the round's verified header hash — the exact bytes HeaderHash(N) attested on both sides of the multicall — not a placeholder

```diff
--- internal/prices/poller.go:572
-anchor := store.PollAnchor{BlockNumber: block, BlockHash: round.hash}
+anchor := store.PollAnchor{BlockNumber: block, BlockHash: make([]byte, 32)}
```
APPLIED at internal/prices/poller.go:572 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerAnchorsWithoutConsumingMulticallHashField`
  - `TestPollerLiveRoundWritesAnchorAndBoundObservations`
  - `TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates`
  - `TestPollerRoundPersistsHashAnchor`

**Result: KILLED**

## M10 — the multicall is pinned one block past the resolved head

**Property under attack:** the multicall executes AT the pin the round verified — the pinned height and the header-verified height are the same N, or the anchor describes a block nobody read

```diff
--- internal/prices/poller.go:896
-out, calledOn, err := p.chain.CallAtFrom(ctx, servedBy.Index, Multicall3Address, input, pin)
+out, calledOn, err := p.chain.CallAtFrom(ctx, servedBy.Index, Multicall3Address, input, pin+1)
```
APPLIED at internal/prices/poller.go:896 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`

**Result: KILLED**

## M11 — the default endpoint resolution ignores the shared routing hint

**Property under attack:** with no exploration hint and no attribution pin, the round resolves from the endpoint the shared hint names (read, never written) — not from a hard-coded index

```diff
--- internal/prices/poller.go:869
-start := p.chain.ActiveEndpoint()
+start := 0
```
APPLIED at internal/prices/poller.go:869 (1 occurrence, asserted)

`go test ./internal/prices/ -count=1`

Killed by:
  - `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`
  - `TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier`

**Result: KILLED**

## M12 — chain.Failover.CallAtFrom silently drops its pin to latest

**Property under attack:** the pin is forwarded to eth_call: a CallAtFrom that executes at 'latest' is indistinguishable from Call at the RPC layer and would reintroduce the unverifiable-round defect one layer down

```diff
--- internal/chain/chain.go:408
-res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
+res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
```
APPLIED at internal/chain/chain.go:408 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestCallAtFromPinsBlockAndLeavesSharedHintAlone`
  - `TestCallAtFromWrapsModuloAndRotatesOnError`

**Result: KILLED**

## M13 — chain.Failover.CallAtFrom starts its walk past the caller's endpoint

**Property under attack:** the attempt walk starts at exactly the caller's requested endpoint (CallFrom's caller-scoped discipline): starting anywhere else silently hands the pinned call to a chain view the caller did not resolve

```diff
--- internal/chain/chain.go:407
-idx, err := f.doFrom(ctx, "callAt", start, func(ctx context.Context, c rpcClient) error {
+idx, err := f.doFrom(ctx, "callAt", start+1, func(ctx context.Context, c rpcClient) error {
```
APPLIED at internal/chain/chain.go:407 (1 occurrence, asserted)

`go test ./internal/chain/ -count=1`

Killed by:
  - `TestCallAtFromPinsBlockAndLeavesSharedHintAlone`
  - `TestCallAtFromWrapsModuloAndRotatesOnError`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 3 mutated file(s) is EMPTY: every file is byte-identical to `53c0688`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| M1 | **KILLED** | the real-EVM zero multicall hash decodes cleanly — tryBlockAndAggregate's blockHash is blockhash(block.number), out of BLOCKHASH range, deterministically zero on every real chain; refusing it refuses every round on every real chain | `TestFailedRecountAfterANeutralizationReportsUnknownAndTheNextRoundCorrectsIt`<br>`TestFailedRecountAfterASupersedeReportsUnknownAndTheNextRoundCorrectsIt`<br>`TestPollerAllEndpointsBehindWarns`<br>`TestPollerAllFailedStillAdvancesCursor`<br>`TestPollerAmbiguousApplyRetainsPinThenRotates`<br>`TestPollerAnchorDivergenceIsTreatedAsReorg`<br>`TestPollerCadenceGate`<br>`TestPollerCauseUnknownWithOneEndpointCannotExplore`<br>`TestPollerDiscardsRoundOnMidRoundReorg`<br>`TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerDoesNotRecountTheBacklogOnAnOrdinaryRound`<br>`TestPollerETHRatioRow`<br>`TestPollerFailedRehydrationMarksVerdictUntrusted`<br>`TestPollerFrozenEndpointAtCursorRefreshesNothing`<br>`TestPollerHealthFailsForOneStaleAssetWhileOthersLand`<br>`TestPollerHealthFailsWhenEveryOracleKeepsFailing`<br>`TestPollerHealthIsRecoverable`<br>`TestPollerLiveRoundWritesAnchorAndBoundObservations`<br>`TestPollerMarksOnAOneEndpointFleetAndDisclosesTheHeightRange`<br>`TestPollerNeutralizedBacklogSurvivesAndIsRefreshedByANewerRound`<br>`TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates`<br>`TestPollerQuarantinedAnswerDoesNotRefreshUsableFreshness`<br>`TestPollerReactiveEpochRewind`<br>`TestPollerRecordsObservations`<br>`TestPollerRefusesZeroHeaderHash`<br>`TestPollerRefusesZeroHeaderHash/after`<br>`TestPollerRegressionDuringWalkerBackoffSuppressesEndpointBlame`<br>`TestPollerRegressionWithFailedAncestryProbeSuppressesRotation`<br>`TestPollerRegressionWithFrontierBelowCursorIsCauseUnknown`<br>`TestPollerRegressionWithRecordedEpochNeedsNoProbe`<br>`TestPollerRegressionWithUndeterminedCauseSuppressesRotation`<br>`TestPollerRehydratesFreshnessAfterAmbiguousApply`<br>`TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress`<br>`TestPollerRevertIsPerAsset`<br>`TestPollerRoundIsEndpointCoherentAndPinnedAtHead`<br>`TestPollerRoundPersistsHashAnchor`<br>`TestPollerRoundRequestShape`<br>`TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier`<br>`TestPollerUndecodableInnerReturnIsPerAsset`<br>`TestUnpackHardening`<br>`TestUnpackMulticallAcceptsRealChainZeroBlockHash` |
| M2 | **KILLED** | a multicall that reports executing at a different height than the block it was pinned to (a serving inconsistency behind one URL) can never land: the round is discarded, nothing is applied | `TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin` |
| M3 | **KILLED** | a mid-round reorg — the header hash at the pin changing between the two reads that bracket the multicall — discards the round: no anchor is ever written for a block the serving endpoint no longer carries | `TestPollerDiscardsRoundOnMidRoundReorg` |
| M4 | **KILLED** | a pinned multicall the failover client served from a DIFFERENT endpoint than the round's own is another chain view's answer and discards the round — one endpoint serves every read, or nothing lands | `TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| M5 | **KILLED** | a closing HeaderHash(N) re-read answered by another endpoint cannot confirm the round's own chain view and discards the round — a second node agreeing on a hash is a different fact than one node bracketing its own answer | `TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint` |
| M6 | **KILLED** | a zero header hash is a provider protocol violation and is refused BEFORE any multicall is issued — the guard that used to sit (wrongly) in the multicall decoder now protects the hash the anchor actually rests on | `TestPollerRefusesZeroHeaderHash`<br>`TestPollerRefusesZeroHeaderHash/before` |
| M7 | **KILLED** | a zero header hash on the closing read is an ERROR (a broken provider, operator-visible as a fault), never a silent discard-and-retry | `TestPollerRefusesZeroHeaderHash`<br>`TestPollerRefusesZeroHeaderHash/after` |
| M8 | **KILLED** | a discarded round records NOTHING: Step's discard arm is what stands between an incoherent round and ApplyPolledPrices — removing it must be caught by every discard test's 'nothing reached the store' assertion | `TestPollerDiscardsRoundOnMidRoundReorg`<br>`TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint`<br>`TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin`<br>`TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint` |
| M9 | **KILLED** | the durable anchor persists the round's verified header hash — the exact bytes HeaderHash(N) attested on both sides of the multicall — not a placeholder | `TestPollerAnchorsWithoutConsumingMulticallHashField`<br>`TestPollerLiveRoundWritesAnchorAndBoundObservations`<br>`TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates`<br>`TestPollerRoundPersistsHashAnchor` |
| M10 | **KILLED** | the multicall executes AT the pin the round verified — the pinned height and the header-verified height are the same N, or the anchor describes a block nobody read | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead` |
| M11 | **KILLED** | with no exploration hint and no attribution pin, the round resolves from the endpoint the shared hint names (read, never written) — not from a hard-coded index | `TestPollerRoundIsEndpointCoherentAndPinnedAtHead`<br>`TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier` |
| M12 | **KILLED** | the pin is forwarded to eth_call: a CallAtFrom that executes at 'latest' is indistinguishable from Call at the RPC layer and would reintroduce the unverifiable-round defect one layer down | `TestCallAtFromPinsBlockAndLeavesSharedHintAlone`<br>`TestCallAtFromWrapsModuloAndRotatesOnError` |
| M13 | **KILLED** | the attempt walk starts at exactly the caller's requested endpoint (CallFrom's caller-scoped discipline): starting anywhere else silently hands the pinned call to a chain view the caller did not resolve | `TestCallAtFromPinsBlockAndLeavesSharedHintAlone`<br>`TestCallAtFromWrapsModuloAndRotatesOnError` |

13 mutants, 13 killed, 0 survived.
