// web/tests/e2e/lab.spec.ts
// The Scenarios page-test contract (spec 2026-09-15 §5.4, §7). Mocked from the
// demo dataset for the primary state (the demo Book's own eth_minus_30 run)
// and shaped bodies for the other outcomes. Every headline string here is
// produced by lib/lab-headline.ts (book mode) or lib/lab-address.ts (one
// address); every figure is the demo Book's.
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
/** The two POST routes are cross-origin and preflighted; the OPTIONS leg is answered here and never counted as a run. */
const POST_CORS = {
  ...CORS,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, headers: { ...CORS, ...headers }, contentType: "application/json", body: JSON.stringify(body) });
const preflight = (route: Route) => route.fulfill({ status: 204, headers: POST_CORS, body: "" });
const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));

interface Mocks {
  scenarios?: unknown;
  scenariosStatus?: number;
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

interface Counts {
  runs: () => number;
  sets: () => number;
  lookups: () => number;
  /** The set-run request bodies, in dispatch order. */
  posted: () => readonly string[];
}

/** Every route the page can issue is answered; `*` never crosses `/`, so the listing route does not swallow the run routes. */
async function mockLab(page: Page, m: Mocks = {}): Promise<Counts> {
  let runs = 0;
  let sets = 0;
  let lookups = 0;
  const posted: string[] = [];
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
    if (route.request().method() === "OPTIONS") return preflight(route);
    sets += 1;
    posted.push(route.request().postData() ?? "");
    return json(route, m.set ?? DEMO_RUN_BOOK_SET, m.setStatus ?? 200, POST_CORS);
  });
  await page.route("**/v1/scenarios/*/run-book", async (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    runs += 1;
    if (m.runBookDelayMs !== undefined) await new Promise((r) => setTimeout(r, m.runBookDelayMs));
    return json(route, m.runBook ?? DEMO_RUN_BOOK_ETH, m.runBookStatus ?? 200, { ...POST_CORS, ...m.runBookHeaders });
  });
  await page.route("**/v1/scenarios", (route) => json(route, m.scenarios ?? DEMO_SCENARIOS, m.scenariosStatus ?? 200));
  return { runs: () => runs, sets: () => sets, lookups: () => lookups, posted: () => posted };
}

const surface = (page: Page) => page.getByTestId("lab-surface");
const headline = (page: Page) => page.getByTestId("lab-verdict-headline");
const dek = (page: Page) => page.getByTestId("lab-verdict-dek");
const chip = (page: Page, label: string) => page.locator(`[data-chip='${label}']`);
const tile = (page: Page, key: string) => page.getByTestId(`lab-kpi-${key}`);
const row = (page: Page, id: string) => page.getByTestId(`lab-library-row-${id}`);
const cell = (page: Page, from: number, to: number) => page.getByTestId(`lab-heatmap-cell-${String(from)}-${String(to)}`);
const runIt = async (page: Page) => {
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "result");
};
/** A Cash book that was not computed never prints as a zero: not in its tiles, not in the verdict. The legacy fold keeps its own honest zeros. */
const expectNoCashZero = async (page: Page) => {
  for (const key of ["newly", "debt", "baddebt", "moved"]) await expect(tile(page, key)).not.toContainText("$0");
  await expect(page.getByTestId("lab-verdict")).not.toContainText("$0");
};
type Engine = (typeof DEMO_RUN_BOOK_ETH)["engines"][number];
const cashEngine = (): Engine => {
  const e = DEMO_RUN_BOOK_ETH.engines.find((x) => x.engine === "debt_manager");
  if (e === undefined) throw new Error("the demo run carries no Cash engine");
  return e;
};
const withCash = (patch: (e: Engine) => unknown) => ({
  ...DEMO_RUN_BOOK_ETH,
  engines: DEMO_RUN_BOOK_ETH.engines.map((e) => (e.engine === "debt_manager" ? patch(e) : e)),
});
const firstScenario = (): (typeof DEMO_SCENARIOS)["scenarios"][number] => {
  const s = DEMO_SCENARIOS.scenarios[0];
  if (s === undefined) throw new Error("the demo listing is empty");
  return s;
};
/** The drawer's flag suffix for an applied shock, from the wire's own booleans: absent when none is set. */
const shockFlags = (s: (typeof DEMO_RUN_BOOK_ETH)["applied_shocks"][number]): string => {
  const words = [s.snapped ? "snapped" : null, s.base_snapped ? "base snapped" : null, s.cap_bound ? "cap bound" : null].filter((w): w is string => w !== null);
  return words.length === 0 ? "" : ` · ${words.join(" · ")}`;
};

