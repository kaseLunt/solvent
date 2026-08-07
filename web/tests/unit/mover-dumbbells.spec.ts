// VIEW 4 (mover dumbbells) — the pure view-model's laws, pinned against the
// committed eth_minus_30 fixture plus DERIVED NEGATIVES documented at their
// sites.
//
// The laws under test (views spec view 4 + completeness critic Finding 8):
//   - EVERY below-1.00 verdict is a bigint compare on the exact wad. The
//     one-wei case is the kill test: float64 cannot see one wei under 1e18;
//   - the pool liquidates STRICTLY below 1.00 — a wad of exactly the scale is
//     healthy, on both sides of the shock;
//   - the axis domain ALWAYS contains the boundary, so 1.00 is always on-axis;
//   - the census is buckets + no-debt + refused = rows the run FACED. That
//     total may exceed `accounts` (refused also carries unrebuildable rows —
//     the wire serves no split, so no claim is made about which). A census
//     the numbers contradict is SURFACED, never rendered as if it closed;
//   - an unplottable mover is NAMED, never dropped;
//   - the population sentence says what Aave's movers_total counts (movement,
//     not danger) and that the pool serves no crossed-1.00 count;
//   - the window counts are facts about the rows DRAWN and their sentences
//     say so — nothing aggregates the window as the book.

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine } from "../../lib/runbook";
import {
  DUMBBELL_METHOD,
  dumbbellCensusLine,
  dumbbellPosition,
  dumbbellUnplottableLine,
  dumbbellWindowLine,
  moverDumbbells,
  moverPopulationLine,
} from "../../app/lab/moverDumbbells";
import { RUN_BOOK_ETH } from "../fixtures/lab-book";

const WAD = "1000000000000000000";

function engineOf(response: { engines: readonly unknown[] }, name: string): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find(
    (engine) => engine.engine === name,
  );
  if (found === undefined) throw new Error(`fixture invariant: engine ${name} expected`);
  return found;
}

