// The envelope classifiers: a 2xx body is judged against its envelope's
// contract before anything is read from it. The object members (`batch`,
// `evaluation`, `coverage`) and every list are named when they are not what
// the contract says they are, in wire read order; a list's elements are named
// per index. The committed fixtures classify CLEAN — the law refuses no served
// body.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { BODY_NOT_OBJECT, classifyRunBookEnvelope, classifySetEnvelope, classifySetResult, contractFaults } from "../../lib/lab-classify";
import type { RunBookSetResponse, SetRunScenarioResult } from "../../lib/lab-compare";
import type { LabRunBook } from "../../lib/runbook";
import { DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { cashEngine, DEMO_CASH_TABLE, runBookOf } from "./helpers/run-book-engine";

const SET = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/run-book-set.json", import.meta.url)), "utf8")) as RunBookSetResponse;
const RUN = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
const run = (overrides: Record<string, unknown>): LabRunBook => ({ ...RUN, ...overrides }) as unknown as LabRunBook;
/** A refusal as the contract shapes it: the engine it speaks for and the code its cause is read from. */
const REFUSAL = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven", note: "" };
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
  expect(classifyRunBookEnvelope({} as unknown as LabRunBook)).toEqual([
    "served_at",
    "batch",
    "scenario_config_version",
    "scenario_id",
    "scenario_version",
    "label",
    "path_assumption",
    "shocks",
    "out_of_model",
    "applied_shocks",
    "held_flat",
    "engines",
    "excluded_engines",
    "coverage",
    "notes",
  ]);
  expect(classifyRunBookEnvelope(run({ engines: [null], excluded_engines: [REFUSAL, "debt_manager"] }))).toEqual(["engines[0]", "excluded_engines[1]"]);
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
  // A result carries the id it is asked for by and the label its row prints: each that is not a string is named.
  expect(classifySetEnvelope(set({ results: [{ ...SET.results[0], scenario_id: 7, label: {} }] }))).toEqual(["results[0].scenario_id", "results[0].label"]);
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
  // An absence names the engine it speaks for and the reason its row prints.
  expect(classifySetResult(result({ unmeasurable_engines: [{ engine: "debt_manager" }, { engine: 4, reason: "no position was measurable" }] }))).toEqual(["unmeasurable_engines[0].reason", "unmeasurable_engines[1].engine"]);
});

test("a body that is not a JSON object is named in one sentence of its own, by both envelopes, and nothing else is asked of it", () => {
  expect(BODY_NOT_OBJECT).toBe("the response body is not a JSON object");
  for (const body of [null, undefined, 7, "ok", true, [], [RUN]]) {
    expect(classifyRunBookEnvelope(body as unknown as LabRunBook)).toEqual([BODY_NOT_OBJECT]);
    expect(classifySetEnvelope(body as unknown as RunBookSetResponse)).toEqual([BODY_NOT_OBJECT]);
  }
  // The reasons a reader sees: a field keeps the wire's own case and is outside the wire contract; the body's sentence
  // is capitalised as the sentence it is — it opens the dek and follows a full stop in the banner.
  expect(contractFaults(["batch", BODY_NOT_OBJECT, "engines[1]"])).toEqual(["batch is outside the wire contract", "The response body is not a JSON object", "engines[1] is outside the wire contract"]);
});

test("a refusal is read only when it names its engine and carries a string code: the member that fails is named, on both envelopes; an empty code is the contract's own and stays", () => {
  const cases: [unknown, string[]][] = [
    [{ engine: "debt_manager" }, ["excluded_engines[0].code"]],
    [{ ...REFUSAL, code: null }, ["excluded_engines[0].code"]],
    [{ ...REFUSAL, code: 503 }, ["excluded_engines[0].code"]],
    [{ ...REFUSAL, code: { name: "FLAG_CUSTODY_UNPROVEN" } }, ["excluded_engines[0].code"]],
    [{ ...REFUSAL, engine: undefined }, ["excluded_engines[0].engine"]],
    [{ ...REFUSAL, engine: "" }, ["excluded_engines[0].engine"]],
    [{ ...REFUSAL, engine: "  " }, ["excluded_engines[0].engine"]],
    [{}, ["excluded_engines[0].engine", "excluded_engines[0].code"]],
    [null, ["excluded_engines[0]"]],
    [[], ["excluded_engines[0]"]],
    // The contract types `code` a string and floors no length: a refusal that names no code is still a refusal, and the phrasebook says so.
    [{ ...REFUSAL, code: "" }, []],
    // `detail` is read through the phrasebook's own string gate; it is never the classifier's to refuse.
    [{ engine: "debt_manager", code: "SOMETHING_NEW" }, []],
    [REFUSAL, []],
  ];
  for (const [refusal, names] of cases) {
    expect(classifyRunBookEnvelope(run({ excluded_engines: [refusal] }))).toEqual(names);
    expect(classifySetEnvelope(set({ excluded_engines: [refusal] }))).toEqual(names);
  }
});

test("the string members the page prints or compares: each that is not a string is named, in wire read order — an object where a sentence belongs never reaches the page", () => {
  for (const field of ["served_at", "scenario_config_version", "scenario_id", "scenario_version", "label", "path_assumption"]) {
    expect(classifyRunBookEnvelope(run({ [field]: undefined }))).toEqual([field]);
    expect(classifyRunBookEnvelope(run({ [field]: { text: "v1" } }))).toEqual([field]);
  }
  expect(classifyRunBookEnvelope(run({ applied_shocks: [{ asset: {}, source: "chainlink" }], held_flat: [{ asset: "0xabc", source: 3 }] }))).toEqual(["applied_shocks[0].asset", "held_flat[0].source"]);
});
