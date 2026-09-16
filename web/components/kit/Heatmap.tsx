import { Fragment, type CSSProperties } from "react";
import { groupInt } from "@/lib/prose";
import styles from "./kit.module.css";

export interface HeatBand {
  readonly key: string;
  readonly label: string;
  readonly title?: string;
}
export type HeatMovement = "held" | "worse" | "better" | "unmeasured";
export interface HeatCellView {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly title: string;
  readonly movement: HeatMovement;
  /** The cell's share of the largest cell — an opacity, never printed. */
  readonly intensity: number;
}
export interface HeatmapProps {
  bands: readonly HeatBand[];
  cells: readonly HeatCellView[];
  rowsLabel: string;
  colsLabel: string;
  merged: boolean;
  testId?: string;
  cellTestIdPrefix?: string;
}

const MOVE_CLASS: Record<HeatMovement, string | undefined> = {
  held: styles.heatHeld,
  worse: styles.heatWorse,
  better: styles.heatBetter,
  unmeasured: styles.heatUnmeasured,
};

/** The `.k-heat` grid: rows are the band today, columns the band after; a cell is a count of accounts. An empty cell stays a cell. */
export function Heatmap({ bands, cells, rowsLabel, colsLabel, merged, testId, cellTestIdPrefix }: HeatmapProps) {
  const byKey = new Map(cells.map((c) => [`${String(c.from)}-${String(c.to)}`, c]));
  const id = (r: number, c: number) => (cellTestIdPrefix === undefined ? undefined : `${cellTestIdPrefix}-${String(r)}-${String(c)}`);
  return (
    <div
      className={styles.heat}
      style={{ gridTemplateColumns: `90px repeat(${String(bands.length)}, 1fr)` }}
      data-testid={testId}
      data-merged={merged ? "true" : "false"}
      role="table"
      aria-label={`${rowsLabel} by ${colsLabel}`}
    >
      <div className={styles.heatCorner} aria-hidden="true">
        {rowsLabel} ↓ · {colsLabel} →
      </div>
      {bands.map((b) => (
        <div key={`h-${b.key}`} className={styles.heatHead} title={b.title} role="columnheader">
          {b.label}
        </div>
      ))}
      {bands.map((row, r) => (
        <Fragment key={`r-${row.key}`}>
          <div className={styles.heatLabel} title={row.title} role="rowheader">
            {row.label}
          </div>
          {bands.map((col, c) => {
            const cell = byKey.get(`${String(r)}-${String(c)}`);
            if (cell === undefined || cell.count === 0) {
              return <div key={col.key} className={`${styles.heatCell} ${styles.heatEmpty}`} data-testid={id(r, c)} data-count="0" role="cell" />;
            }
            return (
              <div
                key={col.key}
                className={`${styles.heatCell} ${MOVE_CLASS[cell.movement] ?? ""}`}
                style={{ "--heat": cell.intensity } as CSSProperties}
                title={cell.title}
                data-testid={id(r, c)}
                data-count={String(cell.count)}
                data-movement={cell.movement}
                role="cell"
              >
                <span>{groupInt(cell.count)}</span>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
