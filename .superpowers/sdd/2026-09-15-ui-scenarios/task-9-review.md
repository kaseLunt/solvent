# Task 9 review — `lab-view`: one view model for the Scenarios page

Range: 00a18eb..19d7576. Files: `web/lib/lab-view.ts` (318 lines, new), `web/tests/unit/lab-view.spec.ts` (188 lines, new). `git show --stat 19d7576` confirms exactly those two files; no existing `web/lib/**` file touched.

### Spec Compliance

**Exports** (all present, shapes as ruled):
- ✅ `LabChip` declared locally (`lab-view.ts:35-40`), structurally identical to `components/kit/IdentityChips.tsx:4-9` (`label`, `value`, `tone?: "neutral"|"ok"|"warn"|"crit"|"refused"`, `title?`); no import from the frozen `cash-view` — ruling (a).
- ✅ `BookState` (`:42-57`) carries all 15 states named by the plan; `Banner` (`:58`) is `"stale-input" | "superseded" | null`.
- ✅ `EngineResult` (`:60-81`) with `projection: LabRunBookEngine["projection"]` (`:77`, the refined one — ruling (b)) and `transitionsNote` (`:80`, carrying `e.hf_transitions.note` at `:194` — ruling (d)).
- ✅ `EngineReading` (`:82-87`) five-armed; `BookWorkspace` (`:89-101`) with `run: LabRunBook | null` (`:97` — ruling (b)); `CompareState` (`:102-106`); `LabUi` (`:108-111`); `LabView` (`:112-120`).
- ✅ `readEngine(run: LabRunBook, engine, definition)` (`:144`) and `deriveLabView(reading, ui)` (`:300`).

**Module vs. the brief's Step 3**: compared line for line. Differences are exactly the rulings plus two tidy-ups: `LabChip` for `ViewChip`; `LabRunBook`/`LabRunBookEngine`/`RunBookEngine` imported from `./runbook` (`:31`) in place of the brief's `components` aliases; the unused `cashEngineOf` import dropped; no line-1 path comment. Everything else verbatim.

**State ladder and banners (R13)**:
- ✅ `superseded` read from `run.batch.supersession.superseded` (`:208`); banner precedence `superseded ? "superseded" : skew.length > 0 ? "stale-input" : null` (`:223`), a banner never replaces the result (`:246` keeps `state: "result"`).
- ✅ A skew including `version` is `definition-changed` with its own headline, `banner: null`, `cash`/`legacy` nulled (`:222`), decided before the cash reading is switched on.
- ✅ `not-run` / `running` / the five fetch failures each map to their own state and `failureHeadline` kind (`:251-271`), switch with no default.
- ✅ Empty listing → `not-run` + `EMPTY_LISTING` (`:314-315`); loading/error → `listing-loading` / `listing-unavailable` (`:303-308`).

**`readEngine` order and naming** (`:144-197`):
- ✅ not-covered (`:145`) before any refusal; refusal in `excluded_engines` → withheld with `engineName — plainCause(code, detail)` (`:146-147`); no row and no refusal → withheld by name (`:148-149`); classifier `malformedFields` + read-field guards → `unreadable` naming every field, deduped through `Set` (`:150-170`); `laneReading` contradictory → `contradictory` with its reasons (`:171-172`); `merge: engine === CASH` (`:171`).
- ✅ Wire guards precede every `BigInt`: the six decimals are each `isWireDecimal`-checked at `:160-168` before `BigInt(...)` at `:181-186`; `usd_decimals` through `isWireScale` (`:152`) before `decimals` (`:177`); `lane_changed_rows` nullable-guarded (`:169`) before `laneChanged` (`:188`).
- ✅ Legacy engine read only when the definition models it (`:212`).
- Check I ran: `lab-classify.ts:214-294` + `aggregateChecks`/`transitionChecks` — the classifier's names are `usd_decimals`, `before.eligible_accounts`, `before.eligible_debt_usd`, `before.bad_debt_usd` (and `after.*`), `eligible_debt_delta_usd`, `bad_debt_delta_usd`, `hf_transitions.measured_rows`, `hf_transitions.lane_changed_rows`, `newly_eligible_accounts` — every name this module pushes coincides, so the `Set` dedup is exact (no double-naming of one field). See Important #1 for the one guard that disagrees in *law* rather than name.
- Check I ran: `lab-transitions.ts` `guards()` reconciles `total_rows` against `from_rows`' sum and `measured + unmeasured` against `total_rows`; the classifier only type-checks `total_rows` as a population. So the pin's `total_rows: 5` passes the classifier and is caught by `laneReading` → `contradictory`, exactly as the brief's note says; `usd_decimals: 1.5` fails `isWireScale` at `:152` → `unreadable` before `laneReading` is reached. `LaneReading` is a two-kind union (`ok` | `contradictory`, `lab-transitions.ts:76`), so `:172` is the only non-ok arm.

