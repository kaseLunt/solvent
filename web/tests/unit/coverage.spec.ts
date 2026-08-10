// The coverage chip's HONEST derivation, pinned as a pure function (p1a-4b —
// the review finding: every stream fixture ships refused_engines: [], so the
// happy `COVERAGE 2/2 ENGINES` pin alone left the honesty arms unpinned).
//
// The laws (canon §05 dimension 3 — "counts reconcile visibly … no silent
// shrinkage"):
//   - total   = the stamp vector's length (one entry per engine the batch
//     binds; a served batch requires ≥ 1 stamp);
//   - withheld = the DEDUPED refused_engines (schema: "engines whose WHOLE
//     book is withheld" — on the summary precisely because refused_count
//     counts position rows and is zero for an engine withheld with no
//     accounts behind it);
//   - answered = total − withheld;
//   - UNBINDABLE → NULL: a refused engine with no stamp gives the arithmetic
//     no honest denominator, so the chip is withheld ENTIRELY rather than
//     invented (Track B envelope gap, ledgered §p1a-4).
import { expect, test } from "@playwright/test";
import { ribbonCoverage } from "../../lib/coverage";

const STAMPED_TWO = {
  watermarks: [{ engine: "aave_v3_etherfi" }, { engine: "debt_manager" }],
  refused_engines: [] as string[],
};

test("full coverage: every stamped engine answered", () => {
  expect(ribbonCoverage(STAMPED_TWO)).toEqual({
    answered: 2,
    total: 2,
    withheld: [],
  });
});

test("partial coverage: a stamped engine's whole book withheld is COUNTED and NAMED", () => {
  expect(
    ribbonCoverage({ ...STAMPED_TWO, refused_engines: ["debt_manager"] }),
  ).toEqual({
    answered: 1,
    total: 2,
    withheld: ["debt_manager"],
  });
});

test("an UNBINDABLE refusal withholds the derivation entirely — null, never an invented count", () => {
  // The wire names a refused engine that carries no stamp: total has no
  // honest value, so there is no chip. Rendering any fraction here would be
  // the silent shrinkage the dimension exists to prevent.
  expect(
    ribbonCoverage({ ...STAMPED_TWO, refused_engines: ["ghost_engine"] }),
  ).toBeNull();
  // Even alongside a bindable refusal: one unbindable name poisons the whole
  // denominator, not just its own entry.
  expect(
    ribbonCoverage({ ...STAMPED_TWO, refused_engines: ["debt_manager", "ghost_engine"] }),
  ).toBeNull();
});

test("refused names are DEDUPED before they subtract — a repeated name is one withholding", () => {
  expect(
    ribbonCoverage({ ...STAMPED_TWO, refused_engines: ["debt_manager", "debt_manager"] }),
  ).toEqual({
    answered: 1,
    total: 2,
    withheld: ["debt_manager"],
  });
});

test("an empty stamp vector has no denominator — null (cannot occur on a served batch, refused anyway)", () => {
  expect(ribbonCoverage({ watermarks: [], refused_engines: [] })).toBeNull();
});