function aaveClone(): LabRunBookEngine {
  return structuredClone(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi"));
}

function chartOf(engine: LabRunBookEngine) {
  const model = moverDumbbells(engine);
  if (model.kind !== "chart") throw new Error(`expected a chart, got ${model.kind}`);
  return model;
}

function baseMover(engine: LabRunBookEngine): LabRunBookEngine["movers"][number] {
  const mover = engine.movers[0];
  if (mover === undefined) throw new Error("fixture invariant: at least one mover expected");
  return mover;
}

function rowAt(model: ReturnType<typeof chartOf>, index: number) {
  const row = model.rows[index];
  if (row === undefined) throw new Error(`model invariant: row ${String(index)} expected`);
  return row;
}

test("the committed fixture's one Aave mover: crossed, exact wads, served order", () => {
  const model = chartOf(aaveClone());
  expect(model.rows).toHaveLength(1);
  const row = rowAt(model, 0);
  // 1.08 → 0.756: healthy before (>= 1.00), liquidatable after (< 1.00).
  expect(row.beforeWad).toBe("1080000000000000000");
  expect(row.afterWad).toBe("756000000000000000");
  expect(row.beforeBelowOne).toBe(false);
  expect(row.afterBelowOne).toBe(true);
  expect(row.crossed).toBe(true);
  expect(model.crossedShown).toBe(1);
  expect(model.alreadyBelowShown).toBe(0);
  expect(model.unplottable).toHaveLength(0);
});

test("the fixture's census: refused rows COUNT toward the rows the run faced, beyond `accounts`", () => {
  const model = chartOf(aaveClone());
  // 1 bucketed + 0 no-debt + 1 refused = 2 rows faced, while accounts is 1 —
  // the refused row was never rebuilt and is in neither side's accounts. That
  // EXCESS is lawful and is NOT a contradiction; claiming `= accounts` here
  // would be the lie this model exists to avoid.
  expect(model.census).toEqual({ bucketed: 1, infinite: 0, refused: 1, total: 2 });
  expect(model.censusContradiction).toBeNull();
  expect(dumbbellCensusLine(model.census)).toBe(
    "A window onto the run's own census: 1 bucketed on both sides + 0 no-debt (unbounded " +
      "health factor, excluded from movers by construction) + 1 refused = 2 rows this run faced.",
  );
});

test("LAW-4 kill: one wei under the boundary is BELOW it — a float cannot see that wei", () => {
  const engine = aaveClone();
  const oneWeiUnder = "999999999999999999";
  engine.movers = [
    {
      ...baseMover(engine),
      hf_before_wad: WAD, // exactly 1.00 — healthy, the boundary is strict
      hf_after_wad: oneWeiUnder,
      hf_drop_wad: "1",
    },
  ];
  const model = chartOf(engine);
  expect(rowAt(model, 0).beforeBelowOne).toBe(false);
  expect(rowAt(model, 0).afterBelowOne).toBe(true);
  expect(rowAt(model, 0).crossed).toBe(true);
  // The float the pixel path uses genuinely cannot make this call — the
  // verdict above therefore cannot have come from it.
  expect(Number(WAD) === Number(oneWeiUnder)).toBe(true);
});

test("exactly 1.00 after the shock is HEALTHY: liquidation is strictly below", () => {
  const engine = aaveClone();
  engine.movers = [
    { ...baseMover(engine), hf_before_wad: "2000000000000000000", hf_after_wad: WAD, hf_drop_wad: WAD },
  ];
  const model = chartOf(engine);
  expect(rowAt(model, 0).afterBelowOne).toBe(false);
  expect(rowAt(model, 0).crossed).toBe(false);
  expect(model.crossedShown).toBe(0);
});

test("the domain always contains the boundary — an all-healthy window still marks 1.00", () => {
  const engine = aaveClone();
  engine.movers = [
    {
      ...baseMover(engine),
      hf_before_wad: "5000000000000000000",
      hf_after_wad: "2000000000000000000",
      hf_drop_wad: "3000000000000000000",
    },
  ];
  const model = chartOf(engine);
  expect(model.domainMinWad).toBe(WAD);
  expect(model.domainMaxWad).toBe("5000000000000000000");
  expect(model.ticks.some((tick) => tick.boundary)).toBe(true);
});

test("decade ticks over a live-shaped seven-decade book, boundary flagged only at 1.00", () => {
  const engine = aaveClone();
  engine.movers = [
    {
      ...baseMover(engine),
      account: "0x1111111111111111111111111111111111111111",
      // The live book's real extremes: HF ~1,086,289 and HF ~0.349.
      hf_before_wad: "1086289157187782396529911",
      hf_after_wad: "760402409972889933128501",
      hf_drop_wad: "325886747214892463401410",
    },
    {
      ...baseMover(engine),
      account: "0x2222222222222222222222222222222222222222",
      hf_before_wad: "498363945448938476",
      hf_after_wad: "348854738664038021",
      hf_drop_wad: "149509206784900455",
    },
  ];
  const model = chartOf(engine);
  expect(model.ticks.map((tick) => tick.label)).toEqual([
    "1.00",
    "10",
    "100",
    "1k",
    "10k",
    "100k",
    "1M",
  ]);
  expect(model.ticks.filter((tick) => tick.boundary).map((tick) => tick.label)).toEqual(["1.00"]);
  // Rows keep the SERVED order — the ranking is the server's, never re-sorted.
  expect(model.rows.map((row) => row.account)).toEqual([
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ]);
  // The already-below row is a window fact with a window-scoped sentence.
  expect(model.alreadyBelowShown).toBe(1);
  expect(model.crossedShown).toBe(0);
  expect(dumbbellWindowLine(model)).toBe(
    "1 of the 2 rows drawn was below 1.00 before the shock and fell further — a fact about " +
      "this window, never a book-wide count.",
  );
});

test("a census naming FEWER rows than the run's own accounts is a surfaced contradiction", () => {
  const engine = aaveClone();
  // DERIVED NEGATIVE: accounts inflated past the census total — on BOTH
  // sides equally, so the r88 side-mismatch arm does not fire first and the
  // under-count arm is the one exercised. The honest excess direction
  // (census > accounts) is lawful; THIS direction means rows are unaccounted
  // for and must never render as a census claim.
  engine.before.accounts = 5;
  engine.after.accounts = 5;
  const model = chartOf(engine);
  expect(model.censusContradiction).not.toBeNull();
  expect(model.censusContradiction).toContain("unaccounted");
  expect(model.censusContradiction).toContain("5 accounts");
});

test("the two sides disagreeing on their census is a surfaced contradiction, never smoothed", () => {
  const engine = aaveClone();
  // DERIVED NEGATIVE: the after side loses its refused row. One run faces one
  // set of rows; a side-dependent census is a wire contradiction.
  engine.after.hf_histogram.refused_count = 0;
  const model = chartOf(engine);
  expect(model.censusContradiction).not.toBeNull();
  expect(model.censusContradiction).toContain("one run faces one set of rows");
});

test("a mover with no served wad is NAMED unplottable, never silently dropped", () => {
  const engine = aaveClone();
  engine.movers = [
    baseMover(engine),
    {
      ...baseMover(engine),
      account: "0x3333333333333333333333333333333333333333",
      hf_before_wad: null,
      hf_after_wad: null,
      hf_drop_wad: null,
    },
  ];
  const model = chartOf(engine);
  expect(model.rows).toHaveLength(1);
  expect(model.unplottable).toEqual(["0x3333333333333333333333333333333333333333"]);
  // Every served mover is accounted for: drawn or named, no third fate.
  expect(model.rows.length + model.unplottable.length).toBe(engine.movers.length);
  expect(dumbbellUnplottableLine(1)).toBe(
    "1 mover row carries no served wad and cannot be drawn — listed in the table below, " +
      "never dropped.",
  );
});

test("Finding 8: the population sentence names movement-not-danger AND the unserved count", () => {
  expect(moverPopulationLine(12)).toBe(
    "A drop is movement, not danger: 12 counts every account whose health factor fell at all " +
      "— under a price shock, most of the borrowing book — and the pool serves no count of " +
      "accounts that crossed 1.00.",
  );
});

test("the crossed window sentence is window-scoped and disclaims a book count", () => {
  const model = chartOf(aaveClone());
  expect(dumbbellWindowLine(model)).toBe(
    "1 of the 1 row drawn crossed below 1.00 under this shock — a fact about this window, " +
      "never a book-wide crossing count (the pool serves none).",
  );
});

test("a window that never touches the boundary carries NO boundary sentence", () => {
  const engine = aaveClone();
  engine.movers = [
    {
      ...baseMover(engine),
      hf_before_wad: "5000000000000000000",
      hf_after_wad: "2000000000000000000",
      hf_drop_wad: "3000000000000000000",
    },
  ];
  expect(dumbbellWindowLine(chartOf(engine))).toBeNull();
});

test("the kind gates: the Debt Manager is not-wad, an unmoved book is none", () => {
  expect(moverDumbbells(engineOf(RUN_BOOK_ETH, "debt_manager")).kind).toBe("not-wad");
  const engine = aaveClone();
  engine.movers = [];
  expect(moverDumbbells(engine).kind).toBe("none");
});

test("dumbbellPosition is pixels-only plumbing: monotone over the domain and clamped", () => {
  const lo = "348854738664038021";
  const hi = "1086289157187782396529911";
  const pLow = dumbbellPosition(lo, lo, hi);
  const pBoundary = dumbbellPosition(WAD, lo, hi);
  const pHigh = dumbbellPosition(hi, lo, hi);
  expect(pLow).toBe(0);
  expect(pHigh).toBe(1);
  expect(pBoundary).toBeGreaterThan(pLow);
  expect(pBoundary).toBeLessThan(pHigh);
  // Out-of-domain input clamps rather than escaping the plot.
  expect(dumbbellPosition("1", lo, hi)).toBe(0);
  // The method line states the axis is log and the float is pixels-only.
  expect(DUMBBELL_METHOD).toContain("LOG");
  expect(DUMBBELL_METHOD).toContain("pixels only");
  expect(DUMBBELL_METHOD).toContain("strictly below 1.00");
});

// ---------------------------------------------------------------------------
// r88 fixes — the SCALE WELD and census-before-empty-exit.

test("r88: a served wad_scale that is not the WAD refuses the chart — the boundary is 1e18 by definition", () => {
  const engine = aaveClone();
  // DERIVED NEGATIVE: both sides declare a drifted scale. Obeying it would
  // relabel every account against a false 1.00; ignoring it would render a
  // chart over a response that contradicts the chart's own law. REFUSAL is
  // the only honest arm.
  engine.before.hf_histogram.wad_scale = "500000000000000000";
  engine.after.hf_histogram.wad_scale = "500000000000000000";
  const model = moverDumbbells(engine);
  expect(model.kind).toBe("refused");
  if (model.kind !== "refused") throw new Error("unreachable");
  expect(model.reason).toContain("SCALE CONTRADICTION");
  expect(model.reason).toContain("500000000000000000");
});

test("r88: the two sides declaring DIFFERENT wad_scales refuses the chart — no cross-scale dumbbell", () => {
  const engine = aaveClone();
  engine.after.hf_histogram.wad_scale = "500000000000000000";
  const model = moverDumbbells(engine);
  expect(model.kind).toBe("refused");
  if (model.kind !== "refused") throw new Error("unreachable");
  expect(model.reason).toContain("SCALE CONTRADICTION");
});

test("r88: an after side bucketing on a different comparator refuses the chart", () => {
  const engine = aaveClone();
  engine.after.hf_histogram.comparator = "hf_num/hf_den";
  const model = moverDumbbells(engine);
  expect(model.kind).toBe("refused");
  if (model.kind !== "refused") throw new Error("unreachable");
  expect(model.reason).toContain("hf_num/hf_den");
});

test("r88: a ZERO-MOVER run still surfaces its census contradiction — no validation-free exit", () => {
  const engine = aaveClone();
  engine.movers = [];
  engine.after.hf_histogram.refused_count = 7;
  const model = moverDumbbells(engine);
  expect(model.kind).toBe("none");
  if (model.kind !== "none") throw new Error("unreachable");
  expect(model.censusContradiction).not.toBeNull();
  expect(model.censusContradiction).toContain("one run faces one set of rows");
});

test("r88: a zero-mover run with an HONEST census carries no contradiction — the guard is not always-on", () => {
  const engine = aaveClone();
  engine.movers = [];
  const model = moverDumbbells(engine);
  expect(model.kind).toBe("none");
  if (model.kind !== "none") throw new Error("unreachable");
  expect(model.censusContradiction).toBeNull();
});

test("r88: the two sides disagreeing on the ACCOUNT COUNT is a contradiction — one run, one set of rows", () => {
  const engine = aaveClone();
  // DERIVED NEGATIVE: triples match, but the after side claims a different
  // account count. before.accounts == after.accounts holds by construction
  // (same run set); a response where it does not is a wire contradiction —
  // and it is exactly the after-side undercount the before-only check missed.
  engine.after.accounts = 2;
  const model = chartOf(engine);
  expect(model.censusContradiction).not.toBeNull();
  expect(model.censusContradiction).toContain("1 accounts before and 2 after");
});
