// Exact arithmetic over the contract's decimal strings.
//
// # Why none of this returns a number
//
// Every money quantity in `api/openapi.yaml` is a decimal STRING. Health factors
// are 18-decimal integers, Aave base values 8-decimal, Debt Manager USD
// 6-decimal — and several are wider than an IEEE-754 double carries losslessly.
// So the parse target here is `bigint`, the formatters return strings, and the
// one function that produces a `number` REFUSES rather than rounds.
//
// # The rule
//
// No function in this module rounds. Where a conversion cannot keep every digit
// it throws `PrecisionLossError` carrying the exact value it declined to
// mangle. That is the whole reason the module exists: rounding a liquidation
// threshold is not a display concern.

import {
  AbsentQuantityError,
  DecimalFormatError,
  PrecisionLossError,
} from "./errors.js";
import { liquidationVerdict, type LiquidationVerdict, type RefinedPosition } from "./refine.js";
import type { HealthFactor, Position } from "./types.js";
import { WAD } from "./types.js";

/** The contract's `Decimal` pattern, verbatim: `^-?[0-9]+$`. */
const DECIMAL_PATTERN = /^-?[0-9]+$/;

/** A fixed-point decimal literal, for `parseUnits`. */
const FIXED_POINT_PATTERN = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/;

/** True when `value` matches the contract's `Decimal` pattern exactly. */
export function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

/**
 * Parse a contract `Decimal` into an exact bigint.
 *
 * Strict by design: no whitespace trimming, no `0x`, no exponent, no thousands
 * separator, no empty string. Anything the contract would not have produced is
 * a `DecimalFormatError` rather than a silently different number.
 */
export function parseDecimal(value: string): bigint {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new DecimalFormatError(
      value,
      `not a contract decimal (expected /^-?[0-9]+$/): ${JSON.stringify(value)}`,
    );
  }
  return BigInt(value);
}

/**
 * Parse a contract `NullableDecimal`, preserving the null.
 *
 * The contract's own words: "Absent and zero are different statements." This
 * returns `null` for null so a caller cannot lose that distinction by accident;
 * use `requireDecimal` when absence is genuinely a caller error.
 */
export function parseNullableDecimal(value: string | null): bigint | null {
  return value === null ? null : parseDecimal(value);
}

/** Parse a `NullableDecimal` that must be present, naming the field if it is not. */
export function requireDecimal(value: string | null, field: string): bigint {
  if (value === null) throw new AbsentQuantityError(field);
  return parseDecimal(value);
}

/** Render an exact bigint back to a contract `Decimal` string. */
export function formatDecimal(value: bigint): string {
  return value.toString(10);
}

// ---------------------------------------------------------------------------
// Conversions that can lose digits — and therefore refuse.
// ---------------------------------------------------------------------------

/**
 * Convert to a JS `number`, or throw.
 *
 * # The criterion is SAFE, not merely representable
 *
 * The obvious test — does `BigInt(Number(v))` equal `v`? — is not enough, and
 * the reason is worth stating because it is a trap. A health factor of 1.08 at
 * 18 decimals is `1080000000000000000`, and that value happens to be EXACTLY
 * representable as a double: it carries eighteen factors of two, far more than
 * the seven its magnitude requires. A round-trip test would wave it through.
 *
 * But it sits above `Number.MAX_SAFE_INTEGER`, so the very next arithmetic
 * operation on it silently loses: `1080000000000000000 + 1` is
 * `1080000000000000000`. Handing a caller a number they cannot compute with is
 * the same failure as rounding, one step later.
 *
 * So the accepted set is the SAFE integers, `|v| <= 2^53 - 1`. Everything else
 * throws `PrecisionLossError`. Nothing is rounded and nothing is clamped.
 *
 * Use this for counts, block numbers and seconds. Never for money — that is what
 * `formatUnits` is for, and it returns a string.
 */
