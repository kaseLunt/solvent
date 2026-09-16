import { dotPlotScale } from "@/lib/lab-geometry";
import { formatTenths } from "@/lib/percent";
import styles from "./charts.module.css";

/** A row either has a value (a dot, toned by its sign) or none (a dashed track, `refused`); the type forbids a dim dot at a value. */
export type DotPlotRow = {
  readonly key: string;
  readonly label: string;
  readonly valueText: string;
  readonly note: string | null;
} & (
  | { readonly tenths: bigint; readonly tone: "crit" | "ok" | "warn" }
  | { readonly tenths: null; readonly tone: "refused" }
);
export interface DotPlotProps {
  rows: readonly DotPlotRow[];
  width: number;
  axisLabel: string;
  testId?: string;
  rowTestIdPrefix?: string;
}

const ROW_H = 26;
const AXIS_H = 22;
const VALUE_W = 120;
const CHAR_W = 7; // 12px mono ≈ 7px per character: the label column is sized to the longest label
const DOT_CLASS = {
  crit: styles.dotCrit,
  ok: styles.dotOk,
  warn: styles.dotWarn,
} as const;

/** One signed dot per row on a symmetric percent axis; a row without a value is a dashed track that says why. */
export function DotPlot({
  rows,
  width,
  axisLabel,
  testId,
  rowTestIdPrefix,
}: DotPlotProps) {
  const LABEL_W = Math.min(
    320,
    Math.max(
      160,
      rows.reduce((m, r) => Math.max(m, r.label.length), 0) * CHAR_W + 8,
    ),
  );
  const plotW = Math.max(120, width - LABEL_W - VALUE_W);
  const scale = dotPlotScale(
    rows.map((r) => r.tenths),
    plotW,
  );
  const height = rows.length * ROW_H + AXIS_H;
  const edge = formatTenths(scale.maxAbsTenths);
  const anyValue = rows.some((r) => r.tenths !== null);
  const px = (x: number) => LABEL_W + x;
  return (
    <svg
      className={styles.chart}
      width={width}
      height={height}
      role="img"
      aria-label={axisLabel}
      data-testid={testId}
    >
      {anyValue && (
        <line
          className={styles.baseline}
          x1={px(scale.zeroX)}
          x2={px(scale.zeroX)}
          y1={0}
          y2={rows.length * ROW_H}
        />
      )}
      {rows.map((row, i) => {
        const y = i * ROW_H + ROW_H / 2;
        const id =
          rowTestIdPrefix === undefined
            ? undefined
            : `${rowTestIdPrefix}-${row.key}`;
        return (
          <g
            key={row.key}
            className={styles.dotPlotRow}
            data-testid={id}
            data-kind={row.tenths === null ? "refused" : "point"}
          >
            <text className={styles.axisLabel} x={0} y={y + 4}>
              {row.label}
            </text>
            <line
              className={styles.dotPlotTrack}
              x1={px(scale.left)}
              x2={px(scale.right)}
              y1={y}
              y2={y}
              strokeDasharray={row.tenths === null ? "3 4" : undefined}
            />
            {row.tenths !== null && (
              <circle
                className={DOT_CLASS[row.tone]}
                cx={px(scale.x(row.tenths))}
                cy={y}
                r={5}
              >
                <title>{row.valueText}</title>
              </circle>
            )}
            <text className={styles.valueLabel} x={px(plotW) + 8} y={y + 4}>
              {row.note ?? row.valueText}
            </text>
          </g>
        );
      })}
      {anyValue && (
        <>
          <text
            className={styles.axisLabel}
            x={px(scale.left)}
            y={height - 6}
            textAnchor="start"
          >
            −{edge}
          </text>
          <text
            className={styles.axisLabel}
            x={px(scale.zeroX)}
            y={height - 6}
            textAnchor="middle"
          >
            0
          </text>
          <text
            className={styles.axisLabel}
            x={px(scale.right)}
            y={height - 6}
            textAnchor="end"
          >
            +{edge}
          </text>
        </>
      )}
    </svg>
  );
}
