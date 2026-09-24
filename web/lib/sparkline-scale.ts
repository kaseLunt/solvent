// The small line charts' scales and direct-label placement, extracted PURE
// so specs can pin the laws instead of screenshotting geometry: the HF
// sparkline's drawn y-domain and bound labels, where a value label prints
// beside the lines a sparkline draws (its own series among them), and where
// History's series chart prints its peak label and axis ends.
//
// THE DOMAIN RULE, documented where it is implemented:
//
//   1. The domain starts as the extent [lo, hi] of the finite values, ALWAYS
//      extended to include the reference value (the HF 1.0 disclosure line)
//      when the chart draws one. The 1.0 line is never cropped away, however
//      far the series sits from it and however close the values crowd it.
//   2. Each side is then padded by 4% of the span, so a series is never
//      pinned to a frame edge (a flat-ish line on the top border reads as a
//      rendering fault, not a value).
//   3. A FLAT extent (hi === lo: a single plotted point, or an unmoving HF
//      equal to the reference) pads by max(4% of |value|, 0.02) so the flat
//      line renders mid-frame between a readable min/max pair instead of on
//      a zero-height band.
//   4. No finite values and no reference: [0, 1] — the component's historical
//      empty-domain fallback, kept identical.
//   5. (Codex r63) The padded bounds then LAND ON THOUSANDTHS, outward: the
//      min floors and the max ceils at 3dp, each after shedding no more than
//      5e-10 of float representation fuzz in the SAFE direction. The drawn
//      domain and its labels are therefore the SAME 3dp numbers — a label
//      can never sit inside the drawn bound, because it IS the drawn bound.
//      The plotted data stays strictly inside since every pad is at least
//      SPARKLINE_MIN_PAD (1e-6), four orders above the shed. (r62's fix
//      rounded at 1e-9 BEFORE the directed floor/ceil, so a bound a hair
//      past a 3dp boundary — an honest 1.0010000004 from pad arithmetic —
//      crossed INWARD and printed a ceiling below the drawn max.)
//
// Because the reference sits INSIDE [lo, hi] before padding, the padded
// domain contains it STRICTLY: the disclosure line cannot land on (or off)
// an edge.
//
// THE BOUND-LABEL RULE (Wave W-OBS-B, sharpened by r63 rule 5): the labels
// render the drawn bounds VERBATIM — the domain already carries the outward
// 3dp rule, so no direction is decided at label time. These labels annotate
// the PADDED axis bounds, never an account's HF, so the never-round-up
// display law for position claims does not apply — the outward rule is the
// instrument-honesty analogue: a printed range may overstate what it frames,
// never understate it. (The retired `hfAxisLabel` truncated both bounds,
// which ROUNDED THE MAX DOWN — a drawn max of 1.0832 sat above a printed
// "1.083" ceiling — and its round-at-micros step even rounded 0.9969996 UP
// to "0.997" while claiming truncation.)
//
// Pure functions — pinned by tests/unit/sparkline-scale.spec.ts.

import { truncateToDisplay } from "./book-format";

export interface SparklineDomain {
  min: number;
  max: number;
}

/** Rule 2: each side pads by this share of the span. */
export const SPARKLINE_PAD_RATIO = 0.04;

/** Rule 3: a flat extent never pads by less than this absolute amount. */
export const SPARKLINE_FLAT_PAD_FLOOR = 0.02;

/**
 * Rule 5: every pad is at least this much, so the thousandth-quantized
 * outward bounds (shed tolerance 5e-10) can never land at or inside the
 * data. Visually invisible; four orders above the shed.
 */
export const SPARKLINE_MIN_PAD = 0.000001;

/**
 * Rule 5's shed, in THOUSANDTHS-scale units (5e-7 scaled = 5e-10 absolute):
 * the directed floor/ceil absorbs float representation error (~1e-13 at
 * these magnitudes) without letting a genuinely-past-the-boundary bound
 * cross inward by more than 5e-10 — and the pad floor keeps the data more
 * than SPARKLINE_MIN_PAD away, so even that worst case stays outside the
 * plotted values.
 */
