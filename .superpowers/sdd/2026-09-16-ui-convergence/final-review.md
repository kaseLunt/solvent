# Whole-branch review — Plan 4 (UI convergence), `a941a39..d1cab73`

Reviewer: whole-branch, read-only. Read at `d1cab73` (the working tree's `web/` and `docs/` equal it; the one later
commit, `5840b57`, adds only `web/tests/e2e/keyboard.spec.ts` and is outside the range). Nothing was built, run,
started or killed. The ledger was read in full first; nothing on its "→ TASK 12 FIX WAVE" or "OWNER'S LIST" is
re-reported below — where a finding sits beside a known item, the known item is named and only the difference is
reported.

## Verdict

**READY TO CLOSE AFTER THE FIX WAVE — with five Important items added to it. No Critical.**

No honest-UI law is broken on a reachable steady state: no refusal, withheld, absent or unloaded value renders as a
zero, "No", "none" or absence on the four converged pages; Cash and the legacy market are never summed, compared in one
figure or put on one axis; every arithmetic path added by the branch is behind a wire guard; `humanUtc` never touches a
clock or a zone and returns a malformed instant verbatim. The five Important items are seams no per-task reviewer could
see: a transient false sentence on Verification while its reads are in flight, the styleguide left teaching the tone
usage the gate overruled (with no pin on the new law's colour), three History arms that are pinned but cannot be
reached on the page, one public number printed from two unwelded lists, and a public fact claim whose enforcing test CI
does not run. The plan document's contract table is stale in nine places (listed at the end).

## Findings

### Critical

None.

### Important

**I1 · Verification says a read FAILED while it is still in flight.** `web/lib/verification-view.ts:251,253`
(`COMPUTE_UNREAD`, `VERIFY_UNREAD`), chosen at `:301` and `:340`; printed unconditionally at
`web/app/proof/VerificationArchitecture.tsx:50-54`. `pipelineSteps` has two arms for a missing book — the wire's 503
(`no-batch`) and everything else — so `reading.phase === "loading"` and `evidence === null`-because-unfetched both print
"The batch could not be read." / "The receipt could not be read." The `pending` prop (Task 5) covers the TILE only
(`…` under `aria-busy`); the sentence under it is always rendered. While `/v1/book` or `/v1/evidence` is slow or hung the
page states a failure that has not happened — the same class Task 5's I2 closed for "absence vs unread", one state
over. (The ledger's known register note is the tile's sub "unavailable" beneath `…`; the sentences are not on any list.)
Smallest fix: in `deriveVerificationView`, a step whose reader has not answered takes a reading sentence
("Reading the batch…" / "Reading the receipt…") and the sub `pending` — `book.phase === "loading"` for compute,
`state.phase === "loading"` for verify; `pipelineSteps`' `line` fields (the Overview's) do not move. ~8 lines + 2 unit
pins. Seam: Task 5 round 1 (I2) × the component-level `pending` prop.

