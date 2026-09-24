// Compare: each scenario's contribution as a signed share of the engine's own
// book, the wire's sanctioned denominator; every non-answer is its own kind
// and never a dot at zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  compareHeadline,
  compareRows,
  legacyCompareSummary,
  setMembership,
  shareTenths,
  type RunBookSetResponse,
  type SetRunEngineSummary,
  type SetRunScenarioResult,
} from "../../lib/lab-compare";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";

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
    result("horizon", "Rate horizon", {
      shock_reach: { ...TEMPLATE_RESULT.shock_reach, reach: "projection_no_spot_pass" },
      engines: [summary({ eligible_debt_delta_usd: "0", total_debt_usd_before: "27828808216758", flipped_to_eligible: 0 })],
    }),
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
    // A projection with no spot pass has no spot figure to rank: it is its own kind, never a measured zero at zero.
    ["horizon", "projection"],
  ]);
  const eth = v.rows[0]!;
  expect(eth.shareTenths).toBe(45n);
  expect(eth.shareText).toBe("+4.5%");
  expect(eth.deltaText).toBe("+$1.2M");
  expect(eth.newly).toBe(118);
  // A contribution too small for a tenth says it is under the resolution, unsigned — never "+0%"; its sign is the dot's side and the figure's.
  expect(v.rows[1]?.shareText).toBe("<0.1%");
  expect(v.rows[1]?.deltaText).toBe("+$9,800");
  expect(v.rows[2]?.shareText).toBe("<0.1%");
  expect(v.rows[2]?.deltaText).toBe("−$2,000");
  expect(v.rows[2]?.newly).toBeNull();
  expect(v.rows[3]?.shareText).toBe("0%");
  // A zero carries no sign.
  expect(v.rows[3]?.deltaText).toBe("$0");
  expect(v.rows[4]?.reason).toBe("withheld");
  expect(v.rows[5]?.reason).toBe("not modelled");
  expect(v.rows[6]?.reason).toBe("no_positions_in_batch");
  expect(v.rows[7]?.reason).toBe("no denominator");
  expect(v.rows[7]?.deltaText).toBe("+<$0.01");
  expect(v.rows[8]?.reason).toContain("eligible_debt_delta_usd");
  expect([v.rows[9]?.deltaUsd, v.rows[9]?.plotTenths, v.rows[9]?.tone]).toEqual([null, null, null]);
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

