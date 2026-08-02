"use client";

// The React binding for lib/freshness.ts's ANCHOR (Wave R3, Codex round-10
// MEDIUM). The law and the arithmetic live in freshness.ts, which stays pure
// and is pinned by tests/unit/freshness.spec.ts; this file is only the
// plumbing that (a) pins each received wire age to the monotonic clock and
// (b) re-renders on a tick so the crossing of a boundary is SEEN.
//
// Nothing animates — an age is text — so the tick has no reduced-motion
// dimension: a reader who suppresses motion still needs a true age.
//
// RENDER STAYS PURE. The monotonic clock is read in the effect (at receipt)
// and in the interval callback (at each tick), never during render, and the
// two readings are committed as ONE state value so an anchor can never be
// paired with a clock reading from a different subscription.

import { useEffect, useState } from "react";
import {
  AGE_TICK_MS,
  anchorWireAge,
  anchoredAgeSeconds,
  monotonicNowMs,
  type AgeAnchor,
} from "./freshness";

/** An anchor and the monotonic reading it was last measured against. */
interface LiveAge {
  readonly anchor: AgeAnchor;
  readonly nowMs: number;
}

/**
 * The batch's age RIGHT NOW, from the wire age this tab was last handed.
 *
 * Null in, null out — the surfaces call this unconditionally at the top of a
 * component (hooks cannot be conditional) and pass null while no batch has
 * arrived.
 *
 * RE-ANCHORING is keyed on the wire VALUE. A response carrying a different
 * `age_seconds` is a new receipt and resets the anchor. A response repeating
 * the SAME number keeps the older anchor, so the rendered age keeps climbing
 * rather than snapping back — of the two errors available, over-stating a
 * batch's age is the one this product is allowed to make.
 *
 * Before the first tick (and for any render whose wire value the committed
 * anchor does not match) this returns the WIRE age unmodified — the exact
 * number the old code rendered, correct at receipt and never fresher than the
 * wire licensed. The anchor only ever ADDS to it.
 */
export function useAnchoredAgeSeconds(wireAgeSeconds: number | null): number | null {
  const [live, setLive] = useState<LiveAge | null>(null);

  useEffect(() => {
    if (wireAgeSeconds === null) return;
    // Receipt: the wire number pinned to the monotonic clock, once.
    const anchor = anchorWireAge(wireAgeSeconds);
    const id = setInterval(() => {
      setLive({ anchor, nowMs: monotonicNowMs() });
    }, AGE_TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [wireAgeSeconds]);

  if (wireAgeSeconds === null) return null;
  if (live === null || live.anchor.wireAgeSeconds !== wireAgeSeconds) return wireAgeSeconds;
  return anchoredAgeSeconds(live.anchor, live.nowMs);
}
