### Task 12: The page-test contract, and retiring the old Inspector's components and pins

**Files:**
- Rewrite: `web/tests/e2e/inspector.spec.ts`
- Delete: `web/app/inspector/AddressEntry.tsx`, `web/app/inspector/[addr]/InspectorPositionCard.tsx`, `web/app/inspector/[addr]/InspectorHistory.tsx`, `web/app/inspector/[addr]/InspectorActivity.tsx`, `web/lib/inspector-lines.ts`, `web/tests/unit/inspector-lines.spec.ts`
- Modify: `web/tests/e2e/{shell,state-matrix,runbook-bsplit,p0-fixes,p1b-fixes,r1-fixes,r3-fixes,r4-fixes,r6-fixes}.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md` (retirement ledger)

**Interfaces:**
- Consumes the test-id contract (Task 11) and the fixtures: `tests/fixtures/demo` (Task 10), `tests/fixtures/inspector.ts` (`ADDRESS_FOUND`, `ADDRESS_NOT_FOUND`, `ADDRESS_UNKNOWABLE`, `HISTORY`, `EVENTS`, `PARAMS`, the three addresses), `tests/fixtures/meta.ts`, `tests/fixtures/proof.ts`, `tests/fixtures/book.ts` (`BOOK_ERROR_UNAVAILABLE`).
- Produces the Inspector's page-test contract (spec §7): first-viewport answer, identity chips present, refused never zero, never summed, deep links carry the address, the seven states.

- [ ] **Step 1: The contract spec (replaces the file)**

```ts
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
  await expect(dek(page)).toContainText("Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, makes this account liquidatable.");
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
  await expect(page.getByTestId("inspector-address-secondary")).toHaveAttribute("href", "#stress");
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
  await expect(dek(page)).toContainText("no servable batch");
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
  await expect(body).toContainText("Room = cap − debt = $5,012 − $4,822 = $190.50");
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
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => route.abort());
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.waitForTimeout(500);
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
```

- [ ] **Step 2: Build, run the contract**

Run: `npm run build`, kill any stale :3111 server, then `npx playwright test --project=e2e tests/e2e/inspector.spec.ts`
Expected: 15 passed. A failing assertion here is either the page (fix in the Task 11 files) or a wrong expectation about a fixture value (recompute from the fixture; the unit welds in Task 10 already pin the same numbers).

- [ ] **Step 3: Delete the old components and module**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent/web
git rm app/inspector/AddressEntry.tsx "app/inspector/[addr]/InspectorPositionCard.tsx" "app/inspector/[addr]/InspectorHistory.tsx" "app/inspector/[addr]/InspectorActivity.tsx" lib/inspector-lines.ts tests/unit/inspector-lines.spec.ts
npm run typecheck && npm run lint
```
Expected: clean — nothing else imports them (verified at planning: only the Inspector's own files did). If typecheck names an importer, that importer is a Lab/Proof/Observatory file and the module it needs must stay; report it rather than deleting further.

- [ ] **Step 4: Re-express and retire the legacy e2e pins (ruling R14)**

Edit each file exactly as listed. "Retire" means delete the `test(...)` (or `test.describe(...)`) block and any import that becomes unused. Every retirement gets one ledger line in Step 6.

| File | Test(s) | Action | Where the law now lives |
|---|---|---|---|
| `shell.spec.ts` | the `SURFACES` row for `/inspector` | change `h1: "Inspector"` → `h1: "Is this address at risk?"` | landing H1 (R9) |
| `state-matrix.spec.ts` | the 7 `surface: "inspector"` cells | re-express each `verify`: `loading` → `await expect(page.getByTestId("inspector-surface")).toHaveAttribute("data-state", "loading")` and `await expect(page.getByTestId("inspector-verdict-headline")).toHaveText("Looking up this address…")`; `ok:found-with-stale-price` → `data-state` is `liquidatable` and `page.getByTestId("inspector-legacy")` contains `stale price`; `empty:not-found-definitive` → `data-state` `no-position`, headline `No Cash or Aave position in batch 1.`, `main` not containing `Cannot say`; `refused:found-null-unknowable` → `data-state` `cannot-compute`, headline `Cannot say — the Cash book is withheld this batch.`, `main` not containing `No Cash or Aave position`; `ok:history-gaps-hoverable` → `page.getByTestId("inspector-history-legacy")` visible and `page.getByTestId("inspector-history")` contains `gaps drawn as gaps`; `error:429` → `data-state` `unavailable`, dek contains `rate limited (429)` and `an error is not an answer`; `responsive:mobile` → `data-state` matches `/liquidatable|near|healthy/` and `expectNoHorizontalOverflow(page)` unchanged. Its `mockInspector` helper gains a `**/v1/address/*/stress*` route serving `stress-dm.json` (import the JSON through `tests/fixtures/inspector.ts` or read it as the lab fixtures do) and a `**/v1/evidence*` route serving `EVIDENCE_MANIFEST`. | the contract spec + `inspector-view.spec.ts` |
| `runbook-bsplit.spec.ts` | "CLICKING a mover opens the Inspector's DYNAMIC route with that account on it" | keep the click and the URL assertion; replace the three DOM assertions after it with `await expect(page.getByTestId("inspector-address-input")).toHaveValue(DM_MOVER_ACCOUNT)`, `await expect(page.getByTestId("inspector-verdict")).toContainText(truncateAddress(DM_MOVER_ACCOUNT))` and `await expect(page.getByTestId("inspector-surface")).toHaveAttribute("data-state", /liquidatable|near|healthy/)`; add the `/stress` and `/evidence` routes to `mockInspectorFor` | deep link carries the address (spec §7) |
| `p0-fixes.spec.ts` | `p0-3` (2), `p0-4` (1), `p0-8 · absent boundaries` (3), `p0-9` "finding 3: the observed prices:null…" (1) | retire (7) | `inspector-position.spec.ts` "boundaryOf: absent, breached, no-price-path and unreadable arms" pins the absent, `prices:null`, null-`lowest_healthy_price` and uncertified arms; the DM/Aave card vocabulary is now the legacy card's own words |
| `p1b-fixes.spec.ts` | `p1b-4` (2), `p1b-6` "fix 4" (2) | retire (4) | `inspector-position.spec.ts` (the `[null]` entry and the deleted `price_decimals` → `unreadable`); the contract spec "history: a differing vantage is stated" |
| `r1-fixes.spec.ts` | "(2) THE BLOCKER…", "(2) a HEALTHY never_liquidatable…", "(12) the DM card renders its OWN totals…", "(12) DM risk params render as PERCENTAGES…", "(3) the Inspector states its own lookup's batch age", "(11) the history head and meta line…", "(11) an engine the account has NEVER touched…", "(10) the adjudicated intros render…" | retire (8) | `boundaryOf` returns `breached` for a liquidatable verdict even with `never_liquidatable: true`, and `no-price-path` with the wire reason on a healthy one (unit-pinned); tiles are the position's own numbers (contract spec); the Snapshot chip is the lookup's own age (`inspector-view.spec.ts`); the landing's copy is R9's |
| `r3-fixes.spec.ts` | all 3 | retire (3) | liq-bonus rendering left the Inspector with the position card; `params-format.spec.ts` still pins the arithmetic |
| `r4-fixes.spec.ts` | "(1) the Inspector reconciles its OWN lookup on resume…" | retire (1) | contract spec "resume: a failed background repair never replaces the rendered position" |
| `r6-fixes.spec.ts` | "(2) the Inspector: same law, its own envelope…" | retire (1) | same |

After editing, remove imports that became unused (eslint will name them).

- [ ] **Step 5: The whole suite**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build`, kill any stale :3111 server, then `npx playwright test`
Expected: all green; the unit count is higher than Plan 1's close (1,057) despite the retired `inspector-lines.spec.ts`.

