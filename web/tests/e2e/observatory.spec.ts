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
//     render as em dashes, never 0.

import { expect, test, type Page, type Route } from "@playwright/test";
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

  // Four charts, each stating its own as-of (bucket + watermark, not served_at).
  for (const metric of ["debt_usd", "collateral_usd", "accounts", "liquidatable_positions"]) {
    const panel = page.getByTestId(`observatory-chart-${metric}`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("as of bucket 2026-07-29T10:00:00Z");
    await expect(panel).toContainText("block 25,635,900");
  }

  // The response's own notes render; the stampline pins the record.
  await expect(page.getByTestId("observatory-notes")).toContainText(
    "a withheld bucket carries NULL totals",
  );
  await expect(page.getByText("4 captured · 0 withheld · 1 absent")).toBeVisible();
  await expect(page.getByText("native hourly buckets — every captured bucket served verbatim")).toBeVisible();

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
  await expect(detail).toContainText("NO COMPLETE BATCH");
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
  await expect(degraded).toContainText("a named state, not an empty chart");
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

  // The rate snapshot carries its OWN as-of block, not the bucket's.
  const rates = page.getByTestId("observatory-rates");
  await expect(rates).toContainText("borrow_apy");
  await expect(rates).toContainText("USDC");
  await expect(rates).toContainText("50000000000000000");
  await expect(rates).toContainText("154,793,990");
});

test("a WITHHELD bucket stays visible with its named refusal — em dashes, never 0", async ({ page }) => {
  await mockSeries(page);
  await openObservatory(page);
  await page.getByTestId("observatory-engine-debt_manager").click();

  // The newest bucket IS the withheld one: the strip refuses honestly.
  const newest = page.getByTestId("observatory-newest");
  await expect(newest).toContainText("REFUSED · FLAG_CUSTODY_UNPROVEN");
  await expect(newest).toContainText("withheld — not zero");
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
  await expect(detail).toContainText("null because the book was withheld; not zero");
  await expect(detail).not.toContainText("$0");

  // The bucket census counts the withheld bucket instead of dropping it.
  await expect(page.getByText("1 captured · 1 withheld · 0 absent")).toBeVisible();
});
