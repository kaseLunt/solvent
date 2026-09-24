// web/tests/unit/prose.spec.ts
import { expect, test } from "@playwright/test";
import { FEED_ENGINES } from "../../lib/feed-data";
import { engineName } from "../../lib/inspector-headline";
import { CASH, LEGACY } from "../../lib/inspector-position";
import { OBSERVATORY_ENGINES } from "../../lib/observatory-data";
import {
  CASH_PRICE_SOURCE,
  CASH_PRICE_SOURCE_CHIP,
  engineInProse,
  engineList,
  groupInt,
  joinAnd,
  LEGACY_FOLD_TITLE,
  PIPELINE_STEPS,
  plural,
} from "../../lib/prose";

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

test("plural: a grouped count with its noun, singular exactly at one — zero and every other count take the s; never '(s)'", () => {
  expect(plural(1, "liquidation")).toBe("1 liquidation");
  expect(plural(0, "liquidation")).toBe("0 liquidations");
  expect(plural(2, "account")).toBe("2 accounts");
  expect(plural(18251, "chain action")).toBe("18,251 chain actions");
  expect(plural(1000, "hour")).toBe("1,000 hours");
  for (const n of [0, 1, 2, 1200]) expect(plural(n, "provenance row")).not.toContain("(s)");
});

test("engineInProse: ONE phrasing for an engine inside a sentence — Cash by name, the legacy market with its article — welded to the app's engine constants; an engine the product does not name is never one of the two", () => {
  expect(engineInProse(CASH)).toBe("Cash");
  expect(engineInProse(LEGACY)).toBe("the legacy Aave v3 market");
  // The ids are typed here as literals (this module cannot import its own importers): weld them to every list that owns them.
  expect(engineInProse("debt_manager")).toBe(engineInProse(CASH));
  expect(engineInProse("aave_v3_etherfi")).toBe(engineInProse(LEGACY));
  for (const engine of [...FEED_ENGINES, ...OBSERVATORY_ENGINES]) {
    expect([CASH, LEGACY]).toContain(engine);
    // Every engine the pages serve has a prose name that is not its wire id, and reads inside a sentence.
    expect(engineInProse(engine)).not.toBe(engine);
    expect(`on ${engineInProse(engine)}'s chain`).not.toMatch(/\(legacy\)|_/);
  }
  // The label form stays the label's: a sentence never wears the parenthesis.
  expect(engineName(LEGACY)).toBe("Aave v3 market (legacy)");
  expect(engineInProse(LEGACY)).not.toContain("(");
  expect(engineInProse("some_new_engine")).toBe("some_new_engine");
});

test("engineList: a list of engine labels, Cash first and the legacy market after it, whatever the wire's order — a list, never a sum", () => {
  expect(engineList([LEGACY, CASH])).toBe("Cash and Aave v3 market (legacy)");
  expect(engineList([CASH, LEGACY])).toBe("Cash and Aave v3 market (legacy)");
  expect(engineList([CASH])).toBe("Cash");
  expect(engineList([LEGACY])).toBe("Aave v3 market (legacy)");
  expect(engineList([])).toBe("");
  // Each engine is named once; an engine the product does not name keeps its wire id, after the two it does.
  expect(engineList([LEGACY, CASH, LEGACY])).toBe("Cash and Aave v3 market (legacy)");
  expect(engineList(["some_new_engine", LEGACY, CASH])).toBe("Cash, Aave v3 market (legacy) and some_new_engine");
  // Welded to the label form the chips and kickers already print.
  for (const engine of [CASH, LEGACY]) expect(engineList([engine])).toBe(engineName(engine));
});

test("LEGACY_FOLD_TITLE: one title for the legacy market's fold", () => {
  expect(LEGACY_FOLD_TITLE).toBe("Legacy · Aave v3 market");
});

test("the Cash price source has one true name: the Debt Manager's own price contract, never a feed network it does not read", () => {
  expect(CASH_PRICE_SOURCE).toBe("Cash's own price contract, PriceProvider v2 on OP Mainnet");
  expect(CASH_PRICE_SOURCE_CHIP).toBe("PriceProvider v2");
  expect(CASH_PRICE_SOURCE).toContain(CASH_PRICE_SOURCE_CHIP);
  for (const text of [CASH_PRICE_SOURCE, CASH_PRICE_SOURCE_CHIP]) expect(text).not.toMatch(/redstone/i);
});

test("PIPELINE_STEPS: four names and ordinals, in order; each heading is its ordinal and its name", () => {
  expect(Object.keys(PIPELINE_STEPS)).toEqual(["index", "compute", "verify", "serve"]);
  expect(Object.values(PIPELINE_STEPS).map((step) => step.heading)).toEqual(["01 · Index", "02 · Compute", "03 · Verify", "04 · Serve"]);
  for (const step of Object.values(PIPELINE_STEPS)) expect(step.heading).toBe(`${step.ordinal} · ${step.name}`);
});
