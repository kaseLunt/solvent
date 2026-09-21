// One view model for the Scenarios page. The surface reads it and prints it;
// the pins read it and check it; nothing below it decides a state twice. Each
// engine of a result is read once, by id, in `lab-engine` — the same reading
// the library's row prints in one word — and a refusal of any kind is its own
// state here with its own sentence.
import type { ReceivedAt } from "./freshness";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LoadPhase } from "./inspector-view";
import { classifyRunBookEnvelope, contractFaults } from "./lab-classify";
import { compareRows, setMembership, type CompareView } from "./lab-compare";
import { answerFault, readEngine, type EngineReading } from "./lab-engine";
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
  setMembershipHeadline,
  withheldHeadline,
  type Banner,
  type HeldCondition,
  type LabHeadline,
  type Retained,
} from "./lab-headline";
import { definitionSkew, libraryRows, type HeldResult, type LibraryRow, type RunRecord, type ScenarioDefinition, type ScenariosResponse } from "./lab-library";
import type { LabReading } from "./lab-reading";
import { groupInt, joinAnd } from "./prose";
import type { ResultIdentity } from "./resultIdentity";
import type { LabRunBook, RunBookOutcome } from "./runbook";

export { readEngine } from "./lab-engine";
export type { EngineReading, EngineResult } from "./lab-engine";
export type { Banner, HeldCondition, Retained } from "./lab-headline";

/** A chip on the identity strip; structurally the kit's IdentityChip, kept out of the component layer. */
export interface LabChip {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
  readonly title?: string;
}

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
  | "refused-locally"
  | "failed";

export interface BookWorkspace {
  readonly state: BookState;
  readonly banner: Banner;
  /** The failure a re-run met while a computed result is held below it; the banner names it. */
  readonly rerunFailure: LabHeadline | null;
  readonly heldCondition: HeldCondition;
  readonly retained: Retained | null;
  readonly kicker: string;
  readonly headline: LabHeadline;
  readonly chips: LabChip[];
  readonly identity: ResultIdentity | null;
  /** The clocks at which this tab settled the result; the "Computed" age anchors the wire's batch age here. */
  readonly receivedAt: ReceivedAt | null;
  readonly definition: ScenarioDefinition | null;
  readonly run: LabRunBook | null;
  readonly cash: EngineReading | null;
  readonly legacy: EngineReading | null;
  readonly skew: readonly string[];
}
export type CompareState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly ids: readonly string[] }
  | { readonly kind: "ok"; readonly cash: CompareView; readonly legacy: CompareView }
  /** `held`: the comparison a failed Compare left standing — the last set that answered its request, both engines' views — or null when there is none. */
  | { readonly kind: "failed"; readonly headline: LabHeadline; readonly held: HeldCompare | null };
export interface HeldCompare {
  readonly cash: CompareView;
  readonly legacy: CompareView;
}

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

/** A book with no result: whatever chips the caller has are the only chips it carries. */
const emptyBook = (state: BookState, headline: LabHeadline, definition: ScenarioDefinition | null = null, chips: LabChip[] = []): BookWorkspace => ({
  state,
  banner: null,
  rerunFailure: null,
  heldCondition: null,
  retained: null,
  kicker: definition === null ? "Scenarios · Cash book" : `${definition.label} · Cash book`,
  headline,
  chips,
  identity: null,
  receivedAt: null,
  definition,
  run: null,
  cash: null,
  legacy: null,
  skew: [],
});

/** The chips of a book that has no result: the definition's own identity and the listing's config version. */
function definitionChips(def: ScenarioDefinition, configVersion: string): LabChip[] {
  return [
    { label: "Scenario", value: `${def.id} · ${def.version}`, title: def.label },
    { label: "Config", value: configVersion },
  ];
}

function enginesChip(run: LabRunBook, cash: EngineReading): LabChip {
  const served = run.engines.map((e) => engineName(e.engine));
  const withheld = run.excluded_engines.map((e) => `${engineName(e.engine)} withheld`);
  const parts = [...(served.length > 0 ? [joinAnd(served)] : []), ...withheld];
  return { label: "Engines", value: parts.join(" · "), tone: withheld.length > 0 || cash.kind === "withheld" ? "warn" : undefined };
}

