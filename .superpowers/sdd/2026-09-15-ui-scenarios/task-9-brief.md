### Task 9: `lab-view` — one view model for the surface and the tests (R2, R3, R13)

**Files:**
- Create: `web/lib/lab-view.ts`
- Test: `web/tests/unit/lab-view.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8 (`laneReading`, the headlines, `libraryRows`/`definitionSkew`/`cashEngineOf`/`cashRefusalOf`, `moversTable`, `classifyRunBookEngine`, `compareRows`, `LabReading`, `RunRecord`, `SetRecord`), `lib/cash-view.ts` (`ViewChip`), `lib/resultIdentity.ts` (`ResultIdentity`), `lib/refusal-phrasebook.ts` (`plainCause`), `lib/inspector-headline.ts` (`engineName`), `lib/inspector-position.ts` (`CASH`, `LEGACY`), `lib/inspector-view.ts` (`LoadPhase`), `lib/prose.ts`, `lib/wireGuard.ts`.
- Produces: `BookState`, `Banner`, `EngineResult`, `EngineReading`, `BookWorkspace`, `CompareState`, `LabUi { selectedId: string | null; checked: ReadonlySet<string> }`, `LabView`, `deriveLabView(reading: LabReading, ui: LabUi): LabView`, `readEngine(run, engine, definition): EngineReading`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-view.spec.ts
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
const settled = (id: string, outcome: RunRecord extends { outcome: infer O } ? O : never): Map<string, RunRecord> => new Map([[id, { phase: "settled", outcome, at: 1 }]]);
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
  const run = runBookOf([legacyEngine({ 5: { 4: 2 }, 7: { 7: 10 } }), demoCash()], DEFINITION_ETH);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-view.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-view'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-view.ts
// One view model for the Scenarios page. The surface reads it and prints it;
// the pins read it and check it; nothing below it decides a state twice. A
// result is read per engine, by engine id, under the classifier and the wire
// guards; a refusal of any kind is its own state with its own sentence.
import type { components } from "@solvent/client";
import type { ViewChip } from "./cash-view";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LoadPhase } from "./inspector-view";
import { classifyRunBookEngine } from "./lab-classify";
import { compareRows, type CompareView } from "./lab-compare";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  withheldHeadline,
  type LabHeadline,
} from "./lab-headline";
import { cashEngineOf, definitionSkew, libraryRows, type LibraryRow, type RunRecord, type ScenarioDefinition, type ScenariosResponse } from "./lab-library";
import { moversTable, type MoversTable } from "./lab-movers";
import type { LabReading } from "./lab-reading";
import { laneReading, type LaneReading } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import type { ResultIdentity } from "./resultIdentity";
import type { RunBookResponse } from "./runbook";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
type RunBookEngine = Schemas["RunBookEngine"];

export type BookState =
  | "listing-loading"
  | "listing-unavailable"
  | "not-run"
  | "running"
  | "result"
  | "not-covered"
  | "withheld"
  | "contradictory"
  | "definition-changed"
  | "not-served"
  | "no-batch"
  | "rate-limited"
  | "busy"
  | "unreachable"
  | "failed";
export type Banner = "stale-input" | "superseded" | null;

export interface EngineResult {
  readonly engine: string;
  readonly decimals: number;
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly eligibleDebtBefore: bigint;
  readonly eligibleDebtAfter: bigint;
  readonly deltaEligibleDebt: bigint;
  readonly badDebtBefore: bigint;
  readonly badDebtAfter: bigint;
  readonly deltaBadDebt: bigint;
  readonly measured: number;
  readonly laneChanged: number | null;
  readonly heat: LaneReading;
  readonly movers: MoversTable;
  readonly realization: RunBookEngine["market_realization"];
  readonly projection: RunBookEngine["projection"];
  readonly note: string;
  /** `hf_transitions.note`, verbatim — the wire's own words about its lanes, printed in the drawer. */
  readonly transitionsNote: string;
}
export type EngineReading =
  | { readonly kind: "result"; readonly result: EngineResult }
  | { readonly kind: "withheld"; readonly cause: string }
  | { readonly kind: "not-covered" }
  | { readonly kind: "contradictory"; readonly reasons: readonly string[] }
  | { readonly kind: "unreadable"; readonly fields: readonly string[] };

export interface BookWorkspace {
  readonly state: BookState;
  readonly banner: Banner;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: ViewChip[];
  readonly identity: ResultIdentity | null;
  readonly definition: ScenarioDefinition | null;
  readonly run: RunBookResponse | null;
  readonly cash: EngineReading | null;
  readonly legacy: EngineReading | null;
  readonly skew: readonly string[];
}
export type CompareState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly ids: readonly string[] }
  | { readonly kind: "ok"; readonly cash: CompareView; readonly legacy: CompareView }
  | { readonly kind: "failed"; readonly headline: LabHeadline };

export interface LabUi {
  readonly selectedId: string | null;
  readonly checked: ReadonlySet<string>;
}
export interface LabView {
  readonly listingLoad: LoadPhase;
  readonly library: LibraryRow[];
  readonly selectedId: string | null;
  readonly checked: readonly string[];
  readonly configVersion: string | null;
  readonly book: BookWorkspace;
  readonly compare: CompareState;
}

const emptyBook = (state: BookState, headline: LabHeadline, definition: ScenarioDefinition | null = null): BookWorkspace => ({
  state,
  banner: null,
  kicker: definition === null ? "Scenarios · Cash book" : `${definition.label} · Cash book`,
  headline,
  chips: definition === null ? [] : definitionChips(definition, null),
  identity: null,
  definition,
  run: null,
  cash: null,
  legacy: null,
  skew: [],
});

function definitionChips(def: ScenarioDefinition, configVersion: string | null): ViewChip[] {
  return [
    { label: "Scenario", value: `${def.id} · ${def.version}`, title: def.label },
    { label: "Config", value: configVersion ?? "unstated", tone: configVersion === null ? "refused" : undefined },
  ];
}

/** One engine's result, read by id under the classifier and the guards. */
export function readEngine(run: RunBookResponse, engine: string, definition: ScenarioDefinition): EngineReading {
  if (!definition.engines.includes(engine)) return { kind: "not-covered" };
  const refusal = run.excluded_engines.find((e) => e.engine === engine);
  if (refusal !== undefined) return { kind: "withheld", cause: `${engineName(engine)} — ${plainCause(refusal.code, refusal.detail)}` };
  const e = run.engines.find((x) => x.engine === engine);
  if (e === undefined) return { kind: "withheld", cause: `${engineName(engine)} — the result carries no row for this engine and no refusal` };
  const malformed = classifyRunBookEngine(e).malformedFields;
  const fields: string[] = [...malformed];
  if (!isWireScale(e.usd_decimals)) fields.push("usd_decimals");
  const pops: [string, number][] = [
    ["newly_eligible_accounts", e.newly_eligible_accounts],
    ["before.eligible_accounts", e.before.eligible_accounts],
    ["after.eligible_accounts", e.after.eligible_accounts],
    ["hf_transitions.measured_rows", e.hf_transitions.measured_rows],
  ];
  for (const [name, v] of pops) if (!isWirePopulation(v)) fields.push(name);
  const decs: [string, string][] = [
    ["before.eligible_debt_usd", e.before.eligible_debt_usd],
    ["after.eligible_debt_usd", e.after.eligible_debt_usd],
    ["eligible_debt_delta_usd", e.eligible_debt_delta_usd],
    ["before.bad_debt_usd", e.before.bad_debt_usd],
    ["after.bad_debt_usd", e.after.bad_debt_usd],
    ["bad_debt_delta_usd", e.bad_debt_delta_usd],
  ];
  for (const [name, v] of decs) if (!isWireDecimal(v)) fields.push(name);
  if (e.hf_transitions.lane_changed_rows !== null && !isWirePopulation(e.hf_transitions.lane_changed_rows)) fields.push("hf_transitions.lane_changed_rows");
  if (fields.length > 0) return { kind: "unreadable", fields: [...new Set(fields)] };
  const heat = laneReading(e, { merge: engine === CASH });
  if (heat.kind === "contradictory") return { kind: "contradictory", reasons: heat.reasons };
  return {
    kind: "result",
    result: {
      engine,
      decimals: e.usd_decimals,
      newly: e.newly_eligible_accounts,
      beforeEligible: e.before.eligible_accounts,
      afterEligible: e.after.eligible_accounts,
      eligibleDebtBefore: BigInt(e.before.eligible_debt_usd),
      eligibleDebtAfter: BigInt(e.after.eligible_debt_usd),
      deltaEligibleDebt: BigInt(e.eligible_debt_delta_usd),
      badDebtBefore: BigInt(e.before.bad_debt_usd),
      badDebtAfter: BigInt(e.after.bad_debt_usd),
      deltaBadDebt: BigInt(e.bad_debt_delta_usd),
      measured: e.hf_transitions.measured_rows,
      laneChanged: e.hf_transitions.lane_changed_rows,
      heat,
      movers: moversTable(e),
      realization: e.market_realization,
      projection: e.projection,
      note: e.note,
      transitionsNote: e.hf_transitions.note,
    },
  };
}

function enginesChip(run: RunBookResponse, cash: EngineReading): ViewChip {
  const served = run.engines.map((e) => engineName(e.engine));
  const withheld = run.excluded_engines.map((e) => `${engineName(e.engine)} withheld`);
  const parts = [...(served.length > 0 ? [joinAnd(served)] : []), ...withheld];
  return { label: "Engines", value: parts.join(" · "), tone: withheld.length > 0 || cash.kind === "withheld" ? "warn" : undefined };
}

function resultBook(def: ScenarioDefinition, configVersion: string, run: RunBookResponse): BookWorkspace {
  const skew = definitionSkew(def, configVersion, run);
  const superseded = run.batch.supersession.superseded;
  const kicker = `${def.label} · Cash book`;
  const identity: ResultIdentity = { scope: "book", batchId: run.batch.id, configVersion: run.scenario_config_version, engines: run.engines.map((e) => e.engine), servedAt: run.served_at };
  const cash = readEngine(run, CASH, def);
  const legacy = def.engines.includes(LEGACY) ? readEngine(run, LEGACY, def) : null;
  const chips: ViewChip[] = [
    superseded
      ? { label: "Result for batch", value: `${groupInt(run.batch.id)} · superseded`, tone: "warn", title: "a newer complete batch exists; run again for it" }
      : { label: "Result for batch", value: groupInt(run.batch.id) },
    { label: "Scenario", value: `${run.scenario_id} · ${run.scenario_version}`, title: run.label },
    enginesChip(run, cash),
    { label: "Config", value: run.scenario_config_version, tone: skew.includes("config version") ? "warn" : undefined },
  ];
  const base = { kicker, chips, identity, definition: def, run, cash, legacy, skew };
  if (skew.includes("version")) return { ...base, state: "definition-changed", banner: null, headline: definitionChangedHeadline(def.label, skew), cash: null, legacy: null };
  const banner: Banner = superseded ? "superseded" : skew.length > 0 ? "stale-input" : null;
  switch (cash.kind) {
    case "withheld":
      return { ...base, state: "withheld", banner, headline: withheldHeadline(def.label, cash.cause) };
    case "not-covered":
      return { ...base, state: "not-covered", banner, headline: notCoveredHeadline(def.label, def.engines, legacy !== null) };
    case "contradictory":
      return { ...base, state: "contradictory", banner, headline: contradictoryHeadline(def.label, cash.reasons) };
    case "unreadable":
      return { ...base, state: "contradictory", banner, headline: contradictoryHeadline(def.label, cash.fields.map((f) => `${f} is outside the wire contract`)) };
    case "result": {
      const r = cash.result;
      const headline = resultHeadline({
        label: def.label,
        decimals: r.decimals,
        newly: r.newly,
        beforeEligible: r.beforeEligible,
        afterEligible: r.afterEligible,
        deltaEligibleDebt: r.deltaEligibleDebt,
        deltaBadDebt: r.deltaBadDebt,
        heat: r.heat.kind === "ok" ? r.heat.view : null,
        heatReason: r.heat.kind === "ok" ? null : r.heat.reasons.join("; "),
      });
      return { ...base, state: "result", banner, headline };
    }
  }
}

function bookOf(listing: ScenariosResponse, def: ScenarioDefinition, record: RunRecord | undefined): BookWorkspace {
  if (record === undefined) {
    return { ...emptyBook("not-run", notRunHeadline({ label: def.label, description: def.description, path_assumption: def.path_assumption, shocks: def.shocks.length }), def), chips: definitionChips(def, listing.scenario_config_version) };
  }
  if (record.phase === "running") return { ...emptyBook("running", runningHeadline(def.label), def), chips: definitionChips(def, listing.scenario_config_version) };
  const o = record.outcome;
  if (o.kind === "ok") return resultBook(def, listing.scenario_config_version, o.response);
  const chips = definitionChips(def, listing.scenario_config_version);
  switch (o.kind) {
    case "not-served":
      return { ...emptyBook("not-served", failureHeadline("not-served", {}), def), chips };
    case "no-batch":
      return { ...emptyBook("no-batch", failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }), def), chips };
    case "rate-limited":
      return { ...emptyBook("rate-limited", failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }), def), chips };
    case "unreachable":
      return { ...emptyBook("unreachable", failureHeadline("unreachable", { message: o.message }), def), chips };
    case "failed":
      return { ...emptyBook("failed", failureHeadline("failed", { status: o.status, message: o.message }), def), chips };
  }
}

function compareOf(reading: LabReading): CompareState {
  const set = reading.set;
  if (set === null) return { kind: "idle" };
  if (set.phase === "running") return { kind: "running", ids: set.ids };
  const o = set.outcome;
  switch (o.kind) {
    case "ok":
      return { kind: "ok", cash: compareRows(o.response, CASH), legacy: compareRows(o.response, LEGACY) };
    case "busy":
      return { kind: "failed", headline: failureHeadline("busy", { message: o.message, inFlight: o.inFlight, maxInFlight: o.maxInFlight }) };
    case "not-served":
      return { kind: "failed", headline: failureHeadline("not-served", {}) };
    case "no-batch":
      return { kind: "failed", headline: failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }) };
    case "rate-limited":
      return { kind: "failed", headline: failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }) };
    case "refused":
      return { kind: "failed", headline: failureHeadline("failed", { status: o.status, message: `${o.code}: ${o.message}` }) };
    case "unreachable":
      return { kind: "failed", headline: failureHeadline("unreachable", { message: o.message }) };
    case "refused-locally":
      return { kind: "failed", headline: failureHeadline("refused-locally", { message: o.message }) };
  }
}

const loadPhase = (p: LabReading["listing"]): LoadPhase => (p.phase === "error" ? { phase: "error", message: p.message } : p.phase === "loading" ? { phase: "loading" } : { phase: "ready" });

export function deriveLabView(reading: LabReading, ui: LabUi): LabView {
  const listingLoad = loadPhase(reading.listing);
  const compare = compareOf(reading);
  if (reading.listing.phase === "loading") {
    return { listingLoad, library: [], selectedId: null, checked: [...ui.checked], configVersion: null, book: emptyBook("listing-loading", LISTING_LOADING), compare };
  }
  if (reading.listing.phase === "error") {
    return { listingLoad, library: [], selectedId: null, checked: [...ui.checked], configVersion: null, book: emptyBook("listing-unavailable", listingUnavailableHeadline(reading.listing.message)), compare };
  }
  const listing = reading.listing.value;
  const def = listing.scenarios.find((s) => s.id === ui.selectedId) ?? listing.scenarios[0] ?? null;
  const selectedId = def?.id ?? null;
  const library = libraryRows(listing, reading.runs, selectedId, ui.checked);
  const checked = listing.scenarios.map((s) => s.id).filter((id) => ui.checked.has(id));
  if (def === null) {
    return { listingLoad, library, selectedId, checked, configVersion: listing.scenario_config_version, book: emptyBook("not-run", EMPTY_LISTING), compare };
  }
  return { listingLoad, library, selectedId, checked, configVersion: listing.scenario_config_version, book: bookOf(listing, def, reading.runs.get(def.id)), compare };
}
```

If `SetRunOutcome` carries a kind this switch does not name, the compiler says so — add its arm with `failureHeadline("failed", …)` and the kind in the message; never a default arm. `classifyRunBookEngine` is a type-and-shape classifier (wire decimals, populations, scales): a matrix whose numbers disagree (the pin's `total_rows: 5`) passes it and is caught by `laneReading` — so the reading is `contradictory`, while a malformed field (the pin's `usd_decimals: 1.5`) is `unreadable`; both are the page's `contradictory` state.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-view.spec.ts && npm run typecheck`
Expected: 9 passed; typecheck clean. `ViewChip` is Plan 1's `{ label, value, tone?, title? }` — if it lacks `title`, add the chip title through `IdentityChip` instead (the page passes chips straight to `VerdictHeader`) and say so.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-view.ts web/tests/unit/lab-view.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-view - one view model for the Scenarios page: every state decided once, engines read by id under the classifier and the guards, banners on a result rather than replacements" -- web/lib/lab-view.ts web/tests/unit/lab-view.spec.ts
```

---
