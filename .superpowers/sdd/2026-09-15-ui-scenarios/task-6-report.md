# Task 6 report: `lab-address` — the one-address workspace

Status: DONE
Commit: `a44495383c216ada20803cd745d502e47d6750d8`
Message: `feat(web): lab-address - the one-address workspace over the Inspector's own reading, every state its own sentence, before/after tiles in the account register`
Files (exactly the two the brief names):
- `web/lib/lab-address.ts` (131 lines, new)
- `web/tests/unit/lab-address.spec.ts` (107 lines, new)

## What was done

1. Read every symbol the module consumes with Serena before writing a line: `InspectorView`, `InspectorState`, `LoadPhase`, `deriveInspectorView` (inspector-view.ts); `StressReading`, `StressRow`, `StressSide`, `stressReading`, `row`, `side` (address-stress.ts); `CashPosition`, `CashStatus` (inspector-position.ts); `AddressReading`, `Phase` (address-lookup.ts); `LabHeadline` (lab-headline.ts); `truncateAddress`, `humanUsdFull`, `isWireScale`; `unavailableLookupHeadline` / `InspectorHeadline` (inspector-headline.ts); the demo and inspector fixture constants. Every field name the brief's code reads exists with the type the brief assumes (`debt`/`cap`/`room` as `bigint | null`, `status: CashStatus`, `verdict` on `StressSide`, `stressLoad` as `LoadPhase`, `stress` as `StressReading | null`).
2. Step 1: wrote the pins verbatim, with the brief's temporary `console.log(JSON.stringify(w.tiles), w.headline.dek)` in the last test.
3. Step 2: ran before the module existed. Output: `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\lab-address' imported from ...\web\tests\unit\lab-address.spec.ts` — as the brief expects.
4. Step 3: wrote the module verbatim from the brief (see Deviations for the one omission). It compiled and passed on the first run with no code correction needed.
5. Step 1 note (the one sanctioned pin edit): read the two literals from the log, froze them, deleted the log.
6. Step 4: 4 passed. `npm run typecheck` exit 0, `npm run lint` exit 0.
7. Step 5: staged by name, `python roadmap/tools/scope_gate.py` printed `scope-gate: OK -- integrator claude-integrator; 2 path(s)` (doctor: 0 errors, 0 warnings, 5 info), committed by pathspec.

## The two frozen literals

Read from the demo fixture (`DEMO_STRESS_NEAR`, `eth_minus_30`, decimals 6) via the temporary log, and confirmed by hand against `stress-demo-near.json` (after `max_borrow_lt` 3,752,500,000; after room = 3,752,500,000 − 4,822,000,000 = −1,069,500,000):

- `w.headline.dek` — was `/^Room today \$190\.50; after the shock, over cap by \$[0-9,]+\./`, now:
  `"Room today $190.50; after the shock, over cap by $1,069."`
- `t.capAfter.value` — was `/^\$[0-9,]+/`, now:
  `"$3,752"`

The full log line, for the record:
`{"debtBefore":{"value":"$4,822","tone":"neutral"},"capBefore":{"value":"$5,012","tone":"neutral"},"roomBefore":{"value":"$190.50","tone":"warn"},"statusBefore":{"value":"Near cap","tone":"warn"},"debtAfter":{"value":"$4,822","tone":"neutral"},"capAfter":{"value":"$3,752","tone":"neutral"},"roomAfter":{"value":"over cap by $1,069","tone":"crit"},"statusAfter":{"value":"Liquidatable","tone":"crit"}} Room today $190.50; after the shock, over cap by $1,069.`

## Step 4 check: does `eth_minus_30` flip the near account?

Yes. The fixture's `before`/`after` carry `liquidatable: false` → `true` (no raw `liquidation_verdict` field in the JSON); `@solvent/client`'s `lookup()` seals `liquidatable` into the `liquidation_verdict` union (`packages/client-ts/src/refine.ts`), so `address-stress.ts`'s `side()` reads `not-liquidatable` → `liquidatable` and `flips === true`. The Plan 2 weld (`web/tests/unit/demo-inspector-weld.spec.ts`, "stress: ETH −30 % and ETHFI −50 % flip the account; the rate projection does not") pins exactly that. No stop condition was hit.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts
  4 passed (2.6s)
