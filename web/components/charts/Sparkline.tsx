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
   * being interpolated over.
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

  // Segments between gaps; each renders as its own path.
  const segments: string[] = [];
  let current: string[] = [];
  const gapIndexes: number[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      gapIndexes.push(index);
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

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
            x1={pad}
            x2={width - pad}
            y1={y(referenceValue)}
            y2={y(referenceValue)}
            style={{ stroke: "var(--crit)", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.55 }}
          />
          {referenceLabel !== undefined && (
            <text
              x={width - pad}
              y={Math.max(8, y(referenceValue) - 3)}
              textAnchor="end"
              style={{ fontFamily: "var(--mono)", fontSize: 9, fill: "var(--crit)", opacity: 0.75 }}
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
      {segments.map((d, index) => (
        <path key={index} className={styles.line} d={d} />
      ))}
      {endDot && lastValue !== null && lastValue !== undefined && lastIndex >= 0 && (
        <circle className={styles.endDot} cx={x(lastIndex)} cy={y(lastValue)} r={2.2} />
      )}
    </svg>
  );
}
