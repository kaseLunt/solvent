# Brief: adding a third engine (`aave_v4_cash`) to Solvent — the end-to-end map, and every place the code assumes "Cash = debt_manager"

Nothing in the repo or in git was changed. This was read-only: repo reads, GitHub raw fetches, and about 270 read-only JSON-RPC calls to OP Mainnet. The RPC URL came from `SOLVENT_RPC_OP` in `.env` and was never printed; its second-level domain is `optimism`.

## Summary

- **The new engine is already the bigger book.** At OP block 157,337,247 the ether.fi Cash V4 Spoke holds about **$32.9M of debt**: $31.86M USDC and $1.06M WETH. The task brief puts the Debt Manager at $4.49M. From here on, "Cash" in the product means Aave V4, and the Debt Manager becomes a second, draining engine.
- **This is not a config-only change.** `roadmap/work/W1-phase2-positions-prices.md:94` says V4 would be a "config-only addition when [the AIP executes]". That is wrong. Every layer has hard-coded two-engine arms: `KnownEngines`, decode tables, the indexer wiring switch, `risk.PositionInput`, `riskfeed.AssembleConfig{Aave, DM}`, the API enums, the TS client, and about 55 web production files.
- **The most dangerous seam is code that treats any engine that isn't Aave as the Debt Manager.** There are about 12 `switch`/`if` arms of the form "`case AaveEngine:` … `default:` Debt Manager". Once `PositionInput.Validate` accepts a V4 position, those arms will either nil-dereference `pos.DM` or silently label V4 numbers with Debt Manager semantics (list below).
- **The second most dangerous seam is scenario propagation.** It is keyed by (chain, asset) and carries the Debt Manager's stable-price snap. I verified that V4's oracle does not snap: USDC reads 0.99987286 on V4 against exactly 1.000000 on PriceProviderV2 at the same block. As written, a stable-depeg scenario would wrongly pin V4's USDC collateral at $1.
- **V4 emits about 35× the log volume the Debt Manager did before the migration** (about 12.7k logs per 2,000 blocks, against 363). Most of it is card spends: each spend is a Spoke `Withdraw` + Hub `Remove` + `UpdateAsset` + `RefreshAllUserDynamicConfig`. That matters for DB size, for the O(all events) balance rebuild on every reorg, and for the hosting cost.
- **V4 adds state neither existing engine has:**
  - Per-user dynamic config keys: collateral factor and liquidation bonus are frozen per (user, reserve) at the user's last refresh. This is already live — eUSD has key 1 with CF 0 while positions opened under key 0 keep CF 40%.
  - Premium debt.
  - A supply share→asset exchange rate that no event stamps.
  - A liquidation-bonus curve instead of a fixed bonus.
- **Effort:** indexer L, risk L, API M–L, client + web L, reconcile L, tests M–L. Under D-006, the deriver, the risk math and the reconcile gate each need a Codex pass. The work is outside W3's declared scope, which excludes "V4 liquidation simulation" and non-additive OpenAPI changes (`roadmap/work/W3-phase5-public-web.md:110-114`), so it needs a new work item.

---

## Verified

### On-chain facts (OP Mainnet, read-only calls)

