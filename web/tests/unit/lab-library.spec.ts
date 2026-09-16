// The library's rows: the wire's own labels, one outcome word per run record,
// the definition-skew law, and the Cash engine/refusal readers.
import { expect, test } from "@playwright/test";
import { cashEngineOf, cashRefusalOf, definitionSkew, libraryRows, outcomeLine, type RunRecord } from "../../lib/lab-library";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

const settled = (outcome: Extract<RunRecord, { phase: "settled" }>["outcome"]): RunRecord => ({ phase: "settled", outcome, at: 1 });

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
  expect(outcomeLine(undefined, def)).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(outcomeLine({ phase: "running", startedAt: 0 }, def)).toEqual({ key: "running", text: "Running…", tone: "dim" });
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  expect(outcomeLine(settled({ kind: "ok", response: demo }), def)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  const still = runBookOf([cashEngine({ 2: { 2: 3 }, 7: { 7: 4 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: still }), def)).toEqual({ key: "result", text: "No band change", tone: "ok" });
  const moved = runBookOf([cashEngine({ 5: { 4: 7 }, 7: { 7: 1 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: moved }), def)).toEqual({ key: "result", text: "7 change band", tone: "warn" });
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], def, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] });
  expect(outcomeLine(settled({ kind: "ok", response: withheld }), def)).toEqual({ key: "withheld", text: "Withheld", tone: "refused" });
  const legacyOnly = { ...def, engines: ["aave_v3_etherfi"] };
  expect(outcomeLine(settled({ kind: "ok", response: runBookOf([legacyEngine({ 7: { 7: 1 } })], legacyOnly) }), legacyOnly)).toEqual({ key: "not-covered", text: "Not modelled for Cash", tone: "dim" });
  const contradictory = runBookOf([cashEngine({ 2: { 2: 1 } }, { hf_transitions: { ...transitionsOf({ 2: { 2: 1 } }), total_rows: 9 } })]);
  expect(outcomeLine(settled({ kind: "ok", response: contradictory }), def)).toEqual({ key: "failed", text: "Contradictory", tone: "refused" });
  const unreadable = runBookOf([cashEngine({ 2: { 2: 1 } }, { eligible_debt_delta_usd: "1e6", newly_eligible_accounts: 1 })]);
  expect(outcomeLine(settled({ kind: "ok", response: unreadable }), def)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "not-served" }), def)).toEqual({ key: "failed", text: "Not served", tone: "refused" });
  expect(outcomeLine(settled({ kind: "no-batch", message: "m", retryAfterSeconds: null }), def)).toEqual({ key: "failed", text: "No batch", tone: "refused" });
  expect(outcomeLine(settled({ kind: "rate-limited", retryAfterSeconds: 3 }), def)).toEqual({ key: "failed", text: "Rate limited", tone: "refused" });
  expect(outcomeLine(settled({ kind: "unreachable", message: "m" }), def)).toEqual({ key: "failed", text: "Unreachable", tone: "refused" });
  expect(outcomeLine(settled({ kind: "failed", status: 502, message: "m" }), def)).toEqual({ key: "failed", text: "Failed 502", tone: "refused" });
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
