// Test category (4a): the SSE client against a MOCK TRANSPORT.
//
// Everything about the stream's own logic is deterministic here — timers and
// randomness are injected — so the reconnect backoff and the heartbeat watchdog
// are checked as arithmetic rather than as a race.
//
// `sse-server.test.ts` covers the other half: real SSE bytes over a real socket.

import { describe, expect, it } from "vitest";

import {
  HeartbeatTimeoutError,
  MalformedResponseError,
  SolventClient,
  SolventStream,
  StreamProtocolError,
  StreamTransportError,
} from "../src/index.js";
import type {
  EventSourceLike,
  MessageLike,
  SolventError,
  StreamEvent,
  StreamOptions,
  StreamScheduler,
  StreamState,
} from "../src/index.js";
import * as fixtures from "./fixtures/index.js";
import { PINNED } from "./fixtures/index.js";

// ---------------------------------------------------------------------------
// A mock SSE server: one EventSourceLike per connection, driven by the test.
// ---------------------------------------------------------------------------

class MockSource implements EventSourceLike {
  readonly listeners = new Map<string, ((event: MessageLike) => void)[]>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageLike) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [listener]);
    else existing.push(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver a named event carrying a JSON payload. */
  emit(type: string, payload: unknown, id?: string): void {
    this.dispatch(type, {
      data: typeof payload === "string" ? payload : JSON.stringify(payload),
      ...(id === undefined ? {} : { lastEventId: id }),
    });
  }

  /** Deliver a heartbeat comment, as `fetchEventSource` surfaces it. */
  beat(unix: number): void {
    this.dispatch("heartbeat", { data: `heartbeat ${unix}` });
  }

  open(): void {
    this.dispatch("open", {});
  }

  fail(detail?: string): void {
    this.dispatch("error", detail === undefined ? {} : { data: detail });
  }

  private dispatch(type: string, event: MessageLike): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** A scheduler whose clock only moves when the test says so. */
class FakeScheduler implements StreamScheduler {
  private time = 0;
  private nextId = 1;
  private randoms: number[] = [];
  readonly timers = new Map<number, { at: number; handler: () => void }>();

  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, handler });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  now(): number {
    return this.time;
  }

  random(): number {
    return this.randoms.shift() ?? 0.5;
  }

  queueRandom(...values: number[]): void {
    this.randoms.push(...values);
  }

  /** Advance the clock, firing every timer whose deadline passes. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.handler();
    }
    this.time = target;
  }

  /** Delays of the timers currently pending, for asserting on backoff. */
  pendingDelays(): number[] {
    return [...this.timers.values()].map((t) => t.at - this.time).sort((a, b) => a - b);
  }
}

interface Harness {
  stream: SolventStream;
  scheduler: FakeScheduler;
  sources: MockSource[];
  events: StreamEvent[];
  errors: SolventError[];
  states: StreamState[];
  beats: (number | null)[];
  latest(): MockSource;
}

function harness(options: Partial<StreamOptions> = {}): Harness {
  const scheduler = new FakeScheduler();
  const sources: MockSource[] = [];
  const events: StreamEvent[] = [];
  const errors: SolventError[] = [];
  const states: StreamState[] = [];
  const beats: (number | null)[] = [];

  const stream = new SolventStream("http://localhost:8080/v1/stream", {
    scheduler,
    eventSourceFactory: (url) => {
      const source = new MockSource(url);
      sources.push(source);
      return source;
    },
    onEvent: (e) => events.push(e),
    onError: (e) => errors.push(e),
    onStateChange: (s) => states.push(s),
    onHeartbeat: (unix) => beats.push(unix),
    ...options,
  });

  return {
    stream,
    scheduler,
    sources,
    events,
    errors,
    states,
    beats,
    latest: () => {
      const source = sources.at(-1);
      if (source === undefined) throw new Error("no connection was opened");
      return source;
    },
  };
}

// ---------------------------------------------------------------------------
// Connect + snapshot.
// ---------------------------------------------------------------------------

