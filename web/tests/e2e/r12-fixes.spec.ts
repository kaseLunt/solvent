// WAVE R12 (Codex round-20) e2e — the two responses this surface refuses to
// classify, pinned in the browser against the production build with the API
// mocked from committed fixtures.
//
// FINDING 1 (MEDIUM). `cellState` checked `engines[]` before
// `excluded_engines[]`, so a COVERED engine appearing in BOTH arrays rendered
// its numeric RESULT in the matrix while the SAME response rendered it WITHHELD
// in the detail view. Nothing forbids that body — no `uniqueItems` on either
// array, no cross-field rule between them, no validation in `lib/runbook.ts` —
// and R11's tests exercised served membership and refused membership
// SEPARATELY, never together. Two surfaces, one response, two different answers
// about one cell, and the delta the matrix showed was $0: an unknowable
// rendered as a zero, which is the one thing this surface may never do.
//
// FINDING 2 (MEDIUM). Coverage came from the committed listing held in the
// browser and was joined to stored run phases BY SCENARIO ID ALONE. Across an
// API deployment mid-session that is two different definitions wearing one
// name: a v1 listing covering `debt_manager` retained in the tab, and a VALID
// v2 response for the same id covering only `aave_v3_etherfi`. R11 then read
// the v2 book against v1 coverage, found v1's engine named nowhere, and called
// the row ALL-HOLE — "the book named nobody" — while the response's real aave
// result sat in the detail view underneath.
//
// THE LAW THIS FILE ENFORCES, as in R10 and R11: THE HEADER MAY NEVER
// CONTRADICT THE CELLS, and now the DETAIL may never contradict either. Every
// assertion below reads the rendered sentence, the rendered cells AND the
// rendered detail panel in the same state.
//
//   (A) THE CONTRADICTORY BOOK  every covered cell reads CONTRADICTORY BOOK, no
//                               number and no refusal code is rendered from it
//                               anywhere, the header claims no cohort, and the
//                               detail panel refuses in the same words.
//   (B) THE VERSION SKEW        listing served at v1, run answered at v2: the
//                               row reads DEFINITION CHANGED, never ALL-HOLE and
//                               never a silent result. Then the refresh
//                               affordance re-fetches the listing and the same
//                               stored answer classifies against v2.

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

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';
const ETHFI_ROW = '[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"]';

// ===========================================================================
// (A) The body that answers one cell two ways.
// ===========================================================================

