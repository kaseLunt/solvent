### Task 2: `humanUsd` — compact money without floats

**Files:**
- Create: `web/lib/human-usd.ts`
- Test: `web/tests/unit/human-usd.spec.ts`

**Interfaces:**
- Produces: `humanUsd(value: bigint, decimals: number): string`. `value` is base units at `decimals` (a wire integer already guarded). Truncates toward zero (never rounds money at risk up). Rules: `0 → "$0"`; `0 < v < $0.01 → "<$0.01"`; `< $1,000 → "$239.60" / "$18"` (cents only when nonzero); `$1,000–$9,999 → "$6,840"`; `$10K–$999K → "$312K"`; `≥ $1M → "$24.6M"` (one decimal, dropped when zero); `≥ $1B → "$1.2B"`; negative → leading `−` (U+2212).
- Also exports `DUST_DISPLAY = "<$0.01"` and `MINUS = "−"`.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/human-usd.spec.ts
import { expect, test } from "@playwright/test";
import { DUST_DISPLAY, humanUsd } from "../../lib/human-usd";

const d6 = (dollars: string): bigint => BigInt(dollars.replace(".", "").padEnd(dollars.includes(".") ? dollars.length - 1 + 6 - (dollars.length - dollars.indexOf(".") - 1) : dollars.length + 6, "0"));

test.describe("humanUsd — compact money, truncating, bigint only", () => {
  test("zero and dust", () => {
    expect(humanUsd(0n, 6)).toBe("$0");
    expect(humanUsd(1n, 6)).toBe(DUST_DISPLAY); // $0.000001
    expect(humanUsd(9_999n, 6)).toBe(DUST_DISPLAY); // $0.009999
    expect(humanUsd(10_000n, 6)).toBe("$0.01");
  });
  test("under a thousand shows cents only when nonzero", () => {
    expect(humanUsd(239_603_961n, 6)).toBe("$239.60");
    expect(humanUsd(18_000_000n, 6)).toBe("$18");
    expect(humanUsd(4_620_000n, 6)).toBe("$4.62");
    expect(humanUsd(999_999_999n, 6)).toBe("$999.99");
  });
  test("thousands group, no cents", () => {
    expect(humanUsd(6_840_000_000n, 6)).toBe("$6,840");
    expect(humanUsd(4_620_000_000n, 6)).toBe("$4,620");
    expect(humanUsd(9_999_990_000n, 6)).toBe("$9,999");
  });
  test("ten thousand and up in K, million and up in M with one decimal", () => {
    expect(humanUsd(312_400_000_000n, 6)).toBe("$312K");
    expect(humanUsd(24_612_000_000_000n, 6)).toBe("$24.6M");
    expect(humanUsd(1_000_000_000_000n, 6)).toBe("$1M");
    expect(humanUsd(1_280_000_000_000n, 6)).toBe("$1.2M");
    expect(humanUsd(1_250_000_000_000_000n, 6)).toBe("$1.2B");
  });
  test("eight-decimal engines and negatives", () => {
    expect(humanUsd(600_000_000_000n, 8)).toBe("$6,000");
    expect(humanUsd(-184_000_000n, 6)).toBe("−$184");
    expect(humanUsd(-1n, 6)).toBe("−<$0.01");
  });
  test("decimals of zero", () => {
    expect(humanUsd(6840n, 0)).toBe("$6,840");
  });
});
```

Remove the unused `d6` helper before running (it is not needed; the literals above are explicit).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/human-usd.spec.ts`
Expected: FAIL — cannot resolve `../../lib/human-usd`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/human-usd.ts
/**
 * Compact money for headlines and tiles (spec 2026-09-15 §3.3–§3.4).
 * Bigint throughout; TRUNCATES toward zero so a figure "at risk" is never
 * rounded up. Exact strings stay on the exact layer (ExactValue); this is
 * layer 1 only.
 */
export const DUST_DISPLAY = "<$0.01";
export const MINUS = "−";

function groupThousands(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Scale down by 10^n, truncating. */
function scaleDown(value: bigint, n: number): bigint {
  return n <= 0 ? value * 10n ** BigInt(-n) : value / 10n ** BigInt(n);
}

function oneDecimal(cents: bigint, unitCents: bigint, suffix: string): string {
  const tenths = (cents * 10n) / unitCents; // truncated tenths of the unit
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  return tenth === 0n ? `$${whole.toString()}${suffix}` : `$${whole.toString()}.${tenth.toString()}${suffix}`;
}

export function humanUsd(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanUsd(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = scaleDown(value, decimals - 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000_000_000n) return oneDecimal(cents, 100_000_000_000n, "B");
  if (dollars >= 1_000_000n) return oneDecimal(cents, 100_000_000n, "M");
  if (dollars >= 10_000n) return `$${groupThousands(dollars / 1000n)}K`;
  if (dollars >= 1_000n) return `$${groupThousands(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/human-usd.spec.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/human-usd.ts web/tests/unit/human-usd.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): humanUsd - compact, truncating, bigint money for headlines and tiles"
```

---

