import styles from "./charts.module.css";

export interface SparklineProps {
  /**
   * The series, oldest first. `null` is a GAP — an unestablished point.
   * The line BREAKS at gaps; this component never interpolates across
   * missing data (a smooth line over a hole is a small lie).
   */
  values: ReadonlyArray<number | null>;
  width?: number;
  height?: number;
  /** Marks the newest point with a dot. */
  endDot?: boolean;
  /** Accessible description, e.g. "HF across the last 60 batches". */
  label: string;
  /**
   * Optional horizontal reference line (e.g. HF = 1.0 — the liquidation
   * boundary). The value is INCLUDED in the y-domain, so the line stays
   * visible even when every point sits on one side of it.
   */
  referenceValue?: number;
  /** Mono label for the reference line (e.g. "1.0"). Rendered only with `referenceValue`. */
  referenceLabel?: string;
  /**
   * Per-point hover text (SVG `<title>`), aligned index-for-index with
   * `values`. Rendered on GAP ticks — the reason a point could not be
   * established (a refusal, a withheld book) travels with the gap instead of
   * being interpolated over — AND on invisible full-height hit rects over
   * FINITE points (design SHOULD-FIX 8), so a computed value's exact hover
   * text is as reachable as a gap's reason.
   */
  pointTitles?: ReadonlyArray<string | null>;
}

/**
 * A dense inline sparkline (SVG, no chart lib). Values are used for GEOMETRY
 * only — exact numbers belong in adjacent mono text, not in this path.
 */
export function Sparkline({
  values,
  width = 140,
  height = 36,
  endDot = true,
  label,
  referenceValue,
  referenceLabel,
  pointTitles,
}: SparklineProps) {
  const pad = 3;
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const domain =
    referenceValue !== undefined && Number.isFinite(referenceValue)
      ? [...finite, referenceValue]
      : finite;
  const min = domain.length > 0 ? Math.min(...domain) : 0;
  const max = domain.length > 0 ? Math.max(...domain) : 1;
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;

  const x = (index: number) => pad + index * step;
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);

  // Segments between gaps; each renders as its own path. A segment of ONE
  // point renders as a small circle instead — a lone SVG moveto draws no ink,
  // and an established value silently vanishing is the exact inverse of the
  // null-gap law (the floor doctrine applies to points too).
  const segments: { cx: number; cy: number }[][] = [];
  let current: { cx: number; cy: number }[] = [];
  const gapIndexes: number[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current);
      current = [];
      gapIndexes.push(index);
      return;
    }
    current.push({ cx: x(index), cy: y(value) });
  });
  if (current.length > 0) segments.push(current);

  let lastIndex = -1;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      lastIndex = i;
      break;
    }
  }
  const lastValue = lastIndex >= 0 ? values[lastIndex] : null;

  return (
    <svg
      className={styles.chart}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {referenceValue !== undefined && Number.isFinite(referenceValue) && (
        <g data-testid="sparkline-reference">
          <line
            className={styles.refLine}
            x1={pad}
            x2={width - pad}
            y1={y(referenceValue)}
            y2={y(referenceValue)}
          />
          {referenceLabel !== undefined && (
            <text
              className={styles.refLabel}
              x={width - pad}
              y={Math.max(8, y(referenceValue) - 3)}
              textAnchor="end"
            >
              {referenceLabel}
            </text>
          )}
        </g>
      )}
      {gapIndexes.map((index) => (
        <line
          key={index}
          className={styles.gapTick}
          data-testid="sparkline-gap"
          x1={x(index)}
          x2={x(index)}
          y1={pad}
          y2={height - pad}
        >
          {pointTitles?.[index] != null && <title>{pointTitles[index]}</title>}
        </line>
      ))}
      {segments.map((segment, index) => {
        const only = segment.length === 1 ? segment[0] : undefined;
        return only !== undefined ? (
          <circle
            key={index}
            className={styles.endDot}
            data-testid="sparkline-isolated-point"
            cx={only.cx}
            cy={only.cy}
            r={1.8}
          />
        ) : (
          <path
            key={index}
            className={styles.line}
            d={segment
              .map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(2)},${p.cy.toFixed(2)}`)
              .join(" ")}
          />
        );
      })}
      {endDot && lastValue !== null && lastValue !== undefined && lastIndex >= 0 && (
        <circle className={styles.endDot} cx={x(lastIndex)} cy={y(lastValue)} r={2.2} />
      )}
      {/* Invisible per-index hit rects (SHOULD-FIX 8): width = step, full
          height, transparent fill — a FINITE point's hover text is as
          reachable as a gap tick's. Rendered last so they sit on top; a rect
          spans only to the midpoints toward its neighbors, so gap ticks keep
          their own hover. */}
      {pointTitles !== undefined &&
        values.map((value, index) => {
          if (value === null || !Number.isFinite(value)) return null;
          const title = pointTitles[index];
          if (title === null || title === undefined) return null;
          const hitW = step > 0 ? step : width - pad * 2;
          return (
            <rect
              key={`hit-${String(index)}`}
              className={styles.hitTarget}
              data-testid="sparkline-hit"
              x={x(index) - hitW / 2}
              y={0}
              width={hitW}
              height={height}
            >
              <title>{title}</title>
            </rect>
          );
        })}
    </svg>
  );
}
