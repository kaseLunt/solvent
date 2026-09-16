# Task 3 review: `inspector-position` (commit cf8e6de)

Reviewer: task reviewer (read-only). Inputs read in order: `task-3-brief.md`, `task-3-report.md`, `review-239336c..cf8e6de.diff`. Sources read via Serena symbolic lookups: `web/lib/inspector-position.ts`, `headroom.ts`, `percent.ts`, `human-price.ts`, `factorPriceGuard.ts`, `wireGuard.ts`, `liq-distance.ts`, `freshness.ts`, `format.ts`, `cash-view.ts`; `packages/client-ts/src/{refine,lookup,types}.ts`; the generated schema (`Position`, `Leg`, `PriceInput`, `LiquidationPrice`, `FactorPrice`, `Refusal`); and, to judge reachability of the boundary edge cases, the Go solver `internal/risk/liqprice.go` and the API serializer `cmd/api/handlers.go`.

Verification I ran (read-only):

- `npx playwright test --project=unit tests/unit/inspector-position.spec.ts` from `web/` — `9 passed (2.3s)`.
- `git show --name-status cf8e6de` — exactly three `A` entries: `web/lib/inspector-position.ts`, `web/tests/unit/helpers/cash-position.ts`, `web/tests/unit/inspector-position.spec.ts`. No existing `web/lib/**` file touched.
- `git diff cf8e6de HEAD -- <the three files>` — empty; HEAD (`a755bb0`) carries the commit's bytes unchanged.
- U+2212 byte check (`E2 88 92`): `lib/headroom.ts` 11 occurrences, `lib/human-usd.ts` 1 (the `MINUS` constant that `percent.ts` and `human-price.ts` import), the spec 1 (the `"−7.8%"` pin). `percent.ts` has 0 literals because it imports `MINUS`. Negatives are the true minus sign throughout.

