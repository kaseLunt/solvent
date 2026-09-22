// web/tests/e2e/lab.spec.ts
// The Scenarios page-test contract (spec 2026-09-15 §5.4, §7). Mocked from the
// demo dataset for the primary state (the demo Book's own eth_minus_30 run)
// and shaped bodies for the other outcomes. Every headline string here is
// produced by lib/lab-headline.ts (book mode) or lib/lab-address.ts (one
// address); every figure is the demo Book's.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { compareRows } from "../../lib/lab-compare";
import { moversCaption, moversTable } from "../../lib/lab-movers";
import {
  ASSUMPTIONS_BUTTON,
  ASSUMPTIONS_LEFT_OUT,
  ASSUMPTIONS_TITLE,
  LANE_TILE_LABEL,
  MOVERS_LINK,
  MOVERS_QUALIFIER,
  MOVERS_TITLE,
} from "../../lib/lab-view";
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
  setDelayMs?: number;
  /** A set body answered exactly as given, never shaped to the ask: the membership pins. */
  setVerbatim?: unknown;
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

type SetBody = typeof DEMO_RUN_BOOK_SET;
/** The ids a set-run request body asked for; none when the body is not the contract's. */
const askedIdsOf = (body: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(body);
    const ids = typeof parsed === "object" && parsed !== null ? (parsed as { scenario_ids?: unknown }).scenario_ids : undefined;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};
