# Task 11 report: fixtures — the `/v1/meta` copy and the realistic-scale demo dataset

**Status:** DONE
**Commit:** `1ada8ba` — `test(web): fixtures - /v1/meta byte copy and the generated realistic-scale demo dataset, welded` (10 files, all under `web/tests/`; `web/tests/e2e/shell.spec.ts`, modified by someone else, was left unstaged)

## What was implemented

| File | Role |
|---|---|
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\generate-overview.mjs` | byte-copies `packages/client-ts/test/fixtures/meta.json` → `tests/fixtures/meta.json` (brief verbatim) |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\meta.json` | GENERATED — `cmp` against the client fixture: identical |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\meta.ts` | `META: Schemas["MetaResponse"]` (brief verbatim) |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\generate-demo.mjs` | the seeded (mulberry32, seed 18251) demo generator with provenance header |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\{book.demo,meta.demo,positions-dm-demo-page-1,positions-dm-demo-page-2}.json` | GENERATED |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\index.ts` | `DEMO_BATCH_ID`, `DEMO_BOOK`, `DEMO_POSITIONS_DM_PAGE_1/2`, `DEMO_META` (brief verbatim) |
| `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\demo-fixture-weld.spec.ts` | the five weld tests |

Generator's printed summary line (identical on both runs):

```
wrote demo dataset: 1412 Cash rows · 49 liquidatable · Σ debt 27524960273838 (6-dec)
```

Dataset shape as generated: page 1 = 1,000 rows, `next_cursor: "demo-cursor-2"`, `sort: "headroom"`, `limit: 1000`, `total_positions: 1412`; page 2 = 412 rows, `next_cursor: null`, the 6 refused rows last. Batch 18251, `computed_at 2026-08-08T20:22:08Z`, `age_seconds 42`, `served_at 2026-08-08T20:22:50Z` on all four envelopes. Cash engine: 1,412 positions / 1,406 computed / 6 refused (`SWEEP_NEVER`) / 49 liquidatable; `bad_debt.eligible_positions 49`, `eligible_debt_usd` = Σ liquidatable debt. `meta.demo.json.watermark_vector`: `aave_v3_etherfi@25714690, aave_param@25714690, debt_manager@155323444` (price pollers untouched).

## RED → GREEN evidence

**RED (Step 2, before the generator existed):**
```
Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo' imported from C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\demo-fixture-weld.spec.ts
Error: No tests found.
```

**Intermediate (generator with the brief's verbatim draw ranges):**
```
✓ pages chain and cover the population
✓ every row carries the canonical row's keys
✓ the engine aggregates reconcile to the rows
✘ materiality and near-cap proportions are the designed ones
    Expected: 27   Received: 42     (line 48: expect(nearCapRows(rows).length).toBe(27))
✓ rows are served least room first, breached before everything
1 failed, 4 passed
```
(The 2/4/43 materiality split on line 47 passed on the first run; only the near-cap count was off.)

**GREEN (after deviation 3 below):**
```
✓ 1 pages chain and cover the population (7ms)
✓ 2 the engine aggregates reconcile to the rows (9ms)
✓ 5 materiality and near-cap proportions are the designed ones (6ms)
✓ 3 every row carries the canonical row's keys (297ms)
✓ 4 rows are served least room first, breached before everything (279ms)
5 passed (2.5s)
```

**Typecheck:** `npm run typecheck` → `tsc --noEmit`, exit 0.

## Deviations from the brief (each with evidence)

### 1. `liq_distance.kind: "distance"` with `debt/cap` factors (parent's supplied fact; brief said `"solved"`)
`LiqDistance.kind` is `"distance" | "breached" | "never" | "none"` (`web/node_modules/@solvent/client/src/generated/*.ts:1759`). Non-liquidatable computed rows get `{ ...template.liq_distance, kind: "distance", scale_factor_num: <debt>, scale_factor_den: <cap>, factor_asset, factor_symbol, reason: null }`; liquidatable rows keep the template's `breached` shape. Sample generated row: `hf 48680124202/48501009860`, `liq_distance: { kind: "distance", scale_factor_num: "48501009860", scale_factor_den: "48680124202", factor_asset: "0x5A7f…CBFF", factor_symbol: "weETH", reason: null }`.

### 2. `factor_asset` is the chain-10 weETH ADDRESS, and `"weETH"` goes in `factor_symbol` (contract-forced; both the brief and the parent's note said `factor_asset: "weETH"`)
`api/openapi.yaml:2306-2308`: `Address: type: string, pattern: "^0[xX][0-9a-fA-F]{40}$"`; `LiqDistance.factor_asset: components["schemas"]["Address"] | null` (generated types line 1764); `factor_symbol?: string` is the contract's label field, "served on BOTH engines on every `distance` row whose factor asset the registry can name" (lines 1765-1776). `"weETH"` in `factor_asset` would be off-contract. The generator reads the address from `tests/fixtures/meta.json` `prices` (`chain_id 10`, `symbol "weETH"`, `priceproviderv2`, `engine-exact` — the Cash engine's own valuation witness) and throws if it is absent; nothing is hardcoded. Provenance is recorded in the header.

