# Phase 2 recon — derivation semantics & oracle wiring

Sources: `recon/cash-v3` clone (ether.fi cash-v3, read at the emit sites cited below), live OP/ETH
RPC state pinned at OP block **154,587,841** and validated per borrower at the block noted in the
validation section. All file:line references are into `recon/cash-v3/`.

Contract addresses (code-verified on-chain):

| Role | Chain | Address |
|---|---|---|
| Debt Manager (UUPS proxy) | OP (10) | `0x0078C5a459132e279056B2371fE8A8eC973A9553` (deployed at block 149,521,228 exactly; `cast code` empty at 149,521,227) |
| PriceProviderV2 | OP (10) | `0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB` |
| Aave v3 ether.fi-market Pool | ETH (1) | `0x0AA97c284e98396202b6A04024F5E2c65026F3c0` |
| AaveOracle | ETH (1) | `0x43b64f28A678944E0655404B0B98E443851cC34F` |

## Debt Manager event semantics

All eight signatures are declared in `src/debt-manager/DebtManagerStorageContract.sol` (:149, :157,
:166, :177, :232, :240, :263, :271). Semantics below come from reading the emitting function bodies,
not names.

Internal accounting model (load-bearing for everything below): per-user debt is stored as
`userNormalizedBorrowings[user][token]` — a **normalized USD amount** (USD 6-decimals divided by the
interest index, 1e18 scale). Live debt = `normalized × currentIndex / 1e18`
(`_getActualBorrowAmount`, DebtManagerStorageContract.sol:520-522). The index grows linearly per
second between updates: `getCurrentIndex` (:559-567) = `snapshot + snapshot × borrowApy × dt / 100e18`,
compounding only at each `_updateInterestIndex` (:540-551). Initial index = `PRECISION` = 1e18
(`_setBorrowTokenConfig`, DebtManagerAdmin.sol:179). `setBorrowApy` reindexes before changing the
rate (DebtManagerAdmin.sol:196), so the (index, APY) pair is fully reconstructible from
`InterestIndexUpdated` + `BorrowApySet` + `BorrowTokenConfigSet` events.

| Event | Params (indexed marked) | Emit site | State transition | Units |
|---|---|---|---|---|
| `Supplied` | `sender`*, `user`*, `token`*, `amount` | DebtManagerCore.sol:423 (`supply` :408-424) | `sender` (= msg.sender) pays `amount` of `token` in; **`user` is credited** with pool shares `amount × totalShares / totalPool` (:414-417). Supplier-side, not debt-side. | `amount` = borrow-token native decimals |
| `WithdrawBorrowToken` | `withdrawer`*, `borrowToken`*, `amount` | DebtManagerCore.sol:451 (`withdrawBorrowToken` :432-452) | `withdrawer` (= msg.sender) burns shares `ceil(amount × totalShares / totalPool)` and receives `amount`. | token native decimals |
| `Borrowed` | `user`*, `token`*, `amount` | DebtManagerCore.sol:481 (`borrow` :461-482) | `user` (= msg.sender, an EtherFiSafe) debt **increases**. Debt added = `usd = amount × price(token) / 10^dec` (USD 6-dec, :468), stored as `+ceil(usd × 1e18 / index)` (:469-472, `Rounding.Ceil`). Tokens go to the settlement dispatcher, **not** to the user (:478-479). | **`amount` = token native decimals** (NOT USD) |
| `Repaid` | `user`*, `payer`*, `token`*, `amount` | DebtManagerCore.sol:602 (`repay` :491-512 → `_repayWithBorrowToken` :595-603) | `user`'s debt **decreases**; `payer` (= msg.sender) supplies the tokens. Debt removed = `−floor(amount_usd × 1e18 / index)` (:507, `Rounding.Floor`). Repay is capped at outstanding debt incl. interest (:502-505). | **`amount` = USD 6-decimals** (`repayDebtusdAmount`), *asymmetric with `Borrowed`* |
| `Liquidated` | `liquidator`*, `user`*, `debtTokenToLiquidate`*, `userCollateralLiquidated[]`, `beforeDebtAmount`, `debtAmountLiquidated` | DebtManagerCore.sol:584 (`liquidate` :521-529 → `_liquidateUser` :537-555 → `_liquidate` :564-585) | `user`'s debt decreases by `−floor(debtAmountLiquidated × 1e18 / index)` (:578-580); collateral moves from the user's Safe to `liquidator` via `cashModule.postLiquidate` (:575). Emitted up to twice per `liquidate()` call (50% pass, then remainder pass, :540-546). | `beforeDebtAmount`, `debtAmountLiquidated` = USD 6-dec; tuple array below |
| `UserInterestAdded` | `user`*, `borrowingAmtBeforeInterest`, `borrowingAmtAfterInterest` | **never emitted** (declared :232; zero emit sites in the entire clone) | — | — |
| `InterestIndexUpdated` | `borrowToken`*, `oldIndex`, `newIndex` | DebtManagerStorageContract.sol:548 (`_updateInterestIndex` :540-551) | Snapshot index for `borrowToken` moves `oldIndex → newIndex`; emitted by every borrow/repay/liquidate/setBorrowApy tx **unless** an earlier tx at the same block.timestamp already updated (:542 early-return). Same timestamp ⟺ same block on OP, so every mutating block carries ≥1. | 1e18 fixed-point index |
| `TotalBorrowingUpdated` | `borrowToken`*, `before`, `after` | **never emitted** (declared :240; zero emit sites) | — | — |