/** A set fixture answering an ask (the contract's membership law): the results the ask named, in ask order; the echo the ask itself; the evaluated count agreeing. */
const shapeSet = (set: SetBody, ids: readonly string[]): SetBody => {
  const results = ids.flatMap((id) => set.results.filter((r) => r.scenario_id === id));
  return { ...set, requested_scenario_ids: [...ids], results, evaluation: { ...set.evaluation, scenarios_evaluated: results.length } };
};
/** A body with results is shaped to the ask; a body without (an error envelope) passes as it is. */
const answerSet = (body: unknown, ids: readonly string[]): unknown =>
  typeof body === "object" && body !== null && "results" in body ? shapeSet(body as SetBody, ids) : body;

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
  await page.route("**/v1/scenarios/run-book-set", async (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    sets += 1;
    const body = route.request().postData() ?? "";
    posted.push(body);
    if (m.setDelayMs !== undefined) await new Promise((r) => setTimeout(r, m.setDelayMs));
    // The set answers the request: the fixture shaped to the asked ids, unless a pin asks for a body answered as given.
    return json(route, m.setVerbatim ?? answerSet(m.set ?? DEMO_RUN_BOOK_SET, askedIdsOf(body)), m.setStatus ?? 200, POST_CORS);
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
/** One token resolved on a live probe in the page's own theme: the colour a rule written with it computes to. */
const resolveToken = (page: Page, token: string, channel: "color" | "background" = "color"): Promise<string> =>
  page.evaluate(
    ({ name, kind }) => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      if (kind === "background") probe.style.backgroundColor = `var(${name})`;
      else probe.style.color = `var(${name})`;
      const computed = getComputedStyle(probe);
      const value = kind === "background" ? computed.backgroundColor : computed.color;
      probe.remove();
      return value;
    },
    { name: token, kind: channel },
  );
/**
 * The kit's disabled register on a control that cannot act: disabled, no pointer, ink-2 text on the panel-2 ground
 * (a ghost keeps no ground), the line for a border, and full opacity — the look is the register's own, never a live
 * button dimmed below legibility.
 */
const expectDisabledRegister = async (page: Page, id: string, ground: "panel-2" | "none") => {
  const button = page.getByTestId(id);
  await expect(button).toBeDisabled();
  await expect(button).toHaveCSS("cursor", "not-allowed");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button).toHaveCSS("color", await resolveToken(page, "--ink-2"));
  await expect(button).toHaveCSS("border-top-color", await resolveToken(page, "--line"));
  await expect(button).toHaveCSS("background-color", ground === "none" ? "rgba(0, 0, 0, 0)" : await resolveToken(page, "--panel-2", "background"));
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
  // The tile counts rows whose lane changed — not the movers (118), not the dek's band count (425) — and says so.
  await expect(tile(page, "moved")).toContainText(LANE_TILE_LABEL);
  await expect(tile(page, "moved")).toContainText("Accounts changing lane");
  await expect(tile(page, "moved")).not.toContainText(/\bmoved\b/i);
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await expect(page.getByTestId("lab-drawer")).toBeVisible();
  await expect(page.getByTestId("lab-drawer")).toHaveText(ASSUMPTIONS_BUTTON);
  await expect(page.getByTestId("lab-drawer")).toHaveText("Assumptions · What the model leaves out");
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

test("most affected accounts: the wire's movers, 20 of 118, rows open the Inspector, the verdict pill, the caption names which accounts they are and the service's cap", async ({ page }) => {
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
  // The Cash movers are the accounts whose eligibility flips false → true, ranked by debt (the wire's movers_note),
  // bounded by the contract's stated cap of 20: never "moved", the dek's word for the web's band count.
  await expect(page.getByTestId("lab-movers-caption")).toHaveText(moversCaption(moversTable(cashEngine()), "debt_manager"));
  await expect(page.getByTestId("lab-movers-caption")).toHaveText(
    "the 20 largest of the 118 accounts that become liquidatable, by debt · the service returns at most 20",
  );
  await expect(page.getByTestId("lab-movers-caption")).toHaveAttribute("title", cashEngine().movers_note);
  await expect(page.getByTestId("lab-movers").locator("h2")).toHaveText(`${MOVERS_TITLE}${MOVERS_QUALIFIER}`);
  await expect(page.getByTestId("lab-movers").locator("h2 small")).toHaveText("room today → after the shock · ranked by the service");
  // The heatmap card's link to the section names it in the same words.
  await expect(page.getByTestId("lab-transitions").getByRole("link", { name: MOVERS_LINK })).toHaveAttribute("href", "#movers");
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
  await expect(page.getByTestId("lab-deeplink-notice")).toContainText("This link names ?scenario=ghost");
  await page.waitForTimeout(300);
  expect(one.runs()).toBe(1);
  expect(new URL(page.url()).search).toBe("?scenario=ghost");
  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");
  await expect(page.getByTestId("lab-deeplink-notice")).toBeVisible();
  // The notice claims what the conflict gates — the book run — and no more.
  await expect(page.getByTestId("lab-deeplink-notice")).toContainText("no book run was dispatched for either");
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

test("a selection names itself in the URL: the address bar names the scenario on screen, a reload opens the same subject, and a link nobody selected from is never rewritten", async ({ page }) => {
  const counts = await mockLab(page);
  // The link as it arrived: the page writes nothing of its own until the reader selects.
  await page.goto("/lab?scenario=eth_minus_30");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(new URL(page.url()).search).toBe("?scenario=eth_minus_30");
  // Another scenario is selected: the URL names it, and a selection runs nothing.
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(row(page, "ethfi_minus_50")).toHaveAttribute("data-selected", "true");
  await expect(page).toHaveURL(/\/lab\?scenario=ethfi_minus_50$/);
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await expect(headline(page)).toContainText("ETHFI -50 percent");
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(1);
  // Reload: the same subject. The link is a ?scenario= link like any other, so it runs the scenario it names.
  await page.reload();
  await expect(row(page, "ethfi_minus_50")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "eth_minus_30")).not.toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("lab-verdict")).toContainText("ETHFI -50 percent");
  await expect(page.getByTestId("lab-run")).toHaveText("Run ETHFI -50 percent");
  await expect.poll(() => counts.runs()).toBe(2);
  await expect(page).toHaveURL(/\/lab\?scenario=ethfi_minus_50$/);

  // One-address mode: the selection joins the address in the URL, and a reload opens that account under that scenario.
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/lab\\?address=${DEMO_NEAR_ADDR}&scenario=ethfi_minus_50$`));
  await page.reload();
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(row(page, "ethfi_minus_50")).toHaveAttribute("data-selected", "true");
  await expect(headline(page)).toContainText("ETHFI -50 percent");

  // A set link: one URL names one scenario or a set, never both, so the selection takes the set's place in it — and
  // the notice about the link that was opened stands, because the page's own write is no link to decide again.
  await page.goto("/lab?scenarios=eth_minus_30,ghost");
  await expect(page.getByTestId("lab-deeplink-notice")).toContainText("ghost");
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(page).toHaveURL(/\/lab\?scenario=ethfi_minus_50$/);
  await expect(page.getByTestId("lab-deeplink-notice")).toContainText("ghost");
  await expect(page.getByTestId("lab-deeplink-notice")).not.toContainText("mutually exclusive");
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

test("a re-run that fails never replaces the result it had: the held figures stand under a banner naming the failure", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await expect(tile(page, "newly")).toContainText("118");
  // The later route wins: the same scenario now answers 404.
  await page.route("**/v1/scenarios/*/run-book", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, fixture("error-not-found.json"), 404, POST_CORS),
  );
  await page.getByTestId("lab-run").click();
  const banner = page.getByTestId("lab-banner");
  await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
  await expect(banner).toContainText("Run again failed — Book-wide stress is not served by this deployment.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  await expect(page.getByTestId("lab-banner-rerun")).toBeEnabled();
  // The result it had, to the figure: state, headline, tiles, grid, movers and the library's word.
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(surface(page)).toHaveAttribute("data-banner", "rerun-failed");
  await expect(headline(page)).toContainText("$1.2M more Cash debt becomes liquidatable");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M");
  await expect(row(page, "eth_minus_30")).not.toContainText("Not served");
  await expect(page.getByTestId("lab-heatmap")).toBeVisible();
  await expect(page.getByTestId("lab-movers")).toBeVisible();
  expect(counts.runs()).toBe(1);
});

test("a listing that cannot be fetched says so in the library and the workspace, and nothing runs", async ({ page }) => {
  const counts = await mockLab(page, { scenarios: fixture("error-unavailable.json"), scenariosStatus: 503 });
  await page.goto("/lab");
  await expect(surface(page)).toHaveAttribute("data-state", "listing-unavailable");
  await expect(headline(page)).toHaveText("The committed scenarios could not be listed.");
  await expect(page.getByTestId("lab-library")).toContainText("The committed scenarios could not be listed.");
  await expect(page.locator("[data-testid^='lab-library-row-']")).toHaveCount(0);
  // Nothing can run, and no control beside that sentence looks as if it could: disabled, and wearing the kit's disabled register.
  await expectDisabledRegister(page, "lab-run", "panel-2");
  await expectDisabledRegister(page, "lab-compare", "none");
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(0);
  // A link that pre-ticks two scenarios enables nothing either: the listing names the ticks that count, and it named none.
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(surface(page)).toHaveAttribute("data-state", "listing-unavailable");
  await expect(page.getByTestId("lab-compare")).toBeDisabled();
  await expect(page.getByTestId("lab-compare")).toHaveText("Compare…");
  await expect(page.getByTestId("lab-run")).toBeDisabled();
  await expect(page.getByTestId("lab-compare-state")).toHaveCount(0);
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
  // The drawer names what the model leaves out in its own words, never the tiles' "not modelled".
  await expect(page.getByRole("dialog", { name: ASSUMPTIONS_TITLE })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Assumptions & what the model leaves out" })).toBeVisible();
  await expect(body.locator("h3", { hasText: ASSUMPTIONS_LEFT_OUT })).toHaveText("Left out of the model");
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
  // The projection that holds reads as it does on the Inspector under the same header: through its longest horizon, never a bare "No".
  const holding = page.getByTestId("lab-address-table").locator("tbody tr").filter({ hasText: "Debt Manager borrow APY +200bps" }).locator("td").nth(3);
  await expect(holding).toHaveText("Not within 90d");
  await expect(holding.locator("[title]")).toHaveAttribute("title", "a projection speaks only through its longest horizon");
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

test("one-address mode, resume: a repair that moves the position replays no stress — the stress-batch chip and the dek say the stress is from the previous lookup, in the Inspector's words", async ({ page }) => {
  await mockLab(page);
  let stressRequests = 0;
  page.on("request", (request) => {
    if (/\/v1\/address\/[^/]+\/stress/.test(request.url())) stressRequests += 1;
  });
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  // One batch, one lookup: no second chip.
  await expect(chip(page, "Stress for batch")).toHaveCount(0);
  const stressBefore = stressRequests;
  // The repair lands the same account one batch on.
  let repairs = 0;
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => {
    repairs += 1;
    return json(route, { ...DEMO_ADDRESS_NEAR, batch: { ...DEMO_ADDRESS_NEAR.batch, id: DEMO_ADDRESS_NEAR.batch.id + 1 } });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(() => repairs).toBe(1);
  await expect(chip(page, "Result for batch")).toContainText("18,252");
  await expect(chip(page, "Stress for batch")).toContainText("18,251 · stress from the previous lookup");
  await expect(headline(page)).toHaveText("Cannot say — the stress result is for batch 18,251; the position above is batch 18,252.");
  await expect(dek(page)).toContainText("Stress from the previous lookup, for batch 18,251; the position above was refreshed since and is batch 18,252.");
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  // The premise, pinned: the repair refreshed the position alone.
  expect(stressRequests).toBe(stressBefore);
});

test("one-address mode: a stress result that names no readable batch is not compared — the chip says so in the Inspector's words, the tiles are refused, the rows stay", async ({ page }) => {
  await mockLab(page, { stress: { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: -1 } } });
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(chip(page, "Stress for batch")).toContainText("not readable");
  await expect(headline(page)).toHaveText("Cannot say — the stress result names no readable batch; the position above is batch 18,251.");
  await expect(dek(page)).toHaveText("The scenarios below are the stress result's own. A stress result and a position are compared only when both name the same batch.");
  // No tile sets the position beside a stress nobody can place: every one is the refused dash, none a figure.
  for (const key of ["debt", "cap", "room", "status"]) {
    for (const side of ["before", "after"]) {
      const kpi = page.getByTestId(`lab-address-kpi-${key}-${side}`);
      await expect(kpi).toContainText("—");
      await expect(kpi).not.toContainText("$");
    }
  }
  // The rows are the stress result's own and stay, under a qualifier that says what is not known of them.
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  await expect(page.getByTestId("lab-address-section")).toContainText("applied to this account at a batch the stress result does not name readably · the position above is batch 18,251");
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
  // A definitive negative names the batch it was established in — the STRESS response's own (18,251), never the lookup's (1).
  expect(ADDRESS_NOT_FOUND.batch.id).not.toBe(DEMO_STRESS_NEAR.batch.id);
  await expect(headline(page)).toHaveText("No Cash position for 0xBBbB…0002 in batch 18,251.");
  await expect(dek(page)).toHaveText(`That is the stress response's own answer, for its own batch; the lookup above is batch ${String(ADDRESS_NOT_FOUND.batch.id)} and holds no Cash position either.`);
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

test("a failed re-run over a held result keeps the held result's own condition beside the failure, and never shows a retained body whose definition changed", async ({ page }) => {
  // A result under a drifted path assumption, then a failed re-run: both sentences, the figures kept.
  const drifted = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, path_assumption: "a different path" } : s)) };
  await mockLab(page, { scenarios: drifted });
  await page.goto("/lab");
  await runIt(page);
  await expect(surface(page)).toHaveAttribute("data-banner", "stale-input");
  await page.route("**/v1/scenarios/*/run-book", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, fixture("error-not-found.json"), 404, POST_CORS),
  );
  await page.getByTestId("lab-run").click();
  const banner = page.getByTestId("lab-banner");
  await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
  await expect(banner).toHaveAttribute("data-held", "stale-input");
  await expect(banner).toContainText("Run again failed — Book-wide stress is not served by this deployment.");
  await expect(banner).toContainText("the listing's path assumption changed since this run.");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(tile(page, "newly")).toContainText("118");

  // A result under another version, then a failed re-run: the request's own failure, the retained batch disclosed, nothing shown.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const rev = { ...DEMO_SCENARIOS, scenarios: DEMO_SCENARIOS.scenarios.map((s) => (s.id === "eth_minus_30" ? { ...s, version: "v2" } : s)) };
  await mockLab(page, { scenarios: rev });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "definition-changed");
  await page.route("**/v1/scenarios/*/run-book", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, fixture("error-not-found.json"), 404, POST_CORS),
  );
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "not-served");
  await expect(headline(page)).toHaveText("Book-wide stress is not served by this deployment.");
  await expect(surface(page)).toHaveAttribute("data-banner", "retained-refused");
  await expect(banner).toContainText("A result for batch 18,251 is retained but not shown: the definition's version changed since it was computed.");
  await expect(banner).toContainText("The failure above is this request's own.");
  await expect(tile(page, "newly")).toContainText("—");
  await expect(tile(page, "newly")).not.toContainText("118");
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(row(page, "eth_minus_30")).toContainText("Not served");
  await expect(row(page, "eth_minus_30")).not.toContainText("+$1.2M");
});

