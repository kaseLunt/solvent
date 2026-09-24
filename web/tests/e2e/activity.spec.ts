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
// kicker, the dek's computed facts and the chips that never restate a control
// (Newest in reader words with the wire's ISO as its title, the order key
// always, the loaded count, a Filter chip only while a filter narrows the
// list); before the first page answers nothing is counted; the two tiles;
// every loaded row in wire order with the untimed tail dim and its block
// number where the time would be, the When column headed "When (UTC)" with the
// wire's ISO as every cell's title; a liquidation or bad-debt realization a key
// record set apart by weight, never a crit pill; the amount alone in its
// column — right-aligned only within one engine, set left across engines —
// with its unit in the column beside it; the ledger view
// pinning the type; since-block impossible with no single engine (short form,
// the sentence in its title), real with one, removed with a notice when the
// engine changes, and no cursor ever crossing a mode; a 400 refusal in the
// refused register with the service's own words disclosed ONCE in its card, an
// honest restart and no "Load more" — with rows loaded and with none; a failed
// fetch in its own register, never a refusal; a liquidation's extract with its
// marked bonus dashes explained once under the table, dimming with its row in
// the untimed tail; load more appending and the chips counting; the empty
// filter as a real, scoped answer with the way to clear it; amount units named
// or raw (grouped, never scaled), never a dollar — a Cash figure placed by the
// book's own value_decimals, raw and tagged in its own cell when no source
// licenses a scale (/v1/book is routed explicitly wherever an amount is
// asserted); the types said in words; the live strip as its own instrument,
// one plain line naming no roadmap; a broken ordering as a standing alert; the
// doctrine and the service's notes in the drawer; answer before evidence.
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ACTIVITY_AMOUNT_HEADER,
  ACTIVITY_CLEAR_FILTER_DEK,
  ACTIVITY_EXHAUSTED_DEK,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_LIVE_LABEL,
  ACTIVITY_LIVE_LAW,
  ACTIVITY_LIVE_NOTE,
  ACTIVITY_LOADING_DEK,
  ACTIVITY_SINCE_FULL,
  ACTIVITY_SINCE_NOTE,
  ACTIVITY_SINCE_SHORT,
  ACTIVITY_TAIL_NOTE,
  ACTIVITY_TAIL_NOTICE,
  ACTIVITY_TAIL_NOTICE_UNORDERED,
  ACTIVITY_WHEN_HEADER,
  END_OF_FEED,
  FILTER_LABEL,
  LIQUIDATION_NOTES_HEADING,
  SERVICE_SAID,
  UNTIMED_WHEN,
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

