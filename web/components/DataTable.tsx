"use client";

import { useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import styles from "./table.module.css";

// Headless, typed data table in the mockup's table aesthetic: sticky mono
// uppercase header, hairline rows, tabular numerals, overflow-x wrapper.
//
// W-UX-C landed the seam this file always documented:
//
//   WINDOWING — rows are a FLAT array addressed by a stable `rowKey`, each
//   <tr> renders purely from its row, and the header is a separate sticky
//   element. The `windowing` prop slices `rows` to the visible range ± an
//   overscan at a FIXED row height, padding the ends with spacer rows — so
//   the DOM holds ~100 rows at any depth while scrollbar geometry stays
//   honest. Display content is untouched: a windowed row renders exactly the
//   bytes an unwindowed one would.
//
//   SCROLLING — with `maxHeight` set, the rows scroll INSIDE a keyboard-
//   reachable region (tabIndex=0, role="region", labeled) under the sticky
//   header, and the `footer` stays OUTSIDE the scroll region: the accounting
//   line is always visible, at any scroll depth.
//
//   SENTINEL — `onEndSentinel` reports (via IntersectionObserver, rootMargin
//   600px) whether the END of the loaded walk is within ~600px of view. The
//   CALLER owns the load policy: fire loadMore iff hasMore && !loading &&
//   error === null — this component only states visibility, so an error can
//   never be auto-loaded across.
//
//   SORT HEADERS — a column with `sort` renders its header as a <button>
//   inside the <th> (Enter/Space native, the global focus ring), carrying
//   aria-sort and the accent ▲/▼ glyph ONLY while it is the active sort.
//
// Cursor pagination pairs with `lib/pagination.ts` (`useCursorPages`): pass
// its rows here and wire `footer` to a load-more control. No fetching happens
// inside the table — it renders exactly what it is given.

export type RowTone = "default" | "crit" | "refused";

/** A sortable column header's state — present means the header is a button. */
export interface ColumnSortState {
  /** Non-null = this column IS the active sort; the value is its aria-sort. */
  direction: "ascending" | "descending" | null;
  onSort: () => void;
}

export interface Column<Row> {
  /** Stable column id. */
  id: string;
  header: ReactNode;
  /** Right-align numeric columns (mockup `.num`). */
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
  /**
   * Present = the header is a sort <button>. Absent = a plain th with the
   * default cursor — a header that must never LOOK clickable stays plain by
   * simply not carrying this.
   */
  sort?: ColumnSortState;
}

/** The windowing seam: fixed row height, rendered slice ± overscan, spacers. */
export interface WindowingSeam {
  /** Fixed row height in px — layout geometry only, rows still render whole. */
  rowHeight: number;
  /** Rows rendered beyond each edge of the visible range (default 20). */
  overscan?: number;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  /** Stable identity per row — required so windowing/react keys stay honest. */
  rowKey: (row: Row) => string;
  /**
   * Row emphasis: `crit` (liquidatable) tints the row crit-bg; `refused`
   * renders the mockup's muted refused-bg. Severity is styling only — the
   * VERDICT must already be in the row's cells (RefusedTag / SeverityHF).
   */
  rowTone?: (row: Row) => RowTone;
  /**
   * Constrain height and scroll rows under the sticky header, inside a
   * labeled, keyboard-reachable region. The footer stays outside the region,
   * always visible. Unset, the table grows naturally (mockup look) and only
   * scrolls horizontally.
   */
  maxHeight?: number | string;
  /** Slice rows to a windowed range (requires `maxHeight`). */
  windowing?: WindowingSeam;
  /** Reports whether the walk's end sentinel is within ~600px of view. */
  onEndSentinel?: (visible: boolean) => void;
  /** aria-label for the scroll region (defaults to `ariaLabel`). */
  scrollRegionLabel?: string;
  /** Rendered inside the wrapper below the table (pagination controls). */
  footer?: ReactNode;
  /**
   * Shown when `rows` is empty. REQUIRED: an empty table must say WHY it is
   * empty ("no rows in this page" vs "engine withheld: …") — silence is not
   * an option, so there is no default.
   */
  empty: ReactNode;
  /** Accessible table caption (visually handled by surrounding headings). */
  ariaLabel: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowTone,
  maxHeight,
  windowing,
  onEndSentinel,
  scrollRegionLabel,
  footer,
  empty,
  ariaLabel,
}: DataTableProps<Row>) {
  const scroll = maxHeight !== undefined;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // Measure the scroll region so the windowed slice covers what is visible.
  useEffect(() => {
    const node = scrollRef.current;
    if (!scroll || node === null) return;
    const measure = () => {
      setViewHeight(node.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [scroll]);

  // The walk-end sentinel: visibility only — the caller owns the policy.
  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || onEndSentinel === undefined) return;
    const observer = new IntersectionObserver(
      (entries) => {
        onEndSentinel(entries.some((entry) => entry.isIntersecting));
      },
      { root: scrollRef.current, rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [onEndSentinel, scroll]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  // The windowed slice (fixed row height, ± overscan, spacer rows).
  const windowed = windowing !== undefined && scroll && rows.length > 0;
  let start = 0;
  let end = rows.length;
  let topPad = 0;
  let bottomPad = 0;
  if (windowed) {
    const overscan = windowing.overscan ?? 20;
    start = Math.max(0, Math.floor(scrollTop / windowing.rowHeight) - overscan);
    end = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewHeight) / windowing.rowHeight) + overscan,
    );
    topPad = start * windowing.rowHeight;
    bottomPad = (rows.length - end) * windowing.rowHeight;
  }
  const visibleRows = windowed ? rows.slice(start, end) : rows;

  const table = (
    <table className={styles.table} aria-label={ariaLabel}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.id}
              className={column.align === "right" ? styles.num : undefined}
              aria-sort={column.sort?.direction ?? undefined}
            >
              {column.sort !== undefined ? (
                <button type="button" className={styles.sortButton} onClick={column.sort.onSort}>
                  {column.header}
                  {column.sort.direction !== null && (
                    <span className={styles.sortGlyph} aria-hidden>
                      {column.sort.direction === "ascending" ? "▲" : "▼"}
                    </span>
                  )}
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>
              <div className={styles.empty}>{empty}</div>
            </td>
          </tr>
        ) : (
          <>
            {topPad > 0 && (
              <tr
                aria-hidden
                className={styles.spacerRow}
                data-testid="window-spacer"
                style={{ height: topPad }}
              >
                <td colSpan={columns.length} />
              </tr>
            )}
            {visibleRows.map((row) => {
              const tone = rowTone?.(row) ?? "default";
              const toneClass =
                tone === "crit" ? styles.rowCrit : tone === "refused" ? styles.rowRefused : undefined;
              return (
                <tr key={rowKey(row)} className={toneClass}>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={column.align === "right" ? styles.num : undefined}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {bottomPad > 0 && (
              <tr
                aria-hidden
                className={styles.spacerRow}
                data-testid="window-spacer"
                style={{ height: bottomPad }}
              >
                <td colSpan={columns.length} />
              </tr>
            )}
          </>
        )}
      </tbody>
    </table>
  );

  return (
    <div className={styles.wrap}>
      {scroll ? (
        <div
          ref={scrollRef}
          className={styles.scrollRegion}
          style={{ maxHeight }}
          tabIndex={0}
          role="region"
          aria-label={scrollRegionLabel ?? ariaLabel}
          onScroll={handleScroll}
        >
          {table}
          {onEndSentinel !== undefined && (
            <div ref={sentinelRef} data-testid="walk-end-sentinel" aria-hidden />
          )}
        </div>
      ) : (
        table
      )}
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

export interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** e.g. "70 rows · batch bk_019fb0a2". Keeps the page honest about coverage. */
  status: ReactNode;
}

/** A footer control pairing DataTable with `useCursorPages`. */
export function LoadMoreFooter({ hasMore, loading, onLoadMore, status }: LoadMoreProps) {
  return (
    <>
      <span>{status}</span>
      {hasMore ? (
        <button type="button" className={styles.loadMore} onClick={onLoadMore} disabled={loading}>
          {loading ? "LOADING…" : "LOAD MORE"}
        </button>
      ) : (
        <span className="dim">end of pages</span>
      )}
    </>
  );
}
