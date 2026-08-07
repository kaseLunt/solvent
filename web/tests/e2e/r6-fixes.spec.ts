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

import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";
import { ADDRESS_FOUND, EVENTS, FOUND_ADDR, HISTORY, PARAMS } from "../fixtures/inspector";

const CORS = { "access-control-allow-origin": "*" };

/** The instant the fake clock is installed at. Chosen, not inherited. */
const T0 = new Date("2026-08-01T12:00:00Z");

/** The suspend the two clocks conspire to hide. */
const THREE_HOURS_MS = 3 * 3_600_000;

/** The house register for an age the page cannot state (lib/freshness.ts). */
const REFRESHING = "age UNKNOWN since resume · refreshing";
const REFRESH_FAILED = "age UNKNOWN since resume · refresh failed, data retained";

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

async function routePositions(page: Page): Promise<void> {
  await page.route("**/v1/positions*", (route) => {
    const engine = new URL(route.request().url()).searchParams.get("engine");
    return fulfillJson(route, engine === "debt_manager" ? POSITIONS_DM_PAGE_1 : POSITIONS_AAVE_PAGE_1);
  });
}

/**
 * DERIVED /v1/book #1: the committed fixture at a two-minute age. Its own
 * `served_at` (2026-07-29T10:00:00Z) and batch id are the fixture's. No other
 * byte changes.
 *
 * 130s, not 120: ten seconds INSIDE the minute, so the second or so the page
 * spends loading before the anchor is taken cannot round a `2m` assertion down.
 */
function bookTwoMinutesOld() {
  const book = structuredClone(BOOK);
  book.batch.age_seconds = 130;
  return book;
}

/**
 * DERIVED /v1/book #2: a DIFFERENT RECEIPT — its own `served_at`, its own batch
 * id, its own `computed_at` — carrying the wire's account of how old the newest
 * batch is once the reader is back. This is the only thing that can discharge
 * an unknown age, so every repair below answers with it.
 */
function repairedBook(ageSeconds: number) {
  const book = structuredClone(BOOK);
  book.served_at = "2026-07-29T13:00:15Z";
  book.batch.id = 2;
  book.batch.computed_at = "2026-07-29T12:58:05Z";
  book.batch.age_seconds = ageSeconds;
  return book;
}

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
// (1) MEDIUM — the ribbon's case: an idle stream, two blind clocks, no repair.
// ---------------------------------------------------------------------------

