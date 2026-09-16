# Task 14 — fix round after the whole-branch review (Plan 2, the Inspector page)

**Status:** DONE_WITH_CONCERNS
**Commit:** `f440ec9b3472d00068ec0dd3893eaf91f47af0a8` — `fix(web): inspector final review - the legacy card judged by its own health factor, wire scales guarded in the readers, the view owns the legacy series and stress, no room chart for an account that never held Cash, one prose module, the near-cap dek brought to its cap`
**Scope gate:** `scope-gate: OK -- integrator claude-integrator; 26 path(s)`; staged by explicit pathspec (24 modified, 2 new).
**Verification (from `web/`):** `npm run typecheck` clean · `npm run lint` clean · `npm run lint:css` clean · `npm run build` clean · `npx playwright test --project=unit`: 1134 passed · `npx playwright test` (whole suite, fresh build on :3111): 1452 tests — 1442 passed, 10 skipped (the styleguide "when built in" gate, pre-existing), 0 failed.

## Per finding

### C1 — the legacy card judged by its own health factor
- `web/app/inspector/[addr]/LegacyCard.tsx:10-12` — `const verdict = positionVerdict(position)` (from `@solvent/client`); the "Not computed" / refused arm now fires only when that verdict is `unknowable` (a null or refused HF). The two judged tiles carry test ids: `inspector-legacy-hf` (:22) and `inspector-legacy-status` (:30).
- Pin: `web/tests/e2e/inspector.spec.ts` contract test ("the contract fixture: Cash liquidatable beside a legacy position…") — the Aave fixture (HF 1.08) renders Status "Healthy", `data-tone="ok"`, the HF tile `data-tone="neutral"`, and the card never contains "Not computed".
- No "Liquidatable" pin: no liquidatable-HF Aave position fixture exists (the only sub-1e18 wads under `tests/fixtures` are Book histogram bounds), and the ruling forbade fabricating one.

