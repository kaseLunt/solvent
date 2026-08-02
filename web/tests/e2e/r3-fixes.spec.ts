// WAVE R3 (Codex round-10) e2e — the three findings, pinned in the browser
// against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, finding by finding:
//   (1) HIGH   — a liquidation bonus renders the PREMIUM it grants, not its
//                raw encoding read as a percentage. Aave publishes a
//                par-based MULTIPLIER in bps (10500 = 1.05x = 5%); the Debt
//                Manager publishes the premium itself on its 100e18 scale.
//                The REAL wire values 10500 and 10600 are the inputs — the
//                round-10 note is that the old unit pin used `500`, a number
//                the Aave wire never publishes, which is how "105%" survived.
//   (2) MEDIUM — the batch age is ANCHORED at receipt and ADVANCES while the
//                page is open, and the LIVE ribbon's 1h stale-batch suffix
//                ENGAGES on the crossing rather than testing a frozen number.
//                Driven by Playwright's clock, which fakes `performance` —
//                the same monotonic source lib/freshness.ts reads.
//   (3) MEDIUM — the RENDERED legend speaks of REACHABILITY, not of movement,
//                so it no longer contradicts the outside-collateral-covers
//                hover sitting beneath it.

import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";
import {
  ADDRESS_FOUND,
  EVENTS,
  FOUND_ADDR,
  HISTORY,
  PARAMS,
} from "../fixtures/inspector";

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

async function openBookWith(page: Page, positions: unknown, book: unknown = BOOK): Promise<void> {
  await page.route("**/v1/book", (route) => fulfillJson(route, book));
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : positions);
  });
  await page.goto("/book");
}

async function mockInspector(page: Page, address: unknown, history: unknown = HISTORY) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: history as object, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) =>
    route.fulfill({ json: address as object, headers: CORS }),
  );
}

// ---------------------------------------------------------------------------
// (1) HIGH — the liquidation bonus is a PAR-BASED MULTIPLIER on Aave.
// ---------------------------------------------------------------------------

test("(1) THE ROUND-10 DEFECT: Aave's 10500 renders a 5% PREMIUM, never `105%`", async ({
  page,
}) => {
  // No mutation: the COMMITTED fixture already carries the live deployment's
  // own Aave leg — liq_threshold 8100, liq_bonus 10500. That is precisely the
  // value the old formatter rendered as "105%".
  await mockInspector(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-aave_v3_etherfi").first();
  await expect(params).toContainText("LT 81% · bonus 5%");
  // The raw multiplier is DISCLOSED, in the denomination-disclosure grammar.
  await expect(params).toContainText("(multiplier 10500 bps · 1e4 scale)");
  // The lie, named: a liquidator collects a 5% premium, not 105%.
  await expect(params).not.toContainText("bonus 105%");
});

test("(1) a 10600 multiplier is a 6% premium — the second REAL wire value", async ({ page }) => {
  // DERIVED /v1/address: the Aave leg's liq_bonus 10500 → 10600. No other
  // byte changes.
  const body = structuredClone(ADDRESS_FOUND);
  const leg = body.positions[0]?.legs[0];
  if (leg === undefined) throw new Error("fixture shape drifted");
  leg.liq_bonus = "10600";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-aave_v3_etherfi").first();
  await expect(params).toContainText("LT 81% · bonus 6%");
  await expect(params).toContainText("(multiplier 10600 bps · 1e4 scale)");
  await expect(params).not.toContainText("bonus 106%");
});

test("(1) the DM bonus is NOT par-based — its premium is the wire value itself", async ({
  page,
}) => {
  // DERIVED /v1/address: the DM leg gains the live deployment's own params —
  // LT 95e18 and bonus 3.5e18 on the Debt Manager's 100e18 percent scale.
  // cmd/api/fixture_test.go:137 states the encoding: `1e18 additive => 1%`.
  const body = structuredClone(ADDRESS_FOUND);
  const leg = body.positions[1]?.legs[0];
  if (leg === undefined) throw new Error("fixture shape drifted");
  leg.liq_threshold = "95000000000000000000";
  leg.liq_bonus = "3500000000000000000";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-debt_manager").first();
  // A par subtraction here would be the mirror-image lie: 3.5%, not 3.5% − 100%.
  await expect(params).toContainText("LT 95% · bonus 3.5%");
  await expect(params).toContainText("(premium 3500000000000000000 · 100e18 scale)");
  // And the DM's raw is never dressed as a multiplier.
  await expect(params).not.toContainText("multiplier");
});

// ---------------------------------------------------------------------------
// (2) MEDIUM — the age is anchored, and the ribbon's threshold ENGAGES.
// ---------------------------------------------------------------------------

test("(2) the Book's age ADVANCES across the hour while the page sits open", async ({ page }) => {
  // Playwright's clock fakes `performance` — the same monotonic source the
  // anchor reads. Installed BEFORE navigation, per the harness's own guidance.
  await page.clock.install();
  await muteStream(page);

  // DERIVED /v1/book: the batch is 3550s old — 59m, fifty seconds inside the
  // hour. No other byte changes.
  const nearHour = structuredClone(BOOK);
  nearHour.batch.age_seconds = 3550;
  await openBookWith(page, POSITIONS_AAVE_PAGE_1, nearHour);

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 59m ago");

  // One tick of a tab left open, and the sentence has MOVED — the timestamp
  // has not.
  await page.clock.fastForward(60_000);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 0m ago");
  await expect(page.getByTestId("book-stamp-freshness")).toHaveText(
    "#1 · computed 2026-07-29T10:00:00Z · 1h 0m ago",
  );

  // Ten more minutes, still climbing — it never re-freezes.
  await page.clock.fastForward(10 * 60_000);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 10m ago");
});

test("(2) THE RIBBON ENGAGES: the stale-batch suffix appears on the crossing", async ({ page }) => {
  await page.clock.install();

  // DERIVED stream snapshot: the posture batch is 3550s old — fifty seconds
  // inside the ribbon's 1h threshold, so the suffix is correctly SILENT at
  // receipt. No other byte changes.
  const nearHour = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (nearHour.batch === null || nearHour.batch === undefined) {
    throw new Error("fixture shape drifted");
  }
  nearHour.batch.age_seconds = 3550;
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: `event: snapshot\ndata: ${JSON.stringify(nearHour)}\n\n`,
    }),
  );
  await openBookWith(page, POSITIONS_AAVE_PAGE_1);

  const header = page.getByRole("banner");
  await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
  // Inside the threshold: nothing rendered, and the absence is not a claim.
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);

  // The batch really does become an hour old while the tab is open, and the
  // ribbon now says so — the defect was that it never could.
  await page.clock.fastForward(60_000);
  await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 1h old");
  // LIVE still describes the STREAM: two subjects, two statements, both true.
  await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
});

