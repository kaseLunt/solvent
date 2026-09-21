// The Scenarios page's one view model. Every book-workspace state, the banners,
// the chips, and the per-engine readings — derived once, read by the surface
// and by these pins alike.
import { expect, test } from "@playwright/test";
import { readsAsAnswer } from "../../lib/lab-engine";
import type { LabReading } from "../../lib/lab-reading";
import type { RunRecord, SetRecord } from "../../lib/lab-library";
import { deriveLabView, readEngine } from "../../lib/lab-view";
import { contradictoryHeadline, failureHeadline } from "../../lib/lab-headline";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf, type Engine } from "./helpers/run-book-engine";

function reading(overrides: Partial<LabReading>): LabReading {
  return { listing: { phase: "ready", value: SCENARIOS }, runs: new Map(), set: null, run: () => {}, runSet: () => {}, reloadListing: () => {}, ...overrides };
}
const settled = (id: string, outcome: Extract<RunRecord, { phase: "settled" }>["outcome"]): Map<string, RunRecord> => new Map([[id, { phase: "settled", outcome, at: 1, atMonotonicMs: 1, held: null }]]);
const ui = (selectedId: string | null = "eth_minus_30", checked: string[] = []) => ({ selectedId, checked: new Set(checked) });

/** The demo's Cash engine: the demo Book's own figures on the demo movement table, so every headline pinned here is the one the demo page prints. */
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

test("nothing can run until the listing answers: while it loads, and when it cannot be listed, no tick counts toward a Compare — the ids a link pre-ticked are not yet scenarios the listing names; once listed, they count", () => {
  const linked = ui(null, ["eth_minus_30", "ethfi_minus_50", "ghost"]);
  for (const listing of [{ phase: "loading" }, { phase: "error", message: "down" }] as const) {
    const v = deriveLabView(reading({ listing }), linked);
    expect(v.library).toEqual([]);
    expect(v.checked).toEqual([]);
    expect(v.book.definition).toBeNull();
  }
  // The listing in hand decides: the ticks it names count, in its own order; the one it does not name never does.
  expect(deriveLabView(reading({}), linked).checked).toEqual(["eth_minus_30", "ethfi_minus_50"]);
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
  const v = deriveLabView(reading({ runs: new Map([["eth_minus_30", { phase: "running", startedAt: 1, held: null }]]) }), ui());
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
  expect(cash.result.heat.merged).toBe(true);
  expect(cash.result.movers.total).toBe(118);
  const legacy = v.book.legacy;
  if (legacy?.kind !== "result") throw new Error("legacy must read");
  expect(legacy.result.engine).toBe("aave_v3_etherfi");
  expect(legacy.result.decimals).toBe(8);
  expect(legacy.result.heat.merged).toBe(false);
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
  const running: SetRecord = { phase: "running", ids: ["eth_minus_30", "ethfi_minus_50"], startedAt: 1, held: null };
  expect(deriveLabView(reading({ set: running }), ui()).compare).toEqual({ kind: "running", ids: ["eth_minus_30", "ethfi_minus_50"] });
  const busy: SetRecord = { phase: "settled", ids: ["a"], outcome: { kind: "busy", message: "another evaluation holds the slot", maxInFlight: 1, inFlight: 1 }, at: 2, held: null };
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
  // The net count is signed: accounts that flipped back to healthy can outnumber the newly liquidatable.
  const net = readEngine(runBookOf([demoCash({ newly_eligible_accounts: -3 })], DEFINITION_ETH), "debt_manager", DEFINITION_ETH);
  if (net.kind !== "result") throw new Error("a signed net must read");
  expect(net.result.newly).toBe(-3);
});

