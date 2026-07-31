"use client";

// ADDRESS ACTIVITY (spec §3.2): the account's own durable chain actions from
// GET /v1/events?account= — custodied events, never invented. Block-time
// honesty: a null block_time renders the BLOCK NUMBER (renderBlockTime),
// never an invented or interpolated timestamp.

import { EngineChip } from "@/components/EngineChip";
import { AddressMono } from "@/components/AddressMono";
import { EM_DASH, formatBlock, renderBlockTime, renderNullableDecimal } from "@/lib/format";
import { txExplorerUrl, type ChainEvent } from "@/lib/inspector-data";
import styles from "../inspector.module.css";

export interface InspectorActivityProps {
  events: readonly ChainEvent[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  onLoadMore: () => void;
}

function amountLabel(event: ChainEvent): string {
  if (event.amount === null) return "record-only";
  const amount = renderNullableDecimal(event.amount, {
    decimals: event.amount_decimals ?? undefined,
  });
  return `${amount} ${event.symbol ?? ""}`.trim();
}

function TxLink({ event }: { event: ChainEvent }) {
  const short = `${event.tx_hash.slice(0, 10)}…`;
  const url = txExplorerUrl(event.chain_id, event.tx_hash);
  if (url === null) {
    return (
      <span className={styles.txLink} title={`${event.tx_hash} (no explorer configured for chain ${String(event.chain_id)})`}>
        {short}
      </span>
    );
  }
  return (
    <a className={styles.txLink} href={url} target="_blank" rel="noopener noreferrer" title={event.tx_hash}>
      {short} ↗
    </a>
  );
}

function LiquidationExtract({ event }: { event: ChainEvent }) {
  const detail = event.liquidation;
  if (detail === null) return null;
  const repaid =
    detail.debt_repaid === null
      ? EM_DASH
      : renderNullableDecimal(detail.debt_repaid, {
          decimals: detail.debt_decimals ?? undefined,
        });
  return (
    <span className="mono dim">
      liquidator <AddressMono address={detail.liquidator} copy={false} /> · repaid {repaid} · seized{" "}
      {detail.seized.length === 0
        ? EM_DASH
        : detail.seized
            .map(
              (s) => `${renderNullableDecimal(s.amount, { decimals: s.decimals })} ${s.symbol ?? s.asset.slice(0, 8)}`,
            )
            .join(", ")}{" "}
      · bonus {detail.realized_bonus_bps ?? EM_DASH}/{detail.configured_bonus_bps ?? EM_DASH} bps
    </span>
  );
}

export function InspectorActivity({ events, loading, error, hasMore, onLoadMore }: InspectorActivityProps) {
  return (
    <section data-testid="address-activity">
      <div className={styles.sectionHead}>Address activity — durable chain actions (this account)</div>

      {events.length === 0 && !loading && error === null && (
        <p className="mono dim">no custodied chain actions for this account in the feed.</p>
      )}

      {events.length > 0 && (
        <div className={styles.feed}>
          {events.map((event) => (
            <div
              className={styles.feedItem}
              key={`${String(event.chain_id)}·${event.tx_hash}·${String(event.log_index)}·${String(event.seq)}`}
              data-testid="activity-row"
            >
              <span className={styles.feedTime} data-testid="activity-time">
                {renderBlockTime(event.block_number, event.block_time)}
              </span>
              <span className={`${styles.feedTag} ${event.type === "liquidation" ? styles.tagCrit : styles.tagInfo}`}>
                {event.type}
              </span>
              <span className={styles.feedBody}>
                <b>{amountLabel(event)}</b>
                <EngineChip engine={event.engine} />
                <span className="mono dim">
                  {event.block_time === null ? "" : `block ${formatBlock(event.block_number)} · `}
                  log {String(event.log_index)}
                </span>
                <TxLink event={event} />
                <LiquidationExtract event={event} />
              </span>
            </div>
          ))}
        </div>
      )}

      {error !== null && (
        <p className={styles.refusal} role="alert">
          activity unavailable — {error.message}
        </p>
      )}
      {loading && <p className="mono dim">loading activity…</p>}
      {hasMore && !loading && events.length > 0 && (
        <button type="button" className={styles.loadMore} onClick={onLoadMore}>
          load more
        </button>
      )}
      <p className={styles.sectionNote}>
        block_time is chain-asserted header custody — null until custodied, in which case the block
        number renders instead; a timestamp is never invented.
      </p>
    </section>
  );
}
