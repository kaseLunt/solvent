# Task 10 review — the Inspector demo dataset (commit 58d5502)

Reviewer: task reviewer (read-only). Scope: brief `task-10-brief.md`, report `task-10-report.md`, package `review-20f077b..58d5502.diff`.

**Verdict A — SPEC COMPLIANCE: ✅**
**Verdict B — CODE QUALITY: needs-fixes** (two Important findings, both inherited from the brief's own constants; the rest Minor)

Every command below was run from `web/` unless stated. Nothing was staged or committed; the generator was re-run and reproduced the committed bytes exactly.

---

## What I ran

| Check | Command | Result |
|---|---|---|
| Determinism | `node tests/fixtures/demo/generate-demo-inspector.mjs && git status --short tests/fixtures/demo` | 8 `wrote …` lines (4,4,4,4,2,0,0,2 clocks); `git status` empty; `git diff --stat` empty. **Byte-identical.** |
| Nondeterminism sources | `grep -nE 'Date\.now\|Math\.random\|hrtime\|performance\.now' generate-demo-inspector.mjs` | none |
| Verbatim to brief | `diff <(brief Step 3 block) generate-demo-inspector.mjs`; same for Step 1 vs `demo-inspector-weld.spec.ts` | both identical (CR-stripped) |
| Weld + census specs | `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts tests/unit/fixture-clock-law.spec.ts` | 92 passed (6 + 86) |
| Whole unit project | `npx playwright test --project=unit` | 1134 passed |
| Typecheck / lint | `npm run typecheck`; `npx eslint` on the four task files | exit 0 / exit 0 |
| Contract shape | ajv 6 over `api/openapi.yaml` `components.schemas` (OpenAPI-3.0 `nullable` rewritten to `anyOf`), all eight bodies + `book.demo.json` + `meta.demo.json` as trusted controls; negative controls: stray `_cap` key, bad `amount_unit` enum | all 10 VALID; both negative controls rejected |
| Refined client | the weld spec's `lookup(body)` on the four address bodies, the history and the stress | no `ContractInvariantError` (spec green) |

---

## A. Spec compliance — the brief, walked

### Files
- ✅ Created `web/tests/fixtures/demo/generate-demo-inspector.mjs` (diff L960–1358), verbatim to Step 3.
- ✅ Created the eight generated JSON bodies (diff L22–959, L1359–3216, L3246–3612).
- ✅ Modified `web/tests/fixtures/demo/index.ts` (diff L3217–3245): the twelve exports of Step 4, verbatim; `DEMO_*_ADDR` read off the bodies (`DEMO_ADDRESS_NEAR.address` etc.), not duplicated.
- ✅ Modified `web/tests/unit/fixture-clock-law.spec.ts` (diff L3723–3815): six `demo/…` CENSUS entries (4,4,4,4,2,2), `CENSUS_TOTAL` 77→97, batch-bearing pin 32→38, `directories` untouched.
- ✅ Created `web/tests/unit/demo-inspector-weld.spec.ts` (diff L3613–3722), verbatim to Step 1.

### Interfaces consumed (generator L993–1008)
- ✅ `book.demo.json`: `BATCH` (id 18251, `computed_at` 2026-08-08T20:22:08Z, `age_seconds` 42), `served_at` 2026-08-08T20:22:50Z, the `debt_manager` watermark (`last_block` 155323444, sweep rows 3 / failed 1 / generation 4) — verified by dumping the file.
- ✅ `meta.demo.json`: chain-10 weETH witness `0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF`, `priceproviderv2`, `engine-exact`, `4000000000` @ 6 — verified.
- ✅ `../scenarios.json`: definitions spread by id (`eth_minus_30`, `ethfi_minus_50`, `dm_rate_horizon_plus_200bps`); `scenario_config_version: "v1"` read from it (present, so the `stress-dm.json` fallback was correctly not needed).
- ✅ `../stress-dm.json`: `lookup_complete_note`, `notes`, and the projection note (`scenarios[0].results[0].projection.note`; `scenarios[0]` IS the projection scenario in the committed file — see Minor 3 on the positional read).
- ✅ `../clock-law.mjs`: `ageSeconds`, `checkClocks` imported and used (L987, L1003, L1340).

### The near account IS the mockup's
Dumped `address-demo-near.json` and recomputed:
- ✅ debt `4822000000`, cap `5012500000`, collateral `12462500000` (= 8,400 + 4,062.50); room 190.50 = 3.8 %.
- ✅ weETH `2100000000000000000` × `4000000000` → `8400000000`, contribution `4200000000` (50 %); ETHFI `3250000000000000000000` × `1250000` → `4062500000`, contribution `812500000` (20 %).
- ✅ Boundary: `scale_factor_num` 4009500000, `den` 4200000000; `price_floor` = ⌊4000000000×4009500000/4200000000⌋ = **3818571428**; `lowest_healthy_price` = ceil = **3818571429**; 1 − 4009.5/4200 = 4.536 % → "a 4.5 % fall"; `held_assets` includes ETHFI → "with ETHFI flat". `boundaryOf` (lib/inspector-position.ts:198) yields the exact sentence the spec pins.
- ✅ Prices: `source_as_of` 20:22:15Z = served_at − 35 s, `age_seconds` 35, `budget_seconds` 180, `verdict: fresh` — the law's own `ageSeconds` produced the 35 (checkClocks passed).
- ✅ Sweep: verbatim watermark (1 of 3 failed, gen 4) because `batch: BATCH` is the Book's object.

### The eight bodies
- ✅ `address-demo-near` — `status: computed`, `liquidatable: false`, `already_breached: false`, `num < den`.
- ✅ `address-demo-liquidatable` — debt 5400: `liquidatable: true`, `already_breached: true`, floor 4369047619 **above** spot 4000000000 (consistent — `boundaryOf` returns `breached` off `cash.status` before reading the solve, so no `contradictory` arm is reachable). `boundary_is_healthy: true` is still a true statement about the boundary point itself.
- ✅ `address-demo-healthy` — debt 2100: `liquidatable: false`, floor 1226190476 / ceil 1226190477.
- ✅ `address-demo-refused` — `status: refused`, `flags: ["sweep_failed"]`, `refusal.code` SWEEP_FAILED, `liquidatable: null`, `collateral_value_usd`/`max_borrow_lt`/`total_collateral_base`/`liquidation_price`: null, legs' `value_usd`/`max_borrow_contribution`/`used_as_collateral`: null, **`borrowings` and `total_debt_base` kept (4100000000)**, `amount` kept. `readCashPosition` → `computed: false`, debt 4100000000n, refusal SWEEP_FAILED (spec green). See Important 2 on the code's provenance.
- ✅ `history-demo-near` — 98 points (100 − 2 withheld), ids unique and strictly descending 18251→18152, withheld `[18201, 18202]` absent from points, exactly one refused point at 18170 with all four nullable fields null. `computed_at` steps exactly 30 s × Δid; `balances_block` steps exactly 15 × Δid (2 s/block, OP-consistent); `sweep_block` = balances − 54 everywhere; no duplicate stamps. Newest point: `computed_at` == `batch.computed_at`, `balances_block` == `dm.last_block`, `health_factor.num/den` == position's `max_borrow_lt`/`total_debt_base`, `total_collateral_base` == position's `collateral_value_usd` — **exactly the position**. Every non-newest computed point's `total_collateral_base` == ⌊cap × 12462500000 / 5012500000⌋ (tracks the cap ratio). All `total_debt_base` = 4822000000, all `liquidatable: false`, no cap < debt. Room (oldest→newest) drifts 38.0 % → 3.8 % with the wobble off from k ≥ 84; trailing under-10 % streak = **14** (18238..18251), span 13 × 30 = **390 s**. `roomSeries.computedCount` = 97.
- ✅ `events-demo-near` — 6 rows, all `account` = near, `tx_hash` all unique and `^0x[0-9a-f]{64}$`, `block_number` strictly descending, non-null `block_time` non-increasing, exactly one null (last row — a disclosed untimed tail, as the contract orders cross-engine pages). `amount_unit` ∈ {dm_normalized_debt, opaque, none}; `type` ∈ {borrow, supply, collateral_enabled, repay} — all within the closed enums (`EventAmountUnit` L4066, `EventDisplayType` L4028). See Important 1 and Minor 4 on semantics.
- ✅ `params-demo-dm` — `engine: debt_manager`, `asset: null` (engine-global), one `ParamChange` with `fields[0].name` borrow_apy, `unit` per-second-1e18, `prior` set, `source_event` borrow_apy_set, `block_time` served_at − 3 h.
- ✅ `stress-demo-near` — three scenarios in the pinned order; `before.eligible`/`liquidatable` false; `eth_minus_30.after` cap 3752500000 (= 4200×0.7 + 812.5), collateral 9942500000, `liquidatable: true`; `ethfi_minus_50.after` cap 4606250000, collateral 10431250000, `liquidatable: true`; `applied_shocks` one entry (factor as Decimal strings, before/after prices, three booleans false), `held_flat` the other asset at its price; projection horizons: extra = ⌊4822000000 × 200 × s / (10000 × 31536000)⌋ = 7926575 / 23779726, projected 4829926575 / 4845779726, both < cap 5012500000 → `becomes_liquidatable: false` (rows[2].flips false; every horizon `not-liquidatable`). `eligible` == `liquidatable` per the contract's "the Debt Manager is its strict boolean".

### Identity across bodies
- ✅ Six batch-bearing bodies share `batch.id` 18251, `computed_at`, `age_seconds` 42, `served_at`; events and params share `served_at`. (Pinned by weld test 1 for id/computed_at/served_at; age via the clock census.)

### The census procedure (Step 5)
- ✅ Generator printed 4,4,4,4,2,0,0,2 → +20; 77 + 20 = 97. Six of the eight bodies carry `batch` → 32 + 6 = 38. The report's quoted failure output names exactly those six files with those counts, and the spec passes at 97/38. Comment blocks added in the file's own style.

### Steps 2, 6, 7
- ✅ Report shows the Step-2 failure ("does not provide an export named 'DEMO_ADDRESS_HEALTHY'"). Step 6: 6 passed; unit project 1134 passed (re-verified). Step 7: commit message exact; twelve files; no attribution line (per the user's global rule).

---

## B. Code quality

### Important

**1. `events-demo-near.json` repay row carries a positive amount; the contract defines `amount` as the SIGNED delta.**
`generate-demo-inspector.mjs` L1247: `ev(8444, null, "repay", USDC, "150000000", "dm_normalized_debt", null, 9)`.
`ChainEvent.amount` (schema.ts ~L2020; openapi.yaml): "The SIGNED custodied delta in the ENGINE's own ACCOUNTING unit, verbatim … (a repay is negative on the debt side)." The committed feed fixtures follow it — every debt-side decrease is negative (`feed-liquidations.json`: `-2499100000`, `-1000000000`). `feedAmount` (lib/feed-view.ts:90) passes the sign through, so the Inspector demo renders "Repay 150.000000" where production would render "Repay −150.000000"; `scripts/screenshot-pages.mjs` L55 serves this body to the Inspector screenshot, so the canon screenshot would bake the wrong sign in. The constant is the brief's (Step 3 L413) — the implementer was verbatim-compliant. **Fix:** `"-150000000"`, regenerate, confirm `git status` shows only the one file.

**2. The refused account models a refusal production never emits (`SWEEP_FAILED`, flag `sweep_failed`).**
Generator L1105–1106 and L1178. The Go row-level refusal vocabulary (`internal/riskfeed/assemble.go:240–262` and the contract's `Refusal.code` doc) is G1/G2/G3, `SWEEP_NEVER`, `ENGINE`, `FLAG_CUSTODY_UNPROVEN`, `API_RECONSTRUCTION_MISMATCH`; `SWEEP_FAILED` appears nowhere in Go — only in the web phrasebook (`lib/refusal-phrasebook.ts:6`, planted by the ui-kit plan) and the two plan documents. `sweep_failed` appears in Go only as a SQL column name, never as a position flag. The Go comment on `SWEEP_NEVER` states the product's actual doctrine: a sweep that fails after a prior success does NOT refuse the row — the row is served against its last successful sweep (that is what `as_of.sweep_block` is for). So the demo canon teaches (a) a refusal code and flag the API never serves, and (b) the wrong doctrine — that the watermark's "1 of 3 rows failed" produces a refused row. The brief pins `SWEEP_FAILED` in the weld spec (Step 1 L84), so this is brief-origin. **Fix (needs a brief amendment):** `refusal.code: "SWEEP_NEVER"` with the Go's own detail wording, `flags: []`, `as_of.sweep_block: 0` on the refused position and history point 18170 (the history-point doc: "0 for a Debt Manager account that had never been swept at that batch"), and the weld pin changed to `SWEEP_NEVER` (phrasebook already has it: "collateral sweep never ran").

### Minor

**3. Provenance by assertion rather than derivation (generator L1016, L1319).**
The header says "the ETHFI asset is the committed ethfi_minus_50 scenario's asset", but `ETHFI.asset` is a hard-coded literal; if `scenarios.json` changed, the stress body's `shocks[0].asset` (spread from the file) and `applied_shocks[0].asset` (from the literal) would disagree inside one body with no error. Also `stressTemplate.scenarios[0].results[0].projection.note` is positional; a reorder of `stress-dm.json` throws a bare `TypeError` on `null.note`. **Fix:** `const ETHFI = { asset: def("ethfi_minus_50").shocks[0].asset, … }` (or assert equality), and find the projection scenario by id.

**4. `amount_decimals: 18` on the two `opaque` supply rows (generator L1243, L1245).**
Contract: `amount_decimals` is "Null on every row this contract serves", and `opaque` means "Render the raw integer verbatim; even decimals would be an interpretation." `feedAmount` ignores decimals on `opaque`, so there is no render defect, but the fixture asserts a scale the contract says nobody licensed. (Precedent: `feed-units.json` also carries `dec=6` on an opaque row, so this is a pre-existing tension, and the brief specified `18`.) **Fix:** `null`.

**5. Events' block↔time cadence disagrees with the history's and with itself.**
History: 15 blocks per 30 s (2 s/block). Events (L1242–1247): 344 blocks ↔ 9 min (1.57 s/blk), 1444 ↔ 25 min (1.04), 2944 ↔ 48 min (0.98), 5444 ↔ 110 min (1.21); and two distinct blocks (155322000, 155321990) share one `block_time` 19:57:50Z, which no chain produces. Brief constants. **Fix:** derive `block_time` from `blocksBack × 2 s` (the history's own rule) and drop the `minutesAgo` argument except for the one deliberate null.

**6. `Position.health_factor: null` on all four address bodies while the same account's history points carry the DM rational.**
Generator L1085 vs L1197. The Book's own generated DM rows (`positions-dm-demo-page-1.json`) carry `{wad: null, num, den, infinite: false, note}` as "a disclosure", and this dataset's history points do too — so one account at one batch discloses a ratio in one body and none in another. `readCashPosition` reads `borrowings`/`max_borrow_lt`, so nothing in the Inspector breaks. **Fix:** emit the same `{wad: null, num: s(cap), den: s(debt), …}` on computed positions (null on the refused one).

**7. The weld's identity pin covers id/`computed_at`/`served_at` but not the envelope.**
Spec L48–56. The brief names the sweep watermark ("1 of 3 rows failed, gen 4 — from the batch watermark") as part of the identity; `expect(body.batch).toEqual(DEMO_BOOK.batch)` would pin it (and `age_seconds` 42) in one line instead of relying on the census.

**8. Float path in `historyBody` (L1188–1190): `Math.sin`, `** 1.4`, `Math.round`.**
Deterministic today — V8 implements `Math.sin`/`Math.pow` in software (fdlibm port), not via libm, and regeneration here reproduced the bytes — but a future V8 ulp change could flip a `Math.round` at a .5 boundary and silently move a cap by 1 µUSD; the census/weld would catch a streak change but not a 1-unit cap move. An integer wobble (e.g. `((k * 7919) % 13 - 6)` tenths of a percent, all-BigInt) removes the path.

**9. Cosmetic.** History refused point's `refusal.note: ""` (L1178) vs the address refusal's prose note (L1106); the contract's own history example uses prose. Also inherited (not this task's): the price witness `source_as_of` 20:22:15Z is 7 s AFTER `batch.computed_at` 20:22:08Z yet is labelled "the value the engine itself computed with" — this comes from `meta.demo.json`'s witness and is the demo dataset's, not Task 10's.

---

## What is good and should stay

- The generator is a faithful, guarded derivation: every stamp is a computed instant, every age goes through the law's own `ageSeconds`, and `checkClocks` gates the write. Regeneration is byte-stable.
- BigInt throughout the money path; the boundary solve is exact and `ceilDiv` is correct.
- The history is welded to the position at its newest point by construction (`k === COUNT − 1` uses `near.cap`/`near.collateral`), not by coincidence.
- The census edit reads the generator's own printed counts and the comments say why each file carries what it does.
- `DEMO_*_ADDR` are read off the bodies; the weld spec never duplicates an address.

---

## Re-review (1d772dd)

**RE-REVIEW: all-addressed.** Nothing open.

Scope as instructed: the fix-round diff (`git show 1d772dd`, nine files), the report's "Fix round 1" section, determinism, the two specs, the near account's numbers, and tx-hash well-formedness. Nothing else re-opened.

### Preconditions
- `git diff --stat 1d772dd HEAD -- web/tests/fixtures/demo web/tests/unit/demo-inspector-weld.spec.ts web/tests/unit/fixture-clock-law.spec.ts` → empty: the working tree IS the fix round (the later `d88c0d0` touched none of these files).
- `stress-demo-near.json` is absent from the commit and byte-identical, as stated; it still validates and its `applied_shocks`/`shocks` assets agree with the now-derived ETHFI asset.

### Determinism and regressions
| Check | Result |
|---|---|
| `node tests/fixtures/demo/generate-demo-inspector.mjs` then `git status --short tests/fixtures/demo` | 8 `wrote …` lines (4,4,4,4,2,0,0,2 clocks — unchanged, so the census needed no edit); status **empty** |
| `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts tests/unit/fixture-clock-law.spec.ts` | **92 passed** |
| ajv over `api/openapi.yaml` (same harness as round 0, with trusted and negative controls) | all 10 VALID; both negative controls rejected |
| Near account | debt 4822000000 · cap 5012500000 · collateral 12462500000 · room 190500000 (3.8 %) · `scale_factor` 4009500000/4200000000 · `price_floor` 3818571428 · `lowest_healthy_price` 3818571429 → $3,818.57 / 4.5 % — **unchanged** |
| History | streak **14**, span **390 s**, newest point == batch 18251 with num/den 5012500000/4822000000; 97 computed points; no cap < debt; `total_collateral_base` still tracks the cap ratio; withheld `[18201, 18202]` |

### Each ruling, verified on the regenerated bytes
1. ✅ Repay delta signed: `events[5].amount` = `"-150000000"` (generator L~305; weld pins it).
2. ✅ Refused position: `refusal.code` SWEEP_NEVER, `detail` "collateral sweep never ran for this account", prose `note`, `flags: []`, `as_of.sweep_block: 0`, `borrowings` 4100000000 kept, `liquidatable`/`liquidation_price` null. Refused history point 18170: SWEEP_NEVER, prose note, `sweep_block: 0`, all four nullable fields null; every computed point keeps `sweep_block = balances_block − 54`. Weld pin updated to SWEEP_NEVER.
3. ✅ `ETHFI.asset` = `scenarioDef("ethfi_minus_50").shocks[0].asset` with a throw guard; leg asset, `applied_shocks[0].asset` and the spread `shocks[0].asset` all equal `0xe0080d2F…fD3f`. Projection note found by id `dm_rate_horizon_plus_200bps` with a throw guard; equals the committed note.
4. ✅ `amount_decimals: null` on all six rows (units dm_normalized_debt / opaque / none / opaque / dm_normalized_debt / dm_normalized_debt).
5. ✅ `block_time = served_at − (last_block − block_number) × 2 s` on every timed row (20:11:22Z, 19:34:42Z, 19:34:22Z, 18:44:42Z, 17:21:22Z), one null (the repay), stamps distinct and non-increasing, blocks strictly descending. The 42 s anchor offset against the history (served_at vs computed_at) is as you accepted.
6. ✅ Computed positions carry `health_factor: {wad: null, num: cap, den: debt, infinite: false, note: HF_NOTE}` (near 5012500000/4822000000, liquidatable 5012500000/5400000000, healthy 5012500000/2100000000); refused stays null. Same `HF_NOTE` string as the history points.
7. ✅ Weld asserts `expect(body.batch).toEqual(DEMO_BOOK.batch)` for the six batch-bearing bodies; the bodies' `batch` objects deep-equal `book.demo.json`'s (sweep 1 of 3, gen 4, age 42 included).
8. ✅ Integer wobble `((k × 7919) % 9) − 4` tenths for k < 84; no `Math.sin` on the path; streak still exactly 14 (room 9.9 % at k = 86, 10.4 % at k = 85).
9. ✅ Prose refusal notes on both the position and the history point (one `REFUSAL_NOTE` constant).
10. ✅ (Coordinator's item) `hash(seed)` = sha256 over `solvent-demo:<seed>`; six event hashes + the params hash are all `^0x[0-9a-f]{64}$`, all distinct, and reproduce from their seeds (`block_number × 1000 + log_index`; `155300000003`). Weld pins the 64-hex shape and uniqueness.

### One observation, not an open item
The history now reads: successful sweeps at batches ≤ 18169 (`sweep_block = balances − 54`), then `SWEEP_NEVER` / `sweep_block: 0` at 18170, then successful sweeps again from 18171. Under the Go doctrine (`internal/riskfeed/assemble.go:243–248`, SWEEP_NEVER = "never had a SUCCESSFUL sweep"), a `sweep_block: 0` between two swept batches implies the account's sweep row was reset at 18170. You ruled the point's `sweep_block: 0` accepted, so I am not re-opening it; noting it only so the narrative is known if anyone reads 18170 as canon.
