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
//     decimal) is a GAP of its own kind — UNREADABLE: not an absent hour, not
//     a withheld one, never zero and never a throw. It passes the guard
//     before it meets a formatter, here and in every sentence;
//   - `step_seconds` is the stride the server actually applied: every Nth
//     captured bucket VERBATIM, never an average. Gap detection uses the
//     applied stride, so downsampled series don't invent holes;
//   - values are DISPLAY-PRECISION geometry only; exact decimal strings
//     belong in adjacent mono text (displayMetric), grouped as money and
//     counts always are;
//   - the two sentences the page leads with (observatoryTakeaway,
//     gridReadingLine) speak the reader's tier — compact money, grouped
//     counts, an instant read from the wire's own UTC fields — about ONE
//     engine at ONE scale, and a missing or withheld hour is named as such
//     in them, never as a zero.
//
// Pure functions — pinned by tests/unit/observatory-series.spec.ts.

import { formatUnits } from "@solvent/client";
import { renderUsdAmount } from "./book-format";
import { EM_DASH, formatBlock } from "./format";
import { humanUsd } from "./human-usd";
import { humanUtc } from "./human-utc";
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

export const METRIC_LABELS: Record<BucketMetric, string> = {
  debt_usd: "debt (usd)",
  collateral_usd: "collateral (usd)",
  accounts: "accounts",
  liquidatable_positions: "liquidatable positions",
};

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

