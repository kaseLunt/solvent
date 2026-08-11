// VIEW 3 (incremental stress) — the pure view-model for CONSECUTIVE
// differences of the Book waterfall's grid points, per engine.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 3 + completeness critic Finding 9):
//
//   - ONLY THE ACCOUNT SERIES IS ENTRY-EXACT. `newly_eligible_accounts` is
//     latch-based and served per point: those accounts FIRST crossed at this
//     step, and the identity cum[b] == cum[a] + newly[b] is WELDED here.
//   - THE DEBT DELTA IS NOT AN ENTRY FIGURE. The latch re-measures the WHOLE
//     latched set at every deeper point, so the difference carries
//     re-measurement drift on already-latched accounts. It is labeled
//     "increase in eligible debt between ×a and ×b" — NEVER "debt that
//     became eligible".
//   - FORBIDDEN SERIES STAY FORBIDDEN (Finding 9). Bad debt, collateral at
//     risk and insolvent-account counts are re-measurements with no sign
//     constraint; this module computes no difference of any of them.
//   - THE SERIES STOPS AT A MONOTONICITY VIOLATION. The server names the
//     point and never smooths it; steps INTO or past the named point are not
//     drawn. A negative debt delta on an engine the server did NOT name is a
//     wire contradiction — refused, never rendered as a negative bar.
//   - STEP WIDTH COMES FROM THE SERVED FACTORS. The grid is env-configurable;
//     every step names its own ×a → ×b and nothing assumes uniform spacing.
//   - PER ENGINE ONLY; an engine absent from every point makes no claim.

import { formatUnits, type Waterfall } from "@solvent/client";
import { groupDecimalString } from "../../lib/book-format";
import { isWirePopulation, wireBigInt } from "../../lib/wireGuard";
import { factorTimesLabel } from "./waterfallView";

interface EnginePoint {
  index: number;
  factor: string;
  at: Waterfall["points"][number]["engines"][number];
}

export interface IncrementStep {
  fromTimes: string;
  toTimes: string;
  /** SERVED latch count: accounts that FIRST crossed at this step. */
  newlyEligible: number;
  /** Exact bigint difference of the cumulative eligible debt, >= 0. */
  debtIncreaseUsd: string;
  usdDecimals: number;
}

export type StressIncrements =
  | { kind: "absent" }
  | { kind: "single" }
  | { kind: "refused"; reason: string }
  | { kind: "view"; steps: IncrementStep[]; stopped: string | null };

