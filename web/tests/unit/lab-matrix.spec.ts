// W-SD-A — the scenario × engine matrix's decision layer, pinned.
//
// THE LOAD-BEARING LAW (ruling item 6): not-covered ≠ withheld. An engine the
// committed DEFINITION never names is outside the scenario's model — knowable
// cold, from the listing, with zero runs; an engine a run's `excluded_engines`
// names is a REFUSAL. This spec fails if the two ever collapse into one state,
// and it fails if not-covered is ever inferred from a failure.
//
// THE SINGLE-BATCH GUARD: results shown together come from ONE batch. The
// anchor is the newest held batch; anything older is its own named state, kept
// on screen with its own batch id. A result never silently joins a cohort it
// was not measured in.

import { expect, test } from "@playwright/test";
import type { EngineRefusal, ScenarioDefinition, Shock } from "@solvent/client";
import {
  RUN_BOOK_BATCH_2,
  RUN_BOOK_CONTRADICTORY,
  RUN_BOOK_ETH,
  RUN_BOOK_ETHFI_V2,
  RUN_BOOK_NAMED_TWICE,
  RUN_BOOK_NAMES_NOBODY,
  RUN_BOOK_PARTIAL_HOLE,
  RUN_BOOK_WEETH_BATCH_1,
  RUN_BOOK_WEETH_V2,
  RUN_BOOK_WITHHELD,
  SCENARIOS,
  SCENARIOS_RELISTED,
  SCENARIOS_REMOVED,
  SCENARIOS_V2,
} from "../fixtures/lab-book";
import type { LabRunBook, RunBookOutcome } from "../../lib/runbook";
import {
  anchorBatchOfPhase,
  attemptSkew,
  AXIS_FAMILY_WORDS,
  axisFamilies,
  axisFamilyWords,
  batchHeaderLine,
  batchOfPhase,
  bookContradiction,
  bookHoleEngines,
  bookReachedEveryCoveredEngine,
  bookRefusal,
  CELL_STATE_LABEL,
  cellState,
  definitionSkew,
  isAllHoleBook,
  listedPhases,
  matrixColumns,
  MATRIX_NO_RUN_LINE,
  observedAnchorBatch,
  rerunFailedBanner,
  resolveBatchCohort,
  rowCoverage,
  rowIdentity,
  scenarioCoverage,
  servedIdentity,
  unansweredReason,
  type MatrixPhase,
  type ScenarioIdentity,
} from "../../app/lab/matrixCells";

const definitions = SCENARIOS.scenarios;
const byId = (id: string): ScenarioDefinition => {
  const found = definitions.find((scenario) => scenario.id === id);
  if (found === undefined) throw new Error(`fixture carries no scenario ${id}`);
  return found;
};

const ETH = byId("eth_minus_30"); // both engines, eth_usd
const DEPEG = byId("weeth_market_depeg_oracles_held"); // both engines, NO shocks
const RATE = byId("dm_rate_horizon_plus_200bps"); // debt_manager only, borrow_apy
const ETHFI = byId("ethfi_minus_50"); // debt_manager only, asset_usd

/** A run outcome from a committed fixture body, verdicts already sealed. */
function ok(body: typeof RUN_BOOK_ETH): MatrixPhase {
  return { kind: "outcome", outcome: { kind: "ok", response: body as unknown as LabRunBook } };
}

/**
 * A row whose re-run is IN FLIGHT while it still holds what it measured — the
 * state Wave R8 introduced. It renders "running…"; its batch keeps anchoring.
 */
function runningHolding(body: typeof RUN_BOOK_ETH): MatrixPhase {
  return { kind: "running", held: { kind: "ok", response: body as unknown as LabRunBook } };
}

// ---------------------------------------------------------------------------
// axisFamilies() — the vocabulary a not-covered cell explains itself in.
// ---------------------------------------------------------------------------

test("axisFamilies folds the contract's sealed axis enum, deduped, in wire order", () => {
  expect(axisFamilies(ETH.shocks)).toEqual(["eth_price"]);
  expect(axisFamilies(RATE.shocks)).toEqual(["borrow_rate"]);
  expect(axisFamilies(ETHFI.shocks)).toEqual(["asset_price"]);
  // Three stable_usd shocks on three assets are ONE family, once.
  const stables: Shock[] = [
    { axis: "stable_usd", asset: "0x1", factor_num: 98, factor_den: 100 },
    { axis: "stable_usd", asset: "0x2", factor_num: 98, factor_den: 100 },
    { axis: "stable_usd", asset: "0x3", factor_num: 98, factor_den: 100 },
  ];
  expect(axisFamilies(stables)).toEqual(["stable_price"]);
  // Wire order, not alphabetical.
  expect(
    axisFamilies([
      { axis: "borrow_apy", factor_num: 1, factor_den: 1 },
      { axis: "eth_usd", factor_num: 70, factor_den: 100 },
    ]),
  ).toEqual(["borrow_rate", "eth_price"]);
});

test("a SHOCKLESS scenario is not an empty scenario — it carries a market-realization axis", () => {
  // The wire's own note: a scenario can carry its information "on another
  // axis — a projection over time, or a market realization the oracles do not
  // see". Rendering that as a blank would be the lie.
  expect(DEPEG.shocks).toHaveLength(0);
  expect(axisFamilies(DEPEG.shocks)).toEqual(["market_realization"]);
  expect(AXIS_FAMILY_WORDS.market_realization).toContain("no oracle mark moves");
});

test("axisFamilyWords joins reader words, never field names", () => {
  expect(axisFamilyWords(["eth_price"])).toBe("the ETH mark");
  expect(axisFamilyWords(["stable_price", "borrow_rate"])).toBe(
    "the stablecoin marks and the borrow rate",
  );
});

// ---------------------------------------------------------------------------
// NOT COVERED — structural, from the listing, before any run.
// ---------------------------------------------------------------------------

test("NOT COVERED comes from the committed listing and is knowable with ZERO runs", () => {
  const cold = cellState({
    scenario: RATE,
    engine: "aave_v3_etherfi",
    phase: { kind: "idle" },
    cohort: resolveBatchCohort(new Map()),
  });
  expect(cold.state).toBe("not-covered");
  if (cold.state !== "not-covered") throw new Error("unreachable");
  expect(cold.coverage.reason).toContain("NOT COVERED");
  expect(cold.coverage.reason).toContain("the borrow rate");
  expect(cold.coverage.reason).toContain("defined for debt_manager");
  expect(cold.coverage.reason).toContain("not a refusal and not a failed run");
});

test("NOT COVERED is NEVER inferred from a failure — a failure is its own state", () => {
  const failed: MatrixPhase = {
    kind: "outcome",
    outcome: { kind: "failed", status: 500, message: "boom" },
  };
  // The engine IS in the definition, so a failure can never read as undefined.
  const covered = cellState({
    scenario: ETH,
    engine: "aave_v3_etherfi",
    phase: failed,
    cohort: resolveBatchCohort(new Map()),
  });
  expect(covered.state).toBe("unanswered");
  // And the reverse: a failure on a scenario that never named the engine still
  // reads as NOT COVERED, because coverage is structural and outranks it.
  const uncovered = cellState({
    scenario: RATE,
    engine: "aave_v3_etherfi",
    phase: failed,
    cohort: resolveBatchCohort(new Map()),
  });
  expect(uncovered.state).toBe("not-covered");
});

test("coverage FOLLOWS the definition — add the engine and the cell is covered", () => {
  const widened: ScenarioDefinition = { ...RATE, engines: [...RATE.engines, "aave_v3_etherfi"] };
  expect(scenarioCoverage(RATE, "aave_v3_etherfi").covered).toBe(false);
  expect(scenarioCoverage(widened, "aave_v3_etherfi").covered).toBe(true);
});

test("matrixColumns is the union of the definitions' engines, in wire order", () => {
  expect(matrixColumns(definitions)).toEqual(["aave_v3_etherfi", "debt_manager"]);
  expect(matrixColumns([RATE, ETHFI])).toEqual(["debt_manager"]);
  expect(matrixColumns([])).toEqual([]);
});

// ---------------------------------------------------------------------------
// WITHHELD — a refusal, with its register.
// ---------------------------------------------------------------------------

test("WITHHELD renders the refusal register and never looks like NOT COVERED", () => {
  const phases = new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_WITHHELD)]]);
  const cell = cellState({
    scenario: DEPEG,
    engine: "aave_v3_etherfi",
    phase: phases.get(DEPEG.id) as MatrixPhase,
    cohort: resolveBatchCohort(phases),
  });
  expect(cell.state).toBe("withheld");
  if (cell.state !== "withheld") throw new Error("unreachable");
  const refusal: EngineRefusal = cell.refusal;
  expect(refusal.code).toBe("FLAG_CUSTODY_UNPROVEN");
  expect(refusal.detail.length).toBeGreaterThan(0);
  // The definition DOES name aave — the absence is a refusal, not a model gap.
  expect(DEPEG.engines).toContain("aave_v3_etherfi");
  expect(scenarioCoverage(DEPEG, "aave_v3_etherfi").covered).toBe(true);
});

// ---------------------------------------------------------------------------
// The single-batch guard.
// ---------------------------------------------------------------------------

test("the cohort ANCHOR is the NEWEST held batch — a fresh run is never demoted", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // batch 1
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)], // batch 2
  ]);
  const cohort = resolveBatchCohort(phases);
  expect(cohort.anchorBatchId).toBe(2);
  expect(cohort.currentScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.supersededScenarioIds).toEqual([ETH.id]);
});

test("a result from a superseded batch renders as its OWN named state, never as a result", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)],
  ]);
  const cohort = resolveBatchCohort(phases);
  const stale = cellState({
    scenario: ETH,
    engine: "debt_manager",
    phase: phases.get(ETH.id) as MatrixPhase,
    cohort,
  });
  expect(stale.state).toBe("superseded");
  if (stale.state !== "superseded") throw new Error("unreachable");
  expect(stale.batchId).toBe(1);
  expect(stale.anchorBatchId).toBe(2);
  // It still CARRIES what it measured — a superseded measurement is a real
  // measurement of a real batch, and hiding it would be its own dishonesty.
  expect(stale.payload.kind).toBe("result");

  const fresh = cellState({
    scenario: DEPEG,
    engine: "debt_manager",
    phase: phases.get(DEPEG.id) as MatrixPhase,
    cohort,
  });
  expect(fresh.state).toBe("result");
});

test("one batch across every held result: nothing is marked superseded", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // batch 1
    [DEPEG.id, ok(RUN_BOOK_WITHHELD)], // batch 1
  ]);
  const cohort = resolveBatchCohort(phases);
  expect(cohort.anchorBatchId).toBe(1);
  expect(cohort.supersededScenarioIds).toEqual([]);
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: phases.get(ETH.id) as MatrixPhase,
      cohort,
    }).state,
  ).toBe("result");
});

test("phases carrying no book contribute NO batch to the cohort", () => {
  expect(batchOfPhase({ kind: "idle" })).toBeNull();
  expect(batchOfPhase({ kind: "running" })).toBeNull();
  expect(batchOfPhase({ kind: "outcome", outcome: { kind: "not-served" } })).toBeNull();
  expect(batchOfPhase(ok(RUN_BOOK_ETH))).toBe(1);

  const phases = new Map<string, MatrixPhase>([
    [ETH.id, { kind: "running" }],
    [DEPEG.id, { kind: "outcome", outcome: { kind: "not-served" } }],
  ]);
  const cohort = resolveBatchCohort(phases);
  expect(cohort.anchorBatchId).toBeNull();
  expect(cohort.currentScenarioIds).toEqual([]);
});

// ---------------------------------------------------------------------------
// WAVE R8 (Codex round-16 finding 2) — THE ANCHOR IS MONOTONIC.
//
// THE DEFECT: starting a re-run replaced the row's outcome with a bare
// `{kind:"running"}`, deleting the batch that row was pinned to. If the row
// held the NEWEST batch — the cohort anchor — the anchor fell back to an older
// batch for the whole in-flight window and every previously-SUPERSEDED row
// repainted as a current RESULT, under a header sentence naming the older
// batch as the one every visible result was measured at. A failed or
// unanswered re-run left them that way.
// ---------------------------------------------------------------------------

test("R8 — a re-running row still ANCHORS the cohort with what it holds", () => {
  // ETH holds batch 1; DEPEG holds batch 2 and IS the anchor.
  const settled = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)],
  ]);
  expect(resolveBatchCohort(settled).anchorBatchId).toBe(2);

  // The anchor row is re-run. It renders "running…" — but its evidence travels
  // with it, so batch 2 is still the cohort's as-of.
  const inFlight = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, runningHolding(RUN_BOOK_BATCH_2)],
  ]);
  const cohort = resolveBatchCohort(inFlight);
  expect(cohort.anchorBatchId).toBe(2);

  // The running row DISPLAYS nothing, so it is in neither the current nor the
  // superseded list — counting a cell nobody can see would make the header's
  // own sentence a claim about an invisible row.
  expect(cohort.inFlightScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.supersededScenarioIds).toEqual([ETH.id]);

  // AND THE OLDER ROW STAYS SUPERSEDED FOR THE WHOLE WINDOW. This is the
  // assertion the finding is about: it used to read "result" here.
  const stale = cellState({
    scenario: ETH,
    engine: "debt_manager",
    phase: ok(RUN_BOOK_ETH),
    cohort,
  });
  expect(stale.state).toBe("superseded");
  if (stale.state !== "superseded") throw new Error("unreachable");
  expect(stale.batchId).toBe(1);
  expect(stale.anchorBatchId).toBe(2);

  // The in-flight row renders RUNNING and never its held value: a previous
  // batch's number under a live request is exactly the stale value the running
  // state exists to avoid.
  expect(
    cellState({
      scenario: DEPEG,
      engine: "debt_manager",
      phase: runningHolding(RUN_BOOK_BATCH_2),
      cohort,
    }).state,
  ).toBe("running");
});

test("R8 — the WATERMARK keeps the anchor even with the newest row's evidence GONE", () => {
  // The ruling's second mechanism, exercised with the newest row absent
  // BECAUSE RUNNING — no `held` at all. Retention alone would let the anchor
  // fall to 1 here; the caller's watermark says the cohort's as-of never moves
  // backwards while the panel lives, and that is the law rather than a
  // consequence of how the phase happens to be shaped.
  const erased = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // batch 1
    [DEPEG.id, { kind: "running" }], // the batch-2 row, evidence gone
  ]);
  expect(resolveBatchCohort(erased).anchorBatchId).toBe(1); // unfloored: the defect
  const floored = resolveBatchCohort(erased, 2);
  expect(floored.anchorBatchId).toBe(2);
  expect(floored.currentScenarioIds).toEqual([]);
  expect(floored.supersededScenarioIds).toEqual([ETH.id]);
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: ok(RUN_BOOK_ETH), cohort: floored })
      .state,
  ).toBe("superseded");

  // The floor is a FLOOR, never a ceiling: a newer held batch still wins.
  expect(resolveBatchCohort(settledAtTwo(), 1).anchorBatchId).toBe(2);
});

/** ETH @1 + DEPEG @2, both settled — the ordinary two-batch matrix. */
function settledAtTwo(): Map<string, MatrixPhase> {
  return new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)],
  ]);
}

test("R8 — held evidence anchors; DISPLAYED evidence classifies. The two are separate reads", () => {
  const running = runningHolding(RUN_BOOK_BATCH_2);
  // What the row SHOWS: nothing — so it pins no cell to a batch.
  expect(batchOfPhase(running)).toBeNull();
  // What the row HOLDS: batch 2 — so it vouches for the cohort's as-of.
  expect(anchorBatchOfPhase(running)).toBe(2);
  // A row that never had a result contributes to neither, exactly as before.
  expect(anchorBatchOfPhase({ kind: "running" })).toBeNull();
  expect(anchorBatchOfPhase({ kind: "idle" })).toBeNull();
  // A non-ok held outcome carries no batch either — there is nothing to anchor.
  expect(
    anchorBatchOfPhase({ kind: "running", held: { kind: "not-served" } }),
  ).toBeNull();
});

test("R8 — a FAILED re-run gives the prior outcome back, at its ORIGINAL batch pin", () => {
  // What `LabBookPanel.run` writes when a re-run ends without a book: the
  // outcome it was re-running, unchanged, plus the failure NAMED beside it.
  // Replacing a real measurement with a 503 would lose evidence to an event
  // that says nothing about it — and drop the anchor in the same motion.
  const restored: MatrixPhase = {
    kind: "outcome",
    outcome: { kind: "ok", response: RUN_BOOK_BATCH_2 as unknown as LabRunBook },
    rerunFailed: unansweredReason({
      kind: "no-batch",
      message: "no complete risk batch is available.",
      retryAfterSeconds: 5,
    }),
  };
  expect(batchOfPhase(restored)).toBe(2);
  expect(anchorBatchOfPhase(restored)).toBe(2);
  expect(restored.rerunFailed).toContain("no servable batch (503)");
  expect(restored.rerunFailed).toContain("retry after 5s");

  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, restored],
  ]);
  const cohort = resolveBatchCohort(phases);
  // The anchor never fell, so the older row was never repainted as current.
  expect(cohort.anchorBatchId).toBe(2);
  expect(cohort.supersededScenarioIds).toEqual([ETH.id]);
  expect(
    cellState({ scenario: DEPEG, engine: "debt_manager", phase: restored, cohort }).state,
  ).toBe("result");
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: ok(RUN_BOOK_ETH), cohort }).state,
  ).toBe("superseded");
});

