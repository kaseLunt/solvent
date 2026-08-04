"use client";

// The durable feed list (W5): custodied chain actions in WIRE ORDER — the
// service orders, the UI discloses. Two ordering regimes (AMENDMENT 1):
//
//   engine-scoped — (block, tx, log, seq) DESC within one chain;
//   cross-engine  — block_time DESC, then the DISCLOSED untimed tail
//                   (rows without custodied header time, ordered by the
//                   chain-aware tiebreak alone). The divider between the two
//                   sections is rendered, not implied; a timestamp is never
//                   invented for a tail row (block-number fallback per row).
//
// Liquidation rows open their typed extract (seized legs, repaid debt,
// realized vs configured bonus) — every unestablished field is an em dash,
// never an estimate.

import { useState } from "react";
import { AddressMono } from "@/components/AddressMono";
import { EngineChip } from "@/components/EngineChip";
import { EM_DASH, formatBlock, renderBlockTime, renderNullableDecimal } from "@/lib/format";
import { groupDecimalString } from "@/lib/book-format";
import {
  splitUntimedTail,
  txExplorerUrl,
  type FeedChainEvent,
  type FeedOrderMode,
} from "@/lib/feed-data";
import { RAW_UNITS_TAG, feedAmount, feedRowKey, feedTagTone, renderBps } from "@/lib/feed-view";
import styles from "./feed.module.css";

export interface FeedListProps {
  events: readonly FeedChainEvent[];
  mode: FeedOrderMode;
  /** Ledger view: liquidation extracts open by default. */
  ledger: boolean;
  /** Shown when `events` is empty — the reason, never silence. */
  empty: string;
  /**
   * Wave R1 item 4: each engine's `value_decimals` AS THE WIRE SERVED THEM
   * (the SSE snapshot's aggregates). An engine absent from this map has no
   * licensed scale and its amounts render raw, tagged — never guessed.
   */
  valueDecimals?: Readonly<Record<string, number>>;
}

function TxLink({ event }: { event: FeedChainEvent }) {
  const short = `${event.tx_hash.slice(0, 10)}…`;
  const url = txExplorerUrl(event.chain_id, event.tx_hash);
  if (url === null) {
    return (
      <span
        className={styles.txLink}
        title={`${event.tx_hash} (no explorer configured for chain ${String(event.chain_id)})`}
      >
        {short}
      </span>
    );
  }
  return (
    <a
      className={styles.txLink}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={event.tx_hash}
    >
      {short} ↗
    </a>
  );
}

function Amount({
  event,
  valueDecimals,
}: {
  event: FeedChainEvent;
  valueDecimals: number | null;
}) {
  const amount = feedAmount(event, { engineValueDecimals: valueDecimals });
  if (amount.kind === "record-only") {
    return <span className="dim">record-only</span>;
  }
  return (
    <>
      <b data-testid="feed-amount">{amount.display}</b>
      {amount.unitChip !== null && (
        <span
          className={styles.unitChip}
          data-testid="feed-amount-unit"
          title={amount.unitTitle ?? undefined}
        >
          {amount.unitChip}
        </span>
      )}
      {/* Wave R1 item 4: an unscaled integer NEVER renders bare — the reader
          must be able to tell "no scale was licensed" from "the scale is
          1". */}
      {amount.rawUnits && (
        <span
          className={styles.unitChip}
          data-testid="feed-amount-raw"
          title={amount.unitTitle ?? undefined}
        >
          {RAW_UNITS_TAG}
        </span>
      )}
      {amount.symbol !== null && <span className="mono dim">{amount.symbol}</span>}
    </>
  );
}

function LiquidationDetail({ event }: { event: FeedChainEvent }) {
  const detail = event.liquidation;
  if (detail === null) return null;
  return (
    <div className={styles.detail} data-testid="liquidation-detail">
      <span className={styles.detailRow}>
        liquidator <AddressMono address={detail.liquidator} href={`/inspector/${detail.liquidator}`} copy={false} />
      </span>
      <span className={styles.detailRow}>
        debt repaid{" "}
        <b>
          {detail.debt_repaid === null
            ? EM_DASH
            : groupDecimalString(
                renderNullableDecimal(detail.debt_repaid, {
                  decimals: detail.debt_decimals ?? undefined,
                }),
              )}
        </b>
        {detail.debt_asset !== null && (
          <span className="dim" title={detail.debt_asset}>
            {detail.debt_asset.slice(0, 10)}…
          </span>
        )}
      </span>
      <span className={styles.detailRow} data-testid="liquidation-seized">
        seized{" "}
        {detail.seized.length === 0 ? (
          <span className="dim">{EM_DASH} (no seizure legs carried)</span>
        ) : (
          detail.seized.map((leg) => (
            <b key={leg.asset}>
              {groupDecimalString(renderNullableDecimal(leg.amount, { decimals: leg.decimals }))}{" "}
              {leg.symbol ?? `${leg.asset.slice(0, 8)}…`}
            </b>
          ))
        )}
      </span>
      <span
        className={styles.detailRow}
        data-testid="liquidation-bonus"
        title="an unestablished bonus renders as an em dash, never as an estimate"
      >
        bonus realized <b>{renderBps(detail.realized_bonus_bps)}</b> / configured{" "}
        <b>{renderBps(detail.configured_bonus_bps)}</b>
      </span>
      <span className={styles.detailNote}>{detail.note}</span>
    </div>
  );
}

