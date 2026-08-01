// Book surface (W1) e2e — MOCKED API via route interception. Every body
// served here comes from tests/fixtures/book.ts (generated from the contract
// and the contract-validated client fixtures — see generate-book.mjs's
// provenance record; nothing hand-shaped).
//
// Asserted laws (task brief):
//   - stat rows render from the fixture, per engine, never combined;
//   - refused rows are VISIBLE inline with their named reason;
//   - a withheld engine's bad debt is an em dash + reason, never 0;
//   - histograms are per-engine, each on its own comparator, refused/∞ counts
//     beside the buckets;
//   - a waterfall monotonicity violation renders a warning strip naming the
//     offending grid point (and does NOT render when the series is monotone);
//   - 409 BATCH_SUPERSEDED shows a one-line notice and restarts from page one;
//   - the warn-band disclosure is present at table and legend level;
//   - Lab sits in the PRIMARY nav register;
//   - NO SERVABLE BATCH renders the refusal honestly, never a book of zeroes.

import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BATCH_SUPERSEDED,
  BOOK,
  BOOK_ENGINE_REFUSED,
  BOOK_ERROR_BAD_REQUEST,
  BOOK_ERROR_UNAVAILABLE,
  BOOK_MONOTONICITY_VIOLATION,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

/** The ruling's acknowledgment copy, verbatim (W-UX-B part 9). */
const SORT_REMAP_ACK =
  'sort "hf" is not defined for debt_manager — reset to liq_distance. The Debt Manager ' +
  "publishes a strict liquidatable boolean, not a health factor.";

const HF_DISCLOSURE_TITLE =
  "maxBorrowLT/borrowings — a disclosure only; the verdict is the engine's strict boolean";

const WARN_DISCLOSURE = "presentation band < 1.1 — not an engine threshold";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The SSE stream is not under test here; the ribbon states its own truth. */
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

async function openBook(page: Page): Promise<void> {
  await muteStream(page);
  await page.goto("/book");
}

test("stat rows render from the fixture — one block per engine, never combined", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const aave = page.getByTestId("book-stats-aave_v3_etherfi");
  await expect(aave).toBeVisible();
  await expect(aave).toContainText("8,000"); // 800000000000 @ 8 dec, exact
  await expect(aave).toContainText("2 positions · 1 computed · 1 refused · 1 flagged");
  await expect(aave).toContainText("1/2 positions counted"); // the coverage denominator
  await expect(aave).toContainText("G1 ×1"); // refusals named, counted

  const dm = page.getByTestId("book-stats-debt_manager");
  await expect(dm).toBeVisible();
  await expect(dm).toContainText("4,200"); // 4200000000 @ 6 dec, exact
  await expect(dm).toContainText("SWEEP_NEVER ×1");

  // Engines stay separate: no blended total anywhere (8,000 + 4,200 = 12,200
  // must not exist on this page in any unit).
  await expect(page.locator("body")).not.toContainText("12,200");
});

test("refused position rows are visible inline with their named reason", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001"); // page 1: the computed row
  await expect(table.getByRole("row")).toHaveCount(2); // header + 1 row

  await page.getByRole("button", { name: "LOAD MORE" }).click();

  // Page 2's refused row is a ROW: visible, tinted, named — never filtered.
  await expect(table).toContainText("0xBbbb…0002");
  await expect(table).toContainText("REFUSED · G1");
  // Its totals are em dashes, never zeros.
  const refusedRow = table.getByRole("row").filter({ hasText: "0xBbbb…0002" });
  await expect(refusedRow).toContainText("—");
  await expect(refusedRow).not.toContainText("$0");
  await expect(page.getByText("end of pages")).toBeVisible();
  await expect(page.getByText("2 of 2 rows")).toBeVisible();
});

