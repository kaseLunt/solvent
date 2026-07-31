// The Book table's row VIEW MODEL (W1; C2 swapped the source).
//
// Mapped from the wire's lean `PositionSummary` (contract 1.2.0, AMENDMENT
// 1/E) as served REFINED by @solvent/client — exactly the swap this file was
// shaped for: every component renders `PositionRow`, and only `toPositionRow`
// changed when the wire type landed.
//
// Honesty laws carried here:
//   - the verdict comes from `positionVerdict` (each engine's OWN comparator:
//     Aave on the wad, DM's sealed verdict; refused → unknowable). The UI
//     never re-derives eligibility from a display ratio.
//   - `ratio` is DISPLAY-precision, for the warn band only (lib/severity).
//   - null totals stay null (em dash downstream, never 0).
//   - the DM hf num/den is a DISCLOSURE (maxBorrowLT/borrowings), labeled so.
//   - the wire's `liq_distance` is the boundary statement; the client-side
//     verdict remains authoritative for `breached` (both sides derive the
//     same law from the same batch fields, so this is a cross-check, not a
//     second opinion).

import {
  healthFactorRatio,
  parseDecimal,
  positionVerdict,
  type LiquidationVerdict,
  type RefinedPositionSummary,
} from "@solvent/client";
// Relative imports (not the @/ alias): this module is exercised by the unit
// specs under Playwright's transpiler as well as by Next.
import type { Mark } from "../../components/MarksStamp";
import { factorDistancePercent, hfDisplayFromRatio, hfDisplayFromWad } from "../../lib/book-format";

export interface RowHF {
  /** Exact-derived display string ("1.043"), or null when none is published. */
  display: string | null;
  /** Display-precision ratio for the WARN band only. Never used for crit. */
  ratio: number | null;
  /** No debt — the ratio is unbounded. */
  infinite: boolean;
  /** True when the number is the DM's num/den disclosure, not a comparator. */
  disclosureOnly: boolean;
}

export type RowLiqDistance =
  | { kind: "distance"; display: string; assetLabel: string | null }
  | { kind: "breached" }
  | { kind: "never"; reason: string | null }
  | { kind: "none"; reason: string | null };

export interface PositionRow {
  engine: string;
  account: string;
  status: "computed" | "refused";
  /** The named refusal code (e.g. G1, SWEEP_NEVER), with its prose detail. */
  refusalCode: string | null;
  refusalDetail: string | null;
  hf: RowHF;
  /** The engine's own sealed verdict — the ONLY source of crit. */
  verdict: LiquidationVerdict;
  totals: {
    /** NullableDecimal at `decimals`, engine-native unit. Null stays null. */
    collateral: string | null;
    debt: string | null;
    decimals: number;
  };
  liqDistance: RowLiqDistance;
  /** B/P(/S) blocks in the mockup's marks grammar. */
  marks: Mark[];
  flags: string[];
}

/**
 * DISPLAY-precision quotient of two exact integers — for the warn band and
 * chart geometry ONLY (the exact value never travels through a float; the
 * client's `toNumber` rightly refuses wads, so this is a deliberate,
 * display-labeled rounding).
 */
function displayRatio(num: bigint, den: bigint): number | null {
  const denominator = Number(den);
  if (denominator === 0) return null;
  return Number(num) / denominator;
}

function rowHF(position: RefinedPositionSummary): RowHF {
  const hf = position.health_factor;
  if (hf === null) return { display: null, ratio: null, infinite: false, disclosureOnly: false };
  if (hf.infinite) return { display: null, ratio: null, infinite: true, disclosureOnly: false };
  if (hf.wad !== null) {
    return {
      display: hfDisplayFromWad(hf.wad),
      ratio: displayRatio(parseDecimal(hf.wad), 10n ** 18n),
      infinite: false,
      disclosureOnly: false,
    };
  }
  const ratio = healthFactorRatio(hf);
  if (ratio === null) return { display: null, ratio: null, infinite: false, disclosureOnly: false };
  return {
    display: hfDisplayFromRatio(ratio.num, ratio.den),
    ratio: displayRatio(ratio.num, ratio.den),
    infinite: false,
    disclosureOnly: true,
  };
}

function rowLiqDistance(
  position: RefinedPositionSummary,
  verdict: LiquidationVerdict,
): RowLiqDistance {
  const ld = position.liq_distance;
  // The engine's own verdict stays authoritative for crit: a wire "distance"
  // under a liquidatable verdict folds to breached — the same fold the
  // server applies, kept here as the honest-UI cross-check.
  if (ld.kind === "breached" || verdict === "liquidatable") return { kind: "breached" };
  if (ld.kind === "never") return { kind: "never", reason: ld.reason };
  if (ld.kind === "none") return { kind: "none", reason: ld.reason };
  if (ld.scale_factor_num === null || ld.scale_factor_den === null) {
    return { kind: "none", reason: ld.reason };
  }
  const display = factorDistancePercent(
    parseDecimal(ld.scale_factor_num),
    parseDecimal(ld.scale_factor_den),
  );
  if (display === null) return { kind: "none", reason: null };
  return { kind: "distance", display, assetLabel: ld.factor_symbol ?? null };
}

function rowMarks(position: RefinedPositionSummary): Mark[] {
  const marks: Mark[] = [
    { letter: "B", block: position.balances_block },
    { letter: "P", block: position.params_block },
  ];
  // The sweep mark belongs to engines that HAVE a sweeper (the Debt Manager).
  // sweep_block 0 there is an ABSENT sweep (S ∅ — e.g. SWEEP_NEVER), rendered
  // visibly; on Aave there is no sweeper and no S mark at all.
  if (position.engine === "debt_manager") {
    marks.push({ letter: "S", block: position.sweep_block > 0 ? position.sweep_block : null });
  }
  return marks;
}

/** Map one refined wire `PositionSummary` to the table row. */
export function toPositionRow(position: RefinedPositionSummary): PositionRow {
  const verdict = positionVerdict(position);
  return {
    engine: position.engine,
    account: position.account,
    status: position.status,
    refusalCode: position.refusal?.code ?? null,
    refusalDetail: position.refusal?.detail ?? null,
    hf: rowHF(position),
    verdict,
    totals: {
      collateral: position.total_collateral,
      debt: position.total_debt,
      decimals: position.value_decimals,
    },
    liqDistance: rowLiqDistance(position, verdict),
    marks: rowMarks(position),
    flags: position.flags,
  };
}
