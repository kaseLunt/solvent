import Link from "next/link";
import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ACTIVITY_AMOUNT_HEADER, type ActivityLiquidation, type ActivityRow } from "@/lib/activity-view";
import { truncateAddress } from "@/lib/format";
import styles from "./activity.module.css";

/**
 * The liquidation's typed extract, visible beneath the pill in every view: the liquidator opens the Inspector, the
 * amounts are the extract's own, an unestablished bonus is the em dash the lib gave it — never behind a fold or a
 * hover. The wire's note is the line's title.
 */
function LiquidationLine({ detail }: { detail: ActivityLiquidation }) {
  return (
    <span className={styles.detail} data-testid="activity-liquidation" title={detail.note}>
      liquidator{" "}
      <Link href={detail.liquidatorHref} className={kit.addr} title={detail.liquidator} data-testid="activity-liquidator">
        {truncateAddress(detail.liquidator)}
      </Link>{" "}
      · debt repaid <b>{detail.repaid}</b>
      {detail.repaidAsset !== null && <span className={kit.dim}> {detail.repaidAsset}</span>} · seized <b>{detail.seized}</b> · bonus realized{" "}
      <b>{detail.bonusRealized}</b> / configured <b>{detail.bonusConfigured}</b>
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
 * the untimed tail dim with its block number where the time would be, a liquidation's pill crit with its typed
 * extract visible beneath it, the account opening the Inspector, the amount alone in its right-aligned column so
 * the digits share an edge — the wire's integer verbatim, aligned and never reformatted — with its unit named in the
 * quiet column beside it, the tx on its chain's explorer. A record-only row's word is a statement, not a value, and
 * is set as one. Every cell is the view model's word; nothing is decided here.
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
          {row.tone === "crit" ? <StatusPill tone="crit">{row.type}</StatusPill> : <span className={styles.type}>{row.type}</span>}
          {row.detail !== null && <LiquidationLine detail={row.detail} />}
        </>
      ),
      account: (
        <Link href={`/inspector/${row.account}`} className={kit.addr} title={row.account} data-testid="activity-account">
          {truncateAddress(row.account)}
        </Link>
      ),
      amount: (
        <span className={row.recordOnly ? kit.sub : kit.addr} data-testid="activity-amount">
          {row.amount}
        </span>
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