- [ ] **Step 6: The ledger**

Append to `.superpowers/sdd/progress-ui-overhaul.md` under a heading `## 2026-09-15 · Plan 2 (Inspector) — retirements`, one line per file:

```
- tests/e2e/inspector.spec.ts: rewritten as the Inspector page-test contract (15 pins); the 19 old pins described the retired position card, HF-history card and proof fold.
- tests/e2e/p0-fixes.spec.ts: 7 Inspector pins retired (p0-3, p0-4, p0-8 boundary arms, p0-9 f3) — the boundary arms are unit-pinned in tests/unit/inspector-position.spec.ts.
- tests/e2e/p1b-fixes.spec.ts: 4 retired (p1b-4 ×2 → unit "unreadable" arms; p1b-6 fix 4 ×2 → contract "history: a differing vantage is stated").
- tests/e2e/r1-fixes.spec.ts: 8 retired — never_liquidatable vs verdict, own totals, DM percent params, own age, history head, never-touched engine, landing intro; laws now in inspector-position / inspector-view unit specs and the contract.
- tests/e2e/r3-fixes.spec.ts: 3 retired — liq-bonus premium rendering left the Inspector with the position card; params-format.spec.ts keeps the arithmetic.
- tests/e2e/r4-fixes.spec.ts, r6-fixes.spec.ts: 1 each retired → contract "resume: a failed background repair never replaces the rendered position".
- tests/e2e/state-matrix.spec.ts: 7 Inspector cells re-expressed against data-state and the pinned headlines.
- tests/e2e/runbook-bsplit.spec.ts: the mover deep link re-expressed (field value, kicker, data-state).
- tests/e2e/shell.spec.ts: /inspector H1 → "Is this address at risk?" (ruling R9).
- tests/unit/inspector-lines.spec.ts: retired with lib/inspector-lines.ts; activityTakeaway and its pins moved verbatim to lib/activity-rows.ts / tests/unit/activity-rows.spec.ts.
- Deleted: app/inspector/AddressEntry.tsx, app/inspector/[addr]/{InspectorPositionCard,InspectorHistory,InspectorActivity}.tsx, lib/inspector-lines.ts.
```

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/inspector.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/runbook-bsplit.spec.ts web/tests/e2e/p0-fixes.spec.ts web/tests/e2e/p1b-fixes.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r3-fixes.spec.ts web/tests/e2e/r4-fixes.spec.ts web/tests/e2e/r6-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git add -u web/app/inspector web/lib/inspector-lines.ts web/tests/unit/inspector-lines.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Inspector page-test contract; the old position card, history card, activity list and their pins retired with ledger notes"
```

---

