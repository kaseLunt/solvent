// W3 + W-SD-A — the Scenarios surface, against mock routes whose bodies are
// GENERATED fixtures (tests/fixtures/generate.mjs and generate-lab-book.mjs
// document the provenance: contract-validated stress bodies from
// packages/client-ts, the run-book 200 example extracted verbatim from
// api/openapi.yaml, the /v1/scenarios example envelope over definitions
// derived by the contract's own `Omit<Scenario,"results">` rule, and three
// documented single-change variants). Nothing here is hand-shaped.
//
// WHAT W-SD-A CHANGED, and why the expectations below moved with it:
//
//   BOOK MODE IS THE DEFAULT AND ARRIVES ALIVE. The committed listing comes
//   from `GET /v1/scenarios` (cold, no batch envelope) and the frontier from
//   `/v1/book`'s waterfall — so the surface no longer harvests its scenario
//   list from an address run's outcomes, and no longer renders an empty state
//   until one happens. Every expectation that pinned the harvest, the empty
//   state, or `pickDefaultScenario` is therefore gone or inverted, and each
//   such change is annotated at its site.
//
// What this file pins:
//   - cold arrival renders dek + frontier + matrix + committed list with ZERO
//     run requests issued
//   - `?scenario=<id>` auto-runs EXACTLY ONE scenario, and only a member of
//     the served set
//   - the matrix's five cell states, plus the single-batch guard's own
//     superseded state — and that a superseded result is never blended
//   - address mode is reachable and SECONDARY
//   - the address-mode laws W3 established: chips from the wire, the depeg
//     flagship, exact rationals, held_flat, boundary group, `found: null`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";
const MINUS = "−";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

const STRESS_AAVE = JSON.parse(fixture("stress-aave.json")) as {
  address: string;
  scenarios: { id: string; label: string }[];
};
const STRESS_DM = JSON.parse(fixture("stress-dm.json")) as {
  address: string;
  scenarios: { id: string; label: string }[];
};
const STRESS_UNKNOWABLE = JSON.parse(fixture("stress-unknowable.json")) as { address: string };
const SCENARIOS = JSON.parse(fixture("scenarios.json")) as {
  scenarios: { id: string; label: string; engines: string[] }[];
};

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

async function mockStress(page: Page, addr: string, body: string, status = 200) {
  await page.route(`${API}/v1/address/${addr}/stress`, (route) => json(route, body, status));
}

/**
 * Address mode is the SECONDARY register now, so every address-mode spec
 * reaches it the way a reader does: one click from the default whole-book view.
 */
async function runStress(page: Page, addr: string) {
  await mockCold(page);
  await page.goto("/lab");
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const button = page.getByTestId("run-stress-button");
  // A fill can land BEFORE React hydrates (the DOM takes the value, React
  // state stays empty and the submit stays disabled). Refill until React
  // acknowledges it — the enable is driven only by React state.
  await expect(async () => {
    await input.fill(addr);
    await expect(button).toBeEnabled({ timeout: 250 });
  }).toPass();
  await button.click();
}

// ---------------------------------------------------------------------------
// W-SD-A — book mode: the default, alive on arrival.
// ---------------------------------------------------------------------------

