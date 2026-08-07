// VIEW 4 (mover dumbbells) — the pure view-model for the Aave movers chart:
// one dumbbell per shown mover, before-wad to after-wad, on a LOG health-factor
// axis with the liquidation boundary marked at exactly 1.00.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 4 + completeness critic Finding 8):
//
//   - EVERY BOUNDARY VERDICT IS DECIDED ON THE EXACT WAD (LAW-4). The pool
//     liquidates STRICTLY below 1.00: `afterWad < scale` is a bigint compare,
//     and a wad one wei under the boundary is below it — a float64 cannot see
//     that wei. `dumbbellPosition` is the ONLY float in this module and it
//     places pixels, never verdicts.
//   - THE POPULATION IS NAMED (Finding 8). Aave's `movers_total` counts every
//     account whose health factor moved down AT ALL — under a price shock,
//     most of the borrowing book — not accounts endangered. And the pool
//     serves NO count of accounts that crossed 1.00 (`newly_eligible_accounts`
//     is the waterfall net, a different computation), so no sentence here may
//     imply one exists.
//   - THE WINDOW IS NEVER AGGREGATED AS THE BOOK. The 20 shown rows are a
//     rank-biased window; nothing here sums, averages or shares over them.
//     The two counts this module does expose (`crossedShown`,
//     `alreadyBelowShown`) are facts about the rows DRAWN and every sentence
//     carrying them says so.
//   - THE CENSUS IS THE HISTOGRAM'S, AND IT IS STATED HONESTLY. buckets +
//     no-debt + refused name every row the run faced. That total can EXCEED
//     `accounts`, because `refused_count` also carries rows this layer could
//     not rebuild at all (they are in neither side's `accounts`) — the wire
//     serves no split, so this module claims none. A census the numbers
//     contradict is SURFACED, never silently rendered.
//   - AN UNPLOTTABLE ROW IS NAMED, NEVER DROPPED. A mover with a null wad
//     cannot be drawn; it stays counted and pointed at, because a chart that
//     silently loses rows is a census lie in picture form.
//
// Relative imports: this module is exercised by the Playwright unit runner,
// whose transpiler does not resolve the `@/` alias.

import type { LabRunBookEngine } from "../../lib/runbook";

export interface DumbbellRow {
  account: string;
  beforeWad: string;
  afterWad: string;
  dropWad: string;
  /** Bigint verdicts against the wad scale — strictly below 1.00 liquidates. */
  beforeBelowOne: boolean;
  afterBelowOne: boolean;
  /** Healthy before (>= 1.00), liquidatable after (< 1.00) — this shock did it. */
  crossed: boolean;
}

export interface DumbbellTick {
  wad: string;
  label: string;
  /** True on the 1.00 tick — the liquidation boundary, marked distinctly. */
  boundary: boolean;
}

export interface DumbbellCensus {
  bucketed: number;
  infinite: number;
  refused: number;
  /** bucketed + infinite + refused: every row the run faced. May exceed
   *  `accounts` — refused also carries unrebuildable rows outside it. */
  total: number;
}

export interface DumbbellChart {
  kind: "chart";
  rows: DumbbellRow[];
  /** Movers whose wads the wire did not serve — named, never dropped. */
  unplottable: string[];
  /** The domain ALWAYS contains the boundary wad, so 1.00 is always on-axis. */
  domainMinWad: string;
  domainMaxWad: string;
  scaleWad: string;
  ticks: DumbbellTick[];
  /** Facts about the rows DRAWN — never book counts; Aave serves none. */
  crossedShown: number;
  alreadyBelowShown: number;
  census: DumbbellCensus;
  /** Non-null when the served numbers contradict their own census. */
  censusContradiction: string | null;
}

export type MoverDumbbells =
  | DumbbellChart
  | { kind: "none"; censusContradiction: string | null }
  | { kind: "not-wad" }
  | { kind: "refused"; reason: string };

/**
 * The pool's liquidation boundary is the WAD — 1e18 — by DEFINITION (r88).
 * The served `wad_scale` is read as a WELD against this constant, never as an
 * authority over it: a response declaring any other scale contradicts the law
 * this chart is built on, and the chart refuses rather than obeying or
 * silently ignoring it.
 */
const AAVE_WAD = 10n ** 18n;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Decade tick label from the HF exponent: "0.1", "1.00", "10", "1k", "1M"… */
function tickLabel(exponent: number): string {
  if (exponent === 0) return "1.00";
  if (exponent < 0) return `0.${"0".repeat(-exponent - 1)}1`;
  const SUFFIXES = ["", "k", "M", "B", "T"];
  const group = Math.floor(exponent / 3);
  const mantissa = pow10(exponent - group * 3).toString();
  const suffix = SUFFIXES[group];
  // An exponent beyond the named groups keeps the exact power-of-ten form
  // rather than inventing a unit word.
  if (suffix === undefined) return `10^${String(exponent)}`;
  return `${mantissa}${suffix}`;
}

