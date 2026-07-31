"use client";

// Cursor pagination for the DataTable: transport-agnostic, batch-honest.
//
// The paginated endpoints (C1: /v1/positions, /v1/events, /v1/params, …) are
// BATCH-STABLE: a cursor encodes (batch_id, rank) and a superseded batch
// mid-pagination returns 409 BATCH_SUPERSEDED — the honest answer, never a
// mixed-batch page. This hook owns the accumulation and exposes `reset()` so
// a surface can restart the walk when the service refuses to continue it.
// Detecting the 409 is endpoint-specific and stays with the caller.

import { useCallback, useRef, useState } from "react";

export interface CursorPage<Row, C> {
  rows: readonly Row[];
  /** Null when this was the last page. */
  nextCursor: C | null;
}

export interface CursorPages<Row> {
  /** Every row loaded so far, in wire order across pages. */
  rows: readonly Row[];
  /** Whether a further page exists (true before the first load). */
  hasMore: boolean;
  loading: boolean;
  /** The last page-fetch failure, until the next attempt. */
  error: Error | null;
  /** Fetch the next page. No-op while loading or when exhausted. */
  loadMore: () => void;
  /** Drop everything and start from the first page (e.g. on BATCH_SUPERSEDED). */
  reset: () => void;
}

export function useCursorPages<Row, C>(
  fetchPage: (cursor: C | null, signal: AbortSignal) => Promise<CursorPage<Row, C>>,
): CursorPages<Row> {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cursorRef = useRef<C | null>(null);
  const exhaustedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  /** Invalidates in-flight responses after a reset. */
  const epochRef = useRef(0);

  const loadMore = useCallback(() => {
    if (controllerRef.current !== null || exhaustedRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const epoch = epochRef.current;
    setLoading(true);
    setError(null);

    fetchPage(cursorRef.current, controller.signal).then(
      (page) => {
        if (epoch !== epochRef.current) return; // reset() raced this response
        controllerRef.current = null;
        cursorRef.current = page.nextCursor;
        if (page.nextCursor === null) exhaustedRef.current = true;
        setRows((previous) => [...previous, ...page.rows]);
        setHasMore(page.nextCursor !== null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (epoch !== epochRef.current) return;
        controllerRef.current = null;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setLoading(false);
      },
    );
  }, [fetchPage]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    cursorRef.current = null;
    exhaustedRef.current = false;
    setRows([]);
    setHasMore(true);
    setLoading(false);
    setError(null);
  }, []);

  return { rows, hasMore, loading, error, loadMore, reset };
}
