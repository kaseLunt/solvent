# Task 3 review: `lab-headline` — ff534e9..df3383b

### Spec Compliance

- ✅ Every export in the Interfaces block is present and typed as briefed: `signedUsd` (`web/lib/lab-headline.ts:18`), `resultHeadline` (:75), `notRunHeadline` (:92), `runningHeadline` (:101), `withheldHeadline` (:104), `notCoveredHeadline` (:110), `contradictoryHeadline` (:115), `definitionChangedHeadline` (:118), `failureHeadline` (:134, all seven `FailureKind` arms), `LISTING_LOADING` (:158), `listingUnavailableHeadline` (:163), `EMPTY_LISTING` (:166); types `LabHeadline` (:11), `ResultFigures` (:38), `FailureKind`/`FailureDetail` (:121–128).
- ✅ Every pinned sentence is present verbatim. Check run: extracted both code blocks from the brief and `diff`ed them against the committed files. The spec differs from the brief's pin block only by the dropped line-1 path comment; the module differs only in the five places the report names (path comment, `LEGACY` import, the `terminated`/`sentence` split at :23–33, `terminated` on the path at :98, `modelled` at :108 and its use at :111). The report's "nothing else differs" is true.
- ✅ Headline arms in the briefed order: newly > 0 with Δ > 0 → the §3.5 money template (:83–84); newly > 0 alone → `{n} accounts become liquidatable under {label}.` (:86); no band change → `No Cash account changes band under {label}.` tone `ok` (:88); band changes only → `No Cash account becomes liquidatable under {label},` + `but {k} change band.` tone `warn` (:89). Matches spec §3.5 (`docs/specs/2026-09-15-ui-product-register-design.md:164–166`) and plan R3 (`docs/plans/2026-09-15-ui-scenarios.md:41`).
- ✅ Dek composition: bad-debt sentence (:51–57) + movement sentence (:59–65) + near-cap sentence (:67–73); the near sentence is silent when `bandChanged === 0` (:69) and the movement sentence returns `""` on 0 (:60), so a no-change run prints the bad-debt sentence alone — the `none` pin.
- ✅ Demo dek recomputed by hand from `DEMO_CASH_TABLE` through `laneReading` with the merged bands (over-cap [0,1] · b1 [2] · b2 [3] · b3 [4] · b4 [5,6,7]): bandChanged = 14+13+73+18+135+43+129 = **425**; no cell rises → improved **0** ("none improve"); nearToday = from[2]+from[3] = 14+13 = **27**, nearCrossed = **27** ("all 27"); `roomBoundLabel(1.10 WAD)` → bp 909 → **9.09%**. Money: `humanUsd(1_280_000_000_000n, 6)` → 128,000,000 cents → tenths 12 → **$1.2M**; `humanUsd(40_780_396_039n, 6)` → 40,780 dollars → **$40K**. The pin is arithmetically right.
- ✅ "better" recomputed: `{2:{3:4}, 4:{3:2}}` → b1→b2 (4, `to > from` → improved) + b3→b2 (2) = **6 change, 4 improve**; nearToday = 4+0 = **4**, nearCrossed **0** ("none cross it"); `humanUsd(1_000_000n, 6)` → **$1**. Right. Also recomputed `moved` (5 worse, 1 near, none cross), `single` (1 worse, 1 near, "all 1"), `none` (0 changed, near silent) and `flipped` (heat null → the reason clause). All agree with the pins.
- ✅ R11: `signedUsd` prints `+`/`−` (the true `MINUS` from `web/lib/human-usd.ts:8`) on every value including zero (:19); headline money uses `humanUsd`'s tiers, whose truncation I read at `human-usd.ts:19–37`.
- ✅ R14: every non-verdict state is tone `refused` via the `refused` helper (:36) — not-run (:98), running (:102), withheld (:105), not-covered (:112), contradictory (:116), definition-changed (:119), all seven failures (:134–156), the three listing states (:158–166).
- ✅ Names: engines print through `engineName` (via `modelled`, :108); scenario `label` is interpolated as served everywhere (:84–89, :98, :102, :105, :112, :116, :119).
- ✅ Only two files touched, both new; no existing `web/lib/**` file changed.
- ✅ Comments state the law only (:22, :29, :47, :68, :97, :107). No round language.
- ✅ D1 verified: `terminated()` (:23–27) appends a stop and never recapitalises; `notRunHeadline` uses it for `path_assumption` (:98). Every committed `path_assumption` (`internal/risk/scenarios/*.json`) starts lowercase and has no terminal stop, so this is the only helper that quotes it as served.
- ✅ D2 verified: `modelled` (:108) gives the legacy market its article by comparing to `LEGACY` (`web/lib/inspector-position.ts:17`, value `"aave_v3_etherfi"`); `engineName(LEGACY)` returns the bare `Aave v3 market (legacy)` (`web/lib/inspector-headline.ts:46`), so the brief's `engines.map(engineName)` could not have produced the pinned `It models the Aave v3 market (legacy).` Six other `web/lib` modules already import ids from `inspector-position`, so the new dependency follows the tree.
- ⚠️ Cannot verify from diff: the report's D3 claim that "the task rules say the tree carries no path comments" — the brief does not say so and the tree is mixed (`prose.ts:1` has one; `lab-transitions.ts` does not). Immaterial to behaviour.

