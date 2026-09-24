// The Activity page's view model: the verdict header, the identity chips, the
// two tiles, the table rows, the list's qualifier and notices, the state cards,
// what the foot offers, the live strip's line, the list's empty words and the
// drawer's doctrine, decided once from the walk's state and never re-derived in
// a component.
//
// The laws it carries forward from the Feed surface and its list:
//
//   - the headline IS the window's own computed sentence (feedTakeaway), as
//     the finding's core and its scope: the page never says more than the
//     loaded rows license, and before the first page answers nothing is
//     counted; a refused page and a failed fetch are two states with two words
//     — a fetch that failed is never a refusal — and the service's own words
//     move under a disclosure, relocated, never removed;
//   - a record is ink: an answered page wears the neutral tone, because a
//     count of chain actions is a fact and never a health verdict; a
//     liquidation or a bad-debt realization is a KEY record, set apart by
//     weight, never by a verdict's colour;
//   - the dek is computed facts about the loaded rows — each number counted
//     here from the rows, the two engines counted side by side and never
//     summed; the live strip and the paged record are two instruments, and
//     that doctrine lives in the drawer;
//   - a row's amount is the engine's own accounting unit, named beside it
//     (feedAmount's arms) and never a dollar figure; its scale is the wire's
//     own — the stream's aggregates, then the book's — or none, and a figure
//     no scale placed carries the raw-units tag in its own cell, beside the
//     digits; the digits align on one axis only while one engine is chosen,
//     because two engines' figures never share an axis;
//   - a type prints in the page's words, the wire's word kept for its title;
//   - a cross-engine row without custodied header time is the untimed tail:
//     dimmed, its block number where the time would be, never an invented
//     timestamp; engine-scoped a null time is a per-row fallback, not a tail;
//   - nothing loaded is a state word, never a zero or a bare dash; an
//     exhausted list is a real answer and names the scope it answers for; a
//     count the type filter excludes is filtered out, never zero;
//   - every wire integer printed here passes the population guard first.

import { inlineParts } from "./inline-parts";
import { bookEnvelopeFault } from "./cash-refusal";
import {
  splitUntimedTail,
  txExplorerUrl,
  type EventDisplayType,
  type FeedChainEvent,
  type FeedEngine,
  type FeedOrderMode,
} from "./feed-data";
import {
  LIQUIDATION_WORDS,
  RAW_UNITS_TAG,
  RECORD_ONLY_TITLE,
  RECORD_ONLY_WORD,
  feedAmount,
  feedNewest,
  feedRowKey,
  feedTagTone,
  feedTakeaway,
  liquidationRepaid,
  liquidationSeized,
  renderBps,
  typeLabel,
  typeWord,
} from "./feed-view";
import { answeredUnreadably, malformedStatus } from "./fetch-failure";
import { EM_DASH, blockTimeTitle, formatBlock, renderBlockTime, shortHex, truncateAddress } from "./format";
import { humanUtc } from "./human-utc";
import { InspectorFetchError } from "./inspector-data";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { engineInProse, groupInt, joinAnd, plural } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { isWirePopulation, isWireScale, readWirePopulation } from "./wireGuard";

export type ActivityState = "loading" | "ok" | "refused" | "error" | "exhausted";

/** The envelope facts of the most recent page — the wire's own echo, mirrored per walk. */
export interface ActivityEnvelope {
  readonly filter: {
    readonly engine: string | null;
    readonly account?: string | null;
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

/** A page fetch that failed: the HTTP status when the service answered at all, and the failure's own words. */
export interface ActivityFailure {
  readonly status: number | null;
  readonly code: string | null;
  readonly message: string;
  /** The service answered with a 2xx body the page could not read: an answer arrived, and it is unreadable, not unfetched. */
  readonly unreadable?: boolean;
}

/**
 * A failed page fetch as the view reads it: the envelope's status and code when the service refused or failed in the
 * contract's words; the status of an answer whose body the client could not read — unreadable when that answer was a
 * 2xx, a failed request when it was a proxy's error page; and no status when no response came back to read one from.
 */
export function activityFailed(cause: unknown): ActivityFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof InspectorFetchError) return { status: cause.status, code: cause.code, message, unreadable: false };
  return { status: malformedStatus(cause), code: null, message, unreadable: answeredUnreadably(cause) };
}

export interface ActivityInput {
  readonly rows: readonly FeedChainEvent[];
  readonly mode: FeedOrderMode;
  readonly hasMore: boolean;
  readonly engine: FeedEngine | null;
  readonly view: "all" | "ledger";
  readonly types: readonly EventDisplayType[];
  readonly sinceBlock: number | null;
  readonly envelope: ActivityEnvelope | null;
  readonly refusal: ActivityRefusal | null;
  /** The last page fetch's failure, when no refusal explains it. */
  readonly failure: ActivityFailure | null;
  /** Each engine's `value_decimals` as the wire served them; an absent engine has no licensed scale. */
  readonly valueDecimals: Readonly<Record<string, number>>;
}

