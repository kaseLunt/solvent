// Feed presentation decisions (W5), pure and unit-tested.
//
// The honest-amount law (AMENDMENT 1 item B): an event's `amount` is the
// engine's own ACCOUNTING unit, named by its unit tag — NOT a display token
// amount and NEVER convertible to a USD figure here (conversion needs the
// engine's live/event-time index, which this surface does not hold). So:
//
//   - `aave_scaled` / `dm_normalized_debt` render the exact custodied value
//     WITH the unit named beside it, plus what converting would take;
//   - `opaque` (and any tag outside the known closed set) renders the RAW
//     integer verbatim — even `amount_decimals` is an interpretation the
//     unit does not license;
//   - a null amount is "record-only" — a different statement from zero;
//   - an ABSENT tag (a wire outside the 1.2.0 contract, which made
//     `amount_unit` required) is WIRE DRIFT: the raw integer renders
//     verbatim with the drift named — never formatted through a scale the
//     wire did not license.
//
// Nothing in this module produces a "$" — that is asserted in
// tests/unit/feed-view.spec.ts, not just promised here.

import { EM_DASH, formatBlock, renderNullableDecimal } from "./format";
import { groupDecimalString } from "./book-format";
import {
  isKnownAmountUnit,
  splitUntimedTail,
  type EventDisplayType,
  type FeedChainEvent,
  type FeedOrderMode,
} from "./feed-data";

export type FeedAmount =
  | { kind: "record-only" }
  | {
      kind: "amount";
      /** The exact value, formatted only as far as the unit licenses. */
      display: string;
      /** Unit chip text beside the value; null = the plain asset-units path. */
      unitChip: string | null;
      /** Hover explanation of the unit (what converting would take). */
      unitTitle: string | null;
      /** Asset symbol context (rendered dim, after the chip), when carried. */
      symbol: string | null;
      /**
       * Wave R1 item 4: TRUE when `display` is the wire's raw integer because
       * no scale is licensed for it. The row renders a `raw units` tag, so an
       * unscaled integer can never be mistaken for a placed decimal.
       */
      rawUnits: boolean;
    };

/**
 * The scale the ENGINE's own value unit carries, when the caller knows it.
 *
 * WAVE R1 ITEM 4 — THE DEFECT: the Feed rendered `amount` through
 * `amount_decimals`, which this API serves as NULL on every row (it says so
 * in its own notes: the value "is not a display-ready token amount, which is
 * why `amount_decimals` is null"). The result was a wall of raw integers: a
 * $22 borrow rendered as `22064279`, indistinguishable from $22 million.
 *
 * The fix is scale-by-provenance, never scale-by-guess:
 *
 *   dm_normalized_debt — the Debt Manager's normalized-debt unit IS a
 *     6-decimal fixed point (the USD-6 view is value × index ÷ 1e18, so the
 *     value itself carries the engine's `value_decimals`). Given that number
 *     FROM THE WIRE (`/v1/book`'s aggregate, or the SSE snapshot's), the
 *     decimal point is placed exactly. Withheld → raw, tagged.
 *
 *   aave_scaled — ray-scaled aToken/variableDebtToken units, whose scale is
 *     the TOKEN's decimals, not the engine's `value_decimals` (8, the pool's
 *     base currency). The event payload carries no per-leg decimals, so
 *     nothing licenses a scale: raw integer, `raw units` tag. Using the
 *     engine's 8 here would be exactly the fabrication the ruling forbids.
 *
 * `amount_decimals`, when the wire DOES carry it, still wins — it is the
 * row's own statement about itself.
 */
export interface FeedAmountScale {
  /** The active engine's `value_decimals` from the wire, or null when unknown. */
  engineValueDecimals?: number | null;
}

/** The tag rendered beside a verbatim integer — never a silent raw number. */
export const RAW_UNITS_TAG = "raw units";

/** Exact placement + thousands separators, via the shared money formatter. */
function scaled(amount: string, decimals: number): string {
  return groupDecimalString(renderNullableDecimal(amount, { decimals }));
}

