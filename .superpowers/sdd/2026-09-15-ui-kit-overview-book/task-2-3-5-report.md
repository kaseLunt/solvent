# Tasks 2, 3, 5 — implementation report

Batch: `humanUsd` (Task 2) → materiality partition (Task 3) → Book headline grammar (Task 5).
Three commits on `main`, in order. All commands run from `web/` unless noted; commits from the repo root.

| Task | Commit | Subject |
|---|---|---|
| 2 | `e50289d` | feat(web): humanUsd - compact, truncating, bigint money for headlines and tiles |
| 3 | `5d15bdd` | feat(web): materiality partition - the $100 line as a display rule with full counts kept |
| 5 | `9568508` | feat(web): book headline grammar - material, quiet and refused variants pinned verbatim |

Status: **DONE_WITH_CONCERNS** — one substantive deviation (a test fixture value), detailed under Task 3 and in Concerns.

---

## Task 2 — `humanUsd`

**Implemented:** `web/lib/human-usd.ts` exporting `DUST_DISPLAY`, `MINUS`, `humanUsd(value: bigint, decimals: number)`. Bigint throughout, truncating toward zero; tiers `$0` / `<$0.01` / cents-when-nonzero under $1,000 / grouped whole dollars to $9,999 / `K` / one-decimal `M` and `B`; U+2212 leading minus for negatives.

**RED** — `npx playwright test --project=unit tests/unit/human-usd.spec.ts`

```
Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\human-usd' imported from ...\web\tests\unit\human-usd.spec.ts
Error: No tests found.
exit=1
```
Expected: the brief predicts "cannot resolve `../../lib/human-usd`" — the module did not exist yet.

**GREEN** — same command after writing the implementation

```
Running 6 tests using 6 workers
  ✓ zero and dust
  ✓ under a thousand shows cents only when nonzero
  ✓ thousands group, no cents
  ✓ ten thousand and up in K, million and up in M with one decimal
  ✓ eight-decimal engines and negatives
  ✓ decimals of zero
  6 passed (2.5s)
```
`npm run typecheck` → exit 0. `npx eslint lib/human-usd.ts tests/unit/human-usd.spec.ts` → exit 0.

**Files:** `web/lib/human-usd.ts` (new), `web/tests/unit/human-usd.spec.ts` (new).

**Deviations from the brief's code:**
- Test: the unused `d6` helper removed, as the brief itself directs ("Remove the unused `d6` helper before running"). No other change; the implementation is byte-identical to the brief (verified by diff, see Self-review).

---

## Task 3 — Materiality partition

**Implemented:** `web/lib/materiality.ts` exporting `MATERIAL_LINE_USD = 100n`, `SMALL_LINE_USD = 1n`, `MaterialityTier`, `Sized`, `MaterialityPartition<T>`, `materialityTier`, `partitionByMateriality`, `belowLineSentence`. Tiers closed at the top (≥ $100 material, ≥ $1 small, else dust); the partition keeps every row and reports full sums and counts per tier plus `belowLine = small + dust`; the sentence delegates money formatting to `humanUsd`, so sub-cent totals print `<$0.01`.

**RED** — `npx playwright test --project=unit tests/unit/materiality.spec.ts`

```
Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\materiality' imported from ...\web\tests\unit\materiality.spec.ts
Error: No tests found.
exit=1
```
Expected: "module not found" per the brief.

**Intermediate run — brief's test verbatim against brief's implementation verbatim** (this is the evidence for the deviation below):

```
  ✓ the lines are $100 and $1, tiers are closed at the top
  ✓ partition keeps every row, sums by tier, and belowLine = small + dust
  ✓ dust that is sub-cent still prints as <$0.01 in the sentence
  ✘ the below-line sentence, plural and singular, and absent at zero
    Expected: "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined."
    Received: "47 more positions are technically liquidatable but total $112.40 — below the $100 line and not headlined."
  1 failed / 3 passed
```

**GREEN** — same command after the one-token fixture change (`usd6(112.4)` → `usd6(112)`)