test("the envelope is classified before any set question is posed: a body outside it is refused by the names of its fields, never dereferenced; a result that breaks its own lists is one contradictory row", () => {
  const two = answering([result("a_one", "A", {}), result("b_two", "B", {})]);
  const noIds = { ...two, requested_scenario_ids: undefined } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], noIds)).toEqual(["requested_scenario_ids is outside the wire contract"]);
  const noResults = { ...two, results: null } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], noResults)).toEqual(["results is outside the wire contract"]);
  const noEvaluation = { ...two, evaluation: undefined } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], noEvaluation)).toEqual(["evaluation is outside the wire contract"]);
  const noCount = { ...two, evaluation: { ...two.evaluation, scenarios_evaluated: "2" } } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], noCount)).toEqual(["evaluation.scenarios_evaluated is outside the wire contract"]);
  // The members `compareRows` reads beyond the membership's own — the batch the figures are shown for, the freshness, the newest servable id.
  const noBatch = { ...two, batch: undefined } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], noBatch)).toEqual(["batch is outside the wire contract"]);
  expect(setMembership(["a_one"], {} as unknown as RunBookSetResponse)).toEqual(
    ["batch", "evaluation", "requested_scenario_ids", "results", "excluded_engines", "coverage", "notes"].map((f) => `${f} is outside the wire contract`),
  );
  // A body that is no JSON object has no field to name: its own sentence, and nothing of it is read.
  for (const body of [null, 7, "ok", []]) expect(setMembership(["a_one"], body as unknown as RunBookSetResponse)).toEqual(["The response body is not a JSON object"]);
  // A result that is not an object is the envelope's fault: no id is read from it.
  const nullResult = { ...two, results: [two.results[0], null] } as unknown as RunBookSetResponse;
  expect(setMembership(["a_one", "b_two"], nullResult)).toEqual(["results[1] is outside the wire contract"]);
  // A result's four engine lists: each broken one is named, and the row is contradictory before any engine is read — the rows beside it stand.
  const noEngines = compareRows(setOf([{ ...result("x", "X", {}), engines: undefined } as unknown as SetRunScenarioResult]), "debt_manager").rows[0]!;
  expect(noEngines.kind).toBe("contradictory");
  expect(noEngines.reason).toBe("engines is outside the wire contract");
  expect(noEngines.shareTenths).toBeNull();
  const none = compareRows(setOf([{ ...result("y", "Y", {}), covered_engines: null, withheld_engines: "", unmeasurable_engines: {} } as unknown as SetRunScenarioResult]), "debt_manager").rows[0]!;
  expect(none.kind).toBe("contradictory");
  expect(none.reason).toBe("covered_engines, withheld_engines, unmeasurable_engines are outside the wire contract");
  const beside = compareRows(setOf([{ ...result("z", "Z", {}), unmeasurable_engines: [null] } as unknown as SetRunScenarioResult, result("a_one", "A", { engines: [summary({})] })]), "debt_manager").rows;
  expect(beside.map((r) => [r.id, r.kind])).toEqual([["a_one", "point"], ["z", "contradictory"]]);
  expect(beside[1]?.reason).toBe("unmeasurable_engines[0] is outside the wire contract");
});

test("a dot's tone is the sign of the UNROUNDED delta and a nonzero change is never drawn at zero: a rise too small for a tenth is a critical dot one step out on the rising side, a fall too small for a tenth an ok dot one step out on the falling side, and only a measured zero sits at zero — the words stay \"<0.1%\"", () => {
  const book = "10000000000000";
  const v = compareRows(
    setOf([
      result("rise", "Small rise", { engines: [summary({ eligible_debt_delta_usd: "1000000000", total_debt_usd_before: book })] }),
      result("fall", "Small fall", { engines: [summary({ eligible_debt_delta_usd: "-1000000000", total_debt_usd_before: book })] }),
      result("none", "No change", { engines: [summary({ eligible_debt_delta_usd: "0", total_debt_usd_before: book })] }),
      result("big_rise", "Big rise", { engines: [summary({ eligible_debt_delta_usd: "450000000000", total_debt_usd_before: book })] }),
      result("big_fall", "Big fall", { engines: [summary({ eligible_debt_delta_usd: "-450000000000", total_debt_usd_before: book })] }),
      result("held", "Withheld one", { withheld_engines: ["debt_manager"] }),
    ]),
    "debt_manager",
  );
  const row = (id: string) => v.rows.find((r) => r.id === id)!;
  // +$1,000 against $10M is +0.01%: the share truncates to zero tenths, and the delta's sign still decides.
  expect(row("rise").shareTenths).toBe(0n);
  expect(row("rise").shareText).toBe("<0.1%");
  expect(row("rise").deltaText).toBe("+$1,000");
  expect(row("rise").tone).toBe("crit");
  expect(row("rise").plotTenths).toBe(1n);
  expect(row("fall").shareTenths).toBe(0n);
  expect(row("fall").shareText).toBe("<0.1%");
  expect(row("fall").tone).toBe("ok");
  expect(row("fall").plotTenths).toBe(-1n);
  // A measured zero is the only dot at zero.
  expect(row("none").shareText).toBe("0%");
  expect(row("none").tone).toBe("ok");
  expect(row("none").plotTenths).toBe(0n);
  // A share the tenths resolve is drawn where it is.
  expect([row("big_rise").tone, row("big_rise").plotTenths]).toEqual(["crit", 45n]);
  expect([row("big_fall").tone, row("big_fall").plotTenths]).toEqual(["ok", -45n]);
  // The law over every point: the dot's side of zero is the delta's sign, and its tone is the delta's.
  for (const r of v.rows) {
    if (r.kind !== "point" || r.deltaUsd === null || r.plotTenths === null) continue;
    expect(r.plotTenths > 0n).toBe(r.deltaUsd > 0n);
    expect(r.plotTenths < 0n).toBe(r.deltaUsd < 0n);
    expect(r.tone).toBe(r.deltaUsd > 0n ? "crit" : "ok");
  }
  // A row that is no point draws no dot: no place, no tone.
  expect([row("held").tone, row("held").plotTenths]).toEqual([null, null]);
});