### 3. The "rest" draw range floor 0.10 → 0.12 (weld-spec-forced)
Evidence: intermediate run above (near-cap 42 vs 27). Cause: `computedRow`'s `roomFraction` is debt-relative (`cap = debt·(1+r)`), while `headroomBand` (`web/lib/headroom.ts:201-211`) measures `(cap − debt)/cap = r/(1+r)` against edges `[2,5,10,25,50]`, and `NEAR_CAP_BANDS = {1,2,3}` (`web/lib/cash-rows.ts:77`). A debt-relative draw of r < 1/9 ≈ 0.111 therefore lands in the 5–10% band; with `between(0.1, 0.8)` fifteen of the 1,330 "rest" rows did (my band histogram under the verbatim range: `{1:10, 2:4, 3:28, 4:431, 5:884}`; after the fix `{1:10, 2:4, 3:13, 4:419, 5:911}` — bands 1–3 sum to exactly 27, the 27 designed near-cap rows). The floor 0.12 is ≈10.7% of cap, leaving margin for micro-dollar rounding. The comment in the generator records the reasoning. This is the parent's sanctioned fix ("adjust the generator's draw ranges and regenerate"); no JSON was touched by hand.

### 4. Only the batch IDENTITY is spread into each envelope's batch block (provenance-header-forced)
The brief's `book.batch = { ...book.batch, ...batch }` / `meta.batch = { ...meta.batch, ...batch }` spread page-1's entire batch block, which contradicted the header's "envelopes … with ONLY the batch identity and the aggregate fields recomputed". Evidence from the verbatim run: `batch.watermarks` length `book.json 5 | book.demo 2 | meta.demo 2`, and `book.demo.json`'s `supersession.note` was page-1's text rather than book.json's own. Fix: a `batchIdentity` object (`id, computed_at, age_seconds, position_count, refused_count, flagged_count`) is spread into `page1.batch`, `book.batch` and `meta.batch` separately. After the fix: `5 | 5 | 5`, and each envelope keeps its own supersession note.

### 5. Weld spec reads rows through the client's refinement, not a cast (the parent's first option — recording the choice)
`wire = pages.flatMap((p) => p.positions).map(refinePositionSummary)` (`packages/client-ts/src/refine.ts:228-231`, exported from `@solvent/client`), which turns the wire's `liquidatable: boolean | null` into `liquidation_verdict` via `liquidationVerdict` (lines 79-88) — the same read the app performs. `RefinedPositionSummary` is structurally `CashWireRow` (as Task 7's report established), so `readCashRow` typechecks with no cast and the `type CashWireRow` import is dropped (it would otherwise be an unused import). Consequence: the "every row carries the canonical row's keys" test iterates the RAW `pages.flatMap((p) => p.positions)` rather than `wire`, because refined rows have `liquidation_verdict` in place of `liquidatable` and would not match the raw template's keys.

### Not a deviation (parent's fact confirmed)
The refused row already spreads the template's full `Refusal` (`code`, `detail`, `note`) and overrides only `code: "SWEEP_NEVER"` — the brief's code, unchanged. Generated refused rows carry the template's `detail` and `note` verbatim.

