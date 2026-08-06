// The bucket laws for the observatory rollup series (lib/observatory-series),
// pinned: an absent bucket is a NAMED gap ("no complete batch in this
// bucket"), a withheld bucket is a gap carrying its refusal code, a null
// metric is null-not-zero, nothing is ever interpolated across any of them,
// and a stride serves every Nth bucket VERBATIM (gap detection respects it).

import { expect, test } from "@playwright/test";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeRange,
  describeStride,
  displayMetric,
  effectiveStrideSeconds,
  NATIVE_BUCKET_SECONDS,
  seriesMaxPoint,
  seriesNewestPoint,
  sparseCaptureLine,
} from "../../lib/observatory-series";
import { EM_DASH } from "../../lib/format";
import { OBSERVATORY_SERIES_AAVE, OBSERVATORY_SERIES_DM } from "../fixtures/observatory";

const DM_CAPTURED = OBSERVATORY_SERIES_DM.points.find((point) => !point.refused);
const DM_WITHHELD = OBSERVATORY_SERIES_DM.points.find((point) => point.refused);
if (DM_CAPTURED === undefined || DM_WITHHELD === undefined) {
  throw new Error("fixture invariant: the DM example carries one captured + one withheld bucket");
}

test("the verbatim DM example: adjacent hourly buckets, no absent filler", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  expect(axis.entries.map((entry) => entry.kind)).toEqual(["captured", "withheld"]);
  expect(axis.strideSeconds).toBe(NATIVE_BUCKET_SECONDS);
  expect(axis.capturedCount).toBe(1);
  expect(axis.withheldCount).toBe(1);
  expect(axis.absentCount).toBe(0);
  // The newest wire-backed bucket is the WITHHELD one — refusals are points
  // in the record, not filtered rows.
  expect(axis.newestPointIndex).toBe(1);
});

test("a withheld bucket is a GAP carrying its named refusal — never a value, never 0", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_DM, "debt_usd");
  expect(debt.values).toEqual([309.593004, null]);
  expect(debt.gapKinds).toEqual([null, "withheld"]);
  expect(debt.titles[1]).toContain("WITHHELD · FLAG_CUSTODY_UNPROVEN");
  expect(debt.titles[1]).toContain("never 0");
  // The exact display for the withheld bucket is an em dash, NEVER "0".
  expect(displayMetric(DM_WITHHELD, "debt_usd", OBSERVATORY_SERIES_DM.usd_decimals)).toBe(EM_DASH);
  expect(displayMetric(DM_WITHHELD, "accounts", OBSERVATORY_SERIES_DM.usd_decimals)).toBe(EM_DASH);
});

test("an absent bucket enters the axis as a named gap — no complete batch in this bucket", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  // 06,07,08 captured · 09 ABSENT (inserted) · 10 captured.
  expect(axis.entries.map((entry) => entry.kind)).toEqual([
    "captured",
    "captured",
    "captured",
    "absent",
    "captured",
  ]);
  expect(axis.entries[3]?.bucketStart).toBe("2026-07-29T09:00:00Z");
  expect(axis.entries[3]?.point).toBeNull();
  expect(axis.absentCount).toBe(1);

  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_AAVE, "debt_usd");
  expect(debt.values[3]).toBeNull(); // the line BREAKS — never interpolated
  expect(debt.gapKinds[3]).toBe("absent");
  expect(debt.titles[3]).toContain("no complete batch in this bucket");
  expect(debt.titles[3]).toContain("never interpolated");
  // Neighbours still plot their own display-precision geometry.
  expect(debt.values[2]).toBeCloseTo(928.779012, 6);
  expect(debt.values[4]).toBeCloseTo(619.186008, 6);
});

test("a captured point's title carries its provenance: bucket as-of + watermark block", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_DM, "debt_usd");
  expect(debt.titles[0]).toContain("2026-07-29T08:00:00Z");
  expect(debt.titles[0]).toContain("$309.593004");
  expect(debt.titles[0]).toContain("block 154,794,000");
  expect(debt.titles[0]).toContain("captured from the newest complete batch");
});

