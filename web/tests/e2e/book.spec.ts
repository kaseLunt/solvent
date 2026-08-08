// Book surface (W1) e2e — MOCKED API via route interception. Every body
// served here comes from tests/fixtures/book.ts (generated from the contract
// and the contract-validated client fixtures — see generate-book.mjs's
// provenance record; nothing hand-shaped).
//
// Asserted laws (task brief):
//   - stat rows render from the fixture, per engine, never combined;
//   - refused rows are VISIBLE inline with their named reason;
//   - a withheld engine's bad debt is an em dash + reason, never 0;
//   - histograms are per-engine, each on its own comparator, refused/∞ counts
//     beside the buckets;
//   - a waterfall monotonicity violation renders a warning strip naming the
//     offending grid point (and does NOT render when the series is monotone);
//   - 409 BATCH_SUPERSEDED shows a one-line notice and restarts from page one;
//   - the warn-band disclosure is present at table and legend level;
//   - Lab sits in the PRIMARY nav register;
//   - NO SERVABLE BATCH renders the refusal honestly, never a book of zeroes.

import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BATCH_SUPERSEDED,
  BOOK,
  BOOK_ENGINE_REFUSED,
  BOOK_ERROR_BAD_REQUEST,
  BOOK_ERROR_UNAVAILABLE,
  BOOK_MONOTONICITY_VIOLATION,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

/**
 * The acknowledgment copy, verbatim (W-UX-B part 9; destination amended by
 * W-HR-B because contract 1.5.0 moved it — the Headroom column now asks for
 * the wire's own `headroom` key, not `liq_distance`).
 */
const SORT_REMAP_ACK =
  'sort "hf" is not defined for debt_manager, so it was reset to headroom. The Debt ' +
  "Manager publishes a strict liquidatable boolean, not a health factor.";

const WARN_DISCLOSURE = "presentation band < 1.1, set for display and not by the engine";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The SSE stream is not under test here; the ribbon states its own truth. */
async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

async function mockBook(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route("**/v1/book", (route) => fulfillJson(route, body, status));
}

/** Default positions routing: aave pages 1→2, the DM page, cursor-aware. */
async function mockPositions(page: Page): Promise<void> {
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    const cursor = url.searchParams.get("cursor");
    if (engine === "debt_manager") return fulfillJson(route, POSITIONS_DM_PAGE_1);
    if (cursor === null) return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
}

/**
 * W-HR-A changed the DEFAULT ENGINE to debt_manager (owner directive). These
 * specs were written against the aave book and their fixtures are aave rows,
 * so they now name the engine explicitly rather than relying on a default
 * that moved. The deep-link default is asserted on its own, below.
 */
async function openBook(page: Page, path = "/book?engine=aave_v3_etherfi"): Promise<void> {
  await muteStream(page);
  await page.goto(path);
}

test("stat rows render from the fixture — one block per engine, never combined", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const aave = page.getByTestId("book-stats-aave_v3_etherfi");
  await expect(aave).toBeVisible();
  await expect(aave).toContainText("8,000"); // 800000000000 @ 8 dec, exact
  await expect(aave).toContainText("2 positions · 1 computed · 1 refused · 1 flagged");
  await expect(aave).toContainText("1/2 positions counted"); // the coverage denominator
  await expect(aave).toContainText("G1 ×1"); // refusals named, counted

  const dm = page.getByTestId("book-stats-debt_manager");
  await expect(dm).toBeVisible();
  await expect(dm).toContainText("4,200"); // 4200000000 @ 6 dec, exact
  await expect(dm).toContainText("SWEEP_NEVER ×1");

  // Engines stay separate: no blended total anywhere (8,000 + 4,200 = 12,200
  // must not exist on this page in any unit).
  await expect(page.locator("body")).not.toContainText("12,200");
});