**I2 · The styleguide still teaches the tone usage the gate overruled; the new law's colour has no pin.**
`web/app/styleguide/page.tsx:188` ("four tones"), `:204-215` (warn specimen: the retired dek "Two subjects, never one:
the pinned proof and the live batch.", `Live batch #18251`), `:216-227` (`sg-verdict-ok`: a HISTORY RECORD —
"Debt held near $9.10M…", chip "Holes 2 absent · 1 withheld" — under `tone="ok"`, which is precisely the design
ruling's overruled case: "paints History's '2 absent, 1 withheld' in the colour of health"). There is no `neutral`
specimen. `web/tests/e2e/p1a-fixes.spec.ts:247` loops `["crit","warn","ok","refused"]`, so no pin computes that a
neutral emphasis is `--ink`: the four page specs assert only `data-variant="neutral"` (an attribute), and
`web/tests/unit/kit.spec.ts:200-218` is a type-level pin whose runtime assertions are tautologies (it says so).
Deleting `.emNeutral` or pointing it at `--ok-text` fails nothing but, perhaps, a 1%-tolerance pixel pin.
Controller ruling on record (Task 7): "the living canon follows the product". Phase 0's brief said a specimen was
"NOT required this phase"; nothing picked it up afterwards, and the Verification/API gate report's "stale specimen
words … not mine" was not carried to either list. Smallest fix: move the History specimen to `tone="neutral"` with the
page's final words, make `sg-verdict-ok` a true health verdict (the Verification accepted arm), refresh the warn
specimen's dek/chips, heading "five tones", and add `neutral → --ink` to the p1a loop. Seam: Task 7 × gate Phase 0 (S1).

**I3 · Three History arms are pinned but unreachable on the page; a malformed debt still ends at the route boundary.**
`web/lib/observatory-series.ts:581-591` ("The latest hour's debt figure cannot be read, … Unreadable is not zero."),
`:632-636` ("debt unreadable at one end"), `web/lib/history-view.ts:179-180` (the dashed "unreadable" tile). The gate
report (History, concern 4) says the throw is gone "because `wireBigInt` returns null". It is not: `deriveHistoryView`
builds the tiles in the same call (`history-view.ts:265` → `tileOf` → `buildMetricSeries` `:172` →
`geometryOf` `observatory-series.ts:200` → `formatUnits` → `parseDecimal` throws), and `displayMetric`
(`:193`, `renderUsdAmount` → `formatUnits`) throws again for the labels and the record. Every pin of these arms calls
`observatoryTakeaway` / `gridReadingLine` directly (`observatory-series.spec.ts:475-476, 633-634`); none goes through
`deriveHistoryView`, so the suite asserts a behaviour the page cannot show. The route boundary is an honest arm, so no
law breaks — but the page's own comment (`history-view.ts:240-242`) promises a named refusal "instead of unmounting",
and for a malformed decimal it still unmounts. Smallest fix, either way with one `deriveHistoryView`-level pin on a
malformed `debt_usd`: (a) `geometryOf` and `displayMetric` read money through `wireBigInt` first (a null → the gap /
the em dash with an "unreadable" word), ~10 lines; or (b) keep the boundary as the law, delete the three arms and
their pins' claim. Seam: Task 3 (the series builder's throwing posture) × gate round · History.