## Reproducibility check

The generator was run twice after the final edits; `sha256sum` of the four outputs was identical between runs:

```
2158a3fa902959987b54fdae9c28bbc98d452a379febcd9ab18a23bcf880790d  book.demo.json
eebfb02eac710193636ec32af70afa12c6b68876904ce9c8fa28220ad6a041d6  meta.demo.json
cd883fc4c4dbf06b9fdff5ee0c8c2de39f8e844032f0c00158465f05b615b05a  positions-dm-demo-page-1.json
a3bad03e0179ef0afd2b2093ca0fff9c8a4bc826ec8da8712cf294c5acdc265f  positions-dm-demo-page-2.json
```
`meta.json`: `cmp` against `packages/client-ts/test/fixtures/meta.json` reports no difference.

## Self-review

- All ten files present and staged by name; `git add -A` never used; `scope-gate: OK -- integrator claude-integrator; 10 path(s)`; the control-plane doctor reported 0 errors / 0 warnings on commit.
- Sums reconcile: proven by test 3 (`total_debt` = Σ computed debt; `liquidatable_positions` = `eligible_positions` = 49; `eligible_debt_usd` = Σ liquidatable debt) and test 4 (2/4/43, 27).
- No hand edits: every JSON is the generator's output, and the byte-identical re-run above proves the committed bytes are what the generator emits.
- ESLint on the five new source files: 0 errors, 1 warning — `generate-demo.mjs:33 'DEC' is assigned a value but never used` (the brief's constant, kept verbatim since a warning does not force a deviation; delete it if the repo is meant to be warning-clean).
- `npm run typecheck` exit 0; `tests/**` is inside `tsconfig.json`'s include, so the loaders and the spec are typechecked.

## Concerns (not acted on — outside "deviate only where forced")

1. **Batch watermarks vs the live vector are incoherent in `meta.demo.json`.** The brief rewrites only `watermark_vector` to the real riskd heights (25714690 / 155323444); `batch.watermarks` on all three envelopes, and every row's `balances_block`/`params_block`/`sweep_block`, keep the template's 25635618 / 154796552. A 42-second-old batch thus appears ~79K mainnet blocks and ~527K OP blocks behind its live cursor. If the demo meta will be rendered, apply the same height map to `batch.watermarks` (three lines in the generator) and consider stamping the rows' as-of blocks at 155323444 / sweep 155323400.
2. **The Cash `hf_histogram` is not recomputed from the rows.** It keeps `book.json`'s counts (1 in `< 0.90`, `refused_count 1`) beside an engine card saying 1,412 / 49 / 6. The weld spec does not pin it, and the brief does not touch it. A ten-line bucketing of `num·1e18/den` over the computed rows (refused_count 6, infinite 0) would make the header's "aggregates SUMMED from the rows" true for it as well.
3. **Legacy histogram counts are the brief's:** `[46, 12, 27, 318, 1204, 2890, 4055]` fill 7 of 8 buckets (`>= 2.00` gets 0), and 46 + 12 = 58 positions sit below HF 1.00 while `liquidatable_positions` is 46.
4. **Σ debt = $27.52M**, not ≈ $24.6M (unpinned by the spec). The log-uniform draw's expectation is ≈ $26.6M plus ≈ $0.8M of near-cap debt; lowering the upper bound (e.g. 120000 → ~95000) would land nearer the design figure — untested, and it would reshuffle every downstream row.
5. **Sort-order latent risk:** the generator sorts by truncating BigInt tenths; the client's `headroomTenths` floors. They can disagree only when a negative-room row has exact-integer tenths; test 5 proves it does not happen for seed 18251, but a future range change could surface it. Comparing exact rationals by cross-multiplication would remove the risk.
6. Git printed `LF will be replaced by CRLF` for every new file (autocrlf); the committed blobs are LF-normalized, so index bytes are stable, but a Windows checkout will hold CRLF copies that differ on disk from a fresh generator run until Git renormalizes them — the same property as the existing fixtures.

---

# Fix round 1

**Status:** DONE
**Commit:** `5202ff9` — `fix(web): demo dataset - histograms derived from rows, exact ordering, coherent counters and heights` (6 files: the generator, the four regenerated JSONs, the weld spec; `scope-gate: OK -- integrator claude-integrator; 6 path(s)`; the foreign `web/tests/e2e/shell.spec.ts`, `web/tests/e2e/overview.spec.ts` and `web/tests/unit/cash-summary.spec.ts` were left alone; no JSON was hand-edited)

Concerns 1, 2, 3 and 5 above are closed by this round; 4 (Σ debt vs ≈ $24.6M) and 6 (autocrlf) remain as noted.

## What changed (all in `generate-demo.mjs` unless stated)

| # | Finding | Change |
|---|---|---|
| 1 | Legacy histogram vs card | counts `[40, 6, 27, 318, 1204, 2890, 4055, 12]` (one per template bucket — the generator now throws if the count array and bucket array differ in length), `refused_count: 0`, `infinite_count: 0`. Invariants are CHECKED, not assumed: Σ = 8,552 = positions and the `< 1.00` buckets (`upper_wad ≤ 1e18`) = 46 = `liquidatable_positions`; either mismatch throws. |
| 2 | Cash histogram not derived | Every computed row's `cap/debt` as a floored wad (`num·1e18/den`, the template's `hf_num/hf_den` comparator) is bucketed on the template's own `[lower_wad, upper_wad)` edges (null-open ends); `refused_count = rows − computed = 6`, `infinite_count = 0`. Checked: Σ buckets = 1,406 = `computed_positions`, `< 1.00` = 49 = `liquidatable_positions` (debt > cap ⇔ cap/debt < 1, so the floor cannot cross 1e18). Result: `[41, 8, 14, 13, 263, 481, 586, 0]`. |
| 3 | Integer-tenths comparator | Exact rational `(cap − debt)/cap` compared by cross-multiplication (cap > 0 on every computed row), refused rows (no cap) last, `account` as the tie-break on equal room and among refused rows — a total order. Evidence: 0 inverted adjacent pairs in exact order (was 486). |
| 4 | meta counters | `sweep_never_refusals_in_batch = 6`; `sweeps[debt_manager]`: `rows = 1412`, `never_swept = 6`, `success = rows − never_swept − failed_since_success = 1405`. The contract (`api/openapi.yaml:3470-3483`, `SweepCounts`) types `rows` as a bare int64 with no description; the template's own arithmetic (`3 = 1 + 1 + 1`) fixes it as a partition of sweep-table rows, one per Cash account, which the generator keeps (`failed_since_success` stays the template's 1). |
| 5 | `batch.watermarks` heights | One `HEIGHTS` map (`aave_v3_etherfi`/`aave_param` 25714690, `debt_manager` 155323444) applied by engine through `atHeights` to every batch block (page 1, book, meta) and to `watermark_vector`; price pollers untouched. All four now agree. |
| 6 | Waterfall point 0 | `cumulative_collateral_at_risk_usd` at index 0 = Σ liquidatable `total_collateral` = `bad_debt.collateral_at_risk_usd` (16768539245); later points keep the brief's scaled figure. |
| 7 | Refused rows' debt | `refusedRow` draws `total_debt` log-uniformly on $300–$120,000 (the book's own size law); `health_factor` and `total_collateral` stay null. Six distinct debts; the provenance header now says "account and debt varied". Refused debt is outside `total_debt` (computed rows only), as before. |
| 8 | Weld test 2 template | `demo-fixture-weld.spec.ts` imports `POSITIONS_DM_PAGE_1` from `../fixtures/book` and compares every demo row's keys to the CANONICAL row's, not the demo's own `positions[0]`. |
| 9 | Unused `DEC` | Removed (the decimals are noted on `USD`). `npm run lint` is clean. |