function decadeTicks(scale: bigint, min: bigint, max: bigint): DumbbellTick[] {
  const ticks: DumbbellTick[] = [];
  for (let exponent = -18; exponent <= 40; exponent++) {
    let wad: bigint;
    if (exponent >= 0) {
      wad = scale * pow10(exponent);
    } else {
      const divisor = pow10(-exponent);
      // A scale the divisor does not divide would truncate — an inexact tick
      // is not a ruler, so it is skipped rather than approximated.
      if (scale % divisor !== 0n) continue;
      wad = scale / divisor;
    }
    if (wad < min || wad > max) continue;
    ticks.push({ wad: wad.toString(), label: tickLabel(exponent), boundary: wad === scale });
  }
  return ticks;
}

function censusOf(histogram: LabRunBookEngine["before"]["hf_histogram"]): DumbbellCensus {
  const bucketed = histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const infinite = histogram.infinite_count;
  const refused = histogram.refused_count;
  return { bucketed, infinite, refused, total: bucketed + infinite + refused };
}

export function moverDumbbells(engine: LabRunBookEngine): MoverDumbbells {
  if (engine.before.hf_histogram.comparator !== "hf_wad") return { kind: "not-wad" };

  // THE SCALE WELD (r88). Two comparators cannot share one axis, and a
  // declared scale that is not the WAD unlicenses every below-1.00 verdict —
  // both are wire contradictions, and both REFUSE the chart visibly.
  const afterComparator = engine.after.hf_histogram.comparator;
  if (afterComparator !== "hf_wad") {
    return {
      kind: "refused",
      reason:
        `SCALE CONTRADICTION: the before side buckets on hf_wad but the after side buckets on ` +
        `${afterComparator} — no verdict can compare across two comparators, so the chart is refused.`,
    };
  }
  const beforeScale = engine.before.hf_histogram.wad_scale;
  const afterScale = engine.after.hf_histogram.wad_scale;
  if (BigInt(beforeScale) !== AAVE_WAD || BigInt(afterScale) !== AAVE_WAD) {
    return {
      kind: "refused",
      reason:
        `SCALE CONTRADICTION: the pool's health factor is a WAD (1e18) by definition, but this ` +
        `response declares wad_scale ${beforeScale} before and ${afterScale} after — every ` +
        `below-1.00 verdict would be unlicensed, so the chart is refused.`,
    };
  }
  const scale = AAVE_WAD;

  // THE CENSUS IS VALIDATED BEFORE ANY EXIT (r88): a zero-mover run rides the
  // same response, and "nothing moved" over an internally contradictory
  // census is an unqualified story the reader has no way to doubt.
  const before = censusOf(engine.before.hf_histogram);
  const after = censusOf(engine.after.hf_histogram);
  let censusContradiction: string | null = null;
  if (
    before.bucketed !== after.bucketed ||
    before.infinite !== after.infinite ||
    before.refused !== after.refused
  ) {
    censusContradiction =
      `CENSUS CONTRADICTION: the before side names ${String(before.bucketed)} bucketed + ` +
      `${String(before.infinite)} no-debt + ${String(before.refused)} refused and the after side ` +
      `${String(after.bucketed)} + ${String(after.infinite)} + ${String(after.refused)} — one run ` +
      `faces one set of rows, so no census claim is made.`;
  } else if (engine.before.accounts !== engine.after.accounts) {
    censusContradiction =
      `CENSUS CONTRADICTION: the run reports ${String(engine.before.accounts)} accounts before ` +
      `and ${String(engine.after.accounts)} after — one run measures one set of rows, so no ` +
      `census claim is made.`;
  } else if (before.total < engine.before.accounts) {
    censusContradiction =
      `CENSUS CONTRADICTION: buckets + no-debt + refused name ${String(before.total)} rows, ` +
      `fewer than the run's own ${String(engine.before.accounts)} accounts — rows are ` +
      `unaccounted for, so no census claim is made.`;
  }

  if (engine.movers.length === 0) return { kind: "none", censusContradiction };

  const rows: DumbbellRow[] = [];
  const unplottable: string[] = [];

  for (const mover of engine.movers) {
    if (mover.hf_before_wad === null || mover.hf_after_wad === null || mover.hf_drop_wad === null) {
      unplottable.push(mover.account);
      continue;
    }
    const beforeWad = BigInt(mover.hf_before_wad);
    const afterWad = BigInt(mover.hf_after_wad);
    rows.push({
      account: mover.account,
      beforeWad: mover.hf_before_wad,
      afterWad: mover.hf_after_wad,
      dropWad: mover.hf_drop_wad,
      beforeBelowOne: beforeWad < scale,
      afterBelowOne: afterWad < scale,
      crossed: beforeWad >= scale && afterWad < scale,
    });
  }

  // The domain is the data's extent AND the boundary: on a log axis the
  // stretch to 1.00 is cheap, and a boundary off-axis is a boundary unmarked.
  let min = scale;
  let max = scale;
  for (const row of rows) {
    const beforeWad = BigInt(row.beforeWad);
    const afterWad = BigInt(row.afterWad);
    if (afterWad < min) min = afterWad;
    if (beforeWad > max) max = beforeWad;
    if (beforeWad < min) min = beforeWad;
    if (afterWad > max) max = afterWad;
  }

  return {
    kind: "chart",
    rows,
    unplottable,
    domainMinWad: min.toString(),
    domainMaxWad: max.toString(),
    scaleWad: scale.toString(),
    ticks: decadeTicks(scale, min, max),
    crossedShown: rows.filter((row) => row.crossed).length,
    alreadyBelowShown: rows.filter((row) => row.beforeBelowOne).length,
    census: before,
    censusContradiction,
  };
}

