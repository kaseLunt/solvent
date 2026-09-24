// The scenario library's model: one row per committed scenario as the wire
// lists it, its last outcome in one word, and the definition-skew law that
// makes a result "for a previous input" once the listing changes under it.
//
// Every reader takes the run-book as the Lab HOLDS it — the sealed body of
// `lib/runbook.ts`, verdicts refined on receipt — never the raw wire shape: a
// record's outcome is sealed by law before anything here reads it.
import type { components } from "@solvent/client";
import { CASH } from "./inspector-position";
import type { CompareRow, CompareView } from "./lab-compare";
import { answerFault, readEngine } from "./lab-engine";
import { compareCellWords, signedCount } from "./lab-headline";
import { signedBookMoney } from "./money";
import { formatTenths } from "./percent";
import { engineList, groupInt } from "./prose";
import type { LabRunBook, RunBookOutcome } from "./runbook";
import type { RunBookSetResponse, SetRunOutcome } from "./runbookSet";
import { scenarioGist, scenarioName, scenarioTitle } from "./scenario-name";

export { scenarioGist, scenarioName, scenarioTitle } from "./scenario-name";

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

/** The last set response that READ — it answered its request and every row it draws read — with its ask and its settle clocks: a failed Compare stands beside it, never in its place. */
export interface HeldSet {
  readonly ids: readonly string[];
  readonly response: RunBookSetResponse;
  readonly at: number;
  readonly atMonotonicMs: number;
}

export type SetRecord =
  | { readonly phase: "running"; readonly ids: readonly string[]; readonly startedAt: number; readonly held: HeldSet | null }
  // The settle clocks, as a run's: the comparison's age stays anchored on them however often the set is shown again.
  | { readonly phase: "settled"; readonly ids: readonly string[]; readonly outcome: SetRunOutcome; readonly at: number; readonly atMonotonicMs: number; readonly held: HeldSet | null };

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "compared" | "withheld" | "not-covered" | "failed" | "definition-changed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";
export interface LibraryOutcome {
  readonly key: LibraryOutcomeKey;
  readonly text: string;
  readonly tone: LibraryOutcomeTone;
}

export interface LibraryRow {
  readonly id: string;
  readonly version: string;
  /** The scenario's one name (`scenarioName`), built from its definition. */
  readonly label: string;
  /** The wire's own label, id and version, verbatim: the name's title. */
  readonly title: string;
  /** The one-line gist (`scenarioGist`); the full description is the drawer's. */
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
  "refused-locally": "Not sent",
};

const failed = (text: string): LibraryOutcome => ({ key: "failed", text, tone: "refused" });
/** A read that did not complete: its own word, never the refused register the header and the tiles withhold from it. */
const unanswered = (text: string): LibraryOutcome => ({ key: "failed", text, tone: "dim" });

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
  // A 4xx is the service declining the request and a request never sent is the page's refusal; every other failure
  // is an answer that did not come.
  if (o.kind === "failed") return (o.status >= 500 ? unanswered : failed)(`Failed ${String(o.status)}`);
  return (o.kind === "refused-locally" ? failed : unanswered)(FAILURE_WORD[o.kind]);
}

function cashOutcome(response: LabRunBook, definition: ScenarioDefinition, configVersion: string): LibraryOutcome {
  // The workspace's precedence, in a word: a body that does not read — its envelope, or any row the page would draw —
  // is a failed answer whatever else it says, so the hold's own question is asked before the skew reads the body's
  // lists, before its version and before the definition's coverage.
  const fault = answerFault(response);
  if (fault !== null) return failed(fault.kind === "unreadable" ? "Unreadable" : "Contradictory");
  const r = readEngine(response, CASH, definition);
  if (r.kind === "unreadable") return failed("Unreadable");
  if (r.kind === "contradictory") return failed("Contradictory");
  // A result computed under another version of the definition is not this definition's result.
  if (definitionSkew(definition, configVersion, response).includes("version")) return { key: "definition-changed", text: "Definition changed", tone: "refused" };
  switch (r.kind) {
    case "not-covered":
      return { key: "not-covered", text: "Not modelled for Cash", tone: "dim" };
    case "withheld":
      return { key: "withheld", text: "Withheld", tone: "refused" };
    case "result": {
      const { newly, deltaEligibleDebt, decimals, heat } = r.result;
      if (newly > 0) {
        return { key: "result", text: `${signedBookMoney(decimals)(deltaEligibleDebt)} liquidatable · ${groupInt(newly)} account${newly === 1 ? "" : "s"}`, tone: "crit" };
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

/**
 * A compared scenario's word, from the set run the headline reads — never the single run's record, so a scenario the
 * headline ranked never reads "Not run yet". A point is its money and its unsigned share of the book (the sign is the
 * money's); a measured zero says so; a row the comparison does not rank keeps the compare card's own words, refused
 * only where the service or the engine declined.
 */
export function compareOutcome(row: CompareRow): LibraryOutcome {
  if (row.kind === "point" && row.deltaUsd !== null && row.shareTenths !== null) {
    if (row.deltaUsd === 0n) return { key: "compared", text: "No new liquidatable debt", tone: "dim" };
    const tenths = row.shareTenths < 0n ? -row.shareTenths : row.shareTenths;
    const share = tenths === 0n ? "<0.1%" : formatTenths(tenths);
    return { key: "compared", text: `${row.deltaText} liquidatable · ${share} of the book`, tone: row.deltaUsd > 0n ? "crit" : "ok" };
  }
  return { key: "compared", text: compareCellWords(row, CASH), tone: row.kind === "not-covered" || row.kind === "projection" ? "dim" : "refused" };
}

/** The rail while a comparison leads the page: its members speak from it, every other row keeps its own word. */
export function comparedLibrary(rows: readonly LibraryRow[], view: CompareView | null): readonly LibraryRow[] {
  if (view === null) return rows;
  return rows.map((r) => {
    const member = view.rows.find((c) => c.id === r.id);
    return member === undefined ? r : { ...r, outcome: compareOutcome(member) };
  });
}

export function libraryRows(listing: ScenariosResponse | null, records: ReadonlyMap<string, RunRecord>, selectedId: string | null, checked: ReadonlySet<string>): LibraryRow[] {
  if (listing === null) return [];
  return listing.scenarios.map((def) => ({
    id: def.id,
    version: def.version,
    label: scenarioName(def),
    title: scenarioTitle(def.label, def.id, def.version),
    description: scenarioGist(def),
    engines: engineList(def.engines),
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
