// LIVE contrast verification (p1a-6 — the styleguide is the living canon).
//
// The canon's §14 discipline: "every ratio recomputed from printed hexes,
// translucent grounds composited first" (build-contract §12.10). The
// styleguide does not PRINT audited numbers — it MEASURES its own rendered
// swatches through this module, so a palette drift dies in the styleguide's
// own pins before a page ever wears it. PURE: parsing, compositing, and the
// WCAG 2.x ratio live here where a unit spec (or a mutation) can reach them;
// the client component (app/styleguide/ContrastSpecimens.tsx) only feeds it
// getComputedStyle output.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

/**
 * Parse a computed CSS color (`rgb(r, g, b)` / `rgba(r, g, b, a)`, the two
 * forms getComputedStyle serializes for sRGB). Anything else — `transparent`
 * resolves to rgba(0,0,0,0), named colors never survive computation — returns
 * null so the caller can refuse to state a ratio rather than invent one.
 */
export function parseCssColor(value: string): Rgba | null {
  const match =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      value.trim(),
    );
  if (match === null) return null;
  const [, r, g, b, a] = match;
  if (r === undefined || g === undefined || b === undefined) return null;
  return {
    r: Number.parseFloat(r),
    g: Number.parseFloat(g),
    b: Number.parseFloat(b),
    a: a === undefined ? 1 : Number.parseFloat(a),
  };
}

/** Source-over compositing: translucent grounds composite before measuring. */
export function compositeOver(top: Rgba, base: Rgb): Rgb {
  const a = top.a;
  return {
    r: top.r * a + base.r * (1 - a),
    g: top.g * a + base.g * (1 - a),
    b: top.b * a + base.b * (1 - a),
  };
}

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an OPAQUE sRGB color. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * WCAG 2.x contrast ratio between two OPAQUE colors (composite first).
 * Range [1, 21]; ≥ 4.5 is the normal-text gate the canon binds both themes to.
 */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** The normal-text AA gate the canon's §04 ledger is audited against. */
export const AA_NORMAL_TEXT = 4.5;

/** Two decimals — the precision the canon's own ledger prints (4.53, 4.51…). */
export function formatRatio(ratio: number): string {
  return ratio.toFixed(2);
}
