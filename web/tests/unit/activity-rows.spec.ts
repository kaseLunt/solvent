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

test("action labels are human; an unknown wire word prints verbatim", () => {
  expect(actionLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(actionLabel("deficit_created")).toBe("Deficit created");
  expect(actionLabel("flash_thing")).toBe("flash_thing");
});

// Moved verbatim from tests/unit/inspector-lines.spec.ts (that file is retired in Task 12).
// ---------------------------------------------------------------------------
// r74 — activityTakeaway: "newest first" may only be claimed over rows that
// carry a custodied header time; the untimed tail's order is not chronology.
// ---------------------------------------------------------------------------

test.describe("r74 — activityTakeaway", () => {
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
