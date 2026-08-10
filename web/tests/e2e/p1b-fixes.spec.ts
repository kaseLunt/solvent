// Phase 1 Track B (response-boundary validation) — the render-consequence
// pins, one section per fix, each tagged p1b-N:
//   p1b-0 · honest route refusal: no error.tsx existed anywhere under
//          web/app, so a render throw (e.g. a wire Decimal outside the
//          contract reaching a throwing money renderer) replaced the entire
//          route — header included — with Next's generic "Application error"
//          page. The root boundary now renders the house refusal register:
//          the throw is named, nothing is claimed, and the header/nav stay
//          mounted because error.tsx replaces only the segment below
//          layout.tsx.
//
// Mock shapes and fixture modules are reused from p0-fixes.spec.ts (its
// mockBookSurface, itself book.spec.ts's shape): typed TS fixtures from
// tests/fixtures/book.ts, CORS on every fulfilled cross-origin response, and
// the stream route aborted so no live posture races the pinned bodies.

import { expect, test, type Page } from "@playwright/test";
import type { components } from "@solvent/client";
import {
  BOOK,
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

const CORS = { "access-control-allow-origin": "*" };

type BookBody = components["schemas"]["BookResponse"];

/**
 * The book.spec.ts mock shape (as reused by p0-fixes.spec.ts's
 * mockBookSurface), parameterized over the /v1/book body so a test can serve
 * a documented single-field corruption: stream aborted, book body pinned,
 * cursor-aware positions pages.
 */
async function mockBookWith(page: Page, book: BookBody) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => route.fulfill({ json: book, headers: CORS }));
  await page.route("**/v1/positions*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("engine") === "debt_manager") {
      return route.fulfill({ json: POSITIONS_DM_PAGE_1, headers: CORS });
    }
    if (url.searchParams.get("cursor") === null) {
      return route.fulfill({ json: POSITIONS_AAVE_PAGE_1, headers: CORS });
    }
    return route.fulfill({ json: POSITIONS_AAVE_PAGE_2, headers: CORS });
  });
}

test.describe("p1b-0 · honest route refusal", () => {
  test("a render throw shows the refusal register, not the generic error page", async ({ page }) => {
    // Single documented change to the committed /v1/book fixture, serving ONE
    // purpose (the route-boundary arm): engines[0]'s (aave_v3_etherfi)
    // aggregate total_debt set to "" — outside the wire Decimal contract
    // (api/openapi.yaml `Decimal`: ^-?[0-9]+$). Today this reaches
    // renderEngineAmount in BookStatRows' total-debt stat row, which throws
    // DecimalFormatError and white-pages /book. Everything else
    // byte-identical.
    const body = structuredClone(BOOK);
    // noUncheckedIndexedAccess: narrow with a THROWING guard — a missing
    // first engine is a broken fixture, never a variant to skip silently.
    const agg = body.engines[0];
    if (!agg) throw new Error("fixture shape: engines[0] missing");
    agg.total_debt = "";
    await mockBookWith(page, body);
    await page.goto("/book");
    const refusal = page.getByTestId("route-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("refused to render");
    await expect(refusal).toContainText("Nothing is claimed");
    // the reset affordance is part of the register: a refusal that cannot be
    // retried is a dead end, not a disclosure
    await expect(refusal.getByRole("button", { name: "try again" })).toBeVisible();
    // the register is ours, not Next's generic page — both copies pinned
    // absent: the classic "Application error" body and THIS Next version's
    // observed generic heading (the recorded red run's page snapshot renders
    // heading "This page couldn’t load" + Reload/Back)
    await expect(page.getByText("Application error: a client-side exception")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "This page couldn’t load" })).toHaveCount(0);
    // the app-router boundary replaces the SEGMENT below layout.tsx, so the
    // header stays mounted — the refusal is scoped to the view that earned it
    await expect(page.getByRole("banner")).toBeVisible();
  });
});
