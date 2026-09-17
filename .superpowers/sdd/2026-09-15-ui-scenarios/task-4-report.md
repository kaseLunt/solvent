# Task 4 report: `lab-library` and `lab-deep-link` (moved)

Status: DONE_WITH_CONCERNS
Commit: `fd1f27f` — `feat(web): lab-library - the library's rows and outcome words from the wire and the run records, the definition-skew law; the deep-link law moved verbatim into lib`
Files (exactly the brief's five): `web/lib/lab-library.ts` (new, 117 lines), `web/lib/lab-deep-link.ts` (new, 142), `web/tests/unit/lab-library.spec.ts` (new, 69), `web/tests/unit/lab-deep-link.spec.ts` (new, 94), `web/tests/unit/helpers/run-book-engine.ts` (+71 / −1).

## What was done

- `web/lib/lab-deep-link.ts`: the brief's header (minus the line-1 path comment, per the binding rules), `import { MAX_SET_RUN_SCENARIOS } from "./runbookSet";`, then lines 34–169 of `web/app/lab/tornadoLines.ts` copied as one contiguous span from the source bytes (`sed -n '34,169p'`): the `DeepLinkDecision` type, `listWords`, the `deepLinkDecision` docblock and function. The copied span is a superset of the brief's three ranges (34–70, 72–75, 87–169) — the two blank lines and the function's own docblock (77–86) travel with it.
- `web/tests/unit/lab-deep-link.spec.ts`: a five-line law header, `import { expect, test } from "@playwright/test"`, `import { deepLinkDecision } from "../../lib/lab-deep-link"`, the `LISTED` constant byte-identical to the old file's line 54, then lines 60–143 of `web/tests/unit/tornado-lines.spec.ts` copied from the source bytes. The old files are untouched (Task 12 deletes them).
- `web/lib/lab-library.ts`: the brief's module — `RunRecord`, `SetRecord`, `LibraryOutcome*`, `LibraryRow`, `cashEngineOf`, `cashRefusalOf`, `outcomeLine`, `libraryRows`, `definitionSkew` — with the typing corrections listed under Deviations (the readers take the Lab's sealed body; a one-line bridge into `laneReading`).
- `web/tests/unit/lab-library.spec.ts`: the brief's four pins, every `expect` byte-identical; one type annotation on the local `settled` helper changed (Deviation 2).
- `web/tests/unit/helpers/run-book-engine.ts`: the brief's `RunBook` / `Definition` / `DEFINITION_ETH` / `BATCH` / `runBookOf` block appended, plus a `COVERAGE` literal (Deviation 6). Nothing that existed was changed except the first import line (Deviation 5); Task 2's eight `lab-transitions` pins stay green.

## The move proof

All four diffs printed nothing (exit 0). Run from `web/`:

```
$ diff <(sed -n '87,169p' app/lab/tornadoLines.ts) <(sed -n '60,142p' lib/lab-deep-link.ts)
$ diff <(sed -n '34,169p' app/lab/tornadoLines.ts) <(sed -n '7,142p' lib/lab-deep-link.ts)
$ diff <(sed -n '60,143p' tests/unit/tornado-lines.spec.ts) <(sed -n '11,94p' tests/unit/lab-deep-link.spec.ts)
$ diff <(sed -n '54p' tests/unit/tornado-lines.spec.ts) <(sed -n '9p' tests/unit/lab-deep-link.spec.ts)
```

