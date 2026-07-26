# Research Memo — Aave V4 + the ether.fi Whitelabel Instance (OP Mainnet)

- **Date of research:** 2026-07-26
- **Author:** research agent (web research, read-only)
- **Purpose:** ground Solvent's future V4 engine module and the "Migration Observatory" product module in what is actually shipped and actually proposed, with per-claim dating.
- **Method note:** contract-level claims were extracted from the `aave/aave-v4` GitHub repo (`main` branch, fetched 2026-07-26) and Aave's official docs via WebFetch summarization. Signatures below should be re-verified against the pinned release tag / deployed bytecode before any decode code is written (see §4 Freshness Audit).

---

## 1. Aave V4 architecture + event vocabulary (as shipped, 2026)

### 1.1 Status: shipped and live on Ethereum

- Aave V4 went **live on Ethereum mainnet on 2026-03-30** — per Jean Cvllr's contract-anatomy write-up ("On 30th March 2026, Aave v4 went live on Ethereum mainnet"), corroborated by Aave's own launch blog and The Defiant coverage.
  - https://jeancvllr.medium.com/anatomy-of-the-aave-v4-contracts-364fa3189d04 (2026)
  - https://aave.com/blog/aave-v4-live-ethereum (undated on page; "V4 launches today")
  - https://thedefiant.io/news/defi/aave-v4-launches-on-ethereum-mainnet