/**
 * One run of a liquidation's extract line, in order: prose (its words and separators the lib's), the liquidator's
 * Inspector link, a figure, or the unit a figure is counted in — the table sets each and adds nothing.
 */
export type LiquidationPart =
  | { readonly kind: "text" | "figure" | "unit"; readonly text: string }
  | { readonly kind: "liquidator"; readonly text: string; readonly href: string; readonly title: string };

/** One run of the wire's note: its words, with the contract's code and bold markers read as formatting. */
export type NotePart =
  | { readonly kind: "text" | "code"; readonly text: string }
  | { readonly kind: "strong"; readonly parts: readonly NotePart[] };

/**
 * A liquidation's typed extract, as parts the table prints visibly beneath the type: the liquidator (with its
 * Inspector link), the repaid debt and the seized legs in each asset's own units, both bonus figures as renderBps
 * gives them — every unestablished bonus an em dash with the footnote's mark, never an estimate and never behind a
 * hover — and the wire's note, which is the drawer's.
 */
export interface ActivityLiquidation {
  readonly liquidator: string;
  readonly liquidatorHref: string;
  /** The repaid figure as liquidationRepaid decides it for both surfaces: exact decimals, the wire's raw digits, the unreadable word, or a dash. */
  readonly repaid: string;
  /**
   * What the figure is counted in: the Debt Manager's own USD, the legacy row's symbol (its debt asset shortened when
   * no symbol is carried, a dash when neither is), the raw-units tag beside unscaled digits; null beside a dash or the
   * unreadable word.
   */
  readonly repaidUnit: string | null;
  /** Every seizure leg as liquidationSeized says it, comma-joined; the no-legs statement when none was carried. */
  readonly seized: string;
  readonly bonusRealized: string;
  readonly bonusConfigured: string;
  /** The extract as one line, in the order the table prints it — every word from LIQUIDATION_WORDS. */
  readonly line: readonly LiquidationPart[];
  /** The wire's own note, every word kept and its markers read (inlineParts); empty when the wire carried none. */
  readonly note: readonly NotePart[];
}

export interface ActivityRow {
  /** The event's own chain coordinates (feedRowKey); the row's test id hangs on it. */
  readonly key: string;
  /** The untimed tail: a cross-engine row without custodied header time. */
  readonly dim: boolean;
  /** The custodied header time, zoneless (the column's header names the zone), or the block number when the time is null. */
  readonly when: string;
  /** The When cell's title: the wire's own ISO instant, or what the block number standing in means. */
  readonly whenTitle: string;
  readonly engine: string;
  /** The wire's display type: the tone's input and the printed word's title. */
  readonly type: EventDisplayType;
  /** The type in the page's words, sentence case (typeLabel). */
  readonly typeLabel: string;
  /** A key record (a liquidation, a bad-debt realization) is set apart by weight; every other record is plain. */
  readonly tone: "key" | "info";
  readonly account: string;
  /** The amount as far as its unit licenses, or a dash for a record with no amount. */
  readonly amount: string;
  /**
   * The raw-units tag when no scale placed the figure, set beside the digits in the Amount cell itself — one column
   * holds scaled and unscaled figures, so the word sits where the magnitude is read; null for a placed figure or a dash.
   */
  readonly amountTag: string | null;
  /** A null amount: the dash is a statement about the record, not a value, and the table sets it as one. */
  readonly recordOnly: boolean;
  /** The unit named beside the amount: the unit tag and the symbol (the raw word is the Amount cell's, said once) — or the record-only word. */
  readonly unit: string;
  /** What the unit is and what converting it would take; for a record-only row, what its dash means. */
  readonly unitTitle: string | null;
  /** The chain's explorer link for the transaction, or null when no explorer is configured for the chain. */
  readonly tx: string | null;
  readonly txLabel: string;
  /** The full hash with the row's chain coordinates (log always, block beside a time, seq when nonzero). */
  readonly txTitle: string;
  /** A liquidation's typed extract; null for every other type. */
  readonly detail: ActivityLiquidation | null;
}

/**
 * A tile: its label, its count and what the count is among — or, with no count to print, the register of the absence
 * (lib/kit STATE_REGISTERS) and the lib's own word for it where the register's word is not the right one.
 */
export interface ActivityTile {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly state: "refused" | "unavailable" | "unreadable" | "not-served" | null;
  readonly stateWord: string | null;
}

/** A page's missing exhibit, stated in its place: what is missing, why, the service's own words disclosed, the way forward. */
export interface ActivityStateCard {
  /** The absence's register (lib/kit STATE_REGISTERS): a refusal, a request that failed, or an answer the page could not read. */
  readonly state: "refused" | "unavailable" | "unreadable";
  readonly title: string;
  readonly cause: string;
  readonly serviceSaid: { readonly label: string; readonly text: string } | null;
  /** The one control's word: the restart, or the retry. */
  readonly action: string;
}

