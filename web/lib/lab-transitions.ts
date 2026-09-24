// The transition heatmap's model. The wire serves `hf_transitions`: ten lanes
// (eight health-factor buckets, no-debt, not-measured), one outflow list per
// lane, and margins. This module reads it under the wire guards, refuses a
// matrix that contradicts itself by name, and — for the Cash engine, whose
// health factor is cap ÷ debt so room = 1 − 1/HF — merges adjacent lanes by
// exact summation into the room bands the page draws. Nothing is re-bucketed:
// a merged cell is the sum of the wire's cells, and its label is the true
// converted bound of the wire's own edge.
import type { components } from "@solvent/client";
import { isWireDecimal, isWireOccupancy, isWirePopulation, isWireScale, wireBigInt } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type TransitionLane = Schemas["RunBookTransitionLane"];
/**
 * The fields the heat reading takes, and only those: the scale, the matrix,
 * and the distribution beside it. Any engine that carries them — the wire's
 * or the sealed one the Lab holds — reads; the projection never crosses.
 */
export type LaneEngine = Pick<RunBookEngine, "usd_decimals" | "hf_transitions" | "before">;

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
  /** Null on the not-measured cell only: this run computed no debt for those rows, and a debt nobody computed is not a zero. */
  readonly debtBefore: bigint | null;
  readonly debtAfter: bigint | null;
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

type CellDebt = { readonly ok: true; readonly value: bigint | null } | { readonly ok: false; readonly reason: string };

/** A cell's debt on one side: a wire Decimal, or null on the not-measured cell alone, where the wire states a debt this run never computed. Null anywhere else is a contradiction: a no-debt row contributes an exact "0", because that zero is knowable. */
function cellDebt(value: string | null, unmeasuredCell: boolean): CellDebt {
  if (value === null) {
    return unmeasuredCell ? { ok: true, value: null } : { ok: false, reason: "is null, and only the not-measured cell carries a debt nobody computed" };
  }
  const read = wireBigInt(value);
  return read === null ? { ok: false, reason: `${JSON.stringify(value)} is outside the wire Decimal contract` } : { ok: true, value: read };
}

/** A sum that includes a debt nobody computed is itself uncomputed. */
function addDebt(a: bigint | null, b: bigint | null): bigint | null {
  return a === null || b === null ? null : a + b;
}

/** Two wire edges agree when both are null, or both read to the same integer. */
function sameEdge(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const x = wireBigInt(a);
  const y = wireBigInt(b);
  return x !== null && y !== null && x === y;
}

interface ReadCell {
  readonly from: number;
  readonly to: number;
  readonly rows: number;
  readonly before: bigint | null;
  readonly after: bigint | null;
}

interface Read {
  readonly lanes: readonly TransitionLane[];
  readonly bucketCount: number;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly cells: readonly ReadCell[];
}

