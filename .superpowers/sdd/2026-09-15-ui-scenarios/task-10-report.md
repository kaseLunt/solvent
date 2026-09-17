# Task 10 report: the Scenarios demo dataset

Status: DONE_WITH_CONCERNS (all pins green; the concerns are dataset-level, listed at the end).

Commit: `8eef607` on `main` — `test(web): the Scenarios demo dataset - generated, clock-law checked, the run-book welded to the demo Book's own eth_minus_30 waterfall and histogram` — eight paths by pathspec (the brief's seven plus `web/tests/unit/helpers/run-book-engine.ts`), `scope-gate: OK -- integrator claude-integrator; 8 path(s)`.

Lease episode: the first gate run printed `scope-gate: BLOCKED -- expired claim may only perform an isolated roadmap cleanup transition` — the integrator's claim lease had expired at 22:06:26Z, five minutes earlier. The integrator renewed it in place (commit `f7f572a`, lease through 2026-09-17T22:12Z); this task touched no roadmap file. The gate then passed and the commit landed.

## What was done

- `web/tests/fixtures/demo/generate-demo-lab.mjs` (new): a provenance-headed generator that writes the three bodies under the clock law. It reads `book.demo.json`, `positions-dm-demo-page-1.json`, `stress-demo-near.json`, the contract fixtures `scenarios.json`, `run-book.eth_minus_30.json`, `run-book-set.json`, `run-book-set.no-denominator.json` and `run-book.weeth_market_depeg_oracles_held.json`, and derives every figure; it refuses to write when any weld it states does not hold (the Book's histogram vs the tables, the table's crossings vs the waterfall's newly-eligible count, the Book's three statements of today's eligible set, the coverage partition, the example sentences it restates, the Inspector's projection formula, the lane vocabulary, the clock trios).
- `web/tests/fixtures/demo/scenarios-demo.json`, `run-book-demo-eth_minus_30.json`, `run-book-set-demo.json` (generated, never edited).
- `web/tests/fixtures/demo/index.ts`: exports `DEMO_SCENARIOS`, `DEMO_RUN_BOOK_ETH`, `DEMO_RUN_BOOK_SET`.
- `web/tests/unit/demo-lab-weld.spec.ts` (new): the brief's seven pins, values verbatim; three expressions edited because the compiler refused them (below).
- `web/tests/unit/fixture-clock-law.spec.ts`: census moved (below).
- `web/tests/unit/helpers/run-book-engine.ts`: `DEFINITION_ETH` reconciled to `tests/fixtures/scenarios.json`'s `eth_minus_30` entry byte for byte (description, path_assumption, engines, shocks, the six `out_of_model` sentences).

## Checks the brief asked for first

- `checkClocks` returns `{ checked, resolutions, failures }`, not `{ violations, trios }`; `writeChecked` reads `failures` and `checked`, and the generator pins the trio count per file (`CLOCK_TRIOS`: listing 0, run-book 2, set 2) so it cannot disagree with the census.
- `collateral_by_asset`: the contract example's rows ride verbatim and do not sum to the demo totals on any of the four sides, so the body's `notes` carries the brief's disclosure sentence (pushed by rule, only when the sum fails). `lib/lab-classify.ts` checks the rows' value shapes only, never the sum, so the page reads it fine.
- The projection template: neither contract fixture carries one (the brief's search would have thrown). The Inspector demo's own projection (`stress-demo-near.json`, `dm_rate_horizon_plus_200bps`) supplies horizons (30 d, 90 d), the observation block (155323444, asserted equal to the Book's debt_manager watermark) and the sentence; the generator proves floor(debt × 200 bps × t / year) reproduces the Inspector's two horizons, then applies it over the Cash book's total debt (45745986109 and 137237958329 at 6 decimals). `becomes_liquidatable` is null: the aggregate states no per-account verdict.
- The reach shapes: `shock_reach` is an object, so the brief's `.every` would have thrown. The eth result carries the example's `every_mark_moved` reach; the weETH depeg and the rate step carry the contract generator's own `no_shocks_declared` and `projection_no_spot_pass` reaches (`run-book-set.no-denominator.json`, the arm asserted); ETHFI −50 % carries an `every_mark_moved` reach over the Inspector demo's own ETHFI applied shock (1250000 → 625000, factor 50/100, asserted to be the definition's shock moved), "(1 of 1)" in the arm's sentence. Every held-flat list is drawn from one mark census (the example's marks plus the ETHFI mark), deduplicated on (chain, address) and sorted as the contract sorts them; a DM-only scenario holds the chain-10 marks only.

## Template fields verified and every override

Run-book (`run-book.eth_minus_30.json` spread):
- `served_at`, `batch` → the Book's. `scenario_*`, `label`, `description`, `path_assumption`, `shocks`, `out_of_model` → the committed listing's (same bytes as the example; read, not copied).
- `coverage` → the Book's coverage verbatim (the example's 6/4/2 census is its own toy book; `RunBookResponse.coverage` is `BookCoverage`, the same component). Override.
- `held_flat` → the example's two rows plus the Inspector demo's ETHFI row (so every demo surface holds the same marks flat). Override.
- `applied_shocks`, `notes` (plus the disclosure sentence), the engines' `note`, `hf_transitions.note` (each engine's own: the legacy sentence says 8-decimal, the Cash one 6-decimal), `hf_histogram` shape and notes, lane vocabulary, `wad_scale`, comparators → verbatim, per engine.
- Cash `movers_note` → the example's sentence with two clauses restated by rule: the ranking ("ranked here by the exact ratio AFTER the shock, nearest the cap first" — the pin's ranking, where the example says by debt largest first) and the truncation ("carries the 20 nearest the cap; the other 98 are not on this page" — the example says "carries all 1"). Override.
- Legacy `movers_note` → the brief's sentence (movers not carried; the count is the newly eligible). `movers_total` 14.

Set run (`run-book-set.json` spread), the `SetRunEngineSummary` fields that ride by spread, each checked against the demo:
- `movement_rule` per engine: TRUE (hf_strictly_dropped / eligibility_flipped_false_to_true), rides.
- `infinite_accounts`: 0 on both — the example says 0, TRUE, but it is set from the lanes' no-debt margin rather than trusted.
- `movement_excluded_accounts`: 0 on both — TRUE; set by rule (legacy = no-debt accounts, Cash = 0: every row was measured on both sides).
- `refused_in_batch_positions`: example 1/1, demo Cash 6, legacy 0. OVERRIDDEN from the transitions' refused rows.
- `unrebuildable_positions`: 0 — TRUE; set from the transitions' excluded-by-this-layer rows.
- `flipped_to_eligible` / `hf_dropped_accounts`: Cash rows carry the flip count and null; legacy rows null and the count. The brief passed `hf_dropped_accounts: 941` (eth) and `61` (ETHFI) on Cash rows; the schema says null on the Debt Manager, so those are dropped. OVERRIDDEN.
- `note`: the example's sentence per engine with the denominator clause re-figured by rule: "(1 minus 0 = 1)" → "(1406 minus 0 = 1406)" / "(8552 minus 0 = 8552)". OVERRIDDEN.
- `market_realization`, `projection`: null except where the scenario states one (below).
- Every money and count field → the engine's; the eth rows are the run-book's, the other rows' deltas are after-minus-before over an explicit after side.
- Result level: all 13 keys built explicitly (asserted equal to the example's key set); `note` composed from the example's own IDENTITY, NOT COVERED and SHOCK REACH sentences with the demo's id, version and coverage (the composition is proven against both example notes before use — the brief's spread would have said "this result is scenario eth_minus_30" on every result). `positions_answered` = Σ accounts; `positions_withheld` 0.
- Envelope: `evaluation.note` "Batch 1 was STILL…" → "Batch 18251 …" (OVERRIDDEN by rule); `resolved_at` = `probed_at` = served_at; `scenarios_evaluated` 4; `coverage.engines[]` summed from the Book's engine cards (the example's 2/1/1 rows were FALSE; OVERRIDDEN) with Σ positions_in_batch = 9964, Σ measurable = 9958, Σ refused = 6 asserted; `notes` verbatim (invariant prose).

Design figures (stated once, in the header): ETHFI −50 %: +$9,800 eligible debt, +$1,200 bad debt, 2 flips (the brief's); weETH depeg realization DERIVED from the Book (below); the legacy eth deltas are the contract example's own, read from the template engine.

## Census

`tests/unit/fixture-clock-law.spec.ts`: added `demo/run-book-demo-eth_minus_30.json: 2` and `demo/run-book-set-demo.json: 2` (the failure named exactly these two); `CENSUS_TOTAL` 97 → 101; batch-bearing bodies 38 → 40. `scenarios-demo.json` carries no batch and no age (0 trios) and, like the lab-book listings, is not pinned.

## Tests

`cd web && npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts tests/unit/fixture-clock-law.spec.ts` → `96 passed (3.2s)`.
`cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts tests/unit/lab-view.spec.ts tests/unit/lab-transitions.spec.ts` → `21 passed (2.8s)`.
`npm run typecheck` and `npm run lint` clean. `node tests/fixtures/demo/generate-demo-lab.mjs` → `wrote scenarios-demo.json (0 clocks checked)`, `wrote run-book-demo-eth_minus_30.json (2 clocks checked)`, `wrote run-book-set-demo.json (2 clocks checked)`.

## Deviations from the brief's code, with reasons

1. `writeChecked` reads `report.failures` / `report.checked` (the law's real shape).
2. Histograms are the example's `hf_histogram` shape with the table's margins as counts (`infinite_count` = lane 8, `refused_count` = lane 9). The Book's per-engine histogram entry carries an `engine` key and no `wad_scale`, so spreading it (the brief's `histogramFromRows(hist, …)`) would add a key to a sealed component and drop a required one. The Book's edges, counts and tallies are asserted equal to the table instead.
3. The not-measured cell's two debts are null (the contract: "null and never \"0\""; `lab-transitions`' `cellDebt` is the same law), not "0". The pin's sum `BigInt(x.debt_before_usd)` did not typecheck (TS2345) and threw at runtime on that null; the spec sums the non-null debts and the two `expect` values are verbatim.
4. `transitionsOf` takes the engine's own template so `comparator`, `wad_scale` and `note` are per engine (the brief used the Cash note on the legacy engine).
5. Cash `hf_dropped_accounts` null; legacy `flipped_to_eligible` null (schema).
6. The Cash eth `flipped_to_eligible` is the table's crossings, asserted equal to the waterfall's newly-eligible count (118).
7. Reach shapes as described above (the brief's `.every` on an object).
8. Projection as described above (no template on the contract fixtures).
9. The weETH realization is derived, not the brief's constants: the shortfall is 5 % of the collateral at risk (Cash 16768539245 × 5 / 100 = 838426962; the brief's 838000000000 is that figure ×1000 — a $838,000 shortfall on $16,768.54 of collateral at risk), and the bad debt at liquidation is max(current bad debt, eligible debt − 95 % of the collateral at risk) = 239603961 (the brief's 41020000000 is the eth waterfall's 0.70 bad debt, and exceeds the eligible debt). The seizure model and sentence are the contract's weeth run-book fixture's. The legacy engine (also covered by the definition) carries its own block: 455 / 0.
10. Result notes, engine notes and the evaluation note are re-figured by rule rather than spread verbatim.
11. The set's `coverage.engines[]` and the run-book's `coverage` are the Book's.
12. Cash `movers_note` restated (ranking and truncation); `held_flat` + ETHFI.
13. The generator pins its clock trios; legacy deltas are read from the template rather than typed as constants.
14. Weld spec, compiler-forced: `DEMO_BOOK.waterfall!` (nullable on the type), `row!.health_factor!` (nullable on the position type), the null-safe debt sums. Pinned values unchanged.
15. `DEFINITION_ETH` reconciled (the parent's ruling). Serena's `replace_symbol_body` on a `const` re-emitted the `export const` prefix, leaving `export const export const …;;`; repaired by hand before the tests.

## Concerns

- The positions pages are Plan 1's 1,000-row sample: 207 of page 1's 951 non-liquidatable rows cross under ×0.7, while the Book's waterfall states 118 newly eligible. `movers_total` is the Book's (as the pin requires); a reader who counts the pages finds more.
- The legacy engine states two movement counts by design: `movers_total` 14 (newly eligible, per the brief) on the run-book and `hf_dropped_accounts` 8499 (lane-changed rows, per the brief) on the set. The contract's Aave `movers_total` is the strictly-dropped count. The page is Cash-first.
- ETHFI −50 %: the Book does not decompose collateral, so total collateral and collateral at risk are held unchanged under a −50 % mark on the design row (the brief's figures); a reader could notice.
- The demo Aave card's bad-debt figures are dust ("4600" / "9100" at 8 decimals) beside the contract example's $6,000 delta on the legacy after side.
- The set's eth reach carries the contract example's applied prices (weETH mainnet 400000000000) while `meta.demo.json`'s mainnet weETH witness is 999900000000; the reach rides verbatim as the brief says.

## Fix round 1

Review verdict: spec ✅, two Importants and two minors taken.

- I1 (false provenance sentence). The two positions pages are the WHOLE 1,412-row Cash book (page 1 `total_positions` 1412, page 2 `next_cursor` null) and bucket to the Book's histogram exactly ([41,8,14,13,73,153,300,804], no-debt 0, refused 6) — not a 1,000-row sample. The header now says so, and says that the Book's transition table, not a naive re-shock of the rows, is the law for the crossings; a reader who re-shocks every row by ×0.7 by hand finds 207. The generator now asserts both facts before it reads a mover: `weldPages` (row count = the card's positions, the pages' bucketing = the Book's histogram, tallies included) and `NAIVE_CROSSINGS = 207`, so the header's sentence cannot go stale. The movers are drawn from both pages (page 2 holds no crossing row today; the spec's lookup covers both pages).
- I2 (movers order stated backwards). The sort is ascending ratio-after, so row 1 is the account furthest past the cap. The Cash `movers_note` now reads "ranked here by the exact ratio AFTER the shock, ascending: the account furthest past the cap first" and "`movers` carries the 20 furthest past the cap; the other 98 are not on this page." The weld spec's movers pin title and comment state the same order, and the pin now quotes both sentences. The ranking itself (the brief's ruling) is unchanged.
- Minor (a): `realizationFigures(before)` is the one rule; the generator proves it against the contract's own weETH example on both engines (Cash 200000000 / 820000000, Aave 0 / 0) before applying it, and the weld spec pins the same: the rule over `RUN_BOOK_WEETH_BATCH_1`'s before sides equals its blocks, and over the demo run-book's two before sides equals the demo set's two blocks (Cash 838426962 / 239603961).
- Minor (b): the weld spec deep-equals the helper's `DEFINITION_ETH` to `scenarios-demo.json`'s `eth_minus_30` on id, version, label, description, path_assumption, engines, shocks and out_of_model.

No figure moves — proven: the three HEAD bodies were copied out, the generator re-run, and each body deep-diffed path by path: `scenarios-demo.json` IDENTICAL, `run-book-set-demo.json` IDENTICAL, `run-book-demo-eth_minus_30.json` differs at exactly one path, `engines[1].movers_note` (the I2 wording). Only the generator, that run-book body and the weld spec changed.

Checks (from web/): `npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts tests/unit/fixture-clock-law.spec.ts tests/unit/lab-view.spec.ts tests/unit/lab-library.spec.ts tests/unit/lab-movers.spec.ts` → `117 passed (1.1s)`; `npx playwright test --project=unit` → `1248 passed (4.2s)`; `npx tsc --noEmit` clean; `npx eslint tests/unit tests/fixtures/demo` clean.

Session note: the first attempt at this round was cut by a session rate limit after the generator edits were written; on resume the generator was re-read (all seven edits were present) and the round finished from there.