test("(1) THE ROUND-13 RIBBON DEFECT: an idle stream + two blind clocks no longer reads as fresh", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });

  // DERIVED stream snapshot #1: the posture batch is 130s old — WELL inside the
  // ribbon's 1h threshold, so the stale suffix is correctly silent at receipt.
  // No other byte changes.
  const idle = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (idle.batch === null || idle.batch === undefined) throw new Error("fixture shape drifted");
  idle.batch.age_seconds = 130;

  // DERIVED stream snapshot #2 — THE REPAIR the reconnect obliges the server to
  // send. A NEW `served_at` (so it is a new receipt) over the SAME batch id: the
  // repair is not a new batch, it is a new STATEMENT about the batch the reader
  // is already holding, and it says that batch is now three hours old.
  const repair = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (repair.batch === null || repair.batch === undefined) throw new Error("fixture shape drifted");
  repair.served_at = "2026-07-29T13:00:15Z";
  repair.batch.age_seconds = THREE_HOURS_MS / 1000 + 130;

  let connections = 0;
  // The Promise executor runs synchronously, so this placeholder is replaced
  // before anything can call it.
  let releaseRepair: () => void = () => undefined;
  const repairHeld = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });
  await page.route("**/v1/stream**", async (route) => {
    connections += 1;
    const frame = (payload: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream" },
        // Heartbeat COMMENTS after the snapshot: the stream is alive and has
        // nothing to say. That is the state the finding lives in.
        body: `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n: heartbeat 1785000000\n\n`,
      });
    if (connections === 1) {
      await frame(idle);
      return;
    }
    // HELD, so the unknown register can be asserted while the repair the ribbon
    // itself triggered is genuinely in flight.
    await repairHeld;
    await frame(repair);
  });
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await routePositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  const header = page.getByRole("banner");
  // WAVE R7 (round-15 finding 4): this mock hands over a snapshot and ENDS the
  // body, so the connection is closed and the client is parked on its backoff.
  // R6 asserted `LIVE · WATERMARKED` here because holding a batch was the whole
  // qualification for the green chip — which is precisely the defect R7 closes.
  // What the ribbon claims about the CONNECTION changed; what it claims about
  // the BATCH (this test's subject, every assertion below) did not.
  await expect(header.getByText("STREAM · RECONNECTING")).toBeVisible();
  await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
  // 130s is inside the hour: correctly silent, and correctly ONE connection —
  // the clock is paused, so the stream's reconnect backoff never fires and this
  // is a genuinely idle stream rather than a re-snapshotting one.
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);
  expect(connections).toBe(1);

  await blindWake(page);

  // THE FIX. The ribbon stops claiming anything about the age: the computed
  // suffix is not rendered (it would still be silent — 130s is inside the hour
  // — which is exactly the defect), and the slot carries a refusal instead.
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(
    `· batch ${REFRESHING}`,
  );
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);
  // NOT A STALENESS CLAIM: the page does not know the batch is old, only that
  // it cannot say how old. No hour count is implied anywhere in the slot.
  await expect(page.getByTestId("ribbon-batch-age-unknown")).not.toContainText("old");

  // AND THE REPAIR IS REAL: the ribbon owns no fetch, so it reconnected the
  // stream — which obliges the contract's snapshot-on-connect. THE OLD
  // BEHAVIOUR was exactly one connection forever, and a quiet publishing loop
  // meant no receipt for as long as it stayed quiet.
  await expect.poll(() => connections).toBe(2);

  // WAVE R7: and while that repair is IN FLIGHT the ribbon says so. Connection
  // 2 is held open by the mock with no response at all, so the client is
  // `connecting` — R6 asserted LIVE here, over a torn-down stream and a
  // reconnect that had not answered, which is finding 4 in one line. Two
  // subjects, two statements, and now BOTH are true: the connection is being
  // re-established, and the age of the batch it is holding is unknown.
  await expect(header.getByText("STREAM · CONNECTING")).toBeVisible();
  await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toBeVisible();

  // THE REPAIR LANDS. A new receipt — and a new receipt is the only thing that
  // discharges an unknown age. The suffix the ribbon could not compute a moment
  // ago is computable again, and it says three hours.
  releaseRepair();
  await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 3h old");
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveCount(0);
  // ONE reconnect for this repair, and it is still the only one: the successful
  // attempt ended the schedule.
  //
  // (The count is asserted WITHOUT advancing the clock. This mock ends each
  // response body, which a real stream does not — so an advanced clock would
  // release the client's own reconnect backoff and count the MOCK's artefact
  // rather than the repair schedule. The schedule's bound is pinned in the next
  // test, where the repair is held open and nothing else can reconnect.)
  expect(connections).toBe(2);
});

