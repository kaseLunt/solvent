// web/tests/e2e/history.spec.ts
// The History page-test contract. The API is MOCKED by route interception
// from the demo dataset: the series bodies by the `engine` query, the meta the
// shell reads, the stream aborted.
// Every expectation below is COMPUTED from the same fixture bytes the route
// mock serves, through the pure layer (lib/observatory-series,
// lib/history-view) — never pinned as a literal a hardcoding component could
// coincidentally match — except the page's fixed words (the kicker,
// the tile labels, the gap words) and ONE literal per demo sentence, so the
// words themselves are pinned and not only their plumbing.
//
// What this pins: the cold load (the page opens on Cash, Cash first in the
// switch; the header in ink — a record wears no verdict's colour; the H1 =
// the takeaway's emphasis + rest, the holes counted in the dek; five chips,
// four tiles = the Book's figures); the engine switch (remount, kicker,
// tiles, the request's engine); the holes (the withheld and absent buckets
// as the chart's own gap marks, never a zero; the bucket record naming
// each); the degraded rollup as
// a named refused state with no tiles and no chart; the drawer (doctrine
// verbatim, Escape, focus restored); the metric selector (the drawn series and
// its labels move; the finding is the grid's and holds); the direct labels
// (the y-max named the window's peak, over the peak where it has room); the
// contract's own withheld-newest example (the qualified label, the dashed
// tiles, the sparse-window line); a figure that fails its wire guard as a
// named hole — headline, tile, mark, key and record — never the route
// boundary, whatever JavaScript type the money arrived in; a series that
// answers for another engine than the one asked, refused by name; the bucket
// record's provenance and the three sweep states; the
// hazard placement; a state clause never in the caption ink; no key on a
// hole-free window; the record named by its heading; a phone's width with no
// sideways scroll; loading; the error arm; answer before evidence.
import { expect, test, type Page, type Route } from "@playwright/test";
import { EM_DASH, formatBlock } from "../../lib/format";
import {
  deriveHistoryView,
  HISTORY_DEGRADED_CLAUSE,
  HISTORY_FOREIGN_CLAUSE,
  HISTORY_INTRO,
  HISTORY_LOADING_DEK,
  HISTORY_MARKS,
  HISTORY_UNAVAILABLE_CLAUSE,
} from "../../lib/history-view";
import { humanUsd } from "../../lib/human-usd";
import type { ObservatorySeriesResponse } from "../../lib/observatory-data";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeStride,
  gridReadingLine,
  observatoryTakeaway,
  pointDetailTakeaway,
  seriesMaxPoint,
  seriesNewestPoint,
  type BucketMetric,
} from "../../lib/observatory-series";
import { groupInt } from "../../lib/prose";
import { DEMO_BOOK, DEMO_META, DEMO_OBSERVATORY_AAVE, DEMO_OBSERVATORY_DM } from "../fixtures/demo";
import { FEED_ERROR_INTERNAL } from "../fixtures/feed";
import { OBSERVATORY_DEGRADED, OBSERVATORY_SERIES_AAVE, OBSERVATORY_SERIES_DM } from "../fixtures/observatory";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** A route that never answers: the loading state, held. */
const stall = (): Promise<void> => new Promise(() => {});

interface Series {
  readonly aave: ObservatorySeriesResponse;
  readonly dm: ObservatorySeriesResponse;
}
const DEMO: Series = { aave: DEMO_OBSERVATORY_AAVE, dm: DEMO_OBSERVATORY_DM };
/** The contract's own bodies: the DM example whose NEWEST bucket is withheld; the derived aave series with one absent hour. */
const CONTRACT: Series = { aave: OBSERVATORY_SERIES_AAVE, dm: OBSERVATORY_SERIES_DM };

/** The shell's routes plus the series by engine; the stream is not under test. Returns the engines asked for, in order. */
async function mockHistory(page: Page, series: Series = DEMO): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => fulfillJson(route, DEMO_META));
  await page.route("**/v1/observatory/series*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine") ?? "";
    asked.push(engine);
    return fulfillJson(route, engine === "debt_manager" ? series.dm : series.aave);
  });
  return asked;
}

/** The shell's routes without the series: the caller routes the series itself. */
async function mockShell(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => fulfillJson(route, DEMO_META));
}

const engineOf = (response: ObservatorySeriesResponse) =>
  response.engine === "debt_manager" ? ("debt_manager" as const) : ("aave_v3_etherfi" as const);
const viewOf = (response: ObservatorySeriesResponse, metric: BucketMetric = "debt_usd") =>
  deriveHistoryView({ engine: engineOf(response), metric, phase: "ok", response, message: null });
const chip = (page: Page, label: string) => page.getByTestId("history-verdict").locator(`[data-chip="${label}"]`);
const card = (engine: string) => DEMO_BOOK.engines.find((e) => e.engine === engine)!;
const money = (value: string | null, decimals: number) => humanUsd(BigInt(value!), decimals);
const newestOf = (response: ObservatorySeriesResponse) => response.points[response.points.length - 1]!;
const TILES = ["debt", "collateral", "accounts", "liquidatable"] as const;
/** The H1 is the takeaway's parts joined by one space — the one sentence, from the one function. */
const headlineOf = (response: ObservatorySeriesResponse) => {
  const takeaway = observatoryTakeaway(response, buildBucketAxis(response), engineOf(response));
  return { ...takeaway, h1: takeaway.rest === "" ? takeaway.emphasis : `${takeaway.emphasis} ${takeaway.rest}` };
};