topic0 hashes (`cast keccak`):

```text
Borrowed              0x3fc499aeb0bb1cb58b6de8b02b3f86f4e7394e9690bef0110e32ced8a5631045
Repaid                0x861660e9b7ead7183d53fe928b5638c7b57a7bcf16a89d7fdb04db65ce3ad6d5
Supplied              0x50413727b37795d672f09d0997645a955fa227befaefdd4adb611542dea3fd80
Liquidated            0xfd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c
WithdrawBorrowToken   0x2930a7b877d817b672bfa2846d236a1da511a35f283e7a75c55d4124216841e6
UserInterestAdded     0x0888589249a19f760c73a4c12cef4d35bba86ecf227a50bccf8387efa0bf721e
InterestIndexUpdated  0xc6ecd996cf998cfeedb2b1379b047e8579d888439dacbc60641c6dfd07f1f802
TotalBorrowingUpdated 0x129c6de5e40c1dd150d47fb9ae711d9c22b118affbbaa6c3851334318b804d72
```

Brief's explicit questions:

- **(a) Does `Repaid.amount` include interest?** Yes. It is the USD value actually removed from the
  position, and since the position value is `normalized × index` (interest-bearing), any repayment
  pays principal+interest pro-rata. It is capped at `borrowingOf(user, token)` including interest
  (DebtManagerCore.sol:501-505). Note it is USD 6-dec, not token units.
- **(b) Does `Σ Borrowed − Σ Repaid + Σ UserInterestAdded = borrowingOf()` hold?** **No — the
  identity as stated is unimplementable and numerically wrong.** (1) `UserInterestAdded` is never
  emitted by the deployed source. (2) `Borrowed.amount` is token units while `Repaid.amount` is USD —
  they are not even in the same unit (they coincide numerically only for USDC because the oracle
  snaps stables to exactly 1e6). (3) Interest accrues continuously through the index, not through
  discrete events. The identity that DOES hold exactly (validated below) is:
  `borrowingOf(user, tok) = floor( [ Σ_b ceil(usdᵇ·1e18/idxᵇ) − Σ_r floor(usdʳ·1e18/idxʳ) − Σ_l floor(usdˡ·1e18/idxˡ) ] × currentIndex / 1e18 )`
  where each event uses the index at its own block (from `InterestIndexUpdated`), modulo the 1-wei
  liquidation-residue caveat (DebtManagerCore.sol:549-553, silent zeroing without any event).