test("(1) THE RIBBON'S REPAIR IS BOUNDED: one reconnect per step, then it stops and says so", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: T0 });

  // DERIVED stream snapshot: 130s, as above — silent suffix at receipt.
  const idle = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (idle.batch === null || idle.batch === undefined) throw new Error("fixture shape drifted");
  idle.batch.age_seconds = 130;

  let connections = 0;
  let releaseAll: () => void = () => undefined;
  const neverAnswers = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  await page.route("**/v1/stream**", async (route) => {
    connections += 1;
    if (connections === 1) {
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream" },
        body: `event: snapshot\ndata: ${JSON.stringify(idle)}\n\n: heartbeat 1785000000\n\n`,
      });
      return;
    }
    // EVERY reconnect hangs: the service accepts the connection and never
    // delivers its base frame. Holding rather than failing is deliberate — a
    // held request produces no body-end, so the client's OWN backoff never
    // fires and every connection counted below is one the repair schedule asked
    // for.
    await neverAnswers;
    try {
      await route.abort();
    } catch {
      // The request was aborted when its stream was torn down. Nothing to do.
    }
  });
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await routePositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  // WAVE R7: the body ended, so the stream is closed and parked on its backoff.
  // See the note on the previous test — LIVE is now a claim about the CURRENT
  // connection, and this mock never gives it one.
  await expect(page.getByRole("banner").getByText("STREAM · RECONNECTING")).toBeVisible();
  expect(connections).toBe(1);

  await blindWake(page);

  // ATTEMPT 1 — immediate, at the reconcile itself.
  await expect.poll(() => connections).toBe(2);
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(`· batch ${REFRESHING}`);

  // ATTEMPT 2 and ATTEMPT 3 — the bounded schedule, one reconnect each. No
  // polling loop: each step is armed only when the previous attempt has been
  // given up on.
  await advanceUntil(page, () => connections, 3);
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(`· batch ${REFRESHING}`);
  await advanceUntil(page, () => connections, 4);

  // The third attempt gets the same patience as the other two and spends it.
  await page.clock.fastForward(10_000);

  // THE SCHEDULE ENDS. The register changes from "refreshing" to the terminal
  // statement — and it still does not claim the batch is stale, because the
  // page still does not know that. It knows it could not find out.
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(
    `· batch ${REFRESH_FAILED}`,
  );
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);
  // AND IT IS A BOUND: those ten seconds produced no fourth attempt. The stream
  // is not converted into a poll over a service that is not answering.
  expect(connections).toBe(4);
  // WAVE R7 CORRECTS THE CLAIM THIS LINE USED TO MAKE. R6 said "LIVE still
  // describes the STREAM, which really is connected" — but every reconnect in
  // this test is HELD by the mock with no response, so the stream is not
  // connected at all; the ribbon was painting LIVE from the retained batch
  // alone. That is finding 4 exactly. The badge now states the truth, and the
  // reader is told BOTH facts: the connection is still being attempted, and the
  // age of the data they are holding could not be restored.
  await expect(page.getByRole("banner").getByText("STREAM · CONNECTING")).toBeVisible();
  await expect(page.getByRole("banner").getByText("LIVE · WATERMARKED")).toHaveCount(0);
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(
    `· batch ${REFRESH_FAILED}`,
  );

  releaseAll();
});

// ---------------------------------------------------------------------------
// (2) MEDIUM — a repair that FAILS, disclosed; the bounded retry; the discharge.
// ---------------------------------------------------------------------------