describe("connect", () => {
  it("opens a connection to /v1/stream and reports connecting", () => {
    const h = harness();
    expect(h.sources).toHaveLength(1);
    expect(h.latest().url).toBe("http://localhost:8080/v1/stream");
    expect(h.states).toEqual(["connecting"]);
    expect(h.stream.connections).toBe(1);
  });

  it("does not connect when autoConnect is off, and connects on demand", () => {
    const h = harness({ autoConnect: false });
    expect(h.sources).toHaveLength(0);
    h.stream.connect();
    expect(h.sources).toHaveLength(1);
  });

  it("is built from the client with the client's base URL", () => {
    const client = new SolventClient({ baseUrl: "http://localhost:8080", fetch: () => Promise.reject(new Error()) });
    const urls: string[] = [];
    const stream = client.stream({
      eventSourceFactory: (url) => {
        urls.push(url);
        return new MockSource(url);
      },
    });
    expect(urls).toEqual(["http://localhost:8080/v1/stream"]);
    stream.close();
  });
});

describe("snapshot-on-connect", () => {
  it("delivers the snapshot with its connection context", () => {
    const snapshots: StreamEvent[] = [];
    const h = harness({ onSnapshot: (_payload, event) => snapshots.push(event) });
    h.latest().open();
    h.latest().emit("snapshot", fixtures.streamSnapshot, "1");

    expect(snapshots).toHaveLength(1);
    const event = snapshots[0] as StreamEvent;
    expect(event.event).toBe("snapshot");
    expect(event.isSnapshot).toBe(true);
    expect(event.isReconnect).toBe(false);
    expect(event.connection).toBe(1);
    expect(event.id).toBe("1");
    expect(h.stream.currentState).toBe("open");
  });

  it("carries the whole posture: engines, degradation and the batch envelope", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    const payload = (h.events[0] as StreamEvent).payload;
    expect(payload.batch?.position_count).toBe(PINNED.batch.positionCount);
    expect(payload.engines).toHaveLength(2);
    expect(payload.degradation?.engines).toHaveLength(2);
    expect(payload.listener_connected).toBe(true);
    // A tick means "a new batch at watermark vector V", never "a new block".
    expect(payload.note).toContain("NEVER means `a new block`");
  });

  it("marks every LATER connection's snapshot as a reconnect", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().fail();
    h.scheduler.advance(60_000);
    h.latest().emit("snapshot", fixtures.streamSnapshot);

    const snapshots = h.events.filter((e) => e.isSnapshot);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.isReconnect).toBe(false);
    expect(snapshots[1]?.isReconnect).toBe(true);
    expect(snapshots[1]?.connection).toBe(2);
  });

  it("SURFACES a tick that arrives before any snapshot, and still delivers it", () => {
    const h = harness();
    h.latest().emit("batch", fixtures.streamBatch);

    expect(h.errors).toHaveLength(1);
    const error = h.errors[0] as StreamProtocolError;
    expect(error).toBeInstanceOf(StreamProtocolError);
    expect(error.event).toBe("batch");
    expect(error.connection).toBe(1);
    expect(error.message).toContain("before a snapshot");
    // Dropping the tick would hide the very thing worth knowing.
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.event).toBe("batch");
  });

  it("accepts `unavailable` as a base — no batch is still a posture", () => {
    const h = harness();
    h.latest().emit("unavailable", fixtures.streamUnavailable);
    h.latest().emit("batch", fixtures.streamBatch);
    expect(h.errors).toEqual([]);
    expect(h.events.map((e) => e.event)).toEqual(["unavailable", "batch"]);
  });
});

// ---------------------------------------------------------------------------
// Ticks and degradation.
// ---------------------------------------------------------------------------

