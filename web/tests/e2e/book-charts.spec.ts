// W-UX-D (charts supplement 16–18 + captions a/b/c) e2e — MOCKED API via
// route interception; every base body comes from tests/fixtures/book.ts (the
// generated, contract-validated fixtures). Mutations are structuredClone
// surgery on those bodies, done IN THE TEST so the computed-not-hardcoded
// law can be proven by watching the rendered line change.
//
// Asserted rulings:
//   §16 (as AMENDED by W-HR-A) — the risk map's full-book walk AUTO-STARTS on
//         mount with no button, disclosing "walked N of M"; 409 mid-walk
//         restarts VISIBLY from page one (the BookPositions notice grammar
//         verbatim); completion renders the "full book · n positions · as-of
//         batch #id" header over the DensityMap. The partial page-scatter and
//         its abort control are GONE — see the auto-walk test for why.
//   §17 — reading lines render per histogram panel, COMPUTED from the same
//         /v1/book response (mutate the fixture → the line changes); the
//         wire note stays visible; the Liquidatable card sub carries the Σ.
//   §18 — waterfall percent labels via factorDistancePercent, the unshocked
//         census, dust-only-appends; the section note / bad-debt legend /
//         eligible-vs-realized gloss verbatim; at_risk_note ABSENT from the
//         Book waterfall panel but PRESENT in the Developers raw register.
//   (a) — held-flat counted-disclosure pattern on Book and Lab, raw units.
//   (c) — Lab run-book notes as a counted verbatim details; the
//         collateral-at-risk row carries the reader caption as title.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BATCH_SUPERSEDED,
  BOOK,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

const CORS = { "access-control-allow-origin": "*" };
const API = "http://localhost:8080";

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

/**
 * W-HR-A made debt_manager the default engine; these fixtures are the aave
 * book, so the engine is named explicitly rather than assumed.
 */
async function openBook(page: Page, path = "/book?engine=aave_v3_etherfi"): Promise<void> {
  await muteStream(page);
  await page.goto(path);
}

// ---------------------------------------------------------------------------
// §17 — reading lines: computed, never asserted.
// ---------------------------------------------------------------------------

test("reading lines render per panel from the served /v1/book values", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  // Zero eligible members ⇒ NO "· all dust" (W-UX-C micro-ruling 1): the
  // adjective needs members to describe; the $0 Σ still renders.
  await expect(page.getByTestId("hist-reading-aave_v3_etherfi")).toHaveText(
    "What this shows: how many accounts sit at each health factor. 0 of 1 are below 1.00, " +
      "where the engine may liquidate — Σ eligible debt $0.",
  );
  await expect(page.getByTestId("hist-reading-debt_manager")).toHaveText(
    "What this shows: how many accounts sit at each borrow-headroom ratio — a disclosure, " +
      "not the engine's trigger. The engine's own verdict counts 1 of 1 liquidatable — " +
      "Σ eligible debt $4,200.",
  );

  // The wire histogram.note stays VISIBLE in the dim register — no collapse,
  // no tooltip-only doctrine.
  await expect(page.getByTestId("book-histogram-debt_manager")).toContainText(
    "a disclosure only",
  );

  // §17 — the Liquidatable card: never the adjective without the Σ.
  await expect(page.getByTestId("book-stats-debt_manager")).toContainText(
    "of computed positions, engine's own comparator · Σ eligible debt $4,200",
  );
  const aaveCard = page.getByTestId("book-stats-aave_v3_etherfi");
  await expect(aaveCard).toContainText(
    "of computed positions, engine's own comparator · Σ eligible debt $0",
  );
  // The inverted zero-member pin: no vacuous "all dust" over zero members.
  await expect(aaveCard).not.toContainText("all dust");
});

