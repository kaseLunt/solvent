// History's one view model: the verdict header, the identity chips, the four
// newest-point tiles, the chart's finding line and the drawer's doctrine,
// decided once from one engine's series reading. The headline and the dek ARE
// `observatoryTakeaway(...)`'s parts and the finding IS `gridReadingLine(...)`
// — the module's own sentences, by identity, so the header and the reading
// cannot drift. A statement of record wears ink: an answered series is
// `neutral`, a refusal is dashed, and a hole's severity rides the census chip,
// never the headline's colour. Every figure passes the wire guards before it
// is formatted; a bucket the rollup withheld or never captured is a dashed
// tile with the gap's word, never a 0. The surface prints this and decides
// nothing twice.
import { EM_DASH, formatBlock, truncateAddress } from "./format";
import { humanUsd } from "./human-usd";
import { engineName } from "./inspector-headline";
import { refused, sentence, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import type {
  ObservatoryEngine,
  ObservatorySeriesPoint,
  ObservatorySeriesResponse,
  RateIndex,
} from "./observatory-data";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeRange,
  describeStride,
  displayMetric,
  gridReadingLine,
  METRIC_LABELS,
  named,
  observatoryTakeaway,
  pointDetailTakeaway,
  seriesNewestPoint,
  type BucketAxis,
  type BucketEntry,
  type BucketKind,
  type BucketMetric,
} from "./observatory-series";
import { groupInt } from "./prose";
import { isWirePopulation, isWireScale, readWirePopulation, wireBigInt } from "./wireGuard";

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
  /** Emphasis, rest and dek = observatoryTakeaway(...)'s parts, or a refusal sentence with its own dek; tone neutral when the series answered, refused otherwise. */
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

/**
 * The engines the switch offers, in the page's order: Cash first — it is the product's book, and the page opens on
 * it. Every engine the contract serves is here exactly once; one engine per view, never combined.
 */
export const HISTORY_ENGINES = ["debt_manager", "aave_v3_etherfi"] as const satisfies readonly ObservatoryEngine[];

/** The loading dek says what will be here; nothing is counted before the series answers. */
export const HISTORY_LOADING_DEK = "The hourly record of this engine's debt, collateral, accounts and liquidatable positions.";

