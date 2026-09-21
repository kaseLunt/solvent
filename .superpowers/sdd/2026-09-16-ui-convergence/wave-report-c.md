# Task 12 fix wave — report, Area C · History, Activity, prose

Status: **DONE_WITH_CONCERNS** — all eight items landed in one commit, nothing STOPPED. The concerns are decisions I
made inside the rulings that the controller should look at (listed at the end), and the fact that none of the e2e pins
could be run (by instruction).

Commit **af39652** on `main`, 25 paths, by pathspec, staged by name, `scope_gate.py` OK (`25 path(s)`), hooks ran
(control-plane doctor 0 errors), subject verbatim (no clause dropped), no attribution line, not pushed.

Gates (all from `web/`, on the final tree, after Areas A, B and D had landed — 9a9874a, 736e09e, 62a0b61):
`npx tsc --noEmit` exit 0 · `npx eslint app lib components tests` exit 0 · `npm run lint:css` exit 0 ·
`npx playwright test --project=unit` **1024 passed, 0 failed**. My six unit specs: 107 → **114** at runtime
(`observatory-series` 32 → 34 source tests, `history-view` 20 → 22, `activity-view` 18 → 19, `prose` 2 → 4, `feed-view`
24, `feed-data` 10; nothing deleted). e2e, written and typechecked, NOT run: `history.spec.ts` 14 → 20 source tests,
`activity.spec.ts` 16 → 18. No build, :3111 untouched, no `--update-snapshots`, no prettier. Mid-run, tsc showed errors
in `tests/unit/book-headline.spec.ts` / `cash-view.spec.ts` (Area B mid-edit); they were gone on the final run.

Files: `web/lib/{observatory-series,observatory-data,history-view,activity-view,feed-view,feed-data,prose}.ts`,
`web/app/observatory/{HistoryChart,HistoryDrawer,HistoryPoint,HistorySurface,HistoryTiles}.tsx` + `history.module.css`,
`web/app/feed/{ActivitySurface,ActivityTable,ActivityDrawer}.tsx` + `activity.module.css`,
`web/components/charts/ObservatorySeriesChart.tsx`, the five unit specs + `prose.spec.ts`, the two e2e specs.

## Per item

### 1. I3 — an unreadable figure is a named hole, never the route boundary (ruling a)

What changed (`lib/observatory-series.ts`): a money metric passes `isWireDecimal` BEFORE it meets a formatter, at my
call sites only (`formatUnits`, `renderUsdAmount` untouched):
- new `GapKind` member **`"unreadable"`**, the exported word `UNREADABLE = "unreadable"`, and
  `metricUnreadable(point, metric)`;
- `buildMetricSeries`: a served hour whose money string fails the guard pushes `null` geometry, gap kind
  `unreadable`, and its own hover title — "`{iso} · debt (usd) is unreadable in this bucket: the wire's value is not an
  exact decimal (unreadable is not zero)`". Not `absent` (the axis still counts the hour as captured), not `withheld`,
  not the `null` kind. `geometryOf` re-checks the guard before `formatUnits`;
- `displayMetric`: a money string that fails the guard is the em dash and never reaches `renderUsdAmount`; the caller
  names which dash it is;
- `sparseCaptureLine` counts the new kind ("1 served bucket carries an unreadable value (unreadable is not zero)").

`lib/history-view.ts`: `tileOf` no longer asks `seriesNewestPoint(...).atNewestBucket` and then guesses a word from the
entry's kind (which is why the "unreadable" tile stayed unreachable even with the throw gone — a captured hour's
unplotted metric always fell to "not stated"). The tile's word IS the series builder's gap kind for the newest bucket
(`GAP_WORDS: Record<GapKind, string>`), so tile and chart cannot disagree. `pointRecord`'s money rows name the TRUE
cause of a dash: `, unreadable: the wire's value is not an exact decimal, and it is never shown as zero`; and — a false
cause I found on the way — a CAPTURED hour with a null debt no longer says "null because the book was withheld" (nobody
withheld it): `, not stated for this hour and never zero`. The view gains `marks` (below, item 5).