test("refused position rows are visible inline with their named reason", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001"); // page 1: the computed row

  // Page 2 arrives via the walk-end sentinel (W-UX-C point 13) — the short
  // walk auto-fills without a click; LOAD MORE remains only as the fallback.
  // Its refused row is a ROW: visible, tinted, named — never filtered.
  await expect(table).toContainText("0xBbbb…0002");
  await expect(table).toContainText("REFUSED · G1");
  // Its totals are em dashes, never zeros.
  const refusedRow = table.getByRole("row").filter({ hasText: "0xBbbb…0002" });
  await expect(refusedRow).toContainText("—");
  await expect(refusedRow).not.toContainText("$0");
  await expect(page.getByText("end of pages")).toBeVisible();
  // The W-UX-C footer accounting: loaded / qualifying under the default dust
  // step, the hidden count (0 here — nothing below the step), the on-book
  // aggregate, and the sort with its canonical direction glyph.
  // W-HR-A: the ranked column is Headroom now, so the footer names it.
  await expect(page.getByTestId("positions-accounting")).toHaveText(
    "2 loaded of 2 qualifying (dust <$1) · 0 hidden below step · 2 on book · sort headroom ▲",
  );
});

test("the DEFAULT engine is debt_manager — the Book opens on the DM book", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await muteStream(page);
  await page.goto("/book");

  await expect(page.getByRole("table", { name: "positions for debt_manager" })).toBeVisible();
  await expect(page.getByRole("button", { name: "debt_manager" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The default is omitted from the URL — a default is not a state to mirror.
  await expect.poll(() => page.url()).not.toContain("engine=");
});

test("the DM engine page: crit only from the strict boolean; refused row named", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await page.getByRole("button", { name: "debt_manager" }).click();
  const table = page.getByRole("table", { name: "positions for debt_manager" });

  const critRow = table.getByRole("row").filter({ hasText: "0xccCc…0003" });
  // W-HR-A: the num/den DISCLOSURE column ("0.761") is struck — the same two
  // numbers now produce a reading instead of a disclaimer. The engine's own
  // sealed verdict still speaks its own word, and it is NOT the ratio's word:
  // `liquidatable` comes from the strict boolean, `breached` would come from
  // the ratio alone.
  await expect(critRow).not.toContainText("0.761");
  await expect(critRow).toContainText("liquidatable"); // the engine's own verdict
  await expect(critRow).toContainText("−31.3%"); // (3,200 − 4,200)/3,200, floored
  await expect(critRow).toContainText("S @154,796,500"); // the sweep mark

  const refusedRow = table.getByRole("row").filter({ hasText: "0xddDD…0004" });
  await expect(refusedRow).toContainText("REFUSED · SWEEP_NEVER");
  await expect(refusedRow).toContainText("S ∅"); // the absent sweep, visible
});

test("null bad debt renders an em dash with its reason — never 0", async ({ page }) => {
  await mockBook(page, BOOK_ENGINE_REFUSED);
  await mockPositions(page);
  await openBook(page);

  const withheld = page.getByTestId("bad-debt-aave_v3_etherfi");
  await expect(withheld).toContainText("—");
  await expect(withheld).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(withheld).not.toContainText("$0");

  // The served engine still shows its real census beside it.
  await expect(page.getByTestId("bad-debt-debt_manager")).toContainText("$239.603961");

  // The withheld engine is unmissable at the top of the surface too.
  await expect(page.getByTestId("book-refused-engines")).toContainText("aave_v3_etherfi");
  // Its stat block renders em dashes, not zeros.
  const aaveStats = page.getByTestId("book-stats-aave_v3_etherfi");
  await expect(aaveStats).toContainText("withheld, no number served");
});

test("HF histograms are per engine, each on its OWN comparator, counts beside buckets", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const aave = page.getByTestId("book-histogram-aave_v3_etherfi");
  const dm = page.getByTestId("book-histogram-debt_manager");
  await expect(aave).toBeVisible();
  await expect(dm).toBeVisible();
  await expect(aave).toContainText("comparator: hf_wad");
  await expect(dm).toContainText("comparator: hf_num/hf_den");
  // CX-6: refused / infinite counts are their own ACCOUNTING ROWS beneath the
  // bars, in the reader's words. They were never folded into the denominator
  // and now they say so: an account with no debt has no comparator to bucket,
  // and a refused account is an unknowable — neither is a small bucket.
  await expect(aave).toContainText("refused: 1");
  await expect(aave).toContainText("no debt (no comparator): 0");
  await expect(dm).toContainText("refused: 1");
  // The DM's disclosure-only note stays visible.
  await expect(dm).toContainText("a disclosure only");
});

