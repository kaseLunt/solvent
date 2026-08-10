"use client";

// The META CONSTANTS provider (Phase 1 Track A, p1a-3; re-cut by p1a-9): the
// runtime source of the tier constants `freshnessTier` (lib/freshnessTiers.ts)
// is a theorem about.
//
// ONE `client.meta()` fetch on mount, abort-guarded, NO retry loop — the
// constants are facts about a DEPLOYMENT, not about a moment: they cannot
// change under a running page, so a second ask could only repeat the first
// answer, and a retry loop over an unreachable meta would be polling for a
// number the fallback already states within one honest disclosure.
//
// FOUR SOURCES, EACH AN HONEST STATE (p1a-9 — the Codex finding: the old
// two-state reading claimed "fallback" BEFORE any failure had occurred, and
// swallowed wire constants no theorem could stand on):
//
//   · "pending"  — the one ask has not resolved. The constants are the
//                  built-in trio ONLY as a floor for callers that must hold
//                  something; a consumer styling severity from them would be
//                  painting a claim nothing has yet licensed, so the ribbon
//                  renders the age UNSTAINED while pending (no tier word, no
//                  tier color — the pre-ratification interim register).
//   · "meta"     — the wire answered AND its constants validate (below).
//   · "invalid"  — the wire answered and its constants DO NOT validate:
//                  non-finite / non-positive / non-safe-integer values, or a
//                  trio whose tier boundaries are out of order
//                  (2·poll ≤ ceiling ≤ sweepWorstCase must hold — the tiers
//                  are DEFINED as nested intervals, and a poll of 300 against
//                  a ceiling of 360 would render FRESH at 500s over prices
//                  the API itself refuses to serve). The constants served are
//                  the built-in fallback, and `invalidReason` names the cause
//                  so the chip's title can disclose it verbatim.
//   · "fallback" — the ask actually FAILED: transport failure, an HTTP error
//                  body, or the client's own `SchemaVersionMismatchError`
//                  (`client.meta()` runs `assertCompatible` internally — a
//                  recorded p1a-3 decision: that refusal is the client
//                  protecting the contract's numbers).
//
// "fallback" is claimed ONLY after an actual failure; before resolution the
// reading says "pending" — a page that has not asked yet has not been failed.
// The consumer learns WHICH set it got (`source`), because a chip styling
// itself from invented thresholds must say so (PostureRibbon renders the
// disclosure title).
//
// Pinned by tests/unit/freshness-tiers.spec.ts (the pure core: mapping,
// validation incl. the misordered-constants case, success arm, invalid arm,
// fallback arm, no-retry).

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { MetaResponse } from "@solvent/client";
import { getSolventClient } from "./api";
import { TIER_FALLBACK, type TierConstants } from "./freshnessTiers";

/** Which state a reading is in: pending, the wire's, invalid-wire, or failed. */
export type MetaConstantsSource = "pending" | "meta" | "invalid" | "fallback";

/** The provider's whole answer: the constants, where they came from, and — on
 * the invalid arm — what disqualified the wire's trio. */
export interface MetaConstantsReading {
  readonly constants: TierConstants;
  readonly source: MetaConstantsSource;
  /** Present exactly when `source` is "invalid": the named validation cause. */
  readonly invalidReason?: string;
}

/** The reading before the one ask resolves — no failure has occurred, and no
 * tier claim is licensed yet (the ribbon renders unstained over this). */
export const META_CONSTANTS_PENDING: MetaConstantsReading = {
  constants: TIER_FALLBACK,
  source: "pending",
};

/** The disclosed fallback pair — served ONLY after an actual failed ask (and
 * as the context default outside a provider, where no ask will ever run). */
export const META_CONSTANTS_FALLBACK: MetaConstantsReading = {
  constants: TIER_FALLBACK,
  source: "fallback",
};

/** The one method of the client this module reads. `SolventClient` satisfies it. */
export interface MetaSource {
  meta(signal?: AbortSignal): Promise<MetaResponse>;
}

/**
 * The generated wire fields, mapped by NAME — `constants.price_poll_seconds`,
 * `constants.price_ceiling_seconds`, `constants.dm_sweep_worst_case_seconds`
 * (packages/client-ts/src/generated/schema.ts, `Constants`). Takes the
 * narrowest slice of `MetaResponse` it reads.
 */
export function tierConstantsOf(meta: Pick<MetaResponse, "constants">): TierConstants {
  return {
    pricePollSeconds: meta.constants.price_poll_seconds,
    priceCeilingSeconds: meta.constants.price_ceiling_seconds,
    dmSweepWorstCaseSeconds: meta.constants.dm_sweep_worst_case_seconds,
  };
}

