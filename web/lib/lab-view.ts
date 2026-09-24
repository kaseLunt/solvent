// One view model for the Scenarios page. The surface reads it and prints it;
// the pins read it and check it; nothing below it decides a state twice. Each
// engine of a result is read once, by id, in `lab-engine` — the same reading
// the library's row prints in one word — and a refusal of any kind is its own
// state here with its own sentence.
import type { ReceivedAt } from "./freshness";
import { WARN_HEADROOM_PCT } from "./headroom";
import { humanUtc } from "./human-utc";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import type { LoadPhase } from "./inspector-view";
import type { StateRegister } from "./kit";
import { truncateAddress } from "./format";
import { classifyRunBookEnvelope, contractFaults } from "./lab-classify";
import { compareRows, setFault, type CompareView } from "./lab-compare";
import { answerFault, readEngine, type EngineReading, type EngineResult } from "./lab-engine";
import {
  compareCaption,
  compareFailedLine,
  compareRerunFailedLine,
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  listingUnreadableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  setMembershipHeadline,
  setUnreadableHeadline,
  signedCount,
  withheldHeadline,
  type Banner,
  type HeldCondition,
  type LabHeadline,
  type Retained,
} from "./lab-headline";
import { definitionSkew, libraryRows, type HeldResult, type LibraryRow, type RunRecord, type ScenarioDefinition, type ScenariosResponse } from "./lab-library";
import type { LabReading } from "./lab-reading";
import { CONTRACT_LANE_EDGES, roomBoundLabel, type HeatmapView } from "./lab-transitions";
import { bookMoney, signedBookMoney } from "./money";
import { engineList, groupInt, joinAnd } from "./prose";
import type { ResultIdentity } from "./resultIdentity";
import type { LabRunBook, RunBookOutcome } from "./runbook";
import { scenarioName } from "./scenario-name";

export { readEngine } from "./lab-engine";
export type { EngineReading, EngineResult } from "./lab-engine";
export type { Banner, HeldCondition, Retained } from "./lab-headline";

/**
 * Three populations, three words. The band tile counts the heatmap's own population — accounts whose band after the
 * shock differs from their band today, both ends measured — so the tile and the grid beside it state one count. The
 * service's `lane_changed_rows` (rows whose risk bucket changed, which the contract says is NOT `movers_total`) is a
 * finer count over more buckets; it stays on the page, in the tile's title. Neither says "moved", and no page says
 * "lane". The movers table prints the service's rows in the service's own ranking (its caption, `moversCaption`, names
 * which accounts they are).
 */
export const LANE_TILE_LABEL = "Accounts changing band";
/** The four result tiles' labels, the same in every state. */
export const LAB_TILE_LABELS = { newly: "Newly liquidatable", debt: "Liquidatable debt", badDebt: "Bad debt at liquidation", band: LANE_TILE_LABEL } as const;
export const MOVERS_TITLE = "Most affected accounts";
export const MOVERS_QUALIFIER = "Room today and after the shock";
/** The movers table sits further down this page: the arrow says so. */
export const MOVERS_LINK = `${MOVERS_TITLE} ↓`;
/** An empty movers list states only that nothing is listed; which accounts, and how many, is the caption's. */
export const MOVERS_EMPTY = "No account is listed.";
/**
 * The drawer opens on the run's assumptions and on the wire's list of what the
 * scenario leaves out (`out_of_model`). The tiles' "not modelled" names an
 * engine a scenario does not cover, a different fact, so these words never
 * reuse it.
 */
export const ASSUMPTIONS_BUTTON = "Assumptions · What the model leaves out";
export const ASSUMPTIONS_TITLE = "Assumptions & what the model leaves out";
export const ASSUMPTIONS_LEFT_OUT = "Left out of the model";
/** The drawer on a scenario served and never run: what a run adds to it. */
export const ASSUMPTIONS_NOT_RUN = "Not run yet: the applied shocks, the held-flat inputs and the exact figures follow its run.";
/** The drawer's title names the scenario it opens on. */
export const assumptionsTitle = (name: string | null): string => (name === null ? ASSUMPTIONS_TITLE : `${ASSUMPTIONS_TITLE} · ${name}`);