test("cold load: the page opens on Cash, Cash first in the switch; state ok; the header is ink (neutral); the H1 IS the takeaway's emphasis + rest and the holes are counted in the dek; five chips; four tiles with the Book's figures", async ({
  page,
}) => {
  const asked = await mockHistory(page);
  await page.goto("/observatory");
  const surface = page.getByTestId("history-surface");
  await expect(surface).toHaveAttribute("data-state", "ok");
  await expect(surface).toHaveAttribute("data-engine", "debt_manager");
  await expect(page.getByTestId("history-engine-debt_manager")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("history-engine-aave_v3_etherfi")).toHaveAttribute("aria-pressed", "false");
  // Cash leads the switch, and the first request the page makes is Cash's.
  await expect(page.locator('[data-testid^="history-engine-"]')).toHaveText(["Cash", "Aave v3 market (legacy)"]);
  expect(asked[0]).toBe("debt_manager");

  const takeaway = headlineOf(DEMO_OBSERVATORY_DM);
  // A statement of record wears ink — holes and all; their severity is the census chip's.
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(page.getByTestId("history-verdict")).toContainText("History · Cash");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(takeaway.h1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(takeaway.h1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "$27.8M of Cash debt is outstanding, across 1,412 accounts in the hour starting Aug 8, 20:00 UTC.",
  );
  await expect(page.getByTestId("history-verdict-headline").locator("b")).toHaveText(takeaway.emphasis);
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(takeaway.dek);
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(
    "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch was observed — and 1 was withheld; each is a gap on the chart, never a zero.",
  );

  await expect(chip(page, "Engine")).toContainText("Cash");
  // The stride is one reader's word; its method sentence is the chip's title (and a drawer paragraph), not its face.
  await expect(chip(page, "Stride")).toHaveText("Stride hourly");
  await expect(chip(page, "Stride")).toHaveAttribute("title", describeStride(DEMO_OBSERVATORY_DM.step_seconds));
  await expect(chip(page, "Stride")).not.toContainText("verbatim");
  await expect(chip(page, "Range")).toContainText(`${DEMO_OBSERVATORY_DM.from ?? "unbounded"} → unbounded`);
  // The window is counted in hours, in the dek's own words ("recorded", "withheld", "absent").
  await expect(chip(page, "Hours")).toContainText("165 recorded · 1 withheld · 2 absent");
  await expect(chip(page, "Buckets")).toHaveCount(0);
  // The envelope carries served_at and no age: the wire's own instant, verbatim.
  await expect(chip(page, "Served")).toContainText(DEMO_OBSERVATORY_DM.served_at);

  // The four tiles ARE the Book's Cash card at the newest bucket (the demo weld), through the Book's money tier.
  const c = card("debt_manager");
  const newest = newestOf(DEMO_OBSERVATORY_DM);
  await expect(page.locator('[data-testid^="history-kpi-"]')).toHaveCount(4);
  await expect(page.getByTestId("history-kpi-debt")).toContainText(money(c.total_debt, c.value_decimals));
  await expect(page.getByTestId("history-kpi-collateral")).toContainText(money(c.total_collateral, c.value_decimals));
  await expect(page.getByTestId("history-kpi-accounts")).toContainText(groupInt(c.positions));
  await expect(page.getByTestId("history-kpi-liquidatable")).toContainText(groupInt(c.liquidatable_positions));
  for (const key of TILES) {
    await expect(page.getByTestId(`history-kpi-${key}`)).toHaveAttribute("data-tone", "neutral");
    // The exact instant the headline humanised stays one glance away, verbatim, under the reader's word for it.
    await expect(page.getByTestId(`history-kpi-${key}`)).toContainText(`hour of ${newest.bucket_start}`);
    await expect(page.getByTestId(`history-kpi-${key}`)).not.toContainText("bucket");
  }
  // No legacy figure leaks into the Cash view (engines never combined).
  const aave = card("aave_v3_etherfi");
  await expect(page.locator("body")).not.toContainText(money(aave.total_debt, aave.value_decimals));
});

test("engine switch: explicit, one engine per view — the view remounts, the kicker, the sentence and the tiles become the legacy market's, the request carried the engine", async ({
  page,
}) => {
  const asked = await mockHistory(page);
  await page.goto("/observatory");
  const aave = card("aave_v3_etherfi");
  const dm = card("debt_manager");
  await expect(page.getByTestId("history-kpi-debt")).toContainText(money(dm.total_debt, dm.value_decimals));

  await page.getByTestId("history-engine-aave_v3_etherfi").click();

  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "aave_v3_etherfi");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("history-engine-aave_v3_etherfi")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("history-engine-debt_manager")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("history-verdict")).toContainText("History · Aave v3 market (legacy)");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(headlineOf(DEMO_OBSERVATORY_AAVE).h1);
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(
    "$1.9M of legacy Aave v3 debt is outstanding, across 8,552 accounts in the hour starting Aug 8, 20:00 UTC.",
  );
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(chip(page, "Engine")).toContainText("Aave v3 market (legacy)");
  // The legacy view replaces the Cash view wholesale — no Cash total remains, in a tile or in a sentence.
  await expect(page.getByTestId("history-kpi-debt")).toContainText(money(aave.total_debt, aave.value_decimals));
  await expect(page.getByTestId("history-kpi-debt")).not.toContainText(money(dm.total_debt, dm.value_decimals));
  await expect(page.getByTestId("history-kpi-accounts")).toContainText(groupInt(aave.positions));
  await expect(page.locator("body")).not.toContainText(money(dm.total_collateral, dm.value_decimals));
  await expect(page.locator("body")).not.toContainText(money(dm.total_debt, dm.value_decimals));
  // The wire was asked for exactly the selected engines, in order.
  expect(asked[0]).toBe("debt_manager");
  expect(asked[asked.length - 1]).toBe("aave_v3_etherfi");

  // And back: the switch is a toggle pair, not a one-way door.
  await page.getByTestId("history-engine-debt_manager").click();
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "debt_manager");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(headlineOf(DEMO_OBSERVATORY_DM).h1);
});

test("the holes are the chart's own marks, never a zero: two absent ticks, one withheld tick wearing the warn square, the line broken at each; the record names the kind on click and the tiles hold", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const debt = buildMetricSeries(axis, DEMO_OBSERVATORY_DM, "debt_usd");
  const chart = page.getByTestId("history-chart");

  // (toBeAttached / count: a stroke-only SVG tick has a zero-width box, which the visibility heuristic reports hidden.)
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="absent"]')).toHaveCount(axis.absentCount);
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="withheld"]')).toHaveCount(axis.withheldCount);
  await expect(chart.getByTestId("obs-gap-warn")).toHaveCount(1);
  expect(axis.absentCount).toBe(2);
  expect(axis.withheldCount).toBe(1);
  // The line breaks at every gap: one path per run of captured buckets, never a bridge.
  const segments = debt.values.reduce<number>(
    (n, v, i) => (v !== null && (i === 0 || debt.values[i - 1] === null) ? n + 1 : n),
    0,
  );
  expect(segments).toBe(3);
  await expect(chart.locator("path")).toHaveCount(segments);
  await expect(page.locator("body")).not.toContainText("$0");
  // The key beside the finding line maps each glyph to its word — the lib's labels for the marks THIS window draws
  // (absent and withheld; no figure in it is unreadable, so that mark is not keyed), the same marks the plot draws.
  const marks = page.getByTestId("history-marks");
  await expect(marks.locator("li")).toHaveText(viewOf(DEMO_OBSERVATORY_DM).marks.map((mark) => mark.label));
  await expect(marks.locator("li")).toHaveText([HISTORY_MARKS[0]!.label, HISTORY_MARKS[1]!.label]);
  // An absent hour is one no complete batch was OBSERVED in: the page claims the observation, never that none existed.
  await expect(marks).toContainText("no complete batch was observed");
  await expect(marks).toContainText("batch present, figures withheld");
  await expect(marks.locator('[data-mark="withheld"] rect')).toHaveCount(1);
  await expect(marks.locator('[data-mark="absent"] rect')).toHaveCount(0);
  await expect(marks.locator('[data-mark="unreadable"]')).toHaveCount(0);

  // The withheld hour: the record names the refusal and keeps its nulls null.
  const withheldIndex = axis.entries.findIndex((e) => e.kind === "withheld");
  const withheld = axis.entries[withheldIndex]!;
  await chart.locator(`[data-testid="obs-gap-hit"][data-index="${String(withheldIndex)}"]`).click();
  const record = page.getByTestId("history-point");
  await expect(record).toHaveAttribute("data-kind", "withheld");
  await expect(record).toHaveAttribute("data-bucket", withheld.bucketStart);
  await expect(page.getByTestId("history-point-takeaway")).toHaveText(pointDetailTakeaway(withheld));
  await expect(record).toContainText("FLAG_CUSTODY_UNPROVEN");
  await expect(record.getByText("null because the book was withheld and never zero").first()).toBeVisible();
  await expect(record).toContainText(EM_DASH);
  await expect(chart.getByTestId("obs-x-selected")).toHaveText(withheld.bucketStart);
  // A click on a hole never moves the answer: the tiles stay the newest bucket's.
  await expect(page.getByTestId("history-kpi-debt")).toHaveAttribute("data-tone", "neutral");

  // The absent hour: the record states the absence by name.
  const absentIndex = axis.entries.findIndex((e) => e.kind === "absent");
  const absent = axis.entries[absentIndex]!;
  await chart.locator(`[data-testid="obs-gap-hit"][data-index="${String(absentIndex)}"]`).click();
  await expect(record).toHaveAttribute("data-kind", "absent");
  await expect(record).toHaveAttribute("data-bucket", absent.bucketStart);
  await expect(page.getByTestId("history-point-takeaway")).toHaveText(pointDetailTakeaway(absent));
  await expect(record).toContainText("ABSENT · no complete batch was observed in this bucket");
  await expect(record).toContainText("no complete risk batch was observed in it");
  await expect(record).not.toContainText("existed to observe");
  await expect(record).toContainText("never renders as zero");
  // The gap's own hover says the same: observed, not existed.
  await expect(chart.locator(`[data-testid="obs-gap"][data-kind="absent"] title`).first()).toContainText(
    "no complete batch was observed in this bucket",
  );
  await expect(chart.getByTestId("obs-x-selected")).toHaveText(absent.bucketStart);
});

