# Task 7 report: `lab-classify` (moved) and `lab-compare`

Status: DONE_WITH_CONCERNS
Commit: `409d4c8325712aad424657e32c9f264aeb3716ee` on `main`
Message: `feat(web): lab-classify moved verbatim into lib; lab-compare - each scenario as a signed share of the engine's own book, every non-answer its own kind`
Files (exactly the brief's five): `web/lib/lab-classify.ts`, `web/lib/lab-compare.ts`, `web/tests/unit/lab-classify-run-book.spec.ts`, `web/tests/unit/lab-classify-set-run.spec.ts`, `web/tests/unit/lab-compare.spec.ts`
Gates: `python roadmap/tools/scope_gate.py` -> `scope-gate: OK -- integrator claude-integrator; 5 path(s)`; `npm run typecheck` exit 0; `npm run lint` exit 0; Serena `get_diagnostics_for_file` on `web/lib/lab-compare.ts` -> `{}`.

## What was done

1. `web/lib/lab-classify.ts` (360 lines): the brief's header (minus its line-1 path comment, see deviation 1), imports rewritten to `./runbook`, `./runbookSet`, `./wireGuard` (the union of both old files' `wireGuard` imports, every name used), then `app/lab/engineClassification.ts` lines 47-324 verbatim (the `isRecord` docstring on line 47 travels with its function), a blank seam line, then `app/lab/setRunClassification.ts` lines 86-149 verbatim (the `classifySetRunEngine` docstring and function). The set-run file's duplicated helpers (`isRecord` lines 69-72, `isNullableWirePopulation` lines 74-84) were dropped and the run-book file's copies kept once.
2. The two specs copied under the new names; the only change is the import path (`../../app/lab/engineClassification` / `../../app/lab/setRunClassification` -> `../../lib/lab-classify`). `diff` against each original shows exactly that one line. Originals left in place for Task 12.
3. `web/lib/lab-compare.ts` and `web/tests/unit/lab-compare.spec.ts` transcribed from the brief with the corrections listed under Deviations.
4. Pre-Step-4 checks the brief asked for:
   - `tests/fixtures/run-book-set.json` `results[0].engines[0]` carries all 26 fields the generated `SetRunEngineSummary` requires, none missing, none extra (checked by script against `packages/client-ts/src/generated/schema.ts`).
   - `SetRunEngineAbsence.reason` IS an enum: `no_positions_in_batch | all_positions_refused_in_batch | all_positions_unrebuildable | mixed_no_measurable_positions` (`api/openapi.yaml` line 5295, `schema.ts` line 2873). `"no_measurable_positions"` is not in it, and TypeScript rejects the literal. Every committed set fixture (`run-book-set.json`, `.no-denominator.json`, `.superseded.json`, `.busy.json`) has `unmeasurable_engines: []` and `generate-run-book-set.mjs` emits only `[]`, so there is no fixture value to borrow. See deviation 2.

## Move proof

All line ranges are 1-based. Every diff below printed nothing (exit 0).

```
=== A: engineClassification.ts 47-324 vs lab-classify.ts 18-295
diff exit=0
=== B: setRunClassification.ts 86-149 vs lab-classify.ts 297-360
diff exit=0
=== C: dropped duplicate helpers - isRecord (docstring+function) engineClassification 47-50 vs setRunClassification 69-72
diff exit=0
=== D: isNullableWirePopulation (signature+body) engineClassification 65-67 vs setRunClassification 82-84
diff exit=0
```

So: both moved spans are byte-for-byte; `isRecord` is identical in both old files including its docstring; `isNullableWirePopulation` is identical in signature and body. Its DOCSTRINGS differ between the two old files (run-book: "The schema's `number | null` movement counts (`held_rows`, `lane_changed_rows`)..."; set-run: "The schema's nullable movement subjects... Were a surface to start consuming `eligible_accounts_delta`... it takes `isWireSignedCount`, not this."). The run-book file's docstring is the one kept (it sits inside span A); the set-run file's docstring text was not carried. Flagged under Concerns for the reword task.

