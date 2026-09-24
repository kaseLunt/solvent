## API events and web structure for `aave_v4_cash`

### (1) Where `/v1/events` rows come from

Rows come from `position_events`, the deriver-written table. They do not come from `raw_logs`, and there is no dedicated feed table.
- The query is `SELECT … FROM position_events e`, with a LEFT JOIN on `block_headers` for `block_time` (internal/store/p5_events.go:340-345). The schema is internal/store/migrations/00002_positions.sql:9-34. The PK is `(chain_id, tx_hash, log_index, seq)`. It leaves out engine on purpose, because one raw log belongs to one engine (00002:26-31).
- DM liquidation seize detail is a second read of `position_events` where `event_type='liquidation_collateral'` (p5_events.go:618-626).

**Vocabulary (store, closed per engine)**
- Display classes: borrow, repay, supply, withdraw, transfer, liquidation, collateral_flag, bad_debt, migration, config (p5_events.go:58-69).
- Delta units: `none`, `dm_normalized_debt`, `aave_scaled`, `opaque` (p5_events.go:90-109).
- Aave V3 map (p5_events.go:125-149):
  - `aave_borrow`, `aave_repay`, `aave_supply`, `aave_withdraw`, `aave_liquidation_call`
  - `aave_deficit_created` → bad_debt
  - `aave_collateral_enabled` / `aave_collateral_disabled` (store/collateralflags.go:52-53)
  - `atoken_balance_transfer`
  - Bookkeeping, filtered out: `aave_reserve_data_updated`, `atoken_mint`, `atoken_burn`, `atoken_transfer`
- DM map (p5_events.go:152-177):
  - `borrow`, `repay`, `liquidation`, `supplied`, `withdraw_borrow_token`, `migration_genesis`, plus 5 config types
  - Bookkeeping: `liquidation_collateral`, `residue_zeroed`
- Registry: `eventDisplayMaps` is keyed only by `aave_v3_etherfi` and `debt_manager` (p5_events.go:202-205, p5_common.go:30-31).
- An unfiltered page defaults to exactly those two engines (p5_events.go:212-214). An unknown engine is an error (p5_events.go:224-226).
- Liquidation detail is filled per engine with only two switch arms (p5_events.go:588-603). A third engine's liquidation rows get no detail.
- A weld test parses `derive/aave.go` and `debtmanager.go` and requires the raw-type sets to match exactly (p5_events_vocab_test.go:163-165).

**Contract bridge (cmd/api/p5_events.go)**
- The contract's feed types are borrow, repay, supply, withdraw, liquidation, deficit_created, collateral_enabled, collateral_disabled (p5_events.go:59-68). Transfer, migration and config are deliberately excluded (p5_events.go:74-79).
- collateral_enabled/disabled map back only from the two Aave V3 raw types (p5_events.go:98-104). Any other raw type in that class returns a loud 500 (p5_events.go:325).
- A row with no account also returns a 500 (p5_events.go:337).
- `parseEngineParam` accepts only `aave_v3_etherfi | debt_manager` (cmd/api/p5_common.go:50-58).
- OpenAPI enums: `/v1/events` engine (api/openapi.yaml:686), `EventDisplayType` (openapi.yaml:4028-4032), `EventAmountUnit` (openapi.yaml:4066-4068).

**What V4 must emit:** a V4 deriver that writes `position_events` rows with `engine='aave_v4_cash'`, non-empty `account`, and raw types for Borrow, Repay, LiquidationCall, ReportDeficit (→ bad_debt) and SetUsingAsCollateral (→ collateral_flag).

### (2) History series

**Per address: `/v1/address/{addr}/history`**
- It reads persisted `risk_positions` points (store/p5_address_history.go:48-64) plus the window's `risk_batch_aggregates` (cmd/api/p5_history.go:268-293).
- The output loop covers only `[AaveEngine, DMEngine]` (p5_history.go:253). A V4 series would be silently dropped.
- Non-Aave engines are treated as DM:
  - The HF note says there is "no health-factor wad" (p5_history.go:194-198).
  - Totals are read from `CollateralValueUSD`/`Borrowings` (p5_history.go:203-209).

**Book level: `/v1/observatory/series`**
- Each request serves one engine, the engine is required, and the enum is closed (p5_observatory_series.go:86-96; openapi.yaml:527).
- `observatory_points` has PK `(bucket_start, engine)` hourly, with `total_debt` in `value_decimals` (migrations/00016_observatory_points.sql:50-116).
- The writer copies every `risk_batch_aggregates` row of the newest complete batch. The join is engine-generic (store/p5_observatory.go:75-113).
- The completeness predicate is also engine-generic, through `b.required_engines` (store/risk.go:1583-1600).

**Can V4 and DM debt totals be drawn side by side? The data is there; the API and the web law are not.**
- Once riskd writes V4 aggregate and watermark rows, V4 points accrue automatically and share hourly `bucket_start` keys with DM.
- It takes two requests, and the scales differ: DM is 6 (p5_common.go:81-84), and V4's is whatever riskd persists.
- There is no backfill: points only begin at the first V4 batch (00016:5-12).
- The web states "one engine per view, never combined onto one axis" (web/lib/history-view.ts:156-157; app/observatory/HistorySurface.tsx:10-12). Side by side would need small multiples or an owner ruling.

