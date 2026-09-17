# Task 7 review: `lab-classify` (moved) and `lab-compare` — 88f0518..409d4c8

### Spec Compliance

- ✅ Five new files, nothing else in the commit (`git show --stat 409d4c8`: `web/lib/lab-classify.ts`, `web/lib/lab-compare.ts`, three specs; 1383 insertions, 0 deletions). No existing `web/lib/**` file touched.
- ✅ **Move A reproduced:** `diff <(sed -n '47,324p' web/app/lab/engineClassification.ts) <(sed -n '18,295p' web/lib/lab-classify.ts)` → empty, exit 0.
- ✅ **Move B reproduced:** `diff <(sed -n '86,149p' web/app/lab/setRunClassification.ts) <(sed -n '297,360p' web/lib/lab-classify.ts)` → empty, exit 0. Span boundaries checked: `lab-classify.ts:17` and `:296` are the only seam lines (blank), `:295` and `:360` are the two closing braces.
- ✅ **Duplicated helpers:** `isRecord` (`engineClassification.ts:47-50` vs `setRunClassification.ts:69-72`) → empty diff, docstring included. `isNullableWirePopulation` signature+body (`engineClassification.ts:65-67` vs `setRunClassification.ts:82-84`) → empty diff. What was dropped: the set-run file's own docstring for it (`setRunClassification.ts:74-81`, the sentence that `eligible_accounts_delta` "takes `isWireSignedCount`, not this"); the run-book file's docstring (`lab-classify.ts:28-35`) is the one kept. The report describes this accurately.
- ✅ Imports are the only non-verbatim lines: `lab-classify.ts:6-16` is the union of the two old files' `wireGuard` imports (`isWireOccupancy` and `isWireSignedCount` come from the run-book file only; every name is used: `:169`, `:224`); paths rewritten to `./runbook`, `./runbookSet`, `./wireGuard`. Header `lab-classify.ts:1-4` is the brief's text.
- ✅ Spec copies: `diff engine-classification.spec.ts lab-classify-run-book.spec.ts` → only line 22 (import); `diff set-run-classification.spec.ts lab-classify-set-run.spec.ts` → only line 24 (import). `grep -c '^test('`: 28 / 11 in the copies, 28 / 11 in the originals. Originals left in place.
- ✅ Exports present: `classifyRunBookEngine` (`lab-classify.ts:214`), `classifySetRunEngine` (`:304`); `CompareKind` (`lab-compare.ts:18`, all seven kinds), `CompareRow` (`:20-33`, incl. `newly`), `CompareView` (`:35-44`), `shareTenths` (`:47`), `compareRows` (`:89`), re-exported `RunBookSetResponse`/`SetRunScenarioResult`/`SetRunEngineSummary` (`:14-16`).
- ✅ **Share law (R6):** `shareTenths` is `(delta * 1000n) / denominator`, `null` when `denominator <= 0n` (`lab-compare.ts:48-49`) — BigInt division truncates toward zero. Denominator is the SAME engine's `total_debt_usd_before` (`:79`).
- ✅ **Share words:** `0%` on a zero delta; `+<0.1%` / `−<0.1%` on a nonzero delta whose tenths are 0; else signed tenths (`:54-56`). The `+` prefix is added only for positive; negative relies on `formatTenths` which emits `MINUS` (`percent.ts:12-18`, pinned at `percent.spec.ts:15`).
- ✅ **Ranking recomputed:** 1,280,000,000,000·1000 / 27,828,808,216,758 = 45.99 → **45**; 9,800,000,000 → 0.35 → **0** (|Δ| 9.8e9); −2,000,000,000 → −0.07 → **0** (|Δ| 2e9); 0 → **0**. |share| desc puts `eth_minus_30` first; the three zero-tenths rows fall to |Δ| desc: `ethfi_minus_50`, `rate`, `weeth…`; the five non-points follow in wire order. Matches the pin `lab-compare.spec.ts:52-62`. The comparator (`lab-compare.ts:94`) is |share| desc `||` |Δ| desc on a `filter`-fresh array, so `Array.prototype.sort`'s stability gives wire order on full ties.
- ✅ **Every non-answer its own kind, never a dot at zero:** `withheld` → `"withheld"` (`:61`), `unmeasurable` → the wire's `reason` (`:62-63`), `not-covered` → `"not modelled"` (`:64-65`), `unreadable` → the read-field names (`:68-73`), `contradictory` → the classifier's names (`:76-77`), `no-denominator` → `"no denominator"` with Δ still shown (`:82`). All six carry `shareTenths: null` from `base` (`:60`); the pin `spec:82` asserts it over `rows.slice(4)`.
- ✅ **Wire guards before any BigInt:** `isWireScale(usd_decimals)`, `isWireDecimal(eligible_debt_delta_usd)`, `isWireDecimal(total_debt_usd_before)` at `:68-73`; `BigInt(...)` only at `:78-79`; `signedUsd(delta, e.usd_decimals)` at `:80` after the scale guard; `newly = e.flipped_to_eligible` at `:81` after the classifier's `isNullableWirePopulation` (`lab-classify.ts:310`). `WIRE_DECIMAL` is `^-?[0-9]+$` (`wireGuard.ts:22`), so `"1e6"` is refused and `"-2000000000"` is read.
- ✅ **Classifier runs on every summary that becomes a point or a no-denominator** (`:76`); nothing reaches a number without it. (On an `unreadable` row it does not run — see Important #2 on the naming consequence.)
- ✅ View envelope: `batchId` ← `batch.id` (`number`, schema `Batch`), `freshness` ← `evaluation.freshness` (typed `Schemas["SetRunEvaluation"]["freshness"]`, the 4-value union), `newestServable` ← `newest_servable_batch_id` (`number | null`), `evaluated` ← `scenarios_evaluated`, `configVersion` ← `scenario_config_version`, `servedAt` ← `served_at` (`lab-compare.ts:96-105`); every field exists on the generated `RunBookSetResponse`/`SetRunEvaluation`.
- ✅ Compare module comments state the law with no round language: `grep -iE 'p1b|p0-|codex|round|tornado|finding' lab-compare.ts lab-compare.spec.ts` → no hits.
- ✅ Report concern (1): the ONLY change to the `shareTenths` pin is `3n` → `3000n` (`spec:29` vs brief line 60); the other four expectations are the brief's. `−1000/3000 = −0.33` → `0n` under truncation toward zero (a floor would give `−1n`), and the `45n` case pins positive truncation (45.99 → 45); the brief's `(-1n, 3n) → 0n` was indeed `−333n` under the same law.
- ✅ Report concern (2): `SetRunEngineAbsence.reason` is the enum `no_positions_in_batch | all_positions_refused_in_batch | all_positions_unrebuildable | mixed_no_measurable_positions` (`schema.ts` `SetRunEngineAbsence`; `api/openapi.yaml:5279-5300`). `no_positions_in_batch` is in it and matches the pin's counts `{0,0,0}` (`spec:42`, `:78`). `run-book-set.json` has `unmeasurable_engines: []` on all three results.
- ✅ Report concern (3): read-field guards (`:68-73`) precede the classifier (`:76-77`); `"1e6"` → `unreadable: eligible_debt_delta_usd`, `accounts: -1` → `contradictory: accounts`. With the brief's order the `unreadable` arm was dead code (the classifier already judges those three fields at `lab-classify.ts:307,312-313`).
- ✅ Report concern (4): `MINUS` imported from `./human-usd` (`:7`), used at `:55`; `human-usd.ts:8` is U+2212.
- ✅ Report concern (5): round language travelled inside the moved spans exactly as listed (`lab-classify.ts:28-35, 40-55, 107-122, 164, 207-213, 246, 297-303`; `cellPrimaryOutcome` at `:210`, `tornadoCellState` at `:299`). The copied set-run spec's header (`lab-classify-set-run.spec.ts:16`) still says "recorded in the module header" — that header (`setRunClassification.ts:1-63`) did not travel. Deferred to Task 12 by ruling; not a finding.
- ✅ Report concern (6): `git ls-files --eol` — all five new files `i/lf w/lf`; both old classifier files `w/lf`; `lab-headline.ts` `w/crlf`. As described.
- ✅ Fixture check: `run-book-set.json` `results[0].engines[0]` carries 26 keys; generated `SetRunEngineSummary` has 26 fields; same set.
- ⚠️ Cannot verify from diff: the "no line-1 path comment" rule the report cites as binding over the brief's header. Every sibling `web/lib/lab-*.ts` carries none (`head -1` of all ten), so the omission is consistent with the tree; not treated as a deviation.
- ⚠️ Cannot verify from diff: `unmeasurable_engines: []` in the other three set fixtures (`.no-denominator`, `.superseded`, `.busy`) — immaterial, the enum value chosen is checked against the contract directly.

### Strengths

- The move is provably verbatim: four empty diffs (two spans, two helpers), the spec copies differ by one import line each, and 28/11 tests are preserved. The seam lines and header are exactly as briefed.
- The `unreadable`-unreachable catch is real and consequential: under the brief's order the pinned kind `unreadable` could never have been produced by any input, and the pin `["bad", "unreadable"]` would have failed forever or been "fixed" the wrong way. The reorder keeps every guard before `BigInt` and keeps the classifier on every row that becomes a number.
- The `3000n` correction is the minimal pin edit that makes the test title true (truncation toward zero is now pinned on both signs), and the enum correction picks the reason the pinned counts make checkable rather than an arbitrary member.
- The ranking pin is a single ordered `toEqual` over nine rows spanning all seven kinds — any mis-rank, mis-kind or manufactured share fails it. `spec:82` sweeps `shareTenths === null` across every non-point.
- `lab-compare.ts` is clean new code: no `any`, no casts, `filter((f): f is string => ...)` for narrowing, comments that state the law and nothing about rounds.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **[Plan-mandated] The result envelope is trusted; the old tornado path's partition check did not come along.** `rowOf` never reads `covered_engines`: an engine absent from `withheld_engines`, `unmeasurable_engines` and `engines` is called `not-covered` / "not modelled" (`lab-compare.ts:64-65`) even if `covered_engines` names it, and a summary row for an engine `covered_engines` does NOT name becomes a point. The contract says `engines` is "one row per covered engine that is neither withheld nor unmeasurable" (`api/openapi.yaml:5355-5357`), so a well-formed wire never hits this; the old Lab still refused the case by name (`web/app/lab/tornadoCells.ts:133-147`, "engines + withheld_engines + unmeasurable_engines is not a partition of covered_engines"). Likewise `r.withheld_engines.includes`, `r.unmeasurable_engines.find`, `r.engines.find` and `set.results.map` (`:61-64, :90`) assume the JSON cast's arrays — `runBookSet()` (`web/lib/runbookSet.ts:214+`) does no shape validation, and the classifier's "never throws" law covers only the engine subtree. This is the brief's Step 4 code transcribed as instructed, so it is a brief defect, not the implementer's; it needs a ruling on whether a census break is a `contradictory` row (its own word) or out of scope for Compare.

2. **Compound fault under-names.** With the reorder, a row that fails a read field AND another contract field is `unreadable` naming only the read fields (`:68-73` returns before `:76`). Never a point, so not a wrong share — but the register loses names, and the plan's "the classifier runs on every summary read" is literally false on that path. A one-line alternative satisfies both pins and both laws: always run `classifySetRunEngine`, then `kind = malformed.every(f => READ_FIELDS.has(f)) ? "unreadable" : "contradictory"` with `reason = malformed.join(", ")`. The controller ruled the current order; recording the cheaper shape for that ruling.

#### Minor (Nice to Have)

1. `shareTenths` (`lab-compare.ts:47-50`) is byte-for-byte the same law as the existing `percentTenths` (`web/lib/percent.ts:7-10`: `den <= 0n → null; (1000n * num) / den`). The brief mandates the `shareTenths` export, but it could delegate (`return percentTenths(delta, denominator)`) so the truncation law lives once.
2. The negative-share-over-a-tenth arm of `shareWords` (`:56`, `tenths < 0n → formatTenths(tenths)`) has no compare-level pin; every negative in the spec is under a tenth. `formatTenths(-38n) → "−3.8%"` is pinned at `percent.spec.ts:15`, so the glyph is right, but one pin (e.g. `-1500n` on a point → `"−150%"`) would close the composition.
3. The sort's `?? 0n` (`:94`, twice) is a type crutch: point rows never carry a null share or delta. A `filter((r): r is CompareRow & { shareTenths: bigint; deltaUsd: bigint } => r.kind === "point")` would let the comparator read them without a fallback that can never be taken.
4. `const eth = v.rows[0]!` (`lab-compare.spec.ts:63`) is a `!` on a computed value, not fixture data; harmless because `:52-62` has already proven nine rows, and it is the brief's text.

### Assessment

**Task quality:** Approved

**Reasoning:** The move is verbatim by reproducible proof, the compare module's shares, words, kinds and ranking match R6 exactly (ranking recomputed by hand from the pin's numbers), every guard precedes every `BigInt`, and each of the six report concerns is as described. The one Important item is the brief's own omission of the census partition check the old tornado path carried — it needs a controller ruling, not an implementer fix within this task.