test("compare: two ticks enable the button, one POST posts exactly those ids, the set answers them and only them, the dots rank as compareRows ranks the answered set, no label clips, each plot measures its own frame, and 390 wide scrolls the frame rather than the page", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab");
  const button = page.getByTestId("lab-compare");
  await expect(button).toHaveText("Compare…");
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("lab-compare-card")).toHaveCount(0);
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await expect(button).toBeDisabled();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await expect(button).toHaveText("Compare 2 scenarios");
  await expect(button).toBeEnabled();
  // Two ticks stand the card up, idle; nothing is dispatched until Compare is pressed.
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "idle");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  expect(counts.sets()).toBe(0);
  await button.click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  expect(counts.sets()).toBe(1);
  expect(counts.posted()[0]).toBe('{"scenario_ids":["eth_minus_30","ethfi_minus_50"]}');
  // The finding leads the card in the lib's words; the caption is one plain line naming the batch; the value column is headed and the axis captioned.
  await expect(page.getByTestId("lab-compare-state")).toHaveText("ETH -30 percent moves the most: +$1.2M more liquidatable Cash debt, 4.5% of the book. ETHFI -50 percent: +$9,800, under 0.1%.");
  await expect(page.getByTestId("lab-compare-caption")).toHaveText("Change in liquidatable Cash debt per scenario, as a share of the Cash book (batch 18,251).");
  await expect(page.getByTestId("lab-dotplot")).toContainText("share · change");
  await expect(page.getByTestId("lab-dotplot")).toContainText("share of the Cash book");
  await expect(page.getByTestId("lab-compare-superseded")).toHaveCount(0);
  // The rows are the answered set's own — the two asked ids and no other — in the order compareRows ranks them: |share|, then |Δ|, then wire order.
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const expected = compareRows(shapeSet(DEMO_RUN_BOOK_SET, asked), "debt_manager").rows;
  const ids = await page.locator("[data-testid^='lab-compare-row-']").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(ids).toEqual(expected.map((r) => `lab-compare-row-${r.id}`));
  expect(ids).toEqual(["lab-compare-row-eth_minus_30", "lab-compare-row-ethfi_minus_50"]);
  for (const r of expected) await expect(page.getByTestId(`lab-compare-row-${r.id}`)).toHaveAttribute("data-kind", r.kind === "point" ? "point" : "refused");
  await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(expected.filter((r) => r.kind === "point").length);
  // One stem per point, from zero to the dot: the magnitude, not only the position.
  await expect(page.getByTestId("lab-dotplot").locator("line[data-role='stem']")).toHaveCount(expected.filter((r) => r.kind === "point").length);
  // The demo figures, to the character: the share, then the absolute delta; the book is the caption's word, not the row's; a share under a tenth is unsigned.
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).not.toContainText("Cash book");
  await expect(page.getByTestId("lab-compare-row-ethfi_minus_50")).toContainText("<0.1% · +$9,800");
  await expect(page.getByTestId("lab-compare-row-ethfi_minus_50")).not.toContainText("+<");
  // A rise too small for a tenth is still a rise: a critical dot on the rising side of zero, never an ok dot AT zero.
  const smallRise = page.getByTestId("lab-compare-row-ethfi_minus_50");
  await expect(smallRise.locator("circle")).toHaveClass(/dotCrit/);
  await expect(smallRise.locator("circle")).not.toHaveClass(/dotOk/);
  const zeroX = Number(await smallRise.locator("line[data-role='stem']").getAttribute("x1"));
  const dotX = Number(await smallRise.locator("circle").getAttribute("cx"));
  expect(dotX).toBeGreaterThan(zeroX);
  // No label clips: the value column ends inside the plot's own box.
  const plotBox = await page.getByTestId("lab-dotplot").boundingBox();
  const valueBox = await page.getByTestId("lab-compare-row-eth_minus_30").locator("css=text").last().boundingBox();
  if (plotBox === null || valueBox === null) throw new Error("the plot has no box");
  expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(plotBox.x + plotBox.width);
  // The legacy market's shares fold below on their own book; the Cash plot never names it.
  await expect(page.getByTestId("lab-dotplot")).not.toContainText("legacy");
  const legacy = page.getByTestId("lab-compare-legacy");
  await expect(legacy).toBeVisible();
  // At 1024 wide each plot's width is its own frame's content box, clamped to the plot's budget — the legacy plot's too: a fold that mounts later still measures.
  await page.setViewportSize({ width: 1024, height: 800 });
  await legacy.locator("summary").click();
  const clamp = (w: number) => String(Math.round(Math.min(Math.max(w, 480), 1280)));
  const frameOf = (id: string) => page.getByTestId(id).locator("xpath=..");
  const cashFrameW = await frameOf("lab-dotplot").evaluate((n) => n.clientWidth);
  await expect(page.getByTestId("lab-dotplot")).toHaveAttribute("width", clamp(cashFrameW));
  const legacyFrameW = await frameOf("lab-dotplot-legacy").evaluate((n) => n.clientWidth);
  expect(legacyFrameW).toBeGreaterThan(0);
  expect(clamp(legacyFrameW)).not.toBe("880");
  await expect(page.getByTestId("lab-dotplot-legacy")).toHaveAttribute("width", clamp(legacyFrameW));
  await expect(page.getByTestId("lab-compare-legacy-row-eth_minus_30")).toHaveAttribute("data-kind", "point");
  await expect(page.getByTestId("lab-compare-legacy-row-eth_minus_30")).toContainText("+0.3% · +$6,000");
  await expect(page.getByTestId("lab-compare-legacy-row-ethfi_minus_50")).toHaveAttribute("data-kind", "refused");
  await expect(page.getByTestId("lab-compare-legacy-row-ethfi_minus_50")).toContainText("not modelled for the legacy market");
  await expect(legacy).toContainText("never added together");
  // The set is Compare's; the workspace itself has run nothing.
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  expect(counts.runs()).toBe(0);
  // 390 wide: the plot keeps its 480 minimum, its frame scrolls, and the page does not.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByTestId("lab-dotplot")).toHaveAttribute("width", "480");
  await expect.poll(() => frameOf("lab-dotplot").evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("compare: a scenario the set withheld for Cash is a dashed row with its word — no dot, no zero, no money", async ({ page }) => {
  const withheld = {
    ...DEMO_RUN_BOOK_SET,
    results: DEMO_RUN_BOOK_SET.results.map((r) => (r.scenario_id === "ethfi_minus_50" ? { ...r, withheld_engines: ["debt_manager"], engines: [] } : r)),
  };
  await mockLab(page, { set: withheld });
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  const row = page.getByTestId("lab-compare-row-ethfi_minus_50");
  await expect(row).toHaveAttribute("data-kind", "refused");
  await expect(row.locator("circle")).toHaveCount(0);
  // The value column says only the word: not a share, not a dollar.
  await expect(row.locator("css=text").last()).toHaveText("withheld");
  await expect(row).not.toContainText("%");
  await expect(row).not.toContainText("$");
  // Ranked after every point, and the points keep their figures; the finding names the refusal as refused.
  const ids = await page.locator("[data-testid^='lab-compare-row-']").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(ids[ids.length - 1]).toBe("lab-compare-row-ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
  await expect(page.getByTestId("lab-compare-state")).toHaveText("ETH -30 percent moves the most: +$1.2M more liquidatable Cash debt, 4.5% of the book. ETHFI -50 percent could not be evaluated: withheld.");
});

test("compare: a busy evaluator fails the set by name and frees the button; a second Compare during a set is ignored; a superseded evaluation is labelled", async ({ page }) => {
  const busy = await mockLab(page, { set: { error: { code: "set_run_busy", message: "another evaluation holds the slot", max_in_flight: 1, in_flight: 1 } }, setStatus: 503 });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  const button = page.getByTestId("lab-compare");
  const state = page.getByTestId("lab-compare-state");
  await button.click();
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveText("The evaluator is busy. Another evaluation holds the slot. 1 of 1 slots in use.");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  await expect(button).toBeEnabled();
  expect(busy.sets()).toBe(1);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const slow = await mockLab(page, {
    set: { ...DEMO_RUN_BOOK_SET, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, freshness: "superseded", newest_servable_batch_id: 18252 } },
    setDelayMs: 600,
  });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await button.click();
  await expect(state).toHaveAttribute("data-kind", "running");
  await expect(state).toHaveText("Evaluating 2 scenarios…");
  await expect(button).toBeDisabled();
  await button.click({ force: true });
  await expect(state).toHaveAttribute("data-kind", "ok");
  expect(slow.sets()).toBe(1);
  const superseded = page.getByTestId("lab-compare-superseded");
  await expect(superseded).toHaveAttribute("data-freshness", "superseded");
  await expect(superseded).toContainText("evaluated on batch 18,251; the newest servable batch is 18,252");
  await expect(page.getByTestId("lab-compare-caption")).toHaveText("Change in liquidatable Cash debt per scenario, as a share of the Cash book (batch 18,251 — superseded).");
});

test("compare: one-address mode has no Compare, and the ticks and the result survive the round trip back to the book", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  await page.getByTestId("lab-mode-address").click();
  await expect(surface(page)).toHaveAttribute("data-mode", "address");
  await expect(page.getByTestId("lab-compare")).toHaveCount(0);
  await expect(page.getByTestId("lab-compare-card")).toHaveCount(0);
  await page.getByTestId("lab-mode-book").click();
  await expect(page.getByTestId("lab-compare")).toHaveText("Compare 2 scenarios");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
});

