// CHART SPEC v4 — the acceptance checks that need a real layout.
//
// Everything here is measured in RENDERED CSS PIXELS against a running
// production build, because that is the only place LAW-3 can be checked: a
// chart authored at 980 user units and scaled by a viewBox has 12px labels
// that arrive at 7.6px, and no unit test can see that.
//
// Every base body is a committed fixture; every variation is structuredClone
// surgery done IN THE TEST, so a claim about what the map draws can be proven
// by watching the drawing change when the wire changes.
//
// AC coverage in this file:
//   frontier   AC-34..AC-38, AC-40..AC-43, AC-45..AC-48
//   cross      AC-49..AC-51, AC-53 (run-book), AC-54 (frontier, run-book)
//
// The risk-map checks (AC-6..AC-33, AC-52, AC-53 and AC-54/AC-55 on the Book
// histogram and density map) pinned the Book surface retired on 2026-09-15
// (Plan 1 Task 14, ledgered in .superpowers/sdd/progress-ui-overhaul.md).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK } from "../fixtures/book";

const CORS = { "access-control-allow-origin": "*" };
const API = "http://localhost:8080";

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

function contrastOf(a: string, b: string): number {
  const parse = (value: string): [number, number, number] => {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (match === null) throw new Error(`unparseable colour: ${value}`);
    const parts = (match[1] ?? "").split(/[\s,/]+/).filter((part) => part.length > 0);
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  };
  const lum = (rgb: [number, number, number]) => {
    const channel = (raw: number) => {
      const c = raw / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  const la = lum(parse(a));
  const lb = lum(parse(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ===========================================================================
// THE LOSS FRONTIER
// ===========================================================================

interface WaterfallEngineShape {
  engine: string;
  usd_decimals: number;
  newly_eligible_accounts: number;
  cumulative_eligible_accounts: number;
  cumulative_debt_eligible_usd: string;
  cumulative_collateral_at_risk_usd: string;
  insolvent_if_liquidated_accounts: number;
  cumulative_bad_debt_usd: string;
}

interface BookShape {
  waterfall: { points: { index: number; factor: string; engines: WaterfallEngineShape[] }[] } | null;
}

function referenceBook(): BookShape {
  const book = JSON.parse(fixture("book.json")) as BookShape;
  const points = book.waterfall?.points ?? [];
  for (const point of points) {
    for (const engine of point.engines) {
      if (engine.engine === "aave_v3_etherfi") engine.newly_eligible_accounts = 0;
    }
  }
  const cliff = points[2]?.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (cliff === undefined) throw new Error("fixture shape drifted");
  cliff.newly_eligible_accounts = 18;
  return book;
}

async function openFrontier(page: Page, book: unknown): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: fixture("scenarios.json") }),
  );
  await page.route(`${API}/v1/book`, (route) => fulfillJson(route, book));
  await page.goto("/lab");
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
}

/**
 * Run one committed scenario, the way `runbook-bsplit.spec.ts` does.
 *
 * W-FIX-WEB SYNCHRONIZED THIS HELPER. It used to click the chip the moment it
 * existed and click run the moment the chip click dispatched — two gaps under
 * parallelism:
 *   1. the chip renders when `/v1/scenarios` settles, but `/v1/book` settles
 *      on its own schedule, and the frontier panel it renders is a tall block
 *      ABOVE the chips — a late arrival shifts the chip between the harness's
 *      hit check and its dispatch. So the frontier is awaited first, exactly
 *      as `openFrontier` above already does.
 *   2. clicking run "after" the chip click asserts nothing about the
 *      SELECTION the run button's handler closes over. The committed-detail
 *      panel publishes the selected id as its own attribute, so the helper
 *      waits for that receipt before running — the run is then provably the
 *      chosen scenario's, not whichever selection the click raced.
 * No timeout is raised anywhere: both waits target the specific renders the
 * two clicks depend on.
 */
async function openRunBook(page: Page, runBook: unknown): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: fixture("scenarios.json") }),
  );
  await page.route(`${API}/v1/book`, (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: fixture("book.json") }),
  );
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => fulfillJson(route, runBook));
  await page.goto("/lab");
  await expect(page.getByTestId("lab-frontier")).toBeVisible();
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();
  await expect(page.getByTestId("committed-detail")).toHaveAttribute(
    "data-scenario-id",
    "eth_minus_30",
  );
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();
}

