// Wave R1 item 3 — batch freshness, pinned.
//
// Laws under test:
//   - the age comes from the WIRE's `age_seconds`, never recomputed from
//     `computed_at` against a browser clock;
//   - `computed_at` renders VERBATIM — no locale reformatting;
//   - the ribbon suffix appears ONLY past the hour threshold, and its absence
//     is not a freshness claim.

import { expect, test } from "@playwright/test";
import {
  AGE_TICK_MS,
  ageHours,
  anchoredAgeSeconds,
  anchorWireAge,
  batchFreshnessLine,
  batchFreshnessStamp,
  humanAge,
  monotonicNowMs,
  RIBBON_STALE_BATCH_SECONDS,
  ribbonBatchAgeSuffix,
} from "../../lib/freshness";

/**
 * A FAKE CLOCK FOR A NORMALLY-RUNNING TAB. `anchorWireAge` /
 * `anchoredAgeSeconds` read `performance.now()` — the monotonic reading, which
 * is still the primary source — and, since Wave R4, `Date.now()` as the sleep
 * fallback. A tab that is awake sees both advance TOGETHER, which is what this
 * lever does; every assertion below is therefore unchanged from R3.
 *
 * The cases where the two clocks DISAGREE — system sleep, bfcache, a stepped
 * wall clock — are the round-11 finding and live in freshness-resume.spec.ts,
 * which drives them independently.
 */
function withFakeClock(run: (advanceMs: (ms: number) => void) => void): void {
  const realPerf = performance.now;
  const realDate = Date.now;
  let t = 1_000;
  let wall = 1_785_000_000_000;
  performance.now = () => t;
  Date.now = () => wall;
  try {
    run((ms) => {
      t += ms;
      wall += ms;
    });
  } finally {
    performance.now = realPerf;
    Date.now = realDate;
  }
}

test("humanAge degrades honestly — seconds, minutes, then hours+minutes", () => {
  expect(humanAge(0)).toBe("0s");
  expect(humanAge(5)).toBe("5s");
  expect(humanAge(59)).toBe("59s");
  expect(humanAge(60)).toBe("1m");
  expect(humanAge(3599)).toBe("59m");
  expect(humanAge(3600)).toBe("1h 0m");
  expect(humanAge(87902)).toBe("24h 25m");
});

test("a negative age floors at zero rather than rendering a future batch", () => {
  expect(humanAge(-10)).toBe("0s");
  expect(ageHours(-10)).toBe(0);
});

test("the freshness line carries the batch id, the VERBATIM computed_at, and the wire age", () => {
  const batch = { id: 5, computed_at: "2026-08-01T19:23:59.612187Z", age_seconds: 87902 };
  expect(batchFreshnessLine(batch)).toBe(
    "batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago",
  );
  // The stampline form is the SAME sentence minus the word its label supplies.
  expect(batchFreshnessLine(batch)).toBe(`batch ${batchFreshnessStamp(batch)}`);
});

test("computed_at is never reformatted — the service's own string survives", () => {
  const odd = { id: 1, computed_at: "2026-07-29T10:00:00Z", age_seconds: 0 };
  expect(batchFreshnessLine(odd)).toContain("2026-07-29T10:00:00Z");
});

test("the ribbon suffix is absent inside the hour and present past it", () => {
  expect(RIBBON_STALE_BATCH_SECONDS).toBe(3600);
  expect(ribbonBatchAgeSuffix(0)).toBeNull();
  expect(ribbonBatchAgeSuffix(3600)).toBeNull();
  expect(ribbonBatchAgeSuffix(3601)).toBe("· batch 1h old");
  expect(ribbonBatchAgeSuffix(87902)).toBe("· batch 24h old");
});

// ---------------------------------------------------------------------------
// WAVE R3, Codex round-10 MEDIUM: the age was FROZEN at the wire value.
//
// `age_seconds` is a true statement about the instant the response was built.
// Rendering it forever turns it into a false one: a tab left open for six
// hours kept saying "2m ago". The wire age is now ANCHORED at receipt against
// the MONOTONIC clock (`performance.now()`, never `Date.now()` — a wall clock
// can be stepped by NTP or by sleep/resume, and a stepped clock would make an
// age jump or run backwards), and what renders is `wireAge + elapsed`.
//
// Law 1 of this module is UNCHANGED and is the reason the anchor is additive:
// the age still ORIGINATES in the wire (the database clock), never in a
// browser clock. The browser only measures the interval SINCE it was handed
// that number — a duration, not a timestamp.
// ---------------------------------------------------------------------------

test("the anchored age ADVANCES with the monotonic clock instead of freezing", () => {
  withFakeClock((advance) => {
    const anchor = anchorWireAge(120);
    expect(anchoredAgeSeconds(anchor)).toBe(120);
    advance(60_000);
    expect(anchoredAgeSeconds(anchor)).toBe(180);
    advance(3_600_000);
    expect(anchoredAgeSeconds(anchor)).toBe(3780);
  });
});

