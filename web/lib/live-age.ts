"use client";

// The React binding for lib/freshness.ts's ANCHOR (Wave R3, Codex round-10
// MEDIUM; extended by Wave R4, Codex round-11 MEDIUM; corrected by Wave R5,
// Codex round-12 MEDIUM). The law and the arithmetic live in freshness.ts,
// which stays pure and is pinned by tests/unit/freshness.spec.ts +
// tests/unit/freshness-resume.spec.ts; this file is only the plumbing that
// (a) pins each received wire age to BOTH clocks, (b) re-renders on a tick so
// the crossing of a boundary is SEEN, and (c) RECONCILES when the tab comes
// back from a suspend.
//
// Nothing animates — an age is text — so the tick has no reduced-motion
// dimension: a reader who suppresses motion still needs a true age.
//
// WHY (c) EXISTS: the minute tick cannot fire while the tab is suspended or
// sitting in the bfcache, and `performance.now()` does not advance across a
// system sleep either (WebKit 225610, Mozilla 1709767). A resumed page would
// therefore render an age that under-states by the whole length of the sleep,
// for up to a full tick after the reader is looking at it again — and the
// stale-batch ribbon, being a function of that age, would stay silent. On
// resume this hook recomputes IMMEDIATELY (the clamped estimate, which is
// honest: it is `wireAge + the largest elapsed interval either clock can
// prove`) and calls the owner's `onResume` so a surface that owns its fetch
// can go get the wire's own number.
//
// NEVER A SPINNER OVER STALE NUMBERS, AND NEVER A "REFRESHING" LIE: the
// estimate stays on screen while that re-fetch is in flight. There is nothing
// to apologise for — the number rendered is a true statement about the batch,
// and it is replaced by the wire's when the wire answers.
//
// RENDER STAYS PURE. Both clocks are read in the effect (at receipt), in the
// interval callback (at each tick) and in the resume listener — never during
// render — and each reading is committed as ONE clamped state value, so a
// rendered age can never be assembled from readings of different vintages.

import { useEffect, useRef, useState } from "react";
import {
  AGE_TICK_MS,
  anchorWireAge,
  anchoredAgeSeconds,
  HIDE_EVENTS,
  INITIAL_RESUME_TRACKER,
  monotonicNowMs,
  RESUME_EVENTS,
  trackResumeSignal,
  wallNowMs,
  type AgeReceipt,
  type ResumeTracker,
} from "./freshness";

/** The last age COMMITTED for a given receipt — already clamped. */
interface LiveAge {
  /** The receipt that age belongs to (Wave R5). */
  readonly receiptId: string;
  readonly wireAgeSeconds: number;
  readonly seconds: number;
}

/**
 * Every lifecycle event this hook listens to: the three that mean "this tab may
 * have come back" plus the one that means "it is going away". The departure
 * matters because it is the EVIDENCE the return is a real resume — evidence no
 * clock can contradict (Wave R5, finding 2).
 */
const LIFECYCLE_EVENTS = [...RESUME_EVENTS, ...HIDE_EVENTS] as const;

/** `visibilitychange` fires on the document; the rest on the window. */
function lifecycleTarget(type: (typeof LIFECYCLE_EVENTS)[number]): EventTarget {
  return type === "visibilitychange" ? document : window;
}

/**
 * `PageTransitionEvent.persisted` when this event carries it, `undefined`
 * otherwise — read without a cast, so a browser that does not fire a
 * `PageTransitionEvent` here cannot be silently believed to have said `false`.
 */
function persistedOf(event: Event): boolean | undefined {
  if (!("persisted" in event)) return undefined;
  return typeof event.persisted === "boolean" ? event.persisted : undefined;
}

/**
 * The batch's age RIGHT NOW, from the wire age this tab was last handed.
 *
 * Null in, null out — the surfaces call this unconditionally at the top of a
 * component (hooks cannot be conditional) and pass null while no batch has
 * arrived.
 *
 * RE-ANCHORING IS KEYED ON THE RECEIPT (Wave R5, round-12 MEDIUM). Every
 * successful response is a new receipt — identified by the envelope's
 * `served_at` plus the batch id where the caller has one — and every new
 * receipt resets the anchor AND the nondecreasing floor, so a genuinely fresher
 * batch renders its own younger age instead of being held to the stale one's
 * floor. This is the correction R4 needed: keying on the wire VALUE meant a new
 * batch that happened to arrive at the same integer age as the last one
 * inherited the old anchor and rendered hours older than it was.
 *
 * A FAILED re-fetch is not a receipt and cannot re-anchor anything: the callers
 * hold their previous state on the resume path (`keepOnFailure`), so neither
 * the age nor the identity changes and this effect does not re-run.
 *
 * Before the first tick (and for any render whose receipt the committed reading
 * does not match) this returns the WIRE age unmodified — the exact number the
 * old code rendered, correct at receipt and never fresher than the wire
 * licensed. The anchor only ever ADDS to it.
 *
 * `onResume` is the owner's BACKGROUND re-fetch, called once per resume (the
 * lifecycle burst of a single resume is coalesced). Surfaces that do not own
 * the fetch behind their age — the PostureRibbon, whose batch arrives on the
 * stream — pass nothing and simply get the recomputed estimate.
 */
