// WAVE R13 (Codex round-21) e2e — pinned in the browser against the production
// build with the API mocked from committed fixtures.
//
// FINDING 1 (MEDIUM). `phases` is component state keyed by scenario id and it
// OUTLIVES the listing it was built against. A deployment stops publishing a
// committed scenario; the reader takes the listing-refresh affordance R12
// shipped; the row leaves the table — and the run phase stored under its id
// stays behind. R11's coverage guard and R12's identity guard are BOTH keyed per
// row, so neither can say anything about a row that is not there: both lookups
// answer undefined, both correctly decline to infer, and the orphan reached the
// cohort as a DISPLAYED PIN. Carrying the newest batch it took the anchor,
// marked every VISIBLE result SUPERSEDED, and left the header naming a cohort
// whose only current member is a row the table does not draw.
//
// FINDING 2 (MEDIUM). The failed-re-run banner composed from
// `rerunFailed !== undefined` alone, never asking what the retained outcome
// actually was. Over a response R12 REFUSES to present, the detail strip claimed
// "The result below is the one this row already held, at the batch it was
// measured on" — directly above a gated view whose entire text is "refusing to
// render" — and the matrix's row banner claimed the cells still showed a
// measurement, over cells reading CONTRADICTORY BOOK.
//
// THE LAW THIS FILE ENFORCES, extending R10-R12's: THE HEADER, THE CELLS, THE
// BANNERS AND THE DETAIL MAY NEVER CONTRADICT EACH OTHER — and no claim may be
// composed from a row the table does not render, or about a response the surface
// will not present.
//
//   (A) THE DELISTED ROW, NEWER   the dropped scenario held the newest batch.
//                                 Its row is gone; it takes its pin, its anchor
//                                 and its cohort claim with it, and the survivor
//                                 is left exactly as it was.
//   (B) THE DELISTED ROW, OLDER   the dropped scenario held an older batch. No
//                                 clause counts it: the survivor is CURRENT and
//                                 the superseded-row count drops to the rows
//                                 actually drawn.
//   (C) THE REFUSED RETENTION     a contradictory (then a definition-skewed)
//                                 response is retained across a FAILED re-run.
//                                 The banner never calls it a result, the gated
//                                 refusal stays rendered, and the header does not
//                                 move.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://localhost:8080";
const CORS = { "access-control-allow-origin": "*" };

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

function fulfillRaw(route: Route, body: string, status = 200): Promise<void> {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body });
}

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';
const ETHFI_ROW = '[data-testid="matrix-row"][data-scenario-id="ethfi_minus_50"]';
const WEETH_CHIP = '[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]';

// ===========================================================================
// (A) and (B) — the row the refreshed listing no longer names.
// ===========================================================================

/**
 * THE VEHICLE, and why it is this one. A listing refresh that keeps component
 * state is reachable through exactly one affordance on this surface: the
 * `refresh listing` button R12 put on a DEFINITION CHANGED row. So the harness
 * produces one — `ethfi_minus_50` answered at v2 against the v1 listing — which
 * is also the honest composition of the event: ONE deployment re-cut one
 * committed scenario and dropped another, and the reader meets both at once.
 *
 * The refreshed listing (`scenarios.removed.json`) keeps `scenario_config_version`
 * at v1 deliberately: moving it would refuse every SURVIVING row as DEFINITION
 * CHANGED and leave the table displaying nothing, hiding the defect behind a
 * guard that never sees it. Held still, the delisted row's orphaned phase is the
 * only anomaly on the table.
 *
 * `runBookFor` maps each scenario to the body its run returns, so a test can put
 * the delisted row on either side of the batch it is dropped from.
 */
async function delistingHarness(
  page: Page,
  removed: () => boolean,
  runBookFor: Record<string, string>,
): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    fulfillRaw(route, fixture(removed() ? "scenarios.removed.json" : "scenarios.json")),
  );
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    const url = route.request().url();
    const match = Object.entries(runBookFor).find(([id]) => url.includes(`/${id}/`));
    if (match === undefined) throw new Error(`the harness has no run-book body for ${url}`);
    return fulfillRaw(route, fixture(match[1]));
  });

  await page.goto("/lab");

  // The refresh affordance, earned honestly: this row's stored answer is about a
  // definition the page is not showing, so R12 offers a listing re-read.
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETHFI_ROW} td`).nth(2)).toHaveAttribute(
    "data-cell-state",
    "definition-changed",
  );
  await expect(
    page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`),
  ).toBeVisible();
}

