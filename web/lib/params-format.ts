// Risk-parameter DENOMINATIONS, rendered per engine (Wave R1, adjudicated
// ruling item 12).
//
// THE DEFECT THIS FIXES: the Inspector rendered every leg's `liq_threshold`
// and `liq_bonus` as `{value} bps`. That is true on Aave (which publishes
// bps, the 1e4 scale) and flatly false on the Debt Manager, whose percent
// scale is 100e18 — so a 95% threshold rendered as "95000000000000000000
// bps" and a 3.5% bonus as "3500000000000000000 bps". Two engines, one
// label, one of them a lie.
//
// The contract states the law itself (api/openapi.yaml, /v1/params notes):
//
//   "denominations are the ENGINE's own and are named per field: Aave
//    publishes bps (1e4 scale); the Debt Manager's percent scale is 100e18.
//    No cross-engine normalization exists."
//
// So this module does NOT normalize across engines. It renders each engine's
// own number as a percentage — the reading a human can act on — and keeps the
// engine's raw denomination NAMED beside it, so the exact wire value is never
// hidden behind the convenience form.
//
// EXACTNESS: both denominators are powers of ten (1e4 and 1e20), so
// `value / scale × 100` is a pure decimal-point shift — `formatUnits` at
// (log10(scale) − 2) decimals. No float, no rounding, no approximation mark
// is ever needed.
//
// Pinned by tests/unit/params-format.spec.ts.

import { formatUnits, parseDecimal } from "@solvent/client";
import { groupDecimalString } from "./book-format";
import { EM_DASH } from "./format";

/** Aave publishes risk params in basis points — the 1e4 scale. */
export const AAVE_BPS_DECIMALS = 4;
/** The Debt Manager's percent scale is 100e18 — a 1e20 denominator. */
export const DM_PERCENT_DECIMALS = 20;

/** The engine's own denominator, as a decimal exponent. */
export function paramScaleDecimals(engine: string): number {
  return engine === "debt_manager" ? DM_PERCENT_DECIMALS : AAVE_BPS_DECIMALS;
}

/** The engine's denomination, NAMED — never normalized away. */
export function paramScaleNote(engine: string): string {
  return engine === "debt_manager" ? "100e18 scale" : "bps · 1e4 scale";
}

/**
 * One risk parameter as a percentage in the engine's OWN denomination:
 * Aave `8100` → `81%`, Debt Manager `95000000000000000000` → `95%`.
 *
 * Null stays an em dash (the null-never-zero law): an unpublished threshold
 * is not a zero threshold.
 */
export function paramPercent(value: string | null, engine: string): string {
  if (value === null) return EM_DASH;
  // percent = value × 100 / scale, and scale is 10^k, so this is a shift by
  // (k − 2) places — exact by construction.
  const shift = paramScaleDecimals(engine) - 2;
  return `${groupDecimalString(formatUnits(value, shift, { trim: true }))}%`;
}

// ---------------------------------------------------------------------------
// LIQUIDATION BONUS — a FIELD, not merely a number in a scale (Wave R3, Codex
// round-10 HIGH).
//
// The denomination law above is necessary but not sufficient. Getting the
// SCALE right still renders the wrong QUANTITY when the field's encoding is
// not "a percentage at that scale". `liq_bonus` is exactly such a field, and
// THE TWO ENGINES ENCODE IT DIFFERENTLY:
//
//   Aave — a PAR-BASED MULTIPLIER in bps. `liquidationBonus = 10500` means
//   1.05x: the liquidator seizes 105% of what it repays, so the PREMIUM is
//   5%, not 105%. This service already decodes it that way on the write side:
//
//     cmd/api/p5_events.go:466  "decodes Aave's liquidationBonus encoding
//                                (10500 = 105% of par) into the premium in bps"
//     cmd/api/p5_events.go:483  premium := new(big.Int).Sub(row.LiqBonus,
//                                            big.NewInt(10_000))
//
//   Debt Manager — the PREMIUM ITSELF on the 100e18 percent scale. There is
//   no par to subtract; the deployed contract ADDS it to par:
//
//     cmd/api/fixture_test.go:137     fxDMLiqBonus = "1000000000000000000"
//                                     // 1e18 additive => 1%
//     cmd/reconcile/backtest.go:1577  net = bal × 100e18 / (100e18 + bonus)
//     cmd/reconcile/backtest.go:1588  bonus = cAFD × LiquidationBonus / 100e18
//
//   (Read those two lines together: the DM's own math divides by
//   `HUNDRED_PERCENT + bonus` and multiplies by `bonus / HUNDRED_PERCENT`. A
//   par-based multiplier would divide by `bonus` alone. It does not.)
//
// So the surface rendered Aave's 10500 as "105%" — a twenty-one-fold
// overstatement of what a liquidator collects, and the single most misleading
// number a risk reader could take off this page. The DM's rendering was
// already right, for a reason the old code did not know it had.
//
// The premium is what a human acts on; the RAW integer stays disclosed beside
// it, in the same denomination-disclosure grammar `paramScaleNote` set — the
// convenience form never hides the wire.
// ---------------------------------------------------------------------------

