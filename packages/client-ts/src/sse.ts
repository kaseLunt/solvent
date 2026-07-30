// `GET /v1/stream` — the Server-Sent Events client.
//
// # What the server promises (openapi.yaml, /v1/stream)
//
//  snapshot      sent on EVERY connection, including a reconnect, before any
//                tick. A consumer is never left inferring state from deltas it
//                did not see.
//  batch         a new servable batch at a watermark vector — never "a new
//                block". This service makes no chain calls.
//  degradation   a transition in the refusal / flag / supersession posture,
//                carrying the transition list.
//  unavailable   no servable batch. A statement about the SERVICE.
//  heartbeat     an SSE COMMENT frame (`: heartbeat <unix>`), carrying no data.
//
// # Three things this client does that a bare EventSource does not
//
//  1. Reconnect on OUR terms. `EventSource` reconnects itself on a fixed
//     interval; this client closes the source on error and reconnects with
//     jittered exponential backoff, so a thousand browsers do not return in
//     lockstep after an outage.
//  2. Surface snapshot-on-connect. Each connection is numbered and every
//     delivered event says which connection it belongs to and whether that
//     connection was a reconnect — so a consumer can reset its view on the
//     snapshot rather than merging a fresh snapshot into stale state.
//  3. Watch for silence. A stalled TCP connection looks identical to an idle
//     one; the configurable frame timeout is what distinguishes them.
//
// # The heartbeat caveat, stated plainly
//
// Heartbeats are SSE COMMENT frames, and a browser's native `EventSource` does
// not expose comments to JavaScript — by specification. With the native
// transport the timeout therefore measures time since the last NAMED EVENT, so
// it must be set above the batch cadence or it will fire on a healthy but quiet
// stream. Use the bundled `fetchEventSource` transport to observe the actual
// heartbeat comments; it is what the tests use, and it is the honest choice for
// a monitoring consumer.

import {
  HeartbeatTimeoutError,
  MalformedResponseError,
  SolventError,
  StreamProtocolError,
  StreamTransportError,
} from "./errors.js";
import type { StreamPayload } from "./types.js";

// ---------------------------------------------------------------------------
// The transport seam.
// ---------------------------------------------------------------------------

/** The shape of one delivered frame. A browser `MessageEvent` satisfies it. */
export interface MessageLike {
  readonly data?: string | undefined;
  readonly lastEventId?: string | undefined;
}

/**
 * The subset of `EventSource` this client uses. A browser's native
 * `EventSource` satisfies it, and so does `fetchEventSource`.
 *
 * `heartbeat` is a type the native implementation never emits (comments are
 * invisible to it) and `fetchEventSource` does — registering a listener for it
 * is harmless either way.
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageLike) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** The contract's closed set of event names. */
export const STREAM_EVENTS = ["snapshot", "batch", "degradation", "unavailable"] as const;
export type StreamEventName = (typeof STREAM_EVENTS)[number];

/** One delivered event, with the connection context the contract makes meaningful. */
export interface StreamEvent {
  event: StreamEventName;
  payload: StreamPayload;
  /** SSE `id:` — the batch id, when the server sent one. */
  id: string | null;
  /** 1-based connection counter. It increments on every (re)connect. */
  connection: number;
  /** True for every connection after the first. */
  isReconnect: boolean;
  /** True when this is the connect-time snapshot rather than a later tick. */
  isSnapshot: boolean;
  /**
   * The server's own `recovered` flag: this snapshot marks the explicit
   * stale-to-current transition after a failure. It is read from the payload
   * rather than inferred from whether the batch id happened to move.
   */
  recovered: boolean;
}

export type StreamState = "idle" | "connecting" | "open" | "waiting" | "closed";

export interface ReconnectPolicy {
  /** First delay. Default 500. */
  minDelayMs?: number;
  /** Ceiling on the exponential term. Default 30000. */
  maxDelayMs?: number;
  /**
   * Jitter fraction in [0, 1]. The actual delay is drawn uniformly from
   * `[base * (1 - jitter), base]`; 1 is full jitter. Default 0.5.
   */
  jitter?: number;
  /** Stop after this many consecutive failed connections. Default Infinity. */
  maxAttempts?: number;
}

/** Injectable timers and randomness, so backoff is deterministic under test. */
export interface StreamScheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
  random(): number;
}

export interface StreamOptions {
  /** Every delivered event, in arrival order, after the type-specific callbacks. */
  onEvent?: (event: StreamEvent) => void;
  onSnapshot?: (payload: StreamPayload, event: StreamEvent) => void;
  onBatch?: (payload: StreamPayload, event: StreamEvent) => void;
  onDegradation?: (payload: StreamPayload, event: StreamEvent) => void;
  onUnavailable?: (payload: StreamPayload, event: StreamEvent) => void;
  /** A heartbeat comment. The unix second the server stamped, or null if unparsable. */
  onHeartbeat?: (unixSeconds: number | null) => void;
  /** Every failure. The stream keeps running unless `close()` is called. */
  onError?: (error: SolventError) => void;
  onStateChange?: (state: StreamState) => void;

