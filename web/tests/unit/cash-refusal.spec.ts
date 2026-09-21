// The whole-refusal predicate and the book's load failure — the one pure home
// the hook, the Cash view and the census reader answer from. A withheld engine
// is named by the book's head or by its own card's boolean `true`, and by
// nothing else; an unread book is the wire's 503 or a failed read, never an
// engine's refusal.
import { expect, test } from "@playwright/test";
import { UnavailableError } from "@solvent/client";
import {
  BAD_DEBT_NOT_REPORTED,
  bookAnswered,
  bookEnvelopeFault,
  bookFailed,
  bookLoadFailure,
  CASH_ENGINE_MISSING,
  NO_BATCH_LOADED,
  NO_REFUSALS,
  wholeRefusal,
  withheldBookSentence,
  type BookState,
} from "../../lib/cash-refusal";
import { BOOK, BOOK_ENGINE_REFUSED } from "../fixtures/book";
import { DEMO_BOOK } from "../fixtures/demo";

const CASH = "debt_manager";
const refusal = { engine: CASH, code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven for this window", note: "" };
const card = (over: Record<string, unknown>): typeof BOOK =>
  ({ ...BOOK, engines: BOOK.engines.map((e) => (e.engine === CASH ? { ...e, ...over } : e)) }) as typeof BOOK;

test("a served engine, an unlisted engine and an unanswered book are not withheld", () => {
  expect(wholeRefusal(BOOK, CASH)).toBeNull();
  expect(wholeRefusal(BOOK, "no_such_engine")).toBeNull();
  expect(wholeRefusal(null, CASH)).toBeNull();
  expect(wholeRefusal({ ...BOOK, engines: BOOK.engines.filter((e) => e.engine !== CASH) }, CASH)).toBeNull();
});

test("withheld by the book's head, or by the card's own flag — the head's entry wins, and a card with no refusal object carries empty words, never invented ones", () => {
  const head = { ...refusal, code: "SWEEP_FAILED", detail: "from the head" };
  expect(wholeRefusal({ ...BOOK, refused_engines: [refusal] }, CASH)).toEqual({ code: refusal.code, detail: refusal.detail });
  expect(wholeRefusal(card({ refused: true, refusal }), CASH)).toEqual({ code: refusal.code, detail: refusal.detail });
  expect(wholeRefusal({ ...card({ refused: true, refusal }), refused_engines: [head] }, CASH)).toEqual({ code: "SWEEP_FAILED", detail: "from the head" });
  expect(wholeRefusal(card({ refused: true, refusal: null }), CASH)).toEqual({ code: "", detail: "" });
  // The contract's own withheld example (the legacy engine): named by the head and flagged on its card.
  expect(wholeRefusal(BOOK_ENGINE_REFUSED, "aave_v3_etherfi")).not.toBeNull();
  expect(wholeRefusal(BOOK_ENGINE_REFUSED, CASH)).toBeNull();
});

test("the card's flag is the boolean true and nothing else: a truthy non-boolean is a malformed card, never a refusal one reader sees and another does not", () => {
  for (const flag of ["true", "false", 1, {}, []]) expect(wholeRefusal(card({ refused: flag, refusal }), CASH)).toBeNull();
  for (const flag of [false, null, undefined, 0, ""]) expect(wholeRefusal(card({ refused: flag, refusal }), CASH)).toBeNull();
  expect(wholeRefusal(card({ refused: true, refusal }), CASH)).not.toBeNull();
});

test("the missing engine's words exist once", () => {
  expect(CASH_ENGINE_MISSING).toBe("the Cash engine is missing from this batch");
});

test("an unread book: the wire's own 503 is no-batch with its retry hint; anything else is a failed read named by its own message", () => {
  const message = "no complete risk batch is available";
  const unavailable = new UnavailableError({
    url: "http://127.0.0.1:8080/v1/book",
    status: 503,
    code: "unavailable",
    message,
    retryAfterSeconds: 5,
    body: { error: { code: "unavailable", message, retry_after_seconds: 5 } },
  });
  expect(bookLoadFailure(unavailable)).toEqual({ phase: "no-batch", message, retryAfterSeconds: 5 });
  expect(bookLoadFailure(new Error("Failed to fetch"))).toEqual({ phase: "error", message: "Failed to fetch" });
  expect(bookLoadFailure("boom")).toEqual({ phase: "error", message: "boom" });
});

test("the drawer's words live here, once: no batch, a withheld book that itemises nothing, a served book that refused nothing, a bad-debt figure the wire does not report", () => {
  expect(NO_BATCH_LOADED).toBe("No batch loaded.");
  expect(NO_REFUSALS).toBe("None.");
  expect(BAD_DEBT_NOT_REPORTED).toBe("Not reported.");
  expect(withheldBookSentence({ code: "FLAG_CUSTODY_UNPROVEN", detail: "" })).toBe(
    "The Cash engine withheld its whole book this batch: collateral-flag custody unproven. A withheld book itemises no refusals.",
  );
});

test("the book's envelope is judged before it is held: a body that is not a book is named by its first fault — and the committed and the demo books stand", () => {
  expect(bookEnvelopeFault(BOOK)).toBeNull();
  expect(bookEnvelopeFault(DEMO_BOOK)).toBeNull();
  expect(bookEnvelopeFault(BOOK_ENGINE_REFUSED)).toBeNull();
  expect(bookEnvelopeFault(null)).toBe("the body is not an object (got null)");
  expect(bookEnvelopeFault(undefined)).toBe("the body is not an object (got undefined)");
  expect(bookEnvelopeFault([])).toBe("the body is not an object (got an array)");
  expect(bookEnvelopeFault("book")).toBe('the body is not an object (got "book")');
  expect(bookEnvelopeFault({})).toBe("batch is not an object (got undefined)");
  expect(bookEnvelopeFault({ ...BOOK, batch: null })).toBe("batch is not an object (got null)");
  expect(bookEnvelopeFault({ ...BOOK, batch: { ...BOOK.batch, id: "1" } })).toBe('batch.id is not a wire population (got "1")');
  expect(bookEnvelopeFault({ ...BOOK, batch: { ...BOOK.batch, id: -0 } })).toBe("batch.id is not a wire population (got -0)");
  expect(bookEnvelopeFault({ ...BOOK, engines: null })).toBe("engines is not a list (got null)");
  expect(bookEnvelopeFault({ ...BOOK, engines: {} })).toBe("engines is not a list (got an object)");
  expect(bookEnvelopeFault({ ...BOOK, engines: [BOOK.engines[0], null] })).toBe("engines[1] is not an object (got null)");
  expect(bookEnvelopeFault({ ...BOOK, refused_engines: undefined })).toBe("refused_engines is not a list (got undefined)");
  expect(bookEnvelopeFault({ ...BOOK, bad_debt: 0 })).toBe("bad_debt is not a list (got 0)");
  expect(bookEnvelopeFault({ ...BOOK, hf_histogram: null })).toBe("hf_histogram is not an object (got null)");
  expect(bookEnvelopeFault({ ...BOOK, hf_histogram: { ...BOOK.hf_histogram, engines: null } })).toBe("hf_histogram.engines is not a list (got null)");
  expect(bookEnvelopeFault({ ...BOOK, served_at: null })).toBe("served_at is not a string (got null)");
  expect(bookEnvelopeFault({ ...BOOK, coverage: null })).toBe("coverage is not an object (got null)");
  expect(bookEnvelopeFault({ ...BOOK, coverage: { ...BOOK.coverage, excluded: null } })).toBe("coverage.excluded is not a list (got null)");
  // A book with no stress grid says so with null; anything else that is not an object is a fault. What the grid HOLDS is the preview's to judge.
  expect(bookEnvelopeFault({ ...BOOK, waterfall: null })).toBeNull();
  expect(bookEnvelopeFault({ ...BOOK, waterfall: undefined })).toBe("waterfall is neither null nor an object (got undefined)");
  expect(bookEnvelopeFault({ ...BOOK, waterfall: { ...BOOK.waterfall, points: null } })).toBeNull();
});

test("a malformed answer never becomes the book: the FIRST one is the named unreadable failure; a background REPAIR leaves the readable book standing and names the fault beside it; the next readable answer clears it", () => {
  const loading: BookState = { phase: "loading" };
  const held: BookState = { phase: "ok", book: BOOK, repairFault: null };
  // The first answer, readable: held, with nothing standing against it.
  expect(bookAnswered(loading, BOOK, false)).toEqual(held);
  // The first answer, malformed: never `ok` — a named failure that is not "no-batch" and not a failed read.
  for (const body of [null, {}, { ...BOOK, engines: null }, { ...BOOK, batch: null }]) {
    const next = bookAnswered(loading, body, false);
    expect(next.phase).toBe("error");
    expect(next).toEqual({ phase: "error", message: bookEnvelopeFault(body), unreadable: true });
  }
  expect(bookAnswered(loading, { ...BOOK, engines: null }, true)).toEqual({ phase: "error", message: "engines is not a list (got null)", unreadable: true });
  // A repair: the readable book is never replaced, and the fault is named beside it.
  const repaired = bookAnswered(held, { ...BOOK, engines: null }, true);
  expect(repaired).toEqual({ phase: "ok", book: BOOK, repairFault: "engines is not a list (got null)" });
  expect(bookAnswered(held, null, true)).toEqual({ phase: "ok", book: BOOK, repairFault: "the body is not an object (got null)" });
  // The next readable answer replaces the book and clears the fault.
  const newer = { ...BOOK, batch: { ...BOOK.batch, id: BOOK.batch.id + 1 } };
  expect(bookAnswered(repaired, newer, true)).toEqual({ phase: "ok", book: newer, repairFault: null });
  // An explicit reload asked for a fresh answer: an unreadable one is the named failure, never a silent stand-in.
  expect(bookAnswered(held, null, false)).toEqual({ phase: "error", message: "the body is not an object (got null)", unreadable: true });
  // A repair that FAILS keeps the book too — and a fault already named beside it stays named.
  expect(bookFailed(held, new Error("Failed to fetch"), true)).toBe(held);
  expect(bookFailed(repaired, new Error("Failed to fetch"), true)).toBe(repaired);
  expect(bookFailed(held, new Error("Failed to fetch"), false)).toEqual({ phase: "error", message: "Failed to fetch" });
  expect(bookFailed(loading, new Error("Failed to fetch"), true)).toEqual({ phase: "error", message: "Failed to fetch" });
});
