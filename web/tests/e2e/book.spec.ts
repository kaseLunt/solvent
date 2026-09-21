// The Book page-test contract (spec 2026-09-15 §5.2, §7). Every pin is a
// semantic invariant against the running production build with the API
// mocked from committed fixtures; strings come from lib/book-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BATCH_SUPERSEDED, BOOK, BOOK_ENGINE_REFUSED, BOOK_ERROR_UNAVAILABLE, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
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

  // Cross-page links name their subject: a row opens its own address, the preview opens its own scenario.
  const rowHref = await rows.nth(0).locator("a").first().getAttribute("href");
  expect(rowHref).toMatch(/^\/inspector\/0x[0-9a-fA-F]{40}$/);
  const previewLinks = page.getByTestId("book-stress-preview").locator("a");
  expect(await previewLinks.count()).toBeGreaterThan(1);
  for (const link of await previewLinks.all()) await expect(link).toHaveAttribute("href", "/lab?scenario=eth_minus_30");

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
  // Refused rows are counted, not hidden: every one of the 6 sits in the default table, dimmed, with its debt.
  await expect(page.getByTestId("book-attention").locator("tbody tr.dim, tbody tr[class*='dim']")).toHaveCount(6);
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
  for (const id of ["debt", "liquidatable", "near", "median", "baddebt"]) {
    await expect(page.getByTestId(`book-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
    await expect(page.getByTestId(`book-kpi-${id}`)).toContainText("—");
  }
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("collateral-flag custody unproven");
  await expect(page.getByTestId("book-bands-card")).toContainText("Not computed.");
  await expect(page.getByTestId("book-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-attention")).toHaveCount(0);
  await expect(page.getByTestId("book-stress-preview")).toContainText("Preview withheld");
  // A withheld preview names no scenario: its link is the workspace, never an id the batch did not publish a view for.
  await expect(page.getByTestId("book-stress-preview").locator("a")).toHaveAttribute("href", "/lab");
  // No liquidatable pill anywhere, and no "$0" standing in for a figure the engine withheld.
  await expect(page.locator('main [data-tone="crit"]')).toHaveCount(0);
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0");
  await expect(page.getByTestId("book-kpi-near")).not.toContainText("$0");
});

test("a positions page from another batch reloads the book once instead of mixing rows", async ({ page }) => {
  let bookRequests = 0;
  const moved = { ...POSITIONS_DM_PAGE_1, batch: { ...POSITIONS_DM_PAGE_1.batch, id: POSITIONS_DM_PAGE_1.batch.id + 1 } };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return json(route, bookRequests === 1 ? BOOK : { ...BOOK, batch: { ...BOOK.batch, id: BOOK.batch.id + 1 } });
  });
  await page.route("**/v1/positions*", (route) => json(route, moved));
  await page.goto("/book");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("book-verdict-identity")).toContainText(`Batch ${String(BOOK.batch.id + 1)}`);
  expect(bookRequests).toBe(2);
});

test("no servable batch (503): the load-failure headline names the reason", async ({ page }) => {
  await mockCommitted(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be loaded.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText(BOOK_ERROR_UNAVAILABLE.error.message.slice(1, 20));
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("—");
  // A book that could not be read refused nothing and computed nothing: the tile says so, never "nothing refused".
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("not computed");
  await expect(page.getByTestId("book-kpi-notcomputed")).not.toContainText("nothing refused");
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
  // A walk that stopped on page one has read nothing: the headline names the stop and no tile prints a zero.
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-kpi-near")).toContainText("—");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("book-kpi-median")).toContainText("walk stopped");
  await expect(page.getByTestId("book-attention")).toContainText("no account is cleared");
  await expect(page.locator("body")).not.toContainText("Nothing material");
  await expect(page.locator("body")).not.toContainText("No account is within 10%");
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  await expect(failure).toHaveCount(0);
  expect(positionsRequests).toBe(2);
});

test("a -0 population on /v1/book refuses the route — never a printed zero", async ({ page }) => {
  // JSON admits the literal -0; JSON.stringify would erase it, so the body is
  // spliced as text. The legacy engine's computed_positions is the target.
  const body = JSON.stringify(BOOK).replace(/"computed_positions":1\b/, '"computed_positions":-0');
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body }),
  );
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.goto("/book");
  await expect(page.getByTestId("route-refusal")).toBeVisible();
  await expect(page.getByTestId("route-refusal")).toContainText("computed_positions");
  await expect(page.locator("body")).not.toContainText("-0 computed");
});

async function mockWith(page: Page, book: unknown, positions: unknown) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, positions));
}

const cashEngineOf = (book: typeof BOOK, over: Partial<(typeof BOOK)["engines"][number]>) => ({
  ...book,
  engines: book.engines.map((e) => (e.engine === "debt_manager" ? { ...e, ...over } : e)),
});

test("while the walk is still running the verdict is pending — never 'Nothing material', never a near-cap negative", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", () => new Promise<void>(() => undefined));
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("Walking the Cash book…");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-kpi-liquidatable")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("book-attention")).toContainText("Walking the book…");
  // The distance chart: a walk-derived zero is a dash, never "$0 sits within 10%", and the bars wear their own qualifier.
  await expect(page.getByTestId("book-bands-card")).toContainText(
    "— within 10% of the cap: a zero is claimed only by a complete walk · walking the book, figures are a lower bound",
  );
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0 sits within 10%");
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "Walking the book: every bar and every count is a lower bound over the accounts read so far.",
  );
  await expect(page.locator("body")).not.toContainText("Nothing material");
  await expect(page.locator("body")).not.toContainText("No account is within 10%");
  await expect(page.locator("body")).not.toContainText("No account needs attention");
});

test("a refused positions page is the engine's refusal — never an empty, healthy book", async ({ page }) => {
  const refused = {
    ...POSITIONS_DM_PAGE_1,
    refused: true,
    refusal: { engine: "debt_manager", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  };
  await mockWith(page, BOOK, refused);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("book-verdict-dek")).toHaveText("Collateral sweep failed.");
  for (const id of ["debt", "liquidatable", "near", "median"]) {
    await expect(page.getByTestId(`book-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
    await expect(page.getByTestId(`book-kpi-${id}`)).toContainText("—");
  }
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("collateral sweep failed");
  await expect(page.getByTestId("book-attention")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("No account needs attention");
  await expect(page.locator("body")).not.toContainText("Nothing material");
});

test("a terminal page short of the advertised census stops the walk by name — the positive it read stands, no negative is claimed", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { positions: 3 }), { ...POSITIONS_DM_PAGE_1, total_positions: 3 });
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("the walk delivered 2 of the 3 rows the wire advertised");
  await expect(page.getByTestId("book-walk-failure").getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "crit");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("The walk stopped before the last page");
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("No account is within 10%");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("lower bound, walk stopped");
  await expect(page.getByTestId("book-kpi-near")).toContainText("—");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("book-kpi-median")).toContainText("walk stopped");
  await expect(page.getByTestId("book-bands-card")).toContainText(
    "— within 10% of the cap: a zero is claimed only by a complete walk · the walk stopped, figures are a lower bound",
  );
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0 sits within 10%");
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "The walk stopped: every bar and every count is a lower bound over the accounts it read.",
  );
});