/**
 * PIXELS ONLY (LAW-4): the log-scaled fraction of the axis at which a wad
 * sits. Every verdict about the same wad is made in bigint above — this
 * number reaches nothing but an x coordinate.
 */
export function dumbbellPosition(wad: string, domainMinWad: string, domainMaxWad: string): number {
  const value = Math.log(Number(wad));
  const lo = Math.log(Number(domainMinWad));
  const hi = Math.log(Number(domainMaxWad));
  if (!(hi > lo)) return 0.5;
  const fraction = (value - lo) / (hi - lo);
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Finding 8, discharged on the page: what Aave's `movers_total` counts, what
 * it does not count, and the count the pool does not serve.
 */
export function moverPopulationLine(total: number): string {
  return (
    `A drop is movement, not danger: ${String(total)} counts every account whose health factor ` +
    `fell at all — under a price shock, most of the borrowing book — and the pool serves no ` +
    `count of accounts that crossed 1.00.`
  );
}

/** The window-onto-census sentence — the whole run accounted for, visibly. */
export function dumbbellCensusLine(census: DumbbellCensus): string {
  return (
    `A window onto the run's own census: ${String(census.bucketed)} bucketed on both sides + ` +
    `${String(census.infinite)} no-debt (unbounded health factor, excluded from movers by ` +
    `construction) + ${String(census.refused)} refused = ${String(census.total)} rows this run faced.`
  );
}

/**
 * The boundary facts about the rows DRAWN — window-scoped by sentence,
 * because Aave serves no book-wide crossing count to compare them against.
 */
export function dumbbellWindowLine(model: DumbbellChart): string | null {
  const shown = model.rows.length;
  const noun = shown === 1 ? "row" : "rows";
  if (model.crossedShown > 0) {
    const began =
      model.alreadyBelowShown > 0
        ? ` and ${String(model.alreadyBelowShown)} began there already`
        : "";
    return (
      `${String(model.crossedShown)} of the ${String(shown)} ${noun} drawn crossed below 1.00 ` +
      `under this shock${began} — a fact about this window, never a book-wide crossing count ` +
      `(the pool serves none).`
    );
  }
  if (model.alreadyBelowShown > 0) {
    const verb = model.alreadyBelowShown === 1 ? "was" : "were";
    return (
      `${String(model.alreadyBelowShown)} of the ${String(shown)} ${noun} drawn ${verb} below ` +
      `1.00 before the shock and fell further — a fact about this window, never a book-wide count.`
    );
  }
  return null;
}

/** The unplottable aside — a row the chart cannot draw stays counted. */
export function dumbbellUnplottableLine(count: number): string {
  const noun = count === 1 ? "mover row carries" : "mover rows carry";
  return (
    `${String(count)} ${noun} no served wad and cannot be drawn — ` +
    `listed in the table below, never dropped.`
  );
}

/** SLOT 6 for the dumbbell chart. */
export const DUMBBELL_METHOD =
  "Dumbbells: hollow dot before, filled dot after, one row per shown account on a LOG " +
  "health-factor axis — log placement is pixels only; every below-1.00 verdict is decided on " +
  "the exact wad. Rows keep the served drop ranking, so the longest line is not the row " +
  "nearest the boundary: the after dot decides that. The pool liquidates strictly below 1.00; " +
  "exactly 1.00 is healthy.";
