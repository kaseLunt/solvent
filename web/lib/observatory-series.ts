// The observatory bucket-axis builder: one engine's rollup points, turned
// into chart-ready series WITHOUT ever fabricating a bucket the rollup did
// not capture.
//
// The bucket laws, applied to GET /v1/observatory/series:
//
//   - a point derives ONLY from the newest COMPLETE risk batch the rollup
//     observed in its bucket — a bucket with no wire row is ABSENT and enters
//     the axis as a GAP saying "no complete batch was observed in this bucket"
//     (none existed at the rollup's ticks, or the rollup did not tick or could
//     not write: the wire cannot tell these apart, so the page claims only the
//     observation), never an interpolated value and never a flat line;
//   - a WITHHELD bucket (refused: true) is a row in the record — the engine's
//     whole book was refused at capture time. It is a GAP carrying its named
//     refusal code; its null totals render as em dashes, NEVER 0;
//   - a null metric on a served bucket is a GAP saying null-is-not-zero;
//   - a money metric that FAILS ITS WIRE GUARD (not the contract's exact
//     decimal STRING — a malformed string, or a JSON number of any sign or
//     size) is a GAP of its own kind — UNREADABLE: not an absent hour, not
//     a withheld one, never zero and never a throw. It passes the guard
//     before it meets a formatter, here and in every sentence. Which guard a
//     value answers to is decided by its METRIC, never by its JavaScript
//     type: money never enters the count path, nor a count the money path;
//   - `step_seconds` is the stride the server actually applied: at most one
//     recorded hour per stride, each VERBATIM, never an average (a recorded
//     hour is served only when it starts at least one stride after the last
//     one served, so a hole shifts the grid). Gap detection uses the applied
//     stride, so downsampled series don't invent holes;
//   - values are DISPLAY-PRECISION geometry only; exact decimal strings
//     belong in adjacent mono text (displayMetric), grouped as money and
//     counts always are;
//   - the headline (observatoryTakeaway) speaks the reader's tier — compact
//     money, grouped counts, an instant read from the wire's own UTC fields —
//     about ONE engine at ONE scale, and a missing or withheld hour is named
//     as such, never as a zero; the chart's caption (gridReadingLine) states
//     the recorded span and what a point and a gap are, and no figure.
//
// Pure functions — pinned by tests/unit/observatory-series.spec.ts.

import { formatUnits } from "@solvent/client";
import { renderUsdAmount } from "./book-format";
import { EM_DASH, formatBlock } from "./format";
import { humanUsd } from "./human-usd";
import { humanUtc } from "./human-utc";
import { bookMoneyAt } from "./money";
import type {
  ObservatoryEngine,
  ObservatorySeriesPoint,
  ObservatorySeriesResponse,
} from "./observatory-data";
import { engineInProse, groupInt, plural } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal, readWirePopulation, wireBigInt } from "./wireGuard";

/** The rollup's native bucket (the contract: hourly). */
export const NATIVE_BUCKET_SECONDS = 3600;

/**
 * captured  — a wire row with refused: false (the engine's book was served);
 * withheld  — a wire row with refused: true (the whole book was refused —
 *             totals are null FOR THAT REASON, never 0);
 * absent    — no wire row: no complete batch was observed in this bucket.
 *             Nothing was recorded, so nothing is drawn — never interpolated.
 */
export type BucketKind = "captured" | "withheld" | "absent";

export interface BucketEntry {
  /** ISO bucket start. For captured/withheld this is the wire's own string. */
  bucketStart: string;
  kind: BucketKind;
  /** The wire point, VERBATIM. Null exactly when the bucket is absent. */
  point: ObservatorySeriesPoint | null;
}

export interface BucketAxis {
  /** Oldest first, absent buckets filled in at the applied stride. */
  entries: BucketEntry[];
  /** The stride gap detection used: step_seconds when applied, else native. */
  strideSeconds: number;
  capturedCount: number;
  withheldCount: number;
  absentCount: number;
  /** Index into `entries` of the newest bucket backed by a wire row; -1 when none. */
  newestPointIndex: number;
}

/** The stride the server applied — `step_seconds`, else the native bucket. */
export function effectiveStrideSeconds(stepSeconds: number | null): number {
  if (stepSeconds === null || !Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    return NATIVE_BUCKET_SECONDS;
  }
  return stepSeconds;
}

