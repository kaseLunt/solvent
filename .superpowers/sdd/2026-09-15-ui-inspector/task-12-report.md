# Task 12 report — the Inspector page-test contract; old components and pins retired

Brief: `.superpowers/sdd/2026-09-15-ui-inspector/task-12-brief.md`. Executed 2026-09-16 on `main` at d88c0d0.

## Commit

**`a8d30a173f8603190573924dd94cf81b0a6f676d`** (`a8d30a1`), on `main`, parent `d1032e4`.

Message: `test(web): the Inspector page-test contract; the old position card, history card, activity list and their pins retired with ledger notes`. Staged and committed by explicit pathspec (17 paths, listed under "Files"). Scope gate: `scope-gate: OK -- integrator claude-integrator; 17 path(s)`. The first commit attempt hit another agent's `.git/index.lock` at the `git add` step (nothing staged, gate not yet run); retried once after five seconds per the brief and landed. Between the two attempts that agent's own commit landed as `d1032e4` ("fix(web): inspector page review round …"), so my commit sits directly on top of it.

## The contract run

- Run 1 (fresh `npm run build`, :3111 free): `14 passed, 1 failed (8.1s)` — the one failure was the brief's 503 pin (below), not the page.
- Run 2 (after the one expectation change): **`15 passed (4.0s)`**, `exit=0`.
- Run 3 (post-commit proof: fresh `npm run build` of HEAD `a8d30a1` on a clean tree, :3111 free): **`15 passed (3.9s)`**, `exit=0` — the contract holds against the committed page (`d1032e4` + this commit).

Command: `npx playwright test --project=e2e tests/e2e/inspector.spec.ts`.

### Expectation changed (one), with the reason

**503 dek pin.** The brief's spec asserted `await expect(dek(page)).toContainText("no servable batch")`. Observed (`inspector-verdict-dek`):

> No servable batch: the service refuses to answer from nothing (503). This is neither “no position” nor a position — an error is not an answer.

`toContainText` with a string is case-sensitive. `lib/inspector-headline.ts:164-170` (`unavailableLookupHeadline`) wraps the lookup error's message in `sentence(...)`, which sentence-cases it, and `tests/unit/inspector-headline.spec.ts:96-101` pins exactly the capitalised string above. The page is therefore right by the unit-pinned law and the brief's lowercase pin was the wrong expectation. Changed to:

```ts
await expect(dek(page)).toContainText("No servable batch: the service refuses to answer from nothing (503)");
```

No fixture number changed; no page file was touched.

**Same class, state-matrix `inspector × error:429`.** The brief's re-expression said the dek contains `rate limited (429)`. `lib/lookup-error.ts:12` builds `rate limited (429), retry after Ns` lowercase, and the same `sentence()` capitalises it on the page, so the cell pins `"Rate limited (429)"` (and `"an error is not an answer"`). The cell passes in the whole-suite run.

### Page defects found

None. Every test id in the brief's spec exists on the page and every text/attribute pin holds (after the 503 case correction above). No page file under `web/app/inspector/**` was modified beyond the four deletions the brief names.

## Static checks

`npm run typecheck` — clean (exit 0) · `npm run lint` — clean (exit 0) · `npm run lint:css` — clean (exit 0). Nothing outside the deleted files imported `AddressEntry`, `InspectorPositionCard`, `InspectorHistory`, `InspectorActivity` or `lib/inspector-lines` (one stale *comment* in `web/lib/factorPriceGuard.ts:14` still names `InspectorPositionCard`; not an import, left alone).

## The whole suite

`npm run build` (fresh, exit 0) → :3111 free → `npx playwright test`:

- **1429 passed, 10 skipped, 0 failed (21.6s)**, `exit=0`
- unit project: **1124 passed** (Plan 1 closed at 1,057; higher despite the retired `inspector-lines.spec.ts`)
- e2e project: **305 passed**, 10 skipped

## Files

