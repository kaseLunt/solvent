"use client";

import { useCallback, useEffect } from "react";
import { DataTable, LoadMoreFooter, type Column } from "@/components/DataTable";
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import { AddressMono } from "@/components/AddressMono";
import { EngineChip } from "@/components/EngineChip";

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

const COLUMNS: ReadonlyArray<Column<SpecimenRow>> = [
  { id: "engine", header: "Engine", cell: (row) => <EngineChip engine={row.engine} /> },
  { id: "account", header: "Account", cell: (row) => <AddressMono address={row.account} copy={false} /> },
  { id: "rank", header: "Rank", align: "right", cell: (row) => <span className="mono">{row.rank}</span> },
];

/** SPECIMEN cursor pagination wired through useCursorPages + LoadMoreFooter. */
export function PaginationDemo() {
  const { rows, hasMore, loading, loadMore } = useCursorPages<SpecimenRow, number>(
    useCallback((cursor) => fetchSpecimenPage(cursor), []),
  );

  useEffect(() => {
    if (rows.length === 0) loadMore();
  }, [rows.length, loadMore]);

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.account}
      ariaLabel="specimen cursor pagination"
      empty="loading first specimen page…"
      footer={
        <LoadMoreFooter
          hasMore={hasMore}
          loading={loading}
          onLoadMore={loadMore}
          status={`${String(rows.length)} / ${String(TOTAL)} specimen rows`}
        />
      }
    />
  );
}
