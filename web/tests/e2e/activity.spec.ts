// web/tests/e2e/activity.spec.ts
// The Activity page-test contract (spec 2026-09-15 §7; plan 2026-09-16 R8).
// MOCKED API via route interception: the primary state is the demo feed page
// (tests/fixtures/demo, 50 cross-engine rows newest first, 3 liquidations, 2
// untimed rows in the disclosed tail, a cursor behind it) with the committed
// cross page as its continuation; the other outcomes use the committed feed
// fixtures. Every sentence asserted here is lib/activity-view.ts's or
// lib/feed-view.ts's; every count is the fixture's own.
//
// What this pins: the verdict header IS feedTakeaway's sentence, with the
// scope in the kicker, the dek's one clause and the five chips; the two
// tiles; every loaded row in wire order with the untimed tail dim and its
// block number where the time would be; the ledger view pinning the type;
// since_block impossible cross-engine, real engine-scoped, dropped with a
// notice when the engine changes, and no cursor ever crossing a mode; a 400
// refusal in the envelope's own words with an honest restart; load more
// appending and the tiles counting; degraded envelopes and the empty filter
// as real answers; amount units named or raw, never a dollar; the live strip
// as its own instrument; ordering drift as a standing alert; the doctrine in
// the drawer; answer before evidence.
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ACTIVITY_DEK,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_METHOD,
  ACTIVITY_TAIL_NOTE,
} from "../../lib/activity-view";
import { feedTakeaway } from "../../lib/feed-view";
import { DEMO_FEED_PAGE_1 } from "../fixtures/demo";
import {
  FEED_CROSS_PAGE_1,
  FEED_CROSS_PAGE_2,
  FEED_CROSS_TIMED,
  FEED_EMPTY,
  FEED_ENGINE_AAVE_PAGE_1,
  FEED_ENGINE_AAVE_SINCE,
  FEED_ERROR_BAD_CURSOR,
  FEED_ERROR_INTERNAL,
  FEED_ERROR_RATE_LIMITED,
  FEED_POSTURE_SNAPSHOT,
  FEED_UNITS,
} from "../fixtures/feed";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** The SSE stream is not under test unless a test says so. */
async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

/** Route /v1/events by inspecting each request's params; records the params of every request. */
async function mockEvents(
  page: Page,
  handler: (params: URLSearchParams, route: Route) => Promise<void>,
  requests?: URLSearchParams[],
): Promise<void> {
  await page.route("**/v1/events*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests?.push(params);
    await handler(params, route);
  });
}

/** The demo walk: page one is the demo page, the cursor page the committed cross continuation. */
const demoWalk = (params: URLSearchParams, route: Route): Promise<void> =>
  params.get("cursor") === null ? fulfillJson(route, DEMO_FEED_PAGE_1) : fulfillJson(route, FEED_CROSS_PAGE_2);

/** The demo page's own three liquidations as the ledger's page: the filter echoed, the cursor exhausted. */
const LEDGER_PAGE: typeof DEMO_FEED_PAGE_1 = {
  ...DEMO_FEED_PAGE_1,
  events: DEMO_FEED_PAGE_1.events.filter((event) => event.type === "liquidation"),
  filter: { ...DEMO_FEED_PAGE_1.filter, types: ["liquidation"] },
  next_cursor: null,
};

const rows = (page: Page) => page.locator('[data-testid^="activity-row-"]');
const chip = (page: Page, label: string) => page.getByTestId("activity-verdict").locator(`[data-chip="${label}"]`);
const headline = (page: Page) => page.getByTestId("activity-verdict-headline");

