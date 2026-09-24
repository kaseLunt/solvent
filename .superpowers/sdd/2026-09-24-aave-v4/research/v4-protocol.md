# Aave V4 technical brief: exact-integer risk engine and reconcile for ether.fi Cash (OP Mainnet)

**Bottom line:**
- The instance runs stock Aave V4 core, and I read the exact deployed source.
- I rebuilt its health-factor code in Python using only integer math. It matched `getUserAccountData` on all 7 fields for 3 live borrowers.
- I also replayed 4 real liquidations. Every event amount matched.
- The deployed contracts use 5 settings a v3 port would get wrong:
  - one factor (CF) for both borrowing and liquidation;
  - supply shares with a 1e6 virtual offset;
  - linear interest between accruals;
  - debt kept at RAY precision inside the health factor;
  - per-user config keys that ether.fi's curator edits in place.
- The per-user risk premium is disabled on this instance: every collateral risk is 0 and every spoke's risk-premium threshold is 0.

## 0. Key facts (all checked on chain unless marked)

| Item | Value |
|---|---|
| Canonical source | `github.com/aave/aave-v4` (BUSL). The ether.fi fork `github.com/etherfi-protocol/aave-v4` @ `63a5a039` was cut from `aave/aave-v4` @ `2524fe40`. Hub, spoke and math code are byte-identical to tag **v0.5.11** (2026-03-20); `git diff v0.5.11..2524fe40 -- src/hub src/spoke src/libraries/math` is empty. |
| Only ether.fi core change | `Spoke.sol:278`: `borrow` changed from `external` to `public virtual`. Plus `src/etherfi/EtherFiSpokeInstance.sol:59-69`, which gates `borrow` so `onBehalfOf` must pass `EtherFiDataProvider(0xDC51…A778).isEtherFiSafe`. |
| Deployed source identity | Blockscout-verified sources of Spoke impl `0xA1f7…3b68` (60 files), HubInstance `0x697a…2cE9` (31), LiquidationLogic `0x88dF…B8DB` (26), AaveOracle `0xe8cb…6fA8` (11) and IR strategy `0x51d0…Cd7C` (4). **All 132 files are byte-identical** to the fork repo. solc 0.8.28, cancun. |
| Hub (proxy) | `0x66753c4e3fC84f1eD0e3C267C927284E9d90C572`. EIP-1967 impl `0x697af342…`, ProxyAdmin `0xed57ae70…`. The ProxyAdmin owner is **EtherFiTimelock** `0xbaca0cd6…e283`. |
| Cash Spoke (proxy) | `0xdffcC3536D932eb51Df51a7F5FA407c4270d5308`. Impl `0xa1f75d80…`, ProxyAdmin `0xac44bde2…`, owner EtherFiTimelock. Deployed at block **154,915,790** (2026-07-30 16:52 UTC). |
| Spoke immutables | `ORACLE` `0xe8cbd372…`, `MAX_USER_RESERVES_LIMIT` = 64, `SPOKE_REVISION` = 1 |
| Liquidation config | target HF **1.24e18**, `healthFactorForMaxBonus` **0.90e18**, `liquidationBonusFactor` **9000** (90%, set 2026-08-03, block 155,097,775) |
| Reserves / hub assets | **23 / 23**; reserveId == assetId for all 23. Each asset has 2 spokes on the hub: Cash + TreasurySpoke `0x7EB4…0768` (the fee receiver). |
| Collateral risk (CR), hub `riskPremiumThreshold` | **0 for all 23 reserves; 0 on every (asset, Cash spoke)**. Premium is therefore impossible; see 3.6. |
| Position manager | **LendGateway** `0x01F8cDFb1694eA8fE4ED6c38a0fD78d1188E03F4` (UUPS, impl `0x451d…D3C3`), activated 2026-08-04 (block 155,129,845). 100/100 sampled `Borrow` events have `caller` = LendGateway. ≥500 Safes have approved it. The fork's `deployments/README.md` line "no position managers are deployed" is **stale**. |
| Cash book on V4 (block 157,337,765, 2026-09-24 18:25 UTC) | USDC drawn 31,874,550.158613 (≈ $31.87M); WETH drawn 398.0604 (≈ $1.07M). **Total debt ≈ $32.94M**, supplied value ≈ $301.9M, premium 0, deficit 0. Drawn rates: USDC 4.0618%, WETH 1.4507%. Liquidity fee 30% on USDC/WETH/EURC. By comparison the Debt Manager was at $4.49M (block 157,336,816). |
| Liquidations so far | 10 `LiquidationCall` events, all with debt = WETH (reserve 1). 0 `ReportDeficit`, 0 `UpdateUserRiskPremium`, 0 `RefreshPremiumDebt`. |

