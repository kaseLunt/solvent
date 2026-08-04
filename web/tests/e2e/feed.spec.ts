// Feed surface (W5) e2e — MOCKED API via route interception. Every body
// served here comes from tests/fixtures/feed.ts (generated from the
// contract's own examples and documented compositions — see
// generate-feed.mjs's provenance record; nothing hand-shaped).
//
// Asserted laws (task brief + AMENDMENT 1):
//   - cross-engine order is HEADER TIME, never height (heights of two
//     chains are incomparable); the untimed tail is disclosed, after all
//     timed rows, block-number fallback per row, no invented timestamps;
//   - engine-scoped order is height; a null time there is a per-row
//     fallback, NOT a tail;
//   - since_block exists only engine-scoped — cross-engine it renders as a
//     stated impossibility, and switching modes DROPS it with a notice;
//   - a cursor never crosses modes: every new walk starts cursor-less;
//   - the 400 refusal (cursor minted for the other mode) renders the
//     envelope's own words + an honest restart from page one;
//   - amount units render honestly: opaque/out-of-set raw and verbatim,
//     scaled/normalized named, record-only distinct, never a "$";
//   - liquidation rows open their typed extract; an unestablished bonus is
//     an em dash, never an estimate;
//   - live posture is CURRENT-connection SSE state, labeled as such, never
//     conflated with the durable history below it;
//   - degraded envelopes (429 / 500) and the empty page render their
//     reasons, never spinners or zeros.

import { expect, test, type Page, type Route } from "@playwright/test";
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
  FEED_LIQUIDATIONS,
  FEED_POSTURE_SNAPSHOT,
  FEED_UNITS,
} from "../fixtures/feed";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The SSE stream is not under test unless a test says so. */
async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

/** Route /v1/events by inspecting each request's params; records URLs. */
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

test("cross-engine walk: time-ordered head, DISCLOSED untimed tail across pages", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) =>
    params.get("cursor") === null
      ? fulfillJson(route, FEED_CROSS_PAGE_1)
      : fulfillJson(route, FEED_CROSS_PAGE_2),
  );
  await page.goto("/feed");

  // Page 1: one timed row, then the tail begins with the untimed DM borrow.
  await expect(page.getByTestId("feed-row")).toHaveCount(2);
  const divider = page.getByTestId("untimed-divider");
  await expect(divider).toHaveCount(1);
  await expect(divider).toContainText("1 row without custodied header time");
  await expect(divider).toContainText("instead of");
  await expect(divider).toContainText("by time");

  // The untimed row renders its BLOCK NUMBER, never an invented time.
  await expect(page.getByTestId("feed-time").nth(1)).toHaveText("block 154,796,490");

  // Page 2 continues the tail: still ONE divider, now over three rows.
  await page.getByTestId("feed-load-more").click();
  await expect(page.getByTestId("feed-row")).toHaveCount(4);
  await expect(page.getByTestId("untimed-divider")).toHaveCount(1);
  await expect(page.getByTestId("untimed-divider")).toContainText(
    "3 rows without custodied header time",
  );
  await expect(page.getByTestId("untimed-order-violation")).toHaveCount(0);
  await expect(page.getByText("end of the filtered feed")).toBeVisible();
});

test("cross-engine order is header time — heights are visibly NOT the order", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_TIMED));
  await page.goto("/feed");

  await expect(page.getByTestId("order-note")).toContainText("custodied header time");
  const times = page.getByTestId("feed-time");
  await expect(times).toHaveCount(3);
  // Wire order = time DESC; the middle row's HEIGHT (154M, OP) dwarfs its
  // neighbors (25.6M, ETH) — rendered exactly as served, never re-sorted.
  await expect(times.nth(0)).toHaveText("2026-07-29T09:57:11Z");
  await expect(times.nth(1)).toHaveText("2026-07-29T09:56:40Z");
  await expect(times.nth(2)).toHaveText("2026-07-29T09:55:02Z");
  await expect(page.getByTestId("untimed-divider")).toHaveCount(0);
});

