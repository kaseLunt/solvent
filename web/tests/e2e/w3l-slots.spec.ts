// WAVE W-3L — the seven-slot section template, rolled across the app.
//
// This file holds the wave's OWN gates: for every converted surface, the DOM
// ORDER of the slots it implements, and the hazard assertions that keep the
// register honest — a refusal, a withheld count, a coverage line, a
// supersession, an outpaced state or a walk failure is never a descendant of a
// `<details>`, and FORENSICS is always a native `<details>` without `open`.
//
// The per-surface copy pins live with their surfaces; this file pins SHAPE.
//
// WAVE W-3L-B (Codex round 47, NOT-SHIP finding 4). Half of these gates used to
// run against a HEALTHY book and a HEALTHY run: the excluded/hole block was
// asserted "not collapsed" while rendering "excluded engines: none", the
// waterfall's violation and refusal strips were never rendered at all, the
// stampline's fold was never handed a warn-toned pin to try to fold, and the
// positions surface was never failed or superseded. A hazard assertion over an
// arm that cannot fire proves the arm's ABSENCE, not its honesty. Every gate
// below now drives the degraded arm from a committed fixture, and the two
// fixture-derived strings on this page (the price-path marker and the matrix's
// batch line) are compared against the bytes they are computed from rather than
// against "non-empty".
//
// WAVE W-3L-C (Codex round 50). THE SLOTS WERE PINNED; THE SENTENCES IN THEM
// WERE NOT. Every ANSWER gate on this page asserted visibility, DOM order and a
// substring — and a substring is satisfied by copy that no longer derives from
// anything. Replacing `{realizationAnswer(realization)}` with a hardcoded
// "$0/$0 … delta-only" sentence passed this file AND the 24 helper specs beside
// it, because those drive the helpers directly and never look at the page: one
// suite proved the helper computes, the other proved the panel renders, and
// nothing proved the panel renders THE HELPER.
//
// So every converted ANSWER below is now WELDED: the spec imports the helper,
// feeds it the SAME committed fixture the route serves, and compares the
// rendered text to the helper's output as a WHOLE STRING. A component that
// stops calling its helper — or calls it with something else — fails here, and
// the failure names the sentence.
//
// `toHaveText` (not `toContainText`) is the operative choice: it is an equality
// on the node's whole text, so a hardcoded sentence cannot pass by containing
// the right words, and a helper whose output drifts cannot pass by still
// mentioning them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { refineScenario, type components, type Waterfall } from "@solvent/client";
import {
  BATCH_SUPERSEDED,
  BOOK,
  BOOK_ENGINE_REFUSED,
  BOOK_ERROR_UNAVAILABLE,
  BOOK_MONOTONICITY_VIOLATION,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";
import { factorDistancePercent } from "../../lib/book-format";
import { normalizeBookQuery, positionsAnswerLine } from "../../lib/positions";
import { waterfallEngineAnswer } from "../../app/book/waterfallView";
import {
  bookResultAnswer,
  boundaryGroupAnswer,
  collateralGroupAnswer,
  engineResultAnswer,
  projectionAnswer,
  realizationAnswer,
  stableBoundaryScenarios,
} from "../../app/lab/labPanelLines";

type Schemas = components["schemas"];

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function openBook(
  page: Page,
  path = "/book?engine=aave_v3_etherfi",
  book: unknown = BOOK,
): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, book));
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

/**
 * THE WELD. This node's whole text is the helper's whole output — no substring,
 * no prefix, no "contains the important word".
 *
 * It also insists the sentence is a REAL one: a helper that degenerated to an
 * empty string would otherwise be welded to a panel rendering nothing, and both
 * halves would agree.
 */
async function expectWeld(locator: Locator, expected: string): Promise<void> {
  expect(expected.length, "the helper produced no sentence to weld to").toBeGreaterThan(0);
  await expect(locator).toHaveText(expected);
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

  // THE WELD (round 50). Each engine's ANSWER is `waterfallEngineAnswer` over
  // the SERVED waterfall — computed here from the same committed bytes the
  // route fulfils with, and compared whole. Both engines are welded, because
  // the two carry different decimals and a single-engine gate would pass over a
  // panel that had quietly hardcoded the other one's sentence.
  const served = BOOK.waterfall;
  expect(served, "the book fixture serves no waterfall").not.toBeNull();
  const waterfall = served as Waterfall;
  const engines = Array.from(
    new Set(waterfall.points.flatMap((point) => point.engines.map((entry) => entry.engine))),
  );
  expect(engines.length).toBeGreaterThan(1);
  for (const engine of engines) {
    await expectWeld(
      page.getByTestId(`waterfall-answer-${engine}`),
      waterfallEngineAnswer(waterfall, engine),
    );
  }
});

