// The Book page-test contract (spec 2026-09-15 §5.2, §7). Every pin is a
// semantic invariant against the running production build with the API
// mocked from committed fixtures; strings come from lib/book-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { byRoom, DEBT_UNREADABLE, readCashRow, REFUSED_DEBT_UNSERVED } from "../../lib/cash-rows";
import {
  bandsFinding,
  belowLineToggleLabel,
  liquidatableTileLabel,
  liquidatableTileSub,
  nearCapToggleLabel,
  summarizeCash,
  tileBoundNote,
} from "../../lib/cash-summary";
import { LEGACY_BANDS_NONE_COMPUTED } from "../../lib/cash-view";
import { belowLineSentence } from "../../lib/materiality";
import { BATCH_SUPERSEDED, BOOK, BOOK_ENGINE_REFUSED, BOOK_ERROR_UNAVAILABLE, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";
import { META } from "../fixtures/meta";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockCommitted(page: Page, book: unknown = BOOK, bookStatus = 200) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, book, bookStatus));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
}

/** The demo walk as the page reads it, whole: the lib's own figures for the tile and the dek. */
const DEMO_SUMMARY = summarizeCash({
  rows: [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p))),
  decimals: 6,
  refusedPositions: 6,
  walkComplete: true,
  walkStopped: null,
  walkStopKind: null,
  refusedWhole: null,
});

async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
}

