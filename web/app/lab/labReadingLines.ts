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
import { renderUsdAmount } from "../../lib/book-format";
import { EM_DASH } from "../../lib/format";
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

/**
 * Where the first new eligibility lands — or the honest statement that none does.
 *
 * THE BRACKET (chart spec v4, FINAL COPY). The old sentence named ONE sample
 * and stopped: "First new eligibility lands at −20%". A reader takes that for a
 * measured threshold. It is not: the grid samples DISCRETE shocks, and all the
 * data supports is that the crossing happened somewhere between the previous
 * sample and this one. The sentence now says both halves.
 */
export function cliffClause(view: FrontierView): string {
  if (view.cliffIndex === null) {
    return "No step on this grid makes anything newly eligible.";
  }
  const index = view.cliffIndex;
  const move = view.steps[index]?.move ?? "an unnamed";
  const counts = view.cliffEngines.flatMap((engine) => {
    const cell = cellAt(view, index, engine);
    return cell === null ? [] : [`${String(cell.newlyEligible)} on ${engine}`];
  });
  const lead = `New eligibility first appears at the ${move} sample, with ${counts.join(", ")}.`;
  const previous = view.steps[index - 1];
  if (previous === undefined) {
    // The cliff is the FIRST sample on the grid, so nothing brackets it from
    // below. Naming a previous sample that was never served would invent one.
    return (
      `${lead} The grid samples discrete shocks, and no earlier sample was served, so the ` +
      `true threshold sits at or above the ${move} sample.`
    );
  }
  return (
    `${lead} The grid samples discrete shocks, so the true threshold sits between the ` +
    `${previous.move} and ${move} samples.`
  );
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
      : `${baseline.move} is the standing census; every step below it is a projection.`;
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
    return `${series.engine} served no point on this grid, so the grid has a hole here rather than a zero.`;
  }
  const from = labUsd(first.cell.eligibleDebt.toString(), series.usdDecimals);
  const to = labUsd(last.cell.eligibleDebt.toString(), series.usdDecimals);
  const badFrom = labUsd(first.cell.badDebt.toString(), series.usdDecimals);
  const badTo = labUsd(last.cell.badDebt.toString(), series.usdDecimals);
  return (
    `${series.engine}: Σ eligible debt ${from} at ${first.move} → ${to} at ${last.move}; ` +
    `bad debt ${badFrom} → ${badTo}. This engine's own USD at ${String(series.usdDecimals)} ` +
    `decimals, never added to another engine's.`
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

// ---------------------------------------------------------------------------
// The chart spec v4 FINAL COPY block for the loss frontier, verbatim.
//
// Every string below is pinned character-for-character by
// tests/unit/lab-frontier.spec.ts. They are constants rather than inline JSX
// because a sentence interleaved with `{...}` is not reliably the sentence a
// reader gets, and a pin must be able to quote what is rendered.
// ---------------------------------------------------------------------------

/** LF-2 / LF-8: row 1's direct label. */
export const FRONTIER_ROW1_LABEL = "debt the engine could liquidate ↑";

/** LF-2 / LF-8: row 2's direct label. */
export const FRONTIER_ROW2_LABEL = "bad debt still owed after all collateral is seized ↑";

/**
 * LF-2's separator statement: the rule between the rows carries row 2's scale.
 * Unequal heights, separate tick sets, per-row direct labels and THIS sentence
 * are four independent cues that the rows are on different rulers.
 */
export function frontierSeparatorLine(rowTwoTop: string): string {
  return (
    `The row below is drawn on its own y scale, with a maximum of ${rowTwoTop}. ` +
    `Read each row against its own axis.`
  );
}

/** LF-11 STATE: the independent-scale warning, before the visual (R6). */
export const FRONTIER_INDEPENDENT_SCALE_WARNING =
  "The two rows carry separate y axes. Bar heights are comparable within a row and never " +
  "between rows.";

/** LF-11 STATE: the shock-sampling caveat, before the visual (R6). */
export const FRONTIER_SHOCK_SAMPLING_CAVEAT =
  "This grid samples discrete shocks. Values between samples were not computed.";

/** LF-5: the cliff line's direct label. */
export function frontierCliffLabel(newlyEligible: number): string {
  return `first sampled shock with new eligibility · ${String(newlyEligible)} accounts`;
}

/** LF-8: the axis annotation under a column this engine did not serve. */
export const FRONTIER_NOT_SERVED = "not served";

/** LF-8: that column's title — an unknown, stated as one. */
export const FRONTIER_NOT_SERVED_TITLE =
  "This engine served no point at this sample. The values are unknown rather than zero.";

/** LF-7: row 2 is not drawn, and its absence is a STATED zero. */
export const FRONTIER_BAD_DEBT_ALL_ZERO =
  "Bad debt is $0 at every step on this grid. That is a computed zero from the served waterfall.";

/**
 * LF-7 WHEN THE GRID HAS HOLES — the sentence row 2's absence is allowed to make.
 *
 * `peakBadDebt` is a maximum over the points this engine SERVED, so a grid
 * that is all zeros where it was served and unknown where it was not produces
 * exactly the same zero. Claiming "$0 at every step on this grid" there would
 * state a computed zero for samples the ledger is at that very moment printing
 * as em dashes, which is the one conflation this whole surface exists to
 * prevent. The all-zero sentence is therefore reachable ONLY when every grid
 * sample carries a served cell; otherwise the served zeros are claimed as
 * zeros and the holes are left unknown, in the ledger's own vocabulary.
 */
export function frontierBadDebtZeroLine(servedSamples: number, gridSamples: number): string {
  const holes = gridSamples - servedSamples;
  if (holes <= 0) return FRONTIER_BAD_DEBT_ALL_ZERO;
  if (servedSamples <= 0) {
    return (
      `This engine served no sample on this grid, so bad debt is unknown at all ` +
      `${String(gridSamples)} samples rather than zero.`
    );
  }
  return (
    `Bad debt is $0 at the ${String(servedSamples)} ` +
    `${servedSamples === 1 ? "sample" : "samples"} this engine served. ` +
    `${String(holes)} of ${String(gridSamples)} ` +
    `${holes === 1 ? "samples was" : "samples were"} not served, and bad debt there is ` +
    `unknown rather than zero.`
  );
}

/** CX-3: the ledger row that used to be mislabeled as a gross arrival count. */
export const FRONTIER_FIRST_ELIGIBLE_LABEL = "first eligible on grid";

/** CX-3: the title that makes the latch/census distinction readable. */
export const FRONTIER_FIRST_ELIGIBLE_TITLE =
  "Accounts first observed eligible at this grid point. At unshocked, this is the standing " +
  "census; at later points, first sampled eligibility. Each account appears once and remains " +
  "in cumulative eligible accounts thereafter.";

/** LF-11 METHOD: encoding, unit, as-of, in one 12px line. */
export function frontierMethodLine(usdDecimals: number, batchId: number | null): string {
  return (
    `Two rows on one shock axis, each on its own y scale. All values are this engine's own ` +
    `USD at ${String(usdDecimals)} decimals and are never added to another engine's. ` +
    `As of batch #${batchId === null ? "unknown" : String(batchId)}.`
  );
}

/**
 * LF-11 ANSWER supplement — what the two rows ARE.
 *
 * This replaces the old legend paragraph, which described an inset crit bar
 * that LF-1 deleted: at the 1.5px floor the inset occluded the flow bar, so
 * `eligible $15,380 / bad $0.000046` was indistinguishable from
 * `eligible $0.000046 / bad $0.000046`.
 */
export const FRONTIER_ANSWER_SUPPLEMENT =
  "Each engine panel carries two rows on one shock axis. The top row is the debt the engine " +
  "could liquidate, and the lower row is bad debt still owed after all collateral is seized. " +
  "The dashed line marks this engine's own first sampled shock with new eligibility, and " +
  "engines cross at different samples.";

// ---------------------------------------------------------------------------
// LF-8 — the transposed LEDGER's own content.
//
// It lives here rather than in the component so the WIDTH PROBE and the RENDER
// read the same strings: `maxChars` is measured over exactly what will be
// printed, never over an estimate of it. It is also the reason the ledger is
// unit-testable without a DOM.
// ---------------------------------------------------------------------------

export interface FrontierLedgerRow {
  key: string;
  label: string;
  /** The row's own explanatory title, when the label needs one (CX-3). */
  title?: string;
  /** One string per GRID sample, in chart order. Em dash = not served. */
  cells: string[];
}

/**
 * Rows are MEASURES and columns are grid samples, which is the chart's own
 * direction: a reader comparing "Σ eligible debt across the grid" reads across
 * here exactly as they read across up there.
 *
 * R5: a computed zero renders `$0`; a sample this engine did not serve renders
 * an em dash in EVERY cell of its column. That is how a computed zero stays
 * distinguishable from a hole with no floating labels.
 */
export function frontierLedgerRows(series: FrontierSeries): FrontierLedgerRow[] {
  const usd = (value: bigint | null) =>
    value === null ? EM_DASH : renderUsdAmount(value.toString(), series.usdDecimals);
  const count = (value: number | null) =>
    value === null ? EM_DASH : value.toLocaleString("en-US");
  return [
    {
      key: "eligible-debt",
      label: "Σ eligible debt",
      cells: series.grid.map((entry) => usd(entry.cell?.eligibleDebt ?? null)),
    },
    {
      key: "bad-debt",
      label: "bad debt",
      cells: series.grid.map((entry) => usd(entry.cell?.badDebt ?? null)),
    },
    {
      key: "first-eligible",
      label: FRONTIER_FIRST_ELIGIBLE_LABEL,
      title: FRONTIER_FIRST_ELIGIBLE_TITLE,
      cells: series.grid.map((entry) => count(entry.cell?.newlyEligible ?? null)),
    },
    {
      key: "eligible-accounts",
      label: "eligible accounts",
      cells: series.grid.map((entry) => count(entry.cell?.cumulativeEligibleAccounts ?? null)),
    },
    {
      key: "collateral-at-risk",
      label: "collateral at risk",
      cells: series.grid.map((entry) => usd(entry.cell?.collateralAtRisk ?? null)),
    },
  ];
}

/** The longest printed value, in characters — the measured column's driver. */
export function frontierLedgerMaxChars(rows: readonly FrontierLedgerRow[]): number {
  let longest = 1;
  for (const row of rows) {
    for (const cell of row.cells) longest = Math.max(longest, cell.length);
  }
  return longest;
}
