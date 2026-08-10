// The coverage chip's HONEST derivation, pinned as a pure function (p1a-4b —
// the review finding: every stream fixture ships refused_engines: [], so the
// honesty arms were unpinned; p1a-9 — the Codex finding: the derivation
// divided INCOMPATIBLE sets).
//
// The laws (canon §05 dimension 3 — "counts reconcile visibly … no silent
// shrinkage"):
//   - total   = the DEDUPED risk-engine AGGREGATE roster's size — the batch's
//     risk BOOKS, never the watermark stamp vector (the stamp vector is the
//     FULL pipeline input set: five stamps on production over a two-book
//     deployment — the p1a-9 defect);
//   - withheld = the DEDUPED refused_engines (schema: "engines whose WHOLE
//     book is withheld" — a withheld book still has an aggregate row, which
//     is how the store derives the name list);
//   - answered = total − withheld;
//   - ROSTER ABSENT → NULL: `engines` is optional on the stream envelope; a
//     frame without it gives no denominator, so the chip is WITHHELD, never
//     approximated from the stamps;
//   - UNBINDABLE → NULL: a refused name with no aggregate row gives the
//     arithmetic no honest denominator either (Track B gap, ledgered §p1a-4).
import { expect, test } from "@playwright/test";
import { ribbonCoverage } from "../../lib/coverage";

// ---------------------------------------------------------------------------
// THE PRODUCTION-SHAPED ENVELOPE (p1a-9). The watermark vector carries FIVE
// stamps — position, param and price engines — exactly as the live deployment
// serves it; the aggregate roster carries the TWO risk books. The envelope
// keeps its `watermarks` field ON PURPOSE: a derivation reverted to reading
// the stamp vector types-checks against this fixture and then dies at the
// 2/2 pin below with 5/5.
// ---------------------------------------------------------------------------

const FIVE_STAMP_BATCH = {
  watermarks: [
    { engine: "aave_param" },
    { engine: "aave_v3_etherfi" },
    { engine: "debt_manager" },
    { engine: "prices:poll:1" },
    { engine: "prices:poll:10" },
  ],
  refused_engines: [] as string[],
};

const TWO_BOOK_ROSTER = [{ engine: "aave_v3_etherfi" }, { engine: "debt_manager" }];

test("THE FIVE-STAMP PIN: a production-shaped envelope counts its two RISK BOOKS, never its five stamps", () => {
  expect(ribbonCoverage(FIVE_STAMP_BATCH, TWO_BOOK_ROSTER)).toEqual({
    answered: 2,
    total: 2,
    withheld: [],
  });
});

test("full coverage: every book in the aggregate roster answered", () => {
  expect(ribbonCoverage({ refused_engines: [] }, TWO_BOOK_ROSTER)).toEqual({
    answered: 2,
    total: 2,
    withheld: [],
  });
});

test("partial coverage: a book whose whole aggregate is withheld is COUNTED and NAMED — 1/2, on five stamps", () => {
  expect(
    ribbonCoverage({ ...FIVE_STAMP_BATCH, refused_engines: ["debt_manager"] }, TWO_BOOK_ROSTER),
  ).toEqual({
    answered: 1,
    total: 2,
    withheld: ["debt_manager"],
  });
});

test("ROSTER ABSENT withholds the chip entirely — a frame without aggregates has no denominator", () => {
  // `engines` is optional on the stream envelope. No roster, no chip — the
  // five-stamp watermark vector is RIGHT THERE on the envelope and must not
  // be reached for: it is the wrong population.
  expect(ribbonCoverage(FIVE_STAMP_BATCH, null)).toBeNull();
  // An EMPTY roster is the same absence: nothing to divide.
  expect(ribbonCoverage(FIVE_STAMP_BATCH, [])).toBeNull();
});

test("an UNBINDABLE refusal withholds the derivation entirely — null, never an invented count", () => {
  // The wire names a refused engine that has no aggregate row: total has no
  // honest value, so there is no chip. Rendering any fraction here would be
  // the silent shrinkage the dimension exists to prevent.
  expect(
    ribbonCoverage({ refused_engines: ["ghost_engine"] }, TWO_BOOK_ROSTER),
  ).toBeNull();
  // Even alongside a bindable refusal: one unbindable name poisons the whole
  // denominator, not just its own entry.
  expect(
    ribbonCoverage({ refused_engines: ["debt_manager", "ghost_engine"] }, TWO_BOOK_ROSTER),
  ).toBeNull();
  // A refused name that is a STAMP but not a BOOK is unbindable too — the
  // price poller is not a book, and binding it would resurrect the defect.
  expect(
    ribbonCoverage({ ...FIVE_STAMP_BATCH, refused_engines: ["prices:poll:1"] }, TWO_BOOK_ROSTER),
  ).toBeNull();
});

test("refused names are DEDUPED before they subtract — a repeated name is one withholding", () => {
  expect(
    ribbonCoverage({ refused_engines: ["debt_manager", "debt_manager"] }, TWO_BOOK_ROSTER),
  ).toEqual({
    answered: 1,
    total: 2,
    withheld: ["debt_manager"],
  });
});

test("the roster is DEDUPED too — a repeated aggregate row is one book", () => {
  expect(
    ribbonCoverage({ refused_engines: [] }, [...TWO_BOOK_ROSTER, { engine: "debt_manager" }]),
  ).toEqual({
    answered: 2,
    total: 2,
    withheld: [],
  });
});
