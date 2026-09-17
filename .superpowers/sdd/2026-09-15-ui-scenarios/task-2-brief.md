### Task 2: `lab-transitions` — the wire's lanes under guards, merged into room bands (R1)

**Files:**
- Create: `web/lib/lab-transitions.ts`, `web/tests/unit/helpers/run-book-engine.ts`
- Test: `web/tests/unit/lab-transitions.spec.ts`

**Interfaces:**
- Consumes: `@solvent/client` `components["schemas"]["RunBookEngine" | "RunBookTransitions" | "RunBookTransitionLane" | "RunBookTransitionCell"]`; `lib/wireGuard.ts` (`isWireDecimal`, `isWirePopulation`, `isWireScale`, `wireBigInt`); `lib/prose.ts` (`groupInt`).
- Produces: `laneReading(engine: RunBookEngine, options: { merge: boolean }): LaneReading`; `roomBoundLabel(wad: bigint): string`; `CONTRACT_LANE_EDGES`; types `RoomBand`, `HeatCell`, `HeatMovement`, `HeatmapView`, `LaneReading`. The helper `cashEngine(table, overrides?)`, `legacyEngine(table, overrides?)`, `lanes()`, `transitionsOf(table, unitDebt?, opts?)`, `MoveTable`.

- [ ] **Step 1: The unit helper — wire-true engines from a movement table**

```ts
// web/tests/unit/helpers/run-book-engine.ts
// Minimal wire-true RunBookEngine bodies for the pure pins. A movement table
// `table[from][to] = rows` becomes the ten-lane transitions; every margin,
// histogram count and total is SUMMED from it so the fixtures cannot disagree
// with themselves. Debts are rows × a unit, so sums are exact.
import type { components } from "@solvent/client";

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
      outflows[fi]?.cells.push({ to: ti, rows, debt_before_usd: String(BigInt(rows) * unit), debt_after_usd: String(BigInt(rows) * unit) });
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
```

- [ ] **Step 2: The pins (failing)**

```ts
// web/tests/unit/lab-transitions.spec.ts
// The transition heatmap's law: the wire's ten lanes, read under the guards,
// merged by exact summation into the room bands the page shows; anything the
// wire contradicts is a named refusal, never a drawn grid.
import { expect, test } from "@playwright/test";
import { CONTRACT_LANE_EDGES, laneReading, roomBoundLabel } from "../../lib/lab-transitions";
import { cashEngine, DEMO_CASH_TABLE, EDGES, legacyEngine, transitionsOf } from "./helpers/run-book-engine";

const ok = (r: ReturnType<typeof laneReading>) => {
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.reasons.join("; ")}`);
  return r.view;
};
const contradictory = (r: ReturnType<typeof laneReading>) => {
  if (r.kind !== "contradictory") throw new Error("expected contradictory");
  return r.reasons;
};

test("roomBoundLabel: the exact room a health-factor edge means, in basis points, trailing zeros dropped", () => {
  expect(roomBoundLabel(BigInt(EDGES[2]))).toBe("4.76%");
  expect(roomBoundLabel(BigInt(EDGES[3]))).toBe("9.09%");
  expect(roomBoundLabel(BigInt(EDGES[4]))).toBe("20%");
  expect(roomBoundLabel(BigInt(EDGES[5]))).toBe("33.33%");
  expect(roomBoundLabel(BigInt(EDGES[6]))).toBe("50%");
  expect(roomBoundLabel(BigInt(EDGES[1]))).toBe("0%");
  expect(CONTRACT_LANE_EDGES.map(String)).toEqual([...EDGES]);
});