test("(2) THE ROUND-13 BOOK DEFECT: a FAILED repair under blind clocks is disclosed, not absorbed", async ({
  page,
}) => {
  // Driving a bounded retry SCHEDULE through a fake clock costs real seconds:
  // each step is stepped to rather than jumped to, so the arming is observed
  // rather than raced.
  test.setTimeout(60_000);
  await page.clock.install({ time: T0 });
  await muteStream(page);

  let bookCalls = 0;
  // Attempt 1 is the page load. Attempts 2, 3 and 4 are the blind resume's
  // repair and both of its bounded retries, and every one of them FAILS at the
  // transport — a woken laptop whose network interface is not up yet, which is
  // the failure this whole path exists for. Attempt 5 is held, then answered.
  let releaseFifth: () => void = () => undefined;
  const fifthHeld = new Promise<void>((resolve) => {
    releaseFifth = resolve;
  });
  await page.route("**/v1/book", async (route) => {
    bookCalls += 1;
    if (bookCalls === 1) {
      await fulfillJson(route, bookTwoMinutesOld());
      return;
    }
    if (bookCalls <= 4) {
      await route.abort("failed");
      return;
    }
    await fifthHeld;
    // DERIVED /v1/book: the wire's own account once the reader is back — three
    // hours and two minutes, on a receipt of its own.
    await fulfillJson(route, repairedBook(THREE_HOURS_MS / 1000 + 130));
  });
  await routePositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  const line = page.getByTestId("book-freshness");
  const stamp = page.getByTestId("book-stamp-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");
  expect(bookCalls).toBe(1);

  await blindWake(page);

  // THE FIX, first half: the age is not restated as 2m and is not restated at
  // all. THE OLD BEHAVIOUR was this line reading `2m ago` over a batch three
  // hours old, with the proof of the missing interval already consumed.
  await expect(line).toHaveText(`batch #1 · computed 2026-07-29T10:00:00Z · ${REFRESHING}`);
  await expect(stamp).toHaveText(`#1 · computed 2026-07-29T10:00:00Z · ${REFRESHING}`);
  await expect(line).not.toContainText("2m");
  await expect.poll(() => bookCalls).toBe(2);

  // THE DATA IS NEVER BLANKED. Freshness is not a reason to empty a table: the
  // book, the dek and the position rows all stay exactly where they were, and
  // `keepOnFailure` still keeps the failed background repair off the screen.
  await expect(page.getByTestId("book-loading")).toHaveCount(0);
  await expect(page.getByTestId("book-dek")).not.toHaveText(/loading/i);
  await expect(page.getByRole("table", { name: "positions for aave_v3_etherfi" })).toBeVisible();

  // THE BOUNDED RETRY, step by step. +5s, then +15s — and each is armed only
  // when the previous attempt has settled, so this drives the chain rather than
  // jumping past it.
  await advanceUntil(page, () => bookCalls, 3);
  await expect(line).toHaveText(`batch #1 · computed 2026-07-29T10:00:00Z · ${REFRESHING}`);
  await advanceUntil(page, () => bookCalls, 4);

  // THE SCHEDULE ENDS, and the page says which of the two states it is in. It
  // still does not claim the batch is stale — it claims only that it could not
  // restore an age, and that nothing was thrown away.
  await expect(line).toHaveText(`batch #1 · computed 2026-07-29T10:00:00Z · ${REFRESH_FAILED}`);
  await expect(stamp).toHaveText(`#1 · computed 2026-07-29T10:00:00Z · ${REFRESH_FAILED}`);
  await expect(page.getByRole("table", { name: "positions for aave_v3_etherfi" })).toBeVisible();

  // AND IT IS A BOUND, not a slow poll: two more minutes of clock, no fifth
  // attempt. Asserting the TOTAL after a state that must be reached is how a
  // must-not-fire is pinned without waiting on a real clock.
  await page.clock.fastForward(120_000);
  await expect(line).toHaveText(`batch #1 · computed 2026-07-29T10:00:00Z · ${REFRESH_FAILED}`);
  expect(bookCalls).toBe(4);

  // A LATER CLOCK-CERTIFIED RESUME DOES NOT DISCHARGE THE UNKNOWN. The reader
  // comes back with honest clocks; the reconcile measures the interval since
  // the LAST MARK, which was taken after the blind wake — so it says nothing
  // about the interval the blind wake swallowed. It re-fetches (that is R4's
  // path, unchanged), and until that answers the refusal stands.
  await page.clock.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
  await dispatchPersistedPageshow(page);
  await expect.poll(() => bookCalls).toBe(5);
  await expect(line).toHaveText(`batch #1 · computed 2026-07-29T10:00:00Z · ${REFRESH_FAILED}`);

  // ONLY THE RECEIPT DISCHARGES IT.
  releaseFifth();
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T12:58:05Z · 3h 2m ago");
  await expect(stamp).toHaveText("#2 · computed 2026-07-29T12:58:05Z · 3h 2m ago");
  await expect(line).not.toContainText("UNKNOWN");
});

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

// ---------------------------------------------------------------------------
// (d) NO FALSE ALARMS — a resume the clocks CAN measure states its age.
// ---------------------------------------------------------------------------

test("A CLOCK-CERTIFIED RESUME NEVER SHOWS THE UNKNOWN REGISTER", async ({ page }) => {
  await page.clock.install({ time: T0 });

  // DERIVED stream snapshot: 3550s — fifty seconds inside the ribbon's hour, so
  // the suffix is correctly silent at receipt and must ENGAGE after the sleep.
  // Every connection serves the SAME payload: the reader's own clock is what
  // carries this case, not a fresh statement from the service.
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

  // DERIVED /v1/book: the same 3550s, and every response is the same receipt —
  // so nothing here can be repaired by a re-fetch, and the age on screen is
  // purely what the two clocks license.
  const bookNearHour = structuredClone(BOOK);
  bookNearHour.batch.age_seconds = 3550;
  await page.route("**/v1/book", (route) => fulfillJson(route, bookNearHour));
  await routePositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 59m ago");
  await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);

  // AN ORDINARY SLEEP WITH AN HONEST WALL CLOCK: five hours the recompute can
  // ADD, in full. This is R4's case and it stays R4's case — the evidence is
  // definitive, but the deltas certify the whole interval, so nothing is
  // unknown about it.
  await page.clock.setSystemTime(new Date(T0.getTime() + 5 * 3_600_000));
  await dispatchPersistedPageshow(page);

  // A NUMBER, not a refusal — on both surfaces. Raising the unknown here would
  // be a false alarm over an age the page can state exactly, and a register
  // that cries wolf on every ordinary sleep is a register nobody reads.
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 5h 59m ago");
  await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 5h old");
  await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveCount(0);
  await expect(page.getByTestId("book-stamp-freshness")).not.toContainText("UNKNOWN");
});