export function stressIncrements(waterfall: Waterfall, engine: string): StressIncrements {
  const points: EnginePoint[] = [];
  for (const point of waterfall.points) {
    const at = point.engines.find((candidate) => candidate.engine === engine);
    if (at !== undefined) points.push({ index: point.index, factor: point.factor, at });
  }
  if (points.length === 0) return { kind: "absent" };
  if (points.length === 1) return { kind: "single" };

  // THE GRID WELD: indexes strictly increase and factors strictly decrease,
  // or "between ×a and ×b" has no honest meaning.
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (prev === undefined || next === undefined) continue;
    // p1b-15: the indexes pass the wire POPULATION contract BEFORE they are
    // ordered — `1 <= -0` is false, so a first-point index token that parses
    // to NEGATIVE ZERO (`-1e-324`, the p1b-11 class) read as a strictly
    // rising sequence and the view rendered as if the grid were lawful. An
    // unreadable index is the grid refusal, never a coerced comparison. (The
    // p1b-14 audit recorded this field as needing no guard — INCORRECT,
    // corrected this wave.)
    if (!isWirePopulation(prev.index) || !isWirePopulation(next.index)) {
      return {
        kind: "refused",
        reason:
          `GRID CONTRADICTION: a served point index is outside the wire population contract ` +
          `(a nonnegative safe integer) between factors ${prev.factor} and ${next.factor} — ` +
          `no between-step reading exists on a grid whose order cannot be read.`,
      };
    }
    // p1b-6 item 6: the factors pass the wire Decimal contract BEFORE they
    // are compared — `BigInt("")` is a silent 0n, which SLIPPED THROUGH this
    // weld (0n descends below any positive factor) and then rendered a
    // garbage step label. A malformed factor is the grid refusal, never a
    // coerced comparison.
    const prevFactor = wireBigInt(prev.factor);
    const nextFactor = wireBigInt(next.factor);
    if (prevFactor === null || nextFactor === null) {
      return {
        kind: "refused",
        reason:
          `GRID CONTRADICTION: a served factor is outside the wire Decimal contract ` +
          `(index ${String(prev.index)} factor "${prev.factor}", index ${String(next.index)} ` +
          `factor "${next.factor}") — no between-step reading exists on a grid that cannot ` +
          `be read.`,
      };
    }
    if (next.index <= prev.index || nextFactor >= prevFactor) {
      return {
        kind: "refused",
        reason:
          `GRID CONTRADICTION: the served points do not descend (index ${String(prev.index)} ` +
          `at factor ${prev.factor}, then index ${String(next.index)} at factor ${next.factor}) ` +
          `— no between-step reading exists on a disordered grid.`,
      };
    }
  }

  const monotonicity = waterfall.monotonicity;
  const stopIndex =
    monotonicity.ok === false && monotonicity.engine === engine
      ? (monotonicity.index ?? null)
      : null;
  // p1b-16: THE STOP INDEX JOINS THE GRID WELD. The truncation compare below
  // (`b.index >= stopIndex`) consumed the server-named monotonicity index
  // raw — a stop-index token `-1e-324` parses to NEGATIVE ZERO (the p1b-11
  // class), every lawful point index satisfies `>= -0`, and the series
  // SILENTLY stopped at the first step: an empty step list wearing the
  // legitimate stop sentence. The named index passes the same wire population
  // contract as the point indexes it is ordered against; failure is the grid
  // refusal (no value printed — `String(-0)` would launder to "0"), never a
  // coerced truncation. (Named as a p1b-15 concern; closed this wave.)
  if (stopIndex !== null && !isWirePopulation(stopIndex)) {
    return {
      kind: "refused",
      reason:
        `GRID CONTRADICTION: the server-named monotonicity stop index for this engine is ` +
        `outside the wire population contract (a nonnegative safe integer) — no series can ` +
        `stop before a point whose place on the grid cannot be read.`,
    };
  }
  const stopped =
    stopIndex === null
      ? null
      : `The server reports a monotonicity violation for this engine at ` +
        `${factorTimesLabel(String(monotonicity.factor ?? ""), waterfall.grid_scale)} — the ` +
        `series stops before that point rather than drawing past a number the server refused ` +
        `to smooth.`;

  const steps: IncrementStep[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    if (stopIndex !== null && b.index >= stopIndex) break;

    // p1b-14: THE COUNT CONTRACT COMES BEFORE THE LATCH WELD. The weld's
    // arithmetic consumed the three counts raw, so a -0 token (the p1b-11
    // class) either fed a fabricated `newlyEligible` into a rendered step or
    // tripped the LATCH CONTRADICTION register — which claims a
    // contradiction where the truth is that a count cannot be read.
    if (
      !isWirePopulation(a.at.cumulative_eligible_accounts) ||
      !isWirePopulation(b.at.cumulative_eligible_accounts) ||
      !isWirePopulation(b.at.newly_eligible_accounts)
    ) {
      return {
        kind: "refused",
        reason:
          `COUNT CONTRADICTION: a served account count between ` +
          `${factorTimesLabel(a.factor, waterfall.grid_scale)} and ` +
          `${factorTimesLabel(b.factor, waterfall.grid_scale)} is outside the wire population ` +
          `contract (a nonnegative safe integer) — no step reading is drawn from a count that ` +
          `cannot be read.`,
      };
    }
    // THE LATCH WELD: the served per-point entry count must reproduce the
    // cumulative series exactly — that identity is the only license for
    // calling these accounts "first crossed here".
    if (
      b.at.cumulative_eligible_accounts !==
      a.at.cumulative_eligible_accounts + b.at.newly_eligible_accounts
    ) {
      return {
        kind: "refused",
        reason:
          `LATCH CONTRADICTION: between ${factorTimesLabel(a.factor, waterfall.grid_scale)} and ` +
          `${factorTimesLabel(b.factor, waterfall.grid_scale)} the cumulative account series ` +
          `(${String(a.at.cumulative_eligible_accounts)} to ` +
          `${String(b.at.cumulative_eligible_accounts)}) disagrees with the served entry count ` +
          `(${String(b.at.newly_eligible_accounts)}) — the latch identity fails, so no step ` +
          `reading is drawn.`,
      };
    }
    if (b.at.usd_decimals !== a.at.usd_decimals) {
      return {
        kind: "refused",
        reason:
          `SCALE CONTRADICTION: the engine's usd_decimals changed between grid points ` +
          `(${String(a.at.usd_decimals)} to ${String(b.at.usd_decimals)}) — no difference is ` +
          `computable across two scales.`,
      };
    }
    // p1b-6 item 6: the cumulative series passes the wire Decimal contract
    // before any difference exists — a coerced `BigInt("")` on side `a` made
    // the whole cumulative look like an increase (a measured-zero costume),
    // and on side `b` it faked a decrease the server never asserted.
    const bCumulative = wireBigInt(b.at.cumulative_debt_eligible_usd);
    const aCumulative = wireBigInt(a.at.cumulative_debt_eligible_usd);
    if (bCumulative === null || aCumulative === null) {
      return {
        kind: "refused",
        reason:
          `SERIES CONTRADICTION: a served cumulative eligible debt between ` +
          `${factorTimesLabel(a.factor, waterfall.grid_scale)} and ` +
          `${factorTimesLabel(b.factor, waterfall.grid_scale)} is outside the wire Decimal ` +
          `contract — no increment is computable from a number that cannot be read.`,
      };
    }
    const delta = bCumulative - aCumulative;
    if (delta < 0n) {
      return {
        kind: "refused",
        reason:
          `SERIES CONTRADICTION: the cumulative eligible debt DECREASED between ` +
          `${factorTimesLabel(a.factor, waterfall.grid_scale)} and ` +
          `${factorTimesLabel(b.factor, waterfall.grid_scale)} while the server asserts ` +
          `monotonicity for this engine — no honest increment exists, so none is drawn.`,
      };
    }
    steps.push({
      fromTimes: factorTimesLabel(a.factor, waterfall.grid_scale),
      toTimes: factorTimesLabel(b.factor, waterfall.grid_scale),
      newlyEligible: b.at.newly_eligible_accounts,
      debtIncreaseUsd: delta.toString(),
      usdDecimals: b.at.usd_decimals,
    });
  }

  return { kind: "view", steps, stopped };
}

