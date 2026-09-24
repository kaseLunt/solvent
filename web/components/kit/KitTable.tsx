import type { ReactNode } from "react";
import { TABLE_EMPTY_FALLBACK, TABLE_FALLBACK_LABEL } from "@/lib/chrome";
import styles from "./kit.module.css";
import { ScrollRegion } from "./ScrollRegion";

export interface KitColumn {
  key: string;
  header: string;
  align?: "left" | "right";
}

export interface KitRow {
  key: string;
  cells: Record<string, ReactNode>;
  /** A refused / not-computed row: rendered, counted, dimmed — never dropped. */
  dim?: boolean;
  testId?: string;
}

export interface KitTableProps {
  columns: KitColumn[];
  rows: KitRow[];
  testId?: string;
  emptyText?: string;
  /** The table's name, which its scroll region carries: the section or card title it sits under. */
  label?: string;
}

/** Every column stays on every screen: a table wider than its card scrolls inside its own region, never the page. */
export function KitTable({ columns, rows, testId, emptyText = TABLE_EMPTY_FALLBACK, label }: KitTableProps) {
  return (
    <ScrollRegion label={label ?? TABLE_FALLBACK_LABEL}>
      <table className={styles.tbl} data-testid={testId}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? styles.r : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.tblEmpty}>
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.key} className={row.dim ? styles.dim : undefined} data-testid={row.testId}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? styles.r : undefined}>
                  {row.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
