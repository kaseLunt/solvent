// The Feed's honest-amount law (AMENDMENT 1 item B), pinned as executable
// assertions:
//
//   - a null amount is "record-only", never zero;
//   - an `opaque` (or out-of-set) unit renders the RAW integer verbatim —
//     applying amount_decimals under a unit that does not license them
//     would be an interpretation, so it must NOT happen;
//   - scaled / normalized units render the exact value WITH the unit named;
//   - NOTHING here ever produces a "$" — a fake USD figure is the exact lie
//     the unit tag exists to prevent;
//   - severity: liquidation and deficit_created are crit (color + form);
//     the display class itself always renders verbatim.

import { expect, test } from "@playwright/test";
import { feedAmount, feedTagTone, renderBps } from "../../lib/feed-view";
import { EM_DASH } from "../../lib/format";
import type { FeedChainEvent } from "../../lib/feed-data";
import { FEED_UNITS } from "../fixtures/feed";

/** A minimal row builder over the fixture's first (aave_scaled) row. */
function row(overrides: Partial<FeedChainEvent>): FeedChainEvent {
  return { ...FEED_UNITS.events[0], ...overrides } as FeedChainEvent;
}

test.describe("feedAmount", () => {
  test("null amount → record-only, never zero", () => {
    const amount = feedAmount(row({ amount: null, amount_decimals: null, amount_unit: "none" }));
    expect(amount.kind).toBe("record-only");
  });

  test("opaque: the raw integer renders VERBATIM — decimals are refused", () => {
    const opaque = FEED_UNITS.events.find((event) => event.amount_unit === "opaque");
    expect(opaque).toBeDefined();
    // The fixture carries amount_decimals ON PURPOSE (6): applying them
    // would render 123.456789 — an interpretation the unit does not license.
    expect(opaque?.amount_decimals).toBe(6);
    const amount = feedAmount(opaque as FeedChainEvent);
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("123456789");
    expect(amount.display).not.toContain(".");
    expect(amount.unitChip).toBe("opaque units");
  });

  test("an out-of-set unit tag is preserved verbatim, raw, never coerced", () => {
    const amount = feedAmount(
      row({ amount: "5000000", amount_decimals: 6, amount_unit: "engine_v9_units" }),
    );
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("5000000"); // raw — decimals not applied
    expect(amount.unitChip).toBe("engine_v9_units"); // the wire's own word
    expect(amount.unitTitle).toContain("never interpreted");
  });

  test("aave_scaled: exact value with the unit named, never a token claim alone", () => {
    const scaled = FEED_UNITS.events.find((event) => event.amount_unit === "aave_scaled");
    const amount = feedAmount(scaled as FeedChainEvent);
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.unitChip).toBe("aave-scaled");
    expect(amount.unitTitle).toContain("rayMul");
    expect(amount.unitTitle).toContain("never a USD figure");
  });

  test("dm_normalized_debt: exact value with the unit named and the conversion stated", () => {
    const normalized = FEED_UNITS.events.find(
      (event) => event.amount_unit === "dm_normalized_debt",
    );
    const amount = feedAmount(normalized as FeedChainEvent);
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.unitChip).toBe("normalized debt");
    expect(amount.unitTitle).toContain("interest index");
  });

  test("`none` with a non-null amount is wire drift — raw + tag verbatim", () => {
    const amount = feedAmount(row({ amount: "42", amount_decimals: 18, amount_unit: "none" }));
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("42");
    expect(amount.unitChip).toBe("none");
  });

  test("pre-C2 wire (no tag): the committed contract's own claim — asset units", () => {
    const amount = feedAmount(
      row({ amount: "-2500000000", amount_decimals: 6, amount_unit: undefined }),
    );
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("-2500"); // exact formatUnits, trimmed
    expect(amount.unitChip).toBeNull();
  });

  test("NO amount rendering ever contains a dollar sign", () => {
    const cases: FeedChainEvent[] = [
      ...(FEED_UNITS.events as FeedChainEvent[]),
      row({ amount: "1000000", amount_decimals: 6, amount_unit: undefined }),
      row({ amount: "77", amount_decimals: null, amount_unit: "who_knows" }),
    ];
    for (const event of cases) {
      const amount = feedAmount(event);
      if (amount.kind !== "amount") continue;
      expect(amount.display).not.toContain("$");
      expect(amount.unitChip ?? "").not.toContain("$");
    }
  });
});

test.describe("severity + bps", () => {
  test("liquidation and deficit_created are crit; ordinary actions are not", () => {
    expect(feedTagTone("liquidation")).toBe("crit");
    expect(feedTagTone("deficit_created")).toBe("crit");
    expect(feedTagTone("borrow")).toBe("info");
    expect(feedTagTone("collateral_enabled")).toBe("info");
  });

  test("a null bonus is an em dash — never an estimate", () => {
    expect(renderBps(null)).toBe(EM_DASH);
    expect(renderBps("500")).toBe("500 bps");
  });
});
