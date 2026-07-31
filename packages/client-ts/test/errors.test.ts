// Test category (5): the error taxonomy.
//
// 429 with its Retry-After, 5xx, 503-is-not-an-empty-book, network failure,
// malformed bodies, local argument refusals, and the schema-version refusal.

import { describe, expect, it } from "vitest";

import {
  BadRequestError,
  InternalError,
  MalformedResponseError,
  NotFoundError,
  RateLimitedError,
  SchemaVersionMismatchError,
  SolventClient,
  SolventError,
  SolventHttpError,
  SolventNetworkError,
  SolventUsageError,
  UnavailableError,
} from "../src/index.js";
import { FIXTURE_FILES, fixtureBytes, fixtureJson, PINNED } from "./fixtures/index.js";
import { failingFetch, mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";

function clientWith(routes: Parameters<typeof mockFetch>[0]) {
  const mock = mockFetch(routes);
  return new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
}

describe("429 — the token bucket is empty", () => {
  it("is a RateLimitedError carrying the code and the wait from the header", async () => {
    const client = clientWith({
      "/v1/book": {
        status: 429,
        body: fixtureBytes(FIXTURE_FILES.errorRateLimited),
        headers: { "Retry-After": "3" },
      },
    });
    await expect(client.book()).rejects.toBeInstanceOf(RateLimitedError);
    try {
      await client.book();
    } catch (error) {
      const e = error as RateLimitedError;
      expect(e).toBeInstanceOf(SolventHttpError);
      expect(e).toBeInstanceOf(SolventError);
      expect(e.status).toBe(429);
      expect(e.code).toBe("rate_limited");
      expect(e.retryAfterSeconds).toBe(3);
      expect(e.body).toEqual(fixtureJson(FIXTURE_FILES.errorRateLimited));
      expect(e.message).toContain("rate limit exceeded");
      expect(e.url).toBe(`${BASE}/v1/book`);
    }
  });

  it("falls back to the envelope's retry_after_seconds when the header is absent", async () => {
    const client = clientWith({ "/v1/book": { status: 429, body: fixtureBytes(FIXTURE_FILES.errorRateLimited) } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      expect((error as RateLimitedError).retryAfterSeconds).toBe(3);
    }
  });

  it("reports null rather than zero when the server said nothing about waiting", async () => {
    const client = clientWith({
      "/v1/book": { status: 429, body: JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }) },
    });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      // Null means "the server did not say" — never "retry immediately".
      expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
    }
  });

  it("ignores a malformed Retry-After instead of inventing a number", async () => {
    const client = clientWith({
      "/v1/book": {
        status: 429,
        body: JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }),
        headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
      },
    });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
    }
  });

  it("does NOT retry on its own", async () => {
    const mock = mockFetch({
      "/v1/book": { status: 429, body: fixtureBytes(FIXTURE_FILES.errorRateLimited) },
    });
    const client = new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
    await expect(client.book()).rejects.toBeInstanceOf(RateLimitedError);
    // A caller's own backoff policy must not be overwritten from inside a library.
    expect(mock.calls).toHaveLength(1);
  });
});

