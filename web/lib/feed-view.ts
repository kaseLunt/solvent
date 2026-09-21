// Feed presentation decisions, pure and unit-tested.
//
// The honest-amount law: an event's `amount` is the
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
import { humanUtc } from "./human-utc";
import { joinAnd, plural } from "./prose";

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
       * TRUE when `display` is the wire's raw integer because no scale is
       * licensed for it. The row renders a `raw units` tag, so an unscaled
       * integer can never be mistaken for a placed decimal.
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
 *     engine's 8 here would be exactly the fabrication the unit law forbids.
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
 * What the loaded rows license as "the newest", decided once: the headline's claim and the header's `Newest` chip
 * both read this, so neither can state a newest the other withholds. The claim is MODE-HONEST: an engine-scoped
 * walk is height-ordered, so its newest is a block; a cross-engine walk is time-ordered, so its newest is a block
 * time — and a window with no block time, or one whose ordering the service itself broke, claims NO newest rather
 * than licensing a false reading. Null when nothing is loaded.
 */
export type FeedNewest =
  | { readonly kind: "time"; readonly iso: string }
  | { readonly kind: "block"; readonly block: number }
  | { readonly kind: "untimed" }
  | { readonly kind: "order-violated" };

export function feedNewest(rows: readonly FeedChainEvent[], mode: FeedOrderMode): FeedNewest | null {
  const head = rows[0];
  if (head === undefined) return null;
  if (mode === "engine-scoped") return { kind: "block", block: head.block_number };
  const { timed, orderViolated } = splitUntimedTail(rows);
  if (orderViolated) return { kind: "order-violated" };
  const iso = timed[0]?.block_time ?? null;
  return iso === null ? { kind: "untimed" } : { kind: "time", iso };
}

/** What the walk asked for, as far as the sentence needs it. Every field is optional: an absent one claims nothing. */
export interface FeedTakeawayScope {
  /** The type filter; empty or absent = every type. */
  readonly types?: readonly EventDisplayType[];
  /** The liquidations ledger: the walk pins the type, so the count is of liquidations. */
  readonly ledger?: boolean;
  /** The envelope's own `served_at`, the reference year for the newest instant. Absent, the year prints. */
  readonly servedAt?: string | null;
}

/** The headline as its two parts: the finding's core, then its scope. Joined with one space they are the H1. */
export interface FeedTakeaway {
  readonly emphasis: string;
  readonly rest: string;
}

/** Before the first page answers, nothing is counted. */
export const FEED_LOADING = "Loading recorded chain actions…";

/** No rows and no cursor: the service's real answer for the filter. */
export const FEED_EXHAUSTED = "No recorded chain action matches this filter.";

/**
 * The Activity headline over the loaded WINDOW's own numbers — the liquidation count among the loaded rows, then
 * the newest row's coordinate — as the finding's core and its scope. "loaded" never leaves the emphasis: a window
 * is a floor of the filtered record, never its total, while a cursor remains, and `hasMore` says which. Nothing
 * loaded is never a count: it is a load in flight or the service's real empty answer. The newest claim is
 * `feedNewest`'s. The instant is spoken through `humanUtc` from the wire's own UTC fields with the envelope's
 * `served_at` as the reference year — never the browser's clock or zone; the exact instant rides the `Newest` chip.
 */
export function feedTakeaway(
  rows: readonly FeedChainEvent[],
  mode: FeedOrderMode,
  hasMore: boolean,
  scope: FeedTakeawayScope = {},
): FeedTakeaway {
  const newest = feedNewest(rows, mode);
  if (newest === null) {
    // Nothing loaded is never counted: a cursor still open is a load in flight, a spent one the service's real answer.
    return { emphasis: hasMore ? FEED_LOADING : FEED_EXHAUSTED, rest: "" };
  }
  const n = rows.length;
  const liquidations = rows.filter((event) => event.type === "liquidation").length;
  const types = scope.types ?? [];
  const ledger = scope.ledger === true && liquidations === n;
  const reference = scope.servedAt ?? undefined;

  if (n === 1) {
    const only = rows[0];
    const where =
      newest.kind === "time"
        ? `at ${humanUtc(newest.iso, reference)}`
        : newest.kind === "block"
          ? `at block ${formatBlock(newest.block)}`
          : "with no block time yet";
    const more = hasMore ? "more exist beyond this one." : "that is the only action matching this filter.";
    return ledger
      ? { emphasis: "1 liquidation loaded,", rest: `${where}; ${more}` }
      : { emphasis: "1 chain action loaded,", rest: `a ${only?.type ?? "chain action"}, ${where}; ${more}` };
  }

  const loaded = plural(n, "chain action");
  let emphasis: string;
  let filtered = "";
  if (ledger) {
    emphasis = `${plural(n, "liquidation")} loaded,`;
  } else if (liquidations > 0) {
    emphasis = `${plural(liquidations, "liquidation")} among the ${loaded} loaded,`;
  } else if (types.length === 0 || types.includes("liquidation")) {
    // A true zero, scoped by "loaded": the filter admits liquidations and none is among these rows.
    emphasis = `No liquidation among the ${loaded} loaded,`;
  } else {
    emphasis = `${loaded} loaded,`;
    filtered = `filtered to ${joinAnd(types)}; `;
  }

  const claim =
    newest.kind === "time"
      ? `the newest at ${humanUtc(newest.iso, reference)}`
      : newest.kind === "block"
        ? `the newest at block ${formatBlock(newest.block)}`
        : newest.kind === "untimed"
          ? "none has a block time yet, so no newest is claimed"
          : "no newest is claimed: the service broke its own ordering (see the alert below)";
  const more = hasMore ? "more exist beyond these." : "that is every action matching this filter.";
  return { emphasis, rest: `${filtered}${claim}; ${more}` };
}

/**
 * TRUE only when EVERY field of a liquidation extract is established: a
 * non-null repaid amount, at least one seizure leg with every amount
 * carried, and both bonus figures. The law it names: an extract carrying ANY
 * em dash may never hide behind a fold or a hover. The Activity table keeps
 * that law without asking — it prints every extract visibly, established or
 * not — so no page reads this today; it stays as the definition of
 * "established", pinned, for the first surface that folds an extract again.
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
