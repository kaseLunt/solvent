"use client";

// The §9 table pattern on the kit (plan 2026-09-16, R7). A refused row is rendered, counted and dimmed — never
// dropped — and its money cells say the word `refused` in amber, never an em dash that reads as an empty zero.
// The status column is the kit StatusPill: the plain cause is the label, the wire code rides in the title.
// Small and dust rows fold behind the kit SmallToggle, whose label names their count and their sum; the refused
// row never folds. The footer reconciles each engine's population separately, never one summed count.
// A CLIENT component: the toggle holds state.

import { useState, type ReactNode } from "react";
import { KitTable, SmallToggle, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import styles from "./styleguide.module.css";

interface SpecimenRow {
  id: string;
  engine: string;
  account: string;
  collateral: string | null;
  debt: string | null;
  /** The engine's display string; null when refused or when no debt exists. */
  hf: string | null;
  status: "healthy" | "near" | "liquidatable" | "no-debt" | "refused";
  refusedReason: string | null;
  /** Below the materiality line: folded behind the toggle, named in its label. */
  small: boolean;
}

/** Static SPECIMEN rows — the mockup's own example values, labeled as such. */
const SPECIMEN_ROWS: readonly SpecimenRow[] = [
  {
    id: "healthy",
    engine: "aave_v3",
    account: "0x3c19000000000000000000000000000000008af0",
    collateral: "$4,182,003.11",
    debt: "$2,201,554.87",
    hf: "1.539",
    status: "healthy",
    refusedReason: null,
    small: false,
  },
  {
    id: "near",
    engine: "aave_v3",
    account: "0x71aa00000000000000000000000000000004e200",
    collateral: "$1,904,112.60",
    debt: "$1,478,220.02",
    hf: "1.043",
    status: "near",
    refusedReason: null,
    small: false,
  },
  {
    id: "dust-liquidatable",
    engine: "debt_manager",
    account: "0x9a04000000000000000000000000000000e6c200",
    collateral: "$14.02",
    debt: "$14.55",
    hf: "0.963",
    status: "liquidatable",
    refusedReason: null,
    small: true,
  },
  {
    id: "refused",
    engine: "debt_manager",
    account: "0x8f24000000000000000000000000000000c11d00",
    collateral: null,
    debt: null,
    hf: null,
    status: "refused",
    refusedReason: "sweep_failed_no_success",
    small: false,
  },
  {
    id: "dust-no-debt",
    engine: "aave_v3",
    account: "0x2c64000000000000000000000000000000064900",
    collateral: "$8.38",
    debt: "$0.00",
    hf: null,
    status: "no-debt",
    refusedReason: null,
    small: true,
  },
];

const SMALL_COUNT = SPECIMEN_ROWS.filter((row) => row.small).length;
/** The folded rows' debt, summed by hand from the specimen values above ($14.55 + $0.00). */
const SMALL_DEBT = "$14.55";

const COLUMNS: KitColumn[] = [
  { key: "engine", header: "Engine" },
  { key: "account", header: "Account" },
  { key: "collateral", header: "Collateral", align: "right" },
  { key: "debt", header: "Debt", align: "right" },
  { key: "hf", header: "Health factor", align: "right" },
  { key: "status", header: "Status", align: "right" },
];

const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A refused cell says the word — amber text, never an em dash. */
function refusedCell(): ReactNode {
  return <span className={styles.refcell}>refused</span>;
}

function statusCell(row: SpecimenRow): ReactNode {
  switch (row.status) {
    case "liquidatable":
      return <StatusPill tone="crit">Liquidatable</StatusPill>;
    case "near":
      return <StatusPill tone="warn">Near cap</StatusPill>;
    case "healthy":
      return <StatusPill tone="ok">Healthy</StatusPill>;
    case "refused":
      return (
        <StatusPill tone="refused" title={row.refusedReason ?? undefined}>
          Not computed
        </StatusPill>
      );
    case "no-debt":
      return <span className={kit.sub}>no debt</span>;
  }
}

function toRow(row: SpecimenRow): KitRow {
  const refused = row.status === "refused";
  return {
    key: row.account,
    testId: `sg-table-row-${row.id}`,
    dim: refused,
    cells: {
      engine: <span className={kit.addr}>{row.engine}</span>,
      account: (
        <span className={kit.addr} title={row.account}>
          {short(row.account)}
        </span>
      ),
      collateral: row.collateral ?? refusedCell(),
      debt: row.debt ?? refusedCell(),
      hf: refused ? refusedCell() : (row.hf ?? "∞"),
      status: statusCell(row),
    },
  };
}

export function TableSpecimen() {
  const [showSmall, setShowSmall] = useState(false);
  const shown = SPECIMEN_ROWS.filter((row) => showSmall || !row.small);
  return (
    <>
      <KitTable
        testId="sg-table-kit"
        columns={COLUMNS}
        rows={shown.map(toRow)}
        emptyText="specimen rows missing (bug in the styleguide)"
      />
      <SmallToggle
        on={showSmall}
        onChange={setShowSmall}
        testId="sg-table-toggle"
        label={`Show ${String(SMALL_COUNT)} small & dust positions (${SMALL_DEBT})`}
      />
      <p className={styles.tableFoot}>
        Showing {shown.length} of {SPECIMEN_ROWS.length} rows · aave_v3: 9,958 of 9,964 computed · 6 refused (all
        named) — debt_manager: 546 of 552 computed · 6 refused (all named). A refused row is rendered, counted and
        dimmed; it never folds and never pages away. Engine populations reconcile separately — never one summed
        count.
      </p>
    </>
  );
}