test("the demo table merges into seven room bands with the true converted labels, and every count is a sum of the wire's cells", () => {
  const v = ok(laneReading(cashEngine(DEMO_CASH_TABLE), { merge: true }));
  expect(v.merged).toBe(true);
  expect(v.bands.map((b) => b.label)).toEqual(["over cap", "< 4.76%", "4.76% – 9.09%", "9.09% – 20%", "≥ 20%", "no debt", "not measured"]);
  expect(v.bands[0]?.lanes).toEqual([0, 1]);
  expect(v.bands[4]?.lanes).toEqual([5, 6, 7]);
  expect(v.totalRows).toBe(1412);
  expect(v.measuredRows).toBe(1406);
  expect(v.unmeasuredRows).toBe(6);
  expect(v.laneChangedRows).toBe(941);
  expect(v.heldRows).toBe(465);
  expect(v.crossedCap).toBe(118);
  expect(v.bandChanged).toBe(425);
  expect(v.improved).toBe(0);
  expect(v.nearToday).toBe(27);
  expect(v.nearCrossed).toBe(27);
  expect(v.nearLabel).toBe("9.09%");
  const cell = (from: number, to: number) => v.cells.find((c) => c.from === from && c.to === to);
  expect(cell(0, 0)?.rows).toBe(49); // lanes 0 and 1 both land in "over cap": 41 held + 8 from lane 1
  expect(cell(0, 0)?.movement).toBe("held");
  expect(cell(1, 0)?.rows).toBe(14);
  expect(cell(1, 0)?.movement).toBe("worse");
  expect(cell(4, 0)?.rows).toBe(18);
  expect(cell(4, 1)?.rows).toBe(135);
  expect(cell(4, 4)?.rows).toBe(128 + 60 + 320 + 424);
  expect(cell(6, 6)?.rows).toBe(6);
  expect(cell(6, 6)?.movement).toBe("unmeasured");
  expect(cell(4, 0)?.debtBefore).toBe(18_000_000n);
  expect(v.maxRows).toBe(932);
  expect(v.cells.every((c) => c.rows > 0)).toBe(true);
});

test("a lane that rises is counted improved and drawn better; a lane change inside one band is a lane change but not a band change", () => {
  const v = ok(laneReading(cashEngine({ 2: { 3: 5, 2: 10 }, 6: { 7: 4, 6: 1 }, 1: { 0: 3 } }), { merge: true }));
  expect(v.improved).toBe(9);
  expect(v.laneChangedRows).toBe(12);
  expect(v.bandChanged).toBe(5);
  expect(v.cells.find((c) => c.from === 1 && c.to === 2)?.movement).toBe("better");
  expect(v.cells.find((c) => c.from === 4 && c.to === 4)?.movement).toBe("held");
  expect(v.cells.find((c) => c.from === 0 && c.to === 0)?.movement).toBe("held");
});

test("the legacy engine is never merged: the wire's own eight bucket labels plus no debt and not measured, HF vocabulary", () => {
  const v = ok(laneReading(legacyEngine({ 5: { 3: 2 }, 7: { 7: 1 } }), { merge: false }));
  expect(v.merged).toBe(false);
  expect(v.bands).toHaveLength(10);
  expect(v.bands.map((b) => b.label)).toEqual(["< 0.90", "0.90 – 1.00", "1.00 – 1.05", "1.05 – 1.10", "1.10 – 1.25", "1.25 – 1.50", "1.50 – 2.00", ">= 2.00", "no debt (unbounded)", "not measured"]);
  expect(v.nearLabel).toBeNull();
  expect(v.cells.find((c) => c.from === 5 && c.to === 3)?.movement).toBe("worse");
});

test("edges that are not the contract's do not merge: the wire's lanes render verbatim and the view says so", () => {
  const engine = cashEngine({ 2: { 2: 1 } });
  const lanesShifted = engine.hf_transitions.lanes.map((l) => (l.index === 2 ? { ...l, upper_wad: "1060000000000000000" } : l.index === 3 ? { ...l, lower_wad: "1060000000000000000" } : l));
  const buckets = engine.before.hf_histogram.buckets.map((b, i) => (i === 2 ? { ...b, upper_wad: "1060000000000000000" } : i === 3 ? { ...b, lower_wad: "1060000000000000000" } : b));
  const shifted = {
    ...engine,
    hf_transitions: { ...engine.hf_transitions, lanes: lanesShifted },
    before: { ...engine.before, hf_histogram: { ...engine.before.hf_histogram, buckets } },
  };
  const v = ok(laneReading(shifted, { merge: true }));
  expect(v.merged).toBe(false);
  expect(v.bands).toHaveLength(10);
  expect(v.bands[2]?.label).toBe("1.00 – 1.05");
});

