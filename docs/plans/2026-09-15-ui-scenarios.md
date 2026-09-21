# UI Plan 3 — Scenarios · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/lab` as the Console-register Scenarios page the owner approved in the mockup (`.superpowers/brainstorm/2116-1789507948/content/pages-console.html`, the Scenarios block, lines 267–320): a 300 px scenario library on the left, one result workspace on the right — verdict header, four tiles, the "Where accounts move" transition heatmap, the most-affected accounts, the collapsed legacy result, the Assumptions drawer, a one-address mode on the Inspector's own reading, and (last) the Compare view over the set run — with every shocked figure wearing the PROJECTION pill and nothing dispatched until the reader asks.

**Architecture:** New pure modules in `web/lib/` carry every derivation and are unit-pinned first: `lab-transitions` (the wire's ten HF lanes read under guards and merged, by exact summation, into the room bands the page shows), `lab-headline` (the §3.5 Scenarios templates and the honest extra states), `lab-library` (library rows, inline outcomes, definition skew) with `lab-deep-link` (the existing deep-link law, moved), `lab-movers` (the most-affected table), `lab-address` (the one-address workspace over Plan 2's `InspectorView`), `lab-classify` (the two classifiers, moved verbatim), `lab-compare` (the set run as signed shares of the Cash book), a `useLabReading` hook (listing, run records, set record) and `lab-view` (one view model the surface AND the tests read). The kit gains `ScenarioLibrary`, `Heatmap` and `DotPlot`. `app/lab/` is rewritten as a thin composition; the old Lab's 33 files are deleted and their ~130 e2e pins re-expressed or retired against the new contract. A generated demo run-book welds to the demo Book's own `eth_minus_30` waterfall, so the primary state's figures are the Book's, to the dollar.

**Tech Stack:** Next.js 16 App Router (client components for data; `useSearchParams` behind `Suspense`), TypeScript strict, CSS modules + `tokens.css`, `@solvent/client` (`scenarios()`, `addressStress()`, `lookup()`), the existing `lib/runbook.ts` (`runBookScenario`) and `lib/runbookSet.ts` (`runBookSet`) fetchers, Playwright (unit project for pure logic; e2e against a production build on :3111 with route-mocked fixtures), stylelint's type-token rule.

**Spec:** `docs/specs/2026-09-15-ui-product-register-design.md` — §5.4 Scenarios, §3.5 (the Scenarios headline templates), §3.2 names, §3.3 materiality (display only), §4 kit, §6 layout, §7 test policy, §8 demo dataset, §9 process (mockup CSS is the code; side-by-side gate; screenshot pins; one Codex round per page group).

**Predecessors:** Plan 1 (`docs/plans/2026-09-15-ui-kit-overview-book.md`, landed `b891fe7..d989286`) — the kit, `humanUsd` tiers, `cash-view`'s `ViewChip`, `useMetaConstants`, `useAnchoredAgeSeconds`. Plan 2 (`docs/plans/2026-09-15-ui-inspector.md`, landed `d989286..9aa5f17`) — `AddressField`, `useAddressLookup`/`AddressReading`/`Phase<T>`, `deriveInspectorView`/`InspectorView`, `stressReading`/`StressRow`/`horizonLabel`, `humanUsdFull`, `percent.ts`, `prose.ts` (`joinAnd`, `groupInt`), `inspector-headline.ts` (`engineName`), the honest-UI laws and the review-round lessons (every wire scale through `isWireScale`; a definitive negative never under a loading or failed lookup; comments state the law, never the round).

## Global Constraints