// ---------------------------------------------------------------------------
// (3) MEDIUM — the rendered legend, over an outside-collateral-covers row.
// ---------------------------------------------------------------------------

/**
 * DERIVED /v1/positions page 1: the aave row's `liq_distance` becomes the
 * `never` kind carrying the solver's "collateral outside the factor already
 * covers the debt at threshold" reason — the exact wire shape
 * internal/risk/liqprice.go publishes. No other byte changes.
 */
function aavePageWithOutsideCovers() {
  const page1 = structuredClone(POSITIONS_AAVE_PAGE_1);
  const row = page1.positions[0];
  if (row === undefined) throw new Error("fixture shape drifted");
  row.liq_distance = {
    kind: "never",
    scale_factor_num: null,
    scale_factor_den: null,
    factor_asset: null,
    reason: "collateral outside the factor already covers the debt at threshold",
  } as (typeof row)["liq_distance"];
  page1.next_cursor = null;
  return page1;
}

test("(3) the legend states REACHABILITY, and stops contradicting the covers hover", async ({
  page,
}) => {
  await muteStream(page);
  await openBookWith(page, aavePageWithOutsideCovers());

  // The rendered legend, verbatim.
  await expect(page.getByTestId("no-price-path-legend")).toHaveText(
    "no price path = no downward move along the committed price axis reaches liquidation for " +
      "this account — interest or a parameter change can still cross; the HF column stays the " +
      "verdict.",
  );

  // THE DEFECT, named: for THIS row the shocked collateral does move — it is
  // simply covered. A legend claiming nothing moves it was false on the page
  // it was rendered on.
  await expect(page.getByTestId("no-price-path-legend")).not.toContainText(
    "moves this account's collateral",
  );

  // The hover is reason-specific and UNCHANGED — the legend now agrees with it.
  const cell = page
    .getByRole("table", { name: "positions for aave_v3_etherfi" })
    .getByText("no price path", { exact: true });
  await expect(cell).toHaveAttribute(
    "title",
    "Collateral outside the shocked asset already covers the debt at the liquidation " +
      "threshold — no fall of the shocked asset alone reaches the boundary; interest or " +
      "parameter changes still can. Wire: 'collateral outside the factor already covers the " +
      "debt at threshold'.",
  );
});
