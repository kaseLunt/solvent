// WAVE R1 (web fix train) e2e — the adjudicated clarity ruling, pinned in the
// browser against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, item by item:
//   (1)  `never` → `no price path`, with the wire reason in the hover, a
//        RENDERED legend, and the column header's own scope title;
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
//   (9)  the Book dek is COMPUTED from /v1/book.
//
// Items (2), (3), (10), (11) and (12) — the old Inspector's badge, freshness
// line, landing intro, HF-history vocabulary and DM card — were RETIRED with
// the Inspector rebuild (2026-09-15): the laws now live in the unit specs
// inspector-position / inspector-view and in tests/e2e/inspector.spec.ts.
// Ledger: .superpowers/sdd/progress-ui-overhaul.md, "Plan 2 (Inspector) — retirements".

import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEED_UNITS, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

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
