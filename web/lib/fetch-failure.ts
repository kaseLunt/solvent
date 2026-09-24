// What came back from a failed ask, told apart once for every page: an answer
// with a body the page could not read, an answer that failed with its HTTP
// status, or no response the page could read a status from.
import { MalformedResponseError } from "@solvent/client";

/**
 * Whether a failed ask was answered with a body the page could not read. Only
 * a 2xx body counts: the client raises the same error for a non-2xx answer
 * that lacks the contract's envelope — usually a proxy's error page — and that
 * request got no answer of the service's own, so it failed.
 */
export function answeredUnreadably(cause: unknown): boolean {
  return cause instanceof MalformedResponseError && cause.status >= 200 && cause.status < 300;
}

/**
 * The HTTP status of an answer whose body the client could not read as the contract's — the 2xx it came with, or a
 * proxy's error status; null for any other cause, whose status (if any) is its own error type's to carry.
 */
export function malformedStatus(cause: unknown): number | null {
  return cause instanceof MalformedResponseError ? cause.status : null;
}
