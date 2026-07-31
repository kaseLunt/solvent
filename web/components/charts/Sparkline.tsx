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
}

/**
 * A dense inline sparkline (SVG, no chart lib). Values are used for GEOMETRY
 * only — exact numbers belong in adjacent mono text, not in this path.
 */
export function Sparkline({ values, width = 140, height = 36, endDot = true, label }: SparklineProps) {
  const pad = 3;
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const min = finite.length > 0 ? Math.min(...finite) : 0;
  const max = finite.length > 0 ? Math.max(...finite) : 1;
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
      {gapIndexes.map((index) => (
        <line
          key={index}
          className={styles.gapTick}
          x1={x(index)}
          x2={x(index)}
          y1={pad}
          y2={height - pad}
        />
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