The chart (`ObservatorySeriesChart.tsx`): a gap tick of kind `unreadable` wears its own form-mark — a warn **cross**
(`GapUnreadableCross`, two strokes; test id `obs-gap-unreadable`), colour AND form, distinct from the absent tick and
from the withheld square. The key lists it (`{ mark: "unreadable", label: "figure unreadable" }`) exactly when the
drawn series carries one.

Reachable now, through the page's own call: the headline "The latest hour's debt figure cannot be read, in the hour
starting … Unreadable is not zero." (dashed); the dashed tile `— / unreadable`; the finding's "debt unreadable at one
end, so no change is given"; the chart's mark and key; the record's clause; the older direct label qualified
"(last captured …)".

Pins:
- unit, THROUGH `deriveHistoryView` — `history-view.spec.ts` "a debt figure that fails its wire guard, THROUGH the
  view…" (five malformed strings at the newest hour: state `ok`, the headline literal, the debt tile, the other three
  tiles neutral, the finding, `marks`, no `$0`/`NaN`; a malformed collateral; the key following the charted metric; a
  malformed OLDER hour). **SEEN FAILING FIRST** on the unfixed code: `DecimalFormatError … at parseDecimal ← formatUnits
  ← geometryOf (observatory-series.ts:200) ← buildMetricSeries ← tileOf (history-view.ts:172) ← deriveHistoryView` —
  the exact path the review named.
- unit — `observatory-series.spec.ts` "a money figure that fails its wire guard is a NAMED hole of its own kind…" (six
  malformed strings mid-window: kinds, values, the literal title, `displayMetric` = em dash, labels never drawn from
  it, the qualified newest label, the sparse line); `history-view.spec.ts` "a dashed money total names its TRUE
  cause…". Not run before the fix (same throw path; `metricUnreadable` did not exist).
- e2e — `history.spec.ts` "a malformed newest hour…" (`debt_usd: "27828808.216758"`): `data-state="ok"`, the headline,
  the tile, `[data-kind="unreadable"]` ×1 + `obs-gap-unreadable` ×1 with the absent/withheld counts unchanged, the key's
  third entry, the qualified label, the finding, the record's clause, no `$0` / `NaN` / the malformed string anywhere,
  and the collateral chart dropping the mark and the key entry. Not run.

### 2. W-history-maxlabel

- `seriesMaxPoint` returns `SeriesMaxPoint` = the labelled point + `directLabel: "peak {label}"` (`PEAK_WORD` in the
  lib; `label` — the exact string — is unchanged, so every existing pin on it holds). The chart prints `directLabel`.
