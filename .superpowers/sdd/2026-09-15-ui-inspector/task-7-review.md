# Task 7 review: `address-stress` and `activity-rows`

Reviewed: commit `9418851` only (the review package also carries `099b0b6`, the inspector-position fix round, which was reviewed separately and is ignored here). The four files are unchanged between `9418851` and `HEAD` (`git log 9418851..HEAD -- <four paths>` is empty), so line numbers below are both the commit's and the working tree's.

Test run (from `web/`): `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts` -> `11 passed (2.2s)`.

Verdicts: **SPEC ✅** · **QUALITY needs-fixes** (0 Critical, 4 Important, several Minor).

---

## A. Spec compliance

### Interfaces (brief lines 11-24)

| Brief | Implementation | |
|---|---|---|
| `StressSide { debt, cap, room: bigint\|null; verdict: "liquidatable"\|"not-liquidatable"\|"unknowable" }` | `address-stress.ts:13-18`; `verdict` typed `State["liquidation_verdict"]`, which resolves to `LiquidationVerdict` (`refine.ts:65`), the same three literals | ✅ |
| `StressHorizon { seconds; extraInterest; verdict }` | `address-stress.ts:20-24` | ✅ |
| `StressRow { id, label, applicable, reason, before, after, flips, projection }` | `address-stress.ts:26-36` | ✅ |
| `StressReading` three-arm union | `address-stress.ts:38` | ✅ |
| `stressReading(lookup: StressLookup, account: string)` | `address-stress.ts:67` | ✅ |
| `ACTION_LABEL: Record<EventDisplayType, string>` | `activity-rows.ts:11-20`; all eight `EventDisplayType` members (`schema.ts:1923`) present | ✅ |
| `actionLabel(type: string): string` | `activity-rows.ts:22-24` | ✅ |
| `ActivityRow { key, when, timed, action, asset, amount, amountTitle, tx{hash,short,url}, detail }` | `activity-rows.ts:26-36` | ✅ |
| `activityRows(events: readonly ChainEvent[])` | `activity-rows.ts:53` | ✅ |
| `activityTakeaway(timed, untimed, hasMore)` moved verbatim | `activity-rows.ts:76-93`: body is character-identical to `inspector-lines.ts:16-33` (diffed). The doc comment is NOT verbatim — see Minor 11 | ✅ (body) |

Consumes exactly the brief's imports (`StressLookup`, `CASH`, `plainCause`, `isWireDecimal`, `feedAmount`, `renderBlockTime`, `truncateAddress`, `humanAmount`, `txExplorerUrl`, `ChainEvent`, `EventDisplayType`). `formatBlock` is listed in the brief but reached through `renderBlockTime` (`format.ts:96-99`), which is what the brief's own template does. `web/lib/**` existing files untouched; `lib/inspector-lines.ts` stays.

### Global constraints

- **Three-valued found**: `stressReading` branches on `lookup.outcome` only (`address-stress.ts:68,71,72`); `unknowable` -> `{kind:"withheld", cause}` built from `plainCause(code, detail)` (`:69`), never "no-position"; `not-found` -> `no-position`. No `found` field is read anywhere (the sealed union has none). ✅
- **Another account or engine never read**: `row()` matches `r.engine === CASH && r.account.toLowerCase() === account.toLowerCase()` (`:50`). ✅ (see Important 1 for what the fallback says when nothing matches.)
- **Engine's boolean decides**: `flips` uses only `before.verdict` / `after.verdict` (the refined `liquidation_verdict`), returns `null` when either side is missing or `unknowable` (`:56-59`); never `false` for an unknowable side. ✅ `room` is derived but the verdict is the wire's own. ✅
- **Bigint only / `isWireDecimal`**: `wireInt` (`:40`) and `tokenAmount` (`activity-rows.ts:38-39`) gate every `BigInt()` through `isWireDecimal`; no `Number()` on a wire decimal anywhere. ✅ U+2212: `humanAmount` (the only formatter this task invokes on a bigint) emits `MINUS` (`human-price.ts:46`). The `feedAmount` raw path passes the wire string verbatim (ASCII `-`), which is the feed's vocabulary and out of this task's files (see Observation 14).
- **Activity**: `when: renderBlockTime(block_number, block_time)` -> `"block 154,796,490"` for a null time, never a clock (`activity-rows.ts:58`); `timed: block_time !== null` (`:59`); amounts via `feedAmount` (`:55`); `activityTakeaway` body verbatim. ✅