test("every wire contradiction is named, and a contradicted matrix is never a view", () => {
  const base = cashEngine({ 2: { 0: 3, 2: 2 }, 9: { 9: 1 } });
  const t = base.hf_transitions;
  const withT = (patch: Partial<typeof t>) => laneReading({ ...base, hf_transitions: { ...t, ...patch } }, { merge: true });
  expect(contradictory(withT({ lanes: t.lanes.slice(0, 9) })).join(" ")).toContain("lanes");
  expect(contradictory(withT({ from_rows: t.from_rows.slice(0, 9) })).join(" ")).toContain("same length");
  expect(contradictory(withT({ comparator: "hf_wad" })).join(" ")).toContain("comparator");
  expect(contradictory(withT({ wad_scale: "0x10" })).join(" ")).toContain("wad_scale");
  expect(contradictory(withT({ total_rows: 7 })).join(" ")).toContain("total_rows");
  expect(contradictory(withT({ to_rows: t.to_rows.map((n, i) => (i === 0 ? n + 1 : n)) })).join(" ")).toContain("to_rows");
  expect(contradictory(withT({ held_rows: 1, lane_changed_rows: 1 })).join(" ")).toContain("held_rows");
  expect(contradictory(withT({ measured_rows: 4 })).join(" ")).toContain("measured_rows");
  const badCell = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: o.cells.map((c) => (c.to === 0 ? { ...c, debt_before_usd: "1e6" } : c)) } : o));
  expect(contradictory(withT({ outflows: badCell })).join(" ")).toContain("outflows[2].cells[0].debt_before_usd");
  const outOfRange = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: [{ ...o.cells[0]!, to: 12 }, ...o.cells.slice(1)] } : o));
  expect(contradictory(withT({ outflows: outOfRange })).join(" ")).toContain("to 12");
  expect(contradictory(laneReading({ ...base, usd_decimals: -1 }, { merge: true })).join(" ")).toContain("usd_decimals");
  const fractional = transitionsOf({ 2: { 2: 1.5 } });
  expect(contradictory(laneReading({ ...base, hf_transitions: fractional }, { merge: true })).join(" ")).toContain("rows");
});

