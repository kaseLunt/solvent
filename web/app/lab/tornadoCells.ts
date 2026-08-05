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
 *
 * R57 ITEM 1 — the gate takes the DISPATCHED id list, and a body whose
 * `requested_scenario_ids` is not set-equal to it is refused whole: the body's
 * own requested list is a claim, never an authority, and a set answering ids
 * nobody posted has no member this page may read.
 */
export function setContradiction(
  response: RunBookSetResponse,
  dispatchedIds: readonly string[],
): SetContradiction | null {
  const faults: string[] = [];
  const seen = new Set<string>();

  // R58 ITEM 1 — DUPLICATES REFUSE FIRST, before any set arithmetic. Collapsing
  // `requested_scenario_ids` into a Set let a body claiming ["a", "a"] against a
  // dispatch of ["a"] grade itself set-equal: one result, scenarios_evaluated 1,
  // and a header claiming "of 2 requested". A list that names an id twice is not
  // a set, so no set-equality question is even well-posed of it: the duplicated
  // id is named and the body refuses whole, and set-equality is judged only
  // after this gate passes.
  const requestedCounts = new Map<string, number>();
  for (const id of response.requested_scenario_ids) {
    requestedCounts.set(id, (requestedCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of requestedCounts) {
    if (count > 1) {
      faults.push(
        `${id} appears ${String(count)} times in requested_scenario_ids; a set names each id once`,
      );
    }
  }
  if (faults.length > 0) return { faults: [...new Set(faults)] };

  const requested = new Set(response.requested_scenario_ids);
  const dispatched = new Set(dispatchedIds);

  // R57 item 1 — THE BODY IS BOUND TO THE DISPATCH. `requested_scenario_ids`
  // is the body's own claim about what was asked; trusting it alone lets a
  // wrong body grade its own membership. The id set this client POSTed is the
  // only authority on what was asked, so the two must be set-equal before any
  // row is read.
  for (const id of dispatchedIds) {
    if (!requested.has(id)) {
      faults.push(`${id} was dispatched and is not named in requested_scenario_ids`);
    }
  }
  for (const id of requested) {
    if (!dispatched.has(id)) {
      faults.push(`${id} is named in requested_scenario_ids and was not dispatched`);
    }
  }

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
  | { state: "definition-changed"; fields: readonly string[] }
  /** R57 item 2 — a result whose scenario has NO listing row at all. Never rendered as numbers. */
  | { state: "unlisted-result"; sentence: string }
  /**
   * R57 item 2 / rev2 §4.3 — same identity triple, different engine set: the
   * definition changed without its version moving. A contract violation,
   * refused and named, never reconciled in either direction.
   */
  | { state: "coverage-skew"; sentence: string };

/**
 * The cell states that REFUSE a result whole (r57 item 4): they contribute no
 * bar, no ledger row, no header reach/absence count. The header carries a
 * refusal clause counting them by class instead.
 */
export const REFUSED_RESULT_STATES = new Set<TornadoCellState["state"]>([
  "contradictory-result",
  "definition-changed",
  "coverage-skew",
  "unlisted-result",
]);

/** The refusal clause's why-class label for a refused cell state. */
export function refusalClassOf(state: TornadoCellState["state"]): string | null {
  switch (state) {
    case "contradictory-result":
      return "contradictory result";
    case "coverage-skew":
      return "coverage skew";
    case "definition-changed":
      return "definition changed";
    case "unlisted-result":
      return "unlisted result";
    default:
      return null;
  }
}

/** "debt_manager" / "aave_v3_etherfi and debt_manager" — the skew sentence's list words. */
function engineListWords(engines: readonly string[]): string {
  if (engines.length === 0) return "no engine at all";
  if (engines.length === 1) return engines[0] ?? "";
  return `${engines.slice(0, -1).join(", ")} and ${engines[engines.length - 1] ?? ""}`;
}

/**
 * R58 ITEM 4 — THE MANDATORY BLOCK IS JUDGED PER ANSWERED ENGINE, never with
 * `engines.some(...)`. The contract makes the block mandatory on the engine row
 * (api/openapi.yaml: `market_realization` / `projection` are "MANDATORY
 * whenever the committed definition declares" them), so a block present on ONE
 * answered engine says nothing about a sibling that answered without its own:
 * that sibling's absence is a contract defect, NAMED by engine, while the
 * engines that do carry the block still render theirs as ledger rows.
 */
function mandatoryBlockClause(
  result: SetRunScenarioResult,
  block: "projection" | "market_realization",
): string {
  const label = block === "projection" ? "projection" : "market-realization";
  const missing: string[] = [];
  const present: string[] = [];
  for (const engine of result.engines) {
    (engine[block] === null ? missing : present).push(engine.engine);
  }
  const consequence =
    block === "projection" ? "there is no answer to point at" : "its information is absent";
  if (result.engines.length === 0) {
    return (
      `No engine of this result carries the ${label} block the contract makes mandatory here, ` +
      `so ${consequence}: that absence is a contract defect, never a zero.`
    );
  }
  if (missing.length === 0) {
    return block === "projection"
      ? "The projection row in the ledger below is the answer."
      : "Its information lives in the market-realization row in the ledger below.";
  }
  const defect =
    `${engineListWords(missing)} answered without the ${label} block the contract makes ` +
    `mandatory on every answered engine here`;
  if (present.length === 0) {
    return `${defect}, so ${consequence}: that absence is a contract defect, never a zero.`;
  }
  const still =
    present.length === 1
      ? `${present[0] ?? ""} still renders its ${label} row in the ledger below.`
      : `${engineListWords(present)} still render their ${label} rows in the ledger below.`;
  return `${defect}: that absence is a contract defect, never a zero. ${still}`;
}

/**
 * The cell for one result.
 *
 * Order matters: a contradicting body is refused before its identity is judged,
 * its identity is judged before its coverage is compared, and its coverage is
 * compared before any number of its is read.
 *
 * R57 ITEM 2 — the identity join is no longer optional. A result whose
 * scenario has NO listing row cannot be judged against any committed
 * definition, so it refuses as UNLISTED; a result whose identity agrees while
 * its `covered_engines` disagrees with the listing's engines is COVERAGE SKEW
 * (rev2 §4.3): the definition changed without its version moving, and neither
 * set is silently preferred.
 */
export function tornadoCellState(
  result: SetRunScenarioResult,
  configVersion: string,
  listed: ScenarioIdentity | undefined,
  listedEngines: readonly string[] | undefined,
): TornadoCellState {
  const faults = resultContradiction(result);
  if (faults.length > 0) return { state: "contradictory-result", faults };

  if (listed === undefined) {
    return {
      state: "unlisted-result",
      sentence:
        `${result.scenario_id} is not published by the committed listing this page is showing, so ` +
        "there is no definition to judge this result against. Nothing in it is read: no bar, no " +
        "ledger row, no header count. A result only ever renders against the definition it names.",
    };
  }

  const fields: string[] = [];
  if (listed.version !== result.scenario_version) fields.push("scenario_version");
  if (listed.configVersion !== configVersion) fields.push("scenario_config_version");
  if (fields.length > 0) return { state: "definition-changed", fields };

  if (listedEngines !== undefined) {
    const served = [...result.covered_engines].sort();
    const committed = [...listedEngines].sort();
    if (
      served.length !== committed.length ||
      served.some((engine, index) => engine !== committed[index])
    ) {
      return {
        state: "coverage-skew",
        sentence:
          `This result claims coverage of ${engineListWords(served)} while the ` +
          `committed definition on this page covers ${engineListWords(committed)}, and the ` +
          `identity triple agrees (${result.scenario_id} ${result.scenario_version} at ` +
          `scenario_config_version ${configVersion}). The definition changed without its version ` +
          "moving, which is a contract violation and not a difference to reconcile: this result " +
          "is refused whole, no bar and no ledger row, and neither engine set is silently " +
          "preferred over the other.",
      };
    }
  }

  switch (result.shock_reach.reach) {
    case "projection_no_spot_pass":
      // R57 item 5 — the sentence points at a block only when that block will
      // actually render as its own ledger row; a pointer at a block the page
      // does not show is a dangling reference. R58 item 4 — the block is
      // mandatory PER ANSWERED ENGINE: an engine that answered without its own
      // block is a contract defect named by engine, never covered for by a
      // sibling's block (`mandatoryBlockClause`).
      return {
        state: "projection-no-spot-pass",
        sentence:
          "This scenario is a PROJECTION: no spot pass ran, so the three deltas are zero by construction and no bar is " +
          "drawn. Its declared shocks were not applied to any mark. " +
          mandatoryBlockClause(result, "projection"),
      };
    case "no_shocks_declared":
      // The three deltas are zero BY CONSTRUCTION and the scenario's whole
      // information content is `market_realization`. A zero-length bar beside a
      // real one is the reading this state exists to refuse, and the sentence is
      // its own: nothing was ASKED FOR here, so nothing was swallowed and
      // nothing was declared held either. R58 item 4 — the block is mandatory
      // per answered engine, same law as the projection arm.
      return {
        state: "no-shock-declared",
        sentence:
          "This scenario declares no price shock at all, so the three deltas are zero by construction and say nothing " +
          "about the book's sensitivity. No bar is drawn. " +
          mandatoryBlockClause(result, "market_realization"),
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

/**
 * R58 ITEM 5 — the EXACT magnitude the ORDER is decided by: |delta| and the
 * before-side denominator, as bigints straight off the wire strings. The float
 * `ratio` is width-only; two true ratios that both clamp to the ceiling (1e12
 * and 1e12+1) are still ordered correctly by cross-multiplying these.
 */
export interface BarMagnitude {
  absDelta: bigint;
  before: bigint;
}

/** Whether an answered engine may draw a bar at all, and the length if it may. */
export type BarLength =
  | { drawn: true; ratio: number; exact: BarMagnitude }
  | { drawn: false; reason: "no-denominator"; sentence: string };

// R57 item 6 — the layout ratio's exact-arithmetic bounds. `Number(bigint)`
// on a 10^400-class integer is Infinity, and Infinity/Infinity is NaN, and
// 1/Infinity is 0 — so the division is done IN BIGINT first, at a fixed scale,
// and only the small quotient crosses into floats.
/** 10^9 steps of layout resolution: far finer than any pixel the chart can spend. */
const RATIO_SCALE = 1_000_000_000n;
/** |ratio| is clamped here: the layout saturates long before, and Number(10^21) is finite. */
const RATIO_CEILING = RATIO_SCALE * 1_000_000_000_000n;
/**
 * A nonzero exact delta whose scaled quotient truncates to 0 keeps this
 * epsilon instead: smaller than one scale step, still finite, still signed —
 * so a nonzero NEVER classifies as a measured zero, and the geometry's own
 * 1.5px floor (disclosed, item 7) is what makes it visible.
 */
const RATIO_EPSILON = 1e-12;

/**
 * THE ONLY SANCTIONED NORMALIZATION. Dimensionless, against the engine's OWN
 * book, and against the BEFORE side — the after side is a different book,
 * because Aave's debt is priced and moves under a shock.
 *
 * The ratio is a LAYOUT quantity. Every printed number stays the engine's own
 * exact decimal string at its own `usd_decimals`, and this is never rounded
 * into a claim.
 *
 * R57 item 6 — computed by BOUNDED SCALED DIVISION in bigint: the numerator is
 * scaled by 10^9, divided exactly, clamped, and only then converted. Any legal
 * Decimal pair yields a FINITE ratio, a nonzero delta never yields ratio 0,
 * and no geometry downstream can meet a NaN.
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
  // R58 item 5 — the exact pair travels WITH the ratio: the clamp below can
  // collapse two different true ratios onto one float, so ordering is decided
  // downstream by cross-multiplied bigints and the float stays width-only.
  const exact: BarMagnitude = {
    absDelta: numerator < 0n ? -numerator : numerator,
    before: denominator < 0n ? -denominator : denominator,
  };
  // Exact bigint division truncates toward zero, so the sign survives; the
  // clamp keeps the quotient inside float range whatever the operands were.
  const scaled = (numerator * RATIO_SCALE) / denominator;
  const clamped =
    scaled > RATIO_CEILING ? RATIO_CEILING : scaled < -RATIO_CEILING ? -RATIO_CEILING : scaled;
  const ratio = Number(clamped) / Number(RATIO_SCALE);
  if (ratio === 0 && numerator !== 0n) {
    return { drawn: true, ratio: numerator > 0n ? RATIO_EPSILON : -RATIO_EPSILON, exact };
  }
  return { drawn: true, ratio, exact };
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