/** ISO without a fabricated milliseconds field (buckets are whole seconds). */
function isoAt(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build the bucket axis: wire points (sorted oldest first — the contract's
 * order, applied deterministically) with ABSENT buckets inserted wherever the
 * applied stride expected a bucket and the rollup captured none. Absent
 * buckets are inserted only BETWEEN captured rows: the axis never speculates
 * about time before the first capture or after the last one.
 */
export function buildBucketAxis(response: ObservatorySeriesResponse): BucketAxis {
  const strideSeconds = effectiveStrideSeconds(response.step_seconds);
  const strideMs = strideSeconds * 1000;
  const points = [...response.points].sort(
    (a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start),
  );

  const entries: BucketEntry[] = [];
  let prevMs: number | null = null;
  for (const point of points) {
    const ms = Date.parse(point.bucket_start);
    if (prevMs !== null && Number.isFinite(ms) && ms > prevMs) {
      for (let expected = prevMs + strideMs; expected < ms; expected += strideMs) {
        entries.push({ bucketStart: isoAt(expected), kind: "absent", point: null });
      }
    }
    entries.push({
      bucketStart: point.bucket_start,
      kind: point.refused ? "withheld" : "captured",
      point,
    });
    if (Number.isFinite(ms)) prevMs = ms;
  }

  let capturedCount = 0;
  let withheldCount = 0;
  let absentCount = 0;
  let newestPointIndex = -1;
  entries.forEach((entry, index) => {
    if (entry.kind === "captured") capturedCount += 1;
    else if (entry.kind === "withheld") withheldCount += 1;
    else absentCount += 1;
    if (entry.point !== null) newestPointIndex = index;
  });

  return { entries, strideSeconds, capturedCount, withheldCount, absentCount, newestPointIndex };
}

/** The four charted metrics of a bucket row. */
export type BucketMetric = "debt_usd" | "collateral_usd" | "accounts" | "liquidatable_positions";

/**
 * The noun a liquidatable count takes on its engine. On Cash one position is one account (the risk tables key a
 * position by batch, engine and account), so Cash's reader copy says "accounts"; the legacy market keeps "positions".
 */
const liquidatableNoun = (engine: string): string => (engine === "debt_manager" ? "accounts" : "positions");

/** A metric as a label names it — a toggle, a record key — in sentence case, the currency stated once. */
export function metricLabel(metric: BucketMetric, engine: string): string {
  switch (metric) {
    case "debt_usd":
      return "Debt (USD)";
    case "collateral_usd":
      return "Collateral (USD)";
    case "accounts":
      return "Accounts";
    case "liquidatable_positions":
      return `Liquidatable ${liquidatableNoun(engine)}`;
  }
}

/** A metric as a sentence says it, lower case: "debt rose by $1.8M", "liquidatable accounts rose by 1". */
export function metricWord(metric: BucketMetric, engine: string): string {
  switch (metric) {
    case "debt_usd":
      return "debt";
    case "collateral_usd":
      return "collateral";
    case "accounts":
      return "accounts";
    case "liquidatable_positions":
      return `liquidatable ${liquidatableNoun(engine)}`;
  }
}

/**
 * gap vocabulary, per entry (null where a finite value is plotted):
 *   withheld   — the engine's book was refused in this bucket;
 *   absent     — no complete batch was observed in this bucket;
 *   null       — the bucket was served but this metric is null (not zero);
 *   unreadable — the bucket was served and states this metric, but the value
 *                fails its wire guard (not zero, and not one of the above).
 */
export type GapKind = "withheld" | "absent" | "null" | "unreadable";

/** The word for a figure that fails its wire guard: the tile's sub, the chart's mark, the record's clause. */
export const UNREADABLE = "unreadable";

export interface BucketMetricSeries {
  /** Geometry, aligned with axis.entries. Null is a GAP — never interpolated. */
  values: (number | null)[];
  /** Per-entry hover text: value + provenance, or the gap's named reason. */
  titles: string[];
  /** Aligned gap vocabulary; null where a finite value exists. */
  gapKinds: (GapKind | null)[];
}

/**
 * The wire metric as it arrived — UNJUDGED. The contract says USD metrics are exact decimal strings and the other
 * two are populations, but a body is cast on its way here, not validated: what the value is stays unknown until
 * the metric's own guard has read it.
 */
function rawMetric(point: ObservatorySeriesPoint, metric: BucketMetric): unknown {
  switch (metric) {
    case "debt_usd":
      return point.debt_usd;
    case "collateral_usd":
      return point.collateral_usd;
    case "accounts":
      return point.accounts;
    case "liquidatable_positions":
      return point.liquidatable_positions;
  }
}

/**
 * Which guard a metric answers to is decided by what the metric IS, never by the JavaScript type its value arrived
 * in: the two USD totals are money (an exact decimal STRING at the series' scale), the other two are populations.
 * A body is cast, not validated, on its way here — money that arrives as a JSON number has been through a float
 * and must not slip into the count path to be plotted unscaled and printed without its "$".
 */
export function isMoneyMetric(metric: BucketMetric): metric is "debt_usd" | "collateral_usd" {
  return metric === "debt_usd" || metric === "collateral_usd";
}

/** True when a served row states a money metric that fails the decimal guard: a figure no formatter may be handed. */
export function metricUnreadable(point: ObservatorySeriesPoint, metric: BucketMetric): boolean {
  if (!isMoneyMetric(metric)) return false;
  const raw = rawMetric(point, metric);
  // Anything a money metric states that is not the contract's decimal string — a malformed string, or a number of
  // any sign or size — is unreadable. Only null is "not stated".
  return raw !== null && !isWireDecimal(raw);
}

/**
 * Exact display string for one metric of one wire row: money grouped at the
 * engine's own scale ("$1,900,000"), a count grouped ("8,552"). A null metric
 * is an em dash — NEVER "0" (a withheld book rendered as zero debt would
 * fabricate the exact reassurance this surface exists to withhold) — and so is
 * a money string that fails the decimal guard: it never reaches the formatter
 * (whose own refusal is a throw), and the caller that prints the dash names
 * which of the two it is (`metricUnreadable`).
 */
export function displayMetric(
  point: ObservatorySeriesPoint,
  metric: BucketMetric,
  usdDecimals: number,
): string {
  const raw = rawMetric(point, metric);
  if (raw === null) return EM_DASH;
  // The two count metrics are wire populations, guarded at THIS one chokepoint — tiles, chart labels and bucket
  // records all read through it — and grouped, as every count the product prints is. The guard judges the value
  // whatever its type, so a count that is not a population is refused here and never scaled as money.
  if (!isMoneyMetric(metric)) return groupInt(readWirePopulation(raw as number, metric));
  if (!isWireDecimal(raw)) return EM_DASH;
  // Money is grouped, always: string surgery on the exact decimal at the engine's own scale, the digits untouched.
  return renderUsdAmount(raw, usdDecimals);
}

/**
 * Display-precision geometry for one metric value. Null = no finite geometry. The path is the METRIC's: money is
 * placed only as a decimal string that passed its guard (the caller has already named anything else a money metric
 * states as its own gap), a count only as a population.
 */
function geometryOf(raw: unknown, metric: BucketMetric, usdDecimals: number): number | null {
  if (raw === null) return null;
  // A count is placed as the population it is, through the count's own guarded read.
  if (!isMoneyMetric(metric)) return readWirePopulation(raw as number, metric);
  if (!isWireDecimal(raw)) return null;
  const n = Number(formatUnits(raw, usdDecimals));
  return Number.isFinite(n) ? n : null;
}

/**
 * One metric across the axis. Titles carry each point's provenance — the
 * bucket's own as-of and the engine's balances watermark at capture time —
 * and each gap's NAMED reason.
 */
export function buildMetricSeries(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
): BucketMetricSeries {
  const values: (number | null)[] = [];
  const titles: string[] = [];
  const gapKinds: (GapKind | null)[] = [];

  for (const entry of axis.entries) {
    if (entry.point === null) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} · no complete batch was observed in this bucket · nothing was recorded; absence is stated, never interpolated`,
      );
      gapKinds.push("absent");
      continue;
    }
    const point = entry.point;
    if (point.refused) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} · Withheld · ${point.refusal_code ?? "unnamed"} @ block ${formatBlock(point.last_block)} · totals are null for that reason, never 0`,
      );
      gapKinds.push("withheld");
      continue;
    }
    const raw = rawMetric(point, metric);
    if (metricUnreadable(point, metric)) {
      // A named hole of its own: the hour was recorded and states this figure, but not as the exact decimal the
      // contract allows. It is drawn as a gap with its own mark — never placed, never zero, never a throw.
      values.push(null);
      titles.push(
        `${entry.bucketStart} · ${metricWord(metric, response.engine)} is ${UNREADABLE} in this bucket: the wire's value is not an exact decimal (unreadable is not zero)`,
      );
      gapKinds.push("unreadable");
      continue;
    }
    const value = geometryOf(raw, metric, response.usd_decimals);
    if (raw === null || value === null) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} · ${metricWord(metric, response.engine)} is null in this bucket (null is not zero)`,
      );
      gapKinds.push("null");
      continue;
    }
    values.push(value);
    titles.push(
      `${entry.bucketStart} · ${metricWord(metric, response.engine)} ${displayMetric(point, metric, response.usd_decimals)} @ block ${formatBlock(point.last_block)} · captured from the newest complete batch in this bucket`,
    );
    gapKinds.push(null);
  }

  return { values, titles, gapKinds };
}

/**
 * The stride in the reader's word — the identity chip's value. The native stride is "hourly"; an applied one is said
 * as the service applies it: a recorded hour is served only when it starts at least one stride after the last one
 * SERVED, so "at most one in every N" — never "every Nth" (a hole shifts the grid).
 */
export function strideWord(stepSeconds: number | null): string {
  if (stepSeconds === null) return "hourly";
  // A served stride is a wire population, guarded at the read.
  const stride = readWirePopulation(stepSeconds, "step_seconds");
  if (stride <= NATIVE_BUCKET_SECONDS) return "hourly";
  return stride % NATIVE_BUCKET_SECONDS === 0
    ? `at most one hour in every ${groupInt(stride / NATIVE_BUCKET_SECONDS)}`
    : `at most one hour per ${groupInt(stride)} seconds`;
}

/** The stride's method sentence — the chip's title and a drawer paragraph. A stride never averages: each hour served is verbatim. */
export function describeStride(stepSeconds: number | null): string {
  if (stepSeconds === null) {
    return "Native hourly record: every recorded hour is served verbatim.";
  }
  // A served stride is a wire population, guarded at the read.
  return `Stride ${String(readWirePopulation(stepSeconds, "step_seconds"))}s: the service serves at most one recorded hour per stride, each verbatim; skipped hours are never averaged.`;
}

/** A range's dash: a spaced en dash (U+2013). An arrow on this product is a link, never a span. */
const RANGE_DASH = " \u2013 ";

/** The served range on the exact layer — the chip's title: the wire's own instants, an absent bound said as unbounded. */
export function describeRange(from: string | null, to: string | null): string {
  return `${from ?? "unbounded"}${RANGE_DASH}${to ?? "unbounded"}`;
}

/**
 * The served range in the reader's words — the chip's face: each bound through humanUtc against the envelope's own
 * served_at, an open start the earliest hour on record and an open end the latest.
 */
export function rangeWords(from: string | null, to: string | null, servedAt: string): string {
  return `${from === null ? "earliest" : humanUtc(from, servedAt)}${RANGE_DASH}${to === null ? "latest" : humanUtc(to, servedAt)}`;
}

/**
 * An axis end's compact form: the reader's instant with its clock dropped ("Aug 1"), printed only where the full
 * ends would run together — the full instant stays the end's title. An instant humanUtc could not read is its own
 * compact form: nothing is cut from text that is not a well-formed instant.
 */
export function compactInstant(words: string): string {
  return words.replace(/, \d{2}:\d{2} UTC$/, "");
}

// ---------------------------------------------------------------------------
// The direct labels the chart draws, derived (never retyped): no figure lives
// only in a hover, and every label says which point it belongs to. The labels
// speak the book register — the tiles' and the headline's tier — and each
// point's exact figure stays one hover away, in its mark's title, and in its
// hour's record.
// ---------------------------------------------------------------------------

/**
 * A labelled point of one metric series: the index into the axis, the drawn
 * geometry at that index, and the exact display string of the SAME wire row
 * through `displayMetric` — the formatter the bucket record prints with, and
 * the string the point's own title carries.
 */
export interface SeriesLabelledPoint {
  /** Index into `axis.entries` / `series.values`. */
  index: number;
  /** The drawn geometry at that index (display precision, GEOMETRY only). */
  value: number;
  /** `displayMetric` of the same wire row — the exact register, never retyped. */
  label: string;
}

/** The word the chart's y-max label opens with: it is the window's highest plotted value, and says so. */
export const PEAK_WORD = "Peak";

/** `seriesMaxPoint`'s result: the highest plotted point, plus the label the chart prints for it. */
export interface SeriesMaxPoint extends SeriesLabelledPoint {
  /** The chart's direct label: "Peak $27.9M" — a bare figure at the plot's left edge reads as the starting value. */
  directLabel: string;
}

/** The money figure a point states, through its guard; null for a count, a null figure or one that fails the guard. */
function moneyOf(point: ObservatorySeriesPoint, metric: BucketMetric): bigint | null {
  if (!isMoneyMetric(metric)) return null;
  const raw = rawMetric(point, metric);
  return raw === null || !isWireDecimal(raw) ? null : wireBigInt(raw);
}

// The book register with extra digits lives in the money module; the chart's labels read it from there.
export { bookMoneyAt };

/** A point's figure at chart altitude: money in the book register (with `extra` digits when two labels collide), a count grouped. */
function bookFigure(point: ObservatorySeriesPoint, metric: BucketMetric, decimals: number, extra = 0): string {
  const money = moneyOf(point, metric);
  if (money !== null) return bookMoneyAt(money, decimals, extra);
  return displayMetric(point, metric, decimals);
}

function labelledPointAt(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
  index: number,
  value: number,
): SeriesLabelledPoint | null {
  const point = axis.entries[index]?.point;
  if (point === null || point === undefined) return null;
  return { index, value, label: displayMetric(point, metric, response.usd_decimals) };
}

/**
 * The point the drawn y-max belongs to. The chart's y-domain is [0, max of
 * finite values] (the zero floor is always drawn), so the max label IS this
 * point's figure — derived from the drawn domain, never invented — named for
 * what it is: the window's PEAK, not its first value. Ties keep the first
 * (oldest) occurrence; null when nothing plots.
 */
export function seriesMaxPoint(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
  series: BucketMetricSeries,
): SeriesMaxPoint | null {
  let bestIndex = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  series.values.forEach((value, index) => {
    if (value !== null && Number.isFinite(value) && value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) return null;
  const point = labelledPointAt(axis, response, metric, bestIndex, bestValue);
  const wire = axis.entries[bestIndex]?.point;
  if (point === null || wire === null || wire === undefined) return null;
  return { ...point, directLabel: `${PEAK_WORD} ${bookFigure(wire, metric, response.usd_decimals)}` };
}

/**
 * `seriesNewestPoint`'s result: the last plotted point, plus the direct
 * label the chart prints at it. ONE-SOURCE LAW, both arms:
 *
 *   - when the last plotted point IS the newest axis entry, `directLabel`
 *     is that hour's figure in the book register;
 *   - when it is NOT (the newest bucket is withheld, or carries this metric
 *     as null or unreadable), `directLabel` is that SAME figure plus a
 *     "(last captured {hour})" qualifier naming which row the figure
 *     belongs to. The tile above shows the newest bucket's dash and its
 *     word, and the chart must never print an older number unqualified
 *     beside it.
 */
export interface SeriesNewestPoint extends SeriesLabelledPoint {
  /** True exactly when the last plotted point IS the newest axis entry. */
  atNewestBucket: boolean;
  /** The chart's direct label: the figure, or the figure + the qualifier. */
  directLabel: string;
}

/** The qualifier that names which hour an older label belongs to, in the reader's words. */
const lastCaptured = (bucketStart: string, servedAt: string): string => `(last captured ${humanUtc(bucketStart, servedAt)})`;

/**
 * The NEWEST captured point of one metric series (the last finite value on
 * the axis), with its exact display string — the string its hour's record and
 * its mark's title print — and the direct label the chart prints (see
 * `SeriesNewestPoint`: qualified whenever the last plotted point is not the
 * newest axis entry). Null when nothing plots.
 */
export function seriesNewestPoint(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
  series: BucketMetricSeries,
): SeriesNewestPoint | null {
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    const value = series.values[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      const point = labelledPointAt(axis, response, metric, index, value);
      const entry = axis.entries[index];
      if (point === null || entry === undefined || entry.point === null) return null;
      const atNewestBucket = index === series.values.length - 1;
      const figure = bookFigure(entry.point, metric, response.usd_decimals);
      return {
        ...point,
        atNewestBucket,
        directLabel: atNewestBucket ? figure : `${figure} ${lastCaptured(entry.bucketStart, response.served_at)}`,
      };
    }
  }
  return null;
}

/** The chart's two direct labels, decided together so they can never print one figure for two different values. */
export interface SeriesDirectLabels {
  /** The peak's label, or null when nothing plots, the peak is the newest point itself, or nothing rises above zero. */
  readonly peak: SeriesMaxPoint | null;
  readonly newest: SeriesNewestPoint | null;
}

/**
 * The peak's and the newest point's labels. One point, one label: when the peak IS the newest point, only the newest
 * label prints, and a peak at zero is the floor's own "0". When both print and their book figures read alike while the
 * two values differ — "$27.9M" beside "$27.9M" for two different hours — both take one more significant digit, and a
 * second when one is not enough, so a reader never sees two different values printed as one.
 */
export function seriesDirectLabels(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
  series: BucketMetricSeries,
): SeriesDirectLabels {
  const newest = seriesNewestPoint(axis, response, metric, series);
  const max = seriesMaxPoint(axis, response, metric, series);
  const peak = max !== null && max.value > 0 && (newest === null || max.index !== newest.index) ? max : null;
  if (peak === null || newest === null) return { peak, newest };
  const peakWire = axis.entries[peak.index]?.point;
  const newestWire = axis.entries[newest.index]?.point;
  if (peakWire === null || peakWire === undefined || newestWire === null || newestWire === undefined) return { peak, newest };
  const a = moneyOf(peakWire, metric);
  const b = moneyOf(newestWire, metric);
  if (a === null || b === null || a === b) return { peak, newest };
  const decimals = response.usd_decimals;
  let extra = 0;
  while (extra < 2 && bookMoneyAt(a, decimals, extra) === bookMoneyAt(b, decimals, extra)) extra += 1;
  if (extra === 0) return { peak, newest };
  const newestFigure = bookFigure(newestWire, metric, decimals, extra);
  const newestEntry = axis.entries[newest.index];
  return {
    peak: { ...peak, directLabel: `${PEAK_WORD} ${bookFigure(peakWire, metric, decimals, extra)}` },
    newest: {
      ...newest,
      directLabel:
        newest.atNewestBucket || newestEntry === undefined ? newestFigure : `${newestFigure} ${lastCaptured(newestEntry.bucketStart, response.served_at)}`,
    },
  };
}

/**
 * The sparse-window STATE line: everything that qualifies a visual renders
 * before it. Non-null exactly when ONE or ZERO captured points plot in the
 * window — a panel that is mostly gaps must say so in the absent/withheld
 * register instead of reading as a blank box. Computed from the series,
 * never static copy.
 */
export function sparseCaptureLine(series: BucketMetricSeries): string | null {
  const plotted = series.values.filter((v) => v !== null && Number.isFinite(v)).length;
  if (plotted > 1) return null;
  const absent = series.gapKinds.filter((kind) => kind === "absent").length;
  const withheld = series.gapKinds.filter((kind) => kind === "withheld").length;
  const nulls = series.gapKinds.filter((kind) => kind === "null").length;
  const unreadable = series.gapKinds.filter((kind) => kind === "unreadable").length;
  const parts = [
    plotted === 1
      ? "1 captured hour plots in this window"
      : `${String(plotted)} captured hours plot in this window`,
  ];
  if (absent > 0) {
    parts.push(absent === 1 ? "1 absent hour renders as a gap" : `${String(absent)} absent hours render as gaps`);
  }
  if (withheld > 0) {
    parts.push(withheld === 1 ? "1 withheld hour stays a named refusal" : `${String(withheld)} withheld hours stay named refusals`);
  }
  if (nulls > 0) {
    parts.push(
      nulls === 1
        ? "1 recorded hour states this figure as null (null is not zero)"
        : `${String(nulls)} recorded hours state this figure as null (null is not zero)`,
    );
  }
  if (unreadable > 0) {
    parts.push(
      unreadable === 1
        ? "1 recorded hour states this figure unreadably (unreadable is not zero)"
        : `${String(unreadable)} recorded hours state this figure unreadably (unreadable is not zero)`,
    );
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The computed sentences. One source each: the view model prints these parts
// by identity and no component composes a word. Headline and finding speak
// the reader's tier (humanUsd, grouped counts, humanUtc against the
// envelope's own served_at); the exact values stay one glance away — in each
// mark's title and in the hour's record.
// ---------------------------------------------------------------------------

/** The debt a headline counts, by engine: one engine per sentence, never a sum or a comparison across the two. */
const DEBT_OF: Record<ObservatoryEngine, string> = {
  debt_manager: "Cash debt",
  aave_v3_etherfi: "legacy Aave v3 debt",
};

/** The same subject opening a sentence. */
const DEBT_SUBJECT: Record<ObservatoryEngine, string> = {
  debt_manager: "Cash debt",
  aave_v3_etherfi: "Legacy Aave v3 debt",
};

/** The window's unit: an hour at the native stride, a sampled hour when the service applied a larger one. */
const hourUnit = (axis: BucketAxis): string =>
  axis.strideSeconds > NATIVE_BUCKET_SECONDS ? "sampled hour" : "hour";

/** "{captured} of the {total} hours in this window were recorded" — the verb follows the recorded count. */
const recordedOf = (axis: BucketAxis): string =>
  `${groupInt(axis.capturedCount)} of the ${groupInt(axis.entries.length)} ${hourUnit(axis)}s in this window ${axis.capturedCount === 1 ? "was" : "were"} recorded`;

/**
 * A withheld hour's cause: the phrasebook's plain words, then the wire's code
 * — once. A code the phrasebook does not know is already named by its plain
 * words, and a refusal that named no code says so instead of printing "()".
 */
function refusalCause(code: string | null): string {
  const wire = (code ?? "").trim();
  const words = plainCause(wire);
  return wire === "" || words.includes(wire) ? words : `${words} · ${wire}`;
}

/**
 * The window's holes, as the dek states them. Three carriers keep a missing
 * hour from vanishing — this sentence, the census chip, the chart's marks (whose
 * key glosses each mark) — so the sentence counts them and says what each is on
 * the chart: a gap. When the headline already carries the recorded count
 * (`promoted`), the dek keeps only the holes.
 */
function windowHoles(axis: BucketAxis, promoted: boolean): string {
  const unit = hourUnit(axis);
  const total = axis.entries.length;
  const absent =
    axis.absentCount > 0 ? `${groupInt(axis.absentCount)} ${axis.absentCount === 1 ? "is" : "are"} absent` : null;
  const withheld =
    axis.withheldCount > 0 ? `${groupInt(axis.withheldCount)} ${axis.withheldCount === 1 ? "was" : "were"} withheld` : null;
  const holes = axis.absentCount + axis.withheldCount;
  const gaps =
    absent === null && withheld === null
      ? null
      : `${[absent, withheld].filter((part): part is string => part !== null).join(" and ")}, ${holes === 1 ? "a gap" : "each a gap"} on the chart`;
  let recorded: string | null = null;
  if (!promoted) {
    if (total === 1) recorded = `The only ${unit} in this window was ${axis.capturedCount === 1 ? "" : "not "}recorded`;
    else if (axis.capturedCount === total) recorded = `All ${groupInt(total)} ${unit}s in this window were recorded`;
    else if (axis.capturedCount === 0) recorded = `None of the ${groupInt(total)} ${unit}s in this window was recorded`;
    else recorded = `${groupInt(axis.capturedCount)} of ${groupInt(total)} ${unit}s ${axis.capturedCount === 1 ? "was" : "were"} recorded`;
  }
  const first = recorded === null ? gaps : gaps === null ? recorded : `${recorded}; ${gaps}`;
  const sentences = first === null ? [] : [`${first.charAt(0).toUpperCase()}${first.slice(1)}.`];
  if (axis.strideSeconds > NATIVE_BUCKET_SECONDS) {
    // What the stride is, as the service applies it: a recorded hour is served only when it starts at least one
    // stride after the last one served — so "at most one in every N", never "every Nth" (a hole shifts the grid).
    const stride = readWirePopulation(axis.strideSeconds, "step_seconds");
    sentences.push(
      stride % NATIVE_BUCKET_SECONDS === 0
        ? `The hours are sampled: the service serves at most one in every ${groupInt(stride / NATIVE_BUCKET_SECONDS)}.`
        : `The hours are sampled: the service serves at most one per ${groupInt(stride)} seconds.`,
    );
  }
  return sentences.join(" ");
}

/** The takeaway's parts. The H1 is `emphasis + " " + rest`; nothing downstream composes or trims them. */
export interface ObservatoryTakeaway {
  /** The finding's core. It ends with its comma when a rest follows; otherwise it is the whole sentence. */
  readonly emphasis: string;
  /** Scope and as-of, ending the sentence; "" when the emphasis stands alone. No leading space. */
  readonly rest: string;
  /** The window's holes as the dek states them; "" when the window holds no hour at all. */
  readonly holes: string;
  /** The dek: the other figures' movement and the holes; a withheld latest hour's cause; or the missing record's own words. */
  readonly dek: string;
  /** True exactly when the latest recorded hour stated a debt figure and the headline printed it. */
  readonly answered: boolean;
}

/** The recorded hours the window's movement is read between: captured and not withheld, oldest first. */
function recordedHours(axis: BucketAxis): ObservatorySeriesPoint[] {
  return axis.entries.flatMap((entry) => (entry.point !== null && !entry.point.refused ? [entry.point] : []));
}

/** The movement of the two counts beside the debt, as one sentence of the dek: the liquidatable count, then the accounts. */
function countsMoved(first: ObservatorySeriesPoint, last: ObservatorySeriesPoint, engine: string): string {
  const liquidatable = countMove(metricWord("liquidatable_positions", engine), first.liquidatable_positions, last.liquidatable_positions);
  return `${liquidatable.charAt(0).toUpperCase()}${liquidatable.slice(1)}; ${countMove("accounts", first.accounts, last.accounts)}.`;
}

/**
 * The surface takeaway, for ONE engine: the change leads. Between the first and
 * the latest recorded hours, how the engine's debt moved — "Cash debt rose $1.8M
 * since Aug 1, 21:00 UTC, to $27.8M." — one bigint subtraction of two figures
 * of one engine at one scale, each through its guard; the other two figures'
 * movement and the window's holes ride the dek. A window with one recorded hour,
 * or whose first recorded hour states no readable debt, has no change to lead
 * with: the headline states the latest hour's level instead. When the record
 * is more hole than hour (`captured * 2 <= total`) the recorded count is
 * promoted into the headline.
 *
 * A withheld latest hour states the withholding and its cause — an older
 * hour's figure never stands in. A latest hour that states no debt figure
 * says so; not stated is not zero. The debt passes the decimal guard and the
 * account count the population guard before either is formatted.
 */
export function observatoryTakeaway(
  response: ObservatorySeriesResponse,
  axis: BucketAxis,
  engine: ObservatoryEngine,
): ObservatoryTakeaway {
  const newest =
    axis.newestPointIndex >= 0 ? (axis.entries[axis.newestPointIndex]?.point ?? null) : null;
  if (newest === null) {
    return {
      emphasis: "No hour in this window was recorded.",
      rest: "",
      holes: "",
      dek: `No complete batch was observed for ${engineInProse(engine)} in this range, so there is nothing to chart. That is a missing record, not a zero.`,
      answered: false,
    };
  }
  // The envelope's own served_at names the year the instant is read against — never the browser's clock.
  const at = humanUtc(newest.bucket_start, response.served_at);
  if (newest.refused) {
    const holes = windowHoles(axis, false);
    return {
      emphasis: "The latest hour's figures were withheld,",
      rest: `so no current debt figure is shown (${at}).`,
      holes,
      dek: `The engine's whole book was refused in that hour (${refusalCause(newest.refusal_code)}). ${holes}`,
      answered: false,
    };
  }
  if (newest.debt_usd === null) {
    const holes = windowHoles(axis, false);
    return {
      emphasis: "The latest hour states no debt figure,",
      rest: `in the hour starting ${at}. Not stated is not zero.`,
      holes,
      dek: holes,
      answered: false,
    };
  }
  const debt = wireBigInt(newest.debt_usd);
  if (debt === null) {
    const holes = windowHoles(axis, false);
    return {
      emphasis: "The latest hour's debt figure cannot be read,",
      rest: `in the hour starting ${at}. Unreadable is not zero.`,
      holes,
      dek: holes,
      answered: false,
    };
  }
  // More hole than record: the count of recorded hours is the finding's own scope, so it rides the headline and
  // the dek keeps only the holes.
  const promoted = axis.capturedCount * 2 <= axis.entries.length;
  const holes = windowHoles(axis, promoted);
  const but = promoted ? ` — but only ${recordedOf(axis)}` : "";
  const recorded = recordedHours(axis);
  const first = recorded[0];
  const firstDebt = first === undefined || first === newest || first.debt_usd === null ? null : wireBigInt(first.debt_usd);
  const decimals = response.usd_decimals;
  if (first !== undefined && first !== newest && firstDebt !== null) {
    const since = humanUtc(first.bucket_start, response.served_at);
    const dek = [countsMoved(first, newest, engine), holes].filter((part) => part !== "").join(" ");
    if (debt === firstDebt) {
      return {
        emphasis: `${DEBT_SUBJECT[engine]} was unchanged since ${since},`,
        rest: `at ${humanUsd(debt, decimals)}${but}.`,
        holes,
        dek,
        answered: true,
      };
    }
    const rose = debt > firstDebt;
    return {
      emphasis: `${DEBT_SUBJECT[engine]} ${rose ? "rose" : "fell"} ${humanUsd(rose ? debt - firstDebt : firstDebt - debt, decimals)} since ${since},`,
      rest: `to ${humanUsd(debt, decimals)}${but}.`,
      holes,
      dek,
      answered: true,
    };
  }
  const scope =
    newest.accounts === null
      ? `in the hour starting ${at}; the account count was not stated`
      : `across ${plural(readWirePopulation(newest.accounts, "accounts"), "account")} in the hour starting ${at}`;
  const dek =
    first !== undefined && first !== newest ? [countsMoved(first, newest, engine), holes].filter((part) => part !== "").join(" ") : holes;
  return {
    emphasis: `${humanUsd(debt, decimals)} of ${DEBT_OF[engine]} is outstanding,`,
    rest: `${scope}${but}.`,
    holes,
    dek,
    answered: true,
  };
}

