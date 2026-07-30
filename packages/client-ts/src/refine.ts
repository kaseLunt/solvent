// The verdict-refinement law: no nullable-boolean verdict on a primary surface.
//
// # The class this module seals (round-3 H1)
//
// Waves 1–2 sealed the three-valued `found` behind the `outcome` union, and
// round 3 observed that the SAME CLASS survived on every other exported
// surface. The contract publishes four nullable-boolean fields whose `null`
// means A STATEMENT IS WITHHELD rather than "no":
//
//   Position.liquidatable                  null: refused, or Aave (no strict boolean)
//   StressState.liquidatable               null: Aave
//   ProjectionHorizon.becomes_liquidatable null: no verdict for the horizon
//   Leg.used_as_collateral                 null: the engine publishes no statement
//
// Under any of them the honest consumer line — `if (!position.liquidatable)
// renderSafe()` — compiles, and labels a withheld liquidation verdict
// definitively safe: the exact falsiness conflation the lookup union removed
// from `found`.
//
// # The law
//
// ONE total mapping per vocabulary, applied to every member of the class:
//
//   true  -> "liquidatable"      /  "counted"
//   false -> "not-liquidatable"  /  "not-counted"
//   null  -> "unknowable"        /  "unknowable"
//
// Every value the contract admits has exactly one image — `null` maps to
// `unknowable`, NEVER to a definitive token — and `ContractInvariantError` is
// reserved for values the contract makes impossible (a non-boolean,
// non-null). A non-empty string literal cannot be falsiness-conflated
// (`!verdict` is dead code) and narrowing it requires `===`.
//
// The refined shapes carry the sealed union under a NEW name
// (`liquidation_verdict` / `collateral_use`) and the raw field is ABSENT — at
// the type level AND at runtime, by destructure-rest (the wave-1 pattern) — so
// neither `if (!p.liquidatable)` nor `Object.hasOwn(p, "liquidatable")` can
// resurrect the trap. `lookup()` (and therefore the primary `address()` /
// `addressStress()` methods) serves only refined shapes; the unrefined wire
// values remain where the name declares the hazard: `addressRaw()` /
// `addressStressRaw()`.

import { ContractInvariantError } from "./errors.js";
import type {
  Leg,
  Position,
  Projection,
  ProjectionHorizon,
  Scenario,
  ScenarioResult,
  StressState,
} from "./types.js";

// ---------------------------------------------------------------------------
// The sealed vocabularies.
// ---------------------------------------------------------------------------

/**
 * A liquidation verdict, sealed. `unknowable` is the refined image of the
 * wire's withheld (`null`) verdict and is NEVER "safe"; `not-liquidatable` is
 * the only token that means safe, and reaching it requires `===`.
 */
export type LiquidationVerdict = "liquidatable" | "not-liquidatable" | "unknowable";

/**
 * Whether a leg's asset is counted as collateral, sealed. `unknowable` is the
 * refined image of the wire's `null` — the engine publishes no such statement
 * (the Debt Manager's legs) — and is never "not counted".
 */
export type CollateralUse = "counted" | "not-counted" | "unknowable";

// ---------------------------------------------------------------------------
// The field-mapping law. TOTAL over `boolean | null`; refusal is reserved for
// values the contract forbids outright.
// ---------------------------------------------------------------------------

/** The one liquidation-verdict mapping, used by every field site in the class. */
export function liquidationVerdict(wire: boolean | null): LiquidationVerdict {
  if (wire === true) return "liquidatable";
  if (wire === false) return "not-liquidatable";
  if (wire === null) return "unknowable";
  throw new ContractInvariantError(
    "a liquidation verdict is boolean or null",
    `the wire carried ${JSON.stringify(wire)} where the contract admits exactly true, false ` +
      `or null; refusing to guess which of the three sealed verdicts it meant`,
  );
}

/** The collateral-use mapping — same law, second vocabulary. */
export function collateralUse(wire: boolean | null): CollateralUse {
  if (wire === true) return "counted";
  if (wire === false) return "not-counted";
  if (wire === null) return "unknowable";
  throw new ContractInvariantError(
    "a collateral-use statement is boolean or null",
    `the wire carried ${JSON.stringify(wire)} where the contract admits exactly true, false ` +
      `or null; refusing to guess whether the leg is counted`,
  );
}

// ---------------------------------------------------------------------------
// The refined shapes. Raw nullable-boolean fields ABSENT, sealed unions in.
// ---------------------------------------------------------------------------

/** A leg with `used_as_collateral` sealed into `collateral_use`. */
export interface RefinedLeg extends Omit<Leg, "used_as_collateral"> {
  collateral_use: CollateralUse;
}

/**
 * A position with `liquidatable` sealed into `liquidation_verdict` (and its
 * legs refined).
 *
 * `liquidation_verdict` is the FIELD's own truth — the Debt Manager's strict
 * boolean, refined. On Aave it is `unknowable` because Aave publishes a
 * continuous health factor instead of a strict boolean; `positionVerdict()`
 * in `src/decimal.ts` is the cross-engine answer, on each engine's own
 * comparator.
 */
