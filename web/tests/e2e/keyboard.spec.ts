// Keyboard operability (spec 2026-09-15 §10.5): a page that can be read must be operable without a pointer.
// A drawer is a modal — it takes focus when it opens, holds Tab and Shift+Tab inside itself, closes on Escape and
// hands focus back to the button that opened it. A table's or an index's links are Tab stops in DOM order, none
// skipped. The Scenarios library answers the keys its controls are made of: Space ticks a box, Enter presses a row.
// Every reading of "where focus is" is taken from document.activeElement against the one element it must be in or
// be, so a focus left on the page behind a dialog can never read as a focus inside it.
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  DEMO_ADDRESS_NEAR,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_EVIDENCE,
  DEMO_FEED_PAGE_1,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_OBSERVATORY_AAVE,
  DEMO_OBSERVATORY_DM,
  DEMO_PARAMS_DM,
  DEMO_POSITIONS_DM_PAGE_1,
  DEMO_POSITIONS_DM_PAGE_2,
  DEMO_RUN_BOOK_ETH,
  DEMO_RUN_BOOK_SET,
  DEMO_SCENARIOS,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { scenarioName } from "../../lib/scenario-name";

const CORS = { "access-control-allow-origin": "*" };
/** The set route is cross-origin and preflighted; the OPTIONS leg is answered here and never counted as a run. */
const POST_CORS = {
  ...CORS,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};
const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

/** The demo dataset behind every page; the returned reader counts the set runs the page dispatched. */
async function mockDemo(page: Page): Promise<{ sets: () => number }> {
  let sets = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/evidence*", (route) => json(route, DEMO_EVIDENCE));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
  // The Inspector's routes: `*` never crosses `/`, so /history and /stress are not swallowed by the address route.
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  // One endpoint, two readers: the Inspector asks for one account's actions, Activity for the cross-engine page.
  await page.route("**/v1/events*", (route) =>
    json(route, new URL(route.request().url()).searchParams.get("account") === null ? DEMO_FEED_PAGE_1 : DEMO_EVENTS_NEAR),
  );
  // History: one engine per view, the series chosen by the request's own engine.
  await page.route("**/v1/observatory/series*", (route) =>
    json(route, new URL(route.request().url()).searchParams.get("engine") === "debt_manager" ? DEMO_OBSERVATORY_DM : DEMO_OBSERVATORY_AAVE),
  );
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_NEAR));
  // The Scenarios page: the listing, the demo run-book welded to the Book, and the set route — answered so a
  // stray dispatch is counted here and never reaches a live API.
  await page.route("**/v1/scenarios/*/run-book", (route) => json(route, DEMO_RUN_BOOK_ETH));
  await page.route("**/v1/scenarios/run-book-set", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: POST_CORS, body: "" });
    sets += 1;
    return json(route, DEMO_RUN_BOOK_SET);
  });
  await page.route("**/v1/scenarios", (route) => json(route, DEMO_SCENARIOS));
  return { sets: () => sets };
}

