// Compare scenarios: the set run's per-scenario summary for one engine as a
// signed share of that engine's book — `eligible_debt_delta_usd` over
// `total_debt_usd_before`, the denominator the wire itself sanctions. A
// scenario that did not answer for the engine keeps its own kind; it is never
// a dot at zero.
import type { components } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH, LEGACY } from "./inspector-position";
import { classifySetEnvelope, classifySetResult, classifySetRunEngine, contractFaults } from "./lab-classify";
import { compareRowWords, type LabHeadline } from "./lab-headline";
import { bookMoney, signedBookMoney } from "./money";
import { formatTenths, percentTenths } from "./percent";
import { groupInt, joinAnd } from "./prose";
import { scenarioName } from "./scenario-name";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookSetResponse = Schemas["RunBookSetResponse"];
export type SetRunScenarioResult = Schemas["SetRunScenarioResult"];
export type SetRunEngineSummary = Schemas["SetRunEngineSummary"];

/**
 * `projection` is a scenario the service evaluated with no spot pass at all (`shock_reach.reach` is
 * `projection_no_spot_pass`): its spot figures are the unshocked book by construction, so it has no spot change to
 * rank or to draw as a dot.
 */
export type CompareKind = "point" | "projection" | "withheld" | "not-covered" | "unmeasurable" | "contradictory" | "no-denominator" | "unreadable";

export interface CompareRow {
  readonly id: string;
  readonly version: string;
  /** The scenario's one name, built from its definition (`scenarioName`). */
  readonly label: string;
  /** The wire's own label, verbatim: the name's title. */
  readonly wireLabel: string;
  readonly kind: CompareKind;
  readonly deltaUsd: bigint | null;
  readonly decimals: number | null;
  readonly shareTenths: bigint | null;
  /**
   * Where the dot is drawn, in signed tenths of a percent: the share itself — except that a change the tenths cannot
   * resolve is drawn one tenth from zero on its OWN side, the first step the axis has. Zero is a measured "no change"
   * and nothing else: a nonzero change is never drawn there. Null where no dot is drawn.
   */
  readonly plotTenths: bigint | null;
  /**
   * The dot's tone, from the sign of the UNROUNDED delta — never of the truncated share: more liquidatable debt is
   * critical however small its share; less, and a measured zero, are ok. Null where no dot is drawn.
   */
  readonly tone: "crit" | "ok" | null;
  readonly shareText: string;
  readonly deltaText: string;
  readonly reason: string | null;
  /** The engine's own flip count (`flipped_to_eligible`); null where the engine does not speak it. */
  readonly newly: number | null;
}

export interface CompareView {
  readonly engine: string;
  readonly rows: readonly CompareRow[];
  readonly batchId: number;
  readonly freshness: Schemas["SetRunEvaluation"]["freshness"];
  readonly newestServable: number | null;
  readonly evaluated: number;
  readonly configVersion: string;
  readonly servedAt: string;
  /** The evaluated batch's own `computed_at`, as the wire states it. */
  readonly computedAt: string;
  /** The batch's age when the set was served — the wire's `age_seconds` — or null where the population guard refuses it. */
  readonly ageSeconds: number | null;
}

/** Signed tenths of a percent, truncated toward zero; null without a positive denominator. The percent law, applied to a signed delta. */
export function shareTenths(delta: bigint, denominator: bigint): bigint | null {
  return percentTenths(delta, denominator);
}

/**
 * The share's words: a zero delta is "0%"; a nonzero delta under a tenth says so unsigned — its sign is carried by
 * the dot's side of zero and by the absolute figure beside it; otherwise the signed tenths.
 */
function shareWords(delta: bigint, tenths: bigint): string {
  if (delta === 0n) return "0%";
  if (tenths === 0n) return "<0.1%";
  return tenths < 0n ? formatTenths(tenths) : `+${formatTenths(tenths)}`;
}

/** The dot's place on the axis: the share's tenths, and a nonzero delta the tenths truncate to zero one tenth out on the delta's own side. */
function plotTenthsOf(delta: bigint, tenths: bigint): bigint {
  if (tenths !== 0n || delta === 0n) return tenths;
  return delta > 0n ? 1n : -1n;
}

const unique = (names: readonly string[]): string[] => [...new Set(names)];
const nonNull = (part: string | null): part is string => part !== null;