function guards(engine: LaneEngine): { read: Read | null; reasons: string[] } {
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
  // Every edge below is read at 1e18; a matrix stated at another scale would
  // merge on the wrong bounds or mark the wrong lanes over cap.
  if (!isWireDecimal(t.wad_scale)) reasons.push(`wad_scale ${JSON.stringify(t.wad_scale)} is outside the wire Decimal contract`);
  else if (wireBigInt(t.wad_scale) !== WAD) reasons.push(`wad_scale states ${t.wad_scale} and this matrix is read at 1e18`);
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

  // The distribution beside the matrix IS its row margin, lane for lane: the
  // same edges on every bucket, and the same count in it.
  buckets.forEach((b, i) => {
    const lane = t.lanes[i];
    if (lane === undefined || lane.kind !== "bucket") return;
    if (b.count !== t.from_rows[i]) {
      reasons.push(`from_rows[${String(i)}] states ${String(t.from_rows[i])} and the distribution beside it counts ${String(b.count)} in ${b.label}`);
    }
    if (!sameEdge(lane.lower_wad, b.lower_wad)) reasons.push(`lanes[${String(i)}].lower_wad ${JSON.stringify(lane.lower_wad)} and the distribution beside it states ${JSON.stringify(b.lower_wad)}`);
    if (!sameEdge(lane.upper_wad, b.upper_wad)) reasons.push(`lanes[${String(i)}].upper_wad ${JSON.stringify(lane.upper_wad)} and the distribution beside it states ${JSON.stringify(b.upper_wad)}`);
  });
  const cells: ReadCell[] = [];
  const arrivals = t.to_rows.map(() => 0);
  t.outflows.forEach((o, i) => {
    if (o.from !== i) reasons.push(`outflows[${String(i)}].from is ${String(o.from)}`);
    let sum = 0;
    o.cells.forEach((c, j) => {
      const at = `outflows[${String(i)}].cells[${String(j)}]`;
      // An empty cell is absent on the wire, never a row of zeros; a zero here
      // passes every sum, so this floor is the only gate that refuses it.
      if (!isWireOccupancy(c.rows)) {
        reasons.push(`${at}.rows ${JSON.stringify(c.rows)} is not a wire occupancy`);
        return;
      }
      // The margins are summed before the debts are read, so a cell refused
      // for its debt is never also reported as missing from its outflow.
      sum += c.rows;
      if (!Number.isInteger(c.to) || c.to < 0 || c.to >= laneCount) {
        reasons.push(`${at} names lane to ${String(c.to)}, and there are ${String(laneCount)} lanes`);
        return;
      }
      arrivals[c.to] = (arrivals[c.to] ?? 0) + c.rows;
      const unmeasuredCell = t.lanes[i]?.kind === "unmeasured" && t.lanes[c.to]?.kind === "unmeasured";
      const before = cellDebt(c.debt_before_usd, unmeasuredCell);
      const after = cellDebt(c.debt_after_usd, unmeasuredCell);
      if (!before.ok) reasons.push(`${at}.debt_before_usd ${before.reason}`);
      if (!after.ok) reasons.push(`${at}.debt_after_usd ${after.reason}`);
      if (!before.ok || !after.ok) return;
      cells.push({ from: i, to: c.to, rows: c.rows, before: before.value, after: after.value });
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
  return `Health factor ${label}`;
}

/** A band label as the grid prints it: a standalone line, so a word label starts with a capital; a number range is untouched. */
function sentenceLabel(label: string): string {
  return /^[a-z]/.test(label) ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;
}

function mergedBands(lanes: readonly TransitionLane[]): RoomBand[] {
  const e = CONTRACT_LANE_EDGES;
  const r = (i: number) => roomBoundLabel(e[i] ?? WAD);
  const l = (i: number) => lanes[i]?.label ?? "";
  return [
    { key: "over-cap", label: "Over cap", title: `${hf("below 1.00")} (${l(0)}, ${l(1)})`, lanes: [0, 1], kind: "bucket", overCap: true },
    { key: "b1", label: `< ${r(2)}`, title: `${hf(l(2))} · room under ${r(2)}`, lanes: [2], kind: "bucket", overCap: false },
    { key: "b2", label: `${r(2)} – ${r(3)}`, title: `${hf(l(3))} · room ${r(2)} to ${r(3)}`, lanes: [3], kind: "bucket", overCap: false },
    { key: "b3", label: `${r(3)} – ${r(4)}`, title: `${hf(l(4))} · room ${r(3)} to ${r(4)}`, lanes: [4], kind: "bucket", overCap: false },
    { key: "b4", label: `≥ ${r(4)}`, title: `${hf("1.25 and above")} (${l(5)}, ${l(6)}, ${l(7)}) · room ${r(4)} and above`, lanes: [5, 6, 7], kind: "bucket", overCap: false },
    { key: "no-debt", label: "No debt", title: l(8), lanes: [8], kind: "infinite", overCap: false },
    { key: "unmeasured", label: "Not measured", title: l(9), lanes: [9], kind: "unmeasured", overCap: false },
  ];
}

function verbatimBands(lanes: readonly TransitionLane[]): RoomBand[] {
  return lanes.map((lane) => {
    const upper = lane.upper_wad === null ? null : wireBigInt(lane.upper_wad);
    return {
      key: `lane-${String(lane.index)}`,
      label: sentenceLabel(lane.label),
      title: lane.kind === "bucket" ? hf(lane.label) : lane.label,
      lanes: [lane.index],
      kind: lane.kind,
      overCap: lane.kind === "bucket" && upper !== null && upper <= WAD,
    };
  });
}

/** The heatmap model for one engine. `merge` is true for the Cash engine only (its health factor is a room). */
export function laneReading(engine: LaneEngine, options: { merge: boolean }): LaneReading {
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
  const acc = new Map<string, ReadCell>();
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
    acc.set(key, { ...cur, rows: cur.rows + c.rows, before: addDebt(cur.before, c.before), after: addDebt(cur.after, c.after) });
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
