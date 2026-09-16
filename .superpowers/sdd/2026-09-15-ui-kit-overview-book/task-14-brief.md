### Task 14: Retire the old Book surface, its page-local modules, and the pins that described them

**Files:**
- Delete: every file under `web/app/book/` except `page.tsx`, `BookSurface.tsx`, `book.module.css`, `NeedsAttention.tsx`, `StressPreview.tsx`, `BookLegacy.tsx`, `BookMethodology.tsx`
- Delete: `web/components/AppHeader.tsx`, `web/components/PostureRibbon.tsx`, `web/components/Ribbon.tsx`, `web/components/Stampline.tsx`, `web/components/StatCard.tsx`, `web/components/header.module.css`, `web/components/ribbon.module.css` — **only if** `find_referencing_symbols` (or `grep -rn "<Name>" web/app web/components`) shows no remaining importer outside the deleted set. Anything still imported by History/Activity/Verification/API pages stays until Plan 4 (convergence).
- Delete: `web/tests/e2e/book-charts.spec.ts`, `web/tests/e2e/book-table.spec.ts`, `web/tests/e2e/chart-spec-v4.spec.ts`; remove the Book-scoped tests inside `w3l-slots.spec.ts`, `state-matrix.spec.ts`, `p0-fixes.spec.ts`, `p1a-fixes.spec.ts`, `p1b-fixes.spec.ts`, `r1-fixes.spec.ts`, `r3-fixes.spec.ts` … `r8-fixes.spec.ts`
- Delete: unit specs whose subject was deleted (`book-charts-copy`, `book-dek`, `book-row`, `book-sort-vocabulary`, `book-table`, `book-fixture-fidelity`, `dust`, `flip-ranking`, `headroom-pareto`, `stress-increments` — check each import line; a spec that imports only from `web/lib/**` STAYS)
- Modify: `web/components/ThemeToggle.tsx` (move its one class into `kit.module.css`), `.superpowers/sdd/progress-ui-overhaul.md` (ledger)

**Decision rule per e2e test** (open each file; the retired-surface tests are those that `goto("/book")` or assert `book-*` test ids):
- The test pins an *invariant the new Book still owes* (refused never zero · null never zero · engine-withheld variant · 503 variant · 409 restart · the dek computed from the response · never summed · batch identity shown) → confirm the same invariant is asserted in the new `book.spec.ts` (Task 13 covers each of these); then delete the old test.
- The test pins *copy or DOM of the retired surface* (stat-row wording, heatmap geometry, dust chips, sort-remap acknowledgements, stampline slots, exact-bin ledgers, waterfall captions) → delete.
- Either way, one ledger line per deleted test: `- <file> · "<test title>" — retired: <invariant moved to book.spec.ts "<new title>" | copy/DOM of the retired Book surface>`.

- [ ] **Step 1: Inventory**

Run from `web/`:

```bash
grep -ln 'goto("/book\|goto(`/book\|getByTestId("book-' tests/e2e/*.spec.ts
grep -n '^test(\|^  test(\|^    test(' tests/e2e/w3l-slots.spec.ts tests/e2e/state-matrix.spec.ts tests/e2e/p0-fixes.spec.ts tests/e2e/p1a-fixes.spec.ts tests/e2e/p1b-fixes.spec.ts tests/e2e/r1-fixes.spec.ts tests/e2e/r3-fixes.spec.ts tests/e2e/r4-fixes.spec.ts tests/e2e/r5-fixes.spec.ts tests/e2e/r6-fixes.spec.ts tests/e2e/r7-fixes.spec.ts tests/e2e/r8-fixes.spec.ts
ls app/book
grep -ln "app/book\|\.\./\.\./app/book" tests/unit/*.spec.ts
```

Paste the inventory (file · test title · decision) into the ledger section before deleting anything.

- [ ] **Step 2: Delete the old Book modules and components; move the theme-toggle rule**

```bash
cd web/app/book && ls | grep -vE '^(page\.tsx|BookSurface\.tsx|book\.module\.css|NeedsAttention\.tsx|StressPreview\.tsx|BookLegacy\.tsx|BookMethodology\.tsx)$' | xargs git rm -q
```

For each candidate under `web/components/`, run `grep -rn "from \"@/components/<Name>\"\|from \"\.\./<Name>\"\|from \"\./<Name>\"" web/app web/components` and `git rm` only the ones with zero hits. Copy the `.themeToggle`-class rule (whatever `ThemeToggle.tsx` references from `header.module.css`) into `kit.module.css` under a `/* ---- theme toggle ---- */` heading and change the import in `ThemeToggle.tsx` to `./kit/kit.module.css`.

- [ ] **Step 3: Delete the retired specs, trim the mixed files**

`git rm` the three whole Book e2e files and the unit specs whose imports point at deleted modules. In the mixed e2e files delete the retired `test(...)` blocks and any now-unused imports/helpers. Add the ledger section:

```markdown
## 2026-09-15 · Plan 1 (kit · Overview · Book) — pin retirement ledger

Authority: docs/specs/2026-09-15-ui-product-register-design.md §7. The Book surface was rebuilt;
its page-local modules (app/book/*.ts) and the pins describing the old surface are retired.
Semantic invariants re-expressed in tests/e2e/book.spec.ts: refused never zero · null never zero ·
engine withheld whole · 503 no-batch · 409 walk restart · dek computed from the response ·
never summed · batch identity rendered. Not carried into Plan 1 (recorded, not lost): the
"All N accounts" explorer link and the Collateral-mix section (no per-asset collateral on /v1/book).

- tests/e2e/book-charts.spec.ts · (all 17) — retired: copy/DOM of the retired Book charts
- … one line per test …
```

- [ ] **Step 4: Prove nothing dangles**

Run: `npm run typecheck && npm run lint && npm run lint:css && npx playwright test --project=unit && npm run build && npx playwright test --project=e2e`
Expected: all green. `web/lib` unit spec files: count before and after — the count must not decrease (`ls tests/unit | wc -l` minus the deleted page-module specs equals the new count; list the new specs added by this plan: human-usd, materiality, cash-rows, book-headline, stress-preview, refusal-phrasebook, live-pill, cash-summary, demo-fixture-weld).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add -u web/app/book web/components web/tests
git add web/components/kit/kit.module.css web/components/ThemeToggle.tsx .superpowers/sdd/progress-ui-overhaul.md
python roadmap/tools/scope_gate.py
git commit -m "chore(web): retire the old Book surface, its page-local modules and the pins that described it - ledgered"
```

(`git add -u` stages only tracked deletions/modifications under those paths; verify with `git status --short` that no `.log` files were staged.)

---