/** The wire metric, raw. USD metrics are exact decimal strings. */
function rawMetric(point: ObservatorySeriesPoint, metric: BucketMetric): string | number | null {
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

/** True when a served row states a money metric that fails the decimal guard: a figure no formatter may be handed. */
export function metricUnreadable(point: ObservatorySeriesPoint, metric: BucketMetric): boolean {
  const raw = rawMetric(point, metric);
  return typeof raw === "string" && !isWireDecimal(raw);
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
  // records all read through it — and grouped, as every count the product prints is.
  if (typeof raw === "number") return groupInt(readWirePopulation(raw, metric));
  if (!isWireDecimal(raw)) return EM_DASH;
  // Money is grouped, always: string surgery on the exact decimal at the engine's own scale, the digits untouched.
  return renderUsdAmount(raw, usdDecimals);
}

/**
 * Display-precision geometry for one metric value. Null = no finite geometry. A money string is placed only after
 * it passes the decimal guard — the caller has already named an unreadable one as its own gap.
 */
function geometryOf(raw: string | number | null, usdDecimals: number): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
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
        `${entry.bucketStart} · WITHHELD · ${point.refusal_code ?? "unnamed"} @ block ${formatBlock(point.last_block)} · totals are null for that reason, never 0`,
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
        `${entry.bucketStart} · ${METRIC_LABELS[metric]} is ${UNREADABLE} in this bucket: the wire's value is not an exact decimal (unreadable is not zero)`,
      );
      gapKinds.push("unreadable");
      continue;
    }
    const value = geometryOf(raw, response.usd_decimals);
    if (raw === null || value === null) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} · ${METRIC_LABELS[metric]} is null in this bucket (null is not zero)`,
      );
      gapKinds.push("null");
      continue;
    }
    values.push(value);
    titles.push(
      `${entry.bucketStart} · ${METRIC_LABELS[metric]} ${displayMetric(point, metric, response.usd_decimals)} @ block ${formatBlock(point.last_block)} · captured from the newest complete batch in this bucket`,
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
    return "native hourly record · every recorded hour is served verbatim";
  }
  // A served stride is a wire population, guarded at the read.
  return `stride ${String(readWirePopulation(stepSeconds, "step_seconds"))}s · the service serves at most one recorded hour per stride, each VERBATIM; skipped hours are never averaged`;
}

/** The served range, disclosed. Absent bounds are unbounded, and say so. */
export function describeRange(from: string | null, to: string | null): string {
  return `${from ?? "unbounded"} → ${to ?? "unbounded"}`;
}

// ---------------------------------------------------------------------------
// The direct labels the chart draws, derived (never retyped): no figure lives
// only in a hover, and every label says which point it belongs to.
// ---------------------------------------------------------------------------

/**
 * A labelled point of one metric series: the index into the axis, the drawn
 * geometry at that index, and the exact display string of the SAME wire row
 * through `displayMetric` — the formatter the bucket record prints with, so a
 * label on the chart and that hour's record are one string. (The tiles above
 * read the same wire row in the compact tier.)
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
export const PEAK_WORD = "peak";

/** `seriesMaxPoint`'s result: the highest plotted point, plus the label the chart prints for it. */
export interface SeriesMaxPoint extends SeriesLabelledPoint {
  /** The chart's direct label: "peak {label}" — a bare figure at the plot's left edge reads as the starting value. */
  directLabel: string;
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
 * point's display string — derived from the drawn domain, never invented —
 * named for what it is: the window's PEAK, not its first value. Ties keep the
 * first (oldest) occurrence; null when nothing plots.
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
  return point === null ? null : { ...point, directLabel: `${PEAK_WORD} ${point.label}` };
}

/**
 * `seriesNewestPoint`'s result: the last plotted point, plus the direct
 * label the chart prints at it. ONE-SOURCE LAW, both arms:
 *
 *   - when the last plotted point IS the newest axis entry, `directLabel`
 *     is `label` VERBATIM — that hour's exact figure, as its record prints it;
 *   - when it is NOT (the newest bucket is withheld, or carries this metric
 *     as null or unreadable), `directLabel` is that SAME string plus a
 *     "(last captured {bucket})" qualifier naming which row the figure
 *     belongs to. The tile above shows the newest bucket's dash and its
 *     word, and the chart must never print an older number unqualified
 *     beside it.
 *
 * The qualifier's bucket hour is the entry's own `bucketStart`, the same
 * UTC string the tiles' subs and the x-axis extents print.
 */
export interface SeriesNewestPoint extends SeriesLabelledPoint {
  /** True exactly when the last plotted point IS the newest axis entry. */
  atNewestBucket: boolean;
  /** The chart's direct label: `label` verbatim, or `label` + the qualifier. */
  directLabel: string;
}

/**
 * The NEWEST captured point of one metric series (the last finite value on
 * the axis), with its exact display string — the same wire row the newest
 * hour's tile reads in the compact tier — and the direct label the chart
 * prints (see `SeriesNewestPoint`: qualified whenever the last plotted
 * point is not the newest axis entry). Null when nothing plots.
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
      if (point === null || entry === undefined) return null;
      const atNewestBucket = index === series.values.length - 1;
      return {
        ...point,
        atNewestBucket,
        directLabel: atNewestBucket
          ? point.label
          : `${point.label} (last captured ${entry.bucketStart})`,
      };
    }
  }
  return null;
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
      ? "1 captured bucket plots in this window"
      : `${String(plotted)} captured buckets plot in this window`,
  ];
  if (absent > 0) {
    parts.push(
      absent === 1
        ? "1 absent bucket renders as a gap"
        : `${String(absent)} absent buckets render as gaps`,
    );
  }
  if (withheld > 0) {
    parts.push(
      withheld === 1
        ? "1 withheld bucket stays a named refusal"
        : `${String(withheld)} withheld buckets stay named refusals`,
    );
  }
  if (nulls > 0) {
    parts.push(
      nulls === 1
        ? "1 served bucket carries a null value (null is not zero)"
        : `${String(nulls)} served buckets carry null values (null is not zero)`,
    );
  }
  if (unreadable > 0) {
    parts.push(
      unreadable === 1
        ? "1 served bucket carries an unreadable value (unreadable is not zero)"
        : `${String(unreadable)} served buckets carry unreadable values (unreadable is not zero)`,
    );
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The computed sentences. One source each: the view model prints these parts
// by identity and no component composes a word. Headline and finding speak
// the reader's tier (humanUsd, grouped counts, humanUtc against the
// envelope's own served_at); the exact values stay one glance away — the
// instant verbatim in the tiles' subs, the figures in the chart's labels and
// the bucket record.
// ---------------------------------------------------------------------------


/** The debt a headline counts, by engine: one engine per sentence, never a sum or a comparison across the two. */
const DEBT_OF: Record<ObservatoryEngine, string> = {
  debt_manager: "Cash debt",
  aave_v3_etherfi: "legacy Aave v3 debt",
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
 * hour from vanishing — this sentence, the census chip, the chart's marks —
 * and this is the one that GLOSSES the two words: an absent hour is one no
 * complete batch was observed in (the rollup wrote no row: nothing existed to
 * observe, or nothing observed), a withheld hour is a row whose figures were
 * refused. Either clause drops at a count of zero; each hole is "a gap on the
 * chart, never a zero". When the headline already carries the recorded count
 * (`promoted`), the dek keeps only what each hole is.
 */
function windowHoles(axis: BucketAxis, promoted: boolean): string {
  const unit = hourUnit(axis);
  const total = axis.entries.length;
  const sentences: string[] = [];
  if (!promoted) {
    if (total === 1) {
      sentences.push(`The only ${unit} in this window was ${axis.capturedCount === 1 ? "" : "not "}recorded.`);
    } else if (axis.capturedCount === total) {
      sentences.push(`All ${groupInt(total)} ${unit}s in this window were recorded.`);
    } else if (axis.capturedCount === 0) {
      sentences.push(`None of the ${groupInt(total)} ${unit}s in this window was recorded.`);
    } else {
      sentences.push(`${recordedOf(axis)}.`);
    }
  }
  const absent =
    axis.absentCount > 0
      ? `${groupInt(axis.absentCount)} ${axis.absentCount === 1 ? "is" : "are"} absent — no complete batch was observed`
      : null;
  const withheld =
    axis.withheldCount > 0
      ? `${groupInt(axis.withheldCount)} ${axis.withheldCount === 1 ? "was" : "were"} withheld`
      : null;
  const gaps = absent !== null && withheld !== null ? `${absent} — and ${withheld}` : (absent ?? withheld);
  if (gaps !== null) {
    const each = axis.absentCount + axis.withheldCount === 1 ? "it is" : "each is";
    sentences.push(`${gaps}; ${each} a gap on the chart, never a zero.`);
  }
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
  /** The dek: a withheld latest hour's cause, then the holes; or the missing record's own words. */
  readonly dek: string;
  /** True exactly when the latest recorded hour stated a debt figure and the headline printed it. */
  readonly answered: boolean;
}

/**
 * The surface takeaway, for ONE engine: how much debt the latest recorded
 * hour states and across how many accounts, "in the hour starting" that
 * hour's own instant — the rollup observes the newest complete batch INTO the
 * hour it is observed in, so the hour is the honest claim, not an as-of. The
 * window's holes ride the dek by law: an hour with no record is an unknowable,
 * and a takeaway that omitted it would invite reading the series as
 * continuous. When the record is more hole than hour
 * (`captured * 2 <= total`) the recorded count is promoted into the headline.
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
  const scope =
    newest.accounts === null
      ? `in the hour starting ${at}; the account count was not stated`
      : `across ${plural(readWirePopulation(newest.accounts, "accounts"), "account")} in the hour starting ${at}`;
  // More hole than record: the count of recorded hours is the finding's own scope, so it rides the headline and
  // the dek keeps only what each hole is.
  const promoted = axis.capturedCount * 2 <= axis.entries.length;
  const holes = windowHoles(axis, promoted);
  return {
    emphasis: `${humanUsd(debt, response.usd_decimals)} of ${DEBT_OF[engine]} is outstanding,`,
    rest: promoted
      ? `${scope} — but only ${recordedOf(axis)}.`
      : `${scope}.`,
    holes,
    dek: holes,
    answered: true,
  };
}

/** A span of two instants states its zone once, at the end — exactly when both ends are the wire's own UTC instants. */
function humanUtcSpan(first: string, last: string, referenceIso: string): string {
  const a = humanUtc(first, referenceIso);
  const b = humanUtc(last, referenceIso);
  // humanUtc returns a malformed instant verbatim, so an end it rewrote is an end it parsed — and ends with its zone.
  const zone = /\u00a0UTC$/;
  return a !== first && b !== last && zone.test(a) ? `${a.replace(zone, "")} → ${b}` : `${a} → ${b}`;
}

const ends = (both: boolean): string => (both ? "either end" : "one end");

/**
 * One money metric's movement: ONE bigint subtraction of two values of one
 * engine at one scale, each through the decimal guard first. A delta, not
 * "A → B": the compact tier truncates both ends of a quiet week to the same
 * figure. Never a percentage. "rose by X, to Y": the two figures are told
 * apart in words — "rose 1 to 49" reads as a range.
 */
function moneyMove(name: string, first: string | null, last: string | null, decimals: number): string {
  if (first === null || last === null) {
    return `${name} not stated at ${ends(first === null && last === null)}, so no change is given`;
  }
  const a = wireBigInt(first);
  const b = wireBigInt(last);
  if (a === null || b === null) {
    return `${name} unreadable at ${ends(a === null && b === null)}, so no change is given`;
  }
  if (a === b) return `${name} unchanged at ${humanUsd(b, decimals)}`;
  return `${name} ${b > a ? "rose" : "fell"} by ${humanUsd(b > a ? b - a : a - b, decimals)}, to ${humanUsd(b, decimals)}`;
}

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
 * The chart's finding: movement between the FIRST and LAST recorded hours of
 * the window, as deltas in the reader's tier. It reads only what was recorded
 * — refusals and absences are the takeaway's job — and the exact values it
 * leans on are the chart's own end labels and any hour's record. Each
 * movement carries its own comma, so the three are joined by semicolons.
 */
export function gridReadingLine(
  response: ObservatorySeriesResponse,
  axis: BucketAxis,
): string {
  const captured = axis.entries.filter(
    (entry) => entry.point !== null && !entry.point.refused,
  );
  const first = captured[0]?.point;
  const last = captured[captured.length - 1]?.point;
  if (first === undefined || first === null || last === undefined || last === null) {
    return "No hour in this window was recorded, so there is no movement to read.";
  }
  if (captured.length === 1) {
    return `Only one hour in this window was recorded (${humanUtc(first.bucket_start, response.served_at)}), so there is no movement to state.`;
  }
  return (
    `Between the first and last recorded hours (${humanUtcSpan(first.bucket_start, last.bucket_start, response.served_at)}), ` +
    `${moneyMove("debt", first.debt_usd, last.debt_usd, response.usd_decimals)}; ` +
    `${countMove("accounts", first.accounts, last.accounts)}; ` +
    `and ${countMove("liquidatable positions", first.liquidatable_positions, last.liquidatable_positions)}.`
  );
}

/**
 * The bucket record's one-line state — the takeaway of the forensic panel.
 * ABSENT and WITHHELD arms are hazards and never soften.
 */
export function pointDetailTakeaway(entry: BucketEntry): string {
  if (entry.point === null) {
    return `ABSENT · no complete batch was observed in this bucket (${entry.bucketStart}).`;
  }
  if (entry.point.refused) {
    return (
      `withheld (${entry.point.refusal_code ?? "unnamed"}) at ${entry.point.bucket_start} — ` +
      `the engine's whole book was refused at capture time; no numbers served.`
    );
  }
  return `captured at ${entry.point.bucket_start} · watermark block ${formatBlock(entry.point.last_block)}.`;
}
