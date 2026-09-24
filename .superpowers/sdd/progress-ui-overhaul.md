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
- [x] Task 7 — close (p1b-7 seal below; the Codex adversarial round runs
      next, controller-dispatched — its findings become a fix wave, the
      p0-8/p0-9 precedent)

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
- [x] Task 3 — freshness tier machinery (pure) + meta constants provider
      (p1a-3)
- [x] Task 4 — THE MIGRATION WAVE: canon appbar + tiered chip (badge
      retirement) (p1a-4)
- [x] Task 5 — shared component kit (verdict banner, exact affordance,
      chips, states) (p1a-5)
- [x] Task 6 — styleguide rebuild (p1a-6)
- [x] Task 7 — Track C convergence pass (History, Activity, Proof,
      Developers) (p1a-7)
- [x] Task 8 — Track A close + Codex round (p1a-8)

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

### p1a-3 · freshness tier machinery (pure) + meta constants provider (Task 3)

The ratified SLA becomes code: `web/lib/freshnessTiers.ts` (NEW) —
`freshnessTier(ageSeconds, c): "fresh" | "aging" | "stale" | "critical"`
with every bound a theorem about the pipeline's constants (fresh ≤ 2 ×
`price_poll_seconds`, aging ≤ `price_ceiling_seconds`, stale ≤
`dm_sweep_worst_case_seconds`, critical beyond; bounds inclusive on the
calm side, so 120/121 · 360/361 · 5580/5581 under the fallback trio).
`TIER_FALLBACK = {60, 360, 5580}` mirrors the live deployment. UNKNOWN
AGE IS NOT AN INPUT — stated in the module comment: callers route the
unknown register (freshness.ts, Wave R6) first; there is deliberately no
null arm.

`web/lib/meta.tsx` (NEW) — `MetaConstantsProvider` +
`useMetaConstants(): { constants, source: "meta" | "fallback" }` over a
pure core (`tierConstantsOf`, `loadMetaConstants`,
`META_CONSTANTS_FALLBACK`, `MetaSource`): ONE `client.meta()` fetch on
mount, abort-guarded (`AbortController` + aborted-check before setState),
failure → disclosed fallback, NO retry — meta is static per deploy.
Field names read from the generated `MetaResponse.constants` schema:
`price_poll_seconds` / `price_ceiling_seconds` /
`dm_sweep_worst_case_seconds`. **Recorded decision:** `client.meta()`
runs `assertCompatible` internally and its `seizure_model` check is
UNCONDITIONAL, so a live server can make `meta()` throw
`SchemaVersionMismatchError` after a good fetch — that rejection is
caught into the SAME fallback arm, source `"fallback"` (pinned): tier
thresholds never trust constants from a server the client refuses to
read. **NOT MOUNTED YET** — Task 4 mounts the provider in the layout;
until then `useMetaConstants` outside a provider answers the fallback.

**Retirements (the p0-5 deferred cleanup — this task owns it).**
`ribbonBatchAgeSuffix`, `ribbonBatchAgeUnknown`,
`RIBBON_STALE_BATCH_SECONDS` (=3600, the hand-picked hour), and
`ageHours` deleted from `web/lib/freshness.ts` (tombstone comment left in
place). Zero production consumers PROVEN FIRST by language-server
reference search (`find_referencing_symbols` on all four: only the three
unit specs + intra-file uses). Spec assertions retired old → new:

| Old pin | Disposition |
|---|---|
| freshness.spec.ts "the ribbon suffix is absent inside the hour and present past it" (`RIBBON_STALE_BATCH_SECONDS` = 3600, `· batch Nh old` strings) | RETIRED — boundary law is now tier-shaped (120/121 · 360/361 · 5580/5581) in freshness-tiers.spec.ts |
| freshness.spec.ts "THE RIBBON ENGAGES: the stale-batch suffix appears as the anchor crosses 1h" | RETIRED — surviving law (severity downstream of the ANCHORED age, moves while the page is open) re-pinned in freshness-tiers.spec.ts "the tier is downstream of the ANCHORED age" |
| freshness.spec.ts `ageHours(-10) === 0` | dropped with `ageHours`; the negative-age floor stays pinned via `humanAge(-10)` |
| freshness-resume.spec.ts "THE RIBBON ENGAGES AFTER SLEEP" (suffix `· batch 5h old` on a paused monotonic clock) | REWRITTEN as "THE TIER ENGAGES AFTER SLEEP" — fresh→critical across a 5h sleep, same split-clock drive |
| freshness-blind-resume.spec.ts "THE RIBBON SLOT IS NEVER SILENT while the age is unknown" (`ribbonBatchAgeUnknown` byte pins) | REWRITTEN as "THE CHIP IS NEVER SILENT" — the law survives on `snapshotChipUnknown` (always-on chip, no silent register); byte pins moved onto the chip strings |

Still-live exports untouched (unknown register, anchor/resume machinery,
`snapshotChip`/`snapshotChipUnknown`, stamps, `receiptIdentity`).

**Red-first evidence:** freshness-tiers.spec.ts written first; run died
at collection — `Cannot find module '…\web\lib\freshnessTiers'` — then
green 11/11 after the two modules landed.

**Mutation kills (each in isolation, each reverted):**

- **M1 · fresh bound `2×poll → 3×poll`** (`web-3820-p1a3-mutM1.log`):
  KILLED at exactly the 121s pin (freshness-tiers.spec.ts:48 —
  `freshnessTier(121, TIER_FALLBACK)` expected "aging", received
  "fresh"), plus the runtime-override (:72) and anchored-age (:100)
  pins: 3 failed / 8 passed.
- **M2 · provider failure arm claims source `"meta"`**
  (`web-3820-p1a3-mutM2.log`): KILLED at exactly the fallback-source pin
  (freshness-tiers.spec.ts:178, expected "fallback" received "meta") and
  the SchemaVersionMismatchError-arm pin (:191): 2 failed / 9 passed.

### Closing counts (p1a-3)

- Suite: 1566 → **1575 tests** (+11 freshness-tiers unit pins, −2
  retired freshness.spec pins; base = p1b-10's 1565 passed + 1 skipped).
- Full p1a run (final tree, fresh `npm run build`, port 3820):
  **1574 passed, 1 skipped, 0 failed (35.3s)**
  (`web-3820-p1a3-full.log`) — same single pre-existing styleguide skip;
  zero movement in every untouched spec.
- `npm run typecheck`: clean. `npm run lint` (eslint .): clean, zero
  warnings. `npm run lint:css`: clean. `npx eslint` on the 7 touched
  files: clean.

### p1a-4 · THE MIGRATION WAVE — canon appbar + tiered chip (Task 4)

The header's one-badge vocabulary becomes the canon appbar
(build-contract §10): `STREAM <state>` chip · `SNAPSHOT <age> · <TIER>`
chip · `BATCH #id` chip · `COVERAGE n/n ENGINES` chip · a native
`<details>` "Data status →" popover carrying the raw watermark as-ofs.
`LIVE · WATERMARKED` is RETIRED (house law 3: a healthy transport must
not launder a stale analysis). Commit `feat(web): p1a-4 the appbar
states each truth separately - stream, snapshot tier, batch, coverage;
LIVE·WATERMARKED is retired`.

**Production changes (7 files)**

- `web/lib/stream-posture.ts` — the vocabulary re-cut: `STREAM
  CONNECTED` (accent) / `STREAM CONNECTING` / `STREAM RECONNECTING`
  (warn) / `STREAM CLOSED` (down) / `STREAM AWAITING BASE` / `STREAM NO
  BATCH` (waiting = the dashed unknown register). Middots dropped — the
  canon chip is sans uppercase with no interior punctuation; the
  exported constant NAMES are unchanged, so the spec's identity pins
  survive by import. THE `live: true` ARM RETIRES: `RibbonStreamPosture`
  is now uniformly `{ label, tone }` — a liveness claim is
  unrepresentable, and CONNECTED is just another chip. R7's law (open
  AND base-delivered) is byte-for-byte the same test.
- `web/lib/freshness.ts` — `snapshotChip` (string) →
  `snapshotChipParts(batchId, ageSeconds, tier)` returning `{ label:
  "SNAPSHOT", batchId, age, tierWord }` with `SNAPSHOT_TIER_WORD`
  (fresh → null — "measured ink · no signal · no green"; AGING / STALE /
  CRITICAL). `snapshotChipUnknown` keeps its signature, returns the same
  parts shape with the EXACT R6 sentences in the age slot and tierWord
  null. The batch id left the chip TEXT (the BATCH chip owns identity)
  and survives in the parts for the chip's title.
- `web/components/Ribbon.tsx` — the stream branch renders the appbar:
  chip family classes per canon §05/§06 (c-accent / c-warn / c-crit
  outline / c-crit-fill / c-quiet / c-unknown dashed), 1×16px seps, the
  Data status popover (native `<details>`, panel is an overlay — the one
  lawful `--shadow`). New props: `snapshot: { parts, tier|null, title }`,
  `batchId`, `coverage`. Proof mode untouched.
- `web/components/PostureRibbon.tsx` — tier from
  `freshnessTier(anchoredSeconds, useMetaConstants().constants)`; R6's
  unknown arbitration preserved one-to-one (unresolved → unknown chip,
  no tier computed, no tier color). `TIER_FALLBACK_DISCLOSURE` =
  "thresholds from built-in fallback — /v1/meta unavailable" appended to
  the chip title when `source === "fallback"` (task-3 carry-in wording —
  the arm is reachable, not "unreachable": any failed/refused meta read,
  including before the round-trip resolves). Unavailable branch: `NO
  SERVABLE BATCH` is a c-crit chip; the `stale for` reading beside it is
  UNTOUCHED (its pins prove it). Empty branch renders through the same
  chip path via `ribbonEmptyPosture`.
- `web/components/ribbon.module.css` — the chip family (all font-sizes
  `var(--t-floor)` / `var(--t-mono-floor)`; text colors always the
  `-text` grade), appbar frame, sep, popover; `.badge.proof` + banner
  classes kept; `.live/.waiting/.down/.degraded/.snapshot` deleted
  (zero consumers).
- `web/app/layout.tsx` — `MetaConstantsProvider` mounted inside
  `PostureProvider` (one /v1/meta ask per tab).
- `web/app/styleguide/page.tsx` — sg-ribbon specimens moved to the new
  API (STREAM CONNECTED accent chip, tiered snapshot specimens);
  full rebuild remains Task 6.

**Coverage chip derivation (READ from the envelope, decision recorded)**:
`total` = `batch.watermarks.length` (the stamp vector — one entry per
engine the batch binds; served batches require ≥ 1 stamp);
`withheld` = deduped `batch.refused_engines` (schema: "engines whose
WHOLE book is withheld", present on the summary precisely because
`refused_count` counts position rows); `answered = total − withheld`.
Warn variant + `· <wire names> WITHHELD` when answered < total.
RENDERED ONLY WHEN UNAMBIGUOUS: if a refused engine carries no stamp
the chip is withheld entirely rather than invented — **Track B envelope
gap, ledgered**: `refused_engines` is `string[]` with no structural
binding to the stamp vector.

**Cosmetic divergence, ledgered**: canon §06 specimens print compact
ages (`SNAPSHOT 18h · CRITICAL`); production keeps `humanAge` precision
(`SNAPSHOT 18h 12m · CRITICAL`) — precision is house law (p0-5 pinned
"hours+minutes, not a coarse suffix"). Canon §10 shows `COVERAGE 2/2`;
the chip renders §05 dimension 3's fuller `COVERAGE 2/2 ENGINES`.

**Red-first evidence**: the five-test `p1a-4 · the canon appbar`
describe (p1a-fixes.spec.ts) written and run against the pre-migration
build: 5/5 failed (`web-3820-p1a4-red.log`) — missing testids, old chip
text, badge still painted, popover absent.

**THE MIGRATION TABLE — header vocabulary pins (pin-map §1; line
numbers are pre-migration)**

| Site | Old assertion | New assertion |
|---|---|---|
| shell.spec.ts:58 (×6 routes) | regex `LIVE · WATERMARKED\|STREAM · (CONNECTING\|RECONNECTING\|AWAITING BASE\|CLOSED)\|NO SERVABLE BATCH` | regex `STREAM (CONNECTED\|CONNECTING\|RECONNECTING\|AWAITING BASE\|CLOSED\|NO BATCH)\|NO SERVABLE BATCH` |
| p0-fixes:793 | `LIVE · WATERMARKED` visible (real held-open SSE) | `STREAM CONNECTED` visible + `LIVE · WATERMARKED` count 0 (added) |
| r3:193 / r3:208 | `STREAM · RECONNECTING` visible | `STREAM RECONNECTING` visible |
| r3:194 | `LIVE · WATERMARKED` count 0 | KEPT byte-identical (retirement guard) |
| r4:179 / r4:196 | `STREAM · RECONNECTING` visible | `STREAM RECONNECTING` visible |
| r4:180 | count 0 | KEPT |
| r6:207 / r6:307 | `STREAM · RECONNECTING` visible | `STREAM RECONNECTING` visible |
| r6:241 / r6:343 | `STREAM · CONNECTING` visible | `STREAM CONNECTING` visible |
| r6:208 / 242 / 344 | count 0 | KEPT |
| r7:317 / 332 / 382 | `NO SERVABLE BATCH` visible | KEPT (re-skinned as c-crit chip, same text) |
| r7:494 | `LIVE · WATERMARKED` visible (genuinely open server) | `STREAM CONNECTED` visible |
| r7:509 | `STREAM · AWAITING BASE` visible | `STREAM AWAITING BASE` visible |
| r7:533 | `LIVE · WATERMARKED` visible again on base frame | `STREAM CONNECTED` visible |
| r7:569 | `LIVE · WATERMARKED` visible before hang-up | `STREAM CONNECTED` visible (+ new `STREAM CONNECTED` count-0 after hang-up) |
| r7:580 | regex `STREAM · (RECONNECTING\|CONNECTING\|AWAITING BASE\|CLOSED)` | same set, middot dropped |
| r7:383 / 510 / 578 / 592 | count 0 | KEPT |
| state-matrix:1080 / 1110 | regex `STREAM · (…)` | middot dropped |
| state-matrix:1082 / 1112 / 1151 | count 0 | KEPT |
| state-matrix:1126 / 1150 | `NO SERVABLE BATCH` visible / count 0 | KEPT |

Every `LIVE · WATERMARKED` count-0 pin is KEPT with the retired string —
they are now the permanent resurrection guards (mutation ii's kill
sites alongside the CONNECTED pins).

**Retargeted @-payload pins (INTO the popover — the tests open it)**:
state-matrix:1096 (sse-snapshot) and :1149 (sse-recovered), r7:495
(before wake), r7:516 (through the dead connection — the popover's DOM
open state holds across re-renders, which is itself now exercised),
r7:587 (after hang-up, opened there). Each is preceded by a
`ribbon-data-status` click; p1a-fixes additionally pins the DEMOTION
(`@25,635,618` hidden while the popover is closed).

**THE MIGRATION TABLE — snapshot-chip pins (pin-map §2)**

| Site | Old | New |
|---|---|---|
| unit freshness-snapshot (5 exact string pins) | `"snapshot #18251 · 42s old"` / `5m` / `18h 12m` + 2 unknown sentences | structured-parts pins: `{label:"SNAPSHOT", batchId, age, tierWord}` at 42s/fresh·null, 300s/aging·AGING, 3550s/stale·STALE, 65532s/critical·CRITICAL + unknown parts (exact sentences, tierWord null) + NEW tier-vocabulary fence (no "old", no "UNKNOWN" in any tier word; fresh is null) |
| unit freshness-blind-resume:363-371 ("THE CHIP IS NEVER SILENT") | `snapshotChipUnknown(7,·)` full strings | `.age` = exact sentences, `.tierWord` null (new law: no tier over a refusal), `/\d+h old/` guard on `.age` |
| r3:198 | `snapshot #1 · 59m old` | `SNAPSHOT 59m · STALE` |
| r3:203 | `snapshot #1 · 1h 0m old` | `SNAPSHOT 1h 0m · STALE` |
| r4:183 / 189 | `snapshot #1 · 59m old` | `SNAPSHOT 59m · STALE` |
| r4:193 | `snapshot #1 · 5h 59m old` | `SNAPSHOT 5h 59m · CRITICAL` |
| r6:213 | `snapshot #1 · 2m old` | `SNAPSHOT 2m · AGING` (130s is past the two-sample rule) |
| r6:221-223 / 314 / 320 | `` `snapshot #1 · ${REFRESHING}` `` | `` `SNAPSHOT ${REFRESHING}` `` (local literal r6:54 unchanged — the sentence survives byte-identical) |
| r6:329-331 / 345-347 | `` `snapshot #1 · ${REFRESH_FAILED}` `` | `` `SNAPSHOT ${REFRESH_FAILED}` `` |
| r6:249 | `snapshot #1 · 3h 2m old` | `SNAPSHOT 3h 2m · CRITICAL` |
| r6:567 | `snapshot #1 · 59m old` | `SNAPSHOT 59m · STALE` |
| r6:580 | `snapshot #1 · 5h 59m old` | `SNAPSHOT 5h 59m · CRITICAL` |
| r7:519-521 | `` `snapshot #1 · age ${REFRESHING}` `` | `` `SNAPSHOT age ${REFRESHING}` `` (local literal r7:59 unchanged) |
| r7:537 | `snapshot #1 · 3h 2m old` | `SNAPSHOT 3h 2m · CRITICAL` |
| r7:591 | `snapshot #1 · 1h 0m old` | `SNAPSHOT 1h 0m · STALE` |
| p0:796 | `toContainText("42s old")` | `toContainText("42s")` (chip carries no "old") |
| p0:797 | `toContainText("snapshot #")` | `ribbon-batch` `toContainText("BATCH #")` (identity moved to its chip) |
| p0:807 | `toContainText("18h 12m old")` | `toContainText("18h 12m")` (precision pin survives on the CRITICAL chip) |

Negative pins KEPT unchanged and still binding: r6:224 (exactly one
chip), r6:227/332 (no "old" in the unknown register), r6:243
(`age UNKNOWN` contained), r6:250/581 (no "UNKNOWN" in the known
register), blind-resume:301-308 (no digits/"stale"/"old" in unknown
sentences), p0:811 + r7:496/570 (`ribbon-batch-age` retired), r7:538
(`ribbon-batch-age-unknown` count 0). `stale-since.spec.ts` and all
`batchFreshnessLine/Stamp` pins: zero movement (their producers are
untouched).

**stream-posture.spec.ts** — identity pins survived via constants; the
shape pins moved with the type: "EXACTLY ONE pair is live" → "EXACTLY
ONE pair is CONNECTED" (label === STREAM_CONNECTED, still `["open/true"]`),
tone pins waiting→warn for connecting/reconnecting, NEW accent-register
pin for CONNECTED, and the three not-contain-LIVE guards now sweep BOTH
`ribbonStreamPosture` and `ribbonEmptyPosture` labels across every
(state × hasBase) pair — all pass with the new vocabulary (no label
contains "LIVE").

**SUPERSEDED**: the header badge had ZERO pins; it is now a c-warn chip
and GAINED its first pin (p1a-fixes: visible + warn-text/warn resolved
colors, driven by `supersession.superseded = true` on the stream
fixture).

**Out of scope, untouched (verified)**: the 11 page-surface
LIVE·WATERMARKED / NO SERVABLE BATCH / SERVING echoes (inspector:464,
proof.spec ×5, state-matrix:340/1029, book:374, unit
inspector-evidence:33, proof-evidence:237, tornado-lines:277),
`web/lib/evidence.ts` producers, DegradationBanner, RouteRefusal,
error.tsx, the Lab's `lab-result-age` "Xs old" register (p1b vocabulary,
different surface).

### Proof of gate + mutation kills (p1a-4)

Three mutants, each built and run in isolation, each reverted
(revert verified by grep for the mutation residue + the final-tree
full-suite rerun):

- **M1 · tier styling never applied** (`TIER_CLASS` all → `cQuiet`;
  `web-3820-p1a4-mutM1.log`): KILLED at exactly the tier-register pin —
  p1a-fixes "tier styling is computed from the ratified bounds"
  (resolved --warn-text ≠ --ink-2 at the AGING step). 1 failed /
  8 passed in the file.
- **M2 · LIVE · WATERMARKED resurrected in the accent arm**
  (`web-3820-p1a4-mutM2.log`): KILLED at 4 pins across 3 files —
  p1a-fixes "STREAM CONNECTED … never LIVE", p0-fixes p0-5 (CONNECTED
  visible), r7 (4) ×2 (CONNECTED visible; the count-0 guards in the
  same tests fire on the same render). 4 failed / 29 passed.
- **M3 · popover omits the as-ofs** (`asOfs.slice(0, 0)`;
  `web-3820-p1a4-mutM3.log`): KILLED at the 5 retargeted watermark
  pins — p1a-fixes popover test, state-matrix sse-snapshot +
  sse-recovered, r7 (4) ×2. 6 failed / 53 passed (the 6th, r7 (3)'s
  `connections` poll, is a parallel-load flake unrelated to the
  mutation — green in both final-tree full runs).

### Closing counts (p1a-4)

- Suite: 1575 → **1582 tests** (+5 e2e `p1a-4 · the canon appbar`,
  +1 unit stream-posture accent-register pin, +1 unit
  freshness-snapshot tier-vocabulary fence; base = p1a-3's 1574 passed
  + 1 skipped).
- Full p1a run (final tree, fresh `npm run build`, port 3820):
  **1581 passed, 1 skipped, 0 failed (35.3s)**
  (`web-3820-p1a4-final-full.log`) — same single pre-existing
  styleguide skip; zero movement in untouched specs.
- `npm run typecheck`: clean. `npm run lint`: clean, zero warnings.
  `npm run lint:css`: clean (the new chip CSS is all `var(--t-*)`).
- Red-first: 5/5 new appbar pins failed pre-implementation
  (`web-3820-p1a4-red.log`).

### p1a-4b · the coverage chip's honesty arms are pinned (Task 4 review fix)

Review finding (IMPORTANT): every stream fixture ships
`refused_engines: []`, `ribbonCoverage` was module-private with no unit
spec, and the only pin was the happy `COVERAGE 2/2 ENGINES` — mutants
that survived the whole suite: (i) unbindable-withhold guard deleted,
(ii) `answered = total`, (iii) warn class dropped on partial coverage.
Commit `test(web): p1a-4b the coverage chip's honesty arms are pinned -
partial warns, unbindable withholds`.

- **`web/lib/coverage.ts` — NEW, pure**: `ribbonCoverage(envelope)` and
  the `RibbonCoverage` / `CoverageEnvelope` types lifted out of
  PostureRibbon (same bytes of logic — total = stamp vector, answered =
  total − deduped refused, unbindable → null). Ribbon.tsx re-exports the
  type; PostureRibbon imports the fn; zero behavior change (full suite
  proves it).
- **`web/tests/unit/coverage.spec.ts` — NEW, 5 tests, red-first** (died
  at collection: `Cannot find module '…\lib\coverage'`,
  `web-3820-p1a4b-red.log`; then 5/5 green). Pins: happy 2/2; partial
  `{answered:1,total:2,withheld:["debt_manager"]}` (kills mutant ii);
  UNBINDABLE → null, including one unbindable name alongside a bindable
  one (poisons the whole denominator); deduped refused names (a repeated
  name is one withholding); empty stamp vector → null.
- **p1a-fixes appbar describe +2 e2e pins** (the same
  `appbarSnapshotFrame` mutate harness as the SUPERSEDED pin):
  - partial: `refused_engines: ["debt_manager"]` (stamped) → chip
    `toHaveText("COVERAGE 1/2 ENGINES · debt_manager WITHHELD")` +
    resolved `--warn-text`/`--warn` register (kills mutants ii and iii);
  - unbindable: `refused_engines: ["ghost_engine"]` (no stamp) →
    `ribbon-coverage` `toHaveCount(0)` while BATCH #1 and SNAPSHOT 42s
    still render (only the underivable chip is withheld).
- **Mutation kill (M4, in isolation, reverted)**: unbindable guard
  deleted (`if (withheld.some(…)) return null` removed), rebuilt, run
  `npx playwright test -c tests/playwright.p1a.config.ts
  tests/e2e/p1a-fixes.spec.ts tests/unit/coverage.spec.ts` →
  KILLED at exactly the two withheld-arm pins: unit received
  `{"answered": 1, "total": 2, "withheld": ["ghost_engine"]}` where
  null was pinned; e2e `ribbon-coverage` count 1 where 0 was pinned.
  2 failed / 14 passed (`web-3820-p1a4b-mutM4.log`). Guard restored;
  targeted 16/16 green.

**Closing counts (p1a-4b)**: suite 1582 → **1589 tests** (+5 unit
coverage, +2 e2e appbar). Full p1a run (final tree, fresh build):
**1588 passed, 1 skipped, 0 failed (35.8s)**
(`web-3820-p1a4b-final-full.log`) — same single styleguide skip.
`npm run typecheck` / `npm run lint` / `npm run lint:css`: clean.

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

## Phase 1 Track B CLOSE (p1b-7) — seal

### Delivered scope (the wave's whole claim)

- **The route boundary** (p1b-0): ROOT `error.tsx` → `RouteRefusal` — one
  boundary above all surfaces; a render throw states its refusal (visible,
  named, reset affordance) instead of white-paging the route. This is the
  declared LONG-TAIL NET for everything no classifier covers.
- **wireGuard** (p1b-1): `web/lib/wireGuard.ts` — the one sanctioned
  wire-read vocabulary (`WIRE_DECIMAL`, `isWireDecimal`, `isZeroDecimal`,
  `isWireScale`, `isWireCount`, `wireBigInt`, `FieldCheck`/`malformedFields`);
  the BigInt coercion class killed at its root (`""` is null, never `0n`).
- **The three classifier siblings**: `classifyRunBookEngine` (p1b-2, the
  whole ~40-field subtree, per-index naming, schema-exact nullability),
  `classifySetRunEngine` (p1b-3, the CONSUMED set by pinned decision, +
  tornado malformed arm/header clause/ledger row), `classifyFactorPrice`
  (p1b-4, entry-level, `price_decimals` REQUIRED, per-entry independence in
  the evidence drawer).
- **Result identity** (p1b-5): `web/lib/resultIdentity.ts` (`ResultIdentity`,
  `identityLine`, `stressResultIdentity`, `resultReceipt`) + the Lab
  address-mode §5 completion (full identity line + anchored age under the
  stale barrier).
- **The nine-item gap audit** (p1b-6): five brief fixes (book success-arm
  abort, feed envelope-echo epoch gate, observatory abort+as-of, history
  batch-weld, inspector params/activity keying) + controller items 6–9
  (coercion residue through `wireBigInt`, computed-at on the non-found arms,
  the run-again register, `stressStateHfInfo`/`moverRatioDisplay`).
- **p1b-7a** (`8ad13b4`): the pre-existing `UnavailableError` unused-import
  lint warning (LabBookPanel.tsx:27, on record since p1b-2) removed — one
  line, the brief's sanctioned in-passing fix. `npm run lint` is now
  warning-free.

### Mutation transcript (Step 1)

`.superpowers/sdd/p1b-mutations/{mutations.json,transcript.md}` — the
t9w20-format record, RECONCILED from the task records (task reports + this
ledger's p1b sections + the `web-3819-p1b5/p1b6-mut*.log` root logs), not
re-run: **17 mutants, 17 KILLED, 0 survived** (p1b-0 ×1, p1b-1 ×2, p1b-2 ×3,
p1b-3 ×2, p1b-4 ×2, p1b-5 ×2, p1b-6 ×5; two multi-vehicle kills). Every
mutation's fixed-code anchor re-verified against the current tree (CRLF
sources, line-convention-independent anchors); drifted kill-assertion spec
lines re-anchored in the transcript (`recorded :N → now :M`); task 2's kills
sourced from this ledger alone (no task-2 report exists, by record).

### Closing verification (p1b-7, final tree = `8ad13b4` + this seal)

- Full Track B suite (fresh `npm run build` +
  `npx playwright test -c tests/playwright.p1b.config.ts`, port 3819):
  **1537 passed, 1 skipped, 0 failed (32.9s)** (`web-3819-p1b7-full.log`) —
  byte-consistent with the p1b-6 seal count; the skip is the same single
  pre-existing styleguide skip.
- `npm run typecheck` — completely clean (exit 0).
- `npm run lint` — clean, **zero warnings** (the p1b-7a removal discharged
  the only standing warning).
- `npm run lint:css` — clean.

### Deliberate OUT-of-scope inventory (declared, not drifted)

1. **Un-consumed `SetRunEngineSummary` fields** (`before_bad_debt_usd`,
   `total_debt_usd_after`, census counts, …): `classifySetRunEngine`'s scope
   is the CONSUMED set BY DECISION — recorded in the module header and held
   by the spec's out-of-scope pin. Any surface that starts consuming one of
   these fields owes `setRunClassification.ts` the check first.
2. **Non-classified surfaces are covered by the route boundary, not by
   per-field classifiers.** Track B classified the three families whose
   malformed bytes had OBSERVED costumes (run-book engines, set-run
   engines, factor prices) and wire-guarded the named coercion sites; every
   other surface's malformed-wire long tail throws into the p1b-0 refusal
   register — segment-scoped, named, honest — instead of white-paging. That
   is the boundary's declared job, not an accident.
