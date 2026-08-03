// WAVE R4 (Codex round-11) e2e — the two findings, pinned in the browser
// against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, finding by finding:
//   (1) MEDIUM — `performance.now()` PAUSES while the machine sleeps (WebKit
//                225610, Mozilla 1709767) and a bfcache-restored page has had
//                its timers suspended for the whole time it sat in the cache.
//                Wave R3's monotonic-only anchor therefore UNDER-STATED an age
//                by the length of the sleep, and the ribbon's stale-batch
//                suffix — a function of that age — stayed silent over a batch
//                hours past the threshold. The fix: a wall-clock fallback
//                under a NONDECREASING clamp, plus reconciliation on pageshow
//                / visibilitychange / focus with a background re-fetch of the
//                wire age on the surfaces that own their fetch.
//
//                THE SLEEP IS REAL HERE, not simulated by a helper:
//                `page.clock.setSystemTime()` moves the page's wall clock
//                WITHOUT advancing `performance.now()` and without firing a
//                single timer (playwright-core's ClockController._innerSetTime
//                writes `_now.time` and leaves `_now.ticks` alone) — which is
//                precisely the shape of a suspend/resume.
//
//   (2) MEDIUM — the RENDERED legend asserted "interest or a parameter change
//                can still cross". Over a NO-DEBT row that is false: zero
//                borrowings means there is no boundary for anything to cross,
//                and the row's own hover says so. The legend and the hover are
//                asserted TOGETHER below, on one screen, so the contradiction
//                cannot come back unnoticed.

import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

const CORS = { "access-control-allow-origin": "*" };

/** The instant the fake clock is installed at. Chosen, not inherited. */
const T0 = new Date("2026-08-01T12:00:00Z");

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function muteStream(page: Page): Promise<void> {
  await page.route("**/v1/stream**", (route) => route.abort());
}

/**
 * The three lifecycle events a real bfcache restore fires, in the order the
 * browser fires them. Dispatching all three is the point: one resume must
 * produce exactly ONE reconcile, not three re-fetches.
 */
async function dispatchResume(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

// ---------------------------------------------------------------------------
// (1) MEDIUM — the age survives a sleep, and the resume reconciles.
// ---------------------------------------------------------------------------

test("(1) THE ROUND-11 DEFECT: a sleep that freezes performance.now no longer freezes the age", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  // The /v1/book responses this test serves, in order: the first is the
  // committed fixture with a DERIVED age of 3550s (59m — fifty seconds inside
  // the ribbon's hour). The second is held until the test releases it, so the
  // CLAMPED ESTIMATE can be asserted while a re-fetch is genuinely in flight.
  const nearHour = structuredClone(BOOK);
  nearHour.batch.age_seconds = 3550;
  // DERIVED /v1/book #2: the same batch, aged by the wire's own clock across
  // the sleep — 3550 + 6h. No other byte changes.
  const afterSleep = structuredClone(BOOK);
  afterSleep.batch.age_seconds = 3550 + 6 * 3600;

  let bookCalls = 0;
  // The Promise executor runs synchronously, so this placeholder is replaced
  // before anything can call it.
  let releaseSecond: () => void = () => undefined;
  const secondHeld = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  await page.route("**/v1/book", async (route) => {
    bookCalls += 1;
    if (bookCalls === 1) {
      await fulfillJson(route, nearHour);
      return;
    }
    await secondHeld;
    await fulfillJson(route, afterSleep);
  });
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : POSITIONS_AAVE_PAGE_1);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 59m ago");
  expect(bookCalls).toBe(1);

  // SIX HOURS OF A CLOSED LID. The wall clock moved; `performance.now()` did
  // not, and no timer fired — so nothing on screen has changed yet. This is
  // exactly the state the R3 code was permanently stuck in.
  await page.clock.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 59m ago");

  // THE RESUME. The page is restored and the three lifecycle events fire.
  await dispatchResume(page);

  // IMMEDIATELY, before any network answers: the clamped estimate. 3550s + 6h
  // of wall time = 25150s = 6h 59m. The old code said 59m.
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 6h 59m ago");
  // NEVER A SPINNER OVER STALE NUMBERS: the loading state is not re-entered,
  // and no "refreshing" claim is made — the estimate is simply true.
  await expect(page.getByTestId("book-loading")).toHaveCount(0);
  await expect(page.getByTestId("book-dek")).not.toHaveText(/loading/i);

  // ONE resume, ONE re-fetch — the three events coalesce.
  expect(bookCalls).toBe(2);

  // And when the wire answers, its own number takes over from the estimate —
  // which it agrees with to the minute, because the estimate was never a guess:
  // it is the wire's last number plus an interval the wall clock can prove.
  releaseSecond();
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 6h 59m ago");
  await expect(page.getByTestId("book-stamp-freshness")).toHaveText(
    "#1 · computed 2026-07-29T10:00:00Z · 6h 59m ago",
  );
});

