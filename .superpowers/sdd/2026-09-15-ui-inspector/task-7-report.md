# Task 7 report: `address-stress` and `activity-rows`

Commit: `9418851b30f2619608902cdd809bcd1b370426b0` on `main`
Message: `feat(web): stress rows and activity rows for one account - the wire's own sides and units, untimed rows disclaimed`
Files (exactly four, pathspec-limited): `web/lib/address-stress.ts`, `web/lib/activity-rows.ts`, `web/tests/unit/address-stress.spec.ts`, `web/tests/unit/activity-rows.spec.ts`

## What I did, in the brief's order

1. Read the brief, then the real code the brief consumes: `plainCause(code, detail?)`, `isWireDecimal`, `renderBlockTime` / `truncateAddress` / `formatBlock`, `feedAmount` + `FeedAmount`, `humanAmount`, `txExplorerUrl`, `CASH`, the `Lookup` union and `lookup()` in `packages/client-ts/src/lookup.ts`, the refined stress shapes in `refine.ts`, and the generated wire schemas (`Scenario`, `ScenarioResult`, `StressState`, `Projection`, `ProjectionHorizon`, `ChainEvent`, `LiquidationDetail`, `SeizedCollateral`, `EventAmountUnit`, `EventDisplayType`).
2. Wrote both specs first. Ran them: both failed with `Cannot find module ... lib/address-stress` / `lib/activity-rows` (Step 2 as expected).
3. Wrote the two modules.
4. Ran the specs, typecheck, lint.
5. Staged the four files by name, ran `python roadmap/tools/scope_gate.py` (`scope-gate: OK -- integrator claude-integrator; 4 path(s)`), committed. The pre-commit hook re-ran the control-plane doctor (`OK -- 0 error(s), 0 warning(s), 5 info`) and the gate (OK).

## Verification output

Test command (from `web/`): `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts`

Exact result line:

```
  11 passed (840ms)
```

`npm run typecheck` exit 0 (its `pretypecheck` step rebuilt `@solvent/client`). `npm run lint` exit 0.

## Hand-checked arithmetic (fixture -> helper -> expectation)

- `rate.before`: `debt_usd "4200000000"`, `max_borrow_lt "3200000000"`; room = 3200000000 - 4200000000 = -1000000000; `liquidatable: true` refines to `"liquidatable"`. Matches the pin.
- Projection: horizons `2592000` / `additional_interest_usd "6904109"` / `becomes_liquidatable true`, and `7776000` / `"20712328"` / `true`. Matches.
- `humanAmount(2500000000n, 6)`: units 2500 -> `"2,500"`, fraction `"0000"` trims to empty -> `"2,500"`. `humanAmount(656250000000000000n, 18)`: units 0, fraction `"6562..."`.slice(0,4) -> `"0.6562"`. Liquidator `0xBBbB0000...0002` -> `0xBBbB…0002`. Detail string matches the pin exactly.
- `renderBlockTime(154796490, null)` -> `"block 154,796,490"`; `toContain("154,796,490")` holds.
- `lookup({ ...STRESS_DM, found: false, scenarios: [] })`: `lookup_complete: true`, `withheld_engines: []`, `found: false` -> passes both consistency laws -> `outcome: "not-found"` -> `no-position`.
- `stress-unknowable.json`: `found: null`, `lookup_complete: false`, one withheld engine -> `outcome: "unknowable"` -> `withheld` with `plainCause("FLAG_CUSTODY_UNPROVEN", detail)`; non-empty either via the phrasebook or the detail fallback.

No expectation was changed.

## Deviations from the brief, and why

