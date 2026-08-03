// WAVE R16 (Codex round-24) e2e — pinned in the browser against the production
// build with the API mocked from committed fixtures.
//
// THE FINDING (MEDIUM). R8 rules that a re-run which ends without a book gives
// the held outcome BACK: the retained body occupies `outcome`, the failure is
// named beside it. R14 rules that a phase with no body of its own is judged by
// the identity it was DISPATCHED under — and that `attemptSkew` answers null for
// every `kind: "ok"` outcome, because a served body is the server's own word
// about what it computed.
//
// Put both rules on ONE phase and the second reads the first's evidence as its
// own. After a BODYLESS settlement over a retained ok book the phase holds an
// EARLIER request's body beside THIS request's failure, and `attemptSkew` saw
// `outcome.kind === "ok"` and deferred to a body the settled request never
// produced. So the row never entered `settledAttemptScenarioIds`: the header
// took R12's ANSWER arm over it — "Nothing failed and nothing was withheld",
// refresh the listing — while the banner one line below said the re-run had
// ended without a book, and the cell sent the reader to refresh a listing that
// was already current. R15's fixtures all begin from a row holding NO evidence,
// so this settle shape was never exercised in a browser at all.
//
// THE LAW THIS FILE ENFORCES, extending R10-R15's: THE HEADER, THE CELLS, THE
// BANNERS, THE LEGEND AND THE DETAIL MAY NEVER CONTRADICT EACH OTHER; no surface
// may direct a reader to a control the row has disabled; and A RETAINED BOOK IS
// DISPLAYED OR DISCLOSED, BUT NEVER MISTAKEN FOR THE SETTLED REQUEST'S ANSWER.
//
// THE SEQUENCE, which is the finding's own:
//
//   1. run eth_minus_30      a clean result at batch #1, so the header takes its
//                            ANCHORED arm throughout
//   2. run ethfi_minus_50    a v2 answer against a v1 listing — R12's ANSWER
//                            half, the CONTROL, and the only affordance on this
//                            surface that refreshes the listing in place
//   3. run weeth…            a REAL v1 book at batch #1 — the held evidence the
//                            whole finding turns on, which R15 never had
//   4. re-run weeth…         and the mock HOLDS THE REQUEST OPEN
//   5. refresh to v2         re-cut mid-flight: a RUNNING skewed attempt that is
//                            also HOLDING an ok book (R15's state, R16's shape)
//   6. release it, bodyless  a 404 settles it — the retained book comes back
//                            (R8) and the settlement must still be read as the
//                            attempt it was

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

