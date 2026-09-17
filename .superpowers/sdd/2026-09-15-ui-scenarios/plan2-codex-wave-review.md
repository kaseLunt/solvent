# Plan 2 (Inspector) — Codex fix wave: scoped review

**Package:** `review-c92f4fd..14a5927.diff` (one commit, 13 files, +680/−51). **Report:** `plan2-codex-wave-report.md`.
**Method:** read-only trace of the diff against the untouched files it leans on (`wireGuard.ts`, `room-history.ts`, `pagination.ts`, `address-lookup.ts`, `inspector-headline.ts`, `lab-address.ts`, the generated schema, the demo fixtures, `InspectorSurface.tsx`, `screenshots.spec.ts` at the commit). Nothing run, nothing edited.

**Verdict: RE-REVIEW closed.** All eight rulings are addressed as ruled, minimal, and pinned by tests that fail on `c92f4fd`. The two deliberate extensions are honest and consistent with the Inspector's own headline register. Nothing outside the Inspector's 13 files moved; no PNG and no `--update-snapshots`; the 1440×900 baselines cannot have moved (trace below). Four follow-ups are named at the end — none is a defect of this wave.

---

## Fix 1 — all-unknowable projection is "Cannot say", never "No" — ADDRESSED

- **Lib holds the judgement.** `stressVerdict(row)` in `web/lib/address-stress.ts`: gate first (`!applicable` → reason; `flips === null` → cannot-say with no horizon), then a projection judged by its horizons only — `find(verdict === "unknowable")` before `find(verdict === "liquidatable")`, so an unknown-then-flip is still cannot-say naming the unknown horizon; otherwise `inside` through the longest (`reduce` over `seconds`, which by then have all passed the population guard because a refused duration was already turned into an `unknowable` verdict in `row()`). Spot rows speak through `flips`.
- **Words in the lib.** `stressVerdictWords` returns `{text, tone, title}`; `StressTable.tsx` only chooses pill vs titled span vs plain text. The old `flipsAt === undefined ? "No"` branch is gone.
- **Pin fails on c92f4fd.** Unit: `stressVerdict`/`stressVerdictWords`/`UNREADABLE_HORIZON` do not exist there → import fails. E2e: with `becomes_liquidatable: null` at index 0 the old table printed `"No"` (flips false, `flipsAt` undefined) → `toHaveText("Cannot say")` and `not.toContainText("No")` both fail.
- **Minimal.** The verdict-shape refactor is the ruling's own demand ("the judgement in the lib"). The `already` / `Not within` arms are the weighed extensions (below).

## Fix 2 — the drawer speaks the lookup's state — ADDRESSED

- `drawerEmptyText(view)` in `inspector-view.ts` switches on `view.state`: `no-position`/`legacy-only` → the old sentence; `cannot-compute` → `headline.emphasis` ("Cannot say — the Cash book is withheld this batch.") + "A withheld book is never “no position”; there is no calculation to show."; `loading` → "Looking up…"; default → emphasis + "There is no calculation to show." (`invalid` is unreachable — the surface does not mount the drawer in that state.)
- `InspectorDrawer.tsx` prints it under `inspector-drawer-empty`; the component composes no copy.
- Coverage of the ruling's three cases: `ADDRESS_UNKNOWABLE` → cannot-compute (unit); withheld Cash under `found` beside a legacy row → cannot-compute (unit); the e2e drives a `pageshow persisted` resume (`freshness.ts` classifies it "definitive" → `repair()` → `loadLookup({keepOnFailure:true})`) so the drawer stays open while the lookup flips to withheld, and asserts the withheld sentence and the absence of "No Cash position" / "nothing to calculate".
- **Pin fails on c92f4fd.** `drawerEmptyText` absent (unit import fails); e2e: the old arm printed "No Cash position in this batch; nothing to calculate." and had no `inspector-drawer-empty` testid.

## Fix 3 — the stress batch is the stress response's own — ADDRESSED

