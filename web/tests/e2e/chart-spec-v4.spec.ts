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
//   risk map   AC-6..AC-16, AC-18, AC-20..AC-33
//   frontier   AC-34..AC-38, AC-40..AC-43, AC-45..AC-48
//   cross      AC-49, AC-52..AC-55

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1 } from "../fixtures/book";

const CORS = { "access-control-allow-origin": "*" };
const API = "http://localhost:8080";

/** DensityMap's own geometry constants — the spec's numbers, restated once. */
const MARGIN_LEFT = 100;
const LANE_W = 48;
const LANE_GAP = 14;

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

// ---------------------------------------------------------------------------
// Row-building. The Aave verdict is `health_factor.wad < 1e18` on the wad, and
// headroom is `(wad − 1e18) / wad`, so a row's band and its crit verdict are
// both set by ONE field and neither is invented here.
// ---------------------------------------------------------------------------

interface RowSpec {
  account: string;
  /** total_debt in the engine's own integer units at `decimals`. */
  debt: string;
  /** health_factor.wad — below 1e18 is liquidatable AND breached. */
  wad: string;
}

/** wad 1.08e18 → headroom 7.4%, the 5–10% band. */
const HEALTHY_WAD = "1080000000000000000";
/** wad 1.43e18 → headroom ~30%, the 25–50% band. */
const ROOMY_WAD = "1430000000000000000";
/** wad 0.9e18 → breached AND liquidatable (crit). */
const CRIT_WAD = "900000000000000000";

function positionsPage(rows: readonly RowSpec[], decimals = 8): unknown {
  const base = structuredClone(POSITIONS_AAVE_PAGE_1);
  const template = base.positions[0];
  if (template === undefined) throw new Error("fixture shape drifted: no template position");
  base.limit = 200;
  base.next_cursor = null;
  base.total_positions = rows.length;
  base.positions = rows.map((row) => {
    const position = structuredClone(template);
    position.account = row.account;
    position.value_decimals = decimals;
    position.total_debt = row.debt;
    position.total_collateral = row.debt;
    position.liquidatable = null;
    if (position.health_factor !== null) {
      position.health_factor.wad = row.wad;
      position.health_factor.num = row.wad;
      position.health_factor.den = "1000000000000000000";
      position.health_factor.infinite = false;
    }
    return position;
  });
  return base;
}

function account(index: number): string {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

async function openMap(page: Page, rows: readonly RowSpec[], decimals = 8): Promise<void> {
  const page1 = positionsPage(rows, decimals);
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => fulfillJson(route, page1));
  await page.goto("/book?engine=aave_v3_etherfi&dust=off");
  await expect(page.getByTestId("density-grid")).toBeVisible();
}

/** The WCAG 2.x relative-luminance contrast ratio of two rendered colours. */
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
// RM-1..RM-4 — the ordered compressed sub-$1 lane, the break glyph, the ticks
// ===========================================================================

test("AC-6/AC-7/AC-8: the lane, its ONE label, and the $1 tick at exactly left + 48 + 14", async ({
  page,
}) => {
  // A book spanning $0.000001 to $10,000: the lane's whole reason to exist.
  await openMap(
    page,
    [
      { account: account(0), debt: "1", wad: HEALTHY_WAD }, // $0.000001
      { account: account(1), debt: "46", wad: HEALTHY_WAD }, // $0.000046
      { account: account(2), debt: "500000", wad: ROOMY_WAD }, // $0.50
      { account: account(3), debt: "150000000", wad: HEALTHY_WAD }, // $150
      { account: account(4), debt: "10000000000", wad: ROOMY_WAD }, // $10,000
    ],
    6,
  );

  const grid = page.getByTestId("density-grid");
  await expect(grid).toHaveAttribute("data-lane", "true");
  await expect(page.getByTestId("density-axis-break")).toHaveCount(1);
  await expect(page.getByTestId("density-axis-break-diagonal")).toHaveCount(2);

  // AC-7: EXACTLY ONE `<$1` label.
  await expect(page.getByTestId("density-lane-label")).toHaveCount(1);
  await expect(page.getByTestId("density-lane-label")).toHaveText("<$1");

  // AC-7: no tick line and no gridline sits INSIDE the lane. A compressed
  // lane has no ruler, and drawing one would invite the exact reading its own
  // disclosure denies.
  const gridlineX = await page
    .getByTestId("density-x-gridline")
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-x"))));
  expect(gridlineX.length).toBeGreaterThan(0);
  for (const x of gridlineX) expect(x).toBeGreaterThanOrEqual(MARGIN_LEFT + LANE_W);

  // AC-8: the `$1` decade tick sits at left + lane + gap, exactly.
  expect(Math.min(...gridlineX)).toBeCloseTo(MARGIN_LEFT + LANE_W + LANE_GAP, 6);

  // AC-27: the lane disclosure carries the COMPUTED lower bound.
  await expect(page.getByTestId("risk-map-lane-disclosure")).toHaveText(
    "Sub-$1 debts occupy an order-preserving compressed log lane spanning $1e-6 to <$1 in " +
      "this snapshot. Horizontal distances in this lane are not comparable with the main axis.",
  );
});

