// W-UX-D (charts supplement captions a/c) e2e, Lab surfaces only.
//
// This file once held the Book chart pins (supplement §16–§18: reading lines,
// waterfall copy, the risk map's full-book walk). The Book was rebuilt on
// 2026-09-15 (Plan 1) and those pins were retired with it (Task 14, ledgered
// in .superpowers/sdd/progress-ui-overhaul.md); the semantic invariants the
// new Book still owes are pinned in tests/e2e/book.spec.ts. What remains here:
//   (a) — held-flat counted-disclosure pattern on the Lab, raw units.
//   (c) — Lab run-book notes as a counted verbatim details; the
//         collateral-at-risk row carries the reader caption as title.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const CORS = { "access-control-allow-origin": "*" };
const API = "http://localhost:8080";

async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

// ---------------------------------------------------------------------------
// Lab — captions (a), (b), (c) on the Lab surfaces.
// ---------------------------------------------------------------------------

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const STRESS_AAVE = JSON.parse(fixture("stress-aave.json")) as { address: string };

async function mockStress(page: Page, addr: string, body: string) {
  await page.route(`${API}/v1/address/${addr}/stress`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body }),
  );
}

/** The two COLD routes book mode reads on arrival (W-SD-A). */
async function mockLabCold(page: Page) {
  await page.route(`${API}/v1/scenarios`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: fixture("scenarios.json"),
    }),
  );
  await page.route(`${API}/v1/book`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: fixture("book.json"),
    }),
  );
}

/**
 * W-SD-A CHANGED THIS HELPER: whole-book view is the default register, so the
 * address form is reached with one click on the secondary tab.
 */
async function runStress(page: Page, addr: string) {
  await muteStream(page);
  await mockLabCold(page);
  await page.goto("/lab");
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  await expect(async () => {
    await input.fill(addr);
    await expect(button).toBeEnabled({ timeout: 250 });
  }).toPass();
  await button.click();
}

test("Lab held flat (address mode): counted details, raw-units header", async ({ page }) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();

  const heldFlat = page.getByTestId("held-flat");
  await expect(heldFlat.getByTestId("held-flat-summary")).toHaveText(
    "1 price input held flat. The scenario did not move these prices, so positions priced by " +
      "them are stressed at stale marks. Each one keeps its standing value, and the scenario " +
      "is blind to where it would have gone.",
  );
  const summary = heldFlat.locator("summary");
  await expect(summary).toHaveText("held flat: 1 inputs named");
  await summary.click();
  await expect(
    heldFlat.getByRole("columnheader", {
      name: "held value (source's raw units, unscaled by design)",
    }),
  ).toBeVisible();
  await expect(heldFlat).toContainText("100000000"); // the source's raw units, verbatim
});

test("Lab realization: the eligible-vs-realized gloss is RENDERED, not a hover", async ({
  page,
}) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();

  // W-3L: the gloss used to ride this sub as a `title`, which made it
  // reachable only with a mouse. It is a clause of the panel's METHOD line
  // now — same words, rendered — and the sub carries no title at all.
  const gloss =
    '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
    "closes can be less: the Debt Manager liquidates in two passes, half the debt, then " +
    "the remainder.";
  await expect(page.getByTestId("seizure-model").first()).toContainText(gloss);
  await expect(page.getByTestId("realized-leq-eligible").first()).not.toHaveAttribute(
    "title",
    gloss,
  );
  // And the method line is never inside a disclosure.
  expect(
    await page
      .getByTestId("seizure-model")
      .first()
      .evaluate((node) => node.closest("details") !== null),
  ).toBe(false);
});

test("Lab run-book: wire notes become a counted verbatim details; collateral-at-risk carries the reader caption", async ({
  page,
}) => {
  // W-SD-A CHANGED THIS SETUP: book mode learns the committed set from
  // `GET /v1/scenarios`, so no address lookup is needed to reach the run
  // control. The flagship is selected by clicking its committed chip —
  // `pickDefaultScenario`, which used to hunt an address run's results for a
  // realization axis, is deleted.
  await muteStream(page);
  await mockLabCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: fixture("run-book.weeth_market_depeg_oracles_held.json"),
    }),
  );
  await page.goto("/lab");
  // W-FIX-WEB SYNCHRONIZATION, the openRunBook discipline. Two waits close
  // the two fetch-driven gaps this flow used to leave open under parallelism:
  // the frontier (the tall /v1/book render ABOVE the chips) must be in place
  // before the chip is clicked, or its late arrival shifts the chip under the
  // click; and the SELECTION must be committed-detail's own published id
  // before run is clicked — the flagship is NOT the default selection here
  // (eth_minus_30 is first in wire order), so a run dispatched before the
  // pick commits would run the wrong scenario and this panel would never
  // render. Both waits target renders, not time.
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await expect(page.getByTestId("committed-detail")).toHaveAttribute(
    "data-scenario-id",
    "weeth_market_depeg_oracles_held",
  );
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();

  // Caption (c): the counted, verbatim wire-notes disclosure.
  //
  // THREE, not one, since Wave W-EX-A. `cmd/api/p5_runbook.go:512-518` composes
  // three response-level notes on every run-book body; the contract's example
  // used to carry one, and the example is now CAPTURED from the running handler
  // rather than composed by hand. The count is the point of this assertion — a
  // counted disclosure whose count is the fixture's own is what makes a dropped
  // note visible — so it moves with the fixture.
  const notes = page.getByTestId("book-wire-notes");
  await expect(notes.locator("summary")).toHaveText("wire notes: 3, verbatim");
  await notes.locator("summary").click();
  await expect(notes).toContainText(
    "aggregates are per engine in each engine's OWN unit and decimals",
  );

  // Caption (c) — W-3L: the reader caption is RENDERED in each engine
  // panel's METHOD line, one per engine, never dropped. It used to sit in a
  // `td[title]`, which is hover sugar: a dip in the collateral-at-risk series
  // is honest arithmetic, and a reader who never hovers read it as missing
  // data. The hazard is that this caption moves UP, never down with the table
  // row it annotates — so it renders ABOVE the disclosure that now holds it.
  const captioned = page.getByTestId("book-engine-method");
  await expect(captioned).toHaveCount(2);
  await expect(captioned.first()).toContainText("re-measured at each price step");
  await expect(page.locator('td[title*="re-measured at each price step"]')).toHaveCount(0);

  const order = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const method = document.querySelector('[data-testid="book-engine-method"]');
    const forensics = document.querySelector('[data-testid="book-engine-forensics"]');
    return {
      method: method === null ? -1 : all.indexOf(method),
      forensics: forensics === null ? -1 : all.indexOf(forensics),
      collapsed: method === null ? true : method.closest("details") !== null,
    };
  });
  expect(order.method).toBeGreaterThanOrEqual(0);
  expect(order.forensics).toBeGreaterThan(order.method);
  expect(order.collapsed).toBe(false);
});
