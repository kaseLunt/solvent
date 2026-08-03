// W-SD-A — the Scenario surface's COMPUTED cliff sentence, pinned.
//
// Laws under test:
//   - the sentence is COMPUTED from the served waterfall: mutate the input and
//     the words change. No money amount and no percentage is hardcoded in
//     `labDek.ts` at all;
//   - the THREE shapes the ruling names — cliff at a later step, cliff at the
//     FIRST shocked step, and no cliff anywhere — each render as their own
//     sentence, never as one sentence with a blank in it;
//   - bad debt is stated whether present or absent, and its absence at the
//     terminal step is said in words rather than shown as a bare "$0";
//   - the baseline's standing census is a CENSUS, never read as a cliff;
//   - engine scope is unmissable: the terminal Σ names the engine whose book
//     it is, because the wire forbids summing engine books;
//   - a withheld engine's side is unknown, NOT zero, and a broken monotonicity
//     invariant is named rather than smoothed.
//
// Fixture mutations below are DERIVED NEGATIVES, each documented at its site:
// the point is that a changed input changes the sentence, which cannot be
// demonstrated with an unchanging fixture.

import { expect, test } from "@playwright/test";
import type { Waterfall, WaterfallPoint } from "@solvent/client";
import { BOOK, BOOK_ENGINE_REFUSED, BOOK_MONOTONICITY_VIOLATION } from "../fixtures/book";
import {
  LAB_DEK_LOADING,
  LAB_DEK_NO_GRID,
  LAB_DEK_NO_WATERFALL,
  labDek,
} from "../../app/lab/labDek";

const MINUS = "−";

function waterfallOf(book: { waterfall: unknown }): Waterfall {
  return book.waterfall as Waterfall;
}

const BASE = waterfallOf(BOOK);

/** Rewrite one grid point's per-engine `newly_eligible_accounts`. */
function withNewly(waterfall: Waterfall, counts: Record<number, Record<string, number>>): Waterfall {
  const points: WaterfallPoint[] = waterfall.points.map((point) => ({
    ...point,
    engines: point.engines.map((engine) => {
      const wanted = counts[point.index]?.[engine.engine];
      return wanted === undefined ? engine : { ...engine, newly_eligible_accounts: wanted };
    }),
  }));
  return { ...waterfall, points };
}

/** Zero every engine's bad debt at every point. */
function withoutBadDebt(waterfall: Waterfall): Waterfall {
  return {
    ...waterfall,
    points: waterfall.points.map((point) => ({
      ...point,
      engines: point.engines.map((engine) => ({ ...engine, cumulative_bad_debt_usd: "0" })),
    })),
  };
}

test("CLIFF AT THE FIRST SHOCKED STEP — the fixture's own shape, stated as such", () => {
  // book.json: aave gains its first eligible account at grid point 1, the
  // first step after the ×1.00 census. The sentence says the first step bites.
  expect(labDek(BASE)).toBe(
    `The first step already bites: ETH down 10% makes 1 account on aave_v3_etherfi newly ` +
      `liquidatable. By ${MINUS}50%, aave_v3_etherfi's Σ eligible debt reaches $6,000 and its ` +
      `bad debt $2,190.47619048.`,
  );
});

test("CLIFF AT STEP k — nothing new until the shock deepens", () => {
  // DERIVED NEGATIVE: move aave's first crossing from grid point 1 to point 2.
  // Nothing else changes, so any difference in the sentence is the cliff's.
  const moved = withNewly(BASE, {
    1: { aave_v3_etherfi: 0 },
    2: { aave_v3_etherfi: 1 },
  });
  expect(labDek(moved)).toBe(
    `Nothing new becomes liquidatable until ETH is down 20% — then 1 account on ` +
      `aave_v3_etherfi crosses. By ${MINUS}50%, aave_v3_etherfi's Σ eligible debt reaches ` +
      `$6,000 and its bad debt $2,190.47619048.`,
  );
  // COMPUTED, not asserted: the same input with the cliff one step deeper says
  // a different percentage.
  const deeper = withNewly(BASE, {
    1: { aave_v3_etherfi: 0 },
    3: { aave_v3_etherfi: 1 },
  });
  expect(labDek(deeper)).toContain("until ETH is down 30%");
  expect(labDek(deeper)).not.toContain("down 20%");
});

