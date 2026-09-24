import {
  LABEL_GLYPH_BOUND_PX,
  lineInDomain,
  lineLabelBaseline,
  NEWEST_LABEL_OFFSET_PX,
  sparklineNewestLabelPlacement,
} from "@/lib/sparkline-scale";
import styles from "./charts.module.css";
import { LABEL_HALO } from "./label-halo";

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
   * Optional horizontal reference line (e.g. room = 10% of the cap, the
   * near-cap line). The value is INCLUDED in the y-domain, so the line stays
   * visible even when every point sits on one side of it.
   */
  referenceValue?: number;
  /**
   * The reference line's name, printed at its right end just above it (below
   * it where the frame has no room above) — the caller's string, e.g.
   * "10% of cap". Rendered only with `referenceValue`.
   */
  referenceLabel?: string;
  /**
   * The reference line's tone, in the tables' vocabulary: "warn" (the
   * default) for a near-cap line, "crit" for a line that IS the liquidation
   * boundary (a health factor of 1.0).
   */
  referenceTone?: "warn" | "crit";
  /**
   * Optional crit boundary line (e.g. room = 0%, where debt passes the cap).
   * Unlike the reference it never widens the y-domain: it is drawn only
   * where the drawn domain reaches it, so a series that never approaches the
   * boundary shows none.
   */
  boundaryValue?: number;
  /** The boundary's name, printed at its right end just below it — the side past the boundary. */
  boundaryLabel?: string;
  /**
   * Per-point hover text (SVG `<title>`), aligned index-for-index with
   * `values`. Rendered on GAP ticks — the reason a point could not be
   * established (a refusal, a withheld book) travels with the gap instead of
   * being interpolated over — AND on invisible full-height hit rects over
   * FINITE points (design SHOULD-FIX 8), so a computed value's exact hover
   * text is as reachable as a gap's reason.
   */
  pointTitles?: ReadonlyArray<string | null>;
  /**
   * Drawn y-domain override (Wave W-OBS). Computed by the PURE module
   * `lib/sparkline-scale` (`paddedSparklineDomain`) so specs pin the scale
   * law and the axis labels derive from the SAME numbers the geometry uses.
   * When absent, the inline extent (finite values + reference) applies,
   * unchanged.
   */
  domain?: { min: number; max: number };
  /**
   * Direct y-axis bound labels for the drawn domain (LAW-5: a bound is a
   * number, and no number lives only in a hover). Strings come from the
   * caller's existing formatter register, never composed here.
   */
  yLabels?: { min: string; max: string };
  /**
   * Left gutter (RENDERED px) reserved for `yLabels` — sized by the caller
   * from measured mono glyphs (`useMonoCharWidth`), never estimated here.
   */
  yGutterPx?: number;
  /** X-axis extent labels: the oldest and newest axis entry, drawn below the plot. */
  xLabels?: { start: string; end?: string };
  /**
   * Direct value label at the newest PLOTTED point — the same computed
   * display string the panel head cites (one source), so the picture answers
   * without a hover. When the last plotted batch is NOT the newest witnessed
   * batch, the caller's pure layer appends a "(batch {id})" qualifier to that
   * string BEFORE it arrives here; this component never re-derives it.
   */
  newestLabel?: string;
}

/** The x-label strip's height in rendered px (added BELOW the plot budget). */
const X_LABEL_STRIP = 14;

/** A line's stroke and its label's fill, per tone: the stroke in the tone's fill grade, the label in its text grade. */
const REFERENCE_TONE = {
  warn: { line: styles.refLineWarn, label: styles.refLabelWarn },
  crit: { line: styles.refLineCrit, label: styles.refLabelCrit },
} as const;

/**
 * A dense inline sparkline (SVG, no chart lib). Values are used for GEOMETRY
 * only — every printed string is the caller's; this component places it.
 */
