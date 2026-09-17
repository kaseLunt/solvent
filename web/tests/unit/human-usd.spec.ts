import { expect, test } from "@playwright/test";
import { DUST_DISPLAY, humanUsd } from "../../lib/human-usd";

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
  test("a scale the guard refuses throws by name — -0 never multiplies into $239.6M, a negative never throws a nameless RangeError", () => {
    expect(() => humanUsd(239_603_961n, -0)).toThrow(/decimals is not a wire scale.*got -0/);
    expect(() => humanUsd(1n, -1)).toThrow(/got -1/);
    expect(() => humanUsd(1n, 1.5)).toThrow(/got 1\.5/);
    expect(() => humanUsd(1n, 1001)).toThrow(/got 1001/);
  });
});