- **Names:** `debt_manager` → **Cash**; `aave_v3_etherfi` → **Aave v3 market (legacy)**, "legacy" wherever it is named; `max_borrow_lt` → **borrow cap**; headroom → **room**. Scenario labels print the committed config's own `label` verbatim (`ETH -30 percent`, never a renamed "ETH −30%"): the config is the law and the page does not rename it. Wire names (`debt_manager`, `eth_usd`, `hf_num/hf_den`) appear only in the drawer, on hover (`title`), and in evidence.
- **A projection is labeled:** every shocked figure sits under a kicker that carries the `StatusPill tone="projection"` PROJECTION pill; every result headline, tile and cell derives from a run-book, set-run or stress response — never from the Book's current figures except where the wire's own `before` side is printed as "today".
- **Engines never summed, never a shared formula:** each `RunBookEngine` / `SetRunEngineSummary` prints in its own `usd_decimals`; Cash leads the workspace; the legacy engine's result is a collapsed `<details>` with the same tile shape; a share is `eligible_debt_delta_usd ÷ total_debt_usd_before` of the SAME engine (the wire's own sanctioned denominator, `SetRunEngineSummary.note`).
- **Runs are actions (R7):** a cold `/lab` dispatches nothing. A run happens on a click, on `?scenario=`, on `?scenarios=` (the existing deep-link law, moved verbatim into `lib/lab-deep-link.ts`), or on the Book's preview link. One run per scenario id in flight at a time; one set run at a time; a click during an in-flight run is ignored and the button is disabled.
- **Result identity (spec §5.4):** every result renders identity chips — Result for batch · Scenario id·version · Computed age (live, anchored by `receiptIdentity(served_at, batch.id)`) · Engines · Config — and a banner when the result is for a previous input (`stale-input`: the listing's definition of that id differs from the result's) or a superseded batch (`superseded`: the wire's own `batch.supersession.superseded`, or the set's `evaluation.freshness !== "still_newest"`). A result is never silently replaced.
- **Refusals render honestly:** a withheld engine (`excluded_engines`), a not-covered engine (the definition's `engines` lacks it), a contradictory engine (`classifyRunBookEngine` / `laneReading` reasons), busy / rate-limited / no-batch / not-served / unreachable / failed outcomes each have their own state word, tiles in the refused register (`—`, dashed), and never a `$0`, `0` or empty heatmap standing for an unknown.
- **Wire guards:** every count through `readWirePopulation` / `isWirePopulation`; every decimal through `isWireDecimal` before `BigInt`; every scale through `isWireScale`; floats only as geometry (heatmap opacity, dot-plot x); nothing printed is a float. `"-0"` IS a legal wire decimal.
- **Copy is pinned:** the §3.5 Scenarios templates and the extra states are produced by `lib/lab-headline.ts` and asserted verbatim in unit and e2e specs.
- **Type:** no font-size below 12px; every `font-size` is exactly `var(--type-*)` — stylelint enforces it. Sans for UI text; mono only for addresses, hashes and exact wire values.
- **`web/lib/**` existing files are untouched.** New files are added beside them. `lib/runbook.ts`, `lib/runbookSet.ts`, `lib/resultIdentity.ts`, `lib/stress-preview.ts` are consumed as they are. `app/lab/**` (33 files) is deleted in Task 12 after the moved modules land as NEW lib files with their content verbatim (`lab-classify.ts` ← `engineClassification.ts` + `setRunClassification.ts`; `lab-deep-link.ts` ← `deepLinkDecision` from `tornadoLines.ts`).
- **Both themes, four widths:** the first viewport at 1440×900 holds the library header and its first rows, the verdict header, the four tiles and the top of the heatmap; below 900 px the library stacks above the workspace; no horizontal scroll at 390 or 1366+.
- **Commands run from `web/`:** `npm run typecheck`, `npm run lint`, `npm run lint:css`, `npm run build`, `npx playwright test --project=unit <spec>`, `npx playwright test --project=e2e <spec>`. The unit project needs an existing `web/.next` build (run `npm run build` once first).
- **E2E runs against a PRODUCTION build on :3111.** `playwright.config.ts` reuses an existing server on :3111, so a stale `next start` serves the OLD build. Before any e2e run: `npm run build`, then make sure nothing is listening on 3111 (`netstat -ano | findstr :3111`; stop that PID) so Playwright starts a fresh `npm run start`.
- **Commits:** from the repo root, stage by name, run `python roadmap/tools/scope_gate.py` (must print `scope-gate: OK`), then commit BY PATHSPEC (`git commit -m "…" -- <paths>`): another agent may have files staged. No `Co-Authored-By` lines, no AI attribution. If the gate reports an expired claim, run `python roadmap/tools/claim.py renew claude-integrator --hours 24` and commit `roadmap/claims/CLAIM-claude-integrator.md` alone first.
- **Fixtures are generated, never hand-shaped:** every new fixture file is written by a generator under `web/tests/fixtures/demo/` whose header records provenance; every stamped body passes `checkClocks` from `tests/fixtures/clock-law.mjs` before it is written; the census in `tests/unit/fixture-clock-law.spec.ts` moves in the same commit.
- **Comments state the law, never the round:** no "review round", "fix round", "Task N" or "r57" in shipped code or test titles.
- **Subagents never dispatch subagents.** Implementers write the report file named in their dispatch and return status only.

## Rulings made while planning

The spec is the authority; where §5.4 is silent, these rulings settle it (R1–R10 were agreed with the owner in the brainstorm; R11–R16 are the planner's, recorded for the reviewer).

- **R1 · Heatmap lanes are the wire's, merged, never re-bucketed.** `hf_transitions` serves ten lanes: eight HF buckets (`< 0.90`, `0.90 – 1.00`, `1.00 – 1.05`, `1.05 – 1.10`, `1.10 – 1.25`, `1.25 – 1.50`, `1.50 – 2.00`, `>= 2.00`), `infinite` (no debt) and `unmeasured`. For Cash, HF = cap ÷ debt so room = 1 − 1/HF, and adjacent lanes SUM (exact integer addition of `rows` and of the cell debts) into seven bands: **over cap** (lanes 0–1) · **< 4.76%** (lane 2) · **4.76–9.09%** (lane 3) · **9.09–20%** (lane 4) · **≥ 20%** (lanes 5–7) · **no debt** (8) · **not measured** (9). Band labels are the TRUE converted bounds computed from the lane wads (`(hf − 1e18) × 10000 ÷ hf` basis points → `4.76%`, `9.09%`, `20%`), never the mockup's `5 / 10 / 25`; the HF bounds ride on hover. If the wire's lanes are not exactly that edge set, nothing merges: the page draws the wire's lanes verbatim with the wire's own labels and says so in the card's finding. Unmeasured stays a visible row and column.
- **R2 · Tiles are wire-direct, per engine.** Newly liquidatable = `newly_eligible_accounts` (sub "was {before.eligible_accounts}"); Liquidatable debt = `eligible_debt_delta_usd` signed (sub "{before.eligible_debt_usd} → {after.eligible_debt_usd}"); Bad debt at liquidation = `bad_debt_delta_usd` signed (sub "{before} → {after}" from `bad_debt_usd` on both sides); Accounts moved = `hf_transitions.lane_changed_rows` (sub "of {measured_rows} measured · {improved} improved", improved counted from outflow cells whose lane rose). A null `lane_changed_rows` prints `—` with "not stated".
- **R3 · Headlines** (`lib/lab-headline.ts`): result with newly > 0 → `{Δ} more Cash debt becomes liquidatable,` + `across {n} accounts.`; newly = 0 and no band changes → `No Cash account changes band under {label}.`; newly = 0 with band changes → `No Cash account becomes liquidatable under {label},` + `but {k} change band.`; not run → `{label}` + `— {k} committed shock(s), not run yet.`; running → `Running {label}…`; withheld → `Cannot say — the Cash book is withheld under {label}.`; not covered → `{label} does not model the Cash book.`; contradictory → `The result for {label} contradicts itself.`; definition changed → `{label} changed since this result was computed.`; the six fetch failures name themselves (Task 3). Money in the Book's tiers (R11). The kicker is `{label} · Cash book` + the PROJECTION pill.
- **R4 · Materiality is display-only here.** The headline and tiles state the wire's own aggregates (per-account eligible debt is not on the wire, so no client re-filter). The $100 line dims most-affected rows whose `debt_usd` is under it (`materialityTier` = `small` | `dust`); they stay counted.
- **R5 · Most affected accounts = `movers`.** One row per mover: account (→ `/inspector/{addr}`), room today → after (Cash: from `hf_before_num/den` and `hf_after_num/den` as `(num − den) ÷ num`; a null side prints `—`), debt (`debt_usd`, `humanUsdFull`, null → `—`), becomes liquidatable (`became_eligible`: true → crit pill "Yes", false → "No", null → refused pill "Cannot say"). The caption states `showing {movers.length} of {movers_total}` and carries `movers_note` verbatim on hover. The legacy card's movers print HF wads.
- **R6 · Compare = `POST /v1/scenarios/run-book-set`.** Per scenario and engine: `eligible_debt_delta_usd ÷ total_debt_usd_before` as signed tenths of a percent of THAT engine's book, absolute beside; a withheld, not-covered, contradictory or zero-denominator scenario is a dashed row with its word, never a dot at zero. Last build task (Task 13), cuttable to a Plan 3b.
- **R7 · Cold load:** the first listed scenario is selected, its definition shown (shocks, path assumption, engines, out-of-model), nothing dispatched. Deep links kept: `?scenario=` runs one, `?scenarios=` runs the set (`deepLinkDecision` law, moved), `?address=` opens one-address mode with that address; both `?scenario=` and `?scenarios=` present → nothing runs, the notice renders. The Inspector's "Stress this address →" retargets to `/lab?address={addr}`.
- **R8 · One-address mode is the Inspector's reading.** The workspace calls Plan 2's `useAddressLookup(addr)` + `deriveInspectorView`, and `lab-address.ts` derives the address workspace from that `InspectorView` (its `stress` rows, its `decimals`, its `cash`): before/after tiles per selected scenario in the Inspector's registers. No second stress reader.
- **R9 · Classifier outcomes survive.** `classifyRunBookEngine` and `classifySetRunEngine` move verbatim (with their unit specs) into `lib/lab-classify.ts`; `readTransitions`'s wire guards become `laneReading`'s contradiction arm; the busy / superseded / definition-changed arms are states of the view.
- **R10 · Legacy and drawer.** The legacy result is a collapsed `<details>` with the same four tiles in its own decimals and its own heatmap (HF-labelled lanes, unmerged: the legacy market's HF is not a room). The drawer holds: path assumption, applied shocks (asset, source, before → after, snapped / base-snapped / cap-bound flags), held-flat inputs, out-of-model list, `scenario_config_version`, the wire's `notes` verbatim, and the exact wire values of the four tiles.
- **R11 · Two money registers.** Book-level figures (headline, tiles, compare, library outcomes) print in the Book's tiers via `humanUsd` (`$1.28M`, `$40.8K`); account-level figures (movers rows, the one-address tiles) print `humanUsdFull`; the drawer prints the exact wire integer at its scale. A signed delta prints `+`/`−` (`MINUS`), never a bare number.
- **R12 · Library rows print the wire.** `label` and `description` verbatim from `/v1/scenarios`; engines as human names; the outcome slot is the run record's word: `Not run yet` · `Running…` · `{±Δ} liquidatable · {n} accounts` (crit) · `No band change` (ok) · `{k} change band` (warn) · `Withheld` · `Not modelled for Cash` · `Busy` · `Rate limited` · `No batch` · `Not served` · `Unreachable` · `Failed {status}`.
- **R13 · Superseded and stale-input are banners on a result, not replacements.** The result keeps its headline; `data-banner` names the condition; the batch chip goes warn with "superseded"; the banner offers "Run again".
- **R14 · Not-run and running use the refused (dashed) emphasis tone** — a definition is not a verdict, and the dashed register is the one that never looks like one.
- **R15 · The one-address mode has no library checkboxes and no Compare**; its rows are the stress response's scenarios (the address may not carry every committed scenario); the selection follows the same `selectedId` as book mode when the id exists in the stress rows, else the first row.
- **R16 · The demo run-book welds to the demo Book's waterfall.** `book.demo.json`'s `waterfall` (`eth_minus_30`) at factor 0.70 says Cash: cumulative eligible 49 → 167 (+118), eligible debt 6,949,455,788 → 1,286,949,455,788 (+1,280,000,000,000 exactly), bad debt 239,603,961 → 41,020,000,000. The generated `run-book-demo-eth_minus_30.json` carries exactly those before/after figures, from_rows = the Book's Cash histogram `[41, 8, 14, 13, 73, 153, 300, 804]` (+ 0 infinite, 6 unmeasured = the batch's refused), and the lane movement table in Task 10 (a −30 % mark scales cap by 0.7; lanes 2–4 all cross the cap, 18 of lane 5 cross, the rest step down): 118 cross, 425 change band, 941 change lane, 0 improve, 27 near-cap today all cross. The weld spec proves every one of those sums.

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `web/lib/lab-transitions.ts` | `laneReading(engine, options)` — the ten wire lanes under guards → `HeatmapView` (merged room bands for Cash, verbatim HF lanes otherwise) or a named contradiction; `roomBoundLabel(wad)` |
| `web/lib/lab-headline.ts` | `LabHeadline`; `resultHeadline`, `notRunHeadline`, `runningHeadline`, `withheldHeadline`, `notCoveredHeadline`, `contradictoryHeadline`, `definitionChangedHeadline`, `failureHeadline`, `LISTING_LOADING`, `listingUnavailableHeadline`, `signedUsd` |
| `web/lib/lab-library.ts` | `LibraryRow`, `libraryRows(listing, records, selectedId, checked)`, `outcomeLine(record, definition)`, `definitionSkew(definition, run)` |
| `web/lib/lab-deep-link.ts` | `deepLinkDecision` and `DeepLinkDecision` moved verbatim from `app/lab/tornadoLines.ts` |
| `web/lib/lab-movers.ts` | `MoversTable`, `moversTable(engine)` — the most-affected rows with materiality tiers |
| `web/lib/lab-address.ts` | `AddressWorkspace`, `addressWorkspace(view, selectedId, address)` over Plan 2's `InspectorView` |
| `web/lib/lab-classify.ts` | `classifyRunBookEngine`, `classifySetRunEngine` moved verbatim |
| `web/lib/lab-compare.ts` | `CompareRow`, `compareRows(set, engine)`, `shareTenths` |
| `web/lib/lab-reading.ts` | `useLabReading(): LabReading` — listing, `RunRecord` per id, `SetRecord`, dispatchers |
| `web/lib/lab-view.ts` | `deriveLabView(reading, ui, constants): LabView` — one view model: library, book workspace (state, banner, headline, chips, engine results), compare |
| `web/components/kit/ScenarioLibrary.tsx` | the `.k-lib` list: header with the mode toggle and an optional address slot, rows with checkboxes and outcome lines, footer actions |
| `web/components/kit/Heatmap.tsx` | the `.k-heat` grid: band labels, cells with count, tone and opacity from geometry, hover debts |
| `web/components/charts/DotPlot.tsx` | signed dot plot on a percent axis (SVG, measured width), dashed rows for refused entries |
| `web/app/lab/LabSurface.tsx` | the composition: `useLabReading`, `useAddressLookup`, `deriveLabView`, deep links, the library and the workspace |
| `web/app/lab/{LabTiles,TransitionCard,MoversTable,LegacyResult,AssumptionsDrawer,AddressWorkspace,CompareCard,StaleBanner}.tsx` | workspace sections |
| `web/app/lab/money.ts` | `bookMoney(decimals)`, `signedBookMoney(decimals)`, `accountMoney(decimals)` — the three registers, every scale guarded |
| `web/tests/unit/{lab-transitions,lab-headline,lab-library,lab-deep-link,lab-movers,lab-address,lab-classify,lab-compare,lab-view,demo-lab-weld}.spec.ts` | pure pins |
| `web/tests/unit/helpers/run-book-engine.ts` | `cashEngine(overrides)`, `legacyEngine(overrides)`, `LANES`, `outflowsOf(table)` — minimal wire-true engines for the unit pins |
| `web/tests/fixtures/demo/generate-demo-lab.mjs` | the Scenarios demo generator (welds to `book.demo.json`'s waterfall and histogram; clock-law checked) |
| `web/tests/fixtures/demo/{scenarios-demo.json,run-book-demo-eth_minus_30.json,run-book-set-demo.json}` | generated bodies |

**Modified**

| Path | Change |
|---|---|
| `web/components/kit/kit.module.css` | `.lib*`, `.heat*` rules (mockup `.k-lib`, `.k-heat`, tokens substituted); `.pillProj` already exists |
| `web/components/charts/charts.module.css` | `.dotPlot*` rules |
| `web/components/kit/index.ts` | export `ScenarioLibrary`, `Heatmap`, re-export `DotPlot` |
| `web/app/lab/page.tsx` | metadata title "Scenarios"; renders `<Suspense><LabSurface /></Suspense>` |
| `web/app/lab/lab.module.css` | rewritten (page-local only) |
| `web/app/inspector/[addr]/InspectorSurface.tsx` | the toolbar's secondary action → `/lab?address={addr}` (R7) |
| `web/app/inspector/[addr]/StressTable.tsx` | the section link → `/lab?address={addr}` |
| `web/tests/fixtures/demo/index.ts` | exports `DEMO_SCENARIOS`, `DEMO_RUN_BOOK_ETH`, `DEMO_RUN_BOOK_SET` |
| `web/tests/unit/fixture-clock-law.spec.ts` | census entries + `CENSUS_TOTAL` |
| `web/tests/e2e/lab.spec.ts` | rewritten: the page-test contract |
| `web/tests/e2e/{screenshots,shell,state-matrix,runbook-bsplit,runbook-transition,tornado,chart-spec-v4,w3l-slots,book-charts,r1-fixes,r10-fixes,inspector}.spec.ts` | pins added / re-expressed / retired per Task 12 |
| `web/scripts/screenshot-pages.mjs` | `lab` page + its routes |
| `.superpowers/sdd/progress-ui-overhaul.md` | retirement ledger lines |

**Retired (deleted in Task 12)**

All of `web/app/lab/` except `page.tsx` and `lab.module.css` (rewritten): `LabBatchStamp, LabBookPanel, LabBoundaryGroup, LabClient, LabFrontier, LabMatrix, LabProjectionView, LabRealization, LabRunBookDetail, LabRunBookTransition, LabScenarioChips, LabScenarioDetail, LabTornado`.tsx and `addressBinding, badDebtRate, engineClassification, flipRanking, frontierScale, frontierView, labDek, labPanelLines, labReadingLines, labRunBookLines, labTransition, labTransitionFlow, matrixCells, moverDumbbells, scenarioLines, setRunClassification, tornadoCells, tornadoLines`.ts; the unit specs bound to them (`address-binding, bad-debt-rate, flip-ranking, frontier-scale, lab-dek, lab-frontier, lab-matrix, lab-panel-lines, lab-runbook-lines, lab-transition, matrix-outcome, mover-dumbbells, scenario-lines, tornado-lines, set-run-outcome`.spec.ts) — `engine-classification.spec.ts` and `set-run-classification.spec.ts` MOVE with their functions (Task 7) and `tornado-lines.spec.ts`'s `deepLinkDecision` block moves to `lab-deep-link.spec.ts` (Task 4). `components/charts/FrontierLedger.tsx` and `WaterfallSteps.tsx` stay if any other page imports them (check with `find_referencing_symbols`; if only the old Lab did, delete them in Task 12 and say so in the ledger).

## Who builds what (spec §9.2, owner's hybrid ruling)

The integrator builds the visual tasks personally: **Task 1** (kit parts), **Task 11** (the page), **Task 14** (screenshot pins + the owner's side-by-side gate), **Task 15** (close). Subagents (`model: fable`, agent type `serena-coder`) build the logic tasks **2–10**, the test-heavy **Task 12**, and **Task 13** (Compare); each gets its brief, the interfaces named in this plan, and a report path. Task reviewers gate every task; the whole-branch review and the Codex round close the plan.

## Test ID contract (the page-test contract's vocabulary)

| Element | `data-testid` | Notes |
|---|---|---|
| Surface root | `lab-surface` | `data-mode` ∈ `book · address`; `data-state` ∈ `listing-loading · listing-unavailable · not-run · running · result · not-covered · withheld · contradictory · definition-changed · not-served · no-batch · rate-limited · unreachable · refused-locally · failed` (book; `busy` is a set-run outcome, never a book state; `refused-locally` is a run whose id is outside the contract's pattern — nothing was sent) or `idle · invalid · loading · unavailable · no-position · withheld · rows` (address); `data-banner` ∈ `stale-input · superseded · rerun-failed · retained-refused` when present (a computed result is never replaced by a failed re-run: it is held under `rerun-failed`, or disclosed as `retained-refused` when its definition changed) |
| Library | `lab-library`, rows `lab-library-row-{id}` (`data-outcome` = the outcome key: `not-run · running · result · withheld · not-covered · failed · definition-changed`), checkbox `lab-library-check-{id}`, mode toggle `lab-mode-book` / `lab-mode-address`, footer `lab-run`, `lab-compare` | from `ScenarioLibrary` |
| Address slot (address mode) | `lab-address`, `-input`, `-inspect`, `-refused` | from `AddressField` |
| Verdict header | `lab-verdict`, `-headline`, `-dek`, `-identity` | chips carry `data-chip="{label}"`; the PROJECTION pill has `data-testid="lab-projection"` |
| Banner | `lab-banner` | `data-kind` ∈ `stale-input · superseded`; "Run again" button `lab-banner-rerun` |
| Tiles | `lab-kpi-{newly,debt,baddebt,moved}` | `data-tone` from `KpiTile` |
| Heatmap card | `lab-transitions`, grid `lab-heatmap`, cells `lab-heatmap-cell-{from}-{to}` (band indexes), finding `lab-transitions-finding` | `data-merged` on the grid |
| Movers | `lab-movers`, rows `lab-movers-row-{addr}`, caption `lab-movers-caption` | rows link to the Inspector |
| Legacy | `lab-legacy` (`<details>`), tiles `lab-legacy-kpi-{newly,debt,baddebt,moved}`, grid `lab-legacy-heatmap` | |
| Drawer | `lab-drawer` (button), `lab-drawer-body` | |
| Address workspace | `lab-address-tiles`, tiles `lab-address-kpi-{debt,cap,room,status}-{before,after}`, table `lab-address-table` | |
| Compare | `lab-compare-card`, state `lab-compare-state` (`data-kind` ∈ `idle · running · ok · failed`), rows `lab-compare-row-{id}` (`data-kind` ∈ `point · refused`), plot `lab-dotplot` | Task 13 |
| Deep-link notice | `lab-deeplink-notice` | |

---
### Task 1: Kit — `ScenarioLibrary`, `Heatmap`, `DotPlot`, the `.k-lib`/`.k-heat` CSS, and the geometry helpers

**Integrator builds this personally** (spec §9.2). The mockup's CSS is the code: `.k-lib` (pages-console.html:278–286) and `.k-heat` (302–309) rules are transcribed with token substitution only.

**Files:**
- Create: `web/lib/lab-geometry.ts`, `web/components/kit/ScenarioLibrary.tsx`, `web/components/kit/Heatmap.tsx`, `web/components/charts/DotPlot.tsx`
- Modify: `web/components/kit/kit.module.css` (append), `web/components/charts/charts.module.css` (append), `web/components/kit/index.ts`
- Test: `web/tests/unit/lab-geometry.spec.ts`

**Interfaces:**
- Consumes: `lib/prose.ts` (`groupInt`), `lib/percent.ts` (`formatTenths`), the kit's `.btn/.btnPrimary/.btnGhost`, `charts.module.css` (`.chart .baseline .axisLabel .valueLabel .dotCrit .dotOk .dotWarn .dotDim .gapTick`).
- Produces: `ScenarioLibrary({ mode, onMode, items: LibraryItem[], onSelect, onCheck, addressSlot?, run, compare, emptyText, footnote?, testId? })`; `LibraryItem { id, label, description, engines, outcome: { key: LibraryOutcomeKey, text, tone: LibraryOutcomeTone }, checked, selected }`; `Heatmap({ bands: HeatBand[], cells: HeatCellView[], rowsLabel, colsLabel, merged, testId?, cellTestIdPrefix? })`; `DotPlot({ rows: DotPlotRow[], width, axisLabel, testId?, rowTestIdPrefix? })`; `heatIntensity(count, max): number`; `dotPlotScale(values, width, pad?): DotPlotScale`.

- [ ] **Step 1: The geometry pins (failing)**

```ts
// web/tests/unit/lab-geometry.spec.ts
// Geometry only: an opacity and an x coordinate. Nothing here is ever printed.
import { expect, test } from "@playwright/test";
import { dotPlotScale, heatIntensity } from "../../lib/lab-geometry";

test("heatIntensity: a share of the largest cell in [0, 1]; an empty, absent or absurd max is 0, never NaN", () => {
  expect(heatIntensity(10, 10)).toBe(1);
  expect(heatIntensity(5, 10)).toBe(0.5);
  expect(heatIntensity(0, 10)).toBe(0);
  expect(heatIntensity(3, 0)).toBe(0);
  expect(heatIntensity(30, 10)).toBe(1);
  expect(heatIntensity(Number.NaN, 10)).toBe(0);
});

test("dotPlotScale: a symmetric domain around zero, the extremes on the pads, an all-null set still has a domain", () => {
  const s = dotPlotScale([46n, -12n, null], 400, 12);
  expect(s.maxAbsTenths).toBe(46n);
  expect(s.zeroX).toBe(200);
  expect(s.x(46n)).toBe(388);
  expect(s.x(-46n)).toBe(12);
  expect(s.x(0n)).toBe(200);
  const empty = dotPlotScale([null, null], 400);
  expect(empty.maxAbsTenths).toBe(10n);
  expect(empty.x(0n)).toBe(empty.zeroX);
  const narrow = dotPlotScale([1n], 10, 12);
  expect(narrow.right).toBeGreaterThan(narrow.left);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-geometry.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-geometry'`.

- [ ] **Step 3: The geometry module**

```ts
// web/lib/lab-geometry.ts
// Geometry for the Scenarios charts. These numbers become an opacity and an x
// coordinate; they are never printed, so floats are allowed here and nowhere else.

/** The cell's share of the largest cell, clamped to [0, 1]; 0 for an empty or unreadable pair. */
export function heatIntensity(count: number, max: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

export interface DotPlotScale {
  /** The domain's half-width in signed tenths of a percent (at least 1.0 %, so a zero sits inside a domain). */
  readonly maxAbsTenths: bigint;
  readonly left: number;
  readonly right: number;
  readonly zeroX: number;
  readonly x: (tenths: bigint) => number;
}

/** A symmetric percent axis: zero in the middle, the largest |value| on either pad. */
export function dotPlotScale(values: readonly (bigint | null)[], width: number, pad = 12): DotPlotScale {
  let maxAbs = 0n;
  for (const v of values) {
    if (v === null) continue;
    const a = v < 0n ? -v : v;
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0n) maxAbs = 10n;
  const left = pad;
  const right = Math.max(pad + 1, width - pad);
  const half = (right - left) / 2;
  const zeroX = left + half;
  const domain = Number(maxAbs);
  return { maxAbsTenths: maxAbs, left, right, zeroX, x: (t) => zeroX + (Number(t) / domain) * half };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-geometry.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: The kit CSS (append to `web/components/kit/kit.module.css`)**

```css
/* .k-lib — the scenario library (mockup pages-console.html:278-286) */
.lib { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; align-self: start; }
.libHead { padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: var(--w-semibold); font-size: var(--type-body); display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--ink); }
.libMode { display: inline-flex; gap: 6px; font-weight: var(--w-medium); font-size: var(--type-small); color: var(--ink-2); }
.libMode button { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.libModeOn { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.libAddress { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.libList { list-style: none; margin: 0; padding: 0; }
.libRow { padding: 11px 14px; border-bottom: 1px solid var(--chip-bg); display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: start; }
.libRowOn { background: var(--panel-2); }
.libCheck { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--accent); }
.libCheckGap { width: 16px; }
.libBody { display: grid; gap: 2px; text-align: left; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; width: 100%; }
.libName { font-size: var(--type-body); font-weight: var(--w-medium); color: var(--ink); }
.libDesc { font-size: var(--type-small); color: var(--ink-2); }
.libEngines { font-size: var(--type-small); color: var(--ink-3); }
.libOutcome { font-size: var(--type-small); margin-top: 2px; color: var(--ink); }
.libCrit { color: var(--crit-text); }
.libWarn { color: var(--warn-text); }
.libOk { color: var(--ok-text); }
.libRefused { color: var(--ink-2); border-bottom: 1px dashed var(--ink-3); width: fit-content; }
.libDim { color: var(--ink-3); }
.libEmpty { padding: 14px; color: var(--ink-2); font-size: var(--type-small); }
.libFoot { padding: 12px 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.libNote { font-size: var(--type-small); color: var(--ink-3); margin: 0; padding: 0 14px 12px; }

/* .k-heat — where accounts move (mockup pages-console.html:302-309). The tint is a ::before layer whose opacity
   is the cell's share of the largest cell (--heat); the count sits above it at full ink. */
.heat { display: grid; gap: 4px; margin-top: 16px; font-size: var(--type-floor); }
.heatCorner { color: var(--ink-3); font-size: var(--type-floor); align-self: end; }
.heatLabel { color: var(--ink-3); display: flex; align-items: center; }
.heatHead { color: var(--ink-3); text-align: center; align-self: end; }
.heatCell { position: relative; overflow: hidden; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--ink); font-variant-numeric: tabular-nums; }
.heatCell::before { content: ""; position: absolute; inset: 0; opacity: calc(0.3 + var(--heat, 0) * 0.7); }
.heatCell > span { position: relative; }
.heatEmpty { background: var(--panel-2); }
.heatHeld::before { background: color-mix(in srgb, var(--ink-3) 30%, transparent); }
.heatWorse::before { background: color-mix(in srgb, var(--crit) 55%, transparent); }
.heatBetter::before { background: color-mix(in srgb, var(--ok) 45%, transparent); }
.heatUnmeasured { border: 1px dashed var(--ink-3); color: var(--ink-2); }
.heatUnmeasured::before { background: none; }
```

And to `web/components/charts/charts.module.css`:

```css
/* DotPlot — Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis. */
.dotPlotRow text { font-size: var(--type-floor); }
.dotPlotTrack { stroke: var(--line); stroke-width: 1; }
```

- [ ] **Step 6: `ScenarioLibrary`**

```tsx
// web/components/kit/ScenarioLibrary.tsx
"use client";

import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";

export interface LibraryItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly engines: string;
  readonly outcome: { readonly key: LibraryOutcomeKey; readonly text: string; readonly tone: LibraryOutcomeTone };
  readonly checked: boolean;
  readonly selected: boolean;
}

export interface ScenarioLibraryProps {
  mode: "book" | "address";
  onMode: (mode: "book" | "address") => void;
  items: readonly LibraryItem[];
  onSelect: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  /** Rendered under the header in one-address mode: the AddressField. */
  addressSlot?: ReactNode;
  run: { label: string; disabled: boolean; onRun: () => void };
  /** Null hides the button (address mode, or Compare not built yet). */
  compare: { label: string; disabled: boolean; onCompare: () => void } | null;
  emptyText: string;
  footnote?: string;
  testId?: string;
}

const OUTCOME_CLASS: Record<LibraryOutcomeTone, string | undefined> = {
  crit: styles.libCrit,
  warn: styles.libWarn,
  ok: styles.libOk,
  refused: styles.libRefused,
  dim: styles.libDim,
};

/** The `.k-lib` list: one row per committed scenario, its last outcome inline, checkboxes for Compare in book mode. */
export function ScenarioLibrary({ mode, onMode, items, onSelect, onCheck, addressSlot, run, compare, emptyText, footnote, testId }: ScenarioLibraryProps) {
  return (
    <aside className={styles.lib} data-testid={testId} data-mode={mode}>
      <div className={styles.libHead}>
        <span>Scenarios</span>
        <span className={styles.libMode} role="group" aria-label="mode">
          <button type="button" className={mode === "book" ? styles.libModeOn : undefined} aria-pressed={mode === "book"} onClick={() => onMode("book")} data-testid="lab-mode-book">
            Whole book
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className={mode === "address" ? styles.libModeOn : undefined} aria-pressed={mode === "address"} onClick={() => onMode("address")} data-testid="lab-mode-address">
            One address
          </button>
        </span>
      </div>
      {addressSlot !== undefined && <div className={styles.libAddress}>{addressSlot}</div>}
      <ul className={styles.libList}>
        {items.length === 0 && <li className={styles.libEmpty}>{emptyText}</li>}
        {items.map((item) => (
          <li
            key={item.id}
            className={`${styles.libRow} ${item.selected ? styles.libRowOn : ""}`}
            data-testid={`lab-library-row-${item.id}`}
            data-outcome={item.outcome.key}
            data-selected={item.selected ? "true" : undefined}
          >
            {mode === "book" ? (
              <input
                type="checkbox"
                className={styles.libCheck}
                checked={item.checked}
                onChange={(event) => onCheck(item.id, event.target.checked)}
                aria-label={`compare ${item.label}`}
                data-testid={`lab-library-check-${item.id}`}
              />
            ) : (
              <span className={styles.libCheckGap} aria-hidden="true" />
            )}
            <button type="button" className={styles.libBody} onClick={() => onSelect(item.id)} aria-pressed={item.selected}>
              <span className={styles.libName}>{item.label}</span>
              <span className={styles.libDesc}>{item.description}</span>
              <span className={styles.libEngines}>{item.engines}</span>
              <span className={`${styles.libOutcome} ${OUTCOME_CLASS[item.outcome.tone] ?? ""}`}>{item.outcome.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.libFoot}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={run.disabled} onClick={run.onRun} data-testid="lab-run">
          {run.label}
        </button>
        {compare !== null && (
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={compare.disabled} onClick={compare.onCompare} data-testid="lab-compare">
            {compare.label}
          </button>
        )}
      </div>
      {footnote !== undefined && <p className={styles.libNote}>{footnote}</p>}
    </aside>
  );
}
```

- [ ] **Step 7: `Heatmap`**

```tsx
// web/components/kit/Heatmap.tsx
import { Fragment, type CSSProperties } from "react";
import { groupInt } from "@/lib/prose";
import styles from "./kit.module.css";

export interface HeatBand {
  readonly key: string;
  readonly label: string;
  readonly title?: string;
}
export type HeatMovement = "held" | "worse" | "better" | "unmeasured";
export interface HeatCellView {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly title: string;
  readonly movement: HeatMovement;
  /** The cell's share of the largest cell — an opacity, never printed. */
  readonly intensity: number;
}
export interface HeatmapProps {
  bands: readonly HeatBand[];
  cells: readonly HeatCellView[];
  rowsLabel: string;
  colsLabel: string;
  merged: boolean;
  testId?: string;
  cellTestIdPrefix?: string;
}

const MOVE_CLASS: Record<HeatMovement, string | undefined> = {
  held: styles.heatHeld,
  worse: styles.heatWorse,
  better: styles.heatBetter,
  unmeasured: styles.heatUnmeasured,
};

/** The `.k-heat` grid: rows are the band today, columns the band after; a cell is a count of accounts. An empty cell stays a cell. */
export function Heatmap({ bands, cells, rowsLabel, colsLabel, merged, testId, cellTestIdPrefix }: HeatmapProps) {
  const byKey = new Map(cells.map((c) => [`${String(c.from)}-${String(c.to)}`, c]));
  const id = (r: number, c: number) => (cellTestIdPrefix === undefined ? undefined : `${cellTestIdPrefix}-${String(r)}-${String(c)}`);
  return (
    <div
      className={styles.heat}
      style={{ gridTemplateColumns: `90px repeat(${String(bands.length)}, 1fr)` }}
      data-testid={testId}
      data-merged={merged ? "true" : "false"}
      role="table"
      aria-label={`${rowsLabel} by ${colsLabel}`}
    >
      <div className={styles.heatCorner} aria-hidden="true">
        {rowsLabel} ↓ · {colsLabel} →
      </div>
      {bands.map((b) => (
        <div key={`h-${b.key}`} className={styles.heatHead} title={b.title} role="columnheader">
          {b.label}
        </div>
      ))}
      {bands.map((row, r) => (
        <Fragment key={`r-${row.key}`}>
          <div className={styles.heatLabel} title={row.title} role="rowheader">
            {row.label}
          </div>
          {bands.map((col, c) => {
            const cell = byKey.get(`${String(r)}-${String(c)}`);
            if (cell === undefined || cell.count === 0) {
              return <div key={col.key} className={`${styles.heatCell} ${styles.heatEmpty}`} data-testid={id(r, c)} data-count="0" role="cell" />;
            }
            return (
              <div
                key={col.key}
                className={`${styles.heatCell} ${MOVE_CLASS[cell.movement] ?? ""}`}
                style={{ "--heat": cell.intensity } as CSSProperties}
                title={cell.title}
                data-testid={id(r, c)}
                data-count={String(cell.count)}
                data-movement={cell.movement}
                role="cell"
              >
                <span>{groupInt(cell.count)}</span>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: `DotPlot`**

```tsx
// web/components/charts/DotPlot.tsx
import { dotPlotScale } from "@/lib/lab-geometry";
import { formatTenths } from "@/lib/percent";
import styles from "./charts.module.css";

export interface DotPlotRow {
  readonly key: string;
  readonly label: string;
  /** Signed tenths of a percent; null draws a dashed track and no dot (a refused, withheld or unmeasurable row). */
  readonly tenths: bigint | null;
  readonly valueText: string;
  readonly note: string | null;
  readonly tone: "crit" | "ok" | "warn" | "refused";
}
export interface DotPlotProps {
  rows: readonly DotPlotRow[];
  width: number;
  axisLabel: string;
  testId?: string;
  rowTestIdPrefix?: string;
}

const ROW_H = 26;
const AXIS_H = 22;
const LABEL_W = 220;
const VALUE_W = 120;
const DOT_CLASS = { crit: styles.dotCrit, ok: styles.dotOk, warn: styles.dotWarn, refused: styles.dotDim } as const;

/** One signed dot per row on a symmetric percent axis; a row without a value is a dashed track that says why. */
export function DotPlot({ rows, width, axisLabel, testId, rowTestIdPrefix }: DotPlotProps) {
  const plotW = Math.max(120, width - LABEL_W - VALUE_W);
  const scale = dotPlotScale(rows.map((r) => r.tenths), plotW);
  const height = rows.length * ROW_H + AXIS_H;
  const edge = formatTenths(scale.maxAbsTenths);
  const px = (x: number) => LABEL_W + x;
  return (
    <svg className={styles.chart} width={width} height={height} role="img" aria-label={axisLabel} data-testid={testId}>
      <line className={styles.baseline} x1={px(scale.zeroX)} x2={px(scale.zeroX)} y1={0} y2={rows.length * ROW_H} />
      {rows.map((row, i) => {
        const y = i * ROW_H + ROW_H / 2;
        const id = rowTestIdPrefix === undefined ? undefined : `${rowTestIdPrefix}-${row.key}`;
        return (
          <g key={row.key} className={styles.dotPlotRow} data-testid={id} data-kind={row.tenths === null ? "refused" : "point"}>
            <text className={styles.axisLabel} x={0} y={y + 4}>
              {row.label}
            </text>
            <line className={styles.dotPlotTrack} x1={px(scale.left)} x2={px(scale.right)} y1={y} y2={y} strokeDasharray={row.tenths === null ? "3 4" : undefined} />
            {row.tenths !== null && (
              <circle className={DOT_CLASS[row.tone]} cx={px(scale.x(row.tenths))} cy={y} r={5}>
                <title>{row.valueText}</title>
              </circle>
            )}
            <text className={styles.valueLabel} x={px(plotW) + 8} y={y + 4}>
              {row.note ?? row.valueText}
            </text>
          </g>
        );
      })}
      <text className={styles.axisLabel} x={px(scale.left)} y={height - 6}>
        −{edge}
      </text>
      <text className={styles.axisLabel} x={px(scale.zeroX) - 4} y={height - 6}>
        0
      </text>
      <text className={styles.axisLabel} x={px(scale.right) - 34} y={height - 6}>
        +{edge}
      </text>
    </svg>
  );
}
```

- [ ] **Step 9: Exports**

Append to `web/components/kit/index.ts`:

```ts
export { ScenarioLibrary, type LibraryItem, type LibraryOutcomeKey, type LibraryOutcomeTone, type ScenarioLibraryProps } from "./ScenarioLibrary";
export { Heatmap, type HeatBand, type HeatCellView, type HeatMovement, type HeatmapProps } from "./Heatmap";
export { DotPlot, type DotPlotProps, type DotPlotRow } from "../charts/DotPlot";
```

- [ ] **Step 10: Gates**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css`
Expected: clean. If stylelint rejects `color-mix(...)`, keep the rule and add the file-level disable it names beside the `.heat*::before` rules with the reason ("the mockup's tints; token-derived"); do not replace the tokens with hex.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-geometry.ts web/tests/unit/lab-geometry.spec.ts web/components/kit/ScenarioLibrary.tsx web/components/kit/Heatmap.tsx web/components/charts/DotPlot.tsx web/components/kit/kit.module.css web/components/charts/charts.module.css web/components/kit/index.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): kit - the scenario library, the transition heatmap and the compare dot plot from the mockup's k-lib and k-heat rules" -- web/lib/lab-geometry.ts web/tests/unit/lab-geometry.spec.ts web/components/kit/ScenarioLibrary.tsx web/components/kit/Heatmap.tsx web/components/charts/DotPlot.tsx web/components/kit/kit.module.css web/components/charts/charts.module.css web/components/kit/index.ts
```

---
### Task 2: `lab-transitions` — the wire's lanes under guards, merged into room bands (R1)

**Files:**
- Create: `web/lib/lab-transitions.ts`, `web/tests/unit/helpers/run-book-engine.ts`
- Test: `web/tests/unit/lab-transitions.spec.ts`

**Interfaces:**
- Consumes: `@solvent/client` `components["schemas"]["RunBookEngine" | "RunBookTransitions" | "RunBookTransitionLane" | "RunBookTransitionCell"]`; `lib/wireGuard.ts` (`isWireDecimal`, `isWirePopulation`, `isWireScale`, `wireBigInt`); `lib/prose.ts` (`groupInt`).
- Produces: `laneReading(engine: RunBookEngine, options: { merge: boolean }): LaneReading`; `roomBoundLabel(wad: bigint): string`; `CONTRACT_LANE_EDGES`; types `RoomBand`, `HeatCell`, `HeatMovement`, `HeatmapView`, `LaneReading`. The helper `cashEngine(table, overrides?)`, `legacyEngine(table, overrides?)`, `lanes()`, `transitionsOf(table, unitDebt?, opts?)`, `MoveTable`.

- [ ] **Step 1: The unit helper — wire-true engines from a movement table**

```ts
// web/tests/unit/helpers/run-book-engine.ts
// Minimal wire-true RunBookEngine bodies for the pure pins. A movement table
// `table[from][to] = rows` becomes the ten-lane transitions; every margin,
// histogram count and total is SUMMED from it so the fixtures cannot disagree
// with themselves. Debts are rows × a unit, so sums are exact.
import type { components } from "@solvent/client";

type Schemas = components["schemas"];
export type Engine = Schemas["RunBookEngine"];
export type Transitions = Schemas["RunBookTransitions"];
export type Lane = Schemas["RunBookTransitionLane"];
export type Cell = Schemas["RunBookTransitionCell"];

export const WAD = 10n ** 18n;
export const EDGES = ["900000000000000000", "1000000000000000000", "1050000000000000000", "1100000000000000000", "1250000000000000000", "1500000000000000000", "2000000000000000000"] as const;
export const LABELS = ["< 0.90", "0.90 – 1.00", "1.00 – 1.05", "1.05 – 1.10", "1.10 – 1.25", "1.25 – 1.50", "1.50 – 2.00", ">= 2.00"] as const;
export const INFINITE = 8;
export const UNMEASURED = 9;

export function lanes(): Lane[] {
  const buckets: Lane[] = LABELS.map((label, i) => ({
    index: i,
    kind: "bucket",
    label,
    lower_wad: i === 0 ? null : EDGES[i - 1] ?? null,
    upper_wad: i === LABELS.length - 1 ? null : EDGES[i] ?? null,
  }));
  return [
    ...buckets,
    { index: INFINITE, kind: "infinite", label: "no debt (unbounded)", lower_wad: null, upper_wad: null },
    { index: UNMEASURED, kind: "unmeasured", label: "not measured", lower_wad: null, upper_wad: null },
  ];
}

/** `table[from][to] = rows`. An unmeasured row is `table[9][9]`. */
export type MoveTable = Readonly<Record<number, Readonly<Record<number, number>>>>;

export interface TransitionOptions {
  readonly held?: number | null;
  readonly laneChanged?: number | null;
  readonly comparator?: "hf_wad" | "hf_num/hf_den";
  readonly unitDebt?: bigint;
}

export function transitionsOf(table: MoveTable, opts: TransitionOptions = {}): Transitions {
  const L = lanes();
  const unit = opts.unitDebt ?? 1_000_000n;
  const from_rows = L.map(() => 0);
  const to_rows = L.map(() => 0);
  const outflows = L.map((lane) => ({ from: lane.index, cells: [] as Cell[] }));
  let held = 0;
  let changed = 0;
  for (const [f, row] of Object.entries(table)) {
    for (const [t, rows] of Object.entries(row)) {
      const fi = Number(f);
      const ti = Number(t);
      from_rows[fi] = (from_rows[fi] ?? 0) + rows;
      to_rows[ti] = (to_rows[ti] ?? 0) + rows;
      outflows[fi]?.cells.push({ to: ti, rows, debt_before_usd: String(BigInt(rows) * unit), debt_after_usd: String(BigInt(rows) * unit) });
      if (fi !== UNMEASURED && ti !== UNMEASURED) {
        if (fi === ti) held += rows;
        else changed += rows;
      }
    }
  }
  const total = from_rows.reduce((a, b) => a + b, 0);
  const unmeasured = from_rows[UNMEASURED] ?? 0;
  return {
    comparator: opts.comparator ?? "hf_num/hf_den",
    wad_scale: WAD.toString(),
    lanes: L,
    outflows,
    from_rows,
    to_rows,
    total_rows: total,
    measured_rows: total - unmeasured,
    unmeasured_rows: unmeasured,
    unmeasured_refused_in_batch_rows: unmeasured,
    unmeasured_excluded_by_this_layer_rows: 0,
    held_rows: opts.held === undefined ? held : opts.held,
    lane_changed_rows: opts.laneChanged === undefined ? changed : opts.laneChanged,
    note: "helper: every margin is summed from the table",
  };
}

function histogram(from_rows: readonly number[], comparator: Transitions["comparator"]): Schemas["RunBookAggregate"]["hf_histogram"] {
  return {
    comparator,
    wad_scale: WAD.toString(),
    buckets: LABELS.map((label, i) => ({
      label,
      lower_wad: i === 0 ? null : EDGES[i - 1] ?? null,
      upper_wad: i === LABELS.length - 1 ? null : EDGES[i] ?? null,
      count: from_rows[i] ?? 0,
    })),
  };
}

function aggregate(rows: readonly number[], comparator: Transitions["comparator"], eligibleDebt: bigint, badDebt: bigint): Schemas["RunBookAggregate"] {
  const accounts = rows.slice(0, INFINITE + 1).reduce((a, b) => a + b, 0);
  return {
    accounts,
    eligible_accounts: (rows[0] ?? 0) + (rows[1] ?? 0),
    total_collateral_usd: String(BigInt(accounts) * 3_000_000n),
    total_debt_usd: String(BigInt(accounts) * 1_000_000n),
    eligible_debt_usd: eligibleDebt.toString(),
    collateral_at_risk_usd: "0",
    bad_debt_usd: badDebt.toString(),
    hf_histogram: histogram(rows, comparator),
    collateral_by_asset: [],
  };
}

function engineOf(engine: string, decimals: number, comparator: Transitions["comparator"], table: MoveTable, overrides: Partial<Engine>): Engine {
  const t = transitionsOf(table, { comparator });
  const crossed = t.outflows.reduce(
    (n, o) => n + (o.from >= 2 && o.from <= LABELS.length - 1 ? o.cells.filter((c) => c.to <= 1).reduce((m, c) => m + c.rows, 0) : 0),
    0,
  );
  const before = aggregate(t.from_rows, comparator, 1_000_000n * BigInt((t.from_rows[0] ?? 0) + (t.from_rows[1] ?? 0)), 0n);
  const after = aggregate(t.to_rows, comparator, 1_000_000n * BigInt((t.to_rows[0] ?? 0) + (t.to_rows[1] ?? 0)), 500_000n * BigInt(crossed));
  return {
    engine,
    usd_decimals: decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: crossed,
    eligible_debt_delta_usd: (BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)).toString(),
    bad_debt_delta_usd: (BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)).toString(),
    movers: [],
    movers_total: 0,
    movers_note: "",
    market_realization: null,
    projection: null,
    note: "helper",
    ...overrides,
  };
}

export const cashEngine = (table: MoveTable, overrides: Partial<Engine> = {}): Engine => engineOf("debt_manager", 6, "hf_num/hf_den", table, overrides);
export const legacyEngine = (table: MoveTable, overrides: Partial<Engine> = {}): Engine => engineOf("aave_v3_etherfi", 8, "hf_wad", table, overrides);

/** The demo's Cash movement table (plan R16): a −30 % mark scales cap by 0.7. */
export const DEMO_CASH_TABLE: MoveTable = {
  0: { 0: 41 },
  1: { 0: 8 },
  2: { 0: 14 },
  3: { 0: 13 },
  4: { 0: 73 },
  5: { 0: 6, 1: 12, 2: 135 },
  6: { 3: 43, 4: 129, 5: 128 },
  7: { 5: 60, 6: 320, 7: 424 },
  9: { 9: 6 },
};
```

- [ ] **Step 2: The pins (failing)**

```ts
// web/tests/unit/lab-transitions.spec.ts
// The transition heatmap's law: the wire's ten lanes, read under the guards,
// merged by exact summation into the room bands the page shows; anything the
// wire contradicts is a named refusal, never a drawn grid.
import { expect, test } from "@playwright/test";
import { CONTRACT_LANE_EDGES, laneReading, roomBoundLabel } from "../../lib/lab-transitions";
import { cashEngine, DEMO_CASH_TABLE, EDGES, legacyEngine, transitionsOf } from "./helpers/run-book-engine";

const ok = (r: ReturnType<typeof laneReading>) => {
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.reasons.join("; ")}`);
  return r.view;
};
const contradictory = (r: ReturnType<typeof laneReading>) => {
  if (r.kind !== "contradictory") throw new Error("expected contradictory");
  return r.reasons;
};

test("roomBoundLabel: the exact room a health-factor edge means, in basis points, trailing zeros dropped", () => {
  expect(roomBoundLabel(BigInt(EDGES[2]))).toBe("4.76%");
  expect(roomBoundLabel(BigInt(EDGES[3]))).toBe("9.09%");
  expect(roomBoundLabel(BigInt(EDGES[4]))).toBe("20%");
  expect(roomBoundLabel(BigInt(EDGES[5]))).toBe("33.33%");
  expect(roomBoundLabel(BigInt(EDGES[6]))).toBe("50%");
  expect(roomBoundLabel(BigInt(EDGES[1]))).toBe("0%");
  expect(CONTRACT_LANE_EDGES.map(String)).toEqual([...EDGES]);
});

test("the demo table merges into seven room bands with the true converted labels, and every count is a sum of the wire's cells", () => {
  const v = ok(laneReading(cashEngine(DEMO_CASH_TABLE), { merge: true }));
  expect(v.merged).toBe(true);
  expect(v.bands.map((b) => b.label)).toEqual(["over cap", "< 4.76%", "4.76% – 9.09%", "9.09% – 20%", "≥ 20%", "no debt", "not measured"]);
  expect(v.bands[0]?.lanes).toEqual([0, 1]);
  expect(v.bands[4]?.lanes).toEqual([5, 6, 7]);
  expect(v.totalRows).toBe(1412);
  expect(v.measuredRows).toBe(1406);
  expect(v.unmeasuredRows).toBe(6);
  expect(v.laneChangedRows).toBe(941);
  expect(v.heldRows).toBe(465);
  expect(v.crossedCap).toBe(118);
  expect(v.bandChanged).toBe(425);
  expect(v.improved).toBe(0);
  expect(v.nearToday).toBe(27);
  expect(v.nearCrossed).toBe(27);
  expect(v.nearLabel).toBe("9.09%");
  const cell = (from: number, to: number) => v.cells.find((c) => c.from === from && c.to === to);
  expect(cell(0, 0)?.rows).toBe(49); // lanes 0 and 1 both land in "over cap": 41 held + 8 from lane 1
  expect(cell(0, 0)?.movement).toBe("held");
  expect(cell(1, 0)?.rows).toBe(14);
  expect(cell(1, 0)?.movement).toBe("worse");
  expect(cell(4, 0)?.rows).toBe(18);
  expect(cell(4, 1)?.rows).toBe(135);
  expect(cell(4, 4)?.rows).toBe(128 + 60 + 320 + 424);
  expect(cell(6, 6)?.rows).toBe(6);
  expect(cell(6, 6)?.movement).toBe("unmeasured");
  expect(cell(4, 0)?.debtBefore).toBe(18_000_000n);
  expect(v.maxRows).toBe(932);
  expect(v.cells.every((c) => c.rows > 0)).toBe(true);
});

test("a lane that rises is counted improved and drawn better; a lane change inside one band is a lane change but not a band change", () => {
  const v = ok(laneReading(cashEngine({ 2: { 3: 5, 2: 10 }, 6: { 7: 4, 6: 1 }, 1: { 0: 3 } }), { merge: true }));
  expect(v.improved).toBe(9);
  expect(v.laneChangedRows).toBe(12);
  expect(v.bandChanged).toBe(5);
  expect(v.cells.find((c) => c.from === 1 && c.to === 2)?.movement).toBe("better");
  expect(v.cells.find((c) => c.from === 4 && c.to === 4)?.movement).toBe("held");
  expect(v.cells.find((c) => c.from === 0 && c.to === 0)?.movement).toBe("held");
});

test("the legacy engine is never merged: the wire's own eight bucket labels plus no debt and not measured, HF vocabulary", () => {
  const v = ok(laneReading(legacyEngine({ 5: { 3: 2 }, 7: { 7: 1 } }), { merge: false }));
  expect(v.merged).toBe(false);
  expect(v.bands).toHaveLength(10);
  expect(v.bands.map((b) => b.label)).toEqual(["< 0.90", "0.90 – 1.00", "1.00 – 1.05", "1.05 – 1.10", "1.10 – 1.25", "1.25 – 1.50", "1.50 – 2.00", ">= 2.00", "no debt (unbounded)", "not measured"]);
  expect(v.nearLabel).toBeNull();
  expect(v.cells.find((c) => c.from === 5 && c.to === 3)?.movement).toBe("worse");
});

test("edges that are not the contract's do not merge: the wire's lanes render verbatim and the view says so", () => {
  const engine = cashEngine({ 2: { 2: 1 } });
  const lanesShifted = engine.hf_transitions.lanes.map((l) => (l.index === 2 ? { ...l, upper_wad: "1060000000000000000" } : l.index === 3 ? { ...l, lower_wad: "1060000000000000000" } : l));
  const buckets = engine.before.hf_histogram.buckets.map((b, i) => (i === 2 ? { ...b, upper_wad: "1060000000000000000" } : i === 3 ? { ...b, lower_wad: "1060000000000000000" } : b));
  const shifted = {
    ...engine,
    hf_transitions: { ...engine.hf_transitions, lanes: lanesShifted },
    before: { ...engine.before, hf_histogram: { ...engine.before.hf_histogram, buckets } },
  };
  const v = ok(laneReading(shifted, { merge: true }));
  expect(v.merged).toBe(false);
  expect(v.bands).toHaveLength(10);
  expect(v.bands[2]?.label).toBe("1.00 – 1.05");
});

test("every wire contradiction is named, and a contradicted matrix is never a view", () => {
  const base = cashEngine({ 2: { 0: 3, 2: 2 }, 9: { 9: 1 } });
  const t = base.hf_transitions;
  const withT = (patch: Partial<typeof t>) => laneReading({ ...base, hf_transitions: { ...t, ...patch } }, { merge: true });
  expect(contradictory(withT({ lanes: t.lanes.slice(0, 9) })).join(" ")).toContain("lanes");
  expect(contradictory(withT({ from_rows: t.from_rows.slice(0, 9) })).join(" ")).toContain("same length");
  expect(contradictory(withT({ comparator: "hf_wad" })).join(" ")).toContain("comparator");
  expect(contradictory(withT({ wad_scale: "0x10" })).join(" ")).toContain("wad_scale");
  expect(contradictory(withT({ total_rows: 7 })).join(" ")).toContain("total_rows");
  expect(contradictory(withT({ to_rows: t.to_rows.map((n, i) => (i === 0 ? n + 1 : n)) })).join(" ")).toContain("to_rows");
  expect(contradictory(withT({ held_rows: 1, lane_changed_rows: 1 })).join(" ")).toContain("held_rows");
  expect(contradictory(withT({ measured_rows: 4 })).join(" ")).toContain("measured_rows");
  const badCell = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: o.cells.map((c) => (c.to === 0 ? { ...c, debt_before_usd: "1e6" } : c)) } : o));
  expect(contradictory(withT({ outflows: badCell })).join(" ")).toContain("outflows[2].cells[0].debt_before_usd");
  const outOfRange = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: [{ ...o.cells[0]!, to: 12 }, ...o.cells.slice(1)] } : o));
  expect(contradictory(withT({ outflows: outOfRange })).join(" ")).toContain("to 12");
  expect(contradictory(laneReading({ ...base, usd_decimals: -1 }, { merge: true })).join(" ")).toContain("usd_decimals");
  const fractional = transitionsOf({ 2: { 2: 1.5 } });
  expect(contradictory(laneReading({ ...base, hf_transitions: fractional }, { merge: true })).join(" ")).toContain("rows");
});

test("null held/lane-changed tallies are carried as null, not zero, and the view still draws", () => {
  const v = ok(laneReading(cashEngine({ 2: { 2: 3 } }, { hf_transitions: transitionsOf({ 2: { 2: 3 } }, { held: null, laneChanged: null }) }), { merge: true }));
  expect(v.heldRows).toBeNull();
  expect(v.laneChangedRows).toBeNull();
  expect(v.bandChanged).toBe(0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-transitions'`.

- [ ] **Step 4: The module**

```ts
// web/lib/lab-transitions.ts
// The transition heatmap's model. The wire serves `hf_transitions`: ten lanes
// (eight health-factor buckets, no-debt, not-measured), one outflow list per
// lane, and margins. This module reads it under the wire guards, refuses a
// matrix that contradicts itself by name, and — for the Cash engine, whose
// health factor is cap ÷ debt so room = 1 − 1/HF — merges adjacent lanes by
// exact summation into the room bands the page draws. Nothing is re-bucketed:
// a merged cell is the sum of the wire's cells, and its label is the true
// converted bound of the wire's own edge.
import type { components } from "@solvent/client";
import { isWireDecimal, isWirePopulation, isWireScale, wireBigInt } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookTransitions = Schemas["RunBookTransitions"];
export type TransitionLane = Schemas["RunBookTransitionLane"];

const WAD = 10n ** 18n;

/** The contract's bucket edges: 0.90 · 1.00 · 1.05 · 1.10 · 1.25 · 1.50 · 2.00. Merging happens only when the wire's buckets are exactly these. */
export const CONTRACT_LANE_EDGES: readonly bigint[] = [
  900_000_000_000_000_000n,
  1_000_000_000_000_000_000n,
  1_050_000_000_000_000_000n,
  1_100_000_000_000_000_000n,
  1_250_000_000_000_000_000n,
  1_500_000_000_000_000_000n,
  2_000_000_000_000_000_000n,
];

export interface RoomBand {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly lanes: readonly number[];
  readonly kind: "bucket" | "infinite" | "unmeasured";
  readonly overCap: boolean;
}
export type HeatMovement = "held" | "worse" | "better" | "unmeasured";
export interface HeatCell {
  readonly from: number;
  readonly to: number;
  readonly rows: number;
  readonly debtBefore: bigint;
  readonly debtAfter: bigint;
  readonly movement: HeatMovement;
}
export interface HeatmapView {
  readonly merged: boolean;
  readonly bands: readonly RoomBand[];
  /** Only occupied cells; band indexes. */
  readonly cells: readonly HeatCell[];
  readonly maxRows: number;
  readonly totalRows: number;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly heldRows: number | null;
  readonly laneChangedRows: number | null;
  /** Rows whose band after differs from their band today (both ends measured). */
  readonly bandChanged: number;
  /** Rows that were inside their cap today and are over it after. */
  readonly crossedCap: number;
  /** Rows whose lane rose (a health factor that improved). */
  readonly improved: number;
  /** Merged only: rows in the two bands nearest the cap today, and how many of them cross it. */
  readonly nearToday: number;
  readonly nearCrossed: number;
  readonly nearLabel: string | null;
  readonly decimals: number;
}
export type LaneReading = { readonly kind: "ok"; readonly view: HeatmapView } | { readonly kind: "contradictory"; readonly reasons: readonly string[] };

/** The room a health-factor edge means — `(hf − 1) ÷ hf` in basis points, printed with the trailing zeros dropped. */
export function roomBoundLabel(wad: bigint): string {
  if (wad <= WAD) return "0%";
  const bp = ((wad - WAD) * 10_000n) / wad;
  const whole = bp / 100n;
  const frac = bp % 100n;
  if (frac === 0n) return `${String(whole)}%`;
  const two = frac < 10n ? `0${String(frac)}` : String(frac);
  return `${String(whole)}.${two.replace(/0$/, "")}%`;
}

interface Read {
  readonly lanes: readonly TransitionLane[];
  readonly bucketCount: number;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly cells: readonly { from: number; to: number; rows: number; before: bigint; after: bigint }[];
}

function guards(engine: RunBookEngine): { read: Read | null; reasons: string[] } {
  const reasons: string[] = [];
  const t = engine.hf_transitions;
  const buckets = engine.before.hf_histogram.buckets;
  const laneCount = t.lanes.length;
  if (!isWireScale(engine.usd_decimals)) reasons.push(`usd_decimals ${JSON.stringify(engine.usd_decimals)} is not a wire scale`);
  if (laneCount !== buckets.length + 2) {
    reasons.push(`the matrix states ${String(laneCount)} lanes over ${String(buckets.length)} risk bands, and the vocabulary is the bands plus the two tallies beside them`);
  }
  if (t.outflows.length !== laneCount || t.from_rows.length !== laneCount || t.to_rows.length !== laneCount) {
    reasons.push("the matrix's lanes, outflows and two margins are not the same length");
  }
  if (t.comparator !== engine.before.hf_histogram.comparator) {
    reasons.push(`the matrix is stated on comparator ${t.comparator} and the distribution beside it on ${engine.before.hf_histogram.comparator}`);
  }
  if (!isWireDecimal(t.wad_scale)) reasons.push(`wad_scale ${JSON.stringify(t.wad_scale)} is outside the wire Decimal contract`);
  t.lanes.forEach((lane, i) => {
    if (lane.index !== i) reasons.push(`lanes[${String(i)}].index is ${String(lane.index)}`);
    if (lane.kind === "bucket") {
      if (lane.lower_wad !== null && wireBigInt(lane.lower_wad) === null) reasons.push(`lanes[${String(i)}].lower_wad ${JSON.stringify(lane.lower_wad)} is unreadable`);
      if (lane.upper_wad !== null && wireBigInt(lane.upper_wad) === null) reasons.push(`lanes[${String(i)}].upper_wad ${JSON.stringify(lane.upper_wad)} is unreadable`);
    }
  });
  const bucketCount = t.lanes.filter((l) => l.kind === "bucket").length;
  const infinite = t.lanes.findIndex((l) => l.kind === "infinite");
  const unmeasured = t.lanes.findIndex((l) => l.kind === "unmeasured");
  if (laneCount >= 2 && (infinite !== laneCount - 2 || unmeasured !== laneCount - 1)) {
    reasons.push("the lanes are not the buckets in order followed by no-debt and not-measured");
  }
  for (const [name, value] of [["total_rows", t.total_rows], ["measured_rows", t.measured_rows], ["unmeasured_rows", t.unmeasured_rows]] as const) {
    if (!isWirePopulation(value)) reasons.push(`${name} ${JSON.stringify(value)} is not a wire population`);
  }
  for (const [name, arr] of [["from_rows", t.from_rows], ["to_rows", t.to_rows]] as const) {
    arr.forEach((n, i) => {
      if (!isWirePopulation(n)) reasons.push(`${name}[${String(i)}] ${JSON.stringify(n)} is not a wire population`);
    });
  }
  if (t.held_rows !== null && !isWirePopulation(t.held_rows)) reasons.push(`held_rows ${JSON.stringify(t.held_rows)} is not a wire population`);
  if (t.lane_changed_rows !== null && !isWirePopulation(t.lane_changed_rows)) reasons.push(`lane_changed_rows ${JSON.stringify(t.lane_changed_rows)} is not a wire population`);
  if (reasons.length > 0) return { read: null, reasons };

  const cells: { from: number; to: number; rows: number; before: bigint; after: bigint }[] = [];
  const arrivals = t.to_rows.map(() => 0);
  t.outflows.forEach((o, i) => {
    if (o.from !== i) reasons.push(`outflows[${String(i)}].from is ${String(o.from)}`);
    let sum = 0;
    o.cells.forEach((c, j) => {
      const at = `outflows[${String(i)}].cells[${String(j)}]`;
      if (!isWirePopulation(c.rows)) {
        reasons.push(`${at}.rows ${JSON.stringify(c.rows)} is not a wire population`);
        return;
      }
      if (!Number.isInteger(c.to) || c.to < 0 || c.to >= laneCount) {
        reasons.push(`${at} names lane to ${String(c.to)}, and there are ${String(laneCount)} lanes`);
        return;
      }
      const before = wireBigInt(c.debt_before_usd);
      const after = wireBigInt(c.debt_after_usd);
      if (before === null) reasons.push(`${at}.debt_before_usd ${JSON.stringify(c.debt_before_usd)} is outside the wire Decimal contract`);
      if (after === null) reasons.push(`${at}.debt_after_usd ${JSON.stringify(c.debt_after_usd)} is outside the wire Decimal contract`);
      if (before === null || after === null) return;
      sum += c.rows;
      arrivals[c.to] = (arrivals[c.to] ?? 0) + c.rows;
      cells.push({ from: i, to: c.to, rows: c.rows, before, after });
    });
    if (sum !== t.from_rows[i]) reasons.push(`outflows[${String(i)}] sums to ${String(sum)} rows and from_rows[${String(i)}] states ${String(t.from_rows[i])}`);
  });
  t.to_rows.forEach((n, j) => {
    if (arrivals[j] !== n) reasons.push(`to_rows[${String(j)}] states ${String(n)} and the cells arriving there sum to ${String(arrivals[j])}`);
  });
  const fromSum = t.from_rows.reduce((a, b) => a + b, 0);
  if (fromSum !== t.total_rows) reasons.push(`total_rows states ${String(t.total_rows)} and from_rows sums to ${String(fromSum)}`);
  if (t.measured_rows + t.unmeasured_rows !== t.total_rows) {
    reasons.push(`measured_rows ${String(t.measured_rows)} + unmeasured_rows ${String(t.unmeasured_rows)} is not total_rows ${String(t.total_rows)}`);
  }
  if (t.held_rows !== null && t.lane_changed_rows !== null && t.held_rows + t.lane_changed_rows !== t.measured_rows) {
    reasons.push(`held_rows ${String(t.held_rows)} + lane_changed_rows ${String(t.lane_changed_rows)} is not measured_rows ${String(t.measured_rows)}`);
  }
  if (reasons.length > 0) return { read: null, reasons };
  return { read: { lanes: t.lanes, bucketCount, from: t.from_rows, to: t.to_rows, cells }, reasons };
}

function edgesMatchContract(lanes: readonly TransitionLane[], bucketCount: number): boolean {
  if (bucketCount !== CONTRACT_LANE_EDGES.length + 1) return false;
  for (let i = 0; i < bucketCount; i += 1) {
    const lane = lanes[i];
    if (lane === undefined) return false;
    const lower = i === 0 ? null : CONTRACT_LANE_EDGES[i - 1] ?? null;
    const upper = i === bucketCount - 1 ? null : CONTRACT_LANE_EDGES[i] ?? null;
    const lw = lane.lower_wad === null ? null : wireBigInt(lane.lower_wad);
    const uw = lane.upper_wad === null ? null : wireBigInt(lane.upper_wad);
    if (lw !== lower || uw !== upper) return false;
  }
  return true;
}

function hf(label: string): string {
  return `health factor ${label}`;
}

function mergedBands(lanes: readonly TransitionLane[]): RoomBand[] {
  const e = CONTRACT_LANE_EDGES;
  const r = (i: number) => roomBoundLabel(e[i] ?? WAD);
  const l = (i: number) => lanes[i]?.label ?? "";
  return [
    { key: "over-cap", label: "over cap", title: `${hf("below 1.00")} (${l(0)}, ${l(1)})`, lanes: [0, 1], kind: "bucket", overCap: true },
    { key: "b1", label: `< ${r(2)}`, title: `${hf(l(2))} · room under ${r(2)}`, lanes: [2], kind: "bucket", overCap: false },
    { key: "b2", label: `${r(2)} – ${r(3)}`, title: `${hf(l(3))} · room ${r(2)} to ${r(3)}`, lanes: [3], kind: "bucket", overCap: false },
    { key: "b3", label: `${r(3)} – ${r(4)}`, title: `${hf(l(4))} · room ${r(3)} to ${r(4)}`, lanes: [4], kind: "bucket", overCap: false },
    { key: "b4", label: `≥ ${r(4)}`, title: `${hf("1.25 and above")} (${l(5)}, ${l(6)}, ${l(7)}) · room ${r(4)} and above`, lanes: [5, 6, 7], kind: "bucket", overCap: false },
    { key: "no-debt", label: "no debt", title: l(8), lanes: [8], kind: "infinite", overCap: false },
    { key: "unmeasured", label: "not measured", title: l(9), lanes: [9], kind: "unmeasured", overCap: false },
  ];
}

function verbatimBands(lanes: readonly TransitionLane[]): RoomBand[] {
  return lanes.map((lane) => {
    const upper = lane.upper_wad === null ? null : wireBigInt(lane.upper_wad);
    return {
      key: `lane-${String(lane.index)}`,
      label: lane.label,
      title: lane.kind === "bucket" ? hf(lane.label) : lane.label,
      lanes: [lane.index],
      kind: lane.kind,
      overCap: lane.kind === "bucket" && upper !== null && upper <= WAD,
    };
  });
}

/** The heatmap model for one engine. `merge` is true for the Cash engine only (its health factor is a room). */
export function laneReading(engine: RunBookEngine, options: { merge: boolean }): LaneReading {
  const { read, reasons } = guards(engine);
  if (read === null) return { kind: "contradictory", reasons };
  const merged = options.merge && edgesMatchContract(read.lanes, read.bucketCount);
  const bands = merged ? mergedBands(read.lanes) : verbatimBands(read.lanes);
  const bandOf = new Map<number, number>();
  bands.forEach((b, i) => b.lanes.forEach((lane) => bandOf.set(lane, i)));
  const kindOf = (lane: number) => read.lanes[lane]?.kind ?? "unmeasured";
  const overCapLane = (lane: number) => {
    const b = bandOf.get(lane);
    return b !== undefined && (bands[b]?.overCap ?? false);
  };
  const acc = new Map<string, { from: number; to: number; rows: number; before: bigint; after: bigint }>();
  let bandChanged = 0;
  let crossedCap = 0;
  let improved = 0;
  let nearCrossed = 0;
  const nearLanes = merged ? [2, 3] : [];
  for (const c of read.cells) {
    const bf = bandOf.get(c.from);
    const bt = bandOf.get(c.to);
    if (bf === undefined || bt === undefined) continue;
    const key = `${String(bf)}-${String(bt)}`;
    const cur = acc.get(key) ?? { from: bf, to: bt, rows: 0, before: 0n, after: 0n };
    acc.set(key, { ...cur, rows: cur.rows + c.rows, before: cur.before + c.before, after: cur.after + c.after });
    const measured = kindOf(c.from) !== "unmeasured" && kindOf(c.to) !== "unmeasured";
    if (!measured) continue;
    if (bf !== bt) bandChanged += c.rows;
    const fromBucket = kindOf(c.from) === "bucket";
    const toBucket = kindOf(c.to) === "bucket";
    if ((fromBucket && toBucket && c.to > c.from) || (fromBucket && kindOf(c.to) === "infinite")) improved += c.rows;
    if (fromBucket && !overCapLane(c.from) && toBucket && overCapLane(c.to)) {
      crossedCap += c.rows;
      if (nearLanes.includes(c.from)) nearCrossed += c.rows;
    }
  }
  const cells: HeatCell[] = [...acc.values()].map((c) => {
    const fromKind = bands[c.from]?.kind;
    const toKind = bands[c.to]?.kind;
    const movement: HeatMovement =
      fromKind === "unmeasured" || toKind === "unmeasured" ? "unmeasured" : c.to === c.from ? "held" : c.to < c.from ? "worse" : "better";
    return { from: c.from, to: c.to, rows: c.rows, debtBefore: c.before, debtAfter: c.after, movement };
  });
  const t = engine.hf_transitions;
  return {
    kind: "ok",
    view: {
      merged,
      bands,
      cells,
      maxRows: cells.reduce((m, c) => Math.max(m, c.rows), 0),
      totalRows: t.total_rows,
      measuredRows: t.measured_rows,
      unmeasuredRows: t.unmeasured_rows,
      heldRows: t.held_rows,
      laneChangedRows: t.lane_changed_rows,
      bandChanged,
      crossedCap,
      improved,
      nearToday: nearLanes.reduce((n, lane) => n + (read.from[lane] ?? 0), 0),
      nearCrossed,
      nearLabel: merged ? roomBoundLabel(CONTRACT_LANE_EDGES[3] ?? WAD) : null,
      decimals: engine.usd_decimals,
    },
  };
}
```

Note on the `improved` law: the movement of a cell is judged on BAND indexes for its colour (`c.to < c.from` is worse: bands are ordered by health, index 0 = over cap), and on LANE indexes for the `improved` count (the wire's own resolution). A lane change inside one band (lane 1 → lane 0) colours as `held` at band level and counts in `laneChangedRows` but not in `bandChanged` — both are true statements about different resolutions, and the card's finding names which it is quoting (Task 11).

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts`
Expected: 7 passed. If the demo-table pin's `maxRows` differs, recount the merged cell `≥ 20% → ≥ 20%` (128 + 60 + 320 + 424 = 932) — the pin is the arithmetic, not the code.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-transitions.ts web/tests/unit/lab-transitions.spec.ts web/tests/unit/helpers/run-book-engine.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-transitions - the wire's ten lanes under guards, merged by exact summation into room bands for Cash, verbatim for the legacy market, contradictions named" -- web/lib/lab-transitions.ts web/tests/unit/lab-transitions.spec.ts web/tests/unit/helpers/run-book-engine.ts
```

---
### Task 3: `lab-headline` — the §3.5 Scenarios templates and the honest extra states (R3, R11, R14)

**Files:**
- Create: `web/lib/lab-headline.ts`
- Test: `web/tests/unit/lab-headline.spec.ts`

**Interfaces:**
- Consumes: `lib/human-usd.ts` (`humanUsd`, `MINUS` — the Book's tiers: one decimal, truncated: `$1.2M`, `$40K`, `$6,949`, `$239.60`), `lib/prose.ts` (`groupInt`, `joinAnd`), `lib/inspector-headline.ts` (`engineName`), `lib/lab-transitions.ts` (`HeatmapView`).
- Produces: `LabHeadline { emphasis, rest, tone: "crit" | "warn" | "ok" | "refused", dek }`; `signedUsd(value: bigint, decimals): string`; `resultHeadline(f: ResultFigures)`; `notRunHeadline(def: { label, description, path_assumption, shocks: number })`; `runningHeadline(label)`; `withheldHeadline(label, cause)`; `notCoveredHeadline(label, engines: string[], legacyBelow: boolean)`; `contradictoryHeadline(label, reasons)`; `definitionChangedHeadline(label, fields)`; `failureHeadline(kind: FailureKind, detail)`; `LISTING_LOADING`; `listingUnavailableHeadline(message)`; `FailureKind = "not-served" | "no-batch" | "rate-limited" | "busy" | "unreachable" | "failed" | "refused-locally"`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-headline.spec.ts
// Every sentence the Scenarios verdict header can print, pinned verbatim
// (spec §3.5 templates and the plan's extra states). Money is the Book's tiers.
import { expect, test } from "@playwright/test";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  signedUsd,
  withheldHeadline,
} from "../../lib/lab-headline";
import { laneReading } from "../../lib/lab-transitions";
import { cashEngine, DEMO_CASH_TABLE } from "./helpers/run-book-engine";

const heatOf = (table: Parameters<typeof cashEngine>[0]) => {
  const r = laneReading(cashEngine(table), { merge: true });
  if (r.kind !== "ok") throw new Error("helper table must read");
  return r.view;
};
const DEMO = {
  label: "ETH -30 percent",
  decimals: 6,
  newly: 118,
  beforeEligible: 49,
  afterEligible: 167,
  deltaEligibleDebt: 1_280_000_000_000n,
  deltaBadDebt: 40_780_396_039n,
  heat: heatOf(DEMO_CASH_TABLE),
  heatReason: null,
};

test("signedUsd: a sign on every delta, the Book's tiers, the true minus", () => {
  expect(signedUsd(1_280_000_000_000n, 6)).toBe("+$1.2M");
  expect(signedUsd(40_780_396_039n, 6)).toBe("+$40K");
  expect(signedUsd(-5_000_000n, 6)).toBe("−$5");
  expect(signedUsd(0n, 6)).toBe("+$0");
});

test("the demo result: the §3.5 template, money first, the dek from the wire's own figures and the merged bands", () => {
  const h = resultHeadline(DEMO);
  expect(h.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(h.rest).toBe("across 118 accounts.");
  expect(h.tone).toBe("crit");
  expect(h.dek).toBe(
    "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.",
  );
});

test("no change, band changes only, accounts flipping without a debt delta, improvements, a falling bad debt", () => {
  const none = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 3 }, 7: { 7: 9 } }) });
  expect(none.emphasis).toBe("No Cash account changes band under ETH -30 percent.");
  expect(none.rest).toBe("");
  expect(none.tone).toBe("ok");
  expect(none.dek).toBe("Bad debt at liquidation does not change.");

  const moved = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 1 }, 5: { 4: 5 }, 7: { 7: 2 } }) });
  expect(moved.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(moved.rest).toBe("but 5 change band.");
  expect(moved.tone).toBe("warn");
  expect(moved.dek).toBe("Bad debt at liquidation does not change. 5 accounts move to a worse band; none improve. Of the 1 account within 9.09% of its cap today, none cross it.");

  const flipped = resultHeadline({ ...DEMO, newly: 2, deltaEligibleDebt: 0n, heat: null, heatReason: "the matrix's lanes, outflows and two margins are not the same length" });
  expect(flipped.emphasis).toBe("2 accounts become liquidatable under ETH -30 percent.");
  expect(flipped.tone).toBe("crit");
  expect(flipped.dek).toContain("Where accounts move could not be read: the matrix's lanes, outflows and two margins are not the same length.");

  const better = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: -3_000_000_000n, deltaBadDebt: -1_000_000n, heat: heatOf({ 2: { 3: 4 }, 4: { 3: 2 } }) });
  expect(better.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(better.rest).toBe("but 6 change band.");
  expect(better.dek).toBe("Bad debt at liquidation would fall by $1. 6 accounts change band; 4 improve. Of the 4 accounts within 9.09% of their cap today, none cross it.");

  const single = resultHeadline({ ...DEMO, newly: 1, deltaEligibleDebt: 5_000_000n, afterEligible: 50, deltaBadDebt: 0n, heat: heatOf({ 3: { 0: 1 } }) });
  expect(single.emphasis).toBe("$5 more Cash debt becomes liquidatable,");
  expect(single.rest).toBe("across 1 account.");
  expect(single.dek).toBe("Bad debt at liquidation does not change. 1 account moves to a worse band; none improve. Of the 1 account within 9.09% of its cap today, all 1 cross it.");
});

test("the states without a result: not run, running, withheld, not covered, contradictory, definition changed — the dashed tone, never a verdict", () => {
  const notRun = notRunHeadline({ label: "ETH -30 percent", description: "All ETH-linked collateral, instantaneous mark.", path_assumption: "instantaneous mark at the shocked level; single-step", shocks: 1 });
  expect(notRun).toEqual({
    emphasis: "ETH -30 percent",
    rest: "— 1 committed shock, not run yet.",
    tone: "refused",
    dek: "All ETH-linked collateral, instantaneous mark. Path: instantaneous mark at the shocked level; single-step.",
  });
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 3 }).rest).toBe("— 3 committed shocks, not run yet.");
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 0 }).rest).toBe("— no committed shock (a market-realization or projection scenario), not run yet.");
  expect(runningHeadline("ETH -30 percent")).toEqual({ emphasis: "Running ETH -30 percent…", rest: "", tone: "refused", dek: "One evaluation against the newest complete batch; nothing is written." });
  expect(withheldHeadline("ETH -30 percent", "Cash — the custody flag is unproven")).toEqual({
    emphasis: "Cannot say — the Cash book is withheld under ETH -30 percent.",
    rest: "",
    tone: "refused",
    dek: "Cash — the custody flag is unproven. A withheld book is not a computed book, and this page never fills it in.",
  });
  expect(notCoveredHeadline("ETHFI -50 percent", ["aave_v3_etherfi"], true)).toEqual({
    emphasis: "ETHFI -50 percent does not model the Cash book.",
    rest: "",
    tone: "refused",
    dek: "It models the Aave v3 market (legacy). The legacy result is below.",
  });
  expect(notCoveredHeadline("X", [], false).dek).toBe("It models no engine this deployment serves.");
  expect(contradictoryHeadline("ETH -30 percent", ["a", "b"])).toEqual({
    emphasis: "The result for ETH -30 percent contradicts itself.",
    rest: "",
    tone: "refused",
    dek: "a; b. Nothing from it is drawn.",
  });
  expect(definitionChangedHeadline("ETH -30 percent", ["version", "shocks"])).toEqual({
    emphasis: "ETH -30 percent changed since this result was computed.",
    rest: "",
    tone: "refused",
    dek: "Changed: version and shocks. Run it again for the current definition.",
  });
});

