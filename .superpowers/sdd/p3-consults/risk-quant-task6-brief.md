# risk-quant consult — P3 Task 6 pre-brief (reconcile extension)

> Archived verbatim from the standing risk-quant agent (same instance as the Task 4
> re-derivation), 2026-07-29 ~17:24 local. Requested by the integrator BEFORE writing
> the Task 6 wave brief. VERDICT: the plan's Task 6 text as acceptance criteria =
> NUMBERS DO NOT HOLD — five blockers, all fixable in the brief (see final section).
> The five blockers and three named tolerances are NORMATIVE for the Task 6 wave.

Plan section read fresh (`docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md:171-181`), sources re-checked where a bound needed deriving (`DebtManagerStorageContract.sol:498-502`, `DebtManagerCore.sol:504-584, 613-658`), existing weld machinery surveyed (`cmd/reconcile/phase2.go:446`, `aave.go:111`). Rulings numbered as requested.

---

# P3 Task 6 pre-brief consult — reconcile extension rulings

## R1 — HF gate tolerance: EXACT, zero units, conditional on a declared input frame. There is no legitimate bounded-divergence class; anything nonzero is a bug.

The fused-floor law is probe-proven 12/12 with last-digit discriminators. `getUserAccountData@pin` and our recompute run the **same integer law**, so they diverge only if the inputs differ. Every candidate divergence you name is an input-frame inconsistency, not rounding:

- **Index freshness**: `getUserAccountData` uses `getReserveNormalizedIncome/VariableDebt` compounded to the pin's timestamp; our `rate_indexes` row is the last `ReserveDataUpdated`. If the gate consumes our stored index it inherits index-lag, unbounded by any rounding argument. Prescription: the index is a **pinned chain read** (`input:pinned-read`), exactly as P-1's 15/15 weld already did. Then the divergence class vanishes.
- **Prices**: adapter-output rows are 60-second samples at their own anchors (D-012). An HF gate consuming a stored sample against a pin at a different block is laundering sample-gap uncertainty through integer arithmetic — the cardinal sin. Prescription: gate prices are pinned `getAssetPrice@pin` reads; the stored adapter-output rows are welded **separately**, each against `getAssetPrice` at the row's **own anchor block**, exact (that is the Task-2b custody weld, ≥1 row per reserve, and it stays a distinct gate).
- Same for eMode (`getUserEMode@pin == 0` asserted per account — nonzero is a gated FAIL, never a skip) and regime (all pins current ⇒ RegimeB; stamp it).

**What is actually under test** (the derived-tag list, exhaustive): scaled balances (DB fold), the UserConfiguration collateral bits (derived), param rows (param_history fold). Everything else pinned-read and declared. With that frame: `healthFactor`, `totalCollateralBase`, `totalDebtBase` welded **bit-exact, tolerance zero**. Zero-debt accounts: chain returns `type(uint256).max`; map marker↔max explicitly, never compare as magnitudes.

Two component-6/6-adjacent fields need law statements before gating, not after: `currentLiquidationThreshold` — derive its rounding from the deployed source and gate exact (expected `floor(Σ(Cᵢ·LTᵢ)/ΣCᵢ)`; if all 12 fail in a uniform pattern the law note was wrong and the gate fails loud — acceptable); `availableBorrowsBase` — its LTV/percentMul path is **not** probe-proven, so it ships as an evidence column with stated uncertainty, not a gate. Promoting it later requires a derivation, not an observation streak.

Sharpness clause (this closes my Task-4 R4-1 with a chain witness): the gate FAILS unless ≥1 cohort account×reserve has a **nonzero component-4 remainder** (`balance×price mod 10^dec ≠ 0`), asserted in the run — otherwise the weld cannot distinguish floor from half-up and proves less than it appears.

## R2 — Backtest frame: what each case must prove, and the floor

As written ("`liquidatable==true` at execution") the gate is a **tautology**: the contract already reverts otherwise (`DebtManagerCore.sol:526`). The load-bearing content is that OUR derived state and OUR law produce the chain's decision. Per case, four obligations:

