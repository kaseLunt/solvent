// Phase 1 Track B (response-boundary validation) — the render-consequence
// pins, one section per fix, each tagged p1b-N:
//   p1b-0 · honest route refusal: no error.tsx existed anywhere under
//          web/app, so a render throw (e.g. a wire Decimal outside the
//          contract reaching a throwing money renderer) replaced the entire
//          route — header included — with Next's generic "Application error"
//          page. The root boundary now renders the house refusal register:
//          the throw is named, nothing is claimed, and the header/nav stay
//          mounted because error.tsx replaces only the segment below
//          layout.tsx.
//
//   p1b-2 · the full RunBookEngine subtree classifier: the p0-9 gate
//          validated 4 of ~40+ numeric fields; every other field either threw
//          in a money renderer (route boundary took the page) or coerced
//          through a bare BigInt into a measured-zero costume. The classifier
//          is exhaustive with per-index field naming, and every gate that
//          reads `cellPrimaryOutcome` (cell, superseded payload, engine
//          panel, parent summary) refuses on the SAME classification.
//
// Mock shapes and fixture modules are reused from p0-fixes.spec.ts (its
// mockBookSurface, itself book.spec.ts's shape): typed TS fixtures from
// tests/fixtures/book.ts, CORS on every fulfilled cross-origin response, and
// the stream route aborted so no live posture races the pinned bodies.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { components } from "@solvent/client";
import {
  BOOK,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

type BookBody = components["schemas"]["BookResponse"];

/**
 * The book.spec.ts mock shape (as reused by p0-fixes.spec.ts's
 * mockBookSurface), parameterized over the /v1/book body so a test can serve
 * a documented single-field corruption: stream aborted, book body pinned,
 * cursor-aware positions pages.
 */
async function mockBookWith(page: Page, book: BookBody) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => route.fulfill({ json: book, headers: CORS }));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("engine") === "debt_manager") {
      return route.fulfill({ json: POSITIONS_DM_PAGE_1, headers: CORS });
    }
    if (url.searchParams.get("cursor") === null) {
      return route.fulfill({ json: POSITIONS_AAVE_PAGE_1, headers: CORS });
    }
    return route.fulfill({ json: POSITIONS_AAVE_PAGE_2, headers: CORS });
  });
}

