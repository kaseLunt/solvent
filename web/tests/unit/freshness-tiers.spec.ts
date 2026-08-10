// Phase 1 Track A, Task 3 (p1a-3) — freshness tiers are THEOREMS about the
// pipeline's own constants (canon §06, build-contract §5, RATIFIED).
//
//   FRESH    age ≤ 2 × price_poll_seconds       (the two-sample rule)
//   AGING    age ≤ price_ceiling_seconds        (past it the API refuses prices)
//   STALE    age ≤ dm_sweep_worst_case_seconds  (the slowest honest pipeline)
//   CRITICAL beyond
//
// The constants are RUNTIME-DERIVED from /v1/meta — a redeploy that changes
// the poll cadence moves every boundary without a web release. TIER_FALLBACK
// {60, 360, 5580} exists ONLY for a page that could not reach meta, and the
// provider must SAY which set it served (`source: "meta" | "fallback"`) so the
// chip can disclose a fallback instead of impersonating a measurement.
//
// UNKNOWN AGE IS NOT AN INPUT. Callers route the unknown register
// (lib/freshness.ts, Wave R6) BEFORE calling freshnessTier — an unknown age
// has no tier, not a small one.

import { expect, test } from "@playwright/test";
import { SchemaVersionMismatchError, type MetaResponse } from "@solvent/client";
import { anchoredAgeSeconds, type AgeAnchor } from "../../lib/freshness";
import { freshnessTier, TIER_FALLBACK, type TierConstants } from "../../lib/freshnessTiers";
import {
  loadMetaConstants,
  META_CONSTANTS_FALLBACK,
  tierConstantsOf,
  type MetaSource,
} from "../../lib/meta";

// ---------------------------------------------------------------------------
// The pure tier function, driven on the FALLBACK constants — the deployment's
// own live values (poll 60 · ceiling 360 · sweep worst case 5580), so every
// boundary below is also a statement about the running pipeline.
// ---------------------------------------------------------------------------

test("TIER_FALLBACK is the ratified constant trio — 60 · 360 · 5580", () => {
  expect(TIER_FALLBACK).toEqual({
    pricePollSeconds: 60,
    priceCeilingSeconds: 360,
    dmSweepWorstCaseSeconds: 5580,
  });
});

test("the FRESH/AGING boundary sits exactly at 2 × poll: 120 is fresh, 121 is aging", () => {
  expect(freshnessTier(0, TIER_FALLBACK)).toBe("fresh");
  expect(freshnessTier(48, TIER_FALLBACK)).toBe("fresh");
  expect(freshnessTier(120, TIER_FALLBACK)).toBe("fresh");
  expect(freshnessTier(121, TIER_FALLBACK)).toBe("aging");
});

test("the AGING/STALE boundary is the price ceiling: 360 is aging, 361 is stale", () => {
  expect(freshnessTier(252, TIER_FALLBACK)).toBe("aging");
  expect(freshnessTier(360, TIER_FALLBACK)).toBe("aging");
  expect(freshnessTier(361, TIER_FALLBACK)).toBe("stale");
});

test("the STALE/CRITICAL boundary is the DM sweep worst case: 5580 is stale, 5581 is critical", () => {
  expect(freshnessTier(1320, TIER_FALLBACK)).toBe("stale");
  expect(freshnessTier(5580, TIER_FALLBACK)).toBe("stale");
  expect(freshnessTier(5581, TIER_FALLBACK)).toBe("critical");
  expect(freshnessTier(64_800, TIER_FALLBACK)).toBe("critical");
});

test("runtime constants OVERRIDE the fallback — every boundary moves with the deployment's numbers", () => {
  // A hypothetical redeploy: faster poll, tighter ceiling, quicker sweep.
  const runtime: TierConstants = {
    pricePollSeconds: 30,
    priceCeilingSeconds: 300,
    dmSweepWorstCaseSeconds: 4000,
  };
  expect(freshnessTier(60, runtime)).toBe("fresh");
  expect(freshnessTier(61, runtime)).toBe("aging");
  expect(freshnessTier(300, runtime)).toBe("aging");
  expect(freshnessTier(301, runtime)).toBe("stale");
  expect(freshnessTier(4000, runtime)).toBe("stale");
  expect(freshnessTier(4001, runtime)).toBe("critical");
  // The same ages under the fallback read differently — the constants, not the
  // function, carry the meaning.
  expect(freshnessTier(61, TIER_FALLBACK)).toBe("fresh");
  expect(freshnessTier(301, TIER_FALLBACK)).toBe("aging");
  expect(freshnessTier(4001, TIER_FALLBACK)).toBe("stale");
});