test("the degraded rollup is a NAMED refused state: no tiles, no chart, the wire's message in the dek, the deployment note in the drawer", async ({
  page,
}) => {
  await mockShell(page);
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, OBSERVATORY_DEGRADED, 503));
  await page.goto("/observatory");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "degraded");
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(
    "No hourly history exists for Cash on this deployment yet.",
  );
  // The server's own message, verbatim, as the dek's first sentence; then what the state is and where the live figures are.
  await expect(page.getByTestId("history-verdict-dek")).toContainText("observatory_points does not exist on this database");
  await expect(page.getByTestId("history-verdict-dek")).toContainText(HISTORY_DEGRADED_CLAUSE);
  await expect(page.getByTestId("history-verdict-dek")).toContainText(
    "That is a fact about this deployment, not an empty history; live figures are on the Book.",
  );
  await expect(chip(page, "Rollup")).toContainText("unavailable");
  await expect(page.locator('[data-testid^="history-kpi-"]')).toHaveCount(0);
  await expect(page.getByTestId("history-chart")).toHaveCount(0);
  await expect(page.getByTestId("history-point")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$0");

  await page.getByTestId("history-drawer").click();
  await expect(page.getByTestId("history-drawer-body")).toContainText(
    "this deployment's database predates the observatory rollup (migration 00016)",
  );
});

test("the doctrine lives in the drawer, verbatim — the intro, the chart's method notes, the source, the wire's own notes; main does not carry the intro before it opens; Escape closes it and the button regains focus", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  const view = viewOf(DEMO_OBSERVATORY_DM);
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("main")).not.toContainText("in a record that outlives batch retention");
  // The slogan is the drawer's; the header's dek is a fact about this window.
  await expect(page.getByTestId("history-verdict-dek")).not.toContainText("One engine per view");
  await expect(page.getByTestId("history-drawer-body")).toHaveCount(0);

  await page.getByTestId("history-drawer").click();
  const body = page.getByTestId("history-drawer-body");
  await expect(body.locator("p")).toHaveText([...view.doctrine]);
  await expect(body).toContainText(HISTORY_INTRO);
  await expect(body).toContainText("the line never interpolates across a gap");
  await expect(body).toContainText("withheld bucket · the book was refused, so totals are null and never 0");
  await expect(body).toContainText("zero floor drawn · the scale never crops it away");
  await expect(body).toContainText(DEMO_OBSERVATORY_DM.notes[0] ?? "NEVER");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("history-drawer-body")).toHaveCount(0);
  await expect(page.getByTestId("history-drawer")).toBeFocused();
});

test("the metric selector redraws the chart: the pressed metric, the chart's name and the newest figure's label are that metric's; the finding is the grid's (R6) and holds", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const chart = page.getByTestId("history-chart");
  const finding = gridReadingLine(DEMO_OBSERVATORY_DM, axis);
  await expect(page.getByTestId("history-chart-finding")).toHaveText(finding);
  // The finding states DELTAS on one engine at one scale — the compact tier would flatten an "A → B" pair.
  // Each movement says its change and its end apart ("rose by 1, to 49" — never "rose 1 to 49", which reads as a range).
  await expect(page.getByTestId("history-chart-finding")).toHaveText(
    "Between the first and last recorded hours (Aug 1, 21:00 → Aug 8, 20:00 UTC), debt rose by $1.8M, to $27.8M; accounts fell by 52, to 1,412; and liquidatable positions rose by 1, to 49.",
  );

  const debt = buildMetricSeries(axis, DEMO_OBSERVATORY_DM, "debt_usd");
  const debtNewest = seriesNewestPoint(axis, DEMO_OBSERVATORY_DM, "debt_usd", debt);
  if (debtNewest === null) throw new Error("fixture invariant: the debt series plots a newest point");
  await expect(page.getByTestId("history-metric-debt_usd")).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator("svg[role='img']")).toHaveAttribute("aria-label", viewOf(DEMO_OBSERVATORY_DM, "debt_usd").chartLabel ?? "NEVER");
  await expect(chart.getByTestId("obs-newest-value")).toHaveText(debtNewest.directLabel);

  await page.getByTestId("history-metric-accounts").click();
  const accounts = buildMetricSeries(axis, DEMO_OBSERVATORY_DM, "accounts");
  const accountsNewest = seriesNewestPoint(axis, DEMO_OBSERVATORY_DM, "accounts", accounts);
  if (accountsNewest === null) throw new Error("fixture invariant: the accounts series plots a newest point");
  await expect(page.getByTestId("history-metric-accounts")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("history-metric-debt_usd")).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator("svg[role='img']")).toHaveAttribute("aria-label", "accounts for Cash across rollup buckets");
  await expect(chart.getByTestId("obs-newest-value")).toHaveText(accountsNewest.directLabel);
  expect(accountsNewest.directLabel).not.toBe(debtNewest.directLabel);
  // The finding reads the grid — debt, accounts and liquidatable between the first and last recorded hours — and does not move with the metric.
  await expect(page.getByTestId("history-chart-finding")).toHaveText(finding);
  // The tiles above are not the chart's: they hold.
  await expect(page.getByTestId("history-kpi-debt")).toHaveAttribute("data-tone", "neutral");
});

