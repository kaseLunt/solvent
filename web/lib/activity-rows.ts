// This account's chain actions as table rows (spec 2026-09-15 §5.3; plan 2
// ruling R12). Times are custodied header times or nothing — a null
// block_time renders the block number, never an invented clock. Amounts speak
// the feed's own accounting vocabulary (lib/feed-view.ts).
import { feedAmount } from "./feed-view";
import { renderBlockTime, truncateAddress } from "./format";
import { humanAmount } from "./human-price";
import { txExplorerUrl, type ChainEvent, type EventDisplayType } from "./inspector-data";
import { CASH } from "./inspector-position";
import { isWireDecimal, isWireScale } from "./wireGuard";

const ACTION_LABEL: Record<EventDisplayType, string> = {
  borrow: "Borrow",
  repay: "Repay",
  supply: "Supply",
  withdraw: "Withdraw",
  liquidation: "Liquidation",
  collateral_enabled: "Collateral enabled",
  collateral_disabled: "Collateral disabled",
  deficit_created: "Deficit created",
};

export function actionLabel(type: string): string {
  return (ACTION_LABEL as Record<string, string | undefined>)[type] ?? type;
}

export interface ActivityRow {
  readonly key: string;
  readonly when: string;
  readonly timed: boolean;
  readonly action: string;
  /** The engine's own event word (`raw_type`), verbatim, for the hover; the visible label comes from `type`. */
  readonly actionTitle: string;
  readonly asset: string;
  readonly amount: string;
  readonly amountTitle: string | null;
  /** The feed's unit chip beside the value; null for a record-only row or the plain asset-units path. */
  readonly unitChip: string | null;
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
      amount: amount.kind === "record-only" ? "—" : `${amount.display}${amount.symbol === null ? "" : ` ${amount.symbol}`}`,
      amountTitle: amount.kind === "record-only" ? "record only: this event carries no amount" : (amount.unitTitle ?? amount.unitChip),
      unitChip: amount.kind === "record-only" ? null : amount.unitChip,
      rawUnits: amount.kind === "record-only" ? false : amount.rawUnits,
      tx: { hash: event.tx_hash, short: shortHash(event.tx_hash), url: txExplorerUrl(event.chain_id, event.tx_hash) },
      detail: liquidationDetail(event),
    };
  });
}

/**
 * The activity section's takeaway: the feed orders CUSTODIED header
 * times newest-first, but null-time rows form a deterministic untimed TAIL
 * whose internal order is explicitly not chronology — so "newest first" may
 * only be claimed over the rows that carry a time. An untimed row read as
 * "older" is a wrong answer; this sentence refuses to license that reading.
 */
export function activityTakeaway(timed: number, untimed: number, hasMore: boolean): string {
  const total = timed + untimed;
  const more = hasMore ? " · more exist behind the cursor" : "";
  if (untimed === 0) {
    return `${String(total)} custodied action(s) loaded for this account, newest first${more}.`;
  }
  if (timed === 0) {
    return (
      `${String(total)} custodied action(s) loaded for this account, none with a custodied ` +
      `header time — their order is not chronology${more}.`
    );
  }
  return (
    `${String(total)} custodied action(s) loaded for this account: ${String(timed)} with ` +
    `custodied header time, newest first; ${String(untimed)} untimed row(s) follow, in an ` +
    `order that is not chronology${more}.`
  );
}
