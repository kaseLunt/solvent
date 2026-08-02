// Wave R4, Codex round-11 MEDIUM — THE MONOTONIC CLOCK IS NOT ENOUGH.
//
// THE DEFECT THIS PINS: Wave R3 anchored the wire age to `performance.now()`
// alone, on the reasoning that a monotonic clock cannot be stepped. True — but
// it can be PAUSED. `performance.now()` stops advancing while the machine is
// suspended (WebKit bug 225610, Mozilla bug 1709767), and a bfcache-restored
// page has had its timers suspended for the whole time it sat in the cache. A
// laptop closed at 14:00 and reopened at 20:00 came back to a tab whose
// monotonic clock believed six hours were six milliseconds — so the rendered
// age UNDER-STATED by six hours, and the ribbon's stale-batch suffix, which is
// a function of that age, stayed silent over a batch that was a day old.
//
// Under-stating an age is the one error this product may not make.
//
// THE FIX PINNED HERE, in three parts:
//   (a) a WALL-CLOCK fallback (`Date.now()`) captured at the same receipt, and
//       a NONDECREASING clamp over all three candidates:
//
//           rendered = max(monotonic-derived, wall-derived, last-rendered)
//
//       — sleep cannot freeze it (the wall keeps running), a stepped wall
//       clock cannot rewind it (the monotonic reading and the floor hold), and
//       nothing this module renders can ever move an age backwards inside one
//       receipt.
//   (b) RECONCILIATION on the lifecycle events that mean "this tab may have
//       been suspended" — pageshow, visibilitychange, focus — coalesced,
//       because a single resume fires all three.
//   (c) the ribbon suffix, which is downstream of the age, therefore ENGAGES
//       after a resume instead of staying frozen inside the threshold.
//
// The React plumbing (listeners, the background re-fetch) is pinned in the
// browser by tests/e2e/r4-fixes.spec.ts. This file pins the ARITHMETIC, with
// the two clocks driven INDEPENDENTLY — which is the whole point: the sleep
// case is exactly the case where they disagree.

import { expect, test } from "@playwright/test";
import {
  ageHours,
  anchoredAgeSeconds,
  anchorWireAge,
  humanAge,
  monotonicNowMs,
  RESUME_COALESCE_MS,
  RESUME_EVENTS,
  RIBBON_STALE_BATCH_SECONDS,
  ribbonBatchAgeSuffix,
  shouldReconcileOnResume,
  wallNowMs,
  type AgeAnchor,
} from "../../lib/freshness";

/** A wall-clock epoch far from zero, so a wall reading is never mistaken for
 *  a monotonic one by a test that gets the argument order wrong. */
const WALL_BASE = 1_785_000_000_000;
const MONO_BASE = 1_000;

/**
 * TWO clocks, driven SEPARATELY. `performance.now()` and `Date.now()` are the
 * two readings the anchor takes, and every defect in this finding lives in the
 * gap between them — so the fake refuses to advance them together.
 */
function withSplitClock(
  run: (clock: { sleep: (ms: number) => void; tick: (ms: number) => void; stepWall: (ms: number) => void }) => void,
): void {
  const realPerf = performance.now;
  const realDate = Date.now;
  let mono = MONO_BASE;
  let wall = WALL_BASE;
  performance.now = () => mono;
  Date.now = () => wall;
  try {
    run({
      // SLEEP: wall time passes, the monotonic clock does not. The bug.
      sleep: (ms) => {
        wall += ms;
      },
      // A normal running tab: both clocks advance together.
      tick: (ms) => {
        mono += ms;
        wall += ms;
      },
      // NTP correction / the user editing the system clock: wall only, and it
      // may be NEGATIVE.
      stepWall: (ms) => {
        wall += ms;
      },
    });
  } finally {
    performance.now = realPerf;
    Date.now = realDate;
  }
}

// ---------------------------------------------------------------------------
// (a) the anchor takes BOTH readings, and the clamp is over all three.
// ---------------------------------------------------------------------------

test("the anchor pins the wire age to BOTH clocks at receipt", () => {
  withSplitClock(() => {
    expect(monotonicNowMs()).toBe(MONO_BASE);
    expect(wallNowMs()).toBe(WALL_BASE);
    const anchor = anchorWireAge(120);
    expect(anchor.wireAgeSeconds).toBe(120);
    expect(anchor.receivedAtMs).toBe(MONO_BASE);
    expect(anchor.receivedAtWallMs).toBe(WALL_BASE);
  });
});

test("THE DEFECT: a sleep freezes performance.now — the WALL carries the age", () => {
  withSplitClock((clock) => {
    const anchor = anchorWireAge(120);
    expect(anchoredAgeSeconds(anchor)).toBe(120);

    // Six hours of a closed laptop. `performance.now()` did not move.
    clock.sleep(6 * 3_600_000);
    expect(monotonicNowMs()).toBe(MONO_BASE);
    // The OLD behaviour was 120 — under-stating by six hours. The wall-clock
    // fallback carries it.
    expect(anchoredAgeSeconds(anchor)).toBe(120 + 6 * 3600);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("6h 2m");
  });
});

test("a wall clock stepped BACKWARDS never rewinds the age", () => {
  withSplitClock((clock) => {
    const anchor = anchorWireAge(300);
    clock.tick(600_000); // ten honest minutes: 900s
    expect(anchoredAgeSeconds(anchor)).toBe(900);

    // NTP yanks the system clock back an hour. The monotonic reading is
    // untouched and still licenses 900s — which is what renders.
    clock.stepWall(-3_600_000);
    expect(anchoredAgeSeconds(anchor)).toBe(900);
    // And it keeps climbing from there rather than resuming from the step.
    clock.tick(60_000);
    expect(anchoredAgeSeconds(anchor)).toBe(960);
  });
});