test("committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section", async ({
  page,
}) => {
  await mockCommitted(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "crit");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText(
    "$4,200 of Cash debt is liquidatable right now, across 1 account.",
  );
  // The dek states facts; the doctrine ("counted, not hidden") is the drawer's, said once.
  await expect(page.getByTestId("book-verdict-dek")).toHaveText(
    "No account is within 10% of its borrow cap. 1 account has no verdict in this batch.",
  );
  const identity = page.getByTestId("book-verdict-identity");
  await expect(identity).toContainText("Batch 1");
  await expect(identity).toContainText("Coverage 1 / 2 computed");
  // The label-only chip says the whole phrase and bolds none of it; a fresh snapshot is a record, in ink.
  const current = identity.locator('[data-chip="Current, not projected"]');
  await expect(current).toHaveText("Current, not projected");
  await expect(current.locator("b")).toHaveCount(0);
  await expect(identity.locator('[data-chip="Snapshot"]')).not.toHaveClass(/chipOk/);

  await expect(page.getByTestId("book-kpi-debt")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-liquidatable")).toHaveAttribute("data-tone", "crit");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("$4,200");
  // The label is the material line itself; over a book read whole the sub states the partition's total.
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("Liquidatable · ≥ $100");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("1 account · 0 more under $100 · 1 in all");
  await expect(page.getByTestId("book-kpi-near")).toContainText("0 accounts");
  await expect(page.getByTestId("book-kpi-baddebt")).toContainText("$239.60");
  await expect(page.getByTestId("book-kpi-notcomputed")).toHaveAttribute("data-tone", "refused");
  // One state word for the engine-refused population: the tile, the row's pill and the dek all say "No verdict".
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("No verdict");
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("Collateral never read");

  const rows = page.getByTestId("book-attention").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Liquidatable");
  await expect(rows.nth(1)).toContainText("No verdict");
  await expect(rows.nth(1)).toHaveClass(/dim/);
  // One unit in the Room to cap column: percent of the cap, over cap negative (U+2212), the dollars in its title.
  await expect(page.getByTestId("book-attention").locator("thead th")).toHaveText(["Account", "Room to cap", "Debt", "Status"]);
  const room = rows.nth(0).locator("td").nth(1).locator("span");
  await expect(room).toHaveText("−31.3%");
  await expect(room).toHaveAttribute("title", "over cap by $1,000");
  // The account is shortened with one ellipsis, and the whole address rides its title.
  await expect(rows.nth(0).locator("a")).toHaveText("0xccCc…0003");
  await expect(rows.nth(0).locator("a")).toHaveAttribute("title", "0xccCc000000000000000000000000000000000003");
  await expect(page.getByTestId("book-dust-toggle")).toHaveCount(0); // nothing below the line
  await expect(page.getByTestId("book-near-toggle")).toHaveCount(0); // nothing near the cap to hide

  // Cross-page links name their subject: a row opens its own address, the preview opens its own scenario.
  const rowHref = await rows.nth(0).locator("a").first().getAttribute("href");
  expect(rowHref).toMatch(/^\/inspector\/0x[0-9a-fA-F]{40}$/);
  const previewLinks = page.getByTestId("book-stress-preview").locator("a");
  expect(await previewLinks.count()).toBeGreaterThan(1);
  for (const link of await previewLinks.all()) await expect(link).toHaveAttribute("href", "/lab?scenario=eth_minus_30");
  // The projected container wears one PROJECTION badge; its lines frame bad debt as the rise over the unshocked point.
  const stress = page.getByTestId("book-stress-preview");
  await expect(stress.locator('[data-tone="projection"]')).toHaveText("PROJECTION");
  await expect(stress).toContainText("ETH −10%: no new liquidatable debt · bad debt +$396.03, to $635.64");
  await expect(stress.locator("li").first()).not.toContainText("→");

  const legacy = page.getByTestId("book-legacy");
  await expect(legacy).not.toHaveAttribute("open", /.*/);
  // The kit's fold, titled once for every page; the lib's summary beside the title.
  await expect(legacy.locator("summary span").first()).toHaveText("Legacy · Aave v3 market");
  // The market's own finding over the positions it computed: 1 of the 2 was refused and is counted on its own.
  await expect(legacy.locator("summary span").nth(1)).toHaveText("0 of 1 computed position is liquidatable · $6,000 debt · 1 refused");
  // The section head states the census and anchors to the legacy block that is on the page.
  await expect(page.getByTestId("book-section-cash")).toContainText("Debt Manager engine · OP Mainnet · 2 borrowing accounts");
  await expect(page.getByTestId("book-section-cash").getByRole("link", { name: "Legacy Aave v3 market ↓" })).toHaveAttribute("href", "#legacy");
  // Never summed: 4,200 (Cash) + 6,000 (legacy) appears nowhere.
  await expect(page.locator("body")).not.toContainText("$10,200");
  // Wire names live in the drawer, not on the page.
  await expect(page.locator("main")).not.toContainText("debt_manager");
  await page.getByTestId("book-methodology").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("debt_manager");
  await expect(dialog).toContainText("$100");
  // The doctrine the dek no longer carries lives here, once.
  await expect(dialog).toContainText("An account with no verdict is counted, not hidden");
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("counted, not hidden");
});

test("demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population", async ({
  page,
}) => {
  await mockDemo(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText(
    "$6,840 of Cash debt is liquidatable right now, across 2 accounts.",
  );
  // The $100 line is per account: each of the 47 sits under it, and their sum is stated together — never "below" the line.
  const below = belowLineSentence(DEMO_SUMMARY.liquidatable.counts, DEMO_SUMMARY.liquidatable.sums, 6);
  expect(below).toBe("47 more accounts are technically liquidatable, each under the $100 line — $109.45 together — and not headlined.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText(below ?? "");
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("below the $100 line");
  // Read whole, the tile states the batch aggregate's 49 liquidatable positions: 2 material + 47 under the line.
  const tile = page.getByTestId("book-kpi-liquidatable");
  await expect(tile).toContainText(liquidatableTileLabel);
  expect(liquidatableTileSub(DEMO_SUMMARY, tileBoundNote(DEMO_SUMMARY))).toBe("2 accounts · 47 more under $100 · 49 in all");
  await expect(tile).toContainText("2 accounts · 47 more under $100 · 49 in all");
  await expect(page.getByTestId("book-kpi-near")).toContainText("27 accounts");
  const toggle = page.getByTestId("book-dust-toggle");
  expect(belowLineToggleLabel(DEMO_SUMMARY.belowLine.count, DEMO_SUMMARY.belowLine.sum, 6)).toBe("Show 47 accounts under $100 ($109.45)");
  await expect(toggle).toContainText("Show 47 accounts under $100 ($109.45)");
  // The chart reconciles its over-cap bar with the headline's two accounts.
  await expect(page.getByTestId("book-bands-card")).toContainText("the over-cap bar includes the 47 accounts under $100");
  // One precision in the Debt column: whole dollars in every row, since the column holds figures over $1,000.
  for (const cell of await page.getByTestId("book-attention").locator("tbody tr:not([class*='dim']) td:nth-child(3)").allInnerTexts()) {
    expect(cell.trim()).toMatch(/^\$[\d,]+$/);
  }
  const before = await page.getByTestId("book-attention").locator("tbody tr").count();
  await toggle.click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(before + 47);
  const counts = await page
    .getByTestId("book-bands")
    .locator("[data-count]")
    .evaluateAll((els) => els.reduce((n, el) => n + Number(el.getAttribute("data-count")), 0));
  expect(counts).toBe(1406);
  // Refused rows are counted, not hidden: every one of the 6 sits in the default table, dimmed — and, as the engine
  // serves a refusal, with no debt: the Debt cell is a dash, never a figure the engine did not write.
  const dim = page.getByTestId("book-attention").locator("tbody tr.dim, tbody tr[class*='dim']");
  await expect(dim).toHaveCount(6);
  for (const row of await dim.all()) {
    await expect(row.locator("td").nth(2)).toHaveText("—");
    // The dash says why on hover, in the lib's words: the engine serves no debt figure for a position it could not compute.
    await expect(row.locator("td").nth(2).locator("[title]")).toHaveAttribute("title", REFUSED_DEBT_UNSERVED);
  }
  // The dek sizes the blind spot in words — their debt is not known — and never as a figure or a sum.
  await expect(page.getByTestId("book-verdict-dek")).toContainText("6 accounts have no verdict in this batch; their debt is not known.");
  // The legacy fold's line states the market's own finding over its computed positions — never summed with Cash.
  await expect(page.getByTestId("book-legacy").locator("summary span").nth(1)).toHaveText(
    "46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused",
  );
});

test("the near-cap fold shows the rows the table hides: collapsed it is today's table; open, the other 21 near-cap accounts follow in room order", async ({
  page,
}) => {
  await mockDemo(page);
  await page.goto("/book");
  const rows = page.getByTestId("book-attention").locator("tbody tr");
  const ids = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  // The lib's own partition of the demo walk: material first by room, then near cap by room, then the rows with no verdict.
  const material = [...DEMO_SUMMARY.liquidatable.material].sort(byRoom).map((r) => `book-row-${r.account}`);
  const near = DEMO_SUMMARY.nearCapRows.map((r) => `book-row-${r.account}`);
  const refusedAccounts = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions]
    .filter((p) => p.status !== "computed")
    .map((p) => `book-row-${p.account}`);
  expect(material).toHaveLength(2);
  expect(near).toHaveLength(27);
  expect(refusedAccounts).toHaveLength(6);

  // Collapsed: exactly today's table — 2 material, the first 6 near-cap rows by room, the 6 refused.
  await expect(rows).toHaveCount(14);
  expect(await ids()).toEqual([...material, ...near.slice(0, 6), ...refusedAccounts]);
  // The fold names what it hides — the other 21 and their debt — never "all 27", a total the tile refuses mid-walk.
  const fold = page.getByTestId("book-near-toggle");
  expect(nearCapToggleLabel(DEMO_SUMMARY.nearCapRows.slice(6), 6)).toBe("Show 21 more near-cap accounts ($622K)");
  await expect(fold).toHaveText("Show 21 more near-cap accounts ($622K)");
  await expect(fold).not.toContainText(/\ball\b/);

  // Open: the 21 follow the 6 in room order, ahead of the refused rows.
  await fold.click();
  await expect(rows).toHaveCount(14 + 21);
  expect(await ids()).toEqual([...material, ...near, ...refusedAccounts]);
  // Both folds open: the small & dust rows join after, and nothing is counted twice.
  await page.getByTestId("book-dust-toggle").click();
  await expect(rows).toHaveCount(14 + 21 + 47);
  // Closed again: the table is today's table.
  await fold.click();
  await page.getByTestId("book-dust-toggle").click();
  await expect(rows).toHaveCount(14);
  expect(await ids()).toEqual([...material, ...near.slice(0, 6), ...refusedAccounts]);
});

test("a Cash book whose every account the engine refused one by one: no verdict, and no tile states a figure or a count over nothing computed", async ({
  page,
}) => {
  // Every Debt Manager account refused on its own (SWEEP_NEVER before any collateral sweep) while the engine is served,
  // not withheld: the walk runs, completes and reads every row, and not one of them carries a verdict. The aggregate
  // adds debt and collateral over computed positions only, so the zeros it serves are no position's figures. The legacy
  // market refuses its one position the same way.
  const refusedOnly = POSITIONS_DM_PAGE_1.positions.filter((p) => p.status !== "computed");
  expect(refusedOnly).toHaveLength(1);
  const noneComputed = { positions: 1, computed_positions: 0, refused_positions: 1, liquidatable_positions: 0, total_debt: "0", total_collateral: "0" };
  // The histogram buckets computed positions only and counts a refused one apart; the bad-debt line is the waterfall's
  // unshocked point, which holds a row only for an engine with a computed position — over nothing computed, none.
  const book = {
    ...BOOK,
    engines: BOOK.engines.map((e) => ({ ...e, ...noneComputed })),
    hf_histogram: {
      ...BOOK.hf_histogram,
      engines: BOOK.hf_histogram.engines.map((h) => ({ ...h, refused_count: 1, buckets: h.buckets.map((b) => ({ ...b, count: 0 })) })),
    },
    bad_debt: [],
  };
  await mockCommitted(page, book);
  // Registered last, so it answers ahead of the committed page: the walk's one page serves the refused row alone.
  await page.route("**/v1/positions*", (route) => json(route, { ...POSITIONS_DM_PAGE_1, total_positions: 1, positions: refusedOnly }));
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("No Cash account could be computed this batch.");
  // The tiles a sum over computed positions would fill: no figure — the population's word, "No verdict", in the refused
  // register, and the words why. The median room reads the same decision: no room was read.
  for (const id of ["debt", "liquidatable", "near", "median"]) {
    const tile = page.getByTestId(`book-kpi-${id}`);
    await expect(tile).toHaveAttribute("data-tone", "refused");
    await expect(tile).toHaveAttribute("data-state", "refused");
    await expect(tile).toContainText("No verdict");
    await expect(tile).toContainText("No account computed");
    await expect(tile).not.toContainText("—");
    await expect(tile).not.toContainText("$0");
    await expect(tile).not.toContainText(/\b0 accounts?\b|\b0 more\b|in all/);
  }
  // The census stands as served: one account, counted where the engine refused it.
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("1");
  // No bad-debt line is served for the engine: the tile names the absence, never a zero, never a dash.
  await expect(page.getByTestId("book-kpi-baddebt")).toContainText("Not reported");
  await expect(page.getByTestId("book-kpi-baddebt")).toHaveAttribute("data-state", "not-served");
  await expect(page.getByTestId("book-kpi-baddebt")).not.toContainText("$0");
  // The distance chart reads it too: the finding says no account was computed, and no bar prints "$0 · 0".
  const distance = bandsFinding(
    summarizeCash({
      rows: refusedOnly.map((p) => readCashRow(refinePositionSummary(p))),
      decimals: 6,
      refusedPositions: 1,
      walkComplete: true,
      walkStopped: null,
      walkStopKind: null,
      refusedWhole: null,
    }),
  );
  const bandsCard = page.getByTestId("book-bands-card");
  await expect(bandsCard).toContainText(`${distance.figure}${distance.rest}`);
  await expect(bandsCard).toContainText("— within 10% of the cap: no account computed");
  await expect(bandsCard).not.toContainText("$0");
  await expect(page.getByTestId("book-bands").locator("[data-band]")).toHaveCount(7);
  await expect(page.getByTestId("book-bands").locator("[data-count]")).toHaveCount(0);
  await expect(page.getByTestId("book-bands-note")).toHaveText(distance.barsNote ?? "");
  // The legacy fold reads one decision: its line and its tiles say not computed, and no zero stands in for either.
  const legacy = page.getByTestId("book-legacy");
  await expect(legacy.locator("summary span").nth(1)).toHaveText("1 position · debt not computed · 1 refused");
  await legacy.locator("summary").click();
  for (const id of ["debt", "liquidatable"]) {
    const tile = page.getByTestId(`book-legacy-kpi-${id}`);
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("data-tone", "refused");
    await expect(tile).toContainText("No verdict");
    await expect(tile).not.toContainText("—");
    await expect(tile).not.toContainText(/\$0|\b0\b/);
  }
  await expect(page.getByTestId("book-legacy-kpi-liquidatable")).toContainText("No position computed");
  // Its histogram's zeros count nothing either: no bar is drawn, and the fold says why in the lib's words.
  await expect(page.getByTestId("book-legacy-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-legacy-bands-note")).toHaveText(LEGACY_BANDS_NONE_COMPUTED);
  await expect(page.getByTestId("book-legacy-bands-note")).toHaveText(
    "No position was computed this batch: the histogram counts computed positions only, so no bucket holds a count.",
  );
});

test("the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero — the card's placeholder counts print nowhere", async ({ page }) => {
  // The contract's own withheld card: refused, its refusal, null totals, and integer counts that are placeholders —
  // 0 in the contract's example ("whatever the position counts say"). A count read from it would print as a census.
  const refusal = {
    engine: "debt_manager",
    code: "FLAG_CUSTODY_UNPROVEN",
    detail: "collateral-flag custody is unproven for this window",
    note: "a withheld engine is never representable as an empty healthy one",
  };
  const withheld = {
    ...BOOK,
    refused_engines: [refusal],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager"
        ? { ...e, refused: true, refusal, positions: 0, computed_positions: 0, refused_positions: 0, liquidatable_positions: 0, refusals: [], total_debt: null, total_collateral: null }
        : e,
    ),
  };
  await mockCommitted(page, withheld);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  // The census is withheld with the engine: the section head, the Coverage chip and the Not-computed tile's VALUE.
  const head = page.getByTestId("book-section-cash");
  await expect(head).toContainText("Debt Manager engine · OP Mainnet · accounts withheld");
  await expect(head).not.toContainText("borrowing accounts");
  const identity = page.getByTestId("book-verdict-identity");
  await expect(identity).toContainText("Coverage withheld");
  await expect(identity).not.toContainText("computed");
  await expect(identity.locator('[data-chip="Coverage"]')).toHaveClass(/chipRefused/);
  const notComputed = page.getByTestId("book-kpi-notcomputed");
  await expect(notComputed).toContainText("Withheld");
  await expect(notComputed).not.toContainText("—");
  await expect(notComputed).not.toContainText(/\b0\b/);
  await expect(page.locator("main")).not.toContainText("0 borrowing accounts");
  await expect(page.locator("main")).not.toContainText("0 / 0");
  for (const id of ["debt", "liquidatable", "near", "median", "baddebt"]) {
    await expect(page.getByTestId(`book-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
    await expect(page.getByTestId(`book-kpi-${id}`)).toHaveAttribute("data-state", "refused");
    await expect(page.getByTestId(`book-kpi-${id}`)).toContainText("Withheld");
    await expect(page.getByTestId(`book-kpi-${id}`)).not.toContainText("—");
  }
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("Collateral-flag custody unproven");
  await expect(page.getByTestId("book-bands-card")).toContainText("Withheld.");
  await expect(page.getByTestId("book-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-attention")).toHaveCount(0);
  await expect(page.getByTestId("book-stress-preview")).toContainText("Preview withheld");
  // A withheld preview names no scenario: its link is the workspace, never an id the batch did not publish a view for.
  await expect(page.getByTestId("book-stress-preview").locator("a")).toHaveAttribute("href", "/lab");
  // Nothing on a withheld preview is projected: it wears no PROJECTION badge.
  await expect(page.getByTestId("book-stress-preview").locator('[data-tone="projection"]')).toHaveCount(0);
  // No liquidatable pill anywhere, and no "$0" standing in for a figure the engine withheld.
  await expect(page.locator('main [data-tone="crit"]')).toHaveCount(0);
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0");
  await expect(page.getByTestId("book-kpi-near")).not.toContainText("$0");
  // The drawer's refusal section names the withheld book — a withheld card's empty refusal list is never "None."
  await page.getByTestId("book-methodology").click();
  const method = page.getByTestId("book-methodology-body");
  await expect(method).toContainText("The Cash engine withheld its whole book this batch: collateral-flag custody unproven.");
  await expect(method).not.toContainText("None.");
});

test("a positions page from another batch reloads the book once instead of mixing rows", async ({ page }) => {
  let bookRequests = 0;
  const moved = { ...POSITIONS_DM_PAGE_1, batch: { ...POSITIONS_DM_PAGE_1.batch, id: POSITIONS_DM_PAGE_1.batch.id + 1 } };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return json(route, bookRequests === 1 ? BOOK : { ...BOOK, batch: { ...BOOK.batch, id: BOOK.batch.id + 1 } });
  });
  await page.route("**/v1/positions*", (route) => json(route, moved));
  await page.goto("/book");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("book-verdict-identity")).toContainText(`Batch ${String(BOOK.batch.id + 1)}`);
  expect(bookRequests).toBe(2);
});

test("no servable batch (503): the load-failure headline names the reason", async ({ page }) => {
  await mockCommitted(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be loaded.");
  // A book that could not be loaded is no refusal: the headline states there is no answer, in the absent register.
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(page.getByTestId("book-verdict-dek")).toContainText(BOOK_ERROR_UNAVAILABLE.error.message.slice(1, 20));
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("Unavailable");
  // A book that could not be read refused nothing and computed nothing: the tile says "Unavailable" — never the
  // engine's words "not computed" or "withheld", never "nothing refused".
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("Unavailable");
  await expect(page.getByTestId("book-kpi-notcomputed")).not.toContainText("not computed");
  await expect(page.getByTestId("book-kpi-notcomputed")).not.toContainText("nothing refused");
});

const TILES = ["debt", "liquidatable", "near", "median", "baddebt", "notcomputed"] as const;

test("a fetch failure is an unread book: every tile, the chart card and the table say 'unavailable' — never the engine's word 'not computed' — and no anchor points at a legacy block that is not there", async ({
  page,
}) => {
  await page.route("**/v1/**", (route) => route.abort("failed"));
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be loaded.");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
  // The identity strip's chip is drawn solid: a fetch failure is never the refused register.
  await expect(page.getByTestId("book-verdict-identity").locator('[data-chip="Identity"]')).not.toHaveClass(/chipRefused/);
  for (const id of TILES) {
    const tile = page.getByTestId(`book-kpi-${id}`);
    // The unavailable register — solid, never the refused one — and its word where the figure would be.
    await expect(tile).toHaveAttribute("data-state", "unavailable");
    await expect(tile).not.toHaveAttribute("data-tone", "refused");
    await expect(tile).toContainText("Unavailable");
    await expect(tile).not.toContainText("—");
    await expect(tile).not.toContainText(/not computed|withheld/i);
  }
  await expect(page.getByTestId("book-bands-card")).toContainText("Unavailable.");
  await expect(page.getByTestId("book-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-attention")).toHaveCount(0);
  // The engine's refusal word appears once on the page — the sixth tile's LABEL — and nowhere as a state.
  await expect(page.locator("main")).not.toContainText("Not computed.");
  await expect(page.locator("main")).not.toContainText("not computed");
  await expect(page.getByTestId("book-section-cash")).toContainText("accounts unavailable");
  await expect(page.getByTestId("book-legacy")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Legacy Aave v3 market ↓" })).toHaveCount(0);
});

test("a read in flight has not failed and refused nothing: the tiles are pending — never 'unavailable', never 'not computed'", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", () => new Promise<void>(() => undefined));
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("Loading the Cash book…");
  for (const id of TILES) {
    const tile = page.getByTestId(`book-kpi-${id}`);
    await expect(tile).toHaveAttribute("aria-busy", "true");
    await expect(tile).toHaveAttribute("data-state", "pending");
    await expect(tile).toContainText("…");
    await expect(tile).not.toContainText(/unavailable|not computed|withheld|—/i);
  }
  await expect(page.getByTestId("book-bands-card")).toContainText("Loading…");
  await expect(page.getByTestId("book-section-cash")).toContainText("accounts loading…");
  await expect(page.locator("main")).not.toContainText("Not computed.");
});

test("a 409 during the walk restarts it on the reloaded book", async ({ page }) => {
  let bookRequests = 0;
  let positionsRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return json(route, BOOK);
  });
  await page.route("**/v1/positions*", (route) => {
    positionsRequests += 1;
    return positionsRequests === 1 ? json(route, BATCH_SUPERSEDED, 409) : json(route, POSITIONS_DM_PAGE_1);
  });
  await page.goto("/book");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  expect(bookRequests).toBe(2);
  expect(positionsRequests).toBe(2);
});

test("a transport failure mid-walk is stated with a retry that re-walks", async ({ page }) => {
  let positionsRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    positionsRequests += 1;
    return positionsRequests === 1 ? route.abort("failed") : json(route, POSITIONS_DM_PAGE_1);
  });
  await page.goto("/book");
  const failure = page.getByTestId("book-walk-failure");
  await expect(failure).toBeVisible();
  // A walk that stopped on page one has read nothing: the headline names the stop and no tile prints a zero.
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  // A stopped walk is no refusal: the absent register.
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(page.getByTestId("book-kpi-near")).toContainText("Unavailable");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByTestId("book-kpi-median")).toContainText("Walk stopped");
  await expect(page.getByTestId("book-attention")).toContainText("no account is cleared");
  await expect(page.locator("body")).not.toContainText("Nothing material");
  await expect(page.locator("body")).not.toContainText("No account is within 10%");
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  await expect(failure).toHaveCount(0);
  expect(positionsRequests).toBe(2);
});

test("a -0 population on /v1/book refuses the route — never a printed zero", async ({ page }) => {
  // JSON admits the literal -0; JSON.stringify would erase it, so the body is
  // spliced as text. The legacy engine's computed_positions is the target.
  const body = JSON.stringify(BOOK).replace(/"computed_positions":1\b/, '"computed_positions":-0');
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body }),
  );
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.goto("/book");
  await expect(page.getByTestId("route-refusal")).toBeVisible();
  await expect(page.getByTestId("route-refusal")).toContainText("computed_positions");
  await expect(page.locator("body")).not.toContainText("-0 computed");
});

async function mockWith(page: Page, book: unknown, positions: unknown) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, positions));
}

const cashEngineOf = (book: typeof BOOK, over: Partial<(typeof BOOK)["engines"][number]>) => ({
  ...book,
  engines: book.engines.map((e) => (e.engine === "debt_manager" ? { ...e, ...over } : e)),
});

test("while the walk is still running the verdict is pending — never 'Nothing material', never a near-cap negative", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", () => new Promise<void>(() => undefined));
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("Walking the Cash book…");
  // A walk in flight has refused nothing: the absent register, never the refused one.
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(page.getByTestId("book-kpi-liquidatable")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("book-attention")).toContainText("Walking the book…");
  // The distance chart: a walk-derived zero is a dash — in the finding and on every bar — and the bars wear their own qualifier.
  await expect(page.getByTestId("book-bands-card")).toContainText(
    "— within 10% of the cap: a zero is claimed only by a complete walk · the walk is still running",
  );
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0");
  // Nothing is read yet: every bar is a dash alone — no count beside it, no count on it, no height.
  const pendingBars = page.getByTestId("book-bands").locator("[data-band]");
  await expect(pendingBars).toHaveCount(7);
  for (const bar of await pendingBars.all()) {
    await expect(bar).toContainText("—");
    await expect(bar.locator("small")).toHaveCount(0);
    await expect(bar.locator("i")).toHaveCSS("height", "0px");
  }
  await expect(page.getByTestId("book-bands").locator("[data-count]")).toHaveCount(0);
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "Walking the book: every bar and every count is a lower bound over the accounts read so far.",
  );
  await expect(page.locator("body")).not.toContainText("Nothing material");
  await expect(page.locator("body")).not.toContainText("No account is within 10%");
  await expect(page.locator("body")).not.toContainText("No account needs attention");
});

test("a refused positions page is the engine's refusal — never an empty, healthy book", async ({ page }) => {
  const refused = {
    ...POSITIONS_DM_PAGE_1,
    refused: true,
    refusal: { engine: "debt_manager", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  };
  await mockWith(page, BOOK, refused);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("book-verdict-dek")).toHaveText("Collateral sweep failed.");
  for (const id of ["debt", "liquidatable", "near", "median"]) {
    await expect(page.getByTestId(`book-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
    await expect(page.getByTestId(`book-kpi-${id}`)).toContainText("Withheld");
  }
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("Collateral sweep failed");
  await expect(page.getByTestId("book-attention")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("No account needs attention");
  await expect(page.locator("body")).not.toContainText("Nothing material");
});

test("a terminal page short of the advertised census stops the walk by name — the positive it read stands, no negative is claimed", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { positions: 3 }), { ...POSITIONS_DM_PAGE_1, total_positions: 3 });
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("the walk delivered 2 of the 3 rows the wire advertised");
  await expect(page.getByTestId("book-walk-failure").getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "crit");
  // The walk REACHED its last page — it was short of the census there; "before the last page" would be false.
  await expect(page.getByTestId("book-verdict-dek")).toContainText(
    "The walk reached its last page and its rows do not reconcile with the census (the walk delivered 2 of the 3 rows the wire advertised); every figure is a lower bound",
  );
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("before the last page");
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("No account is within 10%");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("lower bound, walk stopped");
  // A stopped walk claims no total: the partition's "in all" is said only over a book read whole.
  await expect(page.getByTestId("book-kpi-liquidatable")).not.toContainText("in all");
  await expect(page.getByTestId("book-kpi-near")).toContainText("Unavailable");
  await expect(page.getByTestId("book-kpi-near")).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByTestId("book-kpi-median")).toContainText("Walk stopped");
  await expect(page.getByTestId("book-bands-card")).toContainText(
    "— within 10% of the cap: a zero is claimed only by a complete walk · the walk stopped",
  );
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0");
  // The band the walk read in prints what it read; every other band is a dash alone, never "$0 · 0".
  const stoppedBars = page.getByTestId("book-bands");
  await expect(stoppedBars.locator('[data-band="breached"]')).toContainText("$4,200 · 1");
  await expect(stoppedBars.locator("[data-count]")).toHaveCount(1);
  for (const id of ["0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]) {
    const bar = stoppedBars.locator(`[data-band="${id}"]`);
    await expect(bar).toContainText("—");
    await expect(bar.locator("small")).toHaveCount(0);
    await expect(bar.locator("i")).toHaveCSS("height", "0px");
  }
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "The walk stopped: every bar and every count is a lower bound over the accounts it read.",
  );
});

