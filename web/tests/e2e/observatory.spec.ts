// Observatory surface (W4) e2e — MOCKED API via route interception. Every
// body served here comes from tests/fixtures/observatory.ts (generated from
// the contract — see generate-observatory.mjs's provenance record; nothing
// hand-shaped).
//
// Asserted laws (task brief):
//   - resting render: one engine's series with exact fixture values, per-chart
//     as-ofs, the response's own notes, and the stampline;
//   - ENGINE SEPARATION: an explicit switcher, one engine per view, never a
//     combined total;
//   - an ABSENT bucket renders an honest named gap ("no complete batch in
//     this bucket") — never interpolated;
//   - the DEGRADED response (rollup predates the deployment's migration
//     state) renders as a NAMED state, not an empty chart;
//   - every point carries provenance (bucket as-of, watermark block, rate
//     as-ofs) surfaced in the bucket-record detail;
//   - a WITHHELD bucket stays visible with its named refusal; NULL totals
//     render as em dashes, never 0;
//   - W-OBS-B: the direct-label expectations are COMPUTED in this file from
//     the same fixture bytes the route mock serves, through the unit-tested
//     pure helpers (lib/observatory-series) — never pinned as literals a
//     hardcoding component could coincidentally match.

import { expect, test, type Page, type Route } from "@playwright/test";
import {
  buildBucketAxis,
  buildMetricSeries,
  seriesMaxPoint,
  seriesNewestPoint,
  gridReadingLine,
  observatoryTakeaway,
  pointDetailTakeaway,
} from "../../lib/observatory-series";
import { EM_DASH } from "../../lib/format";
import {
  OBSERVATORY_DEGRADED,
  OBSERVATORY_SERIES_AAVE,
  OBSERVATORY_SERIES_DM,
} from "../fixtures/observatory";

const CORS = { "access-control-allow-origin": "*" };

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The SSE stream is not under test here; the ribbon states its own truth. */
async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

/** Engine-aware series routing: the aave derived series, the DM verbatim example. */
async function mockSeries(page: Page): Promise<void> {
  await page.route("**/v1/observatory/series*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    if (engine === "debt_manager") return fulfillJson(route, OBSERVATORY_SERIES_DM);
    return fulfillJson(route, OBSERVATORY_SERIES_AAVE);
  });
}

async function openObservatory(page: Page): Promise<void> {
  await muteStream(page);
  await page.goto("/observatory");
}

