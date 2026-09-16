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
//   p0-3 · health boundary price, p0-4 · engine terminology, p0-8 finding 1
//         (absent boundaries) and p0-9 finding 3 (prices:null): RETIRED with
//         the Inspector rebuild (2026-09-15) — the boundary arms are pinned in
//         tests/unit/inspector-position.spec.ts. Ledger:
//         .superpowers/sdd/progress-ui-overhaul.md, "Plan 2 (Inspector) — retirements".
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
    // the settled result names its address — p1b-5 MIGRATED PIN (old:
    // `results for ${ADDR}`): the bound-result line grew into the full §5
    // identity, same testid, text grown; ledgered old→new in
    // .superpowers/sdd/progress-ui-overhaul.md (p1b-5).
    await expect(page.getByTestId("lab-result-address")).toContainText(
      `results for ${ADDR} · batch #1 · config v1 · engines aave_v3_etherfi`,
    );
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

// ---------------------------------------------------------------------------
// p0-9 · codex round 2.
//
// finding 1 — the PARENT summary (`BookResult`'s answer line) used to compose
// `bookResultAnswer(response.engines)` BEFORE the per-engine guards below it,
// and that sentence parses `eligible_debt_delta_usd` through the throwing
// money renderers — so a malformed field p0-8's per-engine panel would have
// refused honestly took the whole /lab route down first. The parent now
// classifies every engine with the same `cellPrimaryOutcome` decision the
// cell and the panel read, and refuses its numeric summary when any engine
// is unreadable — naming the engine and its fields — while the per-engine
// panels still render (malformed one refused, healthy ones whole).
//
// finding 2 — the MALFORMED register existed only for `state="result"` cells;
// a SUPERSEDED cell rendered its held payload through the OLD composition:
// a malformed `bad_debt_delta_usd` quietly showed the eligible-debt dollars
// (the quiet bypass p0-2 closed for current cells), and a malformed
// `eligible_debt_delta_usd` crashed the route via the throwing parser. The
// superseded arm now classifies its payload first: malformed renders the
// malformed register PLUS the batch disclosure (old/new ids, re-run
// affordance); a valid payload renders exactly as before.
//
// finding 3 — the API's solver-error path serializes `liquidation_price.prices:
// null` (a Go nil slice), violating api/openapi.yaml's required-array
// contract; `lp.prices[0]` threw before p0-8's not-established arm could
// render. OBSERVED contract violation, UI-side defense only (the server-side
// slice init is outside this program's boundary): a non-array `prices` folds
// into the same absent-boundary register, with `lp.reason` still exposed.
// ---------------------------------------------------------------------------

/**
 * Finding 2's mixed-batch construction (lab.spec.ts's SUPERSESSION mock, with
 * a corrupted eth body): eth_minus_30 serves `ethBody` (batch 1), any other
 * scenario serves the committed weeth batch-2 fixture, whose settle makes
 * batch 2 the anchor and supersedes the eth row.
 */
async function mockMixedBatchRuns(page: Page, ethBody: RunBookBody) {
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: RUN_CORS, body: "" });
    }
    const body = route.request().url().includes("/eth_minus_30/")
      ? JSON.stringify(ethBody)
      : fixture("run-book.weeth.batch2.json");
    return route.fulfill({ status: 200, contentType: "application/json", headers: RUN_CORS, body });
  });
}

