# Task 13 review — Compare: the set run as a signed dot plot (R6)

**Reviewed:** commit `8249d6a` (parent `745627e`), the six-file package in `review-745627e..8249d6a.diff`, read against the brief, the report, the plan header (Global Constraints, R1–R16, the contract table's Compare row), `lib/lab-compare.ts`, `lib/lab-view.ts`, `lib/lab-reading.ts`, `lib/lab-headline.ts`, `lib/useMeasuredWidth.ts`, `components/charts/DotPlot.tsx`, `charts.module.css`, `api/openapi.yaml`, the demo set fixture, and the old Lab's `tornadoCells.ts` at `9279806^`. Read-only; nothing run.

**Verdicts:** Spec compliance ✅ · Task quality **Needs work** (one implementer Important, one plan-level Important that needs a controller ruling, a short list of Minors).

Line numbers below are the committed files' (diff line − 21 for `CompareCard.tsx`; diff line + 174 for the appended `lab.spec.ts` pins).

---

## Spec Compliance

### Contract ids and `data-kind`

✅ `lab-compare-card` — `web/app/lab/CompareCard.tsx:132` (`ChartCard testId`). `lab-compare-state[data-kind]` — `:134-136`, `data-kind={state.kind}` so the attribute is exactly the `CompareState` discriminant (`idle · running · ok · failed`, `web/lib/lab-view.ts:87-91`). `lab-dotplot` — `:163`; rows `lab-compare-row-{id}` via `rowTestIdPrefix="lab-compare-row"` (`:164`) → `DotPlot.tsx:77-80` builds `${prefix}-${row.key}` with `key: r.id` (`CompareCard.tsx:61`). The row's `data-kind` is the kit's own, derived from the union (`DotPlot.tsx:86`: `row.tenths === null ? "refused" : "point"`), so a card cannot label a refused row `point`. The legacy ids (`lab-dotplot-legacy`, `lab-compare-legacy-row-{id}`, `lab-compare-legacy`) and `lab-compare-superseded[data-freshness]` are additive. `lab-compare` (the button) comes from the kit (`ScenarioLibrary.tsx:148-158`).

### Each `CompareState` arm rendered honestly

✅ **idle** — finding "Tick two or more scenarios and press Compare." (`:105`), body "No plot yet." (`:173`); the `DotPlot` is inside `ok !== null ? … : …` (`:140`), so no empty plot exists. Pinned: C24 `lab.spec.ts:700-701` (state `idle`, `lab-dotplot` count 0 at two ticks, `sets()` 0).
✅ **running** — "Evaluating N scenario(s)…" (`:107`), body "Running…" (`:171`); no rows because the ok branch is the only one that mounts a plot. Pinned: C26 `:783-785`.
✅ **ok** — the Cash rows (`:159-165`), the superseded notice only when `freshness !== "still_newest"` (`:142-158`).
✅ **failed** — `${state.headline.emphasis} ${state.headline.dek}` (`:109`) prints the set-run failure's own words from `failureHeadline` (`web/lib/lab-headline.ts:135-155`): `busy` → "The evaluator is busy." + the message + "N of M slots in use." (`:142-148`); `no-batch` → "No servable batch." + message + "(503)." + `retry()` ("Retry after Ns." / "The service did not say when to retry.", `:131-133, :139`). Body "No plot: nothing here is a share." (`:174`); no stale rows. Pinned: C26 `:767-770` (the busy sentence verbatim, no `lab-dotplot`, the button freed, one POST).

### `rowsOf` builds the union by arm; no path to a false zero or a signed refusal

✅ `CompareCard.tsx:59-82`. Non-point → `{ tenths: null, tone: "refused", note }` unconditionally (`:62-69`). Point with a null `shareTenths` → `{ tenths: null, tone: "refused", note: "no share" }` (`:72-74`), unreachable by the lib's construction (a `point` always carries `shareTenths: share`, `web/lib/lab-compare.ts:123`) but it can never become `0n`. Point → `tenths` (the lib's `bigint`) and a tone by sign (`:79`). No `?? 0n`, no `Number()`, no `BigInt()` in the card; the only floats are in `dotPlotScale` (`web/lib/lab-geometry.ts:32-33`), geometry only. The lib's guards precede the arithmetic (`lab-compare.ts:110-112` `isWireScale`/`isWireDecimal` before `BigInt` at `:118-119`; `shareTenths` is `percentTenths`, `:47-49`). Pinned: C24 `:714-715` (every row's `data-kind` equals the lib's kind; circle count = point count), C25 `:748-753` (refused row: no circle, value column exactly "withheld", no `%`, no `$`).