test("resting render: one engine's series, exact values, as-of stated, notes and stampline", async ({ page }) => {
  await mockSeries(page);
  await openObservatory(page);

  // Default engine: aave, explicitly pressed — never both.
  await expect(page.getByTestId("observatory-engine-aave_v3_etherfi")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("observatory-engine-debt_manager")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // The newest-bucket strip renders the fixture's exact totals (8dp scale).
  const newest = page.getByTestId("observatory-newest");
  await expect(newest).toContainText("2026-07-29T10:00:00Z");
  await expect(newest).toContainText("watermark block 25,635,900");
  await expect(newest).toContainText("$619.186008");
  await expect(newest).toContainText("$825.581344");

  // W-3L: four charts, the as-of stated ONCE above the grid (bucket +
  // watermark, not served_at) — it was four identical per-chart statements.
  for (const metric of ["debt_usd", "collateral_usd", "accounts", "liquidatable_positions"]) {
    await expect(page.getByTestId(`observatory-chart-${metric}`)).toBeVisible();
  }
  const gridAsOf = page.getByTestId("observatory-grid-asof");
  await expect(gridAsOf).toContainText("as of bucket 2026-07-29T10:00:00Z");
  await expect(gridAsOf).toContainText("block 25,635,900");

  // The response's own notes render behind their counted disclosure (W-3L);
  // the stampline pins the record — the gap tally inline (warn), the neutral
  // pins behind the counted evidence summary.
  await page.getByTestId("observatory-notes").locator("summary").click();
  await expect(page.getByTestId("observatory-notes")).toContainText(
    "a withheld bucket carries NULL totals",
  );
  await expect(page.getByText("4 captured · 0 withheld · 1 absent")).toBeVisible();
  await page.getByTestId("stampline-evidence-summary").click();
  await expect(page.getByText("native hourly buckets · every captured bucket served verbatim")).toBeVisible();

  // No DM values leak into the aave view (engines never combined).
  await expect(page.locator("body")).not.toContainText("$309.593004");
});

test("engine switch: explicit, one engine per view, the request carries the engine", async ({ page }) => {
  const engines: (string | null)[] = [];
  await muteStream(page);
  await page.route("**/v1/observatory/series*", (route) => {
    const url = new URL(route.request().url());
    engines.push(url.searchParams.get("engine"));
    return fulfillJson(
      route,
      url.searchParams.get("engine") === "debt_manager"
        ? OBSERVATORY_SERIES_DM
        : OBSERVATORY_SERIES_AAVE,
    );
  });
  await page.goto("/observatory");
  await expect(page.getByTestId("observatory-newest")).toContainText("$619.186008");

  await page.getByTestId("observatory-engine-debt_manager").click();

  await expect(page.getByTestId("observatory-engine-debt_manager")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The DM view replaces the aave view wholesale — no aave totals remain.
  await expect(page.getByTestId("observatory-newest")).not.toContainText("$619.186008");
  await expect(page.locator("body")).not.toContainText("$825.581344");
  // The wire was asked for exactly the selected engines, in order.
  expect(engines[0]).toBe("aave_v3_etherfi");
  expect(engines[engines.length - 1]).toBe("debt_manager");
});

test("an ABSENT bucket renders an honest named gap — never an interpolated line", async ({ page }) => {
  await mockSeries(page);
  await openObservatory(page);

  const debtChart = page.getByTestId("observatory-chart-debt_usd");
  const gap = debtChart.locator('[data-testid="obs-gap"][data-kind="absent"]');
  await expect(gap).toHaveCount(1);
  await expect(gap.locator("title")).toHaveText(/no complete batch in this bucket/);

  // The line breaks at the gap: two separate path segments, not one bridge.
  await expect(debtChart.locator("path")).toHaveCount(2);

  // Selecting the absent bucket states the absence by name in the record.
  await debtChart.locator('[data-testid="obs-gap-hit"]').first().click();
  const detail = page.getByTestId("observatory-point-detail");
  await expect(detail).toHaveAttribute("data-kind", "absent");
  await expect(detail).toContainText("ABSENT · no complete batch in this bucket");
  await expect(detail).toContainText("never renders as zero");
});

test("the DEGRADED response is a NAMED state — never an empty chart, never zeros", async ({ page }) => {
  await muteStream(page);
  await page.route("**/v1/observatory/series*", (route) =>
    fulfillJson(route, OBSERVATORY_DEGRADED, 503),
  );
  await page.goto("/observatory");

  const degraded = page.getByTestId("observatory-degraded");
  await expect(degraded).toBeVisible();
  await expect(degraded).toContainText("ROLLUP UNAVAILABLE");
  await expect(degraded).toContainText("a named state rather than an empty chart");
  // The server's own message, verbatim.
  await expect(degraded).toContainText("observatory_points does not exist on this database");
  // No chart pretends an empty history; no zero is fabricated anywhere.
  await expect(page.getByTestId("observatory-chart-debt_usd")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$0");
});

test("provenance on a point: the bucket record pins as-of, watermark and rate as-ofs", async ({ page }) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();

  // Default selection is the newest wire bucket — the WITHHELD one.
  const detail = page.getByTestId("observatory-point-detail");
  await expect(detail).toHaveAttribute("data-bucket", "2026-07-29T09:00:00Z");

  // Click the captured 08:00 point (the only finite debt point in the DM view).
  await page
    .getByTestId("observatory-chart-debt_usd")
    .locator('[data-testid="obs-point"]')
    .click();

  await expect(detail).toHaveAttribute("data-bucket", "2026-07-29T08:00:00Z");
  await expect(detail).toContainText("2026-07-29T08:00:00Z");
  await expect(detail).toContainText("block 154,794,000");
  await expect(detail).toContainText("never a chain head observed later");
  await expect(detail).toContainText("$309.593004");
  await expect(detail).toContainText("$412.790672");
  await expect(detail).toContainText("captured from the newest COMPLETE risk batch");

  // The observation provenance (1.2.0): the observed batch and its key.
  await expect(detail).toContainText("#41");
  await expect(page.getByTestId("observatory-point-mkey")).toContainText(
    "9a4a7c1de00b53219a6f2f41c86a77025f0b3e2a4c1d99e21b7a30e12cf5a2b9",
  );
  await expect(page.getByTestId("observatory-point-epochs")).toContainText("none unacked");

  // The sweep stamp (1.2.2): the observed batch's own sweep-cut, named
  // beside the liquidatable count it clocks — the contract example's stamp,
  // verbatim.
  const sweep = page.getByTestId("observatory-point-sweep");
  await expect(sweep).toContainText("3 swept · 1 failed · gen 12 (pass complete)");
  await expect(sweep).toContainText("2026-07-29T07:58:40Z");
  await expect(sweep).toContainText("aggregates THIS sweep-cut");

  // The rate snapshot carries its OWN as-of block, not the bucket's — and its
  // scale from the closed per-kind vocabulary (the 1.2.0 contract example's
  // DM interest index).
  const rates = page.getByTestId("observatory-rates");
  await expect(rates).toContainText("borrow_index");
  await expect(rates).toContainText("index-1e18");
  await expect(rates).toContainText("USDC");
  await expect(rates).toContainText("1050000000000000000");
  await expect(rates).toContainText("154,793,990");
});

test("the sweep clock renders all three states honestly — stamped, recorded none, unrecorded", async ({ page }) => {
  // (a) RECORDED NONE: the aave engine has no collateral sweep, and the
  // record SAYS so — never an em dash, never an invented stamp.
  await mockSeries(page);
  await openObservatory(page);
  const sweep = page.getByTestId("observatory-point-sweep");
  await expect(sweep).toContainText("none");
  await expect(sweep).toContainText("recorded: this engine has no collateral sweep");

  // (b) UNRECORDED: a pre-00018 point whose batch was pruned before the
  // backfill — the record is ABSENT, disclosed as such, and never rendered
  // as the "no sweeper" claim (which the store cannot back) or as a stamp.
  const unrecorded = {
    ...OBSERVATORY_SERIES_DM,
    points: OBSERVATORY_SERIES_DM.points.map((point) => ({
      ...point,
      sweep_recorded: false,
      sweep: null,
    })),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, unrecorded));
  await page.getByTestId("observatory-engine-debt_manager").click();

  await expect(sweep).toContainText("—");
  await expect(sweep).toContainText("unrecorded: this point predates migration 00018");
  await expect(sweep).not.toContainText("no collateral sweep");
  await expect(sweep).not.toContainText("swept ·");
});

test("a WITHHELD bucket stays visible with its named refusal — em dashes, never 0", async ({ page }) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();

  // The newest bucket IS the withheld one: the strip refuses honestly.
  const newest = page.getByTestId("observatory-newest");
  await expect(newest).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(newest).toContainText("withheld, no number served");
  await expect(newest).toContainText("—");
  await expect(newest).not.toContainText("$0");

  // The chart wears the refusal: a withheld gap tick with the warn form-mark.
  const debtChart = page.getByTestId("observatory-chart-debt_usd");
  const withheldGap = debtChart.locator('[data-testid="obs-gap"][data-kind="withheld"]');
  await expect(withheldGap).toHaveCount(1);
  await expect(withheldGap.locator("title")).toHaveText(/WITHHELD · FLAG_CUSTODY_UNPROVEN/);
  await expect(debtChart.locator('[data-testid="obs-gap-warn"]')).toHaveCount(1);

  // The bucket record (default-selected) names the refusal and keeps nulls null.
  const detail = page.getByTestId("observatory-point-detail");
  await expect(detail).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(detail).toContainText("null because the book was withheld and never zero");
  await expect(detail).not.toContainText("$0");

  // The bucket census counts the withheld bucket instead of dropping it.
  await expect(page.getByText("1 captured · 1 withheld · 0 absent")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Wave W-OBS — the panels answer as instruments, without a click.
// ---------------------------------------------------------------------------

test("W-OBS: y-max, x extents, selected time and the newest figure are direct labels", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);

  const debtChart = page.getByTestId("observatory-chart-debt_usd");

  // EVERY expectation below is COMPUTED from the fixture bytes the route
  // mock serves, through the unit-tested pure helpers — a component that
  // hardcodes any of these strings fails the moment the fixture moves.
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_AAVE, "debt_usd");
  const maxPoint = seriesMaxPoint(axis, OBSERVATORY_SERIES_AAVE, "debt_usd", debt);
  const newestPoint = seriesNewestPoint(axis, OBSERVATORY_SERIES_AAVE, "debt_usd", debt);
  if (maxPoint === null || newestPoint === null) {
    throw new Error("fixture invariant: the aave debt series plots a max and a newest point");
  }
  // Fixture invariants the laws below lean on: the max is NOT the last
  // plotted point (so BOTH direct labels render), and the newest plotted
  // point IS the newest axis entry (the plain, unqualified arm).
  expect(maxPoint.index).not.toBe(newestPoint.index);
  expect(newestPoint.atNewestBucket).toBe(true);
  expect(newestPoint.directLabel).toBe(newestPoint.label);

  // The drawn y-max wears the max point's exact ledger string (the same
  // displayMetric output the cards use) — derived, never retyped.
  await expect(debtChart.getByTestId("obs-ymax-label")).toHaveText(maxPoint.label);

  // The x-axis states the window's extent bucket hours, in the head's own
  // UTC format — the axis' own first and last entries.
  const oldestEntry = axis.entries[0];
  const newestEntry = axis.entries[axis.entries.length - 1];
  if (oldestEntry === undefined || newestEntry === undefined) {
    throw new Error("fixture invariant: the axis carries entries");
  }
  await expect(debtChart.getByTestId("obs-x-start")).toHaveText(oldestEntry.bucketStart);
  await expect(debtChart.getByTestId("obs-x-end")).toHaveText(newestEntry.bucketStart);

  // Default selection is the newest wire bucket, whose hour the x-end extent
  // already states — the selected strip stays EMPTY rather than printing the
  // same string twice on two stacked axis rows.
  await expect(debtChart.getByTestId("obs-x-selected")).toHaveCount(0);

  // The newest captured point prints EXACTLY the summary card's figure —
  // one source, asserted against the card's own strip.
  await expect(debtChart.getByTestId("obs-newest-value")).toHaveText(newestPoint.directLabel);
  await expect(page.getByTestId("observatory-newest")).toContainText(newestPoint.label);

  // Selecting an older bucket moves the selected-time axis label with it —
  // the first plotted point's own bucket hour, from the same axis bytes.
  const firstPlottedIndex = debt.values.findIndex((v) => v !== null);
  const firstPlotted = axis.entries[firstPlottedIndex];
  if (firstPlotted === undefined) {
    throw new Error("fixture invariant: the debt series plots a first point");
  }
  await debtChart.locator('[data-testid="obs-point"]').first().click();
  await expect(debtChart.getByTestId("obs-x-selected")).toHaveText(firstPlotted.bucketStart);

  // A dense window (4 captured points) renders NO sparse STATE line.
  await expect(page.getByTestId("observatory-sparse-debt_usd")).toHaveCount(0);
});

