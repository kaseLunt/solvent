// W2 Inspector e2e — against the production build, with the API mocked from
// openapi-example-derived fixtures (tests/fixtures/inspector.ts).
//
// What this pins:
//   - the THREE found states render DISTINCTLY at the page level
//     (found / definitive-none-with-completeness / cannot-be-established);
//   - a stale price verdict is VISIBLE as its own state;
//   - the formula block is ENGINE-CORRECT (aave law vs DM comparator);
//   - the history sparkline renders a refused point as a GAP with its reason;
//   - the drawer opens with body scroll LOCKED and Escape restores it;
//   - a null block_time falls back to the block number;
//   - the landing's strict 0x-40hex law refuses inline, never navigates;
//   - W-OBS-B: the sparkline's label expectations are COMPUTED here from the
//     same fixture bytes the route mock serves, through the unit-tested pure
//     helpers (lib/history-series, lib/sparkline-scale) — never pinned as
//     literals a hardcoding component could coincidentally match.

import { expect, test, type Page } from "@playwright/test";
import {
  buildHistorySeries,
  historyMetaLine,
  knownBatchAxis,
  newestPlottedLabel,
  tallyHistory,
} from "../../lib/history-series";
import { hfAxisMaxLabel, hfAxisMinLabel, paddedSparklineDomain } from "../../lib/sparkline-scale";
import {
  ADDRESS_FOUND,
  ADDRESS_NOT_FOUND,
  ADDRESS_UNKNOWABLE,
  EVENTS,
  FOUND_ADDR,
  HISTORY,
  HISTORY_FLAT,
  HISTORY_QUALIFIED,
  NOT_FOUND_ADDR,
  PARAMS,
  UNKNOWABLE_ADDR,
} from "../fixtures/inspector";

// Fulfilled responses still cross an origin (3111 → 8080), so CORS applies.
const CORS = { "access-control-allow-origin": "*" };

async function mockApi(page: Page, address: unknown, history: unknown = HISTORY) {
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: history, headers: CORS }),
  );
  // `*` never crosses `/`, so this does NOT swallow the /history route above.
  await page.route("**/v1/address/*", (route) => route.fulfill({ json: address, headers: CORS }));
}

test("found: the position layout renders, with the stale price verdict visible", async ({ page }) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  await expect(page.getByTestId("inspector-outcome")).toBeVisible();
  await expect(page.getByTestId("position-aave_v3_etherfi")).toBeVisible();
  await expect(page.getByTestId("position-debt_manager")).toBeVisible();

  // The stale verdict is its OWN state — a chip, not a hidden formatting choice.
  await expect(page.getByTestId("price-verdict").filter({ hasText: "stale" })).toBeVisible();
  await expect(page.getByTestId("price-verdict").filter({ hasText: "fresh" })).toBeVisible();
});

test("the formula block is engine-correct — the aave law and the DM comparator, never shared", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const aave = page.getByTestId("position-aave_v3_etherfi").getByTestId("formula-block");
  await expect(aave).toContainText("HF = floor");
  await expect(aave).toContainText("1080000000000000000"); // THIS position's wad, substituted
  await expect(aave).not.toContainText("maxBorrowLT");

  const dm = page.getByTestId("position-debt_manager").getByTestId("formula-block");
  await expect(dm).toContainText("debt > maxBorrowLT");
  await expect(dm).toContainText("STRICT boolean");
  await expect(dm).toContainText("4620000000"); // THIS position's debt, substituted
  await expect(dm).toContainText("liquidatable");
  await expect(dm).not.toContainText("wadDiv");
});

test("definitive none: the honest statement WITH lookup completeness shown", async ({ page }) => {
  await mockApi(page, ADDRESS_NOT_FOUND);
  await page.goto(`/inspector/${NOT_FOUND_ADDR}`);

  // W-3L: the definitive-negative SENTENCE lives in the head takeaway; the
  // box below carries the entitlement (the method) and the wire note.
  await expect(page.getByTestId("inspector-outcome")).toContainText("no position in this batch");
  const negative = page.getByTestId("found-negative");
  await expect(negative).toBeVisible();
  await expect(negative).toContainText("complete");
  await expect(negative).toContainText("withheld engines: none");

  await expect(page.getByTestId("found-unknowable")).toHaveCount(0);
  await expect(page.getByTestId("position-aave_v3_etherfi")).toHaveCount(0);
});