test("AC-34/AC-35/AC-36/AC-37: two rows, separate tick sets, a separator carrying row 2's top, no stray money", async ({
  page,
}) => {
  await openFrontier(page, referenceBook());
  const panel = page.getByTestId("frontier-panel").first();

  // AC-34: the inset crit bar is GONE from the eligible row. At the 1.5px
  // floor it occluded the flow bar entirely.
  await expect(panel.getByTestId("frontier-row1").locator(".barCrit")).toHaveCount(0);
  const row1Classes = await panel
    .getByTestId("frontier-row1")
    .evaluate((node) => Array.from(node.querySelectorAll("rect")).map((rect) => rect.getAttribute("class") ?? ""));
  expect(row1Classes.some((klass) => klass.includes("barCrit"))).toBe(false);

  // AC-35: three ticks on row 1, two on row 2, and different top strings.
  await expect(panel.getByTestId("frontier-row1-tick")).toHaveCount(3);
  await expect(panel.getByTestId("frontier-row2-tick")).toHaveCount(2);
  const tops = await panel.evaluate((root) => ({
    row1: root.querySelector("[data-testid='frontier-row1-tick'] text")?.textContent ?? "",
    row2: root.querySelector("[data-testid='frontier-row2-tick'] text")?.textContent ?? "",
  }));
  expect(tops.row1).not.toBe(tops.row2);

  // AC-36: the separator sits BETWEEN the rows and states row 2's maximum.
  const separator = panel.getByTestId("frontier-separator");
  await expect(separator).toContainText("The row below is drawn on its own y scale");
  await expect(separator).toContainText(tops.row2);
  const between = await panel.evaluate((root) => {
    const nodes = Array.from(root.querySelectorAll("*"));
    const at = (id: string) =>
      nodes.findIndex((node) => node.getAttribute("data-testid") === id);
    return at("frontier-row1") < at("frontier-separator") && at("frontier-separator") < at("frontier-row2");
  });
  expect(between).toBe(true);

  // AC-37: no currency string floats inside either SVG except the y ticks.
  const stray = await panel.evaluate((root) => {
    const found: string[] = [];
    for (const svg of Array.from(root.querySelectorAll("svg"))) {
      const ticks = new Set<Element>();
      svg
        .querySelectorAll("[data-testid='frontier-row1-tick'] text, [data-testid='frontier-row2-tick'] text")
        .forEach((t) => ticks.add(t));
      for (const text of Array.from(svg.querySelectorAll("text"))) {
        if (ticks.has(text)) continue;
        if (/\$[\d,]/.test(text.textContent ?? "")) found.push(text.textContent ?? "");
      }
    }
    return found;
  });
  expect(stray).toEqual([]);
});

test("AC-38: the cliff label is the spec's copy, its x is the −20% bar centre, painted before the bars", async ({
  page,
}) => {
  await openFrontier(page, referenceBook());
  const panel = page.getByTestId("frontier-panel").first();
  await expect(panel.getByTestId("frontier-cliff-label")).toHaveText(
    "first sampled shock with new eligibility · 18 accounts",
  );
  const geometry = await panel.getByTestId("frontier-row1").evaluate((node) => {
    const svg = node as unknown as SVGSVGElement;
    const children = Array.from(svg.children);
    const cliff = svg.querySelector("[data-testid='frontier-cliff-line']");
    const bar = svg.querySelector("[data-testid='frontier-row1-bar'][data-column='2']");
    const hit = svg.querySelector("[data-testid='frontier-hit'][data-column='2']");
    const indexOfCliff = children.findIndex(
      (child) => child.getAttribute("data-testid") === "frontier-cliff-line" || child.contains(cliff),
    );
    const indexOfBar = children.findIndex((child) => child.contains(bar));
    return {
      x1: Number(cliff?.getAttribute("x1")),
      barCentre:
        Number(hit?.getAttribute("x")) + Number(hit?.getAttribute("width")) / 2,
      indexOfCliff,
      indexOfBar,
    };
  });
  expect(Math.abs(geometry.x1 - geometry.barCentre)).toBeLessThan(0.5);
  // Painted BEFORE the bars, so a hairline never crosses data ink.
  expect(geometry.indexOfCliff).toBeLessThan(geometry.indexOfBar);
});