/**
 * The transition grid's reading. On Cash the grid joins the service's risk
 * buckets into fewer room bands, so its band count runs below the lane tile's
 * bucket count, and the axes say how the bands are made. Unmerged, the grid
 * draws one bucket to a row, so its count is the tile's, in the tile's word.
 */
export function transitionFinding(view: HeatmapView): string {
  const one = (n: number, plural: string, singular: string) => (n === 1 ? singular : plural);
  const bucketBands = view.bands.filter((b) => b.kind === "bucket");
  const buckets = bucketBands.reduce((n, b) => n + b.lanes.length, 0);
  const axes = view.merged
    ? `Rows: room under cap today, in ${groupInt(bucketBands.length)} bands made from the service's ${groupInt(buckets)} risk buckets · columns: after the shock · cells are accounts.`
    : "Rows: risk bucket today · columns: after the shock, as the wire serves them · cells are accounts.";
  const unit = view.merged ? "band" : "bucket";
  const improved = view.improved === 0 ? "none improve" : `${groupInt(view.improved)} ${one(view.improved, "improve", "improves")}`;
  const moves = `${groupInt(view.bandChanged)} ${one(view.bandChanged, "accounts change", "account changes")} ${unit}; ${groupInt(view.crossedCap)} ${one(view.crossedCap, "cross", "crosses")} the cap; ${improved}.`;
  const unmeasured = view.unmeasuredRows === 0 ? "" : ` ${groupInt(view.unmeasuredRows)} not measured.`;
  return `${axes} ${moves}${unmeasured}${bandEdgesSentence(view)}`;
}

/**
 * Where the merged bands' edges fall, built from the contract's own bucket edges — never typed — so a reader who
 * knows the Book's near-cap line is told the two are not one cut. Said only when no edge IS that line.
 */
function bandEdgesSentence(view: HeatmapView): string {
  if (!view.merged) return "";
  const edges = CONTRACT_LANE_EDGES.slice(2, 5).map(roomBoundLabel);
  const line = `${String(WARN_HEADROOM_PCT)}%`;
  if (edges.includes(line)) return "";
  return ` Bands follow the service's risk buckets, so their edges fall at ${joinAnd(edges)} of cap, not at the Book's ${line} line.`;
}

/** A tile's words: its figure, its sub-line and, where the figure has a finer sibling count, the title that names it. */
export interface TileWords {
  readonly value: string;
  readonly sub: string;
  readonly title?: string;
}

/** The four result tiles' words, from one engine's result. A tile sub is no link, so it carries no arrow. */
export function resultTileWords(r: EngineResult): { readonly newly: TileWords; readonly debt: TileWords; readonly badDebt: TileWords; readonly band: TileWords } {
  const money = bookMoney(r.decimals);
  const signed = signedBookMoney(r.decimals);
  const heat = r.heat;
  const buckets = heat.bands.filter((b) => b.kind === "bucket").reduce((n, b) => n + b.lanes.length, 0);
  const lane = r.laneChanged;
  return {
    newly: { value: signedCount(r.newly), sub: `Accounts · was ${groupInt(r.beforeEligible)}, now ${groupInt(r.afterEligible)}` },
    debt: { value: signed(r.deltaEligibleDebt), sub: `Was ${money(r.eligibleDebtBefore)}, now ${money(r.eligibleDebtAfter)}` },
    badDebt: { value: signed(r.deltaBadDebt), sub: `Was ${money(r.badDebtBefore)}, now ${money(r.badDebtAfter)}` },
    band: {
      value: groupInt(heat.bandChanged),
      sub: `Of ${groupInt(heat.measuredRows)} measured · ${heat.improved === 0 ? "none improve" : `${groupInt(heat.improved)} improve`}`,
      title:
        lane === null
          ? undefined
          : heat.merged
            ? `${groupInt(lane)} account${lane === 1 ? " changes" : "s change"} risk bucket among the service's ${groupInt(buckets)}`
            : undefined,
    },
  };
}