export function Sparkline({
  values,
  width = 140,
  height = 36,
  endDot = true,
  label,
  referenceValue,
  referenceLabel,
  referenceTone = "warn",
  boundaryValue,
  boundaryLabel,
  pointTitles,
  domain,
  yLabels,
  yGutterPx,
  xLabels,
  newestLabel,
}: SparklineProps) {
  const pad = 3;
  // The plot's left edge: the y-label gutter when bounds are drawn, else the
  // historical pad (geometry byte-identical for callers without labels).
  const plotLeft = yLabels !== undefined ? Math.max(pad, yGutterPx ?? 40) : pad;
  // The x-label strip is ADDED below the `height` budget, so the plot keeps
  // its size and existing callers keep their exact output.
  const totalHeight = height + (xLabels !== undefined ? X_LABEL_STRIP : 0);
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const inlineDomain =
    referenceValue !== undefined && Number.isFinite(referenceValue)
      ? [...finite, referenceValue]
      : finite;
  const min =
    domain !== undefined ? domain.min : inlineDomain.length > 0 ? Math.min(...inlineDomain) : 0;
  const max =
    domain !== undefined ? domain.max : inlineDomain.length > 0 ? Math.max(...inlineDomain) : 1;
  const span = max - min || 1;
  const step = values.length > 1 ? (width - plotLeft - pad) / (values.length - 1) : 0;

  const x = (index: number) => plotLeft + index * step;
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

  // The lines drawn across the plot, and the labels naming them at its right end: the reference always (it is in the
  // domain), the boundary only where the drawn domain reaches it.
  const referenceY =
    referenceValue !== undefined && Number.isFinite(referenceValue) ? y(referenceValue) : undefined;
  const boundaryY =
    boundaryValue !== undefined && lineInDomain(boundaryValue, { min, max }) ? y(boundaryValue) : undefined;
  const referenceLabelY =
    referenceY !== undefined && referenceLabel !== undefined ? lineLabelBaseline(referenceY, height, "above") : undefined;
  const boundaryLabelY =
    boundaryY !== undefined && boundaryLabel !== undefined ? lineLabelBaseline(boundaryY, height, "below") : undefined;
  const present = (ys: ReadonlyArray<number | undefined>) => ys.filter((v): v is number => v !== undefined);

  // Where the newest-value label prints: the PURE placement rule (lib/sparkline-scale) — above its point, never on a
  // line or a line's label, clear of the series it names across its own span; displaced, it keeps its point's side of
  // every line while that side has room.
  const newestPlacement =
    newestLabel !== undefined && lastIndex >= 0 && lastValue !== null && lastValue !== undefined
      ? sparklineNewestLabelPlacement({
          pointX: x(lastIndex),
          pointY: y(lastValue),
          midX: plotLeft + (width - plotLeft - pad) / 2,
          height,
          lineYs: present([referenceY, boundaryY]),
          labelYs: present([referenceLabelY, boundaryLabelY]),
          series: segments.map((segment) => segment.map((p) => ({ x: p.cx, y: p.cy }))),
          labelWidth: newestLabel.length * LABEL_GLYPH_BOUND_PX,
        })
      : undefined;
  const tone = REFERENCE_TONE[referenceTone];

  return (
    <svg
      className={styles.chart}
      width={width}
      height={totalHeight}
      viewBox={`0 0 ${String(width)} ${String(totalHeight)}`}
      role="img"
      aria-label={label}
    >
      {referenceY !== undefined && (
        <line
          className={`${styles.refLine} ${tone.line}`}
          data-testid="sparkline-reference"
          data-tone={referenceTone}
          x1={plotLeft}
          x2={width - pad}
          y1={referenceY}
          y2={referenceY}
        />
      )}
      {boundaryY !== undefined && (
        <line
          className={`${styles.refLine} ${REFERENCE_TONE.crit.line}`}
          data-testid="sparkline-boundary"
          data-tone="crit"
          x1={plotLeft}
          x2={width - pad}
          y1={boundaryY}
          y2={boundaryY}
        />
      )}
      {yLabels !== undefined && (
        <g>
          <text
            className={styles.axisLabel}
            data-testid="sparkline-ymax-label"
            x={plotLeft - 6}
            y={Math.max(10, y(max) + 4)}
            textAnchor="end"
          >
            {yLabels.max}
          </text>
          <text
            className={styles.axisLabel}
            data-testid="sparkline-ymin-label"
            x={plotLeft - 6}
            y={Math.min(height - 2, y(min) + 2)}
            textAnchor="end"
          >
            {yLabels.min}
          </text>
        </g>
      )}
      {xLabels !== undefined && (
        <g>
          <text
            className={styles.axisLabel}
            data-testid="sparkline-x-start"
            x={plotLeft}
            y={totalHeight - 3}
          >
            {xLabels.start}
          </text>
          {xLabels.end !== undefined && xLabels.end !== "" && (
            <text
              className={styles.axisLabel}
              data-testid="sparkline-x-end"
              x={width - pad}
              y={totalHeight - 3}
              textAnchor="end"
            >
              {xLabels.end}
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
      {/* The direct labels are painted after the lines and the series, haloed in the panel's ground: where a label
          has to sit on its own series, the halo knocks the line out beneath the figure instead of striking it. */}
      {referenceLabelY !== undefined && (
        <text
          className={`${styles.refLabel} ${tone.label}`}
          data-testid="sparkline-reference-label"
          data-tone={referenceTone}
          x={width - pad}
          y={referenceLabelY}
          textAnchor="end"
          style={LABEL_HALO}
        >
          {referenceLabel}
        </text>
      )}
      {boundaryLabelY !== undefined && (
        <text
          className={`${styles.refLabel} ${REFERENCE_TONE.crit.label}`}
          data-testid="sparkline-boundary-label"
          data-tone="crit"
          x={width - pad}
          y={boundaryLabelY}
          textAnchor="end"
          style={LABEL_HALO}
        >
          {boundaryLabel}
        </text>
      )}
      {newestLabel !== undefined && newestPlacement !== undefined && (
        // The newest plotted value, printed AT its point — the caller's
        // computed string, qualifier included when the caller composed one
        // (one source, never retyped here). Position comes from the PURE
        // placement rule above; only pixels float in this component.
        <text
          className={styles.valueLabel}
          data-testid="sparkline-newest-value"
          x={newestPlacement.anchorEnd ? x(lastIndex) - NEWEST_LABEL_OFFSET_PX : x(lastIndex) + NEWEST_LABEL_OFFSET_PX}
          y={newestPlacement.y}
          textAnchor={newestPlacement.anchorEnd ? "end" : "start"}
          style={LABEL_HALO}
        >
          {newestLabel}
        </text>
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
          const hitW = step > 0 ? step : width - plotLeft - pad;
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
