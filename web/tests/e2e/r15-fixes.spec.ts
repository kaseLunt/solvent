// WAVE R15 (Codex round-23) e2e — pinned in the browser against the production
// build with the API mocked from committed fixtures.
//
// THE FINDING (MEDIUM). R14 bound every bodyless phase to the identity it was
// DISPATCHED under, and gave the whole resulting set ONE remedy: this run never
// answered, so a listing refresh cannot help it — RE-RUN THE ROW. That is exactly
// right for a run that ENDED without a book. It is false for one that is STILL IN
// FLIGHT, and `attemptSkew` knew the difference from the day it was written — its
// CELL wording already reads "The request is still out". The COHORT threw the
// distinction away: running and settled skewed attempts landed in ONE count, so
// the header announced over a live request that it "never came back with a book
// of their own" and directed the reader to re-run — while `matrix-run` and
// `run-book-button` are BOTH disabled for precisely as long as that request is
// out. A dead end, printed above a sentence contradicting it, and above a run
// button still reading "running…". `BookAttemptChangedView` did the same in one
// paragraph: R14's fixed tail "No book came back from it" landed directly after a
// reason ending "The request is still out".
//
// THE LAW THIS FILE ENFORCES, extending R10-R14's: THE HEADER, THE CELLS, THE
// BANNERS AND THE DETAIL MAY NEVER CONTRADICT EACH OTHER — and no surface may
// EVER direct a reader to a control the row has disabled. A request that is still
// out is told it is still out, offered no remedy at all, and given R14's settled
// remedy the moment — and only the moment — it settles.
//
// THE SEQUENCE, which is the finding's own timing window:
//
//   1. run eth_minus_30      a clean result at batch #1, so the header takes its
//                            ANCHORED arm throughout
//   2. run ethfi_minus_50    a v2 answer against a v1 listing — R12's half of the
//                            definition-changed set, and the CONTROL here, since
//                            its remedy is still a refresh. It also supplies the
//                            only affordance on this surface that refreshes the
//                            listing while keeping component state.
//   3. run weeth…            and the mock HOLDS THE REQUEST OPEN
//   4. refresh to v2         the row is re-cut mid-flight: a RUNNING skewed
//                            attempt, which is the state this wave is about
//   5. release it, bodyless  a 404 settles it, and every surface flips to R14's
//                            remedy at once

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Route } from "@playwright/test";

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

