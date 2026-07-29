# risk-quant P3 design consult — 2026-07-28 (P3 entry, pre-plan)

Standing persona: risk-quant (fable). Advise-only. Verbatim rulings archived from the live
consult; feeds the P3 design doc `docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md`
and every Codex brief touching risk math.

VERDICT: NUMBERS DO NOT HOLD as proposed, on three blocking items (R3b depeg re-spec, R5.4 Aave
param history, R1/R6.2 exact-at-pin vs watermarked-live split). Amended design holds.

---

## R1 — HF proof standard (Aave engine). BINDING-RECOMMENDATION

Split the HF into two surfaces with different epistemic status, and never let one borrow the
other's guarantees.

**Proof surface (reconcile gate, hash-bound pin): every component gates EXACT, zero tolerance.**
There is no honest tolerance anywhere in this pipeline, because every input is a same-pin
contract read and every operation is deterministic integer math with a known rounding direction:

| # | Component | Provenance | Rounding law | Gate |
|---|---|---|---|---|
| 1 | scaled debt / scaled collateral | derived event-fold vs `scaledBalanceOf@pin` | bit-identity | EXACT (already 87/87 in P2) |
| 2 | live debt | `rayMulCeil(scaled, getReserveNormalizedVariableDebt@pin)` | **ceiling** — derivation-notes :196-199 | EXACT, zero bound (one multiplication; contract does the compounding) |
| 3 | live collateral | scaled aToken × `getReserveNormalizedIncome@pin` | **floor** (regime-B TokenMath `rayMulFloor`; regime A half-up for historical pins < 23,088,584) | EXACT — but only after the floor law gets the same one-shot empirical pin proof the ceiling law got (two vectors, sub-half and super-half fracs). Acceptance run #1 is the standing precedent: an assumed library rounding false-failed the gate; never assume, prove per deployed token |
| 4 | per-reserve base value | `balance × AaveOracle.getAssetPrice@pin / 10^dec` | plain integer division = floor, one op per reserve | EXACT. Must read the cap-adapter's own output at the pin, never compose raw feed × ratio (derivation-notes :309-312) |
| 5 | `totalCollateralBase`, `totalDebtBase` | Σ of #4 vs `getUserAccountData@pin` | commutative addition | EXACT |
| 6 | `currentLiquidationThreshold` | floor(Σ collatBaseᵢ×LTᵢ / totalCollateralBase) | single floor division | EXACT |
| 7 | `healthFactor` | `wadDiv(percentMul(totalCollateralBase, avgLT), totalDebtBase)` | half-up in the v3 lineage — cite the deployed PercentageMath/WadRayMath source lines and pin one boundary vector before gating | EXACT |

The contract computes `healthFactor` FROM the truncated `avgLiquidationThreshold` it also
returns, so once #5 and #6 gate exact, #7 follows deterministically — a nonzero delta at #7 with
#5/#6 exact isolates the fault to the percentMul/wadDiv replication.

Exceeding zero means (in order of prior probability, from the P2 record): wrong regime for the
pin; missed debt-touching or collateral-touching event; wrong rounding op; adapter-vs-composed-
price mismatch; eMode/collateral-flag mismatch. Never absorbable.

**Declared-input honesty:** the gate proves the *derived balances* and the *math pipeline*.
Prices, reserve params, eMode category, and `isUsingAsCollateral` flags are pinned inputs read
from chain, not derived state — say so in the gate's output schema. First implementation should
read `getUserConfiguration@pin` / `getUserEMode@pin` directly rather than deriving flags from
`ReserveUsedAsCollateral*`/`UserEModeSet` streams, and label them `input:pinned-read`. Deriving
them is a later promotion, gated the same way.

**Operational surface (riskd, D-012 sampled prices): never gated exact, and never given a
numeric epsilon.** An HF computed from 60-second samples does not have a rounding error — it has
a *staleness bound*. The honest error statement: "HF computed from price sample aged ≤ T_price,
balances as-of block B, params as-of block W" with the watermarks stored per row. Inventing an
epsilon here is laundering sample-gap uncertainty through integer arithmetic. The spec §11.3
phrase "within rounding tolerance" must be amended: the continuously-verified sample gates exact
at pins; the live surface carries watermarks, not tolerance.

## R2 — Debt Manager validation path. BINDING-RECOMMENDATION

The DM has no health factor and no `getUserAccountData` analog — but it has everything needed
for a component-wise exact gate, all on the proxy `0x0078C5…9553`:

- `borrowingOf(user)` / `borrowingOf(user, token)` (DebtManagerStorageContract.sol:575, :612) —
  total/per-token live debt, USD 6-dec.
