# Settle for Deploy Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what an evaluator sees in the first three minutes — the repo's README, the numbers that disagree, the Book's hidden near-cap rows, builders' vocabulary, raw Cash amounts, a live-looking disabled button — with no backend, contract or calculation change.

**Architecture:** Every change is wording or presentation over data the pages already hold, decided in `web/lib` view models (components compose nothing) and pinned by unit specs on the lib plus e2e specs on the page. Five implementation areas own disjoint files and run in parallel; the integrator then sweeps one cross-area phrase, builds once, runs the whole suite, re-baselines the pixel pins that move by ruling, and runs QA, the whole-branch review and a Codex round.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, CSS modules on `app/tokens.css`, `@solvent/client`, Playwright (unit project in node; e2e on a production build at :3111).

**Spec:** `docs/specs/2026-09-22-settle-for-deploy-design.md` (read it first; §2 is the item list, §3 what is out, §6 the rulings). Evidence: `.superpowers/sdd/2026-09-22-settle-for-deploy/understand.json` (seven verified reader reports: current strings with file:line, the pins that weld them, pixel impact) — every task below names its reader section; READ IT before writing.

## Global Constraints

- No backend, contract (`api/openapi.yaml`), client (`packages/client-ts`) or calculation change. No edits to `roadmap/VISION.md`.
- Honest-UI laws: a refused / withheld / absent / unread value never renders as zero, "No" or absence; a fetch failure is never a refusal; Cash (`debt_manager`) and the legacy Aave market (`aave_v3_etherfi`) are never summed, compared in one figure or put on one axis; wire values pass their guards (`isWireDecimal`, `isWirePopulation`, `readWirePopulation`, `wireBigInt`, `isWireScale`) before arithmetic; copy lives in `web/lib`, components compose nothing; a page claims only what the system backs — verify every new fact against code, contract or Go source before wording it.
- Comments state the law the code keeps — never a task, round, review, plan or tool name.
- Pins are re-pointed, never deleted; the unit test count never drops. A pin that welded an old sentence is re-expressed against the lib function's output AND one literal for the demo arm.
- Pixel pins (`web/tests/e2e/screenshots.spec.ts`, 1440×900 VIEWPORT only, both themes) are re-baselined only by the integrator, only after reading the new capture; implementers NEVER pass `--update-snapshots`.
- Never run prettier on `web/lib/**` or `web/tests/**`. Commit by pathspec, staged by name (never `git add -A` / `git add .`), `python roadmap/tools/scope_gate.py` first, no `Co-Authored-By` or any attribution line, never `--no-verify`, never push.
- Implementers run unit gates only (from `web/`: `npx tsc --noEmit`; `npx eslint app lib components tests`; `npm run lint:css` when CSS moved; `npx playwright test --project=unit`), write their e2e pins, and do not build, start or kill anything on :3111.

---

### Task 1: Overview hero and the Book's figures (area B, part 1)

Reader: understand.json "Overview hero" + "numbers" (a), (d).

**Files:**
- Modify: `web/app/overview/copy.ts:3-4`, `web/lib/materiality.ts:75-86`, `web/lib/cash-summary.ts`, `web/app/book/BookSurface.tsx:105-118`
- Test: `web/tests/unit/materiality.spec.ts`, `web/tests/unit/cash-summary.spec.ts`, `web/tests/e2e/overview.spec.ts:24-26,56`, `web/tests/e2e/shell.spec.ts:13`, `web/tests/e2e/book.spec.ts` (the tile and dek assertions, incl. :750)

**Interfaces:**
- Produces: `liquidatableTileLabel: string` (= `"Liquidatable · ≥ $100"`, composed from `MATERIAL_LINE_USD`) and `liquidatableTileSub(summary: CashSummary, boundNote: string): string` in `web/lib/cash-summary.ts`; `belowLineSentence` keeps its signature.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/materiality.spec.ts
test("the $100 line is per position: the below-line sentence never places the sum under it", () => {
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: 109_450_000n }, 6)).toBe(
    "47 more positions are technically liquidatable, each under the $100 line — $109.45 together — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 1 }, { belowLine: 4_620_000n }, 6)).toBe(
    "1 more position is technically liquidatable, under the $100 line — $4.62 — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 0 }, { belowLine: 0n }, 6)).toBeNull();
});