test("cold load: the demo page — 50 rows in wire order, the headline IS feedTakeaway's sentence and the H1, the scope in the kicker, the dek's clause, five chips, two tiles, state ok", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");

  const surface = page.getByTestId("activity-surface");
  await expect(rows(page)).toHaveCount(50);
  await expect(surface).toHaveAttribute("data-state", "ok");
  await expect(surface).toHaveAttribute("data-mode", "cross-engine");

  const sentence = feedTakeaway(DEMO_FEED_PAGE_1.events, "cross-engine", true);
  expect(sentence).toBe("50 chain action(s) loaded, 3 liquidation(s) · newest custodied 2026-08-08T20:21:05Z · more exist behind the cursor.");
  await expect(headline(page)).toHaveText(sentence);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(sentence);
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "ok");
  await expect(page.getByTestId("activity-verdict")).toContainText("Activity · cross-engine");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_DEK);

  await expect(chip(page, "Scope")).toContainText("cross-engine");
  await expect(chip(page, "View")).toContainText("all actions");
  await expect(chip(page, "Order")).toContainText("cross-engine");
  await expect(chip(page, "Rows")).toContainText("50");
  await expect(chip(page, "Filter echo")).toContainText("engine — · types all · since_block — · limit 50");

  await expect(page.getByTestId("activity-kpi-rows")).toContainText("50");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("more available");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("cross-engine");

  // The row's id is its own chain coordinates; the head row carries its custodied time and opens the Inspector.
  const first = DEMO_FEED_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  const head = page.getByTestId(`activity-row-10·${first.tx_hash}·38·0`);
  await expect(head).toBeVisible();
  await expect(head.locator("td").first()).toHaveText(first.block_time ?? "");
  await expect(head.getByRole("link", { name: /^0x/ })).toHaveAttribute("href", `/inspector/${first.account}`);
  await expect(rows(page).first()).toHaveAttribute("data-testid", `activity-row-10·${first.tx_hash}·38·0`);

  // No unit on this page licenses a dollar figure.
  expect((await page.getByTestId("activity-table").innerText()).includes("$")).toBe(false);
});

test("the untimed tail: the two rows without header time are last and dim, their block numbers where the time would be; nothing above them dims; no drift is claimed", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await expect(rows(page).nth(48)).toHaveClass(/dim/);
  await expect(rows(page).nth(48).locator("td").first()).toHaveText("block 155,318,218");
  await expect(rows(page).nth(49)).toHaveClass(/dim/);
  await expect(rows(page).nth(49).locator("td").first()).toHaveText("block 25,713,780");
  await expect(rows(page).nth(47)).not.toHaveClass(/dim/);
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(2);
  await expect(page.getByTestId("activity-drift")).toHaveCount(0);
  await expect(page.getByTestId("activity-order")).toContainText("custodied header time");
});

test("the ledger view pins the type to liquidation: the request says so, three rows each a crit pill with its extract behind it, the chips and the note say so, the walk restarts cursor-less", async ({ page }) => {
  await muteStream(page);
  const requests: URLSearchParams[] = [];
  await mockEvents(
    page,
    (params, route) => (params.get("types") === "liquidation" ? fulfillJson(route, LEDGER_PAGE) : demoWalk(params, route)),
    requests,
  );
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-view-ledger").click();
  await expect(page.getByTestId("activity-view-ledger")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("activity-view-all")).toHaveAttribute("aria-pressed", "false");
  await expect(rows(page)).toHaveCount(3);
  expect(requests.some((params) => params.get("types") === "liquidation")).toBe(true);
  for (const params of requests) expect(params.get("cursor")).toBeNull();

  await expect(chip(page, "View")).toContainText("liquidations ledger");
  await expect(chip(page, "Filter echo")).toContainText("types liquidation");
  await expect(chip(page, "Rows")).toContainText("3");
  await expect(page.getByTestId("activity-types")).toHaveCount(0);
  await expect(page.getByTestId("activity-types-note")).toContainText("pinned to liquidation");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");

  const pills = page.getByTestId("activity-table").locator('[data-tone="crit"]');
  await expect(pills).toHaveCount(3);
  await expect(pills).toHaveText(["liquidation", "liquidation", "liquidation"]);
  // The typed extract, verbatim numbers: an unestablished bonus is an em dash, never an estimate.
  await expect(pills.first()).toHaveAttribute("title", /liquidator 0xBBbB/);
  await expect(pills.first()).toHaveAttribute("title", /seized 0\.65625 weETH/);
  await expect(pills.first()).toHaveAttribute("title", /bonus realized — \/ configured 500 bps/);
  await expect(headline(page)).toHaveText(feedTakeaway(LEDGER_PAGE.events, "cross-engine", false));

  // Back to every action: the walk restarts from the demo page, the vocabulary returns.
  await page.getByTestId("activity-view-all").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-types")).toBeVisible();
});