Rewritten: `web/tests/e2e/inspector.spec.ts` (15 pins, the brief's spec verbatim except the 503 pin above).

Modified: `web/tests/e2e/shell.spec.ts`, `state-matrix.spec.ts`, `runbook-bsplit.spec.ts`, `p0-fixes.spec.ts`, `p1b-fixes.spec.ts`, `r1-fixes.spec.ts`; `.superpowers/sdd/progress-ui-overhaul.md` (ledger section appended under `## 2026-09-15 · Plan 2 (Inspector) — retirements`, the brief's lines verbatim plus a parenthetical on the three file deletions below).

Deleted: `web/app/inspector/AddressEntry.tsx`, `web/app/inspector/[addr]/InspectorPositionCard.tsx`, `web/app/inspector/[addr]/InspectorHistory.tsx`, `web/app/inspector/[addr]/InspectorActivity.tsx`, `web/lib/inspector-lines.ts`, `web/tests/unit/inspector-lines.spec.ts`; and `web/tests/e2e/r3-fixes.spec.ts`, `r4-fixes.spec.ts`, `r6-fixes.spec.ts` (see "Deviations").

## Re-expressed (by title)

- `shell.spec.ts` — the `SURFACES` row for `/inspector`: `h1: "Inspector"` → `h1: "Is this address at risk?"` (test `/inspector renders Inspector inside the shell`).
- `state-matrix.spec.ts` — `mockInspector` gains `**/v1/evidence*` (EVIDENCE_MANIFEST) and `**/v1/address/*/stress*` (`stress-dm.json`, read through the file's existing `labFixture` reader, which moved above the helper). Seven cells re-expressed against `inspector-surface[data-state]` and the pinned headlines:
  - `inspector × loading` — data-state `loading`, headline `Looking up this address…` (its stall list also stalls evidence and stress so the cell stays hermetic)
  - `inspector × ok:found-with-stale-price` — data-state `liquidatable`; `inspector-legacy` contains `stale price`
  - `inspector × empty:not-found-definitive` — data-state `no-position`; headline `No Cash or Aave position in batch 1.`; `main` not containing `Cannot say`
  - `inspector × refused:found-null-unknowable` — data-state `cannot-compute`; headline `Cannot say — the Cash book is withheld this batch.`; `main` not containing `No Cash or Aave position`
  - `inspector × ok:history-gaps-hoverable` — `inspector-history-legacy` visible; `inspector-history` contains `gaps drawn as gaps`
  - `inspector × error:429` — data-state `unavailable`; dek contains `Rate limited (429)` and `an error is not an answer` (mock also serves evidence and answers stress with the 429 envelope)
  - `inspector × responsive:mobile` — data-state matches `/liquidatable|near|healthy/`; `expectNoHorizontalOverflow` unchanged
- `runbook-bsplit.spec.ts` — `CLICKING a mover opens the Inspector's DYNAMIC route with that account on it`: click and URL assertion kept; the three old DOM assertions replaced by `inspector-address-input` `toHaveValue(DM_MOVER_ACCOUNT)`, `inspector-verdict` contains `truncateAddress(DM_MOVER_ACCOUNT)`, `inspector-surface` data-state matches `/liquidatable|near|healthy/`. `mockInspectorFor` gains `/evidence` (EVIDENCE_MANIFEST) and `/stress` (`stress-dm.json` re-identified to the mover's address, as the other bodies are).

## Retired (by title) — 24 e2e pins + the 19 old contract pins + 1 unit file

`inspector.spec.ts` (19 old pins, replaced by the contract): "found: the position layout renders, with the stale price verdict visible"; "the formula block is engine-correct — the aave law and the DM comparator, never shared"; "definitive none: the honest statement WITH lookup completeness shown"; "unknowable: cannot-be-established with the withheld engine NAMED — never 'no position'"; "history sparkline: a refused point is a GAP carrying its named reason"; "W-OBS: the HF sparkline is a measured, labelled instrument"; "W-OBS-B: an older sparkline label states WHICH batch; the meta keeps the refusal"; "W-OBS-B: a flat-at-1.0 series renders value and reference labels with disjoint boxes"; "drawer: opens from a number, locks body scroll, Escape closes and restores"; "activity: a null block_time falls back to the block number, never an invented time"; "landing: an invalid address is an inline refusal and never navigates"; "an invalid [addr] path segment is refused inline — nothing is looked up"; "r74 — the activity takeaway disclaims the untimed tail on the rendered page"; "INS-B: each engine's takeaway speaks its own comparator, and never the other's"; "INS-B: the lawful formula folds behind its named law; the REFUSED substitution never folds"; "INS-B: the proof card leads with the LIVE-vs-PROOF disclaimer; safe rows are counted-forensic"; "r77 — a never-swept DM renders its ∅ OUTSIDE the closed proof fold"; "r77 — a missing engine watermark renders OUTSIDE the closed proof fold"; "r77 — unacked epochs render OUTSIDE the closed proof fold".

`p0-fixes.spec.ts` (7): p0-3 › "the boundary row names health, shows the current mark, and never says Liquidation price"; p0-3 › "the evidence drawer is retitled"; p0-4 › "the DM history card is headed as a disclosure, the Aave card as a health factor"; p0-8 · absent boundaries › "(a) empty prices: the row states the boundary is not established — no health claim"; "(b) null lowest_healthy_price: a served FactorPrice without a boundary refuses too"; "(c) boundary_is_healthy false: the number and the mark render WITHOUT the assertion"; p0-9 › "finding 3: the observed prices:null solver-error serialization folds into the absent-boundary arm". Also removed: the `mockInspectorFound` / `mockInspectorBothHistories` helpers, the `DM_HISTORY_ENGINE` derivation, and the now-unused `../fixtures/inspector` import; header comment updated.

`p1b-fixes.spec.ts` (4): p1b-4 › "an entry-level null (prices: [null]) renders the malformed register — the card stays live"; p1b-4 › "a deleted price_decimals refuses — the RAW scaled integer never renders as a price"; p1b-6 › "fix 4: the history section welds its vantage to the position's batch when they differ"; p1b-6 › "fix 4: matching batches render NO weld — the line exists only for a real seam". Also removed: the `mockInspector` / `mockInspectorHistory` helpers and their types; the fixture import narrowed to `EVENTS` (still used by fix 2); section comments updated.

`r1-fixes.spec.ts` (8): "(2) THE BLOCKER: never_liquidatable NEVER renders beside a liquidatable verdict"; "(2) a HEALTHY never_liquidatable renders the axis-scoped badge with the wire reason"; "(12) the DM card renders its OWN totals — the em dashes were a rendering bug"; "(12) DM risk params render as PERCENTAGES in the engine's own 100e18 scale"; "(3) the Inspector states its own lookup's batch age"; "(11) the history head and meta line separate what PLOTS from what is witnessed"; "(11) an engine the account has NEVER touched renders one line, not an empty chart"; "(10) the adjudicated intros render, and the endpoint lines are demoted". Also removed: its `mockInspector` helper and the `../fixtures/inspector` import; header comment updated.

`r3-fixes.spec.ts` (3): "(1) THE ROUND-10 DEFECT: Aave's 10500 renders a 5% PREMIUM, never `105%`"; "(1) a 10600 multiplier is a 6% premium — the second REAL wire value"; "(1) the DM bonus is NOT par-based — its premium is the wire value itself".

`r4-fixes.spec.ts` (1): "(1) the Inspector reconciles its OWN lookup on resume — same law, its own envelope".

`r6-fixes.spec.ts` (1): "(2) the Inspector: same law, its own envelope — a failed repair, then a bounded retry that lands".

`tests/unit/inspector-lines.spec.ts`: deleted with `lib/inspector-lines.ts` (its `activityTakeaway` pins already live in `tests/unit/activity-rows.spec.ts`, per Task 7).

## Deviations from the brief (each deliberate, each reported)

1. **r3 / r4 / r6 deleted, not modified.** After retiring the named tests, each file held no test at all — only a header comment, imports and a mock helper that eslint would flag as unused. A test-less spec file is dead weight, so the files are deleted; the ledger lines are the brief's verbatim with a trailing parenthetical saying so. If the owner prefers the empty shells kept, restoring them is a `git checkout` of three files.
2. **Deletions staged by exact path, not `git add -u web/app/inspector`.** During the run another agent was editing `web/app/inspector/[addr]/{BackingTable,HistoryCard,InspectorDrawer,InspectorSurface,InspectorTiles,LegacyCard,MeasuredSparkline,StressTable,TrustCard}.tsx` and adding `money.ts` (the tree was clean there at my start; their work has since landed as `d1032e4`). The brief's directory-wide `-u` would have swept their then-uncommitted work into this commit, so the four deletions were staged by name and the commit pathspec names the same 17 paths. Nothing of theirs is in this commit (verified with `git diff --cached --name-status` before the gate; `git show --stat a8d30a1` lists exactly the 17).
3. **Two hermetic-mock additions beyond the brief's helper change** in `state-matrix.spec.ts`: the `loading` cell also stalls `/evidence` and `/stress`; the `error:429` cell serves the evidence manifest and answers `/stress` with the 429 envelope. Without them those requests would leave the mock and reach whatever listens on :8080.

## Concerns for the reviewer

- **Concurrent page edits during the run — resolved.** The build behind contract run 2 and the whole-suite run was compiled while the other agent's page changes were still uncommitted in the shared tree. Those changes have since landed as `d1032e4` (the ten page files, nothing else), and contract run 3 above was executed against a fresh build of the clean tree at HEAD `a8d30a1`: 15/15. The whole-suite figures (1429 / 10 / 0) were NOT re-run after `d1032e4` landed; the only diff between that build and HEAD is whatever `d1032e4` differs from their working tree at build time (expected: nothing), plus this commit's test-only changes. A reviewer wanting the whole-suite number on the exact HEAD can re-run `npx playwright test` after killing :3111.
- **r1 "(10)" also pinned non-Inspector copy.** That one test asserted the Lab, Observatory, Feed, Proof and Developers intro paragraphs and the "fed by" provenance-line placement, not only the Inspector landing intro. The brief names the whole block for retirement and that is what was done, so those five intro pins are now absent from e2e. If they should survive, they need re-homing (e.g. a surfaces-intro test without the `/inspector` arm).
- **`lib/factorPriceGuard.ts:14`** carries a stale comment naming the deleted `InspectorPositionCard`; a one-line comment fix for whoever next touches that module.

## Fix round 1

Review: `.superpowers/sdd/2026-09-15-ui-inspector/task-12-review.md` (Important 1–2, Minor 1–4; concerns 1–3 of the first round accepted as-is). Built on HEAD `3410c42`.

Commit: **`6d403ade9c42eb1bf85686e1fc255c763d9e722e`** (`6d403ad`, parent `3410c42`) — `fix(web): inspector contract round 1 - the resume pin counts the failed repair, the five surface intros re-homed, meta routed in the inspector mocks, ledger homes corrected`. Six paths, staged and committed by pathspec; scope gate OK. The other agent's uncommitted `web/tests/e2e/screenshots.spec.ts` change was left untouched and unstaged.

Verification (from `web/`): `npm run typecheck` clean · `npm run lint` clean · `npm run build` exit 0 (fresh, on 3410c42) · :3111 free · `npx playwright test --project=e2e tests/e2e/inspector.spec.ts tests/e2e/r1-fixes.spec.ts tests/e2e/state-matrix.spec.ts tests/e2e/runbook-bsplit.spec.ts` → **78 passed (6.6s)**, exit 0.

Per item:

1. **Resume pin can now fail** (`inspector.spec.ts` "resume: a failed background repair never replaces the rendered position"). The aborting address route counts (`addressRequests += 1; return route.abort()`); the `waitForTimeout(500)` is gone, replaced by `await expect.poll(() => addressRequests).toBe(1)`; the two state pins (`data-state` still `near`, debt tile still `$4,822`) are kept. **Trigger needed: none beyond the plain `pageshow` with `persisted: true`.** `lib/freshness.ts` `resumeEvidenceOf` returns `"definitive"` for a persisted pageshow without consulting the clocks, and the tracker's first definitive signal is never an echo (`lastReconcileProven` starts false), so the reconcile runs and `lib/address-lookup.ts` re-fetches; the poll observed exactly one aborted request (test line: `✓ resume: a failed background repair never replaces the rendered position (560ms)`). The r4-style burst (`git show d1032e4:web/tests/e2e/r4-fixes.spec.ts` — `page.clock.install` + pageshow/visibilitychange/focus) was therefore not required. Race check: the bounded retry schedule is `RESUME_RETRY_DELAYS_MS = [5_000, 15_000]`, so the first retry cannot reach the counter before a 100 ms-interval poll sees 1.
2. **Five intro pins re-homed** (`r1-fixes.spec.ts`): new test `(10) the adjudicated intros render — Lab, Observatory, Feed, Proof, Developers (the Inspector arm retired under Plan 2)` asserting the exact five `main` paragraphs from the retired body (`git show d1032e4:web/tests/e2e/r1-fixes.spec.ts` lines 411–443), with no `/inspector` arm and no "fed by" placement check. The file header now lists (10) as a surviving item with its Inspector arm retired, and names `history-copy` among the unit homes. Ledger line for r1 updated accordingly (see 5).
3. **`web/lib/factorPriceGuard.ts:14`** — comment only: "by the card's boundary row (InspectorPositionCard)" → "by the boundary derivation (`boundaryOf`, inspector-position.ts)". `find_referencing_symbols` on `classifyFactorPrice`: consumers are `lib/inspector-position.ts` (`boundaryOf`) and `lib/evidence.ts` (`liquidationPriceEvidence`), plus `tests/unit/factor-price-guard.spec.ts`. No code change.
4. **Minor 1 — `/v1/meta` routed**: `state-matrix.spec.ts` `mockInspector` and `runbook-bsplit.spec.ts` `mockInspectorFor` now serve `**/v1/meta*` with `DEMO_META` from `../fixtures/demo` (neither file served a meta body for any other surface).
5. **Minor 2 + 3 — ledger text** (`.superpowers/sdd/progress-ui-overhaul.md`): the r1 line now says the never-touched-engine law's home is `tests/unit/history-copy.spec.ts` (`engineNeverPresent`, consumed by `app/inspector/[addr]/HistoryCard.tsx`) and that only the Inspector arm of "(10)" retired, naming the re-homed test; the `inspector-lines.spec.ts` line gains the clause `lookupTakeaway re-expressed in tests/unit/inspector-headline.spec.ts; positionTakeaway / positionMethodLine retired with the position card`.
6. **Minor 4 — Prices chip pin unchanged.** `web/components/kit/IdentityChips.tsx` renders the chip with `className` (tone → `styles.chipWarn` etc.), `title` and `data-chip` only; there is no `data-tone` attribute on the element, so `toHaveClass(/chipWarn/)` stays (no attribute was added to the page, per the instruction).

Not done (out of this round's scope): review Minor 5 (the "liquidatable and healthy" test leaves the near account's history/stress bodies under the other two addresses) — brief-verbatim, noted by the reviewer as note-only.
