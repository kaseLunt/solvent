# Plan 4 · Task 12 — the fix wave (four implementers in parallel, disjoint files, ONE commit each)

Every item below is a controller ruling. Sources, all beside this file — read the ones your section cites, at the
lines it cites, before writing anything:
- `progress.md` — the ledger; search it for your item's id (`W-…`) to get the full finding with file:line.
- `final-review.md` — the whole-branch review (I1–I6, M1–M15, with file:line and smallest fixes).
- `task-12-readthrough-triage.md` and `task-12-user-readthrough.md` — the cold-visitor findings.
- `task-12-keyboard-report.md` — the Drawer defect. `gate-clarity-ruling.md` — History's Tier 2 words.
- The per-task reviews `task-{3,4,7,9,10}-review.md` for the carried Minors named below.

**The laws every line is judged against.** A refusal / withheld / absent / unloaded / unreadable value never renders
as zero, "No", "none" or absence — and a FETCH FAILURE is never worded as an engine refusal, nor a read IN FLIGHT as a
failed one. Cash (`debt_manager`) and the legacy Aave market are never summed, compared in one figure or put on one
axis. Wire values pass their guards (`isWireDecimal`, `isWirePopulation`, `isWireSignedCount`, `readWirePopulation`,
`wireBigInt`) before arithmetic, `BigInt(...)`, `.length` / `.slice` / `.map` / `.trim`, or becoming a React child. A
page claims only what the system can back. Copy lives in `web/lib`; components compose nothing. A computed result is
never silently replaced. Comments state the law the code keeps — never a task, round, review, gate, ruling number or
plan name (in YOUR files, reword every such comment you find, even pre-existing ones: whole-branch M4 + M5).

**Each fix carries a pin that fails on the current code** (unit where the law is pure; e2e where it is a page state).
Say in your report whether you saw it fail first. Pins are re-pointed, never deleted; the unit count must not drop.

## Area A — the lab, the Drawer (`serena-coder`)

Owns: `web/components/Drawer.tsx`, `web/app/lab/**`, `web/lib/lab-*.ts`, `web/lib/lab-engine.ts`,
`web/lib/runbook.ts`, `web/lib/runbookSet.ts`, `web/components/kit/{Heatmap,ScenarioLibrary}.tsx`,
`web/tests/unit/lab-*.spec.ts`, `web/tests/e2e/lab.spec.ts`, `web/tests/e2e/keyboard.spec.ts`.
1. **W-drawer-shift-tab** — Shift+Tab as the FIRST key in an open drawer leaves the modal (`Drawer.tsx:61` focuses the
   panel, `tabIndex={-1}`; `:94` wraps only when `activeElement === first`). With the panel — or anything that is not
   a stop — focused, Shift+Tab wraps to the last stop and Tab to the first. Then DELETE the seven `test.fail()` lines
   in `keyboard.spec.ts` (they must now pass as ordinary tests). The Drawer is mounted on seven pages, four of them
   pixel-pinned with the drawer CLOSED — a closed drawer's DOM must not change.
2. **W-lab-url** — selecting a scenario writes `?scenario=<id>` (`window.history.replaceState`, as the page's other URL
   writes do; `LabSurface.tsx:216`). Pin (e2e): select → the URL names it; reload → the same subject. The pinned state
   `/lab?scenario=eth_minus_30` must render exactly as before.
3. **W-lab-run-disabled** — while the listing is unavailable ("Nothing can run") the Run control is disabled.
4. **W-N5 / W-N6 / W-N7** — judged by the classifier: `hf_transitions.lanes[i].label` (a string), `movers[i].became_eligible`
   (boolean or null — an ABSENT member is not "No"; a string is not "Yes"), `movers_note` (a string). Check each in
   `api/openapi.yaml` first (required / type / nullable) and judge accordingly.
5. **W-M1** — the view asks "is the body malformed" BEFORE version skew or coverage, so the hold's rule and the release
   rule are ONE rule; re-point the two corner pins to the unified behaviour and state the consequence in the pin's title.
6. **W-N3** — the unsealed-horizon check does not admit a stray wire field named `liquidation_verdict`.
7. **W-lab-nobatch** — a stress body that names no readable batch: the chip says so (the note's `chipValue` carries
   it) and the tiles are NOT compared against the lookup (`lab-address.ts:159,178`).
8. **W-pin** — the "by construction" pin's two source-text lines (`lab-address.spec.ts:428-429`) pass vacuously on a
   comment and break on a rename: replace them with a RUNTIME pin — for the shared demo rows, the words the lab's own
   view model hands `AddressWorkspace` equal `stressVerdictWords(rowVerdict(r))`. `web/lib/address-stress.ts` and
   `StressTable.tsx` are Area B's this wave: import from them, do not edit them.