function FeedRow({
  event,
  ledger,
  valueDecimals,
}: {
  event: FeedChainEvent;
  ledger: boolean;
  valueDecimals: number | null;
}) {
  const [open, setOpen] = useState(ledger);
  const tone = feedTagTone(event.type);
  const hasDetail = event.liquidation !== null;
  return (
    <div className={styles.feedItem} data-testid="feed-row">
      <span className={styles.feedTime} data-testid="feed-time">
        {renderBlockTime(event.block_number, event.block_time)}
      </span>
      <span className={`${styles.feedTag} ${tone === "crit" ? styles.tagCrit : styles.tagInfo}`}>
        {event.type}
      </span>
      <span className={styles.feedBody}>
        <Amount event={event} valueDecimals={valueDecimals} />
        <AddressMono address={event.account} href={`/inspector/${event.account}`} copy={false} />
        <EngineChip engine={event.engine} />
        <span className="mono dim">
          {event.block_time === null ? "" : `block ${formatBlock(event.block_number)} · `}
          log {String(event.log_index)}
          {event.seq !== 0 && ` · seq ${String(event.seq)}`}
        </span>
        <TxLink event={event} />
        {hasDetail && (
          <button
            type="button"
            className={styles.detailToggle}
            data-testid="detail-toggle"
            aria-expanded={open}
            onClick={() => {
              setOpen((previous) => !previous);
            }}
          >
            {open ? "close detail" : "detail"}
          </button>
        )}
        {hasDetail && open && <LiquidationDetail event={event} />}
      </span>
    </div>
  );
}

export function FeedList({ events, mode, ledger, empty, valueDecimals = {} }: FeedListProps) {
  const decimalsFor = (engine: string): number | null => valueDecimals[engine] ?? null;
  if (events.length === 0) {
    return (
      <div className={styles.feed}>
        <div className={styles.emptyReason} data-testid="feed-empty">
          {empty}
        </div>
      </div>
    );
  }

  if (mode === "engine-scoped") {
    // One chain: heights ARE the order; a null block_time is just a null
    // time (block-number fallback per row), not a tail.
    return (
      <div className={styles.feed}>
        {events.map((event) => (
          <FeedRow
            key={feedRowKey(event)}
            event={event}
            ledger={ledger}
            valueDecimals={decimalsFor(event.engine)}
          />
        ))}
      </div>
    );
  }

  const { timed, untimed, orderViolated } = splitUntimedTail(events);
  return (
    <div className={styles.feed}>
      {timed.map((event) => (
        <FeedRow
            key={feedRowKey(event)}
            event={event}
            ledger={ledger}
            valueDecimals={decimalsFor(event.engine)}
          />
      ))}
      {untimed.length > 0 && (
        <>
          <div className={styles.untimedDivider} data-testid="untimed-divider">
            <b>UNTIMED TAIL</b> · {String(untimed.length)} row
            {untimed.length === 1 ? "" : "s"} without custodied header time, served after every
            timed row and ordered by the chain-aware tiebreak (chain, height, tx, log, seq)
            instead of by time. A timestamp is never invented; each row shows its block number.
          </div>
          {orderViolated && (
            <div className={styles.untimedDivider} role="alert" data-testid="untimed-order-violation">
              <b>ORDERING DRIFT</b> · the wire served a TIMED row inside the untimed tail, which
              the ordering law forbids. Rows stay in wire order (re-sorting would hide the
              service bug); treat this walk as suspect.
            </div>
          )}
          {untimed.map((event) => (
            <FeedRow
            key={feedRowKey(event)}
            event={event}
            ledger={ledger}
            valueDecimals={decimalsFor(event.engine)}
          />
          ))}
        </>
      )}
    </div>
  );
}