test("cold load: the demo page — 50 rows in wire order, the headline IS feedTakeaway's sentence and the H1 in ink, the scope in the kicker, the dek's computed facts, the chips (Newest in reader words over its ISO title, the order key, the count), two tiles, every When cell's title the wire's ISO, the amount column with its unit beside it, state ok", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");

  const surface = page.getByTestId("activity-surface");
  await expect(rows(page)).toHaveCount(50);
  await expect(surface).toHaveAttribute("data-state", "ok");
  await expect(surface).toHaveAttribute("data-mode", "cross-engine");

  const sentence = takeawayText(DEMO_FEED_PAGE_1.events, "cross-engine", true, asServed(DEMO_FEED_PAGE_1.served_at));
  // The finding, not pagination: the newest instant and "more available" are the chips' below it.
  expect(sentence).toBe("3 liquidations and 1 bad-debt realization among the 50 chain actions loaded.");
  await expect(headline(page)).toHaveText(sentence);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(sentence);
  // The finding's core is the emphasis; a record is ink — the neutral tone, never the health green.
  await expect(headline(page).locator("b")).toHaveText("3 liquidations and 1 bad-debt realization among the 50 chain actions loaded.");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "neutral");
  await expect(page.getByTestId("activity-verdict")).toContainText("Activity · All engines");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(
    "21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.",
  );

  // The chips never restate a control: the scope is the kicker's, the view the toggle's; the order key always stays.
  await expect(page.getByTestId("activity-verdict").locator("[data-chip]")).toHaveCount(3);
  for (const gone of ["Scope", "View", "Filter applied", FILTER_LABEL, "Rows"]) await expect(chip(page, gone)).toHaveCount(0);
  await expect(chip(page, "Order")).toContainText("by block time");
  // The spoken instant in reader words; its exact layer, the wire's own string, is the title.
  await expect(chip(page, "Newest")).toContainText(nb("Aug 8, 20:21 UTC"));
  await expect(chip(page, "Newest")).toHaveAttribute("title", "2026-08-08T20:21:05Z");
  await expect(chip(page, "Loaded")).toContainText("50 · more available");

  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("among the 50 loaded");
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("Bad debt realized");
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("1");
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("among the 50 loaded");

  // The row's id is its own chain coordinates; the head row carries its custodied time and opens the Inspector.
  const first = DEMO_FEED_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  const head = page.getByTestId(`activity-row-10·${first.tx_hash}·38·0`);
  await expect(head).toBeVisible();
  // The When cell is the exact instant typeset: every wire field, the T a no-break space, no zone word — the header
  // names the zone once, and the cell's title is the wire's own ISO.
  expect(first.block_time).toBe("2026-08-08T20:21:05Z");
  await expect(head.locator("td").first()).toHaveText(nb("2026-08-08 20:21:05"));
  await expect(head.getByTestId("activity-when")).toHaveAttribute("title", "2026-08-08T20:21:05Z");
  // Every When cell carries a title: the ISO, or what the block number standing in means.
  const titles = await page.getByTestId("activity-when").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("title")));
  expect(titles).toHaveLength(50);
  expect(titles.every((title) => title !== null && title !== "")).toBe(true);
  expect(titles.slice(48)).toEqual([UNTIMED_WHEN, UNTIMED_WHEN]);
  // The When cell is a record's instant in plain tabular sans, never the address mono.
  await expect(head.getByTestId("activity-when")).not.toHaveClass(/addr/);
  // The account link opens the Inspector; the tx link is the chain's explorer — two 0x… links, each its own id.
  await expect(head.getByTestId("activity-account")).toHaveAttribute("href", `/inspector/${first.account}`);
  await expect(head.getByTestId("activity-tx")).toHaveAttribute("href", `https://optimistic.etherscan.io/tx/${first.tx_hash}`);
  await expect(rows(page).first()).toHaveAttribute("data-testid", `activity-row-10·${first.tx_hash}·38·0`);

  // The amount stands alone in its cell — a Cash figure placed by the book's own value_decimals (the stream is muted,
  // so the book is the one scale source), carrying no raw word — set left across engines, so no Cash figure shares a
  // digit axis with a legacy one; its unit sits in the quiet column beside it, not upper-cased.
  const headCells = page.getByTestId("activity-table").locator("thead th");
  await expect(headCells).toHaveText([ACTIVITY_WHEN_HEADER, "Engine", "Type", "Account", ACTIVITY_AMOUNT_HEADER, "Unit", "Tx"]);
  expect(ACTIVITY_WHEN_HEADER).toBe("When (UTC)");
  expect(first.amount).toBe("252733333");
  await expect(head.locator("td").nth(4)).toHaveText("252.733333");
  await expect(head.locator("td").nth(4)).toHaveCSS("text-align", "left");
  await expect(head.locator("td").nth(4).getByTestId("activity-unit")).toHaveCount(0);
  await expect(head.getByTestId("activity-amount-tag")).toHaveCount(0);
  await expect(head.locator("td").nth(5).getByTestId("activity-unit")).toHaveText("normalized debt · USDC");
  await expect(head.getByTestId("activity-unit")).toHaveCSS("text-transform", "none");
  // The legacy market's scaled rows stay raw: the book's 8 is its base currency, not a token's decimals. One column
  // holds scaled Cash figures and raw legacy integers, so the raw word sits IN the Amount cell, beside the digits, in
  // the quiet register — and the unit cell does not say it twice.
  const legacy = DEMO_FEED_PAGE_1.events.findIndex((event) => event.engine === "aave_v3_etherfi" && event.amount !== null);
  // The wire's digits grouped for reading, never scaled: 180771428 is the wire's own integer.
  expect(DEMO_FEED_PAGE_1.events[legacy]?.amount).toBe("180771428");
  const legacyAmount = "180,771,428";
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
  await expect(head().locator("td").nth(4)).toHaveText(`252,733,333 ${RAW_UNITS_TAG}`);
  await expect(head().getByTestId("activity-amount-tag")).toHaveText(RAW_UNITS_TAG);
  await expect(head().getByTestId("activity-unit")).toHaveText("normalized debt · USDC");

  // A failed read: the same raw arm, and the page's own state is untouched by it.
  await page.unroute("**/v1/book*");
  await routeBook(page, { error: "unavailable", message: "no complete risk batch is available" }, 503);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(head().locator("td").nth(4)).toHaveText(`252,733,333 ${RAW_UNITS_TAG}`);
  await expect(head().getByTestId("activity-unit")).toHaveText("normalized debt · USDC");
  await expect(page.getByTestId("activity-error")).toHaveCount(0);
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
});

/** The demo page's own Cash rows as the engine-scoped page: the engine echoed, the cursor spent. */
const CASH_PAGE: typeof DEMO_FEED_PAGE_1 = {
  ...DEMO_FEED_PAGE_1,
  events: DEMO_FEED_PAGE_1.events.filter((event) => event.engine === "debt_manager"),
  filter: { ...DEMO_FEED_PAGE_1.filter, engine: "debt_manager" },
  next_cursor: null,
};