test("engine-scoped: height order, no tail concept, since_block round-trip; a cursor never crosses modes", async ({
  page,
}) => {
  await muteStream(page);
  const requests: URLSearchParams[] = [];
  await mockEvents(
    page,
    (params, route) => {
      if (params.get("engine") === "aave_v3_etherfi") {
        return params.get("since_block") === null
          ? fulfillJson(route, FEED_ENGINE_AAVE_PAGE_1)
          : fulfillJson(route, FEED_ENGINE_AAVE_SINCE);
      }
      return fulfillJson(route, FEED_CROSS_PAGE_1);
    },
    requests,
  );
  await page.goto("/feed");
  await expect(page.getByTestId("feed-row")).toHaveCount(2);

  // Cross-engine first: since_block renders as a stated impossibility.
  await expect(page.getByTestId("since-block-impossible")).toBeVisible();
  await expect(page.getByTestId("since-block-impossible")).toContainText(
    "incomparable across chains",
  );
  await expect(page.getByTestId("since-block-control")).toHaveCount(0);

  // Switch engine: a NEW walk, ordered by height, since_block now real.
  await page.getByRole("button", { name: "aave_v3_etherfi" }).click();
  await expect(page.getByTestId("order-note")).toContainText("block height");
  await expect(page.getByTestId("feed-row")).toHaveCount(2);
  // The null-time row falls back to its block number WITHOUT a tail divider.
  await expect(page.getByTestId("untimed-divider")).toHaveCount(0);
  await expect(page.getByTestId("feed-time").nth(1)).toHaveText("block 25,635,580");

  // Apply since_block; the filter echo answers from the wire.
  await page.getByTestId("since-block-control").getByRole("textbox").fill("25635600");
  await page.getByRole("button", { name: "apply", exact: true }).click();
  await expect(page.getByTestId("feed-row")).toHaveCount(1);
  await expect(page.getByTestId("feed-foot")).toContainText("since_block 25635600");

  // Back to cross-engine: the bound is DROPPED with a visible notice.
  await page.getByRole("button", { name: "cross-engine" }).click();
  await expect(page.getByTestId("feed-notice")).toContainText("since_block 25635600 dropped");
  await expect(page.getByTestId("since-block-impossible")).toBeVisible();

  // The law of the walk: no request EVER carried a cursor across a mode
  // switch — every new scope started from page one, cursor-less.
  for (const params of requests) {
    expect(params.get("cursor")).toBeNull();
  }
  // And the cross-engine requests never smuggled the since_block bound.
  for (const params of requests.filter((candidate) => candidate.get("engine") === null)) {
    expect(params.get("since_block")).toBeNull();
  }
});

test("amount units render honestly: named, raw where unlicensed, never a fake USD", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_UNITS));
  await page.goto("/feed");
  await expect(page.getByTestId("feed-row")).toHaveCount(4);

  const units = page.getByTestId("feed-amount-unit");
  await expect(units.filter({ hasText: "aave-scaled" })).toHaveCount(1);
  await expect(units.filter({ hasText: "normalized debt" })).toHaveCount(1);
  await expect(units.filter({ hasText: "opaque units" })).toHaveCount(1);

  // The record-only row (unit `none`, null amount) is its own statement.
  await expect(page.getByText("record-only")).toBeVisible();

  // The opaque amount is the RAW integer — its decimals were NOT applied.
  await expect(page.getByTestId("feed-amount").filter({ hasText: "123456789" })).toHaveCount(1);
  await expect(page.getByText("123.456789")).toHaveCount(0);

  // No dollar sign anywhere in the list: no unit here licenses USD.
  const listText = await page.getByTestId("feed-row").allInnerTexts();
  expect(listText.join("\n")).not.toContain("$");
});

test("liquidations ledger: typed extracts open, unestablished bonus stays a dash", async ({
  page,
}) => {
  await muteStream(page);
  const requests: URLSearchParams[] = [];
  await mockEvents(
    page,
    (params, route) =>
      params.get("types") === "liquidation"
        ? fulfillJson(route, FEED_LIQUIDATIONS)
        : fulfillJson(route, FEED_CROSS_PAGE_1),
    requests,
  );
  await page.goto("/feed");
  await expect(page.getByTestId("feed-row")).toHaveCount(2);

  await page.getByTestId("view-ledger").click();
  await expect(page.getByTestId("liquidation-detail")).toHaveCount(2);
  expect(requests.some((params) => params.get("types") === "liquidation")).toBe(true);

  // The aave example's extract, verbatim numbers.
  const aaveDetail = page.getByTestId("liquidation-detail").first();
  await expect(aaveDetail).toContainText("0xBBbB");
  await expect(aaveDetail.getByTestId("liquidation-seized")).toContainText("0.65625 weETH");
  await expect(aaveDetail.getByTestId("liquidation-bonus")).toContainText("500 bps");

  // The DM row: two seized legs; realized bonus NOT establishable → em dash.
  const dmDetail = page.getByTestId("liquidation-detail").nth(1);
  await expect(dmDetail.getByTestId("liquidation-seized")).toContainText("0.25 weETH");
  await expect(dmDetail.getByTestId("liquidation-seized")).toContainText("120 USDC");
  await expect(dmDetail.getByTestId("liquidation-bonus")).toContainText("realized —");
  await expect(dmDetail.getByTestId("liquidation-bonus")).toContainText("configured 500 bps");
});

