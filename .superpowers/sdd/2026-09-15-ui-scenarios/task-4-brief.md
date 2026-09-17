### Task 4: `lab-library` (rows, inline outcomes, definition skew, the run records) and `lab-deep-link` (moved)

**Files:**
- Create: `web/lib/lab-library.ts`, `web/lib/lab-deep-link.ts`
- Modify: `web/tests/unit/helpers/run-book-engine.ts` (append `runBookOf`)
- Test: `web/tests/unit/lab-library.spec.ts`, `web/tests/unit/lab-deep-link.spec.ts`

**Interfaces:**
- Consumes: `lib/runbook.ts` (`RunBookOutcome`, `RunBookResponse`), `lib/runbookSet.ts` (`SetRunOutcome`), `lib/lab-transitions.ts` (`laneReading`), `lib/lab-headline.ts` (`signedUsd`), `lib/inspector-headline.ts` (`engineName`), `lib/inspector-position.ts` (`CASH`), `lib/prose.ts`, `lib/wireGuard.ts`.
- Produces: `RunRecord`, `SetRecord`, `LibraryOutcome { key: LibraryOutcomeKey; text; tone }`, `LibraryRow`, `libraryRows(listing, records, selectedId, checked): LibraryRow[]`, `outcomeLine(record, definition): LibraryOutcome`, `definitionSkew(definition, configVersion, run): string[]`, `cashEngineOf(run): RunBookEngine | null`, `cashRefusalOf(run): EngineRefusal | null`; `deepLinkDecision`, `DeepLinkDecision` (moved).

- [ ] **Step 1: The move — `deepLinkDecision` verbatim**

Create `web/lib/lab-deep-link.ts` with, copied byte-for-byte from `web/app/lab/tornadoLines.ts`: the `DeepLinkDecision` type (lines 34–70), `listWords` (72–75), and `deepLinkDecision` (87–169), plus the imports those three need (`MAX_SET_RUN_SCENARIOS`, `SCENARIO_ID_PATTERN` from `./runbookSet`). Prepend this header:

```ts
// web/lib/lab-deep-link.ts
// The deep-link law for /lab: `?scenario=` runs one, `?scenarios=` runs the
// committed set, both together run nothing. Moved verbatim from the old Lab's
// tornadoLines.ts; the unit pins moved with it.
```