// ===========================================================================
// WAVE R9 (Codex round-17 finding 1) — THE WATERMARK IS A FLOOR, NOT AN AS-OF.
//
// THE DEFECT: R8's monotonic watermark was also being read as the header's
// as-of claim, and the two are different truths.
//
//   THE WATERMARK answers "what is the newest batch this panel has seen?" It is
//   a FLOOR on the anchor, and its whole job is to stop a superseded row
//   repainting as current when the newest row's evidence leaves the table.
//
//   THE AS-OF CLAIM answers "what batch was everything I can see measured at?"
//   That is a statement about what is DISPLAYED.
//
// They agree until a re-run SUCCEEDS and comes back pinned to an OLDER batch —
// the pruned/receded daemon case the watermark exists for. R8's machinery
// behaves perfectly: the watermark holds at #2 and every displayed result is
// correctly marked SUPERSEDED. But with the batch-2 result gone, NO row holds
// batch 2 — and the header went on saying "results shown together were measured
// at batch #2" over a cohort with zero members.
// ===========================================================================

/** ETH @1 + DEPEG @1 — what the table displays after the receded re-run. */
function recededToOne(): Map<string, MatrixPhase> {
  return new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, ok(RUN_BOOK_WEETH_BATCH_1)],
  ]);
}

test("R9 — THE SEQUENCE: an anchor re-run that SUCCEEDS at an OLDER batch empties the cohort", () => {
  // (1) ETH runs. Batch 1 is the only held result, so it IS the cohort.
  const one = new Map<string, MatrixPhase>([[ETH.id, ok(RUN_BOOK_ETH)]]);
  const atOne = resolveBatchCohort(one, null);
  expect(atOne.anchorBatchId).toBe(1);
  expect(atOne.currentScenarioIds).toEqual([ETH.id]);

  // (2) DEPEG runs and lands on batch 2. It becomes the anchor; ETH supersedes.
  const atTwo = resolveBatchCohort(settledAtTwo(), 1);
  expect(atTwo.anchorBatchId).toBe(2);
  expect(atTwo.currentScenarioIds).toEqual([DEPEG.id]);
  expect(atTwo.supersededScenarioIds).toEqual([ETH.id]);

  // (3) THE ANCHOR ROW IS RE-RUN AND SUCCEEDS — pinned to batch 1. Not a
  // failure, not a refusal: a 200 carrying an OLDER batch, which is exactly
  // what a daemon that pruned or receded returns.
  const cohort = resolveBatchCohort(recededToOne(), 2);

  // R8'S LAW HOLDS, UNTOUCHED: the watermark did not fall to 1.
  expect(cohort.anchorBatchId).toBe(2);
  // AND THE COHORT AT THAT WATERMARK IS EMPTY. This is the fact the header was
  // not consulting — it read the watermark and claimed a batch-2 cohort.
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.supersededScenarioIds).toEqual([ETH.id, DEPEG.id]);

  // EVERY DISPLAYED CELL IS SUPERSEDED, each carrying its OWN batch pin — which
  // is why the header can decline to name a shared one without hiding anything.
  for (const scenario of [ETH, DEPEG]) {
    const cell = cellState({
      scenario,
      engine: "debt_manager",
      phase: recededToOne().get(scenario.id) as MatrixPhase,
      cohort,
    });
    expect(cell.state).toBe("superseded");
    if (cell.state !== "superseded") throw new Error("unreachable");
    expect(cell.batchId).toBe(1);
    expect(cell.anchorBatchId).toBe(2);
  }
});

test("R9 — THE HEADER: with no current result, it NAMES NO COHORT at the watermark", () => {
  const line = batchHeaderLine(resolveBatchCohort(recededToOne(), 2), null);

  // THE FIX, in full. The watermark is stated as what it IS — a floor on the
  // as-of — and the claim about what is displayed is made separately and
  // truthfully.
  expect(line).toBe(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls " +
      "below — but NO result now displayed was measured at it. 2 row(s) are displayed and " +
      "every one of them is OLDER, marked SUPERSEDED at its own batch pin — there is no " +
      "batch #2 cohort here to read them as one.",
  );

  // THE OLD SENTENCE IS GONE. This is the assertion the finding is about: it
  // used to claim a batch-2 cohort over a table where zero rows held batch 2.
  expect(line).not.toContain("results shown together were measured at batch #2");
  expect(line).not.toContain("results shown together");
  // And it does not silently walk BACKWARDS to batch 1 either — the receded
  // batch is never promoted into the header's place. Each row states its own.
  expect(line).not.toContain("batch #1");
});

test("R9 — WHEN CURRENT RESULTS EXIST THE SENTENCE IS UNCHANGED, watermark or not", () => {
  // The arm the ruling leaves alone. A floored cohort with a live current row
  // reads exactly as it did before R9 — the fix narrows a false claim, it does
  // not rewrite the true one.
  expect(batchHeaderLine(resolveBatchCohort(settledAtTwo(), 1), null)).toBe(
    "results shown together were measured at batch #2. 1 row(s) still hold an older batch's " +
      "result and are marked SUPERSEDED — they are shown, never blended into the sentence above.",
  );
  // …and with every displayed result on the anchor, the same as before.
  //
  // WAVE R10 CHANGED THIS EXPECTATION (round-18 finding 2). The assurance used
  // to read "Every held result is on that batch." — a claim over HELD evidence,
  // which includes the pin an IN-FLIGHT row is still carrying and which the
  // displayed lists deliberately omit. In THIS cohort the two sets coincide, so
  // the old sentence was not false here; it was false in the cohort pinned by
  // the R10 held-pin test below, and a sentence that is only sometimes true is
  // not the sentence to ship. It now speaks about what is DISPLAYED, always.
  const allCurrent = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_BATCH_2)],
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)],
  ]);
  expect(batchHeaderLine(resolveBatchCohort(allCurrent, 2), null)).toBe(
    "results shown together were measured at batch #2. Every DISPLAYED result was measured at that batch.",
  );
});

test("R9 — THE IN-FLIGHT WINDOW is the same statement: nothing displayed is at the watermark", () => {
  // A row running while HOLDING the anchor displays nothing (R8), so during
  // that window no displayed result is at batch 2 either. The honest sentence
  // is the same one, and the in-flight disclosure still rides beside it.
  const inFlight = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, runningHolding(RUN_BOOK_BATCH_2)],
  ]);
  const cohort = resolveBatchCohort(inFlight, 2);
  expect(cohort.anchorBatchId).toBe(2);
  expect(cohort.currentScenarioIds).toEqual([]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toContain("NO result now displayed was measured at it");
  expect(line).toContain(
    "1 row(s) are displayed and every one of them is OLDER, marked SUPERSEDED at its own batch pin",
  );
  // R8'S OWN DISCLOSURE IS UNTOUCHED — the watermark still says why it cannot
  // move backwards, which is what stops the reader inferring a moved batch.
  expect(line).toContain("1 row(s) have a run in flight");
  expect(line).toContain("never moves backwards");
  expect(line).not.toContain("results shown together");
});

test("R9 — A WATERMARK WITH NOTHING DISPLAYED AT ALL says exactly that", () => {
  // Every row in flight, none of them holding: the anchor stands only on the
  // caller's floor, and there is not one result on screen. The sentence refuses
  // to describe a cohort AND refuses to pretend the watermark is not there.
  const nothing = new Map<string, MatrixPhase>([[ETH.id, { kind: "running" }]]);
  const cohort = resolveBatchCohort(nothing, 2);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.supersededScenarioIds).toEqual([]);
  const line = batchHeaderLine(cohort, null);
  expect(line).toContain(
    "No row is displaying a result at all right now, so there is no cohort to read together.",
  );
  expect(line).not.toContain("results shown together were measured");
});

test("R9 — the no-run and frontier clauses are carried through the header model verbatim", () => {
  // The model owns the WHOLE line now, so the clauses the component used to
  // append are pinned here rather than only in the browser.
  const cold = resolveBatchCohort(new Map());
  expect(batchHeaderLine(cold, null)).toBe(MATRIX_NO_RUN_LINE);
  expect(MATRIX_NO_RUN_LINE).toContain("a statement about this session, not about the book");

  // A frontier batch is DISCLOSED, and named as a different batch when it is.
  expect(batchHeaderLine(cold, 1)).toBe(`${MATRIX_NO_RUN_LINE} The loss frontier above reads batch #1.`);

  // WAVE R10 CHANGED THIS EXPECTATION (round-18 finding 3), by NARROWING what
  // the difference is claimed against. "A different batch from this table" is a
  // claim over every row on the table — and a SUPERSEDED row displayed right
  // here IS pinned to batch 1, the frontier's own batch. The only number this
  // table actually claims is the batch its DISPLAYED COHORT was measured at, so
  // that is what the comparison now names.
  expect(batchHeaderLine(resolveBatchCohort(settledAtTwo(), 1), 1)).toContain(
    "The loss frontier above reads batch #1 — a different batch from this table's displayed " +
      "cohort, which is why the two are never read as one number.",
  );
  // Same batch on both: disclosed, with no difference claimed.
  expect(batchHeaderLine(resolveBatchCohort(settledAtTwo(), 1), 2)).toContain(
    "The loss frontier above reads batch #2.",
  );

  // WAVE R10 FIXED THIS EXPECTATION (round-18 finding 3) — IT LOCKED IN THE
  // DEFECT. `recededToOne()` displays batch 1 in EVERY row; the watermark is 2
  // only because the panel once saw batch 2. Asserting that a frontier at batch
  // 1 is "a different batch from this table" pinned a sentence that contradicts
  // every visible cell, because the comparison was made against the WATERMARK —
  // a number displayed nowhere — instead of against anything on screen. The
  // frontier's own batch is still disclosed (that part of the old expectation
  // was right and is kept); what is gone is the false difference.
  const receded = batchHeaderLine(resolveBatchCohort(recededToOne(), 2), 1);
  expect(receded).toContain("The loss frontier above reads batch #1");
  expect(receded).not.toContain("a different batch");
});

// ===========================================================================
// WAVE R10 (Codex round-18 findings 1-3) — THE HEADER'S TRUTH TABLE, REBUILT.
//
// ONE PRINCIPLE: every clause of the batch line is a statement about a NAMED
// set the reader can point at — rows ASKED, rows DISPLAYING, rows IN FLIGHT,
// HELD pins. The watermark is read by exactly one clause (the floor disclosure)
// and inferred from by none. The header may never contradict the cells.
//
// THE THREE DEFECTS THIS SECTION PINS SHUT:
//
//   1. NO ANCHOR WAS READ AS NO RUN. `anchorBatchId === null` returned "no run
//      has been issued yet — every covered cell reads not run", which is FALSE
//      while a FIRST run is in flight (cells read "running…") and false
//      INDEFINITELY after a first run fails (cells read UNANSWERED).
//   2. "EVERY HELD RESULT IS ON THAT BATCH" RANGED OVER A SET THAT EXCLUDED A
//      HELD PIN. An in-flight row's held outcome anchors the cohort but the row
//      is in neither displayed list, so a row re-running while holding batch 1
//      beside a current row at batch 2 produced that sentence with the batch-1
//      pin live and uncounted.
//   3. THE FRONTIER WAS COMPARED AGAINST THE WATERMARK — a number displayed
//      nowhere. In the receded sequence every displayed row AND the frontier sat
//      at batch 1 while the line called them different batches.
// ===========================================================================

/** A FIRST run still out: asked, nothing held, nothing displayed. */
const RUNNING_COLD: MatrixPhase = { kind: "running" };

/** A FIRST run that ENDED WITHOUT A BOOK: asked, answered, no result. */
const FAILED_COLD: MatrixPhase = {
  kind: "outcome",
  outcome: {
    kind: "no-batch",
    message: "no complete risk batch is available.",
    retryAfterSeconds: 5,
  },
};

test("R10 — NEVER ATTEMPTED is the ONLY state that says “no run has been issued yet”", () => {
  const cold = resolveBatchCohort(new Map(), null);
  expect(cold.attemptedScenarioIds).toEqual([]);
  expect(batchHeaderLine(cold, null)).toBe(MATRIX_NO_RUN_LINE);

  // An explicitly-idle row is not an attempt either: the map may carry one, and
  // "idle" is precisely the state the sentence is about.
  const idle = resolveBatchCohort(new Map<string, MatrixPhase>([[ETH.id, { kind: "idle" }]]), null);
  expect(idle.attemptedScenarioIds).toEqual([]);
  expect(batchHeaderLine(idle, null)).toBe(MATRIX_NO_RUN_LINE);
  // …and the cells agree with it.
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: { kind: "idle" }, cohort: idle })
      .state,
  ).toBe("not-run");
});

test("R10 — A FIRST RUN IN FLIGHT: the header says the run is out, never that none was issued", () => {
  const phases = new Map<string, MatrixPhase>([[ETH.id, RUNNING_COLD]]);
  const cohort = resolveBatchCohort(phases, null);
  expect(cohort.anchorBatchId).toBeNull();
  expect(cohort.attemptedScenarioIds).toEqual([ETH.id]);
  expect(cohort.inFlightScenarioIds).toEqual([ETH.id]);
  expect(cohort.unansweredScenarioIds).toEqual([]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) are in flight. There is no batch " +
      "for this table to be as of — and this is NOT “not run”: every row counted here was " +
      "asked, and each says in its own cell what became of the asking.",
  );

  // THE DEFECT, NAMED: the old line claimed nothing had been issued while the
  // cell directly beneath it read "running…".
  expect(line).not.toContain("no run has been issued yet");
  expect(line).not.toContain("every covered cell reads");
  expect(line).not.toBe(MATRIX_NO_RUN_LINE);

  // HEADER AND CELLS AGREE — the whole point of the arm.
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: RUNNING_COLD, cohort }).state,
  ).toBe("running");
});

test("R10 — A FIRST RUN THAT FAILED: N run(s) ended without a served result, indefinitely", () => {
  const phases = new Map<string, MatrixPhase>([[ETH.id, FAILED_COLD]]);
  const cohort = resolveBatchCohort(phases, null);
  expect(cohort.anchorBatchId).toBeNull();
  expect(cohort.attemptedScenarioIds).toEqual([ETH.id]);
  expect(cohort.unansweredScenarioIds).toEqual([ETH.id]);
  expect(cohort.inFlightScenarioIds).toEqual([]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) ended without a served result. " +
      "There is no batch for this table to be as of — and this is NOT “not run”: every row " +
      "counted here was asked, and each says in its own cell what became of the asking.",
  );

  // THE DEFECT, NAMED: this state is TERMINAL until somebody clicks again, so
  // the old header said "not run" about a failed run for as long as the panel
  // lived — while the cell beneath it read UNANSWERED with the 503 in its title.
  expect(line).not.toContain("no run has been issued yet");
  expect(line).not.toBe(MATRIX_NO_RUN_LINE);

  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: FAILED_COLD, cohort }).state,
  ).toBe("unanswered");
});

test("R10 — in flight AND ended-without-a-result are counted SEPARATELY in the same sentence", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, RUNNING_COLD],
    [DEPEG.id, FAILED_COLD],
  ]);
  const cohort = resolveBatchCohort(phases, null);
  expect(cohort.attemptedScenarioIds).toEqual([ETH.id, DEPEG.id]);
  const line = batchHeaderLine(cohort, null);
  expect(line).toContain("1 run(s) are in flight, and 1 run(s) ended without a served result");
  expect(line).not.toContain("no run has been issued yet");
});

test("R10 — THE HELD PIN: a re-running row holding an OLDER batch is disclosed by count and batch", () => {
  // THE FINDING'S OWN SEQUENCE. Row A re-runs while holding batch 1; row B
  // displays batch 2 and IS the cohort. A is IN FLIGHT, so it is deliberately
  // absent from BOTH displayed lists — which is exactly why the old assurance
  // over "every held result" was free to be wrong.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, runningHolding(RUN_BOOK_ETH)], // held @1, displaying nothing
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)], // displayed @2
  ]);
  const cohort = resolveBatchCohort(phases, 2);
  expect(cohort.anchorBatchId).toBe(2);
  expect(cohort.currentScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.supersededScenarioIds).toEqual([]); // ← the empty list that lied
  expect(cohort.inFlightHeldPins).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);

  const line = batchHeaderLine(cohort, null);

  // THE DEFECT, NAMED: `supersededScenarioIds` is empty, so the old code said
  // "Every held result is on that batch." while row A held batch 1 that moment.
  expect(line).not.toContain("Every held result is on that batch");

  expect(line).toBe(
    "results shown together were measured at batch #2. Every DISPLAYED result was measured at " +
      "that batch. 1 re-running row(s) still hold a result at batch #1 while the request is " +
      "out — held evidence, displayed nowhere, and never part of the cohort above. 1 row(s) " +
      "have a run in flight; the batch above is a WATERMARK and never moves backwards while " +
      "one is, so nothing older repaints as current.",
  );

  // The in-flight row still renders RUNNING and never its held value (R8).
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: runningHolding(RUN_BOOK_ETH),
      cohort,
    }).state,
  ).toBe("running");
});