| Fact | Value | How verified |
|---|---|---|
| Cash Hub (proxy) | `0x66753c4e3fC84f1eD0e3C267C927284E9d90C572`, code from block **154,915,786** | `eth_getCode` at head (1,419 bytes); binary search for the first block with code |
| Cash Spoke (proxy, implementation type `EtherFiSpokeInstance`) | `0xdffcC3536D932eb51Df51a7F5FA407c4270d5308`, code from **154,915,790** | same method |
| Spoke oracle | `0xe8cbd37210bF1E29436dAe183d7b9fe45E886fA8` | `spoke.ORACLE()` returns it; `oracle.spoke()` returns the Spoke; `oracle.decimals()` = **8** |
| TreasurySpoke (fee receiver on the same Hub) | `0x7EB4d25F137868662350603A2863F682287b0768` | `eth_getCode` |
| Launch and activation payloads | launch tx `0x6b83…2b16` at block **154,924,987** (status 1, 333 logs); activation `0xc290…efc` at **154,925,193** (40 logs) | `eth_getTransactionReceipt` |
| Reserves | **23** (not the 20 in the ARFC). Adds weEUR, beHYPE, iwSPYx, iPAXG, iwQQQx, iwTBLLx | `getReserveCount()`, `getReserve(id)`, ERC-20 `symbol()` |
| Liquidation config | targetHF 1.24e18, HF for max bonus 0.90e18, bonus factor 9000 bps | `getLiquidationConfig()` |
| Dynamic reserve config | CF 40–90%, max bonus 10500–12000 (5–20%), liquidation fee 1000 bps on every reserve. eUSD `dynamicConfigKey = 1` with **CF 0**; all other reserves on key 0 | `getDynamicReserveConfig(id, key)` |
| Collateral risk / risk premium | `collateralRisk = 0` on all 23 reserves; 3 sampled borrowers show `riskPremium = 0` | `getReserve`, `getUserAccountData` |
| Debt | **$32.92M** total (USDC $31,863,304; WETH $1,061,013; all other reserves 0). Supplied $301.3M, which includes USDC/USDT lender liquidity | `getReserveTotalDebt(id)` × `getReservePrice(id)` / 1e8 |
| Units | HF is in WAD. `totalCollateralValue` is USD × 1e26; `totalDebtValueRay` is USD × 1e53 (a sampled HF of 1.296 recomputes exactly from those) | `getUserAccountData` on 3 recent borrowers |
| Oracle vs the Debt Manager's PriceProviderV2, same block | 18 of 23 assets identical after scaling 8→6 decimals. Differences: USDC −1.27 bps, USDT −1.73, frxUSD −0.08, liquidUSD −1.27, weEUR **−10.6 bps**. PriceProviderV2 returns exactly 1,000,000 for USDC, USDT and frxUSD (stable snap); V4 does not snap | `PPv2.price(address)` vs `oracle.getReservePrice(uint256)` |
| Event volume, last 2,000 blocks (157,335,248–157,337,247, about 67 min) | Spoke 6,162 logs: RefreshAllUserDynamicConfig 2,760, Withdraw 2,561, Supply 486, Borrow 199, RefreshSingle 57, SetUsingAsCollateral 57, SetUserPositionManager 23, Repay 19. Hub 6,530 logs: UpdateAsset 3,265, Remove 2,561, Add 486, Draw 199, Restore 19. 3,151 transactions; **2,074 distinct users**. All topic0s matched upstream `aave-v4` signatures | `eth_getLogs`, topic0 = keccak of the upstream signatures |
| Volume over time (Spoke+Hub, per 2,000 blocks) | Aug 2: 0 · Aug 10: 96 · Aug 22: 7,890 · Sep 2: 11,469 · Sep 13: 13,017 | 5 sampled windows |
| Debt Manager volume, same window size | 363 logs (block 154.0M, before migration), 999 (155.88M, during migration), **48 now** | `eth_getLogs` |
| Account keying | All 199 recent Borrow logs have `caller != user`. Sampled users are 242-byte proxies, consistent with Cash Safes, the same account key the Debt Manager uses | `eth_getCode` |
| Provider limit | a 2,000-block `getLogs` window works; 5,000 / 20,000 return HTTP 500; 100,000 times out. This matches `config/contracts.json` `"window": 2000` | direct probes |

The deployment inventory comes from `etherfi-protocol/aave-v4` `deployments/optimism/10.json`, which says "status live, deployedAt 2026-07-30". Every address above was checked on-chain.

### Repo facts (path:line)

#### 1. Indexer

**Config**
- `internal/config/config.go:13-24` — `KnownEngines` is a closed map; `Load` refuses unknown engines at `:190-192`.
- `config/contracts.json` streams have one address each. Add:
  - `op:v4-cash-spoke` (0xdffc…5308, start 154915790)
  - `op:v4-cash-hub` (0x6675…C572, start 154915786)
  - optionally `op:v4-cash-oracle` (0xe8cb…6fA8, for `UpdateReserveSource`)
- All three can use engine `aave_v4_cash`. `BuildRunnerSpecs` allows several contracts per engine but only one chain (`internal/derive/runner.go:184-212`).
- Unlike Aave v3, V4's config events (`AddReserve`, `Add/UpdateDynamicReserveConfig`, `UpdateLiquidationConfig`, `UpdateReservePriceSource`) come from the Spoke itself. So the Debt Manager's pattern fits: the engine is its own `ParamEngine` (`cmd/riskd/main.go:466-475`). No separate `aave_param`-style engine is needed.
- The engine's genesis must be at or below 154,915,786 so the launch payload's config logs (block 154,924,987) are in custody.