test("cold load: the library from the listing, the first scenario's definition, nothing dispatched, tiles in the not-run register", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  const rows = page.locator("[data-testid^='lab-library-row-']");
  await expect(rows).toHaveCount(DEMO_SCENARIOS.scenarios.length);
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "not-run");
  await expect(row(page, "eth_minus_30")).toContainText("Not run yet");
  await expect(row(page, "eth_minus_30")).toContainText(firstScenario().description);
  // The mode toggle says what each mode does.
  await expect(page.getByTestId("lab-mode-book")).toHaveText("Whole book");
  await expect(page.getByTestId("lab-mode-address")).toHaveText("One address");
  await expect(headline(page)).toHaveText("ETH -30 percent — 1 committed shock, not run yet.");
  await expect(page.getByTestId("lab-projection")).toContainText("PROJECTION");
  await expect(page.getByTestId("lab-run")).toHaveText("Run ETH -30 percent");
  for (const key of ["newly", "debt", "baddebt", "moved"]) {
    await expect(tile(page, key)).toContainText("—");
    await expect(tile(page, key)).toContainText("not run");
    await expect(tile(page, key)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("lab-transitions-finding")).toHaveText("Run a scenario to see where accounts move.");
  await expect(page.getByTestId("lab-transitions")).toContainText("No result yet.");
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
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
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
  const first = cashEngine().movers[0];
  if (first === undefined) throw new Error("the demo run carries no movers");
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
  await expect(row(page, "eth_minus_30")).toContainText("Running…");
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

test("deep links: ?scenarios= posts exactly the listed ids it names, once, and pre-ticks them; an unlisted id is filtered before dispatch and named", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect.poll(() => counts.sets()).toBe(1);
  expect(counts.posted()[0]).toBe('{"scenario_ids":["eth_minus_30","ethfi_minus_50"]}');
  await expect(page.getByTestId("lab-library-check-eth_minus_30")).toBeChecked();
  await expect(page.getByTestId("lab-library-check-ethfi_minus_50")).toBeChecked();
  await expect(page.getByTestId("lab-library-check-weeth_market_depeg_oracles_held")).not.toBeChecked();
  await expect(page.getByTestId("lab-deeplink-notice")).toHaveCount(0);
  // The set is Compare's; the workspace itself has not run anything.
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(1);

  await page.goto("/lab?scenarios=eth_minus_30,ghost");
  await expect(page.getByTestId("lab-deeplink-notice")).toContainText("ghost");
  await expect.poll(() => counts.sets()).toBe(2);
  expect(counts.posted()[1]).toBe('{"scenario_ids":["eth_minus_30"]}');
});

test("the selection is per scenario and a result stays with its scenario", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(headline(page)).toContainText("ETHFI -50 percent");
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await row(page, "eth_minus_30").getByRole("button").click();
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
  await expect(row(page, "eth_minus_30")).toContainText("Withheld");
  await expectNoCashZero(page);
});

