// The bucket laws for the observatory rollup series (lib/observatory-series),
// pinned: an absent bucket is a NAMED gap ("no complete batch was observed in
// this bucket"), a withheld bucket is a gap carrying its refusal code, a null
// metric is null-not-zero, a money figure that fails its wire guard is a gap
// of its own kind (unreadable — never zero, never a throw), nothing is ever
// interpolated across any of them, and a stride serves each hour VERBATIM
// (gap detection respects it).
// The two sentences the page leads with are pinned in their parts: the
// reader's tier (compact money, grouped counts, the instant from the wire's
// own UTC fields against the envelope's served_at), every arm, and a missing
// or withheld hour named as such — never as a zero.

import { expect, test } from "@playwright/test";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeRange,
  describeStride,
  displayMetric,
  effectiveStrideSeconds,
  metricUnreadable,
  NATIVE_BUCKET_SECONDS,
  seriesMaxPoint,
  seriesNewestPoint,
  strideWord,
  gridReadingLine,
  observatoryTakeaway,
  pointDetailTakeaway,
  sparseCaptureLine,
} from "../../lib/observatory-series";
import { EM_DASH, formatBlock } from "../../lib/format";
import { humanUsd } from "../../lib/human-usd";
import { humanUtc } from "../../lib/human-utc";
import type { ObservatorySeriesPoint, ObservatorySeriesResponse } from "../../lib/observatory-data";
import { groupInt } from "../../lib/prose";
import { WireIntegerError } from "../../lib/wireGuard";
import { DEMO_OBSERVATORY_AAVE, DEMO_OBSERVATORY_DM } from "../fixtures/demo";
import { OBSERVATORY_SERIES_AAVE, OBSERVATORY_SERIES_DM } from "../fixtures/observatory";

// humanUtc joins an instant's tokens with U+00A0: a literal instant is written through `nb`, the prose around it
// keeps its ordinary spaces.
const nb = (text: string): string => text.replaceAll(" ", "\u00a0");

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

