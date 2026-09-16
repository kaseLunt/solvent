// Phase 1 Track B (response-boundary validation) — the render-consequence
// pins that survive on the surfaces still standing. The Track's Lab pins
// (p1b-2, p1b-3, p1b-5, p1b-6 items 7 and 8, p1b-9, p1b-10, p1b-11, p1b-12)
// were RETIRED with the Scenarios rebuild (2026-09-16, Plan 3): the classifier
// laws are unit-pinned per field in tests/unit/lab-classify-run-book.spec.ts,
// lab-classify-set-run.spec.ts and wire-guard.spec.ts, the identity welds in
// tests/unit/result-identity.spec.ts, and the render consequence — a malformed
// field is the page's own contradictory state, named, with nothing drawn and
// the route still standing — in tests/e2e/lab.spec.ts.
// Ledger: .superpowers/sdd/progress-ui-overhaul.md, "Plan 3 (Scenarios) — retirements".
//
//   p1b-6 · the identity gap audit closes (Task 6): scoped feed echoes and
//          the observatory's verbatim as-of. (Fix 4, the history batch weld,
//          and p1b-4's factor-price arms were RETIRED with the Inspector
//          rebuild (2026-09-15): the weld is tests/e2e/inspector.spec.ts
//          "history: a differing vantage is stated"; the arms are
//          tests/unit/inspector-position.spec.ts. Ledger: "Plan 2 (Inspector) — retirements".)
//
// Every corruption or variant is a structuredClone of a committed fixture with
// its documented change(s) at the site; CORS on every fulfilled cross-origin
// response, and the stream route aborted so no live posture races the pinned
// bodies.

import { expect, test } from "@playwright/test";
import { EVENTS } from "../fixtures/inspector";
import { OBSERVATORY_SERIES_AAVE } from "../fixtures/observatory";

const API = "http://localhost:8080";
const CORS = { "access-control-allow-origin": "*" };

test.describe("p1b-6 · the identity gap audit closes", () => {
  test("fix 2: a stale walk's page cannot write its filter echo over the current walk's", async ({
    page,
  }) => {
    // THE RACE, made deterministic. A response that has FULLY ARRIVED (stream
    // closed, bytes buffered) before restartWalk()'s abort fires is not
    // rejected by that abort — the page-side continuation still runs, AFTER
    // the reset, and used to write the OLD scope's filter echo under the NEW
    // walk's controls. The init-script shim below models exactly that
    // closed-stream case: it detaches the first types=borrow request from
    // the abort signal and holds its resolution under the test's control, so
    // the stale continuation runs strictly AFTER walk B's echo rendered.
    await page.route("**/v1/stream**", (route) => route.abort());
    await page.route(`${API}/v1/events*`, (route) => {
      // The wire's echo mirrors each request's own types param — two scopes,
      // two DISTINGUISHABLE echoes, from one committed body.
      const typesParam = new URL(route.request().url()).searchParams.get("types");
      const body = structuredClone(EVENTS);
      body.filter = {
        ...body.filter,
        types: (typesParam === null ? [] : typesParam.split(",")) as typeof body.filter.types,
      };
      body.next_cursor = null;
      return route.fulfill({ json: body, headers: CORS });
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __releaseHeldEvents: (() => void) | null };
      w.__releaseHeldEvents = null;
      const realFetch = window.fetch.bind(window);
      let held = false;
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (
          !held &&
          url.includes("/v1/events") &&
          url.includes("types=borrow") &&
          !url.includes("%2C")
        ) {
          held = true;
          // Detached from the abort signal: the closed-stream case, where an
          // abort arriving after full receipt has nothing left to reject.
          const settled = realFetch(url, { ...init, signal: null });
          await new Promise<void>((resolve) => {
            w.__releaseHeldEvents = resolve;
          });
          return settled;
        }
        return realFetch(input, init);
      }) as typeof window.fetch;
    });

    await page.goto("/feed");
    const foot = page.getByTestId("feed-foot");
    // The initial cross-engine walk settles first (its own echo: types all).
    await expect(foot).toContainText("types all");

    const chips = page.getByTestId("type-chips");
    // Filter change ONE: walk A (types=borrow) — its page is HELD by the shim.
    const requestA = page.waitForRequest(
      (request) => request.url().includes("types=borrow") && !request.url().includes("%2C"),
    );
    await chips.getByRole("button", { name: "borrow", exact: true }).click();
    await requestA;
    // Filter change TWO, rapidly after: walk B (types=borrow,repay), answered.
    await chips.getByRole("button", { name: "repay", exact: true }).click();
    await expect(foot).toContainText("types borrow,repay");

    // Release walk A's held page: its continuation runs AFTER the reset that
    // dropped its walk. The envelope echo must keep naming the SECOND scope.
    await page.evaluate(() => {
      (window as unknown as { __releaseHeldEvents: (() => void) | null }).__releaseHeldEvents?.();
    });
    await page.waitForTimeout(300); // the stale continuation gets its turn
    await expect(foot).toContainText("types borrow,repay");
    // The stale echo's own spelling (types borrow · since_block …) may not
    // stand anywhere in the foot.
    await expect(foot).not.toContainText("types borrow ·");
  });

  test("fix 3: the observatory head states the wire's own served_at verbatim", async ({
    page,
  }) => {
    // The rollup envelope carries served_at but NO age_seconds (recorded
    // decision): no anchored age exists, no tick runs, and a browser-clock
    // age would violate freshness law 1. The wire's own instant renders
    // verbatim at the head.
    await page.route("**/v1/stream**", (route) => route.abort());
    await page.route("**/v1/observatory/series*", (route) =>
      route.fulfill({ json: OBSERVATORY_SERIES_AAVE, headers: CORS }),
    );
    await page.goto("/observatory");
    await expect(page.getByTestId("observatory-as-of")).toHaveText(
      `as of ${OBSERVATORY_SERIES_AAVE.served_at}`,
    );
  });
});