test("the failure arms name themselves; a retry is stated only when the service stated it", () => {
  expect(failureHeadline("not-served", {})).toEqual({
    emphasis: "Book-wide stress is not served by this deployment.",
    rest: "",
    tone: "refused",
    dek: "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.",
  });
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: 30 }).dek).toBe("No complete risk batch is available (503). Retry after 30s.");
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: null }).dek).toBe("No complete risk batch is available (503). The service did not say when to retry.");
  expect(failureHeadline("no-batch", {}).emphasis).toBe("No servable batch.");
  expect(failureHeadline("rate-limited", { retryAfterSeconds: 12 })).toEqual({ emphasis: "Rate limited (429).", rest: "", tone: "refused", dek: "Retry after 12s." });
  expect(failureHeadline("busy", { message: "another evaluation holds the slot", inFlight: 1, maxInFlight: 1 }).dek).toBe("Another evaluation holds the slot. 1 of 1 slots in use.");
  expect(failureHeadline("busy", { message: "busy", inFlight: null, maxInFlight: null }).dek).toBe("Busy. The service did not state its capacity.");
  expect(failureHeadline("unreachable", { message: "fetch failed" })).toEqual({ emphasis: "The service could not be reached.", rest: "", tone: "refused", dek: "Fetch failed." });
  expect(failureHeadline("failed", { status: 500, message: "internal" })).toEqual({ emphasis: "The service answered 500.", rest: "", tone: "refused", dek: "Internal." });
  expect(failureHeadline("refused-locally", { message: "ids exceed the cap" }).emphasis).toBe("Nothing was sent.");
  expect(LISTING_LOADING).toEqual({ emphasis: "Loading the committed scenarios…", rest: "", tone: "refused", dek: "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed." });
  expect(EMPTY_LISTING).toEqual({ emphasis: "No committed scenarios are listed.", rest: "", tone: "refused", dek: "This deployment serves an empty committed set. Nothing can run." });
  expect(listingUnavailableHeadline("rate limited (429), retry after 30s")).toEqual({
    emphasis: "The committed scenarios could not be listed.",
    rest: "",
    tone: "refused",
    dek: "Rate limited (429), retry after 30s. Nothing can run until the listing answers.",
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-headline.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-headline'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-headline.ts
// The Scenarios verdict header's sentences (spec §3.5 templates, plan R3).
// Every state the workspace can be in has its own sentence; a definition, a
// run in flight and every refusal use the dashed tone, because none of them is
// a verdict. Money is the Book's tiers (plan R11).
import { humanUsd, MINUS } from "./human-usd";
import { engineName } from "./inspector-headline";
import type { HeatmapView } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";

export interface LabHeadline {
  readonly emphasis: string;
  readonly rest: string;
  readonly tone: "crit" | "warn" | "ok" | "refused";
  readonly dek: string;
}

export function signedUsd(value: bigint, decimals: number): string {
  return value < 0n ? `${MINUS}${humanUsd(-value, decimals)}` : `+${humanUsd(value, decimals)}`;
}

function sentence(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  const capitalised = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

const accounts = (n: number): string => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });

export interface ResultFigures {
  readonly label: string;
  readonly decimals: number;
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly deltaEligibleDebt: bigint;
  readonly deltaBadDebt: bigint;
  /** Null when the matrix contradicted itself; then `heatReason` says why. */
  readonly heat: HeatmapView | null;
  readonly heatReason: string | null;
}

function badDebtSentence(f: ResultFigures): string {
  if (f.deltaBadDebt > 0n) {
    return `Bad debt would rise by ${humanUsd(f.deltaBadDebt, f.decimals)} if all ${groupInt(f.afterEligible)} were liquidated at the shocked prices.`;
  }
  if (f.deltaBadDebt < 0n) return `Bad debt at liquidation would fall by ${humanUsd(-f.deltaBadDebt, f.decimals)}.`;
  return "Bad debt at liquidation does not change.";
}

function movementSentence(h: HeatmapView): string {
  if (h.bandChanged === 0) return "";
  const n = groupInt(h.bandChanged);
  const verb = h.bandChanged === 1 ? "moves" : "move";
  if (h.improved === 0) return ` ${n} ${h.bandChanged === 1 ? "account" : "accounts"} ${verb} to a worse band; none improve.`;
  return ` ${n} ${h.bandChanged === 1 ? "account changes" : "accounts change"} band; ${groupInt(h.improved)} improve.`;
}

function nearSentence(h: HeatmapView): string {
  // Silent when nothing moved: the headline already said so, and "none cross it" would restate it.
  if (h.nearLabel === null || h.nearToday === 0 || h.bandChanged === 0) return "";
  const who = h.nearToday === 1 ? `the 1 account within ${h.nearLabel} of its cap today` : `the ${groupInt(h.nearToday)} accounts within ${h.nearLabel} of their cap today`;
  const crossed = h.nearCrossed === 0 ? "none" : h.nearCrossed === h.nearToday ? `all ${groupInt(h.nearCrossed)}` : groupInt(h.nearCrossed);
  return ` Of ${who}, ${crossed} cross it.`;
}

export function resultHeadline(f: ResultFigures): LabHeadline {
  const movement =
    f.heat === null
      ? f.heatReason === null
        ? ""
        : ` Where accounts move could not be read: ${f.heatReason}.`
      : `${movementSentence(f.heat)}${nearSentence(f.heat)}`;
  const dek = `${badDebtSentence(f)}${movement}`;
  if (f.newly > 0 && f.deltaEligibleDebt > 0n) {
    return { emphasis: `${humanUsd(f.deltaEligibleDebt, f.decimals)} more Cash debt becomes liquidatable,`, rest: `across ${accounts(f.newly)}.`, tone: "crit", dek };
  }
  if (f.newly > 0) return { emphasis: `${accounts(f.newly)} become liquidatable under ${f.label}.`, rest: "", tone: "crit", dek };
  const moves = f.heat?.bandChanged ?? 0;
  if (moves === 0) return { emphasis: `No Cash account changes band under ${f.label}.`, rest: "", tone: "ok", dek };
  return { emphasis: `No Cash account becomes liquidatable under ${f.label},`, rest: `but ${groupInt(moves)} change band.`, tone: "warn", dek };
}

export function notRunHeadline(def: { label: string; description: string; path_assumption: string; shocks: number }): LabHeadline {
  const shocks =
    def.shocks === 0
      ? "no committed shock (a market-realization or projection scenario)"
      : `${String(def.shocks)} committed shock${def.shocks === 1 ? "" : "s"}`;
  return { emphasis: def.label, rest: `— ${shocks}, not run yet.`, tone: "refused", dek: `${sentence(def.description)} Path: ${sentence(def.path_assumption)}` };
}

export const runningHeadline = (label: string): LabHeadline =>
  refused(`Running ${label}…`, "One evaluation against the newest complete batch; nothing is written.");

export const withheldHeadline = (label: string, cause: string): LabHeadline =>
  refused(`Cannot say — the Cash book is withheld under ${label}.`, `${sentence(cause)} A withheld book is not a computed book, and this page never fills it in.`);

export function notCoveredHeadline(label: string, engines: readonly string[], legacyBelow: boolean): LabHeadline {
  const models = engines.length === 0 ? "It models no engine this deployment serves." : `It models ${joinAnd(engines.map(engineName))}.`;
  return refused(`${label} does not model the Cash book.`, legacyBelow ? `${models} The legacy result is below.` : models);
}

export const contradictoryHeadline = (label: string, reasons: readonly string[]): LabHeadline =>
  refused(`The result for ${label} contradicts itself.`, `${reasons.join("; ")}. Nothing from it is drawn.`);

export const definitionChangedHeadline = (label: string, fields: readonly string[]): LabHeadline =>
  refused(`${label} changed since this result was computed.`, `Changed: ${joinAnd(fields)}. Run it again for the current definition.`);

export type FailureKind = "not-served" | "no-batch" | "rate-limited" | "busy" | "unreachable" | "failed" | "refused-locally";
export interface FailureDetail {
  readonly message?: string;
  readonly retryAfterSeconds?: number | null;
  readonly status?: number;
  readonly inFlight?: number | null;
  readonly maxInFlight?: number | null;
}

function retry(seconds: number | null | undefined): string {
  return typeof seconds === "number" ? `Retry after ${String(seconds)}s.` : "The service did not say when to retry.";
}

export function failureHeadline(kind: FailureKind, d: FailureDetail): LabHeadline {
  switch (kind) {
    case "not-served":
      return refused("Book-wide stress is not served by this deployment.", "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.");
    case "no-batch":
      return refused("No servable batch.", `${sentence(d.message ?? "no complete risk batch is available").replace(/\.$/, "")} (503). ${retry(d.retryAfterSeconds)}`);
    case "rate-limited":
      return refused("Rate limited (429).", retry(d.retryAfterSeconds));
    case "busy": {
      const slots =
        typeof d.inFlight === "number" && typeof d.maxInFlight === "number"
          ? `${String(d.inFlight)} of ${String(d.maxInFlight)} slots in use.`
          : "The service did not state its capacity.";
      return refused("The evaluator is busy.", `${sentence(d.message ?? "busy")} ${slots}`);
    }
    case "unreachable":
      return refused("The service could not be reached.", sentence(d.message ?? "no HTTP response"));
    case "failed":
      return refused(`The service answered ${String(d.status ?? 0)}.`, sentence(d.message ?? "without the contract's error envelope"));
    case "refused-locally":
      return refused("Nothing was sent.", sentence(d.message ?? "the request was refused before dispatch"));
  }
}

export const LISTING_LOADING: LabHeadline = refused(
  "Loading the committed scenarios…",
  "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed.",
);

export const listingUnavailableHeadline = (message: string): LabHeadline =>
  refused("The committed scenarios could not be listed.", `${sentence(message)} Nothing can run until the listing answers.`);

export const EMPTY_LISTING: LabHeadline = refused("No committed scenarios are listed.", "This deployment serves an empty committed set. Nothing can run.");
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-headline.spec.ts`
Expected: 5 passed. The pins are the law: if a sentence differs, the code moves, not the pin — except where a pin's arithmetic is provably wrong (recount from the helper table and say so in the report).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-headline.ts web/tests/unit/lab-headline.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-headline - the Scenarios templates and every state's own sentence, money in the Book's tiers, the dashed tone for anything that is not a verdict" -- web/lib/lab-headline.ts web/tests/unit/lab-headline.spec.ts
```

---
### Task 4: `lab-library` (rows, inline outcomes, definition skew, the run records) and `lab-deep-link` (moved)

**Files:**
- Create: `web/lib/lab-library.ts`, `web/lib/lab-deep-link.ts`
- Modify: `web/tests/unit/helpers/run-book-engine.ts` (append `runBookOf`)
- Test: `web/tests/unit/lab-library.spec.ts`, `web/tests/unit/lab-deep-link.spec.ts`

**Interfaces:**
- Consumes: `lib/runbook.ts` (`RunBookOutcome`, `RunBookResponse`), `lib/runbookSet.ts` (`SetRunOutcome`), `lib/lab-transitions.ts` (`laneReading`), `lib/lab-headline.ts` (`signedUsd`), `lib/inspector-headline.ts` (`engineName`), `lib/inspector-position.ts` (`CASH`), `lib/prose.ts`, `lib/wireGuard.ts`.
- Produces: `RunRecord`, `SetRecord`, `LibraryOutcome { key: LibraryOutcomeKey; text; tone }`, `LibraryRow`, `libraryRows(listing, records, selectedId, checked): LibraryRow[]`, `outcomeLine(record, definition): LibraryOutcome`, `definitionSkew(definition, configVersion, run): string[]`, `cashEngineOf(run): RunBookEngine | null`, `cashRefusalOf(run): EngineRefusal | null`; `deepLinkDecision`, `DeepLinkDecision` (moved).

- [ ] **Step 1: The move — `deepLinkDecision` verbatim**

Create `web/lib/lab-deep-link.ts` with, copied byte-for-byte from `web/app/lab/tornadoLines.ts`: the `DeepLinkDecision` type (lines 34–70), `listWords` (72–75), and `deepLinkDecision` (87–169), plus the imports those three need (`MAX_SET_RUN_SCENARIOS`, `SCENARIO_ID_PATTERN` from `./runbookSet`). Prepend this header:

```ts
// web/lib/lab-deep-link.ts
// The deep-link law for /lab: `?scenario=` runs one, `?scenarios=` runs the
// committed set, both together run nothing. Moved verbatim from the old Lab's
// tornadoLines.ts; the unit pins moved with it.
```

Create `web/tests/unit/lab-deep-link.spec.ts` with the `test.describe("the deep-link decision", …)` block copied verbatim from `web/tests/unit/tornado-lines.spec.ts` (line 60 to the block's closing `});`), its `LISTED` constant and whatever imports that block uses, the import path changed to `../../lib/lab-deep-link`. Do not delete anything from the old files in this task (Task 12 deletes them); the old and new copies coexist until then.

Run: `cd web && npx playwright test --project=unit tests/unit/lab-deep-link.spec.ts`
Expected: the moved block passes with the same count it had in `tornado-lines.spec.ts`. In the report, paste `diff <(sed -n '87,169p' app/lab/tornadoLines.ts) <(sed -n '<start>,<end>p' lib/lab-deep-link.ts)` output (empty).

- [ ] **Step 2: Append `runBookOf` to the helper**

```ts
// append to web/tests/unit/helpers/run-book-engine.ts
export type RunBook = Schemas["RunBookResponse"];
export type Definition = Schemas["ScenarioDefinition"];

export const DEFINITION_ETH: Definition = {
  id: "eth_minus_30",
  version: "v1",
  label: "ETH -30 percent",
  description: "All ETH-linked collateral marked down 30 percent.",
  path_assumption: "instantaneous mark at the shocked level; single-step",
  engines: ["aave_v3_etherfi", "debt_manager"],
  shocks: [{ axis: "eth_usd", factor_num: 70, factor_den: 100 }],
  out_of_model: ["liquidation bonuses", "gas"],
};

const BATCH: Schemas["Batch"] = {
  id: 18251,
  computed_at: "2026-08-08T20:22:08Z",
  age_seconds: 42,
  producer: "riskd",
  status: "complete",
  position_count: 9964,
  refused_count: 6,
  refused_engines: [],
  flagged_count: 30,
  watermarks: [],
  supersession: { superseded: false, legs: [], note: "" },
};

/** A wire-true run-book around the given engines. `batch` overrides let a pin state supersession. */
export function runBookOf(engines: readonly Engine[], def: Definition = DEFINITION_ETH, overrides: Partial<RunBook> = {}): RunBook {
  return {
    served_at: "2026-08-08T20:22:50Z",
    batch: BATCH,
    scenario_config_version: "v1",
    scenario_id: def.id,
    scenario_version: def.version,
    label: def.label,
    description: def.description,
    path_assumption: def.path_assumption,
    shocks: def.shocks,
    out_of_model: def.out_of_model,
    applied_shocks: [],
    held_flat: [],
    engines: [...engines],
    excluded_engines: [],
    coverage: [],
    notes: [],
    ...overrides,
  };
}
```

If `Schemas["Batch"]` requires fields this literal lacks, add them from `web/tests/fixtures/run-book.eth_minus_30.json`'s `batch` (copy the values; do not invent).

- [ ] **Step 3: The pins (failing)**

```ts
// web/tests/unit/lab-library.spec.ts
// The library's rows: the wire's own labels, one outcome word per run record,
// the definition-skew law, and the Cash engine/refusal readers.
import { expect, test } from "@playwright/test";
import { cashEngineOf, cashRefusalOf, definitionSkew, libraryRows, outcomeLine, type RunRecord } from "../../lib/lab-library";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

const settled = (outcome: RunRecord extends { outcome: infer O } ? O : never): RunRecord => ({ phase: "settled", outcome, at: 1 });

test("rows come from the listing verbatim, in wire order, engines as human names, selection and checks carried", () => {
  const rows = libraryRows(SCENARIOS, new Map(), "ethfi_minus_50", new Set(["eth_minus_30"]));
  expect(rows.map((r) => r.id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  const eth = rows[0]!;
  expect(eth.label).toBe("ETH -30 percent");
  expect(eth.description).toBe(SCENARIOS.scenarios[0]!.description);
  expect(eth.engines).toBe("Aave v3 market (legacy) and Cash");
  expect(eth.coversCash).toBe(true);
  expect(eth.checked).toBe(true);
  expect(eth.selected).toBe(false);
  expect(eth.outcome).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(rows.find((r) => r.id === "ethfi_minus_50")?.selected).toBe(true);
  expect(libraryRows(null, new Map(), null, new Set())).toEqual([]);
});

test("outcome lines: running, a Cash result in the Book's tiers, no band change, band change only, withheld, not modelled, every failure word", () => {
  const def = DEFINITION_ETH;
  expect(outcomeLine(undefined, def)).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(outcomeLine({ phase: "running", startedAt: 0 }, def)).toEqual({ key: "running", text: "Running…", tone: "dim" });
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  expect(outcomeLine(settled({ kind: "ok", response: demo }), def)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  const still = runBookOf([cashEngine({ 2: { 2: 3 }, 7: { 7: 4 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: still }), def)).toEqual({ key: "result", text: "No band change", tone: "ok" });
  const moved = runBookOf([cashEngine({ 5: { 4: 7 }, 7: { 7: 1 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: moved }), def)).toEqual({ key: "result", text: "7 change band", tone: "warn" });
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], def, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] });
  expect(outcomeLine(settled({ kind: "ok", response: withheld }), def)).toEqual({ key: "withheld", text: "Withheld", tone: "refused" });
  const legacyOnly = { ...def, engines: ["aave_v3_etherfi"] };
  expect(outcomeLine(settled({ kind: "ok", response: runBookOf([legacyEngine({ 7: { 7: 1 } })], legacyOnly) }), legacyOnly)).toEqual({ key: "not-covered", text: "Not modelled for Cash", tone: "dim" });
  const contradictory = runBookOf([cashEngine({ 2: { 2: 1 } }, { hf_transitions: { ...transitionsOf({ 2: { 2: 1 } }), total_rows: 9 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: contradictory }), def)).toEqual({ key: "failed", text: "Contradictory", tone: "refused" });
  const unreadable = runBookOf([cashEngine({ 2: { 2: 1 } }, { eligible_debt_delta_usd: "1e6", newly_eligible_accounts: 1 })]);
  expect(outcomeLine(settled({ kind: "ok", response: unreadable }), def)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "not-served" }), def)).toEqual({ key: "failed", text: "Not served", tone: "refused" });
  expect(outcomeLine(settled({ kind: "no-batch", message: "m", retryAfterSeconds: null }), def)).toEqual({ key: "failed", text: "No batch", tone: "refused" });
  expect(outcomeLine(settled({ kind: "rate-limited", retryAfterSeconds: 3 }), def)).toEqual({ key: "failed", text: "Rate limited", tone: "refused" });
  expect(outcomeLine(settled({ kind: "unreachable", message: "m" }), def)).toEqual({ key: "failed", text: "Unreachable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "failed", status: 502, message: "m" }), def)).toEqual({ key: "failed", text: "Failed 502", tone: "refused" });
});

test("definitionSkew names every field the listing no longer agrees with; an unchanged definition names none", () => {
  const run = runBookOf([cashEngine({ 2: { 2: 1 } })]);
  expect(definitionSkew(DEFINITION_ETH, "v1", run)).toEqual([]);
  expect(definitionSkew({ ...DEFINITION_ETH, version: "v2" }, "v1", run)).toEqual(["version"]);
  expect(definitionSkew({ ...DEFINITION_ETH, label: "ETH -35 percent" }, "v1", run)).toEqual(["label"]);
  expect(definitionSkew({ ...DEFINITION_ETH, shocks: [{ axis: "eth_usd", factor_num: 65, factor_den: 100 }] }, "v1", run)).toEqual(["shocks"]);
  expect(definitionSkew({ ...DEFINITION_ETH, path_assumption: "other" }, "v1", run)).toEqual(["path assumption"]);
  expect(definitionSkew(DEFINITION_ETH, "v2", run)).toEqual(["config version"]);
  expect(definitionSkew({ ...DEFINITION_ETH, version: "v2", shocks: [] }, "v2", run)).toEqual(["version", "shocks", "config version"]);
});

test("cashEngineOf and cashRefusalOf read the run by engine id, never by position", () => {
  const legacy = legacyEngine({ 7: { 7: 1 } });
  const cash = cashEngine({ 7: { 7: 1 } });
  expect(cashEngineOf(runBookOf([legacy, cash]))?.engine).toBe("debt_manager");
  expect(cashEngineOf(runBookOf([legacy]))).toBeNull();
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "d", note: "n" };
  expect(cashRefusalOf(runBookOf([legacy], DEFINITION_ETH, { excluded_engines: [refusal] }))).toEqual(refusal);
  expect(cashRefusalOf(runBookOf([legacy, cash]))).toBeNull();
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-library'`.

- [ ] **Step 5: The module**

```ts
// web/lib/lab-library.ts
// The scenario library's model: one row per committed scenario as the wire
// lists it, its last outcome in one word, and the definition-skew law that
// makes a result "for a previous input" once the listing changes under it.
import type { components } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { signedUsd } from "./lab-headline";
import { laneReading } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";
import type { RunBookOutcome, RunBookResponse } from "./runbook";
import type { SetRunOutcome } from "./runbookSet";
import { isWireDecimal, isWirePopulation } from "./wireGuard";

type Schemas = components["schemas"];
export type ScenariosResponse = Schemas["ScenariosResponse"];
export type ScenarioDefinition = Schemas["ScenarioDefinition"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type EngineRefusal = Schemas["EngineRefusal"];

export type RunRecord =
  | { readonly phase: "running"; readonly startedAt: number }
  | { readonly phase: "settled"; readonly outcome: RunBookOutcome; readonly at: number };

export type SetRecord =
  | { readonly phase: "running"; readonly ids: readonly string[]; readonly startedAt: number }
  | { readonly phase: "settled"; readonly ids: readonly string[]; readonly outcome: SetRunOutcome; readonly at: number };

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";
export interface LibraryOutcome {
  readonly key: LibraryOutcomeKey;
  readonly text: string;
  readonly tone: LibraryOutcomeTone;
}

export interface LibraryRow {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly engines: string;
  readonly coversCash: boolean;
  readonly outcome: LibraryOutcome;
  readonly checked: boolean;
  readonly selected: boolean;
}

export const cashEngineOf = (run: RunBookResponse): RunBookEngine | null => run.engines.find((e) => e.engine === CASH) ?? null;
export const cashRefusalOf = (run: RunBookResponse): EngineRefusal | null => run.excluded_engines.find((e) => e.engine === CASH) ?? null;

const FAILURE_WORD: Record<Exclude<RunBookOutcome["kind"], "ok" | "failed">, string> = {
  "not-served": "Not served",
  "no-batch": "No batch",
  "rate-limited": "Rate limited",
  unreachable: "Unreachable",
};

const failed = (text: string): LibraryOutcome => ({ key: "failed", text, tone: "refused" });

export function outcomeLine(record: RunRecord | undefined, definition: ScenarioDefinition): LibraryOutcome {
  if (record === undefined) return { key: "not-run", text: "Not run yet", tone: "dim" };
  if (record.phase === "running") return { key: "running", text: "Running…", tone: "dim" };
  const o = record.outcome;
  if (o.kind === "failed") return failed(`Failed ${String(o.status)}`);
  if (o.kind !== "ok") return failed(FAILURE_WORD[o.kind]);
  if (!definition.engines.includes(CASH)) return { key: "not-covered", text: "Not modelled for Cash", tone: "dim" };
  if (cashRefusalOf(o.response) !== null) return { key: "withheld", text: "Withheld", tone: "refused" };
  const cash = cashEngineOf(o.response);
  if (cash === null) return { key: "withheld", text: "Withheld", tone: "refused" };
  if (!isWirePopulation(cash.newly_eligible_accounts) || !isWireDecimal(cash.eligible_debt_delta_usd)) return failed("Unreadable");
  const heat = laneReading(cash, { merge: true });
  if (heat.kind === "contradictory") return failed("Contradictory");
  const newly = cash.newly_eligible_accounts;
  if (newly > 0) {
    return { key: "result", text: `${signedUsd(BigInt(cash.eligible_debt_delta_usd), cash.usd_decimals)} liquidatable · ${groupInt(newly)} account${newly === 1 ? "" : "s"}`, tone: "crit" };
  }
  if (heat.view.bandChanged === 0) return { key: "result", text: "No band change", tone: "ok" };
  return { key: "result", text: `${groupInt(heat.view.bandChanged)} change band`, tone: "warn" };
}

export function libraryRows(listing: ScenariosResponse | null, records: ReadonlyMap<string, RunRecord>, selectedId: string | null, checked: ReadonlySet<string>): LibraryRow[] {
  if (listing === null) return [];
  return listing.scenarios.map((def) => ({
    id: def.id,
    version: def.version,
    label: def.label,
    description: def.description,
    engines: joinAnd(def.engines.map(engineName)),
    coversCash: def.engines.includes(CASH),
    outcome: outcomeLine(records.get(def.id), def),
    checked: checked.has(def.id),
    selected: def.id === selectedId,
  }));
}

const shockKey = (s: Schemas["Shock"]): string => `${s.axis}|${s.asset ?? ""}|${String(s.factor_num)}/${String(s.factor_den)}`;

/** The fields on which the listing's definition no longer matches the result's — "for a previous input" when non-empty. */
export function definitionSkew(definition: ScenarioDefinition, configVersion: string, run: RunBookResponse): string[] {
  const fields: string[] = [];
  if (definition.version !== run.scenario_version) fields.push("version");
  if (definition.label !== run.label) fields.push("label");
  if (definition.path_assumption !== run.path_assumption) fields.push("path assumption");
  const a = definition.shocks.map(shockKey).join(";");
  const b = run.shocks.map(shockKey).join(";");
  if (a !== b) fields.push("shocks");
  if (configVersion !== run.scenario_config_version) fields.push("config version");
  return fields;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts tests/unit/lab-deep-link.spec.ts`
Expected: all passed (4 in `lab-library`; the moved count in `lab-deep-link`). If `SCENARIOS.scenarios[0].engines` is not `["aave_v3_etherfi", "debt_manager"]` in that order, the "engines" pin follows the fixture's order — `joinAnd` never sorts.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-library.ts web/lib/lab-deep-link.ts web/tests/unit/lab-library.spec.ts web/tests/unit/lab-deep-link.spec.ts web/tests/unit/helpers/run-book-engine.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-library - the library's rows and outcome words from the wire and the run records, the definition-skew law; the deep-link law moved verbatim into lib" -- web/lib/lab-library.ts web/lib/lab-deep-link.ts web/tests/unit/lab-library.spec.ts web/tests/unit/lab-deep-link.spec.ts web/tests/unit/helpers/run-book-engine.ts
```

---
### Task 5: `lab-movers` — the most-affected accounts (R4, R5)

**Files:**
- Create: `web/lib/lab-movers.ts`
- Test: `web/tests/unit/lab-movers.spec.ts`

**Interfaces:**
- Consumes: `lib/book-format.ts` (`hfDisplayFromWad`), `lib/human-price.ts` (`humanUsdFull`), `lib/materiality.ts` (`materialityTier`, `MaterialityTier`), `lib/percent.ts` (`percentTenths`, `formatTenths`), `lib/wireGuard.ts`, `lib/prose.ts` (`groupInt`).
- Produces: `MoverRow`, `MoversTable`, `moversTable(engine: RunBookEngine): MoversTable`, `moversCaption(table): string`, `roomFromRatio(num, den): string`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-movers.spec.ts
// The most-affected table: the wire's movers in the wire's order, room from
// the Cash ratio, HF wads for the legacy market, the $100 line as a display
// tier, a null verdict as "cannot say", and unreadable fields named.
import { expect, test } from "@playwright/test";
import { moversCaption, moversTable, roomFromRatio } from "../../lib/lab-movers";
import { cashEngine, legacyEngine } from "./helpers/run-book-engine";

const mover = (account: string, num: string, den: string, debt: string | null, became: boolean | null) => ({
  account,
  engine: "debt_manager",
  hf_before_wad: null,
  hf_after_wad: null,
  hf_drop_wad: null,
  hf_before_num: num,
  hf_before_den: den,
  hf_after_num: String(BigInt(num) * 7n),
  hf_after_den: String(BigInt(den) * 10n),
  became_eligible: became,
  debt_usd: debt,
});

test("roomFromRatio: the room a cap/debt ratio means, floored to tenths; at or over the cap says so; no debt is a knowable no-room", () => {
  expect(roomFromRatio(5_012_500_000n, 4_822_000_000n)).toBe("3.8%");
  expect(roomFromRatio(10n, 4n)).toBe("60%");
  expect(roomFromRatio(4n, 4n)).toBe("at cap");
  expect(roomFromRatio(3n, 4n)).toBe("over cap");
  expect(roomFromRatio(5n, 0n)).toBe("no debt");
});

test("Cash movers: wire order, room today → after from the ratios, debt in the account register, tiers, verdicts", () => {
  const engine = cashEngine(
    { 3: { 0: 2 }, 5: { 2: 1 } },
    {
      movers: [
        mover("0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e", "5012500000", "4822000000", "4822000000", true),
        mover("0x00000000000000000000000000000000000d0002", "2000000000", "1500000000", "1500000000", true),
        mover("0x00000000000000000000000000000000000d0003", "1300000000", "1000000000", "50000000", null),
        mover("0x00000000000000000000000000000000000d0004", "1400000000", "1000000000", null, false),
      ],
      movers_total: 118,
      movers_note: "ranked by the drop in the engine's own ratio; the top 20 of 118",
    },
  );
  const t = moversTable(engine);
  expect(t.decimals).toBe(6);
  expect(t.total).toBe(118);
  expect(t.shown).toBe(4);
  expect(t.note).toBe("ranked by the drop in the engine's own ratio; the top 20 of 118");
  expect(t.unreadable).toEqual([]);
  expect(t.rows.map((r) => r.account)).toEqual([
    "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e",
    "0x00000000000000000000000000000000000d0002",
    "0x00000000000000000000000000000000000d0003",
    "0x00000000000000000000000000000000000d0004",
  ]);
  const near = t.rows[0]!;
  expect(near.roomBefore).toBe("3.8%");
  expect(near.roomAfter).toBe("over cap");
  expect(near.debtText).toBe("$4,822");
  expect(near.tier).toBe("material");
  expect(near.becomesLiquidatable).toBe(true);
  expect(near.hfBefore).toBeNull();
  const two = t.rows[1]!;
  expect(two.roomBefore).toBe("25%");
  expect(two.roomAfter).toBe("over cap");
  expect(two.debtText).toBe("$1,500");
  const three = t.rows[2]!;
  expect(three.roomBefore).toBe("23%");
  expect(three.roomAfter).toBe("over cap");
  expect(three.debtText).toBe("$50");
  expect(three.tier).toBe("small");
  expect(three.becomesLiquidatable).toBeNull();
  const four = t.rows[3]!;
  expect(four.roomBefore).toBe("28.5%");
  expect(four.roomAfter).toBe("over cap");
  expect(four.debtText).toBe("—");
  expect(four.tier).toBeNull();
  expect(four.becomesLiquidatable).toBe(false);
  expect(moversCaption(t)).toBe("showing 4 of 118 accounts moved");
});

test("legacy movers speak wads; a null side is a dash, never a zero", () => {
  const engine = legacyEngine(
    { 4: { 0: 1 } },
    {
      movers: [
        {
          account: "0xAAaA000000000000000000000000000000000001",
          engine: "aave_v3_etherfi",
          hf_before_wad: "1080000000000000000",
          hf_after_wad: "756000000000000000",
          hf_drop_wad: "324000000000000000",
          hf_before_num: null,
          hf_before_den: null,
          hf_after_num: null,
          hf_after_den: null,
          became_eligible: null,
          debt_usd: null,
        },
      ],
      movers_total: 1,
      movers_note: "n",
    },
  );
  const t = moversTable(engine);
  expect(t.rows[0]?.hfBefore).toBe("1.08");
  expect(t.rows[0]?.hfAfter).toBe("0.75");
  expect(t.rows[0]?.roomBefore).toBe("—");
  expect(t.rows[0]?.debtText).toBe("—");
  expect(moversCaption(t)).toBe("showing 1 of 1 account moved");
});

test("unreadable fields are named and never printed as numbers; an unreadable scale refuses the whole table", () => {
  const engine = cashEngine({ 3: { 0: 1 } }, { movers: [mover("0x00000000000000000000000000000000000d0001", "1e9", "1000000000", "0x10", true)], movers_total: -1, movers_note: "" });
  const t = moversTable(engine);
  expect(t.rows[0]?.roomBefore).toBe("unreadable");
  expect(t.rows[0]?.debtText).toBe("unreadable");
  expect(t.rows[0]?.tier).toBeNull();
  expect(t.total).toBeNull();
  expect(t.unreadable).toEqual(["movers[0].hf_before_num", "movers[0].debt_usd", "movers_total"]);
  expect(moversCaption(t)).toBe("showing 1 account moved · total not stated");
  const badScale = moversTable(cashEngine({ 3: { 0: 1 } }, { usd_decimals: 1.5, movers: [mover("0x00000000000000000000000000000000000d0001", "2", "1", "5", true)], movers_total: 1, movers_note: "" }));
  expect(badScale.rows).toEqual([]);
  expect(badScale.unreadable).toEqual(["usd_decimals"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-movers'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-movers.ts
// The most-affected accounts: the wire's `movers`, in the wire's order, each
// side's room from the Cash ratio (cap ÷ debt) or the legacy market's health
// factor from its wad. Every field passes the guards; a field that fails is
// named and its cell prints "unreadable", never a number.
import type { components } from "@solvent/client";
import { hfDisplayFromWad } from "./book-format";
import { humanUsdFull } from "./human-price";
import { materialityTier, type MaterialityTier } from "./materiality";
import { formatTenths, percentTenths } from "./percent";
import { groupInt } from "./prose";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookMover = Schemas["RunBookMover"];

export interface MoverRow {
  readonly account: string;
  readonly roomBefore: string;
  readonly roomAfter: string;
  readonly hfBefore: string | null;
  readonly hfAfter: string | null;
  readonly debt: bigint | null;
  readonly debtText: string;
  readonly tier: MaterialityTier | null;
  readonly becomesLiquidatable: boolean | null;
}

export interface MoversTable {
  readonly rows: readonly MoverRow[];
  readonly shown: number;
  readonly total: number | null;
  readonly note: string;
  readonly decimals: number;
  readonly unreadable: readonly string[];
}

/** The room a cap ÷ debt ratio means, floored to tenths. */
export function roomFromRatio(num: bigint, den: bigint): string {
  if (den === 0n) return "no debt";
  if (num === den) return "at cap";
  if (num < den) return "over cap";
  const tenths = percentTenths(num - den, num);
  return tenths === null ? "unreadable" : formatTenths(tenths);
}

function ratio(num: string | null, den: string | null, at: string, unreadable: string[]): string {
  if (num === null || den === null) return "—";
  const n = isWireDecimal(num);
  const d = isWireDecimal(den);
  if (!n) unreadable.push(`${at}_num`);
  if (!d) unreadable.push(`${at}_den`);
  if (!n || !d) return "unreadable";
  return roomFromRatio(BigInt(num), BigInt(den));
}

function wad(value: string | null, at: string, unreadable: string[]): string | null {
  if (value === null) return null;
  if (!isWireDecimal(value)) {
    unreadable.push(at);
    return "unreadable";
  }
  return hfDisplayFromWad(value);
}

export function moversTable(engine: RunBookEngine): MoversTable {
  const unreadable: string[] = [];
  const decimals = engine.usd_decimals;
  if (!isWireScale(decimals)) {
    return { rows: [], shown: 0, total: null, note: engine.movers_note, decimals: 0, unreadable: ["usd_decimals"] };
  }
  const rows: MoverRow[] = engine.movers.map((m, i) => {
    const at = `movers[${String(i)}]`;
    const roomBefore = ratio(m.hf_before_num, m.hf_before_den, `${at}.hf_before`, unreadable);
    const roomAfter = ratio(m.hf_after_num, m.hf_after_den, `${at}.hf_after`, unreadable);
    const hfBefore = wad(m.hf_before_wad, `${at}.hf_before_wad`, unreadable);
    const hfAfter = wad(m.hf_after_wad, `${at}.hf_after_wad`, unreadable);
    let debt: bigint | null = null;
    let debtText = "—";
    if (m.debt_usd !== null) {
      if (isWireDecimal(m.debt_usd)) {
        debt = BigInt(m.debt_usd);
        debtText = humanUsdFull(debt, decimals);
      } else {
        unreadable.push(`${at}.debt_usd`);
        debtText = "unreadable";
      }
    }
    return {
      account: m.account,
      roomBefore,
      roomAfter,
      hfBefore,
      hfAfter,
      debt,
      debtText,
      tier: debt === null ? null : materialityTier(debt, decimals),
      becomesLiquidatable: m.became_eligible,
    };
  });
  let total: number | null = engine.movers_total;
  if (!isWirePopulation(engine.movers_total)) {
    unreadable.push("movers_total");
    total = null;
  }
  return { rows, shown: rows.length, total, note: engine.movers_note, decimals, unreadable };
}

export function moversCaption(t: MoversTable): string {
  const noun = (n: number) => `${groupInt(n)} account${n === 1 ? "" : "s"} moved`;
  if (t.total === null) return `showing ${noun(t.shown)} · total not stated`;
  return `showing ${groupInt(t.shown)} of ${noun(t.total)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts`
Expected: 4 passed. `hfDisplayFromWad("756000000000000000")` must print `0.75` (the Book's two-decimal truncation) — if it prints `0.756`, read `lib/book-format.ts:140` and pin what it does; the law is the Book's.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-movers.ts web/tests/unit/lab-movers.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-movers - the most-affected accounts in the wire's order, room from the Cash ratio, wads for the legacy market, the materiality tier as display, unreadable fields named" -- web/lib/lab-movers.ts web/tests/unit/lab-movers.spec.ts
```

---
### Task 6: `lab-address` — the one-address workspace over the Inspector's reading (R8, R15)

**Files:**
- Create: `web/lib/lab-address.ts`
- Test: `web/tests/unit/lab-address.spec.ts`

**Interfaces:**
- Consumes: `lib/inspector-view.ts` (`InspectorView`, `deriveInspectorView`), `lib/address-stress.ts` (`StressRow`, `StressSide`), `lib/human-price.ts` (`humanUsdFull`), `lib/format.ts` (`truncateAddress`), `lib/wireGuard.ts` (`isWireScale`), `lib/lab-headline.ts` (`LabHeadline`), `lib/inspector-position.ts` (`CashStatus`).
- Produces: `AddressWorkspaceState`, `AddressTile { value, tone }`, `AddressTiles`, `AddressWorkspace`, `addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null }): AddressWorkspace`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-address.spec.ts
// The one-address workspace is the Inspector's own reading: its stress rows,
// its decimals, its Cash position as "today". Every state has a sentence; the
// before/after tiles print the Inspector's registers.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { addressWorkspace } from "../../lib/lab-address";
import { DEMO_ADDRESS_NEAR, DEMO_NEAR_ADDR, DEMO_STRESS_NEAR } from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, NOT_FOUND_ADDR } from "../fixtures/inspector";

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: DEMO_NEAR_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: null,
    age: { seconds: null, unresolved: false, refreshFailed: false },
    reload: () => {},
    ...overrides,
  };
}
const view = (overrides: Partial<AddressReading>) => deriveInspectorView(reading(overrides), TIER_FALLBACK);
const near = () => view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } });

test("idle and invalid: no address is a prompt, a bad address is a refusal; nothing is looked up", () => {
  const idle = addressWorkspace({ address: "", view: null, selectedId: null });
  expect(idle.state).toBe("idle");
  expect(idle.headline).toEqual({ emphasis: "Stress one address.", rest: "", tone: "refused", dek: "Enter an address; the committed scenarios are applied to its Cash position." });
  expect(idle.rows).toEqual([]);
  expect(idle.tiles).toBeNull();
  const invalid = addressWorkspace({ address: "0xnope", view: view({ address: "0xnope", valid: false }), selectedId: null });
  expect(invalid.state).toBe("invalid");
  expect(invalid.headline.emphasis).toBe("Not an address.");
  expect(invalid.headline.dek).toBe("An address is 0x followed by exactly 40 hex characters. Nothing was looked up.");
});

test("loading and unavailable follow the lookup, then the stress lookup", () => {
  const l = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({}), selectedId: null });
  expect(l.state).toBe("loading");
  expect(l.headline.emphasis).toBe("Looking up 0x7a3f…c21e…");
  const stressLoading = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) } }), selectedId: null });
  expect(stressLoading.state).toBe("loading");
  expect(stressLoading.headline.emphasis).toBe("Running the committed scenarios for 0x7a3f…c21e…");
  const u = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(u.state).toBe("unavailable");
  expect(u.headline.emphasis).toBe("The lookup for 0x7a3f…c21e could not be completed.");
  expect(u.headline.dek).toBe("Rate limited (429), retry after 30s. Nothing about this address is known from a failed lookup.");
  const su = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(su.state).toBe("unavailable");
  expect(su.headline.emphasis).toBe("The scenarios for 0x7a3f…c21e could not be run.");
});

test("no position and withheld are the stress reading's own words", () => {
  const none = addressWorkspace({
    address: NOT_FOUND_ADDR,
    view: view({ address: NOT_FOUND_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) }, stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] }) } }),
    selectedId: null,
  });
  expect(none.state).toBe("no-position");
  expect(none.headline.emphasis).toBe(`No Cash position for ${NOT_FOUND_ADDR.slice(0, 6)}…${NOT_FOUND_ADDR.slice(-4)} in batch 1.`);
  expect(none.headline.tone).toBe("refused");
  const withheld = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: view({
      lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) },
      stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, found: null, lookup_complete: false, scenarios: [], withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] }) },
    }),
    selectedId: null,
  });
  expect(withheld.state).toBe("withheld");
  expect(withheld.headline.emphasis).toBe("Cannot say — the Cash book is withheld for 0x7a3f…c21e.");
  expect(withheld.cause).not.toBeNull();
});

test("rows: the demo near account under its three scenarios, the selection, the before/after tiles in the Inspector's registers", () => {
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "eth_minus_30" });
  expect(w.state).toBe("rows");
  expect(w.rows.map((r) => r.id)).toEqual(DEMO_STRESS_NEAR.scenarios.map((s) => s.id));
  expect(w.selected?.id).toBe("eth_minus_30");
  expect(w.batchId).toBe(18251);
  expect(w.decimals).toBe(6);
  expect(w.headline.emphasis).toBe("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  expect(w.headline.tone).toBe("crit");
  expect(w.headline.dek).toMatch(/^Room today \$190\.50; after the shock, over cap by \$[0-9,]+\./);
  const t = w.tiles!;
  expect(t.debtBefore).toEqual({ value: "$4,822", tone: "neutral" });
  expect(t.capBefore).toEqual({ value: "$5,012", tone: "neutral" });
  expect(t.roomBefore).toEqual({ value: "$190.50", tone: "warn" });
  expect(t.statusBefore).toEqual({ value: "Near cap", tone: "warn" });
  expect(t.debtAfter.value).toBe("$4,822");
  expect(t.capAfter.value).toMatch(/^\$[0-9,]+/);
  expect(t.roomAfter.value).toMatch(/^over cap by \$/);
  expect(t.roomAfter.tone).toBe("crit");
  expect(t.statusAfter).toEqual({ value: "Liquidatable", tone: "crit" });
  // A selection the address does not carry falls back to the first row; a null selection too.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "ghost" }).selected?.id).toBe("eth_minus_30");
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: null }).selected?.id).toBe("eth_minus_30");
  // The projection row: no flip within its horizons reads as staying inside the cap, in its own words.
  const proj = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(proj.selected?.projection).not.toBeNull();
  expect(["ok", "warn", "crit"]).toContain(proj.headline.tone);
});
```

Before Step 3, run once with `console.log(JSON.stringify(w.tiles), w.headline.dek)` in the last test to read the demo's exact after-cap and over-cap figures from `DEMO_STRESS_NEAR`, then replace the two regexes on `dek` and `capAfter` with the literal strings and delete the log. The report states the literals.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-address'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-address.ts
// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import type { StressRow, StressSide } from "./address-stress";
import { truncateAddress } from "./format";
import { humanUsdFull } from "./human-price";
import type { CashStatus } from "./inspector-position";
import type { InspectorView } from "./inspector-view";
import type { LabHeadline } from "./lab-headline";
import { isWireScale } from "./wireGuard";

export type AddressWorkspaceState = "idle" | "invalid" | "loading" | "unavailable" | "no-position" | "withheld" | "rows";
export type TileTone = "crit" | "warn" | "ok" | "neutral" | "refused";
export interface AddressTile {
  readonly value: string;
  readonly tone: TileTone;
}
export interface AddressTiles {
  readonly debtBefore: AddressTile;
  readonly debtAfter: AddressTile;
  readonly capBefore: AddressTile;
  readonly capAfter: AddressTile;
  readonly roomBefore: AddressTile;
  readonly roomAfter: AddressTile;
  readonly statusBefore: AddressTile;
  readonly statusAfter: AddressTile;
}
export interface AddressWorkspace {
  readonly state: AddressWorkspaceState;
  readonly address: string;
  readonly rows: readonly StressRow[];
  readonly selected: StressRow | null;
  readonly headline: LabHeadline;
  readonly tiles: AddressTiles | null;
  readonly batchId: number | null;
  readonly decimals: number | null;
  readonly cause: string | null;
}

const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });
const REFUSED_TILE: AddressTile = { value: "—", tone: "refused" };

function sentence(text: string): string {
  const t = text.trim();
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

function empty(state: AddressWorkspaceState, address: string, headline: LabHeadline, cause: string | null = null): AddressWorkspace {
  return { state, address, rows: [], selected: null, headline, tiles: null, batchId: null, decimals: null, cause };
}

const STATUS_WORD: Record<CashStatus, AddressTile> = {
  liquidatable: { value: "Liquidatable", tone: "crit" },
  near: { value: "Near cap", tone: "warn" },
  healthy: { value: "Healthy", tone: "ok" },
  refused: { value: "Not computed", tone: "refused" },
  unknowable: { value: "Not computed", tone: "refused" },
};

function afterStatus(side: StressSide | null): AddressTile {
  if (side === null || side.verdict === "unknowable") return { value: "Not computed", tone: "refused" };
  return side.verdict === "liquidatable" ? { value: "Liquidatable", tone: "crit" } : { value: "Healthy", tone: "ok" };
}

function roomTile(room: bigint | null, decimals: number, tone: TileTone): AddressTile {
  if (room === null) return REFUSED_TILE;
  if (room < 0n) return { value: `over cap by ${humanUsdFull(-room, decimals)}`, tone: "crit" };
  return { value: humanUsdFull(room, decimals), tone };
}

function roomWords(room: bigint | null, decimals: number): string {
  if (room === null) return "not computed";
  return room < 0n ? `over cap by ${humanUsdFull(-room, decimals)}` : humanUsdFull(room, decimals);
}

function rowHeadline(short: string, row: StressRow, decimals: number): LabHeadline {
  if (!row.applicable) return refused(`${row.label} does not apply to ${short}.`, sentence(row.reason ?? "the engine gave no reason"));
  const before = row.before === null ? "not computed" : roomWords(row.before.room, decimals);
  const after = row.after === null ? "not computed" : roomWords(row.after.room, decimals);
  const dek = `Room today ${before}; after the shock, ${after}.`;
  if (row.flips === null) return refused(`Cannot say whether ${short} becomes liquidatable under ${row.label}.`, `${dek} One side of the comparison is withheld or unknowable.`);
  if (row.flips) return { emphasis: `${short} becomes liquidatable under ${row.label}.`, rest: "", tone: "crit", dek };
  if (row.after?.verdict === "liquidatable") return { emphasis: `${short} is liquidatable today and stays so under ${row.label}.`, rest: "", tone: "crit", dek };
  return { emphasis: `${short} stays inside its cap under ${row.label}.`, rest: "", tone: "ok", dek };
}

export function addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null }): AddressWorkspace {
  const { address, view, selectedId } = input;
  if (view === null || address === "") {
    return empty("idle", address, refused("Stress one address.", "Enter an address; the committed scenarios are applied to its Cash position."));
  }
  const short = truncateAddress(address);
  if (view.state === "invalid") return empty("invalid", address, refused("Not an address.", "An address is 0x followed by exactly 40 hex characters. Nothing was looked up."));
  if (view.state === "loading") return empty("loading", address, refused(`Looking up ${short}…`, "The position first; the committed scenarios follow it."));
  if (view.state === "unavailable") {
    return empty("unavailable", address, refused(`The lookup for ${short} could not be completed.`, `${sentence(view.headline.dek.split(". ")[0] ?? view.headline.dek)} Nothing about this address is known from a failed lookup.`));
  }
  if (view.stressLoad.phase === "loading") return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  if (view.stressLoad.phase === "error") return empty("unavailable", address, refused(`The scenarios for ${short} could not be run.`, `${sentence(view.stressLoad.message)} The position above is unaffected.`));
  const stress = view.stress;
  if (stress === null) return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  const batchId = view.batchId;
  if (stress.kind === "no-position") {
    return empty("no-position", address, refused(`No Cash position for ${short} in batch ${batchId === null ? "?" : String(batchId)}.`, "The lookup is complete: there is nothing to stress."));
  }
  if (stress.kind === "withheld") {
    return empty("withheld", address, refused(`Cannot say — the Cash book is withheld for ${short}.`, `${sentence(stress.cause)} A withheld book is not a computed book.`), stress.cause);
  }
  const rows = stress.rows;
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const decimals = view.decimals !== null && isWireScale(view.decimals) ? view.decimals : null;
  if (selected === null || decimals === null || view.cash === null) {
    return { state: "rows", address, rows, selected, headline: refused(`No scenario applies to ${short}.`, "The stress response carried no scenario for this account."), tiles: null, batchId, decimals, cause: null };
  }
  const money = (v: bigint | null): AddressTile => (v === null ? REFUSED_TILE : { value: humanUsdFull(v, decimals), tone: "neutral" });
  const before = view.cash;
  const roomToneBefore: TileTone = before.status === "liquidatable" ? "crit" : before.status === "near" ? "warn" : "neutral";
  const after = selected.after;
  const tiles: AddressTiles = {
    debtBefore: money(before.debt),
    capBefore: money(before.cap),
    roomBefore: roomTile(before.room, decimals, roomToneBefore),
    statusBefore: STATUS_WORD[before.status],
    debtAfter: money(after?.debt ?? null),
    capAfter: money(after?.cap ?? null),
    roomAfter: after === null ? REFUSED_TILE : roomTile(after.room, decimals, after.verdict === "liquidatable" ? "crit" : "neutral"),
    statusAfter: afterStatus(after),
  };
  return { state: "rows", address, rows, selected, headline: rowHeadline(short, selected, decimals), tiles, batchId, decimals, cause: null };
}
```

`CashPosition.debt/cap/room` are the Plan 2 reader's bigint-or-null fields; `view.cash.status` is `CashStatus`. `truncateAddress` prints `0x7a3f…c21e` (the Inspector's kicker form); if it prints a different width the pins follow it — it is the shared law.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts`
Expected: 4 passed, after the two regexes are frozen into literals (Step 1's note). If `DEMO_STRESS_NEAR`'s `eth_minus_30` row does not flip the near account, the demo body — not this module — is wrong: report it and stop (the Plan 2 weld pinned "Yes" for that row).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-address.ts web/tests/unit/lab-address.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-address - the one-address workspace over the Inspector's own reading, every state its own sentence, before/after tiles in the account register" -- web/lib/lab-address.ts web/tests/unit/lab-address.spec.ts
```

---
### Task 7: `lab-classify` (the two classifiers, moved) and `lab-compare` (the set run as signed shares) (R6, R9)

**Files:**
- Create: `web/lib/lab-classify.ts`, `web/lib/lab-compare.ts`
- Test: `web/tests/unit/lab-classify-run-book.spec.ts`, `web/tests/unit/lab-classify-set-run.spec.ts` (moved), `web/tests/unit/lab-compare.spec.ts`

**Interfaces:**
- Consumes: `lib/runbook.ts` (`LabRunBookEngine`), `lib/runbookSet.ts` (`SetRunEngineSummary`, `RunBookSetResponse`, `SetRunScenarioResult`), `lib/wireGuard.ts`, `lib/human-usd.ts`, `lib/lab-headline.ts` (`signedUsd`), `lib/percent.ts` (`formatTenths`).
- Produces: `classifyRunBookEngine(engine): { malformedFields: string[] }`, `classifySetRunEngine(engine): { malformedFields: string[] }` (moved verbatim); `CompareKind`, `CompareRow`, `CompareView`, `shareTenths(delta, denominator): bigint | null`, `compareRows(set, engine): CompareView`.

- [ ] **Step 1: The move — both classifiers verbatim**

Create `web/lib/lab-classify.ts`: the whole of `web/app/lab/engineClassification.ts` (its helpers `isRecord`, `isNullableWireDecimal`, `isNullableWirePopulation`, `aggregateChecks`, `transitionChecks` and `classifyRunBookEngine`, lines 48–324) followed by the whole of `web/app/lab/setRunClassification.ts` (its helpers and `classifySetRunEngine`, lines 70–149), each function body byte-for-byte; the two files' duplicated private helpers (`isRecord`, `isNullableWirePopulation`) are kept ONCE (they are identical — verify with `diff` and say so in the report); imports become `./runbook`, `./runbookSet`, `./wireGuard`. Header:

```ts
// web/lib/lab-classify.ts
// The run-book and set-run engine classifiers: every field a result carries,
// checked against the wire contract before anything is read from it. A
// malformed engine is refused by the names of its fields. Moved verbatim from
// the old Lab's engineClassification.ts and setRunClassification.ts.
```

Move the specs: copy `web/tests/unit/engine-classification.spec.ts` to `web/tests/unit/lab-classify-run-book.spec.ts` and `web/tests/unit/set-run-classification.spec.ts` to `web/tests/unit/lab-classify-set-run.spec.ts`, changing only the import paths to `../../lib/lab-classify`. Do not delete the originals (Task 12 does).

Run: `cd web && npx playwright test --project=unit tests/unit/lab-classify-run-book.spec.ts tests/unit/lab-classify-set-run.spec.ts`
Expected: 28 + 11 passed — the same counts as the originals.

- [ ] **Step 2: The compare pins (failing)**

```ts
// web/tests/unit/lab-compare.spec.ts
// Compare: each scenario's contribution as a signed share of the engine's own
// book, the wire's sanctioned denominator; every non-answer is its own kind
// and never a dot at zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { compareRows, shareTenths, type RunBookSetResponse, type SetRunEngineSummary, type SetRunScenarioResult } from "../../lib/lab-compare";

const BASE = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/run-book-set.json", import.meta.url)), "utf8")) as RunBookSetResponse;
const TEMPLATE_ENGINE = BASE.results[0]!.engines[0]!;
const TEMPLATE_RESULT = BASE.results[0]!;

const summary = (overrides: Partial<SetRunEngineSummary>): SetRunEngineSummary => ({ ...TEMPLATE_ENGINE, engine: "debt_manager", usd_decimals: 6, ...overrides });
const result = (id: string, label: string, overrides: Partial<SetRunScenarioResult>): SetRunScenarioResult => ({
  ...TEMPLATE_RESULT,
  scenario_id: id,
  scenario_version: "v1",
  label,
  covered_engines: ["debt_manager"],
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [],
  ...overrides,
});
const setOf = (results: SetRunScenarioResult[]): RunBookSetResponse => ({ ...BASE, requested_scenario_ids: results.map((r) => r.scenario_id), results });

test("shareTenths: signed, truncated toward zero, null without a positive denominator", () => {
  expect(shareTenths(1_280_000_000_000n, 27_828_808_216_758n)).toBe(45n);
  expect(shareTenths(-1n, 3n)).toBe(0n);
  expect(shareTenths(-3n, 2n)).toBe(-1500n);
  expect(shareTenths(1n, 0n)).toBeNull();
  expect(shareTenths(1n, -5n)).toBeNull();
});

test("points are ranked by |share|, the words carry sign and tier, every non-answer keeps its own kind in wire order after the points", () => {
  const set = setOf([
    result("ethfi_minus_50", "ETHFI -50 percent", { engines: [summary({ eligible_debt_delta_usd: "9800000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 2 })] }),
    result("eth_minus_30", "ETH -30 percent", { engines: [summary({ eligible_debt_delta_usd: "1280000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 118 })] }),
    result("weeth_market_depeg_oracles_held", "weETH market depeg to 0.95 (oracles held)", { engines: [summary({ eligible_debt_delta_usd: "0", total_debt_usd_before: "27828808216758", flipped_to_eligible: 0 })] }),
    result("held", "Withheld one", { covered_engines: [], withheld_engines: ["debt_manager"] }),
    result("legacy_only", "Legacy only", { covered_engines: ["aave_v3_etherfi"], engines: [summary({ engine: "aave_v3_etherfi", usd_decimals: 8 })] }),
    result("absent", "Unmeasurable one", { covered_engines: [], unmeasurable_engines: [{ engine: "debt_manager", reason: "no_measurable_positions", counts: { positions_in_batch: 0, refused_in_batch: 0, unrebuildable: 0 }, note: "n" }] }),
    result("zero_book", "Empty book", { engines: [summary({ eligible_debt_delta_usd: "5", total_debt_usd_before: "0" })] }),
    result("bad", "Bad wire", { engines: [summary({ eligible_debt_delta_usd: "1e6" })] }),
    result("rate", "Rate step", { engines: [summary({ eligible_debt_delta_usd: "-2000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: null })] }),
  ]);
  const v = compareRows(set, "debt_manager");
  expect(v.engine).toBe("debt_manager");
  expect(v.batchId).toBe(BASE.batch.id);
  expect(v.freshness).toBe(BASE.evaluation.freshness);
  // Points ranked by |share|, then by |Δ| (a tie under a tenth still ranks by contribution), then wire order; every non-answer after, in wire order.
  expect(v.rows.map((r) => [r.id, r.kind])).toEqual([
    ["eth_minus_30", "point"],
    ["ethfi_minus_50", "point"],
    ["rate", "point"],
    ["weeth_market_depeg_oracles_held", "point"],
    ["held", "withheld"],
    ["legacy_only", "not-covered"],
    ["absent", "unmeasurable"],
    ["zero_book", "no-denominator"],
    ["bad", "unreadable"],
  ]);
  const eth = v.rows[0]!;
  expect(eth.shareTenths).toBe(45n);
  expect(eth.shareText).toBe("+4.5%");
  expect(eth.deltaText).toBe("+$1.2M");
  expect(eth.newly).toBe(118);
  // A contribution too small for a tenth keeps its sign and says it is under the resolution — never "+0%".
  expect(v.rows[1]?.shareText).toBe("+<0.1%");
  expect(v.rows[1]?.deltaText).toBe("+$9,800");
  expect(v.rows[2]?.shareText).toBe("−<0.1%");
  expect(v.rows[2]?.deltaText).toBe("−$2,000");
  expect(v.rows[2]?.newly).toBeNull();
  expect(v.rows[3]?.shareText).toBe("0%");
  expect(v.rows[3]?.deltaText).toBe("+$0");
  expect(v.rows[4]?.reason).toBe("withheld");
  expect(v.rows[5]?.reason).toBe("not modelled");
  expect(v.rows[6]?.reason).toBe("no_measurable_positions");
  expect(v.rows[7]?.reason).toBe("no denominator");
  expect(v.rows[7]?.deltaText).toBe("+<$0.01");
  expect(v.rows[8]?.reason).toContain("eligible_debt_delta_usd");
  for (const r of v.rows.slice(4)) expect(r.shareTenths).toBeNull();
});

test("a malformed summary is contradictory, named by the classifier, and never a point", () => {
  const set = setOf([result("x", "X", { engines: [summary({ accounts: -1 })] })]);
  const v = compareRows(set, "debt_manager");
  expect(v.rows[0]?.kind).toBe("contradictory");
  expect(v.rows[0]?.reason).toContain("accounts");
  expect(v.rows[0]?.shareTenths).toBeNull();
});
```

Before Step 4, check the fixture's `BASE.results[0].engines[0]` has every field `SetRunEngineSummary` requires (it is the contract's own 200 example, so it does); the `summary()` spread rides on it. If `unmeasurable_engines[].reason` is an enum the literal `"no_measurable_positions"` is not in, use the fixture's own value from `web/tests/fixtures/run-book-set.no-denominator.json` (grep `unmeasurable_engines`) and pin that.

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-compare.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-compare'`.

- [ ] **Step 4: The compare module**

```ts
// web/lib/lab-compare.ts
// Compare scenarios: the set run's per-scenario summary for one engine as a
// signed share of that engine's book — `eligible_debt_delta_usd` over
// `total_debt_usd_before`, the denominator the wire itself sanctions. A
// scenario that did not answer for the engine keeps its own kind; it is never
// a dot at zero.
import type { components } from "@solvent/client";
import { classifySetRunEngine } from "./lab-classify";
import { signedUsd } from "./lab-headline";
import { formatTenths } from "./percent";
import { isWireDecimal, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookSetResponse = Schemas["RunBookSetResponse"];
export type SetRunScenarioResult = Schemas["SetRunScenarioResult"];
export type SetRunEngineSummary = Schemas["SetRunEngineSummary"];

export type CompareKind = "point" | "withheld" | "not-covered" | "unmeasurable" | "contradictory" | "no-denominator" | "unreadable";

export interface CompareRow {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly kind: CompareKind;
  readonly deltaUsd: bigint | null;
  readonly decimals: number | null;
  readonly shareTenths: bigint | null;
  readonly shareText: string;
  readonly deltaText: string;
  readonly reason: string | null;
  /** The engine's own flip count (`flipped_to_eligible`); null where the engine does not speak it. */
  readonly newly: number | null;
}

export interface CompareView {
  readonly engine: string;
  readonly rows: readonly CompareRow[];
  readonly batchId: number;
  readonly freshness: Schemas["SetRunEvaluation"]["freshness"];
  readonly newestServable: number | null;
  readonly evaluated: number;
  readonly configVersion: string;
  readonly servedAt: string;
}

/** Signed tenths of a percent, truncated toward zero; null without a positive denominator. */
export function shareTenths(delta: bigint, denominator: bigint): bigint | null {
  if (denominator <= 0n) return null;
  return (delta * 1000n) / denominator;
}

/** The share's words: a zero delta is "0%"; a nonzero delta under a tenth keeps its sign and says so; otherwise the signed tenths. */
function shareWords(delta: bigint, tenths: bigint): string {
  if (delta === 0n) return "0%";
  if (tenths === 0n) return delta < 0n ? "−<0.1%" : "+<0.1%";
  return tenths < 0n ? formatTenths(tenths) : `+${formatTenths(tenths)}`;
}

function rowOf(r: SetRunScenarioResult, engine: string): CompareRow {
  const base = { id: r.scenario_id, version: r.scenario_version, label: r.label, deltaUsd: null, decimals: null, shareTenths: null, shareText: "—", deltaText: "—", newly: null };
  if (r.withheld_engines.includes(engine)) return { ...base, kind: "withheld", reason: "withheld" };
  const absent = r.unmeasurable_engines.find((a) => a.engine === engine);
  if (absent !== undefined) return { ...base, kind: "unmeasurable", reason: absent.reason };
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return { ...base, kind: "not-covered", reason: "not modelled" };
  const malformed = classifySetRunEngine(e).malformedFields;
  if (malformed.length > 0) return { ...base, kind: "contradictory", reason: malformed.join(", ") };
  if (!isWireScale(e.usd_decimals) || !isWireDecimal(e.eligible_debt_delta_usd) || !isWireDecimal(e.total_debt_usd_before)) {
    const bad = [
      isWireScale(e.usd_decimals) ? null : "usd_decimals",
      isWireDecimal(e.eligible_debt_delta_usd) ? null : "eligible_debt_delta_usd",
      isWireDecimal(e.total_debt_usd_before) ? null : "total_debt_usd_before",
    ].filter((f): f is string => f !== null);
    return { ...base, kind: "unreadable", reason: bad.join(", ") };
  }
  const delta = BigInt(e.eligible_debt_delta_usd);
  const share = shareTenths(delta, BigInt(e.total_debt_usd_before));
  const deltaText = signedUsd(delta, e.usd_decimals);
  const newly = e.flipped_to_eligible;
  if (share === null) return { ...base, kind: "no-denominator", deltaUsd: delta, decimals: e.usd_decimals, deltaText, reason: "no denominator", newly };
  return { ...base, kind: "point", deltaUsd: delta, decimals: e.usd_decimals, shareTenths: share, shareText: shareWords(delta, share), deltaText, reason: null, newly };
}

const abs = (t: bigint): bigint => (t < 0n ? -t : t);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

export function compareRows(set: RunBookSetResponse, engine: string): CompareView {
  const rows = set.results.map((r) => rowOf(r, engine));
  // |share| descending, then |Δ| descending (a tie under a tenth still ranks by contribution), then wire order (a stable sort).
  const points = rows
    .filter((r) => r.kind === "point")
    .sort((a, b) => compareBig(abs(b.shareTenths ?? 0n), abs(a.shareTenths ?? 0n)) || compareBig(abs(b.deltaUsd ?? 0n), abs(a.deltaUsd ?? 0n)));
  const rest = rows.filter((r) => r.kind !== "point");
  return {
    engine,
    rows: [...points, ...rest],
    batchId: set.batch.id,
    freshness: set.evaluation.freshness,
    newestServable: set.evaluation.newest_servable_batch_id,
    evaluated: set.evaluation.scenarios_evaluated,
    configVersion: set.scenario_config_version,
    servedAt: set.served_at,
  };
}
```

