# Task 11 review — the Inspector page (landing, surface, sections, drawer)

Package: `review-f013695..de9e606.diff` (one commit, `de9e606`). Reviewed: `web/app/inspector/**`, `web/components/kit/{VerdictHeader,TrustChecklist}.tsx`, `web/components/kit/kit.module.css`, `web/scripts/screenshot-pages.mjs`. The `web/tests/fixtures/demo/**` and `web/tests/unit/demo-inspector-weld.spec.ts` hunks are another task's fix round and were not reviewed here.

Checks run for this review (read-only, from `web/`): `npm run typecheck` exit 0 · `npm run lint` exit 0 · `npm run lint:css` exit 0.

**SPEC: ✅** — every route, section, data source and test-id in the brief is present with the stated semantics. One row (History → legacy series) is built exactly as the brief's snippet reads it, and that reading is wrong on the live API; it is carried as the Critical under Quality because the brief's own code has the same defect.

**QUALITY: needs-fixes** — 1 Critical, 4 Important, 10 Minor.

---

## A. Spec compliance

### Step 1 — routes ✅
- `web/app/inspector/[addr]/page.tsx:23` — `<InspectorSurface key={addr} addr={addr} />`. First lock of the keying law.
- `web/app/inspector/page.tsx:7-9` — renders `InspectorLanding`; `metadata.title = "Inspector"`.

### Step 2 — landing ✅
- `InspectorLanding.tsx:16-47` — `inspector-landing` root, kicker "Inspector" (`kit.kick`), H1 "Is this address at risk?", dek, `AddressField testId="inspector-address"` with `rememberLookup` + `router.push`, recents list `inspector-recent` only when non-empty, each a `kit.addr` link with the full address in `title`.
- SSR safety: `useRecentLookups` is `useSyncExternalStore(subscribe, readRaw, () => "[]")` (`web/lib/recent-lookups.ts:54-57`) — a server snapshot is supplied, so the landing prerenders with no recents and hydrates cleanly.

### Step 3 — surface ✅
- `InspectorSurface.tsx:52` — `data-testid="inspector-surface" data-state={view.state}` plus `aria-busy` while loading. The state is the view's, never the page's.
- Toolbar `:53-64` — `AddressField` with `initial={reading.valid ? addr : ""}`, `secondary` ("Stress this address →" → `#stress`) only when `view.cash !== null`.
- Header `:65-80` — `VerdictHeader` fed entirely from `view.headline` / `view.chips`; the kit's own law (`VerdictHeader.tsx:26-27`) substitutes the refusal chip for an empty list, and `deriveInspectorView` never returns an empty list anyway. Drawer button (`inspector-drawer`) only when the lookup is `found`.
- Kicker `:41-50` — the view's string is placed verbatim; only the trailing truncated address is wrapped in `.kickAddr` (mono, `text-transform: none`). Falls through to the plain string when the kicker does not end with the address (invalid state → "Inspector").
- Invalid state `:81` — nothing below the header. The field remains usable: `AddressField` is mounted with `initial=""` and its own `onInspect` → `router.push`, so a reader on `/inspector/not-an-address` can type a real one and go. ✅
- Double lock ✅ — `:90` `<ActivityTable key={addr} …>` inside a surface that is itself `key={addr}` (`[addr]/page.tsx:23`).
- Legacy only when present `:91`; Stress only with a Cash position `:92`; drawer always mounted (renders null when closed) `:93`.
- `scale` `:35-40` — the activity scale is the wire's `value_decimals` per engine, taken from `view.cashWire` / `view.legacy`; nothing hard-coded.

### Step 4 — five tiles ✅ (see Important #4, Minor #8, #12)
- `InspectorTiles.tsx:38-77` — `inspector-kpi-{debt,cap,room,collateral,status}`; `KpiTile` stamps `data-tone` (`KpiTile.tsx:27`).
- Refused register: value "—" and `tone="refused"` whenever `view.refusedTiles` (`:41-43, :49-51, :57-59, :65-67`); the status tile reads the engine's status word/tone (`:73-75`), refused when `cash === null`.
- The refused position's readable debt appears only in the debt tile's sub-line (`:42`). No `$0` for an unknown: `money(null)` → "—"; `humanUsdFull(0n)` → "$0" only for a true zero.
- Per-state sub words (`:24-32`: no position / withheld / lookup unavailable / not computed) — documented deviation, judged below.

