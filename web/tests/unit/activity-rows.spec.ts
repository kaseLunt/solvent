import { expect, test } from "@playwright/test";
import { DEMO_EVENTS_NEAR } from "../fixtures/demo";
import { EVENTS } from "../fixtures/inspector";
import {
  ACTIVITY_CARD_QUALIFIER,
  UNTIMED_WHEN_TITLE,
  actionLabel,
  activityEmptyText,
  activityFailureText,
  activityRows,
  activityTakeaway,
} from "../../lib/activity-rows";
import { EVENT_DISPLAY_TYPES } from "../../lib/feed-data";
import { RAW_UNITS_TAG, RECORD_ONLY_TITLE, RECORD_ONLY_WORD, liquidationRepaid, typeLabel } from "../../lib/feed-view";
import { truncateAddress } from "../../lib/format";

// A page failure beside loaded rows is its own line: the table's empty words print only with no rows, so a
// refused "Load more" folded into them would never show. The rows stand; the failure speaks in its own words.
test("activityEmptyText and activityFailureText: the load phase, the failure's own words, the proven-empty sentence; a failure beside rows keeps the rows", () => {
  const error = new Error("503 unavailable: no complete risk batch is available (http://x/v1/events?cursor=p2)");
  expect(activityEmptyText(true, null)).toBe("Loading activity…");
  expect(activityEmptyText(true, error)).toBe("Loading activity…");
  expect(activityEmptyText(false, error)).toBe(`Activity unavailable: ${error.message}`);
  expect(activityEmptyText(false, null)).toBe("No chain actions for this account.");
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

test("a liquidation row carries its extract in the Activity page's words: liquidator, debt repaid, seized — the figures exact, never truncated", () => {
  const liq = activityRows(EVENTS.events)[0];
  expect(liq?.detail).toBe("liquidator 0xBBbB…0002 · debt repaid 2,500 USDC · seized 0.65625 weETH");
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
  expect(recordOnly?.amountTag).toBeNull();
});

test("a normalized figure is never followed by a bare symbol: the value alone, then the unit words in the Activity page's order", () => {
  const rows = activityRows(DEMO_EVENTS_NEAR.events, { valueDecimalsByEngine: { debt_manager: 6 } });
  expect(rows[0]).toMatchObject({ action: "Borrow", asset: "USDC", amount: "622", unit: "· normalized debt · USDC", amountTag: null });
  expect(rows.map((r) => r.amount)).not.toContain("622 USDC");
  // The signed repay keeps its sign; no amount cell carries a symbol.
  expect(rows.find((r) => r.action === "Repay")).toMatchObject({ amount: "-150", unit: "· normalized debt · USDC" });
  for (const row of rows) expect(row.amount).not.toMatch(/[A-Za-z]/);
  // No licensed scale: the raw integer with the raw word beside it in the Amount cell, and the same unit words — said
  // once: the unit words never repeat the raw word, and the symbol never touches the digits.
  const raw = activityRows(DEMO_EVENTS_NEAR.events);
  expect(raw[0]).toMatchObject({ amount: "622000000", amountTag: RAW_UNITS_TAG, unit: "· normalized debt · USDC" });
  for (const row of raw) expect(row.unit).not.toContain(RAW_UNITS_TAG);
});

test("the wire's own scale places the decimal and raw units are named; empty seizures and unscaled repayments are stated; the Cash repaid unit is USD; short hashes and raw types pass verbatim", () => {
  type Event = (typeof EVENTS.events)[number];
  const scaled = activityRows(EVENTS.events, { valueDecimalsByEngine: { debt_manager: 6 } });
  expect(scaled[1]?.amount).toMatch(/^1,199\.403/);
  expect(scaled[1]?.amountTag).toBeNull();
  const unscaled = activityRows(EVENTS.events);
  expect(unscaled[1]?.amountTag).toBe(RAW_UNITS_TAG);
  expect(unscaled[1]?.unit).toBe("· normalized debt · USDC");

  const first = EVENTS.events[0];
  if (first === undefined || first.liquidation === null) throw new Error("fixture");
  const liq = first.liquidation;
  const detailOf = (event: Event): string => activityRows([event])[0]?.detail ?? "";
  expect(detailOf({ ...first, liquidation: { ...liq, seized: [] } })).toMatch(/seized — \(no seizure legs carried\)$/);
  // The one repaid figure both surfaces print (liquidationRepaid): unscaled, the raw digits and the raw word — no
  // currency or token beside them, on either engine.
  expect(detailOf({ ...first, liquidation: { ...liq, debt_decimals: null } })).toContain(`debt repaid 2500000000 ${RAW_UNITS_TAG} · seized`);
  expect(detailOf({ ...first, engine: "debt_manager", liquidation: { ...liq, debt_decimals: null } })).toContain(`debt repaid 2500000000 ${RAW_UNITS_TAG} · seized`);
  expect(detailOf({ ...first, liquidation: { ...liq, debt_repaid: null } })).toContain("debt repaid — · seized");
  expect(detailOf({ ...first, liquidation: { ...liq, debt_repaid: "1.5" } })).toContain("debt repaid unreadable · seized");
  expect(detailOf({ ...first, liquidation: { ...liq, debt_repaid: "1e6", debt_decimals: null } })).toContain("debt repaid unreadable · seized");
  const dm = detailOf({ ...first, engine: "debt_manager" });
  expect(dm).toContain("debt repaid 2,500 USD · seized");
  expect(dm).not.toContain("USDC");
  // The legacy row with no symbol names its debt asset shortened; with neither, a dash.
  const debtAsset = liq.debt_asset ?? "";
  expect(detailOf({ ...first, symbol: undefined })).toContain(`debt repaid 2,500 ${truncateAddress(debtAsset)} · seized`);
  expect(detailOf({ ...first, symbol: undefined, liquidation: { ...liq, debt_asset: null } })).toContain("debt repaid 2,500 — · seized");
  // Both surfaces read one function for this figure: the card's words are its figure and unit, verbatim.
  for (const variant of [first, { ...first, engine: "debt_manager" }, { ...first, liquidation: { ...liq, debt_decimals: null } }]) {
    const { figure, unit } = liquidationRepaid(variant, variant.liquidation ?? liq);
    expect(detailOf(variant)).toContain(`debt repaid ${unit === null ? figure : `${figure} ${unit}`} · seized`);
  }
  // A seizure leg the guards refuse: never scaled, never truncated, never a unit on raw digits.
  const leg = liq.seized[0];
  if (leg === undefined) throw new Error("fixture: one seizure leg");
  expect(detailOf({ ...first, liquidation: { ...liq, seized: [{ ...leg, decimals: -1 }] } })).toMatch(new RegExp(`seized ${leg.amount} ${RAW_UNITS_TAG} \\(weETH\\)$`));
  expect(detailOf({ ...first, liquidation: { ...liq, seized: [{ ...leg, amount: "6.5e17" }] } })).toMatch(/seized unreadable \(weETH\)$/);

  expect(activityRows([{ ...first, tx_hash: "0xabc" }])[0]?.tx.short).toBe("0xabc");
  expect(unscaled[0]?.actionTitle).toBe(first.raw_type);
  expect(unscaled[1]?.actionTitle).toBe(EVENTS.events[1]?.raw_type);
});

test("action labels are human, in the Activity page's own words for the same wire types; an unknown wire word prints verbatim", () => {
  expect(actionLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(actionLabel("deficit_created")).toBe("Bad debt realized");
  expect(actionLabel("borrow")).toBe("Borrow");
  expect(actionLabel("flash_thing")).toBe("flash_thing");
  for (const word of ["__proto__", "constructor", "toString"]) expect(actionLabel(word)).toBe(word);
  // One vocabulary on both surfaces: the Inspector's action is the Activity page's type word, sentence-cased.
  for (const type of EVENT_DISPLAY_TYPES) {
    const words = typeLabel(type);
    expect(actionLabel(type)).toBe(`${words.charAt(0).toUpperCase()}${words.slice(1)}`);
  }
});

// ---------------------------------------------------------------------------
// activityTakeaway: "newest first" may only be claimed over rows that carry a
// block time; the untimed tail's order is not chronology.
// ---------------------------------------------------------------------------

test.describe("activityTakeaway", () => {
  test("all rows timed: newest-first is honest, and hasMore blocks the totality reading", () => {
    expect(activityTakeaway(3, 0, false)).toBe(
      "3 chain actions loaded for this account, newest first.",
    );
    expect(activityTakeaway(3, 0, true)).toBe(
      "3 chain actions loaded for this account, newest first · more exist behind the cursor.",
    );
  });

  test("a mixed list splits the claim: timed rows newest first, the untimed tail disclaimed", () => {
    // Real plurals, never "(s)": one untimed row follows, one action is loaded.
    expect(activityTakeaway(5, 1, false)).toBe(
      "6 chain actions loaded for this account: 5 with a block time, newest first; 1 untimed row follows, " +
        "in an order that is not chronology.",
    );
    expect(activityTakeaway(1, 0, false)).toBe("1 chain action loaded for this account, newest first.");
    expect(activityTakeaway(4, 2, false)).toBe(
      "6 chain actions loaded for this account: 4 with a block time, newest " +
        "first; 2 untimed rows follow, in an order that is not chronology.",
    );
  });

  // The card and the Activity page name the same rows alike: chain actions, ordered by block time. The builder's
  // custody word never reaches a reader on any of the card's lines, the hover included.
  test("the card speaks Activity's one vocabulary: chain actions and a block time on every line, never the custody word", () => {
    expect(ACTIVITY_CARD_QUALIFIER).toBe("this account's chain actions · newest first, by block time");
    expect(UNTIMED_WHEN_TITLE).toBe("no block time yet — the block number stands in");
    const lines = [
      ACTIVITY_CARD_QUALIFIER,
      UNTIMED_WHEN_TITLE,
      activityEmptyText(false, null),
      activityTakeaway(3, 0, true),
      activityTakeaway(5, 1, false),
      activityTakeaway(0, 2, false),
    ];
    for (const line of lines) expect(line).not.toMatch(/custod/i);
    for (const line of [ACTIVITY_CARD_QUALIFIER, activityEmptyText(false, null), activityTakeaway(5, 1, false)]) expect(line).toContain("chain action");
  });

  test("no timed rows: NO newest-first claim survives anywhere in the sentence", () => {
    const line = activityTakeaway(0, 2, false);
    expect(line).toBe(
      "2 chain actions loaded for this account, none with a block time yet — " +
        "their order is not chronology.",
    );
    expect(line).not.toContain("newest first");
  });
});