/**
 * One step, in reader words: the two claims kept APART. The debt figure is
 * an INCREASE (entry plus re-measurement drift on the already-latched set);
 * only the account count may claim entry.
 */
export function incrementAccountsClause(step: IncrementStep): string {
  if (step.newlyEligible === 0) return "no account first crossed at this step";
  const noun = step.newlyEligible === 1 ? "account" : "accounts";
  return `${String(step.newlyEligible)} ${noun} first crossed at this step`;
}

/**
 * r98: the bar scale is PER ENGINE and says so — equal lengths across panels
 * are not equal dollars, and the anchor value is printed rather than implied.
 *
 * p1b-6 item 6: null when the anchor is outside the wire Decimal contract —
 * the caller's existing no-clause arm (no scale sentence renders). The old
 * bare `BigInt("")` coerced a malformed anchor into the "$0, no bar" claim.
 */
export function incrementScaleClause(maxIncreaseUsd: string, usdDecimals: number): string | null {
  const max = wireBigInt(maxIncreaseUsd);
  if (max === null) return null;
  if (max === 0n) {
    return "Every increase in this window is $0, so no bar is drawn.";
  }
  const anchor = `$${groupDecimalString(formatUnits(maxIncreaseUsd, usdDecimals, { trim: true }))}`;
  return (
    `Bars are scaled to this engine's own largest increase (${anchor}) — ` +
    `engine panels share no scale.`
  );
}

/**
 * The steps' bar values, read ONCE through the sanctioned wire path (p1b-6
 * item 6). `stressIncrements` only ever emits contract-valid strings, but the
 * component's bar geometry read them back through three bare `BigInt(...)`
 * calls — a refactor routing wire strings there would coerce `""` into a
 * zero-length bar. Refused (the component's existing contradiction register)
 * rather than coerced; `max` is the per-engine bar anchor.
 */
export type IncrementStepValues =
  | { kind: "ok"; rows: readonly { step: IncrementStep; value: bigint }[]; max: bigint }
  | { kind: "refused"; reason: string };

export function incrementStepValues(steps: readonly IncrementStep[]): IncrementStepValues {
  const rows: { step: IncrementStep; value: bigint }[] = [];
  let max = 0n;
  for (const step of steps) {
    const value = wireBigInt(step.debtIncreaseUsd);
    if (value === null) {
      return {
        kind: "refused",
        reason:
          `SERIES CONTRADICTION: the increase between ${step.fromTimes} and ${step.toTimes} ` +
          `is outside the wire Decimal contract — no bar is drawn from a number that cannot ` +
          `be read.`,
      };
    }
    rows.push({ step, value });
    if (value > max) max = value;
  }
  return { kind: "ok", rows, max };
}

/** SLOT 6 for the increments block. */
export const STRESS_INC_METHOD =
  "Each row is the difference between two NEIGHBORING sampled points, named by their own served " +
  "factors — the grid is configurable and nothing here assumes even spacing. The dollar figure " +
  "is the INCREASE in eligible debt between the two points: deeper shocks also reprice debt " +
  "that was already eligible, so it is never called the debt that became eligible. Only the " +
  "account count is an entry figure, and the bad-debt, collateral and insolvency series are " +
  "never differenced at all — their differences are re-measurement drift with no sign " +
  "guarantee. One engine per panel; engine books are never summed.";
