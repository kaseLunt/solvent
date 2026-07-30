// Test category (3): the exact-number helpers.
//
// Exact parse round-trips, PRECISION-LOSS REFUSAL, and the negative / zero /
// max-uint256-scale cases. The theme of every test here: the helper throws where
// a lesser client would round.

import { describe, expect, it } from "vitest";

import {
  AbsentQuantityError,
  DecimalFormatError,
  PrecisionLossError,
  WAD,
  aaveVerdictFromWad,
  compareRatio,
  formatDecimal,
  formatUnits,
  healthFactorRatio,
  isDecimal,
  parseDecimal,
  parseNullableDecimal,
  parseUnits,
  requireDecimal,
  rescale,
  toNumber,
} from "../src/index.js";
import { PINNED } from "./fixtures/index.js";

const MAX_UINT256 = 2n ** 256n - 1n;
const MIN_INT256 = -(2n ** 255n);

describe("parseDecimal is exact and strict", () => {
  it("round-trips every pinned quantity byte for byte", () => {
    const pinned = [
      PINNED.aave.hfWad,
      PINNED.aave.hfNum,
      PINNED.aave.hfDen,
      PINNED.aave.collateralBase,
      PINNED.aave.debtBase,
      PINNED.aave.weightedLTSum,
      PINNED.aave.weethPrice,
      PINNED.dm.collateralUSD,
      PINNED.dm.maxBorrowLT,
      PINNED.dm.borrowings,
      PINNED.dm.badDebtAtPar,
      PINNED.dm.liqThreshold,
      PINNED.meta.rateIndexValue,
    ];
    for (const value of pinned) {
      expect(formatDecimal(parseDecimal(value))).toBe(value);
    }
  });

  it("carries a 27-decimal ray index that a double cannot hold", () => {
    // 1023456789012345678901234567 is 28 digits; a double keeps 15-16.
    const ray = parseDecimal(PINNED.meta.rateIndexValue);
    expect(formatDecimal(ray)).toBe(PINNED.meta.rateIndexValue);
    expect(String(Number(PINNED.meta.rateIndexValue))).not.toBe(PINNED.meta.rateIndexValue);
  });

  it("handles zero, negative and max-uint256 scale exactly", () => {
    expect(parseDecimal("0")).toBe(0n);
    expect(parseDecimal("-0")).toBe(0n);
    expect(formatDecimal(parseDecimal("-1"))).toBe("-1");
    expect(parseDecimal("-239603961")).toBe(-239603961n);

    expect(formatDecimal(parseDecimal(MAX_UINT256.toString()))).toBe(MAX_UINT256.toString());
    expect(parseDecimal(MAX_UINT256.toString())).toBe(MAX_UINT256);
    expect(parseDecimal(MIN_INT256.toString())).toBe(MIN_INT256);
    // One past max-uint256 is still parsed exactly: bigint has no ceiling, and
    // silently saturating would be the very failure this module exists to avoid.
    expect(parseDecimal((MAX_UINT256 + 1n).toString())).toBe(MAX_UINT256 + 1n);
  });

  it("refuses everything the contract would not have produced", () => {
    for (const bad of [
      "",
      " 1",
      "1 ",
      "+1",
      "1.0",
      "1e18",
      "0x10",
      "1_000",
      "1,000",
      "NaN",
      "Infinity",
      "--1",
      "1-",
    ]) {
      expect(() => parseDecimal(bad), bad).toThrow(DecimalFormatError);
      expect(isDecimal(bad), bad).toBe(false);
    }
    expect(isDecimal("-42")).toBe(true);
  });

  it("keeps ABSENT and ZERO distinguishable", () => {
    expect(parseNullableDecimal(null)).toBeNull();
    expect(parseNullableDecimal("0")).toBe(0n);
    expect(() => requireDecimal(null, "health_factor.wad")).toThrow(AbsentQuantityError);
    try {
      requireDecimal(null, "health_factor.wad");
    } catch (error) {
      expect(error).toBeInstanceOf(AbsentQuantityError);
      expect((error as AbsentQuantityError).field).toBe("health_factor.wad");
      expect((error as Error).message).toContain("ABSENT from zero");
    }
    expect(requireDecimal("0", "x")).toBe(0n);
  });
});

