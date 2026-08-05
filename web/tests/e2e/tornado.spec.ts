// W-TN — the TORNADO surface: one batch snapshot × N committed scenarios as
// per-engine diverging impact bars, against mock routes whose bodies are
// GENERATED fixtures (tests/fixtures/generate-run-book-set.mjs documents the
// provenance: the contract's own run-book-set 200 and 503 examples extracted
// verbatim from api/openapi.yaml, plus two documented variants — the
// superseded arm, and the asymmetric ordering / no-denominator / movement
// grammar body). Nothing here is hand-shaped.
//
// What this file pins:
//   - the dispatch names EXPLICIT ids (select-all is a client-side convenience
//     over the listing in hand; the body never carries an implicit all);
//   - one bar per drawable scenario × engine, |ratio| ordering correct, signs
//     diverging, and NO numbers inside the VISUAL — every exact string is in
//     the LEDGER (LAW-5);
//   - DECLARED HOLD and SHOCK DID NOT REACH render with their OWN sentences
//     and no bar rect, and the forbidden "K of K snapped" sentence is absent;
//   - NO DENOMINATOR is a visible state, not empty space, and divides nothing;
//   - the K-of-M movement grammar, incl. the excluded-population clause;
//   - the composed §9.6 header, for still_newest and for the superseded arm;
//   - the ?scenarios= deep link auto-runs against the listing in hand,
//     filtered ids are NAMED, ?scenario=&?scenarios= together run NOTHING,
//     and ?scenarios=* is refused by name;
//   - a bodyless 503 busy settlement fails all N rows at once: a row holding
//     a result keeps it at its own pin with the busy arm named beside it, and
//     a row holding nothing reads UNANSWERED with the same arm named;
//   - §9.5: a row re-run singly onto a newer batch leaves the chart into its
//     own named state, and the header's drawn count moves with it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

/**
 * Mock the set-run POST. The request carries `Content-Type: application/json`,
 * so the browser preflights it; the OPTIONS leg is answered here too. Captured
 * bodies are pushed into `sink` so a test can pin EXACTLY what was named.
 */
async function mockSetRun(
  page: Page,
  body: () => { status: number; body: string },
  sink: string[],
) {
  await page.route(`${API}/v1/scenarios/run-book-set`, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    sink.push(route.request().postData() ?? "");
    const answer = body();
    return json(route, answer.body, answer.status);
  });
}

const SET_200 = () => ({ status: 200, body: fixture("run-book-set.json") });
const SET_VARIANT = () => ({ status: 200, body: fixture("run-book-set.no-denominator.json") });
const SET_SUPERSEDED = () => ({ status: 200, body: fixture("run-book-set.superseded.json") });
const SET_BUSY = () => ({ status: 503, body: fixture("run-book-set.busy.json") });

// The contract example's own header arithmetic: 3 requested, one drawable
// (eth_minus_30), one snap control (no_mark_moved), one identity census
// (all_shocks_declared_at_identity), no absent engines.
const EXAMPLE_HEADER =
  "batch 1 · bars drawn for 1 of 3 requested scenario(s) · shock did not reach: 1 · " +
  "declared no move: 1 · engines named absent rather than drawn: 0";

