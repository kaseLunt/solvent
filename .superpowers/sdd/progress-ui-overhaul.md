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