- **(c) `Liquidated`'s `(address,uint256,uint256)[]` element** = `LiquidationTokenData { token,
  amount, liquidationBonus }` (DebtManagerStorageContract.sol:80-84, populated in
  `_getCollateralTokensForDebtAmount` :613-644): `token` = collateral token transferred to the
  liquidator; `amount` = **total** collateral token units sent **including** the bonus; 
  `liquidationBonus` = the bonus portion of `amount`, same token units. USD value credited against
  debt for an element = `convertCollateralTokenToUsd(token, amount − liquidationBonus)`.
- **(d) `Supplied` payer vs credited:** first address `sender` = payer (`msg.sender`, source of
  funds, :421), second address `user` = account credited with supplier shares (:416). They differ
  whenever someone supplies on behalf of another account; EtherFiSafes cannot be credited (:412).

Derivation caveats for Tasks 4–6:

1. `Borrowed` needs a token→USD conversion at emit-time oracle price. For `isStableToken` tokens
   (USDC/USDT/frxUSD) the PriceProviderV2 snaps to exactly 1e6 within a ±1% band, so
   `usd = amount` (6-dec tokens) / `amount/1e12` (18-dec) is exact while in band — and 100% of the
   305,045 historical `Borrowed` events are USDC. For non-stable borrow tokens (liquidUSD @1.168,
   EURC @1.14, weEUR, liquidRESERVE — all currently configured borrow tokens with zero borrow
   history), exact USD reconstruction from events alone is impossible (poll price required).
2. The 1-wei normalized residue zeroing after full liquidation (:549-553) emits nothing; a deriver
   should zero a position whose remaining normalized amount is exactly 1 wei after the second
   liquidation pass of a tx, or tolerate ≤1-wei-normalized drift on fully-liquidated accounts.
3. `Supplied`/`WithdrawBorrowToken` shares math depends on `_getTotalBorrowTokenAmount` =
   `poolUsd→token + IERC20.balanceOf(debtManager)` (DebtManagerStorageContract.sol:488-490), i.e. on
   the contract's raw token balance, which **can change without any Debt Manager event** (direct
   ERC20 transfers, repay inflows). Supplier-share state is therefore NOT exactly event-derivable;
   supplier events should be indexed as flows, with `supplierBalance()` treated as poll-only.
4. Collateral is **not custodied** by the Debt Manager: `collateralOf()` reads live ERC20 balances
   of the user's Safe via CashLens (DebtManagerCore.sol:170-182). No Debt Manager event tracks
   collateral movement (spend/top-up/plain transfers). Collateral state requires ERC20 Transfer
   streams over the Safe addresses (or polling), not Debt Manager logs.

## Debt identity validation

Method (local `raw_logs` was empty — see execution log — so history was fetched straight from the
RPC; identical bytes to what Phase 1 stored): all `Borrowed`/`Repaid`/`Liquidated` logs of the Debt
Manager from its deployment block 149,521,228 were downloaded in 0.5–1M-block chunks. For each of
the three borrowers every event was joined with the `InterestIndexUpdated(USDC).newIndex` of its own
block, normalized with the exact source rounding (Ceil on borrow, Floor on repay/liquidation,
`mulDiv` on `big.Int`), summed, multiplied by `getCurrentIndex(USDC)` at a pinned head block, and
compared with `borrowingOf(user, USDC)` called at the same pinned block.

`price(USDC)` archive spot-checks at blocks 149,521,300 / 150.5M / 151.5M / 152.5M / 153.5M /
154.5M all returned exactly `1000000` (stable snap held), so `usd = amount` for every USDC borrow.

Dataset actually used: `Borrowed` 305,045 logs (complete 149,521,228 → 154,587,841; 100% USDC;
5,223 distinct borrowers), `Repaid` 22,729 logs and `Liquidated` 763 logs (both complete
149,521,228 → **154,021,227**, the pinned comparison block `PIN`). Every event of the three chosen
borrowers was joined with the `InterestIndexUpdated(USDC).newIndex` of its own block — all 154
required blocks contained **exactly one** IIU(USDC) log, empirically confirming the
one-index-update-per-mutating-block invariant. `getCurrentIndex(USDC)` at PIN = 1042402553573226850.

Borrower selection: candidates were screened so that their entire debt history is event-visible —
`borrowingOf(user, USDC) == 0` both at the migration-end block 149,986,254 AND at (first Borrowed
block − 1). (First-choice candidates all failed the migration screen — see the migration finding
below; one candidate `0x09719762…c4d2` carried exactly 1 wei of migrated normalized dust and was
discarded.)

| Borrower (Safe) | borrows | repays | Σ usd borrowed | Σ usd repaid | naive Σ (B−R) | net normalized | derived = floor(net×idx/1e18) | `borrowingOf` @ PIN | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `0x0303a641b9255a4240e879c76efc704dc1c6383d` | 43 | 12 | 599,140,000 | 598,283,168 | 856,832 | 963,813 | **1,004,681** | **1,004,681** | exact |
| `0x0b7043c82c5ad152137ad7d503daa02f5e777f85` | 38 | 7 | 4,952,567,125 | 806,556,061 | 4,146,011,064 | 3,985,789,485 | **4,154,797,137** | **4,154,797,137** | exact |
| `0x05e3a665efc843d77e3867ee6db41bc38d1ed33f` | 41 | 13 | 618,106,550 | 610,664,757 | 7,441,793 | 7,153,773 | **7,457,111** | **7,457,111** | exact |

All amounts USD 6-decimals. The **normalized replay matches the view bit-exactly for all three**;
the naive `Σ Borrowed − Σ Repaid` is wrong by the accrued interest (e.g. borrower 1: 856,832 naive
vs 1,004,681 actual — 17% off). Replay arithmetic (throwaway Go `big.Int` program, exact source
rounding):

```go
// borrow:  net += ceil(usd * 1e18 / idx)      // DebtManagerCore.sol:469  Rounding.Ceil
// repay:   net -= floor(usd * 1e18 / idx)     // DebtManagerCore.sol:507  Rounding.Floor
// liq:     net -= floor(usd * 1e18 / idx)     // DebtManagerCore.sol:578  Rounding.Floor
// derived  = floor(net * currentIndex / 1e18) // DebtManagerStorageContract.sol:521
```

Liquidation-path spot check (no liquidated borrower has a migration-free history, so the decrement
was validated per-event on migrated Safe `0xac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc`, liq block
151,731,530, idx = 1036365345262130760): view `borrowingOf` at block−1 = 31,690,519 = event
`beforeDebtAmount`; event `debtAmountLiquidated` = 15,845,260; naive subtraction gives 15,845,259
but the view at the liq block returns **15,845,260** — and the normalized replay reproduces it:
`floor(15845260·1e18/idx) = 15,289,260` removed, `floor((norm_before−15,289,260)·idx/1e18) =
15,845,260` [ERRATUM 2026-07-23: originally recorded 15,289,230 — digit typo; 15,289,260 proven by
exact arithmetic against this section's own beforeDebt/view figures during Task 5 review]. Exactly
the ±1-wei class of error the normalized model avoids.

### Migration finding (event-invisible debt genesis)

While screening borrowers, Safe `0xac5f3ce9…5fcc` showed 3 `Liquidated` events but **zero
`Borrowed` events in the complete history**. Binary-searching archive state found its debt appearing
at block 149,985,787 — a block whose only Debt Manager log is topic0
`0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b` =
`MigrationBorrowerPositionsSet(address indexed token, uint256 count)` (openchain-resolved; not
present in the current `recon/cash-v3` source — it belonged to an earlier implementation; the proxy
emitted `Upgraded` at deployment 149,521,228 and again at 149,558,074, its first day — later
upgrades were not enumerated). These are
LayerZero-delivered batches (the `commitAndExecute(...)` / `execute302(...)` calldata carries the
per-user amounts inside the LayerZero `message`, which is `abi.encode(address[],uint256[])` —
two PARALLEL dynamic arrays, NOT an interleaved `(address,uint256)[]` tuple array [ERRATUM
2026-07-27: originally recorded as a tuple array; parallel arrays confirmed empirically by the
validated parser `internal/decode.DecodeMigrationCalldata` against the real migration
transactions]) migrating positions from the previous cash deployment:

- **80 batches, 7,337 borrower positions, blocks 149,985,513 → 149,986,254** — all seeded directly
  into `userNormalizedBorrowings` with **no `Borrowed`/`Supplied` events**.
- 7,337 migrated positions vs 5,223 borrowers ever seen in `Borrowed` logs: **the majority of debt
  genesis is event-invisible on the Debt Manager log stream.**
- Consequence: exact debt derivation requires a **genesis snapshot** at block 149,986,254 (poll
  `borrowingOf` per migrated Safe, or decode the 80 migration txs' calldata — the
  `abi.encode(address[],uint256[])` parallel-array message per the erratum above),
  after which the validated normalized replay is exact. Deriving from logs alone is exact only for
  Safes created after the migration window (verified: all three validation borrowers).

## Aave derivation model

ether.fi Aave v3 instance on mainnet (Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0`, an Aave
v3.3-line deployment: the Pool ABI carries `DeficitCreated`/`DeficitCovered` and
`PositionManagerApproved`, and no stable-rate borrowing). Four reserves (below). Model for Tasks 4–6:

