// The library's rows: one name per scenario built from its definition, its one-line gist, one outcome word per run
// record, and the definition-skew law.
import { expect, test } from "@playwright/test";
import { readEngine } from "../../lib/lab-engine";
import { compareRows } from "../../lib/lab-compare";
import { compareOutcome, comparedLibrary, definitionSkew, libraryRows, outcomeLine, type RunRecord } from "../../lib/lab-library";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

const settled = (outcome: Extract<RunRecord, { phase: "settled" }>["outcome"]): RunRecord => ({ phase: "settled", outcome, at: 1, atMonotonicMs: 1, held: null });

test("rows come from the listing in wire order, named from their definitions, engines Cash first, selection and checks carried", () => {
  const rows = libraryRows(SCENARIOS, new Map(), "ethfi_minus_50", new Set(["eth_minus_30"]));
  expect(rows.map((r) => r.id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  const eth = rows[0]!;
  expect(eth.label).toBe("ETH −30%");
  // The wire's own label, id and version stay on the row as the name's title.
  expect(eth.title).toBe(`ETH -30 percent · eth_minus_30 · ${SCENARIOS.scenarios[0]!.version}`);
  expect(eth.description).toBe("All ETH-linked collateral, instantaneous mark.");
  expect(eth.engines).toBe("Cash and Aave v3 market (legacy)");
  expect(rows.find((r) => r.id === "dm_rate_horizon_plus_200bps")?.label).toBe("Cash borrow APY +200 bps");
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
  // A read that did not complete is never the refused register — the header's and the tiles' own rule: solid, ink-2.
  expect(outcomeLine(settled({ kind: "not-served" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Not served", tone: "dim" });
  expect(outcomeLine(settled({ kind: "no-batch", message: "m", retryAfterSeconds: null }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "No batch", tone: "dim" });
  expect(outcomeLine(settled({ kind: "rate-limited", retryAfterSeconds: 3 }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Rate limited", tone: "dim" });
  expect(outcomeLine(settled({ kind: "unreachable", message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Unreachable", tone: "dim" });
  expect(outcomeLine(settled({ kind: "failed", status: 502, message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Failed 502", tone: "dim" });
  // A request the service declined, or the page would not send, is a refusal.
  expect(outcomeLine(settled({ kind: "failed", status: 400, message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Failed 400", tone: "refused" });
  expect(outcomeLine(settled({ kind: "refused-locally", message: "m" }), def, SCENARIOS.scenario_config_version)).toEqual({ key: "failed", text: "Not sent", tone: "refused" });
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

test("outcomeLine speaks for a held result through a failed re-run, but never for a retained body whose definition changed", () => {
  const def = DEFINITION_ETH;
  const cfg = SCENARIOS.scenario_config_version;
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  const held = { response: demo, at: 1, atMonotonicMs: 1 };
  const failedOver = (h: typeof held | null): RunRecord => ({ phase: "settled", outcome: { kind: "not-served" }, at: 2, atMonotonicMs: 2, held: h });
  expect(outcomeLine(failedOver(held), def, cfg)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  expect(outcomeLine(failedOver(null), def, cfg)).toEqual({ key: "failed", text: "Not served", tone: "dim" });
  const otherVersion = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })], { ...DEFINITION_ETH, version: "v2" });
  expect(outcomeLine(settled({ kind: "ok", response: otherVersion }), def, cfg)).toEqual({ key: "definition-changed", text: "Definition changed", tone: "refused" });
  expect(outcomeLine(failedOver({ ...held, response: otherVersion }), def, cfg)).toEqual({ key: "failed", text: "Not served", tone: "dim" });
});

test("the row's word for a net at or below zero: the net beside the crossings the lanes show, with the true minus; a net without crossings alone", () => {
  const def = DEFINITION_ETH;
  const cfg = SCENARIOS.scenario_config_version;
  const net = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: -3, eligible_debt_delta_usd: "1280000000000" })]);
  expect(outcomeLine(settled({ kind: "ok", response: net }), def, cfg)).toEqual({ key: "result", text: "Net −3 accounts · 118 cross the cap", tone: "warn" });
  const zero = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 0 })]);
  expect(outcomeLine(settled({ kind: "ok", response: zero }), def, cfg)).toEqual({ key: "result", text: "Net 0 accounts · 118 cross the cap", tone: "warn" });
  const one = runBookOf([cashEngine({ 3: { 0: 1 } }, { newly_eligible_accounts: -1 })]);
  expect(outcomeLine(settled({ kind: "ok", response: one }), def, cfg)).toEqual({ key: "result", text: "Net −1 account · 1 crosses the cap", tone: "warn" });
  const fewer = runBookOf([cashEngine({ 0: { 3: 3 }, 7: { 7: 2 } }, { newly_eligible_accounts: -3 })]);
  expect(outcomeLine(settled({ kind: "ok", response: fewer }), def, cfg)).toEqual({ key: "result", text: "Net −3 accounts", tone: "ok" });
});

test("outcomeLine: a 200 whose Cash reading does not read never replaces the held result's word; an honest answer releases it", () => {
  const def = DEFINITION_ETH;
  const cfg = SCENARIOS.scenario_config_version;
  const demo = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })]);
  const held = { response: demo, at: 1, atMonotonicMs: 1 };
  const malformed = runBookOf([cashEngine(DEMO_CASH_TABLE, { eligible_debt_delta_usd: "1e6" })]);
  const over = (h: typeof held | null): RunRecord => ({ phase: "settled", outcome: { kind: "ok", response: malformed }, at: 2, atMonotonicMs: 2, held: h });
  expect(outcomeLine(over(held), def, cfg)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  expect(outcomeLine(over(null), def, cfg)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  const contradictory = runBookOf([cashEngine({ 2: { 2: 1 } }, { hf_transitions: { ...transitionsOf({ 2: { 2: 1 } }), total_rows: 9 } })]);
  expect(outcomeLine({ phase: "settled", outcome: { kind: "ok", response: contradictory }, at: 2, atMonotonicMs: 2, held }, def, cfg)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  // A withheld book is the wire's honest answer: it stands, and the hold does not speak.
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], def, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] });
  expect(outcomeLine({ phase: "settled", outcome: { kind: "ok", response: withheld }, at: 2, atMonotonicMs: 2, held }, def, cfg)).toEqual({ key: "withheld", text: "Withheld", tone: "refused" });
  // A retained body whose definition changed does not speak for a malformed answer either.
  const otherVersion = runBookOf([cashEngine(DEMO_CASH_TABLE, { newly_eligible_accounts: 118, eligible_debt_delta_usd: "1280000000000" })], { ...DEFINITION_ETH, version: "v2" });
  expect(outcomeLine(over({ ...held, response: otherVersion }), def, cfg)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
});

test("a compared scenario's row speaks from the set run the headline reads — never 'Not run yet' under a scenario the headline ranked", () => {
  const view = compareRows(DEMO_RUN_BOOK_SET, "debt_manager");
  const word = (id: string) => compareOutcome(view.rows.find((r) => r.id === id)!);
  expect(word("eth_minus_30")).toEqual({ key: "compared", text: "+$1.2M liquidatable · 4.5% of the book", tone: "crit" });
  expect(word("ethfi_minus_50")).toEqual({ key: "compared", text: "+$9,800 liquidatable · <0.1% of the book", tone: "crit" });
  expect(word("weeth_market_depeg_oracles_held")).toEqual({ key: "compared", text: "No new liquidatable debt", tone: "dim" });
  // Not ranked, in the compare card's own words: a projection is a kind, not a refusal.
  expect(word("dm_rate_horizon_plus_200bps")).toEqual({ key: "compared", text: "Projection, no spot pass", tone: "dim" });
  // Less liquidatable debt: the same form, the dot's own tone.
  const falling = compareRows(
    { ...DEMO_RUN_BOOK_SET, results: DEMO_RUN_BOOK_SET.results.map((r) => (r.scenario_id !== "eth_minus_30" ? r : { ...r, engines: r.engines.map((e) => (e.engine === "debt_manager" ? { ...e, eligible_debt_delta_usd: "-4500000000000" } : e)) })) },
    "debt_manager",
  );
  expect(compareOutcome(falling.rows.find((r) => r.id === "eth_minus_30")!)).toEqual({ key: "compared", text: "−$4.5M liquidatable · 16.1% of the book", tone: "ok" });
  // A refused member keeps the compare card's word, in the refused register.
  const withheld = compareRows(
    { ...DEMO_RUN_BOOK_SET, results: DEMO_RUN_BOOK_SET.results.map((r) => (r.scenario_id !== "ethfi_minus_50" ? r : { ...r, withheld_engines: ["debt_manager"], engines: [] })) },
    "debt_manager",
  );
  expect(compareOutcome(withheld.rows.find((r) => r.id === "ethfi_minus_50")!)).toEqual({ key: "compared", text: "Withheld", tone: "refused" });
  // The rail: members take the comparison's word, every other row keeps its own; no comparison leaves the rail as it was.
  const rows = libraryRows(SCENARIOS, new Map(), "eth_minus_30", new Set(["eth_minus_30", "ethfi_minus_50"]));
  const twoOnly = compareRows(
    { ...DEMO_RUN_BOOK_SET, requested_scenario_ids: ["eth_minus_30", "ethfi_minus_50"], results: DEMO_RUN_BOOK_SET.results.filter((r) => r.scenario_id === "eth_minus_30" || r.scenario_id === "ethfi_minus_50") },
    "debt_manager",
  );
  const rail = comparedLibrary(rows, twoOnly);
  expect(rail.find((r) => r.id === "eth_minus_30")?.outcome.text).toBe("+$1.2M liquidatable · 4.5% of the book");
  expect(rail.find((r) => r.id === "ethfi_minus_50")?.outcome.key).toBe("compared");
  for (const r of rail.filter((x) => x.id !== "eth_minus_30" && x.id !== "ethfi_minus_50")) expect(r.outcome).toEqual({ key: "not-run", text: "Not run yet", tone: "dim" });
  expect(rail.filter((r) => r.outcome.text === "Not run yet").map((r) => r.id)).not.toContain("eth_minus_30");
  expect(comparedLibrary(rows, null)).toBe(rows);
});