test("W-OBS-B: the DM chart qualifies its older direct label while the card keeps the dash", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();

  // Computed from the SAME fixture bytes the route mock serves: the newest
  // axis entry is WITHHELD, so the last plotted point is the older captured
  // bucket, and its direct label must carry the "(last captured ...)"
  // qualifier composed in the pure layer.
  const axis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  const debt = buildMetricSeries(axis, OBSERVATORY_SERIES_DM, "debt_usd");
  const newestPoint = seriesNewestPoint(axis, OBSERVATORY_SERIES_DM, "debt_usd", debt);
  const maxPoint = seriesMaxPoint(axis, OBSERVATORY_SERIES_DM, "debt_usd", debt);
  if (newestPoint === null || maxPoint === null) {
    throw new Error("fixture invariant: the DM debt series plots a point");
  }
  // Fixture invariants: the newest bucket is withheld (the qualified arm),
  // and the single plotted point is both the drawn max and the newest.
  expect(newestPoint.atNewestBucket).toBe(false);
  expect(maxPoint.index).toBe(newestPoint.index);
  expect(newestPoint.directLabel).toBe(
    `${newestPoint.label} (last captured ${axis.entries[newestPoint.index]?.bucketStart ?? "NEVER"})`,
  );

  const debtChart = page.getByTestId("observatory-chart-debt_usd");

  // ONE STORY, two surfaces (Codex r62 law): the chart's direct label names
  // the older row it belongs to...
  await expect(debtChart.getByTestId("obs-newest-value")).toHaveText(newestPoint.directLabel);

  // ...while the newest summary card keeps the withheld register — the em
  // dash and the named refusal, never the older figure presented as newest.
  const newest = page.getByTestId("observatory-newest");
  await expect(newest).toContainText(EM_DASH);
  await expect(newest).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(newest).not.toContainText(newestPoint.label);

  // ONE POINT, ONE LABEL (fix 4a): the drawn max IS the last plotted point,
  // so the y-max label is omitted — the qualified newest label is the only
  // direct label on this chart (it is the same source string).
  await expect(debtChart.getByTestId("obs-ymax-label")).toHaveCount(0);
  await expect(debtChart.getByTestId("obs-newest-value")).toHaveCount(1);
});