/** A span of two instants states its zone once, at the end — exactly when both ends are the wire's own UTC instants. */
function humanUtcSpan(first: string, last: string, referenceIso: string): string {
  const a = humanUtc(first, referenceIso);
  const b = humanUtc(last, referenceIso);
  // humanUtc returns a malformed instant verbatim, so an end it rewrote is an end it parsed — and ends with its zone.
  const zone = / UTC$/;
  return a !== first && b !== last && zone.test(a) ? `${a.replace(zone, "")}${RANGE_DASH}${b}` : `${a}${RANGE_DASH}${b}`;
}

const ends = (both: boolean): string => (both ? "either end" : "one end");

/** One count metric's movement; each non-null end passes the population guard before the subtraction. */
function countMove(name: string, first: number | null, last: number | null): string {
  if (first === null || last === null) {
    return `${name} not stated at ${ends(first === null && last === null)}, so no change is given`;
  }
  const a = readWirePopulation(first, name);
  const b = readWirePopulation(last, name);
  if (a === b) return `${name} unchanged at ${groupInt(b)}`;
  return `${name} ${b > a ? "rose" : "fell"} by ${groupInt(Math.abs(b - a))}, to ${groupInt(b)}`;
}

/**
 * The chart's caption: what a point and a gap are, over the span between the
 * FIRST and LAST recorded hours of the window. It states no figure and no
 * change — the headline carries the debt's change and each tile its own — so
 * it reads the same whichever metric is drawn. The exact values stay in each
 * mark's own title and any hour's record.
 */