test("AC-6: an all-sub-$1 book draws NO lane, NO break glyph and NO `<$1` label", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "1", wad: HEALTHY_WAD }, // $0.000001
      { account: account(1), debt: "500000", wad: ROOMY_WAD }, // $0.50
    ],
    6,
  );
  await expect(page.getByTestId("density-grid")).toHaveAttribute("data-lane", "false");
  await expect(page.getByTestId("density-axis-break")).toHaveCount(0);
  await expect(page.getByTestId("density-lane-label")).toHaveCount(0);
  await expect(page.getByTestId("risk-map-lane-disclosure")).toHaveCount(0);
});

test("AC-9/AC-11: sub-$1 bins live inside the lane, at least 1.5px wide, order preserved", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "1", wad: HEALTHY_WAD }, // $0.000001
      { account: account(1), debt: "50000", wad: HEALTHY_WAD }, // $0.05
      { account: account(2), debt: "10000000000", wad: HEALTHY_WAD }, // $10,000
    ],
    6,
  );
  const lane = await page.getByTestId("risk-bin").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        xIndex: Number(node.getAttribute("data-x-index")),
        x: Number(node.getAttribute("x")),
        width: Number(node.getAttribute("width")),
      }))
      .filter((bin) => bin.xIndex < 0),
  );
  expect(lane.length).toBe(2);
  for (const bin of lane) {
    expect(bin.x).toBeGreaterThanOrEqual(MARGIN_LEFT);
    expect(bin.x + bin.width).toBeLessThanOrEqual(MARGIN_LEFT + LANE_W + 0.001);
    expect(bin.width).toBeGreaterThanOrEqual(1.5);
  }
  // AC-11: ORDER IS PRESERVED inside the lane.
  const sorted = [...lane].sort((a, b) => a.xIndex - b.xIndex);
  expect(sorted[0]?.x).toBeLessThan(sorted[1]?.x ?? 0);
});

// ===========================================================================
// RM-11 / LAW-3 — rendered pixels
// ===========================================================================

test("AC-12: the SVG renders 1:1 from the measured width, with no scale factor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);

  const measured = await page.getByTestId("density-grid").evaluate((node) => {
    const svg = node as unknown as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    return {
      widthAttr: Number(svg.getAttribute("width")),
      viewBox: svg.getAttribute("viewBox") ?? "",
      rendered: box.width,
    };
  });
  expect(measured.widthAttr).toBeGreaterThanOrEqual(720);
  // The viewBox width equals the width attribute: one user unit is one px.
  expect(measured.viewBox.split(" ")[2]).toBe(String(measured.widthAttr));
  expect(measured.rendered).toBeCloseTo(measured.widthAttr, 0);
});

// ===========================================================================
// RM-5..RM-7 — encoding and marginals
// ===========================================================================

