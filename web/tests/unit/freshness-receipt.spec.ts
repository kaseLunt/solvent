// Wave R5, Codex round-12 MEDIUM (1) — A RECEIPT IS NOT ITS AGE.
//
// THE DEFECT THIS PINS: R3 anchored the wire age at receipt and R4 clamped it
// against both clocks, and BOTH keyed "is this a new receipt?" on the wire
// VALUE — `age_seconds`. A response repeating the previous number kept the old
// anchor, deliberately: of the two errors available, over-stating an age is the
// one this product may make.
//
// But `age_seconds` is an INTEGER OF SECONDS, and the resume re-fetch asks for
// a fresh batch at whatever cadence the reader's lifecycle produces. Request
// cadence and batch cadence line up — they hang off the same publishing loop —
// so batch #7 fetched two minutes after it was computed carries EXACTLY the
// number batch #6 carried two minutes after IT was computed. Under the value
// test that new receipt inherited the OLD anchor and the OLD accumulated
// interval: a batch two minutes old rendered as an hour and two minutes old,
// with no path back short of a reload. Fresh data presented as stale.
//
// The floor was only ever licensed to over-state UNTIL THE NEXT RECEIPT
// CORRECTED IT. This file pins the thing that makes the correction able to
// land: identity moves off the value and onto the receipt — `served_at`, which
// every /v1 envelope carries and which is distinct per response, folded with
// the batch id where the caller has one.
//
// The React plumbing that consumes this identity is pinned in the browser by
// tests/e2e/r5-fixes.spec.ts. This file pins the IDENTITY and the arithmetic
// that a re-anchor performs.

import { expect, test } from "@playwright/test";
import {
  anchoredAgeSeconds,
  anchorWireAge,
  humanAge,
  receiptIdentity,
  type AgeReceipt,
} from "../../lib/freshness";

/** Two responses of the SAME batch cadence, at the SAME integer age. */
const SERVED_AT_FIRST = "2026-07-29T10:00:00Z";
const SERVED_AT_SECOND = "2026-07-29T11:00:05Z";

test("THE ROUND-12 DEFECT: equal age_seconds is not equal identity", () => {
  // Batch #6 fetched two minutes old, then batch #7 fetched two minutes old.
  // The wire numbers are IDENTICAL — that is the whole finding.
  const sixth: AgeReceipt = { ageSeconds: 120, receiptId: receiptIdentity(SERVED_AT_FIRST, 6) };
  const seventh: AgeReceipt = { ageSeconds: 120, receiptId: receiptIdentity(SERVED_AT_SECOND, 7) };
  expect(seventh.ageSeconds).toBe(sixth.ageSeconds);
  expect(seventh.receiptId).not.toBe(sixth.receiptId);
});

test("`served_at` alone separates two responses describing ONE batch", () => {
  // The same batch re-served: the batch id cannot tell these apart, and the
  // envelope's own instant can.
  expect(receiptIdentity(SERVED_AT_SECOND, 6)).not.toBe(receiptIdentity(SERVED_AT_FIRST, 6));
});

test("the batch id separates two responses an equal `served_at` could not", () => {
  expect(receiptIdentity(SERVED_AT_FIRST, 7)).not.toBe(receiptIdentity(SERVED_AT_FIRST, 6));
});

test("one response re-rendered is ONE receipt — identity is stable, not incidental", () => {
  // The surfaces build this value inline on every render. If it were not a pure
  // function of the wire's own bytes, every render would look like a new
  // receipt and every render would reset the age to the wire's number — which
  // is the R3 defect (a frozen age) wearing a different hat.
  expect(receiptIdentity(SERVED_AT_FIRST, 6)).toBe(receiptIdentity(SERVED_AT_FIRST, 6));
});

test("a caller with no batch id gets the envelope's instant, verbatim", () => {
  expect(receiptIdentity(SERVED_AT_FIRST)).toBe(SERVED_AT_FIRST);
  expect(receiptIdentity(SERVED_AT_FIRST, null)).toBe(SERVED_AT_FIRST);
});

test("A NEW RECEIPT MAY LEGITIMATELY SHOW A SMALLER AGE — the floor is per-receipt", () => {
  const realPerf = performance.now;
  const realDate = Date.now;
  let mono = 1_000;
  let wall = 1_785_000_000_000;
  performance.now = () => mono;
  Date.now = () => wall;
  try {
    // Receipt #6: two minutes old, then an hour of held-open tab. The rendered
    // age climbs to 1h 2m, and inside this receipt it may never come down.
    const sixth = anchorWireAge(120);
    mono += 3_600_000;
    wall += 3_600_000;
    const climbed = anchoredAgeSeconds(sixth, performance.now(), Date.now(), 120);
    expect(climbed).toBe(3720);
    expect(humanAge(climbed)).toBe("1h 2m");
    expect(anchoredAgeSeconds(sixth, performance.now(), Date.now(), climbed)).toBe(climbed);

    // Receipt #7 lands, carrying the SAME integer age. It is a different
    // statement about a different batch, so it takes its own anchor and its own
    // floor — 2m, not 1h 2m. Refusing this is what the round-12 finding is.
    const seventh = anchorWireAge(120);
    expect(anchoredAgeSeconds(seventh, performance.now(), Date.now(), 120)).toBe(120);
    expect(humanAge(anchoredAgeSeconds(seventh, performance.now(), Date.now(), 120))).toBe("2m");

    // And the new receipt's own floor is nondecreasing from there — the R4 law
    // survives the correction it made room for.
    mono += 60_000;
    wall += 60_000;
    expect(anchoredAgeSeconds(seventh, performance.now(), Date.now(), 120)).toBe(180);
  } finally {
    performance.now = realPerf;
    Date.now = realDate;
  }
});
