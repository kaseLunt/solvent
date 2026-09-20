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
//   (6)  no numbered eyebrows anywhere; the nav's two registers sit adjacent
//        with a divider, not across a void (the Verification H1 arm retired
//        with that page's convergence, Plan 4);
//   (7)  numeric column HEADERS are right-aligned over their cells;
//   (8)  section order: map above table, positions above histogram, census
//        above waterfall;
//   (9)  the Book dek is COMPUTED from /v1/book;
//   (10) RETIRED with the Plan 4 convergence (2026-09-16) — every intro is
//        drawer doctrine now (R3), pinned verbatim in tests/e2e/history.spec.ts,
//        activity.spec.ts, verification.spec.ts and api.spec.ts; each page's dek
//        keeps the one clause the law requires visible. The Inspector arm had
//        retired under Plan 2 and the Scenarios arm under Plan 3.
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
  await expect(page.getByTestId("activity-amount").filter({ hasText: "1,199.403" })).toBeVisible();
  await expect(page.getByTestId("activity-amount").filter({ hasText: "1199403000" })).toHaveCount(0);
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
    page.getByTestId("activity-amount").filter({ hasText: "1500000000000000000" }),
  ).toBeVisible();
  // The tag is part of the unit named beside the amount (the Activity table's one unit cell per row).
  await expect(page.getByTestId("activity-unit").filter({ hasText: "aave-scaled" })).toContainText("raw units");
});

// ---------------------------------------------------------------------------
// (5) — the Scenarios dead end: retired with the Scenarios rebuild (2026-09-16,
// Plan 3). The laws live in tests/e2e/lab.spec.ts: the cold load runs on the
// listing alone and no address gates it; a not-found address is a complete
// answer; the mode toggle names what each mode does.
// Ledger: .superpowers/sdd/progress-ui-overhaul.md, "Plan 3 (Scenarios) — retirements".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (6) — chrome. The paths below are the routes; the pages they serve are Book,
// Inspector, Scenarios, History, Activity, Verification and API.
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

// (6)'s Verification H1 arm is RETIRED with that page's convergence (plan 2026-09-16, Task 5): the page's H1 is its
// computed sentence (R2, `proofTakeaway`), and its name is the nav label and the kicker "Verification · this
// deployment" — pinned in tests/e2e/verification.spec.ts; the shell smoke pins the no-API H1.

// (10) is RETIRED whole (plan 2026-09-16, Tasks 3–6): each page's intro is drawer doctrine (R3), pinned verbatim
// in its own contract — History in tests/e2e/history.spec.ts (the dek keeps "One engine per view; a missing hour
// is a hole, never a zero."), Activity in activity.spec.ts ("The live strip and the paged record never blend."),
// Verification in verification.spec.ts ("Two subjects, never one: the pinned proof and the live batch."), API in
// api.spec.ts ("If a handler disagrees with this page, that is a failure, not documentation lag."). The test that
// held the four arms asserted nothing once the last arm left, so it is gone rather than kept green and empty.