test("one digit axis only within one engine: across engines the Amount column is set left, header and every cell, so Cash and legacy figures never share an axis; scoped to Cash it is right-aligned", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
  await mockEvents(page, (params, route) => (params.get("engine") === "debt_manager" ? fulfillJson(route, CASH_PAGE) : demoWalk(params, route)));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  const table = page.getByTestId("activity-table");
  const amountHeader = table.locator("thead th").nth(4);
  await expect(amountHeader).toHaveText(ACTIVITY_AMOUNT_HEADER);
  const aligns = () => rows(page).evaluateAll((trs) => trs.map((tr) => (tr.children[4] === undefined ? "" : getComputedStyle(tr.children[4]).textAlign)));
  await expect(amountHeader).toHaveCSS("text-align", "left");
  const across = await aligns();
  expect(across).toHaveLength(50);
  expect(new Set(across)).toEqual(new Set(["left"]));

  await page.getByTestId("activity-engine-debt_manager").click();
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-mode", "engine-scoped");
  await expect(rows(page)).toHaveCount(CASH_PAGE.events.length);
  await expect(amountHeader).toHaveCSS("text-align", "right");
  const scoped = await aligns();
  expect(scoped).toHaveLength(CASH_PAGE.events.length);
  expect(new Set(scoped)).toEqual(new Set(["right"]));
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

test("types print in sentence case: the type buttons and the Type cells say them in words with the wire's word as the title, the headline in lower case inside its sentence, and pressing one still asks the service in its own word; a key record is set apart by weight, never a crit pill", async ({ page }) => {
  await muteStream(page);
  await routeBook(page, DEMO_BOOK);
  const requests: URLSearchParams[] = [];
  await mockEvents(page, typedWalk, requests);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  for (const [wire, word] of [
    ["collateral_enabled", "Collateral enabled"],
    ["collateral_disabled", "Collateral disabled"],
    ["deficit_created", "Bad debt realized"],
    ["borrow", "Borrow"],
  ] as const) {
    await expect(page.getByTestId(`activity-type-${wire}`)).toHaveText(word);
    await expect(page.getByTestId(`activity-type-${wire}`)).toHaveAttribute("title", wire);
  }
  await expect(page.getByTestId("activity-types")).not.toContainText("_");
  // The write-off is a key record: ink set apart by weight, its wire word the title — never a verdict's crit pill.
  const deficit = DEMO_FEED_PAGE_1.events.findIndex((event) => event.type === "deficit_created");
  const key = rows(page).nth(deficit).locator('[data-tone="key"]');
  await expect(key).toHaveText("Bad debt realized");
  await expect(key).toHaveAttribute("title", "deficit_created");
  await expect(page.getByTestId("activity-table").locator('[data-tone="crit"]')).toHaveCount(0);
  const weight = (locator: typeof key) => locator.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  const enabled = DEMO_FEED_PAGE_1.events.findIndex((event) => event.type === "collateral_enabled");
  expect(await weight(key)).toBeGreaterThan(await weight(rows(page).nth(enabled).getByTestId("activity-type")));
  // Ink, the table's own: a record is never a verdict's colour.
  const ink = (locator: typeof key) => locator.evaluate((el) => getComputedStyle(el).color);
  expect(await ink(key)).toBe(await ink(rows(page).nth(enabled).getByTestId("activity-type")));
  await expect(rows(page).nth(enabled).locator("td").nth(2)).toHaveText("Collateral enabled");
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
  // A filter narrows the list now: its chip names it, in the sentence's lower-case words.
  await expect(chip(page, FILTER_LABEL)).toContainText("bad debt realized");

  await page.getByTestId("activity-type-collateral_enabled").click();
  await expect(rows(page)).toHaveCount(4);
  const two = takeawayText(
    of("deficit_created", "collateral_enabled"),
    "cross-engine",
    false,
    asServed(served, { types: ["deficit_created", "collateral_enabled"] }),
  );
  expect(two).toBe("4 chain actions loaded, filtered to bad debt realized and collateral enabled.");
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
  // The list's head says the order in short form; the envelope's page size is the foot's, beside the next page.
  await expect(page.getByTestId("activity-order")).toContainText("Newest first · by block time");
  await expect(page.getByTestId("activity-page-size")).toHaveText("Loads 50 at a time");
  await expect(page.getByTestId("activity-tail")).toHaveText(ACTIVITY_TAIL_NOTICE);
});

test("the ledger view pins the type to liquidation: the request says so, three key rows each with its extract beneath it, the bonus dashes explained once under the table, the note and the tiles say so, the walk restarts cursor-less", async ({ page }) => {
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

  // The view is the toggle's word, not a chip's; the pinned type is the view's, not a filter.
  await expect(chip(page, "View")).toHaveCount(0);
  await expect(chip(page, FILTER_LABEL)).toHaveCount(0);
  await expect(chip(page, "Loaded")).toContainText("3 · end of the list");
  await expect(page.getByTestId("activity-types")).toHaveCount(0);
  await expect(page.getByTestId("activity-types-note")).toContainText("liquidations only");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  // The ledger excludes bad-debt realizations: its count is filtered out, never the chain's zero.
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("Filtered out");
  await expect(page.getByTestId("activity-kpi-deficits")).not.toContainText("0");

  const keys = page.getByTestId("activity-table").locator('[data-tone="key"]');
  await expect(keys).toHaveCount(3);
  await expect(keys).toHaveText(["Liquidation", "Liquidation", "Liquidation"]);
  // The typed extract is VISIBLE beneath every type — no click, no hover: an unestablished bonus is a marked em dash
  // read on the page, never an estimate; the configured figure is the wire's bps; the liquidator opens the Inspector.
  const extracts = page.getByTestId("activity-liquidation");
  await expect(extracts).toHaveCount(3);
  await expect(extracts.first()).toBeVisible();
  await expect(extracts.first()).toContainText("seized 0.65625 weETH");
  await expect(extracts.first()).toContainText("bonus realized —† / configured 500 bps");
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
  // The DM extracts carry no configured bonus: a marked dash, never a zero.
  await expect(extracts.nth(1)).toContainText("bonus realized —† / configured —†");
  await expect(extracts.nth(2)).toContainText("bonus realized —† / configured —†");
  await expect(extracts.nth(1)).not.toContainText("configured 0");
  // What the marked dashes mean is said ONCE, as page text under the table — each engine's own reason, not a hover —
  // and no extract repeats the wire's note.
  const footnote = page.getByTestId("activity-bonus-note");
  await expect(footnote).toBeVisible();
  await expect(footnote).toHaveText(
    "† Not established, so never estimated: on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read; Cash records its bonuses in its own 100e18 denomination, not in basis points, so neither is converted.",
  );
  await expect(page.getByTestId("activity-table").getByTestId("activity-liquidation-note")).toHaveCount(0);
  for (const i of LEDGER_PAGE.events.keys()) await expect(extracts.nth(i)).not.toHaveAttribute("title", /.+/);
  // The wire's own notes are the drawer's: each distinct note once, every word kept, its code spans set as code.
  await page.getByTestId("activity-drawer").click();
  const drawerNotes = page.getByTestId("activity-drawer-body").getByTestId("activity-liquidation-note");
  const distinct = [...new Set(LEDGER_PAGE.events.map((event) => event.liquidation?.note ?? "NEVER"))];
  await expect(drawerNotes).toHaveCount(distinct.length);
  for (const [i, note] of distinct.entries()) {
    await expect(drawerNotes.nth(i)).toHaveText(noteWords(note));
    await expect(drawerNotes.nth(i)).not.toContainText("`");
    await expect(drawerNotes.nth(i).locator("code")).toHaveText(inlineParts(note).filter((part) => part.kind === "code").map((part) => part.text));
  }
  await expect(page.getByTestId("activity-drawer-notes").getByRole("heading", { name: LIQUIDATION_NOTES_HEADING })).toBeVisible();
  await page.keyboard.press("Escape");
  const ledgerSentence = takeawayText(LEDGER_PAGE.events, "cross-engine", false, asServed(LEDGER_PAGE.served_at, { ledger: true }));
  expect(ledgerSentence).toBe(`3 liquidations loaded, the newest at ${nb("Aug 8, 20:06 UTC")}; that is every action matching this filter.`);
  await expect(headline(page)).toHaveText(ledgerSentence);
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("2 are on Cash and 1 on the legacy Aave v3 market.");
  // One pressed-toggle grammar, the kit's toggle group: the pressed option wears the ink on the chip ground and the
  // accent underline, the resting one the secondary ink.
  const look = (id: string) =>
    page.getByTestId(id).evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, shadow: style.boxShadow, background: style.backgroundColor };
    });
  const pressed = await look("activity-view-ledger");
  const resting = await look("activity-view-all");
  expect(pressed.color).not.toBe(resting.color);
  expect(pressed.shadow).not.toBe(resting.shadow);
  expect(pressed.background).not.toBe(resting.background);

  // Back to every action: the walk restarts from the demo page, the vocabulary returns.
  await page.getByTestId("activity-view-all").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-types")).toBeVisible();
});

