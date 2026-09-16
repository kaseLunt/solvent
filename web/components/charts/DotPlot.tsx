import { dotPlotScale } from "@/lib/lab-geometry";
import { formatTenths } from "@/lib/percent";
import styles from "./charts.module.css";

export interface DotPlotRow {
  readonly key: string;
  readonly label: string;
  /** Signed tenths of a percent; null draws a dashed track and no dot (a refused, withheld or unmeasurable row). */
  readonly tenths: bigint | null;
  readonly valueText: string;
  readonly note: string | null;
  readonly tone: "crit" | "ok" | "warn" | "refused";
}
export interface DotPlotProps {
  rows: readonly DotPlotRow[];
  width: number;
  axisLabel: string;
  testId?: string;
  rowTestIdPrefix?: string;
}

const ROW_H = 26;
const AXIS_H = 22;
const LABEL_W = 220;
const VALUE_W = 120;
const DOT_CLASS = { crit: styles.dotCrit, ok: styles.dotOk, warn: styles.dotWarn, refused: styles.dotDim } as const;

/** One signed dot per row on a symmetric percent axis; a row without a value is a dashed track that says why. */
export function DotPlot({ rows, width, axisLabel, testId, rowTestIdPrefix }: DotPlotProps) {
  const plotW = Math.max(120, width - LABEL_W - VALUE_W);
  const scale = dotPlotScale(rows.map((r) => r.tenths), plotW);
  const height = rows.length * ROW_H + AXIS_H;
  const edge = formatTenths(scale.maxAbsTenths);
  const px = (x: number) => LABEL_W + x;
  return (
    <svg className={styles.chart} width={width} height={height} role="img" aria-label={axisLabel} data-testid={testId}>
      <line className={styles.baseline} x1={px(scale.zeroX)} x2={px(scale.zeroX)} y1={0} y2={rows.length * ROW_H} />
      {rows.map((row, i) => {
        const y = i * ROW_H + ROW_H / 2;
        const id = rowTestIdPrefix === undefined ? undefined : `${rowTestIdPrefix}-${row.key}`;
        return (
          <g key={row.key} className={styles.dotPlotRow} data-testid={id} data-kind={row.tenths === null ? "refused" : "point"}>
            <text className={styles.axisLabel} x={0} y={y + 4}>
              {row.label}
            </text>
            <line className={styles.dotPlotTrack} x1={px(scale.left)} x2={px(scale.right)} y1={y} y2={y} strokeDasharray={row.tenths === null ? "3 4" : undefined} />
            {row.tenths !== null && (
              <circle className={DOT_CLASS[row.tone]} cx={px(scale.x(row.tenths))} cy={y} r={5}>
                <title>{row.valueText}</title>
              </circle>
            )}
            <text className={styles.valueLabel} x={px(plotW) + 8} y={y + 4}>
              {row.note ?? row.valueText}
            </text>
          </g>
        );
      })}
      <text className={styles.axisLabel} x={px(scale.left)} y={height - 6}>
        −{edge}
      </text>
      <text className={styles.axisLabel} x={px(scale.zeroX) - 4} y={height - 6}>
        0
      </text>
      <text className={styles.axisLabel} x={px(scale.right) - 34} y={height - 6}>
        +{edge}
      </text>
    </svg>
  );
}