**Chips** (`:136-141`, `:199-204`, `:213-220`):
- ✅ Result for batch: `groupInt(id)`; when superseded, `"18,251 · superseded"`, `tone: "warn"`, title "a newer complete batch exists; run again for it" (`:214-216`).
- ✅ Scenario: `run.scenario_id · run.scenario_version`, title = `run.label` (`:217`); on a definition-only book, `def.id · def.version`, title `def.label` (`:138`).
- ✅ Engines: served names `joinAnd`-joined, `"{name} withheld"` per refusal, joined by ` · `, `warn` when any refusal OR the Cash reading is withheld by name (`:199-204`).
- ✅ Config: `run.scenario_config_version`, `warn` when `skew` includes "config version" (`:219`).
- ✅ `identity` = `{ scope: "book", batchId, configVersion: run.scenario_config_version, engines: run.engines ids, servedAt }` (`:210`); null on every non-result book (`:128`).
- ✅ No "Computed" chip here (the page's).

**R3 headlines**: every state routes through `lab-headline` (`:222`, `:225-246`, `:253`, `:255`, `:260-269`, `:304`, `:307`, `:315`). Signatures checked against `lab-headline.ts`: `notRunHeadline({label, description, path_assumption, shocks})`, `runningHeadline(label)`, `withheldHeadline(label, cause)`, `notCoveredHeadline(label, engines, legacyBelow)`, `contradictoryHeadline(label, reasons)`, `definitionChangedHeadline(label, fields)`, `failureHeadline(kind, detail)`, `resultHeadline(ResultFigures)`, `listingUnavailableHeadline(message)`, `LISTING_LOADING`, `EMPTY_LISTING` — all match.

**Compare state** (`:273-296`): ✅ `idle` · `running` (ids) · `ok` (`compareRows(o.response, CASH)` + `LEGACY`) · `failed` (headline); all eight `SetRunOutcome` kinds (`runbookSet.ts:52-76`: ok, not-served, busy, no-batch, rate-limited, refused, unreachable, refused-locally) switched on, no default; the `CompareState` return type makes a new kind a compile error.

**Selection and checked**: ✅ null/unlisted selection → the first listed (`:310`); `checked` filtered to listed ids in listing order (`:313`); `library` built after the fallback so `library[0].selected` is true (`:312`).

**Pins** (`lab-view.spec.ts`): compared verbatim with the brief's Step 1. Differences: `settled` typed `Extract<RunRecord, { phase: "settled" }>["outcome"]` (`:14` — ruling (c)); no line-1 path comment; and the accepted Deviation 6 — the demo-result pin builds its run from `ETH_DEF` (`:75`) instead of `DEFINITION_ETH`. Every other line of that test (`:76-104`) is the brief's, unchanged. Check I ran: `tests/fixtures/scenarios.json` `eth_minus_30.path_assumption` is "instantaneous mark at the shocked level; single-step, no path, no cascade feedback, no partial closes"; `helpers/run-book-engine.ts` `DEFINITION_ETH.path_assumption` is "instantaneous mark at the shocked level; single-step" — so `definitionSkew` (`lab-library.ts`) rightly reports `["path assumption"]` for any `DEFINITION_ETH` run read against `SCENARIOS`, and the deviation is exactly as described.

**Demo figures recomputed** from `demoCash` + `DEMO_CASH_TABLE`: off-diagonal measured rows 8+14+13+73+6+12+135+43+129+128+60+320 = 941 (`laneChanged`); before eligible 41+8 = 49; after 155+12 = 167; crossed 14+13+73+6+12 = 118. `humanUsd(1_280_000_000_000n, 6)` → cents 128,000,000 → $1,280,000 → M tier, truncated tenths 12 → "$1.2M more Cash debt becomes liquidatable," / "across 118 accounts." Chips: "18,251" · "eth_minus_30 · v1" · "Aave v3 market (legacy) and Cash" · "v1". All match the pin.

- ⚠️ Cannot verify from diff: the run results claimed (9 passed, 1,231 in the unit project, typecheck and lint exit 0). Not re-run per instructions.

### Strengths
- `readEngine`'s order is the three-valued law exactly, and refusal-before-row (`:146-149`) means the repo's known "named in both arrays" body (`RUN_BOOK_CONTRADICTORY`) resolves to *withheld* — the safe direction — with no special case.
- Every `BigInt` sits behind its own named guard (`:160-168` → `:181-186`); nothing here can launder `""` into `0n`.
- Three exhaustive switches with no default arm (`:224`, `:259`, `:278`), each behind a non-undefined return type, so a new outcome kind fails to compile rather than falling through.
- Deviation 6 was diagnosed correctly: the law worked, the pin's input was wrong, and the fix used the brief's own unused `ETH_DEF` symbol rather than weakening `definitionSkew` or touching a third file.
- `enginesChip` warns on a Cash withheld *by name* (no row, no refusal — `:203`), not only on listed refusals.
- `LabChip` stays out of the component layer while remaining assignable to `IdentityChipsProps.chips` without a cast.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
1. **Plan-mandated — `newly_eligible_accounts` guarded as a population, against the repo's own contract law.** `lab-view.ts:154` puts `newly_eligible_accounts` in the `isWirePopulation` list, but `wireGuard.ts`'s assignment table assigns it to `isWireSignedCount` ("a NET count that also subtracts any flip back to healthy"), and `lab-classify.ts:224` guards it that way. A contract-legal negative net therefore reads `unreadable`, and the page prints "The result for X contradicts itself. newly_eligible_accounts is outside the wire contract." for a body inside the contract. Among the module's twelve re-checks this is the *only* one that is not a pure duplicate of the classifier — and it is the one that disagrees. `resultHeadline` already copes with `newly ≤ 0` (`f.newly > 0` gates both crit arms), so dropping `:154` is sufficient here. The brief's Step 3 carries the same line, and the frozen `lab-library.ts` `outcomeLine` makes the same choice (out of range) — a controller ruling is needed on which law stands.
2. **Plan-mandated — the library row's word and the workspace's state are decided by two guard sets.** `libraryRows` (`lab-library.ts` `outcomeLine`, frozen Task 4) checks only `newly_eligible_accounts` and `eligible_debt_delta_usd` before calling the row a result; `readEngine` (`:150-170`) runs the whole classifier. Example: `demoCash({ movers_total: -1 })` — the classifier names `movers_total`, the workspace reads `contradictory`; `outcomeLine` prints "+$1.2M liquidatable · 118 accounts" in crit tone for the same row. One response, two answers, on one page — the R12 class. Not this task's code to change (the brief consumes `libraryRows` as given), but the plan's "every state is decided here once" is not met across the seam; recommend `outcomeLine` delegate to `readEngine` (or the reverse) in a follow-up task.

#### Minor (Nice to Have)
1. **Dead arm in `definitionChips`.** `emptyBook` (`:127`) builds `definitionChips(definition, null)` — yielding a `Config: "unstated"` / `tone: "refused"` chip (`:139`) — and every call site with a definition (`:253`, `:255`, `:258`) immediately overrides `chips` with the listing's config version. The `null` arm is unreachable: a manufactured word nobody sees, plus a wasted chip build per book. Pass the config version into `emptyBook` or drop its chip build.
2. **Dead `heatReason` branch.** `readEngine` returns before a contradictory heat can reach a `result` (`:172`), so in `resultBook` `r.heat.kind === "ok"` is always true and `:243-244`'s `null` / `reasons.join` arms never execute. Typing `EngineResult.heat` as `HeatmapView` (`:74`) would state that invariant and delete the branch. The brief typed it `LaneReading`, so plan-shaped.
3. **`BookState.busy` (`:55`) is unreachable.** `RunBookOutcome` (`runbook.ts:62-68`) has no busy arm, so no path yields it; the surface will have to write a `busy` arm for a state a single run cannot produce. Plan-mandated enum.
4. **`enginesChip` on the repo's own pathological fixtures.** With `RUN_BOOK_NAMES_NOBODY` (both arrays empty) the chip value is `""` (`:202-203`) — an empty chip, warn-toned, on a state the reading itself handles well. With an engine in both arrays the chip reads "… and Aave v3 market (legacy) · Aave v3 market (legacy) withheld" while the reading says withheld; with `RUN_BOOK_NAMED_TWICE`, `identity.engines` (`:210`) carries the id twice although `ResultIdentity.engines`'s contract says "distinct, wire order" (`resultIdentity.ts`) and the address-scope extractor dedups. The brief's chip law reads `run.engines` rather than the readings; worth a ruling.
5. **The stale-input pin proves less than its name says** (`lab-view.spec.ts:144-148`). Because the run is built from `DEFINITION_ETH`, the skew `["path assumption"]` is present whether or not the listing is drifted; the `path_assumption: "changed"` edit is not what the pin detects. It *can* fail — lumping any skew into `definition-changed`, or ignoring skew, both fail it — and the `definition-changed` pin (`:150-154`) fails independently (a `version` skew treated as a banner would leave `state: "result"`). Per the controller, the helper is reconciled to the fixture bytes in Task 10; I confirmed every pin in this file still holds after that reconciliation (superseded → `[]` skew, banner still "superseded"; drifted → `["path assumption"]`; rev → `["version"]`).
6. **Compare `refused` message with an empty code.** `:290` builds `${o.code}: ${o.message}`; `runbookSet.ts` emits `code: ""` for an envelope-less refusal and a non-JSON 2xx, so the dek reads ": the service answered 502 without…" with a stray leading colon.
7. **Comments.** The header states the law; `resultBook`'s precedence (version skew first, then the cash reading's kind; superseded over stale-input) is carried by code order only — one sentence above `:222-223` would state it.

