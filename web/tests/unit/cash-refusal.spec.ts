// The whole-refusal predicate and the book's load failure — the one pure home
// the hook, the Cash view and the census reader answer from. A withheld engine
// is named by the book's head or by its own card's boolean `true`, and by
// nothing else; an unread book is the wire's 503 or a failed read, never an
// engine's refusal.
import { expect, test } from "@playwright/test";
import { UnavailableError } from "@solvent/client";
import { bookLoadFailure, CASH_ENGINE_MISSING, wholeRefusal } from "../../lib/cash-refusal";
import { BOOK, BOOK_ENGINE_REFUSED } from "../fixtures/book";

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