**Decode**
- `internal/decode/decode.go:25-38` embeds 5 ABIs. The registration block is at `:195-231`; the `engineTopics` map at `:233-242`.
- V4 needs new ABIs for ISpoke, IHub and IHubBase — about 12 lifecycle events, 9 Hub flow/accrual events, and about 10 config events.
- The ABIs must come from the deployed `EtherFiSpokeInstance` implementation (0xA1f75D80…, per 10.json), not upstream `main`.
- Dispatch ignores the log's address and is safe only with one address per stream (`decode.go:259-271`). Two separate streams satisfy that.
- The Hub also serves the TreasurySpoke, so the deriver must filter Hub events on the indexed `spoke` topic.

**Derive**
- Interface: `internal/derive/engine.go` (`Engine` lifecycle).
- Existing per-engine derivers: `debtmanager.go` (744 lines), `aave.go` (1,122 lines).
- Wiring switch: `cmd/indexer/main.go:1326-1360`. `default:` returns an error, which is good — it fails loudly.
- Rate kinds: `internal/derive/runner.go:84-90`, collected at `:753-770`. V4 needs a `drawn_index` kind from Hub `UpdateAsset`. `rate_indexes.asset` is BYTEA, so key it by the underlying address mapped from `assetId`, not by `assetId`.
- New derived state:
  - Shares, as sides: `supplied_shares`, `drawn_shares`, `premium_shares`, `premium_offset_ray`. These fit the additive `position_events.delta` → `position_balances` fold, since shares and `offsetRayDelta` are additive.
  - A reserveId↔assetId↔underlying registry, from `AddReserve` + Hub `AddAsset`.
  - A latest-wins collateral-flag ledger (reuse the pattern in `internal/store/collateralflags.go:52-53,100`).
  - A per-(user, reserve) dynamic-config-key ledger. `RefreshAllUserDynamicConfig(user)` carries no key, so it has to be joined to each reserve's current key at that block.

**Store and schema**
- Engine-generic by schema:
  - `position_events`, `position_balances`, `derive_cursors`, `rate_indexes` (`internal/store/migrations/00002_positions.sql:9-75`)
  - `raw_logs` / `ingest_cursors` (00001)
  - `prices` / `price_poll_anchors` (00005, 00007)
  - `block_headers` (00015)
  - `observatory_points` (00016:50-119; `rates` is JSONB)
  - `risk_batch_aggregates`, `risk_scenarios`, `risk_waterfall` (00013:443-512)
- Engine-specific by column family:
  - `risk_positions` (00013:265-318): an Aave block (`hf_num/hf_den/hf_wad/total_collateral_base/total_debt_base/weighted_lt_sum/avg_lt_bps`) and a Debt Manager block (`collateral_value_usd/max_borrow_lt/borrowings/liquidatable`).
  - `risk_position_legs` (:336-373): Aave `scaled_*/live_*` vs Debt Manager `amount/value_usd/max_borrow_contribution`.
  - V4 can reuse the Aave HF family, but needs a migration (00020) for `avg_collateral_factor`, `risk_premium`, a debt-value precision column, and leg columns for the four share kinds, `collateral_factor` and `dynamic_config_key`.
  - `param_history` (00011:49-103) is keyed by (engine, chain, asset). V4 params are keyed by (reserve, dynamicConfigKey).
- Debt-Manager-only by use: `snapshot_sweeps`, `sweep_generations`, `snapshots` (00003/00004). V4 collateral comes from events, so it does not need a sweep.
- Hard-coded Debt Manager SQL:
  - `internal/store/risk.go:839-847` (`DMParamsAsOf`)
  - `internal/store/invariants.go:138-146` (IIU coverage scan)
  - `internal/store/reconcile.go:432,592,609,686,718,1088,1139`
  - `internal/store/p5_params_timeline.go:102-140`

**Sweeps**
- `internal/snapshot/snapshot.go:265-270`: one snapshotter per engine, and `cmd/indexer/main.go:1297-1315` only builds it for `debt_manager`.
- `cmd/riskd/main.go:215-217` and `cmd/api/main.go:790` return `[]string{c.DM.Engine}`. Leave V4 out of both.
- The Debt Manager sweep keeps sweeping every Safe it has ever seen, every hour, while the Debt Manager drains.

**Reorg protocol**
- Engine-agnostic: chain-scoped `reorg_epochs` plus a per-engine `acked_epoch` (`internal/store/derive.go:555-583`; D-003). A V4 engine on OP acks the same OP epochs as the Debt Manager.
- The cost does not scale well: `RewindDerived` deletes every event-sourced balance for the engine and rebuilds them with `SUM(delta) … GROUP BY` over **all** of that engine's `position_events` (`derive.go:592-615`). At V4's volume, every OP reorg ack becomes a full-history aggregate.

#### 2. Risk

