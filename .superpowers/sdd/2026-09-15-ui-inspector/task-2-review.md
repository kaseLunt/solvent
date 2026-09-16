# Task 2 review — `percent` and `human-price`

**Range reviewed:** `40d7a7f..c0f9498` (one commit, `c0f9498`)
**Verdicts:** SPEC ✅ · QUALITY approved (one Important follow-up for the controller to adjudicate; nothing blocks this commit)

## How the evidence was gathered

- Read the brief, the implementer's report and the review package in that order.
- `git diff --name-status 40d7a7f..c0f9498` → exactly four `A` entries; `git diff --stat 40d7a7f..c0f9498 -- web/lib/human-usd.ts` → empty.
- Read `web/lib/human-usd.ts` symbolically (Serena `get_symbols_overview`, `find_symbol`): `MINUS = "−"` (U+2212) and `DUST_DISPLAY = "<$0.01"` are exported at lines 7 and 6; `groupThousands` (line 10) and `scaleDown` (line 15) are module-private.
- Scanned the four committed files: zero `Number(` / `parseFloat` / `parseInt` / `Math.` hits, zero U+FFFD, zero ASCII `-` inside string literals. The two modules contain no U+2212 literal themselves (they import `MINUS`); each spec contains three.
- Transpiled the real modules (`typescript.transpileModule` → CJS in the scratchpad) and ran ~55 edge-case probes; results quoted below.
- Re-ran `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts` → `6 passed (2.3s)`. Ran `npm run typecheck` → exit 0.

## The two adjudicated pins, verified independently

| Pin | Brief | Committed | Arithmetic |
|---|---|---|---|
| `percentTenths(4822000000n, 5012500000n)` | `962n` | `961n` | 5,012,500,000 × 961 = 4,817,012,500,000 ≤ 4,822,000,000,000 < 4,822,025,000,000 = 5,012,500,000 × 962. The truncated quotient is 961; 962 would require rounding up. |
| `percentTenths(-1n, 3n)` | `0n` | `-333n` | 1000 × (−1) / 3 = −333.33…; BigInt `/` truncates toward zero → −333 (floor would give −334; 0 would require dividing before scaling). |

Both corrections are right. They are compliant with the brief's stated interface ("toward zero"), not deviations. The `formatTenths(962n)` pin at `percent.spec.ts:13` stays valid as a pure formatting case.

---

## A. SPEC COMPLIANCE

### Files (brief "Files")

| Requirement | Evidence | |
|---|---|---|
| Create `web/lib/percent.ts` | diff `web/lib/percent.ts` (new file, 30 lines) | ✅ |
| Create `web/lib/human-price.ts` | diff `web/lib/human-price.ts` (new file, 44 lines) | ✅ |
| Test `web/tests/unit/percent.spec.ts` | diff (new file, 26 lines) | ✅ |
| Test `web/tests/unit/human-price.spec.ts` | diff (new file, 33 lines) | ✅ |
| Nothing else touched; `web/lib/human-usd.ts` untouched | name-status shows 4 × `A` only; `human-usd.ts` stat empty | ✅ |

### Interfaces

