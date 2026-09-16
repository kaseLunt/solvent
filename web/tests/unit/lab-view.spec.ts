// The Scenarios page's one view model. Every book-workspace state, the banners,
// the chips, and the per-engine readings — derived once, read by the surface
// and by these pins alike.
import { expect, test } from "@playwright/test";
import type { LabReading } from "../../lib/lab-reading";
import type { RunRecord, SetRecord } from "../../lib/lab-library";
import { deriveLabView, readEngine } from "../../lib/lab-view";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf, type Engine } from "./helpers/run-book-engine";

function reading(overrides: Partial<LabReading>): LabReading {
  return { listing: { phase: "ready", value: SCENARIOS }, runs: new Map(), set: null, run: () => {}, runSet: () => {}, reloadListing: () => {}, ...overrides };
}
const settled = (id: string, outcome: Extract<RunRecord, { phase: "settled" }>["outcome"]): Map<string, RunRecord> => new Map([[id, { phase: "settled", outcome, at: 1 }]]);
const ui = (selectedId: string | null = "eth_minus_30", checked: string[] = []) => ({ selectedId, checked: new Set(checked) });

/** The demo's Cash engine: the plan's R16 figures on the plan's movement table. */
function demoCash(overrides: Partial<Engine> = {}): Engine {
  const e = cashEngine(DEMO_CASH_TABLE);
  return {
    ...e,
    before: { ...e.before, accounts: 1406, eligible_accounts: 49, eligible_debt_usd: "6949455788", bad_debt_usd: "239603961", total_debt_usd: "27828808216758" },
    after: { ...e.after, accounts: 1406, eligible_accounts: 167, eligible_debt_usd: "1286949455788", bad_debt_usd: "41020000000", total_debt_usd: "27828808216758" },
    newly_eligible_accounts: 118,
    eligible_debt_delta_usd: "1280000000000",
    bad_debt_delta_usd: "40780396039",
    movers_total: 118,
    movers_note: "the top 20 of 118, ranked by the drop in the engine's own ratio",
    ...overrides,
  };
}
const ETH_DEF = SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!;

test("listing loading and unavailable; an empty listing; the library follows the listing", () => {
  const loading = deriveLabView(reading({ listing: { phase: "loading" } }), ui());
  expect(loading.book.state).toBe("listing-loading");
  expect(loading.library).toEqual([]);
  expect(loading.book.headline.emphasis).toBe("Loading the committed scenarios…");
  const failed = deriveLabView(reading({ listing: { phase: "error", message: "rate limited (429), retry after 30s" } }), ui());
  expect(failed.book.state).toBe("listing-unavailable");
  expect(failed.book.headline.dek).toBe("Rate limited (429), retry after 30s. Nothing can run until the listing answers.");
  const empty = deriveLabView(reading({ listing: { phase: "ready", value: { ...SCENARIOS, scenarios: [] } } }), ui());
  expect(empty.book.state).toBe("not-run");
  expect(empty.book.headline.emphasis).toBe("No committed scenarios are listed.");
  const v = deriveLabView(reading({}), ui(null, ["ethfi_minus_50"]));
  expect(v.library.map((r) => r.id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  expect(v.selectedId).toBe("eth_minus_30"); // null selection → the first listed
  expect(v.library[0]?.selected).toBe(true);
  expect(v.checked).toEqual(["ethfi_minus_50"]);
  expect(v.configVersion).toBe(SCENARIOS.scenario_config_version);
});

test("not run: the definition, the dashed tone, no chips beyond identity, no engines", () => {
  const v = deriveLabView(reading({}), ui());
  expect(v.book.state).toBe("not-run");
  expect(v.book.banner).toBeNull();
  expect(v.book.kicker).toBe("ETH -30 percent · Cash book");
  expect(v.book.headline.emphasis).toBe("ETH -30 percent");
  expect(v.book.headline.rest).toBe("— 1 committed shock, not run yet.");
  expect(v.book.headline.tone).toBe("refused");
  expect(v.book.definition?.id).toBe("eth_minus_30");
  expect(v.book.run).toBeNull();
  expect(v.book.cash).toBeNull();
  expect(v.book.chips.map((c) => c.label)).toEqual(["Scenario", "Config"]);
  expect(v.book.chips[0]?.value).toBe("eth_minus_30 · v1");
  expect(v.book.identity).toBeNull();
});

test("running", () => {
  const v = deriveLabView(reading({ runs: new Map([["eth_minus_30", { phase: "running", startedAt: 1 }]]) }), ui());
  expect(v.book.state).toBe("running");
  expect(v.book.headline.emphasis).toBe("Running ETH -30 percent…");
});

test("the demo result: state, headline, chips, identity, both engine readings, the movers, no banner", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: run }) }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBeNull();
  expect(v.book.headline.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(v.book.headline.rest).toBe("across 118 accounts.");
  expect(v.book.chips.map((c) => [c.label, c.value])).toEqual([
    ["Result for batch", "18,251"],
    ["Scenario", "eth_minus_30 · v1"],
    ["Engines", "Aave v3 market (legacy) and Cash"],
    ["Config", "v1"],
  ]);
  expect(v.book.identity).toEqual({ scope: "book", batchId: 18251, configVersion: "v1", engines: ["aave_v3_etherfi", "debt_manager"], servedAt: "2026-08-08T20:22:50Z" });
  const cash = v.book.cash;
  if (cash?.kind !== "result") throw new Error("cash must read");
  expect(cash.result.newly).toBe(118);
  expect(cash.result.beforeEligible).toBe(49);
  expect(cash.result.afterEligible).toBe(167);
  expect(cash.result.deltaEligibleDebt).toBe(1_280_000_000_000n);
  expect(cash.result.deltaBadDebt).toBe(40_780_396_039n);
  expect(cash.result.laneChanged).toBe(941);
  expect(cash.result.heat.kind).toBe("ok");
  expect(cash.result.movers.total).toBe(118);
  const legacy = v.book.legacy;
  if (legacy?.kind !== "result") throw new Error("legacy must read");
  expect(legacy.result.engine).toBe("aave_v3_etherfi");
  expect(legacy.result.decimals).toBe(8);
  if (legacy.result.heat.kind !== "ok") throw new Error("legacy heat");
  expect(legacy.result.heat.view.merged).toBe(false);
});