test("unknowable: cannot-be-established with the withheld engine NAMED — never 'no position'", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_UNKNOWABLE);
  await page.goto(`/inspector/${UNKNOWABLE_ADDR}`);

  const unknowable = page.getByTestId("found-unknowable");
  await expect(unknowable).toBeVisible();
  await expect(unknowable).toContainText("cannot be established");
  await expect(unknowable).toContainText("debt_manager · FLAG_CUSTODY_UNPROVEN");

  // The one phrase the definitive negative owns must NOT appear anywhere here.
  await expect(page.getByText("no position in this batch")).toHaveCount(0);
  await expect(page.getByTestId("found-negative")).toHaveCount(0);
});

test("history sparkline: a refused point is a GAP carrying its named reason", async ({ page }) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const history = page.getByTestId("history-aave_v3_etherfi");
  await expect(history).toBeVisible();
  const gaps = history.getByTestId("sparkline-gap");
  await expect(gaps).toHaveCount(1);
  await expect(gaps.locator("title")).toHaveText(/REFUSED · G1/);
  // The HF = 1.0 reference line is present.
  await expect(history.getByTestId("sparkline-reference")).toHaveCount(1);
});

test("W-OBS: the HF sparkline is a measured, labelled instrument", async ({ page }) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const frame = page.getByTestId("history-frame-aave_v3_etherfi");
  await expect(frame).toBeVisible();

  // LAW-3 at two viewports: the SVG width attribute tracks the frame's
  // CONTENT box (padding-correct), renders 1:1 (viewBox = width, no scale
  // factor), and grows with the viewport — the fixed-width constant is gone.
  const measure = () =>
    frame.evaluate((node) => {
      const svg = node.querySelector("svg");
      if (svg === null) throw new Error("no svg in the history frame");
      const style = getComputedStyle(node);
      const content =
        node.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
      return {
        widthAttr: Number(svg.getAttribute("width")),
        viewBoxW: (svg.getAttribute("viewBox") ?? "").split(" ")[2],
        rendered: svg.getBoundingClientRect().width,
        content,
      };
    });

  const narrow = await measure();
  expect(Math.abs(narrow.widthAttr - narrow.content)).toBeLessThanOrEqual(1);
  expect(narrow.viewBoxW).toBe(String(narrow.widthAttr));
  expect(narrow.rendered).toBeCloseTo(narrow.widthAttr, 0);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect
    .poll(async () => (await measure()).widthAttr, { message: "svg width tracks the frame" })
    .toBeGreaterThan(narrow.widthAttr);
  const wide = await measure();
  expect(Math.abs(wide.widthAttr - wide.content)).toBeLessThanOrEqual(1);
  expect(wide.viewBoxW).toBe(String(wide.widthAttr));

  // EVERY label below is COMPUTED from the fixture bytes the route mock
  // serves, through the unit-tested pure helpers — a hardcoding component
  // fails the moment the fixture moves. The bounds are the OUTWARD-directed
  // renderings of the drawn domain (min floors, max ceils; the reference 1.0
  // always inside it) — the scale law is pinned pure in
  // tests/unit/sparkline-scale.spec.ts.
  const engine = HISTORY.engines[0];
  if (engine === undefined) throw new Error("fixture invariant: one engine series expected");
  const series = buildHistorySeries(engine, knownBatchAxis(HISTORY));
  const domain = paddedSparklineDomain(series.values, 1);
  await expect(frame.getByTestId("sparkline-ymax-label")).toHaveText(hfAxisMaxLabel(domain.max));
  await expect(frame.getByTestId("sparkline-ymin-label")).toHaveText(hfAxisMinLabel(domain.min));

  // X extents: the oldest and newest witnessed batch ids from the wire.
  const oldestEntry = series.entries[0];
  const newestEntry = series.entries[series.entries.length - 1];
  if (oldestEntry === undefined || newestEntry === undefined) {
    throw new Error("fixture invariant: the series carries entries");
  }
  await expect(frame.getByTestId("sparkline-x-start")).toHaveText(
    `batch ${String(oldestEntry.batchId)}`,
  );
  await expect(frame.getByTestId("sparkline-x-end")).toHaveText(
    `batch ${String(newestEntry.batchId)}`,
  );

  // The newest plotted point prints the SAME computed string the meta line
  // cites — one source (newestPlottedLabel over HistorySeriesEntry.display).
  // On this fixture the newest witnessed batch plots, so the PLAIN arm holds
  // and the whole meta line is itself computed from the same bytes.
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("fixture invariant: the series plots a point");
  expect(newest.atNewestBatch).toBe(true);
  expect(newest.directLabel).toBe(newest.entry.display);
  await expect(frame.getByTestId("sparkline-newest-value")).toHaveText(newest.directLabel);
  await expect(page.getByTestId("history-meta-aave_v3_etherfi")).toHaveText(
    historyMetaLine(tallyHistory(series), series.newest, engine.engine, HISTORY.limit),
  );

  // Kept laws: the refused point still breaks the line with its named
  // reason, and the 1.0 reference line still renders.
  await expect(frame.getByTestId("sparkline-gap")).toHaveCount(1);
  await expect(frame.getByTestId("sparkline-reference")).toHaveCount(1);
});

