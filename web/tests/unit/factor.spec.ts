// The exact-rational factor law (lib/factor), pinned.
//
// Shocks are exact rationals on the wire; the Lab renders the ratio verbatim
// and derives multiplier/percent in bigint arithmetic — exactly when the
// expansion terminates, ≈-marked when it does not, thrown when the input is
// not a factor. Never a silent rounding.

import { expect, test } from "@playwright/test";
import { formatFactor, MINUS_SIGN, renderFactor } from "../../lib/factor";

test.describe("exact terminating factors", () => {
  test("70/100 → ×0.7 · −30% (the eth_minus_30 shock)", () => {
    const f = formatFactor(70, 100);
    expect(f.ratio).toBe("70/100");
    expect(f.times).toBe("×0.7");
    expect(f.percent).toBe(`${MINUS_SIGN}30%`);
    expect(f.exact).toBe(true);
    expect(f.direction).toBe(-1);
  });

  test("995/1000 → −0.5% (the in-band boundary point, exact — not −1%)", () => {
    const f = formatFactor(995, 1000);
    expect(f.times).toBe("×0.995");
    expect(f.percent).toBe(`${MINUS_SIGN}0.5%`);
    expect(f.exact).toBe(true);
  });

  test("the open-band walk: 99/100 → −1%, 98/100 → −2%", () => {
    expect(formatFactor(99, 100).percent).toBe(`${MINUS_SIGN}1%`);
    expect(formatFactor(98, 100).percent).toBe(`${MINUS_SIGN}2%`);
  });

  test("1/1 → 0%, direction 0 (the borrow_apy placeholder factor)", () => {
    const f = formatFactor(1, 1);
    expect(f.percent).toBe("0%");
    expect(f.times).toBe("×1");
    expect(f.direction).toBe(0);
  });

  test("growth signs explicitly: 3/2 → +50%", () => {
    const f = formatFactor(3, 2);
    expect(f.percent).toBe("+50%");
    expect(f.direction).toBe(1);
  });

  test("wire Decimal STRINGS work (AppliedShock factors are strings)", () => {
    const f = formatFactor("70", "100");
    expect(f.percent).toBe(`${MINUS_SIGN}30%`);
  });

  test("wad-scale rationals stay exact through bigint (1.08e18/1e18 → +8%)", () => {
    const f = formatFactor("1080000000000000000", "1000000000000000000");
    expect(f.percent).toBe("+8%");
    expect(f.times).toBe("×1.08");
    expect(f.exact).toBe(true);
  });
});

test.describe("non-terminating expansions are MARKED, never silently rounded", () => {
  test("1/3 → ≈, truncated, both derived forms marked", () => {
    const f = formatFactor(1, 3);
    expect(f.exact).toBe(false);
    expect(f.times).toBe("≈×0.3333");
    expect(f.percent).toBe(`≈${MINUS_SIGN}66.6666%`);
    // The ratio itself remains the exact number.
    expect(f.ratio).toBe("1/3");
  });
});

test.describe("refusals", () => {
  test("zero denominator is refused", () => {
    expect(() => formatFactor(1, 0)).toThrow(/positive/);
  });

  test("negative denominator is refused", () => {
    expect(() => formatFactor(1, -100)).toThrow(/positive/);
  });

  test("a float is not an exact integer and is refused", () => {
    expect(() => formatFactor(0.8, 1)).toThrow(/exact integer/);
  });

  test("a non-decimal string is refused", () => {
    expect(() => formatFactor("0.8", "1")).toThrow(/not a contract decimal/);
  });

  test("p1b-12: negative zero is refused as a factor term — ordinary 0 stays a legal numerator", () => {
    // The p1b-12 negative-zero class at THIS gate: `Number.isSafeInteger(-0)`
    // is true, and `BigInt(-0)` is `0n` — a fractional wire token (`-1e-324`
    // rounds to NEGATIVE ZERO during JSON.parse) would be LAUNDERED into the
    // exact ratio `0/den` and rendered as a computed-looking −100% shock.
    expect(Object.is(JSON.parse("-1e-324"), -0)).toBe(true);
    expect(() => formatFactor(-0, 100)).toThrow(/exact integer/);
    expect(() => formatFactor(100, -0)).toThrow(/exact integer/);
    // A zero NUMERATOR is a legal factor (a full wipe): 0/100 → −100%.
    const f = formatFactor(0, 100);
    expect(f.ratio).toBe("0/100");
    expect(f.percent).toBe(`${MINUS_SIGN}100%`);
  });
});

test("renderFactor puts the ratio first — the ratio IS the number", () => {
  expect(renderFactor(70, 100)).toBe(`70/100 · ×0.7 · ${MINUS_SIGN}30%`);
});