- Placement (`ObservatorySeriesChart.tsx`, new optional prop `yMaxIndex`, ~18 lines): the label is centred over the
  peak's own x (`text-anchor="middle"`, clamped into the frame by measured glyph width). Where that would run into the
  newest figure's label — or no index is given — it keeps the plot's left edge (`x = padX + 10`) with the word. The
  element carries `data-place="peak" | "edge"`. **In the Cash demo the peak is 9 hours before the newest hour, so the
  label keeps the left edge** (it would collide with the newest figure's label); only its text moves.
- The finding: `moneyMove` / `countMove` say "rose by $1.8M, to $27.8M", "fell by 52, to 1,412", "rose by 1, to 49".
  Because each movement now carries its own comma, the three are joined by **semicolons** (my call — see concerns):
  "…, debt rose by $1.8M, to $27.8M; accounts fell by 52, to 1,412; and liquidatable positions rose by 1, to 49."
  Still one bigint subtraction on one engine at one scale through `wireBigInt` / `readWirePopulation`; no percentage;
  a null end is "not stated", an unreadable one "unreadable", never zero.
- Pins: unit `directLabel` literals ("peak $928.779012", "peak $1,919,760"; the label is not the first hour's figure);
  the finding's literals re-pointed in three specs + `not.toMatch(/(rose|fell) [$\d][^ ]* to /)`. e2e: the demo label
  text "peak $27,942,906.330446" + `data-place="edge"`; new test "the peak's label sits over the peak where it has
  room" (the peak moved to hour 80: `data-place="peak"`, `text-anchor="middle"`, `x` equals the peak point's `cx`, `y`
  above it). Fail by construction on HEAD (no `directLabel`, no `data-place`, old words); not run first.

### 3. W-history-observed

The verified fact ("was OBSERVED") now stands in all five named strings — and in three more that made the same claim:
| String | Was | Is |
|---|---|---|
| `HISTORY_MARKS[0].label` (the key — pinned page) | no complete batch this hour | no complete batch was observed |
| `HISTORY_ABSENT_NOTE` | The rollup captured nothing for this hour, because no complete risk batch existed to observe. Nobody refused it. … | The rollup wrote no row for this hour: no complete risk batch was observed in it. Either none existed when the rollup looked, or the rollup did not look or could not write — the record cannot tell these apart. Nobody refused it. … (rest unchanged) |
| the absent hover title | `… · no complete batch in this bucket · nothing was captured; …` | `… · no complete batch was observed in this bucket · nothing was recorded; …` |
| `pointDetailTakeaway` (absent) | ABSENT · no complete batch in this bucket (iso). | ABSENT · no complete batch was observed in this bucket (iso). |
| `HISTORY_METHOD[1]` | absent bucket · no complete batch in this bucket | absent bucket · no complete batch was observed in this bucket |
| `HISTORY_INTRO` (drawer) — not on the list, same claim | An hour with no complete batch renders as a hole | An hour in which no complete batch was observed renders as a hole |
| the empty window's tile sub — same claim | no complete batch | no hour recorded |
| module + type comments (`observatory-series.ts` head, `BucketKind`, `GapKind`) | "no complete batch existed" | "was observed", with why |
The hover / record / method strings keep the "bucket" register of their neighbours (Tier 2 rules chips, tile subs and
plurals only). Pins: every literal re-pointed; unit "doctrine: … an absent hour is one no complete batch was OBSERVED
in" sweeps the five strings for `/observed/` and against `/no complete (risk )?batch (this hour|in this bucket|existed)/`;
e2e key, record and the gap's own `<title>`. By construction (old literals).

### 4. Clarity Tier 2 + W-390-history

- Stride chip: value **`hourly`** (`strideWord()`), `title` = `describeStride()`, and the same sentence is a drawer
  paragraph (`doctrine = [...HISTORY_DOCTRINE, describeStride(step), ...notes]`). `describeStride`'s words retire
  "bucket" and the refuted "every Nth": native "native hourly record · every recorded hour is served verbatim"; applied
  "stride 7200s · the service serves at most one recorded hour per stride, each VERBATIM; skipped hours are never
  averaged". `strideWord` for an applied stride: "at most one hour in every 2" / "at most one hour per 5,000 seconds"
  (the gate round's verified wording; unreachable today — no stride is requested).
- Census chip: label **`Hours`** (was `Buckets`), value "165 recorded · 1 withheld · 2 absent" (grouped); loading:
  `Hours pending`.
- Tile subs: `hour of {iso}` (ISO verbatim).
- Real plurals: "6 provenance rows + the rate snapshot", "2 unacked epochs · acked …", "1 unacked epoch · …" (through
  `plural`); no "(s)" in any record (pinned unit + e2e).
- **W-390 — reasoned from the CSS, not run.** The probe's 434 = 16px gutter + the ~418px Stride chip (`.chip` is
  `white-space: nowrap`); the `thead` it listed is inside a scroll container already (`.rates { overflow-x: auto }`, and
  below 900px the kit's `.tbl` is itself `display: block; overflow-x: auto`), so it cannot widen the document. Fixes:
  the chip is 13 characters now; and page-locally, under `@media (max-width: 640px)` only (1440 untouched):
  `.page [data-slot="identity"] > [data-chip] { max-width: 100%; white-space: normal; overflow-wrap: anywhere }` (a
  long chip wraps inside itself), `.page { overflow-wrap: break-word }` (a failure message's URL is one token wider
  than the screen — break-word leaves intrinsic widths alone), `.marks { white-space: normal }`; `.rates` gains
  `min-width: 0; max-width: 100%`. Pins: e2e "a phone's width (390)…" — `scrollWidth <= clientWidth` on the Cash demo,
  again with the provenance fold open (the rate table visible), again on the legacy engine, plus every chip's right
  edge ≤ 390; e2e "…the honest states" — the same law on a failed fetch (URL in the dek) and the degraded rollup; unit —
  no chip's `label + value` exceeds 48 characters (fails on HEAD: 68).

### 5. Task 3 Minors m1–m4

- **m1** `RecordRow.noteTone: "caption" | "state"` decided in the lib; `HistoryPoint` sets a state clause in the new
  `.stateNote` (`--ink-2`) and a caption in `.dim` (`--ink-3`), and stamps `data-note`. State clauses: the withheld
  state row (` · CODE · the engine's whole book was withheld…`), every dashed money total's cause, the UNRECORDED sweep
  disclosure. Pins: unit (each row's `noteTone`); e2e computes the clause colours against live `--ink-2` / `--ink-3`
  probes on the contract's withheld example (3 state clauses).
- **m2** `GapWarnSquare` and `GapUnreadableCross` are exported from `ObservatorySeriesChart.tsx`; the chart and the
  key both render them — one shape, one source. The withheld square's DOM is byte-identical to before.
- **m3** the key is `view.marks` = `marksFor(gapKinds of the charted metric)`; `HistoryMarks` returns null on an empty
  list. Pins: unit (demo → two marks; hole-free → none; `marksFor` arms), e2e "a window with no hole carries no key".
- **m4** the record card is `aria-labelledby` its own `<h3 id="history-point-title">`: the accessible name IS the
  visible heading, hour included ("Bucket record 2026-08-08T20:00:00Z") — case and words cannot drift. Pin: e2e
  `getByRole("region", { name: "Bucket record {iso}" })`.

### 6. W-activity-refused, M11, `.detail` dim

- The view model decides the foot (`foot: "more" | "end" | "none"`) and the refusal strip's head (`refusalHead`). A
  refused walk's foot is `none` — no "Load more" — and the strip is the head + the restart button only; the service's
  words are the dek's, once. `data-foot` on `activity-foot`.
- The table's empty words said "restart **below**" while the restart sits ABOVE the table (and below it there is now
  nothing): "page refused · bad_request: restart above".
- **M3(e)** (three sites, all mine): a code the service did not state is never printed as its code — `refusedWord()`;
  a null/blank code → "PAGE REFUSED", "page refused: restart above", dek "Refused. Restart the list below.".
- **M11** the wire's note is page text under the extract (`activity-liquidation-note`, block, same 44ch measure); the
  `title` is gone. **`.detail` dim**: `LiquidationLine` takes `dim`; `.detailDim, .detailDim b { color: inherit }`.
- Pins: unit "a refused walk offers no next page…" (cold and with rows; every other state keeps the cursor's answer;
  the message in the dek and in no other string), the no-code arms; e2e "a refusal with NOTHING loaded…" (the persona's
  exact state: words once via `main.getByText` count 1, no `activity-load-more`, restart recovers), the refused-cursor
  test re-pointed (the strip no longer repeats the message; `data-foot="none"`), notes visible in both views, "a
  liquidation in the untimed tail dims WITH its row" (computed colours; the timed row proves the pin can fail). By
  construction on HEAD; not run first.

### 7. `plural` → `prose.ts`

`export function plural(n, noun)` (grouped, singular exactly at one) added to `lib/prose.ts`; nothing existing there
changed (the file's header still says "two prose helpers" — left alone as instructed). My two copies re-pointed
(`observatory-series.ts` private const deleted; `feed-view.ts` export deleted — `activity-view.ts` and
`feed-view.spec.ts` import from prose). **Copies left, not mine:** `lib/book-headline.ts:32`, `lib/stress-preview.ts:47`,
`lib/trust.ts:44` (a different shape: noun only), `app/book/BookSurface.tsx:23`; and `lab-headline.ts:37` inlines the
same rule for "account(s)". "(s)" plurals remain in `verification-view.ts` ("15 provenance row(s)" ×5 — Area D).

### 8. Whole-branch Minors in my files

- **M2** `ActivityInput.loading` removed (type, surface, spec fixture; pin: `Object.keys(base())` lacks it and tsc
  rejects the property). `liquidationEstablished` (in MY `feed-view.ts`, though the brief lists it under Area A):
  **kept, with its two pins** — the e2e all-actions test pins "visible with no fold", but no stronger pin covers the
  DEFINITION of "established", and deleting it would drop the unit count by two. Its doc comment no longer describes a
  fold that does not exist; it says no page reads it today.
- **M3(b)** one phrasing, one home: `engineInProse(wire)` in `lib/prose.ts` → "Cash" / "the legacy Aave v3 market".
  Replaces `named` (observatory-series; was "the Aave v3 market (legacy)") and `proseEngine` (activity-view). I took
  Activity's phrasing because it is on Activity's PINNED dek ("29 on the legacy Aave v3 market") and matches
  `DEBT_OF`'s "legacy Aave v3 debt"; History's changed strings are all non-primary arms (loading, degraded,
  unavailable, unreadable-scale, no-record dek). `prose.ts` cannot import `CASH` / `LEGACY` (they import prose), so the
  two ids are literals there, welded by `prose.spec.ts` to `CASH`, `LEGACY`, `FEED_ENGINES` and `OBSERVATORY_ENGINES`.
  Also applied to Activity's engine-scoped order paragraph, which printed the WIRE ID ("within debt_manager's own
  chain" → "within Cash's own chain"). **Third copy, not mine:** `modelled` in `lib/lab-headline.ts:144` still says
  "the Aave v3 market (legacy)". **M3(a)** `retry` / `retryWords`: neither copy is mine (lab-headline / verification-view).
- **M14** (listed under Area D, but the file is mine): the list's TITLE is no longer a drawer paragraph — doctrine
  8 → 7, sentences only (pinned: every paragraph ends a sentence; the title is absent).
- **M8** `HistoryDrawer` / `ActivityDrawer` key paragraphs by index (History appends wire notes, which may repeat).
- **M4 / M5** reworded to the law: `observatory-series.ts` (module head, the label section, `SeriesLabelledPoint`,
  `SeriesNewestPoint`, `sparseCaptureLine`, `describeStride`), `ObservatorySeriesChart.tsx` (head, prop docs, label
  comments), `HistoryChart.tsx`, `HistoryDrawer.tsx`, `HistoryPoint.tsx`, `HistoryTiles.tsx`, `history-view.ts`
  (×4), `activity-view.ts` (head; the `typedBlock` comment now says the true thing — the draft was already rounded by
  `Number()`), `feed-view.ts`, `feed-data.ts`, `observatory-data.ts`, `ActivitySurface.tsx`, and the spec comments
  that named waves / amendments. Test TITLES still carry "W-OBS", "W-3L", "r73" — titles, not comments; left so old
  reports still grep.

## Pixel-pinned renderings

**History `/observatory` (1440×900, both themes) — MOVED, on purpose.** Visible strings that changed:
1. chip `Stride native hourly buckets · every captured bucket served verbatim` → `Stride hourly`;
2. chip `Buckets 165 captured · 1 withheld · 2 absent` → `Hours 165 recorded · 1 withheld · 2 absent`;
3. layout consequence: the chip row is ~310px shorter, so the `Served` chip should join the first row and the header
   lose its second chip row — everything below shifts up (~45px, not measured), bringing more of the record card into
   the viewport;
4. four tile subs `bucket 2026-08-08T20:00:00Z` → `hour of 2026-08-08T20:00:00Z`;
5. the finding: `… debt rose $1.8M to $27.8M, accounts fell 52 to 1,412, and liquidatable positions rose 1 to 49.` →
   `… debt rose by $1.8M, to $27.8M; accounts fell by 52, to 1,412; and liquidatable positions rose by 1, to 49.`;
6. the key: `no complete batch this hour` → `no complete batch was observed`;
7. the chart's left label: `$27,942,906.330446` → `peak $27,942,906.330446` (same place);
8. if the record's fold summary is now in view: `6 provenance row(s) + the rate snapshot` → `6 provenance rows + the
   rate snapshot`.
Unchanged by construction: the withheld square, the ticks, the line, the tiles' values, the headline and the dek.

**Activity `/feed` — should NOT move.** The baseline shows rows 1–4 in the fold; the first liquidation is row 6, so
the now-visible note is below the 900px line, and it sits inside the existing 44ch extract, so no column width
changes. Above the fold the DOM is unchanged (`data-foot` is on the foot; the refusal strip is absent).

## Contract changes (for the plan's table and the integrator's specs)

| Kind | Change |
|---|---|
| `data-chip` RENAMED | History `Buckets` → **`Hours`** (ok and loading states) |
| `data-chip` same label, new value | History `Stride`: value `hourly`, gains `title` |
| test id ADDED | `obs-gap-unreadable` (chart); `activity-liquidation-note` (Activity extract) |
| attribute ADDED | `data-place` ∈ `peak · edge` on `obs-ymax-label`; `data-note` ∈ `caption · state` on the record's clause spans; `data-foot` ∈ `more · end · none` on `activity-foot`; element id `history-point-title` |
| attribute VALUE ADDED | `data-kind="unreadable"` on `obs-gap`; `data-mark="unreadable"` in `history-marks` |
| now CONDITIONAL | `history-marks` is absent on a window whose charted metric has no absent / withheld / unreadable hour; `activity-load-more` and `activity-end` are both absent while `data-state="refused"` |
| removed attribute | the `title` on `activity-liquidation` |
| retired | none |
History chips when answered: `Engine | Stride | Range | Hours | Served`; loading `Engine | Hours`.

## Lines in specs I do not own

I found none that break. Checked: `state-matrix.spec.ts` History cells ("watermark block", `[data-kind="absent"]`,
`obs-gap-warn`, "on this deployment yet.", the unavailable clause) and feed `refused:bad-cursor-400` (`activity-refusal`
+ `activity-restart` visible, 2 rows — still true; its comment "renders the envelope's own words" now describes the
dek, not the strip); `shell.spec.ts:19`; `p1b-fixes` (`[data-chip="Served"]`); `r1-fixes` (4) and (6);
`screenshots.spec.ts` ready predicates; `keyboard.spec.ts` (no new tab stop: the note is a span). If any integrator
line reads `[data-chip="Buckets"]` or the old finding outside the files I grepped (`tests/e2e`, `tests/unit`,
`scripts/`), it needs `Hours` / the new finding.

## Concerns

1. **Counts keep the throwing read.** I3's three named arms are money arms and I made exactly those reachable. A
   COUNT outside the contract (`accounts: -3`, `-0`, `2.5`) still lands at the route boundary — four existing pins state
   that as the law ("an out-of-contract count never becomes a number anywhere on the page"), and the ruling's text did
   not reverse them. Consequence: `tileOf`'s count branch `dashed(spec, "unreadable")` remains a type-narrowing belt
   that cannot execute (the comment says so). If the controller wants counts to be named holes too, it is the same
   pattern (`metricUnreadable` over `isWirePopulation`, `countMove` "unreadable at one end", an accounts arm in the
   takeaway) plus re-pointing those four pins.
2. **A refused walk offers no "Load more" with rows loaded too** — the ruling says zero rows. The refused cursor is
   never advanced (`useCursorPages` keeps it), so the button could only re-send what was refused; one rule for both
   arms. Revert is one line in `deriveActivityView` (`foot`).
3. **Semicolons in the finding** (item 2) — not ruled; the ruled fragments are verbatim inside it.
4. **`engineInProse` = "the legacy Aave v3 market"** moves History's ruled non-primary sentences off the clarity
   table's `named(engine)` form ("… for the Aave v3 market (legacy) on this deployment yet." → "… for the legacy Aave
   v3 market …"). The lab still uses the other phrasing (`modelled`, Area A's file).
5. **Beyond the list, same laws**: the captured-hour "null because the book was withheld" false cause; the "restart
   below" direction; `HISTORY_INTRO` and the empty-window tile sub under W-history-observed; the wire id in Activity's
   order paragraph; M14 and `liquidationEstablished` (assigned to D and A, but in my files). `prose.ts`'s header
   comment still says "two prose helpers" (I was told to change nothing existing there).
6. **e2e not run, by instruction** — the geometry pins (`data-place`, `x === cx`), the colour pins (computed against
   live tokens) and both 390 pins are reasoned, not observed. The likeliest to need a touch: the 390 honest-states pin
   (it assumes the failed-fetch message carries the request URL, as the read-through's captures show) and the
   `main.getByText("not interchangeable")` count (assumes the dek is one element and the page content is inside `main`).
7. The unreadable mark's form (a warn cross) and its key label ("figure unreadable") are mine, not design's.
