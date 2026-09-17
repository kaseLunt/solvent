# Task 2 report: `lab-transitions` — the wire's lanes under guards, merged into room bands

**Status:** DONE_WITH_CONCERNS
**Commit:** `b8b7cd3469f2cd2bab4fdbd4cf1b058596c5fe60` — `feat(web): lab-transitions - the wire's ten lanes under guards, merged by exact summation into room bands for Cash, verbatim for the legacy market, contradictions named`
**Files (exactly the brief's three):**
- `web/lib/lab-transitions.ts` (new, 312 lines)
- `web/tests/unit/helpers/run-book-engine.ts` (new, 163 lines)
- `web/tests/unit/lab-transitions.spec.ts` (new, 119 lines; the pins verbatim from the brief, unchanged)

## What was done

1. Read the brief; loaded Serena and read the signatures of `isWireDecimal`, `isWirePopulation`, `isWireScale`, `wireBigInt` (`web/lib/wireGuard.ts`) and `groupInt` (`web/lib/prose.ts`); read the generated `@solvent/client` schema for `RunBookEngine`, `RunBookTransitions`, `RunBookTransitionLane`, `RunBookTransitionCell`, `RunBookTransitionOutflow`, `RunBookAggregate`, `RunBookHistogram`, `HistogramBucket`, `Decimal`, `NullableDecimal`.
2. Hand-verified every number in the demo-table pin from the helper table before running anything (from_rows `[41,8,14,13,73,153,300,804,0,6]`, total 1412, held 465, changed 941, crossedCap 118, bandChanged 425, nearToday/nearCrossed 27, maxRows 932). All agreed with the pins; no recount was needed.
3. Transcribed the helper and the pins; ran the pins → `Cannot find module '../../lib/lab-transitions'` (the brief's expected failure).
4. Transcribed the module; ran the pins, `tsc`, `eslint`. Two disagreements surfaced (one compiler, one pin), corrected in the code as listed below.
5. Green on all three; staged by name; `scope-gate: OK -- integrator claude-integrator; 3 path(s)`; committed by pathspec.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts
  7 passed (2.6s)
```

Also: `cd web && npm run typecheck` → exit 0 (no errors); `cd web && npm run lint` → exit 0 (no findings).

## Deviations from the brief, each with its reason

### D1 (compiler-forced) — helper `histogram()` omitted three required fields
`RunBookHistogram` requires `infinite_count`, `refused_count` and `note`; `tsc` refused the brief's literal. Added:
- `infinite_count: from_rows[INFINITE] ?? 0` and `refused_count: from_rows[UNMEASURED] ?? 0` — **summed from the table, not copied from the fixture.** The fixture's values are `0` and `1`; copying them would make `before.hf_histogram.refused_count` (1) contradict `from_rows[9]` (6 on the demo table), and the wire contract states `from_rows[N] == infinite_count` and `from_rows[N+1] == refused_count`. The helper's own header law ("every margin, histogram count and total is SUMMED from it so the fixtures cannot disagree with themselves") is the reason; these are derived exactly like each bucket's `count`.
- `note: "helper: every count is summed from the table"` — follows the brief's own convention for helper notes (`transitionsOf` sets `note: "helper: every margin is summed from the table"`, the engine sets `note: "helper"`) rather than copying the fixture's ~600-character engine-specific prose. No pin reads it. **The controller may prefer the fixture's string copied verbatim; say so and I will swap it.**

### D2 (compiler-forced) — a cell's debt is `NullableDecimal`, and the null is a law
`RunBookTransitionCell.debt_before_usd` / `debt_after_usd` are `string | null`; the brief's `wireBigInt(c.debt_before_usd)` takes a `string`, so `tsc` refused (two errors at the two calls). The wire says the null is real: "NULL, never "0", when this run measured none of this cell's rows, which today is exactly the (N+1, N+1) cell: a debt nobody computed and a debt of zero are different facts." The fixture `web/tests/fixtures/run-book.eth_minus_30.json` carries `debt_before_usd: null, debt_after_usd: null` on `outflows[9].cells[0]` for BOTH engines, and the older `web/app/lab/labTransition.ts` states the same at its line 19 ("A CELL'S NULL DEBT IS AN UNKNOWABLE").

Coercing null to `"0"` would render an unknowable as a zero; refusing null would make every real response contradictory. So the code's law is now:
- `cellDebt(value, unmeasuredCell)`: a null debt is accepted **only** on a cell whose from-lane and to-lane are both `unmeasured`, and is carried as `null`; a null anywhere else is a named contradiction (`outflows[i].cells[j].debt_before_usd is null, and only the not-measured cell carries a debt nobody computed`). A non-null string outside the Decimal contract keeps the brief's wording (the pin `outflows[2].cells[0].debt_before_usd` passes).
- `HeatCell.debtBefore` / `debtAfter` are `bigint | null` (doc comment on the interface states when). `addDebt` makes a merged sum `null` when any constituent is null. Given the guard, this can only ever be the not-measured band cell.
- **Consequence for the consumer tasks (Task 4+, the heatmap renderer):** a null debt must render as not computed, never as `$0`.

### D3 (pin-forced) — the helper threw before the module could refuse a fractional count
Pin 6 builds `transitionsOf({ 2: { 2: 1.5 } })` and expects a contradiction naming `rows`; the brief's helper threw `RangeError: The number 1.5 cannot be converted to a BigInt`. The helper now states the debt as `rows × unit` in bigint for an integer count and in float for a non-integer (deliberately malformed) count, with a comment naming the law. The module refuses the count (`from_rows[2] 1.5 is not a wire population`, and the same for `total_rows`, `measured_rows`) before any debt is read.

### D4 (not forced; wire-truth of the helper) — the helper's (9,9) cell now carries null debts
Because of D2, the module has a null-accepting path. The helper calls itself wire-true, and the wire and the fixture both carry null on the (N+1, N+1) cell, so `transitionsOf` now emits `debt_before_usd: null, debt_after_usd: null` for `table[9][9]`. This lets the demo-table pin (which has `9: { 9: 6 }`) exercise the null path with no pin change. **Flagged as the one non-forced code change; reverse it if unwanted** (one line).

### D5 — `groupInt` is not imported
The brief's "Consumes" line lists `lib/prose.ts (groupInt)`, but the module code the brief supplies never uses it; an unused import fails lint. Not imported.

### D6 — `transitionsOf` signature follows the code, not the Interfaces line
The Interfaces line says `transitionsOf(table, unitDebt?, opts?)`; the code and the pins use `transitionsOf(table, opts)` with `unitDebt` inside `opts`. Followed the code.

## Pins
No pin was changed. No pin arithmetic was provably wrong; nothing was recounted.

## Concerns for the controller

1. **Two guard layers over one wire field.** `web/app/lab/labTransition.ts` (`readTransitions`, `belowOneLanes`, `crossingCounts`, `transitionRibbons`, `movementCountText`) with its own spec `web/tests/unit/lab-transition.spec.ts` (singular) already guards `hf_transitions` for the existing Lab page. The new `web/lib/lab-transitions.ts` is a second vocabulary over the same field. Neither was touched; the plan's retirement ledger may want an entry when the old Lab page is retired or the two are consolidated.
2. **`HeatCell` debt type changed** from `bigint` to `bigint | null` (D2). Any consumer written from the brief's Interfaces line alone will need the null branch.
3. **`roomBoundLabel` floors to basis points** (integer bigint division), so 4.7619 → `4.76%`, 9.0909 → `9.09%`, 33.333 → `33.33%`. This is the brief's arithmetic and the pins pin it; on the seven contract edges floor and round never differ, so it is moot today, but a future edge like 1.2 (16.666…) would print `16.66%` rather than `16.67%`.
4. `git add` warned `LF will be replaced by CRLF` on the three files (the repo's autocrlf setting); no action taken.
5. The brief's Step 3 said the failing run reports `Cannot find module`; it did, and Playwright additionally reported `No tests found` because the spec could not load — expected, noted for the ledger.

## Fix round 1

**Commit:** `ef8477f44698ba0a5696da8785607f5e2194a4b9` — `fix(web): lab-transitions review round - a zero-row cell is refused as an occupancy, no false sum reason beside a refused cell, wad_scale and the histogram checked against the lanes, exact pins`
**Files:** `web/lib/lab-transitions.ts`, `web/tests/unit/lab-transitions.spec.ts` (the helper did not change). Built on HEAD `df3383b` (two commits landed after `b8b7cd3`). `scope-gate: OK -- integrator claude-integrator; 2 path(s)`.

**Test:** `cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts` → `8 passed (2.7s)`. `npm run typecheck` exit 0; `npm run lint` exit 0; Serena diagnostics on the module: none.

### What changed (review Issues, in order)

- **Important 1 — occupancy floor.** `cells[].rows` is now read through `isWireOccupancy` (the repo's guard for this exact field, `wireGuard.ts:168`); reason `outflows[i].cells[j].rows 0 is not a wire occupancy`. Pin: a `{ to: 5, rows: 0, debt_before_usd: "0", debt_after_usd: "0" }` cell appended to an otherwise reconciling outflow yields exactly `["outflows[2].cells[2].rows 0 is not a wire occupancy"]` — proving the sums alone would have let it draw.
- **Minor 1 — no false sum reason.** `sum += c.rows` now runs right after the occupancy check (before the `to` range check, since the outflow's sum is about its cells wherever they point), and the arrivals update runs after the range check; both precede the debt check. Pin: the unreadable-debt patch yields exactly `['outflows[2].cells[0].debt_before_usd "1e6" is outside the wire Decimal contract']`. (The out-of-range pin now also emits a true `to_rows[0] states 3 and the cells arriving there sum to 0` beside `to 12`; the wire's cell really does arrive nowhere.)
- **Minor 2 — `wad_scale` compared to 1e18.** After the Decimal-shape check, `wireBigInt(t.wad_scale) !== WAD` is refused as `wad_scale states X and this matrix is read at 1e18`. Pinned with `"1000000"`.
- **Minor 3 — the histogram beside the matrix is checked lane for lane.** In the reconciliation phase, for every bucket: `buckets[i].count === from_rows[i]` (reason `from_rows[i] states N and the distribution beside it counts M in <label>`) and `lower_wad`/`upper_wad` equal to the lane's by value (`sameEdge`: both null, or both readable and equal; reason `lanes[i].upper_wad "…" and the distribution beside it states "…"`). The existing edge-shift pin already shifted the histogram consistently with its lane and still renders verbatim; a new test shifts only the histogram (two edge reasons named) and only a count (exactly one reason).
- **Minor 4 — exact pins.** `"lanes"` → `"states 9 lanes"`; `"rows"` → `"from_rows[2] 1.5"`.
- **Minor 5 — unused export.** `RunBookTransitions` removed from the module's exports (`RunBookEngine` and `TransitionLane` remain, both used).

### Concerns after this round

- Only the BEFORE histogram is checked against `from_rows`; the symmetric AFTER check (`after.hf_histogram.buckets[i].count === to_rows[i]`), the two tallies (`infinite_count`/`refused_count` vs `from_rows[8]`/`[9]`), the bucket label byte-identity, and the histogram's own `wad_scale` vs the matrix's are not checked. All are cheap and in the same shape; left out because the fix list was explicit.
