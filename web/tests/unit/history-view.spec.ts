// web/tests/unit/history-view.spec.ts
// History's one view model: header, chips, tiles, finding, state card and
// doctrine, derived once from a series reading. The headline's parts and the
// dek ARE observatoryTakeaway(...)'s and the finding IS gridReadingLine(...) —
// pinned equal to the functions called directly, so the header and the
// module's own sentence cannot drift, and once literally on the demo. A record
// is ink: an answered series is `neutral`, holes and all. A record the page
// cannot show says which absence it is — not served here, unavailable (a fetch
// that failed, never a refusal), or unreadable — each with its own card. The
// tiles are the demo Book's aggregates at the newest bucket (the weld's law)
// through the Book's money tier and the population guard, each with its change
// since the first recorded hour; a withheld, absent, null or unreadable newest
// bucket is a tile that says its gap's word in the figure's place, never a 0 or
// a dash — and never a throw at the route boundary.
import { expect, test } from "@playwright/test";
import {
  deriveHistoryView,
  foreignSeries,
  HISTORY_ABSENT_NOTE,
  HISTORY_DEGRADED_DEK,
  HISTORY_DEGRADED_NOTE,
  HISTORY_DOCTRINE,
  HISTORY_ENGINES,
  HISTORY_FOREIGN_CLAUSE,
  HISTORY_INTRO,
  HISTORY_MARKS,
  HISTORY_METHOD,
  HISTORY_PROVENANCE,
  HISTORY_RATE_COLUMNS,
  HISTORY_UNAVAILABLE_CLAUSE,
  HISTORY_UNREADABLE_SCALE,
  historyLoadingDek,
  marksFor,
  pointRecord,
  recordTitle,
  SERVICE_SAID,
  type HistoryReading,
} from "../../lib/history-view";
import { EM_DASH, formatBlock } from "../../lib/format";
import { humanUsd } from "../../lib/human-usd";
import { humanUtc } from "../../lib/human-utc";
import { signedBookMoney } from "../../lib/money";
import { OBSERVATORY_ENGINES, type ObservatorySeriesResponse } from "../../lib/observatory-data";
import {
  buildBucketAxis,
  describeRange,
  describeStride,
  displayMetric,
  gridReadingLine,
  observatoryTakeaway,
  pointDetailTakeaway,
  rangeWords,
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
const nb = (text: string): string => text.replaceAll(" ", " ");
/** A tile that states its gap's word where the figure would be. */
const gap = (word: string, state: "refused" | "unreadable" = "refused", sub = "In the latest hour") => ({ value: "", sub, tone: "refused", state, stateWord: word });

test("the page's engines: Cash first — the page opens on it — then the legacy market; every engine the contract serves, once", () => {
  expect(HISTORY_ENGINES).toEqual(["debt_manager", "aave_v3_etherfi"]);
  expect([...HISTORY_ENGINES].sort()).toEqual([...OBSERVATORY_ENGINES].sort());
});

/** The chart's caption over the demo week: what a point and a gap are, over the recorded span. */
const DEMO_CAPTION = `Each point is one recorded hour, ${nb("Aug 1, 21:00")} – ${nb("Aug 8, 20:00 UTC")}; a gap is an hour with no figures to draw.`;

test("ok, Cash: state ok; the kicker names the engine; the headline's parts and the dek ARE observatoryTakeaway's, in ink — the change leads; the finding IS gridReadingLine, the same for every metric", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const takeaway = observatoryTakeaway(DEMO_OBSERVATORY_DM, axis, "debt_manager");
  expect(v.state).toBe("ok");
  expect(v.kicker).toBe("History · Cash");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "neutral", dek: takeaway.dek });
  // The demo arm, literally. The window HAS holes and the headline is still ink: their severity is the census chip's.
  expect(v.headline).toEqual({
    emphasis: `Cash debt rose $1.8M since ${nb("Aug 1, 21:00 UTC")},`,
    rest: "to $27.8M.",
    tone: "neutral",
    dek: "Liquidatable accounts rose by 1, to 49; accounts fell by 52, to 1,412. 165 of 168 hours were recorded; 2 are absent and 1 was withheld, each a gap on the chart.",
  });
  expect(chip(v, "Hours")?.tone).toBe("warn");
  expect(v.finding).toBe(gridReadingLine(DEMO_OBSERVATORY_DM, axis));
  expect(v.finding).toBe(DEMO_CAPTION);
  // The caption says what the chart draws, not what the headline already says: every metric reads it alike.
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM, "accounts")).finding).toBe(DEMO_CAPTION);
  expect(v.chartLabel).toBe("Debt (USD) for Cash, hour by hour");
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM, "liquidatable_positions")).chartLabel).toBe("Liquidatable accounts for Cash, hour by hour");
  expect(v.stateCard).toBeNull();
});

test("ok, legacy: the kicker names the legacy market as legacy, the sentence counts the legacy market's debt alone, and its liquidatable count stays positions", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_AAVE));
  const takeaway = observatoryTakeaway(DEMO_OBSERVATORY_AAVE, buildBucketAxis(DEMO_OBSERVATORY_AAVE), "aave_v3_etherfi");
  expect(v.kicker).toBe("History · Aave v3 market (legacy)");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "neutral", dek: takeaway.dek });
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe(`Legacy Aave v3 debt fell $11K since ${nb("Aug 1, 21:00 UTC")}, to $1.9M.`);
  expect(`${v.headline.emphasis} ${v.headline.rest} ${v.headline.dek} ${v.finding ?? ""}`).not.toMatch(/Cash|\$27\.8M|1,412/);
  // The engine is the kicker's and the switch's: no chip restates it.
  expect(chip(v, "Engine")).toBeUndefined();
  expect(tile(v, "liquidatable").label).toBe("Liquidatable positions");
});

