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
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: usd6(112) }, 6)).toBe(
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
