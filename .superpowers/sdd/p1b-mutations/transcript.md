# mutation transcript — phase 1 track B (p1b), reconciled at close (p1b-7)

- spec: `mutations.json`
- repo: `C:\Users\kasel\source\repos\etherfi\Solvent`
- **This is a RECONCILIATION, not a fresh loop.** Every mutant below was applied,
  observed killed IN ISOLATION, and reverted DURING ITS OWN TASK (p1b-0..p1b-6);
  no mutant was re-run at close. Sources of record, per mutant, are named in each
  section: the task reports
  (`.superpowers/sdd/2026-08-09-ui-overhaul-phase1-trackb/task-{0,1,3,4,5,6}-report.md`),
  the committed ledger (`.superpowers/sdd/progress-ui-overhaul.md` p1b sections —
  **task 2's kills are recorded ONLY there**, no task-2-report.md exists), and the
  repo-root run logs `web-3819-p1b5-mut*.log` / `web-3819-p1b6-mut*.log`
  (tasks 0–4 kept no per-mutant root logs; their kills are recorded prose).
- **Tested SHAs (per task, each mutant at its own task's HEAD):**
  p1b-0 @ `5891bdc` · p1b-1 @ `872fae5` · p1b-2 @ `9e99684` · p1b-3 @ `2568539` ·
  p1b-4 @ `42d819b` · p1b-5 @ `3d81765` · p1b-6 @ `b9fd2a2`.
- **Anchor verification (done at close, HEAD after `8ad13b4`):** every `search`
  string in `mutations.json` — the fixed code each mutant attacked — was
  re-verified present in the current tree. All web sources are CRLF; every anchor
  is single-line or contiguous-line text, so matches are line-ending-convention
  independent. Recorded kill-assertion SPEC lines that have since drifted (later
  tasks appended to the shared spec files) are re-anchored below as
  `recorded :N → now :M`; unit-spec anchors from tasks 1–3 were verified
  UNDRIFTED.
- transcript reconciled (UTC): 2026-08-10.

## p1b-0-M1 — error.tsx boundary disabled (body replaced with `throw error;`)

**Source of record:** task-0-report.md §Verification item 4; ledger §p1b-0.

**Property under attack:** The route boundary is the LONG-TAIL net: a render
throw anywhere under layout.tsx must surface the route-refusal register
(visible, named, reset affordance) — never the generic white page. Disabling the
boundary (rethrow) restores the pre-fix whole-route loss.

```diff
--- web/app/error.tsx:17 (now-line)
-	return <RouteRefusal error={error} reset={reset} />;
+	throw error;
```
(applied via Serena `replace_symbol_body` in-task; grep confirmed no MUTANT
residue after revert)

`npm run build` + the p1b-0 spec in isolation on
`tests/playwright.p1b.config.ts` (command form reconstructed from the record's
"spec run in isolation"; rebuild explicit in the record).

Killed by:
  - the `route-refusal` visibility assertion — recorded p1b-fixes.spec.ts:69
    → now :87 (`await expect(refusal).toBeVisible()`)

**Result: KILLED** (as recorded in task-0-report.md / ledger §p1b-0)

## p1b-1-M1 — `wireBigInt` reverted to bare `BigInt` (try/catch)

**Source of record:** task-1-report.md §Mutation kills; ledger §p1b-1.

**Property under attack:** `wireBigInt` is the ONLY sanctioned string→bigint
path and it never coerces: `wireBigInt("")` is null where `BigInt("")` is a
silent `0n`. Reverting to bare BigInt resurrects the laundering class the
module exists to kill.

```diff
--- web/lib/wireGuard.ts:57 (now-line)
-	return isWireDecimal(value) ? BigInt(value) : null;
+	try { return BigInt(value); } catch { return null; }   (reconstructed from description)
```

`npx playwright test -c tests/playwright.p1b.config.ts --project=unit
tests/unit/wire-guard.spec.ts -g "THE COERCION KILL"` (in isolation)

Killed by:
  - `expect(wireBigInt("")).toBe(null)` — wire-guard.spec.ts:68 (verified
    UNDRIFTED); recorded received: `0n`

**Result: KILLED** (as recorded in task-1-report.md / ledger §p1b-1)

## p1b-1-M2 — `sideOf`'s null arm routed back to zero

**Source of record:** task-1-report.md §Mutation kills; ledger §p1b-1.

**Property under attack:** `badDebtRate.sideOf` refuses a malformed field BY
NAME before any arithmetic; `wireBigInt(...) ?? 0n` with the refusal reduced to
the scale check resurrects the "$0 of eligible debt" contradiction claim read
off a value nobody could read.

```diff
--- web/app/lab/badDebtRate.ts:69-71 (now-lines)
-	const bad = wireBigInt(aggregate.bad_debt_usd);
-	const eligible = wireBigInt(aggregate.eligible_debt_usd);
-	if (bad === null || eligible === null || !isWireScale(usdDecimals)) {
+	const bad = wireBigInt(aggregate.bad_debt_usd) ?? 0n;
+	const eligible = wireBigInt(aggregate.eligible_debt_usd) ?? 0n;
+	if (!isWireScale(usdDecimals)) {          (reconstructed from description)
```

`npx playwright test -c tests/playwright.p1b.config.ts --project=unit
tests/unit/bad-debt-rate.spec.ts -g "p1b-1: an EMPTY eligible"` (in isolation)

Killed by:
  - the refusal pin's field-naming assertion — bad-debt-rate.spec.ts:140
    (verified UNDRIFTED: `expect(model.before.reason).toContain("eligible_debt_usd")`);
    recorded: the coerced zero resurrected the "$0 of eligible debt" claim

**Result: KILLED** (as recorded in task-1-report.md / ledger §p1b-1)

## p1b-2-M1 — the classifier skips the aggregates group

**Source of record:** ledger §p1b-2 (task 2's ONLY record — no report file).

**Property under attack:** `classifyRunBookEngine` walks the WHOLE engine —
skipping the before/after aggregates readmits a malformed `total_debt_usd` to
the throwing renderer, and the route boundary takes the segment (the Codex r3
finding-1 defect verbatim).

```diff
--- web/app/lab/engineClassification.ts:172-173 (now-lines)
-	checks.push(...aggregateChecks("before", e.before));
-	checks.push(...aggregateChecks("after", e.after));
+	(both calls removed)
```

`npm run build` + the p1b-2 aggregate e2e pin in isolation (command form
reconstructed; rebuild explicit in the record).

Killed by:
  - the settle pin (`data-cell-state` = `"result"`) — recorded
    p1b-fixes.spec.ts:182 → now :315; recorded: the malformed
    `before.total_debt_usd` reached the throwing renderer and the boundary took
    the segment

**Result: KILLED** (as recorded in ledger §p1b-2)

## p1b-2-M2 — per-index naming replaced by a bare group name

**Source of record:** ledger §p1b-2.

**Property under attack:** Array fields are named PER INDEX
(`movers[2].hf_before_wad`) — a bare group name cannot tell the reader WHICH
row is unreadable.

```diff
--- web/app/lab/engineClassification.ts:193 (now-line)
-	checks.push([`movers[${String(index)}].${field}`, isNullableWireDecimal(mover[field])]);
+	checks.push([`movers.${field}`, isNullableWireDecimal(mover[field])]);
```

Unit per-index pin in isolation on the p1b config.

Killed by:
  - engine-classification.spec.ts:246 (verified UNDRIFTED) — expected
    `["movers[2].hf_before_wad"]`, received `["movers.hf_before_wad"]`

**Result: KILLED** (as recorded in ledger §p1b-2)

## p1b-2-M3 — `transitionChecks` drops the `hf_transitions.wad_scale` check

**Source of record:** ledger §p1b-2.

**Property under attack:** Controller addition 1: `hf_transitions.wad_scale` is
IN the inventory — Task 1's review proved an empty wad_scale passed
`readTransitions`' arithmetic untouched and wore a "0 entered / 0 exited"
costume.

```diff
--- web/app/lab/engineClassification.ts:119 (now-line)
-	["hf_transitions.wad_scale", isWireDecimal(transitions.wad_scale)],
+	(check removed)
```

Its OWN unit pin in isolation on the p1b config.

Killed by:
  - engine-classification.spec.ts:198 (verified UNDRIFTED) — expected
    `["hf_transitions.wad_scale"]`, received `[]`

**Result: KILLED** (as recorded in ledger §p1b-2)

## p1b-3-M1 — the classifier bypassed in `tornadoCellState`

**Source of record:** task-3-report.md §Mutation kills; ledger §p1b-3.

**Property under attack:** `tornadoCellState` classifies EVERY answered engine
before any reach arm: bypassing the classifier lets a malformed delta reach
`renderSignedUsdAmount` in the ledger, the route boundary takes the lab
segment, and no tornado header renders (the r3 finding-3 route-loss).

```diff
--- web/app/lab/tornadoCells.ts:331-336 (now-lines)
-	const malformed = result.engines.flatMap((engine, index) =>
-	  classifySetRunEngine(engine).malformedFields.map(
-	    (field) => `engines[${String(index)}].${field}`,
-	  ),
-	);
+	const malformed: string[] = [];      (reconstructed from description)
```

`npm run build` + the p1b-3 e2e in isolation (rebuild explicit in the record).

Killed by:
  - the route-stays-live pin (`tornado-header` visible) — recorded
    p1b-fixes.spec.ts:228 → now :230; recorded: the row fell through to
    `bars`, the boundary took the segment, no header rendered

**Result: KILLED** (as recorded in task-3-report.md / ledger §p1b-3)

## p1b-3-M2 — `barLength` reverted to bare `BigInt`

**Source of record:** task-3-report.md §Mutation kills; ledger §p1b-3.

**Property under attack:** `barLength` reads only through `wireBigInt`: bare
BigInt turns an empty denominator into `0n` and the NO DENOMINATOR sentence —
"carries no debt on the before side", a measurement claim off a value nobody
could read — and throws SyntaxError on `"-"`.

```diff
--- web/app/lab/tornadoCells.ts:524-525 (now-lines)
-	const numerator = wireBigInt(engine.eligible_debt_delta_usd);
-	const denominator = wireBigInt(engine.total_debt_usd_before);
+	const numerator = BigInt(engine.eligible_debt_delta_usd);
+	const denominator = BigInt(engine.total_debt_usd_before);
```

The no-coercion pin in isolation on the p1b config (unit,
set-run-outcome.spec.ts).

Killed by:
  - set-run-outcome.spec.ts:490 (verified UNDRIFTED) — expected the malformed
    arm, received `reason: "no-denominator"` with "debt_manager carries no debt
    on the before side": the coerced 0n resurrected the measurement claim

**Result: KILLED** (as recorded in task-3-report.md / ledger §p1b-3)

## p1b-4-M1 — the guard's `price_decimals` requirement dropped

**Source of record:** task-4-report.md §Mutation kills; ledger §p1b-4.

**Property under attack:** `price_decimals` is REQUIRED: an absent scale must
classify malformed, never reach `money()`'s no-scale branch where the raw
scaled integer wears the price costume WITH a health assertion attached — the
silent-wrong-display class, nothing throws.

```diff
--- web/lib/factorPriceGuard.ts:73 (now-line)
-	["price_decimals", isWireScale(entry.price_decimals)],
+	["price_decimals", entry.price_decimals === undefined || isWireScale(entry.price_decimals)],
```

`npm run build` + the p1b-4 deleted-decimals e2e in isolation.

Killed by:
  - the raw-digits absence pin, GROUPED spelling
    (`not.toContainText("370,370,370,371")`) — recorded p1b-fixes.spec.ts:437
    → now :438; the admitted entry reached money()'s no-scale branch and the
    raw integer re-wore the price costume. The `[null]` test stayed green,
    isolating the kill to the dropped requirement.

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1b-4)

## p1b-4-M2 — the card routes `{ok: false}` to the value arm

**Source of record:** task-4-report.md §Mutation kills; ledger §p1b-4.

**Property under attack:** The card consults `classifyFactorPrice` BEFORE the
first property read and routes `{ok: false}` to the `boundary-malformed` arm:
routing to the value arm instead makes the raw read throw on `prices: [null]`
(the card never paints) and re-renders the raw integer on a missing scale.

```diff
--- web/app/inspector/[addr]/InspectorPositionCard.tsx:434-435 (now-lines)
 	const classified = first === undefined ? undefined : classifyFactorPrice(first);
-	if (classified !== undefined && !classified.ok) {
+	(malformed branch disabled; value/not-established arms read the unclassified first)
 	                                          (reconstructed from description)
```

`npm run build` + both p1b-4 e2e tests in isolation.

Killed by (MULTI-VEHICLE — both tests died):
  - the `boundary-malformed` visibility pin — recorded p1b-fixes.spec.ts:407
    → now :408 (element not found — the raw read threw and the card never
    painted)
  - the deleted-decimals test also died at the grouped raw-digits pin
    (recorded :437 → now :438)

**Result: KILLED** (as recorded in task-4-report.md / ledger §p1b-4)

## p1b-5-M1 — `identityLine` drops the batch clause

**Source of record:** task-5-report.md §Mutation kills; ledger §p1b-5; logs
`web-3819-p1b5-mutM1-unit.log`, `web-3819-p1b5-mutM1-build.log`,
`web-3819-p1b5-mutM1-e2e.log`.

**Property under attack:** `identityLine` composes the FULL §5 identity in
canon order — dropping the batch clause un-binds the result from its batch on
the visible line, the under-identified-result defect the cross-page brief
names.

```diff
--- web/lib/resultIdentity.ts:61 (now-line)
-	return `results for ${subject} · batch #${String(id.batchId)} · config ${id.configVersion} · engines ${engines}`;
+	return `results for ${subject} · config ${id.configVersion} · engines ${engines}`;
```

`npx playwright test -c tests/playwright.p1b.config.ts --project=unit
tests/unit/result-identity.spec.ts`; then `npm run build` + the p1b-5 identity
e2e in isolation.

Killed by (MULTI-VEHICLE — unit AND e2e, as the brief required):
  - unit: the exact-composition pins — result-identity.spec.ts:33/:41/:47
    (3 failed / 4 passed in the log; received line missing ` · batch #18251`)
  - e2e: the batch-id pin — recorded p1b-fixes.spec.ts:512 → now :513 (test
    declared at :493 in the log; received `results for 0xAAaA… · config v1 ·
    engines aave_v3_etherfi`)

**Result: KILLED** (as recorded in task-5-report.md / ledger §p1b-5 / the mutM1 logs)

## p1b-5-M2 — `resultReceipt` wired to a CONSTANT receipt

**Source of record:** task-5-report.md §Mutation kills; ledger §p1b-5; log
`web-3819-p1b5-mutM2-unit.log`.

**Property under attack:** `resultReceipt` composes the receipt identity from
`served_at#batchId` (freshness.ts Wave R5 law) — a CONSTANT receipt never
re-anchors, so a new result would keep the old age's anchor.

```diff
--- web/lib/resultIdentity.ts:110 (now-line)
-	return { ageSeconds, receiptId: receiptIdentity(id.servedAt, id.batchId) };
+	return { ageSeconds, receiptId: "receipt" };
```

`npx playwright test -c tests/playwright.p1b.config.ts --project=unit
tests/unit/result-identity.spec.ts`

Killed by:
  - the receipt-composition pin — result-identity.spec.ts:91 (the p1b-5-M2
    pin; expected `2026-08-01T19:23:59Z#18251`, received `receipt`); the other
    6 tests stayed green, isolating the kill

**Result: KILLED** (as recorded in task-5-report.md / ledger §p1b-5 / the mutM2 log)

## p1b-6-M1 — `displayRatio` reverted to bare `BigInt`

**Source of record:** task-6-report.md §Mutation kills M1; ledger §p1b-6; log
`web-3819-p1b6-mutM1-unit.log`.

**Property under attack:** `displayRatio`'s num/den arm reads only through
`wireBigInt`: bare BigInt turns `hf.num: ""` into a PLOTTED 0.0 point — the
silent wrong chart point item 6 names; malformed must route to the existing
unpublished-gap arm (null), never a value.

```diff
--- web/lib/history-series.ts:92-95 (now-lines)
-	const den = wireBigInt(hf.den);
-	if (den === null || den === 0n) return null;
-	const num = wireBigInt(hf.num);
-	if (num === null) return null;
+	const den = BigInt(hf.den);
+	if (den === 0n) return null;
+	const num = BigInt(hf.num);       (reconstructed from description)
```

`npx playwright test -c tests/playwright.p1b.config.ts --project=unit
tests/unit/history-series.spec.ts`

Killed by:
  - both p1b-6 history-series pins — history-series.spec.ts:263/:273
    (2 failed / 17 passed in the log); discriminating assertion:
    `displayRatio({…, num: ""})` must be null, received 0

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1b-6 / the mutM1 log)

## p1b-6-M2 — the `isCurrent()` gate removed from FeedSurface's setters

**Source of record:** task-6-report.md §Mutation kills M2; ledger §p1b-6; log
`web-3819-p1b6-mutM2-e2e.log` (+ `-mutM2-build.log`).

**Property under attack:** The Feed gates envelope/refusal writes on the
dispatch's OWN epoch — removing the gate lets a stale walk's fully-received
page write its filter echo over the current walk (the deterministic
closed-stream race the init-script shim reproduces).

```diff
--- web/app/feed/FeedSurface.tsx:117 (now-line; the :123 refusal gate is the same mutation family)
-	if (isCurrent()) {
+	if (true) {                       (reconstructed from description)
```

`npm run build` + `npx playwright test -c tests/playwright.p1b.config.ts
--project=e2e -g "p1b-6"`

Killed by:
  - the race pin ONLY (1 failed / 5 passed) — p1b-fixes.spec.ts:571 (fix 2);
    assertion: the foot echo still names `types borrow,repay` after the held
    stale page releases

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1b-6 / the mutM2 log)

