// Wave R1 item 9 — the Book's computed verdict dek, pinned.
//
// Laws under test:
//   - the sentence is COMPUTED from the served response (mutate the input,
//     the sentence changes) — never asserted, never hardcoded;
//   - the counts come from ONE function (`engineCounts`) reading exactly the
//     fields the stat cards read today, so a parallel Go wave's aggregate fix
//     lands in one place;
//   - a withheld engine's side is UNKNOWN, never zero — the sentence says so
//     in those words, and never prints a 0 for it.

import { expect, test } from "@playwright/test";
import type { Aggregate, BadDebt } from "@solvent/client";
import { BOOK, BOOK_ENGINE_REFUSED } from "../fixtures/book";
import { BOOK_DEK_LOADING, bookDek, engineCounts } from "../../app/book/bookDek";

const engines = BOOK.engines as unknown as Aggregate[];
const badDebt = BOOK.bad_debt as unknown as BadDebt[];

test("both engines served: the adjudicated sentence, computed from the response", () => {
  expect(bookDek({ batchId: BOOK.batch.id, engines, badDebt })).toBe(
    "As of batch #1, aave_v3_etherfi has 0 of 1 positions liquidatable (Σ eligible debt $0) " +
      "and debt_manager 1 of 1 (Σ $4,200); standing bad debt $0 and $239.603961.",
  );
});

test("the sentence is COMPUTED — a changed count changes the words", () => {
  const mutated = engines.map((aggregate) =>
    aggregate.engine === "debt_manager"
      ? { ...aggregate, liquidatable_positions: 7, computed_positions: 9 }
      : aggregate,
  );
  expect(bookDek({ batchId: 42, engines: mutated, badDebt })).toContain("debt_manager 7 of 9");
  expect(bookDek({ batchId: 42, engines: mutated, badDebt })).toContain("As of batch #42");
});

test("ONE count source: engineCounts reads the same fields the stat cards read", () => {
  const dm = engines.find((aggregate) => aggregate.engine === "debt_manager") as Aggregate;
  expect(engineCounts(dm)).toEqual({
    liquidatable: dm.liquidatable_positions,
    denominator: dm.computed_positions,
  });
});

test("one engine withheld: its side is UNKNOWN, and the sentence never prints a 0 for it", () => {
  const sentence = bookDek({
    batchId: BOOK_ENGINE_REFUSED.batch.id,
    engines: BOOK_ENGINE_REFUSED.engines as unknown as Aggregate[],
    badDebt: BOOK_ENGINE_REFUSED.bad_debt as unknown as BadDebt[],
  });
  expect(sentence).toBe(
    "As of batch #1, debt_manager has 1 of 1 positions liquidatable (Σ eligible debt $4,200); " +
      "aave_v3_etherfi's whole book is withheld (FLAG_CUSTODY_UNPROVEN) — its side is unknown, " +
      "not zero.",
  );
  expect(sentence).not.toContain("aave_v3_etherfi has 0");
});

test("EVERY engine withheld (untemplated by the ruling) still refuses to imply zero", () => {
  const allRefused = (BOOK_ENGINE_REFUSED.engines as unknown as Aggregate[]).map((aggregate) => ({
    ...aggregate,
    refused: true,
    refusal: aggregate.refusal ?? {
      engine: aggregate.engine,
      code: "WITHHELD",
      detail: "",
      note: "",
    },
  }));
  const sentence = bookDek({ batchId: 3, engines: allRefused, badDebt: [] });
  expect(sentence).toContain("every engine's whole book is withheld");
  expect(sentence).toContain("none is zero");
});

test("the loading fallback states what the surface IS — it never invents a number", () => {
  expect(BOOK_DEK_LOADING).toBe(
    "Every account both engines cover — what each engine would liquidate, and what it refused " +
      "to price.",
  );
  expect(BOOK_DEK_LOADING).not.toMatch(/[0-9]/);
});