### Step 5 — what backs this debt ✅
- `BackingTable.tsx:21-61` — legs from `view.table.legs` (symbol, amount, price with a stale/crit `StatusPill` on a non-fresh verdict, value, LTV with the hover explaining "counts toward cap ÷ value", contribution), dimmed when `counted === "not-counted"`; cap row `inspector-backing-cap` (`:49-60`) with collateral in the Value column and the cap bold in the last column, as mocked.
- `inspector-backing` on the `KitTable` (`:87`); `capAgrees === false` note (`:88-92`) — the engine's figure leads.
- Boundary `:93-102` — `inspector-boundary` with `data-kind`, all six arms of `Boundary` (`inspector-position.ts:171-178`) worded; `title` only on the two arms that carry one (`"title" in boundary` narrows correctly; the other four get `undefined`). `contradictory` → "Boundary withheld: …".
- Empty legs: the table renders the cap row alone with the wire's own collateral/cap (honest — they are wire figures); `capAgrees` is `null` for empty legs (`collateralTable` sums to null), so no "legs sum to" note fires. Cap null (a refused row): "—" in the cap row, not "$0". ✅
- Empty note per state `:62-69` (no-position / loading / cannot-compute / not computed).

### Step 6 — trust ✅ (see Minor #6, #7)
- `TrustCard.tsx:13-41` — `TrustChecklist items={trust} testId="inspector-trust"`; the kit stamps `inspector-trust-{id}` and `data-state` per item (`TrustChecklist.tsx:27`); ids are `computed|prices|sweep|provenance|reconcile` (`trust.ts:26`).
- Mini sparkline `inspector-room-spark` on the measured frame (`:23-35`), domain floor 0 and ceiling ≥ line + 2, gaps carried as nulls with `pointTitles`.
- `trust === null` with `room !== null` (an account with Cash history but no Cash position now): the checklist slot prints the note and the sparkline still renders — correct placement; the wording is Minor #6.

### Step 7 — history ✅ composition / ❌ behavior (Critical #1, Important #2, #3)
- `HistoryCard.tsx:50-88` — `inspector-history` section, `SectionHead` "History · room % across batches · gaps drawn as gaps", the Cash chart full-width when there is no legacy series (`:52` applies `kit.grid` only then), `inspector-history-legacy` card for the legacy series.
- `historyOutcome` worded (`:38-41`): `unknowable` → "The history is withheld this batch — … never “no history”"; `not-found` → "No history for this account in the covered window." A withheld history is never "no history". ✅
- Newest-gap arm (`:44-45`) — "The newest batch is {withheld|not computed|absent|unpublished}; the streak cannot be read" instead of a streak sentence. ✅
- The three defects in this card are behavioral (which engine gets a card, which axis, which label at which point) and are ranked under Quality.

### Step 7 — activity ✅ (Minor #15)
- `ActivityTable.tsx:18-77` — `useAddressActivity(addr, valid)`; `activityRows(activity.rows, scale)`; `inspector-activity`, `inspector-activity-takeaway` (only with rows), `inspector-activity-more` (only with `hasMore`, disabled while loading).
- `raw_type` on hover (`:29`), liquidation detail line (`:30`), untimed rows dimmed with the hover reason (`:24-26`), "raw units" pill only when `rawUnits` (`:37-44`), the unit chip only when not raw (`:45`), tx short hash as a link when an explorer URL exists (`:48-55`).
- Empty scale (neither position): `feedAmount` receives `engineValueDecimals: null` and prints the raw integer with the pill — honest, never a guessed scale. ✅

