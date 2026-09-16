// WAVE R6 (Codex round-13) e2e — the UNRESOLVED-RESUME state, pinned in the
// browser against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, finding by finding:
//   (1) MEDIUM — THE RIBBON HAD NO REPAIR PATH. R5 made the adversarial wake
//                RECONCILE, but a reconcile is not a measurement: with
//                `performance.now()` paused by the suspend and the wall clock
//                stepped BACKWARD on the same wake, the recompute adds nothing.
//                The ribbon's batch arrives on the SSE stream, and a healthy
//                but IDLE stream — heartbeats, no new snapshot or batch frame —
//                delivers no new receipt. So a batch received at 130s before a
//                three-hour sleep kept rendering under the one-hour warning
//                threshold for another ~58 minutes: `LIVE · WATERMARKED`, no
//                stale suffix, over hours-old data. The fix: the age renders
//                UNKNOWN, and the ribbon triggers a stream teardown-and-reopen
//                so the contract's snapshot-on-connect delivers a new receipt.
//
//   (2) MEDIUM — `trackResumeSignal` CONSUMED the departure evidence and
//                re-marked both clocks BEFORE the fire-and-forget `onResume`.
//                When that repair fetch failed — invisibly, because
//                `keepOnFailure` correctly refuses to trade a real book for an
//                error strip — "2m ago" stood as if the wire had confirmed it,
//                the proof of the missing interval was already spent, and every
//                later tick added only post-wake time. The fix: the repair's
//                completion is OBSERVED, a failure keeps the age unknown and
//                schedules the next step of a BOUNDED retry, and only a NEW
//                RECEIPT discharges the unknown.
//
// THE CLOCKS ARE REAL HERE, not simulated by a helper:
// `page.clock.setSystemTime()` moves the page's wall clock WITHOUT advancing
// `performance.now()` and without firing a single timer (playwright-core's
// ClockController._innerSetTime writes `_now.time` and leaves `_now.ticks`
// alone) — which is precisely the shape of a suspend/resume, in either
// direction. And because `install()` leaves the clock PAUSED, no timer fires
// unless a test asks: the stream's own reconnect backoff stays parked, which is
// what makes "a healthy but idle stream" reproducible below.

import { expect, test, type Page } from "@playwright/test";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

const CORS = { "access-control-allow-origin": "*" };

/** The instant the fake clock is installed at. Chosen, not inherited. */
const T0 = new Date("2026-08-01T12:00:00Z");

/** The suspend the two clocks conspire to hide. */
const THREE_HOURS_MS = 3 * 3_600_000;

/** The house register for an age the page cannot state (lib/freshness.ts). */
const REFRESHING = "age UNKNOWN since resume · refreshing";

/** ONLY the bfcache restore — the definitive signal, isolated from the burst. */
async function dispatchPersistedPageshow(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
}

/**
 * THE ADVERSARIAL WAKE, in one call: the machine slept three hours (so
 * `performance.now()` did not advance a millisecond) and the OS corrected a
 * skewed system clock BACKWARD by the same interval on that wake. Monotonic
 * delta: zero. Wall delta: negative. Neither clock will certify a second of it.
 */
async function blindWake(page: Page): Promise<void> {
  await page.clock.setSystemTime(new Date(T0.getTime() - THREE_HOURS_MS));
  await dispatchPersistedPageshow(page);
}

/**
 * Advance the page's fake clock in small steps until `read()` reports `want`.
 *
 * The retry schedule is a CHAIN — each step's timer is armed only once the
 * previous attempt's promise has SETTLED — so one big jump would race the
 * arming rather than observe it. Stepping is how a bounded schedule is driven
 * without sleeping on a real clock, and a step that never arms fails here on
 * the poll timeout instead of hanging.
 */
async function advanceUntil(page: Page, read: () => number, want: number): Promise<void> {
  await expect
    .poll(
      async () => {
        if (read() < want) await page.clock.fastForward(2_000);
        return read();
      },
      { timeout: 30_000 },
    )
    .toBe(want);
}

// ---------------------------------------------------------------------------
// (2) MEDIUM — a repair that FAILS, disclosed; the bounded retry; the discharge.
// ---------------------------------------------------------------------------

test("(2) the Inspector: same law, its own envelope — a failed repair, then a bounded retry that lands", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await page.route("**/v1/stream*", (route) => route.abort());
  await page.route("**/v1/params*", (route) => route.fulfill({ json: PARAMS, headers: CORS }));
  await page.route("**/v1/events*", (route) => route.fulfill({ json: EVENTS, headers: CORS }));
  await page.route("**/v1/address/*/history*", (route) =>
    route.fulfill({ json: HISTORY as object, headers: CORS }),
  );

  // DERIVED /v1/address: the lookup's batch is 130s old. No other byte changes.
  const nearFresh = structuredClone(ADDRESS_FOUND);
  nearFresh.batch.age_seconds = 130;
  // DERIVED /v1/address #2 — THE REPAIR, on its own receipt: a new `served_at`,
  // a new batch id, and the wire's own account of the age.
  const repaired = structuredClone(ADDRESS_FOUND);
  repaired.served_at = "2026-07-29T13:00:15Z";
  repaired.batch.id = 2;
  repaired.batch.computed_at = "2026-07-29T12:58:05Z";
  repaired.batch.age_seconds = THREE_HOURS_MS / 1000 + 130;

  let addressCalls = 0;
  // `*` does not cross a `/`, so this pattern is the LOOKUP only — the
  // `/history` route registered above keeps its own requests.
  await page.route("**/v1/address/0x*", async (route) => {
    addressCalls += 1;
    if (addressCalls === 1) {
      await route.fulfill({ json: nearFresh as object, headers: CORS });
      return;
    }
    // The repair fails once — the woken laptop's network — and the first
    // bounded retry lands.
    if (addressCalls === 2) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ json: repaired as object, headers: CORS });
  });
  await page.goto(`/inspector/${FOUND_ADDR}`);

  const line = page.getByTestId("inspector-freshness");
  await expect(line).toHaveText(
    `batch #${String(nearFresh.batch.id)} · computed ${nearFresh.batch.computed_at} · 2m ago`,
  );
  expect(addressCalls).toBe(1);

  await blindWake(page);

  await expect(line).toHaveText(
    `batch #${String(nearFresh.batch.id)} · computed ${nearFresh.batch.computed_at} · ${REFRESHING}`,
  );
  await expect.poll(() => addressCalls).toBe(2);
  // The position stayed on screen throughout — no spinner, and no "lookup
  // unavailable", because a failed BACKGROUND repair is not an answer about
  // this address.
  await expect(page.getByText("querying the newest servable batch…")).toHaveCount(0);
  // r74: the outcome line renders for EVERY ready arm — the retained state
  // must be proven POSITIVE, or a repair that swapped the position for a
  // negative/unknowable would stay green.
  await expect(
    page.getByTestId("inspector-outcome").filter({ hasText: "outcome · found" }),
  ).toBeVisible();
  await expect(page.getByTestId("position-aave_v3_etherfi")).toBeVisible();

  // THE FIRST BOUNDED RETRY LANDS, and the receipt it brings discharges the
  // unknown.
  await advanceUntil(page, () => addressCalls, 3);
  await expect(line).toHaveText(
    `batch #2 · computed ${repaired.batch.computed_at} · 3h 2m ago`,
  );
  await expect(line).not.toContainText("UNKNOWN");
  // The schedule stopped on the success — it is not a poll.
  await page.clock.fastForward(120_000);
  expect(addressCalls).toBe(3);
});