test("gap detection respects the APPLIED stride — a downsampled series has no invented holes", () => {
  const at = (hour: string) => ({ ...DM_CAPTURED, bucket_start: `2026-07-29T${hour}:00:00Z` });
  const stepped = {
    ...OBSERVATORY_SERIES_DM,
    step_seconds: 7200,
    points: [at("06"), at("08"), at("10")],
  };
  // Adjacent at the applied stride: no absent filler.
  expect(buildBucketAxis(stepped).entries.map((e) => e.kind)).toEqual([
    "captured",
    "captured",
    "captured",
  ]);
  // A missing stride slot IS an absent bucket.
  const holed = { ...stepped, points: [at("06"), at("10")] };
  const axis = buildBucketAxis(holed);
  expect(axis.entries.map((e) => e.kind)).toEqual(["captured", "absent", "captured"]);
  expect(axis.entries[1]?.bucketStart).toBe("2026-07-29T08:00:00Z");
});

test("wire points are ordered deterministically even if served shuffled", () => {
  const shuffled = {
    ...OBSERVATORY_SERIES_AAVE,
    points: [...OBSERVATORY_SERIES_AAVE.points].reverse(),
  };
  const axis = buildBucketAxis(shuffled);
  expect(axis.entries.map((entry) => entry.bucketStart)).toEqual([
    "2026-07-29T06:00:00Z",
    "2026-07-29T07:00:00Z",
    "2026-07-29T08:00:00Z",
    "2026-07-29T09:00:00Z",
    "2026-07-29T10:00:00Z",
  ]);
});

test("a null metric on a SERVED bucket is a gap saying null-is-not-zero", () => {
  const nullAccounts = { ...DM_CAPTURED, accounts: null };
  const series = {
    ...OBSERVATORY_SERIES_DM,
    points: [nullAccounts],
  };
  const axis = buildBucketAxis(series);
  const accounts = buildMetricSeries(axis, series, "accounts");
  expect(accounts.values).toEqual([null]);
  expect(accounts.gapKinds).toEqual(["null"]);
  expect(accounts.titles[0]).toContain("null is not zero");
  // The debt metric on the same bucket still plots — the gap is per-metric.
  const debt = buildMetricSeries(axis, series, "debt_usd");
  expect(debt.values).toEqual([309.593004]);
});

test("exact displays: usd through the engine's own scale, counts verbatim, null an em dash", () => {
  expect(displayMetric(DM_CAPTURED, "debt_usd", 6)).toBe("$309.593004");
  expect(displayMetric(DM_CAPTURED, "collateral_usd", 6)).toBe("$412.790672");
  expect(displayMetric(DM_CAPTURED, "accounts", 6)).toBe("3");
  expect(displayMetric(DM_CAPTURED, "liquidatable_positions", 6)).toBe("1");
  expect(displayMetric(DM_WITHHELD, "collateral_usd", 6)).toBe(EM_DASH);
  expect(displayMetric(DM_WITHHELD, "liquidatable_positions", 6)).toBe(EM_DASH);
});

test("the stride is disclosed verbatim-or-native — a stride never averages", () => {
  expect(effectiveStrideSeconds(null)).toBe(3600);
  expect(effectiveStrideSeconds(21600)).toBe(21600);
  expect(describeStride(null)).toContain("native hourly");
  expect(describeStride(null)).toContain("verbatim");
  expect(describeStride(21600)).toContain("21600");
  expect(describeStride(21600)).toContain("VERBATIM");
  expect(describeStride(21600)).toContain("never averaged");
});

test("the served range is disclosed, unbounded ends stated as unbounded", () => {
  expect(describeRange(null, null)).toBe("unbounded → unbounded");
  expect(describeRange("2026-07-29T08:00:00Z", null)).toBe("2026-07-29T08:00:00Z → unbounded");
});

// ---------------------------------------------------------------------------
// Wave W-OBS — the direct labels: derived from the drawn domain, one source.
// ---------------------------------------------------------------------------

