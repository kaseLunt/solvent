// The SET-RUN's decision module: what a renderer may draw for one result, and
// what it must say instead.
//
// It is a sibling of `matrixCells.ts`, not a widening of it. `LabRunBookEngine`
// carries full `before`/`after` aggregates, histograms, `collateral_by_asset`
// and `movers`; a SUMMARY flowing into `cellState`'s `{state: "result"}` arm
// would render blank histograms and empty collateral tables — holes filled with
// zeros, which is the exact defect that file was built to prevent. So the
// vocabulary is REUSED (`ScenarioIdentity`, `rowIdentity`, `definitionSkew`) and
// the cell states are new.
//
// # THE AXIS LAW, client side
//
// The server refuses to sum money across engines; a RENDERER can sum numbers a
// server never summed, so the prohibition has a client half and this is it.
//
//   - one axis per engine, never one across engines: a 6-decimal integer and an
//     8-decimal one are not comparable quantities;
//   - the only sanctioned normalization is a bar's length as
//     `eligible_debt_delta_usd / total_debt_usd_before` on THAT engine's own
//     row — dimensionless, and against the BEFORE side, because Aave's debt is
//     priced and its two sides are different books. The ratio is a LAYOUT
//     quantity and is never printed;
//   - a zero denominator draws NO BAR and never divides;
//   - a shock that did not reach draws no bar, and a scenario that declared no
//     move draws no bar UNDER ITS OWN SENTENCE;
//   - a reach count is never printed as a cause: only the three
//     `marks_held_by_*` figures may answer "why is this zero", and "K of K
//     snapped" is forbidden outright — it prints "3 of 4" on the committed
//     four-row snap control and "0 of 9" on the identity census, and both are
//     false sentences under a true header;
//   - a movement count is never printed without its denominator.

import type { ScenarioIdentity } from "./matrixCells";
import type {
  RunBookSetResponse,
  SetRunEngineSummary,
  SetRunScenarioResult,
} from "../../lib/runbookSet";

/** The set-level gate: the body answers its own membership two ways, or not at all. */
export interface SetContradiction {
  /** Every distinct fault, named. A body can carry more than one. */
  faults: string[];
}

/**
 * VALIDATE THE BODY AGAINST ITSELF BEFORE CLASSIFYING ANYTHING.
 *
 * This runs FIRST, over the whole body, before any row is judged: a set that
 * contradicts its own membership produces no cell, no pin and no cohort for any
 * row it covers. It deliberately does not borrow the single-scenario
 * contradiction register's sentence — "a book named nobody" is a false account
 * of a set that named somebody twice.
 */
export function setContradiction(response: RunBookSetResponse): SetContradiction | null {
  const faults: string[] = [];
  const seen = new Set<string>();
  const requested = new Set(response.requested_scenario_ids);

  for (const result of response.results) {
    if (seen.has(result.scenario_id)) {
      faults.push(`${result.scenario_id} appears in more than one result`);
    }
    seen.add(result.scenario_id);
    if (!requested.has(result.scenario_id)) {
      faults.push(`${result.scenario_id} was answered and was not requested`);
    }
  }
  for (const id of response.requested_scenario_ids) {
    if (!seen.has(id)) faults.push(`${id} was requested and has no result`);
  }
  if (response.evaluation.scenarios_evaluated !== response.results.length) {
    faults.push(
      `evaluation.scenarios_evaluated is ${String(response.evaluation.scenarios_evaluated)} against ` +
        `${String(response.results.length)} results`,
    );
  }
  return faults.length === 0 ? null : { faults: [...new Set(faults)] };
}

/** One result contradicting ITSELF refuses that result only, never the set. */
export function resultContradiction(result: SetRunScenarioResult): string[] {
  const faults: string[] = [];
  const covered = [...result.covered_engines].sort();
  const parts = [
    ...result.engines.map((engine) => engine.engine),
    ...result.withheld_engines,
    ...result.unmeasurable_engines.map((absence) => absence.engine),
  ];
  const counts = new Map<string, number>();
  for (const engine of parts) counts.set(engine, (counts.get(engine) ?? 0) + 1);
  for (const [engine, n] of counts) {
    if (n > 1) faults.push(`${engine} appears in ${String(n)} of the three engine arrays`);
  }
  const union = [...parts].sort();
  if (union.length !== covered.length || union.some((engine, i) => engine !== covered[i])) {
    faults.push(
      "engines + withheld_engines + unmeasurable_engines is not a partition of covered_engines",
    );
  }
  for (const engine of result.engines) {
    if (engine.accounts === 0) faults.push(`${engine.engine} is a numeric row with zero accounts`);
  }
  return faults;
}

