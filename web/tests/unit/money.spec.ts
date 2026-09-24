import { expect, test } from "@playwright/test";
import { groupDecimalString, groupExactDecimal, MINUS_SIGN, renderEngineAmount, renderSignedUsdAmount, renderUsdAmount } from "../../lib/book-format";
import { MINUS } from "../../lib/format";
import { MINUS as HUMAN_USD_MINUS } from "../../lib/human-usd";
import { UNREADABLE_SCALE as LAB_UNREADABLE_SCALE } from "../../lib/lab-headline";
import {
  accountMoney,
  accountMoneyColumn,
  bookMoney,
  exactDecimal,
  exactMoney,
  guarded,
  signedAccountMoney,
  signedBookMoney,
  UNREADABLE_SCALE,
  wireExact,
  wireMoney,
  wirePrice,
} from "../../lib/money";
import { paramPercent } from "../../lib/params-format";

test.describe("one minus: U+2212 on the display layer, the wire's ASCII '-' on the exact layer", () => {
  test("every module's minus is the one MINUS", () => {
    expect(MINUS).toBe("−");
    expect(MINUS_SIGN).toBe(MINUS);
    expect(HUMAN_USD_MINUS).toBe(MINUS);
  });

  test("groupDecimalString is the display grouping: a leading hyphen is typeset as the minus, the digits untouched", () => {
    expect(groupDecimalString("-150")).toBe("−150");
    expect(groupDecimalString("-1234567.5")).toBe("−1,234,567.5");
    expect(groupDecimalString("−150")).toBe("−150");
    expect(groupDecimalString("4200000.5")).toBe("4,200,000.5");
    expect(groupDecimalString("0")).toBe("0");
  });

  test("groupExactDecimal is the exact grouping: the sign exactly as the wire wrote it, so a copied value parses", () => {
    expect(groupExactDecimal("-150")).toBe("-150");
    expect(groupExactDecimal("-1234567.5")).toBe("-1,234,567.5");
    expect(groupExactDecimal("4200000.5")).toBe("4,200,000.5");
  });

  test("a formatUnits figure on the display layer prints the minus; the exact USD register keeps the hyphen", () => {
    expect(renderEngineAmount("-132314285", 6)).toBe("−132.314285");
    expect(renderEngineAmount(null, 6)).toBe("—");
    expect(renderSignedUsdAmount("-4200000000", 6)).toBe("−$4,200");
    expect(renderUsdAmount("-5000000", 6)).not.toContain(MINUS);
    expect(renderUsdAmount("1234567890", 6)).toBe("$1,234.56789");
  });

  test("a risk parameter below zero on the display layer prints the minus", () => {
    expect(paramPercent("-5000", "aave_v3_etherfi")).toBe("−50%");
    expect(paramPercent("8100", "aave_v3_etherfi")).toBe("81%");
  });
});

