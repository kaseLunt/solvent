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
  useContext,
  useEffect,
  useMemo,
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

export function PostureProvider({ children }: { children: ReactNode }) {
  const streamUrl = useMemo(() => solventStreamUrl(), []);
  const [posture, setPosture] = useState<Posture>({ ...INITIAL, streamUrl });

  useEffect(() => {
    const apply = (patch: Partial<Posture>) =>
      setPosture((previous) => ({ ...previous, ...patch }));

    const fromPayload = (payload: StreamPayload): Partial<Posture> => ({
      hasBase: true,
      batch: payload.batch,
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
      onSnapshot: (payload) => apply(fromPayload(payload)),
      onBatch: (payload) => apply(fromPayload(payload)),
      onDegradation: (payload) =>
        apply({
          degradation: payload.degradation ?? null,
          transitions: payload.transitions ?? [],
        }),
      onUnavailable: (payload) =>
        apply({
          hasBase: true,
          batch: payload.batch,
          unavailable: {
            reason: payload.reason ?? null,
            staleSinceSeconds: payload.stale_since_seconds ?? null,
            lastGoodBatchId: payload.last_good_batch_id ?? null,
          },
        }),
      onError: (error) => apply({ lastError: error.message }),
      onStateChange: (state) =>
        setPosture((previous) => ({
          ...previous,
          streamState: state,
          // A (re)connect attempt starts without a base until proven.
          hasBase: state === "open" ? previous.hasBase : false,
        })),
    });

    return () => stream.close();
  }, [streamUrl]);

  return <PostureContext.Provider value={posture}>{children}</PostureContext.Provider>;
}
