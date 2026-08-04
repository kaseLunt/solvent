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

import { parseDecimal, type Waterfall, type WaterfallEngine } from "@solvent/client";
import { factorDistancePercent, renderUsdAmount } from "../../lib/book-format";

/**
 * `$1,871,766.083918` — exact string surgery at the engine's own decimals.
 *
 * CX-4: the implementation moved to `lib/book-format`'s `renderUsdAmount` so
 * the Lab's three money call sites (this, `LabBookPanel`, `LabRealization`)
 * share ONE renderer instead of two that disagreed about grouping. The name
 * stays because the Lab's callers read `labUsd` as "this engine's own USD".
 */
export function labUsd(value: string, decimals: number): string {
  return renderUsdAmount(value, decimals);
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

/**
 * ONE GRID SAMPLE, FROM THIS ENGINE'S POINT OF VIEW (LF-8).
 *
 * There is exactly one of these per point the WATERFALL served, in wire order,
 * whether or not this engine appeared at it. A `null` cell is a HOLE — the
 * engine served no point here and the values are unknown, which is a different
 * statement from zero and renders as one.
 *
 * The grid length is the wire's, never a constant: the served grid is free to
 * grow, and a hardcoded column count would silently drop the new sample.
 */
export interface FrontierGridPoint {
  index: number;
  move: string;
  prose: string | null;
  isBaseline: boolean;
  cell: FrontierCell | null;
}

/** One engine's series across the grid — the unit a frontier panel plots. */
export interface FrontierSeries {
  engine: string;
  usdDecimals: number;
  points: { move: string; prose: string | null; isBaseline: boolean; cell: FrontierCell }[];
  /** ONE ENTRY PER GRID SAMPLE, holes included, in chart order (LF-8). */
  grid: FrontierGridPoint[];
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
  /** The GRID index of this engine's own cliff — the cliff line's column. */
  cliffIndex: number | null;
  /** This engine's own newly-eligible count AT its cliff (LF-5's label). */
  cliffNewlyEligible: number | null;
  /** The grid label of the sample BEFORE the cliff — the bracket's lower end. */
  cliffPreviousMove: string | null;
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
    // THE GRID, WHOLE (LF-8): one entry per served waterfall point, in wire
    // order, with a null cell where this engine served nothing. The chart, the
    // ledger and the axis ticks all count columns from HERE, so the grid can
    // grow on the wire and every one of them follows it.
    const grid: FrontierGridPoint[] = view.steps.map((step) => ({
      index: step.index,
      move: step.move,
      prose: step.prose,
      isBaseline: step.isBaseline,
      cell: step.cells.find((candidate) => candidate.engine === engine) ?? null,
    }));
    const points = grid.flatMap((entry) =>
      entry.cell === null
        ? []
        : [
            {
              move: entry.move,
              prose: entry.prose,
              isBaseline: entry.isBaseline,
              cell: entry.cell,
            },
          ],
    );
    let peakEligibleDebt = 0n;
    let peakBadDebt = 0n;
    for (const point of points) {
      if (point.cell.eligibleDebt > peakEligibleDebt) peakEligibleDebt = point.cell.eligibleDebt;
      if (point.cell.badDebt > peakBadDebt) peakBadDebt = point.cell.badDebt;
    }
    // The engine's OWN cliff, by the same rule the book-wide one uses: the
    // first point AFTER this series' baseline with a nonzero `newly`. The
    // baseline's own count is a census and is skipped.
    //
    // It is resolved on the GRID rather than on the served points, because the
    // cliff line is drawn at a COLUMN and the columns are grid samples.
    const gridBaselineAt = grid.findIndex((entry) => entry.isBaseline);
    const searchFrom = gridBaselineAt === -1 ? 0 : gridBaselineAt + 1;
    let cliffIndex: number | null = null;
    for (let i = searchFrom; i < grid.length; i += 1) {
      const cell = grid[i]?.cell;
      if (cell !== null && cell !== undefined && cell.newlyEligible > 0) {
        cliffIndex = i;
        break;
      }
    }
    // The PREVIOUS GRID SAMPLE brackets the true threshold: the grid samples
    // discrete shocks, so all anyone knows is that the crossing happened
    // somewhere between these two. Naming only the later one would present a
    // sampling artefact as a measured threshold.
    const previous = cliffIndex === null ? undefined : grid[cliffIndex - 1];
    return {
      engine,
      usdDecimals: points[0]?.cell.usdDecimals ?? 0,
      points,
      grid,
      peakEligibleDebt,
      peakBadDebt,
      cliffMove: cliffIndex === null ? null : (grid[cliffIndex]?.move ?? null),
      cliffIndex,
      cliffNewlyEligible:
        cliffIndex === null ? null : (grid[cliffIndex]?.cell?.newlyEligible ?? null),
      cliffPreviousMove: previous === undefined ? null : previous.move,
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