Also: `coverage.in_book` / `refused_in_batch` and `batch.refused_count` are now derived from `refusedCount` instead of the literal 6, and the header's provenance bullets describe the derived histograms, the exact ordering and the height map.

## Generator's summary line (identical on both runs)

```
wrote demo dataset: 1412 Cash rows · 49 liquidatable · Σ debt 27828808216758 (6-dec)
```
(Σ debt moved from 27524960273838 because the six refused-row draws now consume PRNG values ahead of the 1,330 "rest" rows; the 76 rows drawn before them — material, small, dust, near cap — are unchanged, which is why the 2/4/43 and 27 proportions held without a range change.)

## Commands and output

`node tests/fixtures/demo/generate-demo.mjs` then the evidence script (scratchpad, not committed):
```
hist aave_v3_etherfi: counts=[40,6,27,318,1204,2890,4055,12] sum=8552 computed_positions=8552 | <1.00=46 liquidatable_positions=46 | refused_count=0 refused_positions=0 | infinite=0
hist debt_manager: counts=[41,8,14,13,263,481,586,0] sum=1406 computed_positions=1406 | <1.00=49 liquidatable_positions=49 | refused_count=6 refused_positions=6 | infinite=0
exact-order inversions among computed rows: 0 | refused rows are the last 6 rows: true
refused debts: 2342652043,614386524,46249593616,7063922637,112060308468,10549872809 | distinct: 6 | collateral/hf null: true
meta sweeps dm: {"rows":1412,"never_swept":6,"failed_since_success":1,"success":1405} partition holds: true | sweep_never_refusals_in_batch: 6
heights page1: aave_v3_etherfi@25714690 debt_manager@155323444
heights book : aave_v3_etherfi@25714690 aave_param@25714690 prices:poll:1@25635610 debt_manager@155323444 prices:poll:10@154796540
heights meta : aave_v3_etherfi@25714690 aave_param@25714690 prices:poll:1@25635610 debt_manager@155323444 prices:poll:10@154796540
vector       : aave_v3_etherfi@25714690 aave_param@25714690 prices:poll:1@25635610 debt_manager@155323444 prices:poll:10@154796540
waterfall p0 at_risk: 16768539245 bad_debt.collateral_at_risk_usd: 16768539245 equal: true | monotone debt: true
coverage: {"batch_positions":9964,"in_book":9958,"refused_in_batch":6,... | batch refused_count: 6
```