test("since_block: a stated impossibility cross-engine, a real numeric control engine-scoped (Enter applies), dropped with a notice when the engine changes; a cursor never crosses modes and the bound never crosses chains", async ({ page }) => {
  await muteStream(page);
  const requests: URLSearchParams[] = [];
  await mockEvents(
    page,
    (params, route) => {
      if (params.get("engine") === "aave_v3_etherfi") {
        return params.get("since_block") === null ? fulfillJson(route, FEED_ENGINE_AAVE_PAGE_1) : fulfillJson(route, FEED_ENGINE_AAVE_SINCE);
      }
      return demoWalk(params, route);
    },
    requests,
  );
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  // Cross-engine: since_block is a property of chains, stated, not a disabled control and not an error.
  const since = page.getByTestId("activity-since");
  await expect(since).toContainText("incomparable across chains");
  await expect(since).toHaveAttribute("data-possible", "false");
  await expect(page.getByTestId("activity-since-input")).toHaveCount(0);

  // One engine: a NEW walk ordered by height; the bound is real; a null time is a per-row fallback, not a tail.
  await page.getByTestId("activity-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("activity-engine-aave_v3_etherfi")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-mode", "engine-scoped");
  await expect(page.getByTestId("activity-verdict")).toContainText("Activity · Aave v3 market (legacy)");
  await expect(chip(page, "Scope")).toContainText("Aave v3 market (legacy)");
  await expect(chip(page, "Order")).toContainText("engine-scoped");
  await expect(page.getByTestId("activity-order")).toContainText("block height");
  await expect(rows(page)).toHaveCount(2);
  await expect(headline(page)).toHaveText("2 chain action(s) loaded, 1 liquidation(s) · newest at block 25,635,601.");
  await expect(rows(page).nth(1).locator("td").first()).toHaveText("block 25,635,580");
  await expect(rows(page).nth(1)).not.toHaveClass(/dim/);
  await expect(since).toHaveAttribute("data-possible", "true");

  const input = page.getByTestId("activity-since-input");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await input.fill("25635600");
  await input.press("Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("activity-since-applied")).toHaveText("≥ 25635600");
  await expect(chip(page, "Filter echo")).toContainText("since_block 25635600");

  // Back to cross-engine: the bound is DROPPED with a visible notice, never silently re-meant.
  await page.getByTestId("activity-engine-all").click();
  await expect(page.getByTestId("activity-notice")).toContainText("since_block 25635600 dropped");
  await expect(since).toContainText("incomparable across chains");
  await expect(rows(page)).toHaveCount(50);

  // The law of the walk: no request EVER carried a cursor across a mode switch, and no cross-engine request smuggled the bound.
  for (const params of requests) expect(params.get("cursor")).toBeNull();
  for (const params of requests.filter((candidate) => candidate.get("engine") === null)) expect(params.get("since_block")).toBeNull();
});

test("a refused cursor (400) renders the envelope's own words under the dashed tone; served rows survive; restart from page one clears it", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) =>
    params.get("cursor") === null ? fulfillJson(route, DEMO_FEED_PAGE_1) : fulfillJson(route, FEED_ERROR_BAD_CURSOR, 400),
  );
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-load-more").click();
  const refusal = page.getByTestId("activity-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("PAGE REFUSED · bad_request");
  await expect(refusal).toContainText("not interchangeable");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "refused");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toContainText("Page refused · bad_request:");
  await expect(headline(page)).toContainText("not interchangeable");
  // Page-one rows are still shown and still counted — a refusal doesn't erase served truth.
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("50");

  await page.getByTestId("activity-restart").click();
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
});

