"use client";

// Cursor pagination on the kit (plan 2026-09-16, R7): KitTable fed by `useCursorPages`, with the load-more
// control a kit ghost button. The status line always states what is loaded against what exists, and an
// exhausted walk says so in words — the control is never simply absent.

import { useCallback, useEffect } from "react";
import { KitTable, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import styles from "./styleguide.module.css";

interface SpecimenRow {
  engine: string;
  account: string;
  rank: number;
}

const PAGE_SIZE = 5;
const TOTAL = 12;

/** Deterministic SPECIMEN pager: 12 synthetic rows, 5 per page. */
function fetchSpecimenPage(cursor: number | null): Promise<CursorPage<SpecimenRow, number>> {
  const start = cursor ?? 0;
  const rows = Array.from({ length: Math.min(PAGE_SIZE, TOTAL - start) }, (_, i) => {
    const rank = start + i;
    return {
      engine: rank % 2 === 0 ? "aave_v3" : "debt_manager",
      account: `0x${rank.toString(16).padStart(4, "0")}9c0ffee0000000000000000000000000dead`,
      rank,
    };
  });
  const next = start + rows.length;
  return Promise.resolve({ rows, nextCursor: next >= TOTAL ? null : next });
}

const COLUMNS: KitColumn[] = [
  { key: "engine", header: "Engine" },
  { key: "account", header: "Account" },
  { key: "rank", header: "Rank", align: "right" },
];

const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function toRow(row: SpecimenRow): KitRow {
  return {
    key: row.account,
    cells: {
      engine: <span className={kit.addr}>{row.engine}</span>,
      account: (
        <span className={kit.addr} title={row.account}>
          {short(row.account)}
        </span>
      ),
      rank: row.rank,
    },
  };
}

/** SPECIMEN cursor pagination: `useCursorPages` into a KitTable, load-more as a kit ghost button. */
export function PaginationDemo() {
  const { rows, hasMore, loading, loadMore } = useCursorPages<SpecimenRow, number>(
    useCallback((cursor) => fetchSpecimenPage(cursor), []),
  );

  useEffect(() => {
    if (rows.length === 0) loadMore();
  }, [rows.length, loadMore]);

  return (
    <>
      <KitTable
        testId="sg-pagination-kit"
        columns={COLUMNS}
        rows={rows.map(toRow)}
        emptyText="loading first specimen page…"
      />
      <div className={styles.pageFoot}>
        <span data-testid="sg-pagination-status">
          {rows.length} / {TOTAL} specimen rows
        </span>
        {hasMore ? (
          <button
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            onClick={loadMore}
            disabled={loading}
            data-testid="sg-pagination-load-more"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : (
          <span className={kit.sub} data-testid="sg-pagination-end">
            end reached
          </span>
        )}
      </div>
    </>
  );
}
