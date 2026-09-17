# Plan 1 Codex wave — review of 52abcd9 (14a5927..52abcd9)

Reviewer: scoped, read-only. Inputs: `plan1-codex-wave-report.md`, `review-14a5927..52abcd9.diff` (one commit, 29 files). Line references below are the package's line numbers unless prefixed `HEAD`. HEAD facts were read from the repo at 52abcd9 (`git show HEAD:` for files the Lab implementer has mid-edit).

Verdict: **RE-REVIEW: closed.** All 18 fixes are addressed as ruled, minimal to the ruling, and pinned so the pin fails on 14a5927. The three already-fixed verdicts hold on HEAD. The #22 ruling is respected. The throwing `humanUsd`/`materialityTier` reach no unguarded render path. `cash-view.ts` holds nothing outside the rulings. No pixel baseline moved. Four residuals are recorded at the end; none breaks a law and none is held open.

## The already-fixed three (verify the pins exist on HEAD)

| # | Verdict | Pin on HEAD |
|---|---|---|
| 1 | holds | `tests/e2e/book.spec.ts:135` "a positions page from another batch reloads the book once instead of mixing rows"; the guard itself is unchanged in this wave (package 1182–1199: `page.batch.id !== batchId` → one reload per superseding id, second mismatch a named failure). |
| 8 | holds | `tests/e2e/book.spec.ts:101` "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"; `tests/e2e/overview.spec.ts:64` "a withheld Cash engine refuses the strip…". This wave extends withheld to the aggregate's own `refused` flag (`wholeRefusal`, package 1110–1119; contract `Aggregate.refused`: "True when this ENGINE's whole book is withheld, whatever the position counts say"). |
| 11 | holds | `HEAD app/book/NeedsAttention.tsx:84` — `[...material, ...near.slice(0, …), ...refused]`, refused rows appended after the slice; pinned by `book.spec.ts:98` (6 dim rows in the default table). |

## The 18 fixes

Each: ADDRESSED / OPEN, the trace, and why the pin fails on 14a5927.

**#2 legacy rows in the Cash walk — ADDRESSED.** `readCashPage` (cash-rows.ts, package 1457–1459 page engine; 1488–1494 every row's engine) refuses by name; the hook lands it as `invalid-response` (1228–1231). The law "a legacy row never enters the Cash walk" holds because the page is judged before any row is derived (1481–1514). Pins: `cash-rows.spec` 3009–3022; e2e `book.spec` 2486–2503 (walk failure names `aave_v3_etherfi`, one attention row, band counts sum to 0). On 14a5927 `page.positions.map(readCashRow)` (1200) landed the rows — the e2e's `book-walk-failure` never appears.

**#3 the headline claims a negative mid-walk / after a failure — ADDRESSED.** `bookHeadline` takes `computed`/`complete`/`stopped` (856–869). A positive stands at once with the walk sentence (940–948); with nothing material and `!complete` the variant is `pending` (walking, 955–963) or `refused` with the cause (stopped, 964–976); `nearCapSentence(…, complete)` returns null for a zero count mid-walk (896–897). `summarizeCash` computes `stopped = walkComplete ? null : walkStopped` (1587) and `computed` (1586). Tiles: a walk-derived zero is a dash until settled (323–329, 357–363), a stopped walk wears refused tone with "lower bound, walk stopped" (264, 338–346, 365–373), the median is withheld on a stopped walk (380–395), the kicker says "walk stopped" (282). Overview: `bookEntryLine` says "Walking the book…"/"Walk stopped before the book was read" (1860–1867). Never manufactures a positive: the material branch is entered only on `material.count > 0` (940), unchanged. Pins: `book-headline.spec` 2780–2828; `cash-summary.spec` 3132–3150; `cash-view.spec` 3264–3294; e2e `book.spec` 2432–2446 (pending), 2390–2398 (transport stop), 2472–2484 (census stop, positive stands as `crit`, no near-cap negative); `overview.spec` 2618–2630. On 14a5927 rows `[]` + `walkComplete:false` returned `quiet` ("Nothing material…", 994) — every one of these fails.

