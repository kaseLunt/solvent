// WAVE R10 (Codex round-18) e2e — the matrix header's truth table, pinned in
// the browser against the production build with the API mocked from committed
// fixtures.
//
// THE LAW THIS FILE EXISTS TO ENFORCE: THE HEADER MAY NEVER CONTRADICT THE
// CELLS. Every assertion below reads the rendered sentence AND the rendered
// cells in the same state, so a header that describes a table nobody is looking
// at fails here rather than shipping.
//
// What this file pins, finding by finding:
//
//   (1) MEDIUM — `anchorBatchId === null` was read as "no run has been issued
//                yet — every covered cell reads not run". FALSE while a FIRST
//                run is IN FLIGHT (the cells read "running…") and FALSE
//                INDEFINITELY after a first run FAILED (the cells read
//                UNANSWERED). The header called those rows "not run" while the
//                grid beneath it said otherwise. "No run has been issued yet"
//                is a claim about what was ASKED, and is now decided by that
//                and nothing else.
//
//   (2) MEDIUM — a running row's HELD outcome anchors the cohort (R8) but the
//                row is deliberately in NEITHER displayed list, so with row A
//                re-running while holding batch 1 and row B current at batch 2,
//                `supersededScenarioIds` was empty and the header announced
//                "Every held result is on that batch" while A held batch 1 that
//                very moment. The assurance now speaks about DISPLAYED results,
//                and older held pins are disclosed by count and batch.
//
//   (3) MEDIUM — the frontier comparison was made against the WATERMARK, a
//                number displayed nowhere. In the receded sequence — watermark
//                2, every displayed row AND the frontier at batch 1 — the line
//                said the frontier was "a different batch from this table"
//                while every displayed result matched it exactly.

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
 *  `book.json` is batch 1 — which is what makes the frontier MATCH the receded
 *  table in (3), the exact case the old clause got wrong. */
async function mockCold(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
}

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';

/** A gate a mocked route can be held behind, so an in-flight window is real. */
function gate(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

// ===========================================================================
// (1) MEDIUM — a FIRST run in flight is not "not run".
// ===========================================================================

test("(1) A FIRST RUN IN FLIGHT: the header says the run is out, while the cells say running…", async ({
  page,
}) => {
  const { held, release } = gate();
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, async (route) => {
    await held;
    return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
  });

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);

  // COLD ARRIVAL — the no-run sentence is TRUE here, and stays available.
  await expect(batchLine).toContainText("no run has been issued yet");
  await expect(ethCell).toHaveAttribute("data-cell-state", "not-run");

  // ---- THE FIRST RUN GOES OUT AND IS HELD OPEN ---------------------------
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "running");

  // THE FIX. The old header still read "no run has been issued yet — every
  // covered cell reads not run" over a grid whose cells read "running…".
  await expect(batchLine).not.toContainText("no run has been issued yet");
  await expect(batchLine).not.toContainText("every covered cell reads");
  await expect(batchLine).toContainText(
    "no result has been served to this table yet: 1 run(s) are in flight",
  );
  await expect(batchLine).toContainText("There is no batch for this table to be as of");
  await expect(batchLine).toContainText("this is NOT “not run”");
  // No batch is named for the table, because none was served.
  await expect(batchLine).not.toContainText("results shown together");
  // The frontier still discloses its OWN batch, with no comparison invented.
  await expect(batchLine).toContainText("The loss frontier above reads batch #1.");
  await expect(batchLine).not.toContainText("a different batch");

  // Re-asserted after the assertions above have burned real time: this is the
  // settled state of the window, not a frame between two renders.
  await expect(ethCell).toHaveAttribute("data-cell-state", "running");
  await expect(batchLine).not.toContainText("no run has been issued yet");

  // ---- THE RUN LANDS ------------------------------------------------------
  release();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1");
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");
});

// ===========================================================================
// (1) MEDIUM — a FIRST run that FAILED is not "not run", and the state is
//              terminal until somebody clicks again.
// ===========================================================================

test("(1) A FIRST RUN THAT FAILED: the header names the failed run, while the cells say UNANSWERED", async ({
  page,
}) => {
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { ...CORS, "retry-after": "5" },
      body: fixture("error-unavailable.json"),
    }),
  );

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);

  await expect(batchLine).toContainText("no run has been issued yet");

  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS: a run that ended without a book is UNANSWERED — not a zero, and
  // emphatically not "not run".
  await expect(ethCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(ethCell).toContainText("UNANSWERED");
  await expect(ethCell).toContainText("no servable batch (503)");

  // THE FIX. This state is TERMINAL until the reader clicks again, so the old
  // header sat there saying "no run has been issued yet — every covered cell
  // reads not run" indefinitely, directly above a cell reading UNANSWERED.
  await expect(batchLine).not.toContainText("no run has been issued yet");
  await expect(batchLine).not.toContainText("every covered cell reads");
  await expect(batchLine).toContainText(
    "no result has been served to this table yet: 1 run(s) ended without a served result",
  );
  await expect(batchLine).toContainText("this is NOT “not run”");
  await expect(batchLine).not.toContainText("results shown together");

  // AND IT STAYS. Re-asserted after real time has passed on the page: nothing
  // repaints this back into a "not run" claim.
  await expect(ethCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(batchLine).not.toContainText("no run has been issued yet");
});

