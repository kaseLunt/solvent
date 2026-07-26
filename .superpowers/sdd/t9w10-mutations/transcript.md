# mutation transcript

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **tested SHA: `dc6782bfc623cc9b893ca3ac7e056a4321c8c904`**  (test(reconcile): wave-10 mutation spec (19 mutants, committed before the loop) + extractable schema-gate decision)
- started (UTC): 2026-07-26T19:47:11+00:00
- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`

## W10M1 — bridge floor→ceil (brief target 1): mulDivFloor becomes mulDivCeil

**Property under attack:** the §3.3 bridge is EXACTLY the contract's floor (DebtManagerStorageContract.sol:520-522) — a ceil manufactures 1-wei USD drift on every remainder-bearing row; killed by TestMulDivFloorBridge's n=1, I=1e18+1 case (floor 1, ceil 2) and the recon validation triple

```diff
--- cmd/reconcile/dm.go:38
-	out := new(big.Int).Mul(n, index)
-	return out.Quo(out, wad)
+	out := new(big.Int).Mul(n, index)
+	out.Add(out, new(big.Int).Sub(wad, big.NewInt(1)))
+	return out.Quo(out, wad)
```
APPLIED at cmd/reconcile/dm.go:38 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestMulDivFloorBridge -count=1`

Killed by:
  - `TestMulDivFloorBridge`

**Result: KILLED**

## W10M2 — migration_genesis dropped from the as-of sum predicate (brief target 2)

**Property under attack:** as-of sums include EVERY delta-bearing event type, migration_genesis above all — the majority of DM debt genesis enters derived state only through those rows; killed by TestAsOfEventSumsIncludesMigrationGenesisAndBoundary (sum 1050 becomes 50 under the mutant)

```diff
--- internal/store/reconcile.go:264
-       AND block_number <= $3 AND delta IS NOT NULL
-		 GROUP BY account, asset, side
+       AND block_number <= $3 AND delta IS NOT NULL AND event_type <> 'migration_genesis'
+		 GROUP BY account, asset, side
```
APPLIED at internal/store/reconcile.go:264 (1 occurrence, asserted)

`go test ./internal/store/ -run TestAsOfEventSumsIncludesMigrationGenesisAndBoundary -count=1`

Killed by:
  - `TestAsOfEventSumsIncludesMigrationGenesisAndBoundary`

**Result: KILLED**

## W10M3 — as-of boundary <= → < (verification-bar target 'as-of sum boundary')

**Property under attack:** the boundary is INCLUSIVE: ApplyDerived commits events THROUGH the cursor block atomically with it, so an event AT P is part of the pinned state; killed by TestAsOfEventSumsIncludesMigrationGenesisAndBoundary's boundary event at exactly P (1050 becomes 1000)

```diff
--- internal/store/reconcile.go:264
-       AND block_number <= $3 AND delta IS NOT NULL
-		 GROUP BY account, asset, side
+       AND block_number < $3 AND delta IS NOT NULL
+		 GROUP BY account, asset, side
```
APPLIED at internal/store/reconcile.go:264 (1 occurrence, asserted)

`go test ./internal/store/ -run TestAsOfEventSumsIncludesMigrationGenesisAndBoundary -count=1`

Killed by:
  - `TestAsOfEventSumsIncludesMigrationGenesisAndBoundary`

**Result: KILLED**

## W10M4 — set-equality weakened to subset (brief target 3): the chain-only arm deleted

**Property under attack:** the token-set equality is BIDIRECTIONAL (§3.3): a chain token the DB never derived is a derivation miss — exactly the leg a subset check silently passes; killed by TestCompareDMRowZeroTrimSetEquality's derivation-miss case (SetEqual stays true under the mutant)

