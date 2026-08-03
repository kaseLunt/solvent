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
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_AAVE_PAGE_2 } from "../fixtures/book";

const API = "http://localhost:8080";
const CORS = { "access-control-allow-origin": "*" };

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function fulfillRaw(route: Route, body: string, status = 200): Promise<void> {
  return route.fulfill({ status, headers: CORS, contentType: "application/json", body });
}

// ===========================================================================
// (1) HIGH — an honored `hf` link, over a book where the two DESC orderings
//            visibly disagree.
// ===========================================================================

/**
 * DERIVED AAVE ROWS. The disagreement this fixture exists to show is the one
 * W-HR-C created ON PURPOSE (internal/store/p5_positions_page.go):
 *
 *   hf DESC        `(status='refused') DESC, hf_infinite DESC,
 *                   hf_wad DESC NULLS FIRST, account ASC`
 *                  → the plain reversal: REFUSED ROWS LEAD.
 *   headroom DESC  `(status='refused') ASC, hf_infinite DESC,
 *                   hf_wad DESC NULLS LAST, account ASC`
 *                  → only the known-value axis reverses: UNKNOWNS SINK, because
 *                    "greatest headroom first" must not be answered with
 *                    accounts the service could not value at all.
 *
 * So a REFUSED row is exactly the witness: hf-desc leads with it and
 * headroom-desc puts it last. Two computed rows either side of it make the
 * value axis visible too.
 *
 *   HIGH   hf wad 4.00e18 → headroom (4−1)/4 = 75%   (far from the boundary)
 *   LOW    hf wad 1.08e18 → headroom (1.08−1)/1.08 = 7.4%
 *
 * Every other byte is the committed fixture's canonical Aave row.
 */
function aaveComputedRow(account: string, hfWad: string) {
  const canonical = POSITIONS_AAVE_PAGE_1.positions[0];
  if (canonical === undefined) throw new Error("fixture shape drifted");
  const row = structuredClone(canonical);
  row.account = account;
  row.status = "computed";
  row.refusal = null;
  // The Aave row's `health_factor.wad` is the pool's OWN comparator and is what
  // the Headroom cell reads. If the canonical row ever stops publishing one,
  // this fixture is describing a row the service no longer serves and should
  // fail here rather than quietly produce a book with no ratios in it.
  const hf = row.health_factor;
  if (hf === null) throw new Error("fixture shape drifted: the aave row lost its health_factor");
  hf.wad = hfWad;
  hf.num = hfWad;
  hf.den = "1000000000000000000";
  hf.infinite = false;
  // Neither row is past its boundary: this test is about ORDER, not verdicts.
  row.liquidatable = false;
  return row;
}

/** The committed REFUSED aave row (G1), verbatim — the ordering's witness. */
function aaveRefusedRow() {
  const canonical = POSITIONS_AAVE_PAGE_2.positions[0];
  if (canonical === undefined) throw new Error("fixture shape drifted");
  const row = structuredClone(canonical);
  if (row.status !== "refused") throw new Error("fixture shape drifted: page 2 row is not refused");
  return row;
}

const HIGH = "0xAAaA000000000000000000000000000000000011";
const LOW = "0xAAaA000000000000000000000000000000000012";

/** The page the SERVICE serves for a given (sort, dir) — the real orderings. */
function aavePage(sort: string | null, dir: string | null) {
  const page = structuredClone(POSITIONS_AAVE_PAGE_1);
  const high = aaveComputedRow(HIGH, "4000000000000000000");
  const low = aaveComputedRow(LOW, "1080000000000000000");
  const refused = aaveRefusedRow();
  const descending = dir === "desc";
  page.sort = sort === "hf" ? "hf" : "headroom";
  page.positions =
    sort === "hf"
      ? descending
        ? [refused, high, low] // hf desc: refusals FIRST, then highest wad
        : [low, high, refused] // hf asc: closest to the boundary first
      : descending
        ? [high, low, refused] // headroom desc: unknowns LAST
        : [low, high, refused]; // headroom asc: least headroom first
  page.total_positions = 3;
  page.next_cursor = null;
  return page;
}