test("COLD ARRIVAL: dek + frontier + matrix + committed list, with ZERO run requests", async ({
  page,
}) => {
  let runRequests = 0;
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    runRequests += 1;
    return route.abort();
  });

  await page.goto("/lab");

  // Book mode is the DEFAULT — nothing was clicked to get here.
  await expect(page.getByTestId("mode-book")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lab-book-panel")).toBeVisible();

  // The dek is the COMPUTED cliff sentence over the served waterfall.
  //
  // WAVE R9 (round-17 finding 2) CHANGED THIS EXPECTATION, and the change IS
  // the finding, RENDERED. The terminal bad-debt clause read only the LEAD
  // engine (the one holding the most terminal eligible debt), so this sentence
  // stated aave's $2,190.47619048 and stopped — over a book whose OTHER served
  // engine, debt_manager, reaches $2,219.801981 at that very same step. The
  // committed fixture has been carrying a second insolvent engine all along and
  // the page never said its name. Both are named now, each at its own decimals,
  // and they are never added together.
  await expect(page.getByTestId("lab-dek")).toHaveText(
    `The first step already bites: ETH down 10% makes 1 account on aave_v3_etherfi newly ` +
      `liquidatable. By ${MINUS}50%, aave_v3_etherfi's Σ eligible debt reaches $6,000 and its ` +
      `bad debt $2,190.47619048, and debt_manager's bad debt reaches $2,219.801981 at that ` +
      `same step.`,
  );
  // NEVER SUMMED: the two books total $4,410.278171, a number that appears
  // nowhere on the page.
  await expect(page.getByTestId("lab-dek")).not.toContainText("4,410");

  // The frontier: one panel per engine, drawn from /v1/book's waterfall.
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
  await expect(page.getByTestId("frontier-panel")).toHaveCount(2);
  await expect(page.getByTestId("frontier-reading")).toContainText(
    "unshocked is the standing census",
  );

  // The matrix: the COMMITTED listing × the engines it names.
  await expect(page.getByTestId("lab-matrix")).toBeVisible();
  await expect(page.getByTestId("matrix-row")).toHaveCount(SCENARIOS.scenarios.length);

  // The committed-scenario list and detail, from the cold listing.
  await expect(page.getByTestId("lab-chip")).toHaveCount(SCENARIOS.scenarios.length);
  await expect(page.getByTestId("committed-detail")).toBeVisible();

  // THE POINT: not one run was issued to put all of that on screen.
  expect(runRequests).toBe(0);
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("matrix-batch-line")).toContainText("no run has been issued yet");
});

test("the committed list comes from /v1/scenarios — NOT harvested from a run", async ({
  page,
}) => {
  // W-SD-A CHANGED THIS EXPECTATION. It used to be impossible to assert: the
  // list did not exist until an address run returned it. The listing route is
  // now the only source, and blocking it leaves the matrix ABSENT rather than
  // partial or invented.
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios`, (route) =>
    json(route, fixture("error-unavailable.json"), 503),
  );

  await page.goto("/lab");
  await expect(page.getByTestId("listing-error")).toBeVisible();
  await expect(page.getByTestId("listing-error")).toContainText(
    "No scenario list is hardcoded here and none is invented",
  );
  await expect(page.getByTestId("lab-matrix")).toHaveCount(0);
  // The frontier does NOT depend on the listing, and still renders.
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
});

test("the frontier renders the wire's caveats VERBATIM and never plots a withheld engine", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book-engine-refused.json")));

  await page.goto("/lab");
  // One panel only: the withheld engine contributes no points at all.
  await expect(page.getByTestId("frontier-panel")).toHaveCount(1);
  await expect(page.getByTestId("frontier-panel")).toHaveAttribute("data-engine", "debt_manager");
  // …and is NAMED, so the absence cannot be silent.
  await expect(page.getByTestId("frontier-excluded")).toContainText("FLAG_CUSTODY_UNPROVEN");
  // The wire's own notes, byte for byte.
  await expect(page.getByTestId("frontier-at-risk-note")).toContainText(
    "carries NO monotonicity invariant",
  );
  await expect(page.getByTestId("frontier-eligibility-note")).toContainText(
    "realized ≤ eligible",
  );
  // The dek says unknown, never zero.
  await expect(page.getByTestId("lab-dek")).toContainText("its side is unknown rather than zero");
});

test("a monotonicity violation is SURFACED with its point named, never smoothed", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) =>
    json(route, fixture("book-monotonicity-violation.json")),
  );

  await page.goto("/lab");
  await expect(page.getByTestId("frontier-monotonicity-violation")).toContainText(
    "monotonicity VIOLATED at debt_manager step 2",
  );
  await expect(page.getByTestId("lab-dek")).toContainText(
    "breaks its monotonicity invariant at debt_manager step 2",
  );
});

// ---------------------------------------------------------------------------
// W-SD-A — the matrix's cell states.
// ---------------------------------------------------------------------------

/** Route run-book per scenario id; `stall` never settles, so the row stays running. */
async function mockRuns(page: Page, bodies: Record<string, string | "stall">) {
  await page.route(`${API}/v1/scenarios/*/run-book`, async (route) => {
    const id = /\/v1\/scenarios\/([a-z0-9_]+)\/run-book/.exec(route.request().url())?.[1] ?? "";
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, headers: CORS, body: "{}" });
    if (body === "stall") return new Promise(() => {/* never settles */});
    return json(route, body);
  });
}

