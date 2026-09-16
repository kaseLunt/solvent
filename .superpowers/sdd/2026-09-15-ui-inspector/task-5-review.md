# Task 5 review — `room-history`: room % per batch from `/history`, and the near-cap streak

**Commit under review:** `58b5017` (package `review-92aa73b..58b5017.diff`)
**Files:** `web/lib/room-history.ts` (new, 118 lines), `web/tests/unit/room-history.spec.ts` (new, 84 lines). Nothing else in the diff; `git show --stat 58b5017` confirms 2 files, 202 insertions. Existing `web/lib/**` untouched.
**Independent verification run by the reviewer (read-only):**
- `npx playwright test --project=unit tests/unit/room-history.spec.ts` → `4 passed (7.7s)`
- `npx eslint lib/room-history.ts tests/unit/room-history.spec.ts` → no output, exit 0
- `npx tsc --noEmit -p tsconfig.json` → no output

Line references below are to `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\room-history.ts` unless another file is named.

---

## A. SPEC COMPLIANCE — ✅

### Interface (brief lines 11-19)

| Brief | Code | |
|---|---|---|
| `RoomPointKind = "computed" \| "refused" \| "withheld" \| "no-row" \| "unpublished"` | :15 | ✅ |
| `RoomPoint { batchId, computedAt, roomTenths, value, kind, title, display }` all `readonly` | :17-25 | ✅ |
| `RoomSeries { points, values, titles, newest, computedCount }` | :27-33 | ✅ |
| `Streak { batches, spanSeconds }` | :35-38 | ✅ |
| `NEAR_LINE_TENTHS: bigint` = 100n, derived from `WARN_HEADROOM_PCT` | :41 `BigInt(WARN_HEADROOM_PCT) * 10n`; `headroom.ts:49` `WARN_HEADROOM_PCT = 10` | ✅ derived, not a literal |
| `roomSeries(engine, knownBatchIds?: readonly number[])` | :79 | ✅ |
| `nearCapStreak(series)` | :103 | ✅ |
| Imports exactly the named helpers (`formatBlock`, `headroomTenths`/`WARN_HEADROOM_PCT`, `AddressHistoryEngine`/`AddressHistoryPoint`, `formatTenths`, `plainCause`, `readWirePopulation`/`wireBigInt`) | :8-13 | ✅ |

### The four test cases (spec `web/tests/unit/room-history.spec.ts`)

1. **Series ordering / display / values / newest / title** (spec :30-38). `headroomTenths` is `floorDiv(1000n·(num−den), num)` (`headroom.ts:154-156`). Debt 4 822 000 000: cap 6.0e9 → 196 → `19.6%`; 5.5e9 → 123 → `12.3%`; 5.0125e9 → 38 → `3.8%`. Sort ascending at :92; `newest` = last at :97; `computedCount` 3 at :98; title `batch 12 · room 3.8% of cap @ block 155,323,012` from :76 + `formatBlock` (`toLocaleString("en-US")`). ✅ (passes)
2. **Five gap kinds as titled nulls** (spec :40-66). refused → :55-57 (`plainCause("SWEEP_FAILED")` = "collateral sweep failed", contains "sweep failed"); `health_factor: null` → :60 `unpublished`; `"4.62e9"` fails `WIRE_DECIMAL = /^-?[0-9]+$/` (`wireGuard.ts:22`) → `wireBigInt` null → :73 `unpublished`; withheld `[2]` → :87 title contains "withheld" and "never"; `knownBatchIds [0]` → :90 `no-row`. Every gap has `value: null`, `roomTenths: null` (:43-51). `computedCount` 1. ✅ (passes)
3. **No-debt point is room 100 %** (spec :68-73). :70 `if (hf.infinite) return computed(1000n, …)` → `formatTenths(1000n)` = `100%`, `value` 100, `kind: "computed"`. ✅ (passes)
4. **Near-cap streak** (spec :75-84). `NEAR_LINE_TENTHS` 100n. Walk from newest (:106-111): 38, 72, 90 under; 196 ≥ 100 breaks → 3; span = `Date.parse("…20:04:00Z") − Date.parse("…20:02:00Z")` = 120 s (:113-116). Broken series: batch 3 `unpublished` breaks → 1, span null (`count >= 2` guard). Single 19.6 % → 0/null. Empty → 0/null. ✅ (passes)

### Global constraints

