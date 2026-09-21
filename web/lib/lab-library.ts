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
import { classifyRunBookEnvelope } from "./lab-classify";
import { readEngine } from "./lab-engine";
import { signedCount, signedUsd } from "./lab-headline";
import { groupInt, joinAnd } from "./prose";
import type { LabRunBook, RunBookOutcome } from "./runbook";
import type { RunBookSetResponse, SetRunOutcome } from "./runbookSet";

type Schemas = components["schemas"];
export type ScenariosResponse = Schemas["ScenariosResponse"];
export type ScenarioDefinition = Schemas["ScenarioDefinition"];

/** The last computed result an id holds through a re-run, with its settle clocks: a failed re-run stands beside it, never in its place. */
export interface HeldResult {
  readonly response: LabRunBook;
  readonly at: number;
  readonly atMonotonicMs: number;
}

export type RunRecord =
  | { readonly phase: "running"; readonly startedAt: number; readonly held: HeldResult | null }
  // `at` is the wall clock and `atMonotonicMs` the monotonic clock at settle: the pair a later re-selection anchors the result's age on.
  | { readonly phase: "settled"; readonly outcome: RunBookOutcome; readonly at: number; readonly atMonotonicMs: number; readonly held: HeldResult | null };

/** The last set response that answered its request, with its ask and its settle clock: a failed Compare stands beside it, never in its place. */
export interface HeldSet {
  readonly ids: readonly string[];
  readonly response: RunBookSetResponse;
  readonly at: number;
}

export type SetRecord =
  | { readonly phase: "running"; readonly ids: readonly string[]; readonly startedAt: number; readonly held: HeldSet | null }
  | { readonly phase: "settled"; readonly ids: readonly string[]; readonly outcome: SetRunOutcome; readonly at: number; readonly held: HeldSet | null };

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed" | "definition-changed";
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

const FAILURE_WORD: Record<Exclude<RunBookOutcome["kind"], "ok" | "failed">, string> = {
  "not-served": "Not served",
  "no-batch": "No batch",
  "rate-limited": "Rate limited",
  unreachable: "Unreachable",
};

const failed = (text: string): LibraryOutcome => ({ key: "failed", text, tone: "refused" });

/** The row's one word. A settled result is the Cash reading of `lab-engine` — the workspace's own — said in a word, never a second judgement of the same body. */
export function outcomeLine(record: RunRecord | undefined, definition: ScenarioDefinition, configVersion: string): LibraryOutcome {
  if (record === undefined) return { key: "not-run", text: "Not run yet", tone: "dim" };
  if (record.phase === "running") return { key: "running", text: "Running…", tone: "dim" };
  const o = record.outcome;
  // A failed re-run leaves the held result's word while the page keeps those figures; a retained body the page
  // does not show (its definition changed) leaves the row to the request's own failure. A 200 whose Cash reading
  // does not read — malformed or self-contradicting — is a failed answer under the same law, never a replacement.
  const held = record.held === null ? null : cashOutcome(record.held.response, definition, configVersion);
  const standing = held !== null && held.key !== "definition-changed" ? held : null;
  if (o.kind === "ok") {
    const word = cashOutcome(o.response, definition, configVersion);
    return word.key === "failed" && standing !== null ? standing : word;
  }
  if (standing !== null) return standing;
  if (o.kind === "failed") return failed(`Failed ${String(o.status)}`);
  return failed(FAILURE_WORD[o.kind]);
}

function cashOutcome(response: LabRunBook, definition: ScenarioDefinition, configVersion: string): LibraryOutcome {
  // The envelope first, before the skew reads its lists: a body whose envelope is outside the contract is unreadable, whatever else it says.
  if (classifyRunBookEnvelope(response).length > 0) return failed("Unreadable");
  // A result computed under another version of the definition is not this definition's result.
  if (definitionSkew(definition, configVersion, response).includes("version")) return { key: "definition-changed", text: "Definition changed", tone: "refused" };
  const r = readEngine(response, CASH, definition);
  switch (r.kind) {
    case "not-covered":
      return { key: "not-covered", text: "Not modelled for Cash", tone: "dim" };
    case "withheld":
      return { key: "withheld", text: "Withheld", tone: "refused" };
    case "unreadable":
      return failed("Unreadable");
    case "contradictory":
      return failed("Contradictory");
    case "result": {
      const { newly, deltaEligibleDebt, decimals, heat } = r.result;
      if (newly > 0) {
        return { key: "result", text: `${signedUsd(deltaEligibleDebt, decimals)} liquidatable · ${groupInt(newly)} account${newly === 1 ? "" : "s"}`, tone: "crit" };
      }
      // The wire's count is a NET: at or below zero, the headline's own law — the net beside the gross the merged lanes show, in a word.
      const net = `Net ${signedCount(newly)} account${newly === -1 ? "" : "s"}`;
      if (heat.crossedCap > 0) return { key: "result", text: `${net} · ${groupInt(heat.crossedCap)} cross${heat.crossedCap === 1 ? "es" : ""} the cap`, tone: "warn" };
      if (newly < 0) return { key: "result", text: net, tone: "ok" };
      if (heat.bandChanged === 0) return { key: "result", text: "No band change", tone: "ok" };
      return { key: "result", text: `${groupInt(heat.bandChanged)} change band`, tone: "warn" };
    }
  }
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
    outcome: outcomeLine(records.get(def.id), def, listing.scenario_config_version),
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
