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
  RUN_BOOK_ETH,
  RUN_BOOK_WEETH_BATCH_1,
  RUN_BOOK_WITHHELD,
  SCENARIOS,
} from "../fixtures/lab-book";
import type { LabRunBook, RunBookOutcome } from "../../lib/runbook";
import {
  anchorBatchOfPhase,
  AXIS_FAMILY_WORDS,
  axisFamilies,
  axisFamilyWords,
  batchHeaderLine,
  batchOfPhase,
  cellState,
  matrixColumns,
  MATRIX_NO_RUN_LINE,
  resolveBatchCohort,
  scenarioCoverage,
  unansweredReason,
  type MatrixPhase,
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