// ===========================================================================
// (2) MEDIUM — an OLDER row's re-run: the held pin is disclosed, never covered
//              by an assurance over "every held result".
// ===========================================================================

test("(2) AN OLDER ROW RE-RUNNING: its held batch is disclosed, not swept under “every held result”", async ({
  page,
}) => {
  const { held, release } = gate();
  let ethCalls = 0;
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, async (route) => {
    if (!route.request().url().includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.weeth.batch2.json")); // batch 2
    }
    ethCalls += 1;
    if (ethCalls === 1) return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
    // HELD, so the re-run of the OLDER row is genuinely outstanding while the
    // header is read.
    await held;
    return fulfillRaw(route, fixture("run-book.eth_minus_30.batch2.json")); // batch 2
  });

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);

  // ---- ETH holds batch 1; WEETH lands at batch 2 and becomes the cohort ----
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("1 row(s) still hold an older batch's result");

  // ---- RE-RUN THE OLDER ROW. This click is the whole finding ---------------
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS: ETH displays nothing (running…), WEETH still displays batch 2.
  await expect(ethCell).toHaveAttribute("data-cell-state", "running");
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  // ZERO rows are displaying a superseded result — which is exactly the empty
  // list the old sentence was reading.
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="superseded"]'),
  ).toHaveCount(0);

  // THE FIX. The old header said "Every held result is on that batch." here,
  // while the ETH row held a batch-1 result for the whole in-flight window.
  await expect(batchLine).not.toContainText("Every held result is on that batch");
  await expect(batchLine).toContainText("results shown together were measured at batch #2.");
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");
  await expect(batchLine).toContainText(
    "1 re-running row(s) still hold a result at batch #1 while the request is out",
  );
  await expect(batchLine).toContainText("held evidence, displayed nowhere");
  await expect(batchLine).toContainText("1 row(s) have a run in flight");

  // Re-asserted after real time: the disclosure is the window's settled state.
  await expect(ethCell).toHaveAttribute("data-cell-state", "running");
  await expect(batchLine).toContainText("1 re-running row(s) still hold a result at batch #1");

  // ---- THE RE-RUN LANDS AT THE ANCHOR -------------------------------------
  release();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  // Nothing is held older any more, so the disclosure withdraws itself — the
  // clause is a statement about a set, not a permanent banner.
  await expect(batchLine).not.toContainText("re-running row(s) still hold");
  await expect(batchLine).toContainText("results shown together were measured at batch #2.");
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");
});

// ===========================================================================
// (3) MEDIUM — the receded watermark with a MATCHING frontier batch.
// ===========================================================================

test("(3) RECEDED WATERMARK, MATCHING FRONTIER: no “different batch” claim over rows that match it", async ({
  page,
}) => {
  let weethCalls = 0;
  await mockCold(page); // book.json is batch 1 — the frontier this table matches
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    if (route.request().url().includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
    }
    weethCalls += 1;
    // A 200 carrying an OLDER batch on the second call: what a daemon that
    // pruned or receded returns for a scenario it can still run.
    return fulfillRaw(
      route,
      weethCalls === 1
        ? fixture("run-book.weeth.batch2.json") // batch 2 — raises the watermark
        : fixture("run-book.weeth_market_depeg_oracles_held.json"), // batch 1 — OLDER
    );
  });

  await page.goto("/lab");
  const batchLine = page.getByTestId("matrix-batch-line");
  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);

  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(ethCell).toHaveAttribute("data-cell-state", "result");
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");

  // While a batch-2 cohort EXISTS, the frontier at batch 1 really is a different
  // batch from it — and the claim names the COHORT, not "this table", because a
  // SUPERSEDED row displayed on this table is pinned to batch 1 already.
  await expect(batchLine).toContainText(
    "The loss frontier above reads batch #1, a different batch from this table's displayed cohort",
  );

  // ---- THE ANCHOR ROW RE-RUNS AND COMES BACK OLDER ------------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS: every displayed row is SUPERSEDED at batch #1, and the frontier
  // above them reads batch #1 too.
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(weethCell).toContainText("at batch #1");
  await expect(ethCell).toContainText("at batch #1");
  await expect(page.locator('[data-testid="matrix-cell"][data-cell-state="result"]')).toHaveCount(
    0,
  );

  // THE FIX. The comparison used to be made against the WATERMARK (2), so the
  // line called batch 1 "a different batch from this table" while EVERY
  // displayed result on that table was measured at batch 1.
  await expect(batchLine).not.toContainText("a different batch");
  await expect(batchLine).toContainText(
    "The loss frontier above reads batch #1: the same batch 2 of the 2 displayed row(s) are pinned to.",
  );
  // And no same-claim is smuggled in for the table either: there is no cohort.
  await expect(batchLine).toContainText("This table names no cohort of its own");

  // R9'S FLOOR DISCLOSURE IS UNTOUCHED and composes ahead of it without
  // contradiction: the watermark is still named as a floor, and still refuses
  // to claim a cohort with no members.
  await expect(batchLine).toContainText(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls below",
  );
  await expect(batchLine).toContainText("NO result now displayed was measured at it");
  await expect(batchLine).not.toContainText("results shown together");

  // Re-asserted after real time on the page: the settled state, not a frame.
  await expect(batchLine).not.toContainText("a different batch");
  await expect(weethCell).toHaveAttribute("data-cell-state", "superseded");
});