## Re-review 1 (00a18eb)

**RE-REVIEW: closed.**

Scope honoured: `git show 00a18eb` touches exactly `web/lib/lab-compare.ts` (+81/−21) and `web/tests/unit/lab-compare.spec.ts` (+46/−0); `lab-classify.ts` and its two specs are untouched. Note: `00a18eb^` is `477e513` (another task's lab-address fix), not `c1fd2c6` — `c1fd2c6` is the grandparent; immaterial to this diff. The working tree equals 00a18eb on every file the compare spec exercises (`git diff --stat 00a18eb HEAD --` over lab-compare.ts, its spec, lab-classify.ts, percent.ts, human-usd.ts, lab-headline.ts, wireGuard.ts, run-book-set.json → empty; `git status --porcelain` on the same → clean), so one focused run of the compare spec is a valid check of this commit: `npx playwright test --project=unit tests/unit/lab-compare.spec.ts` → **5 passed**.

### 1. Important 1 — census partition: ADDRESSED

- `censusBreak` (`lab-compare.ts:69-91`) runs at `:96-97`, before the withheld / unmeasurable / engines branches (`:98-102`) and before any summary field is read. It reads ids only.
- Pairwise disjoint: `overlap` collects every repeat across the concatenation of the three parts (`:71-77`). Union = `covered_engines` as a set: `extra` (`:78`, named ids outside `covered`) and `missing` (`:79`, covered ids in no part). Each id named once (`unique`, `:58`, applied at `:78`, `:79`, `:89`).
- Reason: the mandated sentence followed by the non-empty `; extra: …` / `; missing: …` / `; overlap: …` clauses in that order (`:81-90`).
- Pins: extra (`spec:116-119`, a stray summary that would otherwise have been a point, `shareTenths` null), missing (`:121-124`) and the same result judged from the other engine's view (`:125`, so a covered engine in no part is never "not modelled"), overlap (`:127-129`), all three at once (`:131-132`). Every reason is an exact `toBe` — each pin can fail.
- **The stricter overlap reading (a duplicate inside one part is a break) is right.** Three grounds: the contract's `engines` is "One row per covered engine that is neither withheld nor unmeasurable" (`api/openapi.yaml:5357`), so two summary rows for one engine break the wire's own rule; without it `r.engines.find` (`:101`) would silently take the first of two rows — a hidden choice that could make a duplicate into a point; and the old Lab's `resultContradiction` (`web/app/lab/tornadoCells.ts:131-155`) judged exactly this way — a `counts` map over the concatenation of the three arrays, `n > 1` → fault — so this is parity with the old law, not a new strictness. Duplicates inside `covered_engines` itself are absorbed by the set view (`:70`, `:79`), which is what the ruling's "as a set" says.
- Observation, outside the ruling: the old `resultContradiction` carried a fourth clause — a numeric row with `accounts === 0` (`tornadoCells.ts:151-153`, the contract's "all-zero row under full coverage" case at `openapi.yaml:5286-5292`). The new census does not carry it; such a row with a positive denominator would be a point at `0%`. Not a dot at zero for a refusal (the wire published a numeric row), so not a finding against this task; recorded for the coordinator.

### 2. Important 2 — compound faults: ADDRESSED

- `classifySetRunEngine(e)` runs on every summary that reaches the engine read (`:108`); `malformed` is its names followed by the three read-field checks, `unique`'d (`:107-114`); `unreadable` iff every name is in `SHARE_FIELDS` (`:93`, `:116`), else `contradictory`; the reason names all (`:116`).
- Compound pin `spec:108-111`: `"1e6"` + `accounts: -1` → `contradictory`, reason exactly `"accounts, eligible_debt_delta_usd"` (the classifier's wire order, `lab-classify.ts:308` before `:312`; the read check's duplicate name removed by `unique`). The single-fault pins (`spec:46/63` unreadable, `spec:102-106` contradictory) are unchanged and pass.
- Note: the three appended read checks use the same predicates the classifier already applies to the same three fields (`lab-classify.ts:307, 312-313`), so today they add no name; they hold the guard-before-`BigInt` law independent of the classifier's by-decision scope. Acceptable; `unique` keeps the register clean.

### 3. Minors: all ADDRESSED

- Minor 1: `shareTenths` delegates to `percentTenths` (`:47-49`); the export and its five pins remain (`spec:29-35`).
- Minor 2: `spec:87-99`. Arithmetic checked: −4,500,000,000,000·1000 / 27,828,808,216,758 = −161.70 → **−161n** (truncation toward zero); `formatTenths(-161n)` → `−16.1%`; `signedUsd(−4.5e12, 6)` → `MINUS` + `humanUsd` at the M tier (`human-usd.ts:33`, `oneDecimal`) → `−$4.5M`; ranked first by |share| (161 > 45). Passed in the focused run.
- Minor 3: `Point` type and `isPoint` predicate (`:127-128`); the comparator reads `shareTenths`/`deltaUsd` directly with no `?? 0n`; `rest` is `!isPoint(r)`.

### Input correction: confirmed

`held` (`spec:42`) and `absent` (`spec:44`) no longer override `covered_engines`, so they take `result()`'s default `["debt_manager"]` (`spec:19`). Wire-lawful under the contract: a withheld engine is a covered engine (`positions_withheld`: "covered-but-WITHHELD engines") and an unmeasurable one is "A covered, NON-withheld engine" (`SetRunEngineAbsence`). Every one of the nine rows now partitions: six rows `covered [dm] = engines [dm]`; `held` `covered [dm] = withheld [dm]`; `absent` `covered [dm] = unmeasurable [dm]`; `legacy_only` `covered [aave] = engines [aave]` (so `debt_manager` is genuinely `not-covered`). The nine-row expectation block is byte-identical: `diff` of 409d4c8 `spec:52-83` against 00a18eb `spec:54-85` → empty.

### The four-arrays-are-arrays assumption: Minor, out of the ruling

`runBookSet()` returns `(await res.json()) as RunBookSetResponse` with no structural check (`web/lib/runbookSet.ts`, the `res.ok` arm). `censusBreak` spreads/maps `r.engines`, `r.withheld_engines`, `r.unmeasurable_engines` (`:71`) and `compareRows` maps `set.results` (`:133`); a non-array there throws out of `compareRows` (`new Set(undefined)` at `:70` is silently empty, the rest throw). The old tornado path had no `Array.isArray` guard on the envelope either (`grep` over `tornadoCells.ts` → none), so this is parity, not a regression, and the generated contract (`additionalProperties: false`) makes it version skew or an API bug rather than a normal path. Rated **Minor**: a throw replaces the view at whatever boundary the page task builds instead of naming one row; closing it is four `Array.isArray` checks that return `contradictory` naming the field, ahead of `:70`. Recommend the coordinator fold it into the page task's ruling rather than reopen this one.

### New breakage in this diff

None found. No `any`, no casts; `nonNull` and `isPoint` are proper type predicates; round-language sweep of the new module → no hits; the census runs per result, so a break on another engine's part makes this engine's row `contradictory` too — that is the ruling's intent and is pinned (`spec:125`).