## p1b-6-M3 — the weld condition inverted (`!==` → `===`)

**Source of record:** task-6-report.md §Mutation kills M3; ledger §p1b-6; log
`web-3819-p1b6-mutM3-e2e.log`.

**Property under attack:** The history batch-weld renders ONLY on a real seam
(vantage ≠ position batch) — inverting the condition renders the weld on match
and hides it on mismatch; BOTH fix-4 pins must die, proving the count-0 pin
bites.

```diff
--- web/app/inspector/[addr]/InspectorHistory.tsx:113 (now-line)
-	state.lookup.response.batch.id !== positionBatchId
+	state.lookup.response.batch.id === positionBatchId
```

`npm run build` + `npx playwright test -c tests/playwright.p1b.config.ts
--project=e2e -g "p1b-6"`

Killed by (both fix-4 pins, per the brief; 2 failed / 4 passed):
  - the visible-arm pin — p1b-fixes.spec.ts:667
  - the count-0 pin — p1b-fixes.spec.ts:680

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1b-6 / the mutM3 log)

## p1b-6-M4 — the not-found computed clause removed

**Source of record:** task-6-report.md §Mutation kills M4; ledger §p1b-6; log
`web-3819-p1b6-mutM4-e2e.log`.

**Property under attack:** Item 7: the not-found stress arm states
`batch {id} · computed {computed_at}` verbatim (`lab-result-computed`) —
removing the clause re-opens the canon §05 face gap for the non-found
outcomes.