test("a failed re-run never replaces a computed result: the held figures stand under a banner naming the failure", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const held = { response: run, at: 1, atMonotonicMs: 1 };
  const failure = { kind: "unreachable", message: "the API did not answer" } as const;
  const runs = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: failure, at: 2, atMonotonicMs: 2, held }]]);
  const v = deriveLabView(reading({ runs }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBe("rerun-failed");
  expect(v.book.headline.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(v.book.rerunFailure).toEqual(failureHeadline("unreachable", { message: "the API did not answer" }));
  expect(v.book.receivedAt).toEqual({ wallMs: 1, monotonicMs: 1 });
  expect(v.book.run).toBe(run);
  // With nothing held, the failure is the state, as before.
  const first = deriveLabView(reading({ runs: settled("eth_minus_30", failure) }), ui());
  expect(first.book.state).toBe("unreachable");
  expect(first.book.banner).toBeNull();
  expect(first.book.rerunFailure).toBeNull();
});

test("a held result whose definition changed is disclosed, not shown: the failed request's own state, the retained batch named", () => {
  const otherVersion = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], { ...ETH_DEF, version: "v2" });
  const failure = { kind: "not-served" } as const;
  const runs = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: failure, at: 2, atMonotonicMs: 2, held: { response: otherVersion, at: 1, atMonotonicMs: 1 } }]]);
  const v = deriveLabView(reading({ runs }), ui());
  expect(v.book.state).toBe("not-served");
  expect(v.book.banner).toBe("retained-refused");
  expect(v.book.retained).toEqual({ batchId: otherVersion.batch.id, skew: ["version"] });
  expect(v.book.cash).toBeNull();
  expect(v.book.run).toBeNull();
  expect(v.book.headline).toEqual(failureHeadline("not-served", {}));
  expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "failed", text: "Not served", tone: "refused" });
});

test("a held result's own condition is said beside the failure that left it standing", () => {
  const drifted = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], { ...ETH_DEF, path_assumption: "a different path" });
  const runs = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "not-served" }, at: 2, atMonotonicMs: 2, held: { response: drifted, at: 1, atMonotonicMs: 1 } }]]);
  const v = deriveLabView(reading({ runs }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBe("rerun-failed");
  expect(v.book.heldCondition).toBe("stale-input");
  expect(v.book.skew).toEqual(["path assumption"]);
  expect(v.book.rerunFailure).toEqual(failureHeadline("not-served", {}));
});

/** The demo set answering an ask: its results for the asked ids, the echo the ask itself, the evaluated count agreeing. */
const demoSetFor = (ids: readonly string[]): typeof DEMO_RUN_BOOK_SET => {
  const results = DEMO_RUN_BOOK_SET.results.filter((r) => ids.includes(r.scenario_id));
  return { ...DEMO_RUN_BOOK_SET, requested_scenario_ids: [...ids], results, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, scenarios_evaluated: results.length } };
};

test("compare: a set is read only when it answers the request — the asked ids are the authority, and a body naming more is refused whole with every fault named", () => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answered: SetRecord = { phase: "settled", ids: asked, outcome: { kind: "ok", response: demoSetFor(asked) }, at: 2, held: null };
  const ok = deriveLabView(reading({ set: answered }), ui()).compare;
  expect(ok.kind).toBe("ok");
  if (ok.kind === "ok") expect(ok.cash.rows.map((r) => r.id)).toEqual(["eth_minus_30", "ethfi_minus_50"]);
  const unasked: SetRecord = { phase: "settled", ids: asked, outcome: { kind: "ok", response: DEMO_RUN_BOOK_SET }, at: 2, held: null };
  const failed = deriveLabView(reading({ set: unasked }), ui()).compare;
  expect(failed.kind).toBe("failed");
  if (failed.kind !== "failed") return;
  expect(failed.headline.emphasis).toBe("The set does not answer the request.");
  expect(failed.headline.tone).toBe("refused");
  expect(failed.headline.dek).toBe(
    "Faults: asked 2 ids, the response names 4; weeth_market_depeg_oracles_held is named in requested_scenario_ids and was not dispatched; dm_rate_horizon_plus_200bps is named in requested_scenario_ids and was not dispatched. Nothing from it is drawn.",
  );
});