test("(A) A CONTRADICTORY 200: every covered cell refuses, and the DETAIL refuses identically", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    // aave_v3_etherfi in BOTH `engines[]` and `excluded_engines[]`, from one
    // response. Everything else is the contract's own run-book example.
    fulfillRaw(route, fixture("run-book.contradictory.json")),
  );

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const aaveCell = page.locator(`${WEETH_ROW} td`).nth(1);
  const dmCell = page.locator(`${WEETH_ROW} td`).nth(2);

  // Select the row first, so the DETAIL panel below is showing the same
  // scenario the matrix row is — the two readings must be of one response.
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await expect(batchLine).toContainText("no run has been issued yet");

  // ---- THE RUN LANDS, WITH A BODY THAT CONTRADICTS ITSELF -----------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS. `aave_v3_etherfi` is the contradicted engine; pre-fix this cell
  // read "result" and rendered the response's $0 delta — an unknowable
  // displayed as a zero — while the panel below called the same engine WITHHELD.
  await expect(aaveCell).toHaveAttribute("data-cell-state", "contradicted");
  await expect(aaveCell).toContainText("CONTRADICTORY BOOK");
  await expect(aaveCell).toContainText("named in BOTH engines[] and excluded_engines[]");
  await expect(aaveCell).toContainText("served and withheld at once");

  // AND THE WHOLE RESPONSE IS REFUSED, not the one cell. `debt_manager` is
  // named exactly once and cleanly, and is still not rendered: a body that
  // answers one cell two ways says nothing about which of its answers it meant,
  // so salvaging the "clean" cells would be this surface deciding the
  // contradiction was local when the response never said so.
  await expect(dmCell).toHaveAttribute("data-cell-state", "contradicted");

  // NOT ONE NUMBER AND NOT ONE REFUSAL CODE IS RENDERED FROM IT. Both arms of
  // the contradiction are refused — showing either would be picking one.
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="withheld"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="superseded"]'),
  ).toHaveCount(0);
  await expect(aaveCell).not.toContainText("$0");
  await expect(aaveCell).not.toContainText("DELTA-ONLY");
  await expect(aaveCell).not.toContainText("FLAG_CUSTODY_UNPROVEN");

  // THE HEADER CARRIES NO COHORT CLAIM FROM IT, and does not borrow R11's
  // sentence: this book named somebody TWICE, not nobody.
  await expect(batchLine).not.toContainText("results shown together");
  await expect(batchLine).not.toContainText("Every DISPLAYED result was measured at that batch");
  await expect(batchLine).toContainText(
    "1 run(s) were served a book that CONTRADICTS ITSELF: an engine named twice, or named as " +
      "served and withheld at once, which is a body that names somebody twice rather than one " +
      "that names nobody",
  );
  await expect(batchLine).toContainText("There is no batch for this table to be as of");
  await expect(batchLine).not.toContainText("named none of the row's covered engines");
  await expect(batchLine).not.toContainText("ended without a served result");
  await expect(batchLine).not.toContainText("no run has been issued yet");

  // THE DETAIL VIEW REFUSES IN THE SAME WORDS. This is the finding's other
  // half: it used to render the full aggregate panel with aave WITHHELD in its
  // excluded list, directly under a matrix cell showing aave's number.
  const refused = page.getByTestId("runbook-contradicted");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("the served book contradicts itself");
  await expect(refused).toContainText("named in BOTH engines[] and excluded_engines[]");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-engine")).toHaveCount(0);
  await expect(page.getByTestId("book-excluded")).toHaveCount(0);

  // The frontier reads its own batch and compares itself to nothing: there is
  // no displayed cohort here and no displayed row to be "the same batch" as.
  await expect(batchLine).toContainText("The loss frontier above reads batch #1.");
  await expect(batchLine).not.toContainText("a different batch");
  await expect(batchLine).not.toContainText("displayed row(s) are pinned to");

  // Rows nobody asked about are untouched.
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "not-run");

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(aaveCell).toHaveAttribute("data-cell-state", "contradicted");
  await expect(batchLine).not.toContainText("results shown together");
});

// ===========================================================================
// (B) The listing served at v1, the run answered at v2.
// ===========================================================================

/**
 * The listing route, flipped by the test rather than by call count: the refresh
 * affordance's effect must be provable, and an effect that fired twice on mount
 * would make a counter lie about which fetch served which body.
 */
async function mockSkew(page: Page, serveV2: () => boolean): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    fulfillRaw(route, fixture(serveV2() ? "scenarios.v2.json" : "scenarios.json")),
  );
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    // What the NEW deployment answers for this id: valid, complete, and about
    // the v2 definition — `scenario_version` v2 at `scenario_config_version` v2,
    // covering aave_v3_etherfi alone.
    fulfillRaw(route, fixture("run-book.ethfi_minus_50.v2.json")),
  );
}

