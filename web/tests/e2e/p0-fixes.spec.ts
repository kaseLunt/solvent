// Phase 0 (UI-overhaul trust fixes) — the render-consequence pins, one
// section per fix, each tagged p0-N:
//   p0-1 · address-bound stress results: a settled Lab stress result binds to
//         phase.addr — editing the input raises a stale barrier naming the OLD
//         address and hides the result body; retyping the exact address
//         restores it (pure derivation, no data destruction).
//
//   p0-2 · outcome-aware matrix cells: a settled scenario×engine cell renders
//         EVERY nonzero outcome dimension (newly eligible, Δ eligible debt,
//         Δ bad debt, execution shortfall) in its sub-line, and an all-zero
//         engine says "no effective movement" — bad debt and shortfall can no
//         longer hide behind a $0 eligible-debt delta.
//
//   p0-3 · health boundary price: the Inspector's boundary row names HEALTH —
//         the number is the price at which the position is still healthy, not
//         a liquidation trigger — carries the current mark alongside, and the
//         evidence drawer is retitled to match.
//
// Mock shapes, fixture files, and the hydration-race fill idiom are reused
// from tests/e2e/lab.spec.ts — the fixtures are the committed, generated
// bodies that spec documents (tests/fixtures/generate.mjs provenance).
// p0-3's inspector mocks instead reuse tests/e2e/inspector.spec.ts's pattern
// (typed TS fixtures from tests/fixtures/inspector.ts).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

/** The found-arm address lab.spec.ts already exercises with this fixture. */
const ADDR = (JSON.parse(fixture("stress-aave.json")) as { address: string }).address;

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

/** Serves the committed found-stress fixture for ADDR. */
async function mockStress(page: Page) {
  await page.route(`${API}/v1/address/${ADDR}/stress`, (route) =>
    json(route, fixture("stress-aave.json")),
  );
}

/** Routes the stress GET to a 500 error envelope, as lab.spec.ts's failure tests do. */
async function mockStressFailure(page: Page) {
  await page.route(`${API}/v1/address/${ADDR}/stress`, (route) =>
    json(route, fixture("feed-error-internal.json"), 500),
  );
}

