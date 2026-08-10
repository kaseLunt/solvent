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
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";
import { OBSERVATORY_SERIES_AAVE } from "../fixtures/observatory";

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

// ---------------------------------------------------------------------------
// p1b-3 · the tornado classifies before it draws.
//
// Set-run mocks in tornado.spec.ts's register: the POST answered with the
// committed no-denominator variant carrying ONE documented corruption, the
// OPTIONS preflight answered, every request body captured in a sink.
// ---------------------------------------------------------------------------

/** Mock the set-run POST (tornado.spec.ts's mockSetRun: OPTIONS leg + sink). */
async function mockSetRun(
  page: Page,
  body: () => { status: number; body: string },
  sink: string[],
) {
  await page.route(`${API}/v1/scenarios/run-book-set`, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: RUN_CORS, body: "" });
    }
    sink.push(route.request().postData() ?? "");
    const answer = body();
    return route.fulfill({
      status: answer.status,
      contentType: "application/json",
      headers: RUN_CORS,
      body: answer.body,
    });
  });
}

/** The base listing's four variant ids, in its own order (tornado.spec.ts). */
const SET_VARIANT_LINK =
  "/lab?scenarios=eth_minus_30,weeth_market_depeg_oracles_held,dm_rate_horizon_plus_200bps,ethfi_minus_50";