test("a 2xx body that does not read never replaces a computed result: the held figures stand under a banner naming the contradiction; with nothing held, the contradictory state as before; an honest answer releases the hold", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const held = { response: run, at: 1, atMonotonicMs: 1 };
  const malformed = runBookOf([demoCash({ eligible_debt_delta_usd: "1e6" })], ETH_DEF);
  const over = (response: typeof run, h: typeof held | null) => new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response }, at: 2, atMonotonicMs: 2, held: h }]]);
  const v = deriveLabView(reading({ runs: over(malformed, held) }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBe("rerun-failed");
  expect(v.book.headline.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(v.book.rerunFailure).toEqual(contradictoryHeadline("ETH -30 percent", ["eligible_debt_delta_usd is outside the wire contract"]));
  expect(v.book.run).toBe(run);
  expect(v.book.receivedAt).toEqual({ wallMs: 1, monotonicMs: 1 });
  expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  // With nothing held, the same body is the contradictory state under no banner.
  const bare = deriveLabView(reading({ runs: over(malformed, null) }), ui());
  expect(bare.book.state).toBe("contradictory");
  expect(bare.book.banner).toBeNull();
  expect(bare.book.rerunFailure).toBeNull();
  // A self-contradicting matrix is the same class.
  const contradictory = runBookOf([demoCash({ hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })], ETH_DEF);
  const c = deriveLabView(reading({ runs: over(contradictory, held) }), ui());
  expect(c.book.state).toBe("result");
  expect(c.book.banner).toBe("rerun-failed");
  expect(c.book.rerunFailure?.emphasis).toBe("The result for ETH -30 percent contradicts itself.");
  // An honest answer releases the hold: a withheld book over a held result is the withheld state, no banner.
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], ETH_DEF, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven", note: "" }] });
  const w = deriveLabView(reading({ runs: over(withheld, held) }), ui());
  expect(w.book.state).toBe("withheld");
  expect(w.book.banner).toBeNull();
  // A retained body whose definition changed is disclosed, not shown, under a malformed answer as under any failure.
  const otherVersion = runBookOf([demoCash()], { ...ETH_DEF, version: "v2" });
  const r = deriveLabView(reading({ runs: over(malformed, { response: otherVersion, at: 1, atMonotonicMs: 1 }) }), ui());
  expect(r.book.state).toBe("contradictory");
  expect(r.book.banner).toBe("retained-refused");
  expect(r.book.retained).toEqual({ batchId: otherVersion.batch.id, skew: ["version"] });
  expect(r.book.cash).toBeNull();
});

test("compare: a failed Compare never replaces the comparison it had — the held set's views stand beside the failure; a set that does not answer its request is such a failure", () => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const held = { ids: asked, response: demoSetFor(asked), at: 2 };
  const busy: SetRecord = { phase: "settled", ids: asked, outcome: { kind: "busy", message: "another evaluation holds the slot", maxInFlight: 1, inFlight: 1 }, at: 3, held };
  const b = deriveLabView(reading({ set: busy }), ui()).compare;
  expect(b.kind).toBe("failed");
  if (b.kind !== "failed") return;
  expect(b.headline.emphasis).toBe("The evaluator is busy.");
  expect(b.held?.cash.rows.map((r) => r.id)).toEqual(["eth_minus_30", "ethfi_minus_50"]);
  expect(b.held?.cash.batchId).toBe(18251);
  expect(b.held?.legacy.engine).toBe("aave_v3_etherfi");
  const unasked: SetRecord = { phase: "settled", ids: asked, outcome: { kind: "ok", response: DEMO_RUN_BOOK_SET }, at: 3, held };
  const u = deriveLabView(reading({ set: unasked }), ui()).compare;
  expect(u.kind).toBe("failed");
  if (u.kind === "failed") expect(u.held?.cash.rows).toHaveLength(2);
  // With nothing held, a failure carries nothing.
  const f = deriveLabView(reading({ set: { ...busy, held: null } }), ui()).compare;
  expect(f.kind).toBe("failed");
  if (f.kind === "failed") expect(f.held).toBeNull();
});

