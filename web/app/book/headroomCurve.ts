// VIEW 1 (cumulative debt-at-headroom) — the pure view-model for the
// cumulative form of the risk map's bands: accounts and Σ debt AT OR INSIDE
// each headroom edge, per engine, from ONE full walk.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 1 + completeness critic Findings 6 and 7):
//
//   - THE CURVE IS THE MAP'S OWN ARITHMETIC, ACCUMULATED. Every cell is a
//     running sum over `bandTotals` — the same left-closed bigint bands the
//     shipped risk map bins — never a re-derivation.
//   - BREACHED LEADS. The first cell is the breached band alone; every later
//     cell contains everything tighter than its edge.
//   - THE FOUR ASIDES RIDE THE CURVE (F7): no-debt, unknown, refused,
//     unplottable are NAMED members of no cell, and the partition
//     Σ bands + asides == walked rows is WELDED — a census that does not
//     close is surfaced, never rendered as if it did.
//   - THE TWO CURVES HAVE DIFFERENT ADMISSIBLE SETS (F7), stated: a row with
//     a band but no positive debt is in NEITHER curve here (it is the
//     unplottable aside), so the account curve and the money curve share one
//     admissible set by construction — and the sentence says which rows sit
//     outside both.
//   - Σ DEBT IS EXACT BIGINT at the engine's own decimals, never summed
//     across engines, never floated.
//
// The min_value floor (F6) and walk completeness ride the COMPONENT's
// takeaway — they are properties of the walk, not of this arithmetic.

import type { RiskBinsResult } from "./riskBins";

export interface CurveCell {
  /** The band's own label — the edge the cell accumulates to. */
  label: string;
  cumulativeAccounts: number;
  /** Exact bigint Σ debt, as a decimal string at the engine's decimals. */
  cumulativeDebt: string;
}

export type HeadroomCurve =
  | { kind: "refused"; reason: string }
  | {
      kind: "view";
      cells: CurveCell[];
      asides: { noDebt: number; unknown: number; refused: number; unplottable: number };
      /** rows walked — the census every cell claims membership against. */
      total: number;
      decimals: number;
    };

export function headroomCurve(bins: RiskBinsResult): HeadroomCurve {
  // THE PARTITION WELD (F7): bands + asides must name every walked row.
  const banded = bins.bandTotals.reduce((sum, band) => sum + band.count, 0);
  const accounted = banded + bins.aside.total;
  if (accounted !== bins.total) {
    return {
      kind: "refused",
      reason:
        `PARTITION CONTRADICTION: the bands name ${String(banded)} rows and the asides ` +
        `${String(bins.aside.total)}, together ${String(accounted)} — but the walk carried ` +
        `${String(bins.total)} rows. A census that does not close makes no cumulative claim.`,
    };
  }
  const cells: CurveCell[] = [];
  let accounts = 0;
  let debt = 0n;
  for (const band of bins.bandTotals) {
    accounts += band.count;
    debt += band.debt;
    cells.push({
      label: band.label,
      cumulativeAccounts: accounts,
      cumulativeDebt: debt.toString(),
    });
  }
  return {
    kind: "view",
    cells,
    asides: {
      noDebt: bins.aside.noDebt,
      unknown: bins.aside.unknown,
      refused: bins.aside.refused,
      unplottable: bins.aside.unplottable,
    },
    total: bins.total,
    decimals: bins.decimals,
  };
}

/** The asides, in one visible sentence — members of NO cell, never zeros. */
export function curveAsidesLine(curve: Extract<HeadroomCurve, { kind: "view" }>): string {
  const { asides } = curve;
  return (
    `Outside every cell, named: ${String(asides.noDebt)} with no debt (no boundary to have ` +
    `headroom from), ${String(asides.unknown)} with no usable comparator (unknown, not zero), ` +
    `${String(asides.refused)} refused (withheld upstream), and ${String(asides.unplottable)} ` +
    `with a band but no positive debt — those sit outside BOTH curves, so the account and ` +
    `money columns share one admissible set.`
  );
}

/** SLOT 6 for the curve. */
export const CURVE_METHOD =
  "Each row accumulates the risk map's own left-closed bands, tightest first, starting from " +
  "the breached band alone — exact bigint sums in this engine's own unit, never another " +
  "engine's. The four asides are members of no row and are counted beside the curve, so " +
  "bands plus asides always equal the rows walked.";