test("(A) A DELISTED ROW HOLDING THE NEWEST BATCH takes its cohort claim with it", async ({
  page,
}) => {
  let removed = false;
  await delistingHarness(page, () => removed, {
    ethfi_minus_50: "run-book.ethfi_minus_50.v2.json", // batch 1, skewed to v2
    eth_minus_30: "run-book.eth_minus_30.json", // batch 1
    weeth_market_depeg_oracles_held: "run-book.weeth.batch2.json", // batch 2
  });

  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);

  // ---- BOTH ROWS RUN, WHILE BOTH ARE STILL LISTED -------------------------
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  // Legitimately superseded: the newer batch is on a row the reader can see.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("results shown together were measured at batch #2.");
  await expect(batchLine).toContainText(
    "1 row(s) still hold an older batch's result and are marked SUPERSEDED",
  );

  // ---- THE DEPLOYMENT DROPS THE ROW, AND THE READER REFRESHES -------------
  removed = true;
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`).click();

  // THE ROW IS GONE — from the table and from the chip rail. Its phase is not.
  await expect(page.locator(WEETH_ROW)).toHaveCount(0);
  await expect(page.locator(WEETH_CHIP)).toHaveCount(0);
  await expect(page.locator('[data-testid="matrix-row"]')).toHaveCount(3);

  // THE ASSERTION THE FINDING IS ABOUT. The orphan still carries batch 2, and
  // both optional guards are blind to it (no coverage entry, no identity entry).
  // Unfiltered it was the sole member of the cohort, so the header went on
  // announcing "results shown together were measured at batch #2" over a table
  // where NOT ONE rendered row displays batch 2.
  await expect(batchLine).not.toContainText("results shown together");
  await expect(batchLine).not.toContainText("Every DISPLAYED result was measured at that batch");
  await expect(batchLine).toContainText(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls below",
  );
  await expect(batchLine).toContainText("NO result now displayed was measured at it");

  // AND EVERY COUNT IS OVER RENDERED ROWS ONLY. One row displays a result here
  // (eth at batch 1); the ghost is in this clause and in no other.
  await expect(batchLine).toContainText(
    "1 row(s) are displayed and every one of them is OLDER, marked SUPERSEDED at its own batch pin",
  );
  // Nor is it counted by any of the refusal sets — it is not refused, it is
  // NOT THERE. The one definition-changed row is the rendered ethfi row.
  await expect(batchLine).toContainText(
    "1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing",
  );
  await expect(batchLine).not.toContainText("row(s) were served a book");
  await expect(batchLine).not.toContainText("row(s) display UNANSWERED");
  await expect(batchLine).not.toContainText("row(s) have a run in flight");

  // THE SURVIVING ROW IS UNCHANGED. It was SUPERSEDED before the refresh and it
  // is SUPERSEDED after: the floor R8 made monotonic is a statement about what
  // this panel HAS SEEN and is not unlearned by a listing read, and lowering it
  // would repaint an older row as CURRENT — the exact defect that floor exists
  // to prevent. What changed is only that the ghost no longer speaks for a
  // cohort.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(ethCell).toContainText("at batch #1 · matrix reads #2");

  // THE FRONTIER COMPARES ITSELF AGAINST THE ROWS ON SCREEN, and counts them.
  await expect(batchLine).toContainText(
    "The loss frontier above reads batch #1: the same batch 1 of the 1 displayed row(s) are " +
      "pinned to.",
  );
  await expect(batchLine).not.toContainText("a different batch from this table's displayed cohort");

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).not.toContainText("results shown together");
});

test("(B) A DELISTED ROW HOLDING AN OLDER BATCH is counted by NO clause", async ({ page }) => {
  let removed = false;
  await delistingHarness(page, () => removed, {
    ethfi_minus_50: "run-book.ethfi_minus_50.v2.json", // batch 1, skewed to v2
    weeth_market_depeg_oracles_held: "run-book.weeth_market_depeg_oracles_held.json", // batch 1
    eth_minus_30: "run-book.eth_minus_30.batch2.json", // batch 2
  });

  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);

  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");

  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("results shown together were measured at batch #2.");
  await expect(batchLine).toContainText(
    "1 row(s) still hold an older batch's result and are marked SUPERSEDED",
  );

  // ---- THE SUPERSEDED ROW IS THE ONE THE DEPLOYMENT DROPS -----------------
  removed = true;
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`).click();
  await expect(page.locator(WEETH_ROW)).toHaveCount(0);

  // THE COUNT DISCRIMINATOR. Unfiltered, the orphan stayed in
  // `supersededScenarioIds` and the header went on reporting a row holding an
  // older batch while NO rendered row does — a clause counting something the
  // reader cannot point at. It is gone, and so is the state it described.
  await expect(batchLine).not.toContainText("still hold an older batch's result");
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="superseded"]')).toHaveCount(
    0,
  );

  // THE SURVIVOR IS UNTOUCHED — current before, current after, never repainted.
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #2.");
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");

  // And the rendered definition-changed row is still counted exactly once.
  await expect(batchLine).toContainText(
    "1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing",
  );

  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).not.toContainText("still hold an older batch's result");
});

