// The Activity page's view model (plan 2026-09-16, R1–R5): the verdict header,
// the identity chips, the two tiles, the table rows, the order note, the
// list's empty words and the drawer's doctrine, decided once from the walk's
// state and never re-derived in a component.
//
// The laws it carries forward from the Feed surface and its list:
//
//   - the headline IS the window's own computed sentence (feedTakeaway): the
//     page never says more than the loaded rows license; a refused or failed
//     page speaks in the service's own words under the dashed tone;
//   - the live strip and the paged record are two instruments — the dek says
//     so in one clause; the rest of the doctrine lives in the drawer;
//   - a row's amount is the engine's own accounting unit, named beside it
//     (feedAmount's arms printed as the list printed them, the raw-units tag
//     included) and never a dollar figure;
//   - a cross-engine row without custodied header time is the untimed tail:
//     dimmed, its block number where the time would be, never an invented
//     timestamp; engine-scoped a null time is a per-row fallback, not a tail;
//   - nothing loaded is a dash, never a zero; an exhausted filter is a real
//     answer and its zero is true;
//   - every wire integer printed here passes the population guard first.

import { groupDecimalString } from "./book-format";
import {
  SINCE_BLOCK_IMPOSSIBILITY,
  splitUntimedTail,
  txExplorerUrl,
  type EventDisplayType,
  type FeedChainEvent,
  type FeedEngine,
  type FeedOrderMode,
} from "./feed-data";
import { RAW_UNITS_TAG, feedAmount, feedRowKey, feedTagTone, feedTakeaway, renderBps } from "./feed-view";
import { EM_DASH, formatBlock, renderBlockTime, renderNullableDecimal } from "./format";
import { engineName } from "./inspector-headline";
import { refused, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { groupInt } from "./prose";
import { readWirePopulation } from "./wireGuard";

export type ActivityState = "loading" | "ok" | "refused" | "error" | "exhausted";

/** The envelope facts of the most recent page — the wire's own echo, mirrored per walk. */
export interface ActivityEnvelope {
  readonly filter: {
    readonly engine: string | null;
    readonly types: readonly string[] | null;
    readonly since_block: number | null;
  };
  readonly limit: number;
}

/** A 400 the service answered: its own code and words, held until the walk restarts. */
export interface ActivityRefusal {
  readonly status: number;
  readonly code: string | null;
  readonly message: string;
}

export interface ActivityInput {
  readonly rows: readonly FeedChainEvent[];
  readonly mode: FeedOrderMode;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly engine: FeedEngine | null;
  readonly view: "all" | "ledger";
  readonly types: readonly EventDisplayType[];
  readonly sinceBlock: number | null;
  readonly envelope: ActivityEnvelope | null;
  readonly refusal: ActivityRefusal | null;
  /** The last page fetch's failure message, when no refusal explains it. */
  readonly error: string | null;
  /** Each engine's `value_decimals` as the wire served them; an absent engine has no licensed scale. */
  readonly valueDecimals: Readonly<Record<string, number>>;
}

/**
 * A liquidation's typed extract, as parts the table prints visibly beneath the pill: the liquidator (with its
 * Inspector link), the repaid debt and the seized legs in each asset's own units, both bonus figures as renderBps
 * gives them — every unestablished field an em dash, never an estimate and never behind a hover — and the wire's note.
 */
export interface ActivityLiquidation {
  readonly liquidator: string;
  readonly liquidatorHref: string;
  /** The repaid debt at the extract's own decimals, or an em dash when the wire carried none. */
  readonly repaid: string;
  /** The debt asset, shortened, or null when the wire carried none. */
  readonly repaidAsset: string | null;
  /** Every seizure leg as `amount symbol`, comma-joined; the no-legs statement when none was carried. */
  readonly seized: string;
  readonly bonusRealized: string;
  readonly bonusConfigured: string;
  readonly note: string;
}

export interface ActivityRow {
  /** The event's own chain coordinates (feedRowKey); the row's test id hangs on it. */
  readonly key: string;
  /** The untimed tail: a cross-engine row without custodied header time. */
  readonly dim: boolean;
  /** The custodied header time, or the block number when the time is null. */
  readonly when: string;
  readonly engine: string;
  readonly type: EventDisplayType;
  readonly tone: "crit" | "info";
  readonly account: string;
  /** The amount as far as its unit licenses, or the record-only word. */
  readonly amount: string;
  /** The unit named beside the amount: the unit tag, the raw-units tag when unscaled, the symbol. */
  readonly unit: string;
  /** What the unit is and what converting it would take; null for a record-only row. */
  readonly unitTitle: string | null;
  /** The chain's explorer link for the transaction, or null when no explorer is configured for the chain. */
  readonly tx: string | null;
  readonly txLabel: string;
  /** The full hash with the row's chain coordinates (log always, block beside a time, seq when nonzero). */
  readonly txTitle: string;
  /** A liquidation's typed extract; null for every other type. */
  readonly detail: ActivityLiquidation | null;
}

export interface ActivityTile {
  readonly value: string;
  readonly sub: string;
  readonly tone: "neutral" | "refused";
}

export interface ActivityView {
  readonly state: ActivityState;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: LabChip[];
  readonly tiles: { readonly rows: ActivityTile; readonly liquidations: ActivityTile };
  readonly rows: readonly ActivityRow[];
  readonly emptyText: string;
  readonly orderNote: string;
  readonly doctrine: readonly string[];
  /** The ordering-drift alert when the wire served a timed row inside the untimed tail; null otherwise. */
  readonly drift: string | null;
}

export const ACTIVITY_DEK = "The live strip and the paged record never blend.";

export const ACTIVITY_INTRO =
  "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the " +
  "stream's posture now; the list below pages through durable history. The two never blend.";

/** The paged record's own name: the live strip above it is the other instrument, so the two are never one blended stream. */
export const ACTIVITY_LIST_TITLE = "History: recorded chain actions";

export const ACTIVITY_METHOD =
  "block_time is chain-asserted header custody, never invented; amounts are the engine's own accounting units, " +
  "named per row, and a scaled or normalized value is never dressed up as a token or USD figure.";

export const ACTIVITY_FORENSICS =
  "block_time is chain-asserted header custody: null until custodied, in which case the block number renders " +
  "instead. A timestamp is never invented. Amounts are the engine's own accounting units, named per row, and a " +
  "scaled or normalized value is never dressed up as a token or USD figure.";

export const ACTIVITY_TAIL_NOTE =
  "The untimed tail: rows without custodied header time render dimmed, each showing its block number, after every " +
  "timed row, ordered by the chain-aware tiebreak (chain, height, tx, log, seq) instead of by time — the tail's " +
  "internal order is not chronology, and two chains' block heights are never compared as time.";

export const ACTIVITY_DRIFT =
  "ORDERING DRIFT · the wire served a TIMED row inside the untimed tail, which the ordering law forbids. Rows stay " +
  "in wire order (re-sorting would hide the service bug); treat this walk as suspect.";

export const LEDGER_TYPES_NOTE =
  "type filter pinned to liquidation by the ledger view. The display vocabulary chips return with the all-actions view.";

const ORDER_CROSS =
  "ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are " +
  "never compared across chains, and rows without header time follow in the disclosed untimed tail.";

const orderScoped = (engine: string | null): string =>
  `ordered by block height (block, tx, log, seq) DESC, because heights are comparable within ${engine ?? "one chain"}'s own chain.`;

const EXHAUSTED_WORDS =
  "no custodied chain actions match this filter. An empty page here is a real answer from the service.";

const LOADING_WORDS = "loading the feed…";

/** The foot's word and the rows tile's sub once the cursor is spent: one sentence, printed from here alone. */
export const END_OF_FEED = "end of the filtered feed";

/**
 * The notice when an engine change drops the since-block bound: a height bound is chain-scoped, so the same number
 * across chains means nothing and on another chain means something else — never silently re-meant.
 */
export function sinceBlockDroppedNotice(sinceBlock: number, candidate: FeedEngine | null): string {
  return candidate === null
    ? `since_block ${String(sinceBlock)} dropped: ${SINCE_BLOCK_IMPOSSIBILITY}`
    : `since_block ${String(sinceBlock)} dropped: block heights are chain-scoped, and ${candidate} lives on a different chain`;
}

/** The notice when the since-block draft is not a block number: the draft quoted (at most 32 characters), and nothing requested. */
export function notABlockNumberNotice(draft: string): string {
  return `"${draft.slice(0, 32)}" is not a block number, so nothing was requested`;
}

function echoTypes(types: readonly string[] | null): string {
  return types === null || types.length === 0 ? "all" : types.join(",");
}

/** The wire's own filter echo; its integers pass the population guard before they print. */
function filterEcho(envelope: ActivityEnvelope): string {
  const since =
    envelope.filter.since_block === null
      ? EM_DASH
      : String(readWirePopulation(envelope.filter.since_block, "since_block"));
  const limit = String(readWirePopulation(envelope.limit, "limit"));
  return `engine ${envelope.filter.engine ?? EM_DASH} · types ${echoTypes(envelope.filter.types)} · since_block ${since} · limit ${limit}`;
}

/** The typed extract as parts: liquidator, repaid debt, seized legs, both bonus figures, the wire's note. An unestablished field is an em dash, never an estimate. */
function liquidationDetail(detail: NonNullable<FeedChainEvent["liquidation"]>): ActivityLiquidation {
  const repaid =
    detail.debt_repaid === null
      ? EM_DASH
      : groupDecimalString(renderNullableDecimal(detail.debt_repaid, { decimals: detail.debt_decimals ?? undefined }));
  const seized =
    detail.seized.length === 0
      ? `${EM_DASH} (no seizure legs carried)`
      : detail.seized
          .map(
            (leg) =>
              `${groupDecimalString(renderNullableDecimal(leg.amount, { decimals: leg.decimals }))} ${leg.symbol ?? `${leg.asset.slice(0, 8)}…`}`,
          )
          .join(", ");
  return {
    liquidator: detail.liquidator,
    liquidatorHref: `/inspector/${detail.liquidator}`,
    repaid,
    repaidAsset: detail.debt_asset === null ? null : `${detail.debt_asset.slice(0, 10)}…`,
    seized,
    bonusRealized: renderBps(detail.realized_bonus_bps),
    bonusConfigured: renderBps(detail.configured_bonus_bps),
    note: detail.note,
  };
}

function activityRow(
  event: FeedChainEvent,
  mode: FeedOrderMode,
  valueDecimals: Readonly<Record<string, number>>,
): ActivityRow {
  const amount = feedAmount(event, { engineValueDecimals: valueDecimals[event.engine] ?? null });
  const url = txExplorerUrl(event.chain_id, event.tx_hash);
  // Provenance integers are wire populations, guarded at the read; the throw lands in the route boundary.
  const log = readWirePopulation(event.log_index, "log_index");
  const seq = readWirePopulation(event.seq, "seq");
  const block = event.block_time === null ? "" : `block ${formatBlock(event.block_number)} · `;
  const coordinates = `${block}log ${String(log)}${seq === 0 ? "" : ` · seq ${String(seq)}`}`;
  const explorer =
    url === null ? ` (no explorer configured for chain ${String(readWirePopulation(event.chain_id, "chain_id"))})` : "";
  const unit =
    amount.kind === "record-only"
      ? ""
      : [amount.unitChip, amount.rawUnits ? RAW_UNITS_TAG : null, amount.symbol]
          .filter((part): part is string => part !== null)
          .join(" · ");
  return {
    key: feedRowKey(event),
    dim: mode === "cross-engine" && event.block_time === null,
    when: renderBlockTime(event.block_number, event.block_time),
    engine: engineName(event.engine),
    type: event.type,
    tone: feedTagTone(event.type),
    account: event.account,
    amount: amount.kind === "record-only" ? "record-only" : amount.display,
    unit,
    unitTitle: amount.kind === "record-only" ? null : amount.unitTitle,
    tx: url,
    txLabel: `${event.tx_hash.slice(0, 10)}…`,
    txTitle: `${event.tx_hash}${explorer} · ${coordinates}`,
    detail: event.liquidation === null ? null : liquidationDetail(event.liquidation),
  };
}

function activityState(input: ActivityInput): ActivityState {
  if (input.refusal !== null) return "refused";
  if (input.error !== null) return "error";
  if (input.rows.length === 0) return input.hasMore ? "loading" : "exhausted";
  return "ok";
}

function emptyWords(state: ActivityState, input: ActivityInput): string {
  switch (state) {
    case "refused":
      return `page refused · ${input.refusal?.code ?? "bad_request"}: restart below`;
    case "error":
      return `page fetch failed: ${input.error ?? ""}`;
    case "exhausted":
      return EXHAUSTED_WORDS;
    case "loading":
      return LOADING_WORDS;
    case "ok":
      return "no rows on this page";
  }
}

function headlineFor(state: ActivityState, input: ActivityInput): LabHeadline {
  if (state === "refused" && input.refusal !== null) {
    return refused(`Page refused · ${input.refusal.code ?? "bad_request"}: ${input.refusal.message}`, ACTIVITY_DEK);
  }
  if (state === "error") return refused(`Page fetch failed: ${input.error ?? ""}`, ACTIVITY_DEK);
  return {
    emphasis: feedTakeaway(input.rows, input.mode, input.hasMore),
    rest: "",
    // Before the first page answers there is no verdict; an exhausted filter and a loaded window are answers.
    tone: state === "loading" ? "refused" : "ok",
    dek: ACTIVITY_DEK,
  };
}

function tilesFor(state: ActivityState, input: ActivityInput): ActivityView["tiles"] {
  const { rows, hasMore, mode } = input;
  if (rows.length === 0 && state !== "exhausted") {
    // Nothing loaded is not zero: the tile carries the state's word under a dash.
    const word = state === "loading" ? LOADING_WORDS : state === "refused" ? "page refused" : "page fetch failed";
    const tone = state === "loading" ? "neutral" : "refused";
    return { rows: { value: EM_DASH, sub: word, tone }, liquidations: { value: EM_DASH, sub: mode, tone } };
  }
  const liquidations = rows.filter((event) => event.type === "liquidation").length;
  return {
    rows: { value: groupInt(rows.length), sub: hasMore ? "more available" : END_OF_FEED, tone: "neutral" },
    liquidations: { value: groupInt(liquidations), sub: mode, tone: "neutral" },
  };
}

export function deriveActivityView(input: ActivityInput): ActivityView {
  const { rows, mode, engine, view, envelope, valueDecimals } = input;
  const state = activityState(input);
  const chips: LabChip[] = [
    { label: "Scope", value: engine === null ? "cross-engine" : engineName(engine) },
    { label: "View", value: view === "all" ? "all actions" : "liquidations ledger" },
    { label: "Order", value: mode },
    { label: "Rows", value: groupInt(rows.length) },
    ...(envelope === null ? [] : [{ label: "Filter echo", value: filterEcho(envelope) }]),
  ];
  return {
    state,
    kicker: engine === null ? "Activity · cross-engine" : `Activity · ${engineName(engine)}`,
    headline: headlineFor(state, input),
    chips,
    tiles: tilesFor(state, input),
    rows: rows.map((event) => activityRow(event, mode, valueDecimals)),
    emptyText: emptyWords(state, input),
    orderNote: mode === "cross-engine" ? ORDER_CROSS : orderScoped(engine),
    doctrine: [ACTIVITY_INTRO, ACTIVITY_LIST_TITLE, ACTIVITY_METHOD, ACTIVITY_FORENSICS, ACTIVITY_TAIL_NOTE],
    drift: mode === "cross-engine" && splitUntimedTail(rows).orderViolated ? ACTIVITY_DRIFT : null,
  };
}
