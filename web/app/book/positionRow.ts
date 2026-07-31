// The Book table's row VIEW MODEL (W1).
//
// Shaped as EXACTLY the `PositionSummary` field set AMENDMENT 1/E will make
// the /v1/positions wire type in C2 — engine, account, status, refusal code,
// hf, liquidation verdict, totals, liq-distance, marks blocks — mapped today
// from the full `Position` the C1 contract serves. When C2 lands, the swap is
// a change to `toPositionRow` ONLY: every component renders `PositionRow`,
// nothing downstream touches `Position`.
//
// Honesty laws carried here:
//   - the verdict comes from `positionVerdict` (each engine's OWN comparator:
//     Aave on the wad, DM's strict boolean; refused → unknowable). The UI
//     never re-derives eligibility from a display ratio.
//   - `ratio` is DISPLAY-precision, for the warn band only (lib/severity).
//   - null totals stay null (em dash downstream, never 0).
//   - the DM hf num/den is a DISCLOSURE (maxBorrowLT/borrowings), labeled so.

import {
  healthFactorRatio,
  parseDecimal,
  positionVerdict,
  type LiquidationVerdict,
  type Position,
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

function rowHF(position: Position): RowHF {
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

function rowLiqDistance(position: Position, verdict: LiquidationVerdict): RowLiqDistance {
  const lp = position.liquidation_price;
  if (lp === null) return { kind: "none", reason: position.refusal?.code ?? null };
  if (lp.already_breached || verdict === "liquidatable") return { kind: "breached" };
  if (lp.never_liquidatable) return { kind: "never", reason: lp.reason ?? null };
  if (!lp.in_factor || lp.scale_factor_num === null || lp.scale_factor_den === null) {
    return { kind: "none", reason: lp.reason ?? null };
  }
  const display = factorDistancePercent(
    parseDecimal(lp.scale_factor_num),
    parseDecimal(lp.scale_factor_den),
  );
  if (display === null) return { kind: "none", reason: null };
  const firstFactorAsset = lp.factor_assets[0];
  const leg =
    firstFactorAsset === undefined
      ? undefined
      : position.legs.find((candidate) => candidate.asset === firstFactorAsset);
  return { kind: "distance", display, assetLabel: leg?.symbol ?? null };
}

function rowMarks(position: Position): Mark[] {
  const asOf = position.as_of;
  const marks: Mark[] = [
    { letter: "B", block: asOf.balances_block },
    { letter: "P", block: asOf.params_block },
  ];
  // The sweep mark belongs to engines that HAVE a sweeper (the Debt Manager).
  // sweep_block 0 there is an ABSENT sweep (S ∅ — e.g. SWEEP_NEVER), rendered
  // visibly; on Aave there is no sweeper and no S mark at all.
  if (position.engine === "debt_manager") {
    marks.push({ letter: "S", block: asOf.sweep_block > 0 ? asOf.sweep_block : null });
  }
  return marks;
}

/** Map one wire `Position` to the summary row. C2 swaps ONLY this function. */
export function toPositionRow(position: Position): PositionRow {
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
      collateral: position.total_collateral_base ?? position.collateral_value_usd,
      debt: position.total_debt_base ?? position.borrowings,
      decimals: position.value_decimals,
    },
    liqDistance: rowLiqDistance(position, verdict),
    marks: rowMarks(position),
    flags: position.flags,
  };
}