/** Aave's liquidation-bonus par point: 10000 bps IS the 1.00x multiplier. */
export const AAVE_BONUS_PAR_BPS = "10000";

/**
 * A published multiplier that expresses NO premium (Aave writes `0` for an
 * asset carrying no configured bonus). Distinct from the em dash: the em dash
 * means the wire published nothing, this means the wire published something
 * from which no premium follows.
 */
export const NO_BONUS_PREMIUM = "no premium";

/** True when the engine publishes its bonus as a par-based MULTIPLIER. */
export function liqBonusIsParMultiplier(engine: string): boolean {
  return engine !== "debt_manager";
}

/**
 * The PREMIUM, as a raw integer in the engine's own scale — Aave `10500` →
 * `500` bps, Debt Manager `3500000000000000000` → itself.
 *
 * Null when no premium is expressible: an absent wire value, or a sub-par
 * Aave multiplier. `0 − 10000` is NOT a −100% premium; it is a multiplier
 * that grants none, and inventing a negative percentage from it would be the
 * same class of error this whole module exists to end.
 */
export function liqBonusPremiumRaw(value: string | null, engine: string): string | null {
  if (value === null) return null;
  if (!liqBonusIsParMultiplier(engine)) return value;
  // The contract's own validator (`/^-?[0-9]+$/`), so a malformed wire value
  // raises the client's typed DecimalFormatError here exactly as it does in
  // `paramPercent` — one parse discipline across the module. The subtraction
  // is exact integer arithmetic; the par point is a whole number of bps.
  const premium = parseDecimal(value) - parseDecimal(AAVE_BONUS_PAR_BPS);
  return premium < 0n ? null : premium.toString();
}

/**
 * One liquidation bonus as the PREMIUM it grants, as a percentage in the
 * engine's own denomination: Aave `10500` → `5%`, Debt Manager
 * `3500000000000000000` → `3.5%`.
 */
export function liqBonusPercent(value: string | null, engine: string): string {
  if (value === null) return EM_DASH;
  const premium = liqBonusPremiumRaw(value, engine);
  if (premium === null) return NO_BONUS_PREMIUM;
  return paramPercent(premium, engine);
}

/**
 * The parenthesised RAW disclosure that trails the leg-params line — the wire
 * integer, what it IS, and the engine's denomination:
 *
 *   (multiplier 10500 bps · 1e4 scale)
 *   (premium 3500000000000000000 · 100e18 scale)
 *
 * With no bonus published it degrades to the denomination alone, so the
 * threshold beside it never loses its named scale.
 */
export function legParamsDisclosure(liqBonus: string | null, engine: string): string {
  const scale = paramScaleNote(engine);
  if (liqBonus === null) return `(${scale})`;
  // Aave's note OPENS with its unit word (`bps`), so the integer runs straight
  // into it; the DM's does not, so a separator carries the join.
  return liqBonusIsParMultiplier(engine)
    ? `(multiplier ${liqBonus} ${scale})`
    : `(premium ${liqBonus} · ${scale})`;
}

/**
 * The evidence register's bonus value: the premium, then the raw integer AND
 * what that integer is. The register is where the exact wire number is the
 * point, so it names the encoding rather than merely showing the digits.
 */
export function liqBonusEvidenceValue(value: string | null, engine: string): string {
  if (value === null) return EM_DASH;
  return liqBonusIsParMultiplier(engine)
    ? `${liqBonusPercent(value, engine)} premium — raw multiplier ${value} (${AAVE_BONUS_PAR_BPS} = par)`
    : `${liqBonusPercent(value, engine)} premium — raw ${value}, published as the premium itself`;
}

/**
 * The full leg-params statement: the threshold as a percentage and the bonus
 * as the PREMIUM it grants — e.g. `LT 95% · bonus 3.5%`. The raw wire integer
 * and the denomination travel beside it in `legParamsDisclosure`.
 */
export function legParamsLine(
  liqThreshold: string | null,
  liqBonus: string | null,
  engine: string,
): string {
  return `LT ${paramPercent(liqThreshold, engine)} · bonus ${liqBonusPercent(liqBonus, engine)}`;
}