test("W-OBS: a sparse window states itself BEFORE the visual — computed, threshold <= 1", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();

  // The verbatim DM example: one captured bucket plots, one withheld — the
  // STATE line renders inside the panel, in the gap register, computed.
  await expect(page.getByTestId("observatory-sparse-debt_usd")).toHaveText(
    "1 captured bucket plots in this window · 1 withheld bucket stays a named refusal",
  );

  // Two captured buckets cross the threshold: the line does NOT render.
  const captured = OBSERVATORY_SERIES_DM.points.find((point) => !point.refused);
  if (captured === undefined) throw new Error("fixture invariant: a captured DM bucket exists");
  const dense = {
    ...OBSERVATORY_SERIES_DM,
    points: [captured, { ...captured, bucket_start: "2026-07-29T09:00:00Z" }],
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, dense));
  await page.getByTestId("observatory-engine-aave_v3_etherfi").click();
  await expect(page.getByTestId("observatory-chart-debt_usd")).toBeVisible();
  await expect(page.getByTestId("observatory-sparse-debt_usd")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// W-3L — the three-layer conversion, on the rendered page. Expected strings
// are FIXTURE-COMPOSED through the same pure helpers the unit laws pin
// independently — the surface must render them verbatim (the weld), state
// the as-of ONCE, and keep every hazard outside the expandables.
// ---------------------------------------------------------------------------

test("W-3L: the takeaway welds to the fixture — numbers, bucket, gap tally, one string", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  const aaveAxis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  await expect(page.getByTestId("observatory-takeaway")).toHaveText(
    observatoryTakeaway(OBSERVATORY_SERIES_AAVE, aaveAxis),
  );

  // The refused arm, live: switching to the DM view must state the
  // withholding — never the previous bucket's numbers.
  await page.getByTestId("observatory-engine-debt_manager").click();
  const dmAxis = buildBucketAxis(OBSERVATORY_SERIES_DM);
  await expect(page.getByTestId("observatory-takeaway")).toHaveText(
    observatoryTakeaway(OBSERVATORY_SERIES_DM, dmAxis),
  );
  await expect(page.getByTestId("observatory-takeaway")).toContainText("withheld");
});

