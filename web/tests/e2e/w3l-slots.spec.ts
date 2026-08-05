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
//
// WAVE W-3L-D (Codex round 52). THE WELDS WERE REAL AND THE FIXTURES WERE FLAT.
// Seven of the eight welds above could not fail, because a weld is an equality
// between two computations and an equality proves nothing when the numbers on
// both sides COINCIDE:
//
//   waterfall     both engines reach the deepest grid point with exactly one
//                 eligible account, so the account clause reads the same
//                 whichever engine's census the panel took it from;
//   positions     loaded, qualifying and on-book were all 2, so the three
//                 arguments were interchangeable;
//   book result   both engines' counts and debt deltas were zero;
//   engine result all six deltas were zero;
//   collateral    the two sides were byte-identical, so counting one twice
//                 gave the same totals as counting both;
//   projection    both served horizons carried the same verdict, so reading
//                 the first horizon and reading the longest agreed;
//   boundary      the group's single member answered exactly as the ONE
//                 committed scenario that is not in it.
//
// Each weld below now runs against a body whose inputs are SEPARATED — either
// a committed fixture that already carries the separation, or a derived delta
// of one, provenance-commented at its definition on the pattern
// `state-matrix.spec.ts` set. Each also carries a NON-COINCIDENCE assertion
// beside it: the helper applied to the wrong input, compared against the
// helper applied to the right one, and required to differ. That assertion is
// what stops a later fixture edit from quietly flattening the weld again.
//
// The shape gates and the hazard gates keep the committed bodies they were
// written against. Only the welds moved.

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

const AAVE = "aave_v3_etherfi";

const COMMITTED_WATERFALL = BOOK.waterfall;
if (COMMITTED_WATERFALL === null) {
  throw new Error("the committed book fixture serves no waterfall");
}

/** The last grid point on the committed waterfall — the one every ANSWER reads. */
const DEEPEST_POINT_INDEX = COMMITTED_WATERFALL.points.reduce(
  (deepest, point) => (point.index > deepest ? point.index : deepest),
  0,
);

/**
 * DERIVED FIXTURE (provenance): the committed `book.json` given a THIRD Aave
 * position, and the deepest grid point that follows from it.
 *
 * WHY THE COMMITTED BOOK CANNOT PROVE THE TWO WELDS IT FEEDS. Its Aave book
 * holds two positions (one computed, one refused) and its Debt Manager book
 * holds two more, so `aggregate.positions` is 2 on both engines, the served
 * positions page states 2 qualifying rows, and the walk loads 2. Three
 * different questions, one answer. On the waterfall the same flatness appears
 * a second time: both engines arrive at −50% carrying exactly one eligible
 * account, so the ANSWER's account clause is the same number on either engine.
 *
 * WHAT MOVED, and it moves together:
 *
 *   the Aave book gains one COMPUTED position (3 = 2 computed + 1 refused),
 *   with the batch's census, this layer's coverage and the standing HF
 *   histogram all counting it — the new account stands in the same
 *   1.05 – 1.10 band as the one already there;
 *
 *   the Aave aggregate's collateral and debt grow by that account's own
 *   $100.00 / $150.00, which is what leaves the waterfall room to make it
 *   eligible without claiming more eligible debt than the book carries;
 *
 *   the DEEPEST grid point (and only that point) brings it in: one account
 *   ARRIVES there, the running census reaches two, both are insolvent when
 *   liquidated, and the three cumulative money columns absorb its debt, its
 *   collateral at risk and its $50.00 shortfall.
 *
 * Nothing shallower on the grid moves, so the committed monotonicity claim is
 * still the served body's own: every column still rises.
 */
