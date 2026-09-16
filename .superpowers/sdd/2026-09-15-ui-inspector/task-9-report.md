# Task 9 report: `inspector-view` — one view model for the surface and the tests

Status: DONE_WITH_CONCERNS (two spec-side deviations from the brief, both explained below; the module is verbatim)
Commit: `4bdade36dd5522e90bc45fd2f4a77f398b6ed986` on `main`
Message: `feat(web): deriveInspectorView - one model for the Inspector's ten states; the outcome decides, the engine's verdict decides, a floor is said`

## What was done

Followed the brief's TDD order.

1. **Step 1 – failing spec.** Wrote `web/tests/unit/inspector-view.spec.ts` from the brief's listing.
2. **Step 2 – red.** `npx playwright test --project=unit tests/unit/inspector-view.spec.ts` failed as expected:
   `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\inspector-view' imported from ...\web\tests\unit\inspector-view.spec.ts` / `No tests found.`
3. **Step 3 – `web/lib/inspector-view.ts`.** Written exactly as the brief lists it; no edits. Before writing I verified every import against the landed modules: `truncateAddress` (`./format`), `humanAge` (`./freshness`), `freshnessTier` / `FreshnessTier` / `TierConstants` (`./freshnessTiers`), `humanUsdFull` (`./human-price`), all ten headline exports (`./inspector-headline`), `boundaryOf` / `CASH` / `collateralTable` / `isComputedCash` / `LEGACY` / `pricesChip` / `readCashPosition` and the three types (`./inspector-position`), `plainCause(code, detail?)` (`./refusal-phrasebook`), `nearCapStreak` / `roomSeries(engine, knownBatchIds)` / `RoomSeries` / `Streak` (`./room-history`), `trustChecklist({ position, batchId, sweep, reconcile })` / `TrustItem` (`./trust`), `readWirePopulation` (`./wireGuard`), `ViewChip` (`./cash-view`), `AddressReading` / `Phase<T>` (`./address-lookup`). `EvidenceManifest.reconcile` is `components["schemas"]["ReconcileSummary"] | null`, which is exactly `TrustInput.reconcile`. The six-arm `Boundary` (incl. `contradictory`) passes through untouched; the module has no exhaustive switch over it.
4. **Step 4 – green, after two spec fixes.** First run: 4 passed, 2 failed (the two tests that feed a history). Both failures were the same throw from `readWirePopulation`: `batch_id is not a wire population (a nonnegative safe integer, never -0): got -1 — out of contract, refused before render`. See Deviation 1. After the fix: 6 passed. `plainCause("SWEEP_FAILED", "the sweep failed")` yields `"collateral sweep failed"` from the phrasebook (a known code returns the phrasebook entry and ignores the detail), so the not-computed dek matched the brief's contract as written; the brief's fallback (pass only the code) was not needed.
5. **Step 5 – verify and commit.** Typecheck, lint and the spec all green (below). Staged the two files by name, ran the scope gate, committed pathspec-limited to the two files. No attribution / `Co-Authored-By` lines.

## Exact verification output

Unit spec (`web/`):

```
Running 6 tests using 6 workers

  ✓  1 [unit] › tests\unit\inspector-view.spec.ts:80:1 › invalid, loading and unavailable render into the frame with an honest identity chip (9ms)
  ✓  2 [unit] › tests\unit\inspector-view.spec.ts:122:1 › the contract fixture: Cash liquidatable beside a legacy position; the kicker and legacy card follow (19ms)
  ✓  3 [unit] › tests\unit\inspector-view.spec.ts:183:1 › the room series is keyed to the history's own vantage, never the lookup's newer batch (17ms)
  ✓  5 [unit] › tests\unit\inspector-view.spec.ts:96:1 › near cap: state, kicker, headline, chips, table, boundary, trust and the room streak all derive from one reading (21ms)
  ✓  4 [unit] › tests\unit\inspector-view.spec.ts:130:1 › legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure (24ms)
  ✓  6 [unit] › tests\unit\inspector-view.spec.ts:162:1 › a floor rides the dek and the Lookup chip; an unresolved age is 'age unknown' in the refused register (17ms)

  6 passed (2.5s)
```

Typecheck (`npm run typecheck`, which first rebuilds `@solvent/client`): `tsc --noEmit` exit 0, no output. The transient `tests/unit/inspector-headline.spec.ts` TS2741 failure the parent warned about did NOT appear — typecheck was fully clean on both runs.

