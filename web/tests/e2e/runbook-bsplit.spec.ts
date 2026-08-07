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
  //
  // THREE measured accounts since Wave W-EX-A, not two. The repaired contract
  // example carries the Debt Manager's REAL weETH (0x5A7f… on chain 10), which
  // eth_minus_30's matrix DECLARES — so the example's own account moves under
  // this scenario, and the generator's law-11 witness had to become an account
  // of its own rather than a second holding on the flipping one. The book is the
  // example's account plus two injected ones.
  //
  // CHANGED at contract 1.7.0: the denominator is now the SERVER's
  // `measured_rows` and the noun is ROWS, because that is the unit the count is
  // in. The number is the same 3 and its arithmetic is the same arithmetic.
  await expect(reading).toContainText(
    "1 of 3 measured rows sat below 1.00 before the shock, 2 after",
  );
  await expect(reading).toContainText("the below-1.00 population grew by 1");
  // AND IT SAYS WHAT KIND OF NUMBER THAT IS — which at 1.7.0 is a stronger
  // statement than it was. The 1.6.0 sentence carried an IMPOSSIBILITY CAVEAT
  // ("That is a NET figure ... no gross crossing count is claimed here")
  // because two histograms could not produce the crossings. `hf_transitions`
  // produces them, so the caveat is RETIRED and the gross split is printed
  // beside the net: one row into the region, none out of it.
  await expect(reading).toContainText("The crossings behind that figure are served");
  await expect(reading).toContainText("1 row moved INTO the region");
  await expect(reading).toContainText("0 rows moved OUT of it");
  await expect(reading).not.toContainText("no gross crossing count is claimed here");
  await expect(reading).not.toContainText("That is a NET figure");
  // Its buckets are a DISCLOSURE, never dressed as the engine's trigger — and
  // serving the joint changes nothing about that.
  await expect(reading).toContainText("a DISCLOSURE rather than this engine's trigger");
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
  // THREE accounts measured on this engine since Wave W-EX-A — the contract
  // example's own plus the two this generator injects (the one that flips, and
  // the one carrying the held-flat holding law 11 is proved against).
  // "rows" since contract 1.7.0: the denominator is the server's own
  // `measured_rows`, which is the unit `coverage.batch_positions` is in.
  await expect(dm.getByTestId("runbook-hist-reading")).toContainText("of 3 measured rows");

  // The itemization the reading line sums is the WHOLE collateral of the side,
  // every injected holding included. $6,600 = the example's $4,000 of weETH plus
  // $2,500 of WETH plus $100 of USDC.
  const dmCollateral = page.locator('[data-testid="runbook-collateral"][data-engine="debt_manager"]');
  await expect(dmCollateral.getByTestId("runbook-collateral-reading-before")).toContainText(
    "3 assets sum to $6,600",
  );
  // And it FALLS on the after side, because BOTH ETH-linked holdings moved: the
  // example's weETH to $2,800 and the injected WETH to $1,750, while the USDC
  // the matrix does not name is held flat at $100.
  await expect(dmCollateral.getByTestId("runbook-collateral-reading-after")).toContainText(
    "3 assets sum to $4,650",
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

test("AAVE's movers table speaks WADS — the drop that ranked the row", async ({ page }) => {
  // Wave W-BS-C. This assertion used to read the Aave engine's movers as ZERO,
  // because the eth_minus_30 fixture carried the oracles-held example's Aave
  // rows unchanged — bit-identical sides under a scenario that shocks ETH by
  // 30%. eth_minus_30's propagation matrix DECLARES weETH-on-mainnet against
  // `eth_usd`, and a declared asset cannot hold still, so the generator now
  // re-measures that engine from the contract's own committed eth_minus_30
  // result and the account it moves is a real mover with real wads.
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  await expect(aave).toHaveAttribute("data-movers-total", "1");
  // AAVE'S OWN VOCABULARY: it ranks STRICT health-factor drops, so the sentence
  // says drops. The Debt Manager's sentence says eligibility flips, and one
  // sentence for both would be wrong on at least one of them.
  await expect(aave.getByTestId("runbook-movers-disclosure")).toHaveText(
    "Showing all 1 account whose health factor strictly dropped, ranked by the drop.",
  );

  const rows = aave.getByTestId("runbook-mover");
  await expect(rows).toHaveCount(1);
  // THE WAD COLUMNS, and the drop that ranked the row: 1.08 → 0.756 is the
  // committed result's own measurement, so the drop is 0.324 exactly.
  await expect(aave).toContainText("hf drop");
  await expect(aave.getByTestId("runbook-mover-drop")).toHaveText("0.324");
  await expect(rows.first()).toContainText("1.08");
  await expect(rows.first()).toContainText("0.756");
  // No Debt Manager columns: Aave has no eligibility-flip verdict and no
  // maxBorrowLT rational, so it is not asked for either.
  await expect(aave).not.toContainText("maxBorrowLT / borrowings before");
  await expect(aave.getByTestId("runbook-mover-flip")).toHaveCount(0);
  // The ranking rule renders VERBATIM.
  await expect(aave.getByTestId("runbook-movers-note")).toContainText("HEALTH-FACTOR DROP");
});

test("an engine that moved NOTHING says so — in its own vocabulary, never a blank table", async ({
  page,
}) => {
  // The oracles-held scenario is the honest home for this assertion: its
  // committed definition carries `shocks: []` and `propagation: []`, so NO
  // price moves and NO health factor drops — by construction rather than by a
  // fixture holding something still that the matrix says must move.
  await runScenario(
    page,
    "weeth_market_depeg_oracles_held",
    fixture("run-book.weeth_market_depeg_oracles_held.json"),
  );

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  // Zero MOVEMENT is stated, never rendered as an empty table the reader has to
  // interpret — and it is stated in Aave's own vocabulary.
  await expect(aave).toHaveAttribute("data-movers-total", "0");
  await expect(aave.getByTestId("runbook-movers-disclosure")).toHaveText(
    "No account's health factor dropped under this scenario on this engine.",
  );
  await expect(aave.getByTestId("runbook-mover")).toHaveCount(0);
  // The ranking rule still renders — the reader learns what WOULD have ranked.
  await expect(aave.getByTestId("runbook-movers-note")).toContainText("HEALTH-FACTOR DROP");

  // And the Debt Manager says the same thing in ITS vocabulary, which is a
  // different sentence about a different one-direction list.
  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  await expect(dm).toHaveAttribute("data-movers-total", "0");
  await expect(dm.getByTestId("runbook-movers-disclosure")).toHaveText(
    "No account's debt became eligible under this scenario on this engine.",
  );
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
  await expect(reading).toContainText("UNKNOWABLE rather than zero");
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
    "at 8 decimals, never added to another engine's",
  );
  await expect(dm.getByTestId("runbook-collateral-reading-before")).toContainText(
    "at 6 decimals, never added to another engine's",
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
  // r74: found-specific, not merely rendered — the outcome line exists on
  // every ready arm.
  await expect(
    page.getByTestId("inspector-outcome").filter({ hasText: "outcome · found" }),
  ).toBeVisible();
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

// ---------------------------------------------------------------------------
// VIEW 4 — the Aave mover dumbbells (views spec view 4 + critic Finding 8)

test("VIEW 4: the dumbbells render as a WINDOW onto the census, boundary marked, table as ledger", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');

  // Finding 8, VISIBLE (never a fold descendant): the population sentence
  // names movement-not-danger and the count the pool does not serve.
  const population = aave.getByTestId("dumbbell-population");
  await expect(population).toBeVisible();
  await expect(population).toHaveText(
    "A drop is movement, not danger: 1 counts every account whose health factor fell at all " +
      "— under a price shock, most of the borrowing book — and the pool serves no count of " +
      "accounts that crossed 1.00.",
  );

  // The census STATE line, visible before the picture: buckets + no-debt +
  // refused = rows the run FACED (2 here, MORE than `accounts` — the refused
  // row was never rebuilt and is in neither side's accounts).
  const census = aave.getByTestId("dumbbell-census");
  await expect(census).toBeVisible();
  await expect(census).toHaveText(
    "A window onto the run's own census: 1 bucketed on both sides + 0 no-debt (unbounded " +
      "health factor, excluded from movers by construction) + 1 refused = 2 rows this run faced.",
  );

  // ONE SOURCE: every dumbbell row has its ledger row in the table below —
  // same count, same account.
  const chartRows = aave.getByTestId("dumbbell-row");
  await expect(chartRows).toHaveCount(1);
  await expect(aave.getByTestId("runbook-mover")).toHaveCount(1);
  await expect(chartRows.first()).toHaveAttribute("data-crossed", "true");

  // The boundary at 1.00 is marked EXPLICITLY, and this shock's crossing row
  // ends in the liquidatable register: after-dot below one, before-dot not.
  await expect(aave.getByTestId("dumbbell-boundary")).toHaveCount(1);
  await expect(aave.locator('[data-testid="dumbbell-tick"][data-boundary="true"]')).toContainText(
    "1.00",
  );
  await expect(aave.getByTestId("dumbbell-before")).toHaveAttribute("data-below-one", "false");
  await expect(aave.getByTestId("dumbbell-after")).toHaveAttribute("data-below-one", "true");
  await expect(aave.getByTestId("dumbbell-eligible-region")).toHaveCount(1);

  // The window note is window-scoped BY SENTENCE and visible.
  const windowNote = aave.getByTestId("dumbbell-window-note");
  await expect(windowNote).toBeVisible();
  await expect(windowNote).toContainText("a fact about this window");
  await expect(windowNote).toContainText("the pool serves none");

  // The method line states the log axis and the strictly-below law.
  await expect(aave.getByTestId("dumbbell-method")).toContainText("strictly below 1.00");
  await expect(aave.getByTestId("dumbbell-method")).toContainText("LOG");

  // VOCABULARY LAW: the Debt Manager speaks flips, not wads — no dumbbells,
  // no wad-population sentence on its arm.
  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  await expect(dm.getByTestId("runbook-dumbbells")).toHaveCount(0);
  await expect(dm.getByTestId("dumbbell-population")).toHaveCount(0);
});

test("VIEW 4: an unmoved book draws NOTHING — no chart, no population sentence, stated in words", async ({
  page,
}) => {
  await runScenario(
    page,
    "weeth_market_depeg_oracles_held",
    fixture("run-book.weeth_market_depeg_oracles_held.json"),
  );

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  // Zero movement renders as the disclosure SENTENCE (pinned elsewhere) — a
  // dumbbell chart with no rows would be a picture of nothing pretending to
  // be a fact, and a population sentence over zero would qualify a count
  // that does not exist.
  await expect(aave.getByTestId("runbook-movers-disclosure")).toBeVisible();
  await expect(aave.getByTestId("runbook-dumbbells")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-population")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-census")).toHaveCount(0);
});

/** r88/r89/r90/view-5 doctoring shape: only the fields the negatives below mutate. */
interface DoctoredRunBook {
  engines: {
    engine: string;
    movers: { became_eligible: boolean | null }[];
    movers_total: number;
    newly_eligible_accounts: number;
    before: {
      accounts: number;
      eligible_accounts: number;
      hf_histogram: { wad_scale: string; refused_count: number };
      collateral_by_asset: { symbol: string | null; unpriced: boolean }[];
    };
    after: {
      accounts: number;
      eligible_accounts: number;
      hf_histogram: { wad_scale: string; refused_count: number };
      collateral_by_asset: { symbol: string | null; unpriced: boolean }[];
    };
  }[];
}

test("r88: a drifted wad_scale REFUSES the dumbbells visibly — never a chart on a false 1.00", async ({
  page,
}) => {
  // DERIVED NEGATIVE: both sides declare a non-WAD scale. The pool's boundary
  // is 1e18 by definition, so this response contradicts the chart's own law.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "aave_v3_etherfi") continue;
    engine.before.hf_histogram.wad_scale = "500000000000000000";
    engine.after.hf_histogram.wad_scale = "500000000000000000";
  }
  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  const refusedLine = aave.getByTestId("dumbbell-scale-refused");
  await expect(refusedLine).toBeVisible();
  await expect(refusedLine).toContainText("SCALE CONTRADICTION");
  await expect(refusedLine).toContainText("500000000000000000");
  // NO chart, NO census claim, NO window sentence — every verdict would be
  // unlicensed. The population line stays: movers_total is scale-independent.
  await expect(aave.getByTestId("runbook-dumbbells")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-census")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-window-note")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-population")).toBeVisible();
});