test("MUTATE the fixture and the reading lines change — computed, not hardcoded", async ({
  page,
}) => {
  const mutated = structuredClone(BOOK);
  const aaveHist = mutated.hf_histogram.engines[0];
  const bucket = aaveHist?.buckets.find((candidate) => candidate.label === "0.90 – 1.00");
  const aaveAgg = mutated.engines[0];
  const dmAgg = mutated.engines[1];
  const dmBadDebt = mutated.bad_debt[1];
  if (bucket === undefined || aaveAgg === undefined || dmAgg === undefined || dmBadDebt === undefined) {
    throw new Error("fixture shape drifted");
  }
  bucket.count = 3;
  aaveAgg.computed_positions = 4;
  dmAgg.liquidatable_positions = 2;
  dmAgg.computed_positions = 3;
  dmBadDebt.eligible_debt_usd = "9000000"; // $9 — provably dust

  await mockBook(page, mutated);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("hist-reading-aave_v3_etherfi")).toContainText(
    "3 of 4 are below 1.00",
  );
  const dmLine = page.getByTestId("hist-reading-debt_manager");
  await expect(dmLine).toContainText("counts 2 of 3 liquidatable");
  await expect(dmLine).toContainText("Σ eligible debt $9 · all dust.");
});

// ---------------------------------------------------------------------------
// §18 + captions (a)/(b)/(c) — the waterfall's grammar and copy.
// ---------------------------------------------------------------------------

test("waterfall: percent labels, unshocked census, exact micro-strings, verbatim copy", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const dm = page.getByTestId("book-waterfall-debt_manager");
  await expect(dm).toContainText("unshocked");
  await expect(dm).toContainText("×1.00 · 1 acct");
  await expect(dm).toContainText("−10%");
  await expect(dm).toContainText("×0.90 · 1 acct");
  await expect(dm).toContainText("unshocked bad debt");
  await expect(dm).toContainText("1 insolvent");
  await expect(dm).toContainText("$239.603961"); // exact, never rounded

  // The section note, verbatim; the ProjectionBadge stays where it was.
  await expect(page.getByTestId("waterfall-section-note")).toHaveText(
    "If the shocked asset fell step by step, how much debt could the engine liquidate — and " +
      "how much would it lose? Bars: cumulative eligible debt at each price. ×1.00 is the " +
      "standing census; every lower point is a projection.",
  );
  await expect(page.getByText("PROJECTION", { exact: true })).toBeVisible();

  // The one dim legend line under the panel grid, verbatim.
  await expect(page.getByTestId("waterfall-bad-debt-legend")).toHaveText(
    "bad debt = debt still owed after all collateral is seized — the protocol's loss at that price.",
  );

  // Caption (b): the primary gloss; the wire eligibility_note stays dim + verbatim.
  await expect(page.getByTestId("eligible-gloss")).toHaveText(
    '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
      "closes can be less — the Debt Manager liquidates in two passes: half the debt, then " +
      "the remainder.",
  );
  await expect(page.getByTestId("waterfall-held-flat")).toContainText("closes in two passes");
});

test("at_risk_note is ABSENT from the Book waterfall panel — and SURVIVES in the Developers raw register", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  // The note's own words never render on the Book surface.
  await expect(page.getByTestId("book-waterfall-debt_manager")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("carries NO monotonicity invariant");

  // The raw-JSON / Developers register still carries it verbatim.
  await page.goto("/developers");
  const sample = (await page.getByTestId("sample-getBook").textContent()) ?? "";
  expect(sample).toContain("carries NO monotonicity invariant");
});

test("held flat (Book): the counted-disclosure pattern, raw units by design", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const heldFlat = page.getByTestId("waterfall-held-flat");
  // The always-visible summary, verbatim.
  await expect(heldFlat.getByTestId("held-flat-summary")).toHaveText(
    "1 price input held flat — the scenario did not move these prices; positions priced by " +
      "them are stressed at stale marks. A blind spot, not a zero.",
  );
  // The counted details line; open it and check the table.
  const summary = heldFlat.locator("summary");
  await expect(summary).toHaveText("held flat — 1 inputs named");
  await summary.click();
  await expect(
    heldFlat.getByRole("columnheader", {
      name: "held value (source's raw units — unscaled by design)",
    }),
  ).toBeVisible();
  // The value is the source's RAW units (string surgery grouping only —
  // never scaled to a fabricated USD form).
  await expect(heldFlat).toContainText("100,000,000");
  await expect(heldFlat).not.toContainText("$100,000,000");
});

// ---------------------------------------------------------------------------
// §16 — the full-book walk.
// ---------------------------------------------------------------------------