// Each page says when it has left its pending register; a key pressed earlier would be read by a skeleton.
const READY = {
  overview: async (tab: Page) => expect(tab.getByTestId("overview-live")).not.toHaveAttribute("aria-busy", "true"),
  book: async (tab: Page) => expect(tab.getByTestId("book-kpi-near")).not.toHaveAttribute("aria-busy", "true"),
  inspector: async (tab: Page) => {
    await expect(tab.getByTestId("inspector-surface")).toHaveAttribute("data-state", "near");
    await expect(tab.getByTestId("inspector-stress-table").locator("tbody tr")).toHaveCount(3);
    await expect(tab.getByTestId("inspector-activity").locator("tbody tr")).toHaveCount(6);
  },
  scenarios: async (tab: Page) => {
    await expect(tab.getByTestId("lab-surface")).toHaveAttribute("data-state", "result");
    await expect(tab.getByTestId("lab-movers").locator("tbody tr")).toHaveCount(20);
  },
  history: async (tab: Page) => {
    await expect(tab.getByTestId("history-surface")).toHaveAttribute("data-state", "ok");
    await expect(tab.getByTestId("history-tiles").locator("[aria-busy='true']")).toHaveCount(0);
  },
  activity: async (tab: Page) => {
    await expect(tab.getByTestId("activity-surface")).toHaveAttribute("data-state", "ok");
    await expect(tab.locator('[data-testid^="activity-row-"]')).toHaveCount(50);
  },
  verification: async (tab: Page) => {
    await expect(tab.getByTestId("verification-surface")).toHaveAttribute("data-state", "ok");
    await expect(tab.getByTestId("verification-surface").locator("[aria-busy='true']")).toHaveCount(0);
    await expect(tab.getByTestId("verification-receipt")).toBeVisible();
  },
  api: async (tab: Page) => {
    await expect(tab.getByTestId("api-surface")).toBeVisible();
    await expect(tab.getByTestId("api-toc")).toBeVisible();
  },
} as const;

const PATHS = {
  overview: "/",
  book: "/book",
  inspector: `/inspector/${DEMO_NEAR_ADDR}`,
  scenarios: "/lab?scenario=eth_minus_30",
  history: "/observatory",
  activity: "/feed",
  verification: "/proof",
  api: "/developers",
} as const;

type PageName = keyof typeof PATHS;

async function open(tab: Page, name: PageName): Promise<{ sets: () => number }> {
  await tab.setViewportSize({ width: 1440, height: 900 });
  const counts = await mockDemo(tab);
  await tab.goto(PATHS[name], { waitUntil: "networkidle" });
  await READY[name](tab);
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------
// Where focus is
// ---------------------------------------------------------------------------------------------------------------

interface DialogFocus {
  /** document.activeElement is the dialog or one of its descendants — and a dialog is open at all. */
  inside: boolean;
  /** The focused element's position among the dialog's descendants in DOM order; -1 is the dialog itself; null is outside. */
  at: number | null;
  /** What is focused, for the failure message. */
  what: string;
}

async function dialogFocus(tab: Page): Promise<DialogFocus> {
  return tab.evaluate(() => {
    const active = document.activeElement;
    const what = active === null ? "nothing" : `<${active.tagName.toLowerCase()}> ${(active.textContent ?? "").trim().slice(0, 40)}`;
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null || active === null || !dialog.contains(active)) return { inside: false, at: null, what };
    return { inside: true, at: active === dialog ? -1 : Array.from(dialog.querySelectorAll("*")).indexOf(active), what };
  });
}

/** One key, then where focus went: inside the dialog, or the pin fails naming what took it. */
async function pressInside(tab: Page, key: "Tab" | "Shift+Tab"): Promise<number> {
  await tab.keyboard.press(key);
  const focus = await dialogFocus(tab);
  expect(focus.inside, `${key} moved focus out of the dialog, onto ${focus.what}`).toBe(true);
  return focus.at ?? Number.NaN;
}

