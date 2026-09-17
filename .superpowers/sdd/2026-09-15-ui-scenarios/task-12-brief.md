### Task 12: The page-test contract, and retiring the old Lab's components and pins (R14)

**Files:**
- Rewrite: `web/tests/e2e/lab.spec.ts`
- Delete: every file under `web/app/lab/` except `page.tsx`, `lab.module.css` and the Task 11 files (`LabSurface, money, LabTiles, TransitionCard, MoversTable, LegacyResult, AssumptionsDrawer, AddressWorkspace, StaleBanner`); `web/tests/e2e/{tornado,runbook-transition,runbook-bsplit,chart-spec-v4}.spec.ts` where nothing survives (see the mapping); `web/tests/unit/{address-binding,bad-debt-rate,engine-classification,flip-ranking,frontier-scale,lab-dek,lab-frontier,lab-matrix,lab-panel-lines,lab-runbook-lines,lab-transition,matrix-outcome,mover-dumbbells,scenario-lines,set-run-classification,tornado-lines,set-run-outcome}.spec.ts` (the moved specs from Tasks 4 and 7 are their homes now; `set-run-outcome.spec.ts` stays if it imports only `lib/` — check and say)
- Modify: `web/tests/e2e/{shell,state-matrix,w3l-slots,book-charts,r1-fixes,r10-fixes,inspector}.spec.ts`; `.superpowers/sdd/progress-ui-overhaul.md` (retirement ledger)
- Check and delete if the old Lab was the only importer: `web/components/charts/FrontierLedger.tsx`, `web/components/charts/WaterfallSteps.tsx`

**Interfaces:**
- Consumes the test-id contract (Task 11), `tests/fixtures/demo` (`DEMO_SCENARIOS`, `DEMO_RUN_BOOK_ETH`, `DEMO_RUN_BOOK_SET`, `DEMO_META`, `DEMO_ADDRESS_NEAR`, `DEMO_STRESS_NEAR`, `DEMO_HISTORY_NEAR`, `DEMO_EVENTS_NEAR`, `DEMO_PARAMS_DM`, `DEMO_NEAR_ADDR`), `tests/fixtures/proof` (`EVIDENCE_MANIFEST`), `tests/fixtures/inspector` (`ADDRESS_NOT_FOUND`, `NOT_FOUND_ADDR`), `tests/fixtures/{error-not-found,error-unavailable,error-rate-limited}.json`.
- Produces: the Scenarios page-test contract (spec §7): cold load dispatches nothing, one POST per click, identity chips present, refused never zero, never summed, deep links carry the scenario and the address, the states and banners.

- [ ] **Step 1: The contract spec (replaces the file)**

