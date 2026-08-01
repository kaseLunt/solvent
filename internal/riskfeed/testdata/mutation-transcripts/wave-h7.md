# Mutation transcript — wave H7 (the DM USD scale is STRUCTURAL, never witness-inferred)

Durable mutation evidence for the Codex round-6 [HIGH] fix: a debt-only Debt
Manager position (nonzero debt, a SUCCESSFUL sweep that observed EMPTY
collateral — a state `ApplySweepBatch` explicitly supports) consults no price
witnesses, so revision 4 inferred `value_decimals` from the empty witness set
and persisted 0 over USD-6 borrowings. Live batch 3 carried 44 such rows
(borrowings 1 raw unit each — $0.000001 served as $1, a 10^6 overstatement),
under an engine aggregate correctly declared at 6, and the serve-time
reconstruction verified the debt SUM but never the SCALE, so it passed them
through as computed.

The fix: `risk.DMUsdDecimals = 6` declared at the engine (`ComputeDMHealth`
sets it structurally and refuses witnesses at any other scale,
`ErrWrongPriceScale`), written as the constant at assembly (`assembleDM`),
and welded at the serving surface (`verifyReconstruction` refuses any DM row
whose persisted `value_decimals` differs from the engine's declared scale;
the Aave arm gets the analogous witness-backed check). `AlgorithmRevision`
4 → 5, so the corrected binary cannot adopt batch 3.

## Spec — written BEFORE the loop

Two behavioural mutants, both named by the wave brief:

- **M1 — revert to inferred decimals** (`internal/risk/dm.go` +
  `internal/riskfeed/assemble.go`): the pre-fix flow at both layers —
  `ComputeDMHealth` goes back to `out.UsdDecimals = <witness-inferred>` with
  the `ErrWrongPriceScale` guard deleted, and `assembleDM` goes back to
  `p.ValueDecimals = h.UsdDecimals`. Byte-for-byte the revision-4 defect.
  Expected kill:
  - `TestComputeDMHealthDebtOnlyCarriesStructuralUSD6Scale` (UsdDecimals 0
    with zero witnesses),
  - `TestComputeDMHealthRefusesAWitnessNotAtTheEngineScale` (USD-8 witness
    absorbed without error),
  - `TestAssembleDMDebtOnlyAfterEmptySweepCarriesUSD6Scale` (assembled
    ValueDecimals 0, disagreeing with the aggregate's declared 6).
- **M2 — the serve-side scale weld deleted** (`cmd/api/read.go`): the
  `uint8(p.ValueDecimals) != h.UsdDecimals` refusal removed from
  `verifyReconstruction`'s DM arm, so a hand-written (or legacy-batch)
  wrong-scale row would be verified and served as computed again. Expected
  kill: `TestVerifyReconstructionRejectsEveryTamperedField` subtests
  `debt_manager/value_decimals_zeroed`, `debt_manager/value_decimals_inflated`
  and `debt_manager_debt-only_wrong_scale` (each hand-writes a wrong-scale
  position and demands refusal).

Kill-suite commands (pure tests, no DB):

- M1: `go test ./internal/risk -run 'TestComputeDMHealthDebtOnlyCarriesStructuralUSD6Scale|TestComputeDMHealthRefusesAWitnessNotAtTheEngineScale' -count=1`
      and `go test ./internal/riskfeed -run 'TestAssembleDMDebtOnlyAfterEmptySweepCarriesUSD6Scale' -count=1`
- M2: `go test ./cmd/api -run 'TestVerifyReconstructionRejectsEveryTamperedField' -count=1`

Fixed-file sha256 (before-hash AND required after-restore hash):

- `internal/risk/dm.go`
  `73d352d48c86e5c904a6106e560cba152de80234b3dff0876c85d1c5317d2e4a`
- `internal/riskfeed/assemble.go`
  `7c116298011913c4a4bf0281e339d4d5b83925ffd47b4f241fcfbe4b51f98b93`
- `cmd/api/read.go`
  `3c7ae18be8014ce3e5ba78dc747b3acb818baa261842995fbbae3ccde74679dc`

## Results — 2/2 KILLED, every restore byte-identical

### M1 — inferred decimals restored at both layers (the revision-4 defect)

Mutated-file sha256:

- `internal/risk/dm.go`
  `12cbf071398a09c807d2906f698046e8e692c80ab4f3b567fefae28554f649ff`
  (`out.UsdDecimals = witnessDecimals`, ErrWrongPriceScale guard deleted,
  `fmt` import dropped — the pre-fix flow)
- `internal/riskfeed/assemble.go`
  `1eed3d26baff6bc0c6d12c9bdfdfa77aa1c38ba674c6e17eaaf28bbcd7b21b56`
  (`p.ValueDecimals = h.UsdDecimals`)

KILLED (both suites FAIL) by all three named tests:

```
--- FAIL: TestComputeDMHealthDebtOnlyCarriesStructuralUSD6Scale
        expected: 0x6  actual: 0x0
--- FAIL: TestComputeDMHealthRefusesAWitnessNotAtTheEngineScale
        An error is expected but got nil.
--- FAIL: TestAssembleDMDebtOnlyAfterEmptySweepCarriesUSD6Scale
        expected: int(6)  actual: uint8(0x0)
```

The assembly failure is the live defect verbatim: the debt-only position's
ValueDecimals collapses to 0 while the engine aggregate beside it declares 6.

Restore verified: sha256 back to `73d352d4…7d2e4a` (dm.go) and
`7c116298…f98b93` (assemble.go); kill suites green.

### M2 — the serve-side scale weld deleted (`cmd/api/read.go`)

Mutated-file sha256:
`26396e5d406382dc169c6c1697ce36a416d25d00b2a7da0cf137cecc86625f0d`

The `uint8(p.ValueDecimals) != h.UsdDecimals` refusal removed from
`verifyReconstruction`'s DM arm. KILLED (exit 1) by THREE tamper subtests,
each of which hand-writes a wrong-scale position and demands refusal:

```
--- FAIL: …/debt_manager/value_decimals_zeroed        (expected error, got nil)
--- FAIL: …/debt_manager/value_decimals_inflated      (expected error, got nil)
--- FAIL: …/debt_manager_debt-only_wrong_scale        (expected error, got nil)
```

The third subtest is byte-for-byte the live batch-3 row shape (debt-only,
internally consistent sums, value_decimals 0): under this mutant it verifies
and would be SERVED as computed — which is exactly what the pre-fix API did.

Restore verified: sha256 back to `3c7ae18b…4679dc`;
`TestVerifyReconstructionRejectsEveryTamperedField|TestReconstructDM` green.
