# Task 11 review — the Scenarios page (commit ff78ac6, parent 6855c01)

Read-only review of `review-6855c01..ff78ac6.diff` (17 files) against the Task 11 brief, the plan's Global Constraints and R1–R16, and the test-id contract table. Every claim below carries a file:line trace into the diff or the lib it composes. I did not run the suite, the build or the screenshots; the report's gate results and the look are taken as stated and listed under "not verified".

Verdicts: **spec ✅** (every named component and contract id present; the laws traced) · **quality: Approved with four plan-mandated Importants** (controller rulings, not implementer defects) and one implementer deviation rated Minor because it is unreachable on the page as built.

---

## Spec Compliance

### Files the brief names

| Brief | Diff | Verdict |
|---|---|---|
| Rewrite `page.tsx`, `lab.module.css` | `page.tsx` 2069–2118 (Suspense + `LabSurface`, title "Scenarios"); `lab.module.css` 894–2032 (1117 lines removed, 17 added, tokens only) | ✅ |
| Create `LabSurface`, `money`, `LabTiles`, `TransitionCard`, `MoversTable`, `LegacyResult`, `AssumptionsDrawer`, `AddressWorkspace`, `StaleBanner` | all nine present (115–893, 2033–2068) | ✅ |
| Modify `InspectorSurface` (secondary → `/lab?address={addr}`), `StressTable` (link → `/lab?address={addr}`), `screenshot-pages.mjs` | 55–56, 82–83, 2288–2289 + 2311–2314 | ✅ |
| Not in the brief: `ScenarioLibrary.tsx`, `kit.module.css`, `inspector.module.css` | rulings 1–3 of the report; all three in the ledger (progress.md:114, 116) | ✅ recorded |

`LabClient` is no longer imported (`page.tsx` 2075 removed); the old Lab files stay for Task 12 as the brief says.

### Test-id reconciliation (contract table, plan §"Test ID contract")

| Contract id | Where in the diff | Status |
|---|---|---|
| `lab-surface` + `data-mode` / `data-state` / `data-banner` | LabSurface 485–491 (`data-state` = `book.state` or `space.state`; `data-banner` = `book.banner ?? undefined`) | ✅ |
| `lab-library` | LabSurface 495 (`testId="lab-library"`) | ✅ |
| `lab-library-row-{id}` + `data-outcome` | kit `ScenarioLibrary` (unchanged, Task 1) | ✅ |
| `lab-library-check-{id}` | kit, book mode only (contract: "no library checkboxes" in address mode, R15) | ✅ |
| `lab-mode-book` / `lab-mode-address` | kit | ✅ |
| `lab-run` | kit 2182–2192, rendered only when `run` is passed; LabSurface 529–539 passes it in book mode only | ✅ with ruling 1 (address mode has no `lab-run`; the contract table's "footer `lab-run`" needs Task 12's wording "book mode only") |
| `lab-compare` | `compare={null}` (LabSurface 540) — Task 13 | expected absent |
| `lab-address`, `-input`, `-inspect`, `-refused` | LabSurface 516–526 (`AddressField testId="lab-address"`); the kit emits the suffixes | ✅ |
| `lab-verdict`, `-headline`, `-dek`, `-identity`; chips `data-chip` | LabSurface 559–566 and AddressWorkspace 168–183 via `VerdictHeader.sub()`; `IdentityChips` sets `data-chip` | ✅ |
| `lab-projection` | LabSurface 337–341, in the kicker of both modes (448–463) | ✅ |
| `lab-banner` + `data-kind`, `lab-banner-rerun` | StaleBanner 790–792 | ✅ |
| `lab-kpi-{newly,debt,baddebt,moved}` + `data-tone` | LabTiles 656/666/676/684 with `testPrefix="lab-kpi"` (LabSurface 592); `KpiTile` sets `data-tone` | ✅ |
| `lab-transitions`, `lab-heatmap`, `lab-heatmap-cell-{from}-{to}`, `lab-transitions-finding`, `data-merged` | TransitionCard 854–855, 872, 881–882 (`cellTestIdPrefix` → `${prefix}-${r}-${c}` in kit `Heatmap.tsx:50–53`); `data-merged` from the kit | ✅ |
| `lab-movers`, `lab-movers-row-{addr}`, `lab-movers-caption` | MoversTable 763, 748, 766 | ✅ |
| `lab-legacy`, `lab-legacy-kpi-*`, `lab-legacy-heatmap` | LegacyResult 714, 717, 718 | ✅ |
| `lab-drawer`, `lab-drawer-body` | LabSurface 573; AssumptionsDrawer 230 | ✅ |
| `lab-address-tiles`, `lab-address-kpi-{debt,cap,room,status}-{before,after}`, `lab-address-table` | AddressWorkspace 184, 144, 200 | ✅ |
| `lab-compare-card`, `lab-compare-row-{id}`, `lab-dotplot` | Task 13 | expected absent |
| `lab-deeplink-notice` | LabSurface 551 | ✅ |

Ids the diff adds that the table does not name (all additive; the plan's own e2e text already uses the first two): `lab-drawer-transitions-note` (AssumptionsDrawer 281), `lab-address-section` (AddressWorkspace 198), `lab-movers-table` (MoversTable 765), `lab-legacy-transitions` / `lab-legacy-transitions-finding` / `lab-legacy-heatmap-cell-*` (LegacyResult 718 via the card's defaults). None collides. One hazard for Task 12's selectors: the `lab-address-` prefix is shared by the field (`lab-address-input`) and the workspace (`lab-address-tiles/table/section`), so `[data-testid^='lab-address-']` is ambiguous; exact `getByTestId` is fine.

Contract ids the diff lacks: none besides the two Task 13 groups and `lab-run` in address mode (ruling 1).

### The surface derives, it does not decide

- ✅ Book workspace: every headline, dek, kicker, chip, state, banner, skew comes from `deriveLabView` (LabSurface 376–378, 559–566, 580–588). Address mode: `useAddressLookup` → `deriveInspectorView` → `addressWorkspace` (381–391) — R8's exact chain, no second stress reader (the only `address-stress` import is `horizonLabel`, AddressWorkspace 125).
- ✅ No `Number(`, `parseFloat`, no `BigInt` on a wire string anywhere in `app/lab`. The one `BigInt(` is `money.ts` 2064 (`10n ** BigInt(decimals)`) after `isWireScale` (2061) — a register, not a reading. The drawer prints wire decimals only through `isWireDecimal` (AssumptionsDrawer 224). Floats appear once, `heatIntensity` for cell opacity (TransitionCard 820) — geometry only.
- ✅ No comparison of wire strings. The comparisons that exist are on lib-derived bigints/ints for TONE only (`r.newly > 0`, `r.deltaEligibleDebt > 0n`, LabTiles 662/672/680) — the plan's own lines; presentational, but see Minor 4.
- ⚠️ Sentence-building in the surface, all of it in the plan's own code: `refusedWord` (LabTiles 621–634), `finding`/`words` (TransitionCard 824–849), the address kicker "Account … · Cash" (LabSurface 453–459), the applicability words (LabSurface 473–479), the library empty/loading text (541–545), StaleBanner's two sentences (785–788), the drawer's headings. Plan-mandated; the two that mislead are Importants 1 and 3.