`Array.prototype.sort` is stable, so rows equal on both keys keep wire order. `signedUsd(5n, 6)` is `+<$0.01` — the Book's dust display keeps its sign.

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-compare.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-classify.ts web/lib/lab-compare.ts web/tests/unit/lab-classify-run-book.spec.ts web/tests/unit/lab-classify-set-run.spec.ts web/tests/unit/lab-compare.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-classify moved verbatim into lib; lab-compare - each scenario as a signed share of the engine's own book, every non-answer its own kind" -- web/lib/lab-classify.ts web/lib/lab-compare.ts web/tests/unit/lab-classify-run-book.spec.ts web/tests/unit/lab-classify-set-run.spec.ts web/tests/unit/lab-compare.spec.ts
```

---
### Task 8: `lab-reading` — the listing, the run records, the set record, the dispatchers

**Files:**
- Create: `web/lib/lab-reading.ts`
- Test: `web/tests/unit/lab-reading.spec.ts` (the pure record reducers; the hook itself is proven by the e2e contract's one-POST-per-click pins in Task 12)

**Interfaces:**
- Consumes: `lib/api.ts` (`getSolventClient`, `solventBaseUrl`), `lib/address-lookup.ts` (`Phase<T>`), `lib/lookup-error.ts` (`describeLookupError`), `lib/runbook.ts` (`runBookScenario`, `RunBookOutcome`), `lib/runbookSet.ts` (`runBookSet`, `SetRunOutcome`), `lib/lab-library.ts` (`RunRecord`, `SetRecord`, `ScenariosResponse`).
- Produces: `LabReading { listing: Phase<ScenariosResponse>; runs: ReadonlyMap<string, RunRecord>; set: SetRecord | null; run(id); runSet(ids); reloadListing() }`, `useLabReading(): LabReading`; pure: `canDispatch(runs, id): boolean`, `withRunning(runs, id, now)`, `withSettled(runs, id, outcome, now)`, `canDispatchSet(set): boolean`.

- [ ] **Step 1: The reducer pins (failing)**

```ts
// web/tests/unit/lab-reading.spec.ts
// The run records' law: one run per id in flight, a settled record replaces
// the running one and nothing else, a second click while running is a no-op.
import { expect, test } from "@playwright/test";
import { canDispatch, canDispatchSet, withRunning, withSettled } from "../../lib/lab-reading";
import type { RunRecord } from "../../lib/lab-library";

test("withRunning marks one id and leaves the others; canDispatch refuses an id in flight", () => {
  const empty = new Map<string, RunRecord>();
  const one = withRunning(empty, "eth_minus_30", 100);
  expect(one.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100 });
  expect(empty.size).toBe(0);
  expect(canDispatch(one, "eth_minus_30")).toBe(false);
  expect(canDispatch(one, "ethfi_minus_50")).toBe(true);
  const two = withRunning(one, "ethfi_minus_50", 101);
  expect(two.size).toBe(2);
  expect(two.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100 });
});

test("withSettled replaces the running record with the outcome and keeps every other record", () => {
  const running = withRunning(withRunning(new Map(), "a", 1), "b", 2);
  const settled = withSettled(running, "a", { kind: "not-served" }, 5);
  expect(settled.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 5 });
  expect(settled.get("b")).toEqual({ phase: "running", startedAt: 2 });
  expect(canDispatch(settled, "a")).toBe(true);
  // A settlement for an id that was never running is still recorded — the wire answered, the page shows it.
  expect(withSettled(new Map(), "c", { kind: "not-served" }, 9).get("c")?.phase).toBe("settled");
});

test("canDispatchSet: only when no set is in flight", () => {
  expect(canDispatchSet(null)).toBe(true);
  expect(canDispatchSet({ phase: "running", ids: ["a"], startedAt: 1 })).toBe(false);
  expect(canDispatchSet({ phase: "settled", ids: ["a"], outcome: { kind: "not-served" }, at: 2 })).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-reading.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-reading'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-reading.ts
// What the Scenarios page reads and dispatches: the committed listing, one run
// record per scenario id, one set record. A run is an action — nothing here
// dispatches on its own; the surface calls `run` / `runSet` on a click or a
// deep link. One run per id and one set at a time; a second ask is a no-op.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./address-lookup";
import { getSolventClient, solventBaseUrl } from "./api";
import type { RunRecord, ScenariosResponse, SetRecord } from "./lab-library";
import { describeLookupError } from "./lookup-error";
import { runBookScenario, type RunBookOutcome } from "./runbook";
import { runBookSet, type SetRunOutcome } from "./runbookSet";

export interface LabReading {
  readonly listing: Phase<ScenariosResponse>;
  readonly runs: ReadonlyMap<string, RunRecord>;
  readonly set: SetRecord | null;
  readonly run: (id: string) => void;
  readonly runSet: (ids: readonly string[]) => void;
  readonly reloadListing: () => void;
}

export const canDispatch = (runs: ReadonlyMap<string, RunRecord>, id: string): boolean => runs.get(id)?.phase !== "running";
export const canDispatchSet = (set: SetRecord | null): boolean => set === null || set.phase !== "running";

export function withRunning(runs: ReadonlyMap<string, RunRecord>, id: string, now: number): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "running", startedAt: now });
  return next;
}

export function withSettled(runs: ReadonlyMap<string, RunRecord>, id: string, outcome: RunBookOutcome, now: number): Map<string, RunRecord> {
  const next = new Map(runs);
  next.set(id, { phase: "settled", outcome, at: now });
  return next;
}

export function useLabReading(): LabReading {
  const [listing, setListing] = useState<Phase<ScenariosResponse>>({ phase: "loading" });
  const [epoch, setEpoch] = useState(0);
  const [runs, setRuns] = useState<ReadonlyMap<string, RunRecord>>(new Map());
  const [set, setSet] = useState<SetRecord | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const setRef = useRef(set);
  setRef.current = set;
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controller = new AbortController();
    setListing({ phase: "loading" });
    getSolventClient()
      .scenarios(controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) setListing({ phase: "ready", value });
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setListing({ phase: "error", message: describeLookupError(cause) });
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch]);

  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  const run = useCallback((id: string) => {
    if (!canDispatch(runsRef.current, id)) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setRuns((prev) => withRunning(prev, id, Date.now()));
    runBookScenario(solventBaseUrl(), id, { signal: controller.signal }).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, outcome, Date.now()));
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setRuns((prev) => withSettled(prev, id, { kind: "unreachable", message: describeLookupError(cause) }, Date.now()));
      },
    );
  }, []);

  const runSet = useCallback((ids: readonly string[]) => {
    if (!canDispatchSet(setRef.current)) return;
    const controller = new AbortController();
    controllers.current.set("__set__", controller);
    const asked = [...ids];
    setSet({ phase: "running", ids: asked, startedAt: Date.now() });
    runBookSet(solventBaseUrl(), asked, { signal: controller.signal }).then(
      (outcome: SetRunOutcome) => {
        if (controller.signal.aborted) return;
        controllers.current.delete("__set__");
        setSet({ phase: "settled", ids: asked, outcome, at: Date.now() });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete("__set__");
        setSet({ phase: "settled", ids: asked, outcome: { kind: "unreachable", message: describeLookupError(cause) }, at: Date.now() });
      },
    );
  }, []);

  const reloadListing = useCallback(() => setEpoch((e) => e + 1), []);
  return { listing, runs, set, run, runSet, reloadListing };
}
```

`runBookScenario` never rejects for wire outcomes (it returns `unreachable`/`failed`), and an id outside the contract's pattern resolves `refused-locally` as the set path does (it no longer throws); the rejection arms remain only as a guard, and the surface passes listed ids. `describeLookupError` is Plan 2's message mapper. The `react-hooks/refs` rule: `runsRef.current = runs` assignments happen during render on purpose (the latest records without a stale closure) — if lint flags them, move both into a `useEffect` with no deps and say so in the report.

- [ ] **Step 4: Run to verify it passes, then the gates**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-reading.spec.ts && npm run typecheck && npm run lint`
Expected: 3 passed; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-reading.ts web/tests/unit/lab-reading.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-reading - the listing, one run record per scenario, one set record; nothing dispatches on its own and nothing dispatches twice" -- web/lib/lab-reading.ts web/tests/unit/lab-reading.spec.ts
```

---
### Task 9: `lab-view` — one view model for the surface and the tests (R2, R3, R13)

**Files:**
- Create: `web/lib/lab-view.ts`
- Test: `web/tests/unit/lab-view.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8 (`laneReading`, the headlines, `libraryRows`/`definitionSkew`/`cashEngineOf`/`cashRefusalOf`, `moversTable`, `classifyRunBookEngine`, `compareRows`, `LabReading`, `RunRecord`, `SetRecord`), `lib/cash-view.ts` (`ViewChip`), `lib/resultIdentity.ts` (`ResultIdentity`), `lib/refusal-phrasebook.ts` (`plainCause`), `lib/inspector-headline.ts` (`engineName`), `lib/inspector-position.ts` (`CASH`, `LEGACY`), `lib/inspector-view.ts` (`LoadPhase`), `lib/prose.ts`, `lib/wireGuard.ts`.
- Produces: `BookState`, `Banner`, `EngineResult`, `EngineReading`, `BookWorkspace`, `CompareState`, `LabUi { selectedId: string | null; checked: ReadonlySet<string> }`, `LabView`, `deriveLabView(reading: LabReading, ui: LabUi): LabView`, `readEngine(run, engine, definition): EngineReading`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-view.spec.ts
// The Scenarios page's one view model. Every book-workspace state, the banners,
// the chips, and the per-engine readings — derived once, read by the surface
// and by these pins alike.
import { expect, test } from "@playwright/test";
import type { LabReading } from "../../lib/lab-reading";
import type { RunRecord, SetRecord } from "../../lib/lab-library";
import { deriveLabView, readEngine } from "../../lib/lab-view";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf, type Engine } from "./helpers/run-book-engine";

function reading(overrides: Partial<LabReading>): LabReading {
  return { listing: { phase: "ready", value: SCENARIOS }, runs: new Map(), set: null, run: () => {}, runSet: () => {}, reloadListing: () => {}, ...overrides };
}
const settled = (id: string, outcome: RunRecord extends { outcome: infer O } ? O : never): Map<string, RunRecord> => new Map([[id, { phase: "settled", outcome, at: 1 }]]);
const ui = (selectedId: string | null = "eth_minus_30", checked: string[] = []) => ({ selectedId, checked: new Set(checked) });

/** The demo's Cash engine: the plan's R16 figures on the plan's movement table. */
function demoCash(overrides: Partial<Engine> = {}): Engine {
  const e = cashEngine(DEMO_CASH_TABLE);
  return {
    ...e,
    before: { ...e.before, accounts: 1406, eligible_accounts: 49, eligible_debt_usd: "6949455788", bad_debt_usd: "239603961", total_debt_usd: "27828808216758" },
    after: { ...e.after, accounts: 1406, eligible_accounts: 167, eligible_debt_usd: "1286949455788", bad_debt_usd: "41020000000", total_debt_usd: "27828808216758" },
    newly_eligible_accounts: 118,
    eligible_debt_delta_usd: "1280000000000",
    bad_debt_delta_usd: "40780396039",
    movers_total: 118,
    movers_note: "the top 20 of 118, ranked by the drop in the engine's own ratio",
    ...overrides,
  };
}
const ETH_DEF = SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!;

test("listing loading and unavailable; an empty listing; the library follows the listing", () => {
  const loading = deriveLabView(reading({ listing: { phase: "loading" } }), ui());
  expect(loading.book.state).toBe("listing-loading");
  expect(loading.library).toEqual([]);
  expect(loading.book.headline.emphasis).toBe("Loading the committed scenarios…");
  const failed = deriveLabView(reading({ listing: { phase: "error", message: "rate limited (429), retry after 30s" } }), ui());
  expect(failed.book.state).toBe("listing-unavailable");
  expect(failed.book.headline.dek).toBe("Rate limited (429), retry after 30s. Nothing can run until the listing answers.");
  const empty = deriveLabView(reading({ listing: { phase: "ready", value: { ...SCENARIOS, scenarios: [] } } }), ui());
  expect(empty.book.state).toBe("not-run");
  expect(empty.book.headline.emphasis).toBe("No committed scenarios are listed.");
  const v = deriveLabView(reading({}), ui(null, ["ethfi_minus_50"]));
  expect(v.library.map((r) => r.id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  expect(v.selectedId).toBe("eth_minus_30"); // null selection → the first listed
  expect(v.library[0]?.selected).toBe(true);
  expect(v.checked).toEqual(["ethfi_minus_50"]);
  expect(v.configVersion).toBe(SCENARIOS.scenario_config_version);
});

test("not run: the definition, the dashed tone, no chips beyond identity, no engines", () => {
  const v = deriveLabView(reading({}), ui());
  expect(v.book.state).toBe("not-run");
  expect(v.book.banner).toBeNull();
  expect(v.book.kicker).toBe("ETH -30 percent · Cash book");
  expect(v.book.headline.emphasis).toBe("ETH -30 percent");
  expect(v.book.headline.rest).toBe("— 1 committed shock, not run yet.");
  expect(v.book.headline.tone).toBe("refused");
  expect(v.book.definition?.id).toBe("eth_minus_30");
  expect(v.book.run).toBeNull();
  expect(v.book.cash).toBeNull();
  expect(v.book.chips.map((c) => c.label)).toEqual(["Scenario", "Config"]);
  expect(v.book.chips[0]?.value).toBe("eth_minus_30 · v1");
  expect(v.book.identity).toBeNull();
});

test("running", () => {
  const v = deriveLabView(reading({ runs: new Map([["eth_minus_30", { phase: "running", startedAt: 1 }]]) }), ui());
  expect(v.book.state).toBe("running");
  expect(v.book.headline.emphasis).toBe("Running ETH -30 percent…");
});

test("the demo result: state, headline, chips, identity, both engine readings, the movers, no banner", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], DEFINITION_ETH);
  const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: run }) }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBeNull();
  expect(v.book.headline.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(v.book.headline.rest).toBe("across 118 accounts.");
  expect(v.book.chips.map((c) => [c.label, c.value])).toEqual([
    ["Result for batch", "18,251"],
    ["Scenario", "eth_minus_30 · v1"],
    ["Engines", "Aave v3 market (legacy) and Cash"],
    ["Config", "v1"],
  ]);
  expect(v.book.identity).toEqual({ scope: "book", batchId: 18251, configVersion: "v1", engines: ["aave_v3_etherfi", "debt_manager"], servedAt: "2026-08-08T20:22:50Z" });
  const cash = v.book.cash;
  if (cash?.kind !== "result") throw new Error("cash must read");
  expect(cash.result.newly).toBe(118);
  expect(cash.result.beforeEligible).toBe(49);
  expect(cash.result.afterEligible).toBe(167);
  expect(cash.result.deltaEligibleDebt).toBe(1_280_000_000_000n);
  expect(cash.result.deltaBadDebt).toBe(40_780_396_039n);
  expect(cash.result.laneChanged).toBe(941);
  expect(cash.result.heat.kind).toBe("ok");
  expect(cash.result.movers.total).toBe(118);
  const legacy = v.book.legacy;
  if (legacy?.kind !== "result") throw new Error("legacy must read");
  expect(legacy.result.engine).toBe("aave_v3_etherfi");
  expect(legacy.result.decimals).toBe(8);
  if (legacy.result.heat.kind !== "ok") throw new Error("legacy heat");
  expect(legacy.result.heat.view.merged).toBe(false);
});

test("withheld, not covered, contradictory, unreadable — each its own state and headline; the legacy reading is independent", () => {
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], DEFINITION_ETH, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven", note: "" }] });
  const w = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: withheld }) }), ui());
  expect(w.book.state).toBe("withheld");
  expect(w.book.headline.emphasis).toBe("Cannot say — the Cash book is withheld under ETH -30 percent.");
  expect(w.book.cash?.kind).toBe("withheld");
  expect(w.book.legacy?.kind).toBe("result");
  expect(w.book.chips.find((c) => c.label === "Engines")?.value).toBe("Aave v3 market (legacy) · Cash withheld");

  const legacyDef = SCENARIOS.scenarios.find((s) => s.id === "ethfi_minus_50")!;
  const legacyOnlyListing = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((s) => (s.id === "ethfi_minus_50" ? { ...s, engines: ["aave_v3_etherfi"] } : s)) };
  const nc = deriveLabView(
    reading({ listing: { phase: "ready", value: legacyOnlyListing }, runs: settled("ethfi_minus_50", { kind: "ok", response: runBookOf([legacyEngine({ 7: { 7: 1 } })], { ...legacyDef, engines: ["aave_v3_etherfi"] }) }) }),
    ui("ethfi_minus_50"),
  );
  expect(nc.book.state).toBe("not-covered");
  expect(nc.book.headline.dek).toBe("It models the Aave v3 market (legacy). The legacy result is below.");

  const bad = runBookOf([demoCash({ hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })], DEFINITION_ETH);
  const c = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: bad }) }), ui());
  expect(c.book.state).toBe("contradictory");
  expect(c.book.headline.emphasis).toBe("The result for ETH -30 percent contradicts itself.");
  expect(c.book.cash?.kind).toBe("contradictory");

  const unreadable = runBookOf([demoCash({ usd_decimals: 1.5 })], DEFINITION_ETH);
  const u = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: unreadable }) }), ui());
  expect(u.book.state).toBe("contradictory");
  expect(u.book.cash?.kind).toBe("unreadable");
  expect(u.book.headline.dek).toContain("usd_decimals");
});

test("banners: a superseded batch and a stale input keep the result; a changed version is its own state", () => {
  const superseded = runBookOf([demoCash()], DEFINITION_ETH, { batch: { ...runBookOf([]).batch, supersession: { superseded: true, legs: [], note: "" } } });
  const s = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: superseded }) }), ui());
  expect(s.book.state).toBe("result");
  expect(s.book.banner).toBe("superseded");
  expect(s.book.chips[0]).toEqual({ label: "Result for batch", value: "18,251 · superseded", tone: "warn", title: "a newer complete batch exists; run again for it" });

  const drifted = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((sc) => (sc.id === "eth_minus_30" ? { ...sc, path_assumption: "changed" } : sc)) };
  const d = deriveLabView(reading({ listing: { phase: "ready", value: drifted }, runs: settled("eth_minus_30", { kind: "ok", response: runBookOf([demoCash()], DEFINITION_ETH) }) }), ui());
  expect(d.book.state).toBe("result");
  expect(d.book.banner).toBe("stale-input");
  expect(d.book.skew).toEqual(["path assumption"]);

  const rev = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((sc) => (sc.id === "eth_minus_30" ? { ...sc, version: "v2" } : sc)) };
  const r = deriveLabView(reading({ listing: { phase: "ready", value: rev }, runs: settled("eth_minus_30", { kind: "ok", response: runBookOf([demoCash()], DEFINITION_ETH) }) }), ui());
  expect(r.book.state).toBe("definition-changed");
  expect(r.book.headline.emphasis).toBe("ETH -30 percent changed since this result was computed.");
  expect(r.book.cash).toBeNull();
});

test("every fetch failure is its own state with the failure sentence", () => {
  const at = (outcome: Parameters<typeof settled>[1]) => deriveLabView(reading({ runs: settled("eth_minus_30", outcome) }), ui()).book;
  expect(at({ kind: "not-served" }).state).toBe("not-served");
  expect(at({ kind: "no-batch", message: "no complete risk batch is available", retryAfterSeconds: 30 }).headline.dek).toBe("No complete risk batch is available (503). Retry after 30s.");
  expect(at({ kind: "rate-limited", retryAfterSeconds: null }).state).toBe("rate-limited");
  expect(at({ kind: "unreachable", message: "fetch failed" }).state).toBe("unreachable");
  expect(at({ kind: "failed", status: 500, message: "internal" }).headline.emphasis).toBe("The service answered 500.");
});

test("compare: idle, running, ok (both engines' views), failed", () => {
  expect(deriveLabView(reading({}), ui()).compare).toEqual({ kind: "idle" });
  const running: SetRecord = { phase: "running", ids: ["eth_minus_30", "ethfi_minus_50"], startedAt: 1 };
  expect(deriveLabView(reading({ set: running }), ui()).compare).toEqual({ kind: "running", ids: ["eth_minus_30", "ethfi_minus_50"] });
  const busy: SetRecord = { phase: "settled", ids: ["a"], outcome: { kind: "busy", message: "another evaluation holds the slot", maxInFlight: 1, inFlight: 1 }, at: 2 };
  const b = deriveLabView(reading({ set: busy }), ui()).compare;
  expect(b.kind).toBe("failed");
  if (b.kind === "failed") expect(b.headline.emphasis).toBe("The evaluator is busy.");
});

test("readEngine reads by id, refuses by name, and never manufactures a figure", () => {
  const run = runBookOf([demoCash()], DEFINITION_ETH);
  expect(readEngine(run, "aave_v3_etherfi", DEFINITION_ETH).kind).toBe("withheld");
  expect(readEngine(run, "aave_v3_etherfi", { ...DEFINITION_ETH, engines: ["debt_manager"] }).kind).toBe("not-covered");
  const r = readEngine(run, "debt_manager", DEFINITION_ETH);
  if (r.kind !== "result") throw new Error("must read");
  expect(r.result.eligibleDebtBefore).toBe(6_949_455_788n);
  expect(r.result.badDebtAfter).toBe(41_020_000_000n);
  const bad = readEngine(runBookOf([demoCash({ bad_debt_delta_usd: "-0.5" })], DEFINITION_ETH), "debt_manager", DEFINITION_ETH);
  expect(bad.kind).toBe("unreadable");
  if (bad.kind === "unreadable") expect(bad.fields).toContain("bad_debt_delta_usd");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-view.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-view'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-view.ts
// One view model for the Scenarios page. The surface reads it and prints it;
// the pins read it and check it; nothing below it decides a state twice. A
// result is read per engine, by engine id, under the classifier and the wire
// guards; a refusal of any kind is its own state with its own sentence.
import type { components } from "@solvent/client";
import type { ViewChip } from "./cash-view";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LoadPhase } from "./inspector-view";
import { classifyRunBookEngine } from "./lab-classify";
import { compareRows, type CompareView } from "./lab-compare";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  withheldHeadline,
  type LabHeadline,
} from "./lab-headline";
import { cashEngineOf, definitionSkew, libraryRows, type LibraryRow, type RunRecord, type ScenarioDefinition, type ScenariosResponse } from "./lab-library";
import { moversTable, type MoversTable } from "./lab-movers";
import type { LabReading } from "./lab-reading";
import { laneReading, type LaneReading } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import type { ResultIdentity } from "./resultIdentity";
import type { RunBookResponse } from "./runbook";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
type RunBookEngine = Schemas["RunBookEngine"];

export type BookState =
  | "listing-loading"
  | "listing-unavailable"
  | "not-run"
  | "running"
  | "result"
  | "not-covered"
  | "withheld"
  | "contradictory"
  | "definition-changed"
  | "not-served"
  | "no-batch"
  | "rate-limited"
  | "busy"
  | "unreachable"
  | "failed";
export type Banner = "stale-input" | "superseded" | null;

export interface EngineResult {
  readonly engine: string;
  readonly decimals: number;
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly eligibleDebtBefore: bigint;
  readonly eligibleDebtAfter: bigint;
  readonly deltaEligibleDebt: bigint;
  readonly badDebtBefore: bigint;
  readonly badDebtAfter: bigint;
  readonly deltaBadDebt: bigint;
  readonly measured: number;
  readonly laneChanged: number | null;
  readonly heat: LaneReading;
  readonly movers: MoversTable;
  readonly realization: RunBookEngine["market_realization"];
  readonly projection: RunBookEngine["projection"];
  readonly note: string;
  /** `hf_transitions.note`, verbatim — the wire's own words about its lanes, printed in the drawer. */
  readonly transitionsNote: string;
}
export type EngineReading =
  | { readonly kind: "result"; readonly result: EngineResult }
  | { readonly kind: "withheld"; readonly cause: string }
  | { readonly kind: "not-covered" }
  | { readonly kind: "contradictory"; readonly reasons: readonly string[] }
  | { readonly kind: "unreadable"; readonly fields: readonly string[] };

export interface BookWorkspace {
  readonly state: BookState;
  readonly banner: Banner;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: ViewChip[];
  readonly identity: ResultIdentity | null;
  readonly definition: ScenarioDefinition | null;
  readonly run: RunBookResponse | null;
  readonly cash: EngineReading | null;
  readonly legacy: EngineReading | null;
  readonly skew: readonly string[];
}
export type CompareState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly ids: readonly string[] }
  | { readonly kind: "ok"; readonly cash: CompareView; readonly legacy: CompareView }
  | { readonly kind: "failed"; readonly headline: LabHeadline };

export interface LabUi {
  readonly selectedId: string | null;
  readonly checked: ReadonlySet<string>;
}
export interface LabView {
  readonly listingLoad: LoadPhase;
  readonly library: LibraryRow[];
  readonly selectedId: string | null;
  readonly checked: readonly string[];
  readonly configVersion: string | null;
  readonly book: BookWorkspace;
  readonly compare: CompareState;
}

const emptyBook = (state: BookState, headline: LabHeadline, definition: ScenarioDefinition | null = null): BookWorkspace => ({
  state,
  banner: null,
  kicker: definition === null ? "Scenarios · Cash book" : `${definition.label} · Cash book`,
  headline,
  chips: definition === null ? [] : definitionChips(definition, null),
  identity: null,
  definition,
  run: null,
  cash: null,
  legacy: null,
  skew: [],
});

function definitionChips(def: ScenarioDefinition, configVersion: string | null): ViewChip[] {
  return [
    { label: "Scenario", value: `${def.id} · ${def.version}`, title: def.label },
    { label: "Config", value: configVersion ?? "unstated", tone: configVersion === null ? "refused" : undefined },
  ];
}

/** One engine's result, read by id under the classifier and the guards. */
export function readEngine(run: RunBookResponse, engine: string, definition: ScenarioDefinition): EngineReading {
  if (!definition.engines.includes(engine)) return { kind: "not-covered" };
  const refusal = run.excluded_engines.find((e) => e.engine === engine);
  if (refusal !== undefined) return { kind: "withheld", cause: `${engineName(engine)} — ${plainCause(refusal.code, refusal.detail)}` };
  const e = run.engines.find((x) => x.engine === engine);
  if (e === undefined) return { kind: "withheld", cause: `${engineName(engine)} — the result carries no row for this engine and no refusal` };
  const malformed = classifyRunBookEngine(e).malformedFields;
  const fields: string[] = [...malformed];
  if (!isWireScale(e.usd_decimals)) fields.push("usd_decimals");
  const pops: [string, number][] = [
    ["newly_eligible_accounts", e.newly_eligible_accounts],
    ["before.eligible_accounts", e.before.eligible_accounts],
    ["after.eligible_accounts", e.after.eligible_accounts],
    ["hf_transitions.measured_rows", e.hf_transitions.measured_rows],
  ];
  for (const [name, v] of pops) if (!isWirePopulation(v)) fields.push(name);
  const decs: [string, string][] = [
    ["before.eligible_debt_usd", e.before.eligible_debt_usd],
    ["after.eligible_debt_usd", e.after.eligible_debt_usd],
    ["eligible_debt_delta_usd", e.eligible_debt_delta_usd],
    ["before.bad_debt_usd", e.before.bad_debt_usd],
    ["after.bad_debt_usd", e.after.bad_debt_usd],
    ["bad_debt_delta_usd", e.bad_debt_delta_usd],
  ];
  for (const [name, v] of decs) if (!isWireDecimal(v)) fields.push(name);
  if (e.hf_transitions.lane_changed_rows !== null && !isWirePopulation(e.hf_transitions.lane_changed_rows)) fields.push("hf_transitions.lane_changed_rows");
  if (fields.length > 0) return { kind: "unreadable", fields: [...new Set(fields)] };
  const heat = laneReading(e, { merge: engine === CASH });
  if (heat.kind === "contradictory") return { kind: "contradictory", reasons: heat.reasons };
  return {
    kind: "result",
    result: {
      engine,
      decimals: e.usd_decimals,
      newly: e.newly_eligible_accounts,
      beforeEligible: e.before.eligible_accounts,
      afterEligible: e.after.eligible_accounts,
      eligibleDebtBefore: BigInt(e.before.eligible_debt_usd),
      eligibleDebtAfter: BigInt(e.after.eligible_debt_usd),
      deltaEligibleDebt: BigInt(e.eligible_debt_delta_usd),
      badDebtBefore: BigInt(e.before.bad_debt_usd),
      badDebtAfter: BigInt(e.after.bad_debt_usd),
      deltaBadDebt: BigInt(e.bad_debt_delta_usd),
      measured: e.hf_transitions.measured_rows,
      laneChanged: e.hf_transitions.lane_changed_rows,
      heat,
      movers: moversTable(e),
      realization: e.market_realization,
      projection: e.projection,
      note: e.note,
      transitionsNote: e.hf_transitions.note,
    },
  };
}

function enginesChip(run: RunBookResponse, cash: EngineReading): ViewChip {
  const served = run.engines.map((e) => engineName(e.engine));
  const withheld = run.excluded_engines.map((e) => `${engineName(e.engine)} withheld`);
  const parts = [...(served.length > 0 ? [joinAnd(served)] : []), ...withheld];
  return { label: "Engines", value: parts.join(" · "), tone: withheld.length > 0 || cash.kind === "withheld" ? "warn" : undefined };
}

function resultBook(def: ScenarioDefinition, configVersion: string, run: RunBookResponse): BookWorkspace {
  const skew = definitionSkew(def, configVersion, run);
  const superseded = run.batch.supersession.superseded;
  const kicker = `${def.label} · Cash book`;
  const identity: ResultIdentity = { scope: "book", batchId: run.batch.id, configVersion: run.scenario_config_version, engines: run.engines.map((e) => e.engine), servedAt: run.served_at };
  const cash = readEngine(run, CASH, def);
  const legacy = def.engines.includes(LEGACY) ? readEngine(run, LEGACY, def) : null;
  const chips: ViewChip[] = [
    superseded
      ? { label: "Result for batch", value: `${groupInt(run.batch.id)} · superseded`, tone: "warn", title: "a newer complete batch exists; run again for it" }
      : { label: "Result for batch", value: groupInt(run.batch.id) },
    { label: "Scenario", value: `${run.scenario_id} · ${run.scenario_version}`, title: run.label },
    enginesChip(run, cash),
    { label: "Config", value: run.scenario_config_version, tone: skew.includes("config version") ? "warn" : undefined },
  ];
  const base = { kicker, chips, identity, definition: def, run, cash, legacy, skew };
  if (skew.includes("version")) return { ...base, state: "definition-changed", banner: null, headline: definitionChangedHeadline(def.label, skew), cash: null, legacy: null };
  const banner: Banner = superseded ? "superseded" : skew.length > 0 ? "stale-input" : null;
  switch (cash.kind) {
    case "withheld":
      return { ...base, state: "withheld", banner, headline: withheldHeadline(def.label, cash.cause) };
    case "not-covered":
      return { ...base, state: "not-covered", banner, headline: notCoveredHeadline(def.label, def.engines, legacy !== null) };
    case "contradictory":
      return { ...base, state: "contradictory", banner, headline: contradictoryHeadline(def.label, cash.reasons) };
    case "unreadable":
      return { ...base, state: "contradictory", banner, headline: contradictoryHeadline(def.label, cash.fields.map((f) => `${f} is outside the wire contract`)) };
    case "result": {
      const r = cash.result;
      const headline = resultHeadline({
        label: def.label,
        decimals: r.decimals,
        newly: r.newly,
        beforeEligible: r.beforeEligible,
        afterEligible: r.afterEligible,
        deltaEligibleDebt: r.deltaEligibleDebt,
        deltaBadDebt: r.deltaBadDebt,
        heat: r.heat.kind === "ok" ? r.heat.view : null,
        heatReason: r.heat.kind === "ok" ? null : r.heat.reasons.join("; "),
      });
      return { ...base, state: "result", banner, headline };
    }
  }
}

function bookOf(listing: ScenariosResponse, def: ScenarioDefinition, record: RunRecord | undefined): BookWorkspace {
  if (record === undefined) {
    return { ...emptyBook("not-run", notRunHeadline({ label: def.label, description: def.description, path_assumption: def.path_assumption, shocks: def.shocks.length }), def), chips: definitionChips(def, listing.scenario_config_version) };
  }
  if (record.phase === "running") return { ...emptyBook("running", runningHeadline(def.label), def), chips: definitionChips(def, listing.scenario_config_version) };
  const o = record.outcome;
  if (o.kind === "ok") return resultBook(def, listing.scenario_config_version, o.response);
  const chips = definitionChips(def, listing.scenario_config_version);
  switch (o.kind) {
    case "not-served":
      return { ...emptyBook("not-served", failureHeadline("not-served", {}), def), chips };
    case "no-batch":
      return { ...emptyBook("no-batch", failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }), def), chips };
    case "rate-limited":
      return { ...emptyBook("rate-limited", failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }), def), chips };
    case "unreachable":
      return { ...emptyBook("unreachable", failureHeadline("unreachable", { message: o.message }), def), chips };
    case "failed":
      return { ...emptyBook("failed", failureHeadline("failed", { status: o.status, message: o.message }), def), chips };
  }
}

function compareOf(reading: LabReading): CompareState {
  const set = reading.set;
  if (set === null) return { kind: "idle" };
  if (set.phase === "running") return { kind: "running", ids: set.ids };
  const o = set.outcome;
  switch (o.kind) {
    case "ok":
      return { kind: "ok", cash: compareRows(o.response, CASH), legacy: compareRows(o.response, LEGACY) };
    case "busy":
      return { kind: "failed", headline: failureHeadline("busy", { message: o.message, inFlight: o.inFlight, maxInFlight: o.maxInFlight }) };
    case "not-served":
      return { kind: "failed", headline: failureHeadline("not-served", {}) };
    case "no-batch":
      return { kind: "failed", headline: failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }) };
    case "rate-limited":
      return { kind: "failed", headline: failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }) };
    case "refused":
      return { kind: "failed", headline: failureHeadline("failed", { status: o.status, message: `${o.code}: ${o.message}` }) };
    case "unreachable":
      return { kind: "failed", headline: failureHeadline("unreachable", { message: o.message }) };
    case "refused-locally":
      return { kind: "failed", headline: failureHeadline("refused-locally", { message: o.message }) };
  }
}

const loadPhase = (p: LabReading["listing"]): LoadPhase => (p.phase === "error" ? { phase: "error", message: p.message } : p.phase === "loading" ? { phase: "loading" } : { phase: "ready" });

export function deriveLabView(reading: LabReading, ui: LabUi): LabView {
  const listingLoad = loadPhase(reading.listing);
  const compare = compareOf(reading);
  if (reading.listing.phase === "loading") {
    return { listingLoad, library: [], selectedId: null, checked: [...ui.checked], configVersion: null, book: emptyBook("listing-loading", LISTING_LOADING), compare };
  }
  if (reading.listing.phase === "error") {
    return { listingLoad, library: [], selectedId: null, checked: [...ui.checked], configVersion: null, book: emptyBook("listing-unavailable", listingUnavailableHeadline(reading.listing.message)), compare };
  }
  const listing = reading.listing.value;
  const def = listing.scenarios.find((s) => s.id === ui.selectedId) ?? listing.scenarios[0] ?? null;
  const selectedId = def?.id ?? null;
  const library = libraryRows(listing, reading.runs, selectedId, ui.checked);
  const checked = listing.scenarios.map((s) => s.id).filter((id) => ui.checked.has(id));
  if (def === null) {
    return { listingLoad, library, selectedId, checked, configVersion: listing.scenario_config_version, book: emptyBook("not-run", EMPTY_LISTING), compare };
  }
  return { listingLoad, library, selectedId, checked, configVersion: listing.scenario_config_version, book: bookOf(listing, def, reading.runs.get(def.id)), compare };
}
```

If `SetRunOutcome` carries a kind this switch does not name, the compiler says so — add its arm with `failureHeadline("failed", …)` and the kind in the message; never a default arm. `classifyRunBookEngine` is a type-and-shape classifier (wire decimals, populations, scales): a matrix whose numbers disagree (the pin's `total_rows: 5`) passes it and is caught by `laneReading` — so the reading is `contradictory`, while a malformed field (the pin's `usd_decimals: 1.5`) is `unreadable`; both are the page's `contradictory` state.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-view.spec.ts && npm run typecheck`
Expected: 9 passed; typecheck clean. `ViewChip` is Plan 1's `{ label, value, tone?, title? }` — if it lacks `title`, add the chip title through `IdentityChip` instead (the page passes chips straight to `VerdictHeader`) and say so.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-view.ts web/tests/unit/lab-view.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-view - one view model for the Scenarios page: every state decided once, engines read by id under the classifier and the guards, banners on a result rather than replacements" -- web/lib/lab-view.ts web/tests/unit/lab-view.spec.ts
```

---
### Task 10: The Scenarios demo dataset — generated, clock-law checked, welded to the demo Book (R16)

**Files:**
- Create: `web/tests/fixtures/demo/generate-demo-lab.mjs`, `web/tests/fixtures/demo/scenarios-demo.json`, `web/tests/fixtures/demo/run-book-demo-eth_minus_30.json`, `web/tests/fixtures/demo/run-book-set-demo.json`
- Modify: `web/tests/fixtures/demo/index.ts`, `web/tests/unit/fixture-clock-law.spec.ts`
- Test: `web/tests/unit/demo-lab-weld.spec.ts`

**Interfaces:**
- Consumes: `tests/fixtures/demo/book.demo.json` (batch 18,251; `hf_histogram.engines[]`; `waterfall` for `eth_minus_30`; `bad_debt[]`; the engine cards), `positions-dm-demo-page-1.json` (the movers), the contract fixtures `scenarios.json`, `run-book.eth_minus_30.json`, `run-book-set.json` (envelopes, notes, lanes, reach shapes — verbatim where copied), `tests/fixtures/clock-law.mjs` (`checkClocks`), the plan's movement tables (R16 and the legacy one-lane-down rule).
- Produces: `DEMO_SCENARIOS: ScenariosResponse`, `DEMO_RUN_BOOK_ETH: RunBookResponse`, `DEMO_RUN_BOOK_SET: RunBookSetResponse` from `tests/fixtures/demo/index.ts`.

- [ ] **Step 1: The weld pins (failing)**

```ts
// web/tests/unit/demo-lab-weld.spec.ts
// The Scenarios demo bodies are the demo Book's own figures: the run-book's
// before side is the Book, its after side is the Book's eth_minus_30
// waterfall at factor 0.70, its lanes are the Book's histogram, and every
// count the page derives from it is a sum the pins can redo.
import { expect, test } from "@playwright/test";
import { laneReading } from "../../lib/lab-transitions";
import { compareRows } from "../../lib/lab-compare";
import { DEMO_BATCH_ID, DEMO_BOOK, DEMO_POSITIONS_DM_PAGE_1, DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET, DEMO_SCENARIOS } from "../fixtures/demo";
import { SCENARIOS } from "../fixtures/lab-book";