test("compare: a set that answers ids nobody asked for is refused whole, every fault named, nothing drawn, the button freed", async ({ page }) => {
  // The demo body verbatim: four results for a two-id ask.
  const counts = await mockLab(page, { setVerbatim: DEMO_RUN_BOOK_SET });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await page.getByTestId("lab-compare").click();
  const state = page.getByTestId("lab-compare-state");
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toContainText("The set does not answer the request.");
  await expect(state).toContainText("2 ids, the response names 4");
  await expect(state).toContainText("weeth_market_depeg_oracles_held is named in requested_scenario_ids and was not dispatched");
  await expect(state).toContainText("dm_rate_horizon_plus_200bps is named in requested_scenario_ids and was not dispatched");
  await expect(state).toContainText("Nothing from it is drawn.");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  await expect(page.locator("[data-testid^='lab-compare-row-']")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("+4.5%");
  await expect(page.getByTestId("lab-compare")).toBeEnabled();
  expect(counts.sets()).toBe(1);
});

test("one-address mode: the table's verdict column is the row's own verdict and its room cells are the tiles' words — a liquidatable horizon says within, a side that is not a position is a cannot-say beside not computed, never a Yes, a No or a figure", async ({ page }) => {
  // The projection's 90d horizon flips; ETHFI's shocked side carries a negative debt (a legal string, not a position).
  const stress = {
    ...DEMO_STRESS_NEAR,
    scenarios: DEMO_STRESS_NEAR.scenarios.map((s) => {
      if (s.id === "dm_rate_horizon_plus_200bps") {
        return { ...s, results: s.results.map((r) => (!r.projection ? r : { ...r, projection: { ...r.projection, horizons: r.projection.horizons.map((h, i) => (i === 1 ? { ...h, becomes_liquidatable: true } : h)) } })) };
      }
      if (s.id === "ethfi_minus_50") return { ...s, results: s.results.map((r) => (!r.after ? r : { ...r, after: { ...r.after, debt_usd: "-4822000000" } })) };
      return s;
    }),
  };
  await mockLab(page, { stress });
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  const table = page.getByTestId("lab-address-table");
  const rowFor = (label: string) => table.locator("tbody tr").filter({ hasText: label });
  const eth = rowFor("ETH -30 percent");
  const ethfi = rowFor("ETHFI -50 percent");
  const projection = rowFor("Debt Manager borrow APY +200bps");
  // The room cells in the tiles' own words: a negative room is "over cap by", never a minus on a dollar figure.
  await expect(eth.locator("td").nth(1)).toHaveText("$190.50");
  await expect(eth.locator("td").nth(2)).toHaveText("over cap by $1,069");
  await expect(eth.locator("td").nth(3)).toHaveText("Yes");
  await expect(eth.locator("td").nth(3).locator("[data-tone='crit']")).toHaveCount(1);
  // A projection judged by its horizons: the verdict names the horizon in the warn tone the headline and the library use.
  await expect(projection.locator("td").nth(3)).toHaveText("Within 90d");
  await expect(projection.locator("td").nth(3).locator("[data-tone='warn']")).toHaveCount(1);
  await expect(row(page, "dm_rate_horizon_plus_200bps")).toContainText("Becomes liquidatable within 90d");
  // A side that is not a position: no verdict word and no figure, whatever the wire's booleans say.
  await expect(ethfi.locator("td").nth(2)).toHaveText("not computed");
  await expect(ethfi.locator("td").nth(3)).toHaveText("Cannot say");
  await expect(ethfi.locator("td").nth(3).locator("[data-tone='refused']")).toHaveCount(1);
  await expect(ethfi).not.toContainText("$4,822");
  await expect(row(page, "ethfi_minus_50")).toContainText("Cannot say");
  await expect(table).not.toContainText("−$");
});

test("a net count at or below zero states the net and the gross: the headline names the crossings, the tile prints the true minus, the library's word follows", async ({ page }) => {
  await mockLab(page, { runBook: withCash((e) => ({ ...e, newly_eligible_accounts: -3 })) });
  await page.goto("/lab");
  await runIt(page);
  await expect(headline(page)).toHaveText("Net, 3 fewer Cash accounts are liquidatable under ETH -30 percent, though 118 accounts cross the cap.");
  await expect(page.getByTestId("lab-verdict")).toHaveAttribute("data-variant", "warn");
  await expect(dek(page)).toContainText("425 accounts move to a worse band; none improve.");
  await expect(tile(page, "newly")).toContainText("−3");
  await expect(tile(page, "newly")).not.toContainText("-3");
  await expect(tile(page, "newly")).toContainText("was 49, now 167");
  // The tile wears the headline's own tone: a net below zero beside 118 crossings is warn, never the ok tone.
  await expect(tile(page, "newly")).toHaveAttribute("data-tone", "warn");
  await expect(row(page, "eth_minus_30")).toContainText("Net −3 accounts · 118 cross the cap");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-outcome", "result");
  await expect(page.locator("main")).not.toContainText("No Cash account becomes liquidatable");
});

test("one-address mode: the highlighted library row is the workspace's subject — a linked scenario the address was not stressed under is not the highlight", async ({ page }) => {
  await mockLab(page);
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}&scenario=weeth_market_depeg_oracles_held`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(headline(page)).toHaveText("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  await expect(chip(page, "Scenario")).toContainText("eth_minus_30");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "weeth_market_depeg_oracles_held")).not.toHaveAttribute("data-selected", "true");
  // The fallback is never silent: the page says which scenario was not evaluated and which is shown. The link itself
  // is left exactly as it arrived — an opened link is never rewritten to a scenario nobody asked for.
  const fallback = page.getByTestId("lab-address-fallback");
  await expect(fallback).toHaveText("weETH market depeg to 0.95 (oracles held) was not evaluated for 0x7a3f…c21e: the stress response carries no result for it. ETH -30 percent is shown instead — the first scenario this address carries.");
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe(`?address=${DEMO_NEAR_ADDR}&scenario=weeth_market_depeg_oracles_held`);
  // A row the address carries moves the subject and the highlight together.
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(headline(page)).toContainText("ETHFI -50 percent");
  await expect(fallback).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/lab\\?address=${DEMO_NEAR_ADDR}&scenario=ethfi_minus_50$`));
  await expect(row(page, "ethfi_minus_50")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "eth_minus_30")).not.toHaveAttribute("data-selected", "true");
  // A row not on the address: the subject falls back to the first row the address carries, and the highlight follows the subject — never the row clicked.
  await row(page, "weeth_market_depeg_oracles_held").getByRole("button").click();
  await expect(headline(page)).toHaveText("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "ethfi_minus_50")).not.toHaveAttribute("data-selected", "true");
  await expect(row(page, "weeth_market_depeg_oracles_held")).not.toHaveAttribute("data-selected", "true");
  // …and after the reader's own selection the URL names the subject shown, disclosed beside it: a reload opens this same screen, under the scenario it shows.
  await expect(fallback).toContainText("was not evaluated for 0x7a3f…c21e");
  await expect(page).toHaveURL(new RegExp(`/lab\\?address=${DEMO_NEAR_ADDR}&scenario=eth_minus_30$`));
  await expect(page).not.toHaveURL(/weeth_market_depeg_oracles_held/);
});