`npx playwright test --project=unit tests/unit/demo-fixture-weld.spec.ts`:
```
✓ pages chain and cover the population (9ms)
✓ materiality and near-cap proportions are the designed ones (6ms)
✓ the engine aggregates reconcile to the rows (8ms)
✓ rows are served least room first, breached before everything (280ms)
✓ every row carries the canonical row's keys (303ms)
5 passed (797ms)
```

`npm run typecheck` → `tsc --noEmit`, exit 0. `npm run lint` → `eslint .`, no output, exit 0 (the `DEC` warning is gone).

## Reproducibility check

Generator run twice after the edits; `sha256sum` of the four outputs identical between runs:
```
1047a6cba1ad7b9ee49f86c779f9f44ec1ffd3dda239b42f01da64bba916b501  book.demo.json
356698c6cd396b7e2d3356f88d9b6f176fc8bc13e20f8c6d31b1690352ba0c84  meta.demo.json
410b55ecb6e5e596ab5c2b134951c29ceabed4840d44992f663b4d2b4d545e2e  positions-dm-demo-page-1.json
9eabbc88cca3b972c63f078708c76577ca2d98286d2bb49cb9461f6eaaf5577e  positions-dm-demo-page-2.json
```

## Residual notes

- Rows' own as-of blocks (`balances_block`/`params_block`/`sweep_block`) still carry the template's 154796552 / 154796500 while the batch's `debt_manager` watermark is now 155323444; the review asked for the batch blocks only, so the rows were left verbatim per the header's "all other fields verbatim". Stamping them at the batch height is a two-line follow-up if the Book renders per-row as-of marks against the demo.
- The batch's `debt_manager` watermark `sweep` sub-object (`rows: 3, failed: 1, success_sum …`) is the template's and now disagrees with meta's `sweeps` (`rows: 1412`); not in the review's list, left verbatim.