test("a monotone waterfall renders NO violation strip; held_flat and projection do render", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("book-waterfall-debt_manager")).toBeVisible();
  await expect(page.getByTestId("waterfall-monotonicity")).toHaveCount(0);
  await expect(page.getByText("PROJECTION", { exact: true })).toBeVisible();

  // W-UX-D caption (a) + W-3L: the counted-disclosure pattern. The always-
  // visible COUNT summary (SINGULAR at n=1, W-UX-C micro-ruling 3) sits in
  // STATE above the bars; the NAMED list sits in the section's FORENSICS.
  const heldFlat = page.getByTestId("waterfall-held-flat");
  await expect(heldFlat).toContainText("1 price input held flat");
  await expect(heldFlat).not.toContainText("0xA0b8…eB48");

  const forensics = page.getByTestId("waterfall-forensics");
  await expect(forensics).toContainText("1 held-flat inputs named");
  await expect(forensics).toContainText("0xA0b8…eB48"); // the held-flat USDC input
});

test("a waterfall monotonicity violation is SURFACED, naming the offending point", async ({ page }) => {
  await mockBook(page, BOOK_MONOTONICITY_VIOLATION);
  await mockPositions(page);
  await openBook(page);

  const strip = page.getByTestId("waterfall-monotonicity");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("MONOTONICITY VIOLATION");
  await expect(strip).toContainText("debt_manager");
  await expect(strip).toContainText("#2");
  await expect(strip).toContainText("fell from 4200000000 to 4100000000");
});

test("409 BATCH_SUPERSEDED: a visible notice and an honest restart from page one", async ({ page }) => {
  let pageOneRequests = 0;
  let cursorRequests = 0;
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    // W-HR-A: the map's hoisted full-book walk shares this endpoint. It NEVER
    // sends `sort` (it is not a ranking); the table always does. The counters
    // below are the TABLE's walk, which is what this test is about.
    const isTable = url.searchParams.get("sort") !== null;
    if (url.searchParams.get("cursor") === null) {
      if (isTable) pageOneRequests += 1;
      return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    }
    // The FIRST cursor presentation answers 409 (its batch was superseded);
    // the restarted walk's cursor is honored — the sentinel (W-UX-C) drives
    // both continuations without a click.
    if (!isTable) return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
    cursorRequests += 1;
    if (cursorRequests === 1) return fulfillJson(route, BATCH_SUPERSEDED, 409);
    return fulfillJson(route, POSITIONS_AAVE_PAGE_2);
  });
  await openBook(page);

  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");

  const notice = page.getByTestId("batch-superseded-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("BATCH SUPERSEDED");
  await expect(notice).toContainText("batch 1 was superseded by batch 2");
  await expect(notice).toContainText("restarted from page one");

  // The walk actually restarted: page one was fetched again and the rows are
  // the fresh first page — never a page mixing two materializations.
  await expect(table).toContainText("0xAAaA…0001");
  await expect.poll(() => pageOneRequests).toBe(2);
});

test("the warn-band disclosure is carried at table and legend level", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  await expect(page.getByTestId("positions-warn-disclosure")).toContainText(WARN_DISCLOSURE);
  // W-HR-A: the map's own warn band is a HEADROOM band now, and it discloses
  // itself as presentation, not as an engine threshold.
  await expect(page.getByTestId("risk-map-warn-disclosure")).toContainText(
    "presentation band < 10% headroom, set for display and not by the engine",
  );

  // W-HR-A: the map states the WHOLE book it walked, with its own as-of and
  // the unfiltered on-book count — there is no partial register to label.
  await expect(page.getByTestId("risk-map-full-head")).toContainText(
    "full book · 2 positions · as-of batch #1 · 2 on book",
  );
});

