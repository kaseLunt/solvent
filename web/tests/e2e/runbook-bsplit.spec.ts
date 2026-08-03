// Wave W-BS-A — the three run-book surfaces contract 1.6.0 adds, driven
// through the real Scenarios page against GENERATED fixtures.
//
// Bodies come from `tests/fixtures/generate-lab-book.mjs`, whose provenance
// record covers the 1.6.0 fields: they ride the contract's own run-book 200
// example verbatim into every derived file, and the ONE derived delta
// (eth_minus_30's newly-eligible Debt Manager account) is carried through the
// histogram AND the movers array so the fixture cannot contradict itself.
//
// What this pins:
//   - a served run renders BOTH distributions per engine, the movers table,
//     and the collateral breakdown;
//   - the refused tail is visible beside every distribution — rows the
//     histogram could not place are counted, never dropped;
//   - the UNPRICED holding renders in the REFUSAL REGISTER with its balance
//     intact and NO dollar value anywhere on its row;
//   - `movers_note` renders VERBATIM, and the shown-vs-total disclosure is on
//     the page rather than implied by an array length;
//   - each engine is asked only the vocabulary it speaks: Aave shows wads, the
//     Debt Manager shows the exact rational and its eligibility flip;
//   - NONE of it renders when the row holds no served book.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { truncateAddress } from "../../lib/format";
import { ADDRESS_FOUND, EVENTS, HISTORY, PARAMS } from "../fixtures/inspector";

const API = "http://localhost:8080";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

const CORS = { "access-control-allow-origin": "*" };

/** The one account the eth_minus_30 fixture's derived delta flips. */
const DM_MOVER_ACCOUNT = "0x00000000000000000000000000000000000d0002";

function json(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
}

async function mockCold(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => json(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => json(route, fixture("book.json")));
}

/** Run one committed scenario and wait for its served book. */
async function runScenario(page: Page, id: string, body: string) {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => json(route, body));
  await page.goto("/lab");
  await page.locator(`[data-testid="lab-chip"][data-scenario-id="${id}"]`).click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

test("a served run renders BOTH distributions, the movers table and the collateral breakdown", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  // One pair per served engine, and each pair carries its own two sides.
  const pairs = page.getByTestId("runbook-histogram-pair");
  await expect(pairs).toHaveCount(2);
  await expect(page.getByTestId("runbook-hist-before")).toHaveCount(2);
  await expect(page.getByTestId("runbook-hist-after")).toHaveCount(2);

  // The comparator is named per engine, and the two engines do NOT share one.
  await expect(
    page.locator('[data-testid="runbook-histogram-pair"][data-engine="aave_v3_etherfi"]'),
  ).toContainText("comparator: hf_wad");
  await expect(
    page.locator('[data-testid="runbook-histogram-pair"][data-engine="debt_manager"]'),
  ).toContainText("comparator: hf_num/hf_den");

  // Both sides carry their refused tally — the anti-drop disclosure.
  const refused = page.getByTestId("runbook-hist-refused-before");
  await expect(refused).toHaveCount(2);
  await expect(refused.first()).toContainText("rows counted here, never dropped");

  // The movers table and the collateral breakdown, one of each per engine.
  await expect(page.getByTestId("runbook-movers")).toHaveCount(2);
  await expect(page.getByTestId("runbook-collateral")).toHaveCount(2);
  await expect(page.getByTestId("runbook-collateral-before")).toHaveCount(2);
  await expect(page.getByTestId("runbook-collateral-after")).toHaveCount(2);
});

test("the computed reading line names the SHIFT, derived from the two sides", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-histogram-pair"][data-engine="debt_manager"]');
  const reading = dm.getByTestId("runbook-hist-reading");
  await expect(reading).toContainText("What this shows: how the book's health factors moved");
  // The fixture's derived delta moves exactly one Debt Manager account across
  // the 1.00 edge, and the sentence must be that arithmetic — not a label.
  await expect(reading).toContainText(
    "1 of 2 measured accounts sat below 1.00 before the shock, 2 after",
  );
  await expect(reading).toContainText("the below-1.00 population grew by 1");
  // AND IT SAYS WHAT KIND OF NUMBER THAT IS. Two populations subtracted is a
  // NET figure; the wire serves no crossing count and the sentence must not
  // imply one.
  await expect(reading).toContainText("That is a NET figure");
  await expect(reading).toContainText("accounts may have moved in BOTH directions");
  await expect(reading).not.toContainText("crossed into that region");
  // Its buckets are a DISCLOSURE, never dressed as the engine's trigger.
  await expect(reading).toContainText("a DISCLOSURE, not this engine's trigger");
});