test.describe("p0-9 · codex round 2", () => {
  test("finding 1: a malformed engine refuses the PARENT summary; cell and detail name the field; the route stays live", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the parent-summary crash arm): the first engine's
    // (aave_v3_etherfi) eligible_debt_delta_usd set to "" — the field the
    // PARENT answer line parses, which p0-8's e2e (bad_debt_delta_usd) never
    // reached. Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.eligible_debt_delta_usd = "";
    await mockRunBook(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    // ROUTE STAYS LIVE: the run settles into a classified cell, not an error
    // boundary. A mutant that lets bookResultAnswer run unguarded dies here —
    // the throw unmounts the whole route and no cell ever settles.
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(cell).toContainText("eligible_debt_delta_usd");
    // The DETAIL names the same field from the same classification (p0-8's
    // per-engine refusal, now reachable because the parent no longer throws).
    const aavePanel = page.locator('[data-testid="book-engine"][data-engine="aave_v3_etherfi"]');
    await expect(aavePanel).toHaveAttribute("data-engine-outcome", "malformed");
    await expect(aavePanel).toContainText("eligible_debt_delta_usd");
    // The PARENT summary REFUSES the number, in the answer line's own
    // register: the malformed engine and its fields are named, and the
    // composed numeric sentence never renders.
    const answer = page.getByTestId("book-result-answer");
    await expect(answer).toContainText("makes no numeric claim");
    await expect(answer).toContainText("aave_v3_etherfi");
    await expect(answer).toContainText("eligible_debt_delta_usd");
    await expect(answer).not.toContainText("This scenario changes eligible accounts");
    // Healthy engines keep their whole panels: the refusal is scoped to the
    // engine that earned it, never spread over the book.
    const dmPanel = page.locator('[data-testid="book-engine"][data-engine="debt_manager"]');
    await expect(dmPanel).not.toHaveAttribute("data-engine-outcome", "malformed");
    await expect(dmPanel.getByTestId("book-engine-answer")).toBeVisible();
  });

  test("finding 2a: a superseded cell with a malformed bad debt refuses the quiet dollars and keeps the batch disclosure", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the superseded quiet-bypass arm): the first engine's
    // bad_debt_delta_usd set to "" — the field the OLD superseded composition
    // never read, so the cell showed the eligible-debt dollars as if the
    // payload were readable. Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.bad_debt_delta_usd = "";
    await mockMixedBatchRuns(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    // Batch 2 lands on ANOTHER row; the eth row's held payload is now a
    // superseded measurement — and it must be CLASSIFIED, not rendered raw.
    await page
      .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
      .click();
    await expect(cell).toHaveAttribute("data-cell-state", "superseded");
    // THE MIXED-BATCH PIN: the malformed register, in the superseded arm.
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(cell).toContainText("unreadable");
    await expect(cell).toContainText("bad_debt_delta_usd");
    // The quiet bypass is dead: the $6,000 the old arm composed from the
    // eligible-debt delta (600000000000 @ 8dp) never renders.
    await expect(cell).not.toContainText("$6,000");
    // The superseded batch disclosure SURVIVES the refusal: old and new ids,
    // and the re-run affordance, stay on the cell.
    await expect(cell).toContainText("at batch #1");
    await expect(cell).toContainText("matrix reads #2");
    await expect(cell).toContainText("re-run this row");
    // And the SAME row's valid payload keeps the unchanged rendering: the
    // debt_manager cell (1500000000 @ 6dp) still shows its dollars.
    const dmCell = page
      .locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"] td')
      .nth(2);
    await expect(dmCell).toHaveAttribute("data-cell-state", "superseded");
    await expect(dmCell).toContainText("$1,500");
  });

  test("finding 2b: a superseded cell with a malformed eligible debt refuses instead of crashing the route", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture, serving ONE
    // purpose (the superseded crash arm): the first engine's
    // eligible_debt_delta_usd set to "" — the exact field the OLD superseded
    // composition fed to the throwing parser. Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    const engine = body.engines[0];
    if (!engine) throw new Error("fixture shape: engines[0] missing");
    engine.eligible_debt_delta_usd = "";
    await mockMixedBatchRuns(page, body);
    await page.goto("/lab");
    await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
    const cell = aaveCell(page);
    await expect(cell).toHaveAttribute("data-cell-state", "result");
    await page
      .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
      .click();
    // ROUTE STAYS LIVE: with the superseded arm's guard removed this render
    // throws in usd() and the route unmounts — this settle pin dies first.
    await expect(cell).toHaveAttribute("data-cell-state", "superseded");
    await expect(cell).toHaveAttribute("data-cell-outcome", "malformed");
    await expect(cell).toContainText("unreadable");
    await expect(cell).toContainText("eligible_debt_delta_usd");
    await expect(cell).toContainText("at batch #1");
    await expect(cell).toContainText("matrix reads #2");
    await expect(cell).toContainText("re-run this row");
  });
});