for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE]) {
  test(`tiles (${body.engine}): the Book's aggregates at the newest bucket through humanUsd and groupInt, each with its change since the first recorded hour; tone neutral`, () => {
    const v = deriveHistoryView(ok(body));
    const c = card(body.engine);
    const newest = newestOf(body);
    const first = body.points[0]!;
    const since = `since ${humanUtc(first.bucket_start, body.served_at)}`;
    const money = (a: string | null, b: string | null) => `${signedBookMoney(body.usd_decimals)(BigInt(b!) - BigInt(a!))} ${since}`;
    const count = (a: number | null, b: number | null) => `${b! > a! ? "+" : "−"}${groupInt(Math.abs(b! - a!))} ${since}`;
    const plain = { tone: "neutral", state: null, stateWord: null } as const;
    expect(v.tiles.map((t) => t.key)).toEqual(["debt", "collateral", "accounts", "liquidatable"]);
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", value: humanUsd(BigInt(c.total_debt!), c.value_decimals), sub: money(first.debt_usd, newest.debt_usd), ...plain });
    expect(tile(v, "collateral")).toEqual({ key: "collateral", label: "Collateral", value: humanUsd(BigInt(c.total_collateral!), c.value_decimals), sub: money(first.collateral_usd, newest.collateral_usd), ...plain });
    expect(tile(v, "accounts")).toEqual({ key: "accounts", label: "Accounts", value: groupInt(c.positions), sub: count(first.accounts, newest.accounts), ...plain });
    expect(tile(v, "liquidatable")).toMatchObject({ key: "liquidatable", value: groupInt(c.liquidatable_positions), sub: count(first.liquidatable_positions, newest.liquidatable_positions), ...plain });
    // The same strings the weld pinned: the newest wire row IS the Book's card.
    expect(newest.debt_usd).toBe(String(c.total_debt));
    expect(newest.accounts).toBe(c.positions);
  });
}

test("tiles, the demo literally: a change with its sign (the display minus), in the tier the tile prints, since the first recorded hour; on Cash the liquidatable count is accounts", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  const since = `since ${nb("Aug 1, 21:00 UTC")}`;
  expect(v.tiles.map((t) => [t.label, t.value, t.sub])).toEqual([
    ["Debt", "$27.8M", `+$1.8M ${since}`],
    ["Collateral", "$153.1M", `−$2.7M ${since}`],
    ["Accounts", "1,412", `−52 ${since}`],
    ["Liquidatable accounts", "49", `+1 ${since}`],
  ]);
  // One recorded hour: no change is claimed.
  const one = { ...OBSERVATORY_SERIES_DM, points: OBSERVATORY_SERIES_DM.points.filter((p) => !p.refused) };
  for (const t of deriveHistoryView(ok(one)).tiles) expect(t.sub).toBe("Latest recorded hour");
  // An unchanged figure says so.
  const flat = { ...DEMO_OBSERVATORY_DM, points: [DEMO_OBSERVATORY_DM.points.at(-1)!, { ...DEMO_OBSERVATORY_DM.points.at(-1)!, bucket_start: "2026-08-08T21:00:00Z" }] };
  expect(tile(deriveHistoryView(ok(flat)), "accounts").sub).toBe(`Unchanged since ${nb("Aug 8, 20:00 UTC")}`);
});

test("chips: Stride · Range · Hours · Served, in that order — no chip restates the engine; every instant the reader's, its wire ISO the title; the census counts the window in hours and its holes (warn), and a whole window is ink", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(v.chips.map((c) => c.label)).toEqual(["Stride", "Range", "Hours", "Served"]);
  expect(chip(v, "Stride")).toEqual({ label: "Stride", value: "hourly", title: describeStride(DEMO_OBSERVATORY_DM.step_seconds) });
  expect(chip(v, "Stride")?.value).toBe(strideWord(DEMO_OBSERVATORY_DM.step_seconds));
  expect(chip(v, "Stride")?.title).toBe("Native hourly record: every recorded hour is served verbatim.");
  expect(v.doctrine).toContain("Native hourly record: every recorded hour is served verbatim.");
  expect(chip(v, "Range")).toEqual({
    label: "Range",
    value: rangeWords(DEMO_OBSERVATORY_DM.from, DEMO_OBSERVATORY_DM.to, DEMO_OBSERVATORY_DM.served_at),
    title: describeRange(DEMO_OBSERVATORY_DM.from, DEMO_OBSERVATORY_DM.to),
  });
  expect(chip(v, "Range")?.value).toBe(`${nb("Aug 1, 21:00 UTC")} – latest`);
  expect(chip(v, "Hours")).toEqual({ label: "Hours", value: "165 recorded · 1 withheld · 2 absent", tone: "warn" });
  expect(chip(v, "Served")).toEqual({ label: "Served", value: nb("Aug 8, 20:22 UTC"), title: DEMO_OBSERVATORY_DM.served_at });
  for (const c of v.chips) expect(`${c.label} ${c.value}`.length).toBeLessThanOrEqual(48);
  // A window with no hole: the census is a record, in ink — never the health green.
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-3) };
  expect(chip(deriveHistoryView(ok(whole)), "Hours")).toEqual({ label: "Hours", value: "3 recorded · 0 withheld · 0 absent" });
  for (const c of deriveHistoryView(ok(whole)).chips) expect(c.tone).not.toBe("ok");
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
  expect(chip(deriveHistoryView(ok(holed({ debt_usd: null }))), "Hours")?.tone).toBeUndefined();
  const stepped = deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, step_seconds: 7200 }));
  expect(chip(stepped, "Stride")?.value).toBe("at most one hour in every 2");
  expect(chip(stepped, "Stride")?.title).toContain("Stride 7200s");
});