const BOOK_AAVE_SECOND_ARRIVAL: typeof BOOK = {
  ...BOOK,
  batch: { ...BOOK.batch, position_count: 5 },
  coverage: { ...BOOK.coverage, batch_positions: 5, in_book: 3 },
  engines: BOOK.engines.map((engine) =>
    engine.engine !== AAVE
      ? engine
      : {
          ...engine,
          positions: 3,
          computed_positions: 2,
          total_collateral: "810000000000",
          total_debt: "615000000000",
        },
  ),
  hf_histogram: {
    ...BOOK.hf_histogram,
    engines: BOOK.hf_histogram.engines.map((engine) =>
      engine.engine !== AAVE
        ? engine
        : {
            ...engine,
            // The Aave engine carries exactly one occupied band, and the new
            // account stands in it beside the one already counted.
            buckets: engine.buckets.map((bucket) =>
              bucket.count === 1 ? { ...bucket, count: 2 } : bucket,
            ),
          },
    ),
  },
  waterfall: {
    ...COMMITTED_WATERFALL,
    points: COMMITTED_WATERFALL.points.map((point) =>
      point.index !== DEEPEST_POINT_INDEX
        ? point
        : {
            ...point,
            engines: point.engines.map((entry) =>
              entry.engine !== AAVE
                ? entry
                : {
                    ...entry,
                    newly_eligible_accounts: 1,
                    cumulative_eligible_accounts: 2,
                    insolvent_if_liquidated_accounts: 2,
                    cumulative_debt_eligible_usd: "615000000000",
                    cumulative_collateral_at_risk_usd: "410000000000",
                    cumulative_bad_debt_usd: "224047619048",
                  },
            ),
          },
    ),
  },
};

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

  // THE WELD (round 50, re-fixtured in W-3L-D). Each engine's ANSWER is
  // `waterfallEngineAnswer` over the SERVED waterfall — computed here from the
  // same bytes the route fulfils with, and compared whole. Both engines are
  // welded, because the two carry different decimals and a single-engine gate
  // would pass over a panel that had quietly hardcoded the other one's
  // sentence.
  //
  // The DERIVED book is what makes the account clause load-bearing: on the
  // committed one both engines reach the deepest point with a census of 1, so
  // a panel that read the wrong engine's count — or none at all — printed the
  // right number anyway.
  await openBook(page, "/book?engine=aave_v3_etherfi", BOOK_AAVE_SECOND_ARRIVAL);
  const served = BOOK_AAVE_SECOND_ARRIVAL.waterfall;
  expect(served, "the derived book serves no waterfall").not.toBeNull();
  const waterfall = served as Waterfall;
  const engines = Array.from(
    new Set(waterfall.points.flatMap((point) => point.engines.map((entry) => entry.engine))),
  );
  expect(engines.length).toBeGreaterThan(1);

  // NON-COINCIDENCE. The deepest point's two engines no longer agree on the one
  // input they used to share, and the proof is the swap itself: give Aave the
  // Debt Manager's census and the sentence has to change. On the committed book
  // it did not.
  const deepest = waterfall.points.find((point) => point.index === DEEPEST_POINT_INDEX);
  if (deepest === undefined) throw new Error("the derived waterfall lost its deepest point");
  const censuses = deepest.engines.map((entry) => entry.cumulative_eligible_accounts);
  expect(new Set(censuses).size).toBe(censuses.length);
  const swapped: Waterfall = {
    ...waterfall,
    points: waterfall.points.map((point) =>
      point.index !== DEEPEST_POINT_INDEX
        ? point
        : {
            ...point,
            engines: point.engines.map((entry, index) => ({
              ...entry,
              cumulative_eligible_accounts: censuses[censuses.length - 1 - index] ?? 0,
            })),
          },
    ),
  };
  for (const engine of engines) {
    expect(waterfallEngineAnswer(swapped, engine)).not.toBe(
      waterfallEngineAnswer(waterfall, engine),
    );
  }

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

  // THE WELD (round 50, re-fixtured in W-3L-D). The takeaway is
  // `positionsAnswerLine` over the walk this table renders, and every argument
  // is derived here rather than typed: the engine/sort/direction come out of
  // the app's OWN deep-link normalizer fed the URL this test opened, and the
  // three counts come off the served bodies. Restating the ranking vocabulary
  // by hand would have welded the panel to a second opinion about what the URL
  // means.
  //
  // THREE COUNTS, THREE NUMBERS. On the committed pages the sentence read
  // "2 of 2 qualifying rows loaded, 2 on book", so the three arguments could be
  // permuted freely and nothing on the page moved. The walk below separates
  // them and stays honest about how:
  //
  //   on book  3 — the derived Aave book's own position count;
  //   qualifying 2 — the committed page's own `total_positions`, which counts
  //                  rows qualifying at the table's dust step and is therefore
  //                  legitimately smaller than the unfiltered book;
  //   loaded   1 — page one landed and page TWO WAS REFUSED, so the walk is
  //                genuinely short of its denominator rather than a fixture
  //                claiming a walk that both finished and came up missing.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK_AAVE_SECOND_ARRIVAL));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    // The MAP's full-book walk carries no `sort`. It gets the committed pages
    // and exhausts them, so the only thing left mid-flight on this page is the
    // table whose sentence is under test.
    if (url.searchParams.get("sort") === null) {
      return cursor === null
        ? fulfillJson(route, POSITIONS_AAVE_PAGE_1)
        : fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    return cursor === null
      ? fulfillJson(route, POSITIONS_AAVE_PAGE_1)
      : fulfillJson(route, BOOK_ERROR_UNAVAILABLE, 503);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const query = normalizeBookQuery("aave_v3_etherfi", null, null);
  const aggregate = BOOK_AAVE_SECOND_ARRIVAL.engines.find(
    (candidate) => candidate.engine === query.engine,
  );
  if (aggregate === undefined) throw new Error("the derived book serves no aave aggregate");
  expect(aggregate.refused).toBe(false);
  const total = POSITIONS_AAVE_PAGE_1.total_positions;
  if (total === null) throw new Error("the committed page states no qualifying total");
  const loaded = POSITIONS_AAVE_PAGE_1.positions.length;
  expect(new Set([loaded, total, aggregate.positions]).size).toBe(3);

  const args = {
    engine: query.engine,
    sort: query.sort,
    reversed: query.reversed,
    loaded,
    qualifying: String(total),
    onBook: String(aggregate.positions),
  };
  // NON-COINCIDENCE: every permutation of the three counts is a DIFFERENT
  // sentence now, which is what makes the equality below a claim about which
  // number went where.
  expect(
    positionsAnswerLine({ ...args, qualifying: args.onBook, onBook: args.qualifying }),
  ).not.toBe(positionsAnswerLine(args));
  expect(positionsAnswerLine({ ...args, loaded: Number(args.qualifying) })).not.toBe(
    positionsAnswerLine(args),
  );

  await expectWeld(page.getByTestId("positions-answer"), positionsAnswerLine(args));
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

/**
 * The committed −30% ETH run book. It is the price-shock body rather than the
 * flagship one, and that is the whole reason W-3L-D reaches for it: the
 * flagship scenario holds every oracle (`hfs_unchanged` asserts it), so its
 * before and after states are byte-identical and all six of its deltas are
 * zero. Zero is a number every wrong input also produces.
 */
const RUN_BOOK_PRICE_SHOCK = JSON.parse(
  labFixture("run-book.eth_minus_30.json"),
) as Schemas["RunBookResponse"];

/**
 * DERIVED FIXTURE (provenance): the committed `run-book.eth_minus_30.json`
 * with ONE more Debt Manager account arriving in eligibility, carried through
 * every aggregate the wire states.
 *
 * WHY THE COMMITTED BODY IS NOT ENOUGH. Its debt and bad-debt deltas already
 * differ between the engines, which is most of what the two ANSWERs read. Its
 * ACCOUNT counts do not: both engines report `newly_eligible_accounts: 1`, so
 * a panel that hardcoded the count, or took the other engine's, printed the
 * same "+1" either way.
 *
 * WHAT MOVED. The Debt Manager's after-side census goes from 2 eligible
 * accounts to 3, and the third account is carried at its own size: $50.00 of
 * debt (which is the last of the $6,170.00 the engine's after side already
 * states as total debt, so the eligible figure lands on it exactly), $40.00 of
 * collateral at risk, and the $10.00 shortfall between them. The engine's
 * three published deltas are recomputed as after minus before over those same
 * aggregates — nothing here is a delta the two sides beside it disagree with.
 */
const RUN_BOOK_SPLIT_DELTAS: Schemas["RunBookResponse"] = {
  ...RUN_BOOK_PRICE_SHOCK,
  engines: RUN_BOOK_PRICE_SHOCK.engines.map((engine) =>
    engine.engine !== "debt_manager"
      ? engine
      : {
          ...engine,
          newly_eligible_accounts: 2,
          eligible_debt_delta_usd: "1550000000",
          bad_debt_delta_usd: "1198118812",
          after: {
            ...engine.after,
            eligible_accounts: 3,
            eligible_debt_usd: "6170000000",
            collateral_at_risk_usd: "4355000000",
            bad_debt_usd: "1857722773",
          },
        },
  ),
};

/** The first member of a served list, or a named failure — `[0]` is `| undefined` here. */
function firstOrThrow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`the committed fixture serves no ${what}`);
  return row;
}

