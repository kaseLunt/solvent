// WAVE R9 (Codex round-17) e2e — pinned in the browser against the production
// build, with the API mocked from the committed fixtures.
//
// What this file pins:
//
//   (1) MEDIUM — R8's monotonic WATERMARK was also serving as the header's
//                AS-OF CLAIM, and the two are different truths. The watermark
//                answers "what is the newest batch this panel has seen?" and is
//                a FLOOR that stops superseded rows repainting as current. The
//                as-of claim answers "what batch was everything I can see
//                measured at?" — a statement about what is DISPLAYED.
//
//                They diverge on exactly the sequence the watermark exists for:
//                the anchor row holds batch 2, a re-run of it SUCCEEDS, and the
//                daemon returns it pinned to the OLDER batch 1. R8's machinery
//                is perfect here — the watermark holds at 2 and every displayed
//                result is correctly SUPERSEDED — but with the batch-2 result
//                gone, the header still said "results shown together were
//                measured at batch #2" while NOT ONE ROW held batch 2.
//
// (Finding 2 — the dek's lead-only bad-debt clause — is a pure sentence and is
// pinned exhaustively by tests/unit/lab-dek.spec.ts across all three shapes.
// Its RENDERED form is pinned by tests/e2e/lab.spec.ts's cold-arrival dek.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";
const CORS = { "access-control-allow-origin": "*" };

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

function fulfillRaw(route: Route, body: string): Promise<void> {
  return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body });
}

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
}

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';

// ===========================================================================
// (1) MEDIUM — the watermark holds; the as-of claim is withdrawn.
// ===========================================================================

test("(1) A RE-RUN THAT SUCCEEDS AT AN OLDER BATCH: the header names no cohort it has no members for", async ({
  page,
}) => {
  let weethCalls = 0;
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    if (route.request().url().includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
    }
    weethCalls += 1;
    // THE WHOLE FINDING IS THIS SECOND ANSWER. Not a failure and not a refusal:
    // a 200 carrying an OLDER batch, which is what a daemon that pruned or
    // receded returns for a scenario it can still run.
    return fulfillRaw(
      route,
      weethCalls === 1
        ? fixture("run-book.weeth.batch2.json") // batch 2
        : fixture("run-book.weeth_market_depeg_oracles_held.json"), // batch 1 — OLDER
    );
  });

  await page.goto("/lab");

  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);
  const batchLine = page.getByTestId("matrix-batch-line");

  // ---- (a) batch 1 is the only held result, so it IS the cohort -----------
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1");

  // ---- (b) batch 2 lands and becomes the anchor ---------------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("results shown together were measured at batch #2");

  // ---- (c) THE ANCHOR ROW IS RE-RUN AND COMES BACK OLDER ------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();

  // R8'S LAW HOLDS, UNTOUCHED: the anchor did NOT recede to batch 1, so the
  // re-run row does not get to repaint itself as current by going backwards.
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(weethCell).toContainText("at batch #1");
  await expect(weethCell).toContainText("matrix reads #2");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");

  // AND ZERO ROWS HOLD BATCH 2. This is the fact the header was not consulting.
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );

  // ---- THE FIX -----------------------------------------------------------
  // THE OLD BEHAVIOUR: "results shown together were measured at batch #2." over
  // a table where not one visible cell was measured at batch 2.
  await expect(batchLine).not.toContainText("results shown together were measured at batch #2");
  await expect(batchLine).not.toContainText("results shown together");

  // The watermark is stated as what it IS — a floor — and the claim about what
  // is displayed is made separately, and truthfully.
  await expect(batchLine).toContainText(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls below",
  );
  await expect(batchLine).toContainText("NO result now displayed was measured at it");
  await expect(batchLine).toContainText(
    "2 row(s) are displayed and every one of them is OLDER, marked SUPERSEDED at its own batch pin",
  );
  await expect(batchLine).toContainText("there is no batch #2 cohort here to read them as one");

  // NOR DID IT WALK BACKWARDS. The receded batch is never promoted into the
  // header's place — each row states its own pin, in its own cell.
  await expect(batchLine).not.toContainText("measured at batch #1");

  // Re-asserted after the assertions above have burned real time: this is the
  // table's settled state, not a frame between two renders.
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).not.toContainText("results shown together");
});

test("(1) THE CLAIM RETURNS THE MOMENT A ROW HOLDS THE WATERMARK AGAIN", async ({ page }) => {
  // The other half of the ruling: the fix WITHDRAWS a false claim, it does not
  // abolish the true one. Re-run the receded row against a book that answers at
  // the watermark and the ordinary single-batch sentence comes straight back.
  let weethCalls = 0;
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    if (route.request().url().includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
    }
    weethCalls += 1;
    if (weethCalls === 1) return fulfillRaw(route, fixture("run-book.weeth.batch2.json"));
    if (weethCalls === 2) {
      return fulfillRaw(route, fixture("run-book.weeth_market_depeg_oracles_held.json")); // older
    }
    return fulfillRaw(route, fixture("run-book.weeth.batch2.json")); // back at the watermark
  });

  await page.goto("/lab");
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);
  const batchLine = page.getByTestId("matrix-batch-line");

  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");

  // Recede…
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).not.toContainText("results shown together");

  // …and return. One row holds batch 2 again, so a batch-2 cohort exists again.
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #2");
  await expect(batchLine).toContainText("1 row(s) still hold an older batch's result");
  await expect(batchLine).not.toContainText("NO result now displayed was measured at it");
});