test("load more appends the cursor page: the rows tile and chip count, the tail grows, the end is stated, the headline drops its cursor clause", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-load-more").click();
  await expect(rows(page)).toHaveCount(52);
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("52");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");
  await expect(chip(page, "Rows")).toContainText("52");
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveText("end of the filtered feed");
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(4);
  await expect(page.getByTestId("activity-drift")).toHaveCount(0);
  await expect(headline(page)).toHaveText(feedTakeaway([...DEMO_FEED_PAGE_1.events, ...FEED_CROSS_PAGE_2.events], "cross-engine", false));
});

test("degraded envelopes: 429 and 500 state their reasons as the page's own refusal — the strip, the state, the dashed header, dashed tiles that never read zero; retry recovers", async ({ page }) => {
  await muteStream(page);
  let mode: "rate" | "internal" | "ok" = "rate";
  await mockEvents(page, (params, route) => {
    if (mode === "rate") return fulfillJson(route, FEED_ERROR_RATE_LIMITED, 429);
    if (mode === "internal") return fulfillJson(route, FEED_ERROR_INTERNAL, 500);
    return demoWalk(params, route);
  });
  await page.goto("/feed");

  const error = page.getByTestId("activity-error");
  await expect(error).toContainText("rate limit exceeded");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toContainText("Page fetch failed:");
  await expect(headline(page)).toContainText("rate limit exceeded");
  await expect(page.getByTestId("activity-kpi-rows")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("—");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("page fetch failed");
  await expect(page.getByTestId("activity-kpi-rows")).not.toContainText("0");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("—");
  await expect(rows(page)).toHaveCount(0);

  mode = "internal";
  await page.getByTestId("activity-retry").click();
  await expect(page.getByTestId("activity-error")).toContainText("the service failed to build the response");

  mode = "ok";
  await page.getByTestId("activity-retry").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-error")).toHaveCount(0);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
});

test("an empty filtered feed is a real answer: the exhausted state, the table's sentence, zero tiles that are true, a headline that invents nothing", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_EMPTY));
  await page.goto("/feed");

  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "exhausted");
  const table = page.getByTestId("activity-table");
  await expect(table).toContainText("no custodied chain actions match this filter");
  await expect(table).toContainText("a real answer");
  await expect(rows(page)).toHaveCount(0);
  await expect(headline(page)).toHaveText("0 chain actions loaded in this window — the list below states the reason.");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "ok");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("0");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("0");
  await expect(page.getByTestId("activity-end")).toBeVisible();
});

test("amount units render honestly: named, raw where unlicensed and tagged, the record-only word, never a fake USD", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_UNITS));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(4);

  const units = page.getByTestId("activity-unit");
  await expect(units.filter({ hasText: "aave-scaled" })).toHaveCount(1);
  await expect(units.filter({ hasText: "normalized debt" })).toHaveCount(1);
  await expect(units.filter({ hasText: "opaque units" })).toHaveCount(1);
  // With the stream muted no engine has a licensed scale: every non-null amount is raw and says so.
  await expect(units.filter({ hasText: "raw units" })).toHaveCount(3);

  // The record-only row (unit `none`, null amount) is its own statement, not a zero.
  await expect(page.getByTestId("activity-amount").filter({ hasText: "record-only" })).toHaveCount(1);

  // The opaque amount is the RAW integer — its decimals were NOT applied.
  await expect(page.getByTestId("activity-amount").filter({ hasText: "123456789" })).toHaveCount(1);
  await expect(page.getByText("123.456789")).toHaveCount(0);

  expect((await page.getByTestId("activity-table").innerText()).includes("$")).toBe(false);
});

test("cross-engine order is header time — heights are visibly NOT the order, and nothing dims", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_TIMED));
  await page.goto("/feed");

  await expect(rows(page)).toHaveCount(3);
  // Wire order = time DESC; the middle row's HEIGHT (154M, OP) dwarfs its neighbours (25.6M, ETH) — rendered as served, never re-sorted.
  await expect(rows(page).locator("td:first-child")).toHaveText(["2026-07-29T09:57:11Z", "2026-07-29T09:56:40Z", "2026-07-29T09:55:02Z"]);
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(0);
});

