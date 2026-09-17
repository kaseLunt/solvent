// web/tests/e2e/inspector.spec.ts
// The Inspector's page-test contract (spec 2026-09-15 §5.3, §7). Mocked from
// committed fixtures: the demo dataset for the primary state (the mockup's
// near-cap account) and the openapi-example fixtures for the other outcomes.
// Every headline string here is produced by lib/inspector-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK_ERROR_UNAVAILABLE } from "../fixtures/book";
import {
  DEMO_ADDRESS_HEALTHY,
  DEMO_ADDRESS_LIQUIDATABLE,
  DEMO_ADDRESS_NEAR,
  DEMO_ADDRESS_REFUSED,
  DEMO_EVENTS_NEAR,
  DEMO_HEALTHY_ADDR,
  DEMO_HISTORY_NEAR,
  DEMO_LIQUIDATABLE_ADDR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_REFUSED_ADDR,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, EVENTS, FOUND_ADDR, HISTORY, NOT_FOUND_ADDR, PARAMS, UNKNOWABLE_ADDR } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

interface Mocks {
  address: unknown;
  history?: unknown;
  events?: unknown;
  params?: unknown;
  stress?: unknown;
  addressStatus?: number;
}

/** `*` never crosses `/`, so the /history and /stress routes are not swallowed by the address route. */
async function mockInspector(page: Page, m: Mocks) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/params*", (route) => json(route, m.params ?? DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, m.events ?? DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, m.history ?? DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, m.stress ?? DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, m.address, m.addressStatus ?? 200));
}

const surface = (page: Page) => page.getByTestId("inspector-surface");
const headline = (page: Page) => page.getByTestId("inspector-verdict-headline");
const dek = (page: Page) => page.getByTestId("inspector-verdict-dek");
const chip = (page: Page, label: string) => page.locator(`[data-chip='${label}']`);

test("near cap — the mockup's account: one sentence, five tiles, chips, what backs the debt, trust, the room sparkline", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await expect(headline(page)).toHaveText("Within $190.50 of its borrow cap. Not liquidatable yet.");
  await expect(dek(page)).toContainText("Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, brings this account to its cap.");
  await expect(dek(page)).toContainText("within 10% of its cap for the last 14 batches (≈6m).");
  await expect(page.getByTestId("inspector-verdict-identity")).toContainText("Batch 18,251");
  await expect(chip(page, "Lookup")).toContainText("complete · both engines");
  await expect(chip(page, "Prices")).toContainText("PriceProvider v2 · 35s");
  await expect(chip(page, "Current")).toContainText("not projected");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("$4,822");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("4,822.000000 exact");
  await expect(page.getByTestId("inspector-kpi-cap")).toContainText("$5,012");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("$190.50");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("3.8% of cap");
  await expect(page.getByTestId("inspector-kpi-room")).toHaveAttribute("data-tone", "warn");
  await expect(page.getByTestId("inspector-kpi-collateral")).toContainText("$12,462");
  await expect(page.getByTestId("inspector-kpi-status")).toContainText("Near cap");
  const backing = page.getByTestId("inspector-backing");
  await expect(backing.locator("tbody tr")).toHaveCount(3);
  await expect(backing).toContainText("weETH");
  await expect(backing).toContainText("$4,000.00");
  await expect(backing).toContainText("50%");
  await expect(backing).toContainText("20%");
  await expect(page.getByTestId("inspector-backing-cap")).toContainText("$5,012");
  await expect(page.getByTestId("inspector-boundary")).toHaveText("Boundary: Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
  const trust = page.getByTestId("inspector-trust");
  await expect(trust.locator("li")).toHaveCount(5);
  await expect(page.getByTestId("inspector-trust-computed")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("inspector-trust-prices")).toContainText("35s · within 180s");
  await expect(page.getByTestId("inspector-trust-sweep")).toHaveAttribute("data-state", "warn");
  await expect(page.getByTestId("inspector-trust-sweep")).toContainText("1 of 3 rows failed · gen 4");
  await expect(page.getByTestId("inspector-trust-reconcile")).toContainText("29/29 Cash rows exact");
  await expect(page.getByTestId("inspector-room-spark").locator("svg")).toBeVisible();
  await expect(page.getByTestId("inspector-legacy")).toHaveCount(0);
  await expect(page.getByTestId("inspector-address-secondary")).toHaveAttribute("href", `/lab?address=${DEMO_NEAR_ADDR}`);
});