| Interface | Evidence | |
|---|---|---|
| `percentTenths(num, den): bigint \| null`, ⌊1000·num/den⌉ toward zero, null when den ≤ 0 | `percent.ts:7-10` — `if (den <= 0n) return null; return (1000n * num) / den;` | ✅ |
| `formatTenths(tenths): string` — "96.2%", "50%", "−3.8%" with U+2212 | `percent.ts:12-18`; `MINUS` imported at `percent.ts:4`; probe `formatTenths(-5n)` → `"−0.5%"` [U+2212] | ✅ |
| `percentOf(num, den): string \| null` | `percent.ts:21-24` composes the two | ✅ |
| `fallPercent(to, from): string \| null`, null when from ≤ 0 or to > from | `percent.ts:27-30` — `if (from <= 0n \|\| to > from) return null;` | ✅ |
| `humanPrice(value, decimals)` — under $10 → 4 places, else 2; grouped; truncating; U+2212 | `human-price.ts:15-22`; boundary probes: `humanPrice(10000000n, 6)` → `"$10.00"`, `humanPrice(9999999n, 6)` → `"$9.9999"`, `humanPrice(9999950n, 6)` → `"$9.9999"` (truncates, never rounds up to `$10.0000`), `humanPrice(123456789n, 2)` → `"$1,234,567.89"` | ✅ |
| `humanAmount(value, decimals, maxFraction = 4)` — grouped whole, fraction truncated to `maxFraction`, trailing zeros dropped | `human-price.ts:37-44`; probes: `humanAmount(1234n, 2, 10)` → `"12.34"` (never exceeds available digits), `humanAmount(123456789n, 6, 10)` → `"123.456789"`, `humanAmount(100001n, 6)` → `"0.1"` | ✅ |
| `humanUsdFull(value, decimals)` — humanUsd rules below $10,000, grouped whole dollars above, never K/M/B, `<$0.01` sub-cent, `$0` only for true zero, U+2212 | `human-price.ts:25-34`; `value === 0n` check (line 27) precedes the dust check (line 29); probe `humanUsdFull(10n ** 21n, 6)` → `"$1,000,000,000,000,000"`; `humanUsdFull(100099n, 2)` → `"$1,000"` (cents dropped at ≥ $1,000, same as `humanUsd`) | ✅ |

### Test pins (brief Step 1), each checked against the committed spec and the passing run

`percent.spec.ts`
- L5 `percentTenths(4822000000n, 5012500000n)` → `961n` (corrected; see above) ✅
- L6 `percentTenths(190500000n, 5012500000n)` → `38n` ✅
- L7 `percentTenths(-1n, 3n)` → `-333n` (corrected; see above) ✅
- L8–9 `percentTenths(1n, 0n)`, `percentTenths(1n, -5n)` → null ✅
- L13–16 `formatTenths` 962n→"96.2%", 500n→"50%", −38n→"−3.8%", 0n→"0%" ✅
- L20–21 `percentOf(4200000000n, 8400000000n)`→"50%", `percentOf(1n, 0n)`→null ✅
- L22–25 `fallPercent` 4009500000/4200000000→"4.5%" (190,500,000 × 1000 / 4,200,000,000 = 45.35… → 45), to===from→"0%", 5/4→null, 1/0→null ✅

`human-price.spec.ts`
- L5–12 `humanPrice` eight pins incl. `"−$1.2500"` (U+2212) and `"$0.0000"` ✅
- L16–23 `humanUsdFull` eight pins incl. `"<$0.01"`, `"$0"`, `"−$387.50"`, `"$1,234,567"` ✅
- L27–32 `humanAmount` six pins incl. `"0.6562"` (truncated from 0.65625), `"−150"`, `"5"` at decimals 0 ✅

### Steps

| Step | Evidence | |
|---|---|---|
| 1 Failing specs written | Report §16.2; spec files verbatim except the two corrected pins | ✅ |
| 2 Run to see fail | Report quotes `Cannot find module '...\web\lib\percent'` / `'...\web\lib\human-price'` | ✅ (reported; not re-creatable) |
| 3 Modules | Both verbatim from the brief (diffed by eye against Step 3 — identical) | ✅ |
| 4 `6 passed` | Reproduced: `6 passed (2.3s)` | ✅ |
| 5 Commit message exact, four files staged, scope gate | `git show` subject matches byte-for-byte, body empty; report quotes `scope-gate: OK … 4 path(s)` | ✅ |

### Global constraints

| Constraint | Evidence | |
|---|---|---|
| Bigint only, no `Number()` on wire values, no float | Scan: zero hits for `Number(`, `parseFloat`, `parseInt`, `Math.`; `decimals`/`places`/`maxFraction` are used only as exponents (`BigInt(shift)`) and string lengths, never on a wire value | ✅ |
| Truncation toward zero everywhere | All division is BigInt `/`; negatives are handled by sign-strip-then-recurse so magnitude truncates toward zero | ✅ |
| U+2212 via `MINUS`, never ASCII | Both modules import `MINUS`; no ASCII `-` in any string literal | ✅ |
| `<$0.01` via `DUST_DISPLAY`; `$0` only for true zero | `human-price.ts:27,29` | ✅ |
| `humanUsdFull` never compacts | No `K`/`M`/`B` path exists; 10^15-dollar probe prints fully grouped | ✅ |
| `humanPrice` 4 under $10, 2 at/above | `human-price.ts:18` `tenThousandths < 100_000n`; boundary probes above | ✅ |
| `humanAmount` trims trailing zeros, never exceeds `maxFraction` | `human-price.ts:42` `.slice(0, maxFraction).replace(/0+$/, "")` | ✅ |