const BOUND_REPR_SHED = 0.0000005;

/** Floor to thousandths, shedding only representation fuzz (rule 5). */
function floorThousandths(value: number): number {
  return Math.floor(value * 1000 + BOUND_REPR_SHED);
}

/** Ceil to thousandths, shedding only representation fuzz (rule 5). */
function ceilThousandths(value: number): number {
  return Math.ceil(value * 1000 - BOUND_REPR_SHED);
}

/**
 * The padded sparkline y-domain (rules 1-4 above). `referenceValue` is the
 * drawn reference line's value (HF 1.0); pass it whenever the chart draws
 * one, so it can never be cropped out of the domain.
 */
export function paddedSparklineDomain(
  values: ReadonlyArray<number | null>,
  referenceValue?: number,
): SparklineDomain {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const domain =
    referenceValue !== undefined && Number.isFinite(referenceValue)
      ? [...finite, referenceValue]
      : finite;
  if (domain.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...domain);
  const hi = Math.max(...domain);
  const span = hi - lo;
  const pad =
    span > 0
      ? Math.max(span * SPARKLINE_PAD_RATIO, SPARKLINE_MIN_PAD)
      : Math.max(Math.abs(hi) * SPARKLINE_PAD_RATIO, SPARKLINE_FLAT_PAD_FLOOR);
  // Rule 5: the drawn bounds land on thousandths, OUTWARD, so the axis
  // labels can render them verbatim and containment is exact by identity.
  return {
    min: floorThousandths(lo - pad) / 1000,
    max: ceilThousandths(hi + pad) / 1000,
  };
}

/**
 * The MIN bound's label: the drawn bound VERBATIM. `paddedSparklineDomain`
 * already floored the min onto a thousandth (rule 5), so this only recovers
 * that integer through the directed floor (which, for a thousandth-quantized
 * input, sheds nothing but float representation error) and renders it
 * through the EXISTING HF register's formatter (`truncateToDisplay` over an
 * integer already AT 3dp — it only places the point and trims zeros).
 * A negative min floors AWAY from zero: at or below the drawn floor, never
 * above it.
 */
export function hfAxisMinLabel(bound: number): string {
  return truncateToDisplay(BigInt(floorThousandths(bound)), 3);
}

/**
 * The MAX bound's label: the drawn bound VERBATIM — the domain ceiled it
 * onto a thousandth (rule 5); the directed ceil here recovers that integer.
 * At or above the drawn max, never below it.
 */
export function hfAxisMaxLabel(bound: number): string {
  return truncateToDisplay(BigInt(ceilThousandths(bound)), 3);
}

// ---------------------------------------------------------------------------
// Direct labels beside the lines a chart draws across its plot. Chart text is
// 12px sans; its ink box is modelled generously (the halo included), so a
// placement that clears the box clears the glyphs.
// ---------------------------------------------------------------------------

/** A 12px label's ink above its baseline: cap height and ascenders, plus the halo, rounded up. */
export const LABEL_ASCENT_PX = 11;

/** A 12px label's ink below its baseline: descenders, plus the halo. */
export const LABEL_DESCENT_PX = 3;

/** The clear space between a line and the ink of the label that names it. */
export const LINE_LABEL_GAP_PX = 2;

/** The clear space a value label keeps from a line it does not name. */
export const NEWEST_LABEL_LINE_CLEAR_PX = 4;

/**
 * The collision band between two labels' baselines: the ink box is
 * LABEL_ASCENT_PX + LABEL_DESCENT_PX = 14px tall, so baselines under 15px
 * apart overlap their boxes.
 */
export const NEWEST_LABEL_COLLISION_PX = 15;

/**
 * The displacement past another label: one full label row, so a displaced
 * pair is always disjoint (16 > the 15px band).
 */
export const NEWEST_LABEL_ROW_PX = 16;

/** The space between a point and the near end of its value label, on either side. */
export const NEWEST_LABEL_OFFSET_PX = 6;

