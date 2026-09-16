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