---

## 1. Architecture

**Hub** (`src/hub/Hub.sol`). Holds per-asset accounting (`IHub.Asset`, `IHub.sol:29-56`) and per-(asset, spoke) aggregates (`SpokeData`, `:77-91`).
- **It knows nothing about users.**
- Spokes call `add`, `remove`, `draw`, `restore`, `refreshPremium`, `reportDeficit` and `payFeeShares` (`Hub.sol:200-389`).
- Caps are in whole tokens (`_validateAdd` `:814-829`, `_validateDraw` `:840-858`).
- `active` / `halted` flags gate each spoke.
- Interest-rate strategy (`AssetInterestRateStrategy.sol:102-137`): utilization = `rayDivUp(drawn, liquidity+drawn+swept)`; premium and deficit are excluded.

**Spoke** (`src/spoke/Spoke.sol`). Holds all user state. Storage is in `SpokeStorage.sol:12-33`:
- `_userPositions[user][reserveId]` → `UserPosition{uint120 drawnShares; uint120 premiumShares; int200 premiumOffsetRay; uint120 suppliedShares; uint32 dynamicConfigKey}` (`ISpoke.sol:95-103`).
- `_positionStatus[user]` → a bitmap with 2 bits per reserve (bit `2r` = borrowing, bit `2r+1` = collateral), plus `uint24 riskPremium` (`ISpoke.sol:116-119`, `PositionStatusMap.sol:16-51`).
- Positions live per (spoke, user, reserveId). The health factor is per spoke, so there is no cross-spoke netting.
- `reserveId` is spoke-local. `assetId` is hub-local. Resolve a token as `hub.getAssetId(underlying)` → `spoke.getReserveId(hub, assetId)` (`Spoke.sol:529-533`).
- There are no aTokens or debt tokens and no Transfer events for positions.

**Supply does not auto-enable collateral.** In `supply` (`Spoke.sol:225-241`) only `setUsingAsCollateral` (`:391-412`) sets the bit. LendGateway.supply does supply plus enable atomically; public LPs may leave it off.

**Position managers.** `onlyPositionManager(onBehalfOf)` passes if `msg.sender == onBehalfOf`, or if the manager is governance-active and user-approved (`Spoke.sol:90-93, 909-913`). The approval events are `UpdatePositionManager` (governance) and `SetUserPositionManager` (user).

**How a Cash Safe borrows (verified path):**
1. CashModule (a "driver") calls `LendGateway.borrow(safe, asset, amount, to)` (LendGateway.sol:385-395).
2. `ensuresApproval` makes the Safe itself call `spoke.setUserPositionManager(gateway, true)` through `execTransactionFromModule` (:299-311).
3. The gateway calls `spoke.borrow(reserveId, amount, onBehalfOf=safe)`.
4. `EtherFiSpokeInstance` checks `isEtherFiSafe(safe)`, then `Spoke.borrow` → `hub.draw(…, to=msg.sender=gateway)`.
5. The gateway forwards the funds to `to`.

The debt sits on the **Safe (`user`, topic3)**. `caller` (topic2) is always the gateway. **Key positions on `user`, never on `caller` or `tx.from`.**

The gateway enforces `minHealthFactor` = **1.10e18** (read on chain) on extraction operations only: borrow page, withdraw, and collateral-off (:236-250, :491-495). **Card spends and repays are explicitly exempt**, so a position can be pushed down to HF 1.0.

---

## 2. Units and exact integer formulas (health factor)

Constants: `RAY=1e27`, `WAD=1e18`, `BPS=1e4`, `YEAR=365 days=31,536,000` (`MathUtils.sol:13`), `VIRTUAL_ASSETS = VIRTUAL_SHARES = 1e6` (`SharesMath.sol:13-14`). `/` is floor, `ceil(a/b)` = `(a+b-1)/b`.

### 2.1 Drawn index (per hub asset; interest is linear between accruals)
Source: `AssetLogic.getDrawnIndex` (`AssetLogic.sol:153-165`) and `MathUtils.calculateLinearInterest` (`MathUtils.sol:20-31`).
```
idx(t) = A.drawnIndex                                   if A.lastUpdateTimestamp == t || (A.drawnShares==0 && A.premiumShares==0)
       = ceil(A.drawnIndex * (RAY + A.drawnRate*(t - A.lastUpdateTimestamp)/YEAR) / RAY)      # rayMulUp; inner term floored
```
- `t` is the evaluated block's `block.timestamp`.
- `accrue()` (`:141-150`) stores the index and `lastUpdateTimestamp`, and rolls unrealized fees into `realizedFees`.
- **Every hub mutation emits `UpdateAsset(assetId, drawnIndex, drawnRate, accruedFees)` with the post-accrual stored values** (`updateDrawnRate`, `:132-138`).
- **Verified:** the event at block 157,338,190 equals `getAsset(0)` at that block, including `lastUpdateTimestamp == block.timestamp`.
- **Use the stored `drawnRate`** (from `getAsset` or `UpdateAsset`), not `getAssetDrawnRate()`. That getter recomputes the rate from current state.