test("the distance chart over an incomplete walk: the figure is a floor in its own words and the bars wear their own qualifier; once the walk completes, neither is qualified", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The demo's page one reads in all seven bands, so "no $0 mid-walk" could not fail on it. The walk is reshaped so
  // page one leaves ONE band unread: every "< 2% room" row moves to page two (the census still reconciles: 1,412).
  const inUnreadBand = (p: (typeof DEMO_POSITIONS_DM_PAGE_1.positions)[number]): boolean => readCashRow(refinePositionSummary(p)).band === 1;
  const moved = DEMO_POSITIONS_DM_PAGE_1.positions.filter(inUnreadBand);
  expect(moved.length).toBeGreaterThan(0);
  const pageOne = { ...DEMO_POSITIONS_DM_PAGE_1, positions: DEMO_POSITIONS_DM_PAGE_1.positions.filter((p) => !inUnreadBand(p)) };
  const pageTwo = { ...DEMO_POSITIONS_DM_PAGE_2, positions: [...DEMO_POSITIONS_DM_PAGE_2.positions, ...moved] };
  await page.route("**/v1/positions*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === null) return json(route, pageOne);
    await held;
    return json(route, pageTwo);
  });
  await page.goto("/book");
  const card = page.getByTestId("book-bands-card");
  // Page one carries the least room first, so near-cap accounts are read while page two is still out.
  await expect(card).toContainText(/at least \$[\d.,]+[KMB]? sits within 10% of the cap · walking the book, figures are a lower bound/);
  await expect(card).not.toContainText("$0");
  // The band page one read nothing in is a dash alone — no "$0", no count on it or beside it, no height — while every
  // band it did read in prints its figure and its count.
  const bars = page.getByTestId("book-bands");
  const unread = bars.locator('[data-band="0-2"]');
  await expect(unread).toContainText("—");
  await expect(unread).not.toHaveAttribute("data-count", /.*/);
  await expect(unread.locator("small")).toHaveCount(0);
  await expect(unread.locator("i")).toHaveCSS("height", "0px");
  await expect(bars.locator("[data-count]")).toHaveCount(6);
  for (const id of ["breached", "2-5", "5-10", "10-25", "25-50", "50-plus"]) {
    await expect(bars.locator(`[data-band="${id}"]`)).toContainText(/\$[\d.,]+[KMB]? · [\d,]+/);
  }
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "Walking the book: every bar and every count is a lower bound over the accounts read so far.",
  );
  release();
  await expect(page.getByTestId("book-bands-note")).toHaveCount(0);
  await expect(card).toContainText(/· \$[\d.,]+[KMB]? sits within 10% of the cap/);
  await expect(card).not.toContainText("at least");
  await expect(card).not.toContainText("lower bound");
  // Complete: the band page two filled prints what the book holds, with its count.
  await expect(unread).toHaveAttribute("data-count", String(moved.length));
  await expect(bars.locator("[data-count]")).toHaveCount(7);
});

