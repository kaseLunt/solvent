// Wave R5, Codex round-12 MEDIUM (2) — TWO BLIND CLOCKS ARE NOT AN ABSENCE OF
// EVIDENCE.
//
// THE DEFECT THIS PINS: R4 decided whether a lifecycle event was a real resume
// by asking the two clocks how much time had passed, taking the LARGER delta
// so that either clock alone could carry the answer. Either — but not neither.
// Both go blind on the SAME wake:
//
//   · a multi-hour suspend PAUSES `performance.now()` (WebKit 225610, Mozilla
//     1709767), so the monotonic delta is ~0; and
//   · the OS, on that same wake, corrects a skewed wall clock BACKWARD by a
//     comparable interval, so the wall delta is zero or negative.
//
// max(~0, ≤0) falls under RESUME_COALESCE_MS, the lifecycle burst is dismissed
// as the second and third events of a resume nobody handled, and NOTHING
// reconciles: no recompute, no repair re-fetch. The age — and the stale-batch
// ribbon that is a function of it — stay hours fresher than the truth. That is
// stale data presented as fresh, the direction the whole freshness law exists
// to prevent.
//
// THE FIX PINNED HERE: two lifecycle facts prove a resume with no arithmetic at
// all, and they now outrank both clocks.
//
//   · `pageshow` with `persisted === true` — a bfcache restore.
//   · a signal arriving VISIBLE after a departure this page has not yet
//     reconciled against (`visibilitychange` hidden→visible is exactly that).
//
// Coalescing survives WITHOUT measuring: the away evidence is CONSUMED by the
// reconcile it triggers, so the rest of the burst falls back to a delta test
// against a mark taken AFTER the resume — where the clocks are honest again.
//
// A bare `focus` stays delta-gated: a window merely raised is not evidence that
// anything was suspended, and alt-tabbing must not become a re-fetch storm.
//
// The DOM wiring is pinned in the browser by tests/e2e/r5-fixes.spec.ts. This
// file drives the decision signal by signal, with both clocks under the test's
// control — which is the point, since the defect lives exactly where the clocks
// say nothing happened.

import { expect, test } from "@playwright/test";
import {
  INITIAL_RESUME_TRACKER,
  isHideSignal,
  RESUME_COALESCE_MS,
  resumeEvidenceOf,
  shouldReconcileOnResume,
  trackResumeSignal,
  type ResumeSignal,
  type ResumeTracker,
} from "../../lib/freshness";

const WALL_BASE = 1_785_000_000_000;
const MONO_BASE = 1_000;

/**
 * A tracker in the state a loaded page is in: a mark taken AT THE RECEIPT (see
 * live-age.ts — taking an anchor is a reconcile), nothing hidden since, and
 * nothing PROVEN — arriving at a number says nothing about whether this tab was
 * awake for the interval before it.
 */
function settled(): ResumeTracker {
  return {
    lastResume: { monotonicMs: MONO_BASE, wallMs: WALL_BASE },
    hiddenSinceReconcile: false,
    lastReconcileProven: false,
  };
}

const PAGESHOW_RESTORED: ResumeSignal = { type: "pageshow", persisted: true, visible: true };
const PAGESHOW_FRESH_LOAD: ResumeSignal = { type: "pageshow", persisted: false, visible: true };
const NOW_VISIBLE: ResumeSignal = { type: "visibilitychange", visible: true };
const NOW_HIDDEN: ResumeSignal = { type: "visibilitychange", visible: false };
const FOCUS: ResumeSignal = { type: "focus", visible: true };

/**
 * Drive a whole burst through the tracker and COUNT the reconciles. Every clock
 * reading is supplied by the caller: nothing here reads a real clock, because
 * the finding is about clocks that lie.
 */
function runBurst(
  tracker: ResumeTracker,
  signals: readonly { signal: ResumeSignal; monotonicMs: number; wallMs: number }[],
): { reconciles: number; tracker: ResumeTracker } {
  let reconciles = 0;
  let current = tracker;
  for (const step of signals) {
    const outcome = trackResumeSignal(current, step.signal, step.monotonicMs, step.wallMs);
    current = outcome.tracker;
    if (outcome.reconcile) reconciles += 1;
  }
  return { reconciles, tracker: current };
}

// ---------------------------------------------------------------------------
// (a) THE COMBINED ADVERSARIAL CASE — the finding itself.
// ---------------------------------------------------------------------------