test("r88: a ZERO-MOVER run still surfaces a census contradiction on the page", async ({
  page,
}) => {
  // DERIVED NEGATIVE: the oracles-held run moves nobody, and its after side
  // loses agreement with its before side. "Nothing moved" may not stand
  // unqualified over served numbers that disagree with themselves.
  const body = JSON.parse(
    fixture("run-book.weeth_market_depeg_oracles_held.json"),
  ) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "aave_v3_etherfi") continue;
    engine.after.hf_histogram.refused_count = 7;
  }
  await runScenario(page, "weeth_market_depeg_oracles_held", JSON.stringify(body));

  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  const contradiction = aave.getByTestId("dumbbell-census-contradiction");
  await expect(contradiction).toBeVisible();
  await expect(contradiction).toContainText("one run faces one set of rows");
  // Still no chart and no affirmative census sentence — the contradiction
  // replaces the claim, it does not decorate it.
  await expect(aave.getByTestId("runbook-dumbbells")).toHaveCount(0);
  await expect(aave.getByTestId("dumbbell-census")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// VIEW 5 — the Debt Manager flip ranking (views spec view 5 + critic Finding 2)

test("VIEW 5: the four-cell partition, its named aside, and the sized flip bars render on the DM arm", async ({
  page,
}) => {
  await runScenario(page, "eth_minus_30", fixture("run-book.eth_minus_30.json"));

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');

  // The takeaway names the gross, the window, and the total it may NOT claim.
  const takeaway = dm.getByTestId("flip-takeaway");
  await expect(takeaway).toBeVisible();
  await expect(takeaway).toHaveText(
    "This scenario flips 1 account to liquidation-eligible — the 1 flip is on this page. " +
      "No total of flipped debt is served, so none is claimed.",
  );

  // The FOUR cells partition the run's 3 accounts exactly; the legend carries
  // every count including the computed zeros the strip cannot show as area.
  const legend = dm.getByTestId("flip-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toHaveText(
    "1 flipped to eligible · 0 flipped back to healthy · 1 stayed eligible · " +
      "1 stayed not eligible = 3 accounts",
  );
  await expect(
    dm.locator('[data-testid="flip-cell"][data-cell="flipsToEligible"]'),
  ).toHaveAttribute("data-count", "1");

  // Finding 2's aside: refused rides BESIDE the partition, never as a cell.
  const aside = dm.getByTestId("flip-refused-aside");
  await expect(aside).toBeVisible();
  await expect(aside).toContainText("Beside the partition: 1 refused row");
  // r90 F4: the sentence claims cell membership for NOBODY — the wire's
  // count mixes two populations and serves no split.
  await expect(aside).toContainText("no cell membership is claimed");

  // ONE SOURCE: one bar per table row, carrying the exact money register.
  await expect(dm.getByTestId("flip-bar-row")).toHaveCount(1);
  await expect(dm.getByTestId("runbook-mover")).toHaveCount(1);
  await expect(dm.getByTestId("flip-money")).toHaveText("$1,500");

  // The method line names the verdict source and the disclosure law.
  await expect(dm.getByTestId("flip-method")).toContainText("became_eligible");

  // VOCABULARY LAW: Aave flips nothing — no partition, no flip bars there.
  const aave = page.locator('[data-testid="runbook-movers"][data-engine="aave_v3_etherfi"]');
  await expect(aave.getByTestId("flip-strip")).toHaveCount(0);
  await expect(aave.getByTestId("flip-takeaway")).toHaveCount(0);
});

test("VIEW 5: a partition the served counts contradict is REFUSED visibly — no strip, no bars", async ({
  page,
}) => {
  // DERIVED NEGATIVE: the sides disagree on the account count, so the
  // partition has no honest total to close on.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "debt_manager") continue;
    engine.after.accounts = 4;
  }
  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  const refused = dm.getByTestId("flip-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("PARTITION CONTRADICTION");
  await expect(dm.getByTestId("flip-strip")).toHaveCount(0);
  await expect(dm.getByTestId("flip-bars")).toHaveCount(0);
  // The LEDGER table stays — served rows render; only the derived claim is
  // refused.
  await expect(dm.getByTestId("runbook-mover")).toHaveCount(1);
});

test("r89: a CONTRADICTORY collateral row never renders its money, and the sum weld fires", async ({
  page,
}) => {
  // DERIVED NEGATIVE: the DM before side's weETH keeps its served $4,000
  // value AND gains the no-price-witness flag — a row contradicting itself.
  // Excluding it from the sum also breaks reconciliation with the served
  // total, so BOTH r89 guards must fire on one honest page.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "debt_manager") continue;
    for (const entry of engine.before.collateral_by_asset) {
      if (entry.symbol === "weETH") entry.unpriced = true;
    }
  }
  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const dm = page.locator('[data-testid="runbook-collateral"][data-engine="debt_manager"]');
  const before = dm.locator('[data-testid="runbook-collateral-before"]');

  // The row sits in the refusal register with its disclosure named — the
  // disputed figure is NOT read as money anywhere on this side.
  const row = before.locator('[data-testid="runbook-collateral-row"][data-disclosure="contradictory"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("CONTRADICTORY");
  await expect(row).not.toContainText("$4,000");
  await expect(before).not.toContainText("$4,000");

  // The reading line refuses the sum claim instead of reading it out.
  const reading = before.getByTestId("runbook-collateral-reading-before");
  await expect(reading).toContainText("COLLATERAL CONTRADICTION");
  await expect(reading).toContainText("does not reconcile");
  await expect(reading).toContainText("CONTRADICTORY");

  // The AFTER side is untouched and still reconciles — the weld is per side.
  await expect(dm.getByTestId("runbook-collateral-reading-after")).toContainText(
    "assets sum to",
  );
});

test("r90: a positive partition cell too small for a pixel keeps a PRESENCE dot on the strip", async ({
  page,
}) => {
  // DERIVED CASE: one flip among 1,000 accounts — round(0.38px) = 0, and a
  // legend saying 1 beside a strip showing nothing would be two answers.
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "debt_manager") continue;
    engine.before.accounts = 1000;
    engine.after.accounts = 1000;
    engine.before.eligible_accounts = 46;
    engine.after.eligible_accounts = 47;
  }
  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  const presence = dm.locator('[data-testid="flip-cell-presence"][data-cell="flipsToEligible"]');
  await expect(presence).toHaveCount(1);
  await expect(presence).toHaveAttribute("data-count", "1");
  // r91 finding 3: the dot must be PAINTED, not merely present — every
  // rectangle precedes it in document order, so SVG draws the dot on top of
  // any full-height neighbor sharing its coordinate.
  const painted = await dm
    .getByTestId("flip-strip")
    .evaluate((svg: SVGElement) => {
      const children = Array.from(svg.children);
      const lastRect = children.map((c) => c.tagName).lastIndexOf("rect");
      const firstCircle = children.map((c) => c.tagName).indexOf("circle");
      return firstCircle > lastRect;
    });
  expect(painted).toBe(true);
  // The legend and the strip agree: 1 flip exists, drawn as presence.
  await expect(dm.getByTestId("flip-legend")).toContainText("1 flipped to eligible");
  await expect(dm.getByTestId("flip-strip")).toHaveCount(1);
});