export function toNumber(value: bigint | string): number {
  const v = typeof value === "bigint" ? value : parseDecimal(value);
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new PrecisionLossError(v, "toNumber", `${v.toString()} exceeds the finite double range`);
  }
  if (!Number.isSafeInteger(n) || BigInt(n) !== v) {
    const exact = Number.isSafeInteger(n) || !Number.isFinite(n) ? "" : ` (nearest double is ${BigInt(n).toString()})`;
    throw new PrecisionLossError(
      v,
      "toNumber",
      `${v.toString()} is outside the safe-integer range (|v| <= 2^53-1)${exact}: ` +
        `refusing to round a risk quantity, and refusing to hand back a number ` +
        `whose next addition would silently lose`,
    );
  }
  return n;
}

/**
 * Rescale an integer quantity between decimal scales, exactly.
 *
 * Widening (`to > from`) is always exact. Narrowing throws
 * `PrecisionLossError` when any digit being dropped is non-zero — it never
 * truncates and never rounds half-up.
 */
export function rescale(value: bigint | string, fromDecimals: number, toDecimals: number): bigint {
  const v = typeof value === "bigint" ? value : parseDecimal(value);
  assertScale(fromDecimals, "fromDecimals");
  assertScale(toDecimals, "toDecimals");
  if (toDecimals === fromDecimals) return v;
  if (toDecimals > fromDecimals) {
    return v * 10n ** BigInt(toDecimals - fromDecimals);
  }
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  const remainder = v % divisor;
  if (remainder !== 0n) {
    throw new PrecisionLossError(
      v,
      `rescale ${fromDecimals} -> ${toDecimals}`,
      `${v.toString()} at ${fromDecimals} decimals cannot be expressed at ${toDecimals} ` +
        `decimals without dropping the non-zero remainder ${remainder.toString()}`,
    );
  }
  return v / divisor;
}

// ---------------------------------------------------------------------------
// Display: exact, string in and string out.
// ---------------------------------------------------------------------------

export interface FormatUnitsOptions {
  /** Drop trailing zeros in the fractional part (and the point, if it empties). */
  trim?: boolean;
}

/**
 * Render an integer quantity as a fixed-point decimal string at `decimals`
 * places. Exact: no float ever holds the value.
 *
 * `formatUnits("1080000000000000000", 18)` is `"1.080000000000000000"`, and with
 * `{ trim: true }` it is `"1.08"`.
 */