test("THE ROUND-12 DEFECT: paused monotonic AND a backward wall step still reconcile", () => {
  const tracker = settled();
  // The wake: `performance.now()` did not move at all, and the OS pulled the
  // wall clock back three hours on the same wake.
  const nowMs = MONO_BASE;
  const wallMs = WALL_BASE - 3 * 3_600_000;

  // THE OLD DECISION, kept here so the defect cannot come back unnoticed: both
  // deltas are under the window, so the clocks alone dismiss the resume.
  expect(shouldReconcileOnResume(tracker.lastResume, nowMs, wallMs)).toBe(false);

  // THE NEW DECISION: the bfcache restore is not an inference from a duration,
  // so no clock can defeat it.
  expect(resumeEvidenceOf(PAGESHOW_RESTORED, tracker.hiddenSinceReconcile)).toBe("definitive");
  const outcome = trackResumeSignal(tracker, PAGESHOW_RESTORED, nowMs, wallMs);
  expect(outcome.reconcile).toBe(true);
  // The reconcile RE-MARKS both clocks — the rest of this burst is measured
  // against a reading taken AFTER the resume, where the clocks are honest.
  expect(outcome.tracker.lastResume).toEqual({ monotonicMs: nowMs, wallMs });
  expect(outcome.tracker.hiddenSinceReconcile).toBe(false);
  expect(outcome.tracker.lastReconcileProven).toBe(true);
});

test("THE ADVERSARIAL WAKE FIRES EXACTLY ONCE, not once per lifecycle event", () => {
  const nowMs = MONO_BASE;
  const wallMs = WALL_BASE - 3 * 3_600_000;
  // A real restore fires all three, and the clocks can separate none of them.
  const { reconciles } = runBurst(settled(), [
    { signal: PAGESHOW_RESTORED, monotonicMs: nowMs, wallMs },
    { signal: NOW_VISIBLE, monotonicMs: nowMs + 1, wallMs: wallMs + 1 },
    { signal: FOCUS, monotonicMs: nowMs + 3, wallMs: wallMs + 3 },
  ]);
  expect(reconciles).toBe(1);
});

// ---------------------------------------------------------------------------
// (b) hidden → visible, with both deltas under the window.
// ---------------------------------------------------------------------------

test("hidden→visible reconciles even when neither clock shows the gap", () => {
  // The tab goes away. That is not a resume — it is the EVIDENCE the next
  // return is one, and it must not itself reconcile or re-fetch.
  expect(isHideSignal(NOW_HIDDEN)).toBe(true);
  const gone = trackResumeSignal(settled(), NOW_HIDDEN, MONO_BASE + 5, WALL_BASE + 5);
  expect(gone.reconcile).toBe(false);
  expect(gone.tracker.hiddenSinceReconcile).toBe(true);
  // The mark is untouched by a departure — a hide is not a reconcile.
  expect(gone.tracker.lastResume).toEqual({ monotonicMs: MONO_BASE, wallMs: WALL_BASE });

  // It comes back with both clocks showing a millisecond. Delta-gated, this is
  // dismissed; on the evidence, it is a proven return.
  expect(shouldReconcileOnResume(gone.tracker.lastResume, MONO_BASE + 9, WALL_BASE + 9)).toBe(false);
  expect(resumeEvidenceOf(NOW_VISIBLE, gone.tracker.hiddenSinceReconcile)).toBe("definitive");
  const back = trackResumeSignal(gone.tracker, NOW_VISIBLE, MONO_BASE + 9, WALL_BASE + 9);
  expect(back.reconcile).toBe(true);
  // CONSUMED: the departure has been reconciled against and cannot fire again.
  expect(back.tracker.hiddenSinceReconcile).toBe(false);
});

test("`pagehide` also arms the evidence — a stow this tab saw is a stow it remembers", () => {
  expect(isHideSignal({ type: "pagehide", visible: true })).toBe(true);
  const gone = trackResumeSignal(settled(), { type: "pagehide" }, MONO_BASE + 5, WALL_BASE + 5);
  expect(gone.reconcile).toBe(false);
  expect(gone.tracker.hiddenSinceReconcile).toBe(true);
});

test("a SECOND suspend is proven exactly as the first was", () => {
  // The trap in "consume the evidence" would be a page that proves its first
  // resume and then trusts a clock that has already been shown to lie.
  const first = runBurst(settled(), [
    { signal: NOW_HIDDEN, monotonicMs: MONO_BASE, wallMs: WALL_BASE },
    { signal: NOW_VISIBLE, monotonicMs: MONO_BASE + 2, wallMs: WALL_BASE + 2 },
  ]);
  expect(first.reconciles).toBe(1);
  const second = runBurst(first.tracker, [
    { signal: NOW_HIDDEN, monotonicMs: MONO_BASE + 4, wallMs: WALL_BASE + 4 },
    // Away for six hours; on the wake both clocks are blind again.
    { signal: NOW_VISIBLE, monotonicMs: MONO_BASE + 4, wallMs: WALL_BASE - 6 * 3_600_000 },
  ]);
  expect(second.reconciles).toBe(1);
});

// ---------------------------------------------------------------------------
// (c) a BARE focus stays delta-gated.
// ---------------------------------------------------------------------------