### (3) Web: modules that hard-code Cash = `debt_manager`

**Engine ids**
- `lib/inspector-position.ts:16-17` `CASH`/`LEGACY`. Imported by activity-view, lab-view, lab-compare, inspector-view, inspector-headline (lines 50-51, 133), address-lookup, address-stress, feed-view, LabSurface, LegacyResult and InspectorSurface.
- `lib/cash-book.tsx:58-59` has private copies. Its reading has one `cash` (a positions walk sorted by headroom, line 207) and one `legacy` (with the HF histogram) (lines 312-326).
- `lib/prose.ts`: labels at 31-41 (Cash vs "Aave v3 market (legacy)"), `ENGINE_ORDER` at 45, `LEGACY_FOLD_TITLE` = "Legacy · Aave v3 market" at 59.
- `lib/chrome.ts:120` has a second `ENGINE_ORDER`.

**Engine lists and defaults**
- `lib/positions.ts:35` `POSITIONS_ENGINES`, `:44` `DEFAULT_BOOK_ENGINE`, `:525` DM hf-sort remap.
- `lib/feed-data.ts:56` `FEED_ENGINES`.
- `lib/history-view.ts:133` `HISTORY_ENGINES`.
- `lib/observatory-data.ts:25-28`.
- `lib/stress-preview.ts:15`, `lib/cash-view.ts:334`.

**DM semantics baked into Cash**
- The `CashPosition` model is cap/room plus a boolean verdict (inspector-position.ts:19-35).
- `comparatorFor` gives DM "no continuous health factor" (lib/evidence.ts:52-66).
- Also: history-series.ts:119, 333-340, 458; params-format.ts:40-45, 116; liq-distance.ts:138; lab-movers.ts:181-191; MoversTable.tsx:19-20; BookMethodology.tsx:29; verification-view.ts:107-119 (census read from `engines[debt_manager]`).
- `feed-view.ts:337` labels Cash liquidation debt as "USD".
- Activity copy says "Cash and the legacy market run on different chains" (activity-view.ts:354-356). DM and V4 are both on OP (config/contracts.json:8-10).

**One fold only:** `components/kit/LegacyFold.tsx:20` takes a single title and is always placed after all Cash content.

**Page structure**

| Page | Cash slot | Other engines |
|---|---|---|
| Book | `SectionHead "Cash"` + KPIs/charts/NeedsAttention (app/book/BookSurface.tsx:56-61) | one `<BookLegacy>` fold (BookSurface.tsx:129; BookLegacy.tsx:44, `id="legacy"`) |
| Overview | Cash verdict only, via `useCashBook` (OverviewSurface.tsx:42-44, 70) | no fold; Aave is named only in pipeline copy (overview-copy.ts:81) |
| Inspector | Cash content (InspectorSurface.tsx:94); one position picked per engine (inspector-view.ts:194-195) | `LegacyCard` fold (InspectorSurface.tsx:96; LegacyCard.tsx:12) |
| Scenarios | Cash tiles/transitions/movers (LabSurface.tsx:468-470); `cash`/`legacy` fields (lab-view.ts:284-297); `COMPARED_ENGINES=[CASH,LEGACY]` (lab-compare.ts:358) | `LegacyResult` fold (474) and `LegacyCompare` fold (428, 476-477) |
| Activity | cross-engine feed plus engine toggle (ActivitySurface.tsx:97; ActivityControls.tsx:42) | no fold; counts split Cash / legacy / "an engine this page does not name" (activity-view.ts:601-606) |
| History | one engine per view; opens on `HISTORY_ENGINES[0]` = DM (HistorySurface.tsx:63-66) | via the toggle, no fold |
| Verification | the two subjects plus the architecture strip; the engine appears only as the Cash census | none |

### Implications for the V4 design
- **Must change:**
  - Store: `eventDisplayMaps`, the default engines, the liquidation-detail arms and the weld test.
  - API: `parseEngineParam`, the four OpenAPI engine enums (openapi.yaml:143, 527, 686, 811), the collateral switch in `contractDisplayType`, `wireLiquidation`, the engine loop and DM-else branches in p5_history.go (253, 194-209), and `engineValueDecimals`.
  - Web: one shared engine registry replacing `CASH`/`LEGACY`/`ENGINE_ORDER`; `LegacyFold` turned into a list of folds; Cash row, evidence and census semantics made HF-capable.
- **Can reuse:**
  - `position_events` and its feed ordering (V4 and DM are both on OP, so heights compare within the chain).
  - `observatory_points` and the completeness predicate, which are engine-generic.
  - The existing classes borrow, repay, liquidation, bad_debt and collateral_flag, so no new contract display type is needed.
  - Approach B does not fold events, so V4 rows can use Delta nil / `amount_unit: none`. That avoids a new unit and a contract bump.
- **Would break if skipped:**
  - V4 collateral rows would return a 500.
  - V4 rows would be missing from unfiltered feeds.
  - V4 address history would be dropped.
  - Any "Cash" label or verdict wired to DM would put DM figures under V4's name.
  - History's one-engine-per-view rule blocks a combined DM + V4 chart until the owner rules on it.