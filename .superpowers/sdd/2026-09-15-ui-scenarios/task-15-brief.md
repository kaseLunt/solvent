### Task 15: Final verification, widths, the whole-branch review, the Codex rounds, the close

**Integrator runs this personally.**

- [ ] **Step 1: The gates**

From `web/`: `npm run typecheck && npm run lint && npm run lint:css && npm run build`; kill any stale :3111; `npx playwright test`.
Expected: all clean; 0 failed; the unit count and the e2e count recorded in the ledger against Plan 2's close (1,136 / 308).

- [ ] **Step 2: Widths and themes**

With a production server on :3111, run the widths probe (the Plan 2 scratchpad's `widths.mjs` shape, with `["lab", "/lab?scenario=eth_minus_30"]` added to its pages and the three Scenarios routes to its mocks) at 390, 1366, 1440, 1920 and 2560: no horizontal scroll anywhere; the shell's max-width steps unchanged (1280 / 1280 / 1280 / 1520 / 1680); at 390 the library stacks above the workspace. Record the table in the ledger.

- [ ] **Step 3: Contrast**

The page adds tinted grounds: `.heatWorse/.heatBetter/.heatHeld` are `color-mix` tints of `--crit`/`--ok`/`--ink-3` at ≤ 55 % over the panel, with the count in `--ink` on top; `.libRefused` and `.notice` use `--ink-2`/`--warn-text` on `--panel`. Compute the worst pair in each theme from `web/app/tokens.css` (ink on the strongest crit tint over the dark and the light panel) and record the ratios; every text/ground pair the page prints must be ≥ 4.5:1 or the tint's ceiling comes down (a `--heat`-independent change in `kit.module.css`). `--ink-3` appears only on captions and band labels over the plain panel, never on a tinted cell (the law from Plan 1's tokens).

- [ ] **Step 4: Whole-branch review and the Codex rounds (spec §9.5)**

Build the review package for `9aa5f17..HEAD` with the fixture JSON bodies excluded (the generator is judged instead) and the whole-branch reviewer's brief from Plan 2's Task 14 (the honest-UI laws, the rulings R1–R16, the deferred list in the ledger). Fix Criticals and Importants in one round; scoped re-reviews until closed; residuals adjudicated in the ledger. Then the slim diff for Codex:

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
mkdir -p .superpowers/sdd/2026-09-15-ui-scenarios
git diff 9aa5f17..HEAD -- web/lib web/app/lab web/components/kit web/components/charts web/tests/unit ':!web/tests/fixtures/**/*.json' > .superpowers/sdd/2026-09-15-ui-scenarios/final-review-slim.diff
```

Dispatch `codex-reviewer` on that file scoped to correctness and honesty regressions (runs are actions; one POST per ask; the wire's lanes merged by summation only; refusals never zero; engines never summed; result identity and the banners), together with the two owed rounds (Plan 1's on `.superpowers/sdd/2026-09-15-ui-kit-overview-book/`'s slim diff and Plan 2's on `git diff d989286..9aa5f17 -- web/lib web/app/inspector web/components/kit web/tests/unit ':!web/tests/fixtures/**/*.json'`). If the Codex CLI still rejects the config (`gpt-6-astra` on 0.144.5), record BLOCKED-owner for all three with the exact error and do not mutate the CLI or its config — the owner's call.

- [ ] **Step 5: Close the ledger**

Append the close entry to `.superpowers/sdd/progress-ui-overhaul.md` (commit range, suite counts, gates, widths, contrast, the owner's approval timestamp, review outcomes, the Codex status, carry-forwards: Plan 4 converges History / Activity / Verification / API onto the kit and takes the Plan 2 and Plan 3 deferred minors; a Plan 3b if Compare was cut), then commit the workspace and the `.gitignore` re-include:

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add .superpowers/sdd/.gitignore .superpowers/sdd/progress-ui-overhaul.md .superpowers/sdd/2026-09-15-ui-scenarios
python roadmap/tools/scope_gate.py
git commit -m "docs(sdd): plan 3 (scenarios) closes - the ledger, briefs, reports and reviews committed beside plans 1 and 2; the retirement ledger and close entry appended" -- .superpowers/sdd/.gitignore .superpowers/sdd/progress-ui-overhaul.md .superpowers/sdd/2026-09-15-ui-scenarios
```