test("UI picks dispatch ONE POST naming explicit ids; the three reach classes render apart", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab");
  await expect(page.getByTestId("lab-tornado")).toBeVisible();

  // SELECT ALL LISTED is a client-side convenience: the request still names
  // every id explicitly, in listing order, and never carries a wildcard.
  await page.getByTestId("tornado-select-all").click();
  await expect(page.getByTestId("tornado-charge-hint")).toContainText(
    "running 4 charges 4 token(s)",
  );
  await page.getByTestId("tornado-run").click();

  await expect(page.getByTestId("tornado-header")).toHaveText(EXAMPLE_HEADER);
  expect(posts).toEqual([
    JSON.stringify({
      scenario_ids: [
        "eth_minus_30",
        "weeth_market_depeg_oracles_held",
        "dm_rate_horizon_plus_200bps",
        "ethfi_minus_50",
      ],
    }),
  ]);
  expect(posts[0]).not.toContain("*");

  // SHOCK DID NOT REACH: its own sentence, composed from the three
  // `marks_held_by_*` causes — never the flag census, and never "K of K
  // snapped", which is false on this very fixture (3 snapped + 1 base_snapped).
  const noReach = page.locator(
    '[data-testid="tornado-state"][data-state="shock-did-not-reach"]',
  );
  await expect(noReach).toHaveCount(1);
  await expect(noReach).toContainText("SHOCK DID NOT REACH");
  await expect(noReach).toContainText("came back at the value it started at");
  await expect(noReach).toContainText("4 pinned by the stable snap, a snapped base or a bound cap");
  await expect(noReach).not.toContainText(/\d+ of \d+ snapped/);

  // DECLARED HOLD: its OWN sentence — the definition asked for the hold, and
  // the swallowed-move wording never appears under it.
  const hold = page.locator('[data-testid="tornado-state"][data-state="declared-hold"]');
  await expect(hold).toHaveCount(1);
  await expect(hold).toContainText("DECLARED HOLD");
  await expect(hold).toContainText("BY DECISION rather than by accident");
  await expect(hold).toContainText("no move is asserted");
  await expect(hold).not.toContainText("came back at the value it started at");

  // Neither structurally-zero class draws a bar rect, anywhere, at any length.
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="stable_depeg_0995_in_band"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="dm_composition_census"]'),
  ).toHaveCount(0);

  // The drawable scenario: one panel per engine, never one axis across. The
  // aave panel draws its bar; the dm panel's delta is a TRUE measured zero, so
  // it draws NO ink and says it was measured.
  const aavePanel = page.getByTestId("tornado-panel-aave_v3_etherfi");
  await expect(aavePanel.getByTestId("tornado-panel-unit")).toContainText("usd_decimals 8");
  const aaveBar = aavePanel.locator('[data-testid="tornado-bar"]');
  await expect(aaveBar).toHaveCount(1);
  await expect(aaveBar).toHaveAttribute("data-scenario-id", "eth_minus_30");
  await expect(aaveBar).toHaveAttribute("data-negative", "false");

  const dmPanel = page.getByTestId("tornado-panel-debt_manager");
  await expect(dmPanel.getByTestId("tornado-panel-unit")).toContainText("usd_decimals 6");
  await expect(dmPanel.locator('[data-testid="tornado-bar"]')).toHaveCount(0);
  await expect(dmPanel.getByTestId("tornado-zero-bar")).toContainText("measured zero");

  // LEDGER (LAW-5): the exact strings, unrounded, for every scenario × engine
  // row — including the K-of-M movement grammar.
  const aaveRow = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="aave_v3_etherfi"]',
  );
  await expect(aaveRow).toContainText("+$6,000");
  await expect(aaveRow).toContainText("$6,000");
  await expect(aaveRow).toContainText("1 of 1 health factors strictly dropped.");
  await expect(aaveRow).toContainText("every_mark_moved");

  const controlRow = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="stable_depeg_0995_in_band"][data-engine="debt_manager"]',
  );
  await expect(controlRow).toContainText("$0");
  await expect(controlRow).toContainText("0 of 1 accounts flipped into eligibility.");
  await expect(controlRow).toContainText("no_mark_moved");
  await expect(controlRow).toContainText(
    "4 pinned by the stable snap, a snapped base or a bound cap",
  );

  await expect(page.getByTestId("tornado-method")).toContainText("One axis per engine");
});

test("?scenarios= rides the listing arrival: one POST, only published ids, filtered ids NAMED", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab?scenarios=eth_minus_30,stable_depeg_0995_in_band,nope_id");

  await expect(page.getByTestId("tornado-header")).toBeVisible();
  expect(posts).toEqual([JSON.stringify({ scenario_ids: ["eth_minus_30"] })]);

  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("You asked for 3 scenario(s)");
  await expect(notice).toContainText("this deployment publishes 1 of them");
  await expect(notice).toContainText("stable_depeg_0995_in_band and nope_id");

  // §9.6 — the filtered ids ride the composed header too.
  await expect(page.getByTestId("tornado-header")).toContainText(
    "filtered from the deep link, not published here: stable_depeg_0995_in_band, nope_id",
  );
});

test("?scenario= AND ?scenarios= together run NOTHING and render the named notice", async ({
  page,
}) => {
  const posts: string[] = [];
  let singleRuns = 0;
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    singleRuns += 1;
    return route.abort();
  });

  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");

  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("both ?scenario= and ?scenarios=");
  await expect(notice).toContainText("NOTHING was run");
  await expect(notice).toContainText("no precedence is guessed");
  expect(posts).toEqual([]);
  expect(singleRuns).toBe(0);
});