test("R10 — an in-flight row holding the ANCHOR's OWN batch adds no held-pin disclosure", () => {
  // The R8 harness state: the disclosure is about OLDER held evidence, so a pin
  // equal to the anchor produces no clause and no noise.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, runningHolding(RUN_BOOK_BATCH_2)],
  ]);
  const cohort = resolveBatchCohort(phases, 2);
  expect(cohort.inFlightHeldPins).toEqual([{ scenarioId: DEPEG.id, batchId: 2 }]);
  const line = batchHeaderLine(cohort, null);
  expect(line).not.toContain("re-running row(s) still hold");
  expect(line).toContain("1 row(s) have a run in flight");
});

test("R10 — TWO re-running rows on TWO older batches are named as both", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, runningHolding(RUN_BOOK_ETH)], // held @1
    [RATE.id, runningHolding(RUN_BOOK_WEETH_BATCH_1)], // held @1
    [DEPEG.id, ok(RUN_BOOK_BATCH_2)], // displayed @2
  ]);
  const line = batchHeaderLine(resolveBatchCohort(phases, 2), null);
  expect(line).toContain("2 re-running row(s) still hold a result at batch #1");
  expect(line).toContain("2 row(s) have a run in flight");
});

test("R10 — THE RECEDED SEQUENCE with a MATCHING frontier makes NO “different batch” claim", () => {
  // Watermark 2; every displayed row at batch 1; the frontier at batch 1 too.
  const cohort = resolveBatchCohort(recededToOne(), 2);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.displayedPins).toEqual([
    { scenarioId: ETH.id, batchId: 1 },
    { scenarioId: DEPEG.id, batchId: 1 },
  ]);

  const line = batchHeaderLine(cohort, 1);

  // THE DEFECT, NAMED: the comparison was made against the WATERMARK (2), so
  // the line called batch 1 "a different batch from this table" while EVERY
  // displayed result on that table was measured at batch 1.
  expect(line).not.toContain("a different batch");
  expect(line).toContain(
    "The loss frontier above reads batch #1 — the same batch 2 of the 2 displayed row(s) are " +
      "pinned to.",
  );
  // No table-wide same-claim either: there is no cohort, so none is invented.
  expect(line).toContain("This table names no cohort of its own");

  // R9's floor disclosure still composes ahead of it, unweakened.
  expect(line).toContain("NO result now displayed was measured at it");
  expect(line).not.toContain("results shown together");
});

test("R10 — no cohort and NO displayed row at the frontier's batch: still no table-wide claim", () => {
  const line = batchHeaderLine(resolveBatchCohort(recededToOne(), 2), 3);
  expect(line).toContain("The loss frontier above reads batch #3");
  expect(line).toContain("no result displayed here was measured at it");
  expect(line).toContain("no same-or-different claim is made for the table as a whole");
  expect(line).not.toContain("a different batch");
});

test("R10 — WITH a displayed cohort the frontier is compared against the COHORT's batch, both ways", () => {
  const withCohort = resolveBatchCohort(settledAtTwo(), 1); // current = [DEPEG] @2
  expect(withCohort.currentScenarioIds).toEqual([DEPEG.id]);

  // SAME: disclosed, no difference claimed.
  const same = batchHeaderLine(withCohort, 2);
  expect(same).toContain("The loss frontier above reads batch #2.");
  expect(same).not.toContain("different batch");

  // DIFFERENT: claimed against the DISPLAYED COHORT by name. It is not claimed
  // against "this table", because a SUPERSEDED row displayed on this very table
  // is pinned to batch 1 — the frontier's own batch.
  const different = batchHeaderLine(withCohort, 1);
  expect(different).toContain(
    "The loss frontier above reads batch #1 — a different batch from this table's displayed cohort",
  );
  expect(different).not.toContain("a different batch from this table,");
});

test("R10 — an UNANSWERED row is COUNTED beside the batch sentence, never folded into it", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [DEPEG.id, FAILED_COLD], // asked, no book
  ]);
  const cohort = resolveBatchCohort(phases, 1);
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.unansweredScenarioIds).toEqual([DEPEG.id]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toContain("results shown together were measured at batch #1.");
  expect(line).toContain("Every DISPLAYED result was measured at that batch.");
  expect(line).toContain("1 row(s) display UNANSWERED");
  expect(line).toContain("neither a zero nor a “not run”");
});

test("R10 — THE SWEEP: once ANY row was asked, the header never says “no run has been issued yet”", () => {
  const asked: MatrixPhase[] = [
    RUNNING_COLD,
    FAILED_COLD,
    runningHolding(RUN_BOOK_ETH),
    ok(RUN_BOOK_ETH),
    { kind: "outcome", outcome: { kind: "not-served" } },
    { kind: "outcome", outcome: { kind: "unreachable", message: "network down" } },
    { kind: "outcome", outcome: { kind: "rate-limited", retryAfterSeconds: null } },
  ];
  const floors: (number | null)[] = [null, 1, 2];
  for (const phase of asked) {
    for (const floor of floors) {
      const cohort = resolveBatchCohort(new Map<string, MatrixPhase>([[ETH.id, phase]]), floor);
      expect(cohort.attemptedScenarioIds).toEqual([ETH.id]);
      const line = batchHeaderLine(cohort, null);
      expect(line).not.toContain("no run has been issued yet");
      expect(line.length).toBeGreaterThan(0);
    }
  }
});

// ===========================================================================
// WAVE R11 (Codex round-19) — ROW PRESENTATION DERIVES FROM ACTUAL CELL
// COVERAGE, NEVER FROM ENVELOPE PRESENCE.
//
// THE DEFECT: the cohort builder treated every `kind: "ok"` outcome as a
// DISPLAYED result, because the envelope carried a batch. `cellState` already
// (correctly) renders a covered engine named in NEITHER `engines[]` nor
// `excluded_engines[]` as UNANSWERED — "this surface will not fill a hole with
// a zero" — and the contract permits exactly such a body: neither array carries
// `minItems`, and `runBookScenario` does no cross-field validation. So a 200
// whose two arrays are both empty painted EVERY cell of the row UNANSWERED
// while the builder minted a displayed pin and a current cohort. The header then
// read "results shown together were measured at batch #N. Every DISPLAYED result
// was measured at that batch." above ZERO displayed results, and the frontier
// clause compared itself against that nonexistent cohort.
//
// THE FIX, in three parts, each pinned below:
//   ROW      a row whose covered cells ALL fall in the hole is an ALL-HOLE row.
//            It contributes NO pin to current/superseded/displayedPins, and it
//            is counted in its own set with its own clause — never in
//            `unansweredScenarioIds`, whose sentence ("ended without a served
//            result") would be a false account of a run that ended with a 200.
//   ANCHOR   an all-hole envelope's batch raises neither the ANCHOR nor the
//            WATERMARK. No displayable evidence, no floor movement.
//   CELL     the HOLE outranks SUPERSESSION, so an all-hole row reads UNANSWERED
//            at every batch — including a batch NEWER than the anchor, which the
//            old order would have stamped "measured at #7; the matrix reads #1".
//
// A row with SOME covered cells served keeps its pin: those cells are real
// measurements, and the hole beside them stays the CELL's own sentence (R10's
// resolution, unchanged).
// ===========================================================================

/** The committed listing's own coverage — what `LabMatrix` hands the model. */
const COVERAGE = rowCoverage(definitions);

/** The both-arrays-empty 200, re-pinned to a NEWER batch than any real result. */
const NAMES_NOBODY_AT_7 = {
  ...RUN_BOOK_NAMES_NOBODY,
  batch: { ...RUN_BOOK_NAMES_NOBODY.batch, id: 7 },
} as typeof RUN_BOOK_ETH;

test("R11 — THE CLASSIFICATION: covered engines against engines[] ∪ excluded_engines[]", () => {
  // Both arrays empty: nothing the row covers is named, so the row is all-hole.
  expect(RUN_BOOK_NAMES_NOBODY.engines).toEqual([]);
  expect(RUN_BOOK_NAMES_NOBODY.excluded_engines).toEqual([]);
  expect(isAllHoleBook(RUN_BOOK_NAMES_NOBODY as unknown as LabRunBook, DEPEG.engines)).toBe(true);

  // A book that SERVES a covered engine is not all-hole…
  expect(isAllHoleBook(RUN_BOOK_ETH as unknown as LabRunBook, ETH.engines)).toBe(false);
  // …and NEITHER IS ONE THAT REFUSES ONE. A refusal is a named answer about a
  // covered cell, so the row displays something and pins its batch.
  expect(RUN_BOOK_WITHHELD.excluded_engines.map((refusal) => refusal.engine)).toEqual([
    "aave_v3_etherfi",
  ]);
  expect(isAllHoleBook(RUN_BOOK_WITHHELD as unknown as LabRunBook, ["aave_v3_etherfi"])).toBe(
    false,
  );

  // The rule is the SCENARIO'S OWN covered set, not "did the book name anybody":
  // a book naming only engines this row is not defined for still fills no cell
  // of this row.
  expect(isAllHoleBook(RUN_BOOK_ETH as unknown as LabRunBook, ["an_engine_nobody_serves"])).toBe(
    true,
  );

  // NO DEFINITION SUPPLIED = NOTHING INFERRED. A book cannot testify to which
  // engines a scenario is defined for, so an absent coverage entry keeps the
  // pre-R11 reading rather than guessing in either direction.
  expect(isAllHoleBook(RUN_BOOK_NAMES_NOBODY as unknown as LabRunBook, undefined)).toBe(false);
});

test("R11 — THE ROW: a both-arrays-empty 200 displays NOTHING, so it pins nothing", () => {
  const phases = new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)]]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE);

  // The row was ASKED and it ANSWERED — but with nothing this table can display.
  expect(cohort.attemptedScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.allHoleScenarioIds).toEqual([DEPEG.id]);
  // THE PHANTOM PIN AND THE PHANTOM COHORT, both gone.
  expect(cohort.displayedPins).toEqual([]);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.supersededScenarioIds).toEqual([]);
  // NOT folded into the run-ended-without-a-book set: the book arrived.
  expect(cohort.unansweredScenarioIds).toEqual([]);
  // ANCHOR AND WATERMARK UNMOVED — no displayable evidence, no floor movement.
  expect(cohort.anchorBatchId).toBeNull();
  expect(observedAnchorBatch(phases, COVERAGE)).toBeNull();

  // EVERY COVERED CELL READS UNANSWERED, which is what the header must agree
  // with. (Both engines: DEPEG's committed definition names both.)
  for (const engine of DEPEG.engines) {
    const cell = cellState({
      scenario: DEPEG,
      engine,
      phase: ok(RUN_BOOK_NAMES_NOBODY),
      cohort,
    });
    expect(cell.state).toBe("unanswered");
    if (cell.state !== "unanswered") throw new Error("unreachable");
    expect(cell.reason).toContain("neither a result nor a refusal");
    expect(cell.reason).toContain("will not fill a hole with a zero");
    // The batch the naming-nobody book DID carry is disclosed in the only place
    // left that can carry it — the cell's own sentence — and disclaimed in the
    // same breath, because the row is in no cohort.
    expect(cell.reason).toContain("The book it served was measured at batch #1");
    expect(cell.reason).toContain("no part of that batch's cohort");
  }
});

test("R11 — THE HEADER: no cohort claim, and the state is NAMED as a served book", () => {
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)]]),
    null,
    COVERAGE,
  );
  const line = batchHeaderLine(cohort, null);

  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) were served a book that named none " +
      "of the row's covered engines — a served book, but not a served result. There is no batch " +
      "for this table to be as of — and this is NOT “not run”: every row counted here was asked, " +
      "and each says in its own cell what became of the asking.",
  );

  // THE DEFECT, NAMED: the old line claimed a cohort over zero displayed results.
  expect(line).not.toContain("results shown together");
  expect(line).not.toContain("Every DISPLAYED result was measured at that batch");
  expect(line).not.toContain("batch #1");
  // And it does not misreport what happened either way: this run did NOT end
  // without a served result, and it is emphatically not "not run".
  expect(line).not.toContain("ended without a served result");
  expect(line).not.toContain("no run has been issued yet");
});

test("R11 — the ALL-HOLE clause rides BESIDE a real cohort, and never inside it", () => {
  // ETH displays batch 1. DEPEG's run returns a 200 at batch 7 that names
  // nobody: NEWER than the anchor, and still displaying nothing.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [DEPEG.id, ok(NAMES_NOBODY_AT_7)], // served @7, names nobody
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE);

  // THE ANCHOR DID NOT FOLLOW THE ENVELOPE TO BATCH 7.
  expect(cohort.anchorBatchId).toBe(1);
  expect(observedAnchorBatch(phases, COVERAGE)).toBe(1);
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.displayedPins).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);
  expect(cohort.allHoleScenarioIds).toEqual([DEPEG.id]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "results shown together were measured at batch #1. Every DISPLAYED result was measured at " +
      "that batch. 1 row(s) were SERVED A BOOK that named none of the engines their committed " +
      "definition covers — every covered cell there reads UNANSWERED, so the row displays no " +
      "result, pins no batch, and is no part of the sentence above. That is not a run that " +
      "ended without a book: the book arrived and named nobody.",
  );

  // AND THE CELLS SAY EXACTLY THAT. The hole outranks supersession, so the
  // batch-7 row does NOT render "measured at batch #7; the matrix reads #1" —
  // which would call a NEWER batch older, on a cell that holds nothing at all.
  for (const engine of DEPEG.engines) {
    const cell = cellState({ scenario: DEPEG, engine, phase: ok(NAMES_NOBODY_AT_7), cohort });
    expect(cell.state).toBe("unanswered");
  }
  // The row that really did display something is untouched.
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: ok(RUN_BOOK_ETH), cohort }).state,
  ).toBe("result");
});

test("R11 — THE PARTIAL HOLE KEEPS ITS PIN: served cells are real measurements", () => {
  // R10'S RESOLUTION, UNCHANGED. One covered engine is served, one is in neither
  // array: the row displays a real result at a real batch, and the hole stays
  // the CELL's own sentence rather than emptying the row.
  const partial = {
    ...RUN_BOOK_ETH,
    engines: RUN_BOOK_ETH.engines.filter((engine) => engine.engine !== "aave_v3_etherfi"),
  } as typeof RUN_BOOK_ETH;
  expect(isAllHoleBook(partial as unknown as LabRunBook, ETH.engines)).toBe(false);

  const phases = new Map<string, MatrixPhase>([[ETH.id, ok(partial)]]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE);
  expect(cohort.allHoleScenarioIds).toEqual([]);
  expect(cohort.displayedPins).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.anchorBatchId).toBe(1);

  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: ok(partial), cohort }).state,
  ).toBe("result");
  expect(
    cellState({ scenario: ETH, engine: "aave_v3_etherfi", phase: ok(partial), cohort }).state,
  ).toBe("unanswered");

  const line = batchHeaderLine(cohort, null);
  expect(line).toContain("results shown together were measured at batch #1.");
  expect(line).not.toContain("named none of the engines");

  // AND THE TWO STATES COEXIST AT AN OLDER BATCH. With another row displaying
  // batch 2, this row's SERVED cell is SUPERSEDED — a real measurement, at its
  // own pin — while the HOLE beside it stays UNANSWERED. A hole is not a
  // superseded measurement: there was never anything in that cell to supersede,
  // and "SUPERSEDED · no cell served" claimed one that did not exist.
  const withNewer = resolveBatchCohort(
    new Map<string, MatrixPhase>([
      [ETH.id, ok(partial)], // served debt_manager @1, aave a hole
      [DEPEG.id, ok(RUN_BOOK_BATCH_2)], // displayed @2
    ]),
    null,
    COVERAGE,
  );
  expect(withNewer.anchorBatchId).toBe(2);
  expect(withNewer.supersededScenarioIds).toEqual([ETH.id]);
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: ok(partial), cohort: withNewer })
      .state,
  ).toBe("superseded");
  expect(
    cellState({ scenario: ETH, engine: "aave_v3_etherfi", phase: ok(partial), cohort: withNewer })
      .state,
  ).toBe("unanswered");
});

test("R11 — THE ANCHOR: an all-hole envelope raises neither the anchor nor the watermark", () => {
  const displayed: MatrixPhase = ok(NAMES_NOBODY_AT_7);
  const held: MatrixPhase = runningHolding(NAMES_NOBODY_AT_7);

  // Envelope-level, with no definition supplied: the batch is right there.
  expect(batchOfPhase(displayed)).toBe(7);
  expect(anchorBatchOfPhase(held)).toBe(7);
  // Row-level, with the committed definition supplied: it displays nothing, so
  // it pins nothing and vouches for nothing.
  expect(batchOfPhase(displayed, DEPEG.engines)).toBeNull();
  expect(anchorBatchOfPhase(held, DEPEG.engines)).toBeNull();

  // A RE-RUNNING ROW HOLDING an all-hole book holds no displayable evidence, so
  // it discloses no held pin either — there is nothing to disclose.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [DEPEG.id, held], // running, holding a book that names nobody
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE);
  expect(cohort.anchorBatchId).toBe(1);
  expect(cohort.inFlightScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.inFlightHeldPins).toEqual([]);
  expect(cohort.allHoleScenarioIds).toEqual([]); // in flight, not displayed

  // THE WATERMARK IS THE SAME READ. The caller raises its floor from
  // `observedAnchorBatch`, so a book the cohort refuses to display can never put
  // a floor under a sentence about displayed results.
  expect(observedAnchorBatch(phases, COVERAGE)).toBe(1);
  expect(observedAnchorBatch(phases)).toBe(7); // the pre-R11 read, for contrast
});

