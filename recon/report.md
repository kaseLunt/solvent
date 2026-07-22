# Solvent — Day-0 Recon Report (GO/NO-GO gate)

Date: 2026-07-21. All on-chain values verified live with `cast` (foundry v1.7.1) against
`https://mainnet.optimism.io` (OP, chain 10) and `https://ethereum-rpc.publicnode.com` / `https://eth.drpc.org` (ETH, chain 1).

## Addresses (verified)

Every address below returned non-empty bytecode from `cast code` on the stated chain at recon time.

| Label | Chain | Address | Deploy block | Code-verified |
|---|---|---|---|---|
| DebtManager (UUPS proxy) — **stream address** | OP (10) | `0x0078C5a459132e279056B2371fE8A8eC973A9553` | 149,521,228 | yes |
| DebtManagerCore impl (EIP-1967 slot of proxy) | OP (10) | `0x0392347936b84fD2D9DE67f178f1D8e0BFc14A19` | — (informational) | yes |
| CashModule | OP (10) | `0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0` | — (not a stream) | yes |
| CashEventEmitter | OP (10) | `0x380B2e96799405be6e3D965f4044099891881acB` | — (not a stream) | yes |
| EtherFiSafeFactory | OP (10) | `0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF` | — (not a stream) | yes |
| CashLens | OP (10) | `0x7DA874f3BacA1A8F0af27E5ceE1b8C66A772F84E` | — (not a stream) | yes |
| EtherFiDataProvider | OP (10) | `0xDC515Cb479a64552c5A11a57109C314E40A1A778` | — (not a stream) | yes |
| Aave v3 EtherFi Pool (proxy) — **stream address** | ETH (1) | `0x0AA97c284e98396202b6A04024F5E2c65026F3c0` | 20,625,519 | yes |
| Aave v3 EtherFi Pool impl (EIP-1967 slot of proxy) | ETH (1) | `0x0F3bCeb6b3b2dfb7f0ac58fCbF6DaDd23cf34244` | — (informational) | yes |
| Aave v3 EtherFi PoolAddressesProvider | ETH (1) | `0xeBa440B438Ad808101d1c451C1C5322c90BEFCdA` | — (not a stream) | yes |
| Aave v3 EtherFi ProtocolDataProvider | ETH (1) | `0x7c8509591f9693D21280d96e149a08A3bf69Cd0c` | — (not a stream) | yes |
| Aave v3 EtherFi AaveOracle | ETH (1) | `0x43b64f28A678944E0655404B0B98E443851cC34F` | — (not a stream) | yes |

Address provenance and cross-checks:

- **cash-v3 (Debt Manager)**: `etherfi-protocol/cash-v3` repo, `deployments/mainnet/10/deployments.json`
  (repo exists under the expected org/name; shallow clone at `recon/cash-v3/`). Cross-checked against the
  upstream DefiLlama adapter `projects/etherfi-cash-collateral-management/index.js`, whose `optimism.cashDebitCore`
  is the identical `0x0078C5…9553` (and whose hallmark records "2026-04-08: Operation is migrated to OP Mainnet").
  DefiLlama protocol `etherfi-borrowing-market` reports Optimism TVL ≈ $155.2M with ≈ $21.76M borrowed (Scroll ≈ $36k residual).
- **Aave EtherFi Market**: bgd-labs/aave-address-book `src/AaveV3EthereumEtherFi.sol`. The instance lives on
  **Ethereum mainnet (chain 1)**, not OP. `getPool()` on the AddressesProvider returns exactly the Pool proxy above.
- **Deploy blocks**: OP DebtManager found by binary search over `cast code --block` (first block with code = 149,521,228)
  and independently confirmed by Blockscout creation tx `0x3319dcb07451240aef982de52b3588db6f456556a828e23f34a51c3e73149a9d`
  (receipt block 149,521,228). ETH Pool from Blockscout creation tx
  `0x70b37ae07c211665de9a02efc929e90eb6f087a8b74928836eec67726afb624a` (receipt block 20,625,519); binary search on ETH
  was not usable because the public node is non-archival for historical `eth_getCode`.