export function gridReadingLine(response: ObservatorySeriesResponse, axis: BucketAxis): string {
  const captured = recordedHours(axis);
  const first = captured[0];
  const last = captured[captured.length - 1];
  if (first === undefined || last === undefined) {
    return "No hour in this window was recorded, so there is no movement to read.";
  }
  if (captured.length === 1) {
    return `Only one hour in this window was recorded (${humanUtc(first.bucket_start, response.served_at)}), so there is no movement to state.`;
  }
  return `Each point is one recorded hour, ${humanUtcSpan(first.bucket_start, last.bucket_start, response.served_at)}; a gap is an hour with no figures to draw.`;
}

/**
 * The hour record's one-line state — the takeaway of the forensic panel. The
 * hour itself is the record's title, so the line says what the hour holds.
 * ABSENT and WITHHELD arms are hazards and never soften.
 */
export function pointDetailTakeaway(entry: BucketEntry): string {
  if (entry.point === null) {
    return "Absent: no complete batch was observed in this hour.";
  }
  if (entry.point.refused) {
    return `Withheld (${entry.point.refusal_code ?? "unnamed"}): the engine's whole book was refused at capture time, so no figures were served.`;
  }
  // last_block is the engine's balances watermark at capture — the hour's own as-of, never a chain head seen later.
  return `Captured · balances as of block ${formatBlock(entry.point.last_block)}.`;
}