/**
 * One glyph's advance in a 12px sans figure string, bounded generously —
 * wider than a tabular digit — so a label's modelled span covers its ink.
 */
export const LABEL_GLYPH_BOUND_PX = 8;

export interface ChartPoint {
  x: number;
  y: number;
}

export interface SeriesSpan {
  top: number;
  bottom: number;
}

/**
 * The height each plotted run covers across [x0, x1]: its vertices inside the
 * span and the line's height where it crosses either end. A run is one
 * unbroken stretch of the series (a gap breaks the line), so each is its own
 * span; a run that never enters [x0, x1] adds none.
 */
export function seriesSpansAcross(runs: ReadonlyArray<ReadonlyArray<ChartPoint>>, x0: number, x1: number): SeriesSpan[] {
  const spans: SeriesSpan[] = [];
  for (const run of runs) {
    const ys: number[] = [];
    run.forEach((point, index) => {
      if (point.x >= x0 && point.x <= x1) ys.push(point.y);
      const next = run[index + 1];
      if (next === undefined) return;
      for (const edge of [x0, x1]) {
        if ((point.x - edge) * (next.x - edge) < 0) {
          ys.push(point.y + ((edge - point.x) / (next.x - point.x)) * (next.y - point.y));
        }
      }
    });
    if (ys.length > 0) spans.push({ top: Math.min(...ys), bottom: Math.max(...ys) });
  }
  return spans;
}

/**
 * The baseline of the label that names a line at `lineY`: on the preferred
 * side when its ink fits inside the plot's `height`, else on the other side —
 * never clipped by the frame and never struck by its own line. A frame too
 * short for either side keeps the preferred side.
 */
export function lineLabelBaseline(lineY: number, height: number, prefer: "above" | "below"): number {
  const above = lineY - LINE_LABEL_GAP_PX - LABEL_DESCENT_PX;
  const below = lineY + LINE_LABEL_GAP_PX + LABEL_ASCENT_PX;
  const aboveFits = above - LABEL_ASCENT_PX >= 0;
  const belowFits = below + LABEL_DESCENT_PX <= height;
  if (prefer === "above") return aboveFits || !belowFits ? above : below;
  return belowFits || !aboveFits ? below : above;
}

/**
 * Whether a boundary line is drawn: only where the drawn domain reaches it
 * (inclusive). A boundary never widens the domain — unlike a reference value,
 * which is always drawn — so a series that never approaches it shows no
 * boundary, and nothing is cropped to make room for one.
 */
export function lineInDomain(value: number, domain: SparklineDomain): boolean {
  return Number.isFinite(value) && value >= domain.min && value <= domain.max;
}

export interface SparklineNewestLabelPlacement {
  /** The label's text baseline y (SVG px). */
  y: number;
  /** True → textAnchor "end" just LEFT of the point; false → "start" just right of it. */
  anchorEnd: boolean;
}

/**
 * Where the newest-value label prints. It names the SERIES, so it keeps the
 * named-line gap (LINE_LABEL_GAP_PX) from the series across its own span; it
 * keeps NEWEST_LABEL_LINE_CLEAR_PX from a line it does not name (a reference,
 * a boundary) and never enters another label's collision band. The rule, in
 * order:
 *
 *   1. SIDE: a point right of the plot's midpoint labels leftward
 *      (anchorEnd), else rightward; the label's span starts
 *      NEWEST_LABEL_OFFSET_PX from the point and runs `labelWidth`.
 *   2. CANDIDATE: 6px above the point when that leaves headroom (baseline
 *      >= 12), else below it at min(height - 6, point + 14) — final when it
 *      is clear of every line, the series and every label.
 *   3. DISPLACEMENT: otherwise the nearest baseline inside [12, height - 6]
 *      taken from the obstacles' edges, first on the point's own side of every
 *      line — a value printed across a threshold from its point reads as the
 *      other side of the threshold (a point ON a line counts as over it). On
 *      that side, in order: clear of everything; the same with only the
 *      named-line gap from the lines; then over its own series (its halo
 *      knocks the series out beneath it), 4px and then the named-line gap
 *      from the lines — a line it does not name, or another label, is never
 *      overprinted short of the last resort. Only when its own side has none
 *      of these does it cross a line, in the same order.
 *   4. LAST RESORT: when nothing is clear (a very short frame), the
 *      candidate stands and the label is forced to anchorEnd — it extends
 *      LEFT of its point, out of the right-edge column where a line's label
 *      prints.
 */