/** The demo set answering an ask: its results for the asked ids, the echo the ask itself, the evaluated count agreeing. */
const demoSetFor = (ids: readonly string[]): RunBookSetResponse => {
  const results = DEMO_RUN_BOOK_SET.results.filter((r) => ids.includes(r.scenario_id));
  return { ...DEMO_RUN_BOOK_SET, requested_scenario_ids: [...ids], results, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, scenarios_evaluated: results.length } };
};
const edit = (set: RunBookSetResponse, id: string, change: (r: SetRunScenarioResult) => SetRunScenarioResult): RunBookSetResponse => ({
  ...set,
  results: set.results.map((r) => (r.scenario_id === id ? change(r) : r)),
});
const cashDelta = (delta: string) => (r: SetRunScenarioResult): SetRunScenarioResult => ({
  ...r,
  engines: r.engines.map((e) => (e.engine === "debt_manager" ? { ...e, eligible_debt_delta_usd: delta } : e)),
});
const withheldCash = (r: SetRunScenarioResult): SetRunScenarioResult => ({ ...r, withheld_engines: ["debt_manager"], engines: r.engines.filter((e) => e.engine !== "debt_manager") });
const TWO = ["eth_minus_30", "ethfi_minus_50"];
const ALL = DEMO_RUN_BOOK_SET.results.map((r) => r.scenario_id);

test("the rows are named from their own definitions, the wire's label kept for the title", () => {
  const v = compareRows(demoSetFor(ALL), "debt_manager");
  expect(v.rows.map((r) => r.label)).toEqual(["ETH −30%", "ETHFI −50%", "weETH depeg to 0.95, oracles held", "Cash borrow APY +200 bps"]);
  expect(v.rows[0]?.wireLabel).toBe("ETH -30 percent");
  expect(v.computedAt).toBe(DEMO_RUN_BOOK_SET.batch.computed_at);
  // The batch's own age, the wire's number, for the Computed chip; one the population guard refuses is no age.
  expect(v.ageSeconds).toBe(DEMO_RUN_BOOK_SET.batch.age_seconds);
  expect(compareRows({ ...DEMO_RUN_BOOK_SET, batch: { ...DEMO_RUN_BOOK_SET.batch, age_seconds: -1 } }, "debt_manager").ageSeconds).toBeNull();
  expect(compareRows({ ...DEMO_RUN_BOOK_SET, batch: { ...DEMO_RUN_BOOK_SET.batch, age_seconds: 1.5 } }, "debt_manager").ageSeconds).toBeNull();
});

