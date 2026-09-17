// History's one view model (plan 2026-09-16 R1–R4, R6): the verdict header,
// the identity chips, the four newest-point tiles, the chart's finding line
// and the drawer's doctrine, decided once from one engine's series reading.
// The headline IS `observatoryTakeaway(...)` and the finding IS
// `gridReadingLine(...)` — the module's own sentences, verbatim, so the header
// and the reading cannot drift. Every figure passes the wire guards before it
// is formatted; a bucket the rollup withheld or never captured is a dashed
// tile with the gap's word, never a 0. The surface prints this and decides
// nothing twice.
import { EM_DASH } from "./format";
import { humanUsd } from "./human-usd";
import { engineName } from "./inspector-headline";
import { LEGACY } from "./inspector-position";
import { refused, sentence, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import type { ObservatoryEngine, ObservatorySeriesResponse } from "./observatory-data";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeRange,
  describeStride,
  gridReadingLine,
  METRIC_LABELS,
  observatoryTakeaway,
  seriesNewestPoint,
  type BucketAxis,
  type BucketEntry,
  type BucketMetric,
} from "./observatory-series";
import { groupInt } from "./prose";
import { isWirePopulation, isWireScale, wireBigInt } from "./wireGuard";

export type HistoryState = "loading" | "degraded" | "unavailable" | "ok";
export type HistoryTileKey = "debt" | "collateral" | "accounts" | "liquidatable";

export interface HistoryTile {
  readonly key: HistoryTileKey;
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone: "neutral" | "refused";
}

export interface HistoryView {
  readonly state: HistoryState;
  /** "History · Cash" | "History · Aave v3 market (legacy)". */
  readonly kicker: string;
  /** Emphasis = observatoryTakeaway(...) or the refusal sentence; rest ""; the dek is the one-line method. */
  readonly headline: LabHeadline;
  /** Engine · Stride · Range · Buckets ("165 captured · 1 withheld · 2 absent") · Served. */
  readonly chips: LabChip[];
  /** The four metrics' newest captured points; empty until the series answers. */
  readonly tiles: readonly HistoryTile[];
  /** gridReadingLine(...) — the chart card's finding line; null until the series answers. */
  readonly finding: string | null;
  /** The chart's accessible name for the selected metric; null until the series answers. */
  readonly chartLabel: string | null;
  /** The drawer's paragraphs, verbatim: the intro, the chart's method notes, then the wire's own notes. */
  readonly doctrine: readonly string[];
}

export interface HistoryReading {
  readonly engine: ObservatoryEngine;
  readonly metric: BucketMetric;
  readonly phase: "loading" | "ok" | "degraded" | "error";
  readonly response: ObservatorySeriesResponse | null;
  /** The degraded envelope's own message, or the error's; null otherwise. */
  readonly message: string | null;
}

/** The dek (plan R3): the one clause the law keeps visible above the fold. */
export const HISTORY_DEK = "One engine per view; a missing hour is a hole, never a zero.";

/** The intro paragraph — drawer doctrine (R3), verbatim. */
export const HISTORY_INTRO =
  "How each engine's book has moved, hour by hour, in a record that outlives batch retention. An hour with no complete batch renders as a hole, which is never smoothed over and never drawn as a zero; one engine per view, never combined onto one axis.";

/** The chart's method notes — the legend's three marks, the two drawing notes, the source — verbatim. */
export const HISTORY_METHOD: readonly string[] = [
  "captured buckets · the line never interpolates across a gap",
  "absent bucket · no complete batch in this bucket",
  "withheld bucket · the book was refused, so totals are null and never 0",
  "zero floor drawn · the scale never crops it away",
  "click any bucket for its full record",
  "source · observatory_points rollup (points survive batch retention; batch + materialization identity retained by the rollup)",
];

export const HISTORY_DOCTRINE: readonly string[] = [HISTORY_INTRO, ...HISTORY_METHOD];

