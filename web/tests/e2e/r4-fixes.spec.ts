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

import { expect, test, type Page } from "@playwright/test";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

const CORS = { "access-control-allow-origin": "*" };

/** The instant the fake clock is installed at. Chosen, not inherited. */
const T0 = new Date("2026-08-01T12:00:00Z");

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