test("W-OBS: the direct labels — the drawn y-max's ledger string, the x extents, the selected time — are the pure layer's strings; a dense window states no sparse line", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  const chart = page.getByTestId("history-chart");
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const debt = buildMetricSeries(axis, DEMO_OBSERVATORY_DM, "debt_usd");
  const maxPoint = seriesMaxPoint(axis, DEMO_OBSERVATORY_DM, "debt_usd", debt);
  const newestPoint = seriesNewestPoint(axis, DEMO_OBSERVATORY_DM, "debt_usd", debt);
  if (maxPoint === null || newestPoint === null) throw new Error("fixture invariant: the debt series plots a max and a newest point");
  expect(newestPoint.atNewestBucket).toBe(true);

  // One point, one label: the y-max prints its exact ledger string unless it IS the newest plotted point, whose
  // label already prints that string. It is NAMED the window's peak: a bare figure at the plot's left edge reads as
  // the starting value — above a sentence saying debt rose.
  if (maxPoint.index === newestPoint.index) await expect(chart.getByTestId("obs-ymax-label")).toHaveCount(0);
  else await expect(chart.getByTestId("obs-ymax-label")).toHaveText(maxPoint.directLabel);
  await expect(chart.getByTestId("obs-newest-value")).toHaveText(newestPoint.label);
  // The labels are the exact layer the finding leans on: grouped, the digits the wire's own.
  await expect(chart.getByTestId("obs-newest-value")).toHaveText("$27,828,808.216758");
  await expect(chart.getByTestId("obs-ymax-label")).toHaveText("peak $27,942,906.330446");
  // The demo's peak is nine hours before the newest hour: over the peak the label would run into the newest figure's
  // label, so it keeps the plot's left edge — where its word still says what it is.
  expect(newestPoint.index - maxPoint.index).toBe(9);
  await expect(chart.getByTestId("obs-ymax-label")).toHaveAttribute("data-place", "edge");

  // No label is struck through. Each sits ABOVE the reference it names — its baseline over the floor rule, over the
  // highest plotted point, over the newest point — and all three are painted after the line and the points, haloed.
  const geometry = await chart.locator("svg[role='img']").evaluate((svg) => {
    const all = Array.from(svg.querySelectorAll("*"));
    const num = (el: Element | null, name: string) => Number(el?.getAttribute(name) ?? Number.NaN);
    const points = Array.from(svg.querySelectorAll('[data-testid="obs-point"]'));
    const lastDrawn = Math.max(...points.map((el) => all.indexOf(el)), ...Array.from(svg.querySelectorAll("path")).map((el) => all.indexOf(el)));
    const label = (id: string) => svg.querySelector(`[data-testid="${id}"]`);
    const labels = ["obs-zero-label", "obs-ymax-label", "obs-newest-value"].map(label);
    return {
      height: num(svg, "height"),
      floorY: num(svg.querySelector('[data-testid="obs-zero-floor"] line'), "y1"),
      zeroY: num(labels[0] ?? null, "y"),
      topPointY: Math.min(...points.map((el) => num(el, "cy"))),
      maxY: num(labels[1] ?? null, "y"),
      newestPointY: num(points[points.length - 1] ?? null, "cy"),
      newestY: num(labels[2] ?? null, "y"),
      paintedLast: labels.every((el) => el !== null && all.indexOf(el) > lastDrawn),
      haloed: labels.every((el) => el instanceof SVGElement && el.style.paintOrder.startsWith("stroke") && el.style.stroke !== ""),
      dotRadius: num(points[0] ?? null, "r"),
    };
  });
  expect(geometry.zeroY).toBeLessThan(geometry.floorY);
  expect(geometry.maxY).toBeLessThan(geometry.topPointY);
  expect(geometry.newestY).toBeLessThan(geometry.newestPointY);
  expect(geometry.paintedLast).toBe(true);
  expect(geometry.haloed).toBe(true);
  // The plot is sized to what it shows: 120px of plot plus the one extents strip (the selection is the newest hour).
  expect(geometry.height).toBe(134);
  // A week of hours at rest reads as a line, not a bead chain: the visible dot is small; the click target is not.
  expect(geometry.dotRadius).toBe(1.5);

  const oldestEntry = axis.entries[0]!;
  const newestEntry = axis.entries[axis.entries.length - 1]!;
  await expect(chart.getByTestId("obs-x-start")).toHaveText(oldestEntry.bucketStart);
  await expect(chart.getByTestId("obs-x-end")).toHaveText(newestEntry.bucketStart);
  // The default selection is the newest bucket, whose hour the x-end already states — no duplicate row.
  await expect(chart.getByTestId("obs-x-selected")).toHaveCount(0);

  const firstPlottedIndex = debt.values.findIndex((v) => v !== null);
  await chart.locator('[data-testid="obs-point"]').first().click();
  await expect(chart.getByTestId("obs-x-selected")).toHaveText(axis.entries[firstPlottedIndex]!.bucketStart);
  await expect(page.getByTestId("history-point")).toHaveAttribute("data-bucket", axis.entries[firstPlottedIndex]!.bucketStart);
  await expect(page.getByTestId("history-chart-sparse")).toHaveCount(0);
});