## Event coverage

### Engine `debt_manager` (OP, proxy `0x0078C5…9553`)

ABI built from cash-v3 source with `forge build` (solc 0.8.28, "Compiler run successful") after shallow-initializing the
OZ/solady/forge-std submodules; artifacts copied to `recon/abis/DebtManagerCore.json` and `recon/abis/DebtManagerAdmin.json`.
The proxy delegates unknown selectors to an admin implementation (fallback `delegatecall` in `DebtManagerCore.sol:747`),
so admin events also emit from the proxy address.

Full event set (canonical signature → topic0), all emitted from the proxy address:

| Event | topic0 |
|---|---|
| `Borrowed(address,address,uint256)` | `0x3fc499aeb0bb1cb58b6de8b02b3f86f4e7394e9690bef0110e32ced8a5631045` |
| `Repaid(address,address,address,uint256)` | `0x861660e9b7ead7183d53fe928b5638c7b57a7bcf16a89d7fdb04db65ce3ad6d5` |
| `Supplied(address,address,address,uint256)` | `0x50413727b37795d672f09d0997645a955fa227befaefdd4adb611542dea3fd80` |
| `Liquidated(address,address,address,(address,uint256,uint256)[],uint256,uint256)` | `0xfd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c` |
| `InterestIndexUpdated(address,uint256,uint256)` | `0xc6ecd996cf998cfeedb2b1379b047e8579d888439dacbc60641c6dfd07f1f802` |
| `UserInterestAdded(address,uint256,uint256)` | `0x0888589249a19f760c73a4c12cef4d35bba86ecf227a50bccf8387efa0bf721e` |
| `TotalBorrowingUpdated(address,uint256,uint256)` | `0x129c6de5e40c1dd150d47fb9ae711d9c22b118affbbaa6c3851334318b804d72` |
| `WithdrawBorrowToken(address,address,uint256)` | `0x2930a7b877d817b672bfa2846d236a1da511a35f283e7a75c55d4124216841e6` |
| `BorrowApySet(address,uint256,uint256)` | `0x0a79a2c3945fa1460b7ce0aa563cc1cd6424a51a3f0d888754e797ebb54baf66` |
| `BorrowTokenAdded(address)` | `0xb7c3f684da24b5ce3721043b9671e1a95e871a22a3cf23861c550833ceb52f8c` |
| `BorrowTokenRemoved(address)` | `0x4b8ac63c38f57c8602118d0c39a3bb0a9607e924c7bf802d8f6be9a850f81db5` |
| `BorrowTokenConfigSet(address,(uint256,uint256,uint256,uint64,uint64,uint128))` | `0x1ad7ec344404069a779d110ce8e12ead2a2d263f4ea2728ac643e52913ac3904` |
| `CollateralTokenAdded(address)` | `0xd61bc477a25fa080e2c32ed9e4417ba4861d11b873216136586ddedadcff2f02` |
| `CollateralTokenRemoved(address)` | `0x066186f1dd144b0baa72e90264076813d8f2dfce7c39704ea68d159cee4305b7` |
| `CollateralTokenConfigSet(address,(uint80,uint80,uint96),(uint80,uint80,uint96))` | `0x011128805ea0277047e3f7163c2d734358e71e614d3c0487497ef1813a2ea110` |
| `LiquidationThresholdUpdated(uint256,uint256)` | `0xcdadd717dc9ee3550a289071d1af75e229726888d51e3a31c9e3dfc693d4852b` |
| `MinSharesOfBorrowTokenSet(address,uint128,uint128)` | `0x78da2ff1f01b52fe1edeea7326ccef6bc345f0807196b4723b841dd62a30958a` |
| `Paused(address)` | `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258` |
| `Unpaused(address)` | `0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa` |
| `Upgraded(address)` | `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b` |
| `Initialized(uint64)` | `0xc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d2` |

