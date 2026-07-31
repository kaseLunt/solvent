# Mutation transcript — Wave H (accept-r4 proof-surface fix wave)

Durable mutation evidence for the accept-r4 fix wave (dm three-state verdict
law, aave one-law census, b3 unconditional binding read, tokenconfig snap-set
de-hardcode, never-seen f.use, obligation-3 third shape), following the
in-package convention started by r13.md.

## Mutant specs — COMMITTED BEFORE THE LOOP RAN

Four designed mutants, one per new law, each named by the adjudicated fix it
attacks. The kill suite for all four:

```
go test ./cmd/reconcile -count=1 -run 'TestClassifyDMMaxBorrowThreeStateLaw|TestDerivedCensusIsFlagGatedAndValueProjected|TestBuildDerivedFlagMapNeverEnabledDefaultsOff|TestProxyBindingReadIsUnconditional|TestPriorPassDrainedShapeFromTheCommittedVector'
```

- **m1 — the three-state classifier collapsed to two states.** In
  `classifyDMMaxBorrow` (dm_gate.go), delete the own-clock equality arm's
  discrimination: return `verdictSampleGap` whenever the pin values differ and
  the own-clock read answered, REGARDLESS of whether the own-clock weld holds.
  This is the dangerous collapse direction: real snapshot custody drift
  reported as a disclosed sample gap — the verdict the whole three-lane
  adjudication exists to keep gated. Expected kill:
  `TestClassifyDMMaxBorrowThreeStateLaw` (the own-unequal case must classify
  `drift`/`snapshot-custody-drift`).
- **m2 — the census flag-fold dropped.** In `derivedCensusReserves`
  (hf_gate.go), ignore the derived fold and leave `UsedAsCollateral` as handed
  in (the pinned-bitmap posture / effectively flag-blind for the census's
  purpose, since the gate seeds the fixture with `true`). This regresses the
  zero-debt census to the accept-r4 flag-blind predicate. Expected kill:
  `TestDerivedCensusIsFlagGatedAndValueProjected` (the never-enabled and
  explicitly-disabled fixtures must project ZERO).
- **m3 — the unconditional binding read made conditional again.** In
  `runHeartbeatScan` (heartbeat_scan.go), wrap the `readProxyAggregator` call
  block in a gap-conditioned `if` (the accept-r4 shape: fire only when
  something already looks wrong). Expected kill:
  `TestProxyBindingReadIsUnconditional` (the call must be a DIRECT statement
  of the per-stream loop body; any `if` nesting fails, and reintroducing the
  `needPhaseCheck` identifier fails the source assertion).