**I4 · One public number, two unwelded sources.** `web/lib/verification-view.ts:102-120` (`PUBLIC_ENDPOINTS`, "a
mirror of the API page's operations … 17 today") feeds Verification's Serve tile and sentence and the Overview's
pipeline; `web/lib/api-view.ts:127,138` counts `OPERATIONS`. The only pin is the literal
`expect(PUBLIC_ENDPOINTS).toHaveLength(17)` (`web/tests/unit/verification-view.spec.ts:163`). Add a route to the
contract and the fidelity gate forces the extract to regenerate: the API page says 18, Verification and the Overview
keep saying "17 read-only endpoints", and every pin stays green. The two lists agree today, member for member and in
order (checked). Smallest fix: one unit pin —
`expect([...PUBLIC_ENDPOINTS]).toEqual(OPERATIONS.map((op) => \`${op.method} ${op.path}\`))` (the unit project may
import both; the bundle concern is the app's only). Seam: Task 5 (the move into the lib) × Task 6.

**I5 · A fact claim on the API page rests on a test CI does not run.** `web/lib/api-view.ts:93`: "Every sample below
is the contract's own example … or a committed client fixture validated against it". The validation is
`packages/client-ts/test/fixtures.test.ts`; `.github/workflows/ci.yml:87-105` installs client-ts and runs only web's
`npm run test:e2e` — no client-ts test step exists. The sentence is true of a test that exists and passes locally; a
fixture can drift from the contract with CI green and the page goes on saying "validated". The implementer flagged
this (gate report Verification/API, concern 6); it reached neither list. The third sentence ("A CI test re-reads both
and fails if this page's extract has drifted") IS licensed — the fidelity spec runs in CI and compares the extract to
the contract and the cited fixtures. Smallest fix now: drop "validated against it" → "a committed client fixture, cited
beside each" (one clause + its unit pin); or OWNER'S LIST: a client-ts test step in `ci.yml`, after which the sentence
stands as written. Seam: gate round · API (reconciliation 6) × CI.

**I6 · The plan's page-test contract table and five rulings no longer describe the code.** Nine lines; listed under
"Plan-doc lines to update". Doc-only; the specs are right and green.

### Minor

- **M1 · Accepted receipt with zero gated rows.** `web/lib/evidence.ts:782`: "All 0 checked rows matched the chain
  exactly," under `ok`. `deriveProofSubjectStatus` accepts 0/0 with no welds. Probably unreachable from the real
  reconciler (`cmd/reconcile/main.go:604-614`: a small-sample taint makes the run non-pass) — not verified. Fix: a
  `rows === 0` arm worded as no finding, tone `warn`; one pin. Gate round · Verification.
- **M2 · Orphans this branch made.** `liquidationEstablished` (`web/lib/feed-view.ts:333`; last consumer was
  `FeedList.tsx`; its doc comment `:325-332` describes a fold that no longer exists); `proofTakeaway`
  (`web/lib/evidence.ts:800`; the page composes the arms — pin-only); whole modules `web/lib/coverage.ts` and
  `web/lib/stream-posture.ts` (last importers `Ribbon.tsx` / the styleguide's Ribbon specimens — Task 7's M2 names two
  constants of the second, not the modules, and not `coverage.ts`); `ActivityInput.loading`
  (`web/lib/activity-view.ts:74`) is passed and never read. Same treatment as M3 of Task 7 (the unit count may not
  drop): decide per module. Tasks 4, 5, 7.
- **M3 · Duplicates the ledger does not list.** (a) `retry` (`lab-headline.ts:166`) = `retryWords`
  (`verification-view.ts:168`), word for word — Task 5's review said "fold into one export", the blocker (Task 9's
  file) is gone, never carried. (b) The engine-in-a-sentence function ×3 with TWO phrasings: `named`
  (`observatory-series.ts:432`) and `modelled` (`lab-headline.ts:144`) are one predicate → "the Aave v3 market
  (legacy)"; `proseEngine` (`activity-view.ts:240`) → "the legacy Aave v3 market"; `DEBT_OF` → "legacy Aave v3 debt".
  One home in `prose.ts` with the `plural` lift. (c) The proof card's rows are written twice — `verification-view.ts:428-481`
  and the drawer's descriptor in `evidence.ts` ("ACCEPTED · every gated row welded exact", `REJECTED · …`, the seizure
  model row). (d) "all actions" / "liquidations ledger": `ActivityControls.tsx` button text and
  `activity-view.ts:638` chip. (e) `?? "bad_request"` ×3 — `activity-view.ts:355,369`, `ActivitySurface.tsx:297` (a
  code the service did not state, printed as its code). (f) "N read-only endpoints, every money value a decimal
  string" (`verification-view.ts:367`, `API_INTRO`) vs "…an exact decimal string" (`api-view.ts:128`).
- **M4 · Comments that state a law the code no longer keeps.** `observatory-series.ts:277,326-345,350`,
  `ObservatorySeriesChart.tsx:21,74,389`, `HistoryChart.tsx:8-11`: "the summary card's exact string — one source" and
  "the panel head's as-of line" — the tiles print the compact tier (`humanUsd`) and no panel head exists; the chart
  label and the tile now share a wire row, not a string. `r1-fixes.spec.ts:131-140`: says the H1 is `proofTakeaway`
  and quotes four deks "pinned verbatim" that no longer exist on any page (flagged in the Verification/API gate report,
  not carried). `activity-view.ts:246-247`: "prints as typed, never re-rounded" — the value has already been through
  `Number()` (`ActivitySurface.tsx:204`). `verification-view.ts:682`: "in the words the stampline printed".
- **M5 · Comments that name a ruling, a task or the page's history.** Ruling numbers the gate then reversed:
  `activity-view.ts:1` and `verification-view.ts:1`, `verification.spec.ts:1-2` ("plan R1–R5"); "(the R1 clarity
  ruling)" at `api-view.ts:45`, `verification-view.ts:125` (wave R1, ambiguous beside the plan's R1); `(plan R2..R6)` at
  `LabTiles.tsx:24`, `HistoryChart.tsx:3`, `HistoryDrawer.tsx:9`, `HistoryPoint.tsx:1`, `HistoryTiles.tsx:6`,
  `VerificationArchitecture.tsx:22`, `VerificationDrawer.tsx:26`, `history-view.ts:93,125,275,289`. Tasks:
  `p1b-fixes.spec.ts:120` ("Task 3"), `fixture-clock-law.spec.ts:277,330,657` ("Task 2", "plan 4 Task 2"),
  `r1-fixes.spec.ts:131,135`. History-telling: `VerificationDrawer.tsx:26` ("used to print inline"),
  `verification-view.ts:125` ("drawer doctrine now"). The `(plan 2026-09-16, R7)` retirement notes in the shared
  specs are the test policy's one-line ledger notes and stand.