test("W-VR: the headroom warn note renders ONCE — in the risk map's STATE, never above the controls", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page, "/book?engine=debt_manager");

  // The risk-map STATE stack keeps the sentence…
  await expect(page.getByTestId("risk-map-warn-disclosure")).toContainText(
    "presentation band < 10% headroom, set for display and not by the engine",
  );
  // …and the duplicate that sat above the ENGINE selector is gone for the
  // engine whose sentence it repeated.
  await expect(page.getByTestId("positions-warn-disclosure")).toHaveCount(0);
  // Exactly ONE occurrence of the sentence on the whole page.
  const occurrences = await page.evaluate(() => {
    const needle = "presentation band < 10% headroom, set for display and not by the engine";
    const text = document.body.innerText;
    let count = 0;
    let at = text.indexOf(needle);
    while (at !== -1) {
      count += 1;
      at = text.indexOf(needle, at + needle.length);
    }
    return count;
  });
  expect(occurrences).toBe(1);

  // The aave table keeps its OWN, different warn-band line (hf ratio): that
  // one is not a duplicate of anything and must not be lost to the dedupe.
  await openBook(page);
  await expect(page.getByTestId("positions-warn-disclosure")).toContainText(WARN_DISCLOSURE);
});

test("Scenarios (the Lab) rides the PRIMARY nav register (design ruling)", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const nav = page.getByRole("navigation", { name: "app surfaces" });
  // Wave R1 item 13: labels renamed, ORDER and routes unchanged.
  await expect(nav.getByRole("link")).toHaveText([
    "Book",
    "Inspector",
    "Scenarios",
    "History",
    "Activity",
    "Proof",
    "Developers",
  ]);
  await expect(nav.getByRole("link", { name: "Scenarios" })).toHaveAttribute("href", "/lab");
  await expect(nav.getByRole("link", { name: "History" })).toHaveAttribute("href", "/observatory");
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/feed");
});

