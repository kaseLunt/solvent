// This account's chain actions as table rows (spec 2026-09-15 §5.3; plan 2
// ruling R12). Times are custodied header times or nothing — a null
// block_time renders the block number, never an invented clock. Amounts speak
// the feed's own accounting vocabulary (lib/feed-view.ts), in the Activity
// page's order: the figure, then what it is counted in.
import { EVENT_DISPLAY_TYPES } from "./feed-data";
import { RECORD_ONLY_TITLE, RECORD_ONLY_WORD, feedAmount, typeLabel } from "./feed-view";
import { renderBlockTime, truncateAddress } from "./format";
import { humanAmount } from "./human-price";
import { txExplorerUrl, type ChainEvent } from "./inspector-data";
import { CASH } from "./inspector-position";
import { groupInt, plural } from "./prose";
import { isWireDecimal, isWireScale } from "./wireGuard";

/**
 * An action as this card heads its row: the Activity page's word for the same wire type, sentence-cased — one
 * vocabulary on both surfaces. A type outside the contract's vocabulary prints as the wire sent it, never guessed at.
 */
export function actionLabel(type: string): string {
  if (!(EVENT_DISPLAY_TYPES as readonly string[]).includes(type)) return type;
  const words = typeLabel(type);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export interface ActivityRow {
  readonly key: string;
  readonly when: string;
  readonly timed: boolean;
  readonly action: string;
  /** The engine's own event word (`raw_type`), verbatim, for the hover; the visible label comes from `type`. */
  readonly actionTitle: string;
  readonly asset: string;
  /** The figure alone — never followed by a symbol, which would read a normalized or scaled value as a token amount — or a dash for a record with no amount. */
  readonly amount: string;
  readonly amountTitle: string | null;
  /**
   * What the figure is counted in, in the Activity page's order and set off from the figure by the page's separator:
   * the feed's unit words then the symbol ("· normalized debt · USDC", so the cell reads "622 · normalized debt ·
   * USDC"), or the record-only word beside a dash, which is not a figure and takes none.
   */
  readonly unit: string;
  /** True when `amount` is the wire's raw integer because no scale was licensed — the renderer tags it visibly. */
  readonly rawUnits: boolean;
  readonly tx: { hash: string; short: string; url: string | null };
  readonly detail: string | null;
}

/** Each engine's own value scale, FROM THE WIRE (the position's `value_decimals`) — never hardcoded here. */
export interface ActivityScale {
  readonly valueDecimalsByEngine?: Readonly<Record<string, number>>;
}

const RAW = "(raw units)";

/**
 * A payload amount in its asset's own decimals. Three distinct statements,
 * never blurred: a null value is "—" (not established); a value that is not
 * a wire decimal is "unreadable" (the repo's word for a malformed wire scalar
 * — its bytes are never printed as a figure); a readable value with no
 * licensed scale prints raw and says so. Never a throw on a bad scale.
 */
function payloadAmount(value: string | null, decimals: number | null): string {
  if (value === null) return "—";
  if (!isWireDecimal(value)) return "unreadable";
  if (!isWireScale(decimals)) return `${value} ${RAW}`;
  return humanAmount(BigInt(value), decimals);
}

function liquidationDetail(event: ChainEvent): string | null {
  const l = event.liquidation;
  if (l === null) return null;
  const repaid = payloadAmount(l.debt_repaid, l.debt_decimals);
  // The Debt Manager's repaid figure is its own USD unit, not a token amount; other engines name the token
  // (`debt_asset` is nullable on the wire; a row with neither symbol nor asset names the debt with a dash).
  const debtUnit = event.engine === CASH ? "USD" : (event.symbol ?? (l.debt_asset === null ? "—" : truncateAddress(l.debt_asset)));
  // An empty seizure list is an unestablished field, stated in the Feed's words — never a silent omission.
  const seized =
    l.seized.length === 0
      ? "— (no seizure legs carried)"
      : l.seized.map((s) => `${payloadAmount(s.amount, s.decimals)} ${s.symbol ?? truncateAddress(s.asset)}`).join(", ");
  return `liquidator ${truncateAddress(l.liquidator)} repaid ${repaid} ${debtUnit}; seized ${seized}`;
}

/** A figure's unit words, set off from the figure by the separator; nothing to name is nothing printed. */
function unitWords(parts: readonly (string | null)[]): string {
  const words = parts.filter((part): part is string => part !== null).join(" · ");
  return words === "" ? "" : `· ${words}`;
}

/** The first ten characters; the ellipsis appears only when something was actually cut. */
const shortHash = (hash: string): string => (hash.length > 10 ? `${hash.slice(0, 10)}…` : hash);

export function activityRows(events: readonly ChainEvent[], scale?: ActivityScale): ActivityRow[] {
  return events.map((event) => {
    const amount = feedAmount(event, { engineValueDecimals: scale?.valueDecimalsByEngine?.[event.engine] ?? null });
    return {
      key: `${event.tx_hash}:${String(event.log_index)}:${String(event.seq)}`,
      when: renderBlockTime(event.block_number, event.block_time), // "block 155,315,000" when the header time is not custodied
      timed: event.block_time !== null,
      action: actionLabel(event.type),
      actionTitle: event.raw_type,
      asset: event.symbol ?? (event.asset === null ? "—" : truncateAddress(event.asset)),
      amount: amount.kind === "record-only" ? "—" : amount.display,
      amountTitle: amount.kind === "record-only" ? RECORD_ONLY_TITLE : (amount.unitTitle ?? amount.unitChip),
      unit: amount.kind === "record-only" ? RECORD_ONLY_WORD : unitWords([amount.unitChip, amount.symbol]),
      rawUnits: amount.kind === "record-only" ? false : amount.rawUnits,
      tx: { hash: event.tx_hash, short: shortHash(event.tx_hash), url: txExplorerUrl(event.chain_id, event.tx_hash) },
      detail: liquidationDetail(event),
    };
  });
}

/**
 * The card's qualifier, in the Activity page's words for the same rows: they are chain actions, listed newest first
 * by block time. The builder's custody vocabulary stays in the code; a reader sees the page's one vocabulary.
 */
export const ACTIVITY_CARD_QUALIFIER = "this account's chain actions · newest first, by block time";

/** An untimed row's hover: its block has no block time yet, so the block number stands in — never an invented clock. */
export const UNTIMED_WHEN_TITLE = "no block time yet — the block number stands in";

/**
 * The activity section's takeaway: the feed orders CUSTODIED header
 * times newest-first, but null-time rows form a deterministic untimed TAIL
 * whose internal order is explicitly not chronology — so "newest first" may
 * only be claimed over the rows that carry a time. An untimed row read as
 * "older" is a wrong answer; this sentence refuses to license that reading.
 * It speaks the Activity page's words: chain actions, and a block time.
 */
export function activityTakeaway(timed: number, untimed: number, hasMore: boolean): string {
  const total = timed + untimed;
  const more = hasMore ? " · more exist behind the cursor" : "";
  const loaded = `${plural(total, "chain action")} loaded for this account`;
  if (untimed === 0) {
    return `${loaded}, newest first${more}.`;
  }
  if (timed === 0) {
    return `${loaded}, none with a block time yet — their order is not chronology${more}.`;
  }
  return (
    `${loaded}: ${groupInt(timed)} with a block time, newest first; ${plural(untimed, "untimed row")} ` +
    `${untimed === 1 ? "follows" : "follow"}, in an order that is not chronology${more}.`
  );
}

/** The table's words when it holds no rows: the load phase, then a failure in its own words, then the proven-empty sentence. */
export function activityEmptyText(loading: boolean, error: Error | null): string {
  if (loading) return "Loading activity…";
  if (error !== null) return `Activity unavailable: ${error.message}`;
  return "No chain actions for this account.";
}

/**
 * A page fetch that failed beside rows already loaded. The rows stand — each answered for itself — and the failure
 * is stated on its own line in its own words; it is never folded into the table's empty words, which print only
 * when there are no rows to show, so a refused "Load more" would otherwise vanish.
 */
export function activityFailureText(error: Error): string {
  return `More activity could not be loaded: ${error.message}. The rows above stand; nothing beyond them was read.`;
}
