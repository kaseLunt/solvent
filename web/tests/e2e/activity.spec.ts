// web/tests/e2e/activity.spec.ts
// The Activity page-test contract.
// MOCKED API via route interception: the primary state is the demo feed page
// (tests/fixtures/demo, 50 cross-engine rows newest first, 3 liquidations, 2
// untimed rows in the disclosed tail, a cursor behind it) with the committed
// cross page as its continuation; the other outcomes use the committed feed
// fixtures. Every sentence asserted here is lib/activity-view.ts's or
// lib/feed-view.ts's; every count is the fixture's own.
//
// What this pins: the verdict header IS feedTakeaway's two parts in ink (the
// neutral tone — a record is never the health green), with the scope in the
// kicker, the dek's computed facts and the five chips (Newest carrying the
// exact instant the headline speaks); before the first page answers nothing
// is counted; the two tiles; every loaded row in wire order with the untimed
// tail dim and its block number where the time would be; the amount alone in
// its right-aligned column with its unit in the column beside it; the ledger
// view pinning the type; since-block impossible with no single engine (short
// form, the sentence in its title), real with one, removed with a notice when
// the engine changes, and no cursor ever crossing a mode; a 400 refusal named
// under the dashed tone with the service's own words said ONCE (the dek), an
// honest restart and no "Load more" — with rows loaded and with none; a
// liquidation's extract with the wire's note as page text, dimming with its
// row in the untimed tail;
// load more appending and the tiles counting; degraded envelopes and the
// empty filter as real answers; amount units named or raw, never a dollar —
// a Cash figure placed by the book's own value_decimals, raw and tagged in its
// own cell when no source licenses a scale (/v1/book is routed explicitly
// wherever an amount is asserted); a liquidation's repaid unit named and its
// note's code spans read as code; the three raw enum
// types and the applied filter said in words;
// the live strip as its own instrument, one plain line naming no roadmap;
// a broken ordering as a standing alert; the doctrine in the drawer; answer
// before evidence.
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ACTIVITY_AMOUNT_HEADER,
  ACTIVITY_EXHAUSTED_DEK,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_LIVE_LABEL,
  ACTIVITY_LIVE_LAW,
  ACTIVITY_LIVE_NOTE,
  ACTIVITY_LOADING_DEK,
  ACTIVITY_METHOD,
  ACTIVITY_SINCE_FULL,
  ACTIVITY_SINCE_NOTE,
  ACTIVITY_SINCE_SHORT,
  ACTIVITY_TAIL_NOTE,
  ACTIVITY_TAIL_NOTICE,
  ACTIVITY_TAIL_NOTICE_UNORDERED,
  FILTER_APPLIED_LABEL,
} from "../../lib/activity-view";
import { inlineParts } from "../../lib/api-view";
import { RAW_UNITS_TAG, RECORD_ONLY_TITLE, feedTakeaway, type FeedTakeawayScope } from "../../lib/feed-view";
import { DEMO_BOOK, DEMO_FEED_PAGE_1 } from "../fixtures/demo";
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

/** A wire note as the page prints it: its code spans' markers read as formatting, every word kept. */
const noteWords = (note: string): string => inlineParts(note).map((part) => part.text).join("");

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** The SSE stream is not under test unless a test says so. */
async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

/**
 * The book the page reads once for each engine's value_decimals — routed explicitly wherever an amount is asserted,
 * so the scale on the page is the test's own and never a local API's: a body, or a status the read fails with.
 */
async function routeBook(page: Page, answer: unknown, status = 200): Promise<void> {
  await page.route("**/v1/book*", (route) => fulfillJson(route, answer, status));
}

/** DERIVED from the demo book: every engine's value_decimals removed — a book that licenses no scale. */
const BOOK_WITHOUT_SCALES: unknown = {
  ...DEMO_BOOK,
  engines: DEMO_BOOK.engines.map((engine) => {
    const rest: Record<string, unknown> = { ...engine };
    delete rest.value_decimals;
    return rest;
  }),
};

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

/** The header's one sentence as the page prints it: feedTakeaway's emphasis, a space, its rest. */
const takeawayText = (...args: Parameters<typeof feedTakeaway>): string => {
  const { emphasis, rest } = feedTakeaway(...args);
  return rest === "" ? emphasis : `${emphasis} ${rest}`;
};

/** The walk as the surface hands it to the sentence: every type, the all-actions view, the page's own served_at. */
const asServed = (servedAt: string, over: FeedTakeawayScope = {}): FeedTakeawayScope => ({ types: [], ledger: false, servedAt, ...over });

/** humanUtc joins its tokens with U+00A0; `toHaveText` folds white space, a string equality does not. */
const nb = (text: string): string => text.replaceAll(" ", "\u00a0");

const rows = (page: Page) => page.locator('[data-testid^="activity-row-"]');
const chip = (page: Page, label: string) => page.getByTestId("activity-verdict").locator(`[data-chip="${label}"]`);
const headline = (page: Page) => page.getByTestId("activity-verdict-headline");

