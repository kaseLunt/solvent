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
    if (next.index <= prev.index || BigInt(next.factor) >= BigInt(prev.factor)) {
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
    const delta =
      BigInt(b.at.cumulative_debt_eligible_usd) - BigInt(a.at.cumulative_debt_eligible_usd);
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
 */
export function incrementScaleClause(maxIncreaseUsd: string, usdDecimals: number): string {
  if (BigInt(maxIncreaseUsd) === 0n) {
    return "Every increase in this window is $0, so no bar is drawn.";
  }
  const anchor = `$${groupDecimalString(formatUnits(maxIncreaseUsd, usdDecimals, { trim: true }))}`;
  return (
    `Bars are scaled to this engine's own largest increase (${anchor}) — ` +
    `engine panels share no scale.`
  );
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