// web/tests/unit/cash-summary.spec.ts — build the summary with the file's existing helper for a WHOLE walk
test("the liquidatable tile states the partition's total only over a book read whole", () => {
  expect(liquidatableTileLabel).toBe("Liquidatable · ≥ $100");
  expect(liquidatableTileSub(wholeSummaryWith({ material: 2, belowLine: 47 }), "")).toBe("2 accounts · 47 more under $100 · 49 in all");
  // mid-walk: no total is claimed; the bound note keeps its place
  expect(liquidatableTileSub(walkingSummaryWith({ material: 2, belowLine: 47 }), " · lower bound, walking")).toBe(
    "2 accounts · 47 more under $100 · lower bound, walking",
  );
});
```

- [ ] **Step 2: Run them — expect FAIL** (`npx playwright test tests/unit/materiality.spec.ts tests/unit/cash-summary.spec.ts --project=unit`): the old sentence; `liquidatableTileSub` not exported.

- [ ] **Step 3: Implement.** `belowLineSentence` returns the two strings above (plural / singular arm). In `cash-summary.ts` export `liquidatableTileLabel` from `MATERIAL_LINE_USD` and `liquidatableTileSub(summary, boundNote)` = `` `${plural(material.count, "account")} · ${belowLine.count} more under $${MATERIAL_LINE_USD} ${summary.whole ? `· ${groupInt(material.count + belowLine.count)} in all` : ""}${boundNote}` `` (write it without the stray space; the whole-walk clause only when `summary.whole`). `BookSurface.tsx` prints both from the lib (the component composes nothing). `copy.ts`: `HERO_H1_LEAD = "People borrow against crypto to spend on a Visa card."`, `HERO_H1_TAIL = " This is how close each account is to liquidation — right now."`.

- [ ] **Step 4: Re-point the e2e literals** (`overview.spec.ts:24-26,56`; `shell.spec.ts:13`; `book.spec.ts` tile label, sub and dek incl. :750) to the new words, asserting the lib output where the spec already imports the lib.

- [ ] **Step 5: Unit gates** (tsc, eslint, unit project — read the FULL failure list). Expect PASS.

- [ ] **Step 6: Commit** — `git commit -m "fix(web): the front door's hero claims no unsourced figure, the Book states its liquidatable total and the $100 line per position" -- <paths>`

### Task 2: The Book's hidden rows, the legacy finding, the demo's refused rows (area B, part 2)

Reader: understand.json "Book" (a), (b), (c-ii).

**Files:**
- Modify: `web/lib/cash-summary.ts` (toggle labels), `web/app/book/NeedsAttention.tsx:75-120`, `web/lib/cash-view.ts:429` (`summaryLine`), `web/tests/fixtures/demo/generate-demo.mjs` (`refusedRow()`), regenerated `web/tests/fixtures/demo/positions-dm-demo-page-1.json` / `-2.json`
- Test: `web/tests/unit/cash-summary.spec.ts`, `web/tests/unit/cash-view.spec.ts`, `web/tests/e2e/book.spec.ts` (+ a new near-cap fold test), the demo weld specs under `web/tests/unit/demo-*.spec.ts`

**Interfaces:**
- Consumes: Task 1's `cash-summary.ts` exports.
- Produces: `nearCapToggleLabel(hidden: readonly SizedCashRow[], decimals: number): string` and `belowLineToggleLabel(count: number, sum: bigint, decimals: number): string` in `cash-summary.ts`.

- [ ] **Step 1: Failing tests**

```ts
// cash-summary.spec.ts
test("the near-cap fold names the rows it hides and their debt — never 'all N', which would claim a total mid-walk", () => {
  expect(nearCapToggleLabel(rowsWithDebts(21, 622_000_000_000n), 6)).toBe("Show 21 more near-cap accounts ($622K)");
  expect(nearCapToggleLabel(rowsWithDebts(1, 12_000_000_000n), 6)).toBe("Show 1 more near-cap account ($12K)");
  expect(belowLineToggleLabel(47, 109_450_000n, 6)).toBe("Show 47 small & dust positions ($109.45)");
});
// cash-view.spec.ts
test("the legacy fold's line is the market's own finding over computed positions; never a negative over nothing computed", () => {
  expect(deriveLegacyView(legacyWith({ positions: 8552, computed: 8552, liquidatable: 46, refused: 0, debt: DEMO_LEGACY_DEBT }))?.summaryLine)
    .toBe("Legacy · Aave v3 market — 46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused");
  expect(deriveLegacyView(legacyWith({ positions: 3, computed: 0, liquidatable: 0, refused: 3 }))?.summaryLine)
    .toBe("Legacy · Aave v3 market — 3 positions · $1.9M debt · 3 refused");
});
```
(Use the specs' existing builders; add `rowsWithDebts` / `legacyWith` helpers in the spec if none exist. `DEMO_LEGACY_DEBT` = the demo book's legacy `total_debt`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `NeedsAttention`: `nearShown = near.slice(0, Math.max(0, DEFAULT_ROWS - material.length))`, `nearHidden = summary.nearCapRows.slice(nearShown.length)`; a second `SmallToggle` (`testId="book-near-toggle"`, label from `nearCapToggleLabel`) appends the hidden near rows in room order after the shown ones; the collapsed table renders exactly today's rows. The dust toggle's label comes from `belowLineToggleLabel`. `summaryLine` (served, not withheld): computed > 0 → `` `Legacy · Aave v3 market — ${liquidatable} of ${n(computed)} computed ${computed === 1 ? "position is" : "positions are"} liquidatable · ${debtWord} · ${refused} refused` ``; computed === 0 → `` `Legacy · Aave v3 market — ${n(positions)} positions · ${debtWord} · ${refused} refused` ``. `generate-demo.mjs` `refusedRow()`: `total_debt: null` (a refusal is the absence of a number — `internal/risk/assemble.go`); update its comment; regenerate with the generator's own command (read its header) and run every demo weld spec.

- [ ] **Step 4: e2e** — `book.spec.ts`: the new fold (collapsed row count unchanged; toggled: +21 near rows, room order); the refused rows' Debt cell reads "—"; the comment that said "with its debt" re-worded.

- [ ] **Step 5: Unit gates.** Expect PASS.

- [ ] **Step 6: Commit** — `git commit -m "fix(web): the Book shows the near-cap rows it hides, the legacy fold states its own finding, the demo's refused rows carry no debt as the engine serves them" -- <paths>`

### Task 3: Verification's receipt in one vocabulary (area C, part 1)

Reader: understand.json "numbers" (b), (c), (f) + "vocab" (Verification rows).

**Files:**
- Modify: `web/lib/verification-view.ts` (`INDEX_SENTENCE` :274, the Compute sentence, the Verify tile sub and sentence :445, the receipt strip, the proof card rows :507-551, the probes qualifier :679-680), `web/lib/evidence.ts` (drawer twins :877-880, :902, :922-936; :124 "Proof Center")
- Test: `web/tests/unit/verification-view.spec.ts`, `web/tests/unit/proof-evidence.spec.ts`, `web/tests/unit/inspector-evidence.spec.ts:37`, `web/tests/e2e/verification.spec.ts`, `web/tests/e2e/state-matrix.spec.ts` (proof cells), `web/tests/e2e/overview.spec.ts` (pipeline line if its words change)

**Interfaces:**
- Consumes: nothing new. Keeps `pipelineSteps` and `receiptState` signatures; the Overview reads `pipelineSteps` — if its served `line` must change, change it deliberately and list it (the Overview pin is below its fold for the pipeline).

- [ ] **Step 1: Failing tests** (build views with the spec's existing `deriveVerificationView` helpers over `EVIDENCE_MANIFEST`):

```ts
test("one word for the receipt's rows: checked rows; the welds are account comparisons, not a breakdown", () => {
  const v = view(EVIDENCE_MANIFEST);
  const rows = v.proof.rows.map((r) => `${r.label} | ${r.value}`);
  expect(rows).toContain("checked rows | 87/87 exact · 0 drifted");
  expect(rows).toContain("Cash · accounts compared | 29/29 exact");
  expect(rows).toContain("Aave v3 market (legacy) · accounts compared | 14/14 exact");
  expect(rows).toContain("account comparisons | include advisory rows; they are not a breakdown of the checked rows");
  expect(rows).toContain("feeds registry | identical to service.registry_fingerprint, by construction");
  expect(JSON.stringify(v)).not.toMatch(/gated|drift named|\(s\)|weld ·|fingerprint weld/);
});
test("the accepted step says every checked row matched and none drifted", () => {
  expect(verifyStep(view(EVIDENCE_MANIFEST)).sentence).toBe("Every checked row of the pinned run matched the chain exactly; none drifted.");
});
```
(Match the exact row/field names in the current view model; the asserted WORDS are binding.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the words above everywhere a public Verification string says "gated", "drift named", "weld · <wire id>", "fingerprint weld", "(s)", "Chain heights", "the wire's own integers" (INDEX_SENTENCE → "Latest block indexed for each engine, ahead of every batch."; Compute → "…every position's health from exact integers, never floats."). Verify the advisory-row fact yourself in `cmd/api/p5_evidence.go` (the weld tally counts the engine's per-account rows by verdict, gate ignored) and name the line in a lib comment. The evidence drawer keeps the term "gated" once, glossed ("checked rows — the rows that must match for the run to pass"). `evidence.ts:124` "(Proof Center)" → "(Verification)".

- [ ] **Step 4: e2e** — re-point every literal these words touch (`verification.spec.ts`, state-matrix proof cells, keyboard.spec's target is the receipt strip test id — unchanged).

- [ ] **Step 5: Unit gates.** PASS.

- [ ] **Step 6: Commit** — `git commit -m "fix(web): verification speaks one vocabulary - checked rows, account comparisons that are not a breakdown, none drifted" -- <paths>`

### Task 4: The API page renders the contract's bold and code markers (area C, part 2)

Reader: understand.json "vocab" (API).

**Files:**
- Modify: `web/lib/api-view.ts` (new `inlineParts`), `web/app/developers/EndpointCard.tsx:32-34,48-50`
- Test: `web/tests/unit/api-view.spec.ts`, `web/tests/e2e/api.spec.ts:169-172`

**Interfaces:**
- Produces: `export type InlinePart = { readonly kind: "text" | "strong" | "code"; readonly text: string }` and `inlineParts(paragraph: string): readonly InlinePart[]` in `api-view.ts`.

- [ ] **Step 1: Failing test**

```ts
test("the contract's two markers become strong and code; its words stay verbatim; an unbalanced marker stays literal", () => {
  expect(inlineParts("A **409 `batch_superseded`** restarts the walk.")).toEqual([
    { kind: "text", text: "A " }, { kind: "strong", text: "409 `batch_superseded`" }, { kind: "text", text: " restarts the walk." },
  ]);
  expect(inlineParts("see `limit` and **THE EXCLUSION LAW**")).toEqual([
    { kind: "text", text: "see " }, { kind: "code", text: "limit" }, { kind: "text", text: " and " }, { kind: "strong", text: "THE EXCLUSION LAW" },
  ]);
  expect(inlineParts("a lone ** marker and a lone ` tick")).toEqual([{ kind: "text", text: "a lone ** marker and a lone ` tick" }]);
  // every part's text concatenated (markers removed) equals the paragraph minus its balanced markers — no word lost
});
```

- [ ] **Step 2: Run — FAIL** (not exported).
- [ ] **Step 3: Implement** a pure scanner: bold pairs first; inside a strong part the component renders nested backtick pairs with the same function; unbalanced markers stay text. `EndpointCard` maps parts to `<strong>` / `<code>` (no copy composed). Add a unit check over EVERY description in `proof-contract.gen.ts` that the concatenated part texts equal the source with balanced markers removed.
- [ ] **Step 4: e2e** — `api.spec.ts:169-172` asserts a `<strong>` / `<code>` exists for a known description and the words are unchanged.
- [ ] **Step 5: Unit gates.** PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): the API page renders the contract's bold and code markers without changing its words" -- <paths>`

