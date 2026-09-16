// Compare scenarios: the set run's per-scenario summary for one engine as a
// signed share of that engine's book — `eligible_debt_delta_usd` over
// `total_debt_usd_before`, the denominator the wire itself sanctions. A
// scenario that did not answer for the engine keeps its own kind; it is never
// a dot at zero.
import type { components } from "@solvent/client";
import { MINUS } from "./human-usd";
import { classifySetRunEngine } from "./lab-classify";
import { signedUsd } from "./lab-headline";
import { formatTenths } from "./percent";
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

/** Signed tenths of a percent, truncated toward zero; null without a positive denominator. */
export function shareTenths(delta: bigint, denominator: bigint): bigint | null {
  if (denominator <= 0n) return null;
  return (delta * 1000n) / denominator;
}

/** The share's words: a zero delta is "0%"; a nonzero delta under a tenth keeps its sign and says so; otherwise the signed tenths. */
function shareWords(delta: bigint, tenths: bigint): string {
  if (delta === 0n) return "0%";
  if (tenths === 0n) return delta < 0n ? `${MINUS}<0.1%` : "+<0.1%";
  return tenths < 0n ? formatTenths(tenths) : `+${formatTenths(tenths)}`;
}

function rowOf(r: SetRunScenarioResult, engine: string): CompareRow {
  const base = { id: r.scenario_id, version: r.scenario_version, label: r.label, deltaUsd: null, decimals: null, shareTenths: null, shareText: "—", deltaText: "—", newly: null };
  if (r.withheld_engines.includes(engine)) return { ...base, kind: "withheld", reason: "withheld" };
  const absent = r.unmeasurable_engines.find((a) => a.engine === engine);
  if (absent !== undefined) return { ...base, kind: "unmeasurable", reason: absent.reason };
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return { ...base, kind: "not-covered", reason: "not modelled" };
  // The share's own inputs first: a scale or a Decimal the share cannot read is
  // unreadable, named, before any other field of the row is judged.
  const unreadable = [
    isWireScale(e.usd_decimals) ? null : "usd_decimals",
    isWireDecimal(e.eligible_debt_delta_usd) ? null : "eligible_debt_delta_usd",
    isWireDecimal(e.total_debt_usd_before) ? null : "total_debt_usd_before",
  ].filter((f): f is string => f !== null);
  if (unreadable.length > 0) return { ...base, kind: "unreadable", reason: unreadable.join(", ") };
  // Then the whole row against its contract: a row the classifier refuses is
  // contradictory by the names of its fields, never a point.
  const malformed = classifySetRunEngine(e).malformedFields;
  if (malformed.length > 0) return { ...base, kind: "contradictory", reason: malformed.join(", ") };
  const delta = BigInt(e.eligible_debt_delta_usd);
  const share = shareTenths(delta, BigInt(e.total_debt_usd_before));
  const deltaText = signedUsd(delta, e.usd_decimals);
  const newly = e.flipped_to_eligible;
  if (share === null) return { ...base, kind: "no-denominator", deltaUsd: delta, decimals: e.usd_decimals, deltaText, reason: "no denominator", newly };
  return { ...base, kind: "point", deltaUsd: delta, decimals: e.usd_decimals, shareTenths: share, shareText: shareWords(delta, share), deltaText, reason: null, newly };
}

const abs = (t: bigint): bigint => (t < 0n ? -t : t);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

export function compareRows(set: RunBookSetResponse, engine: string): CompareView {
  const rows = set.results.map((r) => rowOf(r, engine));
  // |share| descending, then |Δ| descending (a tie under a tenth still ranks by contribution), then wire order (a stable sort).
  const points = rows
    .filter((r) => r.kind === "point")
    .sort((a, b) => compareBig(abs(b.shareTenths ?? 0n), abs(a.shareTenths ?? 0n)) || compareBig(abs(b.deltaUsd ?? 0n), abs(a.deltaUsd ?? 0n)));
  const rest = rows.filter((r) => r.kind !== "point");
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
