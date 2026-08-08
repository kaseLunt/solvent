// VIEWS 1 and 2 — the cumulative headroom curve's and the Pareto view's laws,
// pinned over hand-built PositionRow vectors (the risk-bins spec's own
// builder pattern) plus DERIVED NEGATIVES documented at their sites.
//
// The laws under test (views spec views 1/2 + critic Findings 5/6/7):
//   - the curve is the map's arithmetic ACCUMULATED, breached leading;
//   - the partition weld: bands + asides == walked rows, or the curve refuses;
//   - the four asides are named members of NO cell, and the sentence states
//     that the two curves share one admissible set;
//   - Pareto's denominator is the walk's own Σ with excluded rows counted
//     beside it; every share is exact truncated tenths with its absolute Σ;
//   - an emptied set is UNKNOWABLE, never 100%; a dust denominator raises
//     the named flag; the closing tier reaches the denominator exactly.

import { expect, test } from "@playwright/test";
import { buildRiskBins } from "../../app/book/riskBins";
import {
  CURVE_METHOD,
  curveAsidesLine,
  headroomCurve,
} from "../../app/book/headroomCurve";
import {
  PARETO_METHOD,
  paretoEmptyLine,
  paretoShareLabel,
  paretoView,
} from "../../app/book/paretoView";
import {
  headroomBand,
  headroomBelowWarn,
  headroomBreached,
  headroomPercent,
} from "../../lib/headroom";
import type { PositionRow, RowHeadroom } from "../../app/book/positionRow";

let seq = 0;

function hr(num: bigint, den: bigint): RowHeadroom {
  const band = headroomBand(num, den);
  if (band === null) return { kind: "unknown", reason: null };
  return {
    kind: "headroom",
    display: headroomPercent(num, den),
    band,
    breached: headroomBreached(num, den),
    belowWarn: headroomBelowWarn(num, den),
  };
}

function atPercent(pct: number): RowHeadroom {
  const num = 10000n;
  return hr(num, num - BigInt(Math.round(pct * 100)));
}

function makeRow(options: { debt?: string | null; headroom?: RowHeadroom } = {}): PositionRow {
  seq += 1;
  return {
    engine: "aave_v3_etherfi",
    account: `0x${String(seq).padStart(40, "0")}`,
    status: "computed",
    refusalCode: null,
    refusalDetail: null,
    hf: { display: null, ratio: null, infinite: false, disclosureOnly: false },
    verdict: "not-liquidatable",
    totals: {
      collateral: null,
      debt: options.debt === undefined ? "15000000000" : options.debt, // $150 @ 8dp
      decimals: 8,
    },
    liqDistance: { kind: "distance", display: "−7.5%", assetLabel: null },
    headroom: options.headroom ?? atPercent(7.5),
    marks: [],
    flags: [],
  };
}

test("VIEW 1: the curve accumulates the bands tightest-first and welds the partition", () => {
  const rows = [
    makeRow({ headroom: hr(3200000000n, 4200000000n) }), // breached (−31.3%)
    makeRow({ headroom: atPercent(1) }), // [0,2)
    makeRow({ headroom: atPercent(7.5) }), // [5,10)
    makeRow({ headroom: atPercent(7.5), debt: "5000000000" }), // [5,10), $50
    makeRow({ headroom: atPercent(30) }), // [25,∞)-side band
    makeRow({ debt: null, headroom: { kind: "no-debt" } }), // aside: no debt
  ];
  const bins = buildRiskBins(rows);
  const curve = headroomCurve(bins);
  if (curve.kind !== "view") throw new Error(`expected a view, got ${curve.kind}`);
  // r100: CUMULATIVE rows wear CUMULATIVE labels — an interval label on a
  // running total reads exclusive bands into inclusive numbers.
  const first = curve.cells[0];
  if (first === undefined) throw new Error("curve invariant");
  expect(first.label).toBe("breached");
  expect(first.cumulativeAccounts).toBe(1);
  const under2 = curve.cells[1];
  if (under2 === undefined) throw new Error("curve invariant");
  expect(under2.label).toBe("under 2%");
  // MEMBERSHIP: the breached row is INSIDE "under 2%" — that is what
  // cumulative means, and what the old interval label denied.
  expect(under2.cumulativeAccounts).toBe(2);
  // Cumulative accounts are monotone and end at the banded population.
  const last = curve.cells[curve.cells.length - 1];
  if (last === undefined) throw new Error("curve invariant");
  expect(last.label).toBe("all banded rows");
  expect(last.cumulativeAccounts).toBe(5);
  // Σ debt accumulates exactly: 150×4 + 50 = $650 at 8dp.
  expect(last.cumulativeDebt).toBe("65000000000");
  for (let i = 1; i < curve.cells.length; i++) {
    const prev = curve.cells[i - 1];
    const next = curve.cells[i];
    if (prev === undefined || next === undefined) continue;
    expect(next.cumulativeAccounts).toBeGreaterThanOrEqual(prev.cumulativeAccounts);
    expect(BigInt(next.cumulativeDebt) >= BigInt(prev.cumulativeDebt)).toBe(true);
  }
  // The asides ride, named — and the admissible-set sentence is present.
  expect(curve.asides.noDebt).toBe(1);
  expect(curveAsidesLine(curve)).toContain("outside BOTH curves");
  expect(curve.total).toBe(6);
});