Line numbers below are file lines (the diff's `+` line minus 18 for the module, minus 325 for the spec).

---

## A. SPEC COMPLIANCE — ✅

### Interfaces (brief lines 11–28 vs `web/lib/inspector-position.ts`)

| Brief promises | Module | Evidence |
|---|---|---|
| `CASH = "debt_manager"`, `LEGACY = "aave_v3_etherfi"` | ✅ | `:15–16` |
| `CashStatus` five literals | ✅ | `:18` |
| `CashPosition` — account, decimals, debt, cap, collateral, room, roomPercent, roomTenths, usedPercent, band, verdict, status, refusal, computed | ✅ all fourteen, `readonly` | `:20–35`; `verdict: RefinedPosition["liquidation_verdict"]` is the three-literal `LiquidationVerdict` (`refine.ts:79–88`) |
| `ComputedCash` narrows debt/cap/room/computed/status only; percents stay nullable (R15) | ✅ | `:37–44` |
| `readCashPosition` | ✅ | `:52–84` |
| `isComputedCash` type guard | ✅ | `:86–88` |
| `CollateralLeg` (asset, symbol, amount, price, priceVerdict, value, contribution, ltv, counted) | ✅ | `:99–110` |
| `CollateralTable` (legs, sumValue, sumContribution, capAgrees, collateralAgrees) | ✅ | `:112–119` |
| `collateralTable(position, cash)` | ✅ | `:125–157` |
| `Boundary` five arms with the promised payloads | ✅ | `:159–164` |
| `boundaryOf(position, cash)` | ✅ | `:170–214` |
| `sourceDisplay` | ✅ | `:217–221` |
| `symbolFor` | ✅ | `:90–93` |
| `oldestPriceAge` | ✅ | `:223–226` |
| `pricesChip` returns `ViewChip` | ✅ | `:230–240`; `ViewChip.tone` admits `"ok" \| "warn" \| "crit" \| "refused"` (`cash-view.ts:10–14`) |
| Consumes list (brief line 8) | ✅ | `:4–13` — every named import and nothing else, plus `formatTenths` which the brief's own Step 3 imports |

Later-task import check (grep of `task-*-brief.md` for `from "./inspector-position"` / `"../../lib/inspector-position"`): Task 4 wants `symbolFor`, `oldestPriceAge`, `CASH`; Task 6 wants `ComputedCash`, `LEGACY`, `isComputedCash`, `readCashPosition`; Tasks 7 and 8 want `CASH`; Task 9 wants `boundaryOf`, `CASH`, `collateralTable`, `isComputedCash`, `LEGACY`, `pricesChip`, `readCashPosition`, `type Boundary`, `type CashPosition`, `type CollateralTable`; Task 10 wants `boundaryOf`, `collateralTable`, `readCashPosition`. All exported under those exact names. `CashStatus`, `ComputedCash`, `CollateralLeg` are exported too though no later brief names them yet.

### The nine tests (spec file lines; all pass)

1. **`:12` room/percents/near-cap.** cap 5,012,500,000 − debt 4,822,000,000 = 190,500,000 ✅; `headroomTenths` = floor(190,500,000,000 / 5,012,500,000) = 38 → `"3.8%"` ✅; used = 1000 − 38 = 962 → `"96.2%"` ✅ (R15 complement, `:79`); `headroomBand`: scaled 19,050,000,000 ≥ 2 × num = 10,025,000,000 and < 5 × num → index 0 → band 2 ✅; 2 ∈ `NEAR_BANDS` → `"near"` ✅; `isComputedCash` true ✅.
2. **`:25` verdict decides; healthy ≥ 10 %; zero cap; equality.** liq: room −387,500,000; `floorDiv(−387,500,000,000, 5,012,500,000)` = −78 → `"−7.8%"` (U+2212 from `headroom.ts:174`) ✅; used = 1000 − (−78) = 1078 → `"107.8%"` — the complement, not the independent truncation 107.7 ✅ R15; status from verdict at `:64–65` ✅. healthy: tenths 581 → `"58.1%"`, used 419 ✅; band 6 → `"healthy"` ✅. zeroCap: `headroomTenths(0n, …)` null (`num <= 0n`) → percents null ✅; `headroomBand(0n, debt)` → den > num → 0; verdict `liquidatable` decides ✅; room −4,822,000,000 non-null → `isComputedCash` true ✅ (R15: `ComputedCash` does not require percents). equal: band 1 → `"near"`, room 0n ✅ — strict rule honoured, the verdict (not-liquidatable) is not overridden.
3. **`:47` refused keeps debt, computes nothing.** `status: "refused"` fails `computed` at `:58`; debt still read at `:54` → 4,100,000,000n ✅; cap/room null ✅; refusal code carried ✅; `"4.62e9"` fails `/^-?[0-9]+$/` (`wireGuard.ts:21`) → `wireInt` null → not computed ✅. A malformed decimal never becomes a number.
4. **`:62` collateral table.** weETH: `humanAmount(2.1e18, 18)` → `"2.1"`; `humanPrice(4,000,000,000, 6)` → ten-thousandths 40,000,000 ≥ 100,000 → 2 places → `"$4,000.00"`; `percentOf(4,200,000,000, 8,400,000,000)` = 500 tenths → `"50%"` ✅. ETHFI: `"3,250"`, `"$1.2500"` (12,500 < 100,000 → 4 places), `"20%"` ✅. Σ value 12,462,500,000 = `collateral_value_usd`, Σ contribution 5,012,500,000 = `max_borrow_lt` → both welds true ✅; cap 5,000,000,000 → `capAgrees` false ✅.
5. **`:80` no price input → null price; zero value → null LTV.** `priceInputFor` finds nothing → `price: null` (`:136`) ✅; `value <= 0n` guard at `:140` → `ltv: null`; `percentTenths` also refuses `den <= 0n` (`percent.ts:7`) — no division by zero on either path ✅.
6. **`:91` factor-level sentence.** `lowest_healthy_price` 3,818,571,429 @ 6 dec → `"$3,818.57"` (the ceil, truncated for print) ✅; `fallPercent(4,009,500,000, 4,200,000,000)` = floor(190,500,000,000 / 4,200,000,000) = 45 → `"4.5%"` ✅; held − factor = [ETHFI] → `" — with ETHFI flat"` ✅; `certified` = `boundary_is_healthy` ✅; `diagnostic` false ✅. Byte-identical to the brief's pin.
7. **`:101` several assets, diagnostic, uncertified.** Two floors → `list(["weETH","ETHFI"])` = `"weETH and ETHFI"`, `fall 4.5% together`, per-asset floors joined by `", "`; held − factor = [] → no held clause ✅; ETHFI floor 1,193,304 → `"$1.1933"` ✅. `diagnostic: true` → `"Single-asset diagnostic: "` prefix ✅. `boundary_is_healthy: false` → verb `"near"` and `certified: false` ✅ (R3: "below" only when the wire certifies).
8. **`:129` absent / breached / no-price-path / unreadable.** `lp === null` → absent ✅. Verdict `liquidatable` checked at `:172` before `lp` is consulted → `"breached"` even with `never_liquidatable: true` ✅ (R3). `never_liquidatable` → sentence `"No downward move of weETH alone reaches the boundary."` and `noPricePathTitle` for the exact `LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL` string, whose title ends `Wire: '<reason>'.` ✅. `[null]` → `classifyFactorPrice` non-record → `fields: ["entry"]` → unreadable ✅. Missing `price_decimals` → `isWireScale(undefined)` false → `fields` contains `"price_decimals"` ✅ — classification happens at `:185` before any field is read at `:188–192` ✅ (R3). `lowest_healthy_price: null` → floors empty → absent ✅ (p0-8). `prices: null` → `Array.isArray` false → absent ✅ (p0-9).
9. **`:163` Prices chip.** Both fixture inputs `source: "priceproviderv2"` → `"PriceProvider v2"`, oldest 35 → `"35s"`, worst rank 0 → `"ok"` ✅; age 210 / stale → `"3m"` / `"warn"` ✅; plus `AAVE.price_inputs` (`aaveoracle:0x43b6…`) → `"PriceProvider v2 + Aave oracle · 3m"` ✅; `missing` → rank 2 → `"crit"` ✅; `[]` → `"no inputs"` / `"refused"` ✅. `sourceDisplay` maps only `priceproviderv2` and the `aaveoracle:` prefix; `"redstone-classic"` verbatim ✅ (R2).

### Global constraints

- **Engine's boolean decides.** `status` at `:63–70` reads `position.liquidation_verdict` first; bands only choose near vs healthy afterwards. Nothing derives a verdict from `debt`/`cap` arithmetic. `boundaryOf` returns `"breached"` from `cash.status`, never from `already_breached` or the scale factor. ✅
- **Refusals render honestly.** Debt survives a refusal; every other field is null; `computed: false`. ✅ (One defensive gap in `boundaryOf`, finding 6 below.)
- **R15.** `usedPercent = formatTenths(1000n − roomTenths)` at `:79`; `ComputedCash` leaves percents nullable; the zero-cap test pins it. ✅
- **R3.** Factor assets move together, held assets flat (`:197–198`), `lowest_healthy_price` is the printed floor (`:190`), "below" only when certified (`:199`), classification before reading (`:185–187`), `prices: null` folds into absent (`:183`). ✅
- **R2.** `pricesChip` takes the caller's `inputs` (the position's own `price_inputs`); tone from the worst verdict; `sourceDisplay` as ruled. ✅
- **Bigint only.** Every decimal enters through `wireInt` → `isWireDecimal` → `BigInt`; the only `number`s are `decimals`/`age_seconds`/`band`, which are integers on the wire. ✅
- **File set.** Exactly the three promised paths; no existing `web/lib/**` file changed. ✅ (The brief's `git add` line listed two files; the helper had to be the third since the spec imports it and Tasks 6 and 9 import it again. Correct call.)

### The deviation — `delete (noScale as { price_decimals?: number }).price_decimals` (spec `:149–150`)

Behaviourally identical to the brief's rest-destructure. Both produce an object whose own-property set lacks `price_decimals`; `classifyFactorPrice` reads `entry.price_decimals` → `undefined` → `isWireScale` false → `"price_decimals"` in `fields`. `{ ...first }` is a fresh shallow copy, so `delete` never touches `first` (which the `noFloor` case reuses two lines later). The idiom matches `factor-price-guard.spec.ts:127` and `inspector-evidence.spec.ts:181`. Assertions unchanged. Approved.

### Other report claims checked

- "10 passed" in the brief vs 9 tests: the brief miscounted; the spec has nine `test(` calls and all nine run. ✅
- `Refusal.detail` is non-nullable `string` in the schema (`schema.ts:958`), so `?? null` at `:53` is a no-op; harmless. ✅
- `headroomBand` returns 0..6 with 0 = breached (`headroom.ts:106, 201–211`), as the report says. ✅

---

## B. CODE QUALITY — needs-fixes

No Critical findings. Two Important, the first reachable on a consistent wire. The rest are Minor hardening against wire contradictions the module currently prints through instead of refusing.

### Important

**1. `boundaryOf` — the no-price-path sentence has an empty subject when `factor_assets` is `[]`, which is exactly what the wire serves for the pinned reason.**
`web/lib/inspector-position.ts:174, 178`.
The Go solver (`internal/risk/liqprice.go:263–279`) appends to `FactorAssets` only for legs whose asset is in the factor, and fires `never_liquidatable` with `"position holds no counted collateral in the factor"` precisely when `inWeight == 0` — i.e. when that list is empty. `hexes(nil)` (`handlers.go:1187–1193`) serializes it as `[]`, not `null`, so no throw — just a degenerate string. A Cash account whose counted collateral is stables only is the anticipated case (the title text itself says "stable collateral holds its value in this solve").
Failing input: `near({ liquidation_price: { ...lp, never_liquidatable: true, reason: "position holds no counted collateral in the factor", factor_assets: [], held_assets: [ETHFI] } })`.
Wrong output: `sentence === "No downward move of  alone reaches the boundary."` (double space, no subject).
Fix: when `factorSymbols.length === 0`, phrase the sentence on the axis, e.g. `` `No downward move on the ${lp.axis} axis reaches the boundary${held.length ? ` — ${list(held)} is held flat` : ""}.` ``; compute `held` before the `never_liquidatable` arm so it is available there. Add a spec pin with `factor_assets: []`. Note the current `never` fixture (`factor_assets: [WEETH]` with the no-counted-collateral reason) is inconsistent with the solver's semantics and is what hides this.

**2. `boundaryOf` — the sentence's moving set comes from the served floors, not from `factor_assets`; whenever the two differ, the sentence misstates which assets move and which are flat.**
`web/lib/inspector-position.ts:188–204`.
The subject is `floors` (entries with a readable `lowest_healthy_price`), while `held` subtracts `factor_assets`. Two consequences:
(a) Mixed floors. Input: `factor_assets: [WEETH, ETHFI]`, `prices: [weETH entry, { ...ethfiEntry, lowest_healthy_price: null }]`. Output: `"Liquidatable if weETH falls below $3,818.57 — a 4.5% fall."` — a joint two-asset solve printed as a single-asset fall; ETHFI is neither said to fall nor to be flat, and the 4.5 % is the joint factor. p0-8 already rules that a served entry without a boundary price is "absent, not a health claim"; the module applies that only when *every* floor is null.
(b) Empty factor list with a served floor (the inverse of finding 1). Input: `factor_assets: []`, `held_assets: [WEETH, ETHFI]`, `prices` as in the fixture. Output: `"…weETH falls below $3,818.57 — a 4.5% fall — with weETH and ETHFI flat."` — weETH both falls and is flat.
Reachability: on a consistent wire `prices` and `factor_assets` are 1:1 and every entry gets both floors (`liqprice.go:305–322`), so this needs a partial wire — but p0-8 observed a null floor in the wild, so partial is precedented. The brief's own law is "refusals render honestly": a partial joint solve must be refused, not half-printed.
Fix: after classification, `if (floors.length !== classified.length) return { kind: "absent" }` (or a dedicated `"partial"` arm if Task 9 wants to say so); build `held` by excluding both the factor set and every priced asset. Two pins.

### Minor

**3. `readCashPosition` — band 0 (breached-by-arithmetic) prints "healthy".**
`:50, 63–70`. `NEAR_BANDS = {1,2,3}` and the trailing `: "healthy"` means both `band === null` and `band === 0` (`HEADROOM_BREACHED_BAND`, den > num) fall through to healthy.
Input: `near({ borrowings: "5400000000" })` with the verdict left `not-liquidatable`. Output: `{ status: "healthy", room: -387500000n, roomPercent: "−7.8%" }` — "healthy" beside a negative room. The verdict is rightly not overridden, but the near/healthy *word* is the band's to choose and band 0 is nearer than band 1. Only an inconsistent wire reaches it (the engine's rule is literally debt > cap). Fix: `NEAR_BANDS = new Set([0, 1, 2, 3])`, or an explicit `band === 0 ? "near"`. The brief says {1,2,3}; flag to the brief's author.