test("cold load: the demo page — 50 rows in wire order, the headline IS feedTakeaway's sentence and the H1 in ink, the scope in the kicker, the dek's computed facts, five chips with the exact newest instant, two tiles, the amount column aligned with its unit beside it, state ok", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");

  const surface = page.getByTestId("activity-surface");
  await expect(rows(page)).toHaveCount(50);
  await expect(surface).toHaveAttribute("data-state", "ok");
  await expect(surface).toHaveAttribute("data-mode", "cross-engine");

  const sentence = takeawayText(DEMO_FEED_PAGE_1.events, "cross-engine", true, asServed(DEMO_FEED_PAGE_1.served_at));
  expect(sentence).toBe(`3 liquidations among the 50 chain actions loaded, the newest at ${nb("Aug 8, 20:21 UTC")}; more exist beyond these.`);
  await expect(headline(page)).toHaveText(sentence);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(sentence);
  // The finding's core is the emphasis; a record is ink — the neutral tone, never the health green.
  await expect(headline(page).locator("b")).toHaveText("3 liquidations among the 50 chain actions loaded,");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(page.getByTestId("activity-verdict")).toContainText("Activity · all engines");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(
    "1 of them records bad debt being realized. 21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.",
  );

  await expect(chip(page, "Scope")).toContainText("all engines");
  await expect(chip(page, "View")).toContainText("all actions");
  await expect(chip(page, "Order")).toContainText("by block time");
  // The exact layer of the spoken instant: the wire's own string, verbatim. The row count is the tile's, said once.
  await expect(chip(page, "Newest")).toContainText("2026-08-08T20:21:05Z");
  await expect(chip(page, "Rows")).toHaveCount(0);
  // The service's echo of the filter it applied, in words: no engine chosen is the Scope chip's own word beside it,
  // "any" for every other null constraint — the dash means refused here.
  await expect(chip(page, FILTER_APPLIED_LABEL)).toContainText("all engines · all types · any block · 50 per page");
  await expect(chip(page, FILTER_APPLIED_LABEL)).not.toContainText("any engine");
  await expect(chip(page, "Filter echo")).toHaveCount(0);

  await expect(page.getByTestId("activity-kpi-rows")).toContainText("50");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("more available");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("among the loaded rows");

  // The row's id is its own chain coordinates; the head row carries its custodied time and opens the Inspector.
  const first = DEMO_FEED_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  const head = page.getByTestId(`activity-row-10·${first.tx_hash}·38·0`);
  await expect(head).toBeVisible();
  // The When cell is the exact instant typeset: every wire field, the T a no-break space, no zone word.
  expect(first.block_time).toBe("2026-08-08T20:21:05Z");
  await expect(head.locator("td").first()).toHaveText(nb("2026-08-08 20:21:05"));
  // The account link opens the Inspector; the tx link is the chain's explorer — two 0x… links, each its own id.
  await expect(head.getByTestId("activity-account")).toHaveAttribute("href", `/inspector/${first.account}`);
  await expect(head.getByTestId("activity-tx")).toHaveAttribute("href", `https://optimistic.etherscan.io/tx/${first.tx_hash}`);
  await expect(rows(page).first()).toHaveAttribute("data-testid", `activity-row-10·${first.tx_hash}·38·0`);

  // The amount stands alone in its right-aligned cell — a Cash figure placed by the book's own value_decimals (the
  // stream is muted, so the book is the one scale source), carrying no raw word — and its unit sits in the quiet
  // column beside it, not upper-cased.
  const headCells = page.getByTestId("activity-table").locator("thead th");
  await expect(headCells).toHaveText(["When", "Engine", "Type", "Account", ACTIVITY_AMOUNT_HEADER, "Unit", "Tx"]);
  expect(first.amount).toBe("252733333");
  await expect(head.locator("td").nth(4)).toHaveText("252.733333");
  await expect(head.locator("td").nth(4)).toHaveCSS("text-align", "right");
  await expect(head.locator("td").nth(4).getByTestId("activity-unit")).toHaveCount(0);
  await expect(head.getByTestId("activity-amount-tag")).toHaveCount(0);
  await expect(head.locator("td").nth(5).getByTestId("activity-unit")).toHaveText("normalized debt · USDC");
  await expect(head.getByTestId("activity-unit")).toHaveCSS("text-transform", "none");
  // The legacy market's scaled rows stay raw: the book's 8 is its base currency, not a token's decimals. One column
  // holds scaled Cash figures and raw legacy integers, so the raw word sits IN the Amount cell, beside the digits, in
  // the quiet register — and the unit cell does not say it twice.
  const legacy = DEMO_FEED_PAGE_1.events.findIndex((event) => event.engine === "aave_v3_etherfi" && event.amount !== null);
  const legacyAmount = DEMO_FEED_PAGE_1.events[legacy]?.amount ?? "NEVER";
  await expect(rows(page).nth(legacy).locator("td").nth(4)).toHaveText(`${legacyAmount} ${RAW_UNITS_TAG}`);
  await expect(rows(page).nth(legacy).locator("td").nth(4).getByTestId("activity-amount")).toHaveText(legacyAmount);
  await expect(rows(page).nth(legacy).locator("td").nth(4).getByTestId("activity-amount-tag")).toHaveText(RAW_UNITS_TAG);
  await expect(rows(page).nth(legacy).getByTestId("activity-amount-tag")).not.toHaveClass(/addr/);
  await expect(rows(page).nth(legacy).getByTestId("activity-unit")).toHaveText("aave-scaled · USDC");
  await expect(page.getByTestId("activity-unit").filter({ hasText: RAW_UNITS_TAG })).toHaveCount(0);

  // No unit on this page licenses a dollar figure.
  expect((await page.getByTestId("activity-table").innerText()).includes("$")).toBe(false);
});

