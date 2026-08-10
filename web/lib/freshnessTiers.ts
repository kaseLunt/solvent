// Freshness TIERS (Phase 1 Track A, p1a-3) — the ratified SLA of canon §06,
// as pure arithmetic over the pipeline's own constants.
//
// "Every threshold is a theorem about the pipeline's own constants" (canon
// line 937). Nothing here is a taste number:
//
//   FRESH    age ≤ 2 × price_poll_seconds — the two-sample rule: inside it the
//            poller has had two chances at every price, so a fresh age is a
//            claim the pipeline actually supports.
//   AGING    age ≤ price_ceiling_seconds — the API's own refusal boundary: an
//            input older than the ceiling is REFUSED rather than served stale,
//            so an age inside it is degraded but still servable truth.
//   STALE    age ≤ dm_sweep_worst_case_seconds — the slowest honest pipeline
//            (sweep interval + pass time): beyond the ceiling but within the
//            interval a fully-working deployment can legitimately need.
//   CRITICAL beyond — older than the slowest honest explanation. This is the
//            incident register (coral WITH fill), shared by exactly two things:
//            critical comparators and critical age.
//
// The constants are RUNTIME-DERIVED from `/v1/meta` (lib/meta.tsx): a redeploy
// that changes the poll cadence moves every boundary without a web release.
// `TIER_FALLBACK` mirrors the live deployment's values and is used ONLY when
// meta is unreachable — and the surface then DISCLOSES the fallback (the
// provider's `source: "fallback"`), because a threshold the page invented must
// never impersonate one the pipeline stated.
//
// UNKNOWN AGE IS NOT AN INPUT. An unknown age has no tier, not a small one:
// callers route the unknown register (lib/freshness.ts, Wave R6 — the blind
// resume, `snapshotChipUnknown`, `staleSinceReading`) BEFORE calling
// `freshnessTier`. There is deliberately no `null` arm here — accepting one
// would let "I cannot say" collapse into some tier's color, which is exactly
// what the unknown register exists to prevent.
//
// Pinned by tests/unit/freshness-tiers.spec.ts.

/** The four ratified tiers, in severity order. */
export type FreshnessTier = "fresh" | "aging" | "stale" | "critical";

/** The three pipeline constants the tier boundaries are theorems about. */
export interface TierConstants {
  /** `constants.price_poll_seconds` — the poller cadence (live: 60). */
  readonly pricePollSeconds: number;
  /** `constants.price_ceiling_seconds` — the API's refusal bound (live: 360). */
  readonly priceCeilingSeconds: number;
  /** `constants.dm_sweep_worst_case_seconds` — interval + pass (live: 5580). */
  readonly dmSweepWorstCaseSeconds: number;
}

/**
 * The built-in fallback: the live deployment's own constants, frozen at the
 * p1a-3 build (provenance per canon §06: poll 60 · ceiling 360 · sweep worst
 * case 5580 = 3600 + 1980). Used ONLY when `/v1/meta` is unreachable, and the
 * chip then carries a disclosed title naming the fallback — see lib/meta.tsx.
 */
export const TIER_FALLBACK: TierConstants = {
  pricePollSeconds: 60,
  priceCeilingSeconds: 360,
  dmSweepWorstCaseSeconds: 5580,
};

/**
 * The tier of a KNOWN age, in seconds, under the given constants.
 *
 * Bounds are inclusive on the calm side: an age exactly AT a boundary still
 * holds the milder claim (120s IS inside the two-sample rule), and the first
 * second past it escalates. `ageSeconds` is the ANCHORED age where the caller
 * has one (lib/freshness.ts `anchoredAgeSeconds`) — the same number the chip
 * prints, so severity and text can never disagree.
 */
export function freshnessTier(ageSeconds: number, c: TierConstants): FreshnessTier {
  if (ageSeconds <= 2 * c.pricePollSeconds) return "fresh";
  if (ageSeconds <= c.priceCeilingSeconds) return "aging";
  if (ageSeconds <= c.dmSweepWorstCaseSeconds) return "stale";
  return "critical";
}