test("the distance chart over an incomplete walk: the figure is a floor in its own words and the bars wear their own qualifier; once the walk completes, neither is qualified", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/positions*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === null) return json(route, DEMO_POSITIONS_DM_PAGE_1);
    await held;
    return json(route, DEMO_POSITIONS_DM_PAGE_2);
  });
  await page.goto("/book");
  const card = page.getByTestId("book-bands-card");
  // Page one carries the least room first, so the near-cap accounts are read while page two is still out.
  await expect(card).toContainText(/at least \$[\d.,]+[KMB]? sits within 10% of the cap · walking the book, figures are a lower bound/);
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "Walking the book: every bar and every count is a lower bound over the accounts read so far.",
  );
  release();
  await expect(page.getByTestId("book-bands-note")).toHaveCount(0);
  await expect(card).toContainText(/· \$[\d.,]+[KMB]? sits within 10% of the cap/);
  await expect(card).not.toContainText("at least");
  await expect(card).not.toContainText("lower bound");
});

test("a waterfall served with no points is a named refusal on the preview card — never 'not on the grid', never 'no stress grid'", async ({ page }) => {
  if (BOOK.waterfall === null) throw new Error("fixture invariant: the committed book serves a waterfall");
  await mockCommitted(page, { ...BOOK, waterfall: { ...BOOK.waterfall, points: [] } });
  await page.goto("/book");
  const card = page.getByTestId("book-stress-preview");
  await expect(card).toContainText("Preview withheld: no points published.");
  await expect(card).not.toContainText("is not on this batch");
  await expect(card).not.toContainText("carries no stress grid");
  await expect(card.locator("a")).toHaveAttribute("href", "/lab");
});

test("a walk past its census is worded against the census — 'delivered N rows for a census of M', never 'N of the M rows'", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { positions: 1 }), { ...POSITIONS_DM_PAGE_1, total_positions: 1 });
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("the walk delivered 2 rows for a census of 1");
  await expect(page.getByTestId("book-walk-failure")).not.toContainText("2 of the 1");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("the walk delivered 2 rows for a census of 1");
  await expect(page.locator("body")).not.toContainText("No account needs attention");
});

