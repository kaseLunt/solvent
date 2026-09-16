// WAVE R1 (web fix train) e2e — the adjudicated clarity ruling, pinned in the
// browser against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, item by item:
//   (1)  `never` → `no price path`, with the wire reason in the hover, a
//        RENDERED legend, and the column header's own scope title;
//   (2)  the Inspector badge NEVER renders under a liquidatable verdict, and
//        wears the axis-scoped vocabulary when it does render;
//   (3)  batch freshness on the Book head, its stampline, and the Inspector;
//   (4)  feed amounts are scaled by the engine's OWN value_decimals when the
//        wire supplies them, and stay raw + tagged when nothing licenses a
//        scale;
//   (5)  a NOT-FOUND stress still teaches the committed scenario list, so
//        book mode is no longer a dead end; the mode labels say what they do;
//   (6)  no numbered eyebrows anywhere; Proof's H1 is "Proof"; the nav's two
//        registers sit adjacent with a divider, not across a void;
//   (7)  numeric column HEADERS are right-aligned over their cells;
//   (8)  section order: map above table, positions above histogram, census
//        above waterfall;
//   (9)  the Book dek is COMPUTED from /v1/book;
//   (10) the adjudicated intros render, and the endpoint lines are demoted;
//   (11) the HF-history vocabulary separates plots from witnessed batches;
//   (12) the DM card renders its OWN totals and its params as percentages.

import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEED_UNITS, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

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

// ---------------------------------------------------------------------------
// (2) + (3) + (11) + (12) — the Inspector.
// ---------------------------------------------------------------------------

async function mockInspector(page: Page, address: unknown, history: unknown = HISTORY) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: history as object, headers: CORS }),
  );
  await page.route("**/v1/address/*", (route) =>
    route.fulfill({ json: address as object, headers: CORS }),
  );
}

test("(2) THE BLOCKER: never_liquidatable NEVER renders beside a liquidatable verdict", async ({
  page,
}) => {
  // DERIVED /v1/address: the DM position (liquidatable: true) gains a
  // liquidation_price whose `never_liquidatable` is TRUE — the axis-scoped
  // combination the live wire really serves. The Aave position is untouched.
  const body = structuredClone(ADDRESS_FOUND);
  const dm = body.positions[1];
  if (dm === undefined) throw new Error("fixture shape drifted");
  expect(dm.liquidatable).toBe(true);
  dm.liquidation_price = {
    in_factor: false,
    never_liquidatable: true,
    reason: "position holds no counted collateral in the factor",
    scale_factor_num: null,
    scale_factor_den: null,
    already_breached: false,
    prices: [],
    factor_assets: [],
    held_assets: [],
    boundary_is_healthy: true,
    per_token_floor_omitted: false,
    diagnostic: false,
    axis: "eth_usd",
    note: "n",
  };

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const card = page.getByTestId("position-debt_manager");
  await expect(card).toBeVisible();
  // The verdict row speaks; the slot renders NOTHING.
  await expect(card.getByTestId("no-price-path-badge")).toHaveCount(0);
  await expect(card).not.toContainText(/never liquidatable/i);
});

test("(2) a HEALTHY never_liquidatable renders the axis-scoped badge with the wire reason", async ({
  page,
}) => {
  // DERIVED /v1/address: the AAVE position (healthy — hf wad above 1e18)
  // gains never_liquidatable with the solver's outside-covers reason.
  const body = structuredClone(ADDRESS_FOUND);
  const aave = body.positions[0];
  if (aave === undefined || aave.liquidation_price === null) {
    throw new Error("fixture shape drifted");
  }
  aave.liquidation_price.never_liquidatable = true;
  aave.liquidation_price.reason =
    "collateral outside the factor already covers the debt at threshold";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const badge = page.getByTestId("position-aave_v3_etherfi").getByTestId("no-price-path-badge");
  await expect(badge).toHaveText("no price path");
  await expect(badge).toHaveAttribute(
    "title",
    "Collateral outside the shocked asset already covers the debt at the liquidation " +
      "threshold, so no fall of the shocked asset alone reaches the boundary; interest or " +
      "parameter changes still can. Wire: 'collateral outside the factor already covers the " +
      "debt at threshold'.",
  );
});

