// WAVE R17 (Codex round-25) e2e — pinned in the browser against the production
// build with the API mocked from committed fixtures.
//
// THE FINDING (MEDIUM), which is R16's sequence walked the other way round. R16
// made `attemptSkew` read the SETTLEMENT rather than the display, closing the
// case where the settled request's stamp DISAGREES with the listing. Round 25
// runs the inverse:
//
//   a clean v1 book is HELD → the listing refreshes to v2 → the row is re-run,
//   DISPATCHED UNDER v2 → that request settles BODYLESS, so R8 gives the v1 body
//   back beside the failure.
//
// `settledUnder` returned the v2 attempt, correctly. It MATCHES the current
// listing, so there was no skew and `attemptSkew` answered null — AND NULL MEANT
// "DEFER TO THE RETAINED BODY". That body is the v1 one, which `bookRefusal`
// refuses under a v2 listing, so the ROW classified as R12's ANSWER half: cells
// DEFINITION CHANGED about the RESPONSE, a header reading "Nothing failed and
// nothing was withheld … refresh the listing" over a listing that was ALREADY
// v2, and a banner one line below saying the re-run had failed. Two accounts of
// one row on one screen, and the true one was neither:
//
//   THE CURRENT-DEFINITION ATTEMPT FAILED, AND IT SERVED NO BOOK.
//
// THE LAW THIS FILE ENFORCES, extending R10-R16's: THE HEADER, THE CELLS, THE
// BANNERS, THE LEGEND AND THE DETAIL MAY NEVER CONTRADICT EACH OTHER; NO SURFACE
// MAY RECOMMEND A REMEDY THAT RESOLVES NOTHING; and A RETAINED BOOK IS DISPLAYED
// OR DISCLOSED, BUT NEVER MISTAKEN FOR THE SETTLED REQUEST'S ANSWER.
//
// THE SEQUENCE:
//
//   1. run eth_minus_30      a clean result at batch #1, so the header takes its
//                            ANCHORED arm throughout
//   2. run ethfi_minus_50    a v2 answer against a v1 listing — R12's ANSWER
//                            half, the CONTROL, and the only affordance on this
//                            surface that refreshes the listing in place
//   3. run weeth…            a REAL v1 book at batch #1 — the held evidence the
//                            whole finding turns on
//   4. refresh to v2         BEFORE the re-run, not during it. The weeth row is
//                            now R12's ANSWER half in its own right, refresh
//                            affordance and all — the PRE-STATE this wave must
//                            leave exactly as it found it
//   5. re-run weeth…         dispatched under v2, the definition on screen, and
//                            the mock HOLDS THE REQUEST OPEN
//   6. release it, bodyless  a 404 settles it — the retained v1 book comes back
//                            (R8), and the settlement must be read as THIS row's
//                            attempt, which served no book

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