/** A served field the derivations below build on, or a named failure. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`the committed fixture serves no ${what}`);
  }
  return value;
}

const NOT_COUNTED_NOTE =
  "NOT COUNTED AS COLLATERAL: the account holds this balance and the engine assigns none of " +
  "it a counted USD value on this side. `amount` is exact; none of it is inside " +
  "`total_collateral_usd`.";
const UNPRICED_NOTE =
  "UNPRICED: no price witness describes this balance on this side, so its USD value is " +
  "UNKNOWABLE — not zero. `amount` is exact; none of it is inside `total_collateral_usd`.";

/**
 * DERIVED FIXTURE (provenance): the committed
 * `run-book.collateral-collision.json` with one holding APPENDED per side,
 * carrying a different disclosure before the shock than after it.
 *
 * WHY THE COMMITTED BODY CANNOT PROVE THIS WELD. `collateralGroupAnswer`
 * counts each side's null-value rows independently and then adds them, and the
 * collision body's two sides are byte-identical on both engines. A panel that
 * counted one side and doubled it produced the same three numbers, so the
 * equality held over a component that had never read the after side at all.
 *
 * WHAT MOVED. Both engines gain the same holding on both relevant sides, and
 * the disclosure it carries is what differs:
 *
 *   Aave — NOT COUNTED before the shock, UNPRICED after it, so the two sides
 *          carry the same number of valueless rows and a different mix;
 *   Debt Manager — NOT COUNTED on the after side only, against committed sides
 *          that carry no valueless row at all, so its sentence crosses the
 *          "every holding carries a counted value" boundary.
 *
 * Every appended row carries `value_usd: null`, and the panel's own METHOD
 * line says only COUNTED is inside the total — so no `total_collateral_usd` on
 * either side of either engine moves, and none had to be restated.
 */