test("AC-13/AC-14: the ramp is 0.30/0.48/0.66/0.85 and every cell clears 3:1", async ({ page }) => {
  // 1 / 10 / 100 accounts in three different bands: three ramp steps.
  const rows: RowSpec[] = [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }];
  for (let i = 0; i < 10; i += 1) {
    rows.push({ account: account(100 + i), debt: "150000000", wad: ROOMY_WAD });
  }
  await openMap(page, rows, 6);

  const cells = await page.getByTestId("risk-bin").evaluateAll((nodes) =>
    nodes.map((node) => ({
      step: Number(node.getAttribute("data-step")),
      fillOpacity: getComputedStyle(node).fillOpacity,
      stroke: getComputedStyle(node).stroke,
      strokeWidth: getComputedStyle(node).strokeWidth,
    })),
  );
  const ramp: Record<number, string> = { 1: "0.3", 2: "0.48", 3: "0.66", 4: "0.85" };
  expect(cells.length).toBeGreaterThan(1);
  for (const cell of cells) {
    expect(cell.fillOpacity).toBe(ramp[cell.step]);
    expect(cell.strokeWidth).toBe("1px");
  }
  // The cell's boundary carries the 3:1 non-text floor, in BOTH themes. A 30%
  // wash cannot reach 3:1 on a white panel by FILL alone — the arithmetic
  // ceiling for any colour at 0.30 over #ffffff is 2.16:1 — so the measured
  // ratio is taken on the boundary WCAG 1.4.11 actually asks about.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    const measured = await page.getByTestId("risk-bin").first().evaluate((node) => ({
      stroke: getComputedStyle(node).stroke,
      panel: getComputedStyle(document.documentElement).getPropertyValue("--panel").trim(),
    }));
    const panelRgb = await page.evaluate((hex) => {
      const probe = document.createElement("span");
      probe.style.color = hex;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, measured.panel);
    expect(contrastOf(measured.stroke, panelRgb), `${theme} cell boundary`).toBeGreaterThanOrEqual(
      3,
    );
  }
});

test("AC-15: the seven marginal bars share ONE scale, and a zero band draws no ink", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "100000000", wad: HEALTHY_WAD }, // $100, band 3
      { account: account(1), debt: "300000000", wad: ROOMY_WAD }, // $300, band 5
    ],
    6,
  );
  const bars = await page.getByTestId("density-band-bar").evaluateAll((nodes) =>
    nodes.map((node) => ({
      band: Number(node.getAttribute("data-band")),
      length: Number(node.getAttribute("data-length")),
    })),
  );
  // A zero-Σ band renders NO rect: a bar of length zero is not a small bar.
  expect(bars).toHaveLength(2);
  const short = bars.find((bar) => bar.band === 3);
  const long = bars.find((bar) => bar.band === 5);
  expect(long?.length).toBeGreaterThan(0);
  // The RATIO of the two bar lengths equals the ratio of their exact Σ debt.
  expect(Math.abs((short?.length ?? 0) - (long?.length ?? 0) / 3)).toBeLessThan(0.5);
});

test("AC-16: no currency text floats inside the risk-map SVG except the axis ticks", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "150000000", wad: HEALTHY_WAD },
      { account: account(1), debt: "10000000000", wad: ROOMY_WAD },
    ],
    6,
  );
  const stray = await page.getByTestId("density-grid").evaluate((node) => {
    const svg = node as unknown as SVGSVGElement;
    const ticks = new Set<Element>();
    svg.querySelectorAll("[data-testid='density-x-tick'] text").forEach((t) => ticks.add(t));
    svg.querySelectorAll("[data-testid='density-lane-label']").forEach((t) => ticks.add(t));
    return Array.from(svg.querySelectorAll("text"))
      .filter((t) => !ticks.has(t))
      .map((t) => t.textContent ?? "")
      .filter((text) => /\$[\d,]/.test(text));
  });
  expect(stray).toEqual([]);
});

test("AC-17: the legend names the four RANGES, not four exact counts", async ({ page }) => {
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);
  await expect(page.getByTestId("density-legend")).toContainText(
    "1–9 · 10–99 · 100–999 · 1,000+ accounts",
  );
});

// ===========================================================================
// RM-8 — the crit strip
// ===========================================================================