test("R17 — A BODYLESS SETTLEMENT UNDER THE CURRENT DEFINITION IS THIS ROW'S OWN FAILURE, NOT THE RETAINED BOOK'S SKEW", async ({
  page,
}) => {
  let listing = "scenarios.json";
  // The weeth row is run TWICE. The first call answers with a real book — the
  // held evidence — and the second parks on this gate so the in-flight window is
  // a state the browser genuinely sits in rather than a frame between renders.
  let weethRuns = 0;
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
      weethRuns += 1;
      if (weethRuns === 1) {
        // A REAL BOOK, at v1, at batch #1 — this row's own measurement.
        return fulfillRaw(route, fixture("run-book.weeth_market_depeg_oracles_held.json"));
      }
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
  const weethRefresh = page.locator(`${WEETH_ROW} [data-testid="matrix-refresh-listing"]`);
  const rowNote = page.locator(`${WEETH_ROW} [data-testid="matrix-attempt-changed"]`);
  const rowBanner = page.locator(`${WEETH_ROW} [data-testid="matrix-rerun-failed"]`);

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
  const ethfiRefresh = page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`);
  await expect(ethfiRefresh).toBeVisible();

  // ---- 3. THE WEETH ROW MEASURES SOMETHING. This is the held evidence. ------
  await page.locator(WEETH_CHIP).click();
  await weethRun.click();
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "result");
  }
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");
  await expect(weethRefresh).toHaveCount(0);

  // ---- 4. THE LISTING MOVES TO v2 — BEFORE the re-run, not during it --------
  //
  // THE PRE-STATE, and it is R12's, untouched by this wave: the row's retained
  // body answered for a definition this page is no longer showing, so the cells
  // read DEFINITION CHANGED about the RESPONSE and the refresh affordance IS the
  // right one to offer. It is offered here — and the assertions after step 6 are
  // the proof that it stops being offered the moment it stops being true.
  listing = "scenarios.relisted.json";
  await ethfiRefresh.click();
  await expect(page.locator(WEETH_ROW)).toContainText("weeth_market_depeg_oracles_held · v2");
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("Re-open or refresh the listing");
  }
  await expect(weethRefresh).toBeVisible();
  await expect(batchLine).toContainText("2 row(s) answered for a COMMITTED DEFINITION");
  await expect(rowBanner).toHaveCount(0);

  // ---- 5. THE RE-RUN IS DISPATCHED UNDER v2, AND THE MOCK HOLDS IT ----------
  //
  // The stamp is taken from the listing on screen at the instant of dispatch, so
  // this attempt carries v2 — the definition the reader is looking at.
  await weethRun.click();
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "running");
  }
  // A request under the CURRENT definition is this row's own, so it is counted
  // in flight rather than banished to the definition-changed family.
  await expect(batchLine).toContainText("1 row(s) have a run in flight");
  await expect(rowNote).toHaveCount(0);
  await expect(weethRun).toBeDisabled();

  // ---- 6. THE REQUEST SETTLES, BODYLESS. THE FINDING. -----------------------
  releaseWeeth();

  // THE HEADER. Pre-R17 this row rejoined R12's ANSWER half — the count read
  // TWO, the remedy was "refresh the listing", and the UNANSWERED sentence was
  // never printed at all.
  await expect(batchLine).toContainText(
    "1 row(s) display UNANSWERED — their run ended without a served book",
  );
  await expect(batchLine).not.toContainText("2 row(s) answered for a COMMITTED DEFINITION");
  // …while R12's ANSWER half keeps its own sentence, its own count and its own
  // remedy for the row it is actually about — ethfi, whose body really did
  // answer for another definition. The two are never merged.
  await expect(batchLine).toContainText(
    "1 row(s) answered for a COMMITTED DEFINITION this page is no longer showing",
  );
  await expect(batchLine).toContainText(
    "Refresh the committed listing to run against the current definition.",
  );
  // And R14/R15's ATTEMPT family is not borrowed either: nothing about THIS
  // row's definition changed for THIS attempt.
  await expect(batchLine).not.toContainText("ASKED under a COMMITTED DEFINITION");
  await expect(batchLine).not.toContainText("never came back with a book of their own");
  await expect(batchLine).not.toContainText("their request is STILL OUT");
  await expect(batchLine).not.toContainText("row(s) have a run in flight");
  // The clean row is untouched by the whole sequence.
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  // THE CELLS, in the register the header just counted them in — and never the
  // retained book's numbers, which belong to a request this one is not.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "unanswered");
    await expect(cell).toContainText("this row's CURRENT attempt served no book");
    await expect(cell).toContainText("this deployment answered 404");
    await expect(cell).toContainText("ASKED under the definition this page IS showing");
    // The retained response is named, by its own register, as retained.
    await expect(cell).toContainText("EARLIER response this surface REFUSES to present");
    await expect(cell).toContainText("(DEFINITION CHANGED)");
    // …and R12's remedy, which the same cell printed one step ago, is gone with
    // the classification that earned it.
    await expect(cell).not.toContainText("Re-open or refresh the listing");
    await expect(cell).not.toContainText("no longer showing");
  }

  // NO AFFORDANCE THAT RESOLVES NOTHING. The listing this attempt was asked
  // under is the one on screen, so the refresh button is not offered for this
  // row — while the row that genuinely needs it still has it.
  await expect(weethRefresh).toHaveCount(0);
  await expect(ethfiRefresh).toBeVisible();
  // Nor R14's row note, which speaks for an attempt under a definition that HAS
  // moved. This one was asked under the current one.
  await expect(rowNote).toHaveCount(0);
  // The run control is live, because the row is not running.
  await expect(weethRun).toBeEnabled();
  await expect(weethRun).toHaveText("run");

  // THE BANNER BESIDE THEM. R8's retained evidence is still disclosed, still
  // named by its own refusal register, and still never called a result — but it
  // claims neither the cells nor a definition change it does not have.
  await expect(rowBanner).toBeVisible();
  await expect(rowBanner).toHaveAttribute("data-settlement", "current-bodyless");
  await expect(rowBanner).toHaveAttribute("data-attempt-changed", "false");
  await expect(rowBanner).toHaveAttribute("data-retained", "refused");
  await expect(rowBanner).toContainText("this deployment answered 404");
  await expect(rowBanner).toContainText("ASKED under the definition this page IS showing");
  await expect(rowBanner).toContainText("every covered cell reads UNANSWERED");
  await expect(rowBanner).toContainText("EARLIER response this surface REFUSES to present");
  await expect(rowBanner).not.toContainText("The cells still show what this row already measured");
  await expect(rowBanner).not.toContainText("names that refusal in its own words");
  await expect(rowBanner).not.toContainText("no longer showing");

  // THE DETAIL PANEL SAYS THE SAME THING, from the same read.
  const detail = page.getByTestId("runbook-current-bodyless");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("this row's CURRENT attempt served no book");
  await expect(detail).toContainText("(DEFINITION CHANGED)");
  await expect(detail).not.toContainText("Re-open or refresh the listing");
  const detailBanner = page.getByTestId("rerun-failed");
  await expect(detailBanner).toHaveAttribute("data-settlement", "current-bodyless");
  await expect(detailBanner).toHaveAttribute("data-attempt-changed", "false");
  await expect(detailBanner).toHaveAttribute("data-retained", "refused");
  await expect(detailBanner).toContainText("the panel below reads UNANSWERED");
  await expect(detailBanner).not.toContainText("The result below");
  // The retained book is rendered NOWHERE as a body of its own: not its
  // aggregates, and not R12's own refusal view with R12's own refresh remedy —
  // which is the view this panel used to hand the whole finding over to.
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("runbook-definition-changed")).toHaveCount(0);
  // Nor R14's attempt view, nor the raw 404 register, nor the in-flight line.
  await expect(page.getByTestId("runbook-attempt-changed")).toHaveCount(0);
  await expect(page.getByTestId("runbook-not-served")).toHaveCount(0);
  await expect(page.getByTestId("book-running")).toHaveCount(0);

  // THE LEGEND, which is on screen the whole time and must cover both registers
  // this row has passed through without carrying one case's words for another.
  const legend = page.getByTestId("matrix-legend");
  await expect(legend).toContainText("UNANSWERED = neither a result nor a refusal reached");
  await expect(legend).toContainText("the run ended without a book");
  await expect(page.getByTestId("matrix-legend-dc-response")).toContainText(
    "refresh the listing to run against the current one",
  );

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(rowBanner).toHaveAttribute("data-settlement", "current-bodyless");
  await expect(weethDm).toHaveAttribute("data-cell-state", "unanswered");
  await expect(weethRefresh).toHaveCount(0);
});