test("R11 — A RE-RUN THAT COMES BACK NAMING NOBODY: the watermark holds, the cohort empties", () => {
  // The sequence a live panel reaches: the row displayed batch 2, the reader
  // re-ran it, and the daemon answered 200 at batch 3 with both arrays empty.
  // `LabBookPanel` writes that outcome over the prior one — correctly, because
  // a 200 IS an answer, and R8's keep-the-held-result rule is for runs that
  // ended WITHOUT a book. So the row now displays UNANSWERED everywhere, and
  // the header has to survive that without inventing a cohort at EITHER batch.
  const rerun = {
    ...RUN_BOOK_NAMES_NOBODY,
    batch: { ...RUN_BOOK_NAMES_NOBODY.batch, id: 3 },
  } as typeof RUN_BOOK_ETH;
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[DEPEG.id, ok(rerun)]]),
    2, // the watermark this panel raised when batch 2 was displayed
    COVERAGE,
  );

  // The floor stands where displayable evidence last put it — batch 3 arrived in
  // an envelope, not in a cell, so it did not raise it.
  expect(cohort.anchorBatchId).toBe(2);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.displayedPins).toEqual([]);
  expect(cohort.allHoleScenarioIds).toEqual([DEPEG.id]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls below " +
      "— but NO result now displayed was measured at it. No row is displaying a result at all " +
      "right now, so there is no cohort to read together. 1 row(s) were SERVED A BOOK that named " +
      "none of the engines their committed definition covers — every covered cell there reads " +
      "UNANSWERED, so the row displays no result, pins no batch, and is no part of the sentence " +
      "above. That is not a run that ended without a book: the book arrived and named nobody.",
  );
  // No cohort is claimed at EITHER batch: not at the watermark, and not at the
  // batch the naming-nobody envelope carried.
  expect(line).not.toContain("results shown together");
  expect(line).not.toContain("batch #3");

  // The cells agree, and the batch-3 envelope is disclosed where it belongs —
  // in the cell's own sentence, disclaimed as no part of any cohort.
  for (const engine of DEPEG.engines) {
    const cell = cellState({ scenario: DEPEG, engine, phase: ok(rerun), cohort });
    expect(cell.state).toBe("unanswered");
    if (cell.state !== "unanswered") throw new Error("unreachable");
    expect(cell.reason).toContain("The book it served was measured at batch #3");
  }
});

test("R11 — THE FRONTIER makes no table-wide comparison against a phantom cohort", () => {
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)]]),
    null,
    COVERAGE,
  );
  // The frontier's OWN batch is the all-hole book's batch — the case that would
  // have produced "the same batch 1 of the 1 displayed row(s) are pinned to"
  // over a row displaying nothing.
  const line = batchHeaderLine(cohort, 1);
  expect(line).toContain("The loss frontier above reads batch #1.");
  expect(line).not.toContain("a different batch");
  expect(line).not.toContain("displayed row(s) are pinned to");
  expect(line).not.toContain("results shown together");

  // A frontier at some other batch is disclosed the same way: no comparison is
  // available, so none is invented.
  const other = batchHeaderLine(cohort, 4);
  expect(other).toContain("The loss frontier above reads batch #4.");
  expect(other).not.toContain("a different batch");
});

test("R11 — the three ways a run can leave a row empty are counted SEPARATELY", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, RUNNING_COLD], // in flight
    [DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)], // served a book naming nobody
    [RATE.id, FAILED_COLD], // ended without a book
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE);
  expect(cohort.inFlightScenarioIds).toEqual([ETH.id]);
  expect(cohort.allHoleScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.unansweredScenarioIds).toEqual([RATE.id]);

  const line = batchHeaderLine(cohort, null);
  expect(line).toContain("1 run(s) are in flight");
  expect(line).toContain("1 run(s) ended without a served result");
  expect(line).toContain(
    "1 run(s) were served a book that named none of the row's covered engines — a served book, " +
      "but not a served result",
  );
  expect(line).not.toContain("no run has been issued yet");
});

test("R11 — a row covered for NO engine draws no cell, so its book pins nothing either", () => {
  // The degenerate committed definition. Every column of its row is NOT COVERED,
  // so a batch it carried would be a cohort claim on behalf of a row displaying
  // nothing — the same phantom pin by a different route.
  const uncovered: ScenarioDefinition = { ...RATE, engines: [] };
  expect(isAllHoleBook(RUN_BOOK_ETH as unknown as LabRunBook, uncovered.engines)).toBe(true);

  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[uncovered.id, ok(RUN_BOOK_ETH)]]),
    null,
    rowCoverage([uncovered]),
  );
  expect(cohort.allHoleScenarioIds).toEqual([uncovered.id]);
  expect(cohort.displayedPins).toEqual([]);
  expect(cohort.anchorBatchId).toBeNull();
  expect(
    cellState({
      scenario: uncovered,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETH),
      cohort,
    }).state,
  ).toBe("not-covered");
});

test("R11 — SENSITIVITY: without the committed coverage, the SAME phases read the old way", () => {
  // This is the defect, reproduced on demand. The only difference between the
  // two calls is whether the row's committed definition was supplied; with it
  // absent nothing can be inferred, so the envelope's batch is taken at face
  // value — a displayed pin, a current cohort, and a header claiming both.
  const phases = new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)]]);

  const blind = resolveBatchCohort(phases, null);
  expect(blind.displayedPins).toEqual([{ scenarioId: DEPEG.id, batchId: 1 }]);
  expect(blind.currentScenarioIds).toEqual([DEPEG.id]);
  expect(batchHeaderLine(blind, null)).toContain(
    "results shown together were measured at batch #1. Every DISPLAYED result was measured at " +
      "that batch.",
  );
  // …while every cell of that row reads UNANSWERED in the very same state.
  for (const engine of DEPEG.engines) {
    expect(
      cellState({ scenario: DEPEG, engine, phase: ok(RUN_BOOK_NAMES_NOBODY), cohort: blind }).state,
    ).toBe("unanswered");
  }

  const seeing = resolveBatchCohort(phases, null, COVERAGE);
  expect(seeing.displayedPins).toEqual([]);
  expect(seeing.currentScenarioIds).toEqual([]);
  expect(batchHeaderLine(seeing, null)).not.toContain("results shown together");
});

// ===========================================================================
// WAVE R12 (Codex round-20) — NOTHING IS CLASSIFIED BEFORE IT IS VALIDATED.
//
// FINDING 1 (matrixCells.ts:913-924). `cellState` checked `engines[]` before
// `excluded_engines[]`, so a COVERED engine appearing in BOTH arrays rendered
// its numeric RESULT in the matrix while the SAME response rendered it WITHHELD
// in the detail view. Neither the schema nor the client enforces the arrays to
// be disjoint — no `uniqueItems`, no cross-field rule, no validation in
// `runbook.ts` — and R11's tests exercised served membership and refused
// membership SEPARATELY, never together, so the precedence was never asked the
// one question it answers wrongly.
//
// FINDING 2 (LabMatrix.tsx:235-239). Coverage from the committed listing was
// joined to stored run phases BY SCENARIO ID ALONE. Across an API deployment
// mid-session that is two different definitions wearing one name: a v1 listing
// covering `debt_manager` retained in the browser, and a valid v2 response for
// the same id covering only `aave_v3_etherfi`. R11 then reads the v2 book
// against v1 coverage, finds v1's engine named nowhere, and declares the row
// ALL-HOLE — "the book named nobody" — while the detail view renders the real
// aave result the response is carrying. Both responses are individually valid;
// the unguarded cross-request join manufactures the wrong answer.
//
// THE RULE FOR BOTH: the body is validated and the join is bound to IDENTITY
// before anything is classified or pinned. A response that fails either check
// is refused WHOLE — no cell, no pin, no cohort, no anchor and no watermark
// movement — and it is counted in its OWN header set, because "the book named
// nobody" must never be claimed about a book that named somebody twice, and
// nothing failed at all in the version-skew case.
// ===========================================================================

/** The committed listing's IDENTITY — what `LabMatrix` hands the model (v1). */
const IDENTITY = rowIdentity(definitions, SCENARIOS.scenario_config_version);

/** The same listing after a deployment re-cut `ethfi_minus_50` to v2. */
const V2_DEFINITIONS = SCENARIOS_V2.scenarios;
const ETHFI_V2 = ((): ScenarioDefinition => {
  const found = V2_DEFINITIONS.find((scenario) => scenario.id === "ethfi_minus_50");
  if (found === undefined) throw new Error("the v2 fixture carries no ethfi_minus_50");
  return found;
})();
const COVERAGE_V2 = rowCoverage(V2_DEFINITIONS);
const IDENTITY_V2 = rowIdentity(V2_DEFINITIONS, SCENARIOS_V2.scenario_config_version);

// ---------------------------------------------------------------------------
// FINDING 1 — the body that answers one cell two ways.
// ---------------------------------------------------------------------------

test("R12/1 — THE VALIDATION RULE: overlap, duplicate-within-array, and the clean case", () => {
  // THE FIXTURE IS THE DEFECT. Both lookups succeed for ONE engine, which is
  // exactly what the old precedence resolved silently by asking `engines[]`
  // first: a number in the matrix, a refusal register in the detail view.
  expect(RUN_BOOK_CONTRADICTORY.engines.map((engine) => engine.engine)).toContain(
    "aave_v3_etherfi",
  );
  expect(RUN_BOOK_CONTRADICTORY.excluded_engines.map((refusal) => refusal.engine)).toContain(
    "aave_v3_etherfi",
  );

  // OVERLAP.
  const overlap = bookContradiction(RUN_BOOK_CONTRADICTORY as unknown as LabRunBook);
  expect(overlap).not.toBeNull();
  if (overlap === null) throw new Error("unreachable");
  expect(overlap.kind).toBe("served-and-withheld");
  expect(overlap.engines).toEqual(["aave_v3_etherfi"]);
  expect(overlap.reason).toContain("THE SERVED BOOK CONTRADICTS ITSELF");
  expect(overlap.reason).toContain("named in BOTH engines[] and excluded_engines[]");
  expect(overlap.reason).toContain("No cell, no pin, no cohort.");

  // DUPLICATE WITHIN `engines[]`.
  const twiceServed = bookContradiction(RUN_BOOK_NAMED_TWICE as unknown as LabRunBook);
  expect(twiceServed).not.toBeNull();
  if (twiceServed === null) throw new Error("unreachable");
  expect(twiceServed.kind).toBe("named-twice-served");
  expect(twiceServed.engines).toEqual(["aave_v3_etherfi"]);
  expect(twiceServed.reason).toContain("named TWICE in engines[]");
  expect(twiceServed.reason).toContain("choosing a number the response never chose");

  // DUPLICATE WITHIN `excluded_engines[]` — a refusal register offered twice is
  // the same failure in the other array, and is refused the same way.
  const twiceWithheld = bookContradiction({
    ...RUN_BOOK_WITHHELD,
    excluded_engines: [...RUN_BOOK_WITHHELD.excluded_engines, ...RUN_BOOK_WITHHELD.excluded_engines],
  } as unknown as LabRunBook);
  expect(twiceWithheld).not.toBeNull();
  if (twiceWithheld === null) throw new Error("unreachable");
  expect(twiceWithheld.kind).toBe("named-twice-withheld");
  expect(twiceWithheld.reason).toContain("named TWICE in excluded_engines[]");

  // THE CLEAN CASES ARE UNCHANGED — every committed fixture R8-R11 drives, and
  // the disjoint served/withheld body the whole distinction rests on.
  for (const body of [
    RUN_BOOK_ETH,
    RUN_BOOK_BATCH_2,
    RUN_BOOK_WEETH_BATCH_1,
    RUN_BOOK_WITHHELD,
    RUN_BOOK_NAMES_NOBODY,
    RUN_BOOK_ETHFI_V2,
  ]) {
    expect(bookContradiction(body as unknown as LabRunBook)).toBeNull();
  }
});

test("R12/1 — THE CELL: neither the number nor the refusal — the whole body is refused", () => {
  const phases = new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_CONTRADICTORY)]]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);

  // THE ASSERTION THE FINDING IS ABOUT: this cell used to read "result", with
  // aave's own USD in it, while `LabBookPanel` rendered aave WITHHELD from the
  // same response in the same instant.
  const aave = cellState({
    scenario: DEPEG,
    engine: "aave_v3_etherfi",
    phase: ok(RUN_BOOK_CONTRADICTORY),
    cohort,
    identity: IDENTITY.get(DEPEG.id),
  });
  expect(aave.state).toBe("contradicted");
  if (aave.state !== "contradicted") throw new Error("unreachable");
  expect(aave.contradiction.kind).toBe("served-and-withheld");
  expect(aave.contradiction.reason).toContain("served and withheld at once");
  expect(aave.batchId).toBe(1);

  // AND IT IS THE WHOLE RESPONSE, NOT THE ONE CELL. debt_manager is named once,
  // cleanly, and is STILL not rendered: a body that answers one cell two ways
  // has no authority over any of them, because nothing in it says which answer
  // it meant. Salvaging the "clean" cells would be this surface deciding the
  // contradiction was local when the response never said so.
  const dm = cellState({
    scenario: DEPEG,
    engine: "debt_manager",
    phase: ok(RUN_BOOK_CONTRADICTORY),
    cohort,
    identity: IDENTITY.get(DEPEG.id),
  });
  expect(dm.state).toBe("contradicted");

  // NOT COVERED still outranks it — coverage is structural, from the listing,
  // and a broken response can never repaint a cell outside the model.
  expect(
    cellState({
      scenario: RATE,
      engine: "aave_v3_etherfi",
      phase: ok(RUN_BOOK_CONTRADICTORY),
      cohort,
      identity: IDENTITY.get(RATE.id),
    }).state,
  ).toBe("not-covered");

  expect(CELL_STATE_LABEL.contradicted).toBe("CONTRADICTORY BOOK");
});

test("R12/1 — THE ROW: a contradictory book pins nothing and anchors nothing", () => {
  const phases = new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_CONTRADICTORY)]]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);

  expect(cohort.attemptedScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.contradictedScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.displayedPins).toEqual([]);
  expect(cohort.currentScenarioIds).toEqual([]);
  expect(cohort.supersededScenarioIds).toEqual([]);
  expect(cohort.anchorBatchId).toBeNull();
  expect(observedAnchorBatch(phases, COVERAGE, IDENTITY)).toBeNull();

  // IT IS NOT THE R11 SET, and the separation is the ruling's own words: this
  // book named somebody TWICE, so "named nobody" would be a false account of it.
  expect(cohort.allHoleScenarioIds).toEqual([]);
  // …and not the ended-without-a-book set either: a 200 arrived.
  expect(cohort.unansweredScenarioIds).toEqual([]);

  // AND UNLIKE R11's READS, THIS ONE NEEDS NO LISTING. An all-hole book is only
  // all-hole RELATIVE to a row's covered engines, so `batchOfPhase` still
  // answers with the envelope's batch when no coverage is supplied. A
  // self-contradictory body is invalid on its own terms, so it pins nothing
  // whether or not anybody supplied a definition to read it against — there is
  // no state of the world in which this response may be displayed.
  expect(RUN_BOOK_CONTRADICTORY.batch.id).toBe(1);
  expect(batchOfPhase(ok(RUN_BOOK_CONTRADICTORY))).toBeNull();
  expect(batchOfPhase(ok(RUN_BOOK_CONTRADICTORY), DEPEG.engines)).toBeNull();
  expect(anchorBatchOfPhase(runningHolding(RUN_BOOK_CONTRADICTORY))).toBeNull();
  expect(anchorBatchOfPhase(runningHolding(RUN_BOOK_CONTRADICTORY), DEPEG.engines)).toBeNull();
  // The contrast R11 pinned, unchanged: a naming-nobody body DOES pin when no
  // coverage is supplied, because nothing can be inferred without a definition.
  expect(batchOfPhase(ok(RUN_BOOK_NAMES_NOBODY))).toBe(1);
});

test("R12/1 — THE HEADER: named as a contradiction, and never as “named nobody”", () => {
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[DEPEG.id, ok(RUN_BOOK_CONTRADICTORY)]]),
    null,
    COVERAGE,
    IDENTITY,
  );
  const line = batchHeaderLine(cohort, null);

  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) were served a book that CONTRADICTS " +
      "ITSELF — an engine named twice, or named as served and withheld at once, which is a body " +
      "that names somebody twice rather than one that names nobody. There is no batch for this " +
      "table to be as of — and this is NOT “not run”: every row counted here was asked, and each " +
      "says in its own cell what became of the asking.",
  );

  // THE DEFECT, NAMED: a cohort claimed over a row displaying nothing.
  expect(line).not.toContain("results shown together");
  expect(line).not.toContain("Every DISPLAYED result was measured at that batch");
  expect(line).not.toContain("batch #1");
  // AND THE R11 SENTENCE IS NOT BORROWED. This is the ruling's explicit
  // constraint: "named nobody" must not be claimed about a book that named
  // somebody twice.
  expect(line).not.toContain("named none of the row's covered engines");
  expect(line).not.toContain("ended without a served result");
  expect(line).not.toContain("no run has been issued yet");
});

