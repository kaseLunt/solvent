// The Feed's honest-amount law, pinned as executable assertions:
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
// The law includes SCALE-BY-PROVENANCE. This API serves `amount_decimals: null`
// on every row, and a raw integer reads as a different amount — a $22 borrow
// as `22064279`. So:
//   - dm_normalized_debt IS a fixed point at the engine's own value_decimals,
//     so given that number FROM THE WIRE the decimal point is placed exactly
//     (with thousands separators);
//   - aave_scaled's scale is the TOKEN's decimals, which the event does not
//     carry — so it stays RAW and gains the `raw units` tag. Substituting the
//     engine's base-currency decimals there would be a fabrication;
//   - every verbatim-rendered integer carries `rawUnits: true`, so the row
//     can tag it and no unscaled number ever renders bare.

import { expect, test } from "@playwright/test";
import {
  FEED_EXHAUSTED,
  FEED_LOADING,
  RAW_UNITS_TAG,
  feedAmount,
  feedNewest,
  feedTagTone,
  feedTakeaway,
  liquidationEstablished,
  renderBps,
} from "../../lib/feed-view";
import { plural } from "../../lib/prose";
import { EM_DASH } from "../../lib/format";
import type { FeedChainEvent } from "../../lib/feed-data";
import { FEED_LIQUIDATIONS, FEED_UNITS } from "../fixtures/feed";

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

// ---------------------------------------------------------------------------
// feedTakeaway: the headline over the loaded window, as the finding's core
// (emphasis) and its scope (rest), MODE-HONEST about what "newest" may claim:
// a block only where block numbers are the order, a time only over rows that
// carry one, and NO newest over an untimed or order-broken window. "loaded"
// never leaves the emphasis; nothing loaded is never a count. The instant is
// spoken through humanUtc (U+00A0 joins, hence `nb`); feedNewest is the one
// judge the headline and the header's Newest chip both read.
// ---------------------------------------------------------------------------

/** humanUtc joins its tokens with U+00A0: an instant inside an expectation is written through this. */
const nb = (text: string): string => text.replaceAll(" ", " ");