describe("event discrimination on the wire names", () => {
  it("routes each of the four names to its own callback", () => {
    const seen: string[] = [];
    const h = harness({
      onSnapshot: () => seen.push("snapshot"),
      onBatch: () => seen.push("batch"),
      onDegradation: () => seen.push("degradation"),
      onUnavailable: () => seen.push("unavailable"),
    });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().emit("batch", fixtures.streamBatch);
    h.latest().emit("degradation", fixtures.streamDegradation);
    h.latest().emit("unavailable", fixtures.streamUnavailable);
    expect(seen).toEqual(["snapshot", "batch", "degradation", "unavailable"]);
    expect(h.events.map((e) => e.event)).toEqual(["snapshot", "batch", "degradation", "unavailable"]);
    expect(h.errors).toEqual([]);
  });

  it("a batch tick carries the new batch id, never a block", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot, "1");
    h.latest().emit("batch", fixtures.streamBatch, "2");
    const tick = h.events[1] as StreamEvent;
    expect(tick.event).toBe("batch");
    expect(tick.id).toBe("2");
    expect(tick.payload.batch?.id).toBe(2);
    expect(tick.payload.batch?.watermarks).toHaveLength(PINNED.batch.watermarkCount);
  });

  it("a degradation event carries the transition list and the fired leg", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().emit("degradation", fixtures.streamDegradation);
    const payload = (h.events[1] as StreamEvent).payload;
    expect(payload.transitions).toEqual([{ key: "supersession|acked_epoch_moved", from: 0, to: 1 }]);
    expect(payload.degradation?.superseded).toBe(true);
    expect(payload.degradation?.supersession_legs).toEqual(["acked_epoch_moved"]);
    // The refusal posture is named and counted, per engine.
    const aave = payload.degradation?.engines.find((e) => e.engine === PINNED.engines.aave);
    expect(aave?.refusals).toEqual([{ key: PINNED.aave.refusedRefusalCode, count: 1 }]);
  });

  it("reports the server's `recovered` flag rather than inferring the transition", () => {
    const h = harness();
    h.latest().emit("unavailable", fixtures.streamUnavailable);
    h.latest().emit("snapshot", fixtures.streamSnapshotRecovered);
    expect(h.events[0]?.recovered).toBe(false);
    // The explicit stale-to-current transition, read off the payload — never
    // guessed from whether the batch id happened to move.
    expect(h.events[1]?.recovered).toBe(true);
    expect(h.events[1]?.isSnapshot).toBe(true);
  });

  it("passes through how long a held read has been stale", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().emit("unavailable", fixtures.streamUnavailableStale);
    const payload = (h.events[1] as StreamEvent).payload;
    // Without these a client cannot tell a hiccup from an outage it has been
    // rendering through.
    expect(payload.stale_since_seconds).toBe(240);
    expect(payload.last_good_batch_id).toBe(1);
    expect(payload.batch).toBeNull();
  });

  it("an unavailable event says it is about the SERVICE", () => {
    const h = harness();
    h.latest().emit("unavailable", fixtures.streamUnavailable);
    const payload = (h.events[0] as StreamEvent).payload;
    expect(payload.batch).toBeNull();
    expect(payload.engines).toBeNull();
    expect(payload.reason).toContain("not a claim that the book is empty");
    expect(payload.listener_connected).toBe(false);
  });

  it("reports a frame whose data is not JSON and drops only that frame", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().emit("batch", "{not json");
    h.latest().emit("batch", fixtures.streamBatch);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toBeInstanceOf(MalformedResponseError);
    expect(h.events.map((e) => e.event)).toEqual(["snapshot", "batch"]);
  });

  it("reports a frame with no data field at all", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    // Dispatched directly, because `emit` always attaches a data field.
    for (const listener of h.latest().listeners.get("batch") ?? []) listener({});
    expect(h.errors[0]).toBeInstanceOf(MalformedResponseError);
    expect((h.errors[0] as MalformedResponseError).message).toContain("no data field");
  });
});

// ---------------------------------------------------------------------------
// Reconnect with jittered backoff.
// ---------------------------------------------------------------------------

