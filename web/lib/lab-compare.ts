// Compare scenarios: the set run's per-scenario summary for one engine as a
// signed share of that engine's book — `eligible_debt_delta_usd` over
// `total_debt_usd_before`, the denominator the wire itself sanctions. A
// scenario that did not answer for the engine keeps its own kind; it is never
// a dot at zero.
import type { components } from "@solvent/client";
import { classifySetEnvelope, classifySetResult, classifySetRunEngine, contractFaults } from "./lab-classify";
import { signedUsd } from "./lab-headline";
import { formatTenths, percentTenths } from "./percent";
import { isWireDecimal, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookSetResponse = Schemas["RunBookSetResponse"];
export type SetRunScenarioResult = Schemas["SetRunScenarioResult"];
export type SetRunEngineSummary = Schemas["SetRunEngineSummary"];

export type CompareKind = "point" | "withheld" | "not-covered" | "unmeasurable" | "contradictory" | "no-denominator" | "unreadable";

export interface CompareRow {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly kind: CompareKind;
  readonly deltaUsd: bigint | null;
  readonly decimals: number | null;
  readonly shareTenths: bigint | null;
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

function rowOf(r: SetRunScenarioResult, engine: string): CompareRow {
  const base = { id: r.scenario_id, version: r.scenario_version, label: r.label, deltaUsd: null, decimals: null, shareTenths: null, shareText: "—", deltaText: "—", newly: null };
  const census = censusBreak(r);
  if (census !== null) return { ...base, kind: "contradictory", reason: census };
  if (r.withheld_engines.includes(engine)) return { ...base, kind: "withheld", reason: "withheld" };
  const absent = r.unmeasurable_engines.find((a) => a.engine === engine);
  if (absent !== undefined) return { ...base, kind: "unmeasurable", reason: absent.reason };
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return { ...base, kind: "not-covered", reason: "not modelled" };
  // The whole row against its contract, and the share's own three inputs
  // beside it whatever the classifier's scope: every field the wire got wrong
  // is named, once. Wrong only in the share's inputs, the row is unreadable;
  // wrong anywhere else, contradictory. Neither is ever a point.
  const malformed = unique([
    ...classifySetRunEngine(e).malformedFields,
    ...[
      isWireScale(e.usd_decimals) ? null : "usd_decimals",
      isWireDecimal(e.eligible_debt_delta_usd) ? null : "eligible_debt_delta_usd",
      isWireDecimal(e.total_debt_usd_before) ? null : "total_debt_usd_before",
    ].filter(nonNull),
  ]);
  if (malformed.length > 0) {
    return { ...base, kind: malformed.every((f) => SHARE_FIELDS.has(f)) ? "unreadable" : "contradictory", reason: malformed.join(", ") };
  }
  const delta = BigInt(e.eligible_debt_delta_usd);
  const share = shareTenths(delta, BigInt(e.total_debt_usd_before));
  const deltaText = signedUsd(delta, e.usd_decimals);
  const newly = e.flipped_to_eligible;
  if (share === null) return { ...base, kind: "no-denominator", deltaUsd: delta, decimals: e.usd_decimals, deltaText, reason: "no denominator", newly };
  return { ...base, kind: "point", deltaUsd: delta, decimals: e.usd_decimals, shareTenths: share, shareText: shareWords(delta, share), deltaText, reason: null, newly };
}

/** A point carries its share and its delta; the other kinds carry neither. */
type Point = CompareRow & { readonly kind: "point"; readonly shareTenths: bigint; readonly deltaUsd: bigint };
const isPoint = (r: CompareRow): r is Point => r.kind === "point";
const abs = (t: bigint): bigint => (t < 0n ? -t : t);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** One engine's view of a set that answered its request: `setMembership` classifies the envelope and refuses a body outside it before this reads a member. */
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
  };
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
