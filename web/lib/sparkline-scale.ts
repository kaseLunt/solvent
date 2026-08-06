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
//
// Because the reference sits INSIDE [lo, hi] before padding, the padded
// domain contains it STRICTLY: the disclosure line cannot land on (or off)
// an edge.
//
// LAW-4 note: these numbers are GEOMETRY (pixel positions). The displayed
// bound labels go through `hfAxisLabel`, which reuses the existing HF
// truncation register (`truncateToDisplay`, the same helper behind
// `hfDisplayFromWad`) — no new formatter, truncation and never rounding.
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
      ? span * SPARKLINE_PAD_RATIO
      : Math.max(Math.abs(hi) * SPARKLINE_PAD_RATIO, SPARKLINE_FLAT_PAD_FLOOR);
  return { min: lo - pad, max: hi + pad };
}

/**
 * A drawn domain bound, displayed through the EXISTING HF truncation
 * register: `truncateToDisplay` (3 fraction digits, truncation never
 * rounding — the same helper `hfDisplayFromWad` wraps). The bound is scaled
 * to millionths first; the rounding there only sheds float representation
 * fuzz three orders of magnitude below the displayed precision, and the
 * displayed digits are still produced by exact-integer truncation.
 */
export function hfAxisLabel(bound: number): string {
  return truncateToDisplay(BigInt(Math.round(bound * 1_000_000)), 6);
}
