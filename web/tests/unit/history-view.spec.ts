// web/tests/unit/history-view.spec.ts
// History's one view model: header, chips, tiles, finding and doctrine, derived
// once from a series reading. The headline's parts and the dek ARE
// observatoryTakeaway(...)'s and the finding IS gridReadingLine(...) — pinned
// equal to the functions called directly, so the header and the module's own
// sentence cannot drift, and once literally on the demo. A record is ink: an
// answered series is `neutral`, holes and all; only a refusal is dashed. The
// tiles are the demo Book's aggregates at the newest bucket (the weld's law)
// through the Book's money tier and the population guard; a withheld, absent,
// null or unreadable newest bucket is a dashed tile with the gap's word, never
// a 0 — and never a throw at the route boundary.
import { expect, test } from "@playwright/test";
import {
  deriveHistoryView,
  foreignSeries,
  HISTORY_ABSENT_NOTE,
  HISTORY_DEGRADED_CLAUSE,
  HISTORY_DEGRADED_NOTE,
  HISTORY_DOCTRINE,
  HISTORY_ENGINES,
  HISTORY_FOREIGN_CLAUSE,
  HISTORY_INTRO,
  HISTORY_LOADING_DEK,
  HISTORY_MARKS,
  HISTORY_METHOD,
  HISTORY_PROVENANCE,
  HISTORY_RATE_COLUMNS,
  HISTORY_RECORD_TITLE,
  HISTORY_UNAVAILABLE_CLAUSE,
  HISTORY_UNREADABLE_SCALE,
  marksFor,
  pointRecord,
  type HistoryReading,
} from "../../lib/history-view";
import { EM_DASH, formatBlock } from "../../lib/format";
import { humanUsd } from "../../lib/human-usd";
import { sentence } from "../../lib/lab-headline";
import { OBSERVATORY_ENGINES, type ObservatorySeriesResponse } from "../../lib/observatory-data";
import {
  buildBucketAxis,
  describeRange,
  describeStride,
  displayMetric,
  gridReadingLine,
  observatoryTakeaway,
  pointDetailTakeaway,
  strideWord,
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
// humanUtc joins an instant's tokens with U+00A0: a literal instant is written through `nb`, the prose around it
// keeps its ordinary spaces.
const nb = (text: string): string => text.replaceAll(" ", "\u00a0");

test("the page's engines: Cash first — the page opens on it — then the legacy market; every engine the contract serves, once", () => {
  expect(HISTORY_ENGINES).toEqual(["debt_manager", "aave_v3_etherfi"]);
  expect(HISTORY_ENGINES[0]).toBe("debt_manager");
  expect([...HISTORY_ENGINES].sort()).toEqual([...OBSERVATORY_ENGINES].sort());
});

test("ok, Cash: state ok; the kicker names the engine; the headline's parts and the dek ARE observatoryTakeaway's, in ink (neutral); the finding IS gridReadingLine", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const takeaway = observatoryTakeaway(DEMO_OBSERVATORY_DM, axis, "debt_manager");
  expect(v.state).toBe("ok");
  expect(v.kicker).toBe("History · Cash");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "neutral", dek: takeaway.dek });
  // The demo arm, literally. The window HAS holes and the headline is still ink: their severity is the census chip's.
  expect(v.headline).toEqual({
    emphasis: "$27.8M of Cash debt is outstanding,",
    rest: `across 1,412 accounts in the hour starting ${nb("Aug 8, 20:00 UTC")}.`,
    tone: "neutral",
    dek: "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 1 was withheld; each is a gap on the chart, never a zero.",
  });
  expect(chip(v, "Hours")?.tone).toBe("warn");
  expect(v.finding).toBe(gridReadingLine(DEMO_OBSERVATORY_DM, axis));
  expect(v.finding).toBe(
    `Between the first and last recorded hours (${nb("Aug 1, 21:00")} → ${nb("Aug 8, 20:00 UTC")}), debt rose by $1.8M, to $27.8M; accounts fell by 52, to 1,412; and liquidatable positions rose by 1, to 49.`,
  );
  expect(v.chartLabel).toBe("debt (usd) for Cash across rollup buckets");
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM, "accounts")).chartLabel).toBe("accounts for Cash across rollup buckets");
});

test("ok, legacy: the kicker names the legacy market as legacy, and the sentence counts the legacy market's debt alone", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_AAVE));
  const takeaway = observatoryTakeaway(DEMO_OBSERVATORY_AAVE, buildBucketAxis(DEMO_OBSERVATORY_AAVE), "aave_v3_etherfi");
  expect(v.kicker).toBe("History · Aave v3 market (legacy)");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "neutral", dek: takeaway.dek });
  expect(v.headline.emphasis).toBe("$1.9M of legacy Aave v3 debt is outstanding,");
  expect(v.headline.rest).toBe(`across 8,552 accounts in the hour starting ${nb("Aug 8, 20:00 UTC")}.`);
  expect(`${v.headline.emphasis} ${v.headline.rest} ${v.headline.dek} ${v.finding ?? ""}`).not.toMatch(/Cash|\$27\.8M|1,412/);
  expect(chip(v, "Engine")?.value).toBe("Aave v3 market (legacy)");
});