- **M6 · The Overview ignores the step's tone.** `web/app/overview/Pipeline.tsx:43-51` reads `key`, `ordinal`, `line`
  only; Task 10's I3 ruling was "withheld under the refused tone on `/proof` AND `/`". On `/` the words are right and
  the register is plain. Beside W-census, not inside it.
- **M7 · Copy composed in components, not previously listed.** `HistorySurface.tsx:149` ("How the book moved");
  `ActivitySurface.tsx:246,254` (tile labels), `:290,297,312` (strip heads), `:305,315,338` (button words);
  "Methodology & evidence" typed in three drawers (`HistoryDrawer.tsx:22,24`, `ActivityDrawer.tsx:19,21`,
  `ApiDrawer.tsx:18,20`) while Verification reads `VERIFICATION_COPY`; `ActivityTable.tsx:16-22` (the extract's
  connecting words).
- **M8 · Doctrine paragraphs keyed by their own text.** `HistoryDrawer.tsx:27`, `ActivityDrawer.tsx:24`,
  `ApiDrawer.tsx:23`, `VerificationDrawer.tsx:65`. History appends the wire's `notes`: a repeated note is a duplicate
  React key. Key by index.
- **M9 · Abort asymmetry.** `VerificationSurface.tsx:62-64`: the evidence `.then` sets state without the
  `controller.signal.aborted` check its two siblings (`:81,91`) and its own `.catch` carry.
- **M10 · `data-receipt="none"` while loading and unavailable** (`verification-view.ts:761,778`). `none` is documented
  as "no committed receipt" — an absence the wire did not state, in a contract attribute. Say so in the contract, or
  add a value.
- **M11 · Two import paths for one component.** The four converged pages take `Drawer` from the kit;
  `BookMethodology.tsx:4`, `InspectorDrawer.tsx:4`, `AssumptionsDrawer.tsx:3` still import `@/components/Drawer`.
- **M12 · Retirement leftovers Task 7's M2 misses.** `web/app/tokens.css:123,141,150` (comments: "stampline",
  "stats, tablewrap"); `web/README.md:21` still calls the routes "the six routes (W0: honest placeholders…)" and omits
  `/proof` and the Overview; the README's law list lacks the tone law the gate made ("a record is ink; `ok` means
  health only"). All other hits for the 29 deleted names are on M2's list.