**#4 `page.refused` never read — ADDRESSED.** `readCashPage` returns `kind:"refused"` with code/detail (1449–1456); the hook folds it into `walk.refused` (1218–1227) and the reading's `cash.refusedWhole` (1320), so the view takes the withheld path already pinned for #8 (summary null, refused tiles, refused preview). Pins: `cash-rows.spec` 2993–3007; e2e `book.spec` 2448–2470. On 14a5927 `positions:[]`, `next_cursor:null` completed a healthy empty book.

**#5 completeness = `next_cursor === null` only — ADDRESSED.** `total_positions` must pass `isWirePopulation` on a non-refused page (1460–1466), equal the book aggregate's `positions` when the book states one (1467–1472), and not change mid-walk (1232–1240); the terminal page completes only when `delivered === total`, an intermediate page refuses on over-delivery (1241–1252). Rows a short page delivered stay as a lower bound beside the named failure (`land(cursor, reading.rows, false, invalid(...))`, 1244–1251). **Cursor race (concern 5):** the batch-id check (1182) precedes `readCashPage`, and a stale cursor 409s into `BatchSupersededError` (1258) before any census logic — the census check only ever runs on a same-batch page. **Same-batch agreement:** `cmd/api/p5_positions.go:456` `total := agg.Positions` (min_value absent, which the walk never sends) and `cmd/api/handlers.go:336` `Positions: a.Positions` serialize the same persisted aggregate, so the two counts are identical by construction on one batch; the contract says so too (`PositionsResponse.total_positions`: "the unfiltered engine total remains `aggregate.positions` on `/v1/book`"). A valid book cannot be refused by this check. Honest shapes: a census of 0 with `positions:[]`, `next_cursor:null` reads `rows`/`last`/`total 0`, `delivered 0 === 0` → complete (isWirePopulation admits 0). Pins: `cash-rows.spec` 3024–3035; e2e `book.spec` 2472–2484. On 14a5927 line 1201 completed regardless.

**#6 `row.health_factor.num` on an omitted field, thrown inside `.then` — ADDRESSED.** Shape checks before derivation (1481–1512: row object, `account`, `engine`, `status`, `value_decimals`, `health_factor` null-or-object); `readCashRow` reads `hf ?? null` (1371–1373); the hook wraps decoding in try/catch → `invalid-response` (1207–1217). Pins: `cash-rows.spec` 3037–3047, 3063–3076. On 14a5927 the dereference threw with no failure landed.

**#7 "No position is liquidatable" beside refused accounts — ADDRESSED.** Complete walk, `computed === 0 && notComputed > 0` → refused variant "No Cash account could be computed this batch." (978–986); otherwise the negative reads "No computed position is liquidatable." when `notComputed > 0` (987–995). Pins: `book-headline.spec` 2762–2778. On 14a5927 `below ?? "No position is liquidatable."` (994) regardless.

**#9 residual: "nothing refused" under a 503 / absent engine — ADDRESSED.** `notComputedSub` (265–275): unknown count → "not computed"/"loading…"; a key → its plain cause; count 0 → "nothing refused"; nonzero with no key → "cause not stated". Pins: e2e `book.spec` 2366–2368 (503). On 14a5927 line 424 printed "nothing refused" whenever no key.

**#10 legacy engine refused rendered as zeros and bars — ADDRESSED.** `deriveLegacyView` (1929–1990): withheld → cause in the summary line, populations null, debt/eligible debt ABSENT, bands null; a refused histogram alone → `histogramWithheld`, bands null. `BookLegacy` renders the view: "—" populations, "not computed" subs, no `BandBars` (75–150). Pins: `cash-view.spec` 3357–3397; e2e `book.spec` 2527–2539. On 14a5927 `book-engine-refused.json` rendered "0 positions … 0 liquidatable · 0 refused" and eight zero bars.