- `getMaxBorrowAmount(user, false)` (DebtManagerCore.sol:139) — liquidation-threshold-weighted
  collateral in USD 6-dec: Σ `mulDiv(collatUsdᵢ, LTᵢ, 100e18, Floor)`.
- `liquidatable(user)` (DebtManagerCore.sol:126) — ground-truth boolean:
  `userBorrowing > getMaxBorrowAmount(user, false)`. Strict inequality; equality is healthy.
- `getUserCurrentState(user)` (DebtManagerCore.sol:271) — collateral array + USD, borrowings
  array + USD, in one eth_call (multicall-friendly for sampling).
- `collateralOf(user)` / `getCollateralValueInUsd(user)` (:170, :386).

**Define `HF_dm := getMaxBorrowAmount(user,false) / totalBorrowings`** (both USD 6-dec) — same
shape as Aave's HF, directly validatable.

The honest proof, per sampled borrower at a hash-bound pin (all reads same pin):

1. **Debt leg — the only truly derived leg:** normalized replay × `getCurrentIndex@pin` vs
   `borrowingOf@pin`. Proven bit-exact in P2. Gate EXACT. Between events the current index is
   linear (`snapshot + snapshot×apy×dt/100e18`, :559-567) — replicable exactly from
   `InterestIndexUpdated` + `BorrowApySet` + timestamp; no approximation needed.
2. **Collateral + threshold leg — pinned-input recomputation, not derivation:** read
   `CashLens.getUserTotalCollateral@pin` (nets pending withdrawals and drops zero balances —
   CashLens.sol:561-576; a deriver reading raw Safe ERC20 balances will drift on any account
   with a pending withdrawal), read `PriceProviderV2.price@pin` per token, apply
   `floor(amount × price / 10^dec)` (:378) per token, then `mulDiv(·, LTᵢ, 100e18, Floor)`
   (:153), sum. Gate EXACT against `getCollateralValueInUsd@pin` and
   `getMaxBorrowAmount(user,false)@pin`. This proves the aggregation math and param table;
   collateral itself is poll-only per derivation-notes caveat 4 — disclose, don't pretend replay.
3. **Boolean weld:** recomputed `debt > maxBorrowLT` must equal `liquidatable(user)@pin` for
   every sampled borrower — including borderline ones if any exist.
4. **Empty-set probe:** sample N accounts the chain says are clean (`borrowingOf == 0`) and
   accounts never seen in any event; assert derived-zero == chain-zero. Checking only accounts
   you derived is phantom-debt blindness; half the evidence is the empty set.
5. **Realized-liquidation backtest (R6.1)** closes the loop on the threshold pipeline.

No aggregate-view fallback needed. Zero tolerance on all legs; USD 6-dec integer arithmetic with
cited floor sites.

## R3 — Stress scenario set. BINDING-RECOMMENDATION (depeg re-spec blocking; rate-shock re-spec blocking-if-kept)

**(a) ETH −10/−20/−30: keep as the primary axis** — implemented as a *factor* shock: every
ETH-linked collateral (weETH, WETH, liquidETH, accountant-lens tokens with ETH base composition)
moves jointly, with weETH = redemption-rate × ETH so correlation is by construction.

**(b) weETH/ETH depeg to 0.95 — as specified, oracle-counterfactual and will embarrass you.**
Both engines mark weETH to the redemption rate, not the market: OP is exchange-rate feed ×
ETH/USD (derivation-notes :283), ETH mainnet is `getRate()` × ETH/USD behind a growth cap
(:294). A market depeg to 0.95 moves neither oracle → no HF change → zero liquidations.
Re-specify as two honest scenarios:
- **Redemption-rate shock** (slashing/exploit: `getRate` −5%): flows through both engines'
  oracles (Aave cap binds upward only; a rate drop passes through). The real HF scenario.
- **Market depeg without rate change**: disclosed as *not an HF event by oracle construction*;
  its risk is liquidator-side — realizable collateral value and bonus sufficiency. Surface as a
  waterfall column, not an HF scenario.

**(c) Rate +200bps: does not move spot HF. Keep only as a horizon projection, else cut.** On the
DM it is cheap and exact: `borrowApy` is admin-set, the index is linear per second, so debt(t) is
closed-form — present "HF at 30d/90d and time-to-liquidatable, collateral prices held flat,
current APY vs +200bps," labeled PROJECTION with both assumptions stated. On the Aave engine
rates are utilization-driven and the book is ~$2.8k residual dust — exclude and disclose. If the
horizon UI doesn't fit v1, cut the rate shock entirely; a fake spot-shock is worse than absence.