test.describe("feedTakeaway", () => {
  test("engine-scoped: the newest claim is a BLOCK, and hasMore blocks the totality reading", () => {
    const rows = [
      row({ block_number: 25635601, block_time: null, type: "liquidation" }),
      row({ block_number: 25635580, block_time: null, type: "supply" }),
    ];
    expect(feedTakeaway(rows, "engine-scoped", false)).toEqual({
      emphasis: "1 liquidation among the 2 chain actions loaded,",
      rest: "the newest at block 25,635,601; that is every action matching this filter.",
    });
    expect(feedTakeaway(rows, "engine-scoped", true)).toEqual({
      emphasis: "1 liquidation among the 2 chain actions loaded,",
      rest: "the newest at block 25,635,601; more exist beyond these.",
    });
    expect(feedNewest(rows, "engine-scoped")).toEqual({ kind: "block", block: 25635601 });
  });

  test("cross-engine: the newest claim is the head row's block TIME, never a block number — spoken from the wire's own UTC fields, the year by the envelope's served_at", () => {
    const rows = [
      row({ block_number: 25635601, block_time: "2026-07-29T09:57:11Z", type: "borrow" }),
      row({ block_number: 154796490, block_time: null, type: "repay" }),
    ];
    const line = feedTakeaway(rows, "cross-engine", false, { servedAt: "2026-07-29T10:00:05Z" });
    expect(line).toEqual({
      emphasis: "No liquidation among the 2 chain actions loaded,",
      rest: `the newest at ${nb("Jul 29, 09:57 UTC")}; that is every action matching this filter.`,
    });
    expect(line.rest).not.toContain("at block");
    // No served_at at hand, or one from another year: the year prints. Never the browser's clock.
    expect(feedTakeaway(rows, "cross-engine", false).rest).toContain(nb("Jul 29, 2026, 09:57 UTC"));
    expect(feedTakeaway(rows, "cross-engine", false, { servedAt: null }).rest).toContain(nb("Jul 29, 2026, 09:57 UTC"));
    expect(feedTakeaway(rows, "cross-engine", false, { servedAt: "2027-01-01T00:00:00Z" }).rest).toContain(nb("Jul 29, 2026, 09:57 UTC"));
    expect(feedNewest(rows, "cross-engine")).toEqual({ kind: "time", iso: "2026-07-29T09:57:11Z" });
  });

  test("an all-untimed window claims NO newest — its order is not chronology", () => {
    const rows = [
      row({ block_number: 154796400, block_time: null, type: "repay" }),
      row({ block_number: 25635580, block_time: null, type: "supply" }),
    ];
    const line = feedTakeaway(rows, "cross-engine", false);
    expect(line).toEqual({
      emphasis: "No liquidation among the 2 chain actions loaded,",
      rest: "none has a block time yet, so no newest is claimed; that is every action matching this filter.",
    });
    expect(line.rest).not.toContain("the newest at");
    expect(feedNewest(rows, "cross-engine")).toEqual({ kind: "untimed" });
  });

  test("a broken ordering: a timed row inside the tail WITHHOLDS the newest claim entirely", () => {
    const rows = [
      row({ block_number: 25635601, block_time: "2026-07-29T09:57:11Z", type: "borrow" }),
      row({ block_number: 154796490, block_time: null, type: "repay" }),
      row({ block_number: 25635500, block_time: "2026-07-29T09:55:02Z", type: "supply" }),
    ];
    const line = feedTakeaway(rows, "cross-engine", true);
    expect(line.rest).toBe("no newest is claimed: the service broke its own ordering (see the alert below); more exist beyond these.");
    expect(line.rest).not.toContain("the newest at");
    expect(feedNewest(rows, "cross-engine")).toEqual({ kind: "order-violated" });
  });

  test("nothing loaded is never a count: a cursor still open is a load in flight, a spent one the service's real answer — no zero in either", () => {
    expect(feedTakeaway([], "cross-engine", true)).toEqual({ emphasis: "Loading recorded chain actions…", rest: "" });
    expect(feedTakeaway([], "cross-engine", false)).toEqual({ emphasis: "No recorded chain action matches this filter.", rest: "" });
    expect(FEED_LOADING).toBe("Loading recorded chain actions…");
    expect(FEED_EXHAUSTED).toBe("No recorded chain action matches this filter.");
    for (const mode of ["cross-engine", "engine-scoped"] as const) {
      for (const hasMore of [true, false]) {
        const line = feedTakeaway([], mode, hasMore);
        expect(`${line.emphasis}${line.rest}`).not.toMatch(/\d/);
      }
      expect(feedNewest([], mode)).toBeNull();
    }
  });

  test("the type filter and the ledger: a filter that excludes liquidations claims no zero of them; the ledger counts liquidations; a ledger row that is not one falls back to the honest count", () => {
    const rows = [
      row({ block_number: 25635601, block_time: "2026-07-29T09:57:11Z", type: "borrow" }),
      row({ block_number: 25635580, block_time: "2026-07-29T09:55:02Z", type: "repay" }),
    ];
    const at = { servedAt: "2026-07-29T10:00:05Z" };
    expect(feedTakeaway(rows, "cross-engine", true, { ...at, types: ["borrow", "repay"] })).toEqual({
      emphasis: "2 chain actions loaded,",
      rest: `filtered to borrow and repay; the newest at ${nb("Jul 29, 09:57 UTC")}; more exist beyond these.`,
    });
    // The filter admits liquidations and none is loaded: a true zero, scoped by "loaded".
    expect(feedTakeaway(rows, "cross-engine", true, { ...at, types: ["borrow", "liquidation"] }).emphasis).toBe(
      "No liquidation among the 2 chain actions loaded,",
    );
    const liquidations = rows.map((event) => ({ ...event, type: "liquidation" as const }));
    expect(feedTakeaway(liquidations, "cross-engine", false, { ...at, ledger: true }).emphasis).toBe("2 liquidations loaded,");
    expect(feedTakeaway(rows, "cross-engine", false, { ...at, ledger: true }).emphasis).toBe("No liquidation among the 2 chain actions loaded,");
    // Grouped counts, real plurals.
    const many = Array.from({ length: 1200 }, (_, i) => row({ seq: i, type: i === 0 ? "liquidation" : "borrow", block_time: "2026-07-29T09:57:11Z" }));
    expect(feedTakeaway(many, "cross-engine", true, at).emphasis).toBe("1 liquidation among the 1,200 chain actions loaded,");
    expect(plural(1, "liquidation")).toBe("1 liquidation");
    expect(plural(0, "liquidation")).toBe("0 liquidations");
    expect(plural(18251, "chain action")).toBe("18,251 chain actions");
  });

  test("one row: the sentence names it — its type and where it sits — and never says 'these'", () => {
    const timed = [row({ block_number: 25635601, block_time: "2026-07-29T09:57:11Z", type: "repay" })];
    expect(feedTakeaway(timed, "cross-engine", true, { servedAt: "2026-07-29T10:00:05Z" })).toEqual({
      emphasis: "1 chain action loaded,",
      rest: `a repay, at ${nb("Jul 29, 09:57 UTC")}; more exist beyond this one.`,
    });
    expect(feedTakeaway(timed, "engine-scoped", false)).toEqual({
      emphasis: "1 chain action loaded,",
      rest: "a repay, at block 25,635,601; that is the only action matching this filter.",
    });
    const untimed = [row({ block_number: 154796490, block_time: null, type: "liquidation" })];
    expect(feedTakeaway(untimed, "cross-engine", false).rest).toBe("a liquidation, with no block time yet; that is the only action matching this filter.");
    expect(feedTakeaway(untimed, "cross-engine", false, { ledger: true })).toEqual({
      emphasis: "1 liquidation loaded,",
      rest: "with no block time yet; that is the only action matching this filter.",
    });
  });

  test("no sentence names the wire's internals or a dollar: no cursor, no custody word, no '(s)', no '$'", () => {
    const rows = [
      row({ block_number: 25635601, block_time: "2026-07-29T09:57:11Z", type: "liquidation" }),
      row({ block_number: 154796490, block_time: null, type: "repay" }),
    ];
    for (const mode of ["cross-engine", "engine-scoped"] as const) {
      for (const hasMore of [true, false]) {
        const line = feedTakeaway(rows, mode, hasMore);
        const said = `${line.emphasis} ${line.rest}`;
        expect(said).not.toMatch(/cursor|custod|\(s\)|\$| · /);
        expect(line.emphasis.endsWith(",")).toBe(true);
        expect(line.emphasis).toContain("loaded");
        expect(line.rest.endsWith(".")).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// liquidationEstablished: the definition of an established extract. Only a
// fully-established extract could ever start folded; ANY em-dash field may not
// hide behind a fold or a hover. (The Activity table prints every extract
// visibly, so no page folds one today; the definition stays pinned.)
// ---------------------------------------------------------------------------

test.describe("W-3L — liquidationEstablished", () => {
  const dm = FEED_LIQUIDATIONS.events[1]?.liquidation;
  if (dm === undefined || dm === null) {
    throw new Error("fixture invariant: the DM liquidation row expected");
  }
  const leg = dm.seized[0];
  if (leg === undefined) throw new Error("fixture invariant: a seizure leg expected");

  test("the committed DM extract is UNESTABLISHED — its realized bonus is null", () => {
    expect(dm.realized_bonus_bps).toBeNull();
    expect(liquidationEstablished(dm)).toBe(false);
  });

  test("established ONLY when every field is carried; each absence revokes the license", () => {
    const established = { ...dm, realized_bonus_bps: "500" };
    expect(liquidationEstablished(established)).toBe(true);
    expect(liquidationEstablished({ ...established, debt_repaid: null })).toBe(false);
    expect(liquidationEstablished({ ...established, seized: [] })).toBe(false);
    // The generated type declares the leg amount non-null; the runtime
    // guard exists because the wire's own bytes are the authority.
    const nulledLeg = { ...leg, amount: null } as unknown as typeof leg;
    expect(liquidationEstablished({ ...established, seized: [nulledLeg] })).toBe(false);
    expect(liquidationEstablished({ ...established, configured_bonus_bps: null })).toBe(false);
  });
});
