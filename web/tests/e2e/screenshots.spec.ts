// The anti-drift gate (spec 2026-09-15 §7, §9.4): the built pages must keep
// matching the composition the owner approved side-by-side with the mockups.
// Demo-scale fixtures so density is real. Local only — CI runners rasterize
// fonts differently, so these pins are the developer's gate, not CI's.
import { expect, test, type Page, type Route } from "@playwright/test";
import { DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";
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
}

const PAGES = [
  { name: "overview", path: "/", settled: "overview-live" },
  { name: "book", path: "/book", settled: "book-kpi-near" },
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
      // Wait for the walk to settle so the tiles are not in their pending register.
      await expect(tab.getByTestId(page.settled)).not.toHaveAttribute("aria-busy", "true");
      await expect(tab).toHaveScreenshot(`${page.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
        // The age ticks; the pill and the snapshot chip are masked, everything else is pinned.
        mask: [tab.getByTestId("live-pill"), tab.locator("[data-chip='Snapshot']")],
      });
    });
  }
}