```
  ✓ the lines are $100 and $1, tiers are closed at the top
  ✓ partition keeps every row, sums by tier, and belowLine = small + dust
  ✓ the below-line sentence, plural and singular, and absent at zero
  ✓ dust that is sub-cent still prints as <$0.01 in the sentence
  4 passed (2.3s)
```
`npm run typecheck` → exit 0 (run both before and after the fixture edit). `npx eslint lib/materiality.ts tests/unit/materiality.spec.ts` → exit 0.

**Files:** `web/lib/materiality.ts` (new), `web/tests/unit/materiality.spec.ts` (new).

**Deviations from the brief's code:**
- Test, one line: `belowLineSentence({ belowLine: 47 }, { belowLine: usd6(112.4) }, 6)` → `usd6(112)`.
  - Reason: the brief's test and the brief's implementation cannot both stand. `belowLineSentence` formats via `humanUsd`, whose Task 2 rule (pinned by the Task 2 test `humanUsd(239_603_961n, 6) === "$239.60"`) shows cents when nonzero under $1,000, so `usd6(112.4)` renders `$112.40`; the test pins `total $112`. The conflict is inherited from the plan (`docs/plans/2026-09-15-ui-kit-overview-book.md` lines 317–318 and 753–762), not a transcription error. The spec (§3.3) gives `"... but total $112"` only as an illustrative sentence and does not fix the underlying sum.
  - Why this fix and not the other: it keeps the implementation byte-identical to the brief and keeps the pinned headline string verbatim (the parent's stated binding rule), and it matches the spec's example sentence exactly. The alternative — keep `usd6(112.4)` and change the expected string to `"... total $112.40 — ..."` — is a one-line flip in each of the Task 3 and Task 5 tests if the controller prefers it. The singular case (`$4.62`) and the sub-cent case (`<$0.01`) still exercise `humanUsd`'s cents path inside the sentence.
- Implementation: none (byte-identical to the brief).

---

## Task 5 — The Book headline grammar

**Implemented:** `web/lib/book-headline.ts` exporting `Sum`, `BookHeadlineInput`, `Headline`, `nearCapSentence`, `notComputedSentence`, `bookHeadline`, `bookHeadlineRefused`. Material variant (tone `crit`) leads with money in the emphasis and the account count in `rest`; quiet variant (tone `ok`) leads the dek with the below-line sentence or "No position is liquidatable."; refused variant capitalizes the cause and closes it with a period. Singular/plural agreement throughout.

**RED** — `npx playwright test --project=unit tests/unit/book-headline.spec.ts`

```
Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-headline' imported from ...\web\tests\unit\book-headline.spec.ts
Error: No tests found.
exit=1
```
Expected: "module not found" per the brief.

**GREEN** — same command after writing the implementation

```
  ✓ material: money first, the emphasized phrase carries the verdict
  ✓ material, singular everywhere
  ✓ quiet: nothing material — the dek leads with the below-line count
  ✓ quiet with nothing liquidatable at all
  ✓ refused: the whole engine withheld
  5 passed (2.3s)
```
`npm run typecheck` → exit 0. `npx eslint lib/book-headline.ts tests/unit/book-headline.spec.ts` → exit 0.

**Files:** `web/lib/book-headline.ts` (new), `web/tests/unit/book-headline.spec.ts` (new).

**Deviations from the brief's code:**
- Test, one line: `belowLine: { sum: usd6(112.4), count: 47 }` → `usd6(112)` in the first test. Same deviation as Task 3 for the same reason: this test feeds the identical below-line input through the identical `belowLineSentence` and pins the identical `total $112` substring in the dek, so it fails identically (`$112.40`) with the brief's fixture. Applied up front rather than re-reproducing the already-evidenced failure. All pinned strings are verbatim.
- Implementation: none (byte-identical to the brief).

---

## Final combined run and lint

`npx playwright test --project=unit tests/unit/human-usd.spec.ts tests/unit/materiality.spec.ts tests/unit/book-headline.spec.ts`

```
Running 15 tests using 10 workers
  ... 15 ✓ ...
  15 passed (2.4s)
exit=0
```

`npm run lint` (`eslint .` over the whole web project)

```
> solvent-web@0.1.0 lint
> eslint .
exit=0
```

Note on the test runner: `playwright.config.ts` declares a `webServer` (`npm run start` on :3111, `reuseExistingServer` outside CI) that Playwright launches for every project, including `unit`. No server was listening on 3111 at the start; a production build (`web/.next/BUILD_ID`) existed, so `next start` came up within the 60s timeout on each run and Playwright tore it down afterwards. Nothing from the runs was left untracked under `web/` (`test-results/` and `playwright-report/` are gitignored).

---

## Self-review

- **Verbatim transcription, verified mechanically.** Each brief's Step 1 and Step 3 code blocks were extracted with awk and diffed against the committed files:
  - `web/lib/human-usd.ts`, `web/lib/materiality.ts`, `web/lib/book-headline.ts`: IDENTICAL.
  - `web/tests/unit/human-usd.spec.ts`: differs only by the removed `d6` helper (brief-directed).
  - `web/tests/unit/materiality.spec.ts`: differs only at line 42 (`usd6(112.4)` → `usd6(112)`).
  - `web/tests/unit/book-headline.spec.ts`: differs only at line 10 (`usd6(112.4)` → `usd6(112)`).
- **Every test in the briefs is present and asserting:** 6 + 4 + 5 = 15, all passing; no `test.skip`/`test.only`.
- **No extra exports, no dead code:** the export surfaces equal the briefs' "Produces" lists (Task 3 additionally exports `MaterialityPartition<T>`, which is in the brief's implementation block and is the return type of a public function). The `d6` helper was dropped rather than kept.
- **No existing lib file modified:** each commit adds exactly two new files (`git show --stat` on `e50289d`, `5d15bdd`, `9568508`).
- **Staging hygiene:** files staged by name only; `git diff --cached --name-status` before each commit showed exactly the brief's two paths; after the last commit nothing is staged and `git status --short -- web/ roadmap/` is empty.
- **Scope gate:** `scope-gate: OK -- integrator claude-integrator; 2 path(s)` before each of the three commits. The claim (`roadmap/claims/CLAIM-claude-integrator.md`) had `lease_expires: 2026-09-16T22:06:26Z` against a run time of 2026-09-16T00:48Z, so no renewal commit was needed or made.
- **Commit messages:** the briefs' messages verbatim; `git log -3 --format=%B` contains no `Co-Authored-By` or other attribution lines. Committed with `git -c core.safecrlf=false`. Branch `main`, no worktree.
- **Name check:** no pre-existing `humanUsd`, `DUST_DISPLAY`, `MINUS`, `materialityTier`, `partitionByMateriality`, `belowLineSentence`, `bookHeadline*`, `nearCapSentence`, `notComputedSentence` anywhere under `web/`. (`web/lib/book-format.ts` and `web/lib/factor.ts` each already export a `MINUS_SIGN = "−"` — same glyph, different name; not a collision, noted for a later consolidation pass if wanted.)