test("no licensed scale: a book that states no value_decimals, or a book read that fails, leaves every Cash amount the wire's integer verbatim and tagged raw — the absence of a scale, never a refusal of the page", async ({ page }) => {
  const first = DEMO_FEED_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  const head = () => page.getByTestId(`activity-row-10·${first.tx_hash}·38·0`);
  await muteStream(page);
  await routeBook(page, BOOK_WITHOUT_SCALES);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  await expect(head().locator("td").nth(4)).toHaveText(`252733333 ${RAW_UNITS_TAG}`);
  await expect(head().getByTestId("activity-amount-tag")).toHaveText(RAW_UNITS_TAG);
  await expect(head().getByTestId("activity-unit")).toHaveText("normalized debt · USDC");

  // A failed read: the same raw arm, and the page's own state is untouched by it.
  await page.unroute("**/v1/book*");
  await routeBook(page, { error: "unavailable", message: "no complete risk batch is available" }, 503);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(head().locator("td").nth(4)).toHaveText(`252733333 ${RAW_UNITS_TAG}`);
  await expect(head().getByTestId("activity-unit")).toHaveText("normalized debt · USDC");
  await expect(page.getByTestId("activity-error")).toHaveCount(0);
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
});

/** A type-filtered first page: the demo page's own rows of the requested types, the filter echoed, the cursor spent. */
const typedWalk = (params: URLSearchParams, route: Route): Promise<void> => {
  const asked = params.get("types");
  if (asked === null || params.get("cursor") !== null) return demoWalk(params, route);
  const types = asked.split(",");
  return fulfillJson(route, {
    ...DEMO_FEED_PAGE_1,
    events: DEMO_FEED_PAGE_1.events.filter((event) => types.includes(event.type)),
    filter: { ...DEMO_FEED_PAGE_1.filter, types },
    next_cursor: null,
  });
};

