// WAVE R7 (Codex round-15) e2e — pinned in the browser against the production
// build, with the API mocked from the committed fixtures. Every mutation below
// is a structuredClone delta documented at its call site.
//
// What this file pins, finding by finding:
//
//   (1) HIGH   — `normalizeBookQuery` SILENTLY REWROTE every `?sort=liq_distance`
//                Book link onto the Headroom column. On `debt_manager` those are
//                DIFFERENT ORDERINGS — absolute USD room versus the ratio — so an
//                honest reader's bookmark was served a different account sequence
//                with no acknowledgment anywhere on the page. The fix HONORS the
//                link: the ordering the service serves is the ordering the table
//                shows, the register NAMES it in reader words, no column header
//                claims it, and the first click of any sort control moves to that
//                column and rewrites the URL.
//
//   (3) MEDIUM — the unavailable branch printed `stale_since_seconds` verbatim.
//                The server emits it ONCE and LATCHES, and the provider clears
//                `batch` on that frame, so no receipt, no anchor and no repair
//                existed for it: "stale 42s" could stand for hours, and a blind
//                resume across it never entered the unknown register. It is an
//                AGE, and it now gets the R5/R6 machinery — its own receipt from
//                its own `served_at`, a ticking clamped number, the unknown
//                register on a blind resume, and `usePostureRefresh` as its
//                repair.
//
//   (4) MEDIUM — `LIVE · WATERMARKED` was painted from `(batch retained &&
//                !unavailable)` alone. Neither half says anything about the
//                CONNECTION, and the batch is retained across a teardown on
//                purpose — so after `refresh()` (which is R6's own repair) a
//                reconnect that hung left LIVE over a dead stream indefinitely.
//                LIVE now requires the CURRENT connection to be open WITH its
//                base delivered; anything else renders the stream's own posture
//                over the SAME retained data and the SAME age disclosure.
//
// A NOTE ON THE STREAM MOCKS. `route.fulfill` sends a COMPLETE response, which
// to an SSE client is a server hanging up — the connection is open for
// microseconds and then dead. That is fine for asserting what a frame's DATA
// renders as, and it is what every earlier suite does. It cannot pin liveness,
// because there is never a live connection to observe. Finding (4) is therefore
// driven against a REAL SSE SERVER started in this file, whose connections are
// held open and released frame by frame under the test's control.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_AAVE_PAGE_1, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

const CORS = { "access-control-allow-origin": "*" };

/** The instant the fake clock is installed at. Chosen, not inherited. */
const T0 = new Date("2026-08-01T12:00:00Z");

/** The suspend the two clocks conspire to hide (as in R6). */
const THREE_HOURS_MS = 3 * 3_600_000;

/** The house register for a duration the page cannot state (lib/freshness.ts). */
const REFRESHING = "UNKNOWN since resume · refreshing";

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** ONLY the bfcache restore — the definitive signal, isolated from the burst. */
async function dispatchPersistedPageshow(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
}

/**
 * THE ADVERSARIAL WAKE (R6's, unchanged): the machine slept three hours — so
 * `performance.now()` did not advance a millisecond — and the OS corrected a
 * skewed system clock BACKWARD by the same interval on that wake. Monotonic
 * delta: zero. Wall delta: negative. Neither clock certifies a second of it.
 */
async function blindWake(page: Page): Promise<void> {
  await page.clock.setSystemTime(new Date(T0.getTime() - THREE_HOURS_MS));
  await dispatchPersistedPageshow(page);
}

// ===========================================================================
// (1) HIGH — an honored `liq_distance` deep link, over a book where the two
//            rankings genuinely DISAGREE.
// ===========================================================================

