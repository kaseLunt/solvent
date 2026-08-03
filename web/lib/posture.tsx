"use client";

// The global stream-posture context: ONE SolventStream per tab, its state
// surfaced to the integrity Ribbon and the degradation banner.
//
// The client's stream machinery carries the laws (sse.ts):
//   - snapshot-on-connect enforced; deltas before a base are refused;
//   - base-frame deadline that heartbeat comments cannot extend;
//   - jittered exponential reconnect backoff.
// This provider adds NO protocol logic — it only projects delivered events
// into React state, honestly:
//
//   - `batch` is the last snapshot/batch payload's batch — a WATERMARK VECTOR
//     (per-engine stamps), never "live at block N".
//   - `unavailable` keeps the server's own staleness statement
//     (stale_since_seconds, last_good_batch_id) instead of inventing one.
//   - live posture is CURRENT-connection state only. Nothing here persists or
//     replays posture history (spec §5 law 6 — that arrives with P4's outbox).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchEventSource,
  SolventStream,
  type Aggregate,
  type Batch,
  type Degradation,
  type StreamPayload,
  type StreamState,
  type Transition,
} from "@solvent/client";
import { solventStreamUrl } from "./api";
import { receiptIdentity } from "./freshness";

/** The server's own unavailability statement, kept verbatim. */
export interface UnavailableInfo {
  reason: string | null;
  staleSinceSeconds: number | null;
  lastGoodBatchId: number | null;
}

export interface Posture {
  /** Transport state from the client's stream machinery. `idle` before mount. */
  streamState: StreamState;
  /** True once the CURRENT connection has delivered its base frame. */
  hasBase: boolean;
  /** The newest servable batch (watermark vector inside), or null. */
  batch: Batch | null;
  /**
   * The identity of the RECEIPT that delivered `batch` (Wave R5, round-12
   * MEDIUM): the payload's own `served_at` folded with the batch id. Every
   * snapshot/batch frame is a new receipt even when it repeats the previous
   * frame's integer `age_seconds`, and the age anchor must re-anchor on it —
   * otherwise a fresher batch inherits the older one's accumulated age.
   */
  batchReceiptId: string | null;
  /** Per-engine aggregates from the last snapshot/batch, when sent. */
  engines: Aggregate[] | null;
  /** Current degradation posture (refusals / flags / supersession / withheld engines). */
  degradation: Degradation | null;
  /** Posture transitions from the LAST degradation event (current connection only). */
  transitions: Transition[];
  /** Set while the service reports no servable batch. */
  unavailable: UnavailableInfo | null;
  /** The server marked the last snapshot as the stale→current recovery. */
  recovered: boolean;
  /** Message of the most recent stream error, for the banner. */
  lastError: string | null;
  /** The stream URL this tab is (or would be) subscribed to. */
  streamUrl: string;
}

const INITIAL: Posture = {
  streamState: "idle",
  hasBase: false,
  batch: null,
  batchReceiptId: null,
  engines: null,
  degradation: null,
  transitions: [],
  unavailable: null,
  recovered: false,
  lastError: null,
  streamUrl: "",
};

const PostureContext = createContext<Posture>(INITIAL);

export function usePosture(): Posture {
  return useContext(PostureContext);
}

// ---------------------------------------------------------------------------
// THE RECONNECT (Wave R6, Codex round-13 finding 1).
//
// The ribbon's batch arrives on the stream, so the ribbon had NO REPAIR PATH:
// when a blind resume left its age unmeasurable, all it could do was wait for
// the publishing loop to send another frame. A healthy stream that is merely
// QUIET — heartbeats, no new snapshot or batch — sends nothing for as long as
// nothing changes, so a batch received at 130s before a three-hour sleep kept
// rendering inside the one-hour threshold for another ~58 minutes.
//
// The contract already has the repair: `snapshot` is sent on EVERY connection,
// including a reconnect, before any tick. So the operation exposed here is not
// a poll and not a new endpoint — it is a TEARDOWN AND REOPEN, which obliges
// the server to re-deliver the base snapshot. That snapshot carries its own
// `served_at`, which becomes a NEW `batchReceiptId` through the path that
// already exists, and a new receipt is the only thing that discharges an
// unknown age.
//
// ONE reconnect per call. The bounded retry schedule lives in live-age.ts and
// is what keeps this from becoming a loop.
// ---------------------------------------------------------------------------

/**
 * Tear down the stream and reopen it. Resolves `true` when the new connection
 * delivers its base frame (a `snapshot`, or the server's `unavailable`
 * statement — both are receipts of a live answer), `false` when it does not
 * within `POSTURE_REFRESH_TIMEOUT_MS`.
 *
 * A `false` is not a claim that the service is down; it is only "no new receipt
 * yet", which is precisely what the caller needs to decide whether to retry.
 */
export type PostureRefresh = () => Promise<boolean>;

/**
 * How long a reconnect is given to produce a base frame before it is reported
 * as not-yet-delivered.
 *
 * Deliberately SHORTER than the first retry gap in `RESUME_RETRY_DELAYS_MS`
 * (5s), so the bounded schedule stays a schedule rather than drifting behind a
 * slow answer. The client's own base-frame deadline is far longer (45s) and
 * governs the STREAM's health; this governs one caller's patience.
 */