test("all-actions view: an UNESTABLISHED extract is visible on cold load — the marked em dash never waits behind a fold or a hover, and its footnote says why", async ({ page }) => {
  await muteStream(page);
  // The committed cross page's liquidation carries realized_bonus_bps null — the exact field a closed fold once hid.
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_PAGE_1));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(2);

  const extract = page.getByTestId("activity-liquidation");
  await expect(extract).toHaveCount(1);
  await expect(extract).toBeVisible();
  await expect(extract).toContainText("realized —†");
  await expect(extract).toContainText("configured 500 bps");
  // What the dash means is said on the page, once, under the table: visible with no hover (a title is out of reach of
  // a keyboard and of a touch screen), in the legacy market's own reason.
  const footnote = page.getByTestId("activity-bonus-note");
  await expect(footnote).toBeVisible();
  await expect(footnote).toContainText("never estimated");
  await expect(footnote).toContainText("event-time prices this service does not re-read");
  await expect(footnote).not.toContainText("100e18");
  await expect(extract).not.toHaveAttribute("title", /.+/);
  await expect(extract.getByTestId("activity-liquidator")).toHaveAttribute("href", /^\/inspector\/0x/);
  // The extract sits inside its own row, beneath the key record's type.
  await expect(rows(page).first().locator('[data-tone="key"]')).toHaveText("Liquidation");
  await expect(rows(page).first().getByTestId("activity-liquidation")).toBeVisible();
});