const cash = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!;
const legacy = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const bookCash = () => DEMO_BOOK.engines.find((e) => e.engine === "debt_manager")!;
const bookLegacy = () => DEMO_BOOK.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const histogram = (engine: string) => DEMO_BOOK.hf_histogram.engines.find((e) => e.engine === engine)!.buckets.map((b) => b.count);
const waterfallAt = (factor: string, engine: string) => DEMO_BOOK.waterfall.points.find((p) => p.factor === factor)!.engines.find((e) => e.engine === engine)!;

test("every body shares the Book's demo batch identity and clock", () => {
  for (const body of [DEMO_SCENARIOS, DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET]) expect(body.served_at).toBe(DEMO_BOOK.served_at);
  expect(DEMO_RUN_BOOK_ETH.batch).toEqual(DEMO_BOOK.batch);
  expect(DEMO_RUN_BOOK_SET.batch).toEqual(DEMO_BOOK.batch);
  expect(DEMO_RUN_BOOK_ETH.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_RUN_BOOK_SET.evaluation.newest_servable_batch_id).toBe(DEMO_BATCH_ID);
  expect(DEMO_RUN_BOOK_SET.evaluation.freshness).toBe("still_newest");
});

test("the listing is the committed set, verbatim", () => {
  expect(DEMO_SCENARIOS.scenarios).toEqual(SCENARIOS.scenarios);
  expect(DEMO_SCENARIOS.scenario_config_version).toBe(SCENARIOS.scenario_config_version);
  expect(DEMO_RUN_BOOK_ETH.scenario_id).toBe("eth_minus_30");
  expect(DEMO_RUN_BOOK_ETH.scenario_version).toBe(SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!.version);
  expect(DEMO_RUN_BOOK_ETH.label).toBe("ETH -30 percent");
});

test("the Cash before side IS the Book; the after side IS the waterfall at 0.70; the deltas are their difference", () => {
  const c = cash();
  const base = waterfallAt("1000000000000000000", "debt_manager");
  const shocked = waterfallAt("700000000000000000", "debt_manager");
  expect(c.usd_decimals).toBe(bookCash().value_decimals);
  expect(c.before.accounts).toBe(bookCash().computed_positions);
  expect(c.before.eligible_accounts).toBe(base.cumulative_eligible_accounts);
  expect(c.before.eligible_debt_usd).toBe(base.cumulative_debt_eligible_usd);
  expect(c.before.bad_debt_usd).toBe(base.cumulative_bad_debt_usd);
  expect(c.before.collateral_at_risk_usd).toBe(base.cumulative_collateral_at_risk_usd);
  expect(c.before.total_debt_usd).toBe(String(bookCash().total_debt));
  expect(c.before.total_collateral_usd).toBe(String(bookCash().total_collateral));
  expect(c.after.accounts).toBe(bookCash().computed_positions);
  expect(c.after.eligible_accounts).toBe(shocked.cumulative_eligible_accounts);
  expect(c.after.eligible_debt_usd).toBe(shocked.cumulative_debt_eligible_usd);
  expect(c.after.bad_debt_usd).toBe(shocked.cumulative_bad_debt_usd);
  expect(c.after.collateral_at_risk_usd).toBe(shocked.cumulative_collateral_at_risk_usd);
  expect(c.after.total_debt_usd).toBe(c.before.total_debt_usd);
  expect(BigInt(c.after.total_collateral_usd)).toBe((BigInt(c.before.total_collateral_usd) * 7n) / 10n);
  expect(c.newly_eligible_accounts).toBe(shocked.cumulative_eligible_accounts - base.cumulative_eligible_accounts);
  expect(c.newly_eligible_accounts).toBe(118);
  expect(BigInt(c.eligible_debt_delta_usd)).toBe(BigInt(c.after.eligible_debt_usd) - BigInt(c.before.eligible_debt_usd));
  expect(c.eligible_debt_delta_usd).toBe("1280000000000");
  expect(BigInt(c.bad_debt_delta_usd)).toBe(BigInt(c.after.bad_debt_usd) - BigInt(c.before.bad_debt_usd));
  expect(c.bad_debt_delta_usd).toBe("40780396039");
});

test("the Cash lanes are the Book's histogram and the plan's movement table; every derived count re-sums", () => {
  const c = cash();
  const t = c.hf_transitions;
  expect(t.from_rows.slice(0, 8)).toEqual(histogram("debt_manager"));
  expect(t.from_rows).toEqual([41, 8, 14, 13, 73, 153, 300, 804, 0, 6]);
  expect(t.to_rows).toEqual([155, 12, 135, 43, 129, 188, 320, 424, 0, 6]);
  expect(t.total_rows).toBe(bookCash().positions);
  expect(t.unmeasured_rows).toBe(bookCash().refused_positions);
  expect(t.measured_rows).toBe(bookCash().computed_positions);
  expect(t.held_rows).toBe(465);
  expect(t.lane_changed_rows).toBe(941);
  expect(c.before.hf_histogram.buckets.map((b) => b.count)).toEqual(t.from_rows.slice(0, 8));
  expect(c.after.hf_histogram.buckets.map((b) => b.count)).toEqual(t.to_rows.slice(0, 8));
  const debtBefore = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + BigInt(x.debt_before_usd), 0n);
  const debtAfter = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + BigInt(x.debt_after_usd), 0n);
  expect(debtBefore).toBe(BigInt(c.before.total_debt_usd));
  expect(debtAfter).toBe(BigInt(c.after.total_debt_usd));
  const r = laneReading(c, { merge: true });
  if (r.kind !== "ok") throw new Error(r.reasons.join("; "));
  expect(r.view.merged).toBe(true);
  expect(r.view.crossedCap).toBe(118);
  expect(r.view.bandChanged).toBe(425);
  expect(r.view.improved).toBe(0);
  expect(r.view.nearToday).toBe(27);
  expect(r.view.nearCrossed).toBe(27);
});

test("the movers are the demo pages' own accounts that cross under ×0.7, ranked nearest the cap after, 20 of 118", () => {
  const c = cash();
  expect(c.movers).toHaveLength(20);
  expect(c.movers_total).toBe(118);
  const rows = new Map(DEMO_POSITIONS_DM_PAGE_1.positions.map((p) => [p.account.toLowerCase(), p]));
  let previous = 0n;
  for (const m of c.movers) {
    const row = rows.get(m.account.toLowerCase());
    expect(row).toBeDefined();
    expect(row!.liquidatable).toBe(false);
    expect(m.hf_before_num).toBe(row!.health_factor.num);
    expect(m.hf_before_den).toBe(row!.health_factor.den);
    expect(BigInt(m.hf_after_num!)).toBe(BigInt(m.hf_before_num!) * 7n);
    expect(BigInt(m.hf_after_den!)).toBe(BigInt(m.hf_before_den!) * 10n);
    expect(BigInt(m.hf_after_num!) < BigInt(m.hf_after_den!)).toBe(true);
    expect(m.became_eligible).toBe(true);
    expect(m.debt_usd).toBe(String(row!.total_debt));
    // ranked by the ratio after, ascending (nearest the cap first): num_after/den_after non-decreasing
    const ratio = (BigInt(m.hf_after_num!) * 1_000_000n) / BigInt(m.hf_after_den!);
    expect(ratio >= previous).toBe(true);
    previous = ratio;
  }
});

test("the legacy engine welds to the Book's engine card and histogram, one lane down, 14 crossing", () => {
  const l = legacy();
  expect(l.usd_decimals).toBe(bookLegacy().value_decimals);
  expect(l.before.accounts).toBe(bookLegacy().computed_positions);
  expect(l.before.eligible_accounts).toBe(bookLegacy().liquidatable_positions);
  expect(l.hf_transitions.from_rows.slice(0, 8)).toEqual(histogram("aave_v3_etherfi"));
  expect(l.hf_transitions.from_rows).toEqual([40, 6, 27, 318, 1204, 2890, 4055, 12, 0, 0]);
  expect(l.hf_transitions.to_rows).toEqual([46, 14, 331, 1204, 2890, 4055, 12, 0, 0, 0]);
  expect(l.newly_eligible_accounts).toBe(14);
  expect(l.after.eligible_accounts).toBe(60);
  const r = laneReading(l, { merge: false });
  if (r.kind !== "ok") throw new Error(r.reasons.join("; "));
  expect(r.view.merged).toBe(false);
  expect(r.view.crossedCap).toBe(14);
  expect(r.view.improved).toBe(0);
});

test("the set run carries the four committed scenarios; the eth row IS the run-book's Cash figures; the shares read", () => {
  expect(DEMO_RUN_BOOK_SET.requested_scenario_ids).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  expect(DEMO_RUN_BOOK_SET.results.map((r) => r.scenario_id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  const eth = DEMO_RUN_BOOK_SET.results.find((r) => r.scenario_id === "eth_minus_30")!.engines.find((e) => e.engine === "debt_manager")!;
  const c = cash();
  expect(eth.before_eligible_accounts).toBe(c.before.eligible_accounts);
  expect(eth.after_eligible_accounts).toBe(c.after.eligible_accounts);
  expect(eth.eligible_debt_delta_usd).toBe(c.eligible_debt_delta_usd);
  expect(eth.bad_debt_delta_usd).toBe(c.bad_debt_delta_usd);
  expect(eth.total_debt_usd_before).toBe(c.before.total_debt_usd);
  expect(eth.flipped_to_eligible).toBe(118);
  const v = compareRows(DEMO_RUN_BOOK_SET, "debt_manager");
  expect(v.rows.map((r) => [r.id, r.kind, r.shareText])).toEqual([
    ["eth_minus_30", "point", "+4.5%"],
    ["ethfi_minus_50", "point", "+<0.1%"],
    ["weeth_market_depeg_oracles_held", "point", "0%"],
    ["dm_rate_horizon_plus_200bps", "point", "0%"],
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts`
Expected: FAIL — `DEMO_SCENARIOS` is not exported.

- [ ] **Step 3: The generator**

```js
// web/tests/fixtures/demo/generate-demo-lab.mjs
// The Scenarios demo dataset (spec 2026-09-15 §8; plan 3 R16) + PROVENANCE.
// Regenerate: node tests/fixtures/demo/generate-demo-lab.mjs (from web/)
//
// Nothing here is hand-shaped wire data:
//   * scenarios-demo.json is the contract's committed set (tests/fixtures/
//     scenarios.json) verbatim, stamped with the demo Book's clock;
//   * run-book-demo-eth_minus_30.json: the envelope, notes, applied shocks,
//     held-flat inputs, lane vocabulary and movers_note are the contract's own
//     200 example (tests/fixtures/run-book.eth_minus_30.json), verbatim; the
//     batch is the demo Book's batch; the Cash engine's BEFORE side is the
//     demo Book (engine card, bad_debt entry, waterfall base point, histogram)
//     and its AFTER side is the demo Book's own eth_minus_30 waterfall point at
//     factor 0.70 — so the page's figures are the Book's, to the dollar; the
//     lane movement is the plan's table (a −30 % mark scales the Cash cap by
//     0.7: lanes 1.00–1.25 all cross, 18 of lane 1.25–1.50 cross, the rest
//     step down); cell debts allocate the engine's total debt across cells in
//     proportion to rows (the remainder on the largest cell) and do not move —
//     Cash debt is USD; the movers are the demo pages' own computed rows that
//     cross under ×0.7 (num×7 < den×10), ranked by the ratio after, 20 of the
//     118; the legacy engine's before side is the Book's Aave card and
//     histogram and its after side steps each bucket one lane down with 14
//     crossing (a design assumption, as the demo waterfall's Aave arm is);
//   * run-book-set-demo.json: the contract's set-run example's envelope,
//     evaluation, coverage and reach shapes (tests/fixtures/run-book-set.json),
//     re-clocked to the demo Book, one result per committed scenario; the
//     eth_minus_30 Cash summary IS the run-book above; the other three carry
//     design figures stated below (ETHFI −50 %: +$9,800, 2 accounts; the weETH
//     depeg: no HF movement, a market-realization shortfall; the rate step:
//     no HF movement, a projection);
//   * every body passes checkClocks() before it is written.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));

const book = read("book.demo.json");
const page1 = read("positions-dm-demo-page-1.json");
const scenarios = readFixture("scenarios.json");
const runBookTemplate = readFixture("run-book.eth_minus_30.json");
const setTemplate = readFixture("run-book-set.json");

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const SERVED_AT = book.served_at;
const engineCard = (id) => book.engines.find((e) => e.engine === id);
const badDebt = (id) => book.bad_debt.find((e) => e.engine === id);
const histogramOf = (id) => book.hf_histogram.engines.find((e) => e.engine === id);
const waterfallAt = (factor, id) => book.waterfall.points.find((p) => p.factor === factor).engines.find((e) => e.engine === id);
const templateEngine = (id) => runBookTemplate.engines.find((e) => e.engine === id);

// ---- lanes ----------------------------------------------------------------
// The lane vocabulary is the contract's own (ten lanes: eight buckets, no-debt,
// not-measured); the buckets' edges are the Book histogram's.
const LANES = templateEngine(CASH).hf_transitions.lanes;
const INFINITE = 8;
const UNMEASURED = 9;

/** table[from][to] = rows. Every margin, histogram count and total is summed from it. */
function transitionsOf(table, comparator, totalDebt, unmeasuredRefused) {
  const n = LANES.length;
  const from_rows = Array(n).fill(0);
  const to_rows = Array(n).fill(0);
  const cells = [];
  for (const [f, row] of Object.entries(table)) {
    for (const [t, rows] of Object.entries(row)) {
      const fi = Number(f);
      const ti = Number(t);
      from_rows[fi] += rows;
      to_rows[ti] += rows;
      cells.push({ from: fi, to: ti, rows });
    }
  }
  const total = from_rows.reduce((a, b) => a + b, 0);
  const unmeasured = from_rows[UNMEASURED];
  // Debt allocation: proportional to rows over the MEASURED cells, exact remainder on the largest cell.
  const measuredCells = cells.filter((c) => c.from !== UNMEASURED && c.to !== UNMEASURED);
  const measuredRows = measuredCells.reduce((a, c) => a + c.rows, 0);
  let allocated = 0n;
  let largest = measuredCells[0];
  for (const c of measuredCells) {
    c.debt = (totalDebt * BigInt(c.rows)) / BigInt(measuredRows);
    allocated += c.debt;
    if (c.rows > largest.rows) largest = c;
  }
  largest.debt += totalDebt - allocated;
  for (const c of cells) if (c.debt === undefined) c.debt = 0n;
  let held = 0;
  let changed = 0;
  for (const c of measuredCells) {
    if (c.from === c.to) held += c.rows;
    else changed += c.rows;
  }
  const outflows = LANES.map((lane) => ({
    from: lane.index,
    cells: cells
      .filter((c) => c.from === lane.index)
      .map((c) => ({ to: c.to, rows: c.rows, debt_before_usd: c.debt.toString(), debt_after_usd: c.debt.toString() })),
  }));
  return {
    comparator,
    wad_scale: templateEngine(CASH).hf_transitions.wad_scale,
    lanes: LANES,
    outflows,
    from_rows,
    to_rows,
    total_rows: total,
    measured_rows: total - unmeasured,
    unmeasured_rows: unmeasured,
    unmeasured_refused_in_batch_rows: unmeasuredRefused,
    unmeasured_excluded_by_this_layer_rows: unmeasured - unmeasuredRefused,
    held_rows: held,
    lane_changed_rows: changed,
    note: templateEngine(CASH).hf_transitions.note,
  };
}

function histogramFromRows(template, rows) {
  return { ...template, buckets: template.buckets.map((b, i) => ({ ...b, count: rows[i] })) };
}

// ---- the Cash engine (plan R16) ---------------------------------------------
const CASH_TABLE = {
  0: { 0: 41 },
  1: { 0: 8 },
  2: { 0: 14 },
  3: { 0: 13 },
  4: { 0: 73 },
  5: { 0: 6, 1: 12, 2: 135 },
  6: { 3: 43, 4: 129, 5: 128 },
  7: { 5: 60, 6: 320, 7: 424 },
  9: { 9: 6 },
};

function cashEngine() {
  const card = engineCard(CASH);
  const hist = histogramOf(CASH);
  const base = waterfallAt("1000000000000000000", CASH);
  const shocked = waterfallAt("700000000000000000", CASH);
  const totalDebt = BigInt(card.total_debt);
  const t = transitionsOf(CASH_TABLE, hist.comparator, totalDebt, card.refused_positions);
  const template = templateEngine(CASH);
  if (t.from_rows.slice(0, 8).join() !== hist.buckets.map((b) => b.count).join()) throw new Error("the Cash table's from_rows must be the Book's histogram");
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: base.cumulative_eligible_accounts,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: base.cumulative_debt_eligible_usd,
    collateral_at_risk_usd: base.cumulative_collateral_at_risk_usd,
    bad_debt_usd: base.cumulative_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.from_rows),
    collateral_by_asset: template.before.collateral_by_asset,
  };
  const after = {
    accounts: card.computed_positions,
    eligible_accounts: shocked.cumulative_eligible_accounts,
    total_collateral_usd: ((BigInt(card.total_collateral) * 7n) / 10n).toString(),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: shocked.cumulative_debt_eligible_usd,
    collateral_at_risk_usd: shocked.cumulative_collateral_at_risk_usd,
    bad_debt_usd: shocked.cumulative_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  // Movers: the demo pages' computed, non-liquidatable rows that cross under ×0.7, nearest the cap after first.
  const crossing = page1.positions
    .filter((p) => p.status === "computed" && p.liquidatable === false && p.health_factor.num !== null && p.health_factor.den !== null)
    .filter((p) => BigInt(p.health_factor.num) * 7n < BigInt(p.health_factor.den) * 10n)
    .map((p) => ({ p, ratio: (BigInt(p.health_factor.num) * 7_000_000n) / (BigInt(p.health_factor.den) * 10n) }))
    .sort((a, b) => (a.ratio < b.ratio ? -1 : a.ratio > b.ratio ? 1 : a.p.account.localeCompare(b.p.account)));
  const movers = crossing.slice(0, 20).map(({ p }) => ({
    account: p.account,
    engine: CASH,
    hf_before_wad: null,
    hf_after_wad: null,
    hf_drop_wad: null,
    hf_before_num: p.health_factor.num,
    hf_before_den: p.health_factor.den,
    hf_after_num: (BigInt(p.health_factor.num) * 7n).toString(),
    hf_after_den: (BigInt(p.health_factor.den) * 10n).toString(),
    became_eligible: true,
    debt_usd: String(p.total_debt),
  }));
  const newly = shocked.cumulative_eligible_accounts - base.cumulative_eligible_accounts;
  return {
    engine: CASH,
    usd_decimals: card.value_decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: newly,
    eligible_debt_delta_usd: (BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)).toString(),
    bad_debt_delta_usd: (BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)).toString(),
    movers,
    movers_total: newly,
    movers_note: template.movers_note,
    market_realization: null,
    projection: null,
    note: template.note,
  };
}

// ---- the legacy engine (one lane down; 14 cross) -------------------------------
const LEGACY_TABLE = {
  0: { 0: 40 },
  1: { 0: 6 },
  2: { 1: 14, 2: 13 },
  3: { 2: 318 },
  4: { 3: 1204 },
  5: { 4: 2890 },
  6: { 5: 4055 },
  7: { 6: 12 },
};

function legacyEngine() {
  const card = engineCard(LEGACY);
  const hist = histogramOf(LEGACY);
  const bad = badDebt(LEGACY);
  const template = templateEngine(LEGACY);
  const t = transitionsOf(LEGACY_TABLE, hist.comparator, BigInt(card.total_debt), card.refused_positions);
  if (t.from_rows.slice(0, 8).join() !== hist.buckets.map((b) => b.count).join()) throw new Error("the legacy table's from_rows must be the Book's histogram");
  const newly = 14;
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: bad.eligible_debt_usd,
    collateral_at_risk_usd: bad.collateral_at_risk_usd,
    bad_debt_usd: bad.current_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.from_rows),
    collateral_by_asset: template.before.collateral_by_asset,
  };
  const eligibleDebtDelta = 600_000_000_000n; // $6,000 at 8 decimals: the contract example's own delta
  const badDebtDelta = 66_666_666_667n; // $666.67 at 8 decimals: the contract example's own delta
  const after = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions + newly,
    total_collateral_usd: ((BigInt(card.total_collateral) * 7n) / 10n).toString(),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: (BigInt(bad.eligible_debt_usd) + eligibleDebtDelta).toString(),
    collateral_at_risk_usd: ((BigInt(bad.collateral_at_risk_usd) * 7n) / 10n).toString(),
    bad_debt_usd: (BigInt(bad.current_bad_debt_usd) + badDebtDelta).toString(),
    hf_histogram: histogramFromRows(hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  return {
    engine: LEGACY,
    usd_decimals: card.value_decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: newly,
    eligible_debt_delta_usd: eligibleDebtDelta.toString(),
    bad_debt_delta_usd: badDebtDelta.toString(),
    movers: [],
    movers_total: newly,
    movers_note: "the legacy market's movers are not carried on the demo wire; the count is the newly eligible accounts",
    market_realization: null,
    projection: null,
    note: template.note,
  };
}

// ---- bodies -------------------------------------------------------------------
const ETH_DEF = scenarios.scenarios.find((s) => s.id === "eth_minus_30");

function scenariosBody() {
  return { ...scenarios, served_at: SERVED_AT };
}

function runBookBody() {
  return {
    ...runBookTemplate,
    served_at: SERVED_AT,
    batch: book.batch,
    scenario_config_version: scenarios.scenario_config_version,
    scenario_id: ETH_DEF.id,
    scenario_version: ETH_DEF.version,
    label: ETH_DEF.label,
    description: ETH_DEF.description,
    path_assumption: ETH_DEF.path_assumption,
    shocks: ETH_DEF.shocks,
    out_of_model: ETH_DEF.out_of_model,
    engines: [legacyEngine(), cashEngine()],
    excluded_engines: [],
  };
}

function setBody(runBook) {
  const cashRun = runBook.engines.find((e) => e.engine === CASH);
  const legacyRun = runBook.engines.find((e) => e.engine === LEGACY);
  const templateResult = setTemplate.results.find((r) => r.scenario_id === "eth_minus_30");
  const templateCash = templateResult.engines.find((e) => e.engine === CASH);
  const templateLegacy = templateResult.engines.find((e) => e.engine === LEGACY);
  const noShockReach = setTemplate.results.find((r) => r.shock_reach.every((s) => s.declared_shocks === 0))?.shock_reach ?? templateResult.shock_reach;
  const summary = (template, engine, figures) => ({
    ...template,
    engine: engine.engine,
    usd_decimals: engine.usd_decimals,
    accounts: engine.before.accounts,
    before_eligible_accounts: engine.before.eligible_accounts,
    before_eligible_debt_usd: engine.before.eligible_debt_usd,
    before_bad_debt_usd: engine.before.bad_debt_usd,
    before_collateral_at_risk_usd: engine.before.collateral_at_risk_usd,
    total_debt_usd_before: engine.before.total_debt_usd,
    total_collateral_usd_before: engine.before.total_collateral_usd,
    ...figures,
  });
  const cashFigures = (after, delta, badDelta, flipped, dropped, collateralAfter, debtAfter, collateralAtRiskAfter) => ({
    after_eligible_accounts: after,
    eligible_accounts_delta: after - cashRun.before.eligible_accounts,
    flipped_to_eligible: flipped,
    hf_dropped_accounts: dropped,
    eligible_debt_delta_usd: delta,
    bad_debt_delta_usd: badDelta,
    after_collateral_at_risk_usd: collateralAtRiskAfter,
    total_debt_usd_after: debtAfter,
    total_collateral_usd_after: collateralAfter,
  });
  const results = scenarios.scenarios.map((def) => {
    const base = { ...templateResult, scenario_id: def.id, scenario_version: def.version, label: def.label, path_assumption: def.path_assumption, shocks: def.shocks, covered_engines: def.engines, withheld_engines: [], unmeasurable_engines: [] };
    const cashCovered = def.engines.includes(CASH);
    const legacyCovered = def.engines.includes(LEGACY);
    let engines = [];
    let shock_reach = def.shocks.length === 0 ? noShockReach : templateResult.shock_reach;
    if (def.id === "eth_minus_30") {
      engines = [
        summary(templateLegacy, legacyRun, cashFigures(legacyRun.after.eligible_accounts, legacyRun.eligible_debt_delta_usd, legacyRun.bad_debt_delta_usd, null, legacyRun.hf_transitions.lane_changed_rows, legacyRun.after.total_collateral_usd, legacyRun.after.total_debt_usd, legacyRun.after.collateral_at_risk_usd)),
        summary(templateCash, cashRun, cashFigures(cashRun.after.eligible_accounts, cashRun.eligible_debt_delta_usd, cashRun.bad_debt_delta_usd, cashRun.newly_eligible_accounts, cashRun.hf_transitions.lane_changed_rows, cashRun.after.total_collateral_usd, cashRun.after.total_debt_usd, cashRun.after.collateral_at_risk_usd)),
      ];
    } else if (def.id === "ethfi_minus_50") {
      engines = [summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts + 2, "9800000000", "1200000000", 2, 61, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd))];
    } else if (def.id === "weeth_market_depeg_oracles_held") {
      engines = [
        ...(legacyCovered ? [summary(templateLegacy, legacyRun, cashFigures(legacyRun.before.eligible_accounts, "0", "0", null, 0, legacyRun.before.total_collateral_usd, legacyRun.before.total_debt_usd, legacyRun.before.collateral_at_risk_usd))] : []),
        {
          ...summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts, "0", "0", 0, 0, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd)),
          market_realization: { hfs_unchanged: true, execution_shortfall_usd: "838000000000", bad_debt_at_liquidation_usd: "41020000000", usd_decimals: cashRun.usd_decimals, seizure_model: "pro-rata-over-counted-collateral", note: "oracle marks held exactly; the market price is 5 percent under redemption, so a liquidator realises less than the oracle value of the seized weETH" },
        },
      ];
    } else if (def.id === "dm_rate_horizon_plus_200bps") {
      const projection = runBookTemplate.engines.find((e) => e.projection !== null)?.projection ?? setTemplate.results.flatMap((r) => r.engines).find((e) => e.projection !== null)?.projection;
      if (!projection) throw new Error("no projection template on the contract fixtures; read openapi.yaml's Projection example and copy it here");
      engines = [{ ...summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts, "0", "0", null, 0, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd)), projection }];
    }
    if (!cashCovered) engines = engines.filter((e) => e.engine !== CASH);
    return { ...base, engines, shock_reach, positions_answered: engines.reduce((n, e) => n + e.accounts, 0), positions_withheld: 0 };
  });
  return {
    ...setTemplate,
    served_at: SERVED_AT,
    batch: book.batch,
    evaluation: { ...setTemplate.evaluation, resolved_at: SERVED_AT, probed_at: SERVED_AT, scenarios_evaluated: results.length, freshness: "still_newest", newest_servable_batch_id: book.batch.id },
    scenario_config_version: scenarios.scenario_config_version,
    requested_scenario_ids: scenarios.scenarios.map((s) => s.id),
    results,
    excluded_engines: [],
    coverage: { ...setTemplate.coverage, batch_positions: book.batch.position_count, in_book: book.coverage.in_book, refused_in_batch: book.coverage.refused_in_batch, excluded_by_this_layer: 0, excluded: [], book_is_measurable: true },
  };
}

function writeChecked(name, body) {
  const report = checkClocks(body);
  if (report.violations.length > 0) throw new Error(`${name}: ${report.violations.join("; ")}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.trios ?? "?")} clock trios)`);
}

const runBook = runBookBody();
writeChecked("scenarios-demo.json", scenariosBody());
writeChecked("run-book-demo-eth_minus_30.json", runBook);
writeChecked("run-book-set-demo.json", setBody(runBook));
```

Read `tests/fixtures/clock-law.mjs`'s `checkClocks` return shape first (Plan 2's generator uses it at `generate-demo-inspector.mjs:395`) and match `writeChecked` to it exactly — the field names above (`violations`, `trios`) are the ones to confirm. `SetRunEngineSummary` and `SetRunScenarioResult` carry fields this generator does not set (`infinite_accounts`, `movement_excluded_accounts`, `refused_in_batch_positions`, `unrebuildable_positions`, `movement_rule`, `note`, `shock_reach`, `positions_*`): they ride from the template by spread — verify each templated value is TRUE for the demo (e.g. `movement_rule` per engine is the template's per engine; `infinite_accounts` is the from_rows infinite lane = 0; `refused_in_batch_positions` for Cash is 6) and override the ones that are not; list every override in the report. `collateral_by_asset` rides from the template verbatim; if its rows do not sum to the demo totals, push this note onto the body's `notes`: `"collateral_by_asset carries the contract example's rows and is not welded to the demo totals; the page does not read it"`.

- [ ] **Step 4: Generate, export, census**

Run: `cd web && node tests/fixtures/demo/generate-demo-lab.mjs`
Expected: three `wrote …` lines. Then append to `web/tests/fixtures/demo/index.ts`:

```ts
/** GENERATED by generate-demo-lab.mjs — see its provenance header. The run-book welds to the Book's eth_minus_30 waterfall. */
export const DEMO_SCENARIOS: Schemas["ScenariosResponse"] = load("scenarios-demo.json");
export const DEMO_RUN_BOOK_ETH: Schemas["RunBookResponse"] = load("run-book-demo-eth_minus_30.json");
export const DEMO_RUN_BOOK_SET: Schemas["RunBookSetResponse"] = load("run-book-set-demo.json");
```

Run: `cd web && npx playwright test --project=unit tests/unit/fixture-clock-law.spec.ts`
Expected: FAIL naming the three new files and the trio counts it found; add those three entries to `CENSUS` in `tests/unit/fixture-clock-law.spec.ts` with the counts the failure names and move `CENSUS_TOTAL` by their sum. Re-run: PASS.

- [ ] **Step 5: Run the weld to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts tests/unit/fixture-clock-law.spec.ts`
Expected: all passed. If the movers pin finds fewer than 20 crossing rows on page 1, read page 2 as well (`positions-dm-demo-page-2.json`) in the generator and the pin; never pad the list.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/fixtures/demo/generate-demo-lab.mjs web/tests/fixtures/demo/scenarios-demo.json web/tests/fixtures/demo/run-book-demo-eth_minus_30.json web/tests/fixtures/demo/run-book-set-demo.json web/tests/fixtures/demo/index.ts web/tests/unit/demo-lab-weld.spec.ts web/tests/unit/fixture-clock-law.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Scenarios demo dataset - generated, clock-law checked, the run-book welded to the demo Book's own eth_minus_30 waterfall and histogram" -- web/tests/fixtures/demo/generate-demo-lab.mjs web/tests/fixtures/demo/scenarios-demo.json web/tests/fixtures/demo/run-book-demo-eth_minus_30.json web/tests/fixtures/demo/run-book-set-demo.json web/tests/fixtures/demo/index.ts web/tests/unit/demo-lab-weld.spec.ts web/tests/unit/fixture-clock-law.spec.ts
```

---
### Task 11: The Scenarios page — library, workspace, sections, one-address mode, drawer

**Integrator builds this personally** (spec §9.2). Consumes every interface above; produces the test-id contract. Looked at in both themes on a production build with the demo routes mocked before it is committed; the e2e contract lands in Task 12, pins and the owner gate in Task 14.

**Files:**
- Rewrite: `web/app/lab/page.tsx`, `web/app/lab/lab.module.css`
- Create: `web/app/lab/LabSurface.tsx`, `web/app/lab/money.ts`, `web/app/lab/LabTiles.tsx`, `web/app/lab/TransitionCard.tsx`, `web/app/lab/MoversTable.tsx`, `web/app/lab/LegacyResult.tsx`, `web/app/lab/AssumptionsDrawer.tsx`, `web/app/lab/AddressWorkspace.tsx`, `web/app/lab/StaleBanner.tsx`
- Modify: `web/app/inspector/[addr]/InspectorSurface.tsx` (secondary → `/lab?address={addr}`), `web/app/inspector/[addr]/StressTable.tsx` (section link → `/lab?address={addr}`), `web/scripts/screenshot-pages.mjs` (the `lab` page + routes; Task 14's change pulled forward to look at the page)

The old Lab components stay in the tree until Task 12 deletes them; `LabClient` is no longer imported after this task, so `page.tsx` is the only file that changes its imports.

- [ ] **Step 1: `money.ts` — the three registers, every scale guarded**

```ts
// web/app/lab/money.ts
// The page's three money registers (plan R11): book-level in the Book's tiers,
// account-level in full dollars, exact wire values in the drawer. A scale that
// fails the guard prints "unreadable scale"; a null value prints a dash.
import { humanUsdFull } from "@/lib/human-price";
import { humanUsd } from "@/lib/human-usd";
import { signedUsd } from "@/lib/lab-headline";
import { groupInt } from "@/lib/prose";
import { isWireScale } from "@/lib/wireGuard";

export const UNREADABLE_SCALE = "unreadable scale";
type Money = (value: bigint | null | undefined) => string;

const guarded = (decimals: number | null, print: (v: bigint, d: number) => string): Money => {
  if (decimals === null || !isWireScale(decimals)) return (value) => (value == null ? "—" : UNREADABLE_SCALE);
  return (value) => (value == null ? "—" : print(value, decimals));
};
export const bookMoney = (decimals: number | null): Money => guarded(decimals, humanUsd);
export const signedBookMoney = (decimals: number | null): Money => guarded(decimals, signedUsd);
export const accountMoney = (decimals: number | null): Money => guarded(decimals, humanUsdFull);

/** The exact wire integer at its scale: `1,280,000.000000`. */
export function wireExact(value: bigint, decimals: number): string {
  if (!isWireScale(decimals)) return UNREADABLE_SCALE;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const div = 10n ** BigInt(decimals);
  const whole = groupInt(abs / div);
  const frac = decimals === 0 ? "" : `.${(abs % div).toString().padStart(decimals, "0")}`;
  return `${negative ? "−" : ""}${whole}${frac}`;
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
// web/app/lab/page.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { LabSurface } from "./LabSurface";

export const metadata: Metadata = { title: "Scenarios" };

/** Scenarios (spec §5.4): what changes under a named shock? `useSearchParams` needs a Suspense boundary to keep the route static. */
export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <LabSurface />
    </Suspense>
  );
}
```

- [ ] **Step 3: `LabSurface.tsx` — the composition**

```tsx
// web/app/lab/LabSurface.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddressField, ScenarioLibrary, StatusPill, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useAddressLookup } from "@/lib/address-lookup";
import { humanAge } from "@/lib/freshness";
import { isAddress } from "@/lib/format";
import { deriveInspectorView } from "@/lib/inspector-view";
import { addressWorkspace } from "@/lib/lab-address";
import { deepLinkDecision } from "@/lib/lab-deep-link";
import { useLabReading } from "@/lib/lab-reading";
import { deriveLabView } from "@/lib/lab-view";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { useMetaConstants } from "@/lib/meta";
import { resultReceipt } from "@/lib/resultIdentity";
import { AddressWorkspace } from "./AddressWorkspace";
import { AssumptionsDrawer } from "./AssumptionsDrawer";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { LegacyResult } from "./LegacyResult";
import { MoversTable } from "./MoversTable";
import { StaleBanner } from "./StaleBanner";
import { TransitionCard } from "./TransitionCard";

type Mode = "book" | "address";

const PROJECTION = (
  <span data-testid="lab-projection">
    <StatusPill tone="projection">PROJECTION</StatusPill>
  </span>
);