---

## Self-review (writing-plans checklist)

**Spec coverage (§5.4):** layout 300 px library + workspace — Task 1 (`ScenarioLibrary`, `.lib*`), Task 11 (`lab.module.css` `.page`); library header with the mode toggle, rows with name / description / last outcome, checkboxes, footer Run / Compare — Tasks 1, 4, 11, 13; workspace kicker with PROJECTION, headline per §3.5, dek (bad debt, accounts moved, near-cap overlap), identity chips (batch · scenario id/version · computed · engines · config) — Tasks 3, 9, 11; four tiles — Tasks 9, 11 (`LabTiles`); the transition heatmap — Tasks 1, 2, 11; most affected accounts → Inspector — Tasks 5, 11; Compare view — Tasks 1 (`DotPlot`), 7, 13; legacy results collapsed — Tasks 9, 11 (`LegacyResult`); Assumptions & out-of-model drawer — Task 11; one-address mode with the address field in the library header and the Inspector's tiles for before/after — Tasks 6, 11 (`AddressWorkspace`); the states (not run · running · result · stale input · superseded · not covered · withheld · contradictory / definition changed · API error) — Tasks 3, 9 (`BookState`, `Banner`), 11, 12 (pinned); data from `/v1/scenarios`, `POST run-book`, `POST run-book-set`, `/v1/address/{addr}/stress` — Task 8 (listing, runs, set), Task 6 (the Inspector's stress reading); `lib/resultIdentity.ts` unchanged — Task 9 builds a `ResultIdentity` and the page anchors the age with `resultReceipt`. §3.5 Scenarios templates — Task 3, pinned in unit and e2e (Task 12). §7 page-test contract, retirements with ledger lines, screenshot pins — Tasks 12, 14. §8 demo dataset generated with provenance — Task 10. §9 mockup CSS transcribed (Task 1), the side-by-side gate before the pins (Task 14), one Codex round (Task 15). §6 four widths, both themes — Tasks 12 (390 / 1440 pins), 15 (probe).

**Placeholder scan:** no TBD / TODO / "implement later"; every code step carries its code; the two "read the fixture and freeze the literal" notes (Task 6's after-cap figures, Task 10's census counts and `checkClocks` shape) name the exact file and the exact pin to freeze, as Plan 2 did; the three "if the type/fixture differs" notes name the file and what to read.

**Type consistency:** `LabHeadline { emphasis, rest, tone, dek }` (Task 3) is what `lab-address` (Task 6), `lab-view` (Task 9) and `VerdictHeader` (Task 11) consume; `HeatmapView` fields (`merged, bands, cells, maxRows, totalRows, measuredRows, unmeasuredRows, heldRows, laneChangedRows, bandChanged, crossedCap, improved, nearToday, nearCrossed, nearLabel, decimals`) are read by `lab-headline` (Task 3), `lab-view` (Task 9) and `TransitionCard` (Task 11) by those names; `RunRecord` / `SetRecord` live in `lab-library` (Task 4) and are consumed by `lab-reading` (Task 8) and `lab-view` (Task 9); `LibraryRow` (lib) is structurally a `LibraryItem` (kit) plus `version` and `coversCash`, so `view.library` passes to `ScenarioLibrary.items` unchanged; `EngineReading` kinds (`result | withheld | not-covered | contradictory | unreadable`) are the ones `LabTiles`, `TransitionCard` and `LegacyResult` switch on; `CompareState` kinds (`idle | running | ok | failed`) are the ones `CompareCard` renders; `AddressWorkspace.state` values are the surface's `data-state` in address mode; the test-id table matches every `data-testid` the Task 11 and 13 components emit; the demo figures in Tasks 3, 9, 10 and 12 are the same numbers (118 · 49 → 167 · +1,280,000,000,000 · +40,780,396,039 · 941 · 425 · 27) derived from the same table (`DEMO_CASH_TABLE` in the unit helper equals `CASH_TABLE` in the generator).
