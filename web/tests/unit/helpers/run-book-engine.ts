// Minimal wire-true RunBookEngine bodies for the pure pins. A movement table
// `table[from][to] = rows` becomes the ten-lane transitions; every margin,
// histogram count and total is SUMMED from it so the fixtures cannot disagree
// with themselves. Debts are rows × a unit, so sums are exact.
import { refineProjection, type components } from "@solvent/client";
import type { LabRunBook } from "../../../lib/runbook";

type Schemas = components["schemas"];
export type Engine = Schemas["RunBookEngine"];
export type Transitions = Schemas["RunBookTransitions"];
export type Lane = Schemas["RunBookTransitionLane"];
export type Cell = Schemas["RunBookTransitionCell"];

export const WAD = 10n ** 18n;
export const EDGES = ["900000000000000000", "1000000000000000000", "1050000000000000000", "1100000000000000000", "1250000000000000000", "1500000000000000000", "2000000000000000000"] as const;
export const LABELS = ["< 0.90", "0.90 – 1.00", "1.00 – 1.05", "1.05 – 1.10", "1.10 – 1.25", "1.25 – 1.50", "1.50 – 2.00", ">= 2.00"] as const;
export const INFINITE = 8;
export const UNMEASURED = 9;

export function lanes(): Lane[] {
  const buckets: Lane[] = LABELS.map((label, i) => ({
    index: i,
    kind: "bucket",
    label,
    lower_wad: i === 0 ? null : EDGES[i - 1] ?? null,
    upper_wad: i === LABELS.length - 1 ? null : EDGES[i] ?? null,
  }));
  return [
    ...buckets,
    { index: INFINITE, kind: "infinite", label: "no debt (unbounded)", lower_wad: null, upper_wad: null },
    { index: UNMEASURED, kind: "unmeasured", label: "not measured", lower_wad: null, upper_wad: null },
  ];
}

/** `table[from][to] = rows`. An unmeasured row is `table[9][9]`. */
export type MoveTable = Readonly<Record<number, Readonly<Record<number, number>>>>;

export interface TransitionOptions {
  readonly held?: number | null;
  readonly laneChanged?: number | null;
  readonly comparator?: "hf_wad" | "hf_num/hf_den";
  readonly unitDebt?: bigint;
}

export function transitionsOf(table: MoveTable, opts: TransitionOptions = {}): Transitions {
  const L = lanes();
  const unit = opts.unitDebt ?? 1_000_000n;
  const from_rows = L.map(() => 0);
  const to_rows = L.map(() => 0);
  const outflows = L.map((lane) => ({ from: lane.index, cells: [] as Cell[] }));
  let held = 0;
  let changed = 0;
  for (const [f, row] of Object.entries(table)) {
    for (const [t, rows] of Object.entries(row)) {
      const fi = Number(f);
      const ti = Number(t);
      from_rows[fi] = (from_rows[fi] ?? 0) + rows;
      to_rows[ti] = (to_rows[ti] ?? 0) + rows;
      // rows × unit, exact in bigint for a whole count; a fractional count is a
      // deliberately malformed body, and its debt is stated in float so the
      // guards can refuse the count rather than this helper throwing first.
      const debt = Number.isInteger(rows) ? String(BigInt(rows) * unit) : String(rows * Number(unit));
      // The not-measured cell carries the wire's null: this run computed no debt for those rows.
      const unmeasuredCell = fi === UNMEASURED && ti === UNMEASURED;
      outflows[fi]?.cells.push({ to: ti, rows, debt_before_usd: unmeasuredCell ? null : debt, debt_after_usd: unmeasuredCell ? null : debt });
      if (fi !== UNMEASURED && ti !== UNMEASURED) {
        if (fi === ti) held += rows;
        else changed += rows;
      }
    }
  }
  const total = from_rows.reduce((a, b) => a + b, 0);
  const unmeasured = from_rows[UNMEASURED] ?? 0;
  return {
    comparator: opts.comparator ?? "hf_num/hf_den",
    wad_scale: WAD.toString(),
    lanes: L,
    outflows,
    from_rows,
    to_rows,
    total_rows: total,
    measured_rows: total - unmeasured,
    unmeasured_rows: unmeasured,
    unmeasured_refused_in_batch_rows: unmeasured,
    unmeasured_excluded_by_this_layer_rows: 0,
    held_rows: opts.held === undefined ? held : opts.held,
    lane_changed_rows: opts.laneChanged === undefined ? changed : opts.laneChanged,
    note: "helper: every margin is summed from the table",
  };
}

function histogram(from_rows: readonly number[], comparator: Transitions["comparator"]): Schemas["RunBookAggregate"]["hf_histogram"] {
  return {
    comparator,
    wad_scale: WAD.toString(),
    buckets: LABELS.map((label, i) => ({
      label,
      lower_wad: i === 0 ? null : EDGES[i - 1] ?? null,
      upper_wad: i === LABELS.length - 1 ? null : EDGES[i] ?? null,
      count: from_rows[i] ?? 0,
    })),
    infinite_count: from_rows[INFINITE] ?? 0,
    refused_count: from_rows[UNMEASURED] ?? 0,
    note: "helper: every count is summed from the table",
  };
}

