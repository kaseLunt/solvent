// The error taxonomy.
//
// Every failure this client can produce is one of these classes, and every one
// of them carries the machine-readable fields a caller needs to decide what to
// do — never just a string. `instanceof SolventError` catches all of them.
//
// The design rule throughout: a number that could not be produced honestly is
// never approximated. The decimal helpers throw `PrecisionLossError` where a
// lesser client would round, and the compatibility check throws
// `SchemaVersionMismatchError` where a lesser client would render a payload it
// does not understand.

import type { ErrorBody, ErrorCode } from "./types.js";

/** Base class for every error this package throws. */
export class SolventError extends Error {
  override readonly name: string = "SolventError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options && "cause" in options) {
      // `cause` is assigned rather than passed to super() so the field is
      // present under an ES2022 target regardless of the host's Error shape.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Caller mistakes — refused before a request is made.
// ---------------------------------------------------------------------------

/**
 * The caller passed an argument this client will not send.
 *
 * It fails locally rather than letting the server answer 400, so a malformed
 * address never becomes a request that could be mistaken for a different
 * account.
 */
export class SolventUsageError extends SolventError {
  override readonly name = "SolventUsageError";
  readonly field: string;
  readonly value: unknown;

  constructor(field: string, value: unknown, message: string) {
    super(message);
    this.field = field;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Transport.
// ---------------------------------------------------------------------------

/**
 * The request never produced an HTTP response: DNS failure, refused connection,
 * TLS failure, abort, or timeout.
 *
 * This is deliberately NOT a subclass of `SolventHttpError`: "the server said
 * no" and "there was no server" are different facts and a retry policy should
 * be able to tell them apart.
 */
export class SolventNetworkError extends SolventError {
  override readonly name = "SolventNetworkError";
  readonly url: string;
  /** True when the failure was this client's own timeout rather than the network's. */
  readonly timedOut: boolean;

  constructor(url: string, message: string, opts: { timedOut: boolean; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.url = url;
    this.timedOut = opts.timedOut;
  }
}

/**
 * A response arrived but its body is not what the contract says it is: a
 * success body that is not JSON, or an error status whose body is not the
 * contract's error envelope.
 *
 * The raw body is retained (truncated) because diagnosing this class of failure
 * without it is guesswork — it is usually a proxy's HTML error page.
 */
export class MalformedResponseError extends SolventError {
  override readonly name = "MalformedResponseError";
  readonly status: number;
  readonly url: string;
  readonly rawBody: string;

  constructor(url: string, status: number, rawBody: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.url = url;
    this.status = status;
    this.rawBody = rawBody;
  }
}

// ---------------------------------------------------------------------------
// HTTP status errors — the contract's error envelope, typed.
// ---------------------------------------------------------------------------

export interface HttpErrorInit {
  url: string;
  status: number;
  code: ErrorCode | string;
  message: string;
  retryAfterSeconds: number | null;
  body: ErrorBody;
}

/** Any non-2xx response that carried the contract's error envelope. */
export class SolventHttpError extends SolventError {
  override readonly name: string = "SolventHttpError";
  readonly url: string;
  readonly status: number;
  /** `error.code` from the envelope — the closed set, so branching needs no prose parsing. */
  readonly code: ErrorCode | string;
  /**
   * Seconds to wait, from `Retry-After` or `error.retry_after_seconds`.
   * Null means the server did not say — never "retry immediately".
   */
  readonly retryAfterSeconds: number | null;
  readonly body: ErrorBody;

  constructor(init: HttpErrorInit) {
    super(`${init.status} ${init.code}: ${init.message}`);
    this.url = init.url;
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.body = init.body;
  }
}

/** 400 — the request was malformed. */
export class BadRequestError extends SolventHttpError {
  override readonly name = "BadRequestError";
}

/** 404 — no such route. */
export class NotFoundError extends SolventHttpError {
  override readonly name = "NotFoundError";
}

/**
 * 429 — the per-client token bucket is empty.
 *
 * `retryAfterSeconds` is the server's own instruction. The client does not
 * retry on its own: a rate-limited caller silently retried inside a library is
 * a caller whose own backoff policy has been overwritten.
 */
export class RateLimitedError extends SolventHttpError {
  override readonly name = "RateLimitedError";
}

/**
 * 503 — no complete risk batch is available.
 *
 * This is a statement about the SERVICE, not a claim that the book is empty,
 * and it must never be rendered as a book of zeroes.
 */
export class UnavailableError extends SolventHttpError {
  override readonly name = "UnavailableError";
}

/** 500 — the service failed to build the response. */
export class InternalError extends SolventHttpError {
  override readonly name = "InternalError";
}

// ---------------------------------------------------------------------------
// Contract compatibility.
// ---------------------------------------------------------------------------

/** Which published identity disagreed with what this client expected. */
export type SchemaMismatchField =
  | "schema_version"
  | "algorithm_revision"
  | "scenario_config_version"
  | "seizure_model";

/**
 * The server's published identity is not the one this client was built against.
 *
 * This is a REFUSAL, not a warning. The client's types come from a specific
 * `api/openapi.yaml`; serving numbers whose meaning may have changed underneath
 * them is exactly the failure the contract-first design exists to prevent.
 */
export class SchemaVersionMismatchError extends SolventError {
  override readonly name = "SchemaVersionMismatchError";
  readonly field: SchemaMismatchField;
  readonly expected: string | number;
  readonly actual: string | number;

  constructor(field: SchemaMismatchField, expected: string | number, actual: string | number) {
    super(
      `server ${field} is ${String(actual)}, this client was built against ${String(expected)}: ` +
        `refusing rather than interpreting a payload whose meaning may have changed`,
    );
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * A response is schema-valid but contradicts itself.
 *
 * Distinct from `MalformedResponseError`, which is about a body that is not the
 * contract's shape at all. This one fires when the shape is right and the
 * CLAIMS inside it cannot both be true — the case that matters today being a
 * `found: false` (a definitive "no position") carried by a lookup that admits it
 * could not consult every engine.
 */
export class ContractInvariantError extends SolventError {
  override readonly name = "ContractInvariantError";
  /** Short name of the violated invariant, for branching and metrics. */
  readonly invariant: string;

  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.invariant = invariant;
  }
}

// ---------------------------------------------------------------------------
// Exact-number failures.
// ---------------------------------------------------------------------------

/** A string the contract types as a decimal integer is not one. */
export class DecimalFormatError extends SolventError {
  override readonly name = "DecimalFormatError";
  readonly value: unknown;

  constructor(value: unknown, message: string) {
    super(message);
    this.value = value;
  }
}

/**
 * The requested conversion cannot be performed without losing digits.
 *
 * Thrown INSTEAD of rounding. Health factors are 18-decimal, Aave base values
 * 8-decimal and Debt Manager USD 6-decimal; several are wider than an
 * IEEE-754 double carries losslessly, and a risk number that silently loses its
 * low digits is a wrong number wearing a plausible shape.
 */
export class PrecisionLossError extends SolventError {
  override readonly name = "PrecisionLossError";
  /** The exact value that could not be converted. */
  readonly value: bigint;
  /** What was being attempted, e.g. "toNumber" or "rescale 18 -> 6". */
  readonly operation: string;

  constructor(value: bigint, operation: string, message: string) {
    super(message);
    this.value = value;
    this.operation = operation;
  }
}

/** A quantity the contract may publish as null was required to be present. */
export class AbsentQuantityError extends SolventError {
  override readonly name = "AbsentQuantityError";
  readonly field: string;

  constructor(field: string) {
    super(
      `${field} is null: the contract distinguishes ABSENT from zero, and this ` +
        `helper refuses to read one as the other`,
    );
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Stream.
// ---------------------------------------------------------------------------

/** The event stream violated the contract's snapshot-on-connect ordering. */
export class StreamProtocolError extends SolventError {
  override readonly name = "StreamProtocolError";
  readonly event: string;
  readonly connection: number;

  constructor(event: string, connection: number, message: string) {
    super(message);
    this.event = event;
    this.connection = connection;
  }
}

/**
 * No frame — named event or heartbeat comment — arrived inside the configured
 * window, so the connection is presumed dead.
 *
 * The stream reconnects after raising this; it is surfaced rather than handled
 * silently because a consumer rendering live risk numbers is entitled to know
 * that its feed stalled.
 */
export class HeartbeatTimeoutError extends SolventError {
  override readonly name = "HeartbeatTimeoutError";
  readonly timeoutMs: number;
  readonly msSinceLastFrame: number;

  constructor(timeoutMs: number, msSinceLastFrame: number) {
    super(
      `no SSE frame for ${msSinceLastFrame}ms (heartbeat timeout ${timeoutMs}ms): ` +
        `treating the connection as dead and reconnecting`,
    );
    this.timeoutMs = timeoutMs;
    this.msSinceLastFrame = msSinceLastFrame;
  }
}

/** The stream's transport failed or the server closed the connection. */
export class StreamTransportError extends SolventError {
  override readonly name = "StreamTransportError";
  readonly url: string;
  readonly connection: number;

  constructor(url: string, connection: number, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.url = url;
    this.connection = connection;
  }
}