**Engine identity**
- Engine constants: `internal/risk/types.go:52-61`.
- `PositionInput{Engine, Aave, DM}`: `:592-598`. `Validate` switch: `:601-626`; `default` is `ErrEngineMismatch`, which is good.
- V4 needs `V4 *V4Input` and a `ComputeV4Health` that matches the Spoke's own rounding:
  - HF = Σ(value × CF) / debt, where debt includes premium in ray.
  - Values in 1e26 "Value" units; prices from an 8-decimal reserveId-keyed oracle.
  - Params come from the user's dynamic key, not the reserve's current key.

**Per-engine math**
- `aave.go:65`, `dm.go:62`, `LiquidationBonusMultiplier` (`math.go:308-326`, `default` → false).
- Bonus legs: `dm.go:334-372`. V4 needs a new bonus-curve leg: the bonus interpolates between `maxLiquidationBonus × bonusFactor` and the max as HF moves below `healthFactorForMaxBonus`, the liquidation fee comes out of the bonus, and liquidation targets HF 1.24 instead of a close factor.

**Scenarios**
- `scenario.go:386-390` accepts only `AaveEngine`/`DMEngine` in `engines`.
- `responseKey(chain, asset)` at `:669-672`, `:792-794`; stable snap at `:706-731`.
- `ApplyScenario`'s engine switch (`:755-790`) has **no default**, so a V4 position would be returned with unshocked prices.
- The Debt Manager's `stable_snap`/`base_stable_snap` flags sit on OP assets in 14 scenario files; for example, `internal/risk/scenarios/stable_depeg_0995_in_band.json:41,54,67,82`.

**Waterfall / shortfall / liquidation price**
- `waterfall.go:323-348` (`default` → Debt Manager), `:365-376` (no default).
- `shortfall.go:147-157` (no default), `:177` (`default` → Debt Manager).
- `liqprice.go:189-236` (`default` → Debt Manager).

**Assembly (`internal/riskfeed`)**
- `AssembleConfig{Aave, DM EngineBinding}` at `assemble.go:306-310`; loops over `[]EngineBinding{cfg.Aave, cfg.DM}` at `:429` and `:1197`; a decimals map `{Aave:8, DM:6}` at `:1198`.
- Separate `assembleAave` (`:696`) and `assembleDM` (`:930`); `FoldParams` per engine at `:445-457`.
- `store.RiskInputs.AaveParams/DMParams` at `internal/store/risk.go:279-280`; `RiskSnapshotSpec` Debt-Manager/Aave-specific fields at `:95-121`.
- `IdentityPolicy{AaveEngine, DMEngine}` at `identity.go:103-107`, looped at `:188`. Adding V4 changes the materialization identity, so bump `AlgorithmRevision`.
- A V4 engine needs a new `assembleV4`, a V4 binding, and a generic engine list in place of the named fields.

**riskd**
- `consumedEngines`, `gatedEngines`, `sweptEngines`, `requiredStampEngines` at `cmd/riskd/main.go:167-217,351-370`; `PositionEngines` at `:377`; bindings at `:436-476` (`loadConfig` requires the `eth` and `op` chains).
- **Coupling:** `gatedEngines` refuses the **whole pass** when any required cursor is missing, on the wrong chain, or unacked (`internal/riskfeed/gate.go`). A V4 engine still backfilling, or stuck on a reorg, would stop the Debt Manager and Aave batches too. Bootstrap the V4 cursor before it is required, or make a V4 outage an engine-scoped refusal.
- Recompute fires whenever any consumed cursor moves (`cmd/riskd/gates.go`). With `defaultRetention = 5000` batches (`cmd/riskd/main.go:66`), per-batch row count grows with V4's account count.

**Prices**
- The poll-view set is closed and every view takes an address argument: `pollViews` at `internal/prices/prices.go:451-480`; `pack(asset common.Address)`.
- V4 needs `getReservePrice(uint256)`, which takes a **reserveId** argument, so `recon/feeds.json` needs a `reserveId` field (`internal/config/feeds.go:93-151`).
- Source strings are in `ProvenanceClass` (`internal/riskfeed/prices.go:113-126`; only `priceproviderv2`, `aaveoracle:`, `chainlink:`, `ratio:`) and in the registry switch (`registry.go:70-76`, `default: continue`, so V4 feeds would be silently dropped from valuation).
- The OP poller is per chain (`cmd/indexer/main.go:1386-1403`). PriceProviderV2 and the V4 oracle would share the `prices:poll:10` price engine, so an OP price outage or G2 gate hits both Cash engines at once.
- V4 also needs pinned Hub reads per asset (`getAddedAssets/getAddedShares`, `getAssetDrawnIndex/DrawnRate`). No event stamps the supply exchange rate.

