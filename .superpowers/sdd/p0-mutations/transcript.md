# mutation transcript — UI-overhaul Phase 0 (p0-1 … p0-5)

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **This transcript is a FORMAL RECORD, not a re-run.** Every kill below was
  observed IN ISOLATION during its own task (tasks 1–5), on that task's
  completed working tree, and is documented in the task's report
  (`.superpowers/sdd/2026-08-09-ui-overhaul-phase0-trust-fixes/task-N-report.md`)
  and the per-task section of `.superpowers/sdd/progress-ui-overhaul.md`.
  Every isolation observation was recorded clean, so the brief's
  re-run-if-unclean clause was never triggered.
- Trees observed against (the mutant applied alone on top of the task's
  completed work, then reverted and the revert proven by a green re-run):
  - p0-1: `19e21f2` (task 1; fix round `6e259e2`)
  - p0-2: `7cadf05` (task 2; fix round `ca1c8a0`)
  - p0-3: `5df32c4` (task 3; logs `web-3818-p03mutA.log` / `web-3818-p03mutB.log` at repo root)
  - p0-4: `50938fe` (task 4)
  - p0-5: `6c8e875` (task 5)
- Applier: by hand (no `mutate.py`); each `search` in `mutations.json` was
  re-verified byte-for-byte against the current post-phase tree at seal time.
- Line anchors: "recorded" = the line at observation time; "now" = the same
  assertion's line at seal time (later tasks appended imports/helpers to the
  shared `p0-fixes.spec.ts`, shifting earlier anchors).

## Count reconciliation (the brief said 9)

**8 distinct mutant diffs, 10 isolated kill observations.**
The task-6 brief's "9 mutants (2 per task 1/2/4/5, 1 for task 3)" reconciles
against the task reports as: task 1 ran ONE mutant killed at BOTH tiers
(e2e + unit, each in isolation — the brief counted those two kills as two
mutants); tasks 2/4/5 ran two mutants each, one kill site each; task 3 ran ONE
mutant observed at TWO assertions (both kill sites below). Task 1's fix round
p0-1b additionally produced a RED-FIRST `role="status"` assertion (failed at
the recorded p0-fixes.spec.ts:83 against the still-unfixed build:
`getByRole('status')…` → element(s) not found) — test-first evidence, NOT a
mutant, not counted.

## P0M1 — comparison deleted: `addressBinding` always returns the "current" arm

**Property under attack:** Address binding is a COMPARISON, not a blessing: a
settled stress result belongs to the address it was computed FOR, and an edited
input must flip the binding to "stale" (barrier raised, result withheld) rather
than letting the old result stand under the new address.

```diff
--- web/app/lab/addressBinding.ts (addressBinding)
-  return input === phase.addr
-    ? { kind: "current", addr: phase.addr }
-    : { kind: "stale", addr: phase.addr };
+  return { kind: "current", addr: phase.addr };
```

Kill site 1 (e2e, as recorded in task-1 report):
`npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts -g "stale barrier"`
→ FAILED at `await expect(barrier).toBeVisible()` on
`getByTestId('lab-stale-result')` — `Error: expect(locator).toBeVisible()
failed … element(s) not found` (recorded p0-fixes.spec.ts:74; now :97).

Kill site 2 (unit, as recorded in task-1 report):
`npx playwright test -c tests/playwright.p0.config.ts tests/unit/address-binding.spec.ts`
→ 3 failed, led by `done phase with edited input is stale and names the RESULT
address` (address-binding.spec.ts:30-31): `expect(received).toEqual(expected)`
with `- "kind": "stale"` / `+ "kind": "current"`. The round-trip and error-arm
pins also killed it.

Reverted; revert verified by rebuild + full green run (82 passed).

**Result: KILLED** (both sites, each in isolation)

## P0M2 — bad-debt block deleted from `cellPrimaryOutcome`

**Property under attack:** A settled matrix cell folds EVERY nonzero outcome
dimension into its sub-line — deleting the bad-debt block lets bad debt move
invisibly behind a cell that renders every other part.

```diff
--- web/app/lab/matrixCells.ts (cellPrimaryOutcome)
-  if (!isZeroDecimal(engine.bad_debt_delta_usd)) {
-    parts.push(`Δ bad debt ${usd(engine.bad_debt_delta_usd, engine.usd_decimals)}`);
-  }
```