test("W-OBS-B, the contract's own example: a withheld NEWEST bucket dashes every tile with its word, turns the headline refused, qualifies the chart's older label, states the sparse window, and the record opens on the refusal", async ({
  page,
}) => {
  await mockHistory(page, CONTRACT);
  await page.goto("/observatory");
  // The page opens on Cash, and the contract's Cash example IS the withheld-newest one.
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "debt_manager");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");

  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  const takeaway = headlineOf(OBSERVATORY_SERIES_DM);
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(takeaway.h1);
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(
    "The latest hour's figures were withheld, so no current debt figure is shown (Jul 29, 09:00 UTC).",
  );
  await expect(page.getByTestId("history-verdict-headline")).toContainText("withheld");
  // The dek names the cause in plain words with the wire's code, then counts the window's holes.
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(takeaway.dek);
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(
    "The engine's whole book was refused in that hour (collateral-flag custody unproven · FLAG_CUSTODY_UNPROVEN). 1 of the 2 hours in this window was recorded. 1 was withheld; it is a gap on the chart, never a zero.",
  );
  // No older figure stands in for the withheld hour, in the header's words either.
  await expect(page.getByTestId("history-verdict-headline")).not.toContainText("$");
  await expect(page.getByTestId("history-verdict-dek")).not.toContainText("$");
  await expect(chip(page, "Hours")).toContainText("1 recorded · 1 withheld · 0 absent");

  // The tiles refuse honestly: the dash and the gap's word, never the older figure presented as newest.
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_DM, "debt_usd");
  const newestPoint = seriesNewestPoint(axis, OBSERVATORY_SERIES_DM, "debt_usd", debt);
  if (newestPoint === null) throw new Error("fixture invariant: the DM debt series plots a point");
  expect(newestPoint.atNewestBucket).toBe(false);
  for (const key of TILES) {
    const tile = page.getByTestId(`history-kpi-${key}`);
    await expect(tile).toHaveAttribute("data-tone", "refused");
    await expect(tile).toContainText(EM_DASH);
    await expect(tile).toContainText("withheld");
    await expect(tile).not.toContainText(newestPoint.label);
  }
  await expect(page.locator("body")).not.toContainText("$0");

  // ONE STORY, two surfaces: the chart's direct label names the older row it belongs to, and it is the only direct
  // label (the drawn max IS the last plotted point).
  const chart = page.getByTestId("history-chart");
  expect(newestPoint.directLabel).toBe(`${newestPoint.label} (last captured ${axis.entries[newestPoint.index]?.bucketStart ?? "NEVER"})`);
  await expect(chart.getByTestId("obs-newest-value")).toHaveText(newestPoint.directLabel);
  await expect(chart.getByTestId("obs-ymax-label")).toHaveCount(0);
  await expect(chart.getByTestId("obs-newest-value")).toHaveCount(1);
  // The chart wears the refusal: a withheld gap tick with the warn form-mark.
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="withheld"]')).toHaveCount(1);
  await expect(chart.getByTestId("obs-gap-warn")).toHaveCount(1);
  // The sparse window states itself BEFORE the visual — computed, threshold <= 1.
  await expect(page.getByTestId("history-chart-sparse")).toHaveText(
    "1 captured bucket plots in this window · 1 withheld bucket stays a named refusal",
  );
  await expect(page.getByTestId("history-chart-finding")).toHaveText(
    "Only one hour in this window was recorded (Jul 29, 08:00 UTC), so there is no movement to state.",
  );
  // A sparse window's one dot keeps the full radius: the small dot is for a dense line only.
  await expect(chart.getByTestId("obs-point")).toHaveAttribute("r", "2.4");

  // The record opens on the newest wire bucket — the withheld one — and keeps the refusal outside any fold.
  const record = page.getByTestId("history-point");
  await expect(record).toHaveAttribute("data-kind", "withheld");
  await expect(record).toHaveAttribute("data-bucket", "2026-07-29T09:00:00Z");
  await expect(page.getByTestId("history-point-takeaway")).toContainText("withheld");
  await expect(record.getByText("null because the book was withheld and never zero").first()).toBeVisible();
  await expect(record).not.toContainText("$0");
});

test("provenance on a point: the record pins as-of, watermark, batch, key and rate as-ofs — the answer visible, the provenance counted behind a closed fold", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "debt_manager");
  const axis = buildBucketAxis(DEMO_OBSERVATORY_DM);
  const entry = axis.entries[axis.newestPointIndex]!;
  const point = newestOf(DEMO_OBSERVATORY_DM);

  const record = page.getByTestId("history-point");
  await expect(record).toHaveAttribute("data-bucket", point.bucket_start);
  await expect(record).toHaveAttribute("data-kind", "captured");
  await expect(page.getByTestId("history-point-takeaway")).toHaveText(pointDetailTakeaway(entry));
  await expect(page.getByTestId("history-point-takeaway")).toContainText(`watermark block ${formatBlock(point.last_block)}`);
  // The record's ANSWER stays visible without a click...
  await expect(record.getByText("debt (usd)")).toBeVisible();
  await expect(record.getByText("liquidatable positions")).toBeVisible();
  // The record's figures are grouped — the exact layer the headline and the finding lean on.
  await expect(record).toContainText(groupInt(point.accounts!));
  await expect(record).toContainText("$27,828,808.216758");
  await expect(record).toContainText("$153,171,572.777189");
  // ...while pure provenance is closed by default, counted in its summary.
  const forensics = page.getByTestId("history-point-forensics");
  await expect(forensics.locator("summary")).toHaveText("6 provenance rows + the rate snapshot");
  await expect(page.getByTestId("history-point-mkey")).not.toBeVisible();
  await forensics.locator("summary").click();
  await expect(page.getByTestId("history-point-mkey")).toContainText(point.materialization_key);
  await expect(page.getByTestId("history-point-batch")).toContainText(`#${String(point.batch_id)}`);
  await expect(record).toContainText(`block ${formatBlock(point.last_block)}`);
  await expect(record).toContainText("never a chain head observed later");
  await expect(record).toContainText("captured from the newest COMPLETE risk batch");
  // This fixture carries no hazard: the reorg and sweep rows live INSIDE the fold, now open.
  await expect(page.getByTestId("history-point-epochs")).toContainText("none unacked");
  const sweep = page.getByTestId("history-point-sweep");
  const stamp = point.sweep!;
  await expect(sweep).toContainText(
    `${String(stamp.rows)} swept · ${String(stamp.failed)} failed · gen ${String(stamp.generation)} (pass complete)`,
  );
  await expect(sweep).toContainText(stamp.max_updated_at ?? "NEVER");
  await expect(sweep).toContainText("aggregates THIS sweep-cut");
  // The rate snapshot carries its OWN as-of block and its scale from the closed vocabulary.
  const rates = page.getByTestId("history-point-rates");
  const rate = point.rates[0]!;
  await expect(rates).toContainText(rate.kind);
  await expect(rates).toContainText(rate.scale);
  await expect(rates).toContainText(rate.symbol ?? "NEVER");
  await expect(rates).toContainText(rate.value);
  await expect(rates).toContainText(formatBlock(rate.as_of_block));
});

test("the sweep clock renders all three states honestly — stamped, recorded none, unrecorded", async ({ page }) => {
  // (a) RECORDED NONE: the legacy market has no collateral sweep, and the record SAYS so — never an em dash.
  await mockHistory(page);
  await page.goto("/observatory");
  await page.getByTestId("history-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "aave_v3_etherfi");
  await page.getByTestId("history-point-forensics").locator("summary").click();
  const sweep = page.getByTestId("history-point-sweep");
  await expect(sweep).toContainText("none");
  await expect(sweep).toContainText("recorded: this engine has no collateral sweep");

  // (b) UNRECORDED: a pre-00018 point whose batch was pruned before the backfill — the record is ABSENT, disclosed
  // as such, and never rendered as the "no sweeper" claim or as a stamp. (The stamped arm is the provenance pin.)
  const unrecorded = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((point) => ({ ...point, sweep_recorded: false, sweep: null })),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, unrecorded));
  await page.getByTestId("history-engine-debt_manager").click();
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "debt_manager");
  await expect(sweep).toContainText(EM_DASH);
  await expect(sweep).toContainText("unrecorded: this point predates migration 00018");
  await expect(sweep).not.toContainText("no collateral sweep");
  await expect(sweep).not.toContainText("swept ·");
});

// ---------------------------------------------------------------------------
// HAZARD PLACEMENT, mutation-backed on the rendered page. Each variant
// asserts, with the fold still CLOSED: the hazard is VISIBLE, it is NOT a
// descendant of the fold, and the counted summary recounts what the fold now
// actually hides.
// ---------------------------------------------------------------------------