**Refusal codes**
- G1–G5 (`riskfeed/prices.go:37-50`), `SWEEP_NEVER`, `ENGINE`, `FLAG_CUSTODY_UNPROVEN` (`assemble.go:248-266`).
- The closed vocabulary is pinned by `internal/riskfeed/engine_refusal_test.go:45,65` and by migration 00014's backfill.
- V4 probably needs new codes (dynamic-key custody unproven, exchange rate absent), plus matching entries in `web/lib/refusal-phrasebook.ts`.

#### 3. API and contract

**OpenAPI** (`api/openapi.yaml`, 5,955 lines, 17 paths)
- Four engine enums `[aave_v3_etherfi, debt_manager]`: lines 143 (`/v1/positions`), 527 (`/v1/observatory/series`), 686 (`/v1/events`), 811 (`/v1/params`).
- Dozens of "Aave only" / "Debt Manager only" field descriptions, e.g. `:2774`, `:2937`, `:3049`, `:3905-3918`, `:4803-4827`, `:5242-5264`.
- The header describes "two engines" (`:25`).

**Handlers**
- `parseEngineParam` (`cmd/api/p5_common.go:50-58`); `engineValueDecimals {Aave:8, DM:6}` (`:81-84`).
- Positions engine validation (`p5_positions.go:196-199`, `:264-272`); observatory series (`p5_observatory_series.go:91`); history (`p5_history.go:194,203,253`).
- Server config bindings (`cmd/api/main.go:320-331`, and a `switch` at `:752`); meta notes (`meta.go:437-439`, loop at `:839`).
- Evidence welds hard-code two rows (`p5_evidence.go:351-352`).
- Param mapping (`p5_params.go:151,173`); events DTO (`p5_events.go:391-426`).
- Rebuild: `read.go:249-258` (params fold, `default: continue`), `:744-832` (`reconstruct`, errors on an unknown engine, which is good), `:908-1080`.
- Run-book: `p5_runbook.go:875-940` already refuses an engine it has no arm for — "THE ENGINE ARM THAT DOES NOT EXIST", pinned by `p5_runbook_transition_test.go:949` using `morpho_blue_etherfi`. `:1017`, and `:1138` (movement rule `default` → Debt Manager).
- `p5_runbook_set.go:1218` (`default` → Debt Manager eligibility flip).
- Store-side: `positionsOrder` / `positionsValueColumns` are per-engine maps (`internal/store/p5_positions_page.go:176-249`). V4 can reuse Aave's HF orderings if its row uses `hf_wad/total_*_base`.
- Event display is per-engine (`internal/store/p5_events.go:151-218`). **Leaving the engine filter empty defaults to `{Aave, DM}` at `:212-214`**, so V4 would be dropped from the all-engines Activity feed.
- The liquidation-detail switch (`:591`) has no default.

**Stress scenarios**
- `cmd/api/testdata/scenario_engines_golden.json` pins each scenario's engine list.
- The Debt Manager rate projection is Debt-Manager-only (`handlers.go:1507`). V4's utilization-driven rates would need their own projection or an explicit exclusion.

#### 4. Client and web

**TS client**
- `EngineName` comes from the generated enum (`packages/client-ts/src/client.ts:122-134`). `ENGINE_NAME_SET satisfies Record<EngineName,true>` is total, so an enum change breaks the compile — intended.
- Most web lists use `satisfies readonly X[]`, which is **not** total. V4 would be silently left out of:
  - `web/lib/feed-data.ts:56`
  - `history-view.ts:133`
  - `observatory-data.ts:25-28`
  - `positions.ts:35,65-68,102-103`

**"Cash = debt_manager" hard-codes**
- `web/lib/inspector-position.ts:16-17` (`CASH`/`LEGACY`, exported, imported by about 15 modules).
- Duplicates: `web/lib/cash-book.tsx:58-59`; `prose.ts:31-41` (`engineInProse` / `engineLabel`) and `:45` (`ENGINE_ORDER`); `chrome.ts:120` (second `ENGINE_ORDER`); `positions.ts:44` (`DEFAULT_BOOK_ENGINE = "debt_manager"`); `observatory-series.ts:631-638` ("Cash debt" labels); `history-series.ts:119,333-340`; `evidence.ts:55-62,138,234,261`; `params-format.ts:40-45,116`; `lab-movers.ts:181-191`; `app/lab/MoversTable.tsx:19-20`; `liq-distance.ts:138`; `headroom.ts:21-25`; `verification-view.ts:110-119`; `cash-view.ts:228-373` (wire paths like `engines[debt_manager]`); `cash-refusal.ts:23`.
- Price-source copy that becomes wrong: `prose.ts:67,70` (`CASH_PRICE_SOURCE` = PriceProvider v2) and `overview-copy.ts:81,132` ("Cash's borrow cap"; OP + Ethereum stack chip).