test("the matrix renders ALL FIVE cell states, and not-covered never looks like withheld", async ({
  page,
}) => {
  await mockCold(page);
  await mockRuns(page, {
    eth_minus_30: fixture("run-book.eth_minus_30.json"), // batch 1 → RESULT
    weeth_market_depeg_oracles_held: fixture("run-book.weeth-withheld.json"), // batch 1 → WITHHELD
    ethfi_minus_50: "stall", // → RUNNING
  });

  await page.goto("/lab");
  const cell = (scenario: string, engine: number) =>
    page.locator(`[data-testid="matrix-row"][data-scenario-id="${scenario}"] td`).nth(engine);

  // 1. NOT COVERED · structural, from the listing, with zero runs issued.
  //    dm_rate_horizon_plus_200bps is defined for debt_manager only.
  const notCovered = cell("dm_rate_horizon_plus_200bps", 1);
  await expect(notCovered).toHaveAttribute("data-cell-state", "not-covered");
  await expect(notCovered).toContainText("NOT COVERED");
  await expect(notCovered).toHaveAttribute("title", /not a refusal and not a failed run/);

  // 2. NOT RUN — a covered cell nobody has asked about yet.
  await expect(cell("ethfi_minus_50", 2)).toHaveAttribute("data-cell-state", "not-run");

  // 3. RESULT — the run's own delta, in the engine's own decimals.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  const result = cell("eth_minus_30", 2);
  await expect(result).toHaveAttribute("data-cell-state", "result");
  await expect(result).toContainText("$1,500"); // 1500000000 @ 6dp, grouped
  await expect(result).toContainText("DELTA-ONLY");

  // 4. WITHHELD — a refusal, with its code, on an engine the DEFINITION names.
  await page
    .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  const withheld = cell("weeth_market_depeg_oracles_held", 1);
  await expect(withheld).toHaveAttribute("data-cell-state", "withheld");
  await expect(withheld).toContainText("FLAG_CUSTODY_UNPROVEN");

  // 5. RUNNING — in flight, never blank and never a stale value.
  await page.locator('[data-testid="matrix-run"][data-scenario-id="ethfi_minus_50"]').click();
  await expect(cell("ethfi_minus_50", 2)).toHaveAttribute("data-cell-state", "running");

  // THE LOAD-BEARING DISTINCTION: the two absences are different states, and
  // neither is rendered as the other or as a zero.
  await expect(notCovered).toHaveAttribute("data-cell-state", "not-covered");
  await expect(withheld).not.toContainText("NOT COVERED");
  await expect(notCovered).not.toContainText("FLAG_CUSTODY_UNPROVEN");

  // No total column, ever: engine books are never summed.
  await expect(page.getByTestId("matrix-legend")).toContainText("no total column");
  await expect(page.locator('[data-testid="matrix-table"] thead th')).toHaveCount(4); // scenario + 2 engines + run
});