### Strengths

- The two pin-forced moves are minimal, correct and each carries a one-line law comment (:22, :107) rather than a note about why the round changed it.
- `terminated` vs `sentence` is the right split: the path clause is the wire's text and is now the one string the module never recapitalises, and the split cost nothing at the other call sites.
- The near-cap silence rule (:68–69) is stated as a reason ("the headline already said so") and the pins exercise both sides of it (`none` vs `moved`).
- The spec's fixtures are derived (`heatOf` through the real `laneReading`), so the dek pins test the merge and the counters, not a hand-typed view.
- `FailureDetail` is all-optional with in-module fallbacks (:139, :148, :150, :152, :154), so no failure arm can throw or print `undefined`.

### Issues

#### Critical (Must Fix)

None. No pinned sentence lies; no verdict tone reaches a non-verdict.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

- Singular-verb slips on unpinned count-of-one paths (plan-mandated: the brief's code is identical): `web/lib/lab-headline.ts:64` prints `…band; 1 improve.` when `improved === 1`; `:86` prints `1 account become liquidatable under …` when `newly === 1` with no positive Δ; `:89` prints `but 1 change band.` when `moves === 1`. The pins cover 2/4/5/6, so none fails. Suggest `improves`/`becomes`/`changes` on `=== 1`.
- `:152` prints `The service answered 0.` when `status` is absent (`d.status ?? 0`, the brief's fallback; report concern 5). A missing status is not a status of 0; making `status` required on the `failed` arm (or routing to `unreachable`) removes the only sentence here that can state something untrue.
- `web/tests/unit/lab-headline.spec.ts:71` uses `toContain` (as the brief wrote it), so the `flipped` dek's leading bad-debt sentence is unpinned; a `toBe` on the full dek would close it.
- `:98` still passes `description` through `sentence()`, which recapitalises the first character. Harmless on every committed description (all begin with a capital and end in a period), but a future description beginning with a ticker (`weETH …`) would print `WeETH …`. `terminated()` would treat it like the path, as served. The brief's code does the same; noting only because D1 established the principle.
- `signedUsd` (:19) negates before calling `humanUsd`, which already handles negatives with `MINUS` (`human-usd.ts:27`). Equivalent output; the negation is just redundant.
- Plan text drift, not a task-3 defect: plan R11's examples (`$1.28M`, `$40.8K`, `docs/plans/2026-09-15-ui-scenarios.md:49`) disagree with `humanUsd`'s actual tiers and with the brief's pins (`$1.2M`, `$40K`). The brief and the code agree; the plan's examples are stale.

### Assessment

**Task quality:** Approved

**Reasoning:** Every export, arm and pinned sentence is present and verbatim (confirmed by diffing the brief's blocks against the committed files), the demo and "better" deks recompute by hand to the pinned figures, and the two deviations are exactly as reported and are the correct readings of the pins. The only findings are unpinned grammar-of-one slips inherited from the brief's own code.