test("the legacy fold's summary names the legacy leader by the headline's own ranking, in the legacy book's share — never a Cash figure", () => {
  expect(legacyCompareSummary(compareRows(demoSetFor(ALL), "aave_v3_etherfi"))).toBe("ETH −30% moves the most: +0.3% of the legacy book");
  const legacyDelta = (delta: string) => (r: SetRunScenarioResult): SetRunScenarioResult => ({
    ...r,
    engines: r.engines.map((e) => (e.engine === "aave_v3_etherfi" ? { ...e, eligible_debt_delta_usd: delta } : e)),
  });
  // "No scenario" only when every row was measured at zero; a row the set could not rank keeps the claim to the ranked rows.
  const bothPoints = ["eth_minus_30", "weeth_market_depeg_oracles_held"];
  expect(legacyCompareSummary(compareRows(edit(demoSetFor(bothPoints), "eth_minus_30", legacyDelta("0")), "aave_v3_etherfi"))).toBe("No scenario moves the legacy book");
  expect(legacyCompareSummary(compareRows(edit(demoSetFor(ALL), "eth_minus_30", legacyDelta("0")), "aave_v3_etherfi"))).toBe("No ranked scenario moves the legacy book");
  // A withheld legacy row is never summed up as "does not move": it is counted beside the zero, and beside a leader.
  const withheldLegacy = (r: SetRunScenarioResult): SetRunScenarioResult => ({
    ...r,
    withheld_engines: ["aave_v3_etherfi"],
    engines: r.engines.filter((e) => e.engine !== "aave_v3_etherfi"),
  });
  const withheldBesideZero = edit(edit(demoSetFor(bothPoints), "eth_minus_30", legacyDelta("0")), "weeth_market_depeg_oracles_held", withheldLegacy);
  expect(legacyCompareSummary(compareRows(withheldBesideZero, "aave_v3_etherfi"))).toBe("No ranked scenario moves the legacy book · 1 not evaluated");
  const withheldBesideLeader = edit(demoSetFor(ALL), "weeth_market_depeg_oracles_held", withheldLegacy);
  expect(legacyCompareSummary(compareRows(withheldBesideLeader, "aave_v3_etherfi"))).toBe("ETH −30% moves the most: +0.3% of the legacy book · 1 not evaluated");
  // A tie names every leader, as the headline does.
  const tie = edit(edit(demoSetFor(ALL), "eth_minus_30", legacyDelta("600000000000")), "weeth_market_depeg_oracles_held", legacyDelta("600000000000"));
  expect(legacyCompareSummary(compareRows(tie, "aave_v3_etherfi"))).toBe("ETH −30% and weETH depeg to 0.95, oracles held move the most: +0.3% of the legacy book");
  // Nothing ranked on the legacy book: said, never a zero.
  expect(legacyCompareSummary(compareRows(demoSetFor(["ethfi_minus_50", "dm_rate_horizon_plus_200bps"]), "aave_v3_etherfi"))).toBe("No scenario could be ranked for the legacy book");
});

test("compareHeadline: the leader named with its money phrase, every other scenario one clause of the dek, a projection never ranked on spot liquidatability", () => {
  const all = compareHeadline(compareRows(demoSetFor(ALL), "debt_manager"));
  expect(all).toEqual({
    emphasis: "ETH −30% moves the most:",
    rest: "$1.2M more Cash debt becomes liquidatable, 4.5% of the book.",
    tone: "crit",
    dek: "ETHFI −50%: +$9,800, under 0.1% of the book. weETH depeg to 0.95, oracles held: no change. Cash borrow APY +200 bps is a projection with no spot pass, so it is not ranked on spot liquidatability.",
  });
  expect(compareHeadline(compareRows(demoSetFor(TWO), "debt_manager")).dek).toBe("ETHFI −50%: +$9,800, under 0.1% of the book.");
});

test("compareHeadline: a tie names every leader; a set where nothing moves says so; a fall leads by its size in ink", () => {
  const tie = compareHeadline(compareRows(edit(demoSetFor(TWO), "ethfi_minus_50", cashDelta("1280000000000")), "debt_manager"));
  expect(tie.emphasis).toBe("ETH −30% and ETHFI −50% move the most:");
  expect(tie.rest).toBe("$1.2M more Cash debt becomes liquidatable under each, 4.5% of the book.");
  expect(tie.tone).toBe("crit");
  const still = compareHeadline(compareRows(edit(edit(demoSetFor(TWO), "eth_minus_30", cashDelta("0")), "ethfi_minus_50", cashDelta("0")), "debt_manager"));
  expect(still).toEqual({ emphasis: "No scenario in this set makes more Cash debt liquidatable.", rest: "", tone: "neutral", dek: "ETH −30% and ETHFI −50% leave it unchanged." });
  const falling = compareHeadline(compareRows(edit(demoSetFor(TWO), "eth_minus_30", cashDelta("-4500000000000")), "debt_manager"));
  expect(falling).toEqual({
    emphasis: "ETH −30% moves the most:",
    rest: "$4.5M less Cash debt is liquidatable, 16.1% of the book.",
    tone: "neutral",
    dek: "ETHFI −50%: +$9,800, under 0.1% of the book.",
  });
});