function aggregate(rows: readonly number[], comparator: Transitions["comparator"], eligibleDebt: bigint, badDebt: bigint): Schemas["RunBookAggregate"] {
  const accounts = rows.slice(0, INFINITE + 1).reduce((a, b) => a + b, 0);
  return {
    accounts,
    eligible_accounts: (rows[0] ?? 0) + (rows[1] ?? 0),
    total_collateral_usd: String(BigInt(accounts) * 3_000_000n),
    total_debt_usd: String(BigInt(accounts) * 1_000_000n),
    eligible_debt_usd: eligibleDebt.toString(),
    collateral_at_risk_usd: "0",
    bad_debt_usd: badDebt.toString(),
    hf_histogram: histogram(rows, comparator),
    collateral_by_asset: [],
  };
}

function engineOf(engine: string, decimals: number, comparator: Transitions["comparator"], table: MoveTable, overrides: Partial<Engine>): Engine {
  const t = transitionsOf(table, { comparator });
  const crossed = t.outflows.reduce(
    (n, o) => n + (o.from >= 2 && o.from <= LABELS.length - 1 ? o.cells.filter((c) => c.to <= 1).reduce((m, c) => m + c.rows, 0) : 0),
    0,
  );
  const before = aggregate(t.from_rows, comparator, 1_000_000n * BigInt((t.from_rows[0] ?? 0) + (t.from_rows[1] ?? 0)), 0n);
  const after = aggregate(t.to_rows, comparator, 1_000_000n * BigInt((t.to_rows[0] ?? 0) + (t.to_rows[1] ?? 0)), 500_000n * BigInt(crossed));
  return {
    engine,
    usd_decimals: decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: crossed,
    eligible_debt_delta_usd: (BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)).toString(),
    bad_debt_delta_usd: (BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)).toString(),
    movers: [],
    movers_total: 0,
    movers_note: "",
    market_realization: null,
    projection: null,
    note: "helper",
    ...overrides,
  };
}

export const cashEngine = (table: MoveTable, overrides: Partial<Engine> = {}): Engine => engineOf("debt_manager", 6, "hf_num/hf_den", table, overrides);
export const legacyEngine = (table: MoveTable, overrides: Partial<Engine> = {}): Engine => engineOf("aave_v3_etherfi", 8, "hf_wad", table, overrides);

/** The demo's Cash movement table (plan R16): a −30 % mark scales cap by 0.7. */
export const DEMO_CASH_TABLE: MoveTable = {
  0: { 0: 41 },
  1: { 0: 8 },
  2: { 0: 14 },
  3: { 0: 13 },
  4: { 0: 73 },
  5: { 0: 6, 1: 12, 2: 135 },
  6: { 3: 43, 4: 129, 5: 128 },
  7: { 5: 60, 6: 320, 7: 424 },
  9: { 9: 6 },
};

// ---------------------------------------------------------------------------
// A whole run-book around the engines above, as the Lab HOLDS it: the wire
// envelope with every engine's projection sealed by the same law
// `lib/runbook.ts` applies on receipt, so a pin's record is exactly what the
// fetch layer would have stored.
// ---------------------------------------------------------------------------
export type RunBook = LabRunBook;
export type Definition = Schemas["ScenarioDefinition"];

export const DEFINITION_ETH: Definition = {
  id: "eth_minus_30",
  version: "v1",
  label: "ETH -30 percent",
  description: "All ETH-linked collateral marked down 30 percent.",
  path_assumption: "instantaneous mark at the shocked level; single-step",
  engines: ["aave_v3_etherfi", "debt_manager"],
  shocks: [{ axis: "eth_usd", factor_num: 70, factor_den: 100 }],
  out_of_model: ["liquidation bonuses", "gas"],
};

const BATCH: Schemas["Batch"] = {
  id: 18251,
  computed_at: "2026-08-08T20:22:08Z",
  age_seconds: 42,
  producer: "riskd",
  status: "complete",
  position_count: 9964,
  refused_count: 6,
  refused_engines: [],
  flagged_count: 30,
  watermarks: [],
  supersession: { superseded: false, legs: [], note: "" },
};

/** The book's coverage claim, summed from the batch so the two cannot disagree: nothing excluded, nothing withheld. */
const COVERAGE: Schemas["BookCoverage"] = {
  batch_positions: BATCH.position_count,
  in_book: BATCH.position_count - BATCH.refused_count,
  refused_in_batch: BATCH.refused_count,
  excluded_by_this_layer: 0,
  excluded: [],
  withheld_engines: [],
  stress_coverage_is_full: true,
  note: "helper: in_book is the batch's positions less its refused rows",
};

/** A wire-true run-book around the given engines, sealed as the Lab holds it. `batch` overrides let a pin state supersession. */
export function runBookOf(engines: readonly Engine[], def: Definition = DEFINITION_ETH, overrides: Partial<RunBook> = {}): RunBook {
  return {
    served_at: "2026-08-08T20:22:50Z",
    batch: BATCH,
    scenario_config_version: "v1",
    scenario_id: def.id,
    scenario_version: def.version,
    label: def.label,
    description: def.description,
    path_assumption: def.path_assumption,
    shocks: def.shocks,
    out_of_model: def.out_of_model,
    applied_shocks: [],
    held_flat: [],
    engines: engines.map((e) => ({ ...e, projection: e.projection === null ? null : refineProjection(e.projection) })),
    excluded_engines: [],
    coverage: COVERAGE,
    notes: [],
    ...overrides,
  };
}