```diff
--- web/app/lab/LabClient.tsx:399-402 (now-lines; the not-found arm's clause)
-	<p className="mono dim" data-testid="lab-result-computed">
-	  batch {String(result.response.batch.id)} · computed{" "}
-	  {result.response.batch.computed_at}
-	</p>
+	(clause removed)                   (reconstructed from description)
```

`npm run build` + `npx playwright test -c tests/playwright.p1b.config.ts
--project=e2e -g "p1b-6"`

Killed by:
  - the item-7 pin ONLY (1 failed / 5 passed) — p1b-fixes.spec.ts:696;
    assertion: `lab-result-computed` toHaveText
    `batch 1 · computed 2026-07-29T10:00:00Z` (fixture bytes)

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1b-6 / the mutM4 log)

## p1b-6-M5 — the run-again phrase reverted to "refresh failed"

**Source of record:** task-6-report.md §Mutation kills M5; ledger §p1b-6; log
`web-3819-p1b6-mutM5-e2e.log`.

**Property under attack:** Item 8: the Lab age's blind resume says RUN AGAIN
(`AGE_UNKNOWN_RUN_AGAIN`) — the reverted phrase "refresh failed, data
retained" reports an attempt never made (the Lab wires no resume repair by the
p1b-5 sanctioned decision).