### 2.2 Supply shares → assets (the collateral side)
Source: `AssetLogic.totalAddedAssets` (`:79-96`), `getUnrealizedFees` (`:187-226`), `Premium.calculatePremiumRay` (`Premium.sol:17-23`), `SharesMath.toAssetsDown` (`:31-42`).
```
premRay(ps, off, i) = ps*i - off                        # signed int, must be >= 0
aggOwedRay(i)       = A.drawnShares*i + premRay(A.premiumShares, A.premiumOffsetRay, i) + A.deficitRay
unrealFees(i)       = 0 if i == A.drawnIndex or A.liquidityFee == 0
                    = floor( (ceil(aggOwedRay(i)/RAY) - ceil(aggOwedRay(A.drawnIndex)/RAY)) * A.liquidityFee / BPS )
TA = A.liquidity + A.swept + ceil(aggOwedRay(idx)/RAY) - A.realizedFees - unrealFees(idx)
suppliedAssets(sh) = floor( sh * (TA + 1e6) / (A.addedShares + 1e6) )      # = hub.previewRemoveByShares
```
- The share price is **hub-wide**. It includes every spoke's activity, including TreasurySpoke fee shares.
- It moves with time through `idx`, with no event.
- Collateral-only assets (0% rate, no borrows) stay exactly 1:1 (e.g. ETHFI shares == assets on chain).

### 2.3 Debt
Source: `UserPositionUtils.sol:127-133, 136-164`.
```
debtRay_r = drawnShares*idx + premRay(premiumShares, premiumOffsetRay, idx)     # asset units × RAY, NOT rounded
getUserDebt = (ceil(drawnShares*idx/RAY), ceil(premRay/RAY))                    # display getter, rounded UP
```
- Repay pays premium first, then drawn (`calculateRestoreAmount`, `:89-106`).
- Burned drawn shares = `rayDivDown(drawnDebtRestored, idx)` (`Spoke.sol:317`).
- Borrow mints `rayDivUp(amount, idx)` shares (`Hub.sol:259`).

### 2.4 Value and account aggregation
Source: `Spoke._processUserAccountData`, `Spoke.sol:706-813`; `SpokeUtils.toValue`, `SpokeUtils.sol:34-40`.
```
value(amount, dec, P) = amount * P * 10^(18-dec)          # P = oracle price, 8 decimals; $1 = 1e26 "Value"
for r with collateral bit:                                # iteration: highest reserveId first (PositionStatusMap.next :125-144)
   cf = dynamicConfig[r][userPos.dynamicConfigKey].collateralFactor     # USER's snapshot key
   if cf > 0 && suppliedShares > 0:
       V = value(suppliedAssets(suppliedShares), dec, P);  TC += V;  W += cf*V;  activeCollateralCount++;  list.add(CR_r, V)
for r with borrowing bit:
   DR += value(debtRay_r, dec, P);  borrowCount++                          # totalDebtValueRay (Value × RAY)
HF    = DR > 0 ? floor( W * 1e14 * RAY / DR ) : 2^256-1    # Math.mulDiv(bpsToWad(W), RAY, DR, Floor)  :769-781
avgCF = TC > 0 ? floor( W * 1e14 / TC ) : 0                # :783-786 (disclosure only; not an HF input)
```
**Rounding summary:**
- collateral: asset amount floored once (share conversion);
- debt: full RAY precision, never rounded;
- HF: single floor;
- no half-up step anywhere.

A price ≤ 0 or an unset source reverts (`AaveOracle.sol:80-88`). The whole view reverts, and so does liquidation. Treat that as "not measurable".

### 2.5 When the health factor is enforced
`_refreshAndValidateUserAccountData` requires `HF >= 1e18` (`Spoke.sol:686-696`). It runs on:
- `borrow`;
- `withdraw` of a collateral-flagged reserve;
- `setUsingAsCollateral(false)`;
- `updateUserDynamicConfig`.

`supply`, `repay` and `setUsingAsCollateral(true)` never check. **There is no separate LTV: borrowing is allowed right up to HF = 1.0.**

