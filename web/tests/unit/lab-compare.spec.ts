// Compare: each scenario's contribution as a signed share of the engine's own
// book, the wire's sanctioned denominator; every non-answer is its own kind
// and never a dot at zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { compareRows, setMembership, shareTenths, type RunBookSetResponse, type SetRunEngineSummary, type SetRunScenarioResult } from "../../lib/lab-compare";

const BASE = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/run-book-set.json", import.meta.url)), "utf8")) as RunBookSetResponse;
const TEMPLATE_ENGINE = BASE.results[0]!.engines[0]!;
const TEMPLATE_RESULT = BASE.results[0]!;

const summary = (overrides: Partial<SetRunEngineSummary>): SetRunEngineSummary => ({ ...TEMPLATE_ENGINE, engine: "debt_manager", usd_decimals: 6, ...overrides });
const result = (id: string, label: string, overrides: Partial<SetRunScenarioResult>): SetRunScenarioResult => ({
  ...TEMPLATE_RESULT,
  scenario_id: id,
  scenario_version: "v1",
  label,
  covered_engines: ["debt_manager"],
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [],
  ...overrides,
});
const setOf = (results: SetRunScenarioResult[]): RunBookSetResponse => ({ ...BASE, requested_scenario_ids: results.map((r) => r.scenario_id), results });

const CENSUS_BREAK = "engines, withheld_engines and unmeasurable_engines do not partition covered_engines";

test("shareTenths: signed, truncated toward zero, null without a positive denominator", () => {
  expect(shareTenths(1_280_000_000_000n, 27_828_808_216_758n)).toBe(45n);
  expect(shareTenths(-1n, 3000n)).toBe(0n);
  expect(shareTenths(-3n, 2n)).toBe(-1500n);
  expect(shareTenths(1n, 0n)).toBeNull();
  expect(shareTenths(1n, -5n)).toBeNull();
});