test("AC-40/AC-42/AC-43/AC-45: one column per GRID sample, aligned to x(k) at three widths, nothing suppressed", async ({
  page,
}) => {
  const book = referenceBook();
  const gridPoints = book.waterfall?.points.length ?? 0;
  expect(gridPoints).toBeGreaterThan(0);
  await openFrontier(page, book);
  const panel = page.getByTestId("frontier-panel").first();

  // AC-40: the LEDGER's column count is the GRID's, read off the wire.
  await expect(panel.getByTestId("frontier-ledger")).toHaveAttribute(
    "data-columns",
    String(gridPoints),
  );

  for (const width of [700, 1000, 1400]) {
    await page.setViewportSize({ width, height: 1000 });
    const alignment = await panel.evaluate((root, n) => {
      const svg = root.querySelector("[data-testid='frontier-row1']");
      const ledger = root.querySelector("[data-testid='frontier-ledger']");
      if (svg === null || ledger === null) return null;
      const svgBox = svg.getBoundingClientRect();
      const results: { hit: number; cell: number; text: string }[] = [];
      for (let k = 0; k < n; k += 1) {
        const hit = svg.querySelector(`[data-testid='frontier-hit'][data-column='${String(k)}']`);
        const cell = ledger.querySelector(
          `[data-testid='frontier-ledger-cell'][data-column='${String(k)}']`,
        );
        if (hit === null || cell === null) continue;
        const hitBox = hit.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        results.push({
          hit: hitBox.left + hitBox.width / 2 - svgBox.left,
          cell: cellBox.left + cellBox.width / 2 - svgBox.left,
          text: cell.textContent ?? "",
        });
      }
      return results;
    }, gridPoints);
    expect(alignment).not.toBeNull();
    expect(alignment?.length).toBe(gridPoints);
    for (const entry of alignment ?? []) {
      // AC-42: the ledger column centre IS the bar centre, at every width.
      expect(Math.abs(entry.hit - entry.cell), `width ${String(width)}`).toBeLessThan(0.5);
      // AC-43: no value is suppressed at any width.
      expect(entry.text.length).toBeGreaterThan(0);
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });

  // AC-45: one hit target per sample per RENDERED row, each title carrying
  // both exact monetary values and both counts.
  const hits = await panel.evaluate((root) =>
    Array.from(root.querySelectorAll("[data-testid='frontier-hit']")).map((node) => ({
      row: node.getAttribute("data-row"),
      title: node.querySelector("title")?.textContent ?? "",
    })),
  );
  expect(hits.filter((hit) => hit.row === "1")).toHaveLength(gridPoints);
  expect(hits.filter((hit) => hit.row === "2")).toHaveLength(gridPoints);
  for (const hit of hits) {
    expect(hit.title).toContain("Σ eligible debt $");
    expect(hit.title).toContain("bad debt $");
    expect(hit.title).toContain("first eligible on grid");
    expect(hit.title).toContain("eligible accounts");
  }
});

test("AC-41: a sample this engine did not serve is an em-dash column marked `not served`", async ({
  page,
}) => {
  const book = referenceBook();
  const point = book.waterfall?.points[3];
  if (point === undefined) throw new Error("fixture shape drifted");
  point.engines = point.engines.filter((engine) => engine.engine !== "aave_v3_etherfi");
  await openFrontier(page, book);
  const panel = page.getByTestId("frontier-panel").first();
  await expect(panel).toHaveAttribute("data-engine", "aave_v3_etherfi");

  const column = panel.locator("[data-testid='frontier-ledger-cell'][data-column='3']");
  await expect(column).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
    await expect(column.nth(i)).toHaveText("—");
  }
  const notServed = panel.locator("[data-testid='frontier-not-served'][data-column='3']");
  // The visible glyph is the tick annotation; the `<title>` carries WHY, and
  // LAW-5 is satisfied because the em-dash column above already says it.
  expect(await notServed.evaluate((node) => node.firstChild?.textContent ?? "")).toBe("not served");
  await expect(notServed.locator("title")).toHaveText(
    "This engine served no point at this sample. The values are unknown rather than zero.",
  );
  // …and a COMPUTED ZERO in a served column still renders `$0`.
  await expect(
    panel.locator("[data-testid='frontier-ledger-cell'][data-column='0']").first(),
  ).toHaveText("$0");
});

test("AC-46: an all-zero bad-debt grid draws no row 2 and states the zero", async ({ page }) => {
  const book = referenceBook();
  for (const point of book.waterfall?.points ?? []) {
    for (const engine of point.engines) engine.cumulative_bad_debt_usd = "0";
  }
  await openFrontier(page, book);
  const panel = page.getByTestId("frontier-panel").first();
  await expect(panel.getByTestId("frontier-row2")).toHaveAttribute("data-drawn", "false");
  await expect(panel.getByTestId("frontier-row2-bar")).toHaveCount(0);
  await expect(panel.getByTestId("frontier-bad-debt-zero")).toHaveText(
    "Bad debt is $0 at every step on this grid. That is a computed zero from the served waterfall.",
  );
  // The whole-grid claim is EARNED here: every sample carries a served cell.
  await expect(panel.getByTestId("frontier-bad-debt-zero")).toHaveAttribute("data-holes", "0");
  await expect(panel.getByTestId("frontier-not-served")).toHaveCount(0);
});

