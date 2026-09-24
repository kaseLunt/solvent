import Link from "next/link";
import { Fragment } from "react";
import { KitTable, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  ACTIVITY_AMOUNT_HEADER,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_WHEN_HEADER,
  type ActivityLiquidation,
  type ActivityRow,
} from "@/lib/activity-view";
import { truncateAddress } from "@/lib/format";
import styles from "./activity.module.css";

/**
 * The liquidation's typed extract, visible beneath the type in every view: the liquidator opens the Inspector, the
 * amounts are the extract's own, an unestablished bonus is the marked dash the lib gave it — explained once, in the
 * footnote under the table, never behind a fold or a hover. In the untimed tail the extract dims with its row.
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
    </span>
  );
}

/** The columns in each view: the Amount column is right-aligned only while one engine is chosen — across engines a
 * right edge would put Cash and legacy figures on one digit axis — and set left otherwise, header and cells alike. */
function columnsFor(alignAmounts: boolean): KitColumn[] {
  return [
    { key: "when", header: ACTIVITY_WHEN_HEADER },
    { key: "engine", header: "Engine" },
    { key: "type", header: "Type" },
    { key: "account", header: "Account" },
    { key: "amount", header: ACTIVITY_AMOUNT_HEADER, align: alignAmounts ? "right" : "left" },
    { key: "unit", header: "Unit" },
    { key: "tx", header: "Tx" },
  ];
}

export interface ActivityTableProps {
  rows: readonly ActivityRow[];
  emptyText: string;
  /** One engine chosen: the digits align on one axis. Across engines they never share one. */
  alignAmounts: boolean;
  /** The footnote that explains the marked bonus dashes, once; null when no row prints one. */
  bonusNote: string | null;
}

/**
 * The paged record as the kit's table: every loaded row in WIRE ORDER (the service orders, the page discloses),
 * the untimed tail dim with its block number where the time would be, the time a typeset instant with the wire's ISO
 * as its title, the type in the page's words with the wire's word as its title — a key record set apart by weight,
 * never by a verdict's colour — a liquidation's typed extract beneath it, the account opening the Inspector, the
 * amount in its own column, right-aligned only within one engine — placed only by a scale the wire licensed, otherwise
 * the wire's integer grouped with the raw word beside it in the same cell — with its unit named in the quiet column
 * beside it, the tx on its chain's explorer. A record-only row's dash is a statement, not a value, and is set as one.
 * Every cell is the view model's word; nothing is decided here.
 */
export function ActivityTable({ rows, emptyText, alignAmounts, bonusNote }: ActivityTableProps) {
  // One digit axis needs one tag slot on every row, empty or not, so a tagged row's digits do not step left.
  const tagSlot = alignAmounts && rows.some((row) => row.amountTag !== null);
  const kitRows: KitRow[] = rows.map((row) => ({
    key: row.key,
    testId: `activity-row-${row.key}`,
    dim: row.dim,
    cells: {
      when: (
        <span title={row.whenTitle} data-testid="activity-when">
          {row.when}
        </span>
      ),
      engine: row.engine,
      type: (
        <>
          <span className={row.tone === "key" ? styles.typeKey : undefined} title={row.type} data-tone={row.tone} data-testid="activity-type">
            {row.typeLabel}
          </span>
          {row.detail !== null && <LiquidationLine detail={row.detail} dim={row.dim} />}
        </>
      ),
      account: (
        <Link href={`/inspector/${row.account}`} className={kit.addr} title={row.account} data-testid="activity-account">
          {truncateAddress(row.account)}
        </Link>
      ),
      amount: alignAmounts ? (
        <>
          <span className={row.recordOnly ? `${styles.num} ${kit.sub}` : styles.num} data-testid="activity-amount">
            {row.amount}
          </span>
          {tagSlot && (
            <span className={styles.tagSlot} data-testid={row.amountTag === null ? undefined : "activity-amount-tag"}>
              {row.amountTag ?? ""}
            </span>
          )}
        </>
      ) : (
        <>
          <span className={row.recordOnly ? kit.sub : undefined} data-testid="activity-amount">
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
  return (
    <div>
      <div className={kit.card}>
        <KitTable testId="activity-table" columns={columnsFor(alignAmounts)} rows={kitRows} emptyText={emptyText} label={ACTIVITY_LIST_TITLE} />
      </div>
      {bonusNote !== null && (
        <p className={styles.footnote} data-testid="activity-bonus-note">
          {bonusNote}
        </p>
      )}
    </div>
  );
}
