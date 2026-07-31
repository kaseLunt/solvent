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
  /**
   * Caller-supplied labeled x ticks (design TASTE 12 — e.g. round decades on
   * a log axis: 5 → "100k", 6 → "1M"). Ticks OUTSIDE the data domain are
   * dropped — the honest-scale law: the domain fits the data and ticks never
   * stretch it. When at least one tick lands in-domain, tick gridlines and
   * labels REPLACE the uniform vertical grid and the raw-extreme x edge
   * labels; otherwise the default edge labels stand.
   */
  xTicks?: readonly { value: number; label: string }[];
  /**
   * Optional horizontal reference line (e.g. y = 0 — the liquidation
   * boundary). The value is FORCED into the y-domain so the boundary is
   * always on the chart, even when every point sits on one side of it: an
   * auto-fit domain that clips the floor fabricates proximity drama.
   * Drawn as a dashed crit-toned hairline with a direct mono label, matching
   * the Sparkline's reference treatment.
   */
  yReference?: { value: number; label: string };
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
  xTicks,
  yReference,
  label,
}: ScatterProps) {
  const margin = { top: 8, right: 10, bottom: 30, left: 44 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const yDomain = yReference !== undefined ? [...ys, yReference.value] : ys;
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 1;
  const yMin = yDomain.length > 0 ? Math.min(...yDomain) : 0;
  const yMax = yDomain.length > 0 ? Math.max(...yDomain) : 1;
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

  // Labeled x ticks, in-domain only (TASTE 12). When present they carry the
  // vertical grid AND the x value labels; the raw-extreme edge labels drop.
  const inDomainXTicks = (xTicks ?? []).filter((t) => t.value >= xMin && t.value <= xMax);
  const useXTicks = inDomainXTicks.length > 0;

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
      {!useXTicks &&
        ticks.map((t) => (
          <line
            key={`v${String(t)}`}
            className={styles.grid}
            x1={margin.left + plotW * t}
            x2={margin.left + plotW * t}
            y1={margin.top}
            y2={margin.top + plotH}
          />
        ))}
      {useXTicks &&
        inDomainXTicks.map((tick) => (
          <g key={`xt${String(tick.value)}`} data-testid="scatter-x-tick">
            <line
              className={styles.grid}
              x1={px(tick.value)}
              x2={px(tick.value)}
              y1={margin.top}
              y2={margin.top + plotH}
            />
            <text
              className={styles.axisLabel}
              x={px(tick.value)}
              y={height - 16}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          </g>
        ))}

      {!useXTicks && (
        <>
          <text className={styles.axisLabel} x={margin.left} y={height - 4}>
            {formatX(xMin)}
          </text>
          <text
            className={styles.axisLabel}
            x={margin.left + plotW}
            y={height - 4}
            textAnchor="end"
          >
            {formatX(xMax)}
          </text>
        </>
      )}
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

      {yReference !== undefined && (
        <g data-testid="scatter-reference">
          <line
            className={styles.refLine}
            x1={margin.left}
            x2={margin.left + plotW}
            y1={py(yReference.value)}
            y2={py(yReference.value)}
          />
          <text
            className={styles.refLabel}
            x={margin.left + plotW}
            y={Math.max(margin.top + 8, py(yReference.value) - 4)}
            textAnchor="end"
          >
            {yReference.label}
          </text>
        </g>
      )}

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
