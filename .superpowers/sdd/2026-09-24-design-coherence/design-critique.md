# Design coherence — the completeness and doctrine critic (verbatim)

**Completeness and doctrine critique of the six-area coherence plan**

The plan leaves out 13 coherence problems visible in the captures. Six of its items break doctrine or an honest state that the demo captures don't show, and its six file sets are not truly disjoint.

Code paths below are relative to `C:\Users\kasel\source\repos\etherfi\Solvent\web\`. Capture names refer to `C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\design-review\{w1440,w390}\<name>-<theme>-<fold|full>.png`.

## (1) Coherence problems visible in the captures that the plan misses

1. **The arrow means three things.**
   - "→" leads to another page: "Scenarios →", "Evidence →", "Open in the Inspector →", "Stress this address →".
   - "→" also opens a drawer: "How the bands are cut →" (app/book/BookSurface.tsx:164) and "Price inputs →" (app/inspector/[addr]/BackingTable.tsx:75).
   - "→" also jumps down the same page: "Most affected accounts →" goes to #movers (lib/lab-view.ts:59).
   - The Book's legacy link uses "↓" for the same in-page jump (BookSurface.tsx:89), the tile sub "by asset ↓" is not a link at all, and Verification writes "→ API" with the arrow in front.
   - Evidence: book-dark-fold, inspector-dark-fold, lab-dark-fold, w390/verification-dark-full.
   - Most of these labels are also typed directly into components, which breaks doctrine 4: BookSurface.tsx:89/:164, BackingTable.tsx:75, InspectorTiles.tsx:49/:73, AddressWorkspace.tsx:83, StressPreview.tsx:13, ApiSurface.tsx:76.
   - Needed: one rule (→ another page, ↓ further down this page, no arrow on a drawer trigger), with every label moved to lib.
2. **The header pill's age stays green.** lib/live-pill.ts:23 maps a fresh age to "ok", so the connected pill's "42s ago" is green. K3 only changes the dot, and R1 only changes the Snapshot chip. None of the captures show it because the stream never connected.
3. **Pages that have no answer set their headline three different ways.**
   - The whole line is dimmed (ink-2) on historyDegraded, activityRefused and verificationUnavailable.
   - Only the first half is dimmed on labBare and labCompare ("ETH -30 percent — 1 committed shock, not run yet.").
   - The line is plain ink on activityExhausted.
4. **Over the cap is written five ways, and the plan widens the split.**
   - Book: "−$184.80", which R4 turns into "−3.9%".
   - Scenarios "Most affected accounts" table: "over cap".
   - Scenarios one-address table: "over cap by $1,069".
   - Scenarios one-address tile: S4 makes it "−$1,069" with the sub "over cap".
   - Heatmap and Book bar labels: "over cap".
   - There is no rule across pages.
5. **Money precision changes inside one column.**
   - humanUsdFull prints cents under $1,000 and whole dollars above it, so the Inspector's "Counts toward cap" column reads $4,200 / $812.50 / $5,012 (inspector-dark-fold).
   - humanPrice prints four decimals under $10, so the Price column reads $4,000.00 / $1.2500.
   - F3's `accountMoney` keeps this rule. The mockup prints $813 and $184 (whole dollars). F4 fixes percent columns only.
6. **The Inspector Debt tile sub is an exact string at tile level.** "USD · 4,822.000000 exact" is composed in InspectorTiles.tsx:49, with a "—" fallback. This contradicts F3's rule that exact strings never appear at reader level. The mockup has it, but as "USDC ·" with the exact-value underline. The plan needs to either exempt it explicitly or change it.
7. **The price source has two names.** The Inspector chip says "Prices PriceProvider v2". The Overview's step 02 and footer say "RedStone" (overview-light-full). The mockup chip says "RedStone · 38s".
8. **The noun ruling R10 ("account", never "position", on Cash) is only applied to the Book.**
   - P5 keeps "Liquidatable positions" as a tile label, a toggle and the "Positions with no verdict" record key.
   - P5's own dek, "Liquidatable positions rose by 1, to 49; accounts fell by 52", mixes both nouns in one sentence, which is exactly what R10 objects to.
   - "position" also stays in the Book's own Stress card (stress-preview.ts `unmeasuredSentence`), in Overview step 03 and in the Scenarios library text.
   - History's "Liquidatable positions 49" never reconciles with the Book's "2 accounts" headline.
9. **On a phone, Scenarios opens with the library, not the answer.** The headline starts around y≈1,190 at 390 (w390/lab-dark-fold). The plan defers this "behind chip grammar", but a layout reorder on the Scenarios page doesn't depend on chip grammar.
10. **The same four steps are told twice in different words.** The Overview says "Reorg-safe indexer · Raw logs…"; Verification says "Index · Latest block indexed…". B1 and P2 unify how the steps are drawn, not what they say.
11. **The Overview card kicker is ink-2, while the Book's identical kicker "CASH BOOK · RIGHT NOW" is accent** (overview-dark-fold vs book-dark-fold).
12. **P7's sentence case only covers area 6.** Lowercase line starts also exist in areas 4 and 5: the heatmap labels and "today ↓ · after →" corner, the Trust details ("this account's latest sweep succeeded", "the engine's own inputs"), the Book bar labels, and the toggle "Show 47 small & dust positions".
13. **The "Becomes liquidatable?" column of the Scenarios "Most affected accounts" table says "Yes" in all 20 rows**, because the table is defined as exactly those accounts (lab-dark-full). The column is noise.

## (2) Items that break doctrine, a test law or an honest state the captures don't show

- **P2, fetch-failure state.** When the evidence fetch fails, the view sets `receipt: "none"` (verification-view.ts error arm, ~:919). RECEIPT_TONE maps `none` to refused, so a transport failure would get the dashed refused rule and a refused step 03. That breaks doctrine 1 (a fetch failure is never a refusal). The map needs its own `unavailable` key.
- **P2, other tone gaps.**
  - It silently raises `drift` from warn to crit (RECEIPT_CHIP_TONE, :732). That changes a verdict's tone and is not among the rulings.
  - It leaves the proof card's status rows on other tones (:547 empty→warn, :551 UNAVAILABLE→crit).
  - The Inspector Trust item for a failed receipt stays warn (trust.ts:333/:355), so the same failed receipt would be crit on Verification and warn on the Inspector.
- **P1, verificationUnavailable dek is false.** "…so there is no proof or batch to show" — but step 02 still shows batch 18,251, which comes from /v1/book through `pipelineSteps(meta, evidence, book)`. That breaks doctrine 4. The existing "Live batch —" chip already contradicts step 02, and P1 would put the contradiction into a sentence.
- **P3, dropped chips.** Dropping Scope, View and Order means:
  - In the refused state (no filter chip, no newest) and the error state, the chip list is empty. `headerIdentity` (lib/kit.ts:33) then renders the refused "Identity missing" chip.
  - Together with P7 cutting "by block time" from the qualifier, the order key (block time vs block number, activity-view.ts:767) disappears from the page.
- **P1/P3, Activity and History states not captured.**
  - Activity has an `error` state (fetch failed, "page fetch failed", pinned by state-matrix.spec.ts:620). It isn't specified; the plan's "Refused" tile word must not reach it.
  - History has unavailable (fetch error), foreign-engine and unreadable-scale branches (history-view.ts:300-340) that also leave an empty chart slot. Only the degraded state gets a StateCard; reusing its cause text in the others would be untrue.
- **P1 and P4, bare-dash table rows.** P1 makes the refused table's only row a bare "—", and P4 does the same for the exhausted list. That is the null glyph K4 bans in KPI tiles. Give each state its word ("Refused" / "No rows").
- **K4, which frame a state tile wears.** It never says which frame a tile with the word "Unavailable" or "Not run" wears. Today every such tile is dashed (the refused form), including verificationUnavailable's step 03 (a fetch failure) and labBare. There is also a separate "not served" (404) state on Scenarios (state-matrix lab `degraded:run-book-not-served-404`) that needs a word other than "Not run".
- **S8, Run button.** Showing the header "Run ${name}" button and the "Run it to see…" dek in the not-served, unavailable or running states would promise a run the deployment can't do. It must apply only to "served, not run yet".
- **K2 at 390, connected pill.** The live pill "Live · batch 18,251 · 42s ago" is about 200px. Brand + pill + two icons comes to about 390px against 358px available. The captures only show "Reconnecting". This also risks the no-sideways-scroll check in wide-font.spec.ts.
- **F2, clipboard.** `groupDecimalString` also builds the `exact` strings that ExactValue copies (ExactValue.tsx:24 writeText). A U+2212 on the clipboard won't parse in a spreadsheet or code. Use the minus glyph for display only; copy and title keep the wire's ASCII "-". params-format.ts, which no area owns, is also affected.
- **K6(b), missing pins.** Re-pointing `--t-*`/`--fs-*` now changes charts.module.css (12 uses), exact, chip and states styles before C1 lands. That moves the history and inspector pins, but K6 lists `pins_moved: []`.
- **S1, kicker case.** The kicker is uppercased in CSS, so "weETH" and "sETHFI" become "WEETH" and "SETHFI". The scenario name needs `kickCase`, which K9d currently gives only the API version.
- **S2, false headlines.** "X moves the most" is untrue for ties, for all-zero deltas ("+$0"), for a refused or withheld member of the set, and for the Cash rate-horizon scenario.
- **P4, overclaiming headline.** "No recorded chain action is a bad-debt realization." claims too much when an engine scope, a since-block filter or several types are active. The scope has to be in the sentence.
- **P3, units side by side.** Right-aligning digits in the All-engines Amount column puts Cash "252.733333" and legacy "180,771,428 raw units" on one digit axis. That is a doctrine 2 edge. Don't align across engines, or lead with the unit tag.
- **F1, contradiction.** The spec says "exactUtc drops no field" and also drops fractional seconds. Pick one.
- **P5, labels collide.** With truncating `bookMoney`, "Peak $27.8M" can sit next to a newest label of "$27.8M" while the two marks differ. The formatter for count metrics is also unspecified.

## (3) Under-specified: two implementers would diverge

- **K3(c) "one Tone union".** At least eight tone vocabularies exist: KpiTile Tone; lib/kit ChipTone (with accent, quiet, unknown and crit-fill); IdentityChip tone; evidence default/dim; TrustCheckItem states; feed "key"; live-pill; Verification CardTone. The spec doesn't say whether to merge the types or just document them.
- **K4.** Which register goes with which state word (see section 2).
- **K8.** Whether the eight-option Type group is single- or multi-select (a joined segmented bar implies radio). No overflow cue for the scrolling bar on phones. Where "Since block · choose one engine" goes.
- **K9b StepStrip.** What a step shows when its figure is missing (verificationUnavailable step 03): a state word, or "—"?
- **B2.** When the table is shorter than the left-hand stack, the stretched Needs-attention card recreates the empty panel B2 is meant to remove.
- **B1 + P2.** Whether the four steps' copy comes from one lib source or two.
- **R4 / S4 / S8.** No cross-page rule for how an over-cap room is written.
- **S1 vs stress-preview.ts.** stress-preview.ts has its own name builder (truncated percent, no "≈"), used by the Book and Overview. That leaves two builders for one scenario name.
- **P6.** Turning "* " lines into a `<ul>` changes the `<p>` list that api.spec.ts:172-175 asserts, but P6 doesn't list that test among the ones it changes.

## (4) The file sets are not disjoint

- **Screenshot baselines.** The `tests/e2e/screenshots.spec.ts-snapshots/*.png` files are rewritten by items in every area:
  - book-*.png: K2, K4, B2, B3, B4, B5.
  - inspector-*.png: K1, K2, K4, C1, C2, F5, S7.
  - lab-*.png: K1, K2, K4, K5, K11, S1, S5, S6.
  - The integrator should regenerate them once, after all areas land.
- **tests/e2e/p1a-fixes.spec.ts** belongs to area 1 but pins the Book's "Not computed" pill and row (:424, :447, :513), which B4/R9 in area 4 renames.
- **tests/e2e/state-matrix.spec.ts** belongs to area 6 but has 7 Inspector and 4 Scenarios cells that check area-5 text and test ids. Example: "The scenarios for 0x7a3f…c21e could not be run." and the rows of `lab-address-table`.
- **Area 3's formatters feed other areas' tests.**
  - The F5 `humanAge` change alters strings pinned by the cash-view, inspector-view, live-pill and trust tests (areas 1, 4, 5).
  - F1 and F2 change Activity and Inspector cells pinned by area 5 and area 6 tests.
  - The "unit specs pinning these modules" line doesn't cover these consumer tests.
- **lib/evidence.ts** belongs to area 6, but P2's tone edits (:134-146) also change the Book's and Inspector's drawers, because that chain is shared.
- **params-format.ts** belongs to no area but consumes `groupDecimalString`, so F2 changes it.

## (5) Taste without a coherence argument: drop or defer

- **K13 radius role tokens.** They change nothing visible. Defer them with the spacing tokenization, which the plan already defers for the same reason.
- **S6 per-class normalisation.** It makes the same opacity mean different counts in different classes, with no legend. A square root over the global maximum already separates 18 and 135 (0.14 vs 0.38). Keep the square root; drop the per-class part.

## Files cited

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\live-pill.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\verification-view.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\activity-view.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\history-view.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\kit.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\trust.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\human-price.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\stress-preview.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-format.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\lab-view.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\components\ExactValue.tsx`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookSurface.tsx`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorTiles.tsx`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\BackingTable.tsx`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\e2e\p1a-fixes.spec.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\e2e\state-matrix.spec.ts`
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\e2e\api.spec.ts`
