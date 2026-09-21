# Gate round · Phase 1 — report, Page A · History (`/observatory`)

Status: **DONE_WITH_CONCERNS** — every History item landed in one commit, nothing STOPPED. Commit **ebfef41** on
`main`, 9 paths, by pathspec, staged by name, scope gate OK (`9 path(s)`), hooks ran, no attribution line. Not pushed.

Gates (from `web/`): `npx eslint app lib components tests` exit 0 · `npm run lint:css` exit 0 ·
`npx playwright test --project=unit` **987 passed, 0 failed** (History's two unit specs: 53 tests at runtime — 32 + 21 — were 41 — 21 + 20; the e2e spec keeps its 14 source tests) ·
`npx tsc --noEmit`: **0 errors in any History path**; 5 errors persist in `tests/e2e/activity.spec.ts` (the Activity
implementer's file, mid-edit: `ACTIVITY_DEK` no longer exported, `FeedTakeaway` is parts now) — re-run after several
minutes, still there, not mine, not touched. No build, :3111 untouched, no snapshot update, no prettier. **The e2e
pins in `tests/e2e/history.spec.ts` are re-pointed and typecheck, but have not been run** (by instruction).

Paths: `web/lib/observatory-series.ts`, `web/lib/history-view.ts`, `web/app/observatory/{HistorySurface.tsx,
HistoryChart.tsx,history.module.css}`, `web/components/charts/ObservatorySeriesChart.tsx`,
`web/tests/unit/{observatory-series,history-view}.spec.ts`, `web/tests/e2e/history.spec.ts`.

`observatoryTakeaway` was grepped first: its only consumers are `lib/history-view.ts` and History's own three specs.
No Overview or other page reads it, so no other page's words moved.

## The new API (what the view and the pins read)

```ts
// web/lib/observatory-series.ts
export const named: (engine: ObservatoryEngine) => string;          // moved here from history-view (was private)
export interface ObservatoryTakeaway { emphasis; rest; holes; dek; answered: boolean }
export function observatoryTakeaway(response, axis, engine: ObservatoryEngine): ObservatoryTakeaway;   // was (response, axis): string
export function gridReadingLine(response, axis): string;            // same signature, new words
export function displayMetric(point, metric, usdDecimals): string;  // same signature, grouped output

// web/lib/history-view.ts
export const HISTORY_ENGINES = ["debt_manager", "aave_v3_etherfi"] as const;   // the page's order; [0] is the default
export const HISTORY_LOADING_DEK: string;
export const HISTORY_DEGRADED_CLAUSE: string;
// removed: HISTORY_DEK (the slogan lives in HISTORY_INTRO, in the drawer, already pinned there)
```

The equals-law survives as the clarity ruling words it: H1 text === `emphasis + " " + rest`, both from the one
function; the view copies the parts by identity and sets only the tone.

## Every arm — headline / dek on its fixture

| Arm (fixture) | emphasis · rest | dek | tone |
|---|---|---|---|
| Answered, Cash (`DEMO_OBSERVATORY_DM`) — the cold load | **$27.8M of Cash debt is outstanding,** across 1,412 accounts in the hour starting Aug 8, 20:00 UTC. | 165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 1 was withheld; each is a gap on the chart, never a zero. | neutral |
| Answered, legacy (`DEMO_OBSERVATORY_AAVE`) | **$1.9M of legacy Aave v3 debt is outstanding,** across 8,552 accounts in the hour starting Aug 8, 20:00 UTC. | (the same holes sentence — both demo series carry 165 / 1 / 2) | neutral |
| Answered, legacy (`OBSERVATORY_SERIES_AAVE`, 4 of 5) | **$619.18 of legacy Aave v3 debt is outstanding,** across 6 accounts in the hour starting Jul 29, 10:00 UTC. | 4 of the 5 hours in this window were recorded. 1 is absent — no complete batch was observed; it is a gap on the chart, never a zero. | neutral |
| Newest hour withheld (`OBSERVATORY_SERIES_DM`, the contract's own example) | **The latest hour's figures were withheld,** so no current debt figure is shown (Jul 29, 09:00 UTC). | The engine's whole book was refused in that hour (collateral-flag custody unproven · FLAG_CUSTODY_UNPROVEN). 1 of the 2 hours in this window was recorded. 1 was withheld; it is a gap on the chart, never a zero. | refused |
| Newest captured, debt null (demo DM, last `debt_usd: null`) | **The latest hour states no debt figure,** in the hour starting Aug 8, 20:00 UTC. Not stated is not zero. | the holes sentence | refused |
| Newest captured, debt not a wire decimal (`""`, `"12.5"`, `"1e9"`, `"0x10"`) — NEW arm, see concern 4 | **The latest hour's debt figure cannot be read,** in the hour starting {t}. Unreadable is not zero. | the holes sentence | refused |
| Accounts null, debt stated | **$309.59 of Cash debt is outstanding,** in the hour starting Jul 29, 08:00 UTC; the account count was not stated. | the holes sentence | neutral |
| More hole than record, `captured * 2 <= total` (2 of 4, the boundary) | **$309.59 of Cash debt is outstanding,** across 3 accounts in the hour starting Jul 29, 09:00 UTC — but only 2 of the 4 hours in this window were recorded. | 2 are absent — no complete batch was observed; each is a gap on the chart, never a zero. (the recorded count is in the headline, so the dek keeps only what each hole is) | neutral (design A2.3: never warn) |
| …one hour past the boundary (2 of 3) | …across 3 accounts in the hour starting Jul 29, 08:00 UTC. | 2 of the 3 hours in this window were recorded. 1 is absent — … | neutral |
| No recorded hour (`points: []`) | **No hour in this window was recorded.** (rest `""`) | No complete batch was observed for Cash in this range, so there is nothing to chart. That is a missing record, not a zero. (legacy: "…for the Aave v3 market (legacy) in this range…") | refused |
| Loading | **Loading the history of Cash…** (kept) | The hourly record of this engine's debt, collateral, accounts and liquidatable positions. | refused |
| Degraded (`OBSERVATORY_DEGRADED`, 503) | **No hourly history exists for Cash on this deployment yet.** | {sentence(the service's message)} That is a fact about this deployment, not an empty history; live figures are on the Book. (no message: "The service named no reason. That is a fact…") | refused |
| Fetch error / unreadable scale | kept verbatim ("The history of Cash could not be fetched." / "…cannot be read.") | kept | refused |

Holes sentence, the remaining arms (all pinned in `observatory-series.spec.ts` "the holes sentence, every arm"):
`All 3 hours in this window were recorded.` · `The only hour in this window was recorded.` · `The only hour in this
window was not recorded. 1 was withheld; it is a gap…` · `None of the 3 hours in this window was recorded. 1 is
absent — no complete batch was observed — and 2 were withheld; each is a gap…` · the verb follows the count (`1 of the
3 hours … was recorded`) · sampled: `4 of the 5 sampled hours in this window were recorded. … The hours are sampled:
the service serves at most one in every 2.` (non-multiple stride: `…at most one per 5,000 seconds.`; an echoed
`step_seconds: 3600` is still "hour").

Chart finding (`gridReadingLine`):
- demo legacy: `Between the first and last recorded hours (Aug 1, 21:00 → Aug 8, 20:00 UTC), debt fell $11K to $1.9M,
  accounts fell 91 to 8,552, and liquidatable positions rose 1 to 46.` — the ruled sentence, word for word.
- demo Cash: `…(Aug 1, 21:00 → Aug 8, 20:00 UTC), debt rose $1.8M to $27.8M, accounts fell 52 to 1,412, and
  liquidatable positions rose 1 to 49.`
- equal ends: `debt unchanged at $619.18, accounts rose 1 to 6, and liquidatable positions unchanged at 0.` (the 0 is
  a captured hour's own wire count — a true zero, not a hole).
- a null end: `accounts not stated at one end, so no change is given` / `…at either end…`; money not a wire decimal:
  `debt unreadable at one end, so no change is given`.
- one recorded hour: `Only one hour in this window was recorded (Jul 29, 08:00 UTC), so there is no movement to
  state.` · none: `No hour in this window was recorded, so there is no movement to read.`
- The delta is ONE bigint subtraction (`b - a` or `a - b`) of two values of one engine from one response at its one
  `usd_decimals`, each through `wireBigInt` first; counts through `readWirePopulation` first; no percentage. The
  span states its zone once, at the end, exactly when `humanUtc` parsed both ends (a malformed end prints verbatim).

## Per item — what changed and its pin

**Clarity table — headline, every arm.** `observatoryTakeaway` returns parts (S4) and takes the engine (`DEBT_OF` is
an exhaustive `Record<ObservatoryEngine, string>`: a third engine is a type error; one engine per sentence).
`humanUsd` / `groupInt` / a private `plural` (the `lab-headline.ts` shape) / `humanUtc(bucket_start,
response.served_at)`. Pins: `observatory-series.spec.ts` › `observatoryTakeaway — the headline's parts and the dek`
(10 tests: fixture-composed + the demo literals for both engines with `nb()`; the year rule both ways incl. a
`served_at` that is no instant and a bucket start with a `+02:00` offset printed verbatim; withheld + no older figure
leaks + no `$`; unknown / absent refusal code; debt null / unreadable; accounts null / one account / `-0` throws;
no-record; promotion at the boundary and one past it; every holes arm). `history-view.spec.ts` pins the view's
`headline` `toEqual` the parts + tone, plus literals.

**Holes in the dek + the promotion rule.** Above. The slogan `HISTORY_DEK` is deleted; `HISTORY_INTRO` keeps it in
the drawer (pinned: the dek contains "never a zero" and does not contain "One engine per view").

**Chart finding as deltas.** Above. Pins: `gridReadingLine — the chart's finding, as deltas` (4 tests) + the view's
literal + the e2e literal.

**A2 neutral.** Answered arms `tone: "neutral"`; with holes still neutral (the `Buckets` chip keeps `warn`, pinned
beside the literal headline); refused arms unchanged. `data-variant="neutral"` pinned in e2e on both engines.

**A3.1 grouping.** `displayMetric` → `renderUsdAmount` (book-format's one grouped-USD renderer; same digits) and
`groupInt(readWirePopulation(...))`. One edit moves the chart's y-max / newest labels, the hover titles and —
because `pointRecord` now prints its four totals THROUGH `displayMetric` (it had its own ungrouped copies) — the
bucket record. `refused position rows` is grouped too. Pin: new test "exact displays are GROUPED" (`$27,828,808.216758`,
`$153,171,572.777189`, `1,412`, `$1,900,000`, `8,552`, y-max `$1,919,760`; separators stripped = the exact decimal; an
out-of-contract count still throws at the chokepoint). **A3.2 plurals**: no `(s)` in the headline, dek or finding
(regex-pinned). A3.3–A3.4 were Phase 0's.

**A4 geometry only.** `padX = 6, padTop = 22, padBottom = 6`; every label above its reference (`y(max) - 6`,
`Math.max(12, y(newest) - 8)`, `y(0) - 4`); the three `<text>` nodes painted after the line, the points and the
selection ring, each with the inline halo (`paintOrder: stroke; stroke: var(--panel); strokeWidth: 3`) and
`pointerEvents: none` (painted last, a label would otherwise take a point's hover and click — it did not before only
because it was painted first); gap ticks and the withheld square start at `padTop`; `PLOT_HEIGHT` 200 → 120. The
zero baseline, `includeZero` and the y-domain are untouched. The "0" moved out of the `obs-zero-floor` group (so it
can paint last) and carries a NEW id `obs-zero-label`; `obs-zero-floor` still holds the rule (no test read either).
Pins (e2e, attribute-level, not pixel): each label's `y` is less than its reference's (`y1` of the floor rule, the
smallest `cy`, the newest point's `cy`); all three come after the last path/point in document order and wear the
halo; the svg `height` is 134 (120 + one extents strip).

**B1 — History opens on Cash.** `HISTORY_ENGINES` (Cash first) in `history-view.ts`; the surface's
`useState(HISTORY_ENGINES[0])` and the switch maps over it. `lib/observatory-data.ts` (`OBSERVATORY_ENGINES`, "the
contract's order") is not mine and is unchanged; a unit pin holds the two lists to the same set. Pins: unit "the
page's engines"; e2e cold load (data-engine, pressed state, button order `["Cash", "Aave v3 market (legacy)"]`, the
first request is Cash's) and the x-order in "answer before evidence".

**B3 (page half).** The page-local pressed rule is deleted from `history.module.css` (both selectors — the metric
row now wears the kit's accent too); `.controls button { padding: 4px 10px; font-size: var(--type-small); }`
(Activity's values). CSS only; stylelint clean.

**B9.** Visible dot `r = step < 10 ? 1.5 : 2.4` (a lone point, `step === 0`, keeps 2.4); the pointer target is held
at 2.4 by a transparent stroke of `(2.4 - r) * 2`. Pins: e2e `r === 1.5` on the 168-hour demo (true at every
measurable width: the frame caps at 1680px → step ≤ 9.99), `r="2.4"` on the contract's two-hour example.

## Pins re-pointed (old words → new)

`tests/unit/observatory-series.spec.ts`
- takeaway, captured: ``Debt ${displayMetric} across ${n} account(s) as of bucket ${iso}; … bucket(s) …`` +
  `toContain("$619.186008")` → parts composed from the fixture (`humanUsd(BigInt(debt))`, `groupInt`, `humanUtc`) +
  the literal `$619.18 of legacy Aave v3 debt is outstanding,`; the exact `619.186008` is now pinned ABSENT from the H1.
- takeaway, withheld: `Newest bucket {iso} withheld (CODE) — no numbers served for it; 1 bucket(s) withheld.` →
  `The latest hour's figures were withheld,` / `so no current debt figure is shown (Jul 29, 09:00 UTC).` + the dek.
- finding: `between captured buckets A and B: debt $x → $y, accounts a → b, liquidatable c → d.` → the delta sentence.
- finding, one bucket: `only one captured bucket in this window ({iso}) — no movement to state.` → `Only one hour in
  this window was recorded ({humanUtc}), so there is no movement to state.`

`tests/unit/history-view.spec.ts`
- ok Cash: `{ emphasis: observatoryTakeaway(...), rest: "", tone: "ok", dek: HISTORY_DEK }` → the parts, `neutral`,
  the literals; the `HISTORY_DEK` literal pin → the dek literal + the drawer pin.
- null debt: `headline.tone === "ok"` → `refused` with the ruled words (and a new accounts-null arm stays `neutral`).
- empty window: `No bucket in this window is backed by a wire row.` → `No hour in this window was recorded.` + dek.
- degraded: `The durable rollup for Cash is unavailable.` / dek `sentence(message)` → `No hourly history exists for
  Cash on this deployment yet.` / `${sentence(message)} ${HISTORY_DEGRADED_CLAUSE}`.
- loading dek: `HISTORY_DEK` → `HISTORY_LOADING_DEK` (+ literal, + no digit in it).
- capital test: `startsWith("Debt $")` / `"Newest bucket "` → `"$27.8M of Cash debt "` / `"The latest hour's
  figures "`; the opening regex admits a money figure (`/^(?:[A-Z]|\$\d)/`) — the ruled emphasis opens with `$`.
- bucket record: `String(newest.accounts)` etc. → `groupInt(...)` + literals.

`tests/e2e/history.spec.ts` (typechecked, not run)
- cold load: legacy default → Cash; `data-variant` `ok` → `neutral`; H1/dek → parts + literals; the leak check
  reversed (no legacy `$1.9M` on the Cash view).
- engine switch: Cash → legacy (and back); `asked[0] === "debt_manager"`.
- holes / drawer / metric selector / W-OBS labels / r73 hazards: the fixture moved from `DEMO_OBSERVATORY_AAVE` to
  `DEMO_OBSERVATORY_DM` (the cold load is Cash; both series carry the same holes and 3 line segments — checked).
- W-OBS-B and provenance: the `history-engine-debt_manager` click removed (it is the default); sweep test: a click
  to legacy added before the "recorded none" arm.
- record accounts: `groupInt(...).replace(/,/g, "")` → `groupInt(...)`.
- degraded / loading / failed-fetch headlines: "the Aave v3 market (legacy)" → "Cash", new degraded words.
No test was deleted in any of the three files.

## Fact claims verified before wording (reconciliation 6)

1. **"absent — no complete batch RAN" is not true as written; worded "no complete batch was OBSERVED".**
   `internal/store/p5_observatory.go` `WriteObservatoryPoints`: the rollup writes `date_trunc('hour', now())` rows by
   observing the newest batch that passes `riskBatchCompleteConjuncts` — ANY still-existing complete batch, however
   old — and it is ticked from the INDEXER's loop (`cmd/indexer/main.go:1614`, "a failure is a log line and a retry
   next tick"). So an hour has no row when no complete batch existed at the ticks in it, OR the indexer was not
   ticking, OR the write failed all hour. "Was observed" is true in all three; "ran" is true in none reliably. The
   same correction is in the no-record dek ("No complete batch was observed for Cash in this range…").
2. **"in the hour starting {t}" — true, but for a different reason than the ruling gives.** The ruling says "the
   figure comes from the newest complete batch inside that hour". It is the newest complete batch AS OBSERVED in that
   hour (last write wins inside the open hour; migration 00016: "bucket_start … date[s] the OBSERVATION"); the batch
   may have been computed earlier. The ruled words claim only the hour, so they stand; the code comment states the
   real reason.
3. **"The engine's whole book was refused in that hour"** — contract `ObservatorySeriesPoint.refused`: "True when the
   engine's whole book was withheld at capture time"; `wireObservatoryPointFrom` sets it iff the rollup row carries
   a refusal code. Kept as ruled.
4. **"accounts"** — the handler maps `accounts := p.Positions` (the engine's position rows in the observed batch);
   the wire names the field `accounts`, the Book counts the same rows as accounts. Kept.
5. **Degraded: "No hourly history exists … on this deployment yet"** — on this route `code: "unavailable"` has ONE
   source (`cmd/api/p5_observatory_series.go:139`, `store.ErrObservatoryUnavailable`: the table is not migrated).
   The other `codeUnavailable` (`handlers.go:37`, no servable batch) is not on the series route. True as written.
6. **"(every {n}th hour)" is not what the stride does; worded "serves at most one in every N".** The handler skips
   a row when it starts before `lastServed + step` — relative to the last row SERVED, so a hole shifts the grid, and
   `step` need not be a multiple of 3600 (`minimum: 3600` only). "At most one in every N" / "at most one per
   {s} seconds" is true in every case. The page never requests a stride today, so this arm is defensive.

## Concerns

1. **Pins outside my ownership that B1 / the new words will move — the integrator's to re-point** (I did not touch
   them): `tests/e2e/state-matrix.spec.ts` — `observatory · ok:absent-bucket` loads the default engine and expects
   `history-point` to contain "watermark block" and an `[data-kind="absent"]` tick: on Cash its mock serves
   `OBSERVATORY_SERIES_DM` (newest withheld, no absent hour), so it needs an `act` clicking
   `history-engine-aave_v3_etherfi` (the `refused:withheld-bucket` arm's click on `debt_manager` becomes a no-op and
   still passes); `observatory · degraded:rollup-unavailable` expects the verdict to contain `"is unavailable."` —
   the ruled headline no longer says that (the chip `Rollup unavailable` prints "unavailable" without the full
   stop, so the pin will fail; `"on this deployment yet."` is the new tail). `shell.spec.ts`'s History h1 regex
   (`/could not be fetched\.$/`) and `p1b-fixes.spec.ts` fix 3 (the `Served` chip) still hold. The screenshot
   baselines for History move (default engine, plot height, ink headline, switch size) — expected this round.
2. **Two deliberate departures from the ruled words**, both under reconciliation 6 and detailed above: "no complete
   batch was observed" (not "ran"), and the stride gloss. Everything else in the table is word for word — including
   the span's single trailing "UTC", which the ruled PATTERN (`{humanUtc(first)} → {humanUtc(last)}`) would have
   doubled; I followed the ruled demo words and strip the first zone only when `humanUtc` parsed both ends.
3. **Pre-existing strings that make the claim fact 1 refutes — not in this round's table, left alone, flagged:**
   `HISTORY_MARKS[0]` "no complete batch this hour", `HISTORY_ABSENT_NOTE` ("…because no complete risk batch existed
   to observe. Nobody refused it."), the absent hover title and `pointDetailTakeaway`'s "ABSENT · no complete batch
   in this bucket", `HISTORY_METHOD[1]`. They now sit beside a dek that says "observed".
4. **Arms I added that the table does not have**: a debt that is not a wire decimal ("cannot be read … Unreadable
   is not zero", dashed; before, `formatUnits` threw at the route boundary — the takeaway now needs a bigint, and
   `wireBigInt` returns null rather than throwing); `None of the N hours…`, `The only hour…`; "not stated at either
   end"; "unreadable at one end". And in the promoted arm the dek DROPS its first sentence, since the headline just
   said it — the ruling is silent on the dek there.
5. **`plural` was not lifted to `prose.ts`** (clarity S1): `prose.ts` and `book-headline.ts` are outside every
   implementer's ownership this round. `observatory-series.ts` has a private one in the brief's named shape
   (`lab-headline.ts`); a later lift is a three-line change.
6. **Tier 2 (T2-2 Stride chip `hourly`, T2-3 chip `Hours … recorded`, T2-4 tile sub `hour of {iso}`) not done**: the
   brief's History item list does not order them, T2-3 renames a `data-chip` locator other specs use, and design
   reconciliation 2 names the chip `Buckets`. Consequence: the dek says "hours … recorded" while the chip says
   "Buckets … captured" and the tile subs say "bucket {iso}" — "bucket" is retired from the headline, dek and
   finding only. Also untouched, same register: the sparse-window line, the bucket record's `(s)` plurals
   ("provenance row(s)", "unacked epoch(s)"), the `(last captured {iso})` label qualifier. C1 (finding as the card
   title) is a named proposal, not ruled — not done.
7. **Dek length**: the withheld arm is three sentences (cause + recorded + gaps), at S5's limit; with a stride
   applied it would be four (the sampled note). Unreachable from the page today (no `step` is ever requested).
8. **Not verified by me (by instruction)**: no build, no e2e run, no pixel replay. The e2e geometry pins read SVG
   attributes and inline style (`el.style.paintOrder.startsWith("stroke")`), which I could only typecheck.