test("the three raw enum words print plain: the type buttons, the Type cells and the headline say them in words with the wire's word as the title, and pressing one still asks the service in its own word", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
  const requests: URLSearchParams[] = [];
  await mockEvents(page, typedWalk, requests);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  for (const [wire, word] of [
    ["collateral_enabled", "collateral enabled"],
    ["collateral_disabled", "collateral disabled"],
    ["deficit_created", "bad debt realized"],
    ["borrow", "borrow"],
  ] as const) {
    await expect(page.getByTestId(`activity-type-${wire}`)).toHaveText(word);
    await expect(page.getByTestId(`activity-type-${wire}`)).toHaveAttribute("title", wire);
  }
  await expect(page.getByTestId("activity-types")).not.toContainText("_");
  // The write-off's crit pill says what happened; its wire word rides the title.
  const deficit = DEMO_FEED_PAGE_1.events.findIndex((event) => event.type === "deficit_created");
  const pill = rows(page).nth(deficit).locator('[data-tone="crit"]');
  await expect(pill).toHaveText("bad debt realized");
  await expect(pill).toHaveAttribute("title", "deficit_created");
  const enabled = DEMO_FEED_PAGE_1.events.findIndex((event) => event.type === "collateral_enabled");
  await expect(rows(page).nth(enabled).locator("td").nth(2)).toHaveText("collateral enabled");
  await expect(rows(page).nth(enabled).locator("td").nth(2).locator("[title]")).toHaveAttribute("title", "collateral_enabled");
  await expect(page.getByTestId("activity-table").locator("tbody")).not.toContainText(/collateral_|deficit_/);

  await page.getByTestId("activity-type-deficit_created").click();
  await expect.poll(() => requests.some((params) => params.get("types") === "deficit_created")).toBe(true);

  // The headline speaks the buttons' words: a one-row answer names its type as a phrase, a type filter lists them.
  const served = DEMO_FEED_PAGE_1.served_at;
  const of = (...types: string[]) => DEMO_FEED_PAGE_1.events.filter((event) => types.includes(event.type));
  await expect(rows(page)).toHaveCount(1);
  const one = takeawayText(of("deficit_created"), "cross-engine", false, asServed(served, { types: ["deficit_created"] }));
  expect(one).toBe(`1 chain action loaded, bad debt realized, at ${nb("Aug 8, 20:06 UTC")}; that is the only action matching this filter.`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(one);
  await expect(chip(page, FILTER_APPLIED_LABEL)).toContainText("all engines · bad debt realized · any block · 50 per page");

  await page.getByTestId("activity-type-collateral_enabled").click();
  await expect(rows(page)).toHaveCount(4);
  const two = takeawayText(
    of("deficit_created", "collateral_enabled"),
    "cross-engine",
    false,
    asServed(served, { types: ["deficit_created", "collateral_enabled"] }),
  );
  expect(two).toBe(
    `4 chain actions loaded, filtered to bad debt realized and collateral enabled; the newest at ${nb("Aug 8, 20:06 UTC")}; that is every action matching this filter.`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(two);
  await expect(page.getByTestId("activity-verdict")).not.toContainText(/collateral_|deficit_/);
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
  // The list's head says the order in short form with the envelope's page size; the tail's notice stands above the table.
  await expect(page.getByTestId("activity-order")).toContainText("newest first, by block time · loads 50 at a time");
  await expect(page.getByTestId("activity-tail")).toHaveText(ACTIVITY_TAIL_NOTICE);
});

test("the ledger view pins the type to liquidation: the request says so, three rows each a crit pill with its extract behind it, the chips and the note say so, the walk restarts cursor-less", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
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
  await expect(chip(page, FILTER_APPLIED_LABEL)).toContainText("all engines · liquidation · any block · 50 per page");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("3");
  await expect(page.getByTestId("activity-types")).toHaveCount(0);
  await expect(page.getByTestId("activity-types-note")).toContainText("pinned to liquidation");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");

  const pills = page.getByTestId("activity-table").locator('[data-tone="crit"]');
  await expect(pills).toHaveCount(3);
  await expect(pills).toHaveText(["liquidation", "liquidation", "liquidation"]);
  // The typed extract is VISIBLE beneath every pill — no click, no hover: an unestablished bonus is an em dash
  // read on the page, never an estimate; the configured figure is the wire's bps; the liquidator opens the Inspector.
  const extracts = page.getByTestId("activity-liquidation");
  await expect(extracts).toHaveCount(3);
  await expect(extracts.first()).toBeVisible();
  await expect(extracts.first()).toContainText("seized 0.65625 weETH");
  await expect(extracts.first()).toContainText("bonus realized — / configured 500 bps");
  // What each repaid figure is counted in: the legacy row's own symbol, never an address prefix; the Debt Manager's
  // own USD — the demo's Cash liquidations are sub-dollar positions, printed as the fixture holds them.
  await expect(extracts.nth(0)).toContainText("debt repaid 2,500 USDC");
  await expect(extracts.nth(0)).not.toContainText("0xA0b86991");
  await expect(extracts.nth(1)).toContainText("debt repaid 0.35812 USD");
  await expect(extracts.nth(2)).toContainText("debt repaid 0.409762 USD");
  await expect(extracts.first().getByTestId("activity-liquidator")).toHaveAttribute(
    "href",
    "/inspector/0xBBbB000000000000000000000000000000000002",
  );
  // The DM extracts carry no configured bonus: a dash, never a zero.
  await expect(extracts.nth(1)).toContainText("bonus realized — / configured —");
  await expect(extracts.nth(2)).toContainText("bonus realized — / configured —");
  await expect(extracts.nth(1)).not.toContainText("configured 0");
  // The wire's note is the one sentence that says what those dashes mean: page text under each extract, not a hover.
  const notes = page.getByTestId("activity-liquidation-note");
  await expect(notes).toHaveCount(3);
  for (const [i, event] of LEDGER_PAGE.events.entries()) {
    const note = event.liquidation?.note ?? "NEVER";
    await expect(notes.nth(i)).toBeVisible();
    // Every word of the wire's note, its backticked field names set as code: no marker prints.
    await expect(notes.nth(i)).toHaveText(noteWords(note));
    await expect(notes.nth(i)).not.toContainText("`");
    await expect(notes.nth(i).locator("code")).toHaveText(inlineParts(note).filter((part) => part.kind === "code").map((part) => part.text));
    await expect(extracts.nth(i)).not.toHaveAttribute("title", /.+/);
  }
  const ledgerSentence = takeawayText(LEDGER_PAGE.events, "cross-engine", false, asServed(LEDGER_PAGE.served_at, { ledger: true }));
  expect(ledgerSentence).toBe(`3 liquidations loaded, the newest at ${nb("Aug 8, 20:06 UTC")}; that is every action matching this filter.`);
  await expect(headline(page)).toHaveText(ledgerSentence);
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("2 are on Cash and 1 on the legacy Aave v3 market.");
  // One pressed-toggle grammar, the kit's: the pressed button wears the accent, the resting one the dim ink.
  const look = (id: string) =>
    page.getByTestId(id).evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, border: style.borderTopColor, background: style.backgroundColor };
    });
  const pressed = await look("activity-view-ledger");
  const resting = await look("activity-view-all");
  expect(pressed.color).not.toBe(resting.color);
  expect(pressed.border).not.toBe(resting.border);
  expect(pressed.background).not.toBe(resting.background);

  // Back to every action: the walk restarts from the demo page, the vocabulary returns.
  await page.getByTestId("activity-view-all").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-types")).toBeVisible();
});

