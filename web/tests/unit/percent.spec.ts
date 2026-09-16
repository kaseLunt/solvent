import { expect, test } from "@playwright/test";
import { fallPercent, formatTenths, percentOf, percentTenths } from "../../lib/percent";

test("percentTenths truncates toward zero and refuses a non-positive denominator", () => {
  expect(percentTenths(4822000000n, 5012500000n)).toBe(961n); // 4822 / 5012.5 = 96.199… — truncates toward zero, never up
  expect(percentTenths(190500000n, 5012500000n)).toBe(38n); // 3.80…
  expect(percentTenths(-1n, 3n)).toBe(-333n); // toward zero (floor would give −334)
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
