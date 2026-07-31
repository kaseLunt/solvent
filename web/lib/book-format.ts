// Book-surface display helpers (W1). Pure string/bigint arithmetic — no float
// ever holds a value on the DISPLAY path (floats appear only as chart GEOMETRY
// and the warn-band display ratio, both explicitly display-precision).
//
// These wrap `lib/format.ts`'s truth primitives: null still renders an em
// dash (never 0), and the exact value always survives into `title`-level
// affordances upstream. Pinned by tests/unit/book-format.spec.ts.

import { parseDecimal } from "@solvent/client";
import { EM_DASH, renderNullableDecimal } from "./format";

/**
 * Insert thousands separators into a plain decimal string ("4200000.5" →
 * "4,200,000.5"). String surgery only; the digits are untouched.
 */
export function groupDecimalString(value: string): string {
  const negative = value.startsWith("-") || value.startsWith("−");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "", fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? value[0] ?? "" : "";
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

/**
 * Render an engine-native integer amount (`NullableDecimal` at
 * `value_decimals`) with separators. Null stays an em dash — the
 * null-never-zero law — and the unit is the ENGINE's own (disclosed by the
 * caller via the aggregate's `unit_note`; no invented "$").
 */
export function renderEngineAmount(value: string | null, decimals: number): string {
  if (value === null) return EM_DASH;
  return groupDecimalString(renderNullableDecimal(value, { decimals }));
}

/**
 * A display health factor truncated to 3 fraction digits, from an exact
 * integer at `decimals`. Truncation (never rounding): a truncated HF can only
 * UNDERSTATE health, the conservative direction. "1.080" trims to "1.08".
 */
export function truncateToDisplay(value: bigint, decimals: number): string {
  const scaled = decimals >= 3 ? value / 10n ** BigInt(decimals - 3) : value * 10n ** BigInt(3 - decimals);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  const body = frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
  return negative ? `−${body}` : body;
}

/** Display HF from an Aave wad (18-dec), truncated to 3 fraction digits. */
export function hfDisplayFromWad(wad: string): string {
  return truncateToDisplay(parseDecimal(wad), 18);
}

/**
 * Display HF from an exact num/den rational (the Debt Manager's
 * maxBorrowLT/borrowings disclosure), truncated to 3 fraction digits.
 * Returns null when the ratio is undefined (zero denominator).
 */
export function hfDisplayFromRatio(num: bigint, den: bigint): string | null {
  if (den === 0n) return null;
  return truncateToDisplay((num * 1000n) / den, 3);
}

/**
 * Signed percent distance of an exact factor num/den from 1.0, one truncated
 * fraction digit: (num/den − 1) × 100. E.g. 6000/6480 → "−7.5%". This is the
 * liq-distance column's display: how far the factor axis must move before the
 * position crosses its OWN engine's boundary.
 */
export function factorDistancePercent(num: bigint, den: bigint): string | null {
  if (den === 0n) return null;
  const permille = (num * 1000n) / den - 1000n;
  const negative = permille < 0n;
  const abs = negative ? -permille : permille;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  const body = tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
  return `${negative ? "−" : "+"}${body}%`;
}