/** Which absence a tile shows, and the lib's own word for it where it has one. */
export interface TileAbsence {
  readonly register: StateRegister;
  readonly word?: string;
}

/**
 * The absence the result tiles show when there is no result: the engine's own reading where the run answered, else
 * the book's state. A read in flight is pending; a fetch that failed is unavailable, never refused; a scenario served
 * and not run is not run; a request the service declined is refused.
 */
export function tileAbsence(book: Pick<BookWorkspace, "state" | "headline">, reading: EngineReading | null): TileAbsence | null {
  if (reading !== null) {
    switch (reading.kind) {
      case "result":
        return null;
      case "withheld":
        return { register: "refused", word: "Withheld" };
      case "not-covered":
        return { register: "not-run", word: "Not modelled" };
      case "contradictory":
        return { register: "unreadable", word: "Contradictory" };
      case "unreadable":
        return { register: "unreadable" };
    }
  }
  switch (book.state) {
    case "listing-loading":
    case "running":
      return { register: "pending" };
    case "not-run":
    case "definition-changed":
      return { register: "not-run" };
    case "not-served":
      return { register: "not-served" };
    case "listing-unreadable":
    case "contradictory":
      return { register: "unreadable" };
    case "withheld":
      return { register: "refused", word: "Withheld" };
    case "not-covered":
      return { register: "not-run", word: "Not modelled" };
    default:
      return { register: book.headline.tone === "refused" ? "refused" : "unavailable" };
  }
}

/** The kicker: the scenario's name, which keeps its own case under the kicker's capitals, and the scope beside it. */
export interface LabKicker {
  readonly name: string | null;
  readonly scope: string;
}

/** The compare page's kicker. */
export const COMPARE_KICKER: LabKicker = { name: null, scope: "Compare · Cash book" };

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
  | "listing-unreadable"
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
  readonly kicker: LabKicker;
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
  /** `held`: the comparison a failed Compare left standing — the last set that read, both engines' views — or null when there is none. */
  | { readonly kind: "failed"; readonly headline: LabHeadline; readonly held: HeldCompare | null };
export interface HeldCompare {
  readonly cash: CompareView;
  readonly legacy: CompareView;
}

/** The Compare button, and while it cannot act, the reason shown beside it. */
export interface CompareControl {
  readonly label: string;
  readonly disabled: boolean;
  readonly hint: string | null;
}

/**
 * Compare runs two or more ticked scenarios the listing names, and waits for a
 * comparison already in flight. The hint names whichever of those holds the
 * button back, and is null exactly when the button can act.
 */
export function compareControl(view: Pick<LabView, "listingLoad" | "library" | "checked" | "compare">): CompareControl {
  const ticked = view.checked.length;
  const label = ticked >= 2 ? `Compare ${String(ticked)} scenarios` : "Compare…";
  const hint = compareHint(view, ticked);
  return { label, disabled: hint !== null, hint };
}