### Assessment
**Task quality:** Approved
**Reasoning:** The module and the pins match the brief and the four rulings line for line, every state is derived once in this file, the guards precede every arithmetic read, and the one input deviation is correct and honestly reported. Both Important findings are the brief's own (and one is a cross-task seam), so they are routed to the controller rather than held against the implementation.

## Re-review 1 (6855c01)

Range: 8eef607..6855c01, one commit, five files (`git diff --stat` confirms: `web/lib/lab-engine.ts` new 107 lines; `web/lib/lab-view.ts`; `web/lib/lab-library.ts`; `web/tests/unit/lab-view.spec.ts`; `web/tests/unit/lab-library.spec.ts`). Read-only; suite not re-run.

### I1 — the net count is signed
- ✅ `newly_eligible_accounts` is gone from `readEngine`'s population list (`lab-engine.ts:61-67` — three entries: `before.eligible_accounts`, `after.eligible_accounts`, `hf_transitions.measured_rows`); the comment above it (`:59-60`) states the law; the classifier's `isWireSignedCount` (`lab-classify.ts:224`) is now the field's only guard. `EngineResult.newly` documents the sign (`lab-engine.ts:24`).
- ✅ Pin: `demoCash({ newly_eligible_accounts: -3 })` → `result` with `newly` −3 (`lab-view.spec.ts:187-190`). Check: `isWireSignedCount(-3)` admits it (safe integer, not −0); nothing in `laneReading`'s guards reads the field; so the body reaches the result arm. Under the pre-fix list the same body read `unreadable` — the pin can fail.

