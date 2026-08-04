// THE LOSS FRONTIER'S LEDGER (LF-8) — the exact numbers, transposed, column
// aligned to the bars above.
//
// WHY IT IS TRANSPOSED. The old layout was a table: one ROW per grid sample,
// one column per measure. A reader comparing "Σ eligible debt across the grid"
// had to read DOWN a column while the chart above read ACROSS. Rows are
// measures now and columns are grid samples, so the ledger reads in the
// chart's own direction and each column sits directly beneath the bar it
// describes.
//
// THE LAWS IT RENDERS UNDER
//
//   R5 — never rounds, and distinguishes a COMPUTED ZERO (`$0`) from an
//        UNKNOWABLE (em dash) in every cell. A sample this engine did not
//        serve is a hole: em dash across the whole column, and `not served`
//        under its axis tick.
//   R2 — geometry comes from `frontierScale`, the same module the SVG uses.
//        The grid template is `{marginLeft}px repeat(n, {slot}px)`, so column
//        `k`'s centre IS `scale.x(k)`.
//   LF-8 — NO SUPPRESSION at any width. When the widest value cannot fit the
//        natural slot the slot grows and the frame scrolls; a ledger that
//        abbreviated to fit would be a chart deciding which of the reader's
//        numbers matter.
//   LAW-5 — no number exists only in a `<title>`. Everything the bars' hover
//        titles carry is printed here.

import type { FrontierScale } from "@/app/lab/frontierScale";
import type { FrontierSeries } from "@/app/lab/frontierView";
import { frontierLedgerRows, FRONTIER_NOT_SERVED_TITLE } from "@/app/lab/labReadingLines";
import styles from "./charts.module.css";

export interface FrontierLedgerProps {
  series: FrontierSeries;
  scale: FrontierScale;
  /** The id `aria-details` on the SVG points at. */
  id: string;
}

export function FrontierLedger({ series, scale, id }: FrontierLedgerProps) {
  const rows = frontierLedgerRows(series);
  const template = `${String(scale.marginLeft)}px repeat(${String(series.grid.length)}, ${String(
    scale.slot,
  )}px)`;
  return (
    <div
      className={styles.ledger}
      id={id}
      data-testid="frontier-ledger"
      data-engine={series.engine}
      data-columns={String(series.grid.length)}
      role="table"
      // LF-10: the `Exact data` control moves focus HERE, so it must be
      // focusable without becoming a tab stop of its own.
      tabIndex={-1}
      aria-label={`exact values for ${series.engine} at every grid sample`}
      style={{ gridTemplateColumns: template, width: `${String(scale.width)}px` }}
    >
      {rows.map((row) => (
        <div className={styles.ledgerRow} role="row" key={row.key} data-row={row.key}>
          <div className={styles.ledgerRowLabel} role="rowheader" title={row.title}>
            {row.label}
          </div>
          {row.cells.map((cell, index) => (
            <div
              className={styles.ledgerCell}
              role="cell"
              // The grid index IS the identity: two samples can share a move
              // label only if the wire served the same factor twice, and the
              // column would still be its own column.
              key={`${row.key}-${String(index)}`}
              data-testid="frontier-ledger-cell"
              data-column={String(index)}
              data-served={series.grid[index]?.cell === null ? "false" : "true"}
              title={series.grid[index]?.cell === null ? FRONTIER_NOT_SERVED_TITLE : undefined}
            >
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
