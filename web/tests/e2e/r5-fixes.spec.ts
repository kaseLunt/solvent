// WAVE R5 (Codex round-12) e2e — the two freshness findings, pinned in the
// browser against the production build with the API mocked from the committed
// fixtures. Every mutation below is a structuredClone delta documented at its
// call site.
//
// What this file pins, finding by finding:
//   (1) MEDIUM — the anchor's identity was the wire VALUE. `age_seconds` is an
//                INTEGER of seconds, and the resume re-fetch asks for a fresh
//                batch at whatever cadence the reader's lifecycle produces —
//                so a NEWER batch routinely arrives carrying the same integer
//                age the previous one carried. Under the value test that new
//                receipt inherited the old anchor AND its accumulated
//                interval: a batch two minutes old rendered as an hour and two
//                minutes old, with no path back short of a reload. The fix:
//                identity is the RECEIPT — `served_at` with the batch id — so
//                every successful response re-anchors.
//
//   (2) MEDIUM — the resume gate asked the two clocks how much time had
//                passed. BOTH go blind on the same wake: a suspend pauses
//                `performance.now()` and the OS corrects a skewed wall clock
//                BACKWARD at the same moment. The lifecycle burst was then
//                dismissed as an echo, and the page reconciled nothing — no
//                recompute, no repair re-fetch — leaving the age (and the
//                stale-batch ribbon downstream of it) hours fresher than the
//                truth. The fix: definitive lifecycle evidence — a persisted
//                `pageshow`, a hidden→visible transition — outranks both
//                clocks, while the burst still coalesces to ONE reconcile.
//
// THE CLOCKS ARE REAL HERE, not simulated by a helper:
// `page.clock.setSystemTime()` moves the page's wall clock WITHOUT advancing
// `performance.now()` and without firing a single timer (playwright-core's
// ClockController._innerSetTime writes `_now.time` and leaves `_now.ticks`
// alone) — which is precisely the shape of a suspend/resume, in either
// direction.

import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_DM_PAGE_1 } from "../fixtures/book";

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
 * spends loading before the anchor is taken cannot round a `1h 2m` assertion
 * down to `1h 1m`. The rendered minute is the subject of these tests; the
 * second the harness spends getting there is not.
 */
function bookTwoMinutesOld() {
  const book = structuredClone(BOOK);
  book.batch.age_seconds = 130;
  return book;
}

/**
 * DERIVED /v1/book #2: A DIFFERENT RECEIPT — its own `served_at`, its own batch
 * id, its own `computed_at` — carrying the SAME integer `age_seconds` as #1.
 *
 * This is not a contrived collision. Both cadences hang off the same publishing
 * loop, so a batch fetched two minutes after it was computed carries exactly
 * what the previous batch carried two minutes after IT was computed.
 */
function nextBatchAlsoTwoMinutesOld(ageSeconds = 130) {
  const book = structuredClone(BOOK);
  book.served_at = "2026-07-29T11:00:05Z";
  book.batch.id = 2;
  book.batch.computed_at = "2026-07-29T10:58:05Z";
  book.batch.age_seconds = ageSeconds;
  return book;
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

/** ONLY the bfcache restore — the definitive signal, isolated from the burst. */
async function dispatchPersistedPageshow(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
}

/**
 * A REAL visibility transition: the own-property shadow makes
 * `document.visibilityState` read as this value, and then the event fires — so
 * the hook reads exactly what a backgrounded tab would hand it.
 */
async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

// ---------------------------------------------------------------------------
// (1) MEDIUM — a receipt is not its age.
// ---------------------------------------------------------------------------

test("(1) THE ROUND-12 DEFECT: a NEW receipt at the SAME age_seconds re-anchors", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  const first = bookTwoMinutesOld();
  const second = nextBatchAlsoTwoMinutesOld();

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
      await fulfillJson(route, first);
      return;
    }
    await secondHeld;
    await fulfillJson(route, second);
  });
  await routePositions(page);
  await page.goto("/book");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");
  expect(bookCalls).toBe(1);

  // An hour of a closed lid, then the restore. R4's estimate lands first and is
  // TRUE of the batch it describes: batch #1 really is 1h 2m old now.
  await page.clock.setSystemTime(new Date(T0.getTime() + 3_600_000));
  await dispatchResume(page);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 2m ago");
  expect(bookCalls).toBe(2);

  // THE REPAIR LANDS. Batch #2 was computed two minutes ago; the wire says 130,
  // exactly what batch #1's envelope said an hour earlier.
  releaseSecond();
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 2m ago");
  // THE OLD BEHAVIOUR, named so it cannot come back: keyed on the wire VALUE,
  // 120 === 120 was "the same receipt", the effect never re-ran, and this line
  // read `batch #2 · computed 2026-07-29T10:58:05Z · 1h 2m ago` — a batch two
  // minutes old presented as an hour stale, under its own fresh id.
  await expect(line).not.toContainText("1h 2m");
  await expect(page.getByTestId("book-stamp-freshness")).toHaveText(
    "#2 · computed 2026-07-29T10:58:05Z · 2m ago",
  );

  // And the NEW anchor is what climbs from here — the floor came with the
  // receipt, not from the receipt it replaced.
  await page.clock.fastForward(60_000);
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 3m ago");
});