describe("reconnect", () => {
  it("closes the failed source and comes back with a fresh connection", () => {
    const h = harness({ reconnect: { minDelayMs: 100, jitter: 0 } });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    const first = h.latest();
    first.fail("the event stream disconnected");

    expect(h.errors[0]).toBeInstanceOf(StreamTransportError);
    // Closing is what stops the native EventSource's own fixed-interval retry
    // from fighting this policy.
    expect(first.closed).toBe(true);
    expect(h.stream.currentState).toBe("waiting");
    expect(h.sources).toHaveLength(1);

    h.scheduler.advance(100);
    expect(h.sources).toHaveLength(2);
    expect(h.stream.connections).toBe(2);
  });

  it("backs off exponentially and caps at maxDelayMs", () => {
    const h = harness({
      autoConnect: false,
      reconnect: { minDelayMs: 500, maxDelayMs: 30_000, jitter: 0 },
    });
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((attempt) => h.stream.backoffDelayMs(attempt));
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("applies FULL JITTER as a uniform draw below the exponential base", () => {
    const h = harness({ autoConnect: false, reconnect: { minDelayMs: 1000, jitter: 1 } });
    h.scheduler.queueRandom(0, 0.25, 1);
    expect(h.stream.backoffDelayMs(1)).toBe(1000); // 1000 * (1 - 1*0)
    expect(h.stream.backoffDelayMs(1)).toBe(750); //  1000 * (1 - 1*0.25)
    expect(h.stream.backoffDelayMs(1)).toBe(0); //    1000 * (1 - 1*1)
  });

  it("halves the window at the default jitter of 0.5", () => {
    const h = harness({ autoConnect: false, reconnect: { minDelayMs: 1000 } });
    h.scheduler.queueRandom(0, 1);
    expect(h.stream.backoffDelayMs(1)).toBe(1000);
    expect(h.stream.backoffDelayMs(1)).toBe(500);
  });

  it("schedules each successive failure further out", () => {
    const h = harness({ reconnect: { minDelayMs: 200, jitter: 0 } });
    h.latest().fail();
    expect(h.scheduler.pendingDelays()).toEqual([200]);
    h.scheduler.advance(200);
    h.latest().fail();
    expect(h.scheduler.pendingDelays()).toEqual([400]);
    h.scheduler.advance(400);
    h.latest().fail();
    expect(h.scheduler.pendingDelays()).toEqual([800]);
  });

  it("resets the backoff once a connection delivers a frame", () => {
    const h = harness({ reconnect: { minDelayMs: 200, jitter: 0 } });
    h.latest().fail();
    h.scheduler.advance(200);
    h.latest().fail();
    h.scheduler.advance(400);
    // A healthy connection: snapshot arrives.
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().fail();
    expect(h.scheduler.pendingDelays()).toEqual([200]);
  });

  it("gives up after maxAttempts and closes rather than looping forever", () => {
    const h = harness({ reconnect: { minDelayMs: 10, jitter: 0, maxAttempts: 3 } });
    h.latest().fail();
    h.scheduler.advance(10);
    h.latest().fail();
    h.scheduler.advance(20);
    h.latest().fail();
    expect(h.stream.currentState).toBe("closed");
    expect((h.errors.at(-1) as StreamTransportError).message).toContain("giving up after 3");
    h.scheduler.advance(100_000);
    expect(h.sources).toHaveLength(3);
  });

  it("stops everything on close(), with no further callbacks", () => {
    const h = harness({ reconnect: { minDelayMs: 10, jitter: 0 } });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    const source = h.latest();
    h.stream.close();
    expect(source.closed).toBe(true);
    expect(h.stream.currentState).toBe("closed");

    const before = h.events.length;
    source.emit("batch", fixtures.streamBatch);
    h.scheduler.advance(100_000);
    expect(h.events).toHaveLength(before);
    expect(h.sources).toHaveLength(1);
    // Idempotent.
    h.stream.close();
  });

  it("ignores frames from a superseded connection", () => {
    const h = harness({ reconnect: { minDelayMs: 10, jitter: 0 } });
    const stale = h.latest();
    stale.emit("snapshot", fixtures.streamSnapshot);
    stale.fail();
    h.scheduler.advance(10);
    expect(h.sources).toHaveLength(2);

    const before = h.events.length;
    stale.emit("batch", fixtures.streamBatch);
    expect(h.events).toHaveLength(before);
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    expect(h.events).toHaveLength(before + 1);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat timeout.
// ---------------------------------------------------------------------------

describe("heartbeat timeout", () => {
  it("is OFF by default — an unset timeout never fires", () => {
    const h = harness();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.scheduler.advance(10 * 60 * 1000);
    expect(h.errors).toEqual([]);
    expect(h.sources).toHaveLength(1);
  });

  it("surfaces the stall and reconnects when no frame arrives in the window", () => {
    const h = harness({ heartbeatTimeoutMs: 45_000, reconnect: { minDelayMs: 100, jitter: 0 } });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    const stalled = h.latest();

    h.scheduler.advance(44_999);
    expect(h.errors).toEqual([]);

    h.scheduler.advance(2);
    const error = h.errors[0] as HeartbeatTimeoutError;
    expect(error).toBeInstanceOf(HeartbeatTimeoutError);
    expect(error.timeoutMs).toBe(45_000);
    expect(error.msSinceLastFrame).toBeGreaterThanOrEqual(45_000);
    // A stalled connection is a dead connection.
    expect(stalled.closed).toBe(true);
    h.scheduler.advance(100);
    expect(h.sources).toHaveLength(2);
  });

  it("is kept alive by HEARTBEAT COMMENT frames on an otherwise silent stream", () => {
    const h = harness({ heartbeatTimeoutMs: 45_000 });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    // The server sends a comment every 15s and no events at all.
    for (let i = 1; i <= 20; i += 1) {
      h.scheduler.advance(15_000);
      h.latest().beat(1_800_000_000 + i * 15);
    }
    expect(h.errors).toEqual([]);
    expect(h.sources).toHaveLength(1);
    expect(h.beats).toHaveLength(20);
    expect(h.beats[0]).toBe(1_800_000_015);
  });

  it("is kept alive by a named event too", () => {
    const h = harness({ heartbeatTimeoutMs: 45_000 });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.scheduler.advance(40_000);
    h.latest().emit("batch", fixtures.streamBatch);
    h.scheduler.advance(40_000);
    expect(h.errors).toEqual([]);
  });

  it("fires once the heartbeats stop, not on the first quiet tick", () => {
    const h = harness({ heartbeatTimeoutMs: 45_000, reconnect: { minDelayMs: 100, jitter: 0 } });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.scheduler.advance(30_000);
    h.latest().beat(1_800_000_030);
    // Silence from here.
    h.scheduler.advance(30_000);
    expect(h.errors).toEqual([]);
    h.scheduler.advance(20_000);
    expect(h.errors[0]).toBeInstanceOf(HeartbeatTimeoutError);
  });

  it("reports an unparsable heartbeat stamp as null rather than NaN", () => {
    const h = harness({ heartbeatTimeoutMs: 45_000 });
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    for (const listener of h.latest().listeners.get("heartbeat") ?? []) {
      listener({ data: "heartbeat not-a-number" });
    }
    expect(h.beats).toEqual([null]);
    // It still counts as activity: the frame arrived.
    h.scheduler.advance(44_000);
    expect(h.errors).toEqual([]);
  });
});

describe("state transitions are observable", () => {
  it("walks connecting -> open -> waiting -> connecting -> open", () => {
    const h = harness({ reconnect: { minDelayMs: 50, jitter: 0 } });
    h.latest().open();
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    h.latest().fail();
    h.scheduler.advance(50);
    h.latest().emit("snapshot", fixtures.streamSnapshot);
    expect(h.states).toEqual(["connecting", "open", "waiting", "connecting", "open"]);
  });

  it("reports a factory that throws as a transport error and retries", () => {
    const scheduler = new FakeScheduler();
    const errors: SolventError[] = [];
    let attempts = 0;
    const stream = new SolventStream("http://localhost:8080/v1/stream", {
      scheduler,
      reconnect: { minDelayMs: 25, jitter: 0 },
      onError: (e) => errors.push(e),
      eventSourceFactory: () => {
        attempts += 1;
        if (attempts < 3) throw new Error("no transport");
        return new MockSource("http://localhost:8080/v1/stream");
      },
    });
    expect(errors[0]).toBeInstanceOf(StreamTransportError);
    scheduler.advance(25);
    scheduler.advance(50);
    expect(attempts).toBe(3);
    stream.close();
  });

  it("refuses to construct without a transport in a runtime that has no EventSource", () => {
    const saved = (globalThis as { EventSource?: unknown }).EventSource;
    delete (globalThis as { EventSource?: unknown }).EventSource;
    try {
      expect(() => new SolventStream("http://localhost:8080/v1/stream")).toThrow(StreamTransportError);
      expect(() => new SolventStream("http://localhost:8080/v1/stream")).toThrow(/fetchEventSource/);
    } finally {
      if (saved !== undefined) (globalThis as { EventSource?: unknown }).EventSource = saved;
    }
  });
});
