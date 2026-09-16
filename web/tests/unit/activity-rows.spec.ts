import { expect, test } from "@playwright/test";
import { EVENTS } from "../fixtures/inspector";
import { actionLabel, activityRows, activityTakeaway } from "../../lib/activity-rows";

test("rows: a custodied time renders; a null block_time falls back to the block number and is untimed", () => {
  const rows = activityRows(EVENTS.events);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.timed).toBe(true);
  expect(rows[0]?.action).toBe("Liquidation");
  expect(rows[1]?.timed).toBe(false);
  expect(rows[1]?.when).toContain("154,796,490");
  expect(rows[1]?.action).toBe("Borrow");
  expect(rows[1]?.asset).toBe("USDC");
  expect(rows[1]?.tx.url).toBe(`https://optimistic.etherscan.io/tx/${EVENTS.events[1]?.tx_hash ?? ""}`);
  expect(rows[0]?.tx.url).toBe(`https://etherscan.io/tx/${EVENTS.events[0]?.tx_hash ?? ""}`);
  expect(rows[0]?.tx.short).toBe(`${(EVENTS.events[0]?.tx_hash ?? "").slice(0, 10)}…`);
});

test("a liquidation row carries its extract: liquidator, repaid, seized", () => {
  const liq = activityRows(EVENTS.events)[0];
  expect(liq?.detail).toBe("liquidator 0xBBbB…0002 repaid 2,500 USDC; seized 0.6562 weETH");
});

test("amounts come from the feed's own vocabulary; a record-only event prints a dash", () => {
  const rows = activityRows(EVENTS.events);
  expect(rows[1]?.amount.length).toBeGreaterThan(0);
  expect(rows[1]?.amountTitle).not.toBeNull();
  const first = EVENTS.events[0];
  if (first === undefined) throw new Error("fixture");
  const recordOnly = activityRows([{ ...first, amount: null, amount_unit: "none" }])[0];
  expect(recordOnly?.amount).toBe("—");
});

test("the wire's own scale places the decimal and raw units are named; empty seizures and unscaled repayments are stated; the Cash repaid unit is USD; short hashes and raw types pass verbatim", () => {
  type Event = (typeof EVENTS.events)[number];
  const scaled = activityRows(EVENTS.events, { valueDecimalsByEngine: { debt_manager: 6 } });
  expect(scaled[1]?.amount).toMatch(/^1,199\.403/);
  expect(scaled[1]?.rawUnits).toBe(false);
  const unscaled = activityRows(EVENTS.events);
  expect(unscaled[1]?.rawUnits).toBe(true);
  expect(unscaled[1]?.unitChip).not.toBeNull();

  const first = EVENTS.events[0];
  if (first === undefined || first.liquidation === null) throw new Error("fixture");
  const liq = first.liquidation;
  const detailOf = (event: Event): string => activityRows([event])[0]?.detail ?? "";
  expect(detailOf({ ...first, liquidation: { ...liq, seized: [] } })).toMatch(/seized — \(no seizure legs carried\)$/);
  expect(detailOf({ ...first, liquidation: { ...liq, debt_decimals: null } })).toContain("repaid 2500000000 (raw units)");
  expect(detailOf({ ...first, liquidation: { ...liq, debt_repaid: null } })).toContain("repaid —");
  expect(detailOf({ ...first, liquidation: { ...liq, debt_repaid: "1.5" } })).toContain("repaid unreadable");
  const dm = detailOf({ ...first, engine: "debt_manager" });
  expect(dm).toContain("repaid 2,500 USD; seized");
  expect(dm).not.toContain("USDC");

  expect(activityRows([{ ...first, tx_hash: "0xabc" }])[0]?.tx.short).toBe("0xabc");
  expect(unscaled[0]?.actionTitle).toBe(first.raw_type);
  expect(unscaled[1]?.actionTitle).toBe(EVENTS.events[1]?.raw_type);
});

test("action labels are human; an unknown wire word prints verbatim", () => {
  expect(actionLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(actionLabel("deficit_created")).toBe("Deficit created");
  expect(actionLabel("flash_thing")).toBe("flash_thing");
});

// ---------------------------------------------------------------------------
// activityTakeaway: "newest first" may only be claimed over rows that carry a
// custodied header time; the untimed tail's order is not chronology.
// ---------------------------------------------------------------------------

test.describe("activityTakeaway", () => {
  test("all rows timed: newest-first is honest, and hasMore blocks the totality reading", () => {
    expect(activityTakeaway(3, 0, false)).toBe(
      "3 custodied action(s) loaded for this account, newest first.",
    );
    expect(activityTakeaway(3, 0, true)).toBe(
      "3 custodied action(s) loaded for this account, newest first · more exist behind the cursor.",
    );
  });

  test("a mixed list splits the claim: timed rows newest first, the untimed tail disclaimed", () => {
    expect(activityTakeaway(4, 2, false)).toBe(
      "6 custodied action(s) loaded for this account: 4 with custodied header time, newest " +
        "first; 2 untimed row(s) follow, in an order that is not chronology.",
    );
  });

  test("no timed rows: NO newest-first claim survives anywhere in the sentence", () => {
    const line = activityTakeaway(0, 2, false);
    expect(line).toBe(
      "2 custodied action(s) loaded for this account, none with a custodied header time — " +
        "their order is not chronology.",
    );
    expect(line).not.toContain("newest first");
  });
});
