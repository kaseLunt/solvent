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
//   - TERMINAL SOLVENCY IS READ FOR EVERY SERVED ENGINE (Wave R9, round-17
//     finding 2), never for the lead alone: each insolvent engine gets its own
//     possessive clause at its own decimals, two are never added together, and
//     the all-clean wording is emitted only when every served engine is clean
//     over the scope it claims;
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
  return withoutBadDebtOn(waterfall, null);
}

/**
 * Zero bad debt at every point for the NAMED engines (null = all of them).
 *
 * WAVE R9's whole instrument: `book.json` serves TWO engines that are BOTH
 * insolvent at the terminal step, so isolating "only the lead is insolvent"
 * and "only the NON-lead is insolvent" needs one of them silenced. Nothing
 * else about the point is touched, so any change in the sentence is that
 * engine's bad debt and nothing else.
 */
function withoutBadDebtOn(waterfall: Waterfall, engines: string[] | null): Waterfall {
  return {
    ...waterfall,
    points: waterfall.points.map((point) => ({
      ...point,
      engines: point.engines.map((engine) =>
        engines === null || engines.includes(engine.engine)
          ? { ...engine, cumulative_bad_debt_usd: "0" }
          : engine,
      ),
    })),
  };
}

/** The same grid with NO new eligibility anywhere — shape C, on two engines. */
function withoutAnyCliff(waterfall: Waterfall): Waterfall {
  return {
    ...waterfall,
    points: waterfall.points.map((point) => ({
      ...point,
      engines: point.engines.map((engine) => ({ ...engine, newly_eligible_accounts: 0 })),
    })),
  };
}

/**
 * The LEAD at the terminal step of `book.json` is aave_v3_etherfi ($6,000 at 8
 * decimals) and the NON-lead is debt_manager ($4,200 at 6). Both carry bad debt
 * at that step — $2,190.47619048 and $2,219.801981 — which is why this fixture
 * is the finding's own witness rather than a constructed one.
 */
const LEAD = "aave_v3_etherfi";
const NON_LEAD = "debt_manager";
const LEAD_BAD = "$2,190.47619048";
const NON_LEAD_BAD = "$2,219.801981";

test("CLIFF AT THE FIRST SHOCKED STEP — the fixture's own shape, stated as such", () => {
  // book.json: aave gains its first eligible account at grid point 1, the
  // first step after the ×1.00 census. The sentence says the first step bites.
  //
  // WAVE R9 (round-17 finding 2) CHANGED THIS EXPECTATION, and the change IS
  // the finding. The clause after the Σ was LEAD-SCOPED: it stated aave's
  // $2,190.47619048 and stopped, over a terminal step where debt_manager's bad
  // debt reaches $2,219.801981. The committed fixture has been carrying a
  // second insolvent engine this whole time and the dek never said its name.
  expect(labDek(BASE)).toBe(
    `The first step already bites: ETH down 10% makes 1 account on aave_v3_etherfi newly ` +
      `liquidatable. By ${MINUS}50%, aave_v3_etherfi's Σ eligible debt reaches $6,000 and its ` +
      `bad debt $2,190.47619048, and debt_manager's bad debt reaches $2,219.801981 at that ` +
      `same step.`,
  );
  // NEVER SUMMED: $2,190.47619048 + $2,219.801981 = $4,410.278171. The two
  // engines are named side by side, in their own decimals, and no third number
  // exists anywhere in the sentence.
  expect(labDek(BASE)).not.toContain("4,410");
});

