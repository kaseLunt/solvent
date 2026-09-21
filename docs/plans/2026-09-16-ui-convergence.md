# UI Convergence (History · Activity · Verification · API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the four secondary pages — History (`/observatory`), Activity (`/feed`), Verification (`/proof`), API (`/developers`) — onto the Console kit (shell, verdict header, tiles, cards, table, drawer) with their existing content and data, retire the pre-kit components, add Verification's "Architecture & verification" section, land the deferred debt Plans 2 and 3 carried, and run the spec's QA step (widths, themes, keyboard, contrast, cold-visitor read-through).

**Architecture:** Each page keeps its data loaders and its computed sentences (`observatoryTakeaway`, `feedTakeaway`, `proofTakeaway`, the contract meta) and gains a small pure view model in `web/lib/` (`history-view.ts`, `activity-view.ts`, `verification-view.ts`, `api-view.ts`) that decides the verdict header (kicker · headline · dek · tone · chips), the tiles and the drawer's doctrine once, unit-pinned first. The page components become thin compositions of kit parts; their inline doctrine moves to a "Methodology & evidence" drawer opened from the header. Old components are deleted once no page imports them and the styleguide shows kit specimens in their place. A generated demo dataset for History and Activity welds the screenshot pins to realistic figures; Verification pins on the committed evidence manifest; API is static.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, CSS modules on the token set, `@solvent/client`, Playwright (unit project in node; e2e on the :3111 production build; pixel pins at 1440×900 both themes).