/**
 * DERIVED DM rows: a pair chosen so `liq_distance` and `headroom` produce the
 * EXACT REVERSE of each other. This is the whole finding — if the two keys
 * agreed, the silent rewrite would have cost the reader nothing.
 *
 *   WHALE   maxBorrowLT 10,000,000 · borrowings 9,800,000
 *           → absolute room   200,000   (far from the boundary in dollars)
 *           → headroom          2%      (nearly out of capacity)
 *   SHRIMP  maxBorrowLT   100,000 · borrowings    50,000
 *           → absolute room    50,000   (nearest the boundary in dollars)
 *           → headroom         50%      (half its capacity unused)
 *
 * `liq_distance` asc (nearest the boundary first, ABSOLUTE): SHRIMP, WHALE.
 * `headroom`     asc (least capacity left first, RATIO):     WHALE, SHRIMP.
 *
 * Every other byte is the committed fixture's canonical DM row.
 */
function dmRow(account: string, num: string, den: string, collateral: string, debt: string) {
  const canonical = POSITIONS_DM_PAGE_1.positions[0];
  if (canonical === undefined) throw new Error("fixture shape drifted");
  const row = structuredClone(canonical);
  row.account = account;
  row.status = "computed";
  row.refusal = null;
  row.flags = [];
  // `health_factor` is NULLABLE on the wire, and the canonical DM row publishes
  // one — if that ever stops being true this fixture is describing a row the
  // service no longer serves, and it should fail here rather than quietly
  // produce a book with no ratios in it.
  const hf = row.health_factor;
  if (hf === null) throw new Error("fixture shape drifted: the DM row lost its health_factor");
  // Mutated field by field: the fixture's own `note` (the DM's num/den
  // disclosure) is left exactly as the service publishes it.
  hf.wad = null;
  hf.num = num;
  hf.den = den;
  hf.infinite = false;
  // Neither row is past its boundary: this test is about ORDER, not verdicts.
  row.liquidatable = false;
  row.total_collateral = collateral;
  row.total_debt = debt;
  row.liq_distance = {
    kind: "none",
    scale_factor_num: null,
    scale_factor_den: null,
    factor_asset: null,
    reason: null,
  };
  return row;
}

const WHALE = "0xEeEe000000000000000000000000000000000001";
const SHRIMP = "0xFfFf000000000000000000000000000000000002";

/** The page the SERVICE serves for a given sort — the two disagreeing orders. */
function dmPage(sort: "liq_distance" | "headroom") {
  const page = structuredClone(POSITIONS_DM_PAGE_1);
  const whale = dmRow(WHALE, "10000000000000", "9800000000000", "12000000000000", "9800000000000");
  const shrimp = dmRow(SHRIMP, "100000000000", "50000000000", "120000000000", "50000000000");
  page.sort = sort;
  page.positions = sort === "liq_distance" ? [shrimp, whale] : [whale, shrimp];
  page.total_positions = 2;
  page.next_cursor = null;
  return page;
}

