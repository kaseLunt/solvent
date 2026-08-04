// WAVE R14 (Codex round-22) e2e — pinned in the browser against the production
// build with the API mocked from committed fixtures.
//
// FINDING 1 (MEDIUM). R13 restricted the cohort to the rows the table RENDERS by
// filtering `phases` through the current listing, and that filter is keyed — as
// the map itself is — BY SCENARIO ID ALONE. A row that leaves the listing is
// dropped; a row that comes BACK is re-admitted on the strength of its id,
// whatever the definition behind it has become. A `kind: "ok"` outcome defends
// itself, because the RESPONSE publishes `scenario_id` + `scenario_version` +
// `scenario_config_version` and R12's guard reads them. A RUNNING phase and a
// NON-OK outcome publish NOTHING. So a v1 run that failed walked back onto a
// re-listed v2 row as RUNNING or UNANSWERED, and the header counted the v2 row
// among the rows this session ASKED ABOUT — though v2 was never asked anything.
//
// FINDING 2 (MEDIUM). R13b's detail banner promises, over a retained all-hole
// book, that "the outcome below says so in its own words". The outcome below was
// the generic `BookResult`, which for an empty `excluded_engines[]` printed
// "excluded engines: none · every engine's book reached the run" — over a book
// that reached NO engine. Two mutually exclusive statements on one screen. And
// the same gate produced the same false sentence for a PARTIAL hole: the
// condition was `excluded_engines.length === 0`, which is not the claim.
//
// THE LAW THIS FILE ENFORCES, extending R10-R13b's: THE HEADER, THE CELLS, THE
// BANNERS AND THE DETAIL MAY NEVER CONTRADICT EACH OTHER — and a book that
// measured nothing is never called a measurement, in the panel any more than in
// the banner.
//
//   (A) DELIST → RE-LIST AT v2   a failed v1 run is stored, its row is dropped,
//                                and the row returns RE-CUT. It reads DEFINITION
//                                CHANGED, the header does not count it attempted,
//                                and re-running it at v2 works cleanly.
//   (B) THE ALL-HOLE DETAIL      a retained all-hole book under a failed re-run:
//                                banner, cells and detail give ONE account, and
//                                no completeness claim appears on that screen.
//   (C) THE PARTIAL HOLE         one covered engine served, the other named in
//                                neither array: the completeness line is not
//                                said, and the hole is named instead.

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

/**
 * The completeness sentence, VERBATIM AND WHOLE — the one this wave gates.
 *
 * It is asserted in full rather than by its tail on purpose. The frontier above
 * makes its own, separate claim about `/v1/book`'s grid ("…reached this grid"),
 * and the hole disclosure this wave adds must never print the claim as the first
 * half of its own negation — an absence assertion could not tell those apart.
 */
const COMPLETENESS = "excluded engines: none · every engine's book reached the run";

// ===========================================================================
// (A) The row that was delisted and then republished, re-cut.
// ===========================================================================

/**
 * THE VEHICLE, and why it is this one. A listing refresh that KEEPS component
 * state is reachable through exactly one affordance on this surface: the
 * `refresh listing` button R12 put on a DEFINITION CHANGED row. `ethfi_minus_50`
 * supplies it — its stored answer is v2 against a v1 listing throughout — and
 * that row is also the CONTROL for this wave, because it is the half of the
 * definition-changed set whose remedy is still a refresh.
 *
 * The listing route is driven by the test rather than by a call count: three
 * deployments in sequence, each serving a listing the contract permits.
 *
 *   scenarios.json           v1: the row is listed
 *   scenarios.removed.json   the deployment stops publishing it (R13's fixture)
 *   scenarios.relisted.json  it comes back, at version v2, with the set's own
 *                            `scenario_config_version` still v1 so every OTHER
 *                            row is untouched and the returning row is the only
 *                            anomaly on the table
 */
async function relistHarness(
  page: Page,
  listing: () => string,
  weethBody: () => string | null,
): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture(listing())));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => {
    const url = route.request().url();
    if (url.includes("/ethfi_minus_50/")) {
      return fulfillRaw(route, fixture("run-book.ethfi_minus_50.v2.json"));
    }
    if (url.includes("/weeth_market_depeg_oracles_held/")) {
      const body = weethBody();
      // A 404 is the honest "this deployment does not serve run-book" outcome —
      // and, for this finding, a run that came back carrying NO identity at all.
      return body === null
        ? fulfillRaw(route, fixture("error-not-found.json"), 404)
        : fulfillRaw(route, fixture(body));
    }
    throw new Error(`the harness has no run-book body for ${url}`);
  });
  await page.goto("/lab");
}

