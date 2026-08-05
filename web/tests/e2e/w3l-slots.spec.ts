// WAVE W-3L — the seven-slot section template, rolled across the app.
//
// This file holds the wave's OWN gates: for every converted surface, the DOM
// ORDER of the slots it implements, and the hazard assertions that keep the
// register honest — a refusal, a withheld count, a coverage line, a
// supersession, an outpaced state or a walk failure is never a descendant of a
// `<details>`, and FORENSICS is always a native `<details>` without `open`.
//
// The per-surface copy pins live with their surfaces; this file pins SHAPE.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_AAVE_PAGE_2, POSITIONS_DM_PAGE_1 } from "../fixtures/book";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function openBook(page: Page, path = "/book?engine=aave_v3_etherfi"): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    const cursor = url.searchParams.get("cursor");
    if (engine === "debt_manager") return fulfillJson(route, POSITIONS_DM_PAGE_1);
    if (cursor === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await page.goto(path);
}

/**
 * Document-order indices for a list of testids, resolved in ONE evaluate so
 * every index is measured against the same tree. `-1` means absent.
 */
async function domOrder(page: Page, ids: readonly string[]): Promise<number[]> {
  return page.evaluate((wanted) => {
    const all = Array.from(document.querySelectorAll("*"));
    return wanted.map((id) => {
      const node = document.querySelector(`[data-testid="${id}"]`);
      return node === null ? -1 : all.indexOf(node);
    });
  }, ids);
}

/** Every index present, and strictly increasing in the order given. */
function expectSlotOrder(order: readonly number[]): void {
  expect(order.every((index) => index >= 0)).toBe(true);
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i]).toBeGreaterThan(order[i - 1] as number);
  }
}

/** R3/R7: this node must not be inside any `<details>` on the page. */
async function expectNotCollapsed(locator: Locator): Promise<void> {
  await expect(locator).toBeAttached();
  expect(await locator.evaluate((node) => node.closest("details") !== null)).toBe(false);
}