- The Ethereum activation went through the normal ARFC → Snapshot path (activation ARFC thread: https://governance.aave.com/t/arfc-aave-v4-activation-on-ethereum-mainnet/24293; Snapshot approval reported by https://www.techflowpost.com/en-US/newsletter/117701 and KuCoin news).
- Code: **https://github.com/aave/aave-v4** (public). Audit trail in `audits/` dates the code-freeze window: Blackthorn 2025-10-20 and 2026-02-24, Trail of Bits 2025-11-06, ChainSecurity 2026-01-28 / 2026-02-10 (TokenizationSpoke) / 2026-03-23, Certora formal verification of Hub, Spoke, and Libraries 2026-03-09 and TokenizationSpoke 2026-04-13. Roughly "345 cumulative days of security review… four audit firms… six-week public contest on Sherlock" per launch coverage (https://sherlock.xyz/case-studies/aave).
- Live Ethereum topology (fetched 2026-07-26 from https://aave.com/docs/resources/addresses): four Hubs — Core `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9`, Plus `0x06002e9c4412CB7814a791eA3666D905871E536A`, Prime `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931`, Global Dollar `0x62d63197660c080236193CA60b70E49A08E90368` — and ~10 Spokes (Main Spoke `0x94e7A5dCbE816e498b89aB752661904E2F56c485`, plus Bluechip, Ethena, **EtherFi**, Forex, Gold, Kelp, Lido, Lombard BTC spokes). Note there is already an "EtherFi spoke" on the Ethereum Core deployment — distinct from the proposed OP whitelabel instance.
- **No V4 deployment exists on OP Mainnet as of 2026-07-26** (addresses page lists V4 on Ethereum only; V3 has the multichain footprint).

### 1.2 Hub-and-Spoke as shipped

Sources: https://aave.com/docs/aave-v4 (overview), https://aave.com/docs/aave-v4/liquidity, https://aave.com/docs/aave-v4/liquidity/spokes, https://aave.com/docs/aave-v4/positions, https://aave.com/blog/understanding-aave-v4s-architecture, Jean Cvllr anatomy article — all fetched 2026-07-26.

- **Liquidity Hub** — central settlement layer per chain instance. Registers ERC-20 **assets** (keyed by `assetId`), holds all liquidity, grants each Spoke a **credit line** (borrow allowance) and **debit line** (supply allowance), enforces system-wide caps, tracks everything in **shares**. Contracts: `Hub.sol` (stateless logic), `HubStorage.sol`, `HubConfigurator.sol`, `AssetInterestRateStrategy.sol`, instance wrapper `HubInstance.sol`.
- **Spokes** — user-facing borrowing modules, each with its own reserve list (keyed by `reserveId`, mapping to a hub `assetId`), its own risk parameters, oracle (`AaveOracle`), and liquidation config (target health factor, max-bonus threshold, bonus factor). Contracts: `Spoke.sol`, `SpokeStorage.sol`, `SpokeConfigurator.sol`, plus special-purpose `TokenizationSpoke.sol` (ERC-4626 vault surface) and `TreasurySpoke.sol`.
- **Position managers** — approved delegate contracts through which users can act: `GiverPositionManager` (supply/repay), `TakerPositionManager` (borrow/withdraw via EIP-712 permit-based delegation), `SignatureGateway` (gasless signed intents), `NativeTokenGateway` (ETH wrap/unwrap), `ConfigPositionManager`. This is why every position event carries both `caller` and `user`.
- **Users interact with Spokes; Spokes settle against the Hub.** A user `supply` on a Spoke triggers a Hub `Add` for that Spoke; a user `borrow` triggers a Hub `Draw`; `repay` → `Restore`; `withdraw` → `Remove`. Two event layers fire per user action.

### 1.3 Position-lifecycle event vocabulary (exact, from `main` @ 2026-07-26)

**Spoke layer — `src/spoke/interfaces/ISpoke.sol`** (https://github.com/aave/aave-v4/blob/main/src/spoke/interfaces/ISpoke.sol) — the user-position event surface, 20 events:

Lifecycle core:

```solidity
event Supply(uint256 indexed reserveId, address indexed caller, address indexed user, uint256 suppliedShares, uint256 suppliedAmount);
event Withdraw(uint256 indexed reserveId, address indexed caller, address indexed user, uint256 withdrawnShares, uint256 withdrawnAmount);
event Borrow(uint256 indexed reserveId, address indexed caller, address indexed user, uint256 drawnShares, uint256 drawnAmount);
event Repay(uint256 indexed reserveId, address indexed caller, address indexed user, uint256 drawnShares, uint256 totalAmountRepaid, IHubBase.PremiumDelta premiumDelta);
event LiquidationCall(uint256 indexed collateralReserveId, uint256 indexed debtReserveId, address indexed user, address liquidator, bool receiveShares, uint256 debtAmountRestored, uint256 drawnSharesLiquidated, IHubBase.PremiumDelta premiumDelta, uint256 collateralAmountRemoved, uint256 collateralSharesLiquidated, uint256 collateralSharesToLiquidator);
event SetUsingAsCollateral(uint256 indexed reserveId, address indexed caller, address indexed user, bool usingAsCollateral);
event ReportDeficit(uint256 indexed reserveId, address indexed user, uint256 drawnShares, IHubBase.PremiumDelta premiumDelta);
```

Premium / config-refresh (positions change economics without a transfer):

```solidity
event UpdateUserRiskPremium(address indexed user, uint256 riskPremium);
event RefreshPremiumDebt(uint256 indexed reserveId, address indexed user, IHubBase.PremiumDelta premiumDelta);
event RefreshAllUserDynamicConfig(address indexed user);
event RefreshSingleUserDynamicConfig(address indexed user, uint256 reserveId);
event SetUserPositionManager(address indexed user, address indexed positionManager, bool approve);
```

Spoke admin/config: `SetSpokeImmutables`, `UpdateLiquidationConfig`, `AddReserve(reserveId, assetId, hub)`, `UpdateReserveConfig`, `UpdateReservePriceSource`, `AddDynamicReserveConfig`, `UpdateDynamicReserveConfig`, `UpdatePositionManager`.

User-facing functions: `supply/withdraw/borrow/repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)` and `liquidationCall(uint256 collateralReserveId, uint256 debtReserveId, address user, uint256 debtToCover, bool receiveShares)`.

**Hub layer — `src/hub/interfaces/IHubBase.sol`** (spoke-granular flows, 7 events):

```solidity
event Add(uint256 indexed assetId, address indexed spoke, uint256 shares, uint256 amount);
event Remove(uint256 indexed assetId, address indexed spoke, uint256 shares, uint256 amount);
event Draw(uint256 indexed assetId, address indexed spoke, uint256 drawnShares, uint256 drawnAmount);
event Restore(uint256 indexed assetId, address indexed spoke, uint256 drawnShares, PremiumDelta premiumDelta, uint256 drawnAmount, uint256 premiumAmount);
event RefreshPremium(uint256 indexed assetId, address indexed spoke, PremiumDelta premiumDelta);
event ReportDeficit(uint256 indexed assetId, address indexed spoke, uint256 drawnShares, PremiumDelta premiumDelta, uint256 deficitAmountRay);
event TransferShares(uint256 indexed assetId, address indexed sender, address indexed receiver, uint256 shares);

struct PremiumDelta { int256 sharesDelta; int256 offsetRayDelta; uint256 restoredPremiumRay; }
```

**Hub layer — `src/hub/interfaces/IHub.sol`** (asset/spoke admin + accrual, 9 events):

```solidity
event AddAsset(uint256 indexed assetId, address indexed underlying, uint8 decimals);
event UpdateAsset(uint256 indexed assetId, uint256 drawnIndex, uint256 drawnRate, uint256 accruedFees);   // <-- the V4 heir to ReserveDataUpdated
event UpdateAssetConfig(uint256 indexed assetId, AssetConfig config);
event AddSpoke(uint256 indexed assetId, address indexed spoke);
event UpdateSpokeConfig(uint256 indexed assetId, address indexed spoke, SpokeConfig config);
event MintFeeShares(uint256 indexed assetId, address indexed feeReceiver, uint256 shares, uint256 assets);
event Sweep(uint256 indexed assetId, address indexed reinvestmentController, uint256 amount);
event Reclaim(uint256 indexed assetId, address indexed reinvestmentController, uint256 amount);
event EliminateDeficit(uint256 indexed assetId, address indexed callerSpoke, address indexed coveredSpoke, uint256 shares, uint256 deficitAmountRay);
```

### 1.4 How the shapes differ from V3's Pool events

| V3 (Pool) | V4 equivalent | Shape delta |
|---|---|---|
| `Supply(reserve, user, onBehalfOf, amount, referralCode)` | Spoke `Supply(reserveId, caller, user, suppliedShares, suppliedAmount)` | asset **address → reserveId** (spoke-local uint); **shares carried in the event** (V3 needed the aToken `Mint` event + liquidityIndex to get scaled balance); no referral code |
| `Borrow(reserve, user, onBehalfOf, amount, interestRateMode, borrowRate, referralCode)` | Spoke `Borrow(reserveId, caller, user, drawnShares, drawnAmount)` | no interestRateMode (stable rate is gone entirely); no borrowRate in event (rate lives in Hub `UpdateAsset`) |
| `Repay(reserve, user, repayer, amount, useATokens)` | Spoke `Repay(reserveId, caller, user, drawnShares, totalAmountRepaid, premiumDelta)` | adds a signed **PremiumDelta struct** — repayment settles risk-premium interest, a concept with no V3 analogue |
| `LiquidationCall(collateralAsset, debtAsset, user, debtToCover, liquidatedCollateralAmount, liquidator, receiveAToken)` | Spoke `LiquidationCall(...11 params...)` | far richer: shares AND amounts on both legs, liquidator share credit, premium delta, `receiveShares` flag replacing `receiveAToken` |
| `ReserveDataUpdated(reserve, liquidityRate, stableBorrowRate, variableBorrowRate, liquidityIndex, variableBorrowIndex)` | Hub `UpdateAsset(assetId, drawnIndex, drawnRate, accruedFees)` | **only the borrow (drawn) side has an index**; there is **no supply index and no liquidity rate in any event** — the supply side is a share exchange rate (see 1.5) |
| aToken/vToken `Mint`/`Burn`/`BalanceTransfer` (scaled-balance ledger) | none — no tokens | share ledger is internal to Hub/Spoke storage; only `TransferShares` (hub, spoke-to-spoke granularity) and the optional TokenizationSpoke's ERC-20 events exist |
| `ReserveUsedAsCollateralEnabled/Disabled` | `SetUsingAsCollateral(reserveId, caller, user, bool)` | merged into one event with a flag |

### 1.5 What replaces aTokens / scaled balances, and the interest model

- **No aTokens, no variable-debt tokens.** The Hub tracks all value in a **share-based system** (`SharesMath.sol`): per spoke and per user, `suppliedShares` (deposit claim) and `drawnShares` (debt). Docs: supplies "accrue yield automatically through share-based accounting" (https://aave.com/docs/aave-v4/positions, fetched 2026-07-26); the supply side behaves like an ERC-4626 assets/shares exchange rate (also stated by https://aavescan.com/articles/calculating-crypto-interest-rates).
- **Drawn (borrow) side keeps an index**: each Hub asset has a `drawnIndex` updated by `asset.accrue()`; `UpdateAsset` emits `drawnIndex`, `drawnRate`, `accruedFees` on every accrual touch. Rates come from a utilization-curve `AssetInterestRateStrategy` (base rate + optimal usage ratio), per https://aave.com/docs/aave-v4.
- **User Risk Premium** (new vs V3): an extra borrow-rate margin per user, derived from collateral quality ("Collateral Risk" 0%–1000% per reserve), "recalculated when users withdraw, borrow, or through ad-hoc refresh" (https://aave.com/docs/aave-v4/positions). Tracked per position as `premiumShares` + Ray-scaled `premiumOffset`, moved by the signed `PremiumDelta` struct in Repay/LiquidationCall/Refresh events. Library: `src/hub/libraries/Premium.sol`. Ray = 1e27 as in V3 (`WadRayMath.sol` survives).
- **TokenizationSpoke** is the closest thing to an aToken: an ERC-4626 + ERC-2612 vault over a hub position (`ITokenizationSpoke.sol`, single custom event `SetTokenizationSpokeImmutables(hub, assetId)` plus standard ERC-20/4626 events; `depositWithSig`/`redeemWithSig` etc.). It is opt-in per deployment, not the core accounting primitive. ChainSecurity audited it separately (2026-02-10).

### 1.6 Position identity: address-keyed, no NFTs

- Positions are **keyed by user address, per Spoke** — "a user position represents the complete financial state of a user within a specific Spoke" (https://aave.com/docs/aave-v4/positions, fetched 2026-07-26). Per-reserve storage struct `UserPosition {drawnShares, premiumShares, premiumOffsetRay, suppliedShares, dynamicConfigKey}` (ISpoke, via Jean Cvllr + interface fetch).
- **No position NFTs and no smart-account/sub-account primitive shipped.** The 2024-era V4 previews ("Aave 2030" proposal, May 2024) floated smart accounts/vaults and other concepts; the shipped 2026 design instead achieves multi-position behavior by letting one address hold independent positions on different Spokes, and delegates authority via approved **position managers** (`SetUserPositionManager`) and EIP-712 intents (`SignatureGateway`). Do not build against 2024 blog-spec concepts.
- Health factor: `total collateral value x weighted avg collateral factor / total borrow value`, per Spoke; single **Collateral Factor** replaces the V3 LTV/LiquidationThreshold pair (confirmed independently by the ether.fi ARFC addendum, 2026-07-23). Liquidations use a **target health factor** + variable bonus instead of fixed close factor, with dust clearance below $1,000 (https://aave.com/docs/aave-v4, fetched 2026-07-26).

---

## 2. The ether.fi whitelabel specifically

### 2.1 Governance state (as of 2026-07-26)

| Step | Date | Evidence |
|---|---|---|
| TEMP CHECK posted | 2026-07-01 (forum thread header; some news coverage says "submitted July 3" — minor discrepancy, flag) | https://governance.aave.com/t/temp-check-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25267 |
| TEMP CHECK Snapshot | announced by AaveLabs in-thread 2026-07-07 ("voting will begin in less than 24 hours"); **passed** per news coverage — exact vote percentages NOT retrieved (flag) | thread 25267; https://www.bitget.com/amp/news/detail/12560605493224; https://www.digitaltoday.co.kr/en/view/78195/etherfi-proposes-deploying-dedicated-aave-v4-instance-on-op-mainnet |
| ARFC posted | 2026-07-14 22:37 | https://governance.aave.com/t/arfc-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25314 |
| ARFC addendum (finalized V4-format risk params) | 2026-07-23 15:07 | same thread, addendum post |
| ARFC Snapshot | **not yet observed** as of 2026-07-26 | thread shows status "ARFC stage (pre-Snapshot)"; latest replies 2026-07-26 (Abel189, MconnectDAO) are still feedback-stage |
| AIP / execution | **not started**; proposal targets "AIP targeting a July 2026 deployment" | thread 25314 |
| On-chain instance | **does not exist** — no V4 contracts on OP Mainnet on the Aave addresses page as of 2026-07-26; no addresses pre-announced anywhere in the proposal | https://aave.com/docs/resources/addresses |

The July-2026 deployment target already looks tight: with the ARFC Snapshot not yet opened on 2026-07-26, AIP + execution within July is improbable; expect August+ slip (inference, not sourced).

### 2.2 Committed parameters (from ARFC 25314 + 2026-07-23 addendum)

- **Topology:** a dedicated, isolated V4 instance — **single Liquidity Hub with one Spoke ("Cash Spoke") at launch**, on **OP Mainnet (confirmed in-proposal)**, fully managed by ether.fi.
- **Scale path:** up to **$175M** assets from ether.fi at launch → **~$500M by end-2026**. Launch capital adds **$20M from the Optimism Foundation**, a **$1.2M incentive package**, and a **$5M GHO position**.
- **Collateral set (20 supply reserves):** weETH, wETH, eBTC, USDC, USDT, EURC, frxUSD, GHO, ETHFI, sETHFI, eUSD, OP, beHYPE, wHYPE, LiquidETH, LiquidBTC, LiquidUSD, LiquidReserve, LiquidEUR, LiquidRWA.
- **Borrowable:** USDC now; **GHO after GHO deploys on OP Mainnet** (GHO params deferred to the risk admin).
- **Risk params (addendum, V4 format):** Collateral Factors 30%–95% (USDC 95% CF), max liquidation bonuses 1%–5%, **flat 10% liquidation fee** across assets. The addendum "supersedes the V3-formatted Risk Parameters table in the original ARFC"; remaining V4 config lands at AIP stage.
- **Economics:** **80/20 revenue split** (ether.fi / Aave DAO — DAO gets 20% of all instance revenues), projected **$1.0–1.2M/yr to the DAO at end-2026 scale** (news coverage quoted "$5–6M annually at full deployment" — discrepancy vs the forum's own number, prefer the forum figure).
- **Operating model:** ether.fi operates (configuration, liquidity, growth); **Nonce Capital is the independent risk admin** (listings, oracles, risk parameters); **2-year initial license** with renewal/termination provisions; **product exclusivity** — EtherFi Cash uses only Aave V4 lending markets.
- **Current book to migrate:** ~**$25M active borrows across 16+ collateral assets** on the proprietary Debt Manager.

### 2.3 Migration mechanism (thin — flag)

All the proposal commits to (ARFC 25314, fetched 2026-07-26): a **"phased migration over a short window, organized in cohorts"** to validate risk controls before the full book moves, **"invisible at the cardholder level"** (product surface unchanged). The 2026-07-23 addendum adds **no** cohort sizes, no timeline, no statement of who signs/executes the migration transactions, and no incentive design. Whether migration is bulk (operator-executed debt re-origination on the new spoke + closure on the Debt Manager) or per-account is **unspecified**. Since cardholders don't self-custody flows in Cash, operator-executed bulk cohort moves are the natural reading (inference). This is the single biggest spec gap for the Migration Observatory.

---

## 3. Indexing implications for Solvent

### 3.1 Decode surface estimate

- **Core position lifecycle (Cash Spoke):** ~12 event types — `Supply`, `Withdraw`, `Borrow`, `Repay`, `LiquidationCall`, `SetUsingAsCollateral`, `ReportDeficit`, `UpdateUserRiskPremium`, `RefreshPremiumDebt`, `RefreshAllUserDynamicConfig`, `RefreshSingleUserDynamicConfig`, `SetUserPositionManager`.
- **Hub flow + accrual layer:** ~9 that matter for derivation — `Add`, `Remove`, `Draw`, `Restore`, `RefreshPremium`, `ReportDeficit` (hub), `TransferShares`, `UpdateAsset`, `MintFeeShares`; plus `Sweep`/`Reclaim`/`EliminateDeficit` for solvency accounting.
- **Config/admin surface:** ~15 (`AddAsset`, `UpdateAssetConfig`, `AddSpoke`, `UpdateSpokeConfig`, spoke's `AddReserve`, `UpdateReserveConfig`, `UpdateReservePriceSource`, dynamic-config events, `UpdateLiquidationConfig`, `UpdatePositionManager`, immutables events, plus Hub/SpokeConfigurator + AccessManager events).
- **Total: roughly 35–45 event types** across two emitting contracts (Hub + Spoke) vs the Debt Manager's single-contract surface, **before** TokenizationSpoke/TreasurySpoke (add ERC-20/4626 standard events if the instance uses them). Two-layer emission means every user action produces a spoke event AND a hub event in the same tx — a natural cross-check but also a dedup concern.

### 3.2 Is position state reconstructable from events alone? Mostly yes — with one asterisk

- **Share-denominated position state: yes, cleanly.** Every lifecycle event carries the share delta (`suppliedShares`/`drawnShares`/`...SharesLiquidated`) AND the underlying amount at execution time, plus `caller` vs `user`. This is *better* than V3, where scaled deltas had to be recovered from aToken/vToken `Mint`/`Burn` events. Premium state is also event-carried via the signed `PremiumDelta {sharesDelta, offsetRayDelta, restoredPremiumRay}` on `Repay`/`LiquidationCall`/`RefreshPremiumDebt`/`ReportDeficit`.
- **The asterisk — supply-side valuation:** converting `suppliedShares` to underlying at an arbitrary block requires the hub asset's **share exchange rate**, and **no event emits it**. `UpdateAsset` gives `drawnIndex` + `drawnRate` (borrow side is fully recomputable V3-style: index at last touch + rate × elapsed time). The supply exchange rate must be *derived*: totalAssets(assetId) / totalSuppliedShares(assetId), where totalAssets evolves with drawn interest accrual minus `accruedFees`/`MintFeeShares`, and totals evolve with `Add`/`Remove`/`Draw`/`Restore`/`EliminateDeficit`. Reconstructable in principle from genesis, but it is a **stateful running computation, not a per-event stamp** — a step up in derivation complexity from V3's `liquidityIndex`-in-every-`ReserveDataUpdated`.
- **Position keying is address-based** (per Spoke, per reserve) — same shape as the Debt Manager and V3. No NFT-transfer repositioning to handle. But `SetUserPositionManager` + the gateway contracts mean `caller != user` is routine; derive on `user`, retain `caller` for forensics.

### 3.3 The V4 completeness weld

The Debt Manager standard (sum of derived per-account state == chain-read aggregate) maps onto V4 as a **three-ring weld**, all against view reads at a pinned block:

1. **User ring (Spoke):** Σ over users of derived `suppliedShares`/`drawnShares`(+`premiumShares`) per `reserveId` == the Spoke's position totals (spoke view getters / `IExtSload` raw storage reads — the repo ships `IExtSload.sol`, a Uniswap-v4-style raw-slot reader, which is a gift for weld implementation).
2. **Spoke ring (Hub):** each Spoke's share totals derived from spoke events == the Hub's per-spoke `SpokeData` (fed by `Add`/`Remove`/`Draw`/`Restore`/`TransferShares`). For the whitelabel (one hub, one spoke) rings 1+2 nearly collapse into one, which makes launch-day welding unusually clean — build it before more spokes are added.
3. **Asset ring (Hub):** Σ spoke supplied shares == hub total supplied shares per `assetId`; Σ spoke drawn shares == hub total drawn; and value-level: derived exchange rate × total shares == hub-reported total assets (this also welds the §3.2 running exchange-rate computation). Exact getter names on `IHubBase`/`IHub` must be confirmed from the ABI (not captured in this research — flag).

### 3.4 Red flags

1. **No supply-index event** (§3.2) — the running exchange-rate derivation is the V4 module's hardest correctness surface; weld ring 3 is its mandatory guardrail.
2. **Signed premium math in Ray** — `PremiumDelta` uses `int256` deltas + a Ray offset; per-user premium debt is a new state dimension with no Debt Manager or V3 analogue. `UpdateUserRiskPremium` and the dynamic-config refresh events change a position's forward economics with **no amount fields at all** — the deriver must track `dynamicConfigKey` per user and config tables per key.
3. **Hub `TransferShares(assetId, sender, receiver, shares)`** moves supplied shares between addresses **without** any spoke `Supply`/`Withdraw` — if the whitelabel ever uses it (treasury ops, migration shortcuts), a spoke-events-only deriver silently drifts. Decode it from day one.
4. **`Sweep`/`Reclaim` reinvestment hooks** — idle liquidity can be moved out to a `reinvestmentController`, so hub token balance ≠ hub accounted liquidity; welds must use accounting views, never `balanceOf`.
5. **Deficit lifecycle** (`ReportDeficit` spoke+hub, `EliminateDeficit`) — bad debt is now an explicit first-class flow; the Migration Observatory should alarm on any nonzero deficit during cohort migration.
6. **Proxy/instance indirection** — deployments use `HubInstance`/`SpokeInstance` wrappers and configurator admin contracts; upgradeability of the ether.fi-managed instance (who holds `HubConfigurator`/`SpokeConfigurator` and behind what timelock) is ungoverned-by-Aave-DAO by design (2-year license, ether.fi-operated, Nonce Capital as risk admin). Implementation-upgrade watching is part of the trust surface Solvent should index.
7. **Whitelabel-specific config drift** — "All remaining V4 configuration will be released at the AIP stage" (addendum, 2026-07-23): the event decode module can be built now, but reserve tables, oracle sources, and caps cannot be pinned until the AIP payload exists.
8. **Off-chain components:** none in the core protocol path (good — fully event+view reconstructable). Oracle price sources per reserve (`UpdateReservePriceSource`) and ether.fi's card-side ledger remain the off-chain-adjacent surfaces; the Debt Manager↔V4 migration itself will be observable only as paired on-chain closes/opens (no protocol-level migration primitive exists in V4 — cohort moves will look like ordinary `Repay`/`Withdraw` on the Debt Manager and `Supply`/`Borrow` on the Cash Spoke).

### 3.5 Migration Observatory sketch (given §2.3's thin spec)

- Run both engines concurrently; define a **cutover ledger**: per account, Debt-Manager debt extinguished vs Cash-Spoke debt originated within a matching window, with conservation tolerance = accrued interest between legs.
- Watch: cohort cadence (bursts of paired events), book drawdown on the DM side toward zero, ramp vs the $175M/$500M path, `ReportDeficit` (must stay zero), liquidations during migration windows (should be suppressed/none if cohorts are managed well), and `UpdateUserRiskPremium` distribution as accounts land on V4 (first-ever per-user pricing signal for the Cash book).
- The existing DM weld keeps running until the DM book is empty; the V4 weld (§3.3) must be live **before** the first cohort moves.

---

## 4. Freshness audit

| Claim | Date of source | Verified with 2026 source? | Notes |
|---|---|---|---|
| V4 live on Ethereum 2026-03-30 | Medium (Jean Cvllr, 2026); Aave blog (undated); Defiant | YES | exact date rests on the Medium article; Aave's own blog post is undated on-page — corroborate against the AIP execution tx before treating the date as canonical |
| V4 event signatures (ISpoke/IHub/IHubBase) | GitHub `main` fetched 2026-07-26 | YES, but `main` ≠ deployed | **must re-verify against the release tag / deployed bytecode ABI**; also these came through WebFetch model summarization of raw files — re-pull the raw .sol files directly before codegen |
| Four hubs + ~10 spokes on Ethereum, addresses | aave.com docs fetched 2026-07-26 | YES | live docs page |
| No V4 on OP Mainnet | aave.com addresses page fetched 2026-07-26 | YES (absence-of-evidence) | absence on the docs page is not proof of absence on-chain; a pre-announced deployment could exist unlisted — check OP explorer once AIP payload is public |
| Share accounting / no aTokens / drawnIndex-only | docs + Medium + repo, all 2026 | YES | supply-side "ERC-4626-like exchange rate" framing partially rests on aavescan.com (third party) |
| No position NFTs | docs (positions page) + interfaces, 2026 | YES | shipped design is address-keyed; contradicts some 2024-2025 V4 preview speculation — treat any pre-2026 V4 architecture writeup as historical only |
| TEMP CHECK posted 2026-07-01 | forum thread fetched 2026-07-26 | YES | news coverage says July 3 (submission vs publish discrepancy, immaterial) |
| TEMP CHECK Snapshot **passed** | news (Bitget, digitaltoday), July 2026 | PARTIAL | **could not retrieve the Snapshot vote result (percentages, turnout) directly** — verify on snapshot.box (space: aavedao.eth) before relying on it |
| ARFC 2026-07-14 + addendum 2026-07-23, status pre-Snapshot | forum fetched 2026-07-26 | YES | status can change any day; re-check before scoping work |
| $175M/$500M, 20 assets, 80/20 split, Nonce Capital, 2-yr license, cohort migration | ARFC thread fetched 2026-07-26 | YES | parameters are ARFC-stage — **not final until AIP**; addendum already superseded the original risk table once |
| DAO revenue $1.0–1.2M/yr | forum, 2026-07-26 | YES | conflicts with news claim of "$5–6M annually" — forum figure preferred |
| "July 2026 deployment" target | forum, 2026-07-26 | YES | already implausible as of 2026-07-26 (ARFC Snapshot not started); expect slip |
| Aave V4 2024 "spec" (smart accounts, unified liquidity layer previews) | 2024-2025 material | N/A — superseded | the shipped 2026 architecture (hub/spoke, shares, premiums, address-keyed positions) is the only valid indexing target |
| Audit list + dates (Blackthorn/ToB/ChainSecurity/Certora, 2025-10 → 2026-04) | repo `audits/` dir fetched 2026-07-26 | YES | filenames only; contents not reviewed |

**Not verifiable / unknown as of 2026-07-26:** ARFC Snapshot date and outcome; AIP payload (final reserve config, caps, oracle sources); any OP Mainnet contract addresses; migration executor and cohort mechanics; whether the whitelabel uses TokenizationSpoke or TreasurySpoke; exact Hub/Spoke view-getter names for the weld (pull from ABI); whether the OP instance will deploy the same code tag as the Ethereum 2026-03-30 release or a newer one.

**Recommended re-checks before any build wave:** (1) governance thread 25314 + snapshot.box for ARFC Snapshot/AIP status; (2) `github.com/aave/aave-v4` releases/tags for the deployment tag and pull the ABI from it, not `main`; (3) aave.com addresses page + OP Etherscan for the instance addresses once the AIP payload lands.