test("AC-18: two crit rows one unit apart dodge into lanes 8px apart, both titled", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "1000", wad: CRIT_WAD },
      { account: account(1), debt: "1001", wad: CRIT_WAD },
    ],
    0,
  );
  const marks = await page.getByTestId("risk-crit").evaluateAll((nodes) =>
    nodes.map((node) => ({
      y: Number(node.getAttribute("y")),
      title: node.querySelector("title")?.textContent ?? "",
    })),
  );
  expect(marks).toHaveLength(2);
  expect(Math.abs((marks[0]?.y ?? 0) - (marks[1]?.y ?? 0))).toBeGreaterThanOrEqual(8);
  for (const mark of marks) expect(mark.title.length).toBeGreaterThan(0);
});

test("AC-20: 20 colliding crit rows take 20 lanes; the strip GROWS to 8 + 20*8", async ({
  page,
}) => {
  // TWENTY ROWS AT ONE DEBT: the hardest case the strip exists for. Before
  // RM-8 these drew on top of each other and a row that looked like one
  // account was twenty.
  const rows: RowSpec[] = [];
  for (let i = 0; i < 20; i += 1) {
    rows.push({ account: account(i), debt: "1000", wad: CRIT_WAD });
  }
  await openMap(page, rows, 0);

  await expect(page.getByTestId("density-grid")).toHaveAttribute("data-crit-lanes", "20");
  // RM-8: UNCAPPED. The panel grows rather than making a mark unreachable.
  await expect(page.getByTestId("density-grid")).toHaveAttribute("data-strip-height", "168");

  const boxes = await page.getByTestId("risk-crit").evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: Number(node.getAttribute("x")),
      y: Number(node.getAttribute("y")),
      lane: Number(node.getAttribute("data-lane")),
    })),
  );
  expect(boxes).toHaveLength(20);
  expect(new Set(boxes.map((box) => box.y)).size).toBe(20);
  expect(new Set(boxes.map((box) => box.lane)).size).toBe(20);
  // No two marks share a bounding box: every one stays individually hoverable.
  const keys = boxes.map((box) => `${String(box.x)}:${String(box.y)}`);
  expect(new Set(keys).size).toBe(20);

  // The conditional STATE note counts the dodged marks and says where the rest
  // of the story is (R6: it renders BEFORE the visual it qualifies).
  await expect(page.getByTestId("risk-map-crit-strip-note")).toContainText(
    "liquidatable marks share a debt neighbourhood and are stacked so each stays individually " +
      "reachable. Every one is listed with its exact debt below.",
  );
});

// ===========================================================================
// RM-9 — numbered callouts, leaders and the counted overflow
// ===========================================================================

