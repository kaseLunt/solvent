// The Activity page's view model (plan 2026-09-16, R1–R5): the verdict header,
// the identity chips, the two tiles, the table rows, the list's qualifier and
// notices, the live strip's line, the list's empty words and the drawer's
// doctrine, decided once from the walk's state and never re-derived in a
// component.
//
// The laws it carries forward from the Feed surface and its list:
//
//   - the headline IS the window's own computed sentence (feedTakeaway), as
//     the finding's core and its scope: the page never says more than the
//     loaded rows license, and before the first page answers nothing is
//     counted; a refused or failed page names the state under the dashed tone
//     and gives the service's own words in the dek;
//   - a record is ink: an answered page wears the neutral tone, because a
//     count of chain actions is a fact and never a health verdict;
//   - the dek is computed facts about the loaded rows — each number counted
//     here from the rows, the two engines counted side by side and never
//     summed; the live strip and the paged record are two instruments, and
//     that doctrine lives in the drawer;
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
  splitUntimedTail,
  txExplorerUrl,
  type EventDisplayType,
  type FeedChainEvent,
  type FeedEngine,
  type FeedOrderMode,
} from "./feed-data";
import { RAW_UNITS_TAG, feedAmount, feedNewest, feedRowKey, feedTagTone, feedTakeaway, plural, renderBps } from "./feed-view";
import { EM_DASH, formatBlock, renderBlockTime, renderNullableDecimal } from "./format";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import { refused, sentence, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { isWirePopulation, readWirePopulation } from "./wireGuard";

export type ActivityState = "loading" | "ok" | "refused" | "error" | "exhausted";

/** The envelope facts of the most recent page — the wire's own echo, mirrored per walk. */
export interface ActivityEnvelope {
  readonly filter: {
    readonly engine: string | null;
    readonly types: readonly string[] | null;
    readonly since_block: number | null;
  };
  readonly limit: number;
  /** The envelope's own `served_at`: the reference year for an instant spoken in prose. Never the browser's clock. */
  readonly served_at: string;
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
  /** A null amount: the word is a statement about the record, not a value, and the table sets it as one. */
  readonly recordOnly: boolean;
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
  /** The list head's qualifier: the mode's order in short form and the page size the envelope echoed. */
  readonly listQualifier: string;
  /** The untimed tail's notice when a cross-engine tail is loaded; null otherwise. */
  readonly tailNote: string | null;
  readonly doctrine: readonly string[];
  /** The ordering-drift alert when the wire served a timed row inside the untimed tail; null otherwise. */
  readonly drift: string | null;
}

/** The loading arm's dek: what will be here, before anything is counted. */
export const ACTIVITY_LOADING_DEK = "Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.";

/** The exhausted arm's dek: an empty answer is an answer. */
export const ACTIVITY_EXHAUSTED_DEK = "That is the service's real answer for this filter, not a loading state.";

export const ACTIVITY_INTRO =
  "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the " +
  "stream's posture now; the list below pages through durable history. The two never blend.";

/** The paged record's own name: the live strip above it is the other instrument, so the two are never one blended stream. */
export const ACTIVITY_LIST_TITLE = "Recorded chain actions";

/** The Amount column's head: the caveat sits where the number is read, because a bare integer reads as dollars. */
export const ACTIVITY_AMOUNT_HEADER = "Amount · engine units, not USD";

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

/** The tail's notice at the point of need: the service orders the tail by chain, then block number — never by time. */
export const ACTIVITY_TAIL_NOTICE =
  "Rows with no block time yet come last, listed by chain and then block number; that tail is not in time order.";

/** The same notice when the loaded tail does not show that order: only what the rows show is said. */
export const ACTIVITY_TAIL_NOTICE_UNORDERED = "Rows with no block time yet come last; that tail is not in time order.";

export const ACTIVITY_DRIFT =
  "Ordering fault · the service sent a timed row inside the untimed tail, which the ordering law forbids. Rows stay " +
  "in wire order (re-sorting would hide the service bug); treat this walk as suspect.";

export const LEDGER_TYPES_NOTE =
  "type filter pinned to liquidation by the ledger view. The display vocabulary chips return with the all-actions view.";

/** The scope with no single engine chosen: the kicker, the Scope chip and the engine switch say it in one word. */
export const ALL_ENGINES = "all engines";

/** The since-block control with no single engine chosen, in short form: what would be here and how to get it. */
export const ACTIVITY_SINCE_SHORT = "Since block · choose one engine";

/** The same, in full: the short form's title and the drawer's sentence. */
export const ACTIVITY_SINCE_FULL =
  "Since block: choose one engine to filter by block number. Cash and the legacy market run on different chains, " +
  "so one block number cannot bound both.";

export const ACTIVITY_SINCE_NOTE = `${ACTIVITY_SINCE_FULL} That is a property of chains, not an error.`;

/** The live strip's law, kept ON the instrument in a few words; the long form is the drawer's. */
export const ACTIVITY_LIVE_LABEL = "Live stream · this connection only";

/** The strip label's title. */
export const ACTIVITY_LIVE_LAW = "This browser connection only — not a record. The list below is the record.";

export const ACTIVITY_LIVE_NOTE =
  "The live strip shows the stream's state on this connection only. Past stream states are not stored, so they " +
  "cannot be replayed here; the recorded list is chain fact held by Solvent.";

const ORDER_CROSS =
  "ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are " +
  "never compared across chains, and rows without header time follow in the disclosed untimed tail.";

const orderScoped = (engine: string | null): string =>
  `ordered by block height (block, tx, log, seq) DESC, because heights are comparable within ${engine ?? "one chain"}'s own chain.`;

const EXHAUSTED_WORDS =
  "no recorded chain action matches this filter. An empty page here is a real answer from the service.";

const LOADING_WORDS = "loading recorded chain actions…";

/** The foot's word and the rows tile's sub once the cursor is spent: one sentence, printed from here alone. */
export const END_OF_FEED = "end of the filtered feed";

/** An engine as prose names it: the dek and the qualifier speak sentences, where the label form does not read. */
function proseEngine(wire: string): string {
  if (wire === CASH) return "Cash";
  if (wire === LEGACY) return "the legacy Aave v3 market";
  return wire;
}

/** A block number the reader typed, grouped; one past the safe integers prints as typed, never re-rounded. */
const typedBlock = (block: number): string => (Number.isSafeInteger(block) ? groupInt(block) : String(block));

/**
 * The notice when an engine change drops the since-block bound: a block number is chain-scoped, so the same number
 * across chains means nothing and on another chain means something else — never silently re-meant.
 */
export function sinceBlockDroppedNotice(sinceBlock: number, candidate: FeedEngine | null): string {
  const removed = `The since-block filter (${typedBlock(sinceBlock)}) was removed: a block number only means something on one chain`;
  return candidate === null
    ? `${removed}, and no single engine is selected.`
    : `${removed}, and ${engineName(candidate)} is on a different one.`;
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
    recordOnly: amount.kind === "record-only",
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

/** The service's own words for a refused page, its code named once — never twice, never dropped — then what to do. */
function refusalDek(refusal: ActivityRefusal): string {
  const code = refusal.code ?? "bad_request";
  const said = sentence(refusal.message);
  const named = refusal.message.includes(code) ? said : `${said} (${code}).`;
  return `${named} Restart the list below.`;
}

const isAre = (n: number): string => (n === 1 ? "is" : "are");

/**
 * The untimed tail as the service keeps it — by chain, then block number, both descending — CHECKED against the
 * loaded rows: the order is said only when the rows show it, never on the contract's word alone.
 */
function tailKeepsItsOrder(rows: readonly FeedChainEvent[]): boolean {
  const untimed = rows.filter((event) => event.block_time === null);
  return untimed.every((event, i) => {
    const before = untimed[i - 1];
    if (before === undefined) return true;
    return before.chain_id > event.chain_id || (before.chain_id === event.chain_id && before.block_number >= event.block_number);
  });
}

/**
 * Where the loaded rows sit, engine by engine: a split of a ROW COUNT, side by side. No amount is added and the two
 * engines never share a figure. An engine outside the two this page names is counted as such, never folded into one.
 */
function engineSplit(rows: readonly FeedChainEvent[]): string {
  const n = rows.length;
  const cash = rows.filter((event) => event.engine === CASH).length;
  const legacy = rows.filter((event) => event.engine === LEGACY).length;
  const places = [
    { count: cash, name: proseEngine(CASH) },
    { count: legacy, name: proseEngine(LEGACY) },
    { count: n - cash - legacy, name: "an engine this page does not name" },
  ].filter((place) => place.count > 0);
  const only = places.length === 1 ? places[0] : undefined;
  if (only !== undefined) return n === 1 ? `It is on ${only.name}.` : `All ${groupInt(n)} are on ${only.name}.`;
  const clauses = places.map((place, i) => `${groupInt(place.count)} ${i === 0 ? `${isAre(place.count)} ` : ""}on ${place.name}`);
  return `${joinAnd(clauses)}.`;
}

/**
 * The answered page's dek: computed facts about the loaded rows, each sentence conditional on its own count — the
 * other crit type (bad debt realised), where the rows sit, and the untimed tail. Every number is counted here from
 * the rows. When none applies, the dek says how the list is ordered.
 */
function factDek(input: ActivityInput): string {
  const { rows, mode, engine } = input;
  const n = rows.length;
  const sentences: string[] = [];
  const deficits = rows.filter((event) => event.type === "deficit_created").length;
  if (deficits > 0) {
    sentences.push(
      n === 1
        ? "It records bad debt being realised (deficit_created)."
        : `${groupInt(deficits)} of them record${deficits === 1 ? "s" : ""} bad debt being realised (deficit_created).`,
    );
  }
  if (mode === "cross-engine") {
    sentences.push(engineSplit(rows));
    const untimed = rows.filter((event) => event.block_time === null).length;
    if (untimed > 0 && n > 1) {
      const none = `${groupInt(untimed)} ${untimed === 1 ? "has" : "have"} no block time yet`;
      // "Listed last" is the service's ordering; when the service broke it, only the count is claimed.
      const by = tailKeepsItsOrder(rows) ? ", by chain and then block number" : "";
      sentences.push(splitUntimedTail(rows).orderViolated ? `${none}.` : `${none} and ${isAre(untimed)} listed last${by}.`);
    }
  }
  if (sentences.length > 0) return sentences.join(" ");
  return `Listed newest first, by ${engine === null ? "block time" : `block number on ${proseEngine(engine)}'s chain`}.`;
}

function headlineFor(state: ActivityState, input: ActivityInput): LabHeadline {
  const n = input.rows.length;
  const after = `after ${plural(n, "chain action")} loaded.`;
  if (state === "refused" && input.refusal !== null) {
    return refused(n === 0 ? "The service refused this page." : `The next page was refused, ${after}`, refusalDek(input.refusal));
  }
  if (state === "error") {
    return refused(
      n === 0 ? "Recorded chain actions could not be fetched." : `The next page could not be fetched, ${after}`,
      sentence(input.error ?? ""),
    );
  }
  const takeaway = feedTakeaway(input.rows, input.mode, input.hasMore, {
    types: input.types,
    ledger: input.view === "ledger",
    servedAt: input.envelope?.served_at ?? null,
  });
  // Before the first page answers there is no answer to tone; an exhausted filter and a loaded window are records, and a record is ink.
  if (state === "loading") return { ...takeaway, tone: "refused", dek: ACTIVITY_LOADING_DEK };
  if (state === "exhausted") return { ...takeaway, tone: "neutral", dek: ACTIVITY_EXHAUSTED_DEK };
  return { ...takeaway, tone: "neutral", dek: factDek(input) };
}

/** The liquidations tile's sub: the count is of the loaded rows and no wider. */
export const LIQUIDATIONS_SUB = "among the loaded rows";

function tilesFor(state: ActivityState, input: ActivityInput): ActivityView["tiles"] {
  const { rows, hasMore } = input;
  if (rows.length === 0 && state !== "exhausted") {
    // Nothing loaded is not zero: both tiles carry the state's word under a dash.
    const word = state === "loading" ? LOADING_WORDS : state === "refused" ? "page refused" : "page fetch failed";
    const tone = state === "loading" ? "neutral" : "refused";
    return { rows: { value: EM_DASH, sub: word, tone }, liquidations: { value: EM_DASH, sub: word, tone } };
  }
  const liquidations = rows.filter((event) => event.type === "liquidation").length;
  return {
    rows: { value: groupInt(rows.length), sub: hasMore ? "more available" : END_OF_FEED, tone: "neutral" },
    liquidations: { value: groupInt(liquidations), sub: LIQUIDATIONS_SUB, tone: "neutral" },
  };
}

/** The list head's qualifier: the mode's order in short form, then the page size the envelope itself echoed. */
function listQualifier(input: ActivityInput, drifted: boolean): string {
  const order = drifted
    ? "in the order the service sent"
    : input.engine === null
      ? "newest first, by block time"
      : `newest first, by block number on ${proseEngine(input.engine)}'s chain`;
  if (input.envelope === null) return order;
  return `${order} · loads ${groupInt(readWirePopulation(input.envelope.limit, "limit"))} at a time`;
}

// ---- the live strip ---------------------------------------------------------

/** The stream's state as the strip needs it: the provider's posture, read structurally. */
export interface LiveStripInput {
  readonly streamState: string;
  readonly hasBase: boolean;
  readonly batch: {
    readonly id: number;
    readonly position_count: number;
    readonly refused_count: number;
    readonly supersession: { readonly superseded: boolean };
    readonly watermarks: readonly { readonly engine: string; readonly last_block: number }[];
  } | null;
  readonly unavailable: { readonly staleSinceSeconds: number | null; readonly lastGoodBatchId: number | null } | null;
  readonly degradation: {
    readonly refused_engines: readonly { readonly engine: string; readonly code: string; readonly detail?: string | null }[];
  } | null;
}

/** One run of the strip's line: prose, a figure (an id or a number — the strip's only mono), or a warned phrase. */
export interface LivePart {
  readonly text: string;
  readonly kind: "text" | "figure" | "warn";
}

export interface LiveStripView {
  readonly label: string;
  readonly law: string;
  /** The connection's whole claim — the transport state AND whether it has delivered a base frame. */
  readonly chip: { readonly label: string; readonly tone: "accent" | "unknown" | "warn" | "down" };
  readonly arm: "unavailable" | "batch" | "none";
  readonly line: readonly LivePart[];
  /** Engines whose whole book is withheld now, each with its cause in reader words and the wire's code; null when none. */
  readonly degraded: string | null;
}

const prose = (words: string): LivePart => ({ text: words, kind: "text" });

/**
 * An envelope integer on a live instrument: grouped when it passes the population law, the word otherwise — one
 * malformed frame never takes the recorded list below down with it.
 */
const figure = (value: number, suffix = ""): LivePart => ({
  text: isWirePopulation(value) ? `${groupInt(value)}${suffix}` : "unreadable",
  kind: "figure",
});

/**
 * The chip is a function of the connection's WHOLE claim: an open socket the server has not spoken on is not
 * "streaming". A proven connection is accent, never the health green — connection is posture, not health.
 */
function liveChip(state: string, hasBase: boolean): LiveStripView["chip"] {
  switch (state) {
    case "open":
      return hasBase ? { label: "streaming", tone: "accent" } : { label: "awaiting base", tone: "unknown" };
    case "idle":
    case "connecting":
      return { label: "connecting", tone: "warn" };
    case "waiting":
      return { label: "reconnecting", tone: "warn" };
    case "closed":
      return { label: "closed", tone: "down" };
    default:
      return { label: state, tone: "warn" };
  }
}

/**
 * The live strip as one plain line. With no base frame on the CURRENT connection it says so; a batch from an
 * earlier connection is named as such beside the stream's state, so a dead stream never reads as fresh. The strip
 * is this connection's state only — never a record, and never blended with the list below it.
 */
export function deriveLiveStrip(input: LiveStripInput): LiveStripView {
  const live = input.streamState === "open" && input.hasBase;
  let arm: LiveStripView["arm"];
  let line: LivePart[];
  if (input.unavailable !== null) {
    arm = "unavailable";
    line = [prose("No batch can be served right now")];
    if (input.unavailable.staleSinceSeconds !== null) {
      line.push(prose(" · the data held is "), figure(input.unavailable.staleSinceSeconds, "s"), prose(" old"));
    }
    if (input.unavailable.lastGoodBatchId !== null) {
      line.push(prose(" · last good batch "), figure(input.unavailable.lastGoodBatchId));
    }
  } else if (input.batch !== null) {
    const batch = input.batch;
    arm = "batch";
    line = [
      prose("Batch "),
      figure(batch.id),
      prose(" · "),
      figure(batch.position_count),
      prose(batch.position_count === 1 ? " position, " : " positions, "),
      figure(batch.refused_count),
      prose(" not computed"),
    ];
    if (batch.supersession.superseded) line.push(prose(" · "), { text: "superseded, still served", kind: "warn" });
    if (!live) line.push(prose(" · received on an earlier connection"));
    for (const stamp of batch.watermarks) {
      line.push(prose(` · ${engineName(stamp.engine)} at block `), { text: formatBlock(stamp.last_block), kind: "figure" });
    }
  } else {
    arm = "none";
    line = [
      prose(
        input.streamState === "closed"
          ? "No batch arrived on this connection, so nothing live is shown."
          : "No batch has arrived on this connection yet, so nothing live is shown.",
      ),
    ];
  }
  const withheld = input.degradation?.refused_engines ?? [];
  return {
    label: ACTIVITY_LIVE_LABEL,
    law: ACTIVITY_LIVE_LAW,
    chip: liveChip(input.streamState, input.hasBase),
    arm,
    line,
    degraded:
      withheld.length === 0
        ? null
        : `Withheld now: ${withheld.map((r) => `${engineName(r.engine)} (${plainCause(r.code, r.detail)} · ${r.code})`).join(", ")}`,
  };
}

// ---- the view ---------------------------------------------------------------

export function deriveActivityView(input: ActivityInput): ActivityView {
  const { rows, mode, engine, view, envelope, valueDecimals } = input;
  const state = activityState(input);
  const tail = mode === "cross-engine" ? splitUntimedTail(rows) : null;
  const drifted = tail !== null && tail.orderViolated;
  const newest = feedNewest(rows, mode);
  // The exact layer of the headline's spoken instant; absent in every arm that claims no newest.
  const newestChip: LabChip[] =
    newest === null
      ? []
      : newest.kind === "time"
        ? [{ label: "Newest", value: newest.iso }]
        : newest.kind === "block"
          ? [{ label: "Newest", value: `block ${formatBlock(newest.block)}` }]
          : [];
  const scope = engine === null ? ALL_ENGINES : engineName(engine);
  const chips: LabChip[] = [
    { label: "Scope", value: scope },
    { label: "View", value: view === "all" ? "all actions" : "liquidations ledger" },
    { label: "Order", value: engine === null ? "by block time" : "by block number" },
    ...newestChip,
    ...(envelope === null ? [] : [{ label: "Filter echo", value: filterEcho(envelope) }]),
  ];
  return {
    state,
    kicker: `Activity · ${scope}`,
    headline: headlineFor(state, input),
    chips,
    tiles: tilesFor(state, input),
    rows: rows.map((event) => activityRow(event, mode, valueDecimals)),
    emptyText: emptyWords(state, input),
    listQualifier: listQualifier(input, drifted),
    tailNote:
      tail === null || tail.untimed.length === 0 || drifted
        ? null
        : tailKeepsItsOrder(rows)
          ? ACTIVITY_TAIL_NOTICE
          : ACTIVITY_TAIL_NOTICE_UNORDERED,
    doctrine: [
      ACTIVITY_INTRO,
      ACTIVITY_LIST_TITLE,
      ACTIVITY_METHOD,
      ACTIVITY_FORENSICS,
      ACTIVITY_TAIL_NOTE,
      sentence(mode === "cross-engine" ? ORDER_CROSS : orderScoped(engine)),
      ACTIVITY_SINCE_NOTE,
      ACTIVITY_LIVE_NOTE,
    ],
    drift: drifted ? ACTIVITY_DRIFT : null,
  };
}