test("CLIFF AT STEP k — nothing new until the shock deepens", () => {
  // DERIVED NEGATIVE: move aave's first crossing from grid point 1 to point 2.
  // Nothing else changes, so any difference in the sentence is the cliff's.
  const moved = withNewly(BASE, {
    1: { aave_v3_etherfi: 0 },
    2: { aave_v3_etherfi: 1 },
  });
  // WAVE R9 CHANGED THIS EXPECTATION for the same reason as the shape above:
  // the terminal bad-debt clause was lead-only, so shape A hid the non-lead
  // engine's $2,219.801981 exactly as shape B did.
  expect(labDek(moved)).toBe(
    `Nothing new becomes liquidatable until ETH is down 20%. Then 1 account on ` +
      `aave_v3_etherfi crosses. By ${MINUS}50%, aave_v3_etherfi's Σ eligible debt reaches ` +
      `$6,000 and its bad debt $2,190.47619048, and debt_manager's bad debt reaches ` +
      `$2,219.801981 at that same step.`,
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
    `Nothing new becomes liquidatable anywhere on this grid, not even at ETH down 50%, and ` +
      `debt_manager's bad debt still reaches $2,219.801981 by ${MINUS}50%: a book can be ` +
      `insolvent with nothing new becoming liquidatable. ` +
      `1 account on debt_manager is already eligible at the unshocked mark. That is a standing ` +
      `census rather than a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi), so its side is unknown rather than zero.`,
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
    `Nothing new becomes liquidatable anywhere on this grid, not even at ETH down 50%, with ` +
      `no bad debt on debt_manager's book anywhere on this grid. ` +
      `1 account on debt_manager is already eligible at the unshocked mark. That is a standing ` +
      `census rather than a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi), so its side is unknown rather than zero.`,
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
    `Nothing new becomes liquidatable anywhere on this grid, not even at anywhere the grid ` +
      `reaches, and debt_manager's bad debt still reaches $239.603961 at the unshocked mark: ` +
      `a book can be insolvent with nothing new becoming liquidatable. ` +
      `1 account on debt_manager is already eligible at the unshocked mark. That is a standing ` +
      `census rather than a projection. 1 engine's whole book is withheld from this grid ` +
      `(aave_v3_etherfi), so its side is unknown rather than zero.`,
  );
  // COMPUTED, not asserted: the amount is the BASELINE point's own bad debt,
  // not the deeper grid's — a different served point produces a different number.
  expect(labDek(baselineOnly)).not.toContain("2,219.801981");
});

// ===========================================================================
// WAVE R9 (Codex round-17 finding 2) — TERMINAL SOLVENCY IS READ FOR EVERY
// SERVED ENGINE, NEVER FOR THE LEAD ALONE.
//
// THE DEFECT: every bad-debt clause in this file evaluated `leadEngineAtTerminal`
// — the engine holding the most terminal ELIGIBLE DEBT. That is the right
// engine for the Σ (a "who carries the most" question has one answer) and the
// wrong engine for solvency (a "is this book insolvent" question is about every
// engine that was served). A non-lead engine with positive terminal bad debt
// was omitted, so the no-cliff headline read clean over a book insolvent on the
// other engine — and shapes A and B hid it identically.
//
// The grid below is `book.json` with no new eligibility anywhere: shape C over
// TWO served engines, which the committed no-cliff fixture cannot be (it serves
// one engine and withholds the other). Bad debt is left exactly as served.
// ===========================================================================

const NO_CLIFF_TWO_ENGINES = withoutAnyCliff(BASE);

/** Shape C's opening, up to the solvency clause — shared by the four arms. */
const NO_CLIFF_HEAD = "Nothing new becomes liquidatable anywhere on this grid, not even at ETH down 50%";
/** …and its tail. `book.json` withholds nothing, so there is no caveat clause. */
const NO_CLIFF_TAIL =
  " 1 account on debt_manager is already eligible at the unshocked mark. That is a standing census rather than a projection.";

test("R9 NO CLIFF × BAD DEBT ON THE NON-LEAD ENGINE ONLY — it is NAMED, not omitted", () => {
  // DERIVED NEGATIVE: silence the LEAD's bad debt everywhere and leave the
  // non-lead's exactly as served. The lead is now clean over the whole grid,
  // which is precisely the state the old clause reported — it would have said
  // "with no bad debt on aave_v3_etherfi's book anywhere on this grid" over a
  // book whose OTHER served engine reaches $2,219.801981 by −50%.
  const nonLeadOnly = withoutBadDebtOn(NO_CLIFF_TWO_ENGINES, [LEAD]);
  expect(labDek(nonLeadOnly)).toBe(
    `${NO_CLIFF_HEAD}, and ${NON_LEAD}'s bad debt still reaches ${NON_LEAD_BAD} by ${MINUS}50%: ` +
      `a book can be insolvent with nothing new becoming liquidatable.${NO_CLIFF_TAIL}`,
  );
  // AND THE ALL-CLEAR IS GONE. The clean wording is a claim about every served
  // engine now, so one insolvent engine withdraws it for the whole sentence.
  expect(labDek(nonLeadOnly)).not.toContain("no bad debt");
});