// W-CH-B finding 1 — ZERO PLUS HOLE, the combination the sentence got wrong.
//
// `peakBadDebt` maximises over SERVED points, so this grid yields the same 0n
// as the fully-served one above and row 2 is dropped the same way. The old
// copy then claimed "$0 at every step on this grid" while the ledger directly
// beneath printed em dashes for the unserved column and the axis printed `not
// served` under its tick. A computed zero and an unknowable were stated as the
// same thing, on the surface whose whole job is telling them apart.
test("W-CH-B / AC-46: an all-zero bad-debt grid WITH a hole claims only the served samples", async ({
  page,
}) => {
  const book = referenceBook();
  for (const point of book.waterfall?.points ?? []) {
    for (const engine of point.engines) engine.cumulative_bad_debt_usd = "0";
  }
  const point = book.waterfall?.points[3];
  if (point === undefined) throw new Error("fixture shape drifted");
  point.engines = point.engines.filter((engine) => engine.engine !== "aave_v3_etherfi");
  const gridPoints = book.waterfall?.points.length ?? 0;

  await openFrontier(page, book);
  const panel = page.getByTestId("frontier-panel").first();
  await expect(panel).toHaveAttribute("data-engine", "aave_v3_etherfi");

  // Row 2 is still dropped — the peak over served points is still zero.
  await expect(panel.getByTestId("frontier-row2")).toHaveAttribute("data-drawn", "false");
  await expect(panel.getByTestId("frontier-row2-bar")).toHaveCount(0);

  // The hole is on the axis and in the ledger, as an unknown.
  await expect(panel.locator("[data-testid='frontier-not-served'][data-column='3']")).toHaveCount(1);
  const holed = panel.locator("[data-testid='frontier-ledger-cell'][data-column='3']");
  await expect(holed).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) await expect(holed.nth(i)).toHaveText("—");

  // …so the sentence in row 2's place claims the SERVED samples and no more.
  const stated = panel.getByTestId("frontier-bad-debt-zero");
  await expect(stated).toHaveAttribute("data-served", String(gridPoints - 1));
  await expect(stated).toHaveAttribute("data-holes", "1");
  await expect(stated).toHaveText(
    `Bad debt is $0 at the ${String(gridPoints - 1)} samples this engine served. 1 of ` +
      `${String(gridPoints)} samples was not served, and bad debt there is unknown rather ` +
      `than zero.`,
  );
  await expect(stated).not.toContainText("every step on this grid");
});

test("AC-47/AC-48: METHOD and LEDGER wiring, and the STATE caveats before the SVG", async ({
  page,
}) => {
  await openFrontier(page, referenceBook());
  const panel = page.getByTestId("frontier-panel").first();
  const wiring = await panel.getByTestId("frontier-row1").evaluate((node) => {
    const describedby = node.getAttribute("aria-describedby") ?? "";
    const details = node.getAttribute("aria-details") ?? "";
    return {
      describedTestId: document.getElementById(describedby)?.getAttribute("data-testid") ?? "",
      detailsTestId: document.getElementById(details)?.getAttribute("data-testid") ?? "",
      ledgerInDetails:
        document.getElementById(details)?.closest("details") === null ? false : true,
    };
  });
  expect(wiring.describedTestId).toBe("frontier-method");
  expect(wiring.detailsTestId).toBe("frontier-ledger");
  expect(wiring.ledgerInDetails).toBe(false);

  await expect(panel.getByTestId("frontier-exact-data")).toBeVisible();
  await panel.getByTestId("frontier-exact-data").click();
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? "",
  );
  expect(focused).toBe("frontier-ledger");

  // AC-48: both caveats in STATE, both BEFORE the SVG in DOM order (R6).
  const order = await page.getByTestId("lab-frontier").evaluate((root) => {
    const nodes = Array.from(root.querySelectorAll("*"));
    const at = (id: string) => nodes.findIndex((node) => node.getAttribute("data-testid") === id);
    return {
      sampling: at("frontier-shock-sampling"),
      scale: at("frontier-independent-scale"),
      svg: at("frontier-row1"),
    };
  });
  expect(order.sampling).toBeGreaterThan(-1);
  expect(order.scale).toBeGreaterThan(-1);
  expect(order.sampling).toBeLessThan(order.svg);
  expect(order.scale).toBeLessThan(order.svg);
  await expect(page.getByTestId("frontier-shock-sampling")).toHaveText(
    "This grid samples discrete shocks. Values between samples were not computed.",
  );
  await expect(page.getByTestId("frontier-independent-scale")).toHaveText(
    "The two rows carry separate y axes. Bar heights are comparable within a row and never " +
      "between rows.",
  );
});

// ===========================================================================
// CROSS-SURFACE
// ===========================================================================