const newestMutated = (change: (point: ObservatorySeriesResponse["points"][number]) => ObservatorySeriesResponse["points"][number]) => ({
  ...DEMO_OBSERVATORY_DM,
  points: DEMO_OBSERVATORY_DM.points.map((point, i, all) => (i === all.length - 1 ? change(point) : point)),
});

const HAZARDS = [
  {
    name: "unacked epochs",
    body: newestMutated((p) => ({ ...p, max_epoch_at_compute: p.acked_epoch + 2 })),
    outside: ["history-point-epochs"],
    text: "2 unacked epochs",
    summary: "5 provenance rows + the rate snapshot",
  },
  {
    name: "an unrecorded sweep",
    body: newestMutated((p) => ({ ...p, sweep_recorded: false, sweep: null })),
    outside: ["history-point-sweep"],
    text: "unrecorded: this point predates migration 00018",
    summary: "5 provenance rows + the rate snapshot",
  },
  {
    name: "an unstated-scale rate table",
    body: newestMutated((p) => ({ ...p, rates: p.rates.map((rate) => ({ ...rate, scale: "unstated" as const })) })),
    outside: ["history-point-rates"],
    text: "unstated · kind outside the known vocabulary",
    summary: "6 provenance rows",
  },
  {
    name: "all three hazards at once",
    body: newestMutated((p) => ({
      ...p,
      max_epoch_at_compute: p.acked_epoch + 1,
      sweep_recorded: false,
      sweep: null,
      rates: p.rates.map((rate) => ({ ...rate, scale: "unstated" as const })),
    })),
    outside: ["history-point-epochs", "history-point-sweep", "history-point-rates"],
    text: "1 unacked epoch ·",
    summary: "4 provenance rows",
  },
] as const;

for (const hazard of HAZARDS) {
  test(`r73 — ${hazard.name} render OUTSIDE the closed fold, and the count follows`, async ({ page }) => {
    await mockShell(page);
    await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, hazard.body));
    await page.goto("/observatory");
    const forensics = page.getByTestId("history-point-forensics");
    for (const id of hazard.outside) {
      await expect(page.getByTestId(id)).toBeVisible(); // the fold is closed by default
      await expect(forensics.locator(`[data-testid="${id}"]`)).toHaveCount(0);
    }
    await expect(page.getByTestId(hazard.outside[0])).toContainText(hazard.text);
    await expect(forensics.locator("summary")).toHaveText(hazard.summary);
    // A count takes its real plural: no "(s)" anywhere in the record.
    await expect(page.getByTestId("history-point")).not.toContainText("(s)");
  });
}

// ---------------------------------------------------------------------------
// A figure that fails its wire guard is a NAMED HOLE, never the route
// boundary: the page stands, and every surface that would have printed the
// figure says "unreadable" in its own register — never zero, never an older
// figure in its place, never the absent hour's word or the withheld one's.
// ---------------------------------------------------------------------------

test("a malformed newest hour: the debt is not an exact decimal — the page stands; the headline says it cannot be read (dashed), the debt tile is a dash with the word, the chart draws the unreadable mark and keys it, the older label is qualified, the finding gives no change, the record names the cause", async ({
  page,
}) => {
  const malformed = newestMutated((p) => ({ ...p, debt_usd: "27828808.216758" }));
  await mockShell(page);
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, malformed));
  await page.goto("/observatory");
  // The route boundary did not take the page: the surface answered.
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
  const view = viewOf(malformed);
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(
    "The latest hour's debt figure cannot be read, in the hour starting Aug 8, 20:00 UTC. Unreadable is not zero.",
  );
  await expect(page.getByTestId("history-verdict-headline")).not.toContainText("$");

  // The debt tile is a dash with its word; the hour's other three figures still answer.
  const debtTile = page.getByTestId("history-kpi-debt");
  await expect(debtTile).toHaveAttribute("data-tone", "refused");
  await expect(debtTile).toContainText(EM_DASH);
  await expect(debtTile).toContainText("unreadable");
  for (const key of ["collateral", "accounts", "liquidatable"] as const) {
    await expect(page.getByTestId(`history-kpi-${key}`)).toHaveAttribute("data-tone", "neutral");
  }

  // The chart: one unreadable tick wearing its own form-mark — not an absent tick, not the withheld square.
  const axis = buildBucketAxis(malformed);
  const debt = buildMetricSeries(axis, malformed, "debt_usd");
  expect(debt.gapKinds[debt.gapKinds.length - 1]).toBe("unreadable");
  const chart = page.getByTestId("history-chart");
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="unreadable"]')).toHaveCount(1);
  await expect(chart.getByTestId("obs-gap-unreadable")).toHaveCount(1);
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="absent"]')).toHaveCount(axis.absentCount);
  await expect(chart.getByTestId("obs-gap-warn")).toHaveCount(axis.withheldCount);
  await expect(chart.locator('[data-testid="obs-gap"][data-kind="unreadable"] title')).toContainText(
    "debt (usd) is unreadable in this bucket",
  );
  // The key names the third mark, in the lib's words.
  const marks = page.getByTestId("history-marks");
  await expect(marks.locator("li")).toHaveText(view.marks.map((mark) => mark.label));
  await expect(marks.locator('[data-mark="unreadable"]')).toHaveText("figure unreadable");
  // An older figure never stands in unqualified: the chart's direct label names the hour it belongs to.
  const newestPoint = seriesNewestPoint(axis, malformed, "debt_usd", debt);
  if (newestPoint === null) throw new Error("fixture invariant: the older hours still plot");
  expect(newestPoint.atNewestBucket).toBe(false);
  await expect(chart.getByTestId("obs-newest-value")).toHaveText(newestPoint.directLabel);
  await expect(chart.getByTestId("obs-newest-value")).toContainText("(last captured ");

  // The finding gives no change for the metric it cannot read, and still states the other two.
  await expect(page.getByTestId("history-chart-finding")).toHaveText(view.finding ?? "NEVER");
  await expect(page.getByTestId("history-chart-finding")).toContainText("debt unreadable at one end, so no change is given;");
  await expect(page.getByTestId("history-chart-finding")).toContainText("accounts fell by 52, to 1,412;");

  // The record (open on the newest hour): captured, its debt a dash with the true cause, its collateral exact.
  const record = page.getByTestId("history-point");
  await expect(record).toHaveAttribute("data-kind", "captured");
  await expect(record).toContainText("unreadable: the wire's value is not an exact decimal, and it is never shown as zero");
  await expect(record).toContainText("$153,171,572.777189");
  // Nowhere on the page is the unreadable figure a zero, a NaN or the malformed string itself.
  await expect(page.locator("body")).not.toContainText("$0");
  await expect(page.locator("body")).not.toContainText("NaN");
  await expect(page.locator("body")).not.toContainText("27828808.216758");

  // The collateral chart of the same body draws no unreadable mark, and its key drops the entry.
  await page.getByTestId("history-metric-collateral_usd").click();
  await expect(chart.getByTestId("obs-gap-unreadable")).toHaveCount(0);
  await expect(marks.locator('[data-mark="unreadable"]')).toHaveCount(0);
});