test("(1) THE RIBBON ENGAGES POST-RESUME: a slept-through threshold is still crossed", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });

  // DERIVED stream snapshot: the posture batch is 3550s old — fifty seconds
  // inside the ribbon's 1h threshold, so the suffix is correctly SILENT at
  // receipt. No other byte changes.
  const nearHour = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (nearHour.batch === null || nearHour.batch === undefined) {
    throw new Error("fixture shape drifted");
  }
  nearHour.batch.age_seconds = 3550;
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: `event: snapshot\ndata: ${JSON.stringify(nearHour)}\n\n`,
    }),
  );
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : POSITIONS_AAVE_PAGE_1);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const header = page.getByRole("banner");
  await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);

  // Five hours of suspend: the interval never ran, `performance.now()` never
  // advanced. THE DEFECT was that the suffix could never engage from here.
  await page.clock.setSystemTime(new Date(T0.getTime() + 5 * 3_600_000));
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);

  await dispatchResume(page);
  await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 5h old");
  // LIVE still describes the STREAM: two subjects, two statements, both true.
  await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
});

test("(1) NEVER DECREASES: a wall clock stepped BACKWARDS cannot rewind the rendered age", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  const nearHour = structuredClone(BOOK);
  nearHour.batch.age_seconds = 3550;
  await page.route("**/v1/book", (route) => fulfillJson(route, nearHour));
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : POSITIONS_AAVE_PAGE_1);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 59m ago");

  // A sleep, then a resume: the age climbs to 6h 59m.
  await page.clock.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
  await dispatchResume(page);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 6h 59m ago");

  // NTP now yanks the system clock back an hour BEFORE the receipt. A
  // wall-clock-only reading would compute a NEGATIVE elapsed and snap the age
  // back to 59m.
  await page.clock.setSystemTime(new Date(T0.getTime() - 3_600_000));

  // THE TICK PATH: a minute of the interval firing over a wall clock that is
  // now behind the receipt and a monotonic clock that has advanced 60s. The
  // largest honest candidate is 59m 60s — far below what is on screen — so the
  // floor is what renders.
  await page.clock.fastForward(60_000);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 6h 59m ago");

  // THE RESUME PATH: same clamp, same answer. (The 60s fast-forward above also
  // puts this resume outside the coalescing window, so it genuinely runs.)
  await dispatchResume(page);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 6h 59m ago");
});

test("(1) the Inspector reconciles its OWN lookup on resume — same law, its own envelope", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: HISTORY as object, headers: CORS }),
  );

  // DERIVED /v1/address: the lookup's batch is 3550s old — fifty seconds
  // inside the hour, exactly as the Book case above. No other byte changes.
  const nearHour = structuredClone(ADDRESS_FOUND);
  nearHour.batch.age_seconds = 3550;
  let addressCalls = 0;
  // `*` does not cross a `/`, so this pattern is the LOOKUP only — the
  // `/history` route registered above keeps its own requests.
  await page.route("**/v1/address/0x*", (route) => {
    addressCalls += 1;
    return route.fulfill({ json: nearHour as object, headers: CORS });
  });
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const line = page.getByTestId("inspector-freshness");
  await expect(line).toHaveText(
    `batch #${String(nearHour.batch.id)} · computed ${nearHour.batch.computed_at} · 59m ago`,
  );
  expect(addressCalls).toBe(1);

  await page.clock.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
  await dispatchResume(page);

  await expect(line).toHaveText(
    `batch #${String(nearHour.batch.id)} · computed ${nearHour.batch.computed_at} · 6h 59m ago`,
  );
  // The position stayed on screen throughout — no spinner over a stale number.
  await expect(page.getByText("querying the newest servable batch…")).toHaveCount(0);
  // ONE resume, ONE re-fetch of the address lookup.
  expect(addressCalls).toBe(2);
});