test("a re-run that answers a body which does not read never replaces the result it had: the held figures stand under a banner naming the contradiction", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await page.route("**/v1/scenarios/*/run-book", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, withCash((e) => ({ ...e, eligible_debt_delta_usd: "1e6" })), 200, POST_CORS),
  );
  await page.getByTestId("lab-run").click();
  const banner = page.getByTestId("lab-banner");
  await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
  await expect(banner).toContainText("Run again failed — The result for ETH -30 percent contradicts itself. eligible_debt_delta_usd is outside the wire contract. Nothing from it is drawn.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(headline(page)).toContainText("$1.2M more Cash debt becomes liquidatable");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(page.getByTestId("lab-heatmap")).toBeVisible();
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await expect(row(page, "eth_minus_30")).not.toContainText("Unreadable");
  // With nothing held, the same body is the contradictory state, as before, under no banner.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: withCash((e) => ({ ...e, eligible_debt_delta_usd: "1e6" })) });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(page.getByTestId("lab-banner")).toHaveCount(0);
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
});

test("compare: a second Compare that fails never replaces the comparison it had: the dots and the legacy fold stand under a line naming the failure", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  const state = page.getByTestId("lab-compare-state");
  await expect(state).toHaveAttribute("data-kind", "ok");
  await page.route("**/v1/scenarios/run-book-set", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, fixture("error-rate-limited.json"), 429, POST_CORS),
  );
  await page.getByTestId("lab-compare").click();
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveText("Compare again failed — Rate limited (429). Retry after 3s. The comparison below stands for batch 18,251.");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toHaveAttribute("data-kind", "point");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
  await expect(page.getByTestId("lab-compare-row-ethfi_minus_50")).toContainText("<0.1% · +$9,800");
  await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(2);
  await expect(page.getByTestId("lab-compare-legacy")).toBeVisible();
  await expect(page.getByTestId("lab-compare")).toBeEnabled();
});

test("compare: a legacy market withheld or not modelled in every scenario still has its fold — every row dashed with its word, no dot, no money", async ({ page }) => {
  const withheldLegacy = {
    ...DEMO_RUN_BOOK_SET,
    results: DEMO_RUN_BOOK_SET.results.map((r) =>
      r.scenario_id === "eth_minus_30" ? { ...r, withheld_engines: ["aave_v3_etherfi"], engines: r.engines.filter((e) => e.engine !== "aave_v3_etherfi") } : r,
    ),
  };
  await mockLab(page, { set: withheldLegacy });
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  const legacy = page.getByTestId("lab-compare-legacy");
  await expect(legacy).toBeVisible();
  await legacy.locator("summary").click();
  await expect(page.getByTestId("lab-dotplot-legacy").locator("circle")).toHaveCount(0);
  await expect(page.getByTestId("lab-compare-legacy-row-eth_minus_30")).toHaveAttribute("data-kind", "refused");
  await expect(page.getByTestId("lab-compare-legacy-row-eth_minus_30")).toContainText("withheld");
  await expect(page.getByTestId("lab-compare-legacy-row-ethfi_minus_50")).toHaveAttribute("data-kind", "refused");
  await expect(page.getByTestId("lab-compare-legacy-row-ethfi_minus_50")).toContainText("not modelled for the legacy market");
  await expect(legacy).not.toContainText("$");
  // The Cash plot is untouched by the legacy refusal.
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
});

test("?address= with something that is not an address is the invalid state: its own sentence, nothing looked up", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto("/lab?address=0xnope");
  await expect(surface(page)).toHaveAttribute("data-mode", "address");
  await expect(surface(page)).toHaveAttribute("data-state", "invalid");
  await expect(headline(page)).toHaveText("Not an address.");
  await expect(dek(page)).toHaveText("An address is 0x followed by exactly 40 hex characters. Nothing was looked up.");
  // No scenario row: the table carries only its empty word, the headline's own.
  await expect(page.getByTestId("lab-address-table")).toContainText("Not an address.");
  await expect(page.getByTestId("lab-address-table")).not.toContainText("ETH -30 percent");
  await page.waitForTimeout(300);
  expect(counts.lookups()).toBe(0);
});

test("compare: a row without a denominator keeps the wire's delta beside its word — no share, no dot", async ({ page }) => {
  const zeroBook = {
    ...DEMO_RUN_BOOK_SET,
    results: DEMO_RUN_BOOK_SET.results.map((r) =>
      r.scenario_id === "ethfi_minus_50" ? { ...r, engines: r.engines.map((e) => (e.engine === "debt_manager" ? { ...e, eligible_debt_delta_usd: "5000000", total_debt_usd_before: "0" } : e)) } : r,
    ),
  };
  await mockLab(page, { set: zeroBook });
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  const r = page.getByTestId("lab-compare-row-ethfi_minus_50");
  await expect(r).toHaveAttribute("data-kind", "refused");
  await expect(r.locator("circle")).toHaveCount(0);
  await expect(r.locator("css=text").last()).toHaveText("no denominator · +$5");
  await expect(r).not.toContainText("%");
});

test("two asks in one tick are one POST: a second click before the first has committed is refused by the request in flight, for a run and for a set", async ({ page }) => {
  const counts = await mockLab(page, { runBookDelayMs: 400, setDelayMs: 400 });
  await page.goto("/lab");
  await expect(page.getByTestId("lab-run")).toBeEnabled();
  await page.getByTestId("lab-run").evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  expect(counts.runs()).toBe(1);
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await expect(page.getByTestId("lab-compare")).toBeEnabled();
  await page.getByTestId("lab-compare").evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  expect(counts.sets()).toBe(1);
});