/** Synthetic single-cursor walk pages derived from the canonical fixtures. */
function walkPages() {
  const page1 = structuredClone(POSITIONS_AAVE_PAGE_1);
  page1.limit = 200;
  page1.next_cursor = "full-2";
  const page2 = structuredClone(POSITIONS_AAVE_PAGE_2);
  page2.limit = 200;
  page2.next_cursor = null;
  return { page1, page2 };
}

test("the full-book walk AUTO-STARTS on mount — no button, and the partial page-scatter is gone", async ({
  page,
}) => {
  let walkRequests = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    // The table pages at limit=200 too (W-UX-C point 13); the map's walk is
    // the request WITHOUT a sort param — the table always ranks explicitly.
    if (url.searchParams.get("sort") === null) walkRequests += 1;
    if (url.searchParams.get("cursor") === null)
      return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  // W-HR-A REVERSES W-UX-D §16's "no auto-walk" on purpose. The partial
  // scatter it protected was a picture of the TABLE'S SORT ORDER, not of the
  // book, and it was the resting default — so the honest reading was behind a
  // button and the misleading one was free. With the partial register gone
  // there is nothing to hold the reader while they decide to press, so the
  // walk starts itself and discloses how far it has got.
  await expect(page.getByTestId("risk-map-full-head")).toContainText("full book · 2 positions");
  await expect(page.getByTestId("load-full-book")).toHaveCount(0);
  await expect(page.getByTestId("risk-map-partial-label")).toHaveCount(0);
  expect(walkRequests).toBeGreaterThan(0);
});

test("the auto walk: live progress, completed header, and ONE drawing (the DensityMap)", async ({
  page,
}) => {
  const { page1, page2 } = walkPages();
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") !== null) {
      // The table's own pages (it always sends sort; the walk never does).
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, page1);
    // Hold page two long enough for the live progress to be asserted.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fulfillJson(route, page2);
  });
  await openBook(page);

  // Live progress — mono, in the panel head, disclosing "walked N of M".
  await expect(page.getByTestId("risk-map-progress")).toHaveText(
    "walking the full book — walked 1 of 2 · page 1 · batch #1",
  );

  // Completion: the full-book header, with the map's own as-of.
  await expect(page.getByTestId("risk-map-full-head")).toHaveText(
    "full book · 2 positions · as-of batch #1 · 2 on book",
  );

  const density = page.getByTestId("density-map");
  await expect(density).toBeVisible();
  // There is no second drawing to swap with — the Scatter call-site is dead.
  await expect(page.getByRole("img", { name: /vs liquidation distance/ })).toHaveCount(0);

  // One computed row → one bin. The title carries count + debt range + band +
  // Σ debt + what the band MEANS (W-HR-A: a range is not an explanation).
  const bin = page.getByTestId("risk-bin");
  await expect(bin).toHaveCount(1);
  await expect(bin.locator("title")).toHaveText(
    "1 account · debt $3,162–$10k · headroom 5–10% · Σ debt 6,000 · " +
      "5–10% of borrowing capacity left before liquidation",
  );

  // The band axis reads in reader words, and the right-margin marginal states
  // each band's count and exact Σ debt.
  await expect(density).toContainText("5–10% left");
  await expect(density).toContainText("breached");
  await expect(page.getByTestId("density-marginal-head")).toHaveText("accts · Σ debt");
  await expect(page.getByTestId("density-band-marginal").nth(3)).toContainText("1 · 6,000");

  // USD axis with true-decade ticks; the quantized legend, never a gradient.
  await expect(density).toContainText("debt (usd, log)");
  await expect(density).toContainText("$10k");
  await expect(page.getByTestId("density-legend")).toContainText("1 · 10 · 100 · 1,000 accounts");

  // The reading line is COMPUTED from the same bins the grid draws.
  await expect(page.getByTestId("risk-map-reading")).toHaveText(
    "What this shows: where the book's debt sits by headroom. 1 of 1 plotted accounts have " +
      "less than 10% of their borrowing capacity left — Σ debt 6,000 in the engine's own unit. " +
      "1 of 2 walked rows are counted aside, not plotted.",
  );

  // The refused row is COUNTED aside, never dropped, never plotted.
  await expect(page.getByTestId("risk-map-aside")).toContainText("1 counted aside, not plotted");
  await expect(page.getByTestId("risk-map-aside")).toContainText("1 refused");

  // The top-debt outlier is named with its truncated address.
  await expect(page.getByTestId("risk-map-outlier")).toHaveText("0xAAaA…0001");
});