const RUN_BOOK_COLLATERAL_SIDES_DIFFER: Schemas["RunBookResponse"] = {
  ...RUN_BOOK_COLLISION,
  engines: RUN_BOOK_COLLISION.engines.map((engine) => {
    const held = {
      ...firstOrThrow(engine.before.collateral_by_asset, "collateral row to shape"),
      asset: "0x000000000000000000000000000000000000FEed",
      symbol: "sUSDe",
      amount: "3000000000000000000",
      value_usd: null,
    };
    if (engine.engine !== AAVE) {
      return {
        ...engine,
        after: {
          ...engine.after,
          collateral_by_asset: [
            ...engine.after.collateral_by_asset,
            { ...held, unpriced: false, note: NOT_COUNTED_NOTE },
          ],
        },
      };
    }
    return {
      ...engine,
      before: {
        ...engine.before,
        collateral_by_asset: [
          ...engine.before.collateral_by_asset,
          { ...held, unpriced: false, note: NOT_COUNTED_NOTE },
        ],
      },
      after: {
        ...engine.after,
        collateral_by_asset: [
          ...engine.after.collateral_by_asset,
          { ...held, unpriced: true, note: UNPRICED_NOTE },
        ],
      },
    };
  }),
};

const RATE_SCENARIO_ID = "dm_rate_horizon_plus_200bps";
const IN_BAND_SCENARIO_ID = "stable_depeg_0995_in_band";

/**
 * DERIVED FIXTURE (provenance): the committed `stress-dm.json` with the
 * SHORTEST projection horizon's `becomes_liquidatable` withheld (`null`).
 *
 * WHY THE COMMITTED BODY CANNOT PROVE THIS WELD. Both served horizons carry
 * `true`, so the panel's takeaway read the same either way and a component
 * that took the first horizon's verdict instead of the longest one's passed.
 *
 * WHY THE SHORT HORIZON IS THE ONE WITHHELD. The wire's own note on this
 * projection says the base accrual is absent from the path and that no
 * time-to-liquidatable is published from a path that would understate debt
 * growth. Over 90 days the +200bps step alone is decisive; over 30 it is not,
 * and a body that says so is stating a withheld verdict rather than a no —
 * which is exactly the third arm `projectionAnswer` exists to keep separate.
 */
