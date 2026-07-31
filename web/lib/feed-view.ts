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

import { EM_DASH, renderNullableDecimal } from "./format";
import { isKnownAmountUnit, type EventDisplayType, type FeedChainEvent } from "./feed-data";

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
    };

export function feedAmount(event: FeedChainEvent): FeedAmount {
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
        "the wire carried no amount_unit — required since contract 1.2.0. Rendered verbatim as wire drift, never formatted through an unlicensed scale",
      symbol,
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
        "unit tag outside the known closed set (dm_normalized_debt / aave_scaled / none / opaque) — rendered verbatim, never interpreted",
      symbol,
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
          "the wire tagged this row record-only (unit `none`) yet carried an amount — rendered raw, never interpreted",
        symbol,
      };
    case "opaque":
      return {
        kind: "amount",
        display: event.amount,
        unitChip: "opaque units",
        unitTitle:
          "the delta's unit could not be established from custody — the raw integer renders verbatim; even decimals would be an interpretation",
        symbol,
      };
    case "aave_scaled":
      return {
        kind: "amount",
        display: renderNullableDecimal(event.amount, {
          decimals: event.amount_decimals ?? undefined,
        }),
        unitChip: "aave-scaled",
        unitTitle:
          "ray-scaled aToken/variableDebtToken units — the nominal token amount is rayMul(scaled, live index); not converted here, never a USD figure",
        symbol,
      };
    case "dm_normalized_debt":
      return {
        kind: "amount",
        display: renderNullableDecimal(event.amount, {
          decimals: event.amount_decimals ?? undefined,
        }),
        unitChip: "normalized debt",
        unitTitle:
          "Debt Manager normalized debt units — the USD-6 view is value × interest index ÷ 1e18 at the event's index; not converted here, never a USD figure",
        symbol,
      };
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