function compareHint(view: Pick<LabView, "listingLoad" | "library" | "compare">, ticked: number): string | null {
  if (view.listingLoad.phase !== "ready") return "Nothing can be compared until the scenarios are listed.";
  if (view.library.length < 2) return `Compare needs two or more scenarios; ${view.library.length === 0 ? "none is" : "one is"} listed.`;
  if (ticked === 0) return "Tick two or more scenarios to compare them.";
  if (ticked === 1) return "Tick one more scenario to compare.";
  if (view.compare.kind === "running") return "A comparison is running.";
  return null;
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
  kicker: definition === null ? { name: null, scope: "Scenarios · Cash book" } : { name: scenarioName(definition), scope: "Cash book" },
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

/**
 * The chips of a set run's answer: its own batch, config and computed instant — never the single run's. A batch that
 * is no longer the newest says so.
 */
export function compareChips(view: CompareView): LabChip[] {
  const freshness =
    view.freshness === "still_newest"
      ? { label: "Result for batch", value: groupInt(view.batchId) }
      : { label: "Result for batch", value: `${groupInt(view.batchId)} · ${view.freshness === "superseded" ? "superseded" : "not the newest"}`, tone: "warn" as const };
  return [freshness, { label: "Config", value: view.configVersion }, { label: "Computed", value: humanUtc(view.computedAt, view.servedAt), title: view.computedAt }];
}

/** The chips of a book that has no result: the definition's own identity and the listing's config version. */
function definitionChips(def: ScenarioDefinition, configVersion: string): LabChip[] {
  return [
    { label: "Scenario", value: `${def.id} · ${def.version}`, title: def.label },
    { label: "Config", value: configVersion },
  ];
}

/**
 * The engines a result answers for, Cash first. With both engines answered, the legacy market is the fold below the
 * Cash result, and the chip says where; a withheld engine is named as withheld.
 */
function enginesChip(run: LabRunBook, cash: EngineReading): LabChip {
  const served = [...new Set(run.engines.map((e) => e.engine))];
  const withheld = run.excluded_engines.map((e) => `${engineName(e.engine)} withheld`);
  const both = served.includes(CASH) && served.includes(LEGACY);
  const others = served.filter((e) => e !== CASH && e !== LEGACY);
  const lead = both ? ["Cash", "legacy market below", ...(others.length > 0 ? [engineList(others)] : [])] : served.length > 0 ? [engineList(served)] : [];
  const parts = [...lead, ...withheld];
  return { label: "Engines", value: parts.join(" · "), tone: withheld.length > 0 || cash.kind === "withheld" ? "warn" : undefined };
}

function resultBook(def: ScenarioDefinition, configVersion: string, run: LabRunBook, receivedAt: ReceivedAt): BookWorkspace {
  // The envelope first, before any member of it is read: a body whose envelope is outside the contract is the
  // contradictory state naming every field, and nothing of it is carried — no run for the drawer or the age to
  // read, no identity, the definition's own chips. Both engines' readings refuse by the same names.
  const envelope = classifyRunBookEnvelope(run);
  const name = scenarioName(def);
  if (envelope.length > 0) {
    return {
      ...emptyBook("contradictory", contradictoryHeadline(name, contractFaults(envelope)), def, definitionChips(def, configVersion)),
      cash: readEngine(run, CASH, def),
      legacy: def.engines.includes(LEGACY) ? readEngine(run, LEGACY, def) : null,
    };
  }
  const skew = definitionSkew(def, configVersion, run);
  const superseded = run.batch.supersession.superseded;
  const kicker: LabKicker = { name, scope: "Cash book" };
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
  // Precedence. A body that does not read is a failed answer whatever else it says, so it is judged FIRST — before
  // the body's version and before the definition's coverage — and judged WHOLE: every engine the page would draw, the
  // movers' ratio pairs with the aggregates. That is the hold's own rule (`answerFault`), so what releases a held
  // result is exactly what may be held, and what the page shows as an answer is exactly what it may hold. Such a body
  // is the contradictory state, every fault named, and no figure of it is drawn for ANY engine: a reading that would
  // have been a result stands as the contradiction instead. It wears no banner of its own — a stale input or a
  // superseded batch is said of a result, and this state shows none. Then a version skew is its own state before any
  // reading is consulted; on a result, a superseded batch outranks a stale input as the banner, and a banner sits on
  // the result state rather than replacing it.
  const contradictory = (reasons: readonly string[]): BookWorkspace => {
    const undrawn = (r: EngineReading | null): EngineReading | null => (r?.kind === "result" ? { kind: "contradictory", reasons } : r);
    return { ...base, cash: undrawn(cash), legacy: undrawn(legacy), state: "contradictory", banner: null, headline: contradictoryHeadline(name, reasons) };
  };
  const fault = answerFault(run);
  if (fault !== null) return contradictory(fault.reasons);
  const banner: Banner = superseded ? "superseded" : skew.length > 0 ? "stale-input" : null;
  if (skew.includes("version")) return { ...base, state: "definition-changed", banner: null, headline: definitionChangedHeadline(name, skew), cash: null, legacy: null };
  switch (cash.kind) {
    // A Cash row that does not read is a fault of the body, answered above: these two arms keep the switch total
    // rather than trusted, and say the same thing.
    case "contradictory":
      return contradictory(cash.reasons);
    case "unreadable":
      return contradictory(contractFaults(cash.fields));
    case "withheld":
      return { ...base, state: "withheld", banner, headline: withheldHeadline(name, cash.cause) };
    case "not-covered":
      return { ...base, state: "not-covered", banner, headline: notCoveredHeadline(name, def.engines, legacy !== null) };
    case "result": {
      const r = cash.result;
      const headline = resultHeadline({
        label: name,
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
  const name = scenarioName(def);
  if (record === undefined) return emptyBook("not-run", notRunHeadline(name, def.engines.includes(CASH)), def, chips);
  if (record.phase === "running") return emptyBook("running", runningHeadline(name), def, chips);
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
  // A failed Compare never replaces the comparison it had: the last set that READ stands beside the failure.
  const held: HeldCompare | null = set.held === null ? null : { cash: compareRows(set.held.response, CASH), legacy: compareRows(set.held.response, LEGACY) };
  const failed = (headline: LabHeadline): CompareState => ({ kind: "failed", headline, held });
  switch (o.kind) {
    case "ok": {
      // The record's own question (`setFault`), so what is drawn is exactly what may be held. The asked ids are the
      // authority on what was asked: a body that does not answer them is refused whole. A body that answers them and
      // does not read — a figure outside the contract, parts that do not partition a coverage — is refused whole too,
      // never drawn as one dashed row beside dots the next failure would take away. Every fault is named.
      const fault = setFault(set.ids, o.response);
      if (fault !== null) return failed(fault.kind === "membership" ? setMembershipHeadline(fault.faults) : setUnreadableHeadline(fault.faults));
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

/** The listing's load phase without its value. A listing that answered and cannot be read did not load: it is an error phase with its own message, never `ready`. */
function loadPhase(p: LabReading["listing"]): LoadPhase {
  switch (p.phase) {
    case "error":
      return { phase: "error", message: p.message };
    case "unreadable":
      return { phase: "error", message: "the listing answered outside the wire contract" };
    case "loading":
      return { phase: "loading" };
    case "ready":
      return { phase: "ready" };
  }
}

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
  // A listing that answered and cannot be read is its own state — never the library of whatever the body held, and
  // never "unavailable", which is a fetch that failed. No tick and no selection counts: nothing here is a scenario.
  if (reading.listing.phase === "unreadable") {
    return { listingLoad, library: [], selectedId: null, checked: [], configVersion: null, book: emptyBook("listing-unreadable", listingUnreadableHeadline(reading.listing.faults)), compare };
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

/* ---------------- the surface's words ---------------- */

/** The Run button: the scenario's own name. */
export const runLabel = (name: string | null): string => (name === null ? "Run" : `Run ${name}`);
export const RUN_AGAIN = "Run again";
export const LIBRARY_LOADING = "Loading the committed scenarios…";
export const LIBRARY_EMPTY = "No committed scenarios are listed.";
export const libraryFootnote = (configVersion: string | null): string =>
  `Committed, versioned scenarios${configVersion === null ? "" : ` (config ${configVersion})`}. No sliders — every result is reproducible.`;

/** One-address mode's kicker: the account, the engine. The address keeps its own case and face; before one is entered, the mode names itself. */
export function addressKicker(address: string): { readonly lead: string; readonly address: string | null; readonly scope: string } {
  return address === "" ? { lead: "One address", address: null, scope: "Cash" } : { lead: "Account", address: truncateAddress(address), scope: "Cash" };
}
/** The one-address workspace's way to the same account on the Inspector — another page, so the arrow. */
export const OPEN_IN_INSPECTOR = "Open in the Inspector →";
export const EVERY_SCENARIO_TITLE = "Every committed scenario";
export const NO_SCENARIO_APPLIES = "No scenario applies to this address.";

/** The heatmap's two axes, as its corner and its region name read them. */
export const HEAT_ROWS = "today";
export const HEAT_COLS = "after";
export const NO_RESULT_YET = "No result yet.";
export const NO_GRID = "No grid: nothing here is a count.";

/** A cell's hover: its count, its move in the grid's own band labels, the debt it carries today. */
export function heatCellTitle(view: HeatmapView, cell: HeatmapView["cells"][number]): string {
  const from = view.bands[cell.from]?.label ?? "";
  const to = view.bands[cell.to]?.label ?? "";
  return `${groupInt(cell.rows)} account${cell.rows === 1 ? "" : "s"} · from ${from} to ${to} · debt ${bookMoney(view.decimals)(cell.debtBefore)}`;
}

/** The transition card's finding: the grid's own reading, or the state's words. */
export function transitionWords(reading: EngineReading | null, engine: string): string {
  if (reading === null) return "Run a scenario to see where accounts move.";
  switch (reading.kind) {
    case "result":
      return transitionFinding(reading.result.heat);
    case "withheld":
      return `Withheld: ${engineName(engine)} was not computed under this scenario.`;
    case "not-covered":
      return `This scenario does not model ${engineName(engine)}.`;
    case "contradictory":
    case "unreadable":
      return "Not drawn: the result contradicts itself.";
  }
}

/** The Compare card's finding for each state; a settled comparison's finding is what its plot's shares are shares of. */
export function compareFinding(state: CompareState): string {
  switch (state.kind) {
    case "idle":
      return "Tick two or more scenarios and press Compare.";
    case "running":
      return `Evaluating ${String(state.ids.length)} scenario${state.ids.length === 1 ? "" : "s"}…`;
    case "failed":
      // A failed Compare over a held comparison names the failure and what stands beneath it; with nothing held, the failure is the state.
      return state.held === null ? compareFailedLine(state.headline) : compareRerunFailedLine(state.headline, state.held.cash.batchId);
    case "ok":
      return compareCaption(state.cash);
  }
}

/** The plot's place when there is no plot to draw. */
export function comparePlotEmpty(state: CompareState): string {
  return state.kind === "running" ? "Running…" : state.kind === "idle" ? "No plot yet." : "No plot: nothing here is a share.";
}

/** The evaluated batch is not the newest: the pill's word and the sentence beside it. Null while it is the newest. */
export function compareFreshnessNote(view: CompareView): { readonly pill: string; readonly text: string } | null {
  if (view.freshness === "still_newest") return null;
  const pill = view.freshness === "superseded" ? "Superseded" : view.freshness === "newest_is_older" ? "Newest is older" : "None servable";
  const newest = view.newestServable === null ? "no batch was servable at probe time" : `the newest servable batch is ${groupInt(view.newestServable)}`;
  return { pill, text: `evaluated on batch ${groupInt(view.batchId)}; ${newest}.` };
}

/** The value column's header and the axes of the two books, each on its own axis. */
export const COMPARE_VALUE_HEADER = "Share · change";
export const COMPARE_AXIS = {
  cash: { label: "change in liquidatable Cash debt, percent of the Cash book", caption: "Share of the Cash book" },
  legacy: { label: "change in liquidatable legacy debt, percent of the legacy book", caption: "Share of the legacy book" },
} as const;

/** The legacy market's folds on this page: what each holds, and the law they keep. */
export const LEGACY_RESULT_SUMMARY = "Its own result, in its own unit";
export const LEGACY_COMPARE_SUMMARY = "Its own shares, on its own book";
export const LEGACY_RESULT_FOOTNOTE = "Judged by its own health factor, in its own unit. The two books are never added together.";
export const LEGACY_COMPARE_FOOTNOTE = "Shares of the legacy book, in its own unit. The two books are never added together.";
