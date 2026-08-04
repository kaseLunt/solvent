// THE SCENARIO × ENGINE MATRIX's decision layer (Wave W-SD-A, ruling items 4
// and 6). Pure — no React, no fetch. Everything the matrix renders is decided
// here and pinned by `tests/unit/lab-matrix.spec.ts`.
//
// THE DISTINCTION THIS FILE EXISTS FOR, in the contract's own words:
//
//   "`engines` is the set of engines a scenario is DEFINED for. An engine
//    absent from it is outside the scenario's model — a property of the
//    definition, and NOT the same statement as a withheld engine, which is a
//    refusal... Collapsing the two would make an undefined cell and a censored
//    cell look alike."
//
// So NOT COVERED is derived from the committed LISTING and is knowable BEFORE
// any run happens; WITHHELD is derived from a RUN's `excluded_engines` and is
// a refusal with a code and a detail. The two never share a cell state, a
// colour, or a sentence.
//
// THE SINGLE-BATCH GUARD (the wave's context note: batches materialize ~2/min,
// so supersession is the common case, not the rare one). Results shown
// TOGETHER must come from ONE batch. Every held result is pinned to the batch
// it ran at; the cohort ANCHOR is the newest batch any held result carries;
// anything older renders as its own named state (`superseded`) with a re-run
// affordance. The matrix therefore never composes a sentence across batches —
// there is no cross-batch total anywhere in this file, and no total column at
// all.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { EngineRefusal, ScenarioDefinition, Shock } from "@solvent/client";
import type { LabRunBook, LabRunBookEngine, RunBookOutcome } from "../../lib/runbook";

// ---------------------------------------------------------------------------
// Axis families — the vocabulary a not-covered cell explains itself in.
// ---------------------------------------------------------------------------

/**
 * The factor space a scenario's shocks reach, folded from the contract's
 * sealed `Shock.axis` enum.
 *
 * `market_realization` is the family of a scenario with NO shocks: the wire's
 * own note says a scenario can carry its information "on another axis — a
 * projection over time, or a market realization the oracles do not see". A
 * shockless scenario is not an empty scenario, and this family is how the
 * matrix says so rather than rendering a blank.
 */
export type AxisFamily =
  | "eth_price"
  | "weeth_rate"
  | "stable_price"
  | "asset_price"
  | "borrow_rate"
  | "market_realization";

/** Reader words per family — used in cell titles and the not-covered reason. */
export const AXIS_FAMILY_WORDS: Record<AxisFamily, string> = {
  eth_price: "the ETH mark",
  weeth_rate: "the weETH/ETH rate",
  stable_price: "the stablecoin marks",
  asset_price: "a named asset mark",
  borrow_rate: "the borrow rate",
  market_realization: "market realization (no oracle mark moves)",
};

const AXIS_TO_FAMILY: Record<Shock["axis"], AxisFamily> = {
  eth_usd: "eth_price",
  weeth_eth_rate: "weeth_rate",
  stable_usd: "stable_price",
  asset_usd: "asset_price",
  borrow_apy: "borrow_rate",
};

/**
 * The axis families a scenario's `shocks[]` touch, deduped, in WIRE order.
 *
 * An axis outside the sealed enum is NOT dropped and NOT guessed at — it is
 * carried through as its own family token so the surface can say the truthful
 * thing ("an axis this build does not know") instead of silently narrowing the
 * scenario's model.
 */
export function axisFamilies(shocks: readonly Shock[]): AxisFamily[] {
  if (shocks.length === 0) return ["market_realization"];
  const seen = new Set<string>();
  const families: AxisFamily[] = [];
  for (const shock of shocks) {
    const family = AXIS_TO_FAMILY[shock.axis] ?? (shock.axis as unknown as AxisFamily);
    if (seen.has(family)) continue;
    seen.add(family);
    families.push(family);
  }
  return families;
}

/** "the ETH mark" / "the stablecoin marks and the borrow rate". */
export function axisFamilyWords(families: readonly AxisFamily[]): string {
  const words = families.map((family) => AXIS_FAMILY_WORDS[family] ?? family);
  if (words.length <= 1) return words[0] ?? "no axis";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Coverage — STRUCTURAL, from the committed listing, before any run.
// ---------------------------------------------------------------------------

export interface CellCoverage {
  covered: boolean;
  families: AxisFamily[];
  /** The full sentence a not-covered cell carries in its title. */
  reason: string;
}

/**
 * Whether a committed scenario's model reaches an engine's factor space.
 *
 * The predicate is `engine ∈ scenario.engines` — the contract's own structural
 * fact, published on the COLD listing and therefore knowable with zero runs.
 * `axisFamilies()` supplies the reason's vocabulary: WHICH factor space the
 * scenario moves, so a reader learns why the cell is empty instead of only
 * that it is.
 *
 * This function never sees a run outcome. Not-covered can never be inferred
 * from a failure — a failed run is a failure, and has its own state.
 */
export function scenarioCoverage(
  scenario: Pick<ScenarioDefinition, "id" | "engines" | "shocks">,
  engine: string,
): CellCoverage {
  const families = axisFamilies(scenario.shocks);
  const covered = scenario.engines.includes(engine);
  const definedFor = scenario.engines.length === 0 ? "no engine" : scenario.engines.join(", ");
  return {
    covered,
    families,
    reason: covered
      ? `${scenario.id} is defined for ${engine}; it moves ${axisFamilyWords(families)}.`
      : `NOT COVERED · ${scenario.id} moves ${axisFamilyWords(families)} and is defined for ` +
        `${definedFor}. ${engine} is outside this scenario's model: a property of the committed ` +
        `DEFINITION, not a refusal and not a failed run.`,
  };
}

/** Matrix columns: every engine any committed scenario names, in wire order. */
export function matrixColumns(
  scenarios: readonly Pick<ScenarioDefinition, "engines">[],
): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const scenario of scenarios) {
    for (const engine of scenario.engines) {
      if (seen.has(engine)) continue;
      seen.add(engine);
      columns.push(engine);
    }
  }
  return columns;
}

// ---------------------------------------------------------------------------
// ROW COVERAGE — the cells a row actually draws (Wave R11, Codex round-19).
// ---------------------------------------------------------------------------

/**
 * The engines each committed row is DEFINED for, keyed by scenario id.
 *
 * It is the same `engines[]` `scenarioCoverage()` answers `covered: true` for,
 * gathered once so the batch cohort can ask at ROW level the question the cells
 * already answer cell by cell: is there anything here to display?
 */
export type RowCoverage = ReadonlyMap<string, readonly string[]>;

/** The committed listing, folded into the lookup the cohort builder reads. */
export function rowCoverage(
  scenarios: readonly Pick<ScenarioDefinition, "id" | "engines">[],
): RowCoverage {
  return new Map(scenarios.map((scenario) => [scenario.id, scenario.engines]));
}

/** No committed definitions supplied at all — see `isAllHoleBook`. */
export const NO_ROW_COVERAGE: RowCoverage = new Map();

/**
 * AN ALL-HOLE BOOK: a 200 that names NOT ONE of the row's covered engines —
 * neither in `engines[]` nor in `excluded_engines[]` (Wave R11, Codex round-19).
 *
 * THE DEFECT THIS CLOSES. The cohort builder treated every `kind: "ok"` outcome
 * as a DISPLAYED result, because the envelope carried a batch. But `cellState`
 * already renders a covered engine that appears in NEITHER array as UNANSWERED
 * — "this surface will not fill a hole with a zero" — and the contract permits
 * such a body: neither array carries `minItems`, and `runBookScenario` does no
 * cross-field validation. So a 200 with both arrays empty painted EVERY cell of
 * the row UNANSWERED while the builder minted a displayed pin and a current
 * cohort, and the header announced "results shown together were measured at
 * batch #N. Every DISPLAYED result was measured at that batch." above ZERO
 * displayed results. Header and cells contradicted — the exact degraded-response
 * class this surface otherwise fails closed on.
 *
 * THE RULE: ROW PRESENTATION DERIVES FROM ACTUAL CELL COVERAGE, never from
 * envelope presence. A row whose covered cells ALL fall in the hole displays
 * nothing, so it pins no batch, joins no cohort, and — see `anchorBatchOfPhase`
 * — raises neither the anchor nor the watermark.
 *
 * A row covered for NO engine folds in here by the same arithmetic and for the
 * same reason: it draws no covered cell anywhere on this table, so its book
 * displays nothing either and must not speak for a cohort.
 *
 * `covered === undefined` means THE CALLER SUPPLIED NO DEFINITION for this row.
 * Nothing is inferred from the response alone — a book cannot testify to which
 * engines a scenario is defined for — so the row keeps the pre-R11 reading
 * rather than being guessed at in either direction. `LabMatrix` supplies every
 * row it renders; the specs that omit it are pinning other behaviour.
 */
export function isAllHoleBook(
  response: LabRunBook,
  covered: readonly string[] | undefined,
): boolean {
  if (covered === undefined) return false;
  return !covered.some(
    (engine) =>
      response.engines.some((served) => served.engine === engine) ||
      response.excluded_engines.some((refusal) => refusal.engine === engine),
  );
}

// ---------------------------------------------------------------------------
// WAVE R14, FINDING 2 — THE HOLE, AT CELL GRANULARITY, FOR THE DETAIL VIEW.
//
// `isAllHoleBook` answers the ROW's question (does this book display anything at
// all?). The detail panel needs the same predicate one cell at a time, because
// the sentence it was rendering is a claim about EVERY covered engine:
//
//   "excluded engines: none — every engine's book reached the run"
//
// It was gated on `excluded_engines.length === 0` alone, which is not that
// claim and does not imply it. A book that serves ONE of two covered engines
// and refuses neither satisfies the gate exactly — and the engine it never
// mentioned reads UNANSWERED in the matrix directly above, its cell saying "the
// run returned neither a result nor a refusal". Two mutually exclusive
// statements, one screen. (The ALL-HOLE case is the same defect at its limit,
// and R13b's banner had already promised "the outcome below says so in its own
// words" over a panel that said the opposite.)
//
// `covered === undefined` INFERS NOTHING, exactly as `isAllHoleBook` does: a
// caller that cannot say which engines the definition covers cannot accuse the
// book of missing any, so the pre-R14 reading stands. `LabBookPanel` supplies it
// for the only response it renders.
// ---------------------------------------------------------------------------

/**
 * The row's covered engines this book named in NEITHER array — the HOLE.
 *
 * Same membership test as `isAllHoleBook`, per engine instead of per row, so
 * the cell's sentence and the panel's sentence can never disagree about which
 * engines fell in it.
 */
export function bookHoleEngines(
  response: LabRunBook,
  covered: readonly string[] | undefined,
): string[] {
  if (covered === undefined) return [];
  return covered.filter(
    (engine) =>
      !response.engines.some((served) => served.engine === engine) &&
      !response.excluded_engines.some((refusal) => refusal.engine === engine),
  );
}

/**
 * Whether "every engine's book reached the run" is a TRUE thing to say here.
 *
 * Both halves of the sentence, because the sentence asserts both: nothing was
 * refused, AND no covered engine was left unmentioned. One predicate for one
 * claim, so the claim cannot be rendered from half its condition.
 */
export function bookReachedEveryCoveredEngine(
  response: LabRunBook,
  covered: readonly string[] | undefined,
): boolean {
  return response.excluded_engines.length === 0 && bookHoleEngines(response, covered).length === 0;
}

// ---------------------------------------------------------------------------
// WAVE R12, FINDING 1 — A BOOK THAT CONTRADICTS ITSELF IS NOT A BOOK TO READ.
//
// THE DEFECT. `cellState` asked `engines[]` first and `excluded_engines[]`
// second, so an engine named in BOTH arrays rendered its numeric RESULT here
// while the SAME response rendered it WITHHELD, refusal code and all, in the
// detail view. Nothing forbids that body: the contract puts no `uniqueItems` on
// either array and no cross-field rule between them, and `runBookScenario` does
// no validation of its own. R11's tests exercised served membership and refused
// membership SEPARATELY and never together, so the precedence was never asked
// the one question it answers wrongly.
//
// THE RULE: THE BODY IS VALIDATED BEFORE ANYTHING IS CLASSIFIED. A duplicate
// engine name WITHIN either array, or ANY overlap between the two, makes the
// response INVALID FOR PRESENTATION — not partially invalid. A body that
// answers one cell two ways has no authority over any of its cells, because
// nothing in it says which answer it meant, and picking the first would be this
// surface choosing a number the response never chose. So: no cell, no pin, no
// cohort, no anchor and no watermark movement, and the SAME refusal-to-classify
// in the header, in the cells and in the detail view.
//
// IT IS NOT THE ALL-HOLE STATE (R11) AND MAY NEVER BORROW ITS SENTENCE. "The
// book named nobody" would be a false account of a body that named somebody
// TWICE. Different failure, different set, different words.
// ---------------------------------------------------------------------------

/** "debt_manager" / "aave_v3_etherfi and debt_manager". */
function engineWords(engines: readonly string[]): string {
  if (engines.length <= 1) return engines[0] ?? "no engine";
  return `${engines.slice(0, -1).join(", ")} and ${engines[engines.length - 1] ?? ""}`;
}

/** The names appearing more than once, deduped, in first-repeat order. */
function repeatedNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  return [...repeated];
}

/**
 * The way a served body contradicts itself, named — or null when it does not.
 *
 * `reason` is the ONE sentence the header, the cells and the detail view all
 * render. One vocabulary, composed once, so the three can never drift into
 * disagreeing about a response none of them may read.
 */
export interface BookContradiction {
  kind: "served-and-withheld" | "named-twice-served" | "named-twice-withheld";
  /** The engine names at fault, deduped, in the body's own order. */
  engines: string[];
  reason: string;
}

/**
 * Validate a served run-book body against itself, BEFORE any classification.
 *
 * Overlap is checked first because it is the finding's own case and the one
 * that produced two different renderings of one cell; the within-array
 * duplicates follow. Every arm names the engines it caught, so the sentence is
 * a statement about a set the reader can point at in the response.
 */
