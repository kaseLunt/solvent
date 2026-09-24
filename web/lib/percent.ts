// Percent strings from two wire integers: exact in tenths, truncating toward
// zero, never through a float. The Book's headroom helpers own the room
// arithmetic; this module owns the plain "share of" and "fall from" cases, and
// `formatTenths` builds the percent string: the cut (truncate, floor) stays the
// caller's, the glyphs, the tenth and the sign are decided here once.
import { MINUS } from "./format";

/** ⌊1000 · num / den⌋ toward zero, as tenths of a percent. Null when den ≤ 0. */
export function percentTenths(num: bigint, den: bigint): bigint | null {
  if (den <= 0n) return null;
  return (1000n * num) / den;
}

export interface TenthsOptions {
  /** Keep a zero tenth ("12.0%"). A table cell or a tile value sets it, so a column aligns on the decimal; prose may drop it ("12%"). */
  readonly fixed?: boolean;
  /** "always" marks a rise with "+"; a fall always carries U+2212, and a zero carries no sign. */
  readonly sign?: "auto" | "always";
}

/**
 * Tenths of a percent as a string: "96.2%", "−3.8%", "0%". The tenths arrive already cut by the caller's own rule
 * (truncation toward zero here, a floor for headroom); this only prints them.
 */
export function formatTenths(tenths: bigint, options: TenthsOptions = {}): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  const sign = negative ? MINUS : tenths > 0n && options.sign === "always" ? "+" : "";
  const fraction = tenth === 0n && options.fixed !== true ? "" : `.${tenth.toString()}`;
  return `${sign}${whole.toString()}${fraction}%`;
}

/** The share `num` is of `den`, e.g. "96.2%". */
export function percentOf(num: bigint, den: bigint): string | null {
  const tenths = percentTenths(num, den);
  return tenths === null ? null : formatTenths(tenths);
}

/** The fall from `from` down to `to`, as a percent of `from`. Null for a rise, a negative `to`, or `from` ≤ 0. */
export function fallPercent(to: bigint, from: bigint): string | null {
  if (from <= 0n || to < 0n || to > from) return null;
  return formatTenths((1000n * (from - to)) / from);
}