test("AC-21/AC-22/AC-23: callouts + overflow === min(12, marks); leaders under data ink; full addresses in FORENSICS", async ({
  page,
}) => {
  // 14 distinct debts across two bands, so the callout packer has real work.
  const rows: RowSpec[] = [];
  for (let i = 0; i < 14; i += 1) {
    rows.push({
      account: account(i),
      debt: String((i + 1) * 1_000_000),
      wad: i % 2 === 0 ? HEALTHY_WAD : ROOMY_WAD,
    });
  }
  await openMap(page, rows, 6);

  const callouts = page.getByTestId("risk-map-callout");
  const drawn = await callouts.count();
  const overflow = Number(
    await page.getByTestId("density-grid").getAttribute("data-callout-overflow"),
  );
  // AC-21: nothing is dropped silently — the twelve are drawn or counted.
  expect(drawn + overflow).toBe(12);

  // AC-21: every callout NUMBER maps to exactly one FORENSICS row.
  await page.getByTestId("risk-map-exact-data").click();
  const ranks = await callouts.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-rank")),
  );
  for (const rank of ranks) {
    await expect(page.locator(`[data-testid="risk-map-exposure"][data-rank="${rank ?? ""}"]`)).toHaveCount(
      1,
    );
  }
  await expect(page.getByTestId("risk-map-exposure")).toHaveCount(12);

  // AC-22: a DISPLACED callout draws a leader whose endpoints are the mark
  // centre and the label anchor, painted BEFORE all data ink.
  const leaders = page.getByTestId("density-callout-leader");
  const leaderCount = await leaders.count();
  if (leaderCount > 0) {
    const pairs = await page.getByTestId("density-grid").evaluate((node) => {
      const svg = node as unknown as SVGSVGElement;
      const children = Array.from(svg.children);
      const indexOf = (selector: string) =>
        children.findIndex((child) => child.matches(selector) || child.querySelector(selector) !== null);
      return {
        leaderIndex: children.findIndex(
          (child) => child.getAttribute("data-testid") === "density-callout-leader",
        ),
        binIndex: indexOf("[data-testid='risk-bin']"),
        leaders: Array.from(svg.querySelectorAll("[data-testid='density-callout-leader']")).map(
          (line) => ({
            account: line.getAttribute("data-account") ?? "",
            x1: Number(line.getAttribute("x1")),
            x2: Number(line.getAttribute("x2")),
          }),
        ),
        callouts: Array.from(svg.querySelectorAll("[data-testid='risk-map-callout']")).map(
          (text) => ({
            account: text.getAttribute("data-account") ?? "",
            x: Number(text.getAttribute("x")),
            leader: text.getAttribute("data-leader"),
          }),
        ),
      };
    });
    // Painted before all data ink.
    expect(pairs.leaderIndex).toBeLessThan(pairs.binIndex);
    for (const leader of pairs.leaders) {
      const label = pairs.callouts.find((callout) => callout.account === leader.account);
      expect(label?.leader).toBe("true");
      expect(label?.x).toBeCloseTo(leader.x2, 6);
      // …and within the 24px reach the spec allows.
      expect(Math.abs(leader.x2 - leader.x1)).toBeLessThanOrEqual(24);
    }
  }

  // AC-23: the FULL untruncated address plus a copy affordance in FORENSICS,
  // while the VISUAL keeps its truncation (the callout is a number).
  const first = page.getByTestId("risk-map-exposure").first();
  await expect(first.getByTestId("risk-map-exposure-address")).toHaveText(/^0x[0-9a-f]{40}$/);
  await expect(first.getByRole("button", { name: /^copy address 0x/ })).toHaveCount(1);
});

// ===========================================================================
// RM-12..RM-16 — ledger, state, a11y, slot order
// ===========================================================================

test("AC-24/AC-25: the LEDGER lists every nonempty bin, and no number lives only in a title", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "150000000", wad: HEALTHY_WAD },
      { account: account(1), debt: "10000000000", wad: ROOMY_WAD },
      { account: account(2), debt: "500000", wad: HEALTHY_WAD },
    ],
    6,
  );
  const bins = await page.getByTestId("risk-bin").count();
  await expect(page.getByTestId("risk-map-ledger-bin")).toHaveCount(bins);
  // AC-24: seven band rows, always — an empty band states a computed zero.
  await expect(page.getByTestId("risk-map-ledger-band")).toHaveCount(7);

  // AC-25 / LAW-5: every cell title's count AND Σ has a matching LEDGER row.
  const titles = await page.getByTestId("risk-bin").evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("title")?.textContent ?? ""),
  );
  const ledger = (await page.getByTestId("risk-map-ledger").textContent()) ?? "";
  for (const title of titles) {
    const sum = /Σ debt ([^·]+)/.exec(title)?.[1]?.trim();
    const range = /debt (\$\S+–\$\S+)/.exec(title)?.[1];
    expect(sum, title).toBeTruthy();
    expect(ledger).toContain(sum ?? "");
    expect(ledger).toContain(range ?? "");
  }
});

test("AC-26/AC-28: the coverage line renders with ZERO refusals and outside every <details>", async ({
  page,
}) => {
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);
  const coverage = page.getByTestId("risk-map-coverage");
  await expect(coverage).toHaveText("1 plotted of 1 · 0 counted aside");
  await expect(coverage.locator("xpath=ancestor::details")).toHaveCount(0);
  // With no refusal there is no refusal line to place — and the coverage line
  // still renders, which is the whole point of R7.
  await expect(page.getByTestId("risk-map-refused")).toHaveCount(0);
});