test("the anchor reads the MONOTONIC clock — `monotonicNowMs` is performance.now", () => {
  withFakeClock((advance) => {
    expect(monotonicNowMs()).toBe(1_000);
    advance(500);
    expect(monotonicNowMs()).toBe(1_500);
    // Anchoring twice at the same instant yields the same receipt reading.
    expect(anchorWireAge(7).receivedAtMs).toBe(1_500);
    expect(anchorWireAge(7).wireAgeSeconds).toBe(7);
  });
});

test("a monotonic reading that goes BACKWARDS never rewinds the age", () => {
  // Wave R4: the anchor carries BOTH receipt readings, so both must be handed
  // to the pure function here. The wall reading is held at the receipt value,
  // which isolates the monotonic behaviour this case is about.
  const anchor = { wireAgeSeconds: 300, receivedAtMs: 10_000, receivedAtWallMs: 500_000 };
  // Elapsed floors at zero: an age is never rendered younger than the wire's.
  expect(anchoredAgeSeconds(anchor, 9_000, 500_000)).toBe(300);
  expect(anchoredAgeSeconds(anchor, 10_000, 500_000)).toBe(300);
  expect(anchoredAgeSeconds(anchor, 11_500, 500_000)).toBe(301.5);
});

test("the MINUTE boundary is crossed while the page is open", () => {
  withFakeClock((advance) => {
    const anchor = anchorWireAge(59);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("59s");
    advance(AGE_TICK_MS);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("1m");
    advance(AGE_TICK_MS);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("2m");
  });
});

test("the HOUR boundary is crossed while the page is open", () => {
  withFakeClock((advance) => {
    const anchor = anchorWireAge(3599);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("59m");
    advance(AGE_TICK_MS);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("1h 0m");
    advance(59 * AGE_TICK_MS);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("1h 59m");
  });
});

test("THE RIBBON ENGAGES: the stale-batch suffix appears as the anchor crosses 1h", () => {
  withFakeClock((advance) => {
    // Received 50s inside the threshold — nothing to say yet.
    const anchor = anchorWireAge(RIBBON_STALE_BATCH_SECONDS - 50);
    expect(ribbonBatchAgeSuffix(anchoredAgeSeconds(anchor))).toBeNull();
    // One tick later the batch really IS over an hour old, and says so.
    advance(AGE_TICK_MS);
    expect(anchoredAgeSeconds(anchor)).toBe(3610);
    expect(ribbonBatchAgeSuffix(anchoredAgeSeconds(anchor))).toBe("· batch 1h old");
    // And it keeps counting: 23 more hours of an open tab.
    advance(23 * 3_600_000);
    expect(ribbonBatchAgeSuffix(anchoredAgeSeconds(anchor))).toBe("· batch 24h old");
    expect(ageHours(anchoredAgeSeconds(anchor))).toBe(24);
  });
});

test("the tick is a minute — coarse enough for a text age, fine enough for every boundary", () => {
  expect(AGE_TICK_MS).toBe(60_000);
});

test("the rendered stamp carries the ANCHORED age, and computed_at stays verbatim", () => {
  withFakeClock((advance) => {
    const batch = { id: 5, computed_at: "2026-08-01T19:23:59.612187Z", age_seconds: 87902 };
    const anchor = anchorWireAge(batch.age_seconds);
    // At receipt the sentence is exactly the one the wire licenses.
    expect(batchFreshnessLine(batch, anchoredAgeSeconds(anchor))).toBe(
      "batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago",
    );
    // Ten minutes on a desk, and the sentence has MOVED.
    advance(10 * AGE_TICK_MS);
    expect(batchFreshnessLine(batch, anchoredAgeSeconds(anchor))).toBe(
      "batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 35m ago",
    );
    expect(batchFreshnessStamp(batch, anchoredAgeSeconds(anchor))).toBe(
      "#5 · computed 2026-08-01T19:23:59.612187Z · 24h 35m ago",
    );
    // The timestamp itself never moves — only the elapsed statement does.
    expect(batchFreshnessLine(batch, anchoredAgeSeconds(anchor))).toContain(
      "2026-08-01T19:23:59.612187Z",
    );
  });
});

test("omitting the anchored age falls back to the WIRE age — the old callers stay honest", () => {
  const batch = { id: 5, computed_at: "2026-08-01T19:23:59.612187Z", age_seconds: 87902 };
  expect(batchFreshnessLine(batch)).toBe(
    "batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago",
  );
  expect(batchFreshnessStamp(batch)).toBe(
    "#5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago",
  );
});
