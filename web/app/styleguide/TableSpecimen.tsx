"use client";

// The Book's table pattern on the kit (plan 2026-09-16, R7), composed as `app/book/NeedsAttention.tsx` composes it.
// ONE engine, as the Book's table is: every row is a Cash (debt_manager) position, so the fold toggle's count and
// sum are one engine's — engines are never summed on any surface. Material liquidatable rows first, then near cap,
// then the refused row: rendered, counted and dimmed, never dropped. A refused row's figures print an em dash —
// never 0, never $0 — and its StatusPill names the refusal, plain cause then wire code, in the title. The
// below-the-line liquidatable rows fold behind the kit SmallToggle, whose label states their count and their
// summed debt, both derived from the rows. A CLIENT component: the toggle holds state.

import { useState } from "react";
import { KitTable, SmallToggle, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { humanUsd } from "@/lib/human-usd";
import { plainCause } from "@/lib/refusal-phrasebook";
import styles from "./styleguide.module.css";

/** The Cash engine's value scale. */
const DECIMALS = 6;

interface SpecimenRow {
  id: string;
  account: string;
  status: "liquidatable" | "near" | "refused";
  /** cap − debt at the engine's scale; negative when liquidatable; null when refused. */
  room: bigint | null;
  /** A near-cap row states its room as a share of the cap. */
  roomPercent: string | null;
  debt: bigint | null;
  refusalCode: string | null;
  /** Liquidatable but below the materiality line: folded behind the toggle, named in its label. */
  belowLine: boolean;
}

/**
 * Static SPECIMEN rows, all Cash. The two material debts sum to 6,840.238278 — the crit header's "$6,840" above and
 * the drawer's exact row below are the same figure.
 */
const SPECIMEN_ROWS: readonly SpecimenRow[] = [
  {
    id: "material-1",
    account: "0x3c19000000000000000000000000000000008af0",
    status: "liquidatable",
    room: -310_402_118n,
    roomPercent: null,
    debt: 4_200_118_139n,
    refusalCode: null,
    belowLine: false,
  },
  {
    id: "material-2",
    account: "0x9a04000000000000000000000000000000e6c200",
    status: "liquidatable",
    room: -96_400_000n,
    roomPercent: null,
    debt: 2_640_120_139n,
    refusalCode: null,
    belowLine: false,
  },
  {
    id: "near",
    account: "0x71aa00000000000000000000000000000004e200",
    status: "near",
    room: 6_077_020_000n,
    roomPercent: "4.1%",
    debt: 142_142_980_000n,
    refusalCode: null,
    belowLine: false,
  },
  {
    id: "refused",
    account: "0x8f24000000000000000000000000000000c11d00",
    status: "refused",
    room: null,
    roomPercent: null,
    debt: null,
    refusalCode: "SWEEP_FAILED",
    belowLine: false,
  },
  {
    id: "small",
    account: "0x5d7e0000000000000000000000000000001b3a00",
    status: "liquidatable",
    room: -2_750_000n,
    roomPercent: null,
    debt: 61_200_000n,
    refusalCode: null,
    belowLine: true,
  },
  {
    id: "dust",
    account: "0x2c64000000000000000000000000000000064900",
    status: "liquidatable",
    room: -530_000n,
    roomPercent: null,
    debt: 14_550_000n,
    refusalCode: null,
    belowLine: true,
  },
];

const COLUMNS: KitColumn[] = [
  { key: "account", header: "Account" },
  { key: "room", header: "Room", align: "right" },
  { key: "debt", header: "Debt", align: "right" },
  { key: "status", header: "Status", align: "right" },
];

const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function toRow(row: SpecimenRow): KitRow {
  const account = (
    <span className={kit.addr} title={row.account}>
      {short(row.account)}
    </span>
  );
  if (row.status === "refused") {
    const code = row.refusalCode ?? "";
    return {
      key: row.account,
      testId: `sg-table-row-${row.id}`,
      dim: true,
      cells: {
        account,
        room: "—",
        debt: row.debt === null ? "—" : humanUsd(row.debt, DECIMALS),
        status: (
          <StatusPill tone="refused" title={`${plainCause(code)} · ${code}`}>
            Not computed
          </StatusPill>
        ),
      },
    };
  }
  return {
    key: row.account,
    testId: `sg-table-row-${row.id}`,
    cells: {
      account,
      room: row.status === "liquidatable" ? humanUsd(row.room ?? 0n, DECIMALS) : (row.roomPercent ?? "—"),
      debt: row.debt === null ? "—" : humanUsd(row.debt, DECIMALS),
      status:
        row.status === "liquidatable" ? (
          <StatusPill tone="crit">Liquidatable</StatusPill>
        ) : (
          <StatusPill tone="warn">Near cap</StatusPill>
        ),
    },
  };
}

export function TableSpecimen() {
  const [showSmall, setShowSmall] = useState(false);
  const base = SPECIMEN_ROWS.filter((row) => !row.belowLine);
  const belowLine = SPECIMEN_ROWS.filter((row) => row.belowLine);
  // One engine's rows, one engine's sum.
  const belowLineDebt = belowLine.reduce((sum, row) => sum + (row.debt ?? 0n), 0n);
  // The folded rows append after the refused row, as the Book appends them.
  const shown = showSmall ? [...base, ...belowLine] : base;
  return (
    <>
      <KitTable
        testId="sg-table-kit"
        columns={COLUMNS}
        rows={shown.map(toRow)}
        emptyText="specimen rows missing (bug in the styleguide)"
      />
      {belowLine.length > 0 && (
        <SmallToggle
          on={showSmall}
          onChange={setShowSmall}
          testId="sg-table-toggle"
          label={`Show ${String(belowLine.length)} small & dust positions (${humanUsd(belowLineDebt, DECIMALS)})`}
        />
      )}
      <p className={styles.tableFoot}>
        Showing {shown.length} of {SPECIMEN_ROWS.length} Cash rows. A refused row is rendered, counted and dimmed; it
        never folds and never pages away.
      </p>
    </>
  );
}