test("(A) A FAILED v1 RUN ON A ROW RE-LISTED AT v2 reads DEFINITION CHANGED, and is not counted attempted", async ({
  page,
}) => {
  let listing = "scenarios.json";
  let weeth: string | null = null; // the first run 404s
  await relistHarness(
    page,
    () => listing,
    () => weeth,
  );

  const batchLine = page.getByTestId("matrix-batch-line");
  const weethAave = page.locator(`${WEETH_ROW} td`).nth(1);
  const weethDm = page.locator(`${WEETH_ROW} td`).nth(2);

  await page.locator(WEETH_CHIP).click();

  // ---- THE v1 RUN FAILS. It is an attempt, and it is counted as one. -------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethAave).toHaveAttribute("data-cell-state", "unanswered");
  await expect(weethDm).toContainText("about the DEPLOYMENT");
  await expect(batchLine).toContainText("1 run(s) ended without a served result");
  await expect(page.getByTestId("runbook-not-served")).toBeVisible();

  // ---- THE REFRESH AFFORDANCE, EARNED HONESTLY on the OTHER row -----------
  await page.locator(`${ETHFI_ROW} [data-testid="matrix-run"]`).click();
  await expect(page.locator(`${ETHFI_ROW} td`).nth(2)).toHaveAttribute(
    "data-cell-state",
    "definition-changed",
  );
  const refresh = page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`);
  await expect(refresh).toBeVisible();

  // ---- DEPLOYMENT 2: THE ROW IS DROPPED. R13: it is simply not there. -----
  listing = "scenarios.removed.json";
  await refresh.click();
  await expect(page.locator(WEETH_ROW)).toHaveCount(0);
  await expect(batchLine).not.toContainText("ended without a served result");

  // ---- DEPLOYMENT 3: IT COMES BACK, RE-CUT AT v2 — the finding. -----------
  listing = "scenarios.relisted.json";
  await refresh.click();
  await expect(page.locator(WEETH_ROW)).toHaveCount(1);
  await expect(page.locator(WEETH_ROW)).toContainText("weeth_market_depeg_oracles_held · v2");

  // THE ASSERTION THE FINDING IS ABOUT. The stored phase is a v1 failure with no
  // body and therefore no identity of its own; re-admitted by id alone it
  // rendered UNANSWERED here, on a definition that was never asked anything.
  for (const cell of [weethAave, weethDm]) {
    await expect(cell).toHaveAttribute("data-cell-state", "definition-changed");
    await expect(cell).toContainText("DEFINITION CHANGED");
    await expect(cell).toContainText(
      "this attempt belongs to a definition this page is no longer showing",
    );
    await expect(cell).toContainText("scenario_version disagree");
    await expect(cell).toContainText(
      "The run was DISPATCHED against weeth_market_depeg_oracles_held v1 at " +
        "scenario_config_version v1",
    );
    // NEVER the pre-R14 readings, and never R12's ANSWER wording either.
    await expect(cell).not.toContainText("UNANSWERED");
    await expect(cell).not.toContainText("about the DEPLOYMENT");
    await expect(cell).not.toContainText("this scenario's committed definition changed");
  }
  await expect(
    page.locator('[data-testid="matrix-cell"][data-cell-state="unanswered"]'),
  ).toHaveCount(0);

  // THE HEADER DOES NOT COUNT IT ATTEMPTED, and names it for what it is. The
  // two halves of the definition-changed set are counted and worded separately,
  // because a listing refresh resolves one of them and only a re-run resolves
  // the other.
  await expect(batchLine).not.toContainText("ended without a served result");
  await expect(batchLine).not.toContainText("run(s) are in flight");
  await expect(batchLine).not.toContainText("no run has been issued yet");
  await expect(batchLine).toContainText(
    "1 run(s) answered for a committed definition this page is no longer showing. Refresh the " +
      "listing to run against the current one",
  );
  await expect(batchLine).toContainText(
    "1 run(s) were ASKED under a committed definition this page is no longer showing and never " +
      "came back with a book of their own, so re-run to ask under the current one",
  );

  // THE ROW'S AFFORDANCE IS THE OTHER ONE. Sending the reader to re-read a
  // listing that is already current would be a dead end.
  const attemptNote = page.locator(`${WEETH_ROW} [data-testid="matrix-attempt-changed"]`);
  await expect(attemptNote).toBeVisible();
  await expect(attemptNote).toHaveAttribute("data-in-flight", "false");
  await expect(attemptNote).toContainText("A listing refresh resolves nothing");
  await expect(attemptNote).toContainText("Run this row again");
  await expect(page.locator(`${WEETH_ROW} [data-testid="matrix-refresh-listing"]`)).toHaveCount(0);
  // …while the ANSWER half keeps R12's refresh button, verbatim.
  await expect(page.locator(`${ETHFI_ROW} [data-testid="matrix-refresh-listing"]`)).toBeVisible();

  // AND THE DETAIL PANEL AGREES. It used to render "book-wide stress not yet
  // served by this deployment" under a row reading DEFINITION CHANGED.
  await page.locator(WEETH_CHIP).click();
  const detail = page.getByTestId("runbook-attempt-changed");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("it was asked under another committed definition");
  await expect(detail).toContainText("nothing here for a listing refresh to make readable");
  await expect(page.getByTestId("runbook-not-served")).toHaveCount(0);
  await expect(page.getByTestId("book-result")).toHaveCount(0);

  // ---- AND RE-RUNNING IT AT v2 WORKS CLEANLY ------------------------------
  weeth = "run-book.weeth.v2.json"; // what the third deployment answers
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(weethDm).toHaveAttribute("data-cell-state", "result");
  await expect(weethAave).toHaveAttribute("data-cell-state", "result");
  await expect(page.locator(`${WEETH_ROW} [data-testid="matrix-attempt-changed"]`)).toHaveCount(0);
  await expect(batchLine).toContainText("results shown together were measured at batch #1.");
  await expect(batchLine).not.toContainText("were ASKED under a COMMITTED DEFINITION");
  // The detail panel renders the real book, completeness claim and all — the
  // v2 definition covers both engines and this book named both.
  await expect(page.getByTestId("book-result")).toBeVisible();
  await expect(page.getByTestId("book-excluded")).toContainText(COMPLETENESS);
  await expect(page.getByTestId("runbook-attempt-changed")).toHaveCount(0);

  // Rows nobody asked about are untouched throughout.
  await expect(page.locator(`${ETH_ROW} td`).nth(2)).toHaveAttribute("data-cell-state", "not-run");

  // Re-asserted after the assertions above have burned real time: the settled
  // state, not a frame between two renders.
  await expect(weethDm).toHaveAttribute("data-cell-state", "result");
});

// ===========================================================================
// (B) The retained all-hole book, under a failed re-run.
// ===========================================================================

/**
 * Each scenario answers its FIRST run from `first[id]` and every later run with
 * a 503 — R8's sequence, which gives the held outcome back at its original pin
 * with the failure disclosed beside it.
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

test("(B) A RETAINED ALL-HOLE BOOK: banner, cells and detail give ONE account, with no completeness claim", async ({
  page,
}) => {
  await rerunFailureHarness(page, {
    weeth_market_depeg_oracles_held: "run-book.names-nobody.json",
  });

  const batchLine = page.getByTestId("matrix-batch-line");
  const aaveCell = page.locator(`${WEETH_ROW} td`).nth(1);
  const dmCell = page.locator(`${WEETH_ROW} td`).nth(2);
  const rowBanner = page.locator(`${WEETH_ROW} [data-testid="matrix-rerun-failed"]`);
  const detailBanner = page.getByTestId("rerun-failed");

  await page.locator(WEETH_CHIP).click();

  // ---- THE FIRST RUN: a 200 that names nobody -----------------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(dmCell).toHaveAttribute("data-cell-state", "unanswered");

  // THE PANEL SAYS WHAT THE CELLS SAY. It used to render the whole aggregate
  // frame, ending in "excluded engines: none — every engine's book reached the
  // run", over a book that reached NO engine at all.
  const allHole = page.getByTestId("runbook-all-hole");
  await expect(allHole).toBeVisible();
  await expect(allHole).toContainText("a served book, but not a served result");
  await expect(allHole).toContainText(
    "this book named none of the engines this scenario's committed definition covers",
  );
  await expect(allHole).toContainText(
    "aave_v3_etherfi and debt_manager are named in neither engines[] nor excluded_engines[], so " +
      "every covered cell of this row reads UNANSWERED",
  );
  await expect(allHole).toContainText("the book arrived and named nobody");
  await expect(allHole).toContainText("It was measured at batch #1");
  await expect(allHole).toContainText(
    "no aggregate, no delta and no completeness claim from it",
  );
  await expect(page.getByTestId("book-result")).toHaveCount(0);
  await expect(page.getByTestId("book-engine")).toHaveCount(0);
  await expect(page.getByTestId("book-excluded")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(COMPLETENESS);

  // ---- THE RE-RUN FAILS: R8 gives the all-hole book back -------------------
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();
  await expect(rowBanner).toBeVisible();

  for (const banner of [rowBanner, detailBanner]) {
    await expect(banner).toHaveAttribute("data-retained", "all-hole");
    // R13b's assertions, unchanged — the failure is named, the retained book is
    // never called a result, and nothing was overwritten.
    await expect(banner).toContainText("no servable batch (503)");
    await expect(banner).toContainText("What this row still holds is NOT a result");
    await expect(banner).toContainText(
      "named none of the engines this row's committed definition covers",
    );
    await expect(banner).toContainText("Nothing was overwritten");
    await expect(banner).not.toContainText("The cells still show what this row already measured");
    await expect(banner).not.toContainText("The result below");
  }

  // THE FINDING. R13b's detail banner promises the outcome below says so in its
  // own words — and now it does. Both halves of that composition are asserted
  // TOGETHER, in one rendered state, because the defect was the ADJACENCY.
  await expect(detailBanner).toContainText("the outcome below says so in its own words");
  await expect(allHole).toBeVisible();
  await expect(allHole).toContainText("named none of the engines");
  // …and the sentence that contradicted it is nowhere on the screen.
  await expect(page.locator("body")).not.toContainText(COMPLETENESS);
  await expect(page.getByTestId("book-excluded")).toHaveCount(0);

  // THE HEADER GIVES THE SAME ACCOUNT — a served book, not a served result, and
  // never a run that ended without one.
  await expect(batchLine).toContainText(
    "1 run(s) were served a book that named none of the row's covered engines: a served book, " +
      "but not a served result",
  );
  await expect(batchLine).not.toContainText("results shown together");
  await expect(batchLine).not.toContainText("ended without a served result");

  // Re-asserted after real time on the page: the settled state.
  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(page.locator("body")).not.toContainText(COMPLETENESS);
});

// ===========================================================================
// (C) The partial hole — the same gate, one engine short of the limit.
// ===========================================================================

test("(C) A PARTIAL HOLE makes no completeness claim, and names the engine that reached nothing", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) => fulfillRaw(route, fixture("scenarios.json")));
  await page.route(`${API}/v1/book`, (route) => fulfillRaw(route, fixture("book.json")));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    // debt_manager served, aave_v3_etherfi in NEITHER array, nothing refused.
    fulfillRaw(route, fixture("run-book.partial-hole.json")),
  );
  await page.goto("/lab");

  const aaveCell = page.locator(`${WEETH_ROW} td`).nth(1);
  const dmCell = page.locator(`${WEETH_ROW} td`).nth(2);

  await page.locator(WEETH_CHIP).click();
  await page.locator(`${WEETH_ROW} [data-testid="matrix-run"]`).click();

  // THE CELLS: one real result, one hole. The row DISPLAYS something, so it is
  // not the all-hole state and it pins its batch exactly as it should.
  await expect(dmCell).toHaveAttribute("data-cell-state", "result");
  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
  await expect(aaveCell).toContainText("neither a result nor a refusal");
  await expect(page.getByTestId("matrix-batch-line")).toContainText(
    "results shown together were measured at batch #1.",
  );

  // THE PANEL RENDERS THE BOOK — this is a served result — but makes no claim it
  // cannot support. `excluded_engines` is empty here, which was the WHOLE
  // condition the completeness line used to be gated on.
  await expect(page.getByTestId("book-result")).toBeVisible();
  await expect(page.getByTestId("book-engine")).toHaveCount(1);
  await expect(page.getByTestId("runbook-all-hole")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(COMPLETENESS);

  // AND THE HOLE IS NAMED, in the cells' own vocabulary.
  const hole = page.getByTestId("book-hole");
  await expect(hole).toBeVisible();
  await expect(hole).toContainText("AN INCOMPLETE BOOK");
  await expect(hole).toContainText(
    "this run returned neither a result nor a refusal for aave_v3_etherfi, an engine this " +
      "scenario's committed definition covers",
  );
  await expect(hole).toContainText("will not fill a hole with a zero");
  await expect(hole).toContainText("1 of the 2 covered engine(s) reached this run");
  await expect(hole).toContainText("those cells read UNANSWERED in the matrix above");
  // It is a HOLE, not a refusal: no refusal register is rendered for it.
  await expect(hole).not.toContainText("FLAG_");
  await expect(page.getByTestId("matrix-cell").and(page.locator('[data-cell-state="withheld"]'))).toHaveCount(
    0,
  );

  await expect(aaveCell).toHaveAttribute("data-cell-state", "unanswered");
});