test.describe("p1b-3 · the tornado classifies before it draws", () => {
  test("a malformed set-run Decimal refuses the ROW by name — the route stays live and the other row's bar draws", async ({
    page,
  }) => {
    await mockCold(page);
    // Single documented change to the committed set variant, serving ONE
    // purpose (the malformed arm): eth_minus_30's debt_manager
    // eligible_debt_delta_usd set to "" — outside the wire Decimal contract.
    // Today the bare BigInt in barLength coerces it to 0n (a measured-zero
    // costume on the panel) and the ledger's renderSignedUsdAmount throws on
    // it, so the route boundary replaces the whole tornado. Everything else
    // byte-identical.
    const body = JSON.parse(fixture("run-book-set.no-denominator.json")) as {
      results: {
        scenario_id: string;
        engines: { engine: string; eligible_debt_delta_usd: string }[];
      }[];
    };
    const row = body.results
      .find((candidate) => candidate.scenario_id === "eth_minus_30")
      ?.engines.find((candidate) => candidate.engine === "debt_manager");
    if (row === undefined) throw new Error("fixture shape: eth_minus_30/debt_manager missing");
    row.eligible_debt_delta_usd = "";
    const posts: string[] = [];
    await mockSetRun(page, () => ({ status: 200, body: JSON.stringify(body) }), posts);

    await page.goto(SET_VARIANT_LINK);

    // ROUTE STAYS LIVE: the set settles into a classified surface, never the
    // route boundary. With the classifier bypassed, the ledger's money
    // renderer throws and no header ever renders — this pin dies first.
    const header = page.getByTestId("tornado-header");
    await expect(header).toBeVisible();
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);

    // The malformed register, in the p0-8 voice, naming the field PER ENGINE
    // INDEX — a row state, before the visual, never empty space.
    const state = page.locator('[data-testid="tornado-state"][data-state="malformed"]');
    await expect(state).toHaveCount(1);
    await expect(state).toHaveAttribute("data-scenario-id", "eth_minus_30");
    await expect(state).toContainText("MALFORMED RESULT");
    await expect(state).toContainText("engines[1].eligible_debt_delta_usd");
    await expect(state).toContainText("unreadable is not zero");

    // EXCLUDED from bars and geometry; the OTHER row's bar still draws — the
    // refusal is scoped to the result that earned it, never spread over the
    // set. And nothing else is read from the malformed result: its aave
    // engine's no-denominator claim (a measurement claim) vanishes with it.
    await expect(
      page.locator('[data-testid="tornado-bar"][data-scenario-id="eth_minus_30"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="tornado-bar"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="tornado-bar"]').first()).toHaveAttribute(
      "data-scenario-id",
      "ethfi_minus_50",
    );
    await expect(
      page.locator('[data-testid="tornado-zero-bar"][data-scenario-id="eth_minus_30"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId("tornado-no-denominator")).toHaveCount(0);

    // THE HEADER'S ARITHMETIC STAYS HONEST: the drawn count drops the row
    // (2 → 1 against the unmutated variant) and the row is NAMED in its own
    // clause — never silently dropped.
    await expect(header).toHaveText(
      "batch 1 · bars drawn for 1 of 4 requested scenario(s) · shock did not reach: 0 · " +
        "declared no move: 0 · engines named absent rather than drawn: 0 · " +
        "malformed, not read: 1 (eth_minus_30)",
    );

    // THE LEDGER: no numeric row and no block row for the malformed result —
    // its register row sits in their place, fields named, nothing claimed.
    await expect(
      page.locator('[data-testid="tornado-ledger-row"][data-scenario-id="eth_minus_30"]'),
    ).toHaveCount(0);
    const ledgerRow = page.locator(
      '[data-testid="tornado-ledger-malformed"][data-scenario-id="eth_minus_30"]',
    );
    await expect(ledgerRow).toHaveCount(1);
    await expect(ledgerRow).toContainText("MALFORMED RESULT");
    await expect(ledgerRow).toContainText("engines[1].eligible_debt_delta_usd");
    await expect(ledgerRow).toContainText("unreadable is not zero");

    // The healthy rows keep their whole account: ethfi's numeric ledger row,
    // weeth's market-realization blocks, the projection block.
    await expect(
      page.locator('[data-testid="tornado-ledger-row"][data-scenario-id="ethfi_minus_50"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="tornado-ledger-block"][data-block="market-realization"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-testid="tornado-ledger-block"][data-block="projection"]'),
    ).toHaveCount(1);
    expect(posts).toHaveLength(1);
  });
});

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

// ---------------------------------------------------------------------------
// p1b-4 · factor-price entries are classified before they are read.
//
// Inspector mocks in p0-fixes.spec.ts's register (its mockInspectorFound,
// parameterized over the address body): stream aborted, params/events/history
// pinned from the typed TS fixtures, the address route answered with a
// structuredClone of ADDRESS_FOUND carrying ONE documented contract
// violation each — reproducing OBSERVED server classes (the p0-9 family:
// cmd/api marshals Go nil pointers as JSON null; a version-skewed or partial
// serializer omits fields).
// ---------------------------------------------------------------------------

type AddressBody = typeof ADDRESS_FOUND;

async function mockInspector(page: Page, body: AddressBody) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: HISTORY, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) => route.fulfill({ json: body, headers: CORS }));
}