/** After the service's own message: a degraded rollup is a fact about the deployment, and the live figures have a page. */
export const HISTORY_DEGRADED_CLAUSE = "That is a fact about this deployment, not an empty history; live figures are on the Book.";

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
      headline: refused(`Loading the history of ${named(reading.engine)}…`, HISTORY_LOADING_DEK),
      chips: [engineChip(reading.engine), { label: "Buckets", value: "pending", tone: "refused" }],
    };
  }
  if (reading.phase === "degraded") {
    return {
      ...base,
      state: "degraded",
      headline: refused(
        `No hourly history exists for ${named(reading.engine)} on this deployment yet.`,
        `${sentence(reading.message ?? "the service named no reason")} ${HISTORY_DEGRADED_CLAUSE}`,
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
  // The series answered when its latest recorded hour stated a debt figure. A record is ink, never the colour of a
  // health verdict — holes included: their severity is the census chip's. A withheld latest hour, one that states no
  // debt, or a window with no recorded hour is a refusal the takeaway states in its own words.
  const takeaway = observatoryTakeaway(response, axis, reading.engine);
  return {
    state: "ok",
    kicker,
    headline: { emphasis: takeaway.emphasis, rest: takeaway.rest, tone: takeaway.answered ? "neutral" : "refused", dek: takeaway.dek },
    chips: okChips(reading.engine, response, axis),
    tiles: HISTORY_TILES.map((spec) => tileOf(spec, axis, response, scale)),
    finding: gridReadingLine(response, axis),
    chartLabel: `${METRIC_LABELS[reading.metric]} for ${engineName(reading.engine)} across rollup buckets`,
    doctrine: [...HISTORY_DOCTRINE, ...response.notes],
  };
}

// ---------------------------------------------------------------------------
// The chart's two hole marks and their words — the key beside the finding line
// maps each glyph the plot draws to its meaning. The six method notes stay in
// the drawer (R3); this is the one thing no other element on the page states.
// ---------------------------------------------------------------------------

export interface HistoryMark {
  readonly mark: "absent" | "withheld";
  readonly label: string;
}

export const HISTORY_MARKS: readonly HistoryMark[] = [
  { mark: "absent", label: "no complete batch this hour" },
  { mark: "withheld", label: "batch present, figures withheld" },
];

// ---------------------------------------------------------------------------
// The bucket record (plan R5: a card, not a list). Every sentence the record
// prints is decided here; HistoryPoint prints it. Provenance on detail, not
// buried in a tooltip: the bucket's as-of, the engine's balances watermark at
// capture time, the refusal posture, the exact totals (null renders as an em
// dash, NEVER 0), and the rate-index snapshot where every index carries its
// OWN as-of block. An ABSENT bucket gets the same record, stating the absence
// by name — the rollup captured nothing in that hour, and the record says so
// instead of pretending the bucket never existed.
// ---------------------------------------------------------------------------

export interface RecordRow {
  readonly key: string;
  /** The row's name. */
  readonly label: string;
  /** The row's leading text. */
  readonly value: string;
  /** The dim clause after the value, carrying its own leading separator; null when the value stands alone. */
  readonly note: string | null;
  /** refused: the withheld state word (a pill, the wire code as its title); crit: a biting reorg disclosure. */
  readonly tone: "neutral" | "crit" | "refused";
  /** The value is an exact figure or identifier, set in mono. */
  readonly mono: boolean;
  readonly testId: string | null;
}

export interface RateRow {
  readonly key: string;
  readonly kind: string;
  /** The asset's full address (the cell's title). */
  readonly asset: string;
  /** The wire's symbol, or the truncated address when it named none. */
  readonly assetName: string;
  readonly assetShort: string;
  /** The wire's exact decimal string, verbatim. */
  readonly value: string;
  /** The scale from the closed per-kind vocabulary, or the unstated word. */
  readonly scale: string;
  readonly scaleStated: boolean;
  /** The index's OWN as-of block, grouped. */
  readonly block: string;
  readonly note: string;
}

export interface RecordColumn {
  readonly key: keyof RateRow;
  readonly header: string;
  readonly align?: "left" | "right";
}

/** The rate snapshot's columns, in reading order. */
export const HISTORY_RATE_COLUMNS: readonly RecordColumn[] = [
  { key: "kind", header: "rate index" },
  { key: "assetName", header: "asset" },
  { key: "value", header: "value (raw decimal)", align: "right" },
  { key: "scale", header: "scale" },
  { key: "block", header: "its OWN as-of block", align: "right" },
  { key: "note", header: "note" },
];

export interface PointRecord {
  readonly title: string;
  readonly bucket: string;
  readonly kind: BucketKind;
  /** pointDetailTakeaway(entry) — the record's one-line state. */
  readonly takeaway: string;
  /** The absent bucket's paragraph; null when a wire row exists. */
  readonly absentNote: string | null;
  /** The wire code behind the withheld state word; null otherwise. */
  readonly refusalCode: string | null;
  /** The rows visible without a click: the state, the totals, and every hazard exactly when it bites. */
  readonly answer: readonly RecordRow[];
  /** The counted fold's summary; null for an absent bucket (nothing to fold). */
  readonly forensicSummary: string | null;
  /** Pure provenance, plus the reorg and sweep rows exactly when they carry no hazard. */
  readonly forensic: readonly RecordRow[];
  readonly rates: readonly RateRow[];
  /** Printed where the rate table would stand when the bucket carries no snapshot; null when it does. */
  readonly ratesEmpty: string | null;
  /** True when a rate's scale is unstated: the table is a disclosure and stands OUTSIDE the fold. */
  readonly ratesOutside: boolean;
  readonly provenance: string;
}

export const HISTORY_RECORD_TITLE = "Bucket record";

export const HISTORY_ABSENT_NOTE =
  "The rollup captured nothing for this hour, because no complete risk batch existed to observe. Nobody refused it. An absent bucket is a hole in the record, stated by name: nothing is interpolated across it, and it never renders as zero.";

export const HISTORY_PROVENANCE =
  "provenance: this point was captured from the newest COMPLETE risk batch in its bucket (the observatory_points rollup law) and survives batch retention. rate values are the wire's exact decimal strings, rendered verbatim.";

/** The clauses after a value, each carrying the separator it follows the value with. */
const NULL_TOTAL_CLAUSE = ", null because the book was withheld and never zero";
const WITHHELD_STATE_CLAUSE = "the engine's whole book was withheld at capture time";
const WATERMARK_CLAUSE = " (the engine's balances watermark at capture, never a chain head observed later)";
const BATCH_CLAUSE = " (the COMPLETE batch this bucket observed; the batch itself may since have been pruned by retention)";
const KEY_CLAUSE = " (copied at write time, so the attribution survives retention)";
const REORG_CLAUSE = " (the stamp pair copied from the observed batch's watermark vector)";
const SWEEP_UNRECORDED_CLAUSE =
  " unrecorded: this point predates migration 00018 and its batch was pruned before the stamp could be recovered. the record is missing here, and it is not a claim that the engine has no sweeper.";
const SWEEP_NONE_CLAUSE = " (recorded: this engine has no collateral sweep, so its balances are event-derived)";
const SWEEP_STAMP_CLAUSE =
  " · the observed batch's own sweep stamp; the liquidatable count above aggregates THIS sweep-cut, not the bucket's block clock. last successful write ";
const UNSTATED_SCALE = "unstated · kind outside the known vocabulary";

const plain = (key: string, label: string, value: string, note: string | null = null): RecordRow => ({
  key,
  label,
  value,
  note,
  tone: "neutral",
  mono: false,
  testId: null,
});

/**
 * The sweep stamp (the count's collateral clock), three states, each honest:
 * UNRECORDED (a pre-00018 point whose batch was pruned before the backfill —
 * the record is missing, which is not a claim that the engine has no sweeper),
 * recorded NONE (the engine has no collateral sweep and the record says so),
 * or the observed batch's own stamp. Sweep tallies are wire populations,
 * guarded reads.
 */
function sweepRowOf(point: ObservatorySeriesPoint): RecordRow {
  const base = { key: "sweep", label: "sweep stamp (the count's collateral clock)", tone: "neutral" as const, testId: "history-point-sweep" };
  if (!point.sweep_recorded) return { ...base, value: EM_DASH, note: SWEEP_UNRECORDED_CLAUSE, mono: false };
  if (point.sweep === null) return { ...base, value: "none", note: SWEEP_NONE_CLAUSE, mono: false };
  const s = point.sweep;
  const value =
    `${String(readWirePopulation(s.rows, "sweep.rows"))} swept · ` +
    `${String(readWirePopulation(s.failed, "sweep.failed"))} failed · ` +
    `gen ${String(readWirePopulation(s.generation, "sweep.generation"))}` +
    (s.generation_open ? " (pass in flight)" : " (pass complete)");
  const lastWrite = s.max_updated_at === null ? `${EM_DASH} (no successful write recorded)` : s.max_updated_at;
  return { ...base, value, note: `${SWEEP_STAMP_CLAUSE}${lastWrite}`, mono: true };
}

/** One rate index of the snapshot: the wire's own strings; a scale outside the closed vocabulary is named unstated. */
function rateRowOf(rate: RateIndex): RateRow {
  const short = truncateAddress(rate.asset);
  const stated = rate.scale !== "unstated";
  return {
    key: `${rate.kind}-${rate.asset}`,
    kind: rate.kind,
    asset: rate.asset,
    assetName: rate.symbol ?? short,
    assetShort: short,
    value: rate.value,
    scale: stated ? rate.scale : UNSTATED_SCALE,
    scaleStated: stated,
    block: formatBlock(rate.as_of_block),
    note: rate.note,
  };
}

/**
 * The selected bucket's full record. Hazard fences: three rows are
 * disclosures, not provenance, and a record carrying one keeps it in the
 * ANSWER, outside the counted fold — unacked reorg epochs at compute, an
 * UNRECORDED sweep stamp, a rate whose scale is unstated. Both epoch stamps
 * pass the population guard BEFORE the subtraction that decides (and later
 * prints) the unacked disclosure; every count passes it before it prints.
 */
export function pointRecord(entry: BucketEntry, response: ObservatorySeriesResponse): PointRecord {
  const base = {
    title: HISTORY_RECORD_TITLE,
    bucket: entry.bucketStart,
    kind: entry.kind,
    takeaway: pointDetailTakeaway(entry),
    provenance: HISTORY_PROVENANCE,
  };
  const point = entry.point;
  if (point === null) {
    return {
      ...base,
      absentNote: HISTORY_ABSENT_NOTE,
      refusalCode: null,
      answer: [],
      forensicSummary: null,
      forensic: [],
      rates: [],
      ratesEmpty: null,
      ratesOutside: false,
    };
  }
  // The four totals print through the one chokepoint the chart's labels use: grouped money at the engine's own
  // scale, grouped counts after the population guard, an em dash for a null — never 0.
  const total = (metric: BucketMetric): string => displayMetric(point, metric, response.usd_decimals);

  const maxEpochAtCompute = readWirePopulation(point.max_epoch_at_compute, "max_epoch_at_compute");
  const ackedEpoch = readWirePopulation(point.acked_epoch, "acked_epoch");
  const unacked = maxEpochAtCompute - ackedEpoch > 0;
  const sweepUnrecorded = !point.sweep_recorded;
  const rates = point.rates.map(rateRowOf);
  const ratesOutside = rates.some((rate) => !rate.scaleStated);

  const reorgRow: RecordRow = {
    key: "reorg",
    label: "reorg posture at compute",
    value: unacked
      ? `${String(maxEpochAtCompute - ackedEpoch)} unacked epoch(s) · acked ${String(ackedEpoch)} of ${String(maxEpochAtCompute)}`
      : "none unacked",
    note: REORG_CLAUSE,
    tone: unacked ? "crit" : "neutral",
    mono: false,
    testId: "history-point-epochs",
  };
  const sweepRow = sweepRowOf(point);
  const code = point.refusal_code ?? "unnamed";
  const stateRow: RecordRow = point.refused
    ? { key: "state", label: "state", value: "withheld", note: ` · ${code} · ${WITHHELD_STATE_CLAUSE}`, tone: "refused", mono: false, testId: null }
    : plain("state", "state", "captured");

  const answer: RecordRow[] = [
    stateRow,
    { ...plain("debt", "debt (usd)", total("debt_usd"), point.debt_usd === null ? NULL_TOTAL_CLAUSE : null), mono: true },
    { ...plain("collateral", "collateral (usd)", total("collateral_usd"), point.collateral_usd === null ? NULL_TOTAL_CLAUSE : null), mono: true },
    plain("accounts", "accounts", total("accounts")),
    plain("refused-rows", "refused position rows", groupInt(readWirePopulation(point.refused_positions, "refused_positions"))),
    plain("liquidatable", "liquidatable positions", total("liquidatable_positions")),
    // Hazard rows surface in the answer, exactly when they bite.
    ...(unacked ? [reorgRow] : []),
    ...(sweepUnrecorded ? [sweepRow] : []),
  ];
  const forensic: RecordRow[] = [
    { ...plain("bucket", "bucket (its own as-of)", point.bucket_start), mono: true },
    plain("watermark", "watermark", `block ${formatBlock(point.last_block)}`, WATERMARK_CLAUSE),
    { ...plain("batch", "observed batch", `#${String(readWirePopulation(point.batch_id, "batch_id"))}`, BATCH_CLAUSE), testId: "history-point-batch" },
    { ...plain("key", "materialization key", point.materialization_key, KEY_CLAUSE), mono: true, testId: "history-point-mkey" },
    ...(unacked ? [] : [reorgRow]),
    ...(sweepUnrecorded ? [] : [sweepRow]),
  ];
  // What the fold holds, COUNTED in its own summary: pure provenance (bucket, watermark, batch, key) plus the
  // reorg/sweep rows and the rate table exactly when they carry no hazard.
  const forensicRowCount = 4 + (unacked ? 0 : 1) + (sweepUnrecorded ? 0 : 1);
  const ratesSuffix = ratesOutside ? "" : rates.length > 0 ? " + the rate snapshot" : " + the rate-snapshot note";
  return {
    ...base,
    absentNote: null,
    refusalCode: point.refused ? code : null,
    answer,
    forensicSummary: `${String(forensicRowCount)} provenance row(s)${ratesSuffix}`,
    forensic,
    rates,
    ratesEmpty:
      rates.length > 0
        ? null
        : `no rate snapshot was captured with this bucket${point.refused ? " (the whole book was withheld)" : ""}.`,
    ratesOutside,
  };
}
