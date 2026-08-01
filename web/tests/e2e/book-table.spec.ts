// W-UX-C (the Book table redesign — MAIN ruling part C, points 1–8/13–15 +
// four micro-rulings) e2e — MOCKED API via route interception. Base bodies
// come from tests/fixtures/book.ts (generated, contract-validated);
// mutations are structuredClone surgery IN THE TEST, each a documented
// delta.
//
// Asserted rulings:
//   (1/2/14) — dust defaults to <1 and rides every request as min_value =
//     step × 10^value_decimals (the ACTIVE engine's decimals); refused rows
//     are never hidden; the group title carries the law verbatim.
//   (3/5) — the footer accounts loaded/qualifying/hidden/on-book on ONE
//     batch; the disclosure span carries the Σ-debt bound, upgraded to the
//     EXACT Σ at walk exhaustion; "show" reveals; a batch mismatch names
//     both batches and blends nothing; the liquidatable line renders the
//     aggregate count in crit tone.
//   (7/8/15) — clickable headers replace the sort chips: canonical → exact
//     reverse → (column switch resets), TWO-STATE; aria-sort + the accent
//     glyph only on the active column; the DM never grows an HF affordance;
//     "refused first" (sort=status) clears every indicator; the URL mirrors
//     ?engine&sort&dir&dust with defaults omitted via replaceState.
//   (13) — the sentinel auto-loads iff hasMore && !loading && error === null
//     (NEVER across an error); windowing bounds the DOM at any depth; the
//     footer stays visible; LOAD MORE remains as the fallback.
//   (micro 2) — the partial risk map wears the DensityMap's axis vocabulary.

import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BOOK,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";
import { FEED_ERROR_INTERNAL } from "../fixtures/feed";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

async function mockBook(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route("**/v1/book", (route) => fulfillJson(route, body, status));
}

