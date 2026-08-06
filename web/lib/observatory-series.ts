// The observatory bucket-axis builder: one engine's rollup points, turned
// into chart-ready series WITHOUT ever fabricating a bucket the rollup did
// not capture.
//
// The bucket laws, applied to GET /v1/observatory/series:
//
//   - a point derives ONLY from the newest COMPLETE risk batch in its bucket
//     (migration 00016's law) — a bucket with no wire row is ABSENT and enters
//     the axis as a GAP saying "no complete batch in this bucket", never an
//     interpolated value and never a flat line;
//   - a WITHHELD bucket (refused: true) is a row in the record — the engine's
//     whole book was refused at capture time. It is a GAP carrying its named
//     refusal code; its null totals render as em dashes, NEVER 0;
//   - a null metric on a served bucket is a GAP saying null-is-not-zero;
//   - `step_seconds` is the stride the server actually applied: every Nth
//     captured bucket VERBATIM, never an average. Gap detection uses the
//     applied stride, so downsampled series don't invent holes;
//   - values are DISPLAY-PRECISION geometry only; exact decimal strings
//     belong in adjacent mono text (displayMetric).
//
// Pure functions — pinned by tests/unit/observatory-series.spec.ts.

import { formatUnits } from "@solvent/client";
import type { ObservatorySeriesPoint, ObservatorySeriesResponse } from "./observatory-data";
import { EM_DASH, formatBlock, renderNullableDecimal } from "./format";

/** The rollup's native bucket (the contract: hourly). */
export const NATIVE_BUCKET_SECONDS = 3600;

/**
 * captured  — a wire row with refused: false (the engine's book was served);
 * withheld  — a wire row with refused: true (the whole book was refused —
 *             totals are null FOR THAT REASON, never 0);
 * absent    — no wire row: no complete batch existed in this bucket. Nothing
 *             was captured, so nothing is drawn — never interpolated.
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
 *   withheld — the engine's book was refused in this bucket;
 *   absent   — no complete batch in this bucket;
 *   null     — the bucket was served but this metric is null (not zero).
 */
export type GapKind = "withheld" | "absent" | "null";

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

/**
 * Exact display string for one metric of one wire row. A null metric is an
 * em dash — NEVER "0" (a withheld book rendered as zero debt would fabricate
 * the exact reassurance this surface exists to withhold).
 */
export function displayMetric(
  point: ObservatorySeriesPoint,
  metric: BucketMetric,
  usdDecimals: number,
): string {
  const raw = rawMetric(point, metric);
  if (raw === null) return EM_DASH;
  if (typeof raw === "number") return String(raw);
  return renderNullableDecimal(raw, { decimals: usdDecimals, prefix: "$" });
}

/** Display-precision geometry for one metric value. Null = no finite geometry. */
function geometryOf(raw: string | number | null, usdDecimals: number): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
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
        `${entry.bucketStart} · no complete batch in this bucket · nothing was captured; absence is stated, never interpolated`,
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

/** The stride, disclosed. A stride never averages — it serves every Nth bucket. */
export function describeStride(stepSeconds: number | null): string {
  if (stepSeconds === null) {
    return "native hourly buckets · every captured bucket served verbatim";
  }
  return `stride ${String(stepSeconds)}s · every Nth captured bucket VERBATIM, skipped buckets are never averaged`;
}

/** The served range, disclosed. Absent bounds are unbounded, and say so. */
export function describeRange(from: string | null, to: string | null): string {
  return `${from ?? "unbounded"} → ${to ?? "unbounded"}`;
}

// ---------------------------------------------------------------------------
// Wave W-OBS — the direct labels the panels draw, derived (never retyped).
// ---------------------------------------------------------------------------

/**
 * A labelled point of one metric series: the index into the axis, the drawn
 * geometry at that index, and the display string of the SAME wire row through
 * `displayMetric` — the exact formatter the summary cards and the bucket
 * record use, so a label on the chart and the card above it share one source.
 */