test("W-OBS-B: an older sparkline label states WHICH batch; the meta keeps the refusal", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_FOUND, HISTORY_QUALIFIED);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  // Computed from the SAME fixture bytes the route mock serves, through the
  // unit-tested pure layer (newestPlottedLabel).
  const engine = HISTORY_QUALIFIED.engines[0];
  if (engine === undefined) throw new Error("fixture invariant: one engine series expected");
  const series = buildHistorySeries(engine, knownBatchAxis(HISTORY_QUALIFIED));
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("fixture invariant: the series plots a point");

  // Fixture invariants the law leans on: TWO finite points with DISTINCT
  // values, and the newest witnessed batch NOT the last finite one — an
  // oldest-finite scan mutant prints the OTHER figure and fails below.
  const finiteDisplays = series.entries
    .filter((entry) => entry.value !== null)
    .map((entry) => entry.display);
  expect(finiteDisplays.length).toBeGreaterThanOrEqual(2);
  expect(new Set(finiteDisplays).size).toBeGreaterThanOrEqual(2);
  expect(newest.atNewestBatch).toBe(false);
  expect(newest.entry.display).toBe(finiteDisplays[finiteDisplays.length - 1]);
  // The qualified arm is the plain display string PLUS the batch qualifier —
  // one source, never a retyped value.
  expect(newest.directLabel).toBe(
    `${newest.entry.display} (batch ${String(newest.entry.batchId)})`,
  );

  const frame = page.getByTestId("history-frame-aave_v3_etherfi");
  await expect(frame.getByTestId("sparkline-newest-value")).toHaveText(newest.directLabel);

  // The meta line tells the SAME story from its side: its newest readout is
  // the refused batch's own register — the whole line computed from the same
  // bytes through the pure copy layer.
  await expect(page.getByTestId("history-meta-aave_v3_etherfi")).toHaveText(
    historyMetaLine(tallyHistory(series), series.newest, engine.engine, HISTORY_QUALIFIED.limit),
  );
  await expect(page.getByTestId("history-meta-aave_v3_etherfi")).toContainText(
    "newest: REFUSED · G1",
  );
});