test("SUPERSESSION: the stale result is NAMED, kept on screen, and never mixed", async ({
  page,
}) => {
  await mockCold(page);
  let ethCalls = 0;
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    const url = route.request().url();
    if (url.includes("/eth_minus_30/")) {
      ethCalls += 1;
      return json(
        route,
        fixture(ethCalls === 1 ? "run-book.eth_minus_30.json" : "run-book.eth_minus_30.batch2.json"),
      );
    }
    return json(route, fixture("run-book.weeth.batch2.json"));
  });

  await page.goto("/lab");
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();

  // While batch 1 is the only held result, it IS the cohort.
  const ethCell = page.locator(
    '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"] td',
  ).nth(2);
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(page.getByTestId("matrix-batch-line")).toContainText(
    "results shown together were measured at batch #1",
  );

  // A newer batch lands mid-matrix. The older row does NOT silently join it.
  await page
    .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(ethCell).toContainText("SUPERSEDED");
  await expect(ethCell).toContainText("at batch #1");
  await expect(ethCell).toContainText("matrix reads #2");
  await expect(ethCell).toContainText("re-run this row");

  // The header states the anchor AND counts what is not on it — one sentence
  // that can never be read as a cross-batch total.
  const batchLine = page.getByTestId("matrix-batch-line");
  await expect(batchLine).toContainText("measured at batch #2");
  await expect(batchLine).toContainText("1 row(s) still hold an older batch's result");
  await expect(batchLine).toContainText("never blended into the sentence above");

  // THE RE-RUN AFFORDANCE ACTUALLY WORKS: running the stale row again against
  // the newer batch rejoins it to the cohort. (The route serves batch 1 on the
  // first call and batch 2 on the second — which is exactly what a re-run
  // against a book that has moved on returns.)
  await page.locator('[data-testid="matrix-run"][data-scenario-id="eth_minus_30"]').click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  // WAVE R10 CHANGED THIS EXPECTATION (round-18 finding 2). The assurance used
  // to read "Every held result is on that batch." — a claim over HELD evidence,
  // which includes the pin an IN-FLIGHT row is still carrying and which the
  // displayed lists deliberately omit. Both rows are settled here, so the two
  // sets coincide and the old sentence was not false in THIS state; it was
  // false with a row re-running while holding an older batch, which is pinned
  // by tests/e2e/r10-fixes.spec.ts (2). The claim now speaks about what is
  // DISPLAYED in every state, and older held pins are disclosed separately.
  await expect(page.getByTestId("matrix-batch-line")).toContainText(
    "Every DISPLAYED result was measured at that batch.",
  );
});

test("the matrix discloses that the frontier reads its OWN batch", async ({ page }) => {
  await mockCold(page);
  await mockRuns(page, {
    weeth_market_depeg_oracles_held: fixture("run-book.weeth.batch2.json"), // batch 2
  });
  await page.goto("/lab");
  await page
    .locator('[data-testid="matrix-run"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  // book.json is batch 1; the run is batch 2. The two are named, never merged.
  await expect(page.getByTestId("matrix-batch-line")).toContainText(
    "The loss frontier above reads batch #1, a different batch from this table",
  );
});

// ---------------------------------------------------------------------------
// W-SD-A — the deep link.
// ---------------------------------------------------------------------------

test("?scenario=<id> auto-runs EXACTLY ONE scenario; bare arrival runs none", async ({ page }) => {
  const runs: string[] = [];
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    runs.push(route.request().url());
    return json(route, fixture("run-book.eth_minus_30.json"));
  });

  await page.goto("/lab?scenario=eth_minus_30");
  await expect(page.getByTestId("book-result")).toBeVisible();
  expect(runs).toHaveLength(1);
  expect(runs[0]).toContain("/v1/scenarios/eth_minus_30/run-book");
});

test("a deep link naming an id the deployment does not publish runs NOTHING", async ({ page }) => {
  const runs: string[] = [];
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    runs.push(route.request().url());
    return route.abort();
  });

  await page.goto("/lab?scenario=not_a_committed_id");
  await expect(page.getByTestId("lab-matrix")).toBeVisible();
  expect(runs).toEqual([]);
  // The surface still arrives alive; the unknown id simply selects nothing.
  await expect(page.getByTestId("lab-dek")).toContainText("The first step already bites");
});

// ---------------------------------------------------------------------------
// W-SD-A — address mode: reachable, and secondary.
// ---------------------------------------------------------------------------