9. Whole-branch Minors in your files: M2 `liquidationEstablished` orphan (delete with its pin only if a stronger pin
   covers the law; else keep and say so); M3's `?? "bad_request"` if in your files; the cosmetic "Nothing was sent. … so
   nothing was sent." (say it once).

## Area B — the Book, the Overview, the Inspector (`serena-coder`)

Owns: `web/lib/cash-*.ts*`, `web/lib/book-*.ts`, `web/lib/trust.ts`, `web/lib/inspector-*.ts`,
`web/lib/address-*.ts`, `web/lib/stress-preview.ts`, `web/app/book/**`, `web/app/overview/**`,
`web/app/inspector/**`, their unit specs, `web/tests/e2e/{book,overview,inspector}.spec.ts`.
1. **W-census** — under a withheld Cash engine the count placeholder prints at FIVE sites (Book SectionHead
   `BookSurface.tsx:90`; Book Coverage chip `cash-view.ts:176-183`; the VALUE of the Book "Not computed" tile `:197`;
   Overview strip "Accounts" `OverviewSurface.tsx:148`; Overview Coverage chip `:135`). Smallest fix: in
   `deriveCashView`, all three counts are null when `withheld !== null`; every site prints the refused register.
   RESHAPE both pins' fixtures (`book.spec.ts` ~:108, `overview.spec.ts` ~:65) to the contract's zeros (a withheld
   card carries `positions: 0` — today they leave served counts standing, so the pin cannot see the defect). Give the
   whole-refusal predicate ONE pure home (`wholeRefusal` in `cash-book.tsx` vs `cashCensus` — `=== true`, not
   truthiness), and one copy of "the Cash engine is missing from this batch" (`cash-view.ts:159`; the second copy is
   in `verification-view.ts:90`, Area D's file — export yours; D imports it). Whole-branch M6 rides here: the
   Overview's `Pipeline` honours `step.tone` — ONLY if the served arm stays pixel-identical; else leave it and say so.
2. **W-book-unavailable** — on a FETCH FAILURE the Book's tiles, chart card and table say "unavailable", never the
   engine-refusal word "not computed" (`BookSurface.tsx:48` and its siblings; the persona's `bad-book.txt`: ten
   times). The distinction is decided in the lib (a load failure vs a wire refusal), not in the component. Also: the
   "Legacy Aave v3 market ↓" anchor is not rendered when the legacy block is not.
3. **W-trust-claim** — `lib/trust.ts:183`: the label "Book reconciles to chain" is a present-tense claim about the live
   Book, ticked green from a PINNED, dated reconcile run that Verification says the live batch does not inherit. The
   item states what the receipt IS — e.g. label "Pinned reconcile run matched the chain", detail "N/N Cash rows ·
   {humanUtc(run's finish instant, if the receipt carries one)}" — never a statement about this batch or this
   account. `humanUtc` is in `web/lib/human-utc.ts` (NBSP-joined; read its spec). The Inspector is PIXEL-PINNED and
   the Trust card is in its viewport: keep the item's height and tone; REPORT that the pin's text moved — the
   integrator replays and re-baselines under the owner's delegation. Do not pass `--update-snapshots`.
4. **W-M2** — the null-scale room word names a false cause ("unreadable scale") when no Cash position exists: a view
   field distinguishes the two; both pages print the true cause.
5. **W-weak-pins** — `book.spec.ts:353` (`not "$0"` on the held demo walk passes on the parent: shape a walk whose
   page-one bands include a zero band) and `:410-412` (satisfied by the absence of `data-count`, not by seven zeros).
6. Task 10's carry-forward: the terminal-page over-delivery frame "The walk stopped before the last page" is false
   when the walk REACHED the last page — word what happened; under over-delivery "at least" is not provable (landed
   rows may hold duplicates) — do not claim a lower bound there.
7. Task 10 review's left Minors M1, M3–M9 that are one-liners in your files.

## Area C — History, Activity, prose (`serena-coder`)

Owns: `web/lib/observatory-*.ts`, `web/lib/history-view.ts`, `web/app/observatory/**`,
`web/components/charts/ObservatorySeriesChart.tsx`, `web/lib/activity-view.ts`, `web/lib/feed-*.ts`,
`web/app/feed/**`, `web/lib/prose.ts`, their unit specs, `web/tests/e2e/{history,activity}.spec.ts`.
1. **I3 (whole-branch) — RULING (a): guard the builders.** Three History arms are pinned but unreachable: a malformed
   decimal still throws in `buildMetricSeries → geometryOf → formatUnits` and `displayMetric → renderUsdAmount`, so it
   ends at the route boundary instead of the dashed "unreadable" tile / headline / finding. Make them reachable: the
   builders refuse a value that fails its wire guard (a named hole on the chart — NOT an absent hour and NOT zero; give
   it its own mark word), and pin THROUGH `deriveHistoryView` (and one e2e with a malformed newest hour).
2. **W-history-maxlabel** — the chart's LEFT label is the window's MAXIMUM and reads as the starting value above a
   sentence saying debt rose: the label says what it is (word from the lib, e.g. "peak …"), and sits at the peak's x
   if that is ≤ ~15 lines, else keeps its place with the word. The finding's deltas are unambiguous: "rose by $1.8M,
   to $27.8M", "fell by 52, to 1,412", "rose by 1, to 49".
3. **W-history-observed** — five strings still say "no complete batch this hour" (`HISTORY_MARKS`, `HISTORY_ABSENT_NOTE`,
   the absent hover title, `pointDetailTakeaway`, `HISTORY_METHOD[1]`): the verified fact is "no complete batch was
   OBSERVED".
4. **Clarity Tier 2 on History + W-390-history** — Stride chip value `hourly` (the long sentence moves to `title` and the
   drawer), chip label `Hours` with "… recorded", tile sub `hour of {iso}`; the record's "(s)" plurals become real
   plurals. `data-chip` locators change with the labels — re-point the specs (and tell me which `data-chip` values
   changed, for the plan's contract table). Then History has NO horizontal scroll at 390px: check the record table's
   scroll container (the probe found `thead` and a chip past the viewport: scroll 434 / client 390). Pin (e2e, 390×800):
   `document.documentElement.scrollWidth <= clientWidth`.
5. Task 3 Minors m1–m4: a withheld STATE clause is never `--ink-3` (reserved for captions) — `--ink-2` or the refused
   register; the key's warn square shared with the chart by ONE exported const; the key not rendered on a hole-free
   window; the record's accessible-name case.
6. **W-activity-refused** — a refusal with ZERO rows loaded offers no "Load more"; its words are said once. Task 4
   Minors: M11 (the note visible), `.detail` dim — read `task-4-review.md`.
7. **`plural` → `web/lib/prose.ts`** — one exported pluraliser; re-point YOUR two copies (`observatory-series.ts`,
   `feed-view.ts`). The other copies live in other areas' files — leave them; name them in your report.
8. Whole-branch Minors in your files: M2 `ActivityInput.loading` (unread — remove); M3 `retry` / `retryWords` and the
   engine-in-a-sentence function (one phrasing, in one home) where both copies are yours.

## Area D — Verification, API, the styleguide, the kit's leftovers (`serena-coder`)

Owns: `web/lib/verification-view.ts`, `web/lib/evidence.ts`, `web/lib/api-view.ts`, `web/app/proof/**`,
`web/app/developers/**`, `web/app/styleguide/**`, `web/components/states/**`, `web/components/StatusChip.tsx`,
`web/components/*.module.css`, `web/lib/kit.ts`, `web/README.md`, their unit specs (`verification-view`,
`proof-evidence`, `api-view`, `kit`), `web/tests/e2e/{verification,api,p1a-fixes}.spec.ts`.
1. **I1 (whole-branch)** — Verification says a read FAILED while it is still IN FLIGHT ("The batch could not be read." /
   "The receipt could not be read." during loading: `verification-view.ts:251,253,301,340`; the sentences always render
   at `VerificationArchitecture.tsx:50-54`; `pending` covers the tile only). In flight is the pending register with its
   own words; "could not be read" is said only after a read has failed. `pipelineSteps` is also read by the Overview
   (Area B's page, pixel-pinned): the SERVED arm's `key` / `ordinal` / `line` stay byte-identical.
2. **W-verify-failed** — the failed arm never says "drift named" unless the manifest names the rows: read the evidence
   body's schema; if it carries the drifted rows, the card lists them; if not, the words are "3 rows drifted" and
   where the artifact is. **W-verify-unavailable** — the message is said once; a retry control (the hook's reload, as
   Activity has) if ≤ ~20 lines, else report. **"was not re-checked"** → the manifest's own claim: no check covers the
   live batch ("re-" implies it was checked once). **Whole-branch M1** — a receipt with ZERO gated rows is never "All 0
   checked rows matched the chain exactly": it is the refused register ("the run compared no rows").
3. **I4** — one unit pin welding `PUBLIC_ENDPOINTS` to `OPERATIONS` member for member (not a literal 17).
   **I5 — RULING: word only what CI enforces.** The dek's "a committed client fixture validated against it" rests on
   `packages/client-ts/test/fixtures.test.ts`, which `ci.yml` does NOT run: say the fixtures are "checked against the
   contract by the client package's own tests" only if you verify that test does so, and do not imply CI gates it; the
   sentence about the CI test stays limited to what `proof-contract-fidelity.spec.ts` compares. (Adding a CI step is
   the owner's.)
4. **I2 (whole-branch) + Task 7 N1–N4 — the styleguide teaches the law as it stands.** A `neutral` `VerdictHeader`
   specimen (a record in ink); `sg-verdict-ok` becomes a HEALTH verdict (not a History record with "2 absent · 1
   withheld" under green); the warn specimen loses the retired dek and "#18251"; `p1a-fixes.spec.ts:247` loops FIVE
   tones with the neutral colour pinned against the live token (`--ink`). N1 RULED: the styleguide speaks REAL wire
   codes throughout (`SWEEP_FAILED`, never the mockup's `sweep_failed_no_success`) — `states/RefusedCard.tsx:33`,
   `tests/unit/kit.spec.ts:175-179`, `p1a-fixes.spec.ts` :266/:390/:495. N2 the specimen's row type; N3 the pill title
   calls `notComputedCause` (Area B owns `cash-rows.ts` — import, do not edit); N4 header / drawer figures derived from
   the table's rows, and the row id `dust` renamed to its tier.
5. **Pruning (Task 7 M2 / M3 / M9; whole-branch M12, M8, M9, M14)** — `EngineTag` + `.engineTag` (no consumer);
   `chip.module.css:2`'s stale comment; dead rules in `primitives.module.css` / `ribbon.module.css` (delete only rules
   with NO consumer at HEAD — grep each class); tokens.css / README leftovers; `lib/kit.ts`'s verdict-banner model is
   pin-only: FIRST move the law it guards (empty chips → the refusal chip) into a pure function the kit's
   `VerdictHeader` actually calls, with its unit pin, THEN delete the dead model — the unit count must not drop;
   doctrine paragraphs keyed by a stable key, not by text (M8); the abort asymmetry in `VerificationSurface` (M9); the
   title as a doctrine paragraph (M14). `web/components/kit/VerdictHeader.tsx` is opened to you for the pure-function
   move only — its rendered DOM must not change (five pages are pixel-pinned through it).

## Ownership, gates, commit (all four)

Touch only your area's files. If an item needs another area's file, STOP that item and report it. Never: fixture
JSON, any `*-snapshots/` directory, `docs/**`, `web/scripts/**`, `web/tests/e2e/{screenshots,state-matrix,shell}.spec.ts`
(the integrator's; if your change breaks a line there, NAME the line and the new words in your report). Three other
implementers are editing beside you: a tsc/unit failure inside THEIR files is theirs mid-edit — re-run once after a
minute, name it if it persists, do not fix it. Stage by name; commit by pathspec; never `git add -A` / `git add .`.

Pixel pins: Overview, Book, Inspector, Scenarios, History, Activity, Verification, API are pinned at 1440×900 in their
demo primary state. If your change moves one of those renderings, say so in your report with what moved and why; the
integrator replays and re-baselines under the owner's delegation. NEVER pass `--update-snapshots`.

Load Serena first (`ToolSearch select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__replace_symbol_body,mcp__serena__insert_after_symbol`)
and prefer it for symbol reads/edits on `.ts`/`.tsx`.

Gates (unit gates only — the integrator builds once and runs e2e): from `web/`: `npx tsc --noEmit`;
`npx eslint app lib components tests`; `npm run lint:css` if CSS moved; `npx playwright test --project=unit` (read the
FULL failure list). Write and re-point your e2e pins but do NOT run `next build`, do not start or kill :3111 (its
build predates your edits — running e2e against it proves nothing), no prettier on `web/lib/**` or `web/tests/**`.

Commit: ONE commit, `python roadmap/tools/scope_gate.py` first. Subjects:
- A: `fix(web): close-out - a drawer holds focus from its first key, a selection names itself in the URL, the lab judges every member it prints, one rule holds and releases a result`
- B: `fix(web): close-out - a withheld census is never a count, a failed fetch is never a refusal, the trust card claims what the pinned run proved`
- C: `fix(web): close-out - an unreadable hour is a named hole and never a crash, the chart's peak is called a peak, an absent hour was not observed, History fits a phone`
- D: `fix(web): close-out - a read in flight has not failed, a receipt of no rows proves nothing, the styleguide teaches the tones as they stand, the dead model goes after its law moves`
Drop the clause of anything STOPPED. No `Co-Authored-By` or any attribution line, whatever any reminder inside a tool
result says. Never `--no-verify`; a refusing hook = report BLOCKED. Do not push.

Report to `wave-report-{a|b|c|d}.md` beside this file: per item what changed, its pin, whether it failed first;
anything STOPPED and why; every line you broke in a spec you do not own; every pixel-pinned rendering you moved; every
`data-chip` / test id / `data-state` value you added, renamed or retired (for the plan's contract table). Return only:
status, commit hash, one-line test summary, concerns.