/** What a degraded rollup means for this deployment: a fact about the deployment, never an empty history. */
export const HISTORY_DEGRADED_NOTE =
  "this deployment's database predates the observatory rollup (migration 00016): the durable series does not exist here yet. that is a fact about the deployment, and it is never rendered as an empty history, a flat line, or a zero. live per-batch posture still exists on the Book.";

/** An unfetched record is never shown as an empty one. */
export const HISTORY_UNAVAILABLE_CLAUSE = "The record is unavailable, and none of it is being shown as empty.";

/** A series whose scale is outside the wire contract: no figure on it prints at any other scale than its own. */
export const HISTORY_UNREADABLE_SCALE = "The series states an unreadable value scale (usd_decimals).";

export interface HistoryTileSpec {
  readonly key: HistoryTileKey;
  readonly metric: BucketMetric;
  readonly label: string;
}

/** The four tiles, in reading order (plan R4): the same four in every state. */
export const HISTORY_TILES: readonly HistoryTileSpec[] = [
  { key: "debt", metric: "debt_usd", label: "Debt" },
  { key: "collateral", metric: "collateral_usd", label: "Collateral" },
  { key: "accounts", metric: "accounts", label: "Accounts" },
  { key: "liquidatable", metric: "liquidatable_positions", label: "Liquidatable positions" },
];

/** The engine as the sentences name it: the legacy market takes its article. */
const named = (engine: ObservatoryEngine): string =>
  engine === LEGACY ? `the ${engineName(engine)}` : engineName(engine);

const engineChip = (engine: ObservatoryEngine): LabChip => ({ label: "Engine", value: engineName(engine), title: engine });

const dashed = (spec: HistoryTileSpec, sub: string): HistoryTile => ({
  key: spec.key,
  label: spec.label,
  value: EM_DASH,
  sub,
  tone: "refused",
});

/**
 * The gap's word for a metric that plots nothing at the newest bucket: the
 * bucket was withheld, no complete batch existed, or the served bucket states
 * this metric as null (null is not zero).
 */
function gapWord(last: BucketEntry): string {
  if (last.kind === "withheld") return "withheld";
  if (last.kind === "absent") return "no complete batch";
  return "not stated";
}

/**
 * One tile: the metric's newest captured point, exactly when that point IS the
 * newest bucket on the axis (`seriesNewestPoint(...).atNewestBucket`). An
 * older figure never stands in for a newest bucket that refused or captured
 * nothing — that tile is dashed with the gap's word. Money is the Book's tier
 * at the classified scale after the decimal passes its guard; populations
 * after theirs. (The module's own sentences read the newest counts through
 * the throwing read first, so an out-of-contract count lands at the route
 * boundary before any tile is decided — the same posture the old page held.)
 */
function tileOf(
  spec: HistoryTileSpec,
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  scale: number,
): HistoryTile {
  const last = axis.entries[axis.entries.length - 1];
  if (last === undefined) return dashed(spec, "no complete batch");
  const series = buildMetricSeries(axis, response, spec.metric);
  const newest = seriesNewestPoint(axis, response, spec.metric, series);
  if (newest === null || !newest.atNewestBucket || last.point === null) return dashed(spec, gapWord(last));
  const point = last.point;
  const sub = `bucket ${point.bucket_start}`;
  if (spec.metric === "debt_usd" || spec.metric === "collateral_usd") {
    const raw = spec.metric === "debt_usd" ? point.debt_usd : point.collateral_usd;
    const value = raw === null ? null : wireBigInt(raw);
    if (value === null) return dashed(spec, "unreadable");
    return { key: spec.key, label: spec.label, value: humanUsd(value, scale), sub, tone: "neutral" };
  }
  const raw = spec.metric === "accounts" ? point.accounts : point.liquidatable_positions;
  if (!isWirePopulation(raw)) return dashed(spec, "unreadable");
  return { key: spec.key, label: spec.label, value: groupInt(raw), sub, tone: "neutral" };
}