/**
 * The wire publishes each result's engines in three parts — `engines[]`,
 * `withheld_engines` and `unmeasurable_engines[]` — pairwise disjoint and
 * together exactly `covered_engines`. A result whose parts do not partition
 * its coverage is contradictory before any engine in it is read; the reason
 * names every id outside the coverage, every covered id in no part, and every
 * id in more than one part.
 */
function censusBreak(r: SetRunScenarioResult): string | null {
  // The four lists are read only once the classifier admits them: a result that breaks one is named by the field, never dereferenced.
  const malformed = classifySetResult(r);
  if (malformed.length > 0) return `${malformed.join(", ")} ${malformed.length === 1 ? "is" : "are"} outside the wire contract`;
  const covered = new Set(r.covered_engines);
  const named = [...r.engines.map((s) => s.engine), ...r.withheld_engines, ...r.unmeasurable_engines.map((a) => a.engine)];
  const seen = new Set<string>();
  const overlap: string[] = [];
  for (const name of named) {
    if (seen.has(name)) overlap.push(name);
    seen.add(name);
  }
  const extra = unique(named.filter((name) => !covered.has(name)));
  const missing = unique(r.covered_engines.filter((name) => !seen.has(name)));
  if (extra.length === 0 && missing.length === 0 && overlap.length === 0) return null;
  return [
    "engines, withheld_engines and unmeasurable_engines do not partition covered_engines",
    extra.length > 0 ? `extra: ${extra.join(", ")}` : null,
    missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
    overlap.length > 0 ? `overlap: ${unique(overlap).join(", ")}` : null,
  ]
    .filter(nonNull)
    .join("; ");
}

/** The three fields the share itself reads. A row wrong only in these is unreadable; a row wrong anywhere else is contradictory. */
const SHARE_FIELDS: ReadonlySet<string> = new Set(["usd_decimals", "eligible_debt_delta_usd", "total_debt_usd_before"]);

/**
 * What in one result does not read, as ONE engine's row would draw it: parts that do not partition the coverage (the
 * whole result's fault, before any engine in it is read), or fields of that engine's own row outside the contract —
 * the whole row against its contract and the share's own three inputs beside it whatever the classifier's scope, each
 * named once. Null when the row reads: a point, or an honest absence — withheld, unmeasurable, not modelled, no
 * denominator. This is the one judgement of a result: the row's kind and the set's fault are both read from it.
 */
type ResultFault = { readonly kind: "census"; readonly reason: string } | { readonly kind: "fields"; readonly fields: readonly string[] };
function resultFault(r: SetRunScenarioResult, engine: string): ResultFault | null {
  const census = censusBreak(r);
  if (census !== null) return { kind: "census", reason: census };
  if (r.withheld_engines.includes(engine) || r.unmeasurable_engines.some((a) => a.engine === engine)) return null;
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return null;
  const malformed = unique([
    ...classifySetRunEngine(e).malformedFields,
    ...[
      isWireScale(e.usd_decimals) ? null : "usd_decimals",
      isWireDecimal(e.eligible_debt_delta_usd) ? null : "eligible_debt_delta_usd",
      isWireDecimal(e.total_debt_usd_before) ? null : "total_debt_usd_before",
    ].filter(nonNull),
  ]);
  return malformed.length === 0 ? null : { kind: "fields", fields: malformed };
}

/** The result's name from its own shocks. A set result's shocks are not classified, so a list that is not a list of objects is never read: the wire's label stands. */
const nameOf = (r: SetRunScenarioResult): string => {
  const shocks: unknown = r.shocks;
  return Array.isArray(shocks) && shocks.every((shock) => typeof shock === "object" && shock !== null) ? scenarioName({ id: r.scenario_id, label: r.label, shocks: r.shocks }) : r.label;
};

/** Whether the service evaluated the result with no spot pass at all; read defensively, since the reach is not classified. */
const projectionOnly = (r: SetRunScenarioResult): boolean => {
  const reach: unknown = (r.shock_reach as { readonly reach?: unknown } | null | undefined)?.reach;
  return reach === "projection_no_spot_pass";
};