test("W-CH-B / AC-53: the run-book distributions carry the same true-share law", async ({
  page,
}) => {
  const runBook = JSON.parse(fixture("run-book.eth_minus_30.json")) as {
    engines: {
      engine: string;
      before: { hf_histogram: { buckets: { label: string; count: number }[] } };
      after: { hf_histogram: { buckets: { label: string; count: number }[] } };
    }[];
  };
  const aave = runBook.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("fixture shape drifted: no aave engine");
  for (const side of [aave.before, aave.after]) {
    for (const bucket of side.hf_histogram.buckets) bucket.count = 0;
    const tiny = side.hf_histogram.buckets[3];
    const bulk = side.hf_histogram.buckets[7];
    if (tiny === undefined || bulk === undefined) throw new Error("fixture shape drifted");
    tiny.count = 1;
    bulk.count = 10_000;
  }
  await openRunBook(page, runBook);

  const pair = page.locator(
    '[data-testid="runbook-histogram-pair"][data-engine="aave_v3_etherfi"]',
  );
  await expect(pair.getByTestId("runbook-hist-denominator-before")).toContainText("10,001");

  const bars = await pair
    .getByTestId("runbook-hist-bar")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        bucket: node.getAttribute("data-bucket") ?? "",
        width: Number(node.getAttribute("width")),
      })),
    );
  // Two buckets on each of the two sides.
  expect(bars).toHaveLength(4);
  const tiny = bars.filter((bar) => bar.width < 1);
  const bulk = bars.filter((bar) => bar.width >= 1);
  expect(tiny).toHaveLength(2);
  expect(bulk).toHaveLength(2);
  // The run-book axis is 168px wide: 1 of 10,001 is 0.0167982px on it.
  for (const bar of tiny) {
    expect(bar.width).toBeCloseTo(0.016798, 6);
    expect(bar.width).toBeLessThan(0.5);
  }
  for (const bar of bulk) expect(bar.width).toBeCloseTo(167.983201, 5);
  expect((tiny[0]?.width ?? 0) / (bulk[0]?.width ?? 1)).toBeCloseTo(1 / 10_000, 7);

  // One presence dot per side, on the bucket whose bar cannot state its share.
  await expect(pair.getByTestId("runbook-hist-presence")).toHaveCount(2);
  const rows = await pair
    .getByTestId("runbook-hist-row-label")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(rows.filter((row) => row === "1 · 0%")).toHaveLength(2);
});

// ===========================================================================
// AC-54 / CX-7 / LAW-3 — 12 RENDERED CSS px, on EVERY chart this wave changed,
// at both ends of the responsive range, in both themes.
//
// W-CH-B REWROTE THIS. The old check was vacuous three ways over:
//
//   it looked at TWO of the changed regions (the density grid and the risk-map
//   ledger) and skipped the histograms this wave rewrote outright;
//   it ran at ONE viewport, so the narrow end, where scaling happens, was
//   never visited;
//   and it read `getComputedStyle(node).fontSize`, which reports the AUTHORED
//   size. A viewBox scale of 0.6 leaves that string at `12px` while the reader
//   gets 7.2px. `BookHistogram` and `LabRunBookDetail` carried
//   `maxWidth: 100%`, so they did exactly that below their authored width, and
//   this test passed anyway.
//
// The measurement is the SCREEN CTM now: `getScreenCTM().a` is the factor from
// SVG user units to rendered CSS px, so `fontSize × a` is the size a reader
// actually gets, and it is cross-checked against boundingBox ÷ viewBox on the
// root. The law is the spec's own (LAW-3): render 1:1 from a measured width,
// with a minimum width and horizontal scroll below it. So a chart may never be
// scaled down, and a chart wider than its container must sit in a scroll
// container.
// ===========================================================================

// W-CH-C SHARPENED IT TWICE MORE.
//
//   THE HOLDER WAS THE IMMEDIATE PARENT. The frontier's SVGs and ledger sit
//   inside a plain width-setting `<div>` that is exactly as wide as they are,
//   so `root.parentElement` was never the frame that has to scroll. `overflows`
//   came back false at 360px for a 640px chart, the scroll clause never fired,
//   and deleting `overflow-x` from `.measuredFrame` would have left this test
//   green while the whole page scrolled sideways. The frame is NAMED per chart
//   now, never inferred, and the assertion is on THAT element's own
//   `overflow-x` — an ancestor scroller somewhere up the tree is not the local
//   answer LAW-3 asks for.
//
//   `>= 0.999` PASSED A 2x SCALE. The bound was one-sided, so a chart rendered
//   at twice its authored size — a 12px label arriving at 24px, every measured
//   geometry constant doubled — cleared it comfortably. 1:1 means 1:1: the
//   assertion is |s − 1| <= 0.001 in both directions.