```diff
--- cmd/reconcile/dm.go:142
-		if onChain && !inDB {
-			row.SetEqual = false
-			row.SetOnlyChain = append(row.SetOnlyChain, tok.Hex())
-		}
+		// MUTANT W10M4: chain-only tokens no longer break set equality (subset check)
+		_ = onChain
```
APPLIED at cmd/reconcile/dm.go:142 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestCompareDMRowZeroTrimSetEquality -count=1`

Killed by:
  - `TestCompareDMRowZeroTrimSetEquality`

**Result: KILLED**

## W10M5 — scan 2 IS DISTINCT FROM → = (brief target 4, arm 1)

**Property under attack:** scan 2's predicate selects DISAGREEMENTS; '=' selects agreements — the healthy matched pair becomes a violation row and every seeded orphan vanishes; killed by TestInvariantScan2EventSumFalsifiability (both the empty-pristine and seeded-violation assertions invert)

```diff
--- internal/store/invariants.go:73
-WHERE ev.total IS DISTINCT FROM bal.amount
+WHERE ev.total = bal.amount
```
APPLIED at internal/store/invariants.go:73 (1 occurrence, asserted)

`go test ./internal/store/ -run TestInvariantScan2EventSumFalsifiability -count=1`

Killed by:
  - `TestInvariantScan2EventSumFalsifiability`

**Result: KILLED**

## W10M5b — scan 2 zero-sum allowance re-added (brief target 4, arm 2 — the L0-4 regression)

**Property under attack:** a zero-sum event group with a MISSING balance row is a REAL orphan (both live apply and the rewind rebuild always materialize amount-0 rows) — the allowance makes that class a fixture-that-cannot-fail; killed by TestInvariantScan2EventSumFalsifiability's violation class 1 (expected 1 row, mutant returns 0)

```diff
--- internal/store/invariants.go:73
-WHERE ev.total IS DISTINCT FROM bal.amount
+WHERE ev.total IS DISTINCT FROM bal.amount
+  AND NOT (ev.total = 0 AND bal.amount IS NULL)
```
APPLIED at internal/store/invariants.go:73 (1 occurrence, asserted)

`go test ./internal/store/ -run TestInvariantScan2EventSumFalsifiability -count=1`

Killed by:
  - `TestInvariantScan2EventSumFalsifiability`

**Result: KILLED**

## W10M6 — scan 1 HAVING > 1 → >= 1 (brief target 5)

**Property under attack:** exactly one hash per height is the HEALTHY case; >= 1 flags every populated height; killed by TestInvariantScan1DistinctHashFalsifiability's pristine assertion (empty becomes 2 rows under the mutant)

```diff
--- internal/store/invariants.go:34
-HAVING COUNT(DISTINCT block_hash) > 1
+HAVING COUNT(DISTINCT block_hash) >= 1
```
APPLIED at internal/store/invariants.go:34 (1 occurrence, asserted)

`go test ./internal/store/ -run TestInvariantScan1DistinctHashFalsifiability -count=1`

Killed by:
  - `TestInvariantScan1DistinctHashFalsifiability`

**Result: KILLED**

## W10M7 — scan 3 comparison inverted (brief target 6)

**Property under attack:** borrow_index is monotonic NON-DECREASING; the inverted predicate flags the healthy increase and misses the seeded regression; killed by TestInvariantScan3BorrowIndexFalsifiability on both arms

```diff
--- internal/store/invariants.go:89
-kind = 'borrow_index'
-) t
-WHERE prev_value IS NOT NULL AND value < prev_value
+kind = 'borrow_index'
+) t
+WHERE prev_value IS NOT NULL AND value > prev_value
```
APPLIED at internal/store/invariants.go:89 (1 occurrence, asserted)

`go test ./internal/store/ -run TestInvariantScan3BorrowIndexFalsifiability -count=1`

Killed by:
  - `TestInvariantScan3BorrowIndexFalsifiability`

**Result: KILLED**

## W10M8 — REQUIRE_DATA escalation removed — skip becomes the only empty-population outcome (brief target 7)

**Property under attack:** under SOLVENT_INVARIANT_REQUIRE_DATA=1 an empty population is a FAILURE, never a skip — the receipt command sets the variable precisely so the evidence run cannot vacuously pass against an empty or wrong database; killed by TestRequireDataVerdictEscalation

```diff
--- internal/store/invariants.go:356
-	if requireData {
-		return VerdictFail
-	}
-	return VerdictSkip
+	_ = requireData // MUTANT W10M8: the escalation is gone — empty always skips
+	return VerdictSkip
```
APPLIED at internal/store/invariants.go:356 (1 occurrence, asserted)

`go test ./internal/store/ -run TestRequireDataVerdictEscalation -count=1`

Killed by:
  - `TestRequireDataVerdictEscalation`

**Result: KILLED**

## W10M9 — classifier misfiles state-pruned as transport-throttle (brief target 8)

**Property under attack:** state-pruned is the ARCHIVE-CAPABILITY verdict (exit 2 at a golden pin), never a backoff-and-retry class; killed by TestClassifierBucketTable + TestClassifierPrunedIsNeverThrottle + TestRunnerPrunedOnlyAfterFullBudget (the terminal class assertion flips to throttle)

```diff
--- cmd/reconcile/rpcclass.go:68
-			return classStatePruned
+			return classThrottle // MUTANT W10M9: pruned misfiled as retryable
```
APPLIED at cmd/reconcile/rpcclass.go:68 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestClassifier|TestRunnerPrunedOnlyAfterFullBudget -count=1`