function rowOf(r: SetRunScenarioResult, engine: string): CompareRow {
  const base = { id: r.scenario_id, version: r.scenario_version, label: nameOf(r), wireLabel: r.label, deltaUsd: null, decimals: null, shareTenths: null, plotTenths: null, tone: null, shareText: "—", deltaText: "—", newly: null };
  // Wrong only in the share's inputs, the row is unreadable; wrong anywhere else, contradictory. Neither is ever a point.
  const fault = resultFault(r, engine);
  if (fault !== null) {
    if (fault.kind === "census") return { ...base, kind: "contradictory", reason: fault.reason };
    return { ...base, kind: fault.fields.every((f) => SHARE_FIELDS.has(f)) ? "unreadable" : "contradictory", reason: fault.fields.join(", ") };
  }
  if (r.withheld_engines.includes(engine)) return { ...base, kind: "withheld", reason: "withheld" };
  const absent = r.unmeasurable_engines.find((a) => a.engine === engine);
  if (absent !== undefined) return { ...base, kind: "unmeasurable", reason: absent.reason };
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return { ...base, kind: "not-covered", reason: "not modelled" };
  // No spot pass ran: the after side is the before side by construction, so its zero is no measurement of a change.
  if (projectionOnly(r)) return { ...base, kind: "projection", reason: "projection, no spot pass", newly: e.flipped_to_eligible };
  const delta = BigInt(e.eligible_debt_delta_usd);
  const share = shareTenths(delta, BigInt(e.total_debt_usd_before));
  const deltaText = signedBookMoney(e.usd_decimals)(delta);
  const newly = e.flipped_to_eligible;
  if (share === null) return { ...base, kind: "no-denominator", deltaUsd: delta, decimals: e.usd_decimals, deltaText, reason: "no denominator", newly };
  // The tone and the dot's side are the DELTA's — the unrounded figure — so a rise too small for a tenth is still a
  // critical dot on the rising side, never an ok dot at zero.
  return { ...base, kind: "point", deltaUsd: delta, decimals: e.usd_decimals, shareTenths: share, plotTenths: plotTenthsOf(delta, share), tone: delta > 0n ? "crit" : "ok", shareText: shareWords(delta, share), deltaText, reason: null, newly };
}

/** A point carries its share and its delta; the other kinds carry neither. */
type Point = CompareRow & { readonly kind: "point"; readonly shareTenths: bigint; readonly deltaUsd: bigint };
const isPoint = (r: CompareRow): r is Point => r.kind === "point";
const abs = (t: bigint): bigint => (t < 0n ? -t : t);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One engine's view of a set whose envelope reads: `setMembership` classifies the envelope and refuses a body outside
 * it before this reads a member. The page draws a view only of a set that READS (`setFault`), so it never draws a
 * `contradictory` or `unreadable` row; those kinds stay here so that the reading of a set is total — a row that does
 * not read is never a point, whoever asks.
 */
export function compareRows(set: RunBookSetResponse, engine: string): CompareView {
  const rows = set.results.map((r) => rowOf(r, engine));
  // |share| descending, then |Δ| descending (a tie under a tenth still ranks by contribution), then wire order (a stable sort).
  const points = rows
    .filter(isPoint)
    .sort((a, b) => compareBig(abs(b.shareTenths), abs(a.shareTenths)) || compareBig(abs(b.deltaUsd), abs(a.deltaUsd)));
  const rest = rows.filter((r) => !isPoint(r));
  return {
    engine,
    rows: [...points, ...rest],
    batchId: set.batch.id,
    freshness: set.evaluation.freshness,
    newestServable: set.evaluation.newest_servable_batch_id,
    evaluated: set.evaluation.scenarios_evaluated,
    configVersion: set.scenario_config_version,
    servedAt: set.served_at,
    computedAt: set.batch.computed_at,
    ageSeconds: isWirePopulation(set.batch.age_seconds) ? set.batch.age_seconds : null,
  };
}

/** The book a compare view is a share of, as a headline names it: "Cash", or "legacy" for the legacy market. */
const bookWord = (engine: string): string => (engine === LEGACY ? "legacy" : engineName(engine));

/** A point's share of its book, unsigned — the sign is the delta's word: "4.5%", "under 0.1%" for a change the tenths cannot resolve, "0%" for a measured zero. */
function shareOfBook(p: Point): string {
  if (p.deltaUsd === 0n) return "0%";
  if (p.shareTenths === 0n) return "under 0.1%";
  return formatTenths(abs(p.shareTenths));
}

/** A kind the service or the engine declined to answer, as against a projection or a scenario that does not model the book. */
const REFUSAL_KINDS: ReadonlySet<CompareKind> = new Set(["withheld", "unmeasurable", "contradictory", "no-denominator", "unreadable"]);