/** Every state a result's cell can be in. */
export type TornadoCellState =
  | { state: "bars"; engines: readonly SetRunEngineSummary[] }
  | { state: "partly-reached"; engines: readonly SetRunEngineSummary[]; sentence: string }
  | { state: "shock-did-not-reach"; sentence: string }
  | { state: "declared-hold"; sentence: string }
  | { state: "no-shock-declared"; sentence: string }
  | { state: "projection-no-spot-pass"; sentence: string }
  | { state: "no-answerable-engine"; sentence: string }
  | { state: "contradictory-result"; faults: readonly string[] }
  | { state: "definition-changed"; fields: readonly string[] };

/**
 * The cell for one result.
 *
 * Order matters: a contradicting body is refused before its identity is judged,
 * and its identity is judged before any number of its is read.
 */
export function tornadoCellState(
  result: SetRunScenarioResult,
  configVersion: string,
  listed: ScenarioIdentity | undefined,
): TornadoCellState {
  const faults = resultContradiction(result);
  if (faults.length > 0) return { state: "contradictory-result", faults };

  if (listed !== undefined) {
    const fields: string[] = [];
    if (listed.version !== result.scenario_version) fields.push("scenario_version");
    if (listed.configVersion !== configVersion) fields.push("scenario_config_version");
    if (fields.length > 0) return { state: "definition-changed", fields };
  }

  switch (result.shock_reach.reach) {
    case "projection_no_spot_pass":
      return {
        state: "projection-no-spot-pass",
        sentence:
          "This scenario is a PROJECTION: no spot pass ran, so the three deltas are zero by construction and no bar is " +
          "drawn. Its declared shocks were not applied to any mark. The projection block is the answer.",
      };
    case "no_shocks_declared":
      // The three deltas are zero BY CONSTRUCTION and the scenario's whole
      // information content is `market_realization`. A zero-length bar beside a
      // real one is the reading this state exists to refuse, and the sentence is
      // its own: nothing was ASKED FOR here, so nothing was swallowed and
      // nothing was declared held either.
      return {
        state: "no-shock-declared",
        sentence:
          "This scenario declares no price shock at all, so the three deltas are zero by construction and say nothing " +
          "about the book's sensitivity. No bar is drawn. Its information lives in the market-realization block.",
      };
    case "all_shocks_declared_at_identity":
      return {
        state: "declared-hold",
        sentence:
          `This scenario declares all ${String(result.shock_reach.declared_shocks)} of its shocks at the factor 1/1: ` +
          "it asks for no price move, BY DECISION rather than by accident. The three deltas are zero by construction " +
          "and nothing about the book or the oracle may be inferred from them. " +
          `Its own path assumption: ${result.path_assumption}` +
          (result.shock_reach.applied_shocks.length > 0
            ? ` The matrix is not empty — ${String(result.shock_reach.applied_shocks.length)} mark(s) were described ` +
              "and held at that factor."
            : ""),
      };
    case "no_mark_moved":
      return { state: "shock-did-not-reach", sentence: noMarkMovedSentence(result) };
    case "no_shock_reached_the_book":
      return { state: "shock-did-not-reach", sentence: noShockReachedSentence(result) };
    case "some_marks_held":
      if (result.engines.length === 0) return noAnswerableEngine(result);
      return {
        state: "partly-reached",
        engines: result.engines,
        sentence:
          `${String(result.shock_reach.marks_moved)} of ${String(result.shock_reach.applied_shocks.length)} marks ` +
          `this scenario's matrix describes moved. ${heldCauseSentence(result)}`,
      };
    case "every_mark_moved":
      if (result.engines.length === 0) return noAnswerableEngine(result);
      return { state: "bars", engines: result.engines };
  }
}

function noAnswerableEngine(result: SetRunScenarioResult): TornadoCellState {
  const named = [
    ...result.withheld_engines.map((engine) => `${engine} (withheld on this batch)`),
    ...result.unmeasurable_engines.map((absence) => `${absence.engine} (${absence.reason})`),
  ];
  return {
    state: "no-answerable-engine",
    sentence:
      "Every engine this scenario covers is withheld or carries nothing measurable, so it draws no bar: " +
      `${named.join(", ")}. It WAS evaluated — this is an absence, never a zero.`,
  };
}

/**
 * THE HELD-CAUSE SENTENCE, composed from the three `marks_held_by_*` counts and
 * NEVER from a single flag count. Only the nonzero terms print.
 */
