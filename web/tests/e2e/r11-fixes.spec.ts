// WAVE R11 (Codex round-19) e2e — a 200 THAT NAMES NOBODY, pinned in the
// browser against the production build with the API mocked from committed
// fixtures.
//
// THE FINDING (MEDIUM). The cohort builder treated every `kind: "ok"` outcome as
// a DISPLAYED result, because the envelope carried a batch. `cellState` already
// renders a covered engine named in NEITHER `engines[]` nor `excluded_engines[]`
// as UNANSWERED — "this surface will not fill a hole with a zero" — and the
// contract permits exactly that body: neither array carries `minItems`, and the
// client does no cross-field validation. So a 200 whose two arrays are both
// empty painted EVERY cell of the row UNANSWERED while the builder minted a
// displayed pin and a current cohort. The header announced
//
//   "results shown together were measured at batch #N.
//    Every DISPLAYED result was measured at that batch."
//
// above ZERO displayed results, and the frontier clause compared itself against
// that nonexistent cohort. Header and cells contradicted — the exact degraded-
// response class this surface otherwise fails closed on.
//
// THE LAW THIS FILE ENFORCES, as in R10: THE HEADER MAY NEVER CONTRADICT THE
// CELLS. Every assertion below reads the rendered sentence AND the rendered
// cells in the same state.
//
//   (A) THE ROW    a run whose 200 names every covered engine in neither array:
//                  every covered cell UNANSWERED, no cohort claim in the header,
//                  the state NAMED as a served book (never "ended without a
//                  served result"), and no table-wide frontier comparison.
//   (B) THE ANCHOR the same 200 at a NEWER batch, beside a row displaying a real
//                  result: the older row stays CURRENT. A book that displays
//                  nothing raises neither the anchor nor the watermark, so it
//                  cannot repaint a displayed result as SUPERSEDED under a
//                  cohort no cell belongs to.

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

/** The two COLD routes book mode reads on arrival. Neither is a run.
 *  `book.json` is batch 1, so the frontier's own batch is 1 throughout. */
async function mockCold(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
}

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';

// ===========================================================================
// (A) The row that was served a book naming nobody.
// ===========================================================================

test("(A) A 200 NAMING NOBODY: every covered cell UNANSWERED, and the header claims no cohort", async ({
  page,
}) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    // batch 1, `engines: []`, `excluded_engines: []` — healthy envelope, and it
    // names not one of the two engines this scenario is committed for.
    fulfillRaw(route, fixture("run-book.names-nobody.json")),
  );

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const aaveCell = page.locator(`${WEETH_ROW} td`).nth(1);
  const dmCell = page.locator(`${WEETH_ROW} td`).nth(2);

  await expect(batchLine).toContainText("no run has been issued yet");

  // ---- THE RUN LANDS, WITH A BOOK THAT NAMES NOBODY -----------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS: both covered engines are holes. Not zeros, not refusals.
  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(dmCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(dmCell).toContainText("UNANSWERED");
  await expect(dmCell).toContainText("neither a result nor a refusal");
  await expect(dmCell).toContainText("will not fill a hole with a zero");
  // Not one cell anywhere on the table is displaying a result.
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="superseded"]'),
  ).toHaveCount(0);

  // THE FIX. The old header claimed a batch-1 cohort over zero displayed
  // results, directly above the two UNANSWERED cells.
  await expect(batchLine).not.toContainText("results shown together");
  await expect(batchLine).not.toContainText("Every DISPLAYED result was measured at that batch");

  // AND IT NAMES WHAT ACTUALLY HAPPENED. A book WAS served — so the header may
  // not borrow the sentence for a run that ended without one, and may not call
  // it "not run" either.
  await expect(batchLine).toContainText(
    "1 run(s) were served a book that named none of the row's covered engines — a served book, " +
      "but not a served result",
  );
  await expect(batchLine).toContainText("There is no batch for this table to be as of");
  await expect(batchLine).not.toContainText("ended without a served result");
  await expect(batchLine).not.toContainText("no run has been issued yet");

  // THE FRONTIER READS ITS OWN BATCH AND COMPARES ITSELF TO NOTHING. There is no
  // displayed cohort here, and no displayed row for it to be "the same batch" as.
  await expect(batchLine).toContainText("The loss frontier above reads batch #1.");
  await expect(batchLine).not.toContainText("a different batch");
  await expect(batchLine).not.toContainText("displayed row(s) are pinned to");

  // Rows nobody asked about still read "not run" — the all-hole row's answer is
  // its own, and says nothing about anybody else's.
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute(
    "data-cell-state",
    "not-run",
  );

  // Re-asserted after the assertions above have burned real time: this is the
  // settled state, not a frame between two renders.
  await expect(dmCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(batchLine).not.toContainText("results shown together");
});

// ===========================================================================
// (B) The anchor: no displayable evidence, no floor movement.
// ===========================================================================

test("(B) A NAMING-NOBODY 200 AT A NEWER BATCH does not move the anchor or supersede a real result", async ({
  page,
}) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.request().url().includes("/eth_minus_30/")
      ? fulfillRaw(route, fixture("run-book.eth_minus_30.json")) // batch 1, real
      : fulfillRaw(route, fixture("run-book.names-nobody.batch2.json")), // batch 2, nobody
  );

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);

  // ---- ETH lands a REAL result at batch 1 and IS the cohort ---------------
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  // ---- WEETH is served a batch-2 book that names nobody --------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "unanswered");
  // The cell discloses the batch its naming-nobody book carried — the only place
  // left that can, since the row pins nothing — and disclaims it in the same
  // breath, so the reader can never read it as a member of the cohort above.
  await expect(weethCell).toContainText("The book it served was measured at batch #2");
  await expect(weethCell).toContainText("no part of that batch's cohort");

  // THE ASSERTION THE FINDING IS ABOUT. Pre-fix, batch 2 became the anchor on the
  // strength of an envelope displaying nothing: the ETH row repainted SUPERSEDED
  // and the header claimed a batch-2 cohort while not one cell showed batch 2.
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");
  await expect(batchLine).not.toContainText("batch #2");
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="superseded"]'),
  ).toHaveCount(0);

  // The all-hole row is counted BESIDE the cohort, in its own words.
  await expect(batchLine).toContainText(
    "1 row(s) were SERVED A BOOK that named none of the engines their committed definition covers",
  );
  await expect(batchLine).toContainText("every covered cell there reads UNANSWERED");
  await expect(batchLine).toContainText("That is not a run that ended without a book");

  // The frontier (batch 1) matches the displayed cohort (batch 1), so no
  // difference is claimed — and the comparison was made against the cohort, not
  // against a watermark the naming-nobody book might have dragged forward.
  await expect(batchLine).toContainText("The loss frontier above reads batch #1.");
  await expect(batchLine).not.toContainText("a different batch");

  // Re-asserted after real time on the page: the settled state.
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(weethCell).toHaveAttribute("data-cell-state", "unanswered");
});