describe("toNumber refuses rather than rounds", () => {
  it("converts counts, blocks and seconds — values safe to compute with", () => {
    expect(toNumber("0")).toBe(0);
    expect(toNumber("-1")).toBe(-1);
    expect(toNumber(PINNED.blocks.aave.toString())).toBe(PINNED.blocks.aave);
    expect(toNumber(PINNED.blocks.dm.toString())).toBe(PINNED.blocks.dm);
    expect(toNumber(PINNED.dm.badDebtAtPar)).toBe(239603961);
    expect(toNumber(PINNED.ages.priceBudget.toString())).toBe(180);
    // The boundary: 2^53 - 1 is the last safe integer.
    expect(toNumber((2n ** 53n - 1n).toString())).toBe(Number.MAX_SAFE_INTEGER);
    expect(toNumber((-(2n ** 53n) + 1n).toString())).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("REFUSES a health-factor wad even though a double holds it EXACTLY", () => {
    // 1.08e18 carries eighteen factors of two, so it IS exactly representable —
    // a round-trip test would wave it through. It is still above
    // MAX_SAFE_INTEGER, so `x + 1 === x`, and handing it back as a number would
    // be rounding one step later.
    expect(Number(PINNED.aave.hfWad)).toBe(1080000000000000000);
    expect(BigInt(Number(PINNED.aave.hfWad))).toBe(1080000000000000000n);
    expect(1080000000000000000 + 1).toBe(1080000000000000000);

    expect(() => toNumber(PINNED.aave.hfWad)).toThrow(PrecisionLossError);
    try {
      toNumber(PINNED.aave.hfWad);
    } catch (error) {
      expect(error).toBeInstanceOf(PrecisionLossError);
      const loss = error as PrecisionLossError;
      expect(loss.value).toBe(1080000000000000000n);
      expect(loss.operation).toBe("toNumber");
      expect(loss.message).toContain("safe-integer range");
      expect(loss.message).toContain("next addition would silently lose");
    }
    expect(() => toNumber(PINNED.aave.shockedHFWad)).toThrow(PrecisionLossError);
    expect(() => toNumber(PINNED.dm.liqThreshold)).toThrow(PrecisionLossError);
  });

  it("REFUSES 2^53, the first integer past the safe range", () => {
    expect(() => toNumber((2n ** 53n).toString())).toThrow(PrecisionLossError);
    expect(() => toNumber(2n ** 53n + 1n)).toThrow(PrecisionLossError);
    expect(() => toNumber(-(2n ** 53n))).toThrow(PrecisionLossError);
  });

  it("REFUSES max-uint256 instead of returning Infinity or a rounded float", () => {
    expect(() => toNumber(MAX_UINT256.toString())).toThrow(PrecisionLossError);
    expect(() => toNumber(MIN_INT256.toString())).toThrow(PrecisionLossError);
    expect(() => toNumber(PINNED.meta.rateIndexValue)).toThrow(PrecisionLossError);
    // The error still names the value it declined to convert, exactly.
    try {
      toNumber(MAX_UINT256.toString());
    } catch (error) {
      expect((error as PrecisionLossError).value).toBe(MAX_UINT256);
    }
  });
});

describe("rescale never drops a digit silently", () => {
  it("widens exactly", () => {
    // Debt Manager USD (6-dec) to Aave base (8-dec).
    expect(rescale(PINNED.dm.collateralUSD, 6, 8)).toBe(400000000000n);
    expect(rescale("0", 6, 18)).toBe(0n);
    expect(rescale("-1", 0, 18)).toBe(-(10n ** 18n));
  });

  it("narrows when the digits are zero", () => {
    expect(rescale(PINNED.aave.hfWad, 18, 2)).toBe(108n);
    expect(rescale("400000000000", 8, 6)).toBe(4000000000n);
    expect(rescale(PINNED.dm.collateralUSD, 6, 6)).toBe(4000000000n);
  });

  it("REFUSES a narrowing that would drop a non-zero digit", () => {
    expect(() => rescale(PINNED.dm.badDebtAtPar, 6, 2)).toThrow(PrecisionLossError);
    try {
      rescale("239603961", 6, 2);
    } catch (error) {
      const loss = error as PrecisionLossError;
      expect(loss).toBeInstanceOf(PrecisionLossError);
      expect(loss.operation).toBe("rescale 6 -> 2");
      expect(loss.message).toContain("non-zero remainder");
    }
    // One unit is enough to refuse: no truncation, no round-half-up.
    expect(() => rescale("1000000000000000001", 18, 17)).toThrow(PrecisionLossError);
    expect(rescale("1000000000000000000", 18, 17)).toBe(100000000000000000n);
  });

  it("rejects an impossible scale rather than guessing", () => {
    expect(() => rescale("1", -1, 2)).toThrow(DecimalFormatError);
    expect(() => rescale("1", 2, 1.5)).toThrow(DecimalFormatError);
  });
});

describe("formatUnits and parseUnits are exact inverses", () => {
  it("renders a health-factor wad without a float", () => {
    expect(formatUnits(PINNED.aave.hfWad, 18)).toBe("1.080000000000000000");
    expect(formatUnits(PINNED.aave.hfWad, 18, { trim: true })).toBe("1.08");
    expect(formatUnits(PINNED.aave.shockedHFWad, 18, { trim: true })).toBe("0.756");
  });

  it("renders both engines' money in their own scales", () => {
    expect(formatUnits(PINNED.aave.weethPrice, 8, { trim: true })).toBe("4000");
    expect(formatUnits(PINNED.aave.collateralBase, 8)).toBe("8000.00000000");
    expect(formatUnits(PINNED.dm.borrowings, 6)).toBe("4200.000000");
    expect(formatUnits(PINNED.dm.badDebtAtPar, 6)).toBe("239.603961");
    expect(formatUnits(PINNED.dm.hfNum, 6, { trim: true })).toBe("3200");
  });

  it("handles zero, sub-one and negative magnitudes", () => {
    expect(formatUnits("0", 18)).toBe("0.000000000000000000");
    expect(formatUnits("0", 18, { trim: true })).toBe("0");
    expect(formatUnits("1", 18)).toBe("0.000000000000000001");
    expect(formatUnits("-1", 6)).toBe("-0.000001");
    expect(formatUnits("-4200000000", 6)).toBe("-4200.000000");
    expect(formatUnits("42", 0)).toBe("42");
  });

  it("survives a max-uint256 round trip at 18 decimals", () => {
    const text = formatUnits(MAX_UINT256, 18);
    expect(parseUnits(text, 18)).toBe(MAX_UINT256);
    expect(text.split(".")[1]).toHaveLength(18);
  });

  it("round-trips every pinned quantity through its own scale", () => {
    const cases: [string, number][] = [
      [PINNED.aave.hfWad, 18],
      [PINNED.aave.collateralBase, 8],
      [PINNED.aave.weethPrice, 8],
      [PINNED.dm.borrowings, 6],
      [PINNED.dm.badDebtAtPar, 6],
      [PINNED.dm.liqThreshold, 18],
      [PINNED.meta.rateIndexValue, 27],
    ];
    for (const [value, decimals] of cases) {
      expect(formatDecimal(parseUnits(formatUnits(value, decimals), decimals))).toBe(value);
    }
  });

  it("parses a fixed-point literal exactly", () => {
    expect(parseUnits("1.08", 18)).toBe(1080000000000000000n);
    expect(parseUnits("4000", 8)).toBe(400000000000n);
    expect(parseUnits("-0.000001", 6)).toBe(-1n);
    expect(parseUnits(".5", 6)).toBe(500000n);
    expect(parseUnits("0.", 6)).toBe(0n);
    expect(parseUnits("239.603961", 6)).toBe(239603961n);
  });

  it("REFUSES a literal with more fractional digits than the scale admits", () => {
    expect(() => parseUnits("1.0000001", 6)).toThrow(PrecisionLossError);
    try {
      parseUnits("-1.0000001", 6);
    } catch (error) {
      const loss = error as PrecisionLossError;
      expect(loss).toBeInstanceOf(PrecisionLossError);
      // The error carries the literal's exact value at ITS OWN scale.
      expect(loss.value).toBe(-10000001n);
      expect(loss.message).toContain("refusing to drop the extra digits");
    }
    // Trailing zeros past the scale are still digits, and still refused: the
    // helper does not decide for the caller which digits do not matter.
    expect(() => parseUnits("1.0000000", 6)).toThrow(PrecisionLossError);
  });

  it("refuses a malformed literal", () => {
    for (const bad of ["", ".", "1.2.3", "1e6", "abc", "0x1"]) {
      expect(() => parseUnits(bad, 6), bad).toThrow(DecimalFormatError);
    }
  });
});

describe("comparisons stay exact — no division anywhere", () => {
  it("compares rationals by cross-multiplication", () => {
    const num = parseDecimal(PINNED.dm.hfNum);
    const den = parseDecimal(PINNED.dm.hfDen);
    // 3200/4200 = 0.7619… is below 0.90 and below 1.
    expect(compareRatio(num, den, 90n, 100n)).toBe(-1);
    expect(compareRatio(num, den, 1n, 1n)).toBe(-1);
    // Equality holds for an unreduced form, which is the whole point.
    expect(compareRatio(num, den, num * 7n, den * 7n)).toBe(0);
    expect(compareRatio(1n, 3n, 1n, 4n)).toBe(1);
    // Exact where doubles are not: 1/3 vs 100000000000000000001/300000000000000000000.
    expect(compareRatio(1n, 3n, 100000000000000000001n, 300000000000000000000n)).toBe(-1);
  });

  it("treats a zero denominator as absent, not infinite", () => {
    expect(() => compareRatio(1n, 0n, 1n, 1n)).toThrow(DecimalFormatError);
    expect(() => compareRatio(1n, 1n, 1n, -1n)).toThrow(DecimalFormatError);
  });

  it("applies Aave's STRICT test on the wad, as a SEALED verdict", () => {
    expect(aaveVerdictFromWad(PINNED.aave.hfWad)).toBe("not-liquidatable");
    expect(aaveVerdictFromWad(PINNED.aave.shockedHFWad)).toBe("liquidatable");
    // Exactly 1e18 is HEALTHY — the boundary the contract calls out.
    expect(aaveVerdictFromWad(WAD.toString())).toBe("not-liquidatable");
    expect(aaveVerdictFromWad((WAD - 1n).toString())).toBe("liquidatable");
    // Absent is never reported as healthy — and, round 3's point, can no
    // longer be READ as healthy: `!"unknowable"` is dead code, where the
    // predecessor's `!null` took the "safe" branch.
    expect(aaveVerdictFromWad(null)).toBe("unknowable");
  });

  it("exposes a health factor's exact rational, or nothing", () => {
    expect(healthFactorRatio({ wad: null, num: "3200000000", den: "4200000000", infinite: false, note: "" })).toEqual({
      num: 3200000000n,
      den: 4200000000n,
    });
    expect(healthFactorRatio({ wad: null, num: null, den: null, infinite: true, note: "" })).toBeNull();
    expect(healthFactorRatio({ wad: null, num: "1", den: "0", infinite: false, note: "" })).toBeNull();
  });
});
