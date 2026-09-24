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
  expect(v.bands.map((b) => b.label)).toEqual(["Over cap", "< 4.76%", "4.76% – 9.09%", "9.09% – 20%", "≥ 20%", "No debt", "Not measured"]);
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
  expect(v.bands.map((b) => b.label)).toEqual(["< 0.90", "0.90 – 1.00", "1.00 – 1.05", "1.05 – 1.10", "1.10 – 1.25", "1.25 – 1.50", "1.50 – 2.00", ">= 2.00", "No debt (unbounded)", "Not measured"]);
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

test("the distribution beside the matrix is its row margin lane for lane: an edge or a count that differs is named, never drawn", () => {
  const engine = cashEngine({ 2: { 2: 1 } });
  const h = engine.before.hf_histogram;
  const withBuckets = (buckets: typeof h.buckets) => laneReading({ ...engine, before: { ...engine.before, hf_histogram: { ...h, buckets } } }, { merge: true });
  const edgeOnly = h.buckets.map((b, i) => (i === 2 ? { ...b, upper_wad: "1060000000000000000" } : i === 3 ? { ...b, lower_wad: "1060000000000000000" } : b));
  const edgeReasons = contradictory(withBuckets(edgeOnly));
  expect(edgeReasons).toContain('lanes[2].upper_wad "1050000000000000000" and the distribution beside it states "1060000000000000000"');
  expect(edgeReasons).toContain('lanes[3].lower_wad "1050000000000000000" and the distribution beside it states "1060000000000000000"');
  const countOnly = h.buckets.map((b, i) => (i === 2 ? { ...b, count: b.count + 1 } : b));
  expect(contradictory(withBuckets(countOnly))).toEqual(["from_rows[2] states 1 and the distribution beside it counts 2 in 1.00 – 1.05"]);
});

test("every wire contradiction is named, and a contradicted matrix is never a view", () => {
  const base = cashEngine({ 2: { 0: 3, 2: 2 }, 9: { 9: 1 } });
  const t = base.hf_transitions;
  const withT = (patch: Partial<typeof t>) => laneReading({ ...base, hf_transitions: { ...t, ...patch } }, { merge: true });
  expect(contradictory(withT({ lanes: t.lanes.slice(0, 9) })).join(" ")).toContain("states 9 lanes");
  expect(contradictory(withT({ from_rows: t.from_rows.slice(0, 9) })).join(" ")).toContain("same length");
  expect(contradictory(withT({ comparator: "hf_wad" })).join(" ")).toContain("comparator");
  expect(contradictory(withT({ wad_scale: "0x10" })).join(" ")).toContain("wad_scale");
  expect(contradictory(withT({ wad_scale: "1000000" })).join(" ")).toContain("wad_scale states 1000000 and this matrix is read at 1e18");
  expect(contradictory(withT({ total_rows: 7 })).join(" ")).toContain("total_rows");
  expect(contradictory(withT({ to_rows: t.to_rows.map((n, i) => (i === 0 ? n + 1 : n)) })).join(" ")).toContain("to_rows");
  expect(contradictory(withT({ held_rows: 1, lane_changed_rows: 1 })).join(" ")).toContain("held_rows");
  expect(contradictory(withT({ measured_rows: 4 })).join(" ")).toContain("measured_rows");
  // A cell refused for its debt is still counted in its outflow's sum, so the refusal is the only reason.
  const badCell = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: o.cells.map((c) => (c.to === 0 ? { ...c, debt_before_usd: "1e6" } : c)) } : o));
  expect(contradictory(withT({ outflows: badCell }))).toEqual(['outflows[2].cells[0].debt_before_usd "1e6" is outside the wire Decimal contract']);
  const outOfRange = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: [{ ...o.cells[0]!, to: 12 }, ...o.cells.slice(1)] } : o));
  expect(contradictory(withT({ outflows: outOfRange })).join(" ")).toContain("to 12");
  // A zero-row cell passes every sum; the occupancy floor is the one gate that refuses it.
  const zeroRows = t.outflows.map((o) => (o.from === 2 ? { ...o, cells: [...o.cells, { to: 5, rows: 0, debt_before_usd: "0", debt_after_usd: "0" }] } : o));
  expect(contradictory(withT({ outflows: zeroRows }))).toEqual(["outflows[2].cells[2].rows 0 is not a wire occupancy"]);
  expect(contradictory(laneReading({ ...base, usd_decimals: -1 }, { merge: true })).join(" ")).toContain("usd_decimals");
  const fractional = transitionsOf({ 2: { 2: 1.5 } });
  expect(contradictory(laneReading({ ...base, hf_transitions: fractional }, { merge: true })).join(" ")).toContain("from_rows[2] 1.5");
});

test("null held/lane-changed tallies are carried as null, not zero, and the view still draws", () => {
  const v = ok(laneReading(cashEngine({ 2: { 2: 3 } }, { hf_transitions: transitionsOf({ 2: { 2: 3 } }, { held: null, laneChanged: null }) }), { merge: true }));
  expect(v.heldRows).toBeNull();
  expect(v.laneChangedRows).toBeNull();
  expect(v.bandChanged).toBe(0);
});
