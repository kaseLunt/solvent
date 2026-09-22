import { expect, test } from "@playwright/test";
import { DEMO_EVENTS_NEAR } from "../fixtures/demo";
import { EVENTS } from "../fixtures/inspector";
import { actionLabel, activityEmptyText, activityFailureText, activityRows, activityTakeaway } from "../../lib/activity-rows";
import { EVENT_DISPLAY_TYPES } from "../../lib/feed-data";
import { RECORD_ONLY_TITLE, RECORD_ONLY_WORD, typeLabel } from "../../lib/feed-view";

// A page failure beside loaded rows is its own line: the table's empty words print only with no rows, so a
// refused "Load more" folded into them would never show. The rows stand; the failure speaks in its own words.
test("activityEmptyText and activityFailureText: the load phase, the failure's own words, the proven-empty sentence; a failure beside rows keeps the rows", () => {
  const error = new Error("503 unavailable: no complete risk batch is available (http://x/v1/events?cursor=p2)");
  expect(activityEmptyText(true, null)).toBe("Loading activity…");
  expect(activityEmptyText(true, error)).toBe("Loading activity…");
  expect(activityEmptyText(false, error)).toBe(`Activity unavailable: ${error.message}`);
  expect(activityEmptyText(false, null)).toBe("No custodied actions for this account.");
  expect(activityFailureText(error)).toBe(`More activity could not be loaded: ${error.message}. The rows above stand; nothing beyond them was read.`);
});

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

test("amounts come from the feed's own vocabulary; a record-only event prints a dash with the Activity page's word beside it", () => {
  const rows = activityRows(EVENTS.events);
  expect(rows[1]?.amount.length).toBeGreaterThan(0);
  expect(rows[1]?.amountTitle).not.toBeNull();
  const first = EVENTS.events[0];
  if (first === undefined) throw new Error("fixture");
  const recordOnly = activityRows([{ ...first, amount: null, amount_unit: "none" }])[0];
  expect(recordOnly?.amount).toBe("—");
  // The two surfaces agree: a dash where the figure would be, the record's word in the unit words, its statement in the title.
  expect(recordOnly?.unit).toBe(RECORD_ONLY_WORD);
  expect(recordOnly?.amountTitle).toBe(RECORD_ONLY_TITLE);
  expect(recordOnly?.rawUnits).toBe(false);
});

test("a normalized figure is never followed by a bare symbol: the value alone, then the unit words in the Activity page's order", () => {
  const rows = activityRows(DEMO_EVENTS_NEAR.events, { valueDecimalsByEngine: { debt_manager: 6 } });
  expect(rows[0]).toMatchObject({ action: "Borrow", asset: "USDC", amount: "622", unit: "· normalized debt · USDC", rawUnits: false });
  expect(rows.map((r) => r.amount)).not.toContain("622 USDC");
  // The signed repay keeps its sign; no amount cell carries a symbol.
  expect(rows.find((r) => r.action === "Repay")).toMatchObject({ amount: "-150", unit: "· normalized debt · USDC" });
  for (const row of rows) expect(row.amount).not.toMatch(/[A-Za-z]/);
  // No licensed scale: the raw integer, the raw-units pill's flag, and the same unit words — the symbol never touches the digits.
  const raw = activityRows(DEMO_EVENTS_NEAR.events);
  expect(raw[0]).toMatchObject({ amount: "622000000", unit: "· normalized debt · USDC", rawUnits: true });
});

test("the wire's own scale places the decimal and raw units are named; empty seizures and unscaled repayments are stated; the Cash repaid unit is USD; short hashes and raw types pass verbatim", () => {
  type Event = (typeof EVENTS.events)[number];
  const scaled = activityRows(EVENTS.events, { valueDecimalsByEngine: { debt_manager: 6 } });
  expect(scaled[1]?.amount).toMatch(/^1,199\.403/);
  expect(scaled[1]?.rawUnits).toBe(false);
  const unscaled = activityRows(EVENTS.events);
  expect(unscaled[1]?.rawUnits).toBe(true);
  expect(unscaled[1]?.unit).toBe("· normalized debt · USDC");

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

test("action labels are human, in the Activity page's own words for the same wire types; an unknown wire word prints verbatim", () => {
  expect(actionLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(actionLabel("deficit_created")).toBe("Bad debt realised");
  expect(actionLabel("borrow")).toBe("Borrow");
  expect(actionLabel("flash_thing")).toBe("flash_thing");
  // One vocabulary on both surfaces: the Inspector's action is the Activity page's type word, sentence-cased.
  for (const type of EVENT_DISPLAY_TYPES) {
    const words = typeLabel(type);
    expect(actionLabel(type)).toBe(`${words.charAt(0).toUpperCase()}${words.slice(1)}`);
  }
});

// ---------------------------------------------------------------------------
// activityTakeaway: "newest first" may only be claimed over rows that carry a
// custodied header time; the untimed tail's order is not chronology.
// ---------------------------------------------------------------------------

test.describe("activityTakeaway", () => {
  test("all rows timed: newest-first is honest, and hasMore blocks the totality reading", () => {
    expect(activityTakeaway(3, 0, false)).toBe(
      "3 custodied actions loaded for this account, newest first.",
    );
    expect(activityTakeaway(3, 0, true)).toBe(
      "3 custodied actions loaded for this account, newest first · more exist behind the cursor.",
    );
  });

  test("a mixed list splits the claim: timed rows newest first, the untimed tail disclaimed", () => {
    // Real plurals, never "(s)": one untimed row follows, one action is loaded.
    expect(activityTakeaway(5, 1, false)).toBe(
      "6 custodied actions loaded for this account: 5 with custodied header time, newest first; 1 untimed row follows, " +
        "in an order that is not chronology.",
    );
    expect(activityTakeaway(1, 0, false)).toBe("1 custodied action loaded for this account, newest first.");
    expect(activityTakeaway(4, 2, false)).toBe(
      "6 custodied actions loaded for this account: 4 with custodied header time, newest " +
        "first; 2 untimed rows follow, in an order that is not chronology.",
    );
  });

  test("no timed rows: NO newest-first claim survives anywhere in the sentence", () => {
    const line = activityTakeaway(0, 2, false);
    expect(line).toBe(
      "2 custodied actions loaded for this account, none with a custodied header time — " +
        "their order is not chronology.",
    );
    expect(line).not.toContain("newest first");
  });
});