test("a withheld newest bucket: every tile states Withheld in the figure's place — never a dash, never a 0; the headline is observatoryTakeaway's withholding and turns refused; the dek names the cause, then the holes", () => {
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
  expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", ...gap("Withheld") });
  for (const t of v.tiles) expect(t).toMatchObject(gap("Withheld"));
  const takeaway = observatoryTakeaway(withheld, buildBucketAxis(withheld), "debt_manager");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: takeaway.rest, tone: "refused", dek: takeaway.dek });
  expect(v.headline.emphasis).toBe("The latest hour's figures were withheld,");
  expect(v.headline.rest).toBe(`so no current debt figure is shown (${nb("Aug 8, 20:00 UTC")}).`);
  expect(v.headline.dek).toBe(
    "The engine's whole book was refused in that hour (collateral-flag custody unproven · FLAG_CUSTODY_UNPROVEN). 164 of 168 hours were recorded; 2 are absent and 2 were withheld, each a gap on the chart.",
  );
  expect(`${v.headline.emphasis} ${v.headline.rest} ${v.headline.dek}`).not.toContain("$");
  const example = deriveHistoryView(ok(OBSERVATORY_SERIES_DM));
  expect(example.tiles.every((t) => t.stateWord === "Withheld" && t.value === "")).toBe(true);
  expect(chip(example, "Hours")?.value).toBe("1 recorded · 1 withheld · 0 absent");
});

test("a null metric on a captured newest bucket is its own tile — Not stated, never 0 — while the other tiles answer", () => {
  const nulled = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, debt_usd: null } : p)),
  };
  const v = deriveHistoryView(ok(nulled));
  expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", ...gap("Not stated") });
  expect(tile(v, "accounts").tone).toBe("neutral");
  expect(v.headline.emphasis).toBe("The latest hour states no debt figure,");
  expect(v.headline.rest).toBe(`in the hour starting ${nb("Aug 8, 20:00 UTC")}. Not stated is not zero.`);
  expect(v.headline.tone).toBe("refused");
  // Another metric's null leaves the debt's answer standing, in ink; the missing count is named in the dek.
  const noAccounts = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, accounts: null } : p)),
  };
  const answered = deriveHistoryView(ok(noAccounts));
  expect(answered.headline.tone).toBe("neutral");
  expect(answered.headline.dek).toContain("accounts not stated at one end, so no change is given.");
  expect(tile(answered, "accounts")).toMatchObject(gap("Not stated"));
});

test("a debt figure that fails its wire guard, THROUGH the view: the page stands — the headline says unreadable, the debt tile states Unreadable in the unreadable register, the finding gives no change, the chart keys the hole — never a throw, never a zero", () => {
  const newestWith = (change: Partial<ObservatorySeriesResponse["points"][number]>): ObservatorySeriesResponse => ({
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i, all) => (i === all.length - 1 ? { ...p, ...change } : p)),
  });
  for (const bad of ["", "12.5", "1e9", "0x10", " 27828808216758"]) {
    const v = deriveHistoryView(ok(newestWith({ debt_usd: bad })));
    expect(v.state).toBe("ok");
    expect(v.headline).toEqual({
      emphasis: "The latest hour's debt figure cannot be read,",
      rest: `in the hour starting ${nb("Aug 8, 20:00 UTC")}. Unreadable is not zero.`,
      tone: "refused",
      dek: "165 of 168 hours were recorded; 2 are absent and 1 was withheld, each a gap on the chart.",
    });
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", ...gap("Unreadable", "unreadable") });
    for (const key of ["collateral", "accounts", "liquidatable"]) expect(tile(v, key).tone).toBe("neutral");
    // An unreadable hour is still a recorded hour: the caption's span holds, and its mark says what it is.
    expect(v.finding).toBe(DEMO_CAPTION);
    expect(v.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
    expect(`${v.headline.emphasis} ${v.headline.rest} ${v.finding ?? ""}`).not.toMatch(/\$0\b|NaN/);
  }
  const collateral = deriveHistoryView(ok(newestWith({ collateral_usd: "153171572.777189" })));
  expect(collateral.headline.tone).toBe("neutral");
  expect(collateral.headline.emphasis).toBe(`Cash debt rose $1.8M since ${nb("Aug 1, 21:00 UTC")},`);
  expect(tile(collateral, "collateral")).toEqual({ key: "collateral", label: "Collateral", ...gap("Unreadable", "unreadable") });
  expect(tile(collateral, "debt").tone).toBe("neutral");
  expect(collateral.marks.map((m) => m.mark)).toEqual(["absent", "withheld"]);
  expect(deriveHistoryView(ok(newestWith({ collateral_usd: "153171572.777189" }), "collateral_usd")).marks.map((m) => m.mark)).toEqual([
    "absent",
    "withheld",
    "unreadable",
  ]);
  // An OLDER hour that cannot be read: no change can lead, so the latest level answers; the caption still spans the recorded hours.
  const firstBad = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === 0 ? { ...p, debt_usd: "25955929.42377" } : p)),
  };
  const older = deriveHistoryView(ok(firstBad));
  expect(older.headline.tone).toBe("neutral");
  expect(older.headline.emphasis).toBe("$27.8M of Cash debt is outstanding,");
  expect(tile(older, "debt").tone).toBe("neutral");
  expect(tile(older, "debt").sub).toBe("Latest recorded hour");
  expect(older.finding).toBe(DEMO_CAPTION);
});