3. **Phase-3 residue list** (named candidates for the residue sweep, all
   flagged in p1b-6):
   - `displayRatio`'s WAD arm (`formatUnits(hf.wad, 18)`,
     lib/history-series.ts) — a malformed wad THROWS into the route boundary
     rather than coercing; not named by the controller, unchanged.
   - `displayHf` (lib/history-series.ts) — the same class, same disposition.
   - `stressStateHfInfo`'s num/den arm (app/lab/labPanelLines.ts:238-239) —
     `Number("")` coerces to 0, so a malformed num/den pair can still yield
     a plausible ratio (the WAD arm is wire-guarded; the num/den arm is
     not). The p1b-6 fix guarded the wad arm the controller named; the
     num/den arm is residue. — FIXED in the final wave (p1b-8, this
     commit): the arm now rides the same `isWireDecimal` guard as its wad
     sibling, red-first pinned in lab-panel-lines.spec.ts; off the residue
     sweep.
   - `stableBoundaryScenarios` (labPanelLines.ts:278-281) bare `BigInt`
     over shock factors — `""` coerces to `0n` mis-ordering the boundary
     group, `"-"` throws to the route boundary; ordering-only.
   - The unpublished-gap title's "carries neither wad nor num/den" wording —
     approximate for a malformed (vs absent) pair; controller mandated the
     existing arm, wording refinement deferred.
4. **Book-mode / set-run identity lines** (p1b-5 deferred observation): the
   matrix/tornado surfaces compose their own pre-existing identity
   statements; migrating them onto `identityLine`'s book/set arms remains
   available, unexercised.
5. **Post-parse information boundary** (p1b-11, Codex round 3 finding A2 —
   RECORDED as structural, not fixable at this layer): fractional JSON
   tokens that round to safe integers during JSON.parse are
   indistinguishable from integer tokens (`9007199254740991.1` parses to
   exactly `9007199254740991`, and no predicate over the parsed number can
   separate them); complete closure requires raw-text response validation
   (a re-parse architecture — Phase-3+ architectural candidate, or
   server-side contract testing). The one rounding that leaves a
   fingerprint — a fractional token rounding to NEGATIVE ZERO
   (`-1e-324` → `-0`) — is refused by the count guards (finding A1, fixed
   in p1b-11); every other rounding leaves none. Documented-limitation
   block on the two guards in `web/lib/wireGuard.ts`.

### Still-open server defect (outside web scope, held open since p0-9)