test("(1) AN HONORED liq_distance LINK: the ordering the link names is the ordering served, and the page SAYS SO", async ({
  page,
}) => {
  const sorts: (string | null)[] = [];
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("engine") !== "debt_manager") {
      return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    }
    const sort = url.searchParams.get("sort");
    sorts.push(sort);
    return fulfillJson(route, dmPage(sort === "headroom" ? "headroom" : "liq_distance"));
  });

  await page.goto("/book?engine=debt_manager&sort=liq_distance");

  // THE REQUEST CARRIES THE LINK'S OWN KEY. Under the old normalizer this was
  // `headroom` on every one of these — the rewrite happened before the first
  // fetch, so the reader never saw the ordering they had bookmarked.
  await expect.poll(() => sorts).toContain("liq_distance");
  expect(sorts).not.toContain("headroom");

  // AND THE ROWS ARE IN THAT ORDER: absolute room ascending. SHRIMP (50% of a
  // small capacity, but only $50k of room) leads WHALE (2% of a large one, and
  // $200k of room). Under the Headroom ranking these two are the other way
  // round — which is exactly what made the silent rewrite a different book.
  // W-3L (LAW-5): the price-path arm now renders a VISIBLE marker beside the
  // headroom reading. It used to exist only inside the cell's `title`, which
  // put the `distance` arm's NUMBER nowhere a keyboard reader could reach.
  const headroomCells = page.getByTestId("headroom-value");
  await expect(headroomCells).toHaveCount(2);
  await expect(headroomCells.nth(0)).toHaveText("50% ≥50% · no solve");
  await expect(headroomCells.nth(1)).toHaveText("2% 2–5% · no solve");

  // THE REGISTER NAMES WHAT IS APPLIED, in reader words rather than a wire
  // token, and says plainly that it is not the ratio the column prints.
  const register = page.getByTestId("legacy-sort-register");
  await expect(register).toContainText("absolute room to the boundary");
  await expect(register).toContainText("deprecated");
  await expect(register).toContainText("NOT the Headroom");
  // NOTHING WAS REMAPPED, so the remap acknowledgment is not borrowed for this.
  await expect(page.getByTestId("sort-remap-ack")).toHaveCount(0);

  // THE FOOTER NAMES IT TOO, with its direction.
  await expect(page.getByTestId("positions-accounting")).toContainText(
    "sort liq_distance (absolute room to the boundary) ▲",
  );

  // AND NO COLUMN HEADER CLAIMS THIS ORDER. The Headroom header is still a
  // button — clicking it is how the reader leaves — but it carries no aria-sort
  // and no glyph, because the rows are not ranked by the number under it. This
  // is the assertion that keeps the header from silently lying.
  const positions = page.getByRole("table", { name: "positions for debt_manager" });
  const headroomHeader = positions.getByRole("columnheader", { name: "Headroom" });
  await expect(headroomHeader).not.toHaveAttribute("aria-sort", "ascending");
  await expect(headroomHeader).not.toHaveAttribute("aria-sort", "descending");
  // Nor does any OTHER header borrow the indicator: the honored ranking is not
  // any column's, so the table shows no active sort at all.
  await expect(
    positions.getByRole("columnheader", { name: "Debt", exact: true }),
  ).not.toHaveAttribute("aria-sort", "descending");

  // THE URL IS NOT REWRITTEN: it keeps saying what the table is doing, which is
  // only honest because the table is doing what it says.
  expect(new URL(page.url()).searchParams.get("sort")).toBe("liq_distance");

  // ---- ONE CLICK LEAVES IT ------------------------------------------------
  await positions.getByRole("button", { name: "Headroom" }).click();

  // The table asks for the column's own key...
  await expect.poll(() => sorts).toContain("headroom");
  // ...the rows arrive in the RATIO order, which is the reverse of the above...
  await expect(headroomCells.nth(0)).toHaveText("2% 2–5% · no solve");
  await expect(headroomCells.nth(1)).toHaveText("50% ≥50% · no solve");
  // ...the header now carries the indicator it had refused to carry...
  await expect(headroomHeader).toHaveAttribute("aria-sort", "ascending");
  // ...the register is gone, because the ranking it described is gone...
  await expect(page.getByTestId("legacy-sort-register")).toHaveCount(0);
  await expect(page.getByTestId("positions-accounting")).toContainText("sort headroom ▲");
  // ...and THE URL FOLLOWED THE CONTROL. `headroom` is the default sort and
  // defaults are omitted, so the deprecated token is simply gone: the UI
  // honors these links and never mints a new one.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBeNull();
});

test("(1) the honored ordering survives an ENGINE toggle — a book switch is not a sort control", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    const sort = url.searchParams.get("sort");
    if (sort !== null) requests.push(`${String(engine)}:${sort}`);
    if (engine !== "debt_manager") return fulfillJson(route, POSITIONS_AAVE_PAGE_1);
    return fulfillJson(route, dmPage(sort === "headroom" ? "headroom" : "liq_distance"));
  });

  await page.goto("/book?engine=debt_manager&sort=liq_distance");
  await expect(page.getByTestId("legacy-sort-register")).toBeVisible();

  // 1.5.0 defines `liq_distance` on BOTH engines, so switching books cannot
  // strand it — and re-ranking a reader who only asked to change engines would
  // be the same silent substitution this wave removes.
  await page.getByRole("button", { name: "aave_v3_etherfi", exact: true }).click();
  await expect.poll(() => requests).toContain("aave_v3_etherfi:liq_distance");
  await expect(page.getByTestId("legacy-sort-register")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("sort")).toBe("liq_distance");
  // And no remap acknowledgment is raised: nothing was remapped.
  await expect(page.getByTestId("sort-remap-ack")).toHaveCount(0);
});