**Two-slot page structure (a primary "cash" slot plus one "legacy" slot)**
- `CashBookReading.cash/.legacy` (`cash-book.tsx:90,313-325`).
- Book: `BookSurface.tsx:22-60,129` with `BookLegacy`.
- Overview: `OverviewSurface.tsx:44,70` (Debt-Manager-only verdict).
- Inspector: `inspector-view.ts:65` (state `"legacy-only"`), `:194-195` (`find` one Cash position), `:259` ("complete · both engines"); `InspectorSurface.tsx:38-39,96`; `LegacyCard`.
- Scenarios/Lab: `lab-view.ts:285,297,410-436`; `lab-engine.ts:125`; `lab-compare.ts:358`; `LegacyResult/LegacyCompare`.
- Activity: `activity-view.ts:355,601-606` (it already has a fallback "an engine this page does not name").
- History: `HISTORY_ENGINES`.
- Verification: `verification-view.ts:110-119`.
- The shared `components/kit/LegacyFold.tsx` renders exactly one fold.

**Doctrine: "two engines are never summed"**
- In copy: `cash-view.ts:563-564`, `inspector-headline.ts:128-129`, `lab-view.ts:717-718`, `BookMethodology.tsx:41`.
- In the contract: `meta.go:439`, `proof-contract.gen.ts:554,3090,3244`.

**What V4 does to the pages**
- Cash becomes V4, which uses a health factor like Aave, not the Debt Manager's boolean cap test. So Cash's comparator, histogram, "room %" chart and "borrow cap" copy all change.
- The Debt Manager becomes a second fold ("Cash · Debt Manager, migrating") with its own boolean comparator and 6-decimal PriceProviderV2 units.
- Aave v3 stays a legacy fold.
- `LegacyFold`, `.legacy` and `ENGINE_ORDER` must become lists.
- During migration, one Safe can hold both a V4 position and a Debt Manager position, so the Inspector's single-`find` model breaks.
- The owner will probably want a "Cash total" (V4 + Debt Manager remainder). The current doctrine forbids that sum, and the units are genuinely different: a 1e26 value from an unsnapped oracle vs USD-6 from snapped PriceProviderV2. That needs a recorded decision, not a UI tweak.

#### 5. Reconcile

**Current structure** (`cmd/reconcile`)
- Phase 0 preflight → Phase 1 one REPEATABLE READ snapshot (`snapshotdb/snapshotdb.go`, `task6db.go`) → Phase 2 pinned-RPC comparisons (`dm.go`, `aave.go`, `hf_gate.go` 1,299 lines, `dm_gate.go` 2,649 lines) → Phase 3 rewind re-check and fork welds → Phase 4 artifact (`artifact.go`) (`main.go:1-24`).
- `-engine all|debt_manager|aave_v3_etherfi` at `main.go:147,177-180`. "Acceptance evidence requires both engines" at `:234-235`. Per-engine wiring at `:787-788,902`.
- `snapshotdb.go:82-89,502,773` loops over `{DMEngine, AaveEngine}`. `task6db.go:969-1177` has Debt Manager SQL hard-coding `chain_id = 10`.

**A V4 gate would need** (all pinned reads at a hash-pinned OP block)
1. User ring: derived `supplied/drawn/premium shares` and `premiumOffsetRay` per (user, reserve) must equal `getUserPosition(reserveId, user)` exactly, including `dynamicConfigKey`.
2. HF weld: recomputed HF, collateral value and debt value must equal `getUserAccountData(user)`, bit-exact. Prices come from pinned `getReservePrice`, exchange rates from pinned `getAddedAssets/Shares`, following the pinned-inputs design `hf_gate.go` already uses.
3. Spoke ring: Σ users must equal `getSpokeAddedShares` / `getSpokeDrawnShares` per asset.
4. Asset ring: Σ spokes (Cash + Treasury) must equal Hub totals.
5. A realized-liquidation backtest against `LiquidationCall` rows, like the existing DM backtest `backtest.go`.
6. Schema changes: `-engine` flag, artifact rows, and API evidence welds (`p5_evidence.go:351-352`).

#### 6. Tests that pin two engines