test("R12/1 — the contradiction clause rides BESIDE a real cohort, never inside it", () => {
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [DEPEG.id, ok(RUN_BOOK_CONTRADICTORY)], // served @1, contradicts itself
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);
  expect(cohort.anchorBatchId).toBe(1);
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.displayedPins).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);
  expect(cohort.contradictedScenarioIds).toEqual([DEPEG.id]);

  expect(batchHeaderLine(cohort, null)).toBe(
    "results shown together were measured at batch #1. Every DISPLAYED result was measured at " +
      "that batch. 1 row(s) were served a book that CONTRADICTS ITSELF — an engine named twice " +
      "within an array, or named as served and withheld at once. A body that answers a cell two " +
      "ways answers it no way, so the whole response is refused for presentation: no cell, no " +
      "pin, and no part of the sentence above. That is not a book that named nobody — this one " +
      "named somebody twice.",
  );

  // The row that really did display something is untouched.
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETH),
      cohort,
      identity: IDENTITY.get(ETH.id),
    }).state,
  ).toBe("result");
});

test("R12/1 — a contradictory book at a NEWER batch supersedes nothing", () => {
  // The anchor half, exactly as R11 pinned it for the naming-nobody body: a
  // response this table refuses to read may not drag the as-of forward and
  // repaint a real displayed result as SUPERSEDED under a cohort no cell holds.
  const atSeven = {
    ...RUN_BOOK_CONTRADICTORY,
    batch: { ...RUN_BOOK_CONTRADICTORY.batch, id: 7 },
  } as typeof RUN_BOOK_ETH;
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [DEPEG.id, ok(atSeven)], // refused @7
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);
  expect(cohort.anchorBatchId).toBe(1);
  expect(observedAnchorBatch(phases, COVERAGE, IDENTITY)).toBe(1);
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETH),
      cohort,
      identity: IDENTITY.get(ETH.id),
    }).state,
  ).toBe("result");
  expect(batchHeaderLine(cohort, null)).not.toContain("batch #7");
});

// ---------------------------------------------------------------------------
// FINDING 2 — the join bound to identity, not to an id.
// ---------------------------------------------------------------------------

test("R12/2 — THE IDENTITY: id + version + config version, from the wire's own fields", () => {
  // Verified against the generated schema, not assumed: the listing publishes
  // `scenario_config_version` for the set and `version` per scenario; the
  // run-book response publishes `scenario_id`, `scenario_version` and
  // `scenario_config_version` for itself.
  expect(servedIdentity(RUN_BOOK_ETHFI_V2 as unknown as LabRunBook)).toEqual({
    scenarioId: "ethfi_minus_50",
    version: "v2",
    configVersion: "v2",
  });
  expect(IDENTITY.get(ETHFI.id)).toEqual({
    scenarioId: "ethfi_minus_50",
    version: "v1",
    configVersion: "v1",
  });

  // A MATCHING JOIN IS NO SKEW — the ordinary case, unchanged.
  expect(
    definitionSkew(RUN_BOOK_ETH as unknown as LabRunBook, IDENTITY.get(ETH.id)),
  ).toBeNull();
  expect(
    definitionSkew(RUN_BOOK_ETHFI_V2 as unknown as LabRunBook, IDENTITY_V2.get(ETHFI.id)),
  ).toBeNull();

  // NO IDENTITY SUPPLIED = NOTHING INFERRED, the same rule R11 gave absent
  // coverage: a response cannot testify to which listing the page is holding.
  expect(definitionSkew(RUN_BOOK_ETHFI_V2 as unknown as LabRunBook, undefined)).toBeNull();

  // ONE DISAGREEING FIELD IS ENOUGH — "mostly the same scenario" is not a thing
  // a risk surface may believe. Each field is checked, and each is named.
  const skew = definitionSkew(
    RUN_BOOK_ETHFI_V2 as unknown as LabRunBook,
    IDENTITY.get(ETHFI.id),
  );
  expect(skew).not.toBeNull();
  if (skew === null) throw new Error("unreachable");
  expect(skew.fields).toEqual(["scenario_version", "scenario_config_version"]);
  expect(
    definitionSkew(RUN_BOOK_ETH as unknown as LabRunBook, IDENTITY.get(DEPEG.id))?.fields,
  ).toEqual(["scenario_id"]);
  expect(
    definitionSkew(RUN_BOOK_ETH as unknown as LabRunBook, {
      scenarioId: "eth_minus_30",
      version: "v1",
      configVersion: "v9",
    })?.fields,
  ).toEqual(["scenario_config_version"]);
});

test("R12/2 — THE DEFECT SEQUENCE: a valid v2 book against a retained v1 listing", () => {
  // THE EXACT ROUND-20 SEQUENCE. The tab holds the v1 listing, which covers
  // `debt_manager` for this id. The API is deployed. The reader runs the row and
  // gets a VALID v2 response covering `aave_v3_etherfi` only.
  expect(ETHFI.engines).toEqual(["debt_manager"]);
  expect(RUN_BOOK_ETHFI_V2.engines.map((engine) => engine.engine)).toEqual(["aave_v3_etherfi"]);

  const phases = new Map<string, MatrixPhase>([[ETHFI.id, ok(RUN_BOOK_ETHFI_V2)]]);

  // WITHOUT THE IDENTITY BINDING — THE DEFECT, REPRODUCED ON DEMAND. v1's
  // covered engine is named nowhere in the v2 book, so R11 reads the row as
  // ALL-HOLE and the header says the book named nobody…
  const idOnly = resolveBatchCohort(phases, null, COVERAGE);
  expect(idOnly.allHoleScenarioIds).toEqual([ETHFI.id]);
  expect(batchHeaderLine(idOnly, null)).toContain("named none of the row's covered engines");
  // …while the response is carrying a real aave result the whole time.
  expect(RUN_BOOK_ETHFI_V2.engines[0]?.eligible_debt_delta_usd.length).toBeGreaterThan(0);

  // WITH IT: the join is refused, and nothing is classified against a definition
  // the answer was not computed for.
  const bound = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);
  expect(bound.definitionChangedScenarioIds).toEqual([ETHFI.id]);
  expect(bound.allHoleScenarioIds).toEqual([]);
  expect(bound.unansweredScenarioIds).toEqual([]);
  expect(bound.displayedPins).toEqual([]);
  expect(bound.currentScenarioIds).toEqual([]);
  expect(bound.anchorBatchId).toBeNull();
  expect(observedAnchorBatch(phases, COVERAGE, IDENTITY)).toBeNull();
});

test("R12/2 — THE CELL and THE HEADER agree: DEFINITION CHANGED, never ALL-HOLE", () => {
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([[ETHFI.id, ok(RUN_BOOK_ETHFI_V2)]]),
    null,
    COVERAGE,
    IDENTITY,
  );

  const cell = cellState({
    scenario: ETHFI,
    engine: "debt_manager",
    phase: ok(RUN_BOOK_ETHFI_V2),
    cohort,
    identity: IDENTITY.get(ETHFI.id),
  });
  expect(cell.state).toBe("definition-changed");
  if (cell.state !== "definition-changed") throw new Error("unreachable");
  expect(cell.skew.listing).toEqual({
    scenarioId: "ethfi_minus_50",
    version: "v1",
    configVersion: "v1",
  });
  expect(cell.skew.served).toEqual({
    scenarioId: "ethfi_minus_50",
    version: "v2",
    configVersion: "v2",
  });
  expect(cell.skew.reason).toContain(
    "this scenario's committed definition changed after this page loaded",
  );
  expect(cell.skew.reason).toContain(
    "refresh the listing to run against the current definition",
  );
  // THE ASSERTION THE FINDING IS ABOUT: this cell used to read UNANSWERED with
  // the hole's own sentence, under a header saying the book named nobody.
  expect(cell.state).not.toBe("unanswered");
  expect(CELL_STATE_LABEL["definition-changed"]).toBe("DEFINITION CHANGED");

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) answered for a committed definition " +
      "this page is no longer showing — refresh the listing to run against the current one. " +
      "There is no batch for this table to be as of — and this is NOT “not run”: every row " +
      "counted here was asked, and each says in its own cell what became of the asking.",
  );
  expect(line).not.toContain("named none of the row's covered engines");
  expect(line).not.toContain("named nobody");
  expect(line).not.toContain("results shown together");
  expect(line).not.toContain("ended without a served result");
});

test("R12/2 — the definition-changed clause rides BESIDE a real cohort", () => {
  const cohort = resolveBatchCohort(
    new Map<string, MatrixPhase>([
      [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
      [ETHFI.id, ok(RUN_BOOK_ETHFI_V2)], // answered for another definition
    ]),
    null,
    COVERAGE,
    IDENTITY,
  );
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.definitionChangedScenarioIds).toEqual([ETHFI.id]);

  expect(batchHeaderLine(cohort, null)).toBe(
    "results shown together were measured at batch #1. Every DISPLAYED result was measured at " +
      "that batch. 1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing " +
      "— the committed set moved after this page loaded. Nothing failed and nothing was " +
      "withheld: a result computed for one definition is simply never read against the coverage " +
      "of another, so the row is not classified, pins no batch, and is no part of the sentence " +
      "above. Refresh the committed listing to run against the current definition.",
  );
});

test("R12/2 — THE REFRESH PATH: with the v2 listing the SAME stored answer classifies", () => {
  // The affordance's whole contract, and the reason the state is DERIVED rather
  // than stored: re-read `GET /v1/scenarios`, and the answer that was
  // unclassifiable a moment ago is read against the definition it was actually
  // computed for. Nothing is re-run to make this happen.
  const phases = new Map<string, MatrixPhase>([[ETHFI.id, ok(RUN_BOOK_ETHFI_V2)]]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE_V2, IDENTITY_V2);

  expect(cohort.definitionChangedScenarioIds).toEqual([]);
  expect(cohort.allHoleScenarioIds).toEqual([]);
  expect(cohort.currentScenarioIds).toEqual([ETHFI.id]);
  expect(cohort.displayedPins).toEqual([{ scenarioId: ETHFI.id, batchId: 1 }]);
  expect(cohort.anchorBatchId).toBe(1);

  // The v2 definition covers aave alone, so aave carries the result and
  // debt_manager is NOT COVERED — a property of the DEFINITION, exactly as it
  // has always been, now read against the right one.
  const served = cellState({
    scenario: ETHFI_V2,
    engine: "aave_v3_etherfi",
    phase: ok(RUN_BOOK_ETHFI_V2),
    cohort,
    identity: IDENTITY_V2.get(ETHFI.id),
  });
  expect(served.state).toBe("result");
  expect(
    cellState({
      scenario: ETHFI_V2,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETHFI_V2),
      cohort,
      identity: IDENTITY_V2.get(ETHFI.id),
    }).state,
  ).toBe("not-covered");

  expect(batchHeaderLine(cohort, null)).toBe(
    "results shown together were measured at batch #1. Every DISPLAYED result was measured at " +
      "that batch.",
  );
});

test("R12/2 — SENSITIVITY: without the identity source, the SAME phases read the old way", () => {
  // The R11 sensitivity test's shape, for the new guard. The ONLY difference
  // between the two calls is whether the listing's identity was supplied; with
  // it absent nothing is inferred, and the v2 book is read against v1 coverage
  // exactly as the defect did.
  const phases = new Map<string, MatrixPhase>([[ETHFI.id, ok(RUN_BOOK_ETHFI_V2)]]);

  const blind = resolveBatchCohort(phases, null, COVERAGE);
  expect(blind.allHoleScenarioIds).toEqual([ETHFI.id]);
  expect(blind.definitionChangedScenarioIds).toEqual([]);
  expect(
    cellState({ scenario: ETHFI, engine: "debt_manager", phase: ok(RUN_BOOK_ETHFI_V2), cohort: blind })
      .state,
  ).toBe("unanswered");

  const seeing = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);
  expect(seeing.allHoleScenarioIds).toEqual([]);
  expect(seeing.definitionChangedScenarioIds).toEqual([ETHFI.id]);
  expect(
    cellState({
      scenario: ETHFI,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETHFI_V2),
      cohort: seeing,
      identity: IDENTITY.get(ETHFI.id),
    }).state,
  ).toBe("definition-changed");
});

// ---------------------------------------------------------------------------
// The two guards together.
// ---------------------------------------------------------------------------

test("R12 — VALIDITY IS DECIDED BEFORE IDENTITY, and the reason says so", () => {
  // A body that contradicts itself is invalid whichever definition it belongs
  // to, and telling the reader "your listing moved" about it would send them to
  // refresh a listing that was never the problem.
  const bothWrong = {
    ...RUN_BOOK_CONTRADICTORY,
    scenario_config_version: "v9",
  } as typeof RUN_BOOK_ETH;
  const refusal = bookRefusal(bothWrong as unknown as LabRunBook, IDENTITY.get(DEPEG.id));
  expect(refusal).not.toBeNull();
  if (refusal === null) throw new Error("unreachable");
  expect(refusal.kind).toBe("contradicted");
  expect(refusal.reason).toContain("THE SERVED BOOK CONTRADICTS ITSELF");
  expect(refusal.reason).not.toContain("DEFINITION CHANGED");

  // A clean body with a moved identity gets the other answer, and only it.
  const skewed = bookRefusal(
    RUN_BOOK_ETHFI_V2 as unknown as LabRunBook,
    IDENTITY.get(ETHFI.id),
  );
  expect(skewed?.kind).toBe("definition-changed");
  // A clean body against its own definition passes both, as it always has.
  expect(bookRefusal(RUN_BOOK_ETH as unknown as LabRunBook, IDENTITY.get(ETH.id))).toBeNull();
});

test("R12 — the five ways a run can leave a row empty are counted SEPARATELY", () => {
  // R11's three, plus R12's two. Each has its own set and its own sentence,
  // because each is a different thing to have happened and a reader who is told
  // the wrong one has been told something false.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, RUNNING_COLD], // in flight
    [DEPEG.id, ok(RUN_BOOK_NAMES_NOBODY)], // served a book naming nobody
    [RATE.id, FAILED_COLD], // ended without a book
    [ETHFI.id, ok(RUN_BOOK_ETHFI_V2)], // answered for another definition
  ]);
  const cohort = resolveBatchCohort(phases, null, COVERAGE, IDENTITY);
  expect(cohort.inFlightScenarioIds).toEqual([ETH.id]);
  expect(cohort.allHoleScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.unansweredScenarioIds).toEqual([RATE.id]);
  expect(cohort.definitionChangedScenarioIds).toEqual([ETHFI.id]);

  const withContradiction = resolveBatchCohort(
    new Map<string, MatrixPhase>([...phases, [DEPEG.id, ok(RUN_BOOK_CONTRADICTORY)]]),
    null,
    COVERAGE,
    IDENTITY,
  );
  expect(withContradiction.contradictedScenarioIds).toEqual([DEPEG.id]);
  expect(withContradiction.allHoleScenarioIds).toEqual([]);

  const line = batchHeaderLine(withContradiction, null);
  expect(line).toContain("1 run(s) are in flight");
  expect(line).toContain("1 run(s) ended without a served result");
  expect(line).toContain("1 run(s) were served a book that CONTRADICTS ITSELF");
  expect(line).toContain("1 run(s) answered for a committed definition this page is no longer showing");
  expect(line).not.toContain("no run has been issued yet");
});

test("R12 — every cell state still has exactly one label, and no two share one", () => {
  const labels = Object.values(CELL_STATE_LABEL);
  expect(new Set(labels).size).toBe(labels.length);
  expect(CELL_STATE_LABEL.unanswered).toBe("UNANSWERED");
  expect(CELL_STATE_LABEL.contradicted).toBe("CONTRADICTORY BOOK");
  expect(CELL_STATE_LABEL["definition-changed"]).toBe("DEFINITION CHANGED");
});

// ===========================================================================
// WAVE R13 (Codex round-21) — THE TABLE SPEAKS ONLY FOR THE ROWS IT DRAWS.
//
// FINDING 1 (LabMatrix.tsx:313-318). `phases` is component state keyed by
// scenario id, and it OUTLIVES the listing it was built against. A deployment
// stops publishing a committed scenario; the reader takes R12's listing-refresh
// affordance; the row leaves the table — and the phase stored under its id stays
// behind. R11's coverage guard and R12's identity guard are BOTH keyed per row,
// so neither can say anything about a row that is not there: `coverage.get(id)`
// and `identity.get(id)` are undefined, `isAllHoleBook` and `definitionSkew`
// each correctly decline to infer, and the orphan reached `resolveBatchCohort`
// as a DISPLAYED PIN. Carrying the newest batch it took the anchor, marked every
// VISIBLE result SUPERSEDED, and left the header naming a cohort with no
// rendered current row in it.
//
// FINDING 2 (LabBookPanel.tsx:420-428). The failed-re-run banners on both
// surfaces composed from `rerunFailed !== undefined` alone, never asking what
// the retained outcome actually was. Over a response R12 REFUSES to present, the
// detail strip claimed "The result below is the one this row already held, at
// the batch it was measured on" directly above a gated view whose entire text is
// "refusing to render", and the matrix's banner claimed the cells still showed a
// measurement over cells reading CONTRADICTORY BOOK. A surface may not call a
// response a result one line above refusing to present it.
//
// THE RULE FOR BOTH: a claim is composed only from what the surface actually
// RENDERS. Finding 1 restricts the cohort's inputs to the rendered row set, in
// one place, before the reads; finding 2 gates the banner's wording through the
// same `bookRefusal` every other sentence here already passes.
// ===========================================================================

/** The listing after a deployment stopped publishing `weeth_market_...`. */
const LISTED = SCENARIOS_REMOVED.scenarios;
const COVERAGE_LISTED = rowCoverage(LISTED);
const IDENTITY_LISTED = rowIdentity(LISTED, SCENARIOS_REMOVED.scenario_config_version);