test("R9 NO CLIFF × BAD DEBT ON BOTH ENGINES — both NAMED, in their own decimals, NEVER summed", () => {
  expect(labDek(NO_CLIFF_TWO_ENGINES)).toBe(
    `${NO_CLIFF_HEAD}, and ${LEAD}'s bad debt still reaches ${LEAD_BAD} and ${NON_LEAD}'s ` +
      `still reaches ${NON_LEAD_BAD} by ${MINUS}50%: a book can be insolvent with nothing new ` +
      `becoming liquidatable.${NO_CLIFF_TAIL}`,
  );
  // THE LAW, asserted as a number rather than as a shape: the two books are
  // $2,190.47619048 (8 decimals) and $2,219.801981 (6). Their sum is
  // $4,410.278171 and it appears nowhere, at any grouping.
  expect(labDek(NO_CLIFF_TWO_ENGINES)).not.toContain("4,410");
  expect(labDek(NO_CLIFF_TWO_ENGINES)).not.toContain("4410");
});

test("R9 NO CLIFF × BAD DEBT ON THE LEAD ONLY — the wording is UNCHANGED", () => {
  // The arm the finding does not touch. Silencing the non-lead leaves exactly
  // the sentence R8 built, which is the point: the fix widens the scope without
  // rewriting the single-engine reading.
  const leadOnly = withoutBadDebtOn(NO_CLIFF_TWO_ENGINES, [NON_LEAD]);
  expect(labDek(leadOnly)).toBe(
    `${NO_CLIFF_HEAD}, and ${LEAD}'s bad debt still reaches ${LEAD_BAD} by ${MINUS}50%: ` +
      `a book can be insolvent with nothing new becoming liquidatable.${NO_CLIFF_TAIL}`,
  );
  expect(labDek(leadOnly)).not.toContain(NON_LEAD_BAD);
});

test("R9 NO CLIFF × EVERY SERVED ENGINE CLEAN — the all-clean wording SPEAKS FOR BOTH", () => {
  // The clean arm is a CLAIM, so it now names the engines it is a claim about.
  // R8's version named the lead alone while checking the lead alone; over two
  // served engines that sentence was a book-wide all-clear backed by half a
  // book.
  const clean = withoutBadDebt(NO_CLIFF_TWO_ENGINES);
  expect(labDek(clean)).toBe(
    `${NO_CLIFF_HEAD}, with no bad debt on ${LEAD}'s or ${NON_LEAD}'s book anywhere on this ` +
      `grid.${NO_CLIFF_TAIL}`,
  );
  expect(labDek(clean)).not.toContain("$0");
});

test("R9 NO CLIFF × THE CLEAN SCOPE IS EARNED ACROSS ENGINES, not just across points", () => {
  // DERIVED NEGATIVE: both engines are clean AT THE TERMINAL STEP, but the
  // NON-lead carried bad debt earlier on the grid. "anywhere on this grid" is
  // then false, and the step-scoped wording is the only true one left.
  //
  // R8 earned this scope across POINTS for one engine. R9 earns it across
  // ENGINES too — and this is the case that separates them: the LEAD is clean
  // at every point, so the old check passed and the old sentence claimed the
  // whole grid.
  const terminalClean = {
    ...NO_CLIFF_TWO_ENGINES,
    points: NO_CLIFF_TWO_ENGINES.points.map((point, index) => ({
      ...point,
      engines: point.engines.map((engine) => {
        if (engine.engine === LEAD) return { ...engine, cumulative_bad_debt_usd: "0" };
        // debt_manager: clean only at the LAST point.
        return index === NO_CLIFF_TWO_ENGINES.points.length - 1
          ? { ...engine, cumulative_bad_debt_usd: "0" }
          : engine;
      }),
    })),
  };
  expect(labDek(terminalClean)).toBe(
    `${NO_CLIFF_HEAD}, with no bad debt on ${LEAD}'s or ${NON_LEAD}'s book by ${MINUS}50%.` +
      NO_CLIFF_TAIL,
  );
  // The grid-scoped clean clause is the only thing that would END a clause with
  // "on this grid."; the step-scoped one ends at the move. Both spellings of the
  // regression are pinned.
  expect(labDek(terminalClean)).not.toContain("on this grid.");
  expect(labDek(terminalClean)).not.toContain("book anywhere on this grid");
});