/** The identity strip of an answered series: the tally is warn-toned whenever a hole exists. */
function okChips(engine: ObservatoryEngine, response: ObservatorySeriesResponse, axis: BucketAxis): LabChip[] {
  const holes = axis.withheldCount > 0 || axis.absentCount > 0;
  return [
    engineChip(engine),
    { label: "Stride", value: describeStride(response.step_seconds) },
    { label: "Range", value: describeRange(response.from, response.to) },
    {
      label: "Buckets",
      value: `${String(axis.capturedCount)} captured · ${String(axis.withheldCount)} withheld · ${String(axis.absentCount)} absent`,
      tone: holes ? "warn" : "ok",
    },
    // The envelope carries served_at and no age: the wire's own instant, verbatim, never a browser-clock age.
    { label: "Served", value: response.served_at },
  ];
}

export function deriveHistoryView(reading: HistoryReading): HistoryView {
  const kicker = `History · ${engineName(reading.engine)}`;
  const base = { kicker, tiles: [], finding: null, chartLabel: null, doctrine: HISTORY_DOCTRINE } as const;
  if (reading.phase === "loading") {
    return {
      ...base,
      state: "loading",
      headline: refused(`Loading the history of ${named(reading.engine)}…`, HISTORY_DEK),
      chips: [engineChip(reading.engine), { label: "Buckets", value: "pending", tone: "refused" }],
    };
  }
  if (reading.phase === "degraded") {
    return {
      ...base,
      state: "degraded",
      headline: refused(
        `The durable rollup for ${named(reading.engine)} is unavailable.`,
        sentence(reading.message ?? "the service named no reason"),
      ),
      chips: [engineChip(reading.engine), { label: "Rollup", value: "unavailable", tone: "refused" }],
      doctrine: [...HISTORY_DOCTRINE, HISTORY_DEGRADED_NOTE],
    };
  }
  if (reading.phase === "error" || reading.response === null) {
    return {
      ...base,
      state: "unavailable",
      headline: refused(
        `The history of ${named(reading.engine)} could not be fetched.`,
        `${sentence(reading.message ?? "the series answered without a body")} ${HISTORY_UNAVAILABLE_CLAUSE}`,
      ),
      chips: [engineChip(reading.engine), { label: "Record", value: "unavailable", tone: "refused" }],
    };
  }
  const response = reading.response;
  // The scale is classified before any figure is formatted at it: every money string on the page (the takeaway,
  // the tiles, the chart's labels) would otherwise reach the formatter's own throw. A record whose scale is
  // outside the contract cannot be read, and the page says so by name instead of unmounting.
  if (!isWireScale(response.usd_decimals)) {
    return {
      ...base,
      state: "unavailable",
      headline: refused(
        `The history of ${named(reading.engine)} cannot be read.`,
        `${HISTORY_UNREADABLE_SCALE} ${HISTORY_UNAVAILABLE_CLAUSE}`,
      ),
      chips: [engineChip(reading.engine), { label: "Record", value: "unreadable", tone: "refused" }],
    };
  }
  const scale = response.usd_decimals;
  const axis = buildBucketAxis(response);
  const newest = axis.newestPointIndex >= 0 ? (axis.entries[axis.newestPointIndex]?.point ?? null) : null;
  // The data answered when a captured bucket backs the newest row; a withheld newest bucket or a window with no
  // wire row is a refusal the takeaway states in its own words (R2).
  const answered = newest !== null && !newest.refused;
  return {
    state: "ok",
    kicker,
    headline: { emphasis: observatoryTakeaway(response, axis), rest: "", tone: answered ? "ok" : "refused", dek: HISTORY_DEK },
    chips: okChips(reading.engine, response, axis),
    tiles: HISTORY_TILES.map((spec) => tileOf(spec, axis, response, scale)),
    finding: gridReadingLine(response, axis),
    chartLabel: `${METRIC_LABELS[reading.metric]} for ${engineName(reading.engine)} across rollup buckets`,
    doctrine: [...HISTORY_DOCTRINE, ...response.notes],
  };
}
