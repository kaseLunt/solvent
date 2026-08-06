// The HF sparkline's drawn y-domain, extracted PURE (Wave W-OBS) so specs can
// pin the scale law instead of screenshotting geometry.
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
// Wave W-OBS-B — the newest-value label's placement, extracted PURE so the
// collision law (a flat-at-1.0 series must show two readable labels, not one
// smudge) is pinned by unit tests instead of screenshots.
// ---------------------------------------------------------------------------

/**
 * The collision band (Codex r63 widened it from 12): a 12px mono glyph
 * renders about 14px of ink top to bottom, so two baselines 12-14px apart
 * still overlap their boxes; the band must cover that interval. 15 keeps a
 * margin above the 14px ink height while staying below the 16px
 * displacement row, so a displaced pair is always disjoint.
 */
export const NEWEST_LABEL_COLLISION_PX = 15;

/**
 * The displacement: one full label row. A 12px glyph renders ~14px of ink
 * top-to-bottom, so 16px between baselines leaves clear space between the
 * two labels' boxes.
 */
export const NEWEST_LABEL_ROW_PX = 16;

export interface SparklineNewestLabelPlacement {
  /** The label's text baseline y (SVG px). */
  y: number;
  /** True → textAnchor "end" just LEFT of the point; false → "start" just right of it. */
  anchorEnd: boolean;
}

/**
 * Where the newest-value label prints (Wave W-OBS-B). The rule, in order:
 *
 *   1. SIDE: a point right of the plot's midpoint labels leftward
 *      (anchorEnd), else rightward — the historical rule, unchanged.
 *   2. BASELINE candidate: 6px above the point when that leaves headroom
 *      (baseline >= 12), else below it at min(height - 6, point + 14) — the
 *      historical rule, unchanged, and final when no reference label renders
 *      or the candidate clears the collision band.
 *   3. COLLISION: when a reference label renders and the candidate baseline
 *      lands within NEWEST_LABEL_COLLISION_PX of its baseline, the newest
 *      label displaces one label row (NEWEST_LABEL_ROW_PX) to the FAR side
 *      of the reference label — across it from the candidate — so a
 *      flat-at-1.0 series shows two distinct readable labels. If the far
 *      side falls outside [12, height - 6], the near side is tried instead.
 *   4. LAST RESORT: when neither side fits (a very short frame), the
 *      baseline stays at the candidate and the label is forced to anchorEnd
 *      — it extends LEFT of its point, out of the right-edge column where
 *      the reference label prints, so the two cannot also overlap
 *      horizontally.
 */
export function sparklineNewestLabelPlacement(args: {
  pointX: number;
  pointY: number;
  /** The plot's horizontal midpoint (rule 1). */
  midX: number;
  height: number;
  /** The reference label's baseline y, ONLY when that label renders. */
  referenceLabelY?: number;
}): SparklineNewestLabelPlacement {
  const { pointX, pointY, midX, height, referenceLabelY } = args;
  let anchorEnd = pointX > midX;
  let y = pointY - 6 >= 12 ? pointY - 6 : Math.min(height - 6, pointY + 14);
  if (referenceLabelY !== undefined && Math.abs(y - referenceLabelY) < NEWEST_LABEL_COLLISION_PX) {
    const fits = (baseline: number) => baseline >= 12 && baseline <= height - 6;
    // The far side of the reference label, seen from the candidate: a
    // candidate at/above it displaces below it, and vice versa (crossing
    // the reference label also crosses away from the point the candidate
    // tracks, so the displaced label clears both).
    const far =
      y <= referenceLabelY
        ? referenceLabelY + NEWEST_LABEL_ROW_PX
        : referenceLabelY - NEWEST_LABEL_ROW_PX;
    const near =
      y <= referenceLabelY
        ? referenceLabelY - NEWEST_LABEL_ROW_PX
        : referenceLabelY + NEWEST_LABEL_ROW_PX;
    if (fits(far)) {
      y = far;
    } else if (fits(near)) {
      y = near;
    } else {
      anchorEnd = true;
    }
  }
  return { y, anchorEnd };
}
