// Smoke: the W0 shell renders all six routes with the shared chrome — the
// five-tab appnav + the proof/docs register, the brand block, and an HONEST
// posture ribbon (with no API running it must say the stream is not
// delivering, and must never render a fake LIVE).
//
// WAVE R1 ITEM 13 inverted the nav-label pins: the tabs now read Scenarios /
// History / Activity while the ROUTES are unchanged (/lab, /observatory,
// /feed). Each surface's own H1 is asserted separately from its tab label,
// which is exactly the pair the rename had to keep coherent.

import { expect, test } from "@playwright/test";

const SURFACES = [
  { path: "/book", name: "Book" },
  { path: "/inspector", name: "Inspector" },
  { path: "/observatory", name: "Observatory" },
  { path: "/feed", name: "Feed" },
  { path: "/lab", name: "Scenario Lab" },
  { path: "/developers", name: "Developers" },
] as const;

const NAV_LABELS = [
  "Book",
  "Inspector",
  "Scenarios",
  "History",
  "Activity",
  "Proof",
  "Developers",
] as const;

test("root redirects to the Book", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/book$/);
});

for (const surface of SURFACES) {
  test(`${surface.path} renders ${surface.name} inside the shell`, async ({ page }) => {
    await page.goto(surface.path);

    // Surface identity.
    await expect(page.getByRole("heading", { level: 1, name: surface.name })).toBeVisible();

    // Shared chrome: brand + all six nav destinations.
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Solvent · go to the Book" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "app surfaces" });
    for (const label of NAV_LABELS) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // The active tab is marked.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    // The integrity ribbon slot renders an HONEST state: either a real
    // watermark vector (LIVE · WATERMARKED) or the truth about the stream.
    await expect(
      header.getByText(/LIVE · WATERMARKED|STREAM · (CONNECTING|RECONNECTING|AWAITING BASE|CLOSED)|NO SERVABLE BATCH/),
    ).toBeVisible();
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
  for (const section of [
    "sg-tokens",
    "sg-statcard",
    "sg-severity",
    "sg-chips",
    "sg-marks",
    "sg-stampline",
    "sg-ribbon",
    "sg-table",
    "sg-pagination",
    "sg-charts",
    "sg-drawer",
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