### R7 — the deep-link law, exactly

- Cold `/lab`: `decision.kind === "none"` → the effect's two `if`s (LabSurface 424–435) match neither; nothing dispatched; `deriveLabView` selects `listing.scenarios[0]` (lab-view.ts) → `not-run` with the definition and its chips. ✅
- `?scenario=x` listed → `reading.run(x)` once (424–429). `?scenario=ghost` → `listed.includes` false → nothing runs, no notice (the plan's e2e at §Task 12 expects exactly that). ✅
- `?scenarios=a,b` → `runSet(decision.runIds)` when `!overCap && runIds.length > 0` (430–435); filtered ids named by `decision.notice` (409–413). ✅
- Both present → `kind: "conflict"` → no branch dispatches; the notice renders (550–553). ✅
- `?address=` → `mode` initialised to `"address"` (363–365), `address` state from the param (373); an invalid `?address=0xnope` yields `lookupFor = ""` (381) so nothing is fetched and `deriveInspectorView` says `invalid` → `space.state = "invalid"` (lab-address.ts). ✅
- No auto-run on a listing that answers late: `decision` is null until `listing.phase === "ready"` (401–408), so the effect cannot dispatch before the listing. ✅

### `?scenarios=` pre-ticked in the `useState` initializer (LabSurface 369–372)

Honest for an unlisted id: `libraryRows` maps the listing (lab-library.ts:92–105), so an unlisted id has no row and no checkbox; `deriveLabView` filters `checked` to listed ids (`listing.scenarios.map(s => s.id).filter(id => ui.checked.has(id))`, lab-view.ts), and the Task 13 brief's Compare reads `view.checked` (task-13-brief.md:92–94), so a stale tick cannot leak into a set POST. Two arms differ from the plan's effect, which ticked only what dispatched: the conflict case still ticks the `?scenarios=` ids (symmetric with the plan's own `selectedId` init from `?scenario=`, 366–368), and the over-cap case ticks more than `MAX_SET_RUN_SCENARIOS` (Task 13's button must refuse; `runBookSet` has a `refused-locally` arm). Minor 13.

### The "Computed" chip (LabSurface 394–397, 438–445)

Anchored to the result's receipt: `resultReceipt(identity, 0)` → `receiptIdentity(servedAt, batchId)` (resultIdentity.ts:180–182); the hook re-anchors on `receiptId` (live-age.ts:392). ✅ anchored. ❌ honest only at the instant of settle — see Important 2.

### Address mode's `outcome` override (LabSurface 469–482)

The plan's line 175 verbatim in substance. It is a lib concern: it classifies (`space.rows.some`) and writes copy, and the word it writes is wrong for a row the engine marked `applicable: false` — see Important 4. The composition should map a field `lab-address` (or `lab-library`) already decided.

### The honest-UI laws, traced

- Refusal never a zero: tiles print `—` + the state word (LabTiles 651–652, 658, 668, 678, 687); the heatmap placeholder is a sentence (TransitionCard 884–890); the movers section is absent without a result (LabSurface 595); the address tiles print `—`/refused when `tiles` is null (AddressWorkspace 143–145); the address table's not-applicable cell prints the reason (163). Three places still print a zero or an empty listing for an unknown — Importants 2 and 3, and the legacy card's wrong engine word (Important 1).
- Engines never summed/beside: `LegacyResult` reuses `LabTiles` and `TransitionCard` with the legacy reading's own `decimals` inside a `<details>` (LegacyResult 714–721); no cross-engine arithmetic anywhere. ✅
- PROJECTION on every shocked figure: the kicker carries the pill in both modes (LabSurface 448–463); projection rows in the address table carry their own (AddressWorkspace 154–156). ✅
- R11 money: tiles `bookMoney`/`signedBookMoney` (LabTiles 648–649); heatmap titles `bookMoney` (TransitionCard 813); movers rows are the lib's `humanUsdFull` strings (MoversTable 756–758); address tiles are `lab-address`'s `humanUsdFull` values; the address table `accountMoney` (AddressWorkspace 140); the drawer `wireExact` (AssumptionsDrawer 276–278). ✅ Every scale through `isWireScale` (money.ts 2052, 2061).
- R13: the banner sits above tiles that keep rendering the result (LabSurface 580–594); `data-banner` on the root (490); `Run again` disabled while running (586). ✅
- R10: the drawer prints path assumption, applied shocks with the three flags, held flat, out of model, identity incl. `scenario_config_version`, exact wire values of the four tiles, the lane note verbatim, the wire's notes verbatim (AssumptionsDrawer 235–290). ✅
- R14: not-run/running headlines come from `lab-headline` with the refused tone; the surface passes `book.headline.tone` through (LabSurface 564). ✅
- Copy from `lab-headline`/`lab-view`: all headline/dek/kicker/chip text in book mode is the lib's; the address-mode headline/dek is `lab-address`'s. ✅ (surface-owned extra copy noted above.)
- Type tokens: every `font-size` in the 17 new CSS lines is `var(--type-*)` (lab.module.css 1127–1137; kit 2227). ✅

### React correctness

- Effect deps `[decision, reading, single]` (436): `decision` is a new object on every render once the listing is ready (`deepLinkDecision` returns fresh) and `reading` is a new object literal every render (lab-reading.ts `return { listing, runs, set, run, runSet, reloadListing }`), so the effect runs after every render. The `decided` ref (414, 416–422) makes the dispatch exactly once; it cannot run before the listing (`decision === null` until `ready`); under StrictMode's simulated remount the ref survives, so no double dispatch; `reading.run`/`runSet` guard in-flight anyway (`canDispatch`). Dispatches: once, never twice, never early. ✅
- `router.replace` (497–503, 520–525): `?address=` round-trips (`?address=X` → mode address, `address = X`, `AddressField initial={address}`; Inspect writes it back); switching to book deletes the param and `labUrl` collapses to `/lab` when nothing remains (352–355); `?scenario=`/`?scenarios=` survive the toggle and `decided` prevents a re-dispatch when `params` changes. ✅ The state mirrors the URL rather than deriving from it — drift only on a manual URL edit inside the mounted page (Minor 7).
- `Suspense` around `useSearchParams` (page.tsx 2114–2116). ✅
- No `setState` inside the effect (415–436): only the hook's dispatchers are called. ✅
- No stale closure over `definition`: every closure is rebuilt per render; the banner's `onRerun` is inside the `definition !== null &&` guard (580–588). ✅
- `useAddressLookup(lookupFor)` flips between `""` and the address on every mode toggle, so each return to address mode re-fetches the lookup (Minor 6).

### The four rulings

1. **Run slot optional** (kit 2135–2136, 2180–2205; LabSurface 529–539). Sound: the plan's "Run against this address" with a no-op `onRun` was a dead button, and the field's Inspect is the action. Minimal: one prop made optional, the footer gated on `run !== undefined || compare !== null`. The contract table needs "book mode only" (Task 12). ✅
2. **`.libAddress .searchIn` + hidden hint** (kit 2249–2251). The field's `min-width: 320px` (kit:137) overflows a 300 px column; the override is two declarations scoped to the library. The `<small id={hintId}>` under `display: none` is still directly referenced by the input's `aria-describedby` (AddressField.tsx), and the accessible-name computation traverses a hidden node when it is directly referenced by `aria-describedby`, so assistive tech still receives "any 0x address" while the placeholder stands in visually. Honest and minimal. ✅ (A `compact` prop on `AddressField` would be the kit-clean form; not required.)
3. **`kit.kickAddr`** (kit 2226–2227; inspector.module.css 104 removed; InspectorSurface 43; LabSurface 455). The rule moved byte-identical; both users switched; the lab kicker wraps `truncateAddress(space.address)` in it. ✅
4. **`heat: HeatmapView`** (LabTiles 650, 692; TransitionCard 840, 862, 874–883). Consumed directly and correctly. Residue: LabTiles' `heat === null ? "movement not readable"` is unreachable (`heat` is null only when `r` is null, and then `sub()` returns the state word) — Minor 1.

### The Inspector retargets and the old pins

- `InspectorSurface` 56: `/lab?address=${addr}` — the route's own address, gated on `view.cash !== null` as the brief asked. ✅
- `StressTable` 83: `/lab?address=${view.cash.account}` — the WIRE's account (`CashPosition.account` = `position.account`, inspector-position.ts:69), `/lab` when there is no Cash position. Correct in substance; no address-binding check exists in `inspector-view.ts`/`address-lookup.ts`, so the two links on one Inspector page can carry two spellings of one address if the wire returns another case. Minor 15 — thread `addr` as the brief's fallback suggested, or leave.
- Pins Task 12 must re-express, from `grep tests/`: `tests/e2e/inspector.spec.ts:92` asserts the secondary `href="#stress"` → `/lab?address=${DEMO_NEAR_ADDR}`. There is NO pin on the "Open Scenarios →" href anywhere in `tests/` (the Task 12 brief line 449 says "likewise" — nothing to re-pin; `inspector.spec.ts:256`'s `id="stress"` still holds). Every other `/lab` reference is the old Lab's own suite: `lab.spec.ts` (30), `state-matrix.spec.ts` (4), `w3l-slots.spec.ts` (1), `book-charts.spec.ts:66–68, 147` (uses `lab-address-input`), `r1-fixes.spec.ts` (5), `r10-fixes.spec.ts` (4), `shell.spec.ts` (1) — all named in the Task 12 brief's Modify/Delete lists. **Not named in the Task 12 brief** and referencing `/lab` + old ids (`lab-address-input`, `lab-address-mismatch`): `tests/e2e/p0-fixes.spec.ts` (8 `/lab` gotos: 68, 111, 205, 229, 257, 333, 374, 416), `tests/e2e/p1b-fixes.spec.ts` (10: 131, 244, 278, 326, 515, 587, 628, 674, 730, 801), `tests/e2e/r11-fixes.spec.ts` (2: 75, …). Task 12's dispatch should add those three files to its mapping or they stay red after the contract lands.

---

## Strengths

- A genuinely thin composition: 306 lines of `LabSurface` and not one state decided twice; every figure, word and tone in book mode traces to `lab-view`/`lab-headline`, every address figure to `lab-address` over the Inspector's own chain (R8 exactly as written).
- The deep-link effect is the right shape: decided from the listing at render, dispatched once behind a ref, never before the listing answers, no `setState` in the effect, StrictMode-safe.
- Ruling 1 removed a dishonest control the plan had drawn (a button that did nothing) with a one-prop kit change rather than a page hack.
- `money.ts` gives the page exactly three registers, each behind `isWireScale`, and the drawer's `wireExact` prints the integer at its scale with grouping and the typographic minus.
- The contract table is fully realised, additive ids only, and the Task 1 carry-note (`.libCol` wrapping the library fragment so the grid has one item) was honoured (LabSurface 493, css 1125).
- The kit's CSS gained nothing page-specific except the two declarations the 300 px column needed; every new rule is tokens.
- The Inspector loses a duplicated rule (`kickAddr`) rather than gaining one.

---

## Issues

### Critical

None.

### Important

**I1 — The transition card names "the Cash book" for whichever engine it is given; the legacy fold inherits the wrong engine word.** `TransitionCard.words()` (TransitionCard 836–849) returns "Withheld: the Cash book was not computed under this scenario." / "This scenario does not model the Cash book." for any `EngineReading`, and `LegacyResult` (718) passes `book.legacy`, which `readEngine(run, LEGACY, def)` returns as `withheld` when `excluded_engines` names the legacy engine or its row is missing (lab-engine.ts:55–58), and as `contradictory`/`unreadable` on its guards. Under those readings the legacy card states a fact about the Cash book. (The not-covered arm is unreachable for legacy because `lab-view` nulls `legacy` when the definition lacks it; withheld and contradictory are reachable.) **Plan-mandated**: the brief's line 335 carries the same sentences and the same reuse. Controller ruling. Fix: an `engine` word prop on `TransitionCard` (the legacy reading already carries `cause` with `engineName`), or the refusal sentences from `lab-headline` keyed by engine; the tiles' `refusedWord` (LabTiles 621–634) is engine-neutral and needs nothing.

**I2 — "Computed … ago" prints a zero for an unknown age and re-anchors at zero on every selection change.** `humanAge(age.seconds ?? 0)` (LabSurface 440) prints "0s ago" when `age.seconds` is null and ignores `age.unresolved`, which `live-age.ts:94` says "MUST NOT BE RENDERED AS THE AGE" while true. Separately, `resultReceipt(identity, 0)` (396) tells the hook the result is 0 s old at anchor time, and the hook re-anchors whenever `receiptId` changes (live-age.ts:392): select scenario A (settled minutes ago) after B and the chip reads "Computed 0s ago". **Plan-mandated**: brief lines 131 and 152 are the same two expressions. Controller ruling. Fix: (a) `age.seconds === null || age.unresolved` → a refused chip ("age not known"); (b) the anchor's wire age should be the time since the record settled — `RunRecord.settled.at` exists (lab-reading.ts `withSettled`) but `BookWorkspace` does not expose it; add `settledAt` to `lab-view`'s book and pass `resultReceipt(identity, (now − settledAt) / 1000)` at anchor, or derive the chip from `settledAt` and a ticking `now` without the receipt hook.

**I3 — A failed listing renders as an empty listing.** `emptyText={book.state === "listing-loading" ? "Loading the committed scenarios…" : "No committed scenarios are listed."}` (LabSurface 541–545): in `listing-unavailable` the library says none are listed while the workspace headline says the listing could not be loaded. A refusal shown as "nothing". **Plan-mandated**: brief line 202 is the same ternary. Controller ruling. Fix: branch on `view.listingLoad.phase === "error"` → "The listing could not be loaded." (one line; the sentence could come from `lab-headline` like the headline does).

**I4 — The address-mode library word contradicts the row's own `applicable` flag, and the row claims `not-run`.** LabSurface 473–479 prints "Applies to this address" for every id present in `space.rows`, but a `StressRow` can be `applicable: false` with the engine's `reason` (address-stress.ts:38–39); such a row reads "Applies to this address" in the library and "not applicable: reason" in the table beside it. The override also stamps `data-outcome="not-run"` on rows the stress response did evaluate. The demo has no inapplicable row, so the look could not show it. **Plan-mandated**: brief line 175 is the same map. Controller ruling — and the answer to the report's concern 2: yes, this belongs in a lib. Fix: `lab-address` (or `lab-library`) derives the address-mode outcome per listed id — applies / not applicable with reason / not on this address — with its own keys; the surface maps a field.

### Minor

1. `LabTiles` 692: `heat === null ? "movement not readable"` is dead since `heat: HeatmapView` (ruling 4); drop the arm or read `r.heat.improved` directly.
2. `askedIds` (LabSurface 343–350) re-implements `deepLinkDecision`'s param parsing minus the dedupe; export the parser from `lab-deep-link` and use it (one law, one place).
3. `screenshot-pages.mjs` 2311: "(Task 10's demo bodies)" — the constraints ban task numbers in shipped code; reword to "the demo bodies".
4. Tone thresholds (`r.newly > 0`, `> 0n`; LabTiles 662/672/680) are the surface deciding crit/warn; `lab-view` could carry a `tone` per figure. Plan-mandated; note only.
5. The "Computed" chip is spliced by index (`slice(0, 2)`, LabSurface 445; report concern 3); insert after the chip labelled "Scenario" or let `lab-view` emit the chips with a `computed` slot so the strip cannot drift when the lib reorders.
6. `lookupFor` (LabSurface 381) is `""` in book mode, so every return to address mode aborts and re-fetches the lookup (the plan's e2e counts lookups); `isAddress(address) ? address : ""` regardless of mode keeps the Inspector's reading alive across the toggle.
7. `mode`/`address`/`selectedId` mirror the URL in state (363–373) and are re-written with `router.replace`; a manual URL edit inside the mounted page desynchronises them. Deriving mode and address from `params` (with the field as the only writer) is the single source of truth. Low reach.
8. Report concern 1: the address table prints a negative room as "−$1,069" (AddressWorkspace 158–162, `accountMoney`) beside a tile that says "over cap by $1,069" (`lab-address` `roomWords`). Export `roomWords` from `lab-address` and use it in the table (and, when Plan 2 is next opened, in the Inspector's `StressTable`, which prints the same "−$").
9. Test-id prefix sharing (`lab-address-input` vs `lab-address-tiles/table/section`) — exact ids only in Task 12.
10. "Open in the Inspector →" only in `state === "rows"` (AddressWorkspace 177); a `no-position`/`withheld`/`unavailable` address is still a valid address the Inspector explains. Gate on `isAddress(space.address)` instead.
11. Drawer keys `${asset}-${chain_id}` (243, 256) and `key={o}` / `key={n}` (265, 288) collide on duplicate entries; index-suffix or the wire's own identity.
12. The deep-link notice is derived from the live listing on every render (LabSurface 401–413) and `dispatchNotice` (lab-deep-link.ts, "must not flip that record into a false present-tense statement") is unused; the plan's version froze the present-tense sentence at dispatch, which also dropped `dispatchNotice`. Unreachable today — nothing on the page calls `reloadListing` and the listing effect keys on `epoch` only — but Task 13 (set runs, freshness) is the next consumer: if a listing reload arrives, the dispatched set's notice must be the past-tense one, which needs a slot on `SetRecord` (Task 8's hook has none). Carry to Task 13's dispatch.
13. The `?scenarios=` pre-tick also ticks in the conflict arm and past the cap (LabSurface 369–372); the plan ticked only what dispatched. Guard the initializer on `params.get("scenario") === null` if the controller wants the conflict arm to honour neither param in any UI state; the over-cap ticks are refused downstream (Task 13's button, `refused-locally`).
14. The conflict notice ("NOTHING was run for either") stays on screen after the reader clicks Run and a result renders (the notice is keyed to the params, not to the run history); the plan's stored notice had the same persistence. Consider hiding it once `reading.runs.size > 0`.
15. `StressTable` 83 links the wire's `view.cash.account` while the toolbar's secondary (InspectorSurface 56) links the route's `addr`; with no binding check in `inspector-view`, the two can differ in case. Thread `addr` (the brief's fallback) or leave with this note.
16. The address-mode kicker copy ("Account … · Cash", LabSurface 453–459) and `finding()`/`cellsOf()` (TransitionCard 812–834) are pure copy/derivation living in components; `lab-address` could carry `kicker`, `lab-transitions` the finding sentence and the cell view, so the unit project pins them without importing from `app/`. Plan-mandated placement; note only.

---

## Assessment

**Spec: ✅.** Every component the brief names exists, every contract id is present with the right attributes, the three extra files are the ledger's rulings, and the honest-UI laws trace cleanly through the composition: nothing dispatched cold, the three deep-link arms exact, the address mode on the Inspector's chain, the two engines never beside each other, every scale guarded, money in its three registers, the PROJECTION pill on every shocked figure.

**Task quality: Approved**, with four Importants that the plan text mandates (I1–I4: the brief's own lines carry each of them) — controller rulings rather than implementer defects, and each is a one-branch fix (I1 an engine word; I2 a refused chip plus a `settledAt` on the view; I3 one ternary; I4 a lib field the surface maps). The implementer's own deviations from the plan are sound: the derived deep-link decision with a ref-guarded dispatch is correct React (exactly one dispatch, never early), the optional run slot removes a dead control, the kit overrides are minimal and the hidden hint stays honest for assistive tech. The one implementer-originated design gap (Minor 12, the notice re-derived from a live listing while the lib's `dispatchNotice` goes unused) is unreachable on this page and is best carried into Task 13's brief where the set record could gain the slot. Task 12's brief also needs three more old spec files (`p0-fixes`, `p1b-fixes`, `r11-fixes`) added to its mapping, and its "Open Scenarios →" re-pin has nothing to re-pin.

**Not verified from the diff:** the gates (typecheck, lint, stylelint, build, the 1246 unit passes) and the four screenshot states are the report's word; the existence of `react-hooks/set-state-in-effect` in `eslint.config.mjs` (the implementer's stated reason for the render-derived decision; a grep of the config did not surface the rule name — it may come through the plugin's preset); Next.js `router.replace` cost on a static route (an RSC refetch per search-param change is possible; not a correctness matter); real screen-reader behaviour of the `display: none` hint (reasoned from the accessible-name computation, not tested).

---

## Re-review 1 (d3d56ab, 853236d)

Scope: fix round 1 against Importants I1–I4; package `review-91e68ba..853236d.diff` (net +114/−43 over 14 files; `git diff --stat 91e68ba..853236d` agrees — 14 files, 114/43 — so the reflow-and-restore pair nets to the review surface). Read-only; the suite was not run and this round's gates are not stated in the commit message.

### Per ruling

**I1 — ADDRESSED.** `TransitionCard` takes `engine: string` and `words(reading, engine)` names it through `engineName` (TransitionCard diff 263–273): "Withheld: {name} was not computed under this scenario." / "This scenario does not model {name}." `LabSurface` passes `CASH` (184), `LegacyResult` passes `LEGACY` (222); `engineName` yields "Cash" / "Aave v3 market (legacy)" (inspector-headline.ts:44–48). The legacy fold no longer speaks of the Cash book. No contract pin carries the old sentence (the plan's e2e text does not pin `lab-transitions-finding` in a refused state), so nothing in Task 12 goes stale from this.

**I2 — ADDRESSED in the anchor, one residual in the reading (R1 below).** Trace:
- The number: `resultReceipt(identity, book.run.batch.age_seconds, book.receivedAt)` (LabSurface 70–72) — the wire's own batch age (42 in the demo), the same source the old `LabClient` anchored (`LabClient.tsx:182–185`), so the chip's meaning matches the app-wide "Computed" chip (the batch's age). Receipt only with an identity, a run and a `receivedAt` (all three set together in `resultBook`, lab-view 594–611).
- The clocks: `withSettled(..., Date.now(), monotonicNowMs())` in the settle callbacks (lab-reading 499, 505), never in render; `RunRecord.settled` carries `at` + `atMonotonicMs` (lab-library 424); `bookOf` hands `{ wallMs: record.at, monotonicMs: record.atMonotonicMs }` to `resultBook` (lab-view 634); the pure lib calls no clock.
- The hook: `receivedAtMs`/`receivedAtWallMs` destructured to primitives (live-age 660–661) so the per-render `receivedAt` object cannot re-anchor; `anchorWireAge(wireAgeSeconds, receivedAtMs ?? monotonicNowMs(), receivedAtWallMs ?? wallNowMs())` (684) — a re-selected older result anchors at its settle clocks, a fresh result's settle clocks are "now" so it anchors as before; callers without the fields (Inspector, Book) pass nulls and see no change; deps `[wireAgeSeconds, receiptId, receivedAtMs, receivedAtWallMs]` (707) are all stable primitives of one record.
- The resume tracker: `lastResume` is set to the anchor's clocks (693), so on the next lifecycle signal `shouldReconcileOnResume` measures `max(now − settle_mono, wall − settle_wall)` (freshness.ts:514) — both anchors moved together, the two clocks agree, `isBlindResume(proven, true)` is false: a bare `focus` after re-selection yields one harmless recompute, a proven return yields a reconcile whose wall-derived age already covers any sleep (`anchoredAgeSeconds` takes the max, freshness.ts:172–174). No false sleep, no missed one.
- The pin: `result-identity.spec.ts:202–213` asserts fields with `toBe`, never the object shape; the conditional spread (resultIdentity 758–760) also keeps a two-argument call's object free of `undefined` keys. Both existing calls (`LabClient.tsx:182`, two-arg) still type.
- The chip (LabSurface 98–109): absent while `age.seconds === null` (no receipt), "age unknown" warn while `unresolved`, else `humanAge(age.seconds) ago` — honest in all three readings; the splice by index is unchanged (Minor 5 stands).

**I3 — ADDRESSED.** `emptyText` prints `book.headline.emphasis` in `listing-unavailable` (LabSurface 159–160) — "The committed scenarios could not be listed." (lab-headline.ts:163–164), the sentence the workspace already carries.

**I4 — ADDRESSED as ruled, one residual (R2 below).** `rowOutcome(row)` lives in `lab-address.ts` (401–406) and the surface maps `space.rows.find(...)` through it (LabSurface 136), so `data-outcome` now carries a true key (`not-covered` / `withheld` / `result`) and the inapplicable row prints the engine's reason. The pin (lab-address.spec 799–809) bites: every expected triple differs from the old surface's `{ key: "not-run", text: "Applies to this address" | "Not on this address", tone: "dim" }`, and the function did not exist before. Task 12 carry: the contract text "Applies to this address" (plan line 4991; task-12-brief.md:373) is now "Becomes liquidatable" for `eth_minus_30` on the demo near address (`flips === true`).

### Residuals

**R1 (Important, I2's reading) — for up to `AGE_TICK_MS` = 60 s after re-selecting an older result, the chip shows the raw wire number, not the elapsed age.** The hook's render arm returns `wireAgeSeconds` whenever the committed `live` reading belongs to another receipt (live-age.ts:717–720), and the only `reconcile()` calls are the 60 s interval and the lifecycle/retry paths (live-age.ts:334, 360) — there is no reconcile at anchor time. That arm was written for a first-sight anchor ("correct at receipt", the hook's own comment); with the anchor now in the past, select A (settled six minutes ago) after B and the chip reads "Computed 42s ago" for up to a minute before jumping to "6m 42s ago". Fix inside the hook, small: when `receivedAtMs !== null` schedule an immediate reconcile through the same non-synchronous path the lifecycle handler uses (a zero-delay timer cleared in the teardown), or seed `live` from the anchor on that first schedule; pin it in `tests/unit/freshness-receipt.spec.ts` (a receipt with a past `receivedAtMs` renders the elapsed age before the first tick).

**R2 (Important, I4's word) — `rowOutcome` prints a verdict word from `flips` without the gates `rowHeadline` applies.** `flips` is computed from the spot verdicts alone (address-stress.ts:73–76) and never from the projection's horizons or the figures' readability. `rowHeadline` (lab-address.ts) refuses any verdict word when either side is not `computable` and judges a projection row by its horizons — the law Task 6's three re-review rounds closed. `rowOutcome` skips both: a projection row whose 30 d horizon is liquidatable prints "Stays inside its cap" (ok) in the library beside a workspace headline "becomes liquidatable within 30d" (warn); a row with an unreadable side and a boolean `flips` prints "Becomes liquidatable" (crit) beside "Cannot say" tiles — two verdicts on one screen, the class the first law forbids. Fix in the same file: one verdict judgement shared by `rowHeadline` and `rowOutcome` — the `computable` gate first (→ "Cannot say" refused), then the projection arm (an unknowable horizon → "Cannot say"; a liquidatable horizon → "Becomes liquidatable within {horizon}" warn; else "Stays inside its cap" ok), then `flips`; two pins (a projection row with a liquidatable horizon; a negative spot side with `flips: true` → "Cannot say").

### Minor (new this round)

- `lab-reading.ts` 450: `import { monotonicNowMs } from "./freshness"` sits after `./lab-library` — out of alphabetical order if the lint config sorts imports; this round's lint is not stated.
- "Withheld: Cash was not computed under this scenario." reads thinner than R3's "the Cash book is withheld"; `engineName` has no article form. Wording only.

### Not verified

Typecheck/lint/build and the unit run for this round (unstated); that `RunBookResponse.batch` types `age_seconds` (the demo body carries it and the surface compiles only if the schema does).

**RE-REVIEW: open** — R1 (the pre-tick reading after a past anchor understates by the elapsed time for up to 60 s) and R2 (`rowOutcome` prints verdict words `rowHeadline` refuses: projection horizons and uncomputable sides ungated).

---

## Re-review 2 (e695cc1)

Scope: fix round 2 against R1 and R2; package `review-853236d..e695cc1.diff` (one commit, four files, +105/−46; `git diff --stat` agrees). Read-only; the suite was not run. The base for the byte comparison is `git show 853236d:web/lib/lab-address.ts`.

### R2 — ADDRESSED. One judgement, the old order, the old sentences.

**Order.** `rowVerdict` (lab-address diff 62–84) decides: not-applicable → the gate over both sides (`sides.some(s => computable(s) === null)`, cause `not-a-position` when a present side fails `readable`, else `withheld`) → the projection (`longest === null` → `no-horizon`; an `unknowable` horizon → `horizon-unknowable`; a `liquidatable` horizon → `liquidatable{within}`; else `inside{through: longest}`) → the spot flip (`flips === null` → `withheld`; `flips` → `liquidatable{already:false}`; `after.verdict === "liquidatable"` → `liquidatable{already:true}`; else `inside{through:null}`). That is exactly the sequence `rowHeadline` had at 853236d (not-applicable at its line 1, the gate at lines 9–16, `projectionHeadline` at 17, the three flip arms at 18–21), with `projectionHeadline`'s own internal order (no-horizon, unknowable, within, longest) preserved inside the projection arm.

**Sentences, arm by arm, old → new** (`compared` is the old `dek`; `horizonsDek` is `projectionHeadline`'s old `dek`, built from `row.projection ?? []` — the same horizons):
- not-applicable: `refused(\`${row.label} does not apply to ${short}.\`, sentence(row.reason ?? "the engine gave no reason"))` → the same with `verdict.reason` carrying the identical fallback. ✅
- gate, not a position: `${dek} The ${projected ? "projected" : "shocked"} figures are not a position.` → `${compared} The … figures are not a position.` ✅
- gate, withheld: `${dek} One side of the comparison is withheld or unknowable.` → `${compared} One side…` ✅
- no horizon: `Room today ${today}. The projection carries no horizon.` → identical (the unused `horizonsDek` for an empty projection is never printed). ✅
- horizon unknowable: `${dek} The ${horizonLabel(unknowable.seconds)} horizon carries no verdict.` → `${horizonsDek} The ${horizonLabel(verdict.horizon.seconds)} horizon carries no verdict.` ✅
- within: `${short} becomes liquidatable within ${horizonLabel(within.seconds)} under ${label}.` warn, interest dek → identical with `row.label`, `dek: horizonsDek`. ✅
- through: `${short} stays inside its cap through ${horizonLabel(longest.seconds)} under ${label}.` ok, interest dek → identical, `dek: horizonsDek`. ✅
- null flip: `refused(cannot, \`${dek} One side of the comparison is withheld or unknowable.\`)` → the `withheld` cause prints the same sentence over `compared`. ✅
- flip: `${short} becomes liquidatable under ${row.label}.` crit, `dek` → identical, `dek: compared`. ✅
- already: `${short} is liquidatable today and stays so under ${row.label}.` crit → identical. ✅
- inside: `${short} stays inside its cap under ${row.label}.` ok → identical. ✅
`cannot` and `today` are computed as before; `projectionHeadline` is gone and had no other caller. Every Task 6 headline pin reads the same bytes.

**`rowOutcome` agrees with `rowHeadline` on every kind** (diff 162–179), both speaking from `rowVerdict`: not-applicable → "Not applicable: {reason}" dim; every cannot-say cause → "Cannot say" refused (the headline's refused `cannot`); within → "Becomes liquidatable within {h}" warn (headline warn); already → "Liquidatable today and after" crit; flip → "Becomes liquidatable" crit; through → "Stays inside its cap through {h}" ok; inside → "Stays inside its cap" ok. The two rows I named: a projection with a liquidatable 30 d horizon now reads "Becomes liquidatable within 30d" warn in both places; an unreadable side with a wire `flips: true` now reads "Cannot say" in both.

**Pins bite on 853236d** (lab-address.spec diff 270–296): `rowOutcome(dm)` expects "Stays inside its cap through 90d" (old: "Stays inside its cap"); `projected(0, true)` expects "Becomes liquidatable within 30d" (old: "Stays inside its cap", the spot flip is false); the `debt_usd: "-4822000000"` row asserts `flips === true` and expects "Cannot say" (old: "Becomes liquidatable"); `{ ...eth, flips: false }` expects "Liquidatable today and after" (old: "Stays inside its cap"). Four of the new expectations fail on the old function; the rest are unchanged carry-overs.

### R1 — ADDRESSED. The immediate reconcile is off the render path and torn down with the effect.

`const immediate = receivedAtMs === null ? null : setTimeout(reconcile, 0)` sits inside the anchoring effect after the interval is armed (live-age diff 195–197) — a macrotask, so no `setState` runs synchronously in the effect and nothing runs in render; `clearTimeout(immediate)` in the teardown (219) beside `clearInterval(tick)`, so a receipt change before the task fires cancels it. `reconcile` recomputes from the anchor with the floor seeded at the wire number and commits `live` for this `receiptId` only; it touches neither the tracker nor the blind marker. For callers without past clocks (`receivedAtMs === null` — the Inspector, the Book, the old `LabClient`) no timer is created and behaviour is unchanged. One precision on "harmless for a fresh receipt": a FRESH Lab result also carries its settle clocks, so it schedules the zero-delay reconcile too; that computes wire + ≈0 and commits the same number the render arm already shows — one extra state commit, no visible change.

**The pin** (freshness-receipt.spec diff 246–250) states the pure law — `anchorWireAge(42, 1_000, 5_000_000)` read 360 s later is 402, at its own clocks 42 — and it is correct, but it does not bite on 853236d: `anchorWireAge`/`anchoredAgeSeconds` already accepted explicit clocks, and the defect was in the hook's render arm, which the unit project cannot exercise. The hook's zero-delay reconcile is therefore verified by reading only; no e2e pins the chip's value (Task 12 masks `[data-chip='Computed']`). A limitation to record, not a defect.

### Nothing else moved

Four files as listed. `RowVerdict`/`rowVerdict` are exported (a pin could read the verdict directly); `StressHorizon`, `refused`, `sentence`, `computable`, `readable` keep their uses.

### Task 12 carry

The address-mode words for the demo near address are now: `eth_minus_30` "Becomes liquidatable", `dm_rate_horizon_plus_200bps` "Stays inside its cap through 90d", `ethfi_minus_50` per its own row; the contract text "Applies to this address" (plan line 4991; task-12-brief.md:373) needs the first.

### Not verified

This round's typecheck/lint/build (unstated); that TS accepts the `break` after the exhaustive inner `switch (verdict.cause)` in `rowHeadline` without a "lacks ending return" complaint (it should — the endpoint is unreachable after an exhaustive switch — and the stated 1250 green pins imply the file compiled); the spec helpers `projected`, `withResult`, `StressBody`, `nearWith` (pre-existing from Task 6's rounds, not re-read).

**RE-REVIEW: closed.**

---

## Re-review 3 (9b23b07)

Scope: round 3, the held-result ruling out of Task 12's review (the Global Constraint "a result is never silently replaced" and the retired r8(2)/r16/r17 law win over the first C13). Package `review-18ff863..9b23b07.diff` (one commit, nine files, +133/−37; `git diff --stat` agrees). Read-only; the suite was not run. The retired law was read from `git show 9279806^:web/tests/e2e/{r8,r16,r17}-fixes.spec.ts`.

### The hold's law — complete and honest for the case it models

`heldOf(prev)` (lab-reading diff 199–203) holds a response only when the previous record is `settled` with `outcome.kind === "ok"`, else carries `prev.held`. `withRunning` stores `heldOf(runs.get(id))` (208): a running phase over an ok result holds it, over a failed-with-hold record carries the hold. `withSettled` (215) releases on ok (`held: null`) and otherwise carries `heldOf(runs.get(id))` — at settle time `runs.get(id)` is the running record, whose `held` is the hold, so any number of failures carry it and only a new ok releases it. An id never running (`heldOf(undefined)`) holds nothing. The abort path writes no record (unchanged). Complete: held only from an ok; through running and every failure; released by ok alone. ✅

### The held book keeps its own identity

`bookOf` (lab-view diff 340–344) renders a failure over a hold as `resultBook(def, configVersion, record.held.response, { held.at, held.atMonotonicMs })` — the held run's `identity` (batch, servedAt), its `receivedAt` (the hold's settle clocks), its chips ("Result for batch {held}", "Scenario", "Engines", "Config"), its cash/legacy readings and its state — then `banner: "rerun-failed"` and `rerunFailure`. `LabSurface` passes `batchId={book.run?.batch.id}` (unchanged) and anchors the Computed chip on `book.run.batch.age_seconds` + `book.receivedAt`, both the held result's. So the banner's "stands for batch N", the "Result for batch" chip and the Computed age all name the held batch, not the failed request. ✅ The unit pin checks `receivedAt`, `run`, headline, banner and `rerunFailure` (lab-view.spec diff 602–619).

### The library word agrees with the workspace

`outcomeLine` (lab-library diff 140–151): running → "Running…" (workspace: running); ok → `cashOutcome` (as before); failure with a hold → `cashOutcome(held.response)` (workspace: the held `resultBook`'s state — result / withheld / not-covered / contradictory — under the banner); failure without a hold → the failure word (workspace: the failure state). The row carries no sign of the failed attempt — a reader scanning the library sees the held word only; the banner is workspace-only. Acceptable under R12's vocabulary; noted. One arm disagrees and is R3 below.

### Running over a hold

`bookOf` renders the running phase as `emptyBook("running", …)` regardless of `held` (unchanged line 335): the held figures leave the screen under "Running {label}…" with pending tiles and return only if the run fails. That is the plan's own running arm (R7/R14: running is its own refused-tone state) and it states nothing false. It does mean the retained book is, for the run's duration, neither displayed nor disclosed — the R16 header's phrasing — which a one-line "the previous result is held" dek would cure; a design note, not a residual.

### Banner precedence — say both (R4 below)

`{ ...held, banner: "rerun-failed" }` overwrites whatever banner `resultBook` gave the held result. A superseded hold keeps the "Result for batch N · superseded" warn chip (resultBook 308–310), so supersession survives in the strip. A stale-input hold (label / path assumption / shocks skew at the same version, `definitionSkew` lab-library.ts) has no chip — only the "Config" chip goes warn, and only for a config-version skew — so its disclosure vanishes entirely while the re-run stays failed. The Global Constraint requires "a banner when the result is for a previous input"; the hold does not change that the result is for a previous input.

### The banner text

`Run again failed — ${emphasis}${rest} ${dek} The result below stands for batch ${batch}.` (StaleBanner diff 83–84). All five failure headlines carry an empty `rest` and a dek that `sentence()`/`refused` terminates (lab-headline.ts `failureHeadline`), so the composite reads as sentences — e.g. "Run again failed — Book-wide stress is not served by this deployment. The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book. The result below stands for batch 18,251." The `failure === null` fallback is unreachable (`banner` and `rerunFailure` are set together) — harmless. `role="status"`, `data-kind`, the Run again button: unchanged. ✅

### Pins bite on 18ff863

- lab-reading.spec (523–535): `withRunning(first, "a", 3)` expects `held: {…}` — the old record has no `held`, `toEqual` fails on a present object; `first.get("a")?.held` `toBeNull()` fails on `undefined`; the two-failures carry and the ok release both fail on the old shape. ✅
- lab-view.spec (602–619): a record with `held` under an `unreachable` outcome — the old `bookOf` yields state "unreachable" ≠ "result". ✅ The no-hold control (`first.book.state === "unreachable"`) passes on both, as intended.
- lab-library.spec: helper shape only; the held-word arm of `outcomeLine` has no unit pin — C13's `row(page, "eth_minus_30")` assertions cover it in e2e. Minor.
- C13 (lab.spec diff 391–424): on 18ff863 `data-state` is "not-served" ≠ "result". ✅

### Does C13 pin the whole retired law?

r8(2) — "the prior result returns with its own batch pin, and the failure is NAMED": C13 pins the state, `data-banner`, the failure sentence, "stands for batch 18,251", the held headline, tile, row word, grid, movers, the enabled Run again, and the unchanged run count. ✅ (One line would complete the "batch pin" clause literally: `chip(page, "Result for batch")` → "18,251".)

R16/R17 — "a retained book is DISPLAYED OR DISCLOSED, but NEVER MISTAKEN FOR THE SETTLED REQUEST'S ANSWER; the header, the cells, the banners and the detail may never contradict each other; a bodyless settlement under the current definition is THIS ROW'S OWN FAILURE, not the retained book's skew": not pinned, and not implemented as the law had it — R3 below.

### Residuals

**R3 (Important) — a held body the listing refuses is presented as "the result below" while nothing is below, and the row still speaks its word.** Reachable with the contract's own C15 fixture: run once → the run-book answers at another `scenario_version` than the listing (`definitionSkew` → "version") → `definition-changed`, figures nulled, and this ok result is now the hold; Run again → any failure. `bookOf` then renders `resultBook(held)` → state `definition-changed`, headline "{label} changed since this result was computed.", `cash: null`, `legacy: null` — and over it `banner: "rerun-failed"` whose text ends "The result below stands for batch N." No result is below; the headline speaks of the retained body's skew rather than the attempt's failure; and `outcomeLine` prints `cashOutcome(held.response)` — "+$1.2M liquidatable · 118 accounts" — for a body the workspace refuses to show. Three accounts of one row, the exact shape R17 pinned against ("cells DEFINITION CHANGED about the RESPONSE … a banner one line below saying the re-run had failed"). Fix, in `bookOf` and `outcomeLine`: when the held book's `resultBook` state is `definition-changed`, do not hold it as a result — render the attempt's own failure state (as with no hold) with the retained body DISCLOSED as retained and refused (a dek or a second banner line: "an earlier response for another definition of this scenario is retained and not shown"), and let the library row say the failure word for that arm; pin the sequence (C15's skewed run-book, then a failed re-run → `data-state` the failure, the disclosure present, the row's word the failure). The pre-existing sibling — an ok result under a version skew already prints the result word in the row while the workspace says definition-changed — is Task 4/9's vocabulary gap, not this round's, but the same one-word fix ("Definition changed", dim) closes both.

**R4 (Important — the controller's own precedence question) — `rerun-failed` erases the held result's stale-input banner.** A held result whose definition skewed (label / path assumption / shocks, same version) loses "Results for a previous input: the listing's … changed since this run" for as long as the re-run stays failed, and no chip carries that fact (only a config-version skew warms the Config chip). The constraint mandates that banner for a stale-input result, hold or no hold. Fix: one banner, two facts — `StaleBanner` prints the failure sentence and then the held condition's own sentence when `book.skew.length > 0` or the held batch is superseded (the text for both already exists in the component; `book.skew` and the superseded flag are already on the book); keep `data-kind="rerun-failed"` and add `data-held="stale-input" | "superseded"` so C15/C13 can pin the pair. A superseded hold is the milder case (the chip still says "· superseded") but the same sentence belongs in the banner for the same reason.

### Minor (new this round)

- The contract table's `data-banner` vocabulary (plan §Test ID contract: `stale-input · superseded`) needs `rerun-failed` (docs).
- `outcomeLine`'s held arm has no unit pin (e2e only).
- C13 could pin `chip(page, "Result for batch")` = "18,251" for the "batch pin" clause literally.
- Running over a hold neither displays nor discloses the hold for the run's duration (plan-mandated running arm; a one-line dek would disclose it).

### Not verified

This round's gates (the report states unit 752 green and the contract 22/22 on the round's build; not re-run here); the C15 fixture's exact version skew (read from the plan's contract description, not the fixture file).

**RE-REVIEW: open** — R3 (a definition-changed held body is announced as "the result below" with nothing below and the row still speaking its word — R17's half of the retired law inverted) and R4 (`rerun-failed` erases a held result's stale-input/superseded banner; say both).

---

## Re-review 4 (745627e)

Scope: round 4 against R3 and R4; package `review-9b23b07..745627e.diff` (one commit, eight files, +155/−36; `git diff --stat` agrees). Read-only; the suite was not run. Baselines for the byte comparison are the 9b23b07 texts read in round 3.

### R3 — ADDRESSED. The retained body is disclosed, never shown, in every register.

`bookOf` (lab-view diff 329–336): when `resultBook(held)` would be `definition-changed`, the book is `emptyBook(failure.state, failure.headline, def, definitionChips)` with `banner: "retained-refused"` and `retained: { batchId: held.response.batch.id, skew: held.skew }`. `emptyBook` carries `identity: null`, `receivedAt: null`, `run: null`, `cash: null`, `legacy: null` and the definition's own chips, so on the surface: tiles `—` under the failure word (`LabTiles` with `r === null`), no grid, no movers (`cashResult` null), no legacy fold, no drawer button and "No result is open." inside it (`book.run` null), no "Result for batch" chip (definition chips only), no Computed chip (identity null → receipt null → `age.seconds === null` → the chip is absent), `data-state` the failure's, `data-banner="retained-refused"`. Disclosed by the banner alone: "A result for batch {retained.batchId} is retained but not shown: the definition's {joinAnd(skew)} changed since it was computed. The failure above is this request's own." (StaleBanner diff 101–103) — the banner reads `retained.batchId`, not `book.run` (null there). The headline is the attempt's own failure — R17's "this row's own failure" — and the only remedy offered is Run again, which asks under the current definition (no refresh affordance exists on this page). ✅ `held.skew` is `definitionSkew(def, listing config, held.response)` from `resultBook`'s `base`, so the disclosure names every drifted field.

**The row.** `outcomeLine(record, definition, configVersion)` (lab-library diff 176–190): the held arm computes `cashOutcome(held.response, …)` and returns it only when its key is not `definition-changed`; otherwise it falls through to the failure word. `cashOutcome` (193–195) answers `{ key: "definition-changed", text: "Definition changed", tone: "refused" }` when `definitionSkew(definition, configVersion, response).includes("version")` — the identical predicate on the identical inputs `resultBook` uses for its `definition-changed` state (`skew.includes("version")` over `definitionSkew(def, configVersion, run)`), and placed before `readEngine` exactly as `resultBook` places it before the cash reading. So an ok result under a version skew reads "Definition changed" in the row while the workspace is `definition-changed` (the sibling gap closed), and a retained skewed body reads the failure word while the workspace is the failure state. Agreement in both arms. ✅ `libraryRows` passes `listing.scenario_config_version` (218); the kit's `LibraryOutcomeKey` gains the key (ScenarioLibrary diff 126); `OUTCOME_CLASS` keys on tone, so no CSS moved.

### R4 — ADDRESSED. Both facts, the plain banners byte-identical.

- superseded: old `Batch ${batch} has been superseded: a newer complete batch exists. This result stands for the batch it names.` → `${supersededWords(batch)} This result stands for the batch it names.` with `supersededWords` = `Batch ${batch} has been superseded: a newer complete batch exists.` — identical. ✅
- stale-input: old `Results for a previous input: the listing's ${joinAnd(skew)} changed since this run. This result stands for the definition it was computed under.` → `${staleWords(skew)} This result stands for the definition it was computed under.` — identical. ✅
- rerun-failed: the round-3 sentence unchanged, then ` ${supersededWords(batch)}` or ` ${staleWords(skew)}` appended by `heldCondition` (100); C13's two `toContainText` pins still hold; `data-held={heldCondition ?? undefined}` on the banner (106). The `failure === null` fallback gained a period — unreachable (`rerunFailure` is set with the banner), harmless. ✅
- `heldCondition` (lab-view diff 339) is `held.banner` when it is `superseded` or `stale-input` — `resultBook`'s own banner over the held body against the CURRENT listing, so a hold that drifted after it was computed is judged now, not at settle. ✅

**Precedence for a superseded AND stale-input hold.** Only one condition rides: `resultBook`'s `superseded ? "superseded" : skew.length > 0 ? "stale-input" : null`. That drops the stale-input sentence in the double case — but exactly as the plain banner drops it for an unheld result under the plan's own R13 precedence ("a superseded batch outranks a stale input as the banner"), with the Config chip warming only for a config-version skew in both cases. The hold loses nothing relative to the plain result; whether R13's precedence should itself say both is a plan question outside this round and not load-bearing.

### Pins bite on 9b23b07

- lab-library.spec (492–503): an ok result at another version → old "+$1.2M liquidatable · 118 accounts" ≠ "Definition changed"; a failure over a held skewed body → old held word ≠ "Not served". Two of four bite; the other two are carry-overs that pass on both, as intended.
- lab-view.spec (520–543): retained-refused → old state "definition-changed" ≠ "not-served"; the stale-input hold → old `heldCondition` undefined ≠ "stale-input".
- C23 (lab.spec 370–410): first sequence → old banner has no `data-held` and no "path assumption" sentence; second → old `data-state` "definition-changed" ≠ "not-served", and the old row said "+$1.2M". ✅

### Nothing else moved

Eight files as listed; `deriveLabView`'s call into `libraryRows` is unchanged in shape; no other `outcomeLine` caller exists.

### Minor (docs only)

The contract table's vocabularies need `data-outcome` + `definition-changed` and `data-banner` + `rerun-failed · retained-refused`.

### Not verified

This round's gates (unit 755 / contract 23-23 are the report's word); the C15 fixture's version field (the e2e builds its own `version: "v2"` and drifted `path_assumption` bodies from `DEMO_SCENARIOS`, which I read from the diff, not the fixture).

**RE-REVIEW: closed.**