test("address mode is REACHABLE but SECONDARY — book is the default register", async ({
  page,
}) => {
  await mockCold(page);
  await page.goto("/lab");

  // Ordinal demotion: whole book is the first control on the surface.
  const buttons = page.locator('[role="group"][aria-label="run mode"] button');
  await expect(buttons.nth(0)).toHaveAttribute("data-testid", "mode-book");
  await expect(buttons.nth(1)).toHaveAttribute("data-testid", "mode-address");
  await expect(page.getByTestId("mode-caption")).toContainText(
    "whole book is the default view; one address is the secondary register",
  );

  // …and reachable in one click, where it says what it is.
  await page.getByTestId("mode-address").click();
  await expect(page.getByTestId("lab-address-section")).toBeVisible();
  await expect(page.getByTestId("address-secondary-note")).toContainText("SECONDARY REGISTER");
  await expect(page.getByTestId("lab-address-input")).toBeVisible();
  // Book mode's panel is not left standing underneath it.
  await expect(page.getByTestId("lab-book-panel")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The run-book outcome states, now reached from BOOK mode's own run control.
// ---------------------------------------------------------------------------

test("book mode: the honest-404 state — never a spinner, never fake data", async ({ page }) => {
  // W-SD-A CHANGED THIS EXPECTATION: the test no longer runs an address stress
  // first. Book mode learns the committed set from `/v1/scenarios`, so the run
  // control is reachable on arrival.
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    json(route, fixture("error-not-found.json"), 404),
  );

  await page.goto("/lab");
  await page.getByTestId("run-book-button").click();

  const notServed = page.getByTestId("runbook-not-served");
  await expect(notServed).toBeVisible();
  await expect(notServed).toContainText("book-wide stress not yet served by this deployment");
  await expect(notServed).toContainText("/run-book");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-running")).toHaveCount(0);

  // And the matrix says UNANSWERED — a 404 is not a zero.
  const cell = page
    .locator('[data-testid="matrix-row"][data-scenario-id="eth_minus_30"] td')
    .nth(2);
  await expect(cell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(cell).toContainText("about the DEPLOYMENT");
});

test("book mode: renders the served run-book response — the UI ships ready", async ({ page }) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    json(route, fixture("run-book.weeth_market_depeg_oracles_held.json")),
  );

  await page.goto("/lab");
  // W-SD-A CHANGED THIS EXPECTATION: the flagship is now selected by CLICKING
  // its committed chip, not by `pickDefaultScenario` scanning an address run's
  // results for a realization axis. That function is deleted.
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();

  await expect(page.getByTestId("book-result")).toBeVisible();

  // Per-engine aggregates in each engine's OWN decimals, never combined.
  const engines = page.getByTestId("book-engine");
  await expect(engines).toHaveCount(2);
  await expect(engines.nth(0)).toContainText("aave_v3_etherfi");
  // CX-4: ONE grouped-USD renderer across the Lab. These used to print
  // `$8000` here and `$8,000` in the frontier panel above, from the same wire
  // field, because two money helpers disagreed about thousands separators.
  await expect(engines.nth(0)).toContainText("$8,000"); // 800000000000 @ 8dp
  await expect(engines.nth(1)).toContainText("debt_manager");
  await expect(engines.nth(1)).toContainText("$4,620"); // 4620000000 @ 6dp

  // The book-wide flagship claim: HFs unchanged while shortfall is realized.
  await expect(page.getByTestId("hfs-unchanged-banner")).toHaveCount(2);
  // WAVE W-EX-A MOVED THIS MONEY, and the move is the repair. The contract's
  // run-book 200 example used to publish $400 of execution shortfall on the
  // AAVE engine — an engine whose own `eligible_accounts` is 0. An execution
  // shortfall is summed over LIQUIDATABLE positions only
  // (internal/risk/shortfall.go:97-104), so an empty sum is "0", and the
  // example is now CAPTURED from the running handler rather than composed. The
  // shortfall lives where the eligible account is: the Debt Manager.
  await expect(engines.nth(0).getByTestId("market-realization")).toContainText("$0");
  await expect(engines.nth(1).getByTestId("market-realization")).toContainText("$200");

  // Delta-only labeling on the wire-published deltas.
  await expect(engines.nth(0)).toContainText("DELTA-ONLY");

  // Coverage, exclusions, and the empty held_flat CLAIM all render.
  await expect(page.getByTestId("book-coverage")).toContainText("stress_coverage_is_full");
  await expect(page.getByTestId("book-excluded")).toContainText("excluded engines: none");
});

test("book mode: 503 renders the no-batch refusal — a statement about the service", async ({
  page,
}) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { ...CORS, "retry-after": "5" },
      body: fixture("error-unavailable.json"),
    }),
  );

  await page.goto("/lab");
  await page.getByTestId("run-book-button").click();

  const noBatch = page.getByTestId("runbook-no-batch");
  await expect(noBatch).toBeVisible();
  await expect(noBatch).toContainText("no complete risk batch");
  await expect(noBatch).toContainText("retry after 5s");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
});