test("the envelope is classified before any read: a 2xx run-book without its batch is the contradictory state naming the field — nothing of the body printed, no zero, the route still standing", async ({ page }) => {
  // `undefined` does not survive JSON: the body arrives with no `batch` member at all.
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, batch: undefined } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(headline(page)).toHaveText("The result for ETH -30 percent contradicts itself.");
  await expect(dek(page)).toHaveText("batch is outside the wire contract. Nothing from it is drawn.");
  for (const key of ["newly", "debt", "baddebt", "moved"]) {
    await expect(tile(page, key)).toContainText("—");
    await expect(tile(page, key)).toContainText("contradictory");
    await expect(tile(page, key)).toHaveAttribute("data-tone", "refused");
  }
  // Nothing of the body is printed: no batch chip, no age, no drawer onto a body that cannot be read, no grid, no movers.
  await expect(chip(page, "Result for batch")).toHaveCount(0);
  await expect(chip(page, "Computed")).toHaveCount(0);
  await expect(chip(page, "Engines")).toHaveCount(0);
  await expect(chip(page, "Scenario")).toContainText("eth_minus_30 · v1");
  await expect(page.getByTestId("lab-drawer")).toHaveCount(0);
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(page.getByTestId("lab-banner")).toHaveCount(0);
  // The legacy fold refuses by the same name; the library's word follows.
  await expect(page.getByTestId("lab-legacy-kpi-newly")).toContainText("contradictory");
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
  await expectNoCashZero(page);
  // The route stays live: the shell and the library are still on the page, and the run can be asked again.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("lab-run")).toBeEnabled();
  // A list that is not one and a coverage that is not an object are named the same way, every fault, in wire order.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, shocks: "none", coverage: null } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(dek(page)).toHaveText("shocks is outside the wire contract; coverage is outside the wire contract. Nothing from it is drawn.");
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
});

test("two consecutive answers that do not read keep the last result that read: a malformed body never moves into the hold, and the banner names the batch that stands", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  // Both bodies that follow name another batch, so the batch the banner names can only be the first result's.
  const later = { ...DEMO_RUN_BOOK_ETH.batch, id: 18252 };
  const malformed = { ...withCash((e) => ({ ...e, eligible_debt_delta_usd: "1e6" })), batch: later };
  const malformedAgain = { ...withCash((e) => ({ ...e, bad_debt_delta_usd: "" })), batch: later };
  let answers = 0;
  await page.route("**/v1/scenarios/*/run-book", (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    answers += 1;
    return json(route, answers === 1 ? malformed : malformedAgain, 200, POST_CORS);
  });
  const banner = page.getByTestId("lab-banner");
  await page.getByTestId("lab-run").click();
  await expect(banner).toContainText("eligible_debt_delta_usd is outside the wire contract.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  // The second answer that does not read: the hold is still the result that read, never the first malformed body.
  await page.getByTestId("lab-banner-rerun").click();
  await expect(banner).toContainText("Run again failed — The result for ETH -30 percent contradicts itself. bad_debt_delta_usd is outside the wire contract. Nothing from it is drawn.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  await expect(banner).not.toContainText("18,252");
  expect(answers).toBe(2);
  await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(headline(page)).toContainText("$1.2M more Cash debt becomes liquidatable");
  await expect(tile(page, "newly")).toContainText("118");
  await expect(tile(page, "debt")).toContainText("+$1.2M");
  await expect(page.getByTestId("lab-heatmap")).toBeVisible();
  await expect(page.getByTestId("lab-movers")).toBeVisible();
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  await expect(row(page, "eth_minus_30")).not.toContainText("Unreadable");
});

test("compare: a set whose envelope is outside the contract is a failed Compare naming the field — nothing of it drawn; over a comparison already on the page, that comparison stands", async ({ page }) => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  // `undefined` does not survive JSON: the first body arrives with no `evaluation` member, the second with no `batch`.
  await mockLab(page, { setVerbatim: { ...shapeSet(DEMO_RUN_BOOK_SET, asked), evaluation: undefined } });
  await page.goto(`/lab?scenarios=${asked.join(",")}`);
  const state = page.getByTestId("lab-compare-state");
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveText("The set does not answer the request. Faults: evaluation is outside the wire contract. Nothing from it is drawn.");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  await expect(page.getByTestId("lab-compare-caption")).toHaveCount(0);
  await expect(page.getByTestId("lab-compare")).toBeEnabled();
  // The route stays live, and a comparison that answers is drawn.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page);
  await page.getByTestId("lab-compare").click();
  await expect(state).toHaveAttribute("data-kind", "ok");
  await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(2);
  // A later body without its batch fails by name, and the comparison it had stands for the batch it names.
  await page.route("**/v1/scenarios/run-book-set", (route) =>
    route.request().method() === "OPTIONS" ? preflight(route) : json(route, { ...shapeSet(DEMO_RUN_BOOK_SET, asked), batch: undefined }, 200, POST_CORS),
  );
  await page.getByTestId("lab-compare").click();
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveAttribute("data-held", "true");
  await expect(state).toHaveText(
    "Compare again failed — The set does not answer the request. Faults: batch is outside the wire contract. Nothing from it is drawn. The comparison below stands for batch 18,251.",
  );
  await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(2);
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
});

test("a service that answered 200 is never unreachable: a run-book without its engines names the field in the classifier's words; a body that is no JSON object says so; over a held result, the hold stands under the banner", async ({ page }) => {
  // `undefined` does not survive JSON: the body arrives with no `engines` member at all.
  await mockLab(page, { runBook: { ...DEMO_RUN_BOOK_ETH, engines: undefined } });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(headline(page)).toHaveText("The result for ETH -30 percent contradicts itself.");
  await expect(dek(page)).toHaveText("engines is outside the wire contract. Nothing from it is drawn.");
  await expect(page.getByTestId("lab-verdict")).not.toContainText("could not be reached");
  await expect(page.getByTestId("lab-verdict")).not.toContainText("Cannot read properties");
  await expect(tile(page, "newly")).toContainText("contradictory");
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
  await expect(row(page, "eth_minus_30")).not.toContainText("Unreachable");
  await expectNoCashZero(page);
  await expect(page.getByTestId("lab-run")).toBeEnabled();
  // With a result already on the page: the same answer stands behind it, named, and the held figures stand.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  let answers = 0;
  await page.route("**/v1/scenarios/*/run-book", (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    answers += 1;
    // First a body without its engines, then a body that is JSON null.
    return json(route, answers === 1 ? { ...DEMO_RUN_BOOK_ETH, engines: undefined } : null, 200, POST_CORS);
  });
  const banner = page.getByTestId("lab-banner");
  await page.getByTestId("lab-run").click();
  await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
  await expect(banner).toContainText("Run again failed — The result for ETH -30 percent contradicts itself. engines is outside the wire contract. Nothing from it is drawn.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  await expect(banner).not.toContainText("could not be reached");
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(tile(page, "newly")).toContainText("118");
  await page.getByTestId("lab-banner-rerun").click();
  await expect(banner).toContainText("Run again failed — The result for ETH -30 percent contradicts itself. The response body is not a JSON object. Nothing from it is drawn.");
  await expect(banner).toContainText("The result below stands for batch 18,251.");
  expect(answers).toBe(2);
  await expect(surface(page)).toHaveAttribute("data-state", "result");
  await expect(headline(page)).toContainText("$1.2M more Cash debt becomes liquidatable");
  await expect(page.getByTestId("lab-heatmap")).toBeVisible();
  await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
});

test("compare: a set 2xx whose body is JSON null is a failed Compare that says so — never a crashed route", async ({ page }) => {
  await mockLab(page);
  // The later route wins: the set route answers 200 with the JSON literal `null`.
  await page.route("**/v1/scenarios/run-book-set", (route) => (route.request().method() === "OPTIONS" ? preflight(route) : json(route, null, 200, POST_CORS)));
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  const state = page.getByTestId("lab-compare-state");
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveText("The set does not answer the request. Faults: The response body is not a JSON object. Nothing from it is drawn.");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("lab-compare")).toBeEnabled();
});