/** The wire names of the three fields, for violation messages that a reader
 * can grep straight back to the contract. */
const TIER_CONSTANT_WIRE_NAMES: readonly (readonly [keyof TierConstants, string])[] = [
  ["pricePollSeconds", "price_poll_seconds"],
  ["priceCeilingSeconds", "price_ceiling_seconds"],
  ["dmSweepWorstCaseSeconds", "dm_sweep_worst_case_seconds"],
];

/**
 * THE VALIDATION (p1a-9). Null = the trio can carry the tier theorems; a
 * string = the named cause it cannot.
 *
 * Two layers, in order:
 *   1. each constant is a finite positive safe integer — `Number.isSafeInteger`
 *      refuses NaN, ±Infinity, fractions and beyond-2^53 values in one test,
 *      and `> 0` refuses zero and negatives (a poll cadence of 0 would make
 *      EVERY age non-fresh; a negative one is not a duration at all);
 *   2. the boundaries nest: 2·poll ≤ ceiling ≤ sweepWorstCase. The tiers are
 *      defined as nested intervals (canon §06) — a trio that breaks the
 *      nesting would let a milder tier claim stand over an age a harsher
 *      boundary already condemned (the misordered pin: poll 300 / ceiling 360
 *      must never render FRESH at 500s).
 */
export function tierConstantsViolation(constants: TierConstants): string | null {
  for (const [key, wireName] of TIER_CONSTANT_WIRE_NAMES) {
    const value = constants[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      return `${wireName} is not a positive integer (got ${String(value)})`;
    }
  }
  if (2 * constants.pricePollSeconds > constants.priceCeilingSeconds) {
    return `tier boundaries out of order: 2×price_poll_seconds (${String(
      2 * constants.pricePollSeconds,
    )}) exceeds price_ceiling_seconds (${String(constants.priceCeilingSeconds)})`;
  }
  if (constants.priceCeilingSeconds > constants.dmSweepWorstCaseSeconds) {
    return `tier boundaries out of order: price_ceiling_seconds (${String(
      constants.priceCeilingSeconds,
    )}) exceeds dm_sweep_worst_case_seconds (${String(constants.dmSweepWorstCaseSeconds)})`;
  }
  return null;
}

/**
 * ONE ask, one answer — "meta" only for a validated trio, "invalid" (with the
 * cause named, on the fallback constants) for a wire trio the theorems cannot
 * stand on, "fallback" for an actual failure: transport, HTTP, abort, or
 * `assertCompatible`'s `SchemaVersionMismatchError`. This function never
 * throws and never retries. (An aborted ask also resolves fallback, but the
 * aborting caller has unmounted and discards the resolution — see
 * `MetaConstantsProvider`.)
 */
export async function loadMetaConstants(
  client: MetaSource,
  signal?: AbortSignal,
): Promise<MetaConstantsReading> {
  try {
    const meta = await client.meta(signal);
    const constants = tierConstantsOf(meta);
    const violation = tierConstantsViolation(constants);
    if (violation !== null) {
      return { constants: TIER_FALLBACK, source: "invalid", invalidReason: violation };
    }
    return { constants, source: "meta" };
  } catch {
    return META_CONSTANTS_FALLBACK;
  }
}

// Outside a provider no ask will EVER run — that is not a pending state (it
// would leave consumers unstained forever) and not a wire answer; it is meta
// being unavailable by construction, which is exactly what the disclosed
// fallback states.
const MetaConstantsContext = createContext<MetaConstantsReading>(META_CONSTANTS_FALLBACK);

/**
 * Mounts the one fetch and holds its answer for the tree. Renders children
 * immediately on the PENDING reading — never a premature "fallback" claim —
 * and lands the resolved reading when (and only when) the ask settles. The
 * abort guard keeps a slow response from writing state into an unmounted
 * tree — and since a fetch aborted by unmount resolves fallback anyway, no
 * path can smuggle a late "meta" claim past the guard.
 */
export function MetaConstantsProvider({ children }: { children: ReactNode }) {
  const [reading, setReading] = useState<MetaConstantsReading>(META_CONSTANTS_PENDING);
  useEffect(() => {
    const controller = new AbortController();
    void loadMetaConstants(getSolventClient(), controller.signal).then((next) => {
      if (!controller.signal.aborted) setReading(next);
    });
    return () => {
      controller.abort();
    };
  }, []);
  return <MetaConstantsContext.Provider value={reading}>{children}</MetaConstantsContext.Provider>;
}

/** The current constants and their provenance. Fallback outside a provider. */
export function useMetaConstants(): MetaConstantsReading {
  return useContext(MetaConstantsContext);
}
