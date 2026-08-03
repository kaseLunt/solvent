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
      : `NOT COVERED — ${scenario.id} moves ${axisFamilyWords(families)} and is defined for ` +
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
    }
  | {
      kind: "outcome";
      outcome: RunBookOutcome;
      /**
       * A LATER run that ended WITHOUT a book, named. `outcome` is still this
       * row's own evidence at its ORIGINAL batch pin: a run that could not
       * answer says nothing about the answer already held, so the failure is
       * disclosed BESIDE the result rather than overwriting it.
       */
      rerunFailed?: string;
    };

/** The batch a phase's DISPLAYED result is pinned to — null when it shows none. */
export function batchOfPhase(phase: MatrixPhase): number | null {
  if (phase.kind !== "outcome") return null;
  return phase.outcome.kind === "ok" ? phase.outcome.response.batch.id : null;
}

/**
 * The batch a phase's HELD evidence carries — this row's contribution to the
 * cohort WATERMARK, in-flight rows included.
 *
 * It differs from `batchOfPhase` by exactly the re-run window, and that
 * difference IS the fix: a running row displays nothing (so it is neither
 * current nor superseded on screen) while still vouching for the batch it
 * measured (so nothing older can claim to be current in its absence).
 */
export function anchorBatchOfPhase(phase: MatrixPhase): number | null {
  const outcome =
    phase.kind === "running"
      ? phase.held
      : phase.kind === "outcome"
        ? phase.outcome
        : undefined;
  if (outcome === undefined) return null;
  return outcome.kind === "ok" ? outcome.response.batch.id : null;
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
): BatchCohort {
  let anchorBatchId: number | null = floorBatchId;
  for (const phase of phases.values()) {
    const batch = anchorBatchOfPhase(phase);
    if (batch !== null && (anchorBatchId === null || batch > anchorBatchId)) anchorBatchId = batch;
  }
  const currentScenarioIds: string[] = [];
  const supersededScenarioIds: string[] = [];
  const inFlightScenarioIds: string[] = [];
  const attemptedScenarioIds: string[] = [];
  const unansweredScenarioIds: string[] = [];
  const inFlightHeldPins: BatchPin[] = [];
  const displayedPins: BatchPin[] = [];
  for (const [scenarioId, phase] of phases) {
    // IDLE IS NOT AN ATTEMPT. Everything else is, and stays one: that is what
    // makes "no run has been issued yet" a claim this session can actually
    // check rather than an inference from "no batch came back".
    if (phase.kind === "idle") continue;
    attemptedScenarioIds.push(scenarioId);
    if (phase.kind === "running") {
      inFlightScenarioIds.push(scenarioId);
      const heldBatch = anchorBatchOfPhase(phase);
      if (heldBatch !== null) inFlightHeldPins.push({ scenarioId, batchId: heldBatch });
      continue;
    }
    const batch = batchOfPhase(phase);
    if (batch === null) {
      unansweredScenarioIds.push(scenarioId);
      continue;
    }
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
// THE ONE PRINCIPLE, from which every clause below follows: EVERY CLAUSE IS A
// STATEMENT ABOUT A NAMED SET the reader can point at — displayed rows, rows
// asked, rows in flight, held pins. The WATERMARK appears in exactly one clause,
// the floor disclosure, where it is named as what it is and nothing is inferred
// from it.
// ---------------------------------------------------------------------------

/** No run at all: a statement about this session, never about the book. */
export const MATRIX_NO_RUN_LINE =
  "no run has been issued yet — every covered cell reads “not run”, which is a " +
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
 * covers the two states a first run can be in when it has produced no batch:
 * still IN FLIGHT, and ENDED WITHOUT A BOOK. Both leave real, non-idle cells on
 * screen — "running…" and "UNANSWERED" — and the header's job is to agree with
 * them, name what happened, and decline to name a batch it does not have.
 */
function firstResultPendingClause(cohort: BatchCohort): string {
  const inFlight = cohort.inFlightScenarioIds.length;
  const unanswered = cohort.unansweredScenarioIds.length;
  const facts: string[] = [];
  if (inFlight > 0) facts.push(`${String(inFlight)} run(s) are in flight`);
  if (unanswered > 0) facts.push(`${String(unanswered)} run(s) ended without a served result`);
  // Unreachable while a phase can only be idle / running / outcome — an ok
  // outcome would have given an anchor. Stated rather than assumed.
  if (facts.length === 0) {
    return "no result is displayed on this table, and no batch can be named for one.";
  }
  return (
    `no result has been served to this table yet: ${facts.join(", and ")}. There is no batch ` +
    `for this table to be as of — and this is NOT “not run”: every row counted here was asked, ` +
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
  if (cohort.attemptedScenarioIds.length === 0 && cohort.anchorBatchId === null) {
    return MATRIX_NO_RUN_LINE;
  }
  if (cohort.anchorBatchId === null) return firstResultPendingClause(cohort);
  const batch = `#${String(cohort.anchorBatchId)}`;
  const older = cohort.supersededScenarioIds.length;
  if (cohort.currentScenarioIds.length === 0) {
    return (
      `batch ${batch} is the newest batch this table has seen and the floor its as-of never ` +
      `falls below — but NO result now displayed was measured at it. ` +
      (older === 0
        ? "No row is displaying a result at all right now, so there is no cohort to read together."
        : `${String(older)} row(s) are displayed and every one of them is OLDER, marked ` +
          `SUPERSEDED at its own batch pin — there is no batch ${batch} cohort here to read ` +
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
      : ` ${String(older)} row(s) still hold an older batch's result and are marked SUPERSEDED — they are shown, never blended into the sentence above.`)
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
    `${batchWords(older.map((pin) => pin.batchId))} while the request is out — held evidence, ` +
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
    ` ${String(cohort.unansweredScenarioIds.length)} row(s) display UNANSWERED — their run ` +
    `ended without a served book, which is neither a zero nor a “not run”, and joins no batch ` +
    `sentence here.`
  );
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
      : `${lead} — a different batch from this table's displayed cohort, which is why the two ` +
          `are never read as one number.`;
  }
  if (cohort.displayedPins.length === 0) return `${lead}.`;
  const matching = cohort.displayedPins.filter((pin) => pin.batchId === frontierBatchId).length;
  const displayed = cohort.displayedPins.length;
  return matching === 0
    ? `${lead} — no result displayed here was measured at it, and this table names no cohort ` +
        `of its own, so no same-or-different claim is made for the table as a whole.`
    : `${lead} — the same batch ${String(matching)} of the ${String(displayed)} displayed ` +
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
 * the frontier's separate read.
 */
export function batchHeaderLine(cohort: BatchCohort, frontierBatchId: number | null): string {
  return (
    cohortClause(cohort) +
    heldPinClause(cohort) +
    inFlightClause(cohort) +
    unansweredClause(cohort) +
    frontierClause(cohort, frontierBatchId)
  );
}

// ---------------------------------------------------------------------------
// Cell states.
// ---------------------------------------------------------------------------

/** What a superseded cell was HOLDING when the batch moved out from under it. */
export type SupersededPayload =
  | { kind: "result"; engine: LabRunBookEngine }
  | { kind: "withheld"; refusal: EngineRefusal }
  | { kind: "absent" };

/**
 * Every state one cell can be in. The five the ruling names — not run,
 * running, result, NOT COVERED, WITHHELD — plus the two the honesty register
 * forces:
 *
 *   superseded  the single-batch guard's own named state (ruling item 4: a
 *               result from a superseded batch is never silently mixed).
 *   unanswered  the run ENDED without a book for this engine — a 404/503/429/
 *               network failure, or a 200 that named the engine in neither
 *               `engines` nor `excluded_engines`. "A scenario the batch cannot
 *               answer is not a zero" (ruling item 6), so it is not a result,
 *               and it is not a refusal either — nobody refused anything.
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
  | { state: "unanswered"; reason: string };

/** The honest sentence for each way a run can end without a book. */
export function unansweredReason(outcome: Exclude<RunBookOutcome, { kind: "ok" }>): string {
  switch (outcome.kind) {
    case "not-served":
      return "this deployment answered 404 — book-wide stress is not served here. A fact about the DEPLOYMENT, not about the scenario.";
    case "no-batch":
      return `no servable batch (503): ${outcome.message}${
        outcome.retryAfterSeconds === null
          ? ""
          : ` · retry after ${String(outcome.retryAfterSeconds)}s`
      }`;
    case "rate-limited":
      return outcome.retryAfterSeconds === null
        ? "rate limited (429) — the service did not say when to retry."
        : `rate limited (429) — the service says retry after ${String(outcome.retryAfterSeconds)}s.`;
    case "unreachable":
      return `the API could not be reached (${outcome.message}) — this says nothing about the book.`;
    case "failed":
      return `the run failed (${String(outcome.status)}): ${outcome.message}`;
  }
}

function payloadFor(response: LabRunBook, engine: string): SupersededPayload {
  const served = response.engines.find((candidate) => candidate.engine === engine);
  if (served !== undefined) return { kind: "result", engine: served };
  const refusal = response.excluded_engines.find((candidate) => candidate.engine === engine);
  if (refusal !== undefined) return { kind: "withheld", refusal };
  return { kind: "absent" };
}

export interface CellStateInput {
  scenario: Pick<ScenarioDefinition, "id" | "engines" | "shocks">;
  engine: string;
  phase: MatrixPhase;
  cohort: BatchCohort;
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
 *   3. running                  → running (never blank, never a stale value).
 *      The phase's `held` evidence is NOT rendered here — showing a previous
 *      batch's number under a live request is exactly the stale value this
 *      state exists to avoid. It anchors the cohort and nothing else, which is
 *      why every OLDER row keeps its SUPERSEDED state for the whole in-flight
 *      window (Wave R8).
 *   4. an outcome without a book → unanswered, with the reason named
 *   5. an outcome from an OLDER batch than the cohort anchor → superseded,
 *      carrying whatever it held, and NEVER read alongside the anchor's cells
 *      as one sentence
 *   6. a served engine          → result
 *   7. a refused engine         → withheld, refusal register attached
 *   8. neither                  → unanswered: a hole the surface refuses to
 *      fill with a zero
 */
export function cellState(input: CellStateInput): LabCellState {
  const coverage = scenarioCoverage(input.scenario, input.engine);
  if (!coverage.covered) return { state: "not-covered", coverage };

  const { phase, cohort, engine } = input;
  if (phase.kind === "idle") return { state: "not-run" };
  if (phase.kind === "running") return { state: "running" };

  if (phase.outcome.kind !== "ok") {
    return { state: "unanswered", reason: unansweredReason(phase.outcome) };
  }

  const response = phase.outcome.response;
  const batchId = response.batch.id;
  if (cohort.anchorBatchId !== null && batchId !== cohort.anchorBatchId) {
    return {
      state: "superseded",
      payload: payloadFor(response, engine),
      batchId,
      anchorBatchId: cohort.anchorBatchId,
    };
  }

  const served = response.engines.find((candidate) => candidate.engine === engine);
  if (served !== undefined) return { state: "result", engine: served, batchId };

  const refusal = response.excluded_engines.find((candidate) => candidate.engine === engine);
  if (refusal !== undefined) return { state: "withheld", refusal, batchId };

  return {
    state: "unanswered",
    reason:
      `the run returned neither a result nor a refusal for ${engine} — the committed ` +
      "definition claims this engine, so its absence is a hole, and this surface will not " +
      "fill a hole with a zero.",
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
};