test("the DM engine page: crit only from the strict boolean; refused row named", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await page.getByRole("button", { name: "debt_manager" }).click();
  const table = page.getByRole("table", { name: "positions for debt_manager" });

  const critRow = table.getByRole("row").filter({ hasText: "0xccCc…0003" });
  await expect(critRow).toContainText("0.761"); // the num/den DISCLOSURE
  await expect(critRow).toContainText("liquidatable"); // the engine's own verdict
  await expect(critRow).toContainText("S @154,796,500"); // the sweep mark

  const refusedRow = table.getByRole("row").filter({ hasText: "0xddDD…0004" });
  await expect(refusedRow).toContainText("REFUSED · SWEEP_NEVER");
  await expect(refusedRow).toContainText("S ∅"); // the absent sweep, visible
});

test("null bad debt renders an em dash with its reason — never 0", async ({ page }) => {
  await mockBook(page, BOOK_ENGINE_REFUSED);
  await mockPositions(page);
  await openBook(page);

  const withheld = page.getByTestId("bad-debt-aave_v3_etherfi");
  await expect(withheld).toContainText("—");
  await expect(withheld).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(withheld).not.toContainText("$0");

  // The served engine still shows its real census beside it.
  await expect(page.getByTestId("bad-debt-debt_manager")).toContainText("$239.603961");

  // The withheld engine is unmissable at the top of the surface too.
  await expect(page.getByTestId("book-refused-engines")).toContainText("aave_v3_etherfi");
  // Its stat block renders em dashes, not zeros.
  const aaveStats = page.getByTestId("book-stats-aave_v3_etherfi");
  await expect(aaveStats).toContainText("withheld — not zero");
});

test("HF histograms are per engine, each on its OWN comparator, counts beside buckets", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const aave = page.getByTestId("book-histogram-aave_v3_etherfi");
  const dm = page.getByTestId("book-histogram-debt_manager");
  await expect(aave).toBeVisible();
  await expect(dm).toBeVisible();
  await expect(aave).toContainText("comparator: hf_wad");
  await expect(dm).toContainText("comparator: hf_num/hf_den");
  // refused / infinite counts are rendered BESIDE the buckets, per engine.
  await expect(aave).toContainText("refused 1");
  await expect(aave).toContainText("∞ no-debt 0");
  await expect(dm).toContainText("refused 1");
  // The DM's disclosure-only note stays visible.
  await expect(dm).toContainText("a disclosure only");
});

test("a monotone waterfall renders NO violation strip; held_flat and projection do render", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("book-waterfall-debt_manager")).toBeVisible();
  await expect(page.getByTestId("waterfall-monotonicity")).toHaveCount(0);
  await expect(page.getByText("PROJECTION", { exact: true })).toBeVisible();

  const heldFlat = page.getByTestId("waterfall-held-flat");
  await expect(heldFlat).toContainText("0xA0b8…eB48"); // the held-flat USDC input
  // W-UX-D caption (a): the counted-disclosure pattern — always-visible
  // summary + "held flat — {n} inputs named" (the deeper copy pins live in
  // book-charts.spec.ts).
  await expect(heldFlat).toContainText("1 price inputs held flat");
  await expect(heldFlat).toContainText("held flat — 1 inputs named");
});

test("a waterfall monotonicity violation is SURFACED, naming the offending point", async ({ page }) => {
  await mockBook(page, BOOK_MONOTONICITY_VIOLATION);
  await mockPositions(page);
  await openBook(page);

  const strip = page.getByTestId("waterfall-monotonicity");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("MONOTONICITY VIOLATION");
  await expect(strip).toContainText("debt_manager");
  await expect(strip).toContainText("#2");
  await expect(strip).toContainText("fell from 4200000000 to 4100000000");
});

