// The Feed seam's laws (lib/feed-data.ts), pinned:
//
//   - the untimed tail split PRESERVES wire order, discloses the tail, and
//     flags (never hides) a wire that broke the timed-before-untimed law;
//   - a cross-engine since_block is refused LOCALLY — never sent;
//   - the display vocabulary is the contract's closed set, verbatim;
//   - the amount-unit closed set is internal/store/p5_events.go's, verbatim.

import { expect, test } from "@playwright/test";
import {
  EVENT_DISPLAY_TYPES,
  FEED_AMOUNT_UNITS,
  FEED_ENGINES,
  SINCE_BLOCK_IMPOSSIBILITY,
  assertFeedScopeLawful,
  feedOrderMode,
  isKnownAmountUnit,
  splitUntimedTail,
} from "../../lib/feed-data";
import { FEED_CROSS_PAGE_1, FEED_CROSS_PAGE_2, FEED_CROSS_TIMED } from "../fixtures/feed";

test.describe("splitUntimedTail", () => {
  test("all-timed pages have no tail", () => {
    const split = splitUntimedTail(FEED_CROSS_TIMED.events);
    expect(split.timed).toHaveLength(3);
    expect(split.untimed).toHaveLength(0);
    expect(split.orderViolated).toBe(false);
  });

  test("the tail starts at the first untimed row and keeps wire order", () => {
    const events = [...FEED_CROSS_PAGE_1.events, ...FEED_CROSS_PAGE_2.events];
    const split = splitUntimedTail(events);
    expect(split.timed).toHaveLength(1); // the timed aave liquidation
    expect(split.untimed).toHaveLength(3); // dm borrow + page-2 tail
    expect(split.orderViolated).toBe(false);
    // Wire order preserved exactly — no re-sorting.
    expect([...split.timed, ...split.untimed]).toEqual(events);
  });

  test("a timed row inside the tail is DISCLOSED as a violation, not re-sorted", () => {
    const timedRow = FEED_CROSS_PAGE_1.events.find((event) => event.block_time !== null);
    const untimedRow = FEED_CROSS_PAGE_1.events.find((event) => event.block_time === null);
    expect(timedRow).toBeDefined();
    expect(untimedRow).toBeDefined();
    if (timedRow === undefined || untimedRow === undefined) return;
    const split = splitUntimedTail([untimedRow, timedRow]);
    expect(split.timed).toHaveLength(0);
    expect(split.untimed).toHaveLength(2);
    expect(split.orderViolated).toBe(true);
    expect(split.untimed).toEqual([untimedRow, timedRow]); // wire order kept
  });

  test("empty pages split to nothing, honestly", () => {
    const split = splitUntimedTail([]);
    expect(split.timed).toHaveLength(0);
    expect(split.untimed).toHaveLength(0);
    expect(split.orderViolated).toBe(false);
  });
});

test.describe("the scope law", () => {
  test("cross-engine since_block is refused locally, never sent", () => {
    expect(() => {
      assertFeedScopeLawful({ engine: null, types: [], sinceBlock: 25635600 });
    }).toThrow(/refused locally, never sent/);
    expect(() => {
      assertFeedScopeLawful({ engine: null, types: [], sinceBlock: 25635600 });
    }).toThrow(/incomparable across chains/);
  });

  test("engine-scoped since_block is lawful; mode derives from the engine", () => {
    expect(() => {
      assertFeedScopeLawful({ engine: "aave_v3_etherfi", types: [], sinceBlock: 25635600 });
    }).not.toThrow();
    expect(feedOrderMode({ engine: "aave_v3_etherfi", types: [], sinceBlock: null })).toBe(
      "engine-scoped",
    );
    expect(feedOrderMode({ engine: null, types: [], sinceBlock: null })).toBe("cross-engine");
  });

  test("the impossibility text states the WHY (chains, not errors)", () => {
    expect(SINCE_BLOCK_IMPOSSIBILITY).toContain("incomparable across chains");
    expect(SINCE_BLOCK_IMPOSSIBILITY).toContain("not an error");
  });
});

test.describe("closed vocabularies", () => {
  test("the display vocabulary is the contract's eight classes, verbatim", () => {
    expect([...EVENT_DISPLAY_TYPES].sort()).toEqual(
      [
        "borrow",
        "repay",
        "supply",
        "withdraw",
        "liquidation",
        "collateral_enabled",
        "collateral_disabled",
        "deficit_created",
      ].sort(),
    );
  });

  test("the engines are the contract's two, verbatim — never combined", () => {
    expect([...FEED_ENGINES]).toEqual(["aave_v3_etherfi", "debt_manager"]);
  });

  test("the amount-unit set is the store's four, and membership is exact", () => {
    expect([...FEED_AMOUNT_UNITS].sort()).toEqual(
      ["none", "dm_normalized_debt", "aave_scaled", "opaque"].sort(),
    );
    expect(isKnownAmountUnit("aave_scaled")).toBe(true);
    expect(isKnownAmountUnit("usd")).toBe(false); // no USD unit EXISTS to claim
  });
});
