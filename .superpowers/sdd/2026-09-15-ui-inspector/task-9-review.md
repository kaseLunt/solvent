# Task 9 review: `inspector-view` — one view model for the surface and the tests

Reviewed: commit `4bdade3` (review package `review-58d5502..4bdade3.diff`; two new files, `web/lib/inspector-view.ts` 197 lines and `web/tests/unit/inspector-view.spec.ts` 196 lines; no existing file touched).
Inputs read in order: `task-9-brief.md`, `task-9-report.md`, the diff. Cross-read with Serena: `inspector-position.ts`, `room-history.ts`, `inspector-headline.ts`, `trust.ts`, `address-lookup.ts`, `cash-view.ts`, `wireGuard.ts`, the client's `lookup.ts` / `refine.ts`, the fixtures, and the landed consumers under `web/app/inspector/[addr]/` (to calibrate what the view's outputs actually print).

Verification I ran (read-only, from `web/`):

- `npx playwright test --project=unit tests/unit/inspector-view.spec.ts` → 6 passed.
- `npx eslint lib/inspector-view.ts tests/unit/inspector-view.spec.ts` → exit 0, no output.
- `npx tsc --noEmit` → exit 0.
- A scratchpad probe harness (outside the repo) that calls `deriveInspectorView` on nine edge inputs the brief's six tests do not cover; outputs quoted below as P1–P9.

**SPEC: ✅** (both deviations judged correct on behavior)
**QUALITY: needs-fixes** (one Critical, three Important, five Minor)

---

## A. Spec compliance

### A.1 The `InspectorView` interface (`web/lib/inspector-view.ts:45-77`)

| Field | Brief | Landed | |
|---|---|---|---|
| `InspectorState` ten literals | yes | `:45-55`, same ten in the same order | ✅ |
| `state, kicker, headline, chips` | | `:58-61` | ✅ |
| `batchId: number \| null; decimals: number` | | `:62-63` | ✅ |
| `cash: CashPosition \| null; cashWire, legacy: RefinedPosition \| null` | | `:64-66` | ✅ |
| `table, boundary, trust` nullable | | `:67-69`; `Boundary` is imported as the six-arm union incl. `contradictory` (`inspector-position.ts:170-177`) and the view has no switch over it — it passes through | ✅ |
| `room, streak, historyBatchId` | | `:70-72` | ✅ |
| `refusedTiles, floor, tier, ageSeconds` | | `:73-76` | ✅ |
| `deriveInspectorView(reading, constants)` signature | | `:90` | ✅ |

Module body is the brief's listing verbatim (diffed by eye against the brief, line for line). The report's claim "verbatim" holds.

### A.2 Lens constraints

- **Outcome decides, never a count.** `:104` reads positions only when `outcome === "found"`; `:153` `not-found → no-position`; `:156` `unknowable → cannot-compute`. ✅ (But see Critical 1 and Important 4: two arms downstream of `found` do end up asserting a Cash negative from an absence.)
- **Engine's verdict decides.** `:172` `state = cash.status` where `status` comes from `readCashPosition` (`inspector-position.ts:73-80`, `liquidation_verdict` first, then the band). A refused Cash → `:162-170` `not-computed`, `refusedTiles` `:192` true; the last readable debt reaches only the dek (`notComputedHeadline`, `inspector-headline.ts:123`). Tiles honour it (`InspectorTiles.tsx:32-58` print "—" under `refusedTiles`). ✅
- **Identity chips.** Batch `:144` is the lookup's own `batch.id` through `readWirePopulation` (`:100`). Snapshot `:145` from the lookup's anchored `reading.age` — `unresolved → null → "age unknown"` in the refused tone. Lookup chip `:136-141`: withheld (refused) / complete (ok) / floor (warn). Prices `:142,147` from the Cash position's `price_inputs`, else the legacy's, never elsewhere. ✅
- **`tierTone` identical to the Book.** `:88` vs `cash-view.ts:103-104`: same ternary, `stale` and `critical` both → `crit`. ✅
- **Room keyed to the HISTORY's vantage.** `:116-128`: vantage from `h.batch.id`, `known` from the history's own points and withheld ids across its engines, never `batchId` of the lookup. Pinned by the last test (`spec:182-196`, lookup 3 / history 2 → `[0, 1, 2]`). ✅
- **Every population guarded.** `batch.id` `:100`, `history.batch.id` `:118`, each `p.batch_id` `:123`, each `withheld_batch_ids[]` `:124` → `readWirePopulation`. `roomSeries` guards `knownBatchIds[]` again (`room-history.ts:116`) — belt and braces, as Task 5's review predicted. ✅
- **No `Number()` on a wire decimal.** None in the file; `n()` (`:79`) is `toLocaleString` on a guarded population. ✅
- **`web/lib/**` existing files untouched.** Commit stat: two additions only. ✅