- **R4.** `headroomTenths(num, den)` per point (:74), num = cap / den = debt as the Go `DMHealth.HealthFactor` documents (`internal/risk/types.go:774`, `dm.go:171-177` `NewRational(maxBorrowLT, borrowings)`). Refused / withheld / no-row / unreadable → `gap(...)` with `roomTenths: null, value: null` and a title (:43-51, :57, :60, :73, :75, :87, :90). Infinite → 1000n, a value (:70). ✅
- **Floats are geometry only.** The only float is `value: Number(tenths) / 10` (:65) — `Number()` of a bigint that came out of exact arithmetic; `display` is `formatTenths(tenths)` (:68). No `Number()`/`parseFloat` touches a wire decimal. ✅
- **Wire guards.** `batch_id` → `readWirePopulation` (:54); `withheld_batch_ids[]` → `readWirePopulation` (:86); `hf.num`/`hf.den` → `wireBigInt` (:71-72). `balances_block` (:76) goes to `formatBlock`, which guards internally with `isWirePopulation` → `"unreadable"` (`format.ts:83-86`) rather than through `readWirePopulation` — the render is still honest, but see Minor finding 3. ✅ (with one letter-of-the-law note)
- **Refusal prose only from `plainCause`.** :57. The withheld/no-row/unpublished titles are the module's own gap prose, not refusal-code prose — allowed. ✅
- **Commit / process.** Message is the brief's Step 5 text verbatim; two files; scope gate reported OK per the report. ✅

**Verdict A: ✅ SPEC COMPLIANT.**

---

## B. CODE QUALITY — needs-fixes (1 Important, 9 Minor)

### Probe answers (the parent's specific questions)

| Probe | Behaviour | Judgement |
|---|---|---|
| `hf.infinite === true` with a nonzero `den` string | :70 runs before :71-72 — `infinite` wins, 1000n, `den` ignored | Correct. The engine sets `Num`/`Den` nil when `Infinite` (`types.go:281-286`), so the wire is `num: null, den: null`; a finite den alongside `infinite: true` is out of contract and the engine's flag is the authority. Same ordering as `history-series.ts:105,154`. |
| `num === "0"`, `den > 0` (cap zero, debt positive) | `headroomTenths(0n, den)` → null (`num <= 0n`) → :75 `gap(..., "unpublished", "cap not positive for this point", "—")` | **Wrong word — see Important 1.** This is a shape the engine actually emits (`dm.go:88-92` names it: "the debt-only-after-empty-sweep shape"); `NewRational(0, borrowings)` is valid (only `den > 0` is required, `types.go:289-297`). The cap WAS published — as zero — and the point is a known breach. |
| `den === "0"` without `infinite` | `headroomTenths(num, 0n)` = `floorDiv(1000n·num, num)` = 1000n → `100%`, computed | Arithmetically the same figure the infinite arm gives; consistent. The engine never emits it (`NewRational` refuses `den <= 0`). Not a bug. |
| `num`/`den` = `"-0"` | `WIRE_DECIMAL` accepts; `BigInt("-0")` is `0n` (BigInt has no −0) → behaves exactly as `"0"` | Fine. |
| withheld id that also has a point | :87 `if (!byBatch.has(batchId))` — the point wins | Correct (a persisted row is more than a book-level withholding). |
| `knownBatchIds` contains a non-integer / NaN / −0 | Not guarded (:89-90) — `1.5` becomes `batch 1.5 · no row…`; `NaN` is a valid Map key and poisons the numeric sort comparator | Minor 4. Task 9 pre-guards; Task 10 passes `engine.withheld_batch_ids`, which :86 has already guarded. Still, a one-line guard makes the module self-sufficient. |
| two points share a `batch_id` | :81-84 `byBatch.set` — later in wire order wins silently | Minor 5. Out of contract (one persisted row per batch, `schema.ts:1819`); the module's own posture for out-of-contract input is the `readWirePopulation` throw, not silence. |
| newest point is a gap | Loop breaks at once (:108) → `{batches: 0, spanSeconds: null}` | Not looking past the gap is RIGHT — counting through a withheld batch would draw across a gap. But `Streak` cannot say "unestablishable at the newest batch", so it collapses to the same zero as "newest is above the line" — Minor 7. |
| exactly one point under the line | `count >= 2` guard (:114) → `spanSeconds: null` | Correct — one stamp has no span. |
| unparseable `computedAt` | `Date.parse` → NaN → `Math.floor(NaN)` → NaN → `Number.isNaN(span)` (:117) → null | Guard present. |
| non-fixed cadence | Span is `newest.computedAt − oldest.computedAt` wall-clock | Fine. Note that it spans the streak's stamps only (3 batches at 1-min cadence → 120 s, not 180 s); Task 6 prints it as "(≈2m)" — an understatement by one cadence, acceptable and documented by the test. |
| `NEAR_LINE_TENTHS` | :41 `BigInt(WARN_HEADROOM_PCT) * 10n` | Derived. And :108 uses `>=`, so exactly 10.0 % is NOT under the line — matches the left-closed band rule in `headroom.ts:57-60`. |