test("a hole is withheld by name, never an empty healthy book: the Cash book in neither array, in both arrays, and beside a served legacy row", async ({ page }) => {
  // Neither array names the Cash book: the result carries no row and no refusal for it.
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, engines: [], excluded_engines: [] } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "withheld");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld under ETH -30 percent.");
  await expect(dek(page)).toContainText("no row for this engine and no refusal");
  await expect(tile(page, "newly")).toContainText("withheld");
  await expect(tile(page, "debt")).not.toContainText("$0");
  await expect(row(page, "eth_minus_30")).toContainText("Withheld");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expectNoCashZero(page);

  // The Cash book in both arrays: the refusal is the answer, and the row's figures never print.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, {
    runBook: {
      ...DEMO_RUN_BOOK_ETH,
      excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven for this batch", note: "" }],
    },
  });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "withheld");
  await expect(tile(page, "newly")).toContainText("withheld");
  await expect(tile(page, "newly")).not.toContainText("118");
  await expect(page.locator("main")).not.toContainText("+$1.2M");

  // Only the legacy row served, the Cash book named nowhere: withheld for Cash, the legacy result its own.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, engines: DEMO_RUN_BOOK_ETH.engines.filter((e) => e.engine !== "debt_manager") } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "withheld");
  await expect(dek(page)).toContainText("no row for this engine and no refusal");
  await expect(page.getByTestId("lab-legacy")).toBeVisible();
  await expect(page.getByTestId("lab-legacy-kpi-newly")).toContainText("14");
});

test("a malformed wire field is refused by name: the contradictory state, the field named, nothing drawn, the route still standing", async ({ page }) => {
  await mockLab(page, { runBook: withCash((e) => ({ ...e, eligible_debt_delta_usd: "" })) });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(headline(page)).toHaveText("The result for ETH -30 percent contradicts itself.");
  await expect(dek(page)).toContainText("eligible_debt_delta_usd is outside the wire contract");
  await expect(tile(page, "debt")).toContainText("—");
  await expect(tile(page, "debt")).toContainText("contradictory");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
  await expectNoCashZero(page);
  // The route stays live: the shell and the library are still on the page.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("lab-run")).toBeEnabled();
});

