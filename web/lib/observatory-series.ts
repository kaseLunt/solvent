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
        `${entry.bucketStart} — no complete batch in this bucket — nothing was captured; absence is stated, never interpolated`,
      );
      gapKinds.push("absent");
      continue;
    }
    const point = entry.point;
    if (point.refused) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} — WITHHELD · ${point.refusal_code ?? "unnamed"} @ block ${formatBlock(point.last_block)} — totals are null for that reason, never 0`,
      );
      gapKinds.push("withheld");
      continue;
    }
    const raw = rawMetric(point, metric);
    const value = geometryOf(raw, response.usd_decimals);
    if (raw === null || value === null) {
      values.push(null);
      titles.push(
        `${entry.bucketStart} — ${METRIC_LABELS[metric]} is null in this bucket (null is not zero)`,
      );
      gapKinds.push("null");
      continue;
    }
    values.push(value);
    titles.push(
      `${entry.bucketStart} · ${METRIC_LABELS[metric]} ${displayMetric(point, metric, response.usd_decimals)} @ block ${formatBlock(point.last_block)} — captured from the newest complete batch in this bucket`,
    );
    gapKinds.push(null);
  }

  return { values, titles, gapKinds };
}

/** The stride, disclosed. A stride never averages — it serves every Nth bucket. */
export function describeStride(stepSeconds: number | null): string {
  if (stepSeconds === null) {
    return "native hourly buckets — every captured bucket served verbatim";
  }
  return `stride ${String(stepSeconds)}s — every Nth captured bucket VERBATIM, skipped buckets are never averaged`;
}

/** The served range, disclosed. Absent bounds are unbounded, and say so. */
export function describeRange(from: string | null, to: string | null): string {
  return `${from ?? "unbounded"} → ${to ?? "unbounded"}`;
}
