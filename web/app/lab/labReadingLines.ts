// THE LOSS FRONTIER's reading lines — COMPUTED from the same `/v1/book`
// waterfall the chart plots, never asserted, never hardcoded (Wave W-SD-A,
// ruling item 3).
//
// A reading line answers the question the chart's SHAPE cannot: what the
// reader is looking at, in words, with the numbers that make it actionable.
// The Book surface established the register (`app/book/readingLines.ts`); the
// Lab owns its own, because the Lab's frontier is a different claim — a whole
// grid of projections read against one census — and a shared sentence would
// eventually describe the wrong one.
//
// Axis titles are READER WORDS, not field names: "if ETH fell by…" and
// "debt the engine could liquidate", never `factor` and
// `cumulative_debt_eligible_usd`. The exact field names still ride the step
// table below the chart, where a reader who wants the schema can find it.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { Waterfall } from "@solvent/client";
import {
  axisWords,
  cellAt,
  frontierView,
  labUsd,
  type FrontierSeries,
  type FrontierView,
} from "./frontierView";

/** The frontier's axis titles, in reader words. */
export function frontierAxisTitles(waterfall: Waterfall): { x: string; y: string } {
  return {
    x: `if ${axisWords(waterfall.axis, waterfall.axis_asset)} fell by…`,
    y: "debt the engine could liquidate",
  };
}

/** Where the first new eligibility lands — or the honest statement that none does. */
export function cliffClause(view: FrontierView): string {
  if (view.cliffIndex === null) {
    return "No step on this grid makes anything newly eligible.";
  }
  const step = view.steps[view.cliffIndex];
  const counts = view.cliffEngines.flatMap((engine) => {
    const cell = cellAt(view, view.cliffIndex ?? 0, engine);
    return cell === null ? [] : [`${String(cell.newlyEligible)} on ${engine}`];
  });
  return `First new eligibility lands at ${step?.move ?? "an unnamed step"} — ${counts.join(", ")}.`;
}

/**
 * The frontier's section reading line.
 *
 * The census/projection split is stated in the same breath as the shape: the
 * unshocked point is the only thing on this chart that has actually happened.
 */
export function frontierReadingLine(waterfall: Waterfall): string {
  const view = frontierView(waterfall);
  const baseline = view.baselineIndex === null ? null : view.steps[view.baselineIndex];
  const censusClause =
    baseline === undefined || baseline === null
      ? "This grid carries no unshocked point, so every step on it is a projection."
      : `${baseline.move} is the standing census — every step below it is a projection.`;
  return (
    `What this shows: how much debt each engine could liquidate if ` +
    `${axisWords(waterfall.axis, waterfall.axis_asset)} fell step by step. ` +
    `${censusClause} ${cliffClause(view)}`
  );
}

/**
 * One engine panel's reading line — the engine's own span across the grid.
 *
 * The unit disclosure is part of the sentence, not a footnote: these are this
 * engine's USD at this engine's decimals, and the wire's own note forbids
 * adding them to the panel next door.
 */
export function frontierSeriesReadingLine(series: FrontierSeries): string {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  if (first === undefined || last === undefined) {
    return `${series.engine} served no point on this grid — a hole, not a zero.`;
  }
  const from = labUsd(first.cell.eligibleDebt.toString(), series.usdDecimals);
  const to = labUsd(last.cell.eligibleDebt.toString(), series.usdDecimals);
  const badFrom = labUsd(first.cell.badDebt.toString(), series.usdDecimals);
  const badTo = labUsd(last.cell.badDebt.toString(), series.usdDecimals);
  return (
    `${series.engine}: Σ eligible debt ${from} at ${first.move} → ${to} at ${last.move}; ` +
    `bad debt ${badFrom} → ${badTo}. This engine's own USD at ${String(series.usdDecimals)} ` +
    `decimals — never added to another engine's.`
  );
}

/**
 * The wire's collateral-at-risk caveat, VERBATIM.
 *
 * `at_risk_note` says the series carries no monotonicity invariant and must
 * not be read as an accumulation. It is the wire's sentence, and it renders as
 * the wire's sentence — paraphrasing a caveat is how a caveat stops working.
 */
export function atRiskNoteVerbatim(waterfall: Waterfall): string {
  return waterfall.at_risk_note;
}

/** The wire's eligible-vs-realized caveat, VERBATIM, for the same reason. */
export function eligibilityNoteVerbatim(waterfall: Waterfall): string {
  return waterfall.eligibility_note;
}
