// The anti-drift gate (spec 2026-09-15 §7, §9.4): the built pages must keep
// matching the composition the owner approved side-by-side with the mockups.
// Demo-scale fixtures so density is real. Local only — CI runners rasterize
// fonts differently, so these pins are the developer's gate, not CI's.
import { expect, test } from "@playwright/test";
import { DEMO_PAGES, mockDemo } from "./demo-pages";

test.skip(!!process.env.CI, "screenshot pins are a local gate; font rendering differs on CI runners");

for (const theme of ["dark", "light"] as const) {
  for (const page of DEMO_PAGES) {
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