describe("503 — a statement about the SERVICE, never an empty book", () => {
  it("is an UnavailableError that says so", async () => {
    const client = clientWith({ "/v1/book": { status: 503, body: fixtureBytes(FIXTURE_FILES.errorUnavailable) } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as UnavailableError;
      expect(e).toBeInstanceOf(UnavailableError);
      expect(e.status).toBe(503);
      expect(e.code).toBe("unavailable");
      expect(e.retryAfterSeconds).toBe(5);
      expect(e.message).toContain("NOT a claim that the book is empty");
    }
  });

  it("never resolves to a zero-valued book", async () => {
    const client = clientWith({ "/v1/book": { status: 503, body: fixtureBytes(FIXTURE_FILES.errorUnavailable) } });
    const result = await client.book().then(
      () => "resolved",
      () => "rejected",
    );
    expect(result).toBe("rejected");
  });
});

describe("the rest of the status taxonomy", () => {
  it("400 is a BadRequestError", async () => {
    const client = clientWith({
      "/v1/observatory": { status: 400, body: fixtureBytes(FIXTURE_FILES.errorBadRequest) },
    });
    try {
      await client.observatory();
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestError);
      expect((error as BadRequestError).code).toBe("bad_request");
    }
  });

  it("404 is a NotFoundError", async () => {
    const client = clientWith({ "/v1/book": { status: 404, body: fixtureBytes(FIXTURE_FILES.errorNotFound) } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toContain("no such route");
    }
  });

  it("500 is an InternalError with a sanitized message", async () => {
    const client = clientWith({ "/v1/book": { status: 500, body: fixtureBytes(FIXTURE_FILES.errorInternal) } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as InternalError;
      expect(e).toBeInstanceOf(InternalError);
      expect(e.status).toBe(500);
      // The server strips DSNs and endpoint URLs; the client must not add any.
      expect(e.message).not.toMatch(/postgres:|https?:\/\//);
    }
  });

  it("an unmapped status is still a typed SolventHttpError", async () => {
    const client = clientWith({
      "/v1/book": { status: 418, body: JSON.stringify({ error: { code: "internal", message: "teapot" } }) },
    });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(SolventHttpError);
      expect(error).not.toBeInstanceOf(InternalError);
      expect((error as SolventHttpError).status).toBe(418);
    }
  });
});

describe("network failure is not an HTTP error", () => {
  it("is a SolventNetworkError, distinguishable from a server refusal", async () => {
    const client = new SolventClient({
      baseUrl: BASE,
      fetch: failingFetch(new TypeError("fetch failed: ECONNREFUSED")),
    });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as SolventNetworkError;
      expect(e).toBeInstanceOf(SolventNetworkError);
      expect(e).not.toBeInstanceOf(SolventHttpError);
      expect(e.timedOut).toBe(false);
      expect(e.url).toBe(`${BASE}/v1/book`);
      expect(e.message).toContain("no HTTP response");
      expect(e.cause).toBeInstanceOf(TypeError);
    }
  });

  it("reports its own timeout as a timeout", async () => {
    const client = new SolventClient({
      baseUrl: BASE,
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as SolventNetworkError;
      expect(e).toBeInstanceOf(SolventNetworkError);
      expect(e.timedOut).toBe(true);
      expect(e.message).toContain("timed out after 5ms");
    }
  });

  it("honours a caller's abort signal without calling it a timeout", async () => {
    const controller = new AbortController();
    const client = new SolventClient({
      baseUrl: BASE,
      timeoutMs: 60_000,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const pending = client.book(controller.signal);
    controller.abort();
    try {
      await pending;
      throw new Error("unreachable");
    } catch (error) {
      expect((error as SolventNetworkError).timedOut).toBe(false);
    }
  });
});

describe("a body that is not the contract's is a MalformedResponseError", () => {
  it("catches a proxy's HTML page behind a 502", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const client = clientWith({ "/v1/book": { status: 502, body: html } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as MalformedResponseError;
      expect(e).toBeInstanceOf(MalformedResponseError);
      expect(e.status).toBe(502);
      expect(e.rawBody).toBe(html);
      expect(e.message).toContain("error envelope");
    }
  });

  it("catches an error status whose JSON is not the envelope", async () => {
    const client = clientWith({ "/v1/book": { status: 500, body: JSON.stringify({ message: "oops" }) } });
    await expect(client.book()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it("catches a 200 that is not JSON", async () => {
    const client = clientWith({ "/v1/book": { status: 200, body: "not json at all" } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as MalformedResponseError;
      expect(e).toBeInstanceOf(MalformedResponseError);
      expect(e.status).toBe(200);
      expect(e.message).toContain("was not JSON");
    }
  });

  it("truncates a huge body rather than retaining it whole", async () => {
    const client = clientWith({ "/v1/book": { status: 500, body: "x".repeat(9000) } });
    try {
      await client.book();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as MalformedResponseError;
      expect(e.rawBody.length).toBeLessThan(9000);
      expect(e.rawBody).toContain("9000 bytes total");
    }
  });
});

describe("caller mistakes are refused locally, before a request exists", () => {
  it("refuses a malformed address rather than sending it", async () => {
    const mock = mockFetch({ "/v1/book": { body: "{}" } });
    const client = new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
    for (const bad of ["0xnothex", "", "0x123", `${PINNED.accounts.aave}00`, "not-an-address"]) {
      await expect(client.address(bad), bad).rejects.toBeInstanceOf(SolventUsageError);
      await expect(client.addressStress(bad), bad).rejects.toBeInstanceOf(SolventUsageError);
    }
    // Nothing left the client: a malformed address can never become a request
    // for a different account.
    expect(mock.calls).toEqual([]);
  });

  it("names the offending field on the error", async () => {
    const client = clientWith({ "/v1/book": { body: "{}" } });
    try {
      await client.address("0xnothex");
      throw new Error("unreachable");
    } catch (error) {
      const e = error as SolventUsageError;
      expect(e.field).toBe("addr");
      expect(e.value).toBe("0xnothex");
      expect(e).not.toBeInstanceOf(SolventHttpError);
    }
  });

  it("accepts a valid address in either case", async () => {
    const lower = PINNED.accounts.aave.toLowerCase();
    const mock = mockFetch({ [`/v1/address/${lower}`]: { body: fixtureBytes(FIXTURE_FILES.addressAave) } });
    const client = new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
    await client.address(lower);
    expect(mock.calls).toEqual([`${BASE}/v1/address/${lower}`]);
  });

  it("requires a baseUrl and a fetch", () => {
    expect(() => new SolventClient({ baseUrl: "" })).toThrow(SolventUsageError);
  });

  it("binds the captured global fetch (browsers throw Illegal invocation on a wrong `this`)", async () => {
    // Browser WebIDL semantics: a method call with `this` = undefined/null
    // falls back to the global, but any OTHER `this` (e.g. the client
    // instance, via `this.fetchImpl(...)`) throws "Illegal invocation".
    // Node's undici ignores `this`, so only this simulation catches the
    // unbound capture.
    const mock = mockFetch({ "/v1/book": { body: fixtureBytes(FIXTURE_FILES.book) } });
    const g = globalThis as { fetch?: unknown };
    const saved = g.fetch;
    g.fetch = function (this: unknown, ...args: unknown[]) {
      if (this !== globalThis && this !== undefined && this !== null) {
        throw new TypeError("Illegal invocation");
      }
      return (mock.fetch as (...a: unknown[]) => unknown)(...args);
    };
    try {
      const client = new SolventClient({ baseUrl: BASE });
      await client.book();
    } finally {
      g.fetch = saved;
    }
    expect(mock.calls).toEqual([`${BASE}/v1/book`]);
  });

  it("strips a trailing slash from the baseUrl so paths never double up", async () => {
    const mock = mockFetch({ "/v1/book": { body: fixtureBytes(FIXTURE_FILES.book) } });
    const client = new SolventClient({ baseUrl: `${BASE}//`, fetch: mock.fetch });
    await client.book();
    expect(mock.calls).toEqual([`${BASE}/v1/book`]);
  });
});

describe("the schema-version refusal", () => {
  const metaRoute = { "/v1/meta": { body: fixtureBytes(FIXTURE_FILES.meta) } };
  const served = fixtureJson(FIXTURE_FILES.meta) as {
    service: { schema_version: number; algorithm_revision: number; scenario_config_version: string };
  };

  it("passes when the server's identity is the one the client was built against", async () => {
    const mock = mockFetch(metaRoute);
    const client = new SolventClient({
      baseUrl: BASE,
      fetch: mock.fetch,
      expectedSchemaVersion: served.service.schema_version,
      expectedAlgorithmRevision: served.service.algorithm_revision,
      expectedScenarioConfigVersion: served.service.scenario_config_version,
    });
    const meta = await client.meta();
    expect(meta.service.schema_version).toBe(served.service.schema_version);
    expect(await client.assertServerCompatible()).toBeTruthy();
  });

  it("REFUSES a schema_version one off, naming both numbers", async () => {
    const mock = mockFetch(metaRoute);
    const client = new SolventClient({
      baseUrl: BASE,
      fetch: mock.fetch,
      expectedSchemaVersion: served.service.schema_version + 1,
    });
    try {
      await client.meta();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as SchemaVersionMismatchError;
      expect(e).toBeInstanceOf(SchemaVersionMismatchError);
      expect(e.field).toBe("schema_version");
      expect(e.expected).toBe(served.service.schema_version + 1);
      expect(e.actual).toBe(served.service.schema_version);
      expect(e.message).toContain("refusing rather than interpreting");
    }
  });

  it("REFUSES a moved algorithm_revision or scenario_config_version", async () => {
    for (const [field, options] of [
      ["algorithm_revision", { expectedAlgorithmRevision: PINNED.meta.algorithmRevision + 1 }],
      ["scenario_config_version", { expectedScenarioConfigVersion: "v2" }],
    ] as const) {
      const client = new SolventClient({ baseUrl: BASE, fetch: mockFetch(metaRoute).fetch, ...options });
      try {
        await client.meta();
        throw new Error("unreachable");
      } catch (error) {
        expect((error as SchemaVersionMismatchError).field, field).toBe(field);
      }
    }
  });

  it("REFUSES an undisclosed seizure model UNCONDITIONALLY", async () => {
    // The contract's enum admits one value. A server publishing another is not
    // this contract, and no configuration switches that check off.
    const tampered = fixtureJson(FIXTURE_FILES.meta) as { service: { seizure_model: string } };
    tampered.service.seizure_model = "first-come-first-served";
    const client = new SolventClient({
      baseUrl: BASE,
      fetch: mockFetch({ "/v1/meta": { body: JSON.stringify(tampered) } }).fetch,
      refuseOnSchemaMismatch: false,
    });
    try {
      await client.meta();
      throw new Error("unreachable");
    } catch (error) {
      const e = error as SchemaVersionMismatchError;
      expect(e).toBeInstanceOf(SchemaVersionMismatchError);
      expect(e.field).toBe("seizure_model");
      expect(e.expected).toBe(PINNED.meta.seizureModel);
      expect(e.actual).toBe("first-come-first-served");
    }
  });

  it("lets a caller opt out of the CONFIGURED checks but not of an explicit assertion", async () => {
    const options = {
      baseUrl: BASE,
      expectedSchemaVersion: served.service.schema_version + 1,
      refuseOnSchemaMismatch: false,
    };
    const lenient = new SolventClient({ ...options, fetch: mockFetch(metaRoute).fetch });
    // meta() lets it through...
    await expect(lenient.meta()).resolves.toBeTruthy();
    // ...and asking directly still refuses.
    await expect(
      new SolventClient({ ...options, fetch: mockFetch(metaRoute).fetch }).assertServerCompatible(),
    ).rejects.toBeInstanceOf(SchemaVersionMismatchError);
  });

  it("checks nothing it was not told to check", async () => {
    const client = new SolventClient({ baseUrl: BASE, fetch: mockFetch(metaRoute).fetch });
    await expect(client.meta()).resolves.toBeTruthy();
    await expect(client.assertServerCompatible()).resolves.toBeTruthy();
  });
});