export function LabSurface() {
  const params = useSearchParams();
  const router = useRouter();
  const reading = useLabReading();
  const meta = useMetaConstants();
  const linkedAddress = params.get("address");
  const [mode, setMode] = useState<Mode>(linkedAddress !== null ? "address" : "book");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("scenario"));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [address, setAddress] = useState(linkedAddress ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const view = deriveLabView(reading, { selectedId, checked });
  const book = view.book;
  const definition = book.definition;

  // One-address mode is the Inspector's reading. "" is not an address, so the hook fetches nothing until one is entered.
  const lookupFor = mode === "address" && isAddress(address) ? address : "";
  const addressReading = useAddressLookup(lookupFor);
  const inspectorView = mode === "address" && address !== "" ? deriveInspectorView(addressReading, meta.constants) : null;
  const space = addressWorkspace({ address, view: inspectorView, selectedId: view.selectedId });

  // The result's own age, anchored to its receipt; the chip ticks from the moment the run settled.
  const identity = book.identity;
  const age = useAnchoredAgeSeconds(identity === null ? null : resultReceipt(identity, 0));

  // Deep links decide once, when the listing has answered (the ids must be listed to dispatch).
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || reading.listing.phase !== "ready") return;
    decided.current = true;
    const listed = reading.listing.value.scenarios.map((s) => s.id);
    const single = params.get("scenario");
    const decision = deepLinkDecision(single, params.get("scenarios"), listed);
    if (decision.kind === "single" && single !== null && listed.includes(single)) reading.run(single);
    if (decision.kind === "set") {
      setNotice(decision.notice);
      if (!decision.overCap && decision.runIds.length > 0) {
        setChecked(new Set(decision.runIds));
        reading.runSet(decision.runIds);
      }
    }
    if (decision.kind === "conflict") setNotice(decision.notice);
  }, [reading, params]);

  const chips = identity === null ? book.chips : [book.chips[0]!, book.chips[1]!, { label: "Computed", value: `${humanAge(age.seconds ?? 0)} ago` }, ...book.chips.slice(2)];
  const running = book.state === "running";
  const runLabel = definition === null ? "Run" : `Run ${definition.label}`;
  const kicker: ReactNode = (
    <>
      {mode === "book" ? book.kicker : `Account ${space.address === "" ? "—" : space.address.slice(0, 6) + "…" + space.address.slice(-4)} · Cash`} {PROJECTION}
    </>
  );
  const busy = mode === "book" ? running || book.state === "listing-loading" : space.state === "loading";
  const cashResult = book.cash?.kind === "result" ? book.cash.result : null;

  return (
    <div className={styles.page} data-testid="lab-surface" data-mode={mode} data-state={mode === "book" ? book.state : space.state} data-banner={book.banner ?? undefined} aria-busy={busy ? "true" : undefined}>
      <ScenarioLibrary
        testId="lab-library"
        mode={mode}
        onMode={(m) => {
          setMode(m);
          const next = new URLSearchParams(params.toString());
          if (m === "book") next.delete("address");
          else if (address !== "") next.set("address", address);
          router.replace(`/lab${next.size === 0 ? "" : `?${next.toString()}`}`);
        }}
        items={mode === "address" ? view.library.map((r) => ({ ...r, outcome: { key: "not-run", text: space.rows.some((x) => x.id === r.id) ? "Applies to this address" : "Not on this address", tone: "dim" }, checked: false })) : view.library}
        onSelect={setSelectedId}
        onCheck={(id, on) =>
          setChecked((prev) => {
            const next = new Set(prev);
            if (on) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        addressSlot={
          mode === "address" ? (
            <AddressField
              testId="lab-address"
              initial={address}
              hint="any 0x address"
              onInspect={(addr) => {
                setAddress(addr);
                const next = new URLSearchParams(params.toString());
                next.set("address", addr);
                router.replace(`/lab?${next.toString()}`);
              }}
            />
          ) : undefined
        }
        run={{ label: mode === "book" ? runLabel : "Run against this address", disabled: mode === "book" ? definition === null || running : !isAddress(address), onRun: () => (mode === "book" && definition !== null ? reading.run(definition.id) : undefined) }}
        compare={null}
        emptyText={book.state === "listing-loading" ? "Loading the committed scenarios…" : "No committed scenarios are listed."}
        footnote={`Committed, versioned scenarios${view.configVersion === null ? "" : ` (config ${view.configVersion})`}. No sliders — every result is reproducible.`}
      />
      <div className={styles.workspace}>
        {notice !== null && (
          <p className={styles.notice} data-testid="lab-deeplink-notice">
            {notice}
          </p>
        )}
        {mode === "address" ? (
          <AddressWorkspace space={space} kicker={kicker} />
        ) : (
          <>
            <VerdictHeader
              testId="lab-verdict"
              kicker={kicker}
              emphasis={book.headline.emphasis}
              rest={book.headline.rest}
              tone={book.headline.tone}
              dek={book.headline.dek}
              chips={chips}
              actions={
                book.run !== null ? (
                  <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="lab-drawer">
                    Assumptions · Out of model
                  </button>
                ) : undefined
              }
            />
            {book.banner !== null && definition !== null && <StaleBanner kind={book.banner} skew={book.skew} batchId={book.run?.batch.id ?? null} onRerun={() => reading.run(definition.id)} rerunDisabled={running} />}
            <LabTiles reading={book.cash} pending={running} testPrefix="lab-kpi" />
            <TransitionCard reading={book.cash} />
            {cashResult !== null && <MoversTable table={cashResult.movers} />}
            {book.legacy !== null && <LegacyResult reading={book.legacy} />}
            <AssumptionsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} run={book.run} cash={cashResult} />
          </>
        )}
      </div>
    </div>
  );
}
```

`AddressField`'s `onInspect` is Plan 2's callback (it navigated to `/inspector/{addr}` there; here it sets the address in place). The address-mode library rows print whether the address's stress response carries each scenario (R15) and no checkbox.

- [ ] **Step 4: `LabTiles.tsx`**

```tsx
// web/app/lab/LabTiles.tsx
import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { bookMoney, signedBookMoney } from "./money";

function refusedWord(reading: EngineReading | null): string {
  if (reading === null) return "not run";
  switch (reading.kind) {
    case "withheld":
      return "withheld";
    case "not-covered":
      return "not modelled";
    case "contradictory":
    case "unreadable":
      return "contradictory";
    case "result":
      return "";
  }
}

/** Newly liquidatable · Liquidatable debt Δ · Bad debt at liquidation Δ · Accounts moved — the same four in every state (plan R2). */
export function LabTiles({ reading, pending, testPrefix }: { reading: EngineReading | null; pending: boolean; testPrefix: string }) {
  const r = reading?.kind === "result" ? reading.result : null;
  const word = refusedWord(reading);
  const money = bookMoney(r?.decimals ?? null);
  const signed = signedBookMoney(r?.decimals ?? null);
  const heat = r?.heat.kind === "ok" ? r.heat.view : null;
  const tone = (t: Tone): Tone => (r === null ? "refused" : t);
  const sub = (text: string) => (r === null ? word : text);
  return (
    <div className={`${kit.kpis} ${kit.kpis4}`}>
      <KpiTile testId={`${testPrefix}-newly`} label="Newly liquidatable" value={r === null ? "—" : groupInt(r.newly)} sub={sub(`accounts · was ${groupInt(r?.beforeEligible ?? 0)}, now ${groupInt(r?.afterEligible ?? 0)}`)} tone={tone(r !== null && r.newly > 0 ? "crit" : "ok")} pending={pending} />
      <KpiTile testId={`${testPrefix}-debt`} label="Liquidatable debt" value={r === null ? "—" : signed(r.deltaEligibleDebt)} sub={sub(`${money(r?.eligibleDebtBefore)} → ${money(r?.eligibleDebtAfter)}`)} tone={tone(r !== null && r.deltaEligibleDebt > 0n ? "crit" : "neutral")} pending={pending} />
      <KpiTile testId={`${testPrefix}-baddebt`} label="Bad debt at liquidation" value={r === null ? "—" : signed(r.deltaBadDebt)} sub={sub(`${money(r?.badDebtBefore)} → ${money(r?.badDebtAfter)}`)} tone={tone(r !== null && r.deltaBadDebt > 0n ? "warn" : "neutral")} pending={pending} />
      <KpiTile
        testId={`${testPrefix}-moved`}
        label="Accounts moved"
        value={r === null || r.laneChanged === null ? "—" : groupInt(r.laneChanged)}
        sub={sub(r !== null && r.laneChanged === null ? "not stated" : `of ${groupInt(r?.measured ?? 0)} measured · ${heat === null ? "movement not readable" : `${groupInt(heat.improved)} improved`}`)}
        tone={tone("neutral")}
        pending={pending}
      />
    </div>
  );
}
```

- [ ] **Step 5: `TransitionCard.tsx`**

```tsx
// web/app/lab/TransitionCard.tsx
import { ChartCard, Heatmap, type HeatCellView } from "@/components/kit";
import { heatIntensity } from "@/lib/lab-geometry";
import type { HeatmapView } from "@/lib/lab-transitions";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";
import { bookMoney } from "./money";

export function cellsOf(view: HeatmapView): HeatCellView[] {
  const money = bookMoney(view.decimals);
  return view.cells.map((c) => ({
    from: c.from,
    to: c.to,
    count: c.rows,
    title: `${groupInt(c.rows)} account${c.rows === 1 ? "" : "s"} · ${view.bands[c.from]?.label ?? ""} → ${view.bands[c.to]?.label ?? ""} · debt ${money(c.debtBefore)}`,
    movement: c.movement,
    intensity: heatIntensity(c.rows, view.maxRows),
  }));
}

export function finding(view: HeatmapView): string {
  const axes = view.merged ? "Rows: room under cap today · columns: after the shock · cells are accounts." : "Rows: health-factor lane today · columns: after the shock, as the wire serves them · cells are accounts.";
  const moves = `${groupInt(view.bandChanged)} accounts change band; ${groupInt(view.crossedCap)} cross the cap; ${view.improved === 0 ? "none improve" : `${groupInt(view.improved)} improve`}.`;
  const unmeasured = view.unmeasuredRows === 0 ? "" : ` ${groupInt(view.unmeasuredRows)} not measured.`;
  return `${axes} ${moves}${unmeasured}`;
}

/** Where accounts move (spec §5.4): the transition heatmap, or the state's own word. */
export function TransitionCard({ reading, testId = "lab-transitions", gridTestId = "lab-heatmap" }: { reading: EngineReading | null; testId?: string; gridTestId?: string }) {
  const r = reading?.kind === "result" ? reading.result : null;
  const heat = r?.heat ?? null;
  return (
    <ChartCard title="Where accounts move" testId={testId} link={r === null ? undefined : { href: "#movers", label: "Most affected accounts →" }} finding={<span data-testid={`${testId}-finding`}>{heat?.kind === "ok" ? finding(heat.view) : heat?.kind === "contradictory" ? `Not drawn: ${heat.reasons.join("; ")}.` : reading === null ? "Run a scenario to see where accounts move." : reading.kind === "withheld" ? "Withheld: the Cash book was not computed under this scenario." : reading.kind === "not-covered" ? "This scenario does not model the Cash book." : "Not drawn: the result contradicts itself."}</span>}>
      {heat?.kind === "ok" ? (
        <Heatmap bands={heat.view.bands} cells={cellsOf(heat.view)} rowsLabel="today" colsLabel="after" merged={heat.view.merged} testId={gridTestId} cellTestIdPrefix={`${gridTestId}-cell`} />
      ) : (
        <p className={styles.dim}>{reading === null ? "No result yet." : "No grid: nothing here is a count."}</p>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 6: `MoversTable.tsx`**

```tsx
// web/app/lab/MoversTable.tsx
import Link from "next/link";
import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import { truncateAddress } from "@/lib/format";
import { moversCaption, type MoversTable as Table } from "@/lib/lab-movers";
import styles from "./lab.module.css";

const COLUMNS = [
  { key: "account", header: "Account" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "debt", header: "Debt", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The wire's movers, one row each; rows open the Inspector; sub-$100 rows dim (plan R4, R5). */
export function MoversTable({ table }: { table: Table }) {
  const rows: KitRow[] = table.rows.map((m) => ({
    key: m.account,
    testId: `lab-movers-row-${m.account}`,
    dim: m.tier === "small" || m.tier === "dust",
    cells: {
      account: (
        <Link href={`/inspector/${m.account}`} className={styles.mono} title={m.account}>
          {truncateAddress(m.account)}
        </Link>
      ),
      before: m.roomBefore,
      after: m.roomAfter,
      debt: m.debtText,
      flips: m.becomesLiquidatable === null ? <StatusPill tone="refused">Cannot say</StatusPill> : m.becomesLiquidatable ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <section id="movers" data-testid="lab-movers">
      <SectionHead title="Most affected accounts" qualifier="room today → after the shock · the wire's own ranking" />
      <KitTable columns={COLUMNS} rows={rows} testId="lab-movers-table" emptyText="No account moved under this scenario." />
      <p className={styles.dim} data-testid="lab-movers-caption" title={table.note}>
        {moversCaption(table)}
        {table.unreadable.length > 0 ? ` · unreadable: ${table.unreadable.join(", ")}` : ""}
      </p>
    </section>
  );
}
```

- [ ] **Step 7: `LegacyResult.tsx`, `StaleBanner.tsx`**

```tsx
// web/app/lab/LegacyResult.tsx
import type { EngineReading } from "@/lib/lab-view";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { TransitionCard } from "./TransitionCard";

/** The legacy market's result: the same four tiles and its own lanes, in its own decimals, never beside a Cash sum (plan R10). */
export function LegacyResult({ reading }: { reading: EngineReading }) {
  return (
    <details className={styles.legacy} data-testid="lab-legacy">
      <summary>Legacy · Aave v3 market result</summary>
      <div className={styles.legacyBody}>
        <LabTiles reading={reading} pending={false} testPrefix="lab-legacy-kpi" />
        <TransitionCard reading={reading} testId="lab-legacy-transitions" gridTestId="lab-legacy-heatmap" />
        <p className={styles.dim}>Judged by its own health factor, in its own unit. The two books are never added together.</p>
      </div>
    </details>
  );
}
```

```tsx
// web/app/lab/StaleBanner.tsx
import kit from "@/components/kit/kit.module.css";
import { groupInt, joinAnd } from "@/lib/prose";
import styles from "./lab.module.css";

/** A result for a previous input or a superseded batch keeps its figures; the banner says so and offers the re-run (plan R13). */
export function StaleBanner({ kind, skew, batchId, onRerun, rerunDisabled }: { kind: "stale-input" | "superseded"; skew: readonly string[]; batchId: number | null; onRerun: () => void; rerunDisabled: boolean }) {
  const text =
    kind === "superseded"
      ? `Batch ${batchId === null ? "?" : groupInt(batchId)} has been superseded: a newer complete batch exists. This result stands for the batch it names.`
      : `Results for a previous input: the listing's ${joinAnd(skew)} changed since this run. This result stands for the definition it was computed under.`;
  return (
    <div className={styles.banner} data-testid="lab-banner" data-kind={kind} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        Run again
      </button>
    </div>
  );
}
```

- [ ] **Step 8: `AssumptionsDrawer.tsx`**

```tsx
// web/app/lab/AssumptionsDrawer.tsx
"use client";

import { Drawer } from "@/components/Drawer";
import type { EngineResult } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import type { RunBookResponse } from "@/lib/runbook";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "./lab.module.css";
import { wireExact } from "./money";

const flags = (s: RunBookResponse["applied_shocks"][number]): string => [s.snapped ? "snapped" : null, s.base_snapped ? "base snapped" : null, s.cap_bound ? "cap bound" : null].filter((f): f is string => f !== null).join(" · ");
const exact = (v: string): string => (isWireDecimal(v) ? v : `unreadable (${JSON.stringify(v)})`);

/** Path assumption, applied shocks, held-flat inputs, out of model, config, wire notes verbatim, the exact wire values (plan R10). */
export function AssumptionsDrawer({ open, onClose, run, cash }: { open: boolean; onClose: () => void; run: RunBookResponse | null; cash: EngineResult | null }) {
  return (
    <Drawer open={open} onClose={onClose} title="Assumptions & out of model">
      <div className={styles.method} data-testid="lab-drawer-body">
        {run === null ? (
          <p>No result is open.</p>
        ) : (
          <>
            <h3>Path assumption</h3>
            <p>{run.path_assumption}</p>
            <h3>Applied shocks</h3>
            {run.applied_shocks.length === 0 ? (
              <p>No mark moved: this scenario carries no price shock.</p>
            ) : (
              <ul>
                {run.applied_shocks.map((s) => (
                  <li key={`${s.asset}-${String(s.chain_id)}`}>
                    <code>{s.asset}</code> (chain {String(s.chain_id)}, {s.source}): <code>{exact(s.before)}</code> → <code>{exact(s.after)}</code> × {exact(s.factor_num)}/{exact(s.factor_den)}
                    {flags(s) === "" ? "" : ` · ${flags(s)}`}
                  </li>
                ))}
              </ul>
            )}
            <h3>Held flat</h3>
            {run.held_flat.length === 0 ? (
              <p>Nothing held flat.</p>
            ) : (
              <ul>
                {run.held_flat.map((h) => (
                  <li key={`${h.asset}-${String(h.chain_id)}`}>
                    <code>{h.asset}</code> (chain {String(h.chain_id)}, {h.source}) at <code>{exact(h.value)}</code>
                  </li>
                ))}
              </ul>
            )}
            <h3>Out of model</h3>
            <ul>
              {run.out_of_model.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <h3>Identity</h3>
            <p>
              Scenario <code>{run.scenario_id}</code> · {run.scenario_version} · config {run.scenario_config_version} · batch {groupInt(run.batch.id)} · served {run.served_at}
            </p>
            {cash !== null && (
              <>
                <h3>Exact wire values · Cash</h3>
                <p>
                  newly eligible <code>{String(cash.newly)}</code> · eligible debt <code>{wireExact(cash.eligibleDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.eligibleDebtAfter, cash.decimals)}</code> (Δ <code>{wireExact(cash.deltaEligibleDebt, cash.decimals)}</code>) · bad debt <code>{wireExact(cash.badDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.badDebtAfter, cash.decimals)}</code> (Δ{" "}
                  <code>{wireExact(cash.deltaBadDebt, cash.decimals)}</code>) · lane changed <code>{cash.laneChanged === null ? "null" : String(cash.laneChanged)}</code> of <code>{String(cash.measured)}</code> measured
                </p>
                <h3>The wire on its lanes</h3>
                <p data-testid="lab-drawer-transitions-note">{cash.transitionsNote}</p>
                <p>{cash.note}</p>
              </>
            )}
            <h3>Wire notes</h3>
            <ul>
              {run.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 9: `AddressWorkspace.tsx`**

```tsx
// web/app/lab/AddressWorkspace.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { KitTable, KpiTile, SectionHead, StatusPill, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { horizonLabel } from "@/lib/address-stress";
import type { AddressWorkspace as Space } from "@/lib/lab-address";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";
import { accountMoney } from "./money";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The one-address workspace: the Inspector's tiles for before and after the selected scenario, and every scenario's row (plan R8, R15). */
export function AddressWorkspace({ space, kicker }: { space: Space; kicker: ReactNode }) {
  const money = accountMoney(space.decimals);
  const chips = space.batchId === null ? [] : [{ label: "Result for batch", value: groupInt(space.batchId) }, ...(space.selected === null ? [] : [{ label: "Scenario", value: space.selected.id }])];
  const t = space.tiles;
  const tile = (key: string, side: "before" | "after", label: string, v: { value: string; tone: "crit" | "warn" | "ok" | "neutral" | "refused" } | undefined) => (
    <KpiTile testId={`lab-address-kpi-${key}-${side}`} label={label} value={v?.value ?? "—"} tone={v?.tone ?? "refused"} pending={space.state === "loading"} />
  );
  const rows: KitRow[] = space.rows.map((r) => ({
    key: r.id,
    dim: !r.applicable,
    cells: {
      scenario: r.projection === null ? r.label : <span title={r.projectionNote ?? undefined}>{r.label} <StatusPill tone="projection">PROJECTION</StatusPill></span>,
      before: money(r.before?.room),
      after: r.projection === null ? money(r.after?.room) : r.projection.map((h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null ? "—" : `+${money(h.extraInterest)}`} interest`).join(" · "),
      flips: !r.applicable ? (r.reason ?? "not applicable") : r.flips === null ? <StatusPill tone="refused">Cannot say</StatusPill> : r.flips ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <>
      <VerdictHeader testId="lab-verdict" kicker={kicker} emphasis={space.headline.emphasis} rest={space.headline.rest} tone={space.headline.tone} dek={space.headline.dek} chips={chips} actions={space.address !== "" && space.state === "rows" ? <Link href={`/inspector/${space.address}`} className={`${kit.btn} ${kit.btnGhost}`}>Open in the Inspector →</Link> : undefined} />
      <div className={styles.tilesPair} data-testid="lab-address-tiles">
        <div className={`${kit.kpis} ${kit.kpis4}`}>
          {tile("debt", "before", "Debt today", t?.debtBefore)}
          {tile("cap", "before", "Borrow cap today", t?.capBefore)}
          {tile("room", "before", "Room today", t?.roomBefore)}
          {tile("status", "before", "Status today", t?.statusBefore)}
        </div>
        <div className={`${kit.kpis} ${kit.kpis4}`}>
          {tile("debt", "after", "Debt after", t?.debtAfter)}
          {tile("cap", "after", "Borrow cap after", t?.capAfter)}
          {tile("room", "after", "Room after", t?.roomAfter)}
          {tile("status", "after", "Status after", t?.statusAfter)}
        </div>
      </div>
      <section data-testid="lab-address-section">
        <SectionHead title="Every committed scenario" qualifier="applied to this account · shocked figures are projections, not readings" />
        <KitTable columns={COLUMNS} rows={rows} testId="lab-address-table" emptyText={space.state === "rows" ? "No scenario applies to this address." : space.headline.emphasis} />
      </section>
    </>
  );
}
```

- [ ] **Step 10: `lab.module.css` (rewrite)**

```css
/* Scenarios (spec §5.4): the 300px library beside one workspace; stacks under 900px. Page-local rules only. */
.page { display: grid; grid-template-columns: 300px 1fr; gap: 20px; align-items: start; }
.workspace { min-width: 0; display: grid; gap: 12px; align-content: start; }
.notice { margin: 0; color: var(--warn-text); font-size: var(--type-small); }
.banner { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 14px; border: 1px dashed var(--warn); border-radius: 8px; color: var(--ink); font-size: var(--type-body); }
.dim { color: var(--ink-3); font-size: var(--type-small); margin: 6px 0 0; }
.mono { font-family: var(--mono); font-size: var(--type-mono); color: var(--ink); text-decoration: none; }
.legacy { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel); }
.legacy > summary { cursor: pointer; font-size: var(--type-body); font-weight: var(--w-medium); color: var(--ink); }
.legacyBody { display: grid; gap: 12px; margin-top: 12px; }
.tilesPair { display: grid; gap: 12px; }
.method { display: grid; gap: 8px; font-size: var(--type-body); color: var(--ink); }
.method h3 { margin: 8px 0 0; font-size: var(--type-card); }
.method code { font-family: var(--mono); font-size: var(--type-mono-sm); }
.method ul { margin: 0; padding-left: 18px; }
@media (max-width: 900px) { .page { grid-template-columns: 1fr; } }
```

- [ ] **Step 11: The Inspector's link (R7) and the gate script**

In `web/app/inspector/[addr]/InspectorSurface.tsx` the toolbar's secondary becomes `{ href: `/lab?address=${addr}`, label: "Stress this address →" }` (keep it gated on `view.cash !== null`); in `web/app/inspector/[addr]/StressTable.tsx` the section link becomes `{ href: `/lab?address=${view.cashWire === null ? "" : view.cashWire.account}`, label: "Open Scenarios →" }` — if `cashWire` carries no `account` field, thread `addr` into `StressTable` as a prop from the surface instead. Update the Inspector contract pin that asserts `#stress` (Task 12 re-pins it to the new href).

In `web/scripts/screenshot-pages.mjs`: `PAGES` gains `lab: "/lab?scenario=eth_minus_30"`; the route block gains, before the `/v1/address/*` routes:

```js
    await page.route("**/v1/scenarios/run-book-set", (r) => json(r, demo.DEMO_RUN_BOOK_SET));
    await page.route("**/v1/scenarios/*/run-book", (r) => json(r, demo.DEMO_RUN_BOOK_ETH));
    await page.route("**/v1/scenarios", (r) => json(r, demo.DEMO_SCENARIOS));
```

and the usage comment reads `[overview|book|inspector|lab ...]`.

- [ ] **Step 12: Gates, then look at it**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`
Expected: clean. Then, with nothing on :3111, `npm run start` (background, from `web/`), poll `curl --retry 30 --retry-delay 1 --retry-all-errors http://localhost:3111/lab` for a 200, then `node scripts/screenshot-pages.mjs <scratch>/lab-look lab` and open the four PNGs. Check against the mockup block: library left with the four rows and "Run ETH -30 percent"; kicker with the PROJECTION pill; headline `$1.2M more Cash debt becomes liquidatable, across 118 accounts.`; four tiles `118 · +$1.2M · +$40K · 941`; the 7×7 heatmap with `49` top-left, `118` in the over-cap column, `932` bottom-right; the movers table with 20 rows; the legacy `<details>` collapsed. Also load `/lab` bare (not-run state: the definition, dashed tone, tiles `—`), `/lab?address=<DEMO_NEAR_ADDR>` (one-address: before/after tiles, three rows). Fix what is off in these files, re-run the gates.

- [ ] **Step 13: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/lab/page.tsx web/app/lab/lab.module.css web/app/lab/LabSurface.tsx web/app/lab/money.ts web/app/lab/LabTiles.tsx web/app/lab/TransitionCard.tsx web/app/lab/MoversTable.tsx web/app/lab/LegacyResult.tsx web/app/lab/AssumptionsDrawer.tsx web/app/lab/AddressWorkspace.tsx web/app/lab/StaleBanner.tsx "web/app/inspector/[addr]/InspectorSurface.tsx" "web/app/inspector/[addr]/StressTable.tsx" web/scripts/screenshot-pages.mjs
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Scenarios page - the library beside one workspace, the transition heatmap on the wire's merged lanes, the most-affected accounts, the legacy result folded, the assumptions drawer, one-address mode on the Inspector's reading" -- web/app/lab/page.tsx web/app/lab/lab.module.css web/app/lab/LabSurface.tsx web/app/lab/money.ts web/app/lab/LabTiles.tsx web/app/lab/TransitionCard.tsx web/app/lab/MoversTable.tsx web/app/lab/LegacyResult.tsx web/app/lab/AssumptionsDrawer.tsx web/app/lab/AddressWorkspace.tsx web/app/lab/StaleBanner.tsx "web/app/inspector/[addr]/InspectorSurface.tsx" "web/app/inspector/[addr]/StressTable.tsx" web/scripts/screenshot-pages.mjs
```

---
### Task 12: The page-test contract, and retiring the old Lab's components and pins (R14)

**Files:**
- Rewrite: `web/tests/e2e/lab.spec.ts`
- Delete: every file under `web/app/lab/` except `page.tsx`, `lab.module.css` and the Task 11 files (`LabSurface, money, LabTiles, TransitionCard, MoversTable, LegacyResult, AssumptionsDrawer, AddressWorkspace, StaleBanner`); `web/tests/e2e/{tornado,runbook-transition,runbook-bsplit,chart-spec-v4}.spec.ts` where nothing survives (see the mapping); `web/tests/unit/{address-binding,bad-debt-rate,engine-classification,flip-ranking,frontier-scale,lab-dek,lab-frontier,lab-matrix,lab-panel-lines,lab-runbook-lines,lab-transition,matrix-outcome,mover-dumbbells,scenario-lines,set-run-classification,tornado-lines,set-run-outcome}.spec.ts` (the moved specs from Tasks 4 and 7 are their homes now; `set-run-outcome.spec.ts` stays if it imports only `lib/` — check and say)
- Modify: `web/tests/e2e/{shell,state-matrix,w3l-slots,book-charts,r1-fixes,r10-fixes,inspector}.spec.ts`; `.superpowers/sdd/progress-ui-overhaul.md` (retirement ledger)
- Check and delete if the old Lab was the only importer: `web/components/charts/FrontierLedger.tsx`, `web/components/charts/WaterfallSteps.tsx`

**Interfaces:**
- Consumes the test-id contract (Task 11), `tests/fixtures/demo` (`DEMO_SCENARIOS`, `DEMO_RUN_BOOK_ETH`, `DEMO_RUN_BOOK_SET`, `DEMO_META`, `DEMO_ADDRESS_NEAR`, `DEMO_STRESS_NEAR`, `DEMO_HISTORY_NEAR`, `DEMO_EVENTS_NEAR`, `DEMO_PARAMS_DM`, `DEMO_NEAR_ADDR`), `tests/fixtures/proof` (`EVIDENCE_MANIFEST`), `tests/fixtures/inspector` (`ADDRESS_NOT_FOUND`, `NOT_FOUND_ADDR`), `tests/fixtures/{error-not-found,error-unavailable,error-rate-limited}.json`.
- Produces: the Scenarios page-test contract (spec §7): cold load dispatches nothing, one POST per click, identity chips present, refused never zero, never summed, deep links carry the scenario and the address, the states and banners.

- [ ] **Step 1: The contract spec (replaces the file)**

```ts
// web/tests/e2e/lab.spec.ts
// The Scenarios page-test contract (spec 2026-09-15 §5.4, §7). Mocked from the
// demo dataset for the primary state (the demo Book's own eth_minus_30 run)
// and shaped bodies for the other outcomes. Every headline string here is
// produced by lib/lab-headline.ts; every figure is the demo Book's.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  DEMO_ADDRESS_NEAR,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_RUN_BOOK_ETH,
  DEMO_RUN_BOOK_SET,
  DEMO_SCENARIOS,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, NOT_FOUND_ADDR } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, headers: { ...CORS, ...headers }, contentType: "application/json", body: JSON.stringify(body) });
const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));

interface Mocks {
  scenarios?: unknown;
  runBook?: unknown;
  runBookStatus?: number;
  runBookHeaders?: Record<string, string>;
  runBookDelayMs?: number;
  set?: unknown;
  setStatus?: number;
  address?: unknown;
  addressStatus?: number;
  stress?: unknown;
  stressStatus?: number;
}

/** Every route the page can issue is answered; `*` never crosses `/`, so the listing route does not swallow the run routes. */
async function mockLab(page: Page, m: Mocks = {}): Promise<{ runs: () => number; sets: () => number; lookups: () => number }> {
  let runs = 0;
  let sets = 0;
  let lookups = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, m.stress ?? DEMO_STRESS_NEAR, m.stressStatus ?? 200));
  await page.route("**/v1/address/*", (route) => {
    lookups += 1;
    return json(route, m.address ?? DEMO_ADDRESS_NEAR, m.addressStatus ?? 200);
  });
  await page.route("**/v1/scenarios/run-book-set", (route) => {
    sets += 1;
    return json(route, m.set ?? DEMO_RUN_BOOK_SET, m.setStatus ?? 200);
  });
  await page.route("**/v1/scenarios/*/run-book", async (route) => {
    runs += 1;
    if (m.runBookDelayMs !== undefined) await new Promise((r) => setTimeout(r, m.runBookDelayMs));
    return json(route, m.runBook ?? DEMO_RUN_BOOK_ETH, m.runBookStatus ?? 200, m.runBookHeaders);
  });
  await page.route("**/v1/scenarios", (route) => json(route, m.scenarios ?? DEMO_SCENARIOS));
  return { runs: () => runs, sets: () => sets, lookups: () => lookups };
}

const surface = (page: Page) => page.getByTestId("lab-surface");
const headline = (page: Page) => page.getByTestId("lab-verdict-headline");
const dek = (page: Page) => page.getByTestId("lab-verdict-dek");
const chip = (page: Page, label: string) => page.locator(`[data-chip='${label}']`);
const tile = (page: Page, key: string) => page.getByTestId(`lab-kpi-${key}`);
const cell = (page: Page, from: number, to: number) => page.getByTestId(`lab-heatmap-cell-${String(from)}-${String(to)}`);
const runIt = async (page: Page) => {
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "result");
};
const withCash = (patch: (e: (typeof DEMO_RUN_BOOK_ETH)["engines"][number]) => unknown) => ({
  ...DEMO_RUN_BOOK_ETH,
  engines: DEMO_RUN_BOOK_ETH.engines.map((e) => (e.engine === "debt_manager" ? patch(e) : e)),
});

test("cold load: the library from the listing, the first scenario's definition, nothing dispatched, tiles in the not-run register", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  const rows = page.locator("[data-testid^='lab-library-row-']");
  await expect(rows).toHaveCount(DEMO_SCENARIOS.scenarios.length);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toHaveAttribute("data-outcome", "not-run");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Not run yet");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText(DEMO_SCENARIOS.scenarios[0]!.description);
  await expect(headline(page)).toHaveText("ETH -30 percent — 1 committed shock, not run yet.");
  await expect(page.getByTestId("lab-projection")).toContainText("PROJECTION");
  await expect(page.getByTestId("lab-run")).toHaveText("Run ETH -30 percent");
  for (const key of ["newly", "debt", "baddebt", "moved"]) {
    await expect(tile(page, key)).toContainText("—");
    await expect(tile(page, key)).toContainText("not run");
    await expect(tile(page, key)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(page.getByTestId("lab-drawer")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(0);
});

test("one click, one POST: the demo result — the §3.5 headline, the dek, the identity chips, the four tiles, the library's outcome word", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  expect(counts.runs()).toBe(1);
  await expect(headline(page)).toHaveText("$1.2M more Cash debt becomes liquidatable, across 118 accounts.");
  await expect(dek(page)).toHaveText(
    "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.",
  );
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(chip(page, "Scenario")).toContainText("eth_minus_30 · v1");
  await expect(chip(page, "Computed")).toContainText("ago");
  await expect(chip(page, "Engines")).toContainText("Aave v3 market (legacy) and Cash");
  await expect(chip(page, "Config")).toContainText("v1");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(tile(page, "newly")).toContainText("was 49, now 167");
  await expect(tile(page, "newly")).toHaveAttribute("data-tone", "crit");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(tile(page, "debt")).toContainText("$6,949 → $1.2M");
  await expect(tile(page, "baddebt")).toContainText("+$40K");
  await expect(tile(page, "baddebt")).toContainText("$239.60 → $41K");
  await expect(tile(page, "baddebt")).toHaveAttribute("data-tone", "warn");
  await expect(tile(page, "moved")).toContainText("941");
  await expect(tile(page, "moved")).toContainText("of 1,406 measured · 0 improved");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await expect(page.getByTestId("lab-drawer")).toBeVisible();
  // Answer before evidence: header above tiles above the heatmap above the movers.
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("lab-verdict")).toBeLessThan(await y("lab-kpi-newly"));
  expect(await y("lab-kpi-newly")).toBeLessThan(await y("lab-transitions"));
  expect(await y("lab-transitions")).toBeLessThan(await y("lab-movers"));
});

test("where accounts move: the wire's lanes merged into seven room bands with the true bounds; the unmeasured cell is dashed, never a zero", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const grid = page.getByTestId("lab-heatmap");
  await expect(grid).toHaveAttribute("data-merged", "true");
  await expect(grid.locator("[role='columnheader']")).toHaveText(["over cap", "< 4.76%", "4.76% – 9.09%", "9.09% – 20%", "≥ 20%", "no debt", "not measured"]);
  await expect(cell(page, 0, 0)).toHaveAttribute("data-count", "49");
  await expect(cell(page, 0, 0)).toHaveAttribute("data-movement", "held");
  await expect(cell(page, 1, 0)).toHaveText("14");
  await expect(cell(page, 1, 0)).toHaveAttribute("data-movement", "worse");
  await expect(cell(page, 4, 0)).toHaveText("18");
  await expect(cell(page, 4, 1)).toHaveText("135");
  await expect(cell(page, 4, 4)).toHaveText("932");
  await expect(cell(page, 6, 6)).toHaveText("6");
  await expect(cell(page, 6, 6)).toHaveAttribute("data-movement", "unmeasured");
  await expect(cell(page, 0, 4)).toHaveAttribute("data-count", "0");
  await expect(cell(page, 0, 4)).toHaveText("");
  await expect(page.getByTestId("lab-transitions-finding")).toHaveText(
    "Rows: room under cap today · columns: after the shock · cells are accounts. 425 accounts change band; 118 cross the cap; none improve. 6 not measured.",
  );
});

test("most affected accounts: the wire's movers, 20 of 118, rows open the Inspector, the verdict pill, the caption", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const rows = page.locator("[data-testid^='lab-movers-row-']");
  await expect(rows).toHaveCount(20);
  const first = DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!.movers[0]!;
  const firstRow = page.getByTestId(`lab-movers-row-${first.account}`);
  await expect(firstRow.locator("a")).toHaveAttribute("href", `/inspector/${first.account}`);
  await expect(firstRow).toContainText("Yes");
  await expect(page.getByTestId("lab-movers-caption")).toHaveText("showing 20 of 118 accounts moved");
});

test("a second click while a run is in flight is ignored: one POST, the button disabled, the running state", async ({ page }) => {
  const counts = await mockLab(page, { runBookDelayMs: 600 });
  await page.goto("/lab");
  const run = page.getByTestId("lab-run");
  await run.click();
  await expect(surface(page)).toHaveAttribute("data-state", "running");
  await expect(headline(page)).toHaveText("Running ETH -30 percent…");
  await expect(run).toBeDisabled();
  await expect(tile(page, "newly")).toHaveAttribute("aria-busy", "true");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(counts.runs()).toBe(1);
});

test("deep links: ?scenario= runs exactly one; an unlisted id runs nothing; both params together run nothing and say so", async ({ page }) => {
  const one = await mockLab(page);
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(one.runs()).toBe(1);
  await page.goto("/lab?scenario=ghost");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(one.runs()).toBe(1);
  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");
  await expect(page.getByTestId("lab-deeplink-notice")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(one.runs()).toBe(1);
  expect(one.sets()).toBe(0);
});

test("the selection is per scenario and a result stays with its scenario", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await page.getByTestId("lab-library-row-ethfi_minus_50").getByRole("button").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(headline(page)).toContainText("ETHFI -50 percent");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await page.getByTestId("lab-library-row-eth_minus_30").getByRole("button").click();
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(headline(page)).toContainText("$1.2M more Cash debt");
});

test("withheld: the Cash book excluded is a named refusal — no grid, dashed tiles, the legacy result still folded below", async ({ page }) => {
  await mockLab(page, {
    runBook: {
      ...DEMO_RUN_BOOK_ETH,
      engines: DEMO_RUN_BOOK_ETH.engines.filter((e) => e.engine !== "debt_manager"),
      excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven for this batch", note: "" }],
    },
  });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "withheld");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld under ETH -30 percent.");
  await expect(tile(page, "newly")).toContainText("withheld");
  await expect(tile(page, "newly")).toHaveAttribute("data-tone", "refused");
  await expect(chip(page, "Engines")).toContainText("Cash withheld");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-legacy")).toBeVisible();
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Withheld");
  await expect(page.locator("main")).not.toContainText("$0 ");
});