### I1 — wire scales guarded in the readers
- `web/lib/inspector-position.ts:23-24` `CashPosition.decimals: number | null`; `:41` `ComputedCash.decimals: number`; `:63-69` `readCashPosition` puts `value_decimals` through `isWireScale` first — a failing scale makes `debt`, `cap`, `collateral` (and everything downstream) null, the same shape a malformed decimal takes; `:103-104` `isComputedCash` requires a licensed scale; `:140`, `:153-158` `collateralTable` checks `isWireScale(leg.decimals)` before `humanAmount` and `isWireScale(input.decimals)` before `humanPrice`, printing `"unreadable"` in that cell (an absent amount stays null → "—", so the two statements stay distinct).
- `web/lib/inspector-view.ts:74` `InspectorView.decimals: number | null` (the reader's guarded scale, `cash?.decimals ?? null`; the manufactured `?? 6` is gone); `:130` `notComputedCause` names the scale: "the engine published an unreadable value scale (value_decimals) for this account" — placed after the refusal/status arms and before the cap/debt arms, so a refused row keeps its refusal cause; `:251` the "last readable debt" needs a licensed scale (it is null by construction anyway).
- `web/app/inspector/[addr]/money.ts:13-14` `moneyFor(null)` prints "—" for every value; `InspectorTiles.tsx:40` and `InspectorDrawer.tsx:20` guard the exact register on a null scale.
- Pins: `tests/unit/inspector-position.spec.ts` — "readCashPosition: a value scale the wire guard refuses…" (`value_decimals` −2 and 1.5: every amount null, `computed: false`, no refusal invented; a refused row at a bad scale keeps its code and no readable debt) and "collateralTable: a leg or price-input scale the wire guard refuses prints 'unreadable'…" (bad leg scale −1, bad input scale 2.5, an absent amount still null). `tests/unit/inspector-view.spec.ts` — "a value scale the wire guard refuses: the refused register names value_decimals…" (−2 and 1.5: state `not-computed`, `decimals` null, refused tone, the exact dek, no "$" anywhere, no throw).

### I2 — the view owns the legacy series and the stress reading (HistoryCard + StressTable; the drawer untouched by ruling)
- `web/lib/inspector-view.ts:62` `LoadPhase` (a lookup's load phase without its value); `:84` `legacySeries: HistorySeries | null` (built at `:200` with the `engineNeverPresent` gate and `knownBatchAxis`, moved out of `HistoryCard.tsx`); `:90` `stress: StressReading | null` (`stressReading(...)` at `:203`, moved out of `StressTable.tsx`); `:88`/`:91` `historyLoad` / `stressLoad` so the copy layer needs nothing from the request; `:301` `historyFinding(view)` — the eight-arm sentence ladder, pure over the view; `:320` `stressEmptyText(view)` — the stress table's five empty-state arms.
- `web/app/inspector/[addr]/HistoryCard.tsx` takes `{ view }` only (`:24` `historyFinding(view)`); `StressTable.tsx` takes `{ view }` only (`:31` `view.stress`, `:83` `stressEmptyText(view)`); `InspectorSurface.tsx:89,95` pass only the view. `InspectorDrawer.tsx` still reads `reading` for its provenance section, as ruled.
- Pins: `tests/unit/inspector-view.spec.ts` — "the view owns the legacy series and the stress reading…" (HISTORY's legacy engine → entries `[1 refused, 2 computed]`, newest "1.08"; a legacy engine listed empty → `legacySeries` null; a withheld batch alone is presence), "historyFinding: one sentence per arm…" (loading, error, withheld, not found, no Cash history, an unreadable newest batch with the vantage clause, a 3-batch streak, room above the line — one pin each), "stressEmptyText: …" (loading, error, withheld with its cause, no position, no scenarios), plus the loading-state pins for `historyLoad`/`stressLoad`/`legacySeries`/`stress`.

### I3 — no room chart for an account that never held Cash
- `web/lib/inspector-view.ts:186-196` — `roomSeries` is built only when `!engineNeverPresent(<Cash engine>)`; otherwise `room = null`, `streak = null`, so the History card prints "No Cash history for this account in the covered window." and the Trust card its "no Cash history" head.
- Pin: `tests/unit/inspector-view.spec.ts` (same test as I2) — a history response listing the Cash engine with zero points and no withheld batch → `room === null`, `streak === null`, `historyOutcome === "found"`, `historyFinding` is the "No Cash history" sentence.

### I4 — one prose module
- New `web/lib/prose.ts`: `joinAnd(names)` ("a" · "a and b" · "a, b and c" · "" for empty) and `groupInt(value: number | bigint)` (en-US grouping).
- Replaced: `engineList` (`inspector-headline.ts`, export removed; its four call sites and `inspector-view.ts`'s three use `joinAnd`), `list` (`inspector-position.ts:214,260,264`), `andList` (`trust.ts:168`), and the four `toLocaleString("en-US")` lambdas (`inspector-headline.ts`, `inspector-view.ts`, `trust.ts`, `HistoryCard.tsx`) → `groupInt`.
- Pins: new `web/tests/unit/prose.spec.ts` — the three former `engineList` pins moved verbatim (behavior identical), plus the three-symbol case, the empty list, and `groupInt` on a number and a bigint. `inspector-headline.spec.ts` no longer imports `engineList`.

### I5 — the near-cap dek brought to its cap
- `web/lib/inspector-headline.ts:75-76` — "…or $190.50 more debt, brings this account to its cap." (only the verb phrase changed).
- Re-pinned: `tests/unit/inspector-headline.spec.ts:34-37` (exact dek, plus a `not.toContain("liquidatable")` on the near dek) and `tests/e2e/inspector.spec.ts:61`. `grep -rn "makes this account liquidatable" web/tests web/lib web/app` → no other occurrence.

### M1 — the drawer's formula balances at the cents
- `web/app/inspector/[addr]/InspectorDrawer.tsx:18-20` `exactMoney` (`wireExact` on the bigint, "—" without a scale); `:32-37` both substituted lines (Σ legs = cap, cap − debt = room) print every term in the exact register; the Σ line names the register once ("(USD, exact)"). `moneyFor` is no longer imported there.
- Re-pinned: `tests/e2e/inspector.spec.ts` drawer test — `Room = cap − debt = 5,012.500000 − 4,822.000000 = 190.500000`.

### M2 — `oldestPriceAge` through the population guard
- `web/lib/inspector-position.ts:283-287` — an `age_seconds` failing `isWirePopulation` is no age; with none measured the chip says "age unknown", never "0s".
- Pins: `tests/unit/inspector-position.spec.ts` "oldestPriceAge: …" — a negative age beside a measured one → the measured one; negative beside null → null; a fractional age → null; the chip reads "PriceProvider v2 · age unknown" and never contains "0s".

### M3 — the provenance row keeps its label
- `web/lib/trust.ts:170-176` — warn arm: `label: "Price provenance"`, `detail: "<clauses> · not oracle-direct[; <unrecognised clauses>]"`.
- Re-pinned: `tests/unit/trust.spec.ts:63-71` and `:118-136` (uncapped feed, adapter output on one and two inputs, a ratio reference, a caveat beside an unrecognised word).

### M6 — `horizonLabel`, integer arithmetic only
- `web/lib/address-stress.ts:113-128` `horizonLabel(seconds)`: every quotient is an exact division of a multiple (`(s − s % UNIT) / UNIT`), never a rounded float: "3h", "30d", "1d 12h", and minutes under an hour ("30m"). `StressTable.tsx:2,53,69` imports it; the local `days()` is gone.
- Pins: `tests/unit/address-stress.spec.ts` "horizonLabel: …" — 10 800 → "3h", 2 592 000 → "30d", 129 600 → "1d 12h" (and never "2d"), 1 800 → "30m", 86 340 → "23h", 7 776 000 → "90d".

### M7 — `engineName` compares against `CASH`
- `web/lib/inspector-headline.ts:44-45` (`CASH` imported from `inspector-position`).

### M8 — dead exports dropped
- `export` removed from `ACTION_LABEL` (`activity-rows.ts:12`), `UNREADABLE_SCALE` (`money.ts:7`), `RECENT_KEY` (`recent-lookups.ts:6`). No test imported any of the three (grepped `tests/`, `app/`, `lib/`), so all three were un-exported.

### M9 — no `batchId ?? 0`
- `web/app/inspector/[addr]/HistoryCard.tsx:18-23` — `xLabels` is built only when the series has a first point and a newest point; otherwise no `xLabels` is passed.

### M12 — comments and titles state the law, not the round
- Rewritten: `room-history.ts:9-16` header, `activity-rows.ts:105` ("(r74)" dropped), `inspector-position.ts` boundary comments (the two "p0-9"/"p0-8" prefixes), `trust.ts:6` ("held since the review round"), `[addr]/page.tsx:22` ("plan 2 Task 11").
- Retitled: `inspector-headline.spec.ts:117` ("fix round 1 — …"), `address-stress.spec.ts:64` ("fix round 1: …"), `inspector-position.spec.ts:175` ("review round: …") plus its "p1b-4"/"p0-8"/"p0-9" comments, `room-history.spec.ts:86` ("review round: …"), `activity-rows.spec.ts:34` ("fix round 1: …") and its "r74"/"Task 12" comment block and describe title, `trust.spec.ts:83` ("Fix round 1").
- Sweep (`round|p0-|p1b-|r74|r77|Task |review`) over Plan 2's lib, app, kit and spec files: the only remaining hits are the word "rounding" in `horizonLabel`'s prose ("never a rounded float"), which is arithmetic, not a review round. Pre-existing files (`history-series.ts`, `wireGuard.ts`, `inspector-evidence.spec.ts`, …) still carry `p0-`/`p1b-` words and were left alone, as ruled.

## Deviations from the rulings (each deliberate, none silent)

1. **M6 has a fourth arm.** The ruling names three (hours under a day, whole days, a remainder); a sub-hour horizon would otherwise print "0h", so minutes under an hour ("30m") is a fourth arm, pinned.
2. **I2 carries the load phase on the view.** For `historyFinding(view)` to be pure over the view it needs the history request's phase and error message, so `InspectorView` gained `historyLoad` / `stressLoad` (`LoadPhase`, the reading's phase without its value) — not a new page state. `stressEmptyText(view)` was added beside it so `StressTable` reads only the view (the review's "history/stress finding sentences").
3. **I1's cause names the wire field.** "the engine published an unreadable value scale (value_decimals) for this account" — the ruling asked for the name; it rides in parentheses after plain words.
4. **M1's exact register carries no "$"** and uses `formatUnits`' ASCII "-" for a negative room — the same register the drawer's "Exact wire values" section already prints.
5. **I4's `groupInt` accepts a bigint** as ruled; nothing in the tree passes one yet.

## Concerns

1. **The two screenshot pins passed instead of failing, and the run wrote two files into the controller's snapshots directory.** Only `book-*`/`overview-*` baselines are committed; the controller's uncommitted `screenshots.spec.ts` added the inspector page and no `inspector-*.png` existed before the run. Playwright's default `updateSnapshots: "missing"` therefore wrote `web/tests/e2e/screenshots.spec.ts-snapshots/inspector-dark.png` and `inspector-light.png` (captured from this commit's build — post-I5) and passed. They are untracked and were NOT staged. My attempt to remove them was denied by the permission classifier, so they are still in the working tree: the controller should delete or adopt them.
2. **The stale `next start` (PID 95220) on :3111 was stopped** as instructed; the suite ran on Playwright's own `npm run start` of the fresh build, which it tore down afterwards.
3. `web/tests/e2e/screenshots.spec.ts` and `.superpowers/sdd/.gitignore` remain modified and uncommitted (the controller's); untouched.
4. `InspectorSurface.tsx` still hands the activity table the raw `cashWire.value_decimals` / `legacy.value_decimals` (that path guards its own scale in `activity-rows.ts`); it was outside the rulings and left as is.