// NARROW is below every changed chart's authored width, so each one has to
// answer LAW-3 here: keep 1:1 and scroll, or fail. The run-book's sides are
// only 340px wide, which is why the narrow end has to be this narrow.
const NARROW = { width: 360, height: 1000 };
const WIDE = { width: 1500, height: 1100 };

interface ChartTarget {
  /** The region measured for rendered typography and 1:1 scale. */
  root: string;
  /**
   * The element LAW-3 designates to hold it — the one that must scroll when
   * the chart is wider than the space it was given. Named per chart rather
   * than inferred from the DOM, because an inferred holder is exactly what
   * made the old clause vacuous. May equal `root` for a region that is its
   * own frame.
   */
  frame: string;
}

interface ChartAudit {
  root: string;
  /** boundingBox ÷ viewBox on the root SVG; 1 for an HTML region. */
  boxScale: number;
  /** `getScreenCTM().a` on the root SVG; 1 for an HTML region. */
  ctmScale: number;
  /** The designated frame's `data-testid`, or null when it does not exist. */
  frame: string | null;
  /** What the frame has to hold: the chart itself, or its own wider content. */
  contentWidth: number;
  frameClientWidth: number;
  frameScrollWidth: number;
  /** The frame's OWN computed `overflow-x`. Not an ancestor's. */
  frameOverflowX: string;
  nodes: { text: string; rendered: number; color: string }[];
}

/**
 * Measure every chart region named by `targets`, in RENDERED px.
 *
 * The node set is deliberately the same one the old check used — `text`, `td`,
 * `th`, `p`, `h4` — so nothing is traded away for the new dimensions.
 */
async function auditCharts(
  page: Page,
  targets: readonly ChartTarget[],
): Promise<{ charts: ChartAudit[]; panel: string; docScroll: number; docClient: number }> {
  return page.evaluate((list) => {
    const charts: ChartAudit[] = [];
    for (const target of list) {
      for (const root of Array.from(document.querySelectorAll(target.root))) {
        const box = root.getBoundingClientRect();
        const isSvg = root.tagName.toLowerCase() === "svg";
        const svg = isSvg ? (root as unknown as SVGSVGElement) : null;
        const viewBoxWidth = svg?.viewBox.baseVal.width ?? 0;
        const ctm = svg?.getScreenCTM() ?? null;
        // `closest` starts at the root, so a region that IS its own frame
        // resolves to itself and still gets measured.
        const frame = root.closest(target.frame);
        const nodes: { text: string; rendered: number; color: string }[] = [];
        for (const node of Array.from(root.querySelectorAll("text, td, th, p, h4"))) {
          const text = (node.textContent ?? "").trim();
          if (text.length === 0) continue;
          const style = getComputedStyle(node);
          const size = Number.parseFloat(style.fontSize);
          const own =
            node.tagName.toLowerCase() === "text"
              ? ((node as unknown as SVGGraphicsElement).getScreenCTM()?.a ?? 1)
              : 1;
          nodes.push({
            text,
            rendered: size * own,
            color: node.tagName.toLowerCase() === "text" ? style.fill : style.color,
          });
        }
        charts.push({
          root: root.getAttribute("data-testid") ?? target.root,
          boxScale: isSvg && viewBoxWidth > 0 ? box.width / viewBoxWidth : 1,
          ctmScale: ctm?.a ?? 1,
          frame: frame === null ? null : (frame.getAttribute("data-testid") ?? target.frame),
          // The chart's own rendered width AND whatever else the frame is
          // holding: a ledger that is its own frame overflows through its
          // tables, not through its outer box.
          contentWidth: Math.max(box.width, frame?.scrollWidth ?? 0),
          frameClientWidth: frame?.clientWidth ?? 0,
          frameScrollWidth: frame?.scrollWidth ?? 0,
          frameOverflowX: frame === null ? "" : getComputedStyle(frame).overflowX,
          nodes,
        });
      }
    }
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue("--panel")
      .trim();
    document.body.append(probe);
    const panel = getComputedStyle(probe).color;
    probe.remove();
    return {
      charts,
      panel,
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
    };
  }, targets as ChartTarget[]);
}