test("money is judged as money whatever its type, THROUGH the view: a debt figure served as a JSON number is the named hole a malformed string is; never plotted, never labelled as a count, never a throw", () => {
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
    expect(tile(v, "debt")).toEqual({ key: "debt", label: "Debt", ...gap("Unreadable", "unreadable") });
    for (const key of ["collateral", "accounts", "liquidatable"]) expect(tile(v, key).tone).toBe("neutral");
    expect(v.finding).toBe(DEMO_CAPTION);
    expect(v.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
    const entry = buildBucketAxis(debtAt(newest, bad)).entries.at(-1)!;
    const row = pointRecord(entry, debtAt(newest, bad)).answer.find((r) => r.key === "debt")!;
    expect(row.value).toBe(EM_DASH);
    expect(row.note).toContain("unreadable");
    expect(row.copy).toBeNull();
  }
  const older = deriveHistoryView(ok(debtAt(40, 27828808216758)));
  expect(older.headline.tone).toBe("neutral");
  expect(tile(older, "debt").tone).toBe("neutral");
  expect(older.marks.map((m) => m.mark)).toEqual(["absent", "withheld", "unreadable"]);
  const collateral = deriveHistoryView(
    ok({
      ...DEMO_OBSERVATORY_DM,
      points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === newest ? { ...p, collateral_usd: 153171572.777189 as unknown as string } : p)),
    }),
  );
  expect(collateral.headline.tone).toBe("neutral");
  expect(tile(collateral, "collateral")).toEqual({ key: "collateral", label: "Collateral", ...gap("Unreadable", "unreadable") });
});

test("a series answers for the engine that was ASKED: a body that names another engine is refused by name, in its own card — the legacy market's figures never appear under Cash's name, nor Cash's under the legacy market's", () => {
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "ok", response: DEMO_OBSERVATORY_AAVE, message: null });
  expect(v.state).toBe("unavailable");
  expect(v.kicker).toBe("History · Cash");
  expect(v.headline).toEqual({
    emphasis: "The history of Cash cannot be shown.",
    rest: "",
    tone: "refused",
    dek: `The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash (debt_manager) was asked for. ${HISTORY_FOREIGN_CLAUSE}`,
  });
  expect(v.chips).toEqual([{ label: "Record", value: "wrong engine", tone: "refused" }]);
  // Its own card — never the degraded state's words: the answer came, and the page cannot show it as this engine's.
  expect(v.stateCard).toEqual({
    state: "unreadable",
    title: "A series for another engine",
    cause: "Nothing of it is charted here: one engine's figures are never shown under another's name.",
    serviceSaid: null,
    action: "retry",
  });
  expect(v.tiles).toEqual([]);
  expect(v.finding).toBeNull();
  expect(v.chartLabel).toBeNull();
  expect(v.marks).toEqual([]);
  expect(v.doctrine).toEqual(HISTORY_DOCTRINE);
  expect(JSON.stringify(v)).not.toContain("$1.9M");
  const mirror = deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "ok", response: DEMO_OBSERVATORY_DM, message: null });
  expect(mirror.headline.emphasis).toBe("The history of the legacy Aave v3 market cannot be shown.");
  expect(mirror.headline.dek).toContain("the series of Cash (debt_manager) where the legacy Aave v3 market (aave_v3_etherfi) was asked for.");
  expect(JSON.stringify(mirror)).not.toContain("$27.8M");
  expect(foreignSeries("debt_manager", DEMO_OBSERVATORY_DM)).toBeNull();
  expect(foreignSeries("aave_v3_etherfi", DEMO_OBSERVATORY_AAVE)).toBeNull();
  const sentence = foreignSeries("debt_manager", DEMO_OBSERVATORY_AAVE);
  expect(sentence).toBe("The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash (debt_manager) was asked for.");
  expect(deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "foreign", response: null, message: sentence })).toEqual(v);
  expect(foreignSeries("debt_manager", { ...DEMO_OBSERVATORY_DM, engine: "morpho_blue" })).toBe(
    "The service answered with the series of an engine this page does not chart (morpho_blue) where Cash (debt_manager) was asked for.",
  );
  for (const engine of [null, undefined, 7, "", "  ", {}]) {
    expect(foreignSeries("debt_manager", { ...DEMO_OBSERVATORY_DM, engine: engine as unknown as string })).toBe(
      "The service answered with a series that names no engine where Cash (debt_manager) was asked for.",
    );
  }
});