Lint (`npm run lint` -> `eslint .`): exit 0, no errors, no warnings (after Deviation 2; before it, 2 warnings, 0 errors — see below).

Scope gate: `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. Pre-commit control-plane doctor: `OK -- 0 error(s), 0 warning(s), 5 info` (the same pre-existing REVIEW-DUE notices on unrelated roadmap objects that task 8 reported).

## Deviations from the brief

### Deviation 1 (required — the brief's history fixture is out of contract): history vantage 1 -> 2

The brief's `dmHistory(address, batchId)` builds points at `[batchId, batchId - 1, batchId - 2]`, and both history tests call it with vantage `1`, producing point batch ids `1, 0, -1`. The brief's last test even asserts `view.room?.points.map((p) => p.batchId)` equals `[-1, 0, 1]`.

That is impossible against the landed modules, for two independent reasons:

- The brief's own module (verbatim) guards every history point id with `readWirePopulation(p.batch_id, "batch_id")` while building the `known` set; `-1` is not a wire population and throws.
- Even without that guard, the landed `roomSeries` (Task 5, review-hardened; its header says "every wire population passes readWirePopulation before it is printed or used") guards `point.batch_id` in `pointFor` and every `knownBatchIds[]` entry — so `roomSeries` itself throws on `-1`. A batch id is a wire population; a negative one is refused before render by design, and the brief's expectation contradicts a landed law rather than a mere number.

So the module is not what is wrong; the fixture vantage is. Minimal spec-side fix, arithmetic re-derived by hand from the landed code:

- Test "near cap": `dmHistory(FOUND_ADDR, 2)` (points 2, 1, 0 — all wire populations); `expect(view.historyBatchId).toBe(2)` (was 1). Everything else in that test is unchanged and still holds by the same arithmetic: `computed_at` is indexed by `k`, not by id, so newest 10:02:00Z − oldest 10:00:00Z = **120 s**; room for the newest point is `headroomTenths(5012500000, 4822000000)` = floor(190500000 × 1000 / 5012500000) = **38 tenths (3.8 %)** < 100, and for the older two `headroomTenths(5200000000, 4822000000)` = floor(378000000 × 1000 / 5200000000) = **72 tenths (7.2 %)** < 100, so all three are under the near line -> `batches: 3`; the newest is computed -> `newestKind: "computed"`; `known` = {2 (vantage), 2, 1, 0} adds no `no-row` gap -> `computedCount: 3`. The lookup stays at ADDRESS_FOUND's batch 1 (chips `Batch: "1"` unchanged); the history being one batch newer than the lookup is a realistic in-flight state and the test's point ("all derive from one reading") is unaffected.
- Test "keyed to the history's own vantage": lookup batch `3` (was 2), `dmHistory(FOUND_ADDR, 2)` (was 1); expectations `batchId` **3**, `historyBatchId` **2**, room ids **`[0, 1, 2]`** (was `[-1, 0, 1]`), comment updated to match. The test's intent is preserved exactly: the lookup's batch (3) is newer than the history's vantage (2), and no `no-row` gap is invented for it.
- Added one doc line on `dmHistory` saying the vantage must be ≥ 2 and why.

### Deviation 2 (judgement call — lint hygiene): `nearWire()`'s two discard bindings became checked invariants

The parent asked for both "keep `nearWire()` exactly as written" and "`npm run lint` clean". The brief's `nearWire()` discards the refined fields with `liquidation_verdict: _v` and `collateral_use: _c`. This repo's ESLint config is Next's `core-web-vitals` + `typescript` presets, unmodified: `@typescript-eslint/no-unused-vars` warns, with no `_` ignore pattern and no `ignoreRestSiblings`. The verbatim form produced 2 warnings (0 errors, exit 0) against a lint baseline of zero warnings; the codebase has no `eslint-disable` comments and no `_`-prefixed discards anywhere, and the task-8 report treated "no warnings, no disable comments" as the bar.

I kept the conversion semantics byte-for-byte in effect — the refined `liquidation_verdict` and each leg's `collateral_use` are dropped; `liquidatable: false` and `used_as_collateral: true` are added; the resulting `Schemas["Position"]` carries no refined key — but turned the two discarded bindings into checked fixture invariants:

```ts
const { liquidation_verdict, legs, ...rest } = near();
if (liquidation_verdict !== "not-liquidatable") throw new Error("fixture: the helper is the not-liquidatable near-cap account");
...
legs: legs.map(({ collateral_use, ...leg }) => {
  if (collateral_use !== "counted") throw new Error("fixture: every helper leg is counted collateral");
  return { ...leg, used_as_collateral: true };
}),
```

The wire values substituted are exactly the raw forms of the refined values dropped (`not-liquidatable` -> `liquidatable: false`; `counted` -> `used_as_collateral: true`), so the check documents the conversion instead of silently discarding it. Both literals are members of the client's `LiquidationVerdict` / `CollateralUse` unions. If the reviewer prefers the brief's verbatim form, reverting this block restores it at the cost of the 2 lint warnings (still exit 0).

### Not deviations

- `web/lib/inspector-view.ts` is the brief's listing verbatim.
- No other file was touched; `.superpowers/sdd/.gitignore` untouched.
- `git add` / `git commit` printed `LF will be replaced by CRLF the next time Git touches it` for both new files — the repo's autocrlf notice, informational only, as in task 8.

## Concerns for review

1. Deviation 1 changes pinned expectations (`historyBatchId`, the room ids, the lookup batch in one test). I believe it is the only honest resolution — the alternative would be weakening a landed wire-guard law in Task 5 — but it should be checked against the plan's intent for the two history tests.
2. Deviation 2 alters the spec helper's shape. Semantics are identical; it is a hygiene call the reviewer may reverse.

## Files

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\inspector-view.ts` (new, verbatim from the brief)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\inspector-view.spec.ts` (new, brief's listing with the two deviations above)

---

# Fix round 1

Status: DONE
Commit: `f013695b6b4d531d425adc0953662d905a76d1b4` on `main` (on top of `0adacdf`)
Message: `fix(web): inspector view review round - a withheld Cash book under found is never a Cash negative, every found arm says the floor, no boundary for a verdict-less row, an empty found is refused`

Review: `task-9-review.md` (spec ✅, quality needs-fixes: one Critical, three Important, five Minor). All six prescribed module changes and the spec changes landed; the interface gained exactly one field (`historyOutcome`).

## Module (`web/lib/inspector-view.ts`)

1. **Critical 1 — withheld Cash book under `found`.** New arm before `legacy-only`: `cash === null && lookup.withheldEngines.some((w) => w.engine === CASH)` → `state: "cannot-compute"`, headline `cannotComputeHeadline(the Cash refusal(s) only)`; when a legacy position is present the dek gains ` A legacy Aave v3 position exists; it is judged by its own health factor, below.` `legacy` stays populated. No floor is appended here (the dek already says the book is withheld, per the coordinator).
2. **Important 2 — every found arm says the floor.** `withFloor(h)` appends ` ${floor}` to the dek (same single-space join `cashHeadline` uses) in the `legacy-only` and `not-computed` arms.
3. **Important 3 — boundary only for a computed row with a verdict.** `boundary = cashWire !== null && cash !== null && isComputedCash(cash) ? boundaryOf(...) : null`; `table` unchanged (legs are wire facts).
4. **Important 4 — `found` with `positions: []`.** Refused before any position is read: `empty("unavailable", `Account ${short}`, unavailableLookupHeadline("the lookup says found but lists no position — the response contradicts itself"), [Identity: unavailable])`. Confirmed against the client: `lookup()` enforces only the completeness laws and returns `outcome: "found"` for `found: true` whatever the positions count (`lookup.ts:151-183`), so the body is servable and the view must catch it. (Coordinator files the client follow-up.)
5. **Minor 5 — not-computed cause.** Derived from what is actually null: refusal → `plainCause`; `status === "unknowable"` → "published no verdict"; cap and debt null → "neither a cap nor a debt"; cap null → "no cap"; else → "no readable debt".
6. **Minor 6/7 — `historyOutcome` and `decimals` doc.** `readonly historyOutcome: "found" | "not-found" | "unknowable" | null` set from `reading.history.value.outcome` when ready, null otherwise; `empty()` sets null. `decimals` documented as "the Cash position's `value_decimals` (6 when there is none)".

## Spec (`web/tests/unit/inspector-view.spec.ts`)

- Minor 8: dropped the `DM` / `AAVE` imports and the `expect(void DM, void AAVE).toBeUndefined()` line.
- Minor 9: the "near cap" test now uses lookup batch 3 with `dmHistory(FOUND_ADDR, 2)` (comment says so); Batch chip `"3"`, `batchId` 3, `historyBatchId` 2, room ids `[0, 1, 2]`, `historyOutcome` `"found"`; streak unchanged `{ 3, 120, "computed" }`.
- One new test block, "under found: …", pinning: found + Cash withheld + legacy present → `cannot-compute`, emphasis `Cannot say — the Cash book is withheld this batch.`, dek contains `A legacy Aave v3 position exists`, Lookup chip `{ "Lookup", "floor · Cash withheld", warn }`, `legacy` non-null, `historyOutcome` null (history loading); refused Cash + Aave withheld → `not-computed`, `floor` pinned to its exact sentence and `dek.endsWith(floor)`; `nearWire({ liquidatable: null })` → `not-computed`, `boundary` null, dek contains `published no verdict`; `found([])` → `unavailable`, dek contains `contradicts itself`, `legacy` null.

Hand-checks before the run: `readCashPosition` gives a `liquidatable: null` row `status: "unknowable"`, `computed: true`, `refusal: null`, and `isComputedCash` is false for it, so it takes the "published no verdict" cause; `plainCause("FLAG_CUSTODY_UNPROVEN", "")` is the phrasebook's "collateral-flag custody unproven"; `unavailableLookupHeadline` capitalises the message and ends it with one period.

## Exact verification output

```
Running 7 tests using 7 workers

  ✓  2 [unit] › tests\unit\inspector-view.spec.ts:80:1 › invalid, loading and unavailable render into the frame with an honest identity chip (9ms)
  ✓  1 [unit] › tests\unit\inspector-view.spec.ts:129:1 › the contract fixture: Cash liquidatable beside a legacy position; the kicker and legacy card follow (18ms)
  ✓  3 [unit] › tests\unit\inspector-view.spec.ts:96:1 › near cap: state, kicker, headline, chips, table, boundary, trust and the room streak all derive from one reading (24ms)
  ✓  5 [unit] › tests\unit\inspector-view.spec.ts:190:1 › the room series is keyed to the history's own vantage, never the lookup's newer batch (16ms)
  ✓  6 [unit] › tests\unit\inspector-view.spec.ts:169:1 › a floor rides the dek and the Lookup chip; an unresolved age is 'age unknown' in the refused register (18ms)
  ✓  4 [unit] › tests\unit\inspector-view.spec.ts:204:1 › under found: a withheld Cash book is never a Cash negative, every arm says the floor, a verdict-less row has no boundary, an empty found is refused (22ms)
  ✓  7 [unit] › tests\unit\inspector-view.spec.ts:137:1 › legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure (22ms)

  7 passed (2.5s)
