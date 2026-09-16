# Tasks 4 and 6 — implementation report

Branch `main`. Two commits, in order:

- `e633a14` feat(web): cash rows - room, band, verdict and selectors read from the wire without coercion
- `8853af3` feat(web): stress preview lines, refusal phrasebook, live-pill words - pure and pinned

Scope gate printed `scope-gate: OK -- integrator claude-integrator` before each commit (no claim renewal was needed). Files were staged by name only; the pre-existing unstaged `docs/plans/2026-09-15-ui-kit-overview-book.md` modification was left untouched.

## Library facts verified before writing (Serena `find_symbol`, `include_body=true`)

- `web/lib/headroom.ts`: `HEADROOM_BREACHED_BAND = 0`; `HEADROOM_BAND_EDGES = [2, 5, 10, 25, 50]`; `headroomBand` returns 0 when `den > num`, else `edgeIndex + 2` (so bands 1–6 cover 0–2 … ≥50, matching the brief); `headroomTenths(num, den) = floorDiv(1000n * (num - den), num)` — denominator is the **cap**, and `floorDiv` rounds toward −∞; `headroomPercent` formats tenths with the U+2212 minus.
- `web/lib/wireGuard.ts`: `WIRE_DECIMAL = /^-?[0-9]+$/`, so **`isWireDecimal("-0") === true`**. The existing `tests/unit/wire-guard.spec.ts` pins this: `"-0 and 000 are inside the contract, and both are ZERO under isZeroDecimal"` and `expect(wireBigInt("-0")).toBe(0n)`. Its `BAD_WIRE_VALUES` includes `"1e5"`, `"0.0"`, `"+5"`.
- `web/lib/freshness.ts` `humanAge`: `<60 → "Ns"`, `<60m → "Nm"`, else `"Hh Mm"` (9000s → `"2h 30m"`).
- `web/lib/freshnessTiers.ts`: `FreshnessTier = "fresh" | "aging" | "stale" | "critical"`.
- `web/lib/human-usd.ts` `humanUsd(value: bigint, decimals: number)`: `$0` for zero, `$6,000` for 6000 dollars, `$635.64` for cents remainder.
- `packages/client-ts/src/generated/schema.ts`: `PositionSummary` (line 1787) and `Waterfall` / `WaterfallPoint` / `WaterfallEngine` (838–873) exist under those names; `Refusal = { code: string; detail: string; asset?: Address; note: string }`; `HealthFactor = { wad, num, den: NullableDecimal; infinite; note }`; `LiqDistance.kind = "distance" | "breached" | "never" | "none"`; `BookResponse.waterfall: Waterfall | null` (line 946).
- `web/tsconfig.json` includes `**/*.ts`, so `npm run typecheck` covers `tests/`.
- `web/eslint.config.mjs` is only Next's `core-web-vitals` + `typescript` presets (no type-aware `no-unnecessary-condition`).

---

## Task 4 — `web/lib/cash-rows.ts`, `web/tests/unit/cash-rows.spec.ts`

### What was implemented

Exactly the brief's module: `CashWireRow`, `CashRow`, `readCashRow`, `SizedCashRow`, `liquidatableRows`, `nearCapRows`, `RoomBand`, `roomBands`, `roomPercentiles`, `sumDebt`. No implementation-side deviations.

### TDD evidence

RED — `npx playwright test --project=unit tests/unit/cash-rows.spec.ts`:

```
Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\cash-rows' imported from ...\web\tests\unit\cash-rows.spec.ts
Error: No tests found.
```

First run after implementation, spec still verbatim from the brief (this run is what forced the test-side deviations below):

```
✓ a computed Cash row: room = cap − debt, percent and band from headroom.ts
✓ a refused row reads as not computed with null figures — never zero
✘ a liquidatable row has negative room and the breached band
    Expected: "−31.2%"   Received: "−31.3%"
✘ a malformed wire integer is refused, not coerced
    Expected: false      Received: true        (total_debt: "-0" was accepted and computed)
✘ selectors: ... percentiles ...
    toEqual { median: "3.8%", p10: "−31.2%" }  — received p10 "−31.3%"
3 failed, 2 passed
```

`npm run typecheck` on the verbatim spec:

```
tests/unit/cash-rows.spec.ts(62,7): error TS2741: Property 'note' is missing in type '{ code: string; detail: string; }' but required in type '{ code: string; detail: string; asset?: string | undefined; note: string; }'.
tests/unit/cash-rows.spec.ts(89,92): error TS2322: Type 'null' is not assignable to type 'string'.
```

GREEN — same command after the test alignments: `5 passed (2.3s)`; `npm run typecheck` exit 0.

### Deviations (all test-side; the module is verbatim)