test("readEngine never throws at render: a body missing an envelope list, or a null side or matrix, is unreadable by the field's name — the contradictory state, the route standing", () => {
  const run = runBookOf([demoCash()], DEFINITION_ETH);
  const missingLists = { ...run, engines: undefined, excluded_engines: null } as unknown as typeof run;
  expect(readEngine(missingLists, "debt_manager", DEFINITION_ETH)).toEqual({ kind: "unreadable", fields: ["engines", "excluded_engines"] });
  const nullSide = runBookOf([{ ...demoCash(), before: null } as unknown as Engine], DEFINITION_ETH);
  expect(readEngine(nullSide, "debt_manager", DEFINITION_ETH)).toEqual({ kind: "unreadable", fields: ["before"] });
  const nullMatrix = runBookOf([{ ...demoCash(), hf_transitions: null } as unknown as Engine], DEFINITION_ETH);
  expect(readEngine(nullMatrix, "debt_manager", DEFINITION_ETH)).toEqual({ kind: "unreadable", fields: ["hf_transitions"] });
  const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: nullSide }) }), ui());
  expect(v.book.state).toBe("contradictory");
  expect(v.book.headline.dek).toBe("before is outside the wire contract. Nothing from it is drawn.");
  // A missing refusal list through the view: named, and no chip prints an engine from a body whose envelope is outside the contract.
  const noExcluded = { ...run, excluded_engines: undefined } as unknown as typeof run;
  const e = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: noExcluded }) }), ui());
  expect(e.book.state).toBe("contradictory");
  expect(e.book.headline.dek).toBe("excluded_engines is outside the wire contract. Nothing from it is drawn.");
  expect(e.book.chips.map((c) => c.label)).toEqual(["Scenario", "Config"]);
});

test("the envelope is classified before any read: a 2xx run-book without its batch, its coverage or a list is the contradictory state naming the field — nothing of the body printed, no throw at render", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const over = (overrides: Record<string, unknown>) => settled("eth_minus_30", { kind: "ok", response: { ...run, ...overrides } as unknown as typeof run });
  const noBatch = deriveLabView(reading({ runs: over({ batch: undefined }) }), ui());
  expect(noBatch.book.state).toBe("contradictory");
  expect(noBatch.book.headline).toEqual(contradictoryHeadline("ETH -30 percent", ["batch is outside the wire contract"]));
  expect(noBatch.book.headline.dek).toBe("batch is outside the wire contract. Nothing from it is drawn.");
  // Nothing of the body is carried: no run for the drawer or the age to read, no identity, the definition's own chips.
  expect(noBatch.book.run).toBeNull();
  expect(noBatch.book.identity).toBeNull();
  expect(noBatch.book.chips.map((c) => c.label)).toEqual(["Scenario", "Config"]);
  // Both engines' readings refuse by the envelope's field, so the tiles say contradictory, never "not run".
  expect(noBatch.book.cash).toEqual({ kind: "unreadable", fields: ["batch"] });
  expect(noBatch.book.legacy).toEqual({ kind: "unreadable", fields: ["batch"] });
  expect(noBatch.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  // Every fault is named, in wire read order.
  const several = deriveLabView(reading({ runs: over({ batch: null, shocks: undefined, coverage: "all", notes: {} }) }), ui());
  expect(several.book.state).toBe("contradictory");
  expect(several.book.headline.dek).toBe("batch is outside the wire contract; shocks is outside the wire contract; coverage is outside the wire contract; notes is outside the wire contract. Nothing from it is drawn.");
  expect(several.library.find((r) => r.id === "eth_minus_30")?.outcome.text).toBe("Unreadable");
  // The envelope is judged before the definition is consulted: a body that cannot be read is never "not modelled".
  expect(readEngine({ ...run, batch: undefined } as unknown as typeof run, "debt_manager", { ...DEFINITION_ETH, engines: ["aave_v3_etherfi"] })).toEqual({ kind: "unreadable", fields: ["batch"] });
  // A held result stands in front of such a body, as in front of any answer that does not read.
  const held = { response: run, at: 1, atMonotonicMs: 1 };
  const runs = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response: { ...run, batch: undefined } as unknown as typeof run }, at: 2, atMonotonicMs: 2, held }]]);
  const v = deriveLabView(reading({ runs }), ui());
  expect(v.book.state).toBe("result");
  expect(v.book.banner).toBe("rerun-failed");
  expect(v.book.rerunFailure).toEqual(contradictoryHeadline("ETH -30 percent", ["batch is outside the wire contract"]));
});