```ts
// web/tests/e2e/lab.spec.ts
// The Scenarios page-test contract (spec 2026-09-15 §5.4, §7). Mocked from the
// demo dataset for the primary state (the demo Book's own eth_minus_30 run)
// and shaped bodies for the other outcomes. Every headline string here is
// produced by lib/lab-headline.ts; every figure is the demo Book's.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  DEMO_ADDRESS_NEAR,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_RUN_BOOK_ETH,
  DEMO_RUN_BOOK_SET,
  DEMO_SCENARIOS,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, NOT_FOUND_ADDR } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, headers: { ...CORS, ...headers }, contentType: "application/json", body: JSON.stringify(body) });
const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));

interface Mocks {
  scenarios?: unknown;
  runBook?: unknown;
  runBookStatus?: number;
  runBookHeaders?: Record<string, string>;
  runBookDelayMs?: number;
  set?: unknown;
  setStatus?: number;
  address?: unknown;
  addressStatus?: number;
  stress?: unknown;
  stressStatus?: number;
}

/** Every route the page can issue is answered; `*` never crosses `/`, so the listing route does not swallow the run routes. */
async function mockLab(page: Page, m: Mocks = {}): Promise<{ runs: () => number; sets: () => number; lookups: () => number }> {
  let runs = 0;
  let sets = 0;
  let lookups = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, m.stress ?? DEMO_STRESS_NEAR, m.stressStatus ?? 200));
  await page.route("**/v1/address/*", (route) => {
    lookups += 1;
    return json(route, m.address ?? DEMO_ADDRESS_NEAR, m.addressStatus ?? 200);
  });
  await page.route("**/v1/scenarios/run-book-set", (route) => {
    sets += 1;
    return json(route, m.set ?? DEMO_RUN_BOOK_SET, m.setStatus ?? 200);
  });
  await page.route("**/v1/scenarios/*/run-book", async (route) => {
    runs += 1;
    if (m.runBookDelayMs !== undefined) await new Promise((r) => setTimeout(r, m.runBookDelayMs));
    return json(route, m.runBook ?? DEMO_RUN_BOOK_ETH, m.runBookStatus ?? 200, m.runBookHeaders);
  });
  await page.route("**/v1/scenarios", (route) => json(route, m.scenarios ?? DEMO_SCENARIOS));
  return { runs: () => runs, sets: () => sets, lookups: () => lookups };
}

const surface = (page: Page) => page.getByTestId("lab-surface");
const headline = (page: Page) => page.getByTestId("lab-verdict-headline");
const dek = (page: Page) => page.getByTestId("lab-verdict-dek");
const chip = (page: Page, label: string) => page.locator(`[data-chip='${label}']`);
const tile = (page: Page, key: string) => page.getByTestId(`lab-kpi-${key}`);
const cell = (page: Page, from: number, to: number) => page.getByTestId(`lab-heatmap-cell-${String(from)}-${String(to)}`);
const runIt = async (page: Page) => {
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "result");
};
const withCash = (patch: (e: (typeof DEMO_RUN_BOOK_ETH)["engines"][number]) => unknown) => ({
  ...DEMO_RUN_BOOK_ETH,
  engines: DEMO_RUN_BOOK_ETH.engines.map((e) => (e.engine === "debt_manager" ? patch(e) : e)),
});

test("cold load: the library from the listing, the first scenario's definition, nothing dispatched, tiles in the not-run register", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  const rows = page.locator("[data-testid^='lab-library-row-']");
  await expect(rows).toHaveCount(DEMO_SCENARIOS.scenarios.length);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toHaveAttribute("data-outcome", "not-run");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Not run yet");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText(DEMO_SCENARIOS.scenarios[0]!.description);
  await expect(headline(page)).toHaveText("ETH -30 percent — 1 committed shock, not run yet.");
  await expect(page.getByTestId("lab-projection")).toContainText("PROJECTION");
  await expect(page.getByTestId("lab-run")).toHaveText("Run ETH -30 percent");
  for (const key of ["newly", "debt", "baddebt", "moved"]) {
    await expect(tile(page, key)).toContainText("—");
    await expect(tile(page, key)).toContainText("not run");
    await expect(tile(page, key)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(page.getByTestId("lab-drawer")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(0);
});

test("one click, one POST: the demo result — the §3.5 headline, the dek, the identity chips, the four tiles, the library's outcome word", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  expect(counts.runs()).toBe(1);
  await expect(headline(page)).toHaveText("$1.2M more Cash debt becomes liquidatable, across 118 accounts.");
  await expect(dek(page)).toHaveText(
    "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.",
  );
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(chip(page, "Scenario")).toContainText("eth_minus_30 · v1");
  await expect(chip(page, "Computed")).toContainText("ago");
  await expect(chip(page, "Engines")).toContainText("Aave v3 market (legacy) and Cash");
  await expect(chip(page, "Config")).toContainText("v1");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(tile(page, "newly")).toContainText("was 49, now 167");
  await expect(tile(page, "newly")).toHaveAttribute("data-tone", "crit");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(tile(page, "debt")).toContainText("$6,949 → $1.2M");
  await expect(tile(page, "baddebt")).toContainText("+$40K");
  await expect(tile(page, "baddebt")).toContainText("$239.60 → $41K");
  await expect(tile(page, "baddebt")).toHaveAttribute("data-tone", "warn");
  await expect(tile(page, "moved")).toContainText("941");
  await expect(tile(page, "moved")).toContainText("of 1,406 measured · 0 improved");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await expect(page.getByTestId("lab-drawer")).toBeVisible();
  // Answer before evidence: header above tiles above the heatmap above the movers.
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  expect(await y("lab-verdict")).toBeLessThan(await y("lab-kpi-newly"));
  expect(await y("lab-kpi-newly")).toBeLessThan(await y("lab-transitions"));
  expect(await y("lab-transitions")).toBeLessThan(await y("lab-movers"));
});

test("where accounts move: the wire's lanes merged into seven room bands with the true bounds; the unmeasured cell is dashed, never a zero", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const grid = page.getByTestId("lab-heatmap");
  await expect(grid).toHaveAttribute("data-merged", "true");
  await expect(grid.locator("[role='columnheader']")).toHaveText(["over cap", "< 4.76%", "4.76% – 9.09%", "9.09% – 20%", "≥ 20%", "no debt", "not measured"]);
  await expect(cell(page, 0, 0)).toHaveAttribute("data-count", "49");
  await expect(cell(page, 0, 0)).toHaveAttribute("data-movement", "held");
  await expect(cell(page, 1, 0)).toHaveText("14");
  await expect(cell(page, 1, 0)).toHaveAttribute("data-movement", "worse");
  await expect(cell(page, 4, 0)).toHaveText("18");
  await expect(cell(page, 4, 1)).toHaveText("135");
  await expect(cell(page, 4, 4)).toHaveText("932");
  await expect(cell(page, 6, 6)).toHaveText("6");
  await expect(cell(page, 6, 6)).toHaveAttribute("data-movement", "unmeasured");
  await expect(cell(page, 0, 4)).toHaveAttribute("data-count", "0");
  await expect(cell(page, 0, 4)).toHaveText("");
  await expect(page.getByTestId("lab-transitions-finding")).toHaveText(
    "Rows: room under cap today · columns: after the shock · cells are accounts. 425 accounts change band; 118 cross the cap; none improve. 6 not measured.",
  );
});

test("most affected accounts: the wire's movers, 20 of 118, rows open the Inspector, the verdict pill, the caption", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const rows = page.locator("[data-testid^='lab-movers-row-']");
  await expect(rows).toHaveCount(20);
  const first = DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!.movers[0]!;
  const firstRow = page.getByTestId(`lab-movers-row-${first.account}`);
  await expect(firstRow.locator("a")).toHaveAttribute("href", `/inspector/${first.account}`);
  await expect(firstRow).toContainText("Yes");
  await expect(page.getByTestId("lab-movers-caption")).toHaveText("showing 20 of 118 accounts moved");
});

test("a second click while a run is in flight is ignored: one POST, the button disabled, the running state", async ({ page }) => {
  const counts = await mockLab(page, { runBookDelayMs: 600 });
  await page.goto("/lab");
  const run = page.getByTestId("lab-run");
  await run.click();
  await expect(surface(page)).toHaveAttribute("data-state", "running");
  await expect(headline(page)).toHaveText("Running ETH -30 percent…");
  await expect(run).toBeDisabled();
  await expect(tile(page, "newly")).toHaveAttribute("aria-busy", "true");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(counts.runs()).toBe(1);
});

test("deep links: ?scenario= runs exactly one; an unlisted id runs nothing; both params together run nothing and say so", async ({ page }) => {
  const one = await mockLab(page);
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(one.runs()).toBe(1);
  await page.goto("/lab?scenario=ghost");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(one.runs()).toBe(1);
  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");
  await expect(page.getByTestId("lab-deeplink-notice")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(one.runs()).toBe(1);
  expect(one.sets()).toBe(0);
});

test("the selection is per scenario and a result stays with its scenario", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await page.getByTestId("lab-library-row-ethfi_minus_50").getByRole("button").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(headline(page)).toContainText("ETHFI -50 percent");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await page.getByTestId("lab-library-row-eth_minus_30").getByRole("button").click();
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(headline(page)).toContainText("$1.2M more Cash debt");
});

test("withheld: the Cash book excluded is a named refusal — no grid, dashed tiles, the legacy result still folded below", async ({ page }) => {
  await mockLab(page, {
    runBook: {
      ...DEMO_RUN_BOOK_ETH,
      engines: DEMO_RUN_BOOK_ETH.engines.filter((e) => e.engine !== "debt_manager"),
      excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven for this batch", note: "" }],
    },
  });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "withheld");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld under ETH -30 percent.");
  await expect(tile(page, "newly")).toContainText("withheld");
  await expect(tile(page, "newly")).toHaveAttribute("data-tone", "refused");
  await expect(chip(page, "Engines")).toContainText("Cash withheld");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-legacy")).toBeVisible();
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Withheld");
  await expect(page.locator("main")).not.toContainText("$0 ");
});

test("the fetch failures each name themselves: 404 not served, 503 no batch with the server's retry, 429, 500", async ({ page }) => {
  await mockLab(page, { runBook: fixture("error-not-found.json"), runBookStatus: 404 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-served");
  await expect(headline(page)).toHaveText("Book-wide stress is not served by this deployment.");
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Not served");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: fixture("error-unavailable.json"), runBookStatus: 503, runBookHeaders: { "retry-after": "30" } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "no-batch");
  await expect(dek(page)).toContainText("(503). Retry after 30s.");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: fixture("error-rate-limited.json"), runBookStatus: 429 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "rate-limited");
  await expect(headline(page)).toHaveText("Rate limited (429).");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: { error: { code: "internal", message: "internal" } }, runBookStatus: 500 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "failed");
  await expect(headline(page)).toHaveText("The service answered 500.");
});

test("a superseded batch keeps the result under a banner; a drifted listing marks the result for a previous input; a new version is its own state", async ({ page }) => {
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, batch: { ...DEMO_RUN_BOOK_ETH.batch, supersession: { ...DEMO_RUN_BOOK_ETH.batch.supersession, superseded: true } } } });
  await page.goto("/lab");
  await runIt(page);
  await expect(surface(page)).toHaveAttribute("data-banner", "superseded");
  await expect(page.getByTestId("lab-banner")).toContainText("Batch 18,251 has been superseded");
  await expect(chip(page, "Result for batch")).toContainText("18,251 · superseded");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(page.getByTestId("lab-banner-rerun")).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const drifted = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, path_assumption: "a different path" } : s)) };
  await mockLab(page, { scenarios: drifted });
  await page.goto("/lab");
  await runIt(page);
  await expect(surface(page)).toHaveAttribute("data-banner", "stale-input");
  await expect(page.getByTestId("lab-banner")).toContainText("path assumption");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const rev = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, version: "v2" } : s)) };
  await mockLab(page, { scenarios: rev });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "definition-changed");
  await expect(headline(page)).toHaveText("ETH -30 percent changed since this result was computed.");
  await expect(tile(page, "newly")).toContainText("—");
});

test("a matrix that contradicts itself is not drawn, and the page says why", async ({ page }) => {
  await mockLab(page, { runBook: withCash((e) => ({ ...e, hf_transitions: { ...e.hf_transitions, total_rows: 5 } })) });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(headline(page)).toHaveText("The result for ETH -30 percent contradicts itself.");
  await expect(dek(page)).toContainText("total_rows");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Contradictory");
});

test("never summed: the legacy result carries its own decimals in its own fold, beside the Cash tiles it never joins", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  const legacy = page.getByTestId("lab-legacy");
  await expect(legacy).toBeVisible();
  await legacy.locator("summary").click();
  await expect(page.getByTestId("lab-legacy-kpi-newly")).toContainText("14");
  await expect(page.getByTestId("lab-legacy-kpi-debt")).toContainText("+$6,000");
  await expect(page.getByTestId("lab-legacy-heatmap")).toHaveAttribute("data-merged", "false");
  await expect(page.getByTestId("lab-legacy-heatmap").locator("[role='columnheader']").first()).toHaveText("< 0.90");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(legacy).toContainText("never added together");
});

test("the drawer: path assumption, applied shocks, held flat, out of model, the exact wire values, the wire's notes; Escape closes it", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await page.getByTestId("lab-drawer").click();
  const body = page.getByTestId("lab-drawer-body");
  await expect(body).toContainText(DEMO_RUN_BOOK_ETH.path_assumption);
  await expect(body).toContainText("1,280,000.000000");
  await expect(body).toContainText(DEMO_RUN_BOOK_ETH.out_of_model[0]!);
  await expect(page.getByTestId("lab-drawer-transitions-note")).toHaveText(DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!.hf_transitions.note);
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});

test("one-address mode via ?address=: the Inspector's reading — before/after tiles, every scenario's row, the library's applicability words", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-mode", "address");
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(headline(page)).toHaveText("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  await expect(page.getByTestId("lab-address-kpi-debt-before")).toContainText("$4,822");
  await expect(page.getByTestId("lab-address-kpi-cap-before")).toContainText("$5,012");
  await expect(page.getByTestId("lab-address-kpi-room-before")).toContainText("$190.50");
  await expect(page.getByTestId("lab-address-kpi-status-before")).toContainText("Near cap");
  await expect(page.getByTestId("lab-address-kpi-status-after")).toContainText("Liquidatable");
  await expect(page.getByTestId("lab-address-kpi-room-after")).toContainText("over cap by $");
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  await expect(page.getByTestId("lab-library-row-eth_minus_30")).toContainText("Applies to this address");
  await expect(page.getByTestId("lab-library-check-eth_minus_30")).toHaveCount(0);
  await expect(page.getByTestId("lab-address-input")).toHaveValue(DEMO_NEAR_ADDR);
  expect(counts.lookups()).toBe(1);
  await page.getByTestId("lab-mode-book").click();
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
});

test("one-address mode: an invalid address is an inline refusal and never a request; a not-found address is a complete answer", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await page.getByTestId("lab-mode-address").click();
  await expect(surface(page)).toHaveAttribute("data-state", "idle");
  await page.getByTestId("lab-address-input").fill("0xnope");
  await page.getByTestId("lab-address-inspect").click();
  await expect(page.getByTestId("lab-address-refused")).toBeVisible();
  await page.waitForTimeout(300);
  expect(counts.lookups()).toBe(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { address: ADDRESS_NOT_FOUND, stress: { ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] } });
  await page.goto(`/lab?address=${NOT_FOUND_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  await expect(headline(page)).toContainText("No Cash position for");
  await expect(page.locator("main")).not.toContainText("Cannot say");
});