**#12 one $50 liquidatable row, toggle off → "No account needs attention." — ADDRESSED.** `attentionEmptyText` (1625–1633) names the hidden count and Σ; a stopped walk says "no account is cleared"; an unfinished walk "Walking the book…". Pins: `cash-summary.spec` 3152–3165; e2e `book.spec` 2505–2525. On 14a5927 line 538 cleared the book on `settled`.

**#13 unknowable verdict on a computed row read as "Near cap" — ADDRESSED.** `computed` requires `liquidation_verdict !== "unknowable"` (1377–1384); `notComputedCause` names the withheld verdict on the pill (1407–1411, 516). Pin: `cash-rows.spec` 2923–2938 (the 5%-room, $95 shape: no band, not near cap, not liquidatable, percentiles null). On 14a5927 the row was computed.

**#14 bare `BigInt(v)` on engine totals, bad debt, legacy debt — ADDRESSED.** `readWireMoney` through `wireBigInt` is the only path (1687–1692); consumers: BookSurface debt/collateral/bad debt (307–317, 402–418), Overview strip (677–682), legacy debt and eligible debt (1955–1964). Malformed → "—", refused tone, `<field> is not a wire decimal` (1698, 312–315). No bare `BigInt(` remains on the wave's surfaces except after an `isWireDecimal`/`readWirePopulation` guard (`cash-rows.ts:33` `wireInt`, `stress-preview.ts` after the per-point checks, `BandBars` on a guarded count). Pins: `cash-view.spec` 3315–3326; e2e `book.spec` 2541–2549; `overview.spec` 2652–2664. On 14a5927 `""` → $0.

**#15 scales unvalidated, sums across scales — ADDRESSED.** `readWireScale` on `engines[debt_manager].value_decimals` (1771), `bad_debt[*].usd_decimals` (1849, 1962), legacy `value_decimals` (1932); `readCashPage` requires every row at a wire scale equal to the book's (1499–1508); `stressPreview` validates `usd_decimals` and refuses a point at another scale (2281–2289); `humanUsd` and `lineInBaseUnits` throw `WireIntegerError` by name (2027–2031, 2104–2108). Pins: `cash-rows.spec` 3049–3061; `cash-view.spec` 3328–3335; `stress-preview.spec` 3582–3589; `human-usd.spec` 3413–3418; `materiality.spec` 3478–3482. On 14a5927 `humanUsd(x, -0)` multiplied (no throw) and `materialityTier(1n, -6)` threw a nameless RangeError (pin matches `/got -6/`).

**#16 `null − 1 = -1 accounts` — ADDRESSED.** `cumulative_eligible_accounts` through `isWirePopulation` on every point (2290–2292); a falling cumulative refuses (2311–2315). Pin: `stress-preview.spec` 3569–3580. On 14a5927 no guard.

**#17 `BigInt(band.count)` on -0 / 1.5 — ADDRESSED.** `BandBars.countOf` → `readWirePopulation` before weight or print (761–768, 782, 788, 798, 803); legacy bucket counts also read in the view (1971–1975). Pins: e2e `book.spec` 2551–2564 (route refusal names `buckets[0].count`); `cash-view.spec` 3385–3390. On 14a5927 `BigInt(1.5)` threw a RangeError whose message lacks the field.

**#18 engine on the base point only → zero lines under "Every figure below is a projection" — ADDRESSED.** Missing from any point → refused "the engine is missing from grid point N" (2268–2273); fewer than two points → "the grid has no shocked point" (2276). Pin: `stress-preview.spec` 3544–3556. On 14a5927 the filter (2265–2267) shortened the list.

