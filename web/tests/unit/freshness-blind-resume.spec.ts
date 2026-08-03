// Wave R6, Codex round-13 MEDIUM (1) and (2) — A RESUME THAT IS PROVEN IS NOT
// THEREBY MEASURED.
//
// THE DEFECT THIS PINS: R5 made definitive lifecycle evidence outrank both
// clocks, so the adversarial wake — `performance.now()` paused by a multi-hour
// suspend, the wall clock corrected BACKWARD on the same wake — is no longer
// dismissed. It reconciles. But the reconcile it runs is
// `max(monotonic-derived, wall-derived, floor)`, and on that wake every
// candidate is the number already on screen: the evidence proves an interval
// passed and neither clock will say how long.
//
// R5 covered that with a re-fetch, which is the right repair and is not a
// guarantee:
//
//   · THE RIBBON had no repair path at all (finding 1). Its batch arrives on
//     the SSE stream, and a healthy-but-IDLE stream — heartbeats, no new
//     snapshot or batch frame — hands it nothing. A batch received at 130s
//     before a three-hour sleep therefore stayed under the one-hour warning
//     threshold for another ~58 minutes: `LIVE · WATERMARKED`, no stale suffix,
//     over hours-old data.
//   · THE SURFACES THAT OWN A FETCH consumed the departure evidence and
//     re-marked both clocks BEFORE the fire-and-forget `onResume` (finding 2).
//     When that fetch failed — invisibly, because `keepOnFailure` correctly
//     refuses to trade a real book for an error strip — "2m ago" stood, the
//     proof of the missing interval was already spent, and later ticks added
//     only post-wake time.
//
// THE FIX PINNED HERE is the PURE half: one new fact on the resume decision.
// A BLIND resume is a reconcile forced by DEFINITIVE evidence whose clock
// deltas alone would have refused it. The caller learns it as
// `ResumeOutcome.blind` and owes the reader an UNKNOWN age rather than the
// understated number — see lib/live-age.ts for the state machine and
// tests/e2e/r6-fixes.spec.ts for the DOM.
//
// Every clock reading below is supplied by the test. That is the whole point:
// the finding lives exactly where the clocks say nothing happened.

import { expect, test } from "@playwright/test";
import {
  AGE_UNKNOWN_REFRESH_FAILED,
  AGE_UNKNOWN_REFRESHING,
  batchFreshnessLineUnknown,
  batchFreshnessStamp,
  batchFreshnessStampUnknown,
  INITIAL_RESUME_TRACKER,
  isBlindResume,
  RESUME_COALESCE_MS,
  RESUME_RETRY_DELAYS_MS,
  resumeRetryDelayMs,
  ribbonBatchAgeSuffix,
  ribbonBatchAgeUnknown,
  RIBBON_STALE_BATCH_SECONDS,
  shouldReconcileOnResume,
  trackResumeSignal,
  unknownAgePhrase,
  type FreshnessBatch,
  type ResumeSignal,
  type ResumeTracker,
} from "../../lib/freshness";

const WALL_BASE = 1_785_000_000_000;
const MONO_BASE = 1_000;
const THREE_HOURS_MS = 3 * 3_600_000;

/** A tracker in the state a loaded page is in — a mark taken AT THE RECEIPT. */
function settled(): ResumeTracker {
  return {
    lastResume: { monotonicMs: MONO_BASE, wallMs: WALL_BASE },
    hiddenSinceReconcile: false,
    lastReconcileProven: false,
  };
}

const PAGESHOW_RESTORED: ResumeSignal = { type: "pageshow", persisted: true, visible: true };
const NOW_VISIBLE: ResumeSignal = { type: "visibilitychange", visible: true };
const NOW_HIDDEN: ResumeSignal = { type: "visibilitychange", visible: false };
const FOCUS: ResumeSignal = { type: "focus", visible: true };

// ---------------------------------------------------------------------------
// (a) THE PREDICATE ITSELF — both halves required, in both directions.
// ---------------------------------------------------------------------------

test("THE BLIND-RESUME PREDICATE: proven AND uncertified, and nothing else", () => {
  // The finding: the evidence carried the reconcile, the clocks measured none
  // of the interval it proves.
  expect(isBlindResume(true, false)).toBe(true);
  // A resume the clocks CAN measure is measured — the recompute states it
  // exactly, and calling that unknown would be a false alarm over a true number.
  expect(isBlindResume(true, true)).toBe(false);
  // No definitive evidence: R4's ordinary delta path, likewise measured.
  expect(isBlindResume(false, true)).toBe(false);
  // Neither: there is no reconcile at all to be blind about.
  expect(isBlindResume(false, false)).toBe(false);
});

