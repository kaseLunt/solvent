# Mutation transcript — Wave H9 (the r9 partial-liquidation basket truncation)

Durable mutation evidence for the defect this wave closes — classification
(c) harness defect behind ALL 5 r9 gated backtest failures.
`readBacktestFrameState` built the per-token subcall set from
`db.Seizures ∪ alsoPrice` only, and `readParentFrame` passes no alsoPrice, so
the parent frame issued price/config subcalls ONLY for seized tokens. A
collateralOf@N-1 leg outside the seizure fan-out got no subcalls →
`maxBorrowAtFrame` found `prices[tok]==nil` → allPriced=false →
parent_basket_complete=false → class `intra-block-recompute-unpriced`, gated.
Every PARTIAL liquidation (fan-out < basket) with an unseized leg was
structurally ungateable; the 26 passers were all full-sweep shapes
(basket ⊆ seized). D-013 dual: a fail that should be a pass is wrong data on
the operator's receipt.

THE FIX (backtest.go): the parent (full) frame now values the WHOLE
collateral universe at N-1 — `seized ∪ legs(collateralOf@N-1) ∪
supported(getCollateralTokens@N-1)` — via hash-pinned follow-up multicalls at
the SAME parent pin, decoded by the SAME wave-8 per-subcall law (fail / empty
/ undecodable ⇒ frame UNREAD, subcall named — the fix widens what is
REQUESTED, never softens what an unanswered read means). The exec frame
values the SAME complete basket (execWant already prices the parent legs;
config coverage follows through the parent's now-complete config map). The
latent DECIMALS GAP is closed in the same wave: a frame token absent from the
pin-time decimals map (delisted before the run pin) reads `ERC20.decimals` at
the parent frame's own hash first (`p3:backtest:frame-decimals@N-1`), and the
historical decimals merge into the case's view via `mergeFrameDecimals`
(consumed by the exec read, the replay and the seizure reconstruction).
Convention follows wave-h.md … wave-h6a.md.

## Mutant spec — committed in the wave brief and in
`p3_backtest_wave_h9_test.go`'s header BEFORE the loop ran

Kill suite (hermetic — a fixture chain speaking the production
tryBlockAndAggregate envelope behind the REAL `pinnedReader`; no DB, no RPC):

```
go test ./cmd/reconcile -count=1 -run 'TestWaveH9'
```

- **M1 — revert to the seizure-only token set.** In
  `readBacktestFrameState` (backtest.go), the frame-universe widening

  ```go
  frameTokens := map[common.Address]bool{}
  for tok := range seized {
      frameTokens[tok] = true
  }
  for _, leg := range st.collateral {
      frameTokens[leg.token] = true
  }
  for _, tok := range st.supported {
      frameTokens[tok] = true
  }
  ```

  becomes

  ```go
  frameTokens := map[common.Address]bool{}
  for tok := range seized {
      frameTokens[tok] = true
  } // MUTANT M1: seizure-only token set — legs and supported never join the valuation set
  ```

  — with frameTokens back to the seized set, the missing-decimals scan and
  the valuation supplement both see nothing to do: exactly the pre-H9 shape.

- **M2 — universe-priced but the EXEC-side recomputation silently reuses the
  OLD (seizure-scoped) config subset.** In `obligation2Eligibility`
  (backtest.go),

  ```go
  execMaxBorrow, execPriced := maxBorrowAtFrame(execBasket, exec.st.prices, parent.st.configs, decimals)
  ```

  becomes

  ```go
  execConfigs := map[common.Address]collateralTokenConfigResult{} // MUTANT M2: exec silently reuses the OLD (seizure-scoped) config subset
  for _, s := range v.seizures() {
      if cfg, ok := parent.st.configs[common.HexToAddress(s.AssetHex)]; ok {
          execConfigs[common.HexToAddress(s.AssetHex)] = cfg
      }
  }
  execMaxBorrow, execPriced := maxBorrowAtFrame(execBasket, exec.st.prices, execConfigs, decimals)
  ```

  — the parent frame stays complete under M2 (distinct from M1's kill
  surface); only the exec-side valuation loses the unseized legs' configs.

## Tested tree

- Branch `main`, HEAD `3984995`, PLUS this wave's uncommitted Wave-H9 edits
  (backtest.go, backtest_test.go, p3_backtest_wave_h9_test.go).
- Clean `cmd/reconcile/backtest.go` sha256 (the restore bar for BOTH
  mutants):
  `2f936c4118b5f8e37a66e49c26ef337f62f2854f30f9b7017b66c66564a34dd7`.
- Full offline suite green before the loop:
  `ok github.com/kaselunt/solvent/cmd/reconcile` /
  `ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb` (-count=1).

## Loop record

### M1 — cut, killed, restored

Kill run (verbatim tails):

```
--- FAIL: TestWaveH9PartialLiquidationValuesTheWholeBasket (0.00s)
--- FAIL: TestWaveH9CompleteBasketMismatchFailsLoudly (0.00s)
--- FAIL: TestWaveH9DelistedTokenDecimalsReadAtParentPin (0.00s)
FAIL	github.com/kaselunt/solvent/cmd/reconcile	0.901s
```

Failing assertions (the named killers):

```
Error:    Expected value not to be nil.
Messages: the unseized leg's engine-exact price must be READ at N-1 — the
          seizure fan-out must never truncate the valued basket (wave H9)
Error:    Expected value not to be nil.
Messages: the complete basket is what makes this mismatch VISIBLE
Error:    "[]" should have 1 item(s), but has 0
Messages: exactly the pin-time-absent token reads decimals historically
```

Restore verified: sha256(backtest.go) ==
`2f936c4118b5f8e37a66e49c26ef337f62f2854f30f9b7017b66c66564a34dd7` (byte
identical to the clean bar).

### M2 — cut, killed, restored

Kill run (verbatim tails):

```
--- FAIL: TestWaveH9PartialLiquidationValuesTheWholeBasket (0.00s)
--- FAIL: TestWaveH9CompleteBasketMismatchFailsLoudly (0.00s)
--- FAIL: TestWaveH9DelistedTokenDecimalsReadAtParentPin (0.00s)
FAIL	github.com/kaselunt/solvent/cmd/reconcile	0.947s
```

Failing assertions — the EXEC-SIDE COMPLETENESS ASSERTION is the designed
killer, and it fired exactly as spec'd (the parent-side assertions all PASSED
under M2, proving the kill surface is distinct from M1's):

```
Error:    Not equal: expected: "true"  actual: "false"
Messages: THE EXEC-SIDE COMPLETENESS ASSERTION (kills M2): every parent leg
          is priced at exec AND configured through the parent's complete
          config map     [every_leg_priced_both_frames]
Error:    Not equal: expected: "UNEXPLAINED"  actual: "unpriced-leg"
Messages: a complete-basket case that genuinely mismatches resolves
          UNEXPLAINED — the gated third state, loudly
```

Restore verified: sha256(backtest.go) ==
`2f936c4118b5f8e37a66e49c26ef337f62f2854f30f9b7017b66c66564a34dd7` (byte
identical to the clean bar).

## Post-loop

Full offline suite re-run after both restores: green
(`ok github.com/kaselunt/solvent/cmd/reconcile`,
`ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb`, -count=1).