**(d) Additions the actual book demands** (census-check weights first):
- **Stable-collateral depeg with the snap-band discontinuity**: PriceProviderV2 snaps stables to
  exactly 1e6 inside ±1% (derivation-notes :274-276) — at 0.99 nothing happens, at 0.98 the
  price unsnaps to market. Model the step. Disclose the DM asymmetry: existing debt is
  USD-normalized, so a USDC depeg re-prices USDC collateral but not outstanding debt.
- **ETHFI −50% (idiosyncratic)**: own-ecosystem-token collateral, correlated with exactly the
  stress states in which liquidations happen.
- **BTC leg (eBTC/liquidBTC)** if the census shows material weight.

Every scenario ships as the four-tuple: shocked variable(s) + path assumption (instantaneous
mark, no cascade feedback — disclosed) + affected-position census query + expected-loss
arithmetic a reviewer can recompute from committed inputs.

OPTIONAL: scenario definitions as committed config (JSON in-repo) so every published surface is
reproducible from committed inputs.

## R4 — Liquidation price + waterfall semantics. BINDING-RECOMMENDATION

**Headline number = factor-level liquidation price; per-asset ceteris-paribus demoted to a
diagnostic.** Both engines make this a closed-form linear solve — collateral value linear in
each price, debt constant (USD-normalized on DM; stable-denominated on Aave):

```
s* = (debt − Σ_{i∉F} cᵢ·LTᵢ) / (Σ_{i∈F} cᵢ·LTᵢ)      P* = s* × P_now
```

No iteration, no simulation, exact given inputs. Required disclosures: which assets are in the
factor; other prices and the redemption rate held at current sample; input watermarks; DM
boundary strictness (`>` — at exactly P* still healthy); per-asset diagnostics labeled
ceteris-paribus explicitly.

**Waterfall: "$X becomes liquidatable at P" aggregates DEBT ELIGIBLE FOR LIQUIDATION**,
cumulative by price bucket: X = Σ `borrowingOf(user)` (USD) over accounts whose liquidatable
condition first trips in (P_k, P_{k−1}]. Not "will be liquidated": DM liquidation is a two-pass
50%-then-remainder close (DebtManagerCore.sol:540-546), so realized ≤ eligible — one sentence on
the surface. Two secondary series:
- **Collateral at risk**: seizable collateral at the grid point = min(collateral value,
  debt × (1+bonus)), per-account, bonus from the param table.
- **Insolvent-if-liquidated flag**: threshold-weighted collateral < debt AND total collateral ×
  (1 − bonus haircut) < debt — the bad-debt census. A waterfall presenting underwater debt as
  recoverable is spreadsheet solvency.

**Grid semantics:** shock the ETH factor scalar; weETH moves as rate × ETH (rate frozen at
current sample). Evaluate the full census at each grid point. For single-factor down-shocks with
USD debt each account's crossing is monotone, so the cumulative series must be monotone —
**assert as a standing invariant**; a violation means multi-factor exposure or a bug, and must
surface, never be smoothed.

## R5 — Parameter sourcing. BINDING-RECOMMENDATION (item 4 blocking for any "params-as-of-watermark" claim on the Aave engine)

1. **DM param history is event-exact — from `CollateralTokenConfigSet` only.** Single emit site
   DebtManagerAdmin.sol:164; event carries both old and new `(ltv, liquidationThreshold,
   liquidationBonus)` tuples (uint80/uint80/uint96, denominator `HUNDRED_PERCENT = 100e18`).
   `LiquidationThresholdUpdated(uint256,uint256)` is declared-never-emitted — zero emit sites in
   the clone. Do not design against it. `BorrowApySet` (DebtManagerAdmin.sol:197) covers rate
   history; `setBorrowApy` reindexes before changing rate, so (index, APY) stays reconstructible.