test("409 BATCH_SUPERSEDED: a visible notice and an honest restart from page one", async ({ page }) => {
  let pageOneRequests = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === null) {
      pageOneRequests += 1;
      return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    }
    return fulfillJson(route, BATCH_SUPERSEDED, 409);
  });
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");
  expect(pageOneRequests).toBe(1);

  await page.getByRole("button", { name: "LOAD MORE" }).click();

  const notice = page.getByTestId("batch-superseded-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("BATCH SUPERSEDED");
  await expect(notice).toContainText("batch 1 was superseded by batch 2");
  await expect(notice).toContainText("restarted from page one");

  // The walk actually restarted: page one was fetched again and the rows are
  // the fresh first page — never a page mixing two materializations.
  await expect(table).toContainText("0xAAaA…0001");
  await expect.poll(() => pageOneRequests).toBe(2);
});

test("the warn-band disclosure is carried at table and legend level", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("positions-warn-disclosure")).toContainText(WARN_DISCLOSURE);
  await expect(page.getByTestId("risk-map-warn-disclosure")).toContainText(WARN_DISCLOSURE);

  // The risk map is bounded and says so: what's loaded, of the batch total.
  await expect(page.getByTestId("book-risk-map")).toContainText("1 loaded / 2 total");
});

test("Lab rides the PRIMARY nav register (design ruling)", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const nav = page.getByRole("navigation", { name: "app surfaces" });
  await expect(nav.getByRole("link")).toHaveText([
    "Book",
    "Inspector",
    "Lab",
    "Observatory",
    "Feed",
    "Proof",
    "Developers",
  ]);
});