test("a complete walk prints its empty bands as zeros — the dash is the unfinished walk's alone", async ({ page }) => {
  await mockCommitted(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-kpi-near")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("book-bands-note")).toHaveCount(0);
  const bars = page.getByTestId("book-bands");
  await expect(bars.locator('[data-band="breached"]')).toContainText("$4,200 · 1");
  for (const id of ["0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]) {
    await expect(bars.locator(`[data-band="${id}"]`)).toContainText("$0 · 0");
    await expect(bars.locator(`[data-band="${id}"]`)).toHaveAttribute("data-count", "0");
  }
});

test("a waterfall served with no points is a named refusal on the preview card — never 'not on the grid', never 'no stress grid'", async ({ page }) => {
  if (BOOK.waterfall === null) throw new Error("fixture invariant: the committed book serves a waterfall");
  await mockCommitted(page, { ...BOOK, waterfall: { ...BOOK.waterfall, points: [] } });
  await page.goto("/book");
  const card = page.getByTestId("book-stress-preview");
  await expect(card).toContainText("Preview withheld: no points published.");
  await expect(card).not.toContainText("is not on this batch");
  await expect(card).not.toContainText("carries no stress grid");
  await expect(card.locator("a")).toHaveAttribute("href", "/lab");
});

test("a walk past its census is worded against the census — 'delivered N rows for a census of M', never 'N of the M rows'", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { positions: 1 }), { ...POSITIONS_DM_PAGE_1, total_positions: 1 });
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("the walk delivered 2 rows for a census of 1");
  await expect(page.getByTestId("book-walk-failure")).not.toContainText("2 of the 1");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("the walk delivered 2 rows for a census of 1");
  await expect(page.locator("body")).not.toContainText("No account needs attention");
  // The walk did not stop "before the last page" — it ran past its census — and it landed more accounts than the
  // census counts, so nothing on the page is called a lower bound or "at least". Its two rows are distinct accounts
  // (identities are tracked across the walk), so the page never says it may have counted one twice.
  await expect(page.getByTestId("book-verdict-dek")).toContainText(
    "The walk ran past its census (the walk delivered 2 rows for a census of 1); it landed more accounts than the census counts, so no figure here is a total or a lower bound.",
  );
  await expect(page.getByTestId("book-verdict-dek")).not.toContainText("before the last page");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("not a bound, the walk ran past its census");
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "The walk ran past its census: it landed more accounts than the book counts, so no bar or count here is a total or a lower bound.",
  );
  const main = page.locator("main");
  await expect(main).not.toContainText("count an account twice");
  await expect(main).not.toContainText("at least");
  await expect(main).not.toContainText("figures are a lower bound");
  await expect(main).not.toContainText("lower bound, walk stopped");
  await expect(main).not.toContainText("is a lower bound over");
});

