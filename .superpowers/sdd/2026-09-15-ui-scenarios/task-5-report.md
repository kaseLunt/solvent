# Task 5 report: `lab-movers` and the ruled narrowing

**Status:** DONE_WITH_CONCERNS
**Commit:** `cf124d3594aff0fed8dfb28cfa8fc60fb55244c6`
**Paths committed (4, by pathspec):** `web/lib/lab-movers.ts`, `web/tests/unit/lab-movers.spec.ts`, `web/lib/lab-transitions.ts`, `web/lib/lab-library.ts`

## What was done

### The module: `web/lib/lab-movers.ts`

Transcribed from the brief. Exports `MoverRow`, `MoversTable`, `RunBookMover`, `MoverEngine`, `roomFromRatio`, `moversTable`, `moversCaption`.

- `roomFromRatio(num, den)`: `den === 0n` → `no debt`; `num === den` → `at cap`; `num < den` → `over cap`; otherwise `formatTenths(percentTenths(num - den, num))`, floored to tenths.
- `moversTable(engine)`: refuses the whole table on an unreadable `usd_decimals` (`rows: []`, `unreadable: ["usd_decimals"]`); otherwise one row per wire mover in the wire's order. Each ratio side goes through `isWireDecimal` and names `movers[i].hf_before_num` / `_den` (and `hf_after_*`) on failure; each wad likewise names `movers[i].hf_before_wad` / `hf_after_wad`; `debt_usd` names `movers[i].debt_usd`; `movers_total` names `movers_total` and the total becomes `null`. A null wire field is a dash (`—`) or `null`, never a zero. The tier is `materialityTier(debt, decimals)` only when the debt is readable.
- `moversCaption(t)`: `showing N of M account(s) moved`, or `showing N account(s) moved · total not stated` when the total is unreadable.

### The narrowing (controller ruling)

(a) `web/lib/lab-transitions.ts`: added `export type LaneEngine = Pick<RunBookEngine, "usd_decimals" | "hf_transitions" | "before">` beside the wire aliases; `guards` and `laneReading` now take `LaneEngine`. `guards` had to move with `laneReading` because it is called with the same value. Type-only; no behavior changed. `RunBookEngine` and `TransitionLane` remain exported as before.

(b) `web/lib/lab-movers.ts`: `moversTable`'s parameter is `MoverEngine = Pick<RunBookEngine, "usd_decimals" | "movers" | "movers_total" | "movers_note">`, exported. The wire `RunBookEngine` alias is kept local to the module (see deviations).

(c) `web/lib/lab-library.ts`: `heatOf` now calls `laneReading(cash, { merge: true })`; the `{ ...cash, projection: null }` bridge is removed and the doc comment restated to the law (the reading takes only the fields it reads, so the sealed projection is never handed across).

Verification ritual: `find_referencing_symbols` on `laneReading` shows the `lab-library.ts` call site as `laneReading(cash, { merge: true })` and every other reference in the two spec files, unchanged. No stale bridge.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts tests/unit/lab-transitions.spec.ts tests/unit/lab-library.spec.ts tests/unit/lab-headline.spec.ts
```

```
  21 passed (2.8s)