test("W-3L: the as-of is stated ONCE above the grid, and the reading line welds", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const newest = axis.entries[axis.newestPointIndex]?.point;
  if (newest === null || newest === undefined) throw new Error("fixture lost its newest point");

  // Exactly one as-of-with-watermark statement on the whole surface — it was
  // four. (The takeaway's own "as of bucket" carries no watermark clause and
  // is deliberately outside this needle.)
  const asOf = `as of bucket ${newest.bucket_start} · watermark block`;
  await expect(page.getByTestId("observatory-grid-asof")).toContainText(
    `as of bucket ${newest.bucket_start}`,
  );
  await expect(page.locator(`text=${asOf}`)).toHaveCount(1);

  await expect(page.getByTestId("observatory-grid-reading")).toHaveText(
    gridReadingLine(OBSERVATORY_SERIES_AAVE, axis),
  );
});

test("W-3L: the legend keeps the product triple visible; the drawing notes are forensic", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  // The hazards stay in the visible method line (inventory: these ARE the
  // product): never-interpolates, absent, withheld-null-never-0.
  const legend = page.getByTestId("observatory-legend");
  await expect(legend).toContainText("the line never interpolates across a gap");
  await expect(legend).toContainText("no complete batch in this bucket");
  await expect(legend).toContainText("totals are null and never 0");
  // The two drawing notes sit behind a counted disclosure, closed by default.
  const forensics = page.getByTestId("observatory-legend-forensics");
  await expect(forensics.locator("summary")).toHaveText("2 drawing notes");
  await expect(forensics.getByText("zero floor drawn")).not.toBeVisible();
  await forensics.locator("summary").click();
  await expect(forensics.getByText("zero floor drawn")).toBeVisible();
  await expect(forensics.getByText("click any bucket for its full record")).toBeVisible();
});