**4. `readCashPosition` — a negative `borrowings`/`max_borrow_lt` (a legal wire decimal) is `computed: true` with every percent null.**
`:54–58`. `"-100"` passes `isWireDecimal`; `headroomBand`/`headroomTenths` refuse a negative denominator (null), so `band`, `roomPercent`, `roomTenths`, `usedPercent` are all null while `room = cap − debt` exceeds the cap and status falls through to `"healthy"`.
Input: `near({ borrowings: "-100" })`. Output: `{ computed: true, status: "healthy", room: 5012500100n, roomPercent: null, band: null }`. `"-0"` is harmless (`BigInt("-0") === 0n`). The API serializes uint256 balances so this does not occur in practice, but the reader should refuse what its own helpers refuse. Fix: fold `debt >= 0n && cap >= 0n` into `computed`.

**5. `readCashPosition` — a computed position with an unreadable decimal is labelled `status: "refused"` with `refusal: null`.**
`:59–61`. The word is a misnomer: nothing refused; the reader could not read. Input: `near({ borrowings: "4.62e9" })`. Output: `{ status: "refused", refusal: null, computed: false }`. A consumer keying "refused" to the "not computed — cause: …" headline finds no cause. The vocabulary already has `"unknowable"`; consider it for the `status === "computed"` unreadable case, or document that consumers must key on `computed`/`refusal` (the report already says so). No test change needed either way.