export interface ActivityView {
  readonly state: ActivityState;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: LabChip[];
  readonly tiles: { readonly liquidations: ActivityTile; readonly deficits: ActivityTile };
  readonly rows: readonly ActivityRow[];
  /** One engine chosen: its figures share one digit axis. Across engines the figures are a list, never one axis. */
  readonly alignAmounts: boolean;
  /** The table's word when it holds no row: the state's word, never a bare dash. */
  readonly emptyText: string;
  /** The list head's qualifier: the order, in six words at most. */
  readonly listQualifier: string;
  /** The page size the envelope echoed, said beside the next-page control; null before the envelope answers. */
  readonly pageSize: string | null;
  /** The untimed tail's notice when a cross-engine tail is loaded; null otherwise. */
  readonly tailNote: string | null;
  /** The footnote that says, once, why a marked bonus dash is not established; null when no loaded row prints one. */
  readonly bonusNote: string | null;
  readonly doctrine: readonly string[];
  /** The wire's liquidation notes, each distinct note once, verbatim: the drawer's. */
  readonly notes: readonly (readonly NotePart[])[];
  /** The ordering-drift alert when the wire served a timed row inside the untimed tail; null otherwise. */
  readonly drift: { readonly head: string; readonly body: string } | null;
  /** The refused page's card; null otherwise. */
  readonly refusal: ActivityStateCard | null;
  /** The failed fetch's card; null otherwise. */
  readonly failure: ActivityStateCard | null;
  /** An empty answer under a narrowing filter: the header offers to clear it. */
  readonly clearFilter: boolean;
  /**
   * What the foot offers: the next page, the end of the list, or nothing. A refused walk offers nothing here — its
   * cursor was refused, re-sending it can only be refused again, and the restart is the refusal card's.
   */
  readonly foot: "more" | "end" | "none";
}

/** The loading arm's dek: what will be here, before anything is counted. */
export const ACTIVITY_LOADING_DEK = "Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.";

/** The exhausted arm's dek with no filter narrowing the list: what fills the page. */
export const ACTIVITY_EXHAUSTED_DEK = "Actions appear here as the indexer records them.";

/** The drawer's word on an empty answer, while the list is empty: why it is not a load still to come. */
export const ACTIVITY_EMPTY_NOTE = "An empty list is the service's real answer for its filter, not a loading state.";

/** The exhausted arm's dek under a narrowing filter: the one way to see more. */
export const ACTIVITY_CLEAR_FILTER_DEK = "Clear the filter to see every recorded action.";

/** The header's control beside that dek. */
export const CLEAR_FILTER = "Clear filter";

/** The page's chrome, every word of it: what the components print between the view's figures. */
export const ACTIVITY_COPY = {
  drawer: "Methodology & evidence",
  engine: "Engine",
  view: "View",
  type: "Type",
  allActions: "All actions",
  ledger: "Liquidations ledger",
  sinceLabel: "Since block",
  sincePlaceholder: "Block number",
  apply: "Apply",
  notice: "Notice",
  loadMore: "Load more",
  loadingMore: "Loading…",
  liquidationsTile: "Liquidations",
} as const;

export const ACTIVITY_INTRO =
  "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the " +
  "stream's posture now; the list below pages through durable history. The two never blend.";

/** The paged record's own name: the live strip above it is the other instrument, so the two are never one blended stream. */
export const ACTIVITY_LIST_TITLE = "Recorded chain actions";

/** The When column's head: the zone is named once, here, so no cell repeats it. */
export const ACTIVITY_WHEN_HEADER = "When (UTC)";

/** The Amount column's head: the caveat sits where the number is read, because a bare integer reads as dollars. */
export const ACTIVITY_AMOUNT_HEADER = "Amount · engine units, not USD";

/** An untimed row's When title: the block number stands in for a time the chain has not been read for. */
export const UNTIMED_WHEN = "No block time yet: the block number stands in, never an invented time.";

export const ACTIVITY_FORENSICS =
  "The block_time field is chain-asserted header custody: null until custodied, in which case the block number " +
  "renders instead. A timestamp is never invented. Amounts are the engine's own accounting units, named per row, and " +
  "a scaled or normalized value is never dressed up as a token or USD figure.";

export const ACTIVITY_TAIL_NOTE =
  "The untimed tail: rows without custodied header time render dimmed, each showing its block number, after every " +
  "timed row, ordered by the chain-aware tiebreak (chain, height, tx, log, seq) instead of by time — the tail's " +
  "internal order is not chronology, and two chains' block heights are never compared as time.";

/** The tail's notice at the point of need: the service orders the tail by chain, then block number — never by time. */
export const ACTIVITY_TAIL_NOTICE =
  "Rows with no block time yet come last, listed by chain and then block number; that tail is not in time order.";

/** The same notice when the loaded tail does not show that order: only what the rows show is said. */
export const ACTIVITY_TAIL_NOTICE_UNORDERED = "Rows with no block time yet come last; that tail is not in time order.";

export const ACTIVITY_DRIFT = {
  head: "Ordering fault",
  body:
    "The service sent a timed row inside the untimed tail, which the ordering law forbids. Rows stay in wire order " +
    "(re-sorting would hide the service bug); treat this walk as suspect.",
} as const;