test("the fetch failures each name themselves: 404 not served, 503 no batch with the server's retry, 429, 500", async ({ page }) => {
  await mockLab(page, { runBook: fixture("error-not-found.json"), runBookStatus: 404 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-served");
  await expect(headline(page)).toHaveText("Book-wide stress is not served by this deployment.");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Not served");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: fixture("error-unavailable.json"), runBookStatus: 503, runBookHeaders: { "retry-after": "30" } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "no-batch");
  await expect(dek(page)).toContainText("(503). Retry after 30s.");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: fixture("error-rate-limited.json"), runBookStatus: 429 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "rate-limited");
  await expect(headline(page)).toHaveText("Rate limited (429).");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: { error: { code: "internal", message: "internal" } }, runBookStatus: 500 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "failed");
  await expect(headline(page)).toHaveText("The service answered 500.");
});

test("a superseded batch keeps the result under a banner; a drifted listing marks the result for a previous input; a new version is its own state", async ({ page }) => {
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, batch: { ...DEMO_RUN_BOOK_ETH.batch, supersession: { ...DEMO_RUN_BOOK_ETH.batch.supersession, superseded: true } } } });
  await page.goto("/lab");
  await runIt(page);
  await expect(surface(page)).toHaveAttribute("data-banner", "superseded");
  await expect(page.getByTestId("lab-banner")).toContainText("Batch 18,251 has been superseded");
  await expect(chip(page, "Result for batch")).toContainText("18,251 · superseded");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(page.getByTestId("lab-banner-rerun")).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const drifted = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, path_assumption: "a different path" } : s)) };
  await mockLab(page, { scenarios: drifted });
  await page.goto("/lab");
  await runIt(page);
  await expect(surface(page)).toHaveAttribute("data-banner", "stale-input");
  await expect(page.getByTestId("lab-banner")).toContainText("path assumption");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const rev = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, version: "v2" } : s)) };
  await mockLab(page, { scenarios: rev });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "definition-changed");
  await expect(headline(page)).toHaveText("ETH -30 percent changed since this result was computed.");
  await expect(tile(page, "newly")).toContainText("—");
});

test("a matrix that contradicts itself is not drawn, and the page says why", async ({ page }) => {
  await mockLab(page, { runBook: withCash((e) => ({ ...e, hf_transitions: { ...e.hf_transitions, total_rows: 5 } })) });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(headline(page)).toHaveText("The result for ETH -30 percent contradicts itself.");
  await expect(dek(page)).toContainText("total_rows");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Contradictory");
});

test("never summed: the legacy result carries its own decimals in its own fold, beside the Cash tiles it never joins", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const legacy = page.getByTestId("lab-legacy");
  await expect(legacy).toBeVisible();
  await legacy.locator("summary").click();
  await expect(page.getByTestId("lab-legacy-kpi-newly")).toContainText("14");
  await expect(page.getByTestId("lab-legacy-kpi-debt")).toContainText("+$6,000");
  await expect(page.getByTestId("lab-legacy-heatmap")).toHaveAttribute("data-merged", "false");
  await expect(page.getByTestId("lab-legacy-heatmap").locator("[role='columnheader']").first()).toHaveText("< 0.90");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(legacy).toContainText("never added together");
});

test("the drawer: path assumption, applied shocks, held flat, out of model, the exact wire values, the wire's notes; Escape closes it", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await page.getByTestId("lab-drawer").click();
  const body = page.getByTestId("lab-drawer-body");
  await expect(body).toContainText(DEMO_RUN_BOOK_ETH.path_assumption);
  await expect(body).toContainText("1,280,000.000000");
  await expect(body).toContainText(DEMO_RUN_BOOK_ETH.out_of_model[0]!);
  await expect(page.getByTestId("lab-drawer-transitions-note")).toHaveText(DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!.hf_transitions.note);
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});

test("one-address mode via ?address=: the Inspector's reading — before/after tiles, every scenario's row, the library's applicability words", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-mode", "address");
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(headline(page)).toHaveText("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  await expect(page.getByTestId("lab-address-kpi-debt-before")).toContainText("$4,822");
  await expect(page.getByTestId("lab-address-kpi-cap-before")).toContainText("$5,012");
  await expect(page.getByTestId("lab-address-kpi-room-before")).toContainText("$190.50");
  await expect(page.getByTestId("lab-address-kpi-status-before")).toContainText("Near cap");
  await expect(page.getByTestId("lab-address-kpi-status-after")).toContainText("Liquidatable");
  await expect(page.getByTestId("lab-address-kpi-room-after")).toContainText("over cap by $");
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Applies to this address");
  await expect(page.getByTestId("lab-library-check-eth_minus_30")).toHaveCount(0);
  await expect(page.getByTestId("lab-address-input")).toHaveValue(DEMO_NEAR_ADDR);
  expect(counts.lookups()).toBe(1);
  await page.getByTestId("lab-mode-book").click();
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
});

test("one-address mode: an invalid address is an inline refusal and never a request; a not-found address is a complete answer", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await page.getByTestId("lab-mode-address").click();
  await expect(surface(page)).toHaveAttribute("data-state", "idle");
  await page.getByTestId("lab-address-input").fill("0xnope");
  await page.getByTestId("lab-address-inspect").click();
  await expect(page.getByTestId("lab-address-refused")).toBeVisible();
  await page.waitForTimeout(300);
  expect(counts.lookups()).toBe(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { address: ADDRESS_NOT_FOUND, stress: { ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] } });
  await page.goto(`/lab?address=${NOT_FOUND_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  await expect(headline(page)).toContainText("No Cash position for");
  await expect(page.locator("main")).not.toContainText("Cannot say");
});

test("the first viewport at 1440×900 holds the library head, the verdict, the tiles and the top of the heatmap; 390 wide has no horizontal overflow", async ({ page }) => {
  await mockLab(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  for (const id of ["lab-library", "lab-verdict", "lab-kpi-moved"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  }
  expect((await page.getByTestId("lab-transitions").boundingBox())!.y).toBeLessThan(900);
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

If `AddressField` names its refusal test id differently from `lab-address-refused` (check Plan 2's `AddressField.tsx`: it derives `${testId}-refused`), the pin follows the kit. `fixture("error-unavailable.json")` etc. are the contract's error envelopes already in `tests/fixtures/`.

- [ ] **Step 2: Run the contract**

Run: from `web/`: `npm run build`, kill any stale :3111, `npx playwright test --project=e2e tests/e2e/lab.spec.ts`
Expected: 16 passed. A page defect found here is fixed in the Task 11 files and named in the report; a wrong expectation is fixed in the spec with the reason — the demo Book's figures and `lib/lab-headline.ts` are the law.

- [ ] **Step 3: The retirement mapping (R14) — every old pin has a home or a ledger line**

Apply, file by file. "→ C𝑛" is the contract test above by order; "→ unit" names the module spec; "retired" means the surface it pinned no longer exists and the law, if any, is stated.

`web/tests/e2e/lab.spec.ts` (30 old pins, replaced by the contract): COLD ARRIVAL zero requests → C1; the committed list from the listing → C1 (+ unit `lab-library`); `?scenario=` exactly one / bare arrival none → C6, C1; an unpublished deep-link id runs nothing → C6; address mode reachable but secondary → C14 (book is the default mode); honest 404 → C9; the served run-book renders → C2; 503 no-batch → C9; `found:null` cannot-be-established, never no position → unit `lab-address` (withheld arm) and C15's not-found arm; address 429 → state-matrix `lab × error:429` (Step 4); an invalid address never becomes a request → C15; SUPERSESSION named, kept, never mixed → C10; the row DECLARES its shock axes → C1 (the library prints the definition) + C13 (applied shocks in the drawer); chips from the wire's set → C1. Retired: the frontier (five tests: render, monotonicity, 503 on /v1/book, frontier reads its own batch, W-3L refusal takeaway) — the loss frontier is the Book's stress preview (Plan 1, `lib/stress-preview.ts` unit pins); the matrix's five cell states and its disclosure — the matrix is the library + workspace (states pinned in C1/C8/C9/C11); the depeg flagship `hfs_unchanged` and the boundary/PROJECTION panel — the address-level realization and horizons live in Plan 2's `address-stress` unit pins and the Inspector's stress table; exact rationals / held_flat / snap disclosures → C13 (drawer); the W-3L dek-at-head and CommittedDetail — the composition is the verdict header (C2 asserts the DOM order); r83 ×3 and r84 (book re-read arbitration) — the new page never re-reads the Book; W-3L (194) settlement line — retired.

`web/tests/e2e/runbook-bsplit.spec.ts` (26): both distributions + movers + collateral breakdown → C2 (tiles), C4 (movers); the SHIFT reading line → C2 (headline); the served book RECONCILES with itself → unit `lab-transitions` (the guards) + `demo-lab-weld`; DM movers show the flip, the rational, the debt → C4 + unit `lab-movers`; AAVE movers speak WADS → unit `lab-movers`; an engine that moved NOTHING says so → unit `lab-headline` ("No Cash account changes band") + unit `lab-library` ("No band change"); NONE of the surfaces without a served book → C1; CLICKING a mover opens the Inspector → C4. Retired: the unpriced holding / per-side collateral breakdown / colliding collateral rows (the breakdown is not on the new page); VIEW 4 dumbbells ×2 and r88 ×2 (the drifted `wad_scale` guard lives in `laneReading`, unit); VIEW 5 partition ×2, r89, r90 ×2, r92, r93 (the flip partition strip is gone; a contradicted ranking is named by `moversTable.unreadable`, unit); VIEW 7 rate pair ×2 and r95 ×2 (the bad-debt rate view is gone). Delete the file.

`web/tests/e2e/runbook-transition.spec.ts` (17): ONE matrix per engine with the crossings → C3 + C12 (legacy grid); the unmeasured cell in the refusal register → C3 (`data-movement="unmeasured"`, dashed); the wire's note VERBATIM → C13 (`lab-drawer-transitions-note`); A CONTRADICTORY MATRIX IS NOT DRAWN → C11; no matrix without a served book → C1; a WITHHELD engine has no matrix, the served one still has → C8. Retired with a ruling: "the Debt Manager's matrix is a DISCLOSURE and carries no verdict tint" — for Cash the ratio's over-cap band IS the strict rule `debt > cap` (`num < den`; `num === den` sits in the `1.00 – 1.05` lane), so the tint is the verdict, not a guess; "the method line refuses the confusion the field name invites" — the drawer names the fields; the flow ribbons (nine tests) — the flow chart is gone; its one-ended unmeasured law is `laneReading`'s `movement: "unmeasured"` (unit). Delete the file.

`web/tests/e2e/tornado.spec.ts` (20): every pin is on the tornado UI, which is gone. The set-run LAWS move: exact ids posted / one POST / in-flight refusal / superseded arm / busy settlement → Task 13's Compare pins; `?scenarios=` rides the listing with filtered ids named, both params run nothing, `*` refused by name → C6 and unit `lab-deep-link` (moved); a refused result contributes nothing / no denominator / the refused-locally guard → unit `lab-compare`. Delete the file; the ledger line names Task 13 as the home of the first group (a Plan 3b if Compare is cut).

`web/tests/e2e/chart-spec-v4.spec.ts`: the frontier and run-book-distribution pins (AC-34/35/36/37, AC-38, AC-40/42/43/45, AC-41, AC-46 ×2, AC-47/48, AC-53, AC-54 ×2, AC-50) → retired (the frontier is the Book's; the distributions are the heatmap's margins); AC-49 "always signed" → C2 (`+$1.2M`, `+$40K`); AC-51 grouping ≥ 1,000 → C2/C4 + the `human-usd`/`human-price` unit pins. Delete the tests; keep the file only if non-Lab tests remain (read it — if every test is a Lab test, delete the file).

`web/tests/e2e/w3l-slots.spec.ts` (the nine Lab tests): DOM-order laws for components that no longer exist → retired; the order law (answer → evidence → method) is C2's `boundingBox` ordering. Keep the file's non-Lab tests.

`web/tests/e2e/book-charts.spec.ts` (three Lab tests): held-flat details (address mode) → retired (the address-level shocks are the Inspector's stress table, Plan 2); the realization gloss → retired (same); run-book wire notes as counted details → C13. Keep the non-Lab tests.

`web/tests/e2e/r1-fixes.spec.ts` "(5) a NOT-FOUND stress is still a complete answer — and book mode never needed it" → C15 (not-found arm); `web/tests/e2e/r10-fixes.spec.ts` "(3) RECEDED WATERMARK, MATCHING FRONTIER" → retired (frontier). Remove the two tests and their helpers; update the header comments.

`web/tests/e2e/shell.spec.ts`: the `/lab` row's `h1` becomes the not-run headline of the first listed scenario under whatever `/v1/scenarios` body the shell spec serves (read its mock; with the contract `scenarios.json` it is `ETH -30 percent — 1 committed shock, not run yet.`; if the shell spec serves no listing, route `DEMO_SCENARIOS` for that row).

`web/tests/e2e/state-matrix.spec.ts` (four `lab` cells): `lab × ok` → `path: "/lab?address=<DEMO_NEAR_ADDR>"`, mocks the Inspector routes + the listing, verifies `lab-surface[data-state="rows"]` and `lab-address-table` rows = `DEMO_STRESS_NEAR.scenarios.length`; `lab × refused:found-null-unknowable` → `?address=<ADDRESS_UNKNOWABLE's address>` with `ADDRESS_UNKNOWABLE` for the lookup and the `stress-unknowable.json` body, verifies `data-state="withheld"`, headline contains "Cannot say", `main` not containing "No Cash position"; `lab × error:429` → the stress route answering 429 (`error-rate-limited.json`), verifies `data-state="unavailable"` and headline "The scenarios for … could not be run."; `lab × degraded:run-book-not-served-404` → book mode, click `lab-run`, verifies `data-state="not-served"`. Replace `mockLabCold`/`runStress` with a `mockLab` helper shaped like the contract's (routes by glob; the file's `API` constant stays for the other surfaces).

`web/tests/e2e/inspector.spec.ts`: the pin asserting the toolbar's secondary `href="#stress"` becomes `href="/lab?address=${DEMO_NEAR_ADDR}"`; the stress section's "Open Scenarios →" pin likewise.

Unit specs: delete the fifteen bound to deleted modules; `engine-classification.spec.ts`, `set-run-classification.spec.ts`, `tornado-lines.spec.ts` are deleted because their moved copies (`lab-classify-*`, `lab-deep-link`) are the homes — confirm the moved copies' test counts equal the originals' before deleting. `set-run-outcome.spec.ts`: keep if it imports only `lib/`.

- [ ] **Step 4: Delete the old Lab, re-run everything**

From the repo root, `git rm` the 31 old `web/app/lab/*` files, the three e2e files and the unit specs named above (by explicit path — never `git add -u web/app/lab`). Check `web/components/charts/FrontierLedger.tsx` and `WaterfallSteps.tsx` with `find_referencing_symbols` (or `grep -rn "FrontierLedger\|WaterfallSteps" web/app web/components web/lib`); delete each that only the old Lab imported and note it.

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`, free :3111, `npx playwright test`
Expected: clean; unit count ≥ the Task 10 count minus the deleted specs' tests plus the new; e2e 0 failed (the two screenshot Inspector pins and the Overview/Book pins unaffected; no Lab screenshot pin exists yet).

- [ ] **Step 5: The ledger**

Append to `.superpowers/sdd/progress-ui-overhaul.md` under `## 2026-09-16 · Plan 3 (Scenarios) — retirements`: one line per file named in Step 3 with the counts (re-expressed → where; retired → why), one line per deleted component file group, and the ruling on the Debt Manager tint.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/lab.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/w3l-slots.spec.ts web/tests/e2e/book-charts.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r10-fixes.spec.ts web/tests/e2e/inspector.spec.ts .superpowers/sdd/progress-ui-overhaul.md
# plus every deleted path by name (git rm already staged them)
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Scenarios page-test contract; the old Lab's matrix, tornado, frontier, run-book detail and their pins retired or re-expressed with ledger notes" -- web/tests/e2e/lab.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/w3l-slots.spec.ts web/tests/e2e/book-charts.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r10-fixes.spec.ts web/tests/e2e/inspector.spec.ts .superpowers/sdd/progress-ui-overhaul.md web/app/lab web/tests/e2e/tornado.spec.ts web/tests/e2e/runbook-transition.spec.ts web/tests/e2e/runbook-bsplit.spec.ts web/tests/e2e/chart-spec-v4.spec.ts web/tests/unit web/components/charts
```

The pathspec `web/app/lab` in the commit line covers the deletions there; `web/tests/unit` and `web/components/charts` cover the deleted specs and chart files — confirm with `git status --short` that nothing unrelated is staged under those paths before committing (another agent's work is never swept: if it is, restage by file).

---
### Task 13: Compare — the set run as a signed dot plot (R6; cuttable to a Plan 3b)

**Files:**
- Create: `web/app/lab/CompareCard.tsx`
- Modify: `web/app/lab/LabSurface.tsx` (the Compare button, the card), `web/tests/e2e/lab.spec.ts` (append the Compare pins)

**Interfaces:**
- Consumes: `lib/lab-view.ts` (`CompareState`, `LabView.checked`), `lib/lab-compare.ts` (`CompareRow`, `CompareView`), `lib/lab-reading.ts` (`runSet`), the kit's `DotPlot`, `ChartCard`, `StatusPill`, `lib/useMeasuredWidth.ts` (`useMeasuredWidth`), `lib/lab-headline.ts` (`LabHeadline`).
- Produces: the Compare card and its test ids (`lab-compare-card`, `lab-dotplot`, `lab-compare-row-{id}` with `data-kind`, `lab-compare-state`).

- [ ] **Step 1: `CompareCard.tsx`**

```tsx
// web/app/lab/CompareCard.tsx
"use client";

import { ChartCard, DotPlot, StatusPill, type DotPlotRow } from "@/components/kit";
import type { CompareRow, CompareView } from "@/lib/lab-compare";
import type { CompareState } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";

const KIND_WORD: Record<Exclude<CompareRow["kind"], "point">, string> = {
  withheld: "withheld",
  "not-covered": "not modelled for Cash",
  unmeasurable: "unmeasurable",
  contradictory: "contradictory",
  "no-denominator": "no denominator",
  unreadable: "unreadable",
};

function rowsOf(view: CompareView): DotPlotRow[] {
  return view.rows.map((r) => ({
    key: r.id,
    label: r.label,
    tenths: r.shareTenths,
    valueText: `${r.shareText} of the Cash book · ${r.deltaText}${r.newly === null ? "" : ` · ${groupInt(r.newly)} account${r.newly === 1 ? "" : "s"}`}`,
    note: r.kind === "point" ? null : `${KIND_WORD[r.kind]}${r.reason === null || r.reason === KIND_WORD[r.kind] ? "" : ` (${r.reason})`}`,
    tone: r.kind !== "point" ? "refused" : (r.shareTenths ?? 0n) > 0n ? "crit" : (r.shareTenths ?? 0n) < 0n ? "ok" : "warn",
  }));
}

/** Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis of the Cash book; every non-answer a dashed row with its word. */
export function CompareCard({ state }: { state: CompareState }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>({ min: 480, max: 1280, fallback: 880 });
  const finding =
    state.kind === "idle"
      ? "Tick two or more scenarios and press Compare."
      : state.kind === "running"
        ? `Evaluating ${String(state.ids.length)} scenarios…`
        : state.kind === "failed"
          ? `${state.headline.emphasis} ${state.headline.dek}`
          : `Each dot is a scenario's change in liquidatable Cash debt as a share of the Cash book today (batch ${groupInt(state.cash.batchId)}, ${state.cash.freshness === "still_newest" ? "still the newest" : state.cash.freshness}). Absolute figures beside.`;
  return (
    <ChartCard title="Compare scenarios" testId="lab-compare-card" finding={<span data-testid="lab-compare-state" data-kind={state.kind}>{finding}</span>}>
      <div ref={ref} className={styles.plotFrame}>
        {state.kind === "ok" ? (
          <>
            {state.cash.freshness !== "still_newest" && (
              <p className={styles.notice} data-testid="lab-compare-superseded">
                <StatusPill tone="warn">superseded</StatusPill> evaluated on batch {groupInt(state.cash.batchId)}; the newest servable batch is {state.cash.newestServable === null ? "not stated" : groupInt(state.cash.newestServable)}.
              </p>
            )}
            <DotPlot rows={rowsOf(state.cash)} width={width} axisLabel="change in liquidatable Cash debt, percent of the Cash book" testId="lab-dotplot" rowTestIdPrefix="lab-compare-row" />
            {state.legacy.rows.some((r) => r.kind === "point") && (
              <details className={styles.legacy} data-testid="lab-compare-legacy">
                <summary>Legacy · Aave v3 market, on its own book</summary>
                <DotPlot rows={rowsOf(state.legacy)} width={width} axisLabel="change in liquidatable legacy debt, percent of the legacy book" testId="lab-dotplot-legacy" rowTestIdPrefix="lab-compare-legacy-row" />
              </details>
            )}
          </>
        ) : (
          <p className={styles.dim}>{state.kind === "running" ? "Running…" : "No plot: nothing here is a share."}</p>
        )}
      </div>
    </ChartCard>
  );
}
```

Add to `lab.module.css`: `.plotFrame { width: 100%; min-width: 0; overflow-x: auto; }`.

- [ ] **Step 2: Wire the button and the card in `LabSurface.tsx`**

Replace `compare={null}` with:

```tsx
        compare={
          mode === "book"
            ? {
                label: view.checked.length >= 2 ? `Compare ${String(view.checked.length)} scenarios` : "Compare…",
                disabled: view.checked.length < 2 || view.compare.kind === "running",
                onCompare: () => reading.runSet(view.checked),
              }
            : null
        }
```

and render `<CompareCard state={view.compare} />` after the movers table (before the legacy fold) whenever `view.compare.kind !== "idle" || view.checked.length >= 2`.

- [ ] **Step 3: The Compare pins (append to `web/tests/e2e/lab.spec.ts`)**

```ts
test("compare: two ticks enable the button, one POST posts exactly those ids, the dots rank by share and every non-answer is a dashed row", async ({ page }) => {
  const counts = await mockLab(page);
  let posted: unknown = null;
  await page.route("**/v1/scenarios/run-book-set", (route) => {
    posted = route.request().postDataJSON();
    return json(route, DEMO_RUN_BOOK_SET);
  });
  await page.goto("/lab");
  const button = page.getByTestId("lab-compare");
  await expect(button).toBeDisabled();
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await expect(button).toBeDisabled();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await expect(button).toHaveText("Compare 2 scenarios");
  await button.click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  expect(posted).toMatchObject({ scenario_ids: ["eth_minus_30", "ethfi_minus_50"] });
  const ids = await page.locator("[data-testid^='lab-compare-row-']").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(ids).toEqual(["lab-compare-row-eth_minus_30", "lab-compare-row-ethfi_minus_50", "lab-compare-row-weeth_market_depeg_oracles_held", "lab-compare-row-dm_rate_horizon_plus_200bps"]);
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toHaveAttribute("data-kind", "point");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% of the Cash book · +$1.2M · 118 accounts");
  await expect(page.getByTestId("lab-compare-row-ethfi_minus_50")).toContainText("+<0.1% of the Cash book · +$9,800");
  expect(counts.sets()).toBe(0); // the test's own route answered; the helper's counter never saw it
});

test("compare: a withheld scenario is a dashed row with its word — never a dot at zero", async ({ page }) => {
  const withheld = {
    ...DEMO_RUN_BOOK_SET,
    results: DEMO_RUN_BOOK_SET.results.map((r) => (r.scenario_id === "ethfi_minus_50" ? { ...r, covered_engines: [], withheld_engines: ["debt_manager"], engines: [] } : r)),
  };
  await mockLab(page, { set: withheld });
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  const row = page.getByTestId("lab-compare-row-ethfi_minus_50");
  await expect(row).toHaveAttribute("data-kind", "refused");
  await expect(row).toContainText("withheld");
  await expect(row.locator("circle")).toHaveCount(0);
});

test("compare: a busy evaluator fails the set by name; a second Compare during a set is ignored; a superseded evaluation is labeled", async ({ page }) => {
  const counts = await mockLab(page, { set: { error: { code: "set_run_busy", message: "another evaluation holds the slot", max_in_flight: 1, in_flight: 1 } }, setStatus: 503 });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await page.getByTestId("lab-compare").click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "failed");
  await expect(page.getByTestId("lab-compare-state")).toContainText("The evaluator is busy.");
  expect(counts.sets()).toBe(1);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const slow = await mockLab(page, { set: DEMO_RUN_BOOK_SET });
  await page.route("**/v1/scenarios/run-book-set", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    return json(route, { ...DEMO_RUN_BOOK_SET, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, freshness: "superseded", newest_servable_batch_id: 18252 } });
  });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  const button = page.getByTestId("lab-compare");
  await button.click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "running");
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  await expect(page.getByTestId("lab-compare-superseded")).toContainText("the newest servable batch is 18,252");
  expect(slow.sets()).toBe(0);
});
```

The request body field name (`scenario_ids`) is whatever `lib/runbookSet.ts` sends — read `runBookSet`'s body construction and pin that name.

- [ ] **Step 4: Gates and the contract**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`; free :3111; `npx playwright test --project=e2e tests/e2e/lab.spec.ts`
Expected: clean; 19 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/lab/CompareCard.tsx web/app/lab/LabSurface.tsx web/app/lab/lab.module.css web/tests/e2e/lab.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): compare scenarios - the set run as signed shares of the Cash book on one dot plot, every non-answer a dashed row" -- web/app/lab/CompareCard.tsx web/app/lab/LabSurface.tsx web/app/lab/lab.module.css web/tests/e2e/lab.spec.ts
```

If the plan is running long when this task comes up, the integrator may cut it to a Plan 3b: the ledger records the cut, `compare={null}` stays, and the tornado-law pins named in Task 12's mapping are owed to 3b.

---
### Task 14: Screenshot pins, the gate script, and the owner's side-by-side gate

**Integrator runs this personally** (spec §9.3–9.4).

**Files:**
- Modify: `web/tests/e2e/screenshots.spec.ts` (+ two new baselines under `screenshots.spec.ts-snapshots/`)
- Modify: `web/scripts/screenshot-pages.mjs` (landed in Task 11; verify the `lab` entry and routes are there)

- [ ] **Step 1: The pin spec gains the Scenarios page**

In `web/tests/e2e/screenshots.spec.ts`: import `DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET, DEMO_SCENARIOS` from `../fixtures/demo`; extend `mockDemo` (before the `**/v1/address/*` routes):

```ts
  await page.route("**/v1/scenarios/run-book-set", (route) => json(route, DEMO_RUN_BOOK_SET));
  await page.route("**/v1/scenarios/*/run-book", (route) => json(route, DEMO_RUN_BOOK_ETH));
  await page.route("**/v1/scenarios", (route) => json(route, DEMO_SCENARIOS));
```

and add to `PAGES`:

```ts
  {
    name: "lab",
    path: "/lab?scenario=eth_minus_30",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("lab-surface")).toHaveAttribute("data-state", "result");
      await expect(tab.getByTestId("lab-heatmap")).toBeVisible();
      await expect(tab.locator("[data-testid^='lab-movers-row-']")).toHaveCount(20);
      await expect(tab.getByTestId("lab-kpi-moved")).not.toHaveAttribute("aria-busy", "true");
    },
  },
```

The mask gains the live "Computed … ago" chip: `mask: [tab.getByTestId("live-pill"), tab.locator("[data-chip='Snapshot']"), tab.locator("[data-chip='Computed']")]` — the age ticks; everything else derives from fixture stamps.

- [ ] **Step 2: Baselines**

Run: `cd web && npm run build`, kill any stale :3111, then `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts -g lab --update-snapshots all`, then `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts`
Expected: `lab-dark.png` and `lab-light.png` written; 8 passed on the second run (Overview, Book and Inspector baselines unchanged — the kit CSS additions are new classes only). `--update-snapshots all` because the default `changed` mode skips a rewrite under the pixel ratio.

- [ ] **Step 3: The owner's side-by-side gate (spec §9.3) — BEFORE the commit**

With a production server on :3111 (start it from `web/` as its own background command; wait with `curl --retry`), run `node scripts/screenshot-pages.mjs <scratch>/gate4 lab` for the dark/light fold and full captures, and a one-off states script in the scratchpad (the Plan 2 `gate3-states.mjs` shape: `createRequire` on `web/package.json`, the demo routes, one page per state) for the not-run fold (`/lab`), the withheld fold (the run-book with the Cash engine excluded), the superseded fold, and the one-address fold (`/lab?address=<DEMO_NEAR_ADDR>`), plus a crop of the mockup's Scenarios block (`pages-console.html`, the element after `<h3>Scenarios`, rendered at 1240 wide). Copy the PNGs into the visual companion's CURRENT content directory (read `state/server-info` of the live instance for `screen_dir`; restart the companion with the same `--project-dir` if `server-stopped` exists — same port and key, a new session dir) as `gate4-*.png`, write a NEW screen file `gate-scenarios.html` (the mockup on top, the dark full page, the dark/light folds side by side, the four state folds, then options A "Approve the Scenarios page — commit the pins" / B "Changes first"), and tell the owner in the terminal. Read the choice from `state/events`. A named diff is fixed in the Task 11/13 files, baselines regenerated (`--update-snapshots all`), and the gate repeated. Nothing in this task is committed until the owner says yes.

- [ ] **Step 4: Commit (on approval only)**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/screenshots.spec.ts web/tests/e2e/screenshots.spec.ts-snapshots/lab-dark.png web/tests/e2e/screenshots.spec.ts-snapshots/lab-light.png
python roadmap/tools/scope_gate.py
git commit -m "test(web): screenshot pins for the Scenarios page at 1440x900 in both themes, owner-approved side by side with the mockup" -- web/tests/e2e/screenshots.spec.ts web/tests/e2e/screenshots.spec.ts-snapshots/lab-dark.png web/tests/e2e/screenshots.spec.ts-snapshots/lab-light.png
```

---

### Task 15: Final verification, widths, the whole-branch review, the Codex rounds, the close

**Integrator runs this personally.**

- [ ] **Step 1: The gates**

From `web/`: `npm run typecheck && npm run lint && npm run lint:css && npm run build`; kill any stale :3111; `npx playwright test`.
Expected: all clean; 0 failed; the unit count and the e2e count recorded in the ledger against Plan 2's close (1,136 / 308).

- [ ] **Step 2: Widths and themes**

With a production server on :3111, run the widths probe (the Plan 2 scratchpad's `widths.mjs` shape, with `["lab", "/lab?scenario=eth_minus_30"]` added to its pages and the three Scenarios routes to its mocks) at 390, 1366, 1440, 1920 and 2560: no horizontal scroll anywhere; the shell's max-width steps unchanged (1280 / 1280 / 1280 / 1520 / 1680); at 390 the library stacks above the workspace. Record the table in the ledger.

- [ ] **Step 3: Contrast**

The page adds tinted grounds: `.heatWorse/.heatBetter/.heatHeld` are `color-mix` tints of `--crit`/`--ok`/`--ink-3` at ≤ 55 % over the panel, with the count in `--ink` on top; `.libRefused` and `.notice` use `--ink-2`/`--warn-text` on `--panel`. Compute the worst pair in each theme from `web/app/tokens.css` (ink on the strongest crit tint over the dark and the light panel) and record the ratios; every text/ground pair the page prints must be ≥ 4.5:1 or the tint's ceiling comes down (a `--heat`-independent change in `kit.module.css`). `--ink-3` appears only on captions and band labels over the plain panel, never on a tinted cell (the law from Plan 1's tokens).

- [ ] **Step 4: Whole-branch review and the Codex rounds (spec §9.5)**

Build the review package for `9aa5f17..HEAD` with the fixture JSON bodies excluded (the generator is judged instead) and the whole-branch reviewer's brief from Plan 2's Task 14 (the honest-UI laws, the rulings R1–R16, the deferred list in the ledger). Fix Criticals and Importants in one round; scoped re-reviews until closed; residuals adjudicated in the ledger. Then the slim diff for Codex:

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
mkdir -p .superpowers/sdd/2026-09-15-ui-scenarios
git diff 9aa5f17..HEAD -- web/lib web/app/lab web/components/kit web/components/charts web/tests/unit ':!web/tests/fixtures/**/*.json' > .superpowers/sdd/2026-09-15-ui-scenarios/final-review-slim.diff
```

Dispatch `codex-reviewer` on that file scoped to correctness and honesty regressions (runs are actions; one POST per ask; the wire's lanes merged by summation only; refusals never zero; engines never summed; result identity and the banners), together with the two owed rounds (Plan 1's on `.superpowers/sdd/2026-09-15-ui-kit-overview-book/`'s slim diff and Plan 2's on `git diff d989286..9aa5f17 -- web/lib web/app/inspector web/components/kit web/tests/unit ':!web/tests/fixtures/**/*.json'`). If the Codex CLI still rejects the config (`gpt-6-astra` on 0.144.5), record BLOCKED-owner for all three with the exact error and do not mutate the CLI or its config — the owner's call.

- [ ] **Step 5: Close the ledger**

Append the close entry to `.superpowers/sdd/progress-ui-overhaul.md` (commit range, suite counts, gates, widths, contrast, the owner's approval timestamp, review outcomes, the Codex status, carry-forwards: Plan 4 converges History / Activity / Verification / API onto the kit and takes the Plan 2 and Plan 3 deferred minors; a Plan 3b if Compare was cut), then commit the workspace and the `.gitignore` re-include:

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add .superpowers/sdd/.gitignore .superpowers/sdd/progress-ui-overhaul.md .superpowers/sdd/2026-09-15-ui-scenarios
python roadmap/tools/scope_gate.py
git commit -m "docs(sdd): plan 3 (scenarios) closes - the ledger, briefs, reports and reviews committed beside plans 1 and 2; the retirement ledger and close entry appended" -- .superpowers/sdd/.gitignore .superpowers/sdd/progress-ui-overhaul.md .superpowers/sdd/2026-09-15-ui-scenarios
```

---

## Self-review (writing-plans checklist)

**Spec coverage (§5.4):** layout 300 px library + workspace — Task 1 (`ScenarioLibrary`, `.lib*`), Task 11 (`lab.module.css` `.page`); library header with the mode toggle, rows with name / description / last outcome, checkboxes, footer Run / Compare — Tasks 1, 4, 11, 13; workspace kicker with PROJECTION, headline per §3.5, dek (bad debt, accounts moved, near-cap overlap), identity chips (batch · scenario id/version · computed · engines · config) — Tasks 3, 9, 11; four tiles — Tasks 9, 11 (`LabTiles`); the transition heatmap — Tasks 1, 2, 11; most affected accounts → Inspector — Tasks 5, 11; Compare view — Tasks 1 (`DotPlot`), 7, 13; legacy results collapsed — Tasks 9, 11 (`LegacyResult`); Assumptions & out-of-model drawer — Task 11; one-address mode with the address field in the library header and the Inspector's tiles for before/after — Tasks 6, 11 (`AddressWorkspace`); the states (not run · running · result · stale input · superseded · not covered · withheld · contradictory / definition changed · API error) — Tasks 3, 9 (`BookState`, `Banner`), 11, 12 (pinned); data from `/v1/scenarios`, `POST run-book`, `POST run-book-set`, `/v1/address/{addr}/stress` — Task 8 (listing, runs, set), Task 6 (the Inspector's stress reading); `lib/resultIdentity.ts` unchanged — Task 9 builds a `ResultIdentity` and the page anchors the age with `resultReceipt`. §3.5 Scenarios templates — Task 3, pinned in unit and e2e (Task 12). §7 page-test contract, retirements with ledger lines, screenshot pins — Tasks 12, 14. §8 demo dataset generated with provenance — Task 10. §9 mockup CSS transcribed (Task 1), the side-by-side gate before the pins (Task 14), one Codex round (Task 15). §6 four widths, both themes — Tasks 12 (390 / 1440 pins), 15 (probe).

**Placeholder scan:** no TBD / TODO / "implement later"; every code step carries its code; the two "read the fixture and freeze the literal" notes (Task 6's after-cap figures, Task 10's census counts and `checkClocks` shape) name the exact file and the exact pin to freeze, as Plan 2 did; the three "if the type/fixture differs" notes name the file and what to read.

**Type consistency:** `LabHeadline { emphasis, rest, tone, dek }` (Task 3) is what `lab-address` (Task 6), `lab-view` (Task 9) and `VerdictHeader` (Task 11) consume; `HeatmapView` fields (`merged, bands, cells, maxRows, totalRows, measuredRows, unmeasuredRows, heldRows, laneChangedRows, bandChanged, crossedCap, improved, nearToday, nearCrossed, nearLabel, decimals`) are read by `lab-headline` (Task 3), `lab-view` (Task 9) and `TransitionCard` (Task 11) by those names; `RunRecord` / `SetRecord` live in `lab-library` (Task 4) and are consumed by `lab-reading` (Task 8) and `lab-view` (Task 9); `LibraryRow` (lib) is structurally a `LibraryItem` (kit) plus `version` and `coversCash`, so `view.library` passes to `ScenarioLibrary.items` unchanged; `EngineReading` kinds (`result | withheld | not-covered | contradictory | unreadable`) are the ones `LabTiles`, `TransitionCard` and `LegacyResult` switch on; `CompareState` kinds (`idle | running | ok | failed`) are the ones `CompareCard` renders; `AddressWorkspace.state` values are the surface's `data-state` in address mode; the test-id table matches every `data-testid` the Task 11 and 13 components emit; the demo figures in Tasks 3, 9, 10 and 12 are the same numbers (118 · 49 → 167 · +1,280,000,000,000 · +40,780,396,039 · 941 · 425 · 27) derived from the same table (`DEMO_CASH_TABLE` in the unit helper equals `CASH_TABLE` in the generator).