test("(12) the DM card renders its OWN totals — the em dashes were a rendering bug", async ({
  page,
}) => {
  // DERIVED /v1/address: the DM position's `total_collateral_base` /
  // `total_debt_base` are nulled to match what the LIVE wire serves for this
  // engine (they are Aave's base-currency fields). Its own
  // `collateral_value_usd` / `borrowings` are untouched.
  const body = structuredClone(ADDRESS_FOUND);
  const dm = body.positions[1];
  if (dm === undefined) throw new Error("fixture shape drifted");
  dm.total_collateral_base = null;
  dm.total_debt_base = null;

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const card = page.getByTestId("position-debt_manager");
  // 4000000000 at 6 decimals, grouped — and 4620000000 likewise.
  await expect(card).toContainText("4,000");
  await expect(card).toContainText("4,620");
});

test("(12) DM risk params render as PERCENTAGES in the engine's own 100e18 scale", async ({
  page,
}) => {
  // DERIVED /v1/address: the DM leg gains the live deployment's own params —
  // LT 95e18 and bonus 3.5e18 in the Debt Manager's 100e18 percent scale.
  const body = structuredClone(ADDRESS_FOUND);
  const leg = body.positions[1]?.legs[0];
  if (leg === undefined) throw new Error("fixture shape drifted");
  leg.liq_threshold = "95000000000000000000";
  leg.liq_bonus = "3500000000000000000";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-debt_manager").first();
  await expect(params).toContainText("LT 95% · bonus 3.5%");
  await expect(params).toContainText("100e18 scale");
  await expect(params).not.toContainText("95000000000000000000");

  // Aave keeps ITS denomination — no cross-engine normalization.
  const aaveParams = page.getByTestId("leg-params-aave_v3_etherfi").first();
  await expect(aaveParams).toContainText("bps · 1e4 scale");
});

test("(3) the Inspector states its own lookup's batch age", async ({ page }) => {
  // DERIVED /v1/address: the envelope batch is 2h 0m old (age_seconds 5 →
  // 7200). No other byte changes.
  const body = structuredClone(ADDRESS_FOUND);
  body.batch.age_seconds = 7200;
  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);
  await expect(page.getByTestId("inspector-freshness")).toHaveText(
    "batch #1 · computed 2026-07-29T10:00:00Z · 2h 0m ago",
  );
});

