"use client";

import { dotPlotColumns, dotPlotScale } from "@/lib/lab-geometry";
import { formatTenths } from "@/lib/percent";
import { useMonoCharWidth } from "@/lib/useMeasuredWidth";
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
  /** The value column's header, over its cells ("share · change"). */
  valueHeader?: string;
  /** One line under the axis ticks naming what the axis is a share of; drawn only with the axis, so a plot of refused rows carries none. */
  axisCaption?: string;
  testId?: string;
  rowTestIdPrefix?: string;
}

const ROW_H = 26;
const AXIS_H = 22;
const HEADER_H = 18;
const CAPTION_H = 16;
const DOT_CLASS = {
  crit: styles.dotCrit,
  ok: styles.dotOk,
  warn: styles.dotWarn,
} as const;
// The stem from zero to the dot shows the magnitude, not only the position: the dot's tone at reduced opacity.
const STEM_CLASS = {
  crit: styles.stemCrit,
  ok: styles.stemOk,
  warn: styles.stemWarn,
} as const;

/** One signed dot per row on a symmetric percent axis; a row without a value is a dashed track that says why. */
export function DotPlot({
  rows,
  width,
  axisLabel,
  valueHeader,
  axisCaption,
  testId,
  rowTestIdPrefix,
}: DotPlotProps) {
  // LF-8: the columns are sized from ONE MEASURED mono glyph, never a per-character guess.
  // The probe is the kit's own; until its first layout pass the hook's generous fallback
  // holds, so a pre-measurement render errs toward a column too wide, never one that clips.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();
  // The value column fits its longest text — its header included — never narrower than its
  // floor. When the columns outgrow the width asked for, the chart is wider than asked and its
  // frame scrolls; a label is never clipped.
  const valueTexts = rows.map((r) => r.note ?? r.valueText);
  const { labelW, valueW } = dotPlotColumns(
    rows.map((r) => r.label),
    valueHeader === undefined ? valueTexts : [valueHeader, ...valueTexts],
    chPx,
  );
  const plotW = Math.max(120, width - labelW - valueW);
  const svgWidth = labelW + plotW + valueW;
  const scale = dotPlotScale(
    rows.map((r) => r.tenths),
    plotW,
  );
  const anyValue = rows.some((r) => r.tenths !== null);
  const headerH = valueHeader === undefined ? 0 : HEADER_H;
  const captionH = anyValue && axisCaption !== undefined ? CAPTION_H : 0;
  const rowsH = rows.length * ROW_H;
  const height = headerH + rowsH + AXIS_H + captionH;
  const axisY = headerH + rowsH + AXIS_H - 6;
  const edge = formatTenths(scale.maxAbsTenths);
  const px = (x: number) => labelW + x;
  return (
    // The 1:1 chart's frame: it scrolls where the chart is wider than the budget it was given.
    <div className={styles.chart1to1}>
      <span className={styles.chProbe} ref={probeRef} aria-hidden>
        0000000000
      </span>
      <svg
        className={styles.chart}
        width={svgWidth}
        height={height}
        role="img"
        aria-label={axisLabel}
        data-testid={testId}
      >
        {valueHeader !== undefined && (
          <text className={styles.axisLabel} x={px(plotW) + 8} y={12}>
            {valueHeader}
          </text>
        )}
        {anyValue && (
          <line
            className={styles.baseline}
            x1={px(scale.zeroX)}
            x2={px(scale.zeroX)}
            y1={headerH}
            y2={headerH + rowsH}
          />
        )}
        {rows.map((row, i) => {
          const y = headerH + i * ROW_H + ROW_H / 2;
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
              <text className={styles.rowLabel} x={0} y={y + 4}>
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
                <>
                  <line
                    className={STEM_CLASS[row.tone]}
                    data-role="stem"
                    x1={px(scale.zeroX)}
                    x2={px(scale.x(row.tenths))}
                    y1={y}
                    y2={y}
                  />
                  <circle
                    className={DOT_CLASS[row.tone]}
                    cx={px(scale.x(row.tenths))}
                    cy={y}
                    r={5}
                  >
                    <title>{row.valueText}</title>
                  </circle>
                </>
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
              y={axisY}
              textAnchor="start"
            >
              −{edge}
            </text>
            <text
              className={styles.axisLabel}
              x={px(scale.zeroX)}
              y={axisY}
              textAnchor="middle"
            >
              0
            </text>
            <text
              className={styles.axisLabel}
              x={px(scale.right)}
              y={axisY}
              textAnchor="end"
            >
              +{edge}
            </text>
            {axisCaption !== undefined && (
              <text
                className={styles.axisLabel}
                x={px(scale.zeroX)}
                y={height - 4}
                textAnchor="middle"
              >
                {axisCaption}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
