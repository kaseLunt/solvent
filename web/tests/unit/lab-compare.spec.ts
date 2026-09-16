// Compare: each scenario's contribution as a signed share of the engine's own
// book, the wire's sanctioned denominator; every non-answer is its own kind
// and never a dot at zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { compareRows, shareTenths, type RunBookSetResponse, type SetRunEngineSummary, type SetRunScenarioResult } from "../../lib/lab-compare";

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
    result("held", "Withheld one", { covered_engines: [], withheld_engines: ["debt_manager"] }),
    result("legacy_only", "Legacy only", { covered_engines: ["aave_v3_etherfi"], engines: [summary({ engine: "aave_v3_etherfi", usd_decimals: 8 })] }),
    result("absent", "Unmeasurable one", { covered_engines: [], unmeasurable_engines: [{ engine: "debt_manager", reason: "no_positions_in_batch", counts: { positions_in_batch: 0, refused_in_batch: 0, unrebuildable: 0 }, note: "n" }] }),
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

test("a malformed summary is contradictory, named by the classifier, and never a point", () => {
  const set = setOf([result("x", "X", { engines: [summary({ accounts: -1 })] })]);
  const v = compareRows(set, "debt_manager");
  expect(v.rows[0]?.kind).toBe("contradictory");
  expect(v.rows[0]?.reason).toContain("accounts");
  expect(v.rows[0]?.shareTenths).toBeNull();
});