### Test cases (11)

**address-stress.spec.ts (4)**

1. `rows: one per scenario, before/after room…` — ids in scenario order (`:72` maps `scenarios`); `rate.before = {4200000000n, 3200000000n, −1000000000n, "liquidatable"}` (`:44-46`, fixture `debt_usd "4200000000"`, `max_borrow_lt "3200000000"`, `liquidatable: true` refined); `after.room −1000000000n`; `flips false` (both liquidatable, `:59`); projection `[[2592000, 6904109n, "liquidatable"], [7776000, 20712328n, "liquidatable"]]` (`:63`, `becomes_liquidatable: true` refined via `refineProjectionHorizon`); depeg `projection null` (`:61-62`). ✅
2. `no result for this account…` — `find` fails for `0x…01`, row is `{applicable:false, reason:"not evaluated for this account", before:null, after:null}` (`:51-52`). ✅
3. `withheld… / definitive negative…` — `stress-unknowable.json` (`found:null, lookup_complete:false`, one refusal) -> `lookup().outcome === "unknowable"` -> `withheld` with `plainCause("FLAG_CUSTODY_UNPROVEN", detail)`; non-empty by `plainCause`'s contract (`refusal-phrasebook.ts:13-18`, never returns empty). `{found:false, scenarios:[]}` passes the completeness law -> `not-found` -> `no-position`. ✅
4. `flip / unknowable side` — `before.liquidatable:false, after:true` -> `not-liquidatable` -> `liquidatable` -> `flips true`; `after.liquidatable:null` -> `unknowable` -> `flips null`, `after.verdict "unknowable"`. ✅ (The report's note about the `unknown` variable spreading the original `result` is correct and harmless — the pin asserts exactly that.)

**activity-rows.spec.ts (7)**

5. `rows: custodied time / null block_time…` — length 2; `timed` true/false; `when` contains `"154,796,490"`; actions `Liquidation`/`Borrow`; asset `USDC`; explorer URLs by `chain_id` 1/10 (`inspector-data.ts:142-151`); `tx.short` = first 10 + `…`. ✅
6. `liquidation extract` — `humanAmount(2500000000n, 6)` -> `2,500`; `humanAmount(656250000000000000n, 18)` -> `0.6562`; `truncateAddress(0xBBbB…0002)`; string matches pin exactly (`activity-rows.ts:50`). ✅
7. `feed vocabulary / record-only` — DM borrow row `amount` non-empty (`"1199403000 USDC"`), `amountTitle` non-null (`unitTitle`); `{amount:null, amount_unit:"none"}` -> `feedAmount` `record-only` -> `"—"` (`:62`). ✅ (Passes; what it passes WITH is Important 2.)
8. `action labels` — `Collateral enabled`, `Deficit created`, `flash_thing` verbatim (`:23`). ✅
9-11. `r74 — activityTakeaway` describe block — three tests, copied verbatim from `tests/unit/inspector-lines.spec.ts:61-93` (header comment included). The brief's own instruction (line 147) says the existing pins are the contract when they differ; they did (`(3,0,true)`, `(4,2,false)`, `(0,2,false)` vs the brief's `(0,2,true)`, `(4,1,false)`), so 11 tests instead of 9 is the brief-sanctioned outcome. ✅

### The implementer's deviation (`debt_asset` null guard)

`LiquidationDetail.debt_asset` is `Address | null` on the wire (`schema.ts:1970`); the brief's `truncateAddress(l.debt_asset)` cannot compile under `strict`. The guard at `activity-rows.ts:46` (`event.symbol ?? (l.debt_asset === null ? "—" : truncateAddress(l.debt_asset))`) is the same shape as the brief's own `asset` column fallback and is behaviourally right: the server sets `debt_asset` FROM the row's own asset (`hexAddrPtr(e.Asset)`, `cmd/api/p5_events.go:388`), so `event.symbol` is the debt asset's symbol by construction, and "—" appears only when the row carries neither symbol nor asset. **Accepted.** (One nuance in Minor 13.)