The names differ slightly from the brief's guesses ("CollateralAdded" → actual `Supplied` / `CollateralTokenAdded`),
but the borrow lifecycle is fully covered: supply, borrow, repay, liquidation, interest accrual, config changes.

**Observed volume (live)**: 6,414 logs from the DebtManager proxy in the trailing ~24h (43,200 OP blocks up to head
154,542,764, counted in five 8,640-block chunks). One 8,640-block sample chunk (~4.8h) decomposed as:
803 × `InterestIndexUpdated`, 787 × `Borrowed`, 52 × `Repaid`. Topic0 values observed on-chain match the table above
exactly (the table was cross-validated against live logs, not just source hashing).

### Engine `aave_v3_etherfi` (ETH, Pool proxy `0x0AA97c…F3c0`)

ABI: verified source ABI of the current Pool implementation (`0x0F3bCeb6…4244`, read from the proxy's EIP-1967 slot,
identical to the bgd-labs address-book `POOL_IMPL`), fetched from Blockscout (`eth.blockscout.com`, module=contract,
action=getabi) and saved to `recon/abis/AaveV3Pool.json` as `{ "abi": [...] }`. It is an Aave v3.5-line ABI
(includes `DeficitCovered`/`PositionManager*` in addition to the classic v3 set).

Key events for position reconstruction (canonical signature → topic0):

| Event | topic0 |
|---|---|
| `Borrow(address,address,address,uint256,uint8,uint256,uint16)` | `0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0` |
| `Repay(address,address,address,uint256,bool)` | `0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051` |
| `Supply(address,address,address,uint256,uint16)` | `0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61` |
| `Withdraw(address,address,address,uint256)` | `0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7` |
| `LiquidationCall(address,address,address,uint256,uint256,address,bool)` | `0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286` |
| `ReserveDataUpdated(address,uint256,uint256,uint256,uint256,uint256)` | `0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a` |
| `ReserveUsedAsCollateralEnabled(address,address)` | `0x00058a56ea94653cdf4f152d227ace22d4c00ad99e2a43f58cb7d9e3feb295f2` |
| `ReserveUsedAsCollateralDisabled(address,address)` | `0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd` |
| `UserEModeSet(address,uint8)` | `0xd728da875fc88944cbf17638bcbe4af0eedaef63becd1d1c57cc097eb4608d84` |

Reserve list (`getReservesList()`): 4 assets — weETH (`0xCd5fE23C…b7ee`), USDC (`0xA0b86991…eB48`),
PYUSD (`0x6c3ea903…A0e8`), FRAX (`0x853d955a…b99e`). (Brief expected ≥ 5; the instance launched with 4.)

**Observed volume (live)**: the instance is **dormant** — zero logs of any kind in the trailing 30 days
(Blockscout, blocks 25,369,000 → head 25,584,990). 138 `Borrow` events lifetime; the last at block 22,123,279 (≈ April 2025).
Residual open positions remain (USDC totalDebt = 2,570.21, FRAX totalDebt = 255.13, PYUSD dust), so state
reconstruction from genesis (block 20,625,519) is fully possible and cheap (low event count).

## Aave V4 status

**Not deployed.** The dedicated Aave V4 whitelabel instance for ether.fi Cash on OP Mainnet is still in governance:
TEMP CHECK posted 2026-07-03, snapshot passed, **ARFC posted 2026-07-14** (governance.aave.com thread
"[ARFC] Deploy a Dedicated Aave V4 Whitelabel Instance fully managed by EtherFi on OP Mainnet to Power Ether.fi Cash"),
targeting deployment "within July 2026" ($175M initial cap, 20% reserve-factor revenue share, dedicated GHO GSM).
No AIP executed and no contract addresses exist yet. Aave V4 core is live on Ethereum (DefiLlama "Aave V4",
TVL ≈ $183M) but that is not the ether.fi instance. → Observatory launches with the Debt Manager as the hot engine and
"V4 cutover pending" (spec §6 degradation mode, already designed for). Re-check the governance thread for the AIP/payload
when Plan 2 starts.