test("W-3L: notes ride a COUNTED disclosure — lawful because the tally moved into the takeaway", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  const notes = page.getByTestId("observatory-notes");
  await expect(notes.locator("summary")).toHaveText("1 response note(s) from the service");
  const noteText = OBSERVATORY_SERIES_AAVE.notes[0] ?? "";
  await expect(notes.getByText(noteText)).not.toBeVisible();
  await notes.locator("summary").click();
  await expect(notes.getByText(noteText)).toBeVisible();
});

test("W-3L: the bucket record's takeaway welds, provenance is counted-forensic, hazards stay out", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  const axis = buildBucketAxis(OBSERVATORY_SERIES_AAVE);
  const entry = axis.entries[axis.newestPointIndex];
  if (entry === undefined) throw new Error("fixture lost its newest entry");

  const detail = page.getByTestId("observatory-point-detail");
  await expect(page.getByTestId("observatory-point-takeaway")).toHaveText(
    pointDetailTakeaway(entry),
  );

  // The record's ANSWER stays visible without a click...
  await expect(detail.getByText("debt (usd)")).toBeVisible();
  await expect(detail.getByText("liquidatable positions")).toBeVisible();
  // ...while pure provenance is closed by default, counted in its summary.
  const forensics = page.getByTestId("observatory-point-forensics");
  await expect(forensics.locator("summary")).toContainText("provenance row(s)");
  await expect(page.getByTestId("observatory-point-mkey")).not.toBeVisible();
  await forensics.locator("summary").click();
  await expect(page.getByTestId("observatory-point-mkey")).toBeVisible();
  await expect(page.getByTestId("observatory-point-batch")).toBeVisible();
  // This fixture carries no hazard (no unacked epochs, sweep recorded), so
  // the reorg and sweep rows live INSIDE the expandable — and are now open.
  await expect(page.getByTestId("observatory-point-epochs")).toBeVisible();
  await expect(page.getByTestId("observatory-point-sweep")).toBeVisible();
});

