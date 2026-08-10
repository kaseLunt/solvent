// Phase 0 (UI-overhaul trust fixes) — the render-consequence pins, one
// section per fix, each tagged p0-N:
//   p0-1 · address-bound stress results: a settled Lab stress result binds to
//         phase.addr — editing the input raises a stale barrier naming the OLD
//         address and hides the result body; retyping the exact address
//         restores it (pure derivation, no data destruction).
//
// Mock shapes, fixture files, and the hydration-race fill idiom are reused
// from tests/e2e/lab.spec.ts — the fixtures are the committed, generated
// bodies that spec documents (tests/fixtures/generate.mjs provenance).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

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
