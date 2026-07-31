// The Observatory's bucket-series chart (W4-owned; NEW component — the four
// shared chart files are untouched). One engine's metric across the bucket
// axis:
//
//   - the line BREAKS at every gap (absent bucket, withheld bucket, null
//     metric) — this component never interpolates across missing data;
//   - every plotted point is a hover/click target carrying its provenance
//     title (bucket as-of + watermark block), and every gap tick carries its
//     NAMED reason — provenance on hover, not buried;
//   - a withheld gap wears the warn form-mark (outlined square — color AND
//     form, the W0 severity ruling) so a refusal never reads as a mere hole;
//   - the zero floor is drawn whenever `includeZero` holds (the default):
//     scales never fabricate drama by cropping the floor away.
//
// Values are GEOMETRY only — exact decimal strings live in adjacent mono
// text and in the point-detail panel. Styling: shared chart atoms are
// imported read-only from charts.module.css; everything new is inline.

import type { KeyboardEvent } from "react";
import styles from "./charts.module.css";

export interface ObservatorySeriesChartProps {
  /** The series, oldest first. Null is a GAP — an uncaptured/withheld bucket. */
  values: ReadonlyArray<number | null>;
  /** Per-entry hover text, aligned index-for-index with `values`. */
  titles: ReadonlyArray<string>;
  /** Aligned gap vocabulary (data-kind on the tick); null where a value plots. */
  gapKinds: ReadonlyArray<string | null>;
  /** Accessible description, e.g. "debt (usd) across rollup buckets". */
  label: string;
  width?: number;
  height?: number;
  /** Include 0 in the y-domain (default true) — floors are never hidden. */
  includeZero?: boolean;
  /** The selected bucket index (highlighted with a ring). */
  selectedIndex?: number | null;
  /** Select a bucket (fired by points AND gap hit-targets). */
  onSelect?: (index: number) => void;
}

export function ObservatorySeriesChart({
  values,
  titles,
  gapKinds,
  label,
  width = 320,
  height = 96,
  includeZero = true,
  selectedIndex = null,
  onSelect,
}: ObservatorySeriesChartProps) {
  const pad = 6;
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const domain = includeZero ? [...finite, 0] : finite;
  const min = domain.length > 0 ? Math.min(...domain) : 0;
  const max = domain.length > 0 ? Math.max(...domain) : 1;
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;

  const x = (index: number) => pad + index * step;
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);

  // Segments between gaps; each renders as its own path (never bridged).
  const segments: string[] = [];
  let current: string[] = [];
  const gapIndexes: number[] = [];
  const pointIndexes: number[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      gapIndexes.push(index);
      return;
    }
    pointIndexes.push(index);
    current.push(`${current.length === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

  const hitHalf = Math.max(3, step * 0.35);
  const selectable = onSelect !== undefined;

  const select = (index: number) => {
    if (onSelect !== undefined) onSelect(index);
  };
  const keySelect = (index: number) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(index);
    }
  };

  return (
    <svg
      className={styles.chart}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={label}
    >
      {includeZero && (
        <g data-testid="obs-zero-floor">
          <line
            x1={pad}
            x2={width - pad}
            y1={y(0)}
            y2={y(0)}
            className={styles.baseline}
          />
          <text x={pad} y={Math.min(height - 2, y(0) + 10)} className={styles.axisLabel}>
            0
          </text>
        </g>
      )}

      {gapIndexes.map((index) => {
        const kind = gapKinds[index] ?? "absent";
        const title = titles[index];
        return (
          <g key={`gap-${String(index)}`}>
            <line
              className={styles.gapTick}
              data-testid="obs-gap"
              data-kind={kind}
              x1={x(index)}
              x2={x(index)}
              y1={pad}
              y2={height - pad}
            >
              {title !== undefined && <title>{title}</title>}
            </line>
            {kind === "withheld" && (
              // The warn form-mark: an OUTLINED square (color and form).
              <rect
                data-testid="obs-gap-warn"
                x={x(index) - 3}
                y={pad}
                width={6}
                height={6}
                style={{ fill: "transparent", stroke: "var(--warn)", strokeWidth: 1.5 }}
              >
                {title !== undefined && <title>{title}</title>}
              </rect>
            )}
            {selectable && (
              <rect
                data-testid="obs-gap-hit"
                data-index={index}
                x={x(index) - hitHalf}
                y={0}
                width={hitHalf * 2}
                height={height}
                style={{ fill: "transparent", cursor: "pointer" }}
                role="button"
                aria-label={title ?? `bucket ${String(index)}`}
                tabIndex={0}
                onClick={() => { select(index); }}
                onKeyDown={keySelect(index)}
              >
                {title !== undefined && <title>{title}</title>}
              </rect>
            )}
          </g>
        );
      })}

      {segments.map((d, index) => (
        <path key={`seg-${String(index)}`} className={styles.line} d={d} />
      ))}

      {pointIndexes.map((index) => {
        const value = values[index];
        if (value === null || value === undefined) return null;
        const title = titles[index];
        return (
          <circle
            key={`pt-${String(index)}`}
            data-testid="obs-point"
            data-index={index}
            className={styles.endDot}
            cx={x(index)}
            cy={y(value)}
            r={2.4}
            style={selectable ? { cursor: "pointer" } : undefined}
            role={selectable ? "button" : undefined}
            aria-label={title}
            tabIndex={selectable ? 0 : undefined}
            onClick={selectable ? () => { select(index); } : undefined}
            onKeyDown={selectable ? keySelect(index) : undefined}
          >
            {title !== undefined && <title>{title}</title>}
          </circle>
        );
      })}

      {selectedIndex !== null &&
        selectedIndex >= 0 &&
        selectedIndex < values.length && (
          <circle
            data-testid="obs-selected"
            cx={x(selectedIndex)}
            cy={(() => {
              const v = values[selectedIndex];
              return v !== null && v !== undefined && Number.isFinite(v)
                ? y(v)
                : height / 2;
            })()}
            r={5}
            style={{ fill: "transparent", stroke: "var(--accent)", strokeWidth: 1.5 }}
          />
        )}
    </svg>
  );
}