2. **Standing tip-weld for the param table:** reconcile head state vs live
   `collateralTokenConfig(token)` reads for all 20 tokens at each pin — the cheap guard against
   the migration-era precedent (config set by a since-replaced implementation whose events
   aren't in current source, exactly how `MigrationBorrowerPositionsSet` hid).
3. **Same-block ordering:** params-as-of must be (block, logIndex)-ordered; the design doc must
   state the convention for "HF as-of block H" (end-of-block state, matching the event-fold).
4. **TRAP — Aave reserve-config events are emitted by the PoolConfigurator, not the Pool.**
   `CollateralConfigurationChanged`, eMode category changes, liquidation-protocol-fee and cap
   changes come from an address NOT in `recon/contracts.json`'s streams. As indexed today,
   Solvent cannot build Aave param history at all. v1 honest fallback = poll
   `getConfiguration`/`getEModeCategoryData` at each pin (exact at-pin, no history claim); the
   param-history claim requires adding the configurator stream. Do not write
   "params-as-of-watermark" for the Aave engine until one is chosen.
5. **eMode:** run the census once — if any live borrower has `getUserEMode ≠ 0`, HF uses
   category LT/bonus and the param table needs the category rows. `UserEModeSet` is already in
   the decode set; category params are configurator-emitted.
6. **Proxy upgrades are regime boundaries.** DM upgraded twice on day 1 with later upgrades
   unenumerated; Aave pool impl changed 3× with the rounding-regime split at 23,088,584 log 542.
   Historical HF recomputation must be regime-aware; `Upgraded` events mark epochs beyond which
   exactness claims require revalidation.
7. **Price caps at historical pins:** as-of recompute must use the cap adapter's archived
   output, never a raw-feed replay. A standing scan comparing sampled adapter reads against the
   composed reference gives free cap-bind detection.
8. **Collateral-token removal is a valuation discontinuity:** `convertCollateralTokenToUsd`
   reverts for unsupported tokens (DebtManagerCore.sol:376); the lens omits them — a governance
   removal zeroes that collateral in every view instantly. Param history must record
   `CollateralTokenRemoved` as a valuation event; the stress engine must not crash on a
   held-but-removed token.

## R6 — What the set above misses. Items 1, 2, 7 BINDING-RECOMMENDATION; rest OPTIONAL

1. **Realized-liquidation backtest (BINDING — highest credibility per unit effort).** 763
   historical `Liquidated` events; each is a free ground-truth label because `liquidate()`
   requires the liquidatable condition. Sample N, recompute DM state at liq-block−1 and at the
   liq block from archive reads + the param table, assert `liquidatable == true` at execution.
   One table in the writeup: N replayed, N agreeing, 0 tolerance.
2. **Worst-case detection latency statement (BINDING).** The honest freshness bound on a DM HF
   is dominated by the collateral sweep, not the 60s price sample: sweeps run on a 3600s
   interval and a full pass took ~33 minutes in production — DM collateral can be ~1h stale
   while prices are 60s fresh. State the per-leg bound on every HF row and in alerts docs;
   intra-sample price wicks are undetectable by construction (D-012). Publishing a
   60s-fresh-looking HF over hour-stale collateral without the label is laundering.
3. **Empty-set probes in both engines' HF gates** — must survive into the reconcile extension's
   design.
4. **Current bad-debt line (OPTIONAL, RiskDAO-style):** the book already contains an HF 0.73
   dust position (the golden vector). A standing "current bad debt / insolvent positions" figure
   turns an awkward demo moment into a product feature.
5. **Dust quantization honesty (OPTIONAL):** base-currency is 8-dec; for a $0.12 position the
   contract's own HF is coarse. Display the contract's number as truth; never render more
   precision than the chain computes.
6. **B3 inheritance (OPTIONAL, one line):** three of four feed heartbeats are
   published-not-verified. Any P3 staleness verdict consuming them carries that provenance label
   until the open item closes.
7. **Per-leg watermarks in the riskd schema (BINDING):** every materialized risk row stores
   (balances block, price sample id + observed_at, params watermark, sweep generation for DM
   collateral). The §4 traceability promise is only implementable if the schema carries
   provenance from day one; retrofitting is a rewrite.
8. **Never blend the engines into one number (OPTIONAL but cheap to violate accidentally):** DM
   liquidatable is a strict-inequality boolean with two-pass 50% liquidation and no bonus in the
   health test; Aave HF is continuous with close-factor semantics. Same page, two labeled
   surfaces.

## Verdict

NUMBERS DO NOT HOLD as proposed, on three blocking items; the amended design holds:

1. R3(b): the weETH/ETH 0.95 depeg scenario is oracle-counterfactual on both engines — re-spec
   as a redemption-rate shock plus a disclosed liquidator-side tail.
2. R5(4): Aave param history unobtainable from currently-indexed streams (PoolConfigurator not
   ingested) — add the stream or scope the claim to pinned poll reads.
3. R1/R6.2: the HF gate must consume pinned contract reads only; the operational HF carries
   per-leg staleness watermarks instead of any numeric tolerance; spec §11.3 "within rounding
   tolerance" must be amended to the exact-at-pin / watermarked-live split.

Non-blocking but load-bearing for reviewer credibility: R6.1 (realized-liquidation backtest) and
R6.7 (provenance columns in the riskd schema) belong in the design doc, not the backlog.