### Task 5: Scenarios' three populations get three words, and the kit's disabled register (area D)

Reader: understand.json "numbers" (e) + "vocab" (Scenarios) + "kit" (b).

**Files:**
- Modify: `web/lib/lab-movers.ts:119-126` (`moversCaption`), `web/lib/lab-view.ts` (new copy constants), `web/app/lab/MoversTable.tsx:35`, `web/app/lab/TransitionCard.tsx:72`, `web/app/lab/LabTiles.tsx:75`, `web/app/lab/LabSurface.tsx:384`, `web/app/lab/AssumptionsDrawer.tsx:19,52`, `web/components/kit/kit.module.css` (after the aria-pressed rule), `web/app/lab/lab.module.css:4-7` (retire)
- Test: `web/tests/unit/lab-movers.spec.ts:79,112`, `web/tests/unit/lab-view.spec.ts`, `web/tests/e2e/lab.spec.ts:256,518-522,1494-1498`, `web/tests/e2e/keyboard.spec.ts` (the assumptions button label)

**Interfaces:**
- Produces: `moversCaption(t: MoversTable, engine: "debt_manager" | "aave_v3_etherfi"): string`; `MOVERS_TITLE`, `MOVERS_QUALIFIER`, `MOVERS_LINK`, `ASSUMPTIONS_BUTTON`, `ASSUMPTIONS_TITLE`, `LANE_TILE_LABEL` in `lab-view.ts`.