**6. `boundaryOf` — no short-circuit for `!cash.computed`.**
`:172–173`. A refused or unreadable Cash position whose `liquidation_price` is populated prints a full "Liquidatable if…" sentence, though the brief's law says a refused position computes nothing else. Input: `near({ borrowings: "4.62e9" })` (fixture lp intact). Output: `kind: "boundary"`. On the wire a refused position carries `liquidation_price: null`, so this is defensive; fix `if (!cash.computed) return { kind: "absent" }` after the breached check, or leave it to Task 9 and say so in the doc comment.

**7. `boundaryOf` — `scale_factor_num > scale_factor_den` (boundary above spot) keeps "falls below" while silently dropping the fall clause.**
`:194–204`. `fallPercent` now returns null for a rise (a755bb0), so the sentence becomes `"Liquidatable if weETH falls below $4,500.00 — with ETHFI flat."` against a served `current_price` of $4,000 — a floor above spot beside a not-liquidatable verdict. On a consistent wire num > den implies the engine's verdict is liquidatable and the breached arm fires first, so only a contradiction reaches it; the module also never reads `already_breached`. Suggest: when `num > den`, or when any classified floor ≥ its own `current_price`, do not print "falls below" — return `"absent"` (or a distinct arm) and surface `already_breached` in the title.