export function useAnchoredAgeSeconds(
  receipt: AgeReceipt | null,
  onResume?: () => void,
): number | null {
  // Destructured to PRIMITIVES: a caller building the receipt object inline
  // each render must not re-anchor on its own identity — only on the wire's.
  const wireAgeSeconds = receipt?.ageSeconds ?? null;
  const receiptId = receipt?.receiptId ?? null;
  const [live, setLive] = useState<LiveAge | null>(null);

  // Held in a ref so a caller that rebuilds the callback each render never
  // re-subscribes the listeners — and so a resume always calls the CURRENT one.
  const onResumeRef = useRef(onResume);
  useEffect(() => {
    onResumeRef.current = onResume;
  });

  // The resume state OUTLIVES the anchor. A tab that was hidden when a new
  // receipt landed on the stream is still a tab that was hidden: the departure
  // must survive the re-anchor, or the return after it would be judged by the
  // two clocks alone — which is the round-12 finding.
  const trackerRef = useRef<ResumeTracker>(INITIAL_RESUME_TRACKER);

  useEffect(() => {
    if (wireAgeSeconds === null || receiptId === null) return;

    // Receipt: the wire number pinned to BOTH clocks, once.
    const anchor = anchorWireAge(wireAgeSeconds);
    // The nondecreasing floor, scoped to THIS receipt (see freshness.ts).
    let floorSeconds = wireAgeSeconds;
    // SEEDED FROM THE RECEIPT, not null: taking the anchor IS a reconcile, so
    // a `focus` that fires in the instant after a response lands is not a
    // resume worth re-fetching for. Seeding is what keeps the initial load to
    // exactly one request. An UNRECONCILED DEPARTURE is carried across —
    // arriving at a new number is not the same as proving the tab was awake.
    trackerRef.current = {
      lastResume: { monotonicMs: anchor.receivedAtMs, wallMs: anchor.receivedAtWallMs },
      hiddenSinceReconcile: trackerRef.current.hiddenSinceReconcile,
      // A RECEIPT IS NOT A PROVEN RESUME. Arriving at a new number says nothing
      // about whether this tab was awake for the interval before it, so the
      // next definitive signal is judged on its own evidence, not gated as an
      // echo of this.
      lastReconcileProven: false,
    };

    const reconcile = (): void => {
      floorSeconds = anchoredAgeSeconds(anchor, monotonicNowMs(), wallNowMs(), floorSeconds);
      setLive({ receiptId, wireAgeSeconds, seconds: floorSeconds });
    };

    const tick = setInterval(reconcile, AGE_TICK_MS);

    const onLifecycleSignal = (event: Event): void => {
      const nowMs = monotonicNowMs();
      const wallMs = wallNowMs();
      // ONE decision, taken in freshness.ts: a departure is recorded, a proven
      // return always reconciles, and the rest of a single resume's burst is
      // coalesced against the mark this reconcile just took.
      const outcome = trackResumeSignal(
        trackerRef.current,
        {
          type: event.type,
          persisted: persistedOf(event),
          visible: document.visibilityState === "visible",
        },
        nowMs,
        wallMs,
      );
      trackerRef.current = outcome.tracker;
      if (!outcome.reconcile) return;
      // The estimate lands FIRST, so the reader never looks at a number the
      // page already knows is too young — then the wire's own number replaces
      // it if the owner has a fetch to make.
      reconcile();
      onResumeRef.current?.();
    };

    for (const type of LIFECYCLE_EVENTS) {
      lifecycleTarget(type).addEventListener(type, onLifecycleSignal);
    }

    return () => {
      clearInterval(tick);
      for (const type of LIFECYCLE_EVENTS) {
        lifecycleTarget(type).removeEventListener(type, onLifecycleSignal);
      }
    };
  }, [wireAgeSeconds, receiptId]);

  if (wireAgeSeconds === null) return null;
  // A committed reading from ANOTHER receipt is not this receipt's age — the
  // wire's own number stands until this receipt has been reconciled once.
  if (live === null || live.receiptId !== receiptId || live.wireAgeSeconds !== wireAgeSeconds) {
    return wireAgeSeconds;
  }
  return live.seconds;
}