test("the fetch failures each name themselves: 404 not served, 503 no batch with the server's retry, 429, 500", async ({ page }) => {
  await mockLab(page, { runBook: fixture("error-not-found.json"), runBookStatus: 404 });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-served");
  await expect(headline(page)).toHaveText("Book-wide stress is not served by this deployment.");
  await expect(row(page, "eth_minus_30")).toContainText("Not served");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  // The API exposes no Retry-After across origins, so the envelope's own retry_after_seconds is the
  // retry the page can state; a header the browser may not read never reaches the sentence.
  await mockLab(page, { runBook: fixture("error-unavailable.json"), runBookStatus: 503, runBookHeaders: { "retry-after": "30" } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "no-batch");
  await expect(headline(page)).toHaveText("No servable batch.");
  await expect(dek(page)).toContainText("(503). Retry after 5s.");

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

test("a re-run that fails replaces the result it had: nothing retained wears the new request's answer", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await expect(tile(page, "newly")).toContainText("118");
  // The later route wins: the same scenario now answers 404.
  await page.route("**/v1/scenarios/*/run-book", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, fixture("error-not-found.json"), 404, POST_CORS),
  );
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-served");
  await expect(headline(page)).toHaveText("Book-wide stress is not served by this deployment.");
  await expect(tile(page, "newly")).toContainText("—");
  await expect(tile(page, "newly")).not.toContainText("118");
  await expect(row(page, "eth_minus_30")).toContainText("Not served");
  await expect(row(page, "eth_minus_30")).not.toContainText("+$1.2M");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  expect(counts.runs()).toBe(1);
});

test("a listing that cannot be fetched says so in the library and the workspace, and nothing runs", async ({ page }) => {
  const counts = await mockLab(page, { scenarios: fixture("error-unavailable.json"), scenariosStatus: 503 });
  await page.goto("/lab");
  await expect(surface(page)).toHaveAttribute("data-state", "listing-unavailable");
  await expect(headline(page)).toHaveText("The committed scenarios could not be listed.");
  await expect(page.getByTestId("lab-library")).toContainText("The committed scenarios could not be listed.");
  await expect(page.locator("[data-testid^='lab-library-row-']")).toHaveCount(0);
  await expect(page.getByTestId("lab-run")).toBeDisabled();
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(0);
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
  await expect(row(page, "eth_minus_30")).toContainText("Contradictory");
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
  const outOfModel = DEMO_RUN_BOOK_ETH.out_of_model[0];
  if (outOfModel === undefined) throw new Error("the demo run names nothing out of model");
  await expect(body).toContainText(outOfModel);
  await expect(page.getByTestId("lab-drawer-transitions-note")).toHaveText(cashEngine().hf_transitions.note);
  // The applied shocks, each as the drawer prints it — asset (chain, source): the exact before → after wire
  // strings × num/den, and the snap flags only when the wire set them (none is set on the demo run).
  const shocks = body.locator("h3:has-text('Applied shocks') + ul > li");
  await expect(shocks).toHaveText(
    DEMO_RUN_BOOK_ETH.applied_shocks.map(
      (s) => `${s.asset} (chain ${String(s.chain_id)}, ${s.source}): ${s.before} → ${s.after} × ${s.factor_num}/${s.factor_den}${shockFlags(s)}`,
    ),
  );
  await expect(shocks).toHaveCount(DEMO_RUN_BOOK_ETH.applied_shocks.length);
  // The held-flat inputs, each with its asset, chain, source and the exact held value.
  const held = body.locator("h3:has-text('Held flat') + ul > li");
  await expect(held).toHaveText(DEMO_RUN_BOOK_ETH.held_flat.map((h) => `${h.asset} (chain ${String(h.chain_id)}, ${h.source}) at ${h.value}`));
  await expect(held).toHaveCount(DEMO_RUN_BOOK_ETH.held_flat.length);
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});

test("one-address mode via ?address=: the Inspector's reading — before/after tiles, every scenario's row, the library's own verdict words, the identity", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-mode", "address");
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(headline(page)).toHaveText("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  // The identity: the account in the kicker, the batch and the scenario as chips.
  await expect(page.getByTestId("lab-verdict")).toContainText("0x7a3f…c21e");
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(chip(page, "Scenario")).toContainText("eth_minus_30");
  await expect(page.getByTestId("lab-address-kpi-debt-before")).toContainText("$4,822");
  await expect(page.getByTestId("lab-address-kpi-cap-before")).toContainText("$5,012");
  await expect(page.getByTestId("lab-address-kpi-room-before")).toContainText("$190.50");
  await expect(page.getByTestId("lab-address-kpi-status-before")).toContainText("Near cap");
  await expect(page.getByTestId("lab-address-kpi-status-after")).toContainText("Liquidatable");
  await expect(page.getByTestId("lab-address-kpi-room-after")).toContainText("over cap by $");
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  // The library's words are the rows' own verdicts, not book-mode outcomes.
  await expect(row(page, "eth_minus_30")).toContainText("Becomes liquidatable");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(row(page, "ethfi_minus_50")).toContainText("Becomes liquidatable");
  await expect(row(page, "dm_rate_horizon_plus_200bps")).toContainText("Stays inside its cap through 90d");
  await expect(row(page, "weeth_market_depeg_oracles_held")).toContainText("Not on this address");
  await expect(row(page, "weeth_market_depeg_oracles_held")).toHaveAttribute("data-outcome", "not-covered");
  await expect(page.getByTestId("lab-library-check-eth_minus_30")).toHaveCount(0);
  // Book mode's run button has no place here: the address field's Inspect is the action.
  await expect(page.getByTestId("lab-run")).toHaveCount(0);
  await expect(page.getByTestId("lab-kpi-newly")).toHaveCount(0);
  await expect(page.getByTestId("lab-address-input")).toHaveValue(DEMO_NEAR_ADDR);
  expect(counts.lookups()).toBe(1);
  await page.getByTestId("lab-mode-book").click();
  await expect(surface(page)).toHaveAttribute("data-mode", "book");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(page).toHaveURL(/\/lab$/);
  // The link carries the address again once the mode returns to it.
  await page.getByTestId("lab-mode-address").click();
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(page).toHaveURL(new RegExp(`address=${DEMO_NEAR_ADDR}`));
});

test("one-address mode: an invalid address is an inline refusal and never a request; a not-found address is a complete answer", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await page.getByTestId("lab-mode-address").click();
  await expect(surface(page)).toHaveAttribute("data-state", "idle");
  await expect(headline(page)).toHaveText("Stress one address.");
  await page.getByTestId("lab-address-input").fill("0xnope");
  await page.getByTestId("lab-address-inspect").click();
  await expect(page.getByTestId("lab-address-refused")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(300);
  expect(counts.lookups()).toBe(0);
  await expect(page).not.toHaveURL(/address=/);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { address: ADDRESS_NOT_FOUND, stress: { ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] } });
  await page.goto(`/lab?address=${NOT_FOUND_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  // A definitive negative names the batch it was established in.
  await expect(headline(page)).toHaveText(`No Cash position for 0xBBbB…0002 in batch ${String(ADDRESS_NOT_FOUND.batch.id)}.`);
  await expect(page.locator("main")).not.toContainText("Cannot say");
  await expect(row(page, "eth_minus_30")).toContainText("Not on this address");
});

test("the first viewport at 1440×900 holds the library head, the verdict, the tiles and the top of the heatmap; 390 wide has no horizontal overflow", async ({ page }) => {
  await mockLab(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  for (const id of ["lab-mode-book", "lab-library-row-eth_minus_30", "lab-verdict", "lab-kpi-moved"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box).not.toBeNull();
    if (box === null) throw new Error(`${id} has no box`);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  }
  const transitions = await page.getByTestId("lab-transitions").boundingBox();
  if (transitions === null) throw new Error("lab-transitions has no box");
  expect(transitions.y).toBeLessThan(900);
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("not covered: a scenario that models only the legacy market does not model the Cash book — the engines named, the tiles refuse, the legacy result its own, and nothing says withheld", async ({ page }) => {
  // The demo listing covers Cash on every scenario; the run-book body is eth_minus_30's own, so no definition skews.
  const legacyOnly = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, engines: ["aave_v3_etherfi"] } : s)) };
  await mockLab(page, { scenarios: legacyOnly });
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "not-covered");
  await expect(surface(page)).not.toHaveAttribute("data-banner", /.+/);
  await expect(headline(page)).toHaveText("ETH -30 percent does not model the Cash book.");
  await expect(dek(page)).toHaveText("It models the Aave v3 market (legacy). The legacy result is below.");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "not-covered");
  await expect(row(page, "eth_minus_30")).toContainText("Not modelled for Cash");
  await expect(row(page, "eth_minus_30")).toContainText("Aave v3 market (legacy)");
  for (const key of ["newly", "debt", "baddebt", "moved"]) {
    await expect(tile(page, key)).toContainText("—");
    await expect(tile(page, key)).toContainText("not modelled");
    await expect(tile(page, key)).toHaveAttribute("data-tone", "refused");
    await expect(tile(page, key)).not.toContainText("0");
  }
  await expect(page.getByTestId("lab-transitions-finding")).toHaveText("This scenario does not model Cash.");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(page.getByTestId("lab-legacy")).toBeVisible();
  await expect(page.getByTestId("lab-legacy-kpi-newly")).toContainText("14");
  // The retired law: not covered never looks like withheld.
  await expect(page.locator("main")).not.toContainText(/withheld/i);
});
