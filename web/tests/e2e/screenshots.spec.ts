// The anti-drift gate (spec 2026-09-15 §7, §9.4): the built pages must keep
// matching the composition the owner approved side-by-side with the mockups.
// Demo-scale fixtures so density is real. Local only — CI runners rasterize
// fonts differently, so these pins are the developer's gate, not CI's.
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  DEMO_ADDRESS_NEAR,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_POSITIONS_DM_PAGE_1,
  DEMO_POSITIONS_DM_PAGE_2,
  DEMO_RUN_BOOK_ETH,
  DEMO_SCENARIOS,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

test.skip(!!process.env.CI, "screenshot pins are a local gate; font rendering differs on CI runners");

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
  // The Inspector's routes: `*` never crosses `/`, so /history and /stress are not swallowed by the address route.
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_NEAR));
  // The Scenarios page: the listing and the demo run-book welded to the Book (the pinned state runs no set).
  await page.route("**/v1/scenarios/*/run-book", (route) => json(route, DEMO_RUN_BOOK_ETH));
  await page.route("**/v1/scenarios", (route) => json(route, DEMO_SCENARIOS));
}

// Each page says when it has left its pending register; a pin taken earlier would freeze a skeleton.
const PAGES = [
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
] as const;

for (const theme of ["dark", "light"] as const) {
  for (const page of PAGES) {
    test(`${page.name} · ${theme} · 1440×900`, async ({ page: tab }) => {
      await tab.addInitScript((t) => {
        try {
          localStorage.setItem("solvent-theme", t);
        } catch {
          /* private mode */
        }
      }, theme);
      await tab.setViewportSize({ width: 1440, height: 900 });
      await mockDemo(tab);
      await tab.goto(page.path, { waitUntil: "networkidle" });
      await page.ready(tab);
      await expect(tab).toHaveScreenshot(`${page.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
        // The ages tick; the pill, the snapshot chip and the Scenarios page's Computed chip are masked, everything else is pinned.
        mask: [tab.getByTestId("live-pill"), tab.locator("[data-chip='Snapshot']"), tab.locator("[data-chip='Computed']")],
      });
    });
  }
}