**SPEC: ✅**

---

## B. Code quality

Calibration: Critical = a wrong verdict, an invented number, or "no position" for an unknowable. None found on any path I could construct. Important = a reachable wire state that produces misleading or silenced output. Minor = drift-only edge cases, comments, hardening.

Findings 1-4 all originate in the brief's Step 3/4 templates, which the implementer followed faithfully (and flagged #2 in the report). The fix lands on the module; the brief should be amended alongside so the rendering task inherits the corrected contract.

### Important

**1. `address-stress.ts:50-52` — a withheld Cash engine under `outcome: "found"` is reported as "not evaluated for this account" on every row; the plain cause is never surfaced.**

Reachable state: the server sets `found: true` whenever ANY position exists (`cmd/api/handlers.go:890-902`: `positions > 0` -> `true` regardless of `withheld`), and emits scenario results only for positions it found (`handlers.go:1396-1398`). So an account with an Aave position while `debt_manager` is withheld (a whole-engine `FLAG_CUSTODY_UNPROVEN`) arrives as `{found:true, lookup_complete:false, withheld_engines:[{engine:"debt_manager", …}], scenarios:[{results:[<aave result only>]}]}`. `lookup()` returns `outcome:"found"`, `complete:false`. `stressReading` takes the rows arm (`:72`), `row()` finds no `CASH` result (`:50`), and every row reads `applicable:false, reason:"not evaluated for this account"`.

Failing input -> wrong output: `stressReading(lookup({...STRESS_DM, lookup_complete:false, withheld_engines:[{engine:"debt_manager", code:"FLAG_CUSTODY_UNPROVEN", detail:"…", note:"…"}], scenarios: STRESS_DM.scenarios.map(s => ({...s, results: []}))}), STRESS_DM.address)` -> `{kind:"rows", rows:[{reason:"not evaluated for this account", …}, …]}`. The honest reading is `withheld` with `plainCause("FLAG_CUSTODY_UNPROVEN", detail)`. "Not evaluated for this account" is a plausible-sounding false cause — the constraint's "unknowable is withheld with plain causes" is violated on this path even though `outcome` is not `unknowable`, because the module is Cash-scoped and the Cash engine specifically is the one withheld.