**SPEC: ✅**

---

## B. CODE QUALITY

Ranked findings. "Fix" is what I would do; none of the Minors need to reopen this commit.

### Important

**I-1 · `human-price.ts:42-43` · a nonzero dust amount prints as a bare `"0"` (and `"−0"` when negative), indistinguishable from a true zero.**
- Failing input → output: `humanAmount(1n, 18)` → `"0"`; `humanAmount(99990000000000n, 18)` (= 0.0000999) → `"0"`; `humanAmount(-1n, 18)` → `"−0"`.
- Why it matters: the sibling money rule in this very module (`humanUsdFull`) and in `humanUsd` is "`$0` only for a true zero, `<$0.01` otherwise", and Solvent's rendering law is that a tiny known value must not look like an empty one. Dust collateral balances (a few wei) are routine on-chain, and Tasks 3/6/7/11 will render the collateral table through this function.
- Status: **brief-compliant**. The brief's interface ("fraction truncated to `maxFraction` digits with trailing zeros dropped") specifies exactly this behaviour and pins nothing for dust; fixing it here would have been a deviation. This is a plan-level decision for the controller, best taken before downstream tasks pin strings against `humanAmount`.
- Fix I would make (in a follow-up brief): after the sign strip, if `value !== 0n` and both `whole === "0"` and the trimmed fraction is empty, return `<0.0001`-style dust (`"<" + "0." + "0".repeat(maxFraction - 1) + "1"`), so `"0"` is printed only for `0n`. Add pins `humanAmount(1n, 18)` → `"<0.0001"`, `humanAmount(0n, 18)` → `"0"`, `humanAmount(-1n, 18)` → `"−<0.0001"` (or whatever sign convention the controller picks; see M-2).

### Minor

**M-1 · `percent.ts:27-30` · `fallPercent` does not guard a negative `to`, so a negative wire value reads as a fall greater than 100%.**
- `fallPercent(-5n, 100n)` → `"105%"`.
- Callers pass prices/balances, which are never negative, so this is defensive only. Fix: add `|| to < 0n` to the null guard, or state in the doc comment that `to` must be ≥ 0.

**M-2 · `human-price.ts:16, 26, 38` · the sign-strip-then-recurse pattern yields signed zeros and a "−<" glyph pair for negative dust.**
- `humanPrice(-1n, 6)` → `"−$0.0000"`; `humanUsdFull(-5n, 6)` → `"−<$0.01"`; `humanAmount(-1n, 18)` → `"−0"`.
- `"−<$0.01"` is exactly what the existing `humanUsd(-5n, 6)` prints, so `humanUsdFull` is consistent with its sibling; prices are never negative in practice. Fix (only if the controller wants it): compute the magnitude string first and prefix `MINUS` only when the magnitude string is not the zero/dust form. Fold into the I-1 decision.

**M-3 · `human-price.ts:42` · a negative `maxFraction` silently drops digits from the wrong end.**
- `humanAmount(1234n, 2, -1)` → `"12.3"` (`slice(0, -1)` removes the last character).
- Garbage-in; the default is 4 and TypeScript cannot express non-negative integers. Fix: `const keep = Math.max(0, maxFraction)` before the slice, or document the precondition.

**M-4 · `human-price.ts:9-12` and `human-price.ts:39` · `decimals` is passed straight to `BigInt()`; a non-integer or `NaN` throws `RangeError`, a negative silently multiplies.**
- `humanPrice(1250000n, 6.5)` → throws `RangeError: The number 2.5 cannot be converted to a BigInt`; `humanPrice(1250000n, NaN)` → throws; `humanPrice(1250000n, -2)` → `"$125,000,000.00"`.
- `decimals` comes from typed token metadata (0…77 integers) and the existing `scaleDown` in `human-usd.ts:15-17` behaves identically, so this is consistent with the repo. Large legitimate shifts are fine: `humanPrice(5n * 10n ** 77n, 77)` → `"$5.0000"`, `humanPrice(1n, 77)` → `"$0.0000"`, `humanAmount(10n ** 77n, 77)` → `"1"`. No fix needed for this task; if a guard is ever wanted it belongs in one shared `rescale`.

