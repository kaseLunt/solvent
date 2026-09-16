# Task 2 report — `percent` and `human-price`

**Status:** DONE_WITH_CONCERNS
**Commit:** `c0f9498da6ef6ca4373ec1db8d20fd8a7cbf333f` on `main`
**Message:** `feat(web): exact percent, unit-price and token-amount strings for the Inspector - bigint only, truncating` (body empty; no attribution lines)

## Files (exactly the four the brief names)

- `web/lib/percent.ts` — verbatim from the brief (Step 3)
- `web/lib/human-price.ts` — verbatim from the brief (Step 3)
- `web/tests/unit/percent.spec.ts` — from the brief, with two pins corrected (see Deviation)
- `web/tests/unit/human-price.spec.ts` — verbatim from the brief

Nothing else was touched. The report file itself lives in the already-untracked `.superpowers/sdd/2026-09-15-ui-inspector/` and was not staged or committed. `.superpowers/sdd/.gitignore` was not modified.

## What I did, in the brief's order

1. Confirmed preconditions: `web/lib/human-usd.ts` exports `MINUS` (U+2212) and `DUST_DISPLAY` (`"<$0.01"`); none of the four target files existed; `web/.next` exists; the Playwright `unit` project matches `**/unit/**/*.spec.ts`.
2. **Step 1** — wrote both specs verbatim. Verified the U+2212 glyphs survived the write (2 in percent.spec, 3 in human-price.spec; no U+FFFD).
3. **Step 2** — ran the two specs. Both failed as expected:
   `Error: Cannot find module '...\web\lib\percent'` and `Error: Cannot find module '...\web\lib\human-price'`.
4. **Step 3** — wrote both modules verbatim.
5. **Step 4 (first run)** — `5 passed, 1 failed`. The failure was the brief's own first `percentTenths` pin:
   ```
   Expected: 962n
   Received: 961n
   > 5 |   expect(percentTenths(4822000000n, 5012500000n)).toBe(962n); // 96.20…
   ```
6. Corrected two pins in `percent.spec.ts` (see Deviation), re-ran.
7. **Step 4 (final run)** — exact output line: **`6 passed (2.2s)`**
   Command: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts` (from `web/`).
8. `npm run typecheck` → exit 0. `npm run lint` → exit 0.
9. **Step 5** — staged the four files by name (`git diff --cached --name-status` showed exactly 4 `A` entries), `python roadmap/tools/scope_gate.py` printed `scope-gate: OK -- integrator claude-integrator; 4 path(s)`, committed with the brief's exact message.

## Deviation from the brief (test side only; modules are verbatim)

Two literal pins in the first `percentTenths` test disagree with the brief's own stated interface ("⌊1000·num/den⌉ toward zero"), its own test title ("truncates toward zero"), and its own implementation (`(1000n * num) / den`). I corrected the pins rather than bend the module, because making them pass would require rounding (contradicting the interface and the repo's truncate-never-up money doctrine) plus an odd pre-division for the second case.

| Line | Brief | Committed | Why |
|---|---|---|---|
| 5 | `toBe(962n); // 96.20…` | `toBe(961n); // 4822 / 5012.5 = 96.199… — truncates toward zero, never up` | 4822 / 5012.5 = 0.961995…; ×1000 truncated = 961. The brief's comment "96.20…" misplaces the decimal expansion (5012.5 × 0.962 = 4822.025 > 4822). |
| 7 | `expect(percentTenths(-1n, 3n)).toBe(0n);` | `expect(percentTenths(-1n, 3n)).toBe(-333n); // toward zero (floor would give −334)` | 1000 × (−1) / 3 = −333.33…; toward zero = −333. Zero would only follow from dividing first and scaling after, which is not what the interface or code says. −333 is also the pin that actually distinguishes toward-zero from floor (−334). |

Evidence: the Step-4 failure above for line 5; for line 7 (never reached in that run because line 5 failed first) a direct bigint check `(1000n * -1n) / 3n` → `-333n` before I touched the spec.

All other pins in both specs held on the first pass against the verbatim modules.

## Ambiguity resolutions applied (as instructed by the parent)