test("W-OBS: the y-max label IS the max point's ledger display — derived, never retyped", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_AAVE, "debt_usd");
  const maxPoint = seriesMaxPoint(axis, OBSERVATORY_SERIES_AAVE, "debt_usd", debt);
  if (maxPoint === null) throw new Error("the aave debt series must have a max point");

  // The drawn y-domain is [0, max of finite values]: the labelled value IS
  // the drawn max, and ties keep the first (oldest) occurrence.
  const finite = debt.values.filter((v): v is number => v !== null);
  expect(maxPoint.value).toBe(Math.max(...finite));
  expect(maxPoint.index).toBe(1); // 07:00 and 08:00 tie; the first wins

  // The label equals the formatter output of the drawn max: the SAME
  // displayMetric call the summary cards and the bucket record use.
  const point = axis.entries[maxPoint.index]?.point;
  if (point === null || point === undefined) throw new Error("max point must be wire-backed");
  expect(maxPoint.label).toBe(
    displayMetric(point, "debt_usd", OBSERVATORY_SERIES_AAVE.usd_decimals),
  );
  expect(maxPoint.label).toBe("$928.779012");
});

test("W-OBS: the newest captured point carries the summary card's exact figure", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_AAVE, "debt_usd");
  const newest = seriesNewestPoint(axis, OBSERVATORY_SERIES_AAVE, "debt_usd", debt);
  if (newest === null) throw new Error("the aave debt series must have a newest point");

  // The last finite value on the axis (index 4 — 10:00), labelled by the
  // same formatter over the same wire row the newest-bucket card renders.
  expect(newest.index).toBe(4);
  const point = axis.entries[4]?.point;
  if (point === null || point === undefined) throw new Error("newest point must be wire-backed");
  expect(newest.label).toBe(
    displayMetric(point, "debt_usd", OBSERVATORY_SERIES_AAVE.usd_decimals),
  );
  expect(newest.label).toBe("$619.186008");
});

test("W-OBS: max/newest are null when nothing plots — no label is ever invented", () => {
  const withheldOnly = { ...OBSERVATORY_SERIES_DM, points: [DM_WITHHELD] };
  const axis = buildBucketAxis(withheldOnly);
  const debt = buildMetricSeries(axis, withheldOnly, "debt_usd");
  expect(seriesMaxPoint(axis, withheldOnly, "debt_usd", debt)).toBeNull();
  expect(seriesNewestPoint(axis, withheldOnly, "debt_usd", debt)).toBeNull();
});

test("W-OBS: the sparse STATE line appears exactly when one or fewer captured points plot", () => {
  // Four plotted points: silent.
  const aaveAxis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  expect(sparseCaptureLine(buildMetricSeries(aaveAxis, OBSERVATORY_SERIES_AAVE, "debt_usd"))).toBeNull();

  // The verbatim DM example: one captured + one withheld — the line renders,
  // computed, in the absent/withheld register.
  const dmAxis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  expect(sparseCaptureLine(buildMetricSeries(dmAxis, OBSERVATORY_SERIES_DM, "debt_usd"))).toBe(
    "1 captured bucket plots in this window · 1 withheld bucket stays a named refusal",
  );

  // The boundary: exactly TWO plotted points stay silent (threshold is <= 1).
  const two = {
    ...OBSERVATORY_SERIES_DM,
    points: [DM_CAPTURED, { ...DM_CAPTURED, bucket_start: "2026-07-29T09:00:00Z" }],
  };
  const twoAxis = buildBucketAxis(two);
  expect(sparseCaptureLine(buildMetricSeries(twoAxis, two, "debt_usd"))).toBeNull();

  // Zero plotted with an absent hole: both counts state themselves.
  const holed = {
    ...OBSERVATORY_SERIES_DM,
    points: [DM_WITHHELD, { ...DM_WITHHELD, bucket_start: "2026-07-29T11:00:00Z" }],
  };
  const holedAxis = buildBucketAxis(holed);
  expect(sparseCaptureLine(buildMetricSeries(holedAxis, holed, "debt_usd"))).toBe(
    "0 captured buckets plot in this window · 1 absent bucket renders as a gap · 2 withheld buckets stay named refusals",
  );

  // A served-but-null metric is its own named class, never zero.
  const nullAccounts = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_CAPTURED, accounts: null }] };
  const nullAxis = buildBucketAxis(nullAccounts);
  expect(sparseCaptureLine(buildMetricSeries(nullAxis, nullAccounts, "accounts"))).toBe(
    "0 captured buckets plot in this window · 1 served bucket carries a null value (null is not zero)",
  );
});