### Step 7 — legacy ✅ (Important #5)
- `LegacyCard.tsx:19-33` — a collapsed `<details data-testid="inspector-legacy">` with the summary "Legacy · Aave v3 market position"; HF from `displayHf`; collateral/debt through `isWireDecimal` → `humanUsdFull` in the position's own `value_decimals`; the status word/tone from `liquidation_verdict`; the stale-price note; "The two books are never added together." No Cash + legacy figure exists anywhere on the page (checked Tiles, Backing, Drawer, Legacy). ✅

### Step 7 — stress ✅ (Minor #11)
- `StressTable.tsx:86-94` — `<section id="stress" data-testid="inspector-stress">`, `inspector-stress-table`, "Open Scenarios →" to `/lab`.
- Rows `:31-74` — before/after room via `humanUsdFull(side.room, view.decimals)`; PROJECTION pill with `projectionNote` on hover; `marketRealization` printed only when `isWireScale(m.decimals)` (`:17-23`); flips: reason / "Cannot say" / "Yes" / "Within Nd" / "No".
- Empty per phase `:75-84`: loading / error / withheld (with the cause) / no-position / "No scenarios." — `result.kind === "rows"` with zero rows prints "No scenarios." ✅

### Step 8 — drawer ✅ (Important #5, Minor #10)
- `InspectorDrawer.tsx:26-104` — `inspector-drawer-body`; the Cash branch prints the formula with this account's numbers substituted (`:33-38`), the verdict line, the refusal when present, every price input with symbol/source/provenance/price/age/verdict/block (`:49-58`), the as-of blocks, provenance (batch id/computed_at/producer/served_at), the params timeline (`:69-84`), the exact wire values (`:85-97`), and the Proof/API links.
- Params for a non-Cash address: `useKeyedFetch(addr, hasCash, …)` returns `loading` forever when `hasCash` is false (`address-lookup.ts:63, :132`), and the drawer only renders the params block inside the `p !== null && cash !== null` branch (`:28-30`), so the perpetual "Loading the parameter timeline…" is unreachable for a non-Cash address. ✅ Confirmed.

### Step 9 — CSS ✅
- `inspector.module.css` — every `font-size` is a `var(--type-*)` token; no hex/rgb color; the only px values are spacing/heights. Smallest type is `--type-floor` (12px, `app/tokens.css:88`) on `.sparkLabel` and `.detail`. Mono only on `.kickAddr` (an address) and `.method code` (exact values); `kit.addr` for hashes.
- Class cross-check (new files only): 17/17 `styles.*` (`boundary capLabel detail dim frame kickAddr landing legacy legacyBody method note page recent spark sparkHead sparkLabel toolbar`) are defined in `inspector.module.css`; 12/12 `kit.*` (`addr btn btnGhost dek grid gridRail h1 kick kpis kpis4 kpis5 sub`) are defined in `kit.module.css`. No dangling class.

### Kit changes — no Book regression ✅
- `VerdictHeader.tsx:34` — `rest === "" ? null : /^\s/.test(rest) ? rest : \` ${rest}\``. The Book's `rest` values (`book-headline.ts:42-70`) are `" across N account(s)."` (leading space → passed through unchanged) and `""` (→ `null`, previously an empty text node). No doubled space, no lost space. The Inspector's `"Not liquidatable yet."` / `"Not close to liquidation."` gain the one space they need.
- `kicker: ReactNode` — the Book passes a template string (`BookSurface.tsx:60`); the Overview does not use `VerdictHeader` (callers: BookSurface, InspectorSurface only).
- `TrustChecklist.tsx:32` `.checkLabel` + `kit.module.css:149-150` — the label takes the slack, the detail wraps at ≤58% and right-aligns; the 720px `.checkSmall` override is dropped as redundant. `TrustChecklist` has a single caller (TrustCard), so nothing else moves.

