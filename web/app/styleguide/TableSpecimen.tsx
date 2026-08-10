"use client";

// The §9 table-pattern specimen (p1a-6). A CLIENT component on purpose:
// DataTable is client, and column `cell` functions cannot cross the
// server→client boundary — the old server page passed them directly, which
// is exactly why the NEXT_PUBLIC_SHOW_STYLEGUIDE=1 production build died at
// /styleguide prerender (found and fixed this task; PaginationDemo already
// used this shape).
//
// §9 reskin carried here: the refused row's money cells print the word
// `refused` in amber — never an em dash that reads as an empty zero — the
// status column carries the kit RefusedChip (plain cause leads, wire code
// secondary), and the footer reconciles each engine's population separately,
// never one summed count.

import { DataTable, type Column } from "@/components/DataTable";
import { AddressMono } from "@/components/AddressMono";
import { EngineChip } from "@/components/EngineChip";
import { SeverityHF } from "@/components/SeverityHF";
import { RefusedChip } from "@/components/StatusChip";
import styles from "./styleguide.module.css";

interface SpecimenRow {
  engine: string;
  account: string;
  collateral: string | null;
  debt: string | null;
  verdict: "liquidatable" | "not-liquidatable" | "unknowable";
  hf: string | null;
  ratio: number | null;
  infinite: boolean;
  refusedReason: string | null;
  marks: ReadonlyArray<{ letter: string; block: number | null }>;
}

/** Static SPECIMEN rows — the mockup's own example values, labeled as such. */
const SPECIMEN_ROWS: readonly SpecimenRow[] = [
  {
    engine: "aave_v3",
    account: "0x3c19000000000000000000000000000000008af0",
    collateral: "$4,182,003.11",
    debt: "$2,201,554.87",
    verdict: "not-liquidatable",
    hf: "1.539",
    ratio: 1.539,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
  {
    engine: "aave_v3",
    account: "0x71aa00000000000000000000000000000004e200",
    collateral: "$1,904,112.60",
    debt: "$1,478,220.02",
    verdict: "not-liquidatable",
    hf: "1.043",
    ratio: 1.043,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
  {
    engine: "debt_manager",
    account: "0x9a04000000000000000000000000000000e6c200",
    collateral: "$14.02",
    debt: "$14.55",
    verdict: "liquidatable",
    hf: "0.963",
    ratio: 0.963,
    infinite: false,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641712 },
      { letter: "P", block: 25641712 },
      { letter: "S", block: 25641712 },
    ],
  },
  {
    engine: "debt_manager",
    account: "0x8f24000000000000000000000000000000c11d00",
    collateral: null,
    debt: null,
    verdict: "unknowable",
    hf: null,
    ratio: null,
    infinite: false,
    refusedReason: "sweep_failed_no_success",
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
      { letter: "S", block: null },
    ],
  },
  {
    engine: "aave_v3",
    account: "0x2c64000000000000000000000000000000064900",
    collateral: "$8.38",
    debt: "$0.00",
    verdict: "not-liquidatable",
    hf: null,
    ratio: null,
    infinite: true,
    refusedReason: null,
    marks: [
      { letter: "B", block: 25641730 },
      { letter: "P", block: 25641730 },
    ],
  },
];

/** A refused money cell says the word — amber text, never an em dash. */
function refusedCell(): React.ReactNode {
  return <span className={styles.refcell}>refused</span>;
}

const SPECIMEN_COLUMNS: ReadonlyArray<Column<SpecimenRow>> = [
  { id: "engine", header: "Engine", cell: (row) => <EngineChip engine={row.engine} /> },
  {
    id: "account",
    header: "Account",
    cell: (row) => <AddressMono address={row.account} copy={false} />,
  },
  {
    id: "collateral",
    header: "Collateral",
    align: "right",
    cell: (row) => row.collateral ?? refusedCell(),
  },
  { id: "debt", header: "Debt", align: "right", cell: (row) => row.debt ?? refusedCell() },
  {
    id: "hf",
    header: "Health factor",
    align: "right",
    cell: (row) =>
      row.refusedReason !== null ? (
        <RefusedChip cause="sweep failed twice" code={row.refusedReason} />
      ) : (
        <SeverityHF
          verdict={row.verdict}
          display={row.hf}
          ratio={row.ratio}
          infinite={row.infinite}
        />
      ),
  },
];

export function TableSpecimen() {
  return (
    <DataTable
      columns={SPECIMEN_COLUMNS}
      rows={SPECIMEN_ROWS}
      rowKey={(row) => row.account}
      rowTone={(row) =>
        row.refusedReason !== null ? "refused" : row.verdict === "liquidatable" ? "crit" : "default"
      }
      ariaLabel="specimen position table"
      empty="specimen rows missing (bug in the styleguide)"
      footer={
        <p className={styles.tableFoot}>
          Showing 5 rows · aave_v3: 9,958 of 9,964 computed · 6 refused (all named) · 3
          liquidatable pinned — debt_manager: 546 of 552 computed · 6 refused (all named) · 0
          liquidatable. Liquidatable and refused rows are pinned; they cannot page away. Engine
          populations reconcile separately — never one summed count.
        </p>
      }
    />
  );
}
