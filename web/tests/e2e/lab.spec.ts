// W3 — Scenario Lab, against mock routes whose bodies are GENERATED fixtures
// (tests/fixtures/generate.mjs documents the provenance: contract-validated
// stress bodies from packages/client-ts, and the run-book 200 example
// extracted verbatim from api/openapi.yaml). Nothing here is hand-shaped.
//
// What this file pins, per the wave brief:
//   - chips render FROM FIXTURE DATA, never a hardcoded list
//   - the depeg flagship asserts `hfs_unchanged` and the two-panel contrast
//   - exact rational factors render as ratio AND percent
//   - `held_flat` is visible; snap/cap disclosures render explicitly
//   - the boundary group renders from data (and does NOT render when the
//     committed set carries no stable_usd member)
//   - book mode's honest-404 state renders (and the ready path renders real
//     aggregates when the endpoint is served)
//   - `found: null` renders "cannot be established", never "no position"

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

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

async function mockStress(page: Page, addr: string, body: string, status = 200) {
  await page.route(`${API}/v1/address/${addr}/stress`, (route) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body }),
  );
}

async function runStress(page: Page, addr: string) {
  await page.goto("/lab");
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

test("scenario chips render from the wire's committed set — never hardcoded", async ({
  page,
}) => {
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

  // Data-driven default selection lands on the realization-bearing scenario;
  // click it anyway to make the path explicit.
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

test("exact rationals, held_flat, and snap/cap disclosures render from data", async ({
  page,
}) => {
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

test("boundary group and PROJECTION panel render from the DM fixture's data", async ({
  page,
}) => {
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
  await expect(group).toContainText("no-op — served states bit-identical");

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

test("book mode: the honest-404 state — never a spinner, never fake data", async ({ page }) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      headers: CORS,
      body: fixture("error-not-found.json"),
    }),
  );

  await runStress(page, STRESS_AAVE.address);
  await expect(page.getByTestId("lab-found")).toBeVisible();
  await page.getByTestId("mode-book").click();

  // The committed set learned from the wire feeds book mode's chips.
  await expect(page.getByTestId("lab-chip")).toHaveCount(STRESS_AAVE.scenarios.length);
  await page.getByTestId("run-book-button").click();

  const notServed = page.getByTestId("runbook-not-served");
  await expect(notServed).toBeVisible();
  await expect(notServed).toContainText("book-wide stress not yet served by this deployment");
  await expect(notServed).toContainText("/run-book");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-running")).toHaveCount(0);
});

test("book mode: renders the served run-book response — the UI ships ready", async ({
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

  // Per-engine aggregates in each engine's OWN decimals, never combined.
  const engines = page.getByTestId("book-engine");
  await expect(engines).toHaveCount(2);
  await expect(engines.nth(0)).toContainText("aave_v3_etherfi");
  await expect(engines.nth(0)).toContainText("$8000"); // 800000000000 @ 8dp
  await expect(engines.nth(1)).toContainText("debt_manager");
  await expect(engines.nth(1)).toContainText("$4620"); // 4620000000 @ 6dp

  // The book-wide flagship claim: HFs unchanged while shortfall is realized.
  await expect(page.getByTestId("hfs-unchanged-banner")).toHaveCount(2);
  await expect(engines.nth(0).getByTestId("market-realization")).toContainText("$400");

  // Delta-only labeling on the wire-published deltas.
  await expect(engines.nth(0)).toContainText("DELTA-ONLY");

  // Coverage, exclusions, and the empty held_flat CLAIM all render.
  await expect(page.getByTestId("book-coverage")).toContainText("stress_coverage_is_full");
  await expect(page.getByTestId("book-excluded")).toContainText("excluded engines: none");
  await expect(page.getByTestId("held-flat")).toContainText(
    "the propagation matrix covered the whole run",
  );
});

test("book mode: 503 renders the no-batch refusal — a statement about the service", async ({
  page,
}) => {
  await mockStress(page, STRESS_AAVE.address, fixture("stress-aave.json"));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { ...CORS, "retry-after": "5" },
      body: fixture("error-unavailable.json"),
    }),
  );

  await runStress(page, STRESS_AAVE.address);
  await expect(page.getByTestId("lab-found")).toBeVisible();
  await page.getByTestId("mode-book").click();
  await page.getByTestId("run-book-button").click();

  const noBatch = page.getByTestId("runbook-no-batch");
  await expect(noBatch).toBeVisible();
  await expect(noBatch).toContainText("no complete risk batch");
  await expect(noBatch).toContainText("retry after 5s");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
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
  await page.route(`${API}/v1/address/**`, (route) => {
    stressRequests += 1;
    return route.abort();
  });

  await page.goto("/lab");
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