- **M13 · Internal vocabulary in the PAGE's own words** (same class as the owner's-list item about the service's
  message): `history-view.ts:111` ("migration 00016"), `:388` ("migration 00018"), `:104` ("observatory_points
  rollup"). Drawer and record only. Owner's list.
- **M14 · An orphan fragment in Activity's drawer.** `activity-view.ts:660`: the doctrine array carries the list's
  TITLE ("Recorded chain actions") as a paragraph — a sentence before A7 renamed it.
- **M15 · Unguarded prints carried into the lib.** `verification-view.ts:159-160` `n()` prints any `number` through
  `toLocaleString` (chips, tiles, sentences, the Overview's line); `receiptReadable` guards the TONE only. Carried
  verbatim from the old `Pipeline.tsx`; print-only, no arithmetic. `proofCard` `:436,442` likewise (`String(...)`).

## What was checked and found clean

- **Type members, every consumer.** `neutral`: `VerdictHeader`'s `EM_CLASS` is exhaustive; every page passes the
  lib's tone straight through; `OverviewSurface.tsx:31` indexes a different union (the Book headline's) and is
  unaffected; `LabTiles` derives its own tile tones. Only the styleguide and its pin lack the member (I2).
  `refused-locally`: `failureOf` and the compare arm (`lab-view.ts:253,286`), `FAILURE_WORD` (`lab-library.ts:70`, an
  exhaustive `Record`), `failureHeadline`; no pin enumerates book states; the Scenarios plan is updated in the range.
  `Band.count: number | null`: two builders (`BookSurface.tsx:34`, `BookLegacy.tsx:17`), one reader (`BandBars`), no
  styleguide specimen existed before or after. `lookupRepaired`: one producer, one reader
  (`inspector-view.ts:219`), the lab through `stressBatchNote`. `pipelineSteps`: two callers, both three-argument; no
  `cashAccounts` survives anywhere.
- **History's deltas.** Both ends through `wireBigInt` (→ `isWireDecimal`) or `readWirePopulation` before the one
  subtraction; one response, one `usd_decimals`, itself behind `isWireScale` before `gridReadingLine` is called; the
  ends are the first and last CAPTURED rows (`!refused`, `point !== null`), so a withheld or absent hour is never an
  operand; a null end prints "not stated at one/either end, so no change is given"; a sub-cent delta prints
  `<$0.01`, never `$0`.
- **Activity's dek.** Counts rows only (`engineSplit`, deficits, untimed); no amount is read, let alone added; an engine
  outside the two is counted as such. `tailKeepsItsOrder` is computed from the loaded rows on every render (the dek and
  the notice both call it) and the "listed last" clause yields to `orderViolated`.
- **`humanUtc`.** Regex over the string's own fields; no `Date`, no `Intl`, no locale; month/day/leap/hour/minute/
  second range-checked; anything else returned verbatim; the NBSP constant is U+00A0 by bytes (`c2 a0`). Its three
  callers pass the envelope's own `served_at` as the reference year.
- **Contract emission.** Every id in the table is emitted except `api-base-url` (retired, pinned `toHaveCount(0)`);
  the four `data-state` vocabularies and `data-receipt` match the view types. Every `getByTestId` in the shared specs
  (state-matrix, shell, p1a, p1b, r1, screenshots; 88 ids) resolves to a literal or a template in the final source; no
  positive assertion on retired words can exist (the final tree ran 242/0); the shared specs' negative assertions were
  each read and each can still fail.
- **Tests as a whole.** Unit spec files 71 → 81, none deleted; per-file `test(` counts for all 27 touched files are
  equal or higher (`fixture-clock-law` 18 → 18, `lab-compare` 10 → 10, every other up); no `.only/.skip/.fixme`. Source-text
  pins added: `demo-secondary-weld.spec.ts:350` (can fail: key-set equality + counts) and `lab-address.spec.ts:426`
  (known, W-pin).

## Triage

| Finding | Disposition |
|---|---|
| I1 Verification's "could not be read" while loading | fix now in the wave |
| I2 styleguide neutral specimen + the tone loop | fix now in the wave |
| I3 History's unreachable unreadable-debt arms | fix now in the wave — controller picks (a) guard the builders or (b) delete the arms |
| I4 `PUBLIC_ENDPOINTS` ↔ `OPERATIONS` weld pin | fix now in the wave (one pin) |
| I5 "validated against it" not CI-gated | fix now by wording, OR owner's list (a client-ts step in `ci.yml`) |
| I6 plan-doc contract lines | controller, at close |
| M1 zero gated rows | fix now (5 lines) or no action if the reconciler cannot emit it — owner's call |
| M2 orphans | wave: `liquidationEstablished`, `ActivityInput.loading`; owner's list: `coverage.ts`, `stream-posture.ts`, `proofTakeaway` (pin counts) |
| M3 duplicates | wave, with the `plural` lift (a, b, e); no action (c, d, f) |
| M4 stale law comments | fix now in the wave (comment-only) |
| M5 ruling/task names in comments | fix now in the wave (comment-only) |
| M6 Overview ignores `tone` | wave, with W-census |
| M7 copy in components | owner's list |
| M8 paragraph keys | fix now (4 one-liners) |
| M9 abort asymmetry | fix now (one line) |
| M10 `data-receipt="none"` while unread | contract wording (I6) |
| M11 Drawer import path | no action (or one-line sweeps in the pruning wave) |
| M12 tokens.css / README | wave (pruning) |
| M13 migration numbers in page copy | owner's list |
| M14 title as a doctrine paragraph | fix now (one line + the drawer pin) |
| M15 unguarded prints | owner's list |

## Plan-doc lines to update (`docs/plans/2026-09-16-ui-convergence.md`)

1. **:22** (Global Constraints) "Every page's H1 is its nav label" → the H1 is the page's computed headline; the nav
   label is the kicker's first word.
2. **:28 R1** Activity's kicker is `Activity · all engines` / `Activity · {engine}`; API's is
   `API · contract v{version}`.
3. **:29 R2** overruled at the gate: emphasis + rest in the Book's grammar; `neutral` for a statement of record,
   `refused` for every non-answer; only Verification's proof finding wears tone (`ok` exact, `warn` otherwise,
   including accepted-receipt/no-batch = `ok`); History's headline/dek are `observatoryTakeaway`'s parts, the finding
   is `gridReadingLine(response, axis)` (deltas, no metric).