const STRESS_DM_SPLIT_HORIZONS: typeof STRESS_DM_BODY = {
  ...STRESS_DM_BODY,
  scenarios: STRESS_DM_BODY.scenarios.map((scenario) => {
    if (scenario.id !== RATE_SCENARIO_ID) return scenario;
    return {
      ...scenario,
      results: scenario.results.map((result) => {
        const projection = result.projection;
        if (projection === null) return result;
        const shortest = projection.horizons.reduce(
          (best, horizon) => (horizon.horizon_seconds < best ? horizon.horizon_seconds : best),
          Number.POSITIVE_INFINITY,
        );
        return {
          ...result,
          projection: {
            ...projection,
            horizons: projection.horizons.map((horizon) =>
              horizon.horizon_seconds === shortest
                ? { ...horizon, becomes_liquidatable: null }
                : horizon,
            ),
          },
        };
      }),
    };
  }),
};

/**
 * DERIVED FIXTURE (provenance): the committed `stress-dm.json` with TWO more
 * members on the `stable_usd` axis, both outside the Debt Manager's open snap
 * band.
 *
 * WHY THE COMMITTED BODY CANNOT PROVE THIS WELD. Its stable axis carries one
 * member, whose result is applicable, bit-identical and shocked by nothing, so
 * the group's sentence is "1 committed member … 0 re-priced … 0 shocks snapped
 * … 0 snapped at the base" — WORD FOR WORD what the rate scenario beside it
 * produces, and the rate scenario is the one member the filter is there to
 * exclude. A panel answering over the wrong set said the right thing.
 *
 * WHAT THE TWO NEW MEMBERS ARE. This address's debt is stable-denominated, so
 * a depeg the band does not swallow re-prices it:
 *
 *   0.975 — outside the open (0.990, 1.010) band, applied as asked, so the
 *           served debt falls to $4,095.00 and the pair MOVES;
 *   0.900 — below the model's stable floor, so the engine applied 0.950
 *           instead and says so on the shock itself (`snapped`, and
 *           `base_snapped` for the mark it started from). The pair moves to
 *           the SNAPPED level, $3,990.00, not the asked one.
 *
 * The collateral side is weETH and does not move on this axis, which is why
 * only the debt-bearing fields of the pair differ.
 */
const IN_BAND_SCENARIO = required(
  STRESS_DM_BODY.scenarios.find((scenario) => scenario.id === IN_BAND_SCENARIO_ID),
  "in-band stable member",
);
const IN_BAND_RESULT = firstOrThrow(IN_BAND_SCENARIO.results, "in-band stable result");
const IN_BAND_BEFORE = required(IN_BAND_RESULT.before, "in-band stable before state");

function depegMember(args: {
  id: string;
  label: string;
  description: string;
  askedNum: number;
  appliedNum: number;
  debtUsd: string;
  snapped: boolean;
}): Schemas["Scenario"] {
  return {
    ...IN_BAND_SCENARIO,
    id: args.id,
    label: args.label,
    description: args.description,
    shocks: [{ axis: "stable_usd", factor_num: args.askedNum, factor_den: 1000 }],
    results: [
      {
        ...IN_BAND_RESULT,
        after: {
          ...IN_BAND_BEFORE,
          health_factor_den: args.debtUsd,
          debt_usd: args.debtUsd,
        },
        applied_shocks: [
          {
            asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
            chain_id: 10,
            source: "dmstable:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
            factor_num: String(args.appliedNum),
            factor_den: "1000",
            before: "1000000",
            after: String(args.appliedNum * 1000),
            snapped: args.snapped,
            base_snapped: args.snapped,
            cap_bound: false,
          },
        ],
      },
    ],
  };
}

