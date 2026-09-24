"use client";

import Link from "next/link";
import { useState } from "react";
import { KitTable, SmallToggle, StatusPill, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { notComputedCause, refusedRowDebtCell, rowStandingLabel, type CashRow, type SizedCashRow } from "@/lib/cash-rows";
import { attentionEmptyText, belowLineToggleLabel, nearCapToggleLabel, type CashSummary } from "@/lib/cash-summary";
import { humanUsd } from "@/lib/human-usd";
import styles from "./book.module.css";

const DEFAULT_ROWS = 8;
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

function byRoom(a: CashRow, b: CashRow): number {
  const x = a.roomTenths ?? 0n;
  const y = b.roomTenths ?? 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

function toRow(r: SizedCashRow, status: "liquidatable" | "near"): KitRow {
  const room = r.room ?? 0n;
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    cells: {
      account: (
        <Link href={`/inspector/${r.account}`} className={kit.addr}>
          {short(r.account)}
        </Link>
      ),
      room: status === "liquidatable" ? humanUsd(room, r.decimals) : (r.roomPercent ?? "—"),
      debt: humanUsd(r.debt, r.decimals),
      status:
        status === "liquidatable" ? (
          <StatusPill tone="crit">Liquidatable</StatusPill>
        ) : (
          <StatusPill tone="warn">Near cap</StatusPill>
        ),
    },
  };
}

/** A row with no verdict here — refused by the engine, or unreadable by this page: dimmed, its standing and its cause in the lib's words. */
function refusedRow(r: CashRow): KitRow {
  const debt = refusedRowDebtCell(r);
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    dim: true,
    cells: {
      account: (
        <Link href={`/inspector/${r.account}`} className={kit.addr}>
          {short(r.account)}
        </Link>
      ),
      room: "—",
      debt: debt.title === null ? debt.text : <span title={debt.title}>{debt.text}</span>,
      status: (
        <StatusPill tone="refused" title={notComputedCause(r)}>
          {rowStandingLabel(r)}
        </StatusPill>
      ),
    },
  };
}

export interface NeedsAttentionProps {
  summary: CashSummary;
  rows: readonly CashRow[];
  /** A transport-class walk failure with the one honest retry. */
  walkFailure: { message: string; retryable: boolean } | null;
  onRetry: () => void;
}

/** Material liquidatable first, then near cap by room, then the rows with no verdict (refused or unreadable) — dimmed, never dropped. */
export function NeedsAttention({ summary, rows, walkFailure, onRetry }: NeedsAttentionProps) {
  const [showSmall, setShowSmall] = useState(false);
  const [showNear, setShowNear] = useState(false);
  const material = [...summary.liquidatable.material].sort(byRoom).map((r) => toRow(r, "liquidatable"));
  // Near-cap fills the default rows; the rest are held behind their own fold, in the same room order.
  const nearShown = summary.nearCapRows.slice(0, Math.max(0, DEFAULT_ROWS - material.length));
  const nearHidden = summary.nearCapRows.slice(nearShown.length);
  const refused = rows.filter((r) => !r.computed).map(refusedRow);
  const belowLine = [...summary.liquidatable.small, ...summary.liquidatable.dust]
    .sort(byRoom)
    .map((r) => toRow(r, "liquidatable"));
  // Material rows always show; the near-cap fold extends the near rows in room order; rows with no verdict are ALWAYS
  // appended (counted, not hidden).
  const near = [...nearShown, ...(showNear ? nearHidden : [])].map((r) => toRow(r, "near"));
  const base = [...material, ...near, ...refused];
  const shown = showSmall ? [...base, ...belowLine] : base;
  const n = summary.liquidatable.counts.belowLine;
  return (
    <>
      <KitTable
        testId="book-attention"
        columns={[
          { key: "account", header: "Account" },
          { key: "room", header: "Room", align: "right" },
          { key: "debt", header: "Debt", align: "right" },
          { key: "status", header: "Status", align: "right" },
        ]}
        rows={shown}
        emptyText={attentionEmptyText(summary)}
      />
      {walkFailure !== null && (
        <p className={styles.walkFailure} role="alert" data-testid="book-walk-failure">
          The walk stopped: {walkFailure.message}.{" "}
          {walkFailure.retryable && (
            <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      )}
      {(nearHidden.length > 0 || n > 0) && (
        <div className={styles.toggles}>
          {nearHidden.length > 0 && (
            <SmallToggle
              on={showNear}
              onChange={setShowNear}
              testId="book-near-toggle"
              label={nearCapToggleLabel(nearHidden, summary.decimals)}
            />
          )}
          {n > 0 && (
            <SmallToggle
              on={showSmall}
              onChange={setShowSmall}
              testId="book-dust-toggle"
              label={belowLineToggleLabel(n, summary.liquidatable.sums.belowLine, summary.decimals)}
            />
          )}
        </div>
      )}
    </>
  );
}