// ---------------------------------------------------------------------------
// (b) DETECTION through the real decision, signal by signal.
// ---------------------------------------------------------------------------

test("THE ROUND-13 CASE: definitive evidence + sub-threshold deltas is BLIND", () => {
  const tracker = settled();
  // The wake: `performance.now()` did not move at all, and the OS pulled the
  // wall clock back three hours on the same wake.
  const nowMs = MONO_BASE;
  const wallMs = WALL_BASE - THREE_HOURS_MS;

  // The clocks alone would refuse this reconcile outright — that is the second
  // half of the predicate, stated in the terms the code uses.
  expect(shouldReconcileOnResume(tracker.lastResume, nowMs, wallMs)).toBe(false);

  const outcome = trackResumeSignal(tracker, PAGESHOW_RESTORED, nowMs, wallMs);
  // R5's guarantee is untouched: the reconcile still RUNS.
  expect(outcome.reconcile).toBe(true);
  // R6's addition: and the caller is told it measured nothing.
  expect(outcome.blind).toBe(true);
});

test("hidden→visible with both clocks blind is BLIND too — the same wake, a different proof", () => {
  const gone = trackResumeSignal(settled(), NOW_HIDDEN, MONO_BASE + 5, WALL_BASE + 5);
  expect(gone.reconcile).toBe(false);
  // A DEPARTURE IS NOT A RESUME and can never be blind: nothing was recomputed.
  expect(gone.blind).toBe(false);

  const back = trackResumeSignal(gone.tracker, NOW_VISIBLE, MONO_BASE + 9, WALL_BASE + 9);
  expect(back.reconcile).toBe(true);
  expect(back.blind).toBe(true);
});

test("A CLOCK-CERTIFIED RESUME IS NOT BLIND — no false alarm over an age the page can state", () => {
  // An ordinary sleep with an honest wall clock: six hours the recompute will
  // ADD, in full. The reader gets a number, because a number is available.
  const sleepSeen = trackResumeSignal(
    settled(),
    PAGESHOW_RESTORED,
    MONO_BASE,
    WALL_BASE + 6 * 3_600_000,
  );
  expect(sleepSeen.reconcile).toBe(true);
  expect(sleepSeen.blind).toBe(false);

  // A backward wall step the monotonic clock can see, likewise.
  const stepSeen = trackResumeSignal(
    settled(),
    PAGESHOW_RESTORED,
    MONO_BASE + 60_000,
    WALL_BASE - 3_600_000,
  );
  expect(stepSeen.reconcile).toBe(true);
  expect(stepSeen.blind).toBe(false);

  // EXACTLY AT THE WINDOW is certified — the boundary belongs to the clocks.
  const atWindow = trackResumeSignal(
    settled(),
    PAGESHOW_RESTORED,
    MONO_BASE + RESUME_COALESCE_MS,
    WALL_BASE,
  );
  expect(atWindow.reconcile).toBe(true);
  expect(atWindow.blind).toBe(false);
});

test("AMBIGUOUS + certified is not blind: R4's delta path never raises the unknown", () => {
  // A bare focus with a real gap on one clock. The reconcile is earned on the
  // clocks, so the clocks measured it, so there is nothing unknown about it.
  const outcome = trackResumeSignal(settled(), FOCUS, MONO_BASE, WALL_BASE + 6 * 3_600_000);
  expect(outcome.reconcile).toBe(true);
  expect(outcome.blind).toBe(false);
});

test("a signal that does not reconcile is never blind", () => {
  // A bare focus inside the window: no reconcile, and therefore no claim of
  // any kind about the interval.
  const bare = trackResumeSignal(settled(), FOCUS, MONO_BASE + 900, WALL_BASE + 900);
  expect(bare.reconcile).toBe(false);
  expect(bare.blind).toBe(false);

  // THE ECHO — the second definitive signal of one restore. It must not reopen
  // an unknown the first signal already opened and is already repairing.
  const first = trackResumeSignal(settled(), PAGESHOW_RESTORED, MONO_BASE, WALL_BASE);
  expect(first.reconcile).toBe(true);
  const echo = trackResumeSignal(first.tracker, PAGESHOW_RESTORED, MONO_BASE + 2, WALL_BASE + 2);
  expect(echo.reconcile).toBe(false);
  expect(echo.blind).toBe(false);
});