test("the served book RECONCILES with itself: coverage, accounts, and the money", async ({
  page,
}) => {
  // Wave W-BS-B finding 1. The fixture used to claim 5,700,000,000 of eligible
  // debt inside 4,620,000,000 of total debt, and three accounts across the two
  // engines under a `coverage.in_book` of 2. The generator now refuses to write
  // a body like that; this is the surface reading back what it writes.
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-histogram-pair"][data-engine="debt_manager"]');
  // Two accounts measured on this engine, which is what the census says and
  // what the invented account's existence requires.
  await expect(dm.getByTestId("runbook-hist-reading")).toContainText("of 2 measured accounts");

  // The itemization the reading line sums is the WHOLE collateral of the side,
  // the invented account's holding included.
  const dmCollateral = page.locator('[data-testid="runbook-collateral"][data-engine="debt_manager"]');
  await expect(dmCollateral.getByTestId("runbook-collateral-reading-before")).toContainText(
    "2 assets sum to $6,500",
  );
  // And it FALLS on the after side, because the account that flipped is the one
  // whose collateral moved.
  await expect(dmCollateral.getByTestId("runbook-collateral-reading-after")).toContainText(
    "2 assets sum to $5,750",
  );
});

test("the DEBT MANAGER's movers table shows the flip, the rational and the debt", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  await expect(dm).toHaveAttribute("data-movers-total", "1");
  // THE SUBJECT IS THIS ENGINE'S OWN ONE-DIRECTION LIST. `movers` on the Debt
  // Manager holds eligibility flips false -> true and nothing else, so calling
  // it "accounts that moved" would claim the other direction is in it.
  await expect(dm.getByTestId("runbook-movers-disclosure")).toHaveText(
    "Showing all 1 account whose debt became eligible, ranked by that debt.",
  );

  const rows = dm.getByTestId("runbook-mover");
  await expect(rows).toHaveCount(1);
  // The engine's OWN vocabulary: the exact rational on each side, the
  // eligibility flip, and the debt that became eligible at 6 decimals.
  await expect(dm.getByTestId("runbook-mover-flip")).toHaveText("became eligible");
  await expect(dm.getByTestId("runbook-mover-debt")).toContainText("$1,500");
  await expect(dm).toContainText("maxBorrowLT / borrowings before");
  // No wad column: the Debt Manager has none, so it is not asked for one.
  await expect(dm).not.toContainText("hf drop");

  // The account links into the Inspector — the row opens its own evidence.
  // THE ADDRESS IS THE PATH: `/inspector` is the entry form and reads no query,
  // so a `?address=` link landed on a blank form. The click-through below
  // proves the destination renders rather than trusting the shape of a string.
  const account = dm.getByTestId("runbook-mover-account");
  await expect(account).toHaveAttribute("href", `/inspector/${DM_MOVER_ACCOUNT}`);

  // THE SERVER'S OWN SENTENCE, VERBATIM: the ranking rule and the truncation.
  const note = dm.getByTestId("runbook-movers-note");
  await expect(note).toContainText("RANKED BY THE DEBT THAT BECAME ELIGIBLE");
  await expect(note).toContainText("not `newly_eligible_accounts`");
});

test("AAVE's movers table speaks wads — and an unmoved engine says so", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  // The eth_minus_30 fixture derives no Aave delta, so nothing moved there.
  // That is stated as zero MOVEMENT, never as a blank table — and in AAVE's own
  // vocabulary, because Aave ranks strict health-factor drops and the Debt
  // Manager ranks eligibility flips. One sentence for both would be wrong on
  // at least one of them.
  await expect(aave).toHaveAttribute("data-movers-total", "0");
  await expect(aave.getByTestId("runbook-movers-disclosure")).toHaveText(
    "No account's health factor dropped under this scenario on this engine.",
  );
  await expect(aave.getByTestId("runbook-mover")).toHaveCount(0);
  // The ranking rule still renders — the reader learns what WOULD have ranked.
  await expect(aave.getByTestId("runbook-movers-note")).toContainText("HEALTH-FACTOR DROP");
});