test("an unreadable scale: the record cannot be read — its own card, the unreadable register, no tiles, before any figure is formatted at it", () => {
  for (const usd_decimals of [-0, -1, 1001, 6.5]) {
    const v = deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, usd_decimals }));
    expect(v.state).toBe("unavailable");
    expect(v.headline).toEqual({ emphasis: "The history of Cash cannot be read.", rest: "", tone: "refused", dek: HISTORY_UNREADABLE_SCALE });
    expect(HISTORY_UNREADABLE_SCALE).toBe("The series states a value scale outside the contract, so none of its dollar figures can be placed.");
    expect(v.stateCard).toMatchObject({ state: "unreadable", title: "An unreadable value scale", serviceSaid: null, action: "retry" });
    expect(v.tiles).toEqual([]);
    expect(v.finding).toBeNull();
    expect(v.chips).toContainEqual({ label: "Record", value: "unreadable", tone: "refused" });
  }
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
  for (const t of v.tiles) expect(t).toMatchObject(gap("No hour recorded", "refused", ""));
  expect(v.marks).toEqual([]);
  const takeaway = observatoryTakeaway(empty, axis, "debt_manager");
  expect(v.headline).toEqual({ emphasis: takeaway.emphasis, rest: "", tone: "refused", dek: takeaway.dek });
  expect(v.headline.emphasis).toBe("No hour in this window was recorded.");
  expect(v.finding).toBe(gridReadingLine(empty, axis));
  expect(v.finding).toBe("No hour in this window was recorded, so there is no movement to read.");
  expect(chip(v, "Hours")).toEqual({ label: "Hours", value: "0 recorded · 0 withheld · 0 absent" });
});

test("degraded — not served on this deployment: the absent register, never a refusal; the dek in reader words; the service's words move under its card's disclosure; the Book is the way forward; no tiles; the deployment note joins the doctrine", () => {
  const message = OBSERVATORY_DEGRADED.error.message;
  const verbatim = `503 unavailable: ${message} (http://x/v1/observatory/series?engine=debt_manager)`;
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "degraded", response: null, message, serviceSaid: verbatim, status: 503 });
  expect(v.state).toBe("degraded");
  expect(v.headline).toEqual({ emphasis: "No hourly history exists for Cash on this deployment yet.", rest: "", tone: "absent", dek: HISTORY_DEGRADED_DEK });
  expect(HISTORY_DEGRADED_DEK).toBe("This deployment has not built its hourly history yet, so there is nothing to chart. Today's figures are on the Book.");
  // The service's words leave the dek for the card's disclosure: relocated, never removed.
  expect(v.headline.dek).not.toContain(message);
  expect(v.stateCard).toEqual({
    state: "not-served",
    // What fills the page, said once: the headline, dek and chip already say the record is not here.
    title: "What fills this page",
    cause: "When this deployment builds its hourly record, each recorded hour appears here as a point and a missing hour as a gap.",
    serviceSaid: { label: SERVICE_SAID, text: verbatim },
    action: "book",
  });
  expect(SERVICE_SAID).toBe("What the service said");
  expect(v.tiles).toEqual([]);
  expect(v.finding).toBeNull();
  expect(v.chips).toEqual([{ label: "Hourly record", value: "not served here" }]);
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, HISTORY_DEGRADED_NOTE]);
  const legacy = deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "degraded", response: null, message });
  expect(legacy.headline.emphasis).toBe("No hourly history exists for the legacy Aave v3 market on this deployment yet.");
  expect(legacy.kicker).toBe("History · Aave v3 market (legacy)");
  // With no separate verbatim string, the envelope's own message is what is disclosed; with none at all, nothing is.
  expect(legacy.stateCard?.serviceSaid).toEqual({ label: SERVICE_SAID, text: message });
  expect(deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "degraded", response: null, message: null }).stateCard?.serviceSaid).toBeNull();
});

test("loading: the absent register — a read in flight is never a refusal — tiles empty, the dek says what will be here in the engine's own noun and counts nothing, the Hours chip pending", () => {
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "loading", response: null, message: null });
  expect(v.state).toBe("loading");
  expect(v.headline).toEqual({ emphasis: "Loading the history of Cash…", rest: "", tone: "absent", dek: historyLoadingDek("debt_manager") });
  expect(historyLoadingDek("debt_manager")).toBe("The hourly record of this engine's debt, collateral, accounts and liquidatable accounts.");
  expect(historyLoadingDek("aave_v3_etherfi")).toBe("The hourly record of this engine's debt, collateral, accounts and liquidatable positions.");
  expect(v.headline.dek).not.toMatch(/\d/);
  expect(v.tiles).toEqual([]);
  expect(v.chips).toEqual([{ label: "Hours", value: "pending" }]);
  expect(v.stateCard).toBeNull();
  expect(deriveHistoryView({ engine: "aave_v3_etherfi", metric: "debt_usd", phase: "loading", response: null, message: null }).headline.emphasis).toBe(
    "Loading the history of the legacy Aave v3 market…",
  );
});

test("error — a fetch that failed is never a refusal: the absent register, the one status code in the dek, its own unavailable card with the service's words disclosed and a retry", () => {
  const verbatim = "500 internal: the service failed to build the response (http://x/v1/observatory/series?engine=debt_manager)";
  const v = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "error", response: null, message: verbatim, serviceSaid: verbatim, status: 500 });
  expect(v.state).toBe("unavailable");
  expect(v.headline).toEqual({
    emphasis: "The history of Cash could not be fetched.",
    rest: "",
    tone: "absent",
    dek: `The service did not return the hourly record (HTTP 500). ${HISTORY_UNAVAILABLE_CLAUSE}`,
  });
  expect(HISTORY_UNAVAILABLE_CLAUSE).toBe("The record is unavailable, and none of it is being shown as empty.");
  expect(v.stateCard).toEqual({
    state: "unavailable",
    title: "Hourly record unavailable",
    cause: "Nothing of this engine's record was read, so nothing is charted.",
    serviceSaid: { label: SERVICE_SAID, text: verbatim },
    action: "retry",
  });
  expect(v.chips).toEqual([{ label: "Hourly record", value: "unavailable" }]);
  expect(v.tiles).toEqual([]);
  // A request that never reached the service states no status.
  const offline = deriveHistoryView({ engine: "debt_manager", metric: "debt_usd", phase: "error", response: null, message: "Failed to fetch" });
  expect(offline.headline.dek).toBe(`The request for the hourly record did not reach the service. ${HISTORY_UNAVAILABLE_CLAUSE}`);
  expect(offline.stateCard?.serviceSaid).toEqual({ label: SERVICE_SAID, text: "Failed to fetch" });
});