test("withheld, not covered, contradictory, unreadable — each its own state and headline; the legacy reading is independent", () => {
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], DEFINITION_ETH, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven", note: "" }] });
  const w = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: withheld }) }), ui());
  expect(w.book.state).toBe("withheld");
  expect(w.book.headline.emphasis).toBe("Cannot say — the Cash book is withheld under ETH -30 percent.");
  expect(w.book.cash?.kind).toBe("withheld");
  expect(w.book.legacy?.kind).toBe("result");
  expect(w.book.chips.find((c) => c.label === "Engines")?.value).toBe("Aave v3 market (legacy) · Cash withheld");

  const legacyDef = SCENARIOS.scenarios.find((s) => s.id === "ethfi_minus_50")!;
  const legacyOnlyListing = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((s) => (s.id === "ethfi_minus_50" ? { ...s, engines: ["aave_v3_etherfi"] } : s)) };
  const nc = deriveLabView(
    reading({ listing: { phase: "ready", value: legacyOnlyListing }, runs: settled("ethfi_minus_50", { kind: "ok", response: runBookOf([legacyEngine({ 7: { 7: 1 } })], { ...legacyDef, engines: ["aave_v3_etherfi"] }) }) }),
    ui("ethfi_minus_50"),
  );
  expect(nc.book.state).toBe("not-covered");
  expect(nc.book.headline.dek).toBe("It models the Aave v3 market (legacy). The legacy result is below.");

  const bad = runBookOf([demoCash({ hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })], DEFINITION_ETH);
  const c = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: bad }) }), ui());
  expect(c.book.state).toBe("contradictory");
  expect(c.book.headline.emphasis).toBe("The result for ETH -30 percent contradicts itself.");
  expect(c.book.cash?.kind).toBe("contradictory");

  const unreadable = runBookOf([demoCash({ usd_decimals: 1.5 })], DEFINITION_ETH);
  const u = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: unreadable }) }), ui());
  expect(u.book.state).toBe("contradictory");
  expect(u.book.cash?.kind).toBe("unreadable");
  expect(u.book.headline.dek).toContain("usd_decimals");
});

