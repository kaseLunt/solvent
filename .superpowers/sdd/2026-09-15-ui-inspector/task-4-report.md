# Task 4 report: `trust` — the five checklist items

**Status:** DONE
**Commit:** `92aa73b` on `main` — `feat(web): the Inspector's Trust checklist - five items with states, a book-level reconcile labelled as such`
**Files (exactly two, staged by name):**
- `web/lib/trust.ts` (new)
- `web/tests/unit/trust.spec.ts` (new)

## What I did

Followed the brief's TDD order.

1. **Verified the brief's dependencies against the real code before writing anything.**
   - `lib/refusal-phrasebook.ts` — `plainCause` returns the phrasebook entry for a known code regardless of `detail`; `plainCause("SWEEP_NEVER", "no sweep")` → `"collateral sweep never ran"`. The brief's Step 4 caveat did not trigger; the module passes `(code, detail)` as written.
   - `lib/freshness.ts` — `humanAge(1205)`: `floor(1205/60) = 20` → `"20m"`, so the clean-stamp pin `"gen 4 · 20m ago"` holds.
   - `lib/wireGuard.ts` — `readWirePopulation(value, field)` throws on a non-population; used exactly as the brief does.
   - `lib/inspector-position.ts` — exports `CASH = "debt_manager"`, `symbolFor` (leg symbol by case-insensitive asset match, else truncated address), `oldestPriceAge` (max of non-null ages, else null).
   - `tests/unit/helpers/cash-position.ts` — `near()` builds on the DM fixture position (`status: "computed"`, `refusal: null`, `as_of.sweep_block: 154796490`, price provenance `engine-exact`), with two inputs at age 35 / budget 180 / `fresh`.
   - `tests/fixtures/inspector.ts` — the `debt_manager` watermark's sweep: `rows 3, failed 1, generation 4, age_seconds 1205`.
   - `tests/fixtures/evidence-manifest.json` (via `proof.ts`) — `result "pass"`, `gated_rows 87`, `gated_exact 87`, `gated_drift 0`, welds `debt_manager 29/29`, `aave_v3_etherfi 14/14`.
   - `@solvent/client` schema — `PriceInput.verdict` is the six-value enum the module's `isFreshOrStale` narrows; `Refusal` is `{ code, detail, asset?, note }` so the spec's refusal literal typechecks; `NullableDecimal` is `string | null` so `value: null` typechecks; `SweepStamp.age_seconds` is `number | null`.

2. **Step 1–2:** wrote `web/tests/unit/trust.spec.ts` verbatim from the brief. Ran it: `Error: Cannot find module '...\web\lib\trust'` — the expected module-not-found failure.

3. **Step 3–4:** wrote `web/lib/trust.ts` verbatim from the brief. Ran the spec:

   ```
   Running 5 tests using 5 workers
   5 passed (2.4s)
   ```

   Hand-checked every pinned string against the fixture arithmetic before trusting the green:
   - `batch 18,251` — `(18251).toLocaleString("en-US")`.
   - `35s · within 180s` — `oldestPriceAge = max(35, 35) = 35`, `min budget = 180`.
   - `1 of 3 rows failed · gen 4` — `failed 1 > 0` branch with `rows 3`, `generation 4`.
   - `29/29 Cash rows exact · committed receipt` — the `debt_manager` weld wins over the gated totals; `87/87 rows exact` when `welds` is emptied.
   - `weETH 210s old · budget 180s` — stale is still "fresh-or-stale", so it falls through to the stale branch (warn), not the refused branch.
   - `ETHFI price missing` — `missing` is outside fresh/stale → refused, verdict word verbatim.
   - `never swept · collateral clock absent` — `sweep_block === 0` checked after the null-stamp check, so a null stamp is `dim`, not `refused`.