4. **:30 R3** the four dek clauses are gone from the deks (computed fact sentences now); the doctrine is in the
   drawers, not verbatim for History and Verification.
5. **:31 R4** Activity's rows tile sub is `more available` / `end of the filtered feed`, the liquidations sub
   `among the loaded rows`; API's first tile is labelled `Endpoints`; History's default engine is Cash.
6. **:34 R7 and :70** `StatusChip` + `chip.module.css`, `ribbon.module.css`, `primitives.module.css` STAY.
7. **:45 History** chips `Engine | Stride | Range | Buckets | Served` when answered, `Engine | Buckets` loading,
   `Engine | Rollup` degraded, `Engine | Record` unavailable; `data-variant` ∈ `neutral · refused`;
   `history-kpi-*` `data-tone` ∈ `neutral · refused`; added ids `history-tiles`, `history-marks`,
   `history-chart-finding`, `history-chart-sparse`, `history-point-{takeaway,forensics,rates,rates-empty,rate-scale,
   epochs,sweep,batch,mkey}`; file list gains `HistoryChart.tsx`, `HistoryPoint.tsx` (:61).
8. **:46 Activity** chips `Scope | View | Order | Newest | Filter echo` (`Rows` retired, pinned absent; `Newest` and
   `Filter echo` conditional); `data-variant` ∈ `neutral · refused`; "dim" is the kit row's class, not an attribute;
   added ids `activity-order`, `activity-tail`, `activity-drift`, `activity-retry`, `activity-foot`, `activity-end`,
   `activity-account`, `activity-tx`, `activity-amount`, `activity-unit`, `activity-liquidation`,
   `activity-liquidator`, `activity-live-state`, `activity-live-{unavailable,batch,none,degraded}`, `activity-types`,
   `activity-types-note`, `activity-since-apply`, `activity-since-applied`.
9. **:47 Verification** chips `Proof pin | Live batch | Receipt | Batch key`; `data-variant` ∈ `ok · warn · refused`;
   `data-receipt` is `none` while loading/unavailable as well as for no committed receipt (M10);
   **:48 API** chips `Contract | Base URL | Source` (`Operations` retired); `api-base-url` retired (pinned absent);
   `data-variant` = `neutral`; added `api-error-sample-{name}`.

(`docs/plans/2026-09-15-ui-scenarios.md` already names `refused-locally` — `d1cab73`.)

## Not verified

- Nothing was executed: no build, tsc, eslint, stylelint, unit or e2e run; every "can fail / cannot fail" judgement is
  by reading the matcher against the source.
- No pixel, width, theme, contrast or keyboard behaviour was observed (Task 12's QA; `keyboard.spec.ts` landed after
  the range and was not read).
- I1 was traced in the lib and the component; the loading frame was not observed in a browser, and its duration on
  the real service is unknown.
- M1's reachability: whether `cmd/reconcile` can emit `pass` with zero gated rows (the small-sample taint was read in
  `computeResult`'s comment only, not its threshold).
- I5: that `packages/client-ts/test/fixtures.test.ts` validates every fixture the page cites was taken from the gate
  report, not re-read; only `ci.yml`'s lack of a client-ts test step was verified.
- The lab, Inspector and Book debt (Tasks 9 and 10: `lab-classify`, `lab-reading`, `runbook`, `cash-summary`,
  `inspector-view`) was walked for type-member consumers and seams only; its internal law was reviewed four times in
  the per-task rounds and was not re-derived here.
- The demo generator, the fixture JSON, the PNG baselines and the deleted files' bodies were excluded by instruction.
- The 29 deletions were judged by name and grep over `web/` (code, CSS, comments, README, styleguide); `docs/**` outside
  the two plans was not searched.
- An untracked `web/scripts/_widths-probe.mjs` is in the tree; it is not in the range and was not read.
