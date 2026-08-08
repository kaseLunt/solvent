// VIEW 2 (debt concentration / Pareto) — the pure view-model for "the top N
// borrowers hold X% of this walk", per engine, from ONE full walk.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 2 + completeness critic Finding 5):
//
//   - THE DENOMINATOR IS THIS WALK'S OWN Σ, and it is NAMED. Refused rows
//     and rows with no positive debt carry no number: they are outside the
//     numerator AND the denominator, counted in a visible aside — never $0
//     borrowers at the tail.
//   - THE ABSOLUTE Σ ALWAYS RIDES EVERY SHARE (F5). "Top 10 hold 97%" over a
//     dust book is the defect one view over — every sentence carries both
//     dollar figures, and a dust denominator raises the same named flag the
//     bad-debt rate uses.
//   - AN EMPTIED SET IS UNKNOWABLE (F5): a min_value floor can leave zero
//     qualifying rows, at which point the share has NO denominator and
//     renders as an unknowable, never as 100%.
//   - SHARES ARE EXACT TENTHS, truncated, bigint — never a float.
//   - A Pareto share is a ratio INSIDE one engine. Nothing here is ever
//     compared or summed across engines.
//
// The ranking is computed HERE from the walked rows (one vector, one batch),
// so debt and rank come from the same row of the same walk by construction.

import { parseDecimal } from "@solvent/client";
import type { PositionRow } from "./positionRow";

/** The same whole-dollar dust policy the bad-debt rate names. */
export const PARETO_DUST_FLOOR_USD = 1000n;

export interface ParetoTier {
  n: number;
  /** Truncated tenths of a percent of the walked Σ, exact bigint. */
  shareTenths: string;
  /** Exact Σ debt of the top n, decimal string at the engine's decimals. */
  topDebt: string;
}

export type ParetoView =
  | { kind: "empty"; excluded: number }
  | {
      kind: "view";
      tiers: ParetoTier[];
      /** Σ over every walked row with positive debt — the named denominator. */
      totalDebt: string;
      counted: number;
      /** Walked rows with NO positive debt figure — outside both sides. */
      excluded: number;
      dust: boolean;
      decimals: number;
    };

const TIER_SIZES = [1, 5, 10, 20] as const;

export function paretoView(rows: readonly PositionRow[], decimals: number): ParetoView {
  const debts: bigint[] = [];
  let excluded = 0;
  for (const row of rows) {
    const debt = row.totals.debt === null ? null : parseDecimal(row.totals.debt);
    if (debt === null || debt <= 0n) {
      excluded++;
      continue;
    }
    debts.push(debt);
  }
  if (debts.length === 0) return { kind: "empty", excluded };

  debts.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  let totalDebt = 0n;
  for (const debt of debts) totalDebt += debt;

  const tiers: ParetoTier[] = [];
  let running = 0n;
  let index = 0;
  for (const n of TIER_SIZES) {
    if (n > debts.length) break;
    while (index < n) {
      const debt = debts[index];
      if (debt !== undefined) running += debt;
      index++;
    }
    tiers.push({
      n,
      shareTenths: ((running * 1000n) / totalDebt).toString(),
      topDebt: running.toString(),
    });
  }
  // The whole walk as its own closing tier, when it is not already a tier —
  // the reader sees the denominator reached exactly.
  if (tiers.every((tier) => tier.n !== debts.length)) {
    tiers.push({ n: debts.length, shareTenths: "1000", topDebt: totalDebt.toString() });
  }

  return {
    kind: "view",
    tiers,
    totalDebt: totalDebt.toString(),
    counted: debts.length,
    excluded,
    dust: totalDebt < PARETO_DUST_FLOOR_USD * 10n ** BigInt(decimals),
    decimals,
  };
}

/** "97.3%" from truncated tenths. */
export function paretoShareLabel(shareTenths: string): string {
  const tenths = BigInt(shareTenths);
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}%`;
}

/** The emptied-set sentence — an unknowable, never 100% (F5). */
export function paretoEmptyLine(excluded: number): string {
  return (
    `No walked row carries a positive debt figure` +
    `${excluded > 0 ? ` (${String(excluded)} excluded rows are counted beside this sentence)` : ""}, ` +
    `so concentration has no denominator here — UNKNOWABLE, not 100%.`
  );
}

/** SLOT 6 for the Pareto block. */
export const PARETO_METHOD =
  "Shares are exact truncated tenths of THIS WALK'S own summed debt — the denominator is " +
  "printed beside every share, rows without a positive debt figure sit outside both sides of " +
  "the ratio and are counted in the aside, and a summed book under the named dust floor keeps " +
  "its numbers and loses its visual weight. One engine per panel; never compared across engines.";