export function bookContradiction(response: LabRunBook): BookContradiction | null {
  const served = response.engines.map((engine) => engine.engine);
  const withheld = response.excluded_engines.map((refusal) => refusal.engine);

  const both = [...new Set(served.filter((engine) => withheld.includes(engine)))];
  if (both.length > 0) {
    return {
      kind: "served-and-withheld",
      engines: both,
      reason:
        `THE SERVED BOOK CONTRADICTS ITSELF: ${engineWords(both)} is named in BOTH engines[] ` +
        `and excluded_engines[]: served and withheld at once, in one response. A body that ` +
        `answers a cell two ways answers it no way, and nothing in it says which answer it ` +
        `meant. No cell, no pin, no cohort.`,
    };
  }

  const twiceServed = repeatedNames(served);
  if (twiceServed.length > 0) {
    return {
      kind: "named-twice-served",
      engines: twiceServed,
      reason:
        `THE SERVED BOOK CONTRADICTS ITSELF: ${engineWords(twiceServed)} is named TWICE in ` +
        `engines[]: two results offered for one cell, and nothing in the body says which is ` +
        `the answer. Rendering the first would be this surface choosing a number the response ` +
        `never chose. No cell, no pin, no cohort.`,
    };
  }

  const twiceWithheld = repeatedNames(withheld);
  if (twiceWithheld.length > 0) {
    return {
      kind: "named-twice-withheld",
      engines: twiceWithheld,
      reason:
        `THE SERVED BOOK CONTRADICTS ITSELF: ${engineWords(twiceWithheld)} is named TWICE in ` +
        `excluded_engines[]: two refusals offered for one cell, and nothing in the body says ` +
        `which register it meant. No cell, no pin, no cohort.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// WAVE R12, FINDING 2 — THE JOIN IS BOUND TO IDENTITY, NOT TO AN ID.
//
// THE DEFECT. Coverage came from the committed listing held in the browser;
// every stored run phase was joined to it by SCENARIO ID ALONE. Across an API
// deployment mid-session those are two different definitions wearing one name:
// a v1 listing covering `debt_manager` stays in the tab while a valid v2
// response for the same id covers only `aave_v3_etherfi`. Both responses are
// individually correct. The unguarded cross-request join is what manufactures
// the wrong answer — R11 then reads the v2 book against v1 coverage, finds the
// v1 engine named nowhere, and declares the row ALL-HOLE ("the book named
// nobody") while the detail view renders the real aave result sitting right
// there in the same response.
//
// THE RULE: A RESPONSE IS CLASSIFIED ONLY AGAINST THE DEFINITION IT WAS
// COMPUTED FOR. The listing publishes `scenario_config_version` for the set and
// `version` per scenario; the run-book response publishes `scenario_id`,
// `scenario_version` and `scenario_config_version` for itself (verified against
// the generated schema, not assumed). All three must agree with the coverage
// source before an outcome is classified or pinned. On disagreement the row
// gets its own named state — DEFINITION CHANGED — and no cell, no pin, no
// cohort, no anchor movement.
//
// THE STATE IS DERIVED, NOT STORED, and that is strictly the stronger reading:
// a flag written at store time goes stale the instant the listing is refreshed,
// whereas this re-evaluates against whatever listing the page is currently
// showing. Refresh to v2 and the v2 response classifies honestly, against the
// coverage it was actually computed for. Nothing is re-run to make that happen.
//
// AN ABSENT IDENTITY ENTRY INFERS NOTHING, exactly as R11's absent coverage
// does: a caller that supplied no identity source is not making a claim about
// identity, and a response cannot testify to which definition the page holds.
// ---------------------------------------------------------------------------

/** What names one committed definition: the id, its version, and the set's. */
export interface ScenarioIdentity {
  scenarioId: string;
  version: string;
  configVersion: string;
}

/** The committed listing's identity, keyed by scenario id. */
export type RowIdentity = ReadonlyMap<string, ScenarioIdentity>;

/** No identity supplied at all — nothing is inferred; see `definitionSkew`. */
export const NO_ROW_IDENTITY: RowIdentity = new Map();

/**
 * `GET /v1/scenarios` folded into the identity source the join reads.
 *
 * `configVersion` is the response's own `scenario_config_version` — the set's
 * token, published once for the whole listing — and each row carries its own
 * `version` beside it. Both are needed: the set can be re-versioned without a
 * given scenario changing, and a scenario can change inside a set whose token
 * a deployment forgot to move.
 */
export function rowIdentity(
  scenarios: readonly Pick<ScenarioDefinition, "id" | "version">[],
  configVersion: string,
): RowIdentity {
  return new Map(
    scenarios.map((scenario) => [
      scenario.id,
      { scenarioId: scenario.id, version: scenario.version, configVersion },
    ]),
  );
}

/** The identity a run-book response publishes about ITSELF, from the wire. */
export function servedIdentity(response: LabRunBook): ScenarioIdentity {
  return {
    scenarioId: response.scenario_id,
    version: response.scenario_version,
    configVersion: response.scenario_config_version,
  };
}

/** A response — or (Wave R14) an ATTEMPT — disagreeing with the listing. */
export interface DefinitionSkew {
  /**
   * WAVE R14 — WHICH SIDE carries the other identity. The state is one state
   * (this table does not classify the phase, because the definition moved) but
   * the two are not one claim, and above all they do not share a REMEDY:
   *
   *   response  a served book published its own `scenario_*` fields and they
   *             disagree with the listing (R12). The answer is real and is
   *             about another definition, so it becomes readable the moment the
   *             listing catches up: the affordance is a LISTING REFRESH.
   *   attempt   a run that produced no book of its own, judged by the identity
   *             it was DISPATCHED under (R14). Nothing answered, so nothing
   *             will ever become readable: the affordance is a RE-RUN.
   */
  subject: "response" | "attempt";
  /**
   * WAVE R15 — WHETHER THE REQUEST IS STILL OUT. THE SINGLE SOURCE, and the
   * whole point of it living on the skew object rather than being re-derived per
   * surface: the header clause, the matrix row note and the detail view all
   * branch on THIS field, so they cannot give a reader three accounts of one
   * request.
   *
   * R14 split the definition-changed set by SUBJECT (an answer about another
   * definition versus an attempt under one) and stopped there, which merged two
   * further states under one remedy. A skewed attempt that is STILL IN FLIGHT
   * has not failed at anything: no book has come back because none could have
   * yet. Telling that reader the run "never came back" and to "re-run" is false
   * twice over — and the re-run control is disabled for exactly as long as the
   * sentence is on screen, so it is a dead end besides.
   *
   *   true   the run is still out. Nothing has settled, so nothing is claimed
   *          about what it did or did not do, and NO remedy is offered: the
   *          affordance is to WAIT.
   *   false  the phase has settled — a served body (`response`), or an attempt
   *          that ended without one. R14's remedies stand exactly as written.
   *
   * IT IS NOT THE `inFlightScenarioIds` CLAIM. That set says "this ROW has a run
   * in flight", and a skewed attempt is deliberately absent from it because the
   * run in flight is not this row's. This field says only that the request whose
   * identity does not match has not come back yet.
   */
  pending: boolean;
  /** The identity the page is currently SHOWING for this row. */
  listing: ScenarioIdentity;
  /**
   * The identity on the OTHER side of the join, as the deployment served it:
   * for a `response`, the identity the run-book body published for itself; for
   * an `attempt`, the identity `GET /v1/scenarios` was serving for this row at
   * the moment the run was dispatched, stamped onto the phase there and then.
   */
  served: ScenarioIdentity;
  /** Which wire fields disagree, in the order they are checked. */
  fields: ("scenario_id" | "scenario_version" | "scenario_config_version")[];
  reason: string;
}

/**
 * The wire fields on which two identities disagree, in the order checked.
 *
 * One comparison, shared by the response join (R12) and the attempt join (R14),
 * so the two can never drift into disagreeing about what "the same definition"
 * means.
 */
function skewFields(
  left: ScenarioIdentity,
  right: ScenarioIdentity,
): DefinitionSkew["fields"] {
  const fields: DefinitionSkew["fields"] = [];
  if (left.scenarioId !== right.scenarioId) fields.push("scenario_id");
  if (left.version !== right.version) fields.push("scenario_version");
  if (left.configVersion !== right.configVersion) fields.push("scenario_config_version");
  return fields;
}

/**
 * Whether this response may be classified against this row's definition.
 *
 * Never a partial answer: one disagreeing field is enough, because a definition
 * is the whole of its identity and "mostly the same scenario" is not a thing a
 * risk surface may believe.
 */
export function definitionSkew(
  response: LabRunBook,
  identity: ScenarioIdentity | undefined,
): DefinitionSkew | null {
  if (identity === undefined) return null;
  const served = servedIdentity(response);
  const fields = skewFields(served, identity);
  if (fields.length === 0) return null;
  return {
    subject: "response",
    // A body in hand is a settled phase by construction — there is a response to
    // read the identity off. Stated rather than left to the reader to infer.
    pending: false,
    listing: identity,
    served,
    fields,
    reason:
      `DEFINITION CHANGED · this scenario's committed definition changed after this page ` +
      `loaded (${fields.join(", ")} disagree). The listing this page is showing reads ` +
      `${identity.scenarioId} ${identity.version} at scenario_config_version ` +
      `${identity.configVersion}; the run answered for ${served.scenarioId} ${served.version} ` +
      `at scenario_config_version ${served.configVersion}. Two definitions are not one ` +
      `definition, so a result computed for one is never read against the coverage of the ` +
      `other: no cell, no pin, no cohort. Re-open or refresh the listing to run against the ` +
      `current definition.`,
  };
}

/**
 * THE ONE GATE every read passes through before a served book is classified.
 *
 * ORDER IS DELIBERATE: the body's own validity is decided first, because a body
 * that contradicts itself is invalid whichever definition it belongs to, and
 * saying "your listing moved" about it would send the reader to refresh a
 * listing that was never the problem. Identity is the second question and only
 * gets asked of a body worth asking it of.
 */
export type BookRefusal =
  | { kind: "contradicted"; contradiction: BookContradiction; reason: string }
  | { kind: "definition-changed"; skew: DefinitionSkew; reason: string };

export function bookRefusal(
  response: LabRunBook,
  identity: ScenarioIdentity | undefined,
): BookRefusal | null {
  const contradiction = bookContradiction(response);
  if (contradiction !== null) {
    return { kind: "contradicted", contradiction, reason: contradiction.reason };
  }
  const skew = definitionSkew(response, identity);
  if (skew !== null) return { kind: "definition-changed", skew, reason: skew.reason };
  return null;
}

// ---------------------------------------------------------------------------
// The single-batch guard.
// ---------------------------------------------------------------------------

/**
 * One row's run state, as the matrix holds it.
 *
 * WAVE R8 (Codex round-16 finding 2) — RUNNING IS A PRESENTATION STATE, NOT AN
 * ERASER OF EVIDENCE.
 *
 * THE DEFECT: starting a re-run replaced the row's outcome with a bare
 * `{kind:"running"}`, which deleted the batch that row was pinned to. When the
 * re-run row happened to hold the NEWEST batch — the cohort ANCHOR — the anchor
 * fell back to an older batch for the whole in-flight window, and every
 * previously-SUPERSEDED row silently repainted as a current RESULT. A failed or
 * unanswered re-run left them that way indefinitely, under a header sentence
 * naming the older batch as the one every visible result was measured at.
 *
 * `held` keeps the row's evidence attached for exactly as long as the request
 * is in flight. The row still RENDERS as running — that part was never the
 * problem — but the batch it measured keeps vouching for the cohort, so the
 * anchor cannot move backwards and the header stays true throughout.
 */
/**
 * A LATER run that ended WITHOUT a book, with the identity it was ASKED under.
 *
 * WAVE R16 (Codex round-24 finding 1) — THE SETTLEMENT AND THE DISPLAYED BODY
 * ARE TWO DIFFERENT REQUESTS, AND THE PHASE HAD ROOM FOR ONLY ONE OF THEM.
 *
 * THE DEFECT. R8 rules that a re-run which ends without a book gives the held
 * outcome BACK: the retained body occupies `outcome`, and the failure is named
 * beside it in `rerunFailed`. R14 then rules that a phase with no body of its
 * own is judged by the identity it was DISPATCHED under — and, correctly for
 * every case R14 could see, that `attemptSkew` must answer null for a
 * `kind: "ok"` outcome, because a served body is the server's own word about
 * what it computed.
 *
 * Put those two rules on ONE phase and the second reads the first's evidence as
 * its own. After a bodyless settlement over a retained ok book the phase is
 * `{outcome: <an EARLIER request's body>, rerunFailed: <THIS request's failure>}`
 * — and `attemptSkew` saw `outcome.kind === "ok"`, concluded the settlement had
 * spoken for itself, and answered null. The body it deferred to was never the
 * settled request's answer. It belongs to a request that finished before this
 * one was dispatched.
 *
 * So: v1 rerun in flight, listing moves to v2, rerun settles bodyless. The row
 * never entered `settledAttemptScenarioIds`; the header took R12's ANSWER arm
 * over it ("Nothing failed and nothing was withheld", refresh the listing) while
 * the banner one line below said the re-run had ended without a book. R15's
 * fixtures all start from a row with NO held evidence, so this settle shape was
 * never exercised.
 *
 * THE RULE: THE FAILURE CARRIES ITS OWN REQUEST'S IDENTITY. The stamp is bound
 * to the settlement it belongs to rather than left to be inferred from a body
 * that belongs to another one, and the banner and `attemptSkew` read the SAME
 * record — so they cannot give two accounts of one settlement.
 *
 * `reason` is R8's sentence, unmoved and unedited: every pin that asserts that
 * string still asserts exactly that string, one field deeper.
 */
export interface RerunFailure {
  /** The run-outcome sentence for the failure, exactly as R8 composed it. */
  reason: string;
  /**
   * WAVE R16 — the identity the FAILED request was DISPATCHED under.
   *
   * Optional for the reason `MatrixPhase.attempt` is optional: the type must
   * admit an unstamped record transitionally, and an unstamped record infers
   * nothing rather than being guessed at in either direction.
   */
  attempt?: ScenarioIdentity;
}

export type MatrixPhase =
  | { kind: "idle" }
  | {
      kind: "running";
      /**
       * The outcome this row was DISPLAYING when the run started. Not rendered
       * (the cell says "running…"), but it anchors the cohort while the request
       * is in flight and it is what a failed run gives back.
       */
      held?: RunBookOutcome;
      /**
       * WAVE R14 — the identity the row was SHOWING when this request was
       * dispatched. See the block below `attemptSkew`; optional because the
       * type must admit an unstamped phase transitionally, and an unstamped
       * phase infers nothing.
       */
      attempt?: ScenarioIdentity;
    }
  | {
      kind: "outcome";
      outcome: RunBookOutcome;
      /**
       * A LATER run that ended WITHOUT a book, named. `outcome` is still this
       * row's own evidence at its ORIGINAL batch pin: a run that could not
       * answer says nothing about the answer already held, so the failure is
       * disclosed BESIDE the result rather than overwriting it.
       *
       * WAVE R16 — a RECORD rather than a bare sentence, because when this
       * field is set `outcome` is a DIFFERENT request's body and nothing else
       * on the phase can say what the settled request was asked under. See
       * `RerunFailure`.
       */
      rerunFailed?: RerunFailure;
      /** WAVE R14 — the identity this attempt was dispatched under. */
      attempt?: ScenarioIdentity;
    };

// ---------------------------------------------------------------------------
// WAVE R14, FINDING 1 — EVERY PHASE IS BOUND TO THE IDENTITY IT WAS ASKED UNDER.
//
// THE DEFECT. R13 restricted the cohort to the rows the table RENDERS by
// filtering `phases` through the current listing (`listedPhases`), and that
// filter is keyed — as the map itself is — BY SCENARIO ID ALONE. A row that
// leaves the listing is correctly dropped; a row that COMES BACK is re-admitted
// on the strength of its id, whatever the definition behind that id has become.
//
// For a `kind: "ok"` outcome that is harmless, because the RESPONSE carries its
// own identity: R12's `bookRefusal` reads `scenario_id` + `scenario_version` +
// `scenario_config_version` off the wire and refuses the join itself. But a
// RUNNING phase and a NON-OK outcome carry NO identity at all. There is no body
// to read one off, and nothing else in the phase remembers which definition the
// row was showing when the run was dispatched.
//
// So: v1 is listed and run; the run fails (404, 503, or no HTTP response at
// all); the deployment stops publishing the scenario, the reader refreshes, and
// R13 correctly drops the orphan; the deployment republishes the scenario RE-CUT
// as v2, the reader refreshes again — and the v1 failure walks back onto the v2
// row. It renders there as RUNNING or as UNANSWERED, and the header counts the
// v2 row among the rows this session ASKED ABOUT, though v2 was never asked
// anything. That breaks R13's own promise in the sentence it made it in: a
// returning row classifies "as itself, or as DEFINITION CHANGED".
//
// THE RULE: A PHASE IS STAMPED, AT DISPATCH, WITH THE IDENTITY THE ROW WAS
// SHOWING. `LabBookPanel.run()` holds the listing when it fires the request, so
// the stamp is the same triple R12 joins on, from the same source, taken at the
// only moment it is unambiguous. A phase with no body of its own is then judged
// by that stamp: if it disagrees with the identity the listing is showing NOW,
// the attempt is not this row's attempt. It is counted in the definition-changed
// set, rendered in the DEFINITION CHANGED register, and counted in NEITHER
// `attemptedScenarioIds`, `inFlightScenarioIds` NOR `unansweredScenarioIds` —
// because every one of those is a claim about a run issued for the row the
// reader is looking at.
//
// THE OK PATH IS NOT DOUBLE-GATED, and the reason is a rule about authority. A
// served body publishes its own identity, and that is the SERVER'S WORD about
// what it computed. The two CAN disagree — the reader runs under v1 against a
// deployment that has already moved to v2, then refreshes to v2 — and where they
// do, the body wins: `attemptSkew` answers null for every `kind: "ok"` outcome,
// `bookRefusal` alone decides, and the row classifies exactly as R12's refresh
// path promises ("the moment the listing it was computed against is the one on
// screen"). One response, one register, from one gate — never two.
//
// AN UNSTAMPED PHASE INFERS NOTHING. `attempt` is optional on the type: nothing
// this wave ships writes a phase without it, but the type admits one
// transitionally, and such a phase keeps its PRE-R14 reading rather than being
// guessed at in either direction. That is the same discipline R11 gave absent
// coverage and R12 gave absent identity — a caller that supplied no identity is
// not making a claim about identity.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WAVE R16, FINDING 1 — "A BODY OF ITS OWN" MEANS THE SETTLED REQUEST'S OWN
// BODY, AND A RETAINED ONE IS NOT THAT.
//
// THE DEFECT, IN ONE LINE: `attemptSkew` read `outcome.kind === "ok"` as proof
// that the settlement had spoken for itself, and over an R8 keep-held-evidence
// settle that body belongs to an EARLIER request. See `RerunFailure` for the
// sequence and what it cost the header.
//
// THE READ IS NOW OF THE SETTLEMENT, NOT OF THE DISPLAY. `settledUnder` below
// answers one question — "which request settled this phase, and did it come back
// with a body this surface presents?" — and every surface reads `attemptSkew`
// off that one answer, exactly as R15 made them all read `pending` off one flag.
//
// AND R14's AUTHORITY RULE SURVIVES INTACT, sharpened rather than weakened:
//
//   A BODY THIS SURFACE PRESENTS STILL OUTRANKS A STAMP. When the retained
//   response is one `bookRefusal` lets through, the row DISPLAYS it — cells,
//   pin, cohort, detail — and a later request that answered nothing may not take
//   it off the table. That is R8's own law ("a run that could not answer says
//   nothing about the answer already held"), and honouring it here is why the
//   settlement's stale stamp is NOT allowed to blank a displayed result. Such a
//   row keeps R12's classification of its body and R8's disclosure of its
//   failure, which between them say every true thing there is to say about it.
//
//   A BODY THIS SURFACE REFUSES PRESENTS NOTHING, so it has nothing to outrank
//   anything with. The row displays no result either way; the only thing it has
//   left to be judged by is the identity the settled request was ASKED under —
//   which is R14's rule arriving exactly where R14 aimed it.
//
// THE GATE IS SCOPED TO THE `rerunFailed` CASE ALONE. A settled phase whose OWN
// outcome is the ok body is untouched, refused or not: that is R14's
// "THE OK PATH IS NOT DOUBLE-GATED", and it stays not-double-gated. What changed
// is only that a phase holding TWO requests is no longer allowed to answer for
// one of them with the other's evidence.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WAVE R17, CODEX ROUND 25 — `attemptSkew`'s NULL WAS ANSWERING TWO QUESTIONS,
// AND ONE OF THE TWO ANSWERS WAS THE INVERSE OF R16's FINDING.
//
// THE DEFECT, AS A SEQUENCE. A clean v1 book is held. The listing refreshes to
// v2. The row is re-run — DISPATCHED UNDER v2, the definition on screen — and
// that request settles BODYLESS, so R8 gives the v1 body back beside the
// failure. `settledUnder` read the settlement correctly: the attempt is v2. It
// MATCHES the current listing, `skewFields` is empty, and `attemptSkew` answered
// null.
//
// AND NULL MEANT "DEFER TO THE RETAINED BODY". That body is the v1 one, which
// `bookRefusal` refuses under a v2 listing — so every surface classified the ROW
// as R12's ANSWER half. The cells read DEFINITION CHANGED about the RESPONSE;
// the header said "Nothing failed and nothing was withheld … refresh the
// listing" over a listing that is ALREADY v2, so the remedy resolves nothing;
// and the banner one line below said the re-run had failed. Header and banner
// gave two accounts of one row and neither was the true one:
//
//   THE CURRENT-DEFINITION ATTEMPT FAILED, AND IT SERVED NO BOOK.
//
// R16 closed the case where the settlement's stamp DISAGREES with the listing.
// This is the case where it AGREES — and R16's null could not tell that apart
// from "there is nothing attempt-shaped to say about this row at all".
//
// THE RULE: SETTLEMENT DISPOSITION IS NOT SKEW, AND IT GETS ITS OWN ANSWER.
// `settlementOf` answers with one of THREE dispositions, so no surface has to
// infer a second meaning out of an absent first one:
//
//   defer             nothing attempt-shaped to say. Either nothing was asked
//                     (`idle`), or nothing was recorded (an unstamped phase or
//                     failure record, or a caller claiming no listing identity),
//                     or the settlement came back with a body THIS SURFACE
//                     PRESENTS — in which case the body's own published identity
//                     decides the row and `bookRefusal` is the only gate it
//                     passes through. R8's law lives in that last arm: a request
//                     that answered nothing may not take a displayed measurement
//                     off the table, so a PRESENTED retained body still outranks
//                     a stamp, exactly as R16 ruled it.
//
//   attempt-skew      the settlement's attempt disagrees with the current
//                     listing. R14's finding, R15's partition and R16's
//                     settlement read, all unchanged: the row is DEFINITION
//                     CHANGED about the ATTEMPT, counted in the R14 family, and
//                     counted in none of `attempted` / `inFlight` / `unanswered`.
//
//   current-bodyless  the settlement's attempt MATCHES the current listing, the
//                     settlement was BODYLESS, and the body it retained is one
//                     this surface REFUSES (`bookRefusal` non-null — response-
//                     skewed, or contradictory). There is no skew to report and
//                     there is no body to present, so the row's whole truth is
//                     that THIS row's CURRENT attempt served no book. That is
//                     UNANSWERED — the register that already exists for exactly
//                     that truth — and R14's family is deliberately NOT used,
//                     because nothing about this row's definition changed for
//                     this attempt.
//
// THE RETAINED BODY IS STILL DISCLOSED, never displayed and never impersonating
// the settlement: `rerunFailedBanner` names it by its own refusal register in
// its own arm ("what this row still holds…"), and the row's UNANSWERED sentence
// names it too. What it no longer does is DECIDE the row.
//
// THE BOUNDARIES, STATED SO THEY ARE NOT MISTAKEN FOR OVERSIGHTS:
//
//   A PRESENTED RETAINED BODY KEEPS R16 VERBATIM. `bookRefusal` null over a
//   presentable book defers, the row displays its result at its own batch pin,
//   and R8's banner wording is untouched. A presented body still outranks.
//
//   AN ALL-HOLE RETAINED BODY IS NOT IN SCOPE, and does not need to be.
//   `bookRefusal` answers null for it, so it defers — and it already tells the
//   truth on every surface: the cells read UNANSWERED (R11), the header counts
//   it in `allHoleScenarioIds` with its own sentence, and the banner's
//   `all-hole` arm refuses to call it a measurement (R13b). Nothing there says
//   "nothing failed", and nothing there names a refresh.
//
//   AN UNSTAMPED FAILURE, OR NO LISTING IDENTITY, INFERS NOTHING. "The attempt
//   MATCHES the current listing" is a claim that needs both sides in hand; with
//   either missing the phase keeps its pre-R17 reading. That is the discipline
//   R11 gave absent coverage, R12 absent identity, R14 an unstamped phase and
//   R16 an unstamped failure record, applied once more rather than bent once.
// ---------------------------------------------------------------------------

/**
 * WHICH REQUEST SETTLED THIS PHASE, and what that leaves the row to be judged by.
 *
 * Three arms because there are three truths. See the block above for why the two
 * that used to share one `null` are not one truth.
 */
export type Settlement =
  | {
      /**
       * NOTHING ATTEMPT-SHAPED TO SAY. The row is judged by its BODY — by
       * `bookRefusal` and the reads below it — or, when it has none, by the
       * pre-R14 reading of the phase it is.
       */
      disposition: "defer";
    }
  | {
      /**
       * THE SETTLEMENT WAS ASKED UNDER A DEFINITION THIS PAGE NO LONGER SHOWS.
       * R14's state, R15's `pending` partition, R16's settlement read.
       */
      disposition: "attempt-skew";
      skew: DefinitionSkew;
    }
  | {
      /**
       * THE SETTLEMENT IS THIS ROW'S OWN ATTEMPT, IT CAME BACK WITH NO BOOK, AND
       * THE BODY IT RETAINED IS ONE THIS SURFACE REFUSES TO PRESENT.
       *
       * The row is UNANSWERED under the current definition. It is NOT in R14's
       * family: nothing about this row's definition changed for this attempt,
       * and saying it did would send the reader to a remedy for a problem the
       * row does not have.
       */
      disposition: "current-bodyless";
      /** The identity BOTH the settlement and the listing carry — they agree. */
      attempt: ScenarioIdentity;
      /** The failure record the settlement wrote — R8's sentence, and its stamp. */
      failure: RerunFailure;
      /** Why the RETAINED body presents nothing. Disclosed, never displayed. */
      retained: BookRefusal;
      /** The row's whole sentence, composed once and rendered by every surface. */
      reason: string;
    };

/** The common answer, allocated once rather than per read. */
const DEFER: Settlement = { disposition: "defer" };

/**
 * The row's sentence for a CURRENT-DEFINITION BODYLESS FAILURE (Wave R17).
 *
 * TWO FACTS, NEITHER BORROWED FROM THE OTHER — this file's habit since R13. The
 * settled request is this row's own and it served no book; and what the row
 * still holds is an earlier response this surface refuses, named by the SAME
 * register the banner uses for it, so a reader meets one vocabulary for one
 * response wherever they look.
 *
 * NO REMEDY IS NAMED. The run control beside the row is live (the row is not
 * running) and that is the affordance; a re-run may or may not resolve a 404
 * from a deployment that does not serve run-book, and this surface does not
 * promise remedies it cannot keep. A LISTING REFRESH IS NAMED NOWHERE, because
 * the listing this attempt was asked under is the one on screen.
 */
function currentBodylessReason(failure: RerunFailure, retained: BookRefusal): string {
  return (
    `this row's CURRENT attempt served no book. ${failure.reason} That request was ASKED ` +
    `under the definition this page IS showing, so it IS this row's attempt and there is no ` +
    `skew to report: it simply came back with nothing, which is neither a zero nor a “not ` +
    `run”. What this row still holds is an EARLIER response this surface REFUSES to present ` +
    `(${CELL_STATE_LABEL[retained.kind]}), retained at its own batch pin, disclosed in its ` +
    `own banner, displayed nowhere, and never this attempt's answer.`
  );
}

/**
 * R14's DEFINITION-CHANGED sentence for an ATTEMPT, composed from one read.
 *
 * Lifted out of `attemptSkew` by R17 unchanged, so the wording every R14/R15/R16
 * pin asserts is asserted from the same one place it always was.
 */
function attemptSkewOf(
  attempt: ScenarioIdentity,
  identity: ScenarioIdentity,
  fields: DefinitionSkew["fields"],
  inFlight: boolean,
): DefinitionSkew {
  return {
    subject: "attempt",
    // WAVE R15 — THE SAME `inFlight` THE REASON BELOW BRANCHES ON, PUBLISHED.
    // R14 computed this distinction, said the true thing about it in the CELL,
    // and then let every other surface re-derive it or ignore it: the cohort
    // merged both states into one count, so the header told a reader whose
    // request was still out that it "never came back" and to re-run — while the
    // run controls were disabled waiting for that very request. Publishing the
    // flag is what makes the header, the row note and the detail view read from
    // one source.
    pending: inFlight,
    listing: identity,
    served: attempt,
    fields,
    reason:
      `DEFINITION CHANGED · this attempt belongs to a definition this page is no longer ` +
      `showing (${fields.join(", ")} disagree). The run was DISPATCHED against ` +
      `${attempt.scenarioId} ${attempt.version} at scenario_config_version ` +
      `${attempt.configVersion}; the listing this page is showing reads ${identity.scenarioId} ` +
      `${identity.version} at scenario_config_version ${identity.configVersion}. ` +
      `${inFlight ? "No book has come back from it" : "No book came back from it"}, so the ` +
      `identity it was ASKED under is the only identity it has, and that is not this row's. ` +
      `It is therefore not this row's attempt: no cell, no pin, no cohort, and it is counted ` +
      `as neither in flight nor unanswered here. ` +
      (inFlight
        ? `The request is still out; whatever it answers will be judged by the identity the ` +
          `response publishes for ITSELF.`
        : `Re-run this row to ask under the definition this page is showing.`),
  };
}

/**
 * The disposition of a settlement that has NO body of its own to be judged by.
 *
 * `bodyless` is non-null only for the one shape R17 names: a BODYLESS settlement
 * sitting beside a RETAINED body this surface refuses. It is what separates
 * "this row's attempt matched and there is simply nothing to report" (defer)
 * from "this row's attempt matched, and it failed with nothing to show for it".
 */
function judgeAttempt(
  attempt: ScenarioIdentity | undefined,
  identity: ScenarioIdentity | undefined,
  inFlight: boolean,
  bodyless: { failure: RerunFailure; retained: BookRefusal } | null,
): Settlement {
  // NOTHING WAS CLAIMED, OR NOTHING WAS RECORDED — infer nothing, in either
  // direction. R11's absent coverage, R12's absent identity, R14's unstamped
  // phase, R16's unstamped failure record: the same rule, once more.
  if (identity === undefined || attempt === undefined) return DEFER;
  const fields = skewFields(attempt, identity);
  if (fields.length > 0) {
    return { disposition: "attempt-skew", skew: attemptSkewOf(attempt, identity, fields, inFlight) };
  }
  // THE ATTEMPT IS THIS ROW'S. Whether that is worth saying anything about
  // depends on what the settlement came back with — which is the question R16's
  // null could not ask.
  if (bodyless === null) return DEFER;
  return {
    disposition: "current-bodyless",
    attempt,
    failure: bodyless.failure,
    retained: bodyless.retained,
    reason: currentBodylessReason(bodyless.failure, bodyless.retained),
  };
}

/**
 * THE ONE SETTLEMENT READ every surface makes — cells, cohort, banner, detail.
 *
 * R16 established that the question is about the SETTLEMENT and not about the
 * display; R17 establishes that it has three answers rather than two. Every
 * surface branches on `disposition` and none of them re-derives it.
 */
export function settlementOf(
  phase: MatrixPhase,
  identity: ScenarioIdentity | undefined,
): Settlement {
  if (phase.kind === "idle") return DEFER;
  if (phase.kind === "running") return judgeAttempt(phase.attempt, identity, true, null);
  const failure = phase.rerunFailed;
  if (failure !== undefined) {
    // WAVE R16 — THE SETTLEMENT IS THE FAILED RE-RUN, and `outcome` beside it is
    // an EARLIER request's body.
    const retained =
      phase.outcome.kind === "ok" ? bookRefusal(phase.outcome.response, identity) : null;
    // A body this surface PRESENTS keeps the row (R8): a run that could not
    // answer says nothing about the answer already held, so the settlement's
    // stamp is not allowed to blank a displayed result.
    if (phase.outcome.kind === "ok" && retained === null) return DEFER;
    // WAVE R17 — a body it REFUSES presents nothing, so the settled request's
    // own stamp is all the row has. Skewed, that is R16's DEFINITION CHANGED;
    // MATCHING, it is this row's own attempt and it served no book.
    return judgeAttempt(
      failure.attempt,
      identity,
      false,
      retained === null ? null : { failure, retained },
    );
  }
  // R14, VERBATIM: this phase's own outcome IS its settlement, and a served body
  // publishes the identity it was computed for.
  if (phase.outcome.kind === "ok") return DEFER;
  return judgeAttempt(phase.attempt, identity, false, null);
}

/**
 * Whether this phase's ATTEMPT belongs to the definition the row is showing.
 *
 * It is `settlementOf`'s `attempt-skew` arm and NOTHING ELSE, which is exactly
 * the contract R14, R15 and R16 pinned: a `DefinitionSkew` when the settlement
 * was asked under a definition this page no longer shows, and null otherwise.
 *
 * WAVE R17 — NULL HERE NO LONGER MEANS "DEFER". It means only "there is no skew",
 * which is true of a `defer` phase AND of a `current-bodyless` one — two states
 * this function is deliberately not the reporter of. A surface that needs to
 * know which of them it is asks `settlementOf`; a surface that only needs the
 * skew (the row note, the detail's attempt view, the `attemptChanged` flag) asks
 * this, and reads the same answer it always did.
 */
export function attemptSkew(
  phase: MatrixPhase,
  identity: ScenarioIdentity | undefined,
): DefinitionSkew | null {
  const settlement = settlementOf(phase, identity);
  return settlement.disposition === "attempt-skew" ? settlement.skew : null;
}

/**
 * The batch a phase's DISPLAYED result is pinned to — null when it shows none.
 *
 * WAVE R11: pass the row's COVERED ENGINES and an all-hole book answers null
 * too. A book that named none of them displays no cell here, and a batch no
 * cell displays is not a pin — it is a number the header would have to claim on
 * an empty row's behalf.
 */
// ---------------------------------------------------------------------------
// WAVE R13, FINDING 1 — THE COHORT SPEAKS ONLY FOR ROWS THE TABLE RENDERS.
//
// THE DEFECT. `phases` is component state keyed by scenario id, and it OUTLIVES
// the listing it was built against. A deployment stops publishing a committed
// scenario; the reader takes the listing-refresh affordance R12 shipped; the row
// leaves the table — and the run phase stored under its id stays behind.
//
// Every guard R11 and R12 added is keyed to that same map by that same id, so
// the orphan slips past BOTH of them BY ABSENCE rather than by merit, and each
// is behaving correctly on its own terms when it lets it through:
//
//   `coverage.get(id)` is undefined, so `isAllHoleBook` declines to infer which
//   engines the row was defined for — a book cannot testify to that — and
//   answers false.
//
//   `identity.get(id)` is undefined, so `definitionSkew` declines to infer which
//   definition the page is showing for the row, and answers null.
//
// Two optional checks, both correctly silent about a row nobody supplied a
// definition for, and between them a response with NO RENDERED ROW AT ALL
// reached `resolveBatchCohort` as a DISPLAYED PIN. When it carried the newest
// batch it took the anchor, marked every VISIBLE result SUPERSEDED, and left the
// header announcing a cohort whose only current member is a row the table does
// not draw. Header and cells contradicted — over a row that does not exist.
//
// THE RULE: A PHASE WHOSE SCENARIO IS NOT IN THE CURRENT LISTING IS NOT THERE.
// It is not refused, and it is not a hole. Those are both statements ABOUT A
// ROW, and there is no row: the thing it described is not on this table. So it
// contributes nothing anywhere — no pin, no anchor, no held pin, no set
// membership, and no clause counting it.
//
// IT IS ENFORCED IN ONE PLACE, ON THE WAY IN, rather than by teaching every
// classifier what absence means. `observedAnchorBatch` and `resolveBatchCohort`
// are the only two functions that range over the WHOLE map — every other read
// is already per-row, from a row the caller is rendering. Filter what those two
// are handed and everything below them is restricted by construction: the
// anchor, the watermark floor the caller derives from the same read, the pins,
// the sets, and every clause composed from the sets.
//
// THE ORPHAN IS FILTERED, NOT PRUNED FROM STATE. See `LabMatrix` for the
// decision and its reasoning; the short form is that a listing read must not
// destroy a measurement, and R12 already established that a stored answer
// becomes readable again the moment the listing it belongs to is on screen.
// ---------------------------------------------------------------------------

/**
 * The phases whose scenario the CURRENT listing still names.
 *
 * Order is preserved deliberately: the cohort's set order and pin order are the
 * map's iteration order, which the unit spec pins with `toEqual` on arrays, so a
 * filter that reshuffled would change answers it has no business changing.
 *
 * WAVE R14 — THIS FILTER IS A MEMBERSHIP TEST AND NOTHING MORE, and that is
 * deliberate rather than an omission. It answers "is there a row for this id",
 * which is the only question `phases` can be asked by id alone; it does NOT
 * answer "is this the same definition", because a delisted-then-RE-LISTED id is
 * a member again whatever the definition behind it has become. Widening the
 * filter to drop a returning phase would erase the fact that something WAS
 * asked, and this table never turns an event into a "not run". The identity
 * question is asked one step later, per row, where both sides are in hand — see
 * `attemptSkew` for a phase with no body and `bookRefusal` for one with a body.
 */
export function listedPhases(
  phases: ReadonlyMap<string, MatrixPhase>,
  scenarios: readonly Pick<ScenarioDefinition, "id">[],
): ReadonlyMap<string, MatrixPhase> {
  const listed = new Set(scenarios.map((scenario) => scenario.id));
  const kept = new Map<string, MatrixPhase>();
  for (const [scenarioId, phase] of phases) {
    if (listed.has(scenarioId)) kept.set(scenarioId, phase);
  }
  return kept;
}

export function batchOfPhase(
  phase: MatrixPhase,
  covered?: readonly string[],
  identity?: ScenarioIdentity,
): number | null {
  if (phase.kind !== "outcome") return null;
  const outcome = phase.outcome;
  if (outcome.kind !== "ok") return null;
  // WAVE R12: a body refused for presentation pins nothing, whatever batch its
  // envelope carried. It is refused BEFORE the all-hole read because a
  // contradictory book usually DOES name somebody — twice — so `isAllHoleBook`
  // would happily answer false and let the phantom pin straight back in.
  if (bookRefusal(outcome.response, identity) !== null) return null;
  return isAllHoleBook(outcome.response, covered) ? null : outcome.response.batch.id;
}

/**
 * The batch a phase's HELD evidence carries — this row's contribution to the
 * cohort WATERMARK, in-flight rows included.
 *
 * It differs from `batchOfPhase` by exactly the re-run window, and that
 * difference IS the fix: a running row displays nothing (so it is neither
 * current nor superseded on screen) while still vouching for the batch it
 * measured (so nothing older can claim to be current in its absence).
 *
 * WAVE R11 — NO DISPLAYABLE EVIDENCE, NO FLOOR MOVEMENT. With the row's covered
 * engines supplied, an ALL-HOLE book carries no anchor batch and therefore
 * cannot raise the anchor OR the watermark the caller derives from this same
 * function. The watermark is a floor under a sentence about DISPLAYED results;
 * letting a book that displays nothing raise it would put that floor under a
 * batch no cell on this table has ever shown, which is the R9/R10 defect class
 * arriving by a new door.
 */
export function anchorBatchOfPhase(
  phase: MatrixPhase,
  covered?: readonly string[],
  identity?: ScenarioIdentity,
): number | null {
  // WAVE R14 — AN ATTEMPT ASKED UNDER ANOTHER DEFINITION HOLDS NOTHING FOR THIS
  // ROW. The clause that counts such a row says it "pins no batch"; letting the
  // evidence behind its in-flight request raise the anchor would make that
  // sentence false in the same breath it is composed. The floor the panel has
  // already learned is NOT lowered by this — R13's rule, for the same reason:
  // what changes is only that this phase can no longer PUT a batch into it.
  //
  // WAVE R17 — AND NEITHER DOES A CURRENT-DEFINITION BODYLESS FAILURE, for the
  // same sentence's sake: that row displays UNANSWERED and pins no batch. It is
  // the SAME answer the refusal read below already gives (the disposition exists
  // only over a retained body `bookRefusal` refuses), stated once here so the
  // two can never come apart if either read is ever widened.
  if (settlementOf(phase, identity).disposition !== "defer") return null;
  const outcome =
    phase.kind === "running"
      ? phase.held
      : phase.kind === "outcome"
        ? phase.outcome
        : undefined;
  if (outcome === undefined) return null;
  if (outcome.kind !== "ok") return null;
  // WAVE R12 — SAME READ AS `batchOfPhase`, and it must stay the same read. A
  // book this table refuses to display may not put a floor under a sentence
  // about displayed results, and held evidence is where that floor comes from.
  if (bookRefusal(outcome.response, identity) !== null) return null;
  return isAllHoleBook(outcome.response, covered) ? null : outcome.response.batch.id;
}

/**
 * The newest batch any row's HELD evidence carries — the number the caller
 * raises its WATERMARK to.
 *
 * It lives here, next to `resolveBatchCohort`, because the two must read the
 * same evidence through the same rule. A watermark computed in the component
 * from a different reading is a floor under a sentence the model never made.
 */
export function observedAnchorBatch(
  phases: ReadonlyMap<string, MatrixPhase>,
  coverage: RowCoverage = NO_ROW_COVERAGE,
  identity: RowIdentity = NO_ROW_IDENTITY,
): number | null {
  let observed: number | null = null;
  for (const [scenarioId, phase] of phases) {
    const batch = anchorBatchOfPhase(phase, coverage.get(scenarioId), identity.get(scenarioId));
    if (batch !== null && (observed === null || batch > observed)) observed = batch;
  }
  return observed;
}

/** One row's tie to one batch: which scenario, which batch id. */
export interface BatchPin {
  scenarioId: string;
  batchId: number;
}

export interface BatchCohort {
  /** The newest batch any HELD result carries — the matrix's own as-of. */
  anchorBatchId: number | null;
  /** Scenario ids whose DISPLAYED result IS the anchor batch. */
  currentScenarioIds: string[];
  /** Scenario ids DISPLAYING a result from an older batch — shown, never mixed. */
  supersededScenarioIds: string[];
  /**
   * Scenario ids with a request IN FLIGHT: displaying nothing, still anchoring
   * whatever they held. They are in neither list above — a running cell shows
   * no result, so counting it as current or as superseded would describe a cell
   * nobody can see.
   */
  inFlightScenarioIds: string[];
  /**
   * WAVE R10 — Scenario ids this session has ASKED ABOUT: every phase past
   * `idle`, whatever it became. It is the ONLY set that may decide whether "no
   * run has been issued yet" is true, because that sentence is a claim about
   * what was ASKED, not about what came back. A first run that is still in
   * flight, and a first run that failed, are both attempts — and the header
   * used to call both of them "not run".
   */
  attemptedScenarioIds: string[];
  /**
   * WAVE R10 — Scenario ids whose RUN ENDED WITHOUT A BOOK: the rows displaying
   * UNANSWERED. They display no result and pin no batch, so they belong to none
   * of the three sets above; they are counted here so the header can say what
   * happened instead of leaving the reader with a sentence about "not run".
   *
   * Row-level, not cell-level: a 200 that dropped ONE engine still displays a
   * result and still pins its batch. That hole is the CELL's sentence to tell.
   */
  unansweredScenarioIds: string[];
  /**
   * WAVE R11 — Scenario ids whose run WAS SERVED A BOOK that named none of the
   * row's covered engines (`isAllHoleBook`). Every covered cell there renders
   * UNANSWERED, so the row displays no result: it pins no batch, joins neither
   * displayed list, and contributes no anchor evidence.
   *
   * They are kept OUT of `unansweredScenarioIds` deliberately. That set's clause
   * says the run "ended without a served result", which would be a false account
   * of a run that ended with a 200 and a batch — the book arrived, and named
   * nobody. Two different failures, two different sentences.
   */
  allHoleScenarioIds: string[];
  /**
   * WAVE R12 — Scenario ids whose run was served a book that CONTRADICTS
   * ITSELF: an engine named twice within an array, or named as served and
   * withheld at once. The body is refused for presentation whole, so the row
   * displays nothing, pins nothing and anchors nothing.
   *
   * Kept OUT of `allHoleScenarioIds` deliberately, and the distinction is the
   * finding: that set's clause says the book "named none of the engines their
   * committed definition covers", which is precisely the wrong account of a
   * book that named one of them TWICE.
   */
  contradictedScenarioIds: string[];
  /**
   * WAVE R12 — Scenario ids whose response answered for a DIFFERENT committed
   * definition than the listing this page is showing (`definitionSkew`). The
   * response may be perfectly valid; it is simply not about the definition the
   * reader is looking at, so it is not classified against it.
   *
   * Also its own set, for its own reason: nothing here failed and nothing was
   * withheld. The row is waiting on a listing refresh, and the header says so
   * rather than folding it into a sentence about books, holes or refusals.
   */
  definitionChangedScenarioIds: string[];
  /**
   * WAVE R14 — the SUBSET of `definitionChangedScenarioIds` whose phase is an
   * ATTEMPT rather than an answer: a run DISPATCHED under a committed definition
   * this page is no longer showing, which came back with no book of its own (or
   * has not come back at all).
   *
   * A subset and not a fourth sibling set, because the state IS the same state —
   * the definition moved, so this table does not classify the phase — and R12's
   * clause counts it there. It is named separately because the REMEDY differs
   * and a reader told the wrong one has been told something false: an ANSWER
   * about another definition becomes readable the moment the listing catches up,
   * so its affordance is a REFRESH; an ATTEMPT under another definition never
   * becomes anything at all, so its affordance is a RE-RUN.
   *
   * WAVE R15 — "never becomes anything at all" is true of a SETTLED attempt and
   * false of one still in flight, so the family is partitioned by the two sets
   * below and the clause reads from those. This set keeps its exact meaning and
   * its exact count: it still answers, alone, "is this row's phase an attempt
   * under a definition this page no longer shows".
   */
  definitionChangedAttemptScenarioIds: string[];
  /**
   * WAVE R15 — the RUNNING half of the attempt family: a skewed run whose
   * request IS STILL OUT.
   *
   * THE SHAPE, AND WHY IT IS THIS ONE. The family above stays the UNION and
   * keeps its meaning byte for byte — it answers "is this row's phase an attempt
   * under a definition this page no longer shows", and that is still one
   * question with one answer. What R14 got wrong was reading a second question
   * off the same count: "so what should the reader DO". Two SUBSETS partition
   * the family without redefining it, so every set-membership pin R14 wrote
   * still holds exactly as written, and the clause gains an arm rather than
   * having its arithmetic re-based.
   *
   * NOTHING HAS FAILED HERE. The request has not come back because it cannot
   * have come back yet — and the two run controls are disabled for precisely as
   * long as it is out, so a sentence sending this reader to re-run points at a
   * button that cannot be clicked. The only true thing to say is that the
   * request is out and that whatever it answers will be judged by the identity
   * the RESPONSE publishes for itself.
   */
  runningAttemptScenarioIds: string[];
  /**
   * WAVE R15 — the SETTLED half: a skewed attempt that ended WITHOUT a book of
   * its own (404, 503, 429, 5xx, or no HTTP response at all).
   *
   * This half is R14's finding intact, wording and remedy unchanged. Nothing
   * will ever come back for it, so nothing a fresh listing can do makes it
   * readable and only a re-run resolves it — and the run controls are live,
   * because the row is not running.
   */
  settledAttemptScenarioIds: string[];
  /**
   * WAVE R10 — the batch pins IN-FLIGHT rows are still holding. Held evidence
   * anchors the cohort (R8) but is displayed nowhere, so when it is OLDER than
   * the anchor the header must disclose it by count and batch rather than let a
   * sentence about "every held result" quietly range over a set that excludes
   * it.
   */
  inFlightHeldPins: BatchPin[];
  /**
   * WAVE R10 — every row DISPLAYING a result, with the batch it displays. The
   * union of `currentScenarioIds` and `supersededScenarioIds`, carrying the pin
   * each one shows in its own cell, so a clause can name which displayed rows a
   * batch matches instead of making a claim about "this table" as a whole.
   */
  displayedPins: BatchPin[];
}

/**
 * Resolve which held results may be read together.
 *
 * The anchor is the NEWEST batch among held results, not the oldest and not
 * the first: a fresh run is the most truthful thing on the surface, and
 * demoting it to match older neighbours would be the exact cross-batch
 * sentence this guard exists to prevent.
 *
 * Everything older stays ON SCREEN — a superseded result is still a real
 * measurement of a real batch, and hiding it would trade one dishonesty for
 * another. It renders in its own named state, with its own batch id, and with
 * a re-run affordance.
 *
 * THE ANCHOR IS MONOTONIC (Wave R8), and it is made so twice over because the
 * finding names two separate facts:
 *
 *   EVIDENCE — the anchor is taken over HELD evidence (`anchorBatchOfPhase`),
 *   so a row that goes running does not take its batch off the table with it.
 *   This is what stops previously-superseded rows repainting as current the
 *   instant somebody re-runs the newest row.
 *
 *   LAW — `floorBatchId` is a WATERMARK the caller raises and never lowers. The
 *   anchor is never below it, whatever the phases currently say. Retention
 *   alone would still let the anchor fall if a re-run came back pinned to an
 *   OLDER batch than the one it replaced; the watermark closes that too, so the
 *   header's single-batch sentence can never walk backwards while the panel
 *   lives.
 */
export function resolveBatchCohort(
  phases: ReadonlyMap<string, MatrixPhase>,
  floorBatchId: number | null = null,
  coverage: RowCoverage = NO_ROW_COVERAGE,
  identity: RowIdentity = NO_ROW_IDENTITY,
): BatchCohort {
  let anchorBatchId: number | null = floorBatchId;
  const observed = observedAnchorBatch(phases, coverage, identity);
  if (observed !== null && (anchorBatchId === null || observed > anchorBatchId)) {
    anchorBatchId = observed;
  }
  const currentScenarioIds: string[] = [];
  const supersededScenarioIds: string[] = [];
  const inFlightScenarioIds: string[] = [];
  const attemptedScenarioIds: string[] = [];
  const unansweredScenarioIds: string[] = [];
  const allHoleScenarioIds: string[] = [];
  const contradictedScenarioIds: string[] = [];
  const definitionChangedScenarioIds: string[] = [];
  const definitionChangedAttemptScenarioIds: string[] = [];
  const runningAttemptScenarioIds: string[] = [];
  const settledAttemptScenarioIds: string[] = [];
  const inFlightHeldPins: BatchPin[] = [];
  const displayedPins: BatchPin[] = [];
  for (const [scenarioId, phase] of phases) {
    // IDLE IS NOT AN ATTEMPT. Everything else is, and stays one: that is what
    // makes "no run has been issued yet" a claim this session can actually
    // check rather than an inference from "no batch came back".
    if (phase.kind === "idle") continue;
    const covered = coverage.get(scenarioId);
    const rowIdentity = identity.get(scenarioId);
    // WAVE R14 — WHOSE ATTEMPT IS THIS, DECIDED BEFORE IT IS COUNTED AS ONE.
    // `attemptedScenarioIds` is the ONLY set that may answer "has this row been
    // asked about", so a run issued for a definition this page no longer shows
    // must never reach it — nor `inFlightScenarioIds` or
    // `unansweredScenarioIds`, which are the same claim in two other tenses.
    // The check answers null for every `kind: "ok"` outcome, so a served body
    // keeps sole authority over its own identity in the reads below.
    const settlement = settlementOf(phase, rowIdentity);
    if (settlement.disposition === "attempt-skew") {
      definitionChangedScenarioIds.push(scenarioId);
      definitionChangedAttemptScenarioIds.push(scenarioId);
      // WAVE R15 — AND WHICH HALF, from the flag the skew itself publishes
      // rather than from a second read of `phase.kind`. The clause, the row note
      // and the detail view all branch on this one derivation, so the three can
      // never disagree about whether the request is still out.
      if (settlement.skew.pending) runningAttemptScenarioIds.push(scenarioId);
      else settledAttemptScenarioIds.push(scenarioId);
      continue;
    }
    attemptedScenarioIds.push(scenarioId);
    // WAVE R17 — THE SETTLEMENT WAS THIS ROW'S OWN, AND IT SERVED NO BOOK. The
    // row IS this table's attempt (so it is counted above, unlike the skewed
    // family) and it is UNANSWERED — the register that has always meant "the run
    // ended without a served book". It must NOT fall through to the reads below,
    // which would classify it by the RETAINED body and put a row whose current
    // attempt failed into R12's "nothing failed, refresh the listing" set.
    if (settlement.disposition === "current-bodyless") {
      unansweredScenarioIds.push(scenarioId);
      continue;
    }
    if (phase.kind === "running") {
      inFlightScenarioIds.push(scenarioId);
      const heldBatch = anchorBatchOfPhase(phase, covered, rowIdentity);
      if (heldBatch !== null) inFlightHeldPins.push({ scenarioId, batchId: heldBatch });
      continue;
    }
    const outcome = phase.outcome;
    if (outcome.kind !== "ok") {
      unansweredScenarioIds.push(scenarioId);
      continue;
    }
    // WAVE R12 — VALIDATE BEFORE CLASSIFYING, and validate ahead of the R11
    // hole read. A contradictory book usually names somebody (twice), and a
    // version-skewed book is a real book about another definition, so both
    // would sail past `isAllHoleBook` and mint exactly the phantom pin R11
    // closed — by a door R11 could not see.
    const refusal = bookRefusal(outcome.response, rowIdentity);
    if (refusal !== null) {
      if (refusal.kind === "contradicted") contradictedScenarioIds.push(scenarioId);
      else definitionChangedScenarioIds.push(scenarioId);
      continue;
    }
    // WAVE R11 — THE ENVELOPE DOES NOT DECIDE THIS. A book that named none of
    // this row's covered engines leaves every one of its cells UNANSWERED, so
    // the row displays nothing and pins nothing: no `displayedPins` entry, no
    // membership in current/superseded, and (via `observedAnchorBatch` above)
    // no anchor. The batch it carries is real and is disclosed in the cells'
    // own sentences; what it is not is a cohort this table can be as of.
    if (isAllHoleBook(outcome.response, covered)) {
      allHoleScenarioIds.push(scenarioId);
      continue;
    }
    const batch = outcome.response.batch.id;
    displayedPins.push({ scenarioId, batchId: batch });
    if (batch === anchorBatchId) currentScenarioIds.push(scenarioId);
    else supersededScenarioIds.push(scenarioId);
  }
  return {
    anchorBatchId,
    currentScenarioIds,
    supersededScenarioIds,
    inFlightScenarioIds,
    attemptedScenarioIds,
    unansweredScenarioIds,
    allHoleScenarioIds,
    contradictedScenarioIds,
    definitionChangedScenarioIds,
    definitionChangedAttemptScenarioIds,
    runningAttemptScenarioIds,
    settledAttemptScenarioIds,
    inFlightHeldPins,
    displayedPins,
  };
}

// ---------------------------------------------------------------------------
// THE HEADER'S TRUTH TABLE (Wave R9, then rebuilt whole by Wave R10).
//
// R9 SEPARATED TWO TRUTHS that the monotonic WATERMARK was trying to serve at
// once:
//
//   THE WATERMARK is a FLOOR on the anchor — the law that stops a superseded
//   row repainting as current when the newest row's evidence leaves the table.
//   It is a statement about what this panel HAS SEEN.
//
//   THE AS-OF CLAIM is a statement about what is DISPLAYED: "results shown
//   together were measured at batch #N".
//
// They agree right up until a re-run SUCCEEDS and comes back pinned to an OLDER
// batch — exactly the pruned/receded daemon case the watermark exists for. The
// watermark correctly holds at #2 and every displayed result is correctly marked
// SUPERSEDED; but with the batch-2 result gone there is no batch-2 cohort left,
// and the header went on naming #2 as the batch every visible result was
// measured at while ZERO rows held it.
//
// R10 (Codex round-18 findings 1-3) FINISHES THE JOB, because three clauses
// were still deriving from something other than what a reader can see:
//
//   1. NO ANCHOR WAS READ AS NO RUN. `anchorBatchId === null` returned "no run
//      has been issued yet — every covered cell reads not run". That is FALSE
//      the moment a FIRST run is in flight (the cells say running…) and it is
//      false INDEFINITELY after a first run fails (the cells say UNANSWERED).
//      The header contradicted the cells directly underneath it. "No run has
//      been issued yet" is a claim about what was ASKED, so it is now decided
//      by `attemptedScenarioIds` and by nothing else.
//
//   2. "EVERY HELD RESULT IS ON THAT BATCH" RANGED OVER A SET THAT EXCLUDED A
//      HELD PIN. An in-flight row's held outcome ANCHORS the cohort (R8) but the
//      row is deliberately in neither displayed list — so with row A re-running
//      while holding batch 1 and row B current at batch 2, `superseded` was
//      empty and the header claimed every held result was on batch 2 while A
//      held batch 1 that very moment. The assurance now speaks about DISPLAYED
//      results, and older held pins are DISCLOSED by count and batch.
//
//   3. THE FRONTIER WAS COMPARED AGAINST THE WATERMARK. In the receded sequence
//      (watermark 2, every displayed row AND the frontier at batch 1) the line
//      said the frontier was "a different batch from this table" while every
//      displayed result matched it exactly. The comparison is now against the
//      DISPLAYED cohort's batch when one exists; when none exists, no table-wide
//      same/different claim is made at all — the frontier's own batch is
//      disclosed, and the displayed rows that carry it are counted.
//
// R11 (Codex round-19) ADDS THE LAST NAMED SET, because one clause was still
// deriving from the ENVELOPE rather than from anything on screen:
//
//   4. A SERVED BOOK WAS READ AS A DISPLAYED RESULT. Every `kind: "ok"` outcome
//      minted a displayed pin because the envelope carried a batch — even when
//      the book named none of the row's covered engines and `cellState` had
//      already painted every one of those cells UNANSWERED. The header claimed
//      a cohort over zero displayed results, and the frontier clause compared
//      itself against it. Row presentation now derives from ACTUAL CELL
//      COVERAGE (`isAllHoleBook`), and such a row is counted in its own set,
//      with its own sentence, pinning no batch anywhere.
//
// R12 (Codex round-20) ADDS TWO MORE NAMED SETS, both for responses this table
// refuses to classify AT ALL rather than classify wrongly:
//
//   5. A BODY THAT ANSWERS ONE CELL TWO WAYS WAS READ AS AN ANSWER. `cellState`
//      checked `engines[]` before `excluded_engines[]`, so an engine in BOTH
//      rendered its numeric RESULT in the matrix while the SAME response
//      rendered it WITHHELD in the detail view. The body is now validated
//      before anything is classified, and an invalid one is refused whole —
//      counted in `contradictedScenarioIds`, with its own wording, because
//      "the book named nobody" is a false account of a book that named
//      somebody twice.
//
//   6. THE COVERAGE JOIN WAS BOUND TO A SCENARIO ID ALONE. Across an API
//      deployment mid-session, a retained v1 listing and a valid v2 response
//      for the same id are two different definitions wearing one name, and
//      R11 read the v2 book against v1 coverage and called it ALL-HOLE. The
//      join now requires scenario id + scenario version + scenario_config_
//      version to agree, and a mismatch is counted in
//      `definitionChangedScenarioIds` with a refresh-the-listing sentence.
//
// R14 (Codex round-22) SPLITS THE LAST SET IN TWO, because one clause was
// speaking for two different events with one remedy:
//
//   7. A RUN ASKED UNDER A DEFINITION THIS PAGE NO LONGER SHOWS WAS COUNTED AS
//      THIS ROW'S ATTEMPT. R12's identity guard reads the RESPONSE's own
//      `scenario_*` fields, so it says nothing about a phase with no response —
//      a run still in flight, or one that ended in a 404/503/no-HTTP-response.
//      Those re-attached to a re-listed row by id alone, rendering as RUNNING or
//      UNANSWERED on a definition that was never asked anything, and the header
//      counted the row attempted. Every phase is now STAMPED at dispatch with
//      the identity the row was showing; a stamp that disagrees with the current
//      listing puts the row in `definitionChangedScenarioIds` — and in the
//      `definitionChangedAttemptScenarioIds` subset, which exists so the clause
//      can say "re-run" where R12's says "refresh", because a run that never
//      answered has nothing for a fresh listing to make readable.
//
// R15 (Codex round-23) SPLITS THAT SUBSET AGAIN, because ONE of the two events
// R14 named is itself two events with two truths:
//
//   8. A RUN STILL IN FLIGHT WAS TOLD IT NEVER CAME BACK. `attemptSkew` already
//      knew the difference — its CELL wording says "the request is still out" —
//      but the cohort merged running and settled skewed attempts into one count,
//      so the header spoke R14's single sentence over both: the request "never
//      came back with a book of their own", re-run the row. Over a request that
//      is still out that is false about the past and useless about the present,
//      and it directs the reader at a control BOTH surfaces disable for exactly
//      as long as the request is in flight. `runningAttemptScenarioIds` and
//      `settledAttemptScenarioIds` partition the R14 family (which keeps its
//      meaning and its count), and the running arm names NO remedy at all,
//      because waiting is the only true one. The single derivation is
//      `DefinitionSkew.pending`, published by `attemptSkew` from the same read
//      its reason branches on, so the header clause, the matrix row note and the
//      detail view cannot give three accounts of one request.
//
// THE ONE PRINCIPLE, from which every clause below follows: EVERY CLAUSE IS A
// STATEMENT ABOUT A NAMED SET the reader can point at — displayed rows, rows
// asked, rows in flight, held pins, rows served a book that named nobody, rows
// served a book that contradicts itself, rows answered against a definition
// this page no longer shows, rows asked under one. The WATERMARK appears in
// exactly one clause, the floor disclosure, where it is named as what it is and
// nothing is inferred from it.
// ---------------------------------------------------------------------------

/** No run at all: a statement about this session, never about the book. */
export const MATRIX_NO_RUN_LINE =
  "no run has been issued yet, so every covered cell reads “not run”, which is a " +
  "statement about this session, not about the book.";

/** "batch #1" / "batches #1 and #3" / "batches #1, #3 and #4". */
function batchWords(ids: readonly number[]): string {
  const unique = [...new Set(ids)]
    .sort((left, right) => left - right)
    .map((id) => `#${String(id)}`);
  if (unique.length <= 1) return `batch ${unique[0] ?? "—"}`;
  return `batches ${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1] ?? ""}`;
}

/**
 * NO BATCH HAS EVER BEEN SERVED HERE, BUT SOMETHING WAS ASKED (Wave R10,
 * round-18 finding 1).
 *
 * This is the arm the old code collapsed into "no run has been issued yet". It
 * covers the states a first run can be in when it has produced no DISPLAYABLE
 * batch: still IN FLIGHT, ENDED WITHOUT A BOOK, and — Wave R11 — SERVED A BOOK
 * THAT NAMED NOBODY. All three leave real, non-idle cells on screen ("running…"
 * and "UNANSWERED"), and the header's job is to agree with them, name what
 * happened in each case SEPARATELY, and decline to name a batch it does not
 * have.
 */
function firstResultPendingClause(cohort: BatchCohort): string {
  const inFlight = cohort.inFlightScenarioIds.length;
  const unanswered = cohort.unansweredScenarioIds.length;
  const allHole = cohort.allHoleScenarioIds.length;
  const contradicted = cohort.contradictedScenarioIds.length;
  // R14: the attempts are a SUBSET of the definition-changed set, and the two
  // halves get separate facts because they are separate events with separate
  // remedies. Subtracting keeps the response half's count — and therefore R12's
  // sentence — byte-identical whenever no attempt is involved.
  const changedAttempts = cohort.definitionChangedAttemptScenarioIds.length;
  const changed = cohort.definitionChangedScenarioIds.length - changedAttempts;
  // R15: and the attempt half splits again, by whether the request has SETTLED.
  // Same arithmetic discipline: the settled count is the family minus the
  // running one, so R14's fact renders byte-identically whenever nothing is out.
  const runningAttempts = cohort.runningAttemptScenarioIds.length;
  const settledAttempts = changedAttempts - runningAttempts;
  const facts: string[] = [];
  if (inFlight > 0) facts.push(`${String(inFlight)} run(s) are in flight`);
  if (unanswered > 0) facts.push(`${String(unanswered)} run(s) ended without a served result`);
  // R11: NOT "ended without a served result". This run ended WITH a 200 and a
  // batch; what it did not carry was any cell for this row.
  if (allHole > 0) {
    facts.push(
      `${String(allHole)} run(s) were served a book that named none of the row's covered ` +
        `engines: a served book, but not a served result`,
    );
  }
  // R12: NOT "named nobody". This book named somebody TWICE, or named them
  // served and withheld at once — a body refused for presentation whole.
  if (contradicted > 0) {
    facts.push(
      `${String(contradicted)} run(s) were served a book that CONTRADICTS ITSELF: an engine ` +
        `named twice, or named as served and withheld at once, which is a body that names ` +
        `somebody twice rather than one that names nobody`,
    );
  }
  // R12: nothing failed here. The answer is real and is about another
  // definition, so it is not read against the one on screen.
  if (changed > 0) {
    facts.push(
      `${String(changed)} run(s) answered for a committed definition this page is no longer ` +
        `showing. Refresh the listing to run against the current one`,
    );
  }
  // R15: THE REQUEST IS STILL OUT, so no account of what it did may be given and
  // no remedy may be named. "Never came back" is a claim about a finished thing;
  // this thing is not finished. And the re-run it would send the reader to is
  // the control this row disables while the request is out.
  if (runningAttempts > 0) {
    facts.push(
      `${String(runningAttempts)} run(s) were ASKED under a committed definition this page is ` +
        `no longer showing and the request is STILL OUT. Whatever it answers will be judged by ` +
        `the identity the response publishes for itself, so there is nothing to do here until ` +
        `it settles`,
    );
  }
  // R14: NOTHING ANSWERED HERE AT ALL, so the remedy above is the wrong one. A
  // refresh makes a stored ANSWER readable; there is no answer here to make
  // readable, only a run that was asked under a definition this page has moved
  // past. Only a re-run resolves it.
  if (settledAttempts > 0) {
    facts.push(
      `${String(settledAttempts)} run(s) were ASKED under a committed definition this page is ` +
        `no longer showing and never came back with a book of their own, so re-run to ask under ` +
        `the current one`,
    );
  }
  // Unreachable while a phase can only be idle / running / outcome — an ok
  // outcome would have given an anchor. Stated rather than assumed.
  if (facts.length === 0) {
    return "no result is displayed on this table, and no batch can be named for one.";
  }
  return (
    `no result has been served to this table yet: ${facts.join(", and ")}. There is no batch ` +
    `for this table to be as of, and this is NOT “not run”: every row counted here was asked, ` +
    `and each says in its own cell what became of the asking.`
  );
}

/**
 * The cohort's own sentence — the as-of claim, or the refusal to make one.
 *
 * The empty-`currentScenarioIds` arm covers two real states with one honest
 * sentence, because they are the same statement: the re-run that came back
 * OLDER (nothing left at the watermark), and the in-flight window where the
 * only row holding the watermark is displaying "running…" rather than a result.
 * In both, no displayed result was measured at the watermark, and the header
 * must not say one was.
 */
function cohortClause(cohort: BatchCohort): string {
  // R10 finding 1: "no run" is decided by what was ASKED, never by the absence
  // of a batch. The anchor check rides along so a caller-supplied floor with no
  // attempts still falls through to the floor disclosure rather than claiming
  // a session that never ran.
  // R14 rides on the same principle and had to join this guard: an attempt
  // asked under a definition this page no longer shows is deliberately NOT in
  // `attemptedScenarioIds`, but its cells read DEFINITION CHANGED — so a header
  // saying "every covered cell reads not run" above them would be the round-18
  // contradiction arriving through the new door.
  if (
    cohort.attemptedScenarioIds.length === 0 &&
    cohort.definitionChangedAttemptScenarioIds.length === 0 &&
    cohort.anchorBatchId === null
  ) {
    return MATRIX_NO_RUN_LINE;
  }
  if (cohort.anchorBatchId === null) return firstResultPendingClause(cohort);
  const batch = `#${String(cohort.anchorBatchId)}`;
  const older = cohort.supersededScenarioIds.length;
  if (cohort.currentScenarioIds.length === 0) {
    return (
      `batch ${batch} is the newest batch this table has seen and the floor its as-of never ` +
      `falls below, but NO result now displayed was measured at it. ` +
      (older === 0
        ? "No row is displaying a result at all right now, so there is no cohort to read together."
        : `${String(older)} row(s) are displayed and every one of them is OLDER, marked ` +
          `SUPERSEDED at its own batch pin, so there is no batch ${batch} cohort here to read ` +
          `them as one.`)
    );
  }
  return (
    `results shown together were measured at batch ${batch}.` +
    // R10 finding 2: the assurance is about what is DISPLAYED. It used to read
    // "Every held result is on that batch", which ranged over held evidence —
    // including an in-flight row's OLDER pin that this list deliberately omits.
    (older === 0
      ? " Every DISPLAYED result was measured at that batch."
      : ` ${String(older)} row(s) still hold an older batch's result and are marked SUPERSEDED. They are shown, never blended into the sentence above.`)
  );
}

/**
 * OLDER HELD EVIDENCE, DISCLOSED (Wave R10, round-18 finding 2).
 *
 * A re-running row displays nothing and is in neither displayed list, yet its
 * held result is still real evidence pinned to a real batch. When that pin is
 * OLDER than the anchor, the row is holding a measurement the sentence above
 * does not cover — so it is counted and its batch is named, rather than being
 * quietly folded under an assurance about "every held result".
 */
function heldPinClause(cohort: BatchCohort): string {
  const anchor = cohort.anchorBatchId;
  if (anchor === null) return "";
  const older = cohort.inFlightHeldPins.filter((pin) => pin.batchId < anchor);
  if (older.length === 0) return "";
  return (
    ` ${String(older.length)} re-running row(s) still hold a result at ` +
    `${batchWords(older.map((pin) => pin.batchId))} while the request is out · held evidence, ` +
    `displayed nowhere, and never part of the cohort above.`
  );
}

/**
 * A run in flight is disclosed because it is the only thing that could make the
 * sentence above look like it had moved. It has not: the batch is a watermark
 * and only ever goes forward.
 */
function inFlightClause(cohort: BatchCohort): string {
  if (cohort.anchorBatchId === null || cohort.inFlightScenarioIds.length === 0) return "";
  return (
    ` ${String(cohort.inFlightScenarioIds.length)} row(s) have a run in flight; the batch above ` +
    `is a WATERMARK and never moves backwards while one is, so nothing older repaints as current.`
  );
}

/**
 * Rows whose run ENDED WITHOUT A BOOK, counted beside the batch sentence.
 *
 * They display no result, so they neither join the cohort nor contradict it —
 * but leaving them out entirely once left a reader to assume every row not
 * named was current. In the no-anchor arm this is already said inline, so the
 * clause holds its tongue there.
 */
function unansweredClause(cohort: BatchCohort): string {
  if (cohort.anchorBatchId === null || cohort.unansweredScenarioIds.length === 0) return "";
  return (
    ` ${String(cohort.unansweredScenarioIds.length)} row(s) display UNANSWERED: their run ` +
    `ended without a served book, which is neither a zero nor a “not run”, and joins no batch ` +
    `sentence here.`
  );
}

/**
 * ROWS SERVED A BOOK THAT NAMED NOBODY, counted and named (Wave R11).
 *
 * The distinction this clause carries is the whole finding: `unansweredClause`
 * above speaks for runs that ENDED WITHOUT A BOOK, and saying that about a run
 * which returned a 200 with a batch would be a false account of what happened.
 * The book arrived; it simply named none of the engines this row is defined
 * for, so there is nothing of it to display and nothing of it to be as of.
 *
 * The claim about the cells is exact and holds at EVERY batch: `cellState`
 * decides the hole before it decides supersession, so an all-hole row's covered
 * cells read UNANSWERED whatever batch the book carried. (A row covered for no
 * engine is folded into this set too — it draws no covered cell at all, so the
 * claim is vacuously true there and the "displays no result" half is the point.)
 */
function allHoleClause(cohort: BatchCohort): string {
  if (cohort.anchorBatchId === null || cohort.allHoleScenarioIds.length === 0) return "";
  return (
    ` ${String(cohort.allHoleScenarioIds.length)} row(s) were SERVED A BOOK that named none of ` +
    `the engines their committed definition covers, so every covered cell there reads UNANSWERED, ` +
    `so the row displays no result, pins no batch, and is no part of the sentence above. That is ` +
    `not a run that ended without a book: the book arrived and named nobody.`
  );
}

/**
 * ROWS SERVED A BOOK THAT CONTRADICTS ITSELF, counted and named (Wave R12).
 *
 * Its whole reason for existing separately from `allHoleClause` is the last
 * sentence. R11's clause says the book "named none of the engines their
 * committed definition covers"; borrowing it here would be a false account of a
 * body that named one of those engines TWICE — once as a result, once as a
 * refusal. The ruling is explicit that "named nobody" must not be claimed about
 * a book that named somebody twice, so the two sentences never touch.
 */
function contradictedClause(cohort: BatchCohort): string {
  if (cohort.anchorBatchId === null || cohort.contradictedScenarioIds.length === 0) return "";
  return (
    ` ${String(cohort.contradictedScenarioIds.length)} row(s) were served a book that ` +
    `CONTRADICTS ITSELF: an engine named twice within an array, or named as served and ` +
    `withheld at once. A body that answers a cell two ways answers it no way, so the whole ` +
    `response is refused for presentation: no cell, no pin, and no part of the sentence above. ` +
    `That is not a book that named nobody; this one named somebody twice.`
  );
}

/**
 * ROWS ANSWERED AGAINST A DEFINITION THIS PAGE NO LONGER SHOWS (Wave R12).
 *
 * Nothing failed and nothing was withheld: the response is valid, and it is
 * about a committed definition that is not the one on screen. Joining the two
 * by scenario id alone is what produced the round-20 defect — a v2 book read
 * against v1 coverage and declared to have "named nobody" while its real result
 * sat in the detail view — so the clause states the mismatch and points at the
 * only thing that resolves it, which is a fresh listing rather than a re-run.
 */
function definitionChangedClause(cohort: BatchCohort): string {
  if (cohort.anchorBatchId === null) return "";
  // WAVE R14 — TWO HALVES, TWO SENTENCES, ONE SET. The response half keeps R12's
  // words exactly (and therefore renders byte-identically whenever no attempt is
  // involved); the attempt half gets its own, because "answered for" is a false
  // account of a run that never answered, and "refresh the listing" is a false
  // remedy for a row whose listing is already current.
  //
  // WAVE R15 — AND THE ATTEMPT HALF IS ITSELF TWO STATES. R14 wrote ONE sentence
  // for every skewed attempt, and that sentence said the run "never came back"
  // and told the reader to re-run. Over a request that is STILL OUT both halves
  // of it are false: nothing has come back because nothing could have yet, and
  // the re-run it points at is disabled for exactly as long as the request is in
  // flight — the header directing a reader to a control the row has disabled is
  // the contradiction R10 through R14 closed everywhere else, arriving through
  // the newest door. Three arms now, each a statement about a set the reader can
  // point at, and the counts subtract so that every arm not in play renders R14's
  // and R12's text unchanged.
  const attempts = cohort.definitionChangedAttemptScenarioIds.length;
  const answers = cohort.definitionChangedScenarioIds.length - attempts;
  const running = cohort.runningAttemptScenarioIds.length;
  const settled = attempts - running;
  let line = "";
  if (answers > 0) {
    line +=
      ` ${String(answers)} row(s) answered for a COMMITTED ` +
      `DEFINITION this page is no longer showing: the committed set moved after this page ` +
      `loaded. Nothing failed and nothing was withheld: a result computed for one definition is ` +
      `simply never read against the coverage of another, so the row is not classified, pins no ` +
      `batch, and is no part of the sentence above. Refresh the committed listing to run against ` +
      `the current definition.`;
  }
  // R15's arm. It names no remedy AT ALL, and that is the point: there is no
  // action a reader can take on a request that is still out, so offering one
  // would be inventing work. It also makes no claim about what came back.
  if (running > 0) {
    line +=
      ` ${String(running)} row(s) were ASKED under a COMMITTED DEFINITION this page is no ` +
      `longer showing and their request is STILL OUT. An attempt carries only the identity it ` +
      `was DISPATCHED under, and that identity is not this row's. Nothing has settled: whatever ` +
      `the request answers will be judged by the identity the RESPONSE publishes for itself, ` +
      `so the row pins no batch and is no part of the sentence above. There is nothing to do ` +
      `here until it settles.`;
  }
  if (settled > 0) {
    line +=
      ` ${String(settled)} row(s) were ASKED under a COMMITTED DEFINITION this page is no ` +
      `longer showing and never came back with a book of their own. An attempt carries only ` +
      `the identity it was DISPATCHED under, and that identity is not this row's. Nothing ` +
      `answered and nothing was refused, so the attempt is counted as neither in flight nor ` +
      `unanswered, pins no batch, and is no part of the sentence above. Re-run the row to ask ` +
      `under the current definition, and a listing refresh resolves nothing here, because the ` +
      `listing is already the current one.`;
  }
  return line;
}

/**
 * THE FRONTIER READS ITS OWN BATCH (Wave R10, round-18 finding 3).
 *
 * The comparison used to be made against the WATERMARK, which is not displayed
 * anywhere and can be a batch no row holds. In the receded sequence — watermark
 * 2, every displayed row at batch 1, frontier at batch 1 — that produced "a
 * different batch from this table" while every visible result matched it.
 *
 * So the comparison is now made against the one batch this table actually
 * CLAIMS: the batch its DISPLAYED cohort was measured at. When there is no such
 * cohort there is nothing to compare table-wide, and none is claimed; instead
 * the frontier's own batch is disclosed and the DISPLAYED rows carrying it are
 * counted, which is a statement about a set the reader can point at.
 */
function frontierClause(cohort: BatchCohort, frontierBatchId: number | null): string {
  if (frontierBatchId === null) return "";
  const lead = ` The loss frontier above reads batch #${String(frontierBatchId)}`;
  if (cohort.anchorBatchId !== null && cohort.currentScenarioIds.length > 0) {
    return cohort.anchorBatchId === frontierBatchId
      ? `${lead}.`
      : `${lead}, a different batch from this table's displayed cohort, which is why the two ` +
          `are never read as one number.`;
  }
  if (cohort.displayedPins.length === 0) return `${lead}.`;
  const matching = cohort.displayedPins.filter((pin) => pin.batchId === frontierBatchId).length;
  const displayed = cohort.displayedPins.length;
  return matching === 0
    ? `${lead}: no result displayed here was measured at it, and this table names no cohort ` +
        `of its own, so no same-or-different claim is made for the table as a whole.`
    : `${lead}: the same batch ${String(matching)} of the ${String(displayed)} displayed ` +
        `row(s) are pinned to. This table names no cohort of its own, so the two are still ` +
        `never read as one number.`;
}

/**
 * The whole batch line, as one pure string.
 *
 * It lives here rather than in the component so the claim can be pinned by the
 * unit spec against a cohort built by hand, sequence by sequence — including
 * the sequences a browser can only reach through a timing window.
 *
 * The clause order is the reader's order: what this table claims, then what is
 * held but not shown, then what is still out, then what came back empty, then
 * what came back naming nobody, then what came back naming somebody twice, then
 * what came back about another definition, then what is still out under another
 * definition, then what ended under another definition, then the frontier's
 * separate read.
 */
export function batchHeaderLine(cohort: BatchCohort, frontierBatchId: number | null): string {
  return (
    cohortClause(cohort) +
    heldPinClause(cohort) +
    inFlightClause(cohort) +
    unansweredClause(cohort) +
    allHoleClause(cohort) +
    contradictedClause(cohort) +
    definitionChangedClause(cohort) +
    frontierClause(cohort, frontierBatchId)
  );
}

// ---------------------------------------------------------------------------
// Cell states.
// ---------------------------------------------------------------------------

/**
 * What a superseded cell was HOLDING when the batch moved out from under it.
 *
 * WAVE R11 removed a third member, `{ kind: "absent" }`. SUPERSEDED means "this
 * cell holds a measurement taken at an older batch"; a cell the run named in
 * NEITHER array holds nothing, so there was never anything there to supersede —
 * it is a HOLE, at every batch, and `cellState` decides it as one before it
 * decides supersession. The rendered cell used to read "SUPERSEDED · no cell
 * served", which claimed a superseded measurement that did not exist.
 */
export type SupersededPayload =
  | { kind: "result"; engine: LabRunBookEngine }
  | { kind: "withheld"; refusal: EngineRefusal };

/**
 * Every state one cell can be in. The five the ruling names — not run,
 * running, result, NOT COVERED, WITHHELD — plus the four the honesty register
 * forces (two from the batch guard and the hole, two from Wave R12's
 * refuse-before-you-classify rule):
 *
 *   superseded  the single-batch guard's own named state (ruling item 4: a
 *               result from a superseded batch is never silently mixed).
 *   unanswered  the run ENDED without a book for this engine — a 404/503/429/
 *               network failure, or a 200 that named the engine in neither
 *               `engines` nor `excluded_engines`. "A scenario the batch cannot
 *               answer is not a zero" (ruling item 6), so it is not a result,
 *               and it is not a refusal either — nobody refused anything.
 *   contradicted     the served body answers this row's cells two ways at once
 *                    (R12 finding 1). Refused whole, before classification.
 *   definition-changed  the response is about a committed definition this page
 *                    is no longer showing (R12 finding 2). Not classified.
 */
export type LabCellState =
  | { state: "not-covered"; coverage: CellCoverage }
  | { state: "not-run" }
  | { state: "running" }
  | { state: "result"; engine: LabRunBookEngine; batchId: number }
  | { state: "withheld"; refusal: EngineRefusal; batchId: number }
  | {
      state: "superseded";
      payload: SupersededPayload;
      batchId: number;
      anchorBatchId: number;
    }
  | { state: "unanswered"; reason: string }
  | {
      /**
       * WAVE R12 — the served body contradicts itself, so this surface refuses
       * to classify ANY of its cells. `reason` is composed once, in
       * `bookContradiction`, and rendered identically by the header, the cell
       * and the detail view.
       */
      state: "contradicted";
      contradiction: BookContradiction;
      batchId: number;
    }
  | {
      /**
       * WAVE R12 — the response answered for a committed definition this page
       * is no longer showing. Not a failure and not a refusal: a real answer
       * about a different definition, which is why it gets neither a cell nor
       * a pin here and why the affordance is a listing refresh, not a re-run.
       *
       * WAVE R14 — the same register, and deliberately the SAME state, for a
       * phase with no body of its own: a run DISPATCHED under a definition this
       * page no longer shows. `skew.subject` says which of the two it is, and
       * `batchId` is null for an attempt because there is no book and therefore
       * no batch to disclose — the one thing an answer has that an attempt
       * never does.
       */
      state: "definition-changed";
      skew: DefinitionSkew;
      batchId: number | null;
    };

/** The honest sentence for each way a run can end without a book. */
export function unansweredReason(outcome: Exclude<RunBookOutcome, { kind: "ok" }>): string {
  switch (outcome.kind) {
    case "not-served":
      return "this deployment answered 404, so book-wide stress is not served here. A fact about the DEPLOYMENT, not about the scenario.";
    case "no-batch":
      return `no servable batch (503): ${outcome.message}${
        outcome.retryAfterSeconds === null
          ? ""
          : ` · retry after ${String(outcome.retryAfterSeconds)}s`
      }`;
    case "rate-limited":
      return outcome.retryAfterSeconds === null
        ? "rate limited (429), and the service did not say when to retry."
        : `rate limited (429), and the service says retry after ${String(outcome.retryAfterSeconds)}s.`;
    case "unreachable":
      return `the API could not be reached (${outcome.message}), which says nothing about the book.`;
    case "failed":
      return `the run failed (${String(outcome.status)}): ${outcome.message}`;
  }
}

export interface CellStateInput {
  scenario: Pick<ScenarioDefinition, "id" | "engines" | "shocks">;
  engine: string;
  phase: MatrixPhase;
  cohort: BatchCohort;
  /**
   * WAVE R12 — the identity the LISTING publishes for this row, when the caller
   * has one. Absent means the caller is making no identity claim, and nothing
   * is inferred (the same rule R11 gave absent coverage). `LabMatrix` supplies
   * it for every row it renders.
   */
  identity?: ScenarioIdentity;
}

/**
 * One cell's state, decided in a fixed precedence:
 *
 *   1. NOT COVERED wins over everything. It is structural — true before any
 *      run and unchanged by any run — so a run that stumbles on a scenario
 *      whose model never included this engine can never repaint the cell as a
 *      failure. (An outcome that named an engine outside the definition would
 *      be a contract violation; the coverage answer is still the honest one.)
 *   2. no phase / idle          → not run
 *   2a. WAVE R14 — a phase whose ATTEMPT was dispatched under a definition this
 *      page no longer shows → definition-changed. A running phase and a run
 *      that ended without a book carry no identity of their own; the stamp is
 *      the only one they have, and if it is not this row's then neither
 *      "running…" nor UNANSWERED is a true statement about this row. It answers
 *      null for every `kind: "ok"` outcome, so a served body is never gated
 *      twice — its own published identity decides it at 4b.
 *   3. running                  → running (never blank, never a stale value).
 *      The phase's `held` evidence is NOT rendered here — showing a previous
 *      batch's number under a live request is exactly the stale value this
 *      state exists to avoid. It anchors the cohort and nothing else, which is
 *      why every OLDER row keeps its SUPERSEDED state for the whole in-flight
 *      window (Wave R8).
 *   2b. WAVE R17 — a phase whose SETTLEMENT was this row's own attempt, came
 *      back BODYLESS, and left behind a retained body this surface REFUSES
 *      → unanswered, naming both facts. Same rank as 2a and for the same reason:
 *      it is a statement about the WHOLE phase, and the retained body's own gate
 *      at 4b would otherwise answer for a request that never produced it. It is
 *      NOT the DEFINITION CHANGED register — nothing about this row's definition
 *      changed for this attempt, and R14's family carries a remedy this row does
 *      not need.
 *   4. an outcome without a book → unanswered, with the reason named
 *   4a. WAVE R12 — a served body that CONTRADICTS ITSELF (an engine named twice
 *      within an array, or named as served and withheld at once) → contradicted.
 *      It outranks every read below because it is a statement about the WHOLE
 *      response: there is no honest per-cell answer inside a body that answers
 *      one cell two ways, and the old order's `engines[]`-then-
 *      `excluded_engines[]` precedence silently picked the numeric one while
 *      the detail view rendered the refusal.
 *   4b. WAVE R12 — a response answering for a committed definition this page is
 *      no longer showing → definition-changed. Same reason and same rank: a
 *      book computed for one definition has no per-cell authority over the
 *      coverage of another, and joining the two by scenario id alone is what
 *      made a valid v2 book read as ALL-HOLE against a retained v1 listing.
 *   5. an outcome naming this engine in NEITHER array → unanswered: a hole the
 *      surface refuses to fill with a zero. WAVE R11 MOVED THIS AHEAD OF
 *      SUPERSESSION, and the move is load-bearing twice over. SUPERSEDED means
 *      "this cell HOLDS a measurement from an older batch"; a cell that was
 *      never served holds nothing, so there is nothing to supersede and the
 *      hole is the honest state at EVERY batch. And because an all-hole book no
 *      longer raises the anchor, such a row can now sit at a batch NEWER than
 *      the anchor — where the old order would have stamped it "measured at
 *      batch #5; the matrix now reads #3", calling a newer batch older.
 *   6. an outcome from a DIFFERENT batch than the cohort anchor → superseded,
 *      carrying what it actually held, and NEVER read alongside the anchor's
 *      cells as one sentence
 *   7. a served engine          → result
 *   8. a refused engine         → withheld, refusal register attached
 */
export function cellState(input: CellStateInput): LabCellState {
  const coverage = scenarioCoverage(input.scenario, input.engine);
  if (!coverage.covered) return { state: "not-covered", coverage };

  const { phase, cohort, engine } = input;
  if (phase.kind === "idle") return { state: "not-run" };

  // 2a. WAVE R14 — WHOSE ATTEMPT IS THIS? A running phase and a run that ended
  // without a book carry no identity of their own, so they are judged by the one
  // stamped on them at dispatch. When it is not this row's, "running…" and
  // UNANSWERED are both claims about a run THIS definition never had, and the
  // header would count the row as attempted on the strength of them. It sits
  // ahead of both because it is a statement about the WHOLE phase — exactly as
  // R12's two refusals are statements about the whole response — and it answers
  // null for every `kind: "ok"` outcome, so a served body keeps sole authority
  // over its own identity in step 4b below.
  const settlement = settlementOf(phase, input.identity);
  if (settlement.disposition === "attempt-skew") {
    return { state: "definition-changed", skew: settlement.skew, batchId: null };
  }
  // 2b. WAVE R17 — THE SETTLEMENT WAS THIS ROW'S OWN AND IT SERVED NO BOOK. It
  // sits at the same rank and for the same reason: it is a statement about the
  // WHOLE phase, and it must outrank the retained body's own gate at 4b — which
  // would otherwise paint this cell DEFINITION CHANGED about a response that is
  // not the settled request's, under a header saying nothing failed. There is no
  // skew here to report and no body to present, so the honest cell is the one
  // that has always meant "the run ended without a book for this cell".
  if (settlement.disposition === "current-bodyless") {
    return { state: "unanswered", reason: settlement.reason };
  }

  if (phase.kind === "running") return { state: "running" };

  if (phase.outcome.kind !== "ok") {
    return { state: "unanswered", reason: unansweredReason(phase.outcome) };
  }

  const response = phase.outcome.response;
  const batchId = response.batch.id;

  // WAVE R12 — VALIDATE THE BODY, THEN THE JOIN, BEFORE ANY CLASSIFICATION.
  // This sits ahead of the hole read (5) and therefore ahead of everything
  // below it, because both refusals are statements about the RESPONSE AS A
  // WHOLE: there is no honest per-cell answer to be had from a body that
  // contradicts itself, and none to be had by reading a book for one definition
  // against the coverage of another. The batch its envelope carried is
  // disclosed in the sentence and disclaimed in the same breath — R11's
  // pattern — because the row is in no cohort either way.
  const refusal = bookRefusal(response, input.identity);
  if (refusal !== null) {
    return refusal.kind === "contradicted"
      ? { state: "contradicted", contradiction: refusal.contradiction, batchId }
      : { state: "definition-changed", skew: refusal.skew, batchId };
  }

  const anchorBatchId = cohort.anchorBatchId;
  const stale = anchorBatchId !== null && batchId !== anchorBatchId;

  const served = response.engines.find((candidate) => candidate.engine === engine);
  if (served !== undefined) {
    return stale
      ? { state: "superseded", payload: { kind: "result", engine: served }, batchId, anchorBatchId }
      : { state: "result", engine: served, batchId };
  }

  const refused = response.excluded_engines.find((candidate) => candidate.engine === engine);
  if (refused !== undefined) {
    return stale
      ? { state: "superseded", payload: { kind: "withheld", refusal: refused }, batchId, anchorBatchId }
      : { state: "withheld", refusal: refused, batchId };
  }

  return {
    state: "unanswered",
    reason:
      `the run returned neither a result nor a refusal for ${engine}, an engine the committed ` +
      "definition claims this engine, so its absence is a hole, and this surface will not " +
      `fill a hole with a zero. The book it served was measured at batch #${String(batchId)}; ` +
      "this cell is no part of that batch's cohort.",
  };
}

/** The label each state renders as. One vocabulary, pinned by the unit spec. */
export const CELL_STATE_LABEL: Record<LabCellState["state"], string> = {
  "not-covered": "NOT COVERED",
  "not-run": "not run",
  running: "running…",
  result: "result",
  withheld: "WITHHELD",
  superseded: "SUPERSEDED",
  unanswered: "UNANSWERED",
  contradicted: "CONTRADICTORY BOOK",
  "definition-changed": "DEFINITION CHANGED",
};

// ---------------------------------------------------------------------------
// WAVE R13, FINDING 2 — A FAILED RE-RUN MAY NOT CALL A REFUSED RESPONSE A
// RESULT.
//
// THE DEFECT. Wave R8 established that a re-run which ends without a book does
// NOT overwrite what the row already held: the held outcome comes back at its
// own batch pin and the failure is DISCLOSED BESIDE IT. Both surfaces render
// that disclosure, and both composed it from `rerunFailed !== undefined` alone —
// the retained outcome's `kind: "ok"` was never asked what it actually was.
//
// So over a response R12 refuses to present, the two banners said:
//
//   detail  "The result below is the one this row already held, at the batch it
//            was measured on"  — directly above a gated view whose entire text
//            is "refusing to render", where no result is rendered at all.
//   matrix  "The cells still show what this row already measured, at its own
//            batch" — over a row whose every covered cell reads CONTRADICTORY
//            BOOK or DEFINITION CHANGED, which are the states that exist
//            PRECISELY because nothing there was measured into a cell.
//
// A surface that refuses to present a response may not turn around and call it a
// result one line higher. That is the same law R12 landed, arriving through the
// one sentence R12 did not compose.
//
// THE RULE: THE WORDING IS GATED THROUGH `bookRefusal`, LIKE EVERYTHING ELSE.
// What the row RETAINS is derived here, once, and the sentence follows from it:
// a presentable result keeps R8's wording VERBATIM, and a retained-but-refused
// response gets its own neutral banner that names it by its own refusal
// register and never uses the word "result" for it.
//
// BOTH SURFACES COMPOSE FROM THIS ONE DERIVATION so they cannot diverge — which
// is the shape of the finding itself: two banners, one state, two accounts of it.
// They differ only in where they point the reader (the row's own cells, or the
// panel below), because that is the one thing that genuinely differs between
// them.
// ---------------------------------------------------------------------------

/** Which banner is being composed — the two differ only in where they point. */
export type RerunSurface = "matrix" | "detail";

export interface RerunFailedBanner {
  /**
   * The run-outcome sentence for the FAILURE itself.
   *
   * WAVE R16 — read from `RerunFailure.reason`, which is R8's string unmoved and
   * unedited. Widening the phase's field into a record changed where this comes
   * from and changed nothing about what it says.
   */
  failure: string;
  /**
   * What the row STILL HOLDS, which is the only thing the banner may call it.
   *
   *   result    a served book this surface presents — R8's original case.
   *   refused   a served book this surface REFUSES to present (R12). Retained,
   *             disclosed, and never named a result anywhere.
   *   all-hole  a served book that named none of the engines the row's
   *             committed definition covers (R11) — presented only as
   *             UNANSWERED cells, so "the cells still show what this row
   *             already measured" would be false. The R13 adjacency, ruled by
   *             the integrator: a book that measured nothing is never called
   *             a measurement.
   *   unserved  the retained outcome carried no book either. Unreachable while
   *             `rerunFailed` is only written beside a held `kind: "ok"`
   *             outcome; stated rather than assumed.
   */
  retained: "result" | "refused" | "all-hole" | "unserved";
  /** For `refused`: the register the retained response is named by. Else null. */
  register: string | null;
  /**
   * WAVE R17 — WHICH SETTLEMENT DISPOSITION composed this line, published so a
   * surface (and a spec) can branch on the three truths without re-deriving them
   * from a pair of booleans.
   *
   *   defer             the row is judged by its retained BODY — a presented
   *                     result (R8), an all-hole book (R13b), a refused response
   *                     whose settlement this surface has nothing to say about,
   *                     or a settlement nothing was recorded for.
   *   attempt-skew      R16: the settlement was asked under a definition this
   *                     page no longer shows, so the cells read DEFINITION
   *                     CHANGED about IT.
   *   current-bodyless  R17: the settlement was this row's own attempt and it
   *                     served no book, so the cells read UNANSWERED about it.
   *
   * `attemptChanged` keeps its exact R16 meaning and is `disposition ===
   * "attempt-skew"` by construction — the two are one derivation, never two.
   */
  disposition: Settlement["disposition"];
  /**
   * WAVE R16 — whether the FAILED settlement this banner names was asked under a
   * committed definition this page is no longer showing.
   *
   * It is `attemptSkew(phase, identity) !== null` and nothing else — the same
   * call the cells, the cohort, the row note and the detail view make — so the
   * banner's account of what a reader will find in the cells is derived from the
   * thing that actually decides them, never guessed alongside it.
   *
   * True implies the covered cells read DEFINITION CHANGED about the ATTEMPT,
   * and the banner names the retained response WITHOUT claiming the cells speak
   * for it. False is every pre-R16 case, whose wording is untouched: a retained
   * body this surface presents keeps the row (R8), and its own register is what
   * the cells say.
   */
  attemptChanged: boolean;
  /** The whole sentence for the surface asked for. */
  line: string;
}

/**
 * The failed-re-run disclosure for one row, or null when there is none.
 *
 * `identity` is the listing's identity for the row, exactly as every other R12
 * read takes it: absent means the caller makes no identity claim and nothing is
 * inferred, so a retained response is judged on its BODY alone — which is the
 * same reading `cellState` and `resolveBatchCohort` give it.
 */
export function rerunFailedBanner(
  phase: MatrixPhase,
  identity: ScenarioIdentity | undefined,
  surface: RerunSurface,
  covered?: readonly string[],
): RerunFailedBanner | null {
  if (phase.kind !== "outcome" || phase.rerunFailed === undefined) return null;
  // WAVE R16 — R8's sentence, one field deeper and otherwise untouched.
  const failure = phase.rerunFailed.reason;
  const outcome = phase.outcome;
  // WAVE R16 — WHOSE SETTLEMENT WAS THIS? From `settlementOf`, which is the same
  // function the cells, the cohort, the row note and the detail view ask — so
  // this banner cannot describe cells that read something else.
  //
  // WAVE R17 — AND WITH THREE ANSWERS RATHER THAN TWO. `attemptChanged` keeps
  // its exact R16 meaning (it is `attempt-skew` and nothing else); the third
  // disposition gets its own arm below, because over it the cells read UNANSWERED
  // and every sentence that promises otherwise is false.
  const settlement = settlementOf(phase, identity);
  const settled = settlement.disposition === "attempt-skew";

  if (outcome.kind !== "ok") {
    return {
      failure,
      retained: "unserved",
      register: null,
      disposition: settlement.disposition,
      attemptChanged: settled,
      line: !settled
          ? `${surface === "matrix" ? "re-run" : "the re-run"} ended without a served book. ` +
            `${failure} This row holds no result and no served response at all: the earlier run ` +
            `ended without a book either, and ${
              surface === "matrix" ? "every covered cell" : "the outcome below"
            } says so.`
          : // Unreachable while `rerunFailed` is only written beside a held
            // `kind: "ok"` outcome, and stated rather than assumed — as this
            // arm already was before R16 gave it a second half.
            `${surface === "matrix" ? "re-run" : "the re-run"} ended without a served book. ` +
            `${failure} That request was ASKED under a committed definition this page is no ` +
            `longer showing, so it is not this row's attempt and ${
              surface === "matrix" ? "every covered cell" : "the panel below"
            } reads DEFINITION CHANGED about it. This row holds no result and no served response ` +
            `at all: the earlier run ended without a book either.`,
    };
  }

  const refusal = bookRefusal(outcome.response, identity);
  if (refusal === null) {
    // WAVE R16 — THE DISPOSITION IS `defer` HERE BY CONSTRUCTION, and the
    // invariant is the point rather than an accident: a retained body this
    // surface PRESENTS keeps the row (R8), so `settlementOf` declines to judge
    // the stamp and both arms below keep their pre-R16 wording with nothing to
    // qualify. R17 changes nothing here — its third disposition exists only over
    // a retained body `bookRefusal` REFUSES, which this arm is the absence of.
    //
    // THE R13 ADJACENCY (integrator-ruled): a retained ALL-HOLE book (R11 — a
    // 200 naming none of the row's covered engines) is presented only as
    // UNANSWERED cells, so the clean-retention sentence "the cells still show
    // what this row already measured" would be false above it. A book that
    // measured nothing is never called a measurement. `covered === undefined`
    // infers nothing — the same discipline as `isAllHoleBook` itself.
    if (isAllHoleBook(outcome.response, covered)) {
      return {
        failure,
        retained: "all-hole",
        register: null,
        disposition: "defer",
        attemptChanged: false,
        line:
          surface === "matrix"
            ? `re-run ended without a served book. ${failure} What this row still holds is ` +
              `NOT a result: it is a served book that named none of the engines this row's ` +
              `committed definition covers, and every covered cell reads UNANSWERED. Nothing ` +
              `was overwritten, and nothing was measured in its place.`
            : `the re-run ended without a served book. ${failure} What this row still holds ` +
              `is NOT a result: it is a served book that named none of the engines this row's ` +
              `committed definition covers, and the outcome below says so in its own words. ` +
              `Nothing was overwritten and nothing was invented in its place.`,
      };
    }
    // R8's ORIGINAL WORDING, VERBATIM. The clean case was never the defect and
    // its assertions stand unchanged; a response this surface DOES present is a
    // result, and calling it one is the honest thing.
    return {
      failure,
      retained: "result",
      register: null,
      disposition: "defer",
      attemptChanged: false,
      line:
        surface === "matrix"
          ? `re-run ended without a book. ${failure} The cells still show what this row ` +
            `already measured, at its own batch.`
          : `the re-run ended without a book. ${failure} The result below is the one this row ` +
            `already held, at the batch it was measured on; nothing was overwritten and nothing ` +
            `was invented in its place.`,
    };
  }

  // THE FINDING'S OWN SENTENCE. Two facts, neither borrowed from the other: the
  // re-run failed, AND what is retained is not a result. It is named by the same
  // register the cells and the detail view use for it, so the reader meets one
  // vocabulary for one response wherever they look.
  const register = CELL_STATE_LABEL[refusal.kind];

  // WAVE R16 — THREE FACTS NOW, AND STILL NONE BORROWED FROM ANOTHER. When the
  // settled request was asked under a definition this page no longer shows, the
  // covered cells read DEFINITION CHANGED about THAT ATTEMPT — not about the
  // retained response — so R13's sentence below, which tells the reader the
  // cells "name that refusal in its own words", would be a false account of what
  // they will find there. (It would be false OUTRIGHT whenever the retained
  // response is the CONTRADICTORY one: a banner naming CONTRADICTORY BOOK over
  // cells reading DEFINITION CHANGED is the two-registers-for-one-row defect
  // this file has closed four times.) The retained response is still disclosed,
  // still named by its own register, and still never called a result.
  if (settled) {
    return {
      failure,
      retained: "refused",
      register,
      disposition: "attempt-skew",
      attemptChanged: true,
      line:
        surface === "matrix"
          ? `re-run ended without a served book. ${failure} That request was ASKED under a ` +
            `committed definition this page is no longer showing, so it is not this row's ` +
            `attempt and every covered cell reads DEFINITION CHANGED about it. What this row ` +
            `still holds is NOT a result either: it is an EARLIER response this surface REFUSES ` +
            `to present (${register}), retained at its own batch pin. Nothing was overwritten, ` +
            `and nothing was measured in its place.`
          : `the re-run ended without a served book. ${failure} That request was ASKED under a ` +
            `committed definition this page is no longer showing, so it is not this row's ` +
            `attempt and the panel below reads DEFINITION CHANGED about it. What this row still ` +
            `holds is NOT a result either: it is an EARLIER response this surface REFUSES to ` +
            `present (${register}). Nothing was overwritten and nothing was invented in its ` +
            `place.`,
    };
  }

  // WAVE R17 — THE INVERSE ARM. The settlement was asked under the definition
  // this page IS showing, so it is this row's own attempt — and it served no
  // book, which makes every covered cell UNANSWERED rather than the retained
  // response's register. R13's sentence below promises the reader that the cells
  // "name that refusal in its own words"; over this row they name the ATTEMPT's
  // failure instead, so that promise had to go the same way R16's did.
  //
  // WHAT DOES NOT CHANGE: the retained response is still disclosed, still named
  // by its own register, and still never called a result. It is the settled
  // request's account that is corrected, not the retained body's.
  if (settlement.disposition === "current-bodyless") {
    return {
      failure,
      retained: "refused",
      register,
      disposition: "current-bodyless",
      // R16's flag, with R16's exact meaning: this settlement's definition did
      // NOT change. Saying it had would earn the row a remedy it does not need.
      attemptChanged: false,
      line:
        surface === "matrix"
          ? `re-run ended without a served book. ${failure} That request was ASKED under the ` +
            `definition this page IS showing, so it IS this row's CURRENT attempt and every ` +
            `covered cell reads UNANSWERED. What this row still holds is NOT a result either: ` +
            `it is an EARLIER response this surface REFUSES to present (${register}), retained ` +
            `at its own batch pin. Nothing was overwritten, and nothing was measured in its ` +
            `place.`
          : `the re-run ended without a served book. ${failure} That request was ASKED under ` +
            `the definition this page IS showing, so it IS this row's CURRENT attempt and the ` +
            `panel below reads UNANSWERED. What this row still holds is NOT a result either: it ` +
            `is an EARLIER response this surface REFUSES to present (${register}). Nothing was ` +
            `overwritten and nothing was invented in its place.`,
    };
  }

  return {
    failure,
    retained: "refused",
    register,
    disposition: "defer",
    attemptChanged: false,
    line:
      surface === "matrix"
        ? `re-run ended without a served book. ${failure} What this row still holds is NOT a ` +
          `result: it is the earlier response this surface REFUSES to present, and every covered ` +
          `cell of this row names that refusal in its own words (${register}). Nothing was ` +
          `overwritten, and nothing was measured in its place.`
        : `the re-run ended without a served book. ${failure} What this row still holds is NOT ` +
          `a result: it is the earlier response this surface REFUSES to present, named below in ` +
          `its own words (${register}). Nothing was overwritten and nothing was invented in its ` +
          `place.`,
  };
}

// ---------------------------------------------------------------------------
// WAVE R15, CODEX ROUND 23 — A REQUEST THAT IS STILL OUT HAS NOT FAILED AT
// ANYTHING, AND MAY NOT BE TOLD IT DID.
//
// THE DEFECT. R14 bound every bodyless phase to the identity it was DISPATCHED
// under and gave the resulting set its own remedy: this run never answered, so
// a listing refresh cannot help it — RE-RUN THE ROW. That is exactly right for a
// run that ENDED. It is false for one still in flight, and `attemptSkew` knew as
// much all along: its CELL wording already reads "The request is still out;
// whatever it answers will be judged by the identity the response publishes for
// ITSELF". The COHORT threw that distinction away, merging both into one count,
// so the header said over a live request that it "never came back with a book of
// its own" and directed the reader to re-run — while `matrix-run` and
// `run-book-button` are BOTH disabled for precisely as long as the request is
// out. A dead end, printed above a sentence that contradicts it.
//
// THE RULE: TWO STATES, TWO TRUTHS, AND NEITHER SENTENCE MAY BORROW THE OTHER'S.
//
//   running  the request is still out. No account of what came back is given,
//            because nothing came back and nothing failed to; NO remedy is named
//            anywhere, because waiting is the only one and it is not an action.
//   settled  R14's finding, intact: nothing will ever come back, a fresh listing
//            makes nothing readable, and only a re-run resolves it.
//
// ONE DERIVATION FOR ALL THREE SURFACES. `DefinitionSkew.pending` is published by
// `attemptSkew` from the same read its own reason branches on;
// `resolveBatchCohort` partitions its two subsets on it, the header clause counts
// those subsets, and the composer below — which BOTH the matrix row note and the
// detail view render — branches on it. There is no fourth place for the question
// to be answered differently.
// ---------------------------------------------------------------------------

/**
 * The row-level sentence for an attempt asked under another definition.
 *
 * Shared by both surfaces for R13's reason, which is now this file's habit: two
 * hand-written copies of one claim are two claims, and they drift. `surface`
 * selects the register, never the FACTS — the matrix note stands alone beside a
 * row, the detail tail lands after `skew.reason` and speaks about the panel.
 *
 * Only ever called with `subject: "attempt"`. A `response` skew has a body to
 * read and R12's own gate names it; passing one here would be asking the wrong
 * question of the wrong thing, and its `pending` is false by construction.
 */
export function attemptChangedNote(skew: DefinitionSkew, surface: RerunSurface): string {
  if (surface === "matrix") {
    // WAVE R15: no remedy is named, and the word "again" does not appear. The
    // run control beside this very sentence is disabled while the request is
    // out, so naming one would point at a button that cannot be clicked.
    return skew.pending
      ? "this row's request is still out, and was ASKED under a committed definition this page " +
          "is no longer showing. Whatever it answers will be judged by the identity the response " +
          "publishes for ITSELF, and a listing refresh resolves nothing here."
      : "this row's run was ASKED under a committed definition this page is no longer showing, " +
          "and never came back with a book of its own. A listing refresh resolves nothing, because the " +
          "listing is already the current one. Run this row again to ask under the definition " +
          "above.";
  }
  // The detail tail. R14's settled sentence is kept verbatim; the pending one
  // says only what this PANEL can establish, and never contradicts the reason it
  // is appended to — whose last words are that the request is still out.
  return skew.pending
    ? "This panel therefore shows no aggregate, no delta and no outcome register from it, and " +
        "there is nothing to do here until the request settles."
    : "No book came back from it, so there is nothing here for a listing refresh to make " +
        "readable, so this panel shows no aggregate, no delta and no outcome register from it.";
}