- **Scaled-balance + index.** Variable debt: `scaledDebt(user) += rayDiv(amount, variableBorrowIndex)`
  on `Borrow(reserve*, user, onBehalfOf*, amount, interestRateMode, borrowRate, referralCode*)`;
  `−= rayDiv(amount, variableBorrowIndex)` on `Repay(reserve*, user*, repayer*, amount, useATokens)`,
  `LiquidationCall(collateralAsset*, debtAsset*, user*, debtToCover, liquidatedCollateralAmount,
  liquidator, receiveAToken)` (debt side = `debtToCover`), and `DeficitCreated(user*, debtAsset*,
  amountCreated)` (bad-debt burn). Live debt = `ceil(scaledDebt × variableBorrowIndex_now / RAY)`
  — the DEPLOYED debt token rounds the scaled→live projection **UP** (aave-v3-origin lineage:
  debt is never understated), NOT classic WadRayMath half-up. Proven on-chain 2026-07-27 at ETH
  pin 25,627,125: scaled 125415 × n 1094089501745475497022017896 (frac ≈ .235) → `balanceOf`
  137216; scaled 83 × n 1000520158840839583052050491 (frac ≈ .043) → `balanceOf` 84. Any
  consumer replicating live debt (reconcile §3.4(b), future P3 risk math) MUST use ceiling.
