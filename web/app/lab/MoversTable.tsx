import Link from "next/link";
import { KitTable, SectionHead, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { truncateAddress } from "@/lib/format";
import { moversCaption, unreadableNote, type MoversTable as Table } from "@/lib/lab-movers";
import { MOVERS_EMPTY, MOVERS_QUALIFIER, MOVERS_TITLE } from "@/lib/lab-view";
import styles from "./lab.module.css";

const COLUMNS: KitColumn[] = [
  { key: "account", header: "Account" },
  { key: "before", header: "Room today", align: "right" },
  { key: "after", header: "Room after", align: "right" },
  { key: "debt", header: "Debt", align: "right" },
];
/** On Cash every listed account becomes liquidatable by definition, so the column would say "Yes" on every row; it stands only where a row can say otherwise. */
const FLIPS: KitColumn = { key: "flips", header: "Becomes liquidatable?", align: "right" };

/** The wire's movers, one row each, in the engine's own ranking (the order the caption names); rows open the Inspector; a row under the small line is dimmed, never dropped. The caption names the engine's own population. */
export function MoversTable({ table, engine }: { table: Table; engine: "debt_manager" | "aave_v3_etherfi" }) {
  const columns = engine === "debt_manager" ? COLUMNS : [...COLUMNS, FLIPS];
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
      before: <span className={m.overBefore ? styles.over : undefined}>{m.roomBefore}</span>,
      after: <span className={m.overAfter ? styles.over : undefined}>{m.roomAfter}</span>,
      debt: m.debtText,
      flips: m.becomesLiquidatable === null ? <StatusPill tone="refused">Cannot say</StatusPill> : m.becomesLiquidatable ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <section id="movers" data-testid="lab-movers">
      <SectionHead title={MOVERS_TITLE} qualifier={MOVERS_QUALIFIER} />
      <div className={kit.card}>
        <KitTable columns={columns} rows={rows} testId="lab-movers-table" emptyText={MOVERS_EMPTY} label={MOVERS_TITLE} />
      </div>
      <p className={styles.dim} data-testid="lab-movers-caption" title={table.note}>
        {moversCaption(table, engine)}
        {unreadableNote(table)}
      </p>
    </section>
  );
}
