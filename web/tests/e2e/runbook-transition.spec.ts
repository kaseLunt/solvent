// Wave W-TM — the run-book's transition matrix (contract 1.7.0), driven through
// the real Scenarios page against GENERATED fixtures.
//
// Sibling of `runbook-bsplit.spec.ts`. Bodies come from
// `tests/fixtures/generate-lab-book.mjs`, whose `checkTransitions` law re-proves
// every matrix against the two histograms beside it on every body it writes —
// so a fixture that contradicted itself would never reach this file.
//
// What this pins:
//   - a served run renders ONE matrix per engine, with the crossings the two
//     histograms structurally could not give;
//   - the (N+1, N+1) cell renders its two debts in the REFUSAL REGISTER —
//     "not measured", never $0.00;
//   - the wire's own `note` renders VERBATIM, and the cause split beside it
//     names which coverage field holds those rows;
//   - the Debt Manager's matrix carries NO crit tint: its lanes are the exact
//     rational, a disclosure and not a liquidation verdict;
//   - a body whose margins disagree with its own distributions is REFUSED with
//     its reasons, never drawn;
//   - none of it renders when the row holds no served book.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

async function runScenario(page: Page, id: string, body: string) {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => json(route, body));
  await page.goto("/lab");
  await page.locator(`[data-testid="lab-chip"][data-scenario-id="${id}"]`).click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

test("a served run renders ONE transition matrix per engine, with the crossings on the page", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const matrices = page.getByTestId("runbook-transition");
  await expect(matrices).toHaveCount(2);
  for (const engine of ["aave_v3_etherfi", "debt_manager"]) {
    await expect(
      page.locator(`[data-testid="runbook-transition"][data-engine="${engine}"]`),
    ).toHaveAttribute("data-state", "ok");
  }

  // The comparator travels with the matrix, so it is readable without the
  // histograms in scope — and the two engines do NOT share one.
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]'),
  ).toContainText("comparator: hf_wad");
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]'),
  ).toContainText("comparator: hf_num/hf_den");

  // THE GROSS CROSSINGS, which no pair of marginals could produce. The Aave row
  // of this book falls from band 3 into band 0, so exactly one row enters the
  // region and none leaves it.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("runbook-transition-answer")).toContainText(
    "1 row moved INTO the below-1.00 region",
  );
  await expect(aave.getByTestId("runbook-transition-answer")).toContainText(
    "0 rows moved OUT of it",
  );
  await expect(aave.getByTestId("runbook-transition-changed")).toHaveText("1");
  await expect(aave.getByTestId("runbook-transition-held")).toHaveText("0");

  // The matrix's own occupied cells are on the page, and the crossing is one of
  // them rather than an inference from two bars.
  await expect(aave.locator('[data-testid="runbook-transition-cell"][data-from="3"][data-to="0"]')).toHaveCount(1);
});

test("the unmeasured cell renders in the REFUSAL REGISTER, never as a dollar zero", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');

  const unmeasured = aave.locator('[data-testid="runbook-transition-cell"][data-unmeasured="true"]');
  await expect(unmeasured).toHaveCount(1);
  // BOTH debts are withheld, in the named-absence register.
  await expect(unmeasured.getByTestId("runbook-transition-nodebt")).toHaveCount(2);
  await expect(unmeasured).toContainText("not measured");
  // And NO dollar figure appears on that row. A "$0.00" would say this run
  // priced the row at nothing, which is a measurement nobody made.
  await expect(unmeasured).not.toContainText("$");

  // The unmeasured population is counted, not dropped — and the cause split
  // beside the note names which coverage field actually holds those rows.
  await expect(aave.getByTestId("runbook-transition-unmeasured")).toHaveText("1");
  await aave.getByTestId("runbook-transition-forensics").locator("summary").click();
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "1 refused by riskd",
  );
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "coverage.refused_in_batch",
  );
  await expect(aave.getByTestId("runbook-transition-causes")).toContainText(
    "0 this service could not rebuild",
  );
});