test("W-OBS-B: a flat-at-1.0 series renders value and reference labels with disjoint boxes", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_FOUND, HISTORY_FLAT);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const engine = HISTORY_FLAT.engines[0];
  if (engine === undefined) throw new Error("fixture invariant: one engine series expected");
  const series = buildHistorySeries(engine, knownBatchAxis(HISTORY_FLAT));
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("fixture invariant: the flat series plots a point");
  expect(newest.atNewestBatch).toBe(true); // the plain arm: display, no qualifier

  const frame = page.getByTestId("history-frame-aave_v3_etherfi");
  await expect(frame).toBeVisible();

  // Both labels render with their own strings: the newest value (computed
  // from the bytes) and the 1.0 reference disclosure.
  await expect(frame.getByTestId("sparkline-newest-value")).toHaveText(newest.directLabel);
  const referenceLabel = frame.getByTestId("sparkline-reference").locator("text");
  await expect(referenceLabel).toHaveText("1.0");

  // The collision law, measured in the BROWSER: the two labels' rendered
  // boxes (getBBox) must not intersect — the deterministic displacement rule
  // moved the value label a full row off the reference label. The
  // no-displacement mutant parks both on the same row and fails here.
  const boxes = await frame.evaluate((node) => {
    const value = node.querySelector('[data-testid="sparkline-newest-value"]');
    const ref = node.querySelector('[data-testid="sparkline-reference"] text');
    if (!(value instanceof SVGGraphicsElement) || !(ref instanceof SVGGraphicsElement)) {
      throw new Error("both labels must render as SVG text");
    }
    const v = value.getBBox();
    const r = ref.getBBox();
    return {
      value: { x: v.x, y: v.y, width: v.width, height: v.height },
      reference: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });
  const disjoint =
    boxes.value.x + boxes.value.width <= boxes.reference.x ||
    boxes.reference.x + boxes.reference.width <= boxes.value.x ||
    boxes.value.y + boxes.value.height <= boxes.reference.y ||
    boxes.reference.y + boxes.reference.height <= boxes.value.y;
  expect(disjoint, `label boxes must not overlap: ${JSON.stringify(boxes)}`).toBe(true);
});

test("drawer: opens from a number, locks body scroll, Escape closes and restores", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  await page.getByRole("button", { name: "explain health factor" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const drawer = page.getByTestId("evidence-drawer");
  await expect(drawer).toContainText("OPERATIONAL");
  await expect(drawer).toContainText("hf_wad < 1e18");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("overflow", "visible");
});

test("activity: a null block_time falls back to the block number, never an invented time", async ({
  page,
}) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto(`/inspector/${FOUND_ADDR}`);

  await expect(
    page.getByTestId("activity-time").filter({ hasText: "block 154,796,490" }),
  ).toBeVisible();
  // The custodied header time renders as itself on the other row.
  await expect(
    page.getByTestId("activity-time").filter({ hasText: "2026-07-29T09:57:11Z" }),
  ).toBeVisible();
});

test("landing: an invalid address is an inline refusal and never navigates", async ({ page }) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto("/inspector");

  await page.getByLabel("address to inspect").fill("0xNOT-AN-ADDRESS");
  await page.getByRole("button", { name: "Inspect" }).click();
  // Next's route announcer is also role=alert; filter to the refusal itself.
  await expect(page.getByRole("alert").filter({ hasText: "REFUSED" })).toContainText(
    "not an address",
  );
  await expect(page).toHaveURL(/\/inspector$/);

  await page.getByLabel("address to inspect").fill(FOUND_ADDR);
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page).toHaveURL(new RegExp(`/inspector/${FOUND_ADDR}$`));
  await expect(page.getByTestId("inspector-outcome")).toBeVisible();
});

test("an invalid [addr] path segment is refused inline — nothing is looked up", async ({ page }) => {
  await mockApi(page, ADDRESS_FOUND);
  await page.goto("/inspector/0xdeadbeef");
  await expect(page.getByTestId("address-refusal")).toBeVisible();
  await expect(page.getByTestId("address-refusal")).toContainText("REFUSED");
  await expect(page.getByTestId("inspector-outcome")).toHaveCount(0);
});