### Screenshot script ✅
- `screenshot-pages.mjs` — `inspector` page at `/inspector/${demo.DEMO_NEAR_ADDR}`; five routes registered after the book ones. Playwright matches routes last-registered-first and `*` never crosses `/`, so `**/v1/address/*` (registered last) does not swallow `/history` or `/stress`, and those two match their own patterns. All six fixture exports exist (`tests/fixtures/demo/index.ts:21-29`).

### Test-id contract (brief table, plan lines 109-121) — all present
| id | where |
|---|---|
| `inspector-surface[data-state]` | `InspectorSurface.tsx:52` |
| `inspector-address` `-input` `-inspect` `-secondary` `-refused` | `AddressField.tsx:43,58,64,68,73` via `InspectorSurface.tsx:55` / `InspectorLanding.tsx:25` (`-secondary` only with a Cash position, by design) |
| `inspector-verdict` `-headline` `-dek` `-identity` (+ `data-chip`) | `VerdictHeader.tsx:30-38`, `IdentityChips.tsx:34` via `InspectorSurface.tsx:66` |
| `inspector-kpi-{debt,cap,room,collateral,status}[data-tone]` | `InspectorTiles.tsx:39,47,55,63,71`; `KpiTile.tsx:27` |
| `inspector-backing`, `inspector-backing-cap`, `inspector-boundary[data-kind]` | `BackingTable.tsx:87, :51, :94` |
| `inspector-trust`, `inspector-trust-{computed,prices,sweep,provenance,reconcile}[data-state]` | `TrustCard.tsx:17`; `TrustChecklist.tsx:25-27` |
| `inspector-room-spark` | `TrustCard.tsx:25` → `MeasuredSparkline.tsx:25` |
| `inspector-history`, `inspector-history-legacy` | `HistoryCard.tsx:50, :70` |
| `inspector-activity`, `inspector-activity-more`, `inspector-activity-takeaway` | `ActivityTable.tsx:66, :73, :68` |
| `inspector-legacy` (`<details>`) | `LegacyCard.tsx:19` |
| `inspector-stress` (`id="stress"`), `inspector-stress-table` | `StressTable.tsx:86, :92` |
| `inspector-drawer` (button), `inspector-drawer-body` | `InspectorSurface.tsx:75`; `InspectorDrawer.tsx:27` |
| `inspector-landing`, `inspector-recent` | `InspectorLanding.tsx:16, :36` |

Extra ids beyond the contract (`inspector-backing-card`, `inspector-trust-card`, `inspector-backing-{symbol}`) are harmless.

### Documented deviations — judged on behavior
1. **`MeasuredSparkline` instead of a bare `Sparkline`** — justified. `Sparkline` defaults to `width = 140` (`Sparkline.tsx:74`), and `useMeasuredWidth`'s effect returns early when `ref.current` is null with deps `[min, max]` (`useMeasuredWidth.ts:48-73`), so a frame rendered conditionally after data arrives inside an already-mounted parent would stay at the fallback forever. Mounting the frame and the hook together in one component is the right shape. ✅
2. **"10% line" label placement** — TrustCard prints it as an absolutely positioned, `aria-hidden` span in the frame exactly as the mockup does (`pages-console.html` line "10% line"), and the SVG's `label` names the dashed line for assistive tech; HistoryCard names the line in the finding. No information is lost; the newest-value label no longer collides. ✅
3. **Per-state tile sub words** — better than the brief's "not computed" everywhere (a withheld book is not "not computed"). ✅ One arm is still wrong (Minor #8).
4. **`historyOutcome` wording** — required by the refusal law; correct. ✅
5. **Typographic apostrophes** — cosmetic; consistent within the page. ✅

---

## B. Code quality

### Critical

