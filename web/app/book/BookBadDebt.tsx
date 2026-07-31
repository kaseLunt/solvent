// Bad-debt census (spec §3.1): the standing census at the UNSHOCKED grid
// point, per engine. The null-never-zero law is the whole point of this
// table: a withheld engine's `current_bad_debt_usd` renders an em dash WITH
// its named reason — "a bad-debt line of 0 over a book nobody was allowed to
// compute is the most dangerous zero on this surface".

import { formatUnits, type BadDebt } from "@solvent/client";
import { DataTable, type Column } from "@/components/DataTable";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { groupDecimalString } from "@/lib/book-format";
import { EM_DASH } from "@/lib/format";
import styles from "./book.module.css";

function usdCell(value: string | null, decimals: number): string {
  if (value === null) return EM_DASH;
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/** Nullable COUNTS obey the same law: null is withheld, never 0. */
function countCell(value: number | null): string {
  return value === null ? EM_DASH : String(value);
}

const COLUMNS: ReadonlyArray<Column<BadDebt>> = [
  { id: "engine", header: "Engine", cell: (row) => <EngineChip engine={row.engine} /> },
  {
    id: "bad-debt",
    header: "Current bad debt",
    align: "right",
    cell: (row) =>
      row.refused ? (
        <span data-testid={`bad-debt-${row.engine}`} title={row.refusal?.detail ?? undefined}>
          {EM_DASH} <RefusedTag reason={row.refusal?.code ?? "withheld"} />
        </span>
      ) : (
        <span data-testid={`bad-debt-${row.engine}`} className={row.current_bad_debt_usd !== "0" ? "crit-t" : undefined}>
          {usdCell(row.current_bad_debt_usd, row.usd_decimals)}
        </span>
      ),
  },
  {
    id: "insolvent",
    header: "Insolvent",
    align: "right",
    cell: (row) => countCell(row.insolvent_positions),
  },
  {
    id: "eligible",
    header: "Eligible",
    align: "right",
    cell: (row) => countCell(row.eligible_positions),
  },
  {
    id: "eligible-debt",
    header: "Eligible debt",
    align: "right",
    cell: (row) => usdCell(row.eligible_debt_usd, row.usd_decimals),
  },
  {
    id: "at-risk",
    header: "Collateral at risk",
    align: "right",
    cell: (row) => usdCell(row.collateral_at_risk_usd, row.usd_decimals),
  },
];

export function BookBadDebt({ badDebt }: { badDebt: readonly BadDebt[] }) {
  return (
    <section className={styles.section} aria-label="bad-debt census">
      <div className={styles.sectionHead}>
        <h2>Bad-debt census — standing, unshocked</h2>
        <span className={styles.sectionNote}>
          a withheld engine is an em dash with its reason, never 0
        </span>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={badDebt}
        rowKey={(row) => row.engine}
        rowTone={(row) => (row.refused ? "refused" : "default")}
        ariaLabel="bad-debt census per engine"
        empty="no bad-debt lines were served on this batch — a statement about the service, not a zero"
      />
    </section>
  );
}