export const LEDGER_TYPES_NOTE = "The ledger view shows liquidations only; the type filter returns with all actions.";

/** The scope with no single engine chosen: the kicker and the engine switch say it in one word. */
export const ALL_ENGINES = "All engines";

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

/** The drawer's heading over the service's own liquidation notes. */
export const LIQUIDATION_NOTES_HEADING = "The service's notes on liquidations";

/** The disclosure's label over the service's verbatim words: relocated from the headline, never removed. */
export const SERVICE_SAID = "What the service said";

/** The mark on an unestablished bonus's dash, and the one footnote that explains it. */
export const BONUS_MARK = "†";

/** The chip that names what narrows the list, while something does. */
export const FILTER_LABEL = "Filter";

const ORDER_CROSS =
  "ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are " +
  "never compared across chains, and rows without header time follow in the disclosed untimed tail.";

/** The engine is named as a sentence names it — the product's word, never the wire's id. */
const orderScoped = (engine: string | null): string =>
  `ordered by block height (block, tx, log, seq) DESC, because heights are comparable within ${engine === null ? "one engine" : engineInProse(engine)}'s own chain.`;

/** The foot's word once the cursor is spent: one sentence, printed from here alone. */
export const END_OF_FEED = "End of the list.";

/** A sentence of its own: capitalised and terminated. */
function sentence(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  const ended = /[.!?…]$/.test(t) ? t : `${t}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/**
 * The block number the since-block control holds, grouped. One past the safe integers was already rounded when the
 * draft became a number, so it prints as that number's own digits, ungrouped — grouping would dress a rounded figure
 * as an exact one.
 */
export const typedBlock = (block: number): string => (Number.isSafeInteger(block) ? groupInt(block) : String(block));

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
  return `"${draft.slice(0, 32)}" is not a block number, so nothing was requested.`;
}

/**
 * The type vocabulary lives beside the headline that speaks it (the headline's module is this one's import, never the
 * reverse); the page's controls and cells read it from here.
 */
export { TYPE_WORDS, typeLabel, typeWord } from "./feed-view";

/**
 * What narrows the list, in the page's words, from the service's own echo: the types (the ledger view's pinned type is
 * that view's word, not a filter), an echoed account shortened, and the block bound grouped — each integer through the
 * population guard first. The engine is the kicker's and the page size is the foot's; neither narrows what a row IS.
 * Null when nothing narrows it.
 */
export function activeFilter(envelope: ActivityEnvelope, view: "all" | "ledger"): string | null {
  const { account, types, since_block: since } = envelope.filter;
  // The page size is guarded with the rest of the echo, though the chip does not print it: a malformed echo is refused whole.
  readWirePopulation(envelope.limit, "limit");
  const parts = [
    ...(view === "ledger" || types === null || types.length === 0 ? [] : [joinAnd(types.map(typeWord))]),
    ...(account === undefined || account === null ? [] : [`account ${truncateAddress(account)}`]),
    ...(since === null ? [] : [`from block ${groupInt(readWirePopulation(since, "since_block"))}`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The same, before the service has echoed anything: the page's own choice. */
function chosenFilter(input: ActivityInput): string | null {
  const parts = [
    ...(input.view === "ledger" || input.types.length === 0 ? [] : [joinAnd(input.types.map(typeWord))]),
    ...(input.sinceBlock === null ? [] : [`from block ${typedBlock(input.sinceBlock)}`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/** One engine's scale as a wire source states it. */
export interface EngineScale {
  readonly engine: string;
  readonly value_decimals: number;
}

/**
 * Each engine's `value_decimals`, FROM THE WIRE: the stream's aggregates where they describe an engine, `/v1/book`'s
 * beneath them for an engine the stream has not described — the same per-engine constant, published twice. The book
 * is judged whole before it is read (an answer that is not a book licenses nothing), and every scale passes the
 * scale guard: one it refuses licenses nothing. An engine with no licensed scale keeps its raw integers, tagged.
 */
export function activityScales(stream: readonly EngineScale[] | null, book: unknown): Readonly<Record<string, number>> {
  const scales: Record<string, number> = {};
  if (bookEnvelopeFault(book) === null) {
    for (const entry of (book as { readonly engines: readonly Readonly<Record<string, unknown>>[] }).engines) {
      const { engine, value_decimals: decimals } = entry;
      if (typeof engine === "string" && isWireScale(decimals)) scales[engine] = decimals;
    }
  }
  for (const { engine, value_decimals: decimals } of stream ?? []) {
    if (isWireScale(decimals)) scales[engine] = decimals;
  }
  return scales;
}

/** The wire's note as runs: a bold run's own code spans read in turn, so no marker prints and no word is lost. */
function noteParts(note: string): readonly NotePart[] {
  return inlineParts(note).map(
    (part): NotePart => (part.kind === "strong" ? { kind: "strong", parts: noteParts(part.text) } : { kind: part.kind, text: part.text }),
  );
}

/** A bonus as the extract prints it: a null one is the marked dash the footnote explains, never an estimate. */
const bonusFigure = (value: string | null): string => (value === null ? `${EM_DASH}${BONUS_MARK}` : renderBps(value));

/**
 * The typed extract as parts: liquidator, repaid debt, seized legs, both bonus figures, the wire's note. An
 * unestablished field is an em dash, never an estimate. The repaid figure and the seized legs are feed-view's, the
 * figures the Inspector's card prints too.
 */
function liquidationDetail(event: FeedChainEvent, detail: NonNullable<FeedChainEvent["liquidation"]>): ActivityLiquidation {
  const words = LIQUIDATION_WORDS;
  const repaid = liquidationRepaid(event, detail);
  const seized = liquidationSeized(detail);
  const bonusRealized = bonusFigure(detail.realized_bonus_bps);
  const bonusConfigured = bonusFigure(detail.configured_bonus_bps);
  const liquidatorHref = `/inspector/${detail.liquidator}`;
  const line: LiquidationPart[] = [
    { kind: "text", text: `${words.liquidator} ` },
    { kind: "liquidator", text: truncateAddress(detail.liquidator), href: liquidatorHref, title: detail.liquidator },
    { kind: "text", text: ` · ${words.repaid} ` },
    { kind: "figure", text: repaid.figure },
    ...(repaid.unit === null ? [] : [{ kind: "text", text: " " } as const, { kind: "unit", text: repaid.unit } as const]),
    { kind: "text", text: ` · ${words.seized} ` },
    { kind: "figure", text: seized },
    { kind: "text", text: ` · ${words.bonusRealized} ` },
    { kind: "figure", text: bonusRealized },
    { kind: "text", text: ` / ${words.bonusConfigured} ` },
    { kind: "figure", text: bonusConfigured },
  ];
  return {
    liquidator: detail.liquidator,
    liquidatorHref,
    repaid: repaid.figure,
    repaidUnit: repaid.unit,
    seized,
    bonusRealized,
    bonusConfigured,
    line,
    note: noteParts(detail.note),
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
  // A record with no amount: a dash where the figure would be, its word where the unit is named. The raw word is the
  // Amount cell's, beside the digits, so the unit cell never says it twice.
  const unit =
    amount.kind === "record-only"
      ? RECORD_ONLY_WORD
      : [amount.unitChip, amount.symbol].filter((part): part is string => part !== null).join(" · ");
  return {
    key: feedRowKey(event),
    dim: mode === "cross-engine" && event.block_time === null,
    when: renderBlockTime(event.block_number, event.block_time),
    whenTitle: event.block_time === null ? UNTIMED_WHEN : blockTimeTitle(event.block_number, event.block_time),
    engine: engineName(event.engine),
    type: event.type,
    typeLabel: typeLabel(event.type),
    tone: feedTagTone(event.type),
    account: event.account,
    amount: amount.kind === "record-only" ? EM_DASH : amount.display,
    amountTag: amount.kind === "amount" && amount.rawUnits ? RAW_UNITS_TAG : null,
    recordOnly: amount.kind === "record-only",
    unit,
    unitTitle: amount.kind === "record-only" ? RECORD_ONLY_TITLE : amount.unitTitle,
    tx: url,
    txLabel: shortHex(event.tx_hash),
    txTitle: `${event.tx_hash}${explorer} · ${coordinates}`,
    detail: event.liquidation === null ? null : liquidationDetail(event, event.liquidation),
  };
}

function activityState(input: ActivityInput): ActivityState {
  if (input.refusal !== null) return "refused";
  if (input.failure !== null) return "error";
  if (input.rows.length === 0) return input.hasMore ? "loading" : "exhausted";
  return "ok";
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
    { count: cash, name: engineInProse(CASH) },
    { count: legacy, name: engineInProse(LEGACY) },
    { count: n - cash - legacy, name: "an engine this page does not name" },
  ].filter((place) => place.count > 0);
  const only = places.length === 1 ? places[0] : undefined;
  if (only !== undefined) return n === 1 ? `It is on ${only.name}.` : `All ${groupInt(n)} are on ${only.name}.`;
  const clauses = places.map((place, i) => `${groupInt(place.count)} ${i === 0 ? `${isAre(place.count)} ` : ""}on ${place.name}`);
  return `${joinAnd(clauses)}.`;
}

/**
 * The answered page's dek: computed facts about the loaded rows, each sentence conditional on its own count — the
 * bad-debt realizations (only where the headline does not already count them: it names a lone row's type, and counts
 * realizations beside any liquidation), where the rows sit, and the untimed tail. Every number is counted here from
 * the rows. When none applies, the dek says how the list is ordered.
 */
function factDek(input: ActivityInput): string {
  const { rows, mode, engine } = input;
  const n = rows.length;
  const sentences: string[] = [];
  const deficits = rows.filter((event) => event.type === "deficit_created").length;
  const liquidations = rows.filter((event) => event.type === "liquidation").length;
  if (deficits > 0 && n > 1 && liquidations === 0) {
    // Its antecedent named: "of them" would read as a share of a count the headline never gave.
    sentences.push(`${groupInt(deficits)} of the ${groupInt(n)} loaded actions record${deficits === 1 ? "s" : ""} bad debt being realized.`);
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
  return `Listed newest first, by ${engine === null ? "block time" : `block number on ${engineInProse(engine)}'s chain`}.`;
}

/** Each display type as the noun an empty answer names it by, with its article. */
const TYPE_NOUNS: Readonly<Record<EventDisplayType, string>> = {
  borrow: "a borrow",
  repay: "a repay",
  supply: "a supply",
  withdraw: "a withdrawal",
  liquidation: "a liquidation",
  collateral_enabled: "a collateral-enabled action",
  collateral_disabled: "a collateral-disabled action",
  deficit_created: "a bad-debt realization",
};

const typeNoun = (type: string): string =>
  Object.hasOwn(TYPE_NOUNS, type) ? ((TYPE_NOUNS as Readonly<Record<string, string>>)[type] ?? type) : `a "${type}" action`;

/** "a borrow" · "a borrow or a repay" · "a borrow, a repay or a withdrawal". */
function joinOr(nouns: readonly string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? "";
  return `${nouns.slice(0, -1).join(", ")} or ${nouns[nouns.length - 1] ?? ""}`;
}

/** The filter an answer speaks for: its engine, its types (none = every type) and its block bound, grouped for prose. */
interface ListScope {
  readonly engine: string | null;
  readonly types: readonly string[];
  readonly since: string | null;
}

/**
 * The scope the list answers for, read from ONE source so the headline, the dek, the tiles and the clear-filter offer
 * never describe two scopes: the service's own echo of the filter it applied once it has answered (each integer
 * through the population guard), before that the page's own request. The controls keep showing the request.
 */
function listScope(input: ActivityInput): ListScope {
  const echo = input.envelope?.filter ?? null;
  if (echo === null) {
    return {
      engine: input.engine,
      types: input.view === "ledger" ? ["liquidation"] : input.types,
      since: input.sinceBlock === null ? null : typedBlock(input.sinceBlock),
    };
  }
  return {
    engine: echo.engine,
    types: echo.types ?? [],
    since: echo.since_block === null ? null : groupInt(readWirePopulation(echo.since_block, "since_block")),
  };
}

/** Whether anything narrows the list beyond every action of every engine. */
function narrowed(input: ActivityInput): boolean {
  const scope = listScope(input);
  return scope.engine !== null || scope.types.length > 0 || scope.since !== null;
}

/**
 * An empty answer, scoped to what it answers for: the engine, the block bound and the types — never an unscoped
 * negative. The empty page IS the service's answer for exactly the filter it echoed.
 */
function exhaustedSentence(input: ActivityInput): string {
  const { engine, types, since } = listScope(input);
  const where = [...(engine === null ? [] : [`on ${engineInProse(engine)}`]), ...(since === null ? [] : [`since block ${since}`])];
  const scope = where.length === 0 ? "" : ` ${where.join(" ")}`;
  if (types.length === 0) return `No chain action is recorded${scope}.`;
  return `No recorded chain action${scope} is ${joinOr(types.map(typeNoun))}.`;
}

/** The status the page may say at reader altitude: the one system token a failure keeps, in parentheses. */
function failureDek(failure: ActivityFailure, loaded: number): string {
  if (failure.unreadable === true) {
    return loaded === 0
      ? "The service answered, but the page could not read the answer, so no row of the list is shown."
      : "The service answered, but the page could not read the answer for the next page; the rows below were served before it.";
  }
  if (failure.status === null) {
    // With no status, where the request got to is not known — only that no response came back to the page.
    return loaded === 0
      ? "The page could not get a response from the service, so no row of the list is shown."
      : "The page could not get a response from the service for the next page; the rows below were served before it.";
  }
  const which = loaded === 0 ? "this page" : "the next page";
  const after = loaded === 0 ? ", so no row of it is shown." : "; the rows below were served before it.";
  return `The service did not return ${which} (HTTP ${String(failure.status)})${after}`;
}

function headlineFor(state: ActivityState, input: ActivityInput): LabHeadline {
  const n = input.rows.length;
  const after = `after ${plural(n, "chain action")} loaded.`;
  if (state === "refused") {
    return {
      emphasis: n === 0 ? "The service refused this page." : `The next page was refused, ${after}`,
      rest: "",
      tone: "refused",
      dek: `The service would not return ${n === 0 ? "this" : "the next"} page of the list. Start again from the newest actions.`,
    };
  }
  if (state === "error" && input.failure !== null) {
    const verb = input.failure.unreadable === true ? "read" : "fetched";
    return {
      emphasis: n === 0 ? `Recorded chain actions could not be ${verb}.` : `The next page could not be ${verb}, ${after}`,
      rest: "",
      tone: "absent",
      dek: failureDek(input.failure, n),
    };
  }
  if (state === "exhausted") {
    return { emphasis: exhaustedSentence(input), rest: "", tone: "neutral", dek: narrowed(input) ? ACTIVITY_CLEAR_FILTER_DEK : ACTIVITY_EXHAUSTED_DEK };
  }
  const takeaway = feedTakeaway(input.rows, input.mode, input.hasMore, {
    types: input.types,
    ledger: input.view === "ledger",
    servedAt: input.envelope?.served_at ?? null,
  });
  // Before the first page answers there is no answer yet, in the absent register; a loaded window is a record, and a record is ink.
  if (state === "loading") return { ...takeaway, tone: "absent", dek: ACTIVITY_LOADING_DEK };
  return { ...takeaway, tone: "neutral", dek: factDek(input) };
}

/** The card's sentence about the rows already on the page: they stand, or none was read. */
const cardCause = (loaded: number): string => (loaded === 0 ? "No row of the list was read." : "The rows below were served before it and still stand.");

function refusalCard(input: ActivityInput): ActivityStateCard | null {
  if (input.refusal === null) return null;
  return {
    state: "refused",
    title: "Page refused",
    cause: cardCause(input.rows.length),
    serviceSaid: input.refusal.message.trim() === "" ? null : { label: SERVICE_SAID, text: input.refusal.message },
    action: "Start from the newest",
  };
}

function failureCard(input: ActivityInput): ActivityStateCard | null {
  if (input.refusal !== null || input.failure === null) return null;
  const unreadable = input.failure.unreadable === true;
  return {
    state: unreadable ? "unreadable" : "unavailable",
    title: unreadable ? "Page unreadable" : "Page unavailable",
    cause: cardCause(input.rows.length),
    serviceSaid: input.failure.message.trim() === "" ? null : { label: SERVICE_SAID, text: input.failure.message },
    action: "Try again",
  };
}

/** Whether the list's scope admits a type: every type when none is named; the ledger admits liquidations alone. */
function admits(input: ActivityInput, type: EventDisplayType): boolean {
  const { types } = listScope(input);
  return types.length === 0 || types.includes(type);
}

function tileOf(label: string, type: EventDisplayType, state: ActivityState, input: ActivityInput): ActivityTile {
  const n = input.rows.length;
  const plain = { label, state: null, stateWord: null } as const;
  if (!admits(input, type)) return { label, value: "", sub: "The filter excludes it", state: "not-served", stateWord: "Filtered out" };
  if (n === 0) {
    // Nothing loaded is not zero: the tile states which absence it is — except an exhausted list, whose zero is true.
    if (state === "refused") return { ...plain, value: "", sub: "Nothing counted", state: "refused" };
    if (state === "error") {
      return input.failure?.unreadable === true
        ? { ...plain, value: "", sub: "This page could not be read", state: "unreadable" }
        : { ...plain, value: "", sub: "This page could not be fetched", state: "unavailable" };
    }
    if (state === "exhausted") return { ...plain, value: "0", sub: "No rows loaded" };
    return { ...plain, value: "", sub: "" };
  }
  const count = input.rows.filter((event) => event.type === type).length;
  return { ...plain, value: groupInt(count), sub: `among the ${groupInt(n)} loaded` };
}

/** The list head's qualifier: the order key in short form, or the order the service kept when it broke its own. */
function listQualifier(input: ActivityInput, drifted: boolean): string {
  if (drifted) return "In the order the service sent";
  return input.engine === null ? "Newest first · by block time" : "Newest first · by block number";
}

/**
 * The loaded rows' own count and where the cursor stands: more, the end, or a next page that was refused or could not
 * be fetched. Nothing is counted before the first page answers.
 */
function loadedChip(state: ActivityState, input: ActivityInput): LabChip[] {
  const n = input.rows.length;
  if (n === 0 && state !== "exhausted") return [];
  const where =
    state === "refused"
      ? "next page refused"
      : state === "error"
        ? input.failure?.unreadable === true
          ? "next page unreadable"
          : "next page unavailable"
        : input.hasMore
          ? "more available"
          : "end of the list";
  return [{ label: "Loaded", value: `${groupInt(n)} · ${where}` }];
}

/**
 * The bonus footnote, said once, for exactly the dashes the loaded rows print: each engine's own reason, as the
 * service states it — never an estimate, and never a reason that belongs to the other engine.
 */
function bonusNote(rows: readonly FeedChainEvent[]): string | null {
  const unset = rows.flatMap((event) => (event.liquidation === null ? [] : [{ engine: event.engine, detail: event.liquidation }]));
  const legacyRealized = unset.some((row) => row.engine === LEGACY && row.detail.realized_bonus_bps === null);
  const legacyConfigured = unset.some((row) => row.engine === LEGACY && row.detail.configured_bonus_bps === null);
  const cash = unset.some((row) => row.engine === CASH && (row.detail.realized_bonus_bps === null || row.detail.configured_bonus_bps === null));
  const other = [
    ...new Set(
      unset
        .filter((row) => row.engine !== CASH && row.engine !== LEGACY && (row.detail.realized_bonus_bps === null || row.detail.configured_bonus_bps === null))
        .map((row) => row.engine),
    ),
  ];
  const legacy =
    legacyRealized && legacyConfigured
      ? "on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read, and the configured bonus is not stated where the service holds no parameter record for the event's block"
      : legacyRealized
        ? "on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read"
        : legacyConfigured
          ? "on the legacy Aave v3 market the configured bonus is not stated where the service holds no parameter record for the event's block"
          : null;
  const clauses = [
    ...(legacy === null ? [] : [legacy]),
    ...(cash ? ["Cash records its bonuses in its own 100e18 denomination, not in basis points, so neither is converted"] : []),
    ...other.map((engine) => `${engine} states no bonus in basis points`),
  ];
  return clauses.length === 0 ? null : `${BONUS_MARK} Not established, so never estimated: ${clauses.join("; ")}.`;
}

/** Each distinct wire note once, in the order the rows first carry it. */
function distinctNotes(rows: readonly FeedChainEvent[]): readonly (readonly NotePart[])[] {
  const seen = new Set<string>();
  const notes: (readonly NotePart[])[] = [];
  for (const event of rows) {
    const note = event.liquidation?.note ?? "";
    if (note === "" || seen.has(note)) continue;
    seen.add(note);
    notes.push(noteParts(note));
  }
  return notes;
}

/** The table's word when it holds no row: the state's own word (lib/kit STATE_REGISTERS), never a bare dash. */
function emptyWord(state: ActivityState, failure: ActivityFailure | null): string {
  switch (state) {
    case "loading":
      return "Loading…";
    case "refused":
      return "Refused";
    case "error":
      return failure?.unreadable === true ? "Unreadable" : "Unavailable";
    case "exhausted":
    case "ok":
      return "No rows";
  }
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
      return hasBase ? { label: "Streaming", tone: "accent" } : { label: "Awaiting first batch", tone: "unknown" };
    case "idle":
    case "connecting":
      return { label: "Connecting", tone: "warn" };
    case "waiting":
      return { label: "Reconnecting", tone: "warn" };
    case "closed":
      return { label: "Closed", tone: "down" };
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
  const { rows, mode, engine, envelope, valueDecimals } = input;
  const state = activityState(input);
  const tail = mode === "cross-engine" ? splitUntimedTail(rows) : null;
  const drifted = tail !== null && tail.orderViolated;
  const newest = feedNewest(rows, mode);
  const reference = envelope?.served_at;
  // The headline's own instant in reader words; its exact layer, the wire's ISO, rides the title.
  const newestChip: LabChip[] =
    newest === null
      ? []
      : newest.kind === "time"
        ? [{ label: "Newest", value: humanUtc(newest.iso, reference), title: newest.iso }]
        : newest.kind === "block"
          ? [{ label: "Newest", value: `block ${formatBlock(newest.block)}` }]
          : [];
  const filter = envelope === null ? chosenFilter(input) : activeFilter(envelope, input.view);
  // The order key always stays: it is the one chip every state can state, so the header never names nothing.
  const chips: LabChip[] = [
    ...newestChip,
    { label: "Order", value: engine === null ? "by block time" : "by block number" },
    ...loadedChip(state, input),
    ...(filter === null ? [] : [{ label: FILTER_LABEL, value: filter }]),
  ];
  return {
    state,
    kicker: `Activity · ${engine === null ? ALL_ENGINES : engineName(engine)}`,
    headline: headlineFor(state, input),
    chips,
    tiles: {
      liquidations: tileOf(ACTIVITY_COPY.liquidationsTile, "liquidation", state, input),
      deficits: tileOf(typeLabel("deficit_created"), "deficit_created", state, input),
    },
    rows: rows.map((event) => activityRow(event, mode, valueDecimals)),
    alignAmounts: mode === "engine-scoped",
    emptyText: emptyWord(state, input.failure),
    listQualifier: listQualifier(input, drifted),
    pageSize: envelope === null ? null : `Loads ${groupInt(readWirePopulation(envelope.limit, "limit"))} at a time`,
    tailNote:
      tail === null || tail.untimed.length === 0 || drifted
        ? null
        : tailKeepsItsOrder(rows)
          ? ACTIVITY_TAIL_NOTICE
          : ACTIVITY_TAIL_NOTICE_UNORDERED,
    bonusNote: bonusNote(rows),
    // Sentences only: the list's TITLE is the list head's, never a paragraph here.
    doctrine: [
      ACTIVITY_INTRO,
      ACTIVITY_FORENSICS,
      ACTIVITY_TAIL_NOTE,
      sentence(mode === "cross-engine" ? ORDER_CROSS : orderScoped(engine)),
      ACTIVITY_SINCE_NOTE,
      ACTIVITY_LIVE_NOTE,
      ...(state === "exhausted" ? [ACTIVITY_EMPTY_NOTE] : []),
    ],
    notes: distinctNotes(rows),
    drift: drifted ? ACTIVITY_DRIFT : null,
    refusal: refusalCard(input),
    failure: failureCard(input),
    clearFilter: state === "exhausted" && narrowed(input),
    foot: state === "refused" ? "none" : input.hasMore ? "more" : "end",
  };
}
