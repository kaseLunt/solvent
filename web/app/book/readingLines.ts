// Histogram reading lines + the Liquidatable card's Σ sub (solvent-design
// SUPPLEMENT §17) — COMPUTED from the same /v1/book response the panels
// render, never asserted, never hardcoded.
//
//   - Aave (hf_wad): {n} = Σ bucket counts wholly at-or-below the wad scale
//     (upper_wad ≤ 1e18); the engine may liquidate strictly below 1.00.
//   - Debt Manager (hf_num/hf_den): the buckets are a DISCLOSURE; {m} is the
//     engine's own verdict count (aggregate.liquidatable_positions).
//   - {$X} = bad_debt.eligible_debt_usd at usd_decimals, exact string
//     surgery; "· all dust" renders ONLY when sumProvablyDust proves it.
//   - a withheld Σ is an em dash — never the adjective without the Σ, and
//     never a zero over a book nobody was allowed to compute.

import {
  formatUnits,
  parseDecimal,
  type Aggregate,
  type BadDebt,
  type EngineHistogram,
} from "@solvent/client";
import { groupDecimalString } from "../../lib/book-format";
import { EM_DASH } from "../../lib/format";
import { ALL_DUST_SUFFIX, sumProvablyDust } from "./dust";

function usd(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/**
 * "Σ eligible debt $4,200[· all dust]" — em dash when the Σ is withheld.
 *
 * Zero-member gate (W-UX-C micro-ruling 1): "· all dust" renders ONLY when
 * the annotated member count (`eligible_positions`) is > 0 — the adjective
 * needs members to describe. The Σ itself still renders: $0 over a computed
 * class is honest. The guard lives HERE at the call-site helper both reading
 * lines share, never inside `sumProvablyDust`.
 */
export function eligibleDebtFragment(badDebt: BadDebt | undefined): string {
  if (badDebt === undefined || badDebt.eligible_debt_usd === null) {
    return `Σ eligible debt ${EM_DASH}`;
  }
  // A NULL member count is an unknowable membership — not > 0, so no suffix.
  const dust =
    badDebt.eligible_positions !== null &&
    badDebt.eligible_positions > 0 &&
    sumProvablyDust(badDebt.eligible_debt_usd, badDebt.usd_decimals)
      ? ALL_DUST_SUFFIX
      : "";
  return `Σ eligible debt ${usd(badDebt.eligible_debt_usd, badDebt.usd_decimals)}${dust}`;
}

/** Σ of bucket counts whose whole range sits at-or-below the wad scale. */
export function belowOneCount(histogram: EngineHistogram, wadScale: bigint): number {
  return histogram.buckets.reduce(
    (sum, bucket) =>
      bucket.upper_wad !== null && parseDecimal(bucket.upper_wad) <= wadScale
        ? sum + bucket.count
        : sum,
    0,
  );
}

/** The per-panel reading line, branched on the engine's own comparator. */
export function histogramReadingLine(
  histogram: EngineHistogram,
  aggregate: Aggregate | undefined,
  badDebt: BadDebt | undefined,
  wadScale: bigint,
): string {
  const computed = aggregate === undefined ? EM_DASH : String(aggregate.computed_positions);
  if (histogram.comparator === "hf_wad") {
    const n = belowOneCount(histogram, wadScale);
    return (
      `What this shows: how many accounts sit at each health factor. ${String(n)} of ` +
      `${computed} are below 1.00, where the engine may liquidate — ` +
      `${eligibleDebtFragment(badDebt)}.`
    );
  }
  const m = aggregate === undefined ? EM_DASH : String(aggregate.liquidatable_positions);
  return (
    "What this shows: how many accounts sit at each borrow-headroom ratio — a disclosure, " +
    `not the engine's trigger. The engine's own verdict counts ${m} of ${computed} ` +
    `liquidatable — ${eligibleDebtFragment(badDebt)}.`
  );
}

/** The Liquidatable stat card's sub: never the adjective without the Σ. */
export function liquidatableCardSub(badDebt: BadDebt | undefined): string {
  return `of computed positions, engine's own comparator · ${eligibleDebtFragment(badDebt)}`;
}