test("doctrine: the intro, the chart's method notes and the source note verbatim, in sentences, the stride's sentence, then the wire's own notes — and an absent hour is one no complete batch was OBSERVED in", () => {
  const v = deriveHistoryView(ok(DEMO_OBSERVATORY_DM));
  expect(HISTORY_DOCTRINE).toEqual([
    HISTORY_INTRO,
    "Captured hours: the line never interpolates across a gap.",
    "Absent hour: no complete batch was observed in it.",
    "Withheld hour: the book was refused, so its totals are null and never 0.",
    "Unreadable figure: the hour was recorded, but this figure is not the exact decimal the contract allows, so it is a hole and never 0.",
    "Zero floor drawn: the scale never crops it away.",
    "Select any hour for its record.",
    "Source: the observatory_points rollup; its points survive batch retention, and it keeps each point's batch and materialization identity.",
  ]);
  for (const paragraph of HISTORY_DOCTRINE) expect(paragraph.charAt(0)).toBe(paragraph.charAt(0).toUpperCase());
  // The drawer teaches every mark the key can show: each mark's own word opens one of the method notes.
  for (const mark of HISTORY_MARKS) {
    const word = `${mark.mark.charAt(0).toUpperCase()}${mark.mark.slice(1)} `;
    expect(HISTORY_METHOD.filter((note) => note.startsWith(word))).toHaveLength(1);
  }
  expect(v.doctrine).toEqual([...HISTORY_DOCTRINE, describeStride(DEMO_OBSERVATORY_DM.step_seconds), ...DEMO_OBSERVATORY_DM.notes]);
  const absentWords = [HISTORY_INTRO, HISTORY_DOCTRINE[2] ?? "", HISTORY_MARKS[0]?.label ?? "", HISTORY_ABSENT_NOTE, pointDetailTakeaway({ bucketStart: "2026-08-08T00:00:00Z", kind: "absent", point: null })];
  for (const words of absentWords) {
    expect(words).toMatch(/observed/);
    expect(words).not.toMatch(/no complete (risk )?batch (this hour|in this bucket|existed)|with no complete batch/);
  }
  expect(HISTORY_INTRO).toContain("one engine per view");
  expect(HISTORY_INTRO).toContain("never drawn as a zero");
  expect(v.headline.dek).toContain("a gap on the chart");
  expect(v.headline.dek).not.toContain("One engine per view");
});

test("the headline opens as a sentence at its source: a capital or the money figure itself, in every arm, and the view prints them by identity", () => {
  const opening = /^(?:[A-Z]|\$\d)/;
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok(OBSERVATORY_SERIES_DM)).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok({ ...DEMO_OBSERVATORY_DM, points: [] })).headline.emphasis).toMatch(opening);
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).headline.emphasis.startsWith("Cash debt rose ")).toBe(true);
  expect(deriveHistoryView(ok(OBSERVATORY_SERIES_DM)).headline.emphasis.startsWith("The latest hour's figures ")).toBe(true);
  for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE, OBSERVATORY_SERIES_DM]) {
    const { emphasis, rest } = deriveHistoryView(ok(body)).headline;
    expect(emphasis.endsWith(",")).toBe(true);
    expect(/^\s/.test(rest)).toBe(false);
    expect(`${emphasis} ${rest}`).not.toMatch(/\(s\)|\d{4}-\d{2}-\d{2}T/);
  }
});

test("the chart's mark key: three marks, the lib's words in sentence case, in the plot's order — and the key lists only the marks the drawn series carries", () => {
  expect(HISTORY_MARKS).toEqual([
    { mark: "absent", label: "No complete batch observed" },
    { mark: "withheld", label: "Batch present, figures withheld" },
    { mark: "unreadable", label: "Figure unreadable" },
  ]);
  expect(deriveHistoryView(ok(DEMO_OBSERVATORY_DM)).marks).toEqual([HISTORY_MARKS[0], HISTORY_MARKS[1]]);
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-3) };
  expect(deriveHistoryView(ok(whole)).marks).toEqual([]);
  expect(marksFor([null, null])).toEqual([]);
  expect(marksFor([null, "withheld", null, "withheld"])).toEqual([HISTORY_MARKS[1]]);
  expect(marksFor(["null", "unreadable", "absent"])).toEqual([HISTORY_MARKS[0], HISTORY_MARKS[2]]);
});