test("the FIRST signal of a page with no mark is not blind — there is nothing to measure against", () => {
  const outcome = trackResumeSignal(INITIAL_RESUME_TRACKER, FOCUS, MONO_BASE, WALL_BASE);
  expect(outcome.reconcile).toBe(true);
  // `shouldReconcileOnResume(null, …)` is true, so the clocks did not refuse
  // this — an unmarked page is not a page whose clocks lied.
  expect(outcome.blind).toBe(false);
});

test("ONE WAKE, ONE UNKNOWN: the full blind burst reports blind exactly once", () => {
  // Three lifecycle events, every delta zero or negative. The burst still
  // coalesces to one reconcile — and therefore to one blind report, so a
  // surface cannot be driven into restarting its repair three times.
  let tracker = settled();
  const blinds: boolean[] = [];
  const wake = WALL_BASE - THREE_HOURS_MS;
  for (const step of [
    { signal: PAGESHOW_RESTORED, monotonicMs: MONO_BASE, wallMs: wake },
    { signal: NOW_VISIBLE, monotonicMs: MONO_BASE + 1, wallMs: wake + 1 },
    { signal: FOCUS, monotonicMs: MONO_BASE + 3, wallMs: wake + 3 },
  ]) {
    const outcome = trackResumeSignal(tracker, step.signal, step.monotonicMs, step.wallMs);
    tracker = outcome.tracker;
    if (outcome.reconcile) blinds.push(outcome.blind);
  }
  expect(blinds).toEqual([true]);
});

// ---------------------------------------------------------------------------
// (c) DISCHARGE: nothing in the clock layer can clear an unknown.
// ---------------------------------------------------------------------------

test("A LATER CLOCK-CERTIFIED RECONCILE DOES NOT DISCHARGE THE UNKNOWN", () => {
  // The wake nobody could measure.
  const blindWake = trackResumeSignal(
    settled(),
    PAGESHOW_RESTORED,
    MONO_BASE,
    WALL_BASE - THREE_HOURS_MS,
  );
  expect(blindWake.blind).toBe(true);

  // An hour later the reader comes back again, and THIS time both clocks are
  // honest. The reconcile measures the hour since the last mark — and the last
  // mark was taken AFTER the blind wake, so it says nothing whatever about the
  // interval the blind wake swallowed.
  const honest = trackResumeSignal(
    blindWake.tracker,
    PAGESHOW_RESTORED,
    MONO_BASE + 3_600_000,
    WALL_BASE - THREE_HOURS_MS + 3_600_000,
  );
  expect(honest.reconcile).toBe(true);
  expect(honest.blind).toBe(false);
  // AND THERE IS NO "RESOLVED" SIGNAL TO BE FOUND. `blind: false` is the
  // absence of a NEW unknown, never the retirement of an old one — the outcome
  // has no field that could clear one, by construction. Only a new receipt
  // does, and receipts do not pass through this function at all.
  expect(Object.keys(honest).toSorted()).toEqual(["blind", "reconcile", "tracker"]);
});

// ---------------------------------------------------------------------------
// (d) THE RETRY SCHEDULE IS BOUNDED — the loop cannot be infinite.
// ---------------------------------------------------------------------------

test("the bounded repair schedule: immediately, then 5s, then 15s, then STOP", () => {
  // The first attempt is the reconcile itself and is not in the list.
  expect([...RESUME_RETRY_DELAYS_MS]).toEqual([5_000, 15_000]);
  expect(resumeRetryDelayMs(0)).toBe(5_000);
  expect(resumeRetryDelayMs(1)).toBe(15_000);
  // THE BOUND: null is the end, and there is no branch past it.
  expect(resumeRetryDelayMs(2)).toBeNull();
});

test("NO INFINITE LOOP: driving the schedule to exhaustion terminates", () => {
  // The loop a failing repair actually runs — every attempt consumes a step,
  // and the step list is what stops it. A guard bounds the TEST itself, so a
  // schedule that ever stopped terminating would fail here rather than hang.
  const delays: number[] = [];
  let retriesMade = 0;
  for (let guard = 0; guard < 1_000; guard += 1) {
    const delay = resumeRetryDelayMs(retriesMade);
    if (delay === null) break;
    delays.push(delay);
    retriesMade += 1;
  }
  expect(delays).toEqual([5_000, 15_000]);
  // Total wall time the page will spend chasing a repair before it says so:
  // twenty seconds. A woken laptop's interface comes up inside that; a service
  // that is genuinely down is not converted into a polling loop.
  expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(20_000);
});

