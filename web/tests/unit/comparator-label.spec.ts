// Phase 0 fix 4: wire tokens are identifiers, not reader copy (audit: Book
// histogram printed "comparator: hf_num/hf_den" verbatim).
import { expect, test } from "@playwright/test";
import { comparatorReaderLabel } from "../../lib/book-copy";

test("comparator tokens humanize per engine semantics", () => {
  expect(comparatorReaderLabel("hf_wad")).toBe("the pool's own health factor (wad)");
  expect(comparatorReaderLabel("hf_num/hf_den")).toBe(
    "maxBorrowLT/borrowings — a disclosure, not the engine's trigger",
  );
});

test("an unknown token passes through verbatim rather than being guessed at", () => {
  expect(comparatorReaderLabel("something_new")).toBe("something_new");
});