// ===========================================================================
// (3) MEDIUM — `stale_since_seconds` is an AGE.
// ===========================================================================

/** An SSE `unavailable` frame carrying the server's OWN staleness statement. */
function unavailableFrame(servedAt: string, staleSinceSeconds: number): string {
  return `event: unavailable\ndata: ${JSON.stringify({
    served_at: servedAt,
    batch: null,
    reason: "no complete risk batch is available",
    stale_since_seconds: staleSinceSeconds,
    last_good_batch_id: 1,
  })}\n\n`;
}

async function routeBookAndPositions(page: Page): Promise<void> {
  await page.route("**/v1/book", (route) => fulfillJson(route, BOOK));
  await page.route("**/v1/positions*", (route) => fulfillJson(route, POSITIONS_AAVE_PAGE_1));
}

test("(3) THE STALENESS DURATION CLIMBS: a latched wire integer is no longer frozen on screen", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });
  // Every connection serves the SAME receipt (same `served_at`, same
  // last-good batch), so nothing here can be repaired by a re-fetch and the
  // number on screen is purely what the anchor licenses. THE OLD BEHAVIOUR was
  // "stale 42s" for as long as the tab stayed open.
  const frame = unavailableFrame("2026-07-29T10:00:05Z", 42);
  await page.route("**/v1/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: frame,
    }),
  );
  await routeBookAndPositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  const header = page.getByRole("banner");
  await expect(header.getByText("NO SERVABLE BATCH")).toBeVisible();
  const stale = page.getByTestId("ribbon-stale-since");
  await expect(stale).toHaveText("stale for 42s");

  // Two minutes of a tab left open, and the sentence has MOVED.
  await page.clock.fastForward(120_000);
  await expect(stale).toHaveText("stale for 2m");

  // An hour more, still climbing — it never re-freezes, and it never goes
  // backwards.
  await page.clock.fastForward(3_600_000);
  await expect(stale).toHaveText("stale for 1h 2m");
  await expect(stale).not.toContainText("42s");
  // The service's own statement is still the badge; the duration beside it is
  // the only thing this wave changed.
  await expect(header.getByText("NO SERVABLE BATCH")).toBeVisible();
});

test("(3) A BLIND RESUME OVER AN UNAVAILABLE FRAME: the duration goes UNKNOWN, and a reconnect repairs it", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });

  let connections = 0;
  let releaseRepair: () => void = () => undefined;
  const repairHeld = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });
  await page.route("**/v1/stream**", async (route) => {
    connections += 1;
    const frame = (body: string) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream" },
        body,
      });
    if (connections === 1) {
      await frame(unavailableFrame("2026-07-29T10:00:05Z", 42));
      return;
    }
    // HELD, so the unknown register can be asserted while the repair the ribbon
    // itself triggered is genuinely in flight.
    await repairHeld;
    // THE REPAIR: a DIFFERENT receipt (its own `served_at`) carrying the
    // service's own account of how long it has been without a batch now that
    // the reader is back — three hours more than it said before.
    await frame(unavailableFrame("2026-07-29T13:00:15Z", THREE_HOURS_MS / 1000 + 42));
  });
  await routeBookAndPositions(page);
  await page.goto("/book?engine=aave_v3_etherfi");

  const header = page.getByRole("banner");
  await expect(page.getByTestId("ribbon-stale-since")).toHaveText("stale for 42s");
  expect(connections).toBe(1);

  await blindWake(page);

  // THE FIX. The duration is not restated as 42s and is not restated at all.
  // THE OLD BEHAVIOUR was "stale 42s" standing over a service that had been
  // down for three hours and change, with nothing on the page able to say so.
  await expect(page.getByTestId("ribbon-stale-unknown")).toHaveText(`stale for ${REFRESHING}`);
  await expect(page.getByTestId("ribbon-stale-since")).toHaveCount(0);
  // NOT A ZERO, NOT A FRESHNESS CLAIM, and not a staleness verdict either: the
  // page does not know how long, only that it cannot say.
  await expect(page.getByTestId("ribbon-stale-unknown")).not.toContainText("42");
  await expect(header.getByText("NO SERVABLE BATCH")).toBeVisible();
  await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);

  // AND THE REPAIR IS REAL, and it is the SAME repair the live branch uses: the
  // ribbon owns no fetch, so it reconnected the stream, which obliges the
  // contract's snapshot-on-connect. THE OLD BEHAVIOUR was one connection
  // forever and a number that could never be restated.
  await expect.poll(() => connections).toBe(2);

  // THE REPAIR LANDS. A new receipt is the only thing that discharges an
  // unknown, and the duration it brings is the wire's own.
  releaseRepair();
  await expect(page.getByTestId("ribbon-stale-since")).toHaveText("stale for 3h 0m");
  await expect(page.getByTestId("ribbon-stale-unknown")).toHaveCount(0);
});

