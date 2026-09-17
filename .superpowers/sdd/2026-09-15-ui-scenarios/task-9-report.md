# Task 9 report — `lab-view`: one view model for the Scenarios page

Status: DONE_WITH_CONCERNS
Commit: `19d7576` — `feat(web): lab-view - one view model for the Scenarios page: every state decided once, engines read by id under the classifier and the guards, banners on a result rather than replacements`
Files (exactly the two the brief names, staged by name, committed by pathspec):
- `web/lib/lab-view.ts` (new, 318 lines)
- `web/tests/unit/lab-view.spec.ts` (new, 188 lines)

## What was done

1. Read the brief and every landed interface it consumes through Serena (`runbook.ts`, `lab-library.ts`, `lab-headline.ts`, `lab-reading.ts`, `runbookSet.ts`, `lab-transitions.ts`, `lab-movers.ts`, `lab-classify.ts`, `lab-compare.ts`, `inspector-view.ts`, `refusal-phrasebook.ts`, `inspector-headline.ts`, `inspector-position.ts`, `prose.ts`, `resultIdentity.ts`, `wireGuard.ts`), the unit helper `tests/unit/helpers/run-book-engine.ts`, the fixture loader `tests/fixtures/lab-book.ts`, the kit's `IdentityChip`, and the `EngineRefusal` wire schema.
2. Wrote the pins (Step 1) verbatim from the brief, with the `settled` helper in its working form (Deviation 1) and no line-1 path comment (Deviation 2). Ran them: `Cannot find module '.../lib/lab-view'` — Step 2 as expected.
3. Wrote the module (Step 3) verbatim from the brief with the controller's rulings applied (Deviations 3–5). First run: 8 of 9 passed; `get_diagnostics_for_file` clean on both files.
4. The one failure was the demo-result pin's `expect(v.book.banner).toBeNull()` receiving `"stale-input"`. Investigated (see Deviation 6), corrected the pin's input, re-ran: 9 passed.
5. `npm run typecheck` (exit 0), `npm run lint` (exit 0), full unit project `npx playwright test --project=unit` (1231 passed), `git add` by name, `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 2 path(s)`, commit by pathspec. No `Co-Authored-By` or attribution lines.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-view.spec.ts
  9 passed (2.8s)