test("a liquidation in the untimed tail dims WITH its row: the extract and its figures take the row's dim ink — a timed row's extract keeps its own", async ({ page }) => {
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
        };
      });
  const timed = await inks(0);
  const tail = await inks(1);
  // In the tail everything the extract prints is the dim cell's ink.
  expect(tail.extract).toBe(tail.cell);
  expect(tail.figure).toBe(tail.cell);
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
  await expect(chip(page, "Scope")).toHaveCount(0);
  await expect(chip(page, "Order")).toContainText("by block number");
  await expect(chip(page, "Newest")).toContainText("block 25,635,601");
  await expect(page.getByTestId("activity-order")).toContainText("Newest first · by block number");
  // The envelope's own limit echo, never an assumed page size — the foot's, beside the next page.
  await expect(page.getByTestId("activity-end")).toHaveText(END_OF_FEED);
  await expect(page.getByTestId("activity-tail")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  await expect(headline(page)).toHaveText("1 liquidation among the 2 chain actions loaded.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("Listed newest first, by block number on the legacy Aave v3 market's chain.");
  await expect(rows(page).nth(1).locator("td").first()).toHaveText("block 25,635,580");
  await expect(rows(page).nth(1)).not.toHaveClass(/dim/);
  await expect(since).toHaveAttribute("data-possible", "true");

  const input = page.getByTestId("activity-since-input");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await input.fill("25635600");
  await input.press("Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("activity-since-applied")).toHaveText("≥ 25,635,600");
  // The service's echo of the bound it applied: a filter chip while it narrows the list.
  await expect(chip(page, FILTER_LABEL)).toContainText("from block 25,635,600");

  // Back to every engine: the bound is REMOVED with a visible notice, never silently re-meant.
  await page.getByTestId("activity-engine-all").click();
  await expect(page.getByTestId("activity-notice")).toContainText(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and no single engine is selected.",
  );
  await expect(since).toHaveText(ACTIVITY_SINCE_SHORT);
  await expect(rows(page)).toHaveCount(50);
  await expect(chip(page, FILTER_LABEL)).toHaveCount(0);

  // The law of the walk: no request EVER carried a cursor across a mode switch, and no cross-engine request smuggled the bound.
  for (const params of requests) expect(params.get("cursor")).toBeNull();
  for (const params of requests.filter((candidate) => candidate.get("engine") === null)) expect(params.get("since_block")).toBeNull();
});

test("a refused cursor (400): the headline names the refusal in the refused register and counts the loaded rows as loaded, the dek says it in reader words; the refusal card discloses the envelope's own words — once — and restarts; no 'Load more' re-sends the refused cursor; served rows survive; the restart clears it", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) =>
    params.get("cursor") === null ? fulfillJson(route, DEMO_FEED_PAGE_1) : fulfillJson(route, FEED_ERROR_BAD_CURSOR, 400),
  );
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-load-more").click();
  const refusal = page.getByTestId("activity-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toHaveAttribute("data-state", "refused");
  await expect(refusal.getByRole("heading", { name: "Page refused" })).toBeVisible();
  await expect(refusal).toContainText("The rows below were served before it and still stand.");
  // The service's words move under the card's disclosure, verbatim — said once on the page, and never in the dek.
  await expect(refusal.locator("summary")).toHaveText(SERVICE_SAID);
  await expect(refusal.locator("details")).toContainText("not interchangeable");
  await expect(refusal.locator("details")).toContainText("bad_request");
  await expect(page.getByTestId("activity-verdict-dek")).not.toContainText("not interchangeable");
  await expect(refusal.getByTestId("activity-restart")).toHaveText("Start from the newest");
  await expect(page.locator("main").getByText("not interchangeable")).toHaveCount(1);
  // The refused cursor is never offered again: the foot offers nothing until the list restarts.
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveCount(0);
  await expect(page.getByTestId("activity-foot")).toHaveAttribute("data-foot", "none");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "refused");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(headline(page)).toHaveText("The next page was refused, after 50 chain actions loaded.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("The service would not return the next page of the list. Start again from the newest actions.");
  // Page-one rows are still shown and still counted — a refusal doesn't erase served truth.
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("3");
  await expect(chip(page, "Loaded")).toContainText("50 · next page refused");

  await page.getByTestId("activity-restart").click();
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("activity-load-more")).toBeVisible();
});