```diff
--- web/app/lab/LabClient.tsx:354 (now-line)
-	? AGE_UNKNOWN_RUN_AGAIN
+	? "age UNKNOWN since resume · refresh failed, data retained"   (reconstructed from description)
```

`npm run build` + `npx playwright test -c tests/playwright.p1b.config.ts
--project=e2e -g "p1b-6"`

Killed by:
  - the item-8 pin ONLY (1 failed / 5 passed) — p1b-fixes.spec.ts:725;
    assertion: `lab-result-age` toHaveText
    `age UNKNOWN since resume · run again to refresh` after a synthetic
    pagehide→focus blind resume

**Result: KILLED** (as recorded in task-6-report.md / ledger §p1b-6 / the mutM5 log)

## restore verification

Every task's record states its mutants were REVERTED in-task and the final tree
rebuilt and re-verified (tasks 0/2/3/4 additionally grep-checked for MUTANT
residue; task 3's final diff on tornadoCells.ts verified additive-only). The
close-time proof is global: each task's FULL-SUITE run on its final tree went
green at its recorded count (1417 → 1435 → 1455 → 1477 → 1495 → 1521 → 1538
enumerated / passed+skip at each seal), and the p1b-7 close run below repeats
the full suite green on the sealed tree — a surviving mutant in any of these
files would hold at least one of the seventeen kill assertions red.

## summary

| # | result | property (compressed) | killed by |
|---|---|---|---|
| p1b-0-M1 | **KILLED** | route boundary is the long-tail net — disabled boundary = whole-route loss | `route-refusal` visibility (p1b-fixes :69→:87) |
| p1b-1-M1 | **KILLED** | wireBigInt never coerces — "" is null, never 0n | wire-guard.spec.ts:68 |
| p1b-1-M2 | **KILLED** | sideOf refuses by name — never a "$0 eligible" claim off an unreadable | bad-debt-rate.spec.ts:140 |
| p1b-2-M1 | **KILLED** | classifier covers the aggregates group | settle pin (p1b-fixes :182→:315) |
| p1b-2-M2 | **KILLED** | per-index field naming | engine-classification.spec.ts:246 |
| p1b-2-M3 | **KILLED** | hf_transitions.wad_scale in the inventory | engine-classification.spec.ts:198 |
| p1b-3-M1 | **KILLED** | tornado cells classify before any reach arm | route-stays-live pin (p1b-fixes :228→:230) |
| p1b-3-M2 | **KILLED** | barLength never coerces — no measurement claim off "" | set-run-outcome.spec.ts:490 |
| p1b-4-M1 | **KILLED** | price_decimals REQUIRED — absent never raw-renders | grouped raw-digits pin (p1b-fixes :437→:438) |
| p1b-4-M2 | **KILLED** | {ok:false} routes to boundary-malformed, never the value arm | boundary-malformed visibility (:407→:408) + :437→:438 |
| p1b-5-M1 | **KILLED** | identityLine carries the batch clause | result-identity.spec.ts:33/:41/:47 + e2e (:512→:513) |
| p1b-5-M2 | **KILLED** | resultReceipt composes served_at#batchId, never a constant | result-identity.spec.ts:91 |
| p1b-6-M1 | **KILLED** | displayRatio: malformed num/den is a gap, never a plotted 0.0 | history-series.spec.ts:263/:273 |
| p1b-6-M2 | **KILLED** | feed setters gated on the dispatch's own epoch | p1b-fixes.spec.ts:571 |
| p1b-6-M3 | **KILLED** | the weld renders only on a real seam (both pins bite) | p1b-fixes.spec.ts:667/:680 |
| p1b-6-M4 | **KILLED** | not-found arm states batch · computed verbatim | p1b-fixes.spec.ts:696 |
| p1b-6-M5 | **KILLED** | blind resume says RUN AGAIN, never a refresh never attempted | p1b-fixes.spec.ts:725 |

**17 mutants, 17 killed, 0 survived** — reconciled from the task records (not
predicted, not re-run): p1b-0 ×1, p1b-1 ×2, p1b-2 ×3, p1b-3 ×2, p1b-4 ×2,
p1b-5 ×2, p1b-6 ×5.