test("R15 — A RUN DISPATCHED UNDER v1 AND STILL OUT WHEN THE LISTING MOVES TO v2 IS NEVER TOLD IT CAME BACK", async ({
  page,
}) => {
  let listing = "scenarios.json";
  // THE HELD REQUEST. The handler parks on this promise, so the browser has a
  // genuinely in-flight fetch for as long as the test wants one — the timing
  // window the finding lives in, reproduced rather than simulated.
  let releaseWeeth = (): void => {
    throw new Error("the weeth gate was never armed");
  };
  const weethGate = new Promise<void>((resolve) => {
    releaseWeeth = resolve;
  });

  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture(listing)));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, async (route) => {
    const url = route.request().url();
    if (url.includes("/eth_minus_30/")) {
      return fulfillRaw(route, fixture("run-book.eth_minus_30.json"));
    }
    if (url.includes("/ethfi_minus_50/")) {
      return fulfillRaw(route, fixture("run-book.ethfi_minus_50.v2.json"));
    }
    if (url.includes("/weeth_market_depeg_oracles_held/")) {
      await weethGate;
      // Bodyless, and honestly so: this deployment does not serve run-book.
      return fulfillRaw(route, fixture("error-not-found.json"), 404);
    }
    throw new Error(`the harness has no run-book body for ${url}`);
  });
  await page.goto("/lab");

  const batchLine = page.getByTestId("matrix-batch-line");
  const weethAave = page.locator(`${WEETH_ROW} td`).nth(1);
  const weethDm = page.locator(`${WEETH_ROW} td`).nth(2);
  const weethRun = page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`);
  const rowNote = page.locator(`${WEETH_ROW} [data-testid="matrix-attempt-changed"]`);

  // ---- 1. A CLEAN RESULT, so the header takes its ANCHORED arm throughout ---
  await page.locator(`${ETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  // ---- 2. THE CONTROL ROW, and the refresh affordance it earns --------------
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETHFI_ROW} td`).nth(2)).toHaveAttribute(
    "data-cell-state",
    "definition-changed",
  );
  const refresh = page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`);
  await expect(refresh).toBeVisible();

  // ---- 3. THE WEETH RUN IS DISPATCHED, AND THE MOCK HOLDS IT ----------------
  await page.locator(WEETH_CHIP).click();
  await weethRun.click();
  await expect(weethDm).toHaveAttribute("data-cell-state", "running");
  await expect(batchLine).toContainText("row(s) have a run in flight");
  await expect(page.getByTestId("book-running")).toBeVisible();

  // ---- 4. THE LISTING MOVES TO v2 WHILE THE REQUEST IS STILL OUT ------------
  listing = "scenarios.relisted.json";
  await refresh.click();
  await expect(page.locator(WEETH_ROW)).toContainText("weeth_market_depeg_oracles_held · v2");

  // The row is now a RUNNING skewed attempt. Its cells say so, in R12's register.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("The request is still out");
    await expect(cell).not.toContainText("Re-run this row");
  }

  // THE HEADER, WHICH IS THE FINDING. It used to say the request "never came
  // back" and send the reader to re-run — over a fetch that had not answered and
  // a button that could not be clicked.
  await expect(batchLine).toContainText(
    "1 row(s) were ASKED under a COMMITTED DEFINITION this page is no longer showing and their " +
      "request is STILL OUT",
  );
  await expect(batchLine).toContainText("There is nothing to do here until it settles.");
  await expect(batchLine).not.toContainText("never came back with a book of their own");
  await expect(batchLine).not.toContainText("Re-run the row to ask under the current definition");
  // …while R12's ANSWER half keeps its own sentence and its own remedy, beside it.
  await expect(batchLine).toContainText(
    "1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing",
  );
  await expect(batchLine).toContainText(
    "Refresh the committed listing to run against the current definition.",
  );
  // The two are never merged into one count.
  await expect(batchLine).not.toContainText("2 row(s) were ASKED");
  // …and the row is still not counted as THIS table's run, in any tense.
  await expect(batchLine).not.toContainText("row(s) have a run in flight");
  await expect(batchLine).not.toContainText("ended without a served result");
  await expect(batchLine).not.toContainText("no run has been issued yet");

  // NO RE-RUN AFFORDANCE IS OFFERED ANYWHERE, and the controls prove why: both
  // are disabled for exactly as long as the request is out.
  await expect(rowNote).toHaveAttribute("data-in-flight", "true");
  await expect(rowNote).toContainText("this row's request is still out");
  await expect(rowNote).not.toContainText("Run this row again");
  await expect(rowNote).not.toContainText("never came back");
  await expect(weethRun).toBeDisabled();
  await expect(weethRun).toHaveText("running…");
  await expect(page.getByTestId("run-book-button")).toBeDisabled();
  // Nor R12's refresh, which resolves nothing here either.
  await expect(page.locator(`${WEETH_ROW} [data-testid="matrix-refresh-listing"]`)).toHaveCount(0);

  // THE DETAIL PANEL SAYS THE SAME THING, in one paragraph that does not
  // contradict itself. R14 appended "No book came back from it" to a reason
  // ending "The request is still out".
  const detail = page.getByTestId("runbook-attempt-changed");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute("data-in-flight", "true");
  await expect(detail).toContainText("The request is still out");
  await expect(detail).toContainText("there is nothing to do here until the request settles");
  await expect(detail).not.toContainText("No book came back from it");
  // …and the raw in-flight register is not rendered under it either.
  await expect(page.getByTestId("book-running")).toHaveCount(0);
  await expect(page.getByTestId("runbook-not-served")).toHaveCount(0);

  // ---- THE LEGEND (Wave R16, finding 2) ------------------------------------
  //
  // R15 corrected the header, the cells, the row note and the detail view over
  // a request that is still out — and never looked at the caption under the
  // table, which this file never inspected either. It carried R14's
  // SETTLED-ONLY text, on every page and in every state: "never came back with
  // a book of its own … re-run the row". Printed at this exact moment it
  // contradicted all four corrected surfaces at once and pointed the reader at
  // the control the row has disabled — the same dead end, one element lower.
  //
  // The register now enumerates its three cases, and the RUNNING one is on
  // screen in its own words while the request is out.
  const legendRunning = page.getByTestId("matrix-legend-dc-running");
  await expect(legendRunning).toContainText("its request is STILL OUT");
  await expect(legendRunning).toContainText("nothing to do here until it settles");
  await expect(legendRunning).not.toContainText("never came back");
  await expect(legendRunning).not.toContainText("re-run");
  // The other two arms are present and keep their OWN remedies — the legend
  // describes a register, so all three cases are named whatever this row is
  // doing. What may never happen again is one case's text standing for three.
  await expect(page.getByTestId("matrix-legend-dc-response")).toContainText(
    "refresh the listing to run against the current one",
  );
  const legendSettled = page.getByTestId("matrix-legend-dc-settled");
  await expect(legendSettled).toContainText("never came back with a book of its own");
  await expect(legendSettled).toContainText("re-run the row");
  await expect(legendSettled).toContainText("a refresh resolves nothing");

  // ---- 5. THE REQUEST SETTLES, BODYLESS. Every surface flips at once. -------
  releaseWeeth();

  await expect(batchLine).toContainText(
    "1 row(s) were ASKED under a COMMITTED DEFINITION this page is no longer showing and never " +
      "came back with a book of their own",
  );
  await expect(batchLine).toContainText("Re-run the row to ask under the current definition");
  await expect(batchLine).toContainText("a listing refresh resolves nothing here");
  // The still-out sentence is GONE — it was true and is no longer.
  await expect(batchLine).not.toContainText("their request is STILL OUT");
  await expect(batchLine).not.toContainText("There is nothing to do here until it settles.");
  // The cells stay in the same register; only the remedy inside them moves.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("Re-run this row to ask under the definition");
    await expect(cell).not.toContainText("The request is still out");
  }

  // AND THE RE-RUN AFFORDANCE APPEARS, because now it points at a live control.
  await expect(rowNote).toHaveAttribute("data-in-flight", "false");
  await expect(rowNote).toContainText("Run this row again to ask under the definition above.");
  await expect(rowNote).not.toContainText("still out");
  await expect(weethRun).toBeEnabled();
  await expect(weethRun).toHaveText("run");
  await expect(page.getByTestId("run-book-button")).toBeEnabled();

  await expect(detail).toHaveAttribute("data-in-flight", "false");
  await expect(detail).toContainText("nothing here for a listing refresh to make readable");
  await expect(detail).not.toContainText("there is nothing to do here until the request settles");

  // The clean row is untouched by the whole sequence, and the cohort it anchors
  // still reads exactly as it did before the listing moved.
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "result");
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(rowNote).toHaveAttribute("data-in-flight", "false");
});