test("NO SERVABLE BATCH renders the refusal honestly — never a book of zeroes", async ({ page }) => {
  await mockBook(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.route("**/v1/positions*", (route) => fulfillJson(route, BOOK_ERROR_UNAVAILABLE, 503));
  await openBook(page);

  const noBatch = page.getByTestId("book-no-batch");
  await expect(noBatch).toBeVisible();
  await expect(noBatch).toContainText("NO SERVABLE BATCH");
  await expect(noBatch).toContainText("statement about the SERVICE");

  // The positions table refuses honestly — the refusal register with the
  // server's message VERBATIM and its own retry instruction; NO retry button
  // (a 503 is the service's statement, not a transport accident to hammer).
  const refusal = page.getByTestId("positions-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("REFUSED · unavailable");
  await expect(refusal).toContainText("no complete risk batch is available");
  await expect(refusal).toContainText("retry after 5s");
  await expect(refusal.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toHaveCount(0);
  // No aggregate zeroes appear anywhere on the degraded surface.
  await expect(page.getByTestId("book-stats-aave_v3_etherfi")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// W-UX-B — per-engine sort vocabulary, deep-link normalization, refusal
// rendering (the design ruling's part B, verbatim).
// ---------------------------------------------------------------------------

test("the DM view never OFFERS hf — and W-HR-A strikes its disclosure column outright", async ({ page }) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  // Aave keeps its Health factor column — there the wad IS the chain's own
  // comparator. It is no longer a SORT control: headroom is strictly
  // increasing in HF, so hf-asc and headroom-asc are one ranking, and one
  // ranking gets one control (W-HR-A).
  const aaveTable = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  const aaveHf = aaveTable.getByRole("columnheader", { name: "Health factor" });
  await expect(aaveHf).toBeVisible();
  await expect(aaveHf.getByRole("button")).toHaveCount(0);
  await expect(aaveTable.getByRole("button", { name: "Debt", exact: true })).toBeVisible();
  await expect(aaveTable.getByRole("button", { name: "Headroom" })).toBeVisible();
  // The struck columns are gone from the Aave view too.
  await expect(aaveTable.getByRole("columnheader", { name: "Liq. distance" })).toHaveCount(0);
  await expect(aaveTable.getByRole("columnheader", { name: "Engine" })).toHaveCount(0);

  await page.getByRole("button", { name: "debt_manager" }).click();

  // The DM's "HF — disclosure" column is STRUCK: the same maxBorrowLT/
  // borrowings pair now produces Headroom, a reading rather than a number
  // that needed a hover to say it was not the verdict.
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  await expect(dmTable.getByRole("columnheader", { name: "HF — disclosure" })).toHaveCount(0);
  await expect(dmTable.getByRole("columnheader", { name: "Health factor" })).toHaveCount(0);
  await expect(dmTable.getByRole("button", { name: "Debt", exact: true })).toBeVisible();
  await expect(dmTable.getByRole("button", { name: "Headroom" })).toBeVisible();
  // Plain columns never look clickable: no button in Account/Collateral/Marks.
  for (const name of ["Account", "Collateral", "Marks"]) {
    await expect(
      dmTable.getByRole("columnheader", { name, exact: true }).getByRole("button"),
    ).toHaveCount(0);
  }
});

test("?engine=debt_manager&sort=hf normalizes BEFORE the first fetch — zero 400s, URL rewritten", async ({ page }) => {
  let doomed = 0;
  const sortsRequested: Array<string | null> = [];
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    sortsRequested.push(url.searchParams.get("sort"));
    if (url.searchParams.get("engine") === "debt_manager" && url.searchParams.get("sort") === "hf") {
      doomed += 1;
      return fulfillJson(route, BOOK_ERROR_BAD_REQUEST, 400);
    }
    return fulfillJson(route, POSITIONS_DM_PAGE_1);
  });
  await muteStream(page);
  await page.goto("/book?engine=debt_manager&sort=hf");

  // The DM book rendered from the NORMALIZED walk, acknowledgment shown.
  const dmTable = page.getByRole("table", { name: "positions for debt_manager" });
  await expect(dmTable).toContainText("0xccCc…0003");
  const ack = page.getByTestId("sort-remap-ack");
  await expect(ack).toBeVisible();
  await expect(ack).toHaveText(SORT_REMAP_ACK);

  // The doomed request NEVER fired; every TABLE fetch carried the remapped
  // sort (the map's full-book walk sends no sort at all and is excluded).
  expect(doomed).toBe(0);
  const tableSorts = sortsRequested.filter((sort) => sort !== null);
  expect(tableSorts.length).toBeGreaterThan(0);
  expect(tableSorts).toEqual(tableSorts.map(() => "headroom"));

  // history.replaceState fixed the deep link. DEFAULTS ARE OMITTED (W-UX-C
  // part 15): headroom IS the default column and debt_manager IS the default
  // engine (W-HR-A), so BOTH params disappear.
  await expect.poll(() => page.url()).not.toContain("sort=");
  await expect.poll(() => page.url()).not.toContain("engine=");
});

test("a 4xx renders the refusal register — envelope code, verbatim message, NO retry button", async ({ page }) => {
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => fulfillJson(route, BOOK_ERROR_BAD_REQUEST, 400));
  await openBook(page);

  const refusal = page.getByTestId("positions-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("REFUSED · bad_request");
  // The API's sentence VERBATIM (the fixture envelope's own message)…
  await expect(refusal).toContainText(BOOK_ERROR_BAD_REQUEST.error.message);
  // …plus the ruling's trailing copy.
  await expect(refusal).toContainText(
    "Adjust the controls; retrying the identical request cannot succeed.",
  );
  // NO retry button anywhere in the refusal register, and no transport strip.
  await expect(refusal.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "retry" })).toHaveCount(0);
  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toHaveCount(0);
});

test("a network failure keeps the transport strip WITH retry — the one honest retry", async ({ page }) => {
  await mockBook(page, BOOK);
  await page.route("**/v1/positions*", (route) => route.abort());
  await openBook(page);

  await expect(page.getByText("PAGE FETCH FAILED", { exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "retry" });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("positions-refusal")).toHaveCount(0);

  // And the retry is honest: once the transport heals, it loads the page.
  await page.unroute("**/v1/positions*");
  await mockPositions(page);
  await retry.click();
  const table = page.getByRole("table", { name: "positions for aave_v3_etherfi" });
  await expect(table).toContainText("0xAAaA…0001");
});

// ---------------------------------------------------------------------------
// VIEW 3 — step increments between neighboring sampled points (views spec
// view 3 + critic Finding 9).

test("VIEW 3: the increment rows keep the two claims apart, with computed zeros staying zeros", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const dm = page.getByTestId("waterfall-increments-debt_manager");
  await expect(dm.getByTestId("increments-caption-debt_manager")).toBeVisible();
  await expect(dm.getByTestId("increments-caption-debt_manager")).toContainText(
    "INCREASE in eligible debt",
  );
  // Five steps on the six-point fixture grid, each named by ITS OWN factors.
  await expect(dm.getByTestId("increment-row")).toHaveCount(5);
  await expect(dm.getByTestId("increment-value").first()).toHaveText(
    "+$0 · no account first crossed at this step",
  );
  // A flat book draws NO bars and NO presence dots — zero is a computed zero.
  await expect(dm.getByTestId("increment-bar")).toHaveCount(0);
  await expect(dm.getByTestId("increment-presence")).toHaveCount(0);
  // The method line keeps the entry claim off the dollar figure.
  const method = dm.getByTestId("increments-method-debt_manager");
  await expect(method).toContainText("never called the debt that became eligible");
  await expect(method).toContainText("never differenced");
  // No stop, no refusal on the honest fixture.
  await expect(dm.getByTestId("increments-stopped-debt_manager")).toHaveCount(0);
  await expect(page.getByTestId("increments-refused-debt_manager")).toHaveCount(0);
});