test("a 503 on /v1/book refuses the frontier — a service statement, never an empty book", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("error-unavailable.json"), 503));

  await page.goto("/lab");
  await expect(page.getByTestId("frontier-refused")).toContainText("no servable batch (503)");
  await expect(page.getByTestId("lab-dek")).toContainText(
    "That is a statement about the SERVICE, never an empty book",
  );
  // The matrix does NOT depend on a batch, and still renders.
  await expect(page.getByTestId("lab-matrix")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Address mode (W3's laws, unchanged — reached through the secondary tab).
// ---------------------------------------------------------------------------

test("scenario chips render from the wire's committed set — never hardcoded", async ({ page }) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);
  await expect(page.getByTestId("lab-found")).toBeVisible();

  // Exactly the fixture's scenarios, in wire order. The committed set is
  // eleven; this contract-validated body is a three-scenario excerpt — the
  // chip count FOLLOWING THE DATA is the proof nothing is hardcoded.
  const chips = page.getByTestId("lab-chip");
  await expect(chips).toHaveCount(STRESS_AAVE.scenarios.length);
  for (const [index, scenario] of STRESS_AAVE.scenarios.entries()) {
    await expect(chips.nth(index)).toContainText(scenario.label);
  }

  // The projected axis carries the PROJECTION badge on its chip.
  await expect(
    page.locator('[data-testid="lab-chip"][data-scenario-id="dm_rate_horizon_plus_200bps"]'),
  ).toContainText("PROJECTION");

  // This committed excerpt has no stable_usd-only member, so the boundary
  // group does NOT render — absence, not invention.
  await expect(page.getByTestId("lab-boundary-group")).toHaveCount(0);
});

test("the depeg flagship: hfs_unchanged asserted, HFs bit-identical, shortfall priced", async ({
  page,
}) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);

  // W-SD-A CHANGED THIS EXPECTATION: the default chip is the committed set's
  // OWN first member in wire order, not the realization-bearing one
  // `pickDefaultScenario` used to hunt for. The click is now load-bearing.
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();

  const contrast = page.getByTestId("flagship-contrast");
  await expect(contrast).toBeVisible();
  await expect(contrast).toContainText("what the protocol sees");
  await expect(contrast).toContainText("what the market realizes");

  // The banner renders because the WIRE asserts it.
  await expect(page.getByTestId("hfs-unchanged-banner")).toBeVisible();
  await expect(page.getByTestId("hfs-unchanged-banner")).toContainText("hfs_unchanged");

  // Bit-identical health factors, at full 18-decimal exactness, twice.
  await expect(contrast.getByText("1.080000000000000000")).toHaveCount(2);
  await expect(page.getByTestId("bit-identical")).toBeVisible();

  // The market side: shortfall in the realization's own decimals + the
  // seizure-model disclosure, captioned.
  await expect(page.getByTestId("market-realization")).toContainText("$0");
  await expect(page.getByTestId("seizure-model")).toContainText(
    "pro-rata-over-counted-collateral",
  );
});

test("exact rationals, held_flat, and snap/cap disclosures render from data", async ({ page }) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await runStress(page, STRESS_AAVE.address);
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();

  // The shock factor as the honest number it is: ratio AND percent, exact.
  const shocks = page.getByTestId("scenario-shocks");
  await expect(shocks).toContainText("70/100");
  await expect(shocks).toContainText(`${MINUS}30%`);

  // held_flat: the named list, visible.
  const heldFlat = page.getByTestId("held-flat");
  await expect(heldFlat).toBeVisible();
  await expect(heldFlat).toContainText("0xA0b8…eB48");
  await expect(heldFlat).toContainText("100000000");

  // Applied-shock disclosures: every flag stated explicitly, even when false.
  const flags = page.getByTestId("shock-flags");
  await expect(flags).toContainText("snapped: no");
  await expect(flags).toContainText("base_snapped: no");
  await expect(flags).toContainText("cap_bound: no");

  // The state pair marks the crossing and carries the warn-band disclosure.
  await expect(page.getByTestId("state-pair")).toContainText("NEWLY ELIGIBLE");
  await expect(page.getByTestId("warn-band-disclosure")).toContainText("presentation band");
});