test("409 mid-walk: the BookPositions notice grammar VERBATIM, restart from page one", async ({
  page,
}) => {
  const { page1 } = walkPages();
  const freshPage = structuredClone(POSITIONS_AAVE_PAGE_1);
  freshPage.limit = 200;
  freshPage.next_cursor = null;
  freshPage.total_positions = 1;
  freshPage.batch.id = 2;
  let walkPageOneRequests = 0;

  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") !== null) {
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) {
      walkPageOneRequests += 1;
      return fulfillJson(route, walkPageOneRequests === 1 ? page1 : freshPage);
    }
    return fulfillJson(route, BATCH_SUPERSEDED, 409);
  });
  await openBook(page);

  // The notice: visible, the BookPositions grammar verbatim.
  const notice = page.getByTestId("risk-map-superseded-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("BATCH SUPERSEDED");
  await expect(notice).toContainText(
    "batch 1 was superseded by batch 2 mid-pagination — restarted from page one against the fresh batch",
  );

  // The restart is REAL: page one was fetched twice, and the completed
  // vector is entirely the fresh batch — never a spliced vector.
  await expect(page.getByTestId("risk-map-full-head")).toContainText(
    "full book · 1 positions · as-of batch #2",
  );
  expect(walkPageOneRequests).toBe(2);
});

test("OUTPACED: a book that re-materializes faster than one walk gives up OUT LOUD — never a spliced vector", async ({
  page,
}) => {
  // THE FIELD CONDITION: a live indexer can publish a new batch every couple
  // of seconds, so every full walk is superseded mid-pagination and restarts
  // — forever. Auto-started (W-HR-A), that is an unbounded request loop that
  // never draws anything. Here EVERY cursor page 409s, so the restart bound
  // is reached immediately.
  const { page1 } = walkPages();
  let walkPageOnes = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") !== null) {
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) {
      walkPageOnes += 1;
      return fulfillJson(route, page1);
    }
    return fulfillJson(route, BATCH_SUPERSEDED, 409);
  });
  await openBook(page);

  const outpaced = page.getByTestId("risk-map-outpaced");
  await expect(outpaced).toBeVisible();
  // W-HR-B: the count is SUPERSESSIONS OBSERVED, not restarts spent. Four
  // walk attempts each met a 409 — the fourth is the one that ended the walk,
  // and it is an observation like the other three. Reporting the restart
  // budget (3) under-counted the very event being reported.
  await expect(outpaced).toContainText("the book re-materialized mid-walk 4 times");
  await expect(outpaced).not.toContainText("mid-walk 3 times");
  await expect(outpaced).toContainText("a vector spliced across batches is not this book");
  await expect(outpaced).toContainText("newest batch #2");
  // The refusal is not a zero and not an empty map.
  await expect(outpaced).toContainText("Nothing here is a zero");
  await expect(page.getByTestId("density-map")).toHaveCount(0);
  await expect(page.getByTestId("risk-map-full-head")).toHaveCount(0);

  // The loop is BOUNDED: 1 initial walk + 3 restarts, and then it STOPS
  // hammering the API. The reported count equals the 409s the walk actually
  // met — one per page-one attempt.
  await expect.poll(() => walkPageOnes).toBe(4);
  await page.waitForTimeout(700);
  expect(walkPageOnes).toBe(4);

  // "walk again" is the ONE manual affordance, and it exists only after the
  // walk gave up — it is not a gate in front of the resting state.
  await page.getByTestId("risk-map-walk-again").click();
  await expect.poll(() => walkPageOnes).toBeGreaterThan(4);
});

