// Dust arithmetic for the Book's charts (solvent-design SUPPLEMENT §17).
//
// This wave (W-UX-D) consumes ONLY `sumProvablyDust`; the DUST_STEPS
// vocabulary and the threshold helper live here for the TABLE WAVE to wire
// later — one module, so the chart suffix and the future table filter can
// never disagree about what "dust" means.
//
// OWED (flagged in the wave report): the main table ruling's dust COPY
// constants belong here too, but their verbatim text was not part of this
// wave's brief. Nothing is fabricated in their place — the table wave lands
// them with its own ruling text.
//
// All arithmetic is parseDecimal-style bigint: no float ever holds a sum.

import { parseDecimal } from "@solvent/client";

/** The dust-filter steps (USD units at each engine's own decimals). */
export const DUST_STEPS = ["off", "1", "100", "1k"] as const;
export type DustStep = (typeof DUST_STEPS)[number];

/**
 * A step's integer threshold at `decimals` — exact bigint, `step × 10^decimals`.
 * "off" is null: the ABSENCE of a threshold, which is a different statement
 * from a threshold of zero.
 */
export function dustThresholdInteger(step: DustStep, decimals: number): bigint | null {
  if (step === "off") return null;
  const units = step === "1" ? 1n : step === "100" ? 100n : 1000n;
  return units * 10n ** BigInt(decimals);
}

/**
 * Σ < $10 proves every member of the summed set is dust: if the SUM of the
 * members is under ten dollars, no single member can reach ten dollars.
 * The comparison is strict (`<`) and exact: parsed sum < 10 × 10^decimals.
 *
 * NOTE the ruling's arithmetic is literal — a zero sum (zero members) is
 * provably dust by this test. Pinned in tests/unit/dust.spec.ts; the vacuous
 * case is flagged to design in the wave report rather than silently guarded.
 */
export function sumProvablyDust(sum: string, decimals: number): boolean {
  return parseDecimal(sum) < 10n * 10n ** BigInt(decimals);
}

/** The suffix a provably-dust Σ appends — the ONLY thing dust may do to a chart. */
export const ALL_DUST_SUFFIX = " · all dust";