- [ ] **Step 1: Read the contract's own movers definitions** (`api/openapi.yaml` `movers_note` examples ~:1318 and ~:1406): Cash movers are accounts whose eligibility flipped false→true, ranked by debt; legacy movers are accounts whose health factor strictly dropped, ranked by the drop. `lane_changed_rows` is not `movers_total` (~:4739).

- [ ] **Step 2: Failing tests**

```ts
test("the movers caption says which accounts they are, in the contract's own terms, and the service's cap", () => {
  expect(moversCaption(table({ shown: 20, total: 118 }), "debt_manager")).toBe(
    "the 20 largest of the 118 accounts that become liquidatable, by debt · the service returns at most 20",
  );
  expect(moversCaption(table({ shown: 5, total: 5 }), "debt_manager")).toBe("all 5 accounts that become liquidatable, by debt");
  expect(moversCaption(table({ shown: 1, total: 1 }), "debt_manager")).toBe("the 1 account that becomes liquidatable");
  expect(moversCaption(table({ shown: 20, total: 300 }), "aave_v3_etherfi")).toBe(
    "the 20 largest health-factor drops of 300 accounts · the service returns at most 20",
  );
  expect(moversCaption(table({ shown: 20, total: null }), "debt_manager")).toBe("20 accounts shown · total not stated");
  expect(moversCaption(unreadableScale(), "debt_manager")).toBe("not readable: unreadable scale");
});
test("the lane tile is not a count of movers", () => { expect(LANE_TILE_LABEL).toBe("Accounts changing lane"); });
```
(If the service's cap is not a contract constant, derive "at most N" only from a stated cap; otherwise word it "the service returns the top N" from `shown` when `shown < total`. Read the Go source for the cap before wording it.)

- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement** the captions; move the section title "Most affected accounts", the qualifier "room today → after the shock · ranked by the service", the link label, `LANE_TILE_LABEL`, and the assumptions words ("Assumptions · What the model leaves out"; drawer title "Assumptions & what the model leaves out"; h3 "Left out of the model") into `lab-view.ts`; components print them. Kit: `.btn:disabled { color: var(--ink-2); background: var(--panel-2); border-color: var(--line); cursor: not-allowed; } .btnGhost:disabled { background: none; }` with a one-line law comment; retire `lab.module.css:4-7`; compute the disabled text contrast (ink-2 on panel-2, both themes, from tokens.css hex) and put the numbers in the report (must be ≥ 3:1).
- [ ] **Step 5: e2e** — re-aim `lab.spec.ts:518-522` and `:1494-1498` from `opacity 0.45` to the kit register (`cursor: not-allowed`, the computed color equals the live `--ink-2`); `:256` the caption; keyboard.spec's assumptions button by its new name.
- [ ] **Step 6: Unit gates (+ `npm run lint:css`).** PASS.
- [ ] **Step 7: Commit** — `git commit -m "fix(web): scenarios names its three populations in the contract's words, and a disabled button no longer looks live" -- <paths>`

### Task 6: Activity's amounts, types and filter chip; the Inspector's activity card (area E, part 1)

Reader: understand.json "Activity" (proposals A, B, C, D, E) + "vocab" (Activity).

**Files:**
- Modify: `web/app/feed/ActivitySurface.tsx` (a `/v1/book` read for `engines[].value_decimals`; rewrite the :82-86 note), `web/lib/activity-view.ts` (`liquidationDetail`, record-only cells, `TYPE_WORDS` + `typeLabel`, `filterEcho` → the applied-filter chip), `web/lib/feed-view.ts` (only if the scale merge belongs there), `web/app/feed/ActivityTable.tsx`, `web/app/feed/ActivityControls.tsx:131`, `web/lib/activity-rows.ts:94`, `web/app/inspector/[addr]/ActivityTable.tsx` (Amount head), `web/tests/fixtures/demo/generate-demo-inspector.mjs` + regenerated `events-demo-near.json`
- Test: `web/tests/unit/activity-view.spec.ts`, `web/tests/unit/feed-view.spec.ts`, `web/tests/unit/activity-rows.spec.ts`, `web/tests/unit/demo-inspector-weld.spec.ts`, `web/tests/e2e/activity.spec.ts`, `web/tests/e2e/r1-fixes.spec.ts:80,93`, `web/tests/e2e/p1b-fixes.spec.ts` (filter echo words)

**Interfaces:**
- Produces: `typeLabel(type: string): string`; `appliedFilter(envelope: ActivityEnvelope): string` (replaces `filterEcho`); the chip label `"Filter applied"`.

- [ ] **Step 1: Failing tests**

```ts
test("a Cash row scaled by the book's own value_decimals prints its decimal point; a legacy scaled row stays raw and tagged", () => {
  const scaled = rowFor(DEMO_FEED_PAGE_1.events[0], { valueDecimals: { debt_manager: 6 } });
  expect(scaled.amount).toBe("252.733333");
  expect(scaled.unit).toContain("normalized debt");
  expect(scaled.unit).not.toContain("raw units");
});
test("a liquidation names the unit it repaid; a record-only row puts its word in the unit cell and a dash in the amount", () => {
  expect(liquidationLine(cashLiquidation)).toContain("debt repaid 0.35812 USD");
  expect(liquidationLine(legacyLiquidation)).toContain("debt repaid 2,500 USDC");
  expect(rowFor(recordOnlyEvent, {}).amount).toBe("—");
  expect(rowFor(recordOnlyEvent, {}).unit).toBe("record-only");
});
test("the three raw enum words print plain; the filter chip says what was applied", () => {
  expect(typeLabel("collateral_enabled")).toBe("collateral enabled");
  expect(typeLabel("collateral_disabled")).toBe("collateral disabled");
  expect(typeLabel("deficit_created")).toBe("bad debt realised");
  expect(typeLabel("borrow")).toBe("borrow");
  expect(appliedFilter({ filter: { engine: null, account: null, types: null, since_block: null }, limit: 50, served_at: "…" })).toBe(
    "any engine · all types · any block · 50 per page",
  );
});
```
(Use the specs' existing builders; the figures are the DEMO fixture's — the demo Cash liquidations are sub-dollar, never print a figure the fixture does not hold.)

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Activity reads `/v1/book` once on mount (`getSolventClient().book(signal)`, as `cash-book.tsx` does) and merges `engines[].value_decimals` beneath the stream's scale (stream wins when present). Liquidation extract: Cash repaid + " USD"; legacy repaid + the row's `symbol` (the address prefix only when symbol is absent). Record-only: amount "—", unit "record-only" (title keeps the statement). Inspector activity: the Amount head reuses `ACTIVITY_AMOUNT_HEADER`; a normalized figure is never followed by a bare symbol (order as Activity: "622 · normalized debt · USDC"). Types: `TYPE_WORDS` map; the button and the Type cell print `typeLabel`, the wire word rides `title`. Chip "Filter applied": engine name via `engineName`, types via `joinAnd` of `typeLabel`s, "from block N" via `groupInt` on a guarded integer, "any" for a null constraint. Demo Inspector fixture: the two `supply` rows → the deriver's real `supplied` record-only shape; the Cash `collateral_enabled` row → a type the Debt Manager deriver emits (`internal/store/p5_events.go` `dmEventDisplay`); keep 6 activity rows (screenshots.spec's ready predicate).
- [ ] **Step 4: e2e** — `activity.spec.ts` / `r1-fixes.spec.ts` route `/v1/book` EXPLICITLY (both the scaled case and, where the raw arm is asserted, a book without value_decimals); re-point the chip and type literals (`p1b-fixes`).
- [ ] **Step 5: Unit gates.** PASS.
- [ ] **Step 6: Commit** — `git commit -m "fix(web): activity scales Cash amounts by the book's own decimals, names what a liquidation repaid, and says its filter and types in words" -- <paths>`

