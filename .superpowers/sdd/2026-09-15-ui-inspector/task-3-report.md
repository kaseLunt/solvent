# Task 3 report: `inspector-position` — the Cash reading, collateral table, boundary sentence, Prices chip

Status: DONE_WITH_CONCERNS (one lint-driven line change in the spec; no expectation touched)

Commit: `cf8e6de0c7e1f9fbc31511fe71318d4caa7f7a41`
`feat(web): read a Cash position into room, legs, the boundary sentence and the Prices chip - the engine's verdict decides, the wire's solve is followed`

Files (exactly three, staged by name):
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\inspector-position.ts` (new, 240 lines, brief Step 3 verbatim)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\inspector-position.spec.ts` (new, 173 lines, brief Step 1 with one two-line substitution, see Deviations)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\helpers\cash-position.ts` (new, 55 lines, brief Step 1 verbatim; no `.spec` suffix so the unit project does not run it)

## What I did, in the brief's TDD order

1. Read the brief, then verified every helper the module imports against its real signature before writing a line: `headroomBand/headroomTenths/headroomPercent` (`web/lib/headroom.ts`, edges `[2, 5, 10, 25, 50]`, breached band 0, `floorDiv`), `percentOf/fallPercent/formatTenths` (`web/lib/percent.ts`), `humanPrice/humanAmount` (`web/lib/human-price.ts`), `classifyFactorPrice` (`web/lib/factorPriceGuard.ts`, `{ ok: false; fields: string[] }` confirmed), `noPricePathTitle` (`web/lib/liq-distance.ts`), `humanAge` (`web/lib/freshness.ts`), `isWireDecimal` (`web/lib/wireGuard.ts`), `ViewChip` (`web/lib/cash-view.ts`), `truncateAddress` (`web/lib/format.ts`); and the client shapes `RefinedPosition`, `RefinedLeg`, `PriceInput`, `LiquidationPrice`, `FactorPrice`, `Refusal`, `CollateralUse = "counted" | "not-counted" | "unknowable"`, and `lookup()`'s `{ outcome: "found", response }` arm (`packages/client-ts/src/refine.ts`, `lookup.ts`, `generated/schema.ts`).
2. Wrote the helper and the spec first. Ran the spec: `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\inspector-position'` — the brief's expected failure.
3. Wrote the module exactly as the brief's Step 3.
4. Ran the spec: 9 passed. Ran `npm run typecheck` (exit 0) and `npm run lint` (exit 0, but one WARNING on the spec's `_dropped`). Fixed that one spec line (below), re-ran all three: 9 passed, tsc exit 0, lint exit 0 with no output.
5. From the repo root: `git add` the three files by name, `python roadmap/tools/scope_gate.py` printed `scope-gate: OK -- integrator claude-integrator; 3 path(s)`, committed with the brief's exact message (no attribution lines). The commit hook's control-plane doctor reported `OK -- 0 error(s), 0 warning(s), 5 info`.

## Exact test output

```
Running 9 tests using 9 workers
  ...
  9 passed (2.3s)
```

(First green run before the lint fix: `9 passed (2.5s)`. Final run after the lint fix: `9 passed (2.3s)`.)

`npx tsc --noEmit` — exit 0, no output. `npm run lint` — exit 0, no findings.

## Deviations from the brief, and why

### 1. One spec line: `_dropped` rest-sibling replaced by the repo's `delete` idiom (lint-driven, no expectation changed)

The brief's spec drops `price_decimals` with

```ts
const { price_decimals: _dropped, ...noScale } = first;
```

Under the repo's ESLint config (Next core-web-vitals + typescript presets) that produced `149:27 warning '_dropped' is assigned a value but never used @typescript-eslint/no-unused-vars` — 0 errors, 1 warning. The task's instruction is that lint must be clean, so I replaced those two lines with the idiom the sibling specs already use for exactly this case (`tests/unit/factor-price-guard.spec.ts:127`, `tests/unit/inspector-evidence.spec.ts:181`):

```ts
const noScale = { ...first };
delete (noScale as { price_decimals?: number }).price_decimals;
const unscaled = near({ liquidation_price: { ...p.liquidation_price, prices: [noScale as never] } });
```

Same input to the module (a served entry with no `price_decimals` key); the assertions `u.kind === "unreadable"` and `u.fields` contains `"price_decimals"` are unchanged and pass.

### 2. "Expected: 10 passed" vs nine tests

The brief's Step 4 says 10 passed; the spec has nine `test(...)` calls (the caller flagged this). Result is 9 passed. Nothing was deleted or weakened.

### 3. No expectation needed correcting — the arithmetic

Every value in the spec was recomputed by hand from the `near()` fixture and the helpers' real code before the run; all agree with the brief.

`readCashPosition`, cap 5,012,500,000, debt 4,822,000,000:
- room = 190,500,000. `headroomTenths` = floor(1000 × 190,500,000 / 5,012,500,000) = floor(38.004) = 38 → `"3.8%"`; used = 1000 − 38 = 962 → `"96.2%"`.
- `headroomBand`: scaled = 100 × 190,500,000 = 19,050,000,000; edge 2 × num = 10,025,000,000 ≤ scaled < edge 5 × num = 25,062,500,000 → index 0 → band 2 → in `NEAR_BANDS {1,2,3}` → `"near"`.
- debt 5,400,000,000: room = −387,500,000; floorDiv(1000 × −387,500,000, 5,012,500,000) = floor(−77.31) = −78 → `"−7.8%"` (U+2212); used = 1000 − (−78) = 1078 → `"107.8%"` (an independent truncation of 5,400/5,012.5 = 107.73 would print 107.7 — R15 is why the complement is used). Verdict `liquidatable` decides the status; band is 0 (den > num).
- debt 2,100,000,000: room = 2,912,500,000; floor(2,912,500,000,000 / 5,012,500,000) = floor(581.05) = 581 → `"58.1%"`, used 419 → `"41.9%"`; scaled = 291,250,000,000 ≥ 50 × num = 250,625,000,000 → band 6 → not near → `"healthy"`.
- cap 0: `headroomTenths(0, …)` → null (num ≤ 0) so `roomPercent`/`usedPercent` null; `headroomBand(0, 4,822,000,000)` → den > num → 0; verdict `liquidatable`; room = −4,822,000,000 (non-null) so `isComputedCash` is true.
- debt == cap: room 0; scaled 0 < every edge × num → band 1 → `"near"`.
- refused: `status: "refused"` short-circuits `computed`; debt 4,100,000,000 still read; cap null. `"4.62e9"` fails `^-?[0-9]+$` → `wireInt` null → not computed.

`collateralTable`:
- weETH amount 2.1e18 at 18 dec → `humanAmount` whole 2, fraction "1000"→"1" → `"2.1"`. Price 4,000,000,000 at 6 dec → `humanPrice`: ten-thousandths 40,000,000 ≥ 100,000 → 2 places → units 400,000 → `"$4,000.00"`. LTV `percentOf(4,200,000,000, 8,400,000,000)` = 500 tenths → `"50%"`.
- ETHFI amount 3,250e18 → `"3,250"`. Price 1,250,000 at 6 dec → ten-thousandths 12,500 < 100,000 → 4 places → `"$1.2500"`. LTV 1000 × 812,500,000 / 4,062,500,000 = 200 → `"20%"`.
- Σ value 8,400,000,000 + 4,062,500,000 = 12,462,500,000 = `collateral_value_usd` → `collateralAgrees` true. Σ contribution 4,200,000,000 + 812,500,000 = 5,012,500,000 = `max_borrow_lt` → `capAgrees` true; with cap 5,000,000,000 → false.
- Zero value → `value <= 0n` → LTV null. No price input → price null.

`boundaryOf`:
- `lowest_healthy_price` 3,818,571,429 at 6 dec → `"$3,818.57"` (2 places, truncating). `fallPercent(4,009,500,000, 4,200,000,000)` = floor(1000 × 190,500,000 / 4,200,000,000) = floor(45.36) = 45 → `"4.5%"`. Held minus factor = [ETHFI] → " — with ETHFI flat". Sentence matches the brief byte for byte.
- Two factor assets: held minus factor = [] so no held clause; ETHFI floor 1,193,304 at 6 dec → ten-thousandths 11,933 < 100,000 → `"$1.1933"`. Sentence matches.
- `never_liquidatable` with reason `"position holds no counted collateral in the factor"` equals `LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL`, whose title ends `Wire: '<reason>'.` so `toContain(reason)` holds.
- `[null]` → `classifyFactorPrice` non-record → `fields: ["entry"]` → unreadable. Missing `price_decimals` → `isWireScale(undefined)` false → `fields` contains `"price_decimals"`. `lowest_healthy_price: null` → floors empty → absent. `prices: null` → `Array.isArray` false → absent. Verdict `liquidatable` is checked before `lp` → breached even with `never_liquidatable: true`.

`pricesChip`:
- Both fixture inputs `source: "priceproviderv2"` (inherited from the DM fixture) → `"PriceProvider v2"`; oldest 35 → `humanAge` `"35s"`; both fresh → rank 0 → `"ok"`.
- age 210 → `"3m"`, stale → rank 1 → `"warn"`. Plus `AAVE.price_inputs` (source `aaveoracle:0x43b6…`, age 210) → `"PriceProvider v2 + Aave oracle · 3m"`. `missing` → rank 2 → `"crit"`. Empty → `"no inputs"` / `"refused"`.

## Observations for review (not defects in this task)

- `headroomBand` returns bands 0..6 (edges `[2, 5, 10, 25, 50]`), not 1..7 as the task context said. It does not affect any expectation: near = bands 1–3 (< 10 % room), healthy = 4–6 (≥ 10 %), breached = 0.
- `position.refusal.detail ?? null` in the brief's module: `Refusal.detail` is a non-nullable `string` in the generated schema, so the `?? null` is a no-op. The repo's lint has no type-aware rule to flag it, and it is harmless (defensive against a JSON-cast body), so I left the brief's code as written.
- A `status: "computed"` position whose `borrowings` or `max_borrow_lt` is null/malformed reads as `status: "refused"`, `computed: false`, with `refusal: null` — the brief's design (the malformed-decimal test relies on it). Consumers should key on `computed`/`refusal`, not assume `status === "refused"` implies a wire refusal.
- `isComputedCash` excludes `status: "unknowable"` even though such a position has `computed: true`. Per the brief's type (`ComputedCash.status` excludes it); noting it because the Aave-shaped verdict lands there.
- Git printed LF→CRLF normalization warnings on `add` (repo autocrlf); no action taken.

## Post-commit check against the moved HEAD

After my commit, HEAD advanced to `a755bb0` (`fix(web): a nonzero token amount never prints as 0 - sub-precision amounts read <0.0001; fallPercent refuses a negative fall`), not mine. That commit changes two helpers this module calls (`humanAmount`, `fallPercent`). Verified: `cf8e6de` is an ancestor of HEAD, the three task files are byte-identical in HEAD (`git diff cf8e6de HEAD -- <three files>` is empty), and the spec re-run at `a755bb0` is `9 passed (2.3s)`. The fixture's amounts (2.1, 3,250) are above the new sub-precision floor and its fall (4,009,500,000 from 4,200,000,000) is positive, so neither helper change reaches this spec.

## Not touched

No other file was modified. `.superpowers/sdd/.gitignore` was already `M` before this task and was not touched by me. This report is written into the untracked `.superpowers/sdd/2026-09-15-ui-inspector/` directory and is not staged.

---

# Fix round 1 (review of cf8e6de: spec ✅, quality needs-fixes)

Commit: `099b0b6492850f15789806370caf797863f4aee0`
`fix(web): inspector-position review round - an empty factor list is phrased on its axis, a partial joint solve is never half-printed, contradictions are named, negative decimals are not positions`

Files (exactly two, staged by name, commit pathspec-limited): `web/lib/inspector-position.ts`, `web/tests/unit/inspector-position.spec.ts`. The helper `web/tests/unit/helpers/cash-position.ts` is untouched.

## Test output

```
Running 10 tests using 10 workers
  ...
  10 passed (2.2s)
```

`npx tsc --noEmit` exit 0. `npm run lint` exit 0, no findings. `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. Commit hook: control-plane doctor `OK -- 0 error(s), 0 warning(s), 5 info`.

Extra safeguard (not asked for): the whole unit project at the pre-commit working tree — `1093 passed (7.2s)` — so Task 6's landed Trust checklist, which imports `readCashPosition`/`isComputedCash`, is unaffected by the band-0 and negative-decimal changes.

## What changed, per the coordinator's numbered list

Module (`web/lib/inspector-position.ts`):
1. `AXIS_LABEL` map added; when `factor_assets` is empty the no-price-path sentence is `No downward move on the ${AXIS_LABEL[lp.axis] ?? lp.axis} axis alone reaches the boundary.`; otherwise the original `of <symbols>` sentence.
2. Partial joint solve: after classification, an ok entry with `lowest_healthy_price === null` beside at least one floor returns `{ kind: "unreadable", fields: ["prices[i].lowest_healthy_price", …] }`; all floors null stays `absent`. `held` is `held_assets` minus factor assets minus every asset with a served floor, deduplicated on lowercase address, original casing kept for `symbolFor`.
3. `if (!cash.computed) return { kind: "absent" };` is the first line of `boundaryOf`, before the liquidatable check.
4. `Boundary` gains `{ kind: "contradictory"; detail: string }`; returned when `lp.already_breached` is true, or `num > den` (both readable), with the two exact detail strings. Placement: right after the `never_liquidatable` arm and before `prices` is read — wire read order (the solve's header fields precede `prices` in the schema), so a contradiction in the header is named even when `prices` is empty or malformed. The verdict is already known not-liquidatable at that point (the `breached` arm returned earlier).
5. Every malformed entry's fields are unioned, prefixed `prices[i].` (a null entry reads `prices[i].entry`).
6. `computed` additionally requires `debt >= 0n && cap >= 0n`; `NEAR_BANDS = {0, 1, 2, 3}`; `roomPercent` is `formatTenths(roomTenths)` (the `headroomPercent` import dropped as unused); doc comment on the `!computed` return explaining `status: "refused"` with `refusal: null` for an unreadable computed row.
7. `VERDICT_RANK[i.verdict] ?? 2`; `leg.symbol || truncateAddress(...)` in both `symbolFor` and `collateralTable` (empty string falls back).

Spec: one new `test(...)` block covering all ten coordinator cases (empty factor list → exact axis sentence; partial joint solve → `prices[1].lowest_healthy_price`; two malformed entries → `prices[0].entry` and `prices[1].price_decimals`; rise → `contradictory`; `already_breached` → `contradictory`; refused with lp set → `absent`; `borrowings: "5400000000"` with a not-liquidatable verdict → `near` / `−7.8%` / `107.8%`; `borrowings: "-1"` → not computed; verdict `"weird"` → `crit`; `held_assets: [WEETH, ETHFI, ETHFI]` → `ETHFI` once; `symbol: ""` → `0x5A7f…CBFF`).

## One existing pin changed — the direct consequence of rule 5

`expect(u.fields).toContain("price_decimals")` (the brief's p1b-4 pin) became `expect(u.fields).toContain("prices[0].price_decimals")`. Under rule 5 every malformed field is index-prefixed, so the bare name is no longer an element of `fields` and the old pin would fail; the new pin asserts the same defect at the same entry with its index. The coordinator allowed exactly this class of change ("except where an existing pin now contradicts the rules above"); it is the only one.

## Hand-checks on the new arms

- Empty factor list: `factorSymbols.length === 0` and `axis: "eth_usd"` → `AXIS_LABEL` hit → the exact pinned sentence.
- Partial: fixture `num 4,009,500,000 < den 4,200,000,000`, `already_breached: false` → no contradiction; both entries classify ok; weETH has a floor, ETHFI does not → `floors.length === 1`, `missing = ["prices[1].lowest_healthy_price"]` → unreadable.
- Rise: `4,400,000,000 > 4,200,000,000` → contradictory (and `fallPercent` would have returned null for it since a755bb0 — the arm now refuses before the sentence rather than silently dropping the fall clause).
- Debt above cap, not-liquidatable: `headroomBand` → 0 (den > num) → in `NEAR_BANDS` → `near`; `floorDiv(−387,500,000,000, 5,012,500,000)` = −78 → `formatTenths(−78)` = `−7.8%` (MINUS from `human-usd.ts`), used `1078` → `107.8%`.
- `"-1"` passes `isWireDecimal` (`^-?[0-9]+$`) but fails `debt >= 0n` → not computed. `"-0"` is `0n` and still fine.
- Held dedupe: `[WEETH, ETHFI, ETHFI]` minus `{weeth}` (factor and priced) → `ETHFI` once → `sentence.split("ETHFI").length === 2`.
- `truncateAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")` = `"0x5A7f" + "…" + "CBFF"`.

## Concerns for the coordinator

- `Boundary` now has a sixth arm, `contradictory`. Tasks 9 and 10 consume `Boundary`; any exhaustive `switch` there must handle it (tsc over the whole web tree passes today, so nothing landed yet switches exhaustively on it).
- Ordering choice in rule 4 (contradiction checked before `prices` is read) was mine — the coordinator said only "before building the sentence". Consequence: `already_breached: true` with `prices: []` reads `contradictory`, not `absent`. If `absent` is preferred there, the two `if`s move below the malformed check; no test in the spec distinguishes the two orders.
- `VERDICT_RANK[i.verdict] ?? 2` is type-redundant (`Record<Verdict, …>` indexing is non-optional) but is the runtime rule the review asked for; lint has no type-aware rule to flag it.
