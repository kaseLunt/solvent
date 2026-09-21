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
//     scales never fabricate drama by cropping the floor away;
//   - no direct label is struck through: each sits ABOVE the reference it
//     names (the y-max above the line, the newest figure above its point, the
//     0 on top of the floor rule), is painted after the line and the points,
//     and wears a halo in the panel's ground;
//   - Wave W-OBS: the panel answers WITHOUT a click — the drawn y-max wears
//     its exact display string, the x-axis states its extent buckets (and the
//     selected bucket's time), and the newest captured point prints the same
//     figure the summary card above carries. All label strings arrive from
//     the caller's existing formatters (LAW-5: no number lives only in a
//     hover; LAW-4: displayed numbers are string work, floats only place them).
//
// Values are GEOMETRY only — exact decimal strings live in adjacent mono
// text and in the point-detail panel. Styling: shared chart atoms are
// imported read-only from charts.module.css; everything new is inline.

import type { KeyboardEvent } from "react";
import { MONO_CH_FALLBACK } from "@/lib/useMeasuredWidth";
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
  /**
   * The drawn y-max's display string (Wave W-OBS): `seriesMaxPoint(...).label`
   * — the SAME formatter output the ledger register uses for that wire row,
   * derived from the drawn domain, never invented. Omit when nothing plots
   * above the zero floor (the floor's own "0" label already states the max).
   */
  yMaxLabel?: string;
  /** The oldest axis entry's bucket hour (the head's own UTC format). */
  xStartLabel?: string;
  /** The newest axis entry's bucket hour (the head's own UTC format). */
  xEndLabel?: string;
  /**
   * The SELECTED bucket's hour, drawn on its own axis row at the selected
   * x position. Pass only while a selection exists.
   */
  selectedTimeLabel?: string;
  /**
   * Measured mono glyph width (px) from `useMonoCharWidth` — used ONLY to
   * clamp the selected-time label inside the frame. Falls back to the
   * deliberately generous probe fallback before first measurement.
   */
  charPx?: number;
  /**
   * Direct value at the NEWEST captured point: the same `displayMetric`
   * string the summary card above carries — one source, never retyped.
   * When the last plotted point is NOT the newest axis entry (the newest
   * bucket is withheld or carries this metric as null), the caller's pure
   * layer (`seriesNewestPoint(...).directLabel`) appends a
   * "(last captured {bucket})" qualifier to that string BEFORE it arrives
   * here; this component never re-derives it.
   */
  newestValueLabel?: string;
}

/** Height (rendered px) of each axis-label strip ADDED below the plot budget. */
const X_LABEL_STRIP = 14;

/** A plotted point's pointer radius (rendered px) — held whatever radius the visible dot is drawn at. */
const POINT_HIT_RADIUS = 2.4;

/**
 * The halo a direct label wears: its own glyphs stroked in the panel's ground and painted under the fill, so a
 * residual overlap can never strike a figure, in either theme. Inline, because the shared label atoms serve other
 * charts. A label is not a target: the points beneath it keep their hover and their click.
 */
