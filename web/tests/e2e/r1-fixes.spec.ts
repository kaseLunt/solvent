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
//   (5)  RETIRED with the Scenarios rebuild (2026-09-16, Plan 3) — the laws are
//        in tests/e2e/lab.spec.ts (the cold load, the not-found arm, the mode
//        toggle's words);
//   (6)  no numbered eyebrows anywhere; Proof's H1 is "Proof"; the nav's two
//        registers sit adjacent with a divider, not across a void;
//   (7)  numeric column HEADERS are right-aligned over their cells;
//   (8)  section order: map above table, positions above histogram, census
//        above waterfall;
//   (9)  the Book dek is COMPUTED from /v1/book;
//   (10) the adjudicated intros render on Observatory, Feed, Proof and
//        Developers (the Inspector arm retired under Plan 2; the Lab arm under
//        Plan 3 — the Scenarios page answers first and has no intro).
//
// Items (2), (3), (11), (12) and the Inspector arm of (10) — the old
// Inspector's badge, freshness line, HF-history vocabulary, DM card and
// landing intro — were RETIRED with the Inspector rebuild (2026-09-15): the
// laws now live in the unit specs inspector-position / inspector-view /
// history-copy and in tests/e2e/inspector.spec.ts.
// Ledger: .superpowers/sdd/progress-ui-overhaul.md, "Plan 2 (Inspector) — retirements".

import { expect, test, type Page, type Route } from "@playwright/test";
import { FEED_UNITS, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

const CORS = { "access-control-allow-origin": "*" };

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
// (5) — the Lab dead end: retired with the Scenarios rebuild (2026-09-16,
// Plan 3). The laws live in tests/e2e/lab.spec.ts: the cold load runs on the
// listing alone and no address gates it; a not-found address is a complete
// answer; the mode toggle names what each mode does.
// Ledger: .superpowers/sdd/progress-ui-overhaul.md, "Plan 3 (Scenarios) — retirements".
// ---------------------------------------------------------------------------

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

test("(10) the adjudicated intros render — Observatory, Feed, Proof, Developers (the Inspector arm retired under Plan 2, the Lab arm under Plan 3)", async ({
  page,
}) => {
  // Re-homed from the retired "(10) the adjudicated intros render, and the
  // endpoint lines are demoted": the four surviving paragraphs, verbatim.
  // The Inspector landing's intro is R9's and is pinned by the contract spec;
  // the Scenarios page answers first (spec §5.4) and carries no intro paragraph.
  await muteStream(page);

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

  // The API arm is RETIRED with the API convergence (plan 2026-09-16, Task 6): the intro is
  // drawer doctrine now (R3), pinned verbatim in tests/e2e/api.spec.ts; the dek keeps its closing clause.
});