test("compare: a set whose envelope is outside the contract is a failed Compare naming the field — without its evaluation, its batch or its coverage nothing is read, and a held comparison stands", () => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answering = demoSetFor(asked);
  const over = (overrides: Record<string, unknown>, held: SetRecord["held"] = null): SetRecord => ({ phase: "settled", ids: asked, outcome: { kind: "ok", response: { ...answering, ...overrides } as unknown as typeof answering }, at: 3, held });
  const noEvaluation = deriveLabView(reading({ set: over({ evaluation: undefined }) }), ui()).compare;
  expect(noEvaluation.kind).toBe("failed");
  if (noEvaluation.kind !== "failed") return;
  expect(noEvaluation.headline.emphasis).toBe("The set does not answer the request.");
  expect(noEvaluation.headline.dek).toBe("Faults: evaluation is outside the wire contract. Nothing from it is drawn.");
  expect(noEvaluation.held).toBeNull();
  const noBatch = deriveLabView(reading({ set: over({ batch: undefined, coverage: null }) }), ui()).compare;
  expect(noBatch.kind).toBe("failed");
  if (noBatch.kind === "failed") expect(noBatch.headline.dek).toBe("Faults: batch is outside the wire contract; coverage is outside the wire contract. Nothing from it is drawn.");
  const held = { ids: asked, response: answering, at: 2 };
  const standing = deriveLabView(reading({ set: over({ batch: undefined }, held) }), ui()).compare;
  expect(standing.kind).toBe("failed");
  if (standing.kind === "failed") expect(standing.held?.cash.batchId).toBe(18251);
});

test("a refusal without a string code is named and never read — no code reaches the phrasebook, the body does not read as an answer, and a held result stands; an empty code is still a refusal and reads", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  for (const refusal of [{ engine: "debt_manager" }, { engine: "debt_manager", code: null, detail: "", note: "" }, { engine: "debt_manager", code: 503, detail: null, note: "" }]) {
    const noCode = { ...run, excluded_engines: [refusal] } as unknown as typeof run;
    expect(readsAsAnswer(noCode)).toBe(false);
    expect(readEngine(noCode, "debt_manager", DEFINITION_ETH)).toEqual({ kind: "unreadable", fields: ["excluded_engines[0].code"] });
    const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: noCode }) }), ui());
    expect(v.book.state).toBe("contradictory");
    expect(v.book.headline.dek).toBe("excluded_engines[0].code is outside the wire contract. Nothing from it is drawn.");
    expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
    const over = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response: noCode }, at: 2, atMonotonicMs: 2, held: { response: run, at: 1, atMonotonicMs: 1 } }]]);
    const h = deriveLabView(reading({ runs: over }), ui());
    expect(h.book.state).toBe("result");
    expect(h.book.banner).toBe("rerun-failed");
    expect(h.book.run).toBe(run);
  }
  // The contract floors no length on the code: a refusal that names none is still a refusal, said in the phrasebook's own sentence.
  const emptyCode = runBookOf([legacyEngine({ 7: { 7: 1 } })], ETH_DEF, { excluded_engines: [{ engine: "debt_manager", code: "", detail: "", note: "" }] });
  expect(readsAsAnswer(emptyCode)).toBe(true);
  const w = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: emptyCode }) }), ui());
  expect(w.book.state).toBe("withheld");
  expect(w.book.headline.dek).toContain("Cash — the engine gave no reason.");
});

