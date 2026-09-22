import { humanUsd } from "./human-usd";
import { groupInt } from "./prose";
import { isWireScale, WireIntegerError } from "./wireGuard";

/** Whole dollars. A DISPLAY rule (spec 2026-09-15 §3.3): counts and Σ always exist in full. */
export const MATERIAL_LINE_USD = 100n;
export const SMALL_LINE_USD = 1n;

export type MaterialityTier = "material" | "small" | "dust";

export interface Sized {
  readonly debt: bigint;
}

function lineInBaseUnits(lineUsd: bigint, decimals: number): bigint {
  // The line is compared in the engine's own unit: a scale the contract would not have produced is refused, never exponentiated.
  if (!isWireScale(decimals)) {
    throw new WireIntegerError(
      `decimals is not a wire scale (an integer in [0, 1000], never -0): got ${Object.is(decimals, -0) ? "-0" : String(decimals)} — refused before the materiality line is placed`,
    );
  }
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
  const line = `$${MATERIAL_LINE_USD.toString()}`;
  const sum = humanUsd(sums.belowLine, decimals);
  // The line is per position: each row sits under it, and their sum — which may exceed it — is stated together, never "below" it.
  if (n === 1) return `1 more position is technically liquidatable, under the ${line} line — ${sum} — and not headlined.`;
  return `${groupInt(n)} more positions are technically liquidatable, each under the ${line} line — ${sum} together — and not headlined.`;
}
