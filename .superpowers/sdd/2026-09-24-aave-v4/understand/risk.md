## Risk math and output schema: what exists today, and what a V4 engine must add

### 1. What each computation produces

- **ComputeAaveHealth** (`internal/risk/aave.go:65`)
  - Refuses any input missing a balances or params watermark (`:72`), any nonzero eMode (`:91`), and any pin from before the TokenMath change (`:122`).
  - Only adapter-output and engine-exact price classes are accepted (`aave.go:37-40`).
  - Per reserve: debt value is rounded up (`MulDivCeil`, `:182`), collateral value is truncated (`MulDivFloor`, `:184`), and the weight is collateral value × LT in bps (`:213`).
  - `AvgLiquidationThresholdBps` is reported but does not feed the HF (`:232`).
  - HF is computed as a half-up wadDiv followed by `/1e4` (`math.go:275`), and is also kept as an exact rational (`aave.go:239`).
  - The liquidatable verdict is a method, `HealthFactorWad < 1e18` (`types.go:735`).
- **ComputeDMHealth** (`dm.go:62`)
  - Needs the sweep watermark as well (`:73`). Prices must be 6-decimal (`:94`) and engine-exact (`:39`).
  - Collateral is valued with a truncating divide (`:134`). Max-borrow contribution is floored per token with the 100e18 denominator (`:148`).
  - Liquidatable is strict: borrowings > max borrow (`:167`). HF is an exact rational.
  - `ProjectDMDebt` exists only for the Debt Manager.
- **Liquidation price** (`liqprice.go:239`)
  - `weightsFor` (`:185`) reduces each engine to debt, a denominator W (1e4 or 100e18), and legs. The closed form is s* = (W·D − Σout)/Σin.
  - Outputs `PriceFloor` and `LowestHealthyPrice` (the ceiling).
- **Shortfall** (`shortfall.go:49`)
  - Health is computed twice (oracle prices vs realized prices) and must match bit for bit (`:177-228`).
  - Seizure is modeled pro-rata (`:45`) using per-leg bonus multipliers (`dm.go:334`, `:353`).
  - Results are kept per engine. The flat total is filled only when the book has a single engine (`shortfall.go:120-122`).
- **Waterfall** (`waterfall.go:159`)
  - Walks a single-shock grid on a price axis (`:163-170`) and requires the debt series to be monotone (`:280-289`).
  - `measurePosition` (`:321`) produces eligible, debt, collateral-at-risk and bad-debt per position.
  - The eligibility note hard-codes the Debt Manager's two-pass close (`:194`).

### 2. Scenarios
- Axes: `eth_usd`, `weeth_eth_rate`, `stable_usd`, `asset_usd`, `borrow_apy` (`scenario.go:56-73`). Shocks are exact num/den (`:113`).
- The propagation matrix is keyed by **`responseKey(chainID, asset)`** only (`:792`, used at `:672` and `:682`). There is **no engine dimension**.
- Price transforms: `base_stable_snap` (`:707`), `stable_snap` (`:727`), otherwise linear (`:733`); then a price cap if one is set.
  - Both snap arms error unless the price has 6 decimals (`:728-731`, `:720-723`).
  - Snap is a Debt Manager PriceProviderV2 law (`math.go:346`).
- `Validate` accepts only `aave_v3_etherfi` and `debt_manager` in `engines` (`scenario.go:387-390`).
  - The comment calls `engines` "informational" (`:249`), but it is a live filter in the API: `covers(sc.Engines, p.Engine)` at `cmd/api/handlers.go:1412` and `p5_runbook.go:615,638`.
- `ApplyScenario`'s engine switch has **no default arm** (`:756-790`).
- Scenario JSON files:
  - The ETH −10 to −60, weETH-rate −5 and weETH-depeg files list both engines. Their propagation rows are chain-10 Debt Manager rows (weETH `0x5A7f…`, WETH, liquidETH, ETH sentinel) plus one chain-1 weETH row (e.g. `eth_minus_20.json`).
  - The three stable-depeg files are Debt Manager only. They set `stable_snap:true` on chain-10 USDC `0x0b2C…`, USDT and frxUSD, and `base_stable_snap` on liquidUSD.
  - BTC, ETHFI, the composition census and the rate horizon are Debt Manager only.

### 3. Output schema (`00013_risk_tables.sql`)
- **`risk_positions`** (PK `batch_id, engine, account`, line 317)
  - Shared by both engines: status, refusal, flags, `value_decimals`, the HF family `hf_num/hf_den/hf_wad/hf_infinite` (283-286), `liquidatable`, `balances_block`, `params_block`, `sweep_block`, and the staleness columns.
  - **Aave only:** `total_collateral_base`, `total_debt_base`, `weighted_lt_sum`, `avg_lt_bps` (288-292).
  - **DM only:** `collateral_value_usd`, `max_borrow_lt`, `borrowings` (294-298).
- **`risk_position_legs`** (PK ends in `asset`, line 366)
  - **Aave only:** `scaled_*`, `live_*`, `*_base`, `weighted_lt`, `used_as_collateral`, index blocks (344-353).
  - **DM only:** `amount`, `value_usd`, `max_borrow_contribution` (356-359).
  - `liq_threshold` and `liq_bonus` are stored raw in each engine's own denominator (361-364).
- **`risk_price_inputs`**: PK includes `source` (424).
- **`risk_batch_aggregates`**: per engine, one `value_decimals`, counts plus `total_collateral` and `total_debt` (443-461). Migration 00014 adds `refusal_code` and `refusal_detail` (`00014:87-89`), then backfills `FLAG_CUSTODY_UNPROVEN` into existing rows WHERE engine = `aave_v3_etherfi` (`00014:125-133`).
- **`risk_batch_watermarks`**: the sweep columns are all-or-nothing, controlled by `sweep_applicable` (207, 209).
- **`risk_scenarios` / `risk_waterfall`** (479-512): created but **deliberately never written** (466-474). Stress results are recomputed when the API serves them, from positions rebuilt out of the persisted rows (`cmd/api/read.go:675`, with engine arms at 250, 745, 909, 1149).
- Migrations 00015 to 00019 add no risk columns.

