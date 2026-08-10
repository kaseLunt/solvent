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
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BOOK,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";
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

// ---------------------------------------------------------------------------
// p0-4 · engine-specific terminology
// ---------------------------------------------------------------------------

/**
 * p0-4: the committed HISTORY body carries only the aave engine, and the DM
 * vocabulary needs a DM card on the page. Single documented derivation: the
 * aave engine block re-shaped as a debt_manager block holding ONE computed
 * point whose health_factor is the DM's num/den DISCLOSURE (wad null, the
 * exact rational maxBorrowLT/borrowings) with a sweep mark — the shape the
 * unit suite's DM fixtures use. The aave engine stays byte-identical.
 */
const AAVE_HISTORY_ENGINE = HISTORY.engines[0];
if (AAVE_HISTORY_ENGINE === undefined) {
  throw new Error("fixture invariant: aave history engine expected");
}
const AAVE_COMPUTED_POINT = AAVE_HISTORY_ENGINE.points[0];
if (AAVE_COMPUTED_POINT === undefined) {
  throw new Error("fixture invariant: computed point expected");
}

const DM_HISTORY_ENGINE: typeof AAVE_HISTORY_ENGINE = {
  ...structuredClone(AAVE_HISTORY_ENGINE),
  engine: "debt_manager",
  value_decimals: 6,
  points: [
    {
      ...structuredClone(AAVE_COMPUTED_POINT),
      sweep_block: 154796500,
      liquidatable: true,
      health_factor: {
        wad: null,
        num: "3200000000",
        den: "4200000000",
        infinite: false,
        note: "maxBorrowLT/borrowings is a disclosure; the verdict is the engine's strict boolean.",
      },
      total_collateral_base: "3200000000",
      total_debt_base: "4200000000",
    },
  ],
};

/**
 * p0-3's inspector mocks, plus a LATER history route (Playwright consults
 * routes newest-first, so this override wins) serving BOTH engines' history.
 */
async function mockInspectorBothHistories(page: Page) {
  await mockInspectorFound(page);
  const history = structuredClone(HISTORY);
  history.engines.push(DM_HISTORY_ENGINE);
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: history, headers: CORS }),
  );
}

/** The book.spec.ts mock shape: the /v1/book body plus cursor-aware positions. */
async function mockBookSurface(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => route.fulfill({ json: BOOK, headers: CORS }));
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