test("the peak's label sits over the peak where it has room: centred on the peak's own x, named, and above the line", async ({
  page,
}) => {
  // The demo series with its peak moved mid-window (hour 80 of 166 points), far from the newest figure's label.
  const peaked = {
    ...DEMO_OBSERVATORY_DM,
    points: DEMO_OBSERVATORY_DM.points.map((p, i) => (i === 80 ? { ...p, debt_usd: "31000000000000" } : p)),
  };
  await mockShell(page);
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, peaked));
  await page.goto("/observatory");
  const chart = page.getByTestId("history-chart");
  const axis = buildBucketAxis(peaked);
  const maxPoint = seriesMaxPoint(axis, peaked, "debt_usd", buildMetricSeries(axis, peaked, "debt_usd"));
  if (maxPoint === null) throw new Error("fixture invariant: the debt series plots a peak");
  const label = chart.getByTestId("obs-ymax-label");
  await expect(label).toHaveText("peak $31,000,000");
  await expect(label).toHaveText(maxPoint.directLabel);
  await expect(label).toHaveAttribute("data-place", "peak");
  await expect(label).toHaveAttribute("text-anchor", "middle");
  const peak = chart.locator(`[data-testid="obs-point"][data-index="${String(maxPoint.index)}"]`);
  const placed = {
    labelX: Number(await label.getAttribute("x")),
    labelY: Number(await label.getAttribute("y")),
    peakX: Number(await peak.getAttribute("cx")),
    peakY: Number(await peak.getAttribute("cy")),
  };
  expect(placed.labelX).toBeCloseTo(placed.peakX, 3);
  expect(placed.labelY).toBeLessThan(placed.peakY);
});

test("a state clause is never set in the caption ink: the withheld record's refusal code and its never-zero clauses take the secondary ink; a provenance caption keeps the dim one", async ({
  page,
}) => {
  await mockHistory(page, CONTRACT);
  await page.goto("/observatory");
  const record = page.getByTestId("history-point");
  await expect(record).toHaveAttribute("data-kind", "withheld");
  const state = record.locator('[data-note="state"]');
  await expect(state.first()).toContainText("FLAG_CUSTODY_UNPROVEN · the engine's whole book was withheld at capture time");
  await expect(state).toHaveCount(3); // the state row's clause + the two null money totals
  // The inks, computed against the live tokens: a probe wearing each token's colour.
  const inks = await record.evaluate((section) => {
    const probe = (token: string): string => {
      const el = document.createElement("span");
      el.style.color = `var(${token})`;
      section.appendChild(el);
      const colour = getComputedStyle(el).color;
      el.remove();
      return colour;
    };
    const colourOf = (selector: string): string[] =>
      Array.from(section.querySelectorAll(selector)).map((el) => getComputedStyle(el).color);
    return { ink2: probe("--ink-2"), ink3: probe("--ink-3"), states: colourOf('[data-note="state"]'), captions: colourOf('[data-note="caption"]') };
  });
  expect(inks.ink2).not.toBe(inks.ink3);
  for (const colour of inks.states) expect(colour).toBe(inks.ink2);
  await page.getByTestId("history-point-forensics").locator("summary").click();
  const captions = await record.evaluate((section) =>
    Array.from(section.querySelectorAll('[data-note="caption"]')).map((el) => getComputedStyle(el).color),
  );
  expect(captions.length).toBeGreaterThan(0);
  for (const colour of captions) expect(colour).toBe(inks.ink3);
});

test("a window with no hole carries no key — a key explains marks that are on the chart; the record card is named by its own heading, hour included", async ({
  page,
}) => {
  const whole = { ...DEMO_OBSERVATORY_DM, points: DEMO_OBSERVATORY_DM.points.slice(-24) };
  expect(viewOf(whole).marks).toEqual([]);
  await mockShell(page);
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, whole));
  await page.goto("/observatory");
  await expect(page.getByTestId("history-chart")).toBeVisible();
  await expect(page.getByTestId("history-chart").locator('[data-testid="obs-gap"]')).toHaveCount(0);
  await expect(page.getByTestId("history-marks")).toHaveCount(0);
  await expect(chip(page, "Hours")).toContainText("24 recorded · 0 withheld · 0 absent");
  // The record's accessible name IS its visible heading — the title and the hour, one node, one case.
  const newest = newestOf(whole);
  const record = page.getByRole("region", { name: `Bucket record ${newest.bucket_start}` });
  await expect(record).toHaveAttribute("data-testid", "history-point");
  await expect(record.getByRole("heading", { level: 3 })).toHaveText(`Bucket record ${newest.bucket_start}`);
});

test("a phone's width (390): the page never scrolls sideways — the chips fit or wrap, the plot and the rate table scroll inside their own frames", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockHistory(page);
  await page.goto("/observatory");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("history-point")).toBeVisible();
  const overflow = () =>
    page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  const closed = await overflow();
  expect(closed.scroll).toBeLessThanOrEqual(closed.client);
  // Every identity chip ends inside the viewport.
  const chipEdges = await page
    .getByTestId("history-verdict")
    .locator("[data-chip]")
    .evaluateAll((chips) => chips.map((el) => Math.ceil(el.getBoundingClientRect().right)));
  for (const right of chipEdges) expect(right).toBeLessThanOrEqual(390);
  // With the provenance fold open the rate table is wider than the screen — inside its own scroll container.
  await page.getByTestId("history-point-forensics").locator("summary").click();
  await expect(page.getByTestId("history-point-rates")).toBeVisible();
  const open = await overflow();
  expect(open.scroll).toBeLessThanOrEqual(open.client);
  // The legacy engine's view and the contract's withheld example hold the same law.
  await page.getByTestId("history-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-engine", "aave_v3_etherfi");
  await expect(page.getByTestId("history-point")).toBeVisible();
  const legacy = await overflow();
  expect(legacy.scroll).toBeLessThanOrEqual(legacy.client);
});

test("a phone's width (390), the honest states: a failed fetch whose message carries a URL longer than the screen, and the degraded rollup, never scroll the page sideways either", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockShell(page);
  let degraded = false;
  await page.route("**/v1/observatory/series*", (route) =>
    degraded ? fulfillJson(route, OBSERVATORY_DEGRADED, 503) : fulfillJson(route, FEED_ERROR_INTERNAL, 500),
  );
  await page.goto("/observatory");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "unavailable");
  // The failure's own message names the request's URL — one unbreakable token wider than the viewport.
  await expect(page.getByTestId("history-verdict-dek")).toContainText("/v1/observatory/series");
  const overflow = () =>
    page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  const failed = await overflow();
  expect(failed.scroll).toBeLessThanOrEqual(failed.client);

  degraded = true;
  await page.getByTestId("history-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "degraded");
  const rollup = await overflow();
  expect(rollup.scroll).toBeLessThanOrEqual(rollup.client);
});

