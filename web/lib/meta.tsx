"use client";

// The META CONSTANTS provider (Phase 1 Track A, p1a-3): the runtime source of
// the tier constants `freshnessTier` (lib/freshnessTiers.ts) is a theorem
// about.
//
// ONE `client.meta()` fetch on mount, abort-guarded, NO retry loop — the
// constants are facts about a DEPLOYMENT, not about a moment: they cannot
// change under a running page, so a second ask could only repeat the first
// answer, and a retry loop over an unreachable meta would be polling for a
// number the fallback already states within one honest disclosure.
//
// FAILURE IS THE FALLBACK, DISCLOSED — never a crash, never a blank. Any
// rejection lands `META_CONSTANTS_FALLBACK`: transport failure, an HTTP error
// body, AND the client's own `SchemaVersionMismatchError` — `client.meta()`
// runs `assertCompatible` internally and its `seizure_model` check is
// unconditional, so a live server CAN make `meta()` throw after a perfectly
// good fetch (recorded decision, p1a-3: that refusal is the client protecting
// the CONTRACT'S numbers; the tier thresholds fall back to the built-in trio
// rather than trusting constants from a server the client refuses to read).
// The consumer learns WHICH set it got (`source`), because a chip styling
// itself from invented thresholds must say so ("thresholds from built-in
// fallback — /v1/meta unreachable" — Task 4 renders that title).
//
// NOT MOUNTED YET: Task 4 (the appbar migration) mounts the provider in the
// layout. Until then `useMetaConstants` outside a provider answers the
// fallback — the same honest floor a failed fetch produces.
//
// Pinned by tests/unit/freshness-tiers.spec.ts (the pure core: mapping,
// success arm, fallback arm, no-retry).

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { MetaResponse } from "@solvent/client";
import { getSolventClient } from "./api";
import { TIER_FALLBACK, type TierConstants } from "./freshnessTiers";

/** Which set of constants a reading carries: the wire's, or the built-in. */
export type MetaConstantsSource = "meta" | "fallback";

/** The provider's whole answer: the constants, and where they came from. */
export interface MetaConstantsReading {
  readonly constants: TierConstants;
  readonly source: MetaConstantsSource;
}

/** The disclosed fallback pair — served before meta answers and after it fails. */
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

/**
 * ONE ask, one answer or the disclosed fallback. Every rejection — transport,
 * HTTP, abort, or `assertCompatible`'s `SchemaVersionMismatchError` — resolves
 * to `META_CONSTANTS_FALLBACK`; this function never throws and never retries.
 * (An aborted ask also resolves fallback, but the aborting caller has
 * unmounted and discards the resolution — see `MetaConstantsProvider`.)
 */
export async function loadMetaConstants(
  client: MetaSource,
  signal?: AbortSignal,
): Promise<MetaConstantsReading> {
  try {
    const meta = await client.meta(signal);
    return { constants: tierConstantsOf(meta), source: "meta" };
  } catch {
    return META_CONSTANTS_FALLBACK;
  }
}

const MetaConstantsContext = createContext<MetaConstantsReading>(META_CONSTANTS_FALLBACK);

/**
 * Mounts the one fetch and holds its answer for the tree. Renders children
 * immediately on the fallback reading; the wire's constants land when (and
 * only if) meta answers. The abort guard keeps a slow response from writing
 * state into an unmounted tree — and since a fetch aborted by unmount resolves
 * fallback anyway, no path can smuggle a late "meta" claim past the guard.
 */
export function MetaConstantsProvider({ children }: { children: ReactNode }) {
  const [reading, setReading] = useState<MetaConstantsReading>(META_CONSTANTS_FALLBACK);
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
