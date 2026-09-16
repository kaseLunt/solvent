// WAVE R3 (Codex round-10) e2e — the three findings, pinned in the browser
// against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, finding by finding:
//   (1) HIGH   — a liquidation bonus renders the PREMIUM it grants, not its
//                raw encoding read as a percentage. Aave publishes a
//                par-based MULTIPLIER in bps (10500 = 1.05x = 5%); the Debt
//                Manager publishes the premium itself on its 100e18 scale.
//                The REAL wire values 10500 and 10600 are the inputs — the
//                round-10 note is that the old unit pin used `500`, a number
//                the Aave wire never publishes, which is how "105%" survived.
//   (2) MEDIUM — the batch age is ANCHORED at receipt and ADVANCES while the
//                page is open, and the LIVE ribbon's 1h stale-batch suffix
//                ENGAGES on the crossing rather than testing a frozen number.
//                Driven by Playwright's clock, which fakes `performance` —
//                the same monotonic source lib/freshness.ts reads.
//   (3) MEDIUM — the RENDERED legend speaks of REACHABILITY, not of movement,
//                so it no longer contradicts the outside-collateral-covers
//                hover sitting beneath it.

import { expect, test, type Page } from "@playwright/test";
import {
  ADDRESS_FOUND,
  EVENTS,
  FOUND_ADDR,
  HISTORY,
  PARAMS,
} from "../fixtures/inspector";

const CORS = { "access-control-allow-origin": "*" };

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

// ---------------------------------------------------------------------------
// (1) HIGH — the liquidation bonus is a PAR-BASED MULTIPLIER on Aave.
// ---------------------------------------------------------------------------

test("(1) THE ROUND-10 DEFECT: Aave's 10500 renders a 5% PREMIUM, never `105%`", async ({
  page,
}) => {
  // No mutation: the COMMITTED fixture already carries the live deployment's
  // own Aave leg — liq_threshold 8100, liq_bonus 10500. That is precisely the
  // value the old formatter rendered as "105%".
  await mockInspector(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-aave_v3_etherfi").first();
  await expect(params).toContainText("LT 81% · bonus 5%");
  // The raw multiplier is DISCLOSED, in the denomination-disclosure grammar.
  await expect(params).toContainText("(multiplier 10500 bps · 1e4 scale)");
  // The lie, named: a liquidator collects a 5% premium, not 105%.
  await expect(params).not.toContainText("bonus 105%");
});

test("(1) a 10600 multiplier is a 6% premium — the second REAL wire value", async ({ page }) => {
  // DERIVED /v1/address: the Aave leg's liq_bonus 10500 → 10600. No other
  // byte changes.
  const body = structuredClone(ADDRESS_FOUND);
  const leg = body.positions[0]?.legs[0];
  if (leg === undefined) throw new Error("fixture shape drifted");
  leg.liq_bonus = "10600";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-aave_v3_etherfi").first();
  await expect(params).toContainText("LT 81% · bonus 6%");
  await expect(params).toContainText("(multiplier 10600 bps · 1e4 scale)");
  await expect(params).not.toContainText("bonus 106%");
});

test("(1) the DM bonus is NOT par-based — its premium is the wire value itself", async ({
  page,
}) => {
  // DERIVED /v1/address: the DM leg gains the live deployment's own params —
  // LT 95e18 and bonus 3.5e18 on the Debt Manager's 100e18 percent scale.
  // cmd/api/fixture_test.go:137 states the encoding: `1e18 additive => 1%`.
  const body = structuredClone(ADDRESS_FOUND);
  const leg = body.positions[1]?.legs[0];
  if (leg === undefined) throw new Error("fixture shape drifted");
  leg.liq_threshold = "95000000000000000000";
  leg.liq_bonus = "3500000000000000000";

  await mockInspector(page, body);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const params = page.getByTestId("leg-params-debt_manager").first();
  // A par subtraction here would be the mirror-image lie: 3.5%, not 3.5% − 100%.
  await expect(params).toContainText("LT 95% · bonus 3.5%");
  await expect(params).toContainText("(premium 3500000000000000000 · 100e18 scale)");
  // And the DM's raw is never dressed as a multiplier.
  await expect(params).not.toContainText("multiplier");
});