test("a refusal with NOTHING loaded: the service's words are disclosed once, no 'Load more' stands beside the restart, the tiles and the table's row say Refused — never a zero or a bare dash — and the restart is the way forward", async ({ page }) => {
  await muteStream(page);
  let refuse = true;
  const asked: URLSearchParams[] = [];
  await mockEvents(page, (params, route) => (refuse ? fulfillJson(route, FEED_ERROR_BAD_CURSOR, 400) : demoWalk(params, route)), asked);
  await page.goto("/feed");

  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "refused");
  await expect(rows(page)).toHaveCount(0);
  await expect(headline(page)).toHaveText("The service refused this page.");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "refused");
  // Once: the card discloses the envelope's own words; the dek, the table and the tiles name the state in reader words.
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("The service would not return this page of the list. Start again from the newest actions.");
  await expect(page.locator("main").getByText("not interchangeable")).toHaveCount(1);
  const refusal = page.getByTestId("activity-refusal");
  await expect(refusal).toContainText("No row of the list was read.");
  await expect(refusal.locator("details")).toContainText("not interchangeable");
  await expect(page.getByTestId("activity-table").locator("tbody td")).toHaveText("Refused");
  // One way forward, one button: the restart. Nothing loaded means there is no "more" to load.
  await expect(page.getByTestId("activity-restart")).toBeVisible();
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveCount(0);
  // Nothing loaded is the refused register's word, never a zero and never a bare dash.
  for (const tile of ["activity-kpi-liquidations", "activity-kpi-deficits"]) {
    await expect(page.getByTestId(tile)).toHaveAttribute("data-state", "refused");
    await expect(page.getByTestId(tile)).toContainText("Refused");
    await expect(page.getByTestId(tile)).toContainText("Nothing counted");
    await expect(page.getByTestId(tile)).not.toContainText("0");
    await expect(page.getByTestId(tile)).not.toContainText("—");
  }
  // The identity is never empty: the order key stays.
  await expect(chip(page, "Order")).toContainText("by block time");

  refuse = false;
  await page.getByTestId("activity-restart").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("activity-load-more")).toBeVisible();
  // The restart asked for page one: no cursor was ever sent.
  for (const params of asked) expect(params.get("cursor")).toBeNull();
});

test("load more appends the cursor page: the loaded chip counts and states the end, the tail grows, the headline counts the whole window", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);

  await page.getByTestId("activity-load-more").click();
  await expect(rows(page)).toHaveCount(52);
  await expect(chip(page, "Loaded")).toContainText("52 · end of the list");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("among the 52 loaded");
  await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
  await expect(page.getByTestId("activity-end")).toHaveText("End of the list.");
  await expect(page.locator('[data-testid^="activity-row-"][class*="dim"]')).toHaveCount(4);
  await expect(page.getByTestId("activity-drift")).toHaveCount(0);
  const all = takeawayText([...DEMO_FEED_PAGE_1.events, ...FEED_CROSS_PAGE_2.events], "cross-engine", false, asServed(FEED_CROSS_PAGE_2.served_at));
  expect(all).toBe("3 liquidations and 1 bad-debt realization among the 52 chain actions loaded.");
  await expect(headline(page)).toHaveText(all);
  // The stitched tail (two fixture pages) does not show the service's own tail order, so that order is left unsaid.
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("4 have no block time yet and are listed last.");
  await expect(page.getByTestId("activity-tail")).toHaveText(ACTIVITY_TAIL_NOTICE_UNORDERED);
});