### 2.6 Risk premium (dormant on this instance, but implement it)
- **Algorithm** (`Spoke.sol:788-810`, `KeyValueList.sol:9-10, 63-71`):
  - sort (CR asc, V desc);
  - `D = ceil(DR/RAY)`;
  - greedily cover `D` with `min(V_i, left)`;
  - `RP = ceil(Σ covered_i·CR_i / Σ covered_i)` in BPS (CR ≤ 1000_00).
- **Premium accounting** (`UserPositionUtils.calculatePremiumDelta`, `:54-81`):
  - `newPremiumShares = ceil((drawnShares - taken)*RP/1e4)`;
  - `newOffsetRay = newPremiumShares*idx - (premRay - restoredPremiumRay)`;
  - deltas = new − old.
- The hub checks that premium is conserved exactly (`Hub.sol:933-959`) and requires `spoke.premiumShares <= percentMulUp(spoke.drawnShares, riskPremiumThreshold)` unless the threshold is `type(uint24).max` (`:757-762`).
- **With threshold 0 (live), any nonzero premium reverts**, so premium is structurally 0 today.
- RP refreshes (`_notifyRiskPremiumUpdate`, `:822-849`) on: borrow, collateral withdraw, collateral-off, non-deficit liquidation, `updateUserRiskPremium`, `updateUserDynamicConfig`. They are skipped when old and new RP are both 0, and then no events fire.

### 2.7 Dynamic config keys (the snapshot trap)
- CF, maxLB and liquidation fee live in `_dynamicConfig[reserveId][key]` (`ISpoke.sol:73-77`).
- The reserve holds the latest key. Each `UserPosition.dynamicConfigKey` holds a snapshot.
- The snapshot is rebound to latest:
  - for **all collateral-flagged reserves** (not borrow-only) on borrow, collateral withdraw, collateral-off and `updateUserDynamicConfig`. `RefreshAllUserDynamicConfig(user)` is emitted with **no key values** (`Spoke.sol:729-733, 690`);
  - for one reserve on collateral-on (`RefreshSingleUserDynamicConfig`, `:815-818`).
- `addDynamicReserveConfig` appends a new key (`:191-204`). `updateDynamicReserveConfig` **mutates an existing key in place, instantly re-parameterizing every user bound to it** (`:207-216`). It forbids CF = 0 (`:852-860`).
- Validation (`:921-930`): `CF < 1e4`, `maxLB >= 1e4`, `percentMulUp(maxLB, CF) < 1e4`, `fee <= 1e4`.
- **Live behavior:** ether.fi's curator uses in-place updates on key 0.
  - 30 `UpdateDynamicReserveConfig` events: 2026-08-09 (15 reserves), 08-12 (3), 08-15 (8).
  - Launch USDC was CF 9500 / LB 10100. Now it is 9000 / 10500 on the same key 0.
  - The one append is eUSD (reserve 7) key 1 with CF 0 (2026-08-12). Users still on key 0 would keep CF 9000; eUSD supply is currently 0.
- **So an engine must version (reserve, key) → config by log position and resolve each user's key.**

### 2.8 Oracle
- Per-spoke `AaveOracle`, keyed by reserveId. Reads `IPriceFeed.latestAnswer()`, 8 decimals. There is **no staleness or sequencer check** (`AaveOracle.sol:80-88`).
- Live sources are BGD CAPO-style adapters (e.g. "Capped weETH / ETH / USD" exposes `getSnapshotRatio`, `getMaxRatioGrowthPerSecond`, `RATIO_PROVIDER`) plus plain feeds (ETH, OP, HYPE, PAXG, iwSPYx, iwQQQx, iwTBLLx / USD).
- Sources were swapped 6 times via `UpdateReserveSource` (07-30, 08-03, 08-04, 08-08/11/12, 08-13, 08-25). **Prices are not evented; read `getReservesPrices([0..22])` at the batch block.**

---

## 3. Liquidation (LiquidationLogic `0x88dF535473C5adf1f57789734A05E555F7Deb8DB`, external library)

