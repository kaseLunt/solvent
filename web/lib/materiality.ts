import { humanUsd } from "./human-usd";

/** Whole dollars. A DISPLAY rule (spec 2026-09-15 §3.3): counts and Σ always exist in full. */
export const MATERIAL_LINE_USD = 100n;
export const SMALL_LINE_USD = 1n;

export type MaterialityTier = "material" | "small" | "dust";

export interface Sized {
  readonly debt: bigint;
}

function lineInBaseUnits(lineUsd: bigint, decimals: number): bigint {
  return lineUsd * 10n ** BigInt(decimals);
}

export function materialityTier(debt: bigint, decimals: number): MaterialityTier {
  if (debt >= lineInBaseUnits(MATERIAL_LINE_USD, decimals)) return "material";
  if (debt >= lineInBaseUnits(SMALL_LINE_USD, decimals)) return "small";
  return "dust";
}

export interface MaterialityPartition<T extends Sized> {
  readonly material: T[];
  readonly small: T[];
  readonly dust: T[];
  readonly sums: { material: bigint; small: bigint; dust: bigint; belowLine: bigint };
  readonly counts: { material: number; small: number; dust: number; belowLine: number };
}

export function partitionByMateriality<T extends Sized>(
  rows: readonly T[],
  decimals: number,
): MaterialityPartition<T> {
  const material: T[] = [];
  const small: T[] = [];
  const dust: T[] = [];
  let sMaterial = 0n;
  let sSmall = 0n;
  let sDust = 0n;
  for (const row of rows) {
    const tier = materialityTier(row.debt, decimals);
    if (tier === "material") {
      material.push(row);
      sMaterial += row.debt;
    } else if (tier === "small") {
      small.push(row);
      sSmall += row.debt;
    } else {
      dust.push(row);
      sDust += row.debt;
    }
  }
  return {
    material,
    small,
    dust,
    sums: { material: sMaterial, small: sSmall, dust: sDust, belowLine: sSmall + sDust },
    counts: {
      material: material.length,
      small: small.length,
      dust: dust.length,
      belowLine: small.length + dust.length,
    },
  };
}

export function belowLineSentence(
  counts: { readonly belowLine: number },
  sums: { readonly belowLine: bigint },
  decimals: number,
): string | null {
  const n = counts.belowLine;
  if (n === 0) return null;
  const one = n === 1;
  return `${String(n)} more position${one ? "" : "s"} ${one ? "is" : "are"} technically liquidatable but total${one ? "s" : ""} ${humanUsd(sums.belowLine, decimals)} — below the $${MATERIAL_LINE_USD.toString()} line and not headlined.`;
}