/** The header button is focused and pressed with Enter: no pointer opens the drawer. */
async function openByKeyboard(tab: Page, button: Locator): Promise<void> {
  await expect(tab.getByRole("dialog")).toHaveCount(0);
  await button.focus();
  await expect(button).toBeFocused();
  await tab.keyboard.press("Enter");
  await expect(tab.getByRole("dialog")).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------
// 1 · The drawer
// ---------------------------------------------------------------------------------------------------------------

// The Overview opens no drawer: it carries no header action.
const DRAWERS: readonly { page: PageName; button: string; label: string }[] = [
  { page: "book", button: "book-methodology", label: "Methodology & evidence" },
  { page: "inspector", button: "inspector-drawer", label: "Inputs · Calculation · Provenance" },
  { page: "scenarios", button: "lab-drawer", label: "Assumptions · What the model leaves out" },
  { page: "history", button: "history-drawer", label: "Methodology & evidence" },
  { page: "activity", button: "activity-drawer", label: "Methodology & evidence" },
  { page: "verification", button: "verification-drawer", label: "Methodology & evidence" },
  { page: "api", button: "api-drawer", label: "Methodology & evidence" },
];

for (const drawer of DRAWERS) {
  test(`${drawer.page} · the drawer takes focus on Enter, Tab and Shift+Tab cycle inside it, Escape closes it and hands focus back to its button`, async ({ page: tab }) => {
    await open(tab, drawer.page);
    const button = tab.getByTestId(drawer.button);
    await expect(button).toHaveText(drawer.label);
    await openByKeyboard(tab, button);

    // Focus moved in: the opener no longer holds it, the dialog (or something in it) does.
    await expect(button).not.toBeFocused();
    const entered = await dialogFocus(tab);
    expect(entered.inside, `opening left focus on ${entered.what}`).toBe(true);

    // Forward: one more Tab than the dialog has candidates must pass its last stop — and every press lands inside.
    const candidates = await tab
      .getByRole("dialog")
      .locator("a[href], button, input, select, textarea, summary, [tabindex]")
      .count();
    expect(candidates).toBeGreaterThan(0);
    const forward: number[] = [];
    for (let i = 0; i < candidates + 1; i += 1) forward.push(await pressInside(tab, "Tab"));
    const first = forward[0] ?? Number.NaN;
    const wrapAt = forward.indexOf(first, 1);
    expect(wrapAt, `Tab never came back round to the dialog's first stop: ${forward.join(",")}`).toBeGreaterThan(0);
    const last = forward[wrapAt - 1] ?? Number.NaN;
    // The stops are visited in DOM order, each once per lap.
    const lap = forward.slice(0, wrapAt);
    expect(lap).toEqual([...lap].sort((a, b) => a - b));
    expect(new Set(lap).size).toBe(lap.length);

    // Stand on the first stop; Shift+Tab goes before it — to the last; Tab goes past the last — to the first.
    for (let i = 0; i < lap.length && (await dialogFocus(tab)).at !== first; i += 1) await pressInside(tab, "Tab");
    expect((await dialogFocus(tab)).at).toBe(first);
    expect(await pressInside(tab, "Shift+Tab")).toBe(last);
    expect(await pressInside(tab, "Tab")).toBe(first);
    // A whole lap backwards holds too.
    const backward: number[] = [];
    for (let i = 0; i < lap.length; i += 1) backward.push(await pressInside(tab, "Shift+Tab"));
    expect(backward).toEqual([...lap].reverse());

    // Escape closes it, and focus is the opener's again — not the body's, not the page's first stop.
    await tab.keyboard.press("Escape");
    await expect(tab.getByRole("dialog")).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test(`${drawer.page} · Shift+Tab as the first key in an open drawer stays inside it`, async ({ page: tab }) => {
    await open(tab, drawer.page);
    await openByKeyboard(tab, tab.getByTestId(drawer.button));
    expect((await dialogFocus(tab)).inside).toBe(true);
    // An open drawer's focus rests on the panel itself, which is no stop: the key before the first stop is the last one.
    const entered = await pressInside(tab, "Shift+Tab");
    expect(entered, "Shift+Tab left focus on the panel itself instead of a stop").toBeGreaterThanOrEqual(0);
    // And the way back is still a way inside: Tab past the last stop, Shift+Tab back onto it.
    await pressInside(tab, "Tab");
    expect(await pressInside(tab, "Shift+Tab")).toBe(entered);
  });
}

test("overview · the page opens no drawer: no control on it claims one", async ({ page: tab }) => {
  await open(tab, "overview");
  await expect(tab.locator("main").getByRole("button", { name: /methodology|assumptions/i })).toHaveCount(0);
  await expect(tab.getByRole("dialog")).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------
// 2 · Links and controls are Tab stops in DOM order
// ---------------------------------------------------------------------------------------------------------------

interface Stop {
  /** The stop's position in the container's DOM-order list of stops. */
  index: number;
  href: string | null;
}

/**
 * Walks `container`'s `stops` by Tab alone. The walk starts one stop BEFORE the first — reached by Shift+Tab from
 * it — so the first stop is arrived at by Tab like the rest, and ends when focus leaves the container. What comes
 * back is every stop Tab landed on, in the order it landed.
 */
async function walkByTab(tab: Page, container: Locator, stops: string): Promise<{ expected: Stop[]; walked: Stop[] }> {
  const read = (root: Element, selector: string) => {
    // A stop folded away in a closed <details> is not rendered, and Tab owes it nothing until the fold is opened.
    const all = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility());
    const active = document.activeElement;
    return {
      expected: all.map((el, index) => ({ index, href: el.getAttribute("href") })),
      inside: active !== null && root.contains(active),
      at: active instanceof HTMLElement ? all.indexOf(active) : -1,
    };
  };
  const before = await container.evaluate(read, stops);
  expect(before.expected.length).toBeGreaterThan(0);

  await container.locator(stops).first().focus();
  expect((await container.evaluate(read, stops)).at).toBe(0);
  await tab.keyboard.press("Shift+Tab");
  expect((await container.evaluate(read, stops)).at, "Shift+Tab from the first stop left the walk's stops").toBe(-1);

  const walked: Stop[] = [];
  // Every stop costs one Tab; a container's other controls may cost a few more. The walk ends where the container does.
  for (let presses = 0; presses < before.expected.length * 2 + 8; presses += 1) {
    await tab.keyboard.press("Tab");
    const now = await container.evaluate(read, stops);
    if (!now.inside) break;
    const stop = now.expected[now.at];
    if (stop !== undefined) walked.push(stop);
  }
  return { expected: before.expected, walked };
}

test("activity · every link of the table — account, liquidator, tx — is a Tab stop, in DOM order, none skipped", async ({ page: tab }) => {
  await open(tab, "activity");
  const table = tab.getByTestId("activity-table");
  const { expected, walked } = await walkByTab(tab, table, "a[href]");
  // Fifty rows, each with its account; the demo page carries liquidators and explorer links besides.
  expect(expected.filter((s) => s.href?.startsWith("/inspector/")).length).toBeGreaterThanOrEqual(50);
  expect(walked.map((s) => s.index)).toEqual(expected.map((s) => s.index));
  expect(walked.map((s) => s.href)).toEqual(expected.map((s) => s.href));
});

test("verification · every control of the surface — the drawer button, each subject's explain, the copies, the folds, the API link, the raw toggle — is a Tab stop, in DOM order; a fold opened with Enter gives up its copies to Tab", async ({ page: tab }) => {
  await open(tab, "verification");
  const surface = tab.getByTestId("verification-surface");
  const stops = "a[href], button:not([disabled]), summary";
  // The probes table is text: its rows open nothing. The page's stops are its controls and its one link out.
  await expect(tab.getByTestId("verification-probes").locator("a[href], button")).toHaveCount(0);
  const folded = await walkByTab(tab, surface, stops);
  expect(folded.expected.map((s) => s.href)).toContain("/developers");
  expect(folded.walked.map((s) => s.index)).toEqual(folded.expected.map((s) => s.index));
  // The named ones are among them, by Tab.
  for (const id of ["verification-drawer", "verification-raw"]) {
    const at = await surface.evaluate(
      (root, [selector, testId]) =>
        Array.from(root.querySelectorAll<HTMLElement>(selector ?? ""))
          .filter((el) => el.checkVisibility())
          .findIndex((el) => el.getAttribute("data-testid") === testId),
      [stops, id],
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(folded.walked.map((s) => s.index), `${id} is a Tab stop`).toContain(at);
  }

  // Each forensics fold opens on Enter at its summary, and what it held is then walked like the rest.
  const folds = surface.locator("details");
  const count = await folds.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const fold = folds.nth(i);
    await expect(fold).not.toHaveAttribute("open", "");
    await fold.locator("summary").focus();
    await tab.keyboard.press("Enter");
    await expect(fold).toHaveAttribute("open", "");
  }
  const unfolded = await walkByTab(tab, surface, stops);
  expect(unfolded.expected.length).toBeGreaterThan(folded.expected.length);
  expect(unfolded.expected.length).toBe(await surface.locator(stops).count());
  expect(unfolded.walked.map((s) => s.index)).toEqual(unfolded.expected.map((s) => s.index));
});

test("api · every anchor of the endpoint index is a Tab stop, in DOM order, none skipped", async ({ page: tab }) => {
  await open(tab, "api");
  const toc = tab.getByTestId("api-toc");
  const { expected, walked } = await walkByTab(tab, toc, "a[href]");
  // One anchor per endpoint card, each naming its card.
  await expect(tab.locator('[data-testid^="api-endpoint-"]')).toHaveCount(expected.length);
  for (const stop of expected) expect(stop.href).toMatch(/^#\w+$/);
  expect(walked.map((s) => s.href)).toEqual(expected.map((s) => s.href));
  expect(walked.map((s) => s.index)).toEqual(expected.map((s) => s.index));
});

test("book · every account link of the Needs-attention table is a Tab stop, in DOM order, none skipped", async ({ page: tab }) => {
  await open(tab, "book");
  const table = tab.getByTestId("book-attention");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const { expected, walked } = await walkByTab(tab, table, "a[href]");
  // One link per row, and every one opens the Inspector on its own account.
  await expect(table.locator("tbody tr")).toHaveCount(expected.length);
  for (const stop of expected) expect(stop.href).toMatch(/^\/inspector\/0x[0-9a-fA-F]{40}$/);
  expect(walked.map((s) => s.href)).toEqual(expected.map((s) => s.href));
  expect(walked.map((s) => s.index)).toEqual(expected.map((s) => s.index));
});

// ---------------------------------------------------------------------------------------------------------------
// 3 · The Scenarios library
// ---------------------------------------------------------------------------------------------------------------

const libraryRow = (tab: Page, id: string) => tab.getByTestId(`lab-library-row-${id}`);
const libraryCheck = (tab: Page, id: string) => tab.getByTestId(`lab-library-check-${id}`);

/** Tab, and only Tab, until `target` holds focus; the bound is the pin — an unreachable control runs it out. */
async function tabTo(tab: Page, target: Locator, bound: number): Promise<void> {
  for (let i = 0; i < bound; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await tab.keyboard.press("Tab");
  }
  await expect(target, `not reached in ${String(bound)} Tabs`).toBeFocused();
}

test("scenarios · every row's tick and its row button are Tab stops — tick then row, row after row, in the listing's order", async ({ page: tab }) => {
  await open(tab, "scenarios");
  const list = tab.getByTestId("lab-library").locator("ul");
  const stops = "input[type='checkbox'], button";
  const ids = DEMO_SCENARIOS.scenarios.map((s) => s.id);
  await expect(list.locator("li")).toHaveCount(ids.length);
  const { expected, walked } = await walkByTab(tab, list, stops);
  expect(expected.length).toBe(ids.length * 2);
  expect(walked.map((s) => s.index)).toEqual(expected.map((s) => s.index));
  // The DOM order the walk followed is the listing's: row i holds stop 2i (its tick) and stop 2i+1 (its button).
  for (const [i, id] of ids.entries()) {
    const rowStops = libraryRow(tab, id).locator(stops);
    await expect(rowStops).toHaveCount(2);
    await expect(rowStops.nth(0)).toHaveAttribute("data-testid", `lab-library-check-${id}`);
    await expect(rowStops.nth(1)).toHaveAttribute("aria-pressed", /true|false/);
    await expect(list.locator(stops).nth(2 * i)).toHaveAttribute("data-testid", `lab-library-check-${id}`);
  }
});

test("scenarios · Space ticks and unticks a focused box, the Compare control counts the ticks, and a tick runs nothing", async ({ page: tab }) => {
  const counts = await open(tab, "scenarios");
  const compare = tab.getByTestId("lab-compare");
  const a = libraryCheck(tab, "eth_minus_30");
  const b = libraryCheck(tab, "ethfi_minus_50");
  const hint = tab.getByTestId("lab-compare-hint");
  await expect(a).not.toBeChecked();
  await expect(b).not.toBeChecked();
  await expect(compare).toHaveText("Compare…");
  await expect(compare).toBeDisabled();
  // The reason it cannot act is words on the page and the button's description, so a keyboard reaches it; never a title.
  await expect(hint).toHaveText("Tick two or more scenarios to compare them.");
  await expect(compare).toHaveAccessibleDescription("Tick two or more scenarios to compare them.");

  await tab.getByTestId("lab-mode-address").focus();
  await tabTo(tab, a, 4);
  await tab.keyboard.press("Space");
  await expect(a).toBeChecked();
  // One tick compares nothing.
  await expect(compare).toHaveText("Compare…");
  await expect(compare).toBeDisabled();
  await expect(compare).toHaveAccessibleDescription("Tick one more scenario to compare.");

  await tabTo(tab, b, 12);
  await tab.keyboard.press("Space");
  await expect(b).toBeChecked();
  await expect(compare).toHaveText("Compare 2 scenarios");
  await expect(compare).toBeEnabled();
  await expect(hint).toHaveCount(0);
  await expect(compare).not.toHaveAttribute("aria-describedby");

  // The same key takes the tick back, and the control follows it down.
  await expect(b).toBeFocused();
  await tab.keyboard.press("Space");
  await expect(b).not.toBeChecked();
  await expect(a).toBeChecked();
  await expect(compare).toHaveText("Compare…");
  await expect(compare).toBeDisabled();
  await expect(hint).toHaveText("Tick one more scenario to compare.");

  // A tick is a selection for Compare, never a run; the selection it sits beside did not move.
  expect(counts.sets()).toBe(0);
  await expect(libraryRow(tab, "eth_minus_30")).toHaveAttribute("data-selected", "true");
});

test("scenarios · Enter on a focused row button selects that scenario: the row carries the selection and the surface's subject is the scenario's", async ({ page: tab }) => {
  const counts = await open(tab, "scenarios");
  const from = DEMO_SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30");
  const to = DEMO_SCENARIOS.scenarios.find((s) => s.id === "ethfi_minus_50");
  if (from === undefined || to === undefined) throw new Error("the demo listing names both scenarios");
  const headline = tab.getByTestId("lab-verdict-headline");
  await expect(libraryRow(tab, from.id)).toHaveAttribute("data-selected", "true");
  await expect(libraryRow(tab, to.id)).not.toHaveAttribute("data-selected", "true");
  await expect(headline).not.toContainText(scenarioName(to));
  const subjectBefore = await headline.textContent();

  const button = libraryRow(tab, to.id).getByRole("button");
  await tab.getByTestId("lab-mode-address").focus();
  await tabTo(tab, button, 12);
  await tab.keyboard.press("Enter");

  await expect(libraryRow(tab, to.id)).toHaveAttribute("data-selected", "true");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(libraryRow(tab, from.id)).not.toHaveAttribute("data-selected", "true");
  await expect(libraryRow(tab, from.id).getByRole("button")).toHaveAttribute("aria-pressed", "false");
  // The surface is about the pressed scenario now: not yet run, named in the headline, the Run control its own.
  await expect(tab.getByTestId("lab-surface")).toHaveAttribute("data-state", "not-run");
  await expect(headline).toContainText(scenarioName(to));
  expect(await headline.textContent()).not.toBe(subjectBefore);
  await expect(tab.getByTestId("lab-run")).toHaveText(`Run ${scenarioName(to)}`);
  // The key stays where it was pressed, and selecting ran no set.
  await expect(button).toBeFocused();
  expect(counts.sets()).toBe(0);
});