export function feedAmount(event: FeedChainEvent, scale: FeedAmountScale = {}): FeedAmount {
  if (event.amount === null) return { kind: "record-only" };
  const symbol = event.symbol ?? null;
  // The generated type makes amount_unit required; the runtime guard stays
  // because the wire's own bytes are the authority, not our types.
  const unit = event.amount_unit as string | undefined;

  if (unit === undefined) {
    // A wire outside the 1.2.0 contract (the field is required there). The
    // raw integer renders verbatim with the drift NAMED — formatting it
    // through amount_decimals would assert a scale nobody licensed.
    return {
      kind: "amount",
      display: event.amount,
      unitChip: "no unit tag",
      unitTitle:
        "the wire carried no amount_unit, required since contract 1.2.0. Rendered verbatim as wire drift, never formatted through an unlicensed scale",
      symbol,
      rawUnits: true,
    };
  }

  if (!isKnownAmountUnit(unit)) {
    // A tag outside the known closed set: preserved VERBATIM, dim, raw —
    // never coerced into a unit we would then be lying about.
    return {
      kind: "amount",
      display: event.amount,
      unitChip: unit,
      unitTitle:
        "unit tag outside the known closed set (dm_normalized_debt / aave_scaled / none / opaque), rendered verbatim, never interpreted",
      symbol,
      rawUnits: true,
    };
  }

  switch (unit) {
    case "none":
      // `none` promises a null amount; a non-null amount under it is wire
      // drift — shown raw with the tag verbatim rather than guessed at.
      return {
        kind: "amount",
        display: event.amount,
        unitChip: "none",
        unitTitle:
          "the wire tagged this row record-only (unit `none`) yet carried an amount, so it renders raw, never interpreted",
        symbol,
        rawUnits: true,
      };
    case "opaque":
      return {
        kind: "amount",
        display: event.amount,
        unitChip: "opaque units",
        unitTitle:
          "the delta's unit could not be established from custody, so the raw integer renders verbatim; even decimals would be an interpretation",
        symbol,
        rawUnits: true,
      };
    case "aave_scaled": {
      // The scale of a ray-scaled aToken balance is the TOKEN's decimals.
      // The event carries them or it does not; the ENGINE's value_decimals
      // (the pool's base currency, 8) is a different unit entirely and is
      // deliberately NOT substituted here.
      const decimals = event.amount_decimals;
      return {
        kind: "amount",
        display: decimals === null ? event.amount : scaled(event.amount, decimals),
        unitChip: "aave-scaled",
        unitTitle:
          decimals === null
            ? "ray-scaled aToken/variableDebtToken units, and this row carries NO decimals for the leg, so the raw integer renders verbatim rather than through the engine's base-currency scale, which is a different unit. The nominal token amount is rayMul(scaled, live index); never a USD figure"
            : "ray-scaled aToken/variableDebtToken units. The nominal token amount is rayMul(scaled, live index); not converted here, never a USD figure",
        symbol,
        rawUnits: decimals === null,
      };
    }
    case "dm_normalized_debt": {
      // Normalized debt IS a fixed point at the engine's own value_decimals
      // (the USD-6 view is value × index ÷ 1e18). The row's own decimals win
      // when present; otherwise the engine's, FROM THE WIRE; otherwise raw.
      const decimals = event.amount_decimals ?? scale.engineValueDecimals ?? null;
      return {
        kind: "amount",
        display: decimals === null ? event.amount : scaled(event.amount, decimals),
        unitChip: "normalized debt",
        unitTitle:
          decimals === null
            ? "Debt Manager normalized debt units, and this deployment's value_decimals are not known to this page yet, so the raw integer renders verbatim rather than through a guessed scale. The USD view is value × interest index ÷ 1e18 at the event's index; never a USD figure"
            : "Debt Manager normalized debt units at the engine's own value_decimals. The USD view is value × interest index ÷ 1e18 at the event's index; not converted here, never a USD figure",
        symbol,
        rawUnits: decimals === null,
      };
    }
  }
}

/**
 * Severity per the canon (color + form, not color alone): a liquidation and
 * the pool's own bad-debt realization are crit; everything else is the plain
 * informational tag. The class string itself always renders VERBATIM.
 */
export function feedTagTone(type: EventDisplayType): "crit" | "info" {
  return type === "liquidation" || type === "deficit_created" ? "crit" : "info";
}

/** Stable row identity: the event's own chain coordinates. */
export function feedRowKey(event: FeedChainEvent): string {
  return `${String(event.chain_id)}·${event.tx_hash}·${String(event.log_index)}·${String(event.seq)}`;
}

/** Render a nullable bps decimal, with the never-estimated dash for null. */
export function renderBps(value: string | null): string {
  return value === null ? EM_DASH : `${value} bps`;
}

/**
 * The Feed's head takeaway (W-3L, inventory 397): the loaded WINDOW's own
 * numbers — row count, liquidation count, and the newest row's coordinate —
 * in one computed sentence. The newest claim is MODE-HONEST (the r74 law):
 * engine-scoped pages are height-ordered, so the newest is a block;
 * cross-engine pages are time-ordered, so the newest is a custodied header
 * time — and a window with no custodied time, or one whose ordering the
 * wire itself violated, makes NO newest claim rather than licensing a
 * false reading. `hasMore` blocks the totality reading: a window is a
 * floor of the filtered feed, never its total, while a cursor remains.
 */
export function feedTakeaway(
  rows: readonly FeedChainEvent[],
  mode: FeedOrderMode,
  hasMore: boolean,
): string {
  const newest = rows[0];
  if (newest === undefined) {
    return "0 chain actions loaded in this window — the list below states the reason.";
  }
  const liquidations = rows.filter((event) => event.type === "liquidation").length;
  const counts = `${String(rows.length)} chain action(s) loaded, ${String(liquidations)} liquidation(s)`;
  const more = hasMore ? " · more exist behind the cursor" : "";
  if (mode === "engine-scoped") {
    return `${counts} · newest at block ${formatBlock(newest.block_number)}${more}.`;
  }
  const { timed, orderViolated } = splitUntimedTail(rows);
  if (orderViolated) {
    return (
      `${counts} · the wire violated its own ordering law (see the alert below), ` +
      `so no newest is claimed${more}.`
    );
  }
  const newestTimed = timed[0];
  if (newestTimed === undefined) {
    return `${counts} · none carry custodied header time, so no newest is claimed${more}.`;
  }
  return `${counts} · newest custodied ${newestTimed.block_time ?? EM_DASH}${more}.`;
}

/**
 * TRUE only when EVERY field of a liquidation extract is established: a
 * non-null repaid amount, at least one seizure leg with every amount
 * carried, and both bonus figures. The W-3L hazard fence (inventory 430):
 * an extract carrying ANY em dash may not hide behind a closed fold, so
 * the all-actions view opens an unestablished extract by default — the
 * same law the Inspector's LiquidationExtract already enforces.
 */
export function liquidationEstablished(
  detail: NonNullable<FeedChainEvent["liquidation"]>,
): boolean {
  return (
    detail.debt_repaid !== null &&
    detail.seized.length > 0 &&
    detail.seized.every((leg) => leg.amount !== null) &&
    detail.realized_bonus_bps !== null &&
    detail.configured_bonus_bps !== null
  );
}
