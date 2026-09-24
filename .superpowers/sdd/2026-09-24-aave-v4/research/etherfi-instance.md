# ether.fi Cash on Aave V4 (OP Mainnet): technical brief

**As of:** OP block 157,337,277 (2026-09-24, about 18:09 UTC). Chain reads went through `SOLVENT_RPC_OP`; its host's second-level domain is `optimism`, so it is the public OP endpoint. I made about 529 read-only RPC calls. That is above the "few hundred" budget, because one 23-reserve state sweep alone took 448. Nothing in the repo or git was changed. Scratch data is in `C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\v4brief_q7\` (`spoke_2k.json`, `mig_big.json`, `mig_tx.json`, `topics.json`).

## Summary

- **What it is:** a whitelabel Aave V4 instance. It has one Liquidity Hub (`CASH_HUB`), one user spoke (`CASH_SPOKE`, an `EtherFiSpokeInstance` that only lets Cash Safes borrow), a TreasurySpoke that receives fees, and one AaveOracle. The ether.fi Owner Safe administers it and Nonce Capital's Operator Safe sets risk parameters. Aave governance holds no roles on it. In the cash-v3 repo the instance goes by "Summer Lend".
- **How positions are keyed:** by the user's Cash Safe address (`onBehalfOf` / `user`). Every user operation goes through the cash-v3 **LendGateway** `0x01F8cDFb1694eA8fE4ED6c38a0fD78d1188E03F4`, which acts as the Safe's position manager. It was the `caller` on all 3,264 supply/withdraw/borrow/repay events I sampled.
- **How migration works:** `DebtManager.migrateToLendGateway(safe)`, one Safe per transaction, sent by a runner EOA. In one transaction it clears the Debt Manager debt, supplies the Safe's collateral to the spoke, borrows the same debt on V4 to refund the Debt Manager, and emits `MigratedToLendGateway(safe, debtUsd)`.
- **Book today:** 31,865,588.63 USDC plus 398.20 WETH drawn, about **$32.92M**, against about **$301M** of supplied collateral. The Debt Manager still holds **$4.49M**, and some legacy Safes still borrow on it.
- **Event volume:** about 98k–133k spoke logs per day, about 141k hub logs per day, and about 50k–68k transactions per day.

---

## 1. Contracts

Every address in this table was checked with `eth_getCode` (code present, size in bytes shown). Getter calls were made at block 157,337,300.

