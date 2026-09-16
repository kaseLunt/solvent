# Task 14 report — retire the old Book surface, its page-local modules, the old header, and the pins that described them

Status: **BLOCKED at the verification gate by two pre-existing reds outside this task's scope; the cleanup is complete, ledgered, staged and scope-gate-OK, and the commit is withheld** (the brief's gate says all suites must be green before the commit; the parent's rule says a non-retired failure is reported, not fixed by deletion).

Nothing under `tests/fixtures`, `lib`, `app/lab`, `components/kit` or the kept Book files was edited. No subagents were used.

## 1. What is staged (exactly the intended commit)

`git diff --cached --stat`: 47 files, +308 / −16,530. `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 47 path(s)`. No `.log`/`.exe` and nothing under `.superpowers/sdd/2026-09-15-ui-kit-overview-book/` is staged; the only other tracked change in the tree (`docs/plans/2026-09-15-ui-kit-overview-book.md`, pre-existing, unstaged) is not mine.

Deleted (34):
- `web/app/book/`: BookBadDebt.tsx BookConcentration.tsx BookHistogram.tsx BookPositions.tsx BookRiskMap.tsx BookStatRows.tsx BookWaterfall.tsx bookDek.ts dust.ts headroomCurve.ts paretoView.ts positionRow.ts readingLines.ts riskBins.ts stressIncrements.ts useFullBookWalk.ts warnBand.ts waterfallView.ts (18). Verified by grep before deleting: none is imported by page.tsx / BookSurface.tsx / NeedsAttention / StressPreview / BookLegacy / BookMethodology or by anything else in app/components/lib. Kept exactly: page.tsx BookSurface.tsx book.module.css NeedsAttention.tsx StressPreview.tsx BookLegacy.tsx BookMethodology.tsx.
- `web/components/`: AppHeader.tsx (no importer), PostureRibbon.tsx (only importer: AppHeader), header.module.css (only importer: AppHeader; ThemeToggle already reads kit/kit.module.css, so the brief's "move the rule" step was already done).
- `web/components/charts/`: DensityMap.tsx, RiskMapLedger.tsx — **beyond the brief's list**. Their only importer was the retired BookRiskMap and both import `@/app/book/riskBins`; deleting riskBins without them fails typecheck. Ledgered.
- `web/tests/e2e/`: book-table.spec.ts (10/10 Book), r5-fixes.spec.ts (5/5), r7-fixes.spec.ts (6/6).
- `web/tests/unit/`: book-charts-copy, book-dek, book-row, book-table, dust, headroom-pareto, stress-increments, risk-bins (each imports a deleted app/book module).

Modified (13): trimmed book-charts, chart-spec-v4, w3l-slots, state-matrix, p0-fixes, p1a-fixes, p1b-fixes, r1-fixes, r3-fixes, r4-fixes, r6-fixes, r8-fixes; ledger appended to `.superpowers/sdd/progress-ui-overhaul.md` (section "2026-09-15 · Plan 1 (kit · Overview · Book) — pin retirement ledger", 276 lines, one line per retired test).

Components kept for Plan 4 (still imported): Ribbon (proof, styleguide), Stampline (inspector, lab, observatory, proof, styleguide ×2), StatCard (lab ×2, observatory, styleguide), ribbon.module.css (DegradationBanner, Ribbon), WaterfallSteps + charts.module.css (styleguide, remaining charts).

## 2. Method — an empirical inventory before deleting

1. Static inventory (brief Step 1): `goto("/book")` / `book-*` ids hit 26 e2e files, not 12. lab, r12–r17, runbook-bsplit, runbook-transition and shell only use the **Lab run-book panel's** ids (`book-result`, `book-engine`, `book-running`, `book-hole`, `book-excluded`) on `/lab`; they are out of scope and untouched.
2. Built HEAD (bbc0f00) and ran the **whole e2e suite before any deletion**: **138 failed / 323 passed / 10 skipped**. The served bundle is identical pre/post deletion (the retired modules were unreferenced), so this is the ground truth of what pins the retired surfaces.
3. Partitioned the 138 by the decision rule: **135** pin the retired Book / header (deleted, one ledger line each); **3** do not (kept, red; §4).
4. For the ambiguous ones I replayed the inputs on the new Book with a throwaway spec (deleted afterwards): the four p1b route-refusal tests (p1b-0 total_debt "", p1b-13 usd_decimals -0, p1b-14 computed_positions -0, p1b-15 waterfall index -0) all render the normal Cash headline with no route refusal and none of the forbidden figures (239,603,961 / "unshocked" / a generic error page); their throw sites were BookStatRows, BookBadDebt, useFullBookWalk and waterfallView, all deleted. Retired with the wire-guard law cited (tests/unit/wire-guard.spec.ts).
5. Trims were line-range cuts audited by printing the first/last line of every removed range; leftovers were found by typecheck (two over-cuts: `BOOK` in two Lab tests of chart-spec-v4, and `mockStreamBody`/`SSE_SNAPSHOT_FRAME` used by the feed `live:snapshot-never-history` cell — both restored) and eslint (six unused symbols, removed; lint now 0 warnings).

Retired per file (135): book-charts 14 of 17 (3 "Lab …" tests stay, header rewritten) · book-table 10 · chart-spec-v4 27 of 40 (13 frontier/run-book/cross tests on /lab stay, header rewritten) · w3l-slots 12 of 21 · state-matrix 15 of 53 cells (11 book, 4 shell × live:… on /book) · p0-fixes 3 · p1a-fixes 13 of 28 (p1a-4 ×7, p1a-9 F1/F2/F4 ×6; p1a-1 width/token pins pass on the new shell and stay; section headers rewritten) · p1b-fixes 6 · r1-fixes 10 (incl. the nav test that looked up a "Proof" link; the shell's tab is "Verification") · r3 3 · r4 5 · r5 5 · r6 4 · r7 6 · r8 2. Sum 135; 471 − 135 = 336 = the post-run total.

Tests I chose to keep although they touch /book: p1a-1 ×4 (main.shell widths and tokens — pass on the new shell), r1 "(6) not one numbered eyebrow survives on the seven surfaces" (passes), and every Lab test in the three "Book" files.

## 3. Verification (web/, production build)

| gate | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean, 0 warnings |
| `npm run lint:css` | clean |
| `npx playwright test --project=unit` | **1043 passed, 8 failed** (all 8 pre-existing, §4) · spec files 69 → 61 = 69 − 8 |
| `npm run build` | clean |
| `npx playwright test --project=e2e` | **323 passed, 3 failed, 10 skipped** (all 3 pre-existing, §4); before deletion 138 / 323 / 10 |

Unit-spec arithmetic: 69 before, 8 deleted, 61 after; no lib spec lost. book-sort-vocabulary (lib/positions), flip-ranking (app/lab/flipRanking) and book-fixture-fidelity (fixtures only) stay. Plan 1's new specs present: human-usd, materiality, cash-rows, book-headline, stress-preview, refusal-phrasebook, live-pill, cash-summary, demo-fixture-weld.

## 4. The two pre-existing reds (not retired code; reported, not fixed)

Both are red at HEAD bbc0f00 before any of my changes (the pre-deletion run proves the e2e ones; the unit spec was last touched at 0fc9263 and the fixtures it reads were added in 1ada8ba/5202ff9/bbc0f00).

**A. Kit nav overflows at narrow widths (3 e2e).** `state-matrix › inspector × responsive:mobile` (scrollWidth 619 at 390px), `chart-spec-v4 › AC-54: the loss frontier renders 12px at both breakpoints` and `… the run-book distributions …` (619 at the 360px NARROW breakpoint on /lab). Measured cause: `nav.kit-module__nav` is 603px wide — eight tabs, `.nav { display: flex; gap: 4px; }` in `web/components/kit/kit.module.css` with no wrap or scroll; the page content itself fits. This is Task 12's AppShell, not retired code, and mobile treatment is a design decision (wrap / horizontal scroll / overflow menu) I did not make. Spec §6 "Layout and responsiveness" is the authority.

**B. Demo fixtures vs the fixture clock law (8 unit).** `tests/unit/fixture-clock-law.spec.ts` enumerates every JSON under `tests/fixtures` and (i) forbids subdirectories ("nothing in the fixtures tree was skipped as noise" fails with `["demo"]`), (ii) requires every stated `age_seconds` to equal `served_at − max_updated_at` (demo/book.demo.json, demo/meta.demo.json, demo/positions-dm-demo-page-1.json, -page-2.json all state 1200 where the instants give 902570), and (iii) pins the trio census ("no fixture carries a trio the census does not name", "the total is pinned", "every batch-bearing body resolves at least one trio"). Task 11's demo dataset needs either clock-law-consistent ages/instants or an explicit, ledgered exemption in the enumerator.

## 5. Findings in the new surface (flagged, not touched)

- **Reopened -0 render site in BookLegacy**: with `engines[aave].computed_positions = -1e-324`, the legacy section renders "Positions 2 **-0 computed**" (replay evidence). Track B closed the -0 class at every render-reachable site (owner ruling 2026-08-10); the new legacy tile reads the population without the wireGuard. Task 13 / Plan 4.
- **The route-refusal boundary has no e2e pin from /v1/book any more** (p1b-0's throw site is gone and the new Book does not throw on those corruptions). `app/error.tsx` / `RouteRefusal` still exist; a pin needs a non-Book throw site.
- Prose-only references to `app/book/readingLines.ts` / `BookHistogram.tsx` remain in comments in `app/lab/labReadingLines.ts`, `labRunBookLines.ts`, `LabRunBookDetail.tsx` (provenance notes, not imports; outside this task's paths).

## 6. Self-review

- Brief vs facts: the brief's three "delete whole" Book e2e files were not Book-only (book-charts has 3 Lab tests, chart-spec-v4 has 13); I trimmed instead of deleting and rewrote their file headers to say so. The brief's ThemeToggle step was already done; skipped as instructed. DensityMap/RiskMapLedger were outside the brief's list but required by typecheck; ledgered.
- Every retired test has a ledger line with either the book.spec.ts title it moved to, the lib unit spec that still holds its law, or "copy/DOM of the retired surface"; the arms nothing re-pins are listed under "Recorded, not carried" (repeated-409 outpaced arm, engine switch, sort controls / deep links / windowing, LAW-5 marker, 429/500 load arms, COVERAGE chip and Data-status popover, live-pill snapshot/recovered arms in e2e, the Book's own mobile cell, the route-refusal e2e pin) — plus the two the brief named (the "All N accounts" link; the Collateral-mix section).
- No test was deleted to make a red go green: the 3 e2e + 8 unit reds are exactly the non-retired set, unchanged before/after.
- Line endings: the cutter preserved each file's endings (state-matrix and the ledger are CRLF); the staged diff is pure deletions plus small insertions, no whole-file churn. The `LF will be replaced by CRLF` warnings are the repo's autocrlf and are why the brief's commit uses `-c core.safecrlf=false`.
- Verified nothing dangles: typecheck, eslint (0 warnings), stylelint, build, and a grep sweep for every deleted module/component name across app, components, lib and tests (only the three prose comments above).

## 7. To finish (one command each, once the owner rules on §4)

```
# from the repo root; the index already holds exactly the intended commit (verify with `git diff --cached --stat`)
python roadmap/tools/scope_gate.py          # OK as of this report; claim valid until 2026-09-16T22:06Z (renew: python roadmap/tools/claim.py renew claude-integrator)
git -c core.safecrlf=false commit -m "chore(web): retire the old Book surface, its page-local modules and the pins that described it - ledgered"
```

If the owner prefers to land the nav fix first: commit it path-limited (`git commit -- web/components/kit/kit.module.css …`) so the staged retirement is not swept into it, re-run `npx playwright test --project=e2e`, then commit the staged set. If the owner rules the cleanup may land with the two pre-existing reds recorded, the ledger's "Verification" block already states them.