test("NO SERVABLE BATCH renders the refusal honestly — never a book of zeroes", async ({ page }) => {
  await mockBook(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.route("**/v1/positions*", (route) => fulfillJson(route, BOOK_ERROR_UNAVAILABLE, 503));
  await openBook(page);

  const noBatch = page.getByTestId("book-no-batch");
  await expect(noBatch).toBeVisible();
  await expect(noBatch).toContainText("NO SERVABLE BATCH");
  await expect(noBatch).toContainText("statement about the SERVICE");

  // The positions table refuses honestly — the refusal register with the
  // server's message VERBATIM and its own retry instruction; NO retry button
  // (a 503 is the service's statement, not a transport accident to hammer).
  const refusal = page.getByTestId("positions-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("REFUSED · unavailable");
  await expect(refusal).toContainText("no complete risk batch is available");
  await expect(refusal).toContainText("retry after 5s");
  await expect(refusal.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toHaveCount(0);
  // No aggregate zeroes appear anywhere on the degraded surface.
  await expect(page.getByTestId("book-stats-aave_v3_etherfi")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// W-UX-B — per-engine sort vocabulary, deep-link normalization, refusal
// rendering (the design ruling's part B, verbatim).
// ---------------------------------------------------------------------------

test("the DM view never OFFERS hf — not in the sort control, not as a header", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  // Aave offers the full contract enum, hf included.
  await expect(page.getByRole("button", { name: "hf", exact: true })).toBeVisible();
  const aaveTable = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(aaveTable.getByRole("columnheader", { name: "Health factor" })).toBeVisible();

  await page.getByRole("button", { name: "debt_manager" }).click();

  // The hf control is GONE — not disabled, not present.
  await expect(page.getByRole("button", { name: "hf", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "liq_distance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "debt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "status", exact: true })).toBeVisible();

  // The DM header reads the disclosure, carries the title, and is NOT
  // clickable/sortable-looking (no button, no link inside the header cell).
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  const header = dmTable.getByRole("columnheader", { name: "HF — disclosure" });
  await expect(header).toBeVisible();
  await expect(header.locator("span")).toHaveAttribute("title", HF_DISCLOSURE_TITLE);
  await expect(header.locator("button, a")).toHaveCount(0);
  await expect(dmTable.getByRole("columnheader", { name: "Health factor" })).toHaveCount(0);
});

test("engine switch while sort=hf remaps to liq_distance — acknowledgment, ZERO doomed requests", async ({ page }) => {
  let doomed = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("engine") === "debt_manager" && url.searchParams.get("sort") === "hf") {
      doomed += 1;
      return fulfillJson(route, BOOK_ERROR_BAD_REQUEST, 400);
    }
    if (url.searchParams.get("engine") === "debt_manager") return fulfillJson(route, POSITIONS_DM_PAGE_1);
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  // Arm the defect: aave + hf is a legal pair.
  await page.getByRole("button", { name: "hf", exact: true }).click();
  await expect(page.getByRole("button", { name: "hf", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "debt_manager" }).click();

  // The remap happened: liq_distance is active and the DM page rendered.
  await expect(page.getByRole("button", { name: "liq_distance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  await expect(dmTable).toContainText("0xccCc…0003");

  // The acknowledgment: static, dim, in the controls region — NOT the loud
  // notice slot (that register is reserved for supersession), NOT a toast.
  const ack = page.getByTestId("sort-remap-ack");
  await expect(ack).toBeVisible();
  await expect(ack).toHaveText(SORT_REMAP_ACK);
  await expect(page.getByTestId("batch-superseded-notice")).toHaveCount(0);

  // The doomed request NEVER fired.
  expect(doomed).toBe(0);

  // It clears on the next sort/engine interaction.
  await page.getByRole("button", { name: "debt", exact: true }).click();
  await expect(page.getByTestId("sort-remap-ack")).toHaveCount(0);
});

test("?engine=debt_manager&sort=hf normalizes BEFORE the first fetch — zero 400s, URL rewritten", async ({ page }) => {
  let doomed = 0;
  const sortsRequested: Array<string | null> = [];
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    sortsRequested.push(url.searchParams.get("sort"));
    if (url.searchParams.get("engine") === "debt_manager" && url.searchParams.get("sort") === "hf") {
      doomed += 1;
      return fulfillJson(route, BOOK_ERROR_BAD_REQUEST, 400);
    }
    return fulfillJson(route, POSITIONS_DM_PAGE_1);
  });
  await muteStream(page);
  await page.goto("/book?engine=debt_manager&sort=hf");

  // The DM book rendered from the NORMALIZED walk, acknowledgment shown.
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  await expect(dmTable).toContainText("0xccCc…0003");
  const ack = page.getByTestId("sort-remap-ack");
  await expect(ack).toBeVisible();
  await expect(ack).toHaveText(SORT_REMAP_ACK);

  // The doomed request NEVER fired; every fetch carried the remapped sort.
  expect(doomed).toBe(0);
  expect(sortsRequested.length).toBeGreaterThan(0);
  expect(sortsRequested).toEqual(sortsRequested.map(() => "liq_distance"));

  // history.replaceState fixed the deep link — the URL no longer carries hf.
  await expect(page).toHaveURL(/sort=liq_distance/);
  await expect(page).toHaveURL(/engine=debt_manager/);
  expect(page.url()).not.toContain("sort=hf");
});

test("a 4xx renders the refusal register — envelope code, verbatim message, NO retry button", async ({ page }) => {
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => fulfillJson(route, BOOK_ERROR_BAD_REQUEST, 400));
  await openBook(page);

  const refusal = page.getByTestId("positions-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("REFUSED · bad_request");
  // The API's sentence VERBATIM (the fixture envelope's own message)…
  await expect(refusal).toContainText(BOOK_ERROR_BAD_REQUEST.error.message);
  // …plus the ruling's trailing copy.
  await expect(refusal).toContainText(
    "adjust the controls; retrying the identical request cannot succeed.",
  );
  // NO retry button anywhere in the refusal register, and no transport strip.
  await expect(refusal.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "retry" })).toHaveCount(0);
  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toHaveCount(0);
});

test("a network failure keeps the transport strip WITH retry — the one honest retry", async ({ page }) => {
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => route.abort());
  await openBook(page);

  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "retry" });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("positions-refusal")).toHaveCount(0);

  // And the retry is honest: once the transport heals, it loads the page.
  await page.unroute("**/v1/positions*");
  await mockPositions(page);
  await retry.click();
  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");
});
