### Task 3: `history-view` and the History page

**Files:**
- Create: `web/lib/history-view.ts`, `web/tests/unit/history-view.spec.ts`, `web/app/observatory/HistorySurface.tsx`, `HistoryTiles.tsx`, `HistoryDrawer.tsx`, `history.module.css`, `web/tests/e2e/history.spec.ts`
- Modify: `web/app/observatory/page.tsx` (title "History"; renders `HistorySurface`)
- Delete: `web/app/observatory/ObservatorySurface.tsx`, `ObservatoryCharts.tsx`, `ObservatoryPointDetail.tsx`, `observatory.module.css`, `web/tests/e2e/observatory.spec.ts` (after re-expression)
- Keep: `web/components/charts/ObservatorySeriesChart.tsx` (the SVG), `web/lib/observatory-series.ts`, `observatory-data.ts`

**Interfaces:**
- Consumes: `buildBucketAxis`, `buildMetricSeries`, `seriesNewestPoint`, `observatoryTakeaway`, `gridReadingLine`, `pointDetailTakeaway`, `describeStride`, `describeRange`, `METRIC_LABELS`, `BucketMetric`, `OBSERVATORY_ENGINES`, `ObservatoryEngine`, `fetchObservatorySeries`, `isRollupUnavailable` (read each signature in `lib/observatory-series.ts` / `observatory-data.ts` first); `humanUsd` (book tier) and `groupInt`; `engineName` (`lib/inspector-headline.ts`); kit `VerdictHeader`, `KpiTile`, `ChartCard`, `SectionHead`, `IdentityChips`, `Drawer`, `StatusPill`.
- Produces:

```ts
// web/lib/history-view.ts
export type HistoryState = "loading" | "degraded" | "unavailable" | "ok";
export interface HistoryTile { readonly key: "debt" | "collateral" | "accounts" | "liquidatable"; readonly label: string; readonly value: string; readonly sub: string; readonly tone: "neutral" | "refused" }
export interface HistoryView {
  readonly state: HistoryState;
  readonly kicker: string;                      // "History · Cash" | "History · Aave v3 market (legacy)"
  readonly headline: LabHeadline;               // emphasis = observatoryTakeaway(...) | the refusal sentence; rest ""; dek = the one-line method
  readonly chips: LabChip[];                    // Engine · Stride · Range · Buckets ("165 captured · 1 withheld · 2 absent")
  readonly tiles: readonly HistoryTile[];       // the four metrics' newest captured points
  readonly finding: string | null;              // gridReadingLine(...) for the selected metric
  readonly doctrine: readonly string[];         // the drawer's paragraphs (verbatim from today's page)
}
export interface HistoryReading { readonly engine: ObservatoryEngine; readonly metric: BucketMetric; readonly phase: "loading" | "ok" | "degraded" | "error"; readonly response: ObservatorySeriesResponse | null; readonly message: string | null }
export function deriveHistoryView(reading: HistoryReading): HistoryView;
```

  Rules inside `deriveHistoryView`: `loading` → refused headline "Loading {engine}'s history…" with no tiles (tiles pending in the surface); `degraded` (rollup unavailable, `isRollupUnavailable`) → state `degraded`, headline refused "The durable rollup for {engine} is unavailable." dek = the wire's message via `sentence()`; `error` → `unavailable`, the message; `ok` → the axis from `buildBucketAxis`, the metric series from `buildMetricSeries`, headline `observatoryTakeaway(...)` (its exact arguments from the module), chips as above (`describeStride`, `describeRange`, the bucket census), tiles from `seriesNewestPoint` per metric (money via `humanUsd(value, decimals)` where the series states its scale — read `ObservatorySeriesResponse` for the scale field and guard it with `isWireScale`; populations via `groupInt` after `isWirePopulation`); a metric whose newest bucket is withheld/absent → `{ value: "—", sub: "withheld" | "no complete batch", tone: "refused" }`. Doctrine = today's intro paragraph and the chart's method notes, verbatim.
- The dek (fixed): "One engine per view; a missing hour is a hole, never a zero."