- **m4 — the third shape widened to a wildcard.** In `tryPriorPassDrained`
  (backtest.go), delete the per-element residual proof (condition 4: parent
  balance == Σ prior same-tx seizures) so any liquidatedAmt=0 all-zero-element
  event passes. This is the vacuous-pass hazard the predicate's narrowness
  exists to refuse. Expected kill:
  `TestPriorPassDrainedShapeFromTheCommittedVector` ("an unproven residual
  REJECTS the shape" — the WETH prior seizure dropped from custody must gate).

Each mutant is applied to the FIXED file, the kill suite run, the outcome
recorded verbatim, and the file restored byte-identical (sha256 before ==
after), per the r13/r14 discipline.

## Tested tree

- Branch `main`, HEAD `12db60e722f5acc5583c10a8ee3f59684443a3e6`, PLUS this
  wave's uncommitted Wave-H changes (mutants cut against the FIXED code after
  the wave's regressions went green) and Wave S's uncommitted internal/risk
  scenario changes (consumed, untouched).
- Fixed-file sha256 (the before-hash AND the after-restore hash for each
  mutant's file — every restore verified byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `24d07b6af576cd4ee45b3be4f1623e835f329458bda47cd0c2edcdd7a714bc86`
  - `cmd/reconcile/hf_gate.go`
    `374ba4afedcf1683e27d1a2763ee7d7c0ec8fa5ab896f3f6cb902e12426a9a52`
  - `cmd/reconcile/heartbeat_scan.go`
    `384635c8a78b331f96c46a8843458c0808b5b21274bd24d55a2d0e6cff539c43`
  - `cmd/reconcile/backtest.go`
    `ad81eb95668fe09f01b7c2291d38fe38ac752aeee1a327d6335bb1b924d8d7ae`
- Kill-suite: the command in the spec above; hermetic (no DB, no RPC — pure
  classifiers, the AST pin, the committed vector, and the scenario claim
  files). Fixed tree before AND after the loop: `ok` (1.2–1.3s).

## Execution — all four KILLED, one mutant at a time, restore between

### m1 — three-state classifier collapsed (dm_gate.go)

Mutated-file sha256:
`bf0b1e945407e8672dad0b663c025e6e6e3ebbc44ae51e2d86a3917d3a5edb9e`

Diff (fixed -> m1), inside `classifyDMMaxBorrow`:

```diff
-	if own.ChainMax.Cmp(own.OurMax) == 0 {
-		return verdictSampleGap, verdictSampleGap
-	}
-	return verdictDrift, "snapshot-custody-drift"
+	return verdictSampleGap, verdictSampleGap
```

KILLED by `TestClassifyDMMaxBorrowThreeStateLaw`:
`Expected "drift", Actual "sample-gap-disclosed" — an own-clock weld failure
is REAL custody drift`. The dangerous collapse (custody drift disclosed as a
sample gap) cannot survive the suite.

### m2 — census flag-fold dropped (hf_gate.go)

Mutated-file sha256:
`8ba39ee24972451af9a798d1a2d5fabc0838fae8d7b8d39801eb6ed8ecfc1d6e`

Diff (fixed -> m2), inside `derivedCensusReserves`:

```diff
 	for i, r := range reserves {
-		r.UsedAsCollateral = flags[r.Asset] // nil map => false => never-enabled is OFF
 		out[i] = r
 	}
```

KILLED by `TestDerivedCensusIsFlagGatedAndValueProjected`:
`Should be zero, but was 1 — NEVER-ENABLED (no fold row) => flag OFF => zero
projected value` (the fixture seeds the pinned-bitmap posture `true`, so
ignoring the fold IS the accept-r4 flag-blind census).

### m3 — unconditional binding read made conditional again (heartbeat_scan.go)

Mutated-file sha256:
`0d9ac3b540d6f1ad11ba9be5150c2963d5d66e27cb2c38f7bc1a92ab662a668a`

Diff (fixed -> m3), inside `runHeartbeatScan`'s stream loop:

```diff
 		bindingOK, phaseMismatch := false, false
-		agg, note, err := readProxyAggregator(ctx, c, common.HexToAddress("0x"+scan.ProxyHex))
-		if err != nil {
-			return rows, verdicts, err
-		}
+		needPhaseCheck := scan.Heartbeat > 0 && scan.Grace > scan.Heartbeat*3
+		var agg common.Address
+		note := "phase check not needed this run"
+		if needPhaseCheck {
+			var err error
+			agg, note, err = readProxyAggregator(ctx, c, common.HexToAddress("0x"+scan.ProxyHex))
+			if err != nil {
+				return rows, verdicts, err
+			}
+		}
 		if note != "" {
```

KILLED by `TestProxyBindingReadIsUnconditional` (the source assertion refuses
the reintroduced `needPhaseCheck` identifier; the AST direct-statement pin
would independently refuse the `if` nesting).

### m4 — third shape widened to a wildcard (backtest.go)

Mutated-file sha256:
`25498126078af6a0babcbcb686765bc010960f83c657e5eeaf4e2e6244b26c43`

Diff (fixed -> m4), inside `tryPriorPassDrained` — the entire per-element
residual proof loop (condition 4) deleted:

```diff
 	ok, why := true, ""
-	for _, e := range elems {
-		prior := priorSeized[e.tok]
-		... (the parentBalance == Σ prior same-tx seizures weld, per element) ...
-	}
+	_ = priorSeized
```

KILLED by `TestPriorPassDrainedShapeFromTheCommittedVector/MUTATION m4 kill:
an unproven residual REJECTS the shape`: with the WETH prior seizure dropped
from custody, the wildcard mutant still passes the case (`"0" is not
positive`), which the test refuses — a zero element whose residual balance is
not provably zero must gate.
