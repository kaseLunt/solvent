// Geometry for the Scenarios charts. These numbers become an opacity and an x
// coordinate; they are never printed, so floats are allowed here and nowhere else.

/** The cell's share of the largest cell, clamped to [0, 1]; 0 for an empty or unreadable pair. */
export function heatIntensity(count: number, max: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

export interface DotPlotScale {
  /** The domain's half-width in signed tenths of a percent (at least 1.0 %, so a zero sits inside a domain). */
  readonly maxAbsTenths: bigint;
  readonly left: number;
  readonly right: number;
  readonly zeroX: number;
  readonly x: (tenths: bigint) => number;
}

/** A symmetric percent axis: zero in the middle, the largest |value| on either pad. */
export function dotPlotScale(values: readonly (bigint | null)[], width: number, pad = 12): DotPlotScale {
  let maxAbs = 0n;
  for (const v of values) {
    if (v === null) continue;
    const a = v < 0n ? -v : v;
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0n) maxAbs = 10n;
  const left = pad;
  const right = Math.max(pad + 1, width - pad);
  const half = (right - left) / 2;
  const zeroX = left + half;
  const domain = Number(maxAbs);
  return { maxAbsTenths: maxAbs, left, right, zeroX, x: (t) => zeroX + (Number(t) / domain) * half };
}

/** The dot plot's two text columns, in whole CSS pixels. */
export interface DotPlotColumns {
  /** The row-label column: the longest label's glyphs plus its pad, held between the floor and the ceiling. */
  readonly labelW: number;
  /** The value column: the longest value's glyphs plus its pad, never under its floor. */
  readonly valueW: number;
}

/** The label column never collapses under a short set of names. */
export const DOT_PLOT_LABEL_MIN = 160;
/** The label column never takes the plot's whole budget. */
export const DOT_PLOT_LABEL_MAX = 320;
/** The gap between the longest label's last glyph and the track. */
export const DOT_PLOT_LABEL_PAD = 8;
/** The value column's floor; it grows to fit its longest text. */
export const DOT_PLOT_VALUE_MIN = 120;
/** The gap between the track and the value column's first glyph, and after its longest text. */
export const DOT_PLOT_VALUE_PAD = 16;

/**
 * The dot plot's text columns from a MEASURED glyph (LF-8): a mono column is measured, never
 * estimated. `glyphPx` is one mono `0`'s rendered width from `useMonoCharWidth`; each column is
 * its longest text's glyph count times that width plus its pad, rounded UP to a whole pixel, so
 * no column is ever a fraction narrower than the text it holds. The value column renders in the
 * mono face the glyph came from; the label column renders in the sans face and is budgeted at
 * the mono advance per character, which sits above the sans face's mean advance at the same
 * size. An unmeasurable glyph (not finite, or not positive) is not estimated either: the columns
 * fall to their floors.
 */
export function dotPlotColumns(labels: readonly string[], values: readonly string[], glyphPx: number): DotPlotColumns {
  const glyph = Number.isFinite(glyphPx) && glyphPx > 0 ? glyphPx : 0;
  const longest = (texts: readonly string[]) => texts.reduce((m, t) => Math.max(m, t.length), 0);
  const labelW = Math.min(DOT_PLOT_LABEL_MAX, Math.max(DOT_PLOT_LABEL_MIN, Math.ceil(longest(labels) * glyph + DOT_PLOT_LABEL_PAD)));
  const valueW = Math.max(DOT_PLOT_VALUE_MIN, Math.ceil(longest(values) * glyph + DOT_PLOT_VALUE_PAD));
  return { labelW, valueW };
}
