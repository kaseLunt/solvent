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
// WAVE R6 (Codex round-13) QUALIFIES THAT LAST SENTENCE, and only that one.
// The estimate is a true statement about the batch WHEN A CLOCK MEASURED THE
// INTERVAL. On a blind resume — definitive lifecycle evidence, and deltas
// neither clock will certify — the recompute adds nothing at all, so what stays
// on screen is not an estimate but an understatement of unknown size. There the
// hook enters UNRESOLVED: the age is reported as unknown rather than as that
// number, the owner's repair is retried on a bounded schedule with its outcome
// OBSERVED rather than fired and forgotten, and only a NEW RECEIPT discharges
// it. The data never leaves the screen — it is the AGE that is withheld, not
// the book.
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
  resumeRetryDelayMs,
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
 * A blind resume standing over a receipt (Wave R6), and how far its bounded
 * repair has got. Keyed on the receipt it happened OVER, which is what makes
 * the discharge a derivation rather than a second piece of bookkeeping: a new
 * `receiptId` simply does not match, and the unknown is gone.
 */
interface BlindResume {
  /** The receipt on screen when the clocks failed to certify the wake. */
  readonly receiptId: string;
  /** The bounded retry schedule is spent and the age is still unmeasured. */
  readonly exhausted: boolean;
}

/**
 * THE HOOK'S READING (Wave R6). It is an object rather than a number because
 * `null` and `0` were the only two things a number could say, and the state
 * this wave adds is neither: the age is UNKNOWN — not absent, not zero, and
 * emphatically not the small number the blind recompute produced.
 */
export interface LiveAgeReading {
  /**
   * The batch's age right now, in seconds, or null before any receipt.
   *
   * WHILE `unresolved` IS TRUE THIS NUMBER MUST NOT BE RENDERED AS THE AGE. It
   * is retained (it is still a true FLOOR — the batch is at least this old) so
   * a caller can keep clamping, and so the moment a receipt discharges the
   * unknown the number is already there.
   */
  readonly seconds: number | null;
  /**
   * A blind resume stands over this receipt: definitive evidence proved a wake
   * that neither clock would measure. The age is unknown until a NEW receipt
   * says otherwise.
   */
  readonly unresolved: boolean;
  /**
   * The bounded repair schedule is spent and the age is still unknown. Only
   * meaningful while `unresolved` — it is the difference between "refreshing"
   * and "refresh failed, data retained".
   */
  readonly refreshFailed: boolean;
}

/**
 * The owner's repair for a resume: go get a receipt.
 *
 * IT RESOLVES `true` ONLY WHEN A NEW RECEIPT WAS APPLIED (Wave R6). `false` or
 * a rejection is a FAILURE, and a failure is what schedules the next bounded
 * retry — which is the round-13 finding: R5's `onResume` was fire-and-forget,
 * so a repair that failed behind `keepOnFailure` was indistinguishable from one
 * that worked, and the understated age stood as if measured.
 *
 * Resolving `true` does not itself clear anything. The discharge is the new
 * receipt arriving through the normal path; this boolean only stops the retry
 * schedule from advancing over a repair that is already done.
 */
export type ResumeRepair = () => Promise<boolean>;

/** The reading a caller with no receipt at all gets. */
const NO_READING: LiveAgeReading = { seconds: null, unresolved: false, refreshFailed: false };

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
 * The batch's age RIGHT NOW, from the wire age this tab was last handed —
 * together with whether this page is still ENTITLED to state it (Wave R6).
 *
 * Null in, a null reading out — the surfaces call this unconditionally at the
 * top of a component (hooks cannot be conditional) and pass null while no batch
 * has arrived.
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
 * ---------------------------------------------------------------------------
 * THE UNRESOLVED STATE (Wave R6, round-13 MEDIUM 1 and 2).
 *
 * On a BLIND resume — definitive evidence, and deltas the clocks will not
 * certify (see `isBlindResume`) — the recompute adds nothing, so the number
 * this hook holds is an understatement of unknown size. From that moment the
 * reading is `unresolved` and the surfaces must render the age as UNKNOWN
 * rather than as that number.
 *
 * `onResume` is the owner's repair, and R6 makes its completion OBSERVABLE: it
 * resolves `true` only when a new receipt was applied. A failure — resolved
 * false, rejected, or absent — schedules the next step of a BOUNDED retry
 * (immediately, then +5s, then +15s, then stop and disclose). R5's version
 * could not do this: it was fire-and-forget, so a repair that failed behind
 * `keepOnFailure` looked exactly like one that worked.
 *
 * THE ONLY DISCHARGE IS A NEW RECEIPT — a `receiptId` change, which re-runs
 * this effect and makes the marker below stop matching. A later clock-certified
 * lifecycle reconcile does NOT clear it: measuring the interval since the wake
 * says nothing about the interval the wake swallowed. The blind interval stays
 * unmeasured until a receipt speaks.
 * ---------------------------------------------------------------------------
 */