- **The index comes from `ReserveDataUpdated(reserve*, liquidityRate, stableBorrowRate,
  variableBorrowRate, liquidityIndex, variableBorrowIndex)`**, emitted by `updateState` in the same
  tx *before* the Borrow/Repay/etc. event; between updates the index compounds per-second at
  `variableBorrowRate` (ray, per-second compounding `calculateCompoundedInterest` — Aave's binomial
  3-term approximation), so head-of-stream values need either the approximation replicated or a
  poll of `getReserveNormalizedVariableDebt`.
- **Expected precision:** TWO fold regimes [ERRATUM 2026-07-27: originally recorded as uniformly
  half-up; the regime split was established during Task 5-8 implementation and is normative in
  `internal/derive/aave.go`'s header]. Regime A (blocks < 23,088,584): `rayDiv`/`rayMul` round
  **half-up** (WadRayMath). Regime B (from block 23,088,584 log 542 — the weETH aToken `Upgraded`
  cut — onward): TokenMath DIRECTIONAL rounding (vToken mint `rayDivCeil`, burn `rayDivFloor`;
  aToken balance `rayMulFloor`, vToken balance `rayMulCeil`). Replicating the active regime
  bit-exactly reproduces scaled balances exactly as long as every debt-touching
  event is processed. Residual risk: `repayWithATokens`, isolated `Repay` with `useATokens=true`
  behaves identically on the debt side. Supply-side (aToken/collateral) balances additionally move
  on **aToken ERC20 transfers and `BalanceTransfer`**, which do NOT emit Pool events — Pool-log-only
  derivation is exact for **debt**, but collateral needs the aToken contracts' streams too
  (same limitation class as the OP side).

## Asset registry

### Debt Manager (OP, chain 10) — 20 collateral tokens, 8 borrow tokens

`getCollateralTokens()` / `getBorrowTokens()` at OP head 154,587,376; symbol/decimals from each
token; every address `cast code`-verified non-empty. Roles: `debt` = member of `getBorrowTokens()`
(all borrow tokens are also collateral, enforced by `supportBorrowToken`, DebtManagerAdmin.sol:61).

| Token | Address | Decimals | Roles |
|---|---|---|---|
| USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | collateral, debt |
| USDT | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 | collateral, debt |
| weETH | `0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF` | 18 | collateral |
| WETH | `0x4200000000000000000000000000000000000006` | 18 | collateral |
| frxUSD | `0x80Eede496655FB9047dd39d9f418d5483ED600df` | 18 | collateral, debt |
| liquidETH | `0xf0bb20865277aBd641a307eCe5Ee04E79073416C` | 18 | collateral |
| liquidBTC | `0x5f46d540b6eD704C3c8789105F30E075AA900726` | 8 | collateral |
| liquidUSD | `0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C` | 6 | collateral, debt |
| eBTC | `0x657e8C867D8B37dCC18fA4Caead9C45EB088C642` | 8 | collateral |
| eUSD | `0x939778D83b46B456224A33Fb59630B11DEC56663` | 18 | collateral |
| EURC | `0xDCB612005417Dc906fF72c87DF732e5a90D49e11` | 6 | collateral, debt |
| WHYPE | `0xd83E3d560bA6F05094d9D8B3EB8aaEA571D1864E` | 18 | collateral |
| ETHFI | `0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f` | 18 | collateral |
| sETHFI | `0x86B5780b606940Eb59A062aA85a07959518c0161` | 18 | collateral |
| beHYPE | `0xA519AfBc91986c0e7501d7e34968FEE51CD901aC` | 18 | collateral |
| liquidRESERVE | `0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a` | 18 | collateral, debt |
| liquidRESERVE | `0xca5921DF65E2e1b0B98Ae91c0187BA80D4124898` | 18 | collateral, debt |
| weEUR | `0xcC476B1a49bcDf5192561e87b6Fb8ea78aa28C13` | 18 | collateral, debt |
| liquidRWA | `0x17bC8Ffd82b8a36e737Ca1141C025089589B915e` | 18 | collateral |
| OP | `0x4200000000000000000000000000000000000042` | 18 | collateral |

(The two `liquidRESERVE` entries are distinct contracts with identical symbol AND name
"Ether.Fi Liquid Reserve", sharing one oracle `0x58dDf77A…1356`; disambiguate by address only.)

### Aave v3 ether.fi market (ETH, chain 1) — 4 reserves

| Token | Address | Decimals | Roles |
|---|---|---|---|
| weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | 18 | collateral |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | collateral, debt |
| PYUSD | `0x6c3ea9036406852006290770BEdFcAbA0e23A0e8` | 6 | collateral, debt |
| FRAX | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | 18 | collateral, debt |

(Role split per current on-chain reserve configuration: weETH is the collateral asset of the
market design; the three stables are the borrowables. Task 3 config can refine from
`getConfiguration` bits if it needs LTV-level truth.)

## Oracle wiring

### Debt Manager side (OP) — poll-only, canonical

Engine truth is `PriceProviderV2.price(address)` at `0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB`
(from `deployments/mainnet/10/deployments.json`; `isBaseAsset()` probe confirms the V2 layout):
returns **USD with 6 decimals** per whole token (`decimals()` = 6). `isStableToken` configs snap to
exactly `1e6` inside a ±1% band (PriceProvider.sol:303-310 — same logic in V2). This is the exact
function the Debt Manager calls at borrow/repay/liquidation time (DebtManagerCore.sol:378, 501), so
**`kind: "poll"` on the PriceProviderV2 is the engine-exact choice for every OP asset** — there is
no single AnswerUpdated stream that reproduces it (see per-token mechanisms).

Underlying per-token mechanisms (from `tokenConfig(token)` on-chain, decoded with the V2 struct):

| Token | Oracle | Mechanism |
|---|---|---|
| USDC / USDT / WETH / OP | `0x16a9FA2F…E0f3` / `0xECef79E1…F5E` / `0x13e3Ee69…8c5` / `0x0D276FC1…246` | Chainlink push proxies (AnswerUpdated exists on their aggregators) — but stables snap to 1e6, so the stream is not the engine price |
| weETH | `0xb4479d43…6E3` (weETH/ETH, 18-dec) × ETH/USD | composite: exchange-rate feed × ETH feed |
| liquidETH/liquidBTC/liquidUSD/eBTC/eUSD/sETHFI | accountant lenses, calldata `0x679aefce` = `getRate()` | pure view rate, **no logs → poll-only**; some with baseAsset composition (ETH, WBTC, USDC, ETHFI) |
| EURC/WHYPE/ETHFI/beHYPE | custom feeds, calldata `0xa035b1fe` = `price()`, 16-dec | push-updated custom stores, no Chainlink interface |
| frxUSD / liquidRESERVE / weEUR / liquidRWA | CL-shaped adapters (`description()` works, `aggregator()` reverts), some 7-day staleness | custom adapters, treat as poll |

### Aave side (ETH) — Chainlink streams behind cap adapters

`AaveOracle.getSourceOfAsset` returns Aave **price-cap adapters** (BASE_CURRENCY_UNIT = 1e8):

| Reserve | Cap adapter (source) | description() | Underlying CL proxy | Raw aggregator (AnswerUpdated emitter) | Feed dec | First AnswerUpdated block |
|---|---|---|---|---|---|---|
| weETH | `0xf112aF6F0A332B815fbEf3Ff932c057E570b62d3` | "Capped weETH / eETH(ETH) / USD" | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (ETH/USD) + `RATIO_PROVIDER()` = weETH `getRate()` | `0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5` | 8 | 20,779,893 |
| USDC | `0xB6557F02F0a5dA7b9D3C2d979cc19e00e756F6dA` | "Capped USDC/USD" | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7` | 8 | 20,188,117 |
| PYUSD | `0x36964C0579D02E0a5AaAb89E24Cf8d7CDF3549EE` | "Capped pyUSD/USD" | `0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1` | `0x39E31761911b9aaBAEF5fb81B18Fd1C24a60E884` | 8 | 19,626,469 |
| FRAX | `0xeF50f8DC65402c3019586bc8725fCD0b99B8AAd7` | "Capped FRAX/USD" | `0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD` | `0x8F73090a7c58B8BDcC9A93cBB6816e5cC4f01E8c` | 8 | 20,191,185 |

startBlocks were located from each raw aggregator's `getRoundData(1).updatedAt` → `cast find-block`,
then confirmed by finding the actual first `AnswerUpdated`
(topic0 `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`) in a window around it;
all four matched the estimate exactly. `aggregator()` reverts on the cap adapters themselves — they
are not proxies; streams must be walked on the raw aggregators above.

Stream caveats for Task 8: (i) the stable adapters return `min(feed, priceCap)` and the weETH
adapter is `getRate × ETH/USD` with a growth-capped rate — the AnswerUpdated stream reproduces the
*uncapped feed*, not the adapter output; caps bind only in depeg/exploit scenarios, and the weETH
USD price additionally needs the daily-moving `getRate()` ratio (poll) or the ETH-feed stream ×
ratio composition. Composing the stream row with the polled ratio row yields an **uncapped
reference value, never the adapter's guaranteed output** — P3 must implement the growth-cap
behaviour, or read the adapter's own output, before claiming adapter equivalence. (ii) Chainlink
proxies re-point `aggregator()` on phase changes; the recorded aggregator covers the current phase
only — a walker should re-resolve `aggregator()` on staleness.

### Per-feed staleness thresholds — and exactly how well each value is evidenced

`recon/feeds.json` records `oracle.heartbeatSeconds` and `oracle.graceSeconds` per
`chainlink_stream` entry, and the feed deriver judges each stream against its own
heartbeat + grace. This replaced a single global 26h bound, which was **permissive, not
conservative**, for liquidation-facing freshness: a stopped 1h feed could evade it for ~25h beyond
its contractual bound.

Provenance is deliberately stated per value, because these are not equally well established:

| Stream | proxy | heartbeat | grace | threshold | provenance of the heartbeat |
|---|---|---|---|---|---|
| weETH (ETH/USD leg) | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 3600s | 1800s | 1h30m | **Evidence-backed.** The Codex round-1 adversarial review independently observed deployed code consuming *this exact proxy* with a 3600-second heartbeat (constructor evidence at `0x641169f048ee8de8b3037c9d9c840060fe03e463`). |
| USDC | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 86400s | 3600s | 25h | **Not verified by this wave.** 86400s is the published Chainlink mainnet heartbeat for this feed; it was **not** independently confirmed from bytecode or from a consumer's constructor here. |
| PYUSD | `0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1` | 86400s | 3600s | 25h | as USDC — published value, **not** independently verified by this wave. |
| FRAX | `0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD` | 86400s | 3600s | 25h | as USDC — published value, **not** independently verified by this wave. |

Two further honest notes:

- **The grace values are policy, not contract.** They are this repo's operator margin, absorbing
  ordinary publication jitter and the indexer's own derive lag. Nothing on-chain endorses 1800s or
  3600s.
- **Every threshold is tighter than the 26h it replaced**, so no feed became more permissive; the
  three unverified heartbeats are pinned by a fixture test
  (`TestRealFeedRegistryStalenessThresholds`), which also enforces the ≤26h ceiling, so a future
  registry edit cannot silently loosen a liquidation-facing bound. Independently confirming those
  three heartbeats from deployed consumers remains **open work**, not a completed claim.

## Contradictions with plan scope

0. **Debt genesis is event-invisible for migrated positions.** 7,337 borrower positions were seeded
   by cross-chain migration batches (`MigrationBorrowerPositionsSet`, blocks 149,985,513–149,986,254,
   emitted by a since-replaced implementation) with no `Borrowed` events. Any Task 4–6 design that
   folds state purely from the eight Debt Manager events will be wrong for every pre-migration user
   (the majority of debt). Required amendment: a genesis snapshot at block 149,986,254 (archive-poll
   `borrowingOf` per Safe, or decode the 80 migration txs' `(address,uint256)[]` calldata), with the
   validated normalized replay applied from there. Task 3/9 should also add the migration topic0 to
   the indexed set so the genesis boundary is self-describing in `raw_logs`.
1. **The plan's debt identity is not implementable as written.** `UserInterestAdded` (and
   `TotalBorrowingUpdated`) are declared in the deployed interface but have **no emit site** in the
   source; interest accrues continuously via `InterestIndexUpdated`-snapshotted indexes, and
   `Borrowed` (token units) vs `Repaid` (USD 6-dec) are in different units. The *replacement*
   identity — normalized-sum with per-event indexes, Ceil/Floor per source — was validated
   empirically (see Debt identity validation) and is exact modulo the silent 1-wei
   liquidation-residue zeroing (DebtManagerCore.sol:549-553). Tasks 4–6 must be authored against
   the normalized model, not naive Σ-sums.
2. **Local Phase 1 `raw_logs` data was gone** (db volume recreated 2026-07-22 02:23; 0 rows, empty
   cursors, migrations reapplied). Validation used RPC-fetched history instead — same bytes, and
   the identity result is unaffected. Task 9's backfill must re-ingest from scratch, not resume.
3. **Supplier-share and collateral state are not event-derivable on the OP engine** (contract-balance
   dependence and non-custodial collateral, caveats 3–4 above). If any Phase 2 task assumed
   `supplierBalance`/`collateralOf` could be replayed from Debt Manager logs alone, it must be
   rescoped to poll-based snapshots (or ERC20 Transfer streams for Safe balances).
4. Aave-side collateral (aToken balances) similarly needs aToken streams, not just Pool logs; debt
   is Pool-log-exact.
