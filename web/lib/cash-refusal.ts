// The one pure home for two questions every reader of `/v1/book` asks before
// it reads a figure: "is this engine withheld whole on this book, and why",
// and "the book could not be read — was that the wire's own 503, or a read
// that failed". The hook, the Cash view and the census reader all answer from
// here, so no two pages can disagree about the same book.
import { UnavailableError, type components } from "@solvent/client";

type BookResponse = components["schemas"]["BookResponse"];

/** An engine withheld whole: the wire's code and detail, empty strings where it stated none. */
export interface WholeRefusal {
  readonly code: string;
  readonly detail: string;
}

/**
 * The words for an engine the book does not list at all. Missing is not
 * withheld and not empty: the book answered and the engine is not on it.
 */
export const CASH_ENGINE_MISSING = "the Cash engine is missing from this batch";

/**
 * An engine withheld whole on this book: named in `refused_engines` (the
 * head's entry wins), or flagged on its own aggregate — a withheld engine
 * "whatever the position counts say". The aggregate's flag is the boolean
 * `true` and nothing else: a truthy non-boolean is a malformed card, never a
 * refusal one reader sees and another does not. Null for a served engine, an
 * engine the book does not list, and a book that has not answered.
 */
export function wholeRefusal(book: BookResponse | null, name: string): WholeRefusal | null {
  if (book === null) return null;
  const listed = book.refused_engines.find((r) => r.engine === name);
  if (listed !== undefined) return { code: listed.code, detail: listed.detail };
  const engine = book.engines.find((e) => e.engine === name);
  if (engine !== undefined && engine.refused === true) {
    return { code: engine.refusal?.code ?? "", detail: engine.refusal?.detail ?? "" };
  }
  return null;
}

/** A book that could not be read, as the hook holds it. */
export type BookLoadFailure =
  | { readonly phase: "no-batch"; readonly message: string; readonly retryAfterSeconds: number | null }
  | { readonly phase: "error"; readonly message: string };

/**
 * Why `/v1/book` did not answer. The wire's own 503 is "no-batch" — the one
 * absence it states, with its retry hint; anything else is a read that failed,
 * named by its own message. Neither is an engine's refusal: an unread book
 * refused nothing and computed nothing.
 */
export function bookLoadFailure(cause: unknown): BookLoadFailure {
  return cause instanceof UnavailableError
    ? { phase: "no-batch", message: cause.body.error.message, retryAfterSeconds: cause.retryAfterSeconds }
    : { phase: "error", message: cause instanceof Error ? cause.message : String(cause) };
}