test.describe("p0-1 · address-bound stress results", () => {
  test("editing the input raises the stale barrier and hides the result; retyping restores it", async ({ page }) => {
    await mockCold(page);
    await mockStress(page);
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    // A fill can land BEFORE React hydrates (the DOM takes the value, React
    // state stays empty and the submit stays disabled). Refill until React
    // acknowledges it — the enable is driven only by React state.
    await expect(async () => {
      await input.fill(ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    await expect(page.getByTestId("lab-found")).toBeVisible();
    // the settled result names its address
    await expect(page.getByTestId("lab-result-address")).toContainText(`results for ${ADDR}`);
    // edit one character: barrier up, result body gone
    await input.fill(ADDR.slice(0, -1) + "0");
    const barrier = page.getByTestId("lab-stale-result");
    await expect(barrier).toBeVisible();
    await expect(barrier).toContainText("RESULTS FOR PREVIOUS INPUT");
    await expect(barrier).toContainText(ADDR);
    // p0-1b: the barrier ANNOUNCES itself — role="status", the house
    // superseded-notice convention (batch-superseded-notice,
    // risk-map-superseded-notice, DegradationBanner). It appears on typing and
    // withdraws visible content, so screen readers must hear it.
    await expect(
      page.getByRole("status").filter({ hasText: "RESULTS FOR PREVIOUS INPUT" }),
    ).toBeVisible();
    await expect(page.getByTestId("lab-found")).toHaveCount(0);
    // retype the exact original address: result restored, barrier gone
    await input.fill(ADDR);
    await expect(page.getByTestId("lab-found")).toBeVisible();
    await expect(page.getByTestId("lab-stale-result")).toHaveCount(0);
  });

  test("the error state is barriered the same way", async ({ page }) => {
    await mockCold(page);
    await mockStressFailure(page);
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    await expect(page.getByTestId("lab-error")).toBeVisible();
    await input.fill(ADDR.slice(0, -1) + "0");
    await expect(page.getByTestId("lab-stale-result")).toBeVisible();
    await expect(page.getByTestId("lab-error")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// p0-2 · outcome-aware matrix cells
// ---------------------------------------------------------------------------

/**
 * The committed run-book 200 body — the SAME fixture lab.spec.ts's RESULT-cell
 * pins run against (generated from api/openapi.yaml's run-book example by
 * tests/fixtures/generate-lab-book.mjs). Parsed once; each test clones it and
 * documents its single change.
 */
type RunBookBody = {
  engines: {
    engine: string;
    newly_eligible_accounts: number;
    eligible_debt_delta_usd: string;
    bad_debt_delta_usd: string;
    market_realization: Record<string, unknown> | null;
  }[];
};
const RUN_BOOK_200 = JSON.parse(fixture("run-book.eth_minus_30.json")) as RunBookBody;

/** POST-capable CORS: the run-book request is preflighted, so the OPTIONS leg needs methods+headers. */
const RUN_CORS = {
  ...CORS,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

/** Mock the run-book POST, answering the OPTIONS leg too (tornado.spec.ts's mockSetRun pattern). */
async function mockRunBook(page: Page, body: RunBookBody) {
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: RUN_CORS, body: "" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: RUN_CORS,
      body: JSON.stringify(body),
    });
  });
}

/**
 * The eth_minus_30 row's FIRST engine column — aave_v3_etherfi, engines[0] of
 * the fixture (lab.spec.ts's cell() geometry: td 1 = aave, td 2 = debt_manager).
 */
function aaveCell(page: Page) {
  return page.locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"] td').nth(1);
}

test.describe("p0-2 · outcome-aware matrix cells", () => {
  test("a run with bad debt and shortfall surfaces both in the cell", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the exact fields fix p0-2 must surface): the first engine's
    // (aave_v3_etherfi) bad_debt_delta_usd set to "15900", and — because the
    // committed fixture carries market_realization: null — the whole Shortfall
    // object set from api/openapi.yaml's own example values with
    // execution_shortfall_usd "3864". Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    // noUncheckedIndexedAccess: narrow with a THROWING guard — a missing first
    // engine is a broken fixture, never a variant to skip silently.
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.bad_debt_delta_usd = "15900";
    engine.market_realization = {
      hfs_unchanged: true,
      execution_shortfall_usd: "3864",
      bad_debt_at_liquidation_usd: "0",
      usd_decimals: 8,
      seizure_model: "pro-rata-over-counted-collateral",
      note:
        "market value is NOT an oracle mark: this scenario moves NO health factor " +
        "(`hfs_unchanged` asserts it, computed not promised). The output is the gap the " +
        "protocol is not seeing, under the disclosed seizure model.",
    };
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toContainText("Δ bad debt");
    await expect(cell).toContainText("execution shortfall");
  });

  test("an all-zero engine says so instead of a bare $0", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the quiet arm): the first engine's three outcome dimensions all
    // zeroed — newly_eligible_accounts 0, eligible_debt_delta_usd "0",
    // bad_debt_delta_usd "0" (market_realization is already null in the
    // committed body). Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    // noUncheckedIndexedAccess: same THROWING guard as above — a missing first
    // engine is a broken fixture, never a variant to skip silently.
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.newly_eligible_accounts = 0;
    engine.eligible_debt_delta_usd = "0";
    engine.bad_debt_delta_usd = "0";
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toContainText("no effective movement");
  });
});

// ---------------------------------------------------------------------------
// p0-3 · health boundary price
// ---------------------------------------------------------------------------

/**
 * The inspector.spec.ts mock, same helper shape: fulfilled responses still
 * cross an origin (3818 → 8080), so CORS applies, and the trailing `*` in the
 * address route never crosses `/`, so it does NOT swallow the /history route.
 */
async function mockInspectorFound(page: Page) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: HISTORY, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) =>
    route.fulfill({ json: ADDRESS_FOUND, headers: CORS }),
  );
}

test.describe("p0-3 · health boundary price", () => {
  test("the boundary row names health, shows the current mark, and never says Liquidation price", async ({ page }) => {
    await mockInspectorFound(page);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    await expect(card.getByText("Health boundary price")).toBeVisible();
    await expect(card).toContainText("current");
    // current_price "400000000000" @ 8dec — money() at this callsite has NO
    // "$" prefix and renders "4,000"; pinned WITH its label because a bare
    // "4,000" already matches the weETH price-input row of the same card.
    await expect(card).toContainText("current weETH ≈ 4,000");
    // boundary "370370370371" @ 8dec — money()'s real output, the full string.
    await expect(card).toContainText("3,703.70370371");
    await expect(card.getByText("Liquidation price")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "explain health boundary price" }),
    ).toBeVisible();
  });

  test("the evidence drawer is retitled", async ({ page }) => {
    await mockInspectorFound(page);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    await page
      .getByTestId("position-aave_v3_etherfi")
      .getByRole("button", { name: "explain health boundary price" })
      .click();
    await expect(page.getByText("EXPLAIN · HEALTH BOUNDARY PRICE")).toBeVisible();
    await expect(page.getByText("EXPLAIN · LIQUIDATION PRICE")).toHaveCount(0);
  });
});