test("all-actions view: an UNESTABLISHED extract is visible on cold load — the em dash never waits behind a fold or a hover", async ({ page }) => {
  await muteStream(page);
  // The committed cross page's liquidation carries realized_bonus_bps null — the exact field a closed fold once hid.
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_PAGE_1));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(2);

  const extract = page.getByTestId("activity-liquidation");
  await expect(extract).toHaveCount(1);
  await expect(extract).toBeVisible();
  await expect(extract).toContainText("realized —");
  await expect(extract).toContainText("configured 500 bps");
  // What the dash means is said where the dash is: the wire's own note, visible with no hover (a title is out of
  // reach of a keyboard and of a touch screen).
  await expect(extract.getByTestId("activity-liquidation-note")).toBeVisible();
  await expect(extract).toContainText("never estimated");
  await expect(extract).toContainText(noteWords(FEED_CROSS_PAGE_1.events[0]?.liquidation?.note ?? "NEVER"));
  await expect(extract.getByTestId("activity-liquidation-note").locator("code")).toHaveText(["configured_bonus_bps", "realized_bonus_bps"]);
  await expect(extract).not.toHaveAttribute("title", /.+/);
  await expect(extract.getByTestId("activity-liquidator")).toHaveAttribute("href", /^\/inspector\/0x/);
  // The extract sits inside its own row, beneath the crit pill.
  await expect(rows(page).first().locator('[data-tone="crit"]')).toHaveText("liquidation");
  await expect(rows(page).first().getByTestId("activity-liquidation")).toBeVisible();
});

test("a liquidation in the untimed tail dims WITH its row: the extract, its figures and its note take the row's dim ink — a timed row's extract keeps its own", async ({ page }) => {
  await muteStream(page);
  const liquidation = FEED_CROSS_PAGE_1.events[0];
  if (liquidation === undefined || liquidation.liquidation === null) throw new Error("fixture invariant: the cross page opens on its liquidation");
  // The same liquidation twice: once with its block time, once without — the second is the untimed tail.
  const page1 = {
    ...FEED_CROSS_PAGE_1,
    events: [liquidation, { ...liquidation, block_time: null, log_index: liquidation.log_index + 1 }],
    next_cursor: null,
  };
  await mockEvents(page, (params, route) => fulfillJson(route, page1));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(1);
  const inks = (row: number) =>
    rows(page)
      .nth(row)
      .evaluate((tr) => {
        const colour = (el: Element | null): string => (el === null ? "missing" : getComputedStyle(el).color);
        const extract = tr.querySelector('[data-testid="activity-liquidation"]');
        return {
          cell: colour(extract?.closest("td") ?? null),
          extract: colour(extract),
          figure: colour(extract?.querySelector("b") ?? null),
          note: colour(extract?.querySelector('[data-testid="activity-liquidation-note"]') ?? null),
        };
      });
  const timed = await inks(0);
  const tail = await inks(1);
  // In the tail everything the extract prints is the dim cell's ink.
  expect(tail.extract).toBe(tail.cell);
  expect(tail.figure).toBe(tail.cell);
  expect(tail.note).toBe(tail.cell);
  // A timed row's extract is NOT the cell's ink (secondary prose, full-ink figures), so the pin above can fail.
  expect(timed.cell).not.toBe(tail.cell);
  expect(timed.figure).not.toBe(tail.figure);
  expect(timed.extract).not.toBe(tail.extract);
});