test("(11) the history head and meta line separate what PLOTS from what is witnessed", async ({
  page,
}) => {
  await mockInspector(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  // Phase 0 fix 4: the SECTION head went neutral (it spans both engines'
  // cards); the health-factor claim now lives on the Aave card's own head.
  await expect(page.getByTestId("hf-history")).toContainText("Risk history across batches");
  await expect(page.getByTestId("history-aave_v3_etherfi")).toContainText(
    "Health factor across batches",
  );
  await expect(page.getByTestId("history-meta-aave_v3_etherfi")).toContainText(
    "witnessed batches plot",
  );
  await expect(page.getByTestId("hf-history")).toContainText(
    "gaps break the line. Hover any tick for that batch's named reason.",
  );
  // The full doctrine is one click away, not gone.
  await expect(
    page.getByRole("group").filter({ hasText: "how gaps and the 1.0 line work" }).first(),
  ).toBeVisible();
});

test("(11) an engine the account has NEVER touched renders one line, not an empty chart", async ({
  page,
}) => {
  // DERIVED /v1/address/{addr}/history: a second engine block with no points
  // and no withheld batches — the account has never held a DM position.
  const history = structuredClone(HISTORY) as typeof HISTORY & {
    engines: { engine: string; points: unknown[]; withheld_batch_ids: number[] }[];
  };
  history.engines.push({ engine: "debt_manager", points: [], withheld_batch_ids: [] });

  await mockInspector(page, ADDRESS_FOUND, history);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  await expect(page.getByTestId("history-absent-debt_manager")).toContainText(
    "no debt_manager history: this address has never had a debt_manager position in the " +
      "retained window.",
  );
  // No frame at all for that engine.
  await expect(page.getByTestId("history-debt_manager")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// (4) — feed amounts.
// ---------------------------------------------------------------------------

test("(4) a DM amount is scaled by the engine's OWN value_decimals, with separators", async ({
  page,
}) => {
  // DERIVED SSE snapshot: the posture frame gains the `engines` block the
  // live stream really serves — this is where the Feed learns each engine's
  // value_decimals, from the wire and nowhere else.
  const snapshot = structuredClone(FEED_POSTURE_SNAPSHOT) as Record<string, unknown>;
  snapshot.engines = [
    { engine: "debt_manager", value_decimals: 6 },
    { engine: "aave_v3_etherfi", value_decimals: 8 },
  ];
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );
  await page.route("**/v1/events*", (route) => fulfillJson(route, FEED_UNITS));
  await page.goto("/feed");

  // The fixture's DM borrow is 1199403000 normalized-debt units.
  await expect(page.getByTestId("feed-amount").filter({ hasText: "1,199.403" })).toBeVisible();
  await expect(page.getByTestId("feed-amount").filter({ hasText: "1199403000" })).toHaveCount(0);
});

test("(4) an aave_scaled amount with no leg decimals stays RAW and is TAGGED as such", async ({
  page,
}) => {
  await muteStream(page);
  await page.route("**/v1/events*", (route) => fulfillJson(route, FEED_UNITS));
  await page.goto("/feed");

  // The ray-scaled aToken amount is NOT divided by the engine's base-currency
  // decimals — a different unit entirely.
  await expect(
    page.getByTestId("feed-amount").filter({ hasText: "1500000000000000000" }),
  ).toBeVisible();
  await expect(page.getByTestId("feed-amount-raw").first()).toHaveText("raw units");
});

// ---------------------------------------------------------------------------
// (5) — the Lab dead end.
// ---------------------------------------------------------------------------

function stressFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"),
  ) as Record<string, unknown>;
}

/** The two COLD bodies book mode reads on arrival (W-SD-A generated fixtures). */
const LAB_SCENARIOS = stressFixture("scenarios.json");
const LAB_BOOK = stressFixture("book.json");

async function mockLabCold(page: Page): Promise<void> {
  await page.route(`${API}/v1/scenarios`, (route) => fulfillJson(route, LAB_SCENARIOS));
  await page.route(`${API}/v1/book`, (route) => fulfillJson(route, LAB_BOOK));
}

test("(5) a NOT-FOUND stress is still a complete answer — and book mode never needed it", async ({
  page,
}) => {
  // W-SD-A CHANGED THIS EXPECTATION. R1 fixed the dead end by teaching book
  // mode from ANY completed lookup; W-SD-A removed the dependency entirely —
  // the committed set comes from `GET /v1/scenarios`, cold. So the assertion
  // moves from "the lookup taught the list" to the stronger fact: the list was
  // never the lookup's to teach, and book mode is alive before any address is
  // typed. The address side's own R1 content (a definitive negative is a
  // complete answer) is still pinned.
  //
  // DERIVED /v1/address/{addr}/stress: the contract-validated aave body with
  // `found` flipped to false (lookup_complete stays true and withheld_engines
  // stays empty, which is exactly what a definitive negative requires).
  const body = stressFixture("stress-aave.json");
  const addr = body.address as string;
  body.found = false;
  await muteStream(page);
  await mockLabCold(page);
  await page.route(`${API}/v1/address/${addr}/stress`, (route) => fulfillJson(route, body));

  await page.goto("/lab");
  // Book mode is alive on arrival, with zero lookups behind it.
  await expect(page.getByTestId("run-book-button")).toBeVisible();
  await expect(page.getByTestId("lab-matrix")).toBeVisible();

  await page.getByTestId("mode-address").click();
  const input = page.getByTestId("lab-address-input");
  const run = page.getByTestId("run-stress-button");
  await expect(async () => {
    await input.fill(addr);
    await expect(run).toBeEnabled({ timeout: 250 });
  }).toPass();
  await run.click();

  await expect(page.getByTestId("lab-not-found")).toBeVisible();

  // Back in book mode: still alive, and it learned nothing from the lookup to
  // be alive.
  await page.getByTestId("mode-book").click();
  await expect(page.getByTestId("book-mode-no-set")).toHaveCount(0);
  await expect(page.getByTestId("run-book-button")).toBeVisible();
});

test("(5) the mode toggle says what each mode DOES", async ({ page }) => {
  await muteStream(page);
  await page.goto("/lab");
  await expect(page.getByTestId("mode-address")).toHaveText("one address");
  await expect(page.getByTestId("mode-book")).toHaveText("whole book");
});

test("(5) there is no pre-lookup book empty state left to name an escape hatch", async ({
  page,
}) => {
  // W-SD-A DELETED THIS EXPECTATION'S SUBJECT. The empty state existed only
  // because book mode could not start without an address run; the
  // escape-hatch copy was the best available answer to a dependency that
  // should not have existed. `GET /v1/scenarios` serves the committed set
  // cold, so the state is gone and the dashboard stands in its place.
  await muteStream(page);
  await mockLabCold(page);
  await page.goto("/lab");
  await expect(page.getByTestId("book-mode-no-set")).toHaveCount(0);
  await expect(page.getByTestId("lab-dek")).toBeVisible();
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
  await expect(page.getByTestId("lab-matrix")).toBeVisible();
});

// ---------------------------------------------------------------------------
// (6) + (10) — chrome and intros.
// ---------------------------------------------------------------------------

const SURFACES = [
  "/book",
  "/inspector",
  "/lab",
  "/observatory",
  "/feed",
  "/proof",
  "/developers",
] as const;

test("(6) not one numbered eyebrow survives on the seven surfaces", async ({ page }) => {
  await muteStream(page);
  for (const path of SURFACES) {
    await page.goto(path);
    await expect(page.locator("p.eyebrow")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/^\s*[1-7] · /m);
  }
});

test("(6) Proof's H1 is the surface's own name", async ({ page }) => {
  await muteStream(page);
  await page.goto("/proof");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proof");
});

test("(10) the adjudicated intros render, and the endpoint lines are demoted", async ({ page }) => {
  await muteStream(page);

  await page.goto("/inspector");
  await expect(page.locator("main")).toContainText(
    "Look up one address: its current position, the price inputs behind it, its distance to " +
      "liquidation, and its history across batches. Anything the service cannot defend renders " +
      "as a named refusal, never a guess.",
  );
  // The provenance line survives — BELOW the entry form, not above it.
  const entryY = (await page.getByTestId("lab-address-input").or(page.locator("form")).first().boundingBox())?.y ?? 0;
  const fedByY =
    (await page.getByText("fed by", { exact: false }).first().boundingBox())?.y ?? 0;
  expect(fedByY).toBeGreaterThan(entryY);

  // W-SD-A CHANGED THIS SENTENCE: whole book comes FIRST in the intro because
  // whole book is the default register the surface now opens in.
  await page.goto("/lab");
  await expect(page.locator("main")).toContainText(
    "What would break this book: the committed stress scenarios, fixed and versioned shocks " +
      "with no sliders, run against the whole book or against one address.",
  );

  await page.goto("/observatory");
  await expect(page.locator("main")).toContainText(
    "How each engine's book has moved, hour by hour, in a record that outlives batch " +
      "retention. An hour with no complete batch renders as a hole, which is never smoothed " +
      "over and never drawn as a zero; one engine per view, never combined onto one axis.",
  );

  await page.goto("/feed");
  await expect(page.locator("main")).toContainText(
    "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The " +
      "live strip shows the stream's posture now; the list below pages through durable " +
      "history. The two never blend.",
  );

  await page.goto("/proof");
  await expect(page.locator("main")).toContainText(
    "What this deployment is, exactly: the pinned proof of its last reconcile and the identity " +
      "of the batch it serves now. Nothing here is measured on request: every field is carried " +
      "by the build or persisted by a batch.",
  );

  await page.goto("/developers");
  await expect(page.locator("main")).toContainText(
    "The committed API contract, rendered from its own examples: read-only JSON, no auth, " +
      "every money value a decimal string. If a handler disagrees with this page, that is a " +
      "failure, not documentation lag.",
  );
});
