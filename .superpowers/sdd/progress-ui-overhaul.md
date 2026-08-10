# UI Overhaul program ledger

Program spec: docs/specs/2026-08-09-ui-overhaul-program-design.md

## Phase 0 — trust fixes

### p0-1 address-bound stress results (LabClient)
- New pins: tests/unit/address-binding.spec.ts (6), p0-fixes.spec.ts p0-1 (2 e2e).
- Retired pins: none.
- Mutants: comparison-deletion in addressBinding — killed at lab-stale-result
  visibility (e2e) and at the stale-arm equality (unit), each in isolation.

### p0-2 outcome-aware matrix cells (matrixCells + LabMatrix)
- New pins: tests/unit/matrix-outcome.spec.ts (5), p0-fixes.spec.ts p0-2 (2 e2e).
- Updated pins: none (old→new: none). Step 1 found one sub-line pin —
  lab.spec.ts:269 `net eligible accounts +1` (plus `batch #1` at :270) — and the
  render keeps the `net eligible accounts …` fragment FIRST, so both survive
  verbatim; lab.spec.ts, tornado.spec.ts and the r9–r14 fixes specs all pass
  unchanged.
- Retired pins: none.
- Known duplication, flagged for Phase 3 cleanup: when `newly_eligible_accounts`
  ≠ 0 the sub-line states the count twice — the pinned legacy
  `net eligible accounts +N` fragment AND `cellPrimaryOutcome`'s
  `+N newly eligible` part. When Phase 3 touches the matrix, drop the legacy
  fragment and move lab.spec.ts:269's pin onto the composed part.
- Helper relocation: `usd` moved LabMatrix.tsx → matrixCells.ts (it was
  module-private to the component; the pure composition must print the same
  dollars). `find_referencing_symbols` after the move: only `cellPrimaryOutcome`
  and LabMatrix's two call sites reference it — no other consumer.
- Fixture variants (both `structuredClone` of the committed
  run-book.eth_minus_30.json, one documented purpose each):
  1. surfacing variant — engines[0].bad_debt_delta_usd → "15900";
     engines[0].market_realization null → the openapi Shortfall example object
     with execution_shortfall_usd "3864".
  2. quiet variant — engines[0] outcome dimensions all zeroed
     (newly_eligible_accounts 0, eligible_debt_delta_usd "0",
     bad_debt_delta_usd "0"; market_realization already null).
- Mutants (each applied alone, `npm run build` + the one e2e test in isolation):
  1. bad-debt block deleted from `cellPrimaryOutcome` — killed at
     p0-fixes.spec.ts:194 `toContainText("Δ bad debt")` (cell rendered every
     other part; the bad-debt part alone went missing).
  2. `isZeroDecimal` → always false (quiet arm unreachable) — killed at
     p0-fixes.spec.ts:214 `toContainText("no effective movement")` (cell
     rendered `Δ eligible debt $0 · Δ bad debt $0` instead of the quiet line).
- Suite after revert: p0-fixes + lab + tornado e2e, matrix-outcome + lab-matrix
  unit — 190 passed.

