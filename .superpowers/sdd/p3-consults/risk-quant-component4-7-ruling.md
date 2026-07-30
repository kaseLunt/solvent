# risk-quant ruling — Aave component-4 debt-ceil + component-7 composite (rev-3)

> Archived verbatim, 2026-07-29 ~21:59 local. Requested after Task 6's live finding
> (totalDebtBase exact 0/12 under floor, 12/12 under ceil). VERDICT: finding CONFIRMED
> from the deployed VERIFIED SOURCE (proxy impl resolved via EIP-1967, PoolInstance
> solc 0.8.27) — AND a SECOND law correction found: component 7 is the wadDiv-HALF-UP
> composite, not a single fused floor (differs ~5e-5 of evaluations; undetectable by
> pin checks; Task 1's P-1 was an undetectably-good approximation). Four-item blocking
> list for the rev-3 fix wave is NORMATIVE.

Confirmed — and the source read surfaced a **second** law correction the fix wave must carry in the same revision. Full ruling with the deployed source lines, my own second-pin witness, and constructed discriminators.

---

# Ruling — Aave debt-base conversion (Task 6 finding vs Task 4 law)

Evidence chain: live Pool implementation resolved from the proxy's EIP-1967 slot today (`0x0AA97c284e…` → impl `0x0F3BCeB6b3B2dFb7F0AC58FCbF6dADD23cF34244`), Blockscout-verified `PoolInstance` source (solc 0.8.27), files `GenericLogic.sol` / `MathUtils.sol` / `WadRayMath.sol` / `TokenMath.sol` pulled and read. This outranks any pin count: it is the contract's own math.

## Q1 — CONFIRMED. Debt base conversion is a pure ceiling. Exact lines:

- `GenericLogic.sol:219-230` `_getUserDebtInBaseCurrency`: `scaledBalanceOf(user).getVTokenBalance(reserve.getNormalizedDebt())` then **`return MathUtils.mulDivCeil(userTotalDebt, assetPrice, assetUnit);`** (:229), summed per borrowed reserve at :141.
- `MathUtils.sol:100-115` `mulDivCeil`: `d := div(product, c) + iszero(iszero(mod(product, c)))` — pure ceiling, not half-up.
- `TokenMath.sol:108-113` `getVTokenBalance = rayMulCeil` (our component 2, already right).
- Collateral side stays floor, confirmed: `GenericLogic.sol:242-258` `_getUserBalanceInBaseCurrency` — `getATokenBalance` (rayMulFloor, :66-71) then `balance * assetPrice; return balance / assetUnit` (plain truncation). Matches the 12/12 collateral exactness.

The corrected component-4 law: **DebtBaseᵢ = MulDivCeil(liveDebtᵢ, priceᵢ, 10^decᵢ); CollateralBaseᵢ = MulDivFloor (unchanged)**. The never-understate-debt asymmetry carries all the way through, exactly as the finding says.

Golden integers verified: 137231 × 99981000 = 13720492611000 → floor 13720492 / ceil 13720493, chain 13720493. **My own second pin** (25,643,405, hash `0xfce8f11c…d3fc`, my reads): liveDebt 137231, price 99981000, bitmap 6, `totalDebtBase` 13720493 = ceil, floor refuted. Honesty note: the state happened to be identical across the two pins, so my read is an independent *read*, not independent *integers* — but the verified source now carries the proof burden. One sharpening the wave's vectors may lack: the golden leg's remainder is 0.611 — **super-half**, so it does not separate ceil from half-up. The fix must carry a **sub-half debt-valuation vector** (any remainder < 0.5: ceil ≠ floor ≠ half-up all at once).

## Q2 — The fused form CHANGES. New finding: component 7 is NOT a single fused floor.

`GenericLogic.sol:160-164`: `healthFactor = avgLiquidationThreshold.wadDiv(totalDebtInBaseCurrency) / 100_00`, computed on the **raw weighted sum** Σ(Cᵢ·LTᵢ) (the avg division at :167-173 happens *after* — weighted-sum form confirmed by code order, aggregate-LT dead). `WadRayMath.sol:53-62`: `wadDiv = (a·WAD + b/2) / b` — **half-up**. The deployed law is therefore:

```
HF = floor( floor((Σ(Cᵢ·LTᵢ)·1e18 + ⌊D/2⌋) / D) / 1e4 ),   D = ceil-summed debt
```

Derivation of the difference vs our shipped `floor(Σ·1e18/(1e4·D))`: write Σ·1e18 = qD + r. The inner wadDiv gives q + [r ≥ ⌈D/2⌉]; fused floor equals floor(q/1e4) by the composition-of-floors identity. They differ **iff the carry fires AND q ≡ 9999 (mod 1e4)** — chain comes out one wad ULP HIGHER. Incidence ~5×10⁻⁵ per evaluation: 12/12 at any pin could never have separated them (P-2's "single fused floor" was an undetectably good approximation; our error direction is false-alarm, benign, but it is not the contract's law). Verified at my pin: composite = fused floor = chain 723117692636846212 (q mod 1e4 = 4502, no carry); and with the wrong floor-D the HF is 723117745340327445 — higher, the false-safety direction, magnitude as the finding states. Constructed discriminators for the unit layer (recompute freely):

- Trivial: Σ=1, D=100000000000001 → composite **1**, fused floor **0**.
- Realistic: Σ=99215323900, D=13720493 → composite **723117776453076431** vs fused floor **…430**; second witness Σ=99215325927 → **…053** vs **…052**.
- M-2/M-1 are exact-division vectors: unchanged under the composite (verified).

**The rev-3 fix must ship both corrections together** — re-pinning component 4 while leaving component 7 as fused-floor would knowingly ship a law the source refutes.

## Q3 — Blast radius and re-pins

- `math.go`: add `MulDivCeil` (RayMulCeil shape); component-7 helper becomes the exact composite (keep the refuted fused-floor/half-up forms as test-side witnesses).
- `aave.go`: debt leg of component 4 → ceil; collateral unchanged; component 7 → composite. AlgorithmRevision bump as planned.
- **Must re-pin**: golden E2E (`TestComputeAaveHealthGoldenBorrowerEndToEnd`) — the solved USDC price must satisfy ceil(137216·p/1e6) = 13720591: p ∈ [99992640, 99992646]; **99992646** works (ceil 13720591, remainder 913536 — note super-half again, hence the separate sub-half vector).
- **Survive unchanged** (all exact-division on the debt leg — verified): second golden vector, M-1/M-2, HF==1e18 strictness vector, liqprice Aave vectors incl. the 61728395/61728396 boundary flip, waterfall/shortfall Aave fixtures, all component-4 collateral floor vectors.
- Liquidation price: `weightsFor` inherits ceil-D; P* rises by ≤ one D-unit's worth — the SAFE direction (the old floor-D biased P* low, which was the dangerous residue of this bug). `LowestHealthyPrice = ceil(P*)` semantics stand; the component-7 half-up sliver only widens the chain's healthy region *below* the rational boundary, so ceil(P*) remains conservative. No boundary flip; optional docstring sentence on the chain's half-ULP grace.
- scenario/waterfall/shortfall: consumers only; DM engine untouched; `cmd/reconcile` inherits via the refactor. `recon/derivation-notes.md`'s Aave precision section needs both corrections appended.
- For the record: the exact-equality HF gate posture is what caught this — a tolerance of even ±1 base unit on totalDebtBase would have carpeted a real law error 12 times out of 12.

## Q4 — Second unproven legs of the same class

1. **Component 7's composite — demanded above, same rev.** It is precisely the "rode along unproven behind 12/12" class; it does not get to ride along a second time.
2. `availableBorrowsBase` (`:189-205`, truncated avgLtv at :167-168 then percentMul): stays an **evidence column, not a gate** — its percentMul rounding in THIS deployment is one grep away in the verified sources if ever promoted, but promote by derivation, never by observation streak.
3. Zero-LTV branch (`:119-121`): LTV=0 collateral still counts in C and Σ(C·LT); our HF math is indifferent (we never consume avgLtv); `PendingLtvChanged` has never fired here. Note recorded, no action.
4. eMode (`:126-132`): stays refused (`ErrEModeUnsupported`) + the Task 6 gate's per-account `getUserEMode==0` assertion. No probe needed.
5. **Regime guard (one line, do include)**: both corrected laws are proven for the CURRENT implementation only. Any Aave HF weld at a pin before the TokenMath cut (23,088,584) must be refused or era-flagged, never computed with today's laws.

**Second pin**: yes, carry it — the wave's 12/12 and my read shared state integers. One 12/12 re-run at a later pin (different oracle round / index state) inside the Task 6 smoke closes it cheaply. With the verified source in hand this is belt-and-suspenders, but this desk wears both.

## VERDICT: finding CONFIRMED; **NUMBERS DO NOT HOLD for the fix wave as scoped** — blocking list: (1) component-7 law is the wadDiv-half-up composite, must ship in the same rev-3 with both carry discriminators (realistic vectors supplied above); (2) sub-half debt-leg ceil vector (the golden leg cannot separate ceil from half-up); (3) golden E2E re-pin (price 99992646 supplied); (4) pre-TokenMath-pin refusal guard. With those four in the wave, the corrected laws are exactly the deployed contract's and I expect to flip on re-read.

Key files: scratchpad copies of the verified sources (`GenericLogic.sol`, `MathUtils.sol`, `WadRayMath.sol`, `TokenMath.sol`) at `C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\d495eb03-e15f-4723-91d0-f27885140370\scratchpad\`; targets `C:\Users\kasel\source\repos\etherfi\Solvent\internal\risk\math.go`, `C:\Users\kasel\source\repos\etherfi\Solvent\internal\risk\aave.go`, `C:\Users\kasel\source\repos\etherfi\Solvent\internal\risk\aave_test.go`, `C:\Users\kasel\source\repos\etherfi\Solvent\recon\derivation-notes.md`.