export function heldCauseSentence(result: SetRunScenarioResult): string {
  const reach = result.shock_reach;
  const parts: string[] = [];
  if (reach.marks_held_by_transform > 0) {
    parts.push(
      `${String(reach.marks_held_by_transform)} pinned by the stable snap, a snapped base or a bound cap`,
    );
  }
  if (reach.marks_held_by_declared_factor > 0) {
    parts.push(
      `${String(reach.marks_held_by_declared_factor)} held at the factor this scenario declared for them`,
    );
  }
  if (reach.marks_held_by_arithmetic > 0) {
    parts.push(`${String(reach.marks_held_by_arithmetic)} unchanged by exact-integer arithmetic`);
  }
  return parts.length === 0 ? "No mark was held." : `Of the held marks: ${parts.join(", ")}.`;
}

function noMarkMovedSentence(result: SetRunScenarioResult): string {
  return (
    "Every mark this scenario's matrix describes came back at the value it started at. " +
    `${heldCauseSentence(result)} ` +
    "The before-side figures beside this are a true measurement of a real book; no bar is drawn on any engine."
  );
}

function noShockReachedSentence(result: SetRunScenarioResult): string {
  const held = result.shock_reach.held_flat_assets
    .map((asset) => `${asset.asset} on chain ${String(asset.chain_id)}`)
    .join(", ");
  return (
    "No price input in this book is described by this scenario's propagation matrix. " +
    `${String(result.shock_reach.held_flat_marks)} mark(s) were held flat instead` +
    (held === "" ? "." : `: ${held}.`) +
    " No bar is drawn on any engine."
  );
}

/** Whether an answered engine may draw a bar at all, and the length if it may. */
export type BarLength =
  | { drawn: true; ratio: number }
  | { drawn: false; reason: "no-denominator"; sentence: string };

/**
 * THE ONLY SANCTIONED NORMALIZATION. Dimensionless, against the engine's OWN
 * book, and against the BEFORE side — the after side is a different book,
 * because Aave's debt is priced and moves under a shock.
 *
 * The ratio is a LAYOUT quantity. Every printed number stays the engine's own
 * exact decimal string at its own `usd_decimals`, and this is never rounded
 * into a claim.
 */
export function barLength(engine: SetRunEngineSummary): BarLength {
  const denominator = BigInt(engine.total_debt_usd_before);
  if (denominator === 0n) {
    return {
      drawn: false,
      reason: "no-denominator",
      sentence:
        `${engine.engine} carries no debt on the before side, so there is no share to take of it. No bar is drawn ` +
        "and nothing is divided.",
    };
  }
  const numerator = BigInt(engine.eligible_debt_delta_usd);
  // Exact integers to a layout fraction, in one place, with the sign preserved.
  return { drawn: true, ratio: Number(numerator) / Number(denominator) };
}

/**
 * THE MOVEMENT COUNT, WITH ITS DENOMINATOR. Never a bare K, and never K against
 * `accounts`: on an Aave book of residual dust "0 of 46" reads as "no health
 * factor dropped" when the truth can be "44 of the 46 carry no health factor to
 * drop".
 */
export function movementSentence(engine: SetRunEngineSummary): string {
  const denominator = engine.accounts - engine.movement_excluded_accounts;
  const subject =
    engine.movement_rule === "hf_strictly_dropped"
      ? { count: engine.hf_dropped_accounts, verb: "health factors strictly dropped" }
      : { count: engine.flipped_to_eligible, verb: "accounts flipped into eligibility" };
  if (subject.count === null) {
    return `${engine.engine} publishes no movement count under its own rule, which is a defect rather than a zero.`;
  }
  const excluded =
    engine.movement_excluded_accounts === 0
      ? ""
      : ` ${String(engine.movement_excluded_accounts)} of the ${String(engine.accounts)} measured accounts could not ` +
        "be tested for movement at all and are outside that denominator.";
  return `${String(subject.count)} of ${String(denominator)} ${subject.verb}.${excluded}`;
}

/** The header's freshness clause, one per arm. */
export function freshnessClause(response: RunBookSetResponse): string {
  const evaluation = response.evaluation;
  const measured = String(response.batch.id);
  const newest =
    evaluation.newest_servable_batch_id === null
      ? null
      : String(evaluation.newest_servable_batch_id);
  switch (evaluation.freshness) {
    case "still_newest":
      return `batch ${measured}`;
    case "superseded":
      return `batch ${measured} — batch ${String(newest)} has since materialized; re-run the set to move onto it`;
    case "newest_is_older":
      return (
        `batch ${measured} — the newest servable batch is now ${String(newest)}, which is OLDER: a re-run would ` +
        "answer on an older book"
      );
    case "none_servable":
      return `batch ${measured} — no batch is servable right now, so a re-run would be refused`;
  }
}