test("a positions page with no batch ends the walk BY NAME — never a throw that leaves the walk looking alive forever", async ({ page }) => {
  // The shape the client's refinement lets through: the positions array refines, the null batch rides along.
  await mockWith(page, BOOK, { ...POSITIONS_DM_PAGE_1, positions: [], batch: null });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("batch is not an object (got null)");
  // A body that cannot be read is not a transport failure: the identical request cannot answer differently, so no retry.
  await expect(page.getByTestId("book-walk-failure").getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("The walk stopped before the last page (batch is not an object (got null)).");
  // The walk is OVER: nothing on the page is still busy, and nothing says it is walking.
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  await expect(page.getByTestId("book-verdict-headline")).not.toHaveText("Walking the Cash book…");
  await expect(page.getByTestId("book-attention")).toContainText("no account is cleared");
  await expect(page.getByTestId("route-refusal")).toHaveCount(0);
  // The fulfilment callback never dereferenced the null batch: no "Cannot read properties of null (reading 'id')" escaped it.
  expect(pageErrors.filter((message) => /Cannot read properties of null|reading 'id'/.test(message))).toEqual([]);
});

test("a duplicate account never satisfies the census: page one returns A, the last page returns A again — A is counted once, the fault names the account and both pages, and no bound is claimed", async ({
  page,
}) => {
  const [a] = POSITIONS_DM_PAGE_1.positions;
  if (a === undefined) throw new Error("fixture invariant: the committed page serves a row");
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, BOOK));
  // Both pages advertise the book's two rows and deliver one each: counted blind, the walk would complete on A + A.
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, { ...POSITIONS_DM_PAGE_1, positions: [a], next_cursor: cursor === null ? "page-two" : null });
  });
  await page.goto("/book");
  const twice = `account ${a.account} was delivered on page 1 and again on page 2`;
  await expect(page.getByTestId("book-walk-failure")).toContainText(twice);
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
  await expect(page.getByTestId("book-verdict-dek")).toHaveText(
    `1 account has no verdict in this batch. The walk was served an account twice (${twice}); pages that repeat an account do not partition the book, so no figure here is a total or a lower bound.`,
  );
  // Counted once: the account's debt is never doubled, in the tile, the bar or the table.
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("1 account · 0 more under $100 · not a bound, the walk was served an account twice");
  await expect(page.getByTestId("book-kpi-liquidatable")).not.toContainText("in all");
  await expect(page.getByTestId("book-bands").locator('[data-band="breached"]')).toContainText("$4,200 · 1");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "The walk was served an account twice: pages that repeat an account do not partition the book, so no bar or count here is a total or a lower bound.",
  );
  const main = page.locator("main");
  await expect(main).not.toContainText("$8,400");
  await expect(main).not.toContainText("across 2 accounts");
  await expect(main).not.toContainText("at least");
  await expect(main).not.toContainText("figures are a lower bound");
  await expect(main).not.toContainText("lower bound, walk stopped");
  await expect(main).not.toContainText("is a lower bound over");
  await expect(page.locator("body")).not.toContainText("No account needs attention");
});

