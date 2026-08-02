"use client";

// The React binding for lib/freshness.ts's ANCHOR (Wave R3, Codex round-10
// MEDIUM; extended by Wave R4, Codex round-11 MEDIUM). The law and the
// arithmetic live in freshness.ts, which stays pure and is pinned by
// tests/unit/freshness.spec.ts + tests/unit/freshness-resume.spec.ts; this
// file is only the plumbing that (a) pins each received wire age to BOTH
// clocks, (b) re-renders on a tick so the crossing of a boundary is SEEN, and
// (c) RECONCILES when the tab comes back from a suspend.
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
  monotonicNowMs,
  RESUME_EVENTS,
  shouldReconcileOnResume,
  wallNowMs,
  type ResumeMark,
} from "./freshness";

/** The last age COMMITTED for a given wire value — already clamped. */
interface LiveAge {
  readonly wireAgeSeconds: number;
  readonly seconds: number;
}

/** `visibilitychange` fires on the document; `pageshow`/`focus` on the window. */
function resumeTarget(type: (typeof RESUME_EVENTS)[number]): EventTarget {
  return type === "visibilitychange" ? document : window;
}

/**
 * The batch's age RIGHT NOW, from the wire age this tab was last handed.
 *
 * Null in, null out — the surfaces call this unconditionally at the top of a
 * component (hooks cannot be conditional) and pass null while no batch has
 * arrived.
 *
 * RE-ANCHORING is keyed on the wire VALUE. A response carrying a different
 * `age_seconds` is a new receipt: it resets the anchor AND the nondecreasing
 * floor, so a genuinely fresher batch renders its own younger age instead of
 * being held to the stale one's floor. A response repeating the SAME number
 * keeps the older anchor, so the rendered age keeps climbing rather than
 * snapping back — of the two errors available, over-stating a batch's age is
 * the one this product is allowed to make.
 *
 * Before the first tick (and for any render whose wire value the committed
 * reading does not match) this returns the WIRE age unmodified — the exact
 * number the old code rendered, correct at receipt and never fresher than the
 * wire licensed. The anchor only ever ADDS to it.
 *
 * `onResume` is the owner's BACKGROUND re-fetch, called once per resume (the
 * three lifecycle events of a single resume are coalesced). Surfaces that do
 * not own the fetch behind their age — the PostureRibbon, whose batch arrives
 * on the stream — pass nothing and simply get the recomputed estimate.
 */
export function useAnchoredAgeSeconds(
  wireAgeSeconds: number | null,
  onResume?: () => void,
): number | null {
  const [live, setLive] = useState<LiveAge | null>(null);

  // Held in a ref so a caller that rebuilds the callback each render never
  // re-subscribes the listeners — and so a resume always calls the CURRENT one.
  const onResumeRef = useRef(onResume);
  useEffect(() => {
    onResumeRef.current = onResume;
  });

  useEffect(() => {
    if (wireAgeSeconds === null) return;

    // Receipt: the wire number pinned to BOTH clocks, once.
    const anchor = anchorWireAge(wireAgeSeconds);
    // The nondecreasing floor, scoped to THIS receipt (see freshness.ts).
    let floorSeconds = wireAgeSeconds;
    // SEEDED FROM THE RECEIPT, not null: taking the anchor IS a reconcile, so
    // a `focus` that fires in the instant after a response lands is not a
    // resume worth re-fetching for. Seeding is what keeps the initial load to
    // exactly one request.
    let lastResume: ResumeMark = {
      monotonicMs: anchor.receivedAtMs,
      wallMs: anchor.receivedAtWallMs,
    };

    const reconcile = (): void => {
      floorSeconds = anchoredAgeSeconds(anchor, monotonicNowMs(), wallNowMs(), floorSeconds);
      setLive({ wireAgeSeconds, seconds: floorSeconds });
    };

    const tick = setInterval(reconcile, AGE_TICK_MS);

    const onResumeSignal = (event: Event): void => {
      // `visibilitychange` also fires on the way OUT. Only a return to visible
      // is a resume; leaving is not something to reconcile against.
      if (event.type === "visibilitychange" && document.visibilityState !== "visible") return;
      const nowMs = monotonicNowMs();
      const wallMs = wallNowMs();
      // One resume fires pageshow AND visibilitychange AND focus. Coalesce, so
      // a single restore is a single reconcile and a single re-fetch.
      if (!shouldReconcileOnResume(lastResume, nowMs, wallMs)) return;
      lastResume = { monotonicMs: nowMs, wallMs };
      // The estimate lands FIRST, so the reader never looks at a number the
      // page already knows is too young — then the wire's own number replaces
      // it if the owner has a fetch to make.
      reconcile();
      onResumeRef.current?.();
    };

    for (const type of RESUME_EVENTS) {
      resumeTarget(type).addEventListener(type, onResumeSignal);
    }

    return () => {
      clearInterval(tick);
      for (const type of RESUME_EVENTS) {
        resumeTarget(type).removeEventListener(type, onResumeSignal);
      }
    };
  }, [wireAgeSeconds]);

  if (wireAgeSeconds === null) return null;
  if (live === null || live.wireAgeSeconds !== wireAgeSeconds) return wireAgeSeconds;
  return live.seconds;
}
