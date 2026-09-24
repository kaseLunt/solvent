// The front door (spec 2026-09-15 §5.1). Mocked from committed fixtures; the
// live strip is the SAME headline grammar the Book renders, so the string is
// pinned here too.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockAll(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
}

test("hero, live strip, entries and pipeline render from the fixtures", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  // The hero carries no figure the system does not serve; "each account" is the strip's own unit.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "People borrow against crypto to spend on a Visa card. This is how close each account is to liquidation — right now.",
  );
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText(/\d/);
  const live = page.getByTestId("overview-live");
  await expect(live).toHaveAttribute("data-variant", "material");
  await expect(page.getByTestId("overview-live-headline")).toHaveText(
    "$4,200 of Cash debt is liquidatable right now, across 1 account.",
  );
  await expect(live.getByTestId("overview-live-identity")).toContainText("Batch 1");
  for (const id of ["book", "inspector", "scenarios"]) {
    await expect(page.getByTestId(`overview-entry-${id}`)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Architecture & verification →" })).toHaveAttribute("href", "/proof#architecture");
  const dm = META.watermark_vector.find((w) => w.engine === "debt_manager");
  if (dm === undefined) throw new Error("meta fixture must carry the debt_manager watermark");
  await expect(page.getByTestId("pipeline-index")).toHaveAttribute("data-value", dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("pipeline-compute")).toContainText(`batch ${BOOK.batch.id.toLocaleString("en-US")}`);
  const recon = EVIDENCE_MANIFEST.reconcile;
  if (recon === null || recon === undefined) throw new Error("evidence fixture must carry a reconcile receipt");
  await expect(page.getByTestId("pipeline-verify")).toHaveAttribute(
    "data-value",
    `${recon.gated_exact.toLocaleString("en-US")}/${recon.gated_rows.toLocaleString("en-US")}`,
  );
  await expect(page.getByTestId("pipeline-serve")).toContainText("17 endpoints");
  // Never summed: the two engines' debts never appear as one figure
  // (6,000 legacy at 8 decimals + 4,200 Cash at 6 decimals).
  await expect(page.locator("body")).not.toContainText("$10,200");
});

test("with the API unreachable the hero still renders and the strip refuses honestly", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("People borrow against crypto to spend on a Visa card.");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("The Cash book could not be loaded.");
  for (const id of ["index", "verify"]) {
    await expect(page.getByTestId(`pipeline-${id}`)).toHaveAttribute("data-value", "unavailable");
  }
  await expect(page.locator("body")).not.toContainText("$0 of Cash debt");
  // An unread book refused nothing: the strip's census is a dash, its chip says unavailable, and the engine's word
  // "not computed" is nowhere on the page.
  await expect(page.getByTestId("overview-live-accounts")).toContainText("—");
  await expect(page.getByTestId("overview-live-accounts")).not.toContainText(/\d/);
  await expect(page.getByTestId("overview-live-identity")).toContainText("Identity unavailable");
  await expect(page.locator("main")).not.toContainText(/not computed/i);
});

test("a withheld Cash engine refuses the strip — its census included — and the entry cards carry no walk-derived figure", async ({ page }) => {
  // The contract's own withheld card: its counts are placeholders (0 in the contract's example), never a census.
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven", note: "" };
  const withheld = {
    ...BOOK,
    refused_engines: [refusal],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager"
        ? { ...e, refused: true, refusal, positions: 0, computed_positions: 0, refused_positions: 0, liquidatable_positions: 0, total_debt: null, total_collateral: null }
        : e,
    ),
  };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, withheld));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("overview-entry-book")).toContainText("Live figures");
  await expect(page.getByTestId("overview-entry-inspector")).toContainText("Try any 0x address");
  await expect(page.locator("body")).not.toContainText("$0");
  await expect(page.locator("body")).not.toContainText("liquidatable now");
  // The strip's "Accounts" and its Coverage chip: the census is withheld with the engine — never the card's 0, so
  // the strip cannot say "Accounts 0" above a pipeline step that says the census is withheld.
  await expect(page.getByTestId("overview-live-accounts")).toContainText("—");
  await expect(page.getByTestId("overview-live-accounts")).not.toContainText(/\d/);
  const identity = page.getByTestId("overview-live-identity");
  await expect(identity).toContainText("Coverage withheld");
  await expect(identity).not.toContainText("computed");
  await expect(identity.locator('[data-chip="Coverage"]')).toHaveClass(/chipRefused/);
  await expect(page.getByTestId("pipeline-compute")).toContainText("Cash accounts withheld");
});

test("a withheld Cash engine: the pipeline's compute step prints the batch and names the census withheld — never '0 Cash accounts'", async ({ page }) => {
  // The contract's withheld card: refused, its refusal, null totals, and placeholder counts — 0 in the contract's own example.
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven for this window", note: "" };
  const withheld = {
    ...BOOK,
    refused_engines: [refusal],
    engines: BOOK.engines.map((e) =>
      e.engine === "debt_manager"
        ? { ...e, refused: true, refusal, positions: 0, computed_positions: 0, refused_positions: 0, total_debt: null, total_collateral: null }
        : e,
    ),
  };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, withheld));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  const compute = page.getByTestId("pipeline-compute");
  await expect(compute).toHaveAttribute("data-value", BOOK.batch.id.toLocaleString("en-US"));
  await expect(compute).toContainText(`batch ${BOOK.batch.id.toLocaleString("en-US")} · Cash accounts withheld`);
  await expect(compute).not.toContainText("0 Cash accounts");
  await expect(page.locator("body")).not.toContainText("0 Cash accounts");
  // The withheld step wears the refused register, not only its words: its line is not the ink of a step that stands.
  await expect(compute).toHaveAttribute("data-tone", "refused");
  const serve = page.getByTestId("pipeline-serve");
  await expect(serve).toHaveAttribute("data-tone", "neutral");
  const lineColour = (step: typeof compute) => step.locator("b").evaluate((b) => getComputedStyle(b.parentElement ?? b).color);
  expect(await lineColour(compute)).not.toBe(await lineColour(serve));
});