### Findings

#### Important

**1. `room-history.ts:74-75` — a zero cap with positive debt is labelled `unpublished`, though the cap was published (as zero) and the point is a known breach.**
- Failing input: a computed DM point `{ health_factor: { num: "0", den: "4822000000", infinite: false }, liquidatable: true }` — the engine's own debt-only-after-empty-sweep shape (`internal/risk/dm.go:88-92`, `dm.go:171-177`).
- Wrong output: `kind: "unpublished"`, title `batch N · cap not positive for this point`, display `—`, and the point breaks `nearCapStreak` (`:108` requires `kind === "computed"`).
- Why it matters: the Book's own `headroomBand(0n, debt)` returns `HEADROOM_BREACHED_BAND` for this shape (`headroom.ts:204`), i.e. the codebase already knows it as a breach; here a KNOWN thing is rendered as an UNKNOWN (the mirror of the forbidden "unknowable looks like a zero"). A gap is the only honest geometry (room as a share of a zero cap has no value), so the geometry is right; the machine-readable `kind` and the hover are what mislead.
- Fix (bounded): before :75, branch `num === 0n && den > 0n` → a gap whose title names what is known — e.g. `cap is zero at this point — room as a share of cap has no value; debt exceeds the cap (liquidatable)` — with display `0 cap` (or `breached`), and carry `point.liquidatable` into the title so a hover tells the truth. Ideally a sixth kind (`"zero-cap"` / `"breached"`) so downstream legends never bucket it with "no cap published"; that is a plan-level enum change, so the parent should rule. Keep `"cap not positive"` only for a NEGATIVE `num` (never emitted; a legal wire decimal). Add a spec case pinning the shape.

#### Minor

**2. `room-history.ts:75` — a negative `den` is reported as "cap not positive".**
- Input: `{ num: "5012500000", den: "-1", infinite: false }` (never emitted — `NewRational` requires `den > 0` — but a legal `WIRE_DECIMAL`).
- Output: title `cap not positive for this point` although the cap is positive; the debt is what is malformed.
- Fix: branch on `num <= 0n` vs `den < 0n` and say which component was refused (`debt not readable as a nonnegative amount`).

**3. `room-history.ts:76` — `balances_block` is the one wire population in the module that does not pass `readWirePopulation`.**
- Input: a point with `balances_block: -0` or `1.5` (out of contract).
- Output: `formatBlock` soft-guards (`format.ts:84`) → hover reads `… @ block unreadable`; every other population in the module throws `WireIntegerError` (:54, :86). Precedent in `history-series.ts:127` guards `sweep_block` with `readWirePopulation` BEFORE `formatBlock`.
- Fix: `formatBlock(readWirePopulation(point.balances_block, "balances_block"))`. Render stays honest either way; this is uniformity with the stated constraint.

**4. `room-history.ts:89-90` — `knownBatchIds` is not guarded.**
- Input: `roomSeries(engine, [1.5, NaN])`.
- Output: a `batch 1.5 · no row…` point; `NaN` is a valid `Map` key and makes `(a, b) => a.batchId - b.batchId` return NaN, so the sort order is unspecified.
- Fix: `const batchId = readWirePopulation(id, "knownBatchIds[]")` inside the loop. Task 9 pre-guards and Task 10's ids are already in the map from :86, so nothing downstream changes today.