test("?scenarios=* is refused by name and dispatches nothing", async ({ page }) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_200, posts);

  await page.goto("/lab?scenarios=*");

  const notice = page.getByTestId("tornado-deeplink-notice");
  await expect(notice).toContainText("A * is never expanded");
  await expect(notice).toContainText("Nothing was dispatched");
  expect(posts).toEqual([]);
});

test("ordering, sign, NO DENOMINATOR and the excluded-population grammar (asymmetric variant)", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);

  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("tornado-header")).toContainText(
    "bars drawn for 2 of 2 requested scenario(s)",
  );

  // THE DM PANEL: two bars, sorted by |ratio| DESC (0.5 above 0.25) — the
  // REVERSE of request order, so a renderer that kept request order fails —
  // with the negative bar on the left of the axis.
  const dmBars = page
    .getByTestId("tornado-panel-debt_manager")
    .locator('[data-testid="tornado-bar"]');
  await expect(dmBars).toHaveCount(2);
  await expect(dmBars.nth(0)).toHaveAttribute("data-scenario-id", "ethfi_minus_50");
  await expect(dmBars.nth(0)).toHaveAttribute("data-negative", "false");
  await expect(dmBars.nth(1)).toHaveAttribute("data-scenario-id", "eth_minus_30");
  await expect(dmBars.nth(1)).toHaveAttribute("data-negative", "true");
  const widthOf = async (i: number) =>
    Number.parseFloat((await dmBars.nth(i).getAttribute("width")) ?? "0");
  expect(await widthOf(0)).toBeGreaterThan(await widthOf(1));
  // 0.5 against 0.25 on one panel scale: exactly twice as long.
  expect(await widthOf(0)).toBeCloseTo((await widthOf(1)) * 2, 5);

  // THE AAVE PANEL: an answered engine whose before-side debt is "0" is the
  // NO DENOMINATOR state — visibly a state, never a bar and never a division.
  const noDenominator = page.getByTestId("tornado-no-denominator");
  await expect(noDenominator).toHaveCount(1);
  await expect(noDenominator).toContainText("NO DENOMINATOR");
  await expect(noDenominator).toContainText("no debt on the before side");
  await expect(
    page
      .getByTestId("tornado-panel-aave_v3_etherfi")
      .locator('[data-testid="tornado-bar"]'),
  ).toHaveCount(0);

  // The movement grammar, both halves: the plain K of M, and the
  // excluded-population clause on the debt-free aave account.
  const aaveLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="aave_v3_etherfi"]',
  );
  await expect(aaveLedger).toContainText("0 of 0 health factors strictly dropped.");
  await expect(aaveLedger).toContainText(
    "1 of the 1 measured accounts could not be tested for movement at all",
  );
  const dmLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"][data-engine="debt_manager"]',
  );
  await expect(dmLedger).toContainText("0 of 2 accounts flipped into eligibility.");
  await expect(dmLedger).toContainText("−$1,050");
  const ethfiLedger = page.locator(
    '[data-testid="tornado-ledger-row"][data-scenario-id="ethfi_minus_50"][data-engine="debt_manager"]',
  );
  await expect(ethfiLedger).toContainText("1 of 2 accounts flipped into eligibility.");
  await expect(ethfiLedger).toContainText("+$2,100");

  // The left-clip guard, same law the waterfall ticks carry: every row label
  // renders WHOLE. The gutter is sized from a probe that must measure the
  // label class's own letter-spacing; an under-measured gutter renders
  // "eth_minus_60" as ":th_minus_60" and this bbox check is what fails on it.
  const labelBoxes = await page
    .getByTestId("tornado-panel-debt_manager")
    .locator('text[data-testid="tornado-bar-label"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const text = node as unknown as SVGTextElement;
        return { label: text.textContent ?? "", x: text.getBBox().x };
      }),
    );
  expect(labelBoxes.length).toBeGreaterThan(0);
  for (const box of labelBoxes) {
    expect(box.x, `row label clips left: ${box.label}`).toBeGreaterThanOrEqual(0);
  }
});