test("an unreadable computed row blocks every all-clear: counted in the headline, the dek and the sixth tile, and no negative is said over it — though the walk is complete and the engine refused nothing", async ({
  page,
}) => {
  const [a] = POSITIONS_DM_PAGE_1.positions;
  if (a === undefined) throw new Error("fixture invariant: the committed page serves a row");
  // The aggregate: one computed position, none refused. Its one row: computed, liquidatable, and a debt no guard admits.
  const book = cashEngineOf(BOOK, { positions: 1, computed_positions: 1, refused_positions: 0, refusals: [] });
  await mockWith(page, book, { ...POSITIONS_DM_PAGE_1, total_positions: 1, positions: [{ ...a, total_debt: "1e6" }] });
  await page.goto("/book");
  // The engine refused nothing: a row this page could not read is an absent answer, never a refusal.
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-verdict-dek")).toHaveText(
    "1 account the engine calls computed could not be read by this page. No verdict is claimed over it.",
  );
  // Every negative the page can say, withheld.
  const body = page.locator("body");
  for (const negative of ["Nothing material", "No account is liquidatable", "No computed account", "No account is within 10%", "No account needs attention"]) {
    await expect(body).not.toContainText(negative);
  }
  // The sixth tile counts it, in its own word — the engine refused nothing, and the tile never reads "0 · nothing refused" alone.
  const notComputed = page.getByTestId("book-kpi-notcomputed");
  await expect(notComputed).toContainText("1");
  await expect(notComputed).toContainText("Nothing refused · 1 unreadable");
  // No zero is a finished count: the walk-derived tiles state no figure — the unreadable register, its word, never a
  // dash — wearing the lower-bound note.
  for (const id of ["liquidatable", "near"]) {
    const tile = page.getByTestId(`book-kpi-${id}`);
    await expect(tile).toHaveAttribute("data-state", "unreadable");
    await expect(tile).toContainText("Unreadable");
    await expect(tile).not.toContainText("—");
    await expect(tile).not.toContainText("$0");
    await expect(tile).toContainText("lower bound, 1 row unreadable");
  }
  await expect(page.getByTestId("book-bands-card")).toContainText(
    "— within 10% of the cap: a zero is claimed only over a book read whole · 1 row could not be read",
  );
  await expect(page.getByTestId("book-bands-card")).not.toContainText("$0");
  await expect(page.getByTestId("book-bands").locator("[data-count]")).toHaveCount(0);
  await expect(page.getByTestId("book-bands-note")).toHaveText(
    "1 row could not be read: every bar and every count is a lower bound over the accounts this page could read.",
  );
  // The row stays on the table, dimmed, under its own standing — never the engine-refused population's "No verdict".
  const rows = page.getByTestId("book-attention").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Unreadable");
  await expect(rows.first()).not.toContainText("No verdict");
  await expect(rows.first()).toHaveClass(/dim/);
  // Its debt was served and failed the guard: the cell says so and names the fault — never the dash of a debt not served.
  await expect(rows.first().locator("td").nth(2)).toHaveText("Unreadable");
  await expect(rows.first().locator("td").nth(2).locator("[title]")).toHaveAttribute("title", DEBT_UNREADABLE);
  // The walk itself completed: nothing is busy, and no walk failure is claimed.
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  await expect(page.getByTestId("book-walk-failure")).toHaveCount(0);
});