test("compareHeadline: a set where nothing ranked moves claims only the ranked scenarios once any member is left out of the ranking — a projection or a withheld member — and keeps each one's explanation in the dek", () => {
  const zeroed = (set: RunBookSetResponse): RunBookSetResponse =>
    ["eth_minus_30", "ethfi_minus_50", "weeth_market_depeg_oracles_held"].reduce((s, id) => edit(s, id, cashDelta("0")), set);
  // Every member ranked, every one at zero: the unqualified negative is true.
  const everyRanked = compareHeadline(compareRows(zeroed(demoSetFor(TWO)), "debt_manager"));
  expect(everyRanked.emphasis).toBe("No scenario in this set makes more Cash debt liquidatable.");
  // The rate horizon is a projection with no spot pass: it was never ranked, so the negative is not said of it.
  const withProjection = compareHeadline(compareRows(zeroed(demoSetFor(ALL)), "debt_manager"));
  expect(withProjection).toEqual({
    emphasis: "No ranked spot scenario in this set makes more Cash debt liquidatable.",
    rest: "",
    tone: "neutral",
    dek: "ETH −30%, weETH depeg to 0.95, oracles held and ETHFI −50% leave it unchanged. Cash borrow APY +200 bps is a projection with no spot pass, so it is not ranked on spot liquidatability.",
  });
  // A withheld member could move the book more than any ranked one: the same qualified claim, the refusal named.
  const withWithheld = compareHeadline(compareRows(edit(zeroed(demoSetFor(TWO)), "ethfi_minus_50", withheldCash), "debt_manager"));
  expect(withWithheld).toEqual({
    emphasis: "No ranked spot scenario in this set makes more Cash debt liquidatable.",
    rest: "",
    tone: "neutral",
    dek: "ETH −30% leaves it unchanged. ETHFI −50% could not be evaluated: withheld.",
  });
});

test("compareHeadline: a refused or withheld member is left out of the ranking and named in the dek; a set with nothing to rank says so", () => {
  const withheld = compareHeadline(compareRows(edit(demoSetFor(TWO), "ethfi_minus_50", withheldCash), "debt_manager"));
  expect(withheld.emphasis).toBe("ETH −30% moves the most:");
  expect(withheld.dek).toBe("ETHFI −50% could not be evaluated: withheld.");
  const none = compareHeadline(compareRows(edit(edit(demoSetFor(TWO), "eth_minus_30", withheldCash), "ethfi_minus_50", withheldCash), "debt_manager"));
  expect(none).toEqual({
    emphasis: "No scenario in this set could be ranked for the Cash book.",
    rest: "",
    tone: "refused",
    dek: "ETH −30% could not be evaluated: withheld. ETHFI −50% could not be evaluated: withheld.",
  });
  // A set of projections alone has no answer on spot liquidatability, and is no refusal either.
  const projectionOnly = compareHeadline(compareRows(demoSetFor(["dm_rate_horizon_plus_200bps"]), "debt_manager"));
  expect(projectionOnly.tone).toBe("absent");
  expect(projectionOnly.dek).toBe("Cash borrow APY +200 bps is a projection with no spot pass, so it is not ranked on spot liquidatability.");
  const empty = compareRows(demoSetFor(TWO), "debt_manager");
  expect(compareHeadline({ ...empty, rows: [] })).toEqual({ emphasis: "No scenario was compared.", rest: "", tone: "absent", dek: "" });
});