test("loading: the refused tone, the pending tiles, no chart — the state named while the series is in flight, and nothing counted before it answers", async ({
  page,
}) => {
  await mockShell(page);
  await page.route("**/v1/observatory/series*", stall);
  await page.goto("/observatory");
  const surface = page.getByTestId("history-surface");
  await expect(surface).toHaveAttribute("data-state", "loading");
  await expect(surface).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText("Loading the history of Cash…");
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(HISTORY_LOADING_DEK);
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(
    "The hourly record of this engine's debt, collateral, accounts and liquidatable positions.",
  );
  await expect(page.getByTestId("history-verdict")).not.toContainText(/\d/);
  await expect(page.locator('[data-testid^="history-kpi-"]')).toHaveCount(4);
  await expect(page.getByTestId("history-kpi-debt")).toHaveAttribute("aria-busy", "true");
  await expect(chip(page, "Hours")).toContainText("pending");
  await expect(page.getByTestId("history-chart")).toHaveCount(0);
});

test("a failed fetch is the unavailable state: refused, the message and the never-shown-as-empty clause in the dek, no tiles, no chart", async ({
  page,
}) => {
  await mockShell(page);
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, FEED_ERROR_INTERNAL, 500));
  await page.goto("/observatory");
  await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText("The history of Cash could not be fetched.");
  await expect(page.getByTestId("history-verdict-dek")).toContainText(HISTORY_UNAVAILABLE_CLAUSE);
  await expect(chip(page, "Record")).toContainText("unavailable");
  await expect(page.locator('[data-testid^="history-kpi-"]')).toHaveCount(0);
  await expect(page.getByTestId("history-chart")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$0");
});

test("answer before evidence: header above the engine switcher above the tiles above the chart above the bucket record", async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto("/observatory");
  await expect(page.getByTestId("history-point")).toBeVisible();
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("history-verdict")).toBeLessThan(await y("history-engine-debt_manager"));
  expect(await y("history-engine-debt_manager")).toBeLessThan(await y("history-kpi-debt"));
  // Cash leads the switch: it sits left of the legacy market on the same row.
  const x = async (id: string) => (await page.getByTestId(id).boundingBox())?.x ?? Number.NaN;
  expect(await x("history-engine-debt_manager")).toBeLessThan(await x("history-engine-aave_v3_etherfi"));
  expect(await y("history-kpi-debt")).toBeLessThan(await y("history-chart"));
  expect(await y("history-chart")).toBeLessThan(await y("history-point"));
});

test("money served as a JSON NUMBER is judged as money: an integer that would plot a million times too high, and a fraction that would reach the count's guard, are each the unreadable hole — never plotted, never the peak, never labelled as a count, never the route boundary; the census counts the hole and the drawer teaches its mark", async ({
  page,
}) => {
  // The contract's money is an exact decimal string. These are the same digits, served as JSON numbers.
  for (const bad of [27828808216758, 27828808.216758]) {
    const malformed = newestMutated((p) => ({ ...p, debt_usd: bad as unknown as string }));
    await mockShell(page);
    await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, malformed));
    await page.goto("/observatory");
    await expect(page.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
    const view = viewOf(malformed);
    await expect(page.getByTestId("history-verdict-headline")).toHaveText(
      "The latest hour's debt figure cannot be read, in the hour starting Aug 8, 20:00 UTC. Unreadable is not zero.",
    );
    const debtTile = page.getByTestId("history-kpi-debt");
    await expect(debtTile).toHaveAttribute("data-tone", "refused");
    await expect(debtTile).toContainText("unreadable");

    // The chart's geometry: the hour is a hole with the unreadable mark, and the y-max is a readable hour's — money, named.
    const axis = buildBucketAxis(malformed);
    const debt = buildMetricSeries(axis, malformed, "debt_usd");
    expect(debt.values[debt.values.length - 1]).toBeNull();
    expect(debt.gapKinds[debt.gapKinds.length - 1]).toBe("unreadable");
    const chart = page.getByTestId("history-chart");
    await expect(chart.locator('[data-testid="obs-gap"][data-kind="unreadable"]')).toHaveCount(1);
    await expect(chart.getByTestId("obs-gap-unreadable")).toHaveCount(1);
    await expect(chart.getByTestId("obs-ymax-label")).toHaveText("peak $27,942,906.330446");
    await expect(chart.getByTestId("obs-newest-value")).toContainText("(last captured ");
    await expect(chart.getByTestId("obs-newest-value")).toContainText("$");
    // Never the number itself in any register: not grouped as a count, not as money, not raw.
    for (const leaked of ["27,828,808,216,758", "27828808216758", "27828808.216758", "NaN"]) {
      await expect(page.locator("body")).not.toContainText(leaked);
    }

    // The census counts the hole inside the recorded hours, and does not wear the ok register over it.
    await expect(chip(page, "Hours")).toContainText("165 recorded (1 with an unreadable figure) · 1 withheld · 2 absent");
    expect(view.chips.find((c) => c.label === "Hours")?.tone).toBe("warn");

    // The drawer teaches the mark the key shows.
    await page.getByTestId("history-drawer").click();
    await expect(page.getByTestId("history-drawer-body")).toContainText(
      "unreadable figure · the bucket was recorded, but this figure is not the exact decimal the contract allows, so it is a hole and never 0",
    );
    await page.keyboard.press("Escape");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("a series answers for the engine that was ASKED: Cash is asked and the legacy market's body comes back — refused by name, nothing of it drawn under Cash's name; switching to the legacy market shows that body under its own", async ({
  page,
}) => {
  await mockShell(page);
  // The service answers EVERY ask with the legacy market's series, whole and well-formed.
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, DEMO_OBSERVATORY_AAVE));
  await page.goto("/observatory");
  const surface = page.getByTestId("history-surface");
  await expect(surface).toHaveAttribute("data-engine", "debt_manager");
  await expect(surface).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByTestId("history-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText("The history of Cash cannot be shown.");
  await expect(page.getByTestId("history-verdict-dek")).toHaveText(
    `The service answered with the series of the legacy Aave v3 market (aave_v3_etherfi) where Cash (debt_manager) was asked for. ${HISTORY_FOREIGN_CLAUSE} ${HISTORY_UNAVAILABLE_CLAUSE}`,
  );
  await expect(chip(page, "Engine")).toContainText("Cash");
  await expect(chip(page, "Record")).toContainText("wrong engine");
  // None of the legacy market's figures stand under Cash's name: no tile, no chart, no record, no money at all.
  await expect(page.locator('[data-testid^="history-kpi-"]')).toHaveCount(0);
  await expect(page.getByTestId("history-chart")).toHaveCount(0);
  await expect(page.getByTestId("history-point")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("$");

  // The same body under the engine it IS for answers in full.
  await page.getByTestId("history-engine-aave_v3_etherfi").click();
  await expect(surface).toHaveAttribute("data-engine", "aave_v3_etherfi");
  await expect(surface).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("history-verdict-headline")).toHaveText(headlineOf(DEMO_OBSERVATORY_AAVE).h1);
  // And back: the legacy series that was just on screen is not left standing under Cash.
  await page.getByTestId("history-engine-debt_manager").click();
  await expect(surface).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByTestId("history-chart")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("$");
});