### p0-3 health boundary price (InspectorPositionCard + evidence)
- New pins: p0-fixes.spec.ts p0-3 (2 e2e) — the row names HEALTH ("Health
  boundary price"), carries the current mark, pins the OLD copy to zero count,
  and the explain button + drawer title follow ("EXPLAIN · HEALTH BOUNDARY
  PRICE", old title zero-count).
- Step 1 grep: zero hits for `Liquidation price|LIQUIDATION PRICE|explain
  liquidation price` under web/tests — scout fact confirmed; nothing to update.
- Money reality check (the pin rule): `money()` at this callsite carries NO "$"
  prefix — the brief's placeholder pins `$4,000` / `$3,703.7` were replaced by
  the REAL renderings: current_price "400000000000" @ 8dec → `4,000`,
  lowest_healthy_price "370370370371" @ 8dec → `3,703.70370371` (traced through
  renderNullableDecimal → formatUnits(trim) → groupDecimalString). The current
  mark is pinned WITH its label (`current weETH ≈ 4,000`) because a bare
  `4,000` already matches the weETH price-input row of the same card.
- Copy: label → `Health boundary price` (null AND value arms); trailing line →
  `· current {SYM} ≈ {mark} · still healthy at exactly this price (ceil P*)`
  (the "lowest healthy" fragment folded into the sentence); ExplainButton →
  `explain health boundary price`; drawer title + drawer null-arm row label
  renamed. Diagnostic / already-breached / no-price-path chips and the drawer
  BODY rows (lowest_healthy_price wire field, ceil disclosure,
  never_liquidatable) untouched — wire-field vocabulary is provenance, not
  presentation.
- prices[0]-undefined arm: noUncheckedIndexedAccess forces a branch — the
  em-dash arm renders the sentence WITHOUT the current clause (no invented
  mark beside a dash).
- Red run (web-3818-p03red.log): both p0-3 tests failed pre-implementation,
  first at the `Health boundary price` toBeVisible — the brief's predicted red.
- Mutant (applied alone, build + run; web-3818-p03mutA/B.log): value-arm label
  reverted to `Liquidation price`.
  1. p0-3 test alone: KILLED — first-failing assertion is the rename
     toBeVisible (the mutant removes the new label before the count pin is
     reached, so the run stops there).
  2. discriminating pin in isolation (scratch spec, deleted, never committed):
     KILLED at exactly `toHaveCount(0)` — Expected 0, Received 1 — the
     presence of old copy is itself pinned against.
- Suite after revert: p0-fixes + inspector + r1-fixes e2e — 50 passed.
  typecheck: only the pre-existing lab-runbook-lines.spec.ts(858) TS2322.

### p0-4 engine-specific ratio terminology (InspectorHistory + BookHistogram)

- Defect: the DM's disclosure ratio (maxBorrowLT/borrowings) wore "health
  factor" clothing in four places — the history section head, the DM
  sparkline's aria label, DM point hover titles ("HF ≈x.xxxx"), and Book's
  histogram panel heads printing raw wire tokens ("comparator: hf_num/hf_den")
  as reader copy.
- New pure copy (web/lib/history-series.ts): `historyHead(engine)` — Aave
  "Health factor across batches" / DM "Borrow headroom (disclosure) across
  batches" / no-claim "Plotted series across batches"; `pointTitlePrefix(engine)`
  — "HF" / "disclosure ratio" / "value"; `HISTORY_SECTION_HEAD = "Risk history
  across batches"`. `HF_HISTORY_HEAD` RETIRED (deleted). Serena
  find_referencing_symbols before deletion named its only consumers
  (InspectorHistory.tsx, history-copy.spec.ts); post-edit grep: zero stale
  references (only the plan doc mentions the name).
- HEAD-PLACEMENT DECISION (brief Step 3 NOTE): the section head at
  InspectorHistory.tsx:92 is a styled `<div className={styles.sectionHead}>`,
  NOT an `<h*>` element — no heading-level hierarchy exists, so no h-level
  skip is possible. The section keeps ONE neutral head (HISTORY_SECTION_HEAD)
  because the loading / error / unknowable / not-found states are not
  per-engine and must stay headed; the engine-specific claim moved INTO each
  card's header row (a `history-head-${engine}` span beside the EngineChip,
  rendering historyHead(engine.engine)). No CSS touched (inspector.module.css
  is outside the brief's Files list — the head reuses the historyMeta row).
- Hover-title builder: entryForPoint already received the engine
  (buildHistorySeries passes engine.engine — traced with
  find_referencing_symbols; no signature threading was needed). Its "HF"
  literal became pointTitlePrefix(engineName). Generic gap strings reworded:
  "no health factor published for this point" → "no plotted value published
  for this point"; "health factor carries neither wad nor num/den" → "the
  plotted series carries neither wad nor num/den".
- Sparkline aria label (InspectorHistory.tsx ~272): `${engine} health factor
  across retained batches` → engine-conditional seriesNoun ("health factor" /
  "borrow-headroom disclosure" / "plotted series"), same
  exact-match-with-no-claim-fallback arms as historyHead.
- Book (web/lib/book-copy.ts + BookHistogram.tsx:~78/~104 both arms): new
  `comparatorReaderLabel(comparator)` — "hf_wad" → "the pool's own health
  factor (wad)"; "hf_num/hf_den" → "maxBorrowLT/borrowings — a disclosure, not
  the engine's trigger"; an unknown token passes through verbatim. The
  "comparator:" prefix is dropped (the label is self-describing).
  riskBandPanelAria, DM_DISCLOSURE_LINE and referenceLegend untouched.
- Pins displaced (old → new):
  - tests/unit/history-copy.spec.ts:27-29: `HF_HISTORY_HEAD` exact pin ("the
    head says what the chart IS") → brief Step 1's two engine-specific tests
    (historyHead / pointTitlePrefix) + a HISTORY_SECTION_HEAD pin ("Risk
    history across batches").
  - tests/e2e/r1-fixes.spec.ts:437: hf-history containText "Health factor
    across batches" → hf-history containText "Risk history across batches"
    AND history-aave_v3_etherfi containText "Health factor across batches".
  - tests/e2e/book.spec.ts:203-204 (surfaced by the Step 4 grep — NOT
    book-charts.spec.ts / chart-spec-v4.spec.ts, which pin no comparator
    token): containText "comparator: hf_wad" / "comparator: hf_num/hf_den" →
    the two humanized labels.
  - UNCHANGED as required: tests/unit/history-series.spec.ts:236,244
    (engine-aware takeaways) pass verbatim; the Lab comparator pins
    (runbook-bsplit/runbook-transition e2e) target Lab components outside this
    brief and still pass.
- New specs: tests/unit/comparator-label.spec.ts (brief verbatim); a p0-4
  describe appended to tests/e2e/p0-fixes.spec.ts — the DM/Aave card heads +
  aria labels (the committed HISTORY fixture is aave-only, so the test derives
  ONE documented DM engine block — a computed num/den point, wad null, sweep
  mark — pushed beside the byte-identical aave block via a later route
  override on the p0-3 mock), and the Book humanization test (book.spec.ts's
  mock shape over the BOOK fixture).
- Red runs recorded: both unit specs failed at import (missing exports:
  comparatorReaderLabel / HISTORY_SECTION_HEAD); both p0-4 e2e tests failed
  pre-wiring (DM head not found at :368; raw "comparator: hf_num/hf_den"
  present at :386).
- Mutation kills (each applied alone, rebuilt, run in isolation, reverted):
  - Mutant A (historyHead returns the Aave string for every engine): KILLED at
    p0-fixes.spec.ts:368, the DM-head toBeVisible — the brief's predicted
    assertion.
  - Mutant B (comparatorReaderLabel passes "hf_wad" through): KILLED at
    p0-fixes.spec.ts:387, the humanized-label toBeVisible. DIVERGENCE from the
    brief's predicted toHaveCount(0) kill, recorded: the fix drops the
    "comparator: " prefix, so the mutant prints bare "hf_wad", which
    "comparator: hf_wad" can never match — the count pin stays 0 and the kill
    lands one assertion later, still inside the Book test, in isolation.
- Suite after reverts (rebuild + run): p0-fixes, inspector, r1-fixes,
  book-charts, chart-spec-v4, book e2e + history-copy, history-series,
  comparator-label unit — 164 passed. typecheck: only the pre-existing
  lab-runbook-lines.spec.ts(858) TS2322.

### p0-5 snapshot chip (freshness.ts + Ribbon + PostureRibbon)
- The change: snapshot freshness is its own ALWAYS-VISIBLE element
  (`ribbon-snapshot`, `snapshot #<id> · <humanAge> old`) beside the stream
  badge — never a >1h-only suffix inside it. Badge strings frozen and
  untouched: `LIVE · WATERMARKED`, `STREAM · *`, `NO SERVABLE BATCH` pass
  byte-identical in shell.spec.ts / state-matrix.spec.ts / r7-fixes.spec.ts.
  R6's arbitration mirrored one-to-one: `unresolved` → `snapshotChipUnknown`
  (refusal), else `snapshotChip(age.seconds ?? posture.batch.age_seconds)`;
  only a new receipt discharges the unknown.
- New pins: tests/unit/freshness-snapshot.spec.ts (2, brief verbatim);
  p0-fixes.spec.ts p0-5 (2 e2e — the stream mock is r7-fixes.spec.ts's REAL
  SSE-server mechanism, since `route.fulfill` ends the body and withdraws
  LIVE; the fixture snapshot frame carries the controlled `batch.age_seconds`).
- Testids retired: `ribbon-batch-age`, `ribbon-batch-age-unknown` →
  `ribbon-snapshot`. Migrated pins, old→new (feed fixture batch id is 1):
  - r3-fixes.spec.ts:196 `ribbon-batch-age` toHaveCount(0) [absence below 1h]
    → `ribbon-snapshot` toHaveText "snapshot #1 · 59m old" (policy inverted
    deliberately: always show).
  - r3-fixes.spec.ts:201 toHaveText "· batch 1h old" → toHaveText
    "snapshot #1 · 1h 0m old" (3610s through humanAge).
  - r4-fixes.spec.ts:181 toHaveCount(0) → toHaveText "snapshot #1 · 59m old".
  - r4-fixes.spec.ts:186 toHaveCount(0) [suspended, pre-resume] → toHaveText
    "snapshot #1 · 59m old" (no timer fired; the chip holds the pre-suspend
    reading until the resume reconciles).
  - r4-fixes.spec.ts:189 toHaveText "· batch 5h old" → toHaveText
    "snapshot #1 · 5h 59m old" (21550s through humanAge — the brief's sketch
    guessed "5h 0m"; the fixture computes 5h 59m, matching the book line's
    "5h 59m ago" beside it).
  - r6-fixes.spec.ts:212 toHaveCount(0) → toHaveText "snapshot #1 · 2m old".
  - r6-fixes.spec.ts:220 unknown toHaveText "· batch age UNKNOWN since resume
    · refreshing" → toHaveText "snapshot #1 · age UNKNOWN since resume ·
    refreshing" (register phrases unchanged, byte for byte).
  - r6-fixes.spec.ts:223 `ribbon-batch-age` toHaveCount(0) → `ribbon-snapshot`
    toHaveCount(1) (ONE chip carries the whole disclosure).
  - r6-fixes.spec.ts:226 unknown not.toContainText("old") → chip
    not.toContainText("old").
  - r6-fixes.spec.ts:242 unknown toBeVisible → chip toContainText
    "age UNKNOWN".
  - r6-fixes.spec.ts:248 toHaveText "· batch 3h old" → toHaveText
    "snapshot #1 · 3h 2m old" (10930s through humanAge).
  - r6-fixes.spec.ts:249 unknown toHaveCount(0) → chip
    not.toContainText("UNKNOWN").
  - r6-fixes.spec.ts:313, :319 unknown toHaveText refreshing-register →
    chip toHaveText "snapshot #1 · age UNKNOWN since resume · refreshing".
  - r6-fixes.spec.ts:328 unknown toHaveText failed-register → chip toHaveText
    "snapshot #1 · age UNKNOWN since resume · refresh failed, data retained".
  - r6-fixes.spec.ts:331 `ribbon-batch-age` toHaveCount(0) → chip
    not.toContainText("old").
  - r6-fixes.spec.ts:344 unknown toHaveText failed-register → chip toHaveText
    (as :328).
  - r6-fixes.spec.ts:564 toHaveCount(0) → toHaveText "snapshot #1 · 59m old".
  - r6-fixes.spec.ts:577 toHaveText "· batch 5h old" → toHaveText
    "snapshot #1 · 5h 59m old".
  - r6-fixes.spec.ts:578 unknown toHaveCount(0) → chip
    not.toContainText("UNKNOWN").
- DEVIATION (forced, ledgered): r7-fixes.spec.ts carries its own suffix pins
  the task brief's "only r3/r4/r6 migrate" enumeration missed; retiring the
  testids while leaving them would fail the file the brief requires to pass.
  The minimal failing set migrated — BADGE-STRING PINS UNTOUCHED:
  - r7-fixes.spec.ts:517 unknown toHaveText "· batch age UNKNOWN since resume
    · refreshing" → chip toHaveText "snapshot #1 · age UNKNOWN since resume ·
    refreshing".
  - r7-fixes.spec.ts:534 toHaveText "· batch 3h old" → chip toHaveText
    "snapshot #1 · 3h 2m old".
  - r7-fixes.spec.ts:587 toHaveText "· batch 1h old" → chip toHaveText
    "snapshot #1 · 1h 0m old".
  - Left untouched and now VACUOUS (retired-testid toHaveCount(0), pass
    trivially): r7-fixes.spec.ts:496, :535, :567. Flagged for cleanup when
    r7-fixes is in a task's file list.
- DEVIATION (forced, ledgered): app/styleguide/page.tsx:309 passed
  `batchAgeSuffix="· batch 3h old"` to Ribbon — the prop removal is a compile
  error, so the specimen migrated to `snapshot="snapshot #18251 · 3h 2m old"`.
- Retirement DEFERRED: `ribbonBatchAgeSuffix`, `ribbonBatchAgeUnknown` (and
  `RIBBON_STALE_BATCH_SECONDS`/`ageHours` they lean on) are retired from the
  RENDER PATH (no component imports them) but NOT deleted:
  find_referencing_symbols shows live consumers in tests/unit/freshness.spec.ts
  (:83–87, :164–173), tests/unit/freshness-resume.spec.ts (:181–190) and
  tests/unit/freshness-blind-resume.spec.ts (:344–353) — files outside Task
  5's list, so the zero-consumers deletion condition is not met. Flag for the
  task that owns those specs.
- Styling note: the chip renders in the old suffix's muted tone (`.snapshot`,
  --ink-3); the warn-coloured `.batchAgeUnknown` styling retires with its
  slot, so the unknown register is currently muted too — severity styling
  arrives with Phase 1's SLA (brief-directed).
- Red runs recorded: unit spec failed at import (no export `snapshotChip`);
  both p0-5 e2e tests failed at `ribbon-snapshot` element(s) not found (the
  LIVE badge assertion passing beside them) before the wiring landed.
- Mutation kills (each applied alone, rebuilt, run in isolation, reverted):
  - Mutant A (`snapshotChip` returns "" at ≤3600s — the old policy
    resurrected): KILLED in the p0-5 fresh-batch test at p0-fixes.spec.ts:477
    chip toBeVisible. DIVERGENCE from the brief's predicted "42s old" kill,
    recorded: an empty-string chip is falsy, so Ribbon renders no element at
    all and the kill lands one assertion earlier, still in isolation.
  - Mutant B (PostureRibbon passes `snapshotChip(...)` unconditionally,
    ignoring `unresolved`): KILLED at r6-fixes.spec.ts:221, the chip's
    `age UNKNOWN` toHaveText — received "snapshot #1 · 2m old", the
    understated computed age. The brief's predicted assertion exactly.
- Suite after reverts (rebuild + run): p0-fixes, shell, state-matrix,
  r3-fixes, r4-fixes, r6-fixes, r7-fixes e2e + freshness-snapshot,
  stream-posture, freshness-blind-resume unit — 110 passed, 1 pre-existing
  skip (styleguide-not-compiled, shell.spec.ts). typecheck: only the
  pre-existing lab-runbook-lines.spec.ts(858) TS2322.

### p0-6a pre-existing TS2322 repaired (lab-runbook-lines.spec.ts:858)

- The one error every task recorded as "the acceptable pre-existing failure"
  is repaired (controller-authorized, ahead of the close's full-suite step):
  the r89 contradictory-row fixture passed `symbol: null` where the wire type
  is `symbol?: string`. Fix IN THE SPEC FILE ONLY: the object literal is now
  explicit with the `symbol` key OMITTED — the same no-symbol shape the file's
  own `UNPRICED` fixture and the contract's own unpriced example use. The
  tested arm is unchanged (value_usd + unpriced:true ⇒ contradictory);
  `collateralReadingLine` never reads `symbol`. Spec re-run: 29/29 passed,
  the contradictory-row assertions included. `npm run typecheck`: COMPLETELY
  clean — zero errors repo-wide for the first time this phase.
- Commit: c2b74e8 `test(web): p0-6a repair pre-existing TS2322 in
  lab-runbook-lines spec - symbol omitted, unpriced arm unchanged`.

## Phase 0 CLOSE (p0-6) — seal

### Closing counts

- Suite: **1362 pre-phase → 1389 now** (+27 tests this phase:
  address-binding 6, matrix-outcome 5, comparator-label 2,
  freshness-snapshot 2, p0-fixes e2e 10, history-copy 9→11 net +2).
- Close run (post-p0-6a tree, `npm run build` + full
  `npx playwright test -c tests/playwright.p0.config.ts`, log
  `web-3818-p06full.log`): **1388 passed, 1 skipped, 0 failures (32.6s)** —
  exactly inventory (1389, via `--list`) minus the 1 pre-existing skip (the
  styleguide smoke self-skips unless NEXT_PUBLIC_SHOW_STYLEGUIDE=1 at build).
- `npm run typecheck`: **completely clean** (post-p0-6a).
- `npm run lint`: **0 errors**, 1 warning — `UnavailableError` unused in
  app/lab/LabBookPanel.tsx:27. PRE-EXISTING: the import is present at
  c320d4b^ (the pre-phase tree; file last touched by pre-phase 851032e).
  Not a Phase 0 regression; left for the task that owns LabBookPanel.
- Task-1 watch item (lab.spec.ts "?scenario=<id> auto-runs EXACTLY ONE
  scenario" flaked once during task 1): PASSED in the close's full run; the
  task-1 evidence stands (5/5 under --repeat-each=5 in isolation, whitespace-
  only intervening change) — recorded as a one-off flake, no action.

### Mutation transcript

- Formalized at `.superpowers/sdd/p0-mutations/` (mutations.json +
  transcript.md, t9w20 format): **8 distinct mutants, 10 isolated kill
  observations, 0 survivors** — all kills observed in isolation during tasks
  1–5 and transcribed from the task reports, not re-run. Count reconciliation
  vs the brief's "9": task 1 ran ONE mutant killed at BOTH tiers (e2e+unit);
  task 3 ran ONE mutant observed at TWO assertions; tasks 2/4/5 two each.
  Task 1's p0-1b red-first role=status assertion is test-first evidence, not
  a mutant.

### Pin-migration inventory (the phase's full displacement record)

- p0-1: none retired; new pins address-binding.spec.ts (6) + p0-fixes p0-1
  (2 e2e, one strengthened by p0-1b's role=status line).
- p0-2: NONE changed — lab.spec.ts:269-270 (`net eligible accounts +1` /
  `batch #1`) survives verbatim (fragment kept FIRST in the sub-line); the
  known count-duplication flagged above for Phase 3 remains open.
- p0-3: zero pre-existing pins (grep-confirmed); new pins pin the NEW copy
  and pin the OLD copy to count 0.
- p0-4 (old → new):
  - tests/unit/history-copy.spec.ts:27-29 — HF_HISTORY_HEAD pin → engine-
    specific historyHead/pointTitlePrefix tests + HISTORY_SECTION_HEAD pin.
  - tests/e2e/r1-fixes.spec.ts:437 — hf-history "Health factor across
    batches" → hf-history "Risk history across batches" AND
    history-aave_v3_etherfi "Health factor across batches".
  - tests/e2e/book.spec.ts:203-204 (grep-surfaced) — raw "comparator:
    hf_wad" / "comparator: hf_num/hf_den" → the two humanized labels.
- p0-5 (batch-age suffix → always-on snapshot chip; retired testids
  `ribbon-batch-age`/`ribbon-batch-age-unknown` → `ribbon-snapshot`):
  - r3-fixes.spec.ts:196, :201.
  - r4-fixes.spec.ts:181, :186, :189.
  - r6-fixes.spec.ts:212, :220, :223, :226, :242, :248, :249, :313, :319,
    :328, :331, :344, :564, :577, :578.
  - r7-fixes.spec.ts:517, :534, :587 (forced deviation, ledgered at p0-5;
    badge-string pins untouched) — plus the three now-vacuous retired-testid
    toHaveCount(0) lines (r7:496/:535/:567) flagged for cleanup.
  - app/styleguide/page.tsx:309 specimen migrated (compile-forced).
- Frozen and byte-identical throughout: every badge string (`LIVE ·
  WATERMARKED`, `STREAM · *`, `NO SERVABLE BATCH`) in shell.spec.ts /
  state-matrix.spec.ts / r7-fixes.spec.ts.

### Open flags carried forward (all ledgered above)

- Phase 3: drop the legacy `net eligible accounts +N` fragment and move
  lab.spec.ts:269's pin onto the composed part (p0-2 duplication).
- r7-fixes.spec.ts:496/:535/:567 vacuous toHaveCount(0) lines (p0-5).
- freshness.ts retired-from-render functions (`ribbonBatchAgeSuffix`,
  `ribbonBatchAgeUnknown`, `RIBBON_STALE_BATCH_SECONDS`/`ageHours`) await the
  task that owns their unit specs (p0-5).
- Unknown-register chip is muted, not warn-coloured, until Phase 1's SLA
  severity styling (p0-5, brief-directed).
- LabBookPanel.tsx:27 unused-import lint warning (pre-phase).
- Phase 1 Track B owns the typed-envelope generalization of result identity
  (p0-1 fixed the address-mode instance only).

**Phase 0 is COMPLETE pending Codex adversarial review** (dispatched by the
controller over the p0-0…p0-6 range per landing discipline).

## Phase 0 fix wave (p0-7) — the Lab border of the terminology fix

Post-review fix dispatch (final whole-branch review). Defect class: p0-4 made
DM terminology engine-specific on Inspector and Book, but the Lab still
dressed the same DM data in "health factor" vocabulary and printed raw wire
comparator tokens as reader copy — the vocabulary was uniformly wrong before
the phase and INCONSISTENTLY wrong after it. Four fixes, p0-4's conventions
mirrored exactly (exact-match engine ids with a no-claim fallback;
comparatorReaderLabel with the "comparator:" prefix dropped).

### The four fixes

1. `labRunBookLines.ts` — the histogram-shift head was a fixed "how the
   book's health factors moved under this scenario" over EVERY engine's pair.
   New `histogramShiftHead(engine)`: aave "…health factors moved…" / DM
   "…borrow-headroom disclosures moved…" (composing with p0-4's "Borrow
   headroom (disclosure)" vocabulary) / no-claim "…plotted values moved…";
   `histogramShiftReadingLine` now opens with it (keyed on the ENGINE ID —
   the head travels with the engine even when a test re-comparators a body).
2. `LabScenarioDetail.tsx` — the state pair's first row was `<td>health
   factor</td>` for DM pairs too. `result.engine` threaded into `LabStatePair`
   (new `engine` prop; both ResultView call sites) and the row renders
   `statePairRowLabel(engine)` (labPanelLines.ts): aave "health factor" / DM
   "borrow headroom (disclosure)" — the num/den IS maxBorrowLT/borrowings, a
   disclosure, never the trigger — / no-claim "served value".
3. `LabRunBookDetail.tsx` (histogram-pair panel title) AND
   `LabRunBookTransition.tsx` (matrix panel title) — both printed
   `comparator: {wire token}` as reader copy. Both now render
   `comparatorReaderLabel(token)` from web/lib/book-copy, prefix dropped,
   exactly as p0-4's Book change.
4. This ledger section (the migration record, the r7 anchor correction, and
   the Phase 1 input flag below).

### New pins (red-first, reds recorded)

- tests/unit/lab-runbook-lines.spec.ts: "p0-7: the shift head is
  engine-specific…" (three exact toBe arms) and "p0-7: the reading line
  CARRIES the engine's own head…" (DM fixture carries the DM head whatever
  the comparator token; the aave-rebadged body carries the health-factor
  head). RED: SyntaxError at load — no export `histogramShiftHead`
  (web-3818-p07red.log).
- tests/unit/lab-panel-lines.spec.ts: "p0-7: the state pair's row label is
  engine-specific…" (three exact toBe arms). RED: SyntaxError at load — no
  export `statePairRowLabel` (web-3818-p07red.log).
- e2e reds (web-3818-p07red-e2e.log, unfixed build): 3 failed exactly at the
  migrated pins — bsplit:77 (raw "comparator: hf_wad" still rendered),
  bsplit:101 (DM head still "health factors moved"), transition:271 (raw
  token) — 40 others passed.

### Pin migrations (old → new)

- tests/e2e/runbook-bsplit.spec.ts:74 — aave pair containText
  "comparator: hf_wad" → "the pool's own health factor (wad)" (now :77).
- tests/e2e/runbook-bsplit.spec.ts:77 — DM pair containText
  "comparator: hf_num/hf_den" → "maxBorrowLT/borrowings — a disclosure, not
  the engine's trigger" (now :80).
- tests/e2e/runbook-bsplit.spec.ts:96 — DM reading-line head containText
  "What this shows: how the book's health factors moved" → "What this shows:
  how the book's borrow-headroom disclosures moved" (now :101).
- tests/e2e/runbook-transition.spec.ts:268 — aave matrix containText
  "comparator: hf_wad" → "the pool's own health factor (wad)" (now :271).
- tests/e2e/runbook-transition.spec.ts:271 — DM matrix containText
  "comparator: hf_num/hf_den" → "maxBorrowLT/borrowings — a disclosure, not
  the engine's trigger" (now :274).
- Deliberately NOT added: count(0) pins on the "comparator: hf_*" prefix form
  — the P0M6 vacuity lesson (p0-mutations/transcript.md): with the prefix
  dropped, the prefixed pattern can never match either way, so a zero-count
  pin is vacuous. The positive assertions carry the kills.

### Mutation kills (each applied alone, observed in isolation, reverted)

- Mutant A (`histogramShiftHead` returns the Aave string for every engine):
  KILLED at lab-runbook-lines.spec.ts:249, the DM toBe — Expected
  "…borrow-headroom disclosures moved…", Received the Aave string
  (web-3818-p07mutA.log; unit tier, no rebuild needed).
- Mutant B (`statePairRowLabel` returns "health factor" for every engine):
  KILLED at lab-panel-lines.spec.ts:216, the DM toBe — Expected "borrow
  headroom (disclosure)", Received "health factor" (web-3818-p07mutB.log).
- Mutant C (LabRunBookDetail tag reverted to `comparator: {token}`): rebuild,
  KILLED at runbook-bsplit.spec.ts:77, the migrated positive containText
  (web-3818-p07mutC.log).
- Mutant D (LabRunBookTransition tag reverted to `comparator: {token}`):
  rebuild, KILLED at runbook-transition.spec.ts:271, the migrated positive
  containText (web-3818-p07mutD.log).
- Reverts proven: post-revert rebuild + covering set (lab-runbook-lines,
  lab-panel-lines, runbook-bsplit, runbook-transition, lab, p0-fixes) —
  140 passed (web-3818-p07post.log).

### r7 anchor CORRECTION (seal erratum)

The sealed pin-migration inventory and open-flags list cite the vacuous
retired-testid toHaveCount(0) lines as "r7-fixes.spec.ts:496/:535/:567". The
REAL lines are **:496 / :538 / :570** (`ribbon-batch-age` at :496 and :570,
`ribbon-batch-age-unknown` at :538 — grep-verified this wave). :496 was
right; :535→:538 and :567→:570 are corrected here; the sealed text above is
left as written. The cleanup flag itself is unchanged (still open, still
waiting for a task that owns r7-fixes.spec.ts).

### Phase 1 input flag

- snapshot # vs batch # noun fork — chip says snapshot, Feed/Proof say
  batch; resolve in Phase 1 status model.

### Closing counts (p0-7)

- Suite: 1389 → **1392** (+3: lab-runbook-lines 2, lab-panel-lines 1).
- Full run (final tree, `npm run build` + full p0-config suite,
  web-3818-p07full.log): **1391 passed, 1 skipped, 0 failed (33.3s)** —
  exactly inventory (1392 via `--list`) minus the 1 pre-existing
  styleguide skip.
- `npm run typecheck`: completely clean. `npm run lint`: 0 errors, the one
  pre-existing LabBookPanel.tsx:27 warning (ledgered at the seal).

## p0-8 · Codex adversarial round — two HONESTY-LAW fixes (fix wave)

Codex's Phase-0 adversarial round returned two findings; both fixed test-first
on main. House laws at stake: an unknowable never looks like a zero — or like
a health assertion.

### Finding 1 [high] — absent boundaries asserted as healthy (Inspector)

`renderLiquidationPriceRow` (InspectorPositionCard.tsx, reshaped by p0-3):
with `liquidation_price` non-null but `prices` EMPTY (contract-legal:
no-debt/no-factor solves) or `prices[0].lowest_healthy_price: null`
(NullableDecimal), the value arm rendered an em dash and STILL appended
"still healthy at exactly this price (ceil P*)" — and `boundary_is_healthy`
was never consulted anywhere. An unavailable boundary rendered as a positive
health claim (and, on the r1 blocker fixture, did so beside a liquidatable
verdict).

Fix (InspectorPositionCard.tsx):
- The exact-price health assertion renders ONLY when a numeric boundary
  exists (`prices[0]` present AND `lowest_healthy_price` non-null) AND
  `lp.boundary_is_healthy === true`.
- Absent boundary → a distinct not-established arm in the null-arm register
  (`boundary-not-established` testid): "not established — the solve published
  no boundary price on this axis", wire `reason` inline; the row's own
  refusal sentence in the hover (the committed `note` is a ceil-rendering
  instruction and does NOT carry this arm's register, so it stays off the
  row). The diagnostic/already-breached chips are boundary QUALIFIERS and do
  not render beside a no-boundary claim; the axis-scoped no-price-path badge
  keeps its R1 rule (never beside a liquidatable verdict).
- Boundary exists but `boundary_is_healthy: false` → value + current mark,
  no assertion.
- Consistency leg (lib/evidence.ts `liquidationPriceEvidence`): the drawer
  had the same defect — the "ceil disclosure" row asserted still-HEALTHY
  unconditionally for every non-null lp. Now: established+true → unchanged
  ceil row; established+false → "withheld — the wire does not certify health
  at exactly this boundary (boundary_is_healthy: false)" (warn); absent →
  "boundary · not established" (dim) with the wire reason.

New pins:
- e2e p0-fixes.spec.ts "p0-8 · absent boundaries refuse the health
  assertion": (a) empty `prices` (+ wire reason exposed), (b) null
  `lowest_healthy_price`, (c) `boundary_is_healthy: false` — all three pin
  `getByText(/still healthy/i)` count 0 on the card; (a)/(b) pin the
  not-established register visible; (c) pins boundary "3,703.70370371" +
  "current weETH ≈ 4,000" visible and opens the drawer (no "still HEALTHY").
  All structuredClone variants of the committed ADDRESS_FOUND, one documented
  purpose each, contract-legal per LiquidationPrice/FactorPrice.
- unit inspector-evidence.spec.ts: three drawer pins (empty prices / null
  boundary / declined) — no "still HEALTHY"; "not established" /
  "boundary_is_healthy: false" named.

Mutant (gate reverted — assertion unconditional): rebuild, KILLED at
p0-fixes.spec.ts:547, the (c) `still healthy` count-0 pin, in isolation —
(a)/(b) still pass under the mutant, exactly the discriminating pin.

### Finding 2 [medium] — malformed deltas suppressed into quiet zeros (Lab)

`isZeroDecimal` (matrixCells.ts, from p0-2) accepted "", "-", ".", "-.",
"00.00" as zero; run-book bodies are JSON-cast without runtime validation,
so a malformed/version-skewed delta was suppressed into "no effective
movement" — an unknowable rendered as a quiet zero. (Ledgered at Task 2 as a
deferred minor; Codex correctly re-graded the reachable path.)

Fix:
- matrixCells.ts: `WIRE_DECIMAL = /^-?[0-9]+$/` — the wire Decimal contract
  verbatim (confirmed against api/openapi.yaml `Decimal`/`NullableDecimal`,
  and the same pattern @solvent/client's `parseDecimal` throws on).
  `isWireDecimal` runtime-checks type AND pattern; `isZeroDecimal` tightens
  to `/^-?0+$/` and is called only on validated values. `CellOutcome` gains
  `{ kind: "malformed"; fields: string[] }`; `cellPrimaryOutcome` validates
  ALL FOUR read fields in read order (`newly_eligible_accounts` via
  Number.isInteger; the three Decimal strings incl.
  `market_realization.execution_shortfall_usd`) BEFORE any zero/movement
  decision and returns the malformed arm naming every failing field.
- LabMatrix.tsx Cell: the malformed arm renders in the withheld cell's frame
  (`cellWithheld` class, `data-cell-outcome="malformed"`): tag "MALFORMED
  RESULT", sub naming the fields — no dollar value, no quiet line, "and
  unreadable is not zero".
- LabBookPanel.tsx EngineResult: the red run EXPOSED A CRASH the finding did
  not name — the panel below the matrix renders the same body through
  `renderSignedUsdAmount` → `parseDecimal`, which THROWS on non-contract
  strings, and the route's error boundary took the WHOLE /lab page ("This
  page couldn't load"), making the mandated cell register unreachable.
  EngineResult now consults the SAME `cellPrimaryOutcome` decision (one law,
  one function) and renders a per-engine MALFORMED RESULT panel naming the
  fields instead of throwing the page away. Scope note: only the four
  outcome fields are gated; other malformed fields elsewhere in a body still
  fail noisy (pre-existing, unchanged).

New pins:
- unit matrix-outcome.spec.ts: ""/"-"/"."/"0.0"/"1e5"/" 0"/"0 " each →
  `{kind:"malformed", fields:["bad_debt_delta_usd"]}`; shortfall named by
  wire path; non-integer `newly_eligible_accounts` malformed; multi-field
  naming in read order; "-0"/"000" still quiet (contract-legal zeros).
- e2e p0-fixes.spec.ts "p0-8 · malformed deltas refuse the quiet arm":
  structuredClone variant, `bad_debt_delta_usd: ""` — settle gate, then the
  kill pin `not.toContainText("no effective movement")` BEFORE the positive
  pins (register visible, field named, `data-cell-outcome="malformed"`), so
  the quiet-routed mutant dies at the absent-pin in isolation.

Mutants (2):
- (i) validation removed, old regex restored (unit tier, no rebuild):
  KILLED — 10 unit deaths at the malformed pins (every bad-value case +
  shortfall + newly-eligible + read-order), each receiving `{kind:"quiet"}`.
- (ii) Cell malformed arm routed to quiet (EngineResult guard left intact to
  isolate the cell): rebuild, KILLED at p0-fixes.spec.ts:582 — the
  absent-pin, with the mutant's own rendering captured ("…net eligible
  accounts +1 · no effective movement · batch #1").

### Red-first evidence

Implementation stashed (`git stash push` of the five source files), pre-fix
build: 13 unit failures (10 matrix-outcome + 3 inspector-evidence) and 4 e2e
failures — exactly the new pins. The malformed e2e's pre-fix failure mode was
the whole-page crash above, which is what surfaced the EngineResult throw.

### Closing counts (p0-8)

- Suite: 1392 → **1410** (+18: matrix-outcome 11, inspector-evidence 3,
  p0-fixes e2e 4).
- Full run (final tree, `npm run build` + full p0-config suite,
  web-3818-p08full.log): **1409 passed, 1 skipped, 0 failed (35.4s)** —
  prior 1391 + 18 new, the same single pre-existing styleguide skip, no
  other movement.
- `npm run typecheck`: completely clean.

## p0-9 — Codex round 2 fixes (parent summaries, superseded cells, null prices)

Codex round 2 on the p0-8 work returned three findings; all three fixed
test-first. House laws unchanged: refusals render honestly, unknowable never
looks like zero, and a malformed wire value must never crash a route NOR
render as a number.

### Finding 1 [high] — the PARENT summary crashed before the per-engine guards

LabBookPanel.tsx `BookResult` evaluated `bookResultAnswer(response.engines)`
(which parses `eligible_debt_delta_usd` through the throwing money
renderers) BEFORE the guarded `EngineResult` children rendered — so a
malformed `eligible_debt_delta_usd` (e.g. "") took the whole /lab route down
through the error boundary. p0-8's e2e only corrupted `bad_debt_delta_usd`,
which the parent sentence never parses; the crash path was untested.

Fix:
- LabBookPanel.tsx BookResult: every engine is classified FIRST with
  `cellPrimaryOutcome` (matrixCells.ts — the SAME decision the cell and the
  engine panel read; one law, one function). Any malformed engine → the
  answer line renders `bookResultMalformedAnswer` instead of the composed
  numeric sentence, while the per-engine panels still render (the malformed
  one as p0-8's MALFORMED panel, healthy ones whole).
- labPanelLines.ts: `bookResultMalformedAnswer` — the answer line's refusal
  register, mirroring the existing no-engines refusal: names every malformed
  engine and its fields, "makes no numeric claim", "failed the wire Decimal
  contract", "Unreadable is not zero", composes no figure.

New pins:
- e2e p0-fixes.spec.ts "finding 1": structuredClone variant,
  `engines[0].eligible_debt_delta_usd = ""` — route stays live (cell
  settles, `data-cell-outcome="malformed"`), matrix cell AND detail panel
  name the field, parent answer refuses ("makes no numeric claim", engine +
  field named, composed sentence absent), healthy debt_manager panel whole.
- unit lab-panel-lines.spec.ts: `bookResultMalformedAnswer` names every
  engine/field, claims no number (no "$"), never collides with the composed
  sentence's opening.

Mutant (pre-guard bypassed — ternary condition inverted so the composed
sentence always runs): rebuild, KILLED at p0-fixes.spec.ts:657 — the
route-stays-live settle pin, in isolation (the throw unmounts the route and
no cell ever reads "result").

### Finding 2 [medium] — superseded cells rendered their payload unclassified

LabMatrix.tsx's MALFORMED branch existed only for `state="result"`. A
SUPERSEDED cell rendered the held payload through the old composition:
malformed `bad_debt_delta_usd` quietly showed the eligible-debt dollars
(the quiet bypass, again), and malformed `eligible_debt_delta_usd` threw in
`usd()` → route crash.

Fix:
- LabMatrix.tsx superseded arm: the held result payload goes through
  `cellPrimaryOutcome` BEFORE rendering. Malformed → the malformed register
  (`data-cell-outcome="malformed"`, fields named, "unreadable is not zero")
  PLUS the existing superseded batch disclosure (old batch id, anchor batch
  id, the re-run affordance — supersession states WHEN the cell was
  measured; it never launders WHETHER it can be read). Valid → the current
  rendering, unchanged; withheld payloads unchanged.

New pins (Codex's mixed-batch construction — corrupted eth_minus_30 at
batch 1, valid weeth batch-2 fixture supersedes it, per lab.spec.ts's own
SUPERSESSION mock):
- e2e "finding 2a" (quiet bypass): `bad_debt_delta_usd = ""` → superseded +
  malformed register + field named; the $6,000 the old arm composed never
  renders; batch ids and re-run affordance survive; the SAME row's valid
  debt_manager payload still shows "$1,500" (valid arm unchanged, same
  mixed-batch state).
- e2e "finding 2b" (crash): `eligible_debt_delta_usd = ""` → route stays
  live, superseded + malformed register + field named + batch disclosure.

Mutant (superseded arm's guard forced false, result arm intact): rebuild,
KILLED at both mixed-batch pins in isolation — 2b at p0-fixes.spec.ts:743
(the settle pin; `usd()` throws and the route unmounts), 2a at the
malformed-register pin (the quiet dollars render instead).

### Finding 3 [medium] — `prices: null` crashed before the not-established arm

The API's solver-error path serializes `liquidation_price.prices: null` (a
Go nil slice), violating api/openapi.yaml's required-array contract —
`lp.prices[0]` in InspectorPositionCard.tsx threw before p0-8's
not-established arm could render. UI-SIDE FIX ONLY: the server change is
outside this program's preservation boundary; no Go code touched.

**API defect (outside program scope): solver-error wireLiquidationPrice
serializes prices:null, violating the openapi required-array contract —
server-side slice init needed; UI defends meanwhile.**

Fix:
- InspectorPositionCard.tsx `renderLiquidationPriceRow`: a non-array/null
  `prices` folds into the existing not-established arm
  (`Array.isArray` guard → `first` undefined), with `lp.reason` still
  exposed inline. Same statement as an empty array: the solve published no
  boundary.
- lib/evidence.ts `liquidationPriceEvidence`: same defense (`servedPrices`),
  covering both the `[0]` index and the `.map` over rows.

New pins (structuredClone variants documented as REPRODUCING the server's
actual solver-error serialization — contract-violating but observed;
`as never` marks the deliberate violation):
- e2e "finding 3": `liquidation_price.prices = null as never` + a reason —
  card renders, `boundary-not-established` register + reason visible, no
  health claim, no crash.
- unit inspector-evidence.spec.ts: the drawer folds the same body into the
  not-established arm — reason exposed, no "still HEALTHY", no crash.

Mutant (both defenses removed — card index + evidence servedPrices):
rebuild, KILLED at both pins in isolation — the e2e at
p0-fixes.spec.ts:773 (the renders-without-crash visibility pin; the card
never paints) and the unit drawer pin (TypeError surfaces).

### Red-first evidence

Pre-fix build (HEAD source + the new specs): 5 failures, exactly the new
defect pins — finding 1 and finding 2b dead at route-crash (the parent
throw unmounts /lab), finding 2a at the missing malformed register,
finding 3 e2e + the drawer unit at the prices:null crash. The
`bookResultMalformedAnswer` unit's red was the module-level missing-export
failure (the function IS part of the fix).

### Closing counts (p0-9)

- Suite: 1410 → **1416** (+6: p0-fixes e2e 4, lab-panel-lines 1,
  inspector-evidence 1).
- Full run (final tree, `npm run build` + full p0-config suite):
  **1415 passed, 1 skipped, 0 failed (35.7s)** — prior 1409 + 6 new, the
  same single pre-existing styleguide skip, no other movement.
- `npm run typecheck`: completely clean.

## Phase 0 CLOSE (2026-08-09, owner-ratified)

Codex rounds: r1 (2 findings -> p0-8), r2 (3 findings -> p0-9), r3 (NO-SHIP on the
malformed-wire class). Owner ruling at the loop breaker: ACCEPT Phase 0 and route the
malformed-wire class to Phase 1 Track B (program design amended in the same commit).
Open Codex r3 findings carried to Track B: LabBookPanel gate validates a subset of the
engine subtree (aggregates/nested monetary fields unguarded); FactorPrice entries
trusted (null entry / malformed decimals / missing price_decimals reach money());
tornado/set-run path uses permissive BigInt with no classification (tornadoCells.ts
barLength). API defect (server-side, out of program scope): solver-error
wireLiquidationPrice serializes prices:null violating the required-array contract.

Phase 0 delivered: five trust fixes (p0-1..p0-5), Lab terminology border (p0-7), two
Codex hardening waves (p0-8, p0-9). Suite 1362 -> 1415 passed + 1 skip; typecheck clean;
lint 0 errors/1 pre-existing warning; 15 mutants killed in isolation
(.superpowers/sdd/p0-mutations/ + p0-7/8/9 ledger sections). Commits c320d4b..8771342.

## Phase 1 Track B — response-boundary validation

Program design: the malformed-wire class Phase 0's Codex r3 NO-SHIP routed
here (owner ruling at the loop breaker). Verification runs on its OWN wave
config, `web/tests/playwright.p1b.config.ts` (port 3819; a byte-mirror of
`playwright.p0.config.ts` except port + header comment).

**Track B baseline inventory** (`npx playwright test -c
tests/playwright.p1b.config.ts --list`, recorded BEFORE the first Track B
spec): **1416 tests in 83 files**.

Task list:
- [x] Task 0 — wave config + honest route error boundary (p1b-0)
- [x] Task 1 — wire-guard module + BigInt coercion kill (p1b-1)
- [x] Task 2 — full RunBookEngine classifier (p1b-2)
- [x] Task 3 — SetRunEngineSummary classifier + tornado malformed arm (p1b-3)
- [x] Task 4 — FactorPrice entry guard (p1b-4)
- [x] Task 5 — result-identity module + address-mode completion (p1b-5)
- [x] Task 6 — five-gap race/identity audit close (p1b-6)
- [ ] Task 7 — close + Codex round

### p1b-0 · wave config + honest route refusal (Task 0)

No `error.tsx`, `global-error.tsx`, or custom React boundary existed
anywhere under `web/app`: a client-render throw (e.g. a wire Decimal outside
`^-?[0-9]+$` reaching a throwing money renderer) replaced the ENTIRE route —
header included — with Next's generic error page. On this Next build the
generic page reads `heading "This page couldn’t load"` + Reload/Back (the
recorded red run's page snapshot), not the older "Application error: a
client-side exception" body; the spec pins BOTH copies absent.

Delivered:
- `web/tests/playwright.p1b.config.ts` — the Track B wave config (above).
- `web/app/error.tsx` — ROOT boundary, one boundary above all surfaces
  (every surface is one client component under `layout.tsx`; per-route
  boundaries add nothing). It replaces only the segment BELOW `layout.tsx`,
  so the header/nav stay mounted — pinned via `getByRole("banner")`.
- `web/components/RouteRefusal.tsx` — the refusal register at route scale:
  head "THIS VIEW REFUSED TO RENDER" (DOM text is the readable sentence;
  uppercase is CSS `text-transform`, the `.statLabel` pattern), body "A
  value in the served data could not be read, and an unreadable value is
  never rendered as a number. Nothing is claimed for this view.", the
  throw's message (+ digest when present) behind a mono `<details>`
  evidence disclosure, and a "try again" button calling `reset()`.
  Testid `route-refusal`, `role="alert"`.
- `primitives.module.css` `.routeRefusal*` — the `RefusedTag` refused tone
  (dashed `--ink-3` border, muted inks, mono label at `--track-refused`) at
  block scale; existing tokens only.
- `web/tests/e2e/p1b-fixes.spec.ts` — the Track B pin file, mock helpers in
  p0-fixes.spec.ts's register (`mockBookWith`: stream aborted, CORS on every
  fulfilled response, cursor-aware positions pages; single documented
  fixture change: `BOOK.engines[0].total_debt = ""`, which throws
  `DecimalFormatError` in `BookStatRows`' total-debt stat row).

### Red-first evidence

Pre-fix build (HEAD source + the new spec + the new config): 1 failure,
exactly the defect pin — dead at the `route-refusal` visibility assertion
(p1b-fixes.spec.ts:69), page snapshot showing the generic error page with NO
banner (the whole route, header included, was gone).

### Mutation kill (p1b-0-M1)

Mutant: `web/app/error.tsx` rethrows (`throw error;` — boundary disabled).
Rebuild, spec run in isolation: KILLED at exactly the `route-refusal`
visibility assertion (p1b-fixes.spec.ts:69). Reverted; final tree rebuilt.

### Closing counts (p1b-0)

- Track B suite: 1416 → **1417** (+1: p1b-fixes e2e).
- Full run (final tree, `npm run build` + full p1b config, port 3819):
  **1416 passed, 1 skipped, 0 failed (34.2s)** — the same single
  pre-existing styleguide skip, no other movement.
- `npm run typecheck`: completely clean.
- `npx eslint` on all four touched files: 0 errors, 0 warnings.

### p1b-1 · shared wire guard + the BigInt coercion class (Task 1)

`BigInt("")` and `BigInt(" ")` silently coerce to `0n`, and `BigInt("0x10")`
to `16n` — all outside the wire Decimal contract (`^-?[0-9]+$`). Every bare
`BigInt(wireString)` site could therefore launder a malformed field into a
measured zero or a plausible wrong number (the p0-8 class, reachable again).
And p0-8's own primitives were module-private to `matrixCells.ts`.

Delivered:
- `web/lib/wireGuard.ts` — the SHARED guard: `WIRE_DECIMAL`,
  `isWireDecimal`, `isZeroDecimal` (extracted from `matrixCells.ts`
  byte-for-byte), `isWireScale` (integer in [0,1000], mirroring
  `assertScale`'s bounds in `@solvent/client`), `isWireCount`,
  `wireBigInt` (null unless the contract matches — NEVER throws, NEVER
  coerces; the only sanctioned string→bigint path), and
  `malformedFields` (`FieldCheck[]` → failed names, in read order).
- `web/app/lab/matrixCells.ts` — rebased on the shared module; exports and
  behavior UNCHANGED (`matrix-outcome.spec.ts` green unmodified, 16/16).
- `web/app/lab/badDebtRate.ts` — `sideOf` validates FIRST in read order
  (`bad_debt_usd`, `eligible_debt_usd`, `usd_decimals`); a failing field
  routes to the module's OWN contradiction arm naming the field ("an
  unreadable value is never divided and never zero"). Before: an empty
  eligible read as the "$0 of eligible debt" RATE CONTRADICTION (a claim off
  a value nobody could read), `0x10` computed a rate from 16n, and a
  fractional `usd_decimals` threw RangeError at the dust boundary.
  `ratePercentLabel` refuses a hand-built malformed side as "unreadable"
  instead of printing `BigInt("")` as "0.0%".
- `web/app/lab/labRunBookLines.ts` — `belowOneCount` returns `number |
  null`: null when the scale or any non-null bucket bound is outside the
  contract (the wire's own `held_rows`/`lane_changed_rows` null being the
  module's established cannot-compose state); the old read judged every
  bucket against `BigInt("") === 0n`. `histogramShiftReadingLine` refuses
  BEFORE composing (“The below-1.00 populations are NOT stated here…”, the
  register it already refuses in). `collateralReadingLine`'s r89 sum weld
  reads through `wireBigInt` with per-index field names
  (`collateral_by_asset[i].value_usd`, `total_collateral_usd`) routed to the
  COLLATERAL CONTRADICTION arm; the old read summed an empty value as $0
  with the weld HOLDING (a verified-looking sum over an unreadable row), and
  a malformed total threw in `labUsd` after the comparison had already
  coerced.
- `web/tests/unit/wire-guard.spec.ts` — the p0-2 bad-value loop, the
  coercion kill (`wireBigInt("") === null`, `"0x10"` null, `"-15"` →
  `-15n`), `-0`/`000` zero, scale bounds, count integrality, field naming.
- Extended: `bad-debt-rate.spec.ts` (+4), `lab-runbook-lines.spec.ts` (+5).

No new register anywhere: every malformed arm routes to a refusal
composition its module already had (Task 2 owns the engine-level register).

### Red-first evidence

- `wire-guard.spec.ts` before the module existed: run dies at collection —
  `Cannot find module '…/web/lib/wireGuard'`.
- The 9 consumer pins against the UNFIXED modules: 9 failed / 38 passed in
  the two extended files, each at its laundering — empty eligible produced
  kind "rate"→the $0-of-eligible contradiction text (no field name), `0x10`
  produced kind "rate", `usd_decimals: 2.5` produced `RangeError: The number
  2.5 cannot be converted to a BigInt`, `ratePercentLabel` printed "0.0%",
  `belowOneCount` returned coerced counts, the collateral weld printed
  "2 assets sum to $8,000" over an empty value_usd, and the malformed total
  threw `DecimalFormatError` in `labUsd`.

### Mutation kills (p1b-1-M1, p1b-1-M2)

- M1: `wireBigInt` reverts to bare `BigInt` (try/catch, coercion alive).
  `wire-guard.spec.ts` “THE COERCION KILL” in isolation: KILLED at exactly
  `expect(wireBigInt("")).toBe(null)` (wire-guard.spec.ts:68) — Expected
  null, Received 0n. Reverted.
- M2: `sideOf`'s null arm routed back to zero (`wireBigInt(…) ?? 0n`,
  refusal branch reduced to the scale check). `bad-debt-rate.spec.ts`
  “p1b-1: an EMPTY eligible” in isolation: KILLED at exactly the refusal
  pin's field-naming assertion (bad-debt-rate.spec.ts:140) — the coerced
  zero resurrected the "$0 of eligible debt" claim with no field named.
  Reverted; final tree re-verified.

### Closing counts (p1b-1)

- Track B suite: 1417 → **1435** (+18: wire-guard 9, bad-debt-rate 4,
  lab-runbook-lines 5).
- Full run (final tree, `npm run build` + full p1b config, port 3819):
  **1434 passed, 1 skipped, 0 failed (34.0s)** — the same single
  pre-existing styleguide skip, no other movement.
- `npm run typecheck`: completely clean.
- `npx eslint` on all seven touched files: 0 errors, 0 warnings.

### p1b-2 · the full RunBookEngine subtree classifier (Task 2)

Closes Codex round-3 finding 1. The p0-9 gate (`cellPrimaryOutcome`'s
malformed arm) validated 4 of the ~40+ numeric wire fields the run-book
detail subtree consumes; every other field fed a THROWING renderer (the
route boundary took the page: `LabRunBookDetail.tsx` money/BigInt sites,
`flipRanking.ts:197`, `moverDumbbells.ts` BigInt sites) or a
silently-PERMISSIVE coercion — Task 1's review proved
`hf_transitions.wad_scale: ""` passes `readTransitions`' margin arithmetic
untouched and coerces to a "0 entered / 0 exited" costume in
`belowOneLanes`.

Delivered:
- `web/app/lab/engineClassification.ts` — `classifyRunBookEngine(engine):
  { malformedFields: string[] }`, a pure, never-throwing walker over the
  WHOLE engine in wire read order, on `wireGuard` primitives
  (`isWireDecimal`/`isWireScale`/`isWireCount`/`malformedFields`), with
  array fields named PER INDEX (`movers[2].hf_before_wad`,
  `before.hf_histogram.buckets[0].upper_wad`,
  `hf_transitions.outflows[3].cells[0].debt_before_usd`). Inventory:
  `usd_decimals`; before/after × {accounts, eligible_accounts,
  total_collateral_usd, total_debt_usd, eligible_debt_usd,
  collateral_at_risk_usd, bad_debt_usd, hf_histogram.wad_scale,
  buckets[].upper_wad, collateral_by_asset[].decimals/amount/value_usd};
  `hf_transitions.wad_scale` + `lanes[].upper_wad` +
  `outflows[].cells[].debt_before_usd/debt_after_usd`;
  `newly_eligible_accounts`; the two deltas; `movers[].hf_before_wad/
  hf_after_wad/hf_drop_wad/debt_usd`; `market_realization.*` when served;
  `projection.horizons[].debt_usd/projected_usd/additional_interest_usd`
  when served. Nullability mirrors the generated schema EXACTLY — a
  `NullableDecimal` null (unbounded top bucket, unmeasured cell debts,
  the other engine's mover vocabulary, an unpriced `value_usd`) is a
  STATEMENT, never malformed; a missing/mis-shaped required subtree is
  named as its own malformed field instead of throwing.
- `web/app/lab/matrixCells.ts` — `cellPrimaryOutcome`'s malformed arm
  DELEGATES to the classifier (one law, one function); its own 4-field
  check is folded in under unchanged field names. `CellOutcome` shape
  unchanged, so the cell, the superseded payload, the engine panel and the
  parent summary all refuse on the same classification with no invocation
  change.
- `web/app/lab/labTransition.ts` — the LAYERED in-module defense
  (controller addition 1): `readTransitions` refuses a `wad_scale` or any
  non-null `lanes[].upper_wad` outside the wire contract BY NAME (the
  module's own refusal composition — it does not trust the upstream gate),
  and `belowOneLanes` reads bounds only through `wireBigInt` — the null
  arm admits no lane, where `BigInt("")` judged every bucket against 0n
  and `BigInt("0x10")` put a radix literal "below one" as 16.
- `web/app/lab/LabBookPanel.tsx` — gate comments updated; invocation sites
  and register unchanged (both gates read `cellPrimaryOutcome`).
- `web/tests/unit/engine-classification.spec.ts` (17 tests) — skeleton is
  the committed `run-book.eth_minus_30.json` engine; one documented
  corruption per test, exact `malformedFields` pins, per-index naming,
  schema-legal-null cleanliness, wire read order across the subtree, and
  the controller's OWN `hf_transitions.wad_scale` unit pin.
- `web/tests/unit/lab-transition.spec.ts` (+2) — `wad_scale: ""` REFUSES
  the matrix by name (it was ACCEPTED before); a radix-prefixed lane bound
  is refused per index and `belowOneLanes` yields `[1]`, never the coerced
  `[0, 1]`.
- `web/tests/unit/matrix-outcome.spec.ts` — the `engine()` helper is now a
  WHOLE contract-legal engine (fixture clone, outcome fields zeroed by
  default) instead of the old 4-field skeleton, which the full classifier
  would rightly refuse. Every pin and every exact `fields` list survives
  UNCHANGED (16/16) — no old→new pin movement to ledger.
- `web/tests/e2e/p1b-fixes.spec.ts` (+2, p1b-2) — run-book mocks in
  p0-fixes' register; (a) `before.total_debt_usd: ""` → the route stays
  live, cell and engine panel read the malformed register naming
  `before.total_debt_usd`, the healthy debt_manager panel renders whole;
  (b) `movers[0].hf_before_wad: "1e5"` → same register, per-index name.

Out of scope, ledgered for Task 5/6: `LabScenarioDetail.tsx:50` is the
ADDRESS-stress path's bare-BigInt site — NOT under `RunBookEngine`, not
covered by this classifier. The remaining run-book bare-BigInt sites
(`LabRunBookDetail.tsx:122/:200/:431/:728/:732/:862`, `flipRanking.ts:197`,
`moverDumbbells.ts:161/:210-211/:228-229`) are DEFENDED UPSTREAM: a
malformed engine never reaches them.

### Red-first evidence

- `engine-classification.spec.ts` before the module existed: dies at
  collection — `Cannot find module '…/app/lab/engineClassification'`.
- The two lab-transition pins against the UNFIXED module:
  `wad_scale: ""` was ACCEPTED (`reasonsFor` threw "expected this body to
  be refused, and it was accepted" — the exact Task-1-review defect), and
  the radix bound was refused only by the byte-identity join, with no
  wire-contract reason naming `lanes[0].upper_wad`.
- The two p1b-2 e2e pins against the UNWIRED build: both dead at the
  settle pin (`data-cell-state "result"` — element not found): the render
  threw in the engine panel, the route boundary replaced the segment, and
  no cell ever settled.

### Mutation kills (p1b-2-M1, p1b-2-M2, p1b-2-M3)

- M1: the classifier SKIPS the aggregates group (both `aggregateChecks`
  calls removed). Rebuild, aggregate e2e pin in isolation: KILLED at
  exactly the settle pin (p1b-fixes.spec.ts:182) — the malformed
  `before.total_debt_usd` reached the throwing renderer and the boundary
  took the segment. Reverted; rebuilt.
- M2: per-index naming replaced by a bare group name
  (`movers.${field}`). Unit per-index pin in isolation: KILLED at exactly
  engine-classification.spec.ts:246 — expected
  `["movers[2].hf_before_wad"]`, received `["movers.hf_before_wad"]`.
  Reverted.
- M3 (controller addition 1's kill): `transitionChecks` drops the
  `hf_transitions.wad_scale` check. Its OWN unit pin in isolation: KILLED
  at exactly engine-classification.spec.ts:198 — expected
  `["hf_transitions.wad_scale"]`, received `[]`. Reverted; final tree
  re-verified.

### Closing counts (p1b-2)

- Track B suite: 1435 → **1456** (+21: engine-classification 17,
  lab-transition 2, p1b-fixes 2).
- Full run (final tree, `npm run build` + full p1b config, port 3819):
  **1455 passed, 1 skipped, 0 failed (35.2s)** — the same single
  pre-existing styleguide skip, no other movement; `p0-fixes` (p0-8/p0-9
  pins), `matrix-outcome` and `lab.spec` all green inside it.
- Committed-fixture sweep: every engine of every committed `run-book.*.json`
  fixture classifies CLEAN — the law refuses no served body.
- `npm run typecheck`: completely clean.
- `npx eslint` on all eight touched files: 0 errors; 1 PRE-EXISTING
  warning in `LabBookPanel.tsx` (`UnavailableError` unused at :27 —
  present on the untouched HEAD file too; this task's diff there is
  comments-only).

### p1b-3 · SetRunEngineSummary classifier + the tornado's malformed arm (Task 3)

Closes Codex round-3 finding 3. The tornado/set-run path had ZERO decimal
validation: `barLength` called bare `BigInt` — `""` coerced to a silent 0n
(an empty denominator wore the no-denominator sentence "carries no debt on
the before side", a measurement claim off a value nobody could read; an
empty delta wore the measured-zero costume), and `"-"` threw
`SyntaxError: Cannot convert - to a BigInt` (recorded at
tornadoCells.ts:493) which the route boundary ate — and the ledger's
`renderSignedUsdAmount`/`renderUsdAmount` calls threw on malformed deltas,
scales, realization and projection fields, replacing the whole tornado.
`tornadoCellState` had identity/coverage arms but no malformed arm.

Delivered:
- `web/app/lab/setRunClassification.ts` — `classifySetRunEngine(engine):
  { malformedFields: string[] }`, sibling of `engineClassification.ts`
  (p1b-2): wireGuard primitives, per-index naming
  (`projection.horizons[1].projected_usd`), never throws, nullability
  mirrors the generated schema EXACTLY (`flipped_to_eligible` /
  `hf_dropped_accounts` null are the engines' own vocabulary statements;
  the two blocks judged only when served; a mis-shaped served block is
  named as its own field). SCOPE IS THE CONSUMED SET, BY DECISION
  (recorded in the module header + pinned in the spec): `usd_decimals`,
  `accounts`/`movement_excluded_accounts` (+ the two nullable movement
  subjects when non-null), `eligible_debt_delta_usd`,
  `total_debt_usd_before`, `market_realization.{execution_shortfall_usd,
  bad_debt_at_liquidation_usd,usd_decimals}` when served,
  `projection.horizons[].{debt_usd,projected_usd,additional_interest_usd}`
  when served. Served-but-unconsumed fields (`before_bad_debt_usd`,
  `total_debt_usd_after`, the census counts, …) are OUT of scope: a
  classifier refusing a renderable row over a field no renderer reads
  would refuse real answers over dead weight.
- `web/app/lab/tornadoCells.ts` — `TornadoCellState` gains
  `{ state: "malformed"; fields }`; the arm runs AFTER the
  set/identity/coverage gates (a malformed row is still identity-bound; a
  moved definition keeps precedence — pinned) and BEFORE the reach switch
  (a reach sentence is a measurement claim; this row was not read), fields
  named `engines[i].<field>`. `barLength` reads ONLY through `wireBigInt`;
  `BarLength` gains a typed `{ drawn: false; reason: "malformed"; fields;
  sentence }` refusal — unreachable in the composed surface (the cell
  gate runs first), kept so a gate-skipping caller meets a named arm,
  never a coerced 0n and never the no-denominator sentence.
- `web/app/lab/tornadoLines.ts` — `tornadoHeaderLine` takes
  `malformedScenarioIds`: malformed rows leave BOTH reach counts (not
  read), KEEP the absence count (their batch disclosures still render, so
  the header states the page's own arithmetic), and get their own NAMED
  clause `malformed, not read: N (ids)` — never silently dropped from the
  drawn-count arithmetic.
- `web/app/lab/LabTornado.tsx` — the malformed row state
  (`data-state="malformed"`, p0-8 register voice: fields named,
  "nothing is claimed, and unreadable is not zero"); the ledger keeps the
  row's PLACE as one register row (`tornado-ledger-malformed`) while the
  numeric columns and block rows render only for non-malformed rows, so
  no unreadable value reaches a money renderer; the panel's `!drawn`
  branch splits by reason (a malformed engine renders a MALFORMED caption
  rather than a mislabelled NO DENOMINATOR — defense-in-depth for the
  unreachable arm); malformed rows excluded from bars/geometry/drawn
  counts by construction.
- `web/tests/unit/set-run-classification.spec.ts` (10 tests) — skeleton
  is the committed `run-book-set.no-denominator.json` engines; clean
  sweep over all three committed set fixtures; one documented corruption
  per consumed group; per-index naming; nullable statements; the
  OUT-OF-SCOPE pin (unconsumed fields corrupt → clean, so the scope
  decision cannot drift silently); wire read order.
- `web/tests/unit/set-run-outcome.spec.ts` (+8) — the no-coercion pin
  (`""` denominator → the malformed arm, NEVER "no debt on the before
  side"), the dash/radix refusals, read-order naming, the legal-zero
  denominator KEEPING its existing sentence, and the cell-arm position
  pins (before the reach switch, after the identity gates, per-index
  naming across two engines).
- `web/tests/unit/tornado-lines.spec.ts` (+2) — the header clause: reach
  counts drop the malformed row, the absence count keeps it, the clause
  names it; absent at zero.
- `web/tests/e2e/p1b-fixes.spec.ts` (+1, p1b-3) — set-run mocks in
  tornado.spec.ts's register (OPTIONS preflight + request sink); the
  committed variant with ONE documented corruption
  (eth_minus_30/debt_manager `eligible_debt_delta_usd: ""`) → route
  stays live, the malformed register names
  `engines[1].eligible_debt_delta_usd`, ethfi's bar still draws (1 rect
  on the page), the no-denominator caption of the refused row's OTHER
  engine vanishes with it (nothing is read from a malformed result), the
  exact header line pinned whole including `malformed, not read: 1
  (eth_minus_30)`, no numeric/block ledger rows for the row, its register
  row in their place.

Pin movement (ledgered old→new): the `{}` block stand-ins in
tornado-lines.spec.ts's r57-5/r58-4 builders (`projection: {} as …`,
`market_realization: {} as …`, `blockValue = {}`) are now contract-legal
blocks (`legalShortfall()`/`legalProjection()`) — an empty object was
never a legal block and the malformed arm now rightly refuses it
(`projection.horizons` / `market_realization.*` named). Every asserted
sentence and state in those laws is UNCHANGED. No other pin moved; all
20 tornado.spec.ts e2e pins survive unmodified.

### Red-first evidence

- `set-run-classification.spec.ts` before the module existed: run dies at
  collection — `Cannot find module '…/web/app/lab/setRunClassification'`.
- The 7 unit pins against the UNFIXED modules: `barLength("")` returned
  the no-denominator arm wearing the measurement claim, `barLength("-")`
  threw `SyntaxError: Cannot convert - to a BigInt` at
  tornadoCells.ts:493, the both-fields pin the same class,
  `tornadoCellState` returned `bars` over malformed engines (three cell
  pins), and the header carried "shock did not reach: 1" with no
  malformed clause.
- The p1b-3 e2e against the UNWIRED build: dead at the route-stays-live
  pin (p1b-fixes.spec.ts:228, `tornado-header` not found) — page snapshot
  shows the p1b-0 boundary's "This view refused to render" alert where
  the tornado should be: the malformed delta reached
  `renderSignedUsdAmount` in the ledger and the boundary took the whole
  lab segment.

### Mutation kills (p1b-3-M1, p1b-3-M2)

- M1: the classifier is BYPASSED in `tornadoCellState` (the malformed
  check replaced with an empty list — the arm unreachable). Rebuild, the
  p1b-3 e2e in isolation: KILLED at exactly the route-stays-live pin
  (p1b-fixes.spec.ts:228) — the malformed engine fell through to `bars`,
  its delta reached the ledger's money renderer, the boundary took the
  segment and no header rendered. Reverted; rebuilt.
- M2: `barLength` reverted to bare `BigInt`. The no-coercion pin in
  isolation: KILLED at exactly set-run-outcome.spec.ts:490 — expected the
  malformed arm, received `reason: "no-denominator"` with "debt_manager
  carries no debt on the before side": the coerced 0n resurrected the
  measurement claim off an unreadable value. Reverted; final tree
  rebuilt and re-verified.

### Closing counts (p1b-3)

- Track B suite: 1456 → **1477** (+21: set-run-classification 10,
  set-run-outcome 8, tornado-lines 2, p1b-fixes 1).
- Full run (final tree, `npm run build` + full p1b config, port 3819):
  **1476 passed, 1 skipped, 0 failed (35.5s)** — the same single
  pre-existing styleguide skip, no other movement; tornado.spec.ts 20/20
  green inside it.
- Committed-fixture sweep (in-suite): every engine of every committed
  `run-book-set*.json` fixture classifies CLEAN — the law refuses no
  served body.
- `npm run typecheck`: completely clean.
- `npx eslint` on all eight touched files: 0 errors, 0 warnings.

### p1b-4 · FactorPrice entry guard (Task 4)

Closes Codex round-3 finding 2. Post-p0-9 the Inspector's boundary
defenses covered the ARRAY's existence and the boundary's null-ness only;
every ENTRY read was trusted: `prices: [null]` (the p0-9 nil-pointer
serialization class one level down) threw a TypeError at
`first.lowest_healthy_price` (card :428, evidence.ts map :307-312) and
the route boundary took the segment; malformed
`lowest_healthy_price`/`current_price` (`"12.5"`, `""`) threw
parseDecimal inside `money()`; a mis-shaped `price_decimals` threw
assertScale; and an ABSENT `price_decimals` hit `money()`'s no-scale
branch — the RAW scaled integer rendered as a plausible price with the
health assertion attached ("Health boundary price 370,370,370,371 ·
still healthy at exactly this price (ceil P*)", recorded live in the red
run). Silent wrong display, the worst class: no throw for any boundary
to catch.

Delivered:
- `web/lib/factorPriceGuard.ts` — `classifyFactorPrice(entry: unknown):
  { ok: true; entry: FactorPrice } | { ok: false; fields: string[] }`,
  sibling of `engineClassification.ts` (p1b-2) and
  `setRunClassification.ts` (p1b-3): wireGuard primitives, checks in
  wire read order, never throws, non-object entries named whole (as
  `entry`), nullability mirrors the generated schema EXACTLY
  (`price_floor`/`lowest_healthy_price` NullableDecimal — null is the
  wire's own statement). `price_decimals` is REQUIRED by decision:
  absent = malformed, NEVER the raw-render branch — the one corruption
  that does not throw downstream is exactly the one the guard must
  refuse. `{ok: true}` hands back the SAME object it judged (identity
  pinned), so downstream reads see the wire's bytes.
- `web/app/inspector/[addr]/InspectorPositionCard.tsx`
  (`renderLiquidationPriceRow`) — `lp.prices[0]` is classified BEFORE
  any property read; `{ok: false}` folds into the new
  `boundary-malformed` arm, the not-established register's sibling
  ("not established" states the solve published nothing; this arm states
  it published something NOBODY MAY READ): fields named, `lp.reason`
  still exposed inline, NO health assertion, no raw numbers. The
  no-price-path badge does NOT render on this arm, by decision (recorded
  in the arm's comment): a soft axis-scoped claim read off a payload the
  entry just proved corrupt is a claim the arm exists to refuse. The
  p0-8 not-established arm and the value arm are byte-preserved
  (verdict/badge/chip rules untouched).
- `web/lib/evidence.ts` (`liquidationPriceEvidence`) — EVERY entry is
  classified independently before the per-entry map reads it: a good
  entry renders its normal row, a bad one renders its own
  `prices[i]` malformed row (nothing read off it); the BOUNDARY claim
  reads prices[0], so a malformed first entry gets its own "unreadable"
  boundary row (warn) — distinct from "not established" — and the
  three-way ceil disclosure (p0-8) is unchanged for readable firsts.
  PER-ENTRY INDEPENDENCE decided and pinned: one bad entry never hides
  a good sibling, and a bad second never withdraws a good first's
  established boundary.
- `web/tests/unit/factor-price-guard.spec.ts` (12 tests) — skeleton is
  the committed inspector fixture's own entry: clean + same-object-back
  identity; schema-legal nulls stay statements; null / undefined /
  non-object refuse whole; `"12.5"` boundary, `""` current, non-string
  asset; price_decimals absent / -1 / 2.5 / 1001; multi-failure wire
  read order.
- `web/tests/unit/inspector-evidence.spec.ts` (+4) — drawer with
  `prices: [null]` refuses without throwing (own malformed row, the
  unreadable boundary arm, NOT "not established"); missing
  price_decimals → the raw digit-run "370370370371" pinned ABSENT from
  the drawer text; both independence directions.
- `web/tests/e2e/p1b-fixes.spec.ts` (+2, p1b-4) — inspector mocks in
  p0-fixes' register (mockInspectorFound parameterized over the body);
  `prices: [null]` → card stays live, `boundary-malformed` visible, no
  route refusal, no health claim; deleted `price_decimals` → the
  silent-raw-render kill pins FIRST (`not.toContainText` on BOTH
  spellings of the fixture's raw lowest_healthy_price digits —
  "370370370371" and money()'s grouped "370,370,370,371", the branch
  the card actually reaches), then the arm names `price_decimals`.

No pin moved: all p0-8 boundary pins (p0-fixes.spec.ts:483-553), the
p0-9 prices:null fold, and every prior inspector-evidence law survive
byte-identical.

### Red-first evidence

- `factor-price-guard.spec.ts` before the module existed: run dies at
  collection — `Cannot find module '…/web/lib/factorPriceGuard'`.
- The 4 evidence pins against the UNFIXED drawer: `prices: [null]` →
  `TypeError: Cannot read properties of null (reading
  'lowest_healthy_price')` at evidence.ts:302 (twice — the [null] arm
  and the bad-first independence arm); missing price_decimals → the
  drawer text carried `lowest_healthy_price · 0xCd5fE23C…:
  370370370371 (current 400000000000)` — the raw scaled integer as a
  plausible value, caught verbatim; `""` current_price →
  `DecimalFormatError` from parseDecimal via renderNullableDecimal at
  evidence.ts:311.
- The p1b-4 e2e against the UNFIXED build: (a) `prices: [null]` dead at
  the `boundary-malformed` visibility pin (p1b-fixes.spec.ts:407) — the
  TypeError took the segment and the card never painted the arm;
  (b) deleted price_decimals dead at the grouped raw-digits absence pin
  (p1b-fixes.spec.ts:437) — the page snapshot records the live defect:
  "Health boundary price 370,370,370,371 · current weETH ≈
  400,000,000,000 · still healthy at exactly this price (ceil P*)".
  (The ungrouped spelling passed against the unfixed card — money()
  groups — which is exactly why BOTH spellings are pinned.)

### Mutation kills (p1b-4-M1, p1b-4-M2)

- M1: the guard's `price_decimals` requirement dropped (absent passes:
  `entry.price_decimals === undefined || isWireScale(…)`). Rebuild, the
  p1b-4 e2e in isolation: KILLED at exactly the raw-digits absence pin
  (p1b-fixes.spec.ts:437, the grouped spelling) — the admitted entry
  reached `money()`'s no-scale branch and the raw integer re-wore the
  price costume with the ceil-health sentence attached. The [null] test
  stayed green (null entries still refused), isolating the kill to the
  requirement dropped. Reverted; rebuilt.
- M2: the card classifies but routes `{ok: false}` to the value arm
  (malformed-arm branch disabled, value/not-established arms reading the
  unclassified `first`). Rebuild, in isolation: the `prices: [null]`
  test KILLED at exactly the `boundary-malformed` visibility pin
  (p1b-fixes.spec.ts:407, element not found) — the raw read threw and
  the card never painted; the deleted-decimals test killed at :437 too
  (the routed entry raw-rendered). Reverted; final tree rebuilt and
  re-verified.

### Closing counts (p1b-4)

- Track B suite: 1477 → **1495** (+18: factor-price-guard 12,
  inspector-evidence 4, p1b-fixes 2).
- Full run (final tree, `npm run build` + full p1b config, port 3819):
  **1494 passed, 1 skipped, 0 failed (35.5s)** — the same single
  pre-existing styleguide skip, no other movement.
- Targeted (final tree): inspector.spec.ts + p0-fixes.spec.ts +
  p1b-fixes.spec.ts → 43/43 e2e green (every p0-8 boundary pin
  survives); factor-price-guard + inspector-evidence + wire-guard →
  34/34 unit green.
- Committed-fixture check (in-suite): the committed inspector entry
  classifies CLEAN and comes back as the same object — the law refuses
  no served body.
- `npm run typecheck`: completely clean.
- `npx eslint` on all six touched files: 0 errors, 0 warnings.

### p1b-5 · shared result-identity module + Lab address-mode completion (Task 5)

Cross-page brief §5: every async result bound to scope / address / batch /
config-version / engines / computed-at, with the identity VISIBLE. The Lab's
address mode bound only the address (p0-1); batch/config were display-only in
the stamp, no age was anchored, and the answered engines were nowhere.

- New module `web/lib/resultIdentity.ts`: `ResultIdentity` (the §5 sextuple),
  `identityLine` (canon order: subject · batch · config · answered engines),
  `stressResultIdentity` (extractor over a structural `StressIdentitySource`,
  so the REFINED response LabClient holds assigns without a cast), and
  `resultReceipt` (wire `age_seconds` + `receiptIdentity(served_at, batch.id)`
  — freshness.ts Wave R5's law, composed in ONE place).
- `addressBinding.ts`: `boundResultLine` RETIRED, replaced by
  `settledIdentityLine(addr, result)` — the same pure-composition seam, text
  grown. `find_referencing_symbols` on the old name after the change: 0
  references.
- `LabClient.tsx` done arm: `lab-result-address` (testid unchanged) renders
  the full identity line; NEW `lab-result-age` renders the ANCHORED age via
  `useAnchoredAgeSeconds(resultReceipt(...))` — `humanAge(seconds) + " old"`,
  or the unknown register (`unknownAgePhrase`, the snapshot-chip composition)
  while a blind resume stands. Both lines live inside the stale-barrier
  conditional, so p0-1's withdrawal law covers them unchanged.

**Migrated pin (old→new)** — p0-fixes.spec.ts:93 (p0-1) and
address-binding.spec.ts:48:
- OLD: `lab-result-address` toContainText `results for ${ADDR}`;
  `boundResultLine(A) === "results for ${A}"`.
- NEW: `lab-result-address` toContainText
  `results for ${ADDR} · batch #1 · config v1 · engines aave_v3_etherfi`
  (the p1b-5 e2e pins the FULL line with toHaveText);
  `settledIdentityLine(A, result)` contains the verbatim address AND
  `batch #7` / `config v9` / `engines aave_v3_etherfi`.
- All other p0-1 pins (barrier text, role="status", withdrawal, round-trip)
  byte-unchanged.

**Recorded decisions (p1b-5)**
1. ANSWERED engines = the DISTINCT engines present in `scenarios[].results[]`,
   in wire order — never the scenario definitions' `engines` lists (they name
   what a scenario models, not who answered for THIS address), never a
   hardcoded vocabulary. The committed fixture proves the difference: its
   definitions name debt_manager, only aave answers, the line says only aave.
   Empty list renders `engines none answered` (the unknowable arm's identity),
   never silence.
2. NO resume repair is wired on the Lab age (`useAnchoredAgeSeconds` called
   without `onResume`): an address stress is a reader-DISPATCHED run, not an
   ambient read — re-running it uninvited on resume is a request the reader
   never made. On a blind resume the hook therefore marks the unknown
   exhausted immediately and the line renders
   `age UNKNOWN since resume · refresh failed, data retained`. A new run is
   the discharge. (InspectorSurface keeps its repair; its lookup is an ambient
   read of the page's own subject.)
3. `identityLine` carries NO computed-at clause: `ResultIdentity` has no
   computed-at field by the brief's interface; the canon's computed-at slot is
   served by LabBatchStamp (verbatim `computed_at` on the batch stamp, already
   on the done arm) and the age by the anchored `lab-result-age` line — an age
   frozen into a string would violate freshness law 1.
4. The address renders VERBATIM (never ellipsized) in the line — p0-1's
   "names the address verbatim" law and the migrated pin both require the
   full address; the canon mock's `0x80b3…6e1d` shortening is a display
   treatment Phase 3 typography may add, the composition keeps the fact.

**Red-first evidence (recorded)**
- Unit (web-3819-p1b5-red-unit.log): both specs die at collection —
  `Cannot find module '…/web/lib/resultIdentity'`;
  `addressBinding` `does not provide an export named 'settledIdentityLine'`.
- E2E vs the STALE baseline build (web-3819-p1b5-red-e2e.log): 3 failed —
  the migrated p0-1 pin (p0-fixes.spec.ts:96, old text still
  `results for {addr}` alone), the p1b-5 identity line (p1b-fixes.spec.ts:512)
  and `lab-result-age` element not found (:527). The barrier test (p0-1 error
  arm) stayed green — the reds are exactly the growth, not a regression.

**Mutation kills (p1b-5-M1, p1b-5-M2; each in isolation, reverted)**
- M1 — `identityLine` drops the batch clause: unit result-identity in
  isolation KILLED at the exact-composition pins (received line missing
  ` · batch #18251`, 3 failed / 4 passed); rebuild + the p1b-5 identity e2e
  in isolation KILLED at the batch-id pin (p1b-fixes.spec.ts:512, received
  `results for 0xAAaA… · config v1 · engines aave_v3_etherfi`). Reverted.
- M2 — `resultReceipt` wired to a CONSTANT receipt (`"receipt"`, the
  never-re-anchors defect): unit result-identity in isolation KILLED at
  exactly the receipt-composition pin (expected `2026-08-01T19:23:59Z#18251`,
  received `receipt`); the other 6 tests stayed green, isolating the kill.
  Reverted; final tree rebuilt and re-verified.

### Closing counts (p1b-5)

- Suite: 1511 → **1521 tests** (+10: result-identity 7, address-binding
  6→7 net +1, p1b-fixes e2e +2).
- Baseline full run BEFORE any edit (fresh build, full p1b config, port
  3819): **1510 passed, 1 skipped, 0 failed (35.9s)** — byte-consistent with
  p1a-1's closing count.
- Full run (final tree, fresh `npm run build`, full p1b config, port 3819):
  **1520 passed, 1 skipped, 0 failed (35.1s)** — the same single
  pre-existing styleguide skip, no other movement.
- Targeted (final tree): lab.spec.ts + p0-fixes.spec.ts + p1b-fixes.spec.ts
  e2e + address-binding + result-identity unit → **70/70 green**.
- `npm run typecheck`: completely clean.
- `npx eslint` on all seven touched files: 0 errors, 0 warnings.

## Phase 1 Track A — foundation build

Plan: docs/plans/2026-08-10-ui-overhaul-phase1-tracka.md. Verification runs
on its OWN wave config, `web/tests/playwright.p1a.config.ts` (port 3820; a
byte-mirror of `playwright.p0.config.ts` except port + header comment).

**Track A baseline inventory** (`npx playwright test -c
tests/playwright.p1a.config.ts --list`, recorded BEFORE the first Track A
spec): **1477 tests in 87 files**.

Task list:
- [x] Task 0 — wave config + ledger section (p1a-0)
- [x] Task 1 — tokens.css migration + width contract (p1a-1)
- [x] Task 2 — stylelint: the structural floor (p1a-2)
- [ ] Task 3 — freshness tier machinery (pure) + meta constants provider
      (p1a-3)
- [ ] Task 4 — THE MIGRATION WAVE: canon appbar + tiered chip (badge
      retirement) (p1a-4)
- [ ] Task 5 — shared component kit (verdict banner, exact affordance,
      chips, states) (p1a-5)
- [ ] Task 6 — styleguide rebuild (p1a-6)
- [ ] Task 7 — Track C convergence pass (History, Activity, Proof,
      Developers) (p1a-7)
- [ ] Task 8 — Track A close + Codex round (p1a-8)

### p1a-0 · wave config (Task 0)

- `web/tests/playwright.p1a.config.ts` created — mirror of the p0 config,
  PORT 3820, header "Phase 1 Track A verification config." + the standard
  invocation line.
- `--list` verified from web/: `Total: 1477 tests in 87 files` — matching
  Track B's post-p1b-3 count (the two wave configs enumerate the same
  tests/ tree; only port and boot isolation differ).

### p1a-1 · tokens.css migration + width contract (Task 1)

The ratified foundation canon lands in production tokens: the closed
`--t-*` type set (14 tokens, nothing below 12px EXISTS), every legacy
`--fs-*` re-pointed by ROLE onto the closed set (the four sub-12px sizes
floor-lift to 12px), the §04 two-grade palette amendments in every theme
block that defines each token, and the §02 width contract (`--shell-max`
1280, stepped 1920→1520 / 2560→1680; 1180 REPEALED). No component file
changed — every page re-renders under the floor-lifted aliases.

Delivered:
- `web/app/tokens.css` — the `--t-*` closed set (theme-invariant, light
  `:root` only, beside the type stacks); the `--fs-*` block re-pointed and
  marked `LEGACY ALIASES — Phase 3 retires these; new code uses --t-*
  (stylelint-enforced)`; §04 palette amendments (below); `--breakout-max`
  new beside `--shell-max`; three stepped `@media (min-width)` blocks at
  the end of the file.
- `web/app/globals.css` — `.shell` padding `var(--sp-5) 20px 96px` →
  `0 24px 120px` (canon §02 verbatim; max-width stays `var(--shell-max)`);
  NEW utilities `.breakout { max-width: var(--breakout-max) }`,
  `.prose { max-width: 720px }`, `.grid12 { repeat(12, 1fr); gap: 20px }`.
- `web/tests/unit/tokens-contract.spec.ts` (12 specs, source-reading per
  the book-charts-copy precedent) + `web/tests/e2e/p1a-fixes.spec.ts`
  (4 specs, the rendered twin).

**The complete `--fs-*` → `--t-*` mapping ledger** (by ROLE per canon §03;
where a judgment call existed the canon's role wording governs — the same
table lives in the tokens.css comment block):

| Legacy | Was | Now | New px | Rationale |
|---|---|---|---|---|
| `--fs-h1` | 30px | `--t-display` | 32 | page h1 = "page H1 — the page's one finding" |
| `--fs-h2` | 20px | `--t-chapter` | 24 | surface-head h2 IS an H2 = "chapter title (H2)" — maps UP by role, never sideways to `--t-section` 18 by value |
| `--fs-lede` | 15.5px | `--t-body` | 16 | lede paragraph = "reading prose" |
| `--fs-body` | 14.5px | `--t-ui` | 14 | surface-head p is supporting copy under a head — the register the canon itself sets at `--t-ui` (`.v-qual`, qualification prose); the LEDE is the page's reading prose, so `--t-body` would double-promote |
| `--fs-note` | 13.5px | `--t-ui` | 14 | note blocks are read, not scanned: "captions with content", not "dense metadata floor" |
| `--fs-table` | 13px | `--t-meta` | 13 | kv rows / feed items = "dense metadata floor" (value-preserving); the §08 table pattern's sans-14px BODY is Phase 3 per-surface work when tables rebuild against the canon pattern — an alias lift here would restyle every dense kv row unasked |
| `--fs-mono` | 12px | `--t-mono-floor` | 12 | value-preserving; the canon's terminal body is `--t-mono-sm` 12.5 — that uplift is Phase 3 per-surface work (`.term` restyle), not an alias change that would also move every `.mono` table cell |
| `--fs-mono-sm` | 11.5px | `--t-mono-floor` | 12 | FLOOR LIFT |
| `--fs-caption` | 11px | `--t-floor` | 12 | FLOOR LIFT |
| `--fs-label` | 10.5px | `--t-floor` | 12 | FLOOR LIFT |
| `--fs-badge` | 10px | `--t-floor` | 12 | FLOOR LIFT |
| `--fs-stat` | 21px | `--t-stat` | 21 | exact ("KPI value") |
| `--fs-hf` | 12.5px | `--t-mono-sm` | 12.5 | exact — a mono numeral on an identity line |

Visual blast radius, expected and accepted: everything under
`--fs-mono-sm/caption/label/badge` (10–11.5px → 12px) grows, `--fs-h1`
30→32, `--fs-h2` 20→24, `--fs-lede` 15.5→16, `--fs-body` 14.5→14,
`--fs-note` 13.5→14; the audits demanded the floor, layout shifts are
acceptable, and zero test pins moved (pin-map §3–4 predicted exactly
this).

**§04 palette amendments** (in every block that defines the token —
light `:root` / dark media / `data-theme` light / `data-theme` dark):

- `--ink-3` dark `#5f7178` → `#71868e` (3.39 → 4.53 on panel), light
  `#8a979c` → `#637075` (2.65 → 4.51 on panel-2) — 2 blocks each.
  Text-legal again but demoted by law: captions/ornament only.
- NEW light text grade, split from the fill grade: `--accent-text
  #2a7380` · `--ok-text #27784d` · `--warn-text #8b6219` · `--crit-text
  #ba4136` (each ≥4.5:1 on chip-bg AND panel-2). Dark declares the same
  four tokens AT THE FILL VALUES (`#5ab3c4/#63b98a/#d0a04a/#d96a5d`) so
  components reference `--*-text` unconditionally — 4 declarations per
  token across the four blocks.
- NEW `--warn-bg` state fill: dark `rgba(208, 160, 74, 0.1)`, light
  `rgba(176, 124, 31, 0.08)` — for refused tags.
- `--term-dim` `#6b7d84` → `#70838a` (4.19 → 4.54 on worst term ground
  `#10181b`) — ONE block: the terminal palette lives in the bare `:root`
  only and is never overridden (theme-constant by design), so "every
  block that defines it" is exactly one. The unit spec pins that count.
- The light-first + media + data-theme override law and all four
  `color-scheme` lines are byte-preserved.

**Width contract placement decision**: the steps live ON THE TOKENS
(`--shell-max`/`--breakout-max` redefined inside three `@media
(min-width)` `:root` blocks at the end of tokens.css), NOT as hard
`.shell`/`.breakout` overrides in globals.css. Reason: `.shell {
max-width: var(--shell-max) }` keeps working verbatim, and every consumer
of the token (`.shell`, `.breakout`, the ribbon's `.bannerInner`) steps
together. Custom-property redefinition inside a media query is plain
CSS; no theme block touches these two tokens, so the override law is
untouched. Steps: base 1280 · 1440 → breakout-only 1340 · 1920 → both
1520 · 2560 → both 1680.

### Red-first evidence

- `tokens-contract.spec.ts` before implementation: **12/12 failed**
  (all four pin families: type set, aliases, palette, width).
- `p1a-fixes.spec.ts` against the STALE build (new CSS unbuilt):
  **4/4 failed** — 1180-era shell widths and the retired ink-3 rgb —
  then `npm run build` → **4/4 passed**. The e2e is a build-artifact
  pin, not a source pin; the pair proves it.

### Mutation kills (p1a-1-M1, p1a-1-M2)

- M1: `--ink-3` dark reverted to `#5f7178` in BOTH dark blocks; rebuild;
  p1a-fixes in isolation: KILLED at exactly the rgb pin
  (p1a-fixes.spec.ts:92 — `dark ink-3` received `rgb(95, 113, 120)`,
  wanted `rgb(113, 134, 142)`); 3 passed. Reverted.
- M2: the whole 1920 media step deleted; rebuild; p1a-fixes in
  isolation: KILLED at exactly the 1520 width pin (p1a-fixes.spec.ts:41,
  first assert at :45 — the shell held 1280 at 1920×1080); 3 passed.
  Reverted; final tree rebuilt and re-verified 16/16.

### Closing counts (p1a-1)

- Suite: 1495 → **1511 tests in 90 files** (+12 unit tokens-contract,
  +4 e2e p1a-fixes; the 1495/88 base = the 1477/87 Track A baseline plus
  Track B's p1b-4 landing on the shared tests/ tree).
- Threshold-class guards: `chart-spec-v4.spec.ts` **40/40 passed** —
  the three AC-54 tests (12px rendered floor + 4.5:1, ×2 themes ×2
  viewports) and AC-13 (3:1 cell boundary, ×2 themes) pass on the
  amended values, as the canon computed they must.
- Six-surface smoke `shell.spec.ts`: **8 passed, 1 skipped** (the
  standing styleguide not-compiled-in skip).
- Full p1a run (final tree, fresh `npm run build`, port 3820):
  **1510 passed, 1 skipped, 0 failed (34.7s)** — ZERO pin movement from
  the value-only token changes, exactly the pin-map §3–4 prediction
  (`--shell-max` had zero pins; no test hard-codes a token value).
- `npm run typecheck`: clean. `npx eslint` on both new specs: clean.

### p1a-2 · stylelint — the structural floor (Task 2)

The 12px floor stops being reviewable taste and becomes a build gate:
stylelint 17.14.1 (exact devDep) with
`declaration-property-value-allowed-list` — every `font-size` in
`web/app/**/*.css` + `web/components/**/*.css` must match
`/^var\(--(t|fs)-/`. Rule semantics verified against the current
stylelint docs before writing the config: a `/regex/` value is matched
against the ENTIRE declaration value, so the `^` anchor rejects
literals, `calc()` wrappers, `inherit`, and token typos, while
`var(--t-ui, 14px)` fallbacks stay legal. The `font` shorthand is held
to `inherit` so a literal size cannot smuggle in through the shorthand
(five lawful `font: inherit` uses today).

**RELAXATION (recorded here + in the config comment):** the legacy
`var(--fs-*)` aliases stay LAWFUL until Phase 3 retires them — every
`--fs-*` already resolves onto a `--t-*` token (p1a-1), so the floor
holds through the alias; Phase 3 tightens the pattern to `--t-*` only.

**Deviations from the brief:** (1) config is `stylelint.config.mjs`,
not `.stylelintrc.json` — the brief requires the relaxation recorded
in a config COMMENT and JSON carries none; the ESM file matches the
repo's `eslint.config.mjs` pattern and lets the allowed-list regex be
a real RegExp. (2) The "no undefined token" typo guard is SKIPPED per
the brief's own escape hatch ("if cheaply expressible; otherwise
skip"): core stylelint has no undefined-custom-property rule — it
needs the csstools plugin + importFrom wiring, a new dependency, not
cheap. The `^var(--(t|fs)-` anchor already catches prefix typos;
value typos (`--t-flor`) remain for Phase 3.

Wiring: `web/package.json` gains `"lint:css": "stylelint
"app/**/*.css" "components/**/*.css""`; CI web job runs `npm run
lint:css` directly after `npm run lint`.

**The 44 literal font-size fixes** (repo-wide inventory; every fix
value-preserving and register-matched except the one floor lift):

| File | Lines | Was | Now |
|---|---|---|---|
| book.module.css | 225, 240, 265, 274, 285, 295, 390, 396, 403, 411, 646, 652, 663, 673 | mono 12px (warn disclosure, chart-template STATE/METHOD/forensics slots, hist/increments SVG labels, denominator + contradiction lines, curve table) | `var(--t-mono-floor)` |
| book.module.css | 256 | mono 14px (.answerLine — ANSWER slot) | `var(--t-mono-lg)` |
| inspector.module.css | 170 | sans 16px (.stateCard h2 — the §09 state-block lead sentence, body register) | `var(--t-body)` |
| lab.module.css | 800, 806, 813, 821, 897, 991, 999, 1048, 1064, 1079, 1086, 1114 | mono 12px (hist labels, dumbbell boundary label, flow lane labels, STATE/METHOD slots, frontier separator, exact-data button, tornado pick) | `var(--t-mono-floor)` |
| lab.module.css | 1055 | sans 14px (.answerLine) | `var(--t-ui)` |
| charts.module.css | 35, 73, 218, 251, 309, 315, 321, 332, 388, 399, 441 | mono 12px (axis/ref/outlier/value/step labels, measuring probe, ledger grid + map ledger) | `var(--t-mono-floor)` |
| header.module.css | 28 | mono 14px (.wordmark) | `var(--t-mono-lg)` |
| header.module.css | 61 | sans 13px (.navRow) | `var(--t-meta)` |
| table.module.css | 15 | sans 14px (.takeaway — ANSWER slot) | `var(--t-ui)` |
| table.module.css | 123 | 9px (.sortGlyph ▲/▼) | `var(--t-floor)` — **FLOOR LIFT 9 → 12, the sole visual change**; a sub-floor ornament glyph had no lawful token because no sub-12px token exists |

`.chProbe` (charts 251) moved WITH `.axisLabel` (charts 35) — the
probe must measure what the label renders; both now say
`var(--t-mono-floor)`.

**Folded in from Task 1's review (controller-authorized):** two pins in
`tokens-contract.spec.ts` — base `--breakout-max: 1280px` exactly once
(the canon's "holds 1280 at 1366" guard; the stepped blocks are the
only other declarations) and `--ink-3` closed accounting
(`countOf("--ink-3:") === 4`, the *-text tokens' pin style). Both are
REGRESSION GUARDS, not red-first features: written, confirmed green
against current HEAD (12 → 14 specs in the file).

### Proof of gate + mutation kills (p1a-2)

- **Red-first, the existing debt:** the config against the untouched
  tree: **44 errors, exit 2** — the exact literal inventory above,
  file-by-file, nothing else. After the 44 fixes: exit 0.
- **THE STRUCTURAL-FLOOR PROOF (the task's mutation kill):** scratch
  rule `.p1a2MutationScratch { font-size: 11px; }` appended to
  globals.css → stylelint FAILED (exit 2) at exactly
  `globals.css:127 font-size: 11px`; removed → exit 0. A sub-12px
  label is now a build error, not a review comment.
- **Pin kill A:** base `--breakout-max` mutated 1280 → 1300: KILLED at
  exactly the new pin (tokens-contract.spec.ts:177), 13 passed.
  Reverted.
- **Pin kill B:** fifth `--ink-3` declaration added to the data-theme
  dark block: KILLED at the closed-accounting pin (:125; the p1a-1
  value-count pin at :116 also fired on the duplicated hex), 12
  passed. Reverted; final tree re-verified 14/14.

### Closing counts (p1a-2)

- Suite: 1521 → **1523 tests** (+2 unit pins; base = p1b-5's 1521).
- Full p1a run (final tree, fresh `npm run build`, port 3820):
  **1522 passed, 1 skipped, 0 failed (35.8s)** — zero pin movement
  from the 44 value-preserving swaps and the 9→12 sortGlyph lift
  (chart-spec-v4's AC-54 rendered-floor pins pass unchanged: chart
  text still renders 12px).
- `npm run lint:css`: clean. `npm run typecheck`: clean.
- `npm run lint` (eslint .): 0 errors (one pre-existing LabBookPanel
  warning, untouched); `npx eslint` on the touched spec + config: clean.

### p1b-6 · the identity gap audit closes (Task 6)

The §5 audit's remaining rows plus four controller additions (items 6–9),
each small and independently pinned. Commit `fix(web): p1b-6 …`.

**The five brief fixes**

1. **Book success-arm abort check** (`BookSurface.tsx` `loadBook`): the
   failure arm has carried `controller.signal.aborted → return false` since
   W-UX; the success arm now mirrors it, so a superseded success that had
   already left the wire cannot land its stale book (and receipt) over the
   newer request's answer. Review-verified + suite-green (the brief's
   sanctioned arm: no e2e race simulation is cheap here); book.spec 15/15.
2. **Feed envelope-echo race** (`pagination.ts` + `FeedSurface.tsx`):
   `useCursorPages` now hands every dispatch an `isCurrent()` predicate —
   the SAME epoch its own rows are gated on — and the Feed gates all three
   per-walk setters (`setEnvelope`, both `setRefusal` sites) on it. Two-arg
   callers (BookPositions, Inspector activity) are untouched: fewer params
   remain assignable. Red-first e2e (below) + mutation kill M2.
3. **Observatory abort symmetry + as-of** (`ObservatorySurface.tsx`): the
   success arm gains the failure arm's abort check; and the head renders
   `as of {served_at}` VERBATIM (`observatory-as-of`, the `.asOf` register).
   **Recorded decision:** the rollup envelope carries `served_at` but NO
   `age_seconds` (openapi `ObservatorySeriesResponse`), so there is no wire
   age to anchor and no tick runs — `useAnchoredAgeSeconds` is NOT called,
   because the only age it could compute would come from the browser clock
   (freshness law 1 forbids it). The wire's own instant renders verbatim
   instead, promoted from the collapsed stampline to the head.
4. **Inspector history batch-weld** (`InspectorSurface.tsx` →
   `InspectorHistory.tsx` `positionBatchId` prop): when the history
   response's own vantage batch differs from the batch the position lookup
   was read at, a dim mono one-liner under the section head states the seam:
   `history window newest batch #X · position read at batch #Y`
   (`history-batch-weld`, rendered ONLY on mismatch). **Recorded decision:**
   the wire's newest-batch field for this response is its vantage
   `response.batch.id` (`AddressHistoryResponse.batch` — the newest servable
   batch the window was read AT; the response enumerates no other
   window-level newest). The weld therefore compares the two responses'
   vantages, which is exactly the two-worlds seam a fresh batch landing
   between the two fetches produces. The committed fixtures already differ
   (history example batch 2, address example batch 1), so the visible-arm
   e2e runs on committed bytes verbatim; the no-seam arm re-pins the history
   vantage to the lookup's id (2 → 1, one documented change).
5. **Inspector params/activity explicit keying** (`InspectorSurface.tsx`):
   `paramsByEngine`/`paramsErrors` now live as `{for: addr, byEngine}` —
   the lookup/history binding pattern — derived empty whenever `for` is not
   the current address, and the accumulate spread refuses a base map built
   for another address. **Recorded decision (activity):** the cursor hook
   OWNS the accumulated rows, so the `{for: addr}` keying is expressed there
   as an explicit drop-and-restart — `activityForRef` + `reset()` BEFORE the
   first page of a new address (abort in-flight, epoch discards a late
   page). Behaviorally equivalent to keyed state for every reader of
   `activity.rows`, and no longer dependent on App Router remount semantics.
   Review-verified + inspector.spec 21/21.

**Controller items**

- **Item 6 — book-surface coercion residue.** All named sites re-anchored
  (numbers had drifted) and routed through `wireBigInt` to each module's
  EXISTING refusal/na arm:
  - `stressIncrements.ts` grid weld (was :67): a malformed factor refuses
    (GRID CONTRADICTION naming the wire contract) — the coerced 0n used to
    PASS the weld (0 descends) and render a garbage step label;
  - `stressIncrements.ts` delta (was :126): malformed cumulative refuses
    (SERIES CONTRADICTION) — `""` on side `a` was a measured-zero costume;
  - `incrementScaleClause` (was :165): returns **null** on a malformed
    anchor (the caller's existing no-clause arm) — `BigInt("")` used to take
    the `$0, no bar` claim;
  - `history-series.ts` `displayRatio` (:87/:89): num/den through
    `wireBigInt`; malformed → null → the existing unpublished-gap arm
    (`hf.num: ""` used to PLOT a 0.0 point — the silent wrong display);
  - `BookWaterfall.tsx` (was :268/:274/:314): the three bare `BigInt(step)`
    reads replaced by ONE pass through the new
    `stressIncrements.incrementStepValues` (paired step+bigint rows, max) —
    refused renders the panel's existing `increments-refused-{engine}`
    contradiction register. Model-produced strings are valid by
    construction today; the guard makes that invariant structural and
    unit-pinned rather than incidental.
  - NOTE (scoped out, deliberately): `displayRatio`'s WAD arm
    (`formatUnits(hf.wad, 18)`) and `displayHf` were not named by the
    controller and are unchanged — a malformed wad there throws into the
    p1b-0 route boundary rather than coercing. Candidate for the Phase 3
    residue sweep.
  - NOTE: a malformed num/den routes to the module's existing unpublished
    arm, whose title reads "carries neither wad nor num/den" — for a
    malformed (not absent) pair the wording is approximate. Controller
    mandated the existing arm; wording refinement left for Phase 3 clarity.
- **Item 7 — computed_at on the not-found/unknowable stress arms.** Both
  arms now render `batch {id} · computed {computed_at}` (verbatim, the
  LabBatchStamp clause's own words) as `lab-result-computed`, closing the
  canon §05 face (identity + computed-at + age) for the non-found outcomes.
- **Item 8 — the run-again register (VOCABULARY ADDITION, for the Phase 3
  clarity review).** New constant in `freshness.ts` beside the two existing
  arms: `AGE_UNKNOWN_RUN_AGAIN = "age UNKNOWN since resume · run again to
  refresh"` — same register core (`age UNKNOWN since resume · ` + tail).
  Used ONLY in the Lab result-age path, which wires NO repair (the p1b-5
  sanctioned decision: a reader-dispatched run is not re-run uninvited).
  There the old rendering was `refresh failed, data retained` — an attempt
  never made; "refreshing" would equally claim work not in flight. The
  ribbon and every other surface keep the two existing phrases, byte-pinned.
- **Item 9 — both candidates fixed (neither exceeded the 30-line bound).**
  - `LabScenarioDetail.tsx:50`: module-private `hfInfo` MOVED to
    `labPanelLines.stressStateHfInfo` (the pure-module home its pin needs)
    + wire-Decimal guard on the wad arm → the existing null-display arm
    (SeverityHF's em-dash treatment). A published-but-malformed wad refuses
    outright — it does NOT fall back to num/den.
  - `LabRunBookDetail.tsx:355-356`: the mover num/den cell goes through new
    `labRunBookLines.moverRatioDisplay` — malformed renders the row's
    existing EM_DASH na treatment, never raw bytes. (Verified: the p1b-2
    classifier covers the mover WAD fields + debt_usd but NOT
    `hf_before/after_num/den`, so the raw render was reachable through a
    classifier-passing response.)

**Red-first evidence** (logs at repo root, untracked as usual; source
stashed → pre-fix build → new tests run → stash popped):

- `web-3819-p1b6-red-unit.log` — four specs die at collection (missing
  exports: `AGE_UNKNOWN_RUN_AGAIN`, `stressStateHfInfo`,
  `moverRatioDisplay`, `incrementStepValues`).
- `web-3819-p1b6-red-unit-history.log` — history-series alone: **2 failed /
  17 passed**; `displayRatio({num:""})` returned **0** and the series
  PLOTTED the point — the exact silent-zero defect.
- `web-3819-p1b6-red-e2e.log` — **5 failed / 1 passed**: the feed race
  rendered the STALE echo (`types borrow ·` standing over the borrow,repay
  walk — the received string is in the log), no `observatory-as-of`, no
  weld line, no `lab-result-computed`, and the blind resume said "refresh
  failed, data retained". The one pre-fix pass is fix 4's count-0 arm
  (trivially green with no weld anywhere; its red lives in the visible arm,
  and mutation M3 proves the count-0 pin bites).
- The feed race e2e is DETERMINISTIC, not a sleep-race: an init-script shim
  holds the first `types=borrow` response's resolution under test control
  and detaches it from the abort signal — modeling the real closed-stream
  case where an abort arriving after full receipt has nothing left to
  reject — then releases it strictly AFTER the second walk's echo rendered.

**Mutation kills** (each in isolation, each reverted, final tree rebuilt):

- **M1 · item 6** — `displayRatio` reverted to bare `BigInt`
  (`web-3819-p1b6-mutM1-unit.log`): KILLED at exactly the two p1b-6
  history-series pins (2 failed / 17 passed).
  `npx playwright test -c tests/playwright.p1b.config.ts --project=unit
  tests/unit/history-series.spec.ts`; discriminating assertion:
  `displayRatio({…, num: ""})` must be null, received 0.
- **M2 · fix 2** — the `isCurrent()` gate removed from FeedSurface's
  setters (`web-3819-p1b6-mutM2-e2e.log`): KILLED at exactly the race pin
  (1 failed / 5 passed). `… --project=e2e -g "p1b-6"`; assertion: the foot
  echo still names `types borrow,repay` after the held stale page releases.
- **M3 · fix 4** — weld condition inverted `!==`→`===`
  (`web-3819-p1b6-mutM3-e2e.log`): KILLED at BOTH fix-4 pins — including
  the count-0 pin, per the brief (2 failed / 4 passed).
- **M4 · item 7** — the not-found computed clause removed
  (`web-3819-p1b6-mutM4-e2e.log`): KILLED at exactly the item-7 pin
  (1 failed / 5 passed); assertion: `lab-result-computed` toHaveText
  `batch 1 · computed 2026-07-29T10:00:00Z` (derived from fixture bytes).
- **M5 · item 8** — LabClient reverted to the "refresh failed, data
  retained" phrase (`web-3819-p1b6-mutM5-e2e.log`): KILLED at exactly the
  item-8 pin (1 failed / 5 passed); assertion: `lab-result-age` toHaveText
  `age UNKNOWN since resume · run again to refresh` after a synthetic
  pagehide→focus blind resume.

**Verification (final tree)**

- `npm run typecheck` — completely clean. `npm run lint:css` — clean.
- `npx eslint` on all 15 touched source files + 6 touched specs — clean.
- Targeted (`web-3819-p1b6-targeted.log`): book + observatory + inspector +
  feed + lab + p0-fixes + p1b-fixes e2e → **140/140 green**.
- Full p1b suite (fresh build, `tests/playwright.p1b.config.ts`, port
  3819): **1537 passed, 1 skipped, 0 failed (40.1s)**
  (`web-3819-p1b6-full-final.log`) — suite 1523 → 1538 (+15: unit +9
  [stress-increments 4, history-series 2, freshness-blind-resume 1,
  lab-panel-lines 1, lab-runbook-lines 1], e2e +6 [p1b-6 describe]); same
  single pre-existing styleguide skip.