test("THE CLAMP IS NONDECREASING: a rendered age never goes down inside one receipt", () => {
  withSplitClock((clock) => {
    const anchor = anchorWireAge(100);
    // A wall clock stepped FORWARD inflates the age — the allowed error.
    clock.stepWall(3_600_000);
    const inflated = anchoredAgeSeconds(anchor);
    expect(inflated).toBe(3700);
    // Stepped straight back again, the floor holds what was already rendered:
    // over-stating survives, under-stating is not reachable.
    clock.stepWall(-3_600_000);
    expect(anchoredAgeSeconds(anchor, monotonicNowMs(), wallNowMs(), inflated)).toBe(inflated);
    // Both clocks frozen and the floor above them: the floor wins.
    expect(anchoredAgeSeconds(anchor, monotonicNowMs(), wallNowMs(), 9_999)).toBe(9_999);
  });
});

test("the floor is a FLOOR, not an override — real elapsed time still climbs past it", () => {
  withSplitClock((clock) => {
    const anchor = anchorWireAge(100);
    clock.tick(60_000);
    // 160s of real elapsed beats a 120s floor.
    expect(anchoredAgeSeconds(anchor, monotonicNowMs(), wallNowMs(), 120)).toBe(160);
  });
});

test("both clocks frozen: the age is the wire's own number, never fresher", () => {
  withSplitClock(() => {
    const anchor: AgeAnchor = { wireAgeSeconds: 300, receivedAtMs: 10_000, receivedAtWallMs: WALL_BASE };
    // Both readings BEHIND the receipt — each elapsed floors at zero.
    expect(anchoredAgeSeconds(anchor, 9_000, WALL_BASE - 5_000)).toBe(300);
    expect(anchoredAgeSeconds(anchor, 10_000, WALL_BASE)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// (c) the ribbon suffix is downstream of the age — so it engages after sleep.
// ---------------------------------------------------------------------------

test("THE RIBBON ENGAGES AFTER SLEEP: the suffix appears on a clock the tick never saw", () => {
  withSplitClock((clock) => {
    // Received fifty seconds inside the hour: correctly silent.
    const anchor = anchorWireAge(RIBBON_STALE_BATCH_SECONDS - 50);
    expect(ribbonBatchAgeSuffix(anchoredAgeSeconds(anchor))).toBeNull();

    // The lid closes for five hours. The interval never fired and
    // `performance.now()` never moved — the R3 code stayed silent here, over a
    // batch now five hours past the threshold.
    clock.sleep(5 * 3_600_000);
    expect(monotonicNowMs()).toBe(MONO_BASE);
    expect(ribbonBatchAgeSuffix(anchoredAgeSeconds(anchor))).toBe("· batch 5h old");
    expect(ageHours(anchoredAgeSeconds(anchor))).toBe(5);
  });
});

test("a sleep across the hour boundary crosses it — the age is not frozen at 59m", () => {
  withSplitClock((clock) => {
    const anchor = anchorWireAge(3550);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("59m");
    clock.sleep(20 * 60_000);
    expect(humanAge(anchoredAgeSeconds(anchor))).toBe("1h 19m");
  });
});

// ---------------------------------------------------------------------------
// (b) the resume signal: three events, one resume.
// ---------------------------------------------------------------------------

test("the three lifecycle events that mean `this tab may have been suspended`", () => {
  expect([...RESUME_EVENTS]).toEqual(["pageshow", "visibilitychange", "focus"]);
});

test("a resume burst COALESCES: pageshow + visibilitychange + focus is ONE reconcile", () => {
  // With no prior mark at all there is nothing to coalesce against.
  expect(shouldReconcileOnResume(null, MONO_BASE, WALL_BASE)).toBe(true);
  const mark = { monotonicMs: MONO_BASE, wallMs: WALL_BASE };
  // The other two events of the same resume arrive within milliseconds.
  expect(shouldReconcileOnResume(mark, MONO_BASE + 1, WALL_BASE + 1)).toBe(false);
  expect(shouldReconcileOnResume(mark, MONO_BASE + 3, WALL_BASE + 3)).toBe(false);
  // `focus` also fires on a window merely being raised, so the window is wide
  // enough to bound an alt-tabbing reader's re-fetches of an aggregate.
  expect(RESUME_COALESCE_MS).toBe(5_000);
  expect(shouldReconcileOnResume(mark, MONO_BASE + 4_999, WALL_BASE + 4_999)).toBe(false);
});

test("a REAL resume is never coalesced away — either clock showing the gap is enough", () => {
  const mark = { monotonicMs: MONO_BASE, wallMs: WALL_BASE };
  // Sleep: the monotonic clock shows nothing, the wall shows six hours.
  expect(shouldReconcileOnResume(mark, MONO_BASE, WALL_BASE + 6 * 3_600_000)).toBe(true);
  // A backwards wall step: the wall shows nothing, the monotonic clock does.
  expect(shouldReconcileOnResume(mark, MONO_BASE + 60_000, WALL_BASE - 3_600_000)).toBe(true);
  // Exactly at the window: a resume the full window later is a new resume.
  expect(shouldReconcileOnResume(mark, MONO_BASE + RESUME_COALESCE_MS, WALL_BASE)).toBe(true);
  expect(shouldReconcileOnResume(mark, MONO_BASE, WALL_BASE + RESUME_COALESCE_MS)).toBe(true);
});
