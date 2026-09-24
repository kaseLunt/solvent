"use client";

import Link from "next/link";
import { useState } from "react";
import { KitTable, SmallToggle, StatusPill, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ATTENTION_COLUMNS, ATTENTION_STATUS, BOOK_CARDS, RETRY_LABEL, walkFailureLine } from "@/lib/book-copy";
import { byRoom, notComputedCause, refusedRowDebtCell, roomCell, rowStandingLabel, type CashRow, type SizedCashRow } from "@/lib/cash-rows";
import { attentionEmptyText, belowLineToggleLabel, nearCapToggleLabel, type CashSummary } from "@/lib/cash-summary";
import { EM_DASH, shortHex } from "@/lib/format";
import { accountMoneyColumn, type Money } from "@/lib/money";
import styles from "./book.module.css";

const DEFAULT_ROWS = 8;

function accountCell(r: CashRow) {
  return (
    <Link href={`/inspector/${r.account}`} className={kit.addr} title={r.account}>
      {shortHex(r.account)}
    </Link>
  );
}

function toRow(r: SizedCashRow, status: keyof typeof ATTENTION_STATUS, money: Money): KitRow {
  const room = roomCell(r);
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    cells: {
      account: accountCell(r),
      room: (
        <span className={room.over ? styles.over : undefined} title={room.title ?? undefined}>
          {room.text}
        </span>
      ),
      debt: money(r.debt),
      status: <StatusPill tone={status === "liquidatable" ? "crit" : "warn"}>{ATTENTION_STATUS[status]}</StatusPill>,
    },
  };
}

/** A row with no verdict here — refused by the engine, or unreadable by this page: dimmed, its standing and its cause in the lib's words. */
function refusedRow(r: CashRow, money: Money): KitRow {
  const debt = refusedRowDebtCell(r, money);
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    dim: true,
    cells: {
      account: accountCell(r),
      room: EM_DASH,
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
  const material = [...summary.liquidatable.material].sort(byRoom);
  // Near-cap fills the default rows; the rest are held behind their own fold, in the same room order.
  const nearShown = summary.nearCapRows.slice(0, Math.max(0, DEFAULT_ROWS - material.length));
  const nearHidden = summary.nearCapRows.slice(nearShown.length);
  const withoutVerdict = rows.filter((r) => !r.computed);
  const belowLine = [...summary.liquidatable.small, ...summary.liquidatable.dust].sort(byRoom);
  // One precision for the Debt column, picked over every row the table can show, so opening a fold never re-sets the rest.
  const money = accountMoneyColumn(
    [...material, ...summary.nearCapRows, ...withoutVerdict, ...belowLine].map((r) => r.debt),
    summary.decimals,
  );
  // Material rows always show; the near-cap fold extends the near rows in room order; rows with no verdict always follow.
  const near = [...nearShown, ...(showNear ? nearHidden : [])].map((r) => toRow(r, "near", money));
  const base = [...material.map((r) => toRow(r, "liquidatable", money)), ...near, ...withoutVerdict.map((r) => refusedRow(r, money))];
  const shown = showSmall ? [...base, ...belowLine.map((r) => toRow(r, "liquidatable", money))] : base;
  const n = summary.liquidatable.counts.belowLine;
  return (
    <>
      <KitTable
        testId="book-attention"
        label={BOOK_CARDS.attention.title}
        columns={ATTENTION_COLUMNS.map((c) => ({ ...c }))}
        rows={shown}
        emptyText={attentionEmptyText(summary)}
      />
      {walkFailure !== null && (
        <p className={styles.walkFailure} role="alert" data-testid="book-walk-failure">
          {walkFailureLine(walkFailure.message)}{" "}
          {walkFailure.retryable && (
            <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRetry}>
              {RETRY_LABEL}
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
