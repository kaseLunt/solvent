# Task 4 review: `lab-library` and `lab-deep-link` (moved) — ef8477f..fd1f27f

### Spec Compliance

**Verdict: compliant.** Every export in the Interfaces block is present; every outcome word, key and tone is the plan's; the order of checks is the brief's; the move is byte-for-byte (reproduced, four empty diffs); the helper addition is complete against the schema. All five accepted deviations are as the report describes them.

- ✅ **Exports.** `RunRecord` (`web/lib/lab-library.ts:23-25`), `SetRecord` (:27-29), `LibraryOutcomeKey`/`LibraryOutcomeTone`/`LibraryOutcome` (:31-37), `LibraryRow` (:39-49), `cashEngineOf` (:52), `cashRefusalOf` (:54), `outcomeLine` (:68), `libraryRows` (:89), `definitionSkew` (:107); `ScenariosResponse`/`ScenarioDefinition`/`EngineRefusal` (:19-21). `DeepLinkDecision` (`web/lib/lab-deep-link.ts:7`), `deepLinkDecision` (:60). The readers are typed on `LabRunBook`/`LabRunBookEngine` (:14, :52, :54, :107) — Deviation 3, accepted; the wire `RunBookEngine` alias is therefore not exported, as the report says.
- ✅ **Outcome words verbatim, right key and tone** (`lab-library.ts:69-86`): `Not run yet`/not-run/dim (:69); `Running…`/running/dim, with the ellipsis character (:70); `Failed {status}` (:72), `Not served`/`No batch`/`Rate limited`/`Unreachable` (:59-64, :73), `Unreadable` (:78), `Contradictory` (:80) — all key `failed`, tone `refused` (:66); `Not modelled for Cash`/not-covered/dim (:74); `Withheld`/withheld/refused (:75, :77); `{±Δ} liquidatable · {n} account(s)`/result/crit (:83); `No band change`/result/ok (:85); `{k} change band`/result/warn (:86).
- ✅ **Order of checks** (:72-86): failed → other failure kinds → not-covered → withheld (refusal) → withheld (no Cash row) → Unreadable → Contradictory → newly>0 → bandChanged===0 → band change. Matches the brief and the three-valued reading: a definition without Cash returns before any refusal is read (:74 before :75).
- ✅ **`FAILURE_WORD` covers every non-ok, non-failed kind.** `RunBookOutcome` has exactly six kinds (`web/lib/runbook.ts:64-70`); the `Record<Exclude<…, "ok" | "failed">, string>` at :59 names the other four, so a missed kind is a compile error, not a runtime hole.
- ✅ **`definitionSkew` five fields, in order** (:109-115): `version`, `label`, `path assumption`, `shocks`, `config version`. `shockKey` (:104) reads `axis`, optional `asset`, `factor_num`, `factor_den` — the whole `Shock` schema (`packages/client-ts/src/generated/schema.ts:1129-1140`).
- ✅ **`libraryRows`** (:89-102): wire order by `map`; `joinAnd(def.engines.map(engineName))` never sorts; selection/checks carried; `null` listing → `[]`. The fixture's first entry is `["aave_v3_etherfi", "debt_manager"]` in that order (`web/tests/fixtures/scenarios.json`), so the pin's `"Aave v3 market (legacy) and Cash"` (`web/tests/unit/lab-library.spec.ts:16`) is the fixture's order, not a sort.
- ✅ **The move is byte-for-byte.** Reproduced from `web/`, all four exit 0 with no output:
  - `diff <(sed -n '87,169p' app/lab/tornadoLines.ts) <(sed -n '60,142p' lib/lab-deep-link.ts)` — `deepLinkDecision` (the brief's proof)
  - `diff <(sed -n '34,169p' app/lab/tornadoLines.ts) <(sed -n '7,142p' lib/lab-deep-link.ts)` — the whole span: type, `listWords`, docblock, function
  - `diff <(sed -n '60,143p' tests/unit/tornado-lines.spec.ts) <(sed -n '11,94p' tests/unit/lab-deep-link.spec.ts)` — the `test.describe("the deep-link decision")` block, 8 tests
  - `diff <(sed -n '54p' tests/unit/tornado-lines.spec.ts) <(sed -n '9p' tests/unit/lab-deep-link.spec.ts)` — `LISTED`
  The only non-copied lines in `lab-deep-link.ts` are the header (:1-3) and the import (:5); the old files are untouched by the diff.
- ✅ **Helper addition complete** (`web/tests/unit/helpers/run-book-engine.ts:172-233`): `DEFINITION_ETH` (:175-184) carries every `ScenarioDefinition` field (schema :1240-1258); `BATCH` (:186-198) every `Batch` field (schema :728-753) with `supersession` matching `Supersession` (schema :703-707); `COVERAGE` (:201-210) every `BookCoverage` field (schema :917-932); `runBookOf` (:213-233) every `RunBookResponse` field the brief listed, `coverage` now the object the schema demands. `BATCH`'s values are the brief's own literal; nothing was added from the fixture because nothing was missing. `COVERAGE`'s `in_book = position_count − refused_count` is the fixture's own arithmetic (`run-book.eth_minus_30.json`: 6 − 2 = 4).
- ✅ **Wire guards before `BigInt`.** `isWirePopulation` and `isWireDecimal` at :78 precede `BigInt(cash.eligible_debt_delta_usd)` at :83; `heat.view` is read (:85-86) only after the `contradictory` arm returns (:80), and `LaneReading` is a two-arm union (`web/lib/lab-transitions.ts:70`) so that read is type-safe.
- ✅ **`web/lib/**` existing files untouched** — the diff adds two new lib files and touches nothing else under `lib/`.
- ✅ **Deviations verified against the diff.** (1) no line-1 path comment in any of the four new files; (2) `settled` typed `Extract<RunRecord, { phase: "settled" }>["outcome"]` (`lab-library.spec.ts:8`) — the report's reasoning is correct: `RunRecord extends { outcome: infer O } ? O : never` checks a union alias, not a naked type parameter, so it is non-distributive and resolves to `never`; every `expect` from the brief's Step 3 is otherwise unchanged (compared brief :99-158 to spec :10-69); (3) readers on `LabRunBook` — `RunBookOutcome.ok.response` is `LabRunBook` (`runbook.ts:65`), whose engines have `projection: RefinedProjection | null` (:50-52), not assignable to the wire type; (4) `heatOf` (:56-57) — `laneReading` takes the wire `RunBookEngine` (`lab-transitions.ts:13, :272`), so the bridge is required, and the controller has ruled Task 5 removes it; (5) `runBookOf` seals via `refineProjection` (:227), the same statement as `runbook.ts:151`; the helper's first import gained a value import (:5) and nothing existing was retyped; (6) `COVERAGE` as described; (7) `SCENARIO_ID_PATTERN` dropped — the old file never imported it either (`tornadoLines.ts:20-24`) and the moved code never uses it, so the brief's mention was the error; (8) `R58 item 6` at `lab-deep-link.ts:36` and `:120`, both inside the verbatim span.
- ⚠️ Cannot verify from diff: the 20-passed count, `typecheck` and `lint` exit codes (not re-run, per instructions); that Task 12 will actually reword the two `R58 item 6` comments (presence verified, follow-through is future).

### Strengths

- The move is proven rather than asserted, and the proof is stronger than the brief asked for: the whole 34–169 span is one contiguous copy, so the function's docblock (old :77-86) travelled with it instead of being dropped between the brief's three ranges.
- The readers take the sealed body. `outcomeLine` reads `o.response` as the Lab stores it, and the helper's `runBookOf` produces exactly that shape by the same `refineProjection` statement the fetch layer makes (`run-book-engine.ts:227` ≡ `runbook.ts:151`), so a pin's record is not a look-alike.
- No manufactured value anywhere. A refusal returns before the Cash row is sought (:75), a missing row is `Withheld` not `$0` (:77), a malformed count or delta is `Unreadable` before any arithmetic (:78), and `view.bandChanged` is only reached on the `ok` arm.
- `FAILURE_WORD`'s type is derived from `RunBookOutcome["kind"]`, so the failure vocabulary cannot silently drift from the outcome union.
- The helper's own law held: `COVERAGE` is summed from `BATCH` rather than pasted from a fixture with different counts, so the helper still cannot disagree with itself.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **The `heatOf` comment overstates its law** (`lab-library.ts:56`): "a function of the transitions alone". `guards()` also reads `before.hf_histogram` (`lab-transitions.ts:126, :135-136`) and `usd_decimals` (:128). The true and sufficient statement is the narrower one — the projection is no part of the heat reading and is not handed across. Task 5 removes the bridge; reword or delete then.
2. **`usd_decimals` is guarded only transitively.** `signedUsd(…, cash.usd_decimals)` at :83 reaches `humanUsd` → `scaleDown` → `BigInt(n)` (`web/lib/human-usd.ts:16`). Today a malformed scale is caught because `laneReading`'s guard (`lab-transitions.ts:128`) returns `contradictory` first, so the word is a refusal and nothing throws. Two consequences: the module's own guard line (:78) does not state the guard it relies on, and a bad scale reads as `Contradictory` rather than `Unreadable`. Adding `|| !isWireScale(cash.usd_decimals)` to :78 makes both local and the word exact. Plan-mandated (the brief's :78 is the same), so this belongs to the next round that opens the file.
3. **The band-change pin does not discriminate `merge`** (`lab-library.spec.ts:31-32`): `{5:{4:7}}` crosses b4→b3 under merge and lane 5→4 verbatim, so `7 change band` would also pass with `merge: false`. A table like `{6:{5:k}}` (both lanes in b4) pins the merge law — 0 under merge, k verbatim. Brief-drawn pin text; a strengthening for whichever round next touches the spec.
4. **`outcomeLine` has no docblock** (:68) though its order of checks is the module's central law; the brief's version had none either. One sentence — "failure kinds before coverage, coverage before refusal, refusal before the guards, guards before the reading" — would pin the intent for the reader.
5. **The `DeepLinkDecision` type's one-line docblock was left behind** (`tornadoLines.ts:33`, `/** What a /lab URL's two scenario params, read together, ask this page to do. */`). The brief drew the range at :34, so this is not the implementer's; Task 12 can carry it over when it deletes the old file.
6. **`COVERAGE` is now a claim** (`run-book-engine.ts:207-208`: `withheld_engines: []`, `stress_coverage_is_full: true`). A pin that overrides `excluded_engines` (as the withheld pin at `lab-library.spec.ts:35` does) and also reads `coverage` would find them disagreeing; nothing reads `coverage` today. The report's own Concern 3; noted so it is not forgotten.

### Assessment

**Task quality:** Approved

**Reasoning:** The brief's law is implemented exactly — every outcome word, tone and check order is the plan's, no unknown ever becomes a number, and the move is byte-for-byte by four reproduced empty diffs. Every deviation is real, necessary and correctly described; the remaining findings are polish and are already scoped to Task 5 and Task 12.