test("BookWaterfall hazards: held-flat COUNT, MONOTONICITY VIOLATION and EXCLUDED ENGINES all stay open, above the bars", async ({
  page,
}) => {
  // (a) the healthy book: the held-flat count is open.
  await openBook(page);
  await expectNotCollapsed(page.getByTestId("held-flat-summary"));
  // Neither degraded strip may render from a healthy body.
  await expect(page.getByTestId("waterfall-monotonicity")).toHaveCount(0);
  await expect(page.getByTestId("waterfall-excluded")).toHaveCount(0);

  // (b) A DERIVED NEGATIVE, SERVED. The committed violation fixture names the
  // engine, the grid point and the exact fall; the strip is an alert, sits
  // ABOVE the bars it disqualifies, and never collapses.
  const violationWaterfall = BOOK_MONOTONICITY_VIOLATION.waterfall;
  expect(violationWaterfall).not.toBeNull();
  const violation = violationWaterfall?.monotonicity;
  expect(violation?.ok).toBe(false);
  await openBook(page, "/book?engine=aave_v3_etherfi", BOOK_MONOTONICITY_VIOLATION);
  const strip = page.getByTestId("waterfall-monotonicity");
  await expect(strip).toBeVisible();
  await expectNotCollapsed(strip);
  await expect(strip).toContainText("MONOTONICITY VIOLATION");
  await expect(strip).toContainText(violation?.engine as string);
  await expect(strip).toContainText(violation?.detail as string);
  await expect(strip).toContainText("served exactly as computed, with no smoothing");
  expectSlotOrder(
    await domOrder(page, [
      "waterfall-section-note",
      "waterfall-monotonicity",
      "waterfall-held-flat",
      "book-waterfall-debt_manager",
    ]),
  );

  // (c) A WHOLE-ENGINE REFUSAL, SERVED. The excluded strip names the wire's own
  // code and engine, and it too sits above the bars.
  const refusedWaterfall = BOOK_ENGINE_REFUSED.waterfall;
  expect(refusedWaterfall).not.toBeNull();
  const refusal = refusedWaterfall?.excluded_engines[0];
  expect(refusal).toBeDefined();
  await openBook(page, "/book?engine=debt_manager", BOOK_ENGINE_REFUSED);
  const excluded = page.getByTestId("waterfall-excluded");
  await expect(excluded).toBeVisible();
  await expectNotCollapsed(excluded);
  await expect(excluded).toContainText(refusal?.code as string);
  await expect(excluded).toContainText(refusal?.engine as string);
  await expect(excluded).toContainText("is absent from every point of this waterfall");
  expectSlotOrder(
    await domOrder(page, [
      "waterfall-section-note",
      "waterfall-excluded",
      "waterfall-held-flat",
      "book-waterfall-debt_manager",
    ]),
  );
});

// ---------------------------------------------------------------------------
// Book — BookBadDebt
// ---------------------------------------------------------------------------