test("degraded envelopes: 429 and 500 are fetch failures, never a refusal — the unavailable card with the service's words disclosed, the absent headline with the one status code, Unavailable tiles that never read zero, the order key kept; retry recovers", async ({ page }) => {
  await muteStream(page);
  let mode: "rate" | "internal" | "ok" = "rate";
  await mockEvents(page, (params, route) => {
    if (mode === "rate") return fulfillJson(route, FEED_ERROR_RATE_LIMITED, 429);
    if (mode === "internal") return fulfillJson(route, FEED_ERROR_INTERNAL, 500);
    return demoWalk(params, route);
  });
  await page.goto("/feed");

  const error = page.getByTestId("activity-error");
  // The service's words, disclosed in the card: relocated, never removed.
  await expect(error.locator("details")).toContainText("rate limit exceeded");
  await expect(error).toHaveAttribute("data-state", "unavailable");
  await expect(error).toHaveAttribute("data-frame", "solid");
  await expect(error.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await expect(page.getByTestId("activity-refusal")).toHaveCount(0);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(headline(page)).toHaveText("Recorded chain actions could not be fetched.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("The service did not return this page (HTTP 429), so no row of it is shown.");
  for (const tile of ["activity-kpi-liquidations", "activity-kpi-deficits"]) {
    await expect(page.getByTestId(tile)).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByTestId(tile)).toContainText("Unavailable");
    await expect(page.getByTestId(tile)).not.toContainText("Refused");
    await expect(page.getByTestId(tile)).not.toContainText("0");
  }
  await expect(page.getByTestId("activity-table").locator("tbody td")).toHaveText("Unavailable");
  await expect(chip(page, "Order")).toContainText("by block time");
  await expect(rows(page)).toHaveCount(0);

  mode = "internal";
  await expect(page.getByTestId("activity-retry")).toHaveText("Try again");
  await page.getByTestId("activity-retry").click();
  await expect(page.getByTestId("activity-error")).toContainText("the service failed to build the response");
  await expect(page.getByTestId("activity-verdict-dek")).toContainText("(HTTP 500)");

  mode = "ok";
  await page.getByTestId("activity-retry").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-error")).toHaveCount(0);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
});

test("an answer the page cannot read is the unreadable register, never a request that got no response: a 200 body that is not JSON — on the first page and on the next — says the service answered, in a dashed card, with Unreadable tiles and table word", async ({ page }) => {
  await muteStream(page);
  let first: "garbled" | "ok" = "garbled";
  const garbled = (route: Route) => route.fulfill({ status: 200, headers: CORS, contentType: "text/html", body: "<html>maintenance</html>" });
  await mockEvents(page, (params, route) => {
    if (params.get("cursor") !== null) return garbled(route);
    return first === "garbled" ? garbled(route) : fulfillJson(route, DEMO_FEED_PAGE_1);
  });
  await page.goto("/feed");

  const card = page.getByTestId("activity-error");
  await expect(card).toHaveAttribute("data-state", "unreadable");
  await expect(card).toHaveAttribute("data-frame", "dashed");
  await expect(card.getByRole("heading", { name: "Page unreadable" })).toBeVisible();
  await expect(card.locator("details")).toContainText("was not JSON");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(headline(page)).toHaveText("Recorded chain actions could not be read.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText("The service answered, but the page could not read the answer, so no row of the list is shown.");
  for (const tile of ["activity-kpi-liquidations", "activity-kpi-deficits"]) {
    await expect(page.getByTestId(tile)).toHaveAttribute("data-state", "unreadable");
    await expect(page.getByTestId(tile)).toContainText("Unreadable");
    await expect(page.getByTestId(tile)).not.toContainText("0");
  }
  await expect(page.getByTestId("activity-table").locator("tbody td")).toHaveText("Unreadable");
  await expect(page.locator("main")).not.toContainText(/could not get a response|could not be fetched|Unavailable/);

  // The first page answers; the next one is the unreadable answer, and the rows served before it stand.
  first = "ok";
  await page.getByTestId("activity-retry").click();
  await expect(rows(page)).toHaveCount(50);
  await page.getByTestId("activity-load-more").click();
  await expect(card).toHaveAttribute("data-state", "unreadable");
  await expect(headline(page)).toHaveText("The next page could not be read, after 50 chain actions loaded.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(
    "The service answered, but the page could not read the answer for the next page; the rows below were served before it.",
  );
  await expect(chip(page, "Loaded")).toContainText("50 · next page unreadable");
  await expect(rows(page)).toHaveCount(50);
});

test("an empty filtered feed is a real answer in ink: the exhausted state, the table's state word, a headline scoped to the filter the service echoed — never an unscoped negative — and the one way to see more", async ({ page }) => {
  await muteStream(page);
  // The committed empty page echoes the bad-debt type filter; the page asks with it pressed.
  expect(FEED_EMPTY.filter.types).toEqual(["deficit_created"]);
  await mockEvents(page, (params, route) => (params.get("types") === "deficit_created" ? fulfillJson(route, FEED_EMPTY) : demoWalk(params, route)));
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  await page.getByTestId("activity-type-deficit_created").click();

  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "exhausted");
  await expect(page.getByTestId("activity-table").locator("tbody td")).toHaveText("No rows");
  await expect(rows(page)).toHaveCount(0);
  await expect(headline(page)).toHaveText("No recorded chain action is a bad-debt realization.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_CLEAR_FILTER_DEK);
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "neutral");
  // The pressed filter stays pressed: the empty answer is for it.
  await expect(page.getByTestId("activity-type-deficit_created")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, FILTER_LABEL)).toContainText("bad debt realized");
  // A true zero: the service's answer for this filter.
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("0");
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("No rows loaded");
  // The filter admits no liquidation: that count is filtered out, never the chain's zero.
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("Filtered out");
  await expect(page.getByTestId("activity-end")).toHaveText(END_OF_FEED);

  // One way forward: clear the filter, and the walk restarts on every action.
  await page.getByTestId("activity-clear-filter").click();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-type-deficit_created")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("activity-clear-filter")).toHaveCount(0);
});

test("an empty answer with no filter says the service recorded nothing, in ink, with no filter to clear", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, { ...FEED_EMPTY, filter: { ...FEED_EMPTY.filter, types: [] } }));
  await page.goto("/feed");
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "exhausted");
  await expect(headline(page)).toHaveText("No chain action is recorded.");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_EXHAUSTED_DEK);
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("0");
  await expect(page.getByTestId("activity-clear-filter")).toHaveCount(0);
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
  // holds a dash set in the table's dim sub register, and its word stands in the unit column with what the dash means
  // as its title — as the Inspector says it.
  expect(FEED_UNITS.events[2]?.amount).toBeNull();
  const recordOnly = rows(page).nth(2).getByTestId("activity-amount");
  await expect(recordOnly).toHaveText("—");
  await expect(recordOnly).toHaveClass(/sub/);
  await expect(recordOnly).not.toHaveClass(/addr/);
  await expect(rows(page).nth(2).getByTestId("activity-unit")).toHaveText("record-only");
  await expect(rows(page).nth(2).getByTestId("activity-unit")).toHaveAttribute("title", RECORD_ONLY_TITLE);
  await expect(page.getByTestId("activity-amount").filter({ hasText: "record-only" })).toHaveCount(0);
  await expect(units).toHaveCount(4);

  // The opaque amount is the RAW integer, grouped for reading — its decimals were NOT applied.
  await expect(page.getByTestId("activity-amount").filter({ hasText: "123,456,789" })).toHaveCount(1);
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
  await expect(alert.locator("b")).toHaveText("Ordering fault");
  await expect(alert).toContainText("The service sent a timed row inside the untimed tail");
  await expect(alert).toContainText("treat this walk as suspect");
  await expect(headline(page)).toHaveText(
    "2 liquidations among the 3 chain actions loaded, no newest is claimed: the service broke its own ordering (see the alert below).",
  );
  await expect(headline(page)).not.toContainText("the newest at");
  // No newest anywhere: no chip; and the list's head claims no order the service did not keep.
  await expect(chip(page, "Newest")).toHaveCount(0);
  await expect(page.getByTestId("activity-order")).toContainText("In the order the service sent");
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
  // One plain line at the desk's width: the strip's sentence sits on a single line (the strip itself stands as tall as the
  // tiles it shares a row with), and its prose is the page's sans — the dek's family, not mono.
  await page.setViewportSize({ width: 1440, height: 900 });
  const sentence = page.getByTestId("activity-live-none");
  const lineHeight = await sentence.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await sentence.boundingBox())?.height ?? Number.NaN).toBeLessThan(lineHeight * 1.5);
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