test("since-block: a stated impossibility with no single engine — short form, the sentence in its title — a real numeric control with one (Enter applies), removed with a notice when the engine changes; a cursor never crosses modes and the bound never crosses chains", async ({ page }) => {
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

  // No single engine: since-block is a property of chains, stated in short form (what would be here and how to get
  // it) with the full sentence in its title — not a disabled control and not an error.
  const since = page.getByTestId("activity-since");
  await expect(since).toHaveText(ACTIVITY_SINCE_SHORT);
  await expect(since).toHaveAttribute("title", ACTIVITY_SINCE_FULL);
  await expect(since).toHaveAttribute("data-possible", "false");
  await expect(page.getByTestId("activity-since-input")).toHaveCount(0);

  // One engine: a NEW walk ordered by height; the bound is real; a null time is a per-row fallback, not a tail.
  await page.getByTestId("activity-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("activity-engine-aave_v3_etherfi")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-mode", "engine-scoped");
  await expect(page.getByTestId("activity-verdict")).toContainText("Activity · Aave v3 market (legacy)");
  await expect(chip(page, "Scope")).toContainText("Aave v3 market (legacy)");
  await expect(chip(page, "Order")).toContainText("by block number");
  await expect(chip(page, "Newest")).toContainText("block 25,635,601");
  await expect(page.getByTestId("activity-order")).toContainText("newest first, by block number on the legacy Aave v3 market's chain · loads 2 at a time"); // the envelope's own limit echo, never an assumed page size
  await expect(page.getByTestId("activity-tail")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  await expect(headline(page)).toHaveText(
    "1 liquidation among the 2 chain actions loaded, the newest at block 25,635,601; that is every action matching this filter.",
  );
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("Listed newest first, by block number on the legacy Aave v3 market's chain.");
  await expect(rows(page).nth(1).locator("td").first()).toHaveText("block 25,635,580");
  await expect(rows(page).nth(1)).not.toHaveClass(/dim/);
  await expect(since).toHaveAttribute("data-possible", "true");

  const input = page.getByTestId("activity-since-input");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await input.fill("25635600");
  await input.press("Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("activity-since-applied")).toHaveText("≥ 25635600");
  await expect(chip(page, FILTER_APPLIED_LABEL)).toContainText("Aave v3 market (legacy) · all types · from block 25,635,600 · 2 per page");

  // Back to every engine: the bound is REMOVED with a visible notice, never silently re-meant.
  await page.getByTestId("activity-engine-all").click();
  await expect(page.getByTestId("activity-notice")).toContainText(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and no single engine is selected.",
  );
  await expect(since).toHaveText(ACTIVITY_SINCE_SHORT);
  await expect(rows(page)).toHaveCount(50);

  // The law of the walk: no request EVER carried a cursor across a mode switch, and no cross-engine request smuggled the bound.
  for (const params of requests) expect(params.get("cursor")).toBeNull();
  for (const params of requests.filter((candidate) => candidate.get("engine") === null)) expect(params.get("since_block")).toBeNull();
});

test("a refused cursor (400): the headline names the refusal under the dashed tone and counts the loaded rows as loaded, the dek gives the envelope's own words — once; the strip names the refusal and restarts; no 'Load more' re-sends the refused cursor; served rows survive; restart from page one clears it", async ({ page }) => {
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
  // The service's words are the dek's, said once: the strip names the refusal and carries the restart, no more.
  await expect(refusal).not.toContainText("not interchangeable");
  await expect(refusal.getByTestId("activity-restart")).toBeVisible();
  await expect(page.locator("main").getByText("not interchangeable")).toHaveCount(1);
  // The refused cursor is never offered again: the foot offers nothing until the list restarts.
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveCount(0);
  await expect(page.getByTestId("activity-foot")).toHaveAttribute("data-foot", "none");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "refused");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toHaveText("The next page was refused, after 50 chain actions loaded.");
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("not interchangeable");
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("Restart the list below.");
  // Page-one rows are still shown and still counted — a refusal doesn't erase served truth.
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("50");

  await page.getByTestId("activity-restart").click();
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("activity-load-more")).toBeVisible();
});

test("a refusal with NOTHING loaded: the service's words are said once, no 'Load more' stands beside the restart, the tiles are dashes — and the restart is the way forward", async ({ page }) => {
  await muteStream(page);
  let refuse = true;
  const asked: URLSearchParams[] = [];
  await mockEvents(page, (params, route) => (refuse ? fulfillJson(route, FEED_ERROR_BAD_CURSOR, 400) : demoWalk(params, route)), asked);
  await page.goto("/feed");

  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "refused");
  await expect(rows(page)).toHaveCount(0);
  await expect(headline(page)).toHaveText("The service refused this page.");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  // Once: the dek carries the envelope's own words; the strip, the table and the tiles name the state, not the words again.
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("not interchangeable");
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("Restart the list below.");
  await expect(page.locator("main").getByText("not interchangeable")).toHaveCount(1);
  const refusal = page.getByTestId("activity-refusal");
  await expect(refusal).toContainText("PAGE REFUSED · bad_request");
  await expect(refusal).not.toContainText("not interchangeable");
  await expect(page.getByTestId("activity-table")).toContainText("page refused · bad_request: restart above");
  // One way forward, one button: the restart. Nothing loaded means there is no "more" to load.
  await expect(page.getByTestId("activity-restart")).toBeVisible();
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveCount(0);
  // Nothing loaded is a dash, never a zero.
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("—");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("page refused");
  await expect(page.getByTestId("activity-kpi-rows")).not.toContainText("0");

  refuse = false;
  await page.getByTestId("activity-restart").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("activity-load-more")).toBeVisible();
  // The restart asked for page one: no cursor was ever sent.
  for (const params of asked) expect(params.get("cursor")).toBeNull();
});

