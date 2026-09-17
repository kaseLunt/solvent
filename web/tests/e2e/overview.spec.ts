// The front door (spec 2026-09-15 §5.1). Mocked from committed fixtures; the
// live strip is the SAME headline grammar the Book renders, so the string is
// pinned here too.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockAll(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
}

test("hero, live strip, entries and pipeline render from the fixtures", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "70,000 people borrow against crypto to spend on a Visa card.",
  );
  const live = page.getByTestId("overview-live");
  await expect(live).toHaveAttribute("data-variant", "material");
  await expect(page.getByTestId("overview-live-headline")).toHaveText(
    "$4,200 of Cash debt is liquidatable right now, across 1 account.",
  );
  await expect(live.getByTestId("overview-live-identity")).toContainText("Batch 1");
  for (const id of ["book", "inspector", "scenarios"]) {
    await expect(page.getByTestId(`overview-entry-${id}`)).toBeVisible();
  }
  const dm = META.watermark_vector.find((w) => w.engine === "debt_manager");
  if (dm === undefined) throw new Error("meta fixture must carry the debt_manager watermark");
  await expect(page.getByTestId("pipeline-index")).toHaveAttribute("data-value", dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("pipeline-compute")).toContainText(`batch ${BOOK.batch.id.toLocaleString("en-US")}`);
  const recon = EVIDENCE_MANIFEST.reconcile;
  if (recon === null || recon === undefined) throw new Error("evidence fixture must carry a reconcile receipt");
  await expect(page.getByTestId("pipeline-verify")).toHaveAttribute(
    "data-value",
    `${recon.gated_exact.toLocaleString("en-US")}/${recon.gated_rows.toLocaleString("en-US")}`,
  );
  await expect(page.getByTestId("pipeline-serve")).toContainText("17 endpoints");
  // Never summed: the two engines' debts never appear as one figure
  // (6,000 legacy at 8 decimals + 4,200 Cash at 6 decimals).
  await expect(page.locator("body")).not.toContainText("$10,200");
});

test("with the API unreachable the hero still renders and the strip refuses honestly", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("70,000 people");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("The Cash book could not be loaded.");
  for (const id of ["index", "verify"]) {
    await expect(page.getByTestId(`pipeline-${id}`)).toHaveAttribute("data-value", "unavailable");
  }
  await expect(page.locator("body")).not.toContainText("$0 of Cash debt");
});

test("a withheld Cash engine refuses the strip and the entry cards carry no walk-derived figure", async ({ page }) => {
  const withheld = {
    ...BOOK,
    refused_engines: [
      { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven", note: "" },
    ],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager" ? { ...e, refused: true, total_debt: null, total_collateral: null } : e,
    ),
  };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, withheld));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("overview-entry-book")).toContainText("Live figures");
  await expect(page.getByTestId("overview-entry-inspector")).toContainText("Try any 0x address");
  await expect(page.locator("body")).not.toContainText("$0");
  await expect(page.locator("body")).not.toContainText("liquidatable now");
});

test("while the walk runs the strip is pending and the Book entry says so — never '$0 within 10% of cap'", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", () => new Promise<void>(() => undefined));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("Walking the Cash book…");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "pending");
  await expect(page.getByTestId("overview-entry-book")).toContainText("Walking the book…");
  await expect(page.locator("body")).not.toContainText("within 10% of cap");
  await expect(page.locator("body")).not.toContainText("Nothing material");
});

test("a refused stress preview is named on the Scenarios entry — never 'Committed scenarios'", async ({ page }) => {
  if (BOOK.waterfall === null) throw new Error("fixture invariant: the committed book serves a waterfall");
  const book = {
    ...BOOK,
    waterfall: {
      ...BOOK.waterfall,
      excluded_engines: [{ engine: "debt_manager", code: "SWEEP_FAILED", detail: "", note: "" }],
      points: BOOK.waterfall.points.map((p) => ({ ...p, engines: p.engines.filter((e) => e.engine !== "debt_manager") })),
    },
  };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-entry-scenarios")).toContainText("Preview withheld: collateral sweep failed");
  await expect(page.getByTestId("overview-entry-scenarios")).not.toContainText("Committed scenarios");
});

test("a malformed Cash debt on the strip is a dash, never $0", async ({ page }) => {
  const book = { ...BOOK, engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, total_debt: "" } : e)) };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  const strip = page.getByTestId("overview-live");
  await expect(strip).toContainText("Cash debt outstanding");
  await expect(strip).toContainText("—");
  await expect(strip).not.toContainText("$0");
});

test("the address field refuses a non-address inline and routes a real one to the Inspector", async ({ page }) => {
  await mockAll(page);
  await page.route("**/v1/address/**", (route) => route.abort());
  await page.goto("/");
  const field = page.getByTestId("overview-address");
  await field.fill("not an address");
  await field.press("Enter");
  await expect(page.getByTestId("overview-address-refused")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await field.fill("0xAAaA000000000000000000000000000000000001");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/inspector\/0xAAaA000000000000000000000000000000000001$/);
});

test("first viewport at 1440×900 holds hero, strip and entries", async ({ page }) => {
  await mockAll(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toBeVisible();
  const bottom = await page
    .getByTestId("overview-entry-scenarios")
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(900);
});
