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
  fetchPage: (
    cursor: C | null,
    signal: AbortSignal,
    /**
     * p1b-6 fix 2: TRUE while the walk this page was dispatched for is still
     * the current one. The epoch check inside this hook protects only the
     * hook's OWN state (rows/cursor); a caller that mirrors per-page envelope
     * facts into its own state (e.g. the Feed's filter echo) must gate those
     * writes on this predicate, or a page resolving concurrently with
     * `reset()` writes a stale echo the hook cannot retract.
     */
    isCurrent: () => boolean,
  ) => Promise<CursorPage<Row, C>>,
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

    fetchPage(cursorRef.current, controller.signal, () => epoch === epochRef.current).then(
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

/**
 * p1b-9 (Codex round, finding 3): the RENDER-SYNCHRONOUS ownership mask for a
 * scope-keyed walk.
 *
 * This hook owns the accumulated rows, so a caller that re-keys the walk (the
 * Inspector: one component instance reused across addresses) cannot express
 * the `{for: addr}` state binding its other fetches use — and the p1b-6
 * drop-and-restart (`reset()` in an effect) is EFFECT-timed: on an A→B reuse
 * the FIRST B render still holds A's rows, one frame of another address's
 * data under B's head. The reset cannot be moved into render (a state write
 * on a shared hook), so the p1b-6 fix-5 pattern (render-synchronous
 * derived-empty) is applied at the CONSUMPTION seam instead: the caller
 * records the scope it dispatched the walk for (state set beside the reset),
 * and rows render ONLY while that scope is the scope being rendered. A frame
 * that cannot prove ownership renders the empty walk — never a neighbour's
 * rows.
 *
 * Pinned by tests/unit/pagination-scope.spec.ts; the A→B reuse itself is
 * remount-dependent in the real router, so the pin is the mask's own law
 * (recorded p1b-9 decision — e2e cannot produce the reuse frame from
 * outside).
 */
export function scopedRows<Row>(
  dispatchedFor: string | null,
  renderingFor: string,
  rows: readonly Row[],
): readonly Row[] {
  return dispatchedFor === renderingFor ? rows : [];
}