/** The dek's clause for a row that is not ranked: a refusal named with its word, a book the scenario does not model, a projection. */
function unrankedClause(row: CompareRow, engine: string, book: string): string {
  if (row.kind === "not-covered") return `${row.label} does not model the ${book} book.`;
  if (row.kind === "projection") return `${row.label} is a projection with no spot pass, so it is not ranked on spot liquidatability.`;
  return `${row.label} could not be evaluated: ${compareRowWords(row, engine)}.`;
}

/**
 * The compare page's answer: the scenario that moves the most liquidatable debt, named with its money phrase and its
 * share of the book, crit when that is more debt. The ranking is the view's own (|share|, then |Δ|); a tie in the
 * figure names every leader. Every other ranked scenario is one clause of the dek; a refused, withheld or unmeasurable
 * scenario is left out of the ranking and named; a projection with no spot pass is never ranked on spot
 * liquidatability, and the dek says so. A set where no ranked scenario moves anything says that instead — of the whole
 * set only when every member was ranked, otherwise of the ranked spot scenarios, the dek naming each one left out.
 */
export function compareHeadline(view: CompareView): LabHeadline {
  const book = bookWord(view.engine);
  const points = view.rows.filter(isPoint);
  const unranked = view.rows.filter((r) => !isPoint(r));
  const unrankedDek = unranked.map((r) => unrankedClause(r, view.engine, book));
  const first = points[0];
  if (first === undefined) {
    if (view.rows.length === 0) return { emphasis: "No scenario was compared.", rest: "", tone: "absent", dek: "" };
    const allRefused = unranked.every((r) => REFUSAL_KINDS.has(r.kind));
    return { emphasis: `No scenario in this set could be ranked for the ${book} book.`, rest: "", tone: allRefused ? "refused" : "absent", dek: unrankedDek.join(" ") };
  }
  if (points.every((p) => p.deltaUsd === 0n)) {
    const names = points.map((p) => p.label);
    const still = `${joinAnd(names)} ${names.length === 1 ? "leaves" : "leave"} it unchanged.`;
    // The negative is said of the scenarios ranked, and of the set only when the set is every one of them.
    const scope = unranked.length === 0 ? "No scenario" : "No ranked spot scenario";
    return { emphasis: `${scope} in this set makes more ${book} debt liquidatable.`, rest: "", tone: "neutral", dek: [still, ...unrankedDek].join(" ") };
  }
  const leaders = points.filter((p) => p.deltaUsd === first.deltaUsd);
  const others = points.slice(leaders.length);
  const each = leaders.length > 1 ? " under each" : "";
  const money = bookMoney(first.decimals)(abs(first.deltaUsd));
  const rest =
    first.deltaUsd > 0n
      ? `${money} more ${book} debt becomes liquidatable${each}, ${shareOfBook(first)} of the book.`
      : `${money} less ${book} debt is liquidatable${each}, ${shareOfBook(first)} of the book.`;
  const otherDek = others.map((p) => (p.deltaUsd === 0n ? `${p.label}: no change.` : `${p.label}: ${p.deltaText}, ${shareOfBook(p)} of the book.`));
  return {
    emphasis: `${joinAnd(leaders.map((p) => p.label))} ${leaders.length === 1 ? "moves" : "move"} the most:`,
    rest,
    tone: first.deltaUsd > 0n ? "crit" : "neutral",
    dek: [...otherDek, ...unrankedDek].join(" "),
  };
}

/**
 * The legacy fold's summary line: the legacy leader by the headline's own ranking, in the legacy book's share — the
 * legacy market's own finding, never a Cash figure and never summed with one. Every leader of a tie is named. The
 * fold is collapsed and has no dek, so the line claims only what was ranked: "no scenario" only when every row was
 * measured at zero, and a row that could not be evaluated is counted — it could move the book more than the leader.
 */
export function legacyCompareSummary(view: CompareView): string {
  const points = view.rows.filter(isPoint);
  const first = points[0];
  if (first === undefined) return "No scenario could be ranked for the legacy book";
  const refused = view.rows.filter((r) => REFUSAL_KINDS.has(r.kind)).length;
  const unevaluated = refused > 0 ? ` · ${groupInt(refused)} not evaluated` : "";
  if (points.every((p) => p.deltaUsd === 0n)) {
    return points.length === view.rows.length ? "No scenario moves the legacy book" : `No ranked scenario moves the legacy book${unevaluated}`;
  }
  const leaders = points.filter((p) => p.deltaUsd === first.deltaUsd);
  return `${joinAnd(leaders.map((p) => p.label))} ${leaders.length === 1 ? "moves" : "move"} the most: ${first.shareText} of the legacy book${unevaluated}`;
}