```

Also: `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npx playwright test --project=unit` → `1231 passed (8.6s)`.

## Deviations, each with its reason

1. **`settled` helper type** (pins): `Extract<RunRecord, { phase: "settled" }>["outcome"]` in place of the brief's `RunRecord extends { outcome: infer O } ? O : never` — the conditional form resolves to `never` over the union (Task 4 hit the same); the controller pre-ruled the working form.
2. **No line-1 path comments** in either file (the brief's `// web/lib/lab-view.ts` and `// web/tests/unit/lab-view.spec.ts`) — the binding rule. The descriptive header comments are the brief's own words.
3. **`LabChip` declared in `lab-view.ts`** (`{ label; value; tone?: "neutral" | "ok" | "warn" | "crit" | "refused"; title? }`, all `readonly`), used wherever the brief wrote `ViewChip`; no import from the frozen `./cash-view`. Controller ruling; it matches `components/kit/IdentityChips.tsx`'s `IdentityChip` structurally, which I read to confirm.
4. **Sealed run-book types**: `readEngine(run: LabRunBook, …)`, `BookWorkspace.run: LabRunBook | null`, `resultBook(def, configVersion, run: LabRunBook)`, `enginesChip(run: LabRunBook, …)`, `EngineResult.projection: LabRunBookEngine["projection"]` (the refined one). `LabRunBook`, `LabRunBookEngine`, `RunBookEngine` imported from `./runbook`; the brief's `import type { components } from "@solvent/client"` and its local `Schemas` / `RunBookEngine` aliases dropped because `./runbook` already exports `RunBookEngine`. Controller ruling; the `@solvent/client` drop is my own tidy-up so the file has one source for its wire types.
5. **Unused import dropped**: the brief imports `cashEngineOf` from `./lab-library` and never uses it in the module body. Removed so lint stays clean (`@typescript-eslint/no-unused-vars`).
6. **One pin input corrected — the demo-result pin builds its run from `ETH_DEF` (the listing's own definition) instead of `DEFINITION_ETH`.** Not arithmetic, so I am stating it fully rather than claiming the exception:
   - The pin asserts `banner` is null on a run read against the `SCENARIOS` listing. `definitionSkew` compares the listing's definition with the run's committed inputs on `version`, `label`, `path_assumption`, `shocks` and config version (Task 4's pinned law).
   - The committed fixture's `eth_minus_30.path_assumption` is `"instantaneous mark at the shocked level; single-step, no path, no cascade feedback, no partial closes"`; the helper's `DEFINITION_ETH.path_assumption` is `"instantaneous mark at the shocked level; single-step"`. Every run built from `DEFINITION_ETH` read against `SCENARIOS` therefore skews on `["path assumption"]` and earns a `stale-input` banner — which is the law working, not a fault in the code. Task 4's pins never joined `DEFINITION_ETH` to the fixture listing (they compare it against runs built from itself), so this was never surfaced before.
   - The brief's own spec declares `const ETH_DEF = SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!;` and then never uses it — an unused declaration that says what the demo run was meant to be built from. Using it makes the pin's stated premise (a run whose inputs match the listing) true.
   - The only alternatives were: hide the skew in code (breaks the law and the drifted pin), edit the helper's `DEFINITION_ETH` (a third file, forbidden), or halt. I judged a one-token input correction using the brief's own symbol, stated here, the honest path. Every assertion in that pin is unchanged and now holds: state `result`, no banner, `$1.2M more Cash debt becomes liquidatable,` / `across 118 accounts.`, the four chips, the identity, `laneChanged` 941, both engine readings.
   - The banner pins were left exactly as written. With `DEFINITION_ETH` they still pass on their own terms (superseded wins over skew; the drifted listing skews on exactly `["path assumption"]`; the re-versioned listing is `definition-changed`), though the drifted pin passes partly because `DEFINITION_ETH` already differs from the fixture on that same field — see Concern 2.

Everything else — `BookState`, `Banner`, `EngineResult`, `EngineReading`, `BookWorkspace`, `CompareState`, `LabUi`, `LabView`, `emptyBook`, `definitionChips`, `readEngine`'s guard order, `enginesChip`, `resultBook`'s precedence (version skew first, then the cash reading's kind), `bookOf`, `compareOf` (all eight `SetRunOutcome` kinds named, no default), `loadPhase`, `deriveLabView` — is the brief's, unchanged. The compiler named no `SetRunOutcome` kind beyond the eight the brief switches on.

## Concerns

1. **The helper's `DEFINITION_ETH` is not the fixture's `eth_minus_30`.** They differ on `path_assumption` (above) and `description` (the fixture's is the longer wire prose; `description` is not a skew field). Any future pin that joins a `DEFINITION_ETH`-built run to the `SCENARIOS` listing and expects no banner will hit the same wall. Task 10 (the surface) and its e2e should build from `ETH_DEF` / the fixture, or a future task should re-derive `DEFINITION_ETH` from the fixture bytes so the two cannot disagree. I did not touch the helper.
2. **The drifted-banner pin proves less than it reads as proving.** Its listing sets `path_assumption: "changed"` against a `DEFINITION_ETH` run, but that run already skews on `path assumption` against the untouched fixture; the pin cannot distinguish "drift I introduced" from "drift that was always there". With the helper reconciled (Concern 1) it would prove what it says. Left as the brief wrote it.
3. Both new files were written LF; git warns it will normalise to CRLF on next touch (the repo's existing behaviour for every file in this tree — not specific to this task).

## Fix round 1

Status: DONE
Commit: `6855c01` — `fix(web): lab-engine - one reader for one engine of one result, shared by the workspace and the library row; the net count is signed`
Base: `8eef607` (my four files were byte-identical to `19d7576` at that base; only the helper's `DEFINITION_ETH` had moved, reconciled to the fixture by Task 10).
Files (exactly the five the ruling names, staged by name, committed by pathspec; `scope-gate: OK -- integrator claude-integrator; 5 path(s)`):
- `web/lib/lab-engine.ts` (new, 107 lines)
- `web/lib/lab-view.ts` (140 lines changed)
- `web/lib/lab-library.ts` (37 lines changed)
- `web/tests/unit/lab-view.spec.ts` (9 lines changed)
- `web/tests/unit/lab-library.spec.ts` (9 lines added)

### What was done, per ruling

**I1 — the net count is signed.** `newly_eligible_accounts` is out of `readEngine`'s `isWirePopulation` list; the classifier's `isWireSignedCount` remains its only guard. A comment above the list states the law. One assertion added to the existing `readEngine` pin in `lab-view.spec.ts`: `demoCash({ newly_eligible_accounts: -3 })` reads as a `result` with `newly` -3.

**I2 — one reader.**
- (a) `web/lib/lab-engine.ts`: `EngineResult`, `EngineReading`, `readEngine` moved out of `lab-view.ts` verbatim apart from I1 and minor 2. There were no private helpers used only by them (`readEngine` consumed imports alone), so nothing else moved. Its docblock states the law: one engine of one result is read here, once, under the classifier and the guards; the workspace and the library row both consume this reading. `readEngine`'s `definition` parameter is typed from the schema locally (`components["schemas"]["ScenarioDefinition"]`, the same type `lab-library` exports under that name) so that `lab-engine` imports nothing from `lab-library` — not even a type — and the graph is strictly lab-view → lab-library → lab-engine.
- (b) `lab-view.ts` imports `readEngine` / `EngineReading` from `./lab-engine` for its own use and re-exports `export { readEngine } from "./lab-engine"; export type { EngineReading, EngineResult } from "./lab-engine";`. Checked what `app/lab/*` (the integrator's uncommitted work, untouched) imports from the view module: `EngineResult` (AssumptionsDrawer), `EngineReading` (LabTiles, LegacyResult, TransitionCard), `LabChip` + `deriveLabView` (LabSurface) — all still served. `lab-library.ts` imports `readEngine` from `./lab-engine` directly.
- (c) `outcomeLine` delegates: after the not-run / running / failed / non-ok arms it calls `readEngine(o.response, CASH, definition)` and switches exhaustively (no default) on the five kinds with exactly the ruled words: `not-covered` → "Not modelled for Cash" dim, `withheld` → "Withheld" refused, `unreadable` → failed("Unreadable"), `contradictory` → failed("Contradictory"), `result` → the crit line from `signedUsd(deltaEligibleDebt, decimals)` and `groupInt(newly)` when `newly > 0`, else "No band change" ok / "{n} change band" warn from `heat.bandChanged`. Removed from `lab-library.ts`: the private `heatOf` and its docblock, the two-field guard, the `laneReading`/`LaneReading` and `isWireDecimal`/`isWirePopulation` imports. Kept: `cashEngineOf` and `cashRefusalOf` as exports — `find_referencing_symbols` shows their only remaining users are Task 4's own pin ("cashEngineOf and cashRefusalOf read the run by engine id, never by position"), which keeps its words per the ruling; their uses inside `outcomeLine` are gone. Task 4's outcome-word pins pass unchanged, the "1e6" body reading Unreadable through the classifier now.
- Seam pin added to `lab-library.spec.ts`: a demo-figured Cash engine with `movers_total: -1` — a field only the classifier catches — reads `unreadable` with `fields` exactly `["movers_total"]` from `readEngine`, and `outcomeLine` on the same body gives `{ key: "failed", text: "Unreadable", tone: "refused" }`: the row's word is the workspace's kind.

**Minors taken.**
1. The dead `definitionChips(definition, null)` arm and its manufactured "unstated"/refused chip are gone: `emptyBook` now takes the chips it carries (default `[]`), `definitionChips(def, configVersion: string)` has no null arm, and every definition-bearing caller in `bookOf` passes `definitionChips(def, listing.scenario_config_version)` once. No chip is built that nobody keeps.
2. `EngineResult.heat` is `HeatmapView`; `readEngine` stores `heat.view` after the contradictory arm has returned; `resultBook` passes `heat: r.heat, heatReason: null` to `resultHeadline` (whose `ResultFigures` shape, in `lab-headline.ts`, is unchanged). Forced pin moves in `lab-view.spec.ts`: `heat.kind` / `heat.view.merged` → `heat.merged` (Cash `true`, legacy `false`) — the demo pin's assertions otherwise verbatim.
4. `identity.engines` is `[...new Set(run.engines.map((e) => e.engine))]` — distinct, wire order — with a one-line comment that a withheld engine is a refusal, never an answer.
6. The Compare `refused` message is `o.code === "" ? o.message : ${o.code}: ${o.message}` (template literal), with a one-line comment.
7. One comment above `resultBook`'s banner/skew decision states the precedence: a version skew is its own state before any reading is consulted; on a result a superseded batch outranks a stale input as the banner; a banner sits on the result state rather than replacing it.

Not taken, per the ruling: minor 3 (`busy` is the plan's enum) and minor 5 (moot after Task 10's reconciliation).

### Checks (from `web/`)

```
npx playwright test tests/unit/lab-view.spec.ts tests/unit/lab-library.spec.ts tests/unit/lab-address.spec.ts tests/unit/lab-compare.spec.ts
  30 passed (1.0s)
npx playwright test --project=unit
  1246 passed (4.5s)
npx tsc --noEmit          -> exit 0
npx eslint lib tests/unit -> exit 0
```
Serena `get_diagnostics_for_file` on `lab-engine.ts`, `lab-view.ts`, `lab-library.ts`: empty. `find_referencing_symbols` on `readEngine` in `lab-engine.ts`: `lab-library.ts` (`outcomeLine`), `lab-view.ts` (import, re-export, `resultBook` x2), both specs — no stale reference anywhere.

No Serena `replace_symbol_body` was used on an exported `const` (the Task 10 caution): `lab-engine.ts` and `lab-view.ts` were written whole, `lab-library.ts` and the specs were edited by exact-string `Edit`.

### Concerns

1. `cashEngineOf` / `cashRefusalOf` are now exports with no production caller — only Task 4's pin reads them. Kept per the ruling's "keep exports others use" (the pin is a user), but they are candidates for deletion together with that pin if the controller prefers no pin-only exports.
2. `readEngine` types its `definition` parameter from the schema directly rather than `lab-library`'s `ScenarioDefinition` alias (identical type). Chosen so the module graph has no cycle at any level; if the controller prefers the shared alias, it is a one-line type-only import with no runtime cycle.