test("load more appends the cursor page: the rows tile counts, the tail grows, the end is stated, the headline says these are every action matching the filter", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-load-more").click();
  await expect(rows(page)).toHaveCount(52);
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("52");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveText("end of the filtered feed");
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(4);
  await expect(page.getByTestId("activity-drift")).toHaveCount(0);
  // The reference year is the newest envelope's own served_at — the continuation page's.
  const all = takeawayText([...DEMO_FEED_PAGE_1.events, ...FEED_CROSS_PAGE_2.events], "cross-engine", false, asServed(FEED_CROSS_PAGE_2.served_at));
  expect(all).toBe(`3 liquidations among the 52 chain actions loaded, the newest at ${nb("Aug 8, 20:21 UTC")}; that is every action matching this filter.`);
  await expect(headline(page)).toHaveText(all);
  // The stitched tail (two fixture pages) does not show the service's own tail order, so that order is left unsaid.
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("4 have no block time yet and are listed last.");
  await expect(page.getByTestId("activity-tail")).toHaveText(ACTIVITY_TAIL_NOTICE_UNORDERED);
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
  await expect(headline(page)).toHaveText("Recorded chain actions could not be fetched.");
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("rate limit exceeded");
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
  await expect(table).toContainText("no recorded chain action matches this filter");
  await expect(table).toContainText("a real answer");
  await expect(rows(page)).toHaveCount(0);
  await expect(headline(page)).toHaveText("No recorded chain action matches this filter.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_EXHAUSTED_DEK);
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("0");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("end of the filtered feed");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("0");
  await expect(page.getByTestId("activity-end")).toBeVisible();
});

test("amount units render honestly: named, raw where unlicensed and tagged, a record-only dash with its word in the unit column, never a fake USD", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, BOOK_WITHOUT_SCALES);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_UNITS));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(4);

  const units = page.getByTestId("activity-unit");
  await expect(units.filter({ hasText: "aave-scaled" })).toHaveCount(1);
  await expect(units.filter({ hasText: "normalized debt" })).toHaveCount(1);
  await expect(units.filter({ hasText: "opaque units" })).toHaveCount(1);
  // With the stream muted and a book that states no scale, no engine has a licensed scale: every non-null amount is raw
  // and says so in its own cell, beside the digits — the unit cell does not say it twice.
  await expect(page.getByTestId("activity-amount-tag")).toHaveCount(3);
  await expect(page.getByTestId("activity-amount-tag")).toHaveText([RAW_UNITS_TAG, RAW_UNITS_TAG, RAW_UNITS_TAG]);
  await expect(units.filter({ hasText: RAW_UNITS_TAG })).toHaveCount(0);
  await expect(rows(page).nth(2).getByTestId("activity-amount-tag")).toHaveCount(0);

  // The record-only row (unit `none`, null amount) is its own statement, not a zero — and not a value: its amount cell
  // holds a dash set in the table's dim sub register, never the mono of a figure, and its word stands in the unit
  // column with what the dash means as its title — as the Inspector says it.
  expect(FEED_UNITS.events[2]?.amount).toBeNull();
  const recordOnly = rows(page).nth(2).getByTestId("activity-amount");
  await expect(recordOnly).toHaveText("—");
  await expect(recordOnly).toHaveClass(/sub/);
  await expect(recordOnly).not.toHaveClass(/addr/);
  await expect(rows(page).nth(2).getByTestId("activity-unit")).toHaveText("record-only");
  await expect(rows(page).nth(2).getByTestId("activity-unit")).toHaveAttribute("title", RECORD_ONLY_TITLE);
  await expect(page.getByTestId("activity-amount").filter({ hasText: "record-only" })).toHaveCount(0);
  await expect(page.getByTestId("activity-amount").filter({ hasText: "123456789" })).toHaveClass(/addr/);
  await expect(units).toHaveCount(4);

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
  await expect(rows(page).locator("td:first-child")).toHaveText([nb("2026-07-29 09:57:11"), nb("2026-07-29 09:56:40"), nb("2026-07-29 09:55:02")]);
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
  await expect(alert).toContainText("Ordering fault · the service sent a timed row inside the untimed tail");
  await expect(alert).toContainText("treat this walk as suspect");
  await expect(headline(page)).toHaveText(
    "2 liquidations among the 3 chain actions loaded, no newest is claimed: the service broke its own ordering (see the alert below); that is every action matching this filter.",
  );
  await expect(headline(page)).not.toContainText("the newest at");
  // No newest anywhere: no chip; and the list's head claims no order the service did not keep.
  await expect(chip(page, "Newest")).toHaveCount(0);
  await expect(page.getByTestId("activity-order")).toContainText("in the order the service sent");
  await expect(page.getByTestId("activity-tail")).toHaveCount(0);
  await expect(rows(page).nth(1)).toHaveClass(/dim/);
  await expect(rows(page).nth(2)).not.toHaveClass(/dim/);
});