```

(4 movers + 8 transitions + 4 library + 5 headline.) Before the module existed the spec failed with `Cannot find module '…/lib/lab-movers'`, as the brief expects.

`npm run typecheck` (tsc --noEmit): exit 0, no output. `npm run lint` (eslint .): exit 0, no output. `python roadmap/tools/scope_gate.py`: `scope-gate: OK -- integrator claude-integrator; 4 path(s)`; the pre-commit hook ran the doctor and gate again with the same result.

## Deviations, each with its reason

1. **Pin `hfAfter` for wad `756000000000000000`: `"0.75"` → `"0.756"`.** The brief flags this pin and rules that the Book's law wins. `hfDisplayFromWad(wad)` is `truncateToDisplay(parseDecimal(wad), 18)`, and `truncateToDisplay` (its doc: "A display health factor truncated to 3 fraction digits… Truncation (never rounding)… '1.080' trims to '1.08'") keeps three fraction digits, truncates, and trims trailing zeros: 756000000000000000 / 10^15 = 756 → `0.756`. The first run printed exactly `Expected: "0.75"  Received: "0.756"`. The pin now carries a two-line comment stating the law. `1.08` for the before wad was already right.

2. **The unreadable test's mover construction (scaffolding, not a pin).** The brief builds the unreadable row with `mover("…d0001", "1e9", …)`, but the spec's own `mover` helper derives the after side with `String(BigInt(num) * 7n)`, and `BigInt("1e9")` throws `SyntaxError: Cannot convert 1e9 to a BigInt` before `moversTable` is reached. The row is now `{ ...mover("…d0001", "1000000000", "1000000000", "0x10", true), hf_before_num: "1e9" }`, so exactly the before numerator is the unreadable field. Every `expect` in that test is verbatim from the brief (including the `unreadable` list order `["movers[0].hf_before_num", "movers[0].debt_usd", "movers_total"]`). The module's code was not changed for this.

3. **Line-1 path comments stripped** from both new files (binding rule). The prose comments that follow are the brief's.

4. **`RunBookEngine` is not exported from `lab-movers.ts`** (the brief's code exported it). The module's contract is `MoverEngine`; re-exporting the full wire type from here would invite callers to hand a sealed engine to a signature that does not take it, and `lab-transitions.ts` already exports the wire alias. One-word change; easy to reverse if the controller wants the export.

5. **Path count.** The instruction says the commit names FIVE paths but enumerates four (the brief's two plus `lab-transitions.ts` and `lab-library.ts`, helper explicitly excluded). Nothing else was touched, so the commit names the four enumerated paths. The helper `web/tests/unit/helpers/run-book-engine.ts` was read, not edited.

## Concerns

- **A half-null ratio is dashed, not named.** `ratio()` returns `—` when either of `num`/`den` is null. The wire's doc says the numerator is null "when that side has no debt", which implies the pair is null together; a pair with one side null is a wire contradiction that this table prints as a quiet dash. The brief's law; flagging for the page's reviewer.
- **`"unreadable"` shares the `string | null` type of a real HF display** on `hfBefore`/`hfAfter`. Consumers cannot tell them apart by type; the `unreadable` list is the only signal. Same for `roomBefore`/`roomAfter`. The brief's design; a page that tones the cell will need to consult the list, or a later task could make the cell a value-or-refusal by type as the kit did.
- **`mover.engine` is not checked against the parent engine's id.** A mover row stating another engine's id is rendered as if it belonged. Not in the brief; noting only.
- Git prints LF→CRLF warnings for the new files on this Windows checkout (core.autocrlf); the landed Task 2–4 files behave the same.

## Fix round 1

**Commit:** `88f05183c668a31c25a966e1c57c807b82325307` — two paths by pathspec: `web/lib/lab-movers.ts`, `web/tests/unit/lab-movers.spec.ts`. Built on HEAD `a444953` (Task 6 landed; the two files were untouched since `cf124d3`). Scope gate: `scope-gate: OK -- integrator claude-integrator; 2 path(s)`.

### What changed

1. **Important (plan defect): a scale-refused table is captioned as unreadable, never as zero accounts.** `moversCaption` gained one branch before the counting ones: when `t.unreadable.includes("usd_decimals")` it returns `"not readable: unreadable scale"`. The comment states the law ("0 accounts" would be a claim about the book; the truth is that the scale could not be read). Pin added on the existing `badScale` table: `expect(moversCaption(badScale)).toBe("not readable: unreadable scale")`.

2. **Minor (taken): a half-null ratio pair names its null side.** `ratio()` now returns `—` only when both sides are null. Otherwise each side goes through `isWireDecimal` as before, and since the guard refuses `null` like any other value outside the contract, a null side is pushed as `movers[i].hf_before_den` (or `_num`, or the `hf_after_*` names) and the cell prints `unreadable`. `BigInt(num)` / `BigInt(den)` after the early return is typed through the aliased predicates (`tsc` clean). New test with a Cash mover whose `hf_before_den` is null and whose after pair is null together: `roomBefore` is `unreadable`, `roomAfter` is `—`, and `unreadable` is exactly `["movers[0].hf_before_den"]`.

Nothing else was touched; `lab-transitions.ts` and `lab-library.ts` are as committed in `cf124d3`.

### Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts
```

```
  5 passed (2.6s)
```

`npm run typecheck`: exit 0. `npm run lint`: exit 0.

### Concerns carried

- The deferred minors from the review that were not taken this round remain as stated there: `"unreadable"` shares the `string` type with a real reading (page task's call), `mover.engine` is not checked against the parent (would widen the Pick), `roomFromRatio`'s sign admission is the app-wide `WIRE_DECIMAL` class, and `decimals: 0` on a refused table is a stand-in a page must not print.