- `StressReading` carries `batchId: number | null` on all three arms, read once from `lookup.response.batch.id` through `isWirePopulation` (typed `unknown` so the guard is unavoidable). `InspectorView.stressBatchId` is named exactly so and is `stress?.batchId ?? null`.
- `stressBatchNote(view)` → `{disclosure, rowLabel} | null`: null when they agree or the stress has not answered; the ruling's sentence ("Stress for batch N; the position above is batch M.") plus one clarifying sentence when they differ; a "names no readable batch" disclosure when the guard refused the id. `StressTable.tsx` renders it as `role="note"` (`inspector-stress-batch`) and stamps `rowLabel` on every scenario cell.
- **Sides not compared across batches — confirmed by trace.** The table's "Room today"/"Room after" are `r.before.room`/`r.after.room` from the stress body; `flips` is computed inside `row()` from the stress body's two sides; `view.cash` is read only for the "Open Scenarios →" href. The only cross-response read is the money *scale* (`moneyFor(view.decimals)`, the lookup's `value_decimals`): the stress body carries no USD scale of its own (`StressState` has none; only `Shortfall.usd_decimals`), so this is the wire's design, pre-existing, identical on the Scenarios page, and not a comparison of figures.
- **Pin fails on c92f4fd.** Unit: `.batchId` undefined → `toBe(1)` fails; `stressBatchId` undefined; the existing `toEqual({kind:"rows",rows:[]})` pin was updated to include `batchId: 1`. E2e: `inspector-stress-batch` absent → `toHaveAttribute("role","note")` fails.
- **Extension weighed — a guard-refused `batch.id` treated as null and disclosed, not thrown.** Acceptable. The rest of `deriveInspectorView` throws on the lookup's and the history's `batch.id` via `readWirePopulation` (the route boundary is the refusal arm there), so the view now holds two postures for one field class; but `wireGuard.ts` documents exactly this split — "surfaces that DO hold a scoped refusal arm classify with the predicates directly" — and the stress section now holds one (the note + row labels). The reader is told there is no batch to attribute the rows to, which satisfies "a figure shown for the batch it names" in the only way a nameless batch can be. Pinned (`-1`, `1.5`, `-0`, `NaN` → null; the disclosure asserted verbatim). If the controller prefers the throwing posture it is a one-line flip, as the report says.

## Fix 4 — the headline's streak is the lookup's batch's own — ADDRESSED

- `streakOfThisBatch = historyBatchId !== null && historyBatchId === batchId ? streak : null`; only `cashHeadline` receives it. `view.streak` is unchanged, so the History card's `historyFinding` still says the run with its vantage clause.
- **The gate is equivalent to the ruling's "history's last batch".** `known` is seeded with `historyBatchId` before `roomSeries(engine, [...known])`, and `roomSeries` sorts ascending and takes the last point as `newest`; under the contract every point's `batch_id ≤ h.batch.id`, so `newest.batchId === historyBatchId` always (a vantage with no row is a `no-row` gap that zeroes the streak). So "vantage === lookup batch" is "newest point === lookup batch".
- **Pin fails on c92f4fd.** The old `cashHeadline(cash, {streak, floor})` printed "for the last 3 batches (≈2m)" for lookup 4 / vantage 2 → `not.toContain("for the last")` fails; the pre-existing near-cap test's assertion (lookup 3, vantage 2) encoded the defect and was flipped with a comment stating the law — disclosed in the report.

## Fix 5 — `horizon_seconds` guarded — ADDRESSED

- `horizonLabel` returns `UNREADABLE_HORIZON` ("—") unless `isWirePopulation(seconds)` — before any `<`, `%`, or `/`. `row()` sets a refused duration's verdict to `"unknowable"` regardless of the wire's boolean, so `stressVerdict` makes the row a cannot-say naming it, and `stressVerdictWords` titles it "a horizon with an unreadable duration carries no verdict" (the title branch re-checks the guard before calling `horizonLabel`, so no "the — horizon" is printed on the Inspector).
- **Pin fails on c92f4fd.** Old arithmetic: `60.5` → `(60.5 − 0.5)/60` → "1m"; `-1` and `-0` → "<1m"; `NaN` → falls through to "NaNd"; the unit pins expect "—". The `STRESS_DM` mutation with `horizon_seconds: 60.5` expects verdict `"unknowable"` where the old `row()` kept the wire's `false`.

## Fix 6 — a refused `value_decimals` refuses every USD figure — ADDRESSED

- `collateralTable` reads `cash.decimals` (the reader's guarded scale: `isWireScale(position.value_decimals) ? … : null`, line 65 of `inspector-position.ts`); when null, `value` and `contribution` are null per leg → `ltv` null (`value === null || contribution === null` guard) → both sums null → `capAgrees`/`collateralAgrees` null (so the "legs sum to … the engine's figure leads" line cannot print a contradiction) → `usdRefusal` names it once. `amount` (leg's own scale) and `price` (input's own scale) still read.
- `BackingTable.tsx` prints `usdRefusal` under the table (`inspector-backing-refusal`); the LTV cell already printed `leg.ltv ?? "—"`, and the total row's `money(cash?.collateral)` / `money(cash?.cap)` are "—" because the reader nulls those figures with the scale. The drawer's formula prints `exactMoney(l.value)` → "—" and `l.ltv ?? "—"`.
- **Pin fails on c92f4fd.** Old code: `value = wireInt("100")`, `contribution = wireInt("50")` → `ltv: "50%"` → `toBeNull()` fails; `usdRefusal` undefined.

## Fix 7 — a pagination failure beside its rows — ADDRESSED

- `activityEmptyText(loading, error)` (the words the component composed inline, now in the lib) and `activityFailureText(error)` in `activity-rows.ts`. `ActivityTable.tsx` renders `<p role="status" data-testid="inspector-activity-error">` when `error !== null && rows.length > 0` (`rows` is the same array the table's `kitRows` derive from), so the sentence is never doubled with the empty words.
- **Hook trace.** `useCursorPages.loadMore` on rejection: `setError`, `setLoading(false)`, `controllerRef = null`; rows, cursor, and `hasMore` untouched → the six rows stay, "Load more" stays enabled, and the next `loadMore` clears the error first. Matches the pin.
- **Pin fails on c92f4fd.** `activityEmptyText`/`activityFailureText` absent (unit import fails); e2e: with rows present the old table showed nothing about the failure (the empty text prints only with no rows) → `inspector-activity-error` absent.

## Fix 8 — the History sentence speaks from the streak and the newest point's own band — ADDRESSED

- `historyFinding` reads `view.room.newest` and `view.streak`: zero-cap newest → the refusal sentence, plus "; under the 10% line for the last N batches" when the run is ≥ 2 (`underLine` counts a zero cap as under, so the run is real); any other non-computed newest → the pre-existing "is {kind}; the streak cannot be read"; run ≥ 2 → the pre-existing streak sentence; run of exactly 1 → "Within 10% of its cap in the newest batch" + what ended it (`points[length − 2]` is the batch before, points being ascending; a computed prior not under the strict `< 10%` line is "above the line" in the repo's existing convention; a non-computed prior is named by kind; no prior → "the only batch in the window"); "Room has stayed above the 10% line" only for a computed newest outside any run — true by `underLine`'s own rule.
- **Pin fails on c92f4fd.** Old code: streak 1, newestKind computed → fell through to "Room has stayed above the 10% line in the newest batch" for the Codex inputs (80M then 95M debt on a 100M cap) → `toBe("Within 10% … the batch before was above the line …")` fails; the lone zero-cap point likewise printed "above the line" (newestKind `zero-cap` was exempted from the "cannot be read" arm and streak was 1).

---

## The deliberate extensions

**"Already liquidatable" (spot row liquidatable on both sides) and "Not within 90d" (a holding projection).** Honest, and consistent with the Inspector's own headline words: the headline says "Liquidatable now — …" for such an account and "Not liquidatable yet." for a near one; under a column headed "Becomes liquidatable?", "Already liquidatable" (crit, titled "liquidatable before the shock and after it") and "Not within 90d" (plain, titled "a projection speaks only through its longest horizon") are answers to that question in the same register. `already` is reachable only when `flips === false && after.verdict === "liquidatable"`, which implies `before` liquidatable — so the word is never a guess. The old "No" in both cases was the same class of untruth the ruling names.

Note for the Scenarios owner: the verdict *shape* mirrors the lab's `rowVerdict` exactly (same kinds and fields), but the *words* differ from the lab's `rowOutcome` ("Liquidatable today and after", "Stays inside its cap through 90d", "Becomes liquidatable within 90d") — by design, because the lab's library word is a standalone outcome while the Inspector's cell answers a question. Both are honest; a shared word list is a follow-up, not a defect.

## Laws

- A refusal never renders as zero/"No"/"no position": every new refusal arm prints a titled "Cannot say", "—", "withheld", or a disclosure; the one remaining "No" is a measured non-flip with both sides readable. ✔
- Wire values guarded before arithmetic: `horizon_seconds` (population) before `<`/`%`/`/`; stress `batch.id` (population) before `groupInt`; `value_decimals` (scale, via the reader) before any USD figure or ratio. ✔
- A figure shown for the batch it names: the stress rows wear the stress batch when it differs; the headline's streak is claimed only of the lookup's batch. ✔
- Copy in the libs: `stressVerdictWords`, `stressBatchNote`, `drawerEmptyText`, `activityEmptyText`, `activityFailureText`, `USD_SCALE_REFUSED`, `historyFinding` — the four components compose no sentences. ✔
- Comments state the law: each new branch carries one. ✔

## Scope, snapshots, baselines

- `git diff --name-status c92f4fd 14a5927` = exactly the 13 files in the report; no file under `web/app/lab`, `web/lib/lab-*`, `web/components`, or CSS. No `.png` in the commit; no `--update-snapshots` claimed or needed.
- **Behaviour that reaches the lab through shared libs (no lab file changed):** `horizonLabel` (imported by `lab-address.ts` and `lab/AddressWorkspace.tsx`) now prints "—" for a refused duration, and `stressReading` (the lab's rows come from `view.stress`) now marks such a horizon `unknowable`, so the lab's `rowVerdict` yields `horizon-unknowable` and its `rowHeadline` reads "The — horizon carries no verdict." — honest and in the law's direction, but the Scenarios owner should know the sentence now has that shape.
- **1440×900 pixel baselines (`inspector-dark.png`/`inspector-light.png`) cannot have moved — trace.** The capture is viewport-only (`toHaveScreenshot` with `mask` only, no `fullPage`). In the pinned near state: `DEMO_ADDRESS_NEAR.batch.id = DEMO_HISTORY_NEAR.batch.id = DEMO_STRESS_NEAR.batch.id = 18251`, so fix 4 passes the same streak to the headline as before (vantage === lookup; the run is 14 batches, 18238–18251, newest computed), fix 8 takes the same `run ≥ 2` branch and prints the identical sentence, and fix 3 prints no note and no row labels; the demo's `value_decimals` is 6, so fix 6 prints no refusal; the demo events carry no failure, so fix 7 prints nothing. The only visible change is the projection row's last cell ("No" → "Not within 90d"), in the stress section, which is the last section in `InspectorSurface` — after the site header (56 px), toolbar, verdict header, tiles, the backing/trust grid, the History card (two 140 px charts), and the six-row activity table (th 36 px + 6 × ~38 px + takeaway + button). The existing e2e pins the backing table's top under 900 px; everything below it that precedes the stress section sums to well over 900 px on its own, so the changed cell sits far below the fold.

## Follow-ups (not open items of this wave)

1. **A projection with an empty `horizons` list** is collapsed by `row()` into `projection: null` (while `projectionNote` is kept), so both pages judge it as a spot shock and print "No" / "Stays inside its cap" — a neighbour of ruling 1 the wave did not touch; the schema puts no minimum on `horizons`. Worth a `no-horizon` cannot-say at the `row()` layer in the Scenarios wave.
2. **Negative-figure gate.** The Inspector's `stressVerdict` gates on `flips === null` (missing/unknowable side); the lab's `rowVerdict` also refuses unreadable/negative figures as `not-a-position`. The same row can be "Yes"/"No" here and "Cannot say" there. Disclosed by the implementer; one place to add it.
3. **Two judges over one `StressRow`.** `stressVerdict` and the lab's `rowVerdict` are now near-duplicates and can drift; folding the lab onto `stressVerdict` (plus the lab's `not-a-position` cause) is the natural Scenarios follow-up.
4. **Resume moves the lookup, not the stress** (`keepOnFailure` refresh does not bump `epoch`), so after a resume the stress can legitimately trail by one batch — which fix 3 now discloses rather than hides. Whether the resume should replay the stress is the owner's design call, as the report says.