test("the live strip: no base frame → said, never pretended, on ONE plain line with the law in its label and no roadmap word; a delivered snapshot names the batch, its counts and each engine's block in reader words, mono for the figures alone", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");

  const strip = page.getByTestId("activity-live");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("role", "status");
  await expect(page.getByTestId("activity-live-none")).toHaveText("No batch has arrived on this connection yet, so nothing live is shown.");
  await expect(page.getByTestId("activity-live-batch")).toHaveCount(0);
  await expect(strip).toContainText(ACTIVITY_LIVE_LABEL);
  await expect(strip.getByText(ACTIVITY_LIVE_LABEL)).toHaveAttribute("title", ACTIVITY_LIVE_LAW);
  // No public string names the roadmap, on the strip or anywhere on the page.
  await expect(page.locator("main")).not.toContainText("P4");
  await expect(page.locator("main")).not.toContainText(/outbox/i);
  // One plain line at the desk's width: the strip is a single row tall, and its prose is the page's sans — the dek's family, not mono.
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await strip.boundingBox())?.height ?? Number.NaN).toBeLessThan(56);
  const family = (testId: string) => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await family("activity-live-none")).toBe(await family("activity-verdict-dek"));

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
  // A fulfilled SSE body ends the connection after its one frame: the snapshot stands, named as an earlier connection's — a dead stream never reads as fresh.
  await expect(batch).toHaveText(
    "Batch 1 · 4 positions, 2 not computed · received on an earlier connection · Aave v3 market (legacy) at block 25,635,618 · Cash at block 154,796,552",
  );
  await expect(batch).not.toContainText("#");
  await expect(page.getByTestId("activity-live")).toContainText(ACTIVITY_LIVE_LABEL);
  // Mono is for ids and numbers alone: the figures are set apart from the prose around them.
  await expect(batch.locator("b")).toHaveText(["1", "4", "2", "25,635,618", "154,796,552"]);
  const figureFamily = await batch.locator("b").first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(figureFamily).not.toBe(await batch.evaluate((el) => getComputedStyle(el).fontFamily));
});

test("before the first page answers NOTHING is counted: the headline names the load under the dashed tone and prints no digit, the dek says what will be here, the tiles are pending — never a zero", async ({ page }) => {
  await muteStream(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockEvents(page, async (params, route) => {
    await held;
    await demoWalk(params, route);
  });
  await page.goto("/feed");

  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "loading");
  await expect(headline(page)).toHaveText("Loading recorded chain actions…");
  await expect(headline(page)).not.toContainText(/\d/);
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_LOADING_DEK);
  await expect(chip(page, "Newest")).toHaveCount(0);
  // A tile still being computed wears the kit's pending register: the ellipsis under aria-busy, never a digit.
  await expect(page.getByTestId("activity-kpi-rows")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("activity-kpi-rows")).toContainText("…");
  await expect(page.getByTestId("activity-kpi-rows")).not.toContainText("0");
  await expect(page.getByTestId("activity-kpi-liquidations")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("…");
  await expect(page.getByTestId("activity-kpi-liquidations")).not.toContainText("0");

  release();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(headline(page)).toContainText("3 liquidations among the 50 chain actions loaded,");
});

test("the doctrine lives in the drawer, verbatim — sentences only: the intro, the method line, the forensics note, the tail note, the order's full sentence, the since-block law and the live strip's law; the list's name is the list head's, not a paragraph; the intro's opening is not page copy; Escape closes it and the button regains focus", async ({ page }) => {
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
  await expect(body.locator("p")).toHaveText([
    ACTIVITY_INTRO,
    ACTIVITY_METHOD,
    ACTIVITY_FORENSICS,
    ACTIVITY_TAIL_NOTE,
    "Ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are never compared across chains, and rows without header time follow in the disclosed untimed tail.",
    ACTIVITY_SINCE_NOTE,
    ACTIVITY_LIVE_NOTE,
  ]);
  await expect(body).toContainText("Past stream states are not stored, so they cannot be replayed here");
  await expect(body).not.toContainText("P4");
  await expect(body).not.toContainText(/outbox/i);
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
  expect(await y("activity-live")).toBeLessThan(await y("activity-order"));
  expect(await y("activity-order")).toBeLessThan(await y("activity-engine-all"));
  // Two control rows, then the tail's one-line notice, then the table.
  expect(await y("activity-engine-all")).toBeLessThan(await y("activity-since"));
  expect(await y("activity-since")).toBeLessThan(await y("activity-tail"));
  expect(await y("activity-tail")).toBeLessThan(await y("activity-table"));
  expect(await y("activity-table")).toBeLessThan(await y("activity-foot"));
});