test("(1) the SAME receipt re-delivered does NOT re-anchor — the age never snaps back", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  // EVERY call returns the identical envelope: same `served_at`, same batch id,
  // same `age_seconds`. A re-render over one receipt is not a new receipt.
  const only = bookTwoMinutesOld();
  let bookCalls = 0;
  await page.route("**/v1/book", (route) => {
    bookCalls += 1;
    return fulfillJson(route, only);
  });
  await routePositions(page);
  await page.goto("/book");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");

  await page.clock.setSystemTime(new Date(T0.getTime() + 3_600_000));
  await dispatchResume(page);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 2m ago");

  // The re-fetch answers with the same receipt, and React re-renders with a new
  // state object. THE ANCHOR MUST NOT MOVE: keying re-anchoring on anything the
  // render rebuilds (an object identity, a fresh array) would snap the age back
  // to 2m and hand the reader a number the page knows is too young.
  await expect.poll(() => bookCalls).toBe(2);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 2m ago");

  // The monotonic age is PRESERVED, so the next tick climbs from it.
  await page.clock.fastForward(60_000);
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 1h 3m ago");
});

// ---------------------------------------------------------------------------
// (2) MEDIUM — definitive lifecycle evidence outranks two blind clocks.
// ---------------------------------------------------------------------------

test("(2) THE ROUND-12 DEFECT: a paused monotonic clock AND a backward wall step still reconcile", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  const first = bookTwoMinutesOld();
  // DERIVED /v1/book #2: the WIRE's own account of how old the newest batch is
  // when the reader comes back — three hours and two minutes.
  const truth = nextBatchAlsoTwoMinutesOld(3 * 3600 + 130);

  let bookCalls = 0;
  await page.route("**/v1/book", (route) => {
    bookCalls += 1;
    return fulfillJson(route, bookCalls === 1 ? first : truth);
  });
  await routePositions(page);
  await page.goto("/book");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");
  expect(bookCalls).toBe(1);

  // THE ADVERSARIAL WAKE. The machine slept three hours — `performance.now()`
  // did not advance a millisecond — and on the same wake the OS corrected a
  // skewed system clock BACKWARD by three hours. Monotonic delta: zero. Wall
  // delta: negative. R4's gate saw a burst it had already handled and did
  // nothing at all.
  await page.clock.setSystemTime(new Date(T0.getTime() - 3 * 3_600_000));

  await dispatchPersistedPageshow(page);

  // THE RECOMPUTE ALONE CANNOT REPAIR THIS, and it does not pretend to: with
  // both clocks refusing to show the interval, the clamped estimate is still
  // the wire's own 120s, and the nondecreasing floor keeps the backward step
  // from making it younger. Only the WIRE knows how old the book really is —
  // which is why the reconcile path must run the re-fetch too.
  await expect.poll(() => bookCalls).toBe(2);
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 3h 2m ago");
  // THE OLD BEHAVIOUR: no reconcile, no re-fetch, and this line sat at `2m ago`
  // over a batch three hours old — stale data presented as fresh, which is the
  // direction the whole freshness law exists to prevent.
  await expect(page.getByTestId("book-loading")).toHaveCount(0);
});

test("(2) hidden→visible reconciles on sub-threshold deltas; a BARE focus does not", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  let bookCalls = 0;
  await page.route("**/v1/book", (route) => {
    bookCalls += 1;
    return fulfillJson(route, bookCalls === 1 ? bookTwoMinutesOld() : nextBatchAlsoTwoMinutesOld());
  });
  await routePositions(page);
  await page.goto("/book");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");
  expect(bookCalls).toBe(1);

  // A BARE FOCUS — a window merely raised, both clocks showing nothing. Not
  // evidence that anything was suspended, and an aggregate this size may not be
  // re-fetched every time a reader alt-tabs.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });

  // GOING AWAY is not a resume either — it is the evidence that the return is.
  await setVisibility(page, "hidden");

  // COMING BACK IS. Neither clock has moved through any of this, so the delta
  // gate would dismiss it; the transition itself is what proves it.
  await setVisibility(page, "visible");
  await expect.poll(() => bookCalls).toBe(2);
  // Exactly two: had the bare focus or the hide reconciled, this would be three
  // or four. Asserting the TOTAL after a signal that must fire is how a
  // must-not-fire is pinned without waiting on a clock.
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 2m ago");

  // The departure is CONSUMED by the reconcile it triggered: the focus that
  // follows the same return finds no evidence left and is delta-gated again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await page.clock.fastForward(60_000);
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 3m ago");
  expect(bookCalls).toBe(2);
});

test("(2) the full lifecycle burst under TWO blind clocks is still ONE re-fetch", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  await muteStream(page);

  let bookCalls = 0;
  await page.route("**/v1/book", (route) => {
    bookCalls += 1;
    return fulfillJson(route, bookCalls === 1 ? bookTwoMinutesOld() : nextBatchAlsoTwoMinutesOld());
  });
  await routePositions(page);
  await page.goto("/book");

  const line = page.getByTestId("book-freshness");
  await expect(line).toHaveText("batch #1 · computed 2026-07-29T10:00:00Z · 2m ago");

  // The tab is stowed, then restored into the adversarial wake: monotonic
  // frozen, wall stepped back. The coalescing window cannot separate these
  // three events by measuring — every delta it can take is zero or negative —
  // so the coalescing is done by CONSUMING the evidence instead.
  await setVisibility(page, "hidden");
  await page.clock.setSystemTime(new Date(T0.getTime() - 3 * 3_600_000));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(() => bookCalls).toBe(2);
  await expect(line).toHaveText("batch #2 · computed 2026-07-29T10:58:05Z · 2m ago");
  // ONE resume, ONE re-fetch — three definitive-or-not events, one reconcile.
  expect(bookCalls).toBe(2);
});