- **Condition** (`LiquidationLogic.sol:533-559`):
  - `HF < 1e18` (strict), using the **user's snapshot keys** (`Spoke.sol:354`, `refreshConfig=false`);
  - `user != liquidator`; `debtToCover > 0`;
  - neither the collateral nor the debt reserve is paused (other paused reserves don't block; frozen is allowed);
  - the collateral reserve is flagged with snapshot CF > 0 and suppliedShares > 0; `drawnShares > 0` on the debt reserve;
  - `receiveShares` requires not-frozen and `receiveSharesEnabled`.
  - The same reserve may be both debt and collateral (seen live: reserve 1 against reserve 1).
- **Bonus** (`:312-333`):
  - `LB = maxLB` if `HF <= hfMax`;
  - otherwise `minLB + floor((maxLB-minLB)*(1e18-HF)/(1e18-hfMax))`, with `minLB = floor((maxLB-1e4)*lbFactor/1e4)+1e4`.
  - Live WETH (maxLB 11000): min 10900, max at HF ≤ 0.90.
- **Debt to target HF** (`:795-813`):
  - `pen = ceil(LB*1e14*CF/1e4)` (exact);
  - `debtRayToTarget = ceil(DR * 10^dDec * (THF-HF) / ((THF-pen) * P_d * 1e18))`, using the seized collateral's CF.
- **Debt split and dust** (`:735-791`):
  - premium first: `premL = min(roundRayUp(target), premRay)`, capped by debtToCover;
  - then `drawnL = min(ceil((target-premL)/idx), floor((debtToCover-ceil(premL/RAY))*RAY/idx), drawnShares)`;
  - if the remaining debt in this reserve is worth less than **$1,000 (`1000e26`, strict `<`)**, liquidate all of it.
- **Collateral** (`:563-729`):
  - `collAssets = floor(debtRayL * P_d * 10^cDec * LB / (10^dDec * P_c * 1e4 * RAY))` → shares via `previewAddByAssets` (floor);
  - if that is ≥ the user's shares, or the remainder is < $1,000 and debt is not fully liquidated: seize **all** of the reserve's shares, then recompute the debt as `ceil(previewAddByShares(all) * P_c*10^dDec*1e4*RAY / (P_d*10^cDec*LB))` (can exceed the target);
  - then `require(debtToCover >= ceil(drawnL*idx/RAY) + ceil(premL/RAY))`, else `MustNotLeaveDust`.
- **Fee split** (`:690-694`): `toLiquidator = cL - ceil(cL*fee*(LB-1e4)/(LB*1e4))`. Fee shares go to the treasury via `hub.payFeeShares` (a hub `TransferShares` event). `receiveShares` credits the liquidator's position with **no `Supply` event** (`:464-477`).
- **Deficit** (`:816-826, 260-303`): if the seized reserve empties, `activeCollateralCount <= 1`, and (debt remains or `borrowCount > 1`), then all debt reserves are written off:
  - spoke `ReportDeficit` for each, then `UpdateUserRiskPremium(user, 0)`;
  - hub `deficitRay` increases. This removes debt with no repay.
- **No 50% close factor.** Old CF applies until the user refreshes.

---

## 4. Events an indexer must read

All topic0 values were computed from source and matched against live logs (Blockscout topic-filtered queries, decoded names identical).

**Spoke `0xdffc…5308`.** Index `user` = topic3; `caller` = topic2 (the gateway).

| Event (signature) | topic0 | State effect |
|---|---|---|
| `Supply(uint256 indexed reserveId,address indexed caller,address indexed user,uint256 suppliedShares,uint256 suppliedAmount)` | `0xd986db22…c961` | +suppliedShares |
| `Withdraw(… ,uint256 withdrawnShares,uint256 withdrawnAmount)` | `0xfe7813e2…9b68` | −shares |
| `Borrow(… ,uint256 drawnShares,uint256 drawnAmount)` | `0xef181747…0dcd` | +drawnShares, set borrow bit |
| `Repay(… ,uint256 drawnShares,uint256 totalAmountRepaid,(int256 sharesDelta,int256 offsetRayDelta,uint256 restoredPremiumRay))` | `0xd765a026…07dd` | −drawnShares, apply premium delta, clear bit if 0 |
| `LiquidationCall(uint256 indexed collateralReserveId,uint256 indexed debtReserveId,address indexed user,address liquidator,bool receiveShares,uint256 debtAmountRestored,uint256 drawnSharesLiquidated,PremiumDelta,uint256 collateralAmountRemoved,uint256 collateralSharesLiquidated,uint256 collateralSharesToLiquidator)` | `0x2a1f12d9…4a37` | user −drawn/−collateral shares; liquidator +shares if receiveShares |
| `ReportDeficit(uint256 indexed reserveId,address indexed user,uint256 drawnShares,PremiumDelta)` | `0x59932f33…f076` | debt write-off |
| `SetUsingAsCollateral(uint256 indexed,address indexed caller,address indexed user,bool)` | `0x4763df43…f51f` | collateral bit |
| `RefreshAllUserDynamicConfig(address indexed user)` | `0x83731474…8da7` | all collateral-flagged keys := latest |
| `RefreshSingleUserDynamicConfig(address indexed user,uint256 reserveId)` (reserveId not indexed) | `0x5790b5f0…17b8` | one key := latest |
| `UpdateUserRiskPremium(address indexed user,uint256 riskPremium)` | `0x9a9082fd…dac1` | RP |
| `RefreshPremiumDebt(uint256 indexed reserveId,address indexed user,PremiumDelta)` | `0x4fd0c544…a9a7` | premium delta |
| `SetUserPositionManager(address indexed user,address indexed positionManager,bool)` | `0x413bea99…2277` | (authorization only) |
| Config: `AddReserve(uint256 indexed,uint256 indexed assetId,address indexed hub)` `0xb2d3221c…`; `UpdateReserveConfig(uint256 indexed,(uint24,bool,bool,bool,bool))` `0xe9495512…` (CR, paused, frozen, borrowable, receiveShares); `UpdateReservePriceSource(uint256 indexed,address indexed)` `0x18a45d07…`; `AddDynamicReserveConfig(uint256 indexed,uint32 indexed key,(uint16,uint32,uint16))` `0xfcede550…`; `UpdateDynamicReserveConfig(same)` `0x2d4f2760…`; `UpdateLiquidationConfig((uint128,uint64,uint16))` `0x9062eec1…`; `UpdatePositionManager(address indexed,bool)` `0x8e04e916…`; proxy `Upgraded(address indexed)` `0xbc7cd75a…` | | |

**Hub `0x6675…C572`:**
- `UpdateAsset(uint256 indexed assetId,uint256 drawnIndex,uint256 drawnRate,uint256 accruedFees)` `0xa1facf11…3350`. This is a complete accrual journal.
- `Add` `0xb233dd05…`, `Remove` `0x535be2ff…`, `Draw` `0xe2497bc4…`, `Restore(…,PremiumDelta,uint256 drawnAmount,uint256 premiumAmount)` `0x119e7f99…`, `RefreshPremium` `0x3fa96ecf…`, `ReportDeficit(…,uint256 deficitAmountRay)` `0x4845ee5c…`, `TransferShares` `0x0d93b0e8…`, `MintFeeShares` `0xafd21228…`, `Sweep` `0x69bb3893…`, `Reclaim` `0x56611183…`, `EliminateDeficit` `0xe97b8576…`.
- Config events: `AddAsset` `0x92fb402b…`, `UpdateAssetConfig` `0xea358cc4…`, `AddSpoke` `0x47acdb60…`, `UpdateSpokeConfig` `0x90984699…`.

**Oracle:** `UpdateReserveSource(uint256 indexed,address indexed)`, `SetSpoke`.

**Log order in a live borrow tx:** hub `UpdateAsset` → token Transfer → hub `Draw` → spoke `RefreshAllUserDynamicConfig` → spoke `Borrow`. RP events are skipped because RP is 0.

**Not evented; needs a view sweep or derivation:**
1. Prices. The CAPO adapters are time-dependent and emit nothing.
2. Index and share-price drift between events.
3. The key values a user gets from `RefreshAll…`, resolved against the reserve's latest key at that log position.
4. In-place `UpdateDynamicReserveConfig` silently changing every key-0 user's CF.
5. Unrealized fees.
6. Liquidator share credits appear only in `LiquidationCall`'s non-indexed `liquidator` field.

Also note: this RPC caps `eth_getLogs` at 10,000 blocks (error -32614, verified).

---

## 5. Getters to reconcile against

**`Spoke.getUserAccountData(user)`** (`Spoke.sol:633-636`, a view that uses the snapshot keys) returns `(riskPremium BPS, avgCollateralFactor WAD, healthFactor WAD or 2^256-1, totalCollateralValue [1e26=$1], totalDebtValueRay [Value×RAY], activeCollateralCount, borrowCount)`.

Other spoke getters:
- `getUserPosition(r,u)` (raw struct); `getUserReserveStatus(r,u)` → `(collateral, borrowing)`;
- `getUserDebt` → `(ceil drawn, ceil premium)`; `getUserTotalDebt`; `getUserPremiumDebtRay`;
- `getUserSuppliedAssets` (floor); `getUserSuppliedShares`; `getUserLastRiskPremium`;
- `getReserve(r)`; `getReserveConfig`; `getDynamicReserveConfig(r,key)`; `getLiquidationConfig`;
- `getLiquidationBonus(r,u,hf)`; `getReserveId(hub,assetId)`;
- `multicall(bytes[])`; `extSloads(bytes32[])`.

Hub getters:
- `getAsset(a)` (full struct, everything 2.1/2.2 need); `getAssetDrawnIndex` (view-accrued);
- `previewRemoveByShares` / `previewAddByShares` / `previewAddByAssets`;
- `getSpokeOwed(a,spoke)` → `(ceil drawn, ceil premium)`; `getSpokeAddedAssets`; `getSpokeConfig`;
- `getAssetDeficitRay`; `getAssetAccruedFees`.

Oracle getter: `getReservesPrices(uint256[])`.

**Reconcile result (verified).** At block 157,337,755, one Multicall3 (`0xcA11…CA11`) eth_call per user. The integer replica of 2.1–2.6 **exactly matched all 7 `getUserAccountData` fields** for 3 live borrowers (HF 2.286529884273927433, 3.354962095931666346, 1.933375477025494081). All 88 per-reserve checks passed: index == `getAssetDrawnIndex`, supplied assets == `getUserSuppliedAssets`, debt == `getUserDebt`.

**Liquidation replay (verified).** For 4 direct `liquidationCall` txs (blocks 155,787,821; 157,203,837; 157,204,396; 157,204,416), I rebuilt state at B−1, evaluated at B's timestamp, and decoded `debtToCover` from calldata. `drawnSharesLiquidated`, `collateralSharesLiquidated`, `collateralSharesToLiquidator` and `debtAmountRestored` **all matched exactly** (LB 11150, 10900, 11355, 10900).

---

## 6. Where a v3 port breaks

Compared with Solvent's v3 law in `internal/risk/aave.go:3-13` and `math.go:235-275`:
1. **One factor.** CF is both LTV and LT, and borrowing is allowed to HF = 1.0. There is no LTV/LT gap to model.
2. **Health-factor rounding.**
   - v3: base-currency 1e8 values with per-reserve floor/ceil, then `wadDiv` half-up over Σ(C·LT), then /1e4.
   - V4: 1e26 Value units, debt left at RAY (no per-reserve rounding), a single `mulDiv` floor, and CF scaled by 1e14.
   - The v3 half-up composite will mis-round.
3. **Collateral is share-based**, with virtual 1e6 offsets and a hub-wide share price built from liquidity, swept, owed, fees and deficit. There is no liquidityIndex and no `rayMul(scaled, index)`.
4. **Interest is linear per accrual interval** (`rate·dt/YEAR`), compounded only at hub touches with `rayMulUp`. It is not v3's `calculateCompoundedInterest`. The rate is stored and evented; premium is excluded from utilization.
5. **Debt = drawn + premium** (premium = shares·idx − offset). Stable debt does not exist.
6. **Per-user config keys.** An effective CF depends on the user's snapshot key, not the reserve's current config. In-place edits hit everyone on that key.
7. **Explicit collateral enable.** Flagged reserves with CF = 0 or zero shares are excluded from value and counts.
8. **Identity.** reserveId (spoke) ≠ assetId (hub) ≠ token. The user is topic3; the caller is a position manager. There are no aToken or variableDebtToken transfers to follow.
9. **Liquidation is different:**
   - no close factor; target HF 1.24;
   - bonus that varies with HF;
   - $1,000 dust rule;
   - same-reserve liquidation allowed;
   - shares paid to the liquidator or treasury;
   - deficit write-offs through `ReportDeficit`.
10. **Oracle** is keyed by reserveId, uses `latestAnswer()` with no staleness check, and a non-positive price reverts every view.
11. **Both Hub and Spoke are upgradeable.** The Hub proxy exists despite docs calling the Hub immutable. The ProxyAdmins belong to EtherFiTimelock, and `AIP_PACKAGE.md:86-87` plans a proxy migration to "Aave's permissioned Spoke". Watch `Upgraded`.

---

## 7. Live reserve parameters (block 157,337,118)

CF / maxLB / liquidation fee are in BPS. All 23 reserves are on dynamic key 0 except eUSD.

| r | Asset | CF / maxLB / fee | Notes |
|---|---|---|---|
| 0 | USDC | 9000 / 10500 / 1000 | borrowable, draw cap 40M |
| 1 | WETH | 7500 / 11000 / 1000 | borrowable, draw cap 600 |
| 2 | USDT | 9000 / 10500 / 1000 | |
| 3 | EURC | 9000 / 10750 / 1000 | borrowable since 2026-09-17, draw cap 250k |
| 4 | frxUSD | 9000 / 10750 / 1000 | |
| 5 | weETH | 7500 / 11000 / 1000 | |
| 6 | eBTC | 7200 / 11250 / 1000 | |
| 7 | eUSD | key 1: 0 / 10750 / 1000 | frozen, hub-spoke inactive, 0 supply |
| 8 | ETHFI | 4000 / 11500 / 1000 | |
| 9 | sETHFI | 4000 / 12000 / 1000 | |
| 10 | OP | 4000 / 11500 / 1000 | |
| 11 | WHYPE | 6500 / 11250 / 1000 | |
| 12 | beHYPE | 6000 / 11500 / 1000 | |
| 13–14 | liquidETH, liquidBTC | 7000 / 11500 / 1000 | |
| 15–18 | liquidUSD, liquidRESERVE, weEUR, liquidRWA | 9000 / 10750 / 1000 | |
| 19 | iwSPYx | 7800 / 11000 / 1000 | |
| 20 | iPAXG | 8000 / 11000 / 1000 | |
| 21 | iwQQQx | 7800 / 11000 / 1000 | |
| 22 | iwTBLLx | 8000 / 11000 / 1000 | |

The fork's LAUNCH_SPEC.md table (CF 95%, liquidity fee 5%/7%, etc.) is **stale**. Read config from chain and events.

**Suggested shape:**
- stream start block ≤ 154,915,790;
- event-source positions from the spoke;
- per batch, one Multicall3 eth_call at a hash-pinned block for `getAsset` ×23, `getReservesPrices`, the reserve and dynamic configs, and `getUserPosition` for dirty users;
- compute with the formulas above;
- reconcile `getUserAccountData` exactly.

---

## Verified
- Source identity:
  - fork = upstream `2524fe40` plus a 1-line visibility change and `EtherFiSpokeInstance` (`git diff`);
  - core equals v0.5.11;
  - all 132 verified source files of 5 deployed contracts are byte-identical to the repo (this relies on Blockscout's bytecode verification; I did not recompile).
- Proxy implementations and admins via EIP-1967 slots; ProxyAdmin owners = EtherFiTimelock; LendGateway active, `minHealthFactor` = 1.10e18.
- All 23 reserve, dynamic, hub-spoke and liquidation configs, price sources and their descriptions, and book totals (numbers above).
- The formulas in §2: 7/7 fields exact for 3 users. `UpdateAsset` == stored asset state.
- The collateral-exhaustion / dust liquidation branch, bonus interpolation and fee split: 4/4 events reproduced exactly.
- Event topic0 hashes and signatures against live logs. Config-change history counts: 30 in-place dynamic-config updates, 24 appends, 25 reserve-config updates, 4 liquidation-config updates, 71 oracle-source events, 1 position-manager activation, 10 liquidations, 0 deficits, 0 risk-premium events.
- RPC use: about 370 read-only calls to the owner's OP endpoint (provider domain "optimism"). Log history came from the public Blockscout API.

## Unverified / assumptions
- **Not exercised on chain; checked by reading source only:**
  - the pure target-HF liquidation branch (every sampled liquidation hit the "seize the whole reserve" branch);
  - premium, risk-premium and deficit paths (CR = 0 and threshold 0 make premium impossible today).
  - I recommend an anvil fork test of these before trusting them.
- Non-"Capped" price sources (ETH, OP, HYPE, PAXG, iwSPYx/QQQx/TBLLx): I could not see their internals (they expose only `latestAnswer`). CAPO time-dependence comes from their selectors and BGD's known design, not from verified source.
- Total spoke log volume is unknown. Blockscout rate-limited the full pull after 8,936 logs covering blocks 154.9M–155.5M. The ≥500 Safes approving the gateway is a truncated lower bound.
- Future changes: a raised `riskPremiumThreshold` or CR > 0, the planned proxy migration, and GHO borrowing (in the OP blog, but not listed on the spoke).
- Tokenized-stock feeds (iwSPYx etc.) may go stale outside market hours; AaveOracle does not guard against this.

## Sources
- https://github.com/aave/aave-v4 (commit `2524fe40`, tag v0.5.11; audits in `/audits`: Blackthorn 2025-10-20 and 2026-02-24, Trail of Bits 2025-11-06, ChainSecurity 2026-01-28 and 2026-03-23, Certora formal verification 2026-03-09 for Hub/Spoke/Libraries)
- https://github.com/etherfi-protocol/aave-v4 (`63a5a039`; `deployments/optimism/10.json`, `scripts/etherfi/LAUNCH_SPEC.md`, `scripts/etherfi/AIP_PACKAGE.md`, `audits/etherfi/2026-07-30_Aave-V4_Certora_EtherFiSpokeInstance.pdf`)
- Blockscout: https://explorer.optimism.io (verified source for LendGateway impl `0x451dbb5599Ff8aD749a7D700A29d60d0a0fbD3C3`, `src/modules/lend-gateway/LendGateway.sol`)
- https://optimism.io/blog/etherfi-upgrades-to-aave-v4-on-op-mainnet (2026-08-13)
- https://aave.com/docs/aave-v4
- https://governance.aave.com/t/arfc-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25314

Line numbers above refer to `src/...` in either repo; they are identical except `Spoke.sol:278`.

Replica scripts (scratchpad, not the repo), to reproduce:
- C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\rpc\recon.py
- C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\rpc\liq.py
- C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\rpc\topics.py

The cloned source trees are in the same scratchpad: `aave-v4\`, `etherfi-aave-v4\`.