export interface SeriesLabelledPoint {
  /** Index into `axis.entries` / `series.values`. */
  index: number;
  /** The drawn geometry at that index (display precision, GEOMETRY only). */
  value: number;
  /** `displayMetric` of the same wire row — the card register, never retyped. */
  label: string;
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
 * point's display string — derived from the drawn domain, never invented.
 * Ties keep the first (oldest) occurrence; null when nothing plots.
 */
export function seriesMaxPoint(
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  metric: BucketMetric,
  series: BucketMetricSeries,
): SeriesLabelledPoint | null {
  let bestIndex = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  series.values.forEach((value, index) => {
    if (value !== null && Number.isFinite(value) && value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) return null;
  return labelledPointAt(axis, response, metric, bestIndex, bestValue);
}

/**
 * `seriesNewestPoint`'s result: the last plotted point, plus the direct
 * label the chart prints at it (Wave W-OBS-B). ONE-SOURCE LAW, both arms:
 *
 *   - when the last plotted point IS the newest axis entry, `directLabel`
 *     is `label` VERBATIM — the summary card's exact string;
 *   - when it is NOT (the newest bucket is withheld, or carries this metric
 *     as null), `directLabel` is that SAME string plus a
 *     "(last captured {bucket})" qualifier naming which row the figure
 *     belongs to. The card above shows the newest bucket's dash/refusal,
 *     and the chart must never print an older number unqualified beside it.
 *
 * The qualifier's bucket hour is the entry's own `bucketStart`, the same
 * UTC string the panel head's "as of bucket ..." line prints.
 */
export interface SeriesNewestPoint extends SeriesLabelledPoint {
  /** True exactly when the last plotted point IS the newest axis entry. */
  atNewestBucket: boolean;
  /** The chart's direct label: `label` verbatim, or `label` + the qualifier. */
  directLabel: string;
}

/**
 * The NEWEST captured point of one metric series (the last finite value on
 * the axis), with its display string — the same figure the newest-bucket
 * summary card carries when the newest wire bucket is captured, from the
 * same formatter over the same wire row — and the direct label the chart
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
 * The sparse-window STATE line (template rule R6: everything that qualifies
 * the visual renders before it). Non-null exactly when ONE or ZERO captured
 * points plot in the window — a panel that is mostly gaps must say so in the
 * existing absent/withheld register instead of reading as a blank box.
 * Computed from the series, never static copy.
 */
export function sparseCaptureLine(series: BucketMetricSeries): string | null {
  const plotted = series.values.filter((v) => v !== null && Number.isFinite(v)).length;
  if (plotted > 1) return null;
  const absent = series.gapKinds.filter((kind) => kind === "absent").length;
  const withheld = series.gapKinds.filter((kind) => kind === "withheld").length;
  const nulls = series.gapKinds.filter((kind) => kind === "null").length;
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
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// W-3L — the Observatory's computed reading lines. One source each; the
// components render these verbatim and never retype a number.
// ---------------------------------------------------------------------------

/**
 * The surface takeaway: the newest wire-backed bucket's answer PLUS the
 * window's gap tally. The withheld and absent counts ride the takeaway by
 * law (inventory hazard): an hour with no complete batch is an unknowable,
 * and a takeaway that omits it invites reading the series as continuous.
 * A refused newest bucket states the withholding — never the previous
 * bucket's numbers.
 */
export function observatoryTakeaway(
  response: ObservatorySeriesResponse,
  axis: BucketAxis,
): string {
  const total = axis.entries.length;
  const gaps: string[] = [];
  if (axis.absentCount > 0) {
    gaps.push(
      `${String(axis.absentCount)} of the ${String(total)} bucket(s) in this window have no complete batch`,
    );
  }
  if (axis.withheldCount > 0) {
    gaps.push(`${String(axis.withheldCount)} bucket(s) withheld`);
  }
  const gapClause = gaps.length > 0 ? `; ${gaps.join(", ")}` : "";
  const newest =
    axis.newestPointIndex >= 0 ? (axis.entries[axis.newestPointIndex]?.point ?? null) : null;
  if (newest === null) {
    return `no bucket in this window is backed by a wire row${gapClause}.`;
  }
  if (newest.refused) {
    return (
      `newest bucket ${newest.bucket_start} withheld (${newest.refusal_code ?? "unnamed"}) — ` +
      `no numbers served for it${gapClause}.`
    );
  }
  const accounts = newest.accounts === null ? EM_DASH : String(newest.accounts);
  return (
    `debt ${displayMetric(newest, "debt_usd", response.usd_decimals)} across ${accounts} ` +
    `account(s) as of bucket ${newest.bucket_start}${gapClause}.`
  );
}

/**
 * The grid's reading line: movement between the FIRST and LAST captured
 * buckets in the window, in the exact ledger strings (displayMetric — never
 * a recomputed percentage). Refusals and absences are the takeaway's job;
 * this line reads only what was captured.
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
    return "no captured bucket in this window — there is no movement to read.";
  }
  if (captured.length === 1) {
    return `only one captured bucket in this window (${first.bucket_start}) — no movement to state.`;
  }
  const usd = response.usd_decimals;
  const counts = (value: number | null) => (value === null ? EM_DASH : String(value));
  return (
    `between captured buckets ${first.bucket_start} and ${last.bucket_start}: ` +
    `debt ${displayMetric(first, "debt_usd", usd)} → ${displayMetric(last, "debt_usd", usd)}, ` +
    `accounts ${counts(first.accounts)} → ${counts(last.accounts)}, ` +
    `liquidatable ${counts(first.liquidatable_positions)} → ${counts(last.liquidatable_positions)}.`
  );
}

/**
 * The bucket record's one-line state — the takeaway of the forensic panel.
 * ABSENT and WITHHELD arms are hazards and never soften.
 */
export function pointDetailTakeaway(entry: BucketEntry): string {
  if (entry.point === null) {
    return `ABSENT · no complete batch in this bucket (${entry.bucketStart}).`;
  }
  if (entry.point.refused) {
    return (
      `withheld (${entry.point.refusal_code ?? "unnamed"}) at ${entry.point.bucket_start} — ` +
      `the engine's whole book was refused at capture time; no numbers served.`
    );
  }
  return `captured at ${entry.point.bucket_start} · watermark block ${formatBlock(entry.point.last_block)}.`;
}