### I2 — one reader
- ✅ `EngineResult`, `EngineReading`, `readEngine` moved to `lab-engine.ts` (`:22-107`). Compared against the removed text in `lab-view.ts`: identical except I1 and minor 2 (`heat: HeatmapView` at `:37`, `heat: heat.view` at `:99`). No private helper needed moving — the old `readEngine` consumed only imports.
- ✅ Graph: `lab-engine.ts` imports (`:9-17`) `@solvent/client`, `inspector-headline`, `inspector-position`, `lab-classify`, `lab-movers`, `lab-transitions`, `refusal-phrasebook`, `runbook`, `wireGuard` — nothing from `lab-view` or `lab-library`. `lab-library.ts:11` imports `readEngine` from `./lab-engine` and nothing from `lab-view` (grep of `lib/` for `./lab-view`: no hits). `lab-view.ts:10` imports from `./lab-engine`, `:25` from `./lab-library`. Strictly lab-view → lab-library → lab-engine; acyclic at type and runtime level. The local `ScenarioDefinition` alias (`lab-engine.ts:19`) is the accepted deviation.
- ✅ Re-export surface: `lab-view.ts:31` `export { readEngine } from "./lab-engine"`, `:32` `export type { EngineReading, EngineResult }`; `LabChip` `:35`, `deriveLabView` `:222`. Every symbol `app/lab/*` imports from `@/lib/lab-view` is still served: `EngineResult` (AssumptionsDrawer.tsx:4), `deriveLabView` + `LabChip` (LabSurface.tsx:20), `EngineReading` (LabTiles.tsx:3, LegacyResult.tsx:1, TransitionCard.tsx:4). No `app/` or `components/` file imports `lab-engine` or `lab-library` directly.
- ✅ `outcomeLine` (`lab-library.ts:65-89`) delegates to `readEngine(o.response, CASH, definition)` and switches exhaustively on the five kinds with no default; `LibraryOutcome` as the return type makes a sixth kind a compile error. Removed: `heatOf` and its docblock, the two-field guard, the `laneReading`/`LaneReading` and `isWireDecimal`/`isWirePopulation` imports. `cashEngineOf`/`cashRefusalOf` kept (`:51`, `:53`) — their only remaining reader is Task 4's own pin (`lab-library.spec.ts:70-77`); noted for the final triage as ruled.
- ✅ Words byte-for-byte against Task 4's pins (`lab-library.spec.ts:21-48`, unchanged in this diff): "Not run yet" dim · "Running…" dim · `Failed ${status}` · `FAILURE_WORD` ("Not served" / "No batch" / "Rate limited" / "Unreachable") · "Not modelled for Cash" dim · "Withheld" refused · `failed("Unreadable")` · `failed("Contradictory")` · crit `${signedUsd(deltaEligibleDebt, decimals)} liquidatable · ${groupInt(newly)} account(s)` — `deltaEligibleDebt` is `BigInt(e.eligible_debt_delta_usd)` and `decimals` is `e.usd_decimals`, so it is the old template on the same values · "No band change" ok · `${groupInt(heat.bandChanged)} change band` warn (old `heat.view.bandChanged`, same number). The check order is also preserved: not-covered → refusal → row → guards → matrix, exactly the old `outcomeLine`'s sequence, now with the whole classifier in the guard step. The "1e6" body (`:42-43`) fails `isWireDecimal` in the classifier and in `readEngine`'s own decimal list, so it still reads Unreadable.
- ✅ Seam pin proves the seam (`lab-library.spec.ts:51-57`). Its body sets `newly_eligible_accounts: 118` and `eligible_debt_delta_usd: "1280000000000"` — both legal — and `movers_total: -1`, a field only the classifier names. Traced under the OLD `outcomeLine`: `isWirePopulation(118)` ok, `isWireDecimal("1280000000000")` ok, matrix reconciles (helper sums), `newly > 0` → `{ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" }` — the `toEqual(failed "Unreadable")` would fail. Under the new one: the classifier walks `usd_decimals`, both aggregates, the transitions, the three deltas/nets, `movers` (empty), then `movers_total` → `isWirePopulation(-1)` false; `readEngine`'s own re-checks all pass; `[...new Set(["movers_total"])]` → exactly `["movers_total"]`, matching the `toEqual`. Both halves of the pin bite.