```

`npm run typecheck`: `tsc --noEmit` exit 0. `npm run lint`: exit 0, no errors, no warnings. Scope gate: `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; pre-commit doctor `OK -- 0 error(s), 0 warning(s), 5 info`. Committed pathspec-limited to the two files; no attribution lines; no index.lock contention.

## Notes

- The coordinator's resume message ("no changes of yours reached the tree") crossed my edits in flight: `git status --short` showed both files modified with the complete fix round, verified by diff before running anything — nothing was redone or lost.
- `notComputedHeadline`'s fixed emphasis still says "was not computed this batch" for the unknowable-verdict row (review Important 3's wording note); only the cause text was changed here, as prescribed. The emphasis lives in Task 6's file, which this round did not touch.

---

# Round 2

Status: DONE
Commit: `d88c0d01c4b9043b509bc0afb17ae53157e5fb9f` on `main` (on top of `de9e606`, Task 11's surface)
Message: `fix(web): inspector view round 2 - the not-computed cause reads the wire, never the reader's manufactured null`

Re-review of `f013695`: eight of nine rulings addressed; Minor 5 open — the cause ladder read `CashPosition.cap`, which `readCashPosition` forces to null on every refused row, so a published cap was reported as missing (probes P6, P10, P11).

## Module (`web/lib/inspector-view.ts`)

- New `notComputedCause(cash, wire)` reads the WIRE, in the prescribed order: (1) `cash.refusal !== null` → `plainCause(code, detail)`; (2) `wire.status !== "computed"` with no refusal → "the engine refused this row without a code" (matches `trust.ts`'s `computedItem`); (3) `cash.status === "unknowable"` → "the engine published no verdict for this account"; (4) `wire.max_borrow_lt` / `wire.borrowings` through `isWireDecimal` (imported from `./wireGuard`): neither → "neither a cap nor a debt"; cap unreadable → "no cap"; debt unreadable → "no readable debt"; (5) both readable but `BigInt(...) < 0n` → "the engine published a negative figure — not a position".
- The "last readable debt" clause is passed only when `cash.debt !== null && cash.debt >= 0n`.
- Type honesty, one deviation in shape: the arm calls `notComputedCause(cash, cashWire)` where `cashWire` is `RefinedPosition | null`; the arm is reachable only with `cash !== null`, which implies the wire row exists, but the type system cannot see that pairing (the brief paired the null checks by hand for `table` / `boundary` for the same reason). Rather than a second copy of a fallback sentence at the call site, `notComputedCause` accepts `RefinedPosition | null` with one leading guard, and both that guard and the ladder's unreachable end return the single constant `NOT_COMPUTED_UNSAID` ("the engine did not compute this position"). Neither line is reachable beside a read position; both are commented as such.

## Spec (`web/tests/unit/inspector-view.spec.ts`)

One new block, "the not-computed cause reads the wire: …": `nearWire({ borrowings: null })` (cap on the wire) → `not-computed`, dek contains "no readable debt"; `nearWire({ status: "refused", refusal: null })` (both figures on the wire) → `not-computed`, dek contains "refused this row without a code"; `nearWire({ borrowings: "-1" })` → `not-computed`, dek contains "not a position" and does not contain "last readable". Hand-check before the run: `isWireDecimal` is `^-?[0-9]+$`, so `"-1"` is a readable, negative decimal — step (5), not step (4).

## Exact verification output

```
Running 8 tests using 8 workers

  ✓  1 [unit] › tests\unit\inspector-view.spec.ts:129:1 › the contract fixture: Cash liquidatable beside a legacy position; the kicker and legacy card follow (18ms)
  ✓  5 [unit] › tests\unit\inspector-view.spec.ts:80:1 › invalid, loading and unavailable render into the frame with an honest identity chip (10ms)
  ✓  7 [unit] › tests\unit\inspector-view.spec.ts:169:1 › a floor rides the dek and the Lookup chip; an unresolved age is 'age unknown' in the refused register (17ms)
  ✓  4 [unit] › tests\unit\inspector-view.spec.ts:190:1 › the room series is keyed to the history's own vantage, never the lookup's newer batch (17ms)
  ✓  2 [unit] › tests\unit\inspector-view.spec.ts:248:1 › the not-computed cause reads the wire: a missing debt, a refusal without a code, a negative figure — each named for what it is (19ms)
  ✓  3 [unit] › tests\unit\inspector-view.spec.ts:204:1 › under found: a withheld Cash book is never a Cash negative, every arm says the floor, a verdict-less row has no boundary, an empty found is refused (21ms)
  ✓  6 [unit] › tests\unit\inspector-view.spec.ts:137:1 › legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure (24ms)
  ✓  8 [unit] › tests\unit\inspector-view.spec.ts:96:1 › near cap: state, kicker, headline, chips, table, boundary, trust and the room streak all derive from one reading (26ms)

  8 passed (565ms)
```

`npm run typecheck`: `tsc --noEmit` exit 0 (a first pass failed with TS2345 on the nullable `cashWire` at the call site — the type-honesty note above is the fix; re-run clean). `npm run lint`: exit 0, no errors, no warnings. Scope gate: `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; pre-commit doctor `OK -- 0 error(s), 0 warning(s), 5 info`. Committed pathspec-limited to the two files; no attribution lines; no index.lock contention.

## Notes

- The accepted residue from round 1 (the fixed "was not computed this batch" emphasis for the unknowable-verdict row, in Task 6's `inspector-headline.ts`) is unchanged, as the re-review ledgered.
- The re-review's surface note for Task 11 (`InspectorSurface.tsx` keying `found` on `reading.lookup` rather than `view.state`, so the drawer button shows for the empty-found refusal) is outside this task's two files and was not touched.