/** Default positions routing: aave pages 1→2, the DM page, cursor-aware. */
async function mockPositions(page: Page): Promise<void> {
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    const cursor = url.searchParams.get("cursor");
    if (engine === "debt_manager") return fulfillJson(route, POSITIONS_DM_PAGE_1);
    if (cursor === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
}

async function openBook(page: Page, path = "/book"): Promise<void> {
  await muteStream(page);
  await page.goto(path);
}

const ACCOUNTING = "positions-accounting";

// ---------------------------------------------------------------------------
// Derived fixtures (documented deltas of the canonical bodies).
// ---------------------------------------------------------------------------

/**
 * DERIVED /v1/book: the aave aggregate gains ONE dust position — positions
 * 2→3, computed 1→2, total_debt 600000000000 → 600000050000 (the dust row's
 * exact 50000 = $0.0005 at 8 decimals), liquidatable_positions 0→1 (the
 * hidden dust row is liquidatable — it must surface in the liquidatable
 * line, not vanish). No other byte changes.
 */
function bookWithAaveDust() {
  const book = structuredClone(BOOK);
  const agg = book.engines[0];
  if (agg === undefined || agg.engine !== "aave_v3_etherfi") throw new Error("fixture shape drifted");
  agg.positions = 3;
  agg.computed_positions = 2;
  agg.total_debt = "600000050000";
  agg.liquidatable_positions = 1;
  return book;
}

/** The canonical computed aave row + the canonical refused row, as ONE page. */
function aaveQualifyingPage() {
  const computed = structuredClone(POSITIONS_AAVE_PAGE_1.positions[0]);
  const refused = structuredClone(POSITIONS_AAVE_PAGE_2.positions[0]);
  if (computed === undefined || refused === undefined) throw new Error("fixture shape drifted");
  const page = structuredClone(POSITIONS_AAVE_PAGE_1);
  page.positions = [computed, refused];
  page.total_positions = 2; // QUALIFYING count under min_value
  page.next_cursor = null;
  return page;
}

/** The UNFILTERED page: computed + the $0.0005 dust row + refused. */
function aaveUnfilteredPage() {
  const computed = structuredClone(POSITIONS_AAVE_PAGE_1.positions[0]);
  const refused = structuredClone(POSITIONS_AAVE_PAGE_2.positions[0]);
  if (computed === undefined || refused === undefined) throw new Error("fixture shape drifted");
  const dust = structuredClone(computed);
  dust.account = "0xEeEe000000000000000000000000000000000005";
  dust.total_collateral = "40000";
  dust.total_debt = "50000"; // $0.0005 at 8 decimals — strictly below the <1 step
  const page = structuredClone(POSITIONS_AAVE_PAGE_1);
  page.positions = [computed, dust, refused];
  page.total_positions = 3;
  page.next_cursor = null;
  return page;
}

// ---------------------------------------------------------------------------
// (1/2/3/5/14) — the default dust walk and its disclosure.
// ---------------------------------------------------------------------------

test("default dust <1: min_value composed from the engine's decimals; disclosure exact at exhaustion; show reveals", async ({
  page,
}) => {
  const minValues: Array<string | null> = [];
  await mockBook(page, bookWithAaveDust());
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") !== null) minValues.push(url.searchParams.get("min_value"));
    if (url.searchParams.get("min_value") === "100000000") {
      return fulfillJson(route, aaveQualifyingPage());
    }
    return fulfillJson(route, aaveUnfilteredPage());
  });
  await openBook(page);

  // The dust group: chip grammar, default <1 pressed, the title verbatim.
  const dustGroup = page.getByTestId("dust-group");
  await expect(dustGroup).toHaveAttribute(
    "title",
    "hide rows where max(collateral, debt) is below the step, in the engine's own value " +
      "unit — hidden rows stay counted here and in every aggregate above; refused and " +
      "null-valued rows are never hidden",
  );
  await expect(dustGroup.getByRole("button", { name: "<1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The filtered walk: refused row VISIBLE (never dust), dust row absent.
  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");
  await expect(table).toContainText("0xBbbb…0002"); // refused — never hidden
  await expect(table).not.toContainText("0xEeEe…0005");

  // min_value = 1 × 10^8 (the aave aggregate's value_decimals), every fetch.
  expect(minValues.length).toBeGreaterThan(0);
  expect(minValues).toEqual(minValues.map(() => "100000000"));

  // Footer accounting: loaded of qualifying, hidden, on book, sort + glyph.
  await expect(page.getByTestId(ACCOUNTING)).toHaveText(
    "2 loaded of 2 qualifying (dust <1) · 1 hidden below step · 3 on book · sort liq_distance ▲",
  );

  // The disclosure span at walk exhaustion: the EXACT Σ (bookΣ − loadedΣ =
  // 600000050000 − 600000000000 = 50000 → 0.0005), same batch, bigint.
  const disclosure = page.getByTestId("dust-disclosure");
  await expect(disclosure).toContainText("hidden: 1 rows below 1 · Σ debt 0.0005 exact");

  // The liquidatable line: the aggregate's verdict count (crit tone) vs the
  // loaded rows — the hidden liquidatable dust row cannot vanish silently.
  await expect(page.getByTestId("liquidatable-disclosure")).toHaveText(
    "1 liquidatable on this book · 0 among loaded rows — the rest are below the dust step " +
      "or on unloaded pages",
  );

  // The amended footer constant.
  await expect(page.getByText("refused rows stay visible and counted — never dust")).toBeVisible();

  // The risk map discloses the source-side filter and the three-part label.
  await expect(page.getByTestId("risk-map-dust-legend")).toHaveText(
    "dust below 1 is excluded at the source — this map shows the filtered walk only",
  );
  await expect(page.getByTestId("book-risk-map")).toContainText(
    "2 loaded / 2 qualifying / 3 on book",
  );

  // "show" is a chipButton that sets dust off: the dust row appears, the
  // accounting flips to the off grammar, and the URL carries dust=off.
  await page.getByTestId("dust-show").click();
  await expect(table).toContainText("0xEeEe…0005");
  await expect(page.getByTestId(ACCOUNTING)).toHaveText(
    "3 of 3 rows · 3 on book · sort liq_distance ▲",
  );
  await expect(page.getByTestId("dust-disclosure")).toHaveCount(0);
  await expect(page).toHaveURL(/dust=off/);
});

test("empty filtered walk: hidden rows are named as hidden, not absent — dust off reveals them", async ({
  page,
}) => {
  // DERIVED /v1/book: the aave book is ONLY dust — 2 positions, both
  // computed, Σ debt 90000 = $0.0009 at 8 decimals.
  const book = structuredClone(BOOK);
  const agg = book.engines[0];
  if (agg === undefined) throw new Error("fixture shape drifted");
  agg.positions = 2;
  agg.computed_positions = 2;
  agg.refused_positions = 0;
  agg.total_debt = "90000";

  const empty = structuredClone(POSITIONS_AAVE_PAGE_1);
  empty.positions = [];
  empty.total_positions = 0;
  empty.next_cursor = null;

  // The unfiltered walk: exactly the two dust rows the aggregate counts.
  const template = POSITIONS_AAVE_PAGE_1.positions[0];
  if (template === undefined) throw new Error("fixture shape drifted");
  const dustA = structuredClone(template);
  dustA.account = "0xEeEe000000000000000000000000000000000005";
  dustA.total_collateral = "30000";
  dustA.total_debt = "40000";
  const dustB = structuredClone(template);
  dustB.account = "0xFfFf000000000000000000000000000000000006";
  dustB.total_collateral = "20000";
  dustB.total_debt = "50000";
  const dustOnly = structuredClone(POSITIONS_AAVE_PAGE_1);
  dustOnly.positions = [dustA, dustB];
  dustOnly.total_positions = 2;
  dustOnly.next_cursor = null;

  await mockBook(page, book);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("min_value") !== null) return fulfillJson(route, empty);
    return fulfillJson(route, dustOnly);
  });
  await openBook(page);

  // The empty state names the hidden rows and the bound (2 × the step).
  await expect(page.getByText(/no rows at or above the dust step/)).toHaveText(
    "no rows at or above the dust step (1) — 2 rows below it are hidden, not absent · " +
      "Σ debt ≤ 2 · set dust off to see them",
  );
  await expect(page.getByTestId(ACCOUNTING)).toHaveText(
    "0 loaded of 0 qualifying (dust <1) · 2 hidden below step · 2 on book · sort liq_distance ▲",
  );

  // Setting dust off reveals the walk.
  await page.getByTestId("dust-group").getByRole("button", { name: "off", exact: true }).click();
  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xEeEe…0005");
  await expect(table).toContainText("0xFfFf…0006");
  await expect(page.getByTestId(ACCOUNTING)).toHaveText(
    "2 of 2 rows · 2 on book · sort liq_distance ▲",
  );
});