test("THE UNPRICED HOLDING RENDERS IN THE REFUSAL REGISTER — never as a zero", async ({ page }) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const aaveCollateral = page.locator(
    '[data-testid="runbook-collateral"][data-engine="aave_v3_etherfi"]',
  );

  // The contract example's unpriced Aave holding rides the fixture. Its row is
  // marked, its BALANCE is exact, and its value is a named absence.
  const unpricedRows = aaveCollateral.locator('[data-testid="runbook-collateral-row"][data-unpriced="true"]');
  await expect(unpricedRows.first()).toBeVisible();
  const tag = aaveCollateral.getByTestId("runbook-collateral-unpriced").first();
  await expect(tag).toHaveText("UNPRICED · no price witness");
  // The balance is still on the row — an unknowable VALUE is not a missing
  // holding.
  await expect(unpricedRows.first()).toContainText("5");
  // THE LAW: no dollar figure anywhere on an unpriced row.
  await expect(unpricedRows.first()).not.toContainText("$");

  // And the reading line says UNKNOWABLE rather than reporting a total that
  // silently excludes it.
  const reading = aaveCollateral.getByTestId("runbook-collateral-reading-before");
  await expect(reading).toContainText("UNKNOWABLE — not zero");
  await expect(reading).toContainText("outside that total");
});

test("the collateral breakdown is PER SIDE and per engine — never summed across engines", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const aave = page.locator('[data-testid="runbook-collateral"][data-engine="aave_v3_etherfi"]');
  const dm = page.locator('[data-testid="runbook-collateral"][data-engine="debt_manager"]');

  // Each engine reads at its OWN decimals and says so in its own sentence.
  await expect(aave.getByTestId("runbook-collateral-reading-before")).toContainText(
    "at 8 decimals — never added to another engine's",
  );
  await expect(dm.getByTestId("runbook-collateral-reading-before")).toContainText(
    "at 6 decimals — never added to another engine's",
  );
  // Both sides render for both engines: under an asset shock they differ, and
  // a single shared table could not show that.
  await expect(aave.getByTestId("runbook-collateral-before")).toBeVisible();
  await expect(aave.getByTestId("runbook-collateral-after")).toBeVisible();
});

test("NONE of the 1.6.0 surfaces render when the row holds no served book", async ({ page }) => {
  // A 200 that names NOBODY: the envelope looks healthy, both engine arrays
  // are empty. No result exists, so no distribution, no movers table and no
  // collateral breakdown may appear.
  await runScenarioNamingNobody(page);

  await expect(page.getByTestId("runbook-histogram-pair")).toHaveCount(0);
  await expect(page.getByTestId("runbook-movers")).toHaveCount(0);
  await expect(page.getByTestId("runbook-collateral")).toHaveCount(0);
  await expect(page.getByTestId("runbook-collateral-unpriced")).toHaveCount(0);
});

async function runScenarioNamingNobody(page: Page) {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    json(route, fixture("run-book.names-nobody.json")),
  );
  await page.goto("/lab");
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();
  // The run settles; what it must NOT do is paint a book.
  await expect(page.getByTestId("book-result")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Wave W-BS-B finding 3 — THE LINK GOES WHERE IT CLAIMS
// ---------------------------------------------------------------------------

/**
 * The Inspector's own route set, mocked the way `tests/e2e/inspector.spec.ts`
 * mocks it — registration order matters, because `*` never crosses `/` and the
 * bare address route is registered LAST so it does not swallow `/history`.
 *
 * The bodies are the committed inspector fixtures RE-IDENTIFIED to the mover's
 * account, so the surface never has to reconcile two different addresses.
 */
async function mockInspectorFor(page: Page, address: string) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: { ...HISTORY, address }, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) =>
    route.fulfill({ json: { ...ADDRESS_FOUND, address }, headers: CORS }),
  );
}