test("an absent bucket enters the axis as a named gap — no complete batch was OBSERVED in it: the claim is the observation, never that no batch existed", () => {
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
  expect(debt.titles[3]).toContain("no complete batch was observed in this bucket");
  expect(debt.titles[3]).toContain("never interpolated");
  // The rollup writes a row by OBSERVING a batch: an hour also has no row when the rollup did not look or could
  // not write. No word here claims that no batch existed or ran.
  expect(debt.titles[3]).not.toMatch(/no complete batch in this|batch existed|batch ran/);
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

test("a money figure that fails its wire guard is a NAMED hole of its own kind — never placed, never zero, never a throw — and the series around it still plots", () => {
  const at = (hour: string, change: Partial<ObservatorySeriesPoint> = {}) => ({ ...DM_CAPTURED, bucket_start: `2026-07-29T${hour}:00:00Z`, ...change });
  for (const bad of ["", "12.5", "1e9", "0x10", "309 593004", "NaN"]) {
    const body = { ...OBSERVATORY_SERIES_DM, points: [at("06"), at("07", { debt_usd: bad }), at("08")] };
    const axis = buildBucketAxis(body);
    // The hour itself was recorded: the axis counts it as captured, and only this metric of it is a hole.
    expect(axis.entries.map((entry) => entry.kind)).toEqual(["captured", "captured", "captured"]);
    const debt = buildMetricSeries(axis, body, "debt_usd");
    expect(debt.values).toEqual([309.593004, null, 309.593004]);
    expect(debt.gapKinds).toEqual([null, "unreadable", null]);
    expect(debt.titles[1]).toBe(
      "2026-07-29T07:00:00Z · debt (usd) is unreadable in this bucket: the wire's value is not an exact decimal (unreadable is not zero)",
    );
    // Its own kind: not the absent hour's word, not the withheld one's, not the null metric's.
    expect(debt.titles[1]).not.toMatch(/no complete batch|WITHHELD|is null/);
    const bucket = body.points[1];
    if (bucket === undefined) throw new Error("fixture invariant: three points");
    expect(metricUnreadable(bucket, "debt_usd")).toBe(true);
    expect(metricUnreadable(bucket, "collateral_usd")).toBe(false);
    // The exact display is the em dash — the formatter, whose own refusal is a throw, is never reached.
    expect(displayMetric(bucket, "debt_usd", 6)).toBe(EM_DASH);
    // The same hour's other metrics plot: the hole is per-metric.
    expect(buildMetricSeries(axis, body, "collateral_usd").gapKinds).toEqual([null, null, null]);
    // No label is ever drawn from it: the peak and the newest figure are readable hours' own.
    expect(seriesMaxPoint(axis, body, "debt_usd", debt)?.label).toBe("$309.593004");
    expect(seriesNewestPoint(axis, body, "debt_usd", debt)?.directLabel).toBe("$309.593004");
  }
  // At the newest hour, the chart's older label says which hour it belongs to — as it does for a withheld newest hour.
  const newestBad = { ...OBSERVATORY_SERIES_DM, points: [at("06"), at("07", { debt_usd: "12.5" })] };
  const axis = buildBucketAxis(newestBad);
  const debt = buildMetricSeries(axis, newestBad, "debt_usd");
  expect(seriesNewestPoint(axis, newestBad, "debt_usd", debt)).toMatchObject({
    atNewestBucket: false,
    directLabel: "$309.593004 (last captured 2026-07-29T06:00:00Z)",
  });
  expect(sparseCaptureLine(debt)).toBe(
    "1 captured bucket plots in this window · 1 served bucket carries an unreadable value (unreadable is not zero)",
  );
  // A null stays a null, and a count is not money: neither is "unreadable".
  expect(metricUnreadable({ ...DM_CAPTURED, debt_usd: null }, "debt_usd")).toBe(false);
  expect(metricUnreadable(DM_CAPTURED, "accounts")).toBe(false);
});

test("exact displays: usd through the engine's own scale, counts verbatim, null an em dash", () => {
  expect(displayMetric(DM_CAPTURED, "debt_usd", 6)).toBe("$309.593004");
  expect(displayMetric(DM_CAPTURED, "collateral_usd", 6)).toBe("$412.790672");
  expect(displayMetric(DM_CAPTURED, "accounts", 6)).toBe("3");
  expect(displayMetric(DM_CAPTURED, "liquidatable_positions", 6)).toBe("1");
  expect(displayMetric(DM_WITHHELD, "collateral_usd", 6)).toBe(EM_DASH);
  expect(displayMetric(DM_WITHHELD, "liquidatable_positions", 6)).toBe(EM_DASH);
});

test("exact displays are GROUPED: money and counts at or above a thousand wear separators, the digits untouched", () => {
  // One chokepoint: the chart's labels, the hover titles and the bucket record all print these strings.
  const dm = DEMO_OBSERVATORY_DM.points[DEMO_OBSERVATORY_DM.points.length - 1];
  const aave = DEMO_OBSERVATORY_AAVE.points[DEMO_OBSERVATORY_AAVE.points.length - 1];
  if (dm === undefined || aave === undefined) throw new Error("fixture invariant: the demo series carry points");
  expect(displayMetric(dm, "debt_usd", DEMO_OBSERVATORY_DM.usd_decimals)).toBe("$27,828,808.216758");
  expect(displayMetric(dm, "collateral_usd", DEMO_OBSERVATORY_DM.usd_decimals)).toBe("$153,171,572.777189");
  expect(displayMetric(dm, "accounts", DEMO_OBSERVATORY_DM.usd_decimals)).toBe("1,412");
  expect(displayMetric(aave, "debt_usd", DEMO_OBSERVATORY_AAVE.usd_decimals)).toBe("$1,900,000");
  expect(displayMetric(aave, "accounts", DEMO_OBSERVATORY_AAVE.usd_decimals)).toBe("8,552");
  // Grouping is string surgery: strip the separators and the exact decimal is what the wire stated at its scale.
  expect(displayMetric(dm, "debt_usd", 6).replaceAll(",", "")).toBe("$27828808.216758");
  // The hover title and the chart's direct labels carry the same grouped string.
  const axis = buildBucketAxis(DEMO_OBSERVATORY_AAVE);
  const debt = buildMetricSeries(axis, DEMO_OBSERVATORY_AAVE, "debt_usd");
  expect(debt.titles[debt.titles.length - 1]).toContain("debt (usd) $1,900,000 @ block");
  expect(seriesNewestPoint(axis, DEMO_OBSERVATORY_AAVE, "debt_usd", debt)?.directLabel).toBe("$1,900,000");
  expect(seriesMaxPoint(axis, DEMO_OBSERVATORY_AAVE, "debt_usd", debt)?.label).toBe("$1,919,760");
  // The y-max is NAMED: a bare figure at the plot's left edge reads as the window's starting value.
  expect(seriesMaxPoint(axis, DEMO_OBSERVATORY_AAVE, "debt_usd", debt)?.directLabel).toBe("peak $1,919,760");
  // A count outside the contract is refused at the chokepoint, never grouped into a different number.
  expect(() => displayMetric({ ...dm, accounts: -1 }, "accounts", 6)).toThrow(WireIntegerError);
});

test("the stride is disclosed verbatim-or-native — a stride never averages", () => {
  expect(effectiveStrideSeconds(null)).toBe(3600);
  expect(effectiveStrideSeconds(21600)).toBe(21600);
  expect(describeStride(null)).toContain("native hourly");
  expect(describeStride(null)).toContain("verbatim");
  expect(describeStride(21600)).toContain("21600");
  expect(describeStride(21600)).toContain("VERBATIM");
  expect(describeStride(21600)).toContain("never averaged");
  // The service skips relative to the last hour it SERVED, so a hole shifts the grid: never "every Nth".
  expect(describeStride(21600)).not.toMatch(/every Nth/);
});

test("the stride's word for the chip: hourly at the native stride; an applied one as the service applies it — at most one hour in every N", () => {
  expect(strideWord(null)).toBe("hourly");
  expect(strideWord(3600)).toBe("hourly");
  expect(strideWord(7200)).toBe("at most one hour in every 2");
  expect(strideWord(21600)).toBe("at most one hour in every 6");
  expect(strideWord(5000)).toBe("at most one hour per 5,000 seconds");
  for (const word of [strideWord(null), strideWord(7200), strideWord(5000)]) expect(word).not.toMatch(/bucket|verbatim|every \d+(st|nd|rd|th)/i);
  // A stride outside the contract is refused before it is worded.
  expect(() => strideWord(-7200)).toThrow(WireIntegerError);
  expect(() => strideWord(7200.5)).toThrow(WireIntegerError);
});

test("the served range is disclosed, unbounded ends stated as unbounded", () => {
  expect(describeRange(null, null)).toBe("unbounded → unbounded");
  expect(describeRange("2026-07-29T08:00:00Z", null)).toBe("2026-07-29T08:00:00Z → unbounded");
});

// ---------------------------------------------------------------------------
// The direct labels: derived from the drawn domain, one source.
// ---------------------------------------------------------------------------

test("W-OBS: the y-max label IS the max point's ledger display — derived, never retyped — and it is named the window's peak", () => {
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
  // displayMetric call the bucket record prints that hour with.
  const point = axis.entries[maxPoint.index]?.point;
  if (point === null || point === undefined) throw new Error("max point must be wire-backed");
  expect(maxPoint.label).toBe(
    displayMetric(point, "debt_usd", OBSERVATORY_SERIES_AAVE.usd_decimals),
  );
  expect(maxPoint.label).toBe("$928.779012");
  // What the chart prints: the word, then that same string — a peak, not the window's first value.
  expect(maxPoint.directLabel).toBe(`peak ${maxPoint.label}`);
  expect(maxPoint.directLabel).toBe("peak $928.779012");
  const first = axis.entries[0]?.point;
  if (first === null || first === undefined) throw new Error("the first entry must be wire-backed");
  expect(maxPoint.label).not.toBe(displayMetric(first, "debt_usd", OBSERVATORY_SERIES_AAVE.usd_decimals));
});

test("W-OBS: the newest captured point carries that hour's exact figure — the string its record prints", () => {
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_AAVE, "debt_usd");
  const newest = seriesNewestPoint(axis, OBSERVATORY_SERIES_AAVE, "debt_usd", debt);
  if (newest === null) throw new Error("the aave debt series must have a newest point");

  // The last finite value on the axis (index 4 — 10:00), labelled by the
  // same formatter over the same wire row the hour's record prints (the tile
  // above reads that row in the compact tier).
  expect(newest.index).toBe(4);
  const point = axis.entries[4]?.point;
  if (point === null || point === undefined) throw new Error("newest point must be wire-backed");
  expect(newest.label).toBe(
    displayMetric(point, "debt_usd", OBSERVATORY_SERIES_AAVE.usd_decimals),
  );
  expect(newest.label).toBe("$619.186008");

  // The plain arm: the last plotted point IS the newest axis entry, so
  // the direct label is that hour's exact string VERBATIM — an always-qualify
  // mutant would smear "(last captured ...)" onto the newest row itself.
  expect(newest.atNewestBucket).toBe(true);
  expect(newest.directLabel).toBe(newest.label);
});

test("W-OBS-B qualified arm: a direct label older than the axis head states WHICH row it is", () => {
  // The verbatim DM example: the newest axis entry (09:00) is WITHHELD, so
  // the last plotted point is the OLDER 08:00 row. The direct label is that
  // row's exact string PLUS the "(last captured {bucket})" qualifier — the
  // chart may not print an older number unqualified while the newest hour's
  // tile shows the withheld dash. Kills the unqualified-print mutant
  // (directLabel === label here) and the retyped-value mutant (the qualified
  // arm must START with the exact string).
  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_DM, "debt_usd");
  const newest = seriesNewestPoint(axis, OBSERVATORY_SERIES_DM, "debt_usd", debt);
  if (newest === null) throw new Error("the DM debt series must have a newest point");

  expect(newest.index).toBe(0);
  expect(newest.atNewestBucket).toBe(false);
  expect(newest.label).toBe("$309.593004");
  expect(newest.directLabel).toBe(`${newest.label} (last captured 2026-07-29T08:00:00Z)`);
  expect(newest.directLabel).toBe("$309.593004 (last captured 2026-07-29T08:00:00Z)");
  // The qualifier's hour is the plotted entry's own bucketStart — the same
  // UTC string the tiles' subs and the x-axis extents print.
  expect(axis.entries[0]?.bucketStart).toBe("2026-07-29T08:00:00Z");
});

