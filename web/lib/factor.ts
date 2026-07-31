// Exact rational factors — the Scenario Lab's number law.
//
// Shocks are EXACT rationals on the wire ("-20% is 80/100, never 0.8 — there
// are no floats in this pipeline"), and this module keeps them exact all the
// way to the glass: the ratio renders verbatim, and the multiplier/percent are
// computed in bigint arithmetic, printed EXACTLY when the reduced denominator
// terminates in base 10 (only 2s and 5s), and marked approximate ("≈") when it
// does not — never silently rounded.
//
// tests/unit/factor.spec.ts pins the law.

/** U+2212, the typographic minus the mockup uses ("ETH −25%"). */
export const MINUS_SIGN = "−";

export interface FactorDisplay {
  /** The wire's rational, verbatim: "70/100". */
  ratio: string;
  /** The multiplier: "×0.7". "≈"-prefixed when the expansion does not terminate. */
  times: string;
  /** The signed move: "−30%", "+50%", "0%". "≈"-prefixed when not exact. */
  percent: string;
  /** False when the decimal expansion does not terminate (percent/times carry ≈). */
  exact: boolean;
  /** Sign of (num − den): −1 shrinks the mark, 0 holds it, +1 grows it. */
  direction: -1 | 0 | 1;
}

/** Digits the approximate fallback truncates to (toward zero, marked ≈). */
const APPROX_DECIMALS = 4;

function toBig(value: number | string | bigint, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${field} must be an exact integer, got ${String(value)}`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${field} is not a contract decimal integer: ${JSON.stringify(value)}`);
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * The exact decimal expansion of n/d (d > 0), or null when it does not
 * terminate. Trailing fractional zeros are trimmed; "-0.5" style sign kept.
 */
function exactExpansion(n: bigint, d: bigint): string | null {
  const negative = n < 0n;
  let a = negative ? -n : n;
  const g = gcd(a, d);
  a /= g;
  let rd = d / g;
  let twos = 0;
  let fives = 0;
  while (rd % 2n === 0n) {
    rd /= 2n;
    twos += 1;
  }
  while (rd % 5n === 0n) {
    rd /= 5n;
    fives += 1;
  }
  if (rd !== 1n) return null; // non-terminating: refuse to pretend otherwise
  const k = Math.max(twos, fives);
  const scaled = a * 10n ** BigInt(k) / (d / g); // exact by construction
  const body = renderScaled(scaled, k);
  return negative && body !== "0" ? `-${body}` : body;
}

/** Truncated (toward zero) expansion to APPROX_DECIMALS places, unsigned body. */
function approxExpansion(n: bigint, d: bigint): string {
  const negative = n < 0n;
  const a = negative ? -n : n;
  const scaled = (a * 10n ** BigInt(APPROX_DECIMALS)) / d;
  const body = renderScaled(scaled, APPROX_DECIMALS);
  return negative && body !== "0" ? `-${body}` : body;
}

/** Format a non-negative integer that carries `decimals` implied places. */
function renderScaled(scaled: bigint, decimals: number): string {
  const digits = scaled.toString(10).padStart(decimals + 1, "0");
  const cut = digits.length - decimals;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** "-30" → "−30%", "50" → "+50%", "0" → "0%". */
function signedPercent(body: string): string {
  if (body === "0") return "0%";
  if (body.startsWith("-")) return `${MINUS_SIGN}${body.slice(1)}%`;
  return `+${body}%`;
}

/**
 * Render a wire rational factor exactly.
 *
 * Accepts the `Shock` shape (int64 numbers) and the `AppliedShock` shape
 * (Decimal strings) alike. The denominator must be positive: a zero or
 * negative denominator is not a factor, and this refuses rather than guesses.
 */
export function formatFactor(
  num: number | string | bigint,
  den: number | string | bigint,
): FactorDisplay {
  const n = toBig(num, "factor_num");
  const d = toBig(den, "factor_den");
  if (d <= 0n) {
    throw new Error(
      `factor_den must be positive, got ${d.toString()}: a zero denominator is not a factor`,
    );
  }

  const delta = n - d;
  const direction: -1 | 0 | 1 = delta < 0n ? -1 : delta > 0n ? 1 : 0;

  const timesExact = exactExpansion(n, d);
  const percentExact = exactExpansion(delta * 100n, d);
  // Both share the reduced denominator, so exactness is a single fact.
  const exact = timesExact !== null && percentExact !== null;

  return {
    ratio: `${n.toString(10)}/${d.toString(10)}`,
    times: exact ? `×${timesExact}` : `≈×${approxExpansion(n, d)}`,
    percent: exact
      ? signedPercent(percentExact)
      : `≈${signedPercent(approxExpansion(delta * 100n, d))}`,
    exact,
    direction,
  };
}

/**
 * One-line factor rendering: `70/100 · ×0.7 · −30%` — the ratio (the honest
 * number) always first, the derived forms beside it.
 */
export function renderFactor(
  num: number | string | bigint,
  den: number | string | bigint,
): string {
  const f = formatFactor(num, den);
  return `${f.ratio} · ${f.times} · ${f.percent}`;
}