(The first is the brief's proof: `deepLinkDecision` itself. The second is the whole moved span, type and `listWords` included. The third is the moved describe block. The fourth is `LISTED`.) The moved block carries 8 tests, the same count it has in `tornado-lines.spec.ts`.

## Tests

```
$ cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts tests/unit/lab-deep-link.spec.ts tests/unit/lab-transitions.spec.ts
  20 passed (2.7s)
```

4 in `lab-library`, 8 in `lab-deep-link` (the moved count), 8 in `lab-transitions` (Task 2, unchanged). `npm run typecheck` exit 0; `npm run lint` exit 0; `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 5 path(s)`.

The brief's Step 4 was observed: before the module existed the library spec failed with `Cannot find module '../../lib/lab-library'` (module resolution; not re-run after the module landed).

## Deviations from the brief, each with its reason

1. **Line-1 path comments dropped** from all four new files' headers (`// web/lib/lab-library.ts` etc.). The binding rules forbid a path comment on line 1; the rest of each header is the brief's text.

2. **The pin file's `settled` helper: one type annotation changed.** The brief's `(outcome: RunRecord extends { outcome: infer O } ? O : never)` is a non-distributive conditional (the checked type is a union alias, not a naked type parameter); the running arm has no `outcome`, so it resolves to `never` and every `settled(...)` call is a compile error. Proven in isolation before touching anything: `tsc --strict` on a scratch file with the same shape printed `error TS2345: Argument of type '{ kind: string; }' is not assignable to parameter of type 'never'`. `tsconfig.json` includes `**/*.ts`, so `npm run typecheck` covers the pins and the rule "typecheck clean before the commit" cannot be met with the helper as written. No module-side shape satisfies it: the running arm must lack `outcome` for the pin's own `outcomeLine({ phase: "running", startedAt: 0 }, def)` to compile, and must have it for the conditional to resolve. Replaced with `Extract<RunRecord, { phase: "settled" }>["outcome"]` — the same intent (the settled arm's outcome type, derived from `RunRecord`), and not one `expect` changed. This is the only edit to pin text and it asserts nothing about the law; flagged here because the rules say never to touch the pins.

3. **The readers are typed on the Lab's sealed body, not the wire's.** `RunBookOutcome`'s `ok` arm (the law, `lib/runbook.ts`) carries `response: LabRunBook`, whose engines are `LabRunBookEngine` (projection refined: horizons carry `liquidation_verdict`, not `becomes_liquidatable`). The wire `RunBookResponse` and `LabRunBook` are mutually non-assignable through that field, so the brief's `cashEngineOf(run: RunBookResponse)` cannot be called with `o.response`, and the pins' `settled({ kind: "ok", response: runBookOf(...) })` cannot take a wire-typed body. So: `cashEngineOf(run: LabRunBook): LabRunBookEngine | null`, `cashRefusalOf(run: LabRunBook)`, `definitionSkew(definition, configVersion, run: LabRunBook)`. This is the old Lab's own precedent (`badDebtRate`, `flipRanking`, `classifyRunBookEngine`, `moversDisclosure` all take `LabRunBookEngine`). Consequences: the module imports `LabRunBook`, `LabRunBookEngine`, `RunBookOutcome` from `./runbook` (not `RunBookResponse`), and does not export a wire `RunBookEngine` alias — a consumer names the engine as `LabRunBookEngine` from `./runbook`. `ScenariosResponse`, `ScenarioDefinition`, `EngineRefusal` are exported as the brief lists.

4. **A one-line bridge into `laneReading`.** Task 2's `laneReading(engine: RunBookEngine, …)` takes the wire engine type, which a sealed `LabRunBookEngine` cannot satisfy (same field, opposite direction). `lab-library` adds `heatOf = (cash) => laneReading({ ...cash, projection: null }, { merge: true })` with the law stated in its comment: the heat reading is a function of the transitions alone; the projection is no part of it and is not handed across. Behaviour is identical to the brief's inline call. See Concern 1 for the better fix, which lives in a file outside this task's five.

5. **Helper: `RunBook` is `LabRunBook`, and `runBookOf` seals engines.** The brief's `export type RunBook = Schemas["RunBookResponse"]` produces a body the pins then place in a `RunBookOutcome` (Deviation 3). `RunBook` is now `LabRunBook` (imported from `../../../lib/runbook`), and `runBookOf` maps each engine through `projection === null ? null : refineProjection(projection)` — the same statement `lib/runbook.ts` makes on receipt, so a pin's record is exactly what the fetch layer would have stored. The helper's first import line became `import { refineProjection, type components } from "@solvent/client";` (a value import added to the existing type import; nothing existing re-typed). Everything else in the helper is untouched.

