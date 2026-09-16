### Task 3: Materiality partition

**Files:**
- Create: `web/lib/materiality.ts`
- Test: `web/tests/unit/materiality.spec.ts`

**Interfaces:**
- Produces:
  - `MATERIAL_LINE_USD = 100n`, `SMALL_LINE_USD = 1n`
  - `type MaterialityTier = "material" | "small" | "dust"`
  - `materialityTier(debt: bigint, decimals: number): MaterialityTier`
  - `interface Sized { readonly debt: bigint }`
  - `partitionByMateriality<T extends Sized>(rows: readonly T[], decimals: number): { material: T[]; small: T[]; dust: T[]; sums: { material: bigint; small: bigint; dust: bigint; belowLine: bigint }; counts: { material: number; small: number; dust: number; belowLine: number } }`
  - `belowLineSentence(counts: { belowLine: number }, sums: { belowLine: bigint }, decimals: number): string | null` → `"47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined."` (singular: `"1 more position is technically liquidatable but totals $4.62 — below the $100 line and not headlined."`); `null` when the count is 0.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/materiality.spec.ts
import { expect, test } from "@playwright/test";
import {
  belowLineSentence,
  MATERIAL_LINE_USD,
  materialityTier,
  partitionByMateriality,
} from "../../lib/materiality";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("the lines are $100 and $1, tiers are closed at the top", () => {
  expect(MATERIAL_LINE_USD).toBe(100n);
  expect(materialityTier(usd6(100), 6)).toBe("material");
  expect(materialityTier(usd6(99.999999), 6)).toBe("small");
  expect(materialityTier(usd6(1), 6)).toBe("small");
  expect(materialityTier(usd6(0.999999), 6)).toBe("dust");
  expect(materialityTier(1n, 6)).toBe("dust");
  expect(materialityTier(0n, 6)).toBe("dust");
  expect(materialityTier(100_00000000n, 8)).toBe("material");
});

test("partition keeps every row, sums by tier, and belowLine = small + dust", () => {
  const rows = [
    { account: "a", debt: usd6(4620) },
    { account: "b", debt: usd6(2220) },
    { account: "c", debt: usd6(42.5) },
    { account: "d", debt: usd6(0.31) },
    { account: "e", debt: 4n },
  ];
  const p = partitionByMateriality(rows, 6);
  expect(p.material.map((r) => r.account)).toEqual(["a", "b"]);
  expect(p.small.map((r) => r.account)).toEqual(["c"]);
  expect(p.dust.map((r) => r.account)).toEqual(["d", "e"]);
  expect(p.sums.material).toBe(usd6(6840));
  expect(p.sums.small).toBe(usd6(42.5));
  expect(p.sums.dust).toBe(usd6(0.31) + 4n);
  expect(p.sums.belowLine).toBe(p.sums.small + p.sums.dust);
  expect(p.counts).toEqual({ material: 2, small: 1, dust: 2, belowLine: 3 });
});

test("the below-line sentence, plural and singular, and absent at zero", () => {
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: usd6(112.4) }, 6)).toBe(
    "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 1 }, { belowLine: usd6(4.62) }, 6)).toBe(
    "1 more position is technically liquidatable but totals $4.62 — below the $100 line and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 0 }, { belowLine: 0n }, 6)).toBeNull();
});

test("dust that is sub-cent still prints as <$0.01 in the sentence", () => {
  expect(belowLineSentence({ belowLine: 46 }, { belowLine: 46n }, 8)).toBe(
    "46 more positions are technically liquidatable but total <$0.01 — below the $100 line and not headlined.",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/materiality.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/materiality.ts
import { humanUsd } from "./human-usd";

/** Whole dollars. A DISPLAY rule (spec 2026-09-15 §3.3): counts and Σ always exist in full. */
export const MATERIAL_LINE_USD = 100n;
export const SMALL_LINE_USD = 1n;

export type MaterialityTier = "material" | "small" | "dust";

export interface Sized {
  readonly debt: bigint;
}

function lineInBaseUnits(lineUsd: bigint, decimals: number): bigint {
  return lineUsd * 10n ** BigInt(decimals);
}

export function materialityTier(debt: bigint, decimals: number): MaterialityTier {
  if (debt >= lineInBaseUnits(MATERIAL_LINE_USD, decimals)) return "material";
  if (debt >= lineInBaseUnits(SMALL_LINE_USD, decimals)) return "small";
  return "dust";
}

export interface MaterialityPartition<T extends Sized> {
  readonly material: T[];
  readonly small: T[];
  readonly dust: T[];
  readonly sums: { material: bigint; small: bigint; dust: bigint; belowLine: bigint };
  readonly counts: { material: number; small: number; dust: number; belowLine: number };
}

export function partitionByMateriality<T extends Sized>(
  rows: readonly T[],
  decimals: number,
): MaterialityPartition<T> {
  const material: T[] = [];
  const small: T[] = [];
  const dust: T[] = [];
  let sMaterial = 0n;
  let sSmall = 0n;
  let sDust = 0n;
  for (const row of rows) {
    const tier = materialityTier(row.debt, decimals);
    if (tier === "material") {
      material.push(row);
      sMaterial += row.debt;
    } else if (tier === "small") {
      small.push(row);
      sSmall += row.debt;
    } else {
      dust.push(row);
      sDust += row.debt;
    }
  }
  return {
    material,
    small,
    dust,
    sums: { material: sMaterial, small: sSmall, dust: sDust, belowLine: sSmall + sDust },
    counts: {
      material: material.length,
      small: small.length,
      dust: dust.length,
      belowLine: small.length + dust.length,
    },
  };
}

export function belowLineSentence(
  counts: { readonly belowLine: number },
  sums: { readonly belowLine: bigint },
  decimals: number,
): string | null {
  const n = counts.belowLine;
  if (n === 0) return null;
  const one = n === 1;
  return `${String(n)} more position${one ? "" : "s"} ${one ? "is" : "are"} technically liquidatable but total${one ? "s" : ""} ${humanUsd(sums.belowLine, decimals)} — below the $${MATERIAL_LINE_USD.toString()} line and not headlined.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/materiality.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/materiality.ts web/tests/unit/materiality.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): materiality partition - the \$100 line as a display rule with full counts kept"
```

---

