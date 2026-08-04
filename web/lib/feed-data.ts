// The Feed surface's wire seam over GET /v1/events (W5).
//
// Transport + generated-contract typing live in lib/inspector-data.ts (the
// documented C1 seam — this file deliberately re-uses its `fetchEvents`
// rather than growing a second fetch path). What THIS file owns is the
// Feed's law layer, encoding AMENDMENT 1 item B of the P5 plan
// (docs/plans/2026-07-30-solvent-phase5-web.md):
//
//   ORDERING — block heights are incomparable ACROSS chains (ETH ~25.6M vs
//   OP ~154M say nothing about time relative to each other):
//     * an ENGINE-SCOPED page (exactly one engine, hence one chain) is
//       ordered (block_number, tx_hash, log_index, seq) DESC — heights are
//       comparable within one chain;
//     * a CROSS-ENGINE page is ordered by custodied block_time DESC with the
//       deterministic chain-aware tiebreak; rows WITHOUT a custodied
//       block_time sort AFTER every timed row in a DISCLOSED untimed tail —
//       never interleaved by incomparable heights, never given an invented
//       time.
//   since_block is meaningful ONLY engine-scoped: a height bound across
//   incomparable chains means nothing, and the API refuses it. The UI
//   renders that as an impossibility (a property of chains), not an error —
//   `assertFeedScopeLawful` makes the malformed request unbuildable here.
//
//   AMOUNT UNITS — an event's `amount` is the engine's own ACCOUNTING unit,
//   not a display token amount. The closed unit set (`FeedAmountUnit`) is
//   the contract's `EventAmountUnit` (internal/store/p5_events.go's
//   vocabulary, on the wire since 1.2.0): dm_normalized_debt / aave_scaled /
//   none / opaque — welded compile-time BOTH WAYS below.
//
// (C2 landed: the formerly-OWED `amount_unit` extension collapsed into the
// generated `ChainEvent`, which now carries the field as required.)

import type { components, operations } from "@solvent/client";
import {
  fetchEvents,
  type ChainEvent,
  type EventDisplayType,
  type EventsResponse,
} from "./inspector-data";

export type { ChainEvent, EventDisplayType, EventsResponse };
export { InspectorFetchError, txExplorerUrl } from "./inspector-data";

/** The filter echo the response carries (generated contract type). */
export type EventFilter = components["schemas"]["EventFilter"];

// ---------------------------------------------------------------------------
// Closed vocabularies, welded to the generated contract types.
// ---------------------------------------------------------------------------

/** The engine query values, verbatim from the generated getEvents params. */
type WireEngine = NonNullable<
  NonNullable<operations["getEvents"]["parameters"]["query"]>["engine"]
>;

export const FEED_ENGINES = ["aave_v3_etherfi", "debt_manager"] as const satisfies readonly WireEngine[];
export type FeedEngine = (typeof FEED_ENGINES)[number];

/**
 * The display vocabulary as a runtime list. The `Record<EventDisplayType,…>`
 * shape makes this total BOTH ways against the generated union: a class the
 * contract adds breaks this compile (missing key), and a class the contract
 * drops breaks it too (excess key). The UI never invents a display class.
 */
const EVENT_DISPLAY_TYPE_SET = {
  borrow: true,
  repay: true,
  supply: true,
  withdraw: true,
  liquidation: true,
  collateral_enabled: true,
  collateral_disabled: true,
  deficit_created: true,
} as const satisfies Record<EventDisplayType, true>;

export const EVENT_DISPLAY_TYPES = Object.keys(
  EVENT_DISPLAY_TYPE_SET,
) as readonly EventDisplayType[];

/**
 * The closed semantic-unit set for an event's `amount` — the generated
 * contract's `EventAmountUnit`, welded total BOTH WAYS (the same
 * `Record<…, true>` law as the display vocabulary above): a unit the
 * contract adds breaks this compile, and a unit it drops breaks it too.
 */
type WireAmountUnit = components["schemas"]["EventAmountUnit"];

const FEED_AMOUNT_UNIT_SET = {
  none: true,
  dm_normalized_debt: true,
  aave_scaled: true,
  opaque: true,
} as const satisfies Record<WireAmountUnit, true>;