test("CLICKING a mover opens the Inspector's DYNAMIC route with that account on it", async ({
  page,
}) => {
  // The link used to point at `/inspector?address=…`. `/inspector` is the entry
  // FORM and reads no search params, so the click landed on a blank field: a
  // row that claimed to open its own evidentiary chain and opened nothing.
  // Asserting the href alone could not see that — only following it can.
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));
  await mockInspectorFor(page, DM_MOVER_ACCOUNT);

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  await dm.getByTestId("runbook-mover-account").click();

  // The DYNAMIC route, not the entry form.
  await expect(page).toHaveURL(new RegExp(`/inspector/${DM_MOVER_ACCOUNT}$`));
  // The surface mounted: the entry form is GONE — that form is what the old
  // `?address=` href actually landed on.
  await expect(page.getByLabel("address to inspect")).toHaveCount(0);
  // The account the run measured is the account on screen. `AddressMono`
  // truncates for display and carries the full address in its title, so both
  // are checked — the visible identity and the exact one.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(truncateAddress(DM_MOVER_ACCOUNT));
  await expect(heading.locator(`[title="${DM_MOVER_ACCOUNT}"]`)).toBeVisible();
  // And it is the POSITION surface — the account the run measured, answered.
  await expect(page.getByTestId("found-positive")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Wave W-BS-B finding 4 — ONE ASSET, TWO DISCLOSURES, TWO ROWS
// ---------------------------------------------------------------------------

test("COLLIDING COLLATERAL ROWS survive a rerun: counted and not-counted stay themselves", async ({
  page,
}) => {
  // The live book already serves weETH twice for an Aave aggregate — COUNTED
  // for the accounts that enabled it as collateral, NOT COUNTED for those that
  // did not. Both carry `unpriced: false`, so the old `asset + unpriced` key
  // gave the two rows ONE key and React had to reconcile two rows claiming one
  // identity across a rerun. This drives exactly that: two serves of the same
  // colliding shape with different balances.
  let body = fixture("run-book.collateral-collision.json");
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => json(route, body));
  await page.goto("/lab");
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();

  const side = page.locator(
    '[data-testid="runbook-collateral"][data-engine="aave_v3_etherfi"] [data-testid="runbook-collateral-before"]',
  );
  const rows = side.getByTestId("runbook-collateral-row");

  // THREE rows, and each one says which disclosure it is. Two of them are the
  // same asset — that is the collision, and it is legitimate.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-disclosure", "counted");
  await expect(rows.nth(1)).toHaveAttribute("data-disclosure", "not-counted");
  await expect(rows.nth(2)).toHaveAttribute("data-disclosure", "unpriced");
  await expect(rows.nth(0)).toContainText("$8,000");
  await expect(rows.nth(1)).toContainText("NOT COUNTED");
  // A not-counted holding has NO dollar figure — its worth is knowable but the
  // engine assigned it none, and none is invented.
  await expect(rows.nth(1)).not.toContainText("$");

  // THE RERUN. Same shape, different balances and a different counted value.
  body = fixture("run-book.collateral-collision.swap.json");
  await page.getByTestId("run-book-button").click();
  await expect(side.getByTestId("runbook-collateral-row").nth(0)).toContainText("$12,000");

  // Every row is ITSELF after the swap: no stale value, no duplicate, none
  // dropped, and the disclosure order unchanged.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-disclosure", "counted");
  await expect(rows.nth(1)).toHaveAttribute("data-disclosure", "not-counted");
  await expect(rows.nth(2)).toHaveAttribute("data-disclosure", "unpriced");
  await expect(rows.nth(0)).toContainText("3");
  await expect(rows.nth(1)).toContainText("7");
  await expect(rows.nth(1)).toContainText("NOT COUNTED");
  // The stale counted value must be gone from the whole side.
  await expect(side).not.toContainText("$8,000");
  // And the reading line follows the same bytes: ONE counted asset, summing to
  // the new total, with the other two holdings outside it.
  await expect(
    page.getByTestId("runbook-collateral-reading-before").first(),
  ).toContainText("1 asset sums to $12,000");
});
