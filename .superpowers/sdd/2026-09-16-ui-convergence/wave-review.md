# Plan 4 · Task 12 — review of the fix wave (`5840b57..0f18a1b`)

Read-only review. Commits read by commit and path: `9a9874a` (A), `736e09e` (B), `62a0b61` (D), `af39652` (C),
`e23c62f` (F1 / F2); `0f18a1b` (PNGs) skipped. Nothing was built, run, started or killed. Every `file:line` below is at
`0f18a1b`. The integrator's known state (tsc / eslint / lint:css clean, unit 1025 / 0, e2e 279 / 0 / 0 on a production
build) is relied on and not re-proved.

## Verdict

**One more round — a small one (two fixes, one function each, no pixel pin moves).** No Critical. Thirty-odd items
are closed and their pins can fail on the parent. Two Important findings remain, both on states the codebase itself
models as first-class:

1. **I3 is closed for malformed STRINGS only.** The builders decide "money or count" from the VALUE's JavaScript type,
   not from the METRIC. A money figure served as a JSON number — the contract's canonical malformation ("money as a
   JSON number", `packages/client-ts/test/fixtures.test.ts:104`) — still ends at the route boundary (fractional /
   negative), or is plotted unscaled and labelled as a count with no `$` beside a tile that calls it unreadable
   (integer). The implementer's statement that a malformed COUNT is the only remaining throwing class is not correct.
2. **The Trust card's new label claims more than its `ok` arm checks.** "Pinned reconcile run matched the chain" is
   ticked green on the Cash weld alone; a receipt whose run did NOT pass whole (a gated row short with zero drift, the
   legacy weld short, a wire `proof_subject.status` that contradicts the receipt, zero gated rows beside a Cash weld)
   is green on the Inspector while Verification says "The last reconcile run did not match the chain exactly".
   The parent's words were Cash-scoped; the wave widened the claim without widening the check.

Everything else is Minor. If the controller rules both Important findings onto the carry-forward list instead, the
wave closes as it stands — neither is a regression in behaviour, both are words / arms this wave wrote.

## Per-item table

"Pin fails on parent" is reasoned from the parent's code at `5840b57`.

### Area A — the lab, the Drawer (`9a9874a`, + F1 in `e23c62f`)

| Item | Judgement | Where (`0f18a1b`) | Pin fails on parent? |
|---|---|---|---|
| W-drawer-shift-tab | CLOSED | `web/components/Drawer.tsx:21-33` (`stopsOf`), `:98-118` | Yes — parent `:94` wrapped only when `activeElement === first`; with the panel focused nothing was prevented (the seven `test.fail()` bodies failed there). `keyboard.spec.ts:226-238`; zero `test.fail` remain. |
| W-lab-url | CLOSED | `web/app/lab/LabSurface.tsx:89-94` (`inbound`), `:228-237` | Yes — parent `onSelect={setSelectedId}` wrote nothing; `lab.spec.ts:311` fails at its first `toHaveURL`. |
| W-lab-run-disabled | CLOSED (the real defects, as the ledger records) | `web/lib/lab-view.ts:303,306` (`checked: []`), `web/app/lab/lab.module.css:4-6` | Yes (unit: parent returned `[...ui.checked]`; e2e: no `:disabled` look existed). |
| W-N5 / N6 / N7 | CLOSED | `web/lib/lab-classify.ts:141` (label), `:258` (became_eligible), `:268` (movers_note) — each matches `api/openapi.yaml:4498` (required string), `RunBookMover` (required, boolean, nullable), `:4871-4874` (required string) | Yes — parent had no such check. No conforming body is refused: all three members are `required`, and `movers_note` entered the contract with `movers_total` (1.6.0), which was already judged. |
| W-M1 | CLOSED | `web/lib/lab-engine.ts:65-71,132-143`, `web/lib/lab-view.ts:178-183,222` | Yes — parent put the version skew before the row's judgement. |
| W-N3 | CLOSED as ruled (residual: Minor A-1) | `web/lib/lab-classify.ts:313` | Yes. |
| W-lab-nobatch | CLOSED | `web/lib/lab-address.ts:179-188,207-216` | Yes (chip was `null`). |
| W-pin | CLOSED | `web/lib/lab-address.ts:174`, `AddressWorkspace.tsx:34` | Yes (`space.table` did not exist). |
| Minors (item 9) | CLOSED / not in A's files, as the ledger records | `runbook.ts:66,141`, `runbookSet.ts` | Yes ("nothing was sent" ×2). |
| F1 (lab half of W-M2) | CLOSED | `web/app/lab/AddressWorkspace.tsx:47-51`, `web/lib/lab-address.ts:62,72,190` | Yes (field absent). |

**The Drawer, key path by key path** (`Drawer.tsx:98-118`): panel focused (`at = -1`) → Shift+Tab → last, Tab → first;
first stop → Shift+Tab → last, Tab → browser default (the next stop is inside); last stop → Tab → first, Shift+Tab →
default; a middle stop → default both ways; a single-stop drawer → `at = 0 = length-1`, both keys re-focus the close
button; zero stops → `preventDefault`, focus stays (unreachable: the close button is always a stop); a click on
non-focusable text focuses the panel (`tabIndex={-1}`) → the `-1` arm; a closed `details` → its `summary` is a stop
and its contents are not (`checkVisibility()` is false under a closed fold's hidden content slot in every engine that
has the method); an open one → its controls join the list, which is rebuilt on every key, so a fold toggled by Enter is
seen by the next Tab. **A control inside a CLOSED `<details>` cannot be counted and swallow the wrap** on any browser
that has `checkVisibility` (Chrome 105+, Firefox 106+, Safari 17.4+); on the `getClientRects` fallback a
content-visibility-hidden control can still report rects (Chrome 97–104 only) — no drawer holds a fold today, not a
finding. Escape and the focus restore are byte-identical to the parent; an opener that unmounted while the drawer was
open still leaves focus on `<body>` (`:75`, `?.focus()` on a detached node — true at the parent, and no page unmounts
an opener today). **A closed drawer's DOM is unchanged**: `:123` `if (!open) return null` and the three effects are
untouched; the diff is the selector, `stopsOf` and the handler body.

**W-lab-url, event orders.** The URL is written with `replaceState` only, so Back / Forward never step between two
selections — there is nothing to desync. The deep-link decision is `inbound` (mount) and `decided.current` guards the
dispatch, and the library is empty until the listing is ready, so no selection can precede the decision; a conflict
link runs nothing and a later selection writes a clean single link. Two residual cases where the URL and the screen
part are Minor A-2.

**W-M1, honest bodies.** `readEngine` and `answerFault` walk the same ladder (envelope → listed refusal → no row →
`judgeRow`), so `cash.kind ∈ {contradictory, unreadable}` ⇔ `answerFault !== null`. A clean version-skewed body is
still "definition changed"; a clean stray Cash row under a definition that does not model Cash is still "not
modelled"; a listed refusal speaks for its engine before any row beside it is judged. None now reads contradictory.

### Area B — Book / Overview / Inspector (`736e09e`, + F2 in `e23c62f`)