test.describe("the three registers, one module", () => {
  test("book: compact and truncating; account: never compacted; both say '<$0.01' below a cent and '$0' only for zero", () => {
    expect(bookMoney(6)(4_620_000_000n)).toBe("$4,620");
    expect(bookMoney(6)(27_942_906_330_446n)).toBe("$27.9M");
    expect(bookMoney(6)(1n)).toBe("<$0.01");
    expect(bookMoney(6)(0n)).toBe("$0");
    expect(accountMoney(6)(113_288_000_000n)).toBe("$113,288");
    expect(accountMoney(6)(812_500_000n)).toBe("$812.50");
    expect(accountMoney(6)(1n)).toBe("<$0.01");
    expect(accountMoney(6)(0n)).toBe("$0");
    expect(accountMoney(6)(-184_800_000n)).toBe("−$184.80");
  });

  test("signed: '+' for a rise, U+2212 for a fall, the sign ahead of the currency mark", () => {
    expect(signedBookMoney(6)(-184_800_000n)).toBe("−$184.80");
    expect(signedBookMoney(6)(12_000_000_000n)).toBe("+$12K");
    expect(signedAccountMoney(6)(1_069_000_000n)).toBe("+$1,069");
    expect(signedAccountMoney(6)(-812_500_000n)).toBe("−$812.50");
    // A zero carries no sign, as formatTenths and renderSignedUsdAmount print it.
    expect(signedBookMoney(6)(0n)).toBe("$0");
    expect(signedAccountMoney(6)(0n)).toBe("$0");
  });

  test("exact: every wire digit, the hyphen kept; the $ form trims trailing zeros, the bare form keeps every place", () => {
    expect(exactMoney(6)(1_234_567_890n)).toBe("$1,234.56789");
    expect(exactMoney(6)(-5_000_000n)).toBe("-$5");
    expect(exactDecimal(1_280_000_000_000n, 6)).toBe("1,280,000.000000");
    expect(exactDecimal(-1_280_000_000_000n, 6)).toBe("-1,280,000.000000");
    expect(exactDecimal(4822n, 0)).toBe("4,822");
    expect(wireExact("4822000000", 6)).toBe("4,822.000000");
    expect(wireExact("-150000000", 6)).toBe("-150.000000");
    for (const text of [exactDecimal(-1n, 6), wireExact("-1", 6), exactMoney(6)(-1n)]) expect(text).not.toContain(MINUS);
  });

  test("guarded: null is the dash, a scale the wire guard refuses is the unreadable word, never a figure and never a throw", () => {
    for (const money of [bookMoney, signedBookMoney, accountMoney, signedAccountMoney, exactMoney]) {
      expect(money(6)(null)).toBe("—");
      expect(money(6)(undefined)).toBe("—");
      expect(money(null)(5n)).toBe(UNREADABLE_SCALE);
      expect(money(null)(null)).toBe("—");
      expect(money(-0)(5n)).toBe(UNREADABLE_SCALE);
      expect(money(1.5)(5n)).toBe(UNREADABLE_SCALE);
      expect(money(1001)(5n)).toBe(UNREADABLE_SCALE);
    }
    expect(guarded(6, (value) => `x${value.toString()}`)(7n)).toBe("x7");
    expect(UNREADABLE_SCALE).toBe("unreadable scale");
    expect(LAB_UNREADABLE_SCALE).toBe(UNREADABLE_SCALE);
  });

  test("wire strings pass both guards before a BigInt: absent is the dash, a non-decimal is 'unreadable'", () => {
    expect(wireMoney("4822000000", 6)).toBe("$4,822");
    expect(wireMoney(null, 6)).toBe("—");
    expect(wireMoney(undefined, 6)).toBe("—");
    expect(wireMoney("4.8e9", 6)).toBe("unreadable");
    expect(wireMoney("4822000000", 1001)).toBe(UNREADABLE_SCALE);
    expect(wirePrice("1250000", 6)).toBe("$1.2500");
    expect(wirePrice("4000000000", 6)).toBe("$4,000.00");
    expect(wirePrice(null, 6)).toBe("—");
    expect(wirePrice("x", 6)).toBe("unreadable");
    expect(wirePrice("1250000", null)).toBe(UNREADABLE_SCALE);
    expect(wireExact(null, 6)).toBe("—");
    expect(wireExact("", 6)).toBe("unreadable");
    expect(wireExact("5", 1001)).toBe(UNREADABLE_SCALE);
  });
});

test.describe("accountMoneyColumn — one precision per column", () => {
  test("any |value| at or above $1,000 puts the whole column in whole dollars, truncated", () => {
    const values = [4_200_000_000n, 812_500_000n, 5_012_000_000n];
    const money = accountMoneyColumn(values, 6);
    expect(values.map(money)).toEqual(["$4,200", "$812", "$5,012"]);
    // The boundary is inclusive: exactly $1,000 is a whole-dollar column.
    expect([1_000_000_000n, 5_500_000n].map(accountMoneyColumn([1_000_000_000n, 5_500_000n], 6))).toEqual(["$1,000", "$5"]);
    // A negative counts by its size.
    expect([-1_069_000_000n, 184_800_000n].map(accountMoneyColumn([-1_069_000_000n, 184_800_000n], 6))).toEqual(["−$1,069", "$184"]);
  });

  test("a whole-dollar column never prints a nonzero figure as $0: under a dollar is '<$1'; only a true zero is '$0'", () => {
    const values = [4_200_000_000n, 500_000n, 0n, null];
    expect(values.map(accountMoneyColumn(values, 6))).toEqual(["$4,200", "<$1", "$0", "—"]);
  });

  test("a column entirely under $1,000 prints every row in cents — sub-cent '<$0.01', a zero '$0', null the dash", () => {
    const values = [999_990_000n, 5_500_000n, 5_000_000n, 1n, 0n, null, undefined];
    expect(values.map(accountMoneyColumn(values, 6))).toEqual(["$999.99", "$5.50", "$5.00", "<$0.01", "$0", "—", "—"]);
  });

  test("the precision is the column's: truncation toward zero, never rounded up, at either precision", () => {
    expect(accountMoneyColumn([1_999_999_999n], 6)(1_999_999_999n)).toBe("$1,999");
    expect(accountMoneyColumn([9_999n], 6)(9_999n)).toBe("<$0.01");
    expect(accountMoneyColumn([19_999n], 6)(19_999n)).toBe("$0.01");
  });

  test("a scale the guard refuses prints the unreadable word in every present row", () => {
    for (const decimals of [null, 1001, -0, 2.5]) {
      const money = accountMoneyColumn([5n, null], decimals);
      expect(money(5n)).toBe(UNREADABLE_SCALE);
      expect(money(null)).toBe("—");
    }
  });
});