test("(B) A v2 ANSWER AGAINST A RETAINED v1 LISTING reads DEFINITION CHANGED, never ALL-HOLE", async ({
  page,
}) => {
  let v2 = false;
  await mockSkew(page, () => v2);

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const aaveCell = page.locator(`${ETHFI_ROW} td`).nth(1);
  const dmCell = page.locator(`${ETHFI_ROW} td`).nth(2);

  await page.locator('[data-testid="lab-chip"][data-scenario-id="ethfi_minus_50"]').click();
  await expect(page.getByTestId("listing-config-version")).toContainText(
    "scenario_config_version v1",
  );
  // COLD, under v1: this scenario is defined for debt_manager only.
  await expect(aaveCell).toHaveAttribute("data-cell-state", "not-covered");
  await expect(dmCell).toHaveAttribute("data-cell-state", "not-run");

  // ---- THE API IS DEPLOYED, AND THE RUN COMES BACK AT v2 ------------------
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();

  // THE ASSERTION THE FINDING IS ABOUT. Joined by scenario id alone, the v2
  // book names none of v1's covered engines, so this cell read UNANSWERED under
  // a header announcing that the book named nobody — while the detail view
  // rendered the real aave result the very same response was carrying.
  await expect(dmCell).toHaveAttribute("data-cell-state", "definition-changed");
  await expect(dmCell).toContainText("DEFINITION CHANGED");
  await expect(dmCell).toContainText("scenario_version, scenario_config_version disagree");
  await expect(dmCell).toContainText("ethfi_minus_50 v1 at scenario_config_version v1");
  await expect(dmCell).toContainText("ethfi_minus_50 v2 at scenario_config_version v2");

  // NEVER ALL-HOLE, AND NEVER A SILENT RESULT.
  await expect(dmCell).not.toContainText("neither a result nor a refusal");
  await expect(dmCell).not.toContainText("will not fill a hole with a zero");
  await expect(batchLine).not.toContainText("named none of the row's covered engines");
  await expect(batchLine).not.toContainText("named nobody");
  await expect(batchLine).not.toContainText("results shown together");
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );

  // The header counts it in its own terms, and names the only thing that fixes
  // it — a fresh listing, not a re-run.
  await expect(batchLine).toContainText(
    "1 run(s) answered for a committed definition this page is no longer showing. Refresh the " +
      "listing to run against the current one",
  );

  // THE DETAIL VIEW AGREES, and does not render the aave aggregates from a
  // response computed for a definition this page is not showing.
  const changed = page.getByTestId("runbook-definition-changed");
  await expect(changed).toBeVisible();
  await expect(changed).toContainText("this answer is about another committed definition");
  await expect(changed).toContainText("nothing was re-run for you");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-engine")).toHaveCount(0);

  // ---- THE REFRESH PATH ---------------------------------------------------
  // The affordance re-reads `GET /v1/scenarios` and re-renders. It re-runs
  // NOTHING: the answer already in hand becomes readable the moment the listing
  // it was computed against is the one on screen.
  let runsAfterRefresh = 0;
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    runsAfterRefresh += 1;
    return fulfillRaw(route, fixture("run-book.ethfi_minus_50.v2.json"));
  });
  v2 = true;
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`).click();

  await expect(page.getByTestId("listing-config-version")).toContainText(
    "scenario_config_version v2",
  );
  // THE ROW IS RUNNABLE AGAINST v2, and the stored answer now classifies
  // against the definition it was actually computed for: the v2 definition
  // covers aave alone, so aave carries the result and debt_manager is NOT
  // COVERED — a property of the DEFINITION, read against the right one.
  await expect(page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`)).toBeEnabled();
  await expect(aaveCell).toHaveAttribute("data-cell-state", "result");
  await expect(dmCell).toHaveAttribute("data-cell-state", "not-covered");
  await expect(page.getByTestId("matrix-definition-changed")).toHaveCount(0);
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");
  await expect(batchLine).not.toContainText("no longer showing");

  // The detail view stops refusing, in the same motion.
  await expect(page.getByTestId("runbook-definition-changed")).toHaveCount(0);
  await expect(page.getByTestId("book-result")).toBeVisible();

  // AND NOTHING WAS RE-RUN TO GET HERE. The refresh is a listing read, and only
  // that; firing a book-wide computation to fix a display state would be a cost
  // the reader never asked for.
  expect(runsAfterRefresh).toBe(0);
});
