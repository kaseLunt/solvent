// WAVE R8 (Codex round-16) e2e — pinned in the browser against the production
// build, with the API mocked from the committed fixtures. Every mutation below
// is a structuredClone delta documented at its call site.
//
// What this file pins, finding by finding:
//
//   (1) HIGH — a legacy `?sort=hf&dir=desc` Book link kept its KEY (the alias
//              survived) and LOST ITS DIRECTION. A sort that does not survive
//              VERBATIM orphans the `dir` beside it, so the request became
//              canonical `headroom` ASC: a bookmark asking for HIGHEST HEALTH
//              FACTOR FIRST was served LEAST HEADROOM FIRST — the opposite end
//              of the same book — with the URL rewritten to agree. `hf` on Aave
//              is now HONORED exactly as R7 honors `liq_distance`: key and
//              direction verbatim on the wire, the standing register naming
//              what is applied in reader words, no column header claiming it,
//              and the first click of any sort control moving to that column.
//
//   (2) HIGH — starting a re-run replaced the row's outcome with a bare
//              running phase, deleting the batch that row was pinned to. When
//              the re-run row held the NEWEST batch — the cohort anchor — the
//              anchor fell back to an older batch and every previously
//              SUPERSEDED row repainted as a current RESULT for the whole
//              in-flight window; a failed re-run left them that way. The anchor
//              is now MONOTONIC: a running row still carries what it held, and
//              a re-run that ends without a book gives the prior result back at
//              its own batch pin with the failure named beside it.
//
// (Finding 3 — the no-cliff dek's missing terminal clause — is a pure sentence
// and is pinned exhaustively by tests/unit/lab-dek.spec.ts, on the rendered
// string, across all three of its shapes.)

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

// ===========================================================================
// (2) HIGH — the cohort anchor is MONOTONIC across a re-run.
// ===========================================================================

/** The two COLD routes book mode reads on arrival. Neither is a run. */
async function mockCold(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
}

const ETH_ROW = '[data-testid="matrix-row"][data-scenario-id="eth_minus_30"]';
const WEETH_ROW = '[data-testid="matrix-row"][data-scenario-id="weeth_market_depeg_oracles_held"]';

/**
 * Drive the matrix to the state the finding lives in: ETH holds batch 1, WEETH
 * holds batch 2 and IS the cohort anchor, ETH is therefore SUPERSEDED. Then
 * re-run the ANCHOR row against a route that is held open.
 *
 * `settle` decides how that held re-run ends.
 */
async function anchorRerunHarness(
  page: Page,
  settle: (route: Route) => Promise<void>,
): Promise<() => void> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let weethCalls = 0;
  await mockCold(page);
  await page.route(`${API}/v1/scenarios/*/run-book`, async (route) => {
    if (route.request().url().includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.eth_minus_30.json")); // batch 1
    }
    weethCalls += 1;
    if (weethCalls === 1) {
      return fulfillRaw(route, fixture("run-book.weeth.batch2.json")); // batch 2
    }
    // HELD, so the in-flight window can be asserted while the re-run of the
    // ANCHOR row is genuinely outstanding.
    await held;
    return settle(route);
  });

  await page.goto("/lab");
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await expect(page.getByTestId("matrix-batch-line")).toContainText(
    "results shown together were measured at batch #1",
  );

  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${WEETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute(
    "data-cell-state",
    "superseded",
  );
  await expect(page.getByTestId("matrix-batch-line")).toContainText("measured at batch #2");

  // RE-RUN THE ANCHOR ROW. This click is the whole finding.
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  return release;
}