function resultBook(def: ScenarioDefinition, configVersion: string, run: LabRunBook, receivedAt: ReceivedAt): BookWorkspace {
  // The envelope first, before any member of it is read: a body whose envelope is outside the contract is the
  // contradictory state naming every field, and nothing of it is carried — no run for the drawer or the age to
  // read, no identity, the definition's own chips. Both engines' readings refuse by the same names.
  const envelope = classifyRunBookEnvelope(run);
  if (envelope.length > 0) {
    return {
      ...emptyBook("contradictory", contradictoryHeadline(def.label, contractFaults(envelope)), def, definitionChips(def, configVersion)),
      cash: readEngine(run, CASH, def),
      legacy: def.engines.includes(LEGACY) ? readEngine(run, LEGACY, def) : null,
    };
  }
  const skew = definitionSkew(def, configVersion, run);
  const superseded = run.batch.supersession.superseded;
  const kicker = `${def.label} · Cash book`;
  // The answered engines, distinct and in wire order; a withheld engine is a refusal, never an answer.
  const identity: ResultIdentity = { scope: "book", batchId: run.batch.id, configVersion: run.scenario_config_version, engines: [...new Set(run.engines.map((e) => e.engine))], servedAt: run.served_at };
  const cash = readEngine(run, CASH, def);
  const legacy = def.engines.includes(LEGACY) ? readEngine(run, LEGACY, def) : null;
  const chips: LabChip[] = [
    superseded
      ? { label: "Result for batch", value: `${groupInt(run.batch.id)} · superseded`, tone: "warn", title: "a newer complete batch exists; run again for it" }
      : { label: "Result for batch", value: groupInt(run.batch.id) },
    { label: "Scenario", value: `${run.scenario_id} · ${run.scenario_version}`, title: run.label },
    enginesChip(run, cash),
    { label: "Config", value: run.scenario_config_version, tone: skew.includes("config version") ? "warn" : undefined },
  ];
  const base = { kicker, chips, identity, receivedAt, definition: def, run, cash, legacy, skew, rerunFailure: null, heldCondition: null, retained: null };
  // Precedence. A body that does not read is a failed answer whatever else it says, so its Cash row is judged FIRST
  // — before the body's version and before the definition's coverage: the contradictory state, the fault named. That
  // is the hold's own rule (`answerFault`), so what releases a held result is exactly what may be held. Then a
  // version skew is its own state before any reading is consulted; on a result, a superseded batch outranks a stale
  // input as the banner, and a banner sits on the result state rather than replacing it.
  const banner: Banner = superseded ? "superseded" : skew.length > 0 ? "stale-input" : null;
  if (cash.kind === "contradictory" || cash.kind === "unreadable") {
    return { ...base, state: "contradictory", banner, headline: contradictoryHeadline(def.label, cash.kind === "contradictory" ? cash.reasons : contractFaults(cash.fields)) };
  }
  if (skew.includes("version")) return { ...base, state: "definition-changed", banner: null, headline: definitionChangedHeadline(def.label, skew), cash: null, legacy: null };
  switch (cash.kind) {
    case "withheld":
      return { ...base, state: "withheld", banner, headline: withheldHeadline(def.label, cash.cause) };
    case "not-covered":
      return { ...base, state: "not-covered", banner, headline: notCoveredHeadline(def.label, def.engines, legacy !== null) };
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
        heat: r.heat,
        heatReason: null,
      });
      return { ...base, state: "result", banner, headline };
    }
  }
}

function bookOf(listing: ScenariosResponse, def: ScenarioDefinition, record: RunRecord | undefined): BookWorkspace {
  const configVersion = listing.scenario_config_version;
  const chips = definitionChips(def, configVersion);
  if (record === undefined) {
    return emptyBook("not-run", notRunHeadline({ label: def.label, description: def.description, path_assumption: def.path_assumption, shocks: def.shocks.length }), def, chips);
  }
  if (record.phase === "running") return emptyBook("running", runningHeadline(def.label), def, chips);
  const o = record.outcome;
  if (o.kind === "ok") {
    const book = resultBook(def, configVersion, o.response, { wallMs: record.at, monotonicMs: record.atMonotonicMs });
    // A 2xx body READS as an answer — a result, a withheld book, a scenario that does not model Cash, a definition
    // that changed — or it does not: malformed or self-contradicting, it is a failed answer, and a failed answer
    // never replaces the result the page had. The honest answers release the hold; the malformed classes stand
    // behind it with the contradiction named as the failure. The question is the record's own (`answerFault`): one
    // rule decides what moves into the hold and what releases it, and a body it faults is the contradictory state
    // above, so the failure named here is that state's headline.
    if (record.held === null || answerFault(o.response) === null) return book;
    return overHeld(def, configVersion, record.held, { state: "contradictory", headline: book.headline }, chips);
  }
  const failure = failureOf(o);
  return record.held === null ? emptyBook(failure.state, failure.headline, def, chips) : overHeld(def, configVersion, record.held, failure, chips);
}

