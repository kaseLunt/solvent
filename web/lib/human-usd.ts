/**
 * Compact money for headlines and tiles (spec 2026-09-15 §3.3–§3.4).
 * Bigint throughout; TRUNCATES toward zero so a figure "at risk" is never
 * rounded up. Exact strings stay on the exact layer (ExactValue); this is
 * layer 1 only.
 */
import { isWireScale, WireIntegerError } from "./wireGuard";

export const DUST_DISPLAY = "<$0.01";
export const MINUS = "−";

function groupThousands(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Scale down by 10^n, truncating. */
function scaleDown(value: bigint, n: number): bigint {
  return n <= 0 ? value * 10n ** BigInt(-n) : value / 10n ** BigInt(n);
}

function oneDecimal(cents: bigint, unitCents: bigint, suffix: string): string {
  const tenths = (cents * 10n) / unitCents; // truncated tenths of the unit
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  return tenth === 0n ? `$${whole.toString()}${suffix}` : `$${whole.toString()}.${tenth.toString()}${suffix}`;
}

export function humanUsd(value: bigint, decimals: number): string {
  // A scale is validated before anything is formatted at it: -0 would multiply
  // instead of divide, a negative would throw a nameless RangeError, a large
  // one would never return.
  if (!isWireScale(decimals)) {
    throw new WireIntegerError(
      `decimals is not a wire scale (an integer in [0, 1000], never -0): got ${Object.is(decimals, -0) ? "-0" : String(decimals)} — refused before formatting`,
    );
  }
  if (value < 0n) return `${MINUS}${humanUsd(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = scaleDown(value, decimals - 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000_000_000n) return oneDecimal(cents, 100_000_000_000n, "B");
  if (dollars >= 1_000_000n) return oneDecimal(cents, 100_000_000n, "M");
  if (dollars >= 10_000n) return `$${groupThousands(dollars / 1000n)}K`;
  if (dollars >= 1_000n) return `$${groupThousands(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}