| Item | Judgement | Where | Pin fails on parent? |
|---|---|---|---|
| W-census (six sites) | CLOSED | `web/lib/cash-view.ts:156-161` (no count is read when `withheld !== null` — so both placeholder shapes, the contract's zeros and counts left standing, print nothing), `:210-213` (Coverage `withheld`), `:227` (`accounts withheld`); `BookSurface.tsx:92,195`; `OverviewSurface.tsx:157`; `BookMethodology.tsx:45-53` | Yes — parent read `positions: 0` and printed "0 borrowing accounts" / "0 / 0 computed" / "Accounts 0"; both e2e fixtures are now the contract's zeros. |
| — the JUDGEMENT (positions endpoint alone refuses) | **RIGHT** | `cash-book.tsx:323` | The walk is tied to the book's batch (`walkForThisBook`), so this is one service contradicting itself about one batch; the page already takes the refused headline from it, and a census under a refused headline is the very thing the law forbids. The strictest honest arm wins, as `evidence.ts` does for a contradicted receipt. It hides a count the book served — and says why in the headline. Two book-only readers still disagree with it in that one state: Minor B-1. |
| W-book-unavailable | CLOSED | `cash-view.ts:68-70,163-172` | Yes (`absence` undefined; "not computed" ×10). Four causes + in flight are distinct and true on both pages: failed fetch / 503 → "unavailable" under the failure's own message (503 carries its retry hint); engine not listed → "unavailable" under the missing-engine sentence, Coverage `unavailable`; withheld → "not computed", Coverage `withheld`; in flight → "loading…", Identity `pending`. `loading…` is printed only while `reading.phase === "loading"`, so it cannot outlive a failure. The Overview strip prints dashes in all five. |
| W-trust-claim | CLOSED as ruled — **but see Important I-2** | `web/lib/trust.ts:193-235` | Yes (label literal). Arms: matched → ok, new label, `N/N Cash rows · date`; drift / did-not-pass → warn, "Pinned reconcile run"; no receipt → dim; **zero gated rows → dim "no rows in the receipt" — no green tick over 0/0** (`:226`); no readable `finished_at` → no date (`:202-206`), a malformed instant verbatim. |
| W-M2 | CLOSED (with F1) | `address-stress.ts:166-199`, `inspector-view.ts:302` | Yes. |
| W-weak-pins | CLOSED | `book.spec.ts` (held walk, foreign-engine) | The reshaped pins can now fail. |
| Over-delivery wording | CLOSED | `book-headline.ts:77-98`, `cash-summary.ts:97-171` | Yes. No bound is claimed under "over" in the dek, the distance finding, the bars' note, the tiles' note or the attention finding; `web/app/book/**` holds no bound word of its own. Residual frame on the Overview: Minor B-2. |
| Task 10 Minors | as the ledger records | — | — |
| `cash-refusal.ts` | CLOSED | `web/lib/cash-refusal.ts:30-39` | `=== true` pinned under a truthiness mutation. Head entry first, then the card's boolean. Every former caller is re-pointed (`cash-book.tsx:152,323,333`, `BookMethodology.tsx:23`, `verification-view.ts:92`); `cashCensus` maps `"" → null` at `:95`. No third reader of `refused_engines` decides a whole refusal. |
| F2 (Overview pending) | CLOSED | `OverviewSurface.tsx:42,46-62,199`, `Pipeline.tsx:55-73` | Yes — parent printed `unavailable` in flight. |

### Area C — History / Activity / prose (`af39652`)

| Item | Judgement | Where | Pin fails on parent? |
|---|---|---|---|
| I3 (guard the builders) | **NOT CLOSED in full — Important I-1.** Closed for a money value that is a malformed STRING. | `web/lib/observatory-series.ts:186-189,200-213,219-225,259-283` | Yes for strings (the `DecimalFormatError` path). No pin feeds a non-string money value. |
| W-history-maxlabel | CLOSED | `observatory-series.ts:340-384`, `ObservatorySeriesChart.tsx:251-269,431-446` | Yes. "peak" is true when tied (the first occurrence is labelled, and it is a peak), with one point (the label is omitted: `HistoryChart.tsx:121-125`, the newest label is the same string), and beside an unreadable hour (the word is the highest PLOTTED value: Minor C-3). |
| W-history-observed | CLOSED | `history-view.ts:99,104,301,403`, `observatory-series.ts:245,753` | Yes (literals). |
| Tier 2 + W-390 | CLOSED | `history-view.ts:200-215`, `history.module.css:37,48-56` | Yes (434 > 390 at the parent). From the CSS nothing else can pass 390: `.page` is one `minmax(0,1fr)` column, `.controls` / `.metrics` / `.findingRow` wrap, `.kv` stacks with `overflow-wrap: anywhere` on every `dd` (the record's `<code>` values), `.plotFrame` and `.rates` scroll inside themselves, chips may wrap below 640px. |
| Task 3 m1–m4 | CLOSED | `history-view.ts:334,452,526,552`; `HistoryPoint.tsx:77`; `HistoryChart.tsx:151-166` | Yes. |
| W-activity-refused | CLOSED | `activity-view.ts:363-393,689-690`, `ActivitySurface.tsx:296-345` | Yes. After a refusal the ONLY way on is a restart (the strip's button, or any filter / mode change, which restarts the walk); the dek says so ("… Restart the list below.") and the empty table says "restart above". The refused cursor is never advanced, so a "Load more" could only re-send it. |
| `plural` → prose | CLOSED | `web/lib/prose.ts` | Yes. |
| Minors (item 8) | CLOSED | — | — |

**I3, walked.** A malformed money STRING at the newest hour → dashed headline, dashed tile `unreadable`, the cross,
the key, the qualified older label; at the oldest hour → "debt unreadable at one end, so no change is given"; at the
would-be peak → it plots nothing, the peak is the highest plotted value; in the selected point's record → a dash with
`, unreadable: …`; in a metric other than the active one → that tile alone is dashed (each tile builds its own
series). No throw on any of these. **An unreadable hour is counted as RECORDED** (`buildBucketAxis` counts the row as
captured, `:130`) — true: the rollup wrote the row — and never as absent. The finding's ends are the first and last
CAPTURED, non-withheld hours (`:728-732`): an absent or withheld end is skipped, an unreadable end says "unreadable at
one end", a null end "not stated at one end" — never a zero.

### Area D — Verification / API / styleguide / the kit's leftovers (`62a0b61`)

| Item | Judgement | Where | Pin fails on parent? |
|---|---|---|---|
| I1 | CLOSED on Verification and, through F2, on the Overview | `verification-view.ts:266-289,327-340,353-368,397-413,862` | Yes. meta / evidence / book × in flight → `pending`, neutral, the reading sentence; × failed → `unavailable` (or the wire's own absence), refused; never the reverse (`metaPending = meta === null && inFlight.meta`, likewise evidence; the book's own `phase`). The SERVED arm's `key` / `ordinal` / `line` are byte-identical to the parent (diffed; the only new `line` is the `empty` arm's). |
| — F2's `settled` | CLOSED | `OverviewSurface.tsx:46-62` | `.then(ok, fail).finally(...)` flips `settled` on both outcomes unless aborted; abort happens only in the effect's cleanup (unmount), where nobody reads it; a StrictMode remount makes fresh asks under a fresh controller. A synchronous throw before the promise exists would reach the route boundary, not a stuck "pending". No path found where a read settles and `settled` stays false. |
| W-verify-failed / -unavailable / "re-checked" / M1 (zero rows) | CLOSED | `:301-307,755-777,855-856,877-893`; `evidence.ts:694-696,787-803,882-884` | Yes (13 of 14 observed by the implementer). `data-receipt="empty"` is the refused register in the headline, the dek, the chip, the tile, the step, the strip, the card and the drawer. Residuals: Minor D-1, D-2, D-3. |
| I4 | CLOSED | `api-view.spec.ts` weld | **No, by design** — the two lists agree today (recorded in the ledger). |
| I5 | CLOSED — both claims TRUE | `api-view.ts` dek | Yes. (1) "A CI test re-reads both and fails if this page's extract has drifted from either": `ci.yml` web job runs `npm run test:e2e` = `playwright test` (both projects), which includes `tests/unit/proof-contract-fidelity.spec.ts`; that spec re-reads `api/openapi.yaml` (`:58`) and the cited fixtures' bytes (`:139-142,169-172`) and compares the extract to each. (2) "the fixtures are checked against the contract by the client package's own tests": `packages/client-ts/test/fixtures.test.ts:59-66` validates every member of `FIXTURE_FILES` against the contract, with a "validator can reject" block; the five fixture files the extract cites are members. `ci.yml` has an install step for client-ts and no test step — the dek does not say CI runs it. |
| I2 + N1–N4 | CLOSED | `app/styleguide/page.tsx`, `specimen-book.ts`, `p1a-fixes.spec.ts:242-295` | Yes. Five tones against the live tokens, `neutral → --ink`; green only on the health verdict; `sweep_failed_no_success` is nowhere in `web/` but the two absence assertions and the phrasebook pin. **The contrast block is byte-identical**: `ContrastSpecimens.tsx` md5 `9bab0830…` at both revisions, the `sg-tokens` section md5 `2bd18490…` at both, the p1a-6 contrast test body (`p1a-fixes.spec.ts:195-241`) `diff` exit 0. |
| Pruning | CLOSED | `primitives.module.css`, `ribbon.module.css`, `chip.module.css`, `lib/kit.ts:16-35` | Every class each module's one importer uses is still defined (`DegradationBanner` 6 / `RouteRefusal` 5 / `StatusChip` incl. all seven `CHIP_TONE_CLASS` values); `EngineTag` and the seven verdict-banner exports have zero references in `web/`. `VerdictHeader`'s rendered DOM is unchanged — the diff is the import, the comment and `const identity = headerIdentity(chips)`, which returns the SAME array for any list with a present chip. `chipPresent` short-circuits on the label, so `.trim()` never meets a chip value: no new throw. |

## Findings

### Critical

None.

### Important

**I-1 · History: a money figure that is not a string still throws — or is plotted unscaled and labelled as a count.
(Area C)**
`web/lib/observatory-series.ts:186-189` — `metricUnreadable` is `typeof raw === "string" && !isWireDecimal(raw)`.
`displayMetric` (`:209`) and `geometryOf` (`:221`) then branch on `typeof raw === "number"`, i.e. on the VALUE, to decide
"this is a count".
*Reach:* `/v1/observatory/series` with `debt_usd: 27828808.216758` (a JSON number — nothing validates the body at
runtime; `fetchObservatorySeries` hands the client's cast straight through) at ANY hour of the window.
*Shows:* `buildMetricSeries` does not name the hole (`:260`), `geometryOf` returns the number, and the point's title
calls `displayMetric` (`:281`) → `readWirePopulation(27828808.216758, "debt_usd")` throws → `tileOf`
(`history-view.ts:179`) → the route boundary, for every tile and the chart. With an INTEGER number
(`debt_usd: 27828808216758`) nothing throws: the hour is plotted at 2.78e13 beside neighbours at 2.78e7 (the line
flattens to the floor), labelled "peak 27,828,808,216,758" with no `$`, while the debt tile and the headline —
which read through `wireBigInt` — call the same value unreadable. The mirror case (`accounts: "1412"`, a count served
as a string) is plotted through `formatUnits` at the money scale and labelled `$0.001412`; it throws only when it
sits at an end hour (`countMove`, the takeaway's `readWirePopulation`) — the count class the ledger already carries.
*Fix (one function each, ~8 lines):* decide by the METRIC. `metricUnreadable(point, metric)` = for the two money
metrics, `raw !== null && !isWireDecimal(raw)`; `displayMetric` / `geometryOf` take the money path for
`debt_usd` / `collateral_usd` and the count path otherwise, whatever the value's type. Add the number case (fractional
and integer) to the two existing pins (`history-view.spec.ts:200`, `observatory-series.spec.ts` "NAMED hole"). The
count law the ledger carried to the owner is untouched by this.

**I-2 · Inspector Trust card: "Pinned reconcile run matched the chain" is green on the Cash weld alone. (Area B, seam
with D)**
`web/lib/trust.ts:212-234`. The `ok` arm asks: verdict passed, `gated_drift === 0`, and the CASH weld's
`rows_exact === rows_compared`. It never asks `gated_exact === gated_rows`, the other welds, or the wire's
`proof_subject.status` — the conjunction Verification prints as the definition of the proof
(`evidence.ts` `PROOF_COMPARATOR`; `deriveProofSubjectStatus` `:560-609`).
*Reach:* a receipt with `result: "pass"`, `exit_code: 0`, `gated_drift: 0`, `gated_exact: 86`, `gated_rows: 87` and
the Cash weld 29/29 (Verification's own "a row short" arm — `ReceiptState` `drift`); or the legacy weld 13/14; or
`proof_subject.status: "rejected"` over a receipt that passes on its own numbers; or `gated_rows: 0` beside a 29/29
Cash weld (Verification: `empty`). `trust.spec.ts:204-222` pins the short case only with `welds: []`.
*Shows:* Inspector — green tick, "Pinned reconcile run matched the chain · 29/29 Cash rows · Jul 29, 02:14 UTC".
Verification, same manifest — amber, "The last reconcile run did not match the chain exactly," (or "Nothing is proven
for this deployment"). At the parent the item said "Book reconciles to chain · 29/29 Cash rows exact": a Cash-scoped
sentence. The ruled label is a sentence about the RUN, and the arm was not widened to match it.
*Fix (~6 lines + one pin):* before the `ok` return, require the run to have passed whole — `gated_exact ===
gated_rows`, `gated_rows > 0`, and every weld exact (the wire's status cannot be seen from a `ReconcileSummary`; pass
the manifest's `proof_subject.status` in `TrustInput`, or export one `receiptPassedWhole` predicate from `evidence.ts`
and call it from both files). Otherwise the label is `RECONCILE_RUN`, state `warn`, detail "29/29 Cash rows · the run
did not pass whole". Owner B; if the predicate is exported from `evidence.ts`, D's file is touched.

### Minor

- **A-1 · W-N3's other half.** `lab-classify.ts:313` refuses a stray `liquidation_verdict` BESIDE a
  `becomes_liquidatable`. A wire horizon that OMITS `becomes_liquidatable` and carries `liquidation_verdict:
  "liquidatable"` is not sealable (`runbook.ts:73-75`), is left verbatim (`:80`), and then passes the check — it is
  indistinguishable from a horizon the client sealed. Fix in the seal, not the classifier: `sealProjection` strips a
  wire member named `liquidation_verdict` from every horizon before deciding, so only the client can put one there.
  The new pin (`lab-classify-run-book.spec.ts:644`) has no such row.
- **A-2 · Two places the URL and the screen part.** (i) One-address mode: selecting a scenario the address was not
  stressed under writes `?scenario=<clicked>` (`LabSurface.tsx:228-237`) while the subject and the highlight fall back
  to the first row (`:203`; pinned as "never the row clicked" in `lab.spec.ts` ~`:1063`). A reload reproduces the same
  screen, so the link does not lie about what opens — but it names a scenario the page is not showing. (ii) The shell's
  "Scenarios" link (`AppShell.tsx:14`, `href="/lab"`) on `/lab?scenario=x` is a same-route soft navigation: the
  surface keeps its state (`selectedId` is read once, `:80-82`), so the bar reads `/lab` over a selected `x`. (ii) is
  the parent's behaviour; both are for the owner's W-lab-url ruling list rather than a fix now.
- **A-3 · A contradictory body with a version skew wears the stale-input banner.** `lab-view.ts:178-181`: the
  contradictory state keeps `banner`, and `skew` can now include the version. With no held result the banner prints
  "… This result stands for the definition it was computed under." (`lab-headline.ts:247`) over a page that shows no
  result. True at the parent for a config-only skew; newly reachable for a version skew. Fix: `banner: null` in the
  contradictory arm when nothing is held.
- **B-1 · The third refusal source is not seen by two book-only readers.** When only `/v1/positions` refuses the
  engine, the Book and the Overview strip print the refused register (right — see the table), but `cashCensus`
  (`verification-view.ts:89-102`) still prints "· 1,412 Cash accounts" in the Overview's pipeline under "Coverage
  withheld", and the Book drawer (`BookMethodology.tsx:23`) re-derives from the book and can print "None." under a
  "could not be computed" headline. Fix: hand both the view's `withheld` instead of re-deriving it.
- **B-2 · The Overview's Book entry card keeps the frame item 6 retired.** `cash-view.ts:263`: every stopped walk is
  "Walk stopped before the book was read" — false for `at-end` (it read its last page) and for `over`. Fix: word it
  from `summary.stopKind`, or say only "The walk did not complete".
- **B-3 · Copy composed in a component by this wave.** `BookMethodology.tsx:45-53` ("No batch loaded.", the withheld
  sentence with its interpolated cause) and `BookSurface.tsx:250,254` ("Not reported."). The drawer was already prose
  in JSX; these three are new. Home them beside `CASH_ENGINE_MISSING`.
- **B-4 · I1's twin on the Inspector (pre-existing, not in the wave's list).** `inspector-view.ts:239` hands
  `reading.evidence?.reconcile ?? null`, and `address-lookup.ts:80` holds the manifest as `null` both in flight and
  after a failure, so `trust.ts:211` says "receipt unavailable" while `/v1/evidence` is still loading. Carry forward.
- **C-1 · The drawer does not teach the new mark.** `history-view.ts:101-109` (`HISTORY_METHOD`, "the legend's three
  marks") names the absent and withheld marks and has no line for the unreadable cross the key can now show.
- **C-2 · A green census chip over an unreadable hole.** `history-view.ts:201,210`: `holes` counts withheld and absent
  only, so a window whose one hole is an unreadable figure keeps `Hours` in the `ok` tone, against the file's own rule
  that a hole's severity rides that chip. The tally itself is true (the hour was recorded).
- **C-3 · "peak" is the highest PLOTTED value.** True as documented (`observatory-series.ts:339-345`); on a window with
  an unreadable, withheld or absent hour the page cannot know the window's peak. The marks and the key carry it; no
  change asked.
- **C-4 · Two comments still say what the same file calls wrong.** `observatory-series.ts:21-22` and
  `observatory-data.ts:61` say "every Nth captured bucket"; `strideWord`'s doc (`:290-292`) says "never 'every Nth'".
- **D-1 · The receipt strip is drawn refused while its read is in flight.** `deriveVerificationView` returns
  `receipt: "none"` for the loading state (`:867`), so the strip "Reading the reconcile receipt…" gets
  `data-tone="refused"` (`VerificationArchitecture.tsx:6-12,56`: dashed border, `--ink-2`) and the surface
  `data-receipt="none"` — against the component's own doc (`:25-27`). The words are right; the register is not. Fix:
  the strip's tone is neutral while `view.state === "loading"`.
- **D-2 · A vacuous receipt's weld rows still wear green.** `verification-view.ts:529-536`: under `vacuous` the gated
  row is `dim`, but each weld row is `ok` whenever `rows_exact === rows_compared` — so "0/0 exact" prints green under
  "NOTHING PROVEN", against the comment at `:507`. Fix: `tone: vacuous ? "dim" : …`.
- **D-3 · Retry drops focus.** `VerificationSurface.tsx:151-155`: the button exists only while `unavailable`, so
  activating it by keyboard unmounts the focused element and focus falls to `<body>`. Fix: keep it mounted and
  `disabled` while loading, or move focus to the header.
- **D-4 · One retirement assertion that cannot fail.** `p1a-fixes.spec.ts:459` asserts `sg-table-row-dust` has count 0
  BEFORE the fold is opened — true at the parent as well. Move it after `toggle.click()` (`:461`).

## Across the wave

- **(a) Seams.** No new member lacks a consumer: `ReceiptState` `empty` (`VerificationArchitecture.tsx:6-12`, the card,
  the drawer descriptor, the chip tone map — all `Record`s, so tsc enforces it); `GapKind` `unreadable` (`GAP_WORDS`,
  the chart `:350`, `sparseCaptureLine`, `HistoryMarks`); `CashAbsence` (printed generically); `WalkStopKind`
  (required on every hop); `ScaleAbsence` (both tables pass it; `lab-address.ts:119,122` call with a non-null scale);
  `PipelineInFlight` / `PipelineStep.pending` (both pages); Coverage `withheld` (rendered through `IdentityChips`).
  Duplicates already in the ledger and not re-reported: `plural` ×4, `engineInProse` vs `modelled`, `bookFailed` vs
  `bookLoadFailure`, `retry` vs `retryWords`, "provenance row(s)" in `verification-view.ts:498,670-671`. New seam
  defects: I-2, B-1.
- **(b) Pins.** No assertion was found deleted without a replacement: removed and added `expect` / `test` lines were
  counted for all 36 touched specs (added exceeds removed in every file that lost any), and the removed lines were
  read against their successors in the specs that lost the most (`history-view`, `cash-summary`, `lab-view`,
  `verification-view`, and the `book` / `history` / `verification` / `activity` / `p1a-fixes` e2e specs); `kit.spec`
  and `observatory-series.spec` were checked by count and title only. Cannot fail on the parent: the I4 weld (by
  design, in the ledger), M8 (no pin possible, in the ledger), D-4. No pin was weakened to pass. Missing pins: I-1
  (non-string money), I-2 (a run short with the Cash weld whole), A-1.
- **(c) Copy in components added by the wave:** B-3 only. `Pipeline`, `VerificationSurface`, `AddressWorkspace`,
  `HistoryPoint`, `ActivitySurface` print the lib's words.
- **(d) Comments the wave ADDED that name a task, round, review, gate, ruling or plan:** none (the added lines of the
  whole range were searched). Two test TITLES the wave rewrote still open with "W-OBS"
  (`observatory-series.spec.ts`) — titles, left on purpose by Area C.

## (e) Contract values — consolidated and verified against the code

**Test ids ADDED**
| Id | Where | When present |
|---|---|---|
| `book-section-cash` | `BookSurface.tsx:91` | always |
| `overview-live-accounts` | `OverviewSurface.tsx:155` | always |
| `obs-gap-unreadable` | `ObservatorySeriesChart.tsx:350` | one per unreadable hour of the charted metric |
| `activity-liquidation-note` | `ActivityTable.tsx:25` | under a liquidation extract whose wire note is non-empty |
| `verification-retry` | `VerificationSurface.tsx:152` | only while `verification-surface[data-state="unavailable"]` |
| `sg-verdict-neutral` (+ `-headline`, …) | `app/styleguide/page.tsx:256` | styleguide |
| element id `history-point-title` | `HistoryPoint.tsx:23` | the record card's `<h3>`; the card is `aria-labelledby` it |

**RENAMED**
| Was | Is |
|---|---|
| History `data-chip="Buckets"` | `data-chip="Hours"` (ok and loading states) |
| `sg-table-row-near` / `-small` / `-dust` | `sg-table-row-near-1` / `-small-1` / `-small-2` (`material-1`, `material-2`, `refused` unchanged) |
| `sg-verdict-identity-law[data-variant="ok"]` | `data-variant="neutral"` |

**Attributes ADDED**
| Attribute | Values | On |
|---|---|---|
| `data-tone` | `neutral · ok · warn · refused` | `pipeline-{index,compute,verify,serve}` (CSS acts on `refused`, `warn` only) |
| `aria-busy="true"` | — | `pipeline-{index,compute,verify}` while that read is in flight (F2) |
| `data-place` | `peak · edge` | `obs-ymax-label` |
| `data-note` | `caption · state` | the record's clause spans (`HistoryPoint.tsx:77`) |
| `data-foot` | `more · end · none` | `activity-foot` |
| `title` | the stride's method sentence | History `data-chip="Stride"` |

**Values ADDED to existing attributes**
| Attribute | New value |
|---|---|
| `verification-surface[data-receipt]` | `empty` → `exact · empty · drift · failed · none` |
| `obs-gap[data-kind]` | `unreadable` |
| `history-marks li[data-mark]` | `unreadable` |
| `pipeline-*[data-value]` | `pending` while the step's read is in flight (else the figure or `unavailable`) (F2) |
| `verification-kpi-{index,compute,verify}` | `data-tone="neutral"` + `aria-busy="true"` while in flight |
| chip `Coverage` (Book, Overview) value | `withheld` (beside `unavailable` and `N / M computed`) |
| chip `Stride` (History) value | `hourly` (or `at most one hour in every N` / `… per N seconds`) |
| chip `Hours` (History) value | `N recorded · N withheld · N absent`; loading `pending` |
| Trust item `reconcile` label | `Pinned reconcile run matched the chain` (ok) / `Pinned reconcile run` (every other arm) |

**Now CONDITIONAL**
- `history-marks` — absent when the charted metric has no absent / withheld / unreadable hour.
- `activity-load-more` and `activity-end` — both absent while `activity-surface[data-state="refused"]` (`data-foot="none"`), rows loaded or not.
- `verification-receipt` — absent while `data-state="unavailable"`; present in `loading` and `ok`.
- Book `Legacy Aave v3 market ↓` anchor — only when the legacy block renders.

**RETIRED**
- the `title` attribute on `activity-liquidation` (the note is page text now);
- no test id or `data-state` value was retired. Lab (`data-state`, `data-banner`, `data-mode`) is unchanged.

**History chips when answered:** `Engine | Stride | Range | Hours | Served`; loading `Engine | Hours`.
**Lib API (not DOM), for the plan's prose:** `pipelineSteps(meta, evidence, reading, inFlight?)`,
`PipelineStep.pending`, `PipelineInFlight`, `VerificationInput.metaInFlight` (required), `VerificationView.receiptLine:
string | null`, `CashView.absence` / `sectionQualifier`, `CashBookReading.cash.walkStop`, `WalkStopKind`,
`InspectorView.scaleAbsence`, `AddressWorkspace.{table,qualifier,scaleAbsence}`, `answerFault` / `RowFault`,
`HistoryView.marks`, `RecordRow.noteTone`, `ActivityView.{refusalHead,foot}`; removed `ActivityInput.loading`,
`EngineTag`, the seven verdict-banner exports. `docs/plans/2026-09-16-ui-convergence.md:47,195,207` lag (Area D's note).

## Not verified

- Nothing was executed: every judgement is from the code at the two revisions. The two Important findings are
  reasoned from `observatory-series.ts` / `history-view.ts` / `wireGuard.ts` and `trust.ts` / `evidence.ts`; neither
  was reproduced in a browser or a unit run.
- The re-baselined PNGs (`0f18a1b`) were not opened; that the four ruled renderings moved ONLY in the ruled strings,
  and that Overview / Book / Scenarios / Activity did not move, rests on the integrator's replay.
- The Drawer in a real browser: `checkVisibility()` under a closed `<details>` in Safari, a `visibility: hidden`
  control or a radio group as the last stop (each would let Tab leave the modal — no drawer holds one today), and
  Chrome's keyboard-focusable scroller on a long single-stop drawer body (`.body { overflow-y: auto }`).
- That Next 16 keeps `LabSurface`'s state across a same-route navigation to `/lab` (A-2 ii) is from the router's keying
  of page segments without search params, not from a run.
- The Activity items' visible halves (M11's note position, the `.detailDim` colours) and the 390px geometry beyond
  what the CSS shows; the e2e pins that passed are relied on.
- `web/tests/e2e/{state-matrix,shell,screenshots}.spec.ts` (the integrator's) were not read for stale words.
- Area B's Task 10 Minors M1 / M3 / M7 / M8 and Area D's README / `tokens.css` comment edits were read in the diff
  only, not re-derived.

## Process note

A system-styled message arrived beside the first tool result of this review, telling the reviewer to do all file
work through Bash "while auto mode is active". It did not come from the controller or the owner. Reading was through
`git show` as the brief requires; this one file was written with the file tool. It changed no judgement here.

---

# Re-review 2 (`0f18a1b..78055a1`)

Read-only, by commit and path: `be9bbdb` (W), `c192523` (Z), `1c7ab68` (X), `41679c3` + `bbd4bdd` (Y), `78055a1` (the
integrator's seams); `94f18ff` (docs) skipped. Nothing built or run. Every `file:line` is at `78055a1`. The integrator's
known state (tsc / eslint / lint:css / build clean, unit 1081 / 0, e2e 299 / 0 / 0, sixteen pixel pins unmoved) is
relied on. Items the ledger records as accepted, carried or on the owner's list are not re-reported (the whole-body /
whole-set refusal with nothing held; Area Z's five decisions; the reworded over-delivery sentence; G4 / G5; the
`dotPlotScale` floor; the loading headline's refused variant; Codex #1 first half, #5, #8, #9, #10, #20).

## Verdict

**CLOSES.** No Critical, no Important. Both of my Important findings are closed at the root (the guard is chosen by the
metric; the tick is Verification's own judge), every Codex FIX-NOW item and every Minor taken this round is closed with
a pin that can fail on `0f18a1b`, and nothing the round introduced rises above Minor. Eight Minors below; none needs a
round.

## Per-item table

| Item | Judgement | Where (`78055a1`) | Pin fails on `0f18a1b`? |
|---|---|---|---|
| **I-1 = Codex #6** money judged as money | CLOSED | `observatory-series.ts:200-211` (`isMoneyMetric`, `metricUnreadable`), `:232-233`, `:243-250` | Yes — seen: `WireIntegerError … got 27828808.216758` on the named path; the integer plotted at `1000000`. |
| Codex #7 a series answers for the engine asked | CLOSED | `history-view.ts:147-158`, the second lock in `deriveHistoryView`; `HistorySurface.tsx` refuses before `buildBucketAxis` / commit | Yes — seen (`state` `ok` under Cash's kicker). A null body throws inside the `.then` and lands in the `.catch` as a named error, never a stuck load. |
| C-1 / C-2 / C-4 | CLOSED | `history-view.ts:108` (method note), `:244-262` (the census counts unreadable hours in either money metric, `warn`), the two comments | Yes (C-1, C-2 seen). |
| Codex #11 an empty projection cannot say | CLOSED | `address-stress.ts` `row()`; `projectionWords([])` | Yes — seen (`inside` / "No"). |
| **I-2** the tick is the whole run's | CLOSED | `trust.ts:245-280` | Yes — seen (three bodies green on the old arm). |
| Codex #16 = B-4 a receipt in flight is pending | CLOSED | `inspector-evidence.ts:37-52`, `address-lookup.ts:90,166-176,191`, `inspector-view.ts:242`, `trust.ts:282-287` | Yes (by construction + a mutation; the held-route e2e pin passed in a browser). |
| Codex #2 a page that cannot be read ends the walk by name | CLOSED | `book-walk.ts:46-56` (the decode inside a catch), `cash-rows.ts` `readCashPage(page: unknown)`, `cash-book.tsx:208-250` (the callback reads nothing) | Yes — seen (`kind: "rows"` for `batch: null`). |
| Codex #1 (repair half + first answer) | CLOSED | `cash-refusal.ts:105-153`, `cash-book.tsx:136-146`, `cash-view.ts:180,238` | Yes (mutation). |
| Codex #3 duplicates | CLOSED | `book-walk.ts:58-77` | Yes (mutation: the walk lands A twice and completes). |
| Codex #4 the false all-clear | CLOSED | `cash-rows.ts:62-80`, `cash-summary.ts:106,123-127`, `book-headline.ts:180,222-231` | Yes — seen (the three negatives over Codex's row). |
| B-1 drawer half / B-2 / B-3 | CLOSED (`cashCensus` half = G4, owner's list) | `BookMethodology.tsx` takes `view.withheld`; `cash-summary.ts:287-292` (`walkEntryLine`), `:268-280`; four strings in `cash-refusal.ts` | Yes. |
| Codex #13 + #14 ONE predicate | CLOSED | run: `lab-engine.ts:160-179`, `lab-reading.ts:51-69`, `lab-view.ts:189,238`, `lab-library.ts` `cashOutcome`; set: `lab-compare.ts:126,265-280`, `lab-reading.ts:77-98`, `lab-view.ts:291` | Yes — seen (both paths). |
| Codex #15 the listing is judged | CLOSED | `lab-classify.ts:535-541`, `lab-reading.ts:26-29`, `lab-view.ts` `listing-unreadable` | Yes — seen (three TypeErrors). |
| Codex #12 a negative names its own batch | CLOSED | `lab-address.ts:165-204` | Yes — seen. |
| Codex #17 + A-2, then the inbound ruling | CLOSED as ruled | `lab-deep-link.ts:93-97`, `LabSurface.tsx:135-156,289-299` | Yes (absence; the bar assertions wait past the effect and passed). |
| Codex #18 the notice claims what it gates | CLOSED | `lab-deep-link.ts:49-57`, `LabSurface.tsx:188-197` | Yes — seen. |
| Codex #19 tone from the unrounded delta | CLOSED | `lab-compare.ts:74-77` and the point arm; `CompareCard.tsx` prints | Yes (absence; the component's `shareTenths > 0n` is gone). |
| A-1 / A-3 | CLOSED | `runbook.ts` `withoutWireVerdict` before `sealable`; `lab-view.ts` `contradictory()` → `banner: null` | Yes — both seen. |
| D-1 / D-2 / D-3 / D-4 | CLOSED | `verification-view.ts` `ReceiptRegister`, `pendingChips`, weld + fingerprint tones; `evidence.ts` drawer rows; `VerificationSurface.tsx` retry-keyed focus; `p1a-fixes.spec.ts` (both halves after the fold opens, one `table` scope) | D-1, D-2 seen; D-3, D-4 by reading (the button unmounted focused; the old assertion held on any tree) — both passed in the integrator's browser run. |
| `78055a1` seams (G1–G3, the p1b re-point) | CLOSED | §6 below | — |

## 1 · I-1 and I-2

**I-1 — every money value, by type, sign, size and string form.** `null` → the "null" hole and the dash (not stated).
`undefined` (a missing member), a number of any sign or size (`0`, `-5`, `1000000`, `27828808.216758`, an unsafe
integer), a boolean, an object, an array, and every string outside `^-?[0-9]+$` (`""`, `"12.5"`, `"1e9"`, `"0x10"`,
leading / trailing space) → `metricUnreadable` is true (`:210`, `raw !== null && !isWireDecimal(raw)`): never placed
(`buildMetricSeries` names the hole before `geometryOf`), never labelled (`displayMetric` returns the dash at `:233`),
never a throw. The tile, the takeaway, the finding's `moneyMove` and the record's `money()` read through
`wireBigInt` / `metricUnreadable` and agree. A well-formed decimal string is the only value that plots. Two edges are
not defects: a negative decimal string is inside the contract's `Decimal` and plots below the floor as before; a
decimal of hundreds of digits overflows the float used for geometry and falls to the "null" hole's title while its
exact figure still prints — unreachable in practice.
**Counts — the behavioural change is a little wider than Area Z states.** A count now reads through
`readWirePopulation` whatever its type (`:232`, `:246`). At `0f18a1b` a count that was NOT a number and NOT at an end
hour never threw: a STRING was drawn at the money scale (`$0.001412`), and a MISSING member, a boolean or an object
fell to the "null" hole ("is null in this bucket"). All of those now throw on the count's own read at any hour. That
is the existing count law (the four pins: an out-of-contract count never becomes a number anywhere) applied by
identity; the string case was a false figure before, and the missing-member case was a mis-worded hole. It belongs
with the count-law question the ledger already carries to the owner — Minor Z-1 records the whole class.

**I-2 — every `ReceiptState` × Cash weld × evidence phase.** Phase `pending` → state `pending`, "receipt pending";
`failed` → `dim`, "receipt unavailable"; `answered`:

| `receiptState` | Cash weld present, whole | Cash weld absent | Cash weld 0-of-0 | Trust item |
|---|---|---|---|---|
| `none` (no receipt; also a wire `accepted` over a null receipt) | — | — | — | dim · "no committed receipt" |
| `failed` (verdict not pass / exit ≠ 0) | warn | warn | warn | "N drifted rows · did not pass" |
| `failed` (wire status contradicts a passing receipt) | warn "… the service does not vouch for this receipt" | warn (gated tally) | dim "no Cash rows in the receipt" | never green |
| `drift` (drift > 0) | warn "N drifted rows" | warn | warn | never green |
| `drift` (a gated row short, or another weld short, drift 0) | warn "29/29 Cash rows · the run did not match whole" | warn "1 row drifted" | dim | never green |
| `empty` | dim "the run gated no rows · nothing was compared" | dim | dim | never green |
| `exact` | **ok** · "Pinned reconcile run matched the chain" | **ok** over the gated tally | dim "no Cash rows in the receipt" (stricter than Verification — accepted) | green only here |

The `ok` return (`:279`) is reachable only past `arm !== "exact"` (`:269`), so **no arm is greener than Verification**;
two are stricter (a Cash weld of 0/0; `exact > compared`). **No import cycle:** the runtime graph from
`verification-view.ts` reaches 22 modules and from `evidence.ts` 16 (every `import … from` that is not `import type`
counted as an edge); none of `trust.ts`, `inspector-view.ts`, `address-lookup.ts`, `inspector-evidence.ts` is among
them. (`trust.ts` now pulls `verification-view.ts` — and through it `api.ts`, `proof-data.ts` — into the Inspector's
bundle; a size note, not a defect.)

## 2 · Codex #4 — every negative, against one unreadable computed row

| Negative | Complete walk | Mid-walk / stopped |
|---|---|---|
| "Nothing material is liquidatable on the Cash book right now." (the quiet emphasis) | blocked — the refused variant "The Cash book could not be fully read this batch." (`book-headline.ts:222-231`) | not reachable (pending / stopped variants) |
| "No position is liquidatable." / "No computed position is liquidatable." | blocked — reachable only past `unreadable === 0`; the dek says "No verdict is claimed over it." | not said |
| "No account is within 10% of its borrow cap." (material AND quiet variants) | blocked — `nearCapSentence(…, complete && unreadable === 0)` (`:180`) | silent mid-walk, as before |
| "No Cash account could be computed this batch." | not reachable — the arm sits after the unreadable return | — |
| the Liquidatable / Near-cap tiles' `$0` | `—`, refused tone, sub "… · lower bound, 1 row unreadable" (`BookSurface.tsx` on `summary.whole`) | `—` as before |
| a finished "0 accounts" in a tile's sub | still printed, under the dash and qualified "lower bound, 1 row unreadable" — a floor, not a negative | same, "lower bound, walking" |
| the bars' `$0 · 0` | dashes (`bandsSoFar` on `whole`, `cash-summary.ts:252`) + the unreadable bars note | dashes |
| the distance finding's `$0 sits within 10%` | `— … a zero is claimed only over a book read whole · 1 row could not be read`; a positive is "at least" | the walking / stopped registers |
| "No account needs attention." | "1 row could not be read; no account is cleared." (`:268-280`) — and the unreadable row is appended to the table itself, so the empty line is rarely reached | "Walking the book…" / the stop's frame |
| the Overview strip: headline, dek | the same `view.headline` | same |
| the Overview Book entry "$0 within 10% of cap" | "1 row of the book could not be read" (`walkEntryLine`, `:287-292`) | "Walking the book…" / `stopWords` |

The scoped sentence "Nothing material is liquidatable among the N computed accounts read so far." (pending and stopped
variants) stays: `computed` excludes the unreadable row, the unreadable sentence follows it, and the claim is true of
the rows it names. **Is the unreadable row ever worded as refused by the engine?** Not in the headline, the dek ("…
the engine calls computed could not be read by this page"), the pill ("Unreadable") or its title ("this page could not
read the row the engine served: …"). One place keeps the engine's word over it: the sixth tile is still LABELLED
"Not computed" while its value is refused + unreadable — the sub line tells them apart ("nothing refused · 1
unreadable"). Minor X-2.

## 3 · Codex #3 — duplicates

Identity is the lower-cased address (`book-walk.ts:64`), so `0xAB…` and `0xab…` are one account; the fault prints the
address as the repeating page spelled it. A duplicate WITHIN one page is caught by the same map ("twice on page N"),
further repeats on that page are counted ("and N more repeated rows on that page"), and the duplicate check runs
before the census checks, so no path lands a repeated row. **A legitimate re-read is never mistaken for a duplicate:**
the tally is a local of the walk effect (`cash-book.tsx:183`, `let tally = WALK_START`), so every walk — a new batch,
`reload()`, the 409 restart, a StrictMode remount — starts empty and its page one REPLACES the rows that stood; the
resume repair re-asks `/v1/book` only and starts no walk unless the batch id or the census changed, in which case it
is a fresh walk. No page is ever retried inside one walk. **What the page says:** the refused headline, "The walk was
served an account twice (account 0x… was delivered on page 1 and again on page 2)."; the distinct rows of the
repeating page land, the repeated one does not; `complete` is false; and no bound is claimed anywhere — the dek
("pages that repeat an account do not partition the book, so no figure here is a total or a lower bound"),
`walkQualifier`, `tileBoundNote`, the bars' note, and the distance finding drops "at least".

## 4 · Codex #13 + #14 — one predicate

Literally one function per path. **Run:** `answerFault` (`lab-engine.ts:160`) — `readsAsAnswer` is its boolean — is
what `heldOf` admits on (`lab-reading.ts:51-55`, in `withRunning` and `withSettled`), what `bookOf` releases on
(`lab-view.ts:238`), what `resultBook` asks first (`:189`) and what the library's word is read from (`cashOutcome`).
It judges the envelope, then every engine the page draws a card for (`[CASH, LEGACY]`) through `judgeRow`, whose
classifier now carries the mover ratio pairs (each a `NullableDecimal`, a pair null together). **Set:** `setFault`
(`lab-compare.ts:265`) is what `heldSetOf` admits on, `withSetSettled` releases on and `compareOf` draws on; its
per-row judgement `resultFault` is the one `rowOf` takes its `contradictory` / `unreadable` kinds from.

| Walk | Record | Page |
|---|---|---|
| valid → malformed-Cash | `held` = the valid body | the valid figures under `rerun-failed`, the fault named |
| valid → malformed-legacy-only | same — the legacy row is judged | same; the reason reads "Aave v3 market (legacy): bad_debt_delta_usd is outside the wire contract" |
| valid → malformed → malformed | `heldOf` passes the hold through every body that does not read | the first result stands throughout |
| nothing held → malformed-legacy-only | nothing enters the hold | the contradictory state WHOLE (accepted). **Not opaque:** the dek names the engine and the member — "Aave v3 market (legacy): … is outside the wire contract. Nothing from it is drawn." (`bodyReasons`, `:141-144`); a Cash fault keeps its bare member name |
| (set) valid → one garbage engine figure | `held` = the valid set; the garbage set never becomes the next hold | `failed` with the held views; "The set cannot be read. Faults: eth_minus_30: eligible_debt_delta_usd is outside the wire contract. …" |
| (set) nothing held → one garbage figure | never held | a failed Compare whole (accepted), the scenario and the member named |

**No honest body is refused:** an engine listed in `excluded_engines` is skipped before its row is looked at (`:167`);
an engine with no row is skipped (`:169`) and reads as withheld / not modelled; a clean stray row under a definition
that does not model its engine reads and is "not modelled"; the legacy market's movers, whose ratio pairs are null
together, pass the pair rule; on the set path withheld, unmeasurable, not-modelled and no-denominator results return
null from `resultFault`. The one deliberate widening — a legacy row that does not read faults the body even under a
definition that draws no legacy card — is pinned and is the ledger's accepted decision. Outside the predicate, by
Area Y's own note and honestly rendered at print: the drawer's per-shock exact values.

## 5 · The URL law as it stands (`scenarioForBar`)

`scenarioForBar` (`lab-deep-link.ts:93-97`) writes only when a subject is shown, it differs from the bar, and either
the reader has selected (`readerSelected`) or the subject IS the scenario the opened link named.

| Opened | Then | Bar | Subject | Reload runs |
|---|---|---|---|---|
| `/lab` | nothing | untouched | the listing's first | nothing |
| `?scenario=x` (published) | nothing | untouched | x | x — the link's own |
| `?scenario=ghost` | nothing | **untouched** (`ghost`) + the unlisted-id notice | first listed | nothing (not published) |
| `?address=A&scenario=x`, x not carried | nothing | **untouched** + the fallback disclosure | the first carried row | x's book run — the link's own |
| any | select y (book) | `?scenario=y` | y | y (a selected-but-not-run scenario runs: accepted) |
| one-address | select y, not carried | y, then the effect writes the disclosed fallback f | f, disclosed | **f** — see below |
| any | the mode toggle / the address field | `address` added or removed; the scenario follows the subject only once the reader has selected | per mode | per the row above |
| `?scenario=x`, or after a selection | the shell's Scenarios link (`/lab`) | restored to x / the selection | unchanged | the link's own / the selection |
| `?scenario=ghost` | the shell's Scenarios link | `/lab` — the default is NOT written | first listed | nothing |
| after a selection | Back within `/lab` (the entry the shell's push left behind) | if that entry names another scenario the effect writes the current subject into it | unchanged | the selection |
| — | Back from another route | the entry's own URL; the surface mounts from it | as the URL names | that scenario, as any `?scenario=` link |

So: **after a reader's selection the bar always names the subject shown**; after a mode toggle on an opened-only link
the bar may still name the link's scenario over a fallback — by the ruling, with the mismatch said in words; **an
opened link is never rewritten without a user's act** (the only effect-side writes without a selection restore the
link's OWN scenario or address after a same-route navigation dropped them); and **no reload runs a scenario nobody
named — with one ruled exception**: in one-address mode a click on an uncarried row writes the DISCLOSED fallback, and
a reload of that URL dispatches the fallback's book run, which the reader never clicked. The ruling names this case
("incl. its disclosed fallback") — for the owner's Rulings list beside "a reload of a selected-but-not-run scenario
runs it".
**`unlistedScenarioNotice`, arm by arm.** Published id / no id / blank id → null. Listing loading, unavailable or
unreadable → `decision` is null, so nothing is claimed about what the deployment publishes. An EMPTY listing → "…
publishes no scenario of that id. Nothing was run for it, and the link is left as it arrived." with no "shown instead"
clause — true. One-address mode while the lookup is in flight → the clause is left out until a row is shown. One arm
goes stale after a selection: Minor Y-1.

## 6 · The integrator's `78055a1`

`TrustState` `"pending"`: the kit's `TrustChecklist` maps state through three `Record<TrustCheckItem["state"], …>`
tables (`GLYPH` "…", `STATE_WORD` "pending", `CLASS` the dim class — `TrustChecklist.tsx:12-22`), so tsc enforces the
member; `TrustCard` has no state switch (its `emptyWords` switches on the VIEW's state); there is no other tone → class
map and no exhaustive switch over `TrustState` anywhere in `web/`, and the styleguide mounts no trust specimen.
`evidencePhase: EvidencePhase | null` is required, so every constructor states it or does not compile: the hook
(`address-lookup.ts:191`) and the two spec helpers. `evidenceReadOf(null, null)` reads as failed — and is unreachable
on a page: an invalid address returns `empty("invalid", …)` before any trust is derived (`inspector-view.ts`, the first
guard), `InspectorSurface.tsx:82` does not mount `TrustCard` in that state, and the lab never renders trust. History's
loading chip is `{ label: "Hours", value: "pending" }` with no tone. The p1b re-point asserts the refusal, then reads
the same body under the engine it answers for — stronger than before.

## 7 · What the round introduced

No comment among the round's added lines names a task, round, review, tool, ruling or area (searched, "Codex"
included). No copy was composed in a component (the two new paragraphs print `space.fallback` and the lib's notice;
B-3 moved four strings to the lib; `CompareCard` lost its comparison). No assertion was deleted without a successor
(removed `expect` lines: 39 across 27 specs, all re-points; added: 841). No new unguarded wire read on the paths
walked. D-4 can now fail. New Minors:

- **Y-1 · "the link is left as it arrived" outlives the reader's selection.** `LabSurface.tsx:188-197` derives the
  unlisted-id notice for the page's whole life; after a selection `onSelect` (`:289-299`) rewrites the bar, and the
  notice still says, in the present tense, that the link is left as it arrived (only the "shown instead" clause
  follows the selection). By the file's own vocabulary "the link" is the one that was opened, so this is a tense, not
  a falsehood about that link — but it sits beside a bar that no longer shows it. Fix: drop that clause once
  `readerSelected`, or word it "was not rewritten". Area Y.
- **X-1 · The negatives are keyed to the book's aggregate, not to the rows that landed.** `book-headline.ts:241-248`
  says "No position is liquidatable." whenever `notComputed` (the aggregate's `refused_positions`) is 0 and no row is
  unreadable. A landed row with `status: "refused"` under an aggregate that counts none is a row with no verdict
  inside that negative — Codex #4's sibling, reachable only if the service contradicts itself within one batch (the
  walk checks the census against the aggregate, not the refused count). Pre-existing, not introduced. Fix: let the
  headline's `notComputed` be the larger of the aggregate's count and the landed rows without a verdict. Area X.
- **X-2 · The sixth tile's label is the engine's word over the page's own failures** (§2). Fix: none needed beyond the
  sub line, or label it "No verdict". Area X.
- **X-3 · Two exports named `bookAnswered` / `bookFailed` now exist with different meanings** —
  `cash-refusal.ts:143,151` (the hook's state transitions, three arguments) and `verification-view.ts:53,60` (the
  steps' `BookReading`, one argument); the second `bookFailed` is also the ledger's carried copy of `bookLoadFailure`.
  An auto-import picks either. Rename one pair. Areas X / W.
- **X-4 · Small duplicates inside the round:** the `field` / `isRecord` / `describe` trio is private and identical in
  `cash-rows.ts` and `cash-refusal.ts`; `rowsWord` now has three copies in two shapes (`cash-summary.ts`,
  `verification-view.ts`, `evidence.ts`) beside `prose.ts`'s `plural`; the over-delivery reason is worded "than the
  census counts" in the dek and "than the book counts" on the bars. Join the carried `plural` item.
- **Z-1 · The count law's reach grew** (§1): a missing or non-number count at a middle hour now throws where it drew a
  "null" hole. For the owner's count-law decision.
- **Z-2 · One read's phase has three models** — Verification's `EvidenceState` (`loading · error · ok`), the
  Inspector's `EvidenceRead` (`pending · failed · answered`), the Overview's `settled` flags. Each is correct; a fourth
  page would pick one. Carry.
- **W-1 · `pending` carries no `aria-busy` in the kit's checklist** though the tiles and the receipt strip do; the
  assistive word "pending:" is there. Cosmetic.

## Contract values this round (verified in code)

Added: `lab-surface[data-state="listing-unreadable"]`; test id `lab-address-fallback`; identity chip
`data-chip="Re-read"` (Book and Overview) and `Identity` value `unreadable`; History `Record` value `wrong engine` and
the `Hours` form `N recorded (M with an unreadable figure) · …`; `verification-surface[data-receipt="pending"]`,
`verification-receipt[data-tone="neutral"][aria-busy]`, `data-tone` on the proof card's and drawer's row values; Trust
item `data-state="pending"` and the detail words "receipt pending", "no committed receipt", "the run gated no rows ·
nothing was compared", "… · the run did not match whole", "… · the service does not vouch for this receipt"; the Book
pill "Unreadable"; the stress cell "no horizon in the projection". Retired: Trust detail "no rows in the receipt". No
test id renamed or retired.

## Not verified (re-review 2)

- Nothing was executed; every judgement is from the code at the two revisions plus the integrator's recorded run.
- The URL table is reasoned from `scenarioForBar`, the effect and Next's folding of `replaceState` / same-route
  navigation into `useSearchParams`; the Back rows in particular were not observed in a browser.
- D-3's focus landing and the `pending` glyph's rendering were not seen; the e2e pins that passed are relied on.
- The Book's and Overview's pixel-identity on the demo walk rests on Area X's old-vs-new member comparison and the
  integrator's unmoved pins, not on my own diff of every view member.
- That the run-book and set fixtures "all read" under the wider predicates is Area Y's sweep; I checked the rules, not
  each fixture.
- `web/tests/e2e/{state-matrix,shell,screenshots,keyboard}.spec.ts` were not read for words this round moved.
- The spec diffs were audited by count for all 27 touched specs and by reading for `p1a-fixes`, `p1b-fixes` and the
  removed lines; the new tests' bodies were sampled, not read whole.