test("the hold's one predicate covers what the result draws: a re-run with a mover's ratio outside the contract, then one whose legacy row alone does not read, never replaces the result — each is named under the banner for the batch that stands, and neither becomes the result a later failure stands on", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await runIt(page);
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  // Every body that follows names another batch, so the batch the banner names can only be the first result's.
  const later = { ...DEMO_RUN_BOOK_ETH.batch, id: 18252 };
  const emptyRatio = { ...withCash((e) => ({ ...e, movers: e.movers.map((m, i) => (i === 0 ? { ...m, hf_after_num: "" } : m)) })), batch: later };
  const legacyGarbage = { ...DEMO_RUN_BOOK_ETH, batch: later, engines: DEMO_RUN_BOOK_ETH.engines.map((e) => (e.engine === "aave_v3_etherfi" ? { ...e, bad_debt_delta_usd: "garbage" } : e)) };
  let answers = 0;
  await page.route("**/v1/scenarios/*/run-book", (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    answers += 1;
    if (answers === 1) return json(route, emptyRatio, 200, POST_CORS);
    if (answers === 2) return json(route, legacyGarbage, 200, POST_CORS);
    return json(route, fixture("error-unavailable.json"), 503, POST_CORS);
  });
  const banner = page.getByTestId("lab-banner");
  const stands = async () => {
    await expect(banner).toHaveAttribute("data-kind", "rerun-failed");
    await expect(banner).toContainText("The result below stands for batch 18,251.");
    await expect(banner).not.toContainText("18,252");
    await expect(surface(page)).toHaveAttribute("data-state", "result");
    await expect(chip(page, "Result for batch")).toContainText("18,251");
    await expect(headline(page)).toContainText("$1.2M more Cash debt becomes liquidatable");
    await expect(tile(page, "debt")).toContainText("+$1.2M");
    await expect(page.getByTestId("lab-movers").locator("tbody tr")).toHaveCount(20);
    await expect(page.getByTestId("lab-movers-caption")).not.toContainText("unreadable");
    await expect(row(page, "eth_minus_30")).toContainText("+$1.2M liquidatable · 118 accounts");
  };
  // valid → a mover's ratio that does not read: the fault is named, the result stands.
  await page.getByTestId("lab-run").click();
  await expect(banner).toContainText("Run again failed — The result for ETH -30 percent contradicts itself. movers[0].hf_after_num is outside the wire contract. Nothing from it is drawn.");
  await stands();
  // → the legacy row alone does not read: the same, named under its engine — the Cash figures beside it never stand in for the result.
  await page.getByTestId("lab-banner-rerun").click();
  await expect(banner).toContainText("Aave v3 market (legacy): bad_debt_delta_usd is outside the wire contract.");
  await stands();
  await page.getByTestId("lab-legacy").locator("summary").click();
  await expect(page.getByTestId("lab-legacy-kpi-newly")).not.toContainText("contradictory");
  // → a transport failure: neither body above moved into the hold, so the result that stands is still the first.
  await page.getByTestId("lab-banner-rerun").click();
  await expect(banner).toContainText("Run again failed — No servable batch.");
  await stands();
  expect(answers).toBe(3);

  // With nothing held, a body whose legacy row alone does not read is the contradictory state whole: no Cash figure of it is drawn.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { runBook: legacyGarbage });
  await page.goto("/lab");
  await page.getByTestId("lab-run").click();
  await expect(surface(page)).toHaveAttribute("data-state", "contradictory");
  await expect(dek(page)).toHaveText("Aave v3 market (legacy): bad_debt_delta_usd is outside the wire contract. Nothing from it is drawn.");
  await expect(page.getByTestId("lab-banner")).toHaveCount(0);
  for (const key of ["newly", "debt", "baddebt", "moved"]) await expect(tile(page, key)).toContainText("contradictory");
  await expect(page.getByTestId("lab-movers")).toHaveCount(0);
  await expect(page.getByTestId("lab-heatmap")).toHaveCount(0);
  await expect(row(page, "eth_minus_30")).toContainText("Unreadable");
  await expectNoCashZero(page);
});

test("compare: the set's one predicate covers what the comparison draws — a Compare that answers the request with a garbage engine figure never replaces the comparison it had, however many follow, and with nothing held it is a failed Compare, never one dashed row beside drawn dots", async ({ page }) => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answering = shapeSet(DEMO_RUN_BOOK_SET, asked);
  const garbage = { ...answering, results: answering.results.map((r) => (r.scenario_id !== "eth_minus_30" ? r : { ...r, engines: r.engines.map((e) => (e.engine !== "debt_manager" ? e : { ...e, eligible_debt_delta_usd: "garbage" })) })) };
  await mockLab(page);
  await page.goto(`/lab?scenarios=${asked.join(",")}`);
  const state = page.getByTestId("lab-compare-state");
  await expect(state).toHaveAttribute("data-kind", "ok");
  await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(2);
  await page.route("**/v1/scenarios/run-book-set", (route) => (route.request().method() === "OPTIONS" ? preflight(route) : json(route, garbage, 200, POST_CORS)));
  // valid → garbage → garbage: the comparison that read stands under the line naming its batch, both times.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByTestId("lab-compare").click();
    await expect(state).toHaveAttribute("data-kind", "failed");
    await expect(state).toHaveAttribute("data-held", "true");
    await expect(state).toHaveText(
      "Compare again failed — The set cannot be read. Faults: eth_minus_30: eligible_debt_delta_usd is outside the wire contract. Nothing from it is drawn. The comparison below stands for batch 18,251.",
    );
    await expect(page.getByTestId("lab-dotplot").locator("circle")).toHaveCount(2);
    await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toHaveAttribute("data-kind", "point");
    await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% · +$1.2M");
    await expect(page.getByTestId("lab-compare")).toBeEnabled();
  }
  // With nothing held, the same body is the failure alone.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLab(page, { setVerbatim: garbage });
  await page.goto(`/lab?scenarios=${asked.join(",")}`);
  await expect(state).toHaveAttribute("data-kind", "failed");
  await expect(state).toHaveText("The set cannot be read. Faults: eth_minus_30: eligible_debt_delta_usd is outside the wire contract. Nothing from it is drawn.");
  await expect(page.getByTestId("lab-dotplot")).toHaveCount(0);
  await expect(page.locator("[data-testid^='lab-compare-row-']")).toHaveCount(0);
});

test("a listing that ANSWERS and cannot be read is its own state — never ready, never a crashed route, never 'could not be listed': the fault is named, the library is empty, and nothing can run", async ({ page }) => {
  for (const [body, faults] of [
    [null, "The response body is not a JSON object."],
    [{ ...DEMO_SCENARIOS, scenarios: null }, "scenarios is outside the wire contract."],
    [{ ...DEMO_SCENARIOS, scenarios: [firstScenario(), { ...firstScenario(), id: "second", label: null, shocks: null }] }, "scenarios[1].label is outside the wire contract; scenarios[1].shocks is outside the wire contract."],
  ] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const counts = await mockLab(page);
    // `mockLab` answers a nullish listing with the demo's, so the body under test is routed as given — JSON null included.
    await page.route("**/v1/scenarios", (route) => route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) }));
    await page.goto("/lab?scenario=eth_minus_30&scenarios=eth_minus_30,ethfi_minus_50");
    await expect(surface(page)).toHaveAttribute("data-state", "listing-unreadable");
    await expect(headline(page)).toHaveText("The committed scenarios could not be read.");
    await expect(dek(page)).toHaveText(`Faults: ${faults} Nothing can run until the listing reads.`);
    await expect(page.getByTestId("lab-library")).toContainText("The committed scenarios could not be read.");
    await expect(page.locator("main")).not.toContainText("could not be listed");
    await expect(page.locator("[data-testid^='lab-library-row-']")).toHaveCount(0);
    await expectDisabledRegister(page, "lab-run", "panel-2");
    await expectDisabledRegister(page, "lab-compare", "none");
    await expect(page.getByTestId("lab-compare")).toHaveText("Compare…");
    // The route stands: the shell is on the page, and the link's asks dispatched nothing.
    await expect(page.getByRole("banner")).toBeVisible();
    await page.waitForTimeout(300);
    expect(counts.runs()).toBe(0);
    expect(counts.sets()).toBe(0);
  }
});