Fix (does not branch on `found`; reads the sealed union's `withheldEngines` inside the found arm):
```ts
export function stressReading(lookup: StressLookup, account: string): StressReading {
  if (lookup.outcome === "unknowable") { …as now… }
  if (lookup.outcome === "not-found") return { kind: "no-position" };
  const cash = lookup.withheldEngines.find((w) => w.engine === CASH);
  if (cash !== undefined) return { kind: "withheld", cause: plainCause(cash.code, cash.detail) };
  return { kind: "rows", rows: lookup.response.scenarios.map((s) => row(s, account)) };
}
```
Add a spec case pinning it. Note that when the Cash engine is NOT withheld and a scenario is simply not defined for it, the server DOES emit a DM result with `applicable:false, reason:"scenario X is not defined for engine debt_manager"` (`handlers.go:1412-1414`), which `row()` surfaces correctly via `result.reason ?? null` (`:64`) — so the "not evaluated for this account" fallback is only ever reached for a genuinely absent position, or for this withheld case.

**2. `activity-rows.ts:26-36, 55, 62-63` — a raw-units amount renders as `"1199403000 USDC"` with only a hover title; the row drops the feed's unit chip and `raw units` tag and passes no scale.**

`feedAmount(event)` with no `FeedAmountScale` on the fixture's DM borrow (`dm_normalized_debt`, `amount_decimals:null`) returns `{display:"1199403000", unitChip:"normalized debt", unitTitle:"…value_decimals are not known to this page yet…", symbol:"USDC", rawUnits:true}` (`feed-view.ts:166-184`). The row collapses that to `amount: "1199403000 USDC"` and `amountTitle: unitTitle`. The Feed page renders the same `FeedAmount` as `<b>display</b> <chip>normalized debt</chip> <chip>raw units</chip> <dim>USDC</dim>` (`FeedList.tsx:94-117`) and threads each engine's `value_decimals` FROM THE WIRE (`FeedSurface.tsx:74-87` from the posture snapshot; `FeedList.tsx:232` `decimalsFor(event.engine)`). "1199403000 USDC" in a table cell reads as 1.2 billion USDC; the repo's own law for exactly this cell is "an unscaled integer NEVER renders bare — the reader must be able to tell 'no scale was licensed' from 'the scale is 1'" (`FeedList.tsx:104-106`, Wave R1 item 4). A `title` attribute is not a visible tag.

The honest fix is BOTH halves the coordinator named, because neither alone closes it:

(a) Surface the vocabulary on the row so the renderer can print it: add `readonly unitChip: string | null` and `readonly rawUnits: boolean` to `ActivityRow` (and keep `symbol` separable rather than concatenated into `amount`, so the renderer can dim it after the chip as the Feed does). The renderer prints `RAW_UNITS_TAG` (`feed-view.ts:83`) visibly when `rawUnits` is true. This is required regardless of (b): `aave_scaled` rows with null decimals are ALWAYS raw (`feed-view.ts:150-165` refuses the engine's decimals for them by design), so the fixture's Aave liquidation row (`"-2499100000 USDC"`) stays raw even after (b).

(b) Give `activityRows` a scale: `activityRows(events, valueDecimals: Readonly<Record<string, number>> = {})` mirroring `FeedList`, calling `feedAmount(event, { engineValueDecimals: valueDecimals[event.engine] ?? null })`. The Cash engine's `value_decimals` must come from the wire — the inspector already holds `position.value_decimals` per engine off the address lookup (`inspector-position.ts:63`), and the DM position's value is the right source for `debt_manager` rows; never a hardcoded 6. When the account has no DM position (so no wire-stated scale), the DM rows stay raw and tagged — honest. `feedAmount` already applies `engineValueDecimals` only to `dm_normalized_debt` (`feed-view.ts:172`), so passing it per engine cannot mis-scale an Aave row.

With (b) the fixture's DM borrow becomes `1,199.403` + chip `normalized debt` (via `scaled()` -> `renderNullableDecimal` -> `groupDecimalString`). The spec's `rows[1]?.amount.length > 0` pin should become a pin on `rawUnits`/`unitChip` and, given a scale, on the placed display.

**3. `activity-rows.ts:47-50` — an empty `seized` list is silent: the extract reads as a complete liquidation with nothing to say about collateral.**

`seized === "" ? "" : …` drops the clause, so the detail is `"liquidator 0x… repaid 2,500 USDC"`. The Feed prints `seized — (no seizure legs carried)` for the same input (`FeedList.tsx:148-150`) AND forces the disclosure fold OPEN because an empty seizure list is an unestablished field (`FeedList.tsx:181-188`, "an em dash never hides behind a closed fold"). Reachable: the Aave extract appends a seizure only when `len(d.CollateralAsset) > 0` (`cmd/api/p5_events.go:437`), and the DM extract skips every zero-amount tuple element (`p5_events.go:407-409`), so `seized: []` is a served state.

Failing input -> wrong output: `{...first, liquidation: {...first.liquidation, seized: []}}` -> `detail: "liquidator 0xBBbB…0002 repaid 2,500 USDC"`.

Fix: `const seizedClause = l.seized.length === 0 ? "; seized — (no seizure legs carried)" : `; seized ${seized}``. Pin it.

**4. `activity-rows.ts:38-39, 44, 50` — a carried `debt_repaid` with `debt_decimals: null` prints `repaid —`, rendering an established figure as absent.**

`tokenAmount` returns `null` when `decimals` is null even though `value` is a valid wire decimal, and the caller prints `"—"` — the glyph the repo reserves for "not established" (`format.ts:19`). The wire distinguishes the two: `debt_repaid` is a fact, `debt_decimals` is its scale, and the server nulls the scale when the token registry lacks the asset (`cmd/api/p5_events.go:431-435`, Aave branch: `DebtDecimals` set only when `s.registry.Spec(...)` succeeds). The Feed prints the raw integer unscaled in that case (`renderNullableDecimal(debt_repaid, { decimals: undefined })`, `FeedList.tsx:131-137`) and reserves the em dash for `debt_repaid === null`.

Failing input -> wrong output: `{...first, liquidation: {...first.liquidation, debt_decimals: null}}` -> `"liquidator 0xBBbB…0002 repaid — USDC; seized 0.6562 weETH"` while the wire said `debt_repaid: "2500000000"`.

Fix: when `isWireDecimal(l.debt_repaid) && l.debt_decimals === null`, print the raw integer with the raw marker (e.g. `` `${l.debt_repaid} ${RAW_UNITS_TAG}` ``), and keep `"—"` only for `debt_repaid === null`. Same rule for `seized[].amount` when `decimals` fails the scale guard (Minor 10).

### Minor

**5. `address-stress.ts:50` — two Cash results for the same account: `find` silently takes the first.** A duplicated `(engine, account)` result is a contract violation that would be half-read rather than named (the inspector-position round's rule: "contradictions are named"). Fix: `filter`; if `length > 1`, return `{applicable:false, reason:"contradictory results for this account", before:null, after:null, flips:null, projection:null}`.

**6. `address-stress.ts:56-59` — `flips` is computed even when `applicable` is false and both sides are present.** Unreachable from today's server (every inapplicable path leaves `After` nil: `handlers.go:1429-1466`), and the reason-bearing-but-applicable case (shortfall refusal, `handlers.go:1473` leaves `Applicable` true) is surfaced correctly through `reason`. As a belt: `flips: result.applicable ? … : null`, so a non-applicable row never asserts a flip the engine did not make.

**7. `address-stress.ts:60-63` — `projection` maps empty `horizons` to `[]`, and the projection's `basis: "delta-only"` and `note` are dropped.** `[]` vs `null` is distinguishable only by length; more importantly the wire's `Projection.note` ("DELTA-ONLY… the base accrual is absent. No time-to-liquidatable is published…") is the disclaimer that makes the horizon numbers honest, and `StressRow` has no field for it — nor for `market_realization` (the depeg scenario's actual output; its row shows `before === after`, `flips:false`, and nothing else). This is the brief's interface, not the implementer's choice; flagging for the rendering task's brief.

**8. `address-stress.ts:69` — the `unknowable` cause joins every withheld engine, including Aave, for a Cash-only reading.** Acceptable (the whole lookup is unknowable), but `${w.engine}: ${plainCause(…)}` would tell the reader which engine.

**9. `activity-rows.ts:64` — `tx.short` appends `…` unconditionally.** A hash of ≤ 10 chars (malformed wire; `TxHash` is a 32-byte hex on the contract, `schema.ts:1671`) prints `"0xabc…"`, implying truncation that did not happen. `truncateAddress` guards this (`format.ts:103`). Fix: `hash.length > 10 ? `${hash.slice(0, 10)}…` : hash`.

**10. `activity-rows.ts:38-39` — `tokenAmount` does not guard `decimals` through `isWireScale`.** `SeizedCollateral.decimals` is a bare `number` on the wire (`schema.ts:1951`); a negative or > 1000 value makes `10n ** BigInt(decimals)` throw a `RangeError` inside `humanAmount` (`human-price.ts:48`), taking the whole activity section down. The repo's guard exists for exactly this (`wireGuard.ts:46-54`, "negative decimals are not positions" in the inspector-position round). Fix: `isWireScale(decimals) ? humanAmount(…) : null` (and then Important 4's raw fallback).

**11. `activity-rows.ts:70-75` — `activityTakeaway`'s doc comment is not verbatim.** The moved comment drops the closing sentence of `inspector-lines.ts:21-22`: "An untimed row read as 'older' is a wrong answer; this sentence refuses to license that reading." The function BODY (`:76-93`) is character-identical to `inspector-lines.ts:16-33`, so the report's "character-for-character" claim holds for the code; the brief's own Step 4 template is what omitted the sentence. Carry the full comment when Task 12 retires the old copy.

**12. `activity-rows.ts:22-24, 60` — `raw_type` is not surfaced.** Driving the label from `type` (the closed `EventDisplayType`) rather than `raw_type` (the engine's verbatim word, e.g. `aave_liquidation_call`, `schema.ts:2019-2020`) is correct — `type` is the display classification and `raw_type` would print engine jargon. But `raw_type` is the only thing that distinguishes rows the display type folds together; consider `actionTitle: event.raw_type` for the hover. Observation.

**13. `activity-rows.ts:46, 50` — DM liquidation rows label a USD-6 value with a token symbol.** For `debt_manager`, `debt_repaid` is "the Debt Manager's own USD-6 quantity … a value, not a token amount" with `debt_decimals = engineValueDecimals[DM]` (`cmd/api/p5_events.go:390-394`); the row prints it as `repaid 2,500 USDC`. The symbol comes from the row's asset, which IS the debt asset (`p5_events.go:388`), so it is not wrong, but the Feed deliberately shows the address rather than asserting a token. Low stakes; note for the renderer.

**14. Observation (not against this task): the raw `display` path carries ASCII `-`.** `feedAmount` returns `event.amount` verbatim for raw units, and `formatUnits` emits ASCII `-` for scaled negatives (`packages/client-ts/src/decimal.ts:187`), so a negative amount in the activity cell is not U+2212. That is the feed's own vocabulary in files this task does not touch; the module's own formatter (`humanAmount`) uses U+2212. Recorded so the rendering task does not mistake it for a Task 7 regression.

### Probes the coordinator asked for, answered

- **Two Cash results for the account** -> first wins silently (Minor 5).
- **`before` present, `after` null with a reason** -> `flips: null` (`:57`, `after === null`), `reason` surfaced via `result.reason ?? null` (`:64`), `applicable` from the wire. Correct.
- **`applicable: false`, both sides present** -> sides and `flips` are computed; unreachable from the server today (Minor 6).
- **`side()` on `debt_usd: "-0"`** -> `isWireDecimal("-0")` true (`^-?[0-9]+$`), `BigInt("-0") === 0n`, `room = cap`. Legal and correct. **Malformed** (`"1.5"`, `""`, `"0x10"`) -> `null`, `room: null`; the verdict still comes from the refined field. Correct. (Absent-on-the-wire and malformed both collapse to `null`; acceptable at this layer.)
- **`projection` with empty `horizons`** -> `[]`, not `null` (Minor 7).
- **`activityRows` raw units** -> Important 2, with the precise fix.
- **`liquidationDetail` with empty `seized`** -> clause dropped silently (Important 3). **`debt_decimals: null`** -> `repaid —` for a carried figure (Important 4).
- **`tx.short` on a short hash** -> spurious ellipsis (Minor 9).
- **`actionLabel`: `type` vs `raw_type`** -> `type` is right (Minor 12).
- **`activityTakeaway` verbatim** -> body identical; docstring lost one sentence (Minor 11).

---

**QUALITY: needs-fixes** — Importants 1-4 are each a reachable wire state rendered as a false cause, a token-looking raw integer, a silenced unestablished field, or an established figure shown as absent. All four are inherited from the brief's templates and are small, local changes with obvious spec pins.

---

# Re-review (20f077b)

Scope: the fix round only (`git show 20f077b`: the same four files; nothing touches them after it — `git log 20f077b..HEAD -- <four paths>` is empty). Line numbers are the commit's and the working tree's.

Run (from `web/`): `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts` -> `13 passed (2.2s)` (the 11 original pins unchanged, one new test per spec). `npx tsc --noEmit -p tsconfig.json` -> exit 0.

**RE-REVIEW: all-addressed.** One advisory (non-blocking, Minor) on the judgment call, below.

## Rulings vs code

| # | Ruling | Code | |
|---|---|---|---|
| 1 | Withheld Cash under `found:true` -> `withheld` with the plain cause | `address-stress.ts:104-111`: order is `unknowable` (`:105`) -> `not-found` (`:106`) -> `withheldEngines.some(w => w.engine === CASH)` -> `withheld` (`:110`) -> rows. No `found` field is read; the sealed union's `withheldEngines` is. Cause names every withheld engine (accepted). | ✅ |
| 2 | `activityRows(events, { valueDecimalsByEngine })`; `ActivityRow` gains `unitChip`, `rawUnits`, `actionTitle` | `activity-rows.ts:46-48` (`ActivityScale`), `:81-83` (`feedAmount(event, { engineValueDecimals: scale?.valueDecimalsByEngine?.[event.engine] ?? null })`), `:33/:38/:40` fields, `:89` `actionTitle: event.raw_type`, `:93-94` `unitChip`/`rawUnits` straight from `FeedAmount` (null/false on record-only). No decimals hardcoded. | ✅ |
| 3 | Empty `seized` stated | `:71-75`: `l.seized.length === 0 ? "— (no seizure legs carried)" : …`, always joined with `; seized `. The Feed's exact words (`FeedList.tsx:150`). | ✅ |
| 4 | Unscaled `debt_repaid` -> raw integer + " (raw units)"; "—" only for null; every `decimals` through `isWireScale` | `:50` `RAW`, `:57-61` `payloadAmount`: `null` -> "—"; `!isWireDecimal(value) \|\| !isWireScale(decimals)` -> `${value} (raw units)`; else `humanAmount`. Used for `debt_repaid` (`:66`) and each seized leg (`:74`). No `10n ** BigInt(decimals)` is reachable with an unguarded scale. | ✅ |
| 5 | Two Cash results -> contradictory non-applicable row | `:67-70`: `filter` + `[result, ...rest]`; `rest.length > 0` -> `inapplicable(scenario, "two results for this account — contradictory")` with every side/derived field null (`:62-64`). | ✅ |
| 6 | `flips` only when applicable | `:73-76`: `!result.applicable \|\| …` -> null. | ✅ |
| 7 | `projectionNote`, `marketRealization` carried; empty horizons -> `projection: null` | `:77-81` (`horizons.length === 0 ? null : …`), `:94` `projectionNote: result.projection?.note ?? null` (carried with empty horizons — accepted), `:82-84` `marketRealization` from `execution_shortfall_usd` / `bad_debt_at_liquidation_usd` (each via `wireInt`, i.e. `isWireDecimal`) / `usd_decimals`; field names match `schema.ts` `Shortfall`. `decimals` unguarded — accepted, ledgered for Task 11. | ✅ |
| 8 | Causes name their engine | `:99-102` `withheldCause`: `${engineName(w.engine)} — ${plainCause(w.code, w.detail)}` joined by `; `; `engineName("debt_manager") === "Cash"` (`inspector-headline.ts:44-48`). | ✅ |
| 9 | `tx.short` ellipsis only when truncated | `:78-79` `shortHash`: `hash.length > 10 ? … : hash`. | ✅ |
| 11 | Doc comment verbatim | `:101-107` + body `:108-125` diffed against `inspector-lines.ts:9-33`: byte-identical (7 comment lines + 18 body lines). | ✅ |
| 13 | DM repaid suffixed `USD` | `:69` `event.engine === CASH ? "USD" : (event.symbol ?? …)`; the `debt_asset` null guard retained for other engines. | ✅ |

(#10 — `isWireScale` gating — is subsumed by #4; #12 — `raw_type` surfaced — by #2's `actionTitle`.)

## New pins, by arithmetic

`address-stress.spec.ts:64-122`
- `cashWithheld`: `{...STRESS_DM, lookup_complete:false, withheld_engines:[{engine:"debt_manager", code:"SWEEP_NEVER", detail:"", note:""}]}` passes `lookup()`'s completeness law (`!complete && withheld.length === 1`), `found:true` -> `outcome:"found"`; `:110` fires; cause = `"Cash — " + plainCause("SWEEP_NEVER", "")` = `"Cash — collateral sweep never ran"` (`refusal-phrasebook.ts:5`, known code wins over the empty detail). `toContain` ✅.
- `[result, result]` -> `rest.length === 1` -> the contradictory row; `toMatchObject` on `{applicable:false, reason, before:null, after:null, flips:null}` ✅.
- `applicable:false` with `before.liquidatable:false`, `after.liquidatable:true`: sides present (`side()` runs on both), `flips` null by the `!result.applicable` clause — the shape would otherwise be `true`, so the pin is discriminating ✅.
- `horizons: []` -> `projection: null`; `projectionNote === result.projection.note` ✅.
- `market_realization {execution_shortfall_usd:"1200000", bad_debt_at_liquidation_usd:"0", usd_decimals:6}` -> `{shortfall:1200000n, badDebt:0n, decimals:6}` ✅.

`activity-rows.spec.ts:34-57`
- `{ debt_manager: 6 }`: `feedAmount` DM arm takes `amount_decimals ?? engineValueDecimals` = 6 -> `scaled("1199403000", 6)` -> `formatUnits` -> digits `1199403000`, cut 4 -> `1199.403000` -> trim -> `1199.403` -> `groupDecimalString` -> `1,199.403`; `amount = "1,199.403 USDC"` matches `/^1,199\.403/`; `rawUnits:false` ✅. Without a scale: `rawUnits:true`, `unitChip:"normalized debt"` ✅.
- `seized: []` -> detail ends `; seized — (no seizure legs carried)` ✅ (`$`-anchored).
- `debt_decimals:null` -> `payloadAmount("2500000000", null)` -> `isWireScale(null)` false -> `"2500000000 (raw units)"` -> `"repaid 2500000000 (raw units) USDC; …"` contains the pin ✅.
- `debt_repaid:null` -> `"repaid — USDC; …"` contains `"repaid —"` ✅.
- `engine:"debt_manager"` -> `"liquidator 0xBBbB…0002 repaid 2,500 USD; seized 0.6562 weETH"` contains `"repaid 2,500 USD; seized"` and no `USDC` anywhere (the seized leg is weETH) ✅ — the pin is made precise enough not to be satisfied by the Aave row's `USDC`.
- `tx_hash:"0xabc"` -> `shortHash` returns it unchanged ✅. `actionTitle === raw_type` on both fixture rows ✅.

## Regressions checked

- The 11 original pins are textually unchanged and pass. The Aave detail pin (`…; seized 0.6562 weETH`) is unaffected by #3 because its seized list was already non-empty.
- Test 2's "not evaluated for this account" now means exactly that: it is reachable only when the Cash engine is NOT withheld (the `:110` arm returns first otherwise) and no Cash result exists — the false-cause path is closed.
- `inapplicable()` rows carry `projectionNote:null` and `marketRealization:null`; `row()` with `projection:null` yields `horizons=[]` -> `projection:null`, `projectionNote:null`. No path yields `projection:[]`.
- `payloadAmount` returns a string on every path; no throw is reachable from a wire `decimals` value (`isWireScale` rejects negatives, `-0`, non-integers and `> 1000`).
- `activity-rows.ts` imports `CASH` from `./inspector-position` and `isWireScale` from `./wireGuard` — both existing exports; no `web/lib/**` file outside the four was touched.

## Judgment call: malformed decimal -> raw bytes + "(raw units)"

Under the never-a-number law as the repo states it (`wireGuard.ts:8-14`: `BigInt("")` -> `0n`, `BigInt("0x10")` -> `16n` — never launder malformed bytes into a MEASURED number), printing the bytes verbatim is compliant: no number is manufactured, nothing is coerced, nothing throws. Where it falls short is the label. "(raw units)" is the tag the feed defines as "the wire's raw INTEGER, rendered because no scale was licensed" (`feed-view.ts:44-49`, `FeedList.tsx:104-106`); attached to `"1.5"`, `"abc"` or `""` it asserts an integer that is not there, and the empty string renders as a bare ` (raw units)`. The repo's precedent for a malformed wire scalar is the word, not the bytes: `formatBlock` -> `"unreadable"` (`format.ts:85`), `freshness.ts:628` likewise; `parseDecimal` refuses outright (`decimal.ts:50-58`).

Recommendation (Minor, advisory, non-blocking — drift-only: the server emits these through `bigStr`/`orZeroString`, so a malformed decimal cannot come from this server): split the two cases in `payloadAmount` —

```ts
if (value === null) return "—";
if (!isWireDecimal(value)) return "unreadable";           // malformed bytes: the word, never the bytes with a units label
if (!isWireScale(decimals)) return `${value} ${RAW}`;     // a real wire integer whose scale is unlicensed or malformed
return humanAmount(BigInt(value), decimals);
```

with `"—"` still reserved for null. If the coordinator prefers the bytes to remain visible, put them in a title on the row rather than in the sentence. Either way this does not reopen #4: the reachable case (valid integer, null or bad scale) is correct as landed.

**RE-REVIEW: all-addressed** (one Minor advisory above).