### A.3 The six tests (`web/tests/unit/inspector-view.spec.ts`)

| Test | Lines | Result | Notes |
|---|---|---|---|
| invalid / loading / unavailable | `:79-93` | ✅ | Identity chip values `nothing looked up` / `pending` / `unavailable`; `unavailableLookupHeadline` capitalises the message. |
| near cap, everything from one reading | `:95-119` | ✅ | Chips array exact; `streak {3, 120, "computed"}`; `historyBatchId` 2 (Deviation 1). |
| contract fixture: liquidatable beside legacy | `:121-127` | ✅ | `boundary.kind === "breached"` from `boundaryOf` (`inspector-position.ts:200`). |
| legacy-only / not-computed / no-position / cannot-compute | `:129-159` | ✅ | `plainCause("SWEEP_FAILED", …)` returns the phrasebook entry (`refusal-phrasebook.ts:12-17` ignores detail for a known code), so the dek matched the brief without the fallback. |
| floor rides the dek + Lookup chip; unresolved age | `:161-180` | ✅ | Only pins the floor for the **computed-Cash** arm — see Critical 1 / Important 2 for the arms it does not cover. |
| room keyed to the history's vantage | `:182-196` | ✅ | Deviation 1 numbers. |

### A.4 Deviation 1 — history vantage 1 → 2: **right**

The brief's `dmHistory(addr, 1)` yields point ids `1, 0, −1` and asserts `[-1, 0, 1]`. A batch id is a wire population: `isWirePopulation` (`wireGuard.ts:151-158`) rejects anything negative, and three independent guards would throw — the view's own `:123`, `pointFor` (`room-history.ts:64`), and `roomSeries`'s `knownBatchIds[]` (`:116`). The law is Task 5's, landed and reviewed; the fixture was the planning slip (the progress ledger `:64` already records it as such). The implementer's re-derivation checks out: `known = {2, 1, 0}` → points `[0, 1, 2]`, `computedCount 3`, `computed_at` indexed by `k` so span = 120 s, headroom 38 / 72 / 72 tenths all under 100 → `batches 3`. The last test's intent — a lookup batch newer than the history's vantage with **no** `no-row` gap invented for it — is preserved exactly with 3 / 2.

One side effect worth a comment, not a fix: in the "near cap" test (`spec:98`) the history (vantage 2) is now *newer* than the lookup (batch 1). Realistic in flight, but the reverse of the narrative in the last test; a one-line comment or using lookup batch 3 there too would keep the two tests telling the same story (Minor 9).

### A.5 Deviation 2 — `nearWire()` discards → checked invariants: **right**

Semantics are byte-identical (`liquidation_verdict` and `collateral_use` dropped; `liquidatable: false` and `used_as_collateral: true` added). The two `throw`s pin that the raw values substituted are the refined values' own raw forms, which is documentation the brief's `_v`/`_c` did not give. ESLint config confirmed (`web/eslint.config.mjs`: Next `core-web-vitals` + `typescript`, nothing else, so no `_` ignore pattern); both files lint clean. Accept.

---

## B. Code quality

Severity is judged against the lens constraints and against what the landed consumers (`InspectorSurface`, `BackingTable`, `InspectorTiles`, `HistoryCard`) actually print from the view.

### Critical

**1. `inspector-view.ts:159-161` — a withheld Cash book beside a found legacy position renders as "No Cash position".**