test("a 2xx body that is not a JSON object is a named answer on both paths, never a throw: the contradictory state for a run, a failed Compare for a set, and whatever was held stands", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  for (const body of [null, 7, "ok", [], [run]]) {
    const response = body as unknown as typeof run;
    const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response }) }), ui());
    expect(v.book.state).toBe("contradictory");
    expect(v.book.headline).toEqual(contradictoryHeadline("ETH -30 percent", ["The response body is not a JSON object"]));
    expect(v.book.headline.dek).toBe("The response body is not a JSON object. Nothing from it is drawn.");
    expect(v.book.run).toBeNull();
    expect(v.book.cash).toEqual({ kind: "unreadable", fields: ["the response body is not a JSON object"] });
    expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome.text).toBe("Unreadable");
    const over = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response }, at: 2, atMonotonicMs: 2, held: { response: run, at: 1, atMonotonicMs: 1 } }]]);
    const h = deriveLabView(reading({ runs: over }), ui());
    expect(h.book.state).toBe("result");
    expect(h.book.banner).toBe("rerun-failed");
    expect(h.book.rerunFailure?.dek).toBe("The response body is not a JSON object. Nothing from it is drawn.");
    // The set path: a failed Compare with the same name; a held comparison stands beside it.
    const setBody = body as unknown as typeof DEMO_RUN_BOOK_SET;
    const bare: SetRecord = { phase: "settled", ids: asked, outcome: { kind: "ok", response: setBody }, at: 3, held: null };
    const c = deriveLabView(reading({ set: bare }), ui()).compare;
    expect(c.kind).toBe("failed");
    if (c.kind === "failed") expect(c.headline.dek).toBe("Faults: The response body is not a JSON object. Nothing from it is drawn.");
    const standing = deriveLabView(reading({ set: { ...bare, held: { ids: asked, response: demoSetFor(asked), at: 2 } } }), ui()).compare;
    expect(standing.kind).toBe("failed");
    if (standing.kind === "failed") expect(standing.held?.cash.batchId).toBe(18251);
  }
});

test("one rule holds a result and releases it — does the body read: a malformed Cash row is a failed answer whatever else the body says, so under another version of the definition it is never 'definition changed', and beside a definition that does not model Cash never 'not modelled'; the result on the page stands from the moment the bad body settles, and no later failure brings back figures the page had withdrawn", () => {
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const held = { response: run, at: 1, atMonotonicMs: 1 };
  const over = (response: typeof run, h: typeof held | null = held) => new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response }, at: 2, atMonotonicMs: 2, held: h }]]);
  const word = (v: ReturnType<typeof deriveLabView>) => v.library.find((r) => r.id === "eth_minus_30")?.outcome;
  // Corner one — a body computed under another version of the definition, its Cash row malformed. The body is asked
  // whether it reads BEFORE its version is: it does not, so it is the contradiction, the fault named — and the result
  // already on the page stands under it, its figures never withdrawn.
  const skewedMalformed = runBookOf([demoCash({ eligible_debt_delta_usd: "1e6" })], { ...ETH_DEF, version: "v2" });
  const fault = contradictoryHeadline("ETH -30 percent", ["eligible_debt_delta_usd is outside the wire contract"]);
  expect(readsAsAnswer(skewedMalformed)).toBe(false);
  const one = deriveLabView(reading({ runs: over(skewedMalformed) }), ui());
  expect(one.book.state).toBe("result");
  expect(one.book.banner).toBe("rerun-failed");
  expect(one.book.rerunFailure).toEqual(fault);
  expect(one.book.run).toBe(run);
  expect(one.book.headline.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(word(one)).toEqual({ key: "result", text: "+$1.2M liquidatable · 118 accounts", tone: "crit" });
  // The consequence: the bad body never entered the hold, so the re-run that fails next stands the SAME figures the
  // page never stopped showing — nothing reappears, because nothing was withdrawn.
  const afterwards = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "not-served" }, at: 3, atMonotonicMs: 3, held }]]);
  const later = deriveLabView(reading({ runs: afterwards }), ui());
  expect(later.book.run).toBe(one.book.run);
  expect(later.book.headline).toEqual(one.book.headline);
  expect(later.book.banner).toBe("rerun-failed");
  // With nothing held the same body is the contradiction by the names of its fields — in the workspace, the tiles and the library's word.
  const bareOne = deriveLabView(reading({ runs: over(skewedMalformed, null) }), ui());
  expect(bareOne.book.state).toBe("contradictory");
  expect(bareOne.book.headline).toEqual(fault);
  expect(bareOne.book.cash).toEqual({ kind: "unreadable", fields: ["eligible_debt_delta_usd"] });
  expect(word(bareOne)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  // A body under another version that READS is still "definition changed", and releases the hold: an honest answer.
  const skewedClean = runBookOf([demoCash()], { ...ETH_DEF, version: "v2" });
  expect(readsAsAnswer(skewedClean)).toBe(true);
  const changed = deriveLabView(reading({ runs: over(skewedClean) }), ui());
  expect(changed.book.state).toBe("definition-changed");
  expect(changed.book.banner).toBeNull();
  expect(word(changed)).toEqual({ key: "definition-changed", text: "Definition changed", tone: "refused" });

  // Corner two — a definition that does not model Cash beside a body that carries a malformed Cash row anyway: the
  // row is judged before the definition's coverage is asked, so the body is the contradiction, never "not modelled".
  const legacyOnly = { ...ETH_DEF, engines: ["aave_v3_etherfi"] };
  const listing = { ...SCENARIOS, scenarios: SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? legacyOnly : s)) };
  const strayMalformed = runBookOf([legacyEngine({ 7: { 7: 1 } }), demoCash({ usd_decimals: 1.5 })], legacyOnly);
  const stray = contradictoryHeadline("ETH -30 percent", ["usd_decimals is outside the wire contract"]);
  expect(readsAsAnswer(strayMalformed)).toBe(false);
  const bareTwo = deriveLabView(reading({ listing: { phase: "ready", value: listing }, runs: over(strayMalformed, null) }), ui());
  expect(bareTwo.book.state).toBe("contradictory");
  expect(bareTwo.book.headline).toEqual(stray);
  expect(bareTwo.book.cash).toEqual({ kind: "unreadable", fields: ["usd_decimals"] });
  expect(word(bareTwo)).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
  // Over a held answer — here an honest "not modelled" — the hold stands, the contradiction named beside it.
  const legacyRun = runBookOf([legacyEngine({ 7: { 7: 1 } })], legacyOnly);
  const two = deriveLabView(reading({ listing: { phase: "ready", value: listing }, runs: over(strayMalformed, { response: legacyRun, at: 1, atMonotonicMs: 1 }) }), ui());
  expect(two.book.state).toBe("not-covered");
  expect(two.book.banner).toBe("rerun-failed");
  expect(two.book.rerunFailure).toEqual(stray);
  expect(two.book.run).toBe(legacyRun);
  // A clean stray Cash row beside that definition reads, and is "not modelled" as before.
  const strayClean = runBookOf([legacyEngine({ 7: { 7: 1 } }), demoCash()], legacyOnly);
  expect(readsAsAnswer(strayClean)).toBe(true);
  expect(deriveLabView(reading({ listing: { phase: "ready", value: listing }, runs: over(strayClean) }), ui()).book.state).toBe("not-covered");

  // The one rule, everywhere: over a held result, a body stands behind the hold exactly when it does not read.
  const malformed = runBookOf([demoCash({ eligible_debt_delta_usd: "1e6" })], ETH_DEF);
  const contradictory = runBookOf([demoCash({ hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })], ETH_DEF);
  const withheld = runBookOf([legacyEngine({ 7: { 7: 1 } })], ETH_DEF, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] });
  for (const body of [run, malformed, contradictory, withheld, skewedMalformed, skewedClean, strayMalformed, strayClean]) {
    for (const value of [SCENARIOS, listing]) {
      const v = deriveLabView(reading({ listing: { phase: "ready", value }, runs: over(body) }), ui());
      expect(v.book.banner === "rerun-failed").toBe(!readsAsAnswer(body));
    }
  }
});