**Subgraph**: ether.fi's public Graph subgraph `etherfi-v2-main`
(`https://api.studio.thegraph.com/query/58515/etherfi-v2-main/version/latest`) indexes staking-layer entities only
(validators, bids, node operators) — no Cash/lending entities. Confirmed; ignore it for Solvent.

## Golden-vector sample

Borrower discovered from historical `Borrow` logs on the Aave v3 EtherFi Pool and verified live:

- Borrower: `0x70daaac436465a0d03e45916fa68ddee6086e5fe`
- Call: `getUserAccountData(address)` on Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0` at **block 25,584,990** (ETH):
  - `totalCollateralBase` = `12410926` (USD, 8 decimals ⇒ $0.1241)
  - `totalDebtBase` = `13715992` (⇒ $0.1372)
  - `availableBorrowsBase` = `0`
  - `currentLiquidationThreshold` = `8100`, `ltv` = `7800`
  - `healthFactor` = `732929128275956999` (0.7329 — a live, liquidatable dust position; ideal risk-engine test vector)
- Second sample (healthy): `0xe649a394fb16b58ee2e59feb2ea571e7733c812a` — collateral `1496766`, debt `8400`, HF ≈ 144.3.

This proves borrow positions on the Aave engine are reconstructible from logs and checkable against on-chain view calls.
For the Debt Manager engine, live `Borrowed`/`Repaid` events (787/52 in a 4.8h window) plus the DebtManager's view
methods (`borrowingOf`, `collateralOf`, `getCollateralValueInUsd` per ABI) provide the same reconstruction path;
golden vectors for it should be pinned in Plan 2 once the decoder exists.

## Deviations from brief

1. **Scope relocation (user directive mid-task)**: all artifacts live under `Solvent\recon\` instead of repo-root
   `recon\`, and the brief's Step 10 (git add/commit + .gitignore edit in the outer repo) was **skipped entirely** —
   the controller handles git in a Solvent-local repository. The clones remain at `Solvent\recon\cash-v3\` and
   `Solvent\recon\DefiLlama-Adapters\` and must stay out of version control.
2. **Aave EtherFi instance is on Ethereum mainnet, not OP.** The brief's schema template showed the stream as
   `op:aave-etherfi` on chain `op`; on-chain truth is chain 1, so the stream is `eth:aave-etherfi` with
   `chain: "eth"` (the schema already declared the `eth` chain entry).
3. `getReservesList()` returned **4** assets, not the expected ≥ 5.
4. No `Borrow` events in the last 50,000 ETH blocks; the golden borrower was found from lifetime logs via Blockscout
   (last Borrow ≈ April 2025) and verified to still hold live debt.
5. `forge build` was run scoped to the debt-manager sources (with shallow-initialized OZ/solady/forge-std submodules)
   instead of a full-repo build — the LayerZero submodules are heavy and irrelevant to the DebtManager ABI. Build result:
   "Compiler run successful" (37 files, solc 0.8.28).
6. The DefiLlama borrowing-market adapter is not in the cloned `etherfi-protocol/DefiLlama-Adapters` fork; it was
   fetched from upstream `DefiLlama/DefiLlama-Adapters` (`projects/etherfi-cash-collateral-management/index.js`).
7. `jq` unavailable → Python used. `eth.llamarpc.com` Cloudflare-blocked → `ethereum-rpc.publicnode.com` and
   `eth.drpc.org` used instead.
8. QA note: an initial topic0 table was corrupted by Windows CRLF line endings feeding `cast keccak`; it was caught by
   comparing against live on-chain topics, recomputed clean, and re-validated against both live logs and the well-known
   canonical Aave/OZ topic0 values. The tables above are the validated set.

## For Plan 2

Exact event signatures the indexer decodes, per engine (topic0 included above; repeated here as the decode allowlist):

- **`debt_manager`** stream `op:debt-manager`, address `0x0078C5a459132e279056B2371fE8A8eC973A9553`, from block 149,521,228:
  - Position lifecycle (hot path): `Borrowed(address,address,uint256)`, `Repaid(address,address,address,uint256)`,
    `Supplied(address,address,address,uint256)`,
    `Liquidated(address,address,address,(address,uint256,uint256)[],uint256,uint256)`,
    `WithdrawBorrowToken(address,address,uint256)`
  - Interest/accounting: `InterestIndexUpdated(address,uint256,uint256)`, `UserInterestAdded(address,uint256,uint256)`,
    `TotalBorrowingUpdated(address,uint256,uint256)`
  - Config/risk-parameter changes: `BorrowApySet(address,uint256,uint256)`, `BorrowTokenAdded(address)`,
    `BorrowTokenRemoved(address)`, `BorrowTokenConfigSet(address,(uint256,uint256,uint256,uint64,uint64,uint128))`,
    `CollateralTokenAdded(address)`, `CollateralTokenRemoved(address)`,
    `CollateralTokenConfigSet(address,(uint80,uint80,uint96),(uint80,uint80,uint96))`,
    `LiquidationThresholdUpdated(uint256,uint256)`, `MinSharesOfBorrowTokenSet(address,uint128,uint128)`
  - Ops: `Paused(address)`, `Unpaused(address)`, `Upgraded(address)` (impl change ⇒ re-pull ABI), `Initialized(uint64)`
  - ABIs: `recon/abis/DebtManagerCore.json`, `recon/abis/DebtManagerAdmin.json` (forge artifacts from cash-v3 source).
- **`aave_v3_etherfi`** stream `eth:aave-etherfi`, address `0x0AA97c284e98396202b6A04024F5E2c65026F3c0`, from block 20,625,519:
  - `Borrow(address,address,address,uint256,uint8,uint256,uint16)`, `Repay(address,address,address,uint256,bool)`,
    `Supply(address,address,address,uint256,uint16)`, `Withdraw(address,address,address,uint256)`,
    `LiquidationCall(address,address,address,uint256,uint256,address,bool)`,
    `ReserveDataUpdated(address,uint256,uint256,uint256,uint256,uint256)`,
    `ReserveUsedAsCollateralEnabled(address,address)`, `ReserveUsedAsCollateralDisabled(address,address)`,
    `UserEModeSet(address,uint8)`
  - ABI: `recon/abis/AaveV3Pool.json` (verified impl ABI via Blockscout; impl `0x0F3bCeb6…4244`).
- When the Aave V4 EtherFi whitelabel instance ships on OP, add its stream from the AIP payload addresses; until then
  the `eth:aave-etherfi` stream is a cold/backfill stream (zero recent volume) and `op:debt-manager` is the hot stream.

## Decision

**GO** — both engines verified and reconstructible.

Reasoning:

- The **Debt Manager engine** is fully proven: verified addresses on OP (chain 10), complete borrow-lifecycle event set
  built from source, and heavy live emission (6,414 logs/day; 787 borrows in a single 4.8h sample). It carries the real
  product risk today (~$155M collateral TVL, ~$21.8M borrowed).
- The **Aave engine** is proven reconstructible: verified Pool/Provider addresses on ETH (chain 1), a real borrower whose
  `getUserAccountData` returns nonzero collateral/debt/HF (including a live HF < 1 position — an immediately useful risk
  vector), and a small enough lifetime event count that full-genesis backfill is trivial. It is, however, **dormant**
  (no events in 30 days) — the market's activity migrated to the Debt Manager on OP in April 2026.
- The nuance vs. the plan's Fallback-GO branch is inverted: the plan worried the Debt Manager might not hold up and
  Aave would be the fallback; in reality the Debt Manager is the hot engine and Aave v3 is the cold/legacy one, with the
  Aave **V4** OP instance arriving via governance (ARFC 2026-07-14) as the designed cutover target. Both streams stay in
  `contracts.json`: the schema, both engines, and the cutover-pending degradation mode all hold as specified.