## Concerns

1. **Fixture deviation (Tasks 3 and 5) — needs a controller ruling, though the code is unaffected either way.** The plan pins `total $112` for a below-line sum of `usd6(112.4)`, which contradicts the plan's own `humanUsd` rule and the Task 2 test. I resolved it by changing the fixture to `usd6(112)` (pinned strings and implementations untouched). If the intended reading is instead that the sentence should show `$112.40`, flip the two expected strings and restore `usd6(112.4)` — two one-line test edits, no implementation change. If the intended reading is that prose sentences should drop cents (whole dollars only), that is a genuine behavior change to `belowLineSentence` and would also contradict the singular pin (`totals $4.62`), so I did not take it. The plan file (`docs/plans/2026-09-15-ui-kit-overview-book.md`, lines 317 and 753) still carries `usd6(112.4)`; I did not edit it (outside the briefs' file lists).
2. **Three `−` constants now exist in `web/lib`** (`MINUS` here, `MINUS_SIGN` in `book-format.ts` and `factor.ts`). Harmless duplication; the brief mandates the `MINUS` export, so I followed it.
3. **Unit runs depend on `next start`.** Not introduced by this batch, but worth knowing: a unit-only run will fail on a machine with no `web/.next` build and nothing on :3111 (the shared `webServer` cannot start). All runs here succeeded because a build was present.