test("liquidatable and healthy — the other two spec templates, verbatim", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_LIQUIDATABLE });
  await page.goto(`/inspector/${DEMO_LIQUIDATABLE_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "liquidatable");
  await expect(headline(page)).toHaveText("Liquidatable now — $5,400 against a $5,012 cap.");
  await expect(page.getByTestId("inspector-kpi-status")).toHaveAttribute("data-tone", "crit");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("−$387.50");
  await expect(page.getByTestId("inspector-boundary")).toHaveAttribute("data-kind", "breached");
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_HEALTHY));
  await page.goto(`/inspector/${DEMO_HEALTHY_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "healthy");
  await expect(headline(page)).toHaveText("58.1% of its borrow cap unused. Not close to liquidation.");
  await expect(page.getByTestId("inspector-kpi-status")).toHaveAttribute("data-tone", "ok");
});

test("a refused Cash position: cannot say, tiles refused, the last readable debt named, never $0", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_REFUSED });
  await page.goto(`/inspector/${DEMO_REFUSED_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "not-computed");
  await expect(headline(page)).toHaveText("Cannot say — this account's Cash position was not computed this batch.");
  await expect(dek(page)).toContainText("Its last readable debt is $4,100; no verdict is served for it.");
  for (const id of ["debt", "cap", "room", "collateral", "status"]) {
    await expect(page.getByTestId(`inspector-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("inspector-kpi-cap")).toContainText("—");
  await expect(page.getByTestId("inspector-trust-computed")).toHaveAttribute("data-state", "refused");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("no position — the definitive negative, entitled by a complete lookup", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_NOT_FOUND, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${NOT_FOUND_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  await expect(headline(page)).toHaveText("No Cash or Aave position in batch 1.");
  await expect(chip(page, "Lookup")).toContainText("complete");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("—");
  await expect(page.locator("main")).not.toContainText("$0");
  await expect(page.locator("main")).not.toContainText("Cannot say");
});

test("cannot compute — a withheld book is named and is never 'no position'", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_UNKNOWABLE, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${UNKNOWABLE_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "cannot-compute");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld this batch.");
  await expect(dek(page)).toContainText("never “no position”");
  await expect(chip(page, "Lookup")).toContainText("withheld · Cash");
  await expect(page.locator("main")).not.toContainText("No Cash or Aave position");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("the contract fixture: Cash liquidatable beside a legacy position — never summed, the legacy card present and labeled", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_FOUND, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${FOUND_ADDR}`);
  await expect(headline(page)).toHaveText("Liquidatable now — $4,620 against a $4,200 cap.");
  await expect(page.getByTestId("inspector-legacy")).toBeVisible();
  await expect(page.getByTestId("inspector-legacy")).toContainText("Legacy · Aave v3 market position");
  await page.getByTestId("inspector-legacy").locator("summary").click();
  await expect(page.getByTestId("inspector-legacy")).toContainText(/1\.08/);
  // the legacy market is judged by its own health factor: 1.08 on the wad is Healthy, in a non-refused tone — the wire's
  // null Cash boolean on an Aave row is never read as "not computed"
  await expect(page.getByTestId("inspector-legacy-status")).toContainText("Healthy");
  await expect(page.getByTestId("inspector-legacy-status")).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("inspector-legacy-hf")).toHaveAttribute("data-tone", "neutral");
  await expect(page.getByTestId("inspector-legacy")).not.toContainText("Not computed");
  // 4,620 (Cash, 6 dec) + 6,000 (legacy, 8 dec) must never appear as one figure
  await expect(page.locator("body")).not.toContainText("$10,620");
  // the stale legacy price rides the legacy card, not the Cash verdict
  await expect(page.getByTestId("inspector-legacy")).toContainText("stale price");
  await expect(page.getByTestId("inspector-history-legacy")).toBeVisible();
});

test("a stale Cash price input turns the Prices chip and the Trust item amber", async ({ page }) => {
  const position = DEMO_ADDRESS_NEAR.positions[0];
  if (position === undefined) throw new Error("demo position");
  const stale = {
    ...DEMO_ADDRESS_NEAR,
    positions: [
      {
        ...position,
        price_inputs: position.price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i)),
        as_of: { ...position.as_of, stale_price_inputs: true },
      },
    ],
  };
  await mockInspector(page, { address: stale });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(chip(page, "Prices")).toContainText("3m");
  await expect(chip(page, "Prices")).toHaveClass(/chipWarn/);
  await expect(page.getByTestId("inspector-trust-prices")).toHaveAttribute("data-state", "warn");
  await expect(page.getByTestId("inspector-trust-prices")).toContainText("weETH 210s old · budget 180s");
  await expect(page.getByTestId("inspector-backing")).toContainText("stale");
});

test("503: the lookup could not be completed — neither a position nor 'no position'", async ({ page }) => {
  await mockInspector(page, { address: BOOK_ERROR_UNAVAILABLE, addressStatus: 503 });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  await expect(headline(page)).toHaveText("The lookup could not be completed.");
  // the wire's message, sentence-cased by the headline module (tests/unit/inspector-headline.spec.ts pins the same string)
  await expect(dek(page)).toContainText("No servable batch: the service refuses to answer from nothing (503)");
  await expect(dek(page)).toContainText("an error is not an answer");
  await expect(page.locator("main")).not.toContainText("No Cash or Aave position");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("an invalid path segment is refused inline — nothing is looked up", async ({ page }) => {
  let addressRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/address/**", (route) => {
    addressRequests += 1;
    return route.abort();
  });
  await page.goto("/inspector/not-an-address");
  await expect(surface(page)).toHaveAttribute("data-state", "invalid");
  await expect(headline(page)).toHaveText("Not an address.");
  await expect(dek(page)).toHaveText("An address is 0x followed by 40 hex characters — nothing else is looked up.");
  await expect(page.getByTestId("inspector-kpi-debt")).toHaveCount(0);
  expect(addressRequests).toBe(0);
});

test("the landing refuses a non-address inline and never navigates; a real one routes and is remembered", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto("/inspector");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Is this address at risk?");
  const input = page.getByTestId("inspector-address-input");
  await input.fill("0x123");
  await input.press("Enter");
  await expect(page.getByTestId("inspector-address-refused")).toBeVisible();
  await expect(page).toHaveURL(/\/inspector$/);
  await input.fill(DEMO_NEAR_ADDR);
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/inspector/${DEMO_NEAR_ADDR}$`));
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await page.goto("/inspector");
  await expect(page.getByTestId("inspector-recent")).toContainText("0x7a3f…c21e");
});