### Task 7: History's record and the Inspector's sweep item (area E, part 2)

Reader: understand.json "vocab" (History, Inspector) + "Book" (d).

**Files:**
- Modify: `web/lib/history-view.ts:479`, `web/lib/observatory-series.ts:786`, `web/lib/trust.ts:153-185` (`sweepItem`)
- Test: `web/tests/unit/history-view.spec.ts`, `web/tests/unit/observatory-series.spec.ts`, `web/tests/unit/trust.spec.ts`, `web/tests/e2e/history.spec.ts`, `web/tests/e2e/state-matrix.spec.ts` (history cells), `web/tests/e2e/inspector.spec.ts`

**Interfaces:** none new beyond the words.

- [ ] **Step 1: Failing tests**

```ts
expect(HISTORY_RECORD_TITLE).toBe("Hour record");
expect(recordTakeaway(capturedPoint)).toBe("captured at 2026-08-08T20:00:00Z · balances as of block 155,323,444.");
// trust: the tally is engine-wide ATTEMPTED accounts (failed counts never-swept rows too — store/risk.go:646);
// the title says what it means for THIS account, proved by the position's flags and the served stamp
const item = sweepItem(positionNotStale, stamp({ rows: 3, failed: 1, gen: 4 }));
expect(item.detail).toBe("1 of 3 attempted accounts failed · gen 4");
expect(item.title).toBe("engine-wide sweep tally · this account's collateral is from its sweep at block 155,323,390");
const stale = sweepItem(positionStale, stamp({ rows: 3, failed: 1, gen: 4 }));
expect(stale.title).toBe("engine-wide sweep tally · this account's last sweep failed — its collateral is from its last successful sweep at block N");
```
(Read `trust.ts` for the item's exact fields; the detail MUST stay one line in the ≈58% detail column — the Inspector pin must not grow the item; the consequence rides the title. Never say collateral was excluded — the code proves it is kept, flagged stale.)

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the words; the stale branch reads `position.flags.includes("collateral_sweep_stale")` and the position's own `as_of.sweep_block` (already guarded non-zero).
- [ ] **Step 4: e2e** — re-point the record title and the takeaway literals; the Inspector's sweep item detail and title.
- [ ] **Step 5: Unit gates.** PASS.
- [ ] **Step 6: Commit** — `git commit -m "fix(web): history's record is an hour, and the inspector's sweep item says what the engine tally means for this account" -- <paths>`

### Task 8: The README (area A)

Reader: understand.json "README" + its verdict (the skeptic's corrections are binding: positions come from logs AND periodic collateral sweeps; the fidelity test re-extracts the page's load-bearing fields, not the whole contract; the run block needs the RPC env and migrate-before-riskd/api; CI is green on ci.yml, pixel pins are local; no hardcoded test counts; screenshots show "Reconnecting" — caption them).

**Files:**
- Modify: `README.md`, `web/README.md` (the deploy section: "deploy target not yet decided")
- Create: `docs/readme/` (screenshots — produced by the integrator in Task 10, referenced by path now)

- [ ] **Step 1: The approval table.** For each engineering claim the README would make "proven" (verified-ancestor rewind; the reconcile receipt; exact-integer money; the contract-fidelity chain; the risk math), find its recorded Codex approval in the phase ledgers (`.superpowers/sdd/progress-phase*.md`, `.superpowers/sdd/*/progress.md`, `roadmap/evidence/`) — session id or closing verdict. A claim without a recorded approval is stated as built and tested, never as proven (D-006 clause 5). Put the table in the report.
- [ ] **Step 2: Write `README.md`**: title and one-paragraph thesis; honest status line; what it is (the eight pages, the two engines with chain IDs, never summed); how it works (the pipeline, one diagram in a fenced text block); what is verified (the approval-table rows, each linked to its code / artifact / test); the reconcile receipt's OWN figures from `roadmap/evidence/artifacts/w1-reconcile/drift-report.json` (never the contract example's 87); run it locally (the exact commands, the env names — never values — and the order); screenshots (`docs/readme/*.png`, captioned "demo dataset; the live stream is not connected in these captures"); repo map; the review process (D-006) in one paragraph. Every sentence verified; no marketing adjectives.
- [ ] **Step 3: Commit** — `git commit -m "docs: the README is the project's front door - what is built, how it works, what is verified, how to run it" -- README.md web/README.md`