**M-5 · `human-price.ts:6, 8-12, 25-34` · forced duplication of `human-usd.ts` internals.**
- `group` ≡ `groupThousands` (`human-usd.ts:10-12`), `rescale` ≡ `scaleDown` with the sign convention flipped (`human-usd.ts:15-17`), and `humanUsdFull`'s tail (`$0` / dust / ≥ $1,000 grouped / cents) duplicates `humanUsd`'s tail (`human-usd.ts:26-29, 34-36`).
- Forced by the "existing `web/lib/**` untouched" constraint — neither helper is exported. Fix (follow-up, when that constraint lifts): export `groupThousands`/`scaleDown` and import them; or give `humanUsd` and `humanUsdFull` a shared core with a `compact: boolean`. Not for this commit.

**M-6 · `percent.ts:26` · doc comment on `fallPercent` is inaccurate.**
- It says "Null when nothing fell or `from` ≤ 0", but `fallPercent(4200000000n, 4200000000n)` — nothing fell — returns `"0%"` (correctly, per the brief's pin at `percent.spec.ts:23`). Null is for a *rise* (`to > from`). Fix: "Null when `from` ≤ 0 or `to` > `from` (a rise is not a fall)." Also `percent.ts:6` mixes ⌊ and ⌉; "trunc(1000·num/den)" would be exact. Both are brief-verbatim text.

**M-7 · test coverage gaps (brief-verbatim tests, so compliant) worth pinning in a follow-up.**
- No pin at the `humanPrice` $10 boundary (`humanPrice(10000000n, 6)` → `"$10.00"`, `humanPrice(9999999n, 6)` → `"$9.9999"`, `humanPrice(9999950n, 6)` → `"$9.9999"`).
- No pin for `maxFraction` ≠ 4 or `maxFraction > decimals`.
- No pin proving the "no `−0%`" guarantee: `formatTenths(percentTenths(-1n, 3000n))` → `"0%"`.
- No pin for negative dust in any of the three money/amount functions (see M-2).

### Probes the controller asked for — results

| Probe | Result | Verdict |
|---|---|---|
| `rescale` with `decimals` > `places` | `humanPrice(9999999999999999999n, 18)` → `"$9.9999"`; `humanUsdFull(9999n, 6)` → `"<$0.01"`; `humanUsdFull(10000n, 6)` → `"$0.01"` | correct, truncating |
| `rescale` with very large shifts | `humanPrice(5n * 10n ** 77n, 77)` → `"$5.0000"`; `humanPrice(1n, 77)` → `"$0.0000"`; `humanPrice(9n, 0)` → `"$9.0000"`; `humanPrice(10n, 0)` → `"$10.00"` | correct in both directions |
| `humanPrice` at exactly $10.0000 / just below | `"$10.00"` / `"$9.9999"`; `$9.99995` → `"$9.9999"` (no round-up, no place flip) | correct |
| `humanAmount` with `maxFraction` > `decimals` | `humanAmount(1234n, 2, 4)` → `"12.34"`; `(1234n, 2, 10)` → `"12.34"`; `(1234n, 2, 0)` → `"12"` | correct; never invents digits |
| `fallPercent` when `to === from` | `"0%"` | correct (pinned) |
| `fallPercent` when `from` negative | `fallPercent(1n, -5n)` → null; `fallPercent(-10n, -5n)` → null | correct |
| `formatTenths` on a "−0" input | `formatTenths(-0n)` → `"0%"` (BigInt has no negative zero: `-0n === 0n`, so `tenths < 0n` is false); `percentTenths(-1n, 3000n)` → `0n` → `"0%"` | cannot print `"−0%"` |
| `percentOf` with a negative numerator | `percentOf(-190500000n, 5012500000n)` → `"−3.8%"` [U+2212] | works as the brief's `formatTenths(-38n)` pin requires. A "share of" is non-negative by nature, so the sign path is really for deltas; callers computing a share should never pass one, but the module is right not to refuse it — refusing would hide a bug upstream behind a null. No change. |

### Note on the implementer's concern #1 (96.1% + 3.8% ≠ 100%)

Confirmed: `percentOf(4822000000n, 5012500000n)` → `"96.1%"` and `percentOf(190500000n, 5012500000n)` → `"3.8%"`, though 4,822 + 190.5 = 5,012.5 exactly. Independent truncation of complements loses a tenth; this is inherent, not a defect. If the mockup or a later task pins `"96.2%"` for this pair, the consumer must derive one figure from the other (100.0 − 3.8 = 96.2) rather than truncate both. The controller should carry this into the Task 3/6/7/11 briefs.

**QUALITY: approved** — no Critical findings; the one Important finding is a brief-level gap escalated for decision, not a defect in this commit.

---

## Re-review (a755bb0)

**Scope (per the coordinator):** the dust arm of `humanAmount` for every `maxFraction`; whether a nonzero value with a nonzero whole part can ever take the dust arm; whether the new pins hold by arithmetic; no regressions. Findings I-1, M-1, M-3, M-6 and the pins from M-7 were in the fix round. M-2, M-4 and M-5 are accepted deferred minors and were not re-opened.

**Verdict: RE-REVIEW: all-addressed.**

### Evidence

- `git show a755bb0`: one commit, four `M` entries (`web/lib/human-price.ts`, `web/lib/percent.ts`, both specs); `human-usd.ts` untouched across the whole range `c0f9498..HEAD`. No intermediate commit (`cf8e6de`, `239336c`, `248d670`) touched any of the four files, so the fix diff is the complete delta since the reviewed commit. Working tree is byte-identical to `a755bb0` for those files; all probes below ran against it.
- Re-ran the two spec files: `8 passed (2.4s)` (6 original + 2 new blocks; no original block altered — the spec diffs are pure appends). `npm run typecheck` → exit 0.
- Transpiled the fixed modules and ran ~45 probes (below).

### The dust arm (`human-price.ts`, `belowPrecision` + `humanAmount`)

The arm fires only when `fraction === ""` **and** `units === 0n` **and** `value !== 0n`, where `units = value / 10^decimals`.

| `maxFraction` | Input | Output | Correct? |
|---|---|---|---|
| 0 | `humanAmount(1n, 18, 0)`, `humanAmount(5n, 2, 0)` | `"<1"` | ✅ smallest amount zero fraction digits can show |
| 1 | `humanAmount(1n, 18, 1)`, `humanAmount(5n, 2, 1)` (= 0.05) | `"<0.1"` | ✅ |
| 2 | `humanAmount(1n, 18, 2)` | `"<0.01"` | ✅ |
| 4 (default) | `humanAmount(1n, 18)`, `humanAmount(99990000000000n, 18)` (= 0.00009999) | `"<0.0001"` | ✅ 0.00009999 < 0.0001 |
| 6 | `humanAmount(1n, 18, 6)` | `"<0.000001"` | ✅ `places` fraction digits exactly |
| = `decimals` | `humanAmount(1n, 18, 18)`, `humanAmount(5n, 2, 2)` | `"0.000000000000000001"`, `"0.05"` | ✅ exact digits; dust arm not taken |
| > `decimals` | `humanAmount(1n, 18, 19)`, `humanAmount(1n, 18, 25)`, `humanAmount(1n, 2, 6)`, `humanAmount(5n, 2, 10)` | exact digits (`"0.01"`, `"0.05"`, …) | ✅ dust arm **unreachable**: when `places ≥ decimals` the slice keeps every digit, and a nonzero value with `units === 0n` has `value % div === value ≠ 0`, so at least one nonzero digit survives the trailing-zero trim |
| clamped (−1, −3) | `humanAmount(1234n, 2, -1)` → `"12"`; `humanAmount(1n, 18, -3)` → `"<1"` | | ✅ `Math.max(0, maxFraction)` makes negatives behave as 0 |

`belowPrecision(places)` yields `"<1"` at 0 and `"<0." + "0"×(places−1) + "1"` otherwise — exactly `places` fraction digits, the smallest value printable at that precision. Correct for all reachable `places` (0 ≤ places < decimals).

### A nonzero whole part never takes the dust arm

| Input | Output | |
|---|---|---|
| `humanAmount(1000001n, 6)` (1.000001) | `"1"` | ✅ fraction truncates away, `units = 1n` → whole |
| `humanAmount(150n, 2, 0)` (1.5 at 0 places) | `"1"` | ✅ truncation, not dust |
| `humanAmount(100n, 2, 0)` | `"1"` | ✅ |
| `humanAmount(10n ** 18n + 1n, 18)` | `"1"` | ✅ |
| `humanAmount(10n ** 18n * 1000n + 1n, 18)` | `"1,000"` | ✅ grouped, no dust |
| `humanAmount(-(10n ** 18n + 1n), 18)` | `"−1"` | ✅ |
| `humanAmount(7n, 0, 0)`, `humanAmount(7n, 0, 4)` | `"7"` | ✅ `decimals === 0` early return; no fraction can exist so no dust is needed |

The `units === 0n` guard makes the dust arm structurally unreachable whenever the whole part is nonzero. True zero stays `"0"` for every `maxFraction` probed (0, 1, 4) and for `decimals = 0`. Negatives carry the sign in front: `humanAmount(-1n, 18)` → `"−<0.0001"`, `humanAmount(-5n, 2, 0)` → `"−<1"`, `humanAmount(-1n, 18, 1)` → `"−<0.1"` — the `humanUsd` `"−<$0.01"` convention, U+2212.

### New pins, by arithmetic

`human-price.spec.ts:35-46`
- `humanAmount(1n, 18)` → `"<0.0001"`: 10⁻¹⁸ < 10⁻⁴, whole 0, four leading fraction zeros ✅
- `humanAmount(99990000000000n, 18)` → `"<0.0001"`: 99,990,000,000,000 has 14 digits → padded `000099990000000000`, first four `0000` ✅ (true value 0.00009999)
- `humanAmount(-1n, 18)` → `"−<0.0001"` ✅
- `humanAmount(5n, 2, 0)` → `"<1"`: 0.05 at zero places ✅
- `humanAmount(1234n, 2, 1)` → `"12.3"`: 12.34 truncated to one place ✅
- `humanAmount(1234n, 2, 6)` → `"12.34"`: `places > decimals` keeps both digits ✅
- `humanAmount(1234n, 2, -1)` → `"12"`: clamped to 0 places ✅
- `humanPrice(10000000n, 6)` → `"$10.00"`: tenThousandths = 100,000, not < 100,000 → 2 places ✅
- `humanPrice(9999900n, 6)` → `"$9.9999"`: 9,999,900 / 10⁶ = 9.9999 exactly → tenThousandths 99,999 → 4 places ✅
- `humanUsdFull(-5n, 6)` → `"−<$0.01"` ✅

`percent.spec.ts:28-31`
- `fallPercent(-5n, 100n)` → `null`: new `to < 0n` guard ✅ (previously `"105%"`)
- `formatTenths(percentTenths(-1n, 3000n) ?? 0n)` → `"0%"`: (1000 × −1)/3000 = −0.33… truncates to `0n`; `-0n === 0n` so no sign ✅

Original `fallPercent` pins still hold after the guard: `(0n, 100n)` → `"100%"`, `(4200000000n, 4200000000n)` → `"0%"`, `(4009500000n, 4200000000n)` → `"4.5%"`, `(5n, 4n)` → null, `(1n, 0n)` → null.

### Doc comments

`percent.ts:6` now reads `⌊1000 · num / den⌋ toward zero` (matched brackets); `percent.ts:26` reads "Null for a rise, a negative `to`, or `from` ≤ 0", which makes `to === from` → `"0%"` explicitly legitimate. Both match the code.

### Note, not re-opened

`percent.spec.ts:30` narrows with `?? 0n` for TypeScript. The pin therefore also passes if `percentTenths` ever returned `null` for a positive denominator. It holds by arithmetic today and the no-`−0%` guarantee is established, but a tighter form is `expect(percentTenths(-1n, 3000n)).toBe(0n)` (with `formatTenths(0n)` already pinned at line 16). Cosmetic; leave for the next time the spec is touched.

**RE-REVIEW: all-addressed.** Nothing open within scope; M-2, M-4, M-5 remain the accepted deferred minors.