test("BookBadDebt: ANSWER and METHOD above the table, neither collapsible", async ({ page }) => {
  await openBook(page);
  const section = page.getByRole("region", { name: "bad-debt census" });
  // The census is ONE landmark region, and the takeaway lives inside it. (This
  // used to read `count() >= 0`, which is true of an absent section.)
  await expect(section).toHaveCount(1);
  await expect(section.getByTestId("bad-debt-answer")).toBeVisible();
  await expectNotCollapsed(page.getByTestId("bad-debt-answer"));
  await expectNotCollapsed(page.getByTestId("bad-debt-method"));
  // The takeaway names BOTH engines and never sums them.
  await expect(page.getByTestId("bad-debt-answer")).toContainText("aave_v3_etherfi");
  await expect(page.getByTestId("bad-debt-answer")).toContainText("debt_manager");
  await expect(page.getByTestId("bad-debt-answer")).toContainText("never summed");
  // ANSWER, then METHOD, then the per-engine census cells the fixture serves.
  expectSlotOrder(await domOrder(page, ["bad-debt-answer", "bad-debt-method"]));
  for (const row of BOOK.bad_debt) {
    await expect(section.getByTestId(`bad-debt-${row.engine}`)).toBeAttached();
  }
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

  // THE WELD (round 50). The takeaway is `positionsAnswerLine` over the walk
  // this table renders, and every argument is derived here rather than typed:
  // the engine/sort/direction come out of the app's OWN deep-link normalizer
  // fed the URL this test opened, and the three counts come off the served
  // fixtures. Restating the ranking vocabulary by hand would have welded the
  // panel to a second opinion about what the URL means.
  const query = normalizeBookQuery("aave_v3_etherfi", null, null);
  const aggregate = BOOK.engines.find((candidate) => candidate.engine === query.engine);
  if (aggregate === undefined) throw new Error("the book fixture serves no aave aggregate");
  expect(aggregate.refused).toBe(false);
  const total = POSITIONS_AAVE_PAGE_1.total_positions;
  expect(total).not.toBeNull();
  // The walk exhausts both committed pages (page two carries the null cursor),
  // so `loaded` settles at their combined row count. `toHaveText` retries, so
  // this is the settled sentence rather than a race against page two.
  const loaded = POSITIONS_AAVE_PAGE_1.positions.length + POSITIONS_AAVE_PAGE_2.positions.length;
  await expectWeld(
    page.getByTestId("positions-answer"),
    positionsAnswerLine({
      engine: query.engine,
      sort: query.sort,
      reversed: query.reversed,
      loaded,
      qualifying: String(total),
      onBook: String(aggregate.positions),
    }),
  );
});

test("BookPositions hazards: the warn band, the legends, and the degraded SUPERSESSION and REFUSAL registers all stay open", async ({
  page,
}) => {
  await openBook(page);
  await expectNotCollapsed(page.getByTestId("positions-warn-disclosure"));
  await expectNotCollapsed(page.getByTestId("no-price-path-legend"));
  await expectNotCollapsed(page.getByTestId("positions-accounting"));
  await expectNotCollapsed(page.getByTestId("headroom-legend"));
  // A healthy walk renders neither degraded register, so the two arms below
  // are the only place they can be judged.
  await expect(page.getByTestId("batch-superseded-notice")).toHaveCount(0);
  await expect(page.getByTestId("positions-refusal")).toHaveCount(0);

  // (a) THE SUPERSESSION. The first cursor presentation is answered 409, so the
  // walk restarts from page one and says so. That notice is a statement about
  // which materialization the reader is looking at, and it may never fold.
  let cursorRequests = 0;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const isTable = url.searchParams.get("sort") !== null;
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    if (!isTable) return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    cursorRequests += 1;
    if (cursorRequests === 1) return fulfillJson(route, BATCH_SUPERSEDED, 409);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const notice = page.getByTestId("batch-superseded-notice");
  await expect(notice).toBeVisible();
  await expectNotCollapsed(notice);
  // The wire's own two batch ids, from the fixture that carries them.
  await expect(notice).toContainText(
    `batch ${String(BATCH_SUPERSEDED.error.cursor_batch_id)} was superseded by batch ` +
      `${String(BATCH_SUPERSEDED.error.current_batch_id)}`,
  );
  // It sits in the STATE slot, above the table it qualifies.
  expectSlotOrder(
    await domOrder(page, ["positions-state", "batch-superseded-notice", "positions-answer"]),
  );

  // (b) THE REFUSAL. A page-one walk answered 503 renders the refusal strip
  // with the server's own code and message, in the open.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) =>
    fulfillJson(route, BOOK_ERROR_UNAVAILABLE, 503),
  );
  await page.goto("/book?engine=aave_v3_etherfi");

  const refusal = page.getByTestId("positions-refusal");
  await expect(refusal).toBeVisible();
  await expectNotCollapsed(refusal);
  await expect(refusal).toContainText(BOOK_ERROR_UNAVAILABLE.error.message);
  expectSlotOrder(await domOrder(page, ["positions-state", "positions-refusal"]));
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

test("LAW-5: the price-path marker renders the FIXTURE's own asset and distance", async ({
  page,
}) => {
  // THE EXPECTED SET, COMPUTED FROM THE SERVED BYTES. `distance` is the only
  // arm carrying a number, and it is the arm LAW-5 exists for: that percent
  // used to live in a `title` and nowhere else. `breached` renders no marker
  // (the Headroom cell already says the word), and a refused row renders the
  // refusal tag instead — so the marker COUNT is a claim too.
  const expected = POSITIONS_AAVE_PAGE_1.positions
    .filter((position) => position.status !== "refused" && position.liq_distance.kind === "distance")
    .map((position) => {
      const ld = position.liq_distance;
      const percent = factorDistancePercent(
        BigInt(ld.scale_factor_num as string),
        BigInt(ld.scale_factor_den as string),
      );
      return `${ld.factor_symbol ?? "price axis"} ${percent ?? ""}`;
    });
  expect(expected.length).toBeGreaterThan(0);

  await openBook(page);
  const cells = page.getByTestId("price-path-marker");
  await expect(cells.first()).toBeAttached();
  // Whatever the arm, the marker is rendered TEXT, not a title attribute.
  const texts = await cells.evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").replace(/^[\s·]+/, "").trim()),
  );
  expect(texts.every((text) => text.length > 0)).toBe(true);
  // Every rendered marker is one the fixture's own integers produce, and the
  // fixture's distance row is on screen.
  for (const marker of expected) {
    expect(texts).toContain(marker);
  }
  // The refused row on page two contributes NO marker, so the count is the
  // number of served distance arms, not the number of rows.
  const refusedRows = [...POSITIONS_AAVE_PAGE_1.positions, ...POSITIONS_AAVE_PAGE_2.positions].filter(
    (position) => position.status === "refused",
  );
  expect(refusedRows.length).toBeGreaterThan(0);
  expect(texts.length).toBe(expected.length);
});