### 4. What a V4 engine must produce for parity
- **Reuse:** the HF family (`hf_num/hf_den/hf_wad/hf_infinite`), `liquidatable`, the watermarks, a nonzero `sweep_block` (V4 is a swept engine, so `sweep_applicable=true`), the aggregate row, and the per-engine outputs of shortfall and waterfall.
- **Reuse only if the meaning matches:** `total_collateral_base` and `total_debt_base`.
- **Do not reuse** `weighted_lt_sum` or `avg_lt_bps`. V4 weights by collateral factor, so storing it under an LT name breaks the stored-column contract.
- **New position columns:**
  - `avg_collateral_factor`
  - `risk_premium`
  - the chain's own `getUserAccountData` values (chain HF, collateral, debt, average CF) for the weld check
  - a generation id and a block-hash pin
- **New leg columns:**
  - `reserve_id`
  - `dynamic_config_key`
  - share kinds: drawn shares, premium shares, premium offset, realized premium
  - the hub drawn index
  - the collateral factor
- **Leg primary key:** it must be keyed on `reserve_id`, because the current PK on `asset` collides if one underlying is listed under two reserves.
- **Tables:** the per-generation completeness ring needs a table of its own. No such table exists.
- **Rebuilding for stress:** the new columns must be enough for the API to rebuild the V4 input form exactly, since stress is computed from rebuilt inputs.

### 5. Engine switches and default arms that need an explicit V4 arm

**`internal/risk`**
| Location | Current behaviour for an unknown engine |
|---|---|
| `types.go:603-616` `PositionInput.Validate` | refuses with `ErrEngineMismatch` |
| `math.go:312-325` `LiquidationBonusMultiplier` | returns ok=false |
| `liqprice.go:189-229` `weightsFor` | **default arm runs the DM computation** |
| `shortfall.go:147-157` `applyMarketRealization` | no default, so no deep copy is made |
| `shortfall.go:177-228` `shortfallForPosition` | **default arm runs the DM computation** |
| `waterfall.go:323-346` `measurePosition` | **default arm runs the DM computation** |
| `waterfall.go:365-375` `engineDecimalsHint` | returns 0 |
| `waterfall.go:194` | Debt Manager-specific eligibility note |
| `scenario.go:387-390` `Validate` | refuses the engine name |
| `scenario.go:756-790` `ApplyScenario` | **no default: prices come back unshocked while the position still claims a scenario was applied** |
| `aave.go:37-40`, `dm.go:39` | per-engine allowed price-class sets |

**`internal/riskfeed`**
| Location | Current behaviour for an unknown engine |
|---|---|
| `registry.go:70-76` `NewRegistry` | **default `continue`: V4 feeds are silently dropped** |
| `prices.go:114-125` `ProvenanceClass` | errors on an unknown source prefix (a V4 oracle source string needs its own class) |
| `assemble.go:306-309` `AssembleConfig` | fixed `Aave` and `DM` fields |
| `assemble.go:429` | gate G2 loops over `{Aave, DM}` only |
| `assemble.go:445,453` | params folded for Aave and DM only |
| `assemble.go:513,545` | per-engine account loops |
| `assemble.go:1197-1198` `aggregate` | fixed engine order; decimals hard-coded to 8 and 6 |
| `assemble.go:1209-1211` `aggregate` | **positions of an unknown engine are silently skipped** |
| `assemble.go:1476,1501` | per-engine leg-merge functions |
| `identity.go:188` | materialization key binds `{AaveEngine, DMEngine}` only |
| `engine_refusal_test.go:45,65` | closed refusal vocabulary |

### Implications for the V4 design
1. **Must change: scenario keys need an engine.** `responseKey` is chain+asset only, and V4 runs on OP (chain 10) like the Debt Manager. A V4 USDC price would hit the Debt Manager's `stable_snap` row. That either errors (V4 prices are not 6-decimal) or applies a Debt Manager snap the Aave V4 oracle does not have. V4 weETH would inherit the Debt Manager's composition note. Add an engine scope to `AssetResponse` or to `responseKey`.
2. **Must change: the three default arms that run DM math.** `weightsFor`, `shortfallForPosition` and `measurePosition` would all run the DM computation on a V4 position once `Validate` admits it. `ApplyScenario` would silently leave prices unshocked. Replace these with explicit V4 arms and a default that fails.
3. **Must change: the two silent skips in riskfeed.** `registry.go:75` and `assemble.go:1211` drop V4 without any error. `AssembleConfig`, `identity.go:188` and `aggregate`'s decimals must become engine lists. Read the V4 value decimals from the oracle at the pin; do not hard-code them.
4. **Can reuse:** `Rational`, the HF family columns, the strict `< 1e18` verdict pattern, `seizableValue`/`recoverableDebt` (given a V4 bonus arm), the waterfall and shortfall aggregation, the watermarks and the sweep columns.
5. **Do not reuse `AaveHealthFactorWad`, `MulDivCeil`/`Floor` or the V3 rounding laws as they stand.** V4's collateral-factor weighting, premium debt and rounding have to be read from the deployed V4 Spoke source and pinned against `getUserAccountData`, the same way V3 rev 3 was pinned.
6. **Leave the 00014 backfill alone.** It reads collateral-flag absence as truth for V3 only. V4 reads collateral status at the pin, so it should not join that list.