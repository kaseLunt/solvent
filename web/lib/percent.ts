// Percent strings from two wire integers: exact in tenths, truncating toward
// zero, never through a float. The Book's headroom helpers own the room
// arithmetic; this module owns the plain "share of" and "fall from" cases.
import { MINUS } from "./human-usd";

/** ⌊1000 · num / den⌋ toward zero, as tenths of a percent. Null when den ≤ 0. */
export function percentTenths(num: bigint, den: bigint): bigint | null {
  if (den <= 0n) return null;
  return (1000n * num) / den;
}

export function formatTenths(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  return `${negative ? MINUS : ""}${whole.toString()}${tenth === 0n ? "" : `.${tenth.toString()}`}%`;
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