// ===========================================================================
// (C) — what a FAILED re-run left behind, named for what it is.
// ===========================================================================

/**
 * Each scenario answers its FIRST run from `first[id]` and every later run with
 * a 503 — the R8 sequence, which gives the held outcome back at its original
 * pin with the failure disclosed beside it.
 */
async function rerunFailureHarness(page: Page, first: Record<string, string>): Promise<void> {
  const calls = new Map<string, number>();
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    const url = route.request().url();
    const match = Object.entries(first).find(([id]) => url.includes(`/${id}/`));
    if (match === undefined) throw new Error(`the harness has no run-book body for ${url}`);
    const seen = (calls.get(match[0]) ?? 0) + 1;
    calls.set(match[0], seen);
    return seen === 1
      ? fulfillRaw(route, fixture(match[1]))
      : route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { ...CORS, "retry-after": "5" },
          body: fixture("error-unavailable.json"),
        });
  });
  await page.goto("/lab");
}

test("(C) A FAILED RE-RUN OVER A REFUSED RESPONSE never calls it a result, on either surface", async ({
  page,
}) => {
  await rerunFailureHarness(page, {
    weeth_market_depeg_oracles_held: "run-book.contradictory.json",
    eth_minus_30: "run-book.eth_minus_30.json",
  });

  const batchLine = page.getByTestId("matrix-batch-line");
  const aaveCell = page.locator(`${WEETH_ROW} td`).nth(1);
  const rowBanner = page.locator(`${WEETH_ROW} [data-testid="matrix-rerun-failed"]`);
  const detailBanner = page.getByTestId("rerun-failed");

  await page.locator(WEETH_CHIP).click();

  // ---- THE FIRST RUN: a body this surface refuses to present ---------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(aaveCell).toHaveAttribute("data-cell-state", "contradicted");
  await expect(page.getByTestId("runbook-contradicted")).toBeVisible();
  const headerBefore = await batchLine.innerText();

  // ---- THE RE-RUN FAILS: R8 gives the refused response back ----------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(rowBanner).toBeVisible();

  // THE FINDING. Both banners used to attach R8's wording unconditionally: the
  // matrix said the cells still showed what this row measured (over cells
  // reading CONTRADICTORY BOOK), and the detail said "The result below is the
  // one this row already held" (directly above "refusing to render").
  for (const banner of [rowBanner, detailBanner]) {
    await expect(banner).toHaveAttribute("data-retained", "refused");
    // The failure is still NAMED — the fix must not swallow the event R8 exposed.
    await expect(banner).toContainText("no servable batch (503)");
    await expect(banner).toContainText("retry after 5s");
    // What is retained is named for what it is, in its own register.
    await expect(banner).toContainText("What this row still holds is NOT a result");
    await expect(banner).toContainText("this surface REFUSES to present");
    await expect(banner).toContainText("CONTRADICTORY BOOK");
    // R8's assurance survives: the evidence was retained, not overwritten.
    await expect(banner).toContainText("Nothing was overwritten");
    // AND THE FALSE COMPOSITIONS ARE GONE — both are direct quotes of the defect.
    await expect(banner).not.toContainText("The result below");
    await expect(banner).not.toContainText("The cells still show what this row already measured");
    await expect(banner).not.toContainText("at the batch it was measured on");
  }

  // WAVE R17 SUPERSEDES THE THREE EXPECTATIONS BELOW, AND ONLY THOSE THREE.
  //
  // R13's finding was about the BANNER's wording, and every assertion in the
  // loop above still holds byte for byte: the failure is named, what is retained
  // is named by its own register, it is never called a result, and both false
  // compositions stay gone. What round-25 changed is the row's CLASSIFICATION.
  //
  // This phase is the shape round-25 ruled on — a BODYLESS settlement whose
  // attempt MATCHES the listing on screen, sitting beside a retained body
  // `bookRefusal` REFUSES. The model cannot distinguish it from the finding's own
  // sequence (a clean book, a listing move, a re-run under the current
  // definition), and nothing in the phase could: both are "this row's current
  // attempt came back with nothing, over a body that presents nothing". So both
  // get the one answer — the row is UNANSWERED under the current definition —
  // rather than a fourth condition invented to keep two shapes apart that the
  // reader would experience identically.
  //
  // THE RETAINED CONTRADICTORY BOOK LOSES NOTHING BY THIS. It is disclosed in
  // the banner (asserted above) and named again inside the cell's own sentence,
  // by the same register it always had.
  await expect(page.getByTestId("runbook-contradicted")).toHaveCount(0);
  await expect(page.getByTestId("runbook-current-bodyless")).toBeVisible();
  await expect(page.getByTestId("runbook-current-bodyless")).toContainText("(CONTRADICTORY BOOK)");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-engine")).toHaveCount(0);
  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(aaveCell).toContainText("(CONTRADICTORY BOOK)");
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );

  // THE HEADER MOVED, and moved to the truth about the LATEST request: this
  // row's own run ended without a served book. It no longer offers the retained
  // body's account as the row's current word — while never claiming the R12 sin
  // either, since "ended without a served result" is a statement about the 503
  // and not about what the earlier book named.
  await expect(batchLine).not.toHaveText(headerBefore);
  await expect(batchLine).toContainText("1 run(s) ended without a served result");
  await expect(batchLine).not.toContainText("1 run(s) were served a book that CONTRADICTS ITSELF");
  await expect(batchLine).not.toContainText("results shown together");

  // ---- THE CONTROL: over a response this surface DOES present, R8's wording
  // is unchanged, verbatim. The two paths diverge exactly where they must.
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();

  const ethBanner = page.locator(`${ETH_ROW} [data-testid="matrix-rerun-failed"]`);
  await expect(ethBanner).toHaveAttribute("data-retained", "result");
  await expect(ethBanner).toContainText("The cells still show what this row already measured");
  await expect(detailBanner).toHaveAttribute("data-retained", "result");
  await expect(detailBanner).toContainText("The result below is the one this row already held");
  await expect(detailBanner).toContainText("nothing was overwritten and nothing was invented");
  await expect(page.getByTestId("book-result")).toBeVisible();
});