test("W-OBS-B: a null metric on the newest SERVED bucket also qualifies the older label", () => {
  // The qualifier keys on "last plotted vs newest axis entry", not on
  // withheld specifically: a captured newest bucket whose accounts metric is
  // null still forces the accounts chart's direct label onto an older row,
  // and that label must say so. Kills a mutant that qualifies only withheld
  // buckets.
  const nullNewest = {
    ...OBSERVATORY_SERIES_DM,
    points: [
      DM_CAPTURED,
      { ...DM_CAPTURED, bucket_start: "2026-07-29T09:00:00Z", accounts: null },
    ],
  };
  const axis = buildBucketAxis(nullNewest);
  const accounts = buildMetricSeries(axis, nullNewest, "accounts");
  const newest = seriesNewestPoint(axis, nullNewest, "accounts", accounts);
  if (newest === null) throw new Error("the accounts series must have a newest point");
  expect(newest.atNewestBucket).toBe(false);
  expect(newest.directLabel).toBe("3 (last captured 2026-07-29T08:00:00Z)");

  // The debt chart of the SAME response keeps the plain arm: its newest
  // bucket plots, so no qualifier — the two metrics are judged separately.
  const debt = buildMetricSeries(axis, nullNewest, "debt_usd");
  const newestDebt = seriesNewestPoint(axis, nullNewest, "debt_usd", debt);
  if (newestDebt === null) throw new Error("the debt series must have a newest point");
  expect(newestDebt.atNewestBucket).toBe(true);
  expect(newestDebt.directLabel).toBe(newestDebt.label);
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

// ---------------------------------------------------------------------------
// The computed sentences. Expectations are FIXTURE-COMPOSED (the same fields,
// composed independently through the tier's own formatters), never the helper
// echoed back — plus one literal per demo arm, so the words themselves are
// pinned and not only their plumbing.
// ---------------------------------------------------------------------------

const HOLES_GLOSS = "no complete batch was observed";
const lastOf = <T>(items: readonly T[]): T => {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error("fixture invariant: a non-empty list");
  return item;
};

test.describe("observatoryTakeaway — the headline's parts and the dek", () => {
  test("answered, legacy: emphasis = the debt in the compact tier, named for ONE engine; rest = accounts and the hour; the holes are the dek", () => {
    const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
    const newest = axis.entries[axis.newestPointIndex]?.point;
    if (newest === null || newest === undefined || newest.refused || newest.debt_usd === null || newest.accounts === null) {
      throw new Error("fixture invariant: the aave newest bucket is captured and states its debt and accounts");
    }
    const t = observatoryTakeaway(OBSERVATORY_SERIES_AAVE, axis, "aave_v3_etherfi");
    expect(t.emphasis).toBe(
      `${humanUsd(BigInt(newest.debt_usd), OBSERVATORY_SERIES_AAVE.usd_decimals)} of legacy Aave v3 debt is outstanding,`,
    );
    expect(t.rest).toBe(
      `across ${groupInt(newest.accounts)} accounts in the hour starting ${humanUtc(newest.bucket_start, OBSERVATORY_SERIES_AAVE.served_at)}.`,
    );
    expect(t.answered).toBe(true);
    // 4 of 5 recorded: below the promotion threshold, so the holes live in the dek — one absent hour, "it is".
    expect(t.dek).toBe(
      `${String(axis.capturedCount)} of the ${String(axis.entries.length)} hours in this window were recorded. ` +
        `1 is absent — ${HOLES_GLOSS}; it is a gap on the chart, never a zero.`,
    );
    expect(t.holes).toBe(t.dek);
    expect(axis.absentCount).toBe(1);
    expect(axis.withheldCount).toBe(0);
    // The exact ledger figure is NOT the headline's tier: it stays on the chart's labels and in the bucket record.
    expect(t.emphasis).toBe("$619.18 of legacy Aave v3 debt is outstanding,");
    expect(`${t.emphasis} ${t.rest}`).not.toContain("619.186008");
  });

  test("the demo, both engines, literally: the ruled words — and no figure of one engine in the other's sentence", () => {
    const dm = observatoryTakeaway(DEMO_OBSERVATORY_DM, buildBucketAxis(DEMO_OBSERVATORY_DM), "debt_manager");
    expect(dm.emphasis).toBe("$27.8M of Cash debt is outstanding,");
    expect(dm.rest).toBe(`across 1,412 accounts in the hour starting ${nb("Aug 8, 20:00 UTC")}.`);
    const aave = observatoryTakeaway(DEMO_OBSERVATORY_AAVE, buildBucketAxis(DEMO_OBSERVATORY_AAVE), "aave_v3_etherfi");
    expect(aave.emphasis).toBe("$1.9M of legacy Aave v3 debt is outstanding,");
    expect(aave.rest).toBe(`across 8,552 accounts in the hour starting ${nb("Aug 8, 20:00 UTC")}.`);
    const holes =
      "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 1 was withheld; each is a gap on the chart, never a zero.";
    expect(dm.dek).toBe(holes);
    expect(aave.dek).toBe(holes);
    expect(dm.answered && aave.answered).toBe(true);
    // One engine per sentence: never a sum, never a comparison.
    for (const part of [dm.emphasis, dm.rest, dm.dek]) expect(part).not.toMatch(/legacy|Aave|\$1\.9M|8,552/);
    for (const part of [aave.emphasis, aave.rest, aave.dek]) expect(part).not.toMatch(/Cash|\$27\.8M|1,412/);
    // The grammar: no "(s)", no ISO instant, no semicolon-joined second finding, no bucket in the headline.
    for (const t of [dm, aave]) {
      expect(`${t.emphasis} ${t.rest}`).not.toMatch(/\(s\)|\d{4}-\d{2}-\d{2}T|;|bucket/);
      expect(t.emphasis.endsWith(",")).toBe(true);
      expect(t.rest.startsWith(" ")).toBe(false);
      expect(t.rest.endsWith(".")).toBe(true);
    }
  });

  test("the year prints exactly when the hour is not in the year the envelope was served", () => {
    const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
    const nextYear = { ...DEMO_OBSERVATORY_DM, served_at: "2027-01-02T00:00:00Z" };
    expect(observatoryTakeaway(nextYear, axis, "debt_manager").rest).toBe(
      `across 1,412 accounts in the hour starting ${nb("Aug 8, 2026, 20:00 UTC")}.`,
    );
    // A served_at that is no UTC instant names no year, so the year prints: never the browser's clock, never a guess.
    const unread = { ...DEMO_OBSERVATORY_DM, served_at: "yesterday" };
    expect(observatoryTakeaway(unread, axis, "debt_manager").rest).toContain(nb("Aug 8, 2026, 20:00 UTC"));
    // A bucket start that is no UTC instant prints verbatim — never repaired into a time the wire did not state.
    const odd = {
      ...OBSERVATORY_SERIES_DM,
      points: [{ ...DM_CAPTURED, bucket_start: "2026-07-29T08:00:00+02:00" }],
    };
    expect(observatoryTakeaway(odd, buildBucketAxis(odd), "debt_manager").rest).toBe(
      "across 3 accounts in the hour starting 2026-07-29T08:00:00+02:00.",
    );
  });

  test("newest WITHHELD: the headline states the withholding, the dek its cause then the holes — the older hour's numbers never leak", () => {
    const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
    const t = observatoryTakeaway(OBSERVATORY_SERIES_DM, axis, "debt_manager");
    expect(t.emphasis).toBe("The latest hour's figures were withheld,");
    expect(t.rest).toBe(
      `so no current debt figure is shown (${humanUtc(DM_WITHHELD.bucket_start, OBSERVATORY_SERIES_DM.served_at)}).`,
    );
    expect(t.rest).toBe(`so no current debt figure is shown (${nb("Jul 29, 09:00 UTC")}).`);
    expect(t.answered).toBe(false);
    expect(t.holes).toBe("1 of the 2 hours in this window was recorded. 1 was withheld; it is a gap on the chart, never a zero.");
    expect(t.dek).toBe(
      `The engine's whole book was refused in that hour (collateral-flag custody unproven · ${DM_WITHHELD.refusal_code ?? "NEVER"}). ${t.holes}`,
    );
    const whole = `${t.emphasis} ${t.rest} ${t.dek}`;
    expect(whole).not.toContain(displayMetric(DM_CAPTURED, "debt_usd", OBSERVATORY_SERIES_DM.usd_decimals));
    expect(whole).not.toContain(humanUsd(BigInt(DM_CAPTURED.debt_usd ?? "0"), OBSERVATORY_SERIES_DM.usd_decimals));
    expect(whole).not.toContain("$");
  });

  test("a withheld hour's cause: a code the phrasebook does not know is named once; a refusal with no code says so", () => {
    const withCode = (refusal_code: string | null) => {
      const body = { ...OBSERVATORY_SERIES_DM, points: [DM_CAPTURED, { ...DM_WITHHELD, refusal_code }] };
      return observatoryTakeaway(body, buildBucketAxis(body), "debt_manager").dek;
    };
    expect(withCode("NEW_CODE")).toContain("was refused in that hour (refused (NEW_CODE)). ");
    expect(withCode(null)).toContain("was refused in that hour (the engine gave no reason). ");
    expect(withCode("")).toContain("was refused in that hour (the engine gave no reason). ");
    expect(withCode("SWEEP_FAILED")).toContain("(collateral sweep failed · SWEEP_FAILED)");
  });

  test("newest captured with NO debt figure: said as not stated — dashed, never $0; an unreadable decimal is said as unreadable", () => {
    const at = (debt_usd: string | null) => {
      const body = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_CAPTURED, debt_usd }] };
      return observatoryTakeaway(body, buildBucketAxis(body), "debt_manager");
    };
    const hour = humanUtc(DM_CAPTURED.bucket_start, OBSERVATORY_SERIES_DM.served_at);
    const none = at(null);
    expect(none.emphasis).toBe("The latest hour states no debt figure,");
    expect(none.rest).toBe(`in the hour starting ${hour}. Not stated is not zero.`);
    expect(none.answered).toBe(false);
    expect(none.dek).toBe("The only hour in this window was recorded.");
    for (const bad of ["", "12.5", "1e9", "0x10"]) {
      const unread = at(bad);
      expect(unread.emphasis).toBe("The latest hour's debt figure cannot be read,");
      expect(unread.rest).toBe(`in the hour starting ${hour}. Unreadable is not zero.`);
      expect(unread.answered).toBe(false);
    }
    expect(`${none.emphasis} ${none.rest}`).not.toContain("$");
  });

  test("accounts not stated: the debt still answers, and the missing count is named — never 0 accounts", () => {
    const body = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_CAPTURED, accounts: null }] };
    const t = observatoryTakeaway(body, buildBucketAxis(body), "debt_manager");
    expect(t.emphasis).toBe("$309.59 of Cash debt is outstanding,");
    expect(t.rest).toBe(
      `in the hour starting ${humanUtc(DM_CAPTURED.bucket_start, body.served_at)}; the account count was not stated.`,
    );
    expect(t.answered).toBe(true);
    // One account is one account.
    const one = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_CAPTURED, accounts: 1 }] };
    expect(observatoryTakeaway(one, buildBucketAxis(one), "debt_manager").rest).toContain("across 1 account in the hour");
    // An out-of-contract count is refused before the sentence, never formatted.
    const bad = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_CAPTURED, accounts: -0 }] };
    expect(() => observatoryTakeaway(bad, buildBucketAxis(bad), "debt_manager")).toThrow(WireIntegerError);
  });

  test("no recorded hour in the window: a missing record, named for the engine — not a zero", () => {
    const empty = { ...OBSERVATORY_SERIES_DM, points: [] };
    const axis = buildBucketAxis(empty);
    expect(observatoryTakeaway(empty, axis, "debt_manager")).toEqual({
      emphasis: "No hour in this window was recorded.",
      rest: "",
      holes: "",
      dek: "No complete batch was observed for Cash in this range, so there is nothing to chart. That is a missing record, not a zero.",
      answered: false,
    });
    // In a sentence the legacy market is named as prose names it — one phrasing, the product's (lib/prose).
    expect(observatoryTakeaway(empty, axis, "aave_v3_etherfi").dek).toBe(
      "No complete batch was observed for the legacy Aave v3 market in this range, so there is nothing to chart. That is a missing record, not a zero.",
    );
  });

  test("more hole than record (captured * 2 <= total): the recorded count is promoted into the headline, and the dek keeps what each hole is", () => {
    const at = (hour: string) => ({ ...DM_CAPTURED, bucket_start: `2026-07-29T${hour}:00:00Z` });
    // 06 captured · 07, 08 absent · 09 captured: 2 of 4 — the boundary, promoted.
    const half = { ...OBSERVATORY_SERIES_DM, points: [at("06"), at("09")] };
    const halfAxis = buildBucketAxis(half);
    expect([halfAxis.capturedCount, halfAxis.entries.length]).toEqual([2, 4]);
    const t = observatoryTakeaway(half, halfAxis, "debt_manager");
    expect(t.emphasis).toBe("$309.59 of Cash debt is outstanding,");
    expect(t.rest).toBe(
      `across 3 accounts in the hour starting ${nb("Jul 29, 09:00 UTC")} — but only 2 of the 4 hours in this window were recorded.`,
    );
    expect(t.dek).toBe(`2 are absent — ${HOLES_GLOSS}; each is a gap on the chart, never a zero.`);
    expect(t.answered).toBe(true);
    // 06 captured · 07 absent · 08 captured: 2 of 3 — one hour past the boundary, so the holes stay in the dek.
    const most = { ...OBSERVATORY_SERIES_DM, points: [at("06"), at("08")] };
    const kept = observatoryTakeaway(most, buildBucketAxis(most), "debt_manager");
    expect(kept.rest).toBe(`across 3 accounts in the hour starting ${nb("Jul 29, 08:00 UTC")}.`);
    expect(kept.dek).toBe(`2 of the 3 hours in this window were recorded. 1 is absent — ${HOLES_GLOSS}; it is a gap on the chart, never a zero.`);
    // One recorded hour of many: the verb follows the count.
    const lone = { ...OBSERVATORY_SERIES_DM, points: [{ ...DM_WITHHELD, bucket_start: "2026-07-29T06:00:00Z" }, at("08")] };
    expect(observatoryTakeaway(lone, buildBucketAxis(lone), "debt_manager").rest).toContain(
      "— but only 1 of the 3 hours in this window was recorded.",
    );
  });

  test("the holes sentence, every arm: whole · one hour · none recorded · either clause alone · the sampled unit", () => {
    const at = (hour: string) => ({ ...DM_CAPTURED, bucket_start: `2026-07-29T${hour}:00:00Z` });
    const holesOf = (body: ObservatorySeriesResponse) =>
      observatoryTakeaway(body, buildBucketAxis(body), "debt_manager").holes;
    expect(holesOf({ ...OBSERVATORY_SERIES_DM, points: [at("06"), at("07"), at("08")] })).toBe(
      "All 3 hours in this window were recorded.",
    );
    expect(holesOf({ ...OBSERVATORY_SERIES_DM, points: [at("06")] })).toBe("The only hour in this window was recorded.");
    expect(holesOf({ ...OBSERVATORY_SERIES_DM, points: [DM_WITHHELD] })).toBe(
      "The only hour in this window was not recorded. 1 was withheld; it is a gap on the chart, never a zero.",
    );
    expect(
      holesOf({ ...OBSERVATORY_SERIES_DM, points: [DM_WITHHELD, { ...DM_WITHHELD, bucket_start: "2026-07-29T11:00:00Z" }] }),
    ).toBe(
      `None of the 3 hours in this window was recorded. 1 is absent — ${HOLES_GLOSS} — and 2 were withheld; each is a gap on the chart, never a zero.`,
    );
    // A stride the service applied: the unit is a SAMPLED hour, and what the stride is, is said once.
    const stepped = { ...OBSERVATORY_SERIES_DM, step_seconds: 7200, points: [at("04"), at("06"), at("08"), at("12")] };
    expect(holesOf(stepped)).toBe(
      `4 of the 5 sampled hours in this window were recorded. 1 is absent — ${HOLES_GLOSS}; it is a gap on the chart, never a zero. ` +
        "The hours are sampled: the service serves at most one in every 2.",
    );
    expect(holesOf({ ...stepped, step_seconds: 5000, points: [at("06")] })).toBe(
      "The only sampled hour in this window was recorded. The hours are sampled: the service serves at most one per 5,000 seconds.",
    );
    // The native stride echoed back is still the native hour.
    expect(holesOf({ ...OBSERVATORY_SERIES_DM, step_seconds: 3600, points: [at("06")] })).toBe(
      "The only hour in this window was recorded.",
    );
    // No hole is ever worded as a zero, a none or a nothing of value.
    expect(holesOf(OBSERVATORY_SERIES_DM)).not.toMatch(/\b0\b|\$0|zero debt/);
  });
});