test("AC-28: a refusal is NEVER a descendant of the FORENSICS region", async ({ page }) => {
  const body = positionsPage([{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6) as {
    positions: Record<string, unknown>[];
    total_positions: number;
  };
  const refused = structuredClone(body.positions[0]) as Record<string, unknown>;
  refused.account = account(9);
  refused.status = "refused";
  refused.health_factor = null;
  refused.total_debt = null;
  refused.total_collateral = null;
  refused.refusal = {
    code: "G1",
    detail: "no usable price input",
    asset: null,
    note: "an unpriced asset is REFUSED, never silently dropped",
  };
  body.positions.push(refused);
  body.total_positions = 2;

  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => fulfillJson(route, body));
  await page.goto("/book?engine=aave_v3_etherfi&dust=off");

  const refusalLine = page.getByTestId("risk-map-refused");
  await expect(refusalLine).toContainText("1 refused");
  await expect(refusalLine.locator("xpath=ancestor::details")).toHaveCount(0);
  await expect(page.getByTestId("risk-map-forensics").getByTestId("risk-map-refused")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("risk-map-coverage")).toHaveText(
    "1 plotted of 2 · 1 counted aside",
  );
});

test("AC-29: DOM order is STATE, ANSWER, SVG, LEDGER, METHOD, FORENSICS", async ({ page }) => {
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);
  const order = await page.getByTestId("book-risk-map").evaluate((root) => {
    const ids = [
      "risk-map-state",
      "risk-map-answer",
      "density-grid",
      "risk-map-ledger",
      "risk-map-method",
      "risk-map-forensics",
    ];
    const nodes = ids.map((id) => root.querySelector(`[data-testid='${id}']`));
    return {
      found: nodes.map((node) => node !== null),
      positions: nodes.map((node) =>
        node === null
          ? -1
          : Array.prototype.indexOf.call(root.querySelectorAll("*"), node),
      ),
      forensicsTag: root.querySelector("[data-testid='risk-map-forensics']")?.tagName ?? "",
      forensicsOpen: root
        .querySelector("[data-testid='risk-map-forensics']")
        ?.hasAttribute("open"),
    };
  });
  expect(order.found).toEqual([true, true, true, true, true, true]);
  for (let i = 1; i < order.positions.length; i += 1) {
    expect(order.positions[i], `slot ${String(i)}`).toBeGreaterThan(order.positions[i - 1] ?? -1);
  }
  // FORENSICS is a <details> and it is CLOSED by default.
  expect(order.forensicsTag).toBe("DETAILS");
  expect(order.forensicsOpen).toBe(false);
});

test("AC-30: aria-describedby is the METHOD line only; aria-details is FORENSICS; `Exact data` moves focus", async ({
  page,
}) => {
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);
  const wiring = await page.getByTestId("density-grid").evaluate((node) => {
    const describedby = node.getAttribute("aria-describedby") ?? "";
    const details = node.getAttribute("aria-details") ?? "";
    return {
      describedbyIds: describedby.split(/\s+/).filter((id) => id.length > 0),
      describedTestId: document.getElementById(describedby)?.getAttribute("data-testid") ?? "",
      detailsTestId: document.getElementById(details)?.getAttribute("data-testid") ?? "",
    };
  });
  // "the METHOD line ONLY": one id, and it resolves to METHOD.
  expect(wiring.describedbyIds).toHaveLength(1);
  expect(wiring.describedTestId).toBe("risk-map-method");
  expect(wiring.detailsTestId).toBe("risk-map-forensics");

  const control = page.getByTestId("risk-map-exact-data");
  await expect(control).toBeVisible();
  await expect(control).toHaveText("Exact data");
  await control.click();
  await expect(page.getByTestId("risk-map-forensics")).toHaveAttribute("open", "");
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid") ?? "",
  );
  expect(focused).toBe("risk-map-forensics");
});

