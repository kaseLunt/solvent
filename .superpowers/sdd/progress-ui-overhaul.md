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