test("ordering drift: a timed row inside the untimed tail — the alert stands on its own, the headline withholds its newest claim, only the untimed row dims", async ({ page }) => {
  await muteStream(page);
  // The committed page with ONE documented delta: its own timed liquidation row re-served AFTER the untimed borrow
  // (log_index bumped to keep chain coordinates distinct) — the exact violation the ordering law forbids.
  const drifted = structuredClone(FEED_CROSS_PAGE_1);
  const first = drifted.events[0];
  if (first === undefined) throw new Error("fixture invariant: the timed head row expected");
  const smuggled = structuredClone(first);
  smuggled.log_index = 43;
  drifted.events.push(smuggled);
  drifted.next_cursor = null;
  await mockEvents(page, (params, route) => fulfillJson(route, drifted));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(3);

  const alert = page.getByTestId("activity-drift");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("ORDERING DRIFT");
  await expect(alert).toContainText("treat this walk as suspect");
  await expect(headline(page)).toHaveText(
    "3 chain action(s) loaded, 2 liquidation(s) · the wire violated its own ordering law (see the alert below), so no newest is claimed.",
  );
  await expect(headline(page)).not.toContainText("newest custodied");
  await expect(rows(page).nth(1)).toHaveClass(/dim/);
  await expect(rows(page).nth(2)).not.toHaveClass(/dim/);
});

test("live posture: no base frame → nothing pretended and the law printed; a delivered snapshot renders the batch's real watermark vector and stays labelled current-connection", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");

  const strip = page.getByTestId("activity-live");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("role", "status");
  await expect(page.getByTestId("activity-live-none")).toContainText("nothing is pretended");
  await expect(page.getByTestId("activity-live-batch")).toHaveCount(0);
  await expect(strip).toContainText("current connection only");
  await expect(strip).toContainText("Live posture is never history");

  await page.unroute("**/v1/stream**");
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: `event: snapshot\ndata: ${JSON.stringify(FEED_POSTURE_SNAPSHOT)}\n\n`,
    }),
  );
  await page.goto("/feed");
  const batch = page.getByTestId("activity-live-batch");
  await expect(batch).toBeVisible();
  await expect(batch).toContainText("batch #1");
  await expect(batch).toContainText("aave_v3_etherfi @25,635,618");
  await expect(batch).toContainText("debt_manager @154,796,552");
  await expect(page.getByTestId("activity-live")).toContainText("current connection only");
});

test("the doctrine lives in the drawer, verbatim: the intro, the list's name, the method line, the forensics note, the tail note; the intro's opening is not page copy; Escape closes it and the button regains focus", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await expect(page.locator("main")).not.toContainText("Chain actions as recorded");
  await expect(page.getByTestId("activity-drawer-body")).toHaveCount(0);
  // The list's own name stands over the table: two instruments, two names.
  await expect(page.getByRole("heading", { level: 2, name: ACTIVITY_LIST_TITLE })).toBeVisible();

  await page.getByTestId("activity-drawer").click();
  const body = page.getByTestId("activity-drawer-body");
  await expect(body.locator("p")).toHaveText([ACTIVITY_INTRO, ACTIVITY_LIST_TITLE, ACTIVITY_METHOD, ACTIVITY_FORENSICS, ACTIVITY_TAIL_NOTE]);
  await expect(body).toContainText(
    "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the stream's posture now; the list below pages through durable history. The two never blend.",
  );
  await expect(body).toContainText("never dressed up as a token or USD figure");
  await expect(body).toContainText("null until custodied, in which case the block number renders instead");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("activity-drawer-body")).toHaveCount(0);
  await expect(page.getByTestId("activity-drawer")).toBeFocused();
});

test("answer before evidence: header above tiles above the live strip above the list's head above the controls above the table above the foot", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("activity-verdict")).toBeLessThan(await y("activity-kpi-rows"));
  expect(await y("activity-kpi-rows")).toBeLessThan(await y("activity-live"));
  expect(await y("activity-live")).toBeLessThan(await y("activity-engine-all"));
  expect(await y("activity-engine-all")).toBeLessThan(await y("activity-order"));
  expect(await y("activity-order")).toBeLessThan(await y("activity-table"));
  expect(await y("activity-table")).toBeLessThan(await y("activity-foot"));
});