export interface RefinedPosition extends Omit<Position, "liquidatable" | "legs"> {
  liquidation_verdict: LiquidationVerdict;
  legs: RefinedLeg[];
}

/**
 * A stress state with `liquidatable` sealed into `liquidation_verdict`.
 *
 * `eligible` passes through untouched: on the wire it is a TOTAL boolean —
 * each engine's own comparator, computed server-side — whose `false` genuinely
 * means "not eligible", so it is not in the class this module seals.
 */
export interface RefinedStressState extends Omit<StressState, "liquidatable"> {
  liquidation_verdict: LiquidationVerdict;
}

/**
 * A projection horizon with `becomes_liquidatable` sealed into
 * `liquidation_verdict`: does the position become liquidatable within this
 * horizon — `liquidatable`, `not-liquidatable`, or `unknowable`.
 */
export interface RefinedProjectionHorizon extends Omit<ProjectionHorizon, "becomes_liquidatable"> {
  liquidation_verdict: LiquidationVerdict;
}

/** A projection whose horizons are refined. */
export interface RefinedProjection extends Omit<Projection, "horizons"> {
  horizons: RefinedProjectionHorizon[];
}

/** A scenario result whose states and projection are refined. */
export interface RefinedScenarioResult extends Omit<ScenarioResult, "before" | "after" | "projection"> {
  before: RefinedStressState | null;
  after: RefinedStressState | null;
  projection: RefinedProjection | null;
}

/** A scenario whose results are refined. */
export interface RefinedScenario extends Omit<Scenario, "results"> {
  results: RefinedScenarioResult[];
}

// ---------------------------------------------------------------------------
// The structure mappers. Destructure-rest, so the raw keys are absent at
// runtime, not merely retyped; everything outside the class passes through
// exactly as the wire carried it.
// ---------------------------------------------------------------------------

export function refineLeg(leg: Leg): RefinedLeg {
  const { used_as_collateral, ...rest } = leg;
  return { ...rest, collateral_use: collateralUse(used_as_collateral) };
}

export function refinePosition(position: Position): RefinedPosition {
  const { liquidatable, legs, ...rest } = position;
  return {
    ...rest,
    liquidation_verdict: liquidationVerdict(liquidatable),
    legs: legs.map(refineLeg),
  };
}

export function refineStressState(state: StressState): RefinedStressState {
  const { liquidatable, ...rest } = state;
  return { ...rest, liquidation_verdict: liquidationVerdict(liquidatable) };
}

export function refineProjectionHorizon(horizon: ProjectionHorizon): RefinedProjectionHorizon {
  const { becomes_liquidatable, ...rest } = horizon;
  return { ...rest, liquidation_verdict: liquidationVerdict(becomes_liquidatable) };
}

export function refineProjection(projection: Projection): RefinedProjection {
  const { horizons, ...rest } = projection;
  return { ...rest, horizons: horizons.map(refineProjectionHorizon) };
}

export function refineScenarioResult(result: ScenarioResult): RefinedScenarioResult {
  const { before, after, projection, ...rest } = result;
  return {
    ...rest,
    before: before === null ? null : refineStressState(before),
    after: after === null ? null : refineStressState(after),
    projection: projection === null ? null : refineProjection(projection),
  };
}

export function refineScenario(scenario: Scenario): RefinedScenario {
  const { results, ...rest } = scenario;
  return { ...rest, results: results.map(refineScenarioResult) };
}

// ---------------------------------------------------------------------------
// The body-level hook `lookup()` uses.
// ---------------------------------------------------------------------------

/**
 * The refined image of a (found-sealed) lookup body: `positions` become
 * `RefinedPosition[]`, `scenarios` become `RefinedScenario[]`, and a body
 * carrying neither passes through unchanged.
 */
export type RefinedBody<B> = B extends { positions: Position[] }
  ? Omit<B, "positions"> & { positions: RefinedPosition[] }
  : B extends { scenarios: Scenario[] }
    ? Omit<B, "scenarios"> & { scenarios: RefinedScenario[] }
    : B;

/**
 * Refine a lookup body's positions or scenarios in place of the wire arrays.
 *
 * This does NOT seal `found` — `lookup()` in `src/lookup.ts` destructures the
 * three-valued field off before calling this, and is the only caller on the
 * primary path. (The casts are the usual price of a conditional return type;
 * the runtime checks mirror the type-level conditions exactly.)
 */
export function refineBody<B extends object>(body: B): RefinedBody<B> {
  if ("positions" in body && Array.isArray((body as { positions?: unknown }).positions)) {
    const { positions, ...rest } = body as B & { positions: Position[] };
    return { ...rest, positions: positions.map(refinePosition) } as RefinedBody<B>;
  }
  if ("scenarios" in body && Array.isArray((body as { scenarios?: unknown }).scenarios)) {
    const { scenarios, ...rest } = body as B & { scenarios: Scenario[] };
    return { ...rest, scenarios: scenarios.map(refineScenario) } as RefinedBody<B>;
  }
  return body as RefinedBody<B>;
}