test("a negative or absurd step index is still the end of the schedule", () => {
  expect(resumeRetryDelayMs(-1)).toBeNull();
  expect(resumeRetryDelayMs(9_999)).toBeNull();
});

// ---------------------------------------------------------------------------
// (e) THE UNKNOWN REGISTER — what the surfaces are given to say.
// ---------------------------------------------------------------------------

const BATCH: FreshnessBatch = {
  id: 5,
  computed_at: "2026-07-29T10:00:00Z",
  age_seconds: 130,
};

test("the unknown register never renders a number, a zero, or a staleness verdict", () => {
  const refreshing = batchFreshnessLineUnknown(BATCH, false);
  expect(refreshing).toBe(
    "batch #5 · computed 2026-07-29T10:00:00Z · age UNKNOWN since resume · refreshing",
  );

  // NOT A ZERO and NOT A SMALL NUMBER: the understated age is 130s, and the
  // whole finding is that rendering it reads as fresh. No age token survives.
  expect(refreshing).not.toContain("130");
  expect(refreshing).not.toContain("2m");
  expect(refreshing).not.toContain("0s");
  expect(refreshing).not.toContain(" ago");
  // NOT A STALENESS CLAIM EITHER: "I cannot say" is a refusal to state, not a
  // verdict. The page does not know the batch is old; it knows it cannot tell.
  expect(refreshing).not.toContain("stale");
  expect(refreshing).not.toContain("old");

  // THE BATCH'S IDENTITY SURVIVES, verbatim. Only the age is withheld —
  // withholding the id or the `computed_at` would be a second, invented
  // refusal over facts the wire published and the page still holds.
  expect(refreshing).toContain("#5");
  expect(refreshing).toContain("2026-07-29T10:00:00Z");
});

test("exhaustion changes the STATEMENT, not the refusal — and keeps the data", () => {
  expect(unknownAgePhrase(false)).toBe(AGE_UNKNOWN_REFRESHING);
  expect(unknownAgePhrase(true)).toBe(AGE_UNKNOWN_REFRESH_FAILED);
  expect(AGE_UNKNOWN_REFRESHING).toBe("age UNKNOWN since resume · refreshing");
  // The reader is told which of the two they are looking at, and that nothing
  // was thrown away: the book is still the book, it is the AGE that is gone.
  expect(AGE_UNKNOWN_REFRESH_FAILED).toBe("age UNKNOWN since resume · refresh failed, data retained");
  expect(batchFreshnessStampUnknown(BATCH, true)).toBe(
    "#5 · computed 2026-07-29T10:00:00Z · age UNKNOWN since resume · refresh failed, data retained",
  );
});

test("the unknown stamp mirrors the known stamp — same shape, refusal in the age's slot", () => {
  // The reader's eye lands in the same place on both. Only the last field
  // differs, which is the only thing that differs in the world.
  const known = batchFreshnessStamp(BATCH, 130).split(" · ");
  const unknown = batchFreshnessStampUnknown(BATCH, false).split(" · ");
  expect(unknown.slice(0, 2)).toEqual(known.slice(0, 2));
  expect(known[2]).toBe("2m ago");
  expect(unknown[2]).toBe("age UNKNOWN since resume");
});

test("THE RIBBON SLOT IS NEVER SILENT while the age is unknown", () => {
  // THE FINDING, in one pair of lines. At 130s the computed suffix is null —
  // "render nothing" — and on the ribbon nothing reads as `LIVE · WATERMARKED`
  // with no reservation attached. That silence is exactly what carried
  // hours-old data for another ~58 minutes.
  expect(ribbonBatchAgeSuffix(130)).toBeNull();
  expect(130).toBeLessThan(RIBBON_STALE_BATCH_SECONDS);
  // The unknown register cannot be null: there is no input that silences it.
  expect(ribbonBatchAgeUnknown(false)).toBe("· batch age UNKNOWN since resume · refreshing");
  expect(ribbonBatchAgeUnknown(true)).toBe(
    "· batch age UNKNOWN since resume · refresh failed, data retained",
  );
  // And it is not the stale suffix wearing a new coat — no hour count is
  // implied, because none is known.
  expect(ribbonBatchAgeUnknown(false)).not.toMatch(/\d+h old/);
});