- Input (legal FLOOR body per `lookup.ts:82-95`; served through `lookup()` unchanged): `found([AAVE_RAW], { lookup_complete: false, withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", … }] })`.
- Output (probe P1): `state "legacy-only"`, emphasis **"No Cash position in batch 1; a legacy Aave v3 position exists."**, dek = `LEGACY_DEK` only, `floor` = "Lookup incomplete: the Cash book is withheld, so more positions may exist." (set on the view but absent from the dek), Lookup chip `floor · Cash withheld` (warn).
- Why it is wrong: the module's own header (`:5-6`) says "a withheld book is never 'no position'", and the lens says "a `found` with `complete: false` is a FLOOR and the dek says so". Here the verdict header asserts a definitive Cash negative about a book the service withheld, and contradicts its own Lookup chip two lines below. `otherEngineHeadline` (`inspector-headline.ts:130-161`) has no floor parameter and no notion of a withheld engine; the view hands it `[...engines]` and nothing else.
- Fix: in the `cash === null` arm, branch on `lookup.withheldEngines.some((w) => w.engine === CASH)`. When true: `state = "cannot-compute"` (keep `legacy` populated so `LegacyCard` still renders and the `data-state` says what the Cash answer is), headline in the cannot-compute register that also names the legacy position — e.g. emphasis `Cannot say — the Cash book is withheld this batch; a legacy Aave v3 position exists.`, dek = the withheld cause + "A withheld book is never “no position”…" + `LEGACY_DEK`. That is a small new arm in `inspector-headline.ts` (Task 6's file; a `legacy: boolean` option on `cannotComputeHeadline` is enough). Pin it: the emphasis must not contain "No Cash position"; the dek must end with `floor`.

### Important

**2. `inspector-view.ts:162-170` — the floor is not said in the `not-computed` arm.**

- Input (probe P4): refused Cash position + `lookup_complete: false, withheld_engines: [aave]`.
- Output: `floor` set; dek "Collateral sweep failed. Its last readable debt is $4,100; no verdict is served for it." — no floor sentence. Only `cashHeadline` (`inspector-headline.ts:55-91`) threads `extras.floor`; `notComputedHeadline` (`:117-125`) and `otherEngineHeadline` (`:130-161`) do not.
- Fix (one place, covers Critical 1's dek half too): after the state block, `if (floor !== null && state !== "cannot-compute") headline = { ...headline, dek: paragraph-join(headline.dek, floor) }`; or add a `floor` parameter to both headline functions like `cashHeadline`. Pin: `refused + legacy withheld` → `dek.endsWith(floor)`.

**3. `inspector-view.ts:133-134` — `boundary` (and `table`) are live for a Cash position the view itself calls `not-computed`.**

- Input (probe P3): `nearWire({ liquidatable: null })` — `status: "computed"`, verdict `unknowable`. Out of contract for the Debt Manager's strict boolean, but the view has an explicit arm for it (`:166-167` "the engine published no verdict for this account").
- Output: `state "not-computed"`, `refusedTiles true`, **and** `boundary = { kind: "boundary", sentence: "Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat." }`, `table.capAgrees true`, `trust[0] = { id: "computed", state: "ok", detail: "batch 1" }`. `boundaryOf` gates only on `cash.computed` (`inspector-position.ts:199`), not on `isComputedCash`, so the unknowable-verdict case walks the solve. `BackingTable.tsx:93-95` prints the boundary whenever `table !== null` — a Cash-derived liquidation boundary under "Cannot say — this account's Cash position was not computed this batch." The Trust card simultaneously says "Computed this batch · ok". Three contradicting registers on one page.
- Fix: `const boundary = cash !== null && isComputedCash(cash) ? boundaryOf(cashWire, cash) : null;` (or move the gate into `boundaryOf`). Decide `table` the same way or leave it (legs are wire facts) and have `BackingTable` gate the cap row and boundary on `refusedTiles`. For the wording, the `unknowable` cause should not claim the row was uncomputed — "the engine computed this position but published no verdict for it" — the emphasis itself is `notComputedHeadline`'s fixed string (Task 6), so at minimum fix the cause text and null the boundary.

**4. `inspector-view.ts:159-161` — `found` with `positions: []` becomes `legacy-only` with `legacy: null`.**

- Input (probe P2): `found([])`. The client's `lookup()` does **not** enforce `found: true ⇒ positions.length ≥ 1` (`lookup.ts:181-183`), so the body is servable through the client; the API should never emit it, but the view's stated posture toward out-of-contract input is "refused before render" (`:100`).
- Output: `state "legacy-only"`, emphasis "No Cash position in batch 1." (the defensive arm of `otherEngineHeadline`, `:150-153`), dek `FOREIGN_DEK`, Lookup chip "complete · both engines", `legacy: null`. `data-state="legacy-only"` with no legacy is a false label, and the emphasis is a definitive Cash negative derived from an empty list — the very "counting positions" the lens forbids. Mapping it to `no-position` would be the same sin.
- Fix: refuse the contradiction the way a bad batch id is refused: `if (lookup.outcome === "found" && positions.length === 0) throw new WireIntegerError("found: true with no positions — out of contract, refused before render")` (or a sibling `ContractInvariantError`), and file a client follow-up to add the invariant to `lookup()` so every consumer gets it.

### Minor

**5. `inspector-view.ts:164-169` — the non-refusal cause text names the wrong missing thing.**
"the engine published no cap for this account" fires for every `!computed && refusal === null && status !== "unknowable"` case: probe P6 (`borrowings: null`, cap `"5012500000"` present) prints "The engine published no cap for this account." while the cap is on the wire; a `status: "refused"` row with `refusal: null` gets the same sentence. `readCashPosition` (`inspector-position.ts:64-69`) folds all of these into `status: "refused", computed: false`. Fix: derive the cause from what is actually null — `cash.cap === null ? "no cap" : cash.debt === null ? "no debt figure" : "refused without a code"` — mirroring `computedItem`'s "refused without a code" (`trust.ts:88`).

**6. `inspector-view.ts:108` — `decimals` is the Cash default (6) in `legacy-only`.**
The only position is the 8-decimal legacy one. Nothing prints wrong today (`InspectorSurface.tsx:34-38` reads `view.legacy.value_decimals` for the activity scale), but the interface field is undocumented. Document it as "the Cash position's `value_decimals`, 6 when none" or make it `number | null`.

**7. `inspector-view.ts:116-128` — the history's own outcome is not in the model.**
`room === null && historyBatchId === null` for a history that is `not-found`, `unknowable` (probe P8), or errored; `room === null` with `historyBatchId` set when the history is `found` but has no Cash engine (probe P9). `HistoryCard.tsx:37-38` prints "No Cash history for this account in the covered window." for every `room === null` — for an `unknowable` history (a withheld Cash book over the window) that is the forbidden conflation. That is Task 11's defect to fix, but the brief calls this "one model for the surface and the tests"; expose `historyOutcome: LookupOutcome | null` (or `historyWithheld: EngineRefusal[]`) so the card can say "withheld" without re-deriving from `reading`.

**8. `inspector-view.spec.ts:9,195` — a no-op assertion keeps two imports alive.**
`expect(void DM, void AAVE).toBeUndefined()` exists only so `DM` and `AAVE` count as used. Deviation 2 was made for lint hygiene; this hack (from the brief) undoes the point. Drop the two imports and the line.

**9. `inspector-view.spec.ts:98` — the "near cap" test's history is newer than its lookup.**
Vantage 2 against lookup batch 1, the reverse of the last test's narrative. Either lookup batch 3 there too, or a comment saying it is deliberate.

### Probed and found honest (no finding)

- **`known` set across engines** (`:121-125`): includes other engines' points and withheld ids by design. A `found` history with **no** Cash engine → `room: null` (P9): no `no-row` gaps are invented for an engine the history did not serve. A Cash engine with **zero** points beside legacy points at 2 and 1 (P5) → `room.points = [1:no-row, 2:no-row]`, `computedCount 0`, `streak { batches: 0, spanSeconds: null, newestKind: "no-row" }`; `cashHeadline` prints no streak sentence for `batches < 2`. An absence is a gap — the plan's stance.
- **`nearCapStreak` on an empty series**: `roomSeries` never returns an empty series here (the vantage is always in `known`), but if it did, `newest` is null and the streak is `{0, null, null}` (`room-history.ts:136-156`).
- **Prices chip when both exist** (`:142`): Cash wins, per R2 and the brief; the legacy card carries its own price story.
- **`refusedTiles` for `legacy-only`** (`:192`): true → tiles "—" and the Status tile "—" (`InspectorTiles.tsx:64-66`). Fine.
- **Kicker for a refused Cash** (`:178`): "Cash · account …" — right, a Cash row exists.
- **Floor grammar for two withheld engines** (P7): "the Aave v3 market (legacy) and other_engine books are withheld" — `engineList` + the `s are` plural. Correct (and unreachable with two engines in the real world).
- **`evidence?.reconcile ?? null`** (`:132`): `EvidenceManifest.reconcile` is `ReconcileSummary | null` (`evidence.ts:536-538`), the exact `TrustInput.reconcile` type.
- **`age.refreshFailed`** is not surfaced — same as `deriveCashView` (`cash-view.ts:101`); "age unknown" in the refused register covers the state. Consistent; not a Task 9 requirement.

---

## Summary for the parent

The module is the brief verbatim, the six tests pass, lint and typecheck are clean, and both documented deviations are correct calls. The quality gaps are in what the brief's listing did not consider: two `found` arms (`legacy-only`, `not-computed`) drop the floor from the dek, and one of them prints a definitive "No Cash position" over a withheld Cash book (Critical 1). Fixes are small (a withheld-Cash branch in the `cash === null` arm, one dek-append for the floor, an `isComputedCash` gate on `boundary`, a refusal for `found` + empty positions) and each wants a pin.

---

## Re-review (f013695)

Scope: the fix round for the nine findings above, commit `f013695` (two files: `web/lib/inspector-view.ts` +41/−2, `web/tests/unit/inspector-view.spec.ts` +58/−7), read with `git show f013695` and the report's "Fix round 1" section. Verified: HEAD is `f013695`, both files clean in the tree; `npx playwright test --project=unit tests/unit/inspector-view.spec.ts` → 7 passed; `npx eslint` on the two files → exit 0; `npx tsc --noEmit` → exit 0. The scratchpad probe from round 1 was rerun against the fixed module with three added cases (P10–P12); outputs quoted below.

**RE-REVIEW: open** — eight of nine addressed and matching the rulings; #5 is implemented against the wrong source and still misnames what is missing.

### Per finding

| # | Ruling | Landed | Verdict |
|---|---|---|---|
| C1 | found + Cash withheld + no Cash position → `cannot-compute`, `cannotComputeHeadline(Cash refusal only)`, legacy sentence appended when a legacy position exists | `inspector-view.ts:179-183`: new arm `cash === null && cashWithheld` before `legacy-only`; `cannotComputeHeadline(withheldEngines.filter(engine === CASH))`; dek + " A legacy Aave v3 position exists; it is judged by its own health factor, below." when `legacy !== null`; `legacy` stays populated. Probe P1: state `cannot-compute`, emphasis "Cannot say — the Cash book is withheld this batch.", dek "Collateral-flag custody unproven. A withheld book is never “no position”… A legacy Aave v3 position exists; …". Pinned `spec:205-221`. | ✅ |
| 2 | `not-computed` and `legacy-only` deks append the floor | `:167-168` `withFloor`; applied `:186` and `:200`; single-space join, same as `cashHeadline`. Probe P4: dek ends with the floor sentence. Pinned `spec:222-235` (`dek.endsWith(floor)`). | ✅ |
| 3 | `boundary` only when `isComputedCash(cash)` | `:148-150`; `table` left as wire facts (per ruling). Probe P3 (`liquidatable: null`): `boundary: null`, state `not-computed`. Pinned `spec:236-239`. | ✅ |
| 4 | `found` + `positions: []` → `unavailable`, "the response contradicts itself" | `:102-110`, checked before any read of `batch.id`; `unavailableLookupHeadline` puts the message in the dek (`inspector-headline.ts:169`). Probe P2: state `unavailable`, dek "The lookup says found but lists no position — the response contradicts itself. This is neither “no position” nor a position — an error is not an answer." Pinned `spec:240-243`. | ✅ |
| 5 | not-computed cause derived from what is null | `:189-199` ladder reads `cash.cap` / `cash.debt`. **But `readCashPosition` forces `cap: null` on every non-computed row** (`inspector-position.ts:69` `return { ...base, cap: null, … status: "refused", computed: false }`), so the ladder reads a null the reader manufactured, not the wire. Probe P6 (`borrowings: null`, `max_borrow_lt: "5012500000"` on the wire): "The engine published **neither a cap nor a debt** for this account." Probe P10 (`status: "refused"`, `refusal: null`, both figures on the wire): "The engine published **no cap** for this account." — while the Trust card's `computedItem` says "refused without a code" for the same row (`trust.ts:88`). Probe P11 (`borrowings: "-5"`, cap on the wire): "The engine published no cap for this account. Its last readable debt is −<$0.01; …" — the cap is published, and a negative wire decimal (which `readCashPosition:63` itself calls "not a position") is printed as a readable debt. The "no readable debt" branch (`:199`) is unreachable because `cash.cap` is never non-null here. | ❌ open |
| 6 | `decimals` documented as the Cash position's (6 when none) | `:63` doc comment. | ✅ |
| 7 | `historyOutcome: "found" \| "not-found" \| "unknowable" \| null` | `:74-75` field; `:129` set from `reading.history.value.outcome` when ready, null otherwise; `empty()` `:87` null. Pinned `spec:124` (`"found"`) and `:220` (`null` while loading). | ✅ |
| 8 | no-op line and imports dropped | `spec:9` imports only `near`; the `expect(void DM, void AAVE)` line is gone. Lint clean. | ✅ |
| 9 | near test's lookup (3) newer than its history (2) | `spec:98-103` lookup batch 3, comment says so; Batch chip "3", `batchId` 3, `historyBatchId` 2, room `[0, 1, 2]`, streak unchanged `{3, 120, "computed"}`. | ✅ |

### The scope guarantee: no arm prints a Cash negative while Cash is in `withheldEngines`

Walked every arm under `outcome === "found"` with `cashWithheld` true:

- Cash position absent, legacy present → C1 arm, "Cannot say — the Cash book is withheld this batch." (probe P1).
- Cash position absent, only a foreign engine present → C1 arm, same emphasis, no legacy sentence (probe P12: `state "cannot-compute"`, kicker "Account …", `legacy: null`).
- No positions at all → refused as `unavailable` before the arm is reached (probe P2).
- Cash position present while Cash is withheld → a wire contradiction; falls into the Cash arms and prints the Cash verdict, never a negative.
- `not-found` cannot carry a withheld engine (`lookup.ts:185-200` requires `complete`, and `complete` forbids withheld engines); `unknowable` is `cannot-compute` unchanged.

The only remaining sources of "No Cash…" / "No Cash or Aave…" are `noPositionHeadline` (reached solely from `not-found`) and `otherEngineHeadline` (reached solely when `cashWithheld` is false). The guarantee holds.

### Regressions

None found. The five pre-existing tests pass unchanged except the near test's deliberate batch move; `legacy-only` with a complete lookup is unchanged (`withFloor` is a no-op when `floor === null`); `cannot-compute` from `unknowable` is unchanged; `kicker`, `refusedTiles`, `trust`, `table`, chips and the room block are untouched. One surface note for Task 11, not a Task 9 regression: for the empty-found refusal the view says `unavailable` while `InspectorSurface.tsx:32` computes `found` from `reading.lookup` directly and would still show the drawer button; the surface should key that on `view.state` or `view.cash`.

### Still open

**1. Minor 5 — `inspector-view.ts:189-199` — the cause ladder reads `CashPosition.cap`, which the reader nulls on every refused row, so a published cap is reported as missing (probes P6, P10, P11).** Derive from the wire and the status, in this order: `cashWire.status !== "computed" && refusal === null` → "refused without a code" (matches `trust.ts:88`); `cash.status === "unknowable"` → "published no verdict" (already right); then read `cashWire.max_borrow_lt` and `cashWire.borrowings` through `isWireDecimal` (or have `readCashPosition` retain the wire cap on its refused arm — Task 3's file) to choose "neither a cap nor a debt" / "no cap" / "no readable debt"; a negative cap or debt → "a negative cap/debt on the wire — not a position", and suppress the "last readable debt" clause when `cash.debt < 0n`. Pin P6 and P10 (P11 optionally). The accepted residue (the fixed "was not computed" emphasis for the unknowable-verdict row) is unchanged and stays ledgered.

---

## Re-review 2 (d88c0d0)

Scope: the one open item from the f013695 re-review (Minor 5, the not-computed cause ladder reading the reader's forced nulls), commit `d88c0d0` (`web/lib/inspector-view.ts` +41/−13 incl. the removed inline ladder, `web/tests/unit/inspector-view.spec.ts` +13), read with `git show d88c0d0` and the report's "Round 2" section. Verified: HEAD is `d88c0d0`, both files clean; `npx playwright test --project=unit tests/unit/inspector-view.spec.ts` → 8 passed; `npx eslint` on the two files → exit 0; `npx tsc --noEmit` → exit 0. The scratchpad probe was rerun against the new module.

**RE-REVIEW: all-addressed.**

### The ladder against the ruling (`inspector-view.ts:93-115`, `notComputedCause`)

| Ruling step | Landed | |
|---|---|---|
| refusal object → `plainCause` | `:104` `cash.refusal !== null` | ✅ |
| refused without a code (status not computed, no refusal) | `:105` `wire.status !== "computed"` → "the engine refused this row without a code" — the same reading `trust.ts:88` gives the Trust card, so the two registers agree on one page | ✅ |
| no verdict (`unknowable`) | `:106` | ✅ |
| `max_borrow_lt` / `borrowings` through `isWireDecimal` → neither / no cap / no readable debt | `:107-111`; `isWireDecimal` imported from `./wireGuard` (`:43`) | ✅ |
| a negative figure → "not a position" | `:112` `cap < 0n \|\| debt < 0n` | ✅ |
| "last readable debt" only when `cash.debt !== null && cash.debt >= 0n` | `:214` `lastDebt` | ✅ |
| accepted deviation: `wire: RefinedPosition \| null`, null guard and unreachable end return one constant, commented | `:94` `NOT_COMPUTED_UNSAID`; `:102-103` guard; `:113-114` end — both commented as unreachable beside a read position | ✅ |

### The probes

| Probe | Round-1 output (f013695) | Now (d88c0d0) | |
|---|---|---|---|
| P6 `borrowings: null`, cap on the wire | "neither a cap nor a debt" | "The engine published **no readable debt** for this account. No verdict is served for it." | ✅ |
| P10 `status: "refused"`, `refusal: null`, both figures on the wire | "no cap" | "The engine **refused this row without a code**. Its last readable debt is $4,822; no verdict is served for it." | ✅ |
| P11 `borrowings: "-5"`, cap on the wire | "no cap … last readable debt is −<$0.01" | "The engine published **a negative figure — not a position**. No verdict is served for it." (no last-readable clause) | ✅ |
| P3 `liquidatable: null` (regression check) | "published no verdict … last readable debt is $4,822" | unchanged | ✅ |
| P4 refused + legacy withheld (regression check) | "Collateral sweep failed. … Lookup incomplete: …" | unchanged, floor still appended | ✅ |

### The new pins by hand (`spec:248-259`)

- `nearWire({ borrowings: null })`: `status: "computed"`, `refusal: null`, verdict `not-liquidatable`; `readCashPosition` → `debt null` → refused arm; ladder: not refusal, status computed, status `refused` ≠ `unknowable`, cap `"5012500000"` readable, debt `null` fails `isWireDecimal` → "no readable debt". ✅
- `nearWire({ status: "refused", refusal: null })`: step 2 fires before any figure is read → "refused this row without a code". ✅
- `nearWire({ borrowings: "-1" })`: `isWireDecimal` is `^-?[0-9]+$`, so `"-1"` is readable and negative → step 5 "not a position"; `cash.debt` is `-1n` → `lastDebt` null → no "last readable". ✅

### Regressions

None. The eight tests pass; the only module change is the extracted ladder and the `lastDebt` guard; every other arm is byte-identical to f013695. Lint and typecheck clean.

Nothing remains open on Task 9. The accepted residue (the fixed "was not computed this batch" emphasis in `notComputedHeadline` for a computed row with an `unknowable` verdict — unreachable on the Cash wire) stays ledgered as a deferred minor in Task 6's file, and the Task 11 surface note (`InspectorSurface.tsx:32` keying `found` on `reading.lookup`) stays with Task 11.