test("(C) THE DEFINITION-CHANGED VARIANT: the same banner, in the other register", async ({
  page,
}) => {
  await rerunFailureHarness(page, {
    ethfi_minus_50: "run-book.ethfi_minus_50.v2.json",
  });

  const batchLine = page.getByTestId("matrix-batch-line");
  const dmCell = page.locator(`${ETHFI_ROW} td`).nth(2);
  const rowBanner = page.locator(`${ETHFI_ROW} [data-testid="matrix-rerun-failed"]`);
  const detailBanner = page.getByTestId("rerun-failed");

  await page.locator('[data-testid="lab-chip"][data-scenario-id="ethfi_minus_50"]').click();
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();
  await expect(dmCell).toHaveAttribute("data-cell-state", "definition-changed");
  await expect(page.getByTestId("runbook-definition-changed")).toBeVisible();
  const headerBefore = await batchLine.innerText();

  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();
  await expect(rowBanner).toBeVisible();

  for (const banner of [rowBanner, detailBanner]) {
    await expect(banner).toHaveAttribute("data-retained", "refused");
    await expect(banner).toContainText("no servable batch (503)");
    await expect(banner).toContainText("What this row still holds is NOT a result");
    await expect(banner).toContainText("DEFINITION CHANGED");
    await expect(banner).not.toContainText("The result below");
    await expect(banner).not.toContainText("CONTRADICTORY BOOK");
    await expect(banner).not.toContainText("The cells still show what this row already measured");
  }

  // WAVE R17 SUPERSEDES THE ROW'S CLASSIFICATION HERE TOO, for the same reason
  // and with the same scope: every banner assertion above is untouched, and what
  // changes is which register the row is counted and rendered in.
  //
  // THE AFFORDANCE GOES WITH THE CLASSIFICATION, and that is the ruled behaviour
  // rather than a side effect. R12's refresh is the remedy for a row whose
  // CURRENT WORD is an answer about another definition. Once this row's current
  // word is "my own attempt came back with nothing", offering it would be
  // offering a remedy for the row's PREVIOUS word — which is the exact shape of
  // the round-25 finding, where the refresh sat under a listing that was already
  // the right one. The retained body is still disclosed, still named DEFINITION
  // CHANGED, and becomes readable again the moment the row displays it again.
  await expect(page.getByTestId("runbook-definition-changed")).toHaveCount(0);
  await expect(page.getByTestId("runbook-current-bodyless")).toBeVisible();
  await expect(page.getByTestId("runbook-current-bodyless")).toContainText("(DEFINITION CHANGED)");
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(dmCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(dmCell).toContainText("(DEFINITION CHANGED)");
  await expect(page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`)).toHaveCount(0);
  await expect(batchLine).not.toHaveText(headerBefore);
  await expect(batchLine).toContainText("1 run(s) ended without a served result");
  await expect(batchLine).not.toContainText("answered for a committed definition");
});