/**
 * A held result under a failure that did not replace it. A result already computed is never replaced by a failed
 * re-run: it stands for the batch it names, the failure named beside it — and so is the held result's own
 * condition, which the failure does not cancel. A retained body whose definition changed is disclosed, never shown
 * as this request's answer: the attempt's own failure is the state.
 */
function overHeld(def: ScenarioDefinition, configVersion: string, heldResult: HeldResult, failure: { state: BookState; headline: LabHeadline }, chips: LabChip[]): BookWorkspace {
  const held = resultBook(def, configVersion, heldResult.response, { wallMs: heldResult.at, monotonicMs: heldResult.atMonotonicMs });
  if (held.state === "definition-changed") {
    return { ...emptyBook(failure.state, failure.headline, def, chips), banner: "retained-refused", retained: { batchId: heldResult.response.batch.id, skew: held.skew } };
  }
  const heldCondition: HeldCondition = held.banner === "superseded" || held.banner === "stale-input" ? held.banner : null;
  return { ...held, banner: "rerun-failed", heldCondition, rerunFailure: failure.headline };
}

function failureOf(o: Exclude<RunBookOutcome, { kind: "ok" }>): { state: BookState; headline: LabHeadline } {
  switch (o.kind) {
    case "not-served":
      return { state: "not-served", headline: failureHeadline("not-served", {}) };
    case "no-batch":
      return { state: "no-batch", headline: failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }) };
    case "rate-limited":
      return { state: "rate-limited", headline: failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }) };
    case "unreachable":
      return { state: "unreachable", headline: failureHeadline("unreachable", { message: o.message }) };
    case "failed":
      return { state: "failed", headline: failureHeadline("failed", { status: o.status, message: o.message }) };
    case "refused-locally":
      return { state: "refused-locally", headline: failureHeadline("refused-locally", { message: o.message }) };
  }
}

function compareOf(reading: LabReading): CompareState {
  const set = reading.set;
  if (set === null) return { kind: "idle" };
  if (set.phase === "running") return { kind: "running", ids: set.ids };
  const o = set.outcome;
  // A failed Compare never replaces the comparison it had: the last set that answered its request stands beside the failure.
  const held: HeldCompare | null = set.held === null ? null : { cash: compareRows(set.held.response, CASH), legacy: compareRows(set.held.response, LEGACY) };
  const failed = (headline: LabHeadline): CompareState => ({ kind: "failed", headline, held });
  switch (o.kind) {
    case "ok": {
      // The asked ids are the authority on what was asked: a body that does not answer them is refused whole, every fault named.
      const faults = setMembership(set.ids, o.response);
      if (faults.length > 0) return failed(setMembershipHeadline(faults));
      return { kind: "ok", cash: compareRows(o.response, CASH), legacy: compareRows(o.response, LEGACY) };
    }
    case "busy":
      return failed(failureHeadline("busy", { message: o.message, inFlight: o.inFlight, maxInFlight: o.maxInFlight }));
    case "not-served":
      return failed(failureHeadline("not-served", {}));
    case "no-batch":
      return failed(failureHeadline("no-batch", { message: o.message, retryAfterSeconds: o.retryAfterSeconds }));
    case "rate-limited":
      return failed(failureHeadline("rate-limited", { retryAfterSeconds: o.retryAfterSeconds }));
    case "refused":
      // An envelope-less refusal carries no code; its message stands alone rather than behind an empty one.
      return failed(failureHeadline("failed", { status: o.status, message: o.code === "" ? o.message : `${o.code}: ${o.message}` }));
    case "unreachable":
      return failed(failureHeadline("unreachable", { message: o.message }));
    case "refused-locally":
      return failed(failureHeadline("refused-locally", { message: o.message }));
  }
}

const loadPhase = (p: LabReading["listing"]): LoadPhase => (p.phase === "error" ? { phase: "error", message: p.message } : p.phase === "loading" ? { phase: "loading" } : { phase: "ready" });

export function deriveLabView(reading: LabReading, ui: LabUi): LabView {
  const listingLoad = loadPhase(reading.listing);
  const compare = compareOf(reading);
  // Nothing can run until the listing answers. The ticks that count are the ones the listing names; while it loads,
  // and when it cannot be listed, it names none — so no tick a link brought counts toward a Compare, and the controls
  // that would dispatch one stay disabled beside the sentence that says nothing can run.
  if (reading.listing.phase === "loading") {
    return { listingLoad, library: [], selectedId: null, checked: [], configVersion: null, book: emptyBook("listing-loading", LISTING_LOADING), compare };
  }
  if (reading.listing.phase === "error") {
    return { listingLoad, library: [], selectedId: null, checked: [], configVersion: null, book: emptyBook("listing-unavailable", listingUnavailableHeadline(reading.listing.message)), compare };
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
