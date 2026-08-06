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
export type PositionsResponse = Schemas["PositionsResponse"];
export type BatchSupersededBody = Schemas["BatchSupersededBody"];
export type AddressHistoryResponse = Schemas["AddressHistoryResponse"];
export type EventsResponse = Schemas["EventsResponse"];
export type ParamsResponse = Schemas["ParamsResponse"];
export type PricesResponse = Schemas["PricesResponse"];
export type RunBookResponse = Schemas["RunBookResponse"];
export type ScenariosResponse = Schemas["ScenariosResponse"];
export type ObservatorySeriesResponse = Schemas["ObservatorySeriesResponse"];
export type EvidenceResponse = Schemas["EvidenceResponse"];
export type BatchResponse = Schemas["BatchResponse"];

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

/**
 * The COMMITTED half of a scenario — what `GET /v1/scenarios` serves, and
 * exactly `Omit<Scenario, "results">`. The equality is welded at compile time
 * in `test/scenarios.test.ts`: the two contract schemas are hand-written, and a
 * field added to one and forgotten on the other would publish two different
 * descriptions of one committed definition.
 */
export type ScenarioDefinition = Schemas["ScenarioDefinition"];
export type Scenario = Schemas["Scenario"];
export type ScenarioResult = Schemas["ScenarioResult"];
export type StressState = Schemas["StressState"];
export type Shock = Schemas["Shock"];
export type AppliedShock = Schemas["AppliedShock"];
export type Shortfall = Schemas["Shortfall"];
export type Projection = Schemas["Projection"];
export type ProjectionHorizon = Schemas["ProjectionHorizon"];

// --- Positions page (batch-stable pagination) ------------------------------

export type PositionSummary = Schemas["PositionSummary"];
export type LiqDistance = Schemas["LiqDistance"];

// --- Address history --------------------------------------------------------

export type AddressHistoryEngine = Schemas["AddressHistoryEngine"];
export type AddressHistoryPoint = Schemas["AddressHistoryPoint"];

// --- Events feed ------------------------------------------------------------

export type ChainEvent = Schemas["ChainEvent"];
export type EventDisplayType = Schemas["EventDisplayType"];
export type EventAmountUnit = Schemas["EventAmountUnit"];
export type EventFilter = Schemas["EventFilter"];
export type LiquidationDetail = Schemas["LiquidationDetail"];
export type SeizedCollateral = Schemas["SeizedCollateral"];

// --- Parameter timeline -----------------------------------------------------

export type ParamChange = Schemas["ParamChange"];
export type ParamField = Schemas["ParamField"];

// --- Price history ----------------------------------------------------------

export type PriceSeries = Schemas["PriceSeries"];
export type PricePoint = Schemas["PricePoint"];
export type QuarantinedRange = Schemas["QuarantinedRange"];

// --- Book-wide scenario run -------------------------------------------------

export type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookAggregate = Schemas["RunBookAggregate"];
// Contract 1.6.0 additions: the per-side distribution and collateral
// decomposition on each aggregate, and the accounts the scenario moved.
export type RunBookHistogram = Schemas["RunBookHistogram"];
export type RunBookCollateralAsset = Schemas["RunBookCollateralAsset"];
export type RunBookMover = Schemas["RunBookMover"];
// Contract 1.7.0 addition: the BEFORE-to-AFTER flow of each engine's position
// rows. The two histograms above cannot produce it — two marginals do not
// determine a joint — and its margins ARE those two histograms, lane for lane.
export type RunBookTransitions = Schemas["RunBookTransitions"];
export type RunBookTransitionLane = Schemas["RunBookTransitionLane"];
export type RunBookTransitionOutflow = Schemas["RunBookTransitionOutflow"];
export type RunBookTransitionCell = Schemas["RunBookTransitionCell"];

// --- Observatory rollup series ----------------------------------------------

export type ObservatorySeriesPoint = Schemas["ObservatorySeriesPoint"];

// --- Evidence manifest ------------------------------------------------------

export type SubstrateRef = Schemas["SubstrateRef"];
export type FeedsRegistry = Schemas["FeedsRegistry"];
export type ReconcileSummary = Schemas["ReconcileSummary"];
export type ReconcileWeld = Schemas["ReconcileWeld"];
export type ProbeRecord = Schemas["ProbeRecord"];
export type ProofSubject = Schemas["ProofSubject"];
export type LiveSubject = Schemas["LiveSubject"];

// --- Batch permalink --------------------------------------------------------

export type BatchAggregate = Schemas["BatchAggregate"];

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

/**
 * `events[].amount_unit` — the closed semantic-unit set of a feed row's
 * `amount` (the engine's own ACCOUNTING unit, never a display token amount).
 *
 * The `Record` weld makes this total BOTH ways against the generated union: a
 * unit the contract adds breaks this compile (missing key), and a unit the
 * contract drops breaks it too (excess key).
 */
const EVENT_AMOUNT_UNIT_SET = {
  none: true,
  dm_normalized_debt: true,
  aave_scaled: true,
  opaque: true,
} as const satisfies Record<EventAmountUnit, true>;
export const EVENT_AMOUNT_UNITS = Object.keys(EVENT_AMOUNT_UNIT_SET) as readonly EventAmountUnit[];

/**
 * `hf_transitions.lanes[].kind` — the closed lane vocabulary (contract 1.7.0).
 *
 * It is an INDEXED ACCESS on the generated schema type rather than a hand-written
 * union, because `RunBookTransitionLane.kind` is an INLINE enum on that schema
 * and not a named component: the `Schemas["EventAmountUnit"]` form used above is
 * unavailable here, and the indexed access is what makes this alias track the
 * contract instead of restating it.
 */
export type TransitionLaneKind = RunBookTransitionLane["kind"];

/**
 * The `Record` weld, exactly as `EVENT_AMOUNT_UNIT_SET` does it: total BOTH ways
 * against the generated union. A lane kind the contract adds breaks this compile
 * on a missing key, and one it drops breaks it on an excess key.
 */
const TRANSITION_LANE_KIND_SET = {
  bucket: true,
  infinite: true,
  unmeasured: true,
} as const satisfies Record<TransitionLaneKind, true>;
export const TRANSITION_LANE_KINDS = Object.keys(TRANSITION_LANE_KIND_SET) as readonly TransitionLaneKind[];

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
  "empirical-historical",
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
export const CONTRACT_VERSION = "1.8.0" as const;

/** WAD (1e18) — the scale health factors and grid factors are published at. */
export const WAD = 10n ** 18n;