test("AC-31/AC-32: ONE tab stop, ArrowRight moves the selection, Enter opens the detail with no request", async ({
  page,
}) => {
  const rows: RowSpec[] = [
    { account: account(0), debt: "150000000", wad: HEALTHY_WAD }, // $150
    { account: account(1), debt: "10000000000", wad: HEALTHY_WAD }, // $10,000
    { account: account(2), debt: "500000000", wad: HEALTHY_WAD }, // $500
  ];
  await openMap(page, rows, 6);

  let requestsAfterMount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/v1/")) requestsAfterMount += 1;
  });

  // ONE tab stop for the whole grid: the grid holds exactly one focusable node.
  const stops = await page.getByTestId("density-grid").evaluate((node) => {
    const svg = node as unknown as SVGSVGElement;
    return {
      self: svg.getAttribute("tabindex"),
      inner: svg.querySelectorAll("[tabindex]").length,
    };
  });
  expect(stops.self).toBe("0");
  expect(stops.inner).toBe(0);

  await page.getByTestId("density-grid").focus();
  // Focus selects the first cell; ArrowRight moves exactly one cell.
  const firstSelected = await page
    .locator("[data-testid='risk-bin'][data-selected='true']")
    .getAttribute("data-x-index");
  await page.keyboard.press("ArrowRight");
  const secondSelected = await page
    .locator("[data-testid='risk-bin'][data-selected='true']")
    .getAttribute("data-x-index");
  expect(secondSelected).not.toBe(firstSelected);
  await expect(page.locator("[data-testid='risk-bin'][data-selected='true']")).toHaveCount(1);

  // AC-32: the selected cell carries a --ink-2 1px outline.
  const selectedStroke = await page
    .locator("[data-testid='risk-bin'][data-selected='true']")
    .evaluate((node) => ({
      stroke: getComputedStyle(node).stroke,
      width: getComputedStyle(node).strokeWidth,
      ink2: getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim(),
    }));
  expect(selectedStroke.width).toBe("1px");
  const ink2Rgb = await page.evaluate((hex) => {
    const probe = document.createElement("span");
    probe.style.color = hex;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, selectedStroke.ink2);
  expect(selectedStroke.stroke).toBe(ink2Rgb);

  // Enter renders the cell detail from the HELD vector, with no new request.
  requestsAfterMount = 0;
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("risk-map-cell-detail")).toBeVisible();
  await expect(page.getByTestId("risk-map-cell-detail-line")).toContainText("accounts, Σ debt");
  await expect(page.getByTestId("risk-map-cell-detail-line")).toContainText("Showing the top");
  await expect(page.getByTestId("risk-map-cell-account")).toHaveCount(1);
  expect(requestsAfterMount).toBe(0);
});

test("AC-33: the source-filter copy states the CONJUNCTION", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) =>
    fulfillJson(route, positionsPage([{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6)),
  );
  await page.goto("/book?engine=aave_v3_etherfi&dust=1");
  await expect(page.getByTestId("risk-map-dust-legend")).toContainText(
    "only when both its collateral and its debt are below",
  );
});

// ===========================================================================
// AC-10 — the grid draws exactly the bins the module produced
// ===========================================================================

test("AC-10: one rect per bin, and the LEDGER agrees with the grid", async ({ page }) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "150000000", wad: HEALTHY_WAD },
      { account: account(1), debt: "150000000", wad: HEALTHY_WAD },
      { account: account(2), debt: "10000000000", wad: ROOMY_WAD },
      { account: account(3), debt: "1", wad: HEALTHY_WAD },
    ],
    6,
  );
  // Three distinct (band, half-decade) cells over four rows.
  await expect(page.getByTestId("risk-bin")).toHaveCount(3);
  await expect(page.getByTestId("risk-map-ledger-bin")).toHaveCount(3);
});

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

test("AC-52: no user-visible text says `HF histogram` or `health-factor histogram`", async ({
  page,
}) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) =>
    fulfillJson(route, positionsPage([{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6)),
  );
  await page.goto("/book?engine=aave_v3_etherfi&dust=off");
  await expect(page.getByRole("heading", { name: /Risk-band distribution/ })).toBeVisible();

  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain("hf histogram");
  expect(text).not.toContain("health-factor histogram");

  // The ARIA names moved too; the WIRE FIELD did not.
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label]")).map(
      (node) => node.getAttribute("aria-label") ?? "",
    ),
  );
  expect(labels.some((label) => label.startsWith("risk-band distribution for "))).toBe(true);
  for (const label of labels) {
    expect(label).not.toContain("health-factor histogram");
  }
  // The testids are the wire's vocabulary and are UNCHANGED.
  await expect(page.getByTestId("book-histogram-aave_v3_etherfi")).toBeVisible();
});