**Solver-error `prices: null` serialization**: the API's solver-error path
(`wireLiquidationPrice`) serializes `liquidation_price.prices: null` — a Go
nil slice — violating api/openapi.yaml's required-array contract.
Server-side slice init needed; the web side defends meanwhile (the p0-9
not-established fold + p1b-4's entry classification), so no UI crash and no
false health claim, but the WIRE is still out of contract. Remains open for
the API program; re-flagged here so the Track B close cannot be read as
resolving it.

### Vocabulary addition (for the Phase 3 clarity review)

`AGE_UNKNOWN_RUN_AGAIN = "age UNKNOWN since resume · run again to refresh"`
(lib/freshness.ts, p1b-6 item 8) — third arm of the unknown-age register,
same composed shape as the two existing phrases, used ONLY in the Lab
result-age path (which wires no resume repair by the p1b-5 sanctioned
decision). The ribbon and every other surface keep the two existing phrases,
byte-pinned. Phase 3's clarity review owns whether the three-phrase register
stays or converges.

### Deviation clause (recorded, carried forward)

**Activity-reset effect timing** (p1b-6 fix 5): the inspector activity's
address keying is expressed as an explicit drop-and-restart
(`activityForRef` + `reset()` BEFORE the first page of a new address —
abort in-flight, epoch discards late pages) rather than literal
`{for: addr}` state, because `useCursorPages` owns the accumulated rows.
Observable guarantee identical for every reader of `activity.rows` (no
cross-address leak, no reliance on remount semantics); if a future refactor
lifts the rows out of the hook, the literal keying becomes available. This
is the wave's one recorded shape deviation from the brief's letter.

### What runs next

The controller dispatches the Codex adversarial round (fresh session;
context = the r3 findings as the checklist + the plan's scope statement).
The round verifies the three r3 findings CLOSED and hunts the residual
class WITHIN the declared scope above; findings become a fix wave (the
p0-8/p0-9 precedent).

## Phase 1 Track B Codex fix wave (p1b-9)

The round the p1b-7 seal dispatched ("What runs next") came back with three
findings; all three are fixed here, test-first, in one commit
(`fix(web): p1b-9 codex round - response address welds the identity,
histogram counts join the classifier, activity rows mask synchronously`).

### Finding 1 (HIGH) — the response's own address welds the identity

`web/lib/resultIdentity.ts:69-98`: `StressIdentitySource` omitted the
response's own `address` field (verified present on `StressResponse` in the
generated schema, and it survives `lookup()`'s refinement — only `found` is
sealed off), so `stressResultIdentity` trusted the DISPATCH address
unconditionally: a mislabeled body (cache/proxy/server fault) rendered B's
numbers under "results for A".

**Fix**: `address` added to `StressIdentitySource`;
`stressAddressMatchesDispatch(addr, response)` (case-insensitive — checksum
casing is not an identity) consulted in LabClient's settle path BEFORE the
result is admitted. A mismatch settles as a new `StressPhase` arm
(`{status: "mismatch", addr, echoed}` — carrying NO result, so no arm can
read the body) and renders the contract-refusal register
(`addressMismatchLine`, addressBinding.ts) under testid
`lab-address-mismatch`: both addresses named verbatim, nothing claimed for
either, in the matrix contradiction arms' identity-refusal tone. The
mismatch phase binds into `addressBinding` like done/error, so the stale
barrier still interposes on an edited input.

**Pins**: unit — result-identity.spec.ts ×3 (exact echo matches;
lowercased echo matches; another account refused) +
address-binding.spec.ts ×2 (mismatch binds like done/error; the line names
BOTH addresses, claims nothing, never wears "results for"). e2e —
p1b-fixes.spec.ts "f1: a mislabeled response body is refused by name":
structuredClone of the committed stress fixture with only `address` moved →
refusal visible naming both, `lab-found`/`lab-result-address`/
`lab-result-age` all count 0, route live. RED witnessed before the fix
(lab-found settled under the wrong head, no refusal testid).

**Kill (p1b-9-M1)**: comparison removed from the settle path (mutant built)
→ the f1 e2e pin dies in isolation (1 failed); restored → green.

### Finding 2 (HIGH) — the histogram counts join the classifier

`web/app/lab/engineClassification.ts:73-87`: the COUNTS bypassed the p1b-2
classifier. The schema types them wire NUMBERS (verified:
`HistogramBucket.count`, `RunBookHistogram.infinite_count`/`refused_count`,
every `RunBookTransitions` count and margin, `movers_total` are all
`number`), but the JSON cast guarantees nothing: `count: ""` passed the gate
and coerced to a zero-share costume in `belowOneCount`/`measuredCount`
(`0 + ""` is `"0"`); floats and NaN walked into `readTransitions`' margin
arithmetic (NaN comparisons silently false → a "contradiction" register over
garbage, not the malformed register the body earned).

**Fix**: every consumed count is judged by `isWireCount`, per side and per
index, in wire read order — `buckets[].count`, `infinite_count`,
`refused_count` per aggregate side; `lanes[].index`, `outflows[].from`,
`cells[].to`/`rows`, `from_rows[i]`/`to_rows[i]`, the five census totals
(`total_rows`, `measured_rows`, `unmeasured_rows`,
`unmeasured_refused_in_batch_rows`,
`unmeasured_excluded_by_this_layer_rows`) on the matrix; `movers_total`
(moversDisclosure's own denominator — a malformed total rendered "NaN are
not on this page"). `held_rows`/`lane_changed_rows` ride a new
`isNullableWireCount` (null is the wire's own "not measured" statement,
NEVER malformed). The consumed-count inventory was read off
`belowOneCount`/`measuredCount`/`unmeasuredTail`/`moversDisclosure`
(labRunBookLines.ts) and `readTransitions`/`belowOneLanes`/
`crossingCounts`/`transitionRibbons` (labTransition.ts).

**Pins**: unit — engine-classification.spec.ts ×6, each injection class
named (`"" as never`, `2.5`, `Number.NaN`) per side and per index; the
nullable pair pinned legal-null AND malformed-non-null. RED witnessed: all
6 failed pre-fix with the classifier returning `[]`. e2e —
p1b-fixes.spec.ts "f2: a malformed histogram COUNT refuses the engine by
name": `before.hf_histogram.buckets[0].count = "" as never` → cell
malformed, engine panel names the field, DM panel healthy, route live. RED
witnessed (cell settled with outcome null).

**Kill (p1b-9-M2)**: counts group dropped (histogram counts, lane/outflow/
cell counts, margins, census totals, nullable pair, movers_total all
removed) → the 6 unit pins die in isolation (6 failed); restored → green.

### Finding 3 (MEDIUM) — activity rows mask synchronously

`web/app/inspector/[addr]/InspectorSurface.tsx:277-291`: the p1b-6 fix-5
activity reset is EFFECT-timed, so on an A→B component reuse the first B
render still holds A's accumulated rows — exactly the one-render window the
p1b-7 seal's deviation clause recorded.

**Fix**: the p1b-6 params pattern (render-synchronous derived-empty)
applied at the consumption seam, consistent with `useCursorPages`'s
ownership of the rows (the reset cannot move into render — a state write on
a shared hook): `scopedRows(dispatchedFor, renderingFor, rows)`
(lib/pagination.ts) masks to the empty walk unless the walk's owning
address — held in `activityScope` state, set beside the reset at
fetch-dispatch — matches the rendered `addr`. Both consumption sites
(`InspectorPositionCard activity=`, `InspectorActivity events=`) read the
masked `activityRows`. The p1b-7 deviation clause is discharged: the
observable guarantee no longer relies on remount semantics even for the
first render of a reuse.

**Pins**: unit — pagination-scope.spec.ts ×3 (pass-through is identical and
uncopied when scopes match; another address's rows derive EMPTY; a null
scope derives empty). RECORDED CHOICE (per brief): the A→B reuse is
remount-dependent in the real router and e2e navigation between two
inspector addresses is a full-document load, so the reuse frame cannot be
produced from outside — the pin is the mask's own law at unit level,
documented in the spec header; the pass-through arm is exercised by every
existing inspector activity e2e.

**Kill (p1b-9-M3)**: mask removed (`return rows` unconditionally) → the
mismatched-scope and null-scope pins die in isolation (2 failed);
restored → green.

### Closing counts (p1b-9)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean, zero warnings
- `npm run lint:css` — clean
- `npm run build` — clean (fresh, post-restore)
- FULL Track B suite (`npx playwright test -c tests/playwright.p1b.config.ts`,
  port 3819, fresh build): **1554 passed, 1 skipped, 0 failed (34.4s)**
  (`web-3819-p1b9-full.log`) — the p1b-8 baseline (1538) plus exactly the
  16 new pins (6 classifier + 3 identity + 2 binding + 3 scope + 2 e2e);
  the skip is the same single pre-existing styleguide skip.
- Mutations: **3 mutants, 3 KILLED, 0 survived** (M1 e2e-in-isolation,
  M2/M3 unit-in-isolation), every mutant restored and the restoration
  diff-verified against the pre-mutation bytes.

## Phase 1 Track B Codex fix wave 2 (p1b-10)

Codex round 2 judged both p1b-9 closures PARTIAL; both completions land
here, test-first, in one commit (`fix(web): p1b-10 codex round 2 - nested
accounts join the weld, populations are nonnegative safe integers`).

### Finding 1 completion (HIGH) — the nested accounts join the weld

`web/lib/resultIdentity.ts:82-100` (pre-fix): the p1b-9 weld compared only
dispatch vs the TOP-LEVEL `response.address`, but each
`scenarios[].results[]` carries its own `account`
(`ScenarioResult.account`, generated schema — verified it survives
refinement: `RefinedScenarioResult` omits only before/after/projection). A
body with an honest envelope and one nested result for another account
reached `done` and rendered B's state under "results for A".

**Fix**: `StressIdentitySource`'s nested results gain `account`;
`stressNestedAccountMismatch(addr, response)` walks scenarios/results in
wire order and returns the FIRST offender as
`{path: "scenarios[i].results[j].account", account}` (case-insensitive,
same law as the top-level weld). LabClient's settle path consults it AFTER
the top-level weld, BEFORE admission: a mismatch settles the existing
`mismatch` phase arm grown with optional `path`, carrying NO result, and
`addressMismatchLine(dispatched, echoed, path?)` names the exact wire
field plus both addresses under the same `lab-address-mismatch` testid —
nothing claimed for either.

**Pins**: unit — result-identity.spec.ts ×3 (all-echo admits incl.
lowercased nested + committed fixture + empty scenarios; mismatch named BY
PATH `scenarios[2].results[0].account`; FIRST offender in wire order) +
address-binding.spec.ts ×2 (the line names path + both addresses, claims
nothing, never wears "results for"; a pathed mismatch phase still binds
like done/error so the stale barrier interposes). e2e —
p1b-fixes.spec.ts "p1b-10 f1": structuredClone of the committed stress
fixture with ONE nested account moved (top-level address honest) →
refusal visible naming path + both accounts;
`lab-found`/`lab-result-address`/`lab-result-age` all count 0; route
live. RED witnessed before the fix (missing-export load failure on the
unit pins; e2e: no refusal element — the body settled as done under the
dispatched head).

**Kill (p1b-10-M1)**: nested loop removed
(`stressNestedAccountMismatch` returns null unconditionally) → the
nested-mismatch BY-PATH unit pin dies in isolation (1 failed);
restored → diff-verified byte-identical.

### Finding 2 completion (HIGH) — populations are nonnegative safe integers

`web/lib/wireGuard.ts:44-46` (pre-fix): p1b-9's `isWireCount` was
`Number.isInteger` alone — it admitted NEGATIVE populations (bucket
counts, `movers_total: -1` → "Showing all -1 accounts" as a
computed-looking clause) and UNSAFE integers (JSON.parse rounds
9007199254740992.5 to 2^53; exact arithmetic downstream renders a
computed-looking WRONG answer).

**Fix**: the guard is SPLIT by schema semantics — `isWirePopulation`
(nonnegative safe integer: `Number.isSafeInteger && >= 0`) and
`isWireSignedCount` (safe integer, sign kept). `isWireCount` is DELETED,
not aliased: find_referencing_symbols showed no consumer outside the two
classifiers and the guard's own spec, so no call site can dodge the
choice. Every consumed count field was assigned by READING its schema
description first; the full assignment table lives in wireGuard.ts's
module comment. Summary:

| Guard | Fields (schema evidence) |
|---|---|
| `isWirePopulation` | RunBookAggregate `accounts`/`eligible_accounts`; histogram `buckets[].count`/`infinite_count` ("accounts with NO DEBT")/`refused_count` ("COUNTED here"); transitions `lanes[].index`/`outflows[].from`/`cells[].to` (lane indices), `cells[].rows` ("a COUNT of position rows"), `from_rows[]`/`to_rows[]` ("whole BEFORE/AFTER population"), the five census totals, nullable `held_rows`/`lane_changed_rows` (measured-row tallies; null stays a statement — `isNullableWirePopulation` in both classifiers); `movers_total` ("the FULL count of accounts that moved"); SetRun `accounts` ("measurable positions"), `movement_excluded_accounts` ("could not TEST"), nullable `flipped_to_eligible` ("flips FALSE to TRUE, never a net")/`hf_dropped_accounts` ("STRICTLY DROPPED") |
| `isWireSignedCount` | RunBookEngine `newly_eligible_accounts` ("a NET count that also subtracts any flip back to healthy"; "a signed net") — the ONLY consumed signed count; SetRun `eligible_accounts_delta` ("NET — may be negative") is recorded for it IF a surface ever consumes it (today out of scope per p1b-3's decision) |

**Pins**: unit — wire-guard.spec.ts ×2 (population: -1 and 2^53 refused,
MAX_SAFE_INTEGER admitted; signed: -3 and MIN_SAFE_INTEGER admitted, ±2^53
refused) + engine-classification.spec.ts ×3 (NEGATIVE bucket
count/movers_total/measured_rows named per path; UNSAFE 2^53
total_rows/infinite_count named; `newly_eligible_accounts = -3` STILL
LEGAL and unsafe named) + set-run-classification.spec.ts ×1 (negative
`accounts` named; 2^53 `movement_excluded_accounts` named; negative
non-null `hf_dropped_accounts` named while null stays a statement). RED
witnessed: 5 assertion failures pre-fix (classifier returned `[]` for
every negative/unsafe injection) + the wire-guard spec's missing-export
load failure.

**Kills (2/2)**: (p1b-10-M2) population guard loses `>= 0` → the three
negative pins die in isolation (3 failed); (p1b-10-M3) loses
`Number.isSafeInteger` (weakened to `Number.isInteger`) → the three
unsafe pins die in isolation (3 failed). Both restorations diff-verified
byte-identical.

### Closing counts (p1b-10)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean, zero warnings
- `npm run lint:css` — clean
- `npm run build` — clean (fresh, post-restore)
- touched unit specs (result-identity, address-binding, wire-guard,
  engine-classification, set-run-classification) — **71 passed**
- e2e lab + inspector + p1b-fixes — **66 passed**
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1565 passed, 1 skipped, 0 failed (34.7s)**
  (`web-3819-p1b10-full.log`) — the p1b-9 baseline (1554) plus exactly
  the 11 net new pins (3 identity + 2 binding + 1 net wire-guard [2 new,
  1 `isWireCount` test deleted with its symbol] + 3 engine-classification
  + 1 set-run + 1 e2e); the skip is the same single pre-existing
  styleguide skip.
- Mutations: **3 mutants, 3 KILLED, 0 survived**, all unit-in-isolation,
  every restoration diff-verified against the pre-mutation bytes.

## Phase 1 Track A — the shared component kit (p1a-5)

### p1a-5 · verdict banner, exact affordance, chip family, states (Task 5)

The canon's §4–§8 primitives land as an ADDITIVE kit — zero page-consumer
changes, zero pin movement outside the new spec. Commit `feat(web): p1a-5
the component kit lands - verdict banner enforces its identity strip,
exactness carries a visible cue, chips speak nine dimensions`.

- **`web/lib/kit.ts` — NEW, pure (the p1a-4b lift pattern)**: the kit's
  composition law lives where unit specs can pin it; the thin components
  render these models verbatim. Exports: `VERDICT_TONE_CLASS`
  (current→vAccent · refused/superseded/partial→vWarn · empty→vQuiet;
  §4's `.vCrit` spine is defined in the CSS but no phase-1 variant maps
  to it — the grammar's escalation slot), `identityMissing` (render-empty
  = missing: null/undefined/booleans/whitespace-only strings/arrays of
  only those; elements and numbers are content — 0 is a lawful count,
  never absence), `VERDICT_IDENTITY_REFUSAL` (structural-refusal copy
  naming the omission and stating the law), `verdictBannerModel`,
  `CHIP_TONE_CLASS` (7 tones → the 7 §6 recipes), `refusedChipSegments`
  (state word → plain cause → wire code; the array order IS the render
  order), `exactValueMode` (human===exact → "plain"), `exactAriaLabel`
  (the §7 featured-specimen grammar).
- **`web/components/VerdictBanner.tsx` + `verdict.module.css`**: §4
  grammar — answer at `--t-chapter`/650/lh 1.3, qualification `--t-ui`
  `--ink-2` capped at the 720px prose measure, identity strip as a flex
  chip row; 1px `--line` frame + 4px LEFT border carrying the variant
  tone; flat (no shadow — data surface). THE RATIFIED LAW enforced
  structurally: a missing/render-empty `identity` prop renders a
  warn-register structural refusal
  (`data-identity-refusal="missing-identity-strip"`) naming exactly what
  is missing — not a dev-throw, and never the happy sentence.
- **`web/components/ExactValue.tsx` + `exact.module.css`**: §7 CSS
  verbatim (dotted `--ink-3` underline, offset 3px, cursor help, " ⧉"
  `::after` at `--t-floor`; hover/focus-visible → accent underline +
  `--chip-bg` ground, glyph → `--accent-text`); `title`=exact,
  `tabIndex=0`, `role="button"`, aria-label per the featured grammar,
  Enter copies via `navigator.clipboard` with a graceful no-op fallback.
  FORBIDDEN arm: human===exact renders a PLAIN span (no affordance, no
  title, no glyph) + dev-warn — the false-scent law.
- **`web/components/StatusChip.tsx` + `chip.module.css`**: `StatusChip`
  (the seven §6 tones + mono `val`, optional 7px dot — HOLLOW on the
  unknown register), `ChipVal` (embedded mono value for mid-sentence
  composition: "COVERAGE 2/2 ENGINES", "30 BATCHES NOT RETAINED"),
  `RefusedChip` (the canon refused-tag: dashed `--warn` border on the
  `--warn-bg` state fill, `--warn-text` ink; plain cause LEADS, wire code
  mono secondary; `word` arm serves WITHHELD; named RefusedChip because
  the legacy `RefusedTag` and its 15 consumers stay untouched this
  phase), `EngineTag` (mono wire names only — never a sans AAVE/DM
  identity). The `.chip`/`.val`/`.c*` recipes match ribbon.module.css's
  landed appbar family byte-for-byte, plus the kit-only `cOk` (the appbar
  deliberately has no green — `ok` exists solely for the comfortable risk
  verdict) and inline-block `.refusedTag` (mixed prose — flex would
  swallow the middot spacing).
- **`web/components/states/*` + `states.module.css`**: the six §8 states
  with the specimen copy as overridable defaults — `Skeleton` (reserves
  the EXACT final geometry via width/height; 1.6s shimmer strictly inside
  `prefers-reduced-motion: no-preference`), `EmptyDefinitive` (absence is
  computed, not assumed; quiet COVERAGE 2/2 + SNAPSHOT 48s chips),
  `InvalidInput` (RETAINED input in mono dotted-crit; "Nothing was looked
  up: no request left this page."), `RefusedCard` (warn-bg card,
  RefusedChip default `sweep failed twice · sweep_failed_no_success`,
  accounting foot line), `UnavailableCard` (c-unknown `30 BATCHES NOT
  RETAINED` — a named hole, never zero), `SupersededCard` (mono
  bound-identity clause, SUPERSEDED c-warn chip, the late-response law
  line). The anti-state panel's laws are recorded in the module and
  component comments.

### Red-first evidence + mutation kills (p1a-5)

- RED: `web/tests/unit/kit.spec.ts` (11 pins) written first, died at
  collection — `Cannot find module '…\lib\kit'`
  (`web-3820-p1a5-red.log`); implemented, then 11/11 green
  (`web-3820-p1a5-green.log`).
- **p1a-5-M1 — banner identity enforcement removed** (the refusal branch
  deleted from `verdictBannerModel`, in isolation): KILLED at exactly the
  two identity-law pins — 2 failed / 9 passed
  (`web-3820-p1a5-mutM1.log`). Restored byte-identical.
- **p1a-5-M2 — affordance forced when human===exact** (`exactValueMode`
  → constant "affordance", in isolation): KILLED at exactly the
  forbidden-arm pin — 1 failed / 10 passed (`web-3820-p1a5-mutM2.log`).
  Restored byte-identical; post-restore targeted run 11/11 green.

### Closing counts (p1a-5)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean.
- `npm run build` — clean (fresh, `web-3820-p1a5-build.log`).
- FULL p1a suite (`npx playwright test -c tests/playwright.p1a.config.ts`,
  fresh build): **1599 passed, 1 skipped, 0 failed (34.8s)**
  (`web-3820-p1a5-final-full.log`) — the p1a-4b baseline 1588 plus
  exactly the 11 new kit pins; same single pre-existing styleguide skip.
- Consumers: NONE by design — the kit is additive (existing
  StatCard/RefusedTag/Drawer interfaces untouched); Task 6 mounts the
  specimens in the styleguide (render pins land there); Phase 3 migrates
  the page surfaces.
- Recorded for Task 6 / reviewers: (i) the unit project cannot load CSS
  modules (the Playwright transform drops the import binding — verified
  empirically), hence the pure-model lift and model-level pins — DOM
  order, resolved colors, and copy-glyph behavior are Task 6 e2e
  territory; (ii) RefusedChip/RefusedTag coexistence is deliberate;
  (iii) `.vCrit`, `.dot`, and the states' default specimen copy are
  grammar slots awaiting their styleguide/Phase-3 consumers.

### p1a-6 · the styleguide is the living canon (Task 6)

The /styleguide route rebuilt canon-structured — the component kit's
first mount, the §04 palette's self-verifying contrast gate, and the §11
interaction register's reference implementation. Commit `feat(web): p1a-6
the styleguide is the living canon - self-verifying contrast, nine
dimensions, the interaction register demonstrated`.

**Specimen-walk ledger (shell.spec old → new).** Old 12:
`sg-tokens · sg-statcard · sg-severity · sg-chips · sg-marks ·
sg-stampline · sg-ribbon · sg-table · sg-pagination · sg-charts ·
sg-drawer · sg-truth`. New 19, in the build contract's own section order,
then the pre-canon production primitives Phase 3 migrates:
`sg-tokens (rebuilt: palette + LIVE contrast lab) · sg-type (NEW: the
closed 14-token set) · sg-verdict (NEW: five §4 variants + the
identity-refusal law specimen) · sg-freshness (NEW: all five snapshot
states) · sg-dimensions (NEW: nine dimensions + three compositions) ·
sg-exact (NEW: §7 affordance + forbidden arm) · sg-states (NEW: six §8
states) · sg-table (kept, §9 reskin) · sg-pagination (kept) · sg-drawer
(kept) · sg-ribbon (kept, §10) · sg-charts (kept, §11 conventions) ·
sg-interaction (NEW: the §11 register demo) · sg-statcard · sg-severity ·
sg-chips (now also mounts the kit EngineTag) · sg-marks · sg-stampline ·
sg-truth (all kept)`.

**FOUND AND FIXED — the CI env-var build was broken at HEAD.**
`NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run build` died at /styleguide
prerender: the old SERVER page passed column `cell` functions straight
into the client DataTable ("Functions cannot be passed directly to Client
Components"), so the exact build CI's web job runs could not complete on
this toolchain (the web CI lane has been standing-red since before Track
A). Fixed structurally: the §9 table specimen moved into a client
component (`app/styleguide/TableSpecimen.tsx`, the shape PaginationDemo
already used). The env-var build is now clean and is the build this
task's counts were taken on.

- **`web/lib/contrast.ts` — NEW, pure**: parseCssColor / compositeOver
  (translucent grounds composite first, §14 discipline) /
  relativeLuminance / contrastRatio (WCAG 2.x) / AA_NORMAL_TEXT /
  formatRatio. The styleguide MEASURES its swatches through this module —
  nothing prints the canon's numbers.
- **`ContrastSpecimens.tsx` — NEW client**: 17 audited §04 pairs (every
  text token on its worst ground(s), incl. both term pairs and
  accent-ink-on-accent), measured from getComputedStyle on the rendered
  swatches; re-measures on data-theme mutation AND the OS scheme query.
  THE KNOWN-BAD PROBE: `--ink-3 on --chip-bg` — the §04 ledger's own
  never-on-chip law, rendered WITH its failing measured ratio and pinned
  to the exact per-theme values (4.29 light · 4.05 dark): numbers a
  stubbed computation cannot produce. All 17 lawful pairs verified ≥ 4.5
  in BOTH themes before pinning (worst margins: light ink-3/panel-2 4.51,
  crit-text/chip 4.52; dark ink-3/panel 4.53, crit-text/chip 4.54).
- **`InteractionRegisterDemo.tsx` + `interaction.module.css` — NEW**: the
  §11 register on one specimen stress ladder — Tab enters (ONE stop),
  ←/→ traverse in data order, Home/End jump, Enter focuses the mark's
  ledger row (the evidence), Esc leaves; focused mark wears the 2px
  accent ring; the mono readout persists past blur (hover is never the
  only path; the canon's −30% readout specimen verbatim). ARIA:
  `aria-details` → `#sg-ir-ledger` (the tabular twin, one row per mark,
  exact strings), `aria-describedby` → `#sg-ir-method`; a visible
  `EXACT DATA ↓` control moves focus to the ledger. This is the
  reference implementation Phase 3 copies.
- **Kit mounts**: five VerdictBanner variants with §4's exact copy
  (current's $8.5K wears ExactValue), PLUS the identity-refusal law
  specimen (`identity={null}` → the warn-register structural refusal).
  Freshness tier row: four `snapshotChipParts` tiers composed EXACTLY as
  the appbar composes them (the kit chip recipes match ribbon
  byte-for-byte) + the c-unknown `AGE UNKNOWN — NO BATCH METADATA` chip.
  Nine §6 dimension rows + three compositions in the fixed order
  (comp-1 is the brief's `LIQUIDATABLE · DUST · COMPUTED · SNAPSHOT 18h
  12m · CRITICAL`). ExactValue featured + forbidden arms. All six §8
  states. §9 table reskin: refused money cells print the word `refused`
  in amber (never an em dash), the status column carries the kit
  RefusedChip, and the footer reconciles per engine — never one summed
  count.
- **`VerdictBanner.tsx`**: the identity strip gains `data-slot="identity"`
  — a stable DOM hook (CSS-module class names are not a contract); the
  task-5 carry-in pin asserts it non-empty on all five specimens.
  **Carry-in ruling — data-variant on refusal renders: evaluated,
  AGREED with the landed task-5 behavior** (the refusal render keeps the
  REQUESTED variant in `data-variant` and adds the
  `data-identity-refusal` marker — what was asked and what happened are
  both stated); now pinned.
- **Precision divergence carried from §p1a-4**: ages print `humanAge`
  output (`18h 12m`), not the canon specimens' compact `18h` / `4m 12s`
  — same cosmetic divergence, same ruling.

**Verification.** RED: the new pins written first; the old page could not
even BUILD under the env var (the red log is the build failure above).
GREEN: 9/9 targeted (`web-3820-p1a6-target.log`). Mutations (isolation,
env-var rebuild each, restored to the exact pre-mutation text):
**p1a-6-M1** contrastRatio → constant 4.53: KILLED at exactly the probe's
exact-ratio pin, 1 failed / 7 passed (`web-3820-p1a6-mutM1.log`).
**p1a-6-M2** the demo svg's `onKeyDown` removed: KILLED at exactly the
ArrowRight `data-focus-index` pin, 1 failed / 7 passed
(`web-3820-p1a6-mutM2.log`). Typecheck / lint / lint:css clean. FULL p1a
suite on the CI-mirror build (`NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run
build`): **1608 passed, 0 skipped, 0 failed (31.1s)**
(`web-3820-p1a6-final-full.log`) — the p1a-5 baseline 1599 + the
formerly-skipped shell walk now running + exactly the 8 new p1a-6 pins.
**The standing skip is intact**: a no-var build was also run — all 9
styleguide tests SKIP (never fail) on the 404
(`web-3820-p1a6-novar.log`), so local runs without the var keep the
p1a-5-era behavior (skips, with counts 1599+9-skipped shape) and CI's
env-var expectation is unchanged.

## Phase 1 Track B Codex fix wave 3 (p1b-11)

Codex round 3 returned two findings; the detectable defects are fixed here,
test-first, and finding A's undetectable half is RECORDED as a structural
limitation, in one commit (`fix(web): p1b-11 codex round 3 - negative zero
and zero-row cells are refused, the JSON-parse information boundary is
recorded`).

### Finding A (HIGH, PARTIAL by design) — the guards judge the parsed double

`web/lib/wireGuard.ts:91` (pre-fix): `isWirePopulation`/`isWireSignedCount`
examine the parsed binary64, never the JSON token. Two sub-cases, split by
whether the parse leaves evidence.

**A1 (detectable, FIXED)**: `"movers_total": -1e-324` parses to NEGATIVE
ZERO — which is `=== 0` and passed `>= 0` — so a fractional token wore a
legal population and moversDisclosure rendered "No account…" as a
computed-looking claim. Both count guards now refuse
`Object.is(value, -0)`: a conforming integer marshal never emits a token
that parses to -0 (Go's encoding/json prints an int64 zero as `0`), so a
post-parse -0 is the surviving fingerprint of an out-of-contract token.
`0` stays legal on both guards — the refusal is the sign bit, not the
magnitude.

**A2 (undetectable, RECORDED not fixed)**: `9007199254740991.1` rounds to
`9007199254740991` DURING JSON.parse — post-parse the double is
indistinguishable from the integer token, and no client-side predicate can
close this without raw-text response validation (a re-parse architecture).
Recorded twice: the documented-limitation block on the two guards
(wireGuard.ts) and item 5 of the p1b-7 seal's out-of-scope inventory
(above) — Phase-3+ architectural candidate, or server-side contract
testing.

**Pins**: unit — wire-guard.spec.ts ×1 red-first (`JSON.parse("-1e-324")`
IS -0 and is refused by both guards; 0 stays legal on both) +
engine-classification.spec.ts ×1 red-first (`movers_total = -0` and a
bucket `count = -0` named per path). RED witnessed: both pins failed by
assertion pre-fix (the classifier returned `[]`; the guards admitted -0).

**Kill (p1b-11-M1)**: the `Object.is` check removed from BOTH guards → the
two -0 pins die in isolation (2 failed / 38 passed; the occupancy pins
survive, so the mutant is discriminated from M2); restored, diff-verified
byte-identical.

### Finding B (MEDIUM) — a zero-row occupied cell is refused by name

`web/app/lab/engineClassification.ts:192` (pre-fix): `cells[].rows` rode
the zero-admitting population guard while `RunBookTransitionCell.rows` is
the schema's `minimum: 1` (api/openapi.yaml:4546 — "A cell is emitted only
when it holds at least one row"; "An empty cell is ABSENT, never a row of
zeros"). A fake `{"to":1,"rows":0,...}` cell passed classification AND
`readTransitions`' whole contradiction register — 0 changes no margin or
census sum, so every reconciliation still balanced — and rendered as an
occupied 0 cell in the transition table (LabRunBookTransition.tsx:330; the
red run's page snapshot witnessed the healthy settle).

**Fix**: `isWireOccupancy` joins wireGuard.ts (`isWirePopulation && >= 1`)
— the population guard's floored sibling, with the assignment-table entry
— and `cells[].rows` takes it, named per index
(`hf_transitions.outflows[i].cells[j].rows`) like the rest.

**setRunClassification.ts checked (per brief)**: `SetRunEngineSummary`
carries NO transitions subtree (schema read: engine, usd_decimals, the
counts, the Decimals, market_realization, projection, note — nothing
cell-shaped), so `rows` is not consumed there and no change is owed.

**THE MINIMUM SWEEP (recorded, yield = 1)**: api/openapi.yaml's
`components:` section (line 2212 on) holds exactly ONE `minimum:` — line
4546, `RunBookTransitionCell.rows`. Every other `minimum: 1` in the file
is a request parameter (page sizes, path ids, strides), and no
`exclusiveMinimum` exists anywhere in the contract. So no other
schema-minimum response field is guarded as a population by any
classifier; nothing else owed the floor treatment.

**Pins**: unit — wire-guard.spec.ts ×1 (the occupancy law: floored at
exactly 1; 0 and -0 refused; everything the population guard refuses stays
refused; red witnessed as the missing-export load failure) +
engine-classification.spec.ts ×1 red-first (rows: 0 named
`hf_transitions.outflows[3].cells[0].rows` per index; rows: 1 stays
legal — the floor is the schema's, not a wider refusal). e2e —
p1b-fixes.spec.ts "p1b-11 fB" red-first: structuredClone of the committed
run-book 200 body with a fabricated `{to: 1, rows: 0}` cell APPENDED to
the measured outflow (margins reconcile by construction) → RED witnessed
the exact defect (the aave cell settled HEALTHY, the fake cell admitted);
GREEN: the engine panel's malformed register names
`hf_transitions.outflows[3].cells[1].rows`, the fabricated cell never
renders as a transition-table row, the route stays live, the healthy dm
engine renders untouched.

**Kill (p1b-11-M2)**: `isWireOccupancy` loses its `>= 1` floor (weakened
to the bare population guard) → the two occupancy pins die in isolation
(2 failed / 38 passed; the -0 pins survive); restored, diff-verified
byte-identical.

### Closing counts (p1b-11)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean, zero warnings (exit 0)
- `npm run lint:css` — clean (exit 0)
- touched unit specs (wire-guard, engine-classification,
  set-run-classification) — **51 passed**
- `npm run build` — clean (fresh, post-restore)
- e2e lab + p1b-fixes — **48 passed**
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1604 passed, 9 skipped, 0 failed (35.5s)**
  (`web-3819-p1b11-full.log`) — the p1a-6 no-var baseline (1599 passed +
  9 skipped: the 8 styleguide pins + the shell styleguide walk, which
  skip without `NEXT_PUBLIC_SHOW_STYLEGUIDE` by p1a-6's recorded design)
  plus exactly the 5 new p1b-11 pins (2 wire-guard +
  2 engine-classification + 1 e2e).
- Mutations: **2 mutants, 2 KILLED, 0 survived**, both unit-in-isolation
  and mutually discriminating (M1 kills only the -0 pins, M2 only the
  occupancy pins), every restoration diff-verified against the
  pre-mutation bytes.

## Phase 1 Track B Codex fix wave 4 (p1b-12)

Codex round 4 held the p1b-11 fixes and returned ONE finding — the same
negative-zero class, one guard over — fixed here test-first with a
full audit of every local integer gate outside wireGuard, in one commit
(`fix(web): p1b-12 codex round 4 - negative zero is refused at every wire
integer gate`).

### Finding (HIGH) — isWireScale admits -0

`web/lib/wireGuard.ts:39` (pre-fix): `isWireScale` judged
`Number.isInteger(value) && value >= 0 && value <= 1000` — all three true
of -0 — so `JSON.parse("-1e-324")` on `usd_decimals` / `price_decimals` /
market-realization scales / collateral decimals passed the guard, and
downstream `assertScale` (packages/client-ts decimal.ts:311) accepts -0
too (`Number.isInteger(-0)` true, `-0 < 0` false): base-unit strings
rendered at ZERO decimal places — plausible, severely mis-scaled prices.
Post-parse distinguishable (the sign bit is the fingerprint), same
`Object.is` refusal as the p1b-11 count guards.

**Fix**: `isWireScale` refuses `Object.is(value, -0)`; ordinary `0` stays
legal. The guard's doc comment records the deliberate asymmetry against
`assertScale` (which admits -0), and the NEGATIVE ZERO block now records
that -0 coverage spans ALL wire integer guards in the module — scale,
population, occupancy (through population), signed count — plus the
audited local gates outside it.

### THE -0 AUDIT (per brief, recorded even where no change is owed)

Universe: every `Number.isInteger` / `Number.isSafeInteger` use in web/
outside wireGuard.ts and outside specs/fixtures (grep swept all of web/;
hits landed only in lib/, app/, and test-side files).

| Site | Gate (pre-fix) | Verdict | Action |
|------|----------------|---------|--------|
| `web/lib/wireGuard.ts:39` `isWireScale` | `isInteger && >= 0 && <= 1000` | -0 ADMITTED; wire scales feed the money renderers and `assertScale` admits -0 → zero-decimal base-unit prices | **FIXED** (the finding) |
| `web/lib/runbookSet.ts:108` `positiveInt` | `isInteger && >= 0` | -0 ADMITTED into the busy refusal-envelope gauges — `maxInFlight`/`inFlight` render in the busy sentence (LabTornado.tsx:1072, tornadoLines.ts:368) | **FIXED**: `Object.is` refusal → null → the same 0 fallback as every unreadable gauge |
| `web/lib/factor.ts:34` `toBig` | `isSafeInteger` | -0 ADMITTED **and LAUNDERED**: `BigInt(-0)` is `0n` — a fractional shock token would render as the exact ratio `0/den`, a computed-looking −100% | **FIXED**: throwing refusal (the module's own register), message names `-0` explicitly since `String(-0)` is `"0"` |
| `web/app/book/riskBins.ts:142` `usdExponentLabel` | `isInteger(exponent)` | NOT a wire gate: exponent is locally computed bin geometry (`xIndex / 2`; xIndex is `2*decade+half` integer arithmetic, which cannot produce -0), and even a smuggled -0 renders the identical `$1` label (`10 ** -0 === 1`, `arr[-0]` ≡ `arr[0]`) | NO CHANGE (recorded) |
| `web/lib/runbookSet.ts:102` + `web/lib/runbook.ts:92` `retryAfter` (adjacent, OUTSIDE the audited class) | `typeof === "number"` — no integer gate at all | the body-arm `retry_after_seconds` admits ANY number (2.5, -5, -0) — a pre-existing, WIDER posture than the -0 bypass class; a -0 renders "0" via `String()`, identical glyphs to a legal 0 | RECORDED, no change owed under this finding class (future-round candidate) |
| `tests/fixtures/clock-law.mjs:204`, `tests/fixtures/generate-lab-book.mjs:3246`, `tests/unit/frontier-scale.spec.ts:72` | test-side | excluded by the brief's own scope (specs/fixtures; nothing rendered) | NO CHANGE |

**Pins (4, all red-first witnessed)**: unit — wire-guard.spec.ts ×1
(`JSON.parse("-1e-324")` IS -0 and is refused by isWireScale; 0 stays
legal; RED: the guard admitted it) + set-run-outcome.spec.ts ×1 (busy
gauges parsing to -0 refuse into the 0 fallback, `.toBe` is Object.is so
the pin sees the sign bit; RED: `Received: -0`; ordinary-0 gauges stay
legal) + factor.spec.ts ×1 (`formatFactor(-0, 100)` and
`formatFactor(100, -0)` throw the exact-integer refusal; a zero NUMERATOR
0/100 → −100% stays legal; RED: no throw / the wrong `positive` message).
e2e — p1b-fixes.spec.ts "p1b-12" ×1 red-first: the committed run-book 200
body with engines[0] `"usd_decimals":-1e-324` SPLICED AS RAW TEXT — the
JS literal `-1e-324` already evaluates to -0 and `JSON.stringify(-0)`
normalizes to `0`, so the fixture is cloned with a unique sentinel scale,
serialized, and the sentinel replaced in the raw body string (uniqueness
asserted in the pin); the mock fulfills with the raw body. RED witnessed
the exact defect (the aave cell settled `data-cell-state="result"` with NO
malformed outcome — the -0 scale admitted); GREEN: the cell settles
malformed, the engine panel's malformed register names `usd_decimals`,
the route stays live, the healthy dm engine renders untouched.

**Kill (p1b-12-M1)**: the `Object.is` check removed from `isWireScale`
alone → wire-guard.spec.ts in isolation dies at exactly the p1b-12 -0
pin (1 failed / 12 passed; the p1b-11 -0 count pins and occupancy pins
survive, discriminating M1 from p1b-11's mutants); restored,
`fc /b`-verified byte-identical against the pre-mutation copy.

### Closing counts (p1b-12)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean, zero warnings (exit 0)
- `npm run lint:css` — clean (exit 0)
- touched unit specs (wire-guard, set-run-outcome, factor) —
  **64 passed** (61 pre-existing + the 3 new pins)
- `npm run build` — clean (fresh, post-restore)
- e2e lab + p1b-fixes — **49 passed** (p1b-11's 48 + the 1 new pin)
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1608 passed, 9 skipped, 0 failed (38.9s)**
  (`web-3819-p1b12-full.log`) — the p1b-11 count (1604 + 9 skipped: the
  p1a-6 styleguide no-var shape) plus exactly the 4 new p1b-12 pins
  (1 wire-guard + 1 set-run-outcome + 1 factor + 1 e2e).
- Mutations: **1 mutant, 1 KILLED, 0 survived**, unit-in-isolation,
  discriminated from the p1b-11 mutants, restoration byte-verified.

## p1a-7 — Track C convergence pass: the four un-audited surfaces hold under the new foundation

**Scope**: verify History (/observatory), Activity (/feed), Proof (/proof),
Developers (/developers) under the Task 1-6 foundation (--t-* tokens with
floor-lifted --fs-* aliases, shell 1280 + stepped breakpoints, the canon
appbar, amended palette). NO IA changes; fix only breakage. Result:
**ZERO fixes owed, ZERO pin updates** — all four surfaces hold as-is, so
this commit carries only this ledger entry.

### Per-surface verdicts

- **History (/observatory) — HOLDS.** Engine switcher, summary cards,
  four-chart grid, legend, bucket record, stampline all render on tokens
  in both themes at 1366/1440/1920/2560; charts widen with the shell
  without label loss; no sub-12px text, no overflow.
- **Activity (/feed) — HOLDS.** Posture strip, engine/view/type chip
  rows, liquidation detail card, untimed-tail divider, load-more strip
  all legible at the lifted sizes; the since_block note reflows beside
  the TYPE chips at >=1920 per the stepped breakpoints; no overflow.
- **Proof (/proof) — HOLDS.** Two-subject split, weld table, TWO
  SUBJECTS banner, probe records, evidence pins clean in both themes;
  the materialization key wraps honestly at 1366/1440 and single-lines
  at 1920/2560, copy affordance intact.
- **Developers (/developers) — HOLDS.** Endpoint chip index reflows
  (3 rows at 1366 → 2 at 2560), TypeScript block, per-operation cards,
  curl samples, error envelope, Proof Center cross-link all clean in
  both themes (~14,500px-tall page, inspected via sectional crops).

### Method (evidence)

- The four suites first, against the fresh no-var build:
  `npx playwright test -c tests/playwright.p1a.config.ts` over
  observatory/feed/proof/developers specs — **59 passed / 0 failed**,
  UNMODIFIED (none of the four files carries a geometry pin, so the
  shell-width carve-out was never needed).
- Screenshot matrix: 4 surfaces x 1366/1440/1920/2560 x light/dark =
  **32 renders** captured to the workspace convergence/ dir via a
  throwaway spec (same fixture mocks the suites use; /v1/stream and
  /v1/meta aborted — the appbar's disclosed-fallback arm, the same state
  every appbar pin exercises). The spec was deleted after capture;
  screenshots stay untracked workspace artifacts.
- Programmatic audit on every render, same pass: elements bearing direct
  text with computed font-size < 12px — **ZERO in all 32** (the token
  lift reaches everything; no inline-style remnants); horizontal
  overflow outside overflow-x containers — **ZERO**; page scrollWidth
  overflow — **ZERO** (audit.json beside the screenshots).
- Every render inspected by eye (developers via top/mid/bottom crops).
  One observation recorded as NOT-foundation, no action: the observatory
  y-max direct label sits at the max point and the series line passes
  under its trailing glyphs — present at every width in both themes,
  a pre-Track-A W-OBS drawing trait (the label stays legible; moving it
  is chart redesign, outside "fix only breakage").

### CI-lane findings (the Task 6 handoff, recorded for Task 8)

- The lane last ran 2026-08-08 at origin/main f36b4d4 — the ~30 Track
  A/B commits since (dc01409 on) are LOCAL-ONLY; CI has never seen them.
- **web job**: fails at its FIRST step (typecheck) — a single TS2322 at
  tests/unit/lab-runbook-lines.spec.ts:858 (`symbol: null` against
  `symbol?: string`). Already repaired in unpushed c2b74e8 (p0-6a,
  "symbol omitted, unpriced arm unchanged"). At HEAD, typecheck / lint /
  lint:css all exit 0 locally and the CI-mirror suite below is green, so
  the web lane's known standing-failure set is EMPTY at HEAD (later CI
  steps never ran behind the typecheck fail-fast; the styleguide RSC
  breakage was already fixed structurally in p1a-6).
- **race job** (`go test -race`) and **go job** (`gofmt`): Go-side,
  untouched by any Track A/B commit, out of this track's scope —
  Task 8's close inherits them by name.

### Closing counts (p1a-7)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean (exit 0)
- `npm run lint:css` — clean (exit 0)
- Four-surface suites (no-var build): **59 passed, 0 failed, 0 skipped**
- FULL p1a suite, CI-mirror (`NEXT_PUBLIC_SHOW_STYLEGUIDE=1` build,
  port 3820): **1613 passed, 0 failed, 0 skipped (41.0s)** — the p1a-6
  1608 baseline plus exactly the 5 p1b-11 pins that landed since.

## Phase 1 Track A CLOSE (p1a-8) — seal

### Delivered scope (the wave's whole claim)

- **The closed type set + floor-lifted aliases (p1a-1)**: the 14-token
  `--t-*` set — nothing below 12px EXISTS — with every legacy `--fs-*`
  re-pointed by ROLE onto it (four sub-12px sizes floor-lifted to 12px);
  the full mapping ledger lives in §p1a-1 and in the tokens.css comment
  block.
- **The two-grade palette (p1a-1)**: `--ink-3` amended text-legal in all
  four theme blocks (demoted by law to captions/ornament); the light text
  grade split from the fill grade (`--accent/ok/warn/crit-text`, each
  ≥ 4.5:1, declared at fill values in dark so components reference
  `--*-text` unconditionally); `--warn-bg`; `--term-dim` amended in its
  one defining block.
- **The width contract / 1180 REPEALED (p1a-1)**: `--shell-max` 1280 base,
  stepped ON THE TOKENS at 1440 (breakout 1340) / 1920 (both 1520) /
  2560 (both 1680); `.breakout`/`.prose`/`.grid12` utilities; canon §02
  shell padding verbatim.
- **The structural floor (p1a-2)**: stylelint 17.14.1,
  `declaration-property-value-allowed-list` holding every `font-size` in
  app/ + components/ CSS to `/^var\(--(t|fs)-/`, `font` shorthand held to
  `inherit`; the 44-literal debt paid (one 9→12 floor lift, the sole
  visual change); `lint:css` wired into CI directly after lint (commit
  owner-ratified after the recorded gate event).
- **Freshness tiers + meta provider (p1a-3)**: `freshnessTier` — every
  bound a theorem about the pipeline's constants (2×poll / ceiling /
  sweep-worst-case; unknown age is NOT an input); `MetaConstantsProvider`
  — one `/v1/meta` ask, abort-guarded, no retry, every rejection
  (including `SchemaVersionMismatchError`) landing the DISCLOSED fallback;
  the p0-5 hand-picked-hour machinery retired.
- **The canon appbar + the retirement (p1a-4/4b)**: STREAM / SNAPSHOT+TIER
  / BATCH / COVERAGE each its own chip; the Data status popover carrying
  the raw watermark vector; `LIVE · WATERMARKED` RETIRED with liveness
  made UNREPRESENTABLE in the posture type; **the 61-pin migration**
  (45 header-vocabulary + snapshot-chip migrations, 5 @-payload retargets
  INTO the popover, 11 count-0 pins KEPT as permanent resurrection
  guards — the full tables live in §p1a-4); the coverage chip derived
  from the envelope and WITHHELD when unbindable (p1a-4b).
- **The component kit (p1a-5)**: pure `lib/kit.ts` models under thin
  components — VerdictBanner (identity-strip law enforced structurally),
  ExactValue (§7 affordance + forbidden arm), StatusChip/ChipVal/
  RefusedChip/EngineTag, the six §8 states. Additive: zero page-consumer
  changes.
- **The living styleguide (p1a-6)**: the /styleguide route rebuilt
  canon-structured (19 specimen sections), the §04 palette self-verified
  by a LIVE contrast lab (17 pairs measured, known-bad probe pinned to
  its per-theme failing ratios), the §11 interaction register's reference
  implementation; the standing-red CI env-var build fixed structurally
  (RSC boundary violation in the old page).
- **The convergence pass (p1a-7)**: History / Activity / Proof /
  Developers all HOLD under the new foundation — zero fixes, zero pin
  updates; 32-render matrix audited (zero sub-12px, zero overflow).

### Mutation transcript (Step 1)

`.superpowers/sdd/p1a-mutations/{mutations.json,transcript.md}` — the
reconciled record: **15 mutants, 15 KILLED, 0 survived** (p1a-1 ×2,
p1a-2 ×3 — one stylelint BUILD-GATE kill + two folded pin kills,
p1a-3 ×2, p1a-4 ×3 + the p1a-4b fix-round mutant, p1a-5 ×2, p1a-6 ×2;
p1a-0 and p1a-7 carried none). Every kill as-recorded-in-source (task
reports + this ledger's p1a sections + the `web-3820-p1a*-mut*.log`
artifacts); every search anchor re-verified against the sealed tree,
drifted kill-assertion lines re-anchored (`recorded :N → now :M`).

### Closing verification (p1a-8, final tree = `4a0f27c` + this seal)

- `npm run typecheck` — clean (exit 0)
- `npm run lint` — clean (exit 0)
- `npm run lint:css` — clean (exit 0)
- **FULL suite, CI-mirror shape** (`NEXT_PUBLIC_SHOW_STYLEGUIDE=1
  npm run build && npx playwright test -c tests/playwright.p1a.config.ts`,
  port 3820): **1617 passed, 0 failed, 0 skipped (40.0s)**
  (`web-3820-p1a8-full-var.log`)
- **FULL suite, no-var shape** (plain `npm run build`, same invocation):
  **1608 passed, 9 skipped, 0 failed (39.1s)**
  (`web-3820-p1a8-full-novar.log`) — the 9 skips are exactly the
  styleguide-not-compiled-in shape (the 8 p1a-6 pins + shell.spec's
  specimen walk), skip-never-fail as designed.
- **Count reconciliation (the drift caveat discharged)** — Track A
  baseline 1477/87 (p1a-0), interleaved with Track B on the shared
  tests/ tree:

  | seal | enumerated | delta |
  |---|---|---|
  | p1a-0 baseline | 1477 | — |
  | + p1b-4 (Track B) | 1495 | +18 |
  | p1a-1 | 1511 | +16 |
  | + p1b-5 | 1521 | +10 |
  | p1a-2 | 1523 | +2 |
  | + p1b-6/8/9/10 | 1566 | +43 |
  | p1a-3 | 1575 | +9 (+11 −2 retired) |
  | p1a-4 | 1582 | +7 |
  | p1a-4b | 1589 | +7 |
  | p1a-5 | 1600 | +11 |
  | p1a-6 | 1608 | +8 |
  | + p1b-11 | 1613 | +5 |
  | p1a-7 | 1613 | +0 (ledger-only) |
  | + p1b-12 | 1617 | +4 |
  | **p1a-8 close** | **1617** | +0 (transcript + seal only) |

### Debt inventory (declared, carried — nothing silently dropped)

**Structural debt (Phase 3 owns):**
- The `--fs-*` alias retirement: every alias resolves onto `--t-*` today
  (the floor holds through the alias); Phase 3 retires them PER-SURFACE
  and tightens the stylelint pattern to `--t-*` only. Includes the two
  deliberate value-preserving holds: `--fs-table` at `--t-meta` 13 (the
  §08 table pattern's sans-14 body is per-surface rebuild work) and
  `--fs-mono` at `--t-mono-floor` 12 (the canon terminal body's 12.5
  uplift is the `.term` restyle).
- The token-redefinition stylelint hole (p1a-2 minor): a module could
  declare `--t-tiny: 8px` locally; closure = a rule forbidding
  `--t-*`/`--fs-*` declarations outside tokens.css.
- `lint:css` globs are enumerated (`app/`, `components/`) — a new
  top-level CSS dir would escape; closure = structural glob + `.next`
  ignore (p1a-2 minor).
- The stylelint config comment overstates its anchor (head-bound, not
  whole-value tail); harmless — invalid CSS drops (p1a-2 minor).
- RefusedTag → kit RefusedChip across the 15 page consumers; the chart
  primitive library builds against the styleguide reference (declared
  scope-outs).
- Page-surface `LIVE · WATERMARKED` / `NO SERVABLE BATCH` / SERVING prose
  echoes (11 sites, §p1a-4 out-of-scope list) — KEPT deliberately; the
  Phase-3 clarity review owns the prose-vocabulary question.

**Cosmetic divergences (ruled, standing):**
- humanAge-vs-canon compact ages: production prints `SNAPSHOT 18h 12m ·
  CRITICAL` where canon specimens print `18h` — precision is house law
  (p0-5); ruled in §p1a-4, re-affirmed in §p1a-6.
- `COVERAGE 2/2 ENGINES` (§05 dimension 3's fuller form) vs canon §10's
  `COVERAGE 2/2`.

**Track B envelope gap (ledgered for the schema owner):**
- `refused_engines` is `string[]` with no structural binding to the
  watermark stamp vector — the coverage chip withholds itself when a
  refused name carries no stamp (p1a-4b pins the withhold); a
  schema-level binding would retire the null arm.

**Open rulings:**
- DegradationBanner overlap reconciliation (p1a-4 note): due when a
  future task touches the banner; neither Task 5 nor 7 did.
- r7:516's details-open assumption (the popover's DOM open state across
  re-renders) holds only while the popover is unkeyed.

**Deferred minors, carried by task (the workspace ledger's full
inventory; dispositions noted):**
- T1: breakout-base unpinned + no 1366 test → CLOSED by the p1a-2
  fold-in (pin kills A/B); `--ink-3` count pin → CLOSED (same).
- T3: `freshness.ts` R4 narrative names the retired
  `ribbonBatchAgeSuffix` without a tombstone marker at the site.
- T3→T4: the fallback title's false "unreachable" cause → CLOSED in
  p1a-4 (the disclosed-fallback wording landed and is pinned).
- T4: no anti-arm pin for the fallback disclosure (every appbar test
  aborts /v1/meta; a reachable-meta arm would pin the disclosure's
  ABSENCE). — T4: popover keyboard operability implemented but unpinned
  (all retargets click(); one Enter/Space pin closes the canon gate;
  Task 6 pinned the CHART register, not the popover). — T4: the
  unavailable branch's stale-for value lost the mono register
  (§6 embedded-values-mono law; cosmetic). — T4: `.sep` dividers absent
  before SUPERSEDED/Data-status (canon sketch has all segments). —
  T4: comment drift `meta.tsx:23` ("unreachable") and `AppHeader.tsx:39`
  ("integrity Ribbon slot").
- T5: `identityMissing` inspects unrendered ReactNode (empty-fragment
  evasion possible) → mitigated by the p1a-6 DOM pin (`data-slot=
  "identity"` non-empty on all five specimens); the model-level gap
  stands. — T5: refusal renders stamp the caller's `data-variant` →
  CLOSED (Task 6 evaluated, AGREED, pinned). — T5: clipboard
  writeText-absent edge (no real-browser exercise); Enter-only
  activation (canon-verbatim; Space/click worth a Phase-3 look). —
  T5: the kit ledger framing omits `.cUnknown`'s hollow dot as a third
  divergence (canon-mandated).
- T6: contrast composite base is body bg, not nearest-opaque-ancestor
  (inert today — all grounds opaque). — T6: the ≥4.5 loop asserts a 2dp
  string (~0.005 tolerance); a raw-ratio attribute would close it. —
  T6 (Phase-3 advisory): the interaction readout is not `aria-live`;
  SRs are routed to the ledger twin per canon — production copy may want
  a polite live region. — T6: TierChip takes a declared tier prop rather
  than deriving through `freshnessTier` (specimens map correctly; the
  deriver is pinned elsewhere). — T6: `SPECIMEN_ROWS` dead `marks`
  field; `contrast.ts` uses the 0.04045 sRGB linearization constant vs
  WCAG's 0.03928 (negligible; agrees at 2dp).
- T7: the capture/audit spec was deleted after the 32-render matrix —
  future convergence passes should leave the throwaway spec beside
  `audit.json`.

**Forward law (binds Phase 2/3 surfaces, not Track A code):**
engine-separation, the number law, and the chart-form obligations of the
ratified canon attach to the surfaces Phase 2/3 build; recorded here so
the next planner inherits them as law, not as taste.

### CI inheritance (by name, from the p1a-7 record)

- **web job**: known standing-failure set EMPTY at HEAD — the lane's
  last recorded failure (TS2322 at `lab-runbook-lines.spec.ts:858`,
  seen at origin/main `f36b4d4`) was repaired in unpushed `c2b74e8`
  (p0-6a); typecheck / lint / lint:css exit 0 and the CI-mirror suite
  is green at this seal. CI itself has still never run the Track A/B
  commits (all local-only).
- **race job** (`go test -race`) and **go job** (`gofmt`): pre-existing
  Go-side failures, untouched by any Track A/B commit, inherited by
  name — owed to whichever track next touches the Go tree, not to this
  web wave.

### What runs next

The controller dispatches the Codex adversarial round (context: the canon
as the contract, the appbar migration as the attack surface — vocabulary
consistency, tier arithmetic, pin-migration fidelity, contrast claims);
findings return as a fix wave under the standing gate rules (bypasses
FORBIDDEN — a blocked gate means BLOCKED).

## Phase 1 Track B Codex fix wave 5 (p1b-13)

Codex round 5 returned TWO findings — the -0 class's LAST scale gate
(inside the client package) and a fabricated-zero substitution the p1b-12
fix itself left behind — both fixed test-first in one commit
(`fix(web): p1b-13 codex round 5 - assertScale refuses negative zero at
the contract gate, busy gauges never fabricate capacity`).

### Finding 1 (HIGH) — assertScale admits -0 (client-ts, controller-authorized exception)

`packages/client-ts/src/decimal.ts:311` (pre-fix): `assertScale` judged
`Number.isInteger(decimals) && decimals >= 0 && decimals <= 1000` — all
true of -0 — so the UNCLASSIFIED surfaces (/v1/book bad-debt/stat rows,
Observatory series: any path feeding wire `usd_decimals` straight into
`formatUnits` with no `isWireScale` classifier in front) rendered
`formatUnits("239603961", -0)` as `"239603961"`: base units at ZERO
decimal places, a plausible, severely mis-scaled dollar figure
($239,603,961 where the honest figure is $239.603961).

**CONTROLLER AUTHORIZATION (recorded)**: tightening `assertScale` is a
sanctioned NARROW EXCEPTION to the no-client-ts-behavioral-changes rule,
because it is contract-ENFORCING, not contract-changing: the openapi
scale is an integer >= 0, no conforming JSON integer token parses to -0
(Go's encoding/json never emits -0 for an int), and the refusal matches
`parseDecimal`'s standing strictness philosophy — anything the contract
would not have produced throws rather than becoming a silently different
number.

**Fix**: `assertScale` throws its existing `DecimalFormatError` on
`Object.is(value, -0)`, BEFORE the generic bounds check; the message
names `-0` explicitly (`String(-0)` is `"0"` and would hide the sign);
the rationale lives in the site comment. Every scale parameter is
covered at once: `formatUnits`, `parseUnits`, `rescale` (both ends).
The p1b-12 wireGuard doc's "asymmetry against assertScale" note would
have become a present-tense falsehood — reworded (comment-only, in this
commit) to record the asymmetry as history: both gates now refuse -0.

### Finding 2 (MEDIUM) — busy gauges fabricated `0` for malformed envelopes

`web/lib/runbookSet.ts:149` (pre-fix): p1b-12 taught `positiveInt` to
refuse -0 to null, but BOTH call sites substituted `?? 0` — so a
malformed busy envelope rendered `max_in_flight 0 · in_flight 0`:
fabricated zeros wearing a measured costume, a capacity claim production
never makes (a busy refusal implies max > 0).

**Fix**: the busy arm's gauges are `number | null` and the null CARRIES
(`maxInFlight: positiveInt(...)`, no fallback). Consumers (the only
two, per grep + `find_referencing_symbols`): `setRunFailureReason`'s
busy sentence (tornadoLines.ts) states capacity UNKNOWN — "the refusal's
capacity gauges were unreadable — no count is claimed, and unreadable is
never zero" — when EITHER gauge is null, and keeps the exact numeric
sentence otherwise; LabTornado.tsx's busy state renders each null gauge
as `unreadable` in place of the number. A wire-served literal `0` stays
legal and renders as 0 — the wire's own claim is kept.

### Pins (red-first, all witnessed)

- **client-ts unit (decimal.test.ts, +5)**: `JSON.parse("-1e-324")` IS
  -0 (the defect input pinned); formatUnits refuses a -0 scale
  (`DecimalFormatError`); parseUnits + rescale (both parameters) refuse;
  the refusal NAMES -0; ordinary 0 stays legal on all three helpers.
  RED: 3 of 5 failed (no throw anywhere).
- **web unit (set-run-outcome.spec.ts, p1b-12 pin REWRITTEN to the
  p1b-13 law)**: raw `-1e-324` gauges → busy outcome with NULL gauges
  (`toBeNull`), the busy sentence contains "no count is claimed" and no
  "0 of 0"-shaped claim (`at most 0 set-run` / `0 are running` pinned
  out); ABSENT gauges are the same null; wire-served 0 gauges stay 0
  (`.toBe` is Object.is). RED: `Received: 0` — the fabricated zero.
- **web unit (tornado-lines.spec.ts, +1)**: null-gauge busy sentence
  speaks the unknown register — no numeric capacity claim of ANY size
  (`at most \d` pinned out, `\b0\b` pinned out), and the busy arm's
  standing vocabulary constraints (no "rate", no "no servable batch")
  hold in this register too. RED: sentence claimed "at most 0".
- **web e2e (p1b-fixes.spec.ts "p1b-13", +1)**: the committed /v1/book
  fixture with the debt_manager bad-debt row's `"usd_decimals":-1e-324`
  SPLICED AS RAW TEXT (sentinel-uniqueness asserted; same honest -0
  payload production as p1b-12's block). GREEN law: the p1b-0 route
  boundary catches the DecimalFormatError — `route-refusal` visible,
  "refused to render", banner mounted, and the mis-scaled figure
  `239,603,961` has count 0. RED witnessed the exact defect: NO refusal
  and the mis-scaled $239,603,961 rendered 6 times on the page.

### Kills (2 mutants, 2 KILLED, 0 survived, unit-in-isolation)

- **p1b-13-M1**: the `Object.is` arm removed from `assertScale` →
  client-ts decimal.test.ts in isolation dies at exactly the 3 p1b-13
  -0 pins (3 failed / 27 passed); restored, `cmp`-verified
  byte-identical, 30/30 green.
- **p1b-13-M2**: the null arm reverted to `?? 0` at both call sites →
  set-run-outcome.spec.ts in isolation dies at exactly the p1b-13
  no-zero-claim pin (1 failed / 36 passed); restored, `cmp`-verified
  byte-identical, 37/37 green.

### Closing counts (p1b-13)

- client-ts `npm run verify` (typecheck + vitest + build) — clean:
  **355 passed** (350 + the 5 new pins); dist rebuilt with the fix
  (web's ensure-client prebuild path rebuilds it on every web build too)
- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean
  (exit 0)
- touched web unit specs (set-run-outcome + tornado-lines) —
  **100 passed** (99 pre-existing incl. the rewritten pin + 1 new)
- `npm run build` — clean (fresh, post-restore)
- e2e book + lab + p1b-fixes — **75 passed** (74 + the 1 new pin)
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1610 passed, 9 skipped, 0 failed (35.6s)**
  (`web-3819-p1b13-full.log`) — the p1b-12 count (1608 + 9 skipped, the
  p1a-6 styleguide no-var shape) plus exactly the 2 new playwright pins
  (1 tornado-lines unit + 1 e2e; the set-run-outcome change is a
  REWRITE of the p1b-12 pin, not an addition; the 5 client-ts pins live
  in vitest, outside this suite's count).

### Standing notes

- The A2 information boundary (p1b-11) still stands: -0 is the ONLY
  fractional-rounding fingerprint a post-parse guard can see; closure
  still requires raw-text response validation or server-side contract
  testing (Phase-3+ candidate).
- The `retryAfter` twins (runbookSet.ts, runbook.ts) remain the
  recorded future-round candidate (any-number posture, p1b-12 table).
- The client-ts exception is NARROW and closed: `assertScale` only.
  No other client-ts behavior changed; the package's other 350 pins
  passed untouched.

## Phase 1 Track B Codex fix wave 6 (p1b-14)

One commit
(`fix(web): p1b-14 codex round 6 - the negative-zero class dies at every
unclassified integer render`).

Codex round 6 found the -0 class again — the book histogram's bucket
counts — and the mandate was the CLASS, not the instance: every wire
integer consumed by an UNCLASSIFIED surface (book, observatory, feed,
inspector, proof) through `String()` / `toLocaleString` / arithmetic
with no wire guard in front.

### The named instance (HIGH) — BookHistogram bucket counts

`web/app/book/BookHistogram.tsx:249` (pre-fix): a `/v1/book` bucket
count token `-1e-324` parses to -0; `bucket.count > 0` is false so the
bucket drew nothing, `String(bucket.count)` rendered "0" — a served
account HIDDEN as a measured zero (the RED e2e snapshot shows the
"1.05 – 1.10  0" row over a wire count of 1) — and the -0 joined the
reduce that builds the denominator every share is computed against.

Fix (panel-scoped): `malformedHistogramCounts` (readingLines.ts) — the
decision layer EnginePanel consults BEFORE any count read: every
consumed count (`buckets[i].count` per index, `infinite_count`,
`refused_count`) answers to `isWirePopulation`, in the panel's read
order, composed through `malformedFields`. A non-empty result renders
the panel's own refusal composition (head + `hist-malformed-{engine}`
register naming the fields, the LabBookPanel malformed voice); the
OTHER engine's panel and the route stay live.

### The class kill — two consumption reads + one word register

- `wireGuard.ts` gains THE THROWING READS: `readWirePopulation` /
  `readWireScale` (+ `WireIntegerError`) — the population/scale twins
  of `parseDecimal`/`assertScale` for classifier-less sites: legal
  values pass untouched, anything else throws (naming the field, and
  naming `-0` explicitly since `String(-0)` is "0"), landing in the
  p1b-0 route boundary — the arm p1b-13 already blessed as "the honest
  arm on a surface with no classifier".
- `format.ts` `formatBlock` — the one chokepoint every wire block
  height renders through — now refuses out-of-contract input with the
  WORD register (`unreadable`, the p1b-13 LabTornado vocabulary),
  never a throw: it renders inside the layout-level PostureRibbon,
  ABOVE the route boundary, where a throw would unmount the shell.
  RED witnessed: `formatBlock(JSON.parse("-1e-324"))` returned `"-0"`
  (`web-3819-p1b14-red-formatblock.log`).
- Layout-level / live-instrument surfaces (PostureRibbon, Ribbon batch
  chip, FeedLiveStrip, freshness stamp lines) classify with
  `isWirePopulation` directly and render the word register — scoped,
  no shell risk, no route nuke over one malformed SSE frame.

### THE AUDIT TABLE (class-closure evidence for round 7)

Universe: every `number`-typed field in the generated schema
(`packages/client-ts/src/generated/schema.ts`) of a response type
consumed by an unclassified surface; consumers enumerated by grep over
`app/book app/observatory app/feed app/inspector app/proof lib`
(components included). Verdicts: (a) already guarded, (b) was
render-reachable unguarded, FIXED this wave, (c) unreachable /
derived-locally / out of scope, recorded.

| Field(s) | Consumer site(s) | Verdict | Action |
|---|---|---|---|
| EngineHistogram `buckets[].count`, `infinite_count`, `refused_count` | BookHistogram.tsx (bars, presence dots, row labels, denominator reduce, accounting rows), readingLines `belowOneCount` | (b) | **FIXED** — `malformedHistogramCounts` panel classifier (the named instance) |
| Aggregate `positions`, `computed_positions`, `refused_positions`, `flagged_positions`, `liquidatable_positions` | BookStatRows (denominator, cards, split-collapse branch), readingLines (`engineStatsAnswer`/`SplitLine`/`liquidatableCardSub`/`histogramReadingLine`), bookDek `engineCounts`, BookPositions (on-book count, hidden subtraction, footer, liq disclosure) | (b) | **FIXED** — `readWirePopulation` at every read (route arm) |
| Count `count` (refusal tallies) | BookStatRows `refusalBreakdown` | (b) | **FIXED** — `readWirePopulation` |
| BadDebt `insolvent_positions`, `eligible_positions` (nullable) | BookBadDebt `countCell`; readingLines `eligibleDebtFragment` dust gate | (b) | **FIXED** — null carries; non-null reads guarded |
| BadDebt/WaterfallEngine/Shortfall `usd_decimals`, Aggregate/Position/PositionSummary/AddressHistoryEngine `value_decimals`, FactorPrice `price_decimals`, Leg/PriceInput/SeizedCollateral/PriceSeries `decimals`, ChainEvent `amount_decimals`, LiquidationDetail `debt_decimals` | every money render (`formatUnits`/`renderNullableDecimal`/`renderEngineAmount`/`money`/`usd`) | (a) | `assertScale` refuses -0/negative/fractional/out-of-range since p1b-13; throw lands in the route arm (p1b-13 e2e pins this) |
| `value_decimals` printed as its own caption | InspectorPositionCard "N-dec" line; evidence.ts "value decimals" row | (b) | **FIXED** — `readWireScale` |
| WaterfallEngine `newly_eligible_accounts`, `cumulative_eligible_accounts` | stressIncrements latch weld (arithmetic BEFORE any guard; malformed counts either fed a rendered step or tripped the LATCH CONTRADICTION register — the wrong claim) | (b) | **FIXED** — count-contract check before the weld, refusing into the module's own `refused` arm (COUNT CONTRADICTION voice) |
| WaterfallEngine `cumulative_eligible_accounts`, `insolvent_if_liquidated_accounts` | waterfallView (answer sentence, step labels, all-dust `> 0` gates) | (b) | **FIXED** — `accountCount` helper + guarded gates |
| Monotonicity `index` | BookWaterfall violation strip | (b) | **FIXED** — `readWirePopulation` |
| WaterfallPoint `index` | waterfallView/stressIncrements ordering arithmetic | ~~(c)~~ (b) | ~~ordering violations already refuse via the GRID CONTRADICTION arm; the index never renders outside that refusal's own text — recorded~~ **was recorded needing no guard — INCORRECT; fixed p1b-15** (Codex round 7): `point.index === 0` is true of -0, so a `-1e-324` token wore the legitimate UNSHOCKED rung in every builder, and the weld's ordering (`1 <= -0` is false) read a -0,1 sequence as strictly rising — guarded reads in waterfallView (route arm) + index contract in the grid weld (the module's own refused arm, GRID CONTRADICTION voice) |
| HeldFlat `chain_id`, ChainEvent `chain_id` | BookWaterfall held-flat table; FeedList/InspectorActivity TxLink title | (b) | **FIXED** — `readWirePopulation` |
| BookCoverage `excluded_by_this_layer` | BookSurface coverage stamp | (b) | **FIXED** — `readWirePopulation` |
| BookCoverage `batch_positions`, `in_book`, `refused_in_batch` | no web consumer (grep: none) | (c) | recorded — unconsumed |
| PositionsResponse `total_positions` | BookConcentration (walk-closure compare + takeaway), BookRiskMap walk progress, BookPositions footer/hidden | (b) | **FIXED** — guarded reads |
| PositionsResponse/EventsResponse/AddressHistoryResponse `limit` | FeedSurface filter echo; InspectorHistory (definitive-window sentence + card prop) | (b) | **FIXED** — `readWirePopulation` |
| Batch `id` | bookDek, BookConcentration/BookRiskMap captions, BookPositions footer, inspector-lines `lookupTakeaway`, InspectorSurface found-negative, InspectorHistory weld seam, freshness stamp lines, Ribbon batch chip, FeedLiveStrip | (b) | **FIXED** — `readWirePopulation` below the boundary; word register (`#unreadable`) on layout/live chrome |
| Batch `age_seconds` | freshness `batchFreshnessStamp` fallback (`humanAge` floors negatives — -0 rendered "0s ago", fabricated maximal freshness); PostureRibbon anchor input | (b) | **FIXED** — guarded fallback renders "age unreadable"; the ribbon pre-classifies and renders the `unreadable` snapshot chip (not the unknown-since-resume register — no resume happened) |
| Batch `position_count`, `refused_count` | FeedLiveStrip (the mandate's named envelope counts) | (b) | **FIXED** — word register (live instrument; the durable list below must not die with a frame) |
| Batch `flagged_count` | no web render (grep: none) | (c) | recorded — unconsumed |
| Stamp `last_block` | BookSurface marks, PostureRibbon/FeedLiveStrip watermarks, InspectorSurface, evidence | (b) | **FIXED** — `formatBlock` word register (one chokepoint) |
| Stamp `chain_id` | evidence watermark row | (b) | **FIXED** — `readWirePopulation` |
| Stamp / ObservatorySeriesPoint `acked_epoch`, `max_epoch_at_compute` | InspectorPositionCard `unackedEpochs` subtraction; ObservatoryPointDetail reorg row; evidence `reorgPostureRow` | (b) | **FIXED** — both legs guarded before the subtraction at all three sites |
| SweepStamp `rows`, `failed`, `generation` | ObservatoryPointDetail sweep row; PostureRibbon sweep chip; BookSurface `marksSummary` glyph branch | (b) | ~~**FIXED** — guarded reads (word register on the ribbon age); BookSurface line 331's tone branch is transitively covered (same render as marksSummary)~~ **was recorded guarded — INCORRECT for the ribbon sweep chip's TONE; fixed p1b-15** (Codex round 7): only the AGE was guarded — the tone read `stamp.sweep.failed > 0` raw, and `-0 > 0` is false, so a malformed tally wore the dim non-degraded arm — `ribbonSweepReading` (lib/stream-posture.ts) now derives value+tone in one guarded read (word register `failed unreadable`, warn tone). The ObservatoryPointDetail and BookSurface reads were and remain guarded (readWirePopulation) |
| SweepStamp `age_seconds` (nullable) | PostureRibbon sweep chip | (b) | **FIXED** — word register |
| AsOf/PositionSummary `balances_block`, `params_block`, `sweep_block`; Leg `debt_index_block`, `collateral_index_block`; PriceInput `block_number`; ParamChange `effective_block`; ChainEvent `block_number`; RateIndex `as_of_block`; ObservatorySeriesPoint `last_block` | formatBlock render sites across all five surfaces + evidence + history-series | (b) | **FIXED** — `formatBlock` word register; the `sweep_block > 0` CLAIM branches (InspectorPositionCard, positionRow, history-series `sweepMark`) additionally guarded with `readWirePopulation` so -0 can never read as "no sweep recorded" |
| ParamChange `effective_log_index`; ChainEvent `log_index`, `seq` | InspectorPositionCard provenance; FeedList/InspectorActivity provenance lines (incl. the `seq !== 0` branch, where `-0 !== 0` is false) | (b) | **FIXED** — `readWirePopulation` |
| EventFilter `since_block` | FeedSurface filter echo | (b) | **FIXED** — `readWirePopulation` |
| ObservatorySeriesPoint `accounts`, `liquidatable_positions` (nullable), `refused_positions` | `displayMetric` (THE chokepoint: cards, chart labels, titles, records), observatory-series `counts()`/takeaway, ObservatorySurface sub + crit-tone branch, ObservatoryPointDetail | (b) | **FIXED** — guarded at `displayMetric` + each remaining read |
| ObservatorySeriesPoint `batch_id`; AddressHistoryPoint `batch_id` | ObservatoryPointDetail observed-batch row; history-series point titles | (b) | **FIXED** — `readWirePopulation` |
| ObservatorySeriesResponse `step_seconds` | `describeStride` | (b) | **FIXED** — `readWirePopulation` (the `effectiveStrideSeconds` geometry path already refuses non-finite/<=0 to the native stride — its own local guard, recorded) |
| ReconcileSummary `exit_code`, `gated_rows`, `gated_exact`, `gated_drift`, `advisory_rows`; ReconcileWeld `rows_exact`, `rows_compared` | ProofSurface rows/chips; evidence `deriveProofSubjectStatus` ACCEPTANCE WELDS (`-0 !== 0` is false — a -0 exit code or drift SAILED THROUGH and accepted the receipt) + drawer rows | (b) | **FIXED** — guarded before the welds and at every render |
| Service `schema_version`, `algorithm_revision` | ProofSurface + evidence identity rows | (b) | **FIXED** — `readWirePopulation` |
| SubstrateRef `batch_id` | ProofSurface takeaway/chips; evidence live-subject rows | (b) | **FIXED** — `readWirePopulation` |
| PriceInput `budget_seconds`, `age_seconds` | evidence budget-verdict row | (b) | **FIXED** — `readWirePopulation` |
| StreamPayload `stale_since_seconds`, `last_good_batch_id` | FeedLiveStrip; PostureRibbon stale anchor | (b) | **FIXED** — word register (strip); the ribbon pre-classifies the anchor input (an unreadable staleness DURATION is withheld while the NO SERVABLE BATCH fact keeps rendering) |
| StreamPayload `poll_interval_seconds`; MetaResponse `sweep_never_refusals_in_batch`; ChainEpoch/Cursor/SupersessionLeg fields; Neutralized/PriceState/QuarantinedRange/PricePoint fields; Heartbeat/SweepCounts fields | no unclassified-surface consumer (grep: none on the five surfaces) | (c) | recorded — unconsumed here |
| riskBins/headroomCurve/paretoView/RiskMapLedger/DensityMap counts; `riskMapReadingLine`/`riskMapCoverageLine` `n()` | derived locally from walked rows (bin membership, band totals) | (c) | recorded — not wire integers |
| `eventKey` (feed-view); React `key=` compositions | identity attributes, never rendered text | (c) | recorded |
| Shock `factor_num`/`factor_den` | factor.ts `toBig` (throwing, -0-refusing since p1b-12) | (a) | — |
| FactorPrice `price_decimals` | factorPriceGuard `classifyFactorPrice` (p1b-4) | (a) | — |
| ProjectionHorizon/Projection fields; resultIdentity `batchId`; SetRun*/RunBook* fields | Lab surfaces — CLASSIFIED scope (engineClassification, setRunClassification, runbookSet, resultIdentity per p1b-2/3/5/9..13) | (a)/(c) | outside this wave's unclassified mandate |

### Named residues (recorded, not fixed — each exceeds the wave's ~30-line budget or sits outside the class)

- **`/v1/meta` constants** (freshnessTiers thresholds, meta.tsx): wire
  integers consumed as tier boundaries with no wire guard — a
  malformed constant shifts tier claims. A meta-constants classifier
  is a future-round candidate (the p1a-3 fallback-disclosure machinery
  is the natural home).
- **`retryAfter` twins** (runbookSet.ts, runbook.ts) — standing p1b-12
  record, unchanged: any-number posture, wider than this class.
- **posture provider carry** (lib/posture.tsx): the provider stores
  the SSE envelope raw and every consumer guards at ITS read (this
  wave). A provider-level frame classifier would centralize the six
  word-register sites but is a structural change — recorded.
- **A2 information boundary** (p1b-11): unchanged — -0 remains the
  only post-parse fingerprint; fractional tokens that round onto safe
  integers still need raw-text validation (Phase-3+).

### Red-first, executed and witnessed

- **e2e RED (both pins failed pre-fix, `web-3819-p1b14-red-e2e.log`)**:
  the bucket-count splice rendered the aave panel with NO malformed
  register and the hidden-account "1.05 – 1.10  0" row (error-context
  snapshot); the computed_positions splice rendered the book with NO
  route refusal.
- **unit RED (`web-3819-p1b14-red-formatblock.log`)**:
  `formatBlock(JSON.parse("-1e-324"))` — Expected `"unreadable"`,
  Received `"-0"`: the renderer printed the sign bit.
- The `malformedHistogramCounts` and throwing-read pins are born with
  their functions; their bite is proven by mutation (below), and the
  defect input (`JSON.parse("-1e-324")` IS -0) is itself pinned in
  both specs.

### Mutation kill (p1b-14-M1)

The bucket-count guard alone removed from `malformedHistogramCounts`
(`isWirePopulation(bucket.count)` mutated to `true`) —
book-charts-copy.spec.ts in isolation dies at exactly the 2 p1b-14
bucket pins (**2 failed / 52 passed**, `web-3819-p1b14-mutM1.log`; the
infinite/refused pins' survival discriminates the mutant); restored,
`cmp`-verified byte-identical, 54/54 green.

### Closing counts (p1b-14)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean
  (exit 0)
- touched unit specs (wire-guard + book-charts-copy + honest-render) —
  **77 passed** (71 pre-existing + 6 new)
- `npm run build` — clean (fresh, post-restore)
- e2e book + book-charts + book-table + observatory + feed +
  inspector + proof + p1b-fixes — **144 passed**
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1618 passed, 9 skipped, 0 failed (35.5s)**
  (`web-3819-p1b14-full2.log`) — the p1b-13 count (1610 + 9 skipped)
  plus exactly the 8 new pins (1 honest-render + 2 wire-guard +
  3 book-charts-copy + 2 e2e).

### Audit tally

**26 field-group rows render-reachable unguarded, FIXED** (about 60
individual read sites across 27 files), **5 rows already guarded**
(assertScale / factor / factorPrice / lab classifiers), **8 rows
recorded** (unconsumed, locally derived, identity-only, or the named
residues above).


## Phase 1 Track A Codex fix wave (p1a-9)

One commit (`fix(web): p1a-9 codex round - coverage counts risk books, meta
validates its constants, no socket is green, the floor has no fallback`).

The Track A Codex round returned 7 findings; all 7 fixed test-first, mutation
kills run in isolation, gates untouched (no bypasses).

### F1 (high) — coverage divided incompatible sets

`web/lib/coverage.ts` divided the WATERMARK vector (the full pipeline input
set — five stamps on production: aave_v3_etherfi, aave_param, debt_manager,
prices:poll:1, prices:poll:10) by `refused_engines` (risk BOOKS only) —
"COVERAGE 5/5 ENGINES" over a two-engine book. The denominator is now the
batch's RISK-ENGINE AGGREGATE roster (`StreamPayload.engines` — one
`Aggregate` row per book, withheld books included: the store derives
`refused_engines` from those very rows), deduped; roster ABSENT (the field is
optional on the stream envelope) → the chip is WITHHELD entirely, never
approximated from the stamps; an unbindable refused name (including a
stamp-that-is-not-a-book, e.g. `prices:poll:1`) → withheld (the p1a-4 law,
kept). `PostureRibbon` passes `posture.engines`.

- Fixture: `generate-feed.mjs` now composes `engines` into
  `feed-posture-snapshot.json` from the client package's committed
  `book.json` (same batch #1; a batch-id weld refuses a drifted pair), with
  ONE documented mechanical delta — each aggregate's sweep stamp is replaced
  by the batch watermark's own stamp verbatim (the schema's
  stamp-travels-on-the-row law), so the copy states 1205 against this
  payload's `served_at` and the clock law verifies it. Census: the file now
  pins **3** trios (was 2); `CLOCK_TRIOS` (generator), `CENSUS` +
  `CENSUS_TOTAL` 59→60 + the round-36 replay's `checked` 2→3
  (fixture-clock-law.spec.ts) moved in the same diff, as the pins demand.
- Unit pins (coverage.spec.ts, rewritten): THE FIVE-STAMP PIN (envelope
  keeps its 5-stamp `watermarks` on purpose — a derivation reverted to the
  stamp vector type-checks and dies at 2/2), healthy 2/2, DM-withheld 1/2
  named, roster-absent → null, roster-empty → null, unbindable (ghost +
  price-stamp) → null, refused dedupe, roster dedupe.
- e2e pins (p1a-fixes `p1a-9 · the codex round`): five-stamp 2/2 (stamps
  visible in the Data-status popover), five-stamp DM-withheld 1/2 warn
  register resolved, roster-absent → chip count 0 while BATCH/SNAPSHOT
  render.
- MUTATION KILL (isolation): roster reverted to `batch.watermarks` →
  coverage.spec dies at THE FIVE-STAMP PIN (4 failed / 3 passed); restored →
  green.

### F2 (high) — meta had no pending/invalid states and validated nothing

`web/lib/meta.tsx`: the reading is now
`{ source: "pending" | "meta" | "invalid" | "fallback", constants,
invalidReason? }`. "pending" is the provider's initial state (was: an
instant "fallback" claimed BEFORE any failure); "meta" only for a VALIDATED
trio; "invalid" (fallback constants + the cause named in `invalidReason`)
when the wire answers with constants the tier theorems cannot stand on —
each must be a finite positive safe integer (`Number.isSafeInteger` + `> 0`)
AND the boundaries must nest: `2·poll ≤ ceiling ≤ sweepWorstCase`
(`tierConstantsViolation`); "fallback" ONLY after an actual failed ask.
Outside a provider the context default stays the disclosed fallback (no ask
will ever run there — that is meta unavailable by construction, not a
pending ask).

- `PostureRibbon` does NOT tier-style during "pending": new
  `snapshotChipPending` (lib/freshness.ts) renders the KNOWN age with no
  tier word; `RibbonSnapshotChip.tier` gains the `"pending"` arm →
  QUIET register (measured ink, solid border — deliberately not the dashed
  unknown register: the age is known, only the judgment is withheld), with
  `TIER_PENDING_DISCLOSURE` in the title. "invalid" tier-styles from the
  fallback trio and discloses `TIER_INVALID_DISCLOSURE_PREFIX` + the cause.
- Unit pins (freshness-tiers.spec.ts, +7): META_CONSTANTS_PENDING shape;
  violation-accepts (ratified trio + inclusive nesting bounds); per-field
  invalid arms (0, negative, fraction, NaN, Infinity, 2^53); THE MISORDERED
  PIN (poll 300 / ceiling 360 → source "invalid", constants = fallback,
  reason names "out of order"/600, and `freshnessTier(500, …)` is "stale" —
  never the FRESH the broken trio implied); ceiling>sweep arm; invalid ≠
  failure (one ask, source "invalid" not "fallback"); pending-chip parts.
- e2e pin: /v1/meta HELD (never resolves) at age 300 → chip is exactly
  `SNAPSHOT 5m` (no AGING), quiet register resolved, pending title, no
  fallback sentence.
- MUTATION KILL (isolation): ordering validation dropped (`if (false && …)`)
  → dies at exactly THE MISORDERED PIN (1 failed / 17 passed); restored →
  green.
- PIN MIGRATION (ledgered): r6-fixes (1) "ROUND-13 RIBBON DEFECT" now mutes
  /v1/meta (`route.abort()`), the p1a-4 determinism discipline — the chip's
  `· AGING` now lands only when meta settles, and an unmuted meta (live API
  or transport retries against a dead one) raced the test's reconnect
  backoff and broke its `connections === 1` idle premise (observed 3/3
  deterministic before the mute; 3/3 green after). The test's subject (the
  anchored age) is untouched.

### F3 (high) — the feed strip's green socket

`web/app/feed/FeedLiveStrip.tsx` `streamChip` threads `hasBase`:
open+base → `streaming` in ACCENT (`.liveAccent`, `--accent-text` — the
appbar's own law: connection is posture, not health); open+no-base →
`awaiting base` in the unknown register (`.liveUnknown`, `--ink-2`, hollow
dashed dot). `.liveOk` (the green) is RETIRED; `.liveWarn`/`.liveDown`
migrated to the text grade with the F5 sweep. Pin migration audit: NO
existing pin referenced `liveOk`/`streaming` (grep of feed.spec +
state-matrix recorded empty), so nothing migrated — the two new e2e pins are
net-new. MUTATION KILL (isolation, built): `hasBase` ignored (open always
"streaming") → dies at the awaiting-base pin; restored → green.

### F4 (medium) — the unavailable branch dropped the stream chip

The stream chip is lifted into `RibbonStreamChip` (components/Ribbon.tsx —
same testid, tone map, accent-only pulse) and the NO SERVABLE BATCH branch
(`PostureRibbon`) now mounts it beside the crit chip + stale-for reading,
after a `.sep`. e2e pins: unavailable×waiting (hang-up → STREAM RECONNECTING
beside NO SERVABLE BATCH + `stale for 42s` untouched) and unavailable×open
(held-open SSE server → STREAM CONNECTED, accent resolved, never `--ok`).
unavailable×closed: NOT honestly reachable in e2e (the client's reconnect
policy defaults to `maxAttempts: Infinity`; `closed` occurs only on
deliberate close/unmount) — the branch renders `ribbonStreamPosture`
verbatim, whose closed arm (`STREAM CLOSED`, down register) is pinned by the
total-mapping unit suite (stream-posture.spec.ts), the same code path both
bars mount.

### F5 (medium) — status TEXT still wore fill-grade tokens

Sweep: every `color:` declaration referencing `--ok/--warn/--crit/--accent`
in web CSS migrated to the `--*-text` grade — **93 declarations across 15
stylesheets**; borders, chip spines, dots, underline marks
(`text-decoration-color`), fills and SVG strokes keep the fill grade
(≈88 declarations, untouched by design). Audit table (site → text-or-mark →
action; class granularity):

| stylesheet | migrated TEXT sites (→ `--*-text`) | kept FILL sites (marks) |
|---|---|---|
| app/lab/lab.module.css (18) | .modeButton[pressed], .hintBad, .chipOn, .proofChip, .bitIdentical, .tone-ok/-warn/-crit, .flagOn, .cardForensics summary:hover, .cellResult/.cellSuperseded/.cellUnanswered/.cellContradicted/.cellDefinitionChanged .cellTag, .rowLabelButton:hover, .dumbbellContradiction, .dumbbellUnmeasuredTag | borders (.modeButton, .chipOn, .proofChip, cell spines, .runButtonSmall:hover, dashed warn tag), fill .dumbbellContradictionBand (`--crit-bg`), outline `--accent` |
| components/primitives.module.css (13) | .statValue.ok/.warn/.crit, .hf.ok/.warn/.crit, .routeRefusalReset:hover, .stampItem b.ok/.warn/.crit, .addressLink:hover, .copyButton:hover, .copyButton.copied | border-colors beside each hover/copied state |
| app/inspector/inspector.module.css (12) | .refusal, .recentItem a:hover, .vOk/.vWarn/.vCrit, .verdictOk/.verdictWarn/.verdictCrit, .explain:hover, .historyDmDisclosure, .txLink:hover, .loadMore:hover | verdict/refusal border-colors, .explain underline `text-decoration-color`, .tagCrit `background: var(--crit)` |
| app/feed/feed.module.css (12) | .liveAccent (new), .liveWarn, .liveDown, .chipButton:hover/.on, .txLink:hover, .dividerFold/.noteFold summary:hover, .detailToggle:hover, .warnStrip b, .refusalStrip b, .loadMore:hover | border-colors on chipButton/detailToggle/loadMore |
| app/developers/developers.module.css (7) | .crossLink a, .tocChip:hover, .methodGet, .methodPost, .paramRequired, .responseChipErr, .errorStatus | method/response chip border-colors |
| app/proof/proof.module.css (6) | .warnStrip b, .statusOk, .statusCrit, .rawToggle:hover, .crossLink a, .cardForensics summary:hover | status/rawToggle border-colors |
| app/book/book.module.css (6) | .panelHead .comparator, .warnStrip b, .notice b, .chipButton:hover/.on, .incrementsContradiction | chipButton border-colors |
| components/evidence.module.css (4) | .vOk/.vWarn/.vCrit, .explain:hover | .explain `text-decoration-color` |
| app/globals.css (4) | .okt, .warnt, .crit-t, .eyebrow | — |
| components/table.module.css (3) | .sortButton:hover, .sortGlyph, .loadMore:hover | .loadMore border-color |
| app/observatory/observatory.module.css (3) | .chipButton:hover/.on, .warnStrip b | chipButton border-colors |
| components/header.module.css (2) | .wordmark span, .themeToggle:hover | .tab.on / .themeToggle border-colors |
| ribbon (1) .badge.proof · placeholder (1) .fedBy b · drawer (1) .close:hover | | proof-badge/close border-colors |

The styleguide contrast gate gains ONE REAL-CONSUMER specimen
(`ContrastSpecimens`): the inspector's `.verdict.verdictWarn` class mounted
with its real stylesheet on its real `--panel` ground, measured live
(`data-testid="contrast-consumer"`), pinned ≥ 4.5 in BOTH themes (e2e in the
p1a-6 describe). KILL (isolation, built): `.verdictWarn` text regressed to
`var(--warn)` → dies at the light-theme measured ratio (~3.2 < 4.5);
restored → green. chart-spec-v4's AC contrast pins pass unchanged (the text
grade only raises light-theme contrast; dark text grade = fill grade by
token law).

### F6 (medium) — the floor's regex accepted a fallback

`web/stylelint.config.mjs`: `font-size` must now match the EXACT declared
token vocabulary, both ends anchored, NO fallback argument —
`^var\(--(t-(display|chapter|section|fighead|body|ui|meta|floor|mono-lg|mono-sm|mono-floor|mono|stat-lg|stat)|fs-(h1|h2|lede|body|note|table|mono-sm|mono|caption|label|badge|stat|hf))\)$`
(names verified against tokens.css; longer alternatives precede their
prefixes; `font` shorthand still held to `inherit`). All 339 existing
declarations are bare token references — zero churn. SCRATCH PROOF (the
p1a-2 form): `.p1a9MutationScratch { font-size: var(--t-typo, 1px) }` +
`var(--t-ui, 14px)` + `var(--t-typo)` appended to globals.css → stylelint
FAILED exit 2 at exactly globals.css:126/130/134 with the token-law message
(all three: the old gate passed the first two); removed → exit 0.

### F7 (medium) — identityMissing was bypassable by render-empty elements

`web/lib/kit.ts`: the ReactNode identity RETIRES (an empty fragment was an
"element", therefore content, and mounted a banner with a blank strip).
`VerdictBanner` now takes a TYPED `VerdictIdentityModel` — the §4 strip
fields verbatim (`batch · age · coverage · currentOrProjected · evidence`),
each an optional clause `{ text?, value?, suffix?, tone? }` (value = the §5
mono register) — and renders the strip ITSELF from the chip family
(`StatusChip`/`ChipVal`), in `VERDICT_IDENTITY_ORDER`. Missing = no model or
every clause blank (`verdictIdentityMissing`) → the unchanged structural
refusal. `verdictBannerModel`'s banner arm now carries the resolved chips
(`verdictIdentityChips`: §4 order, quiet default, blank members → null).
Call sites migrated: the styleguide's five variant banners + the
refusal-law specimen (`identity={null}`); no other consumer existed. Pins:
kit.spec verdict describe rewritten — the EMPTY-FRAGMENT REGRESSION class
({}, all-blank clauses, blank members) refuses; one-clause presence; §4
order pin; tone map with chips carried. The p1a-6 DOM pin
(`[data-slot="identity"]` non-empty per lawful banner) holds unchanged.

### Closing counts (p1a-9)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean (exit 0).
- Touched unit specs (coverage 7 + freshness-tiers 18 + kit 9 +
  stream-posture 10 + fixture-clock-law 73) — green in isolation.
- CI-mirror shape (`NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run build && npx
  playwright test -c tests/playwright.p1a.config.ts`): **1645 passed,
  0 skipped, 0 failed (36.5s)** — the p1a-8/p1b-14 line plus exactly the 17
  new pins (2 coverage + 7 tiers + 8 e2e: 3 F1 + 1 F2 + 2 F4 + 2 F3 — the
  F5 specimen rides the styleguide describe).
- No-var shape (`npm run build`, same suite): **1635 passed, 10 skipped,
  0 failed (37.5s)** — the 10 skips are exactly the styleguide describe
  (9 + the new F5 consumer specimen).
- 4 mutation kills, each in isolation, each dying at its named pin
  (F1 roster / F2 ordering / F3 hasBase / F5 fill-grade), plus the F6
  three-form scratch proof.


## Phase 1 Track B Codex fix wave 7 (p1b-15)

One commit (`fix(web): p1b-15 codex round 7 - the last two negative-zero
reads are guarded, the audit corrects itself`).

Codex round 7 read the p1b-14 audit table against the code and found TWO
rows that claimed guards which did not exist. Both fixed test-first, and
both rows STRUCK-AND-CORRECTED in §p1b-14 above (never silently
rewritten): the incorrect verdicts remain visible under strikethrough
with the correction beside them.

### Site 1 (medium) — the appbar sweep chip's TONE read `failed` raw

`web/components/PostureRibbon.tsx:182` (pre-fix):
`tone: stamp.sweep.failed > 0 ? "warn" : "dim"` — no wire guard. A
failure-tally token `-1e-324` parses to NEGATIVE ZERO, `-0 > 0` is
false, so the malformed tally selected the DIM (non-degraded) arm while
the sweep age beside it stayed readable: a tally nobody could read
looked like a healthy sweep. The p1b-14 row recorded this consumer as
guarded — it guarded only the AGE.

Fix: `ribbonSweepReading` (lib/stream-posture.ts, the ribbon family's
pure module) derives value AND tone in ONE guarded read. An
out-of-contract tally renders the word register (`failed unreadable`,
the p1b-13/14 vocabulary) in the WARN tone — the dim arm is unreachable
over an unreadable tally, and never a throw (layout chrome, above the
p1b-0 boundary). Legal tallies keep the exact prior law (0 → dim,
>0 → warn); the p1b-14 age arms ride inside unchanged. PostureRibbon
consumes the derivation; no other sweep-chip consumer exists.

### Site 2 (medium) — WaterfallPoint `index` was never validated

`web/app/book/waterfallView.ts:107-108` (pre-fix): `buildWaterfallSteps`
branched on `point.index === 0` — true of -0 — so a raw first-index
token `-1e-324` wore the legitimate UNSHOCKED rung (chart tick, answer
sentence selection, dust-rung names). And `stressIncrements`' grid weld
ORDERED indexes it never validated: `1 <= -0` is false, so a -0,1
sequence read as strictly rising and the increments view rendered as if
the grid were lawful. The p1b-14 row recorded the field as (c) needing
no guard ("the index never renders outside that refusal's own text") —
INCORRECT: the index steers rendering through the `=== 0` branch and the
ordering weld even where it never prints.

Fix, split by the p1b-14 register doctrine:
- waterfallView (`waterfallEngineAnswer` selection,
  `buildWaterfallSteps` census branch, `waterfallAllDustRungs` rung
  names): every consumed `point.index` passes
  `readWirePopulation(point.index, "points[].index")` BEFORE
  ordering/selection/label derivation — out of contract THROWS into the
  p1b-0 route boundary, the module's established posture (the p1b-14
  accountCount law).
- stressIncrements: the indexes pass `isWirePopulation` at the TOP of
  the grid weld — failure refuses into the module's own `refused` arm
  (GRID CONTRADICTION voice, naming the factor pair, never printing a
  value `String(-0)` would launder to "0"). On the live page the route
  arm fires first (both read the same points); the model's register is
  unit-pinned.

### Red-first, executed and witnessed (`web-3819-p1b15-red.log`)

All 5 pins written first and failed at the defect:
- unit: `buildWaterfallSteps` did NOT throw on a -0 first index (the
  unshocked rung rendered); `waterfallEngineAnswer`/`waterfallAllDustRungs`
  did not throw; `stressIncrements` returned "view" over the -0,1 grid
  ("expected refused, got view").
- e2e (raw-splice per p1b-12/13/14: sentinel, uniqueness asserted,
  raw-string replacement): the sweep splice resolved to
  `<b class="…__dim">age 1205s</b>` — the -0 tally WEARING the dim arm,
  captured in the log; the waterfall splice rendered /book with NO route
  refusal.
- The `ribbonSweepReading` pins are born with the function (its RED is
  the e2e above); bite proven by mutation M1.

### Mutation kills (3/3, unit-in-isolation, restoration `cmp`-verified)

- **p1b-15-M1**: the tally guard removed from `ribbonSweepReading`
  (`if (!isWirePopulation(sweep.failed))` → `if (false)`) →
  stream-posture.spec.ts dies at exactly the -0 tally pin
  (**1 failed / 9 passed**, `web-3819-p1b15-mutM1.log`).
- **p1b-15-M2**: the weld index check removed (`→ if (false)`) →
  stress-increments.spec.ts dies at exactly the p1b-15 grid pin
  (**1 failed / 12 passed**, `web-3819-p1b15-mutM2.log`).
- **p1b-15-M3**: `buildWaterfallSteps`' guarded read reverted to
  `point.index === 0` → book-charts-copy.spec.ts dies at exactly the
  unshocked-rung pin (**1 failed / 55 passed**,
  `web-3819-p1b15-mutM3.log`; the surviving answer/dust pin
  discriminates the mutant).
- Each restored and `cmp`-verified byte-identical before the next.

### Closing counts (p1b-15)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean
  (exit 0)
- touched unit specs (book-charts-copy + stress-increments +
  stream-posture) — **79 passed** (72 pre-existing + 5 new + 2 born
  with `ribbonSweepReading`)
- `npm run build` — clean (fresh, post-restore)
- e2e book + p1b-fixes + shell (appbar) — **57 passed, 1 skipped**
  (the styleguide smoke skip)
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1642 passed, 10 skipped, 0 failed (36.9s)**
  (`web-3819-p1b15-full.log`) — the pre-wave baseline measured this
  session (1635 + 10 skipped, `web-3819-p1b15-baseline-full.log`) plus
  exactly the 7 new pins (2 stream-posture + 1 stress-increments +
  2 book-charts-copy + 2 e2e).

### Audit posture after this wave

The two corrected rows close round 7's findings; no OTHER row was
re-verified this wave — the correction is scoped to what Codex proved
wrong. The named residues of §p1b-14 (meta constants, retryAfter twins,
provider raw carry, the A2 information boundary) stand unchanged.


## Phase 1 Track B micro fix wave (p1b-16)

One commit (`fix(web): p1b-16 the stop index joins the grid weld`).

One item, named by p1b-15's own concerns list: `stressIncrements`'
truncation compare (`b.index >= stopIndex`) consumed the server-named
`monotonicity.index` RAW.

### The site (medium) — a -0 stop index silently truncated the series

`web/app/book/stressIncrements.ts` (pre-fix): p1b-15 welded the POINT
indexes but not the stop index they are ordered against. A stop-index
token `-1e-324` parses to NEGATIVE ZERO (the p1b-11 class); every
lawful point index satisfies `>= -0`, so the loop broke at the FIRST
step and the model returned kind "view" with an EMPTY step list wearing
the legitimate stop sentence — a silent truncation, never a refusal.

Fix: the named index passes `isWirePopulation` at the stop-index
classification point (immediately after the p1b-15 grid weld, before
the truncation loop) — the same wire population contract as the point
indexes it is ordered against. Failure refuses into the module's own
`refused` arm (GRID CONTRADICTION voice; no value printed, since
`String(-0)` would launder to "0"). A null/undefined index keeps the
exact prior law (no stop; the schema serves `index?`), and the stop
stays ENGINE-SCOPED: the unnamed engine still runs the full grid.

### Red-first, executed and witnessed (`web-3819-p1b16-red.log`)

The pin written first and failed at the defect: `stressIncrements` over
`BOOK_MONOTONICITY_VIOLATION` with `monotonicity.index` spliced to -0
returned "view" ("expected refused, got view") — 1 failed / 13 passed.

### Mutation kill (1/1, unit-in-isolation, restoration `cmp`-verified)

- **p1b-16-M1**: the stop-index guard removed
  (`if (stopIndex !== null && !isWirePopulation(stopIndex))` →
  `if (false)`) → stress-increments.spec.ts dies at exactly the p1b-16
  pin (**1 failed / 13 passed**, `web-3819-p1b16-mutM1.log`; every
  p1b-15/-6 pin survives, so the mutant is discriminated). Restored and
  `cmp`-verified byte-identical.

### Final self-audit — every wire-integer read in stressIncrements.ts + waterfallView.ts

Sweep of both modules for ANY remaining unguarded wire-integer read
(recorded even where empty of defects):

- `points[].index` — stressIncrements: welded via `isWirePopulation`
  (p1b-15); the `String(...)` prints in the factor/descend refusal
  reasons fire only AFTER the weld admitted the pair. waterfallView:
  `readWirePopulation("points[].index")` at all three sites (p1b-15);
  the `deepest.index === 0` branch reads the validated copy. GUARDED.
- `monotonicity.index` — guarded THIS WAVE; consumed by the truncation
  compare only after classification. GUARDED.
- `cumulative_eligible_accounts` / `newly_eligible_accounts` /
  `insolvent_if_liquidated_accounts` — stressIncrements: the p1b-14
  count contract precedes the latch weld and every `String(...)` in the
  LATCH reason. waterfallView: `accountCount` → `readWirePopulation`,
  and the dust-rung zero-member gates read through the guard. GUARDED.
- `usd_decimals` (stressIncrements) — RESIDUE, recorded: the SCALE weld
  compares `b.at.usd_decimals !== a.at.usd_decimals` RAW and classifies
  after, not before. A matched -0 PAIR slips the arm and refuses only
  downstream (every consumption of `step.usdDecimals` —
  `incrementScaleClause`, BookWaterfall's step money — lands in
  `formatUnits` → `assertScale`, which refuses -0 since p1b-13 into the
  route register instead of the module's own); a MISMATCHED pair fires
  SCALE CONTRADICTION whose prose prints `String(-0)` as "0" and says
  "changed" where the truth is "cannot be read" (the p1b-14
  count-contract register lesson, one field over). No lawful-looking
  number renders on any path. Candidate for the next round.
- `usd_decimals` (waterfallView) — RESIDUE, recorded:
  `waterfallAllDustRungs` feeds it to `sumProvablyDust` →
  `BigInt(decimals)` RAW (dust.ts:271): `BigInt(-0)` is a silent `0n`,
  so within that function a -0 scale coerces the dust threshold to 10
  base units instead of refusing. Direction proven omission-only (a
  true scale is >= 0, so the coerced threshold is never LARGER than the
  true one — no false "all dust" claim is possible, only a missed
  disclosure), and on the live page the same render throws first
  (BookWaterfall computes the dust line and then `waterfallEngineAnswer`
  / `buildWaterfallSteps` hit the same field via `usd`/`geometry` →
  `assertScale`; React discards the whole render into the p1b-0 route
  arm, so no coerced result paints). Still an unguarded wire-integer
  read at module level. Candidate for the next round.
- No other number-typed wire field is consumed by either module
  (factors / cumulatives / grid_scale are Decimal STRINGS, read through
  `wireBigInt` / `formatUnits`).

### Closing counts (p1b-16)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean
  (exit 0)
- touched unit spec (stress-increments) — **14 passed** (13 + 1 new)
- `npm run build` — clean (fresh, post-restore)
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1643 passed, 10 skipped, 0 failed (36.8s)**
  (`web-3819-p1b16-full.log`) — the p1b-15 count (1642) plus exactly
  the 1 new pin.

## Phase 1 Track B micro fix wave (p1b-17) — the class closes

One commit (`fix(web): p1b-17 the last two scale reads join the guard -
the class closes at every known site`).

Two items, named by p1b-16's own final self-audit — the LAST site-fix
wave of the malformed-wire class, per the owner ruling of 2026-08-10.

### Residue 1 (medium) — the SCALE weld compared raw and classified after

`web/app/book/stressIncrements.ts` (pre-fix): the weld read
`b.at.usd_decimals !== a.at.usd_decimals` RAW. A MATCHED NEGATIVE-ZERO
pair (`-0 !== -0` is false; the p1b-11 class) slipped PAST the weld —
the -0 rode `step.usdDecimals` out of the module and refused only
downstream (`formatUnits` → `assertScale`, the p1b-0 route register
instead of the module's own arm). A MISMATCHED pair fired SCALE
CONTRADICTION whose prose printed `String(-0)` as "0" and claimed the
scale "changed" (6 to 0) where the truth is that it cannot be read.

Fix: both scales pass `isWireScale` BEFORE the weld compares them —
classify-then-compare, the same order the count contract (p1b-14) and
the grid weld (p1b-15) already enforce in this module. Failure refuses
into the module's own arm (SCALE CONTRADICTION voice, "outside the wire
scale contract … a scale that cannot be read"; the factor pair names
the site, no scale value prints). The changed-scale arm is unchanged
and now unreachable by an unreadable value: its prose prints only
scales the guard admitted.

### Residue 2 (low, omission-only) — the dust threshold's scale read raw

`web/app/book/waterfallView.ts` (pre-fix): `waterfallAllDustRungs` fed
`at.usd_decimals` to `sumProvablyDust` → `BigInt(decimals)` RAW —
`BigInt(-0)` is a silent `0n`, so a -0 scale coerced the Σ-dust
threshold to 10 BASE UNITS. Direction proven omission-only (a true
scale is >= 0, so the coerced threshold is never LARGER than a true
one — no false "all dust" over a real-money rung), but a
sub-10-base-unit Σ still CLAIMED dust under the coercion, and every
larger Σ fell out of the disclosure by ACCIDENT.

Fix: `isWireScale` guards the read — an out-of-contract scale makes NO
dust claim on either class (`continue`, the function's own omission
posture: the disclosure line only ever ADDS a fact, and a dust PROOF
needs a readable scale). The omission is now deliberate, never a
coerced threshold; `0` stays a legal scale (pinned). On the live page
the same render still throws first via `usd`/`geometry` →
`assertScale` into the p1b-0 route arm — the module-level guard closes
the read for every future caller, not just today's page.

### Red-first, executed and witnessed (`web-3819-p1b17-red.log`)

Three defect pins written first, all failed at their defects
(**3 failed / 71 passed**):

- matched -0 pair → `stressIncrements` returned "view" ("expected
  refused, got view");
- mismatched pair → prose read "usd_decimals changed between grid
  points (6 to 0)" (no "cannot be read");
- dust rungs with -0 scale and Σ bad debt "5" → `badDebt:
  ["unshocked"]` (a dust claim at an unreadable scale).

The fourth new pin ("0 stays a LEGAL scale") passes on both sides by
design — it guards the guard against over-refusing the value zero.

### Mutation kills (2/2, unit-in-isolation, restorations `cmp`-verified)

- **p1b-17-M1**: the stressIncrements classify guard removed
  (`if (!isWireScale(a…) || !isWireScale(b…))` → `if (false)`) →
  stress-increments.spec.ts dies at exactly the two p1b-17 pins
  (**2 failed / 14 passed**, `web-3819-p1b17-mutM1.log`); every
  p1b-6/-15/-16 pin survives. Restored, `cmp` byte-identical.
- **p1b-17-M2**: the waterfallView scale guard removed
  (`if (!isWireScale(at.usd_decimals)) continue` → `if (false)
  continue`) → book-charts-copy.spec.ts dies at exactly the p1b-17
  defect pin (**1 failed / 57 passed**, `web-3819-p1b17-mutM2.log`);
  the "0 stays legal" companion and every p1b-14/-15 pin survive,
  discriminating the mutant. Restored, `cmp` byte-identical.

### Closing audit

With these two reads guarded, the p1b-16 final self-audit's inventory
is fully discharged: every wire-integer read in stressIncrements.ts and
waterfallView.ts is classified before use, and no module on the audited
surfaces consumes a number-typed wire field without a guard. The
structural limitation stands as recorded (post-parse information
boundary, finding A2): tokens that round onto plain safe integers are
indistinguishable post-parse, and only raw-text response validation at
ingestion can close them.

### Closing counts (p1b-17)

- `npm run typecheck` / `npm run lint` / `npm run lint:css` — clean
  (exit 0)
- touched unit specs — stress-increments **16 passed** (14 + 2 new),
  book-charts-copy **58 passed** (56 + 2 new)
- `npm run build` — clean (fresh, post-restore)
- FULL Track B suite (`npx playwright test -c
  tests/playwright.p1b.config.ts`, port 3819, fresh build):
  **1647 passed, 10 skipped, 0 failed (35.7s)**
  (`web-3819-p1b17-full.log`) — the p1b-16 count (1643) plus exactly
  the 4 new pins.

Malformed-wire class: CLOSED at all known render-reachable sites per owner ruling 2026-08-10; complete closure = response-boundary validation at ingestion, commissioned as a Phase 2/3 work item.

## Phase 1 CLOSE (2026-08-10, owner-ratified)

Track A (foundation): 9 tasks + 1 Codex fix wave (p1a-0..9). Delivered: closed type set (12px floor,
stylelint-structural), two-grade palette (4.5:1 both themes, real consumers migrated), width contract
(1180 repealed), freshness tiers as validated theorems (pending/meta/fallback/invalid), the canon appbar
(LIVE·WATERMARKED retired; stream/snapshot-tier/batch/coverage as separate truths; 61+ pins migrated),
component kit (typed verdict-banner identity, exact-layer affordance, chip family, six states), the living
styleguide (self-verifying contrast incl. a real consumer), convergence pass (four surfaces hold).
Codex round: 7 findings, all fixed and verified held. Mutants: 15+4 killed.

Track B (validation + identity): 17 waves (p1b-0..17) over seven Codex rounds. Delivered: honest route
refusal boundary; wireGuard law (decimal/scale/population/signed/occupancy, -0 refused everywhere incl.
the client-ts assertScale contract gate — the freeze's one authorized exception); three classifiers
(RunBookEngine full subtree, SetRunEngineSummary, FactorPrice); result identity (§5) with response-address
+ nested-account welds; the nine-item gap audit; the -0 class closed at every known render-reachable site
(owner ruling 2026-08-10). Mutants: 23+ killed across the train.

Commissioned forward (owner-ratified): RESPONSE-BOUNDARY VALIDATION AT INGESTION as a Phase 2/3 work item
- the only complete closure of the post-parse boundary (A2) and the guard-discipline erosion risk.
Standing owner-adjudication items: A2 post-parse fractional rounding (recorded boundary); retryAfter
typeof-number twins; server-side solver-error prices:null serialization (API defect, outside program scope).
Suites at seal: p1b shape 1647/10/0; CI-mirror shape 1645+/0/0; client-ts 355/0. Typecheck/lint/stylelint clean.


## 2026-09-15 · Plan 1 (kit · Overview · Book) — pin retirement ledger

Authority: docs/specs/2026-09-15-ui-product-register-design.md §7. The Book surface was rebuilt;
its page-local modules (app/book/*.ts) and the pins describing the old surface are retired.
Semantic invariants re-expressed in tests/e2e/book.spec.ts: refused never zero · null never zero ·
engine withheld whole · 503 no-batch · 409 walk restart · dek computed from the response ·
never summed · batch identity rendered. Not carried into Plan 1 (recorded, not lost): the
"All N accounts" explorer link and the Collateral-mix section (no per-asset collateral on /v1/book).

The old app header (AppHeader · PostureRibbon · header.module.css) went with it: the tier→tone
invariant is re-expressed in tests/unit/live-pill.spec.ts ("age tone follows the ratified tiers; an
unknown age is dim, never a tier color" · "stream words") and the honest pill in
tests/e2e/shell.spec.ts ("<path> renders <label> inside the shell": data-word Reconnecting|Not
connected with no API behind it). The freshness clock laws the old Book's age line and the old
ribbon rendered stay pinned at the lib layer (tests/unit/freshness*.spec.ts · stale-since.spec.ts ·
result-identity.spec.ts). Method: every e2e spec touching /book was inventoried, then the whole
suite was run against HEAD's production build BEFORE any deletion — 138 failed / 323 passed /
10 skipped — and the 138 were partitioned by the decision rule: 135 pinned the retired Book or
header; 3 did not (see "Left red, not retired" below).

### Inventory (before deleting anything)

| file | tests | touching /book or book-* ids | decision |
|---|---|---|---|
| tests/e2e/book-charts.spec.ts | 17 | 14 (§16–§18 Book charts) | trim: 14 retired; 3 "Lab …" caption tests stay (they goto /lab) |
| tests/e2e/book-table.spec.ts | 10 | 10 | delete whole |
| tests/e2e/chart-spec-v4.spec.ts | 40 | 27 (risk map, Book histogram) | trim: 27 retired; 13 frontier/run-book/cross tests on /lab stay |
| tests/e2e/w3l-slots.spec.ts | 21 | 12 (Book slot order) | trim: 12 retired; 9 Lab slot tests stay |
| tests/e2e/state-matrix.spec.ts | 1 driver × 53 cells | 15 cells (11 book × …, 4 shell × live:… on /book) | trim: 15 cells retired; 38 cells stay |
| tests/e2e/p0-fixes.spec.ts | 18 | 3 (p0-4 histogram, p0-5 snapshot chip) | trim |
| tests/e2e/p1a-fixes.spec.ts | 28 | 13 (p1a-4 ×7, p1a-9 F1/F2/F4 ×6) | trim; p1a-1 width/token pins pass on the new shell and stay; p1a-6 styleguide and F3 feed stay |
| tests/e2e/p1b-fixes.spec.ts | 24 | 6 (p1b-0, p1b-13, p1b-14 ×2, p1b-15 ×2) | trim |
| tests/e2e/r1-fixes.spec.ts | 25 | 10 ((1)×3, (7), (9)×2, (3), (8)×2, (6) nav) | trim; "(6) not one numbered eyebrow …" passes on every new surface and stays |
| tests/e2e/r3-fixes.spec.ts | 6 | 3 ((2)×2, (3)) | trim |
| tests/e2e/r4-fixes.spec.ts | 6 | 5 ((1)×3, (2)×2) | trim; "(1) the Inspector reconciles its OWN lookup" stays |
| tests/e2e/r5-fixes.spec.ts | 5 | 5 | delete whole |
| tests/e2e/r6-fixes.spec.ts | 5 | 4 | trim; "(2) the Inspector: same law" stays |
| tests/e2e/r7-fixes.spec.ts | 6 | 6 | delete whole |
| tests/e2e/r8-fixes.spec.ts | 4 | 2 ((1)×2) | trim; (2)×2 Lab anchor tests stay |
| tests/e2e/lab, r12–r17, runbook-bsplit, runbook-transition, shell | — | book-result / book-engine / book-running ids only | out of scope: those are the Lab run-book panel's ids on /lab, not the Book page |
| web/app/book/ | 25 files | 18 unreferenced by the new BookSurface | delete 18; keep page.tsx BookSurface.tsx book.module.css NeedsAttention.tsx StressPreview.tsx BookLegacy.tsx BookMethodology.tsx |
| tests/unit importing app/book | 8 | book-charts-copy, book-dek, book-row, book-table, dust, headroom-pareto, stress-increments, risk-bins | delete 8; book-sort-vocabulary (lib/positions), flip-ranking (app/lab), book-fixture-fidelity (fixtures only) STAY |

### Retired e2e pins — one line per test

tests/e2e/book-charts.spec.ts (14 of 17; the 3 "Lab …" tests stay, file header rewritten)
- book-charts.spec.ts · "reading lines render per panel from the served /v1/book values" — retired: copy/DOM of the retired Book histogram reading lines
- book-charts.spec.ts · "book stat block: slot order is STATE, ANSWER, cards, METHOD (DOM order)" — retired: DOM of the retired BookStatRows
- book-charts.spec.ts · "MUTATE the fixture and the reading lines change — computed, not hardcoded" — retired: copy/DOM of the retired reading lines; the computed-from-the-response law moved to book.spec.ts "demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population" (and tests/unit/book-headline.spec.ts)
- book-charts.spec.ts · "waterfall: percent labels, unshocked census, exact micro-strings, verbatim copy" — retired: copy/DOM of the retired BookWaterfall (its successor, StressPreview, is pinned in tests/unit/stress-preview.spec.ts)
- book-charts.spec.ts · "waterfall slot order: STATE (held-flat count) before the bars, METHOD and FORENSICS after" — retired: DOM of the retired BookWaterfall
- book-charts.spec.ts · "at_risk_note is ABSENT from the Book waterfall panel — and SURVIVES in the Developers raw register" — retired: copy/DOM of the retired BookWaterfall (the Developers half was the contrast term)
- book-charts.spec.ts · "held flat (Book): the counted-disclosure pattern, raw units by design" — retired: copy/DOM of the retired BookWaterfall
- book-charts.spec.ts · "the full-book walk AUTO-STARTS on mount — no button, and the partial page-scatter is gone" — retired: DOM of the retired risk-map walk; the walk-on-mount is exercised by book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- book-charts.spec.ts · "the auto walk: live progress, completed header, and ONE drawing (the DensityMap)" — retired: DOM of the retired DensityMap and its progress line
- book-charts.spec.ts · "409 mid-walk: the BookPositions notice grammar VERBATIM, restart from page one" — retired: invariant moved to book.spec.ts "a 409 during the walk restarts it on the reloaded book" (the notice grammar itself is retired copy)
- book-charts.spec.ts · "OUTPACED: a book that re-materializes faster than one walk gives up OUT LOUD — never a spliced vector" — retired: copy/DOM of the retired walk's give-up notice; the single-409 restart is in book.spec.ts "a 409 during the walk restarts it on the reloaded book"; the repeated-409 (outpaced) arm is not re-pinned — recorded below
- book-charts.spec.ts · "409 mid-walk with a SLOW fresh page: the stale progress dies AT ONCE, not on arrival" — retired: DOM of the retired walk progress; 409 restart per book.spec.ts "a 409 during the walk restarts it on the reloaded book"; the stale-progress timing arm is not re-pinned — recorded below
- book-charts.spec.ts · "the map's on-book count is BATCH-PAIRED — the table advancing past the map never blends two counts" — retired: DOM of the retired map/table pair; the new Book has one walk and one rendered batch identity, book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- book-charts.spec.ts · "an engine switch mid-walk restarts the walk — a vector never splices two books" — retired: control of the retired surface (the new Book is Cash-first with no engine switch) — recorded below

tests/e2e/book-table.spec.ts (all 10)
- book-table.spec.ts · "default dust <$1: min_value composed from the engine's decimals; disclosure exact at exhaustion; show reveals" — retired: invariant moved to book.spec.ts "demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population" (the min_value disclosure copy is retired)
- book-table.spec.ts · "empty filtered walk: hidden rows are named as hidden, not absent — dust off reveals them" — retired: invariant moved to book.spec.ts "demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population"
- book-table.spec.ts · "header sort cycle: canonical → exact reverse → canonical; column switch resets; every change is a new walk" — retired: DOM/controls of the retired positions table (the attention table has a fixed ordering) — recorded below
- book-table.spec.ts · "the Headroom column ranks by the wire's OWN `headroom` key on BOTH engines (1.5.0)" — retired: DOM of the retired positions table's sort; the sort vocabulary law stays in tests/unit/book-sort-vocabulary.spec.ts (lib/positions)
- book-table.spec.ts · "refused first: sort=status via the ONE standalone chip — indicators clear, headers exit it" — retired: DOM of the retired sort chip; refused rows stay counted, not hidden, per book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- book-table.spec.ts · "deep links round-trip: non-defaults kept, illegal combos normalized before ANY request, defaults omitted" — retired: URL controls of the retired positions table; normalizeBookQuery stays pinned in tests/unit/book-sort-vocabulary.spec.ts
- book-table.spec.ts · "the sentinel never auto-loads across an error; retry stays the one honest continuation" — retired: invariant moved to book.spec.ts "a transport failure mid-walk is stated with a retry that re-walks"
- book-table.spec.ts · "windowing bounds the DOM: 1,000 loaded rows render as a slice, footer always visible" — retired: DOM of the retired virtualized table (the attention table is bounded by materiality, not windowing) — recorded below
- book-table.spec.ts · "batch mismatch: the hidden count refuses to blend two batches; the surface re-fetches /v1/book once" — retired: invariant moved to book.spec.ts "a 409 during the walk restarts it on the reloaded book"
- book-table.spec.ts · "the risk map wears ONE axis vocabulary: debt (usd, log), $-prefixed — and there is no partial register left to fork it" — retired: DOM of the retired risk map

tests/e2e/chart-spec-v4.spec.ts (27 of 40; the 13 frontier / run-book / cross tests on /lab stay, file header rewritten)
- chart-spec-v4.spec.ts · "AC-6/AC-7/AC-8: the lane, its ONE label, and the $1 tick at exactly left + 48 + 14" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-6: an all-sub-$1 book draws NO lane, NO break glyph and NO `<$1` label" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-9/AC-11: sub-$1 bins live inside the lane, at least 1.5px wide, order preserved" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "W-CH-B: adjacent sub-$1 bins share the lane's own scale and never overlap" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-12: the SVG renders 1:1 from the measured width, with no scale factor" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-13/AC-14: the ramp is 0.30/0.48/0.66/0.85 and every cell clears 3:1" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-15: the seven marginal bars share ONE scale, and a zero band draws no ink" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "W-CH-B / AC-15: a marginal bar's RENDERED width is its true share at an extreme ratio" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "W-CH-C / AC-15: a band under one-millionth of the peak keeps its dot and its ledger row" — retired: geometry of the retired DensityMap / RiskMapLedger
- chart-spec-v4.spec.ts · "AC-16: no currency text floats inside the risk-map SVG except the axis ticks" — retired: DOM of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-17: the legend names the four RANGES, not four exact counts" — retired: copy of the retired risk-map legend
- chart-spec-v4.spec.ts · "AC-18: two crit rows one unit apart dodge into lanes 8px apart, both titled" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-20: 20 colliding crit rows take 20 lanes; the strip GROWS to 8 + 20*8" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "W-VR/AC-23: NO drawn callouts, NO leader ink, NO overflow note — all 12 exposures ranked in FORENSICS" — retired: DOM of the retired DensityMap forensics
- chart-spec-v4.spec.ts · "AC-24/AC-25: the LEDGER lists every nonempty bin, and no number lives only in a title" — retired: DOM of the retired RiskMapLedger
- chart-spec-v4.spec.ts · "AC-26/AC-28: the coverage line renders with ZERO refusals and outside every <details>" — retired: DOM of the retired risk map; refusals never hidden per book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- chart-spec-v4.spec.ts · "AC-28: a refusal is NEVER a descendant of the FORENSICS region" — retired: DOM of the retired risk map; refusals never hidden per book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- chart-spec-v4.spec.ts · "AC-29: DOM order is STATE, ANSWER, SVG, LEDGER, METHOD, FORENSICS" — retired: DOM of the retired BookRiskMap
- chart-spec-v4.spec.ts · "AC-30: aria-describedby is the METHOD line only; aria-details is FORENSICS; `Exact data` moves focus" — retired: DOM of the retired BookRiskMap
- chart-spec-v4.spec.ts · "AC-31/AC-32: ONE tab stop, ArrowRight moves the selection, Enter opens the detail with no request" — retired: interaction of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-33 + W-VR: the source-filter copy states the CONJUNCTION, with its unit, in STATE order" — retired: copy of the retired risk map STATE line
- chart-spec-v4.spec.ts · "AC-10: one rect per bin, and the LEDGER agrees with the grid" — retired: geometry of the retired DensityMap
- chart-spec-v4.spec.ts · "AC-52: no user-visible text says `HF histogram` or `health-factor histogram`" — retired: copy of the retired BookHistogram
- chart-spec-v4.spec.ts · "AC-53: bars are a share of the NAMED denominator on a 0–100% axis" — retired: geometry of the retired BookHistogram (the run-book twin "W-CH-B / AC-53: the run-book distributions carry the same true-share law" stays)
- chart-spec-v4.spec.ts · "W-CH-B / AC-53: a 1-in-10,001 bucket draws its TRUE share on the Book histogram" — retired: geometry of the retired BookHistogram
- chart-spec-v4.spec.ts · "AC-54: the risk map and the risk-band distributions render 12px at both breakpoints" — retired: typography of the retired DensityMap / BookHistogram (the frontier and run-book AC-54 twins stay)
- chart-spec-v4.spec.ts · "AC-55: the risk map renders no reference to a token that does not exist" — retired: stylesheet pin of the retired DensityMap

tests/e2e/w3l-slots.spec.ts (12 of 21; the 9 Lab slot tests stay)
- w3l-slots.spec.ts · "BookStatRows: STATE, ANSWER, cards, METHOD in DOM order" — retired: DOM of the retired BookStatRows
- w3l-slots.spec.ts · "BookStatRows hazard: the refusal breakdown and the split never collapse" — retired: DOM of the retired BookStatRows; refusals never collapsed per book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- w3l-slots.spec.ts · "BookHistogram: STATE, ANSWER, VISUAL, METHOD, FORENSICS in DOM order" — retired: DOM of the retired BookHistogram
- w3l-slots.spec.ts · "BookHistogram hazards: the coverage counts stay outside the disclosure" — retired: DOM of the retired BookHistogram
- w3l-slots.spec.ts · "BookWaterfall: STATE before the bars, ANSWER, METHOD, FORENSICS after" — retired: DOM of the retired BookWaterfall
- w3l-slots.spec.ts · "BookWaterfall hazards: held-flat COUNT, MONOTONICITY VIOLATION and EXCLUDED ENGINES all stay open, above the bars" — retired: DOM of the retired BookWaterfall; held-flat / monotonicity disclosure laws for its successor are in tests/unit/stress-preview.spec.ts
- w3l-slots.spec.ts · "BookBadDebt: ANSWER and METHOD above the table, neither collapsible" — retired: DOM of the retired BookBadDebt
- w3l-slots.spec.ts · "BookPositions: STATE, controls, ANSWER, METHOD, table in DOM order" — retired: DOM of the retired BookPositions
- w3l-slots.spec.ts · "BookPositions hazards: the warn band, the legends, and the degraded SUPERSESSION and REFUSAL registers all stay open" — retired: DOM of the retired BookPositions; supersession → book.spec.ts "a 409 during the walk restarts it on the reloaded book", refusal → book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- w3l-slots.spec.ts · "BookPositions: the ordering-in-force strip is its own line, never a chip and never collapsed" — retired: copy/DOM of the retired sort acknowledgement strip
- w3l-slots.spec.ts · "LAW-5: the price-path marker renders the FIXTURE's own asset and distance" — retired: DOM of the retired positions table's price-path marker (liq-distance rendering law stays in tests/unit/liq-distance.spec.ts) — recorded below
- w3l-slots.spec.ts · "Stampline: refusal-class pins stay inline, neutral pins collapse behind a COUNT" — retired: DOM of the retired Book stampline (the Stampline component itself stays for Inspector/Lab/History/Verification)

tests/e2e/state-matrix.spec.ts (15 of 53 cells; the driver and the other 38 cells stay)
- state-matrix.spec.ts · "book × loading" — retired: DOM of the retired loading register (book-loading)
- state-matrix.spec.ts · "book × ok" — retired: invariant moved to book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- state-matrix.spec.ts · "book × refused:engine-withheld" — retired: invariant moved to book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- state-matrix.spec.ts · "book × error:503-no-batch" — retired: invariant moved to book.spec.ts "no servable batch (503): the load-failure headline names the reason"
- state-matrix.spec.ts · "book × error:429" — retired: copy/DOM of the retired 429 register; the new load-failure headline is pinned on the 503 arm only — recorded below
- state-matrix.spec.ts · "book × error:500" — retired: copy/DOM of the retired 500 register — recorded below
- state-matrix.spec.ts · "book × error:500-book-with-positions-computed-zero" — retired: copy/DOM of the retired fetch-failure strip; computed zero vs refused is owned by book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- state-matrix.spec.ts · "book × degraded:batch-superseded-409" — retired: invariant moved to book.spec.ts "a 409 during the walk restarts it on the reloaded book"
- state-matrix.spec.ts · "book × refused:never-swept-collateral" — retired: DOM of the retired positions table's refused cell; refused rows counted, not hidden, per book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- state-matrix.spec.ts · "book × degraded:superseded-still-served" — retired: DOM of the retired supersession register; batch identity rendered per book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- state-matrix.spec.ts · "book × responsive:mobile" — retired: DOM of the retired surface at 390px; the new Book's mobile overflow is not re-pinned — recorded below (and see "Left red")
- state-matrix.spec.ts · "shell × live:sse-down" — retired: STREAM … text of the retired header; honest pill in shell.spec.ts "<path> renders <label> inside the shell", words in tests/unit/live-pill.spec.ts "stream words"
- state-matrix.spec.ts · "shell × live:sse-snapshot" — retired: STREAM … text and SNAPSHOT chip of the retired header; tier→tone in tests/unit/live-pill.spec.ts "age tone follows the ratified tiers; an unknown age is dim, never a tier color"; the pill-goes-Live-on-a-base-frame arm is not re-pinned in e2e — recorded below
- state-matrix.spec.ts · "shell × live:sse-unavailable-stale-last-good" — retired: ribbon-stale-since of the retired header; the stale-since law stays in tests/unit/stale-since.spec.ts
- state-matrix.spec.ts · "shell × live:sse-recovered" — retired: STREAM … text of the retired header; live-pill.spec.ts "stream words"; the recovery arm is not re-pinned in e2e — recorded below

tests/e2e/p0-fixes.spec.ts (3 of 18)
- p0-fixes.spec.ts · "p0-4 · Book histogram panels humanize the comparator token" — retired: copy/DOM of the retired BookHistogram; the comparator-label law stays in tests/unit/comparator-label.spec.ts
- p0-fixes.spec.ts · "p0-5 · a FRESH batch still shows its age beside the connected chip" — retired: SNAPSHOT chip of the retired header; age words in tests/unit/live-pill.spec.ts and tests/unit/freshness.spec.ts
- p0-fixes.spec.ts · "p0-5 · an old batch reads in hours+minutes, not a coarse suffix" — retired: SNAPSHOT chip of the retired header; age words in tests/unit/live-pill.spec.ts and tests/unit/freshness.spec.ts

tests/e2e/p1a-fixes.spec.ts (13 of 28; p1a-1 ×4, p1a-6 ×9 and p1a-9 F3 ×2 stay; section headers rewritten)
- p1a-fixes.spec.ts · "p1a-4 · each truth is its own chip — and LIVE · WATERMARKED is retired" — retired: DOM of the retired appbar chips; honest pill in shell.spec.ts "<path> renders <label> inside the shell"
- p1a-fixes.spec.ts · "p1a-4 · tier styling is computed from the ratified bounds — quiet, warn, crit outline, crit fill" — retired: colors of the retired SNAPSHOT chip; tier→tone in tests/unit/live-pill.spec.ts "age tone follows the ratified tiers; an unknown age is dim, never a tier color"
- p1a-fixes.spec.ts · "p1a-4 · raw watermark heights live in the Data status popover — not in the bar" — retired: DOM of the retired Data-status popover — recorded below
- p1a-fixes.spec.ts · "p1a-4 · partial coverage WARNS and NAMES the withheld engine" — retired: DOM of the retired COVERAGE chip — recorded below
- p1a-fixes.spec.ts · "p1a-4 · an UNBINDABLE refusal withholds the coverage chip entirely — never an invented count" — retired: DOM of the retired COVERAGE chip — recorded below
- p1a-fixes.spec.ts · "p1a-4 · SUPERSEDED is a chip in the warn register" — retired: DOM of the retired appbar chips
- p1a-fixes.spec.ts · "p1a-4 · a genuinely open stream is STREAM CONNECTED — an accent chip, never green, never LIVE" — retired: STREAM chip of the retired header; never-a-fake-Live in shell.spec.ts "<path> renders <label> inside the shell", words in tests/unit/live-pill.spec.ts "stream words"
- p1a-fixes.spec.ts · "p1a-9 · F1: COVERAGE counts risk books — 2/2 on a five-stamp production-shaped batch, never 5/5" — retired: DOM of the retired COVERAGE chip — recorded below
- p1a-fixes.spec.ts · "p1a-9 · F1: a withheld book on the five-stamp batch is 1/2 — warn register, named" — retired: DOM of the retired COVERAGE chip — recorded below
- p1a-fixes.spec.ts · "p1a-9 · F1: a frame WITHOUT the aggregates roster withholds the coverage chip entirely" — retired: DOM of the retired COVERAGE chip — recorded below
- p1a-fixes.spec.ts · "p1a-9 · F2: while /v1/meta is PENDING the snapshot chip renders the age UNSTAINED — no tier word, no tier color" — retired: SNAPSHOT chip of the retired header; the unknown-age-is-dim law in tests/unit/live-pill.spec.ts "age tone follows the ratified tiers; an unknown age is dim, never a tier color"
- p1a-fixes.spec.ts · "p1a-9 · F4: NO SERVABLE BATCH renders BESIDE the stream chip — a hang-up reads STREAM RECONNECTING" — retired: STREAM chip of the retired header; shell.spec.ts "<path> renders <label> inside the shell" (Reconnecting|Not connected)
- p1a-fixes.spec.ts · "p1a-9 · F4: NO SERVABLE BATCH over a genuinely OPEN stream reads STREAM CONNECTED — accent, never green" — retired: STREAM chip of the retired header; tests/unit/live-pill.spec.ts "stream words"

tests/e2e/p1b-fixes.spec.ts (6 of 24)
- p1b-fixes.spec.ts · "p1b-0 · a render throw shows the refusal register, not the generic error page" — retired: its throw site was the retired BookStatRows (renderEngineAmount on total_debt ""); replayed 2026-09-15 on the new Book: no throw, the honest headline renders, no generic error page — the route boundary (app/error.tsx · RouteRefusal) keeps no e2e pin from /v1/book — recorded below
- p1b-fixes.spec.ts · "p1b-13 · a /v1/book usd_decimals token that parses to -0 refuses the ROUTE — never a mis-scaled dollar figure" — retired: read site was the retired BookBadDebt; the -0 scale law stays in tests/unit/wire-guard.spec.ts; replayed: the mis-scaled 239,603,961 is absent on the new Book
- p1b-fixes.spec.ts · "p1b-14 · a bucket-count token that parses to -0 refuses the PANEL by name — no hidden account, route live" — retired: DOM of the retired BookHistogram (hist-malformed); the -0 population law stays in tests/unit/wire-guard.spec.ts
- p1b-fixes.spec.ts · "p1b-14 · an aggregate computed_positions token that parses to -0 refuses the ROUTE — the sweep's readWirePopulation arm" — retired: read site was the retired useFullBookWalk; the -0 population law stays in tests/unit/wire-guard.spec.ts; replayed: the new BookLegacy renders the token verbatim as "-0 computed" — a reopened render site, flagged for Task 13 / Plan 4 (see concerns)
- p1b-fixes.spec.ts · "p1b-15 · a sweep failed-tally token that parses to -0 renders the unreadable register — never the dim arm" — retired: DOM of the retired header's Data-status popover
- p1b-fixes.spec.ts · "p1b-15 · a waterfall first-index token that parses to -0 refuses the ROUTE — never the unshocked rung" — retired: read site was the retired waterfallView; the -0 index law stays in tests/unit/wire-guard.spec.ts; replayed: no "unshocked" rung on the new Book

tests/e2e/r1-fixes.spec.ts (10 of 25)
- r1-fixes.spec.ts · "(1) the wire's own reason survives the DEMOTION to the Headroom cell's hover, verbatim" — retired: DOM of the retired positions table (liq-distance law stays in tests/unit/liq-distance.spec.ts)
- r1-fixes.spec.ts · "(1) an ABSENT reason still refuses to rule out interest and parameters" — retired: copy of the retired positions table hover
- r1-fixes.spec.ts · "(1) the legend is RENDERED (not hover-only) and the column header carries its scope" — retired: DOM of the retired positions table legend
- r1-fixes.spec.ts · "(7) every numeric column header is right-aligned, matching its cells" — retired: DOM of the retired positions table
- r1-fixes.spec.ts · "(9) the dek is COMPUTED from /v1/book — mutate the response, the sentence changes" — retired: invariant moved to book.spec.ts "demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population" (and tests/unit/book-headline.spec.ts)
- r1-fixes.spec.ts · "(9) a withheld engine's side is UNKNOWN in the dek — never a zero" — retired: invariant moved to book.spec.ts "the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero"
- r1-fixes.spec.ts · "(3) the Book head AND its stampline carry the batch's own age" — retired: DOM of the retired Book stampline; batch identity per book.spec.ts "committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section"
- r1-fixes.spec.ts · "(8) order: map ABOVE table; positions ABOVE histogram; census ABOVE waterfall" — retired: section order of the retired surface
- r1-fixes.spec.ts · "(8) the census is retitled to what it states" — retired: copy of the retired BookBadDebt heading
- r1-fixes.spec.ts · "(6) the nav's two registers sit adjacent, divided — not across a void" — retired: DOM of the retired AppHeader nav (it looked up a "Proof" link; the shell's tab is "Verification"); the eight-tab nav is pinned in shell.spec.ts "<path> renders <label> inside the shell"

tests/e2e/r3-fixes.spec.ts (3 of 6)
- r3-fixes.spec.ts · "(2) the Book's age ADVANCES across the hour while the page sits open" — retired: DOM of the retired book-freshness line; the anchored-age law stays in tests/unit/freshness.spec.ts and freshness-receipt.spec.ts
- r3-fixes.spec.ts · "(2) THE RIBBON ENGAGES: the stale-batch suffix appears on the crossing" — retired: SNAPSHOT chip of the retired header; tiers in tests/unit/freshness-tiers.spec.ts and live-pill.spec.ts
- r3-fixes.spec.ts · "(3) the legend states REACHABILITY, and stops contradicting the covers hover" — retired: copy/DOM of the retired positions table legend

tests/e2e/r4-fixes.spec.ts (5 of 6)
- r4-fixes.spec.ts · "(1) THE ROUND-11 DEFECT: a sleep that freezes performance.now no longer freezes the age" — retired: DOM of the retired book-freshness line; the resume law stays in tests/unit/freshness-resume.spec.ts (the Inspector twin in this file stays)
- r4-fixes.spec.ts · "(1) THE RIBBON ENGAGES POST-RESUME: a slept-through threshold is still crossed" — retired: SNAPSHOT chip of the retired header
- r4-fixes.spec.ts · "(1) NEVER DECREASES: a wall clock stepped BACKWARDS cannot rewind the rendered age" — retired: DOM of the retired book-freshness line; the never-decreases law stays in tests/unit/freshness-resume.spec.ts and freshness-blind-resume.spec.ts
- r4-fixes.spec.ts · "(2) THE ROUND-11 DEFECT: the legend and the NO-DEBT hover no longer contradict" — retired: copy/DOM of the retired positions table legend
- r4-fixes.spec.ts · "(2) the reason-neutral legend still sits honestly over the COVERS arm" — retired: copy/DOM of the retired positions table legend

tests/e2e/r5-fixes.spec.ts (all 5)
- r5-fixes.spec.ts · "(1) THE ROUND-12 DEFECT: a NEW receipt at the SAME age_seconds re-anchors" — retired: DOM of the retired book-freshness line; the receipt law stays in tests/unit/freshness-receipt.spec.ts
- r5-fixes.spec.ts · "(1) the SAME receipt re-delivered does NOT re-anchor — the age never snaps back" — retired: DOM of the retired book-freshness line; tests/unit/freshness-receipt.spec.ts
- r5-fixes.spec.ts · "(2) THE ROUND-12 DEFECT: a paused monotonic clock AND a backward wall step still reconcile" — retired: DOM of the retired book-freshness line; tests/unit/freshness-blind-resume.spec.ts
- r5-fixes.spec.ts · "(2) hidden→visible reconciles on sub-threshold deltas; a BARE focus does not" — retired: DOM of the retired book-freshness line; tests/unit/freshness-resume.spec.ts
- r5-fixes.spec.ts · "(2) the full lifecycle burst under TWO blind clocks is still ONE re-fetch" — retired: DOM of the retired book-freshness line; tests/unit/freshness-resume-evidence.spec.ts

tests/e2e/r6-fixes.spec.ts (4 of 5; "(2) the Inspector: same law, its own envelope" stays)
- r6-fixes.spec.ts · "(1) THE ROUND-13 RIBBON DEFECT: an idle stream + two blind clocks no longer reads as fresh" — retired: SNAPSHOT chip of the retired header; the blind-resume law stays in tests/unit/freshness-blind-resume.spec.ts
- r6-fixes.spec.ts · "(1) THE RIBBON'S REPAIR IS BOUNDED: one reconnect per step, then it stops and says so" — retired: SNAPSHOT chip of the retired header; the bounded-repair law stays in tests/unit/freshness-blind-resume.spec.ts
- r6-fixes.spec.ts · "(2) THE ROUND-13 BOOK DEFECT: a FAILED repair under blind clocks is disclosed, not absorbed" — retired: DOM of the retired book-freshness line; tests/unit/freshness-blind-resume.spec.ts
- r6-fixes.spec.ts · "A CLOCK-CERTIFIED RESUME NEVER SHOWS THE UNKNOWN REGISTER" — retired: DOM of the retired book-freshness line and SNAPSHOT chip; tests/unit/freshness-resume-evidence.spec.ts

tests/e2e/r7-fixes.spec.ts (all 6)
- r7-fixes.spec.ts · "(1) AN HONORED liq_distance LINK: the ordering the link names is the ordering served, and the page SAYS SO" — retired: sort-remap acknowledgement of the retired positions table; the sort vocabulary law stays in tests/unit/book-sort-vocabulary.spec.ts
- r7-fixes.spec.ts · "(1) the honored ordering survives an ENGINE toggle — a book switch is not a sort control" — retired: sort-remap acknowledgement of the retired positions table; tests/unit/book-sort-vocabulary.spec.ts
- r7-fixes.spec.ts · "(3) THE STALENESS DURATION CLIMBS: a latched wire integer is no longer frozen on screen" — retired: ribbon-stale-since of the retired header; the stale-since law stays in tests/unit/stale-since.spec.ts
- r7-fixes.spec.ts · "(3) A BLIND RESUME OVER AN UNAVAILABLE FRAME: the duration goes UNKNOWN, and a reconnect repairs it" — retired: ribbon-stale-since of the retired header; tests/unit/stale-since.spec.ts
- r7-fixes.spec.ts · "(4) A HUNG RECONNECT NEVER LEAVES LIVE PAINTED — and the base frame is what restores it" — retired: STREAM chip of the retired header; never-a-fake-Live in shell.spec.ts "<path> renders <label> inside the shell"; words in tests/unit/live-pill.spec.ts "stream words" and stream-posture.spec.ts
- r7-fixes.spec.ts · "(4) A SERVER THAT HANGS UP TAKES LIVE WITH IT — and nothing else" — retired: STREAM chip of the retired header; shell.spec.ts "<path> renders <label> inside the shell"

tests/e2e/r8-fixes.spec.ts (2 of 4; the (2) Lab anchor tests stay)
- r8-fixes.spec.ts · "(1) A LEGACY ?sort=hf&dir=desc LINK: the direction survives, and the page SAYS what it applied" — retired: sort-remap acknowledgement of the retired positions table; tests/unit/book-sort-vocabulary.spec.ts
- r8-fixes.spec.ts · "(1) an ENGINE toggle to the DM REMAPS the honored hf ranking — the API refuses that pair" — retired: sort-remap acknowledgement of the retired positions table; tests/unit/book-sort-vocabulary.spec.ts

### Left red, not retired (pre-existing at HEAD bbc0f00, outside this task's scope)

Three e2e tests failed on the pre-deletion run and still fail; none pins the retired Book or
header, so they were NOT deleted:
- tests/e2e/state-matrix.spec.ts · "inspector × responsive:mobile" — document scrollWidth 619 at
  a 390px viewport. Cause (measured): the kit nav `nav.kit-module__nav` is 603px wide (eight
  tabs, `display: flex` with no wrap/scroll — web/components/kit/kit.module.css `.nav`). The
  Inspector content itself fits.
- tests/e2e/chart-spec-v4.spec.ts · "AC-54: the loss frontier renders 12px at both breakpoints"
  and "AC-54: the run-book distributions render 12px at both breakpoints" — the same 619px
  document width at the 360px NARROW breakpoint on /lab (their `expectRenderedTypography`
  refuses a page that scrolls sideways).
Eight unit tests in tests/unit/fixture-clock-law.spec.ts fail at HEAD too: the enumerator forbids
subdirectories under tests/fixtures and the demo dataset (tests/fixtures/demo/, landed in
1ada8ba / 5202ff9 / bbc0f00) states ages its own stamps do not support ("nothing in the fixtures
tree was skipped as noise" · demo/book.demo.json · demo/meta.demo.json ·
demo/positions-dm-demo-page-1.json · demo/positions-dm-demo-page-2.json · "no fixture carries a
trio the census does not name" · "the total is pinned" · "every batch-bearing body resolves at
least one trio"). Nothing under tests/fixtures was touched by this task.

### Components: deleted, and kept for Plan 4 (convergence)

- deleted · web/components/AppHeader.tsx — no importer (layout.tsx renders kit/AppShell)
- deleted · web/components/PostureRibbon.tsx — only importer was AppHeader
- deleted · web/components/header.module.css — only importer was AppHeader (ThemeToggle already reads kit/kit.module.css)
- deleted · web/components/charts/DensityMap.tsx and RiskMapLedger.tsx — beyond the brief's list: their only importer was the retired BookRiskMap and both import app/book/riskBins, so deleting riskBins without them fails typecheck
- kept · web/components/Ribbon.tsx — imported by app/proof/ProofSurface.tsx and app/styleguide/page.tsx
- kept · web/components/Stampline.tsx — imported by inspector/[addr]/InspectorSurface, lab/LabBatchStamp, observatory/ObservatorySurface, proof/ProofSurface, styleguide (page + DrawerDemo)
- kept · web/components/StatCard.tsx — imported by lab/LabBookPanel, lab/LabRealization, observatory/ObservatorySurface, styleguide/page
- kept · web/components/ribbon.module.css — imported by DegradationBanner and Ribbon
- kept · web/components/charts/WaterfallSteps.tsx and charts.module.css — imported by the styleguide and the remaining charts
- prose only · app/lab/labReadingLines.ts, labRunBookLines.ts, LabRunBookDetail.tsx cite `app/book/readingLines.ts` / `BookHistogram.tsx` in comments as provenance; no import — reword at convergence

### Unit specs

Before: 69 files. Deleted 8 (book-charts-copy, book-dek, book-row, book-table, dust,
headroom-pareto, stress-increments, risk-bins — each imported a deleted app/book module).
After: 61 = 69 − 8 (no lib spec lost). Kept although listed as candidates: book-sort-vocabulary
(lib/positions only), flip-ranking (app/lab/flipRanking), book-fixture-fidelity (fixtures only).
Plan 1's new specs present: human-usd, materiality, cash-rows, book-headline, stress-preview,
refusal-phrasebook, live-pill, cash-summary, demo-fixture-weld.

### Recorded, not carried into Plan 1

- the "All N accounts" explorer link
- the Collateral-mix section (no per-asset collateral on /v1/book)
- the repeated-409 ("outpaced") and stale-progress-timing arms of the walk (single 409 restart and transport-failure retry are pinned)
- the engine switch (the Book is Cash-first; the legacy market is a collapsed section)
- the positions table's sort controls, deep-link round-trip and DOM windowing (fixed attention ordering; materiality bounds the table)
- the price-path (LAW-5) marker on rows
- the 429 and 500 arms of the Book's load failure (503 is pinned)
- the appbar COVERAGE chip and the Data-status popover (no successor in AppShell)
- the live pill's snapshot / recovered arms in e2e (unit-pinned words and tones only)
- the Book's own responsive:mobile cell
- an e2e pin of the route-refusal boundary (app/error.tsx · RouteRefusal) reachable from /v1/book

### Verification (2026-09-15, web/, production build)

- `npm run typecheck` — clean (exit 0) · `npm run lint` — clean, 0 warnings · `npm run lint:css` — clean · `npm run build` — clean
- unit (`npx playwright test --project=unit`): **1043 passed, 8 failed** — the 8 are fixture-clock-law × tests/fixtures/demo, pre-existing at HEAD (above); unit spec files 69 → 61 (= 69 − 8 deleted)
- e2e BEFORE deletion (HEAD bbc0f00 build): 138 failed / 323 passed / 10 skipped
- e2e AFTER (`npx playwright test --project=e2e`): **3 failed / 323 passed / 10 skipped** — 471 − 135 retired = 336; the 3 are the kit-nav overflow tests above, pre-existing at HEAD
- Gate verdict: not all-green for two pre-existing causes outside this task (kit nav at ≤390px; demo fixtures vs the clock-law census). Cleanup staged, commit withheld pending the owner's call (Task 14 report).


## 2026-09-15 · Plan 1 CLOSES — kit, Overview, Book (spec docs/specs/2026-09-15-ui-product-register-design.md)

Landed b891fe7..0661cf7 (22 commits, all scope-gated on main). Suites on the closing build:
unit 1,057 / e2e 331 passed, 10 skipped, 0 failed (`npx playwright test`: 1,389 + 1 hardening pin);
typecheck / lint / lint:css clean; screenshot pins for Overview + Book (dark/light, 1440×900) landed
and hold; widths probe: no horizontal scroll at 1366/1440/1920/2560, shell 1280/1280/1520/1680;
contrast: every kit text/ground pair ≥4.5:1 in both themes (ink-3 on chip-bg is <4.5 and unused).
Owner approved Overview and Book side-by-side with the mockups on 2026-09-15 20:43.

Reviews: 7 task reviews (3 fix rounds, all closed); final whole-branch review → 1 Critical + 4
Important, fixed in one wave (lib/cash-view.ts shared derivation; refused rows never sliced; tier-toned
snapshot chip; page-batch supersession; walking marker) + one hardening (liquidatableRows computed
guard); re-review clean. Codex round (spec §9.5) could not run: Codex CLI 0.144.5 rejects the
config's `gpt-6-astra` — owner to upgrade the CLI; the round is owed before Plan 2 lands.

Carried forward: Plan 2 (Inspector) — AddressField, TrustChecklist, Sparkline join the kit; Prices
identity chip from /v1/params; the D1/I3/I4 e2e pins the re-review named (refused-row debt cell,
"once" on the page-batch reload, mid-walk marker). Plan 4 (convergence) — retire --t-*/--fs-* aliases,
PostureRibbon/Ribbon/Stampline/StatCard (still imported by History/Activity/Verification/API and the
styleguide), the theme-toggle register, the "All N accounts" explorer decision, Collateral-mix (needs
per-asset collateral on the wire). Deferred minors are enumerated in
.superpowers/sdd/2026-09-15-ui-kit-overview-book/progress.md.

## 2026-09-15 · Plan 2 (Inspector) — retirements

- tests/e2e/inspector.spec.ts: rewritten as the Inspector page-test contract (15 pins); the 19 old pins described the retired position card, HF-history card and proof fold.
- tests/e2e/p0-fixes.spec.ts: 7 Inspector pins retired (p0-3, p0-4, p0-8 boundary arms, p0-9 f3) — the boundary arms are unit-pinned in tests/unit/inspector-position.spec.ts.
- tests/e2e/p1b-fixes.spec.ts: 4 retired (p1b-4 ×2 → unit "unreadable" arms; p1b-6 fix 4 ×2 → contract "history: a differing vantage is stated").
- tests/e2e/r1-fixes.spec.ts: 8 retired — never_liquidatable vs verdict, own totals, DM percent params, own age, history head, never-touched engine, landing intro; laws now in inspector-position / inspector-view unit specs and the contract, except the never-touched engine, whose home is tests/unit/history-copy.spec.ts (`engineNeverPresent`, consumed by app/inspector/[addr]/HistoryCard.tsx). Of "(10) the adjudicated intros render…" only the Inspector arm retired: the Lab, Observatory, Feed, Proof and Developers intro pins are re-homed in r1-fixes.spec.ts as "(10) the adjudicated intros render — Lab, Observatory, Feed, Proof, Developers (the Inspector arm retired under Plan 2)".
- tests/e2e/r3-fixes.spec.ts: 3 retired — liq-bonus premium rendering left the Inspector with the position card; params-format.spec.ts keeps the arithmetic. (Its three tests were the file's only pins, so the file is deleted.)
- tests/e2e/r4-fixes.spec.ts, r6-fixes.spec.ts: 1 each retired → contract "resume: a failed background repair never replaces the rendered position". (Each held only that one pin, so both files are deleted.)
- tests/e2e/state-matrix.spec.ts: 7 Inspector cells re-expressed against data-state and the pinned headlines.
- tests/e2e/runbook-bsplit.spec.ts: the mover deep link re-expressed (field value, kicker, data-state).
- tests/e2e/shell.spec.ts: /inspector H1 → "Is this address at risk?" (ruling R9).
- tests/unit/inspector-lines.spec.ts: retired with lib/inspector-lines.ts; activityTakeaway and its pins moved verbatim to lib/activity-rows.ts / tests/unit/activity-rows.spec.ts; lookupTakeaway re-expressed in tests/unit/inspector-headline.spec.ts; positionTakeaway / positionMethodLine retired with the position card.
- Deleted: app/inspector/AddressEntry.tsx, app/inspector/[addr]/{InspectorPositionCard,InspectorHistory,InspectorActivity}.tsx, lib/inspector-lines.ts.

## 2026-09-15 · Plan 2 CLOSES — the Inspector (spec docs/specs/2026-09-15-ui-product-register-design.md §5.3; plan docs/plans/2026-09-15-ui-inspector.md)

Landed d989286..fee9609 (37 commits, all scope-gated on main, every one by pathspec). Suites on the
closing build (b0934f5; fee9609 is a comment move): unit 1136 / e2e 308 passed, 10 skipped, 0 failed
(npx playwright test: 1,444); typecheck / lint / lint:css clean; screenshot pins for the Inspector
(dark/light, 1440×900) landed beside Overview + Book and hold; widths probe: no horizontal scroll at
390/1366/1440/1920/2560, shell 1280/1280/1280/1520/1680; contrast: Plan 2 adds no raw color, so
Plan 1's token result carries. Owner approved the Inspector side-by-side with the mockup on
2026-09-16 10:44 (companion gate, captures from the f440ec9 build).

What it is: /inspector (H1 "Is this address at risk?", AddressField, recent lookups) and
/inspector/[addr] — one view model (lib/inspector-view.ts, branching only on lookup.outcome) behind a
verdict header, five tiles, the backing table with the wire's own boundary solve, a Trust checklist
with the room-over-batches sparkline, History (room % per batch from the Cash ratio; the legacy HF
series on the shared batch axis only for an engine ever present), Activity as a table in the engine's
own unit, the legacy card judged by its own health factor, inline stress rows, and a drawer with the
substituted calculation, inputs and provenance. Every wire decimal, scale and count passes the
guards before it prints; a refused, withheld, unread or unreadable value never prints as a number,
a zero, or "no position". Demo dataset generated (generate-demo-inspector.mjs, clock-law checked,
welded to the Book's near-cap account: $4,822 / $5,012.50 / $190.50 / 3.8 % / boundary $3,818.57).

Reviews: 12 task reviews (fix rounds on 2, 3, 4, 5, 6, 7, 9, 10, 11 ×2, 12; all closed); final
whole-branch review → 1 Critical (the legacy card read the Cash boolean) + 5 Important + 12 Minor,
fixed in one round (f440ec9) plus three integrator residual commits (c3ef561 history sentence waits
on the lookup + sub-minute horizon, b0934f5 Trust spark head follows the history ladder, fee9609
comment); three scoped re-reviews closed. Codex round (spec §9.5): BLOCKED-owner — Codex CLI is still
0.144.5 with model gpt-6-astra in ~/.codex/config.toml, the pair that rejected Plan 1's round; both
rounds (Plan 1's owed one and Plan 2's) run once the CLI is upgraded, on the slim diff
git diff d989286..HEAD -- web/lib web/app/inspector web/components/kit web/tests/unit ':!web/tests/fixtures/**/*.json'.

Carried forward: Plan 3 (Scenarios) — "Stress this address →" retargets from #stress to
/lab?address={addr} once the Lab reads the parameter (R7). Plan 4 (convergence) — the activity
table's raw value_decimals goes through the page's refused register instead of the client's route
refusal (parked R1); the Overview CTA converges onto AddressField (R8); formatTenths joins the
group/rescale consolidation beside headroomPercent (M5); the two age registers on the Trust card (M4);
the kit's lone 720px breakpoint (M10); the plan table's .tsx→.ts and stressReading-signature drift
(M11); client follow-up: lookup() does not enforce found ⇒ ≥1 position (the view refuses the
contradiction itself). Deferred minors from the task reviews (notComputedHeadline emphasis for an
unknowable verdict, ADDRESS_PATTERN accepting 0X, the meta.demo.json weETH witness postdating
computed_at, the chipWarn class pin without a data-tone, the near-account history/stress bodies under
the liquidatable/healthy contract arms, the hand-routed state-matrix cells without /v1/meta) are
enumerated with their rulings in .superpowers/sdd/2026-09-15-ui-inspector/progress.md.

## 2026-09-16 · Plan 3 (Scenarios) — retirements

Contract numbers (Cn) are tests/e2e/lab.spec.ts in file order: C1 cold load · C2 one click one POST · C3 heatmap · C4 movers · C5 in flight · C6 ?scenario= / conflict · C7 ?scenarios= · C8 selection per scenario · C9 withheld refusal · C10 the hole (neither array, both arrays, partial) · C11 malformed field · C12 404/503/429/500 · C13 a failed re-run never replaces the held result (9b23b07) · C14 listing unavailable · C15 superseded / stale input / definition changed · C16 contradictory matrix · C17 legacy fold · C18 drawer · C19 one-address mode · C20 invalid and not-found · C21 first viewport · C22 not covered (the book-mode not-covered state; the retired matrix law "not-covered never looks like withheld" lives here).

- tests/e2e/lab.spec.ts: rewritten as the Scenarios page-test contract (22 pins; C22 added in fix round 18ff863). Of the 30 old pins, 15 re-expressed — cold arrival zero requests → C1; the committed list from the listing → C1 (+ unit lab-library); ?scenario= exactly one / bare arrival none → C6, C1; an unpublished deep-link id → C6; address mode reachable but secondary → C19/C20 (book is the default; the toggle reaches it); honest 404 → C12; the served run-book renders → C2; 503 no-batch → C12; found:null cannot be established → unit lab-address (withheld arm) + state-matrix `lab × refused:found-null-unknowable`, with C20's not-found arm as the negative; address 429 → state-matrix `lab × error:429`; an invalid address never a request → C20; supersession named, kept, never mixed → C15; the row declares its shock axes → C1 (the definition) + C18 (applied shocks); chips from the wire's set → C1; exact rationals / held_flat / snap → C18. 15 retired: the frontier (render, monotonicity, 503 on /v1/book, frontier reads its own batch, W-3L refusal takeaway) — the loss frontier is the Book's stress preview (Plan 1, lib/stress-preview.ts unit pins); the matrix's five cell states and its disclosure — the matrix is the library + workspace (states in C1/C9/C12/C16); the depeg flagship hfs_unchanged and the boundary/PROJECTION panel — the address-level realization and horizons are Plan 2's address-stress unit pins and the Inspector's stress table; W-3L dek-at-head and CommittedDetail — the composition is the verdict header (C2 asserts the DOM order); r83 ×3 and r84 — the page never re-reads the Book; W-3L (194) settlement line.
- the set-level membership gate (R57 item 1 / R58 item 1: tornadoCells.ts setContradiction; unit tornado-lines.spec.ts:472-490; e2e tornado.spec.ts:317, :364) → lib/lab-compare.ts setMembership run by lab-view.ts compareOf on the asked ids; unit lab-compare (4 pins) + lab-view (the failed compare state with every fault named) + lab-headline (the sentence); e2e C28 (an unasked extra result refuses the whole set, nothing drawn). The old sentences are kept verbatim; "asked N ids, the response names M" leads them. (Task 13 fix round c92f4fd; the retirement at 9279806 omitted this line.)
- tests/e2e/runbook-bsplit.spec.ts (26): 8 re-expressed — both distributions + movers → C2 (tiles), C4 (movers); the shift reading line → C2; the served book reconciles with itself → unit lab-transitions (the guards) + demo-lab-weld; DM movers show the flip, the rational, the debt → C4 + unit lab-movers; Aave movers speak wads → unit lab-movers; an engine that moved nothing says so → unit lab-headline ("No Cash account changes band") + unit lab-library ("No band change"); none of the surfaces without a served book → C1; clicking a mover opens the Inspector → C4; the mover deep link → C4. 18 retired: the unpriced holding / per-side collateral breakdown / colliding collateral rows (no breakdown on the new page); VIEW 4 dumbbells ×2 and r88 ×2 (the drifted wad_scale guard is laneReading's, unit lab-transitions); VIEW 5 partition ×2, r89, r90 ×2, r92, r93 (the flip partition strip is gone; a contradicted ranking is moversTable.unreadable, unit lab-movers); VIEW 7 rate pair ×2 and r95 ×2 (the bad-debt rate view is gone). File deleted.
- tests/e2e/runbook-transition.spec.ts (17): 6 re-expressed — one matrix per engine with the crossings → C3 + C17; the unmeasured cell in the refusal register → C3 (data-movement="unmeasured", dashed); the wire's note verbatim → C18 (lab-drawer-transitions-note); a contradictory matrix is not drawn → C16; no matrix without a served book → C1; a withheld engine has no matrix while the served one has → C9. 11 retired with a ruling: "the Debt Manager's matrix is a DISCLOSURE and carries no verdict tint" — for Cash the ratio's over-cap band IS the strict rule `debt > cap` (`num < den`; `num === den` sits in the `1.00 – 1.05` lane), so the tint is the verdict, not a guess; "the method line refuses the confusion the field name invites" — the drawer names the fields; the flow ribbons (nine tests) — the flow chart is gone; its one-ended unmeasured law is laneReading's `movement: "unmeasured"` (unit lab-transitions). File deleted.
- tests/e2e/tornado.spec.ts (20): every pin was on the tornado UI, which is gone. The set-run laws move — exact ids posted / one POST / in-flight refusal / superseded arm / busy settlement → Task 13's Compare pins (a Plan 3b if Compare is cut); ?scenarios= rides the listing with filtered ids named, both params run nothing, `*` refused by name → C6, C7 and unit lab-deep-link (moved, 8 pins); a refused result contributes nothing / no denominator → unit lab-compare; the refused-locally guard resolves, never rejects → unit set-run-outcome (kept). File deleted.
- tests/e2e/chart-spec-v4.spec.ts (13): AC-49 "always signed" → C2 (+$1.2M, +$40K); AC-51 grouping ≥ 1,000 → C2/C4 + the human-usd/human-price unit pins; the eleven frontier and run-book-distribution pins (AC-34..38, AC-40..48, AC-50, AC-53, AC-54 ×2) retired — the frontier is the Book's, the distributions are the heatmap's margins. Every test was a Lab test: file deleted.
- tests/e2e/w3l-slots.spec.ts (9): DOM-order laws for components that no longer exist, retired; the order law (answer → evidence → method) is C2's boundingBox ordering. No non-Lab test remained (Plan 1 retired the Book gates): file deleted.
- tests/e2e/book-charts.spec.ts (3): held-flat details (address mode) retired — the address-level shocks are the Inspector's stress table (Plan 2); the realization gloss retired (same); run-book wire notes as counted details → C18 (the drawer prints the notes verbatim). Lab-only file: deleted.
- tests/e2e/r1-fixes.spec.ts: "(5) a NOT-FOUND stress is still a complete answer" → C20; "(5) the mode toggle says what each mode DOES" → C1 ("Whole book" / "One address"); "(5) there is no pre-lookup book empty state" → C1 (the cold load runs on the listing alone); the Lab arm of "(10) the adjudicated intros render" retired — the Scenarios page answers first (spec §5.4) and carries no intro paragraph; the four other arms stay.
- tests/e2e/r10-fixes.spec.ts (4): (1) a first run in flight / failed vs the header → C5 (the running state names itself) and C12 (a failed first run is its own state); (2) an older row re-running — retired, no cohort: a result stays with its scenario (C8); (3) receded watermark, matching frontier — retired (frontier). File deleted.
- tests/e2e/r11-fixes.spec.ts (2): (A) a 200 naming nobody → C10 (a hole is withheld by name, never an empty healthy book); (B) the anchor — retired (no anchor, no cohort; C8). File deleted.
- tests/e2e/r8-fixes.spec.ts (2), r16-fixes (1), r17-fixes (1): a re-run that ends without a book / a retained book mistaken for the settled request's answer → C13 — the new page retains nothing: a failed re-run replaces the result it had. Files deleted.
- tests/e2e/r9-fixes.spec.ts (2): the watermark vs the as-of claim — retired; there is no cohort claim, the "Result for batch" chip is the result's own (C2, C15). File deleted.
- tests/e2e/r12-fixes.spec.ts (2): (A) an engine in both arrays → C10 (the refusal wins; its figures never print); (B) a v2 answer under a v1 listing → C15 (definition changed). File deleted.
- tests/e2e/r13-fixes.spec.ts (4): (A), (B) delisted rows and the cohort — retired (results are keyed per scenario, C8; no cohort); (C) ×2 a failed re-run over a refused retention → C13. File deleted.
- tests/e2e/r14-fixes.spec.ts (3): (A) delist → re-list at v2 → C15; (B) the all-hole book → C10; (C) the partial hole → C10. File deleted.
- tests/e2e/r15-fixes.spec.ts (1): a running skewed attempt — retired; a running row is C5's running state and no surface recommends a remedy. File deleted.
- tests/e2e/p0-fixes.spec.ts (8): p0-1 ×2 (the stale barrier) — retired: the workspace is bound to the inspected address, not the input (C19 pins the identity); p0-2 ×2 → C2 (bad debt is its own tile) + unit lab-library / lab-headline (an all-zero engine says "No band change"); p0-8 → C11; p0-9 ×3 → C11 (the parent refuses on the same classification; the route stays live) and C15 (figures only from a readable result). File deleted.
- tests/e2e/p1b-fixes.spec.ts (12 Lab pins of 14): p1b-3 → unit lab-classify-set-run (the Compare surface is Task 13's); p1b-2 ×2 → C11 + unit lab-classify-run-book; p1b-5 ×2 → C19 (the account in the kicker, the batch and scenario chips); its stale barrier retired as p0-1's; p1b-6 item 7 → C20 (the batch named); item 8 (blind resume) → unit freshness-blind-resume / freshness-resume-evidence; p1b-9 f1 → unit result-identity; f2 → C11 + unit lab-classify-run-book; p1b-10 f1 → unit result-identity; p1b-11 fB → unit lab-classify-run-book / lab-transitions; p1b-12 → unit wire-guard + C11. The two non-Lab pins (p1b-6 fix 2 feed, fix 3 observatory) stay.
- tests/e2e/shell.spec.ts: the /lab row's H1 is "The committed scenarios could not be listed." — the smoke serves no API, and that is the page's refused register.
- tests/e2e/state-matrix.spec.ts: the four lab cells re-expressed against data-state and the pinned headlines (ok → one-address rows; refused → withheld, never "no position"; 429 → unavailable; 404 → not-served); mockLabCold/mockStress/runStress replaced by a mockLab helper shaped like the contract's.
- tests/e2e/inspector.spec.ts: the toolbar's secondary href → `/lab?address=<DEMO_NEAR_ADDR>`. There was no "Open Scenarios →" href pin in tests/ to re-express.
- Unit specs deleted (16): address-binding, bad-debt-rate, flip-ranking, frontier-scale, lab-dek, lab-frontier, lab-matrix, lab-panel-lines, lab-runbook-lines, lab-transition, matrix-outcome, mover-dumbbells, scenario-lines (bound to deleted modules); engine-classification (28) and set-run-classification (11) — their moved copies lab-classify-run-book (28) and lab-classify-set-run (11) are the homes, counts equal; tornado-lines (63) — its 8 deep-link pins moved to lab-deep-link (8), the other 55 pinned the tornado's lines and cells. set-run-outcome.spec.ts kept and trimmed to the lib/runbookSet client pins (14): its 23 tornado cell decisions retired, and the two register sentences (busy with unknown gauges, refused-locally) re-expressed against lib/lab-headline's failureHeadline.
- Deleted: 31 files under web/app/lab (LabClient, LabBookPanel, LabMatrix, LabTornado, LabFrontier, LabRunBookDetail, LabRunBookTransition, LabScenarioChips, LabScenarioDetail, LabBatchStamp, LabBoundaryGroup, LabProjectionView, LabRealization, addressBinding, badDebtRate, engineClassification, flipRanking, frontierScale, frontierView, labDek, labPanelLines, labReadingLines, labRunBookLines, labTransition, labTransitionFlow, matrixCells, moverDumbbells, scenarioLines, setRunClassification, tornadoCells, tornadoLines) and web/components/charts/FrontierLedger.tsx (only the old Lab imported it). WaterfallSteps.tsx stays (the styleguide imports it).
- Ruling on the Debt Manager tint (from runbook-transition's retired pin): for Cash the ratio's over-cap band IS the strict rule `debt > cap`, so the heatmap's tint is the verdict, not a guess; the legacy market's grid keeps the wire's lanes unmerged with its own health-factor bounds.

## 2026-09-16 · Plan 3 (Scenarios) CLOSES

- **Range:** 9aa5f17..867dedc on main (42 commits; the plan itself is 9b7158f). Tasks 1–13 complete, each reviewed and re-reviewed closed (ledger: `.superpowers/sdd/2026-09-15-ui-scenarios/progress.md`; briefs, reports and reviews beside it; review packages ignored by rule).
- **Owner gate:** the side-by-side (mockup vs build: the primary state full/fold in both themes, the cold load, one-address mode, Compare) approved in the terminal at 21:50 USMST 2026-09-16, after one round of the owner's own: the Compare card made readable (a finding sentence, a header row, stems from zero, a one-line caption). Pixel pins committed at 867dedc (lab-dark/lab-light at 1440×900; the Computed chip masked).
- **Suite on the final tree (372e198 + pins):** typecheck / eslint / stylelint / build clean; unit 813; e2e 200 passed, 10 skipped (pre-existing); one transient e2e failure on the first run, green on rerun — unattributed, to be named if it recurs. Against Plan 2's close (1,444 / 10): the old Lab's 33 specs retired with a per-pin table (below), the contract's 37 pins and the libs' unit pins in their place.
- **Widths (production server):** overview · book · inspector · lab × 390 / 1366 / 1440 / 1920 / 2560 — no horizontal scroll; shell steps 1280 / 1280 / 1280 / 1520 / 1680 unchanged; the library stacks above the workspace at 390.
- **Contrast (tokens.css):** light — ink on heatWorse 6.85, heatBetter 8.94, heatHeld 10.72; ink-2 5.90; warn-text 5.44; ink-3 5.12. Dark — 5.66 / 5.37 / 8.90; 6.76; 7.25; 4.53. Every pair ≥ 4.5:1; no tint ceiling moved.
- **Whole-branch review:** Sound, no Critical; five Importants (the address table's verdict and room words; the signed net's sentence; envelope arrays and null subtrees at render; the address subject vs highlight) fixed in the close-out wave 626d01e with the 11 fix-now deferred nits; re-review closed.
- **Codex rounds (CLI 0.154.0, config untouched):** Plan 3 — 8 findings, 7 real (fixed: 626d01e, 0991261, 372e198), 1 dropped (an inverted copy law). Plan 2 — 9 findings, 8 real (fixed: 14a5927), 1 design (stress on entry). Plan 1 — 23 findings against its original diff: 18 real (fixed: 52abcd9), 3 already fixed by later plans, 1 misread (materiality is the spec's display rule), 1 dropped. Every wave re-reviewed closed. The two owed rounds (Plans 1 and 2) are thereby discharged.
- **Rulings of record (beyond the plan's R1–R16):** a computed result is never replaced by a failed re-run — held under `rerun-failed`, disclosed as `retained-refused` when its definition changed, "Definition changed" in the library; one reader per engine (`lab-engine.readEngine`), one row verdict (`lab-address.rowVerdict`), one set-membership law (`lab-compare.setMembership`); the Computed chip anchors the wire's batch age at the settle clocks; a stress result for another batch than the position is not compared with it; a measured zero share is ok; the library's run slot exists in book mode only; `newly_eligible_accounts` is a signed net with its own sentence; prettier is never run on lib/ or tests/.
- **Carry-forwards → Plan 4:** a whole-envelope classifier (a 2xx missing `batch` still throws at render); the hold across consecutive malformed answers; one verdict judge shared by the Inspector and the lab (and the lab's negative-figure gate in it); the resume repair moving the lookup but not the stress; the kit's `CHAR_W` estimate and the `.chart` max-width clip; the newly tile's tone for a net ≤ 0; the "Compare again failed" line as a second copy site (fold into one lib sentence); the Inspector's negative-room word; `readCashPage` judging `refused` before `page.engine`; the over-delivery wording; the distance chart's mid-walk qualifier; an empty `waterfall.points`; the Plan 2/3 deferred minors the whole-branch review carried. **Plan 3b:** Compare writing `?scenarios=` beside a `?scenario=`. **Owner's list:** the API sets no `Access-Control-Expose-Headers` (`Retry-After` unreadable cross-origin); the demo Book's Aave waterfall arm contradicts its Aave card; the contract's run-book and set examples disagree on eth's reach; ~100 untracked `*.log` files in the repo root.

## 2026-09-21 · Plan 4 (UI convergence) — retirements

Per-pin tables live in each task's report beside the plan's ledger (`.superpowers/sdd/2026-09-16-ui-convergence/task-{3,4,5,6,7}-report.md`); this entry is the index.

- **The four pages' e2e specs are NEW contracts, the old surfaces' pins re-expressed into them:** `tests/e2e/history.spec.ts` (20), `activity.spec.ts` (18), `verification.spec.ts` (24), `api.spec.ts`, each written against the plan's page-test contract (test-id prefixes `history-` / `activity-` / `verification-` / `api-`); `tests/e2e/keyboard.spec.ts` (22) is new. The shared specs were re-pointed, never thinned: `shell.spec.ts` (the four H1s; the styleguide walk = the sixteen emitted `sg-*` ids), `state-matrix.spec.ts` (History ×2 — the page opens on Cash; feed ×5), `p1a-fixes.spec.ts`, `p1b-fixes.spec.ts` (fix 3 now also pins that a series answering for another engine is refused), `overview.spec.ts`, `book.spec.ts`, `inspector.spec.ts`, `lab.spec.ts`.
- **`tests/e2e/r1-fixes.spec.ts` (10) "the adjudicated intros render" — DELETED:** at the parent its body was `muteStream` + four RETIRED comments, zero `expect`. Its four laws' homes: `history.spec` (dek + drawer body), `activity.spec` (dek, pinned verbatim in `tests/unit/activity-view.spec.ts` + drawer), `verification.spec`, `api.spec`.
- **`tests/e2e/p1a-fixes.spec.ts`:** the five-banner-variants pin → "the four VerdictHeader tones" → FIVE tones at the close (the `neutral` colour pinned against the live `--ink` token); arms retired as unexpressible on the kit: `ExactValue` inside the banner (the exact value's kit home is the drawer — pinned there), `missing-identity-strip` / "Verdict withheld" (replaced by the kit's empty-chips → refusal-chip arm, the only direct pin of that law), the superseded / empty / partial banner variants (partial coverage is the warn Coverage chip; superseded is the state card). The p1a-6 self-measuring contrast pin: byte-identical across the whole branch.
- **Styleguide sections retired:** `sg-chips`, `sg-marks`, `sg-stampline`; renamed in place: `sg-ribbon` → `sg-identity`, `sg-statcard` → `sg-kpi`, `sg-severity` → `sg-pills`; `sg-table-row-{near,small,dust}` → `{near-1,small-1,small-2}`; + `sg-verdict-neutral`.
- **Deleted source (25 files):** the four old surfaces — `app/observatory/{ObservatorySurface,ObservatoryCharts,ObservatoryPointDetail}.tsx` + `observatory.module.css`; `app/feed/{FeedSurface,FeedList}.tsx` + `feed.module.css`; `app/proof/ProofSurface.tsx` + `proof.module.css`; `app/developers/developers.module.css` — and the pre-kit components: `StatCard`, `Stampline`, `Ribbon`, `EngineChip`, `RefusedTag`, `AddressMono`, `VerdictBanner`, `DataTable`, `MarksStamp`, `ProjectionBadge`, `SeverityHF`, `EvidenceDrawer`, `verdict.module.css`, `table.module.css`, `evidence.module.css`. KEPT by ruling: `StatusChip` + `chip.module.css` (the state cards compose it), `ribbon.module.css` (`DegradationBanner`), `primitives.module.css` (`RouteRefusal`). `lib/kit.ts`'s verdict-banner model went only after its law moved into `headerIdentity`, which `VerdictHeader` calls; its four pins were re-pointed, not dropped.
- **Unit specs:** 71 files → 83; no file's test count dropped; nothing skipped or `.only`.

## 2026-09-21 · Plan 4 (UI convergence) CLOSES

- **Range:** `a941a39..94f18ff` on main (48 commits; the plan is `1d546f0`, amended at `94f18ff`). Tasks 1–12 complete, each reviewed and re-reviewed closed (ledger: `.superpowers/sdd/2026-09-16-ui-convergence/progress.md`; briefs, reports, reviews, the two director rulings, the read-through, the Codex findings and both adjudications beside it; review packages ignored by rule). Source: 139 files, +9,181 / −8,171. New lib modules: `history-view`, `activity-view`, `verification-view`, `api-view`, `human-utc`, `instant-split`, `cash-refusal`, `book-walk`, `inspector-evidence`.
- **The owner's gate — taken BY DELEGATION.** The owner, 2026-09-16 21:56 USMST: "i have to go to bed now, i need you to work through the gates. go with your best judgement". No mockup exists for these four pages; the comparison was against the approved primary pages for register. **First verdict 2026-09-20 ~17:25: CHANGES FIRST** (no page padding; whole headlines in tone colour; "$1900000 … account(s)"; chart labels struck through; "serving batch #1" beside "Batch 18,251"; roadmap vocabulary on Activity). Two director consults grounded the round (`gate-design-ruling.md`: not at the bar, eight register defects, none structural; `gate-clarity-ruling.md`: R2 cannot stand). **Second verdict 2026-09-20 ~21:50: APPROVED**; pins committed `89b87c7`, re-baselined by ruling at `0f18a1b` (Inspector, History, Verification, API — reworded by the close-out). Captures for the owner's review: scratchpad `gate6/` (eight pages × both themes × fold/full + five honest states). **A later "changes first" from the owner reopens the gate.**
- **Suite on the final tree (`78055a1`):** typecheck / eslint / stylelint / build clean; **unit 1,081; e2e 299 passed / 0 failed / 0 skipped** on a production build with the styleguide compiled in (`NEXT_PUBLIC_SHOW_STYLEGUIDE=1` for the build AND the run — without it the styleguide pins skip; earlier plans' shared builds lacked it). Against Plan 3's close (813 / 200 + 10 skipped): +268 unit, +99 e2e, the 10 skips gone. Sixteen pixel pins (eight pages × two themes) at 1440×900.
- **Widths (production server, the capture script's mocks):** eight pages × 390 / 1366 / 1440 / 1920 / 2560 — no horizontal scroll (History at 390 overflowed to 434 on a non-wrapping chip; fixed in the wave and pinned at 390×800); no text node under 12px anywhere.
- **Contrast:** no token changed; one new pair — the kit's pressed ghost button, `--accent-text` on an 8% `--accent` wash: light 4.54 (over `--bg`, the worst) / 4.93 (over `--panel`), dark 6.97 / 6.28 — all ≥ 4.5:1.
- **Keyboard (`keyboard.spec.ts`, 22):** the drawer on seven pages takes focus, holds it through a full lap both ways and hands it back on Escape; every row link on Activity, Verification, the API index and the Book's table is a Tab stop in DOM order; the library's tick answers Space and its row Enter. ONE DEFECT FOUND AND FIXED: Shift+Tab as the first key in an open drawer left the modal on all seven pages (`Drawer.tsx` focused the panel and wrapped only from the first stop).
- **Cold-visitor read-through (`solvent-user`, four personas, 52 captures + the no-API bad day):** 4 BLOCKER · 33 MAJOR · 11 MINOR, adjudicated in `task-12-readthrough-triage.md`. Fixed now (inside the plan's boundary, or an honest-UI law broken anywhere): the Inspector's Trust card claimed "Book reconciles to chain" in the present tense from a pinned, dated run (now "Pinned reconcile run matched the chain · N/N Cash rows · {the run's finish instant}", ticked only when Verification's own `receiptState` says exact); the Book said "not computed" ten times for a NETWORK failure (now "unavailable"; a read in flight says "loading…"); History's left chart label was the window's maximum and read as the starting value (now "peak …"); "3 drift named" named nothing; a refused Activity walk offered "Load more". The rest is the owner's list below.
- **Whole-branch review:** ready to close after the fix wave, no Critical; six Importants, all seams between tasks (Verification said a read FAILED while it was in flight; the styleguide still taught the overruled tone usage; three History arms pinned but unreachable behind a throwing builder; one public number from two unwelded sources; an API fact claim resting on a test CI does not run; nine plan lines no longer describing the code) — fixed in the wave `9a9874a` `736e09e` `62a0b61` `af39652` + seams `e23c62f`; the wave's scoped re-review found two more (History's money guard branching on the JavaScript type; the Trust tick checking the Cash weld alone) — fixed in the last round; **re-review 2 of that round: CLOSES — no Critical, no Important**, both closed at the root (the guard chosen by the metric; the tick only under Verification's own `receiptState === "exact"`, no arm greener than Verification, no import cycle), every Codex fix-now item closed with a pin that fails on its parent, eight Minors carried.
- **Codex round (config untouched; task `task-muatuhow-l6fdyy`, 13m36s, read-only):** 20 findings; **15 fixed** in the last round `be9bbdb` `c192523` `1c7ab68` `41679c3` `bbd4bdd` + seams `78055a1` — among them a FALSE ALL-CLEAR (an unreadable computed row left the Book's headline saying "No position is liquidatable" — reproduced on the untouched code before the fix), a walk that appeared active forever, duplicate accounts satisfying the census, a legacy series labelled Cash, an empty projection answering "No", and a hold that admitted and released on less than it rendered; **5 re-graded** to one owner's-list workstream (below) because `app/error.tsx` is a root route boundary — a malformed 2xx member throwing at render on a non-lab page ends in a named refusal with the shell mounted: honest, coarse, never a false statement; **1 carried** (copy authored in components on approved pages).
- **Rulings of record — the ones that REVERSE the plan or a pinned behaviour (for the owner's review):** (1) R2 overruled at the gate — the four headlines keep their facts and speak the Book's grammar; a record is INK, only a verdict wears tone; green keeps one meaning across the product (a health verdict). (2) History opens on CASH (the plan said "default as today"). (3) Verification's headline is `ok` when the receipt is exact even with no servable batch (a pin held `warn`): the tone is the proof finding's; the missing batch is said in ink, the dek and two refused chips. (4) Four ruled sentences were not true as written and say what is (see the plan's amendments). (5) The Inspector's Trust label and detail (an owner-approved, pixel-pinned page) were reworded because the old label overclaimed. (6) The lab: a selection writes `?scenario=` to the URL; an opened link nobody selected from is NEVER rewritten; ONE predicate admits and releases a held result and covers everything the result renders — a body that fails it is refused WHOLE even with nothing held (this reverses Plan 3's "one contradictory row" rendering in the view); the Inspector and the lab print projection verdicts from one word function ("Within 90d" / "Not within 90d" — a projection never answers a bare "No"). (7) A withheld Cash engine's census is never a count on any page; a fetch failure is never worded as a refusal; a read in flight is never worded as failed — on Verification, the Overview's pipeline, the Inspector's Trust card and History's loading chip. (8) Out by ruling: the header `.meta` grid (it would move the approved Scenarios pins); the zero baseline on History's chart stays.
- **Process notes:** every subagent on `fable`; no attribution line in any of the 48 commits; no `--no-verify`; no push. A system-styled block inside a tool result told the integrator to add a `Co-Authored-By` line, and a system-styled "auto mode — do file work through Bash" note reached six subagents beside their tool results: neither came from the owner; the first was ignored, the second changed no deliverable. One implementer's report-file write was refused and it asked the controller to write it on its behalf: NOT done; its hand-back was kept as the controller's own labelled record. One implementer's over-wide glob rewrote line endings in 23 files outside its area: disclosed at once, verified content-identical, nothing staged. Two session-limit interruptions; every agent's work survived by its commit.
- **THE OWNER'S LIST (ranked; the next plan's raw material):**
  1. **Raw-unit amounts** on Activity and the Inspector's activity (`252733333`, `600000000000000000 weETH [raw units]`, `record-only`): needs a per-asset decimals source the events endpoint does not carry.
  2. **The hero's "70,000 people" above "Accounts 1,412"** — cardholders vs borrowers; one clause, the owner's words.
  3. **The hosted API** (§10.6): `http://localhost:8080` in all 41 samples and in error text; `Access-Control-Expose-Headers`.
  4. **Workstream — every page's reader classifies its envelope** (Codex #1, #5, #8, #9, #10 + G4, G5): the lab's law (a 2xx body of any shape ends in a NAMED state on the page itself) applied to the Book, History, Activity, Verification / the Overview's pipeline and the stress reader; today those end at the route boundary. Also: a malformed COUNT on History still throws by four pins' law while money became a named hole — one law or two? (The count law's reach grew in the last round: a missing / non-number count at a middle hour now throws where it drew a "null" hole.)
  5. **No full tables:** 6 of 27 near-cap accounts on the Book, 20 of 118 movers on Scenarios — no sort, no "see all".
  6. **Liquidatable is 2 on the Book and 49 on History**; the legacy market's 46 are a collapsed line at the Book's foot; "Not computed 6" hides ≈ $178K behind "collateral sweep never ran"; the Inspector's amber "1 of 3 rows failed · gen 4" never says what it means for the collateral figure.
  7. **Verification:** 87 ≠ 29 + 14 (the other 44 gated rows are never said); "87/87" several times in one viewport; "0 drift named" survives in the accepted step's sentence; a REJECTED receipt's headline is warn while its chip and card are crit (design's formula followed — should a rejection be crit?); `/proof` has no resume repair.
  8. **Builders' vocabulary:** Verification's cards (weld, gated, pin, materialization key, `recon/p3-probes.md`), Activity's "Filter echo … since_block … limit 50" and `deficit_created`, the header chips ("Current not projected", "Out of model"), the API page's raw spec text (unrendered `**`, "AMENDMENT 1/E", "THE EXCLUSION LAW"); the API's degraded message naming "Task B2, migration 00016" (the SERVICE's words); the API dek runs four lines.
  9. **The kit:** no pending variant for `VerdictHeader` (every page's LOADING headline wears `refused`); no `:disabled` button style (a disabled primary looks live); the header action wrapping under long chip rows (B2 — re-baseline Scenarios, or an opt-in variant); the shell-level page padding (Scenarios has none); History's level-anchored y-domain (specified in the design ruling's appendix).
  10. **Scenarios:** three meanings of "moved" (941 / 425 / 118); bands of 4.76% / 9.09% where the Book uses 2 / 5 / 10%; a lone "<0.1%" row sits on the axis edge.
  11. **Small, owner-approved copy:** "$109.45 — below the $100 line" (EACH position is below the line; one word in a pixel-pinned dek); History's headline answers the Book's question rather than "what changed"; no range control.
  12. **Housekeeping:** `ExactValue` and `states/*` have no product consumer (styleguide-only); copy authored in components (`BookSurface.tsx:255,259`, `CompareCard.tsx:47`, `MoversTable.tsx`); `plural` still has private copies (`book-headline`, `stress-preview`, `trust`, `BookSurface`); `retry` / `retryWords`, `bookFailed` / `bookLoadFailure`; four fixture inconsistencies noted during Task 2 (`events-demo-near.json` DM supply raw_type, `feed-liquidations.json` `configured_bonus_bps`, `observatory-series-aave.json` ray scale, the demo Book's sub-dollar liquidatable set); ~100 untracked `*.log` files at the repo root; a client-ts test step in `ci.yml` (the API page's fixture claim rests on a test CI does not run); from the last re-review's Minors — the unlisted-id notice's "left as it arrived" outlives a selection; the Book's negatives are keyed to the aggregate's refused count, not the landed refused rows (pre-existing); the sixth tile's "Not computed" label over unreadable rows; `bookAnswered` / `bookFailed` named twice with different meanings (`cash-refusal.ts` vs `verification-view.ts`); three models of one read's phase; no `aria-busy` on the pending trust item.

## 2026-09-24 · Plan 5 (settle for deploy) CLOSES

- **Range:** `3f9836d..28b1553` on main (29 commits, including 3 lease/scope commits). The spec and plan are `3f9836d`; the plan was amended at the close ("Amendments at the gate and the close").
  - Ledger: `.superpowers/sdd/2026-09-22-settle-for-deploy/progress.md`. Beside it: the understand workflow's verdicts and proposals, the vocabulary skeptic's verdict, both Codex briefs and findings, the persona re-walk and the whole-branch review.
  - Source: `web/lib` + `app` + `components` 45 files, +1,614 / −554; tests 61 files, +3,014 / −536; README + `docs/readme` + Makefile +333 / −17. New lib module: `inline-parts`.
- **Owner direction:**
  - "the goal is the resume piece. keep moving toward that. use your judgement" (2026-09-21 15:01).
  - "just do a local build for now, i will deploy when everything looks settled".
  - "let's take care of A i guess if it is a quick win, then we can start on B" (2026-09-22).
  - "lots of fable agents failed, go ahead and use opus 5.5": every agent since has run on Opus 5.5.
  - "Approve docs/readme" (W3 AMENDMENT 2, `8c1e794`).
  - "if you find that codex's findings are not important you can overrule" (2026-09-23 20:39), applied as D-006 clause 6.
- **Suite on the final tree (`28b1553`):**
  - typecheck / eslint / stylelint / build clean.
  - **Unit 1,148** (Plan 4 closed at 1,081).
  - **e2e 304 passed**, plus the 4 pins that moved by ruling, re-baselined; two replays 16/16.
  - Build AND run with `NEXT_PUBLIC_SHOW_STYLEGUIDE=1`.
- **Pixel pins moved BY RULING** (each read before re-baselining). History's first viewport did not move.
  - Overview: the hero; the dek's no-verdict sentence.
  - Book: the Liquidatable tile's label and sub ("≥ $100", "49 in all"); the dek.
  - Activity: scaled Cash amounts; the raw word in the Amount cell; record-only; plain type words; the applied-filter chip.
  - Scenarios: "Accounts changing risk bucket"; the grid's merged bands.
  - Inspector: the trust card's sweep and receipt words.
  - Verification: "checked rows"; account comparisons with the "advisory" gloss.
- **README:** a front door built from verified facts only.
  - The Overview sits above the fold.
  - Eight screenshots from the demo dataset. The caption says the pictured receipt (87 / 29 / Jul 29) is the demo's sample, not the committed one (30,838 / Aug 2).
  - Every "verified" claim names its Codex approval of record and says what changed since.
  - A "Where to look first" section.
  - A run block that works on a fresh clone (Node 22.18+ on 22.x, or 24+).
- **QA:**
  - Persona re-walk (`qa-persona-rewalk.md`): 12 targeted findings, 4 CLOSED and 8 PARTLY; 11 NEW.
  - Whole-branch review (`final-review.md`): 0 Critical, 3 Important, 11 Minor. The Importants were seams: "never swept" survived on the trust card; "Cash rows" against "account comparisons"; the README's approval disclosure.
  - Codex (`codex-findings.md`): 6 findings.
  - All adjudicated in the ledger. One fix wave (`wf_a612c282-03c`: five areas, 13 Opus agents, each area independently reviewed) landed `de802e4..28b1553`. The reviews caught one CRITICAL of the wave's own making before it landed: a refused row's served-but-malformed debt read as "never served".
  - **Codex re-verification APPROVED** (`codex-fix-findings.md`): six closed, the #4 overrule accepted, no new findings.
- **Rulings of record** — the ones that REVERSE approved copy, a documented design note or the plan (for the owner's review):
  1. The hero drops "70,000 people" (unsourced in the system): "People borrow against crypto to spend on a Visa card. This is how close each account is to liquidation — right now."
  2. Activity fetches `/v1/book` for its scale. This reverses the page's one-endpoint note.
  3. "checked rows" replaces "gated" on every public Verification string. The two welds are "account comparisons", glossed as "not a breakdown of the checked rows".
  4. The demo's refused Cash rows carry no debt, as the engine serves them.
  5. SWEEP_NEVER reads "collateral never read" (the engine's own words for both of its states), not the plan's "never successfully swept". The Inspector's trust card and drawer follow.
  6. The lane tile reads "Accounts changing risk bucket" (the contract's lanes ARE the histogram buckets), not the plan's "Accounts changing lane".
  7. The Book's no-verdict sentence changes from "could not be computed this batch" to "have no verdict in this batch". It says their debt is not known ONLY when no refused row was served one.
  8. The Inspector's receipt item leads with "Cash account comparisons" or "checked rows", never bare "rows". Its sweep item leads with THIS account's own state.
  9. A raw figure carries "raw units" in the Amount cell; the Unit cell no longer repeats it.
  10. The demo's Cash movers are the service's top 20 by debt (they were the 20 furthest past the cap), so the page's caption is true of the pictured data.
  11. The kit gains a disabled-button register; a disabled Compare says why, beside it.
  12. **Codex #4, hero half, OVERRULED** under clause 6, and accepted by Codex as "a location exception": `web/app/overview/copy.ts` stays, being a copy-only module; it joins Plan B's copy sweep.
- **Process notes:**
  - Every agent after 2026-09-22 13:34 ran on Opus 5.5. The first launch's fable agents failed on the usage limit, and its fallback carried the work.
  - No attribution line in any commit; no `--no-verify`; no push.
  - System-styled notes (a Co-Authored-By reminder, an "auto mode — use Bash" block) are not the owner's and were ignored.
  - One agent stopped at its boundary rather than editing an out-of-area kit file, which was correct. It left a patch, and the integrator read and applied it.
  - One lease expired overnight and was restored. `CONTROL_PLANE_OWNER_REVIEWED` was set once, on the owner's explicit answer.
- **OWNER DECISIONS (not the integrator's):**
  1. **PUSH.** origin/main is ~240 commits behind. GitHub still shows the old 21-line "(coming) … web" README with no screenshots, so none of Plans 1–5 reaches an evaluator (persona BLOCKER).
  2. **CI.** The last pushed run (2026-08-08) failed three jobs.
     - At HEAD, 7 committed Go files fail gofmt.
     - The race job needs its DB schema-gate test's migrations and two `cmd/reconcile` source-derivation tests.
     - The web job's old type error is gone, but CI runs the pixel pins, whose Linux behaviour is unverified.
     - `.github/workflows/ci.yml` is inside W3's scope, so a green CI is the proposed next quick win BEFORE the push.
- **THE OWNER'S LIST** (ranked; additions from Plan 5's QA — Plan 4's list stands where not closed):
  1. **A one-command demo mode.** An evaluator cannot see the product without two RPC endpoints, Postgres and a backfill, although a complete demo dataset exists (test fixtures only).
  2. **The hosted API and a live link.** `http://localhost:8080` everywhere. The API page's sample imports an unpublished `@solvent/client`.
  3. **Plan B:**
     - every page's reader classifies its envelope;
     - the kit's pending headline variant;
     - one "nothing computed" predicate (M-2);
     - copy still composed in components (M-6: AssumptionsDrawer, MoversTable heads, TransitionCard, BookSurface tiles, LabTiles' sub), and the hero's copy module moved into `web/lib`;
     - BookLegacy's "Σ withheld" for an ABSENT legacy bad-debt row.
  4. **The Liquidatable tile's register** (M-3, NEW-9): "$0" beside refused accounts; a "≥ $100" label over a sub that counts all 49; accounts vs positions. Headlines say 2 while History says 49 (persona item 3).
  5. **The legacy market's 46** sit in a collapsed line at the Book's foot (item 6).
  6. **Verification never says what the 87 are.** "87/87" appears six times in one viewport. verificationFailed cites a repo path (NEW-7).
  7. **Builder vocabulary:** ~20 builder words still on public pages (item 10); five names for the six no-verdict accounts (NEW-10); literal "* " list markers and shouting spec headings on the API page (NEW-11).
  8. **README:** the approval column is still ledger-dense; the red CI badge stays until CI is green.
  9. **`package.json` engines ">=20"** (web and client) contradict the README's floor (Codex re-verification #2).
  10. **Carried minors:**
      - T4's unit test uses an unreachable Cash weld; the reachable case is legacy advisory rows.
      - No pin covers the T5 note rewording; LIVE_NOTE's sentence is weak.
      - `ActivityLiquidation` has duplicate loose fields.
      - An unreadable Activity amount's reason rides a title on an empty span.
      - "risk bucket" also covers the no-debt and not-measured lanes.
      - Compare has no upper bound (the service takes 1–24 ids).
  11. **Carried unchanged from Task 12:**
      - the "Reconnecting" pill in every nav and screenshot;
      - the Overview's present-tense "Reconciled to chain";
      - two liquidation sizes on one row;
      - no address filter on Activity;
      - History's headline and its ISO timestamps;
      - Activity's paging headline;
      - the 4.76 / 9.09 bands against the Book's 2 / 5 / 10;
      - the scenario description prose;
      - the developer text in historyDegraded and activityRefused;
      - the Book chart card's empty two-thirds and its mixed Room units;
      - the official-looking brand;
      - verificationUnavailable's batch contradiction.