test("NO CLIFF ANYWHERE — the terminal clause is STATED, and the census is a census", () => {
  // WAVE R8 (round-16 finding 3) CHANGED THIS EXPECTATION, and the change IS
  // the finding. Shape C returned before the terminal clause, so this exact
  // fixture — whose debt_manager bad debt RISES from $239.603961 at ×1.00 to
  // $2,219.801981 by −50% — said "nothing new becomes liquidatable anywhere on
  // this grid" and stopped. A book can be quietly insolvent with ZERO new
  // eligibility; the sentence that answers only the eligibility question reads
  // as an all-clear over a book that is losing money.
  //
  // The baseline count must still NOT be read as a cliff — that law is
  // unchanged and is why the census clause is still the next sentence.
  expect(labDek(waterfallOf(BOOK_ENGINE_REFUSED))).toBe(
    `Nothing new becomes liquidatable anywhere on this grid — not even at ETH down 50% — and ` +
      `debt_manager's bad debt still reaches $2,219.801981 by ${MINUS}50%: a book can be ` +
      `insolvent with nothing new becoming liquidatable. ` +
      `1 account on debt_manager is already eligible at the unshocked mark — a standing ` +
      `census, not a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi) — its side is unknown, not zero.`,
  );
});

test("NO CLIFF × COMPUTED-ZERO BAD DEBT — an absence, in words, scoped to the whole grid", () => {
  // DERIVED NEGATIVE: the same no-cliff grid with every engine's bad debt
  // zeroed at every point. The distinction the other shapes make — a positive
  // amount versus a COMPUTED zero over a book the engine was allowed to
  // compute — now exists here too, and the zero is said rather than printed.
  //
  // The scope word is EARNED: "anywhere on this grid" is a claim about every
  // served point, and the clause checks every served point before making it.
  const clean = withoutBadDebt(waterfallOf(BOOK_ENGINE_REFUSED));
  expect(labDek(clean)).toBe(
    `Nothing new becomes liquidatable anywhere on this grid — not even at ETH down 50%, with ` +
      `no bad debt on debt_manager's book anywhere on this grid. ` +
      `1 account on debt_manager is already eligible at the unshocked mark — a standing ` +
      `census, not a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi) — its side is unknown, not zero.`,
  );
  expect(labDek(clean)).not.toContain("bad debt $0");
  expect(labDek(clean)).not.toContain("$0");
});

test("NO CLIFF × ONE BASELINE POINT — the terminal clause still lands, in the right words", () => {
  // DERIVED NEGATIVE: a grid carrying ONLY the unshocked point. There is no
  // step after the baseline, so there can be no cliff — and there is no
  // "by −50%" to say either, because the terminal point is not a move. The
  // clause names the mark instead of inventing a percentage for it.
  const baselineOnly: Waterfall = {
    ...waterfallOf(BOOK_ENGINE_REFUSED),
    points: waterfallOf(BOOK_ENGINE_REFUSED).points.slice(0, 1),
  };
  expect(labDek(baselineOnly)).toBe(
    `Nothing new becomes liquidatable anywhere on this grid — not even at anywhere the grid ` +
      `reaches — and debt_manager's bad debt still reaches $239.603961 at the unshocked mark: ` +
      `a book can be insolvent with nothing new becoming liquidatable. ` +
      `1 account on debt_manager is already eligible at the unshocked mark — a standing ` +
      `census, not a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi) — its side is unknown, not zero.`,
  );
  // COMPUTED, not asserted: the amount is the BASELINE point's own bad debt,
  // not the deeper grid's — a different served point produces a different number.
  expect(labDek(baselineOnly)).not.toContain("2,219.801981");
});