**5. `room-history.ts:81-84` — duplicate `batch_id` in `engine.points` wins silently.**
- Input: two points with `batch_id: 7`, one `refused`, one `computed`.
- Output: whichever comes later in wire order replaces the other; no trace that the wire contradicted itself.
- Fix: `if (byBatch.has(entry.batchId)) throw new WireIntegerError(...)` (the module's established out-of-contract arm), or a titled `conflicting rows for this batch` gap. Silence is the one option the codebase's law rules out.

**6. `room-history.ts:70` — the no-debt title omits the block the computed title carries.**
- Input: any infinite point.
- Output: `batch N · no debt · room is the whole cap` vs `batch N · room 3.8% of cap @ block 155,323,012` for its neighbours.
- Fix: append `@ block ${formatBlock(...)}` in the infinite arm so every computed hover has the same shape.

**7. `room-history.ts:103-118` — `Streak` cannot distinguish "0 because the newest point is above the line" from "0 because the newest batch is withheld / refused / has no row".**
- Input: a series whose newest point is `withheld` after 13 computed points under the line.
- Output: `{ batches: 0, spanSeconds: null }` — identical to a healthy account. Task 6 prints the streak sentence only when `batches >= 2` (`task-6-brief.md:213-216`), so today the consequence is a silently missing sentence rather than a rendered zero; the headline's near-cap claim itself still comes from the position. The loop's refusal to look past the gap is correct.
- Fix (plan-level, optional): add `readonly newestKind: RoomPointKind | null` (or `established: boolean`) to `Streak` so a consumer can say "the newest batch is withheld; the streak cannot be read" instead of nothing.

**8. `room-history.ts:113-117` — a negative span passes the NaN guard.**
- Input: stamps not monotonic in batch id (clock skew; out of contract).
- Output: a negative `spanSeconds`, which Task 6 would hand to `humanAge`.
- Fix: `span < 0 ? null : span`.

**9. `room-history.spec.ts:69` — test 3's infinite fixture is not the wire's shape.**
- The engine emits `num: null, den: null` when `infinite` (`types.go:281-286` → `bigStr(nil)` → null, `cmd/api/handlers.go:1810-1816`); the fixture sends `den: "0"`. The code passes for both shapes (infinite is checked first), but the pin does not prove the arm against what the wire actually sends.
- Fix: add a second assertion with `{ wad: null, num: null, den: null, infinite: true }`.

**10. `room-history.ts:87` — "Cash book withheld" hard-codes the engine name while `engine.engine` is at hand.**
- Fine while the module is Cash-only by design (header comment, :2); it would be a false statement if a legacy engine were ever passed. Informational.

### Also confirmed (no finding)

- Negative room (debt > cap) prints with U+2212 via `formatTenths` and plots below zero; it counts as "under the line" in the streak. That is the brief's definition ("under the 10 % line") — but Task 6's sentence "within 10% of its cap" would then cover batches when the account was OVER its cap. Wording belongs to Task 6; noting it here because the definition lives at :108.
- `series.newest` used for the span (:112) is correct: `count >= 1` implies the newest point is the streak's first member.
- `refusal` null on a `refused` row → `plainCause("unnamed", undefined)` → `refused (unnamed)` (:56-57). Honest.

**Verdict B: needs-fixes** — one Important (finding 1, bounded to one branch plus a spec case, with the kind-enum question left to the plan), nine Minor.

---

## Re-review (846e4fd)

**Commit:** `846e4fd` — `fix(web): room history review round - a zero cap is a point past the cap, not a missing cap; every batch and block is guarded; the streak knows the newest point's kind`. Two files (`web/lib/room-history.ts` +54/−12, `web/tests/unit/room-history.spec.ts` +44), worktree identical to HEAD for both.
**Reviewer's own runs (read-only):** `npx playwright test --project=unit tests/unit/room-history.spec.ts` → `5 passed (2.4s)`; `npx eslint` on both files → exit 0; `npx tsc --noEmit -p tsconfig.json` → 0 `error TS` lines (Task 6's `16d5710` has since added `newestKind` to its literals, so the coordinator's accepted TS2741 failure no longer exists).

Line references are to `web/lib/room-history.ts` at `846e4fd`.

### Rulings, one by one

| # | Ruling | Code | Pin | |
|---|---|---|---|---|
| 1 | Published zero cap with debt → new kind `zero-cap`, no geometry, `display: "0 cap"`, title names the verdict, counts in the streak | :24 adds `"zero-cap"`; :90-94 `num === 0n` → `gap(…, "zero-cap", "zero cap · debt with no counted collateral — past the cap @ block …", "0 cap")` — `roomTenths: null`, `value: null` via `gap` (:54-62); `underLine` :131 returns true for `zero-cap` | spec :88-97: kind, display, `value` null, title contains "past the cap", `computedCount` 0; `[19.6 %, zero-cap, 3.8 %]` → `{ batches: 2, spanSeconds: 60, newestKind: "computed" }` (batch 3 stamp 20:03 − batch 2 stamp 20:02 = 60 s; batch 1 at 196 tenths breaks) | ✅ |
| — | `zero-cap` must NOT be producible for an unreadable `num` | :85-87 `wireBigInt` → `null` → `unpublished` "the ratio behind this point is not readable" returns BEFORE :90; `hf.num === null` takes the same arm. `"-0"` reads as `0n` (BigInt has no −0) and is a legal spelling of zero, so it correctly lands in `zero-cap` | spec :47 (`"4.62e9"` → `unpublished`) still holds | ✅ |
| 2 | Negative `den` / `num` → distinct named gaps | :88 `den < 0n` → "negative debt on the wire"; :89 `num < 0n` → "negative cap on the wire"; both `unpublished`; the old "cap not positive" arm (:97) is now unreachable and commented as such | spec :99-101 pins negative `den` only | ✅ (see open 2) |
| 3 | `balances_block` through `readWirePopulation` | :73 `atBlock()` = `formatBlock(readWirePopulation(point.balances_block, "balances_block"))`, used by the infinite (:84), zero-cap (:93) and computed (:98) titles — the arms that print it | test 1's title `… @ block 155,323,012` (spec :37) still holds | ✅ |
| 4 | Caller-supplied `knownBatchIds` through `readWirePopulation` | :115-116 `readWirePopulation(id, "knownBatchIds[]")` | spec :108 `[1.5 as never]` → throws | ✅ |
| 5 | Duplicate `batch_id` throws `WireIntegerError` | :106-108; `WireIntegerError` is a class export (`wireGuard.ts:202`). A withheld id colliding with a point still lets the point win (:113), as before | spec :107 two points at batch 7 → throws | ✅ |
| 6 | No-debt title carries `@ block …` | :84 `no debt · room is the whole cap${atBlock()}` | not pinned (see open 2) | ✅ |
| 7 | `Streak.newestKind: RoomPointKind \| null`, required | :44-49 required field; :154 `newest?.kind ?? null` | spec :79-83 (`"computed"` ×3, `null` for empty), :97, :116, :119 (`"withheld"` for a trailing withheld batch) | ✅ |
| 8 | Negative span → null | :153 `span < 0 ? null` alongside the NaN guard | spec :110-116: batch 1 (90 tenths) stamped 20:05, batch 2 (38 tenths) stamped 20:01 → count 2, raw span −240 → `null` | ✅ |
| 9 | The wire's infinite shape pinned | :83-84 flag read before the ratio | spec :103-105 `num: null, den: null, infinite: true` → `computed`, `100%` | ✅ |
| 10 | Informational, no change | :113 unchanged | — | ✅ |

### `nearCapStreak` stops at every non-counted kind

`underLine` (:130-133) is true only for `zero-cap`, or `computed` with `roomTenths < NEAR_LINE_TENTHS`. `refused`, `withheld`, `no-row`, `unpublished` → false → `break` (:141). `computed` at or above 100 tenths → false → break (10.0 % exactly is still NOT under the line, matching `headroom.ts`'s left-closed rule). Pinned by spec :80-83 (`unpublished` breaks; 19.6 % newest → 0) and :118-119 (trailing `withheld` → 0, `newestKind: "withheld"`). ✅

### Regressions

None found. The four original pins pass unchanged in substance (only `newestKind` added to the streak literals); `computedCount` still counts `computed` only, so a `zero-cap` point is a gap in the count as well as on the line (spec :94). The `zero-cap` gap keeps `computedAt: point.computed_at`, so a streak that begins or ends on one still gets a span.

### Still open (both Minor, neither blocks)

1. **Minor · `room-history.ts:90-94` + `:131`** — the `num === 0n && den === 0n` sub-arm ("no cap and no debt", reachable only with `infinite: false`, which the engine never sends for zero debt — `dm.go:171-177` makes zero borrowings `Infinite`) is a `zero-cap` point, and `underLine` counts every `zero-cap` as under the near-cap line. Input `{ num: "0", den: "0", infinite: false }` → a no-debt point counts toward "within 10 % of its cap for the last N batches". The Book's `headroomBand` calls 0/0 "undefined, never a band" (`headroom.ts:205`). Fix: make the `den === 0n` sub-case an `unpublished` gap ("0/0 — undefined; the wire said no debt without saying infinite") so `zero-cap` means exactly "published zero cap with debt left" and `underLine` needs no change.
2. **Minor · `room-history.spec.ts`** — two of the fixes have no pin: the negative-`num` arm (`:89`, "negative cap on the wire") and the no-debt title's `@ block …` (`:84`). One assertion each.

**Verdict: all rulings addressed; two Minor follow-ups, nothing blocking.**