test("all-actions view: a liquidation row's detail opens on demand", async ({ page }) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_PAGE_1));
  await page.goto("/feed");

  await expect(page.getByTestId("liquidation-detail")).toHaveCount(0);
  const toggle = page.getByTestId("detail-toggle");
  await expect(toggle).toHaveText("detail");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveText("close detail");
  await expect(page.getByTestId("liquidation-detail")).toHaveCount(1);
});

test("a refused cursor (400) renders the envelope's own words + an honest restart", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) =>
    params.get("cursor") === null
      ? fulfillJson(route, FEED_CROSS_PAGE_1)
      : fulfillJson(route, FEED_ERROR_BAD_CURSOR, 400),
  );
  await page.goto("/feed");
  await expect(page.getByTestId("feed-row")).toHaveCount(2);

  await page.getByTestId("feed-load-more").click();
  const refusal = page.getByTestId("feed-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("PAGE REFUSED · bad_request");
  await expect(refusal).toContainText("not interchangeable");
  // Page-1 rows are still shown — a refusal doesn't erase served truth.
  await expect(page.getByTestId("feed-row")).toHaveCount(2);

  await page.getByTestId("feed-restart").click();
  await expect(page.getByTestId("feed-refusal")).toHaveCount(0);
  await expect(page.getByTestId("feed-row")).toHaveCount(2);
});

test("degraded envelopes: 429 and 500 render their reasons; retry recovers", async ({
  page,
}) => {
  await muteStream(page);
  let mode: "rate" | "internal" | "ok" = "rate";
  await mockEvents(page, (params, route) => {
    if (mode === "rate") return fulfillJson(route, FEED_ERROR_RATE_LIMITED, 429);
    if (mode === "internal") return fulfillJson(route, FEED_ERROR_INTERNAL, 500);
    return fulfillJson(route, FEED_CROSS_PAGE_1);
  });
  await page.goto("/feed");

  const error = page.getByTestId("feed-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("rate limit exceeded");

  mode = "internal";
  await error.getByRole("button", { name: "retry" }).click();
  await expect(page.getByTestId("feed-error")).toContainText(
    "the service failed to build the response",
  );

  mode = "ok";
  await page.getByTestId("feed-error").getByRole("button", { name: "retry" }).click();
  await expect(page.getByTestId("feed-row")).toHaveCount(2);
  await expect(page.getByTestId("feed-error")).toHaveCount(0);
});

test("an empty filtered feed states its reason — a real answer, not a failure", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_EMPTY));
  await page.goto("/feed");

  const empty = page.getByTestId("feed-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("no custodied chain actions match this filter");
  await expect(empty).toContainText("a real answer");
});

test("live posture: no base frame → nothing pretended; the law is printed", async ({
  page,
}) => {
  await muteStream(page);
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_PAGE_1));
  await page.goto("/feed");

  const strip = page.getByTestId("feed-live-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("feed-live-none")).toContainText("nothing is pretended");
  await expect(page.getByTestId("feed-live-batch")).toHaveCount(0);
  await expect(strip).toContainText("current connection only");
  await expect(strip).toContainText("Live posture is never history");
});

test("live posture: a delivered snapshot renders the batch's real watermark vector", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: `event: snapshot\ndata: ${JSON.stringify(FEED_POSTURE_SNAPSHOT)}\n\n`,
    }),
  );
  await mockEvents(page, (params, route) => fulfillJson(route, FEED_CROSS_PAGE_1));
  await page.goto("/feed");

  const batch = page.getByTestId("feed-live-batch");
  await expect(batch).toBeVisible();
  await expect(batch).toContainText("batch #1");
  await expect(batch).toContainText("aave_v3_etherfi @25,635,618");
  await expect(batch).toContainText("debt_manager @154,796,552");
  // The strip stays labeled live-only even WITH a batch in hand.
  await expect(page.getByTestId("feed-live-strip")).toContainText("current connection only");
});