test.describe("p1b-0 · honest route refusal", () => {
  test("a render throw shows the refusal register, not the generic error page", async ({ page }) => {
    // Single documented change to the committed /v1/book fixture, serving ONE
    // purpose (the route-boundary arm): engines[0]'s (aave_v3_etherfi)
    // aggregate total_debt set to "" — outside the wire Decimal contract
    // (api/openapi.yaml `Decimal`: ^-?[0-9]+$). Today this reaches
    // renderEngineAmount in BookStatRows' total-debt stat row, which throws
    // DecimalFormatError and white-pages /book. Everything else
    // byte-identical.
    const body = structuredClone(BOOK);
    // noUncheckedIndexedAccess: narrow with a THROWING guard — a missing
    // first engine is a broken fixture, never a variant to skip silently.
    const agg = body.engines[0];
    if (!agg) throw new Error("fixture shape: engines[0] missing");
    agg.total_debt = "";
    await mockBookWith(page, body);
    await page.goto("/book");
    const refusal = page.getByTestId("route-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("refused to render");
    await expect(refusal).toContainText("Nothing is claimed");
    // the reset affordance is part of the register: a refusal that cannot be
    // retried is a dead end, not a disclosure
    await expect(refusal.getByRole("button", { name: "try again" })).toBeVisible();
    // the register is ours, not Next's generic page — both copies pinned
    // absent: the classic "Application error" body and THIS Next version's
    // observed generic heading (the recorded red run's page snapshot renders
    // heading "This page couldn’t load" + Reload/Back)
    await expect(page.getByText("Application error: a client-side exception")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "This page couldn’t load" })).toHaveCount(0);
    // the app-router boundary replaces the SEGMENT below layout.tsx, so the
    // header stays mounted — the refusal is scoped to the view that earned it
    await expect(page.getByRole("banner")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// p1b-2 · the full RunBookEngine subtree classifier.
//
// Run-book mocks in p0-fixes.spec.ts's register: cold routes pinned, the
// run-book POST answered with the committed 200 fixture
// (run-book.eth_minus_30.json) carrying ONE documented corruption each.
// ---------------------------------------------------------------------------

type RunBookBody = components["schemas"]["RunBookResponse"];
const RUN_BOOK_200 = JSON.parse(fixture("run-book.eth_minus_30.json")) as RunBookBody;

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

/** POST-capable CORS: the run-book request is preflighted. */
const RUN_CORS = {
  ...CORS,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

/** Mock the run-book POST, answering the OPTIONS leg too (p0-fixes' mockRunBook). */
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

/** The eth_minus_30 row's aave column (lab.spec.ts's cell geometry). */
function aaveCell(page: Page) {
  return page.locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"] td').nth(1);
}

/** Clone the committed 200 body and corrupt its FIRST (aave) engine. */
function corruptedRunBook(mutate: (engine: RunBookBody["engines"][number]) => void): RunBookBody {
  const body = structuredClone(RUN_BOOK_200);
  // noUncheckedIndexedAccess: narrow with a THROWING guard — a missing first
  // engine is a broken fixture, never a variant to skip silently.
  const engine = body.engines[0];
  if (!engine) throw new Error("fixture shape: engines[0] missing");
  mutate(engine);
  return body;
}

test.describe("p1b-2 · the classifier covers the whole engine subtree", () => {
  test("a malformed AGGREGATE field refuses the engine by name — the route stays live", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the beyond-the-p0-four arm): engines[0]'s (aave_v3_etherfi)
    // before.total_debt_usd set to "" — a field the OLD 4-field gate never
    // read, which reached renderUsdAmount in the engine panel's before/after
    // ledger and threw the whole route into the boundary. Everything else
    // byte-identical.
    const body = corruptedRunBook((engine) => {
      engine.before.total_debt_usd = "";
    });
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    // ROUTE STAYS LIVE: the run settles into a classified cell, never the
    // route boundary. With the classifier skipped, the render throws and no
    // cell ever settles — this pin dies first.
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(cell).toContainText("before.total_debt_usd");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
    // The ENGINE PANEL shows the p0-8 malformed register, naming the field by
    // its full wire path — same classification, same law.
    const aavePanel = page.locator('[data-testid="book-engine"][data-engine="aave_v3_etherfi"]');
    await expect(aavePanel).toHaveAttribute("data-engine-outcome", "malformed");
    await expect(aavePanel).toContainText("before.total_debt_usd");
    // The HEALTHY second engine renders normally: the refusal is scoped to
    // the engine that earned it, never spread over the book.
    const dmPanel = page.locator('[data-testid="book-engine"][data-engine="debt_manager"]');
    await expect(dmPanel).not.toHaveAttribute("data-engine-outcome", "malformed");
    await expect(dmPanel.getByTestId("book-engine-answer")).toBeVisible();
  });

  test("a malformed MOVER wad refuses the engine PER INDEX in the same register", async ({ page }) => {
    await mockCold(page);
    // Single documented change, serving ONE purpose (the per-index arm):
    // engines[0]'s movers[0].hf_before_wad set to "1e5" — outside the wire
    // Decimal contract. The OLD gate never read movers; the dumbbell layer's
    // bare BigInt threw on it. Everything else byte-identical.
    const body = corruptedRunBook((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: movers[0] missing");
      mover.hf_before_wad = "1e5";
    });
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
    // PER-INDEX NAMING: the register addresses the exact mover row, never a
    // bare group name.
    const aavePanel = page.locator('[data-testid="book-engine"][data-engine="aave_v3_etherfi"]');
    await expect(aavePanel).toHaveAttribute("data-engine-outcome", "malformed");
    await expect(aavePanel).toContainText("movers[0].hf_before_wad");
    const dmPanel = page.locator('[data-testid="book-engine"][data-engine="debt_manager"]');
    await expect(dmPanel).not.toHaveAttribute("data-engine-outcome", "malformed");
    await expect(dmPanel.getByTestId("book-engine-answer")).toBeVisible();
  });
});