// ===========================================================================
// (4) MEDIUM — LIVE is a claim about the CURRENT connection.
//
// Driven against a real SSE server: `route.fulfill` cannot hold a connection
// open, and a stream that hangs up the instant it delivers its snapshot has no
// liveness to observe. `route.continue({ url })` sends the page's own stream
// request to this server, so the transport, the frames and the teardown are all
// real; only the destination is redirected.
// ===========================================================================

interface StreamHarness {
  readonly url: string;
  connections(): number;
  close(): Promise<void>;
}

/** Start an SSE server whose connections are held open under the test's control. */
async function startStreamServer(
  onConnect: (connection: number, res: ServerResponse) => void,
): Promise<StreamHarness> {
  let count = 0;
  const live = new Set<ServerResponse>();
  const server: Server = createServer((_request, response) => {
    count += 1;
    live.add(response);
    response.on("close", () => live.delete(response));
    onConnect(count, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/v1/stream`,
    connections: () => count,
    close: async () => {
      for (const response of live) response.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** Accept the connection and flush headers — OPEN, with no base frame yet. */
function openWithoutBase(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    ...CORS,
  });
  // A heartbeat COMMENT: the transport sees a live connection with nothing said
  // on it. It cannot establish a base — that is the whole point of this state.
  response.write(": heartbeat 1785000000\n\n");
}

/** A snapshot frame at a chosen receipt and age. Every other byte is the fixture's. */
function snapshotFrame(servedAt: string, ageSeconds: number): string {
  const payload = structuredClone(FEED_POSTURE_SNAPSHOT);
  if (payload.batch === null || payload.batch === undefined) {
    throw new Error("fixture shape drifted");
  }
  payload.served_at = servedAt;
  payload.batch.age_seconds = ageSeconds;
  return `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
}

test("(4) A HUNG RECONNECT NEVER LEAVES LIVE PAINTED — and the base frame is what restores it", async ({
  page,
}) => {
  await page.clock.install({ time: T0 });

  const second = { response: null as ServerResponse | null };
  const harness = await startStreamServer((connection, response) => {
    openWithoutBase(response);
    if (connection === 1) {
      // 130s — well inside the ribbon's 1h threshold, so the stale suffix is
      // correctly silent at receipt and cannot be what this test is reading.
      response.write(snapshotFrame("2026-07-29T10:00:05Z", 130));
      return;
    }
    // EVERY LATER CONNECTION IS ACCEPTED AND SAYS NOTHING. HTTP 200, a live
    // socket, no base frame — the exact shape of a reconnect that is not
    // working, and the exact reason `open` alone is not evidence of liveness.
    second.response = response;
  });

  try {
    await page.route("**/v1/stream**", (route) => route.continue({ url: harness.url }));
    await routeBookAndPositions(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const header = page.getByRole("banner");
    // A GENUINELY LIVE CONNECTION: open, and its base delivered. This is the
    // only condition under which the green chip is honest, and it is the only
    // place in the suite where it can be observed at all.
    await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
    await expect(header.getByText("@25,635,618")).toBeVisible();
    await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);
    expect(harness.connections()).toBe(1);

    // The blind wake makes the age unknown, and R6's repair tears the stream
    // down and reopens it. THAT is the path this finding lives on: the repair
    // for one dishonesty used to create another.
    await blindWake(page);
    await expect.poll(() => harness.connections()).toBe(2);

    // THE FIX. Connection 2 is open and has delivered nothing, so LIVE is
    // withdrawn and the ribbon names the posture it actually has. THE OLD
    // BEHAVIOUR was `LIVE · WATERMARKED` here, indefinitely, over a stream that
    // never came back.
    await expect(header.getByText("STREAM · AWAITING BASE")).toBeVisible();
    await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);

    // AND THE READER KEEPS EVERYTHING ELSE. The watermark vector, the batch,
    // and the age disclosure all stay exactly where they were — losing the
    // connection must not also cost the reader their book, and the age is
    // disclosed as UNKNOWN rather than as the understated number.
    await expect(header.getByText("@25,635,618")).toBeVisible();
    await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveText(
      `· batch age ${REFRESHING}`,
    );
    await expect(page.getByRole("table", { name: "positions for aave_v3_etherfi" })).toBeVisible();

    // ---- THE BASE FRAME IS WHAT RESTORES LIVE ---------------------------
    // Same socket, same `open` state — the ONLY thing that changes is that the
    // connection finally delivers a base. LIVE returns at that instant and not
    // before, which is the half of the test that proves the fix is a test on
    // `hasBase` and not merely on the socket.
    const held = second.response;
    if (held === null) throw new Error("the reconnect never reached the server");
    held.write(snapshotFrame("2026-07-29T13:00:15Z", THREE_HOURS_MS / 1000 + 130));

    await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
    // The new receipt discharges the unknown age in the same breath, and the
    // suffix the ribbon could not compute a moment ago says three hours.
    await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 3h old");
    await expect(page.getByTestId("ribbon-batch-age-unknown")).toHaveCount(0);
    // ONE reconnect for this repair: the successful attempt ended the schedule.
    expect(harness.connections()).toBe(2);
  } finally {
    await harness.close();
  }
});

test("(4) A SERVER THAT HANGS UP TAKES LIVE WITH IT — and nothing else", async ({ page }) => {
  await page.clock.install({ time: T0 });

  const first = { response: null as ServerResponse | null };
  const harness = await startStreamServer((connection, response) => {
    openWithoutBase(response);
    if (connection === 1) {
      // 3550s — fifty seconds inside the hour, so the stale suffix is silent at
      // receipt and ENGAGES on the first tick. It has to survive the hang-up.
      response.write(snapshotFrame("2026-07-29T10:00:05Z", 3550));
      first.response = response;
    }
    // Connection 2 is accepted and never speaks. The client's own backoff is
    // parked by the fake clock, so the posture below is stable rather than
    // cycling.
  });

  try {
    await page.route("**/v1/stream**", (route) => route.continue({ url: harness.url }));
    await routeBookAndPositions(page);
    await page.goto("/book?engine=aave_v3_etherfi");

    const header = page.getByRole("banner");
    await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();
    await expect(page.getByTestId("ribbon-batch-age")).toHaveCount(0);

    // THE SERVER HANGS UP. Nothing about the reader's data changed; only the
    // connection did.
    first.response?.end();

    // LIVE IS WITHDRAWN — this is a live→dead transition observed for real,
    // which is the state the finding says must never keep the green chip.
    await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
    await expect(
      header.getByText(/STREAM · (RECONNECTING|CONNECTING|AWAITING BASE|CLOSED)/),
    ).toBeVisible();

    // AND NOTHING ELSE IS TAKEN. The watermark vector is still the batch's, the
    // table is still the reader's, and the batch AGE still ticks and still
    // engages its threshold — a dead connection is not a reason to stop telling
    // the reader how old their data is.
    await expect(header.getByText("@25,635,618")).toBeVisible();
    await expect(page.getByRole("table", { name: "positions for aave_v3_etherfi" })).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(page.getByTestId("ribbon-batch-age")).toHaveText("· batch 1h old");
    await expect(header.getByText("LIVE · WATERMARKED")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
