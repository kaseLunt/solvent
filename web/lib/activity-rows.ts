// This account's chain actions as table rows (spec 2026-09-15 §5.3; plan 2
// ruling R12). Times are custodied header times or nothing — a null
// block_time renders the block number, never an invented clock. Amounts speak
// the feed's own accounting vocabulary (lib/feed-view.ts).
import { feedAmount } from "./feed-view";
import { renderBlockTime, truncateAddress } from "./format";
import { humanAmount } from "./human-price";
import { txExplorerUrl, type ChainEvent, type EventDisplayType } from "./inspector-data";
import { isWireDecimal } from "./wireGuard";

export const ACTION_LABEL: Record<EventDisplayType, string> = {
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
  readonly asset: string;
  readonly amount: string;
  readonly amountTitle: string | null;
  readonly tx: { hash: string; short: string; url: string | null };
  readonly detail: string | null;
}

const tokenAmount = (value: string | null, decimals: number | null): string | null =>
  value !== null && decimals !== null && isWireDecimal(value) ? humanAmount(BigInt(value), decimals) : null;

function liquidationDetail(event: ChainEvent): string | null {
  const l = event.liquidation;
  if (l === null) return null;
  const repaid = tokenAmount(l.debt_repaid, l.debt_decimals);
  // `debt_asset` is nullable on the wire; a row with neither symbol nor asset names the debt with a dash.
  const debtSymbol = event.symbol ?? (l.debt_asset === null ? "—" : truncateAddress(l.debt_asset));
  const seized = l.seized
    .map((s) => `${tokenAmount(s.amount, s.decimals) ?? "—"} ${s.symbol ?? truncateAddress(s.asset)}`)
    .join(", ");
  return `liquidator ${truncateAddress(l.liquidator)} repaid ${repaid ?? "—"} ${debtSymbol}${seized === "" ? "" : `; seized ${seized}`}`;
}

export function activityRows(events: readonly ChainEvent[]): ActivityRow[] {
  return events.map((event) => {
    const amount = feedAmount(event);
    return {
      key: `${event.tx_hash}:${String(event.log_index)}:${String(event.seq)}`,
      when: renderBlockTime(event.block_number, event.block_time), // "block 155,315,000" when the header time is not custodied
      timed: event.block_time !== null,
      action: actionLabel(event.type),
      asset: event.symbol ?? (event.asset === null ? "—" : truncateAddress(event.asset)),
      amount: amount.kind === "record-only" ? "—" : `${amount.display}${amount.symbol === null ? "" : ` ${amount.symbol}`}`,
      amountTitle: amount.kind === "record-only" ? "record only: this event carries no amount" : (amount.unitTitle ?? amount.unitChip),
      tx: { hash: event.tx_hash, short: `${event.tx_hash.slice(0, 10)}…`, url: txExplorerUrl(event.chain_id, event.tx_hash) },
      detail: liquidationDetail(event),
    };
  });
}

/**
 * The activity section's takeaway (r74): the feed orders CUSTODIED header
 * times newest-first, but null-time rows form a deterministic untimed TAIL
 * whose internal order is explicitly not chronology — so "newest first" may
 * only be claimed over the rows that carry a time.
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