test.describe("gridReadingLine — the chart's finding, as deltas", () => {
  test("movement between the first and last RECORDED hours: one subtraction per metric, in the reader's tier", () => {
    const axis = buildBucketAxis(DEMO_OBSERVATORY_AAVE);
    const captured = axis.entries.filter((entry) => entry.point !== null && !entry.point.refused);
    const first = captured[0]?.point;
    const last = lastOf(captured).point;
    if (first === null || first === undefined || last === null) throw new Error("fixture invariant: aave carries captured buckets");
    if (first.debt_usd === null || last.debt_usd === null || first.accounts === null || last.accounts === null) {
      throw new Error("fixture invariant: the demo's end hours state debt and accounts");
    }
    if (first.liquidatable_positions === null || last.liquidatable_positions === null) {
      throw new Error("fixture invariant: the demo's end hours state their liquidatable counts");
    }
    const usd = DEMO_OBSERVATORY_AAVE.usd_decimals;
    const served = DEMO_OBSERVATORY_AAVE.served_at;
    // Composed independently: the deltas by this spec's own subtraction, the fixture's direction asserted first.
    const debtFall = BigInt(first.debt_usd) - BigInt(last.debt_usd);
    const accountsFall = first.accounts - last.accounts;
    const liquidatableRise = last.liquidatable_positions - first.liquidatable_positions;
    expect(debtFall > 0n && accountsFall > 0 && liquidatableRise > 0).toBe(true);
    const span = `${humanUtc(first.bucket_start, served).replace(/\u00a0UTC$/, "")} → ${humanUtc(last.bucket_start, served)}`;
    expect(gridReadingLine(DEMO_OBSERVATORY_AAVE, axis)).toBe(
      `Between the first and last recorded hours (${span}), ` +
        `debt fell by ${humanUsd(debtFall, usd)}, to ${humanUsd(BigInt(last.debt_usd), usd)}; ` +
        `accounts fell by ${groupInt(accountsFall)}, to ${groupInt(last.accounts)}; ` +
        `and liquidatable positions rose by ${groupInt(liquidatableRise)}, to ${groupInt(last.liquidatable_positions)}.`,
    );
  });

  test("the demo, both engines, literally — a delta, never a percentage, never an arrow pair the compact tier would flatten", () => {
    const span = `${nb("Aug 1, 21:00")} → ${nb("Aug 8, 20:00 UTC")}`;
    const aave = gridReadingLine(DEMO_OBSERVATORY_AAVE, buildBucketAxis(DEMO_OBSERVATORY_AAVE));
    expect(aave).toBe(
      `Between the first and last recorded hours (${span}), debt fell by $11K, to $1.9M; accounts fell by 91, to 8,552; and liquidatable positions rose by 1, to 46.`,
    );
    const dm = gridReadingLine(DEMO_OBSERVATORY_DM, buildBucketAxis(DEMO_OBSERVATORY_DM));
    expect(dm).toBe(
      `Between the first and last recorded hours (${span}), debt rose by $1.8M, to $27.8M; accounts fell by 52, to 1,412; and liquidatable positions rose by 1, to 49.`,
    );
    // A change and its end are told apart in words: "rose 1 to 49" reads as a range from 1 to 49.
    for (const line of [aave, dm]) expect(line).not.toMatch(/(rose|fell) [$\d][^ ]* to /);
    for (const line of [aave, dm]) expect(line).not.toMatch(/%|\$[0-9.,KMB]+ → \$|\d{4}-\d{2}-\d{2}T/);
    expect(dm).not.toMatch(/legacy|Aave|8,552/);
    expect(aave).not.toMatch(/Cash|1,412/);
  });

  test("unchanged, and not stated: an equal end is said as unchanged; a null end gives no change — never a delta against zero", () => {
    // The contract's aave example: debt and liquidatable equal at both ends, accounts 5 → 6.
    const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
    expect(gridReadingLine(OBSERVATORY_SERIES_AAVE, axis)).toBe(
      `Between the first and last recorded hours (${nb("Jul 29, 06:00")} → ${nb("Jul 29, 10:00 UTC")}), ` +
        "debt unchanged at $619.18; accounts rose by 1, to 6; and liquidatable positions unchanged at 0.",
    );
    const two = (change: Partial<ObservatorySeriesPoint>, both = false) => {
      const body = {
        ...OBSERVATORY_SERIES_DM,
        points: [{ ...DM_CAPTURED, ...(both ? change : {}) }, { ...DM_CAPTURED, bucket_start: "2026-07-29T09:00:00Z", ...change }],
      };
      return gridReadingLine(body, buildBucketAxis(body));
    };
    expect(two({ accounts: null })).toContain("; accounts not stated at one end, so no change is given; and ");
    expect(two({ accounts: null }, true)).toContain("; accounts not stated at either end, so no change is given; and ");
    expect(two({ debt_usd: null })).toContain("debt not stated at one end, so no change is given; accounts unchanged at 3;");
    expect(two({ debt_usd: "12.5" })).toContain("debt unreadable at one end, so no change is given;");
    expect(two({ debt_usd: "" }, true)).toContain("debt unreadable at either end, so no change is given;");
    expect(two({ liquidatable_positions: null })).toContain("and liquidatable positions not stated at one end, so no change is given.");
    for (const line of [two({ accounts: null }), two({ debt_usd: null }), two({ liquidatable_positions: null })]) {
      expect(line).not.toMatch(/\$0\b|fell by 3, to|to 0\b/);
    }
    // A count outside the contract is refused before the subtraction.
    expect(() => two({ accounts: 2.5 })).toThrow(WireIntegerError);
  });

  test("one recorded hour: no movement is stated, and no refused number stands in; none: nothing to read", () => {
    const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
    expect(gridReadingLine(OBSERVATORY_SERIES_DM, axis)).toBe(
      `Only one hour in this window was recorded (${humanUtc(DM_CAPTURED.bucket_start, OBSERVATORY_SERIES_DM.served_at)}), so there is no movement to state.`,
    );
    expect(gridReadingLine(OBSERVATORY_SERIES_DM, axis)).toBe(
      `Only one hour in this window was recorded (${nb("Jul 29, 08:00 UTC")}), so there is no movement to state.`,
    );
    const none = { ...OBSERVATORY_SERIES_DM, points: [DM_WITHHELD] };
    expect(gridReadingLine(none, buildBucketAxis(none))).toBe(
      "No hour in this window was recorded, so there is no movement to read.",
    );
  });
});

