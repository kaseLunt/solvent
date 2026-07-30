// The fetch-based client for the six routes.
//
// Zero runtime dependencies. `fetch` is used through a minimal STRUCTURAL type
// rather than the DOM `Response`, which keeps the package free of a lib choice,
// makes the transport trivially injectable, and lets every test drive the real
// code path instead of a mocked-out one.
//
// Two properties are load-bearing and tested:
//
//  1. Nothing here converts a money quantity. Responses are returned exactly as
//     the wire carried them — decimal strings stay strings. `src/decimal.ts` is
//     opt-in, and it refuses rather than rounds.
//  2. Every failure is a typed error carrying machine-readable fields. There is
//     no path that returns a partial body or an empty object on failure.

import {
  BadRequestError,
  InternalError,
  MalformedResponseError,
  NotFoundError,
  RateLimitedError,
  SchemaVersionMismatchError,
  SolventHttpError,
  SolventNetworkError,
  SolventUsageError,
  UnavailableError,
  type HttpErrorInit,
} from "./errors.js";
import { lookup, type AddressLookup, type StressLookup } from "./lookup.js";
import { SolventStream, type StreamOptions } from "./sse.js";
import {
  SEIZURE_MODEL,
  type AddressResponse,
  type BookResponse,
  type ErrorBody,
  type MetaResponse,
  type ObservatoryResponse,
  type StressResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// The transport seam.
// ---------------------------------------------------------------------------

/** The subset of `Response` this client uses. The global `fetch` satisfies it. */
export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The subset of `fetch` this client uses. The global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<ResponseLike>;

export interface SolventClientOptions {
  /** Base URL of a running `cmd/api`, e.g. `http://localhost:8080`. */
  baseUrl: string;
  /** Transport override. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra request headers. `Accept` is set for you and may be overridden. */
  headers?: Record<string, string>;
  /** Per-request timeout. 0 disables it. Default 15000. */
  timeoutMs?: number;

  /**
   * The goose migration version this client's contract was written against.
   * When set, a mismatch reported by `/v1/meta` is a refusal.
   */
  expectedSchemaVersion?: number;
  /** `service.algorithm_revision`. When set, a mismatch is a refusal. */
  expectedAlgorithmRevision?: number;
  /** `service.scenario_config_version`. When set, a mismatch is a refusal. */
  expectedScenarioConfigVersion?: string;
  /**
   * Whether `meta()` itself enforces the expectations above. Default true.
   *
   * The `seizure_model` check is unconditional either way: the contract admits
   * exactly one value, so a server publishing another is not this contract.
   */
  refuseOnSchemaMismatch?: boolean;
}

/** `^0x` + 40 hex digits — the contract's `Address` pattern, verbatim. */
const ADDRESS_PATTERN = /^0[xX][0-9a-fA-F]{40}$/;

/** Enough of a malformed body to diagnose it; a proxy's HTML page is not worth keeping whole. */
const RAW_BODY_LIMIT = 2048;

export class SolventClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly expected: {
    schemaVersion?: number;
    algorithmRevision?: number;
    scenarioConfigVersion?: string;
  };
  private readonly refuseOnSchemaMismatch: boolean;

  constructor(options: SolventClientOptions) {
    if (typeof options.baseUrl !== "string" || options.baseUrl.length === 0) {
      throw new SolventUsageError("baseUrl", options.baseUrl, "baseUrl is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");

    const injected = options.fetch;
    if (injected === undefined) {
      const global = (globalThis as { fetch?: FetchLike }).fetch;
      if (global === undefined) {
        throw new SolventUsageError(
          "fetch",
          undefined,
          "no global fetch in this runtime: pass one via `new SolventClient({ fetch })` " +
            "(Node 18+ has it built in)",
        );
      }
      this.fetchImpl = global;
    } else {
      this.fetchImpl = injected;
    }

    this.headers = { Accept: "application/json", ...options.headers };
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.expected = {
      ...(options.expectedSchemaVersion === undefined ? {} : { schemaVersion: options.expectedSchemaVersion }),
      ...(options.expectedAlgorithmRevision === undefined
        ? {}
        : { algorithmRevision: options.expectedAlgorithmRevision }),
      ...(options.expectedScenarioConfigVersion === undefined
        ? {}
        : { scenarioConfigVersion: options.expectedScenarioConfigVersion }),
    };
    this.refuseOnSchemaMismatch = options.refuseOnSchemaMismatch ?? true;
  }

  // -------------------------------------------------------------------------
  // The six routes.
  // -------------------------------------------------------------------------

  /** `GET /v1/book` — per-engine aggregates, the HF histogram and the waterfall. */
  async book(signal?: AbortSignal): Promise<BookResponse> {
    return this.get<BookResponse>("/v1/book", signal);
  }

  /**
   * `GET /v1/address/{addr}` — one address's positions in the newest servable
   * batch, as a DISCRIMINATED LOOKUP.
   *
   * An address with no position answers 200, not 404: "no position in this
   * batch" is an ANSWER and arrives with the batch that answered it.
   *
   * On the wire `found` is THREE-VALUED — `true`, `false`, or `null` when a
   * withheld engine makes the answer unestablishable — and `!found` treats
   * "cannot answer" as "no position". So this method does not hand back the
   * raw body: it returns `lookup(body)`, whose SOLE discriminant `outcome` has
   * three string-literal cases and which carries no top-level `found` at all
   * (`if (!result.found)` does not compile), and it throws
   * `ContractInvariantError` on a body that contradicts itself.
   *
   * The same law covers the rest of the verdict class (round 3): the positions
   * on `response` are REFINED — `liquidatable` and `used_as_collateral` are
   * absent, replaced by the sealed `liquidation_verdict` / `collateral_use`
   * unions (`src/refine.ts`) — so no nullable-boolean verdict survives on this
   * surface either. The unrefined wire body is behind `addressRaw()`, whose
   * name says what it is.
   */
  async address(addr: string, signal?: AbortSignal): Promise<AddressLookup> {
    return lookup(await this.addressRaw(addr, signal));
  }

  /**
   * `GET /v1/address/{addr}` — the RAW wire body, unrefined and unenforced.
   *
   * `found` here is the contract's `boolean | null` — and so are the other
   * nullable-boolean verdicts (`positions[].liquidatable`,
   * `legs[].used_as_collateral`). No invariant is checked and nothing is
   * refined: this accessor exists for persistence, forensics and conformance
   * tooling, where the wire bytes' own claims are the subject. Never branch a
   * rendering decision on this body's `found` or verdict fields — use
   * `address()` (or pass this body through `lookup()`), where a withheld
   * answer cannot read as a definitive one.
   */
  async addressRaw(addr: string, signal?: AbortSignal): Promise<AddressResponse> {
    return this.get<AddressResponse>(`/v1/address/${this.checkAddress(addr)}`, signal);
  }

  /**
   * `GET /v1/address/{addr}/stress` — the committed scenario set against one
   * address, as a DISCRIMINATED LOOKUP.
   *
   * `found` is three-valued here too, with the same contract as `address()`,
   * and the same enforcement: contradictory bodies throw
   * `ContractInvariantError`. The scenarios on `response` are REFINED —
   * stress-state `liquidatable` and horizon `becomes_liquidatable` are absent,
   * replaced by the sealed `liquidation_verdict` union — and the raw wire body
   * is behind `addressStressRaw()`.
   */
  async addressStress(addr: string, signal?: AbortSignal): Promise<StressLookup> {
    return lookup(await this.addressStressRaw(addr, signal));
  }

  /**
   * `GET /v1/address/{addr}/stress` — the RAW wire body, unrefined and
   * unenforced. The same caveats as `addressRaw()`.
   */
  async addressStressRaw(addr: string, signal?: AbortSignal): Promise<StressResponse> {
    return this.get<StressResponse>(`/v1/address/${this.checkAddress(addr)}/stress`, signal);
  }

  /** `GET /v1/observatory` — per-engine TVL, counts and rate indexes, newest first. */
  async observatory(options?: { limit?: number; signal?: AbortSignal }): Promise<ObservatoryResponse> {
    let path = "/v1/observatory";
    const limit = options?.limit;
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new SolventUsageError(
          "limit",
          limit,
          `limit must be an integer in [1, 500] per the contract, got ${String(limit)}`,
        );
      }
      path += `?limit=${limit}`;
    }
    return this.get<ObservatoryResponse>(path, options?.signal);
  }

  /**
   * `GET /v1/meta` — watermark vector, reorg posture, price state, constants.
   *
   * Answers 200 even when no batch is servable, and says so in
   * `batch_unavailable_reason`. When `refuseOnSchemaMismatch` is on (the
   * default), the published identity is checked before the body is returned.
   */
  async meta(signal?: AbortSignal): Promise<MetaResponse> {
    const body = await this.get<MetaResponse>("/v1/meta", signal);
    this.assertCompatible(body);
    return body;
  }

  /** `GET /v1/stream` — Server-Sent Events. Returns immediately; the stream connects itself. */
  stream(options?: StreamOptions): SolventStream {
    return new SolventStream(`${this.baseUrl}/v1/stream`, options);
  }

  // -------------------------------------------------------------------------
  // Contract compatibility.
  // -------------------------------------------------------------------------

  /**
   * Check a `/v1/meta` body against this client's expectations.
   *
   * `seizure_model` is checked unconditionally — the contract's enum admits one
   * value and a different one means the shortfall arithmetic behind the numbers
   * is not the arithmetic this client documents. The configurable expectations
   * are checked only when `refuseOnSchemaMismatch` is on.
   */
  assertCompatible(meta: MetaResponse): void {
    this.checkIdentity(meta, this.refuseOnSchemaMismatch);
  }

  /** Fetch `/v1/meta` and refuse if the server is not the contract this client was built against. */
  async assertServerCompatible(signal?: AbortSignal): Promise<MetaResponse> {
    const body = await this.get<MetaResponse>("/v1/meta", signal);
    // Enforced unconditionally: an explicit call to assert compatibility is a
    // request to enforce it, whatever `refuseOnSchemaMismatch` says.
    this.checkIdentity(body, true);
    return body;
  }

  private checkIdentity(meta: MetaResponse, enforceConfigured: boolean): void {
    const service = meta.service;
    if (service.seizure_model !== SEIZURE_MODEL) {
      throw new SchemaVersionMismatchError("seizure_model", SEIZURE_MODEL, service.seizure_model);
    }
    if (!enforceConfigured) return;
    if (this.expected.schemaVersion !== undefined && service.schema_version !== this.expected.schemaVersion) {
      throw new SchemaVersionMismatchError("schema_version", this.expected.schemaVersion, service.schema_version);
    }
    if (
      this.expected.algorithmRevision !== undefined &&
      service.algorithm_revision !== this.expected.algorithmRevision
    ) {
      throw new SchemaVersionMismatchError(
        "algorithm_revision",
        this.expected.algorithmRevision,
        service.algorithm_revision,
      );
    }
    if (
      this.expected.scenarioConfigVersion !== undefined &&
      service.scenario_config_version !== this.expected.scenarioConfigVersion
    ) {
      throw new SchemaVersionMismatchError(
        "scenario_config_version",
        this.expected.scenarioConfigVersion,
        service.scenario_config_version,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private checkAddress(addr: string): string {
    if (typeof addr !== "string" || !ADDRESS_PATTERN.test(addr)) {
      throw new SolventUsageError(
        "addr",
        addr,
        `not a 0x-prefixed 20-byte address: ${JSON.stringify(addr)}. Refused locally rather ` +
          `than sent, so a malformed address can never become a request for a different account`,
      );
    }
    return addr;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const effective = this.signalFor(signal);

    let response: ResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers,
        ...(effective === undefined ? {} : { signal: effective }),
      });
    } catch (cause) {
      const timedOut = effective?.aborted === true && signal?.aborted !== true;
      throw new SolventNetworkError(
        url,
        timedOut
          ? `request timed out after ${this.timeoutMs}ms`
          : `the request produced no HTTP response: ${describe(cause)}`,
        { timedOut, cause },
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (cause) {
      throw new SolventNetworkError(url, `the response body could not be read: ${describe(cause)}`, {
        timedOut: false,
        cause,
      });
    }

    if (!response.ok) {
      throw httpError(url, response, raw);
    }

    try {
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new MalformedResponseError(
        url,
        response.status,
        truncate(raw),
        `a 200 response body was not JSON: ${describe(cause)}`,
        cause,
      );
    }
  }

  /**
   * Combine the caller's signal with this client's timeout.
   *
   * `AbortSignal.any` keeps whichever fires first, so a caller-side abort is
   * still distinguishable from a timeout (the caller's own signal reports
   * aborted, the timeout's does not).
   */
  private signalFor(signal?: AbortSignal): AbortSignal | undefined {
    const timeout = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
    if (timeout === undefined) return signal;
    if (signal === undefined) return timeout;
    return AbortSignal.any([signal, timeout]);
  }
}

/** Build the typed error for a non-2xx response. */
function httpError(url: string, response: ResponseLike, raw: string): SolventHttpError | MalformedResponseError {
  const body = parseErrorBody(raw);
  if (body === null) {
    return new MalformedResponseError(
      url,
      response.status,
      truncate(raw),
      `a ${response.status} response did not carry the contract's error envelope ` +
        `({ error: { code, message } })`,
    );
  }

  const header = response.headers.get("Retry-After");
  const fromHeader = header === null ? null : parseRetryAfter(header);
  const fromBody = typeof body.error.retry_after_seconds === "number" ? body.error.retry_after_seconds : null;

  const init: HttpErrorInit = {
    url,
    status: response.status,
    code: body.error.code,
    message: body.error.message,
    retryAfterSeconds: fromHeader ?? fromBody,
    body,
  };

  switch (response.status) {
    case 400:
      return new BadRequestError(init);
    case 404:
      return new NotFoundError(init);
    case 429:
      return new RateLimitedError(init);
    case 500:
      return new InternalError(init);
    case 503:
      return new UnavailableError(init);
    default:
      return new SolventHttpError(init);
  }
}

/** Parse and shape-check the contract's error envelope. Null means "not the envelope". */
function parseErrorBody(raw: string): ErrorBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return parsed as ErrorBody;
}

/** `Retry-After` is seconds in this contract. A malformed value is "the server did not say". */
function parseRetryAfter(value: string): number | null {
  if (!/^[0-9]+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : null;
}

function truncate(raw: string): string {
  return raw.length <= RAW_BODY_LIMIT ? raw : `${raw.slice(0, RAW_BODY_LIMIT)}… (${raw.length} bytes total)`;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
