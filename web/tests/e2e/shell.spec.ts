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
  { path: "/inspector", label: "Inspector", h1: "Is this address at risk?" },
  // With no API the listing cannot be fetched, and the Scenarios page says so as its H1.
  { path: "/lab", label: "Scenarios", h1: "The committed scenarios could not be listed." },
  // With no API the series cannot be fetched, and History says so as its H1.
  { path: "/observatory", label: "History", h1: /could not be fetched\.$/ },
  // With no API the first page cannot be fetched, and Activity says so as its H1.
  { path: "/feed", label: "Activity", h1: /^Recorded chain actions could not be fetched\.$/ },
  // With no API the manifest cannot be fetched, and Verification says so as its H1.
  { path: "/proof", label: "Verification", h1: /^The verification record could not be fetched\.$/ },
  // The API page is static: its H1 is the contract's own operation count, API or no API.
  { path: "/developers", label: "API", h1: /read-only endpoints, every money value an exact decimal string\.$/ },
] as const;

/** Pages whose rebuild has not landed yet; their H1 pins are fixme until it does. */
const PENDING_PAGES: ReadonlySet<string> = new Set([]);

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
  // p1a-6 built the page canon-structured (build-contract §1–§11 order); the pre-kit components retired with the
  // convergence (plan 2026-09-16, R7), and each section that showed one shows its kit successor, in the same order:
  // sg-ribbon → sg-identity (IdentityChips), sg-statcard → sg-kpi (KpiTile), sg-severity → sg-pills (StatusPill).
  // sg-chips, sg-marks and sg-stampline are retired with their components — engine and address identity ride the
  // table specimen, the refusal and projection registers ride sg-pills, the key → value rows ride sg-drawer and
  // sg-truth.
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
    "sg-identity",
    "sg-charts",
    "sg-interaction",
    "sg-kpi",
    "sg-pills",
    "sg-truth",
  ]) {
    await expect(page.getByTestId(section)).toBeVisible();
  }

  // The drawer opens from the kit's own button and closes on Escape.
  await page.getByRole("button", { name: "Methodology & evidence" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