test.describe("W-3L — pointDetailTakeaway", () => {
  test("captured / withheld / absent arms, each in its own register", () => {
    const aaveAxis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
    const capturedEntry = aaveAxis.entries[aaveAxis.newestPointIndex];
    if (capturedEntry === undefined || capturedEntry.point === null) {
      throw new Error("fixture invariant: aave newest entry is wire-backed");
    }
    expect(pointDetailTakeaway(capturedEntry)).toBe(
      `captured at ${capturedEntry.point.bucket_start} · watermark block ${formatBlock(capturedEntry.point.last_block)}.`,
    );

    const dmAxis = buildBucketAxis(OBSERVATORY_SERIES_DM);
    const withheldEntry = dmAxis.entries[1];
    if (withheldEntry === undefined || withheldEntry.kind !== "withheld") {
      throw new Error("fixture invariant: the DM newest entry is withheld");
    }
    expect(pointDetailTakeaway(withheldEntry)).toBe(
      `withheld (${DM_WITHHELD.refusal_code ?? "unnamed"}) at ${DM_WITHHELD.bucket_start} — ` +
        `the engine's whole book was refused at capture time; no numbers served.`,
    );

    expect(
      pointDetailTakeaway({ bucketStart: "2026-07-29T07:00:00Z", kind: "absent", point: null }),
    ).toBe("ABSENT · no complete batch was observed in this bucket (2026-07-29T07:00:00Z).");
  });
});
