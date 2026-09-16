// The scenario library's model: one row per committed scenario as the wire
// lists it, its last outcome in one word, and the definition-skew law that
// makes a result "for a previous input" once the listing changes under it.
//
// Every reader takes the run-book as the Lab HOLDS it — the sealed body of
// `lib/runbook.ts`, verdicts refined on receipt — never the raw wire shape: a
// record's outcome is sealed by law before anything here reads it.
import type { components } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { signedUsd } from "./lab-headline";
import { laneReading, type LaneReading } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";
import type { LabRunBook, LabRunBookEngine, RunBookOutcome } from "./runbook";
import type { SetRunOutcome } from "./runbookSet";
import { isWireDecimal, isWirePopulation } from "./wireGuard";

type Schemas = components["schemas"];
export type ScenariosResponse = Schemas["ScenariosResponse"];
export type ScenarioDefinition = Schemas["ScenarioDefinition"];
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

/** The Cash engine's book in a run, found by engine id — never by position. */
export const cashEngineOf = (run: LabRunBook): LabRunBookEngine | null => run.engines.find((e) => e.engine === CASH) ?? null;
/** The Cash engine's refusal in a run, found by engine id — never by position. */
export const cashRefusalOf = (run: LabRunBook): EngineRefusal | null => run.excluded_engines.find((e) => e.engine === CASH) ?? null;

/** The heat reading is a function of the transitions alone: the sealed projection is no part of it and is not handed across. */
const heatOf = (cash: LabRunBookEngine): LaneReading => laneReading({ ...cash, projection: null }, { merge: true });

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
  const heat = heatOf(cash);
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
export function definitionSkew(definition: ScenarioDefinition, configVersion: string, run: LabRunBook): string[] {
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