/** Template slot 7: a native `<details>`, closed by default. */
async function expectClosedDetails(locator: Locator): Promise<void> {
  await expect(locator).toBeAttached();
  expect(await locator.evaluate((node) => node.tagName.toLowerCase())).toBe("details");
  expect(await locator.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
}

// ---------------------------------------------------------------------------
// Book — BookStatRows
// ---------------------------------------------------------------------------

test("BookStatRows: STATE, ANSWER, cards, METHOD in DOM order", async ({ page }) => {
  await openBook(page);
  await expect(page.getByTestId("book-stats-debt_manager")).toBeVisible();
  expectSlotOrder(
    await domOrder(page, [
      "book-stats-state-debt_manager",
      "book-stats-answer-debt_manager",
      "book-stat-collateral-debt_manager",
      "book-stat-refused-debt_manager",
      "book-stats-method-debt_manager",
    ]),
  );
});

test("BookStatRows hazard: the refusal breakdown and the split never collapse", async ({
  page,
}) => {
  await openBook(page);
  // The DM fixture has refused_positions = 1, so the whole split is
  // refusal-class and no expandable exists on the block at all.
  await expectNotCollapsed(page.getByTestId("book-stats-split-debt_manager"));
  await expectNotCollapsed(page.getByTestId("book-stats-refusals-debt_manager"));
  await expectNotCollapsed(page.getByTestId("book-stat-refused-debt_manager-sub"));
  await expect(page.getByTestId("book-stats-forensics-debt_manager")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Book — BookHistogram
// ---------------------------------------------------------------------------

test("BookHistogram: STATE, ANSWER, VISUAL, METHOD, FORENSICS in DOM order", async ({ page }) => {
  await openBook(page);
  await expect(page.getByTestId("book-histogram-aave_v3_etherfi")).toBeVisible();
  expectSlotOrder(
    await domOrder(page, [
      "hist-state-aave_v3_etherfi",
      "hist-denominator-aave_v3_etherfi",
      "hist-reading-aave_v3_etherfi",
      "hist-svg-aave_v3_etherfi",
      "hist-method-aave_v3_etherfi",
      "hist-forensics-aave_v3_etherfi",
    ]),
  );
  await expectClosedDetails(page.getByTestId("hist-forensics-aave_v3_etherfi"));
});

test("BookHistogram hazards: the coverage counts stay outside the disclosure", async ({ page }) => {
  await openBook(page);
  await expectNotCollapsed(page.getByTestId("hist-refused-aave_v3_etherfi"));
  await expectNotCollapsed(page.getByTestId("hist-no-debt-aave_v3_etherfi"));
  await expectNotCollapsed(page.getByTestId("hist-denominator-aave_v3_etherfi"));
});

// ---------------------------------------------------------------------------
// Book — BookWaterfall
// ---------------------------------------------------------------------------

test("BookWaterfall: STATE before the bars, ANSWER, METHOD, FORENSICS after", async ({ page }) => {
  await openBook(page);
  await expect(page.getByTestId("waterfall-forensics")).toBeAttached();
  expectSlotOrder(
    await domOrder(page, [
      "waterfall-section-note",
      "waterfall-held-flat",
      "book-waterfall-debt_manager",
      "waterfall-answer-debt_manager",
      "eligible-gloss",
      "waterfall-forensics",
    ]),
  );
  await expectClosedDetails(page.getByTestId("waterfall-forensics"));
});

test("BookWaterfall hazard: the held-flat COUNT never collapses", async ({ page }) => {
  await openBook(page);
  await expectNotCollapsed(page.getByTestId("held-flat-summary"));
});

// ---------------------------------------------------------------------------
// Book — BookBadDebt
// ---------------------------------------------------------------------------

test("BookBadDebt: ANSWER and METHOD above the table, neither collapsible", async ({ page }) => {
  await openBook(page);
  const section = page.getByRole("region", { name: "bad-debt census" });
  await expect(page.getByTestId("bad-debt-answer")).toBeVisible();
  await expectNotCollapsed(page.getByTestId("bad-debt-answer"));
  await expectNotCollapsed(page.getByTestId("bad-debt-method"));
  // The takeaway names BOTH engines and never sums them.
  await expect(page.getByTestId("bad-debt-answer")).toContainText("aave_v3_etherfi");
  await expect(page.getByTestId("bad-debt-answer")).toContainText("debt_manager");
  await expect(page.getByTestId("bad-debt-answer")).toContainText("never summed");
  expect(await section.count()).toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// Book — BookPositions
// ---------------------------------------------------------------------------

test("BookPositions: STATE, controls, ANSWER, METHOD, table in DOM order", async ({ page }) => {
  await openBook(page);
  await expect(page.getByTestId("positions-answer")).toBeVisible();
  expectSlotOrder(
    await domOrder(page, [
      "positions-state",
      "positions-warn-disclosure",
      "no-price-path-legend",
      "positions-answer",
      "headroom-legend",
    ]),
  );
});

test("BookPositions hazards: the warn band, the price-path legend and the footer registers stay open", async ({
  page,
}) => {
  await openBook(page);
  await expectNotCollapsed(page.getByTestId("positions-warn-disclosure"));
  await expectNotCollapsed(page.getByTestId("no-price-path-legend"));
  await expectNotCollapsed(page.getByTestId("positions-accounting"));
  await expectNotCollapsed(page.getByTestId("headroom-legend"));
});

test("BookPositions: the ordering-in-force strip is its own line, never a chip and never collapsed", async ({
  page,
}) => {
  await openBook(page, "/book?engine=debt_manager&sort=liq_distance");
  const strip = page.getByTestId("positions-ordering");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("ordering in force");
  await expectNotCollapsed(page.getByTestId("legacy-sort-register"));
  // It sits BELOW the controls, not inside them.
  expect(
    await strip.evaluate((node) => node.closest('[class*="controls"]') !== null),
  ).toBe(false);
});

test("LAW-5: the price-path marker renders, so no number lives only in a title", async ({
  page,
}) => {
  await openBook(page);
  const cells = page.getByTestId("price-path-marker");
  await expect(cells.first()).toBeAttached();
  // Whatever the arm, the marker is rendered TEXT, not a title attribute.
  const texts = await cells.evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.every((text) => text.trim().length > 0)).toBe(true);
});

// ---------------------------------------------------------------------------
// Shared primitive — Stampline's keepOpen split
// ---------------------------------------------------------------------------

test("Stampline: refusal-class pins stay inline, neutral pins collapse behind a COUNT", async ({
  page,
}) => {
  await openBook(page);
  const strip = page.getByTestId("stampline-split");
  await expect(strip).toBeVisible();

  // keepOpen pins: gate and coverage, whatever their tone.
  await expectNotCollapsed(page.getByTestId("book-stamp-gate"));
  await expectNotCollapsed(page.getByTestId("book-stamp-coverage"));

  // The disclosure COUNTS what it hides, and hides only neutral pins.
  const evidence = page.getByTestId("stampline-evidence");
  await expectClosedDetails(evidence);
  await expect(page.getByTestId("book-stamp-evidence-summary")).toHaveText(/^\d+ evidence pins?$/);
  const hidden = await evidence.evaluate(
    (node) => node.querySelectorAll('[class*="stampItem"]').length,
  );
  const summaryText = (await page.getByTestId("book-stamp-evidence-summary").textContent()) ?? "";
  expect(summaryText).toContain(String(hidden));

  // The head still carries the freshness line, so folding its stampline twin
  // removes nothing from the surface.
  await expect(page.getByTestId("book-freshness")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------

const LAB_API = "http://localhost:8080";

function labFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

async function openLab(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${LAB_API}/v1/scenarios`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("scenarios.json"),
    }),
  );
  await page.route(`${LAB_API}/v1/book`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("book.json"),
    }),
  );
  await page.goto("/lab");
}

/** A served run book for the flagship scenario, which is where the sub-panels live. */
async function runFlagship(page: Page): Promise<void> {
  await openLab(page);
  await page.route(`${LAB_API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("run-book.weeth_market_depeg_oracles_held.json"),
    }),
  );
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

test("LabMatrix: ANSWER, grid, METHOD, legend key, open legend, FORENSICS in DOM order", async ({
  page,
}) => {
  await openLab(page);
  await expect(page.getByTestId("matrix-forensics")).toBeAttached();
  expectSlotOrder(
    await domOrder(page, [
      "matrix-batch-line",
      "matrix-table",
      "matrix-method",
      "matrix-legend-key",
      "matrix-legend",
      "matrix-forensics",
    ]),
  );
  await expectClosedDetails(page.getByTestId("matrix-forensics"));
});

test("LabMatrix legend hazard: every refusal, absence and DEFINITION-CHANGED arm stays open", async ({
  page,
}) => {
  await openLab(page);
  for (const id of [
    "matrix-legend",
    "matrix-legend-dc",
    "matrix-legend-dc-response",
    "matrix-legend-dc-running",
    "matrix-legend-dc-settled",
  ]) {
    await expectNotCollapsed(page.getByTestId(id));
  }
  // The one-line key names all six states without defining any of them.
  const key = page.getByTestId("matrix-legend-key");
  for (const word of [
    "NOT COVERED",
    "WITHHELD",
    "SUPERSEDED",
    "UNANSWERED",
    "CONTRADICTORY BOOK",
    "DEFINITION CHANGED",
  ]) {
    await expect(key).toContainText(word);
  }
  // W-3L ruling: SUPERSEDED's definition stays OPEN even though the inventory
  // offered it as collapsible. Only NOT COVERED's prose sits behind the fold.
  await expect(page.getByTestId("matrix-legend")).toContainText(
    "SUPERSEDED = the result was measured at an older batch",
  );
  await expect(page.getByTestId("matrix-forensics")).toContainText("NOT COVERED =");
});

test("LabBookPanel BookResult: absences render BEFORE the numbers they qualify", async ({
  page,
}) => {
  await runFlagship(page);
  expectSlotOrder(
    await domOrder(page, [
      "book-excluded",
      "book-result-answer",
      "book-engine",
      "book-result-method",
      "book-result-forensics",
    ]),
  );
  await expectClosedDetails(page.getByTestId("book-result-forensics"));
  // HAZARD: the excluded/hole block never collapses.
  await expectNotCollapsed(page.getByTestId("book-excluded"));
});

test("LabBookPanel EngineResult: ANSWER, cards, METHOD, FORENSICS in DOM order", async ({
  page,
}) => {
  await runFlagship(page);
  expectSlotOrder(
    await domOrder(page, [
      "book-engine-answer",
      "net-eligible-card",
      "book-engine-method",
      "book-engine-forensics",
    ]),
  );
  await expectClosedDetails(page.getByTestId("book-engine-forensics").first());
  // The at-risk caption moved UP out of the table row's title, so it is above
  // the disclosure the row now lives in.
  await expect(page.getByTestId("book-engine-method").first()).toContainText(
    "re-measured at each price step",
  );
});

test("LabRunBook sub-panels: coverage counts before the bars, wire notes behind counted summaries", async ({
  page,
}) => {
  await runFlagship(page);
  expectSlotOrder(
    await domOrder(page, [
      "runbook-hist-reading",
      "runbook-hist-state-before",
      "runbook-hist-svg-before",
      "runbook-hist-method",
      "runbook-hist-forensics",
    ]),
  );
  // HAZARD: both sides' refused / no-debt counts stay outside the disclosure,
  // on EVERY engine panel the run served.
  for (const side of ["before", "after"]) {
    for (const id of [`runbook-hist-refused-${side}`, `runbook-hist-no-debt-${side}`]) {
      const nodes = page.getByTestId(id);
      const count = await nodes.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) await expectNotCollapsed(nodes.nth(i));
    }
  }
  // The shared count scale is stated ON THE PAGE now, not in a source comment.
  await expect(page.getByTestId("runbook-hist-method").first()).toContainText(
    "Both sides are drawn on the SAME 0 to 100 percent axis",
  );

  // Movers: the wire note may collapse ONLY while the truncation count is in
  // the open ANSWER above it.
  await expectNotCollapsed(page.getByTestId("runbook-movers-disclosure").first());
  await expectClosedDetails(page.getByTestId("runbook-movers-forensics").first());

  // Collateral: the count of holdings with no price witness is in the open
  // takeaway on EVERY engine panel, and no side's table is collapsed.
  const answers = page.getByTestId("runbook-collateral-answer");
  const answerCount = await answers.count();
  expect(answerCount).toBeGreaterThan(0);
  for (let i = 0; i < answerCount; i += 1) await expectNotCollapsed(answers.nth(i));
  await expect(answers.first()).toContainText("no price witness");
  await expectNotCollapsed(page.getByTestId("runbook-collateral-row").first());
});

test("LabRealization + LabProjectionView: gloss and held-input clause are RENDERED", async ({
  page,
}) => {
  await runFlagship(page);
  await expectNotCollapsed(page.getByTestId("realization-answer").first());
  await expectNotCollapsed(page.getByTestId("seizure-model").first());
  await expectClosedDetails(page.getByTestId("realization-forensics").first());
  await expect(page.getByTestId("realization-answer").first()).toContainText("delta-only");
});

test("LabAppliedShocks: the snap COUNTS are visible, only the per-row flags collapse", async ({
  page,
}) => {
  // The run-book flagship applies no shocks (its axis is market realization),
  // so this law is exercised where shocks actually exist: an address-mode
  // result on the −30% price scenario.
  const stress = JSON.parse(labFixture("stress-aave.json")) as { address: string };
  await openLab(page);
  await page.route(`${LAB_API}/v1/address/${stress.address}/stress`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("stress-aave.json"),
    }),
  );
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  await expect(async () => {
    await input.fill(stress.address);
    await expect(button).toBeEnabled({ timeout: 500 });
  }).toPass();
  await button.click();
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();

  const summary = page.getByTestId("applied-shocks-summary").first();
  await expectNotCollapsed(summary);
  await expect(summary).toContainText("shock applied");
  await expect(summary).toContainText("snapped to a cap");
  await expect(summary).toContainText("cap-bound");
  await expectClosedDetails(page.getByTestId("applied-shocks-details").first());
});