test("VIEW 3: the series STOPS before a server-named monotonicity violation, stated in words", async ({
  page,
}) => {
  await mockBook(page, BOOK_MONOTONICITY_VIOLATION);
  await mockPositions(page);
  await openBook(page);

  const dm = page.getByTestId("waterfall-increments-debt_manager");
  // The violation is named at index 2: only the first step survives.
  await expect(dm.getByTestId("increment-row")).toHaveCount(1);
  const stopped = dm.getByTestId("increments-stopped-debt_manager");
  await expect(stopped).toBeVisible();
  await expect(stopped).toContainText("monotonicity violation");
  await expect(stopped).toContainText("stops before that point");
});

test("r98: the bar scale is DISCLOSED per engine, and lawful full-precision factors are never clipped", async ({
  page,
}) => {
  // DERIVED CASE: an uneven, full-precision descending grid — lawful under
  // the env-configurable grid — whose factor labels are far wider than any
  // fixed gutter. The served step boundaries must render whole.
  const body = structuredClone(BOOK) as unknown as {
    waterfall: { points: { index: number; factor: string }[] };
  };
  const factors = [
    "1000000000000000000",
    "999999999999999999",
    "999999999999999998",
    "700000000000000000",
    "600000000000000000",
    "500000000000000000",
  ];
  body.waterfall.points.forEach((point, index) => {
    const factor = factors[index];
    if (factor !== undefined) point.factor = factor;
  });
  await mockBook(page, body);
  await mockPositions(page);
  await openBook(page);

  const dm = page.getByTestId("waterfall-increments-debt_manager");
  // Finding 1: the normalization disclosure rides the visible caption. On
  // this all-zero fixture the honest arm is the no-bar sentence.
  await expect(dm.getByTestId("increments-caption-debt_manager")).toContainText(
    "Every increase in this window is $0, so no bar is drawn.",
  );
  // Finding 2: every factor label's box sits inside its own SVG viewport.
  const contained = await dm
    .getByTestId("increments-bars-debt_manager")
    .evaluate((svg: SVGElement) => {
      const frame = svg.getBoundingClientRect();
      return Array.from(svg.querySelectorAll("text")).every((text) => {
        const box = text.getBoundingClientRect();
        return box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5;
      });
    });
  expect(contained).toBe(true);
  // The full-precision step is named whole on the page.
  await expect(dm.getByTestId("increment-row").nth(1)).toContainText(
    "×0.999999999999999999→×0.999999999999999998",
  );
});