test("BAD DEBT IS STATED IN EVERY SHAPE — and the claim is exercised on every shape", () => {
  // THE VACUOUS GREEN THIS REPLACES (round-16 finding 3): the suite claimed
  // "bad debt is stated whether present or absent" while only ever running the
  // CLIFF shape past `terminalClause`. Shape C returned early and no test went
  // there, so the claim was true of the code paths it visited and false of the
  // file. Each shape is now named, and each is asserted.
  const cliffShape = labDek(BASE); // shape B — the first step bites
  const laterCliff = labDek(withNewly(BASE, { 1: { aave_v3_etherfi: 0 }, 2: { aave_v3_etherfi: 1 } })); // shape A
  const noCliff = labDek(waterfallOf(BOOK_ENGINE_REFUSED)); // shape C
  for (const sentence of [cliffShape, laterCliff, noCliff]) {
    expect(sentence.toLowerCase()).toContain("bad debt");
  }
  // …and each names the ENGINE whose book it is, because engine books are
  // never summed.
  expect(cliffShape).toContain("aave_v3_etherfi's Σ eligible debt");
  expect(laterCliff).toContain("aave_v3_etherfi's Σ eligible debt");
  expect(noCliff).toContain("debt_manager's bad debt");
});

test("no cliff AND no standing census: the sentence still refuses to imply safety", () => {
  const quiet = withNewly(BASE, {
    0: { aave_v3_etherfi: 0, debt_manager: 0 },
    1: { aave_v3_etherfi: 0, debt_manager: 0 },
  });
  const flat: Waterfall = {
    ...quiet,
    points: quiet.points.map((point) => ({
      ...point,
      engines: point.engines.map((engine) => ({
        ...engine,
        newly_eligible_accounts: 0,
        cumulative_eligible_accounts: 0,
      })),
    })),
  };
  expect(labDek(flat)).toContain("Nothing new becomes liquidatable anywhere on this grid");
  expect(labDek(flat)).toContain("No account is eligible at the unshocked mark either.");
});

test("BAD DEBT PRESENT — the terminal amount, in the lead engine's own decimals", () => {
  // $2,190.47619048 is 219047619048 at aave's usd_decimals 8. A different
  // decimals would print a different number from the same integer.
  expect(labDek(BASE)).toContain("its bad debt $2,190.47619048");
});

test("BAD DEBT ABSENT — said in words, never shown as a bare $0", () => {
  const clean = withoutBadDebt(BASE);
  const sentence = labDek(clean);
  expect(sentence).toContain("with no bad debt on its book at that step");
  expect(sentence).not.toContain("bad debt $0");
});

test("the terminal Σ NAMES its engine — engine books are never summed", () => {
  const sentence = labDek(BASE);
  // aave carries $6,000 at the terminal step, debt_manager $4,200. The
  // sentence reports ONE engine, named, and never their sum ($10,200).
  expect(sentence).toContain("aave_v3_etherfi's Σ eligible debt reaches $6,000");
  expect(sentence).not.toContain("10,200");
});

test("the lead engine FOLLOWS THE DATA — raise the other book and the name changes", () => {
  // DERIVED NEGATIVE: give debt_manager a terminal Σ larger than aave's
  // $6,000 in real USD (7,000 at 6 decimals = 7000000000).
  const flipped: Waterfall = {
    ...BASE,
    points: BASE.points.map((point, index) =>
      index === BASE.points.length - 1
        ? {
            ...point,
            engines: point.engines.map((engine) =>
              engine.engine === "debt_manager"
                ? { ...engine, cumulative_debt_eligible_usd: "7000000000" }
                : engine,
            ),
          }
        : point,
    ),
  };
  expect(labDek(flipped)).toContain("debt_manager's Σ eligible debt reaches $7,000");
  expect(labDek(flipped)).not.toContain("aave_v3_etherfi's Σ eligible debt");
});

test("a broken monotonicity invariant is NAMED, with the offending point", () => {
  const sentence = labDek(waterfallOf(BOOK_MONOTONICITY_VIOLATION));
  expect(sentence).toContain("breaks its monotonicity invariant at debt_manager step 2");
  expect(sentence).toContain("not smoothed");
});

test("no waterfall and no grid are ABSENCES, each named, neither a flat frontier", () => {
  expect(labDek(null)).toBe(LAB_DEK_NO_WATERFALL);
  expect(labDek({ ...BASE, points: [] })).toBe(LAB_DEK_NO_GRID);
  expect(LAB_DEK_NO_WATERFALL).toContain("That is an absence, not a book with nothing in it.");
});

test("the loading dek states what the surface IS — it invents no number", () => {
  expect(LAB_DEK_LOADING).not.toMatch(/[0-9]/);
  expect(LAB_DEK_LOADING).toContain("which engines each scenario is even defined for");
});
