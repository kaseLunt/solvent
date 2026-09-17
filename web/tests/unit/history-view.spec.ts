// web/tests/unit/history-view.spec.ts
// History's one view model: header, chips, tiles, finding and doctrine, derived
// once from a series reading. The headline IS observatoryTakeaway(...) and the
// finding IS gridReadingLine(...) — pinned equal to the functions called
// directly, so the header and the module's own sentence cannot drift. The
// tiles are the demo Book's aggregates at the newest bucket (the weld's law)
// through the Book's money tier and the population guard; a withheld, absent
// or null newest bucket is a dashed tile with the gap's word, never a 0.
import { expect, test } from "@playwright/test";
import {
  deriveHistoryView,
  HISTORY_DEGRADED_NOTE,
  HISTORY_DEK,
  HISTORY_DOCTRINE,
  HISTORY_INTRO,
  HISTORY_UNAVAILABLE_CLAUSE,
  HISTORY_UNREADABLE_SCALE,
  type HistoryReading,
} from "../../lib/history-view";
import { humanUsd } from "../../lib/human-usd";
import { sentence } from "../../lib/lab-headline";
import type { ObservatorySeriesResponse } from "../../lib/observatory-data";
import {
  buildBucketAxis,
  describeRange,
  describeStride,
  gridReadingLine,
  observatoryTakeaway,
} from "../../lib/observatory-series";
import { groupInt } from "../../lib/prose";
import { WireIntegerError } from "../../lib/wireGuard";
import { DEMO_BOOK, DEMO_OBSERVATORY_AAVE, DEMO_OBSERVATORY_DM } from "../fixtures/demo";
import { OBSERVATORY_DEGRADED, OBSERVATORY_SERIES_DM } from "../fixtures/observatory";

// The wire's `engine` is the schema's string; the reading asks by the contract's own vocabulary.
const ok = (response: ObservatorySeriesResponse, metric: HistoryReading["metric"] = "debt_usd"): HistoryReading => ({
  engine: response.engine === "debt_manager" ? "debt_manager" : "aave_v3_etherfi",
  metric,
  phase: "ok",
  response,
  message: null,
});

const card = (engine: string) => DEMO_BOOK.engines.find((e) => e.engine === engine)!;
const newestOf = (response: ObservatorySeriesResponse) => response.points[response.points.length - 1]!;
const tile = (v: ReturnType<typeof deriveHistoryView>, key: string) => v.tiles.find((t) => t.key === key)!;
const chip = (v: ReturnType<typeof deriveHistoryView>, label: string) => v.chips.find((c) => c.label === label);

test("ok, Cash: state ok; the kicker names the engine; the headline IS observatoryTakeaway, tone ok, rest empty; the dek is the one clause; the finding IS gridReadingLine", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  expect(v.state).toBe("ok");
  expect(v.kicker).toBe("History · Cash");
  expect(v.headline).toEqual({
    emphasis: observatoryTakeaway(DEMO_OBSERVATORY_DM, axis),
    rest: "",
    tone: "ok",
    dek: HISTORY_DEK,
  });
  expect(HISTORY_DEK).toBe("One engine per view; a missing hour is a hole, never a zero.");
  expect(v.finding).toBe(gridReadingLine(DEMO_OBSERVATORY_DM, axis));
  expect(v.chartLabel).toBe("debt (usd) for Cash across rollup buckets");
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM, "accounts")).chartLabel).toBe("accounts for Cash across rollup buckets");
});

test("ok, legacy: the kicker names the legacy market as legacy", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_AAVE));
  expect(v.kicker).toBe("History · Aave v3 market (legacy)");
  expect(v.headline.emphasis).toBe(observatoryTakeaway(DEMO_OBSERVATORY_AAVE, buildBucketAxis(DEMO_OBSERVATORY_AAVE)));
  expect(chip(v, "Engine")?.value).toBe("Aave v3 market (legacy)");
});