// ---------------------------------------------------------------------------
// VIEWS 1+2 — cumulative headroom + Pareto over the SAME hoisted walk
// (views spec views 1/2 + critic Findings 5/6/7).

test("VIEWS 1+2: completeness and the floor lead, the curve accumulates, every share carries its absolutes", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  await mockPositions(page);
  await openBook(page);

  const panel = page.getByTestId("concentration-aave_v3_etherfi");
  // F6 + view-1 notes: the walk's completeness and the floor state render
  // FIRST, visibly — and the Book's DEFAULT dust step composes a real $1
  // floor onto every walked request, so the takeaway names it.
  await expect(panel.getByTestId("concentration-takeaway-aave_v3_etherfi")).toHaveText(
    "Walked all 2 of the 2 qualifying rows of batch #1 on aave_v3_etherfi; every walked " +
      "request carried the $1 value floor — rows under it are not in this census.",
  );
  // F7: the refused row is a NAMED aside, member of no cell.
  const asides = panel.getByTestId("curve-asides-aave_v3_etherfi");
  await expect(asides).toBeVisible();
  await expect(asides).toContainText("1 refused (withheld upstream)");
  await expect(asides).toContainText("outside BOTH curves");
  // The one computed row (HF 1.08 → 7.4% headroom, $6,000) accumulates: the
  // tightest cells hold nothing, the deepest cell holds the whole book.
  const cells = panel.getByTestId("curve-cell");
  await expect(cells.first()).toContainText("$0");
  await expect(panel.getByTestId("curve-table-aave_v3_etherfi")).toContainText("$6,000");
  // VIEW 2: the denominator is the walk's own Σ, the excluded row counted
  // beside it, and the single tier reaches it exactly.
  await expect(panel.getByTestId("pareto-denominator-aave_v3_etherfi")).toHaveText(
    "The walked book sums to $6,000 across 1 borrower; 1 row carries no positive debt figure " +
      "and sits outside both sides of every share.",
  );
  // r100: every share carries BOTH absolutes — numerator AND denominator.
  await expect(panel.getByTestId("pareto-tier-line")).toHaveText(
    "top 1 holds 100.0% ($6,000 of $6,000)",
  );
  // Methods carry the two no-lie clauses.
  await expect(panel.getByTestId("curve-method-aave_v3_etherfi")).toContainText(
    "bands plus asides always equal the rows walked",
  );
  await expect(panel.getByTestId("pareto-method-aave_v3_etherfi")).toContainText(
    "never compared across engines",
  );
});

test("VIEWS 1+2: a walk still in flight draws NOTHING — a partial vector is not a book", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  // The first positions page never resolves: the walk stays in `walking`.
  await page.route("**/v1/positions*", () => {
    /* hold the request open */
  });
  await openBook(page);

  const panel = page.getByTestId("concentration-aave_v3_etherfi");
  await expect(panel.getByTestId("concentration-walking-aave_v3_etherfi")).toBeVisible();
  await expect(panel.getByTestId("concentration-walking-aave_v3_etherfi")).toContainText(
    "a partial vector is not a book",
  );
  await expect(panel.getByTestId("curve-table-aave_v3_etherfi")).toHaveCount(0);
  await expect(panel.getByTestId("pareto-tier-line")).toHaveCount(0);
});

