// The one pure home for the questions every reader of `/v1/book` asks before
// it reads a figure: "is this engine withheld whole on this book, and why";
// "the book could not be read — was that the wire's own 503, or a read that
// failed"; and "the service answered — is the answer a book at all". The
// hook, the Cash view and the census reader all answer from here, so no two
// pages can disagree about the same book.
import { UnavailableError, type components } from "@solvent/client";
import { plainCause } from "./refusal-phrasebook";
import { isWirePopulation } from "./wireGuard";

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

/** The drawer's line where no book stands to describe. */
export const NO_BATCH_LOADED = "No batch loaded.";

/** The drawer's refusal section over a withheld engine: its card itemises nothing, and an empty list is never read as "None". */
export function withheldBookSentence(withheld: WholeRefusal): string {
  return `The Cash engine withheld its whole book this batch: ${plainCause(withheld.code, withheld.detail)}. A withheld book itemises no refusals.`;
}

/** The drawer's refusal section over a served engine that refused nothing. */
export const NO_REFUSALS = "None.";

/** The bad-debt card and tile where the wire reports no bad-debt figure and states no refusal of one. */
export const BAD_DEBT_NOT_REPORTED = "Not reported.";

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
 * The service answered and the body is not a book. Not "no-batch" (the wire
 * stated no absence), not a read that failed (it did not fail), and not an
 * engine's refusal: the answer is here and cannot be read, named by its fault.
 */
export interface BookUnreadable {
  readonly phase: "error";
  readonly message: string;
  readonly unreadable: true;
}

/** The hook's book, in every state it can hold. */
export type BookState =
  | { readonly phase: "loading" }
  /** `repairFault` names a later answer that could not be read and did NOT replace this book; null once a readable one lands. */
  | { readonly phase: "ok"; readonly book: BookResponse; readonly repairFault: string | null }
  | BookLoadFailure
  | BookUnreadable;

/** A field read as the untyped JSON it really is. */
function field(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

const isRecord = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

/**
 * The envelope of a `/v1/book` answer: the members EVERY reader dereferences
 * before it reads a figure — the batch and its id, the receipt's instant, the
 * lists an engine is looked up in, and the two containers the stress preview
 * and the coverage line open. Null when the envelope stands; otherwise the
 * first fault, by name. The figures inside are the views' own guards to judge;
 * this decides only whether the body may be held as a book at all.
 */
export function bookEnvelopeFault(body: unknown): string | null {
  if (!isRecord(body)) return `the body is not an object (got ${describe(body)})`;
  const batch = field(body, "batch");
  if (!isRecord(batch)) return `batch is not an object (got ${describe(batch)})`;
  const id = field(batch, "id");
  if (!isWirePopulation(id)) return `batch.id is not a wire population (got ${describe(id)})`;
  const servedAt = field(body, "served_at");
  if (typeof servedAt !== "string") return `served_at is not a string (got ${describe(servedAt)})`;
  const histogram = field(body, "hf_histogram");
  if (!isRecord(histogram)) return `hf_histogram is not an object (got ${describe(histogram)})`;
  const coverage = field(body, "coverage");
  if (!isRecord(coverage)) return `coverage is not an object (got ${describe(coverage)})`;
  // The contract's one nullable container: a book with no stress grid says so with null, and with nothing else.
  const waterfall = field(body, "waterfall");
  if (waterfall !== null && !isRecord(waterfall)) return `waterfall is neither null nor an object (got ${describe(waterfall)})`;
  const lists: readonly (readonly [string, unknown])[] = [
    ["engines", field(body, "engines")],
    ["refused_engines", field(body, "refused_engines")],
    ["bad_debt", field(body, "bad_debt")],
    ["hf_histogram.engines", field(histogram, "engines")],
    ["coverage.excluded", field(coverage, "excluded")],
  ];
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) return `${name} is not a list (got ${describe(list)})`;
    const at = list.findIndex((entry) => !isRecord(entry));
    if (at !== -1) return `${name}[${String(at)}] is not an object (got ${describe(list[at])})`;
  }
  return null;
}

/**
 * What the hook holds after `/v1/book` ANSWERS. The envelope is judged before
 * the answer is held: a readable book replaces whatever stood. An unreadable
 * answer never does — while a readable book stands and the ask was a repair
 * (`keepStanding`), that book keeps standing and the fault is named beside it;
 * otherwise (the first answer, or an explicit reload) it is the named
 * unreadable failure. A computed result is never silently replaced.
 */
export function bookAnswered(previous: BookState, body: unknown, keepStanding: boolean): BookState {
  const fault = bookEnvelopeFault(body);
  if (fault === null) return { phase: "ok", book: body as BookResponse, repairFault: null };
  if (keepStanding && previous.phase === "ok") return { ...previous, repairFault: fault };
  return { phase: "error", message: fault, unreadable: true };
}

/** What the hook holds after `/v1/book` FAILS: a repair that fails never blanks a book that stands. */
export function bookFailed(previous: BookState, cause: unknown, keepStanding: boolean): BookState {
  return keepStanding && previous.phase === "ok" ? previous : bookLoadFailure(cause);
}

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
