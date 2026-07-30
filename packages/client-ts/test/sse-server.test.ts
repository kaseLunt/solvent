// Test category (4b): the SSE client against a REAL HTTP SERVER emitting the
// EXACT BYTES `cmd/api/sse.go` writes.
//
// The mock-transport suite proves the stream's logic. This one proves the wire
// parser: `event:` / `id:` / `data:` frames, `: heartbeat <unix>` COMMENT frames
// (which a native EventSource cannot see at all), frame boundaries that arrive
// split across TCP reads, and a server that closes the connection.
//
// The frame writer below is a transcription of `writeEvent`/`writeRaw` in
// cmd/api/sse.go:
//
//     frame  = "event: " + event + "\n"
//     frame += "id: " + id + "\n"        (only when id > 0)
//     frame += "data: " + json + "\n\n"
//     heartbeat = ": heartbeat " + unix + "\n\n"

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { SolventStream, StreamProtocolError, fetchEventSource } from "../src/index.js";
import type { SolventError, StreamEvent, StreamOptions } from "../src/index.js";
import * as fixtures from "./fixtures/index.js";
import { PINNED } from "./fixtures/index.js";

interface Conn {
  write(chunk: string): void;
  end(): void;
}

interface Fixture {
  url: string;
  /** Resolves with the next connection the server accepts. */
  next(): Promise<Conn>;
  connections: number;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Start a server that hands each accepted stream connection to the test. */
async function sseServer(): Promise<Fixture> {
  const waiting: ((conn: Conn) => void)[] = [];
  const ready: Conn[] = [];
  const fixture: Fixture = {
    url: "",
    connections: 0,
    next() {
      const queued = ready.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise<Conn>((resolve) => waiting.push(resolve));
    },
  };

  const server = createServer((req, res) => {
    if (req.url !== "/v1/stream") {
      res.writeHead(404).end();
      return;
    }
    // The headers cmd/api sets, including the anti-buffering opt-out.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    fixture.connections += 1;
    const conn: Conn = {
      write: (chunk) => void res.write(chunk),
      end: () => res.end(),
    };
    const waiter = waiting.shift();
    if (waiter === undefined) ready.push(conn);
    else waiter(conn);
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixture.url = `http://127.0.0.1:${address.port}/v1/stream`;
  return fixture;
}

/** The exact frame bytes cmd/api writes for a named event. */
function frame(event: string, payload: unknown, id?: number): string {
  let out = `event: ${event}\n`;
  if (id !== undefined && id > 0) out += `id: ${id}\n`;
  return `${out}data: ${JSON.stringify(payload)}\n\n`;
}

/** The exact heartbeat bytes: an SSE COMMENT, carrying no data. */
function heartbeat(unix: number): string {
  return `: heartbeat ${unix}\n\n`;
}

interface Collector {
  stream: SolventStream;
  events: StreamEvent[];
  errors: SolventError[];
  beats: (number | null)[];
  waitFor(count: number, what: string): Promise<void>;
}

function collect(url: string, options: StreamOptions = {}): Collector {
  const events: StreamEvent[] = [];
  const errors: SolventError[] = [];
  const beats: (number | null)[] = [];
  const stream = new SolventStream(url, {
    eventSourceFactory: fetchEventSource(),
    onEvent: (e) => events.push(e),
    onError: (e) => errors.push(e),
    onHeartbeat: (unix) => beats.push(unix),
    ...options,
  });
  return {
    stream,
    events,
    errors,
    beats,
    async waitFor(count, what) {
      const deadline = Date.now() + 5000;
      while (events.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${what}: got ${events.length} of ${count}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}

describe("the wire parser against real SSE bytes", () => {
  it("reads snapshot, batch and degradation frames in order", async () => {
    const server = await sseServer();
    const c = collect(server.url);
    try {
      const conn = await server.next();
      conn.write(frame("snapshot", fixtures.streamSnapshot, 1));
      conn.write(frame("batch", fixtures.streamBatch, 2));
      conn.write(frame("degradation", fixtures.streamDegradation, 2));
      await c.waitFor(3, "three named events");

      expect(c.events.map((e) => e.event)).toEqual(["snapshot", "batch", "degradation"]);
      expect(c.events.map((e) => e.id)).toEqual(["1", "2", "2"]);
      expect(c.events[0]?.isSnapshot).toBe(true);
      expect(c.events[0]?.payload.batch?.position_count).toBe(PINNED.batch.positionCount);
      expect(c.events[1]?.payload.batch?.id).toBe(2);
      expect(c.events[2]?.payload.transitions).toEqual([
        { key: "supersession|acked_epoch_moved", from: 0, to: 1 },
      ]);
      expect(c.errors).toEqual([]);
    } finally {
      c.stream.close();
    }
  });

  it("SEES the heartbeat comment frames a native EventSource cannot", async () => {
    const server = await sseServer();
    const c = collect(server.url);
    try {
      const conn = await server.next();
      conn.write(frame("snapshot", fixtures.streamSnapshot, 1));
      await c.waitFor(1, "the snapshot");
      conn.write(heartbeat(1_800_000_015));
      conn.write(heartbeat(1_800_000_030));

      const deadline = Date.now() + 5000;
      while (c.beats.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(c.beats).toEqual([1_800_000_015, 1_800_000_030]);
      // A comment is not an event: it must not reach the event callbacks.
      expect(c.events).toHaveLength(1);
      expect(c.errors).toEqual([]);
    } finally {
      c.stream.close();
    }
  });

  it("reassembles a frame split across TCP writes", async () => {
    const server = await sseServer();
    const c = collect(server.url);
    try {
      const conn = await server.next();
      const bytes = frame("snapshot", fixtures.streamSnapshot, 1);
      // Split mid-JSON, and again inside the terminating blank line.
      conn.write(bytes.slice(0, 40));
      await new Promise((resolve) => setTimeout(resolve, 10));
      conn.write(bytes.slice(40, bytes.length - 1));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(c.events).toHaveLength(0);
      conn.write(bytes.slice(bytes.length - 1));
      await c.waitFor(1, "the reassembled snapshot");
      expect(c.events[0]?.payload.batch?.position_count).toBe(PINNED.batch.positionCount);
    } finally {
      c.stream.close();
    }
  });

  it("handles CRLF line endings a proxy might rewrite", async () => {
    const server = await sseServer();
    const c = collect(server.url);
    try {
      const conn = await server.next();
      conn.write(frame("snapshot", fixtures.streamSnapshot, 1).replace(/\n/g, "\r\n"));
      await c.waitFor(1, "the snapshot");
      expect(c.events[0]?.event).toBe("snapshot");
      expect(c.errors).toEqual([]);
    } finally {
      c.stream.close();
    }
  });

  it("RECONNECTS with a fresh snapshot when the server closes the stream", async () => {
    const server = await sseServer();
    const c = collect(server.url, { reconnect: { minDelayMs: 10, maxDelayMs: 50, jitter: 0 } });
    try {
      const first = await server.next();
      first.write(frame("snapshot", fixtures.streamSnapshot, 1));
      await c.waitFor(1, "the first snapshot");
      first.end();

      const second = await server.next();
      second.write(frame("snapshot", fixtures.streamSnapshot, 1));
      await c.waitFor(2, "the reconnect snapshot");

      expect(server.connections).toBe(2);
      expect(c.events[1]?.isSnapshot).toBe(true);
      expect(c.events[1]?.isReconnect).toBe(true);
      expect(c.events[1]?.connection).toBe(2);
      expect(c.stream.connections).toBe(2);
      // The close was surfaced, not swallowed.
      expect(c.errors.some((e) => e.message.includes("closed the stream"))).toBe(true);
    } finally {
      c.stream.close();
    }
  });

  it("surfaces a non-200 on the stream route with the server's body", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "3" });
      res.end(fixtures.fixtureBytes(fixtures.FIXTURE_FILES.errorRateLimited));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const c = collect(`http://127.0.0.1:${port}/v1/stream`, {
      reconnect: { minDelayMs: 50, jitter: 0, maxAttempts: 1 },
    });
    try {
      const deadline = Date.now() + 5000;
      while (c.errors.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(c.errors[0]?.message).toContain("HTTP 429");
      expect(c.errors[0]?.message).toContain("rate_limited");
    } finally {
      c.stream.close();
    }
  });

  // -------------------------------------------------------------------------
  // Round-1 review fixes, proven over the real wire.
  //
  // H3: a CRLF split by a TCP read boundary exactly between \r and \n must not
  //     fabricate a frame boundary and destroy the event.
  // H4: a tick before the connection's snapshot is dropped, and the guaranteed
  //     reconnect snapshot re-establishes state.
  // M5: an HTTP 200 that closes before any frame is a FAILED attempt.
  // -------------------------------------------------------------------------

  const crlfCases = [
    { name: "snapshot", payload: fixtures.streamSnapshot, id: 1 },
    { name: "batch", payload: fixtures.streamBatch, id: 2 },
    { name: "degradation", payload: fixtures.streamDegradation, id: 2 },
  ] as const;

  for (const { name, payload, id } of crlfCases) {
    it(`survives a CRLF \`${name}\` frame split between \\r and \\n at EVERY line boundary`, async () => {
      const server = await sseServer();
      const c = collect(server.url);
      try {
        const conn = await server.next();
        // A base first, so snapshot-ordering handling cannot mask the parser.
        conn.write(frame("snapshot", fixtures.streamSnapshot, 1));
        await c.waitFor(1, "the base snapshot");

        const bytes = frame(name, payload, id).replace(/\n/g, "\r\n");
        // Every \r|\n boundary in the frame: after the `event:` line, after the
        // `id:` line, after the `data:` line, and inside the blank terminator.
        const splits: number[] = [];
        for (let i = 0; i < bytes.length - 1; i += 1) {
          if (bytes[i] === "\r" && bytes[i + 1] === "\n") splits.push(i + 1);
        }
        expect(splits.length).toBeGreaterThanOrEqual(4);

        let expected = 1;
        for (const at of splits) {
          conn.write(bytes.slice(0, at)); // this chunk ends exactly with "\r"
          await new Promise((resolve) => setTimeout(resolve, 15));
          conn.write(bytes.slice(at)); //   this one begins with "\n"
          expected += 1;
          await c.waitFor(expected, `the ${name} frame split at byte ${at}`);
          const event = c.events.at(-1);
          expect(event?.event).toBe(name);
          expect(event?.id).toBe(String(id));
          expect(event?.payload).toEqual(payload);
        }
        expect(c.errors).toEqual([]);
      } finally {
        c.stream.close();
      }
    });
  }

  it("drops a pre-snapshot tick and recovers via the reconnect snapshot (H4)", async () => {
    const server = await sseServer();
    const c = collect(server.url, { reconnect: { minDelayMs: 10, maxDelayMs: 50, jitter: 0 } });
    try {
      const first = await server.next();
      // Protocol violation: a tick with no snapshot before it.
      first.write(frame("batch", fixtures.streamBatch, 2));

      // The client must drop the connection and come back; the second
      // connection's snapshot is the base, and ordering is clean from there.
      const second = await server.next();
      second.write(frame("snapshot", fixtures.streamSnapshot, 1));
      second.write(frame("batch", fixtures.streamBatch, 2));
      await c.waitFor(2, "the snapshot and batch on the second connection");

      expect(c.events.map((e) => e.event)).toEqual(["snapshot", "batch"]);
      expect(c.events[0]?.connection).toBe(2);
      expect(c.events[0]?.isReconnect).toBe(true);
      expect(c.errors.some((e) => e instanceof StreamProtocolError)).toBe(true);
    } finally {
      c.stream.close();
    }
  });

  it("repeated HTTP 200s that close before any frame exhaust maxAttempts (M5)", async () => {
    let connections = 0;
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      connections += 1;
      // Accepted, opened... and closed before a single SSE frame.
      res.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const c = collect(`http://127.0.0.1:${port}/v1/stream`, {
      reconnect: { minDelayMs: 10, maxDelayMs: 40, jitter: 0, maxAttempts: 3 },
    });
    try {
      const deadline = Date.now() + 5000;
      while (c.stream.currentState !== "closed" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      // Each open-then-close was a FAILED attempt: backoff grew and the policy
      // terminated, rather than hammering attempt one forever.
      expect(c.stream.currentState).toBe("closed");
      expect(connections).toBe(3);
      expect(c.errors.some((e) => e.message.includes("giving up after 3"))).toBe(true);
    } finally {
      c.stream.close();
    }
  });

  it("stops reading the socket on close()", async () => {
    const server = await sseServer();
    const c = collect(server.url);
    const conn = await server.next();
    conn.write(frame("snapshot", fixtures.streamSnapshot, 1));
    await c.waitFor(1, "the snapshot");
    c.stream.close();

    conn.write(frame("batch", fixtures.streamBatch, 2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(c.events).toHaveLength(1);
    expect(c.stream.currentState).toBe("closed");
  });
});