/** The whole law, applied to one page's charts at one viewport in one theme. */
async function expectRenderedTypography(
  page: Page,
  targets: readonly ChartTarget[],
  expectedRegions: number,
  label: string,
): Promise<void> {
  const { charts, panel, docScroll, docClient } = await auditCharts(page, targets);
  expect(charts.length, `${label}: chart regions found`).toBe(expectedRegions);
  let measured = 0;
  for (const chart of charts) {
    const where = `${label} · ${chart.root}`;
    // 1:1, in BOTH directions. An SVG scaled to 0.6 keeps reporting 12px font
    // while rendering 7.2px of it, and one scaled to 2 renders a 24px label
    // for every geometry constant the spec fixes in rendered px. Neither is
    // 1:1, and a one-sided `>= 0.999` only ever caught the first.
    expect(Math.abs(chart.ctmScale - 1), `${where}: CTM scale ${String(chart.ctmScale)}`)
      .toBeLessThanOrEqual(0.001);
    expect(Math.abs(chart.boxScale - 1), `${where}: box ÷ viewBox ${String(chart.boxScale)}`)
      .toBeLessThanOrEqual(0.001);
    // …and the two measures agree, so neither can be lying alone.
    expect(Math.abs(chart.ctmScale - chart.boxScale), `${where}: scale agreement`).toBeLessThan(
      0.01,
    );
    // A chart wider than the frame holding it scrolls IN THAT FRAME rather
    // than shrinking — and the frame has somewhere to scroll to.
    expect(chart.frame, `${where}: designated frame missing`).not.toBeNull();
    if (chart.contentWidth > chart.frameClientWidth + 1) {
      expect(
        ["auto", "scroll"],
        `${where}: frame ${String(chart.frame)} holds ` +
          `${chart.contentWidth.toFixed(1)}px in ${String(chart.frameClientWidth)}px, ` +
          `so it must scroll locally (overflow-x: ${chart.frameOverflowX})`,
      ).toContain(chart.frameOverflowX);
      expect(
        chart.frameScrollWidth,
        `${where}: frame ${String(chart.frame)} scrollWidth`,
      ).toBeGreaterThan(chart.frameClientWidth);
    }
    for (const node of chart.nodes) {
      expect(node.rendered, `${where}: "${node.text}" rendered px`).toBeGreaterThanOrEqual(12);
      expect(
        contrastOf(node.color, panel),
        `${where}: "${node.text}" (${node.color})`,
      ).toBeGreaterThanOrEqual(4.5);
      measured += 1;
    }
  }
  expect(measured, `${label}: text nodes measured`).toBeGreaterThan(5);
  // The harm a vacuous scroll clause hides is a page that scrolls sideways.
  // Charts keep their width and their frames absorb it, so the document never
  // does.
  expect(docScroll, `${label}: document scrollWidth vs ${String(docClient)}px`).toBeLessThanOrEqual(
    docClient + 1,
  );
}

/** Both themes, at one viewport, on one set of chart regions. */
async function expectBothThemes(
  page: Page,
  targets: readonly ChartTarget[],
  expectedRegions: number,
  viewport: { width: number; height: number },
  surface: string,
): Promise<void> {
  await page.setViewportSize(viewport);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    await expectRenderedTypography(
      page,
      targets,
      expectedRegions,
      `${surface} @${String(viewport.width)}px ${theme}`,
    );
  }
}

test("AC-54: the loss frontier renders 12px at both breakpoints", async ({ page }) => {
  await openFrontier(page, referenceBook());
  const panel = page.getByTestId("frontier-panel").first();
  await expect(panel.getByTestId("frontier-row1")).toBeVisible();
  // Two engine panels, each with row 1, row 2 and a ledger. All three sit
  // inside ONE `frontier-frame`, behind a width-setting inner div — the exact
  // nesting that made the old immediate-parent check vacuous, so it is the
  // frame each of the three is audited against.
  const targets: ChartTarget[] = [
    { root: "[data-testid='frontier-row1']", frame: "[data-testid='frontier-frame']" },
    { root: "[data-testid='frontier-row2']", frame: "[data-testid='frontier-frame']" },
    { root: "[data-testid='frontier-ledger']", frame: "[data-testid='frontier-frame']" },
  ];
  await expectBothThemes(page, targets, 6, NARROW, "lab");
  await expectBothThemes(page, targets, 6, WIDE, "lab");
});

test("AC-54: the run-book distributions render 12px at both breakpoints", async ({ page }) => {
  await openRunBook(page, JSON.parse(fixture("run-book.eth_minus_30.json")));
  // Two engines × before/after, each in its own scroll frame.
  const targets: ChartTarget[] = [
    {
      root: "svg[data-testid^='runbook-hist-svg-']",
      frame: "[data-testid^='runbook-hist-frame-']",
    },
  ];
  await expect(page.locator("svg[data-testid^='runbook-hist-svg-']")).toHaveCount(4);
  await expectBothThemes(page, targets, 4, NARROW, "run-book");
  await expectBothThemes(page, targets, 4, WIDE, "run-book");
});