export const POSTURE_REFRESH_TIMEOUT_MS = 4_000;

const PostureRefreshContext = createContext<PostureRefresh>(() => Promise.resolve(false));

/**
 * The reconnect operation. Held in its own context so `Posture` stays what it
 * has always been — a projection of delivered state, with no verbs in it.
 */
export function usePostureRefresh(): PostureRefresh {
  return useContext(PostureRefreshContext);
}

export function PostureProvider({ children }: { children: ReactNode }) {
  const streamUrl = useMemo(() => solventStreamUrl(), []);
  const [posture, setPosture] = useState<Posture>({ ...INITIAL, streamUrl });

  /** The live stream, so a refresh can replace it. `close()` is permanent. */
  const streamRef = useRef<SolventStream | null>(null);
  /** Callers waiting on the NEXT base frame. Settled once, then dropped. */
  const baseWaitersRef = useRef<((delivered: boolean) => void)[]>([]);

  const settleBase = useCallback((delivered: boolean): void => {
    const waiting = baseWaitersRef.current;
    if (waiting.length === 0) return;
    baseWaitersRef.current = [];
    for (const resolve of waiting) resolve(delivered);
  }, []);

  const openStream = useCallback((): SolventStream => {
    const apply = (patch: Partial<Posture>) =>
      setPosture((previous) => ({ ...previous, ...patch }));

    const fromPayload = (payload: StreamPayload): Partial<Posture> => ({
      hasBase: true,
      batch: payload.batch,
      batchReceiptId:
        payload.batch === null ? null : receiptIdentity(payload.served_at, payload.batch.id),
      engines: payload.engines ?? null,
      degradation: payload.degradation ?? null,
      recovered: payload.recovered === true,
      unavailable: null,
      lastError: null,
    });

    const stream = new SolventStream(streamUrl, {
      // The bundled transport observes heartbeat COMMENTS (a native
      // EventSource cannot, by spec), so the watchdog measures real liveness.
      eventSourceFactory: fetchEventSource(),
      // 45s = 3× the server's 15s heartbeat cadence (the client README value).
      heartbeatTimeoutMs: 45_000,
      // A BASE FRAME IS A RECEIPT, and settling the waiters is what tells a
      // caller its reconnect produced one. `onBatch` counts too: a tick that
      // arrives before the reconnect's snapshot is still a fresher receipt than
      // the one the reader is holding.
      onSnapshot: (payload) => {
        apply(fromPayload(payload));
        settleBase(true);
      },
      onBatch: (payload) => {
        apply(fromPayload(payload));
        settleBase(true);
      },
      onDegradation: (payload) =>
        apply({
          degradation: payload.degradation ?? null,
          transitions: payload.transitions ?? [],
        }),
      onUnavailable: (payload) => {
        apply({
          hasBase: true,
          batch: payload.batch,
          batchReceiptId:
            payload.batch === null ? null : receiptIdentity(payload.served_at, payload.batch.id),
          unavailable: {
            reason: payload.reason ?? null,
            staleSinceSeconds: payload.stale_since_seconds ?? null,
            lastGoodBatchId: payload.last_good_batch_id ?? null,
          },
        });
        // The service's own "no servable batch" IS an answer, delivered on this
        // connection. The reconnect did its job; what it found is a separate
        // statement, and `unavailable` is the surface that carries it.
        settleBase(true);
      },
      onError: (error) => apply({ lastError: error.message }),
      onStateChange: (state) =>
        setPosture((previous) => ({
          ...previous,
          streamState: state,
          // A (re)connect attempt starts without a base until proven.
          hasBase: state === "open" ? previous.hasBase : false,
        })),
    });

    return stream;
  }, [streamUrl, settleBase]);

  useEffect(() => {
    streamRef.current = openStream();
    // Closes whatever is CURRENT, not what this effect opened: a refresh may
    // have replaced it since, and the replacement is the one still running.
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
      // Nobody is left to answer a pending wait — say so rather than leaving a
      // caller's repair promise hanging forever.
      settleBase(false);
    };
  }, [openStream, settleBase]);

  const refresh = useCallback<PostureRefresh>(() => {
    const delivered = new Promise<boolean>((resolve) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (deadline !== null) clearTimeout(deadline);
        resolve(ok);
      };
      baseWaitersRef.current.push(settle);
      deadline = setTimeout(() => {
        settle(false);
      }, POSTURE_REFRESH_TIMEOUT_MS);
    });
    // TEARDOWN, THEN REOPEN. `SolventStream.close()` is permanent by design, so
    // a refresh is a new instance — which is exactly what obliges the server to
    // re-run its snapshot-on-connect.
    streamRef.current?.close();
    streamRef.current = openStream();
    return delivered;
  }, [openStream]);

  return (
    <PostureContext.Provider value={posture}>
      <PostureRefreshContext.Provider value={refresh}>{children}</PostureRefreshContext.Provider>
    </PostureContext.Provider>
  );
}