  /** Transport. Defaults to the runtime's global `EventSource`. */
  eventSourceFactory?: EventSourceFactory;
  /**
   * Treat the connection as dead after this many ms with no frame. 0 disables.
   * Default 0 — opt-in, because the right value depends on the transport (see
   * the heartbeat caveat at the top of this file).
   */
  heartbeatTimeoutMs?: number;
  reconnect?: ReconnectPolicy;
  scheduler?: StreamScheduler;
  /** Connect on construction. Default true. */
  autoConnect?: boolean;
}

const defaultScheduler: StreamScheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  random: () => Math.random(),
};

export class SolventStream {
  readonly url: string;

  private readonly options: StreamOptions;
  private readonly scheduler: StreamScheduler;
  private readonly factory: EventSourceFactory;
  private readonly policy: Required<ReconnectPolicy>;

  private source: EventSourceLike | null = null;
  private state: StreamState = "idle";
  private connectionCount = 0;
  private failedAttempts = 0;
  /** Set once a connection has delivered its snapshot (or unavailable). */
  private baseReceived = false;
  private lastFrameAt = 0;
  private watchdog: unknown = null;
  private retryTimer: unknown = null;
  private closed = false;

  constructor(url: string, options: StreamOptions = {}) {
    this.url = url;
    this.options = options;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.policy = {
      minDelayMs: options.reconnect?.minDelayMs ?? 500,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 30_000,
      jitter: options.reconnect?.jitter ?? 0.5,
      maxAttempts: options.reconnect?.maxAttempts ?? Number.POSITIVE_INFINITY,
    };

    const injected = options.eventSourceFactory;
    if (injected !== undefined) {
      this.factory = injected;
    } else {
      const Native = (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
      if (Native === undefined) {
        throw new StreamTransportError(
          url,
          0,
          "no global EventSource in this runtime: pass `eventSourceFactory` " +
            "(this package exports `fetchEventSource`, which also observes heartbeat comments)",
        );
      }
      this.factory = (target) => new Native(target);
    }

    if (options.autoConnect !== false) this.connect();
  }

  /** The current state. */
  get currentState(): StreamState {
    return this.state;
  }

  /** How many connections this stream has opened, including the live one. */
  get connections(): number {
    return this.connectionCount;
  }

  /** Open a connection. A no-op when one is already open or pending. */
  connect(): void {
    if (this.closed) return;
    if (this.state === "connecting" || this.state === "open") return;
    this.clearRetryTimer();
    this.connectionCount += 1;
    this.baseReceived = false;
    this.setState("connecting");

    const connection = this.connectionCount;
    let source: EventSourceLike;
    try {
      source = this.factory(this.url);
    } catch (cause) {
      this.raise(new StreamTransportError(this.url, connection, `opening the stream failed: ${message(cause)}`, cause));
      this.scheduleReconnect();
      return;
    }
    this.source = source;

    for (const name of STREAM_EVENTS) {
      source.addEventListener(name, (event) => this.onFrame(name, event, connection));
    }
    // Comment frames, from a transport that surfaces them.
    source.addEventListener("heartbeat", (event) => this.onHeartbeatFrame(event, connection));
    source.addEventListener("open", () => {
      if (connection !== this.connectionCount || this.closed) return;
      this.failedAttempts = 0;
      this.touch();
      this.setState("open");
    });
    source.addEventListener("error", (event) => this.onTransportError(event, connection));

    this.touch();
  }

  /** Close the stream permanently. Idempotent; no further callbacks fire. */
  close(): void {
    this.closed = true;
    this.teardown();
    this.setState("closed");
  }

  // -------------------------------------------------------------------------
  // Frame handling.
  // -------------------------------------------------------------------------

  private onFrame(name: StreamEventName, event: MessageLike, connection: number): void {
    if (this.closed || connection !== this.connectionCount) return;
    this.failedAttempts = 0;
    this.touch();
    if (this.state !== "open") this.setState("open");

    const data = event.data;
    if (typeof data !== "string" || data.length === 0) {
      this.raise(
        new MalformedResponseError(this.url, 200, "", `a \`${name}\` frame carried no data field`),
      );
      return;
    }

    let payload: StreamPayload;
    try {
      payload = JSON.parse(data) as StreamPayload;
    } catch (cause) {
      this.raise(
        new MalformedResponseError(
          this.url,
          200,
          data.length > 2048 ? `${data.slice(0, 2048)}…` : data,
          `a \`${name}\` frame's data was not JSON: ${message(cause)}`,
          cause,
        ),
      );
      return;
    }

    // SNAPSHOT-ON-CONNECT, enforced. `snapshot` and `unavailable` are the two
    // frames that establish a base; anything else arriving first means the
    // consumer would be merging a delta into state it never saw. The violation
    // is REPORTED and the event is still delivered — silently dropping a tick
    // would hide the very thing worth knowing.
    const establishesBase = name === "snapshot" || name === "unavailable";
    if (!this.baseReceived && !establishesBase) {
      this.raise(
        new StreamProtocolError(
          name,
          connection,
          `connection ${connection} delivered \`${name}\` before a snapshot: the contract ` +
            `sends a snapshot on EVERY connection before any tick. The event is still ` +
            `delivered, but it is a delta over a base this consumer never received`,
        ),
      );
    }
    if (establishesBase) this.baseReceived = true;

    const delivered: StreamEvent = {
      event: name,
      payload,
      id: typeof event.lastEventId === "string" && event.lastEventId.length > 0 ? event.lastEventId : null,
      connection,
      isReconnect: connection > 1,
      isSnapshot: name === "snapshot",
      recovered: payload.recovered === true,
    };

    switch (name) {
      case "snapshot":
        this.options.onSnapshot?.(payload, delivered);
        break;
      case "batch":
        this.options.onBatch?.(payload, delivered);
        break;
      case "degradation":
        this.options.onDegradation?.(payload, delivered);
        break;
      case "unavailable":
        this.options.onUnavailable?.(payload, delivered);
        break;
    }
    this.options.onEvent?.(delivered);
  }

  private onHeartbeatFrame(event: MessageLike, connection: number): void {
    if (this.closed || connection !== this.connectionCount) return;
    this.failedAttempts = 0;
    this.touch();
    const raw = (event.data ?? "").replace(/^heartbeat\s*/, "").trim();
    const unix = /^[0-9]+$/.test(raw) ? Number(raw) : null;
    this.options.onHeartbeat?.(unix);
  }

  private onTransportError(event: MessageLike, connection: number): void {
    if (this.closed || connection !== this.connectionCount) return;
    const detail = typeof event.data === "string" && event.data.length > 0 ? `: ${event.data}` : "";
    this.raise(new StreamTransportError(this.url, connection, `the event stream disconnected${detail}`));
    this.scheduleReconnect();
  }

  // -------------------------------------------------------------------------
  // Liveness + reconnection.
  // -------------------------------------------------------------------------

  /** Record activity and re-arm the watchdog. */
  private touch(): void {
    this.lastFrameAt = this.scheduler.now();
    this.armWatchdog();
  }

  private armWatchdog(delayMs?: number): void {
    const timeout = this.options.heartbeatTimeoutMs ?? 0;
    this.clearWatchdog();
    if (timeout <= 0 || this.closed) return;
    this.watchdog = this.scheduler.setTimeout(() => {
      this.watchdog = null;
      if (this.closed) return;
      const elapsed = this.scheduler.now() - this.lastFrameAt;
      if (elapsed < timeout) {
        // A frame landed after this timer was armed; wait out the remainder
        // rather than declaring a stall that has not happened.
        this.armWatchdog(timeout - elapsed);
        return;
      }
      this.raise(new HeartbeatTimeoutError(timeout, elapsed));
      // A stalled connection is a dead connection: drop it and come back.
      this.dropSource();
      this.scheduleReconnect();
    }, delayMs ?? timeout);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      this.scheduler.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.scheduler.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private dropSource(): void {
    const source = this.source;
    this.source = null;
    this.clearWatchdog();
    if (source !== null) {
      try {
        source.close();
      } catch {
        // A transport that throws on close has nothing left to tell us.
      }
    }
  }

  private teardown(): void {
    this.dropSource();
    this.clearRetryTimer();
  }

  /**
   * The jittered exponential delay for attempt `n` (1-based):
   * `base = min(maxDelay, minDelay * 2^(n-1))`, then a uniform draw from
   * `[base * (1 - jitter), base]`.
   */
  backoffDelayMs(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    const uncapped = this.policy.minDelayMs * 2 ** Math.min(exponent, 30);
    const base = Math.min(this.policy.maxDelayMs, uncapped);
    const jitter = Math.min(1, Math.max(0, this.policy.jitter));
    const factor = 1 - jitter * this.scheduler.random();
    return Math.max(0, Math.round(base * factor));
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.dropSource();
    this.failedAttempts += 1;
    if (this.failedAttempts >= this.policy.maxAttempts) {
      this.raise(
        new StreamTransportError(
          this.url,
          this.connectionCount,
          `giving up after ${this.failedAttempts} consecutive failed connections ` +
            `(reconnect.maxAttempts)`,
        ),
      );
      this.close();
      return;
    }
    this.setState("waiting");
    this.clearRetryTimer();
    const delay = this.backoffDelayMs(this.failedAttempts);
    this.retryTimer = this.scheduler.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private setState(state: StreamState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private raise(error: SolventError): void {
    const handler = this.options.onError;
    if (handler === undefined) return;
    handler(error);
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
