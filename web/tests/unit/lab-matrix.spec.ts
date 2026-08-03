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
import { RUN_BOOK_BATCH_2, RUN_BOOK_ETH, RUN_BOOK_WITHHELD, SCENARIOS } from "../fixtures/lab-book";
import type { LabRunBook, RunBookOutcome } from "../../lib/runbook";
import {
  anchorBatchOfPhase,
  AXIS_FAMILY_WORDS,
  axisFamilies,
  axisFamilyWords,
  batchOfPhase,
  cellState,
  matrixColumns,
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
