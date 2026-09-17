# Task 3 report: `lab-headline` — the §3.5 Scenarios templates and the honest extra states

**Status:** DONE_WITH_CONCERNS
**Commit:** `df3383bb1946dceffb97de86cc34b05367050915` — `feat(web): lab-headline - the Scenarios templates and every state's own sentence, money in the Book's tiers, the dashed tone for anything that is not a verdict`
**Files (exactly the brief's two):**
- `web/lib/lab-headline.ts` (new, 166 lines)
- `web/tests/unit/lab-headline.spec.ts` (new, 146 lines; the pins verbatim from the brief, unchanged apart from the dropped line-1 path comment)

## What was done

1. Read the brief; loaded Serena and read the bodies of `humanUsd`/`MINUS` (`web/lib/human-usd.ts`), `groupInt`/`joinAnd` (`web/lib/prose.ts`), `engineName` (`web/lib/inspector-headline.ts`), `HeatmapView`, `RoomBand`, `laneReading` and `mergedBands` (`web/lib/lab-transitions.ts`), and `cashEngine`, `DEMO_CASH_TABLE`, `MoveTable`, `transitionsOf` (`web/tests/unit/helpers/run-book-engine.ts`).
2. Hand-verified every figure in the result pins against `mergedBands` (over-cap [0,1] · b1 [2] · b2 [3] · b3 [4] · b4 [5,6,7] · no-debt [8] · unmeasured [9]) and the helper tables before running anything:
   - demo table: `bandChanged` 425, `improved` 0, `nearToday` 14+13 = 27, `nearCrossed` 27, `nearLabel` 9.09% (all also pinned by `lab-transitions.spec.ts`); `$1,280,000` → `$1.2M`; `$40,780.39` → `$40K`.
   - `moved` `{2:{2:1}, 5:{4:5}, 7:{7:2}}`: 5→4 is b4→b3, 5 changed, 0 improved, nearToday 1, none cross.
   - `better` `{2:{3:4}, 4:{3:2}}`: 2→3 b1→b2 (4 improved), 4→3 b3→b2 (2 worse); 6 changed, 4 improved, nearToday 4, none cross; `−$1,000,000` at 6 decimals → `$1`.
   - `single` `{3:{0:1}}`: b2→over-cap; 1 changed, nearToday 1, nearCrossed 1 → "all 1".
   - `none` `{2:{2:3}, 7:{7:9}}`: 0 changed.
   All agreed with the pins; no recount was needed.
3. Transcribed the pins; ran them → `Cannot find module '...\web\lib\lab-headline'` (the brief's expected failure).
4. Transcribed the module; ran the pins, `tsc`, `eslint`. Two pins disagreed with the brief's code (both wording, neither arithmetic); the code moved, as listed below. The pins were not touched.
5. Green on all three; staged by name; `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; committed by pathspec.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-headline.spec.ts
  5 passed (2.5s)
```

Also: `cd web && npm run typecheck` → exit 0 (no errors); `cd web && npm run lint` → exit 0 (no findings).

## Deviations from the brief, each with its reason

### D1 (pin-forced) — the path assumption after "Path:" is quoted as given, not recapitalised
Pin: `dek: "All ETH-linked collateral, instantaneous mark. Path: instantaneous mark at the shocked level; single-step."`. The brief's code wrapped `path_assumption` in `sentence()`, which capitalises, producing `Path: Instantaneous mark …`. The law the pin states is that the wire's own clause follows the "Path:" label verbatim and is only terminated with a full stop. The module now has two helpers where the brief had one: `terminated(text)` (trim; append `.` unless the text already ends in `.`/`!`/`?`) and `sentence(text)` (= `terminated` then capitalised). `notRunHeadline` uses `terminated` for the path and `sentence` for the description. Every other call site keeps `sentence`, so no other pinned string changed.

### D2 (pin-forced) — the legacy market takes its article as the object of "models"
Pin: `dek: "It models the Aave v3 market (legacy). The legacy result is below."`. `engineName("aave_v3_etherfi")` returns the bare `Aave v3 market (legacy)`, so the brief's `joinAnd(engines.map(engineName))` printed `It models Aave v3 market (legacy).`. The tree already gives the market its article in prose (`web/app/book/BookMethodology.tsx`: "The Aave v3 market (legacy) is …"). Added a one-line `modelled(id)` helper: the legacy market is `the ${engineName(id)}`; any other engine is named as `engineName` names it. This required importing `LEGACY` from `web/lib/inspector-position.ts` (the same source the Inspector's headline module imports it from) — a dependency the brief's "Consumes" line does not list.

### D3 (rule-forced) — no path comment on line 1
The brief's module and spec both open with a `// web/lib/…` / `// web/tests/…` path comment; the task rules say the tree carries none. Dropped from both. (For the record, `web/lib/inspector-headline.ts` and `web/lib/prose.ts` do carry one; `web/lib/lab-transitions.ts` and its spec do not. Followed the rule.)

Nothing else differs from the brief's code. `signedUsd`, `resultHeadline`, `badDebtSentence`, `movementSentence`, `nearSentence`, `runningHeadline`, `withheldHeadline`, `contradictoryHeadline`, `definitionChangedHeadline`, `failureHeadline`, `LISTING_LOADING`, `EMPTY_LISTING`, `listingUnavailableHeadline` and every type are as written.

## Pins
No pin was changed. No pin arithmetic was provably wrong; nothing was recounted.

## Concerns for the controller

1. **New dependency not on the brief's Consumes line.** `lab-headline.ts` now imports `LEGACY` from `./inspector-position` (D2). If the controller would rather this module not depend on the Inspector's position module, the alternative is to export the engine ids from somewhere neutral (or accept a string compare against the display name, which I avoided as fragile).
2. **A second private `sentence` helper.** `web/lib/inspector-headline.ts` has its own private `sentence` (strips a trailing `.` and re-adds it; capitalises). This module's `sentence` keeps a trailing `!`/`?` and does not strip. `prose.ts` states the law that no prose helper may be owned twice; a `terminated`/`sentence` pair may belong in `prose.ts` when a third caller appears. Not moved — the brief names exactly two files.
3. **`ResultFigures.beforeEligible` is carried but printed by no template.** The brief's interface has it; no sentence reads it. Harmless today; the consumer (the workspace header, a later task) may want it in the dek or it can go.
4. **`notCoveredHeadline` with Cash in `engines`.** By construction it is only called when the scenario does not model Cash, so `debt_manager` never reaches `modelled`; if it did, the sentence would read "It models Cash." The helper does not guard against this because it cannot happen from the header's own precondition.
5. **`failureHeadline("failed", {})` prints "The service answered 0."** The brief's `d.status ?? 0` fallback; a status-less failure is better routed to `unreachable`. Left as the brief wrote it.
6. Git printed its usual `LF will be replaced by CRLF` warning for the spec on staging (repo-wide autocrlf); cosmetic.