// ---------------------------------------------------------------------------
// (2) MEDIUM — the legend and the NO-DEBT hover, asserted on one screen.
// ---------------------------------------------------------------------------

/**
 * DERIVED /v1/positions page 1: the aave row's `liq_distance` becomes the
 * `never` kind carrying the solver's "position carries no debt" reason — the
 * exact wire shape internal/risk/liqprice.go publishes for a zero-borrowings
 * account. No other byte changes.
 */
function aavePageWithNoDebt() {
  const page1 = structuredClone(POSITIONS_AAVE_PAGE_1);
  const row = page1.positions[0];
  if (row === undefined) throw new Error("fixture shape drifted");
  row.liq_distance = {
    kind: "never",
    scale_factor_num: null,
    scale_factor_den: null,
    factor_asset: null,
    reason: "position carries no debt",
  } as (typeof row)["liq_distance"];
  page1.next_cursor = null;
  return page1;
}

test("(2) THE ROUND-11 DEFECT: the legend and the NO-DEBT hover no longer contradict", async ({
  page,
}) => {
  await muteStream(page);
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : aavePageWithNoDebt());
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  const legend = page.getByTestId("no-price-path-legend");
  // W-HR-A: the price-path statement rides the Headroom cell's hover now.
  const cell = page
    .getByRole("table", { name: "positions for aave_v3_etherfi" })
    .getByTestId("headroom-value");

  // BOTH ARE ON SCREEN AT ONCE — that is the whole test. The legend is
  // reason-NEUTRAL, and the hover carries this row's own reason.
  await expect(legend).toBeVisible();
  await expect(cell).toBeVisible();

  await expect(legend).toHaveText(
    "no price path = no downward move along the committed price axis reaches liquidation for " +
      "this account — non-price paths are not evaluated here; each cell's hover names its " +
      "reason. The HF column stays the verdict.",
  );
  await expect(cell).toHaveAttribute(
    "title",
    "5–10% of borrowing capacity left before liquidation No debt to liquidate: with zero borrowings there is no boundary to " +
      "cross. If the account borrows, a distance will appear. Wire: 'position carries no " +
      "debt'.",
  );

  // THE CONTRADICTION, named: the hover says there is NO boundary. A legend
  // promising that interest or a parameter change "can still cross" was
  // promising a crossing of something that does not exist.
  await expect(legend).not.toContainText("interest");
  await expect(legend).not.toContainText("parameter change");
  await expect(legend).not.toContainText("still cross");
  // The legend delegates instead of asserting.
  await expect(legend).toContainText("each cell's hover names its reason");
});

test("(2) the reason-neutral legend still sits honestly over the COVERS arm", async ({ page }) => {
  // DERIVED /v1/positions page 1: the same row, carrying the covers reason —
  // the arm Wave R3 fixed. One legend must be true over both arms at once.
  const page1 = structuredClone(POSITIONS_AAVE_PAGE_1);
  const row = page1.positions[0];
  if (row === undefined) throw new Error("fixture shape drifted");
  row.liq_distance = {
    kind: "never",
    scale_factor_num: null,
    scale_factor_den: null,
    factor_asset: null,
    reason: "collateral outside the factor already covers the debt at threshold",
  } as (typeof row)["liq_distance"];
  page1.next_cursor = null;

  await muteStream(page);
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : page1);
  });
  await page.goto("/book?engine=aave_v3_etherfi");

  await expect(page.getByTestId("no-price-path-legend")).toHaveText(
    "no price path = no downward move along the committed price axis reaches liquidation for " +
      "this account — non-price paths are not evaluated here; each cell's hover names its " +
      "reason. The HF column stays the verdict.",
  );
  // This arm's hover is where "interest or parameter changes still can" belongs
  // — attached to the row it is TRUE of, not asserted over every row.
  await expect(
    page
      .getByRole("table", { name: "positions for aave_v3_etherfi" })
      .getByTestId("headroom-value"),
  ).toHaveAttribute(
    "title",
    "5–10% of borrowing capacity left before liquidation Collateral outside the shocked asset already covers the debt at the " +
      "liquidation threshold — no fall of the shocked asset alone reaches the boundary; " +
      "interest or parameter changes still can. Wire: 'collateral outside the factor already " +
      "covers the debt at threshold'.",
  );
});
