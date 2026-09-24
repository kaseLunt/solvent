import Link from "next/link";
import { Fragment } from "react";
import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ACTIVITY_AMOUNT_HEADER, type ActivityLiquidation, type ActivityRow, type NotePart } from "@/lib/activity-view";
import { truncateAddress } from "@/lib/format";
import styles from "./activity.module.css";

/** The wire's note with its markers read: code as code, bold as bold, every word as it came. */
function NoteText({ parts }: { parts: readonly NotePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <code key={index}>{part.text}</code>
        ) : part.kind === "strong" ? (
          <strong key={index}>
            <NoteText parts={part.parts} />
          </strong>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The liquidation's typed extract, visible beneath the pill in every view: the liquidator opens the Inspector, the
 * amounts are the extract's own, an unestablished bonus is the em dash the lib gave it — never behind a fold or a
 * hover. The wire's note is the one sentence that says what a dash here means, so it is page text too — a title
 * is out of reach of a keyboard and of a touch screen. In the untimed tail the extract dims with its row.
 */
function LiquidationLine({ detail, dim }: { detail: ActivityLiquidation; dim: boolean }) {
  return (
    <span className={dim ? `${styles.detail} ${styles.detailDim}` : styles.detail} data-testid="activity-liquidation">
      {detail.line.map((part, index) =>
        part.kind === "liquidator" ? (
          <Link key={index} href={part.href} className={kit.addr} title={part.title} data-testid="activity-liquidator">
            {part.text}
          </Link>
        ) : part.kind === "figure" ? (
          <b key={index}>{part.text}</b>
        ) : part.kind === "unit" ? (
          <span key={index} className={kit.dim}>
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
      {detail.note.length > 0 && (
        <span className={styles.detailNote} data-testid="activity-liquidation-note">
          <NoteText parts={detail.note} />
        </span>
      )}
    </span>
  );
}

const COLUMNS: KitColumn[] = [
  { key: "when", header: "When" },
  { key: "engine", header: "Engine" },
  { key: "type", header: "Type" },
  { key: "account", header: "Account" },
  { key: "amount", header: ACTIVITY_AMOUNT_HEADER, align: "right" },
  { key: "unit", header: "Unit" },
  { key: "tx", header: "Tx" },
];

/**
 * The paged record as the kit's table: every loaded row in WIRE ORDER (the service orders, the page discloses),
 * the untimed tail dim with its block number where the time would be, the type in the page's words with the wire's
 * word as its title, a liquidation's pill crit with its typed extract visible beneath it, the account opening the
 * Inspector, the amount in its right-aligned column — placed only by a scale the wire licensed, otherwise the wire's
 * integer verbatim with the raw word beside it in the same cell, so an unscaled figure is never read against a
 * scaled one — with its unit named in the quiet column beside it, the tx on its chain's explorer. A record-only
 * row's dash is a statement, not a value, and is set as one; its word stands in the unit column. Every cell is the
 * view model's word; nothing is decided here.
 */
export function ActivityTable({ rows, emptyText }: { rows: readonly ActivityRow[]; emptyText: string }) {
  const kitRows: KitRow[] = rows.map((row) => ({
    key: row.key,
    testId: `activity-row-${row.key}`,
    dim: row.dim,
    cells: {
      when: <span className={kit.addr}>{row.when}</span>,
      engine: row.engine,
      type: (
        <>
          {row.tone === "crit" ? (
            <StatusPill tone="crit" title={row.type}>
              {row.typeLabel}
            </StatusPill>
          ) : (
            <span className={styles.type} title={row.type}>
              {row.typeLabel}
            </span>
          )}
          {row.detail !== null && <LiquidationLine detail={row.detail} dim={row.dim} />}
        </>
      ),
      account: (
        <Link href={`/inspector/${row.account}`} className={kit.addr} title={row.account} data-testid="activity-account">
          {truncateAddress(row.account)}
        </Link>
      ),
      amount: (
        <>
          <span className={row.recordOnly ? kit.sub : kit.addr} data-testid="activity-amount">
            {row.amount}
          </span>
          {row.amountTag !== null && (
            <>
              {" "}
              <span className={styles.amountTag} data-testid="activity-amount-tag">
                {row.amountTag}
              </span>
            </>
          )}
        </>
      ),
      unit:
        row.unit === "" ? null : (
          <span className={styles.unit} data-testid="activity-unit" title={row.unitTitle ?? undefined}>
            {row.unit}
          </span>
        ),
      tx:
        row.tx === null ? (
          <span className={styles.tx} title={row.txTitle} data-testid="activity-tx">
            {row.txLabel}
          </span>
        ) : (
          <a className={styles.tx} href={row.tx} target="_blank" rel="noopener noreferrer" title={row.txTitle} data-testid="activity-tx">
            {row.txLabel} ↗
          </a>
        ),
    },
  }));
  return <KitTable testId="activity-table" columns={COLUMNS} rows={kitRows} emptyText={emptyText} />;
}
