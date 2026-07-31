import type { ReactNode } from "react";
import styles from "./table.module.css";

// Headless, typed data table in the mockup's table aesthetic: sticky mono
// uppercase header, hairline rows, tabular numerals, overflow-x wrapper.
//
// Virtualization-ready by construction: rows are a FLAT array addressed by a
// stable `rowKey`, each <tr> renders purely from its row, and the header is a
// separate sticky element — so a windowing layer (W1, for the ~10k-row book)
// can slice `rows` and add spacer rows without touching this component's API.
//
// Cursor pagination pairs with `lib/pagination.ts` (`useCursorPages`): pass
// its rows here and wire `footer` to a load-more control. No fetching happens
// inside the table — it renders exactly what it is given.

export type RowTone = "default" | "crit" | "refused";

export interface Column<Row> {
  /** Stable column id. */
  id: string;
  header: ReactNode;
  /** Right-align numeric columns (mockup `.num`). */
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
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
   * Constrain height and scroll rows under the sticky header. Unset, the
   * table grows naturally (mockup look) and only scrolls horizontally.
   */
  maxHeight?: number | string;
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
  footer,
  empty,
  ariaLabel,
}: DataTableProps<Row>) {
  const scroll = maxHeight !== undefined;
  return (
    <div
      className={scroll ? `${styles.wrap} ${styles.wrapScroll}` : styles.wrap}
      style={scroll ? { maxHeight } : undefined}
    >
      <table className={styles.table} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} className={column.align === "right" ? styles.num : undefined}>
                {column.header}
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
            rows.map((row) => {
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
            })
          )}
        </tbody>
      </table>
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