test("before the first page answers NOTHING is counted: the headline names the load in the absent register and prints no digit, the dek says what will be here, the tiles are pending — never a zero or a refusal", async ({ page }) => {
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
  await expect(page.getByTestId("activity-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(page.getByTestId("activity-verdict-dek")).toHaveText(ACTIVITY_LOADING_DEK);
  await expect(chip(page, "Newest")).toHaveCount(0);
  // The identity is never empty: the order key stands before anything is counted.
  await expect(chip(page, "Order")).toContainText("by block time");
  // A tile still being computed wears the kit's pending register: the ellipsis under aria-busy, never a digit.
  await expect(page.getByTestId("activity-kpi-deficits")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("activity-kpi-deficits")).toContainText("…");
  await expect(page.getByTestId("activity-kpi-deficits")).not.toContainText("0");
  await expect(page.getByTestId("activity-kpi-liquidations")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("activity-kpi-liquidations")).toContainText("…");
  await expect(page.getByTestId("activity-kpi-liquidations")).not.toContainText("0");

  release();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
  await expect(headline(page)).toContainText("3 liquidations and 1 bad-debt realization among the 50 chain actions loaded.");
});

test("the doctrine lives in the drawer, verbatim — sentences only: the intro, the forensics note, the tail note, the order's full sentence, the since-block law and the live strip's law, then the service's own liquidation notes; the list's name is the list head's, not a paragraph; the intro's opening is not page copy; Escape closes it and the button regains focus", async ({ page }) => {
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
  await expect(body.locator(":scope > p")).toHaveText([
    ACTIVITY_INTRO,
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
  // The demo page's three liquidations carry two distinct notes: each is printed once.
  await expect(body.getByTestId("activity-liquidation-note")).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("activity-drawer-body")).toHaveCount(0);
  await expect(page.getByTestId("activity-drawer")).toBeFocused();
});

test("answer before evidence: header above tiles, the live strip completing the tiles' row, then the list's head above the controls (engine and since-block, then view and type) above the table above the foot", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  const box = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    if (b === null) throw new Error(`${id} has no box`);
    return b;
  };
  const y = async (id: string) => (await box(id)).y;
  expect(await y("activity-verdict")).toBeLessThan(await y("activity-kpi-liquidations"));
  // No half-empty row: the strip takes the columns the two tiles leave, top and bottom with them.
  const [liq, def, live] = [await box("activity-kpi-liquidations"), await box("activity-kpi-deficits"), await box("activity-live")];
  expect(live.y).toBeCloseTo(liq.y, 0);
  expect(live.x).toBeGreaterThan(def.x + def.width);
  expect(live.y + live.height).toBeCloseTo(liq.y + liq.height, 0);
  expect(await y("activity-live")).toBeLessThan(await y("activity-order"));
  expect(await y("activity-order")).toBeLessThan(await y("activity-engine-all"));
  // Two control rows — the engine with its since-block bound, then the view and the type — then the tail's one-line
  // notice, then the table.
  expect(await y("activity-engine-all")).toBeLessThan(await y("activity-view-all"));
  expect(await y("activity-since")).toBeLessThan(await y("activity-view-all"));
  expect(await y("activity-view-all")).toBeLessThan(await y("activity-tail"));
  expect(await y("activity-tail")).toBeLessThan(await y("activity-table"));
  expect(await y("activity-table")).toBeLessThan(await y("activity-foot"));
});

test("on a phone the live strip sits below the two tiles, across the row's full width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await muteStream(page);
  await mockEvents(page, demoWalk);
  await page.goto("/feed");
  await expect(rows(page)).toHaveCount(50);
  const box = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    if (b === null) throw new Error(`${id} has no box`);
    return b;
  };
  const [liq, def, live] = [await box("activity-kpi-liquidations"), await box("activity-kpi-deficits"), await box("activity-live")];
  expect(live.y).toBeGreaterThan(liq.y + liq.height);
  expect(live.x).toBeCloseTo(liq.x, 0);
  expect(live.x + live.width).toBeCloseTo(def.x + def.width, 0);
});
