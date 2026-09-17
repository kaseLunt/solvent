// The library's rows: the wire's own labels, one outcome word per run record,
// the definition-skew law, and the Cash engine/refusal readers.
import { expect, test } from "@playwright/test";
import { readEngine } from "../../lib/lab-engine";
import { cashEngineOf, cashRefusalOf, definitionSkew, libraryRows, outcomeLine, type RunRecord } from "../../lib/lab-library";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

const settled = (outcome: Extract<RunRecord, { phase: "settled" }>["outcome"]): RunRecord => ({ phase: "settled", outcome, at: 1, atMonotonicMs: 1, held: null });

test("rows come from the listing verbatim, in wire order, engines as human names, selection and checks carried", () => {
  const rows = libraryRows(SCENARIOS, new Map(), "ethfi_minus_50", new Set(["eth_minus_30"]));
  expect(rows.map((r) => r.id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  const eth = rows[0]!;
  expect(eth.label).toBe("ETH -30 percent");
  expect(eth.description).toBe(SCENARIOS.scenarios[0]!.description);
  expect(eth.engines).toBe("Aave v3 market (legacy) and Cash");
  expect(eth.coversCash).toBe(true);
  expect(eth.checked).toBe(true);
  expect(eth.selected).toBe(false);
  expect(eth.outcome).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(rows.find((r) => r.id === "ethfi_minus_50")?.selected).toBe(true);
  expect(libraryRows(null, new Map(), null, new Set())).toEqual([]);
});

test("outcome lines: running, a Cash result in the Book's tiers, no band change, band change only, withheld, not modelled, every failure word", () => {
  const def = DEFINITION_ETH;
  expect(outcomeLine(undefined, def, SCENARIOS.scenario_config_version)).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(outcomeLine({ phase: "running", startedAt: 0, held: null }, def, SCENARIOS.scenario_config_version)).toEqual({ key: "running", text: "Running…", tone: "dim" });
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  expect(outcomeLine(settled({ kind: "ok", response: demo }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  const still = runBookOf([cashEngine({ 2: { 2: 3 }, 7: { 7: 4 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: still }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "result", text: "No band change", tone: "ok" });
  const moved = runBookOf([cashEngine({ 5: { 4: 7 }, 7: { 7: 1 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: moved }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "result", text: "7 change band", tone: "warn" });
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], def, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] });
  expect(outcomeLine(settled({ kind: "ok", response: withheld }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "withheld", text: "Withheld", tone: "refused" });
  const legacyOnly = { ...def, engines: ["aave_v3_etherfi"] };
  expect(outcomeLine(settled({ kind: "ok", response: runBookOf([legacyEngine({ 7: { 7: 1 } })], legacyOnly) }), legacyOnly, SCENARIOS.scenario_config_version)).toEqual({ key: "not-covered", text: "Not modelled for Cash", tone: "dim" });
  const contradictory = runBookOf([cashEngine({ 2: { 2: 1 } }, { hf_transitions: { ...transitionsOf({ 2: { 2: 1 } }), total_rows: 9 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: contradictory }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Contradictory", tone: "refused" });
  const unreadable = runBookOf([cashEngine({ 2: { 2: 1 } }, { eligible_debt_delta_usd: "1e6", newly_eligible_accounts: 1 })]);
  expect(outcomeLine(settled({ kind: "ok", response: unreadable }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "not-served" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Not served", tone: "refused" });
  expect(outcomeLine(settled({ kind: "no-batch", message: "m", retryAfterSeconds: null }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "No batch", tone: "refused" });
  expect(outcomeLine(settled({ kind: "rate-limited", retryAfterSeconds: 3 }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Rate limited", tone: "refused" });
  expect(outcomeLine(settled({ kind: "unreachable", message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Unreachable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "failed", status: 502, message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Failed 502", tone: "refused" });
});

test("the row's word is the workspace's reading: a field only the classifier catches reads Unreadable in both", () => {
  const run = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000", movers_total: -1 })]);
  const reading = readEngine(run, "debt_manager", DEFINITION_ETH);
  expect(reading.kind).toBe("unreadable");
  if (reading.kind === "unreadable") expect(reading.fields).toEqual(["movers_total"]);
  expect(outcomeLine(settled({ kind: "ok", response: run }), DEFINITION_ETH, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
});

test("definitionSkew names every field the listing no longer agrees with; an unchanged definition names none", () => {
  const run = runBookOf([cashEngine({ 2: { 2: 1 } })]);
  expect(definitionSkew(DEFINITION_ETH, "v1", run)).toEqual([]);
  expect(definitionSkew({ ...DEFINITION_ETH, version: "v2" }, "v1", run)).toEqual(["version"]);
  expect(definitionSkew({ ...DEFINITION_ETH, label: "ETH -35 percent" }, "v1", run)).toEqual(["label"]);
  expect(definitionSkew({ ...DEFINITION_ETH, shocks: [{ axis: "eth_usd", factor_num: 65, factor_den: 100 }] }, "v1", run)).toEqual(["shocks"]);
  expect(definitionSkew({ ...DEFINITION_ETH, path_assumption: "other" }, "v1", run)).toEqual(["path assumption"]);
  expect(definitionSkew(DEFINITION_ETH, "v2", run)).toEqual(["config version"]);
  expect(definitionSkew({ ...DEFINITION_ETH, version: "v2", shocks: [] }, "v2", run)).toEqual(["version", "shocks", "config version"]);
});

test("cashEngineOf and cashRefusalOf read the run by engine id, never by position", () => {
  const legacy = legacyEngine({ 7: { 7: 1 } });
  const cash = cashEngine({ 7: { 7: 1 } });
  expect(cashEngineOf(runBookOf([legacy, cash]))?.engine).toBe("debt_manager");
  expect(cashEngineOf(runBookOf([legacy]))).toBeNull();
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "d", note: "n" };
  expect(cashRefusalOf(runBookOf([legacy], DEFINITION_ETH, { excluded_engines: [refusal] }))).toEqual(refusal);
  expect(cashRefusalOf(runBookOf([legacy, cash]))).toBeNull();
});

test("outcomeLine speaks for a held result through a failed re-run, but never for a retained body whose definition changed", () => {
  const def = DEFINITION_ETH;
  const cfg = SCENARIOS.scenario_config_version;
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  const held = { response: demo, at: 1, atMonotonicMs: 1 };
  const failedOver = (h: typeof held | null): RunRecord => ({ phase: "settled", outcome: { kind: "not-served" }, at: 2, atMonotonicMs: 2, held: h });
  expect(outcomeLine(failedOver(held), def, cfg)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  expect(outcomeLine(failedOver(null), def, cfg)).toEqual({ key: "failed", text: "Not served", tone: "refused" });
  const otherVersion = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })], { ...DEFINITION_ETH, version: "v2" });
  expect(outcomeLine(settled({ kind: "ok", response: otherVersion }), def, cfg)).toEqual({ key: "definition-changed", text: "Definition changed", tone: "refused" });
  expect(outcomeLine(failedOver({ ...held, response: otherVersion }), def, cfg)).toEqual({ key: "failed", text: "Not served", tone: "refused" });
});
