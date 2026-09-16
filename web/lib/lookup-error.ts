// web/lib/lookup-error.ts
// A lookup failure, in words. An error is not an answer: none of these
// sentences is "no position", and none is a position.
import { ContractInvariantError, RateLimitedError, SolventHttpError, UnavailableError } from "@solvent/client";

export function describeLookupError(cause: unknown): string {
  if (cause instanceof UnavailableError) {
    return "no servable batch: the service refuses to answer from nothing (503)";
  }
  if (cause instanceof RateLimitedError) {
    const retry = cause.retryAfterSeconds;
    return `rate limited (429)${retry === null ? "" : `, retry after ${String(retry)}s`}`;
  }
  if (cause instanceof ContractInvariantError) {
    return `the response contradicts its own contract, so it is not rendered (${cause.message})`;
  }
  if (cause instanceof SolventHttpError) {
    return `${String(cause.status)} ${cause.code}: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