| Role | Address | Code size (bytes) | Extra on-chain check |
|---|---|---|---|
| CASH_HUB (proxy) | `0x66753c4e3fC84f1eD0e3C267C927284E9d90C572` | 1,419 | EIP-1967 implementation slot → `0x697aF342…2cE9` (24,353); `getAssetCount()` = 23 |
| CASH_SPOKE (proxy) | `0xdffcC3536D932eb51Df51a7F5FA407c4270d5308` | 1,419 | implementation slot → `0xA1f75D80…3b68` (24,556); `ETHERFI_DATA_PROVIDER()` = `0xDC515C…A778`; `getLiquidationLogic()` = `0x88dF…8DB8DB`; `MAX_USER_RESERVES_LIMIT` = 64; OP Etherscan label "ether.fi: Borrow Spoke" |
| Spoke AaveOracle | `0xe8cbd37210bF1E29436dAe183d7b9fe45E886fA8` | 2,396 | `spoke.ORACLE()` returns it; `oracle.spoke()` returns the spoke; `decimals()` = 8 |
| TreasurySpoke (fee receiver) | `0x7EB4d25F137868662350603A2863F682287b0768` | 1,419 | registered on every hub asset with addCap 2^40−1 and drawCap 0 |
| Hub IR strategy | `0x51d07C362f9c4716F96EbEB63DB985EF9D2aCd7C` | 2,626 | – |
| AccessManager | `0x188d7173772499FB6375F23FdFd130CE6107286b` | 21,008 | – |
| HubConfigurator / SpokeConfigurator | `0xA39bEf2f…0dbC` / `0xFEe9E8cC…9f8b` | 13,833 / 11,825 | – |
| ConfigEngine | `0x84210b3087E952Be0f3610fD75f0f045995eAF22` | 9,079 | – |
| LiquidationLogic (the canonical Aave library) | `0x88dF535473C5adf1f57789734A05E555F7Deb8DB` | 12,519 | – |
| NativeTokenGateway | `0xB53A2a51f6Ed4B15B7822De4aB678E5Fe554A5Ae` | 8,787 | `isPositionManagerActive` = **false** |
| Launch / activation payloads | `0xBc0D2823…8449` / `0x5F64dE77…20f3` | 22,801 / 794 | execution receipts in §2 |
| Owner Safe (instance admin) | `0x082B85ED50F1cd120C597EF860ece712e54CE844` | 171 (Safe proxy) | target of both launch transactions |
| Operator Safe (Nonce risk curator) | `0x23c30c38d73a0D1609ffAAe47aA7d6D1a3e46f03` | 171 | – |
| **LendGateway** (cash-v3; position manager) | `0x01F8cDFb1694eA8fE4ED6c38a0fD78d1188E03F4`, implementation `0x451dbb55…D3C3` | 122 / 24,365 | `spoke()` = CASH_SPOKE; `isPositionManagerActive(GW)` = **true**; `minHealthFactor()` = 1.1e18 |
| EtherFiDataProvider (borrow gate) | `0xDC515Cb479a64552c5A11a57109C314E40A1A778` | 122 | `isEtherFiSafe(migrated safe)` = true; `isEtherFiSafe(GW)` = false |
| DebtManager (holds the migrator function) | `0x0078C5a459132e279056B2371fE8A8eC973A9553` | 122 | selector `0x56eee510` = `migrateToLendGateway(address)` succeeds on chain; `hasMigratedToLendGateway(safe)` = true |
| AaveV4Lens (cash-v3) | `0x35Ba1a778359421F2757154a35BD4881AcE98C91` | 122 | code only |
| Launch deployer EOA ("ether.fi: Deployer 7") | `0xf8a86ea1Ac39EC529814c377Bd484387D395421e` | 0 | sender of the launch/activation transactions and creator of the spoke |
| Migration runner EOA | `0xb42833d6edd1241474d33ea99906fd4cbe893730` | – | `from` of the sampled migration transaction |