- Go: 104 test files reference engine ids. Explicit pins include:
  - `cmd/api/p5_c2_db_test.go:152` (`require.Len(aggs, 2)`)
  - `cmd/api/testdata/scenario_engines_golden.json`
  - `internal/store/p5_events_vocab_test.go:169` (store ↔ derive constant weld)
  - `internal/riskfeed/engine_refusal_test.go:45`
  - `cmd/reconcile/main_test.go:28-62`
  - `cmd/api/p5_runbook_transition_test.go:949` (the third-engine refusal pin, which must get a V4 arm)
- TS client: 25 test/fixture files; e.g. `packages/client-ts/test/exact-values.test.ts:72-74,173` (`book.engines` has length 2) and `sse.test.ts:233-234`.
- Web: 66 specs and 77 fixtures/generators. Explicit pins include:
  - `web/tests/unit/prose.spec.ts:48-49`
  - `chrome.spec.ts:132`
  - `book-sort-vocabulary.spec.ts:108-122`
  - `e2e/inspector.spec.ts:66` ("complete · both engines")
  - `e2e/overview.spec.ts:72`
  - `verification-view.spec.ts:57`
- Useful template: `internal/derive/lifecycle_test.go` is written to cover "both engines" and can be extended to V4.

---

## Code that treats any engine that isn't Aave as the Debt Manager (fix before `Validate` accepts V4)

| Site | Behaviour with a V4 position |
|---|---|
| `internal/risk/waterfall.go:323` `default: ComputeDMHealth(*pos.DM)` | nil dereference |
| `internal/risk/liqprice.go:189` `default:` Debt Manager weights | nil dereference |
| `internal/risk/shortfall.go:177` `default:` Debt Manager | nil dereference |
| `internal/risk/scenario.go:756` (no default) | **unshocked prices returned silently** |
| `internal/risk/shortfall.go:147`, `waterfall.go:365` (no default) | pass-through / 0 decimals |
| `cmd/api/handlers.go:416` `histogramComparator` `default` | V4 labelled "hf_num/hf_den … Debt Manager" |
| `cmd/api/handlers.go:550` `bucketIndexOf` `default` | buckets on the wrong quantity |
| `cmd/api/handlers.go:1025` HF note | Debt Manager note on a V4 HF |
| `cmd/api/handlers.go:1558`, `:1581` | Debt Manager USD fields / `ComputeDMHealth` nil dereference |
| `cmd/api/p5_history.go:194,203` | Debt Manager branch |
| `cmd/api/p5_runbook.go:1138`, `p5_runbook_set.go:1218` | Debt Manager "eligibility flip" movement rule |
| `internal/riskfeed/registry.go:70` `default: continue` | V4 feeds dropped, so every V4 position is refused as G1 |
| `internal/store/p5_events.go:212-214` | empty filter excludes V4 |

---

## Effort per layer

| Layer | Size | What drives it |
|---|---|---|
| Config / KnownEngines / streams | S | 3 streams; genesis 154,915,786 |
| Decode | M | ~30 event decoders across 2 contracts; ABIs from the deployed implementation; decoder revision |
| Derive | **L** | Share ledger, premium delta, dynamic-key ledger, reserve registry, drawn index, Hub filtering by spoke; Codex gate |
| Store / migrations | M | 00020 (V4 risk columns, param key), generic engine lists, V4 invariants |
| Prices | M | reserveId-argument poll view, new source/provenance class, pinned Hub exchange-rate reads |
| Risk math | **L** | `ComputeV4Health` with exact rounding, bonus curve + fee, waterfall/shortfall/liquidation-price arms, scenario propagation per engine; Codex gate |
| riskfeed / riskd | M–L | Named `{Aave, DM}` bindings → engine list; identity revision; stop V4 from blocking the whole pass |
| API + OpenAPI | M–L | 4 enums, about 12 default arms, decimals map, evidence, meta, prose; contract version bump |
| Client + web | **L** | ~55 production files; Cash identity moves to V4; N folds; Inspector migration states; copy; price-source text |
| Reconcile | **L** | New V4 gate (user / spoke / asset rings + HF weld), artifact schema; Codex gate |
| Tests / fixtures | M–L | ~270 files reference engine ids; about 15 assert exactly two engines; new V4 fixtures and golden pins |

## Riskiest seams, ranked