As recorded in task-2 report:
`npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts -g "bad debt and shortfall"`
→ FAILED at `toContainText("Δ bad debt")` (recorded p0-fixes.spec.ts:194; now
:215); received `"$6,000net eligible accounts +1 · +1 newly eligible · Δ
eligible debt $6,000 · execution shortfall $0.00003864 · batch #1"` — every
other part present, only the mutated dimension missing.

Reverted; post-revert rebuild + affected set: 190 passed.

**Result: KILLED**

## P0M3 — `isZeroDecimal` returns false unconditionally (quiet arm unreachable)

**Property under attack:** The quiet arm is REACHABLE and honest: an all-zero
engine says "no effective movement" instead of parading zero-dollar deltas as
outcomes.

```diff
--- web/app/lab/matrixCells.ts (isZeroDecimal)
-  return /^-?0*\.?0*$/.test(value);
+  return false;
```

As recorded in task-2 report:
`npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts -g "all-zero engine"`
→ FAILED at `toContainText("no effective movement")` (recorded
p0-fixes.spec.ts:214; now :239); received `"$0net eligible accounts 0 · Δ
eligible debt $0 · Δ bad debt $0 · batch #1"`.

Reverted; post-revert rebuild + affected set: 190 passed.

**Result: KILLED**

## P0M4 — value-arm label reverted to "Liquidation price"

**Property under attack:** The value-arm row names HEALTH, not liquidation:
the number is the lowest price at which the position is still healthy
(ceil P*), not a liquidation trigger — and the OLD copy's presence is itself
pinned against.

```diff
--- web/app/inspector/[addr]/InspectorPositionCard.tsx (renderLiquidationPriceRow, value arm ~:415)
-        <span className={styles.k}>Health boundary price</span>
+        <span className={styles.k}>Liquidation price</span>
```

Kill site 1 (as recorded in task-3 report, `web-3818-p03mutA.log`): the p0-3
describe alone against the mutated build → 1 failed, first-failing assertion
`await expect(card.getByText("Health boundary price")).toBeVisible();` —
`element(s) not found` (recorded p0-fixes.spec.ts:260; now :269). The runner
stops there, before the count pin; the drawer test passes under this mutant
(correct — the mutant does not touch the drawer title).

Kill site 2 (as recorded in task-3 report, `web-3818-p03mutB.log`): the
discriminating pin AT ITS OWN ASSERTION in true isolation, via a scratch spec
(`tests/e2e/scratch-p03-mutant.spec.ts`, deleted before commit) running ONLY
the card-visible anchor + `await expect(card.getByText("Liquidation
price")).toHaveCount(0);` → `Error: expect(locator).toHaveCount(expected)
failed — Expected: 0, Received: 1`. (The committed equivalent pin lives at
p0-fixes.spec.ts:277 now.)

Reverted; post-revert rebuild + 3-spec run: 50 passed (`web-3818-p03post.log`).

**Result: KILLED** (both sites; site 1 in the committed spec, site 2 at the
discriminating assertion in isolation)

## P0M5 — `historyHead` returns the Aave string for every engine

**Property under attack:** The history head is ENGINE-SPECIFIC: the DM's
disclosure ratio must never wear health-factor clothing.

```diff
--- web/lib/history-series.ts (historyHead)
-  if (engine === "aave_v3_etherfi") return "Health factor across batches";
-  if (engine === "debt_manager") return "Borrow headroom (disclosure) across batches";
-  return "Plotted series across batches";
+  return "Health factor across batches";
```

As recorded in task-4 report: applied alone, rebuilt, the p0-4 DM/Aave-heads
test run in isolation → KILLED at the DM-head `toBeVisible`
(`getByText("Borrow headroom (disclosure) across batches")`; recorded
p0-fixes.spec.ts:368; now :371) — the brief's predicted assertion.

Reverted; post-revert rebuild + full affected set: 164 passed.

**Result: KILLED**

## P0M6 — `comparatorReaderLabel` passes "hf_wad" through verbatim

**Property under attack:** Comparator tokens are HUMANIZED for the reader:
"hf_wad" renders as "the pool's own health factor (wad)", never as a raw wire
token in the Book histogram panel head.

```diff
--- web/lib/book-copy.ts (comparatorReaderLabel)
-  if (comparator === "hf_wad") return "the pool's own health factor (wad)";
```

As recorded in task-4 report: applied alone, rebuilt, the p0-4 Book
humanization test run in isolation → KILLED at the humanized-label
`toBeVisible` (recorded p0-fixes.spec.ts:387; now :390). DIVERGENCE from the
brief's predicted `toHaveCount(0)` kill, recorded at the task: the fix drops
the "comparator: " prefix, so the mutant prints bare "hf_wad", which the
pattern "comparator: hf_wad" can never match — the count pin stays 0 and the
kill lands one assertion later, still inside the Book test, in isolation.

