// web/tests/unit/prose.spec.ts
import { expect, test } from "@playwright/test";
import { groupInt, joinAnd } from "../../lib/prose";

test("joinAnd: one name stands alone, two take 'and', three take a comma and 'and', none is empty", () => {
  expect(joinAnd(["Cash"])).toBe("Cash");
  expect(joinAnd(["Cash", "Aave v3 market (legacy)"])).toBe("Cash and Aave v3 market (legacy)");
  expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  expect(joinAnd(["weETH", "ETHFI", "wstETH"])).toBe("weETH, ETHFI and wstETH");
  expect(joinAnd([])).toBe("");
});

test("groupInt: en-US grouping for a number and a bigint; nothing under a thousand is touched", () => {
  expect(groupInt(18251)).toBe("18,251");
  expect(groupInt(155315000)).toBe("155,315,000");
  expect(groupInt(29)).toBe("29");
  expect(groupInt(0)).toBe("0");
  expect(groupInt(1234567n)).toBe("1,234,567");
});