test("a mover without an account or without its flip, a lane label or a note that is not text, is named and never drawn: the body does not read as an answer, no mover row reaches the table — an absent flip is never the word No, a string never Yes — the library says so, and a held result stands", () => {
  const mover = (account: unknown) => ({
    account,
    engine: "debt_manager",
    hf_before_wad: null,
    hf_after_wad: null,
    hf_drop_wad: null,
    hf_before_num: "5012500000",
    hf_before_den: "4822000000",
    hf_after_num: "3752500000",
    hf_after_den: "4822000000",
    became_eligible: true,
    debt_usd: "4822000000",
  });
  const good = mover("0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e");
  const cashWith = (overrides: Record<string, unknown>) => runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), { ...demoCash(), ...overrides } as unknown as Engine], ETH_DEF);
  // The served shape reads: its mover is drawn.
  const served = cashWith({ movers: [good] });
  expect(readsAsAnswer(served)).toBe(true);
  const ok = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: served }) }), ui());
  expect(ok.book.state).toBe("result");
  expect(ok.book.cash?.kind === "result" && ok.book.cash.result.movers.rows.map((m) => m.account)).toEqual([good.account]);
  const held = { response: served, at: 1, atMonotonicMs: 1 };
  const cases: [Record<string, unknown>, string][] = [
    [{ movers: [good, mover(null)] }, "movers[1].account"],
    [{ movers: [mover(undefined)] }, "movers[0].account"],
    [{ movers: [mover(7)] }, "movers[0].account"],
    [{ note: { text: "helper" } }, "note"],
    [{ note: null }, "note"],
    [{ hf_transitions: { ...demoCash().hf_transitions, note: ["helper"] } }, "hf_transitions.note"],
    [{ hf_transitions: { ...demoCash().hf_transitions, note: undefined } }, "hf_transitions.note"],
    // The flip the verdict word is read from: absent is not "No", a string is not "Yes".
    [{ movers: [Object.fromEntries(Object.entries(good).filter(([member]) => member !== "became_eligible"))] }, "movers[0].became_eligible"],
    [{ movers: [good, { ...good, became_eligible: "false" }] }, "movers[1].became_eligible"],
    // The lane's name is a header cell, the movers' note a tooltip: text, or named.
    [{ hf_transitions: { ...demoCash().hf_transitions, lanes: demoCash().hf_transitions.lanes.map((lane, i) => (i === 2 ? { ...lane, label: { text: "1.00 – 1.05" } } : lane)) } }, "hf_transitions.lanes[2].label"],
    [{ movers_note: { text: "the top 20 of 118" } }, "movers_note"],
    [{ movers_note: undefined }, "movers_note"],
  ];
  for (const [overrides, name] of cases) {
    const body = cashWith(overrides);
    expect(readsAsAnswer(body)).toBe(false);
    expect(readEngine(body, "debt_manager", DEFINITION_ETH)).toEqual({ kind: "unreadable", fields: [name] });
    const v = deriveLabView(reading({ runs: settled("eth_minus_30", { kind: "ok", response: body }) }), ui());
    expect(v.book.state).toBe("contradictory");
    expect(v.book.headline.dek).toBe(`${name} is outside the wire contract. Nothing from it is drawn.`);
    // No reading carries a movers table: the surface draws the table from a result alone.
    expect(v.book.cash?.kind).toBe("unreadable");
    expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "failed", text: "Unreadable", tone: "refused" });
    // Over a held result the hold stands, its own mover drawn, the failure named beside it.
    const over = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: { kind: "ok", response: body }, at: 2, atMonotonicMs: 2, held }]]);
    const h = deriveLabView(reading({ runs: over }), ui());
    expect(h.book.state).toBe("result");
    expect(h.book.banner).toBe("rerun-failed");
    expect(h.book.run).toBe(served);
    expect(h.book.rerunFailure?.dek).toBe(`${name} is outside the wire contract. Nothing from it is drawn.`);
  }
});