### Task 9: The phrasebook sweep (integrator, after Tasks 1–7 land)

**Files:** `web/lib/refusal-phrasebook.ts:5` + every spec that pins the old words (grep `collateral sweep never ran` over `web/tests`).

- [ ] Step 1: `["SWEEP_NEVER", "never successfully swept"]` (true of both wire states the code covers; one tile line).
- [ ] Step 2: Re-point every pin (unit + e2e) to the new words; unit gates; commit `fix(web): a sweep that never succeeded is not a sweep that never ran`.

### Task 10: Build, pins, screenshots (integrator)

- [ ] Kill any :3111 listener; `NEXT_PUBLIC_SHOW_STYLEGUIDE=1 npm run build`; `npm run start` (background); the WHOLE e2e project with the flag; failures return to the owning area as a fix round.
- [ ] Read the new captures; re-baseline ONLY the pins that moved by ruling (expected: overview, book, verification, lab, activity, history, inspector — both themes); two replays green.
- [ ] README screenshots: `node scripts/screenshot-pages.mjs ../docs/readme overview book inspector lab history activity api` (Node ≥ 22.18 for TS stripping); keep the dark `-fold.png` of each; commit with the README's references.

### Task 11: QA, reviews, Codex, close (integrator)

- [ ] Focused `solvent-user` re-walk of the fixed items over the new captures (did each finding close; anything new?).
- [ ] Whole-branch review of the plan's range (seams, laws at the final state, the contract list), one fix round, re-review.
- [ ] Codex round (D-006) on the source diff via the `codex-reviewer` agent; adjudicate every finding; fix wave returns to Codex until no new accepted-class findings.
- [ ] Close entry in `.superpowers/sdd/progress-ui-overhaul.md` (range, counts, pins moved by ruling, the rulings of record from spec §6, the owner's list additions); workspace commit of the ledger directory.

---

## Self-review

- **Spec coverage:** §2 A → Task 8 (+ Task 10 screenshots); B1–B5, B7 → Tasks 1–2; B6 → Task 9; C1–C3 → Task 3; C4 → Task 4; D1–D3 → Task 5; E1–E5 → Task 6; E6–E7 → Task 7; §5 → Tasks 10–11; §6 rulings recorded in the close.
- **Placeholders:** none — every word a page will print is in a test above; where a builder name depends on the existing spec file the task says to use that file's builder.
- **Types:** `liquidatableTileSub`, `liquidatableTileLabel`, `nearCapToggleLabel`, `belowLineToggleLabel` (cash-summary.ts); `inlineParts` / `InlinePart` (api-view.ts); `moversCaption(t, engine)` and the lab-view constants; `typeLabel` / `appliedFilter` (activity-view.ts) — each defined once, in the task that produces it.
- **Parallel safety:** areas own disjoint files; the one phrase pinned across four areas' specs (SWEEP_NEVER) is swept by the integrator after the areas land (Task 9).
