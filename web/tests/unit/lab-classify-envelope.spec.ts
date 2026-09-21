// The envelope classifiers: a 2xx body is judged against its envelope's
// contract before anything is read from it. The object members (`batch`,
// `evaluation`, `coverage`) and every list are named when they are not what
// the contract says they are, in wire read order; a list's elements are named
// per index. The committed fixtures classify CLEAN — the law refuses no served
// body.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { classifyRunBookEnvelope, classifySetEnvelope, classifySetResult } from "../../lib/lab-classify";
import type { RunBookSetResponse, SetRunScenarioResult } from "../../lib/lab-compare";
import type { LabRunBook } from "../../lib/runbook";
import { DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { cashEngine, DEMO_CASH_TABLE, runBookOf } from "./helpers/run-book-engine";

const SET = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/run-book-set.json", import.meta.url)), "utf8")) as RunBookSetResponse;
const RUN = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
const run = (overrides: Record<string, unknown>): LabRunBook => ({ ...RUN, ...overrides }) as unknown as LabRunBook;
const set = (overrides: Record<string, unknown>): RunBookSetResponse => ({ ...SET, ...overrides }) as unknown as RunBookSetResponse;

test("the served bodies classify clean: the helper's run-book, the demo run-book, the committed set and the demo set", () => {
  expect(classifyRunBookEnvelope(RUN)).toEqual([]);
  expect(classifyRunBookEnvelope(DEMO_RUN_BOOK_ETH as unknown as LabRunBook)).toEqual([]);
  expect(classifySetEnvelope(SET)).toEqual([]);
  expect(classifySetEnvelope(DEMO_RUN_BOOK_SET)).toEqual([]);
  for (const r of [...SET.results, ...DEMO_RUN_BOOK_SET.results]) expect(classifySetResult(r)).toEqual([]);
});

test("a run-book's object members: a missing or non-object batch or coverage is named; inside a batch, the fields the page reads", () => {
  expect(classifyRunBookEnvelope(run({ batch: undefined }))).toEqual(["batch"]);
  expect(classifyRunBookEnvelope(run({ batch: null }))).toEqual(["batch"]);
  expect(classifyRunBookEnvelope(run({ batch: "18251" }))).toEqual(["batch"]);
  expect(classifyRunBookEnvelope(run({ coverage: undefined }))).toEqual(["coverage"]);
  expect(classifyRunBookEnvelope(run({ coverage: [] }))).toEqual(["coverage"]);
  expect(classifyRunBookEnvelope(run({ batch: { ...RUN.batch, id: "18251" } }))).toEqual(["batch.id"]);
  expect(classifyRunBookEnvelope(run({ batch: { ...RUN.batch, id: -0 } }))).toEqual(["batch.id"]);
  expect(classifyRunBookEnvelope(run({ batch: { ...RUN.batch, age_seconds: 1.5 } }))).toEqual(["batch.age_seconds"]);
  expect(classifyRunBookEnvelope(run({ batch: { ...RUN.batch, supersession: null } }))).toEqual(["batch.supersession"]);
  expect(classifyRunBookEnvelope(run({ batch: { ...RUN.batch, supersession: { ...RUN.batch.supersession, superseded: "no" } } }))).toEqual(["batch.supersession.superseded"]);
});

test("a run-book's lists: each one that is not a list is named, in wire read order; an element that is not what the list holds is named per index", () => {
  for (const field of ["shocks", "out_of_model", "applied_shocks", "held_flat", "engines", "excluded_engines", "notes"]) {
    expect(classifyRunBookEnvelope(run({ [field]: undefined }))).toEqual([field]);
    expect(classifyRunBookEnvelope(run({ [field]: {} }))).toEqual([field]);
  }
  expect(classifyRunBookEnvelope({} as unknown as LabRunBook)).toEqual(["batch", "shocks", "out_of_model", "applied_shocks", "held_flat", "engines", "excluded_engines", "coverage", "notes"]);
  expect(classifyRunBookEnvelope(run({ engines: [null], excluded_engines: [{ engine: "debt_manager" }, "debt_manager"] }))).toEqual(["engines[0]", "excluded_engines[1]"]);
  expect(classifyRunBookEnvelope(run({ shocks: [7], applied_shocks: [null], held_flat: [[]] }))).toEqual(["shocks[0]", "applied_shocks[0]", "held_flat[0]"]);
  expect(classifyRunBookEnvelope(run({ out_of_model: ["funding", {}], notes: [null] }))).toEqual(["out_of_model[1]", "notes[0]"]);
});

test("a set's envelope: batch, evaluation and coverage as objects, the evaluation's own fields, every list, and each result an object", () => {
  expect(classifySetEnvelope(set({ batch: undefined }))).toEqual(["batch"]);
  expect(classifySetEnvelope(set({ batch: { ...SET.batch, id: 1.5 } }))).toEqual(["batch.id"]);
  expect(classifySetEnvelope(set({ evaluation: undefined }))).toEqual(["evaluation"]);
  expect(classifySetEnvelope(set({ evaluation: { ...SET.evaluation, scenarios_evaluated: "2" } }))).toEqual(["evaluation.scenarios_evaluated"]);
  expect(classifySetEnvelope(set({ evaluation: { ...SET.evaluation, freshness: "fresh" } }))).toEqual(["evaluation.freshness"]);
  expect(classifySetEnvelope(set({ evaluation: { ...SET.evaluation, newest_servable_batch_id: -1 } }))).toEqual(["evaluation.newest_servable_batch_id"]);
  // Null is the wire's own statement that no batch was servable at the probe.
  expect(classifySetEnvelope(set({ evaluation: { ...SET.evaluation, newest_servable_batch_id: null } }))).toEqual([]);
  expect(classifySetEnvelope(set({ coverage: null }))).toEqual(["coverage"]);
  for (const field of ["requested_scenario_ids", "results", "excluded_engines", "notes"]) expect(classifySetEnvelope(set({ [field]: undefined }))).toEqual([field]);
  expect(classifySetEnvelope({} as unknown as RunBookSetResponse)).toEqual(["batch", "evaluation", "requested_scenario_ids", "results", "excluded_engines", "coverage", "notes"]);
  expect(classifySetEnvelope(set({ requested_scenario_ids: ["a_one", 2], results: [SET.results[0], null] }))).toEqual(["requested_scenario_ids[1]", "results[1]"]);
});

test("a set result's four engine lists: each that is not a list is named, and each element that is not what the list holds", () => {
  const base = SET.results[0]!;
  const result = (overrides: Record<string, unknown>): SetRunScenarioResult => ({ ...base, ...overrides }) as unknown as SetRunScenarioResult;
  expect(classifySetResult(result({ engines: undefined }))).toEqual(["engines"]);
  expect(classifySetResult(result({ covered_engines: null, withheld_engines: "", unmeasurable_engines: {} }))).toEqual(["covered_engines", "withheld_engines", "unmeasurable_engines"]);
  expect(classifySetResult(result({ covered_engines: ["debt_manager", 4], withheld_engines: [null], unmeasurable_engines: ["debt_manager"], engines: [null] }))).toEqual([
    "covered_engines[1]",
    "withheld_engines[0]",
    "unmeasurable_engines[0]",
    "engines[0]",
  ]);
});