export function formatUnits(
  value: bigint | string,
  decimals: number,
  options?: FormatUnitsOptions,
): string {
  const v = typeof value === "bigint" ? value : parseDecimal(value);
  assertScale(decimals, "decimals");
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString(10).padStart(decimals + 1, "0");
  const cut = digits.length - decimals;
  const whole = digits.slice(0, cut);
  let fraction = digits.slice(cut);
  if (options?.trim === true) {
    fraction = fraction.replace(/0+$/, "");
  }
  const body = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * The exact inverse of `formatUnits`: parse a fixed-point literal into an
 * integer at `decimals` places.
 *
 * A literal carrying MORE fractional digits than the scale admits is
 * `PrecisionLossError`, not a truncation. `parseUnits("1.0000001", 6)` throws.
 */
export function parseUnits(text: string, decimals: number): bigint {
  assertScale(decimals, "decimals");
  if (typeof text !== "string") {
    throw new DecimalFormatError(text, `not a fixed-point decimal string: ${JSON.stringify(text)}`);
  }
  const m = FIXED_POINT_PATTERN.exec(text);
  const whole = m?.[2] ?? "";
  const fraction = m?.[3] ?? "";
  if (m === null || (whole === "" && fraction === "")) {
    throw new DecimalFormatError(text, `not a fixed-point decimal string: ${JSON.stringify(text)}`);
  }
  const scaled = BigInt(whole === "" ? "0" : whole) * 10n ** BigInt(decimals);
  if (fraction.length > decimals) {
    // The error carries the literal's EXACT value at its own scale, so a caller
    // that wants the wider scale can use it rather than re-parsing.
    const atOwnScale = BigInt(`${whole === "" ? "0" : whole}${fraction}`);
    throw new PrecisionLossError(
      m[1] === "-" ? -atOwnScale : atOwnScale,
      `parseUnits at ${decimals} decimals`,
      `${JSON.stringify(text)} carries ${fraction.length} fractional digits but the scale ` +
        `admits ${decimals}; refusing to drop the extra digits`,
    );
  }
  const fractional = fraction === "" ? 0n : BigInt(fraction.padEnd(decimals, "0"));
  const magnitude = scaled + fractional;
  return m[1] === "-" ? -magnitude : magnitude;
}

// ---------------------------------------------------------------------------
// Exact comparisons — no division anywhere.
// ---------------------------------------------------------------------------

/**
 * Compare two rationals by cross-multiplication: -1, 0 or 1 for
 * `aNum/aDen` against `bNum/bDen`.
 *
 * This is how the Debt Manager histogram's comparator must be evaluated — its
 * `hf_num/hf_den` is an exact rational and there is no wad to reduce it to.
 * Denominators must be positive; a zero denominator is a caller error, not
 * infinity.
 */
export function compareRatio(aNum: bigint, aDen: bigint, bNum: bigint, bDen: bigint): -1 | 0 | 1 {
  if (aDen <= 0n || bDen <= 0n) {
    throw new DecimalFormatError(
      { aDen: aDen.toString(), bDen: bDen.toString() },
      "compareRatio needs positive denominators: a zero denominator is not infinity, it is an absent ratio",
    );
  }
  const left = aNum * bDen;
  const right = bNum * aDen;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Aave's own liquidation test, on the wad the pool computes, as a SEALED
 * verdict: `liquidatable` when `hf_wad < 1e18`, STRICTLY. Exactly 1e18 is
 * healthy — `not-liquidatable`.
 *
 * An absent wad — a refused position, or the Debt Manager, which publishes no
 * wad at all — is `unknowable`. Absent is never reported as healthy, and
 * (round 3's point) can no longer be READ as healthy: this helper's
 * predecessor, `aaveEligibleFromWad`, returned `boolean | null`, under which
 * `if (!eligible)` labelled a withheld verdict definitively safe. A non-empty
 * string literal gives `!` nothing to grab.
 */
export function aaveVerdictFromWad(hfWad: string | null): LiquidationVerdict {
  if (hfWad === null) return "unknowable";
  return parseDecimal(hfWad) < WAD ? "liquidatable" : "not-liquidatable";
}

/**
 * A served position's liquidation verdict, using each engine's OWN comparator
 * and never blending them.
 *
 * - Debt Manager: the strict boolean `liquidatable` the engine publishes,
 *   refined to the sealed vocabulary.
 * - Aave: `health_factor.wad < 1e18`, on the wad, never a re-derived float.
 * - Refused, or never-swept: `unknowable`. The service withheld a verdict and
 *   this helper does not invent one — and unlike its predecessor
 *   `positionEligible` (which returned `boolean | null`), the withheld case
 *   cannot be `!`-read as "safe".
 *
 * Accepts both the RAW wire position (`addressRaw()`) and the refined position
 * the primary `address()` path serves; the verdict is the same either way.
 */
export function positionVerdict(position: Position | RefinedPosition): LiquidationVerdict {
  const strict =
    "liquidation_verdict" in position
      ? position.liquidation_verdict
      : liquidationVerdict(position.liquidatable);
  if (strict !== "unknowable") return strict;
  const hf: HealthFactor | null = position.health_factor;
  if (hf === null) return "unknowable";
  if (hf.infinite) return "not-liquidatable";
  return aaveVerdictFromWad(hf.wad);
}

/**
 * The exact rational form of a health factor, for callers that must compare or
 * sort without ever forming a float.
 *
 * Returns `null` when the position publishes neither leg.
 */
export function healthFactorRatio(hf: HealthFactor): { num: bigint; den: bigint } | null {
  if (hf.num === null || hf.den === null) return null;
  const den = parseDecimal(hf.den);
  if (den === 0n) return null;
  return { num: parseDecimal(hf.num), den };
}

function assertScale(decimals: number, field: string): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 1000) {
    throw new DecimalFormatError(decimals, `${field} must be an integer in [0, 1000], got ${String(decimals)}`);
  }
}