test("(1) A LEGACY ?sort=hf&dir=desc LINK: the direction survives, and the page SAYS what it applied", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const sort = url.searchParams.get("sort");
    const dir = url.searchParams.get("dir");
    // TABLE requests only: the map's full-book walk sends no sort at all.
    if (sort !== null) asked.push(`${sort}|${String(dir)}`);
    return fulfillJson(route, aavePage(sort, dir));
  });

  await page.goto("/book?engine=aave_v3_etherfi&sort=hf&dir=desc");

  // THE REQUEST CARRIES THE LINK'S OWN KEY *AND* ITS OWN DIRECTION. Under the
  // old normalizer every one of these was `headroom|null` — the alias rewrote
  // the key before the first fetch, which orphaned the dir, so the reader was
  // served the far end of the book from the one they had bookmarked.
  await expect.poll(() => asked).toContain("hf|desc");
  expect(asked).not.toContain("headroom|null");
  expect(asked.every((entry) => entry === "hf|desc")).toBe(true);

  // AND THE ROWS ARE IN THAT ORDER: hf descending. The REFUSED row LEADS —
  // `hf` desc is the plain reversal, so the refused axis flips with everything
  // else. Under the Headroom column's own reversal that same row sinks to the
  // bottom, which is exactly why the two are not one ordering.
  const positions = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  const rows = positions.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("REFUSED · G1");
  await expect(rows.nth(1)).toContainText("75%");
  await expect(rows.nth(2)).toContainText("7.4%");

  // THE REGISTER NAMES WHAT IS APPLIED, in reader words rather than a wire
  // token, WITH ITS DIRECTION — the half of the link the old alias threw away.
  const register = page.getByTestId("legacy-sort-register");
  await expect(register).toContainText("health factor, highest first");
  await expect(register).toContainText("deprecated");
  await expect(register).toContainText("no column header claims this order");
  // NOTHING WAS REMAPPED, so the remap acknowledgment is not borrowed for this.
  await expect(page.getByTestId("sort-remap-ack")).toHaveCount(0);

  // THE FOOTER NAMES IT TOO, with its direction glyph.
  await expect(page.getByTestId("positions-accounting")).toContainText(
    "sort hf (health factor) ▼",
  );

  // AND NO COLUMN HEADER CLAIMS THIS ORDER. The Headroom header is still a
  // button — clicking it is how the reader leaves — but it carries no aria-sort
  // and no glyph, because the rows are not ranked by the number under it.
  await expect(positions.locator("thead [aria-sort]")).toHaveCount(0);
  await expect(positions.locator("thead")).not.toContainText("▲");
  await expect(positions.locator("thead")).not.toContainText("▼");
  // The Aave Health factor column has no sort control at all (W-HR-A), so it
  // cannot claim the order either — which is the register's stated reason.
  await expect(positions.getByRole("button", { name: "Health factor" })).toHaveCount(0);

  // THE URL IS NOT REWRITTEN: it keeps saying what the table is doing, which is
  // only honest because the table is doing what it says. Both params survive.
  expect(new URL(page.url()).searchParams.get("sort")).toBe("hf");
  expect(new URL(page.url()).searchParams.get("dir")).toBe("desc");

  // ---- ONE CLICK LEAVES IT ------------------------------------------------
  await positions.getByRole("button", { name: "Headroom" }).click();

  // The table asks for the column's own key, in the column's own canonical
  // direction (a column switch resets to canonical — the two-state cycle).
  await expect.poll(() => asked).toContain("headroom|null");
  // ...the rows arrive in the RATIO order, least headroom first, refused last...
  await expect(rows.nth(0)).toContainText("7.4%");
  await expect(rows.nth(1)).toContainText("75%");
  await expect(rows.nth(2)).toContainText("REFUSED · G1");
  // ...the header now carries the indicator it had refused to carry...
  await expect(
    positions.getByRole("columnheader", { name: "Headroom" }),
  ).toHaveAttribute("aria-sort", "ascending");
  // ...the register is gone, because the ranking it described is gone...
  await expect(page.getByTestId("legacy-sort-register")).toHaveCount(0);
  await expect(page.getByTestId("positions-accounting")).toContainText("sort headroom ▲");
  // ...and THE URL FOLLOWED THE CONTROL. `headroom` is the default sort and
  // canonical is the default direction, so both params are simply gone: the UI
  // honors these links and never mints a new one. The non-default ENGINE stays.
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get("dir")).toBeNull();
  expect(new URL(page.url()).searchParams.get("engine")).toBe("aave_v3_etherfi");
});

test("(1) an ENGINE toggle to the DM REMAPS the honored hf ranking — the API refuses that pair", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    const sort = url.searchParams.get("sort");
    if (sort !== null) asked.push(`${String(engine)}:${sort}`);
    if (engine === "debt_manager") {
      // The DM never serves `hf` — a request for it would be a 400. If one ever
      // reaches here the assertions below fail on the recorded pair, loudly.
      const dm = structuredClone(POSITIONS_AAVE_PAGE_1);
      dm.engine = "debt_manager";
      dm.positions = [];
      dm.total_positions = 0;
      dm.next_cursor = null;
      return fulfillJson(route, dm);
    }
    return fulfillJson(route, aavePage(sort, url.searchParams.get("dir")));
  });

  await page.goto("/book?engine=aave_v3_etherfi&sort=hf&dir=desc");
  await expect(page.getByTestId("legacy-sort-register")).toBeVisible();

  // `hf` is the ONE honored ranking an engine toggle can strand: the Debt
  // Manager publishes a strict liquidatable boolean, not a health factor, so
  // there is no ordering there to carry across. It gets the existing remap and
  // the existing acknowledgment — not silence, and not a doomed request.
  await page.getByRole("button", { name: "debt_manager", exact: true }).click();
  await expect(page.getByTestId("sort-remap-ack")).toBeVisible();
  await expect(page.getByTestId("sort-remap-ack")).toContainText(
    'sort "hf" is not defined for debt_manager — reset to headroom',
  );
  await expect(page.getByTestId("legacy-sort-register")).toHaveCount(0);
  await expect.poll(() => asked).toContain("debt_manager:headroom");
  expect(asked.filter((entry) => entry === "debt_manager:hf")).toHaveLength(0);
});

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

  // THE HEADER'S SINGLE-BATCH SENTENCE STAYS TRUE, and it discloses the run in
  // flight rather than letting the reader wonder whether the batch moved.
  await expect(batchLine).toContainText("measured at batch #2");
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