- `humanPrice(0n, 6)` → `"$0.0000"` (pinned by the brief's test; the verbatim module already does this).
- `humanAmount` with `decimals === 0` → grouped whole part only (`humanAmount(5n, 0)` → `"5"`).
- Negatives in both modules print U+2212 (`MINUS`), never ASCII `-` (pinned: `"−$1.2500"`, `"−$387.50"`, `"−150"`, `"−3.8%"`).

## Concerns for the reviewer

1. **Downstream expectation of "96.2%".** The numbers 4,822 / 5,012.50 / 190.50 look like a demo account (debt, some ceiling, the room between them). Under truncation the share reads **`96.1%`** while the fall/room reads **`3.8%`** — they do not sum to 100%, and if the mockup or a later task (headline grammar, page test) pins `96.2%` for this pair, it will not match. This is inherent to truncating both directions independently, not a bug in this module. If the plan wants the complement to sum, the headline should derive one from the other rather than compute both.
2. Git emitted the usual `LF will be replaced by CRLF` autocrlf warnings on add for the four new files. Cosmetic; consistent with how the repo already stores files.
3. The first failing run left a `web/test-results/` directory (Playwright's error-context artifact). I did not stage it; it is not part of the commit.

---

# Fix round 1

**Status:** DONE
**Commit:** `a755bb0e08336c2c73f4594b080b928c9e36d9bc` on `main` (body empty; no attribution lines)
**Message:** `fix(web): a nonzero token amount never prints as 0 - sub-precision amounts read <0.0001; fallPercent refuses a negative fall`

## Changes (the coordinator's three items, nothing more)

1. **`humanAmount` (`web/lib/human-price.ts`)** — a nonzero value whose digits all truncate away now reads `<0.0001` (for `maxFraction = 4`), never `0`; `<1` when `maxFraction = 0`. Implemented as a small `belowPrecision(places)` helper (`places === 0 ? "<1" : "<0." + zeros(places−1) + "1"`) applied only when `units === 0n && value !== 0n` and the trimmed fraction is empty. Negative dust keeps the sign in front via the existing negative branch: `humanAmount(-1n, 18)` → `−<0.0001`, matching `humanUsd`'s `−<$0.01`. `maxFraction` is clamped with `Math.max(0, maxFraction)` before the slice, so `-1` behaves as `0` (previously `slice(0, -1)` silently dropped the last digit — `1234n/2 → "12.3"`, which the new pin would have caught).
2. **`fallPercent` (`web/lib/percent.ts`)** — also returns `null` when `to < 0n`. Doc comments corrected: `percentTenths` reads "⌊1000 · num / den⌋ toward zero" (matching brackets); `fallPercent` reads "Null for a rise, a negative `to`, or `from` ≤ 0" (so `to === from` → `"0%"` is explicitly legitimate).
3. **Pins** — one new `test(...)` block appended to each spec; no existing block altered.
   - `human-price.spec.ts`: `humanAmount(1n, 18)` → `<0.0001`; `humanAmount(99990000000000n, 18)` → `<0.0001`; `humanAmount(-1n, 18)` → `−<0.0001`; `humanAmount(5n, 2, 0)` → `<1`; `humanAmount(1234n, 2, 1)` → `12.3`; `humanAmount(1234n, 2, 6)` → `12.34`; `humanAmount(1234n, 2, -1)` → `12`; `humanPrice(10000000n, 6)` → `$10.00`; `humanPrice(9999900n, 6)` → `$9.9999`; `humanUsdFull(-5n, 6)` → `−<$0.01`.
   - `percent.spec.ts`: `fallPercent(-5n, 100n)` → `null`; `formatTenths(percentTenths(-1n, 3000n) ?? 0n)` → `"0%"` (BigInt has no −0, so `−0%` cannot occur — the pin documents it).

## Evidence

- **Red** (new pins against the c0f9498 modules): `2 failed / 6 passed` — `Expected: "<0.0001" / Received: "0"` in the humanAmount block, and `Received: "105%"` where `fallPercent(-5n, 100n)` must be `null`.
- **Green** — exact output line: **`8 passed (2.2s)`**
  Command: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts` (from `web/`).
- `npm run typecheck` → exit 0. `npm run lint` → exit 0.
- Staged exactly the four files by name (`git diff --cached --name-status` showed four `M` entries and nothing else). `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 4 path(s)`.
- Because another implementer was committing concurrently, the commit was issued with an explicit pathspec (`git commit -m … -- <the four files>`) so no foreign staged file could ride along; an `index.lock` retry (wait 5 s, retry once) was wired in but not triggered.

## Concerns

None new. The truncation-complement note from round 1 (share `96.1%` vs fall `3.8%` for the 4,822 / 5,012.50 pair) still stands for downstream tasks.