test("the superseded arm: the header names the newer batch and the SET re-run affordance is live", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_SUPERSEDED, posts);

  await page.goto("/lab?scenarios=eth_minus_30");

  const header = page.getByTestId("tornado-header");
  await expect(header).toContainText("batch 2 has since materialized");
  await expect(header).toContainText("re-run the set to move onto it");
  await expect(page.getByTestId("tornado-rerun-set")).toBeEnabled();

  // And re-running the set re-POSTs the SAME explicit ids.
  await page.getByTestId("tornado-rerun-set").click();
  await expect
    .poll(() => posts.length, { message: "the set re-run affordance dispatches" })
    .toBe(2);
  expect(posts[1]).toBe(posts[0]);
});

test("a bodyless 503 busy settlement fails all N rows at once, each naming the BUSY arm", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_BUSY, posts);
  await page.route(`${API}/v1/scenarios/eth_minus_30/run-book`, (route) =>
    json(route, fixture("run-book.eth_minus_30.json")),
  );

  await page.goto("/lab");

  // First, a single run gives eth_minus_30 a held result at its own pin.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  await expect(
    page
      .locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]')
      .locator('[data-cell-state="result"]')
      .first(),
  ).toBeVisible();

  // Then the set-run over TWO rows settles bodyless: 503 set_run_busy.
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="eth_minus_30"]').check();
  await page.locator('[data-testid="tornado-pick"][data-scenario-id="ethfi_minus_50"]').check();
  await page.getByTestId("tornado-run").click();

  // The set level names the arm: capacity, not the book, not a rate.
  const busy = page.getByTestId("tornado-busy");
  await expect(busy).toContainText("SERVICE BUSY (503 set_run_busy)");
  await expect(busy).toContainText("max_in_flight 2 · in_flight 2");
  await expect(busy).toContainText("about nothing in the book");
  await expect(busy).toContainText("All 2 row(s) of this set settled without a body");

  // The row that HELD a result keeps it, at its own pin, with the settlement
  // named beside it (R8 + R16): the cells still show the measurement.
  const ethRow = page.locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]');
  await expect(ethRow.locator('[data-cell-state="result"]').first()).toBeVisible();
  const ethBanner = page.locator(
    '[data-testid="matrix-rerun-failed"][data-scenario-id="eth_minus_30"]',
  );
  await expect(ethBanner).toContainText("SERVICE BUSY (503 set_run_busy)");
  await expect(ethBanner).toContainText("The cells still show what this row already measured");

  // The row that held NOTHING reads UNANSWERED — never a zero — with the SAME
  // arm named, so one settlement gets one account on every row it touched.
  const ethfiCell = page
    .locator('[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"]')
    .locator('[data-cell-state="unanswered"]')
    .first();
  await expect(ethfiCell).toBeVisible();
  await expect(ethfiCell).toContainText("SERVICE BUSY (503 set_run_busy)");

  expect(posts).toHaveLength(1);
});

test("§9.5: a row re-run singly onto a NEWER batch leaves the chart into its own named state", async ({
  page,
}) => {
  const posts: string[] = [];
  await mockCold(page);
  await mockSetRun(page, SET_VARIANT, posts);
  // The committed batch-2 variant of the same scenario: the single re-run
  // lands on a newer batch than the set's batch 1.
  await page.route(`${API}/v1/scenarios/eth_minus_30/run-book`, (route) =>
    json(route, fixture("run-book.eth_minus_30.batch2.json")),
  );

  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("tornado-header")).toContainText(
    "bars drawn for 2 of 2 requested scenario(s)",
  );

  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();

  // The row leaves the chart into its own named state, with its own batch id
  // and the SET re-run affordance — never drawn shorter or greyer beside the
  // others — and the header's drawn count moves with it.
  const pulled = page.locator(
    '[data-testid="tornado-state"][data-state="pinned-elsewhere"]',
  );
  await expect(pulled).toHaveCount(1);
  await expect(pulled).toContainText("eth_minus_30 is not drawn");
  await expect(pulled).toContainText("batch #2");
  await expect(pulled).toContainText("Re-run the SET");
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="eth_minus_30"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tornado-bar"][data-scenario-id="ethfi_minus_50"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("tornado-header")).toContainText(
    "bars drawn for 1 of 2 requested scenario(s)",
  );
});