### The legacy block is its own plot with its own words

✅ `CASH_WORDS` / `LEGACY_WORDS` (`:20-27`); the legacy plot's rows are built with `LEGACY_WORDS` (`:186`), its axis label says "percent of the legacy book" (`:188`), the fold says "Shares of the legacy book, in its own unit. The two books are never added together." (`:193-196`). The two plots are separate `<svg>`s with separate scales (`DotPlot.tsx:49-52` per mount) — never one axis. Pinned: C24 `:720-730` (the Cash plot contains no "legacy"; `+0.3% of the legacy book · +$6,000` with no account count; `ethfi_minus_50` refused as "not modelled for the legacy market"; "never added together").

### The `freshness` enum is worded, and the words are true to the contract

✅ `FRESHNESS_WORD` / `FRESHNESS_PILL` (`:85-98`) against `api/openapi.yaml:5491-5513`: `still_newest` → "still the newest" (the wire's own note says "STILL the newest … at probed_at"); `superseded` → "since superseded" (newest strictly greater: a newer batch materialized — true); `newest_is_older` → "the newest servable batch is now older than it" (strictly less; the sentence claims no materialization, as the contract demands); `none_servable` → "no batch was servable when probed" (null exactly there — true). Raw tokens never print. Two wording nits are in Minors (the present tense, and the notice's "not stated" for `none_servable`).

### The Compare button law

✅ `web/app/lab/LabSurface.tsx:248-261`: `disabled: view.checked.length < 2 || view.compare.kind === "running"` (`:255-256`); label "Compare N scenarios" / "Compare…" (`:251-254`); `onCompare: () => reading.runSet(view.checked)` (`:257`) where `view.checked` is the listing-ordered, listing-filtered tick set (`web/lib/lab-view.ts:269`). `runSet` itself refuses while a set is in flight (`web/lib/lab-reading.ts:106-107`, `canDispatchSet` `:26`). Address mode: `mode === "book" ? {…} : null` (`:249, :260`) and the kit renders no button for `null` (`ScenarioLibrary.tsx:148`); the whole book branch, card included, is replaced by `AddressWorkspace` (`:277-278`) — R15. Pinned: C24 `:690-698`, C26 `:785`, C27 `:798-806`.

### The card classifies nothing

✅ Every branch keys on `state.kind`, `r.kind` or the lib's `tenths`; no wire field is read in the card. The one mapping the card owns is display tone by sign (`:79`).

### PROJECTION

✅ (page-level) The book-mode verdict kicker always carries the PROJECTION pill (`LabSurface.tsx:162-178`, `:175`) and renders in every book state (`:281-283`), so the card's shocked figures sit under it. The card itself carries no pill and the brief's code had none — see Minor 7.

### Controller rulings