// ---------------------------------------------------------------------------
// (7/8/15) — header sorting, refused-first, the URL mirror.
// ---------------------------------------------------------------------------

test("header sort cycle: canonical → exact reverse → canonical; column switch resets; every change is a new walk", async ({
  page,
}) => {
  const ranked: Array<{ sort: string | null; dir: string | null; cursor: string | null }> = [];
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    ranked.push({
      sort: url.searchParams.get("sort"),
      dir: url.searchParams.get("dir"),
      cursor: url.searchParams.get("cursor"),
    });
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  const liq = table.getByRole("columnheader", { name: "Liq. distance" });
  const debt = table.getByRole("columnheader", { name: "Debt", exact: true });

  // Default: liq_distance ascending — the indicator ONLY on the active column.
  await expect(liq).toHaveAttribute("aria-sort", "ascending");
  await expect(liq).toContainText("▲");
  await expect(debt).not.toHaveAttribute("aria-sort", /.+/);
  await expect(table.locator("thead")).not.toContainText("▼");

  // First click on Debt = ITS canonical direction (desc), dir omitted.
  await table.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(debt).toHaveAttribute("aria-sort", "descending");
  await expect(debt).toContainText("▼");
  await expect(liq).not.toHaveAttribute("aria-sort", /.+/);
  await expect(page).toHaveURL(/sort=debt/);
  await expect.poll(() => page.url()).not.toContain("dir=");

  // Second click reverses — the API dir param is wired.
  await table.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(debt).toHaveAttribute("aria-sort", "ascending");
  await expect(page).toHaveURL(/sort=debt/);
  await expect(page).toHaveURL(/dir=asc/);

  // Third click: TWO-STATE — back to canonical, never an unsorted state.
  await table.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(debt).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => page.url()).not.toContain("dir=");

  // Column switch resets to THAT column's canonical; defaults leave the URL.
  await table.getByRole("button", { name: "Liq. distance" }).click();
  await expect(liq).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => page.url()).not.toContain("sort=");
  await expect.poll(() => page.url()).not.toContain("dir=");

  // The wire saw exactly the cycle, each change restarting from page one.
  await expect
    .poll(() => ranked.filter((request) => request.cursor === null).length)
    .toBe(5);
  const pageOnes = ranked.filter((request) => request.cursor === null);
  expect(pageOnes.map((request) => `${request.sort ?? ""}/${request.dir ?? "-"}`)).toEqual([
    "liq_distance/-",
    "debt/-",
    "debt/asc",
    "debt/-",
    "liq_distance/-",
  ]);
  // Footer names the sort with its direction glyph.
  await expect(page.getByTestId(ACCOUNTING)).toContainText("sort liq_distance ▲");
});