test("409 mid-walk with a SLOW fresh page: the stale progress dies AT ONCE, not on arrival", async ({
  page,
}) => {
  // Wave W-HR-B, round-14 MEDIUM. On a 409 the accumulator was dropped
  // immediately but the rendered progress was not: "walked 1 of 2 · page 1 ·
  // batch #1" kept standing — over zero held rows, naming a batch nobody was
  // reading any more — until the replacement page RESOLVED. On a slow first
  // page of the fresh batch that is seconds of a confident, false sentence.
  const { page1 } = walkPages();
  const freshPage = structuredClone(POSITIONS_AAVE_PAGE_1);
  freshPage.limit = 200;
  freshPage.next_cursor = null;
  freshPage.total_positions = 1;
  freshPage.batch.id = 2;
  let walkPageOnes = 0;

  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") !== null) {
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) {
      walkPageOnes += 1;
      if (walkPageOnes === 1) return fulfillJson(route, page1);
      // The RESTARTED page one is slow — the whole window this test exists for.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return fulfillJson(route, freshPage);
    }
    // Hold the supersession briefly so the PRE-409 progress is observable at
    // all; mocked routes otherwise resolve inside one frame.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fulfillJson(route, BATCH_SUPERSEDED, 409);
  });
  await openBook(page);

  // The progress reached the pre-409 state at least once.
  const progress = page.getByTestId("risk-map-progress");
  await expect(progress).toHaveText("walking the full book — walked 1 of 2 · page 1 · batch #1");

  // …and the instant the 409 lands it is ZEROED — before the fresh page can
  // possibly have arrived (it is held for two seconds).
  await expect(page.getByTestId("risk-map-superseded-notice")).toBeVisible();
  await expect(progress).toHaveText("walking the full book — requesting page 1");
  await expect(progress).not.toContainText("walked 1 of 2");
  await expect(progress).not.toContainText("batch #1");
  // No map is drawn from the abandoned vector either.
  await expect(page.getByTestId("risk-map-full-head")).toHaveCount(0);
  await expect(page.getByTestId("density-map")).toHaveCount(0);

  // The restart then completes honestly, entirely on the fresh batch.
  await expect(page.getByTestId("risk-map-full-head")).toContainText(
    "full book · 1 positions · as-of batch #2",
  );
});

test("the map's on-book count is BATCH-PAIRED — the table advancing past the map never blends two counts", async ({
  page,
}) => {
  // Wave W-HR-B, round-14 MEDIUM. The map's head printed `aggregate.positions`
  // guarded against the TABLE's batch. The two walk different endpoints at
  // different speeds, so after the table 409s and heals onto batch N+1 —
  // dragging /v1/book with it — the map's completed batch-N vector sat beside
  // an N+1 count in one sentence, with no seam a reader could see.
  const walkPage = structuredClone(POSITIONS_AAVE_PAGE_1);
  walkPage.limit = 200;
  walkPage.next_cursor = null;

  const tablePageOne = structuredClone(POSITIONS_AAVE_PAGE_1);
  tablePageOne.next_cursor = "table-2";
  const tableFresh = structuredClone(POSITIONS_AAVE_PAGE_1);
  tableFresh.next_cursor = null;
  tableFresh.batch.id = 2;

  // /v1/book heals to batch 2 with a DIFFERENT count once the table reports it.
  const bookBatch2 = structuredClone(BOOK);
  bookBatch2.batch.id = 2;
  bookBatch2.engines = bookBatch2.engines.map((aggregate) =>
    aggregate.engine === "aave_v3_etherfi" ? { ...aggregate, positions: 7 } : aggregate,
  );
  let bookCalls = 0;
  await page.route("**/v1/book", (route) => {
    bookCalls += 1;
    return fulfillJson(route, bookCalls === 1 ? BOOK : bookBatch2);
  });

  let tablePageOnes = 0;
  await page.route("**/v1/positions*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sort") === null) return fulfillJson(route, walkPage);
    if (url.searchParams.get("cursor") === null) {
      tablePageOnes += 1;
      return fulfillJson(route, tablePageOnes === 1 ? tablePageOne : tableFresh);
    }
    // Hold the table's supersession long enough to assert the SAME-batch head.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fulfillJson(route, BATCH_SUPERSEDED, 409);
  });
  await openBook(page);

  // SAME batch: the two counts may be read together, and are. (The walk's one
  // page holds 1 row; /v1/book's aave aggregate counts 2 — a legitimate gap
  // the head states rather than hides, which is why the count is there at all.)
  const head = page.getByTestId("risk-map-full-head");
  await expect(head).toHaveText("full book · 1 positions · as-of batch #1 · 2 on book");

  // The table is superseded and restarts onto batch 2; the surface re-fetches
  // /v1/book, which now answers for batch 2 with 7 on book. The map still
  // holds its completed batch-1 vector — and REFUSES to print the two counts
  // side by side, naming the mismatch instead of quietly dropping the number.
  await expect(page.getByTestId("batch-superseded-notice")).toBeVisible();
  await expect.poll(() => bookCalls).toBeGreaterThan(1);
  await expect(head).toContainText("full book · 1 positions · as-of batch #1");
  await expect(head).toContainText(
    "on-book count withheld (aggregate from batch #2, map from batch #1: " +
      "counts from two batches are never blended)",
  );
  // The healed count is NEVER attached to the older vector.
  await expect(head).not.toContainText("7 on book");
  await expect(head).not.toContainText("2 on book");
});