test("VIEW 1: a census that does not close REFUSES the curve (derived negative)", () => {
  const bins = buildRiskBins([makeRow(), makeRow()]);
  // DERIVED NEGATIVE: the walked total inflated past what bands+asides name.
  const poisoned = { ...bins, total: bins.total + 3 };
  const curve = headroomCurve(poisoned);
  if (curve.kind !== "refused") throw new Error(`expected refused, got ${curve.kind}`);
  expect(curve.reason).toContain("PARTITION CONTRADICTION");
  expect(curve.reason).toContain("does not close");
  expect(CURVE_METHOD).toContain("bands plus asides always equal the rows walked");
});

test("VIEW 2: shares are exact tenths over the walk's own Σ, absolutes riding, closing tier exact", () => {
  const rows = [
    makeRow({ debt: "60000000000" }), // $600
    makeRow({ debt: "30000000000" }), // $300
    makeRow({ debt: "10000000000" }), // $100
    makeRow({ debt: null, headroom: { kind: "no-debt" } }), // excluded
  ];
  const view = paretoView(rows, 8);
  if (view.kind !== "view") throw new Error(`expected a view, got ${view.kind}`);
  expect(view.totalDebt).toBe("100000000000"); // $1,000 exactly
  expect(view.counted).toBe(3);
  expect(view.excluded).toBe(1);
  const top1 = view.tiers[0];
  if (top1 === undefined) throw new Error("tier invariant");
  // 600/1000 = 60.0% exactly, with the absolute Σ beside it.
  expect(top1.n).toBe(1);
  expect(top1.shareTenths).toBe("600");
  expect(paretoShareLabel(top1.shareTenths)).toBe("60.0%");
  expect(top1.topDebt).toBe("60000000000");
  // The closing tier reaches the denominator exactly at n == counted.
  const closing = view.tiers[view.tiers.length - 1];
  if (closing === undefined) throw new Error("tier invariant");
  expect(closing.n).toBe(3);
  expect(closing.shareTenths).toBe("1000");
  expect(closing.topDebt).toBe(view.totalDebt);
  // $1,000 at the floor: NOT dust (the boundary is exact, mirroring view 7).
  expect(view.dust).toBe(false);
});

test("VIEW 2: an emptied set is UNKNOWABLE — never 100% — and dust raises the named flag", () => {
  // Every row excluded: the ratio has no denominator.
  const empty = paretoView([makeRow({ debt: null }), makeRow({ debt: "0" })], 8);
  expect(empty.kind).toBe("empty");
  if (empty.kind !== "empty") throw new Error("unreachable");
  expect(empty.excluded).toBe(2);
  expect(paretoEmptyLine(empty.excluded)).toContain("UNKNOWABLE, not 100%");
  // A dust book: one micro-dollar under the $1,000 floor.
  const dust = paretoView([makeRow({ debt: "99999999999" })], 8);
  if (dust.kind !== "view") throw new Error("expected a view");
  expect(dust.dust).toBe(true);
  expect(PARETO_METHOD).toContain("denominator is printed beside every share");
  expect(PARETO_METHOD).toContain("never compared across engines");
});