export function sparklineNewestLabelPlacement(args: {
  pointX: number;
  pointY: number;
  /** The plot's horizontal midpoint (rule 1). */
  midX: number;
  height: number;
  /** The y of every line drawn across the plot (a reference, a boundary). */
  lineYs?: readonly number[];
  /** The baseline of every line label printed at the plot's right end. */
  labelYs?: readonly number[];
  /** The plotted runs of the series, each oldest first — the line this label names. */
  series?: ReadonlyArray<ReadonlyArray<ChartPoint>>;
  /** The label's modelled width: its characters × LABEL_GLYPH_BOUND_PX. */
  labelWidth?: number;
}): SparklineNewestLabelPlacement {
  const { pointX, pointY, midX, height, lineYs = [], labelYs = [], series = [], labelWidth = 0 } = args;
  const anchorEnd = pointX > midX;
  const candidate = pointY - 6 >= 12 ? pointY - 6 : Math.min(height - 6, pointY + 14);
  const spanStart = anchorEnd ? pointX - NEWEST_LABEL_OFFSET_PX - labelWidth : pointX + NEWEST_LABEL_OFFSET_PX;
  const spans = seriesSpansAcross(series, spanStart, spanStart + labelWidth);

  // The ink box [y - ascent, y + descent] keeps `gap` from the band [top, bottom], on either side of it.
  const clearOf = (y: number, top: number, bottom: number, gap: number) =>
    y + LABEL_DESCENT_PX + gap <= top || y - LABEL_ASCENT_PX - gap >= bottom;
  const edgesOf = (top: number, bottom: number, gap: number) => [
    top - gap - LABEL_DESCENT_PX,
    bottom + gap + LABEL_ASCENT_PX,
  ];
  const clearOfLabels = (y: number) => labelYs.every((label) => Math.abs(y - label) >= NEWEST_LABEL_COLLISION_PX);
  const tiers = [
    { lineGap: NEWEST_LABEL_LINE_CLEAR_PX, spans },
    { lineGap: LINE_LABEL_GAP_PX, spans },
    { lineGap: NEWEST_LABEL_LINE_CLEAR_PX, spans: [] },
    { lineGap: LINE_LABEL_GAP_PX, spans: [] },
  ] as const;
  const clearAt = (tier: (typeof tiers)[number]) => (y: number) =>
    lineYs.every((line) => clearOf(y, line, line, tier.lineGap)) &&
    tier.spans.every((span) => clearOf(y, span.top, span.bottom, LINE_LABEL_GAP_PX)) &&
    clearOfLabels(y);
  const first = tiers[0];
  if (clearAt(first)(candidate)) return { y: candidate, anchorEnd };

  const onPointSide = (y: number) => lineYs.every((line) => (pointY <= line) === (y < line));
  const nearest = (ys: readonly number[]) =>
    ys.reduce<number | undefined>(
      (best, y) => (best === undefined || Math.abs(y - candidate) < Math.abs(best - candidate) ? y : best),
      undefined,
    );
  for (const pointSideOnly of [true, false]) {
    for (const tier of tiers) {
      const clear = clearAt(tier);
      const ys = [
        candidate,
        ...lineYs.flatMap((line) => edgesOf(line, line, tier.lineGap)),
        ...tier.spans.flatMap((span) => edgesOf(span.top, span.bottom, LINE_LABEL_GAP_PX)),
        ...labelYs.flatMap((label) => [label - NEWEST_LABEL_ROW_PX, label + NEWEST_LABEL_ROW_PX]),
      ].filter((y) => y >= 12 && y <= height - 6 && clear(y) && (!pointSideOnly || onPointSide(y)));
      const chosen = nearest(ys);
      if (chosen !== undefined) return { y: chosen, anchorEnd };
    }
  }
  return { y: candidate, anchorEnd: true };
}