**8. `boundaryOf` — first malformed `prices` entry wins; `fields` does not say which entry.**
`:186–187`. On the design question: first-bad-wins is *right* — the solve is joint ("fall together"), so printing the good floors with the bad one named would misstate the solve, and refusing the whole boundary is the honest arm. But `fields` names only the first bad entry's fields with no index or asset, so the unreadable arm cannot say what was unreadable. Fix: union across all bad entries, prefixed — `prices[1].price_decimals`.

**9. `pricesChip` — an out-of-enum verdict lands on `"crit"` by accident.**
`:232, 238`. `@solvent/client`'s `refine` does not validate `PriceInput.verdict`; an unexpected string gives `VERDICT_RANK[…] === undefined`, `Math.max` → `NaN`, and the tone is `"crit"` only because both `=== 0` and `=== 1` fail. Correct outcome, fragile mechanism. Fix: `VERDICT_RANK[i.verdict] ?? 2`.

**10. Two formatters for one pair.** `:76` (`headroomPercent`, its own inline formatter) vs `:79` (`formatTenths`). They agree today; `roomPercent: roomTenths === null ? null : formatTenths(roomTenths)` makes R15's "printed complement" hold by construction rather than by coincidence. Nit.

**11. Dedup and empty symbols.** `:198` — `held_assets` is not deduplicated (`[ETHFI, ETHFI]` → `"with ETHFI and ETHFI flat"`); `:92` — a leg with `symbol: ""` yields an empty subject (`"" ?? x` is `""`). Both need an inconsistent wire. Nit; `symbol || truncateAddress(asset)` and `new Set(held)` cover them.