/** The row the refreshed listing dropped — every ghost phase below is keyed here. */
const GHOST = DEPEG.id;

/** The rendered rows' own state: one visible result, at batch 1. */
function visibleAtOne(): Map<string, MatrixPhase> {
  return new Map<string, MatrixPhase>([[ETH.id, ok(RUN_BOOK_ETH)]]);
}

/** The same map with a ghost phase of the given shape appended. */
function withGhost(shape: MatrixPhase): Map<string, MatrixPhase> {
  return new Map<string, MatrixPhase>([...visibleAtOne(), [GHOST, shape]]);
}

/** The cohort as the component builds it: filtered, then read. */
function renderedCohort(phases: ReadonlyMap<string, MatrixPhase>) {
  return resolveBatchCohort(
    listedPhases(phases, LISTED),
    null,
    COVERAGE_LISTED,
    IDENTITY_LISTED,
  );
}

// ---------------------------------------------------------------------------
// FINDING 1 — a phase whose scenario the listing no longer names.
// ---------------------------------------------------------------------------

test("R13/1 — THE MECHANISM: for an unlisted row BOTH optional guards are inert", () => {
  // This is why absence is not a guard, and it is the whole reason the orphan
  // needs its own rule rather than a third classifier. Neither existing check is
  // wrong here — each is declining to infer something it genuinely cannot know —
  // and between them nothing is left to refuse the response.
  expect(COVERAGE_LISTED.get(GHOST)).toBeUndefined();
  expect(IDENTITY_LISTED.get(GHOST)).toBeUndefined();

  // R11: a book cannot testify to which engines a scenario is defined for.
  expect(isAllHoleBook(RUN_BOOK_NAMES_NOBODY as unknown as LabRunBook, undefined)).toBe(false);
  // R12: a response cannot testify to which definition the page is showing.
  expect(definitionSkew(RUN_BOOK_ETHFI_V2 as unknown as LabRunBook, undefined)).toBeNull();
  expect(bookRefusal(RUN_BOOK_ETH as unknown as LabRunBook, undefined)).toBeNull();

  // So UNFILTERED, the ghost is a first-class member of the cohort.
  const unfiltered = resolveBatchCohort(
    withGhost(ok(RUN_BOOK_ETH)),
    null,
    COVERAGE_LISTED,
    IDENTITY_LISTED,
  );
  expect(unfiltered.displayedPins).toContainEqual({ scenarioId: GHOST, batchId: 1 });
});

test("R13/1 — THE INVARIANT: an unlisted phase changes NOTHING, whatever shape it is in", () => {
  // The ruling's own list, one shape per entry: a result at the cohort's own
  // batch, a result at a NEWER batch (the shape that took the anchor), held
  // evidence behind an in-flight request, a book that named nobody, a book that
  // contradicts itself, and a run that ended without a book. Every one of them
  // is a state the cohort has a NAMED SET and a header clause for — so if the
  // filter missed any, one of the eleven fields below would move.
  const shapes: [string, MatrixPhase][] = [
    ["current — a result at the displayed cohort's own batch", ok(RUN_BOOK_WEETH_BATCH_1)],
    ["superseded — a result at a NEWER batch, the shape that took the anchor", ok(RUN_BOOK_BATCH_2)],
    ["held — an in-flight request still carrying batch 2", runningHolding(RUN_BOOK_BATCH_2)],
    ["all-hole — a 200 that named nobody", ok(RUN_BOOK_NAMES_NOBODY)],
    ["contradicted — a body that answers one cell two ways", ok(RUN_BOOK_CONTRADICTORY)],
    ["unanswered — a run that ended without a book", FAILED_COLD],
    ["idle — asked about, then reset", { kind: "idle" }],
  ];

  const rendered = renderedCohort(visibleAtOne());
  const anchorOnly = observedAnchorBatch(
    listedPhases(visibleAtOne(), LISTED),
    COVERAGE_LISTED,
    IDENTITY_LISTED,
  );
  const line = batchHeaderLine(rendered, 1);

  for (const [what, shape] of shapes) {
    const haunted = withGhost(shape);
    // THE COHORT — every set, every pin, and the anchor, field for field.
    expect(renderedCohort(haunted), what).toEqual(rendered);
    // THE WATERMARK's own input, read exactly as the component reads it.
    expect(
      observedAnchorBatch(listedPhases(haunted, LISTED), COVERAGE_LISTED, IDENTITY_LISTED),
      what,
    ).toEqual(anchorOnly);
    // AND THE SENTENCE — no clause counts it, in either direction.
    expect(batchHeaderLine(renderedCohort(haunted), 1), what).toBe(line);
  }

  // Stated positively, so the test cannot pass by everything being empty: the
  // rendered row IS the cohort, at its own batch, and says so.
  expect(rendered.currentScenarioIds).toEqual([ETH.id]);
  expect(rendered.anchorBatchId).toBe(1);
  expect(line).toContain("results shown together were measured at batch #1.");
  expect(line).toContain("Every DISPLAYED result was measured at that batch.");
});

test("R13/1 — THE DEFECT SEQUENCE: a NEWER ghost marked a VISIBLE result SUPERSEDED", () => {
  // The reported reproduction. `eth_minus_30` is on the table displaying batch
  // 1; the delisted row's stored phase carries batch 2. Read unfiltered, the
  // ghost is the only member of `currentScenarioIds` — a cohort with no rendered
  // row in it — and the one row a reader can actually see is repainted
  // SUPERSEDED against an anchor nothing on screen holds.
  const haunted = withGhost(ok(RUN_BOOK_BATCH_2));

  const ghosted = resolveBatchCohort(haunted, null, COVERAGE_LISTED, IDENTITY_LISTED);
  expect(ghosted.anchorBatchId).toBe(2);
  expect(ghosted.currentScenarioIds).toEqual([GHOST]);
  expect(ghosted.supersededScenarioIds).toEqual([ETH.id]);
  expect(batchHeaderLine(ghosted, null)).toContain(
    "results shown together were measured at batch #2.",
  );
  expect(batchHeaderLine(ghosted, null)).toContain(
    "1 row(s) still hold an older batch's result and are marked SUPERSEDED",
  );
  // …and the cell agrees with the header while contradicting the reader's eyes.
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETH),
      cohort: ghosted,
      identity: IDENTITY_LISTED.get(ETH.id),
    }).state,
  ).toBe("superseded");

  // FILTERED: the ghost is NOT THERE. Not refused, not a hole — there is no row
  // for it to be a statement about, so the visible row is simply the cohort.
  const rendered = renderedCohort(haunted);
  expect(rendered.anchorBatchId).toBe(1);
  expect(rendered.currentScenarioIds).toEqual([ETH.id]);
  expect(rendered.supersededScenarioIds).toEqual([]);
  expect(
    cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: ok(RUN_BOOK_ETH),
      cohort: rendered,
      identity: IDENTITY_LISTED.get(ETH.id),
    }).state,
  ).toBe("result");

  // AND IT IS IN NO CLAUSE — not as a cohort member, not as a superseded row,
  // and not as any of the refusal sets either. It is absent, not accounted for.
  const line = batchHeaderLine(rendered, null);
  expect(line).toContain("results shown together were measured at batch #1.");
  expect(line).toContain("Every DISPLAYED result was measured at that batch.");
  expect(line).not.toContain("SUPERSEDED");
  expect(line).not.toContain("row(s) were served a book");
  expect(line).not.toContain("no longer showing");
});

test("R13/1 — A GHOST NEVER MAKES A ROW SUPERSEDED that no listed row could", () => {
  // The other order, and the harder one: the delisted row's answer lands while
  // its row is already gone (a request in flight across the refresh), so the
  // watermark was never raised by it. Read unfiltered, a FIRST run on a listed
  // row comes back and is instantly stamped SUPERSEDED by a row the table does
  // not draw. Filtered, it is what it is — current, alone, at its own batch.
  const phases = new Map<string, MatrixPhase>([
    [GHOST, ok(RUN_BOOK_BATCH_2)],
    [ETH.id, ok(RUN_BOOK_ETH)],
  ]);

  const ghosted = resolveBatchCohort(phases, null, COVERAGE_LISTED, IDENTITY_LISTED);
  expect(ghosted.supersededScenarioIds).toEqual([ETH.id]);

  const rendered = renderedCohort(phases);
  expect(rendered.currentScenarioIds).toEqual([ETH.id]);
  expect(rendered.supersededScenarioIds).toEqual([]);
  expect(rendered.anchorBatchId).toBe(1);
});

test("R13/1 — THE FLOOR is not lowered by a delisting, and the header stays honest", () => {
  // The watermark is a floor on what THIS PANEL HAS SEEN, and R8 made it
  // monotonic to stop an older row repainting as CURRENT. A delisting does not
  // unsee a batch, so the floor stays — what changes is that the ghost can no
  // longer PUT a batch into the anchor. The header then does exactly what R9
  // built it to do: it declines to name a cohort nothing belongs to, and counts
  // only the rows that are displayed.
  const rendered = resolveBatchCohort(
    listedPhases(withGhost(ok(RUN_BOOK_BATCH_2)), LISTED),
    2, // the floor learned while the delisted row was still on the table
    COVERAGE_LISTED,
    IDENTITY_LISTED,
  );
  expect(rendered.anchorBatchId).toBe(2);
  expect(rendered.currentScenarioIds).toEqual([]);
  expect(rendered.supersededScenarioIds).toEqual([ETH.id]);

  const line = batchHeaderLine(rendered, null);
  expect(line).toContain("NO result now displayed was measured at it");
  expect(line).toContain("1 row(s) are displayed and every one of them is OLDER");
  expect(line).not.toContain("results shown together");
});

test("R13/1 — `listedPhases` keeps the listing's rows, in the map's OWN order", () => {
  const phases = new Map<string, MatrixPhase>([
    [RATE.id, FAILED_COLD],
    [GHOST, ok(RUN_BOOK_BATCH_2)],
    [ETH.id, ok(RUN_BOOK_ETH)],
  ]);
  // Order is load-bearing: the cohort's set order IS the map's iteration order,
  // and this spec pins those sets with `toEqual` on arrays.
  expect([...listedPhases(phases, LISTED).keys()]).toEqual([RATE.id, ETH.id]);
  expect([...listedPhases(phases, definitions).keys()]).toEqual([RATE.id, GHOST, ETH.id]);
  expect([...listedPhases(phases, []).keys()]).toEqual([]);
  // The phases themselves are carried through untouched — this filters, it does
  // not reclassify.
  expect(listedPhases(phases, LISTED).get(ETH.id)).toBe(phases.get(ETH.id));
});

test("R13/1 — SENSITIVITY: without the filter, the SAME phases read the old way", () => {
  // The R11 and R12 sensitivity shape, for the new guard. The ONLY difference
  // between the two calls is whether the phases were restricted to the rendered
  // rows first; with them unrestricted the orphan pins, anchors and is counted.
  const phases = withGhost(ok(RUN_BOOK_NAMES_NOBODY));

  const blind = resolveBatchCohort(phases, null, COVERAGE_LISTED, IDENTITY_LISTED);
  expect(blind.displayedPins).toContainEqual({ scenarioId: GHOST, batchId: 1 });
  expect(blind.currentScenarioIds).toEqual([ETH.id, GHOST]);

  const seeing = renderedCohort(phases);
  expect(seeing.displayedPins).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);
  expect(seeing.currentScenarioIds).toEqual([ETH.id]);
  expect(seeing.allHoleScenarioIds).toEqual([]);
});

// ---------------------------------------------------------------------------
// FINDING 2 — what a failed re-run left behind, named for what it is.
// ---------------------------------------------------------------------------

/** The failure sentence the real path composes, from a real 503 outcome. */
const RERUN_503 = unansweredReason({
  kind: "no-batch",
  message: "no complete risk batch is available",
  retryAfterSeconds: 5,
});

/** R8's state: the held outcome came back, with the later failure beside it. */
function rerunFailedOver(body: typeof RUN_BOOK_ETH): MatrixPhase {
  return {
    kind: "outcome",
    outcome: { kind: "ok", response: body as unknown as LabRunBook },
    rerunFailed: RERUN_503,
  };
}

test("R13/2 — A CLEAN HELD RESULT keeps R8's wording, verbatim, on both surfaces", () => {
  const phase = rerunFailedOver(RUN_BOOK_ETH);
  const matrix = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETH.id), "matrix");
  const detail = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETH.id), "detail");
  if (matrix === null || detail === null) throw new Error("a failed re-run must be disclosed");

  expect(matrix.retained).toBe("result");
  expect(detail.retained).toBe("result");
  expect(matrix.register).toBeNull();

  // The R8 assertions, unchanged — this response IS presented, so calling it a
  // result is the honest thing and nothing about it moves.
  expect(matrix.line).toBe(
    `re-run ended without a book — ${RERUN_503} The cells still show what this row already ` +
      `measured, at its own batch.`,
  );
  expect(detail.line).toBe(
    `the re-run ended without a book — ${RERUN_503} The result below is the one this row already ` +
      `held, at the batch it was measured on; nothing was overwritten and nothing was invented ` +
      `in its place.`,
  );
  expect(matrix.line).toContain("no servable batch (503)");
  expect(detail.line).toContain("retry after 5s");
});

test("R13/2 — A CONTRADICTORY HELD RESPONSE is never called a result, on either surface", () => {
  const phase = rerunFailedOver(RUN_BOOK_CONTRADICTORY);
  const matrix = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETH.id), "matrix");
  const detail = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETH.id), "detail");
  if (matrix === null || detail === null) throw new Error("a failed re-run must be disclosed");

  // THE DERIVATION, single-sourced: both surfaces agree on WHAT is retained and
  // on the register naming it, so they cannot compose different accounts of it.
  expect(matrix.retained).toBe("refused");
  expect(detail.retained).toBe("refused");
  expect(matrix.register).toBe("CONTRADICTORY BOOK");
  expect(detail.register).toBe("CONTRADICTORY BOOK");

  for (const banner of [matrix, detail]) {
    // THE FAILURE IS STILL NAMED — the fix must not swallow the event R8 exposed.
    expect(banner.line).toContain("no servable batch (503)");
    expect(banner.line).toContain("retry after 5s");
    // THE RETAINED RESPONSE IS NOT A RESULT, and is not called one.
    expect(banner.line).toContain("What this row still holds is NOT a result");
    expect(banner.line).toContain("this surface REFUSES to present");
    expect(banner.line).toContain("CONTRADICTORY BOOK");
    // THE FALSE COMPOSITIONS, gone. Both are direct quotes of the defect.
    expect(banner.line).not.toContain("The result below");
    expect(banner.line).not.toContain("The cells still show what this row already measured");
    expect(banner.line).not.toContain("at the batch it was measured on");
    // AND R8's ASSURANCE SURVIVES: the evidence was retained, not overwritten.
    expect(banner.line).toContain("Nothing was overwritten");
  }

  // They point the reader at DIFFERENT places, because that is the one thing
  // that genuinely differs: the row's own cells, or the panel below.
  expect(matrix.line).toContain("every covered cell of this row names that refusal");
  expect(detail.line).toContain("named below in its own words");
});

test("R13/2 — A DEFINITION-SKEWED HELD RESPONSE gets its own register, not a result", () => {
  const phase = rerunFailedOver(RUN_BOOK_ETHFI_V2);
  const matrix = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETHFI.id), "matrix");
  const detail = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETHFI.id), "detail");
  if (matrix === null || detail === null) throw new Error("a failed re-run must be disclosed");

  expect(matrix.retained).toBe("refused");
  expect(detail.retained).toBe("refused");
  expect(matrix.register).toBe("DEFINITION CHANGED");
  expect(detail.register).toBe("DEFINITION CHANGED");
  for (const banner of [matrix, detail]) {
    expect(banner.line).toContain("What this row still holds is NOT a result");
    expect(banner.line).toContain("DEFINITION CHANGED");
    expect(banner.line).not.toContain("The result below");
    expect(banner.line).not.toContain("CONTRADICTORY BOOK");
  }
});

test("R13/2 — the banner's register is the SAME vocabulary the cells refuse in", () => {
  // One response, one register, wherever the reader looks. If a new refusal kind
  // ever lands, this fails until the banner learns its word too.
  for (const [body, state] of [
    [RUN_BOOK_CONTRADICTORY, "contradicted"],
    [RUN_BOOK_ETHFI_V2, "definition-changed"],
  ] as const) {
    const identity = IDENTITY_LISTED.get(ETHFI.id);
    const phase = rerunFailedOver(body);
    const banner = rerunFailedBanner(phase, identity, "detail");
    const cell = cellState({
      scenario: ETHFI,
      engine: "debt_manager",
      phase,
      cohort: renderedCohort(new Map([[ETHFI.id, phase]])),
      identity,
    });
    expect(cell.state).toBe(state);
    expect(banner?.register).toBe(CELL_STATE_LABEL[state]);
    expect(banner?.line).toContain(CELL_STATE_LABEL[state]);
  }
});

test("R13/2 — SENSITIVITY: without the identity source, the SAME phase reads the old way", () => {
  // The skew guard is what makes the wording change, and this proves it: the
  // identical retained response, judged with no identity claim, is a response
  // this surface DOES present — so it is a result and is called one.
  const phase = rerunFailedOver(RUN_BOOK_ETHFI_V2);
  const blind = rerunFailedBanner(phase, undefined, "detail");
  expect(blind?.retained).toBe("result");
  expect(blind?.line).toContain("The result below");

  const seeing = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETHFI.id), "detail");
  expect(seeing?.retained).toBe("refused");
  expect(seeing?.line).not.toContain("The result below");
});