// ---------------------------------------------------------------------------
// History's series chart: where the peak label prints beside the newest
// figure's label, and which axis-end strings fit the plot.
// ---------------------------------------------------------------------------

/** The peak label's inset past the plot's side pad at the left edge: clear of the first point's dot. */
export const SERIES_EDGE_INSET_PX = 10;

/** How far the top strip grows when the peak label takes a row of its own: one label row. */
export const SERIES_PEAK_RAISE_PX = NEWEST_LABEL_ROW_PX;

export interface SeriesPeakLabelPlacement {
  /** "peak": centred over the peak; "edge": at the plot's left edge; "raised": on its own row above the plot. */
  place: "peak" | "edge" | "raised";
  x: number;
  anchor: "middle" | "start";
}

/**
 * Where the peak label prints. It never overprints the newest figure's label:
 * two labels collide when their baselines sit inside the collision band AND
 * their spans come within one glyph of each other. In order:
 *
 *   1. PEAK: centred over the peak (clamped into the frame), when the caller
 *      names the peak's x and the label is narrower than the plot.
 *   2. EDGE: at the plot's left edge, where the label's word still says what
 *      it is.
 *   3. RAISED: on a row of its own, SERIES_PEAK_RAISE_PX above the top strip —
 *      the caller grows the strip by exactly that, only in this case. Centred
 *      over the peak when it has one, else at the edge inset.
 *
 * Widths come from `glyphPx`, a measured, deliberately generous advance.
 */
export function seriesPeakLabelPlacement(args: {
  width: number;
  padX: number;
  glyphPx: number;
  labelChars: number;
  /** The peak's x, or null when the caller names no peak index. */
  peakX: number | null;
  peakBaselineY: number;
  /** The newest figure's label span and baseline, or null when none prints. */
  newest: { left: number; right: number; baselineY: number } | null;
}): SeriesPeakLabelPlacement {
  const { width, padX, glyphPx, labelChars, peakX, peakBaselineY, newest } = args;
  const labelW = labelChars * glyphPx;
  const half = labelW / 2;
  const collides = (left: number, right: number) =>
    newest !== null &&
    Math.abs(peakBaselineY - newest.baselineY) < NEWEST_LABEL_COLLISION_PX &&
    right + glyphPx >= newest.left &&
    left - glyphPx <= newest.right;
  const centre = peakX !== null && labelW < width ? Math.min(Math.max(peakX, half + 1), width - half - 1) : null;
  if (centre !== null && !collides(centre - half, centre + half)) return { place: "peak", x: centre, anchor: "middle" };
  const edge = padX + SERIES_EDGE_INSET_PX;
  if (!collides(edge, edge + labelW)) return { place: "edge", x: edge, anchor: "start" };
  return centre !== null
    ? { place: "raised", x: centre, anchor: "middle" }
    : { place: "raised", x: edge, anchor: "start" };
}

export interface SeriesAxisEnds {
  start?: string;
  end?: string;
  /** True when a compact form printed: the full strings then belong in the ends' titles. */
  compact: boolean;
}

/**
 * The axis-end strings the series chart prints: the full ones while both fit
 * the plot with two glyphs between them —
 * (start.length + end.length + 2) × glyphPx <= width − 2·padX — else each
 * end's compact form where the caller supplied one. Without compact forms the
 * full strings print.
 */
export function seriesAxisEnds(args: {
  start?: string;
  end?: string;
  startCompact?: string;
  endCompact?: string;
  width: number;
  padX: number;
  glyphPx: number;
}): SeriesAxisEnds {
  const { start, end, startCompact, endCompact, width, padX, glyphPx } = args;
  const fits = ((start?.length ?? 0) + (end?.length ?? 0) + 2) * glyphPx <= width - 2 * padX;
  if (fits || (startCompact === undefined && endCompact === undefined)) return { start, end, compact: false };
  return { start: startCompact ?? start, end: endCompact ?? end, compact: true };
}