test("r90: a shown mover without a true verdict refuses the BARS visibly — the partition stands", async ({
  page,
}) => {
  const body = JSON.parse(fixture("run-book.eth_minus_30.json")) as DoctoredRunBook;
  for (const engine of body.engines) {
    if (engine.engine !== "debt_manager") continue;
    for (const mover of engine.movers) mover.became_eligible = false;
  }
  await runScenario(page, "eth_minus_30", JSON.stringify(body));

  const dm = page.locator('[data-testid="runbook-movers"][data-engine="debt_manager"]');
  const refused = dm.getByTestId("flip-bars-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("VERDICT CONTRADICTION");
  // r91 finding 2: the takeaway makes NO window claim over a refused window —
  // never "the 0 largest ... are on this page".
  await expect(dm.getByTestId("flip-takeaway")).toContainText("no window claim is made");
  await expect(dm.getByTestId("flip-takeaway")).not.toContainText("0 largest");
  await expect(dm.getByTestId("flip-bars")).toHaveCount(0);
  await expect(dm.getByTestId("flip-bar")).toHaveCount(0);
  // The partition's inputs are the welded counts — it still renders.
  await expect(dm.getByTestId("flip-strip")).toHaveCount(1);
  // And the ledger still shows the row with its own verdict.
  await expect(dm.getByTestId("runbook-mover-flip")).toHaveText("no");
});