test("r100: a PREMATURE terminal page never draws a partial vector as the book", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  // DERIVED NEGATIVE: the first page claims total_positions 2 but ends the
  // cursor — one row arrived, the server counted two. "phase: full" alone is
  // not completeness.
  const premature = structuredClone(POSITIONS_AAVE_PAGE_1) as { next_cursor: string | null };
  premature.next_cursor = null;
  await page.route("**/v1/positions*", (route) => fulfillJson(route, premature));
  await openBook(page);

  const panel = page.getByTestId("concentration-aave_v3_etherfi");
  const short = panel.getByTestId("concentration-short-aave_v3_etherfi");
  await expect(short).toBeVisible();
  await expect(short).toContainText("WALK CONTRADICTION");
  await expect(short).toContainText("1 rows but the server counted 2");
  await expect(panel.getByTestId("curve-table-aave_v3_etherfi")).toHaveCount(0);
  await expect(panel.getByTestId("pareto-tier-line")).toHaveCount(0);
});

test("r101: tier absolutes are DISCRIMINATING — unequal numerator and denominator, pinned exact", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  // Two positive-debt borrowers on one terminal page: $6,000 and $200. The
  // one-borrower fixture could not tell the two slots apart ($6,000 of
  // $6,000) — this pair can.
  const base = structuredClone(POSITIONS_AAVE_PAGE_1) as {
    positions: { account: string; total_debt: string | null }[];
    next_cursor: string | null;
    total_positions: number;
  };
  const first = base.positions[0];
  if (first === undefined) throw new Error("fixture invariant: a computed row expected");
  const second = structuredClone(first);
  second.account = "0x9999999999999999999999999999999999999999";
  second.total_debt = "20000000000"; // $200 @ 8dp
  base.positions = [first, second];
  base.next_cursor = null;
  base.total_positions = 2;
  await page.route("**/v1/positions*", (route) => fulfillJson(route, base));
  await openBook(page);

  const panel = page.getByTestId("concentration-aave_v3_etherfi");
  // 6000/6200 = 96.7% truncated tenths; the two dollar figures DIFFER.
  await expect(panel.getByTestId("pareto-tier-line").first()).toHaveText(
    "top 1 holds 96.7% ($6,000 of $6,200)",
  );
  await expect(panel.getByTestId("pareto-tier-line").last()).toHaveText(
    "top 2 hold 100.0% ($6,200 of $6,200)",
  );
});

test("r101: the DUST arm prints the same discriminating absolutes, list-form, no bars", async ({
  page,
}) => {
  await mockBook(page, BOOK);
  // $0.50 + $0.20 — a $0.70 book, far under the named $1,000 floor.
  const base = structuredClone(POSITIONS_AAVE_PAGE_1) as {
    positions: { account: string; total_debt: string | null }[];
    next_cursor: string | null;
    total_positions: number;
  };
  const first = base.positions[0];
  if (first === undefined) throw new Error("fixture invariant: a computed row expected");
  first.total_debt = "50000000";
  const second = structuredClone(first);
  second.account = "0x8888888888888888888888888888888888888888";
  second.total_debt = "20000000";
  base.positions = [first, second];
  base.next_cursor = null;
  base.total_positions = 2;
  await page.route("**/v1/positions*", (route) => fulfillJson(route, base));
  await openBook(page);

  const panel = page.getByTestId("concentration-aave_v3_etherfi");
  await expect(panel.getByTestId("pareto-denominator-aave_v3_etherfi")).toContainText("DUST");
  // 50/70 = 71.4% truncated; numerator and denominator both print, unequal.
  await expect(panel.getByTestId("pareto-tier-line").first()).toHaveText(
    "top 1 holds 71.4% ($0.5 of $0.7)",
  );
  // The visual weight is gone: list form, no SVG bars.
  await expect(panel.getByTestId("pareto-bars-aave_v3_etherfi")).toHaveCount(0);
  await expect(panel.getByTestId("pareto-dust-list-aave_v3_etherfi")).toHaveCount(1);
});