```

## Deviations

1. **No line-1 path comment** (both files). The brief's code blocks open with `// web/lib/lab-address.ts` and `// web/tests/unit/lab-address.spec.ts`; the binding rules say no line-1 path comment, so each file opens with the brief's law comment instead. No other line of the brief's code was changed.
2. **The sanctioned pin edit only.** The two regexes named in the Step 1 note were frozen into literals (above). The third regex in that test, `expect(t.roomAfter.value).toMatch(/^over cap by \$/)`, is not among the two the brief sanctions, so it was left as written — the log shows it would freeze to `"over cap by $1,069"` if a later round wants it exact.

## Concerns

- **Unavailable dek is the Inspector's first sentence.** `view.headline.dek.split(". ")[0]` takes the Inspector's dek up to its first `". "`. A lookup error message that itself contains `". "` would be cut to its first sentence before the workspace's own sentence is appended. The brief's design, not corrected; the pinned message (`rate limited (429), retry after 30s`) has no interior period so the pin passes.
- **The `rows` state with no printable selection.** When `stress.kind === "rows"` but `selected`, `decimals` or `view.cash` is null, the workspace stays `state: "rows"` with the refusal "No scenario applies to …" / "The stress response carried no scenario for this account." A null `view.cash` or `decimals` beside non-empty rows would print that sentence although the cause is the Cash position, not the scenarios. In practice `stressReading` is Cash-scoped and a Cash row only exists beside a Cash position, so the arm is reached only for an empty row list. Noted for the page (Task 7+) if it ever needs to distinguish the two.
- Git printed the repo's usual `LF will be replaced by CRLF` warnings for the two new files — autocrlf, cosmetic, identical to the rest of `web/`.
- The temporary `console.log` was deleted before the final run; the committed spec carries no log.

## Fix round 1

