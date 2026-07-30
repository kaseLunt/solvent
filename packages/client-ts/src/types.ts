// Public type surface: named aliases over the GENERATED schema.
//
// `src/generated/schema.ts` is produced from `api/openapi.yaml` by
// `openapi-typescript` and is never edited by hand (`npm run gen` regenerates
// it; `test/drift.test.ts` fails if the checked-in file and the contract have
// drifted apart). This module exists so consumers import `BookResponse` rather
// than `components["schemas"]["BookResponse"]`, and so the client's own code has
// exactly one place where a contract rename would surface.

import type { components } from "./generated/schema.js";

/** Every schema in the contract, keyed by its OpenAPI component name. */
export type Schemas = components["schemas"];

// --- Responses -------------------------------------------------------------

export type BookResponse = Schemas["BookResponse"];
export type AddressResponse = Schemas["AddressResponse"];
export type StressResponse = Schemas["StressResponse"];
export type ObservatoryResponse = Schemas["ObservatoryResponse"];
export type MetaResponse = Schemas["MetaResponse"];
export type StreamPayload = Schemas["StreamPayload"];
export type ErrorBody = Schemas["ErrorBody"];

// --- Envelope + posture ----------------------------------------------------

export type Batch = Schemas["Batch"];
export type Stamp = Schemas["Stamp"];
export type SweepStamp = Schemas["SweepStamp"];
export type Supersession = Schemas["Supersession"];
export type SupersessionLeg = Schemas["SupersessionLeg"];
export type EngineRefusal = Schemas["EngineRefusal"];
export type Cursor = Schemas["Cursor"];
export type ChainEpoch = Schemas["ChainEpoch"];
export type ReorgPosture = Schemas["ReorgPosture"];

// --- Book ------------------------------------------------------------------

export type Aggregate = Schemas["Aggregate"];
export type Count = Schemas["Count"];
export type Histogram = Schemas["Histogram"];
export type EngineHistogram = Schemas["EngineHistogram"];
export type HistogramBucket = Schemas["HistogramBucket"];
export type Waterfall = Schemas["Waterfall"];
export type WaterfallPoint = Schemas["WaterfallPoint"];
export type WaterfallEngine = Schemas["WaterfallEngine"];
export type Monotonicity = Schemas["Monotonicity"];
export type BadDebt = Schemas["BadDebt"];
export type BookCoverage = Schemas["BookCoverage"];
export type Excluded = Schemas["Excluded"];
export type HeldFlat = Schemas["HeldFlat"];

// --- Address ---------------------------------------------------------------

export type Position = Schemas["Position"];
export type Leg = Schemas["Leg"];
export type Refusal = Schemas["Refusal"];
export type HealthFactor = Schemas["HealthFactor"];
export type PriceInput = Schemas["PriceInput"];
export type AsOf = Schemas["AsOf"];
export type LiquidationPrice = Schemas["LiquidationPrice"];
export type FactorPrice = Schemas["FactorPrice"];

// --- Stress ----------------------------------------------------------------

export type Scenario = Schemas["Scenario"];
export type ScenarioResult = Schemas["ScenarioResult"];
export type StressState = Schemas["StressState"];
export type Shock = Schemas["Shock"];
export type AppliedShock = Schemas["AppliedShock"];
export type Shortfall = Schemas["Shortfall"];
export type Projection = Schemas["Projection"];
export type ProjectionHorizon = Schemas["ProjectionHorizon"];

// --- Observatory + meta ----------------------------------------------------

export type ObservatoryPoint = Schemas["ObservatoryPoint"];
export type RateIndex = Schemas["RateIndex"];
export type Service = Schemas["Service"];
export type PriceState = Schemas["PriceState"];
export type Neutralized = Schemas["Neutralized"];
export type SweepCounts = Schemas["SweepCounts"];
export type Heartbeat = Schemas["Heartbeat"];
export type Constants = Schemas["Constants"];

// --- Stream ----------------------------------------------------------------

export type Degradation = Schemas["Degradation"];
export type DegradationEngine = Schemas["DegradationEngine"];
export type Transition = Schemas["Transition"];

// --- Closed enumerations the contract publishes ----------------------------
//
// These are `as const` values rather than re-derived strings so a consumer can
// compare against them without retyping a literal the contract owns.

/** `error.code` — the closed set a client may branch on. */
export const ERROR_CODES = ["bad_request", "not_found", "rate_limited", "unavailable", "internal"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `price_inputs[].verdict` — how a price input was judged against its own budget. */
export const PRICE_VERDICTS = ["fresh", "stale", "over-ceiling", "missing", "no-as-of", "reorg-unacked"] as const;
export type PriceVerdict = (typeof PRICE_VERDICTS)[number];

/** `hf_histogram.engines[].comparator` — the quantity the buckets are computed on. */
export const HISTOGRAM_COMPARATORS = ["hf_wad", "hf_num/hf_den"] as const;
export type HistogramComparator = (typeof HISTOGRAM_COMPARATORS)[number];

/** `batch.supersession.legs[].leg` — three design legs plus the fail-closed fourth. */
export const SUPERSESSION_LEGS = [
  "acked_epoch_moved",
  "last_block_rewound",
  "unacked_epoch_recorded",
  "cursor_absent",
] as const;
export type SupersessionLegName = (typeof SUPERSESSION_LEGS)[number];

/** `shocks[].axis` — the primitive axes a scenario may shock. */
export const SHOCK_AXES = ["eth_usd", "weeth_eth_rate", "stable_usd", "asset_usd", "borrow_apy"] as const;
export type ShockAxis = (typeof SHOCK_AXES)[number];

/**
 * `heartbeat_provenance[].provenance_grade` — what the repo's evidence says
 * about the BUDGET ITSELF, not about the feed's current health.
 *
 * `published-and-refuted` is the one a consumer must not miss: the published
 * budget has been FALSIFIED by a scan. `budget_refuted` is its one-bit form for
 * exactly that reason.
 */
export const HEARTBEAT_GRADES = [
  "verified",
  "empirical-historical-with-qualifier",
  "published-and-refuted",
  "published-not-verified",
] as const;
export type HeartbeatGrade = (typeof HEARTBEAT_GRADES)[number];

/**
 * The single value the contract's `seizure_model` enum admits.
 *
 * A server reporting anything else is not this contract, and the client refuses
 * rather than rendering an undisclosed seizure assumption as if it were this one.
 */
export const SEIZURE_MODEL = "pro-rata-over-counted-collateral" as const;

/** `info.version` of the contract this client was generated from. */
export const CONTRACT_VERSION = "1.0.0" as const;

/** WAD (1e18) — the scale health factors and grid factors are published at. */
export const WAD = 10n ** 18n;
