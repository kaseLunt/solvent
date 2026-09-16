### Task 2: `percent` and `human-price` — exact percent, unit-price and token-amount strings

**Files:**
- Create: `web/lib/percent.ts`, `web/lib/human-price.ts`
- Test: `web/tests/unit/percent.spec.ts`, `web/tests/unit/human-price.spec.ts`

**Interfaces:**
- Produces `percentTenths(num: bigint, den: bigint): bigint | null` (⌊1000·num/den⌉ toward zero; null when den ≤ 0), `formatTenths(tenths: bigint): string` ("96.2%", "50%", "−3.8%" with U+2212), `percentOf(num, den): string | null`, `fallPercent(to: bigint, from: bigint): string | null` (the fall from `from` to `to` as a percent of `from`; null when from ≤ 0 or to > from).
- Produces `humanPrice(value: bigint, decimals: number): string` (under $10 → 4 places, else 2; thousands grouped; truncating; U+2212 for negatives), `humanAmount(value: bigint, decimals: number, maxFraction = 4): string` (grouped whole part, fraction truncated to `maxFraction` digits with trailing zeros dropped), and `humanUsdFull(value: bigint, decimals: number): string` — the Inspector's money: the same rules as `humanUsd` below $10,000 (cents under $1,000, `<$0.01` for sub-cent, `$0` only for a true zero, U+2212) but grouped whole dollars above it, never `K`/`M`/`B`. One account's figures are read exactly; the Book's book-wide sums are read compactly.
- Consumed by Tasks 3, 6, 7, 11.

- [ ] **Step 1: Failing specs**

```ts
// web/tests/unit/percent.spec.ts
import { expect, test } from "@playwright/test";
import { fallPercent, formatTenths, percentOf, percentTenths } from "../../lib/percent";

test("percentTenths truncates toward zero and refuses a non-positive denominator", () => {
  expect(percentTenths(4822000000n, 5012500000n)).toBe(962n); // 96.20…
  expect(percentTenths(190500000n, 5012500000n)).toBe(38n); // 3.80…
  expect(percentTenths(-1n, 3n)).toBe(0n);
  expect(percentTenths(1n, 0n)).toBeNull();
  expect(percentTenths(1n, -5n)).toBeNull();
});

test("formatTenths prints one decimal only when it is non-zero, and the true minus sign", () => {
  expect(formatTenths(962n)).toBe("96.2%");
  expect(formatTenths(500n)).toBe("50%");
  expect(formatTenths(-38n)).toBe("−3.8%");
  expect(formatTenths(0n)).toBe("0%");
});

test("percentOf and fallPercent compose the two", () => {
  expect(percentOf(4200000000n, 8400000000n)).toBe("50%");
  expect(percentOf(1n, 0n)).toBeNull();
  expect(fallPercent(4009500000n, 4200000000n)).toBe("4.5%"); // 1 − 0.9546 = 4.53…
  expect(fallPercent(4200000000n, 4200000000n)).toBe("0%");
  expect(fallPercent(5n, 4n)).toBeNull(); // a rise is not a fall
  expect(fallPercent(1n, 0n)).toBeNull();
});
```

```ts
// web/tests/unit/human-price.spec.ts
import { expect, test } from "@playwright/test";
import { humanAmount, humanPrice, humanUsdFull } from "../../lib/human-price";

test("humanPrice keeps four places under $10 and two above, grouped, truncating", () => {
  expect(humanPrice(4000000000n, 6)).toBe("$4,000.00");
  expect(humanPrice(3818571429n, 6)).toBe("$3,818.57");
  expect(humanPrice(1250000n, 6)).toBe("$1.2500");
  expect(humanPrice(999999n, 6)).toBe("$0.9999");
  expect(humanPrice(100000000n, 8)).toBe("$1.0000");
  expect(humanPrice(999900000000n, 8)).toBe("$9,999.00");
  expect(humanPrice(-1250000n, 6)).toBe("−$1.2500");
  expect(humanPrice(0n, 6)).toBe("$0.0000");
});

test("humanUsdFull never compacts: grouped dollars above $1,000, cents below, dust and zero as humanUsd", () => {
  expect(humanUsdFull(12462500000n, 6)).toBe("$12,462");
  expect(humanUsdFull(4822000000n, 6)).toBe("$4,822");
  expect(humanUsdFull(190500000n, 6)).toBe("$190.50");
  expect(humanUsdFull(1234567890000n, 6)).toBe("$1,234,567");
  expect(humanUsdFull(-387500000n, 6)).toBe("−$387.50");
  expect(humanUsdFull(5n, 6)).toBe("<$0.01");
  expect(humanUsdFull(0n, 6)).toBe("$0");
  expect(humanUsdFull(600000000000n, 8)).toBe("$6,000");
});

test("humanAmount groups the whole part and trims the fraction to four meaningful digits", () => {
  expect(humanAmount(2100000000000000000n, 18)).toBe("2.1");
  expect(humanAmount(3250000000000000000000n, 18)).toBe("3,250");
  expect(humanAmount(656250000000000000n, 18)).toBe("0.6562");
  expect(humanAmount(4620000000n, 6)).toBe("4,620");
  expect(humanAmount(-150000000n, 6)).toBe("−150");
  expect(humanAmount(5n, 0)).toBe("5");
});
```