Reverted; post-revert rebuild + full affected set: 164 passed.

**Result: KILLED**

## P0M7 — `snapshotChip` returns "" at ≤3600s (the retired suffix policy resurrected)

**Property under attack:** The snapshot chip is ALWAYS visible, at every age —
the old >1h-only policy let a live stream over a fresh-looking batch hide the
snapshot's age entirely.

```diff
--- web/lib/freshness.ts (snapshotChip)
+  if (ageSeconds <= 3600) return "";
   return `snapshot #${String(batchId)} · ${humanAge(ageSeconds)} old`;
```

As recorded in task-5 report: applied alone, rebuilt, the p0-5 fresh-batch
test run in isolation → KILLED at the chip `toBeVisible`
(p0-fixes.spec.ts:477, recorded AND current — the anchor did not move).
DIVERGENCE from the brief's predicted `"42s old"` kill, recorded at the task:
an empty-string chip is falsy, so Ribbon renders no element at all and the
kill lands one assertion earlier, still inside the same test in isolation.

Reverted; post-revert rebuild + full affected set: 110 passed, 1 pre-existing
skip.

**Result: KILLED**

## P0M8 — PostureRibbon ignores `age.unresolved`, always computes the chip

**Property under attack:** R6's arbitration preserved one-to-one: while the
age is UNRESOLVED the computed chip is NOT built — feeding `snapshotChip` the
understated number the page just admitted it does not have restates the
round-13 defect. Only a new receipt discharges the unknown.

```diff
--- web/components/PostureRibbon.tsx (batch branch, Ribbon snapshot prop)
-          age.unresolved
-            ? snapshotChipUnknown(posture.batch.id, age.refreshFailed)
-            : snapshotChip(posture.batch.id, age.seconds ?? posture.batch.age_seconds)
+          snapshotChip(posture.batch.id, age.seconds ?? posture.batch.age_seconds)
```

As recorded in task-5 report: applied alone, rebuilt, the r6-fixes
unknown-register test run in isolation → KILLED at r6-fixes.spec.ts:221
(recorded and current), the chip's `age UNKNOWN` `toHaveText`
(`snapshot #1 · age UNKNOWN since resume · refreshing`) — received
`snapshot #1 · 2m old`, the understated computed age. The brief's predicted
assertion exactly.

Reverted; post-revert rebuild + full affected set: 110 passed, 1 pre-existing
skip.

**Result: KILLED**

## restore verification

Every mutant was reverted at its own task, and the revert proven by a rebuild
plus a green re-run of the task's affected set BEFORE the task's commit
(82 / 190 / 50 / 164 / 110-passed runs respectively, per the task reports).
At seal time every `search` string in `mutations.json` matches the current
tree byte-for-byte — the shipped code is the unmutated code.

## summary

| # | result | task | mutant | killed by |
|---|---|---|---|---|
| P0M1 | **KILLED** (2 sites) | p0-1 | addressBinding comparison deleted | e2e `lab-stale-result` toBeVisible (rec. :74, now :97) + unit stale-arm toEqual (address-binding.spec.ts:31) |
| P0M2 | **KILLED** | p0-2 | bad-debt block deleted | `toContainText("Δ bad debt")` (rec. :194, now :215) |
| P0M3 | **KILLED** | p0-2 | isZeroDecimal → always false | `toContainText("no effective movement")` (rec. :214, now :239) |
| P0M4 | **KILLED** (2 sites) | p0-3 | value-arm label → "Liquidation price" | rename toBeVisible (rec. :260, now :269) + discriminating `toHaveCount(0)` in isolation (Expected 0, Received 1) |
| P0M5 | **KILLED** | p0-4 | historyHead → Aave string always | DM-head toBeVisible (rec. :368, now :371) |
| P0M6 | **KILLED** | p0-4 | comparatorReaderLabel passes "hf_wad" through | humanized-label toBeVisible (rec. :387, now :390) |
| P0M7 | **KILLED** | p0-5 | snapshotChip "" at ≤3600s | chip toBeVisible (p0-fixes.spec.ts:477) |
| P0M8 | **KILLED** | p0-5 | PostureRibbon ignores `unresolved` | r6-fixes.spec.ts:221 `age UNKNOWN` toHaveText |

**8 mutants, 10 isolated kill observations, 8 killed, 0 survived.**