test("activity: six rows, a null block_time falls back to the block number, the untimed tail is disclaimed", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-activity");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table).toContainText("Borrow");
  await expect(table).toContainText("Collateral enabled");
  await expect(table.locator("tbody tr").last()).toContainText("block 155,315,000");
  await expect(page.getByTestId("inspector-activity-takeaway")).toContainText("5 with custodied header time, newest first; 1 untimed row(s) follow");
  await expect(page.getByTestId("inspector-activity-more")).toHaveCount(0);
});

test("stress: the committed scenarios inline — two flips, one projection", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-stress-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(0)).toContainText("ETH -30 percent");
  await expect(table.locator("tbody tr").nth(0)).toContainText("Yes");
  await expect(table.locator("tbody tr").nth(2)).toContainText("PROJECTION");
  await expect(table.locator("tbody tr").nth(2)).toContainText("30d");
  await expect(page.getByTestId("inspector-stress")).toHaveAttribute("id", "stress");
});

test("history: a differing vantage is stated; the drawer opens with the formula substituted", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR, history: { ...DEMO_HISTORY_NEAR, batch: { ...DEMO_HISTORY_NEAR.batch, id: DEMO_HISTORY_NEAR.batch.id - 1 } } });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(page.getByTestId("inspector-history")).toContainText("history as of batch 18,250, position as of batch 18,251");
  await page.getByTestId("inspector-drawer").click();
  const body = page.getByTestId("inspector-drawer-body");
  // every term in the exact register, so the equation balances at the cents (the cap's .50 is not dropped)
  await expect(body).toContainText("Room = cap − debt = 5,012.500000 − 4,822.000000 = 190.500000");
  await expect(body).toContainText("PriceProvider v2 (priceproviderv2)");
  await expect(body).toContainText("borrow_apy");
  await expect(body).toContainText("4,822.000000");
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});

test("resume: a failed background repair never replaces the rendered position", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  // The repair must be ATTEMPTED and must FAIL: the lookup route now counts
  // and aborts. A pin that never sees the request would pass against a page
  // that ignores the resume entirely. (`*` never crosses `/`, so /history and
  // /stress keep their own routes.)
  let addressRequests = 0;
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => {
    addressRequests += 1;
    return route.abort();
  });
  // A bfcache restore is definitive resume evidence by itself
  // (lib/freshness.ts resumeEvidenceOf) — no clock step is needed.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(() => addressRequests).toBe(1);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("$4,822");
});

