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
//
// WAVE R1 ITEM 4 extends the law with SCALE-BY-PROVENANCE. This API serves
// `amount_decimals: null` on every row, so the old code rendered every amount
// as a raw integer — a $22 borrow as `22064279`. Now:
//   - dm_normalized_debt IS a fixed point at the engine's own value_decimals,
//     so given that number FROM THE WIRE the decimal point is placed exactly
//     (with thousands separators);
//   - aave_scaled's scale is the TOKEN's decimals, which the event does not
//     carry — so it stays RAW and gains the `raw units` tag. Substituting the
//     engine's base-currency decimals there would be a fabrication;
//   - every verbatim-rendered integer carries `rawUnits: true`, so the row
//     can tag it and no unscaled number ever renders bare.

import { expect, test } from "@playwright/test";
import { RAW_UNITS_TAG, feedAmount, feedTagTone, renderBps } from "../../lib/feed-view";
import { EM_DASH } from "../../lib/format";
import type { FeedChainEvent } from "../../lib/feed-data";
import { FEED_UNITS } from "../fixtures/feed";

/**
 * A minimal row builder over the fixture's first (aave_scaled) row.
 * `amount_unit` is widened to plain string so the OUT-OF-SET runtime cases
 * (the wire's bytes are the authority, not the generated union) stay
 * constructible.
 */
function row(
  overrides: Partial<Omit<FeedChainEvent, "amount_unit">> & { amount_unit?: string },
): FeedChainEvent {
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

  test("aave_scaled WITHOUT leg decimals stays RAW and tagged — the engine's scale is a different unit", () => {
    const scaled = FEED_UNITS.events.find((event) => event.amount_unit === "aave_scaled");
    expect(scaled?.amount_decimals).toBeNull();
    // Even handed the Aave engine's own value_decimals (8, the pool's base
    // currency), the ray-scaled TOKEN amount must not be divided by it.
    const amount = feedAmount(scaled as FeedChainEvent, { engineValueDecimals: 8 });
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("1500000000000000000");
    expect(amount.rawUnits).toBe(true);
    expect(amount.unitChip).toBe("aave-scaled");
    expect(amount.unitTitle).toContain("rayMul");
    expect(amount.unitTitle).toContain("never a USD figure");
  });

  test("aave_scaled WITH leg decimals is placed exactly, with separators", () => {
    const scaled = FEED_UNITS.events.find((event) => event.amount_unit === "aave_scaled");
    const amount = feedAmount({ ...(scaled as FeedChainEvent), amount_decimals: 18 });
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("1.5");
    expect(amount.rawUnits).toBe(false);
  });

  test("dm_normalized_debt: the engine's value_decimals place the point, with separators", () => {
    const normalized = FEED_UNITS.events.find(
      (event) => event.amount_unit === "dm_normalized_debt",
    );
    const amount = feedAmount(normalized as FeedChainEvent, { engineValueDecimals: 6 });
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    // 1199403000 at 6 decimals — the defect was rendering this as "1199403000".
    expect(amount.display).toBe("1,199.403");
    expect(amount.rawUnits).toBe(false);
    expect(amount.unitChip).toBe("normalized debt");
    expect(amount.unitTitle).toContain("interest index");
  });

  test("dm_normalized_debt with NO known engine scale stays raw and tagged — never guessed", () => {
    const normalized = FEED_UNITS.events.find(
      (event) => event.amount_unit === "dm_normalized_debt",
    );
    const amount = feedAmount(normalized as FeedChainEvent);
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("1199403000");
    expect(amount.rawUnits).toBe(true);
    expect(amount.unitTitle).toContain("raw integer");
  });

  test("the row's OWN amount_decimals win over the engine's", () => {
    const normalized = FEED_UNITS.events.find(
      (event) => event.amount_unit === "dm_normalized_debt",
    );
    const amount = feedAmount(
      { ...(normalized as FeedChainEvent), amount_decimals: 3 },
      { engineValueDecimals: 6 },
    );
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("1,199,403");
  });

  test("every VERBATIM integer is flagged rawUnits, so the row can tag it", () => {
    expect(RAW_UNITS_TAG).toBe("raw units");
    const rawCases: FeedChainEvent[] = [
      FEED_UNITS.events.find((event) => event.amount_unit === "opaque") as FeedChainEvent,
      row({ amount: "42", amount_decimals: 18, amount_unit: "none" }),
      row({ amount: "5000000", amount_decimals: 6, amount_unit: "engine_v9_units" }),
      row({ amount: "-2500000000", amount_decimals: 6, amount_unit: undefined }),
    ];
    for (const event of rawCases) {
      const amount = feedAmount(event, { engineValueDecimals: 6 });
      expect(amount.kind).toBe("amount");
      if (amount.kind !== "amount") continue;
      expect(amount.rawUnits).toBe(true);
    }
  });

  test("`none` with a non-null amount is wire drift — raw + tag verbatim", () => {
    const amount = feedAmount(row({ amount: "42", amount_decimals: 18, amount_unit: "none" }));
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    expect(amount.display).toBe("42");
    expect(amount.unitChip).toBe("none");
  });

  test("an ABSENT tag (off-1.2.0 wire) is drift: raw verbatim, never an unlicensed scale", () => {
    const amount = feedAmount(
      row({ amount: "-2500000000", amount_decimals: 6, amount_unit: undefined }),
    );
    expect(amount.kind).toBe("amount");
    if (amount.kind !== "amount") return;
    // amount_decimals are NOT applied: the field is required since 1.2.0, so
    // its absence means the wire is outside the contract and no scale is
    // licensed for the figure.
    expect(amount.display).toBe("-2500000000");
    expect(amount.unitChip).toBe("no unit tag");
    expect(amount.unitTitle).toContain("wire drift");
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