test("R13/2 — no failed re-run, no banner: the disclosure is never invented", () => {
  expect(rerunFailedBanner({ kind: "idle" }, undefined, "matrix")).toBeNull();
  expect(rerunFailedBanner({ kind: "running" }, undefined, "matrix")).toBeNull();
  expect(rerunFailedBanner(runningHolding(RUN_BOOK_ETH), undefined, "detail")).toBeNull();
  // An outcome with no LATER failure beside it says nothing about a re-run.
  expect(rerunFailedBanner(ok(RUN_BOOK_ETH), undefined, "detail")).toBeNull();
  expect(rerunFailedBanner(FAILED_COLD, undefined, "detail")).toBeNull();

  // The unreachable arm is STATED rather than assumed: `rerunFailed` is only
  // ever written beside a held `kind: "ok"` outcome, but if it were not, the
  // banner must still refuse to promise a result.
  const unserved: MatrixPhase = { ...FAILED_COLD, rerunFailed: RERUN_503 } as MatrixPhase;
  const banner = rerunFailedBanner(unserved, undefined, "detail");
  expect(banner?.retained).toBe("unserved");
  expect(banner?.line).toContain("This row holds no result and no served response at all");
  expect(banner?.line).not.toContain("The result below");
});

// ---------------------------------------------------------------------------
// R13b — the flagged adjacency, integrator-ruled: a retained ALL-HOLE book
// under a failed re-run. The R13 wave flagged it and declined to act without a
// ruling; the ruling is that a book that measured nothing is never called a
// measurement, however cleanly its envelope arrived.
// ---------------------------------------------------------------------------

test("R13b — A RETAINED ALL-HOLE BOOK is never called a measurement, on either surface", () => {
  // RUN_BOOK_NAMES_NOBODY derives from the DEPEG run-book — its identity must
  // match, or the gate (correctly) refuses it as skewed before the hole read.
  const phase = rerunFailedOver(RUN_BOOK_NAMES_NOBODY);
  const matrix = rerunFailedBanner(phase, IDENTITY_LISTED.get(DEPEG.id), "matrix", DEPEG.engines);
  const detail = rerunFailedBanner(phase, IDENTITY_LISTED.get(DEPEG.id), "detail", DEPEG.engines);
  if (matrix === null || detail === null) throw new Error("a failed re-run must be disclosed");

  expect(matrix.retained).toBe("all-hole");
  expect(detail.retained).toBe("all-hole");
  expect(matrix.register).toBeNull();

  for (const banner of [matrix, detail]) {
    // THE FAILURE IS STILL NAMED — the ruling must not swallow the event.
    expect(banner.line).toContain("no servable batch (503)");
    // THE RETAINED BOOK IS NOT A RESULT, and is not called one.
    expect(banner.line).toContain("What this row still holds is NOT a result");
    expect(banner.line).toContain("named none of the engines this row's committed definition covers");
    // THE FALSE COMPOSITION, gone — the exact sentence the adjacency flagged.
    expect(banner.line).not.toContain("The cells still show what this row already measured");
    expect(banner.line).not.toContain("The result below");
    expect(banner.line).not.toContain("at the batch it was measured on");
    // AND the retention assurance survives: nothing was overwritten.
    expect(banner.line).toContain("Nothing was overwritten");
  }
  // Each surface points where its reader should look.
  expect(matrix.line).toContain("every covered cell reads UNANSWERED");
  expect(detail.line).toContain("the outcome below says so in its own words");
});

test("R13b — WITHOUT the covered list, nothing is inferred: the pre-ruling reading stands", () => {
  // The same discipline as isAllHoleBook and definitionSkew: an absent source
  // infers nothing. A caller that cannot say what the row covers cannot accuse
  // the book of naming none of it.
  const phase = rerunFailedOver(RUN_BOOK_NAMES_NOBODY);
  const banner = rerunFailedBanner(phase, IDENTITY_LISTED.get(DEPEG.id), "matrix");
  expect(banner?.retained).toBe("result");
});

test("R13b — the clean case is untouched by the new parameter", () => {
  const phase = rerunFailedOver(RUN_BOOK_ETH);
  const matrix = rerunFailedBanner(phase, IDENTITY_LISTED.get(ETH.id), "matrix", ETH.engines);
  expect(matrix?.retained).toBe("result");
  expect(matrix?.line).toBe(
    `re-run ended without a book — ${RERUN_503} The cells still show what this row already ` +
      `measured, at its own batch.`,
  );
});

// ---------------------------------------------------------------------------
// The remaining states.
// ---------------------------------------------------------------------------

test("not run / running are their own states — neither is blank and neither is a zero", () => {
  const empty = resolveBatchCohort(new Map());
  expect(cellState({ scenario: ETH, engine: "debt_manager", phase: { kind: "idle" }, cohort: empty }).state).toBe(
    "not-run",
  );
  expect(
    cellState({ scenario: ETH, engine: "debt_manager", phase: { kind: "running" }, cohort: empty })
      .state,
  ).toBe("running");
});

test("a scenario the batch CANNOT answer is UNANSWERED — never a zero", () => {
  const empty = resolveBatchCohort(new Map());
  const outcomes: Exclude<RunBookOutcome, { kind: "ok" }>[] = [
    { kind: "not-served" },
    { kind: "no-batch", message: "no complete risk batch", retryAfterSeconds: 5 },
    { kind: "rate-limited", retryAfterSeconds: null },
    { kind: "unreachable", message: "network down" },
    { kind: "failed", status: 500, message: "boom" },
  ];
  for (const outcome of outcomes) {
    const cell = cellState({
      scenario: ETH,
      engine: "debt_manager",
      phase: { kind: "outcome", outcome },
      cohort: empty,
    });
    expect(cell.state).toBe("unanswered");
    if (cell.state !== "unanswered") throw new Error("unreachable");
    expect(cell.reason.length).toBeGreaterThan(0);
    expect(cell.reason).not.toBe("0");
  }
  expect(unansweredReason({ kind: "not-served" })).toContain("about the DEPLOYMENT");
  expect(
    unansweredReason({ kind: "no-batch", message: "none", retryAfterSeconds: 5 }),
  ).toContain("retry after 5s");
});

test("a 200 that names an engine in NEITHER list is a HOLE, and is never filled with a zero", () => {
  // DERIVED NEGATIVE: the run answers, but drops the engine the committed
  // definition claims. That is a contract violation upstream; downstream, the
  // only honest rendering is that nothing was returned for the cell.
  const holed = {
    ...RUN_BOOK_ETH,
    engines: RUN_BOOK_ETH.engines.filter((engine) => engine.engine !== "aave_v3_etherfi"),
  };
  const phases = new Map<string, MatrixPhase>([[ETH.id, ok(holed as typeof RUN_BOOK_ETH)]]);
  const cell = cellState({
    scenario: ETH,
    engine: "aave_v3_etherfi",
    phase: phases.get(ETH.id) as MatrixPhase,
    cohort: resolveBatchCohort(phases),
  });
  expect(cell.state).toBe("unanswered");
  if (cell.state !== "unanswered") throw new Error("unreachable");
  expect(cell.reason).toContain("neither a result nor a refusal");
  expect(cell.reason).toContain("will not fill a hole with a zero");
});

test("the result cell carries the run's OWN delta, in the engine's OWN decimals", () => {
  const phases = new Map<string, MatrixPhase>([[ETH.id, ok(RUN_BOOK_ETH)]]);
  const cell = cellState({
    scenario: ETH,
    engine: "debt_manager",
    phase: phases.get(ETH.id) as MatrixPhase,
    cohort: resolveBatchCohort(phases),
  });
  expect(cell.state).toBe("result");
  if (cell.state !== "result") throw new Error("unreachable");
  expect(cell.engine.eligible_debt_delta_usd).toBe("1500000000");
  expect(cell.engine.usd_decimals).toBe(6);
  expect(cell.batchId).toBe(1);
});

// ===========================================================================
// WAVE R14 (Codex round-22).
//
// FINDING 1 (matrixCells.ts, `listedPhases`). The filter R13 added is a
// MEMBERSHIP test keyed by scenario id, which is the only question a map keyed
// by id can be asked. A row that leaves the listing is dropped; a row that comes
// BACK is re-admitted on the strength of its id, whatever the definition behind
// it has become. `kind: "ok"` outcomes defend themselves — the body publishes
// `scenario_id` + `scenario_version` + `scenario_config_version` and R12's
// `bookRefusal` reads them — but a RUNNING phase and a NON-OK outcome publish
// NOTHING. So a v1 run that failed reappeared on a re-listed v2 row as RUNNING
// or UNANSWERED, and the header counted the v2 row among the rows this session
// asked about, though v2 was never asked anything. That is R13's own promise
// broken in the sentence it made it in: a returning row classifies "as itself,
// or as DEFINITION CHANGED".
//
// FINDING 2 (LabBookPanel's `BookResult`). "excluded engines: none — every
// engine's book reached the run" was gated on `excluded_engines.length === 0`
// alone, which is not that claim. A book that serves ONE of two covered engines
// and refuses neither satisfies the gate exactly, while the engine it never
// mentioned reads UNANSWERED in the matrix above. At the limit — a book naming
// NOBODY — R13b's detail banner had already promised "the outcome below says so
// in its own words" over a panel saying the opposite.
//
// THE RULE FOR BOTH: a claim is composed only from what the surface can actually
// establish. Finding 1 binds every phase to the identity it was ASKED under, at
// dispatch, because that is the only identity a run without a body ever has;
// finding 2 gates the completeness sentence on the whole of the claim it makes.
// ===========================================================================

/** The listing after the dropped row is REPUBLISHED, re-cut: DEPEG at v2. */
const RELISTED = SCENARIOS_RELISTED.scenarios;
const COVERAGE_RELISTED = rowCoverage(RELISTED);
const IDENTITY_RELISTED = rowIdentity(RELISTED, SCENARIOS_RELISTED.scenario_config_version);

const DEPEG_V2 = ((): ScenarioDefinition => {
  const found = RELISTED.find((scenario) => scenario.id === DEPEG.id);
  if (found === undefined) throw new Error("the re-listed fixture carries no depeg definition");
  return found;
})();

/** The stamp a run dispatched while the v1 listing was on screen carries. */
const STAMP_V1 = IDENTITY.get(DEPEG.id);

/** …and the identity the SAME row publishes once the re-cut listing lands. */
const IDENT_V2 = IDENTITY_RELISTED.get(DEPEG.id);

/** A phase with the identity the row was showing at dispatch stamped on it. */
function stamped(shape: MatrixPhase, attempt: ScenarioIdentity | undefined): MatrixPhase {
  return { ...shape, attempt } as MatrixPhase;
}

/**
 * EVERY WAY A RUN CAN CARRY NO BODY OF ITS OWN. `running` is the in-flight
 * window; the five below are `RunBookOutcome`'s whole non-ok arm, and each is a
 * state whose cell would otherwise read UNANSWERED on a definition that was
 * never asked anything.
 */
const BODYLESS_SHAPES: [string, MatrixPhase][] = [
  ["running — the request is still out", { kind: "running" }],
  [
    "unanswered-404 — this deployment does not serve run-book",
    { kind: "outcome", outcome: { kind: "not-served" } },
  ],
  [
    "unanswered-503 — no servable batch",
    {
      kind: "outcome",
      outcome: {
        kind: "no-batch",
        message: "no complete risk batch is available.",
        retryAfterSeconds: 5,
      },
    },
  ],
  [
    "unanswered-network — no HTTP response at all",
    { kind: "outcome", outcome: { kind: "unreachable", message: "fetch failed" } },
  ],
  [
    "unanswered-429 — rate limited",
    { kind: "outcome", outcome: { kind: "rate-limited", retryAfterSeconds: 3 } },
  ],
  [
    "unanswered-5xx — the service answered without a book",
    { kind: "outcome", outcome: { kind: "failed", status: 500, message: "internal error" } },
  ],
];

// ---------------------------------------------------------------------------
// FINDING 1 — the attempt, bound to the identity it was asked under.
// ---------------------------------------------------------------------------

test("R14/1 — THE MECHANISM: a phase with no body has no identity for R12 to read", () => {
  // This is why the id re-admits it and why neither existing guard can object.
  // R12 reads the RESPONSE; there is no response here to read, and R11's
  // coverage read is about a book that was never served either.
  for (const [what, shape] of BODYLESS_SHAPES) {
    expect(batchOfPhase(shape, DEPEG_V2.engines, IDENT_V2), what).toBeNull();
    // The row IS in the re-listed set, so R13's filter admits it — correctly:
    // there is a row for this id, and something WAS asked under it.
    expect([...listedPhases(new Map([[DEPEG.id, shape]]), RELISTED).keys()], what).toEqual([
      DEPEG.id,
    ]);
  }
  // And the two identities the join is between really do differ by exactly the
  // scenario's own version — the set's token did not move.
  expect(STAMP_V1).toEqual({ scenarioId: DEPEG.id, version: "v1", configVersion: "v1" });
  expect(IDENT_V2).toEqual({ scenarioId: DEPEG.id, version: "v2", configVersion: "v1" });
});

test("R14/1 — THE ROUND TRIP: delist, re-list at v2, and EVERY bodyless shape is DEFINITION CHANGED", () => {
  for (const [what, shape] of BODYLESS_SHAPES) {
    const phases = new Map<string, MatrixPhase>([
      [ETH.id, ok(RUN_BOOK_ETH)], // a real, listed, displayed result at batch 1
      [DEPEG.id, stamped(shape, STAMP_V1)], // asked under v1
    ]);

    // ---- STEP 1: still listed at v1. The phase is exactly what it is. -------
    const atV1 = resolveBatchCohort(listedPhases(phases, definitions), null, COVERAGE, IDENTITY);
    expect(atV1.attemptedScenarioIds, what).toContain(DEPEG.id);
    expect(atV1.definitionChangedScenarioIds, what).toEqual([]);

    // ---- STEP 2: DELISTED. R13's filter: it is not there, at all. ----------
    const removed = resolveBatchCohort(
      listedPhases(phases, LISTED),
      null,
      COVERAGE_LISTED,
      IDENTITY_LISTED,
    );
    expect(removed.attemptedScenarioIds, what).toEqual([ETH.id]);
    expect(removed.definitionChangedScenarioIds, what).toEqual([]);

    // ---- STEP 3: RE-LISTED AT v2 — the finding. ---------------------------
    const relisted = resolveBatchCohort(
      listedPhases(phases, RELISTED),
      null,
      COVERAGE_RELISTED,
      IDENTITY_RELISTED,
    );
    expect(relisted.definitionChangedScenarioIds, what).toEqual([DEPEG.id]);
    expect(relisted.definitionChangedAttemptScenarioIds, what).toEqual([DEPEG.id]);
    // NEVER THE NEW ROW'S ATTEMPT, in any of the three tenses that claim would
    // be made in. Pre-R14 the row was in `attempted` and in one of the other two.
    expect(relisted.attemptedScenarioIds, what).toEqual([ETH.id]);
    expect(relisted.inFlightScenarioIds, what).toEqual([]);
    expect(relisted.unansweredScenarioIds, what).toEqual([]);
    // And it contributes nothing anywhere else either.
    expect(relisted.displayedPins, what).toEqual([{ scenarioId: ETH.id, batchId: 1 }]);
    expect(relisted.inFlightHeldPins, what).toEqual([]);
    expect(relisted.allHoleScenarioIds, what).toEqual([]);
    expect(relisted.contradictedScenarioIds, what).toEqual([]);

    // THE CELL AGREES WITH THE HEADER, in the register R12 already owns.
    const cell = cellState({
      scenario: DEPEG_V2,
      engine: "debt_manager",
      phase: stamped(shape, STAMP_V1),
      cohort: relisted,
      identity: IDENT_V2,
    });
    expect(cell.state, what).toBe("definition-changed");
    if (cell.state !== "definition-changed") throw new Error("unreachable");
    expect(cell.skew.subject, what).toBe("attempt");
    // No book came back, so there is no batch to disclose — the one thing an
    // answer has that an attempt never does.
    expect(cell.batchId, what).toBeNull();
    expect(cell.skew.reason, what).toContain(
      "this attempt belongs to a definition this page is no longer showing",
    );
    expect(cell.skew.reason, what).toContain("scenario_version disagree");
    // NEVER the pre-R14 readings, and never R12's response wording either.
    expect(cell.state, what).not.toBe("running");
    expect(cell.state, what).not.toBe("unanswered");
    expect(cell.skew.reason, what).not.toContain("the run answered for");
    expect(CELL_STATE_LABEL[cell.state], what).toBe("DEFINITION CHANGED");
  }
});