Create `web/tests/unit/lab-deep-link.spec.ts` with the `test.describe("the deep-link decision", …)` block copied verbatim from `web/tests/unit/tornado-lines.spec.ts` (line 60 to the block's closing `});`), its `LISTED` constant and whatever imports that block uses, the import path changed to `../../lib/lab-deep-link`. Do not delete anything from the old files in this task (Task 12 deletes them); the old and new copies coexist until then.

Run: `cd web && npx playwright test --project=unit tests/unit/lab-deep-link.spec.ts`
Expected: the moved block passes with the same count it had in `tornado-lines.spec.ts`. In the report, paste `diff <(sed -n '87,169p' app/lab/tornadoLines.ts) <(sed -n '<start>,<end>p' lib/lab-deep-link.ts)` output (empty).

- [ ] **Step 2: Append `runBookOf` to the helper**

```ts
// append to web/tests/unit/helpers/run-book-engine.ts
export type RunBook = Schemas["RunBookResponse"];
export type Definition = Schemas["ScenarioDefinition"];

export const DEFINITION_ETH: Definition = {
  id: "eth_minus_30",
  version: "v1",
  label: "ETH -30 percent",
  description: "All ETH-linked collateral marked down 30 percent.",
  path_assumption: "instantaneous mark at the shocked level; single-step",
  engines: ["aave_v3_etherfi", "debt_manager"],
  shocks: [{ axis: "eth_usd", factor_num: 70, factor_den: 100 }],
  out_of_model: ["liquidation bonuses", "gas"],
};

const BATCH: Schemas["Batch"] = {
  id: 18251,
  computed_at: "2026-08-08T20:22:08Z",
  age_seconds: 42,
  producer: "riskd",
  status: "complete",
  position_count: 9964,
  refused_count: 6,
  refused_engines: [],
  flagged_count: 30,
  watermarks: [],
  supersession: { superseded: false, legs: [], note: "" },
};

/** A wire-true run-book around the given engines. `batch` overrides let a pin state supersession. */
export function runBookOf(engines: readonly Engine[], def: Definition = DEFINITION_ETH, overrides: Partial<RunBook> = {}): RunBook {
  return {
    served_at: "2026-08-08T20:22:50Z",
    batch: BATCH,
    scenario_config_version: "v1",
    scenario_id: def.id,
    scenario_version: def.version,
    label: def.label,
    description: def.description,
    path_assumption: def.path_assumption,
    shocks: def.shocks,
    out_of_model: def.out_of_model,
    applied_shocks: [],
    held_flat: [],
    engines: [...engines],
    excluded_engines: [],
    coverage: [],
    notes: [],
    ...overrides,
  };
}
```

If `Schemas["Batch"]` requires fields this literal lacks, add them from `web/tests/fixtures/run-book.eth_minus_30.json`'s `batch` (copy the values; do not invent).

- [ ] **Step 3: The pins (failing)**

```ts
// web/tests/unit/lab-library.spec.ts
// The library's rows: the wire's own labels, one outcome word per run record,
// the definition-skew law, and the Cash engine/refusal readers.
import { expect, test } from "@playwright/test";
import { cashEngineOf, cashRefusalOf, definitionSkew, libraryRows, outcomeLine, type RunRecord } from "../../lib/lab-library";
import { SCENARIOS } from "../fixtures/lab-book";
import { cashEngine, DEFINITION_ETH, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

const settled = (outcome: RunRecord extends { outcome: infer O } ? O : never): RunRecord => ({ phase: "settled", outcome, at: 1 });

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
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-library'`.

- [ ] **Step 5: The module**

```ts
// web/lib/lab-library.ts
// The scenario library's model: one row per committed scenario as the wire
// lists it, its last outcome in one word, and the definition-skew law that
// makes a result "for a previous input" once the listing changes under it.
import type { components } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { signedUsd } from "./lab-headline";
import { laneReading } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";
import type { RunBookOutcome, RunBookResponse } from "./runbook";
import type { SetRunOutcome } from "./runbookSet";
import { isWireDecimal, isWirePopulation } from "./wireGuard";

type Schemas = components["schemas"];
export type ScenariosResponse = Schemas["ScenariosResponse"];
export type ScenarioDefinition = Schemas["ScenarioDefinition"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type EngineRefusal = Schemas["EngineRefusal"];

export type RunRecord =
  | { readonly phase: "running"; readonly startedAt: number }
  | { readonly phase: "settled"; readonly outcome: RunBookOutcome; readonly at: number };

export type SetRecord =
  | { readonly phase: "running"; readonly ids: readonly string[]; readonly startedAt: number }
  | { readonly phase: "settled"; readonly ids: readonly string[]; readonly outcome: SetRunOutcome; readonly at: number };

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";
export interface LibraryOutcome {
  readonly key: LibraryOutcomeKey;
  readonly text: string;
  readonly tone: LibraryOutcomeTone;
}

export interface LibraryRow {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly engines: string;
  readonly coversCash: boolean;
  readonly outcome: LibraryOutcome;
  readonly checked: boolean;
  readonly selected: boolean;
}

export const cashEngineOf = (run: RunBookResponse): RunBookEngine | null => run.engines.find((e) => e.engine === CASH) ?? null;
export const cashRefusalOf = (run: RunBookResponse): EngineRefusal | null => run.excluded_engines.find((e) => e.engine === CASH) ?? null;

const FAILURE_WORD: Record<Exclude<RunBookOutcome["kind"], "ok" | "failed">, string> = {
  "not-served": "Not served",
  "no-batch": "No batch",
  "rate-limited": "Rate limited",
  unreachable: "Unreachable",
};

const failed = (text: string): LibraryOutcome => ({ key: "failed", text, tone: "refused" });

export function outcomeLine(record: RunRecord | undefined, definition: ScenarioDefinition): LibraryOutcome {
  if (record === undefined) return { key: "not-run", text: "Not run yet", tone: "dim" };
  if (record.phase === "running") return { key: "running", text: "Running…", tone: "dim" };
  const o = record.outcome;
  if (o.kind === "failed") return failed(`Failed ${String(o.status)}`);
  if (o.kind !== "ok") return failed(FAILURE_WORD[o.kind]);
  if (!definition.engines.includes(CASH)) return { key: "not-covered", text: "Not modelled for Cash", tone: "dim" };
  if (cashRefusalOf(o.response) !== null) return { key: "withheld", text: "Withheld", tone: "refused" };
  const cash = cashEngineOf(o.response);
  if (cash === null) return { key: "withheld", text: "Withheld", tone: "refused" };
  if (!isWirePopulation(cash.newly_eligible_accounts) || !isWireDecimal(cash.eligible_debt_delta_usd)) return failed("Unreadable");
  const heat = laneReading(cash, { merge: true });
  if (heat.kind === "contradictory") return failed("Contradictory");
  const newly = cash.newly_eligible_accounts;
  if (newly > 0) {
    return { key: "result", text: `${signedUsd(BigInt(cash.eligible_debt_delta_usd), cash.usd_decimals)} liquidatable · ${groupInt(newly)} account${newly === 1 ? "" : "s"}`, tone: "crit" };
  }
  if (heat.view.bandChanged === 0) return { key: "result", text: "No band change", tone: "ok" };
  return { key: "result", text: `${groupInt(heat.view.bandChanged)} change band`, tone: "warn" };
}

export function libraryRows(listing: ScenariosResponse | null, records: ReadonlyMap<string, RunRecord>, selectedId: string | null, checked: ReadonlySet<string>): LibraryRow[] {
  if (listing === null) return [];
  return listing.scenarios.map((def) => ({
    id: def.id,
    version: def.version,
    label: def.label,
    description: def.description,
    engines: joinAnd(def.engines.map(engineName)),
    coversCash: def.engines.includes(CASH),
    outcome: outcomeLine(records.get(def.id), def),
    checked: checked.has(def.id),
    selected: def.id === selectedId,
  }));
}

const shockKey = (s: Schemas["Shock"]): string => `${s.axis}|${s.asset ?? ""}|${String(s.factor_num)}/${String(s.factor_den)}`;

/** The fields on which the listing's definition no longer matches the result's — "for a previous input" when non-empty. */
export function definitionSkew(definition: ScenarioDefinition, configVersion: string, run: RunBookResponse): string[] {
  const fields: string[] = [];
  if (definition.version !== run.scenario_version) fields.push("version");
  if (definition.label !== run.label) fields.push("label");
  if (definition.path_assumption !== run.path_assumption) fields.push("path assumption");
  const a = definition.shocks.map(shockKey).join(";");
  const b = run.shocks.map(shockKey).join(";");
  if (a !== b) fields.push("shocks");
  if (configVersion !== run.scenario_config_version) fields.push("config version");
  return fields;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-library.spec.ts tests/unit/lab-deep-link.spec.ts`
Expected: all passed (4 in `lab-library`; the moved count in `lab-deep-link`). If `SCENARIOS.scenarios[0].engines` is not `["aave_v3_etherfi", "debt_manager"]` in that order, the "engines" pin follows the fixture's order — `joinAnd` never sorts.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-library.ts web/lib/lab-deep-link.ts web/tests/unit/lab-library.spec.ts web/tests/unit/lab-deep-link.spec.ts web/tests/unit/helpers/run-book-engine.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-library - the library's rows and outcome words from the wire and the run records, the definition-skew law; the deep-link law moved verbatim into lib" -- web/lib/lab-library.ts web/lib/lab-deep-link.ts web/tests/unit/lab-library.spec.ts web/tests/unit/lab-deep-link.spec.ts web/tests/unit/helpers/run-book-engine.ts
```

---