// AC-49 / CX-1 / CX-2 — the run-book card is a NET delta and says so.
//
// `cmd/api/p5_runbook.go` computes `NewlyEligibleAccounts` as
// `ea.eligibleAccounts − eb.eligibleAccounts`, and the contract's own note
// says it "subtracts any flip back to healthy". The card called it "Newly
// eligible accounts", which names a gross arrival count — a strictly larger
// number whenever anything healed.
test("AC-49: the run-book card is `Net change in eligible accounts`, always signed", async ({
  page,
}) => {
  const runBook = JSON.parse(fixture("run-book.eth_minus_30.json")) as {
    engines: { engine: string; newly_eligible_accounts: number }[];
  };
  const positive = structuredClone(runBook);
  if (positive.engines[0] === undefined) throw new Error("fixture shape drifted");
  positive.engines[0].newly_eligible_accounts = 164;
  if (positive.engines[1] !== undefined) positive.engines[1].newly_eligible_accounts = -3;

  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: fixture("scenarios.json"),
    }),
  );
  await page.route(`${API}/v1/book`, (route) => fulfillJson(route, BOOK));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => fulfillJson(route, positive));

  await page.goto("/lab");
  await page.locator('[data-testid="lab-chip"][data-scenario-id="eth_minus_30"]').click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();

  const cards = page.getByTestId("net-eligible-card");
  await expect(cards.first()).toContainText("Net change in eligible accounts");
  // Values ALWAYS carry a sign, and the negative uses U+2212.
  await expect(page.getByTestId("net-eligible-card-value").nth(0)).toHaveText("+164");
  await expect(page.getByTestId("net-eligible-card-value").nth(1)).toHaveText("−3");
  const minus = await page
    .getByTestId("net-eligible-card-value")
    .nth(1)
    .evaluate((node) => (node.textContent ?? "").charCodeAt(0));
  expect(minus).toBe(0x2212);

  // Tone is crit ABOVE zero and default at or below: a favourable metric
  // movement is not a favourable scenario.
  await expect(cards.nth(0)).toHaveAttribute("data-tone", "crit");
  await expect(cards.nth(1)).toHaveAttribute("data-tone", "default");

  // Accounts are dimensionless, so the sub carries NO unit clause.
  const sub = await cards.first().innerText();
  expect(sub).toContain(
    "After eligible count minus before for this engine's run. " +
      "Healthy→eligible adds; eligible→healthy subtracts.",
  );
  expect(sub).not.toContain("usd");
  expect(sub).not.toContain("decimals");

  // …and a bare zero renders as `0`, still with no gross reading available.
  const zeroed = structuredClone(positive);
  if (zeroed.engines[0] !== undefined) zeroed.engines[0].newly_eligible_accounts = 0;
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) => fulfillJson(route, zeroed));
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("net-eligible-card-value").nth(0)).toHaveText("0");
  await expect(page.getByTestId("net-eligible-card").nth(0)).toHaveAttribute("data-tone", "default");

  // CX-1: no page text carries the gross phrase any more.
  expect(await page.locator("body").innerText()).not.toContain("Newly eligible accounts");
});

// AC-50 in the DOM: CX-2 and CX-3 share no phrase, on one page.
test("AC-50: the frontier ledger says `first eligible on grid`; no surface says `first crossings`", async ({
  page,
}) => {
  await openFrontier(page, referenceBook());
  const ledger = page.getByTestId("frontier-ledger").first();
  await expect(ledger).toContainText("first eligible on grid");
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("first crossings");
  // CX-1: the two repairs share no phrase.
  expect(body).not.toContain("Net change in eligible accounts");
  const title = await ledger
    .locator("[role='rowheader']")
    .nth(2)
    .getAttribute("title");
  expect(title).toBe(
    "Accounts first observed eligible at this grid point. At unshocked, this is the standing " +
      "census; at later points, first sampled eligibility. Each account appears once and " +
      "remains in cumulative eligible accounts thereafter.",
  );
});

// AC-51 in the DOM: one grouped-USD renderer, so no two Lab panels disagree.
test("AC-51: every Lab money value at or above 1000 is grouped, on one page", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route(`${API}/v1/scenarios`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: fixture("scenarios.json"),
    }),
  );
  await page.route(`${API}/v1/book`, (route) => fulfillJson(route, BOOK));
  await page.route(`${API}/v1/scenarios/*/run-book`, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: fixture("run-book.weeth_market_depeg_oracles_held.json"),
    }),
  );
  await page.goto("/lab");
  await page
    .locator('[data-testid="lab-chip"][data-scenario-id="weeth_market_depeg_oracles_held"]')
    .click();
  await page.getByTestId("run-book-button").click();
  await expect(page.getByTestId("book-result")).toBeVisible();

  const body = await page.locator("body").innerText();
  // An UNGROUPED four-or-more-digit dollar amount is the defect CX-4 closed.
  const ungrouped = body.match(/\$\d{4,}(?!\d*,)/g) ?? [];
  expect(ungrouped).toEqual([]);
});
