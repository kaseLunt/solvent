// Feed presentation decisions, pure and unit-tested.
//
// The honest-amount law: an event's `amount` is the
// engine's own ACCOUNTING unit, named by its unit tag — NOT a display token
// amount and NEVER convertible to a USD figure here (conversion needs the
// engine's live/event-time index, which this surface does not hold). So:
//
//   - `aave_scaled` / `dm_normalized_debt` render the exact custodied value
//     WITH the unit named beside it, plus what converting would take;
//   - `opaque` (and any tag outside the known closed set) prints the RAW
//     integer unscaled, grouped for reading — even `amount_decimals` is an
//     interpretation the unit does not license;
//   - a null amount is "record-only" — a different statement from zero;
//   - an amount the wire's Decimal pattern refuses is "unreadable": its bytes
//     are never printed, scaled or named in a unit;
//   - an ABSENT tag (a wire outside the 1.2.0 contract, which made
//     `amount_unit` required) is WIRE DRIFT: the raw integer prints
//     unscaled with the drift named — never placed through a scale the
//     wire did not license.
//
// Nothing in this module produces a "$" — that is asserted in
// tests/unit/feed-view.spec.ts, not just promised here.

import { EM_DASH, formatBlock, renderNullableDecimal, truncateAddress } from "./format";
import { groupDecimalString } from "./book-format";
import {
  EVENT_DISPLAY_TYPES,
  isKnownAmountUnit,
  splitUntimedTail,
  type EventDisplayType,
  type FeedChainEvent,
  type FeedOrderMode,
} from "./feed-data";
import { humanUtc } from "./human-utc";
import { CASH } from "./inspector-position";
import { joinAnd, plural } from "./prose";
import { isWireDecimal, isWireScale } from "./wireGuard";

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
 * Why a scale at all: this API serves `amount_decimals` as NULL on every row
 * (it says so in its own notes: the value "is not a display-ready token
 * amount, which is why `amount_decimals` is null"). Rendered through that
 * field alone, the Feed would be a wall of raw integers: a $22 borrow as
 * `22064279`, indistinguishable from $22 million.
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
 * row's own statement about itself. Every scale passes the scale guard first:
 * one it refuses licenses nothing.
 */
export interface FeedAmountScale {
  /** The active engine's `value_decimals` from the wire, or null when unknown. */
  engineValueDecimals?: number | null;
}

/** The tag rendered beside an unscaled integer — never a silent raw number. */
export const RAW_UNITS_TAG = "raw units";

/**
 * A null amount's word, printed where the unit is named — never in the figure's place, which holds a dash: the row
 * is a record with no amount, a different statement from zero. Both surfaces that list chain actions print it.
 */
export const RECORD_ONLY_WORD = "record-only";

/** The record-only word's title: what the dash beside it means. */
export const RECORD_ONLY_TITLE = "record only: this event carries no amount";

/** The word a figure the wire's Decimal pattern refuses prints as: its bytes are never a figure. */
const UNREADABLE = "unreadable";

/**
 * What every unscaled arm's hover says the figure is. It must stay true of `unscaled`: grouping is for reading and
 * places nothing, so the hover never calls the figure verbatim or unformatted.
 */
const UNSCALED_PRINT = "the raw integer prints unscaled (grouped for reading, every digit the wire's)";

/** Exact placement + thousands separators, via the shared money formatter. Call ONLY on a guarded value and scale. */
function scaled(amount: string, decimals: number): string {
  return groupDecimalString(renderNullableDecimal(amount, { decimals }));
}

/**
 * A guarded wire integer no scale placed, grouped for reading and nothing more: "180,771,428". Every digit is the
 * wire's, in its place — grouping is not scaling — and a sign is the display minus.
 */
function unscaled(amount: string): string {
  return groupDecimalString(amount);
}

export function feedAmount(event: FeedChainEvent, scale: FeedAmountScale = {}): FeedAmount {
  if (event.amount === null) return { kind: "record-only" };
  if (!isWireDecimal(event.amount)) {
    // No unit is named beside it: a unit word must be true of a figure, and there is none.
    return {
      kind: "amount",
      display: UNREADABLE,
      unitChip: null,
      unitTitle: "the wire's amount is not a decimal integer, so it is not printed as a figure",
      symbol: null,
      rawUnits: false,
    };
  }
  const symbol = event.symbol ?? null;
  // The generated type makes amount_unit required; the runtime guard stays
  // because the wire's own bytes are the authority, not our types.
  const unit = event.amount_unit as string | undefined;

  if (unit === undefined) {
    // A wire outside the 1.2.0 contract (the field is required there). The
    // raw integer prints unscaled with the drift NAMED — placing it
    // through amount_decimals would assert a scale nobody licensed.
    return {
      kind: "amount",
      display: unscaled(event.amount),
      unitChip: "no unit tag",
      unitTitle: `the wire carried no amount_unit, required since contract 1.2.0: this is wire drift, so ${UNSCALED_PRINT}, never placed through an unlicensed scale`,
      symbol,
      rawUnits: true,
    };
  }

  if (!isKnownAmountUnit(unit)) {
    // A tag outside the known closed set: preserved VERBATIM, dim, raw —
    // never coerced into a unit we would then be lying about.
    return {
      kind: "amount",
      display: unscaled(event.amount),
      unitChip: unit,
      unitTitle: `unit tag outside the known closed set (dm_normalized_debt / aave_scaled / none / opaque): the tag shows as the wire sent it and ${UNSCALED_PRINT}, never interpreted`,
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
        display: unscaled(event.amount),
        unitChip: "none",
        unitTitle: `the wire tagged this row record-only (unit \`none\`) yet carried an amount, so ${UNSCALED_PRINT}, never interpreted`,
        symbol,
        rawUnits: true,
      };
    case "opaque":
      return {
        kind: "amount",
        display: unscaled(event.amount),
        unitChip: "opaque units",
        unitTitle: `the delta's unit could not be established from custody, so ${UNSCALED_PRINT}; even decimals would be an interpretation`,
        symbol,
        rawUnits: true,
      };
    case "aave_scaled": {
      // The scale of a ray-scaled aToken balance is the TOKEN's decimals.
      // The event carries them or it does not; the ENGINE's value_decimals
      // (the pool's base currency, 8) is a different unit entirely and is
      // deliberately NOT substituted here.
      const decimals = isWireScale(event.amount_decimals) ? event.amount_decimals : null;
      return {
        kind: "amount",
        display: decimals === null ? unscaled(event.amount) : scaled(event.amount, decimals),
        unitChip: "aave-scaled",
        unitTitle:
          decimals === null
            ? `ray-scaled aToken/variableDebtToken units, and this row carries no readable decimals for the leg, so ${UNSCALED_PRINT} rather than through the engine's base-currency scale, which is a different unit. The nominal token amount is rayMul(scaled, live index); never a USD figure`
            : "ray-scaled aToken/variableDebtToken units. The nominal token amount is rayMul(scaled, live index); not converted here, never a USD figure",
        symbol,
        rawUnits: decimals === null,
      };
    }
    case "dm_normalized_debt": {
      // Normalized debt IS a fixed point at the engine's own value_decimals
      // (the USD-6 view is value × index ÷ 1e18). The row's own decimals win
      // when readable; otherwise the engine's, FROM THE WIRE; otherwise raw.
      const own = isWireScale(event.amount_decimals) ? event.amount_decimals : null;
      const decimals = own ?? (isWireScale(scale.engineValueDecimals) ? scale.engineValueDecimals : null);
      return {
        kind: "amount",
        display: decimals === null ? unscaled(event.amount) : scaled(event.amount, decimals),
        unitChip: "normalized debt",
        unitTitle:
          decimals === null
            ? `Debt Manager normalized debt units, and this deployment's value_decimals are not known to this page yet, so ${UNSCALED_PRINT} rather than through a guessed scale. The USD view is value × interest index ÷ 1e18 at the event's index; never a USD figure`
            : "Debt Manager normalized debt units at the engine's own value_decimals. The USD view is value × interest index ÷ 1e18 at the event's index; not converted here, never a USD figure",
        symbol,
        rawUnits: decimals === null,
      };
    }
  }
}

/**
 * The three display types whose wire word is an identifier, in the page's words: the contract's own gloss — the Aave
 * usage-as-collateral toggles and the pool's own bad-debt realization event. Every other type is already a word.
 */
export const TYPE_WORDS: Readonly<Partial<Record<EventDisplayType, string>>> = {
  collateral_enabled: "collateral enabled",
  collateral_disabled: "collateral disabled",
  deficit_created: "bad debt realized",
};

/**
 * A display type as a sentence says it, lower case: "filtered to bad debt realized and borrow". A word outside the
 * vocabulary prints as the wire sent it, never guessed at. The lookup is the table's OWN keys: a wire word such as
 * `__proto__` or `toString` would otherwise read Object.prototype, which is not a word and cannot render.
 */
export function typeWord(type: string): string {
  return Object.hasOwn(TYPE_WORDS, type) ? ((TYPE_WORDS as Readonly<Record<string, string>>)[type] ?? type) : type;
}

/**
 * A display type as a label prints it — a table cell, a toggle, a tile — in sentence case: "Borrow", "Bad debt
 * realized". A word outside the contract's vocabulary prints exactly as the wire sent it: it is not a word this page
 * knows, so it is not dressed as one.
 */
export function typeLabel(type: string): string {
  if (!(EVENT_DISPLAY_TYPES as readonly string[]).includes(type)) return type;
  const words = typeWord(type);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * One row's type as a sentence names it: a type that is a noun takes its article ("a repay"); a type the page says as
 * a phrase ("bad debt realized") is a statement and takes none.
 */
function typeInSentence(type: string): string {
  const words = typeWord(type);
  return words === type ? `a ${type}` : words;
}

/**
 * A historical chain action is a record, and a record is ink. A liquidation and the pool's own bad-debt realization
 * are the KEY records — set apart by weight, never by a verdict's colour: what happened on the chain is not a health
 * judgement about the book now. Everything else is the plain record. The class string itself always renders VERBATIM.
 */
export function feedTagTone(type: EventDisplayType): "key" | "info" {
  return type === "liquidation" || type === "deficit_created" ? "key" : "info";
}

/** Stable row identity: the event's own chain coordinates. */
export function feedRowKey(event: FeedChainEvent): string {
  return `${String(event.chain_id)}·${event.tx_hash}·${String(event.log_index)}·${String(event.seq)}`;
}

/**
 * Render a nullable bps decimal, with the never-estimated dash for null. A value outside the Decimal pattern is the
 * unreadable word with no "bps" beside it: its bytes are not a figure.
 */
export function renderBps(value: string | null): string {
  if (value === null) return EM_DASH;
  return isWireDecimal(value) ? `${value} bps` : UNREADABLE;
}

/** A liquidation's typed extract, as the wire carries it on both surfaces that print one. */
type LiquidationExtract = NonNullable<FeedChainEvent["liquidation"]>;

/** The words a liquidation's extract is said in, on the Activity table and the Inspector's card alike. */
export const LIQUIDATION_WORDS = {
  liquidator: "Liquidator",
  repaid: "debt repaid",
  seized: "seized",
  bonusRealized: "bonus realized",
  bonusConfigured: "configured",
} as const;

/** A payload figure and what it is counted in, decided once. */
export interface LiquidationFigure {
  /** Exact decimals, grouped and never truncated; the wire's digits when no scale is licensed; the unreadable word; or a dash. */
  readonly figure: string;
  /**
   * What the figure is counted in. Beside the wire's digits it is the raw-units tag and never a currency or token —
   * the digits are not that many dollars or tokens. Null beside a dash or the unreadable word, which are not figures.
   */
  readonly unit: string | null;
}

/**
 * One payload figure through the wire guards, in order: a null value is not established, a value outside the
 * Decimal pattern is unreadable, a scale the guard refuses licenses no placement — then the exact decimals.
 */
function payloadFigure(value: string | null, decimals: number | null, unit: string): LiquidationFigure {
  if (value === null) return { figure: EM_DASH, unit: null };
  if (!isWireDecimal(value)) return { figure: UNREADABLE, unit: null };
  if (!isWireScale(decimals)) return { figure: unscaled(value), unit: RAW_UNITS_TAG };
  return { figure: scaled(value, decimals), unit };
}

/**
 * A liquidation's repaid figure, as both surfaces print it. The API serves the Debt Manager's figure as its own
 * USD-6 quantity at the engine's value_decimals, and the legacy market's as the debt asset's own token units at that
 * token's decimals; the row's asset is the debt asset on both, so the legacy row's symbol names it (the debt asset
 * shortened when no symbol was carried, a dash when neither was).
 */
export function liquidationRepaid(
  event: Pick<FeedChainEvent, "engine" | "symbol">,
  detail: Pick<LiquidationExtract, "debt_repaid" | "debt_decimals" | "debt_asset">,
): LiquidationFigure {
  const unit =
    event.engine === CASH ? "USD" : (event.symbol ?? (detail.debt_asset === null ? EM_DASH : truncateAddress(detail.debt_asset)));
  return payloadFigure(detail.debt_repaid, detail.debt_decimals, unit);
}

/**
 * Every seizure leg in its own token's exact decimals, comma-joined, each named by its symbol (its asset shortened
 * when no symbol was carried). A leg that is not a placed figure names its asset apart from the figure, so the digits
 * are never read as that many tokens; none carried is stated, never a silent omission.
 */
export function liquidationSeized(detail: Pick<LiquidationExtract, "seized">): string {
  if (detail.seized.length === 0) return `${EM_DASH} (no seizure legs carried)`;
  return detail.seized
    .map((leg) => {
      const name = leg.symbol ?? truncateAddress(leg.asset);
      const { figure, unit } = payloadFigure(leg.amount, leg.decimals, name);
      if (unit === null) return `${figure} (${name})`;
      return unit === RAW_UNITS_TAG ? `${figure} ${unit} (${name})` : `${figure} ${unit}`;
    })
    .join(", ");
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
 * The Activity headline over the loaded WINDOW's own numbers, as the finding's core and its scope. Over many rows it
 * is the finding alone — the liquidations and bad-debt realizations among the loaded rows — because the header's
 * `Newest` and `Loaded` chips carry the newest instant and whether more remain; a window that licenses no newest
 * (`feedNewest`: untimed, or an order the service broke) still says so, since no chip can. One row, and the ledger,
 * name where they sit and whether more remain. "loaded" never leaves the emphasis: a window is a floor of the
 * filtered record, never its total. Nothing loaded is never a count: it is a load in flight or the service's real
 * empty answer. An instant is spoken through `humanUtc` from the wire's own UTC fields with the envelope's
 * `served_at` as the reference year — never the browser's clock or zone. A type is said in the page's words
 * (`typeLabel`), as the controls beside the headline say it — never the wire's id.
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
      : { emphasis: "1 chain action loaded,", rest: `${only === undefined ? "a chain action" : typeInSentence(only.type)}, ${where}; ${more}` };
  }

  const withheld =
    newest.kind === "untimed"
      ? "none has a block time yet, so no newest is claimed"
      : newest.kind === "order-violated"
        ? "no newest is claimed: the service broke its own ordering (see the alert below)"
        : null;

  if (ledger) {
    const claim =
      newest.kind === "time"
        ? `the newest at ${humanUtc(newest.iso, reference)}`
        : newest.kind === "block"
          ? `the newest at block ${formatBlock(newest.block)}`
          : (withheld ?? "");
    const more = hasMore ? "more exist beyond these." : "that is every action matching this filter.";
    return { emphasis: `${plural(n, "liquidation")} loaded,`, rest: `${claim}; ${more}` };
  }

  const loaded = plural(n, "chain action");
  const deficits = rows.filter((event) => event.type === "deficit_created").length;
  let lead: string;
  let filtered: string | null = null;
  if (liquidations > 0 && deficits > 0) {
    // Its own noun, so a realization is never read as one of the liquidations.
    lead = `${plural(liquidations, "liquidation")} and ${plural(deficits, "bad-debt realization")} among the ${loaded} loaded`;
  } else if (liquidations > 0) {
    lead = `${plural(liquidations, "liquidation")} among the ${loaded} loaded`;
  } else if (types.length === 0 || types.includes("liquidation")) {
    // A true zero, scoped by "loaded": the filter admits liquidations and none is among these rows.
    lead = `No liquidation among the ${loaded} loaded`;
  } else {
    lead = `${loaded} loaded`;
    filtered = `filtered to ${joinAnd(types.map(typeWord))}`;
  }
  // The newest instant and whether more remain are the Newest and Loaded chips': the headline states the finding. A
  // window that licenses no newest still says so, since no chip can.
  const scopeWords = [filtered, withheld].filter((part): part is string => part !== null);
  return scopeWords.length === 0 ? { emphasis: `${lead}.`, rest: "" } : { emphasis: `${lead},`, rest: `${scopeWords.join("; ")}.` };
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
