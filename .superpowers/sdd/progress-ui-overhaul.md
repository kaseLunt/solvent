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
