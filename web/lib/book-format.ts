// Book-surface display helpers (W1). Pure string/bigint arithmetic — no float
// ever holds a value on the DISPLAY path (floats appear only as chart GEOMETRY
// and the warn-band display ratio, both explicitly display-precision).
//
// These wrap `lib/format.ts`'s truth primitives: null still renders an em
// dash (never 0), and the exact value always survives into `title`-level
// affordances upstream. Pinned by tests/unit/book-format.spec.ts.

import { formatUnits, parseDecimal } from "@solvent/client";
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
 * THE ONE GROUPED-USD RENDERER (CX-4).
 *
 * `$1,234.56789` — exact string surgery at the given decimals, thousands
 * separated, trailing fractional zeros trimmed. Null is an em dash, never `$0`.
 *
 * This was `frontierView.labUsd`, a Lab-local helper, while two other Lab
 * surfaces rendered money through `renderNullableDecimal(value, {prefix:"$"})`
 * — which does NOT group. So one panel printed `$1,877,357.544497` and the
 * panel beside it printed `$1877357.544497` from the same wire field. Money is
 * grouped on this product; there is now one function that says so, and every
 * Lab money call site routes through it.
 *
 * `renderNullableDecimal` is deliberately NOT touched: it has many non-money
 * callers (health factors, balances, block counts) that must not gain a `$`
 * or a thousands separator.
 */
export function renderUsdAmount(value: string | null, decimals: number): string {
  if (value === null) return EM_DASH;
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/** The typographic minus (U+2212) — a hyphen is not a sign. */
export const MINUS_SIGN = "−";

/**
 * CX-8 — AN EXPLICIT SIGN ON EVERY DELTA.
 *
 * `+164` · `−3` (U+2212) · bare `0`. A signed net delta rendered as a bare
 * `164` reads as a gross count of arrivals; the sign is the only thing on
 * screen that says the number can go the other way.
 */
export function renderSignedCount(value: number): string {
  if (value > 0) return `+${value.toLocaleString("en-US")}`;
  if (value < 0) return `${MINUS_SIGN}${Math.abs(value).toLocaleString("en-US")}`;
  return "0";
}

/**
 * The same law for a monetary delta: `+$4,200`, `−$4,200`, `$0`.
 *
 * The sign leads the currency mark rather than sitting inside it, so a
 * negative delta can never be misread as a negative price.
 */
export function renderSignedUsdAmount(value: string | null, decimals: number): string {
  if (value === null) return EM_DASH;
  const units = parseDecimal(value);
  if (units === 0n) return renderUsdAmount("0", decimals);
  const magnitude = renderUsdAmount((units < 0n ? -units : units).toString(), decimals);
  return `${units > 0n ? "+" : MINUS_SIGN}${magnitude}`;
}

/**
 * CX-6 / CX-8 — a share of a NAMED denominator, by exact integer arithmetic.
 *
 * `count × 1000 / denominator`, truncated, rendered as tenths of a percent
 * with the trailing `.0` dropped. Null when the denominator is zero: a
 * percentage against nothing is not a small percentage, it is not a
 * percentage. Above 9,999% the string is `from near-zero` — a five-digit
 * percentage is a statement about the denominator, not about the numerator.
 */
export function sharePercent(count: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  const permille = (BigInt(count) * 1000n) / BigInt(denominator);
  if (permille > 99_990n) return "from near-zero";
  const whole = permille / 10n;
  const tenth = permille % 10n;
  return tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
}

/**
 * CX-6 GEOMETRY — the bar's proportional length in px, exact-integer derived.
 *
 * This replaces a permille bar fraction, which resolved the share to 1/1000
 * and then had a 1.5px nonempty floor applied on top. On a 240px axis that
 * floor drew 0.625% of the axis, so a bucket the row label truthfully printed
 * as `0%` occupied more ink than a bucket at a real 0.5%, and the two were
 * indistinguishable. The share is taken here in the AXIS' OWN pixel space at a
 * millionth of a pixel, and NO floor is applied: a length below what a pixel
 * can carry is not a small length, it is a length the picture cannot state,
 * and the caller marks presence with a different form instead.
 */
export function shareBarWidth(count: number, denominator: number, axisPx: number): number {
  if (denominator <= 0 || count <= 0 || axisPx <= 0) return 0;
  const micros = (BigInt(count) * BigInt(Math.round(axisPx * 1_000_000))) / BigInt(denominator);
  return Math.min(Number(micros) / 1_000_000, axisPx);
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