test("R14/1 — SAME-VERSION re-listing keeps the phase as ITSELF: the stamp agrees", () => {
  // The other half of the promise. A row that leaves the listing and comes back
  // UNCHANGED is the same definition it always was, so nothing is refused and
  // nothing is renamed — the phase reads exactly as it read before.
  for (const [what, shape] of BODYLESS_SHAPES) {
    const phases = new Map<string, MatrixPhase>([[DEPEG.id, stamped(shape, STAMP_V1)]]);
    const cohort = resolveBatchCohort(listedPhases(phases, definitions), null, COVERAGE, IDENTITY);
    expect(cohort.definitionChangedScenarioIds, what).toEqual([]);
    expect(cohort.attemptedScenarioIds, what).toEqual([DEPEG.id]);
    const expected = shape.kind === "running" ? "running" : "unanswered";
    expect(
      cellState({
        scenario: DEPEG,
        engine: "debt_manager",
        phase: stamped(shape, STAMP_V1),
        cohort,
        identity: STAMP_V1,
      }).state,
      what,
    ).toBe(expected);
    expect(attemptSkew(stamped(shape, STAMP_V1), STAMP_V1), what).toBeNull();
  }
});

test("R14/1 — AN UNSTAMPED PHASE infers nothing: the pre-R14 reading stands", () => {
  // The discipline R11 gave absent coverage and R12 gave absent identity. The
  // type admits an unstamped phase transitionally; nothing this wave writes
  // produces one, and one that exists is not guessed at in either direction.
  for (const [what, shape] of BODYLESS_SHAPES) {
    expect(attemptSkew(shape, IDENT_V2), what).toBeNull();
    const phases = new Map<string, MatrixPhase>([[DEPEG.id, shape]]);
    const cohort = resolveBatchCohort(
      listedPhases(phases, RELISTED),
      null,
      COVERAGE_RELISTED,
      IDENTITY_RELISTED,
    );
    expect(cohort.attemptedScenarioIds, what).toEqual([DEPEG.id]);
    expect(cohort.definitionChangedScenarioIds, what).toEqual([]);
  }
  // An idle phase is not an attempt whatever is stamped on it.
  expect(attemptSkew({ kind: "idle" }, IDENT_V2)).toBeNull();
});

test("R14/1 — SENSITIVITY: without the listing identity, the SAME stamped phases read the old way", () => {
  // The R11/R12/R13 sensitivity shape. The ONLY difference between the two calls
  // is whether the current listing's identity was supplied; with it absent the
  // v1 attempt is read as the v2 row's own, exactly as the defect did.
  const phases = new Map<string, MatrixPhase>([
    [DEPEG.id, stamped({ kind: "outcome", outcome: { kind: "not-served" } }, STAMP_V1)],
  ]);

  const blind = resolveBatchCohort(listedPhases(phases, RELISTED), null, COVERAGE_RELISTED);
  expect(blind.attemptedScenarioIds).toEqual([DEPEG.id]);
  expect(blind.unansweredScenarioIds).toEqual([DEPEG.id]);
  expect(blind.definitionChangedScenarioIds).toEqual([]);
  expect(batchHeaderLine(blind, null)).toContain("1 run(s) ended without a served result");

  const seeing = resolveBatchCohort(
    listedPhases(phases, RELISTED),
    null,
    COVERAGE_RELISTED,
    IDENTITY_RELISTED,
  );
  expect(seeing.attemptedScenarioIds).toEqual([]);
  expect(seeing.unansweredScenarioIds).toEqual([]);
  expect(seeing.definitionChangedAttemptScenarioIds).toEqual([DEPEG.id]);
  expect(batchHeaderLine(seeing, null)).not.toContain("ended without a served result");
});

test("R14/1 — THE OK PATH IS NOT DOUBLE-GATED: the response's own identity wins, both ways", () => {
  // THE ADJACENCY THE RULING NAMES. The stamp and a served body CAN disagree —
  // the reader runs while the listing says v1 against a deployment that has
  // already moved — and where they do, exactly ONE register may result. The
  // body's is the one that counts: it is the server's word about what it
  // computed, and R12's refresh path turns on it.

  // (i) STAMPED v1, ANSWERED v2, LISTING v2 → the answer is about the definition
  //     on screen, so the row classifies CLEANLY. Gating on the stamp here would
  //     break R12's promise that a stored answer becomes readable "the moment the
  //     listing it was computed against is the one on screen".
  const answeredV2 = stamped(ok(RUN_BOOK_WEETH_V2), STAMP_V1);
  expect(attemptSkew(answeredV2, IDENT_V2)).toBeNull();
  const clean = resolveBatchCohort(
    new Map([[DEPEG.id, answeredV2]]),
    null,
    COVERAGE_RELISTED,
    IDENTITY_RELISTED,
  );
  expect(clean.definitionChangedScenarioIds).toEqual([]);
  expect(clean.currentScenarioIds).toEqual([DEPEG.id]);
  expect(
    cellState({
      scenario: DEPEG_V2,
      engine: "debt_manager",
      phase: answeredV2,
      cohort: clean,
      identity: IDENT_V2,
    }).state,
  ).toBe("result");

  // (ii) STAMPED v2, ANSWERED v1, LISTING v2 → ONE register again, and it is the
  //      RESPONSE's: R12's `subject: "response"` skew, with R12's own wording.
  const answeredV1 = stamped(ok(RUN_BOOK_WEETH_BATCH_1), IDENT_V2);
  expect(attemptSkew(answeredV1, IDENT_V2)).toBeNull();
  const cohort = resolveBatchCohort(
    new Map([[DEPEG.id, answeredV1]]),
    null,
    COVERAGE_RELISTED,
    IDENTITY_RELISTED,
  );
  const skewed = cellState({
    scenario: DEPEG_V2,
    engine: "debt_manager",
    phase: answeredV1,
    cohort,
    identity: IDENT_V2,
  });
  expect(skewed.state).toBe("definition-changed");
  if (skewed.state !== "definition-changed") throw new Error("unreachable");
  expect(skewed.skew.subject).toBe("response");
  expect(skewed.skew.reason).toContain("this scenario's committed definition changed");
  expect(skewed.skew.reason).not.toContain("this attempt belongs to");
  // …and it is counted with R12's ANSWERS, not with R14's attempts.
  expect(cohort.definitionChangedScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.definitionChangedAttemptScenarioIds).toEqual([]);
});

test("R14/1 — THE HEADER: an attempt is never called an answer, and never called “not run”", () => {
  const phases = new Map<string, MatrixPhase>([
    [DEPEG.id, stamped({ kind: "outcome", outcome: { kind: "not-served" } }, STAMP_V1)],
  ]);
  const cohort = resolveBatchCohort(
    listedPhases(phases, RELISTED),
    null,
    COVERAGE_RELISTED,
    IDENTITY_RELISTED,
  );

  const line = batchHeaderLine(cohort, null);
  expect(line).toBe(
    "no result has been served to this table yet: 1 run(s) were ASKED under a committed " +
      "definition this page is no longer showing and never came back with a book of their own — " +
      "re-run to ask under the current one. There is no batch for this table to be as of — and " +
      "this is NOT “not run”: every row counted here was asked, and each says in its own cell " +
      "what became of the asking.",
  );
  // THE CONTRADICTION THIS ARM EXISTS TO PREVENT: `attemptedScenarioIds` is
  // deliberately empty here, and the no-run arm keys off exactly that. Left
  // alone it would have announced "every covered cell reads not run" above two
  // cells reading DEFINITION CHANGED.
  expect(cohort.attemptedScenarioIds).toEqual([]);
  expect(line).not.toBe(MATRIX_NO_RUN_LINE);
  expect(line).not.toContain("no run has been issued yet");
  // …nor any of the accounts that belong to other events.
  expect(line).not.toContain("ended without a served result");
  expect(line).not.toContain("are in flight");
  expect(line).not.toContain("answered for a committed definition");
  expect(line).not.toContain("named none of the row's covered engines");
});

test("R14/1 — the attempt clause rides BESIDE a real cohort, and beside R12's own", () => {
  // Both halves of the definition-changed set at once, over a live cohort. They
  // are counted separately and worded separately because the REMEDIES differ:
  // an answer needs a fresh listing, an attempt needs a fresh run.
  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)], // displayed @1
    [ETHFI.id, stamped(ok(RUN_BOOK_ETHFI_V2), IDENTITY.get(ETHFI.id))], // an ANSWER, skewed
    [DEPEG.id, stamped({ kind: "running" }, STAMP_V1)], // an ATTEMPT, skewed
  ]);
  const cohort = resolveBatchCohort(
    listedPhases(phases, RELISTED),
    null,
    COVERAGE_RELISTED,
    IDENTITY_RELISTED,
  );
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.definitionChangedScenarioIds).toEqual([ETHFI.id, DEPEG.id]);
  expect(cohort.definitionChangedAttemptScenarioIds).toEqual([DEPEG.id]);
  expect(cohort.inFlightScenarioIds).toEqual([]);

  const line = batchHeaderLine(cohort, null);
  // R12's sentence, byte for byte, with its own count of ONE — the attempt is
  // not folded into it.
  expect(line).toContain(
    "1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing — the " +
      "committed set moved after this page loaded.",
  );
  expect(line).toContain("Refresh the committed listing to run against the current definition.");
  // R14's, with its own count and the OTHER remedy.
  expect(line).toContain(
    "1 row(s) were ASKED under a COMMITTED DEFINITION this page is no longer showing and never " +
      "came back with a book of their own",
  );
  expect(line).toContain("Re-run the row to ask under the current definition");
  expect(line).toContain("a listing refresh resolves nothing here");
  // The cohort above is untouched, and the in-flight assurance is NOT claimed
  // for a request that is out under another definition.
  expect(line).toContain("results shown together were measured at batch #1.");
  expect(line).not.toContain("row(s) have a run in flight");
});

test("R14/1 — a skewed attempt's HELD evidence raises neither the anchor nor the watermark", () => {
  // The clause says such a row "pins no batch". A running phase carries held
  // evidence that ordinarily anchors the cohort (R8), so letting it anchor here
  // would falsify that sentence in the breath it is composed — and would hand
  // the anchor to a request nobody on this table made.
  // The v2 answer at a NEWER batch, so the two readings cannot coincide by
  // accident: the fixture with ONE field moved, exactly as the generator's own
  // supersession variants move it.
  const V2_AT_TWO = {
    ...RUN_BOOK_WEETH_V2,
    batch: { ...RUN_BOOK_WEETH_V2.batch, id: 2 },
  } as typeof RUN_BOOK_ETH;

  const held = stamped(runningHolding(V2_AT_TWO), STAMP_V1); // held @2, asked under v1
  expect(anchorBatchOfPhase(held, DEPEG_V2.engines, IDENT_V2)).toBeNull();
  // With the stamp AGREEING it anchors exactly as R8 built it to — so the null
  // above is the stamp's doing and nothing else's.
  expect(
    anchorBatchOfPhase(stamped(runningHolding(V2_AT_TWO), IDENT_V2), DEPEG_V2.engines, IDENT_V2),
  ).toBe(2);

  const phases = new Map<string, MatrixPhase>([
    [ETH.id, ok(RUN_BOOK_ETH)],
    [DEPEG.id, held],
  ]);
  const listedNow = listedPhases(phases, RELISTED);
  expect(observedAnchorBatch(listedNow, COVERAGE_RELISTED, IDENTITY_RELISTED)).toBe(1);
  const cohort = resolveBatchCohort(listedNow, null, COVERAGE_RELISTED, IDENTITY_RELISTED);
  expect(cohort.anchorBatchId).toBe(1);
  expect(cohort.currentScenarioIds).toEqual([ETH.id]);
  expect(cohort.supersededScenarioIds).toEqual([]);
  expect(cohort.inFlightHeldPins).toEqual([]);

  // AND THE FLOOR IS NOT LOWERED — R13's rule, for R13's reason. A watermark
  // learned while the row was its old self is a statement about what this panel
  // HAS SEEN; what changes is only that this phase can no longer PUT a batch in.
  const withFloor = resolveBatchCohort(listedNow, 2, COVERAGE_RELISTED, IDENTITY_RELISTED);
  expect(withFloor.anchorBatchId).toBe(2);
  expect(withFloor.currentScenarioIds).toEqual([]);
  expect(batchHeaderLine(withFloor, null)).toContain("NO result now displayed was measured at it");
});

test("R14/1 — the in-flight attempt's own wording names the request, not a re-run", () => {
  // The two remedies differ by whether the request is still out, and the
  // sentence must not send a reader to click a button the row has disabled.
  const running = attemptSkew(stamped({ kind: "running" }, STAMP_V1), IDENT_V2);
  const ended = attemptSkew(
    stamped({ kind: "outcome", outcome: { kind: "not-served" } }, STAMP_V1),
    IDENT_V2,
  );
  expect(running?.reason).toContain("The request is still out");
  expect(running?.reason).toContain("judged by the identity the response publishes for ITSELF");
  expect(running?.reason).not.toContain("Re-run this row");
  expect(ended?.reason).toContain(
    "Re-run this row to ask under the definition this page is showing",
  );
  expect(ended?.reason).not.toContain("The request is still out");
  // Both name the two identities in full, so the reader can point at each.
  for (const skew of [running, ended]) {
    expect(skew?.subject).toBe("attempt");
    expect(skew?.served).toEqual(STAMP_V1);
    expect(skew?.listing).toEqual(IDENT_V2);
    expect(skew?.fields).toEqual(["scenario_version"]);
    expect(skew?.reason).toContain(
      "weeth_market_depeg_oracles_held v1 at scenario_config_version v1",
    );
    expect(skew?.reason).toContain(
      "weeth_market_depeg_oracles_held v2 at scenario_config_version v1",
    );
  }
});

// ---------------------------------------------------------------------------
// FINDING 2 — the completeness claim, gated on the whole of what it claims.
// ---------------------------------------------------------------------------

test("R14/2 — THE COMPLETENESS CONDITION: both halves, or the sentence is not said", () => {
  const covered = DEPEG.engines; // aave_v3_etherfi + debt_manager
  expect(covered).toEqual(["aave_v3_etherfi", "debt_manager"]);

  // THE CLEAN BOOK: nothing refused AND every covered engine served. Only here
  // is "every engine's book reached the run" a true thing to say.
  expect(
    bookReachedEveryCoveredEngine(RUN_BOOK_WEETH_BATCH_1 as unknown as LabRunBook, covered),
  ).toBe(true);
  expect(bookHoleEngines(RUN_BOOK_WEETH_BATCH_1 as unknown as LabRunBook, covered)).toEqual([]);

  // THE FINDING: a PARTIAL HOLE satisfies the OLD gate exactly —
  // `excluded_engines` is empty — while one covered engine reached nothing.
  expect(RUN_BOOK_PARTIAL_HOLE.excluded_engines).toEqual([]);
  expect(bookHoleEngines(RUN_BOOK_PARTIAL_HOLE as unknown as LabRunBook, covered)).toEqual([
    "aave_v3_etherfi",
  ]);
  expect(
    bookReachedEveryCoveredEngine(RUN_BOOK_PARTIAL_HOLE as unknown as LabRunBook, covered),
  ).toBe(false);
  // …and the matrix says so in the cell, which is the statement the panel used
  // to contradict.
  expect(
    cellState({
      scenario: DEPEG,
      engine: "aave_v3_etherfi",
      phase: ok(RUN_BOOK_PARTIAL_HOLE),
      cohort: resolveBatchCohort(
        new Map([[DEPEG.id, ok(RUN_BOOK_PARTIAL_HOLE)]]),
        null,
        COVERAGE,
        IDENTITY,
      ),
      identity: IDENTITY.get(DEPEG.id),
    }).state,
  ).toBe("unanswered");

  // A WITHHELD ENGINE IS NOT A HOLE — it reached the run and was refused, which
  // is a different sentence and a different cell state.
  expect(bookHoleEngines(RUN_BOOK_WITHHELD as unknown as LabRunBook, covered)).toEqual([]);
  expect(bookReachedEveryCoveredEngine(RUN_BOOK_WITHHELD as unknown as LabRunBook, covered)).toBe(
    false,
  );

  // THE ALL-HOLE BOOK: the limit case, where there is no engine the claim could
  // even be about.
  expect(bookHoleEngines(RUN_BOOK_NAMES_NOBODY as unknown as LabRunBook, covered)).toEqual(covered);
  expect(
    bookReachedEveryCoveredEngine(RUN_BOOK_NAMES_NOBODY as unknown as LabRunBook, covered),
  ).toBe(false);
});

test("R14/2 — the hole read agrees with `isAllHoleBook` at the row level, by construction", () => {
  // One predicate, two granularities. If they could disagree, the panel and the
  // header would be describing two different books.
  const covered = DEPEG.engines;
  for (const body of [
    RUN_BOOK_WEETH_BATCH_1,
    RUN_BOOK_WITHHELD,
    RUN_BOOK_PARTIAL_HOLE,
    RUN_BOOK_NAMES_NOBODY,
  ]) {
    const response = body as unknown as LabRunBook;
    expect(isAllHoleBook(response, covered)).toBe(
      bookHoleEngines(response, covered).length === covered.length,
    );
  }
});

test("R14/2 — WITHOUT the covered list, nothing is inferred: the pre-R14 reading stands", () => {
  // The discipline `isAllHoleBook` and `definitionSkew` keep. A caller that
  // cannot say what the row covers cannot accuse the book of missing any of it —
  // so the sentence falls back to exactly its old condition, and only that.
  expect(bookHoleEngines(RUN_BOOK_PARTIAL_HOLE as unknown as LabRunBook, undefined)).toEqual([]);
  expect(
    bookReachedEveryCoveredEngine(RUN_BOOK_PARTIAL_HOLE as unknown as LabRunBook, undefined),
  ).toBe(true);
  expect(bookReachedEveryCoveredEngine(RUN_BOOK_WITHHELD as unknown as LabRunBook, undefined)).toBe(
    false,
  );
});