- (a) No `?scenarios=` write — confirmed absent (`LabSurface.tsx:257` dispatches only); the both-params conflict notice would otherwise render falsely (`deepLinkDecision`'s `conflict` arm, `LabSurface.tsx:110-122`). Accepted per the ruling.
- (b) The measured-zero tone is `warn` at **`web/app/lab/CompareCard.tsx:79`** (`tenths > 0n ? "crit" : tenths < 0n ? "ok" : "warn"`). Expected; not counted. The one-line fix is `: "ok"`.
- (c) `dispatchNotice` / `dispatchClauses`: `grep -rn dispatchNotice web --include=*.ts --include=*.tsx` → no files (only the review packages and `progress.md` mention it). Zero references remain. ✅

---

## Concern 3 — the card shows every result the wire returned, not only what was asked

**The wire contract (`api/openapi.yaml`):** `requested_scenario_ids` is "Echoed verbatim, in REQUEST order. `sorted(results[].scenario_id)` equals `sorted(this)` as multisets in every 200 — one line to check, impossible to satisfy while hiding a hole" (`:5531-5534`); `results` is "One per requested id, in REQUEST order" (`:5535-5537`); `scenarios_evaluated` equals both lengths, "There is no partial 200" (`:5487-5489`); the endpoint says "ALL OR NOTHING … the strongest membership law available" (`:1454-1461`). So the contract promises the response covers exactly the ids **the server echoes** — and it explicitly frames that as a law the client should check, not a fact the client may assume.

**What the client asked is a separate authority.** The contract cannot promise that the server's echo equals the client's request; the old Lab held exactly that law — R57 item 1 in `tornadoCells.ts` (`git show 9279806^:web/app/lab/tornadoCells.ts:52-110`): "the body's own requested list is a claim, never an authority, and a set answering ids nobody posted has no member this page may read", faulting "`{id}` was dispatched and is not named in requested_scenario_ids", "… was not dispatched", "… was answered and was not requested", "… appears in more than one result". It was pinned in unit (`tornado-lines.spec.ts:472-490`) and e2e (`tornado.spec.ts:317, :364`). Task 12's retirement ledger (`.superpowers/sdd/progress-ui-overhaul.md:4450`) lists the set-run laws that moved to Task 13 — exact ids posted, one POST, in-flight refusal, superseded, busy — and **does not list the membership gate**; it is not in `lib/lab-compare.ts` (it never reads `requested_scenario_ids`; `compareRows` maps `set.results` at `:133`), and `compareOf` drops `set.ids` on the ok arm (`web/lib/lab-view.ts:234`) although `SetRecord` carries them (`web/lib/lab-library.ts:34-36`).

**Ruling from the contract:** the wire's answer is the truth *about what it evaluated*, but it is not the truth about *what was asked*. A card that renders four rows for a two-id ask is honest about the four and silent about the ask; a reader who ticked two and sees four has been handed a comparison they did not request without a word. The fix is not a card sentence ("asked N · returned M" would make the card classify) but a view-level state: `compareOf` has both `set.ids` and `o.response`, so the membership check belongs there (or in `compareRows(set, engine, askedIds)`), yielding a `failed` compare state whose headline names the faults — the old law's own sentences. **C24 (`lab.spec.ts:706-713`) currently pins the contract-violating shape as the happy path** (posted `["eth_minus_30","ethfi_minus_50"]`, four rows). That pin is the brief's (`task-13-brief.md:121-123`), so it is a controller matter, not the implementer's defect — but it will have to change when the gate lands (either the fixture's four ids are the ones ticked, or the mock answers the asked ids only). Recorded as Important 1.

## Concern 4 — the `DotPlot` clip and the page patch

**Is the patch correct?** Yes. `useMeasuredWidth` clamps to `min: 480` (`CompareCard.tsx:100`; `useMeasuredWidth.ts:66`), so at 390 px the frame's content box (~330 px) receives a 480-wide `<svg width={480}>` (`DotPlot.tsx:60`) with no `viewBox` (`:58-65`). The kit's `.chart { max-width: 100% }` (`charts.module.css:4-8`) would shrink the svg's CSS box to the frame while its user units stayed 1:1, cutting off the value column at `px(plotW) + 8` (`DotPlot.tsx:109`). `.plotFrame > svg { max-width: none }` (`lab.module.css:17`) keeps the svg at 480 and `.plotFrame { overflow-x: auto }` (`:15`) makes the frame scroll — which is the hook's own law ("Below the minimum the chart does NOT shrink; the frame scrolls", `useMeasuredWidth.ts:17-18`).

**Is it pinned?** Half. C24 `:734-736` pins the page-level `scrollWidth − clientWidth ≤ 0` at 390. Nothing pins that the frame scrolls rather than clips (`frame.scrollWidth > frame.clientWidth`, or the svg's rendered width equalling its `width` attribute). Minor 3.

**Should the kit own it?** Yes. Every other `.chart` consumer carries a `viewBox` (`Scatter.tsx:106`, `Sparkline.tsx:164`, `WaterfallSteps.tsx:114`, `ObservatorySeriesChart.tsx:174`), so `max-width: 100%` is a scaling rule for scaled charts; `DotPlot` is the only 1:1 chart under that class, and its clip is a kit trait. The kit should give `DotPlot` its own class (`.dotPlot { max-width: none }`) or drop `.chart` from it, and the page override goes. Minor 4, for the final triage.

## Deviations

- **C25's fixture keeps the engine in `covered_engines` — the brief's shape really was contradictory.** `censusBreak` (`lab-compare.ts:69-89`) runs first (`:96-97`, before the withheld arm at `:98`) and requires `engines ++ withheld ++ unmeasurable` to partition `covered_engines` as a set. The brief's fixture (`covered_engines: [], withheld_engines: ["debt_manager"], engines: []`) names `debt_manager` outside an empty coverage → `extra: debt_manager` → `contradictory`, never `withheld`; the pin's `toContainText("withheld")` would have failed. The Task 7 reviewer's ruling (`task-7-review.md:92`) reads the contract the same way: a withheld engine is a covered engine (`openapi.yaml:5359-5363`, `positions_withheld`: "covered-but-WITHHELD engines"). The implementer's fixture (`lab.spec.ts:740-743`: demo `ethfi_minus_50` has `covered ["debt_manager"]`; set `withheld ["debt_manager"]`, `engines []`) partitions and is the shape the wire actually produces. ✅
- **The pins use `mockLab`'s counters and `setDelayMs`.** `setDelayMs` mirrors `runBookDelayMs` (`lab.spec.ts:80-85`). C24 asserts the exact posted body against `runbookSet.ts:258` (`JSON.stringify({ scenario_ids: [...] })`) ✅. The CORS reasoning is right: a test-level `page.route` registered after `mockLab` takes precedence and, answering the OPTIONS leg with a JSON 200 lacking the `POST_CORS` headers, would fail the browser's preflight; the helper answers OPTIONS via `preflight()` (`:35, :81`).
- **Is the in-flight pin deterministic?** There is no `waitForTimeout` in C24–C27. C26 is *bounded*, not race-free: everything from `button.click()` (`:782`) to the forced click (`:786`) must land inside the 600 ms delay (`:777`); if a slow host lets the response settle first, the button is enabled again, the forced click dispatches a real second POST, and `slow.sets()` (`:788`) reads 2. The precedent pin (`:235-247`, `runBookDelayMs: 600`) has the same window for its running assertions but no forced click, so C26 adds one failure mode. Minor 5, with a deferred-release route as the fix.
- The other deviations (union by arm; per-engine words; the freshness enum worded; "at batch N" instead of "today"; the pluralised running line; "No plot yet."; `dispatchNotice` retired; prettier on the two app files) are each correct and for the stated reason. Deviation 5 (the legacy plot's own measured frame) is the right intent with a wrong mechanism — Important 2.

---

## Strengths

- `rowsOf` is the honest shape the kit's union demands: the refused arm is unconditional, the point arm carries the lib's `bigint`, and the impossible null-share arm is a dashed track, not a zero. The `data-kind` a test sees is the kit's, derived from `tenths === null`, so a card cannot mislabel a row.
- The two books never meet: two word tables, two plots, two scales, and the fold says so in words the pin reads. The brief's own `rowsOf` would have printed "of the Cash book" beside a legacy figure; the implementer caught it against the Global Constraint.
- The freshness enum is fully enumerated in both `Record`s (`:85-98`), so a fifth wire arm would fail `tsc` rather than print a token.
- The `failed` arm prints the set-run failure's own headline through the existing `failureHeadline`, so the busy/no-batch/rate-limited/unreachable sentences stay pinned once, in `lab-headline`.
- C24 pins the row order two ways — against `compareRows(DEMO_RUN_BOOK_SET, "debt_manager")` computed in the spec *and* the literal list — so a ranking change in the lib and a rendering change in the card are both caught, and the demo figures are pinned to the character.
- C25 pins the refusal negatively (no circle, no `%`, no `$`, ranked last) — the "never a dot at zero" law in the form that would catch a regression.
- The `?scenarios=` non-write is the right call for the reason given; a false "NOTHING was run" notice is worse than an unlinkable comparison.
- No `any`, no non-null `!`, no narrating comments; the CSS comments state the law (`lab.module.css:14, :16`).

---

## Issues

### Critical

None.

### Important

**1. The set's membership law is gone: the card renders what the wire answered with no check against what was asked.** Trace and the contract reading are in Concern 3 above. `lib/lab-compare.ts` never reads `requested_scenario_ids`; `compareOf` (`lab-view.ts:234`) drops `set.ids`; the old R57 gate (`tornadoCells.ts:52-110`) and its pins (`tornado-lines.spec.ts:472-490`, `tornado.spec.ts:317, :364`) were retired without a ledger line (`progress-ui-overhaul.md:4450` omits them). C24 (`lab.spec.ts:706-713`) pins four rows for a two-id ask.
*Plan-mandated?* **Yes** — the brief's C24 (`task-13-brief.md:121-123`) pinned four rows for two ticks, the Task 7 brief gave `lab-compare` no membership arm, and "the card classifies nothing" forbids fixing it in the card. This is a controller ruling: reinstate the gate in `compareOf` (it has `set.ids` and `o.response`) or as `compareRows(set, engine, askedIds)` → a `failed` compare state naming the faults in the old law's sentences; then C24 asks for the ids the demo answers (or the mock filters to the ask), and a new pin drives the fault path. Not an implementer defect.

**2. The legacy plot's measured width is never attached in the primary paths — it renders at the 880 fallback.** `CompareCard.tsx:124-125` creates a second `useMeasuredWidth`; its frame (`:184`) sits inside `{ok !== null && legacyPoints && (…)}` (`:177`). The hook's effect reads `ref.current` once at mount and returns without an observer when it is null (`useMeasuredWidth.ts:49-51`); its deps `[min, max]` (`:75`) never change (`MEASURE` is a module constant, `:100`). The card mounts idle at two ticks (`LabSurface.tsx:321`) or idle/running under `?scenarios=` (ticks pre-set at mount, `:78`; the set dispatches later, `:130-147`), so the legacy frame mounts after the effect ran and is never measured: `legacyWidth` stays 880 whatever the frame's width. Only C27's remount path (address → book, `lab.spec.ts:798-803`) attaches it. Consequences: in the stacked layout and at 1366 the fold scrolls where it could fit; at 1440 it leaves a gap; the hook's 1:1 law (`useMeasuredWidth.ts:12-18`) is defeated for that plot. Unpinned — C24 opens the fold (`:722`) but pins no width.
*Plan-mandated?* **No** — the brief reused the Cash frame's `width` (measured); deviation 5 introduced the second hook. Fix: hoist the fold into its own component (`LegacyComparePlot`) whose frame exists at its own mount so the hook's ref is attached, or make the kit hook a callback-ref hook (a kit change, out of this task). Add a pin: after opening the fold, the legacy svg's rendered width equals its frame's content box (or, with the observer attached, is not 880 at a 1024-wide viewport).

### Minor

1. **Zero-share tone** (`CompareCard.tsx:79`) — `warn` per the brief; controller ruling (b) makes it `ok`. Expected in the fix round; not counted.
2. **`figures()` is built for refused rows and never rendered** (`:61` builds `valueText` for every row; `DotPlot.tsx:110` prints `note ?? valueText`, and a refused row always has a note), producing "— of the Cash book · —" strings for nothing. Worse for `no-denominator`: the wire published a real delta and flip count (`lab-compare.ts:122` carries `deltaText`, `newly`) and the row says only "no denominator". Either build `valueText` in the point arm only, or show the delta beside the word for the no-denominator kind.
3. **The 390 px pin covers the page, not the frame.** C24 `:734-736` proves no page overflow; nothing proves the frame scrolls rather than clips or that the svg's rendered width equals its `width` attribute. One `evaluate` on `lab-dotplot`'s `getBoundingClientRect().width === 480` and the frame's `scrollWidth > clientWidth` would pin the actual law.
4. **Kit ownership of the clip** — `DotPlot` is the only 1:1 chart under `.chart { max-width: 100% }` (`charts.module.css:4-8`); every other consumer has a `viewBox`. The kit should carry the exception (`.dotPlot { max-width: none }` or no `.chart`) and `lab.module.css:16-17` goes. For the final triage.
5. **C26's in-flight window is bounded by the 600 ms mock delay** (`lab.spec.ts:777-788`); a late forced click dispatches a real second POST and `slow.sets()` reads 2. Follows the file's precedent (`:235-247`) but adds a failure mode. A `setRelease` option (a deferred the test resolves after the forced click) makes both pins race-free.
6. **`none_servable` wording in the notice.** `CompareCard.tsx:153-155` says "the newest servable batch is not stated" when `newestServable === null`; the contract says null *exactly* in `none_servable` (`openapi.yaml:5513`) — nothing was servable, which the finding's parenthetical already says correctly (`:89`). Say "no batch was servable at probe time" in the notice too. Relatedly the id `lab-compare-superseded` names one arm for three; `data-freshness` disambiguates, acceptable.
7. **Tense.** "(still the newest)" (`:85, :113`) and "the newest servable batch is …" (`:151-152`), and `newest_is_older`'s "now older" (`:88`), speak in the present; the contract stresses probe time only ("never a promise about the reader's present", `openapi.yaml:5458-5459`; the fixture's own note). "still the newest" is the brief's wording — controller taste; "was still the newest when evaluated" / "the newest servable batch was N" would match the wire's own tense.
8. **The card carries no PROJECTION pill of its own.** The page's kicker names the *selected* scenario (`LabSurface.tsx:162-165`) while the card's figures belong to the compared set; the constraint is met at page level and the brief's code had no pill — controller taste, not a defect.
9. **Vocabulary duplicated between the lib and the card.** `KIND_WORD` (`CompareCard.tsx:30-36`) restates the lib's `reason` for withheld ("withheld", `lab-compare.ts:98`), not-covered ("not modelled", `:102`) and no-denominator ("no denominator", `:122`), then suppresses the duplicate at `:46`. The lib could publish each row's word; the card would then only add the engine name.
10. **The legacy fold is omitted when every legacy row is refused** (`:127-128`, `some(point)`), so an all-withheld legacy engine is silent in Compare. The brief's gate, plan-mandated; the single-run `LegacyResult` still says withheld. Recorded, no action.
11. **No unit pin for `rowsOf`** (the card's one law-bearing function: tone by sign, the note precedence, the null-share arm). The e2e pins cover kinds and circle counts; the arms are cheap to pin directly if the function is exported or moved beside the lib.
12. `.legacyInCard { margin-top: 12px }` is a literal (`lab.module.css:13`), consistent with the file's other literal spacing (`:5, :7, :10`); the kit has `--sp-*` tokens if the file is ever tokenised. No action.

---

## Assessment

**Spec compliance: ✅.** Every id in the contract's Compare row exists with the stated `data-kind`; the four `CompareState` arms render honestly and nothing classifies in the card; a refusal is a dashed row and no path reaches a dot at zero; the legacy shares are their own plot in their own words; the freshness enum is worded truthfully; the button law and the address-mode absence hold; the wire guards precede every `BigInt` in the lib and the card does no arithmetic; `dispatchNotice` has zero references; C24–C27 pin the laws with the demo figures to the character.

**Task quality: Needs work.** Two Importants. The first — the set membership law (asked ids vs. `requested_scenario_ids` vs. `results`) that the old Lab enforced and the contract calls "one line to check" is gone, and C24 pins the violating shape — is plan-mandated and needs a controller ruling, not an implementer change; it is recorded here so the close does not lose it a second time. The second — the legacy plot's `useMeasuredWidth` ref is attached after the hook's only effect has run, so that plot never measures in the normal paths — is the implementer's (deviation 5) and is a small, mechanical fix with one pin. The Minors are wording, a wasted string, two pin gaps, one kit-ownership item and the expected zero-tone line. With Important 2 fixed and pinned, and the zero tone changed, this is Approved.

---

## Re-review 1 (c92f4fd)

**Scope:** fix round 1 against `8249d6a` — Important 1 (the membership law), Important 2 (the legacy frame's measurement), the two look rulings (row words; measured zero → ok), the three Minors taken. Package `review-8249d6a..c92f4fd.diff`; `git show --stat c92f4fd` lists exactly the ten files named. Read-only; nothing run.

**RE-REVIEW: closed** — both Importants are answered in the lib and pinned at three levels; the residuals below are Minors for the fix list / final triage, none reopening the task.

### I1 — the membership law (`web/lib/lab-compare.ts:417-449`, `lab-view.ts:229-234`, `lab-headline.ts:466-467`)

✅ **Matches the old gate clause for clause** (`git show 9279806^:web/app/lab/tornadoCells.ts:52-127`), sentences verbatim: duplicated echo refuses first (`:420-424`, old `:70-82`); dispatched-not-named / named-not-dispatched (`:430-435`, old `:93-104`); a result twice / answered-not-requested (`:436-441`, old `:106-116`); requested-with-no-result (`:442-444`, old `:118-120`); `scenarios_evaluated` vs `results.length` (`:445-447`, old `:121-126`); deduplicated (`unique`, `:448`, old `:127`). One additive lead sentence, "asked N ids, the response names M" (`:425-427`), only when the lengths differ.
✅ **Matches the contract.** The asked ids are the authority (the old R57 reading); the echo is set-equal to them; the results name each requested id exactly once (the multiset law, `openapi.yaml:5531-5537`); `scenarios_evaluated == len(results)` (`:5487-5489`), and `== len(requested)` follows once the rest holds. `asked` cannot carry a repeat — `runBookSet` refuses one before dispatch (`web/lib/runbookSet.ts:242-245`). A matching body returns `[]` and `compareRows` runs untouched (`lab-view.ts:231-233`; unit pin "passes in any order", `lab-compare.spec.ts:826-828`). Order is not checked — the contract promises request order but the view ranks by share, so order is immaterial; the old gate did not check it either.
✅ **Run before anything is read**: `compareOf`'s ok arm gates on `set.ids` (the record's own asked list, `lab-library.ts:36`) and returns `failed` with `setMembershipHeadline(faults)` (`lab-view.ts:231-232`); the card renders that arm as it renders every failure (no card change for this). Pinned: unit `lab-compare.spec.ts:826-849` (4), `lab-view.spec.ts:938-953` (the exact dek), `lab-headline.spec.ts:888-895`; e2e C28 `lab.spec.ts:852-871`.
✅ **Ledger mirrored**: `progress-ui-overhaul.md:4448` carries the retirement line, naming the omission at `9279806`.

### The mock's shaping is honest, and C28 proves the seam

✅ `shapeSet` (`lab.spec.ts:76-79`): results filtered to the asked ids in ask order, the echo the ask itself, `scenarios_evaluated` the results' length. Every per-result body is unchanged, so the census law (`lab-compare.ts:69-89`) sees what it saw; `served_at`, `batch`, `evaluation.resolved_at/probed_at` are untouched, so the clocks hold; `coverage` is a census of the BATCH, not of the run (`openapi.yaml:5399-5401`), so it stays true whatever is asked, and nothing in the lib reads it (grep over `lab-compare`, `lab-view`, `runbookSet`, `lab-library`: none); `excluded_engines` and `notes` are batch-scoped. The shaped body is a body the lib has no other reason to refuse. `answerSet` passes an error envelope verbatim (`"results" in body`, `:81-82`) — the busy pin still gets its 503 body (`:803`); the superseded body (`:818`) has results and is shaped, keeping its freshness. One helper trait to know: an asked id the fixture has no result for would be echoed and refused as "was requested and has no result" — honest, and no current pin asks for one (every `?scenarios=` pin asks the two demo ids; `ghost` is filtered before dispatch, `:305`).
✅ C28 (`:852-871`): `setVerbatim: DEMO_RUN_BOOK_SET` for a two-id ask → `failed`, "The set does not answer the request.", "2 ids, the response names 4", both unasked ids named with the echo sentence, "Nothing from it is drawn.", no `lab-dotplot`, no rows, no "+4.5%" anywhere in `main`, the button freed, one POST. **On `8249d6a`** `setVerbatim` is unknown to `mockLab`, the route answers the same demo body, the view has no gate → `ok` → the first assertion is red. C24's re-pin to two rows (`:757`) is red on `8249d6a` (four rows). The unit pins import `setMembership` and `setMembershipHeadline`, absent at `8249d6a` → red.

### I2 — the legacy fold measures at its own mount

✅ `LegacyCompare.tsx:293-318`: the hook's ref is on a frame rendered unconditionally inside the component, so when `CompareCard` mounts it (`CompareCard.tsx:268`, only when a legacy point exists) the frame exists at the hook's first effect and the observer attaches (`useMeasuredWidth.ts:49-71`). While the `<details>` is closed the frame's content box is 0 (`raw <= 0` returns without setting, `:65`) and the observer measures on open. `PLOT_MEASURE` is a module constant (`:285`), so the `[min, max]` deps never change; the import runs one way (`CompareCard` imports from `LegacyCompare`).
✅ **The width pin is non-vacuous** (`lab.spec.ts:769-779`): at a 1024-wide viewport, after opening the fold, each plot's `width` attribute must equal its own frame's `clientWidth` clamped to `[480, 1280]`; the legacy frame's width is asserted `> 0` and its clamp asserted not `"880"` before the attribute is compared, so a fallback render cannot pass by coincidence; `toHaveAttribute` retries across the observer's async update. `frameOf` (`xpath=..`) is the `.plotFrame` div (no padding, so `clientWidth` is the hook's content box). At roughly 590 px the legacy columns fit (`LABEL_W` 160 floor + `valueW` 120 floor + `plotW` 310), so no in-frame scrollbar disturbs the measure. **On `8249d6a`** the legacy svg is 880 while the frame clamp is about 590 → red.

### `DotPlot` — minimal, kit-worthy, union intact (`web/components/charts/DotPlot.tsx:358-368`)

✅ `valueW = max(VALUE_W, longest(note ?? valueText) × CHAR_W + 16)` measures exactly the string the row renders (`:120`); `svgWidth = LABEL_W + plotW + valueW` equals the asked `width` whenever the columns fit (`plotW = width − LABEL_W − valueW >= 120`), so every fitting case renders as before, and only an overflowing case widens the svg for the frame to scroll. The value text's `x` (`px(plotW) + 8`) is unchanged, leaving 8 px slack after the text. The `DotPlotRow` union and the kit-derived `data-kind` are untouched; the `warn` tone stays in the union though no consumer uses it now. Consumers: `CompareCard`, `LegacyCompare`, the kit's re-export — no styleguide mount, no baseline. Pinned: C24 `:760-764` (the value box ends inside the plot box), `:791-793` (at 390 the plot keeps 480, the frame's `scrollWidth > clientWidth`, the page has no overflow).

### Look rulings and Minors taken

✅ Row words: "+4.5% · +$1.2M" (`CompareCard.tsx:95-96`), "of the Cash book" gone from the rows and pinned absent (`lab.spec.ts:758`); the caption keeps the book's name (`:170`). ✅ Measured zero → `ok` (`:138`). ✅ `figures()` for points only (`:134`). ✅ A refused row's note carries the delta when the wire gave one (`:91`; only `no-denominator` carries `deltaUsd`, `lab-compare.ts:122` — every other refused kind has null, so C25's "no `$`" for withheld still holds, `:793-794`). ✅ `none_servable` → "no batch was servable at probe time" (`:220`).

### Nothing else moved

✅ The ten files; in `CompareCard` the only other edits are the `BookWords` → `*_NOT_COVERED` simplification (the share denominator is now the caption's word) and `legacyPoints` derived from the built rows (`tenths !== null`, equivalent). `FRESHNESS_WORD`/`FRESHNESS_PILL`, the four arms, the ids, the button law are untouched. `web/scripts/screenshot-pages.mjs` (Task 14's, uncommitted in the tree) already shapes the set to the ask (`:61-64`), so the `labCompare` capture will render `ok` under the gate.

### Residuals (Minor; none reopen the task)

1. **`sentence()` capitalises a leading id or field name in the membership dek.** `setMembershipHeadline` runs `sentence(faults.join("; "))` (`lab-headline.ts:467`), which uppercases the first character (`:30-33`). The count sentence leads only when the lengths differ; on the duplicate-echo path (`lab-compare.ts:420-424`) and any equal-length mismatch (asked `[a,b]`, echo `[a,c]`) the first fault begins with a scenario id, so `eth_minus_30 …` prints as `Eth_minus_30 …` — not the id (`^[a-z0-9_]{1,64}$`, `openapi.yaml:5005`); likewise `evaluation.scenarios_evaluated …` becomes `Evaluation.…` when it leads. The pins all lead with "Asked …" and do not reach it. Fix: `terminated()` instead of `sentence()` for this dek, or a fixed lead clause. Take in the next fix round or the triage.
2. **`CHAR_W = 7` is an estimate** (`DotPlot.tsx:336`), now sizing the value column as well as the label column; the kit's own LF-8 law says column width is never estimated (`useMeasuredWidth.ts:82-91`, `useMonoCharWidth`). Pre-existing from Task 1, extended here; a long census note could outrun the 8 px slack by `(actual − 7) × chars`. Kit item for the final triage, with the `.chart max-width` clip.
3. **"no denominator · +$5" is unpinned** — the card's `noteOf` delta arm (`CompareCard.tsx:91`) has no unit or e2e pin; the report's string is by construction. One row in a `rowsOf` pin would close it (Minor 11 of the first review stands).
4. Result order against the contract's "in REQUEST order" is not checked; the ranking makes it immaterial. No action.