test("the first viewport at 1440×900 holds the library head, the verdict, the tiles and the top of the heatmap; 390 wide has no horizontal overflow", async ({ page }) => {
  await mockLab(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  for (const id of ["lab-library", "lab-verdict", "lab-kpi-moved"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  }
  expect((await page.getByTestId("lab-transitions").boundingBox())!.y).toBeLessThan(900);
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

If `AddressField` names its refusal test id differently from `lab-address-refused` (check Plan 2's `AddressField.tsx`: it derives `${testId}-refused`), the pin follows the kit. `fixture("error-unavailable.json")` etc. are the contract's error envelopes already in `tests/fixtures/`.

- [ ] **Step 2: Run the contract**

Run: from `web/`: `npm run build`, kill any stale :3111, `npx playwright test --project=e2e tests/e2e/lab.spec.ts`
Expected: 16 passed. A page defect found here is fixed in the Task 11 files and named in the report; a wrong expectation is fixed in the spec with the reason — the demo Book's figures and `lib/lab-headline.ts` are the law.

- [ ] **Step 3: The retirement mapping (R14) — every old pin has a home or a ledger line**

Apply, file by file. "→ C𝑛" is the contract test above by order; "→ unit" names the module spec; "retired" means the surface it pinned no longer exists and the law, if any, is stated.

`web/tests/e2e/lab.spec.ts` (30 old pins, replaced by the contract): COLD ARRIVAL zero requests → C1; the committed list from the listing → C1 (+ unit `lab-library`); `?scenario=` exactly one / bare arrival none → C6, C1; an unpublished deep-link id runs nothing → C6; address mode reachable but secondary → C14 (book is the default mode); honest 404 → C9; the served run-book renders → C2; 503 no-batch → C9; `found:null` cannot-be-established, never no position → unit `lab-address` (withheld arm) and C15's not-found arm; address 429 → state-matrix `lab × error:429` (Step 4); an invalid address never becomes a request → C15; SUPERSESSION named, kept, never mixed → C10; the row DECLARES its shock axes → C1 (the library prints the definition) + C13 (applied shocks in the drawer); chips from the wire's set → C1. Retired: the frontier (five tests: render, monotonicity, 503 on /v1/book, frontier reads its own batch, W-3L refusal takeaway) — the loss frontier is the Book's stress preview (Plan 1, `lib/stress-preview.ts` unit pins); the matrix's five cell states and its disclosure — the matrix is the library + workspace (states pinned in C1/C8/C9/C11); the depeg flagship `hfs_unchanged` and the boundary/PROJECTION panel — the address-level realization and horizons live in Plan 2's `address-stress` unit pins and the Inspector's stress table; exact rationals / held_flat / snap disclosures → C13 (drawer); the W-3L dek-at-head and CommittedDetail — the composition is the verdict header (C2 asserts the DOM order); r83 ×3 and r84 (book re-read arbitration) — the new page never re-reads the Book; W-3L (194) settlement line — retired.

`web/tests/e2e/runbook-bsplit.spec.ts` (26): both distributions + movers + collateral breakdown → C2 (tiles), C4 (movers); the SHIFT reading line → C2 (headline); the served book RECONCILES with itself → unit `lab-transitions` (the guards) + `demo-lab-weld`; DM movers show the flip, the rational, the debt → C4 + unit `lab-movers`; AAVE movers speak WADS → unit `lab-movers`; an engine that moved NOTHING says so → unit `lab-headline` ("No Cash account changes band") + unit `lab-library` ("No band change"); NONE of the surfaces without a served book → C1; CLICKING a mover opens the Inspector → C4. Retired: the unpriced holding / per-side collateral breakdown / colliding collateral rows (the breakdown is not on the new page); VIEW 4 dumbbells ×2 and r88 ×2 (the drifted `wad_scale` guard lives in `laneReading`, unit); VIEW 5 partition ×2, r89, r90 ×2, r92, r93 (the flip partition strip is gone; a contradicted ranking is named by `moversTable.unreadable`, unit); VIEW 7 rate pair ×2 and r95 ×2 (the bad-debt rate view is gone). Delete the file.

`web/tests/e2e/runbook-transition.spec.ts` (17): ONE matrix per engine with the crossings → C3 + C12 (legacy grid); the unmeasured cell in the refusal register → C3 (`data-movement="unmeasured"`, dashed); the wire's note VERBATIM → C13 (`lab-drawer-transitions-note`); A CONTRADICTORY MATRIX IS NOT DRAWN → C11; no matrix without a served book → C1; a WITHHELD engine has no matrix, the served one still has → C8. Retired with a ruling: "the Debt Manager's matrix is a DISCLOSURE and carries no verdict tint" — for Cash the ratio's over-cap band IS the strict rule `debt > cap` (`num < den`; `num === den` sits in the `1.00 – 1.05` lane), so the tint is the verdict, not a guess; "the method line refuses the confusion the field name invites" — the drawer names the fields; the flow ribbons (nine tests) — the flow chart is gone; its one-ended unmeasured law is `laneReading`'s `movement: "unmeasured"` (unit). Delete the file.

`web/tests/e2e/tornado.spec.ts` (20): every pin is on the tornado UI, which is gone. The set-run LAWS move: exact ids posted / one POST / in-flight refusal / superseded arm / busy settlement → Task 13's Compare pins; `?scenarios=` rides the listing with filtered ids named, both params run nothing, `*` refused by name → C6 and unit `lab-deep-link` (moved); a refused result contributes nothing / no denominator / the refused-locally guard → unit `lab-compare`. Delete the file; the ledger line names Task 13 as the home of the first group (a Plan 3b if Compare is cut).

`web/tests/e2e/chart-spec-v4.spec.ts`: the frontier and run-book-distribution pins (AC-34/35/36/37, AC-38, AC-40/42/43/45, AC-41, AC-46 ×2, AC-47/48, AC-53, AC-54 ×2, AC-50) → retired (the frontier is the Book's; the distributions are the heatmap's margins); AC-49 "always signed" → C2 (`+$1.2M`, `+$40K`); AC-51 grouping ≥ 1,000 → C2/C4 + the `human-usd`/`human-price` unit pins. Delete the tests; keep the file only if non-Lab tests remain (read it — if every test is a Lab test, delete the file).

`web/tests/e2e/w3l-slots.spec.ts` (the nine Lab tests): DOM-order laws for components that no longer exist → retired; the order law (answer → evidence → method) is C2's `boundingBox` ordering. Keep the file's non-Lab tests.

`web/tests/e2e/book-charts.spec.ts` (three Lab tests): held-flat details (address mode) → retired (the address-level shocks are the Inspector's stress table, Plan 2); the realization gloss → retired (same); run-book wire notes as counted details → C13. Keep the non-Lab tests.

`web/tests/e2e/r1-fixes.spec.ts` "(5) a NOT-FOUND stress is still a complete answer — and book mode never needed it" → C15 (not-found arm); `web/tests/e2e/r10-fixes.spec.ts` "(3) RECEDED WATERMARK, MATCHING FRONTIER" → retired (frontier). Remove the two tests and their helpers; update the header comments.

`web/tests/e2e/shell.spec.ts`: the `/lab` row's `h1` becomes the not-run headline of the first listed scenario under whatever `/v1/scenarios` body the shell spec serves (read its mock; with the contract `scenarios.json` it is `ETH -30 percent — 1 committed shock, not run yet.`; if the shell spec serves no listing, route `DEMO_SCENARIOS` for that row).

`web/tests/e2e/state-matrix.spec.ts` (four `lab` cells): `lab × ok` → `path: "/lab?address=<DEMO_NEAR_ADDR>"`, mocks the Inspector routes + the listing, verifies `lab-surface[data-state="rows"]` and `lab-address-table` rows = `DEMO_STRESS_NEAR.scenarios.length`; `lab × refused:found-null-unknowable` → `?address=<ADDRESS_UNKNOWABLE's address>` with `ADDRESS_UNKNOWABLE` for the lookup and the `stress-unknowable.json` body, verifies `data-state="withheld"`, headline contains "Cannot say", `main` not containing "No Cash position"; `lab × error:429` → the stress route answering 429 (`error-rate-limited.json`), verifies `data-state="unavailable"` and headline "The scenarios for … could not be run."; `lab × degraded:run-book-not-served-404` → book mode, click `lab-run`, verifies `data-state="not-served"`. Replace `mockLabCold`/`runStress` with a `mockLab` helper shaped like the contract's (routes by glob; the file's `API` constant stays for the other surfaces).

`web/tests/e2e/inspector.spec.ts`: the pin asserting the toolbar's secondary `href="#stress"` becomes `href="/lab?address=${DEMO_NEAR_ADDR}"`; the stress section's "Open Scenarios →" pin likewise.

Unit specs: delete the fifteen bound to deleted modules; `engine-classification.spec.ts`, `set-run-classification.spec.ts`, `tornado-lines.spec.ts` are deleted because their moved copies (`lab-classify-*`, `lab-deep-link`) are the homes — confirm the moved copies' test counts equal the originals' before deleting. `set-run-outcome.spec.ts`: keep if it imports only `lib/`.

- [ ] **Step 4: Delete the old Lab, re-run everything**

From the repo root, `git rm` the 31 old `web/app/lab/*` files, the three e2e files and the unit specs named above (by explicit path — never `git add -u web/app/lab`). Check `web/components/charts/FrontierLedger.tsx` and `WaterfallSteps.tsx` with `find_referencing_symbols` (or `grep -rn "FrontierLedger\|WaterfallSteps" web/app web/components web/lib`); delete each that only the old Lab imported and note it.

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`, free :3111, `npx playwright test`
Expected: clean; unit count ≥ the Task 10 count minus the deleted specs' tests plus the new; e2e 0 failed (the two screenshot Inspector pins and the Overview/Book pins unaffected; no Lab screenshot pin exists yet).

- [ ] **Step 5: The ledger**

Append to `.superpowers/sdd/progress-ui-overhaul.md` under `## 2026-09-16 · Plan 3 (Scenarios) — retirements`: one line per file named in Step 3 with the counts (re-expressed → where; retired → why), one line per deleted component file group, and the ruling on the Debt Manager tint.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/lab.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/w3l-slots.spec.ts web/tests/e2e/book-charts.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r10-fixes.spec.ts web/tests/e2e/inspector.spec.ts .superpowers/sdd/progress-ui-overhaul.md
# plus every deleted path by name (git rm already staged them)
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Scenarios page-test contract; the old Lab's matrix, tornado, frontier, run-book detail and their pins retired or re-expressed with ledger notes" -- web/tests/e2e/lab.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/w3l-slots.spec.ts web/tests/e2e/book-charts.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r10-fixes.spec.ts web/tests/e2e/inspector.spec.ts .superpowers/sdd/progress-ui-overhaul.md web/app/lab web/tests/e2e/tornado.spec.ts web/tests/e2e/runbook-transition.spec.ts web/tests/e2e/runbook-bsplit.spec.ts web/tests/e2e/chart-spec-v4.spec.ts web/tests/unit web/components/charts
```

The pathspec `web/app/lab` in the commit line covers the deletions there; `web/tests/unit` and `web/components/charts` cover the deleted specs and chart files — confirm with `git status --short` that nothing unrelated is staged under those paths before committing (another agent's work is never swept: if it is, restage by file).

---
