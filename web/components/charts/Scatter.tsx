import type { Severity } from "@/lib/severity";
import styles from "./charts.module.css";

export interface ScatterPoint {
  /** Stable id (e.g. the account address). */
  id: string;
  x: number;
  y: number;
  /** Severity colors the dot (the risk-map law: crit = liquidatable). */
  severity?: Severity;
  /** Tooltip text (SVG <title>), e.g. "0x3c19…88af · $2.2M · −34.9%". */
  title?: string;
}

export interface ScatterProps {
  points: readonly ScatterPoint[];
  width?: number;
  height?: number;
  /** Mono axis captions, e.g. "debt (usd, log)" / "liq. distance %". */
  xLabel: string;
  yLabel: string;
  /** Tick label formatters for the four edge values. */
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  /** Grid line count per axis. */
  gridLines?: number;
  label: string;
}

/**
 * The risk-map scatter (debt size vs liquidation distance — the whale-vs-dust
 * picture). Square 2px-radius marks in severity colors on a hairline
 * mono-grid, per the mockup's chart-panel aesthetic. Scale transforms (log
 * etc.) belong to the CALLER: x/y arrive ready to plot, and the axis label
 * must say so ("usd, log").
 */
export function Scatter({
  points,
  width = 560,
  height = 260,
  xLabel,
  yLabel,
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  gridLines = 4,
  label,
}: ScatterProps) {
  const margin = { top: 8, right: 10, bottom: 30, left: 44 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 1;
  const yMin = ys.length > 0 ? Math.min(...ys) : 0;
  const yMax = ys.length > 0 ? Math.max(...ys) : 1;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const px = (x: number) => margin.left + ((x - xMin) / xSpan) * plotW;
  const py = (y: number) => margin.top + plotH - ((y - yMin) / ySpan) * plotH;

  const severityClass = (severity: Severity | undefined) =>
    severity === "crit"
      ? styles.dotCrit
      : severity === "warn"
        ? styles.dotWarn
        : severity === "ok"
          ? styles.dotOk
          : styles.dotDim;

  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => i / gridLines);

  return (
    <svg
      className={styles.chart}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {ticks.map((t) => (
        <line
          key={`h${String(t)}`}
          className={styles.grid}
          x1={margin.left}
          x2={margin.left + plotW}
          y1={margin.top + plotH * t}
          y2={margin.top + plotH * t}
        />
      ))}
      {ticks.map((t) => (
        <line
          key={`v${String(t)}`}
          className={styles.grid}
          x1={margin.left + plotW * t}
          x2={margin.left + plotW * t}
          y1={margin.top}
          y2={margin.top + plotH}
        />
      ))}

      <text className={styles.axisLabel} x={margin.left} y={height - 4}>
        {formatX(xMin)}
      </text>
      <text className={styles.axisLabel} x={margin.left + plotW} y={height - 4} textAnchor="end">
        {formatX(xMax)}
      </text>
      <text className={styles.axisLabel} x={margin.left - 6} y={margin.top + plotH} textAnchor="end">
        {formatY(yMin)}
      </text>
      <text className={styles.axisLabel} x={margin.left - 6} y={margin.top + 10} textAnchor="end">
        {formatY(yMax)}
      </text>
      <text
        className={styles.axisLabel}
        x={margin.left + plotW / 2}
        y={height - 4}
        textAnchor="middle"
      >
        {xLabel}
      </text>
      <text
        className={styles.axisLabel}
        x={10}
        y={margin.top + plotH / 2}
        textAnchor="middle"
        transform={`rotate(-90 10 ${margin.top + plotH / 2})`}
      >
        {yLabel}
      </text>

      {points.map((point) => (
        <rect
          key={point.id}
          className={severityClass(point.severity)}
          x={px(point.x) - 3}
          y={py(point.y) - 3}
          width={6}
          height={6}
          rx={2}
        >
          {point.title !== undefined && <title>{point.title}</title>}
        </rect>
      ))}
    </svg>
  );
}