test("points are ranked by |share|, the words carry sign and tier, every non-answer keeps its own kind in wire order after the points", () => {
  const set = setOf([
    result("ethfi_minus_50", "ETHFI -50 percent", { engines: [summary({ eligible_debt_delta_usd: "9800000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 2 })] }),
    result("eth_minus_30", "ETH -30 percent", { engines: [summary({ eligible_debt_delta_usd: "1280000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 118 })] }),
    result("weeth_market_depeg_oracles_held", "weETH market depeg to 0.95 (oracles held)", { engines: [summary({ eligible_debt_delta_usd: "0", total_debt_usd_before: "27828808216758", flipped_to_eligible: 0 })] }),
    result("held", "Withheld one", { withheld_engines: ["debt_manager"] }),
    result("legacy_only", "Legacy only", { covered_engines: ["aave_v3_etherfi"], engines: [summary({ engine: "aave_v3_etherfi", usd_decimals: 8 })] }),
    result("absent", "Unmeasurable one", { unmeasurable_engines: [{ engine: "debt_manager", reason: "no_positions_in_batch", counts: { positions_in_batch: 0, refused_in_batch: 0, unrebuildable: 0 }, note: "n" }] }),
    result("zero_book", "Empty book", { engines: [summary({ eligible_debt_delta_usd: "5", total_debt_usd_before: "0" })] }),
    result("bad", "Bad wire", { engines: [summary({ eligible_debt_delta_usd: "1e6" })] }),
    result("rate", "Rate step", { engines: [summary({ eligible_debt_delta_usd: "-2000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: null })] }),
  ]);
  const v = compareRows(set, "debt_manager");
  expect(v.engine).toBe("debt_manager");
  expect(v.batchId).toBe(BASE.batch.id);
  expect(v.freshness).toBe(BASE.evaluation.freshness);
  // Points ranked by |share|, then by |Δ| (a tie under a tenth still ranks by contribution), then wire order; every non-answer after, in wire order.
  expect(v.rows.map((r) => [r.id, r.kind])).toEqual([
    ["eth_minus_30", "point"],
    ["ethfi_minus_50", "point"],
    ["rate", "point"],
    ["weeth_market_depeg_oracles_held", "point"],
    ["held", "withheld"],
    ["legacy_only", "not-covered"],
    ["absent", "unmeasurable"],
    ["zero_book", "no-denominator"],
    ["bad", "unreadable"],
  ]);
  const eth = v.rows[0]!;
  expect(eth.shareTenths).toBe(45n);
  expect(eth.shareText).toBe("+4.5%");
  expect(eth.deltaText).toBe("+$1.2M");
  expect(eth.newly).toBe(118);
  // A contribution too small for a tenth keeps its sign and says it is under the resolution — never "+0%".
  expect(v.rows[1]?.shareText).toBe("+<0.1%");
  expect(v.rows[1]?.deltaText).toBe("+$9,800");
  expect(v.rows[2]?.shareText).toBe("−<0.1%");
  expect(v.rows[2]?.deltaText).toBe("−$2,000");
  expect(v.rows[2]?.newly).toBeNull();
  expect(v.rows[3]?.shareText).toBe("0%");
  expect(v.rows[3]?.deltaText).toBe("+$0");
  expect(v.rows[4]?.reason).toBe("withheld");
  expect(v.rows[5]?.reason).toBe("not modelled");
  expect(v.rows[6]?.reason).toBe("no_positions_in_batch");
  expect(v.rows[7]?.reason).toBe("no denominator");
  expect(v.rows[7]?.deltaText).toBe("+<$0.01");
  expect(v.rows[8]?.reason).toContain("eligible_debt_delta_usd");
  for (const r of v.rows.slice(4)) expect(r.shareTenths).toBeNull();
});

test("a share over a tenth in the negative keeps the true minus and ranks by its size", () => {
  const v = compareRows(
    setOf([
      result("eth_minus_30", "ETH -30 percent", { engines: [summary({ eligible_debt_delta_usd: "1280000000000", total_debt_usd_before: "27828808216758" })] }),
      result("unwind", "Debt unwind", { engines: [summary({ eligible_debt_delta_usd: "-4500000000000", total_debt_usd_before: "27828808216758" })] }),
    ]),
    "debt_manager",
  );
  expect(v.rows.map((r) => r.id)).toEqual(["unwind", "eth_minus_30"]);
  expect(v.rows[0]?.shareTenths).toBe(-161n);
  expect(v.rows[0]?.shareText).toBe("−16.1%");
  expect(v.rows[0]?.deltaText).toBe("−$4.5M");
});

test("a malformed summary is contradictory, named by the classifier, and never a point", () => {
  const set = setOf([result("x", "X", { engines: [summary({ accounts: -1 })] })]);
  const v = compareRows(set, "debt_manager");
  expect(v.rows[0]?.kind).toBe("contradictory");
  expect(v.rows[0]?.reason).toContain("accounts");
  expect(v.rows[0]?.shareTenths).toBeNull();
  // A compound fault names every field, in wire order: wrong beyond the share's own inputs, the row is contradictory, not merely unreadable.
  const both = compareRows(setOf([result("y", "Y", { engines: [summary({ eligible_debt_delta_usd: "1e6", accounts: -1 })] })]), "debt_manager").rows[0]!;
  expect(both.kind).toBe("contradictory");
  expect(both.reason).toBe("accounts, eligible_debt_delta_usd");
  expect(both.shareTenths).toBeNull();
});

test("a result whose three engine parts do not partition covered_engines is contradictory before any engine is read", () => {
  // A summary for an engine the coverage does not name would otherwise have been a point.
  const stray = compareRows(setOf([result("stray", "Stray", { covered_engines: [], engines: [summary({ eligible_debt_delta_usd: "1280000000000", total_debt_usd_before: "27828808216758" })] })]), "debt_manager").rows[0]!;
  expect(stray.kind).toBe("contradictory");
  expect(stray.reason).toBe(`${CENSUS_BREAK}; extra: debt_manager`);
  expect(stray.shareTenths).toBeNull();
  // A covered engine in no part: the break is the result's, so the row is contradictory from either engine's view — never "not modelled" for the engine it covers.
  const gapSet = setOf([result("gap", "Gap", { covered_engines: ["debt_manager", "aave_v3_etherfi"], engines: [summary({})] })]);
  const gap = compareRows(gapSet, "debt_manager").rows[0]!;
  expect(gap.kind).toBe("contradictory");
  expect(gap.reason).toBe(`${CENSUS_BREAK}; missing: aave_v3_etherfi`);
  expect(compareRows(gapSet, "aave_v3_etherfi").rows[0]?.kind).toBe("contradictory");
  // An engine in two parts.
  const twice = compareRows(setOf([result("twice", "Twice", { withheld_engines: ["debt_manager"], engines: [summary({})] })]), "debt_manager").rows[0]!;
  expect(twice.kind).toBe("contradictory");
  expect(twice.reason).toBe(`${CENSUS_BREAK}; overlap: debt_manager`);
  // Every clause at once, each id named once.
  const all = compareRows(setOf([result("all", "All", { covered_engines: ["aave_v3_etherfi"], withheld_engines: ["debt_manager"], engines: [summary({})] })]), "debt_manager").rows[0]!;
  expect(all.reason).toBe(`${CENSUS_BREAK}; extra: debt_manager; missing: aave_v3_etherfi; overlap: debt_manager`);
});

/** A set that answers its own results: the echo is the results' ids and the evaluated count agrees. */
const answering = (results: SetRunScenarioResult[]): RunBookSetResponse => ({ ...setOf(results), evaluation: { ...BASE.evaluation, scenarios_evaluated: results.length } });

test("setMembership: the asked ids are the authority; a set that answers them passes in any order", () => {
  expect(setMembership(["b_two", "a_one"], answering([result("a_one", "A", {}), result("b_two", "B", {})]))).toEqual([]);
});

test("setMembership: a body naming an id nobody posted, and a body omitting a posted id, each fail with the count and the id named", () => {
  const two = answering([result("a_one", "A", {}), result("b_two", "B", {})]);
  expect(setMembership(["a_one"], two)).toEqual(["asked 1 id, the response names 2", "b_two is named in requested_scenario_ids and was not dispatched"]);
  expect(setMembership(["a_one", "b_two", "c_three"], two)).toEqual(["asked 3 ids, the response names 2", "c_three was dispatched and is not named in requested_scenario_ids"]);
});

test("setMembership: an echo that matches the ask while the results do not — an unrequested result, a hole, a result twice — and the evaluated count must agree", () => {
  const two = answering([result("a_one", "A", {}), result("b_two", "B", {})]);
  const extra = { ...two, results: [...two.results, result("z_nine", "Z", {})] };
  expect(setMembership(["a_one", "b_two"], extra)).toEqual(["z_nine was answered and was not requested", "evaluation.scenarios_evaluated is 2 against 3 results"]);
  const hole = { ...two, results: two.results.slice(0, 1) };
  expect(setMembership(["a_one", "b_two"], hole)).toEqual(["b_two was requested and has no result", "evaluation.scenarios_evaluated is 2 against 1 results"]);
  const twice = { ...two, results: [...two.results, result("a_one", "A", {})] };
  expect(setMembership(["a_one", "b_two"], twice)).toEqual(["a_one appears in more than one result", "evaluation.scenarios_evaluated is 2 against 3 results"]);
});

test("setMembership: a duplicated id in requested_scenario_ids refuses before any set question is posed", () => {
  const set = { ...answering([result("a_one", "A", {})]), requested_scenario_ids: ["a_one", "a_one"] };
  expect(setMembership(["a_one"], set)).toEqual(["a_one appears 2 times in requested_scenario_ids; a set names each id once"]);
});