1. **`activityTakeaway` pins copied verbatim from `tests/unit/inspector-lines.spec.ts`** (the brief's own instruction: "the existing pins are the contract"). The existing pins are a `test.describe("r74 — activityTakeaway", ...)` block of three tests covering `(3,0,false)`, `(3,0,true)`, `(4,2,false)`, `(0,2,false)`, which differs from the brief's single test with `(3,0,false)`, `(0,2,true)`, `(4,1,false)`. I substituted the describe block (with its header comment) in place of the brief's test. Consequence: **11 tests, not the brief's 9** (7 in `activity-rows.spec.ts`, 4 in `address-stress.spec.ts`). Every case passes, so the function is identical in behaviour to the retiring one; the function body itself was moved character-for-character.
2. **`liquidationDetail` null-guards `debt_asset`.** The wire's `LiquidationDetail.debt_asset` is `Address | null` (generated `schema.ts:1970`), so the brief's `truncateAddress(l.debt_asset)` does not compile under `strict`. Written as `event.symbol ?? (l.debt_asset === null ? "—" : truncateAddress(l.debt_asset))` — same shape as the brief's own `asset` column fallback. No test impact (the fixture carries a symbol).
3. Nothing else changed. `lib/inspector-lines.ts` and its spec are untouched (so `activityTakeaway` exists in two places until Task 12 removes the old one, as the plan intends). `.superpowers/sdd/.gitignore` untouched.

## Concerns for review

- **Raw-units amounts in the `amount` cell.** For the fixture's Debt Manager borrow (`amount_unit: dm_normalized_debt`, `amount_decimals: null`, no engine scale passed), `feedAmount` returns the RAW integer with `rawUnits: true`, and the brief's template renders it as `"1199403000 USDC"`. The Feed page renders a visible `raw units` tag in that case; here the only signal is the hover `amountTitle`. `ActivityRow` does not carry `rawUnits`, and `activityRows` does not take a `FeedAmountScale`. The tests pin only "non-empty" for this cell, so I followed the brief as written; the rendering task may want either a `rawUnits` field on `ActivityRow` or a scale parameter threaded from the engine's `value_decimals`.
- The `unknown` case in the fourth stress test spreads the ORIGINAL `result` (before = liquidatable) with `after.liquidatable = null`; the flip is null because `after` is unknowable, not because `before` was changed. That is what the pin asserts (`after?.verdict === "unknowable"`), so it is fine, but the variable name `unknown` building on `flipped` while discarding `flipped`'s scenarios could mislead a reader. Left verbatim per the brief.
- Git printed the repo's usual `LF will be replaced by CRLF` autocrlf warnings for the four new files; content committed as LF like the rest of `web/`.

---

# Fix round 1

Commit: `20f077b3c2a60e2941eed4b54725555452d75c66` on `main` (on top of `9418851`)
Message: `fix(web): stress and activity review round - a withheld Cash book under found is withheld, raw units are named and scaled by the wire's own decimals, empty seizures and unscaled repayments are stated`
Files: the same four, pathspec-limited; `scope-gate: OK -- integrator claude-integrator; 4 path(s)`; pre-commit doctor `OK -- 0 error(s), 0 warning(s), 5 info`.

## Verification

Test command (from `web/`): `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts`

```
  13 passed (2.8s)
```

(11 existing pins unchanged and passing, plus one new `test(...)` block per spec.) `npm run typecheck` exit 0. `npm run lint` exit 0 with two `no-unused-vars` warnings in `web/tests/unit/inspector-view.spec.ts`, which is an untracked file belonging to another implementer's in-flight task — not one of the four files, not touched.

## The eleven changes, as landed

`web/lib/address-stress.ts`

1. Found arm: after the `unknowable` and `not-found` arms, `lookup.withheldEngines.some((w) => w.engine === CASH)` returns `{ kind: "withheld", cause }`. No `found` field is read; the sealed union's `withheldEngines` is.
2. `withheldCause(engines)` = `engines.map((w) => \`${engineName(w.engine)} — ${plainCause(w.code, w.detail)}\`).join("; ")`, used by both the `unknowable` arm and the found-withheld arm (`engineName` imported from `./inspector-headline`; `debt_manager` reads `Cash`).
3. `row()` now `filter`s the Cash results for the account and destructures `[result, ...rest]`: none → `inapplicable(scenario, "not evaluated for this account")`; more than one → `inapplicable(scenario, "two results for this account — contradictory")`, both sides null, `flips`/`projection`/`projectionNote`/`marketRealization` null. Nothing is half-read.
4. `flips` is null unless `result.applicable` (in addition to the missing/unknowable-side rule).
5. `projection` is null when `horizons` is empty; `StressRow` gains `projectionNote: string | null` (the projection's `note`, carried whenever the wire carries a projection object, so the delta-only disclaimer survives even with no horizons) and `marketRealization: StressShortfall | null` where `StressShortfall = { shortfall: bigint | null; badDebt: bigint | null; decimals: number }` from `execution_shortfall_usd` / `bad_debt_at_liquidation_usd` (each through `wireInt`, i.e. `isWireDecimal`) / `usd_decimals`.

`web/lib/activity-rows.ts`

6. `activityRows(events, scale?: ActivityScale)` with `ActivityScale = { valueDecimalsByEngine?: Readonly<Record<string, number>> }`; calls `feedAmount(event, { engineValueDecimals: scale?.valueDecimalsByEngine?.[event.engine] ?? null })`. `ActivityRow` gains `unitChip: string | null` and `rawUnits: boolean` straight from `FeedAmount` (null / false for record-only). No decimals are hardcoded.
7. `payloadAmount(value, decimals)`: `null` value → `—`; a value failing `isWireDecimal` or a `decimals` failing `isWireScale` (imported from `./wireGuard`) → `\`${value} (raw units)\``; otherwise `humanAmount`. Used for `debt_repaid` and each seized leg. An empty `seized` prints `; seized — (no seizure legs carried)` (the Feed's words from `app/feed/FeedList.tsx:150`).
8. `debtUnit = event.engine === CASH ? "USD" : (event.symbol ?? …)` — the Debt Manager's repaid figure is its own USD unit; other engines keep the symbol (the fixture's Aave row is unchanged: `liquidator 0xBBbB…0002 repaid 2,500 USDC; seized 0.6562 weETH`).
9. `shortHash(hash)` appends `…` only when `hash.length > 10`.
10. `ActivityRow.actionTitle = event.raw_type`; the visible `action` stays from `type`.
11. `activityTakeaway`'s doc comment restored verbatim from `lib/inspector-lines.ts:10-16`, including the closing sentence ("An untimed row read as "older" is a wrong answer; this sentence refuses to license that reading."). Body unchanged (already identical).

## New pins

`address-stress.spec.ts` (one test): found + Cash withheld (`SWEEP_NEVER`) → `withheld` with cause containing `Cash — collateral sweep never ran`; `results: [result, result]` → `{ applicable: false, reason: "two results for this account — contradictory", before: null, after: null, flips: null }`; `applicable: false` with a flip-shaped before/after → both sides present, `flips: null`; `horizons: []` → `projection: null` and `projectionNote` equal to the wire's note; the coordinator's `market_realization` object → `{ shortfall: 1200000n, badDebt: 0n, decimals: 6 }`. Every constructed body is annotated `components["schemas"]["StressResponse"]` so the enum literal `seizure_model` gets contextual typing.

`activity-rows.spec.ts` (one test): with `{ valueDecimalsByEngine: { debt_manager: 6 } }` the DM row's `amount` matches `/^1,199\.403/` and `rawUnits` is false; without a scale `rawUnits` is true and `unitChip` non-null; `seized: []` → detail matches `/seized — \(no seizure legs carried\)$/`; `debt_decimals: null` → contains `repaid 2500000000 (raw units)`; `debt_repaid: null` → contains `repaid —`; `engine: "debt_manager"` → contains `repaid 2,500 USD; seized` and does NOT contain `USDC` (a bare `"repaid 2,500 USD"` pin would also match the Aave row's `USDC`, so the pin is made precise); `tx_hash: "0xabc"` → `short === "0xabc"`; `actionTitle === raw_type` for both fixture rows.

## Interpretation choices (flagging for the reviewer)

- Found-withheld cause names every withheld engine (the same `withheldCause` expression as the `unknowable` arm), as the instruction's shared `cause = withheld.map(...)` reads. If only the Cash engine's cause is wanted on that arm, it is a one-line filter.
- `projectionNote` is carried whenever the wire carries a projection object, including when `horizons` is empty (so `projection: null, projectionNote: "DELTA-ONLY…"` is a reachable row). Pinned that way.
- `marketRealization.decimals` passes `usd_decimals` through as the typed `number`, per the shape given; it is NOT gated through `isWireScale` here. A renderer that feeds it to `humanAmount` should gate it first (a negative or >1000 value would throw there), or this module should gate it and null the figures — say which.
- A `debt_repaid` / seized `amount` string that fails `isWireDecimal` (malformed wire) prints verbatim with ` (raw units)` rather than `—`, because the dash is now reserved for `null`. Not pinned (drift-only).
- `ActivityRow.amount` still concatenates `display` and `symbol` (`"1,199.403 USDC"`); the review's suggestion to keep `symbol` separable for the renderer was not in the fix list, so it is unchanged. The renderer can still print the chip and `raw units` tag from the new fields.
- Review observation 14 stands: the raw `display` path carries the wire's ASCII `-` (feed vocabulary, files outside this task); `payloadAmount` via `humanAmount` emits U+2212.

---

# Round 2

Commit: `0adacdf8c09be336a9340623676fa0c7a0e896a8` on `main` (on top of `20f077b`)
Message: `fix(web): activity rows round 2 - a malformed wire amount reads unreadable, never its bytes`
Files (two, pathspec-limited): `web/lib/activity-rows.ts`, `web/tests/unit/activity-rows.spec.ts`; `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; pre-commit doctor `OK -- 0 error(s), 0 warning(s), 5 info`.

## The change

`payloadAmount` in `web/lib/activity-rows.ts` now has three distinct arms, in this order:

1. `value === null` → `—` (not established);
2. `!isWireDecimal(value)` → `unreadable` (the repo's word for a malformed wire scalar — `format.ts:85`, `freshness.ts:628`; the bytes are never printed as a figure);
3. `!isWireScale(decimals)` (including `null`) → `${value} (raw units)`;
4. otherwise `humanAmount(BigInt(value), decimals)`.

Round 1 had arms 2 and 3 merged, so a malformed `debt_repaid` such as `"1.5"` would have printed `1.5 (raw units)` — its bytes dressed as a raw figure. The doc comment names the three statements.

## Pins (one assertion each, in the round-1 test block of `activity-rows.spec.ts`)

- `debt_repaid: "1.5"` → detail contains `repaid unreadable` (new);
- `debt_decimals: null` → detail contains `repaid 2500000000 (raw units)` (existing, unchanged);
- `debt_repaid: null` → detail contains `repaid —` (existing, unchanged).

## Verification

Test command (from `web/`): `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts`

```
  13 passed (2.5s)
```

(Same 13 tests; the new pin is an added assertion inside the round-1 block.) `npm run typecheck` exit 0.

`npm run lint` exit 1 — **all five errors are outside this task**: `react/no-unescaped-entities` in `web/app/inspector/[addr]/BackingTable.tsx`, `HistoryCard.tsx`, `InspectorDrawer.tsx`, `StressTable.tsx`, every one of them an UNTRACKED, never-committed file (`git status` shows `??`) belonging to the in-flight rendering task. Scoped `npx eslint` over the four Task 7 files exits 0. I did not touch those components (out of scope by instruction); the rendering task's implementer needs to escape the `'` characters (`&apos;` / `&rsquo;`) before their commit, or the repo-wide lint stays red.

## Concerns

- The repo-wide `npm run lint` is red because of another implementer's uncommitted `[addr]/*.tsx` components (above). My commit neither introduces nor fixes those; flagging so the coordinator can route it.
- The seized-leg path shares `payloadAmount`, so a malformed `seized[].amount` also reads `unreadable weETH` (and a bad `decimals` reads `<value> (raw units) weETH`). Consistent with the repaid arm; not separately pinned.