### Not defects, noted for later tasks

- `collateralTable:121–123` — `isCollateralLeg` admits a leg carrying only `amount`; one such leg nulls `sumValue`/`sumContribution` and both welds (`sum` returns null if any leg is null). That is the honest answer (no agreement claim past an unreadable leg), and the DM fixture's legs carry all three fields, so it is not a defect — but Task 10 should read a null weld as "unknown", never as drift.
- Two legs sharing an asset in different case: both rows are kept, both find the same price input (`priceInputFor` lowercases), sums include both, `symbolFor` returns the first. Correct — the wire's legs are the wire's legs.
- `symbolFor` for an asset that is neither a leg nor a price input → `truncateAddress` → `"0x5A7f…CBFF"`. Honest. (Price inputs carry no symbol, so consulting legs only is right.)
- `pricesChip` with every `age_seconds` null → `"… · age unknown"`. Honest.
- `readCashPosition` has no `engine === CASH` guard; callers must filter (Task 9's brief does). Fine as designed.
- The `near()` fixture's `held_assets: [WEETH, ETHFI]` beside `factor_assets: [WEETH]` is inconsistent with the solver (held is disjoint from factor by construction, `liqprice.go:264–271`); harmless because the module subtracts, and it usefully pins "never print the factor asset flat".

---

## Verdicts

- **SPEC: ✅** — every interface and all nine tests met with evidence; the one deviation is behaviourally identical; the file set is exactly the three promised.
- **QUALITY: needs-fixes** — finding 1 is a degenerate headline sentence reachable on a consistent wire (stable-collateral-only Cash accounts); finding 2 is the same sentence half-printing a partial joint solve where the brief's own law says refuse. Both are a few lines plus pins. Findings 3–11 are hardening and can ride along or follow.

---

# Re-review (099b0b6)

Scope per the coordinator: the eleven fixes against the rulings, the new/changed pins by arithmetic, whether `contradictory` can fire for a liquidatable verdict, and regressions. Nothing else re-opened.

Inputs: `git show 099b0b6` (two files: `web/lib/inspector-position.ts` +96/−22 net, `web/tests/unit/inspector-position.spec.ts` +69; the helper untouched), the report's "Fix round 1" section, the final `boundaryOf` (`:198–266`) and `readCashPosition` (`:57–94`) bodies via Serena, `find_referencing_symbols` on `Boundary` and `boundaryOf`, and language-server diagnostics on both files.

Verification I ran:

- `npx playwright test --project=unit tests/unit/inspector-position.spec.ts` — `10 passed (2.3s)`.
- Whole unit project. The bare run fails to *load* because `tests/unit/activity-rows.spec.ts` imports a `lib/activity-rows` that does not exist yet; both files are `??` untracked (Task 7 in progress) and neither is in 099b0b6. Excluding that one spec: `1097 passed (5.3s)`, which includes Task 6's landed Trust checklist (a `readCashPosition`/`isComputedCash` consumer) and the untracked `address-stress.spec.ts`. No regression attributable to this commit.
- `git diff 099b0b6 HEAD -- <both files>` — empty (HEAD is 099b0b6).
- Diagnostics (severity ≤ warning) on `web/lib/inspector-position.ts` and the spec: none.
- `find_referencing_symbols` on `Boundary` and `boundaryOf`: referenced only inside the module and its spec. No landed consumer switches on the union, so the sixth arm breaks nothing today; Tasks 9/10 must handle `contradictory` (the implementer flagged this).

## The eleven, against the rulings

| # | Ruling | Code | Verdict |
|---|---|---|---|
| 1 | Empty `factor_assets` → axis phrasing via `AXIS_LABEL` | `:181–187` map (`eth_usd`, `weeth_eth_rate`, `stable_usd`, `asset_usd`, `borrow_apy` — the wire's `Shock.axis` enum, `schema.ts:1131`; `?? lp.axis` for anything else); `:204–213` subject `on the … axis` when `factorSymbols.length === 0`, else the original `of <symbols>` | ✅ |
| 2 | Partial joint solve → `unreadable` naming `prices[i].lowest_healthy_price`; held = held − factor − floored, deduped | `:229–242`: floors and `missing` collected per index; `floors.length === 0` → `absent` first (p0-8 kept), then `missing.length > 0` → `unreadable`. `:244–253`: `excluded` = factor ∪ floored (lowercased), `seen` dedupes, original casing kept for `symbolFor` | ✅ |
| 3 | Band 0 + not-liquidatable → "near" | `:56` `NEAR_BANDS = {0,1,2,3}`; status chain `:73–80` unchanged — verdict first, band only chooses near/healthy | ✅ |
| 4 | Negative `borrowings`/`max_borrow_lt` → not computed | `:64` `computed` requires `debt >= 0n && cap >= 0n`; `"-0"` is `0n` and still computes | ✅ |
| 5 | Documented only | `:66–69` comment: both a wire refusal and an unreadable computed row read `status: "refused"`; only the former carries `refusal`; key on `computed`/`refusal` | ✅ |
| 6 | `!computed` → `absent` | `:199`, the first line of `boundaryOf`, ahead of the liquidatable check (order immaterial: a non-computed cash is never `"liquidatable"`) | ✅ |
| 7 | Rise or `already_breached` under a not-liquidatable verdict → new `{ kind: "contradictory"; detail }`, checked before `prices` is read | `Boundary` `:176–177` new arm; `:214–222` `already_breached` then `num > den`, both before `served`; `already_breached` with `prices: []` therefore reads `contradictory` — the accepted order | ✅ |
| 8 | `fields` union across every bad entry, `prices[i].` prefixed; the one pin changed | `:226–228` `malformed` flatMaps every `!c.ok` entry's fields with its index; spec `:154` now `toContain("prices[0].price_decimals")` — same defect, same entry, indexed | ✅ |
| 9 | `VERDICT_RANK[…] ?? 2` | `:286` | ✅ |
| 10 | Both percents from `roomTenths` | `:88` `roomPercent: formatTenths(roomTenths)`, `:90` `usedPercent: formatTenths(1000n − roomTenths)`; `headroomPercent` import dropped; the three existing percent pins are byte-identical because `formatTenths` and `headroomPercent` share the format and the U+2212 `MINUS` | ✅ |
| 11 | Held dedupe; `symbol \|\|` fallback | dedupe at `:246–253`; `leg?.symbol \|\| truncateAddress(asset)` at `:104` and `leg.symbol \|\| truncateAddress(leg.asset)` at `:146` | ✅ |

## Can `contradictory` fire for a LIQUIDATABLE verdict? No.

`cash.status === "liquidatable"` holds exactly when `computed && liquidation_verdict === "liquidatable"` (`:73–74`). `boundaryOf` returns `absent` at `:199` for every non-computed cash regardless of verdict, and `breached` at `:200` for every computed liquidatable one. Past `:200` the status is `near`, `healthy` or `unknowable`, so the verdict is `not-liquidatable` or `unknowable`; the two `contradictory` returns at `:215–222` are unreachable for a liquidatable verdict. The existing `liq` pin (spec `:134–135`, verdict liquidatable + `never_liquidatable: true`) still reads `breached`, and the new `rise`/`breached` pins leave the verdict `not-liquidatable`.

One wording note inside #7, non-blocking and not one of the eleven: both `detail` strings say "while the verdict is not liquidatable". For a computed row whose verdict is `unknowable` (status `"unknowable"`, which also reaches these lines) that phrase is inexact — "unknowable" is not "not liquidatable". On the documented wire `Position.liquidatable` is a boolean for every computed Debt Manager row (null only on Aave, `schema.ts:1086–1087`), so a Cash reading cannot land there; if Task 9 ever routes an Aave-shaped position through `boundaryOf`, `detail` could read `while the verdict is ${cash.verdict}`. Recording it, not requesting it.

## The new and changed pins, by arithmetic (spec `:154`, `:175–239`)

1. `:154` `unscaled` — `noScale` at index 0 lacks `price_decimals` → `isWireScale(undefined)` false → `"prices[0].price_decimals"` ✅.
2. `:180–186` `noFactor` — `never_liquidatable` returns before the null scale factors or empty `prices` are read; `factor_assets: []` → `AXIS_LABEL.eth_usd` → `"No downward move on the ETH/USD axis alone reaches the boundary."` ✅ byte-identical to the ruling.
3. `:188–197` `partial` — computed, not-liquidatable; `already_breached` false; 4,009,500,000 < 4,200,000,000 so no rise; both entries classify ok (ETHFI: string asset, `"1250000"` decimal, scale 6, two nullable nulls); floors = [weETH], `missing = ["prices[1].lowest_healthy_price"]`; `floors.length === 1 ≠ 0` so the p0-8 `absent` does not fire; `missing.length > 0` → `unreadable` containing that field ✅.
4. `:199–207` `twoBad` — `[null, noScale]` → `classifyFactorPrice(null)` → `["entry"]` → `"prices[0].entry"`; `noScale` → `"prices[1].price_decimals"` ✅ both present.
5. `:209–210` `rise` — `already_breached` false; 4,400,000,000 > 4,200,000,000 → `contradictory` ✅.
6. `:211–212` `breached` — `already_breached: true` → `contradictory` before the scale factors are read ✅.
7. `:214–215` `refused` — `status: "refused"` fails `computed` → `absent` at `:199` even with the fixture's solve intact ✅.
8. `:217–220` `over` — debt 5,400,000,000 > cap 5,012,500,000, verdict `not-liquidatable`: `headroomBand` → den > num → 0 ∈ `NEAR_BANDS` → `"near"`; `floorDiv(−387,500,000,000, 5,012,500,000)`: truncated quotient −77, non-zero remainder with negative numerator → −78 → `formatTenths(−78)` = `"−7.8%"` (U+2212); used 1000 − (−78) = 1078 → `"107.8%"` ✅.
9. `:222` `"-1"` — passes `/^-?[0-9]+$/`, `BigInt("-1") = −1n`, fails `debt >= 0n` → `computed: false` ✅.
10. `:224–226` `"weird"` — `VERDICT_RANK["weird"]` undefined → `?? 2` → `Math.max` 2 → `"crit"` ✅.
11. `:228–232` `dup` — held `[WEETH, ETHFI, ETHFI]`, `excluded = {weeth}` (factor and floored), `seen` drops the second ETHFI → `" — with ETHFI flat"`; the full sentence contains `ETHFI` once, so `split("ETHFI").length === 2` ✅.
12. `:234–239` `blank` — `symbol: ""` → `"" || truncateAddress(WEETH)`; `WEETH` is 42 chars → `"0x5A7f" + "…" + "CBFF"` = `"0x5A7f…CBFF"` ✅.

Existing pins re-traced under the new order: `liq` → `breached` at `:200` before `never_liquidatable`; `never` (`factor_assets: [WEETH]`) → `"No downward move of weETH alone …"` unchanged; `nullEntry` → past the two contradiction checks (`already_breached` false, num < den) → `["prices[0].entry"]` → `unreadable`; `noFloor` → floors 0 → `absent` (p0-8) ahead of the `missing` check; `nullPrices` → `absent`; `zeroCap` → `cap >= 0n` holds, band 0, but the verdict is liquidatable so status stays `"liquidatable"`; `equal` → band 1 → `"near"`. All ten tests pass.

## Verdict

**RE-REVIEW: all-addressed.** Each of the eleven matches its ruling; the twelve new/changed assertions hold by hand arithmetic; `contradictory` is unreachable for a liquidatable verdict; the unit project (minus another task's untracked, module-less spec) is 1097 passed with no regression from this commit. The one wording note under #7 is recorded above and is not a request.