test.describe("p1b-4 · factor-price entries are classified before they are read", () => {
  test("an entry-level null (prices: [null]) renders the malformed register — the card stays live", async ({
    page,
  }) => {
    // Single documented purpose: the entry-level-null arm. REPRODUCES the
    // p0-9 serialization class one level down — cmd/api marshals a Go nil
    // pointer as JSON null, and inside a served slice that is
    // `prices: [null]`: contract-violating per api/openapi.yaml (FactorPrice
    // is non-nullable in `prices`) but the same observed server family as
    // p0-9's `prices: null`. `as never` marks the deliberate violation.
    const body = structuredClone(ADDRESS_FOUND);
    const aave = body.positions[0];
    if (aave === undefined || aave.liquidation_price === null) {
      throw new Error("fixture shape drifted");
    }
    aave.liquidation_price.prices = [null as never];
    await mockInspector(page, body);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    // RENDERS-WITHOUT-CRASH PIN: with the guard absent (or its {ok: false}
    // routed to the value arm), `lowest_healthy_price` is read off null, the
    // TypeError reaches the route boundary and this card never paints — the
    // visibility pin below dies first.
    const row = card.getByTestId("boundary-malformed");
    await expect(row).toBeVisible();
    await expect(row).toContainText("unreadable");
    await expect(row).toContainText("malformed");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
    // No health claim is invented over an unreadable entry.
    await expect(card.getByText(/still healthy/i)).toHaveCount(0);
  });

  test("a deleted price_decimals refuses — the RAW scaled integer never renders as a price", async ({
    page,
  }) => {
    // Single documented purpose: the silent-raw-render arm (the WORST class:
    // no throw, just a wrong number). Deleting the REQUIRED `price_decimals`
    // (a version-skewed or partial serializer's shape, the same observed
    // omission family) hits money()'s no-scale branch, which renders the RAW
    // scaled integer "370370370371" — grouped to "370,370,370,371" — as a
    // plausible boundary price.
    const body = structuredClone(ADDRESS_FOUND);
    const price = body.positions[0]?.liquidation_price?.prices[0];
    if (price === undefined) throw new Error("fixture shape drifted");
    delete (price as { price_decimals?: number }).price_decimals;
    await mockInspector(page, body);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    await expect(card.getByText("Health boundary price")).toBeVisible();
    // THE SILENT-RAW-RENDER KILL PINS, first — the fixture's raw
    // lowest_healthy_price digits may not appear on the card in EITHER
    // spelling: the wire's own digit-run, or money()'s grouped rendering of
    // the same digits (the branch actually reached from the card).
    await expect(card).not.toContainText("370370370371");
    await expect(card).not.toContainText("370,370,370,371");
    // The malformed register names the missing scale.
    const row = card.getByTestId("boundary-malformed");
    await expect(row).toBeVisible();
    await expect(row).toContainText("price_decimals");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
    await expect(card.getByText(/still healthy/i)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// p1b-5 · stress results carry their full identity (cross-page brief §5).
//
// The Lab's address mode bound ONLY the address (p0-1's `results for {addr}`
// line); batch and config version were display-only in the stamp below, no
// age was anchored, and the answered engines were nowhere. The done arm now
// renders the §5 identity line — address · batch · config · answered engines,
// every field from the RESPONSE — under the SAME `lab-result-address` testid
// (p0-1's text pin migrated, ledgered old→new), plus its own anchored age
// (`lab-result-age`), the wire's `age_seconds` under lib/freshness law 1.
//
// Lab mock shapes reused from p0-fixes.spec.ts: cold routes pinned, the
// stress GET served from the committed stress-aave.json (structuredClone +
// one documented change where a test needs a discriminating age), the
// hydration-race fill idiom for the input.
// ---------------------------------------------------------------------------

type StressBody = components["schemas"]["StressResponse"];
const STRESS_200 = JSON.parse(fixture("stress-aave.json")) as StressBody;
/** The found-arm address the committed fixture answers for. */
const STRESS_ADDR = STRESS_200.address;

/** Serve one stress body for the fixture's own address. */
async function mockStress(page: Page, body: StressBody) {
  await page.route(`${API}/v1/address/${STRESS_ADDR}/stress`, (route) =>
    json(route, JSON.stringify(body)),
  );
}

/** Enter address mode, run the committed set, wait for the found arm. */
async function runStress(page: Page) {
  await page.goto("/lab");
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  // A fill can land BEFORE React hydrates — refill until React acknowledges
  // it (p0-fixes' idiom; the enable is driven only by React state).
  await expect(async () => {
    await input.fill(STRESS_ADDR);
    await expect(button).toBeEnabled({ timeout: 250 });
  }).toPass();
  await button.click();
  await expect(page.getByTestId("lab-found")).toBeVisible();
}

test.describe("p1b-5 · stress results carry their full identity", () => {
  test("the settled result renders the §5 identity line and its own anchored age", async ({
    page,
  }) => {
    await mockCold(page);
    // Single documented change to the committed stress fixture, serving ONE
    // purpose (a DISCRIMINATING age): batch.age_seconds 0 → 42, so the age
    // pin cannot be satisfied by a hardcoded zero, an empty slot, or a
    // computed_at-vs-browser-clock recomputation (the fixture's computed_at
    // is weeks old — that path would render hours, not 42s). Everything else
    // byte-identical.
    const body = structuredClone(STRESS_200);
    body.batch.age_seconds = 42;
    await mockStress(page, body);
    await runStress(page);
    // THE IDENTITY LINE (the grown p0-1 pin, same testid): address · batch ·
    // config · answered engines, each field from the response, in canon
    // order. The answered engines are the DISTINCT engines in the RESULTS —
    // the fixture's scenario definitions name debt_manager too, but only
    // aave answers for this address, so the line must not claim it.
    await expect(page.getByTestId("lab-result-address")).toHaveText(
      `results for ${STRESS_ADDR} · batch #1 · config v1 · engines aave_v3_etherfi`,
    );
    // THE ANCHORED AGE: the wire's own age_seconds through humanAge — its
    // own element, never a clause frozen into the identity string.
    await expect(page.getByTestId("lab-result-age")).toHaveText("42s old");
  });

  test("the stale barrier still interposes: identity and age withdraw and return together", async ({
    page,
  }) => {
    await mockCold(page);
    await mockStress(page, STRESS_200);
    await runStress(page);
    // The committed fixture verbatim: age_seconds 0 renders "0s old".
    await expect(page.getByTestId("lab-result-age")).toHaveText("0s old");
    // p0-1's barrier law, unchanged by the grown line: editing the input
    // withdraws the WHOLE identity — line and age both — behind the barrier…
    const input = page.getByTestId("lab-address-input");
    await input.fill(STRESS_ADDR.slice(0, -1) + "0");
    await expect(page.getByTestId("lab-stale-result")).toBeVisible();
    await expect(page.getByTestId("lab-result-address")).toHaveCount(0);
    await expect(page.getByTestId("lab-result-age")).toHaveCount(0);
    // …and retyping the exact address restores both (pure derivation, no
    // data destruction — the p0-1 round-trip).
    await input.fill(STRESS_ADDR);
    await expect(page.getByTestId("lab-result-address")).toContainText("batch #1");
    await expect(page.getByTestId("lab-result-age")).toHaveText("0s old");
  });
});

// ---------------------------------------------------------------------------
// p1b-6 · the identity gap audit closes (Task 6): abort symmetry, scoped
// feed echoes, the observatory's verbatim as-of, the history batch weld,
// and the Lab arms' computed-at + run-again register.
//
// Mock shapes reused from the sections above (mockCold/mockStress/runStress,
// mockInspector, observatory.spec.ts's series route). Every corruption or
// variant is a structuredClone of a committed fixture with its documented
// change(s) at the site.
// ---------------------------------------------------------------------------

type HistoryBody = typeof HISTORY;

/** mockInspector with a CALLER-CHOSEN history body (the weld needs both vantages). */
async function mockInspectorHistory(page: Page, history: HistoryBody) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: history, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) =>
    route.fulfill({ json: ADDRESS_FOUND, headers: CORS }),
  );
}

test.describe("p1b-6 · the identity gap audit closes", () => {
  test("fix 2: a stale walk's page cannot write its filter echo over the current walk's", async ({
    page,
  }) => {
    // THE RACE, made deterministic. A response that has FULLY ARRIVED (stream
    // closed, bytes buffered) before restartWalk()'s abort fires is not
    // rejected by that abort — the page-side continuation still runs, AFTER
    // the reset, and used to write the OLD scope's filter echo under the NEW
    // walk's controls. The init-script shim below models exactly that
    // closed-stream case: it detaches the first types=borrow request from
    // the abort signal and holds its resolution under the test's control, so
    // the stale continuation runs strictly AFTER walk B's echo rendered.
    await page.route("**/v1/stream**", (route) => route.abort());
    await page.route(`${API}/v1/events*`, (route) => {
      // The wire's echo mirrors each request's own types param — two scopes,
      // two DISTINGUISHABLE echoes, from one committed body.
      const typesParam = new URL(route.request().url()).searchParams.get("types");
      const body = structuredClone(EVENTS);
      body.filter = {
        ...body.filter,
        types: (typesParam === null ? [] : typesParam.split(",")) as typeof body.filter.types,
      };
      body.next_cursor = null;
      return route.fulfill({ json: body, headers: CORS });
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __releaseHeldEvents: (() => void) | null };
      w.__releaseHeldEvents = null;
      const realFetch = window.fetch.bind(window);
      let held = false;
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (
          !held &&
          url.includes("/v1/events") &&
          url.includes("types=borrow") &&
          !url.includes("%2C")
        ) {
          held = true;
          // Detached from the abort signal: the closed-stream case, where an
          // abort arriving after full receipt has nothing left to reject.
          const settled = realFetch(url, { ...init, signal: null });
          await new Promise<void>((resolve) => {
            w.__releaseHeldEvents = resolve;
          });
          return settled;
        }
        return realFetch(input, init);
      }) as typeof window.fetch;
    });

    await page.goto("/feed");
    const foot = page.getByTestId("feed-foot");
    // The initial cross-engine walk settles first (its own echo: types all).
    await expect(foot).toContainText("types all");

    const chips = page.getByTestId("type-chips");
    // Filter change ONE: walk A (types=borrow) — its page is HELD by the shim.
    const requestA = page.waitForRequest(
      (request) => request.url().includes("types=borrow") && !request.url().includes("%2C"),
    );
    await chips.getByRole("button", { name: "borrow", exact: true }).click();
    await requestA;
    // Filter change TWO, rapidly after: walk B (types=borrow,repay), answered.
    await chips.getByRole("button", { name: "repay", exact: true }).click();
    await expect(foot).toContainText("types borrow,repay");

    // Release walk A's held page: its continuation runs AFTER the reset that
    // dropped its walk. The envelope echo must keep naming the SECOND scope.
    await page.evaluate(() => {
      (window as unknown as { __releaseHeldEvents: (() => void) | null }).__releaseHeldEvents?.();
    });
    await page.waitForTimeout(300); // the stale continuation gets its turn
    await expect(foot).toContainText("types borrow,repay");
    // The stale echo's own spelling (types borrow · since_block …) may not
    // stand anywhere in the foot.
    await expect(foot).not.toContainText("types borrow ·");
  });

  test("fix 3: the observatory head states the wire's own served_at verbatim", async ({
    page,
  }) => {
    // The rollup envelope carries served_at but NO age_seconds (recorded
    // decision): no anchored age exists, no tick runs, and a browser-clock
    // age would violate freshness law 1. The wire's own instant renders
    // verbatim at the head.
    await page.route("**/v1/stream**", (route) => route.abort());
    await page.route("**/v1/observatory/series*", (route) =>
      route.fulfill({ json: OBSERVATORY_SERIES_AAVE, headers: CORS }),
    );
    await page.goto("/observatory");
    await expect(page.getByTestId("observatory-as-of")).toHaveText(
      `as of ${OBSERVATORY_SERIES_AAVE.served_at}`,
    );
  });

  test("fix 4: the history section welds its vantage to the position's batch when they differ", async ({
    page,
  }) => {
    // The COMMITTED fixtures already differ: the history example is served
    // from batch 2 while the address example's lookup batch is 1 — exactly
    // the fresh-batch-between-two-fetches seam the weld exists to state.
    await mockInspector(page, ADDRESS_FOUND);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    await expect(page.getByTestId("history-batch-weld")).toHaveText(
      `history window newest batch #${String(HISTORY.batch.id)} · position read at batch #${String(ADDRESS_FOUND.batch.id)}`,
    );
  });

  test("fix 4: matching batches render NO weld — the line exists only for a real seam", async ({
    page,
  }) => {
    // Single documented change to the committed history fixture, one purpose
    // (the no-seam arm): its vantage batch re-pinned to the lookup's batch id
    // (2 → 1), so the two sections describe one world.
    const history = structuredClone(HISTORY);
    history.batch.id = ADDRESS_FOUND.batch.id;
    await mockInspectorHistory(page, history);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    // Anchor on the SETTLED history card first, so the zero-count below is a
    // statement about the ready state rather than about a loading gap.
    await expect(page.getByTestId("history-frame-aave_v3_etherfi")).toBeVisible();
    await expect(page.getByTestId("history-batch-weld")).toHaveCount(0);
  });

  test("item 7: the not-found stress arm states the batch computed_at verbatim", async ({
    page,
  }) => {
    await mockCold(page);
    // Two documented changes serving ONE purpose (the not-found arm): found
    // false with an empty scenario set — the definitive negative the
    // contract licenses (lookup_complete true, nothing withheld, so
    // lookup() refines to not-found).
    const body = structuredClone(STRESS_200);
    body.found = false;
    body.scenarios = [];
    await mockStress(page, body);
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(STRESS_ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    await expect(page.getByTestId("lab-not-found")).toBeVisible();
    // Canon §05: identity + computed-at + age. The clause mirrors the found
    // arm's LabBatchStamp wording, from the same envelope, verbatim.
    await expect(page.getByTestId("lab-result-computed")).toHaveText(
      `batch ${String(STRESS_200.batch.id)} · computed ${STRESS_200.batch.computed_at}`,
    );
  });

  test("item 8: the Lab age's blind resume says RUN AGAIN — never a refresh it never attempted", async ({
    page,
  }) => {
    await mockCold(page);
    await mockStress(page, STRESS_200);
    await runStress(page);
    await expect(page.getByTestId("lab-result-age")).toHaveText("0s old");
    // A BLIND resume by freshness.ts's own definition: definitive lifecycle
    // evidence (a recorded departure, then a visible return) whose clock
    // deltas the coalescing window refuses — dispatched synthetically within
    // seconds of the receipt, so neither clock certifies an interval. The
    // tracker reads only event.type + document.visibilityState.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("focus"));
    });
    // No repair is wired on this surface (the run is reader-dispatched), so
    // the register's third arm renders: not "refreshing" (no work is in
    // flight), not "refresh failed" (nothing was attempted) — run again.
    await expect(page.getByTestId("lab-result-age")).toHaveText(
      "age UNKNOWN since resume · run again to refresh",
    );
  });
});

