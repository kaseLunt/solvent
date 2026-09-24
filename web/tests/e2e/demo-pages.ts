// The demo dataset routed in place of the API, and the eight pages with the moment each leaves its pending
// register. Shared by the screenshot pins (a local gate) and the specs every platform runs.
import { expect, type Page, type Route } from "@playwright/test";
import {
  DEMO_ADDRESS_NEAR,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_EVIDENCE,
  DEMO_FEED_PAGE_1,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_OBSERVATORY_AAVE,
  DEMO_OBSERVATORY_DM,
  DEMO_PARAMS_DM,
  DEMO_POSITIONS_DM_PAGE_1,
  DEMO_POSITIONS_DM_PAGE_2,
  DEMO_RUN_BOOK_ETH,
  DEMO_SCENARIOS,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

export async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/evidence*", (route) => json(route, DEMO_EVIDENCE));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
  // The Inspector's routes: `*` never crosses `/`, so /history and /stress are not swallowed by the address route.
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  // One endpoint, two readers: the Inspector asks for one account's actions, Activity for the cross-engine page.
  // The pinned Activity state is the first page only, so the cursor page is never asked for.
  await page.route("**/v1/events*", (route) =>
    json(route, new URL(route.request().url()).searchParams.get("account") === null ? DEMO_FEED_PAGE_1 : DEMO_EVENTS_NEAR),
  );
  // History: one engine per view, the series chosen by the request's own engine.
  await page.route("**/v1/observatory/series*", (route) =>
    json(route, new URL(route.request().url()).searchParams.get("engine") === "debt_manager" ? DEMO_OBSERVATORY_DM : DEMO_OBSERVATORY_AAVE),
  );
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_NEAR));
  // The Scenarios page: the listing and the demo run-book welded to the Book (the pinned state runs no set).
  await page.route("**/v1/scenarios/*/run-book", (route) => json(route, DEMO_RUN_BOOK_ETH));
  await page.route("**/v1/scenarios", (route) => json(route, DEMO_SCENARIOS));
}

// Each page says when it has left its pending register; a pin taken earlier would freeze a skeleton.
export const DEMO_PAGES = [
  { name: "overview", path: "/", ready: async (tab: Page) => expect(tab.getByTestId("overview-live")).not.toHaveAttribute("aria-busy", "true") },
  { name: "book", path: "/book", ready: async (tab: Page) => expect(tab.getByTestId("book-kpi-near")).not.toHaveAttribute("aria-busy", "true") },
  {
    name: "inspector",
    path: `/inspector/${DEMO_NEAR_ADDR}`,
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("inspector-surface")).toHaveAttribute("data-state", "near");
      await expect(tab.getByTestId("inspector-room-spark").locator("svg")).toBeVisible();
      await expect(tab.getByTestId("inspector-stress-table").locator("tbody tr")).toHaveCount(3);
      await expect(tab.getByTestId("inspector-activity").locator("tbody tr")).toHaveCount(6);
    },
  },
  {
    name: "lab",
    path: "/lab?scenario=eth_minus_30",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("lab-surface")).toHaveAttribute("data-state", "result");
      await expect(tab.getByTestId("lab-heatmap")).toBeVisible();
      await expect(tab.getByTestId("lab-movers").locator("tbody tr")).toHaveCount(20);
    },
  },
  {
    name: "history",
    path: "/observatory",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
      await expect(tab.getByTestId("history-tiles").locator("[aria-busy='true']")).toHaveCount(0);
      await expect(tab.getByTestId("history-surface").locator("svg").first()).toBeVisible();
    },
  },
  {
    name: "activity",
    path: "/feed",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
      await expect(tab.locator('[data-testid^="activity-row-"]')).toHaveCount(50);
    },
  },
  {
    name: "verification",
    path: "/proof",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("verification-surface")).toHaveAttribute("data-state", "ok");
      await expect(tab.getByTestId("verification-surface").locator("[aria-busy='true']")).toHaveCount(0);
      await expect(tab.getByTestId("verification-receipt")).toBeVisible();
    },
  },
  {
    name: "api",
    path: "/developers",
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("api-surface")).toBeVisible();
      await expect(tab.getByTestId("api-toc")).toBeVisible();
    },
  },
] as const;

