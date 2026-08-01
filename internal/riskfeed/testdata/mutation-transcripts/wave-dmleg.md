# Mutation transcript — DM duplicate-leg fix wave (borrow token held as collateral)

Durable mutation evidence for the first-full-book riskd failure fix: a Debt
Manager account holding the BORROW TOKEN as collateral (USDC on both sides —
7,503 of ~9,700 live DM accounts) made `assembleDM` emit two
`risk_position_legs` rows for one asset, violating the (batch, engine,
account, asset) primary key. The fix folds both sides onto ONE row (the union
shape the schema was built for) and teaches the serve-layer reconstruction
that a leg with `amount` NULL is a PURE DEBT leg, not zero collateral.

This file starts the in-package durable convention for `internal/riskfeed`
(`testdata/mutation-transcripts/`), mirroring `internal/store`'s.

## Spec — written BEFORE the loop

Three behavioural mutants, the first two named by the wave brief:

- **M1 — the merge dropped back to double-insert** (`internal/riskfeed/assemble.go`):
  the `legIdx` branch in `assembleDM`'s collateral loop deleted, so the
  collateral side APPENDS a second row for an asset that already has a debt
  leg — byte-for-byte the pre-fix code. Expected kill:
  `TestAssembleDMBorrowTokenHeldAsCollateralMergesToOneLeg` (3 legs, USDC on
  two of them, against `require.Len(p.Legs, 2)` and the one-row-per-asset
  walk).
- **M2 — a merge that silently overwrites the debt side**
  (`internal/riskfeed/assemble.go`): the fold replaced with a whole-row
  REPLACEMENT — `legs[i] = <collateral-only row>` — so the collateral side
  lands and ScaledDebt / LiveDebt / DebtIndexBlock silently vanish. The
  position's HF / maxBorrow / borrowings stay CORRECT (they never read the
  legs), which is exactly why this mutant needs the leg-exactness welds.
  Expected kill: the same test's merged-leg field assertions and the
  Σ legs' live_debt == borrowings weld.
- **M3 — the serve-side debt weld deleted** (`cmd/api/read.go`): the
  `liveDebtSum` comparison against `p.Borrowings` removed from
  `verifyReconstruction`'s DM arm, so a batch row whose debt legs disagree
  with the borrowings it served would be verified anyway. Expected kill:
  `TestVerifyReconstructionRejectsEveryTamperedField/debt_manager/debt leg
  live_debt off by one` and `/debt manager merged leg/debt side dropped from
  the merged leg` (both expect an error that the mutant stops producing).

Kill-suite commands (pure tests, no DB):

- M1, M2: `go test ./internal/riskfeed -run 'TestAssembleDMBorrowTokenHeldAsCollateralMergesToOneLeg' -count=1`
- M3: `go test ./cmd/api -run 'TestVerifyReconstructionRejectsEveryTamperedField' -count=1`

Fixed-file sha256 (before-hash AND required after-restore hash):

- `internal/riskfeed/assemble.go`
  `69ffed7270c21b09a8f1323beca932bdfc9bee488794f511584f4cc3669e8d82`
- `cmd/api/read.go`
  `df2f67e7b32098f749b36919906d6f7b94f91ce8ad7efc17b2873027760a140d`

## Results — 3/3 KILLED, every restore byte-identical

### M1 — double-insert restored (pre-fix code)

Mutated-file sha256:
`678a8332c61a45009a856e48b9add743be3f2354f554a30e0d01a560e2f6191f`

The `legIdx` branch replaced with the unconditional append. KILLED (exit 1) by
`TestAssembleDMBorrowTokenHeldAsCollateralMergesToOneLeg`:

```
Error: "[{0b2c…ff85 6 1000000000 … 7240549 7240549 5792439 …}
         {0b2c…ff85 6 <nil> …      7240549 7240549 5792439 …}
         {5a7f…cbff 18 …}]" should have 2 item(s), but has 3
```

The failure output shows BOTH pre-fix pathologies at once: USDC on two rows
(the duplicate-key write against the live book), and `mergeDMLegs` decorating
BOTH same-asset rows with the same collateral outputs (value_usd 7240549 /
contribution 5792439 on the debt row too) — a double-disclosure that a
side-column schema would have silently served.

Restore verified: sha256 back to `69ffed72…e8d82`; kill suite green.

### M2 — the fold replaced with a whole-row replacement (debt side dropped)

Mutated-file sha256:
`9d4a44761e5f288ace4154826e3cecbbffd40076c13937181c1bc280365bdcc0`

`legs[i].Amount = amount` (etc.) replaced with `legs[i] = <collateral-only
row>`. The position's HF / borrowings / maxBorrow stayed CORRECT under this
mutant — the health math never reads the legs — which is why only a
leg-exactness assertion can catch it. KILLED (exit 1):

```
Error: Not equal: expected: "1000000000"  actual: "<nil>"
Messages: debt side: normalized borrowing
```

(and the Σ live_debt == borrowings weld further down would have fired next).

Restore verified: sha256 back to `69ffed72…e8d82`; kill suite green.

### M3 — the serve-side debt weld deleted (`cmd/api/read.go`)

Mutated-file sha256:
`f8e95960bd976b6f0b83a103a04f40de2ae9106098b873f0ae11d4d2d7f8d523`

The `liveDebtSum.Cmp(cloneOrZero(p.Borrowings))` refusal removed from
`verifyReconstruction`'s DM arm. KILLED (exit 1) by THREE subtests of
`TestVerifyReconstructionRejectsEveryTamperedField`:

```
--- FAIL: …/debt_manager/debt_leg_live_debt_off_by_one         (expected error, got nil)
--- FAIL: …/debt_manager_merged_leg/merged_leg_live_debt_halved (expected error, got nil)
--- FAIL: …/debt_manager_merged_leg/debt_side_dropped_from_the_merged_leg (expected error, got nil)
```

Restore verified: sha256 back to `df2f67e7…a140d`;
`TestVerifyReconstructionRejectsEveryTamperedField|TestReconstructDM` green.