**#19 `coverage.excluded*` never read — ADDRESSED.** `stressPreview(waterfall, engine, coverage)` carries `unmeasured` (2246–2258, 2317–2318); the card prints `unmeasuredSentence` (563, 589–593); the drawer's coverage line adds the count and lists each exclusion with cause and code (170–183); `API_RECONSTRUCTION_MISMATCH` (the contract's only `Excluded.code`) phrased (2169). Pins: `stress-preview.spec` 3591–3628; e2e `book.spec` 2566–2591. On 14a5927 nothing read the field.

**#20 any non-view preview → "Committed scenarios" — ADDRESSED.** `previewLine` in the view (1868–1875): withheld engine, refused grid, absent engine each named; the preview is refused for a withheld engine in the view itself (1832–1837) so the Book's `StressPreview` and the Overview read one value (448, 722). Pins: `cash-view.spec` 3296–3313; e2e `overview.spec` 2632–2650. On 14a5927 lines 645–648.

**#21 unresolved age → the clause vanished — ADDRESSED.** `LivePillInput.ageUnresolved` (2056–2057); `livePillWords` says "age unknown", dim (2080–2081); the pill passes `age.unresolved` straight through (835) and renders `words.age` when non-null (`HEAD components/kit/LivePill.tsx:53`). `live-age.ts:405` sets `unresolved` on a blind resume for the same receipt. Pin: `live-pill.spec` 3454–3462. On 14a5927 `ageSeconds: null` → age null → no clause.

## #22 (materiality) — the misread ruling is respected

`materiality.ts` changed only by the scale guard in `lineInBaseUnits` (2102–2109); `partitionByMateriality` and the $100/$1 lines are untouched. `bookHeadline` still branches on the material partition (940) with `belowLineSentence` restating the rest (935); the liquidatable tile's sub still says "N more under $100" (336, now spelled from `MATERIAL_LINE_USD`); the toggle and its label are unchanged (`HEAD NeedsAttention.tsx:110–116`). Nothing changed the headline's materiality.

## #23 — dropped; copy stayed where it was

New copy landed in the libs (book-headline, cash-summary, cash-view, stress-preview, refusal-phrasebook) and in the components only where those components already carried their own strings (tile subs, the legacy note, "Preview withheld:"). Nothing moved between layers.

## Concern 3 — the throw: every consumer is guarded first

`humanUsd` now throws `WireIntegerError` on a non-wire scale; `materialityTier`/`partitionByMateriality`/`belowLineSentence` likewise through `lineInBaseUnits`. Every consumer on HEAD, with the guard that precedes it:

| Consumer | Scale source | Guard before the call |
|---|---|---|
| `app/book/BookSurface.tsx:119,147,215` | `view.decimals` | `deriveCashView` → `readWireScale(engines[debt_manager].value_decimals)` (1771), which throws to the route boundary before anything renders — the same posture the -0 population pin already exercises |
| `app/book/NeedsAttention.tsx:32,33,56` | `row.decimals` | rows reach the component only through the hook → `readCashPage` (isWireScale AND equal to the book's, 1499–1508); `readCashRow` has no other production caller |
| `app/book/NeedsAttention.tsx:115` | `summary.decimals` | = view decimals |
| `app/overview/OverviewSurface.tsx:62` | `view.decimals` | as above |
| `components/kit/BandBars.tsx:54` | prop | BookSurface passes view decimals; BookLegacy passes `deriveLegacyView`'s `readWireScale` result (1932); no other `<BandBars` consumer exists |
| `lib/book-headline.ts:49,93`, `lib/materiality.ts:83`, `lib/cash-summary.ts:47,95` | headline/summary input | = view decimals |
| `lib/cash-view.ts:35,213` | `decimals` / `readWireScale(usd_decimals)` (1849, 1962) | guarded at each ingress |
| `lib/stress-preview.ts:135,137` | `base.at.usd_decimals` | `isWireScale` (2282) and every point reconciled (2289) |
| `lib/lab-headline.ts:21,64,66,98` (`f.decimals`) | `lab-engine.ts:75` `e.usd_decimals` | after `classifyRunBookEngine(e)` whose checks include `["usd_decimals", isWireScale(...)]` (`lab-classify.ts:213`); unreadable → no result |
| `lib/lab-movers.ts:107` `materialityTier` | `engine.usd_decimals` | `isWireScale` at `lab-movers.ts:78`, else the table returns with `unreadable: ["usd_decimals"]` |
| `lib/lab-compare.ts:131` `signedUsd` | `e.usd_decimals` | `classifySetRunEngine(e)` + explicit `isWireScale` (HEAD 119–121); malformed → unreadable/contradictory row |
| `lib/lab-library.ts:108` `signedUsd` | `r.result.decimals` | via `readEngine` → `classifyRunBookEngine` |
| `app/lab/money.ts` `bookMoney`/`signedBookMoney` | caller's `decimals` | `guarded()` → `isWireScale`, else `UNREADABLE_SCALE` |

No render path reaches the throwing functions with an unguarded scale. The one bare scale print on the Book, `BookMethodology.tsx:27` (`String(cash?.value_decimals ?? 6)`), does not format and cannot throw; it is also transitively guarded because `BookSurface` derives the view (and thus `readWireScale` on the same field) before the drawer is rendered.

## Concern 2 — `cash-view.ts` (not on the file list)

Every hunk maps to a ruling: `readWireMoney`/`moneyText`/`malformedSub` and the debt/collateral/bad-debt readings (#14), `readWireScale` at each scale ingress (#15), `walkStopped`/`bookEntryLine` (#3), `previewLine` and the preview refused for a withheld engine (#20; this replaced the same branch in `BookSurface`, 447→448), `deriveLegacyView` (#10, #14, #17), the `refusedTiles` hoist (a pure refactor so the money readings can consult it). Nothing outside the rulings.

## Concern 4 — the Book header's pending variant

No stylesheet keys on `data-variant` (grep over `app/**/*.css` and `components/kit/kit.module.css`: none); colour comes from `EM_CLASS[tone]` in `VerdictHeader` and the Overview strip, and pending's tone is `refused` (958), the dim register. `data-variant` is a test hook: `refused` on the Book header (`VerdictHeader.tsx:30` emits the tone), `pending` on the strip (`OverviewSurface.tsx:115` emits the variant). Honest words, no CSS needed, no colour lie.

## Pixel baselines

The commit's 29 paths hold no file under `web/tests/e2e/screenshots.spec.ts-snapshots` and no binary; `git diff --stat 14a5927..52abcd9 -- '*.png' '*-snapshots*'` is empty. The report's 4 passing pixel pins are consistent with that.

## Residuals (recorded, not held open)

1. **`readCashPage` order of checks.** `refused` (1449–1456) is judged before `page.engine` (1457). A refused page whose `engine` is not the walk's would be folded into the Cash refusal with the foreign engine's cause. It fails safe (refused register, never a zero or a negative) and needs a broken server or a proxy swap to occur; the consistent treatment under #2 is to hoist the engine check above the refused check. One line, next wave.
2. **Over-delivery wording.** An intermediate page pushing `delivered` past `total` reads "the walk delivered 5 of the 3 rows the wire advertised" (1249). It names the fault; the phrasing is odd.
3. **The distance chart's finding mid-walk / after a stop** (`BookSurface.tsx:215`): "$0 sits within 10% of the cap · walking the book, figures are a lower bound". A $0 lower bound is not a negative, and the qualifier is attached, but it is softer than the tiles' dash-until-settled. Style, not law.
4. **An empty `waterfall.points`** reads as `absent` (2269, `every` over an empty list) — "The Cash engine is not on this batch's stress grid" — rather than a refused grid. Edge; the wire has no such fixture.

Also noted, by design: the "Not computed" tile counts the aggregate's `refused_positions`, while the attention table's dim rows now include unknowable-verdict rows the engine called computed (#13); the two can differ, and the pill says why.