Commit: `c1fd2c687fcaa1ba7265d4188797acc1772437b2` on top of `88f0518` (lab-movers fix round; neither of this task's files had changed since `a444953`).
Message: `fix(web): lab-address review round - a projection row's headline reads its horizons, negative wire figures and refused positions never print, the rows arm split by cause, the after status by band`
Files: exactly `web/lib/lab-address.ts` (+113/−28 net of comments) and `web/tests/unit/lab-address.spec.ts` (+94). Scope gate `OK -- integrator claude-integrator; 2 path(s)`; doctor 0 errors / 0 warnings.

### What changed (review Issues 1, 2, 5, 7)

**Important 1 — a projection row's headline reads its horizons.** New `projectionHeadline(short, label, horizons, today, decimals)`, entered from `rowHeadline` when `row.projection !== null`, before the flips arms. An `unknowable` horizon → refused `Cannot say whether {short} becomes liquidatable under {label}.` with the dek ending `The {horizonLabel(h)} horizon carries no verdict.`; else the first `liquidatable` horizon → `{short} becomes liquidatable within {horizonLabel(first.seconds)} under {label}.` tone `warn`; else `{short} stays inside its cap through {horizonLabel(longest.seconds)} under {label}.` tone `ok`. The projection dek is `Room today {room}; ` + each horizon's `{horizonLabel}: +{humanUsdFull(extraInterest)} interest` joined by `; `, ending with a period; a null (or negative) `extraInterest` prints `not computed`. `horizonLabel` is imported from `lib/address-stress.ts`. A projection with no horizon (unreachable — the reader nulls an empty projection) is a refusal saying so rather than a `reduce` on an empty array.

**Important 2 — negative wire figures and refused positions never print.** `money()` refuses `v === null || v < 0n`. The before tiles follow the Inspector: when `view.refusedTiles` is true, `debtBefore`/`capBefore`/`roomBefore` are the refused tile and `statusBefore` stays the Inspector's status word (`STATUS_WORD[before.status]`). The same law is applied to the after side through a new `readable(side)` guard (debt and cap both present and non-negative, room recomputed as `cap − debt` exactly as the reader does): an unreadable after side refuses all four after tiles, including the room that would otherwise be manufactured from a negative debt, and its status is `Not computed` — the Inspector's own rule (`readCashPosition` sets `computed: false` for a negative debt or cap). The headline's room words go through the same guard (`sideRoomWords`), so the dek never prints a room derived from a negative figure.

**Minor 5 — the rows arm split by cause**, in this order: empty `rows` → `No scenario applies to {short}.` / `The stress response carried no scenario for this account.`; `view.cash === null` beside rows → `No Cash position for {short} to stress.` / `The stress response carries scenarios, but the lookup found no Cash position — the two answers disagree.`; `decimals === null` beside rows → `The Cash position's scale could not be read.` / `No figure prints at an unreadable scale.` The position is asked before its scale because a null position always has a null scale (`decimals = cash?.decimals`), and the disagreement is the truer sentence. All three keep `state: "rows"`, the rows, the selection and `tiles: null`.

**Minor 7 — the after status by band.** `afterStatus` for a readable, non-liquidatable, non-unknowable side calls `headroomBand(cap, debt)` (same argument order as the Inspector's reader) and prints `Near cap` warn when the band is in the Inspector's near set, else `Healthy` ok. Note: the Inspector's `NEAR_BANDS` is `{0, 1, 2, 3}` — it includes the breached band 0 deliberately ("a negative room says near, never healthy; the verdict governs the status, the room shows the contradiction"), not `{1, 2, 3}` as the fix instruction summarised it. The set is module-private in `inspector-position.ts` (out of scope to export), so it is restated locally with a comment naming the Inspector's rule.

### Frozen literals (from `stress-demo-near.json`, `dm_rate_horizon_plus_200bps`, decimals 6)

Horizons 2,592,000 s → `30d`, +7,926,575 → `$7.92`; 7,776,000 s → `90d`, +23,779,726 → `$23.77`; neither `becomes_liquidatable`; the projection's after equals the spot (cap 5,012,500,000 / debt 4,822,000,000 → `headroomBand` 2 → near).

- emphasis: `0x7a3f…c21e stays inside its cap through 90d under Debt Manager borrow APY +200bps (PROJECTION).`
- tone: `ok`
- dek: `Room today $190.50; 30d: +$7.92 interest; 90d: +$23.77 interest.`
- `tiles.statusAfter` for that row: `{ value: "Near cap", tone: "warn" }` (the one near-after pin)

The `["ok", "warn", "crit"]` assertion is replaced by a `toEqual` on the whole headline. The literals were hand-computed from the fixture and confirmed by the run (all seven passed on the first run, no log needed).

### New pins

- `projected(1, true)` (90d horizon liquidatable, 30d not) → `0x7a3f…c21e becomes liquidatable within 90d under …(PROJECTION).` warn, same dek — the first liquidatable horizon, not the first horizon.
- `projected(0, null)` (30d horizon unknowable) → refused `Cannot say whether … under …(PROJECTION).`, dek = projection dek + ` The 30d horizon carries no verdict.`
- `DEMO_ADDRESS_REFUSED` + demo stress → `state: "rows"`, all four before tiles refused (`—` / `Not computed`), no `$` in any tile; headline `ETH -30 percent does not apply to 0x4444…4404.` / `Not evaluated for this account.`
- `eth_minus_30` with after `debt_usd: "-4822000000"` → before tiles print, all four after tiles refused, dek `Room today $190.50; after the shock, not computed.`
- Cash `value_decimals: 1.5` beside rows → `state: "rows"`, selection kept, `tiles: null`, `decimals: null`, the unreadable-scale headline.
- `ADDRESS_NOT_FOUND` + the demo stress readdressed → `state: "rows"`, `tiles: null`, the disagreement headline.

### Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts
  7 passed (2.4s)
```
`npm run typecheck` exit 0; `npm run lint` exit 0.

### Deviations from the fix instruction

- The after side's whole tile set is refused for a negative debt or cap (not only `money()`): a room computed from a negative debt is a negative wire figure printing in disguise, and the commit message claims none prints. Same law, applied to the row's dek too.
- `NEAR_BANDS` restated as the Inspector's actual set `{0, 1, 2, 3}`, not `{1, 2, 3}` (see Minor 7 above).

### Concerns

- ~~`roomAfter`'s tone is unchanged (crit when the verdict is liquidatable, else neutral), so beside a `Near cap` warn status the after room prints neutral where the before pair are both warn.~~ Resolved in round 1b, below.
- The remaining deferred minors from the review (3, 4, 6, 8, 9, 10) are untouched; the `roomAfter` regex on the eth_minus_30 row is still a regex.

### Round 1b — the after room's tone

Commit: `477e5138a8b7dbd90e25e43286c7354f3827268b` — `fix(web): lab-address - the after room carries the near-cap tone beside its status` (the same two files; scope gate OK). `roomAfter`'s tone is now derived from `statusAfter`, as `roomBefore`'s is from the Inspector's status: `crit` beside `Liquidatable` (and, via `roomTile`, whenever the room is negative), `warn` beside `Near cap`, `neutral` otherwise; a refused after side still refuses the room. The near-after pin on the demo projection row additionally asserts `roomAfter` equals `{ value: "$190.50", tone: "warn" }`. Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts` → `7 passed (2.7s)`; `npm run typecheck` exit 0; `npm run lint` exit 0.

## Fix round 2

Commit: `844174995491e3e08578ac99faedf6eb1db61c48` on top of `477e513`.
Message: `fix(web): lab-address round 2 - an unreadable shocked side never yields a verdict, a withheld Cash book beside stress rows is a cannot-say, an unknowable after verdict refuses its tiles`
Files: exactly `web/lib/lab-address.ts` (+23/−5 incl. comments) and `web/tests/unit/lab-address.spec.ts` (+54). Scope gate `OK -- integrator claude-integrator; 2 path(s)`; doctor 0 errors / 0 warnings.

### What changed (re-review gaps A, B and the residual C)

**A — an unreadable shocked side never yields a verdict.** In `rowHeadline`, after the projection arm and before the flips arms: when a non-null `before` or `after` side fails `readable()` (debt or cap null or negative), the row is `refused("Cannot say whether {short} becomes liquidatable under {label}.", "{dek} The shocked figures are not a position.")`, where `dek` is the same room sentence the flips arms use, with "not computed" for the unreadable side. Plan 2's reader still reads `flips === true` from the wire's booleans in that case; the headline no longer prints a verdict word beside a register that refuses the figures. The `cannot` emphasis is hoisted and shared with the `flips === null` arm.

**B — a withheld Cash book beside stress rows is a cannot-say.** In the rows arm, before the "No Cash position for {short} to stress." sentence: `view.state === "cannot-compute"` → `refused("Cannot say — the Cash book is withheld for {short}.", "The stress response carries scenarios while the lookup's Cash book is withheld — the two answers disagree.")`, keeping `state: "rows"`, the rows, the selection and `tiles: null`. `not-found` and `legacy-only` (both complete lookups by the client's law) keep the "No Cash position … to stress." sentence.

**C — an unknowable after verdict refuses its tiles.** The after figures are read only when `side.verdict !== "unknowable"` (`after = side !== null && side.verdict !== "unknowable" ? readable(side) : null`), so `debtAfter`/`capAfter`/`roomAfter` are the refused tile beside `statusAfter: Not computed` — mirroring the before side's `refusedTiles`, which excludes `unknowable` through `isComputedCash`.

### New / sharpened pins

- Negative after debt (`eth_minus_30`, `debt_usd: "-4822000000"`): whole headline now pinned — emphasis `Cannot say whether 0x7a3f…c21e becomes liquidatable under ETH -30 percent.`, tone `refused`, dek `Room today $190.50; after the shock, not computed. The shocked figures are not a position.` (Before this round it read "becomes liquidatable" crit.)
- Unknowable after verdict (`eth_minus_30`, after `liquidatable: null`, which the client seals to `unknowable`): `selected.after.verdict === "unknowable"`; `debtBefore` prints `$4,822`; `debtAfter`/`capAfter`/`roomAfter` are `—` refused; `statusAfter` is `Not computed`; headline is the `flips === null` cannot-say with dek `Room today $190.50; after the shock, over cap by $1,069. One side of the comparison is withheld or unknowable.`
- Withheld Cash book beside rows: `ADDRESS_UNKNOWABLE` as the lookup (`found: null`, `debt_manager` withheld `FLAG_CUSTODY_UNPROVEN`) beside the demo stress re-addressed to `UNKNOWABLE_ADDR` (body `address` and every result's `account`): `state: "rows"`, three applicable rows, `tiles: null`, emphasis `Cannot say — the Cash book is withheld for 0xccCc…0003.`, the disagreement dek, and an explicit assertion that neither emphasis nor dek contains "No Cash position".

### Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts
  9 passed (2.7s)
```
`npm run typecheck` exit 0; `npm run lint` exit 0.

### Concerns

- In the unknowable-verdict case (C) the tiles refuse the after figures while the dek still prints the room words from those figures (`after the shock, over cap by $1,069`). The instruction scoped C to the three money tiles, so the dek was left as it was; it has a precedent in the Inspector's not-computed headline, which prints the last readable debt beside refused tiles. If the dek should refuse too, it is one condition in `sideRoomWords`.
- Deferred minors 3, 4, 6, 8, 9, 10 from the first review remain untouched; the eth_minus_30 `roomAfter` regex is still a regex.

### Round 2b — an unknowable side prints no room figure in the dek either

Commit: `f338b53ef3265d493b35fbf3b2b285fafab82fbc` — `fix(web): lab-address - an unknowable side prints no room figure in the dek either` (the same two files; scope gate OK). `sideRoomWords` now reads a side's figures only when its verdict is not `unknowable` (the same condition the after tiles use), so the dek's room words for an unknowable side are "not computed" — the tiles' own word — never a figure. The unknowable-after pin's dek is now `Room today $190.50; after the shock, not computed. One side of the comparison is withheld or unknowable.`, with explicit assertions that it contains "not computed" and not "over cap by". Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts` → `9 passed (2.9s)`; `npm run lint` exit 0.

**Typecheck caveat (external, not this change):** `npm run typecheck` reported exactly one error, `app/lab/page.tsx(3,28): error TS2307: Cannot find module './LabSurface'`. That file is another task's uncommitted work in progress (`git status` shows `web/app/lab/page.tsx` and `lab.module.css` modified and six untracked lab components; `LabSurface` does not exist yet), untouched by this task; no error is reported in `lab-address.ts` or its spec, and the pathspec commit excludes that working-tree state by construction. Nothing outside the two Task 6 files was modified or stashed to work around it. Round 2 itself (`8441749`) typechecked clean before that WIP appeared.

## Fix round 3

Commit: `b42074a028fe9ad42e0ac8c98c9be491f37d1100` on top of `f338b53`.
Message: `fix(web): lab-address round 3 - an uncomputable side yields no verdict word in any row kind, the law carried once`
Files: exactly `web/lib/lab-address.ts` (+41/−17 incl. comments) and `web/tests/unit/lab-address.spec.ts` (+24). Scope gate `OK -- integrator claude-integrator; 2 path(s)`; doctor 0 errors / 0 warnings.

### What changed (re-review 2: residual of A, plus the two folded nits)

1. **The law carried once — `computable(side)`.** A non-null side is computable when `side.verdict !== "unknowable"` and `readable(side) !== null`; it returns `readable`'s figures or null. It now stands in every place that spelled the condition: the after tiles (`after = computable(side)`), `sideRoomWords`, the `rowHeadline` gate, and also `afterStatus` (which had the same rule split over two lines — the fourth spelling, folded in so the law is written exactly once).
2. **The gate hoisted above the projection arm.** `rowHeadline` now computes `today`, `dek` and the `cannot` emphasis first, then asks whether any non-null side is uncomputable — before `projectionHeadline` is consulted and before the flips arms. A projection row whose spot side is unreadable or carries an unknowable verdict is therefore `Cannot say whether {short} becomes liquidatable under {label}.` with `tone: "refused"`, matching its `—` / `Not computed` after tiles, instead of a horizon verdict. The existing projection pins (`stays inside its cap through 90d …`, its dek, the within-90d warn and the unknowable-horizon refusal) stay green because their spot sides are computable.
   The gate keys on `computable` but keeps two cause sentences, so no earlier pin changed meaning: unreadable figures → `The shocked figures are not a position.` (round 2's A sentence); a known-figures side whose verdict is unknowable → `One side of the comparison is withheld or unknowable.` (round 2's C pin). The `flips === null` arm below the gate is now reached only for a missing (null) side and keeps the latter sentence.
3. **The orphaned JSDoc removed.** `rowHeadline` carries one JSDoc, restated to the hoisted law ("a side the tiles refuse … yields no verdict word in any row kind … that gate is asked before a projection reads its horizons or a spot shock reads the reader's flip"). Verified by listing every `/**`…`*/` pair against the function lines: one block per function.

### New pins

- Projection row (`dm_rate_horizon_plus_200bps`) with the spot `debt_usd: "-4822000000"`: `selected.projection` non-null (the horizons exist and are not consulted); whole headline `toEqual` — emphasis `Cannot say whether 0x7a3f…c21e becomes liquidatable under Debt Manager borrow APY +200bps (PROJECTION).`, tone `refused`, dek `Room today $190.50; after the shock, not computed. The shocked figures are not a position.`; `tiles.statusAfter` is `Not computed`, `roomAfter` is `—`.
- The same row with the spot `liquidatable: null` (sealed to `unknowable` by the client): the same refused emphasis with dek `Room today $190.50; after the shock, not computed. One side of the comparison is withheld or unknowable.`; `statusAfter` is `Not computed`.

### Verification

```
cd web && npx playwright test tests/unit/lab-address.spec.ts
  10 passed (3.1s)
```
`npx tsc --noEmit` → 0 errors (none anywhere; the earlier `app/lab/page.tsx` noise has cleared). `npx eslint lib/lab-address.ts tests/unit/lab-address.spec.ts` → exit 0.

### Concerns

- The refused dek for a projection over an uncomputable spot reads "after the shock, not computed" — the spot-row sentence, as instructed ("the existing refused(…)") — although a projection has no shock; the re-review had floated "the projection's own dek". A wording-only residual; if wanted it is one branch in the gate on `row.projection !== null`.
- Deferred minors 3, 4, 6, 8, 9, 10 remain as reported; the eth_minus_30 `roomAfter` regex is still a regex; the "two todays" nit (the dek's `Room today` is the stress row's `before`, the tile is the lookup's Cash) remains deferred with minor 8.

## Round 3b

Commit: `3332a45704dd3c1794c9d628a88deba9a0211602` — `fix(web): lab-address - a projection row refuses in projection words, not shock words` (the same two files; scope gate OK; doctor 0 errors / 0 warnings). Closes round 3's wording concern.

In `rowHeadline`'s hoisted gate only: a `projected` flag (`row.projection !== null`) chooses the dek's after-clause — `under the projection, {words}.` for a projection row, `after the shock, {words}.` for a spot row — and the unreadable-figures cause — `The projected figures are not a position.` versus `The shocked figures are not a position.` The unknowable-verdict cause, `One side of the comparison is withheld or unknowable.`, is unchanged for both kinds. The spot arms below the projection return only ever see a spot row, so every spot-row dek and pin is untouched.

Re-pinned (whole-dek literals): the projection row with the spot `debt_usd` negative → `Room today $190.50; under the projection, not computed. The projected figures are not a position.`; with the spot `liquidatable: null` → `Room today $190.50; under the projection, not computed. One side of the comparison is withheld or unknowable.`; plus an assertion that neither dek matches `/shock/`.

Run: `cd web && npx playwright test tests/unit/lab-address.spec.ts` → `10 passed (2.9s)`; `npx tsc --noEmit` → 0 errors; `npx eslint lib/lab-address.ts tests/unit/lab-address.spec.ts` → exit 0.

Concerns: none new. Deferred minors 3, 4, 6, 8, 9, 10 remain as reported; the eth_minus_30 `roomAfter` regex is still a regex; the "two todays" nit stays deferred with minor 8.

## Fix round 4

**What changed**

- `web/lib/lab-address.ts`, `rowHeadline`: the refusal gate now reads `[row.before, row.after]` unfiltered and trips when any side is not `computable` — a null side is not computable, so a projection row beside a missing before or after side refuses (`Cannot say whether … under <projection label>.`, dek `… not computed. One side of the comparison is withheld or unknowable.`) instead of reaching `projectionHeadline`. The cause sentence keeps its selection: figures present but not a position → `The projected/shocked figures are not a position.`; a missing or unknowable side → `One side of the comparison is withheld or unknowable.` The dek clauses, the `projected` word choice and the `flips === null` arm are untouched.
- `web/tests/unit/lab-address.spec.ts`: one new test, "a projection beside a missing side yields no verdict word…", two pins on the whole headline object with `toEqual`: (a) `after: null` → the refused projection cannot-say with the withheld/unknowable cause, `tiles.statusAfter` NOT_COMPUTED, `tiles.roomAfter` REFUSED; (b) `before: null` → the same refused headline, dek `Room today not computed; under the projection, $190.50. …`. Neither dek says "shock". Both fail on the prior code: the filtered gate saw only the present side, passed, and `projectionHeadline` printed the ok verdict "stays inside its cap through 90d".

**Test line**

`npx playwright test tests/unit/lab-address.spec.ts` → 11 passed. `npx tsc --noEmit` → 0 errors. `npx eslint lib/lab-address.ts tests/unit/lab-address.spec.ts` → exit 0. `python roadmap/tools/scope_gate.py` → "no staged changes", exit 0.

**Concerns**

- Commit BLOCKED by the control-plane pre-commit hook, not by the change: `roadmap/claims/CLAIM-claude-integrator.md` active lease expired at 2026-09-16T22:06:26+00:00, and active work item W3 has 0 active claims (exactly one required). HEAD remains 3332a45. The two files sit edited in the working tree, unstaged. Renewing the lease is governance outside this fix's two-file scope; hooks were not bypassed. Once the lease is renewed, the pathspec commit command re-runs as given.
- The `flips === null` arm in `rowHeadline` is now unreachable in practice (inapplicable rows, missing sides and unknowable verdicts are all caught earlier). TypeScript does not object; left per brief.

(Integrator: the round-4 commit landed as 6eee7fd after the claim lease was renewed — f7f572a.)