test("(2) A DELAYED RE-RUN OF THE ANCHOR ROW: superseded rows stay superseded for the whole window", async ({
  page,
}) => {
  const release = await anchorRerunHarness(page, (route) =>
    fulfillRaw(route, fixture("run-book.weeth.batch2.json")),
  );

  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);
  const batchLine = page.getByTestId("matrix-batch-line");

  // The re-run row renders RUNNING — never its held value under a live request.
  await expect(weethCell).toHaveAttribute("data-cell-state", "running");

  // THE FIX. The anchor did not fall to batch 1, so the older row keeps its own
  // named state. THE OLD BEHAVIOUR was `result` here — a batch-1 measurement
  // repainted as current, under a header sentence that had walked backwards to
  // batch 1 with it.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(ethCell).toContainText("SUPERSEDED");
  await expect(ethCell).toContainText("at batch #1");
  await expect(ethCell).toContainText("matrix reads #2");

  // THE HEADER'S SENTENCE STAYS TRUE, and it discloses the run in flight rather
  // than letting the reader wonder whether the batch moved.
  //
  // WAVE R9 (round-17 finding 1) CHANGED THIS EXPECTATION, and the change is a
  // STRENGTHENING of exactly what this test is for. It used to assert
  // `toContainText("measured at batch #2")` — i.e. that the header still named
  // batch 2 as the batch every visible result was measured at. But during this
  // window the batch-2 row is DISPLAYING NOTHING (it renders "running…"), so no
  // displayed result was measured at batch 2 and the header must not say one
  // was. R8's law is untouched and still asserted below: the watermark holds at
  // 2, the older row keeps its SUPERSEDED state, and nothing repaints as
  // current. What changed is that the header no longer claims a cohort with
  // zero members while proving it.
  await expect(batchLine).toContainText(
    "batch #2 is the newest batch this table has seen and the floor its as-of never falls below",
  );
  await expect(batchLine).toContainText("NO result now displayed was measured at it");
  await expect(batchLine).not.toContainText("results shown together");
  await expect(batchLine).not.toContainText("measured at batch #1");
  await expect(batchLine).toContainText("1 row(s) have a run in flight");
  await expect(batchLine).toContainText("never moves backwards");

  // Re-asserted after the assertions above have burned real time on the page:
  // the state is stable for the DURATION of the window, not merely at its start.
  await expect(weethCell).toHaveAttribute("data-cell-state", "running");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");

  // ---- THE RE-RUN LANDS ---------------------------------------------------
  release();
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  // Same batch, so nothing about the cohort changed — and the older row is
  // still exactly where it was.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("measured at batch #2");
  await expect(batchLine).not.toContainText("have a run in flight");
});

test("(2) A FAILED RE-RUN: the prior result returns with its own batch pin, and the failure is NAMED", async ({
  page,
}) => {
  const release = await anchorRerunHarness(page, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { ...CORS, "retry-after": "5" },
      body: fixture("error-unavailable.json"),
    }),
  );

  const ethCell = page.locator(`${ETH_ROW} td`).nth(2);
  const weethCell = page.locator(`${WEETH_ROW} td`).nth(2);
  const batchLine = page.getByTestId("matrix-batch-line");

  await expect(weethCell).toHaveAttribute("data-cell-state", "running");
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");

  release();

  // THE FIX. A re-run that could not answer says NOTHING about the answer this
  // row already held, so the held outcome comes back — at its ORIGINAL batch
  // pin, which is what keeps it the cohort anchor. THE OLD BEHAVIOUR replaced a
  // real batch-2 measurement with a 503, dropped the anchor to batch 1, and
  // left every batch-1 row painted as current indefinitely.
  await expect(weethCell).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("measured at batch #2");
  await expect(batchLine).not.toContainText("measured at batch #1");

  // AND THE SUPERSEDED ROW NEVER FLICKERED CURRENT — before, during, or after.
  await expect(ethCell).toHaveAttribute("data-cell-state", "superseded");
  await expect(batchLine).toContainText("1 row(s) still hold an older batch's result");

  // THE FAILURE IS NOT SWALLOWED. Restoring the evidence must not hide the
  // event: the row says what happened, in the run-outcome vocabulary, beside
  // the result it did not overwrite.
  const note = page.locator(`${WEETH_ROW} [data-testid="matrix-rerun-failed"]`);
  await expect(note).toBeVisible();
  await expect(note).toContainText("no servable batch (503)");
  await expect(note).toContainText("retry after 5s");
  await expect(note).toContainText("The cells still show what this row already measured");

  // …and the committed-scenario detail says it too, in its own register, above
  // a result that still carries its own batch stamp.
  await page.locator(`${WEETH_ROW} [data-testid="matrix-row-label"]`).click();
  const detail = page.getByTestId("rerun-failed");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("nothing was overwritten and nothing was invented");
  await expect(page.getByTestId("book-result")).toBeVisible();
});