Spec copies:
```
--- run-book spec diff:
22c22
< import { classifyRunBookEngine } from "../../app/lab/engineClassification";
---
> import { classifyRunBookEngine } from "../../lib/lab-classify";
--- set-run spec diff:
24c24
< import { classifySetRunEngine } from "../../app/lab/setRunClassification";
---
> import { classifySetRunEngine } from "../../lib/lab-classify";
```

## Tests

Command (from `web/`):
```
npx playwright test --project=unit tests/unit/lab-classify-run-book.spec.ts tests/unit/lab-classify-set-run.spec.ts tests/unit/lab-compare.spec.ts
```
Output line: `42 passed (3.0s)`

Per file (each run alone): `lab-classify-run-book: 28 passed`, `lab-classify-set-run: 11 passed`, `lab-compare: 3 passed`. The originals, run the same way: `engine-classification: 28 passed`, `set-run-classification: 11 passed` - the counts are equal.

Step 3 (the failing run before the module existed) was not executed as a separate step: the compare module and its spec were written in the same pass. The three pins failed to compile against the brief's code for reasons 2-4 below and pass against the corrected code.

## Deviations, each with its reason

1. **No line-1 path comment** on `lab-classify.ts` and `lab-compare.ts` (the brief's headers begin `// web/lib/...`). The caller's rule ("No line-1 path comment on the new files") binds over the brief; the sibling `lib/lab-*.ts` modules carry none either. The rest of each header is the brief's text.

2. **The unmeasurable reason is `no_positions_in_batch`** in the pin's row and its expectation (brief: `"no_measurable_positions"`). The literal is not in the enum and no fixture carries one (see above). The enum value chosen is the one the pin's own counts make checkable: `{ positions_in_batch: 0, refused_in_batch: 0, unrebuildable: 0 }` is exactly "no positions in batch" (the contract says the counts are "BEHIND the reason, so the reason is checkable rather than a label"). The module passes `absent.reason` through untouched, so the pin still proves pass-through.

3. **`shareTenths(-1n, 3n)` pinned as `0n` is unsatisfiable**: `(-1 * 1000) / 3 = -333` under the same law that gives the brief's first pin `45n` (`1_280_000_000_000 * 1000 / 27_828_808_216_758 = 45`), and no law yields both. The pin's title says "truncated toward zero", and `(-1n, 3000n)` is the case that proves it (`-1000 / 3000` truncates to `0n`; a floor would give `-1n`), so the denominator became `3000n`. This is the one pin whose VALUE I could not leave as written; I record it as a correction of a typo, not a change of intent. If the author meant something else, the fix is one line in `lab-compare.spec.ts`.

4. **`rowOf` judges the share's own inputs before the classifier.** The brief's code ran `classifySetRunEngine` first and its `unreadable` arm after; but the classifier already checks `usd_decimals`, `eligible_debt_delta_usd` and `total_debt_usd_before` (`lab-classify.ts` lines 306-312), so that arm was unreachable and the pinned `["bad", "unreadable"]` row came out `contradictory`. Correcting the CODE (the pins govern): the three read fields are checked first and named as `unreadable`; then the whole row goes through the classifier and anything it refuses is `contradictory` by its field names. Both pins pass (`"1e6"` -> `unreadable: eligible_debt_delta_usd`; `accounts: -1` -> `contradictory: accounts`). Consequence worth knowing: a row that fails BOTH (say `accounts: -1` and a bad delta) is reported `unreadable` naming only the read fields; it is still refused and never a point.

5. **`MINUS` is imported from `./human-usd`** for the `−<0.1%` word instead of an embedded glyph. The brief's Interfaces line lists `lib/human-usd.ts` as consumed but its Step 4 code did not import it; `percent.ts` and `lab-headline.ts` both take the glyph from that constant, and the pins (`"−<0.1%"`, `"−$2,000"`, U+2212 verified by byte count) pass.

Everything else in the compare module and its spec is the brief's text, including the sort (`|share|` desc, then `|Δ|` desc, then wire order via the stable sort), the row shapes and the `CompareView` fields.

## Round-language carried in the moved code (byte-for-byte, for a later reword task)

The two old files' FILE headers (the heaviest round language) were not moved - the brief's spans start at the first helper. What did travel, inside function docstrings and inline comments of `lab-classify.ts`:
- `isNullableWirePopulation` docstring (lines 28-35): "p1b-9 finding 2 brought them into the walk; p1b-10 assigned the guard".
- `aggregateChecks` docstring (lines 40-55): "p1b-9 (Codex round, finding 2)... since p1b-10 by `isWirePopulation`".
- `transitionChecks` docstring (lines 107-122): "Task 1's review proved", "p1b-9 (Codex round, finding 2)", "The old header claimed".
- inline in `transitionChecks` (line 164): "p1b-11 (finding B)".
- `classifyRunBookEngine` docstring (lines 207-213): "the p0-8 malformed register's content", "`cellPrimaryOutcome`'s malformed arm delegates here" (a Lab-page symbol Task 12 deletes).
- inline in `classifyRunBookEngine` (line 246): "p1b-9 (finding 2)... `moversDisclosure`'s own denominator".
- `classifySetRunEngine` docstring (lines 297-303): "the p0-8 malformed register's content", "`tornadoCellState` composes this" (also an old-Lab symbol).
- The two moved spec files: headers and every test title carry `p1b-2:` / `p1b-3:` / `p1b-9:` / `p1b-10:` / `p1b-11:` prefixes and Codex-round references; the set-run spec's scope pin cites `set-run-classification.spec.ts` by its OLD name in the `classifySetRunEngine` module comment that was NOT moved (so no dangling reference in `lib`), but the moved spec's own header still says "recorded in the module header", which now refers to a header that did not travel.

## Concerns

- Deviation 3 changes a pin's value. It is arithmetically forced, but it is the kind of change the rules reserve; please confirm the intent (`3000n`, truncation toward zero) or tell me the intended pair.
- Deviation 4 changes the precedence between `unreadable` and `contradictory` from the brief's code. The pins fix the observable outcomes for the two single-fault cases; the compound case's register (`unreadable`, read fields only) is a choice, not a pin.
- The kept `isNullableWirePopulation` docstring is the run-book file's; the set-run file's sentence about `eligible_accounts_delta` taking `isWireSignedCount` is a real law statement that is now only in the old file (Task 12 deletes it). Worth re-homing in the reword.
- The moved `classifySetRunEngine` docstring and the moved spec header still speak of the tornado surfaces and the old module header's scope decision; harmless to the code, misleading to a reader after Task 12.
- Line endings: the checkout is mixed (`core.autocrlf=true`; the old classifier files and specs are LF in the working tree, `lab-headline.ts` is CRLF). The five new files are LF; git normalizes on commit, and the move diffs were taken LF-to-LF.
- The old `app/lab/engineClassification.ts` and `app/lab/setRunClassification.ts` and their two specs remain (by instruction) and still pass; until Task 12 the classifier law exists twice.

## Fix round 1

Status: DONE_WITH_CONCERNS
Commit: `00a18eb36df816ac7c9724c1ba66979481698e69` on `main` (built on `c1fd2c6`)
Message: `fix(web): lab-compare review round - the set-run census must partition covered_engines, a compound fault names every field, shareTenths delegates to the percent law, a negative share pinned`
Files (exactly the two): `web/lib/lab-compare.ts`, `web/tests/unit/lab-compare.spec.ts`. The moved classifier and its two specs are untouched.
Gates: `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; `npm run typecheck` exit 0; `npm run lint` 0 errors (its one warning is `lab-view.spec.ts:32`, another task's untracked file); Serena `get_diagnostics_for_file` on `lab-compare.ts` -> `{}`.

Test command (from `web/`): `npx playwright test --project=unit tests/unit/lab-compare.spec.ts tests/unit/lab-classify-run-book.spec.ts tests/unit/lab-classify-set-run.spec.ts`
Output line: `44 passed (2.8s)` (28 + 11 + 5; the compare spec grew from 3 to 5 tests).

### What changed

1. **Important 1 - the census partition** (`censusBreak`, `lab-compare.ts`). Before any engine is read, `rowOf` checks that `engines[].engine`, `withheld_engines` and `unmeasurable_engines[].engine` are pairwise disjoint and that their union equals `covered_engines` as a set. A break returns `{ kind: "contradictory", reason }` where `reason` is `engines, withheld_engines and unmeasurable_engines do not partition covered_engines` followed by the non-empty clauses in the order `; extra: a, b` / `; missing: c` / `; overlap: d`, each id named once. "Overlap" is any id appearing more than once across the concatenation of the three parts, which also catches a duplicate inside one part (two summary rows for the same engine) - a stricter reading than the three arrays being pairwise disjoint, and still a partition break.
   Pins added (one test, four cases): a summary for an engine the coverage does not name -> contradictory, `; extra: debt_manager`, `shareTenths` null (it would otherwise have been a point); a covered engine in no part -> contradictory `; missing: aave_v3_etherfi`, and the SAME result is contradictory from the other engine's view too (it used to read "not modelled" for an engine the coverage names); an engine in two parts -> `; overlap: debt_manager`; every clause at once -> `; extra: debt_manager; missing: aave_v3_etherfi; overlap: debt_manager`.
2. **Important 2 - compound faults name every field.** `classifySetRunEngine(e)` now runs on every summary that reaches the engine read; `malformed` is its names plus the three read-field checks (`usd_decimals` via `isWireScale`, `eligible_debt_delta_usd` and `total_debt_usd_before` via `isWireDecimal`), deduplicated in that order (the classifier's names lead, so wire read order is kept; the read checks only add a name the classifier's scope would have missed). Non-empty -> `kind` is `unreadable` when every name is one of the three read fields, else `contradictory`; `reason` is all names joined with `, `. The existing `unreadable` (`"1e6"`) and `contradictory` (`accounts: -1`) pins pass unchanged; the compound pin (`"1e6"` and `accounts: -1`) is `contradictory` with the exact reason `accounts, eligible_debt_delta_usd`.
3. **Minor 1**: `shareTenths` delegates to `percentTenths` from `./percent`; export and its five pins kept.
4. **Minor 2**: a negative share over a tenth pinned: delta `-4500000000000` on `27828808216758` -> `-161n` tenths (4.5e15 / 2.78e13 = 161.70, truncated toward zero), words `−16.1%`, money `−$4.5M`; it ranks above the `+4.5%` point by |share|.
5. **Minor 3**: the sort's `?? 0n` crutches are gone; `rows.filter(isPoint)` narrows with `(r): r is CompareRow & { kind: "point"; shareTenths: bigint; deltaUsd: bigint }` and the comparator reads the fields directly; `rest` is `!isPoint(r)`.

### Input correction the new law forced (pinned outcomes unchanged)

The brief's `held` and `absent` rows declared `covered_engines: []` while naming `debt_manager` in `withheld_engines` / `unmeasurable_engines`. Under the contract a withheld or unmeasurable engine IS a covered engine, so both rows were census breaks and would have become `contradictory` under Important 1 while the ordering pin says `withheld` / `unmeasurable`. The `covered_engines: []` override was removed from those two rows (they now take `result()`'s default coverage `["debt_manager"]`). The nine-row expected list and every expectation on it are the brief's, unchanged.

### Concerns

- The census check assumes the four arrays are arrays, as the brief's code and the review's second Important both note (`runBookSet()` does no shape validation). Not in the ruling, so not added; a `!Array.isArray` on any of the four would be one more `contradictory` clause if the coordinator wants it.
- Overlap is judged over the concatenation (a duplicate inside one part counts), slightly stricter than "pairwise disjoint"; noted above so it is a decision, not a surprise.
- The compound rule means a row wrong ONLY in `usd_decimals` is `unreadable` (the share cannot even scale its money) - consistent with the ruling's definition, stated here because `usd_decimals` is also the classifier's first field.