### Minors taken
- ✅ 1 — `emptyBook(state, headline, definition = null, chips = [])` (`lab-view.ts:94-106`); `definitionChips(def, configVersion: string)` has no null arm (`:109-114`); every definition-bearing caller in `bookOf` passes `definitionChips(def, listing.scenario_config_version)` once (`:172-190`). The "unstated"/refused chip no longer exists anywhere.
- ✅ 2 — `heat: HeatmapView` with the invariant stated (`lab-engine.ts:36-37`); `resultBook` passes `heat: r.heat, heatReason: null` (`lab-view.ts:163-164`); `ResultFigures` in `lab-headline.ts` untouched. Forced pin moves (`lab-view.spec.ts:97`, `:103`): `heat.merged` true for Cash, false for legacy. Check: the helper's `EDGES` (`run-book-engine.ts:15`) are byte-identical to `CONTRACT_LANE_EDGES` (`lab-transitions.ts:25-33`), and `edgesMatchContract` requires exactly eight buckets on those bounds, so `merged` is true under `merge: true` (Cash) and false under `merge: false` (legacy) — the strengthened assertion holds and is not vacuous. No consumer outside `lab-engine.ts` reads `heat.kind` / `heat.view` / `heat.reasons` (grep of `app`, `components`, `lib`, `tests/unit`: only `lab-engine.ts:82`, `:99`, on the local `LaneReading` before it is stored).
- ✅ 4 — `identity.engines` is `[...new Set(run.engines.map((e) => e.engine))]` with the comment (`lab-view.ts:130-131`); the demo pin's `engines: ["aave_v3_etherfi", "debt_manager"]` still holds (distinct input, order preserved by `Set`).
- ✅ 6 — the Compare `refused` message is `o.message` alone when `o.code === ""`, else `code: message`, with the comment (`lab-view.ts:205-206`).
- ✅ 7 — the precedence sentence above the version-skew / banner decision (`lab-view.ts:141-143`).
- ✅ Not taken, per ruling: 3 (`busy` is the plan's enum) and 5 (moot after Task 10's reconciliation — and with `DEFINITION_ETH` now matching the fixture, the stale-input pin at `lab-view.spec.ts:144-148` proves exactly the drift it introduces).

### Nothing else moved
Every hunk in `lab-view.ts` is one of: the header's one sentence naming `lab-engine`; import pruning of symbols only the moved code used (`lab-classify`, `lab-movers`, `lab-transitions`, `refusal-phrasebook`, `wireGuard`, `LabRunBookEngine`/`RunBookEngine`); the re-exports; the type/function removals; minors 1, 2, 4, 6, 7. `lab-library.ts`: import pruning, `heatOf` removal, the `outcomeLine` docblock and delegation. Specs: the three `heat` lines, the four-line net pin, one import, the seam pin. `BookState`, `Banner`, `BookWorkspace`, `CompareState`, `LabUi`, `LabView`, `enginesChip`, the chip set, `compareOf`'s other arms, `loadPhase`, `deriveLabView` — untouched.

- ⚠️ Cannot verify from diff: the claimed results (30 passed on the four specs; 1,246 unit; `tsc` and `eslint` exit 0). Not re-run per instructions.

### Residual
None blocking. For the final triage, as the coordinator already noted: `cashEngineOf` / `cashRefusalOf` are exports whose only reader is Task 4's pin.

**RE-REVIEW: closed**