export const FEED_AMOUNT_UNITS = Object.keys(FEED_AMOUNT_UNIT_SET) as readonly FeedAmountUnit[];
export type FeedAmountUnit = WireAmountUnit;

/**
 * Narrow a wire tag to the known closed set. The generated type says the
 * union is total, but the wire's statement is still preserved verbatim at
 * runtime: an out-of-set tag renders as itself, never coerced into a known
 * unit (feed-view owns that rendering law).
 */
export function isKnownAmountUnit(unit: string): unit is FeedAmountUnit {
  return (FEED_AMOUNT_UNITS as readonly string[]).includes(unit);
}

/** One feed row — the generated contract row, `amount_unit` included. */
export type FeedChainEvent = ChainEvent;

export type FeedEventsResponse = EventsResponse;

// ---------------------------------------------------------------------------
// Scope: what one feed walk asks for. Mode is DERIVED, never stored twice.
// ---------------------------------------------------------------------------

export interface FeedScope {
  /** Null = cross-engine (both books, ordered by block_time). */
  engine: FeedEngine | null;
  /** Empty = every display class. */
  types: readonly EventDisplayType[];
  /** Engine-scoped ONLY — see `assertFeedScopeLawful`. */
  sinceBlock: number | null;
}

export type FeedOrderMode = "engine-scoped" | "cross-engine";

export function feedOrderMode(scope: FeedScope): FeedOrderMode {
  return scope.engine === null ? "cross-engine" : "engine-scoped";
}

/** The one-line reason since_block cannot exist cross-engine. */
export const SINCE_BLOCK_IMPOSSIBILITY =
  "since_block needs exactly one engine: block heights are incomparable across chains, " +
  "so a cross-engine height bound means nothing. This is a property of chains, not an error.";

/**
 * The law gate every feed request passes through: a cross-engine
 * `since_block` is refused LOCALLY (never sent — the API would refuse it
 * too, but the UI treats it as an impossibility, not a server error).
 */
export function assertFeedScopeLawful(scope: FeedScope): void {
  if (scope.sinceBlock !== null && scope.engine === null) {
    throw new Error(`refused locally, never sent: ${SINCE_BLOCK_IMPOSSIBILITY}`);
  }
}

/** `GET /v1/events` — one page of the feed, under the scope law. */
export async function fetchFeedPage(
  baseUrl: string,
  scope: FeedScope,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<FeedEventsResponse> {
  assertFeedScopeLawful(scope);
  return fetchEvents(
    baseUrl,
    {
      limit,
      ...(scope.engine === null ? {} : { engine: scope.engine }),
      ...(scope.types.length === 0 ? {} : { types: scope.types }),
      ...(scope.sinceBlock === null ? {} : { sinceBlock: scope.sinceBlock }),
      ...(cursor === null ? {} : { cursor }),
    },
    signal,
  );
}

// ---------------------------------------------------------------------------
// The untimed tail (cross-engine pages).
// ---------------------------------------------------------------------------

export interface UntimedSplit<E> {
  /** Wire order, up to the first row without a custodied block_time. */
  timed: readonly E[];
  /** Wire order, from the first untimed row onward — the DISCLOSED tail. */
  untimed: readonly E[];
  /**
   * True when a TIMED row arrived after the tail began — the wire broke the
   * ordering law. The UI keeps wire order (re-sorting would hide a service
   * bug) and renders this as a loud drift warning instead.
   */
  orderViolated: boolean;
}

/**
 * Split a cross-engine page (or accumulated pages of one walk) into the
 * timed section and the untimed tail, PRESERVING wire order. The tail is
 * ordered by the chain-aware tiebreak alone — the split is where the UI
 * hangs its disclosure; it never invents a time and never re-sorts.
 */
export function splitUntimedTail<E extends { block_time: string | null }>(
  events: readonly E[],
): UntimedSplit<E> {
  const firstUntimed = events.findIndex((event) => event.block_time === null);
  if (firstUntimed === -1) {
    return { timed: events, untimed: [], orderViolated: false };
  }
  const timed = events.slice(0, firstUntimed);
  const untimed = events.slice(firstUntimed);
  const orderViolated = untimed.some((event) => event.block_time !== null);
  return { timed, untimed, orderViolated };
}