test("while the walk runs the strip is pending and the Book entry says so — never '$0 within 10% of cap'", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", () => new Promise<void>(() => undefined));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("Walking the Cash book…");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "pending");
  await expect(page.getByTestId("overview-entry-book")).toContainText("Walking the book…");
  await expect(page.locator("body")).not.toContainText("within 10% of cap");
  await expect(page.locator("body")).not.toContainText("Nothing material");
});

test("a refused stress preview is named on the Scenarios entry — never 'Committed scenarios'", async ({ page }) => {
  if (BOOK.waterfall === null) throw new Error("fixture invariant: the committed book serves a waterfall");
  const book = {
    ...BOOK,
    waterfall: {
      ...BOOK.waterfall,
      excluded_engines: [{ engine: "debt_manager", code: "SWEEP_FAILED", detail: "", note: "" }],
      points: BOOK.waterfall.points.map((p) => ({ ...p, engines: p.engines.filter((e) => e.engine !== "debt_manager") })),
    },
  };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-entry-scenarios")).toContainText("Preview withheld: collateral sweep failed");
  await expect(page.getByTestId("overview-entry-scenarios")).not.toContainText("Committed scenarios");
});

test("a malformed Cash debt on the strip is a dash, never $0", async ({ page }) => {
  const book = { ...BOOK, engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, total_debt: "" } : e)) };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  const strip = page.getByTestId("overview-live");
  await expect(strip).toContainText("Cash debt outstanding");
  await expect(strip).toContainText("—");
  await expect(strip).not.toContainText("$0");
});

test("over a Cash book the engine computed none of, the strip prints no debt or collateral figure and the Book entry says why — never '$0'", async ({ page }) => {
  // Every account refused on its own while the engine is served: the aggregate's zeros sum no computed position.
  const refusedOnly = POSITIONS_DM_PAGE_1.positions.filter((p) => p.status !== "computed");
  expect(refusedOnly).toHaveLength(1);
  const noneComputed = { positions: 1, computed_positions: 0, refused_positions: 1, liquidatable_positions: 0, total_debt: "0", total_collateral: "0" };
  const book = { ...BOOK, engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, ...noneComputed } : e)) };
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, book));
  await page.route("**/v1/positions*", (route) => json(route, { ...POSITIONS_DM_PAGE_1, total_positions: 1, positions: refusedOnly }));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("No Cash account could be computed this batch.");
  const strip = page.getByTestId("overview-live");
  await expect(strip).toContainText("Cash debt outstanding");
  await expect(strip).toContainText("—");
  await expect(strip).not.toContainText("$0");
  await expect(page.getByTestId("overview-entry-book")).toContainText("No account could be computed this batch");
  await expect(page.getByTestId("overview-entry-book")).not.toContainText("within 10% of cap");
});

test("the address field refuses a non-address inline and routes a real one to the Inspector", async ({ page }) => {
  await mockAll(page);
  await page.route("**/v1/address/**", (route) => route.abort());
  await page.goto("/");
  const field = page.getByTestId("overview-address");
  await field.fill("not an address");
  await field.press("Enter");
  await expect(page.getByTestId("overview-address-refused")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await field.fill("0xAAaA000000000000000000000000000000000001");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/inspector\/0xAAaA000000000000000000000000000000000001$/);
});

const entriesBox = async (page: Page) => {
  await mockAll(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toBeVisible();
  return page
    .getByTestId("overview-entry-scenarios")
    .evaluate((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
};

test("first viewport at 1440×900 holds hero, strip and the start of the entries", async ({ page }) => {
  const { top } = await entriesBox(page);
  expect(top).toBeLessThan(900);
});

test("first viewport at 1440×900 holds the entries whole (reference faces)", async ({ page }) => {
  // A property of the faces the pixel pins are drawn in: a CI runner's fallback system-ui is wider, wraps the two
  // deks a line longer each and lands the row's foot ~14px past the fold — the same reason the pins are a local gate.
  test.skip(!!process.env.CI, "a property of the reference faces; a local gate, like the pixel pins");
  const { bottom } = await entriesBox(page);
  expect(bottom).toBeLessThanOrEqual(900);
});

test("a read in flight has not failed: while meta and evidence have not answered, their steps are pending in ink — never 'unavailable', never the refused register; a failed read then says unavailable", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  // Every stalled request is held, not only the last: the shell's meta reader and the surface's both ask `/v1/meta`.
  const held: Route[] = [];
  const stall = (route: Route) => {
    held.push(route);
  };
  await page.route("**/v1/meta*", stall);
  await page.route("**/v1/evidence*", stall);
  await page.goto("/");
  for (const key of ["index", "verify"]) {
    const step = page.getByTestId(`pipeline-${key}`);
    await expect(step).toHaveAttribute("aria-busy", "true");
    await expect(step).toHaveAttribute("data-value", "pending");
    await expect(step).not.toHaveAttribute("data-tone", "refused");
    await expect(step).not.toContainText("unavailable");
  }
  expect(held.length).toBeGreaterThanOrEqual(2);
  await Promise.all(held.map((route) => route.abort()));
  for (const key of ["index", "verify"]) {
    const step = page.getByTestId(`pipeline-${key}`);
    await expect(step).not.toHaveAttribute("aria-busy", "true");
    await expect(step).toHaveAttribute("data-tone", "refused");
    await expect(step).toContainText("unavailable");
  }
});