// ---------------------------------------------------------------------------
// Shared primitive — Stampline's keepOpen split
// ---------------------------------------------------------------------------

test("Stampline: refusal-class pins stay inline, neutral pins collapse behind a COUNT", async ({
  page,
}) => {
  // THE FOLD IS HANDED SOMETHING IT MUST REFUSE TO FOLD. The committed book
  // carries a watermark whose sweep FAILED, which is what tones the marks pin
  // warn; a fold that ignored tone would hide an absent collateral clock behind
  // a summary reading "3 evidence pins".
  const failedSweeps = BOOK.batch.watermarks.filter((stamp) => (stamp.sweep?.failed ?? 0) > 0);
  expect(failedSweeps.length).toBeGreaterThan(0);

  await openBook(page);
  const strip = page.getByTestId("stampline-split");
  await expect(strip).toBeVisible();

  // keepOpen pins: gate and coverage, whatever their tone.
  await expectNotCollapsed(page.getByTestId("book-stamp-gate"));
  await expectNotCollapsed(page.getByTestId("book-stamp-coverage"));
  // Warn-toned pin: the marks vector carrying the failed sweep. It names the
  // failure and it is NOT behind the fold.
  const marks = page.getByTestId("book-stamp-marks");
  await expectNotCollapsed(marks);
  await expect(marks).toContainText("sweep⚠");
  for (const stamp of failedSweeps) {
    await expect(marks).toContainText(stamp.engine);
  }

  // The disclosure COUNTS what it hides, and hides only neutral pins.
  const evidence = page.getByTestId("stampline-evidence");
  await expectClosedDetails(evidence);
  await expect(page.getByTestId("book-stamp-evidence-summary")).toHaveText(/^\d+ evidence pins?$/);
  const hidden = await evidence.evaluate(
    (node) => node.querySelectorAll('[class*="stampItem"]').length,
  );
  const summaryText = (await page.getByTestId("book-stamp-evidence-summary").textContent()) ?? "";
  expect(summaryText).toContain(String(hidden));
  // Nothing warn-toned or keepOpen ended up inside it.
  expect(
    await evidence.evaluate((node) =>
      node.querySelector(
        '[data-testid="book-stamp-marks"], [data-testid="book-stamp-gate"], [data-testid="book-stamp-coverage"]',
      ) === null,
    ),
  ).toBe(true);

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

const LAB_BOOK = JSON.parse(labFixture("book.json")) as { batch: { id: number } };

/**
 * THE WELD'S OWN SEEDS — the exact bytes the mock routes below fulfil with,
 * parsed once and typed by the CONTRACT's schemas rather than by a shape this
 * file invents. Every expected sentence in this file is a helper applied to one
 * of these; nothing is transcribed.
 */
const RUN_BOOK_FLAGSHIP = JSON.parse(
  labFixture("run-book.weeth_market_depeg_oracles_held.json"),
) as Schemas["RunBookResponse"];
const RUN_BOOK_COLLISION = JSON.parse(
  labFixture("run-book.collateral-collision.json"),
) as Schemas["RunBookResponse"];
const STRESS_DM_BODY = JSON.parse(labFixture("stress-dm.json")) as {
  address: string;
  scenarios: Schemas["Scenario"][];
};

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

/**
 * A served run book for the weETH depeg scenario, from the fixture named.
 *
 * The fixture is a PARAMETER because the arm under test decides it: the
 * flagship body is a fully served, fully covered run (the right seed for the
 * per-engine slots), the collision body adds the second null-value disclosure
 * to the collateral panel, and the withheld / partial-hole bodies are the only
 * way the absence blocks render at all.
 */
async function runBook(
  page: Page,
  name = "run-book.weeth_market_depeg_oracles_held.json",
): Promise<void> {
  await openLab(page);
  await page.route(`${LAB_API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture(name),
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

  // THE BATCH LINE IS COMPARED AGAINST ITS SOURCE. Cold, it says no run has
  // been issued and reads the frontier's batch off `/v1/book` — the fixture's
  // own id, not a shape.
  const batchLine = page.getByTestId("matrix-batch-line");
  await expect(batchLine).toContainText("no run has been issued yet");
  await expect(batchLine).toContainText(
    `The loss frontier above reads batch #${String(LAB_BOOK.batch.id)}.`,
  );

  // After a run, the same line states the batch the RUN BOOK was measured at,
  // again read off the served body.
  const runBody = JSON.parse(
    labFixture("run-book.weeth_market_depeg_oracles_held.json"),
  ) as { batch: { id: number } };
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
  await expect(batchLine).toContainText(
    `results shown together were measured at batch #${String(runBody.batch.id)}.`,
  );
  await expect(batchLine).not.toContainText("no run has been issued yet");
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
  // The one-line key names all six EXCEPTIONAL states without defining any of
  // them. `LabCellState` has nine arms; the three ordinary ones (not run,
  // running, result) are deliberately not in this key, which is why the key may
  // not call itself the grid's whole vocabulary.
  const key = page.getByTestId("matrix-legend-key");
  await expect(key).toContainText("Six exceptional cell states");
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

test("LabBookPanel BookResult: a REFUSAL, a COVERAGE-FALSE line and a HOLE all render BEFORE the numbers they qualify", async ({
  page,
}) => {
  // (a) THE WITHHELD BODY: aave refused whole-engine, `stress_coverage_is_full`
  // false, one engine served. Every absence is above the answer it qualifies.
  const withheld = JSON.parse(labFixture("run-book.weeth-withheld.json")) as {
    excluded_engines: { engine: string; code: string; detail: string }[];
    coverage: { stress_coverage_is_full: boolean };
  };
  expect(withheld.coverage.stress_coverage_is_full).toBe(false);
  const refusal = withheld.excluded_engines[0];
  expect(refusal).toBeDefined();

  await runBook(page, "run-book.weeth-withheld.json");
  expectSlotOrder(
    await domOrder(page, [
      "book-excluded",
      "book-coverage-not-full",
      "book-result-answer",
      "book-engine",
      "book-result-method",
      "book-result-forensics",
    ]),
  );
  await expectClosedDetails(page.getByTestId("book-result-forensics"));
  // HAZARD: the excluded block never collapses, and it carries the wire's own
  // refusal code and detail rather than a count.
  const excluded = page.getByTestId("book-excluded");
  await expectNotCollapsed(excluded);
  await expect(excluded).toContainText(refusal?.code as string);
  await expect(excluded).toContainText(refusal?.engine as string);
  await expect(excluded).toContainText(refusal?.detail as string);
  await expectNotCollapsed(page.getByTestId("book-coverage-not-full"));
  // The completeness sentence is a claim this body cannot support.
  await expect(page.locator("body")).not.toContainText(
    "excluded engines: none · every engine's book reached the run",
  );
  await expect(page.getByTestId("book-engine")).toHaveCount(1);

  // (b) THE HOLE: a body that refused nothing and simply never mentioned an
  // engine the committed definition covers. `excluded_engines` is EMPTY here,
  // which is the whole condition the completeness line used to be gated on.
  await runBook(page, "run-book.partial-hole.json");
  const hole = page.getByTestId("book-hole");
  await expect(hole).toBeVisible();
  await expectNotCollapsed(hole);
  await expect(hole).toContainText("AN INCOMPLETE BOOK");
  await expect(hole).toContainText("will not fill a hole with a zero");
  await expect(page.locator("body")).not.toContainText(
    "excluded engines: none · every engine's book reached the run",
  );
  expectSlotOrder(await domOrder(page, ["book-excluded", "book-hole", "book-result-answer"]));
});

test("LabBookPanel EngineResult: ANSWER, cards, METHOD, FORENSICS in DOM order", async ({
  page,
}) => {
  await runBook(page);
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

  // THE WELD (round 50), on BOTH answers this body drives.
  //
  // The run book's ANSWER is `bookResultAnswer` over the served `engines[]`,
  // and each engine panel's ANSWER is `engineResultAnswer` over that engine's
  // own facts. The per-engine weld is scoped by `data-engine` rather than taken
  // `.first()`: this fixture serves two engines whose deltas are all zero, so a
  // panel hardcoded with the OTHER engine's sentence differs by a name alone
  // and a first-match gate would never see it.
  expect(RUN_BOOK_FLAGSHIP.engines.length).toBeGreaterThan(1);
  await expectWeld(
    page.getByTestId("book-result-answer"),
    bookResultAnswer(RUN_BOOK_FLAGSHIP.engines),
  );
  for (const engine of RUN_BOOK_FLAGSHIP.engines) {
    const panel = page.locator(`[data-testid="book-engine"][data-engine="${engine.engine}"]`);
    await expectWeld(panel.getByTestId("book-engine-answer"), engineResultAnswer(engine));
  }
});

test("LabRunBook sub-panels: coverage counts before the bars, wire notes behind counted summaries", async ({
  page,
}) => {
  // The COLLISION body is the flagship run with one extra collateral row: it
  // itemizes weETH twice for the Aave aggregate (COUNTED and NOT COUNTED)
  // beside an UNPRICED holding, so the collateral panel's two null-value
  // meanings are both on screen instead of only one.
  const collision = RUN_BOOK_COLLISION;
  const aave = collision.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("the collision fixture serves no aave engine");
  const rows = [...aave.before.collateral_by_asset, ...aave.after.collateral_by_asset];
  const unpriced = rows.filter((row) => row.value_usd === null && row.unpriced).length;
  const notCounted = rows.filter((row) => row.value_usd === null && !row.unpriced).length;
  expect(unpriced).toBeGreaterThan(0);
  expect(notCounted).toBeGreaterThan(0);

  await runBook(page, "run-book.collateral-collision.json");
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

  // COLLATERAL. BOTH side containers render, neither is collapsed, and each
  // carries its own open reading line — the panel's shape may not depend on
  // which side happens to hold a refusal.
  const panel = page.locator(
    '[data-testid="runbook-collateral"][data-engine="aave_v3_etherfi"]',
  );
  for (const side of ["before", "after"]) {
    const container = panel.getByTestId(`runbook-collateral-${side}`);
    await expect(container).toBeVisible();
    await expectNotCollapsed(container);
    await expectNotCollapsed(panel.getByTestId(`runbook-collateral-reading-${side}`));
    // Each side itemizes by asset AND disclosure, so one asset legitimately
    // appears twice; both null-value kinds are named in the wire's vocabulary.
    await expect(
      container.locator('[data-testid="runbook-collateral-row"][data-disclosure="unpriced"]'),
    ).toHaveCount(1);
    await expect(
      container.locator('[data-testid="runbook-collateral-row"][data-disclosure="not-counted"]'),
    ).toHaveCount(1);
    await expect(container).toContainText("UNPRICED · no price witness");
    await expect(container).toContainText("NOT COUNTED");
  }

  // The ANSWER counts the two kinds SEPARATELY, from the served bytes, and
  // never calls a NOT COUNTED balance unknowable.
  const answers = page.getByTestId("runbook-collateral-answer");
  const answerCount = await answers.count();
  expect(answerCount).toBeGreaterThan(0);
  for (let i = 0; i < answerCount; i += 1) await expectNotCollapsed(answers.nth(i));
  const answer = panel.getByTestId("runbook-collateral-answer");
  await expect(answer).toContainText(`${String(unpriced)} are UNPRICED`);
  await expect(answer).toContainText("no price witness");
  await expect(answer).toContainText(`${String(notCounted)} are NOT COUNTED`);
  await expect(answer).toContainText("the balance is exact and known");

  // THE WELD (round 50). Both counts above are clauses OF one sentence, and the
  // sentence is `collateralGroupAnswer` over that engine's two served sides.
  // The aave arm carries both null-value kinds and the debt_manager arm carries
  // neither, so this welds the panel to the helper on BOTH of its arms — the
  // absence claim included, which is the one a hardcoded "every holding is
  // counted" would slip past.
  for (const engine of collision.engines) {
    const enginePanel = page.locator(
      `[data-testid="runbook-collateral"][data-engine="${engine.engine}"]`,
    );
    await expectWeld(
      enginePanel.getByTestId("runbook-collateral-answer"),
      collateralGroupAnswer(engine),
    );
  }

  // METHOD names all three disclosures and promises no hidden figure.
  const method = panel.getByTestId("runbook-collateral-method");
  await expectNotCollapsed(method);
  await expect(method).toContainText("only COUNTED is inside the total");
  await expect(method).not.toContainText("a value exists");
  await expectNotCollapsed(page.getByTestId("runbook-collateral-row").first());
});

test("LabRealization: gloss and the delta-only basis are RENDERED, never hovered", async ({
  page,
}) => {
  await runBook(page);
  await expectNotCollapsed(page.getByTestId("realization-answer").first());
  await expectNotCollapsed(page.getByTestId("seizure-model").first());
  await expectClosedDetails(page.getByTestId("realization-forensics").first());
  await expect(page.getByTestId("realization-answer").first()).toContainText("delta-only");

  // THE WELD (round 50), and the counterexample that produced it. This gate
  // used to be the `toContainText("delta-only")` above and nothing else, so
  // replacing the panel's `{realizationAnswer(realization)}` with a hardcoded
  // "$0/$0 … delta-only" sentence passed: the aave arm of this very fixture
  // reads $0/$0, and `.first()` is the aave arm.
  //
  // Both arms are welded, per engine. The debt_manager arm carries the two
  // nonzero amounts (200000000 / 820000000 at 6 decimals — $200 and $820), so
  // the hardcode that survived the old gate now fails against the engine whose
  // numbers it was never the sentence for.
  const realizing = RUN_BOOK_FLAGSHIP.engines.filter(
    (engine) => engine.market_realization !== null,
  );
  expect(realizing.length).toBeGreaterThan(1);
  for (const engine of realizing) {
    const panel = page.locator(`[data-testid="book-engine"][data-engine="${engine.engine}"]`);
    await expectWeld(
      panel.getByTestId("realization-answer"),
      // Non-null by the filter above; the contract types the field nullable.
      realizationAnswer(engine.market_realization as Schemas["Shortfall"]),
    );
  }
});

test("LabProjectionView: ANSWER, horizon table, METHOD, FORENSICS in DOM order, reading the LONGEST horizon", async ({
  page,
}) => {
  // THE PANEL W-3L CONVERTED AND NEVER GATED. Its slots were asserted only by a
  // test titled for it that touched nothing but the realization panel beside
  // it. The rate axis lives on an address-mode result, so this is where it is.
  const stress = JSON.parse(labFixture("stress-dm.json")) as {
    address: string;
    scenarios: {
      id: string;
      results: {
        projection: {
          annual_delta_bps: number;
          prices_held_flat: boolean;
          horizons: { horizon_seconds: number; becomes_liquidatable: boolean | null }[];
        } | null;
      }[];
    }[];
  };
  const scenario = stress.scenarios.find(
    (candidate) => candidate.id === "dm_rate_horizon_plus_200bps",
  );
  const projection = scenario?.results[0]?.projection;
  if (projection === undefined || projection === null) {
    throw new Error("stress-dm.json serves no projection");
  }
  const longest = projection.horizons.reduce((best, horizon) =>
    horizon.horizon_seconds > best.horizon_seconds ? horizon : best,
  );
  expect(projection.horizons.length).toBeGreaterThan(1);
  // The longest horizon is NOT the first one served, which is the whole point
  // of a takeaway that reduces rather than reads index 0.
  expect(projection.horizons[0]?.horizon_seconds).not.toBe(longest.horizon_seconds);

  await openLab(page);
  await page.route(`${LAB_API}/v1/address/${stress.address}/stress`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("stress-dm.json"),
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
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="dm_rate_horizon_plus_200bps"]')
    .click();

  await expect(page.getByTestId("projection-panel")).toBeVisible();
  expectSlotOrder(
    await domOrder(page, [
      "projection-answer",
      "projection-method",
      "projection-forensics",
      "projection-apy-block",
      "projection-wire-note",
    ]),
  );
  await expectClosedDetails(page.getByTestId("projection-forensics"));

  // ANSWER and METHOD are open, and both are computed from the served body.
  const answer = page.getByTestId("projection-answer");
  await expectNotCollapsed(answer);
  await expect(answer).toContainText(
    `Over ${String(longest.horizon_seconds / 86_400)} days, the longest horizon served`,
  );
  await expect(answer).toContainText(
    longest.becomes_liquidatable === true
      ? "this position becomes liquidatable"
      : "does not become liquidatable",
  );
  const method = page.getByTestId("projection-method");
  await expectNotCollapsed(method);
  await expect(method).toContainText(`annual Δ +${String(projection.annual_delta_bps)} bps`);
  // HAZARD: `prices_held_flat` is a HELD INPUT, so it rides the open METHOD
  // line rather than sitting beside the APY block inside FORENSICS.
  expect(projection.prices_held_flat).toBe(true);
  await expect(method).toContainText("Prices are held flat across every horizon");
  await expect(page.getByTestId("projection-forensics")).not.toContainText(
    "Prices are held flat across every horizon",
  );

  // THE WELD (round 50). `projectionAnswer` wants a REFINED projection — the
  // sealed `liquidation_verdict` union, not the wire's nullable boolean — so
  // the expectation refines the served scenario through the client's OWN
  // `refineScenario`, which is the function the page's lookup runs the body
  // through. Re-deriving a verdict here would have welded the panel to this
  // spec's opinion of what `becomes_liquidatable: null` means, which is exactly
  // the read the sealed union exists to take away from callers.
  const refined = refineScenario(
    STRESS_DM_BODY.scenarios.find(
      (candidate) => candidate.id === "dm_rate_horizon_plus_200bps",
    ) as Schemas["Scenario"],
  );
  const refinedProjection = refined.results[0]?.projection;
  if (refinedProjection === undefined || refinedProjection === null) {
    throw new Error("the refined scenario serves no projection");
  }
  await expectWeld(answer, projectionAnswer(refinedProjection));
});

test("LabBoundaryGroup: the ANSWER is the group's own helper over the served committed set", async ({
  page,
}) => {
  // THE PANEL WITH NO SLOT GATE AT ALL (Codex round 50). `boundary-answer` was
  // asserted nowhere in this file, and the copy pins beside it read the member
  // grid rather than the sentence — so the group's members, its re-pricing
  // count and its two snap totals could all have been typed by hand.
  //
  // The expectation composes the SAME two steps the panel composes: the group
  // is `stableBoundaryScenarios` over the refined committed set, and the
  // sentence is `boundaryGroupAnswer` over that group. Both come from the
  // module the component imports them from.
  const committed = STRESS_DM_BODY.scenarios.map((scenario) => refineScenario(scenario));
  const group = stableBoundaryScenarios(committed);
  expect(group.length).toBeGreaterThan(0);
  // The group is a SUBSET, so the sentence is a claim about the filter too: a
  // panel that answered over every served scenario would count differently.
  expect(group.length).toBeLessThan(committed.length);

  await openLab(page);
  await page.route(`${LAB_API}/v1/address/${STRESS_DM_BODY.address}/stress`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: labFixture("stress-dm.json"),
    }),
  );
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  await expect(async () => {
    await input.fill(STRESS_DM_BODY.address);
    await expect(button).toBeEnabled({ timeout: 500 });
  }).toPass();
  await button.click();

  await expect(page.getByTestId("lab-boundary-group")).toBeVisible();
  const answer = page.getByTestId("boundary-answer");
  // R3/R7 still hold on it: the snap totals are a modelling disclosure and may
  // not live behind the panel's fold.
  await expectNotCollapsed(answer);
  await expectWeld(answer, boundaryGroupAnswer(group));
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