test("boundary group and PROJECTION panel render from the DM fixture's data", async ({ page }) => {
  await mockStress(page, STRESS_DM.address, fixture("stress-dm.json"));
  await runStress(page, STRESS_DM.address);
  await expect(page.getByTestId("lab-found")).toBeVisible();

  // The stable-snap group: derived from the stable_usd axis, one committed
  // member in this body — it renders that member, and only that member.
  const group = page.getByTestId("lab-boundary-group");
  await expect(group).toBeVisible();
  await expect(page.getByTestId("lab-boundary-item")).toHaveCount(1);
  await expect(group).toContainText("Stablecoin depeg to 0.995 (inside the snap band)");
  await expect(group).toContainText("995/1000");
  await expect(group).toContainText(`${MINUS}0.5%`);
  await expect(group).toContainText("no-op · served states bit-identical");

  // The rate scenario: a PROJECTION, delta-only, sealed horizon verdicts, and
  // the wire's own no-time-to-liquidatable statement.
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="dm_rate_horizon_plus_200bps"]')
    .click();
  const projection = page.getByTestId("projection-panel");
  await expect(projection).toBeVisible();
  await expect(projection).toContainText("PROJECTION");
  await expect(projection).toContainText("delta-only");
  await expect(projection).toContainText("+200bps");
  await expect(projection).toContainText("(= 30 d)");
  await expect(projection.locator("tbody tr")).toHaveCount(2);
  await expect(projection).toContainText("becomes liquidatable");
  await expect(projection).toContainText("No time-to-liquidatable");
});

test("found:null renders 'cannot be established' with the refusal named — never 'no position'", async ({
  page,
}) => {
  await mockStress(page, STRESS_UNKNOWABLE.address, fixture("stress-unknowable.json"));
  await runStress(page, STRESS_UNKNOWABLE.address);

  const unknowable = page.getByTestId("lab-unknowable");
  await expect(unknowable).toBeVisible();
  await expect(unknowable).toContainText("cannot be established");
  await expect(unknowable).toContainText("FLAG_CUSTODY_UNPROVEN");
  // The ONLY surface entitled to say "no position" (the definitive-negative
  // panel) must be absent. (The wire's own note QUOTES the phrase while
  // negating it, so this is asserted structurally, not by text search.)
  await expect(page.getByTestId("lab-not-found")).toHaveCount(0);
});

test("address mode: 429 renders the rate-limit refusal with the server's own retry", async ({
  page,
}) => {
  await page.route(`${API}/v1/address/${STRESS_AAVE.address}/stress`, (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { ...CORS, "retry-after": "3" },
      body: fixture("error-rate-limited.json"),
    }),
  );

  await runStress(page, STRESS_AAVE.address);
  const error = page.getByTestId("lab-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("rate limited (429)");
  await expect(error).toContainText("retry after 3s");
  await expect(page.getByTestId("lab-found")).toHaveCount(0);
});

test("an invalid address never becomes a request", async ({ page }) => {
  let stressRequests = 0;
  await mockCold(page);
  await page.route(`${API}/v1/address/**`, (route) => {
    stressRequests += 1;
    return route.abort();
  });

  await page.goto("/lab");
  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  // Refill until hydration has happened (the hint renders only from React
  // state) so the disabled assertion is about VALIDATION, not about SSR.
  await expect(async () => {
    await input.fill("not-an-address");
    await expect(page.getByTestId("address-hint")).toBeVisible({ timeout: 250 });
  }).toPass();
  await expect(page.getByTestId("address-hint")).toContainText("40 hex");
  await expect(page.getByTestId("run-stress-button")).toBeDisabled();
  expect(stressRequests).toBe(0);
});
