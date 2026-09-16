// Smoke: the app shell (spec 2026-09-15 §4 AppShell) renders every route with
// the shared chrome — the eight-tab nav, the brand block, and an HONEST live
// pill (with no API running it must say the stream is not delivering, and
// must never render a fake Live).
//
// Nav labels are the page names (§3.2); ROUTES are unchanged. Each surface's
// own H1 is asserted separately from its tab label. Surfaces not yet rebuilt
// keep their old H1s until their convergence plan lands.

import { expect, test } from "@playwright/test";

const SURFACES = [
  { path: "/", label: "Overview", h1: /70,000 people borrow against crypto/ },
  { path: "/book", label: "Book", h1: /liquidatable|could not be computed|could not be loaded/ },
  { path: "/inspector", label: "Inspector", h1: "Inspector" },
  { path: "/lab", label: "Scenarios", h1: "Scenario Lab" },
  { path: "/observatory", label: "History", h1: "Observatory" },
  { path: "/feed", label: "Activity", h1: "Feed" },
  { path: "/proof", label: "Verification", h1: "Proof" },
  { path: "/developers", label: "API", h1: "Developers" },
] as const;

/** Pages whose rebuild has not landed yet; their H1 pins are fixme until it does. */
const PENDING_PAGES: ReadonlySet<string> = new Set(["/", "/book"]);

const NAV_LABELS = SURFACES.map((s) => s.label);

for (const surface of SURFACES) {
  test(`${surface.path} renders ${surface.label} inside the shell`, async ({ page }) => {
    test.fixme(PENDING_PAGES.has(surface.path), "page rebuild lands in a later task of plan 1");
    // No API in this smoke: every page renders its refused register, and the
    // shell must render regardless.
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto(surface.path);

    // Surface identity.
    await expect(page.getByRole("heading", { level: 1, name: surface.h1 })).toBeVisible();

    // Shared chrome: brand + every nav destination.
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Solvent · go to the overview" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "app surfaces" });
    for (const label of NAV_LABELS) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // The active tab is marked.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    // The live pill states the stream's own truth — never a fake Live with no
    // API behind it.
    const pill = header.getByTestId("live-pill");
    await expect(pill).toHaveAttribute("data-word", /Reconnecting|Not connected/);
  });
}

test("theme override wins in both directions and returns to system", async ({ page }) => {
  await page.goto("/book");
  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: /theme:/ });

  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await toggle.click(); // system -> light
  await expect(html).toHaveAttribute("data-theme", "light");
  await toggle.click(); // light -> dark
  await expect(html).toHaveAttribute("data-theme", "dark");
  await toggle.click(); // dark -> system
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
});

test("styleguide renders every specimen section (when built in)", async ({ page }) => {
  const response = await page.goto("/styleguide");
  test.skip(
    response !== null && response.status() === 404,
    "styleguide not compiled into this bundle (NEXT_PUBLIC_SHOW_STYLEGUIDE unset)",
  );

  await expect(page.getByTestId("specimen-banner")).toBeVisible();
  // p1a-6 rebuilt the page canon-structured (build-contract §1–§11 order,
  // then the production primitives Phase 3 migrates onto the kit). The walk's
  // old→new ledger lives in .superpowers/sdd/progress-ui-overhaul.md §p1a-6.
  for (const section of [
    "sg-tokens",
    "sg-type",
    "sg-verdict",
    "sg-freshness",
    "sg-dimensions",
    "sg-exact",
    "sg-states",
    "sg-table",
    "sg-pagination",
    "sg-drawer",
    "sg-ribbon",
    "sg-charts",
    "sg-interaction",
    "sg-statcard",
    "sg-severity",
    "sg-chips",
    "sg-marks",
    "sg-stampline",
    "sg-truth",
  ]) {
    await expect(page.getByTestId(section)).toBeVisible();
  }

  // The drawer opens and closes on Escape.
  await page.getByRole("button", { name: "OPEN EXPLAIN-THIS-NUMBER DRAWER" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