test("an engine switch mid-walk restarts the walk — a vector never splices two books", async ({
  page,
}) => {
  const walkEngines: string[] = [];
  const dmWalkPage = structuredClone(POSITIONS_DM_PAGE_1);
  dmWalkPage.limit = 200;
  dmWalkPage.next_cursor = null;

  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine") ?? "";
    if (url.searchParams.get("sort") === null) walkEngines.push(engine);
    if (engine === "debt_manager") return fulfillJson(route, dmWalkPage);
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);
  await expect(page.getByTestId("risk-map-full-head")).toContainText("full book · 2 positions");

  await page.getByRole("button", { name: "debt_manager" }).click();

  // The map is the DM's book now — its own head, its own bands, and its walk
  // fired against the DM engine. The walk's IDENTITY is (engine, min_value),
  // so the aave vector was dropped whole rather than appended to.
  await expect(page.getByTestId("book-risk-map")).toContainText("risk map · debt_manager");
  await expect(page.getByTestId("risk-map-full-head")).toContainText("full book · 2 positions");
  expect(walkEngines).toContain("debt_manager");
  // The DM fixture's one computed row is BREACHED (HF 3,200/4,200), so it
  // lands on the breached band — the row a reader looks for first.
  await expect(page.getByTestId("risk-crit")).toHaveCount(1);
});

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

async function runStress(page: Page, addr: string) {
  await muteStream(page);
  await page.goto("/lab");
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
    "1 price input held flat — the scenario did not move these prices; positions priced by " +
      "them are stressed at stale marks. A blind spot, not a zero.",
  );
  const summary = heldFlat.locator("summary");
  await expect(summary).toHaveText("held flat — 1 inputs named");
  await summary.click();
  await expect(
    heldFlat.getByRole("columnheader", {
      name: "held value (source's raw units — unscaled by design)",
    }),
  ).toBeVisible();
  await expect(heldFlat).toContainText("100000000"); // the source's raw units, verbatim
});

test("Lab realization: the eligible-vs-realized gloss rides the sub as title", async ({
  page,
}) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();

  await expect(page.getByTestId("realized-leq-eligible").first()).toHaveAttribute(
    "title",
    '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
      "closes can be less — the Debt Manager liquidates in two passes: half the debt, then " +
      "the remainder.",
  );
});

test("Lab run-book: wire notes become a counted verbatim details; collateral-at-risk carries the reader caption", async ({
  page,
}) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: fixture("run-book.weeth_market_depeg_oracles_held.json"),
    }),
  );
  await runStress(page, STRESS_AAVE.address);
  await expect(page.getByTestId("lab-found")).toBeVisible();
  await page.getByTestId("mode-book").click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();

  // Caption (c): the counted, verbatim wire-notes disclosure.
  const notes = page.getByTestId("book-wire-notes");
  await expect(notes.locator("summary")).toHaveText("wire notes — 1, verbatim");
  await notes.locator("summary").click();
  await expect(notes).toContainText(
    "aggregates are per engine in each engine's OWN unit and decimals",
  );

  // Caption (c): the reader caption as title on the collateral-at-risk row —
  // one per engine table, never dropped.
  const captioned = page.locator('td[title*="re-measured at each price step"]');
  await expect(captioned).toHaveCount(2);
  await expect(captioned.first()).toHaveText("collateral at risk");
});