**1. The legacy history card renders for every Cash-only account on the live API — an empty chart claiming a legacy history that does not exist.**
`HistoryCard.tsx:29-31, 69-81`. The card is gated on the legacy engine being *listed* in the history response. The handler lists every engine present in the window regardless of whether this account has a row (`cmd/api/p5_history.go:253-264`, and the builder comment above it: "Every engine present in the window's rollups gets a series, so an account with no points still discloses the window's shape per engine"). So a real Cash-only account's history carries `{ engine: "aave_v3_etherfi", points: [], withheld_batch_ids: [] }`, `legacyEngine` is non-null, `buildHistorySeries` returns an empty series, and the page renders "Legacy · Aave v3 health factor / Judged by its own health factor…" over an SVG with nothing but the 1.0 reference line, with `data-testid="inspector-history-legacy"` present and the Cash chart squeezed into the 7fr column. The old surface handled exactly this with `engineNeverPresent` (`history-series.ts:404-406`, used at the retired `InspectorHistory.tsx:188`). The demo fixture lists only `debt_manager`, which is why the gate captures look right and why Task 12's e2e pins (against the demo) will not catch it.
Failure: open any live Cash-only address → a legacy HF card with an empty chart.
Fix: `const legacySeries = legacyEngine === null || engineNeverPresent(legacyEngine) ? null : buildHistorySeries(legacyEngine, knownBatchAxis(history.value.response));` (the second argument is Important #2). Recommend Task 10's fixture round add an Aave engine with empty points to `history-demo-near.json` so Task 12 can pin the absence.

### Important

**2. The legacy series is built without the known-batch axis, so the line draws across batches with no legacy row — the caption promises the opposite.**
`HistoryCard.tsx:31` — `buildHistorySeries(legacyEngine)` with no `knownBatchIds`. `buildHistorySeries` inserts no-row gaps only for ids it is handed (`history-series.ts:226-262`); without them a batch where the account had no legacy row is simply absent from the axis and the path connects its neighbours. The section head says "gaps drawn as gaps" (`:51`) and the dim note says "A refused, withheld or missing batch is a gap; the line never draws across it" (`:85`). The Cash series is built on the full known axis (`inspector-view.ts:154-159`), so the two side-by-side charts also have different x-axes. The retired surface passed `knownBatchAxis(lookup.response)` (`InspectorHistory.tsx:174, :234`).
Fix: `buildHistorySeries(legacyEngine, knownBatchAxis(history.value.response))`.

**3. `newestLabel={room.newest?.display}` prints the newest *gap's* word beside an older plotted point.**
`HistoryCard.tsx:65`. `Sparkline` places `newestLabel` at the last *plotted* (finite) point (`Sparkline.tsx:127-135, 271-285`), and its own contract says the caller must append a "(batch N)" qualifier when that point is not the newest witnessed batch (`Sparkline.tsx:55-62`). `room.newest` is the newest *witnessed* point; when it is a gap its `display` is "withheld", "not computed", "no row", "0 cap" or "—" (`room-history.ts:68-98, :114, :118`), and that word is printed at the last computed dot as if it were that dot's value. `history-series.ts:293` has `newestPlottedLabel` for the HF series; `room-history.ts` has no equivalent, so the page has no one-source string to pass.
Failure: an account whose newest batch is withheld → the room chart shows "withheld" attached to the last computed point (e.g. the 3.8% dot).
Fix: add a pure `newestPlottedRoomLabel(series)` to `room-history.ts` (last point with `value !== null`; `display`, plus ` (batch N)` when it is not `series.newest`), pin it in `room-history.spec.ts`, and pass that. Until it exists, omit `newestLabel` rather than print the wrong word.

**4. The debt tile re-derives "last readable" from `cash.debt` and prints a negative debt the view withholds.**
`InspectorTiles.tsx:42` — `cash?.debt != null ? \`last readable ${money(cash.debt)} · …\``. `readCashPosition` keeps a negative wire debt on the refused reading (`inspector-position.ts:60-66`), and `deriveInspectorView` deliberately refuses it as a "last readable" figure for the headline (`inspector-view.ts:208-209`, `cash.debt >= 0n`). The tile bypasses that law and prints "last readable −$5 · not computed". This is also the page deriving a figure the view already computes (`lastDebt`).
Fix: expose `lastReadableDebt: string | null` on `InspectorView` (it is already computed as `lastDebt` at `inspector-view.ts:209`) and have the tile print that; the tile stops reading `cash.debt`.

**5. Wire scales reach the formatters unguarded at four page sites; a malformed `decimals` throws in render and takes the whole surface to the error boundary.**
- `LegacyCard.tsx:9` — `humanUsdFull(BigInt(v), position.value_decimals)`; `rescale` does `10n ** BigInt(shift)` (`human-price.ts:9-12`), so a fractional or NaN `value_decimals` throws `RangeError`.
- `InspectorDrawer.tsx:53` — `humanPrice(BigInt(i.value), i.decimals)` with `i.decimals` only null-checked.
- `InspectorDrawer.tsx:16, :87-94` — `formatUnits(v, p.value_decimals | l.decimals)`; `formatUnits` throws `DecimalFormatError` on a bad scale.
- `InspectorTiles.tsx:33` — `formatUnits(cash.debt.toString(), decimals, …)`; `view.decimals` is `cashWire.value_decimals ?? 6` with no `isWireScale` at `inspector-view.ts:140` / `inspector-position.ts:63`.
`StressTable.tsx:19` shows the right pattern (`isWireScale(m.decimals)` → otherwise nothing is printed). The repo's own doctrine treats this as a named defect class (`wireGuard.ts:34-54`).
Fix: guard each site with `isWireScale(d)` and print "—" otherwise; longer term, validate `decimals` once in the view (Task 9 follow-up) so the tiles/drawer inherit a licensed scale.

### Minor

**6. `TrustCard.tsx:15` — "Not computed." for every null-trust state.** `cannot-compute` is withheld, `no-position`/`legacy-only` have no Cash position to check, `unavailable` is a failed lookup. `BackingTable.tsx:62-69` and `InspectorTiles.tsx:24-32` already word these per state; use the same words.

**7. `TrustCard.tsx:20` — "History · room % over the last 1 batches".** A one-point series is real (the history batch id is always on the axis). Pluralise.

**8. `InspectorTiles.tsx:24-32` — `legacy-only` falls to "not computed".** The headline says there is no Cash position; the sub-line under each dash should say "no Cash position", not "not computed".

**9. `BackingTable.tsx:19-20` — duplicates `oldestPriceAge` and prints a different register than the chip.** The same figure is `oldestPriceAge(inputs)` at `inspector-position.ts:276`, and the Prices chip prints it through `humanAge` ("2m") while the finding prints raw seconds ("134s ago"). Use `oldestPriceAge` + `humanAge`.

**10. `InspectorDrawer.tsx:40` — "Verdict: debt ≤ cap → unknowable" on a refused row.** The `≤` is the else-arm of `cash.debt !== null && cash.cap !== null && …`, so a row with no readable cap prints a computed-looking comparison. Print the comparison only under `isComputedCash(cash)`; otherwise "Verdict: not computed" and the refusal line.

**11. `StressTable.tsx:15` — `days()` rounds a sub-12h horizon to "0d"** ("Within 0d", "0d: +$1 interest"). The demo horizons are 30d/90d, so it is not visible today. Print hours below a day.

**12. `InspectorTiles.tsx:24-25, :42-66` — while pending, `sub=""` renders an empty `.kpiS` div** (`KpiTile` renders the sub whenever it is not `undefined`). Pass `undefined` while pending.

**13. Report note on `MeasuredSparkline` and `react-hooks/refs`.** The file passes because nothing touches `ref.current` during render (the hook reads it inside `useEffect`, `useMeasuredWidth.ts:48-73`), not because of the destructuring. The code is right; the explanation in the report is not.

**14. Retired components still on disk reference ~50 classes the rewritten stylesheet no longer defines** (`AddressEntry.tsx`, `InspectorPositionCard.tsx`, `InspectorHistory.tsx`, `InspectorActivity.tsx`). Nothing live imports them (`lib/factorPriceGuard.ts` mentions one in prose; `tests/e2e/p1b-fixes.spec.ts` is an old pin the brief already expects to fail). Task 12 deletes them; noting so the intermediate state is understood.

**15. `InspectorSurface.tsx:35-40` / `ActivityTable.tsx:20` — Cash amounts flip from "raw units" to scaled once the lookup lands.** The activity fetch and the address lookup run in parallel; until the lookup lands `scale` is `{}`, so `dm_normalized_debt` rows without their own decimals print raw with the pill, then re-render scaled. Honest at each instant; if the flip is unwanted, pass the scale only once the lookup is ready (rows render loading until then anyway).

---

## Summary
The composition is the mockup's, every id in the contract exists with the stated semantics, refusals render in the refused register with no `$0`, the double keying lock is in place, nothing sums Cash with legacy, and the kit changes leave the Book unchanged. The page must not ship as-is: on the live API the History section renders a legacy chart for accounts that have no legacy history (Critical #1), and the two other History defects (#2, #3) put wrong geometry and a wrong label on the one chart the section exists for. #4 and #5 are one-line guards each.

---

## Re-review (d1032e4)

Scope: the fix round for the fifteen findings above plus the Task 9 note, as commit `d1032e4` (ten files under `web/app/inspector/[addr]/`, new `money.ts`). Checks run on the fixed tree from `web/`: `npm run typecheck` exit 0 · `npm run lint` exit 0 · `npm run lint:css` exit 0. The working tree's uncommitted deletions (`AddressEntry.tsx`, `InspectorActivity.tsx`, `InspectorHistory.tsx`, `InspectorPositionCard.tsx`, `lib/inspector-lines.ts`) are Task 12's and were ignored.

**RE-REVIEW: open** — 14 of 15 fully addressed; #3 is narrowed but not closed, and #10 has a wording inaccuracy in its new arm.

| # | Ruling | Code | Status |
|---|---|---|---|
| C1 | legacy HF chart only when `!engineNeverPresent(engine)` | `HistoryCard.tsx:31-33` — `found === null \|\| legacyEngine === null \|\| engineNeverPresent(legacyEngine) ? null : buildHistorySeries(…)` | ✅ |
| 2 | series on `knownBatchAxis(response)` | `HistoryCard.tsx:33` — `buildHistorySeries(legacyEngine, knownBatchAxis(found))`; both charts now share the response's axis | ✅ |
| 3 | `newestLabel` only when the newest point is `computed` or `zero-cap` | `HistoryCard.tsx:35` matches the ruling literally — but `zero-cap` is a GAP: `room-history.ts:94` builds it with `gap(…)` (`value: null`, `room-history.ts:54-62`), so it is never plotted, and `Sparkline` still prints `newestLabel` at the last *finite* point (`Sparkline.tsx:127-135, 271-281`). A newest zero-cap batch prints "0 cap" beside an older computed dot — the original mislabel, narrowed to one kind | ❌ narrowed |
| 4 | "last readable" only for a non-negative debt | `InspectorTiles.tsx:37` — `cash.debt >= 0n ? money(cash.debt) : null`; pending → `word` undefined → no sub | ✅ |
| 5 | `money.ts` guards every scale/decimal; used by tiles, backing, stress, drawer, legacy | `money.ts:10-36` — `moneyFor` (`isWireScale` once → "unreadable scale"), `wireMoney`/`wirePrice`/`wireExact` (`isWireDecimal` → "unreadable", then the scale guard). Grep of `humanUsdFull(`/`humanPrice(`/`formatUnits(`/`humanAmount(`/`BigInt(` under the live page files: only `money.ts:12,19,27,35` and `StressTable.tsx:22`, the latter inside `realization` behind `if (m === null \|\| !isWireScale(m.decimals)) return null;` (`StressTable.tsx:21`). No unguarded call remains | ✅ |
| 6 | Trust empty words per state | `TrustCard.tsx:8-22` — loading / no-position / legacy-only / cannot-compute / unavailable / default | ✅ |
| 7 | batch/batches | `TrustCard.tsx:33` | ✅ |
| 8 | `legacy-only` tiles say "no Cash position" | `InspectorTiles.tsx:17-30` `refusedWord` | ✅ |
| 9 | `oldestPriceAge` + `humanAge` | `BackingTable.tsx:21, :81` | ✅ |
| 10 | verdict line only under `isComputedCash`, otherwise "none served" | `InspectorDrawer.tsx:35-44` — the computed arm is right; the other arm reads "none served — the engine did **not compute** this row", which is false for a `status: "computed"` row whose verdict is `unknowable` (`isComputedCash` is false there too, `inspector-position.ts:97-99`; the view's own cause for that case is "the engine published no verdict for this account", `inspector-view.ts:101`). Wording only; no wrong figure | ⚠ wording |
| 11 | sub-day horizons in hours | `StressTable.tsx:17` — `Math.max(1, round(h))h` under a day | ✅ |
| 12 | no empty sub while pending | `InspectorTiles.tsx:36, :81` — `word` and the status sub are `undefined` while pending | ✅ |
| 13 | comment corrected | `MeasuredSparkline.tsx:23` | ✅ |
| 14 | Task 12 deletes the old files | in progress in the tree — out of scope | — |
| 15 | activity table mounts once the lookup has answered | `InspectorSurface.tsx:90-93` — `reading.lookup.phase !== "loading" && <ActivityTable key={addr} …>`; `key={addr}` kept (double lock intact); on a lookup error it still mounts with an empty scale (raw units, honest) | ✅ |
| T9 | drawer button only with a Cash position | `InspectorSurface.tsx:34, :75` — `explainable = view.cashWire !== null` | ✅ |

**Test-id contract:** unchanged. All 26 contract ids are present (`inspector-surface`, `-address` family via `AddressField`, `-verdict` family, the five `-kpi-*`, `-backing`, `-backing-cap` (`BackingTable.tsx:52`), `-boundary`, `-trust` + items, `-room-spark`, `-history`, `-history-legacy`, `-activity`, `-activity-more`, `-activity-takeaway`, `-legacy`, `-stress`, `-stress-table`, `-drawer`, `-drawer-body`, `-landing`, `-recent`). Two are now conditional where they were not: `inspector-drawer` (Cash position only, per the Task 9 ruling) and `inspector-activity` (after the lookup answers, per #15) — Task 12's pins should wait on the lookup before asserting the activity table.

**No regressions found:** removed imports are all unused (lint clean); `moneyFor`'s "unreadable scale" replaces a thrown render everywhere; the History finding sentence's own zero-cap handling (`HistoryCard.tsx:48`) is unaffected by the #3 defect, which is confined to the chart label.

### Still open
1. **#3 (Important, narrowed)** · `web/app/inspector/[addr]/HistoryCard.tsx:35` · Guard on the newest point being *plotted*, not on its kind: `room.newest.value !== null` (equivalently `kind === "computed"` alone). A zero-cap newest batch is a gap with `display: "0 cap"` and would still be printed at the last computed dot. One-token fix.
2. **#10 (Minor, wording)** · `web/app/inspector/[addr]/InspectorDrawer.tsx:41-43` · "the engine did not compute this row" is untrue for a computed row with an `unknowable` verdict. Say "the engine served no verdict for this row" (true for both arms), or branch on `cash.computed`.

---

## Re-review 2 (3410c42)

Scope: the two items left open above. `git show 3410c42` touches exactly the two files.

| # | Code | Status |
|---|---|---|
| 3 | `HistoryCard.tsx:36` — `newestLabel` only when `room.newest.value !== null`. Every gap kind, zero-cap included, is built by `gap(…)` with `value: null` (`room-history.ts:54-62, :94`), so the label is passed only for a plotted newest point and `Sparkline`'s last-finite index is then the newest index | ✅ closed |
| 10 | `InspectorDrawer.tsx:42` — "Verdict: none served — the engine served no verdict for this row (`debt > maxBorrowLT` is the rule it would apply)." True for a refused row and for a computed row with an `unknowable` verdict alike | ✅ closed |

**RE-REVIEW: closed.**