test.describe("p0-4 · engine-specific terminology", () => {
  test("the DM history card is headed as a disclosure, the Aave card as a health factor", async ({ page }) => {
    await mockInspectorBothHistories(page);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    await expect(page.getByText("Borrow headroom (disclosure) across batches")).toBeVisible();
    await expect(page.getByText("Health factor across batches")).toBeVisible();
    // the SECTION head spans both engines' cards, so it claims neither
    // engine's vocabulary; each card's own head makes the engine's claim.
    await expect(page.getByTestId("hf-history")).toContainText("Risk history across batches");
    // the DM sparkline no longer claims a health factor in its aria label
    await expect(
      page.getByLabel("debt_manager health factor across retained batches"),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("debt_manager borrow-headroom disclosure across retained batches"),
    ).toBeVisible();
  });

  test("Book histogram panels humanize the comparator token", async ({ page }) => {
    await mockBookSurface(page);
    await page.goto("/book");
    await expect(page.getByText("comparator: hf_wad")).toHaveCount(0);
    await expect(page.getByText("comparator: hf_num/hf_den")).toHaveCount(0);
    await expect(page.getByText("the pool's own health factor (wad)")).toBeVisible();
    await expect(
      page.getByText("maxBorrowLT/borrowings — a disclosure, not the engine's trigger"),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// p0-5 · snapshot chip — snapshot freshness is its own ALWAYS-VISIBLE element
// beside the stream badge, never a >1h-only suffix inside it (cross-page
// brief: "Always show the age"). The stream mock is r7-fixes.spec.ts's
// mechanism verbatim: a REAL SSE server whose connection is held open
// (route.fulfill would end the body — a server hang-up — and withdraw LIVE),
// delivering the committed fixture snapshot with a controlled
// batch.age_seconds.
// ---------------------------------------------------------------------------

interface StreamHarness {
  readonly url: string;
  connections(): number;
  close(): Promise<void>;
}

/** Start an SSE server whose connections are held open under the test's control. */
async function startStreamServer(
  onConnect: (connection: number, res: ServerResponse) => void,
): Promise<StreamHarness> {
  let count = 0;
  const live = new Set<ServerResponse>();
  const server: Server = createServer((_request, response) => {
    count += 1;
    live.add(response);
    response.on("close", () => live.delete(response));
    onConnect(count, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/v1/stream`,
    connections: () => count,
    close: async () => {
      for (const response of live) response.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** Accept the connection, flush headers, deliver the base snapshot — OPEN and LIVE. */
function openWithSnapshot(response: ServerResponse, ageSeconds: number): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    ...CORS,
  });
  const payload = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (payload.batch === null || payload.batch === undefined) {
    throw new Error("fixture shape drifted");
  }
  payload.batch.age_seconds = ageSeconds;
  response.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** A held-open stream serving the fixture snapshot at a chosen age, plus the book routes. */
async function mockPostureWithBatchAge(page: Page, ageSeconds: number): Promise<StreamHarness> {
  const harness = await startStreamServer((_connection, response) => {
    openWithSnapshot(response, ageSeconds);
  });
  await page.route("**/v1/stream**", (route) => route.continue({ url: harness.url }));
  await page.route("**/v1/book", (route) => json(route, JSON.stringify(BOOK)));
  await page.route("**/v1/positions*", (route) =>
    json(route, JSON.stringify(POSITIONS_AAVE_PAGE_1)),
  );
  return harness;
}

// ---------------------------------------------------------------------------
// p0-8 finding 1 · absent boundaries refuse the health assertion.
// The wire legally serves `liquidation_price` with an EMPTY `prices` array
// (no-debt / no-factor solves) or with `lowest_healthy_price: null`
// (NullableDecimal), and `boundary_is_healthy` is the wire's OWN say on
// whether the boundary is a health claim. The row may say "still healthy at
// exactly this price (ceil P*)" ONLY when a numeric boundary exists AND
// `boundary_is_healthy` is true — an em dash dressed with a health sentence
// asserted an unknowable as healthy.
// Variants: structuredClone of the committed ADDRESS_FOUND fixture
// (tests/fixtures/inspector.ts), one documented purpose each, all
// contract-legal per api/openapi.yaml (LiquidationPrice / FactorPrice).
// ---------------------------------------------------------------------------

test.describe("p0-8 · absent boundaries refuse the health assertion", () => {
  test("(a) empty prices: the row states the boundary is not established — no health claim", async ({ page }) => {
    // Single documented purpose: the empty-prices arm with the wire's own
    // reason. The Aave position's liquidation_price gets `prices: []` and the
    // optional `reason` the solver serves alongside it; nothing else moves.
    const body = structuredClone(ADDRESS_FOUND);
    const aave = body.positions[0];
    if (aave === undefined || aave.liquidation_price === null) {
      throw new Error("fixture shape drifted");
    }
    aave.liquidation_price.prices = [];
    aave.liquidation_price.reason = "position holds no counted collateral in the factor";
    await mockInspectorFound(page);
    await page.route("**/v1/address/*", (route) => route.fulfill({ json: body, headers: CORS }));
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    await expect(card.getByText("Health boundary price")).toBeVisible();
    // The not-established register, with the wire's reason exposed.
    const row = card.getByTestId("boundary-not-established");
    await expect(row).toBeVisible();
    await expect(row).toContainText("not established");
    await expect(row).toContainText("position holds no counted collateral in the factor");
    // The kill pin: no exact-price health assertion anywhere on the card.
    await expect(card.getByText(/still healthy/i)).toHaveCount(0);
  });

  test("(b) null lowest_healthy_price: a served FactorPrice without a boundary refuses too", async ({ page }) => {
    // Single documented purpose: the null-boundary arm. Only
    // prices[0].lowest_healthy_price flips to null (NullableDecimal);
    // current_price stays served — a mark without a boundary is still not
    // a health claim.
    const body = structuredClone(ADDRESS_FOUND);
    const price = body.positions[0]?.liquidation_price?.prices[0];
    if (price === undefined) throw new Error("fixture shape drifted");
    price.lowest_healthy_price = null;
    await mockInspectorFound(page);
    await page.route("**/v1/address/*", (route) => route.fulfill({ json: body, headers: CORS }));
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    const row = card.getByTestId("boundary-not-established");
    await expect(row).toBeVisible();
    await expect(row).toContainText("not established");
    await expect(card.getByText(/still healthy/i)).toHaveCount(0);
  });

  test("(c) boundary_is_healthy false: the number and the mark render WITHOUT the assertion", async ({ page }) => {
    // Single documented purpose: the declined-assertion arm. Only
    // boundary_is_healthy flips to false — the numeric boundary stays, the
    // current mark stays, and the health sentence may not.
    const body = structuredClone(ADDRESS_FOUND);
    const aave = body.positions[0];
    if (aave === undefined || aave.liquidation_price === null) {
      throw new Error("fixture shape drifted");
    }
    aave.liquidation_price.boundary_is_healthy = false;
    await mockInspectorFound(page);
    await page.route("**/v1/address/*", (route) => route.fulfill({ json: body, headers: CORS }));
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    // boundary value + current mark still render (p0-3's own pins, unchanged
    // fixture numbers)…
    await expect(card).toContainText("3,703.70370371");
    await expect(card).toContainText("current weETH ≈ 4,000");
    // …but the exact-price health assertion is gone — the row's kill pin.
    await expect(card.getByText(/still healthy/i)).toHaveCount(0);
    // The drawer obeys the same law: no ceil-health sentence.
    await card.getByRole("button", { name: "explain health boundary price" }).click();
    await expect(page.getByText("EXPLAIN · HEALTH BOUNDARY PRICE")).toBeVisible();
    await expect(page.getByText(/still HEALTHY/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// p0-8 finding 2 · malformed deltas refuse the quiet arm.
// Run-book bodies are JSON-cast without runtime validation, so a delta outside
// the wire Decimal contract (api/openapi.yaml `Decimal`: ^-?[0-9]+$) can reach
// the cell — and the old zero test read "" as zero, rendering an unknowable
// as "no effective movement". A malformed field is its own visible register.
// ---------------------------------------------------------------------------

test.describe("p0-8 · malformed deltas refuse the quiet arm", () => {
  test("an empty-string delta renders the malformed register, never 'no effective movement'", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the malformed arm): the first engine's bad_debt_delta_usd set
    // to "" — outside the wire Decimal contract. Everything else
    // byte-identical; every other read field stays contract-legal.
    const body = structuredClone(RUN_BOOK_200);
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.bad_debt_delta_usd = "";
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    // Settle gate first (both the honest arm and a quiet-routed mutant reach
    // "result"), THEN the kill pin in isolation: the quiet line must be
    // absent. A mutant routing malformed to quiet dies exactly here.
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).not.toContainText("no effective movement");
    // The malformed register: visible, non-quiet, naming the field.
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(cell).toContainText("unreadable");
    await expect(cell).toContainText("bad_debt_delta_usd");
  });
});

test.describe("p0-5 · snapshot chip", () => {
  test("a FRESH batch still shows its age beside the live badge", async ({ page }) => {
    const harness = await mockPostureWithBatchAge(page, 42); // snapshot frame, age_seconds 42
    try {
      await page.goto("/book");
      const header = page.getByRole("banner");
      await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible(); // badge untouched
      const chip = header.getByTestId("ribbon-snapshot");
      await expect(chip).toBeVisible();
      await expect(chip).toContainText("42s old");
      await expect(chip).toContainText("snapshot #");
    } finally {
      await harness.close();
    }
  });

  test("an old batch reads in hours+minutes, not a coarse suffix", async ({ page }) => {
    const harness = await mockPostureWithBatchAge(page, 65_532);
    try {
      await page.goto("/book");
      await expect(page.getByRole("banner").getByTestId("ribbon-snapshot")).toContainText(
        "18h 12m old",
      );
      // old suffix retired
      await expect(page.getByRole("banner").getByTestId("ribbon-batch-age")).toHaveCount(0);
    } finally {
      await harness.close();
    }
  });
});
