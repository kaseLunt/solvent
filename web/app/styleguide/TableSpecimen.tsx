"use client";

// The Book's table pattern on the kit, composed as `app/book/NeedsAttention.tsx` composes it.
// ONE engine, as the Book's table is: every row is a Cash (debt_manager) position, so the fold toggle's count and
// sum are one engine's — engines are never summed on any surface. Material liquidatable rows first, then near cap,
// then the refused row: rendered, counted and dimmed, never dropped. A refused row's figures print an em dash —
// never 0, never $0 — and its StatusPill names the refusal in the title, in the words the Book's own
// `notComputedCause` gives it: plain cause, then wire code. A sized row's figures are integers by type, so no null
// is ever coalesced into a zero here. The below-the-line liquidatable rows fold behind the kit SmallToggle, whose
// label states their count and their summed debt. The rows and every figure derived from them live in
// `specimen-book.ts`, which the header and the drawer read too. A CLIENT component: the toggle holds state.

import { useState } from "react";
import { KitTable, SmallToggle, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { notComputedCause } from "@/lib/cash-rows";
import { humanUsd } from "@/lib/human-usd";
import {
  SPECIMEN_BASE_ROWS,
  SPECIMEN_BELOW_LINE_ROWS,
  SPECIMEN_DECIMALS,
  SPECIMEN_ROW_COUNT,
  SPECIMEN_TOGGLE_LABEL,
  specimenRowId,
  type SpecimenRow,
} from "./specimen-book";
import styles from "./styleguide.module.css";

const COLUMNS: KitColumn[] = [
  { key: "account", header: "Account" },
  { key: "room", header: "Room", align: "right" },
  { key: "debt", header: "Debt", align: "right" },
  { key: "status", header: "Status", align: "right" },
];

const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function Account({ address }: { address: string }) {
  return (
    <span className={kit.addr} title={address}>
      {short(address)}
    </span>
  );
}

function toRow(row: SpecimenRow): KitRow {
  const testId = `sg-table-row-${specimenRowId(row)}`;
  if (row.kind === "refused") {
    return {
      key: row.row.account,
      testId,
      dim: true,
      cells: {
        account: <Account address={row.row.account} />,
        room: "—",
        // As the Book prints it: a refused row may still carry a debt the wire stated; one it did not state is the dash.
        debt: row.row.debt === null ? "—" : humanUsd(row.row.debt, SPECIMEN_DECIMALS),
        status: (
          <StatusPill tone="refused" title={notComputedCause(row.row)}>
            Not computed
          </StatusPill>
        ),
      },
    };
  }
  return {
    key: row.account,
    testId,
    cells: {
      account: <Account address={row.account} />,
      room: row.status === "liquidatable" ? humanUsd(row.room, SPECIMEN_DECIMALS) : (row.roomPercent ?? "—"),
      debt: humanUsd(row.debt, SPECIMEN_DECIMALS),
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
  // The folded rows append after the refused row, as the Book appends them.
  const shown = showSmall ? [...SPECIMEN_BASE_ROWS, ...SPECIMEN_BELOW_LINE_ROWS] : SPECIMEN_BASE_ROWS;
  return (
    <>
      <KitTable
        testId="sg-table-kit"
        columns={COLUMNS}
        rows={shown.map(toRow)}
        emptyText="specimen rows missing (bug in the styleguide)"
      />
      {SPECIMEN_BELOW_LINE_ROWS.length > 0 && (
        <SmallToggle on={showSmall} onChange={setShowSmall} testId="sg-table-toggle" label={SPECIMEN_TOGGLE_LABEL} />
      )}
      <p className={styles.tableFoot}>
        Showing {shown.length} of {SPECIMEN_ROW_COUNT} Cash rows. A refused row is rendered, counted and dimmed; it
        never folds and never pages away.
      </p>
    </>
  );
}