// ---------------------------------------------------------------------------
// p1b-9 · the Codex-round fix wave: the response's own address welds the
// identity (finding 1), the histogram counts join the classifier (finding 2).
//
// Finding 3 (the activity rows' render-synchronous mask) is pinned at the
// unit level (tests/unit/pagination-scope.spec.ts): the A→B component reuse
// it guards is remount-dependent in the real router, and e2e navigation
// between two inspector addresses is a full-document load here — the reuse
// frame cannot be produced from the outside. Recorded choice, per brief.
//
// Mock shapes reused from the sections above (mockCold/mockStress,
// mockRunBook/corruptedRunBook/aaveCell) — every corruption a structuredClone
// of a committed fixture with ONE documented change.
// ---------------------------------------------------------------------------

test.describe("p1b-9 · Codex-round fixes", () => {
  test("f1: a mislabeled response body is refused by name — another address's data never wears this address's head", async ({
    page,
  }) => {
    await mockCold(page);
    // Single documented change to the committed stress fixture, serving ONE
    // purpose (the mislabeled-echo arm): the response's own `address` field
    // moved to a DIFFERENT account than the one the run was dispatched for —
    // the cache/proxy/server mislabel class. Everything else byte-identical,
    // so with the weld absent the body renders as a perfectly healthy result
    // under the WRONG head.
    const body = structuredClone(STRESS_200);
    const ECHOED = "0xbBbB000000000000000000000000000000000002";
    body.address = ECHOED;
    await mockStress(page, body);
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(STRESS_ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    // THE REFUSAL, in the identity-refusal register: both addresses named,
    // nothing claimed for either. With the weld absent, lab-found settles
    // instead and this pin dies first.
    const refusal = page.getByTestId("lab-address-mismatch");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(STRESS_ADDR);
    await expect(refusal).toContainText(ECHOED);
    // NO scenario content, NO identity line claiming the dispatched address,
    // NO anchored age — the body is not read.
    await expect(page.getByTestId("lab-found")).toHaveCount(0);
    await expect(page.getByTestId("lab-result-address")).toHaveCount(0);
    await expect(page.getByTestId("lab-result-age")).toHaveCount(0);
    // The route stays live: a refusal is a rendered statement, not a throw.
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
  });

  test("f2: a malformed histogram COUNT refuses the engine by name — never a zero-share costume", async ({
    page,
  }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the counts-bypass arm): engines[0]'s (aave_v3_etherfi)
    // before.hf_histogram.buckets[0].count set to "" — a field the p1b-2
    // classifier never read. Today it passes the gate and coerces to a
    // zero-share costume in belowOneCount/measuredCount (`0 + ""` is `"0"`).
    // Everything else byte-identical.
    const body = corruptedRunBook((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.count = "" as never;
    });
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    // ROUTE STAYS LIVE, the cell settles malformed — same law, same register
    // as the p1b-2 pins above.
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
    // The ENGINE PANEL shows the malformed register naming the COUNT by its
    // full wire path, per side and index.
    const aavePanel = page.locator('[data-testid="book-engine"][data-engine="aave_v3_etherfi"]');
    await expect(aavePanel).toHaveAttribute("data-engine-outcome", "malformed");
    await expect(aavePanel).toContainText("before.hf_histogram.buckets[0].count");
    // The healthy second engine renders normally — the refusal is scoped.
    const dmPanel = page.locator('[data-testid="book-engine"][data-engine="debt_manager"]');
    await expect(dmPanel).not.toHaveAttribute("data-engine-outcome", "malformed");
    await expect(dmPanel.getByTestId("book-engine-answer")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// p1b-10 · the Codex round-2 fix wave: the weld reaches every nested
// `scenarios[].results[].account` (finding 1 completion — finding 2's
// population/signed split is pinned at unit level: the guard's own law in
// wire-guard.spec.ts, the field assignments in the two classifier specs, and
// the render consequence is the SAME malformed register the p1b-9 f2 pin
// above already holds).
// ---------------------------------------------------------------------------

test.describe("p1b-10 · Codex round-2 fixes", () => {
  test("f1: a nested result for ANOTHER account refuses the whole body by path — top-level honesty is not admission", async ({
    page,
  }) => {
    await mockCold(page);
    // Single documented change to the committed stress fixture, serving ONE
    // purpose (the nested-mislabel arm): the top-level `address` stays
    // honest, and exactly ONE nested `scenarios[2].results[0].account` is
    // moved to a different account. With only the p1b-9 top-level weld, this
    // body settles as done and renders B's nested state under "results for
    // A" — the exact defect class the weld exists to kill.
    const body = structuredClone(STRESS_200);
    const NESTED = "0xbBbB000000000000000000000000000000000002";
    const nested = body.scenarios[2]?.results[0];
    if (!nested) throw new Error("fixture shape: scenarios[2].results[0] missing");
    nested.account = NESTED;
    await mockStress(page, body);
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(STRESS_ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    // THE REFUSAL, in the identity-refusal register: the offending PATH and
    // both addresses named, nothing claimed for either.
    const refusal = page.getByTestId("lab-address-mismatch");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("scenarios[2].results[0].account");
    await expect(refusal).toContainText(STRESS_ADDR);
    await expect(refusal).toContainText(NESTED);
    // NO scenario content, NO identity line, NO anchored age — the body was
    // never admitted, so no arm can read its numbers.
    await expect(page.getByTestId("lab-found")).toHaveCount(0);
    await expect(page.getByTestId("lab-result-address")).toHaveCount(0);
    await expect(page.getByTestId("lab-result-age")).toHaveCount(0);
    // The route stays live: a refusal is a rendered statement, not a throw.
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
  });
});