test.describe("pointRecord — the hour record's rows and sentences", () => {
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const newestEntry = axis.entries[axis.newestPointIndex]!;
  const newest = newestEntry.point!;
  const withheldEntry = axis.entries.find((e) => e.kind === "withheld")!;
  const absentEntry = axis.entries.find((e) => e.kind === "absent")!;
  const labels = (rows: readonly { label: string }[]) => rows.map((r) => r.label);
  const row = (over: Record<string, unknown>) => ({ note: null, noteTone: "caption", tone: "neutral", mono: false, copy: null, title: null, testId: null, ...over });

  test("the demo's newest hour: named in the reader's words; the answer rows in sentence case with the exact ledger strings and their copy action; on Cash the counts are accounts; the provenance rows behind a counted fold", () => {
    const r = pointRecord(newestEntry, DEMO_OBSERVATORY_DM, true);
    expect(r.title).toBe(`Latest hour · ${nb("Aug 8, 20:00 UTC")}`);
    expect(recordTitle("2026-08-05T14:00:00Z", DEMO_OBSERVATORY_DM.served_at, false)).toBe(`Selected hour · ${nb("Aug 5, 14:00 UTC")}`);
    expect(pointRecord(newestEntry, DEMO_OBSERVATORY_DM).title).toBe(`Selected hour · ${nb("Aug 8, 20:00 UTC")}`);
    expect(r.bucket).toBe(newest.bucket_start);
    expect(r.kind).toBe("captured");
    expect(r.takeaway).toBe(pointDetailTakeaway(newestEntry));
    expect(r.takeaway).toBe("Captured · balances as of block 155,323,444.");
    expect(r.absentNote).toBeNull();
    expect(r.refusalCode).toBeNull();
    expect(labels(r.answer)).toEqual(["State", "Debt (USD)", "Collateral (USD)", "Accounts", "Accounts with no verdict", "Liquidatable accounts"]);
    expect(r.answer[0]).toEqual(row({ key: "state", label: "State", value: "Captured" }));
    const debt = displayMetric(newest, "debt_usd", DEMO_OBSERVATORY_DM.usd_decimals);
    expect(r.answer[1]).toEqual(row({ key: "debt", label: "Debt (USD)", value: debt, copy: { text: debt, label: "Copy debt (USD)" } }));
    expect(r.answer[1]?.value).toBe("$27,828,808.216758");
    expect(r.answer[2]).toMatchObject({ value: "$153,171,572.777189", copy: { text: "$153,171,572.777189", label: "Copy collateral (USD)" }, mono: false });
    expect(r.answer[3]?.value).toBe("1,412");
    expect(r.answer[4]?.value).toBe(groupInt(newest.refused_positions));
    expect(r.answer[5]?.value).toBe(groupInt(newest.liquidatable_positions!));
    expect(labels(r.forensic)).toEqual(["Hour (its own as-of)", "Watermark", "Observed batch", "Materialization key", "Reorg posture at compute", "Sweep stamp (the count's collateral clock)"]);
    // A record field's instant is typeset, every field kept, the zone named; the wire ISO is its title.
    expect(r.forensic[0]).toEqual(row({ key: "bucket", label: "Hour (its own as-of)", value: "2026-08-08 20:00:00 UTC", title: newest.bucket_start }));
    expect(r.forensic[1]).toEqual(row({ key: "watermark", label: "Watermark", value: `block ${formatBlock(newest.last_block)}`, note: " (the engine's balances watermark at capture, never a chain head observed later)" }));
    expect(r.forensic[2]).toEqual(row({ key: "batch", label: "Observed batch", value: `#${String(newest.batch_id)}`, note: " (the complete batch this hour observed; the batch itself may since have been pruned by retention)", testId: "history-point-batch" }));
    expect(r.forensic[3]).toEqual(row({ key: "key", label: "Materialization key", value: newest.materialization_key, note: " (copied at write time, so the attribution survives retention)", mono: true, copy: { text: newest.materialization_key, label: "Copy materialization key" }, testId: "history-point-mkey" }));
    // One action, one name on every page: Verification's key row names its copy action in these same words.
    // A copy action's name is a sentence-case line: only the name's own capitals survive, never a label's leading one.
    for (const x of [...r.answer, ...r.forensic]) if (x.copy !== null) expect(x.copy.label).toMatch(/^Copy [a-z]/);
    expect(r.forensic[4]).toEqual(row({ key: "reorg", label: "Reorg posture at compute", value: "None unacked", note: " (the stamp pair copied from the observed batch's watermark vector)", testId: "history-point-epochs" }));
    const sweep = newest.sweep!;
    expect(r.forensic[5]).toEqual(
      row({
        key: "sweep",
        label: "Sweep stamp (the count's collateral clock)",
        value: `${String(sweep.rows)} swept · ${String(sweep.failed)} failed · gen ${String(sweep.generation)} (pass complete)`,
        note: " · the observed batch's own sweep stamp; the liquidatable count above aggregates this sweep-cut, not the hour's block clock. Last successful write 2026-08-08 20:02:45 UTC",
        title: sweep.max_updated_at,
        testId: "history-point-sweep",
      }),
    );
    expect(r.forensicSummary).toBe("6 provenance rows + the rate snapshot");
    for (const x of [...r.answer, ...r.forensic]) expect(x.noteTone).toBe("caption");
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
    expect(HISTORY_PROVENANCE.charAt(0)).toBe("P");
    expect(HISTORY_RATE_COLUMNS.map((c) => c.header)).toEqual(["Rate index", "Asset", "Value (raw decimal)", "Scale", "Its own as-of block", "Note"]);
    expect(HISTORY_RATE_COLUMNS.filter((c) => c.align === "right").map((c) => c.key)).toEqual(["value", "block"]);
    // On the legacy market the counts are positions.
    const aaveAxis = buildBucketAxis(DEMO_OBSERVATORY_AAVE);
    expect(labels(pointRecord(aaveAxis.entries[aaveAxis.newestPointIndex]!, DEMO_OBSERVATORY_AAVE).answer)).toEqual([
      "State",
      "Debt (USD)",
      "Collateral (USD)",
      "Accounts",
      "Positions with no verdict",
      "Liquidatable positions",
    ]);
  });

  test("the withheld hour: the state word is refused with its code; the null totals are em dashes with the never-zero clause and no copy action; no snapshot, and the note says why", () => {
    const r = pointRecord(withheldEntry, DEMO_OBSERVATORY_DM);
    expect(r.kind).toBe("withheld");
    expect(r.takeaway).toBe(pointDetailTakeaway(withheldEntry));
    expect(r.refusalCode).toBe("FLAG_CUSTODY_UNPROVEN");
    expect(r.answer[0]).toEqual(row({ key: "state", label: "State", value: "Withheld", note: " · FLAG_CUSTODY_UNPROVEN · the engine's whole book was withheld at capture time", noteTone: "state", tone: "refused" }));
    expect(r.answer[1]).toMatchObject({ value: EM_DASH, note: ", null because the book was withheld and never zero", noteTone: "state", copy: null });
    expect(r.answer[2]).toMatchObject({ value: EM_DASH, note: ", null because the book was withheld and never zero", noteTone: "state" });
    expect(r.answer[3]?.value).toBe(EM_DASH);
    expect(r.answer[5]?.value).toBe(EM_DASH);
    expect(r.answer[4]).toMatchObject({ label: "Accounts with no verdict", value: String(withheldEntry.point!.refused_positions) });
    expect(r.answer.some((x) => x.value.includes("$0"))).toBe(false);
    expect(r.rates).toEqual([]);
    expect(r.ratesEmpty).toBe("No rate snapshot was captured with this hour (the whole book was withheld).");
    expect(r.forensicSummary).toBe("6 provenance rows + the rate-snapshot note");
  });

  test("a dashed money total names its TRUE cause: withheld with the book, not stated by a captured hour, or unreadable — the last one never a throw and never zero", () => {
    const mutate = (change: Partial<typeof newest>) => ({ ...newestEntry, point: { ...newest, ...change } });
    const unstated = pointRecord(mutate({ debt_usd: null }), DEMO_OBSERVATORY_DM);
    expect(unstated.answer[1]).toEqual(row({ key: "debt", label: "Debt (USD)", value: EM_DASH, note: ", not stated for this hour and never zero", noteTone: "state" }));
    for (const bad of ["", "12.5", "1e9", "0x10"]) {
      const unreadable = pointRecord(mutate({ debt_usd: bad }), DEMO_OBSERVATORY_DM);
      expect(unreadable.answer[0]?.value).toBe("Captured");
      expect(unreadable.answer[1]).toEqual(
        row({ key: "debt", label: "Debt (USD)", value: EM_DASH, note: ", unreadable: the wire's value is not an exact decimal, and it is never shown as zero", noteTone: "state" }),
      );
      expect(unreadable.answer[2]?.value).toBe("$153,171,572.777189");
      expect(unreadable.answer.some((x) => x.value.includes("$0") || x.value.includes("NaN"))).toBe(false);
    }
  });

  test("an absent hour: the absence stated by name, nothing to fold", () => {
    const r = pointRecord(absentEntry, DEMO_OBSERVATORY_DM);
    expect(r.kind).toBe("absent");
    expect(r.takeaway).toBe("Absent: no complete batch was observed in this hour.");
    expect(r.absentNote).toBe(HISTORY_ABSENT_NOTE);
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
    expect(labels(unacked.forensic)).not.toContain("Reorg posture at compute");
    expect(unacked.forensicSummary).toBe("5 provenance rows + the rate snapshot");
    const unrecorded = pointRecord(mutate({ sweep_recorded: false, sweep: null }), DEMO_OBSERVATORY_DM);
    expect(unrecorded.answer.at(-1)).toEqual(
      row({
        key: "sweep",
        label: "Sweep stamp (the count's collateral clock)",
        value: EM_DASH,
        note: " unrecorded: this point predates migration 00018 and its batch was pruned before the stamp could be recovered. The record is missing here, and it is not a claim that the engine has no sweeper.",
        noteTone: "state",
        testId: "history-point-sweep",
      }),
    );
    const unstated = pointRecord(mutate({ rates: newest.rates.map((rate) => ({ ...rate, scale: "unstated" as const })) }), DEMO_OBSERVATORY_DM);
    expect(unstated.ratesOutside).toBe(true);
    expect(unstated.rates[0]).toMatchObject({ scale: "unstated · kind outside the known vocabulary", scaleStated: false });
    expect(unstated.forensicSummary).toBe("6 provenance rows");
    const all = pointRecord(mutate({ max_epoch_at_compute: newest.acked_epoch + 1, sweep_recorded: false, sweep: null, rates: newest.rates.map((rate) => ({ ...rate, scale: "unstated" as const })) }), DEMO_OBSERVATORY_DM);
    expect(all.forensicSummary).toBe("4 provenance rows");
    expect(labels(all.forensic)).toEqual(["Hour (its own as-of)", "Watermark", "Observed batch", "Materialization key"]);
  });

  test("the legacy market's sweep is recorded None — the record says so, never an em dash", () => {
    const aaveAxis = buildBucketAxis(DEMO_OBSERVATORY_AAVE);
    const r = pointRecord(aaveAxis.entries[aaveAxis.newestPointIndex]!, DEMO_OBSERVATORY_AAVE);
    expect(r.forensic.find((x) => x.key === "sweep")).toEqual(
      row({ key: "sweep", label: "Sweep stamp (the count's collateral clock)", value: "None", note: " (recorded: this engine has no collateral sweep, so its balances are event-derived)", testId: "history-point-sweep" }),
    );
  });
});