4. **Gates:** from `web/`, `npm run typecheck` (exit 0; `pretypecheck` rebuilt `@solvent/client`) and `npm run lint` (exit 0). From the repo root, `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. Committed with `git commit -m "<brief's message>" -- web/lib/trust.ts web/tests/unit/trust.spec.ts` so nothing else could be swept in. No attribution lines. Nothing was staged before I started, and nothing is left staged after.

## Deviations from the brief

None. Both files are the brief's code verbatim; no expectation needed changing — every value the spec pins is reproduced by the fixtures and helpers as they exist.

## Notes for review (not blockers)

- Git printed its usual `LF will be replaced by CRLF` warning for both new files (heredoc-written with LF; the repo's autocrlf handles it). Same as the other web files.
- `byId` in the spec relies on `Object.fromEntries` falling to its `any`-returning overload (the `[i.id, i]` array is not inferred as a tuple). That is fine under the repo's `eslint-config-next` presets and `tsc --strict`, which is why lint and typecheck are clean; a stricter `no-unsafe-member-access` config would flag it. Left as the brief wrote it.
- `sweepItem` reads `readWirePopulation(sweep.rows, ...)` only on the failed branch, so a malformed `rows` on a clean stamp would not throw. Consistent with the brief; flagging only because the other populations are guarded unconditionally.

---

# Fix round 1

**Status:** DONE
**Commit:** `01d28f5` on `main` — `fix(web): trust checklist review round - the oldest price keeps its own budget, verdicts and provenance speak plainly, the receipt is ok only when every counted row is exact, every printed count is guarded`
**Files (the same two, staged by name, pathspec-limited commit):** `web/lib/trust.ts` (98 → 173 lines), `web/tests/unit/trust.spec.ts` (74 → 142 lines). The exported interface (`trustChecklist`, `TrustItem`, `TrustInput`, `TrustId`, `TrustState`) is unchanged.

## Test output

```
Running 10 tests using 10 workers
10 passed (2.4s)
```

`npm run typecheck` exit 0 · `npm run lint` exit 0 · Serena diagnostics on `web/lib/trust.ts`: none · `scope-gate: OK -- integrator claude-integrator; 2 path(s)`.

## What changed, by the coordinator's numbered rules

1. **Prices ok arm** — every input's `age_seconds` (when non-null) and `budget_seconds` is read through `readWirePopulation` up front (`readPrices`); the input with the oldest age speaks with ITS OWN budget (`150s · within 180s` for `[{150,180},{35,120}]`). All ages null → `dim`, `age unknown · budget 180s` (the smallest budget).
2. **Prices refused arm** — `BROKEN_WORDS`, a `Record` total over `Exclude<PriceVerdict, "fresh" | "stale">` (a new verdict on the wire fails typecheck here). Every broken input is named, grouped by verdict in wire order: `ETHFI price missing` · `weETH price without a timestamp` · `weETH price missing; ETHFI price past its ceiling`; `title` carries the wire word(s), `missing; over-ceiling` when they differ. The stale arm names every stale input: `weETH 210s old · budget 180s; ETHFI 300s old · budget 180s`.
3. **Guards** — price ages/budgets, `sweep.rows/failed/generation/age_seconds`, `reconcile.gated_drift/gated_rows/gated_exact/exit_code`, and the Cash weld's `rows_compared/rows_exact` all pass `readWirePopulation(value, "<field path>")` before they are printed or compared. `age_seconds: NaN` on a fresh input throws (pinned).
4. **Sweep order** — `sweep_block === 0` first (refused, `title: "sweep_block: 0"`) → `sweep === null` (dim) → `rows === 0` (dim `sweep stamp empty`) → `failed > rows` (warn `5 failed of 3 rows · contradictory stamp`) → `failed > 0` (warn, as before) → `generation_open` (warn `gen 4 open · sweep in progress`) → ok.
5. **Provenance** — `PROVENANCE_CAVEATS` maps `adapter-output` / `uncapped-feed` / `ratio-reference` to "adapter output" / "from an uncapped feed" / "a ratio reference"; the label names every such input (`weETH price is adapter output` · `weETH and ETHFI prices are adapter output` · `weETH price is adapter output; ETHFI price is a ratio reference`), detail `not oracle-direct`, title the wire word(s). No caveat but an off-direct word → dim `provenance not recognised` with the word(s) in `title`, or `provenance not stated` when the word is empty.
6. **Computed** — refused with `refusal: null` → `refused without a code`, no `title`.
7. **Reconcile** — `result !== "pass" || exit_code !== 0 || drift > 0` → warn `${drift} drifted rows` + ` · did not pass` when the receipt did not pass, title `result: ${result} · exit ${exit}`. Otherwise the Cash weld (else gated totals): `compared === 0` → dim `no Cash rows in the receipt`; `exact !== compared` → warn `1 Cash row drifted` (title the artifact path); else ok as before. Without a weld the same arms say `rows`.

Spec: `byId` is typed `as Record<TrustId, TrustItem>` (types imported); the two existing pins the rules changed were updated (`2 drifted rows · did not pass`; `provenance not recognised` with `title: "replayed"`); five new test blocks pin every input the coordinator listed, plus one extra (two broken inputs with differing verdicts).

## Deviations from the coordinator's rules (small, each deliberate — strike any you disagree with)

- **`oldestPriceAge` import dropped.** Rule 1 wants the oldest INPUT, not the oldest age; a filter-and-reduce over the guarded reads gives the input directly. Keeping the helper only to re-find its input by age would be redundant. `lib/inspector-position.ts` is untouched.
- **Pluralised the drift count**: `${drift} drifted row${drift === 1 ? "" : "s"}`, so drift 1 does not print `1 drifted rows`. Both pinned strings (`0 drifted rows`, `2 drifted rows`) are unchanged.
- **A contradictory receipt is named, not subtracted.** Rule 7 says `exact !== compared` → `${compared − exact} … drifted`; when `exact > compared` that would print a negative count, so that case gets its own warn arm: `30 exact of 29 Cash rows · contradictory receipt` (the same treatment rule 4 gives a contradictory sweep stamp). Not pinned; flagging so the reviewer can decide whether to keep it.
- **`exit_code` is guarded** through `readWirePopulation` (the rule said `exitCode = reconcile.exit_code`); `lib/evidence.ts:570` guards the same field, and it is printed in `title`.
- **No `title` on `provenance not stated`.** Rule 5 says title = the wire word(s); when every off-direct word is the empty string there is no word to show, so `title` is omitted rather than set to `""`. Mixed empty and non-empty words → `not recognised`, title lists only the non-empty words.

## Not addressed (out of this round's scope, noted for the controller)

- The review's long-term fix — exporting the receipt conjunction from `lib/evidence.ts` and calling it here — still stands; this round re-derives the same three conditions locally, as the rules asked.
- `readWirePopulation` throws are the contract at this layer; Task 11 must mount `trustChecklist` inside the same route boundary the evidence surfaces use.

---

# Fix round 2

**Status:** DONE
**Commit:** `f4ff9d7` on `main` — `fix(web): trust checklist round 2 - every provenance input is named, the wire word never stands as prose, every arm is pinned`
**Files (the same two, staged by name, pathspec-limited commit):** `web/lib/trust.ts` (+16/−8 in `provenanceItem` only), `web/tests/unit/trust.spec.ts` (+16: one pin updated, eight added). Exported interface unchanged.

## Test output

```
Running 10 tests using 10 workers
10 passed (2.2s)
```

`npm run typecheck` exit 0 — the whole tree, not just these two files: the TS2741 (`newestKind`) in `tests/unit/inspector-headline.spec.ts` the coordinator warned about did not surface in this run. `npm run lint` exit 0. Serena diagnostics on `web/lib/trust.ts`: none. `scope-gate: OK -- integrator claude-integrator; 2 path(s)`.

## What changed, by the coordinator's numbered items

1. **A caveat never hides another input.** `provenanceItem` now splits the off-direct inputs into `caveats` (adapter-output / uncapped-feed / ratio-reference) and `others`. On the warn arm the detail is `not oracle-direct` followed by one clause per other input — `; ETHFI provenance not recognised` (or `not stated` for an empty word) — and the title lists the caveat words then the non-empty other words. Pinned: `[weETH adapter-output, ETHFI "replayed"]` → warn, label `weETH price is adapter output`, detail `not oracle-direct; ETHFI provenance not recognised`, title `adapter-output; replayed` (pinned exactly, which satisfies "contains `replayed`"). The dim arms are unchanged in behaviour and now read from the same `others` split.
2. **No wire word as prose on the ok arm.** Detail `the engine's own inputs`, title `engine-exact`. The happy-path pin (spec line 29) updated to match, with the title asserted.
3. **Every remaining arm pinned, one assertion each:** provenance dim `no price inputs`; reconcile `30 exact of 29 Cash rows · contradictory receipt`; pass-with-drift (`result: "pass", exit_code: 0, gated_drift: 2`) → `2 drifted rows` (exact match, so no suffix); gated fallback (`welds: []`) `gated_exact 86 / gated_rows 87` → `1 row drifted`, and `0 / 0` → `no rows in the receipt`; `reorg-unacked` → `weETH price behind an unacknowledged reorg` with title `reorg-unacked`; stale input with `age_seconds: null` → detail contains `age unknown`.

## Deviations

None from the three items. Two nits the re-review recorded but the coordinator did not include were left alone to keep to "exactly these changes": the header comment's "an unmeasured age … is dim" overstates by a word (a partially unmeasured set is `ok` on the measured oldest, as ruling #1 asked), and the broken-price group joins symbols with `, ` where provenance uses `andList`. Both are one-line follow-ups if wanted.