const STRESS_DM_WIDER_BAND: typeof STRESS_DM_BODY = {
  ...STRESS_DM_BODY,
  scenarios: [
    ...STRESS_DM_BODY.scenarios,
    depegMember({
      id: "stable_depeg_0975_repriced",
      label: "Stablecoin depeg to 0.975 (outside the snap band)",
      description:
        "0.975 falls outside the Debt Manager's open (0.990, 1.010) band, so the mark is " +
        "applied as asked and this address's stable-denominated debt re-prices with it.",
      askedNum: 975,
      appliedNum: 975,
      debtUsd: "4095000000",
      snapped: false,
    }),
    depegMember({
      id: "stable_depeg_0900_snapped",
      label: "Stablecoin depeg to 0.900 (snapped to the model floor)",
      description:
        "0.900 sits below the model's stable floor, so the engine applied 0.950 instead. The " +
        "snap is disclosed on the shock: the shock applied is not the shock the scenario asked " +
        "for, and the served pair moves to the applied level rather than the asked one.",
      askedNum: 900,
      appliedNum: 950,
      debtUsd: "3990000000",
      snapped: true,
    }),
  ],
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
async function runBookBody(page: Page, body: string, scenarioId: string): Promise<void> {
  await openLab(page);
  await page.route(`${LAB_API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body }),
  );
  await page.locator(`[data-testid="lab-chip"][data-scenario-id="${scenarioId}"]`).click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

async function runBook(
  page: Page,
  name = "run-book.weeth_market_depeg_oracles_held.json",
): Promise<void> {
  await runBookBody(page, labFixture(name), "weeth_market_depeg_oracles_held");
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

  // THE WELD (round 50, re-fixtured in W-3L-D), on BOTH answers a run book
  // drives.
  //
  // The run book's ANSWER is `bookResultAnswer` over the served `engines[]`,
  // and each engine panel's ANSWER is `engineResultAnswer` over that engine's
  // own facts. The per-engine weld is scoped by `data-engine` rather than taken
  // `.first()`: a panel hardcoded with the OTHER engine's sentence differs by a
  // name alone and a first-match gate would never see it.
  //
  // The body is the −30% price shock with a separated Debt Manager census,
  // because the flagship this test's shape assertions run on holds every
  // oracle: six deltas, all zero, on both engines. Three cards reading "+0",
  // "$0.00" and "$0.00" cannot tell a computed sentence from a written one.
  await runBookBody(page, JSON.stringify(RUN_BOOK_SPLIT_DELTAS), "eth_minus_30");
  const shocked = RUN_BOOK_SPLIT_DELTAS.engines;
  expect(shocked.length).toBeGreaterThan(1);

  // NON-COINCIDENCE: every figure the two sentences read is nonzero, and no two
  // engines share one.
  for (const column of [
    shocked.map((engine) => String(engine.newly_eligible_accounts)),
    shocked.map((engine) => engine.eligible_debt_delta_usd),
    shocked.map((engine) => engine.bad_debt_delta_usd),
  ]) {
    expect(new Set(column).size).toBe(column.length);
    expect(column.every((value) => /[1-9]/.test(value))).toBe(true);
  }
  const flattened = shocked.map((engine) => ({
    ...engine,
    newly_eligible_accounts: 0,
    eligible_debt_delta_usd: "0",
    bad_debt_delta_usd: "0",
  }));
  expect(bookResultAnswer(flattened)).not.toBe(bookResultAnswer(shocked));
  for (const [index, engine] of shocked.entries()) {
    const flat = flattened[index];
    if (flat === undefined) throw new Error("the flattened engine list lost a member");
    expect(engineResultAnswer(flat)).not.toBe(engineResultAnswer(engine));
  }

  await expectWeld(page.getByTestId("book-result-answer"), bookResultAnswer(shocked));
  for (const engine of shocked) {
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

  // METHOD names all three disclosures and promises no hidden figure.
  const method = panel.getByTestId("runbook-collateral-method");
  await expectNotCollapsed(method);
  await expect(method).toContainText("only COUNTED is inside the total");
  await expect(method).not.toContainText("a value exists");
  await expectNotCollapsed(page.getByTestId("runbook-collateral-row").first());

  // THE WELD (round 50, re-fixtured in W-3L-D). Both counts above are clauses
  // OF one sentence, and the sentence is `collateralGroupAnswer` over that
  // engine's TWO served sides. It runs against the sides-differ body, because
  // the collision body's sides are byte-identical: the helper counts each side
  // and adds them, so a panel counting one side twice produced the same three
  // numbers and the equality held over a component that never read the after
  // side.
  await runBookBody(
    page,
    JSON.stringify(RUN_BOOK_COLLATERAL_SIDES_DIFFER),
    "weeth_market_depeg_oracles_held",
  );
  const census = (
    side: readonly { value_usd: string | null; unpriced: boolean }[],
  ): string => {
    const nulls = side.filter((entry) => entry.value_usd === null);
    return `${String(nulls.filter((entry) => entry.unpriced).length)}/${String(
      nulls.filter((entry) => !entry.unpriced).length,
    )}`;
  };
  for (const engine of RUN_BOOK_COLLATERAL_SIDES_DIFFER.engines) {
    // NON-COINCIDENCE: the two sides' valueless censuses differ, so counting
    // `before` twice is a different sentence — on the aave arm, which carries
    // both null-value kinds, AND on the debt_manager arm, which crosses the
    // "every holding carries a counted value" boundary.
    expect(census(engine.before.collateral_by_asset)).not.toBe(
      census(engine.after.collateral_by_asset),
    );
    expect(collateralGroupAnswer({ before: engine.before, after: engine.before })).not.toBe(
      collateralGroupAnswer(engine),
    );
    const enginePanel = page.locator(
      `[data-testid="runbook-collateral"][data-engine="${engine.engine}"]`,
    );
    await expectWeld(
      enginePanel.getByTestId("runbook-collateral-answer"),
      collateralGroupAnswer(engine),
    );
  }
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
  //
  // W-3L-D serves the SPLIT-HORIZON body: the committed one carries the same
  // verdict on both horizons, so a takeaway reading the first horizon and one
  // reducing to the longest printed the same sentence.
  const stress = STRESS_DM_SPLIT_HORIZONS;
  const scenario = stress.scenarios.find((candidate) => candidate.id === RATE_SCENARIO_ID);
  const projection = scenario?.results[0]?.projection;
  if (projection === undefined || projection === null) {
    throw new Error("the split-horizon stress body serves no projection");
  }
  const longest = projection.horizons.reduce((best, horizon) =>
    horizon.horizon_seconds > best.horizon_seconds ? horizon : best,
  );
  expect(projection.horizons.length).toBeGreaterThan(1);
  // The longest horizon is NOT the first one served, which is the whole point
  // of a takeaway that reduces rather than reads index 0.
  expect(projection.horizons[0]?.horizon_seconds).not.toBe(longest.horizon_seconds);
  // NON-COINCIDENCE: the served horizons no longer agree on a verdict either,
  // so reading the wrong one is a different sentence and not just a different
  // index.
  expect(
    new Set(projection.horizons.map((horizon) => horizon.becomes_liquidatable)).size,
  ).toBeGreaterThan(1);

  await openLab(page);
  await page.route(`${LAB_API}/v1/address/${stress.address}/stress`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify(stress),
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
  const rateScenario = stress.scenarios.find((candidate) => candidate.id === RATE_SCENARIO_ID);
  if (rateScenario === undefined) throw new Error("the served body lost its rate scenario");
  const refined = refineScenario(rateScenario);
  const refinedProjection = refined.results[0]?.projection;
  if (refinedProjection === undefined || refinedProjection === null) {
    throw new Error("the refined scenario serves no projection");
  }
  // NON-COINCIDENCE, in the sealed vocabulary the helper actually reads: feed
  // every horizon the FIRST one's verdict — the wrong-index read this weld is
  // here to catch — and the sentence has to move.
  const firstVerdict = refinedProjection.horizons[0]?.liquidation_verdict;
  if (firstVerdict === undefined) throw new Error("the refined projection serves no horizon");
  expect(
    projectionAnswer({
      ...refinedProjection,
      horizons: refinedProjection.horizons.map((horizon) => ({
        ...horizon,
        liquidation_verdict: firstVerdict,
      })),
    }),
  ).not.toBe(projectionAnswer(refinedProjection));

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
  //
  // W-3L-D serves the WIDER-BAND body. On the committed set the stable axis
  // held one member whose result was applicable, bit-identical and shocked by
  // nothing, so the group's sentence was four zeroes and one member — the same
  // sentence the rate scenario beside it produces, and the rate scenario is
  // precisely what the filter exists to leave out.
  const committed = STRESS_DM_WIDER_BAND.scenarios.map((scenario) => refineScenario(scenario));
  const group = stableBoundaryScenarios(committed);
  expect(group.length).toBeGreaterThan(1);
  // The group is a SUBSET, so the sentence is a claim about the filter too: a
  // panel that answered over every served scenario would count differently.
  expect(group.length).toBeLessThan(committed.length);
  // NON-COINCIDENCE: the wrong set — the first served scenario, which is the
  // rate member the filter drops — no longer produces the group's sentence.
  expect(boundaryGroupAnswer(committed.slice(0, 1))).not.toBe(boundaryGroupAnswer(group));
  expect(boundaryGroupAnswer(committed)).not.toBe(boundaryGroupAnswer(group));

  await openLab(page);
  await page.route(`${LAB_API}/v1/address/${STRESS_DM_WIDER_BAND.address}/stress`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify(STRESS_DM_WIDER_BAND),
    }),
  );
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  await expect(async () => {
    await input.fill(STRESS_DM_WIDER_BAND.address);
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
