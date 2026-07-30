// @solvent/client — a typed client for the Solvent Risk API.
//
// `api/openapi.yaml` is the contract. Every type in this package is generated
// from it; the hand-written layer is a fetch wrapper, a typed error taxonomy, an
// SSE client, and exact bigint helpers that refuse rather than round.
//
// NOT PUBLISHED. `private: true` holds until P5. See README.md.

export { SolventClient } from "./client.js";
export type { FetchLike, ResponseLike, SolventClientOptions } from "./client.js";

export { fetchEventSource } from "./fetch-event-source.js";
export type {
  FetchEventSourceOptions,
  StreamFetchLike,
  StreamResponseLike,
} from "./fetch-event-source.js";

export { SolventStream, STREAM_EVENTS } from "./sse.js";
export type {
  EventSourceFactory,
  EventSourceLike,
  MessageLike,
  ReconnectPolicy,
  StreamEvent,
  StreamEventName,
  StreamOptions,
  StreamScheduler,
  StreamState,
} from "./sse.js";

export {
  AbsentQuantityError,
  BadRequestError,
  DecimalFormatError,
  HeartbeatTimeoutError,
  InternalError,
  MalformedResponseError,
  NotFoundError,
  PrecisionLossError,
  RateLimitedError,
  SchemaVersionMismatchError,
  SolventError,
  SolventHttpError,
  SolventNetworkError,
  SolventUsageError,
  StreamProtocolError,
  StreamTransportError,
  UnavailableError,
} from "./errors.js";
export type { HttpErrorInit, SchemaMismatchField } from "./errors.js";

export {
  aaveEligibleFromWad,
  compareRatio,
  formatDecimal,
  formatUnits,
  healthFactorRatio,
  isDecimal,
  parseDecimal,
  parseNullableDecimal,
  parseUnits,
  positionEligible,
  requireDecimal,
  rescale,
  toNumber,
} from "./decimal.js";
export type { FormatUnitsOptions } from "./decimal.js";

export * from "./types.js";
export type { components, operations, paths } from "./generated/schema.js";