1. **Debt weld (bit-exact, zero tolerance)**: our normalized replay folded to the pre-liquidation `(block, logIndex)` must reproduce the event's own `beforeDebtAmount` exactly — the P2-proven identity, applied per-event. This tests the derived fold; nothing else does.
2. **Eligibility direction (our boolean)**: `ComputeDMHealth` with debt = replayed value, collateral = CashLens `getUserTotalCollateral@B−1`, prices = pinned `PriceProviderV2.price@B`. Frame caveat, disclosed not tolerated: execution used intra-block state. Detect: (a) any same-account DM event in block B with lower logIndex ⇒ evaluate debt event-exactly (we already do) and flag the case; (b) `price@B ≠ price@B−1` for any held token ⇒ the case is **marginal** — print the margin `|debt − maxBorrowLT|` in USD-6 and the price delta. A non-marginal boolean miss (we say healthy, chain liquidated) is a gated FAIL — that is a false-negative in the alert product. Marginal cases are listed individually, never absorbed. Note the direction split explicitly in the brief: backtest catches false-negatives only; the live boolean weld at head pins catches false-positives; neither substitutes for the other.
3. **Seizure reconstruction (exact-or-explained, not a carpet number)**: per `userCollateralLiquidated[]` element, recompute the deployed branch with pinned price@B: partial branch — `amount` == Safe balance, `bonus == totalCollateral − floor(totalCollateral·HP/(HP+b))`; final branch — `amount − bonus == floor(u·10^dec/P)` (`DebtManagerStorageContract.sol:501`, plain truncation) and `bonus == floor(cAFD·b/HP)`. These are exact recomputations, tolerance zero. The only derived slack, stated with its mechanics: the credited USD round-trip `floor(floor(u·10^dec/P)·P/10^dec)` sits in `[u − ceil(P/10^dec), u]` — a deficit of at most **one wei of the collateral token** per element (you cannot seize fractional wei), which for liquidBTC-class tokens (8-dec, P≈1.18e11) is ≈1,180 USD-6 units ≈ $0.0012, and ≤1 unit for 18-dec/stables. If a per-element recompute misses: check `price@B vs @B−1`, re-evaluate under the other frame, require one exact match; neither ⇒ FAIL.
4. **Residue weld**: post-liquidation `borrowingOf` vs replay, tolerance exactly ≤1 normalized wei ⇒ ≤1 USD-6 unit, ONLY for fully-liquidated accounts, citing the silent zeroing at `DebtManagerCore.sol:549-553`. This is the single legitimate standing tolerance in Task 6.

