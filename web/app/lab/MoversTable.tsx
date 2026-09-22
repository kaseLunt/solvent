import Link from "next/link";
import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import { truncateAddress } from "@/lib/format";
import { moversCaption, type MoversTable as Table } from "@/lib/lab-movers";
import { MOVERS_EMPTY, MOVERS_QUALIFIER, MOVERS_TITLE } from "@/lib/lab-view";
import styles from "./lab.module.css";

const COLUMNS = [
  { key: "account", header: "Account" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "debt", header: "Debt", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The wire's movers, one row each, in the wire's own ranking; rows open the Inspector; a row under the small line is dimmed, never dropped. The caption names the engine's own population. */
export function MoversTable({ table, engine }: { table: Table; engine: "debt_manager" | "aave_v3_etherfi" }) {
  const rows: KitRow[] = table.rows.map((m) => ({
    key: m.account,
    testId: `lab-movers-row-${m.account}`,
    dim: m.tier === "small" || m.tier === "dust",
    cells: {
      account: (
        <Link href={`/inspector/${m.account}`} className={styles.mono} title={m.account}>
          {truncateAddress(m.account)}
        </Link>
      ),
      before: m.roomBefore,
      after: m.roomAfter,
      debt: m.debtText,
      flips: m.becomesLiquidatable === null ? <StatusPill tone="refused">Cannot say</StatusPill> : m.becomesLiquidatable ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <section id="movers" data-testid="lab-movers">
      <SectionHead title={MOVERS_TITLE} qualifier={MOVERS_QUALIFIER} />
      <KitTable columns={COLUMNS} rows={rows} testId="lab-movers-table" emptyText={MOVERS_EMPTY} />
      <p className={styles.dim} data-testid="lab-movers-caption" title={table.note}>
        {moversCaption(table, engine)}
        {table.unreadable.length > 0 ? ` · unreadable: ${table.unreadable.join(", ")}` : ""}
      </p>
    </section>
  );
}