export function useAnchoredAgeSeconds(
  receipt: AgeReceipt | null,
  onResume?: ResumeRepair,
): LiveAgeReading {
  // Destructured to PRIMITIVES: a caller building the receipt object inline
  // each render must not re-anchor on its own identity — only on the wire's.
  const wireAgeSeconds = receipt?.ageSeconds ?? null;
  const receiptId = receipt?.receiptId ?? null;
  const [live, setLive] = useState<LiveAge | null>(null);
  // The blind-resume marker, carrying the receipt it happened over (Wave R6).
  const [blind, setBlind] = useState<BlindResume | null>(null);

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

    // --- the bounded repair of a blind resume (Wave R6) --------------------
    //
    // Scoped to THIS receipt: the effect's teardown cancels everything, so the
    // moment a new receipt discharges the unknown, the schedule that existed to
    // chase it is gone with it.
    let retriesMade = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    /**
     * Which repair chain is the live one. A SECOND blind resume over the same
     * receipt starts a fresh schedule, and the in-flight attempt of the old one
     * must not arm a step on it when it finally settles — that would run two
     * chains at once and double the attempts the bound allows.
     */
    let generation = 0;

    /** The repair schedule is spent — the unknown is now the FINAL statement. */
    const markExhausted = (): void => {
      if (cancelled) return;
      setBlind((previous) =>
        previous !== null && previous.receiptId === receiptId && !previous.exhausted
          ? { receiptId, exhausted: true }
          : previous,
      );
    };

    /** Still the live chain, and this component still mounted on this receipt. */
    const current = (run: number): boolean => !cancelled && run === generation;

    const attemptRepair = (run: number): void => {
      if (!current(run)) return;
      const repair = onResumeRef.current;
      // NO REPAIR PATH AT ALL. Nothing this hook can do will restate the age,
      // so the unknown is final from the first moment rather than sitting under
      // a "refreshing" claim that describes no work in flight.
      if (repair === undefined) {
        markExhausted();
        return;
      }
      let settled: Promise<boolean>;
      try {
        settled = repair();
      } catch {
        scheduleRetry(run);
        return;
      }
      settled.then(
        (applied) => {
          // `true` means a new receipt was applied; the receipt itself is the
          // discharge, and this effect is about to be torn down. Anything else
          // is a failure, and a failure is what the schedule exists for.
          if (applied !== true) scheduleRetry(run);
        },
        () => {
          scheduleRetry(run);
        },
      );
    };

    const scheduleRetry = (run: number): void => {
      if (!current(run)) return;
      const delay = resumeRetryDelayMs(retriesMade);
      // THE BOUND, in one branch: the schedule ends, and the page says so.
      if (delay === null) {
        markExhausted();
        return;
      }
      retriesMade += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        // Recompute first: the clocks may have started telling the truth again
        // while this retry waited, and the floor is allowed to climb whether or
        // not the repair ever lands.
        if (!current(run)) return;
        reconcile();
        attemptRepair(run);
      }, delay);
    };

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
      if (!outcome.blind) {
        // A CLOCK-CERTIFIED resume: the recompute above MEASURED it, so the
        // number on screen is a true statement and the repair is the ordinary
        // R4/R5 background improvement. No unknown, no retry schedule.
        void onResumeRef.current?.().catch(() => undefined);
        return;
      }
      // A BLIND resume. The recompute could not add the interval the evidence
      // proves, so the age is unknown from here until a receipt says otherwise
      // — and the repair becomes something this hook must WATCH, not fire and
      // forget.
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      generation += 1;
      retriesMade = 0;
      setBlind({ receiptId, exhausted: false });
      attemptRepair(generation);
    };

    for (const type of LIFECYCLE_EVENTS) {
      lifecycleTarget(type).addEventListener(type, onLifecycleSignal);
    }

    return () => {
      cancelled = true;
      clearInterval(tick);
      if (retryTimer !== null) clearTimeout(retryTimer);
      for (const type of LIFECYCLE_EVENTS) {
        lifecycleTarget(type).removeEventListener(type, onLifecycleSignal);
      }
    };
  }, [wireAgeSeconds, receiptId]);

  if (wireAgeSeconds === null || receiptId === null) return NO_READING;
  // THE DISCHARGE, as a derivation rather than a second piece of bookkeeping: a
  // marker left by a blind resume over ANOTHER receipt does not describe this
  // one, so a new receipt clears the unknown by simply not matching — and
  // nothing else clears it.
  const unresolved = blind !== null && blind.receiptId === receiptId;
  // A committed reading from ANOTHER receipt is not this receipt's age — the
  // wire's own number stands until this receipt has been reconciled once.
  const seconds =
    live === null || live.receiptId !== receiptId || live.wireAgeSeconds !== wireAgeSeconds
      ? wireAgeSeconds
      : live.seconds;
  return { seconds, unresolved, refreshFailed: unresolved && blind.exhausted };
}