1. The `default:` → Debt Manager arms above: silent mislabelling or a panic in the money path.
2. Scenario propagation keyed by (chain, asset), with Debt Manager snap flags and the doctrine that "Debt Manager debt is shock-invariant". V4 debt is priced (it includes $1.06M WETH) and its oracle does not snap.
3. Dynamic config keys: per-(user, reserve) CF and bonus, already diverging on eUSD. A param fold keyed only by asset (`indexParams` → `map[Address]ParamRow`) gives a wrong health factor, and on eUSD it errs in the false-safety direction.
4. The supply exchange rate: no event stamps it, so it needs pinned Hub reads or a running computation, welded by the asset ring.
5. Volume: about 280k V4 logs a day right now, no `raw_logs` pruning (only `store.go:364` deletes, on reorg), an O(n) balance rebuild per reorg, and batch rows × 5,000 retention. This is also the main hosting-cost driver.
6. One batch for all engines: a V4 cursor gap refuses the Debt Manager and Aave batches too.
7. Web identity: "Cash" is hard-coded to `debt_manager` in 8+ modules, and the "never summed" doctrine collides with a "Cash total" during migration.
8. Governance: `roadmap/STATUS.md:40-41` still says the AIP is "not yet executed", but launch executed at block 154,924,987. W1 calls V4 "config-only" and W3 excludes it, so this needs a new work item under D-006.

## Unverified / assumptions

- The ABIs of the deployed `EtherFiSpokeInstance` beyond the 13 event types I saw on-chain. Rare events (`LiquidationCall`, `ReportDeficit`, `UpdateUserRiskPremium`, `TransferShares`, `MintFeeShares`, config events) were matched only against upstream `main` (fetched 2026-09-24), not against the deployed bytecode or its verified source.
- The exact rounding of Spoke `getUserAccountData` and of the liquidation-bonus curve. I read interface doc comments, not `Spoke.sol` or `LiquidationLogic`.
- Total V4 log count since genesis: about **9M**, integrated from 5 sampled windows, not counted. The growth rate (about 280k logs/day) assumes today's volume holds.
- Storage of about 1 KB per V4 log end-to-end (`raw_logs` + 3 indexes + `position_events` + indexes), so roughly 100 GB/year. This is a schema-based estimate, not measured on the live DB.
- The V4 account population. I only know 2,074 distinct users were active in one 67-minute window; the total book count wasn't enumerated.
- The Debt Manager's $4.49M / $22.6M figures come from the task brief; I did not re-read them.
- I did not interpret reserve `flags` values (12 / 8 / 10). `deployments/optimism/10.json` says EURC isn't borrowable, but its flags equal USDC's.
- I did not read the EIP-1967 implementation slots, because `eth_getStorageAt` wasn't on the allowed method list. Implementation addresses are from 10.json. I also used `eth_getBlockByNumber` five times, only for timestamps (read-only, but not on the listed method set).
- Effort sizes are my judgement.

## Sources

- Repo: every path:line cited above; prior research `.superpowers/sdd/research-aave-v4-whitelabel.md`.
- [aave/aave-v4 ISpoke.sol](https://github.com/aave/aave-v4/blob/main/src/spoke/interfaces/ISpoke.sol), [IPriceOracle / IAaveOracle](https://github.com/aave/aave-v4/tree/main/src/spoke/interfaces), [IHubBase / IHub](https://github.com/aave/aave-v4/tree/main/src/hub/interfaces) (main, fetched 2026-09-24; latest release v0.5.11, 2026-03-20).
- [etherfi-protocol/aave-v4 deployments/optimism/10.json](https://github.com/etherfi-protocol/aave-v4/blob/main/deployments/optimism/10.json), [src/etherfi/AaveV4EtherfiCash.sol](https://github.com/etherfi-protocol/aave-v4/blob/main/src/etherfi/AaveV4EtherfiCash.sol), [PR #13](https://github.com/etherfi-protocol/aave-v4/pull/13).
- [Optimism blog: ether.fi upgrades to Aave V4 on OP Mainnet](https://optimism.io/blog/etherfi-upgrades-to-aave-v4-on-op-mainnet); [CryptoTimes 2026-08-13](https://www.cryptotimes.io/2026/08/13/etherfi-moves-cash-credit-backend-to-aave-v4-on-op-mainnet/); [ARFC thread 25314](https://governance.aave.com/t/arfc-deploy-a-dedicated-aave-v4-whitelabel-instance-fully-managed-by-etherfi-on-op-mainnet-to-power-ether-fi-cash/25314).
- On-chain: OP Mainnet reads at head 157,337,247 via `eth_getCode`, `eth_call`, `eth_getLogs` (2,000-block windows), `eth_getTransactionReceipt`. Scripts are in the session scratchpad, `…\scratchpad\probe*.py`.