/**
 * The set answers the request, or nothing in it may be read (the contract's
 * "one line to check"). The ids this client posted are
 * the only authority on what was asked: the body's `requested_scenario_ids` is
 * its own claim, so the two must be the same set, and the results must name
 * each requested id exactly once. Every fault is named. A duplicated id refuses
 * before any set question is posed, because a list naming an id twice is not a
 * set and no set-equality question is well-posed of it.
 */
export function setMembership(asked: readonly string[], set: RunBookSetResponse): string[] {
  // The envelope first: a body whose envelope is outside the contract is refused by the names of its fields before
  // any set question is posed of it, never dereferenced — a version-skewed 2xx is a refusal, not a throw.
  const envelope = classifySetEnvelope(set);
  if (envelope.length > 0) return contractFaults(envelope);
  const faults: string[] = [];
  const counts = new Map<string, number>();
  for (const id of set.requested_scenario_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > 1) faults.push(`${id} appears ${String(n)} times in requested_scenario_ids; a set names each id once`);
  }
  if (faults.length > 0) return faults;
  if (asked.length !== set.requested_scenario_ids.length) {
    faults.push(`asked ${String(asked.length)} id${asked.length === 1 ? "" : "s"}, the response names ${String(set.requested_scenario_ids.length)}`);
  }
  const requested = new Set(set.requested_scenario_ids);
  const dispatched = new Set(asked);
  for (const id of asked) {
    if (!requested.has(id)) faults.push(`${id} was dispatched and is not named in requested_scenario_ids`);
  }
  for (const id of requested) {
    if (!dispatched.has(id)) faults.push(`${id} is named in requested_scenario_ids and was not dispatched`);
  }
  const seen = new Set<string>();
  for (const r of set.results) {
    if (seen.has(r.scenario_id)) faults.push(`${r.scenario_id} appears in more than one result`);
    seen.add(r.scenario_id);
    if (!requested.has(r.scenario_id)) faults.push(`${r.scenario_id} was answered and was not requested`);
  }
  for (const id of requested) {
    if (!seen.has(id)) faults.push(`${id} was requested and has no result`);
  }
  if (set.evaluation.scenarios_evaluated !== set.results.length) {
    faults.push(`evaluation.scenarios_evaluated is ${String(set.evaluation.scenarios_evaluated)} against ${String(set.results.length)} results`);
  }
  return unique(faults);
}

/** The engines the comparison draws a plot for, in the card's own order: the Cash book's axis, then the legacy market's fold. */
const COMPARED_ENGINES: readonly string[] = [CASH, LEGACY];

/** Why a 2xx set is a FAILED Compare: it does not answer the request (`membership`), or it answers it and does not read (`unreadable`) — every fault named. */
export interface SetFault {
  readonly kind: "membership" | "unreadable";
  readonly faults: readonly string[];
}

/**
 * Why a 2xx set is a failed Compare, or null when it READS. It reads when it answers its request (`setMembership`,
 * the envelope first) and every row the comparison would draw reads — each result's parts partition its coverage, and
 * each engine figure the two plots print is inside the contract. A result that is withheld, unmeasurable, not modelled
 * or without a denominator reads: an honest absence is an answer.
 *
 * This is the ONE rule that holds a comparison and releases it, and it covers everything the comparison draws. The
 * record asks it to decide what may move into the hold and whether a settle releases it; the view asks it to decide
 * whether the body is drawn at all. A set that fails it is a failed Compare like any other: it never takes a computed
 * comparison off the page, it never becomes the next hold, and no row of it is drawn. Each fault is named under its
 * scenario — and, for a row other than the Cash book's, under its engine.
 */
export function setFault(asked: readonly string[], set: RunBookSetResponse): SetFault | null {
  const membership = setMembership(asked, set);
  if (membership.length > 0) return { kind: "membership", faults: membership };
  const faults: string[] = [];
  for (const r of set.results) {
    for (const engine of COMPARED_ENGINES) {
      const fault = resultFault(r, engine);
      if (fault === null) continue;
      if (fault.kind === "census") faults.push(`${r.scenario_id}: ${fault.reason}`);
      else for (const reason of contractFaults(fault.fields)) faults.push(`${r.scenario_id}: ${engine === CASH ? "" : `${engineName(engine)}: `}${reason}`);
    }
  }
  return faults.length === 0 ? null : { kind: "unreadable", faults: unique(faults) };
}
