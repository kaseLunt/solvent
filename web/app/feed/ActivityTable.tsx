import Link from "next/link";
import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { ActivityRow } from "@/lib/activity-view";
import { truncateAddress } from "@/lib/format";
import styles from "./activity.module.css";

const COLUMNS: KitColumn[] = [
  { key: "when", header: "When" },
  { key: "engine", header: "Engine" },
  { key: "type", header: "Type" },
  { key: "account", header: "Account" },
  { key: "amount", header: "Amount", align: "right" },
  { key: "tx", header: "Tx" },
];

/**
 * The paged record as the kit's table: every loaded row in WIRE ORDER (the service orders, the page discloses),
 * the untimed tail dim with its block number where the time would be, a liquidation's pill crit with its typed
 * extract behind it, the account opening the Inspector, the amount with its unit named beside it, the tx on its
 * chain's explorer. Every cell is the view model's word; nothing is decided here.
 */
export function ActivityTable({ rows, emptyText }: { rows: readonly ActivityRow[]; emptyText: string }) {
  const kitRows: KitRow[] = rows.map((row) => ({
    key: row.key,
    testId: `activity-row-${row.key}`,
    dim: row.dim,
    cells: {
      when: <span className={kit.addr}>{row.when}</span>,
      engine: row.engine,
      type:
        row.tone === "crit" ? (
          <StatusPill tone="crit" title={row.detail ?? undefined}>
            {row.type}
          </StatusPill>
        ) : (
          <span className={styles.type} title={row.detail ?? undefined}>
            {row.type}
          </span>
        ),
      account: (
        <Link href={`/inspector/${row.account}`} className={kit.addr} title={row.account} data-testid="activity-account">
          {truncateAddress(row.account)}
        </Link>
      ),
      amount: (
        <>
          <span className={kit.addr} data-testid="activity-amount">
            {row.amount}
          </span>
          {row.unit !== "" && (
            <span className={styles.unit} data-testid="activity-unit" title={row.unitTitle ?? undefined}>
              {row.unit}
            </span>
          )}
        </>
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