- [ ] **Step 1: Unit pins** (`history-view.spec.ts`): with `DEMO_OBSERVATORY_DM`: state ok; kicker "History · Cash"; the four tiles equal the Book's Cash aggregates at the newest bucket (`humanUsd`/`groupInt` of the same strings the weld pinned); chips `Buckets` = "165 captured · 1 withheld · 2 absent"; headline emphasis equals `observatoryTakeaway(...)` called directly (so the view and the sentence cannot drift); with a series whose newest bucket is withheld → the debt tile `{ value: "—", tone: "refused", sub: "withheld" }`; degraded → state `degraded`, tone refused, no tiles; loading → tone refused, tiles empty. Run → fails.
- [ ] **Step 2: Implement `history-view.ts`** per the interface. `LabHeadline`, `refused`, `sentence` come from `lib/lab-headline.ts`; `LabChip` from `lib/lab-view.ts`.
- [ ] **Step 3: The page.** `HistorySurface` (client): state `engine` (default `"aave_v3_etherfi"` as today), `metric` (default `"debt_usd"`), the fetch exactly as `EngineSeriesView` does today (keyed remount per engine — keep that comment's law), `deriveHistoryView` → `VerdictHeader` (testId `history-verdict`, kicker, headline, chips, actions = the drawer button `history-drawer`); the engine selector as kit ghost buttons with `aria-pressed` and `history-engine-{engine}`; `HistoryTiles` = four `KpiTile`s (`history-kpi-{key}`, `data-tone`); `ChartCard` (title "How the book moved", finding `view.finding`, testId `history-chart`) wrapping `ObservatorySeriesChart` with the metric selector (`history-metric-{metric}`) and the point detail (`history-point`, its takeaway via `pointDetailTakeaway`) beneath; `HistoryDrawer` = `Drawer` titled "Methodology & evidence" rendering `view.doctrine` (`history-drawer-body`). Root `history-surface` with `data-state`/`data-engine`. `history.module.css`: the grid only — tokens, no literals. Delete the three old files and the old CSS; `page.tsx` title "History".
- [ ] **Step 4: Contract e2e** (`history.spec.ts`, mocks route `**/v1/observatory/series*` by the `engine` query to the demo bodies; `**/v1/meta*` → `DEMO_META`; abort the stream): (1) cold load: `data-state="ok"`, the headline text equals the weld's sentence, chips present, four tiles with the Book's figures; (2) switching the engine remounts and the kicker/tiles change; (3) the withheld bucket renders as a hole (the chart's own hole marker — read `ObservatorySeriesChart` for its test id/attribute) and never a zero; (4) the degraded route (503 `observatory-degraded.json`) → `data-state="degraded"`, refused tone, no tiles; (5) the drawer opens with the doctrine text and closes on Esc; (6) the metric selector changes the finding line. Re-express `observatory.spec.ts`'s 20 pins: for each, keep the law under a new id or retire with its reason in the report's table (the retirement rule of Plan 3 Task 12). Delete `observatory.spec.ts`. Re-express or retire the History pins in `p1a-fixes`, `p1b-fixes`, `r1-fixes` (list them by grep `observatory`).
- [ ] **Step 5: Gates.** unit spec; tsc; eslint; lint:css; production build; `npx playwright test tests/e2e/history.spec.ts tests/e2e/p1a-fixes.spec.ts tests/e2e/p1b-fixes.spec.ts tests/e2e/r1-fixes.spec.ts tests/e2e/shell.spec.ts`.
- [ ] **Step 6: Commit** (two: the lib+pins, then the page+contract): `git commit -m "feat(web): history-view - History's header, tiles and doctrine decided once from the series reading" -- web/lib/history-view.ts web/tests/unit/history-view.spec.ts` then `git commit -m "feat(web): History converges onto the kit - verdict header, the four newest-point tiles, the chart in its card, doctrine in the drawer; the old Observatory components and pins retired" -- web/app/observatory web/tests/e2e/history.spec.ts web/tests/e2e/observatory.spec.ts web/tests/e2e/p1a-fixes.spec.ts web/tests/e2e/p1b-fixes.spec.ts web/tests/e2e/r1-fixes.spec.ts` (drop unchanged paths).