test("R9 NO CLIFF × A WITHHELD ENGINE STAYS OUTSIDE THE CLEAN CLAIM", () => {
  // The committed refused fixture: debt_manager served and clean everywhere,
  // aave WITHHELD whole-engine. The clean clause names debt_manager and ONLY
  // debt_manager — a withheld engine is absent from `points[].engines`, so it
  // is never named clean, and the withheld caveat carries its side separately.
  const clean = withoutBadDebt(waterfallOf(BOOK_ENGINE_REFUSED));
  const sentence = labDek(clean);
  expect(sentence).toContain("with no bad debt on debt_manager's book anywhere on this grid");
  expect(sentence).not.toContain("aave_v3_etherfi's book");
  expect(sentence).not.toContain("aave_v3_etherfi's or");
  // Its side is stated as UNKNOWN, in the caveat, in the same sentence.
  expect(sentence).toContain(
    "1 engine's whole book is withheld from this grid (aave_v3_etherfi), so its side is unknown rather than zero",
  );
});

// --- The same rule on the CLIFF shapes (A and B) ---------------------------

test("R9 SHAPE B × BAD DEBT ON THE NON-LEAD ONLY — the Σ stays lead-scoped, solvency does not", () => {
  // The Σ answers "who carries the most eligible debt" and still names one
  // engine. The bad-debt clause answers a different question and now names
  // every served engine that is insolvent — here, only the non-lead.
  const nonLeadOnly = withoutBadDebtOn(BASE, [LEAD]);
  expect(labDek(nonLeadOnly)).toBe(
    `The first step already bites: ETH down 10% makes 1 account on ${LEAD} newly liquidatable. ` +
      `By ${MINUS}50%, ${LEAD}'s Σ eligible debt reaches $6,000 with no bad debt on its book at ` +
      `that step, and ${NON_LEAD}'s bad debt reaches ${NON_LEAD_BAD} at that same step.`,
  );
  // "its book" is possessive and the possessor is NAMED two clauses earlier, so
  // the clean half cannot be read as a statement about the book as a whole.
  expect(labDek(nonLeadOnly)).toContain(`${LEAD}'s Σ eligible debt`);
});

test("R9 SHAPE A × BAD DEBT ON BOTH — both named after the cliff clause, never summed", () => {
  const laterCliff = withNewly(BASE, { 1: { aave_v3_etherfi: 0 }, 2: { aave_v3_etherfi: 1 } });
  const sentence = labDek(laterCliff);
  expect(sentence).toContain(`and its bad debt ${LEAD_BAD}, and ${NON_LEAD}'s bad debt reaches ${NON_LEAD_BAD} at that same step.`);
  expect(sentence).not.toContain("4,410");
});

test("R9 SHAPE B × EVERY SERVED ENGINE CLEAN — the lead-scoped wording is UNCHANGED", () => {
  // The all-clean arm on a cliff shape is emitted only when every served engine
  // is clean at that step — which is exactly what makes the unchanged wording
  // safe to keep. Silence one engine and the "— and …" clause returns.
  const clean = withoutBadDebt(BASE);
  expect(labDek(clean)).toBe(
    `The first step already bites: ETH down 10% makes 1 account on ${LEAD} newly liquidatable. ` +
      `By ${MINUS}50%, ${LEAD}'s Σ eligible debt reaches $6,000 with no bad debt on its book at ` +
      `that step.`,
  );
  expect(labDek(clean)).not.toContain(`, and ${NON_LEAD}'s`);
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
  expect(sentence).toContain("rather than smoothed");
});

test("no waterfall and no grid are ABSENCES, each named, neither a flat frontier", () => {
  expect(labDek(null)).toBe(LAB_DEK_NO_WATERFALL);
  expect(labDek({ ...BASE, points: [] })).toBe(LAB_DEK_NO_GRID);
  expect(LAB_DEK_NO_WATERFALL).toContain(
    "That absence is about the waterfall, and it says nothing about what sits on the book.",
  );
});

test("the loading dek states what the surface IS — it invents no number", () => {
  expect(LAB_DEK_LOADING).not.toMatch(/[0-9]/);
  expect(LAB_DEK_LOADING).toContain("which engines each scenario is even defined for");
});