test("a BARE focus with sub-threshold deltas does NOT reconcile", () => {
  // No persisted pageshow, no recorded departure: a window merely raised. The
  // reader alt-tabbing must not re-fetch an aggregate on every raise.
  expect(resumeEvidenceOf(FOCUS, false)).toBe("ambiguous");
  const outcome = trackResumeSignal(settled(), FOCUS, MONO_BASE + 900, WALL_BASE + 900);
  expect(outcome.reconcile).toBe(false);
  expect(outcome.tracker).toEqual(settled());
});

test("a pageshow that is NOT a restore is not evidence either", () => {
  // `persisted: false` is an ordinary load's pageshow. It proves nothing about
  // a suspend, so it is judged by the clocks like anything else.
  expect(resumeEvidenceOf(PAGESHOW_FRESH_LOAD, false)).toBe("ambiguous");
  expect(trackResumeSignal(settled(), PAGESHOW_FRESH_LOAD, MONO_BASE + 4, WALL_BASE + 4).reconcile)
    .toBe(false);
});

test("THE DELTA PATH SURVIVES: with no definitive event, a real gap still reconciles", () => {
  // Nothing above removes R4's clocks — it only stops them being the ONLY
  // evidence. A sleep the wall clock can see is still a resume.
  const sleepSeen = trackResumeSignal(settled(), FOCUS, MONO_BASE, WALL_BASE + 6 * 3_600_000);
  expect(sleepSeen.reconcile).toBe(true);
  // And a backwards wall step the monotonic clock can see, likewise.
  const stepSeen = trackResumeSignal(settled(), FOCUS, MONO_BASE + 60_000, WALL_BASE - 3_600_000);
  expect(stepSeen.reconcile).toBe(true);
  // Exactly at the window.
  expect(
    trackResumeSignal(settled(), FOCUS, MONO_BASE + RESUME_COALESCE_MS, WALL_BASE).reconcile,
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// (d) one resume, one reconcile — the burst still coalesces.
// ---------------------------------------------------------------------------

test("a REAL restore burst — hide, then pageshow + visibilitychange + focus — is ONE reconcile", () => {
  const { reconciles } = runBurst(settled(), [
    // The way out, as a browser fires it: hidden, then stowed.
    { signal: NOW_HIDDEN, monotonicMs: MONO_BASE + 10, wallMs: WALL_BASE + 10 },
    { signal: { type: "pagehide" }, monotonicMs: MONO_BASE + 11, wallMs: WALL_BASE + 11 },
    // The way back in, six hours later on a wall clock that also stepped back.
    { signal: PAGESHOW_RESTORED, monotonicMs: MONO_BASE + 11, wallMs: WALL_BASE - 3_600_000 },
    { signal: NOW_VISIBLE, monotonicMs: MONO_BASE + 12, wallMs: WALL_BASE - 3_600_000 + 1 },
    { signal: FOCUS, monotonicMs: MONO_BASE + 14, wallMs: WALL_BASE - 3_600_000 + 3 },
  ]);
  expect(reconciles).toBe(1);
});

test("ORDER DOES NOT MATTER: the proof may arrive second and it is still ONE reconcile", () => {
  // A `pageshow` states its own case and does not consult the away flag, so a
  // restore whose visibilitychange is delivered FIRST would reconcile twice —
  // once on each definitive signal — if the second were not recognised as the
  // same restore speaking again. It is: the reconcile before it was itself
  // proven, no departure has been recorded since, and both clocks show a
  // burst's worth of time.
  const { reconciles, tracker } = runBurst(settled(), [
    { signal: NOW_HIDDEN, monotonicMs: MONO_BASE + 10, wallMs: WALL_BASE + 10 },
    { signal: NOW_VISIBLE, monotonicMs: MONO_BASE + 11, wallMs: WALL_BASE + 11 },
    { signal: PAGESHOW_RESTORED, monotonicMs: MONO_BASE + 12, wallMs: WALL_BASE + 12 },
    { signal: FOCUS, monotonicMs: MONO_BASE + 13, wallMs: WALL_BASE + 13 },
  ]);
  expect(reconciles).toBe(1);

  // AND THE ECHO RULE CANNOT SWALLOW A REAL RESUME: the very next suspend
  // records its departure first, which is what disarms the rule — even though
  // both clocks stay blind.
  const later = runBurst(tracker, [
    { signal: { type: "pagehide" }, monotonicMs: MONO_BASE + 14, wallMs: WALL_BASE + 14 },
    { signal: PAGESHOW_RESTORED, monotonicMs: MONO_BASE + 14, wallMs: WALL_BASE - 6 * 3_600_000 },
  ]);
  expect(later.reconciles).toBe(1);
});

test("a tracker with no mark at all reconciles on its first signal", () => {
  expect(INITIAL_RESUME_TRACKER.lastResume).toBeNull();
  expect(INITIAL_RESUME_TRACKER.hiddenSinceReconcile).toBe(false);
  expect(trackResumeSignal(INITIAL_RESUME_TRACKER, FOCUS, MONO_BASE, WALL_BASE).reconcile).toBe(
    true,
  );
});