6. **Helper: `coverage: []` replaced by a literal summed from `BATCH`.** `RunBookResponse.coverage` is `BookCoverage`, an object (`batch_positions`, `in_book`, `refused_in_batch`, `excluded_by_this_layer`, `excluded`, `withheld_engines`, `stress_coverage_is_full`, `note`); the brief's empty array is a type error (`TS2740`). The brief's rule for `Batch` — copy from `run-book.eth_minus_30.json`, do not invent — would put the fixture's `6 / 4 / 2` beside the brief's `BATCH` of `9964` positions and `6` refused, and the helper's opening law is that its fixtures cannot disagree with themselves. So `COVERAGE` is derived from `BATCH` by summation: `batch_positions: BATCH.position_count`, `in_book: BATCH.position_count - BATCH.refused_count` (9,958), `refused_in_batch: BATCH.refused_count`, `excluded_by_this_layer: 0`, `excluded: []`, `withheld_engines: []`, `stress_coverage_is_full: true`, and a `helper:`-prefixed note in the file's existing convention. No pin reads `coverage`. If fixture-copied counts are preferred, it is one literal to swap.

7. **`lab-deep-link.ts` imports only `MAX_SET_RUN_SCENARIOS`.** The brief and the task context both name `SCENARIO_ID_PATTERN` as well, but the moved code never uses it, and an unused import fails `npm run lint` (`no-unused-vars`).

8. **Review-round words inside the moved code.** The verbatim span carries `R58 item 6` in two comments (the `dispatchNotice` doc and the dispatch-clauses comment). The byte-for-byte move law and its empty-diff proof win over the "no review round in a comment" rule for this task; noted for Task 12 (or whichever round next touches the file) to reword once the old copy is gone and the diff proof is no longer owed.

9. The `RunRecord` / `SetRecord` / outcome / row types, `FAILURE_WORD`, `outcomeLine`'s order of checks, `libraryRows`, `shockKey` and `definitionSkew`'s field order are the brief's, unchanged. No arithmetic in the pins was recounted; every expected value held as written (`+$1.2M` on 1,280,000 at 6 decimals because `humanUsd` truncates; `7 change band`; the three-field skew order).

## Concerns

1. **`laneReading`'s parameter type is the wire engine, and the page will hold sealed ones.** Every `RunRecord` the Scenarios page stores has `LabRunBookEngine`s; every call into `lab-transitions` from page code will need the same `{ ...engine, projection: null }` bridge `lab-library` now carries. The honest fix is in `web/lib/lab-transitions.ts` (Task 2's file, not in this task's five): type `laneReading`'s parameter as what it reads — `Pick<RunBookEngine, "hf_transitions" | …>` or `LabRunBookEngine` — after which `heatOf` collapses back to the brief's inline call. Worth a line in the next round that touches that file.

2. **The pins' `settled` helper (Deviation 2) is a defect in the brief's pin text**, not in the code. If the pin text is regenerated from the brief by a later task, the `never` returns; the brief should carry the `Extract<…>` form.

3. **The Task 2 helper's `coverage` is now a claim, not a placeholder** (`stress_coverage_is_full: true`, nothing withheld). A future pin that sets `excluded_engines` via `overrides` and also reads `coverage.withheld_engines` will find the two disagreeing; today nothing reads `coverage`. If that pin ever arrives, `runBookOf` should derive `withheld_engines` from the overrides' `excluded_engines`.

4. **The task context's "eight pins" for `lab-transitions`** matches the run (8). The moved deep-link block is also 8, not the 7 an earlier count of mine suggested; the 20-line total is 4 + 8 + 8.