test("banners: a superseded batch and a stale input keep the result; a changed version is its own state", () => {
  const superseded = runBookOf([demoCash()], DEFINITION_ETH, { batch: { ...runBookOf([]).batch, supersession: { superseded: true, legs: [], note: "" } } });
  const s = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: superseded }) }), ui());
  expect(s.book.state).toBe("result");
  expect(s.book.banner).toBe("superseded");
  expect(s.book.chips[0]).toEqual({ label: "Result for batch", value: "18,251 · superseded", tone: "warn", title: "a newer complete batch exists; run again for it" });

  const drifted = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((sc) => (sc.id === "eth_minus_30" ? { ...sc, path_assumption: "changed" } : sc)) };
  const d = deriveLabView(reading({ listing: { phase: "ready", value: drifted }, runs: settled("eth_minus_30", { kind: "ok", response: runBookOf([demoCash()], DEFINITION_ETH) }) }), ui());
  expect(d.book.state).toBe("result");
  expect(d.book.banner).toBe("stale-input");
  expect(d.book.skew).toEqual(["path assumption"]);

  const rev = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((sc) => (sc.id === "eth_minus_30" ? { ...sc, version: "v2" } : sc)) };
  const r = deriveLabView(reading({ listing: { phase: "ready", value: rev }, runs: settled("eth_minus_30", { kind: "ok", response: runBookOf([demoCash()], DEFINITION_ETH) }) }), ui());
  expect(r.book.state).toBe("definition-changed");
  expect(r.book.headline.emphasis).toBe("ETH -30 percent changed since this result was computed.");
  expect(r.book.cash).toBeNull();
});

test("every fetch failure is its own state with the failure sentence", () => {
  const at = (outcome: Parameters<typeof settled>[1]) => deriveLabView(reading({ runs: settled("eth_minus_30", outcome) }), ui()).book;
  expect(at({ kind: "not-served" }).state).toBe("not-served");
  expect(at({ kind: "no-batch", message: "no complete risk batch is available", retryAfterSeconds: 30 }).headline.dek).toBe("No complete risk batch is available (503). Retry after 30s.");
  expect(at({ kind: "rate-limited", retryAfterSeconds: null }).state).toBe("rate-limited");
  expect(at({ kind: "unreachable", message: "fetch failed" }).state).toBe("unreachable");
  expect(at({ kind: "failed", status: 500, message: "internal" }).headline.emphasis).toBe("The service answered 500.");
});

test("compare: idle, running, ok (both engines' views), failed", () => {
  expect(deriveLabView(reading({}), ui()).compare).toEqual({ kind: "idle" });
  const running: SetRecord = { phase: "running", ids: ["eth_minus_30", "ethfi_minus_50"], startedAt: 1 };
  expect(deriveLabView(reading({ set: running }), ui()).compare).toEqual({ kind: "running", ids: ["eth_minus_30", "ethfi_minus_50"] });
  const busy: SetRecord = { phase: "settled", ids: ["a"], outcome: { kind: "busy", message: "another evaluation holds the slot", maxInFlight: 1, inFlight: 1 }, at: 2 };
  const b = deriveLabView(reading({ set: busy }), ui()).compare;
  expect(b.kind).toBe("failed");
  if (b.kind === "failed") expect(b.headline.emphasis).toBe("The evaluator is busy.");
});

test("readEngine reads by id, refuses by name, and never manufactures a figure", () => {
  const run = runBookOf([demoCash()], DEFINITION_ETH);
  expect(readEngine(run, "aave_v3_etherfi", DEFINITION_ETH).kind).toBe("withheld");
  expect(readEngine(run, "aave_v3_etherfi", { ...DEFINITION_ETH, engines: ["debt_manager"] }).kind).toBe("not-covered");
  const r = readEngine(run, "debt_manager", DEFINITION_ETH);
  if (r.kind !== "result") throw new Error("must read");
  expect(r.result.eligibleDebtBefore).toBe(6_949_455_788n);
  expect(r.result.badDebtAfter).toBe(41_020_000_000n);
  const bad = readEngine(runBookOf([demoCash({ bad_debt_delta_usd: "-0.5" })], DEFINITION_ETH), "debt_manager", DEFINITION_ETH);
  expect(bad.kind).toBe("unreadable");
  if (bad.kind === "unreadable") expect(bad.fields).toContain("bad_debt_delta_usd");
});
