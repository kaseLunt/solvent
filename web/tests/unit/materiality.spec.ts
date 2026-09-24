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

test("the line is placed only at a scale the guard admits: -0 and a negative refuse by name", () => {
  expect(() => materialityTier(1n, -0)).toThrow(/decimals is not a wire scale.*got -0/);
  expect(() => materialityTier(1n, -6)).toThrow(/got -6/);
  expect(() => partitionByMateriality([{ debt: 1n }], 1.5)).toThrow(/got 1\.5/);
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
  // The sum of accounts each under the line may itself exceed the line: it is stated together, never "below" it.
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: usd6(112) }, 6)).toBe(
    "47 more accounts are technically liquidatable, each under the $100 line — $112 together — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 1 }, { belowLine: usd6(4.62) }, 6)).toBe(
    "1 more account is technically liquidatable, under the $100 line — $4.62 — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 0 }, { belowLine: 0n }, 6)).toBeNull();
});

test("the $100 line is per account (one Cash position is one account): the below-line sentence never places the sum under it", () => {
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: 109_450_000n }, 6)).toBe(
    "47 more accounts are technically liquidatable, each under the $100 line — $109.45 together — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 1 }, { belowLine: 4_620_000n }, 6)).toBe(
    "1 more account is technically liquidatable, under the $100 line — $4.62 — and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 0 }, { belowLine: 0n }, 6)).toBeNull();
  for (const sentence of [
    belowLineSentence({ belowLine: 47 }, { belowLine: 109_450_000n }, 6),
    belowLineSentence({ belowLine: 2 }, { belowLine: usd6(150) }, 6),
  ]) {
    expect(sentence).not.toMatch(/below the \$100 line|but totals?/);
  }
});

test("dust that is sub-cent still prints as <$0.01 in the sentence", () => {
  expect(belowLineSentence({ belowLine: 46 }, { belowLine: 46n }, 8)).toBe(
    "46 more accounts are technically liquidatable, each under the $100 line — <$0.01 together — and not headlined.",
  );
});