test("a first answer that is not a book is a NAMED unreadable failure — never 'unavailable', never 'not computed', never the route's refusal", async ({ page }) => {
  for (const [body, fault] of [
    [null, "the body is not an object (got null)"],
    [{ ...BOOK, engines: null }, "engines is not a list (got null)"],
    [{ ...BOOK, batch: null }, "batch is not an object (got null)"],
  ] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockWith(page, body, POSITIONS_DM_PAGE_1);
    await page.goto("/book");
    await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book's answer could not be read.");
    await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "absent");
    await expect(page.getByTestId("book-verdict-dek")).toHaveText(`The service answered, and the body is not a book: ${fault}.`);
    await expect(page.getByTestId("book-verdict-identity")).toContainText("Identity unreadable");
    await expect(page.getByTestId("book-section-cash")).toContainText("accounts unreadable");
    for (const id of TILES) {
      const tile = page.getByTestId(`book-kpi-${id}`);
      await expect(tile).toHaveAttribute("data-state", "unreadable");
      await expect(tile).toContainText("Unreadable");
      await expect(tile).not.toContainText(/unavailable|not computed|withheld/i);
    }
    await expect(page.getByTestId("book-bands-card")).toContainText("Unreadable.");
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
  }
});

test("a malformed background repair never replaces a readable book: the verdict and every figure stand, and the identity strip says the re-read could not be read", async ({
  page,
}) => {
  let bookRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  // The first answer is the book; every later one is a 200 whose body is not a book.
  await page.route("**/v1/book", (route) => {
    bookRequests += 1;
    return json(route, bookRequests === 1 ? BOOK : { ...BOOK, engines: null });
  });
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
  await expect(page.getByTestId("book-verdict-identity").locator('[data-chip="Re-read"]')).toHaveCount(0);
  // A bfcache restore is definitive resume evidence by itself: the hook's repair re-reads the book.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(() => bookRequests).toBeGreaterThanOrEqual(2);
  const reread = page.getByTestId("book-verdict-identity").locator('[data-chip="Re-read"]');
  await expect(reread).toContainText("unreadable · this batch stands");
  await expect(reread).toHaveAttribute("title", "engines is not a list (got null)");
  // The readable book stands, whole: nothing crashed, nothing was replaced.
  await expect(page.getByTestId("route-refusal")).toHaveCount(0);
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
  await expect(page.getByTestId("book-verdict-identity")).toContainText(`Batch ${String(BOOK.batch.id)}`);
  await expect(page.getByTestId("book-kpi-debt")).toContainText("$4,200");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
});

test("the drawer takes the view's word for a withheld book: when ONLY the positions endpoint refuses the engine, its refusal section names the withheld book — never 'None.' under a 'could not be computed' headline", async ({
  page,
}) => {
  const refused = {
    ...POSITIONS_DM_PAGE_1,
    refused: true,
    refusal: { engine: "debt_manager", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  };
  // The book itself lists no refusal for the engine and itemises none on its card.
  await mockWith(page, cashEngineOf(BOOK, { refused_positions: 0, refusals: [] }), refused);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  await page.getByTestId("book-methodology").click();
  const method = page.getByTestId("book-methodology-body");
  await expect(method).toContainText("The Cash engine withheld its whole book this batch: collateral sweep failed. A withheld book itemises no refusals.");
  await expect(method).not.toContainText("None.");
});

test("a positions page from another engine never enters the Cash walk", async ({ page }) => {
  const foreign = {
    ...POSITIONS_DM_PAGE_1,
    engine: "aave_v3_etherfi",
    positions: POSITIONS_DM_PAGE_1.positions.map((p) => ({ ...p, engine: "aave_v3_etherfi" })),
  };
  await mockWith(page, BOOK, foreign);
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText("aave_v3_etherfi");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("book-attention")).toContainText("no account is cleared");
  // No foreign row entered a band: all seven bars stand, and not one carries a count or a figure — seven dashes, not
  // seven zeros (a stopped walk claims no zero), and not a sum that an absent attribute would satisfy on its own.
  const bars = page.getByTestId("book-bands").locator("[data-band]");
  await expect(bars).toHaveCount(7);
  await expect(page.getByTestId("book-bands").locator("[data-count]")).toHaveCount(0);
  for (const bar of await bars.all()) {
    await expect(bar).toContainText("—");
    await expect(bar).not.toContainText("$");
    await expect(bar.locator("small")).toHaveCount(0);
  }
});