test("one-address mode: a stress response that reports no position names ITS batch and never contradicts the position on the page — the two batches are disclosed first, the negative is the stress response's own", async ({ page }) => {
  // The lookup finds Cash in batch 18,251; the stress response, a request of its own, answers for batch 18,252 and reports none.
  await mockLab(page, { stress: { ...DEMO_STRESS_NEAR, batch: { ...DEMO_STRESS_NEAR.batch, id: 18252 }, found: false, scenarios: [] } });
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  await expect(headline(page)).toHaveText("Cannot say — the stress result is for batch 18,252; the position above is batch 18,251.");
  await expect(dek(page)).toHaveText("The stress response reports no position for 0x7a3f…c21e in batch 18,252 — its own batch, not the position's. A position and a stress result from different batches are not compared.");
  await expect(page.locator("main")).not.toContainText("No Cash position");
  await expect(page.locator("main")).not.toContainText("in batch 18,251");
  await expect(chip(page, "Result for batch")).toContainText("18,251");
  await expect(chip(page, "Stress for batch")).toContainText("18,252");
});

test("a conflicting link with an address claims only what the conflict gates: no book run was dispatched for either selection, and the address's own evaluation — which neither selection gates — is shown and said to be", async ({ page }) => {
  const counts = await mockLab(page);
  await page.goto(`/lab?address=${DEMO_NEAR_ADDR}&scenario=eth_minus_30&scenarios=ethfi_minus_50`);
  const notice = page.getByTestId("lab-deeplink-notice");
  await expect(notice).toContainText("no book run was dispatched for either");
  await expect(notice).toContainText("The address's own evaluation is shown below");
  await expect(notice).not.toContainText("NOTHING was run");
  // The evaluation the notice names is on the page…
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(page.getByTestId("lab-address-table").locator("tbody tr")).toHaveCount(DEMO_STRESS_NEAR.scenarios.length);
  // …and what it says was not dispatched was not.
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);
  expect(counts.sets()).toBe(0);
  // Without an address the same link says the same of the book run, and claims nothing about an evaluation there is none of.
  await page.goto("/lab?scenario=eth_minus_30&scenarios=ethfi_minus_50");
  await expect(notice).toContainText("no book run was dispatched for either");
  await expect(notice).not.toContainText("The address's own evaluation");
  await expect(notice).not.toContainText("NOTHING was run");
});

test("the address bar names the subject shown after a same-route navigation: the shell's Scenarios link on a selected scenario leaves the selection on screen, and the URL names it again", async ({ page }) => {
  await mockLab(page);
  await page.goto("/lab");
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(page).toHaveURL(/\/lab\?scenario=ethfi_minus_50$/);
  await page.getByRole("navigation", { name: "app surfaces" }).getByRole("link", { name: "Scenarios" }).click();
  // Whatever the router keeps of the surface across that navigation, the bar and the screen agree: the scenario the
  // URL names is the selected row, and a bar that names none stands only over the listing's own first row — never
  // `/lab` over a scenario the reader selected.
  await expect
    .poll(async () => {
      const selected = (await page.locator("[data-testid^='lab-library-row-'][data-selected='true']").getAttribute("data-testid"))?.replace("lab-library-row-", "");
      const namedInUrl = new URL(page.url()).searchParams.get("scenario");
      return namedInUrl === null ? selected === "eth_minus_30" : namedInUrl === selected;
    })
    .toBe(true);
  // The same navigation on a link that was only OPENED: the bar is given back the scenario the link itself named…
  await page.goto("/lab?scenario=ethfi_minus_50");
  await expect(row(page, "ethfi_minus_50")).toHaveAttribute("data-selected", "true");
  await page.getByRole("navigation", { name: "app surfaces" }).getByRole("link", { name: "Scenarios" }).click();
  await expect
    .poll(async () => {
      const selected = (await page.locator("[data-testid^='lab-library-row-'][data-selected='true']").getAttribute("data-testid"))?.replace("lab-library-row-", "");
      const namedInUrl = new URL(page.url()).searchParams.get("scenario");
      return namedInUrl === null ? selected === "eth_minus_30" : namedInUrl === selected;
    })
    .toBe(true);
  // …and never the listing's default, which nobody asked for: after it, a ghost link names no scenario, or ghost still.
  await page.goto("/lab?scenario=ghost");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-selected", "true");
  await page.getByRole("navigation", { name: "app surfaces" }).getByRole("link", { name: "Scenarios" }).click();
  await page.waitForTimeout(300);
  expect(new URL(page.url()).searchParams.get("scenario")).not.toBe("eth_minus_30");
});

test("a link nobody selected from is never rewritten: an opened link that names a scenario the page does not show is left exactly as it arrived and the mismatch is said in words — so a reload runs nothing nobody asked for; the bar follows the subject shown only after the reader's own selection", async ({ page }) => {
  const counts = await mockLab(page);
  // An id the listing does not publish: the first listed scenario is shown, not run; the notice names the link's id.
  await page.goto("/lab?scenario=ghost");
  await expect(row(page, "eth_minus_30")).toHaveAttribute("data-selected", "true");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  const notice = page.getByTestId("lab-deeplink-notice");
  await expect(notice).toHaveText("This link names ?scenario=ghost, and this deployment publishes no scenario of that id. Nothing was run for it, and the link is left as it arrived. ETH -30 percent is shown instead.");
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe("?scenario=ghost");
  expect(counts.runs()).toBe(0);
  // Reload of the untouched link: the same screen, the same notice, and still nothing run.
  await page.reload();
  await expect(notice).toContainText("This link names ?scenario=ghost");
  await expect(surface(page)).toHaveAttribute("data-state", "not-run");
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe("?scenario=ghost");
  expect(counts.runs()).toBe(0);
  // The reader's own selection: now the bar names the subject shown, and a selection runs nothing.
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(page).toHaveURL(/\/lab\?scenario=ethfi_minus_50$/);
  await expect(notice).toContainText("ETHFI -50 percent is shown instead.");
  await page.waitForTimeout(300);
  expect(counts.runs()).toBe(0);

  // One-address mode: the link names a scenario the address was not stressed under. The fallback is disclosed; the link is left alone.
  const linked = `?address=${DEMO_NEAR_ADDR}&scenario=weeth_market_depeg_oracles_held`;
  await page.goto(`/lab${linked}`);
  await expect(surface(page)).toHaveAttribute("data-state", "rows");
  await expect(page.getByTestId("lab-address-fallback")).toContainText("weETH market depeg to 0.95 (oracles held) was not evaluated for 0x7a3f…c21e");
  await expect(page.getByTestId("lab-address-fallback")).toContainText("ETH -30 percent is shown instead");
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe(linked);
  // A published id names itself: no unlisted-id notice beside the fallback's own disclosure.
  await expect(notice).toHaveCount(0);
  // After a selection the bar names the subject shown — the row the address carries…
  await row(page, "ethfi_minus_50").getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/lab\\?address=${DEMO_NEAR_ADDR}&scenario=ethfi_minus_50$`));
  // …or, for a row it does not carry, the disclosed fallback.
  await row(page, "weeth_market_depeg_oracles_held").getByRole("button").click();
  await expect(page.getByTestId("lab-address-fallback")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/lab\\?address=${DEMO_NEAR_ADDR}&scenario=eth_minus_30$`));
});