test("a run refused locally has its own state and the set path's sentence — nothing was sent, never 'could not be reached'; the library says so, and a held result stands", () => {
  const message = '"ETH-30" is not a committed-scenario id (expected ^[a-z0-9_]{1,64}$)';
  const refusedLocally = { kind: "refused-locally", message } as const;
  const v = deriveLabView(reading({ runs: settled("eth_minus_30", refusedLocally) }), ui());
  expect(v.book.state).toBe("refused-locally");
  expect(v.book.headline).toEqual(failureHeadline("refused-locally", { message }));
  expect(v.book.headline.emphasis).toBe("Nothing was sent.");
  expect(v.book.banner).toBeNull();
  expect(v.library.find((r) => r.id === "eth_minus_30")?.outcome).toEqual({ key: "failed", text: "Not sent", tone: "refused" });
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], ETH_DEF);
  const over = new Map<string, RunRecord>([["eth_minus_30", { phase: "settled", outcome: refusedLocally, at: 2, atMonotonicMs: 2, held: { response: run, at: 1, atMonotonicMs: 1 } }]]);
  const h = deriveLabView(reading({ runs: over }), ui());
  expect(h.book.state).toBe("result");
  expect(h.book.banner).toBe("rerun-failed");
  expect(h.book.rerunFailure?.emphasis).toBe("Nothing was sent.");
});