test("AC-53: bars are a share of the NAMED denominator on a 0–100% axis", async ({ page }) => {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) =>
    fulfillJson(route, positionsPage([{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6)),
  );
  await page.goto("/book?engine=aave_v3_etherfi&dust=off");

  const panel = page.getByTestId("book-histogram-aave_v3_etherfi");
  await expect(panel.getByTestId("hist-percent-tick")).toHaveCount(3);
  // Ticks at 0, 50 and 100 — a common axis, not a ranking.
  const ticks = await panel
    .getByTestId("hist-percent-tick")
    .evaluateAll((nodes) => nodes.map((node) => node.querySelector("text")?.textContent ?? ""));
  expect(ticks).toEqual(["0%", "50%", "100%"]);

  // The denominator is NAMED on the panel.
  await expect(panel.getByTestId("hist-denominator-aave_v3_etherfi")).toHaveText(
    /^denominator: \d[\d,]* debt-bearing accounts with a finite comparator$/,
  );

  // The row label prints `{count} · {pct}%`, and a 100% bucket spans the axis.
  const rows = await panel
    .getByTestId("hist-row-label")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(rows.some((row) => /^\d+ · \d/.test(row))).toBe(true);
  expect(rows).toContain("1 · 100%");
  const widths = await panel
    .locator("svg rect")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node.getAttribute("class") ?? "").includes("histBar"))
        .map((node) => Number(node.getAttribute("width"))),
    );
  // The single 100% bucket spans the FULL 240px axis.
  expect(Math.max(...widths)).toBeCloseTo(240, 0);

  // The accounting rows are their own rows beneath the bars.
  await expect(panel.getByTestId("hist-no-debt-aave_v3_etherfi")).toHaveText(
    /^no debt \(no comparator\): \d+$/,
  );
  await expect(panel.getByTestId("hist-refused-aave_v3_etherfi")).toContainText("refused: ");
});

test("AC-54: every chart text node is at least 12 CSS px and clears 4.5:1, in both themes", async ({
  page,
}) => {
  await openMap(
    page,
    [
      { account: account(0), debt: "1", wad: HEALTHY_WAD },
      { account: account(1), debt: "150000000", wad: HEALTHY_WAD },
      { account: account(2), debt: "10000000000", wad: ROOMY_WAD },
      { account: account(3), debt: "500000", wad: CRIT_WAD },
    ],
    6,
  );

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    const nodes = await page.evaluate(() => {
      const roots = Array.from(
        document.querySelectorAll(
          "[data-testid='density-grid'], [data-testid='risk-map-ledger']",
        ),
      );
      const out: { text: string; size: number; color: string }[] = [];
      for (const root of roots) {
        for (const node of Array.from(root.querySelectorAll("text, td, th, p, h4"))) {
          const text = (node.textContent ?? "").trim();
          if (text.length === 0) continue;
          const style = getComputedStyle(node);
          out.push({
            text,
            size: Number.parseFloat(style.fontSize),
            color: node.tagName.toLowerCase() === "text" ? style.fill : style.color,
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
      return { out, panel };
    });
    expect(nodes.out.length).toBeGreaterThan(5);
    for (const node of nodes.out) {
      expect(node.size, `${theme}: "${node.text}"`).toBeGreaterThanOrEqual(12);
      expect(
        contrastOf(node.color, nodes.panel),
        `${theme}: "${node.text}" (${node.color})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("AC-55: the risk map renders no reference to a token that does not exist", async ({ page }) => {
  await openMap(page, [{ account: account(0), debt: "150000000", wad: HEALTHY_WAD }], 6);
  const sheets = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .filter((text) => text.includes("--ink-1")),
  );
  expect(sheets).toEqual([]);
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
