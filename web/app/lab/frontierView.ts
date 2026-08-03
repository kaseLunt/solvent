// THE LOSS FRONTIER's view model — derived from `/v1/book`'s `waterfall`.
//
// Wave W-SD-A. Book mode arrives ALIVE with zero runs, and this is the data
// that makes that possible: `/v1/book` serves the eth_minus_30 waterfall COLD,
// so the frontier is on screen before anybody clicks anything.
//
// Two laws are load-bearing here and are the reason this module exists at all:
//
//  1. NEVER SUM ACROSS ENGINES. The wire says it in its own note — "aggregates
//     are per engine in each engine's OWN unit and decimals; they are never
//     summed across engines". So every series this module yields is
//     engine-scoped, every formatted string carries the engine's own
//     `usd_decimals`, and there is no book-wide total anywhere in the file.
//  2. NO FLOAT HOLDS A VALUE. Amounts stay `bigint` from `parseDecimal` to the
//     exact display string. Floats appear only as chart GEOMETRY, computed in
//     the component from `Number()` at the last moment.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import { formatUnits, parseDecimal, type Waterfall, type WaterfallEngine } from "@solvent/client";
import { factorDistancePercent, groupDecimalString } from "../../lib/book-format";

/** `$1,871,766.083918` — exact string surgery at the engine's own decimals. */
export function labUsd(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/**
 * The reader's words for a grid factor.
 *
 * The unshocked point is named as such rather than as "+0%": it is the
 * standing census, not a projection, and the whole frontier is read against
 * it. Everything else is the exact signed distance from 1.0, computed by
 * `lib/book-format`'s bigint helper (no float touches it).
 */
export function moveLabel(factor: bigint, gridScale: bigint): string {
  if (gridScale === 0n) return "grid scale 0";
  if (factor === gridScale) return "unshocked";
  return factorDistancePercent(factor, gridScale) ?? "unstatable";
}

/**
 * "down 20%" / "up 5%" — the prose form, for sentences rather than axis ticks.
 * Null when the move cannot be stated (a zero grid scale, or the unshocked
 * point, which is not a move at all).
 */
export function moveProse(factor: bigint, gridScale: bigint): string | null {
  if (gridScale === 0n || factor === gridScale) return null;
  const percent = factorDistancePercent(factor, gridScale);
  if (percent === null) return null;
  // factorDistancePercent yields "−30%" / "+5%" with the typographic minus.
  const direction = percent.startsWith("+") ? "up" : "down";
  return `${direction} ${percent.slice(1)}`;
}

/** One engine's numbers at one grid point, exact. */
export interface FrontierCell {
  engine: string;
  usdDecimals: number;
  newlyEligible: number;
  cumulativeEligibleAccounts: number;
  eligibleDebt: bigint;
  collateralAtRisk: bigint;
  insolventIfLiquidated: number;
  badDebt: bigint;
}

/** One grid point, with every engine the wire served at it. */
export interface FrontierStep {
  index: number;
  factor: bigint;
  /** `unshocked` / `−20%` — the axis tick, in reader words. */
  move: string;
  /** `down 20%` — the prose form; null at the unshocked point. */
  prose: string | null;
  isBaseline: boolean;
  cells: FrontierCell[];
}

/** The whole frontier, engine-scoped, ready to plot. */
export interface FrontierView {
  gridScale: bigint;
  steps: FrontierStep[];
  /** Engines in WIRE order, taken from the first served point. */
  engines: string[];
  /** The unshocked point's position in `steps`, or null when none was served. */
  baselineIndex: number | null;
  /** The first step AFTER the baseline at which any engine gains eligibility. */
  cliffIndex: number | null;
  /** Engines that gained eligibility at `cliffIndex`, wire order. */
  cliffEngines: string[];
}

function toCell(engine: WaterfallEngine): FrontierCell {
  return {
    engine: engine.engine,
    usdDecimals: engine.usd_decimals,
    newlyEligible: engine.newly_eligible_accounts,
    cumulativeEligibleAccounts: engine.cumulative_eligible_accounts,
    eligibleDebt: parseDecimal(engine.cumulative_debt_eligible_usd),
    collateralAtRisk: parseDecimal(engine.cumulative_collateral_at_risk_usd),
    insolventIfLiquidated: engine.insolvent_if_liquidated_accounts,
    badDebt: parseDecimal(engine.cumulative_bad_debt_usd),
  };
}

/**
 * Fold the served waterfall into the frontier view.
 *
 * THE CLIFF, defined once and used by every sentence on this surface: the
 * first grid point AFTER the unshocked baseline at which any engine reports
 * `newly_eligible_accounts > 0`. "Newly" is the wire's own word and its own
 * count — this module never re-derives eligibility from a health factor, and
 * never reads the baseline's standing census as a cliff (accounts already
 * eligible at ×1.00 are a census, not something the scenario did).
 *
 * When no unshocked point is served, there is no baseline to read against and
 * `baselineIndex` is null; the cliff search then starts at the first served
 * point, because every served point is a shocked one.
 */
export function frontierView(waterfall: Waterfall): FrontierView {
  const gridScale = parseDecimal(waterfall.grid_scale);
  const steps: FrontierStep[] = waterfall.points.map((point) => {
    const factor = parseDecimal(point.factor);
    return {
      index: point.index,
      factor,
      move: moveLabel(factor, gridScale),
      prose: moveProse(factor, gridScale),
      isBaseline: gridScale !== 0n && factor === gridScale,
      cells: point.engines.map(toCell),
    };
  });

  const baselineIndex = steps.findIndex((step) => step.isBaseline);
  const searchFrom = baselineIndex === -1 ? 0 : baselineIndex + 1;
  let cliffIndex: number | null = null;
  let cliffEngines: string[] = [];
  for (let i = searchFrom; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const gained = step.cells.filter((cell) => cell.newlyEligible > 0);
    if (gained.length > 0) {
      cliffIndex = i;
      cliffEngines = gained.map((cell) => cell.engine);
      break;
    }
  }

  return {
    gridScale,
    steps,
    engines: (steps[0]?.cells ?? []).map((cell) => cell.engine),
    baselineIndex: baselineIndex === -1 ? null : baselineIndex,
    cliffIndex,
    cliffEngines,
  };
}

/** One engine's series across the grid — the unit a frontier panel plots. */
export interface FrontierSeries {
  engine: string;
  usdDecimals: number;
  points: { move: string; prose: string | null; isBaseline: boolean; cell: FrontierCell }[];
  /** Largest eligible debt on the series — the panel's own y ceiling. */
  peakEligibleDebt: bigint;
  /** Largest bad debt on the series. */
  peakBadDebt: bigint;
  /**
   * THIS ENGINE's own first step with new eligibility — not the book's.
   *
   * The book-wide cliff is the earliest step at which ANY engine crosses, and
   * drawing that line on an engine that crosses three steps later would tell
   * the reader this engine breaks where it does not. Each panel marks its own.
   */
  cliffMove: string | null;
}

/**
 * Split the frontier into one series PER ENGINE.
 *
 * Per-engine panels rather than one shared y axis: the two engines' books
 * differ by orders of magnitude in real USD, and a shared scale would flatten
 * the smaller engine's whole story into the axis. (It would also invite the
 * eye to compare heights across units that are not the same unit.)
 *
 * An engine absent from a point contributes NO point to its series — a hole,
 * never an interpolated zero.
 */
export function frontierSeries(view: FrontierView): FrontierSeries[] {
  return view.engines.map((engine) => {
    const points = view.steps.flatMap((step) => {
      const cell = step.cells.find((candidate) => candidate.engine === engine);
      return cell === undefined
        ? []
        : [{ move: step.move, prose: step.prose, isBaseline: step.isBaseline, cell }];
    });
    let peakEligibleDebt = 0n;
    let peakBadDebt = 0n;
    for (const point of points) {
      if (point.cell.eligibleDebt > peakEligibleDebt) peakEligibleDebt = point.cell.eligibleDebt;
      if (point.cell.badDebt > peakBadDebt) peakBadDebt = point.cell.badDebt;
    }
    // The engine's OWN cliff, by the same rule the book-wide one uses: the
    // first point AFTER this series' baseline with a nonzero `newly`. The
    // baseline's own count is a census and is skipped.
    const baselineAt = points.findIndex((point) => point.isBaseline);
    const cliffMove =
      points
        .slice(baselineAt === -1 ? 0 : baselineAt + 1)
        .find((point) => point.cell.newlyEligible > 0)?.move ?? null;
    return {
      engine,
      usdDecimals: points[0]?.cell.usdDecimals ?? 0,
      points,
      peakEligibleDebt,
      peakBadDebt,
      cliffMove,
    };
  });
}

/**
 * The engine carrying the most eligible debt at the grid's LAST point.
 *
 * Magnitudes ARE comparable across engines once each is scaled by its own
 * `usd_decimals` — both are USD. Adding them is what the wire forbids, and
 * this function does not add them: it picks one engine to NAME, and every
 * sentence built on it says whose book it is. Ties resolve to wire order.
 */
export function leadEngineAtTerminal(view: FrontierView): FrontierCell | null {
  const terminal = view.steps[view.steps.length - 1];
  if (terminal === undefined) return null;
  let lead: FrontierCell | null = null;
  let leadScaled = -1n;
  const maxDecimals = terminal.cells.reduce((max, cell) => Math.max(max, cell.usdDecimals), 0);
  for (const cell of terminal.cells) {
    const scaled = cell.eligibleDebt * 10n ** BigInt(maxDecimals - cell.usdDecimals);
    if (scaled > leadScaled) {
      leadScaled = scaled;
      lead = cell;
    }
  }
  return lead;
}

/** The same engine's cell at an arbitrary step, or null when it is absent. */
export function cellAt(view: FrontierView, stepIndex: number, engine: string): FrontierCell | null {
  return view.steps[stepIndex]?.cells.find((cell) => cell.engine === engine) ?? null;
}

/**
 * The AXIS in reader words.
 *
 * The contract seals five axis values; each gets a phrase a reader who has
 * never opened the schema can act on. An axis outside the vocabulary renders
 * VERBATIM — a surface that invents words for an axis it does not know is a
 * surface that will one day describe the wrong shock.
 */
export function axisWords(axis: string, axisAsset?: string): string {
  switch (axis) {
    case "eth_usd":
      return "ETH";
    case "weeth_eth_rate":
      return "the weETH/ETH rate";
    case "stable_usd":
      return "the stablecoin marks";
    case "borrow_apy":
      return "the borrow rate";
    case "asset_usd":
      return axisAsset === undefined
        ? "the shocked asset"
        : `the shocked asset ${axisAsset.slice(0, 6)}…${axisAsset.slice(-4)}`;
    default:
      return axis;
  }
}