test("first viewport at 1440×900 holds the toolbar, the verdict, the tiles and the top of the grid; 390 has no horizontal scroll", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  const top = await page.getByTestId("inspector-backing").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(900);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

/** The demo stress body with the projection's horizons rewritten at one index; null is the wire's "no verdict for the horizon". */
function projected(index: number, becomes: boolean | null): typeof DEMO_STRESS_NEAR {
  return {
    ...DEMO_STRESS_NEAR,
    scenarios: DEMO_STRESS_NEAR.scenarios.map((s) =>
      s.id !== "dm_rate_horizon_plus_200bps"
        ? s
        : {
            ...s,
            results: s.results.map((r) =>
              r.projection === null
                ? r
                : { ...r, projection: { ...r.projection, horizons: r.projection.horizons.map((h, i) => (i === index ? { ...h, becomes_liquidatable: becomes } : h)) } },
            ),
          },
    ),
  };
}

test("stress: an unknowable horizon is a cannot-say that names it — never 'No'; a projection that holds says so only through its longest horizon", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR, stress: projected(0, null) });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-stress-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const cell = table.locator("tbody tr").nth(2).locator("td").last();
  await expect(cell.locator("[data-tone='refused']")).toHaveText("Cannot say");
  await expect(cell.locator("[data-tone='refused']")).toHaveAttribute("title", "the 30d horizon carries no verdict");
  await expect(cell).not.toContainText("No");
  // The batches agree, so no batch note is printed.
  await expect(page.getByTestId("inspector-stress-batch")).toHaveCount(0);
  // The demo body as served: both horizons hold, and the row says through which horizon — a projection never answers a bare "No".
  await page.unroute("**/v1/address/*/stress*");
  await page.route("**/v1/address/*/stress*", (route) => json(route, DEMO_STRESS_NEAR));
  await page.reload();
  await expect(table.locator("tbody tr").nth(2).locator("td").last()).toHaveText("Not within 90d");
  await expect(table.locator("tbody tr").nth(0).locator("td").last()).toHaveText("Yes");
});

test("the drawer, open across a refresh that withholds the book, speaks the withheld state — never 'no position'", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await page.getByTestId("inspector-drawer").click();
  const body = page.getByTestId("inspector-drawer-body");
  await expect(body).toContainText("Room = cap − debt");
  // The resume repair lands a lookup that withholds the Cash book for this same address (the reading is keyed by the route's address).
  let addressRequests = 0;
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => {
    addressRequests += 1;
    return json(route, { ...ADDRESS_UNKNOWABLE, address: DEMO_NEAR_ADDR });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(() => addressRequests).toBe(1);
  await expect(surface(page)).toHaveAttribute("data-state", "cannot-compute");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld this batch.");
  await expect(body).toBeVisible();
  await expect(page.getByTestId("inspector-drawer-empty")).toHaveText(
    "Cannot say — the Cash book is withheld this batch. A withheld book is never “no position”; there is no calculation to show.",
  );
  await expect(body).not.toContainText("No Cash position");
  await expect(body).not.toContainText("nothing to calculate");
});

test("stress answering for another batch: the section discloses both batches, each row wears the stress batch, the rows still read for their own batch", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR, stress: { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: DEMO_STRESS_NEAR.batch.id + 1 } } });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(page.getByTestId("inspector-verdict-identity")).toContainText("Batch 18,251");
  const note = page.getByTestId("inspector-stress-batch");
  await expect(note).toHaveAttribute("role", "note");
  await expect(note).toContainText("Stress for batch 18,252; the position above is batch 18,251.");
  await expect(note).toContainText("not compared against the position above");
  const table = page.getByTestId("inspector-stress-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  for (const k of [0, 1, 2]) await expect(table.locator("tbody tr").nth(k).locator("td").first()).toContainText("batch 18,252");
  // "Room today" is the stress body's own before, for its own batch.
  await expect(table.locator("tbody tr").nth(0).locator("td").nth(1)).toHaveText("$190.50");
  await expect(table.locator("tbody tr").nth(0).locator("td").last()).toHaveText("Yes");
});

test("activity: a refused 'Load more' is stated on its own line beside the rows it could not extend — the rows stand, the button remains", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.unroute("**/v1/events*");
  await page.route("**/v1/events*", (route) =>
    route.request().url().includes("cursor=") ? json(route, BOOK_ERROR_UNAVAILABLE, 503) : json(route, { ...DEMO_EVENTS_NEAR, next_cursor: "page-2" }),
  );
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-activity");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("inspector-activity-error")).toHaveCount(0);
  await expect(page.getByTestId("inspector-activity-takeaway")).toContainText("more exist behind the cursor");
  await page.getByTestId("inspector-activity-more").click();
  const line = page.getByTestId("inspector-activity-error");
  await expect(line).toHaveAttribute("role", "status");
  await expect(line).toContainText("More activity could not be loaded: 503 unavailable: no complete risk batch is available");
  await expect(line).toContainText("The rows above stand; nothing beyond them was read.");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table).not.toContainText("Activity unavailable");
  await expect(page.getByTestId("inspector-activity-more")).toBeVisible();
  await expect(page.getByTestId("inspector-activity-more")).toBeEnabled();
});
