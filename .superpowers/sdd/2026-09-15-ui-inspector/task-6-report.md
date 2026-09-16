# Task 6 report: `inspector-headline` — the §3.5 templates and the honest extra states

**Status:** DONE
**Commit:** `c9c21be4aa3fabc21554554a74dcf29c1c8998fd` on `main`
**Message:** `feat(web): the Inspector headline grammar - the five spec templates and the honest extra states, pinned verbatim`

## What I did

Followed the brief's TDD order exactly.

1. **Pre-flight against the landed modules.** Confirmed by symbol lookup that every import the brief's module makes resolves to the shape the brief assumes:
   - `web/lib/inspector-position.ts`: `LEGACY = "aave_v3_etherfi"`; `ComputedCash = CashPosition & { debt: bigint; cap: bigint; room: bigint; computed: true; status: "liquidatable" | "near" | "healthy" }`; `CashPosition.decimals: number`, `roomPercent: string | null`, `usedPercent: string | null` (so the `?? "—"` fallbacks are needed for type honesty, as the brief says).
   - `web/lib/room-history.ts`: `Streak { batches: number; spanSeconds: number | null }`.
   - `web/lib/human-price.ts`: `humanUsdFull(value: bigint, decimals: number)` — grouped whole dollars at ≥ $1,000, cents below, U+2212 for negatives.
   - `web/lib/freshness.ts`: `humanAge(390)` → `"6m"`.
   - `web/lib/refusal-phrasebook.ts`: `plainCause(code, detail?)` — a known code returns the phrasebook entry regardless of `detail`, so passing `""` for empty details is fine (the brief's Step 4 fallback of passing `undefined` was not needed).
   - `web/tests/unit/helpers/cash-position.ts`: `near(overrides?)` — cap `5012500000`, debt `4822000000`, decimals 6.
   - ESLint is `eslint-config-next/typescript` (typescript-eslint `recommended`, not `strict`), so the brief's `s[0]!` in `capitalize` is not a lint violation.

2. **Step 1 — the spec, verbatim.** Created `web/tests/unit/inspector-headline.spec.ts` with the brief's seven tests character-for-character, including the typographic characters (U+2014, U+201C/U+201D, U+2026, U+2248). Written with the Write tool rather than a shell heredoc to guarantee byte-exact UTF-8.

3. **Step 2 — red.** `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts` failed with:
   `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\inspector-headline'` — the expected module-not-found failure.

4. **Step 3 — the module, verbatim.** Created `web/lib/inspector-headline.ts` with the brief's code unchanged.

5. **Step 4 — green.** Exact output line:

   ```
   7 passed (2.3s)
   ```

   All seven tests passed on the first run; no pinned string needed a diff and no expectation was changed.

6. **Gates before commit** (from `web/`):
   - `npm run typecheck` → exit 0 (the `pretypecheck` step rebuilt `@solvent/client` first).
   - `npm run lint` → exit 0.
   - Byte check on both files: no BOM, LF line endings, em dash ×10 / ×15, curly quotes ×4 / ×4, ellipsis ×1 / ×1, `≈` ×1 / ×1 (module / spec).

7. **Step 5 — commit** (from the repo root):
   - `git add web/lib/inspector-headline.ts web/tests/unit/inspector-headline.spec.ts` — staged exactly two `A` entries.
   - `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 2 path(s)`.
   - `git commit -m "<brief's message>" -- <the two paths>` → `[main c9c21be]`, `2 files changed, 254 insertions(+)`. The pre-commit control-plane doctor reported `OK -- 0 error(s), 0 warning(s), 5 info` (the five infos are pre-existing REVIEW-DUE notices on roadmap objects, unrelated to this task). No `index.lock` retry was needed.
   - No `Co-Authored-By` or other attribution lines in the message.

## Deviations from the brief

None in code or test content. Both files are the brief's text verbatim.

Process notes only:
- Git printed `LF will be replaced by CRLF the next time Git touches it` for both new files. That is the repo's `autocrlf` normalisation warning about the working copy; the committed blobs are LF-only (verified with `git show HEAD:<path>`), which matches the rest of the repo.
- I did not touch `.superpowers/sdd/.gitignore` or any other file; the pre-existing `M` on that path in the working tree is not mine and was not staged.

## Concerns

None blocking. One observation for the reviewer, not a deviation: `otherEngineHeadline`'s non-legacy `dek` ("Only the Cash book and the legacy Aave v3 market are read here.") is not pinned by the spec — the test uses `toMatchObject` on the legacy case and only checks `emphasis` for the `morpho_blue` case. It is the brief's exact text, so it is covered by the verbatim rule, but nothing asserts on it.

---

# Fix round 1

**Status:** DONE
**Commit:** `16d57105d1bbbc59a749d9c676502ba0b87537bb` on `main` (parent `01d28f5`)
**Message:** `fix(web): headline review round - a zero cap has no used clause, legacy and foreign engines are told apart, sentences end once, a non-positive streak span is not printed`
**Files:** `web/lib/inspector-headline.ts` (+68/−…), `web/tests/unit/inspector-headline.spec.ts` (+43/−…); `2 files changed, 90 insertions(+), 21 deletions(-)`. Nothing else touched.

## Module changes (`web/lib/inspector-headline.ts`)

1. **Zero cap has no used clause.** `cashHeadline` builds `used = p.usedPercent === null ? "" : " — {usedPercent} used"` and the base sentence is `Borrowing {debt} against a {cap} cap{used}.` The three `roomPercent ?? "—"` fallbacks in the near/healthy arms stay as type honesty (unreachable: a band requires a positive cap).
2. **Legacy and foreign engines told apart.** `otherEngineHeadline` partitions `engines` into legacy (`=== LEGACY`) and foreign (mapped through `engineName`). Legacy present → emphasis `…; a legacy Aave v3 position exists.` and dek = the legacy dek plus ` A position on X is not read here.` / ` Positions on X and Y are not read here.` when foreign is non-empty. Foreign only → `…; a position exists on X, which this page does not read.` / `…; positions exist on X and Y, which…` with the foreign dek. Empty `engines` (defensive) → `No Cash position in batch N.` with the foreign dek. The two deks are module constants `LEGACY_DEK` / `FOREIGN_DEK`.
3. **`cannotComputeHeadline([])` reads as a sentence.** Subject is `the book is` when no engine is named; the dek is the second sentence alone. Repeated causes are deduped (`Array.from(new Set(…))`) before the `"; "` join. Engine names are not deduped (not requested).
4. **`sentence(fragment)` helper.** Trims surrounding whitespace, strips exactly one trailing period (`/\.$/u`), capitalises with `charAt(0)`, returns `""` for an empty fragment. A `paragraph(...sentences)` helper joins non-empty sentences with one space, so an empty cause leaves no leading `. `. Used in `cannotComputeHeadline`, `notComputedHeadline`, `unavailableLookupHeadline`. The old `capitalize` (with `s[0]!`) is gone.
5. **Streak parenthesis only for a positive span.** `s.spanSeconds !== null && s.spanSeconds > 0` gates the `(≈…)`; 0 or negative prints `for the last N batches.` with no parenthesis.
6. **`Streak.newestKind`.** The module needed no change; the import compiles against the new required field.

## Spec changes (`web/tests/unit/inspector-headline.spec.ts`)

- Existing pins: every pinned string is byte-identical. The three existing streak literals gained `newestKind: "computed"` (input only, no expectation changed) because Task 5's fix made `Streak.newestKind: RoomPointKind | null` required — without it `tsc` failed with `TS2741` at lines 32/38/39.
- New imports: `readFileSync` (`node:fs`), `path` (`node:path`), `fileURLToPath` (`node:url`), `INVALID_ADDRESS_COPY`; `const here = path.dirname(fileURLToPath(import.meta.url))` as in the sibling specs.
- ONE new `test(...)` block pinning: the zero-cap liquidatable dek prefix `Borrowing $4,822 against a $0 cap. $4,822 over the line`; `otherEngineHeadline(7, ["aave_v3_etherfi", "morpho_blue"])` emphasis + dek (legacy dek + ` A position on morpho_blue is not read here.`); `otherEngineHeadline(7, ["morpho_blue", "compound_v3"])` emphasis (`positions exist on morpho_blue and compound_v3`) + foreign dek; the two-engine `cannotComputeHeadline` dek (`Collateral-flag custody unproven; collateral sweep never ran. A withheld book…`); `notComputedHeadline("collateral sweep timed out.", null).dek` → `Collateral sweep timed out. No verdict is served for it.`; streak `{ batches: 14, spanSeconds: 0, newestKind: "computed" }` → dek contains `for the last 14 batches.` and not `(≈`; and `readFileSync(components/kit/AddressField.tsx)` contains `INVALID_ADDRESS_COPY` as a substring (no component import into the unit runner).

## Gates

- `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts` → exact line:

  ```
  8 passed (2.4s)
  ```

- `npm run typecheck` → exit 0. (First attempt exited 2 with three `TS2741 Property 'newestKind' is missing` errors on the pre-existing streak literals — Task 5's `Streak` change had landed on disk between my dependency check and the typecheck; fixed per the coordinator's follow-up note, re-run clean.)
- `npm run lint` → exit 0.
- Byte check: no BOM, zero CR bytes in both working files and both committed blobs; module U+2014 ×9, curly quotes ×4, U+2026 ×1, U+2248 ×1; spec U+2014 ×19, curly quotes ×6, U+2026 ×1, U+2248 ×2.
- `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 2 path(s)`; pre-commit control-plane doctor `OK -- 0 error(s), 0 warning(s), 5 info` (the same five pre-existing REVIEW-DUE infos). No `index.lock` retry needed. No attribution lines.

## Deviations / notes

- `sentence()` also trims surrounding whitespace before stripping the one trailing period — a small superset of "trims one trailing period" (the review's suggested helper did the same); no pinned output changes.
- The review's Minor #5 proposed non-empty tuple parameter types; the coordinator chose defensive runtime branches for empty arrays instead, which is what landed. The signatures are unchanged (`readonly T[]`).
- `cannotComputeHeadline` dedupes causes only, as instructed; a repeated engine would still print `the Cash and Cash books are withheld`.
- The new kit-copy pin reads `components/kit/AddressField.tsx` by path; moving that file fails the test with ENOENT, which is the intended loud failure.
