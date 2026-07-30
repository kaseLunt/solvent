// A mock `fetch` that serves the COMMITTED FIXTURE BYTES.
//
// The client's real code path runs against it: real URL construction, real
// status handling, real `JSON.parse`. Nothing about the client is stubbed — only
// the socket is.

import type { FetchLike, ResponseLike } from "../../src/client.js";

export interface Route {
  status?: number;
  /** Response body bytes. Fixture files are read verbatim, never re-serialized. */
  body: string;
  headers?: Record<string, string>;
}

export interface MockFetch {
  fetch: FetchLike;
  /** Every URL requested, in order. */
  calls: string[];
}

class MockResponse implements ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  private readonly bodyText: string;

  constructor(status: number, body: string, headers: Record<string, string>) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.bodyText = body;
    const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    this.headers = { get: (name) => lower.get(name.toLowerCase()) ?? null };
  }

  text(): Promise<string> {
    return Promise.resolve(this.bodyText);
  }
}

/**
 * Build a mock fetch from a path -> route table.
 *
 * A request for a path with no route is a test bug, not a 404: it fails loudly
 * rather than letting a typo look like a server behaviour.
 */
export function mockFetch(routes: Record<string, Route | (() => Route)>): MockFetch {
  const calls: string[] = [];
  const fetch: FetchLike = (url) => {
    calls.push(url);
    const path = new URL(url).pathname + (new URL(url).search || "");
    const entry = routes[path] ?? routes[new URL(url).pathname];
    if (entry === undefined) {
      return Promise.reject(new Error(`mockFetch: no route for ${path} (routes: ${Object.keys(routes).join(", ")})`));
    }
    const route = typeof entry === "function" ? entry() : entry;
    return Promise.resolve(
      new MockResponse(route.status ?? 200, route.body, {
        "content-type": "application/json; charset=utf-8",
        ...route.headers,
      }),
    );
  };
  return { fetch, calls };
}

/** A fetch that always rejects — the network-failure leg of the error taxonomy. */
export function failingFetch(error: Error): FetchLike {
  return () => Promise.reject(error);
}