1. **`"−31.2%"` → `"−31.3%"`** in "a liquidatable row has negative room…" and in the `roomPercentiles` p10 expectation (and the comment's sorted tenths `−312` → `−313`). Reason: `headroomTenths` is `floorDiv(1000n*(cap−den), cap)`; `floorDiv(−1_000_000_000_000n, 3_200_000_000n)` is −312.5 floored to **−313**. Evidence: the `floorDiv` body (`quotient − 1n` when the remainder is non-zero and the numerator negative) and the runner output above. The brief itself says the library is the authority.
2. **Malformed input `"-0"` → `"4.62e9"`** in "a malformed wire integer is refused, not coerced". Reason: `"-0"` matches `WIRE_DECIMAL` and the wire-guard spec ratifies it as a legal zero, so the brief's row computed (`computed: true`). Keeping the test's intent (an out-of-contract integer is refused, never coerced) required an input the guard actually rejects; `"4.62e9"` is the scientific form `Number()` would silently coerce to 4620000000 — the exact trap the test guards. Assertions unchanged (`computed` false, `debt` null). Same class as the wire-guard spec's own `"1e5"`.
3. **`Refusal` literals given the required `note: ""`**, and the selectors test's `detail: null` → `detail: ""`. Reason: TS2741 / TS2322 above; the generated `Refusal` has `detail: string` and `note: string` both required, and `tests/` is under typecheck. The refused-row test still asserts `refusal` is passed through as `{ code, detail }`.

### Files

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\cash-rows.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\cash-rows.spec.ts` (new)

---

## Task 6 — `stress-preview`, `refusal-phrasebook`, `live-pill`

### What was implemented

Exactly the brief's three modules: `stressPreview` (+ `StressLine`, `StressPreview`), `plainCause`, `livePillWords` (+ `LivePillInput`, `LivePillWords`). No implementation-side deviations. Generated names `Waterfall`, `cumulative_eligible_accounts`, `cumulative_debt_eligible_usd`, `cumulative_bad_debt_usd`, `usd_decimals`, `grid_scale`, `scenario_id`, `axis` all exist as the brief assumed.

### TDD evidence

RED — `npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts`:

```
Error: Cannot find module '...\web\lib\live-pill' imported from ...\tests\unit\live-pill.spec.ts
Error: Cannot find module '...\web\lib\refusal-phrasebook' imported from ...\tests\unit\refusal-phrasebook.spec.ts
Error: Cannot find module '...\web\lib\stress-preview' imported from ...\tests\unit\stress-preview.spec.ts
Error: No tests found.
```

First run after implementation, specs verbatim:

```
✓ the committed book fixture previews one line per shocked grid point, per engine
✓ an engine absent from the grid is absent, never a zero line
✘ a malformed cumulative figure refuses the whole preview
    Expected: "refused"   Received: "view"     (cumulative_debt_eligible_usd = "-0" was accepted)
✓ known codes lead with a plain cause; ...
✓ stream words
✓ age tone follows the ratified tiers; ...
1 failed, 5 passed
```

`npm run typecheck` on the verbatim specs:

```
tests/unit/stress-preview.spec.ts(7,30):  error TS2345: Argument of type '{ ...Waterfall... } | null' is not assignable to parameter of type '{ ...Waterfall... }'.
tests/unit/stress-preview.spec.ts(16,28): error TS2345: (same)
tests/unit/stress-preview.spec.ts(24,24): error TS2345: (same)
tests/unit/stress-preview.spec.ts(29,14): error TS18047: 'broken' is possibly 'null'.
tests/unit/stress-preview.spec.ts(32,29): error TS2345: (same)
```

GREEN — same command after the alignments: `6 passed (2.5s)`; `npm run typecheck` exit 0. `refusal-phrasebook.spec.ts` and `live-pill.spec.ts` passed verbatim on the first green run — no changes to them.

### Deviations (all in `stress-preview.spec.ts`; the modules are verbatim)

1. **Malformed figure `"-0"` → `"4.2e9"`** in "a malformed cumulative figure refuses the whole preview". Same cause and reasoning as Task 4 deviation 2: `"-0"` is inside the wire contract, so the preview produced a `view`. `"4.2e9"` is the scientific form of the fixture's own 4200000000. Assertion unchanged (`kind === "refused"`).
2. **`BOOK.waterfall` narrowed once at module scope**: `const waterfall = BOOK.waterfall; if (waterfall === null) throw new Error("fixture invariant: book.json serves a waterfall");`, and the four call sites use `waterfall`. Reason: `BookResponse.waterfall` is `Waterfall | null` on the wire (a withheld grid), while the brief's stated interface is `stressPreview(waterfall: Schemas["Waterfall"], engine)` (non-null). The interface is the brief's contract, so the narrowing belongs in the spec. Evidence: the TS2345/TS18047 errors above and schema line 946.

### Files

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\stress-preview.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\refusal-phrasebook.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\live-pill.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\stress-preview.spec.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\refusal-phrasebook.spec.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\live-pill.spec.ts` (new)

---

## Combined run and lint (run before the Task 6 commit, so a lint finding could have been folded in)

`npx playwright test --project=unit tests/unit/cash-rows.spec.ts tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts` → **11 passed (2.6s)** (5 + 3 + 1 + 2).

`npm run lint` (`eslint .`) → no output, **exit 0**.

`npm run typecheck` → **exit 0** after each task.

## Self-review

- Every test in both briefs is present and asserting; the only changed assertions are the two `"−31.2%"` values, both forced by the library. Inputs changed only where the brief's input was inside the wire contract.
- Exports match the briefs exactly; no extra exports, no dead code added beyond the brief's own text.
- Staging: `git status --short --untracked-files=no` showed only the named files as `A` before each commit; no `.log`/`.exe` staged; the two commits touch 2 and 6 files respectively.
- No existing lib file modified; `.superpowers/sdd/.gitignore` untouched; no branches/worktrees.

## Concerns for the controller

1. **The task description's premise that `isWireDecimal("-0")` is false is wrong** — the library and its own spec treat `"-0"` as a legal zero. Any later task or UI spec that uses `"-0"` as its "malformed" fixture will pass the guard and read as zero; worth a sweep of the remaining briefs.
2. **`headroomTenths` floors toward −∞**, so any downstream copy pinning `"−31.2%"` for the cap 3.2e9 / debt 4.2e9 row (Overview/Book screenshots, headline strings) will disagree with the library; the correct pinned string is `"−31.3%"`.
3. **`stressPreview` takes a non-null `Waterfall`** while `BookResponse.waterfall` is nullable. Whichever UI task calls it must narrow first and render the withheld-grid case honestly (not as `absent`); the brief's `StressPreview` union has no variant for "the grid itself was withheld".
4. The brief's `row()` helper in `cash-rows.spec.ts` uses `liq_distance.kind: "solved"`, which is not in the generated `LiqDistance.kind` union; it compiles only because the whole literal is cast `as CashWireRow`. The tests never read `liq_distance`, so it is harmless, and I left the brief's text as given — but the fixture literal is outside the wire contract.
5. `readCashRow` keeps the brief's defensive `row.refusal === undefined` check and `detail ?? null`, both statically unreachable under the generated types (`refusal: Refusal | null`, `detail: string`). Lint does not flag them; left verbatim per the brief.

---

# Fix round 1 — review findings on Tasks 4+6

Commit `8096c5a` fix(web): stress preview refuses withheld engines and non-monotone grids; phrasebook lookup hardened — 4 files, staged by name, `scope-gate: OK -- integrator claude-integrator; 4 path(s)`.

## What changed

### `web/lib/stress-preview.ts` (Important 1, Important 2, Minor 3)

- **Withheld engine → refusal, not absence.** Before the `absent` return, `waterfall.excluded_engines.find((e) => e.engine === engine)`; a hit returns `{ kind: "refused", reason: plainCause(code, detail) }` (`plainCause` imported from `./refusal-phrasebook`). `EngineRefusal` is `{ engine, code, detail, note }` (`schema.ts:715–720`), all required.
- **Base point verified.** After the wire-decimal loop (so `BigInt(base.factor)` is safe): `BigInt(base.factor) !== scale` → `{ kind: "refused", reason: "the grid's first point is not the unshocked mark" }`.
- **Non-monotone series → refusal, never "no new liquidatable debt".** Two independent guards, in this order:
  1. The wire's own report: `Monotonicity = { ok: boolean; engine?; index?; factor?; detail? }` (`schema.ts:860–866`). When `!ok` and the report names this engine — or names no engine — return `{ kind: "refused", reason: detail.trim() }`, falling back to `"eligible debt falls between grid points"` when `detail` is absent or blank.
  2. Independently, walk consecutive points: any `cumulative_debt_eligible_usd` below the previous point's → `{ kind: "refused", reason: "eligible debt falls between grid points" }`.
  The line builder is unchanged; after the guards `deltaDebt` is provably ≥ 0, so the `"no new liquidatable debt"` head now only ever describes a true zero.

### `web/lib/refusal-phrasebook.ts` (Minor 8)

`PHRASEBOOK` is now a `ReadonlyMap<string, string>` and `plainCause` reads it with `.get(code)`. A Map has no prototype keys, so `plainCause("constructor")` falls through to `"refused (constructor)"` instead of returning `Object.prototype.constructor`. Entries unchanged.

### `web/tests/unit/cash-rows.spec.ts` (Minor 11)

The `row()` helper's `liq_distance.kind` is `"distance"` (in the generated union) instead of `"solved"`. The five tests are unchanged and still pass.

### `web/tests/unit/stress-preview.spec.ts` — covering tests (written first; all three RED before the fix)

Every existing assertion kept. The module-level narrowing became a `served(book)` helper (throws on the fixture invariant) so the two additional committed fixtures can be narrowed the same way. Three tests added, all on committed wire fixtures rather than hand-shaped data:

- (a) **withheld engine**: `BOOK_ENGINE_REFUSED.waterfall` (`book-engine-refused.json`: aave in `excluded_engines` with `FLAG_CUSTODY_UNPROVEN`, on no point). Asserts the fixture invariant (aave on no point), `stressPreview(…, "aave_v3_etherfi")` equals `{ kind: "refused", reason: "collateral-flag custody unproven" }`, and `debt_manager` still previews (`kind === "view"`). Also covers Minor 8 through the same path, since `refusal-phrasebook.spec.ts` was outside the files this round may touch: a cloned `excluded_engines` entry with code `"constructor"` → `{ kind: "refused", reason: "refused (constructor)" }`.
- (b) **non-monotone series**: `BOOK_MONOTONICITY_VIOLATION.waterfall` (`book-monotonicity-violation.json`: `monotonicity = { ok: false, engine: "debt_manager", index: 2, factor: "8e17", detail: "cumulative_debt_eligible_usd fell from 4200000000 to 4100000000 between grid points 1 and 2" }`, and the series really dips). Asserts `debt_manager` → refused with exactly the wire's `detail`; `aave_v3_etherfi` (the unnamed, monotone engine) still previews. Then the independent path: a `structuredClone` of `BOOK.waterfall` with aave's point-2 `cumulative_debt_eligible_usd` lowered to `"500000000000"` (below point 1's `"600000000000"`) and `monotonicity` left at `{ ok: true }` → `{ kind: "refused", reason: "eligible debt falls between grid points" }`.
- (c) **base factor ≠ grid_scale**: clone with `points[0].factor = "999999999999999999"` → `{ kind: "refused", reason: "the grid's first point is not the unshocked mark" }`.

## Commands and output

RED — `cd web && npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/cash-rows.spec.ts` (tests added, modules unchanged):

```
✘ an engine the wire withheld at the aggregate level is a refusal with the plain cause, never absent
    -   "kind": "refused",  -   "reason": "collateral-flag custody unproven",
    +   "kind": "absent",
✘ a non-monotone eligible-debt series is refused, never smoothed into 'no new liquidatable debt'
    -   "kind": "refused",  -   "reason": "cumulative_debt_eligible_usd fell from 4200000000 to 4100000000 between grid points 1 and 2",
    +   "kind": "view",
    +   ... { "deltaDebt": -100000000n, "shock": "ETH −20%", "text": "ETH −20% → no new liquidatable debt · bad debt $1,031" } ...
✘ a grid whose first point is not the unshocked mark is refused
3 failed, 9 passed
```

(`npm run typecheck` on the new spec: exit 0 — the spec compiled before the fix; the failures are behavioural.)

GREEN — same command after the fix:

```
✓ cash-rows.spec.ts × 5
✓ refusal-phrasebook.spec.ts × 1
✓ stress-preview.spec.ts × 6 (3 original + 3 new)
12 passed (2.6s)
```

`npm run typecheck` → exit 0. `npm run lint` (`eslint .`) → no output, exit 0.

Commit — from the repo root:

```
git add web/lib/stress-preview.ts web/lib/refusal-phrasebook.ts web/tests/unit/stress-preview.spec.ts web/tests/unit/cash-rows.spec.ts
python roadmap/tools/scope_gate.py        → scope-gate: OK -- integrator claude-integrator; 4 path(s)
git -c core.safecrlf=false commit -m "fix(web): stress preview refuses withheld engines and non-monotone grids; phrasebook lookup hardened"
→ 8096c5a  (4 files changed, 79 insertions(+), 14 deletions(-))
```

No `index.lock` collision; the concurrent commit `a46f7d0` (useCashBook) landed on `main` between `8853af3` and this fix and touches no file in this round.

## Notes for the controller

- A monotonicity report with `ok: false` and **no** `engine` named refuses every engine's preview (conservative: the wire did not say which series is untrustworthy).
- `refusal-phrasebook.spec.ts` was not modified (outside the allowed file list); the Minor 8 regression is pinned via `stress-preview.spec.ts` test (a) instead. If a direct `plainCause("constructor")` assertion is wanted in the phrasebook spec, that is a one-line follow-up.