test("the tier is downstream of the ANCHORED age — severity moves while the page is open", () => {
  // The retired >1h ribbon gate's law, re-homed (ledger p1a-3): severity is a
  // function of the same anchored number the chip prints, so it ENGAGES as the
  // clocks advance instead of freezing at the wire value. Both clock readings
  // are handed in explicitly — the pure form freshness-resume.spec.ts pins.
  const anchor: AgeAnchor = {
    wireAgeSeconds: 100,
    receivedAtMs: 1_000,
    receivedAtWallMs: 1_785_000_000_000,
  };
  const at = (elapsedMs: number) =>
    freshnessTier(
      anchoredAgeSeconds(anchor, 1_000 + elapsedMs, 1_785_000_000_000 + elapsedMs),
      TIER_FALLBACK,
    );
  expect(at(0)).toBe("fresh"); // 100s — inside 2 × poll
  expect(at(21_000)).toBe("aging"); // 121s — one second past the two-sample rule
  expect(at(261_000)).toBe("stale"); // 361s — past the price ceiling
  expect(at(5_481_000)).toBe("critical"); // 5581s — past the sweep worst case
});

// ---------------------------------------------------------------------------
// The meta constants provider's pure core (lib/meta.tsx). The React shell is
// mounted by Task 4; what is pinned here is the whole decision it wraps.
// ---------------------------------------------------------------------------

/** The live deployment's Constants, field-for-field (generated schema). */
const WIRE_CONSTANTS: MetaResponse["constants"] = {
  confirmation_blocks: 3,
  price_poll_seconds: 60,
  dm_sweep_interval_seconds: 3600,
  dm_sweep_pass_seconds: 1980,
  dm_sweep_worst_case_seconds: 5580,
  price_budget_seconds: 180,
  price_ceiling_seconds: 360,
  large_price_step_bps: 500,
  rate_limit_requests_per_second: 10,
  rate_limit_burst: 40,
  max_set_run_scenarios: 12,
  set_run_token_cost_per_scenario: 3,
  max_inflight_set_runs: 2,
  sse_heartbeat_seconds: 15,
  note: "constants are facts about this deployment",
};

/** A MetaSource that answers with the given constants and counts its calls. */
function metaAnswering(constants: MetaResponse["constants"]): MetaSource & { calls: number } {
  const source = {
    calls: 0,
    meta(): Promise<MetaResponse> {
      source.calls += 1;
      return Promise.resolve({ constants } as MetaResponse);
    },
  };
  return source;
}

/** A MetaSource that rejects with the given error and counts its calls. */
function metaRefusing(error: Error): MetaSource & { calls: number } {
  const source = {
    calls: 0,
    meta(): Promise<MetaResponse> {
      source.calls += 1;
      return Promise.reject(error);
    },
  };
  return source;
}

test("tierConstantsOf reads the wire's own field names — no transposition survives", () => {
  expect(tierConstantsOf({ constants: WIRE_CONSTANTS })).toEqual(TIER_FALLBACK);
  // Three DISTINCT primes, so a swapped field could not produce this mapping.
  expect(
    tierConstantsOf({
      constants: { ...WIRE_CONSTANTS, price_poll_seconds: 7, price_ceiling_seconds: 11, dm_sweep_worst_case_seconds: 13 },
    }),
  ).toEqual({ pricePollSeconds: 7, priceCeilingSeconds: 11, dmSweepWorstCaseSeconds: 13 });
});

test("a reachable meta serves the WIRE's constants, and says so: source 'meta'", async () => {
  const source = metaAnswering({ ...WIRE_CONSTANTS, price_poll_seconds: 30 });
  const reading = await loadMetaConstants(source);
  expect(reading.source).toBe("meta");
  expect(reading.constants).toEqual({
    pricePollSeconds: 30,
    priceCeilingSeconds: 360,
    dmSweepWorstCaseSeconds: 5580,
  });
  expect(source.calls).toBe(1);
});

test("THE FALLBACK-SOURCE PIN: an unreachable meta yields TIER_FALLBACK and NEVER claims source 'meta'", async () => {
  const source = metaRefusing(new Error("fetch failed"));
  const reading = await loadMetaConstants(source);
  expect(reading.source).toBe("fallback");
  expect(reading.constants).toEqual(TIER_FALLBACK);
  // NO RETRY: meta is static per deploy — one ask, one answer or the fallback.
  expect(source.calls).toBe(1);
});

test("a SchemaVersionMismatchError from meta()'s own compatibility check lands the SAME fallback arm", async () => {
  // client.meta() calls assertCompatible internally; the seizure_model check
  // is unconditional, so a live server CAN make meta() throw rather than
  // reject on transport. That refusal is honest — and the tier machinery's
  // answer to it is the disclosed fallback, never a crash and never "meta".
  const source = metaRefusing(new SchemaVersionMismatchError("seizure_model", "expected", "other"));
  const reading = await loadMetaConstants(source);
  expect(reading).toEqual(META_CONSTANTS_FALLBACK);
  expect(reading.source).toBe("fallback");
});

test("META_CONSTANTS_FALLBACK is the disclosed pair: the fallback trio, named as such", () => {
  expect(META_CONSTANTS_FALLBACK).toEqual({ constants: TIER_FALLBACK, source: "fallback" });
});