**Where the addresses come from:**
- [etherfi-protocol/aave-v4 `deployments/optimism/10.json`](https://github.com/etherfi-protocol/aave-v4/blob/main/deployments/optimism/10.json): status "live", deployedAt 2026-07-30.
- `scripts/etherfi/AIP_PACKAGE.md`, `src/etherfi/AaveV4EtherfiCash.sol` and `EtherFiSpokeInstance.sol` in the same repo.
- cash-v3 [`deployments/mainnet/10/cash-lend.json`](https://github.com/etherfi-protocol/cash-v3/blob/master/deployments/mainnet/10/cash-lend.json) and `summer-lend.json` (hub and spoke match the table).

**Oracle sources were replaced after launch.** The launch registry pinned raw Chainlink-style feeds. Today, all 23 values of `oracle.getReserveSource(r)` match cash-v3's [`summer-lend-feeds.json`](https://github.com/etherfi-protocol/cash-v3/blob/master/deployments/mainnet/10/summer-lend-feeds.json). Three `description()` reads: "Capped USDC / USD" (`0x5B05…A4E0`), "Capped liquidETH / ETH / USD" (`0xb23A…81d0f`), "ETH / USD" (`0x4060…e16B`). These are ether.fi's CAPO-style adapters (`src/oracle/BaseAaveV4PriceFeed.sol`, Paladin "Aave v4 Price Feeds" audit).

## 2. Deployment and borrowing start

| Event | Block | Time (UTC) | Evidence |
|---|---|---|---|
| Spoke proxy created | **154,915,790** | 2026-07-30 | binary search on `eth_getCode`; Etherscan agrees (tx `0x05405569…af62`, creator Deployer 7) |
| Phase 1 launch payload (dormant config) | **154,924,987** | 2026-07-30 21:59:11 | receipt `0x6b83c289…2b16`, status 1, 333 logs, to Owner Safe |
| Phase 2 activation | **154,925,193** | 2026-07-30 22:06:03 | receipt `0xc2905e08…7aefc`, status 1, 40 logs |
| First V4 borrow | **155,226,763** | 2026-08-06 21:38:23 | tx `0x1b34e111…52fa`: 0.86 USDC, reserve 0, caller GW, user Safe `0xe234d373…b486` |
| Public announcement | – | 2026-08-13 | optimism.io blog |

For an indexer backfill, start at or before **154,915,790**. That catches the spoke's initialisation and all 333 configuration events of the launch transaction (`AddReserve`, dynamic configs, liquidation config).

**Cutover timeline** (`DebtManager.totalBorrowingAmounts()` and `Hub.getAssetOwed(0)` at archive blocks; dates computed at 2-second blocks from the activation timestamp):

| Block | ≈ Date | Debt Manager total (USD) | V4 USDC drawn |
|---|---|---|---|
| 155,015,123 | Aug 02 | 22,601,129 | 0 |
| 155,300,000 | Aug 08 | 22,963,516 | 22.86 |
| 155,500,000 | Aug 13 | 22,882,698 | 430,741 |
| 155,700,000 | Aug 17 | 21,162,014 | 3,786,056 |
| 155,850,000 | Aug 21 | 18,500,273 | – |
| 155,870,000 | Aug 21 | 7,924,545 | – |
| 155,900,000 | Aug 22 | 7,745,831 | 17,897,515 |
| 156,600,000 | Sep 07 | 6,343,441 | 23,810,785 |
| 157,000,000 | Sep 16 | 6,171,830 | 26,651,932 |
| 157,336,816 | Sep 24 | 4,487,982 | 31,864,478 |

## 3. Reserves and parameters (live at block 157,337,125)

**Spoke-wide settings:**
- Liquidation config: `targetHealthFactor` 1.24, `healthFactorForMaxBonus` 0.90, `liquidationBonusFactor` 90%.
- Liquidation fee is 10% on every reserve.
- `collateralRisk` is 0 on every reserve, so there is no risk premium; all premium debt reads 0.
- The hub has 23 assets and the spoke 23 reserves, and reserveId equals assetId. The 19 launch assets are joined by iwSPYx `0xc1e6…8d7c`, iPAXG `0x41a7…676c`, iwQQQx `0x3c99…3516` and iwTBLLx `0x5f8b…c387`.

Column notes: Collateral factor (CF) and bonus are `getDynamicReserveConfig` at the reserve's current key. The caps are the hub's `getSpokeConfig(asset, CASH_SPOKE)` in whole tokens. Supplied and drawn are `getReserveSuppliedAssets` and `getReserveTotalDebt`, valued with `getReservePrice` (8 decimals).

| id | Asset | CF | Max bonus | Borrowable | Add / draw cap | Supplied | Drawn |
|---|---|---|---|---|---|---|---|
| 0 | USDC | 90% | 5% | yes | 70M / 40M | 44.25M ($44.24M) | **31,865,588.63** ($31.86M); rate 4.06% |
| 1 | WETH | 75% | 10% | yes | 2,800 / 600 | 1,558.56 ($4.15M) | **398.20** ($1.06M); rate 1.45% |
| 2 | USDT | 90% | 5% | no | 30M / 0 | 16.61M ($16.61M) | 0 |
| 3 | EURC | 90% | 7.5% | **yes (spoke flag)** | 5M / 250k | 1.26M ($1.44M) | 0 |
| 4 | frxUSD | 90% | 7.5% | no | 5M / 0 | $0.16M | 0 |
| 5 | weETH | 75% | 10% | no | 6,000 / 0 | 3,393.76 ($9.97M) | 0 |
| 6 | eBTC | 72% | 12.5% | no | 200 / 0 | 15.13 ($1.27M) | 0 |
| 7 | eUSD | **0% (key 1), frozen; spoke inactive on hub** | 7.5% | no | 1M / 0 | 0 | 0 |
| 8 | ETHFI | 40% | 15% | no | 5.5M / 0 | $2.26M | 0 |
| 9 | sETHFI | 40% | 20% | no | 28M / 0 | $15.48M | 0 |
| 10 | OP | 40% | 15% | no | 1M / 0 | $0.05M | 0 |
| 11 | WHYPE | 65% | 12.5% | no | 100k / 0 | $0.87M | 0 |
| 12 | beHYPE | 60% | 15% | no | 100k / 0 | $2.78M | 0 |
| 13 | liquidETH | 70% | 15% | no | 50k / 0 | 32,153 (**$94.60M**) | 0 |
| 14 | liquidBTC | 70% | 15% | no | 150 / 0 | $8.24M | 0 |
| 15 | liquidUSD | 90% | 7.5% | no | 90M / 0 | 58.48M (**$68.95M**) | 0 |
| 16 | liquidRESERVE | 90% | 7.5% | no | 2.2M / 0 | $1.68M | 0 |
| 17 | weEUR | 90% | 7.5% | no | 9M / 0 | $6.44M | 0 |
| 18 | liquidRWA | 90% | 7.5% | no | 34.5M / 0 | $21.06M | 0 |
| 19–22 | iwSPYx / iPAXG / iwQQQx / iwTBLLx | 78 / 80 / 78 / 80% | 10% | no | 2k / 300 / 2k / 20k | $0.34M / $0.52M / $0.05M / $0.02M | 0 |

**Differences from the launch spec** (`EtherfiCashLaunchPayload.sol`) that the curator has made since:
- USDC CF fell from 95% to 90%, and its bonus rose from 1% to 5%.
- ETHFI, sETHFI and OP CFs rose from 30% to 40%.
- Caps were raised: USDC 10M/7M → 70M/40M, WETH 1,000/100 → 2,800/600.
- EURC was made borrowable.
- eUSD was frozen with CF 0.
- The 4 xStock/PAXG assets were listed.
- GHO is not listed.

**Utilisation:** USDC is 72% utilised (31.87M drawn of 44.25M added), and the drawn USDC uses **80% of the spoke's 40M draw cap**, leaving about $8.1M of headroom.

## 4. How a Cash position lives on V4

- **Key.** The position is keyed by the **Cash Safe address**. In every spoke event, `topics[3]` (`user`) is the Safe and `topics[2]` (`caller`) is the LendGateway.
- **Borrow gate.** `EtherFiSpokeInstance.borrow` reverts unless `EtherFiDataProvider.isEtherFiSafe(onBehalfOf)` is true. Supply, withdraw, repay and liquidation stay permissionless. Verified: the deployed implementation is `EtherFiSpokeInstance`, its data-provider constant matches, and a real Safe returns true.
- **Approval.** On its first operation for a Safe, the gateway makes the Safe call `setUserPositionManager(GW, true)` on the spoke. This emits `SetUserPositionManager(safe, GW, true)`, one per Safe entering V4 (about 20 per 2,000 blocks right now). Verified: `isPositionManager(safe, GW)` is true.
- **Cash-side health floor.** `LendGateway.minHealthFactor` = 1.10 is a floor for extraction operations such as borrowing or withdrawing. It is not V4's liquidation threshold: V4 liquidates at health factor 1.00.
- **Transaction shapes seen in blocks 157,335,278–157,337,277 (3,148 transactions):**

| Count | Events in the transaction | Likely meaning |
|---|---|---|
| 2,470 | `Withdraw` + `RefreshAllUserDynamicConfig` | debit card spends from supplied balance |
| 349 | `Supply` | auto-supply of loose balances |
| 181 | `Borrow` + `RefreshAll` | credit spends |
| 21 | `SetUserPositionManager` + `Supply` + `SetUsingAsCollateral` + `RefreshSingle` | first-time Safes |
| 16 | `Repay` + `Withdraw` | repay flows |

  Every user action also emits a hub `UpdateAsset(assetId, drawnIndex, drawnRate, accruedFees)` plus one of `Add`, `Remove`, `Draw` or `Restore`, keyed by `(assetId, spoke)`. Hub events carry **no user**, so per-Safe state has to come from the spoke.
- **Topic hashes observed on chain.** These match what I computed from the `ISpoke` source:
  - Supply `0xd986db22…`
  - Withdraw `0xfe7813e2…`
  - Borrow `0xef181747…`
  - Repay `0xd765a026…`
  - SetUsingAsCollateral `0x4763df43…`
  - RefreshAllUserDynamicConfig `0x83731474…`
  - RefreshSingleUserDynamicConfig `0x5790b5f0…`
  - SetUserPositionManager `0x413bea99…`
  - Debt Manager `MigratedToLendGateway(address,uint256)` `0x4836b2e4…`

  They also match the event list in the repo's earlier memo, `.superpowers/sdd/research-aave-v4-whitelabel.md`.

### Migration mechanics and a sample transaction

The function is `DebtManagerCore.migrateToLendGateway` in [cash-v3](https://github.com/etherfi-protocol/cash-v3/blob/master/src/debt-manager/DebtManagerCore.sol) (about lines 679–780 on master). Only a holder of `ETHER_FI_WALLET_ROLE` can call it, and it runs once per Safe. The order is:
1. Clear the Debt Manager debt, emitting `Repaid(safe, DM, token, debtUsd)`.
2. `gateway.supply` for each collateral token, which moves the Safe's balances into Aave.
3. `gateway.borrow(safe, token, amt, DM)`.
4. Set the migrated latch and `CashModule.markUsesLendGateway`, then emit `MigratedToLendGateway(safe, debtUsd)` (debtUsd has 6 decimals).

**Sample transaction:** `0x533de0a4e11b032e90abc0875c197db676bbe80155af7e534021a8ddb23dbed4`
- Block 155,864,793; status 1; gas used 4,453,222; 69 logs.
- Sent by `0xb428…3730` to the Debt Manager, selector `0x56eee510`.
- Safe: `0x428167a972786b7f924af2f2ecf6680aa8b5243e`.
- Debt Manager `Repaid`: $562,582.298065.
- Supplied through the gateway: 48.29 USDC, 478.963 liquidETH, 962,134.98 liquidUSD, 14.79 EURC, 299,317.10 liquidRWA.
- Spoke `Borrow` on reserve 0: 561,903.43 drawn shares for 562,582.298065 USDC; the USDC then moves from the gateway to the Debt Manager.
- `MigratedToLendGateway(safe, 562582.298065)`.
- Today that Safe owes 100.09 USDC, with health factor 21,770, about $2.74M of collateral and 6 active collaterals.

Migration also emits a spoke `Borrow` that is a re-homing of old debt, not new borrowing. cash-v3's test `DebtManagerMigration.t.sol` warns against counting it as new borrowing, and Solvent should treat it the same way.

**Migration batches** (from `MigratedToLendGateway` in 10k-block windows):

| Window (blocks) | ≈ Date | Migrations | Of which with debt |
|---|---|---|---|
| 155,490,213–155,500,212 | Aug 12–13 | 2 | 0 |
| 155,750,000–155,759,999 | Aug 18 | **3,256** | 10 ($7,878) |
| 155,860,000–155,869,999 | Aug 21 | **2,954** | **362 ($8.48M)** |
| 156,300,000–156,309,999 | Sep 1 | 2 | 0 |
| 157,327,278–157,337,277 | Sep 24 | 441 | 0 |

The Aug 21 window matches the Debt Manager's drop from $18.5M to $7.9M. Legacy Safes are **still borrowing on the Debt Manager**: 17 `Borrowed` events in the last 2,000 blocks.

## 5. Size and event volume

**Book size.**
- Borrowed on V4: **$32.92M**, of which USDC $31.86M and WETH $1.06M.
- Supplied on V4: about **$301M**.
- Debt Manager residual: **$4.49M**.
- Whole Cash book: about **$37.4M**.

**Event volume.** Two 2,000-block samples, each about 67 minutes:

| Sample (UTC) | Spoke logs | Transactions | Distinct Safes | Borrows | Hub logs |
|---|---|---|---|---|---|
| 17:02–18:09 | 6,152 | 3,148 | 2,072 | 200 (107,481 USDC) | 6,528 |
| about 05:02–06:09 | 4,554 | 2,311 | 1,571 | 156 | – |

Scaled up, that is about 98k–133k spoke logs per day, about 141k hub logs per day, 50k–68k transactions per day, 3.4k–4.3k borrows per day and about 400–450 new V4 Safes per day. The Debt Manager is down to about 48 logs per 2,000 blocks.

**RPC limits that matter for indexing.**
- The owner's endpoint rejects `eth_getLogs` over more than 10,000 blocks (error -32614).
- A 10,000-block query over spoke + hub + Debt Manager + gateway fails with "backend response too large" (-32020).
- 2,000-block windows work. That matches Solvent's configured `window: 2000` in `config/contracts.json`.
- A full backfill from activation covers 2,412,084 blocks, about 1,206 calls per address group at 2,000-block windows.
- Archive `eth_call` works at historical blocks, which the reconcile harness needs.

## Unverified / assumptions

- **Number of borrowers: not derived.** V4 has no on-chain list of users, and counting would need a full log scan (see the backfill cost above). The Blockscout API at explorer.optimism.io was rate-limited. Only the lower-bound samples above are known.
- **Liquidations and deficits:** the `LiquidationCall` and `ReportDeficit` topics are computed from source only. None appeared in the sampled windows, and the total to date is unknown.
- **Per-day rates** are extrapolated from two roughly one-hour samples. There is time-of-day variation (a factor of about 1.35 between the two).
- **Etherscan source verification:** confirmed on Etherscan only for the spoke proxy. For the other contracts I am relying on the AIP package's claim.
- **Role holders:** that the Operator Safe is Nonce Capital, the Owner Safe is 2-of-6, and `0x9AF1…844D` is Hypernative (an EOA) all come from repo comments. I did not read the AccessManager roles on chain.
- **Timelock:** a 24-hour timelock with ProxyAdmins owned by it is **PR #13, still open** in etherfi-protocol/aave-v4 (created 2026-09-10). It is not deployed or verified.
- **Aave governance:** that the AIP cleared, and the $20M Optimism Foundation supply, come only from the optimism.io blog and the ARFC. On chain, the payloads were executed by the Owner Safe, not by Aave Governance V3.
- **Interest-rate curves:** I read only the current drawn rates. The IR strategy parameters were not read.
- **Cash product flows:** labelling the transaction shapes as card spends, auto-supply and so on is my reading of cash-v3 code, not decoded CashModule events.
- **"Summer Lend"** as the internal name is inferred from cash-v3 file names.

## Sources

- Governance: [ARFC thread](https://governance.aave.com/t/arfc-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25314), [TEMP CHECK thread](https://governance.aave.com/t/temp-check-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25267)
- Announcement: [optimism.io blog](https://optimism.io/blog/etherfi-upgrades-to-aave-v4-on-op-mainnet)
- [etherfi-protocol/aave-v4](https://github.com/etherfi-protocol/aave-v4): `deployments/optimism/10.json`, `scripts/etherfi/AIP_PACKAGE.md`, `src/etherfi/*`, [PR #13](https://github.com/etherfi-protocol/aave-v4/pull/13)
- [etherfi-protocol/cash-v3](https://github.com/etherfi-protocol/cash-v3): `src/modules/lend-gateway/LendGateway.sol`, `src/interfaces/ILendGateway.sol`, `src/debt-manager/DebtManagerCore.sol`, `test/safe/modules/cash/lend/DebtManagerMigration.t.sol`, `deployments/mainnet/10/{cash-lend,summer-lend,summer-lend-feeds}.json`
- [OP Etherscan: spoke page](https://optimistic.etherscan.io/address/0xdffcC3536D932eb51Df51a7F5FA407c4270d5308)
- In this repo: `config/contracts.json`, `.superpowers/sdd/research-aave-v4-whitelabel.md` (pre-launch memo from 2026-07-26; its event list matches what is on chain)