test("refused first: sort=status via the ONE standalone chip — indicators clear, headers exit it", async ({
  page,
}) => {
  const sorts: Array<string | null> = [];
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === null) sorts.push(url.searchParams.get("sort"));
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");

  const chip = page.getByTestId("refused-first-chip");
  await expect(chip).toHaveAttribute(
    "title",
    "sort=status — refused rows ranked first for triage, then risk order",
  );

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  // Header indicators CLEAR: no aria-sort, no glyph anywhere in the head.
  await expect(table.locator("thead [aria-sort]")).toHaveCount(0);
  await expect(table.locator("thead")).not.toContainText("▲");
  await expect(table.locator("thead")).not.toContainText("▼");
  // The footer names the ranking without a direction glyph.
  await expect(page.getByTestId(ACCOUNTING)).toContainText("sort status");
  await expect.poll(() => sorts.at(-1)).toBe("status");

  // Clicking any sortable header EXITS refused-first onto that column's
  // canonical direction.
  await table.getByRole("button", { name: "Debt", exact: true }).click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(table.getByRole("columnheader", { name: "Debt", exact: true })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect.poll(() => sorts.at(-1)).toBe("debt");
});

test("deep links round-trip: non-defaults kept, illegal combos normalized before ANY request, defaults omitted", async ({
  page,
}) => {
  const requests: Array<{ engine: string | null; sort: string | null; dir: string | null; minValue: string | null }> = [];
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    requests.push({
      engine: url.searchParams.get("engine"),
      sort: url.searchParams.get("sort"),
      dir: url.searchParams.get("dir"),
      minValue: url.searchParams.get("min_value"),
    });
    return fulfillJson(route, POSITIONS_DM_PAGE_1);
  });

  // A fully non-default deep link survives verbatim (dir=asc IS the reverse
  // of debt's canonical desc; dust=1k composes 1000 × 10^6 for the DM).
  await openBook(page, "/book?engine=debt_manager&sort=debt&dir=asc&dust=1k");
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  await expect(dmTable).toContainText("0xccCc…0003");
  await expect(dmTable.getByRole("columnheader", { name: "Debt", exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(
    page.getByTestId("dust-group").getByRole("button", { name: "<1k", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/engine=debt_manager/);
  await expect(page).toHaveURL(/sort=debt/);
  await expect(page).toHaveURL(/dir=asc/);
  await expect(page).toHaveURL(/dust=1k/);
  expect(requests.at(-1)).toEqual({
    engine: "debt_manager",
    sort: "debt",
    dir: "asc",
    minValue: "1000000000",
  });
  // The DM view still offers NO hf affordance under header sorting.
  await expect(dmTable.getByRole("button", { name: "Health factor" })).toHaveCount(0);
  await expect(
    dmTable.getByRole("columnheader", { name: "HF — disclosure" }).getByRole("button"),
  ).toHaveCount(0);

  // An illegal combo normalizes CLIENT-SIDE: the doomed request never fires,
  // and replaceState leaves only the non-default engine in the URL.
  requests.length = 0;
  await page.goto("/book?engine=debt_manager&sort=hf&dir=desc&dust=99");
  await expect(dmTable).toContainText("0xccCc…0003");
  await expect(page.getByTestId("sort-remap-ack")).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.sort === "liq_distance" && request.dir === null)).toBe(
    true,
  );
  await expect(page).toHaveURL(/engine=debt_manager/);
  await expect.poll(() => page.url()).not.toContain("sort=");
  await expect.poll(() => page.url()).not.toContain("dir=");
  await expect.poll(() => page.url()).not.toContain("dust=");
});

// ---------------------------------------------------------------------------
// (13) — the sentinel and the windowed DOM.
// ---------------------------------------------------------------------------

test("the sentinel never auto-loads across an error; retry stays the one honest continuation", async ({
  page,
}) => {
  let cursorAttempts = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    cursorAttempts += 1;
    // The FIRST continuation fails server-side; the healed transport serves
    // the terminal page.
    if (cursorAttempts === 1) return fulfillJson(route, FEED_ERROR_INTERNAL, 500);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  // The sentinel fired ONCE into the error; the transport strip renders.
  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  expect(cursorAttempts).toBe(1); // NEVER auto-loaded across the error

  // The retry button is the explicit continuation.
  await page.getByRole("button", { name: "retry" }).click();
  await expect(
    page.getByRole("table", { name: "positions for aave_v3_etherfi" }),
  ).toContainText("0xBbbb…0002");
  await expect(page.getByText("end of pages")).toBeVisible();
  expect(cursorAttempts).toBe(2);
});

test("windowing bounds the DOM: 1,000 loaded rows render as a slice, footer always visible", async ({
  page,
}) => {
  const TOTAL = 1000;
  const PAGE = 200;
  // DERIVED /v1/book: the aave aggregate counts the synthetic 1,000-row book
  // so the accounting has one honest denominator set.
  const book = structuredClone(BOOK);
  const agg = book.engines[0];
  if (agg === undefined) throw new Error("fixture shape drifted");
  agg.positions = TOTAL;
  agg.computed_positions = TOTAL;

  const template = POSITIONS_AAVE_PAGE_1.positions[0];
  if (template === undefined) throw new Error("fixture shape drifted");
  const syntheticPage = (start: number) => {
    const body = structuredClone(POSITIONS_AAVE_PAGE_1);
    body.positions = Array.from({ length: Math.min(PAGE, TOTAL - start) }, (_, index) => {
      const row = structuredClone(template);
      row.account = `0x${(start + index).toString(16).padStart(40, "0")}`;
      return row;
    });
    body.total_positions = TOTAL;
    body.limit = PAGE;
    body.next_cursor = start + PAGE >= TOTAL ? null : `c${String(start + PAGE)}`;
    return body;
  };

  await mockBook(page, book);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    const start = cursor === null ? 0 : Number(cursor.slice(1));
    return fulfillJson(route, syntheticPage(start));
  });
  await openBook(page);

  const accounting = page.getByTestId(ACCOUNTING);
  await expect(accounting).toContainText("200 loaded of 1000 qualifying");

  // Walk to the end: scrolling to the bottom brings the sentinel within its
  // 600px margin and the walk continues (the observer's async cadence may
  // batch a page or two per pass, so the loop scrolls until exhaustion).
  const region = page.getByRole("region", { name: "positions for aave_v3_etherfi — scrollable rows" });
  await expect(async () => {
    await region.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(accounting).toContainText("1000 loaded of 1000 qualifying", { timeout: 700 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("end of pages")).toBeVisible();

  // The DOM is a bounded slice: far fewer rendered rows than loaded rows,
  // spacer rows carrying the scroll geometry.
  const renderedRows = await page
    .locator('table[aria-label="positions for aave_v3_etherfi"] tbody tr')
    .count();
  expect(renderedRows).toBeLessThan(300);
  expect(await page.getByTestId("window-spacer").count()).toBeGreaterThan(0);

  // The footer accounting lives OUTSIDE the scroll region — visible at depth.
  await expect(accounting).toBeVisible();
});

// ---------------------------------------------------------------------------
// (3) — the batch guard, and the /v1/book heal on batch change.
// ---------------------------------------------------------------------------

test("batch mismatch: the hidden count refuses to blend two batches; the surface re-fetches /v1/book once", async ({
  page,
}) => {
  // DERIVED /v1/book: the SAME book on batch #2 while the positions pages
  // stay on batch #1 — a real skew, served by this mock on every fetch so
  // the guard's sentence stays on screen.
  const skewedBook = structuredClone(BOOK);
  skewedBook.batch.id = 2;
  let bookRequests = 0;
  await muteStream(page);
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return fulfillJson(route, skewedBook);
  });
  await mockPositions(page);
  await page.goto("/book");

  await expect(page.getByTestId(ACCOUNTING)).toHaveText(
    "2 loaded of 2 qualifying (dust <1) · hidden count — (aggregate from batch #2, pages " +
      "from batch #1: counts from two batches are never blended) · — on book · sort " +
      "liq_distance ▲",
  );
  // No disclosure span can exist across batches — nothing to subtract.
  await expect(page.getByTestId("dust-disclosure")).toHaveCount(0);

  // The heal fired exactly once (initial + one re-fetch on the reported
  // batch), and a server still serving the old book is not hammered.
  await expect.poll(() => bookRequests).toBe(2);
  await page.waitForTimeout(500);
  expect(bookRequests).toBe(2);
});

// ---------------------------------------------------------------------------
// (micro 2) — partial-view axis unification.
// ---------------------------------------------------------------------------

test("the partial risk map wears the DensityMap's axis vocabulary: debt (usd, log), $-prefixed", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const map = page.getByTestId("book-risk-map");
  const scatter = page.getByRole("img", {
    name: /^risk map for aave_v3_etherfi: debt \(usd, log\) vs liquidation distance$/,
  });
  await expect(scatter).toBeVisible();
  await expect(map).toContainText("debt (usd, log)");
  // $-prefixed labels — the one plottable point's edge label is its rounded
  // exact power ($6,000), never a bare 1e-form.
  await expect(map).toContainText("$6,000");
  await expect(map).not.toContainText("engine unit");
  await expect(map).not.toContainText("log10");
});
