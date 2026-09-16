// The Book page-test contract (spec 2026-09-15 §5.2, §7). Every pin is a
// semantic invariant against the running production build with the API
// mocked from committed fixtures; strings come from lib/book-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BATCH_SUPERSEDED, BOOK, BOOK_ERROR_UNAVAILABLE, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";
import { META } from "../fixtures/meta";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockCommitted(page: Page, book: unknown = BOOK, bookStatus = 200) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, book, bookStatus));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
}

async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
}

test("committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section", async ({
  page,
}) => {
  await mockCommitted(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "crit");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText(
    "$4,200 of Cash debt is liquidatable right now, across 1 account.",
  );
  await expect(page.getByTestId("book-verdict-dek")).toHaveText(
    "No account is within 10% of its borrow cap. 1 position could not be computed this batch and is counted, not hidden.",
  );
  const identity = page.getByTestId("book-verdict-identity");
  await expect(identity).toContainText("Batch 1");
  await expect(identity).toContainText("Coverage 1 / 2 computed");
  await expect(identity).toContainText("Current");

  await expect(page.getByTestId("book-kpi-debt")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-liquidatable")).toHaveAttribute("data-tone", "crit");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-near")).toContainText("0 accounts");
  await expect(page.getByTestId("book-kpi-baddebt")).toContainText("$239.60");
  await expect(page.getByTestId("book-kpi-notcomputed")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("collateral sweep never ran");

  const rows = page.getByTestId("book-attention").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Liquidatable");
  await expect(rows.nth(1)).toContainText("Not computed");
  await expect(rows.nth(1)).toHaveClass(/dim/);
  await expect(page.getByTestId("book-dust-toggle")).toHaveCount(0); // nothing below the line

  const legacy = page.getByTestId("book-legacy");
  await expect(legacy).not.toHaveAttribute("open", /.*/);
  await expect(legacy.locator("summary")).toContainText("Legacy · Aave v3 market");
  await expect(legacy.locator("summary")).toContainText("2 positions");
  // Never summed: 4,200 (Cash) + 6,000 (legacy) appears nowhere.
  await expect(page.locator("body")).not.toContainText("$10,200");
  // Wire names live in the drawer, not on the page.
  await expect(page.locator("main")).not.toContainText("debt_manager");
  await page.getByTestId("book-methodology").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("debt_manager");
  await expect(dialog).toContainText("$100");
});

test("demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population", async ({
  page,
}) => {
  await mockDemo(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText(
    "$6,840 of Cash debt is liquidatable right now, across 2 accounts.",
  );
  await expect(page.getByTestId("book-verdict-dek")).toContainText("47 more positions are technically liquidatable");
  await expect(page.getByTestId("book-kpi-near")).toContainText("27 accounts");
  const toggle = page.getByTestId("book-dust-toggle");
  await expect(toggle).toContainText("Show 47 small & dust positions");
  const before = await page.getByTestId("book-attention").locator("tbody tr").count();
  await toggle.click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(before + 47);
  const counts = await page
    .getByTestId("book-bands")
    .locator("[data-count]")
    .evaluateAll((els) => els.reduce((n, el) => n + Number(el.getAttribute("data-count")), 0));
  expect(counts).toBe(1406);
});

test("the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero", async ({ page }) => {
  const withheld = {
    ...BOOK,
    refused_engines: [
      {
        engine: "debt_manager",
        code: "FLAG_CUSTODY_UNPROVEN",
        detail: "collateral-flag custody is unproven for this window",
        note: "a withheld engine is never representable as an empty healthy one",
      },
    ],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager" ? { ...e, refused: true, total_debt: null, total_collateral: null } : e,
    ),
  };
  await mockCommitted(page, withheld);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("book-kpi-debt")).toContainText("—");
  await expect(page.getByTestId("book-kpi-debt")).toHaveAttribute("data-tone", "refused");
  await expect(page.locator("main")).not.toContainText("$0 of Cash debt");
});

test("no servable batch (503): the load-failure headline names the reason", async ({ page }) => {
  await mockCommitted(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be loaded.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText(BOOK_ERROR_UNAVAILABLE.error.message.slice(1, 20));
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("—");
});

test("a 409 during the walk restarts it on the reloaded book", async ({ page }) => {
  let bookRequests = 0;
  let positionsRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return json(route, BOOK);
  });
  await page.route("**/v1/positions*", (route) => {
    positionsRequests += 1;
    return positionsRequests === 1 ? json(route, BATCH_SUPERSEDED, 409) : json(route, POSITIONS_DM_PAGE_1);
  });
  await page.goto("/book");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  expect(bookRequests).toBe(2);
  expect(positionsRequests).toBe(2);
});

test("a transport failure mid-walk is stated with a retry that re-walks", async ({ page }) => {
  let positionsRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    positionsRequests += 1;
    return positionsRequests === 1 ? route.abort("failed") : json(route, POSITIONS_DM_PAGE_1);
  });
  await page.goto("/book");
  const failure = page.getByTestId("book-walk-failure");
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  await expect(failure).toHaveCount(0);
  expect(positionsRequests).toBe(2);
});

test("first viewport at 1440×900 holds the verdict, the tiles and the top of the grid", async ({ page }) => {
  await mockDemo(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book");
  await expect(page.getByTestId("book-kpi-notcomputed")).toBeVisible();
  const tilesBottom = await page.getByTestId("book-kpi-notcomputed").evaluate((el) => el.getBoundingClientRect().bottom);
  const chartTop = await page.getByTestId("book-bands").evaluate((el) => el.getBoundingClientRect().top);
  expect(tilesBottom).toBeLessThanOrEqual(900);
  expect(chartTop).toBeLessThan(900);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(1440); // no primary horizontal scroll
});