const LABEL_HALO = {
  paintOrder: "stroke",
  stroke: "var(--panel)",
  strokeWidth: 3,
  strokeLinejoin: "round",
  pointerEvents: "none",
} as const;

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
  yMaxLabel,
  xStartLabel,
  xEndLabel,
  selectedTimeLabel,
  charPx,
  newestValueLabel,
}: ObservatorySeriesChartProps) {
  // The pads are split: the top pad is a label's height, so the y-max and the newest figure sit ABOVE the line they
  // name and never across it; the sides and the floor keep the hairline pad.
  const padX = 6;
  const padTop = 22;
  const padBottom = 6;
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const domain = includeZero ? [...finite, 0] : finite;
  const min = domain.length > 0 ? Math.min(...domain) : 0;
  const max = domain.length > 0 ? Math.max(...domain) : 1;
  const span = max - min || 1;
  const step = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;

  const x = (index: number) => padX + index * step;
  const y = (value: number) => height - padBottom - ((value - min) / span) * (height - padTop - padBottom);

  // The axis strips are ADDED below the `height` plot budget, so the plot
  // keeps its size whether or not a strip is drawn.
  const hasExtents = xStartLabel !== undefined || xEndLabel !== undefined;
  const extentsStrip = hasExtents ? X_LABEL_STRIP : 0;
  const selectedStrip =
    selectedTimeLabel !== undefined &&
    selectedIndex !== null &&
    selectedIndex >= 0 &&
    selectedIndex < values.length
      ? X_LABEL_STRIP
      : 0;
  const totalHeight = height + extentsStrip + selectedStrip;

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
  // At rest a dense series reads as a LINE, not a bead chain: below a 10px step the visible dot shrinks. Its pointer
  // target does not — a transparent stroke keeps the painted radius at POINT_HIT_RADIUS.
  const dotRadius = step > 0 && step < 10 ? 1.5 : POINT_HIT_RADIUS;
  const dotHitStroke = (POINT_HIT_RADIUS - dotRadius) * 2;

  const select = (index: number) => {
    if (onSelect !== undefined) onSelect(index);
  };
  const keySelect = (index: number) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(index);
    }
  };

  // The newest captured point (last finite value) — where the direct value
  // label prints. The STRING is the caller's; only its pixel position floats.
  const newestIndex = pointIndexes.length > 0 ? pointIndexes[pointIndexes.length - 1] : undefined;
  const newestValue = newestIndex !== undefined ? values[newestIndex] : undefined;

  // Clamp the selected-time label into the frame using MEASURED glyph width
  // (the corrected mono probe travels down from the caller), never a guess.
  const glyphPx = charPx ?? MONO_CH_FALLBACK;
  const selectedLabelX = (() => {
    if (selectedStrip === 0 || selectedIndex === null || selectedTimeLabel === undefined) return 0;
    const half = (selectedTimeLabel.length * glyphPx) / 2;
    if (half * 2 >= width) return width / 2;
    return Math.min(Math.max(x(selectedIndex), half + 1), width - half - 1);
  })();

  return (
    <svg
      className={styles.chart}
      width={width}
      height={totalHeight}
      viewBox={`0 0 ${String(width)} ${String(totalHeight)}`}
      role="img"
      aria-label={label}
    >
      {includeZero && (
        <g data-testid="obs-zero-floor">
          <line
            x1={padX}
            x2={width - padX}
            y1={y(0)}
            y2={y(0)}
            className={styles.baseline}
          />
        </g>
      )}

      {hasExtents && (
        <g>
          {xStartLabel !== undefined && (
            <text
              className={styles.axisLabel}
              data-testid="obs-x-start"
              x={padX}
              y={height + extentsStrip - 3}
            >
              {xStartLabel}
            </text>
          )}
          {xEndLabel !== undefined && (
            <text
              className={styles.axisLabel}
              data-testid="obs-x-end"
              x={width - padX}
              y={height + extentsStrip - 3}
              textAnchor="end"
            >
              {xEndLabel}
            </text>
          )}
        </g>
      )}

      {selectedStrip > 0 && selectedTimeLabel !== undefined && (
        // The selected bucket's own hour, on its own axis row at the selected
        // x — the interaction exists, so its time is stated, not hover-only.
        <text
          className={styles.axisLabel}
          data-testid="obs-x-selected"
          x={selectedLabelX}
          y={totalHeight - 3}
          textAnchor="middle"
        >
          {selectedTimeLabel}
        </text>
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
              y1={padTop}
              y2={height - padBottom}
            >
              {title !== undefined && <title>{title}</title>}
            </line>
            {kind === "withheld" && (
              // The warn form-mark: an OUTLINED square (color and form).
              <rect
                data-testid="obs-gap-warn"
                x={x(index) - 3}
                y={padTop}
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
            r={dotRadius}
            style={{
              stroke: "transparent",
              strokeWidth: dotHitStroke,
              ...(selectable ? { cursor: "pointer" } : {}),
            }}
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

      {/* The three direct labels are painted LAST, each ABOVE the reference it names and haloed in the panel's own
          ground: no rule, line or ring is ever drawn through a figure — a struck figure reads as a retracted one. */}
      {includeZero && (
        <text x={padX} y={y(0) - 4} className={styles.axisLabel} data-testid="obs-zero-label" style={LABEL_HALO}>
          0
        </text>
      )}

      {yMaxLabel !== undefined && (
        // The drawn y-max, labelled in the panel's own exact register — the
        // domain is [0, max of finite values], so this string IS that point's
        // ledger display, derived, never retyped.
        <text
          className={styles.axisLabel}
          data-testid="obs-ymax-label"
          // Starts PAST the first point's dot: when the max IS the first
          // captured bucket, a label at x = padX would sit on the dot itself.
          x={padX + 10}
          y={y(max) - 6}
          style={LABEL_HALO}
        >
          {yMaxLabel}
        </text>
      )}

      {newestValueLabel !== undefined &&
        newestIndex !== undefined &&
        newestValue !== null &&
        newestValue !== undefined && (
          // The newest captured point's figure, printed at the point — the
          // summary card's exact string (one source), so the picture answers
          // without a click.
          <text
            className={styles.valueLabel}
            data-testid="obs-newest-value"
            x={x(newestIndex) > width / 2 ? x(newestIndex) - 6 : x(newestIndex) + 6}
            y={Math.max(12, y(newestValue) - 8)}
            textAnchor={x(newestIndex) > width / 2 ? "end" : "start"}
            style={LABEL_HALO}
          >
            {newestValueLabel}
          </text>
        )}
    </svg>
  );
}