test("W-3L: a WITHHELD record keeps its refusal and null-never-zero clauses OUTSIDE the expandable", async ({
  page,
}) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();
  const detail = page.getByTestId("observatory-point-detail");
  await expect(detail).toHaveAttribute("data-kind", "withheld");
  // The withholding is the takeaway AND the visible state row — no click.
  await expect(page.getByTestId("observatory-point-takeaway")).toContainText("withheld");
  await expect(detail.getByText("null because the book was withheld and never zero").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// r73 — HAZARD PLACEMENT, mutation-backed on the rendered page. The earlier
// weld proved only the safe fixture (vacuous, Codex r73): a JSX edit moving a
// BITING hazard row inside the forensic <details> would not have failed it.
// Each variant here asserts, with the disclosure still CLOSED: the hazard is
// VISIBLE, it is NOT a descendant of the disclosure, and the counted summary
// recounts what the disclosure now actually hides.
// ---------------------------------------------------------------------------

test("r73 — unacked epochs render OUTSIDE the closed disclosure, and the count follows", async ({
  page,
}) => {
  await mockSeries(page);
  const unacked = {
    ...OBSERVATORY_SERIES_AAVE,
    points: OBSERVATORY_SERIES_AAVE.points.map((point, i, all) =>
      i === all.length - 1
        ? { ...point, acked_epoch: point.acked_epoch, max_epoch_at_compute: point.acked_epoch + 2 }
        : point,
    ),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, unacked));
  await openObservatory(page);

  const forensics = page.getByTestId("observatory-point-forensics");
  const epochs = page.getByTestId("observatory-point-epochs");
  await expect(epochs).toBeVisible(); // the disclosure is closed by default
  await expect(epochs).toContainText("2 unacked epoch(s)");
  await expect(forensics.locator('[data-testid="observatory-point-epochs"]')).toHaveCount(0);
  await expect(forensics.locator("summary")).toHaveText("5 provenance row(s) + the rate snapshot");
});

test("r73 — an UNRECORDED sweep renders OUTSIDE the closed disclosure, and the count follows", async ({
  page,
}) => {
  await mockSeries(page);
  const unrecorded = {
    ...OBSERVATORY_SERIES_AAVE,
    points: OBSERVATORY_SERIES_AAVE.points.map((point, i, all) =>
      i === all.length - 1 ? { ...point, sweep_recorded: false, sweep: null } : point,
    ),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, unrecorded));
  await openObservatory(page);

  const forensics = page.getByTestId("observatory-point-forensics");
  const sweep = page.getByTestId("observatory-point-sweep");
  await expect(sweep).toBeVisible();
  await expect(sweep).toContainText("unrecorded: this point predates migration 00018");
  await expect(forensics.locator('[data-testid="observatory-point-sweep"]')).toHaveCount(0);
  await expect(forensics.locator("summary")).toHaveText("5 provenance row(s) + the rate snapshot");
});

test("r73 — an UNSTATED-scale rate table renders OUTSIDE the closed disclosure, and the count follows", async ({
  page,
}) => {
  await mockSeries(page);
  const unstated = {
    ...OBSERVATORY_SERIES_AAVE,
    points: OBSERVATORY_SERIES_AAVE.points.map((point, i, all) =>
      i === all.length - 1
        ? { ...point, rates: point.rates.map((rate) => ({ ...rate, scale: "unstated" })) }
        : point,
    ),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, unstated));
  await openObservatory(page);

  const forensics = page.getByTestId("observatory-point-forensics");
  const rates = page.getByTestId("observatory-rates");
  await expect(rates).toBeVisible();
  await expect(rates).toContainText("unstated · kind outside the known vocabulary");
  await expect(forensics.locator('[data-testid="observatory-rates"]')).toHaveCount(0);
  // Rates left the disclosure entirely: 6 rows, no rate-snapshot suffix.
  await expect(forensics.locator("summary")).toHaveText("6 provenance row(s)");
});

test("r73 — all three hazards at once: each outside, the disclosure keeps only the neutral four", async ({
  page,
}) => {
  await mockSeries(page);
  const all = {
    ...OBSERVATORY_SERIES_AAVE,
    points: OBSERVATORY_SERIES_AAVE.points.map((point, i, entries) =>
      i === entries.length - 1
        ? {
            ...point,
            max_epoch_at_compute: point.acked_epoch + 1,
            sweep_recorded: false,
            sweep: null,
            rates: point.rates.map((rate) => ({ ...rate, scale: "unstated" })),
          }
        : point,
    ),
  };
  await page.route("**/v1/observatory/series*", (route) => fulfillJson(route, all));
  await openObservatory(page);

  const forensics = page.getByTestId("observatory-point-forensics");
  for (const id of ["observatory-point-epochs", "observatory-point-sweep", "observatory-rates"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(forensics.locator(`[data-testid="${id}"]`)).toHaveCount(0);
  }
  await expect(forensics.locator("summary")).toHaveText("4 provenance row(s)");
});