test("another engine's refused page is a wrong-engine fault — never Cash's refusal", async ({ page }) => {
  const foreignRefusal = {
    ...POSITIONS_DM_PAGE_1,
    engine: "aave_v3_etherfi",
    refused: true,
    refusal: { engine: "aave_v3_etherfi", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  };
  await mockWith(page, BOOK, foreignRefusal);
  await page.goto("/book");
  await expect(page.getByTestId("book-walk-failure")).toContainText('the page answers for engine "aave_v3_etherfi", not debt_manager');
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be fully read this batch.");
  await expect(page.getByTestId("book-verdict-headline")).not.toHaveText("The Cash book could not be computed this batch.");
  await expect(page.locator("body")).not.toContainText("Collateral sweep failed.");
});

test("a liquidatable position under the $100 line is hidden by the display rule, and the table says so — never 'No account needs attention'", async ({ page }) => {
  const [liquidatable] = POSITIONS_DM_PAGE_1.positions;
  if (liquidatable === undefined || liquidatable.health_factor === null) throw new Error("fixture invariant");
  const small = {
    ...POSITIONS_DM_PAGE_1,
    total_positions: 1,
    positions: [{ ...liquidatable, total_debt: "50000000", health_factor: { ...liquidatable.health_factor, num: "32000000", den: "50000000" } }],
  };
  const book = cashEngineOf(BOOK, { positions: 1, computed_positions: 1, refused_positions: 0, refusals: [] });
  await mockWith(page, book, small);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("Nothing material is liquidatable on the Cash book right now.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("1 more account is technically liquidatable, under the $100 line — $50 — and not headlined.");
  await expect(page.getByTestId("book-attention")).toContainText(
    "Nothing material needs attention; 1 liquidatable account under $100 ($50) is folded under the toggle below.",
  );
  await expect(page.locator("body")).not.toContainText("No account needs attention");
  await page.getByTestId("book-dust-toggle").click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("book-attention").locator("tbody tr").first()).toContainText("Liquidatable");
});

test("the legacy engine withheld whole: its cause is named, no population, no histogram — never '0 positions'", async ({ page }) => {
  await mockWith(page, BOOK_ENGINE_REFUSED, POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  const legacy = page.getByTestId("book-legacy");
  await expect(legacy.locator("summary span").nth(1)).toHaveText("Withheld this batch: collateral-flag custody unproven");
  await expect(legacy.locator("summary")).not.toContainText("0 positions");
  await expect(legacy.locator("summary")).not.toContainText("0 liquidatable");
  await expect(page.getByTestId("book-legacy-bands")).toHaveCount(0);
  await expect(page.getByTestId("book-legacy-withheld")).toContainText("collateral-flag custody unproven");
  // The Cash book beside it serves normally.
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
});

test("a malformed wire money string is named, never coerced: '' is not $0", async ({ page }) => {
  await mockWith(page, cashEngineOf(BOOK, { total_debt: "" }), POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  const tile = page.getByTestId("book-kpi-debt");
  await expect(tile).toContainText("Unreadable");
  await expect(tile).toHaveAttribute("data-state", "unreadable");
  await expect(tile).toContainText("engines[debt_manager].total_debt is not a wire decimal");
  await expect(tile).not.toContainText("—");
  await expect(tile).not.toContainText("$0");
});

test("a fractional legacy bucket count refuses the route by name — never a bar", async ({ page }) => {
  // The first `"count":0` in the serialized book is the legacy histogram's first bucket.
  const body = JSON.stringify(BOOK).replace('"count":0', '"count":1.5');
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body }),
  );
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.goto("/book");
  await expect(page.getByTestId("route-refusal")).toBeVisible();
  await expect(page.getByTestId("route-refusal")).toContainText("buckets[0].count");
  await expect(page.getByTestId("book-legacy-bands")).toHaveCount(0);
});

test("positions the stress arithmetic excluded are named beside the preview and counted in the drawer", async ({ page }) => {
  const book = {
    ...BOOK,
    coverage: {
      ...BOOK.coverage,
      excluded_by_this_layer: 1,
      stress_coverage_is_full: false,
      excluded: [
        {
          engine: "debt_manager",
          account: "0xEEee000000000000000000000000000000000005",
          code: "API_RECONSTRUCTION_MISMATCH",
          reason: "the position could not be rebuilt from its legs",
        },
      ],
    },
  };
  await mockWith(page, book, POSITIONS_DM_PAGE_1);
  await page.goto("/book");
  await expect(page.getByTestId("book-stress-unmeasured")).toContainText("1 account on this engine is excluded from the stress arithmetic");
  await page.getByTestId("book-methodology").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 excluded from the stress arithmetic");
  await expect(page.getByTestId("book-methodology-excluded")).toContainText("0xEEee000000000000000000000000000000000005");
  await expect(page.getByTestId("book-methodology-excluded")).toContainText("API_RECONSTRUCTION_MISMATCH");
});

test("first viewport at 1440×900 holds the verdict, the tiles and the top of the grid", async ({ page }) => {
  await mockDemo(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book");
  await expect(page.getByTestId("book-kpi-notcomputed")).toBeVisible();
  const tilesBottom = await page.getByTestId("book-kpi-notcomputed").evaluate((el) => el.getBoundingClientRect().bottom);
  const chartTop = await page.getByTestId("book-bands").evaluate((el) => el.getBoundingClientRect().top);
  expect(tilesBottom).toBeLessThanOrEqual(900);
  expect(chartTop).toBeLessThan(900);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(1440); // no primary horizontal scroll
});

test("one named-area grid: the chart card is only as tall as its bars, stress and bad debt stack under it, and the Needs attention table spans them — no card stretches to a void", async ({ page }) => {
  await mockDemo(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book");
  await expect(page.getByTestId("book-kpi-near")).not.toHaveAttribute("aria-busy", "true");
  const box = (id: string) =>
    page.getByTestId(id).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
  const chart = await box("book-bands-card");
  const attention = await page.getByTestId("book-attention").evaluate((el) => {
    const card = el.closest("section");
    if (card === null) throw new Error("the attention table sits in a card");
    const r = card.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left };
  });
  const stress = await box("book-stress-preview");
  const bad = await box("book-baddebt");
  // Side by side at the top; stress and bad debt stacked under the chart, in its column, beside the table.
  expect(Math.abs(attention.top - chart.top)).toBeLessThanOrEqual(1);
  expect(attention.left).toBeGreaterThan(chart.right);
  expect(stress.top).toBeGreaterThan(chart.bottom);
  expect(bad.top).toBeGreaterThan(stress.bottom);
  expect(Math.abs(stress.left - chart.left)).toBeLessThanOrEqual(1);
  // The chart card holds its bars and its words, not the table's height.
  expect(chart.bottom - chart.top).toBeLessThan(attention.bottom - attention.top);
});
