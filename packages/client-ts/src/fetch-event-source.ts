// An `EventSource`-shaped transport built on streaming `fetch`.
//
// # Why this exists
//
// Two things a native `EventSource` cannot do, both of which this contract needs:
//
//  1. See heartbeats. `/v1/stream`'s heartbeat is an SSE COMMENT frame
//     (`: heartbeat <unix>`), and the EventSource specification does not expose
//     comments to JavaScript. A monitoring consumer that wants to distinguish an
//     idle stream from a dead one must read the wire.
//  2. Run outside a browser without a polyfill dependency. Node has had
//     streaming `fetch` since 18; this file is ~150 lines of frame parsing and
//     keeps the package's runtime dependency count at zero.
//
// It is deliberately NOT a full EventSource: no `withCredentials`, and
// reconnection is `SolventStream`'s job (that is the point — see the jittered
// backoff there). It implements exactly `EventSourceLike`.

import type { EventSourceFactory, EventSourceLike, MessageLike } from "./sse.js";

/** The subset of a streaming `Response` this transport reads. */
export interface StreamResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
      cancel(): Promise<void>;
    };
  } | null;
  text?(): Promise<string>;
}

export type StreamFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<StreamResponseLike>;

export interface FetchEventSourceOptions {
  fetch?: StreamFetchLike;
  headers?: Record<string, string>;
}

/**
 * Build an `EventSourceFactory` backed by streaming `fetch`.
 *
 * ```ts
 * const stream = client.stream({
 *   eventSourceFactory: fetchEventSource(),
 *   heartbeatTimeoutMs: 45_000,          // real heartbeat detection
 *   onHeartbeat: (unix) => lastSeen = unix,
 * });
 * ```
 */
export function fetchEventSource(options: FetchEventSourceOptions = {}): EventSourceFactory {
  return (url) => new FetchEventSource(url, options);
}

type Listener = (event: MessageLike) => void;

class FetchEventSource implements EventSourceLike {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly controller = new AbortController();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly options: FetchEventSourceOptions,
  ) {
    // Deferred a turn so the caller can attach listeners before the first frame.
    queueMicrotask(() => {
      void this.run();
    });
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [listener]);
    else existing.push(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
  }

  private emit(type: string, event: MessageLike): void {
    if (this.closed) return;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private fail(detail: string): void {
    if (this.closed) return;
    this.emit("error", { data: detail });
  }

  private async run(): Promise<void> {
    const impl = this.options.fetch ?? (globalThis as { fetch?: StreamFetchLike }).fetch;
    if (impl === undefined) {
      this.fail("no global fetch in this runtime");
      return;
    }

    let response: StreamResponseLike;
    try {
      response = await impl(this.url, {
        method: "GET",
        headers: { Accept: "text/event-stream", "Cache-Control": "no-store", ...this.options.headers },
        signal: this.controller.signal,
      });
    } catch (cause) {
      this.fail(`connect failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }

    if (!response.ok) {
      // A 429 or 503 on the stream route is a real answer; the body carries the
      // contract's error envelope and is worth passing up verbatim.
      let body = "";
      if (typeof response.text === "function") {
        try {
          body = await response.text();
        } catch {
          body = "";
        }
      }
      this.fail(`HTTP ${response.status}${body === "" ? "" : ` ${body}`}`);
      return;
    }
    if (response.body === null) {
      this.fail("the stream response carried no body");
      return;
    }

    this.emit("open", {});

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    // A read that ends in `\r` is AMBIGUOUS: the `\n` completing a CRLF may be
    // the first byte of the next read, and TCP/ReadableStream chunk boundaries
    // are arbitrary. Normalizing that CR immediately would turn `...\r` + `\n...`
    // into a fabricated blank line — a false frame boundary that dispatches a
    // half frame and silently loses the event. So a trailing CR is HELD until
    // the next chunk decides what it was.
    let danglingCR = false;
    const ingest = (chunk: string): void => {
      let text = danglingCR ? `\r${chunk}` : chunk;
      danglingCR = text.endsWith("\r");
      if (danglingCR) text = text.slice(0, -1);

      // Frames are separated by a blank line. `\r\n` is normalized so a proxy
      // that rewrites line endings cannot hide a frame boundary — safe here
      // only because a trailing CR never enters `text` unresolved.
      buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        this.dispatchFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) ingest(decoder.decode(value, { stream: true }));
      }
      // At EOF a still-held CR is a real line terminator (SSE admits a bare
      // CR); resolving it can complete the final frame's blank line.
      if (danglingCR) ingest("\n");
      this.fail("the server closed the stream");
    } catch (cause) {
      if (this.closed) return;
      this.fail(`read failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Already gone.
      }
    }
  }

  /** Parse one SSE frame and dispatch it. */
  private dispatchFrame(frame: string): void {
    let event = "";
    let id = "";
    const dataLines: string[] = [];
    const comments: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.length === 0) continue;
      if (line.startsWith(":")) {
        comments.push(line.slice(1).trimStart());
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      // Per the SSE grammar a single leading space after the colon is stripped.
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      switch (field) {
        case "event":
          event = value;
          break;
        case "data":
          dataLines.push(value);
          break;
        case "id":
          id = value;
          break;
        default:
          // `retry` and anything unknown: this transport does not reconnect, so
          // the server's retry hint is not actionable here.
          break;
      }
    }

    // Comments are dispatched under the synthetic `heartbeat` type. That is the
    // only comment this contract sends, and it is the frame a stalled-stream
    // watchdog needs to see.
    for (const comment of comments) {
      this.emit("heartbeat", { data: comment });
    }

    if (event === "" && dataLines.length === 0) return;
    const message: MessageLike = {
      data: dataLines.join("\n"),
      ...(id === "" ? {} : { lastEventId: id }),
    };
    this.emit(event === "" ? "message" : event, message);
  }
}