**Floor**: the frame is N=31 by construction — the floor is **the frame itself**, frozen: commit the 31 tx hashes into the repo before the wave (re-drawing "5 uniform-random per bucket" each run makes failures non-reproducible — committed inputs or it isn't acceptance). Hard backstop ≥25 evaluated if archive reads fail, with every skipped case named with its RPC failure. Composition assertions by identity, not count: the 153,399,414 singleton present; each bucket's max-fanout case present; ≥1 two-pass (two `Liquidated` in one tx) case force-included if any exists among the 763 — the 50%-then-remainder path is the hardest accounting and a random draw may miss it.

## R3 — Cohort floors per gate

The governing rule: **where the population is small, the cohort is the population, count-asserted against an independent chain census at the run's own pin — a numeric constant is only a backstop.** Fixed constants go stale in both directions (above population ⇒ guaranteed fail ⇒ someone weakens the gate later; below ⇒ cherry-picking room).

- **Aave HF gate**: the plan's "≥ 20 HF-gated borrowers" is **infeasible as written** — the book has exactly 12 finite-HF borrowers (recon/p3-probes.md, P-2). Replace with: ALL finite-HF borrowers, count welded `== census` (distinct accounts with nonzero scaled debt, cross-checked vs a chain-side sweep); backstop ≥10 finite; PLUS ≥10 zero-debt (max-uint mapping) and ≥10 never-seen (phantom-debt probe — assert **both** sides clean: absent from raw_logs AND zero chain state at pin); PLUS the component-4 sharpness clause from R1. Printed report splits finite/infinite counts.
- **DM boolean weld**: ≥25 backstop is fine (population ~9,640), but with composition constraints or 25 healthy stables prove nothing: ALL live liquidatable accounts included (the three sub-1.0 dust positions — without them the TRUE side of the boolean is never exercised; assert `== liquidatable census`, not "≥3"); ≥10 healthy debtors; ≥5 multi-collateral (≥3 tokens — exercises per-token-floor-then-sum); **≥1 account holding liquidUSD** (the base-snap asset must appear in a welded valuation); the nearest-boundary account by `|debt − maxBorrowLT|` force-included with its margin printed; sampled remainder drawn with a committed seed.
- **Param weld**: floor = **set equality vs the chain enumeration at pin** — `getReservesList@pin` (expect 4) and `getCollateralTokens()∪getBorrowTokens()@pin` (expect ~21 incl. both liquidRESERVE contracts) — both directions (no missing, no extras). See R5-2 for why the committed-file framing is backwards.
- **tokenConfig sweep**: same set-equality law; floor = chain enumeration count, never "~20".
- **Adapter-output weld**: strengthen the plan's ≥1/reserve to ≥3 rows per reserve across distinct anchors, each exact at its own anchor.

## R4 — tokenConfig sweep: assertions and mismatch procedure

Per token, one pinned `tokenConfig(address)` read, the **full struct committed as evidence** (oracle, priceFunctionCalldata, isChainlinkType, oraclePriceDecimals, maxStaleness, dataType, isStableToken, baseAsset), plus `decimals()` on the token. Gated assertions:

1. **Stable set equality**: `{t : isStableToken}` == the model's snap set {USDC, USDT, frxUSD}, both directions. An unexpected stable is a snap the model doesn't apply; a missing one is a snap it invents.
2. **Base composition equality**: `baseAsset` per token == the scenario matrices' composition claims (liquidUSD→USDC, eUSD→0, liquidETH→ETH-base, liquidBTC/eBTC→WBTC-base, sETHFI→ETHFI, …). This is the enumeration that closes the lens-composition class my Task-4 ruling promoted.
3. **Scenario-flag invariant, mechanical**: for every propagation row with `base_stable_snap`: `tokenConfig(asset).baseAsset ≠ 0 ∧ tokenConfig(baseAsset).isStableToken`; for every `stable_snap` row: `isStableToken`. Cheap, and it makes the scenario schema chain-welded rather than author-asserted.
4. **DM param weld proper**: `collateralTokenConfig(token)` LTV/liquidationThreshold/liquidationBonus at pin == derived param rows, exact (these feed `getMaxBorrowAmount` — one wrong threshold is a wrong boolean for the whole token cohort).
5. Decimals: token `decimals()` == registry (the 10^dec valuation denominator); `oraclePriceDecimals` recorded (consumed by the composition law).

**Mismatch procedure: gated FAIL — block acceptance** for any field that feeds a served surface (isStableToken, baseAsset, threshold, bonus, decimals, oracle binding). Every such mismatch is a wrong-number generator, and the liquidUSD episode is the existence proof. Sole disclose-with-quarantine carve-out: oracle-mechanism fields on a **dead** token (zero collateral across the book AND zero borrow history at pin) — and even there, threshold/bonus still block because the param API serves them.

## R5 — Adversarial read of the plan text: five ways it passes vacuously or proves less than it appears

1. **"Aave HF-gated borrowers ≥ 20" cannot be satisfied honestly** — 12 finite-HF borrowers exist. As written it forces either guaranteed failure (the classic prelude to someone loosening the gate — the carpet path) or silent padding with infinite-HF accounts. Fix per R3.
2. **Param weld "set-equality vs the committed recon/feeds.json set" is self-referential** — the file is ours; file==derived proves internal consistency, not truth. The load-bearing equality is vs the chain enumeration at pin; the committed file is then welded to the chain set as a third leg. A governance-added reserve must fail the gate even when file and DB agree with each other.
3. **The backtest clause is tautology-shaped** ("liquidatable==true at execution" — the contract guarantees it). Without the R2 obligations (derived-debt weld vs `beforeDebtAmount`, OUR boolean, seizure recompute) the gate can never fail and proves nothing about our pipeline.
4. **The B3 scan has no failure mode** ("upgrades grades or records the qualifier" — a gate that can only pass). Give it teeth: scan the FULL AnswerUpdated history per raw aggregator; per feed print max gap and p99; `max gap ≤ heartbeat` ⇒ upgrade provenance grade; `∈ (heartbeat, heartbeat+grace]` ⇒ qualifier; `> heartbeat+grace` ⇒ the freshness budget is **falsified** ⇒ gated FAIL, budget raised with provenance downgraded. Caveat to implement: Chainlink proxies re-point aggregators on phase changes — a gap spanning a phase boundary is an artifact; detect and split by phase before judging.
5. **"All EXACT" without a declared input frame lets an implementer weld nothing.** A gate that reads every input at pin — scaled balances included — re-proves only the law (already proven) and tests no derived state. The brief must require: per gate, an exhaustive `derived-under-test` list and `pinned-read` list; the report FAILS if any component consumes an undeclared source. Corollary: the run's only permitted tolerances are the three derived in R1/R2 (1-wei residue; one-token-wei seizure round-trip; the disclosed marginality band). **Any other epsilon appearing in the Task 6 diff is tolerance-as-carpet and blocks.**

Plus one freeze rule already implied by R2: every sampled cohort (DM weld remainder, backtest frame) reproducible from committed inputs — frame hashes and sampling seed in the repo, printed in the report.

---

## VERDICT on the Task 6 plan text as it stands: **NUMBERS DO NOT HOLD** (as acceptance criteria — fixable in the brief, before Codex sees it)

Blocking list: (1) infeasible/paddable Aave cohort floor (R3/R5-1); (2) self-referential param-weld target (R5-2); (3) tautology-shaped backtest clause — needs R2's four per-case obligations and the frozen frame; (4) B3 scan without a failure mode (R5-4); (5) missing derived-vs-pinned input-frame declaration, which is the difference between welding our state and re-proving our own law (R1/R5-5). Adopt those five into the brief and the gate set is the strongest proof surface this project will have shipped; the tolerances are three, each with a cited mechanism, a direction, and a bound — everything else is zero.

Key files: `C:\Users\kasel\source\repos\etherfi\Solvent\docs\plans\2026-07-28-solvent-phase3-risk-engine-api.md` (Task 6, :171-181), `C:\Users\kasel\source\repos\etherfi\Solvent\recon\cash-v3\src\debt-manager\DebtManagerStorageContract.sol` (:498-502, :549-553 via Core), `C:\Users\kasel\source\repos\etherfi\Solvent\recon\cash-v3\src\debt-manager\DebtManagerCore.sol` (:504-584, :613-658), `C:\Users\kasel\source\repos\etherfi\Solvent\recon\p3-probes.md` (12-borrower census, N=31 frame), `C:\Users\kasel\source\repos\etherfi\Solvent\cmd\reconcile\phase2.go` (:446, existing weld-universe law to reuse).