for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE]) {
  test(`tiles (${body.engine}): debt · collateral · accounts · liquidatable are the Book's aggregates at the newest bucket through humanUsd and groupInt; sub = the bucket time; tone neutral`, () => {
    const v = deriveHistoryView(ok(body));
    const c = card(body.engine);
    const newest = newestOf(body);
    expect(v.tiles.map((t) => t.key)).toEqual(["debt", "collateral", "accounts", "liquidatable"]);
    // The sub names the hour in the reader's word, the wire's instant verbatim after it.
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: humanUsd(BigInt(c.total_debt!), c.value_decimals), sub: `hour of ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "collateral")).toEqual({ key: "collateral", label: "Collateral", value: humanUsd(BigInt(c.total_collateral!), c.value_decimals), sub: `hour of ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "accounts")).toEqual({ key: "accounts", label: "Accounts", value: groupInt(c.positions), sub: `hour of ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "liquidatable")).toEqual({ key: "liquidatable", label: "Liquidatable positions", value: groupInt(c.liquidatable_positions), sub: `hour of ${newest.bucket_start}`, tone: "neutral" });
    expect(tile(v, "debt").sub).toBe("hour of 2026-08-08T20:00:00Z");
    // The same strings the weld pinned: the newest wire row IS the Book's card.
    expect(newest.debt_usd).toBe(String(c.total_debt));
    expect(newest.accounts).toBe(c.positions);
  });
}

test("chips: Engine · Stride · Range · Hours · Served, in that order; the stride is one reader's word with the method sentence as its title; the census counts the window in hours and its holes (warn); served_at verbatim", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(v.chips.map((c) => c.label)).toEqual(["Engine", "Stride", "Range", "Hours", "Served"]);
  expect(chip(v, "Engine")).toEqual({ label: "Engine", value: "Cash", title: "debt_manager" });
  expect(chip(v, "Stride")).toEqual({ label: "Stride", value: "hourly", title: describeStride(DEMO_OBSERVATORY_DM.step_seconds) });
  expect(chip(v, "Stride")?.value).toBe(strideWord(DEMO_OBSERVATORY_DM.step_seconds));
  // The method sentence left the chip's face, not the page: it is the chip's title and a drawer paragraph.
  expect(chip(v, "Stride")?.title).toBe("native hourly record · every recorded hour is served verbatim");
  expect(v.doctrine).toContain("native hourly record · every recorded hour is served verbatim");
  expect(chip(v, "Range")?.value).toBe(describeRange(DEMO_OBSERVATORY_DM.from, DEMO_OBSERVATORY_DM.to));
  expect(chip(v, "Hours")).toEqual({ label: "Hours", value: "165 recorded · 1 withheld · 2 absent", tone: "warn" });
  expect(chip(v, "Buckets")).toBeUndefined();
  expect(chip(v, "Served")?.value).toBe(DEMO_OBSERVATORY_DM.served_at);
  // No chip's value is longer than a phone's line: the longest stays under the 390px page's measure at chip size.
  for (const c of v.chips) expect(`${c.label} ${c.value}`.length).toBeLessThanOrEqual(48);
  // A window with no hole is an ok census.
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-3) };
  expect(chip(deriveHistoryView(ok(whole)), "Hours")).toEqual({ label: "Hours", value: "3 recorded · 0 withheld · 0 absent", tone: "ok" });
  // An hour that was recorded but states a money figure nobody can read is a hole too: the census counts it inside
  // the recorded hours it belongs to, and never wears the ok register over it — whichever metric the chart is on,
  // whichever money figure it is, a malformed string or a JSON number alike.
  const holed = (change: Partial<ObservatorySeriesResponse["points"][number]>, at = 1): ObservatorySeriesResponse => ({
    ...whole,
    points: whole.points.map((p, i) => (i === at ? { ...p, ...change } : p)),
  });
  for (const body of [holed({ debt_usd: "12.5" }), holed({ collateral_usd: 153171572 as unknown as string }), holed({ debt_usd: "1e9" }, 0)]) {
    for (const metric of ["debt_usd", "accounts"] as const) {
      expect(chip(deriveHistoryView(ok(body, metric)), "Hours")).toEqual({
        label: "Hours",
        value: "3 recorded (1 with an unreadable figure) · 0 withheld · 0 absent",
        tone: "warn",
      });
    }
  }
  const twice = { ...whole, points: whole.points.map((p, i) => (i === 0 ? p : { ...p, debt_usd: "x", collateral_usd: "y" })) };
  expect(chip(deriveHistoryView(ok(twice)), "Hours")?.value).toBe("3 recorded (2 with an unreadable figure) · 0 withheld · 0 absent");
  // A null figure is not an unreadable one, and the demo's own census does not move.
  expect(chip(deriveHistoryView(ok(holed({ debt_usd: null }))), "Hours")?.tone).toBe("ok");
  // An applied stride is said as the service applies it, on the chip and in its title.
  const stepped = deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, step_seconds: 7200 }));
  expect(chip(stepped, "Stride")?.value).toBe("at most one hour in every 2");
  expect(chip(stepped, "Stride")?.title).toContain("stride 7200s");
});

test("a withheld newest bucket: every tile is a dashed tile with the word withheld; the headline is observatoryTakeaway's withholding and turns refused; the dek names the cause, then the holes", () => {
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
  const takeaway = observatoryTakeaway(withheld, buildBucketAxis(withheld), "debt_manager");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "refused", dek: takeaway.dek });
  expect(v.headline.emphasis).toBe("The latest hour's figures were withheld,");
  expect(v.headline.rest).toBe(`so no current debt figure is shown (${nb("Aug 8, 20:00 UTC")}).`);
  expect(v.headline.dek).toBe(
    "The engine's whole book was refused in that hour (collateral-flag custody unproven · FLAG_CUSTODY_UNPROVEN). 164 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 2 were withheld; each is a gap on the chart, never a zero.",
  );
  // An older hour's figure never stands in for the withheld one — not in the headline, not in the dek.
  expect(`${v.headline.emphasis} ${v.headline.rest} ${v.headline.dek}`).not.toContain("$");
  // The contract's own example: the newest bucket withheld, one captured before it.
  const example = deriveHistoryView(ok(OBSERVATORY_SERIES_DM));
  expect(example.tiles.every((t) => t.sub === "withheld" && t.value === "—")).toBe(true);
  expect(chip(example, "Hours")?.value).toBe("1 recorded · 1 withheld · 0 absent");
});

test("a null metric on a captured newest bucket is its own dashed tile — not stated, never 0 — while the other tiles answer", () => {
  const nulled = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, debt_usd: null } : p)),
  };
  const v = deriveHistoryView(ok(nulled));
  expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: "—", sub: "not stated", tone: "refused" });
  expect(tile(v, "accounts").tone).toBe("neutral");
  // The headline's finding IS the debt: an hour that states none is said as such, dashed — not stated is not zero.
  expect(v.headline.emphasis).toBe("The latest hour states no debt figure,");
  expect(v.headline.rest).toBe(`in the hour starting ${nb("Aug 8, 20:00 UTC")}. Not stated is not zero.`);
  expect(v.headline.tone).toBe("refused");
  // Another metric's null leaves the debt's answer standing, in ink, and names the missing count.
  const noAccounts = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, accounts: null } : p)),
  };
  const answered = deriveHistoryView(ok(noAccounts));
  expect(answered.headline.tone).toBe("neutral");
  expect(answered.headline.rest).toBe(`in the hour starting ${nb("Aug 8, 20:00 UTC")}; the account count was not stated.`);
  expect(tile(answered, "accounts")).toMatchObject({ value: "—", sub: "not stated", tone: "refused" });
});

test("a debt figure that fails its wire guard, THROUGH the view: the page stands — the headline says unreadable, the debt tile is dashed with the word, the finding gives no change, the chart keys the hole — never a throw, never a zero", () => {
  const newestWith = (change: Partial<ObservatorySeriesResponse["points"][number]>): ObservatorySeriesResponse => ({
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, ...change } : p)),
  });
  for (const bad of ["", "12.5", "1e9", "0x10", " 27828808216758"]) {
    const v = deriveHistoryView(ok(newestWith({ debt_usd: bad })));
    // The record answered; one figure in it cannot be read, and the page says so by name instead of unmounting.
    expect(v.state).toBe("ok");
    expect(v.headline).toEqual({
      emphasis: "The latest hour's debt figure cannot be read,",
      rest: `in the hour starting ${nb("Aug 8, 20:00 UTC")}. Unreadable is not zero.`,
      tone: "refused",
      dek: "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 1 was withheld; each is a gap on the chart, never a zero.",
    });
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: "—", sub: "unreadable", tone: "refused" });
    // The hour itself was recorded: its other three figures still answer.
    for (const key of ["collateral", "accounts", "liquidatable"]) expect(tile(v, key).tone).toBe("neutral");
    expect(v.finding).toContain("debt unreadable at one end, so no change is given");
    expect(v.finding).not.toMatch(/debt (rose|fell|unchanged)/);
    // The key names the mark the chart draws for it — its own word, neither the absent hour's nor the withheld one's.
    expect(v.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
    expect(`${v.headline.emphasis} ${v.headline.rest} ${v.finding ?? ""}`).not.toMatch(/\$0\b|NaN/);
  }
  // Another money metric: the debt's answer stands in ink, and only the collateral tile is dashed.
  const collateral = deriveHistoryView(ok(newestWith({ collateral_usd: "153171572.777189" })));
  expect(collateral.headline.tone).toBe("neutral");
  expect(collateral.headline.emphasis).toBe("$27.8M of Cash debt is outstanding,");
  expect(tile(collateral, "collateral")).toEqual({ key: "collateral", label: "Collateral", value: "—", sub: "unreadable", tone: "refused" });
  expect(tile(collateral, "debt").tone).toBe("neutral");
  // The key follows the metric the chart is drawing: the debt series of that body holds no unreadable hour.
  expect(collateral.marks.map((m) => m.mark)).toEqual(["absent", "withheld"]);
  expect(deriveHistoryView(ok(newestWith({ collateral_usd: "153171572.777189" }), "collateral_usd")).marks.map((m) => m.mark)).toEqual([
    "absent",
    "withheld",
    "unreadable",
  ]);
  // An OLDER hour that cannot be read: the headline still answers; the finding's first end is the unreadable one.
  const firstBad = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === 0 ? { ...p, debt_usd: "25955929.42377" } : p)),
  };
  const older = deriveHistoryView(ok(firstBad));
  expect(older.headline.tone).toBe("neutral");
  expect(tile(older, "debt").tone).toBe("neutral");
  expect(older.finding).toContain("debt unreadable at one end, so no change is given");
});

test("money is judged as money whatever its type, THROUGH the view: a debt figure served as a JSON number — fractional, integer, negative or zero — is the named hole a malformed string is; never plotted, never labelled as a count, never a throw", () => {
  // The contract's money is an exact decimal STRING. A JSON number has already been through a float: no guard can
  // vouch for its digits, so it is unreadable whatever it holds.
  const debtAt = (index: number, value: number): ObservatorySeriesResponse => ({
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === index ? { ...p, debt_usd: value as unknown as string } : p)),
  });
  const newest = DEMO_OBSERVATORY_DM.points.length - 1;
  for (const bad of [27828808.216758, 27828808216758, 1000000, -5, 0]) {
    const v = deriveHistoryView(ok(debtAt(newest, bad)));
    expect(v.state).toBe("ok");
    expect(v.headline.emphasis).toBe("The latest hour's debt figure cannot be read,");
    expect(v.headline.tone).toBe("refused");
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: "—", sub: "unreadable", tone: "refused" });
    for (const key of ["collateral", "accounts", "liquidatable"]) expect(tile(v, key).tone).toBe("neutral");
    expect(v.finding).toContain("debt unreadable at one end, so no change is given");
    expect(v.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
    // The hour was recorded: the census counts it, and its record prints a dash with the true cause.
    const entry = buildBucketAxis(debtAt(newest, bad)).entries.at(-1)!;
    const row = pointRecord(entry, debtAt(newest, bad)).answer.find((r) => r.key === "debt")!;
    expect(row.value).toBe(EM_DASH);
    expect(row.note).toContain("unreadable");
  }
  // An OLDER hour: the headline and the tile answer from the newest hour; the chart keys the hole where it is.
  const older = deriveHistoryView(ok(debtAt(40, 27828808216758)));
  expect(older.headline.tone).toBe("neutral");
  expect(tile(older, "debt").tone).toBe("neutral");
  expect(older.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
  // The other money metric is judged by the same law, and the debt beside it still answers.
  const collateral = deriveHistoryView(
    ok({
      ...DEMO_OBSERVATORY_DM,
      points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === newest ? { ...p, collateral_usd: 153171572.777189 as unknown as string } : p)),
    }),
  );
  expect(collateral.headline.tone).toBe("neutral");
  expect(tile(collateral, "collateral")).toEqual({ key: "collateral", label: "Collateral", value: "—", sub: "unreadable", tone: "refused" });
});

test("a series answers for the engine that was ASKED: a body that names another engine is refused by name — the legacy market's figures never appear under Cash's name, nor Cash's under the legacy market's", () => {
  // Cash was asked; the body that came back is the legacy market's, whole and well-formed.
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "ok", response: DEMO_OBSERVATORY_AAVE, message: null });
  expect(v.state).toBe("unavailable");
  expect(v.kicker).toBe("History · Cash");
  expect(v.headline).toEqual({
    emphasis: "The history of Cash cannot be shown.",
    rest: "",
    tone: "refused",
    dek:
      "The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash (debt_manager) was asked for. " +
      `${HISTORY_FOREIGN_CLAUSE} ${HISTORY_UNAVAILABLE_CLAUSE}`,
  });
  expect(v.chips).toEqual([
    { label: "Engine", value: "Cash", title: "debt_manager" },
    { label: "Record", value: "wrong engine", tone: "refused" },
  ]);
  // Nothing of the other engine's body is on the page: no tile, no finding, no chart name, no key, none of its notes.
  expect(v.tiles).toEqual([]);
  expect(v.finding).toBeNull();
  expect(v.chartLabel).toBeNull();
  expect(v.marks).toEqual([]);
  expect(v.doctrine).toEqual(HISTORY_DOCTRINE);
  expect(JSON.stringify(v)).not.toContain("$1.9M");
  // The mirror: the legacy market asked, Cash answered.
  const mirror = deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "ok", response: DEMO_OBSERVATORY_DM, message: null });
  expect(mirror.state).toBe("unavailable");
  expect(mirror.headline.emphasis).toBe("The history of the legacy Aave v3 market cannot be shown.");
  expect(mirror.headline.dek).toContain("the series of Cash (debt_manager) where the legacy Aave v3 market (aave_v3_etherfi) was asked for.");
  expect(JSON.stringify(mirror)).not.toContain("$27.8M");
  // The decision the surface takes BEFORE it commits a body is this one, in these words.
  expect(foreignSeries("debt_manager", DEMO_OBSERVATORY_DM)).toBeNull();
  expect(foreignSeries("aave_v3_etherfi", DEMO_OBSERVATORY_AAVE)).toBeNull();
  const sentence = foreignSeries("debt_manager", DEMO_OBSERVATORY_AAVE);
  expect(sentence).toBe("The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash (debt_manager) was asked for.");
  // The surface hands that sentence back as the reading's message; the view is the same refusal.
  expect(deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "foreign", response: null, message: sentence })).toEqual(v);
  // An engine this page does not chart is named by the wire's own id; a body that names none says so — never a throw.
  expect(foreignSeries("debt_manager", { ...DEMO_OBSERVATORY_DM, engine: "morpho_blue" })).toBe(
    "The service answered with the series of an engine this page does not chart (morpho_blue) where Cash (debt_manager) was asked for.",
  );
  for (const engine of [null, undefined, 7, "", "  ", {}]) {
    expect(foreignSeries("debt_manager", { ...DEMO_OBSERVATORY_DM, engine: engine as unknown as string })).toBe(
      "The service answered with a series that names no engine where Cash (debt_manager) was asked for.",
    );
  }
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

test("an empty window: every tile says no hour was recorded — never that no batch existed; the headline is the module's own no-bucket sentence, refused; the finding is the module's; no key, because no mark is drawn", () => {
  const empty = { ...DEMO_OBSERVATORY_DM, points: [] };
  const v = deriveHistoryView(ok(empty));
  const axis = buildBucketAxis(empty);
  expect(v.state).toBe("ok");
  for (const t of v.tiles) expect(t).toMatchObject({ value: "—", sub: "no hour recorded", tone: "refused" });
  expect(v.marks).toEqual([]);
  const takeaway = observatoryTakeaway(empty, axis, "debt_manager");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: "", tone: "refused", dek: takeaway.dek });
  expect(v.headline.emphasis).toBe("No hour in this window was recorded.");
  expect(v.headline.dek).toBe(
    "No complete batch was observed for Cash in this range, so there is nothing to chart. That is a missing record, not a zero.",
  );
  expect(v.finding).toBe(gridReadingLine(empty, axis));
  expect(v.finding).toBe("No hour in this window was recorded, so there is no movement to read.");
  expect(chip(v, "Hours")).toEqual({ label: "Hours", value: "0 recorded · 0 withheld · 0 absent", tone: "ok" });
});

test("degraded: state degraded; the refused headline names the engine and the deployment; the dek is the wire's message as a sentence, then the deployment clause; no tiles; the deployment note joins the doctrine", () => {
  const message = OBSERVATORY_DEGRADED.error.message;
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "degraded", response: null, message });
  expect(v.state).toBe("degraded");
  expect(v.headline).toEqual({
    emphasis: "No hourly history exists for Cash on this deployment yet.",
    rest: "",
    tone: "refused",
    dek: `${sentence(message)} ${HISTORY_DEGRADED_CLAUSE}`,
  });
  expect(HISTORY_DEGRADED_CLAUSE).toBe("That is a fact about this deployment, not an empty history; live figures are on the Book.");
  expect(v.tiles).toEqual([]);
  expect(v.finding).toBeNull();
  expect(v.chips[0]).toEqual({ label: "Engine", value: "Cash", title: "debt_manager" });
  expect(v.chips).toContainEqual({ label: "Rollup", value: "unavailable", tone: "refused" });
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, HISTORY_DEGRADED_NOTE]);
  const legacy = deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "degraded", response: null, message });
  // A sentence names the legacy market as prose does — one phrasing across the product's sentences; the kicker and the chip keep the label form.
  expect(legacy.headline.emphasis).toBe("No hourly history exists for the legacy Aave v3 market on this deployment yet.");
  expect(legacy.kicker).toBe("History · Aave v3 market (legacy)");
  // A service that named no reason is said as such; the deployment clause still stands.
  const silent = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "degraded", response: null, message: null });
  expect(silent.headline.dek).toBe(`The service named no reason. ${HISTORY_DEGRADED_CLAUSE}`);
});

test("loading: the refused tone, tiles empty, the dek says what will be here and counts nothing, the Hours chip pending", () => {
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "loading", response: null, message: null });
  expect(v.state).toBe("loading");
  expect(v.headline).toEqual({ emphasis: "Loading the history of Cash…", rest: "", tone: "refused", dek: HISTORY_LOADING_DEK });
  expect(HISTORY_LOADING_DEK).toBe("The hourly record of this engine's debt, collateral, accounts and liquidatable positions.");
  expect(HISTORY_LOADING_DEK).not.toMatch(/\d/);
  expect(v.tiles).toEqual([]);
  expect(v.chips).toEqual([
    { label: "Engine", value: "Cash", title: "debt_manager" },
    { label: "Hours", value: "pending" },
  ]);
  expect(v.marks).toEqual([]);
  expect(deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "loading", response: null, message: null }).headline.emphasis).toBe(
    "Loading the history of the legacy Aave v3 market…",
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

test("doctrine: the intro, the chart's method notes and the source note verbatim, the stride's sentence, then the wire's own notes — and an absent hour is one no complete batch was OBSERVED in", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(HISTORY_INTRO).toBe(
    "How each engine's book has moved, hour by hour, in a record that outlives batch retention. An hour in which no complete batch was observed renders as a hole, which is never smoothed over and never drawn as a zero; one engine per view, never combined onto one axis.",
  );
  expect(HISTORY_DOCTRINE).toEqual([
    HISTORY_INTRO,
    "captured buckets · the line never interpolates across a gap",
    "absent bucket · no complete batch was observed in this bucket",
    "withheld bucket · the book was refused, so totals are null and never 0",
    "unreadable figure · the bucket was recorded, but this figure is not the exact decimal the contract allows, so it is a hole and never 0",
    "zero floor drawn · the scale never crops it away",
    "click any bucket for its full record",
    "source · observatory_points rollup (points survive batch retention; batch + materialization identity retained by the rollup)",
  ]);
  // The drawer teaches every mark the key can show: each mark's own word opens one of the method notes.
  for (const mark of HISTORY_MARKS) {
    expect(HISTORY_METHOD.filter((note) => note.startsWith(`${mark.mark} `))).toHaveLength(1);
  }
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, describeStride(DEMO_OBSERVATORY_DM.step_seconds), ...DEMO_OBSERVATORY_DM.notes]);
  expect(DEMO_OBSERVATORY_DM.notes.length).toBeGreaterThan(0);
  // The rollup writes a row by observing a batch, so the page claims the observation only — in every string that
  // describes an absent hour: the intro, the method note, the key, the record's paragraph and its one-line state.
  const absentWords = [HISTORY_INTRO, HISTORY_DOCTRINE[2] ?? "", HISTORY_MARKS[0]?.label ?? "", HISTORY_ABSENT_NOTE, pointDetailTakeaway({ bucketStart: "2026-08-08T00:00:00Z", kind: "absent", point: null })];
  for (const words of absentWords) {
    expect(words).toMatch(/observed/);
    expect(words).not.toMatch(/no complete (risk )?batch (this hour|in this bucket|existed)|with no complete batch/);
  }
  // The slogan lives here, in the drawer's paragraph; the header's dek states the window's holes as a fact, and keeps
  // the law inside it ("never a zero").
  expect(HISTORY_INTRO).toContain("one engine per view");
  expect(HISTORY_INTRO).toContain("never drawn as a zero");
  expect(v.headline.dek).toContain("never a zero");
  expect(v.headline.dek).not.toContain("One engine per view");
});

test("the headline opens as a sentence at its source: a capital or the money figure itself, in observatoryTakeaway's three arms, and the view prints them by identity", () => {
  const opening = /^(?:[A-Z]|\$\d)/;
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok(OBSERVATORY_SERIES_DM)).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, points: [] })).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).headline.emphasis.startsWith("$27.8M of Cash debt ")).toBe(true);
  expect(deriveHistoryView(ok(OBSERVATORY_SERIES_DM)).headline.emphasis.startsWith("The latest hour's figures ")).toBe(true);
  expect(deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, points: [] })).headline.emphasis).toBe(
    "No hour in this window was recorded.",
  );
  // The H1 is the parts joined by one space: no part carries a leading space, and the emphasis of an answer ends with its comma.
  for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE, OBSERVATORY_SERIES_DM]) {
    const { emphasis, rest } = deriveHistoryView(ok(body)).headline;
    expect(emphasis.endsWith(",")).toBe(true);
    expect(/^\s/.test(rest)).toBe(false);
    expect(`${emphasis} ${rest}`).not.toMatch(/\(s\)|\d{4}-\d{2}-\d{2}T/);
  }
});

test("the chart's mark key: three marks, the lib's words, in the plot's order — and the key lists only the marks the drawn series carries, so a hole-free window has none", () => {
  expect(HISTORY_MARKS).toEqual([
    { mark: "absent", label: "no complete batch was observed" },
    { mark: "withheld", label: "batch present, figures withheld" },
    { mark: "unreadable", label: "figure unreadable" },
  ]);
  // The demo window holds absent and withheld hours and no unreadable figure: two marks, not three.
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).marks).toEqual([HISTORY_MARKS[0], HISTORY_MARKS[1]]);
  // A window with no hole draws no mark, and carries no key.
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-3) };
  expect(deriveHistoryView(ok(whole)).marks).toEqual([]);
  expect(marksFor([null, null])).toEqual([]);
  expect(marksFor([null, "withheld", null, "withheld"])).toEqual([HISTORY_MARKS[1]]);
  // A null metric's tick has no form-mark of its own, so it adds no key entry; the key's order is the vocabulary's.
  expect(marksFor(["null", "unreadable", "absent"])).toEqual([HISTORY_MARKS[0], HISTORY_MARKS[2]]);
});

test.describe("pointRecord — the bucket record's rows and sentences", () => {
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const newestEntry = axis.entries[axis.newestPointIndex]!;
  const newest = newestEntry.point!;
  const withheldEntry = axis.entries.find((e) => e.kind === "withheld")!;
  const absentEntry = axis.entries.find((e) => e.kind === "absent")!;
  const labels = (rows: readonly { label: string }[]) => rows.map((r) => r.label);

  test("the demo's newest bucket: captured; the answer rows in order with the exact ledger strings; the provenance rows behind a counted fold; the rate snapshot inside it", () => {
    const r = pointRecord(newestEntry, DEMO_OBSERVATORY_DM);
    // Every bucket is an hour (a stride only samples hours, verbatim): the record is named for what it is.
    expect(HISTORY_RECORD_TITLE).toBe("Hour record");
    expect(r.title).toBe("Hour record");
    expect(r.bucket).toBe(newest.bucket_start);
    expect(r.kind).toBe("captured");
    expect(r.takeaway).toBe(pointDetailTakeaway(newestEntry));
    // The demo's literal: the point's last_block is the engine's balances watermark at capture — its own as-of.
    expect(r.takeaway).toBe("captured at 2026-08-08T20:00:00Z · balances as of block 155,323,444.");
    expect(r.takeaway).not.toContain("watermark");
    expect(r.absentNote).toBeNull();
    expect(r.refusalCode).toBeNull();
    expect(labels(r.answer)).toEqual(["state", "debt (usd)", "collateral (usd)", "accounts", "refused position rows", "liquidatable positions"]);
    expect(r.answer[0]).toEqual({ key: "state", label: "state", value: "captured", note: null, noteTone: "caption", tone: "neutral", mono: false, testId: null });
    expect(r.answer[1]).toEqual({ key: "debt", label: "debt (usd)", value: displayMetric(newest, "debt_usd", DEMO_OBSERVATORY_DM.usd_decimals), note: null, noteTone: "caption", tone: "neutral", mono: true, testId: null });
    expect(r.answer[2]?.value).toBe(displayMetric(newest, "collateral_usd", DEMO_OBSERVATORY_DM.usd_decimals));
    // The record is the exact layer the headline and the finding lean on: grouped, the digits the wire's own.
    expect(r.answer[1]?.value).toBe("$27,828,808.216758");
    expect(r.answer[2]?.value).toBe("$153,171,572.777189");
    expect(r.answer[3]?.value).toBe(groupInt(newest.accounts!));
    expect(r.answer[3]?.value).toBe("1,412");
    expect(r.answer[4]?.value).toBe(groupInt(newest.refused_positions));
    expect(r.answer[5]?.value).toBe(groupInt(newest.liquidatable_positions!));
    // No hazard bites: the reorg and sweep rows live in the fold, after the four provenance rows.
    expect(labels(r.forensic)).toEqual(["bucket (its own as-of)", "watermark", "observed batch", "materialization key", "reorg posture at compute", "sweep stamp (the count's collateral clock)"]);
    expect(r.forensic[0]).toMatchObject({ value: newest.bucket_start, mono: true });
    expect(r.forensic[1]).toEqual({ key: "watermark", label: "watermark", value: `block ${formatBlock(newest.last_block)}`, note: " (the engine's balances watermark at capture, never a chain head observed later)", noteTone: "caption", tone: "neutral", mono: false, testId: null });
    expect(r.forensic[2]).toEqual({ key: "batch", label: "observed batch", value: `#${String(newest.batch_id)}`, note: " (the COMPLETE batch this bucket observed; the batch itself may since have been pruned by retention)", noteTone: "caption", tone: "neutral", mono: false, testId: "history-point-batch" });
    expect(r.forensic[3]).toEqual({ key: "key", label: "materialization key", value: newest.materialization_key, note: " (copied at write time, so the attribution survives retention)", noteTone: "caption", tone: "neutral", mono: true, testId: "history-point-mkey" });
    expect(r.forensic[4]).toEqual({ key: "reorg", label: "reorg posture at compute", value: "none unacked", note: " (the stamp pair copied from the observed batch's watermark vector)", noteTone: "caption", tone: "neutral", mono: false, testId: "history-point-epochs" });
    const sweep = newest.sweep!;
    expect(r.forensic[5]).toEqual({
      key: "sweep",
      label: "sweep stamp (the count's collateral clock)",
      value: `${String(sweep.rows)} swept · ${String(sweep.failed)} failed · gen ${String(sweep.generation)} (pass complete)`,
      note: ` · the observed batch's own sweep stamp; the liquidatable count above aggregates THIS sweep-cut, not the bucket's block clock. last successful write ${sweep.max_updated_at ?? "NEVER"}`,
      noteTone: "caption",
      tone: "neutral",
      mono: true,
      testId: "history-point-sweep",
    });
    // A real plural, never "(s)".
    expect(r.forensicSummary).toBe("6 provenance rows + the rate snapshot");
    // Every clause on a captured, hazard-free record is a caption: none states why a figure is missing.
    for (const row of [...r.answer, ...r.forensic]) expect(row.noteTone).toBe("caption");
    expect(r.ratesOutside).toBe(false);
    expect(r.ratesEmpty).toBeNull();
    const rate = newest.rates[0]!;
    expect(r.rates).toEqual([
      {
        key: `${rate.kind}-${rate.asset}`,
        kind: rate.kind,
        asset: rate.asset,
        assetName: rate.symbol ?? "NEVER",
        assetShort: `${rate.asset.slice(0, 6)}…${rate.asset.slice(-4)}`,
        value: rate.value,
        scale: rate.scale,
        scaleStated: true,
        block: formatBlock(rate.as_of_block),
        note: rate.note,
      },
    ]);
    expect(r.provenance).toBe(HISTORY_PROVENANCE);
    expect(HISTORY_PROVENANCE).toBe(
      "provenance: this point was captured from the newest COMPLETE risk batch in its bucket (the observatory_points rollup law) and survives batch retention. rate values are the wire's exact decimal strings, rendered verbatim.",
    );
    expect(HISTORY_RATE_COLUMNS.map((c) => c.header)).toEqual(["rate index", "asset", "value (raw decimal)", "scale", "its OWN as-of block", "note"]);
    expect(HISTORY_RATE_COLUMNS.filter((c) => c.align === "right").map((c) => c.key)).toEqual(["value", "block"]);
  });

  test("the withheld bucket: the state word is refused with its code; the null totals are em dashes with the never-zero clause; no snapshot, and the note says why", () => {
    const r = pointRecord(withheldEntry, DEMO_OBSERVATORY_DM);
    expect(r.kind).toBe("withheld");
    expect(r.takeaway).toBe(pointDetailTakeaway(withheldEntry));
    expect(r.refusalCode).toBe("FLAG_CUSTODY_UNPROVEN");
    // The refusal code and its clause are the row's STATE: set in the state ink, never the caption's (reserved for ornament).
    expect(r.answer[0]).toEqual({ key: "state", label: "state", value: "withheld", note: " · FLAG_CUSTODY_UNPROVEN · the engine's whole book was withheld at capture time", noteTone: "state", tone: "refused", mono: false, testId: null });
    expect(r.answer[1]).toMatchObject({ value: EM_DASH, note: ", null because the book was withheld and never zero", noteTone: "state", mono: true });
    expect(r.answer[2]).toMatchObject({ value: EM_DASH, note: ", null because the book was withheld and never zero", noteTone: "state" });
    expect(r.answer[3]?.value).toBe(EM_DASH);
    expect(r.answer[5]?.value).toBe(EM_DASH);
    // The one zero on a withheld record is the wire's own: no position row was refused. Every NULL total above is a dash.
    expect(r.answer[4]).toMatchObject({ label: "refused position rows", value: String(withheldEntry.point!.refused_positions) });
    expect(r.answer.some((row) => row.value.includes("$0"))).toBe(false);
    expect(r.rates).toEqual([]);
    expect(r.ratesEmpty).toBe("no rate snapshot was captured with this bucket (the whole book was withheld).");
    expect(r.forensicSummary).toBe("6 provenance rows + the rate-snapshot note");
  });

  test("a dashed money total names its TRUE cause: withheld with the book, not stated by a captured hour, or unreadable — the last one never a throw and never zero", () => {
    const mutate = (change: Partial<typeof newest>) => ({ ...newestEntry, point: { ...newest, ...change } });
    // A captured hour that states no debt: nobody withheld the book, so the withheld clause would name a false cause.
    const unstated = pointRecord(mutate({ debt_usd: null }), DEMO_OBSERVATORY_DM);
    expect(unstated.answer[1]).toEqual({ key: "debt", label: "debt (usd)", value: EM_DASH, note: ", not stated for this hour and never zero", noteTone: "state", tone: "neutral", mono: true, testId: null });
    expect(unstated.answer[1]?.note).not.toContain("withheld");
    // A debt that fails its wire guard: the record stands, the row is a dash with its own word.
    for (const bad of ["", "12.5", "1e9", "0x10"]) {
      const unreadable = pointRecord(mutate({ debt_usd: bad }), DEMO_OBSERVATORY_DM);
      expect(unreadable.answer[0]?.value).toBe("captured");
      expect(unreadable.answer[1]).toEqual({
        key: "debt",
        label: "debt (usd)",
        value: EM_DASH,
        note: ", unreadable: the wire's value is not an exact decimal, and it is never shown as zero",
        noteTone: "state",
        tone: "neutral",
        mono: true,
        testId: null,
      });
      // The hour's other totals still print, exactly.
      expect(unreadable.answer[2]?.value).toBe("$153,171,572.777189");
      expect(unreadable.answer.some((row) => row.value.includes("$0") || row.value.includes("NaN"))).toBe(false);
    }
  });

  test("an absent bucket: the absence stated by name, nothing to fold", () => {
    const r = pointRecord(absentEntry, DEMO_OBSERVATORY_DM);
    expect(r.kind).toBe("absent");
    expect(r.takeaway).toBe(pointDetailTakeaway(absentEntry));
    expect(r.absentNote).toBe(HISTORY_ABSENT_NOTE);
    expect(HISTORY_ABSENT_NOTE).toBe(
      "The rollup wrote no row for this hour: no complete risk batch was observed in it. Either none existed when the rollup looked, or the rollup did not look or could not write — the record cannot tell these apart. Nobody refused it. An absent bucket is a hole in the record, stated by name: nothing is interpolated across it, and it never renders as zero.",
    );
    expect(r.answer).toEqual([]);
    expect(r.forensic).toEqual([]);
    expect(r.forensicSummary).toBeNull();
    expect(r.rates).toEqual([]);
    expect(r.ratesEmpty).toBeNull();
  });

  test("hazards move to the answer and the fold recounts: unacked epochs (crit), an unrecorded sweep, an unstated scale (the table outside)", () => {
    const mutate = (change: Partial<typeof newest>) => ({ ...newestEntry, point: { ...newest, ...change } });
    const unacked = pointRecord(mutate({ max_epoch_at_compute: newest.acked_epoch + 2 }), DEMO_OBSERVATORY_DM);
    expect(unacked.answer.at(-1)).toMatchObject({ key: "reorg", value: `2 unacked epochs · acked ${String(newest.acked_epoch)} of ${String(newest.acked_epoch + 2)}`, tone: "crit", testId: "history-point-epochs" });
    expect(pointRecord(mutate({ max_epoch_at_compute: newest.acked_epoch + 1 }), DEMO_OBSERVATORY_DM).answer.at(-1)?.value).toBe(
      `1 unacked epoch · acked ${String(newest.acked_epoch)} of ${String(newest.acked_epoch + 1)}`,
    );
    expect(labels(unacked.forensic)).not.toContain("reorg posture at compute");
    expect(unacked.forensicSummary).toBe("5 provenance rows + the rate snapshot");

    const unrecorded = pointRecord(mutate({ sweep_recorded: false, sweep: null }), DEMO_OBSERVATORY_DM);
    expect(unrecorded.answer.at(-1)).toEqual({
      key: "sweep",
      label: "sweep stamp (the count's collateral clock)",
      value: EM_DASH,
      note: " unrecorded: this point predates migration 00018 and its batch was pruned before the stamp could be recovered. the record is missing here, and it is not a claim that the engine has no sweeper.",
      // A missing stamp is a disclosure about the record's state, not a caption.
      noteTone: "state",
      tone: "neutral",
      mono: false,
      testId: "history-point-sweep",
    });
    expect(unrecorded.forensicSummary).toBe("5 provenance rows + the rate snapshot");

    const unstated = pointRecord(mutate({ rates: newest.rates.map((rate) => ({ ...rate, scale: "unstated" as const })) }), DEMO_OBSERVATORY_DM);
    expect(unstated.ratesOutside).toBe(true);
    expect(unstated.rates[0]).toMatchObject({ scale: "unstated · kind outside the known vocabulary", scaleStated: false });
    expect(unstated.forensicSummary).toBe("6 provenance rows");

    const all = pointRecord(mutate({ max_epoch_at_compute: newest.acked_epoch + 1, sweep_recorded: false, sweep: null, rates: newest.rates.map((rate) => ({ ...rate, scale: "unstated" as const })) }), DEMO_OBSERVATORY_DM);
    expect(all.forensicSummary).toBe("4 provenance rows");
    // No "(s)" anywhere in a record: a count takes its real plural.
    for (const record of [unacked, unrecorded, unstated, all]) {
      expect(`${record.forensicSummary ?? ""} ${record.answer.map((row) => row.value).join(" ")}`).not.toContain("(s)");
    }
    expect(labels(all.forensic)).toEqual(["bucket (its own as-of)", "watermark", "observed batch", "materialization key"]);
  });

  test("the legacy market's sweep is recorded none — the record says so, never an em dash", () => {
    const aaveAxis = buildBucketAxis(DEMO_OBSERVATORY_AAVE);
    const r = pointRecord(aaveAxis.entries[aaveAxis.newestPointIndex]!, DEMO_OBSERVATORY_AAVE);
    const sweep = r.forensic.find((row) => row.key === "sweep");
    expect(sweep).toEqual({
      key: "sweep",
      label: "sweep stamp (the count's collateral clock)",
      value: "none",
      note: " (recorded: this engine has no collateral sweep, so its balances are event-derived)",
      noteTone: "caption",
      tone: "neutral",
      mono: false,
      testId: "history-point-sweep",
    });
  });
});