test("R16 — A BODYLESS SETTLEMENT OVER A RETAINED BOOK IS READ AS THE ATTEMPT IT WAS, NOT AS THE BOOK IT KEPT", async ({
  page,
}) => {
  let listing = "scenarios.json";
  // The weeth row is run TWICE. The first call answers with a real book — that
  // is the held evidence R15 never had — and the second parks on this gate, so
  // the browser has a genuinely in-flight fetch over a row that is already
  // displaying a result.
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
  const refresh = page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`);
  await expect(refresh).toBeVisible();

  // ---- 3. THE WEETH ROW MEASURES SOMETHING. This is the held evidence. ------
  await page.locator(WEETH_CHIP).click();
  await weethRun.click();
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "result");
  }
  await expect(batchLine).toContainText("Every DISPLAYED result was measured at that batch.");

  // ---- 4. THE RE-RUN IS DISPATCHED, AND THE MOCK HOLDS IT -------------------
  await weethRun.click();
  await expect(weethDm).toHaveAttribute("data-cell-state", "running");
  await expect(batchLine).toContainText("row(s) have a run in flight");

  // ---- 5. THE LISTING MOVES TO v2 WHILE THE REQUEST IS STILL OUT ------------
  listing = "scenarios.relisted.json";
  await refresh.click();
  await expect(page.locator(WEETH_ROW)).toContainText("weeth_market_depeg_oracles_held · v2");

  // R15's state, now reached over a row that IS holding an ok book. Everything
  // R15 pinned still holds — the held body has never been consulted for the
  // identity question, and is not now.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("The request is still out");
  }
  await expect(rowNote).toHaveAttribute("data-in-flight", "true");
  await expect(weethRun).toBeDisabled();
  await expect(batchLine).toContainText("their request is STILL OUT");
  // Nothing has settled, so nothing is disclosed as a failure yet.
  await expect(rowBanner).toHaveCount(0);

  // THE LEGEND (finding 2), at the moment it used to contradict every surface
  // above it: a caption saying the run "never came back … re-run the row",
  // printed under a row whose note says the request is still out and whose run
  // control is disabled.
  const legendRunning = page.getByTestId("matrix-legend-dc-running");
  await expect(legendRunning).toContainText("its request is STILL OUT");
  await expect(legendRunning).toContainText("nothing to do here until it settles");
  await expect(legendRunning).not.toContainText("never came back");
  await expect(legendRunning).not.toContainText("re-run");
  await expect(page.getByTestId("matrix-legend-dc-response")).toContainText(
    "refresh the listing to run against the current one",
  );
  await expect(page.getByTestId("matrix-legend-dc-settled")).toContainText(
    "never came back with a book of its own",
  );

  // ---- 6. THE REQUEST SETTLES, BODYLESS. THE FINDING. ----------------------
  releaseWeeth();

  // THE HEADER. Pre-R16 this row rejoined R12's ANSWER half — the count read
  // TWO, both remedies were "refresh the listing", and the settled-attempt
  // sentence was never printed at all.
  await expect(batchLine).toContainText(
    "1 row(s) were ASKED under a COMMITTED DEFINITION this page is no longer showing and never " +
      "came back with a book of their own",
  );
  await expect(batchLine).toContainText("Re-run the row to ask under the current definition");
  await expect(batchLine).toContainText("a listing refresh resolves nothing here");
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
  // The still-out sentence is gone — it was true and is no longer — and the row
  // is counted as this table's run in none of R14's three tenses.
  await expect(batchLine).not.toContainText("their request is STILL OUT");
  await expect(batchLine).not.toContainText("row(s) have a run in flight");
  await expect(batchLine).not.toContainText("ended without a served result");
  // The clean row is untouched by the whole sequence.
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");

  // THE CELLS, in the same register with the settled remedy — and never the
  // retained book's numbers, which belong to a request this one is not.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("Re-run this row to ask under the definition");
    await expect(cell).not.toContainText("The request is still out");
    await expect(cell).not.toContainText("Re-open or refresh the listing");
  }

  // THE ROW NOTE, and the control it points at — live, because the row is not
  // running any more.
  await expect(rowNote).toHaveAttribute("data-in-flight", "false");
  await expect(rowNote).toContainText("Run this row again to ask under the definition above.");
  await expect(weethRun).toBeEnabled();
  await expect(weethRun).toHaveText("run");
  // R12's refresh is NOT offered here: the listing is already the current one.
  await expect(page.locator(`${WEETH_ROW} [data-testid="matrix-refresh-listing"]`)).toHaveCount(0);

  // THE BANNER BESIDE THEM. R8's retained evidence is still disclosed, still
  // named by its own refusal register, and still never called a result — but it
  // no longer claims the cells speak for it, because they speak for the ATTEMPT.
  await expect(rowBanner).toBeVisible();
  await expect(rowBanner).toHaveAttribute("data-attempt-changed", "true");
  await expect(rowBanner).toHaveAttribute("data-retained", "refused");
  await expect(rowBanner).toContainText("this deployment answered 404");
  await expect(rowBanner).toContainText(
    "ASKED under a committed definition this page is no longer showing",
  );
  await expect(rowBanner).toContainText("EARLIER response this surface REFUSES to present");
  await expect(rowBanner).not.toContainText("The cells still show what this row already measured");
  await expect(rowBanner).not.toContainText("names that refusal in its own words");

  // THE DETAIL PANEL SAYS THE SAME THING, from the same reads.
  const detail = page.getByTestId("runbook-attempt-changed");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute("data-in-flight", "false");
  await expect(detail).toContainText("No book came back from it");
  await expect(detail).not.toContainText("The request is still out");
  const detailBanner = page.getByTestId("rerun-failed");
  await expect(detailBanner).toHaveAttribute("data-attempt-changed", "true");
  await expect(detailBanner).toHaveAttribute("data-retained", "refused");
  await expect(detailBanner).toContainText("the panel below reads DEFINITION CHANGED about it");
  await expect(detailBanner).not.toContainText("The result below");
  // The retained book is rendered NOWHERE as a body of its own: the panel below
  // belongs to the ATTEMPT, so neither the book's aggregates nor R12's OWN
  // refusal view for it appears — one response, one register, from one gate.
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("runbook-definition-changed")).toHaveCount(0);
  // Nor the raw 404 register the settlement would otherwise have printed.
  await expect(page.getByTestId("runbook-not-served")).toHaveCount(0);
  await expect(page.getByTestId("book-running")).toHaveCount(0);

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(rowNote).toHaveAttribute("data-in-flight", "false");
  await expect(rowBanner).toHaveAttribute("data-attempt-changed", "true");
});