- [ ] **Step 2: Run to see both fail**

Run: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: The modules**

```ts
// web/lib/percent.ts
// Percent strings from two wire integers: exact in tenths, truncating toward
// zero, never through a float. The Book's headroom helpers own the room
// arithmetic; this module owns the plain "share of" and "fall from" cases.
import { MINUS } from "./human-usd";

/** ⌊1000 · num / den⌉ toward zero, as tenths of a percent. Null when den ≤ 0. */
export function percentTenths(num: bigint, den: bigint): bigint | null {
  if (den <= 0n) return null;
  return (1000n * num) / den;
}

export function formatTenths(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  return `${negative ? MINUS : ""}${whole.toString()}${tenth === 0n ? "" : `.${tenth.toString()}`}%`;
}

/** The share `num` is of `den`, e.g. "96.2%". */
export function percentOf(num: bigint, den: bigint): string | null {
  const tenths = percentTenths(num, den);
  return tenths === null ? null : formatTenths(tenths);
}

/** The fall from `from` down to `to`, as a percent of `from`. Null when nothing fell or `from` ≤ 0. */
export function fallPercent(to: bigint, from: bigint): string | null {
  if (from <= 0n || to > from) return null;
  return formatTenths((1000n * (from - to)) / from);
}
```

```ts
// web/lib/human-price.ts
// Unit prices and token amounts for the collateral table. Prices keep more
// places than money totals do (a $1.25 token needs its cents and a bit); token
// amounts are grouped and trimmed. Both truncate; neither touches a float.
import { DUST_DISPLAY, MINUS } from "./human-usd";

const group = (whole: bigint): string => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** value · 10^places / 10^decimals, truncating. */
function rescale(value: bigint, decimals: number, places: number): bigint {
  const shift = places - decimals;
  return shift >= 0 ? value * 10n ** BigInt(shift) : value / 10n ** BigInt(-shift);
}

/** A unit price: four places under $10, two otherwise. */
export function humanPrice(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanPrice(-value, decimals)}`;
  const tenThousandths = rescale(value, decimals, 4);
  const places = tenThousandths < 100_000n ? 4 : 2;
  const units = places === 4 ? tenThousandths : rescale(value, decimals, 2);
  const div = 10n ** BigInt(places);
  return `$${group(units / div)}.${(units % div).toString().padStart(places, "0")}`;
}

/** One account's money: never compacted. Cents under $1,000, grouped whole dollars above; `<$0.01` for sub-cent; `$0` only for a true zero. */
export function humanUsdFull(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanUsdFull(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = rescale(value, decimals, 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000n) return `$${group(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}

/** A token amount in its own decimals, grouped, fraction trimmed to `maxFraction` digits. */
export function humanAmount(value: bigint, decimals: number, maxFraction = 4): string {
  if (value < 0n) return `${MINUS}${humanAmount(-value, decimals, maxFraction)}`;
  const div = 10n ** BigInt(decimals);
  const whole = group(value / div);
  if (decimals === 0) return whole;
  const fraction = (value % div).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
```

- [ ] **Step 4: Run the specs**

Run: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/percent.ts web/lib/human-price.ts web/tests/unit/percent.spec.ts web/tests/unit/human-price.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): exact percent, unit-price and token-amount strings for the Inspector - bigint only, truncating"
```

---