test("a positions page from another engine never enters the Cash walk", async ({ page }) => {
  const foreign = {
    ...POSITIONS_DM_PAGE_1,
    engine: "aave_v3_etherfi",
    positions: POSITIONS_DM_PAGE_1.positions.map((p) => ({ ...p, engine: "aave_v3_etherfi" })),
  };
  await mockWith(page, BOOK, foreign);
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("aave_v3_etherfi");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("book-attention")).toContainText("no account is cleared");
  const counts = await page
    .getByTestId("book-bands")
    .locator("[data-count]")
    .evaluateAll((els) => els.reduce((n, el) => n + Number(el.getAttribute("data-count")), 0));
  expect(counts).toBe(0);
});

test("another engine's refused page is a wrong-engine fault — never Cash's refusal", async ({ page }) => {
  const foreignRefusal = {
    ...POSITIONS_DM_PAGE_1,
    engine: "aave_v3_etherfi",
    refused: true,
    refusal: { engine: "aave_v3_etherfi", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  };
  await mockWith(page, BOOK, foreignRefusal);
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText('the page answers for engine "aave_v3_etherfi", not debt_manager');
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-verdict-headline")).not.toHaveText("The Cash book could not be computed this batch.");
  await expect(page.locator("body")).not.toContainText("Collateral sweep failed.");
});

test("a liquidatable position under the $100 line is hidden by the display rule, and the table says so — never 'No account needs attention'", async ({ page }) => {
  const [liquidatable] = POSITIONS_DM_PAGE_1.positions;
  if (liquidatable === undefined || liquidatable.health_factor === null) throw new Error("fixture invariant");
  const small = {
    ...POSITIONS_DM_PAGE_1,
    total_positions: 1,
    positions: [{ ...liquidatable, total_debt: "50000000", health_factor: { ...liquidatable.health_factor, num: "32000000", den: "50000000" } }],
  };
  const book = cashEngineOf(BOOK, { positions: 1, computed_positions: 1, refused_positions: 0, refusals: [] });
  await mockWith(page, book, small);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("Nothing material is liquidatable on the Cash book right now.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("1 more position is technically liquidatable but totals $50");
  await expect(page.getByTestId("book-attention")).toContainText(
    "Nothing material needs attention; 1 liquidatable position under $100 ($50) is behind the small & dust toggle.",
  );
  await expect(page.locator("body")).not.toContainText("No account needs attention");
  await page.getByTestId("book-dust-toggle").click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("book-attention").locator("tbody tr").first()).toContainText("Liquidatable");
});

test("the legacy engine withheld whole: its cause is named, no population, no histogram — never '0 positions'", async ({ page }) => {
  await mockWith(page, BOOK_ENGINE_REFUSED, POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  const legacy = page.getByTestId("book-legacy");
  await expect(legacy).toHaveAttribute("data-withheld", "true");
  await expect(legacy.locator("summary")).toContainText("withheld this batch: collateral-flag custody unproven");
  await expect(legacy.locator("summary")).not.toContainText("0 positions");
  await expect(legacy.locator("summary")).not.toContainText("0 liquidatable");
  await expect(page.getByTestId("book-legacy-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-legacy-withheld")).toContainText("collateral-flag custody unproven");
  // The Cash book beside it serves normally.
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
});

test("a malformed wire money string is named, never coerced: '' is not $0", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { total_debt: "" }), POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  const tile = page.getByTestId("book-kpi-debt");
  await expect(tile).toContainText("—");
  await expect(tile).toContainText("engines[debt_manager].total_debt is not a wire decimal");
  await expect(tile).toHaveAttribute("data-tone", "refused");
  await expect(tile).not.toContainText("$0");
});

test("a fractional legacy bucket count refuses the route by name — never a bar", async ({ page }) => {
  // The first `"count":0` in the serialized book is the legacy histogram's first bucket.
  const body = JSON.stringify(BOOK).replace('"count":0', '"count":1.5');
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body }),
  );
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.goto("/book");
  await expect(page.getByTestId("route-refusal")).toBeVisible();
  await expect(page.getByTestId("route-refusal")).toContainText("buckets[0].count");
  await expect(page.getByTestId("book-legacy-bands")).toHaveCount(0);
});

test("positions the stress arithmetic excluded are named beside the preview and counted in the drawer", async ({ page }) => {
  const book = {
    ...BOOK,
    coverage: {
      ...BOOK.coverage,
      excluded_by_this_layer: 1,
      stress_coverage_is_full: false,
      excluded: [
        {
          engine: "debt_manager",
          account: "0xEEee000000000000000000000000000000000005",
          code: "API_RECONSTRUCTION_MISMATCH",
          reason: "the position could not be rebuilt from its legs",
        },
      ],
    },
  };
  await mockWith(page, book, POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  await expect(page.getByTestId("book-stress-unmeasured")).toContainText("1 position on this engine is excluded from the stress arithmetic");
  await page.getByTestId("book-methodology").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 excluded from the stress arithmetic");
  await expect(page.getByTestId("book-methodology-excluded")).toContainText("0xEEee000000000000000000000000000000000005");
  await expect(page.getByTestId("book-methodology-excluded")).toContainText("API_RECONSTRUCTION_MISMATCH");
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