test("null held/lane-changed tallies are carried as null, not zero, and the view still draws", () => {
  const v = ok(laneReading(cashEngine({ 2: { 2: 3 } }, { hf_transitions: transitionsOf({ 2: { 2: 3 } }, { held: null, laneChanged: null }) }), { merge: true }));
  expect(v.heldRows).toBeNull();
  expect(v.laneChangedRows).toBeNull();
  expect(v.bandChanged).toBe(0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-transitions'`.

- [ ] **Step 4: The module**

```ts
// web/lib/lab-transitions.ts
// The transition heatmap's model. The wire serves `hf_transitions`: ten lanes
// (eight health-factor buckets, no-debt, not-measured), one outflow list per
// lane, and margins. This module reads it under the wire guards, refuses a
// matrix that contradicts itself by name, and — for the Cash engine, whose
// health factor is cap ÷ debt so room = 1 − 1/HF — merges adjacent lanes by
// exact summation into the room bands the page draws. Nothing is re-bucketed:
// a merged cell is the sum of the wire's cells, and its label is the true
// converted bound of the wire's own edge.
import type { components } from "@solvent/client";
import { isWireDecimal, isWirePopulation, isWireScale, wireBigInt } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookTransitions = Schemas["RunBookTransitions"];
export type TransitionLane = Schemas["RunBookTransitionLane"];

const WAD = 10n ** 18n;

/** The contract's bucket edges: 0.90 · 1.00 · 1.05 · 1.10 · 1.25 · 1.50 · 2.00. Merging happens only when the wire's buckets are exactly these. */
export const CONTRACT_LANE_EDGES: readonly bigint[] = [
  900_000_000_000_000_000n,
  1_000_000_000_000_000_000n,
  1_050_000_000_000_000_000n,
  1_100_000_000_000_000_000n,
  1_250_000_000_000_000_000n,
  1_500_000_000_000_000_000n,
  2_000_000_000_000_000_000n,
];

export interface RoomBand {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly lanes: readonly number[];
  readonly kind: "bucket" | "infinite" | "unmeasured";
  readonly overCap: boolean;
}
export type HeatMovement = "held" | "worse" | "better" | "unmeasured";
export interface HeatCell {
  readonly from: number;
  readonly to: number;
  readonly rows: number;
  readonly debtBefore: bigint;
  readonly debtAfter: bigint;
  readonly movement: HeatMovement;
}
export interface HeatmapView {
  readonly merged: boolean;
  readonly bands: readonly RoomBand[];
  /** Only occupied cells; band indexes. */
  readonly cells: readonly HeatCell[];
  readonly maxRows: number;
  readonly totalRows: number;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly heldRows: number | null;
  readonly laneChangedRows: number | null;
  /** Rows whose band after differs from their band today (both ends measured). */
  readonly bandChanged: number;
  /** Rows that were inside their cap today and are over it after. */
  readonly crossedCap: number;
  /** Rows whose lane rose (a health factor that improved). */
  readonly improved: number;
  /** Merged only: rows in the two bands nearest the cap today, and how many of them cross it. */
  readonly nearToday: number;
  readonly nearCrossed: number;
  readonly nearLabel: string | null;
  readonly decimals: number;
}
export type LaneReading = { readonly kind: "ok"; readonly view: HeatmapView } | { readonly kind: "contradictory"; readonly reasons: readonly string[] };

/** The room a health-factor edge means — `(hf − 1) ÷ hf` in basis points, printed with the trailing zeros dropped. */
export function roomBoundLabel(wad: bigint): string {
  if (wad <= WAD) return "0%";
  const bp = ((wad - WAD) * 10_000n) / wad;
  const whole = bp / 100n;
  const frac = bp % 100n;
  if (frac === 0n) return `${String(whole)}%`;
  const two = frac < 10n ? `0${String(frac)}` : String(frac);
  return `${String(whole)}.${two.replace(/0$/, "")}%`;
}

interface Read {
  readonly lanes: readonly TransitionLane[];
  readonly bucketCount: number;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly cells: readonly { from: number; to: number; rows: number; before: bigint; after: bigint }[];
}

function guards(engine: RunBookEngine): { read: Read | null; reasons: string[] } {
  const reasons: string[] = [];
  const t = engine.hf_transitions;
  const buckets = engine.before.hf_histogram.buckets;
  const laneCount = t.lanes.length;
  if (!isWireScale(engine.usd_decimals)) reasons.push(`usd_decimals ${JSON.stringify(engine.usd_decimals)} is not a wire scale`);
  if (laneCount !== buckets.length + 2) {
    reasons.push(`the matrix states ${String(laneCount)} lanes over ${String(buckets.length)} risk bands, and the vocabulary is the bands plus the two tallies beside them`);
  }
  if (t.outflows.length !== laneCount || t.from_rows.length !== laneCount || t.to_rows.length !== laneCount) {
    reasons.push("the matrix's lanes, outflows and two margins are not the same length");
  }
  if (t.comparator !== engine.before.hf_histogram.comparator) {
    reasons.push(`the matrix is stated on comparator ${t.comparator} and the distribution beside it on ${engine.before.hf_histogram.comparator}`);
  }
  if (!isWireDecimal(t.wad_scale)) reasons.push(`wad_scale ${JSON.stringify(t.wad_scale)} is outside the wire Decimal contract`);
  t.lanes.forEach((lane, i) => {
    if (lane.index !== i) reasons.push(`lanes[${String(i)}].index is ${String(lane.index)}`);
    if (lane.kind === "bucket") {
      if (lane.lower_wad !== null && wireBigInt(lane.lower_wad) === null) reasons.push(`lanes[${String(i)}].lower_wad ${JSON.stringify(lane.lower_wad)} is unreadable`);
      if (lane.upper_wad !== null && wireBigInt(lane.upper_wad) === null) reasons.push(`lanes[${String(i)}].upper_wad ${JSON.stringify(lane.upper_wad)} is unreadable`);
    }
  });
  const bucketCount = t.lanes.filter((l) => l.kind === "bucket").length;
  const infinite = t.lanes.findIndex((l) => l.kind === "infinite");
  const unmeasured = t.lanes.findIndex((l) => l.kind === "unmeasured");
  if (laneCount >= 2 && (infinite !== laneCount - 2 || unmeasured !== laneCount - 1)) {
    reasons.push("the lanes are not the buckets in order followed by no-debt and not-measured");
  }
  for (const [name, value] of [["total_rows", t.total_rows], ["measured_rows", t.measured_rows], ["unmeasured_rows", t.unmeasured_rows]] as const) {
    if (!isWirePopulation(value)) reasons.push(`${name} ${JSON.stringify(value)} is not a wire population`);
  }
  for (const [name, arr] of [["from_rows", t.from_rows], ["to_rows", t.to_rows]] as const) {
    arr.forEach((n, i) => {
      if (!isWirePopulation(n)) reasons.push(`${name}[${String(i)}] ${JSON.stringify(n)} is not a wire population`);
    });
  }
  if (t.held_rows !== null && !isWirePopulation(t.held_rows)) reasons.push(`held_rows ${JSON.stringify(t.held_rows)} is not a wire population`);
  if (t.lane_changed_rows !== null && !isWirePopulation(t.lane_changed_rows)) reasons.push(`lane_changed_rows ${JSON.stringify(t.lane_changed_rows)} is not a wire population`);
  if (reasons.length > 0) return { read: null, reasons };

  const cells: { from: number; to: number; rows: number; before: bigint; after: bigint }[] = [];
  const arrivals = t.to_rows.map(() => 0);
  t.outflows.forEach((o, i) => {
    if (o.from !== i) reasons.push(`outflows[${String(i)}].from is ${String(o.from)}`);
    let sum = 0;
    o.cells.forEach((c, j) => {
      const at = `outflows[${String(i)}].cells[${String(j)}]`;
      if (!isWirePopulation(c.rows)) {
        reasons.push(`${at}.rows ${JSON.stringify(c.rows)} is not a wire population`);
        return;
      }
      if (!Number.isInteger(c.to) || c.to < 0 || c.to >= laneCount) {
        reasons.push(`${at} names lane to ${String(c.to)}, and there are ${String(laneCount)} lanes`);
        return;
      }
      const before = wireBigInt(c.debt_before_usd);
      const after = wireBigInt(c.debt_after_usd);
      if (before === null) reasons.push(`${at}.debt_before_usd ${JSON.stringify(c.debt_before_usd)} is outside the wire Decimal contract`);
      if (after === null) reasons.push(`${at}.debt_after_usd ${JSON.stringify(c.debt_after_usd)} is outside the wire Decimal contract`);
      if (before === null || after === null) return;
      sum += c.rows;
      arrivals[c.to] = (arrivals[c.to] ?? 0) + c.rows;
      cells.push({ from: i, to: c.to, rows: c.rows, before, after });
    });
    if (sum !== t.from_rows[i]) reasons.push(`outflows[${String(i)}] sums to ${String(sum)} rows and from_rows[${String(i)}] states ${String(t.from_rows[i])}`);
  });
  t.to_rows.forEach((n, j) => {
    if (arrivals[j] !== n) reasons.push(`to_rows[${String(j)}] states ${String(n)} and the cells arriving there sum to ${String(arrivals[j])}`);
  });
  const fromSum = t.from_rows.reduce((a, b) => a + b, 0);
  if (fromSum !== t.total_rows) reasons.push(`total_rows states ${String(t.total_rows)} and from_rows sums to ${String(fromSum)}`);
  if (t.measured_rows + t.unmeasured_rows !== t.total_rows) {
    reasons.push(`measured_rows ${String(t.measured_rows)} + unmeasured_rows ${String(t.unmeasured_rows)} is not total_rows ${String(t.total_rows)}`);
  }
  if (t.held_rows !== null && t.lane_changed_rows !== null && t.held_rows + t.lane_changed_rows !== t.measured_rows) {
    reasons.push(`held_rows ${String(t.held_rows)} + lane_changed_rows ${String(t.lane_changed_rows)} is not measured_rows ${String(t.measured_rows)}`);
  }
  if (reasons.length > 0) return { read: null, reasons };
  return { read: { lanes: t.lanes, bucketCount, from: t.from_rows, to: t.to_rows, cells }, reasons };
}

function edgesMatchContract(lanes: readonly TransitionLane[], bucketCount: number): boolean {
  if (bucketCount !== CONTRACT_LANE_EDGES.length + 1) return false;
  for (let i = 0; i < bucketCount; i += 1) {
    const lane = lanes[i];
    if (lane === undefined) return false;
    const lower = i === 0 ? null : CONTRACT_LANE_EDGES[i - 1] ?? null;
    const upper = i === bucketCount - 1 ? null : CONTRACT_LANE_EDGES[i] ?? null;
    const lw = lane.lower_wad === null ? null : wireBigInt(lane.lower_wad);
    const uw = lane.upper_wad === null ? null : wireBigInt(lane.upper_wad);
    if (lw !== lower || uw !== upper) return false;
  }
  return true;
}

function hf(label: string): string {
  return `health factor ${label}`;
}

function mergedBands(lanes: readonly TransitionLane[]): RoomBand[] {
  const e = CONTRACT_LANE_EDGES;
  const r = (i: number) => roomBoundLabel(e[i] ?? WAD);
  const l = (i: number) => lanes[i]?.label ?? "";
  return [
    { key: "over-cap", label: "over cap", title: `${hf("below 1.00")} (${l(0)}, ${l(1)})`, lanes: [0, 1], kind: "bucket", overCap: true },
    { key: "b1", label: `< ${r(2)}`, title: `${hf(l(2))} · room under ${r(2)}`, lanes: [2], kind: "bucket", overCap: false },
    { key: "b2", label: `${r(2)} – ${r(3)}`, title: `${hf(l(3))} · room ${r(2)} to ${r(3)}`, lanes: [3], kind: "bucket", overCap: false },
    { key: "b3", label: `${r(3)} – ${r(4)}`, title: `${hf(l(4))} · room ${r(3)} to ${r(4)}`, lanes: [4], kind: "bucket", overCap: false },
    { key: "b4", label: `≥ ${r(4)}`, title: `${hf("1.25 and above")} (${l(5)}, ${l(6)}, ${l(7)}) · room ${r(4)} and above`, lanes: [5, 6, 7], kind: "bucket", overCap: false },
    { key: "no-debt", label: "no debt", title: l(8), lanes: [8], kind: "infinite", overCap: false },
    { key: "unmeasured", label: "not measured", title: l(9), lanes: [9], kind: "unmeasured", overCap: false },
  ];
}

function verbatimBands(lanes: readonly TransitionLane[]): RoomBand[] {
  return lanes.map((lane) => {
    const upper = lane.upper_wad === null ? null : wireBigInt(lane.upper_wad);
    return {
      key: `lane-${String(lane.index)}`,
      label: lane.label,
      title: lane.kind === "bucket" ? hf(lane.label) : lane.label,
      lanes: [lane.index],
      kind: lane.kind,
      overCap: lane.kind === "bucket" && upper !== null && upper <= WAD,
    };
  });
}

/** The heatmap model for one engine. `merge` is true for the Cash engine only (its health factor is a room). */
export function laneReading(engine: RunBookEngine, options: { merge: boolean }): LaneReading {
  const { read, reasons } = guards(engine);
  if (read === null) return { kind: "contradictory", reasons };
  const merged = options.merge && edgesMatchContract(read.lanes, read.bucketCount);
  const bands = merged ? mergedBands(read.lanes) : verbatimBands(read.lanes);
  const bandOf = new Map<number, number>();
  bands.forEach((b, i) => b.lanes.forEach((lane) => bandOf.set(lane, i)));
  const kindOf = (lane: number) => read.lanes[lane]?.kind ?? "unmeasured";
  const overCapLane = (lane: number) => {
    const b = bandOf.get(lane);
    return b !== undefined && (bands[b]?.overCap ?? false);
  };
  const acc = new Map<string, { from: number; to: number; rows: number; before: bigint; after: bigint }>();
  let bandChanged = 0;
  let crossedCap = 0;
  let improved = 0;
  let nearCrossed = 0;
  const nearLanes = merged ? [2, 3] : [];
  for (const c of read.cells) {
    const bf = bandOf.get(c.from);
    const bt = bandOf.get(c.to);
    if (bf === undefined || bt === undefined) continue;
    const key = `${String(bf)}-${String(bt)}`;
    const cur = acc.get(key) ?? { from: bf, to: bt, rows: 0, before: 0n, after: 0n };
    acc.set(key, { ...cur, rows: cur.rows + c.rows, before: cur.before + c.before, after: cur.after + c.after });
    const measured = kindOf(c.from) !== "unmeasured" && kindOf(c.to) !== "unmeasured";
    if (!measured) continue;
    if (bf !== bt) bandChanged += c.rows;
    const fromBucket = kindOf(c.from) === "bucket";
    const toBucket = kindOf(c.to) === "bucket";
    if ((fromBucket && toBucket && c.to > c.from) || (fromBucket && kindOf(c.to) === "infinite")) improved += c.rows;
    if (fromBucket && !overCapLane(c.from) && toBucket && overCapLane(c.to)) {
      crossedCap += c.rows;
      if (nearLanes.includes(c.from)) nearCrossed += c.rows;
    }
  }
  const cells: HeatCell[] = [...acc.values()].map((c) => {
    const fromKind = bands[c.from]?.kind;
    const toKind = bands[c.to]?.kind;
    const movement: HeatMovement =
      fromKind === "unmeasured" || toKind === "unmeasured" ? "unmeasured" : c.to === c.from ? "held" : c.to < c.from ? "worse" : "better";
    return { from: c.from, to: c.to, rows: c.rows, debtBefore: c.before, debtAfter: c.after, movement };
  });
  const t = engine.hf_transitions;
  return {
    kind: "ok",
    view: {
      merged,
      bands,
      cells,
      maxRows: cells.reduce((m, c) => Math.max(m, c.rows), 0),
      totalRows: t.total_rows,
      measuredRows: t.measured_rows,
      unmeasuredRows: t.unmeasured_rows,
      heldRows: t.held_rows,
      laneChangedRows: t.lane_changed_rows,
      bandChanged,
      crossedCap,
      improved,
      nearToday: nearLanes.reduce((n, lane) => n + (read.from[lane] ?? 0), 0),
      nearCrossed,
      nearLabel: merged ? roomBoundLabel(CONTRACT_LANE_EDGES[3] ?? WAD) : null,
      decimals: engine.usd_decimals,
    },
  };
}
```

Note on the `improved` law: the movement of a cell is judged on BAND indexes for its colour (`c.to < c.from` is worse: bands are ordered by health, index 0 = over cap), and on LANE indexes for the `improved` count (the wire's own resolution). A lane change inside one band (lane 1 → lane 0) colours as `held` at band level and counts in `laneChangedRows` but not in `bandChanged` — both are true statements about different resolutions, and the card's finding names which it is quoting (Task 11).

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-transitions.spec.ts`
Expected: 7 passed. If the demo-table pin's `maxRows` differs, recount the merged cell `≥ 20% → ≥ 20%` (128 + 60 + 320 + 424 = 932) — the pin is the arithmetic, not the code.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-transitions.ts web/tests/unit/lab-transitions.spec.ts web/tests/unit/helpers/run-book-engine.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-transitions - the wire's ten lanes under guards, merged by exact summation into room bands for Cash, verbatim for the legacy market, contradictions named" -- web/lib/lab-transitions.ts web/tests/unit/lab-transitions.spec.ts web/tests/unit/helpers/run-book-engine.ts
```

---