**Spec:** `docs/specs/2026-09-15-ui-product-register-design.md` — §5.5 (converge, don't rebuild), §4 (the kit and what it replaces), §6 (layout), §7 (test policy), §8 (demo dataset), §10 steps 4–5 (convergence, nav, deep links; QA), §11 (acceptance), §12 (out of scope: no IA rebuild of these pages). Carry-forwards: the "Plan 3 (Scenarios) CLOSES" and "Plan 2 CLOSES" entries in `.superpowers/sdd/progress-ui-overhaul.md`.

## Amendments at the gate and the close (2026-09-20 / 21) — this section SUPERSEDES the lines it names

The plan below is kept as written, for the record of what was planned. Where the gate (Task 11), the fix wave and the
last round (Task 12) reversed or extended it, THIS section is the contract. Each amendment is a controller ruling under
the owner's delegation ("go with your best judgement", 2026-09-16); the full reasoning is in the ledger
(`.superpowers/sdd/2026-09-16-ui-convergence/progress.md`) and the two director rulings beside it
(`gate-design-ruling.md`, `gate-clarity-ruling.md`).

**Global Constraints / R1 — the H1.** The H1 is the page's computed HEADLINE (emphasis + rest), not its nav label; the
nav label is the kicker's first word. Kickers: `History · {engine}`, `Activity · all engines` / `Activity · {engine}`,
`Verification · this deployment`, `API · contract v{version}`.

**R2 — headlines and tone (OVERRULED at the gate).** The four pages' sentences keep their FACTS and speak the Book's
grammar: emphasis = one finding in ≤ ~8 words, rest = scope and as-of; human money (`humanUsd`), grouped integers, real
plurals, instants through `humanUtc` (the wire string's own UTC fields, NBSP-joined, never the browser clock) with the
verbatim ISO kept in a chip, tile sub or cell. **A record is ink; only a verdict wears tone:** History, Activity and
API answered arms are `neutral`; every non-answer is `refused`; only Verification's PROOF finding wears tone (`ok` when
the receipt is exact — including an accepted receipt with no servable batch — `warn` otherwise), and the live batch is
said in ink and in the dek. History's finding states DELTAS ("rose by $1.8M, to $27.8M"), one bigint subtraction on one
engine at one scale. Every new fact claim was verified against the code, the contract or the Go source before it was
worded; four ruled sentences were NOT true as written and say what is (an absent hour is "no complete batch was
OBSERVED"; the untimed tail is ordered "by chain and then block number", said only when the loaded rows show it; the API
page's CI claim is limited to what `proof-contract-fidelity.spec.ts` compares; "was not re-checked" became "no check
covers it").

**R3 — deks.** The four doctrine slogans are gone from the deks, which are computed fact sentences (History's dek
counts its holes: "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed —
and 1 was withheld; each is a gap on the chart, never a zero."). The doctrine lives in each page's drawer.

**R4 — tiles and defaults.** History OPENS ON CASH (`HISTORY_ENGINES`, Cash first). Activity's tiles: `Rows loaded`
(sub `more available` / `end of the filtered feed`), `Liquidations` (sub `among the loaded rows`). API's first tile is
`Endpoints` with the verb census as its sub; every tile carries a sub computed from the page's own data.

**R7 — retirements.** `StatusChip` + `chip.module.css`, `ribbon.module.css` and `primitives.module.css` STAY (the
state cards, `DegradationBanner` and `RouteRefusal` compose them). `lib/kit.ts`'s verdict-banner model went only after
its law (no chips → the refusal chip) moved into `headerIdentity`, which `VerdictHeader` calls.

**Out by ruling.** The header `.meta` grid (design B2): it would move the approved Scenarios pins — a header whose
chips wrap under the action is the kit's accepted behaviour. The zero baseline on History's chart stays (an honest,
previously ruled law); a level-anchored domain is specified in the design ruling's appendix for the owner.

### The page-test contract as it stands (supersedes the table's History / Activity / Verification / API rows)

| Page | Surface | `data-state` | `data-variant` | Identity chips (`data-chip`) |
|---|---|---|---|---|
| History `/observatory` | `history-surface` (+ `data-engine`) | `loading · ok · degraded · unavailable` (a series answering for another engine is `unavailable`, chip `Record: wrong engine`) | `neutral · refused` | answered `Engine · Stride · Range · Hours · Served` (`Stride` value `hourly`, its method sentence in `title`; `Hours` value `N recorded · N withheld · N absent`, `N recorded (M with an unreadable figure) · …` in warn); loading `Engine · Hours` (`pending`, no tone); degraded `Engine · Rollup`; unavailable `Engine · Record` |
| Activity `/feed` | `activity-surface` (+ `data-mode`) | `loading · ok · refused · error` | `neutral · refused` | `Scope · View · Order · Newest · Filter echo` (`Rows` retired; `Newest` and `Filter echo` conditional) |
| Verification `/proof` | `verification-surface` (+ `data-receipt` ∈ `exact · empty · drift · failed · none · pending`) | `loading · ok · unavailable` | `ok · warn · refused` | `Proof pin · Live batch · Receipt · Batch key` (`pending`, no tone, while the read is in flight) |
| API `/developers` | `api-surface` | static | `neutral` | `Contract · Base URL · Source` (`Operations` retired; the `api-base-url` strip retired) |

Ids and attributes ADDED since the table was written — History: `history-tiles`, `history-marks` (absent on a window
with no hole), `history-chart-finding`, `history-chart-sparse`, `history-point-{title,takeaway,forensics,rates,
rates-empty,rate-scale,epochs,sweep,batch,mkey}`, `obs-gap-unreadable`, `obs-zero-label`, `obs-ymax-label[data-place=
peak|edge]`, `obs-gap[data-kind]` and `history-marks li[data-mark]` gain `unreadable`, the record's clause spans carry
`data-note=caption|state`. Activity: `activity-{order,tail,drift,retry,foot,end,account,tx,amount,unit,liquidation,
liquidation-note,liquidator,live-state,live-unavailable,live-batch,live-none,live-degraded,types,types-note,
since-apply,since-applied}`; `activity-foot[data-foot=more|end|none]`; `activity-load-more` and `activity-end` are
absent while `data-state="refused"`. Verification: `verification-retry` (only while `unavailable`);
`verification-receipt` absent while `unavailable`; the proof card's and the drawer's row value spans carry `data-tone`;
`verification-kpi-*` are `data-tone="neutral"` + `aria-busy` while in flight. API: `api-error-sample-{name}`.
Elsewhere — Book: `book-section-cash`, `book-bands-note`; the `Coverage` chip can read `withheld`. Overview:
`overview-live-accounts`; `pipeline-{index,compute,verify,serve}` carry `data-tone` (CSS acts on `refused`, `warn`) and,
while a read is in flight, `aria-busy="true"` with `data-value="pending"`. Inspector: the Trust item `reconcile` is
labelled `Pinned reconcile run matched the chain` ONLY when `receiptState` says `exact`, else `Pinned reconcile run`;
its `data-state` gains `pending` ("receipt pending" while `/v1/evidence` is in flight; "receipt unavailable" only after
a failure). Scenarios: see `docs/plans/2026-09-15-ui-scenarios.md` — `lab-surface[data-state]` gains `refused-locally`
and `listing-unreadable`; + `lab-address-fallback`; a selection writes `?scenario=` to the URL, an opened link is never
rewritten. Keyboard: `web/tests/e2e/keyboard.spec.ts` pins the drawer's focus cycle on seven pages, Tab order through
every row link, and the library's Space / Enter. Styleguide: `sg-verdict-neutral`; `sg-table-row-{near-1,small-1,
small-2}`; five tones in the tone loop; real wire codes throughout.

---

## Global Constraints

- Preservation boundary: no backend, API-contract or calculation change; `packages/client-ts` untouched; existing `web/lib/**` loaders and their unit specs stay green (new view models are added beside them).
- Cash and the legacy Aave market are never summed on any surface; the legacy market is labelled legacy wherever named; one engine per chart axis.
- Refusals render honestly: an unknown, refused, withheld, absent or unanswered value never looks like a zero and is never hidden — dashed tile, dimmed row, named pill, counted.
- Result identity on every asynchronous result: the verdict header never renders without its chips (scope · batch · engine · computed/served · config or version).
- Copy grammar §3.5: the headline is one sentence that answers the page's job; the dek is one line of method; doctrine lives in the drawer. Copy lives in `web/lib/**` view models and is never composed in components.
- Wire values pass the guards (`isWireDecimal`, `isWirePopulation`, `isWireScale`, `readWirePopulation`, `wireBigInt`) before arithmetic; floats only for geometry.
- Width contract 1366→1280 · 1440→1280 · 1920→1520 · 2560→1680; no horizontal scroll at 390+; both themes; normal text ≥ 4.5:1; no font below 12px.
- Every page's H1 is its nav label: History · Activity · Verification · API. Routes are unchanged (`/observatory`, `/feed`, `/proof`, `/developers`).
- Test policy §7: page-test contracts by `data-testid`; old pins re-expressed or retired with a one-line ledger note per file; pixel pins at 1440×900 both themes on the demo dataset; `web/lib` unit count does not decrease.
- Process: every commit by pathspec (`git commit -m … -- <paths>`), staged by name, `python roadmap/tools/scope_gate.py` first, no attribution lines, hooks never bypassed; no prettier on `web/lib/**` or `web/tests/**`; comments state the law, never the round or the review.

## Rulings (the controller's, 2026-09-16 21:56 — the owner delegated the gates for this plan: "go with your best judgement")

- **R1 · Names.** H1 = nav label. History's kicker names the engine ("History · Cash" / "History · Aave v3 market (legacy)"); Activity's names the scope ("Activity · cross-engine" / "Activity · {engine}"); Verification's is "Verification · this deployment"; API's is "API · {CONTRACT_META.title} v{version}".
- **R2 · Headlines are the pages' own computed sentences.** History: `observatoryTakeaway(...)`; Activity: `feedTakeaway(rows, mode, hasMore)`; Verification: `proofTakeaway(manifest)`; API: "{N} read-only operations, every money value a decimal string." Tone: `ok` when the page's data answered; `refused` when the data is unavailable / withheld / the rollup degraded; `warn` for Verification when the proof receipt fails or is absent. Emphasis is the whole sentence; `rest` is "".
- **R3 · Doctrine → drawer.** Every inline method paragraph, method-note fold, "two subjects, never one" strip and provenance paragraph moves verbatim into the page's "Methodology & evidence" drawer (`components/Drawer.tsx`, promoted to the kit's exports), opened by a header action button. The dek keeps the one clause the law requires visible (Activity: "The live strip and the paged record never blend."; History: "One engine per view; a missing hour is a hole, never a zero."; Verification: "Two subjects, never one: the pinned proof and the live batch."; API: "If a handler disagrees with this page, that is a failure, not documentation lag.").
- **R4 · Tiles.** History: the four metrics' newest captured points (debt · collateral · accounts · liquidatable positions), each sub = the point's bucket time; a withheld/absent newest bucket is a dashed tile with the gap word. Activity: two tiles — rows loaded (sub: "of the filtered feed" / "end reached") and liquidations in the loaded window (sub: the mode). Verification: the four steps Index · Compute · Verify · Serve as tiles (the Overview's `Pipeline` law, reused), each expanded with one sentence and the reconcile receipt beneath Verify. API: three tiles — operations · error responses · contract version.
- **R5 · Tables → `KitTable`.** Activity's list (FeedList's logic kept: `feedAmount`, `feedTagTone`, `feedRowKey`, the untimed tail), Verification's probe records, API's error envelope. History's point detail stays a card (a detail, not a list).
- **R6 · Charts keep their SVG.** `ObservatorySeriesChart` renders inside a `ChartCard` whose finding line is `gridReadingLine(...)`; the metric selector and the point detail stay.
- **R7 · Retirements.** After convergence nothing imports StatCard, Stampline, Ribbon, EngineChip, RefusedTag, AddressMono, StatusChip, VerdictBanner, DataTable, MarksStamp, ProjectionBadge, SeverityHF, EvidenceDrawer — delete them with their CSS modules (`ribbon.module.css`, `verdict.module.css`, `table.module.css`, `evidence.module.css`, `chip.module.css` if unused); the styleguide's sections for them become kit specimens (VerdictHeader tones, KpiTile variants incl. refused, StatusPill vocabulary, KitTable pattern, IdentityChips). `Drawer`, `ExactValue`, `DegradationBanner`, `RouteRefusal`, `SurfacePlaceholder`, `states/*`, `ThemeToggle` stay.
- **R8 · Contracts.** Test-id prefixes `history-`, `activity-`, `verification-`, `api-` (table below). Every old pin in `observatory.spec.ts`, `feed.spec.ts`, `proof.spec.ts`, `developers.spec.ts` and the secondary-page pins in `p1a-fixes`, `p1b-fixes`, `r1-fixes` is re-expressed against the contract or retired with its reason in the ledger table.
- **R9 · Demo dataset.** `generate-demo-secondary.mjs` produces `observatory-demo-dm.json`, `observatory-demo-aave.json` (7 days hourly at the native stride, two absent hours, one withheld hour, monotone-plausible figures welded to the demo Book's aggregates at the newest bucket) and `events-demo-feed-page-1.json` (50 cross-engine rows newest first, 3 liquidations, 2 untimed rows in the disclosed tail, `next_cursor` set) under the clock law (`checkClocks`); the fixture index exports `DEMO_OBSERVATORY_DM`, `DEMO_OBSERVATORY_AAVE`, `DEMO_FEED_PAGE_1`. Verification pins on `EVIDENCE_MANIFEST`; API is static.
- **R10 · The gate.** Pixel pins for the four pages; the side-by-side (no mockup exists for these pages — the comparison is against the kit's primary pages for register) is judged by the integrator under the owner's delegation and recorded in the ledger with the captures pushed to the companion for the owner's morning review; a "changes first" from the owner later reopens it.
- **R11 · Debt.** Two tasks carry the Plan 2/3 carry-forwards: the lab/engine set (whole-envelope classifier; the hold across malformed answers; the newly tile's tone; the "Compare again failed" sentence into the lib; one verdict judge for the Inspector's stress table and the lab's rows; the kit's `CHAR_W` → `useMonoCharWidth`; the `.chart` max-width clip) and the inspector/book set (the Inspector's negative-room word; `readCashPage` engine before refused; the over-delivery wording; the distance chart's mid-walk qualifier; an empty `waterfall.points`; the resume/stress epoch disclosure).
- **R12 · QA.** Widths at 390/1366/1440/1920/2560 on all eight pages; keyboard operability pinned (Drawer: focus moves in, Tab cycles inside, Esc closes and restores focus; tables: every row link reachable by Tab; the library: checkbox and row reachable); contrast recomputed for any new tint; a cold-visitor read-through by the `solvent-user` persona across the eight pages, its findings fixed in one round.

## Page-test contract (test ids)

| Surface | Root and state | Ids |
|---|---|---|
| History | `history-surface` (`data-state` ∈ `loading · degraded · unavailable · ok`; `data-engine`) | `history-verdict`, `history-kpi-{debt,collateral,accounts,liquidatable}` (`data-tone`), `history-engine-{engine}` (aria-pressed), `history-metric-{metric}`, `history-chart`, `history-point`, `history-drawer` (button) / `history-drawer-body`, chips `[data-chip='Engine'|'Stride'|'Range'|'Buckets']` |
| Activity | `activity-surface` (`data-state` ∈ `loading · ok · refused · error · exhausted`; `data-mode`) | `activity-verdict`, `activity-kpi-{rows,liquidations}`, `activity-live` (the strip), `activity-engine-{all|engine}`, `activity-view-{all,ledger}`, `activity-type-{type}`, `activity-since`, `activity-since-input`, `activity-table`, rows `activity-row-{key}` (`dim` for untimed), `activity-load-more`, `activity-notice`, `activity-refusal`, `activity-restart`, `activity-error`, `activity-drawer` / `activity-drawer-body`, chips `[data-chip='Scope'|'View'|'Order'|'Rows'|'Filter echo']` |
| Verification | `verification-surface` (`data-state` ∈ `loading · unavailable · ok`; `data-receipt` ∈ `exact · drift · failed · none`) | `verification-verdict`, `verification-kpi-{index,compute,verify,serve}`, `verification-architecture` (section) with `verification-step-{index,compute,verify,serve}`, `verification-receipt`, `verification-subject-proof`, `verification-subject-live`, `verification-probes` (table), `verification-raw` (toggle) / `verification-raw-json`, `verification-drawer` / `verification-drawer-body`, chips `[data-chip='Pinned batch'|'Live batch'|'Receipt'|'Key']` |
| API | `api-surface` | `api-verdict`, `api-kpi-{operations,errors,version}`, `api-base-url`, `api-toc`, `api-quickstart`, `api-endpoint-{operationId}`, `api-errors` (table), rows `api-error-{name}`, `api-drawer` / `api-drawer-body`, chips `[data-chip='Contract'|'Operations'|'Base URL'|'Source']` |

Nav ids stay `nav-{label}` as the shell emits them.

## File structure

| File | Responsibility |
|---|---|
| `web/lib/history-view.ts` (new) | `deriveHistoryView(reading)`: header, tiles, chips, drawer doctrine for History from the series reading |
| `web/lib/activity-view.ts` (new) | `deriveActivityView(input)`: header, tiles, chips, table rows, drawer doctrine for Activity |
| `web/lib/verification-view.ts` (new) | `deriveVerificationView(state, meta, book)`: header, the four steps, receipt, subjects, probes rows, doctrine |
| `web/lib/api-view.ts` (new) | `deriveApiView(baseUrl)`: header, tiles, chips, error rows, doctrine from `proof-contract.gen` |
| `web/components/kit/index.ts` | exports `Drawer` (from `../Drawer`) |
| `web/app/observatory/{page,HistorySurface,HistoryTiles,HistoryDrawer}.tsx`, `history.module.css` | the page (old ObservatorySurface/ObservatoryCharts/ObservatoryPointDetail folded; the chart component kept) |
| `web/app/feed/{page,ActivitySurface,ActivityTable,ActivityControls,ActivityDrawer}.tsx`, `FeedLiveStrip.tsx` (kept), `activity.module.css` | the page |
| `web/app/proof/{page,VerificationSurface,VerificationArchitecture,VerificationSubjects,VerificationDrawer}.tsx`, `CopyChip.tsx` (kept), `verification.module.css` | the page |
| `web/app/developers/{page,ApiSurface,ApiDrawer}.tsx`, `EndpointCard.tsx`, `CodeBlock.tsx` (kept, restyled), `api.module.css` | the page |
| `web/tests/fixtures/demo/generate-demo-secondary.mjs`, the three JSON bodies, `index.ts` | the demo dataset (R9) |
| `web/tests/unit/{history-view,activity-view,verification-view,api-view,demo-secondary-weld}.spec.ts` | pure pins |
| `web/tests/e2e/{history,activity,verification,api}.spec.ts` | the contracts (the old four specs deleted; p1a/p1b/r1 pins re-expressed or retired) |
| `web/tests/e2e/screenshots.spec.ts` (+ four baselines) | pixel pins |
| `web/app/styleguide/**` | kit specimens replace the retired components' sections |
| `web/components/{StatCard,Stampline,Ribbon,EngineChip,RefusedTag,AddressMono,StatusChip,VerdictBanner,DataTable,MarksStamp,ProjectionBadge,SeverityHF,EvidenceDrawer}.tsx` + CSS | deleted (R7) |

---

### Task 1: Kit — `Drawer` exported; `DotPlot` measures its columns; the `.chart` clip is the kit's

**Files:**
- Modify: `web/components/kit/index.ts`, `web/components/charts/DotPlot.tsx`, `web/components/kit/kit.module.css`, `web/components/charts/charts.module.css`
- Test: `web/tests/unit/dot-plot-geometry.spec.ts` (new), `web/tests/e2e/lab.spec.ts` (C24's width pin stays green)

**Interfaces:**
- Consumes: `web/lib/useMonoCharWidth.ts` (the kit's LF-8 law: never estimate a mono column; measure one glyph) — read its export name and signature first.
- Produces: `export { Drawer, type DrawerProps } from "../Drawer";` in the kit index; `DotPlot` with `labelW`/`valueW` from the measured glyph width (no `CHAR_W` constant); a `.chart1to1` rule in `charts.module.css` that lets a 1:1 chart's frame scroll (`overflow-x: auto`) instead of `max-width: 100%` clipping — `DotPlot`'s wrapper carries it; the lab's `.plotFrame > svg { max-width: none }` patch is deleted from `lab.module.css` as redundant.

- [ ] **Step 1: Pins.** In `dot-plot-geometry.spec.ts`: export a pure `dotPlotColumns(labels: readonly string[], values: readonly string[], glyphPx: number): { labelW: number; valueW: number }` from `DotPlot.tsx` and pin `dotPlotColumns(["ETH -30 percent", "a"], ["+4.5% · +$1.2M", "<0.1% · +$9,800"], 7)` → `{ labelW: 15*7 + PAD, valueW: 15*7 + PAD }` with `PAD` the file's own constant (read it); and that a longer value widens `valueW` only. Run → fails (no export).
- [ ] **Step 2: Implement.** `DotPlot` calls `useMonoCharWidth()` (the hook's actual name) and passes the measured px into `dotPlotColumns`; remove `CHAR_W`. Add `.chart1to1 { overflow-x: auto; }` and put the class on the plot's frame; delete `.plotFrame > svg { max-width: none }` from `web/app/lab/lab.module.css`. Export `Drawer` from the kit index.
- [ ] **Step 3: Verify.** `npx playwright test --project=unit tests/unit/dot-plot-geometry.spec.ts`; `npx tsc --noEmit`; `npx eslint components lib`; `npm run lint:css`; build and `npx playwright test tests/e2e/lab.spec.ts -g "Compare"` (C24 width pins green).
- [ ] **Step 4: Commit.** `git commit -m "feat(web): kit - Drawer exported, DotPlot measures its columns, a 1:1 chart's frame scrolls instead of clipping" -- web/components/kit/index.ts web/components/charts/DotPlot.tsx web/components/charts/charts.module.css web/app/lab/lab.module.css web/tests/unit/dot-plot-geometry.spec.ts`

### Task 2: Demo dataset for History and Activity (R9)

**Files:**
- Create: `web/tests/fixtures/demo/generate-demo-secondary.mjs`, `web/tests/fixtures/demo/observatory-demo-dm.json`, `observatory-demo-aave.json`, `events-demo-feed-page-1.json`
- Modify: `web/tests/fixtures/demo/index.ts`, `web/tests/unit/fixture-clock-law.spec.ts` (the census), `web/tests/fixtures/demo/generate-demo-lab.mjs` (nothing — read it as the template)
- Test: `web/tests/unit/demo-secondary-weld.spec.ts`

**Interfaces:**
- Consumes: the schemas `ObservatorySeriesResponse` (`api/openapi.yaml`; the minimal fixture `tests/fixtures/observatory-*.json` as the shape witness), `EventsResponse` (the feed page body; `tests/fixtures/feed-cross-page-1.json` as witness), `DEMO_BOOK` (the newest bucket's debt/collateral/accounts per engine equal the Book's aggregates for that engine — the weld), `DEMO_META` (the batch id and the clock witness), `checkClocks` (fixture-clock-law) — read `generate-demo-lab.mjs` for how the clocks are asserted and the census written.
- Produces: `DEMO_OBSERVATORY_DM`, `DEMO_OBSERVATORY_AAVE`, `DEMO_FEED_PAGE_1` exported from `tests/fixtures/demo/index.ts`.

- [ ] **Step 1: Weld pins first** (`demo-secondary-weld.spec.ts`): the newest captured bucket of each series equals the Book's engine aggregate (`debt_usd`, `collateral_usd`, `accounts` as decimal strings/populations); each series has exactly 168 buckets at the native stride with exactly two absent and one withheld bucket (`buildBucketAxis` counts them); the feed page has 50 rows newest first by `block_time` with the disclosed untimed tail of 2 at the end, exactly 3 rows of `type: "liquidation"`, `next_cursor !== null`, every amount a wire decimal for its engine's `value_decimals` (from `DEMO_BOOK`), and `checkClocks` passes over the three bodies. Run → fails (no fixtures).
- [ ] **Step 2: Generator.** Copy `generate-demo-lab.mjs`'s header discipline (provenance comment stating every figure's source; clock trios pinned; the census written). Series: for each engine walk 168 hours back from `DEMO_META`'s witness, debt/collateral drifting ±0.4 %/h around the Book's aggregate and landing exactly on it at the newest bucket; `liquidatable_positions` from the Book's per-engine liquidatable count at the newest bucket, ±1 elsewhere; hours 40 and 41 absent (no point), hour 90 withheld (the point present with `withheld: true` and null figures — read the schema's exact withheld shape). Feed: 50 rows across both engines interleaved newest-first; types drawn from `EVENT_DISPLAY_TYPES`; 3 liquidations with `liquidation` fields per the schema; 2 rows with `block_time: null` placed last; accounts from the demo positions' addresses; amounts in each engine's own units. Write the three bodies; update `index.ts`; update the clock-law census.
- [ ] **Step 3: Verify.** `npx playwright test --project=unit tests/unit/demo-secondary-weld.spec.ts tests/unit/fixture-clock-law.spec.ts`; `npx tsc --noEmit`; `npx eslint tests/fixtures/demo tests/unit`.
- [ ] **Step 4: Commit.** `git commit -m "test(web): demo dataset for History and Activity - hourly series per engine welded to the Book's aggregates with honest holes, one feed page with liquidations and a disclosed untimed tail" -- web/tests/fixtures/demo/generate-demo-secondary.mjs web/tests/fixtures/demo/observatory-demo-dm.json web/tests/fixtures/demo/observatory-demo-aave.json web/tests/fixtures/demo/events-demo-feed-page-1.json web/tests/fixtures/demo/index.ts web/tests/unit/fixture-clock-law.spec.ts web/tests/unit/demo-secondary-weld.spec.ts`

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

### Task 4: `activity-view` and the Activity page

**Files:**
- Create: `web/lib/activity-view.ts`, `web/tests/unit/activity-view.spec.ts`, `web/app/feed/ActivitySurface.tsx`, `ActivityControls.tsx`, `ActivityTable.tsx`, `ActivityDrawer.tsx`, `activity.module.css`, `web/tests/e2e/activity.spec.ts`
- Modify: `web/app/feed/page.tsx` (title "Activity"), `web/app/feed/FeedLiveStrip.tsx` (kit classes; test id `activity-live`)
- Delete: `web/app/feed/FeedSurface.tsx`, `FeedList.tsx`, `feed.module.css`, `web/tests/e2e/feed.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `fetchFeedPage`, `FeedScope`, `feedOrderMode`, `FeedChainEvent`, `EVENT_DISPLAY_TYPES`, `EventDisplayType`, `FEED_ENGINES`, `FeedEngine`, `SINCE_BLOCK_IMPOSSIBILITY` (`lib/feed-data.ts`); `feedAmount`, `feedTagTone`, `feedRowKey`, `renderBps`, `feedTakeaway`, `liquidationEstablished`, `RAW_UNITS_TAG` (`lib/feed-view.ts`); `useCursorPages`, `CursorPage` (`lib/pagination.ts`); `usePosture` (`lib/posture.ts`); `readWirePopulation`; kit `VerdictHeader`, `KpiTile`, `KitTable`, `StatusPill`, `SectionHead`, `Drawer`.
- Produces:

```ts
// web/lib/activity-view.ts
export type ActivityState = "loading" | "ok" | "refused" | "error" | "exhausted";
export interface ActivityInput {
  readonly rows: readonly FeedChainEvent[]; readonly mode: ReturnType<typeof feedOrderMode>; readonly hasMore: boolean; readonly loading: boolean;
  readonly engine: FeedEngine | null; readonly view: "all" | "ledger"; readonly types: readonly EventDisplayType[]; readonly sinceBlock: number | null;
  readonly envelope: { readonly filter: { readonly engine: string | null; readonly types: readonly string[] | null; readonly since_block: number | null }; readonly limit: number } | null;
  readonly refusal: { readonly status: number; readonly code: string | null; readonly message: string } | null; readonly error: string | null;
  readonly valueDecimals: Readonly<Record<string, number>>;
}
export interface ActivityRow { readonly key: string; readonly dim: boolean; readonly when: string; readonly engine: string; readonly type: EventDisplayType; readonly tone: "crit" | "info"; readonly account: string; readonly amount: string; readonly unit: string; readonly tx: string | null }
export interface ActivityView {
  readonly state: ActivityState; readonly kicker: string; readonly headline: LabHeadline; readonly chips: LabChip[];
  readonly tiles: { readonly rows: { value: string; sub: string }; readonly liquidations: { value: string; sub: string } };
  readonly rows: readonly ActivityRow[]; readonly emptyText: string; readonly orderNote: string; readonly doctrine: readonly string[];
}
export function deriveActivityView(input: ActivityInput): ActivityView;
```

  Rules: kicker "Activity · cross-engine" or "Activity · {engineName(engine)}"; headline emphasis `feedTakeaway(rows, mode, hasMore)`, tone `ok` (refused: `refused` with the refusal's own words "Page refused · {code}: {message}"; error: `refused` "Page fetch failed: {message}"); dek "The live strip and the paged record never blend."; chips Scope · View ("all actions" / "liquidations ledger") · Order (`mode`) · Rows (`groupInt(rows.length)`) · Filter echo (today's echo string, `readWirePopulation` on the integers, only when the envelope is present); tiles: rows loaded (sub "end of the filtered feed" when `!hasMore`, else "more available") and liquidations = rows with `type === "liquidation"` (sub `mode`); rows from `FeedList`'s logic: `when` = the block time as today or the block number when null (dim row = the untimed tail); `amount`/`unit` from `feedAmount(event, { decimals: valueDecimals[event.engine] })` (read `FeedAmount`'s union and print each arm as `FeedList` does today; `RAW_UNITS_TAG` when unscaled); `orderNote` = today's two order sentences chosen by `mode`; `emptyText` = today's `empty`/`emptyExhausted` words by state; doctrine = today's intro paragraph, the "History: recorded chain actions" note, the method line and the forensics note, verbatim.

- [ ] **Step 1: Unit pins** with `DEMO_FEED_PAGE_1`: 50 rows, the last two `dim` with `when` = the block number; 3 rows tone crit of type liquidation; the liquidations tile "3"; the rows tile "50" with sub "more available"; headline equals `feedTakeaway(...)`; a refusal input → tone refused and the refusal words; `exhausted` when `!hasMore && rows.length === 0` with the "real answer" sentence. Run → fails.
- [ ] **Step 2: Implement `activity-view.ts`.**
- [ ] **Step 3: The page.** `ActivitySurface` keeps `FeedSurface`'s state machine and hooks verbatim (the `isCurrent` epoch law, `restartWalk`, `switchEngine`'s since-block drop with its notice, `applySinceBlock`) — move them, do not rewrite; then `deriveActivityView(...)` → `VerdictHeader` (`activity-verdict`, drawer button `activity-drawer`), two `KpiTile`s, `FeedLiveStrip` (id `activity-live`), `ActivityControls` (kit ghost buttons with `aria-pressed`, ids per the contract; the since-block input keeps its `inputMode="numeric"` and Enter handling), the notice/refusal/error strips restyled with kit classes (ids `activity-notice`, `activity-refusal` + `activity-restart`, `activity-error`), `ActivityTable` = `KitTable` (columns When · Engine · Type · Account · Amount · Tx; `StatusPill` crit for liquidation, `mono` for account/tx; `dim` rows; `emptyText` from the view), the foot (rows loaded, filter echo chips are in the header now → the foot keeps only `activity-load-more` / "end of the filtered feed"), `ActivityDrawer`. Root `activity-surface` with `data-state`/`data-mode`.
- [ ] **Step 4: Contract e2e** (`activity.spec.ts`; route `**/v1/events*` → `DEMO_FEED_PAGE_1` for the first page and `FEED_CROSS_PAGE_2` for the cursor; `**/v1/stream**` abort or the existing SSE mock the old spec used — read `feed.spec.ts` for how the live strip was fed): cold load ok with 50 rows; the two untimed rows dim and last; the ledger view pins the type to liquidation (3 rows) and the chips say so; a since-block on cross-engine is impossible (the note); switching engines drops the since-block with the notice; a 400 page refusal renders `activity-refusal` and restart works; load more appends and the rows tile counts; the drawer. Re-express `feed.spec.ts`'s 14 pins and the Activity pins in p1a/p1b/r1 (grep `feed`), table in the report; delete `feed.spec.ts`.
- [ ] **Step 5: Gates** as Task 3. **Step 6: Commit** (lib+pins; page+contract) with messages in the same shape as Task 3's.

### Task 5: `verification-view`, the Verification page and its "Architecture & verification" section

**Files:**
- Create: `web/lib/verification-view.ts`, `web/tests/unit/verification-view.spec.ts`, `web/app/proof/VerificationSurface.tsx`, `VerificationArchitecture.tsx`, `VerificationSubjects.tsx`, `VerificationDrawer.tsx`, `verification.module.css`, `web/tests/e2e/verification.spec.ts`
- Modify: `web/app/proof/page.tsx` (title "Verification"), `web/app/overview/Pipeline.tsx` (its four-step law extracted to `lib/verification-view.ts` and re-consumed — the Overview keeps rendering it), `web/app/proof/CopyChip.tsx` (kit classes)
- Delete: `web/app/proof/ProofSurface.tsx`, `proof.module.css`, `web/components/EvidenceDrawer.tsx`, `evidence.module.css`, `web/tests/e2e/proof.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `fetchEvidence`, `ProofFetchError`, `EvidenceDescriptor`, `proofTakeaway` (`lib/proof-data.ts`); the `Pipeline` step derivations (read `app/overview/Pipeline.tsx`: `indexValue`, `verifyValue`, `PUBLIC_ENDPOINTS`, `UNAVAILABLE`) — move their computation into `lib/verification-view.ts` as `pipelineSteps(meta, evidence, book, cashAccounts)` and make `Pipeline.tsx` render from it; `useMetaConstants` / the Overview's meta and book readers for the live numbers; kit `VerdictHeader`, `KpiTile`, `KitTable`, `SectionHead`, `StatusPill`, `Drawer`, `ExactValue`.
- Produces:

```ts
// web/lib/verification-view.ts
export type ReceiptState = "exact" | "drift" | "failed" | "none";
export interface PipelineStep { readonly key: "index" | "compute" | "verify" | "serve"; readonly label: string; readonly value: string; readonly sub: string; readonly tone: "neutral" | "ok" | "warn" | "refused"; readonly sentence: string }
export function pipelineSteps(meta: MetaResponse | null, evidence: EvidenceResponse | null, book: BookResponse | null, cashAccounts: number | null): readonly PipelineStep[]; // the Overview's four numbers, unchanged in law
export interface VerificationView {
  readonly state: "loading" | "unavailable" | "ok"; readonly receipt: ReceiptState;
  readonly kicker: "Verification · this deployment"; readonly headline: LabHeadline; readonly chips: LabChip[];
  readonly steps: readonly PipelineStep[]; readonly receiptLine: string;   // "Reconcile receipt: N gated rows exact, M drift" | the failing/absent words
  readonly probes: readonly { key: string; dim: boolean; cells: Record<string, string> }[]; readonly doctrine: readonly string[];
}
export function deriveVerificationView(input: { state: { phase: "loading" } | { phase: "error"; message: string; retryAfterSeconds: number | null } | { phase: "ok"; manifest: EvidenceResponse }; meta: MetaResponse | null; book: BookResponse | null; cashAccounts: number | null }): VerificationView;
```

  Rules: headline `proofTakeaway(manifest)` (ok), tone `warn` when the receipt is `drift`/`failed`/`none`, `refused` when unavailable ("Evidence unavailable: {message}" + the retry words); dek "Two subjects, never one: the pinned proof and the live batch."; chips Pinned batch · Live batch · Receipt (exact/drift/failed/none with tone) · Key (the manifest's key id, `mono`); `steps` from `pipelineSteps` with each step's one sentence (Index: "Chain heights indexed per engine, ahead of every batch."; Compute: "Batch {id} computed at {cadence}; every position's health from the wire's own integers."; Verify: "{N} gated rows reconciled exact against the chain; {M} drift named."; Serve: "{N} read-only endpoints, every money value a decimal string."); probes rows from `ProbeRecordsCard`'s data (read it — keep its columns and words); doctrine = today's intro, the "two subjects" strip, the stampline's words, verbatim.

- [ ] **Step 1: Unit pins** with `EVIDENCE_MANIFEST`, `DEMO_META`, `DEMO_BOOK`: state ok; receipt `exact` (read the manifest); the Verify step's value equals what the Overview's `Pipeline` prints today for the same inputs (pin `pipelineSteps` against the exact strings the Overview e2e pins already assert — read `tests/e2e/overview.spec.ts` for them); `EVIDENCE_PROOF_FAILED` → receipt `failed`, tone warn; error → unavailable, refused, the retry words; headline equals `proofTakeaway(manifest)`. Run → fails.
- [ ] **Step 2: Implement `verification-view.ts`; refactor `Pipeline.tsx` to render `pipelineSteps(...)` (the Overview's pins must stay green — `overview.spec.ts`).**
- [ ] **Step 3: The page.** `VerificationSurface`: the evidence fetch as today, plus the meta and book readers the Overview uses (import the same hooks); `VerdictHeader` (`verification-verdict`, drawer button); `VerificationArchitecture` (`SectionHead` "Architecture & verification" with the anchor id `architecture` so the Overview's link `/proof#architecture` lands on it — update the Overview's href; four `KpiTile`s `verification-kpi-{key}` then a four-column grid of the step sentences `verification-step-{key}`, then `verification-receipt` line with the receipt tone); `VerificationSubjects` = the two subject cards (`ProofSubjectCard`, `LiveSubjectCard` content moved into two kit-styled cards, ids `verification-subject-proof/live`, their "explain" affordances opening the drawer with the descriptor content the old `EvidenceDrawer` rendered — move that rendering into `VerificationDrawer` as a second drawer section); `KitTable` for the probes (`verification-probes`); the raw JSON toggle (`verification-raw`/`verification-raw-json`); root `verification-surface` with `data-state`/`data-receipt`. Delete the old files.
- [ ] **Step 4: Contract e2e** (`verification.spec.ts`; routes `**/v1/evidence*` → the manifest fixtures, `**/v1/meta*`, `**/v1/book`, `**/v1/positions*` as the Overview's mocks): ok with receipt exact and the four steps' values; the failing proof → `data-receipt="failed"`, warn tone, the receipt line's words; unavailable → refused; the Overview's "Architecture & verification →" link lands on `#architecture`; the drawer opens with the doctrine and a subject's explanation; the raw JSON toggle. Re-express `proof.spec.ts`'s 17 pins and the Verification pins in p1a/p1b/r1 (grep `proof`); delete `proof.spec.ts`.
- [ ] **Step 5: Gates** (+ `tests/e2e/overview.spec.ts`). **Step 6: Commit** (lib+pins incl. `Pipeline.tsx`; page+contract).

### Task 6: `api-view` and the API page

**Files:**
- Create: `web/lib/api-view.ts`, `web/tests/unit/api-view.spec.ts`, `web/app/developers/ApiSurface.tsx`, `ApiDrawer.tsx`, `api.module.css`, `web/tests/e2e/api.spec.ts`
- Modify: `web/app/developers/page.tsx` (title "API"; renders `ApiSurface` — the page stays a server component; the drawer button is a small client island), `EndpointCard.tsx`, `CodeBlock.tsx` (kit classes; ids `api-endpoint-{operationId}`, `api-quickstart`)
- Delete: `web/app/developers/developers.module.css`, `web/tests/e2e/developers.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `CONTRACT_META`, `ERROR_RESPONSES`, `OPERATIONS` (`lib/proof-contract.gen.ts`); `solventBaseUrl`; kit `VerdictHeader`, `KpiTile`, `KitTable`, `SectionHead`, `Drawer`.
- Produces:

```ts
// web/lib/api-view.ts
export interface ApiView {
  readonly kicker: string;            // "API · {title} v{version}"
  readonly headline: LabHeadline;     // emphasis "{N} read-only operations, every money value a decimal string."; dek "If a handler disagrees with this page, that is a failure, not documentation lag."; tone ok
  readonly chips: LabChip[];          // Contract (title · version) · Operations (N) · Base URL (mono) · Source (sourcePath)
  readonly tiles: { operations: string; errors: string; version: string };
  readonly errors: readonly { key: string; cells: { status: string; name: string; description: string } }[];
  readonly doctrine: readonly string[]; // the intro, the base-URL note, the provenance paragraph, verbatim
}
export function deriveApiView(baseUrl: string): ApiView;
```

- [ ] **Step 1: Unit pins**: `deriveApiView("http://x")` → tiles.operations = `String(OPERATIONS.length)`, errors = `String(ERROR_RESPONSES.length)`, version = `CONTRACT_META.version`; chips carry the base URL; the error rows equal `ERROR_RESPONSES` mapped. Run → fails.
- [ ] **Step 2: Implement.** **Step 3: The page**: `VerdictHeader` (`api-verdict`), three tiles, `api-base-url`, the TOC as kit ghost anchors (`api-toc`), `SectionHead` "TypeScript · @solvent/client" + `CodeBlock` (`api-quickstart`), `SectionHead` "Endpoints · N operations, {sourcePath} verbatim" + the `EndpointCard`s, `SectionHead` "Error envelope" + `KitTable` (`api-errors`, rows `api-error-{name}`) with each row's body sample in a `details` beneath the table (keep `CodeBlock` + copy), `ApiDrawer` (client island) with the doctrine. Root `api-surface`.
- [ ] **Step 4: Contract e2e** (`api.spec.ts`, no routes needed): every contract operation renders (`api-endpoint-{id}` count = `OPERATIONS.length` — the old developers.spec:28 law), the quickstart carries the base URL, the error table has `ERROR_RESPONSES.length` rows, the drawer. Re-express `developers.spec.ts`'s 8 pins; delete it.
- [ ] **Step 5: Gates.** **Step 6: Commit** (lib+pins; page+contract).

### Task 7: Retire the pre-kit components; the styleguide shows the kit (R7)

**Files:**
- Delete: `web/components/{StatCard,Stampline,Ribbon,EngineChip,RefusedTag,AddressMono,StatusChip,VerdictBanner,DataTable,MarksStamp,ProjectionBadge,SeverityHF}.tsx`, `web/components/{ribbon,verdict,table,chip}.module.css` (each only if no import remains — `find_referencing_symbols` on every export first)
- Modify: `web/app/styleguide/page.tsx`, `TableSpecimen.tsx`, `PaginationDemo.tsx`, `DrawerDemo.tsx` (kit specimens: VerdictHeader ×4 tones, KpiTile ×5 incl. refused-dashed and pending, StatusPill vocabulary, IdentityChips, KitTable with a dim refused row and a small/dust toggle, Drawer), `web/tests/e2e/p1a-fixes.spec.ts` (the styleguide pins re-expressed against the kit specimens; the contrast-swatch pin `p1a-6` must stay green — the swatches are tokens, not components), `web/tests/e2e/shell.spec.ts` if it names a retired component
- Test: the whole e2e project

- [ ] **Step 1:** `find_referencing_symbols` on each component's export; the only remaining consumers must be the styleguide. **Step 2:** rewrite the styleguide's sections to kit specimens (keep the section order and the page's self-measuring contrast block untouched). **Step 3:** delete the components and CSS; `npx tsc --noEmit`; `npx eslint .`; `npm run lint:css`; build; `npx playwright test --project=e2e`. **Step 4:** commit by pathspec: `git commit -m "refactor(web): the pre-kit components retired - StatCard, Stampline, Ribbon, EngineChip, RefusedTag, AddressMono, StatusChip, VerdictBanner, DataTable, MarksStamp, ProjectionBadge, SeverityHF; the styleguide shows the kit" -- <paths>`.

### Task 8: Cross-page deep links (§10 step 4)

**Files:** `web/app/book/StressPreview.tsx` (or wherever the Book's stress preview links to the Lab — grep `href="/lab`), `web/app/overview/OverviewSurface.tsx` (`/proof#architecture`), `web/tests/e2e/book.spec.ts` / `overview.spec.ts` (pins)

- [ ] **Step 1:** verify each link: Book rows → `/inspector/{addr}` (Plan 1); Inspector → `/lab?address={addr}` (Plan 3); Scenarios rows → `/inspector/{account}` (Plan 3); Book stress preview → `/lab?scenario={id}` for the previewed scenario (if it links to bare `/lab`, add the id); Overview → `/proof#architecture`. **Step 2:** pin each href in the page's spec (one assertion each). **Step 3:** commit `git commit -m "feat(web): cross-page deep links - the Book's stress preview names its scenario, the Overview lands on Verification's architecture section" -- <paths>`.

### Task 9: Debt — the lab and the engine reader (R11, first set)

**Files:** `web/lib/lab-classify.ts`, `lab-engine.ts`, `lab-compare.ts`, `lab-view.ts`, `lab-reading.ts`, `lab-headline.ts`, `lab-library.ts`, `web/app/lab/{LabTiles,CompareCard,LabSurface}.tsx`, `web/lib/address-stress.ts` + `web/app/inspector/[addr]/StressTable.tsx` + `web/lib/lab-address.ts` (one verdict judge), their unit specs, `web/tests/e2e/lab.spec.ts`

- [ ] **(a) Whole-envelope classifier:** `classifyRunBookEnvelope(run)` and `classifySetEnvelope(set)` in `lab-classify.ts` naming a missing/non-object `batch`, `evaluation`, `coverage`, and every non-array list (`engines`, `excluded_engines`, `results`, `requested_scenario_ids`, `withheld_engines`, `unmeasurable_engines`); `readEngine`/`resultBook`/`compareOf` return `unreadable` naming the field instead of throwing. Pins: a 2xx run-book without `batch` → contradictory headline naming `batch`; a set without `evaluation` → failed compare naming it.
- [ ] **(b) The hold across malformed answers:** `withSettled(runs, id, outcome, now, mono, readsAsAnswer)` where `readsAsAnswer` is supplied by `useLabReading` as `(r: LabRunBook) => readEngine(r, CASH, def).kind !== "unreadable" && kind !== "contradictory"`… the hook lacks the definition — RULING: the hook passes `(r) => classifyRunBookEnvelope(r).length === 0 && classifyRunBookEngine(cashEngineOf(r) ?? …)` — read the classifiers and choose the smallest honest predicate: an ok body whose Cash engine row is present and passes `classifyRunBookEngine` with no malformed fields READS; otherwise the previous hold stands. Pin: two consecutive malformed 200s keep the last READING result, and the banner's "The result below stands for batch N" names that batch.
- [ ] **(c)** the newly tile's tone follows the headline's tone for a net ≤ 0 (`LabTiles.tsx`); **(d)** the "Compare again failed" sentence moves to `lab-headline.ts` (`compareRerunFailedLine(failure, batchId)`) and `StaleBanner`'s rerun sentence reuses the same helper shape; **(e)** one verdict judge: `rowVerdict` moves to `web/lib/address-stress.ts` (the row's own module), `lab-address.ts` imports it, the Inspector's `StressTable` prints from it (retire `stressVerdict`), and the negative-figure gate applies on both pages. Pins per item; the lab and Inspector e2e green on a production build.
- [ ] Commit: `git commit -m "fix(web): lab debt - the envelope classified before any read, the hold survives malformed answers, one verdict judge for the Inspector's stress table and the lab's rows, the tile follows the headline's tone, the compare rerun sentence in the lib" -- <paths>`

### Task 10: Debt — the Inspector and the Book (R11, second set)

**Files:** `web/app/inspector/[addr]/StressTable.tsx` (negative room word = the lab's "over cap by $X"), `web/lib/cash-rows.ts` (`readCashPage` judges `page.engine` before `refused`), `web/lib/cash-summary.ts` / `book-headline.ts` (over-delivery wording "delivered N rows for a census of M" not "N of the M rows"), `web/app/book/*` (the distance chart's mid-walk qualifier on both bounds), `web/lib/cash-view.ts` (an empty `waterfall.points` is a refusal "no points published", not absence), `web/lib/address-lookup.ts` + `inspector-view.ts` (a resume repair that refreshes the lookup without the stress discloses "stress from the previous lookup" beside the stress batch chip), their specs.
- [ ] Pins per item; the Inspector/Book e2e green; commit `git commit -m "fix(web): inspector and book debt - ..." -- <paths>`.

### Task 11: Screenshot pins and the gate (R10)

**Files:** `web/tests/e2e/screenshots.spec.ts` (+ `history`, `activity`, `verification`, `api` entries with the demo routes and ready predicates; masks: `[data-chip='Computed']`, the live strip's ticking age `[data-chip='Snapshot']`, the live pill), the four ×2 baselines, `web/scripts/screenshot-pages.mjs` (page keys + routes for the four pages)

- [ ] **Step 1:** entries + routes; `--update-snapshots all -g "history|activity|verification|api"` on the production build; replay green. **Step 2:** captures for the gate (`screenshot-pages.mjs` for the eight pages, both themes) pushed to the companion with a `gate-convergence.html` (the four pages beside the Overview/Book/Inspector/Scenarios captures for register); the integrator judges the composition against the kit's primary pages (R10) and records the verdict, the time, and the delegation in the ledger; the owner's later "changes first" reopens. **Step 3:** commit the pins `git commit -m "test(web): the secondary pages' pixel pins - History, Activity, Verification, API at 1440x900 in both themes" -- <paths>`.

### Task 12: QA (§10 step 5), whole-branch review, Codex round, close

- [ ] **Step 1: Gates.** `npm run typecheck && npm run lint && npm run lint:css && npm run build`; `npx playwright test` (record counts against Plan 3's close: 813 / 200).
- [ ] **Step 2: Widths.** the probe over the eight pages at 390/1366/1440/1920/2560 (the Plan 3 scratch `widths.mjs` shape, pages added); no horizontal scroll; shell steps unchanged.
- [ ] **Step 3: Keyboard operability pins** (`tests/e2e/keyboard.spec.ts`): on each page with a drawer — open by the header button, focus is inside, Tab stays inside, Esc closes and returns focus to the button; on Activity/Verification/API tables — every row link reachable by Tab in order; on Scenarios — the library's checkbox and row button reachable, Space toggles, Enter selects.
- [ ] **Step 4: Contrast.** any new tint or color in the four pages' CSS recomputed as Plan 3 did (tokens only expected → "no new pair").
- [ ] **Step 5: Cold-visitor read-through.** dispatch the `solvent-user` persona over the eight pages on the production build (curl + screenshots); its findings adjudicated; one fix round; re-run the affected pins.
- [ ] **Step 6: Whole-branch review** (package `a941a39..HEAD`, deletions by name, fixture JSON excluded) → one fix round → scoped re-review; **Codex round** on the slim diff (`--diff-filter=AMR`, `web/lib web/app web/components web/tests/unit`) scoped to correctness/honesty (the same laws as Plan 3's brief) → fix wave → re-review.
- [ ] **Step 7: Close.** the close entry in `.superpowers/sdd/progress-ui-overhaul.md` (range, counts, gates, widths, contrast, keyboard, the read-through's outcome, the gate's delegated verdict and time, reviews, Codex, carry-forwards incl. the hosted-API workstream §10.6), the workspace commit as Plan 3's.

---

## Self-review (writing-plans checklist)

**Spec coverage:** §5.5 converge (Tasks 3–6: shell/verdict header/tiles/cards/table adopted; H1 = nav label R1; doctrine → drawer R3; Verification's architecture section Task 5), §4 replacements (Task 7 retires every listed pre-kit part not already gone; `Drawer` kept and exported Task 1), §6 (Task 12 widths; the first viewport pinned Task 11), §7 (contracts Tasks 3–6; retirements with ledger notes; pixel pins Task 11; lib unit count grows), §8 (Task 2 demo dataset with provenance and the clock law), §10.4 (Tasks 3–8 incl. deep links), §10.5 (Task 12), §11 acceptance (each line maps: first viewport — Task 11 pins; materiality — untouched pages already comply; never summed — one engine per History view, Activity names engines per row; refusals — R2/R4 refused registers; identity chips — R2; contrast/no-font-below-12 — Task 12; pins owner-approved — R10's delegation; gates green — Task 12), §12 (no IA rebuild: routes, data and sentences unchanged). Carry-forwards: Tasks 9–10.

**Placeholder scan:** every task names its files, ids, words and pins; the two "read X first" notes name the file and the symbol; Task 9(b)'s predicate is ruled to the smallest honest form and the implementer reads the classifiers to write it — not a TBD.

**Type consistency:** `LabHeadline` (`lab-headline.ts`) and `LabChip` (`lab-view.ts`) are the header/chip types on all four views; `PipelineStep` is produced by `pipelineSteps` and consumed by both `Pipeline.tsx` and `VerificationArchitecture`; the test-id table is the contract Tasks 3–6 emit and Tasks 11–12 pin.