for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE]) {
  test(`tiles (${body.engine}): debt · collateral · accounts · liquidatable are the Book's aggregates at the newest bucket through humanUsd and groupInt; sub = the bucket time; tone neutral`, () => {
    const v = deriveHistoryView(ok(body));
    const c = card(body.engine);
    const newest = newestOf(body);
    expect(v.tiles.map((t) => t.key)).toEqual(["debt", "collateral", "accounts", "liquidatable"]);
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: humanUsd(BigInt(c.total_debt!), c.value_decimals), sub: `bucket ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "collateral")).toEqual({ key: "collateral", label: "Collateral", value: humanUsd(BigInt(c.total_collateral!), c.value_decimals), sub: `bucket ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "accounts")).toEqual({ key: "accounts", label: "Accounts", value: groupInt(c.positions), sub: `bucket ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "liquidatable")).toEqual({ key: "liquidatable", label: "Liquidatable positions", value: groupInt(c.liquidatable_positions), sub: `bucket ${newest.bucket_start}`, tone: "neutral" });
    // The same strings the weld pinned: the newest wire row IS the Book's card.
    expect(newest.debt_usd).toBe(String(c.total_debt));
    expect(newest.accounts).toBe(c.positions);
  });
}

test("chips: Engine · Stride · Range · Buckets · Served, in that order; the census counts the holes (warn); the stride and range are the module's words; served_at verbatim", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(v.chips.map((c) => c.label)).toEqual(["Engine", "Stride", "Range", "Buckets", "Served"]);
  expect(chip(v, "Engine")).toEqual({ label: "Engine", value: "Cash", title: "debt_manager" });
  expect(chip(v, "Stride")?.value).toBe(describeStride(DEMO_OBSERVATORY_DM.step_seconds));
  expect(chip(v, "Range")?.value).toBe(describeRange(DEMO_OBSERVATORY_DM.from, DEMO_OBSERVATORY_DM.to));
  expect(chip(v, "Buckets")).toEqual({ label: "Buckets", value: "165 captured · 1 withheld · 2 absent", tone: "warn" });
  expect(chip(v, "Served")?.value).toBe(DEMO_OBSERVATORY_DM.served_at);
  // A window with no hole is an ok census.
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-3) };
  expect(chip(deriveHistoryView(ok(whole)), "Buckets")).toEqual({ label: "Buckets", value: "3 captured · 0 withheld · 0 absent", tone: "ok" });
});

test("a withheld newest bucket: every tile is a dashed tile with the word withheld; the headline stays observatoryTakeaway and turns refused", () => {
  const withheld = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) =>
      i === all.length - 1
        ? { ...p, refused: true, refusal_code: "FLAG_CUSTODY_UNPROVEN", debt_usd: null, collateral_usd: null, accounts: null, liquidatable_positions: null, rates: [] }
        : p,
    ),
  };
  const v = deriveHistoryView(ok(withheld));
  expect(v.state).toBe("ok");
  expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: "—", sub: "withheld", tone: "refused" });
  for (const t of v.tiles) expect(t).toMatchObject({ value: "—", sub: "withheld", tone: "refused" });
  expect(v.headline.emphasis).toBe(observatoryTakeaway(withheld, buildBucketAxis(withheld)));
  expect(v.headline.emphasis).toContain("withheld");
  expect(v.headline.tone).toBe("refused");
  // The contract's own example: the newest bucket withheld, one captured before it.
  const example = deriveHistoryView(ok(OBSERVATORY_SERIES_DM));
  expect(example.tiles.every((t) => t.sub === "withheld" && t.value === "—")).toBe(true);
  expect(chip(example, "Buckets")?.value).toBe("1 captured · 1 withheld · 0 absent");
});

test("a null metric on a captured newest bucket is its own dashed tile — not stated, never 0 — while the other tiles answer", () => {
  const nulled = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, debt_usd: null } : p)),
  };
  const v = deriveHistoryView(ok(nulled));
  expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: "—", sub: "not stated", tone: "refused" });
  expect(tile(v, "accounts").tone).toBe("neutral");
  expect(v.headline.tone).toBe("ok");
});

test("an unreadable scale: the record cannot be read — state unavailable, the field named, no tiles, before any figure is formatted at it", () => {
  for (const usd_decimals of [-0, -1, 1001, 6.5]) {
    const v = deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, usd_decimals }));
    expect(v.state).toBe("unavailable");
    expect(v.headline).toEqual({
      emphasis: "The history of Cash cannot be read.",
      rest: "",
      tone: "refused",
      dek: `${HISTORY_UNREADABLE_SCALE} ${HISTORY_UNAVAILABLE_CLAUSE}`,
    });
    expect(v.tiles).toEqual([]);
    expect(v.finding).toBeNull();
    expect(v.chips).toContainEqual({ label: "Record", value: "unreadable", tone: "refused" });
  }
  // The module's own sentences read the newest counts through the throwing read: an out-of-contract count never
  // becomes a number anywhere on the page — it lands at the route boundary, as it did before the convergence.
  const badCount = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, accounts: -3 } : p)),
  };
  expect(() => deriveHistoryView(ok(badCount))).toThrow(WireIntegerError);
});

test("an empty window: every tile says no complete batch; the headline is the module's own no-bucket sentence, refused; the finding is the module's", () => {
  const empty = { ...DEMO_OBSERVATORY_DM, points: [] };
  const v = deriveHistoryView(ok(empty));
  const axis = buildBucketAxis(empty);
  expect(v.state).toBe("ok");
  for (const t of v.tiles) expect(t).toMatchObject({ value: "—", sub: "no complete batch", tone: "refused" });
  expect(v.headline.emphasis).toBe(observatoryTakeaway(empty, axis));
  expect(v.headline.tone).toBe("refused");
  expect(v.finding).toBe(gridReadingLine(empty, axis));
  expect(chip(v, "Buckets")).toEqual({ label: "Buckets", value: "0 captured · 0 withheld · 0 absent", tone: "ok" });
});

test("degraded: state degraded; the refused headline names the engine; the dek is the wire's message as a sentence; no tiles; the deployment note joins the doctrine", () => {
  const message = OBSERVATORY_DEGRADED.error.message;
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "degraded", response: null, message });
  expect(v.state).toBe("degraded");
  expect(v.headline).toEqual({ emphasis: "The durable rollup for Cash is unavailable.", rest: "", tone: "refused", dek: sentence(message) });
  expect(v.tiles).toEqual([]);
  expect(v.finding).toBeNull();
  expect(v.chips[0]).toEqual({ label: "Engine", value: "Cash", title: "debt_manager" });
  expect(v.chips).toContainEqual({ label: "Rollup", value: "unavailable", tone: "refused" });
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, HISTORY_DEGRADED_NOTE]);
  const legacy = deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "degraded", response: null, message });
  expect(legacy.headline.emphasis).toBe("The durable rollup for the Aave v3 market (legacy) is unavailable.");
});

test("loading: the refused tone, tiles empty, the dek stands, the Buckets chip pending", () => {
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "loading", response: null, message: null });
  expect(v.state).toBe("loading");
  expect(v.headline).toEqual({ emphasis: "Loading the history of Cash…", rest: "", tone: "refused", dek: HISTORY_DEK });
  expect(v.tiles).toEqual([]);
  expect(v.chips).toEqual([
    { label: "Engine", value: "Cash", title: "debt_manager" },
    { label: "Buckets", value: "pending", tone: "refused" },
  ]);
  expect(deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "loading", response: null, message: null }).headline.emphasis).toBe(
    "Loading the history of the Aave v3 market (legacy)…",
  );
});

test("error: state unavailable, refused; the message in the dek with the never-shown-as-empty clause", () => {
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "error", response: null, message: "Failed to fetch" });
  expect(v.state).toBe("unavailable");
  expect(v.headline).toEqual({
    emphasis: "The history of Cash could not be fetched.",
    rest: "",
    tone: "refused",
    dek: `Failed to fetch. ${HISTORY_UNAVAILABLE_CLAUSE}`,
  });
  expect(HISTORY_UNAVAILABLE_CLAUSE).toBe("The record is unavailable, and none of it is being shown as empty.");
  expect(v.tiles).toEqual([]);
  expect(v.chips).toContainEqual({ label: "Record", value: "unavailable", tone: "refused" });
});

test("doctrine: the intro, the chart's method notes and the source note verbatim, then the wire's own notes", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(HISTORY_INTRO).toBe(
    "How each engine's book has moved, hour by hour, in a record that outlives batch retention. An hour with no complete batch renders as a hole, which is never smoothed over and never drawn as a zero; one engine per view, never combined onto one axis.",
  );
  expect(HISTORY_DOCTRINE).toEqual([
    HISTORY_INTRO,
    "captured buckets · the line never interpolates across a gap",
    "absent bucket · no complete batch in this bucket",
    "withheld bucket · the book was refused, so totals are null and never 0",
    "zero floor drawn · the scale never crops it away",
    "click any bucket for its full record",
    "source · observatory_points rollup (points survive batch retention; batch + materialization identity retained by the rollup)",
  ]);
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, ...DEMO_OBSERVATORY_DM.notes]);
  expect(DEMO_OBSERVATORY_DM.notes.length).toBeGreaterThan(0);
  // The dek's clause is the intro's law restated in one line; the drawer holds the paragraph, the header the clause.
  expect(HISTORY_INTRO).toContain("one engine per view");
  expect(HISTORY_INTRO).toContain("never drawn as a zero");
});
