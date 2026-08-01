// W-UX-D (charts supplement 16–18 + captions a/b/c) e2e — MOCKED API via
// route interception; every base body comes from tests/fixtures/book.ts (the
// generated, contract-validated fixtures). Mutations are structuredClone
// surgery on those bodies, done IN THE TEST so the computed-not-hardcoded
// law can be proven by watching the rendered line change.
//
// Asserted rulings:
//   §16 — the risk map NEVER auto-walks; ONE explicit "load full book"
//         action runs a sequential abortable walk (limit=200) with live mono
//         progress; 409 mid-walk restarts VISIBLY from page one (the
//         BookPositions notice grammar verbatim); completion swaps
//         Scatter→DensityMap with the "full book · n positions · as-of
//         batch #id" header; abort returns the labeled partial state.
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

async function openBook(page: Page): Promise<void> {
  await muteStream(page);
  await page.goto("/book");
}

// ---------------------------------------------------------------------------
// §17 — reading lines: computed, never asserted.
// ---------------------------------------------------------------------------

test("reading lines render per panel from the served /v1/book values", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("hist-reading-aave_v3_etherfi")).toHaveText(
    "What this shows: how many accounts sit at each health factor. 0 of 1 are below 1.00, " +
      "where the engine may liquidate — Σ eligible debt $0 · all dust.",
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
  await expect(page.getByTestId("book-stats-aave_v3_etherfi")).toContainText(
    "of computed positions, engine's own comparator · Σ eligible debt $0 · all dust",
  );
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
    "1 price inputs held flat — the scenario did not move these prices; positions priced by " +
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

test("NO auto-walk on page load — the full book moves only on the ONE explicit action", async ({
  page,
}) => {
  let walkRequests = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") === "200") walkRequests += 1;
    if (url.searchParams.get("cursor") === null)
      return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  // The table walked its own pages; the map stayed partial and labeled.
  await expect(page.getByTestId("book-risk-map")).toContainText("1 loaded / 2 total");
  await expect(page.getByTestId("risk-map-partial-label")).toHaveText(
    "partial — plots the table's loaded pages",
  );
  await expect(page.getByTestId("load-full-book")).toBeVisible();
  expect(walkRequests).toBe(0);
});

test("load full book: live progress, completed header, Scatter→DensityMap swap", async ({
  page,
}) => {
  const { page1, page2 } = walkPages();
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") !== "200") {
      // The table's own pages.
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, page1);
    // Hold page two long enough for the live progress to be asserted.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return fulfillJson(route, page2);
  });
  await openBook(page);

  // Partial mode first: the Scatter renders the loaded pages.
  await expect(
    page.getByRole("img", { name: /risk map for aave_v3_etherfi: debt \(log10, engine unit\)/ }),
  ).toBeVisible();

  await page.getByTestId("load-full-book").click();

  // Live progress — mono, in the panel head, the ruling's grammar.
  await expect(page.getByTestId("risk-map-progress")).toHaveText(
    "loading full book — page 1 · 1 of 2 · batch #1",
  );
  await expect(page.getByTestId("abort-full-book")).toBeVisible();

  // Completion: the full-book header replaces the partial labeling.
  await expect(page.getByTestId("risk-map-full-head")).toHaveText(
    "full book · 2 positions · as-of batch #1",
  );
  await expect(page.getByTestId("risk-map-partial-label")).toHaveCount(0);

  // The DensityMap replaced the Scatter.
  const density = page.getByTestId("density-map");
  await expect(density).toBeVisible();
  await expect(
    page.getByRole("img", { name: /risk map for aave_v3_etherfi: debt \(log10, engine unit\)/ }),
  ).toHaveCount(0);

  // One computed row → one bin, with the exact per-bin title grammar.
  const bin = page.getByTestId("risk-bin");
  await expect(bin).toHaveCount(1);
  await expect(bin.locator("title")).toHaveText("1 account · debt $3,162–$10k · −5…−10%");

  // USD axis with true-decade ticks; the quantized legend, never a gradient.
  await expect(density).toContainText("debt (usd, log)");
  await expect(density).toContainText("$10k");
  await expect(page.getByTestId("density-legend")).toContainText("1 · 10 · 100 · 1,000 accounts");

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
    if (url.searchParams.get("limit") !== "200") {
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
  await page.getByTestId("load-full-book").click();

  // The notice: visible, the BookPositions grammar verbatim.
  const notice = page.getByTestId("risk-map-superseded-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("BATCH SUPERSEDED");
  await expect(notice).toContainText(
    "batch 1 was superseded by batch 2 mid-pagination — restarted from page one against the fresh batch",
  );

  // The restart is REAL: page one was fetched twice, and the completed
  // vector is entirely the fresh batch — never a spliced vector.
  await expect(page.getByTestId("risk-map-full-head")).toHaveText(
    "full book · 1 positions · as-of batch #2",
  );
  expect(walkPageOneRequests).toBe(2);
});

test("abort mid-walk: the labeled partial state returns", async ({ page }) => {
  const { page1 } = walkPages();
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") !== "200") {
      if (url.searchParams.get("cursor") === null)
        return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
      return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    }
    if (url.searchParams.get("cursor") === null) return fulfillJson(route, page1);
    // Page two never arrives inside this test's lifetime.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    try {
      await route.abort();
    } catch {
      // The page (and its request) are long gone by then.
    }
    return undefined;
  });
  await openBook(page);
  await page.getByTestId("load-full-book").click();

  await expect(page.getByTestId("risk-map-progress")).toBeVisible();
  await page.getByTestId("abort-full-book").click();

  // Partial returns, labeled; the action is offered again; the Scatter is back.
  await expect(page.getByTestId("risk-map-walk-note")).toHaveText(
    "full-book load aborted — partial view (loaded pages) retained",
  );
  await expect(page.getByTestId("risk-map-partial-label")).toBeVisible();
  await expect(page.getByTestId("load-full-book")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /risk map for aave_v3_etherfi: debt \(log10, engine unit\)/ }),
  ).toBeVisible();
  await expect(page.getByTestId("density-map")).toHaveCount(0);
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
    "1 price inputs held flat — the scenario did not move these prices; positions priced by " +
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