test("the wire's own note renders VERBATIM, with the disambiguations intact", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await dm.getByTestId("runbook-transition-forensics").locator("summary").click();

  const note = dm.getByTestId("runbook-transition-wire-note");
  await expect(note).toContainText("`from_rows` IS the before histogram");
  await expect(note).toContainText("It is NOT `movers_total`");
  await expect(note).toContainText("NOT `newly_eligible_accounts`");
  await expect(note).toContainText("not a crossing count of any particular edge");
  await expect(note).toContainText("A cell absent from `cells` holds ZERO rows");
});

test("the Debt Manager's matrix is a DISCLOSURE and carries no verdict tint", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm.getByTestId("runbook-transition-method")).toContainText(
    "a DISCLOSURE and not its liquidation trigger",
  );
  await expect(dm.getByTestId("runbook-transition-method")).toContainText("Nothing here is tinted");

  // Aave's own comparator IS the pool's liquidation test, so its arrivals below
  // 1.00 are tinted — the same asymmetry the histogram pair already applies.
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("runbook-transition-method")).toContainText(
    "Arrivals below 1.00 are tinted",
  );
  await expect(aave.getByTestId("runbook-transition-method")).not.toContainText(
    "Nothing here is tinted",
  );
});

test("the method line refuses the confusion the field name invites", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  const aave = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  const method = aave.getByTestId("runbook-transition-method");
  await expect(method).toContainText("POSITION ROWS of this engine in this run");
  await expect(method).toContainText("never distinct addresses");
  await expect(method).toContainText("never added to another engine");
  await expect(method).toContainText("not a crossing count of the 1.00 edge");
  await expect(method).toContainText("own USD at 8 decimals");
});

test("A CONTRADICTORY MATRIX IS NOT DRAWN, and the page says why", async ({ page }) => {
  // The body can arrive from an older deployment or a broken one. A flow whose
  // ribbons do not sum to the bars printed beside them is a wrong answer that
  // looks computed, so the page refuses it and shows the disagreement.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as {
    engines: { engine: string; before: { hf_histogram: { buckets: { count: number }[] } } }[];
  };
  const aave = body.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("the fixture carries no aave engine");
  const bucket = aave.before.hf_histogram.buckets[0];
  if (bucket === undefined) throw new Error("the fixture's histogram carries no buckets");
  bucket.count += 4;

  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const matrix = page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]');
  await expect(matrix).toHaveAttribute("data-state", "contradictory");
  await expect(matrix.getByTestId("runbook-transition-refusal")).toContainText(
    "This matrix is NOT drawn",
  );
  await expect(matrix.getByTestId("runbook-transition-reasons")).toContainText(
    "the before distribution beside it counts",
  );
  // No cell table is drawn at all — the refusal replaces the picture rather
  // than sitting beside it.
  await expect(matrix.getByTestId("runbook-transition-cells")).toHaveCount(0);

  // AND THE OTHER ENGINE IS UNAFFECTED: the refusal is per engine, and a body
  // with one broken engine still serves the one that is whole.
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]'),
  ).toHaveAttribute("data-state", "ok");
});

test("the matrix does not render when the row holds no served book", async ({ page }) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    json(route, fixture("run-book.names-nobody.json")),
  );
  await page.goto("/lab");
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();

  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("runbook-transition")).toHaveCount(0);
});

test("a WITHHELD engine has no matrix at all, and the served engine still has one", async ({
  page,
}) => {
  // A withheld engine contributes no `engines[]` row, so it has no matrix — and
  // `total_rows` on the engine that IS served is that engine's own book, never
  // the whole batch's.
  await runScenario(
    page,
    "weeth_market_depeg_oracles_held",
    fixture("run-book.weeth-withheld.json"),
  );

  await expect(page.getByTestId("runbook-transition")).toHaveCount(1);
  await expect(
    page.locator('[data-testid="runbook-transition"][data-engine="aave_v3_etherfi"]'),
  ).toHaveCount(0);
  const dm = page.locator('[data-testid="runbook-transition"][data-engine="debt_manager"]');
  await expect(dm).toHaveAttribute("data-state", "ok");
  await expect(dm.getByTestId("runbook-transition-unmeasured")).toHaveText("1");
});