Killed by:
  - `TestClassifierBucketTable`
  - `TestClassifierPrunedIsNeverThrottle`
  - `TestRunnerPrunedOnlyAfterFullBudget`

**Result: KILLED**

## W10M10 — residue classification without the fully_liquidated predicate (brief target 9)

**Property under attack:** the F2 hypothesis is scoped to FULLY-LIQUIDATED accounts: the silent zeroing mechanism (DebtManagerCore.sol:550-553) only fires there, so the same numeric shape on a live account is a DIFFERENT bug that must stay unclassified; killed by TestResidueShapedExactHypothesis's first case

```diff
--- cmd/reconcile/dm.go:209
-	if !fullyLiquidated || hasResidueEvent {
-		return false
-	}
+	if hasResidueEvent { // MUTANT W10M10: the fully_liquidated predicate is gone
+		return false
+	}
```
APPLIED at cmd/reconcile/dm.go:209 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestResidueShapedExactHypothesis -count=1`

Killed by:
  - `TestResidueShapedExactHypothesis`

**Result: KILLED**

## W10M11 — rewind re-check trusts MAX(reorg_epochs.epoch) instead of acked_epoch (brief target 10)

**Property under attack:** PruneAckedReorgEpochs deletes acked epochs, so a rewind+ack+prune cycle mid-run leaves MAX unchanged while acked_epoch moved (RewindDerived always bumps it, acks are monotone) — the MAX-trusting detector is silent on exactly that hole; killed by TestRewindMovedIsPruneImmune

```diff
--- cmd/reconcile/main.go:396
-		if cur.AckedEpoch != baseline.AckedEpoch[e] {
+		if baseline.MaxEpoch[cur.ChainID] != baseline.MaxEpoch[cur.ChainID] { // MUTANT W10M11: trusts the prunable MAX signal
```
APPLIED at cmd/reconcile/main.go:396 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestRewindMovedIsPruneImmune -count=1`

Killed by:
  - `TestRewindMovedIsPruneImmune`

**Result: KILLED**

## W10M12 — golden Row A replaced by fixture comparison (brief target 11)

**Property under attack:** Row A is the LITERAL W1 clause: a live pinned chain read at 25,584,990 — never a fixture substitute (constants never cross pins, L0-2); killed by TestGoldenRowAIsALiveChainReadAtTheW1Pin (Row A's chain leg stops being the live value) and TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead (the mutant PASSES a DB that merely matches the fixtures)

```diff
--- cmd/reconcile/golden.go:263
-				if spec.row == "A" {
-					row.Verdict = compareScaled(derived, chainScaled)
-				} else {
+				if spec.row == "A" { // MUTANT W10M12: Row A compares against the fixture constant, not the live read
+					fixture, _ := new(big.Int).SetString(l.fixture, 10)
+					row.Chain = fixture.String()
+					row.Verdict = compareScaled(derived, fixture)
+				} else {
```
APPLIED at cmd/reconcile/golden.go:263 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestGoldenRowA -count=1`

Killed by:
  - `TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead`
  - `TestGoldenRowAIsALiveChainReadAtTheW1Pin`

**Result: KILLED**

## W10M13 — resolved seed not echoed into the artifact (brief target 12)

**Property under attack:** a run whose artifact does not carry the resolved seed is unreproducible — the default seed is the OP pin hash, which exists nowhere else; killed by TestArtifactEchoesResolvedSeed

```diff
--- cmd/reconcile/main.go:166
-	run["seed_resolved"] = seed
+	_ = seed // MUTANT W10M13: the seed is never echoed
```
APPLIED at cmd/reconcile/main.go:166 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestArtifactEchoesResolvedSeed -count=1`

Killed by:
  - `TestArtifactEchoesResolvedSeed`

**Result: KILLED**

## W10M14 — DSN-identity tripwire disabled (verification-bar target 'tripwire')

**Property under attack:** identical test and live database identities MUST kill the run at Phase 0 (exit 2) — the destructive suite pointed at the live database is the single worst hazard this wave closes (L2-1); killed by TestDSNTripwireDetectsSameDatabase

```diff
--- cmd/reconcile/main.go:928
-	return reconID == testID
+	return false // MUTANT W10M14: the tripwire never fires
```
APPLIED at cmd/reconcile/main.go:928 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestDSNTripwireDetectsSameDatabase -count=1`

Killed by:
  - `TestDSNTripwireDetectsSameDatabase`

**Result: KILLED**

## W10M15 — schema gate exact-match weakened to >= (verification-bar target 'schema gate')

**Property under attack:** the gate is EXACT both directions: a database ahead of the binary may have reshaped the tables the compiled queries read; killed by TestSchemaGateIsExactBothDirections (got=9, expected=8 must refuse)

```diff
--- cmd/reconcile/main.go:937
-	return got == expected
+	return got >= expected // MUTANT W10M15: a future schema passes the gate
```
APPLIED at cmd/reconcile/main.go:937 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestSchemaGateIsExactBothDirections -count=1`

Killed by:
  - `TestSchemaGateIsExactBothDirections`

**Result: KILLED**

## W10M16 — strata partition precedence inverted (verification-bar target 'strata partition')

**Property under attack:** the strata are a DISJOINT PRECEDENCE partition: liquidated beats migrated — an account with both histories belongs to the liquidated stratum (residue probes live there); killed by TestSampleDMBorrowersStrataPrecedenceAndDeterminism (the liq+mig account classifies migrated under the mutant)

```diff
--- internal/store/reconcile.go:324
-       CASE WHEN liquidated THEN 'liquidated'
-            WHEN migrated  THEN 'migrated'
+       CASE WHEN migrated THEN 'migrated'
+            WHEN liquidated  THEN 'liquidated'
```
APPLIED at internal/store/reconcile.go:324 (1 occurrence, asserted)

`go test ./internal/store/ -run TestSampleDMBorrowersStrataPrecedenceAndDeterminism -count=1`

Killed by:
  - `TestSampleDMBorrowersStrataPrecedenceAndDeterminism`

**Result: KILLED**

## W10M17 — F1 aggregate weld computed over sampled accounts only (risk-quant amendment's NAMED mutation target)

**Property under attack:** the weld's derived side is the ALL-ACCOUNTS census — the sampling universe is position_events, so a never-derived borrower is structurally unselectable and ONLY the whole-table aggregate can catch phantom debt; the sampled aggregation exists solely as a coverage diagnostic; killed by TestComputeDMWeldInputsCoversAllAccounts (All shows 400 where the census says 1000)

```diff
--- cmd/reconcile/phase2.go:340
-	return dmWeldInputs{
-		All:          p1.dmAllNet,
-		SampleTotals: assetNetSumsFromSample(p1.dmAsOf),
-	}
+	// MUTANT W10M17: the weld census is the SAMPLE, not the whole table
+	sample := assetNetSumsFromSample(p1.dmAsOf)
+	all := make([]store.AssetNetSum, 0, len(sample))
+	for k, v := range sample {
+		b, _ := hex.DecodeString(k)
+		all = append(all, store.AssetNetSum{Asset: b, Total: v})
+	}
+	return dmWeldInputs{All: all, SampleTotals: sample}
```
APPLIED at cmd/reconcile/phase2.go:340 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestComputeDMWeldInputsCoversAllAccounts -count=1`

Killed by:
  - `TestComputeDMWeldInputsCoversAllAccounts`

**Result: KILLED**

## W10M18 — tolerance-laundering guard removed (verification-bar target 'tolerance arms')

**Property under attack:** ANY nonzero -tolerance-dm-wei forces result=fail-with-tolerance structurally — a tolerance can never launder into a pass receipt, even with zero gated failures (§3.5); killed by TestNonzeroToleranceCannotProducePass

```diff
--- cmd/reconcile/main.go:421
-	if toleranceDMWei != 0 {
-		return "fail-with-tolerance", exitVerdictFail
-	}
+	_ = toleranceDMWei // MUTANT W10M18: tolerance no longer forces fail-with-tolerance
```
APPLIED at cmd/reconcile/main.go:421 (1 occurrence, asserted)

`go test ./cmd/reconcile/ -run TestNonzeroToleranceCannotProducePass -count=1`

Killed by:
  - `TestNonzeroToleranceCannotProducePass`

**Result: KILLED**

## W10M19 — scan 5 loses the repay arm of its debt-mutating event list (verification-bar target 'invariant scans', F5.2 specificity)

**Property under attack:** same-block IIU coverage must hold for EVERY debt-mutating event type (borrow/repay/liquidation price through the same-block index); killed by TestInvariantScan5IIUCoverageFalsifiability's seeded repay gap (expected 1 row, mutant returns 0)

```diff
--- internal/store/invariants.go:141
-AND e.event_type IN ('borrow','repay','liquidation')
+AND e.event_type IN ('borrow','liquidation')
```
APPLIED at internal/store/invariants.go:141 (1 occurrence, asserted)

`go test ./internal/store/ -run TestInvariantScan5IIUCoverageFalsifiability -count=1`

Killed by:
  - `TestInvariantScan5IIUCoverageFalsifiability`

**Result: KILLED**

## restore verification

`git status --porcelain` over the 7 mutated file(s) is EMPTY: every file is byte-identical to `dc6782b`. Restores came from in-memory copies taken before each edit; `git checkout` is never used.

## summary

| # | result | property | killed by |
|---|---|---|---|
| W10M1 | **KILLED** | the §3.3 bridge is EXACTLY the contract's floor (DebtManagerStorageContract.sol:520-522) — a ceil manufactures 1-wei USD drift on every remainder-bearing row; killed by TestMulDivFloorBridge's n=1, I=1e18+1 case (floor 1, ceil 2) and the recon validation triple | `TestMulDivFloorBridge` |
| W10M2 | **KILLED** | as-of sums include EVERY delta-bearing event type, migration_genesis above all — the majority of DM debt genesis enters derived state only through those rows; killed by TestAsOfEventSumsIncludesMigrationGenesisAndBoundary (sum 1050 becomes 50 under the mutant) | `TestAsOfEventSumsIncludesMigrationGenesisAndBoundary` |
| W10M3 | **KILLED** | the boundary is INCLUSIVE: ApplyDerived commits events THROUGH the cursor block atomically with it, so an event AT P is part of the pinned state; killed by TestAsOfEventSumsIncludesMigrationGenesisAndBoundary's boundary event at exactly P (1050 becomes 1000) | `TestAsOfEventSumsIncludesMigrationGenesisAndBoundary` |
| W10M4 | **KILLED** | the token-set equality is BIDIRECTIONAL (§3.3): a chain token the DB never derived is a derivation miss — exactly the leg a subset check silently passes; killed by TestCompareDMRowZeroTrimSetEquality's derivation-miss case (SetEqual stays true under the mutant) | `TestCompareDMRowZeroTrimSetEquality` |
| W10M5 | **KILLED** | scan 2's predicate selects DISAGREEMENTS; '=' selects agreements — the healthy matched pair becomes a violation row and every seeded orphan vanishes; killed by TestInvariantScan2EventSumFalsifiability (both the empty-pristine and seeded-violation assertions invert) | `TestInvariantScan2EventSumFalsifiability` |
| W10M5b | **KILLED** | a zero-sum event group with a MISSING balance row is a REAL orphan (both live apply and the rewind rebuild always materialize amount-0 rows) — the allowance makes that class a fixture-that-cannot-fail; killed by TestInvariantScan2EventSumFalsifiability's violation class 1 (expected 1 row, mutant returns 0) | `TestInvariantScan2EventSumFalsifiability` |
| W10M6 | **KILLED** | exactly one hash per height is the HEALTHY case; >= 1 flags every populated height; killed by TestInvariantScan1DistinctHashFalsifiability's pristine assertion (empty becomes 2 rows under the mutant) | `TestInvariantScan1DistinctHashFalsifiability` |
| W10M7 | **KILLED** | borrow_index is monotonic NON-DECREASING; the inverted predicate flags the healthy increase and misses the seeded regression; killed by TestInvariantScan3BorrowIndexFalsifiability on both arms | `TestInvariantScan3BorrowIndexFalsifiability` |
| W10M8 | **KILLED** | under SOLVENT_INVARIANT_REQUIRE_DATA=1 an empty population is a FAILURE, never a skip — the receipt command sets the variable precisely so the evidence run cannot vacuously pass against an empty or wrong database; killed by TestRequireDataVerdictEscalation | `TestRequireDataVerdictEscalation` |
| W10M9 | **KILLED** | state-pruned is the ARCHIVE-CAPABILITY verdict (exit 2 at a golden pin), never a backoff-and-retry class; killed by TestClassifierBucketTable + TestClassifierPrunedIsNeverThrottle + TestRunnerPrunedOnlyAfterFullBudget (the terminal class assertion flips to throttle) | `TestClassifierBucketTable`<br>`TestClassifierPrunedIsNeverThrottle`<br>`TestRunnerPrunedOnlyAfterFullBudget` |
| W10M10 | **KILLED** | the F2 hypothesis is scoped to FULLY-LIQUIDATED accounts: the silent zeroing mechanism (DebtManagerCore.sol:550-553) only fires there, so the same numeric shape on a live account is a DIFFERENT bug that must stay unclassified; killed by TestResidueShapedExactHypothesis's first case | `TestResidueShapedExactHypothesis` |
| W10M11 | **KILLED** | PruneAckedReorgEpochs deletes acked epochs, so a rewind+ack+prune cycle mid-run leaves MAX unchanged while acked_epoch moved (RewindDerived always bumps it, acks are monotone) — the MAX-trusting detector is silent on exactly that hole; killed by TestRewindMovedIsPruneImmune | `TestRewindMovedIsPruneImmune` |
| W10M12 | **KILLED** | Row A is the LITERAL W1 clause: a live pinned chain read at 25,584,990 — never a fixture substitute (constants never cross pins, L0-2); killed by TestGoldenRowAIsALiveChainReadAtTheW1Pin (Row A's chain leg stops being the live value) and TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead (the mutant PASSES a DB that merely matches the fixtures) | `TestGoldenRowAFailsWhenDBDisagreesWithTheLiveRead`<br>`TestGoldenRowAIsALiveChainReadAtTheW1Pin` |
| W10M13 | **KILLED** | a run whose artifact does not carry the resolved seed is unreproducible — the default seed is the OP pin hash, which exists nowhere else; killed by TestArtifactEchoesResolvedSeed | `TestArtifactEchoesResolvedSeed` |
| W10M14 | **KILLED** | identical test and live database identities MUST kill the run at Phase 0 (exit 2) — the destructive suite pointed at the live database is the single worst hazard this wave closes (L2-1); killed by TestDSNTripwireDetectsSameDatabase | `TestDSNTripwireDetectsSameDatabase` |
| W10M15 | **KILLED** | the gate is EXACT both directions: a database ahead of the binary may have reshaped the tables the compiled queries read; killed by TestSchemaGateIsExactBothDirections (got=9, expected=8 must refuse) | `TestSchemaGateIsExactBothDirections` |
| W10M16 | **KILLED** | the strata are a DISJOINT PRECEDENCE partition: liquidated beats migrated — an account with both histories belongs to the liquidated stratum (residue probes live there); killed by TestSampleDMBorrowersStrataPrecedenceAndDeterminism (the liq+mig account classifies migrated under the mutant) | `TestSampleDMBorrowersStrataPrecedenceAndDeterminism` |
| W10M17 | **KILLED** | the weld's derived side is the ALL-ACCOUNTS census — the sampling universe is position_events, so a never-derived borrower is structurally unselectable and ONLY the whole-table aggregate can catch phantom debt; the sampled aggregation exists solely as a coverage diagnostic; killed by TestComputeDMWeldInputsCoversAllAccounts (All shows 400 where the census says 1000) | `TestComputeDMWeldInputsCoversAllAccounts` |
| W10M18 | **KILLED** | ANY nonzero -tolerance-dm-wei forces result=fail-with-tolerance structurally — a tolerance can never launder into a pass receipt, even with zero gated failures (§3.5); killed by TestNonzeroToleranceCannotProducePass | `TestNonzeroToleranceCannotProducePass` |
| W10M19 | **KILLED** | same-block IIU coverage must hold for EVERY debt-mutating event type (borrow/repay/liquidation price through the same-block index); killed by TestInvariantScan5IIUCoverageFalsifiability's seeded repay gap (expected 1 row, mutant returns 0) | `TestInvariantScan5IIUCoverageFalsifiability` |

20 mutants, 20 killed, 0 survived.
