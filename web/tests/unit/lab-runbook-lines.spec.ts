// The run-book detail's COMPUTED reading lines (Wave W-BS-A at contract 1.6.0,
// CHANGED at contract 1.7.0 by Wave W-TM).
//
// Laws under test:
//   - every sentence is DERIVED from the served response: mutate the input and
//     the words change. No count and no money amount is hardcoded in
//     `labRunBookLines.ts`;
//   - THE CROSSINGS ARE SERVED AND ARE DERIVED FROM THE MATRIX'S CELLS. The
//     1.6.0 sentence carried an IMPOSSIBILITY CAVEAT — "this response serves
//     the two populations, not the crossings between them" — whose central
//     claim was true then and is false now. `hf_transitions` is the joint
//     distribution, and a stale impossibility caveat printed beside a served
//     gross count is the very defect that caveat existed to prevent. The law
//     below is therefore RETIRED and replaced, not reworded;
//   - the NET is kept beside the gross, never replaced by it: on an offsetting
//     book they are different numbers, and that difference is the whole reason
//     this surface exists;
//   - `lane_changed_rows` is never described as a 1.00-crossing count, because
//     it counts every LANE change including moves that never touch that edge;
//   - the top-20-of-N disclosure NAMES both numbers whenever they differ, and
//     never claims a truncation that did not happen — a cap the reader cannot
//     see is a silent cap;
//   - an unpriced holding is described as UNKNOWABLE, never summed into a
//     dollar figure and never described as zero;
//   - the Debt Manager's sub-1.00 region is called a DISCLOSURE, because its
//     buckets are the exact rational and its trigger is the strict boolean —
//     serving the joint changes nothing about that;
//   - unmeasured rows are named in the same breath as the shift, and the
//     sentence now says WHERE they sit (the matrix's last lane) instead of
//     claiming they sit nowhere;
//   - a side that measured NOBODY says so rather than reporting a zero shift.
//
// Fixture mutations below are DERIVED NEGATIVES, each documented at its site.

import { expect, test } from "@playwright/test";
import type {
  LabRunBookEngine,
  RunBookAggregate,
  RunBookTransitions,
} from "../../lib/runbook";
import {
  belowOneCount,
  collateralDisclosure,
  collateralReadingLine,
  collateralRowKey,
  histogramShiftReadingLine,
  measuredCount,
  moversDisclosure,
} from "../../app/lab/labRunBookLines";
import { readTransitions } from "../../app/lab/labTransition";
import { RUN_BOOK_ETH, RUN_BOOK_WEETH_BATCH_1 } from "../fixtures/lab-book";

const WAD = "1000000000000000000";

function engineOf(
  response: { engines: readonly unknown[] },
  name: string,
): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find(
    (engine) => engine.engine === name,
  );
  if (found === undefined) {
    throw new Error(`fixture carries no ${name} engine`);
  }
  return found;
}

/** A histogram with `counts` placed at the labels named, everything else 0. */
function histogramWith(
  template: RunBookAggregate,
  comparator: "hf_wad" | "hf_num/hf_den",
  counts: Record<string, number>,
  extra: { infinite?: number; refused?: number } = {},
): RunBookAggregate["hf_histogram"] {
  return {
    ...template.hf_histogram,
    comparator,
    wad_scale: WAD,
    infinite_count: extra.infinite ?? 0,
    refused_count: extra.refused ?? 0,
    buckets: template.hf_histogram.buckets.map((bucket) => ({
      ...bucket,
      count: counts[bucket.label] ?? 0,
    })),
  };
}

/**
 * ONE OCCUPIED CELL of a test's own matrix: `[from lane, to lane, rows]`.
 */
type Cell = [number, number, number];

/**
 * A matrix built on the fixture's own TEMPLATE with this test's own cells —
 * exactly as `histogramWith` builds a histogram.
 *
 * The two MARGINS are DERIVED FROM THE CELLS rather than stated beside them, so
 * a test can never write a matrix that contradicts itself; `engineWith` then
 * builds the two histograms FROM those margins, so the matrix and the bars are
 * one statement read twice. That is the same weld the server makes, and it is
 * what makes `readTransitions` accept these bodies for the right reason.
 */
function transitionsWith(
  template: RunBookTransitions,
  cells: readonly Cell[],
  unmeasured = 0,
): RunBookTransitions {
  const laneCount = template.lanes.length;
  const unmeasuredLane = laneCount - 1;
  const all: Cell[] = unmeasured === 0 ? [...cells] : [...cells, [unmeasuredLane, unmeasuredLane, unmeasured]];

  const fromRows = new Array<number>(laneCount).fill(0);
  const toRows = new Array<number>(laneCount).fill(0);
  let held = 0;
  let changed = 0;
  let measured = 0;
  for (const [from, to, rows] of all) {
    fromRows[from] = (fromRows[from] ?? 0) + rows;
    toRows[to] = (toRows[to] ?? 0) + rows;
    if (from === unmeasuredLane) continue;
    measured += rows;
    if (from === to) held += rows;
    else changed += rows;
  }
  return {
    ...template,
    from_rows: fromRows,
    to_rows: toRows,
    outflows: Array.from({ length: laneCount }, (_, from) => ({
      from,
      cells: all
        .filter(([cellFrom]) => cellFrom === from)
        .sort((a, b) => a[1] - b[1])
        .map(([, to, rows]) => ({
          to,
          rows,
          // A measured cell's debt is KNOWABLE; the unmeasured cell's is not,
          // and the two representations are never interchanged.
          debt_before_usd: from === unmeasuredLane ? null : "0",
          debt_after_usd: from === unmeasuredLane ? null : "0",
        })),
    })),
    total_rows: measured + unmeasured,
    measured_rows: measured,
    unmeasured_rows: unmeasured,
    unmeasured_refused_in_batch_rows: unmeasured,
    unmeasured_excluded_by_this_layer_rows: 0,
    held_rows: measured === 0 ? null : held,
    lane_changed_rows: measured === 0 ? null : changed,
  };
}

/** A histogram whose three tallies ARE one margin of the matrix beside it. */
function histogramFromMargin(
  template: RunBookAggregate,
  comparator: "hf_wad" | "hf_num/hf_den",
  margin: readonly number[],
): RunBookAggregate["hf_histogram"] {
  const buckets = template.hf_histogram.buckets.length;
  return {
    ...template.hf_histogram,
    comparator,
    wad_scale: WAD,
    buckets: template.hf_histogram.buckets.map((bucket, index) => ({
      ...bucket,
      count: margin[index] ?? 0,
    })),
    infinite_count: margin[buckets] ?? 0,
    refused_count: margin[buckets + 1] ?? 0,
  };
}

/**
 * A whole engine stated as its JOINT, with the two marginals derived from it.
 *
 * Stating the joint is the point: the 1.6.0 tests stated two marginals because
 * that was all the wire carried, and every offsetting book was invisible to
 * them by construction.
 */
function engineWith(
  comparator: "hf_wad" | "hf_num/hf_den",
  cells: readonly Cell[],
  unmeasured = 0,
): LabRunBookEngine {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const t = transitionsWith(dm.hf_transitions, cells, unmeasured);
  return {
    ...dm,
    hf_transitions: { ...t, comparator },
    before: {
      ...dm.before,
      accounts: t.measured_rows,
      hf_histogram: histogramFromMargin(dm.before, comparator, t.from_rows),
    },
    after: {
      ...dm.after,
      accounts: t.measured_rows,
      hf_histogram: histogramFromMargin(dm.after, comparator, t.to_rows),
    },
  };
}

// ---------------------------------------------------------------------------
// The eligible-region derivation
// ---------------------------------------------------------------------------

test("belowOneCount counts only buckets whose WHOLE range sits at or below 1.00", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const aggregate: RunBookAggregate = {
    ...dm.before,
    hf_histogram: histogramWith(dm.before, "hf_wad", {
      "< 0.90": 3,
      "0.90 – 1.00": 2,
      // The [1.00, 1.05) bucket STRADDLES nothing — it starts AT 1.00, which is
      // healthy on both engines. Counting it would move the eligible edge.
      "1.00 – 1.05": 7,
      ">= 2.00": 5,
    }),
  };
  expect(belowOneCount(aggregate)).toBe(5);
  expect(measuredCount(aggregate)).toBe(17);
});

test("measuredCount adds the no-debt accounts and NOT the refused ones", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const aggregate: RunBookAggregate = {
    ...dm.before,
    hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 2 }, { infinite: 3, refused: 9 }),
  };
  // Infinite accounts WERE measured — their health factor is unbounded, not
  // absent. Refused rows were not measured at all, so folding them into the
  // denominator would describe a book the distribution does not cover.
  expect(measuredCount(aggregate)).toBe(5);
});

// ---------------------------------------------------------------------------
// The histogram-shift reading line
// ---------------------------------------------------------------------------

test("the shift line names the NET population change, computed from both sides", () => {
  // Three rows fall into the region from band 4 and nothing leaves it.
  const engine = engineWith("hf_wad", [
    [0, 0, 1],
    [4, 0, 3],
    [4, 4, 6],
  ]);
  const line = histogramShiftReadingLine(engine);
  // The arithmetic is on the page, derived from both sides.
  expect(line).toContain("1 of 10 measured rows sat below 1.00 before the shock, 4 after");
  expect(line).toContain("the below-1.00 population grew by 3");
  // Nothing was unmeasured, so no refusal clause is invented.
  expect(line).not.toContain("counted refused");
});

test("THE CROSSINGS ARE SERVED, and they are DERIVED FROM THE CELLS", () => {
  // THIS TEST REPLACES "THE NET CAVEAT" (contract 1.6.0), and the replacement
  // is not a rewording. That law required the sentence to state that a gross
  // crossing count was UNAVAILABLE — "this response serves the two populations,
  // not the crossings between them" — and required it to withhold the very
  // vocabulary `hf_transitions` now licenses. Every one of its five assertions
  // was a claim about what the response CANNOT carry, and the response carries
  // it. So the negatives INVERT: the sentence must no longer say the count is
  // unavailable.
  //
  // The book is §5.3's committed mixed-direction shape, stated as its JOINT:
  // two rows fall through 1.00, one rises past it, so the below-1.00 marginal
  // moves by ONE while THREE rows change lane. Two marginals cannot tell that
  // book from a book where one row fell and nothing else moved.
  const engine = engineWith("hf_wad", [
    [4, 0, 1], // A: 1.20 -> 0.84
    [3, 0, 1], // B: 1.08 -> 0.756
    [0, 3, 1], // C: 0.74375 -> 1.0625
  ]);
  const t = engine.hf_transitions;

  // FOUR DISTINCT NUMBERS ABOUT THE SAME THREE ROWS. Each is asserted
  // INDEPENDENTLY, and the third is NOT computed from the first two:
  // `entries + exits === lane_changed_rows` holds on this book only because no
  // measured row here changes lane without crossing the boundary, which is a
  // coincidence of the fixture and not a law.
  const region = (margin: readonly number[]) => (margin[0] ?? 0) + (margin[1] ?? 0);
  expect(region(t.to_rows) - region(t.from_rows)).toBe(1);
  expect(t.lane_changed_rows).toBe(3);
  expect(t.held_rows).toBe(0);

  const line = histogramShiftReadingLine(engine);
  // (1) THE NET, still stated.
  expect(line).toContain("the below-1.00 population grew by 1");
  // (2) THE GROSS, now stated beside it: 2 in, 1 out.
  expect(line).toContain("The crossings behind that figure are served");
  expect(line).toContain("2 rows moved INTO the region");
  expect(line).toContain("1 row moved OUT of it");
  expect(line).toContain("the net is what is left after they cancel");
  // (3) THE RETIRED CLAIMS. Every one of these was REQUIRED by the 1.6.0 law
  // and is now false.
  expect(line).not.toContain("no gross crossing count is claimed here");
  expect(line).not.toContain("serves the two populations, not the crossings between them");
  expect(line).not.toContain("That is a NET figure");
  // (4) AND `lane_changed_rows` IS NOT PRINTED AS THE CROSSING COUNT. It is 3
  // on this book while the crossings are 2 and 1; a sentence that printed it
  // where the crossing pair belongs would say "3 rows moved INTO".
  expect(line).not.toContain("3 rows moved INTO");
  expect(line).not.toContain("3 rows moved OUT");
});

test("an unchanged population is now a STATABLE fact: one entry and one exit", () => {
  // THE CASE THAT GAINS THE MOST. Under 1.6.0 this was the shape the caveat
  // existed to warn about: two rows swap sides and the difference is zero, and
  // nothing on the wire could reveal either move. The joint reveals both.
  const engine = engineWith("hf_wad", [
    [0, 5, 1], // one row leaves the region
    [5, 0, 1], // one row enters it
    [0, 0, 1],
    [5, 5, 7],
  ]);
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("the below-1.00 population did not change");
  // AND THE TWO OFFSETTING MOVES ARE NAMED, which is exactly what the caveat
  // used to say was impossible.
  expect(line).toContain("1 row moved INTO the region");
  expect(line).toContain("1 row moved OUT of it");
  expect(engine.hf_transitions.lane_changed_rows).toBe(2);
  expect(line).not.toContain("no gross crossing count is claimed here");
  expect(line).not.toContain("Nothing crossed");
});

test("a shift the other way is named SHRANK, never a negative count", () => {
  const engine = engineWith("hf_wad", [
    [0, 7, 4],
    [0, 0, 2],
    [7, 7, 4],
  ]);
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("the below-1.00 population shrank by 4");
  expect(line).toContain("6 of 10 measured rows sat below 1.00 before the shock, 2 after");
  expect(line).toContain("4 rows moved OUT of it");
  expect(line).toContain("0 rows moved INTO the region");
  expect(line).not.toContain("-4");
  expect(line).not.toContain("−4");
});

test("the Debt Manager's region is called a DISCLOSURE, never its trigger", () => {
  // UNCHANGED at 1.7.0, deliberately. Serving the joint is a statement about
  // FLOW; it says nothing about what the comparator means, so the Debt
  // Manager's clause is exactly the sentence it was.
  const engine = engineWith("hf_num/hf_den", [
    [0, 0, 1],
    [4, 0, 1],
  ]);
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("Below 1.00 is the borrow-headroom ratio");
  expect(line).toContain("a DISCLOSURE rather than this engine's trigger");
  // And the Aave sentence must NOT claim a disclosure — the comparator IS the
  // engine's own liquidation test there.
  const wadLine = histogramShiftReadingLine(
    engineWith("hf_wad", [
      [0, 0, 1],
      [4, 0, 1],
    ]),
  );
  expect(wadLine).toContain("Below 1.00 is where this engine may liquidate");
  expect(wadLine).not.toContain("DISCLOSURE");
});

test("UNMEASURED ROWS ARE NAMED in the same breath, and the sentence says WHERE they sit", () => {
  // CHANGED at 1.7.0. The naming obligation is unchanged and still load-bearing:
  // a shift measured over a book with rows missing from it is a shift over a
  // different book. What changed is the second half of the old clause. It read
  // "and sit in neither distribution", which is now FALSE: those rows sit in
  // the matrix's last lane, which IS a position in the joint distribution, with
  // both margins carrying them and the cause split beside them.
  const engine = engineWith("hf_wad", [[0, 0, 1]], 2);
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("2 more rows are counted refused");
  expect(line).toContain(`they sit in the matrix's "not measured" lane`);
  expect(line).toContain("inside both margins and outside every measured count above");
  // THE RETIRED HALF. The rows have somewhere to be now.
  expect(line).not.toContain("sit in neither distribution");
  // And they really are in both margins, which is what licenses the sentence.
  expect(engine.hf_transitions.from_rows[9]).toBe(2);
  expect(engine.hf_transitions.to_rows[9]).toBe(2);

  // The singular is a real sentence, not "1 rows".
  const one = histogramShiftReadingLine(engineWith("hf_wad", [[0, 0, 1]], 1));
  expect(one).toContain("1 more row is counted refused");
  expect(one).toContain(`it sits in the matrix's "not measured" lane`);
});

test("a side that measured NOBODY says so rather than reporting a zero shift", () => {
  const engine = engineWith("hf_wad", [], 4);
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("measured no account on this engine, so there is no shift to read");
  // The zero that would have been a lie is absent — on the sentence AND on the
  // wire, where both movement counts are NULL rather than 0.
  expect(line).not.toContain("0 of 0");
  expect(line).not.toContain("moved INTO the region");
  expect(engine.hf_transitions.held_rows).toBeNull();
  expect(engine.hf_transitions.lane_changed_rows).toBeNull();
  // And the four rows nobody could measure are STILL named.
  expect(line).toContain("4 more rows are counted refused");
});

test("A MATRIX THIS BODY CONTRADICTS IS NOT READ, and the sentence says the crossings are withheld", () => {
  // The body can arrive from an older or a broken deployment. Rendering a
  // crossing count derived from a matrix whose margins do not match the bars
  // printed beside it is a wrong answer that looks computed, so the sentence
  // falls back to the NET — which is still a difference of two bars on the page
  // — and states that the gross was withheld.
  const honest = engineWith("hf_wad", [
    [4, 0, 1],
    [3, 0, 1],
    [0, 3, 1],
  ]);
  const broken: LabRunBookEngine = {
    ...honest,
    after: {
      ...honest.after,
      hf_histogram: {
        ...honest.after.hf_histogram,
        buckets: honest.after.hf_histogram.buckets.map((bucket, index) =>
          index === 0 ? { ...bucket, count: bucket.count + 5 } : bucket,
        ),
      },
    },
  };
  const line = histogramShiftReadingLine(broken);
  expect(line).toContain("The gross crossings are NOT stated here");
  expect(line).toContain("disagrees with the two distributions beside it");
  expect(line).not.toContain("moved INTO the region");
  // The honest body still gets its crossings, so this is not a law that
  // refuses everything.
  expect(histogramShiftReadingLine(honest)).toContain("2 rows moved INTO the region");
});

/**
 * A refused body whose two histograms are two DIFFERENT censuses.
 *
 * The honest base measures 3 rows on both sides with one of them below 1.00.
 * The after histogram is then replaced wholesale with an 8-row census carrying
 * 7 rows below 1.00, which is what an older or broken deployment can serve:
 * the matrix's after margin no longer matches the bars printed beside it, so
 * the matrix is refused, and the two sides no longer share a denominator.
 */
function divergentCensusEngine(): LabRunBookEngine {
  const honest = engineWith("hf_wad", [
    [0, 0, 1], // one row below 1.00, and it stays there
    [4, 0, 1], // one row falls into the region
    [5, 5, 1],
  ]);
  return {
    ...honest,
    after: {
      ...honest.after,
      hf_histogram: histogramWith(
        honest.after,
        "hf_wad",
        { "< 0.90": 4, "0.90 – 1.00": 3, "1.00 – 1.05": 1 },
        { refused: 2 },
      ),
    },
  };
}

test("A REFUSED MATRIX IS TWO CENSUSES: each side is stated against ITS OWN denominator", () => {
  // THE FALSE ARITHMETIC THIS TEST EXISTS FOR. The fallback used to take the
  // AFTER side's measured total and print it as the denominator of BOTH halves,
  // then subtract the two below-1.00 populations across the two different
  // censuses. On this body that produced "1 of 8 measured rows sat below 1.00
  // before the shock, 7 after: the below-1.00 population grew by 6" over a
  // before histogram that measured 3 rows in total. Every number in that
  // sentence was served; the sentence was still false, because the denominator
  // belonged to the other side and the difference spanned two books.
  //
  // The old test asserted only that the GROSS was withheld, so it passed
  // throughout. The assertions below pin the arithmetic itself.
  const broken = divergentCensusEngine();

  // The premise, asserted rather than assumed: this really is the refusal path,
  // and the two sides really do measure different totals.
  expect(readTransitions(broken).kind).toBe("contradictory");
  expect(measuredCount(broken.before)).toBe(3);
  expect(measuredCount(broken.after)).toBe(8);
  expect(belowOneCount(broken.before)).toBe(1);
  expect(belowOneCount(broken.after)).toBe(7);

  const line = histogramShiftReadingLine(broken);
  // (1) BOTH DENOMINATORS ARE ON THE PAGE, each against its own population.
  expect(line).toContain("1 of 3 measured rows sat below 1.00 before the shock");
  expect(line).toContain("7 of 8 measured rows sat below 1.00 after it");
  // (2) THE FALSE DENOMINATOR IS GONE. The before side never measured 8 rows.
  expect(line).not.toContain("1 of 8");
  // (3) NO CROSS-CENSUS SUBTRACTION, in either direction and at any size.
  expect(line).not.toContain("grew by");
  expect(line).not.toContain("shrank by");
  expect(line).not.toContain("grew by 6");
  expect(line).not.toContain("the below-1.00 population did not change");
  // (4) AND THE MISSING FACT IS NAMED rather than filled with arithmetic.
  expect(line).toContain("The two histograms measure different row totals");
  expect(line).toContain("no net movement is computed here");
  expect(line).toContain("a difference taken across two censuses is not a population change");
  // (5) The gross is still withheld, which is the law this path already had.
  expect(line).toContain("The gross crossings are NOT stated here");
  expect(line).not.toContain("moved INTO the region");
});

test("A REFUSED MATRIX IS NOT CITED FOR WHERE THE REFUSED ROWS SIT", () => {
  // The tail clause used to send the reader to the matrix's final lane in the
  // same sentence that declares the matrix unusable. The COUNT survives, since
  // the histogram beside it carries that on its own; the LOCATION does not,
  // because only the refused matrix could have given it.
  const broken = divergentCensusEngine();
  const line = histogramShiftReadingLine(broken);
  expect(line).toContain("2 more rows are counted refused");
  expect(line).toContain("outside every measured count above");
  expect(line).toContain("Where they sit in the matrix is NOT claimed here");
  expect(line).toContain("the matrix this response served is the one being refused");
  // THE RETIRED CLAIM.
  expect(line).not.toContain(`the matrix's "not measured" lane`);
  expect(line).not.toContain("inside both margins");

  // The singular is a real sentence here too, not "1 rows".
  const honest = engineWith("hf_wad", [[0, 0, 1]]);
  const one = histogramShiftReadingLine({
    ...honest,
    after: {
      ...honest.after,
      hf_histogram: histogramWith(honest.after, "hf_wad", { "< 0.90": 4 }, { refused: 1 }),
    },
  });
  expect(one).toContain("1 more row is counted refused");
  expect(one).toContain("Where it sits in the matrix is NOT claimed here");
  expect(one).not.toContain(`the matrix's "not measured" lane`);

  // AND AN OK MATRIX STILL POINTS AT ITS LANE, so this is not a law that
  // withholds the location everywhere.
  expect(histogramShiftReadingLine(engineWith("hf_wad", [[0, 0, 1]], 2))).toContain(
    `they sit in the matrix's "not measured" lane`,
  );
});

test("AGREEING TOTALS on a refused matrix keep the net, with the denominator stated once", () => {
  // The refusal is about the MATRIX, not about the two bars. When both
  // histograms measure the same book, their difference is still a population
  // change and withholding it would be its own kind of dishonesty. The
  // after side here is re-shaped, not re-sized: 3 measured rows either way, so
  // the matrix's after margin contradicts the bars while the census holds.
  const honest = engineWith("hf_wad", [
    [0, 0, 1],
    [4, 0, 1],
    [5, 5, 1],
  ]);
  const broken: LabRunBookEngine = {
    ...honest,
    after: {
      ...honest.after,
      hf_histogram: histogramWith(honest.after, "hf_wad", { "< 0.90": 3 }),
    },
  };
  expect(readTransitions(broken).kind).toBe("contradictory");
  expect(measuredCount(broken.before)).toBe(3);
  expect(measuredCount(broken.after)).toBe(3);

  const line = histogramShiftReadingLine(broken);
  expect(line).toContain("1 of 3 measured rows sat below 1.00 before the shock, 3 after");
  expect(line).toContain("the below-1.00 population grew by 2");
  // THE SHARED DENOMINATOR IS STATED ONCE, not repeated onto each half: one
  // census, one "measured rows" clause.
  expect(line.split("measured rows").length - 1).toBe(1);
  // And the different-totals refusal must NOT fire on a book that has one book.
  expect(line).not.toContain("different row totals");
  expect(line).not.toContain("two censuses");
  // The gross is still withheld: agreeing totals do not un-refuse the matrix.
  expect(line).toContain("The gross crossings are NOT stated here");
  expect(line).not.toContain("moved INTO the region");
});

// ---------------------------------------------------------------------------
// The movers disclosure — THE ANTI-SILENT-CAP LAW
// ---------------------------------------------------------------------------

function moversEngine(shown: number, total: number): LabRunBookEngine {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const template = dm.movers[0];
  if (template === undefined) {
    throw new Error("the eth_minus_30 fixture must carry a mover to clone");
  }
  return {
    ...dm,
    movers: Array.from({ length: shown }, (_, index) => ({
      ...template,
      account: `0x${String(index).padStart(40, "0")}`,
    })),
    movers_total: total,
  };
}

/** The same engine re-comparatored to Aave — the wad ranking, not the flip. */
function asWadEngine(engine: LabRunBookEngine): LabRunBookEngine {
  return {
    ...engine,
    before: {
      ...engine.before,
      hf_histogram: { ...engine.before.hf_histogram, comparator: "hf_wad" },
    },
    after: { ...engine.after, hf_histogram: { ...engine.after.hf_histogram, comparator: "hf_wad" } },
  };
}

test("TOP 20 OF N: the disclosure names both numbers and how many are missing", () => {
  expect(moversDisclosure(moversEngine(20, 31))).toBe(
    "Showing the top 20 of 31 accounts whose debt became eligible, ranked by that debt; " +
      "11 are not on this page.",
  );
});

test("THE SUBJECT IS THE ENGINE'S OWN ONE-DIRECTION LIST, never 'accounts that moved'", () => {
  // `movers` is not symmetric and the server's own note says so: Aave admits
  // only STRICT DROPS and the Debt Manager only flips false -> true. A sentence
  // calling either list "all accounts that moved" claims the other direction
  // is in it, and the histogram line beside it has just disclosed that
  // crossings the other way exist and are not served.
  const dmLines = [
    moversDisclosure(moversEngine(0, 0)),
    moversDisclosure(moversEngine(3, 3)),
    moversDisclosure(moversEngine(20, 31)),
  ];
  for (const line of dmLines) {
    expect(line).toContain("became eligible");
    expect(line).not.toContain("that moved");
    expect(line).not.toContain("health factor");
  }
  expect(dmLines[1]).toContain("ranked by that debt");

  const aaveLines = [
    moversDisclosure(asWadEngine(moversEngine(0, 0))),
    moversDisclosure(asWadEngine(moversEngine(3, 3))),
    moversDisclosure(asWadEngine(moversEngine(20, 31))),
  ];
  for (const line of aaveLines) {
    expect(line).toContain("health factor");
    expect(line).not.toContain("that moved");
    expect(line).not.toContain("eligible");
  }
  expect(aaveLines[1]).toContain("whose health factor strictly dropped");
  expect(aaveLines[1]).toContain("ranked by the drop");
});

test("an untruncated list never claims a truncation that did not happen", () => {
  expect(moversDisclosure(moversEngine(3, 3))).toBe(
    "Showing all 3 accounts whose debt became eligible, ranked by that debt.",
  );
  expect(moversDisclosure(moversEngine(1, 1))).toBe(
    "Showing all 1 account whose debt became eligible, ranked by that debt.",
  );
  for (const line of [moversDisclosure(moversEngine(3, 3)), moversDisclosure(moversEngine(1, 1))]) {
    expect(line).not.toContain("top");
    expect(line).not.toContain("not on this page");
  }
});

test("zero movers is stated as zero MOVEMENT in the engine's own terms", () => {
  expect(moversDisclosure(moversEngine(0, 0))).toBe(
    "No account's debt became eligible under this scenario on this engine.",
  );
  expect(moversDisclosure(asWadEngine(moversEngine(0, 0)))).toBe(
    "No account's health factor dropped under this scenario on this engine.",
  );
});

test("the disclosure derives the missing count rather than trusting either number", () => {
  // A server that capped at 20 but reported a total of 100 must produce "80
  // are not on this page" — the sentence is arithmetic over the two, not a
  // restatement of a constant.
  expect(moversDisclosure(moversEngine(20, 100))).toContain("80 are not on this page");
  expect(moversDisclosure(moversEngine(5, 9))).toContain("top 5 of 9");
  expect(moversDisclosure(moversEngine(5, 9))).toContain("4 are not on this page");
});

// ---------------------------------------------------------------------------
// The collateral reading line — THE UNPRICED REGISTER
// ---------------------------------------------------------------------------

function collateralOf(
  entries: RunBookAggregate["collateral_by_asset"],
  total: string,
): RunBookAggregate {
  const aave = engineOf(RUN_BOOK_WEETH_BATCH_1, "aave_v3_etherfi");
  return { ...aave.before, total_collateral_usd: total, collateral_by_asset: entries };
}

const COUNTED = {
  asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
  symbol: "weETH",
  decimals: 18,
  amount: "2000000000000000000",
  value_usd: "800000000000",
  unpriced: false,
  note: "COUNTED",
} as const;

const UNPRICED = {
  asset: "0x0000000000000000000000000000000000000BAD",
  decimals: 18,
  amount: "5000000000000000000",
  value_usd: null,
  unpriced: true,
  note: "UNPRICED",
} as const;

test("an all-priced side states the sum, the engine and its decimals — and adds nothing", () => {
  const line = collateralReadingLine(collateralOf([COUNTED], "800000000000"), 8, "before");
  expect(line).toContain("1 asset sums to $8,000");
  expect(line).toContain("this engine's own USD at 8 decimals, never added to another engine's");
  // No remainder exists, so no remainder sentence is invented.
  expect(line).not.toContain("listed with NO value");
  expect(line).not.toContain("UNKNOWABLE");
});

test("AN UNPRICED HOLDING IS UNKNOWABLE, never zero and never summed", () => {
  const line = collateralReadingLine(
    collateralOf([COUNTED, UNPRICED], "800000000000"),
    8,
    "after",
  );
  expect(line).toContain("1 asset sums to $8,000");
  expect(line).toContain("1 further holding is listed with NO value, and it is outside that total");
  expect(line).toContain("carries no price at all, so its worth is UNKNOWABLE rather than zero");
  // THE LAW: the unpriced balance never becomes a dollar figure. $0 must not
  // appear anywhere in the sentence.
  expect(line).not.toContain("$0");
});

test("a NOT-COUNTED holding is disclosed WITHOUT being called unpriced", () => {
  // Priced, but the engine counts none of it (Aave usedAsCollateral = false).
  // It is still outside the total — but its worth is knowable, so the
  // UNKNOWABLE clause must NOT fire.
  const notCounted = { ...UNPRICED, unpriced: false, note: "NOT COUNTED AS COLLATERAL" };
  const line = collateralReadingLine(
    collateralOf([COUNTED, notCounted], "800000000000"),
    8,
    "before",
  );
  expect(line).toContain("1 further holding is listed with NO value");
  expect(line).not.toContain("UNKNOWABLE");
  expect(line).not.toContain("$0");
});

test("the side is named, so a before line can never be read as an after line", () => {
  const aggregate = collateralOf([COUNTED], "800000000000");
  expect(collateralReadingLine(aggregate, 8, "before")).toContain("collateral before the shock");
  expect(collateralReadingLine(aggregate, 8, "after")).toContain("collateral after the shock");
});

test("the totals are the ENGINE's own decimals — the same bytes read at 6 differ", () => {
  const aggregate = collateralOf([{ ...COUNTED, value_usd: "4000000000" }], "4000000000");
  expect(collateralReadingLine(aggregate, 6, "before")).toContain("$4,000");
  expect(collateralReadingLine(aggregate, 6, "before")).toContain("at 6 decimals");
  // Read at 8 the SAME bytes are a different number, which is exactly why the
  // decimals ride the sentence.
  expect(collateralReadingLine(aggregate, 8, "before")).toContain("$40");
});

// ---------------------------------------------------------------------------
// THE COLLATERAL ROW KEY — an identity claim, not a convenience
// ---------------------------------------------------------------------------

const NOT_COUNTED = {
  ...COUNTED,
  value_usd: null,
  unpriced: false,
  note: "NOT COUNTED AS COLLATERAL",
} as const;

test("the three disclosures are recovered from the two fields that carry them", () => {
  expect(collateralDisclosure(COUNTED)).toBe("counted");
  expect(collateralDisclosure(UNPRICED)).toBe("unpriced");
  expect(collateralDisclosure(NOT_COUNTED)).toBe("not-counted");
  // A value present outranks the flag: `unpriced` is only meaningful once the
  // engine counted nothing, and a priced-and-counted row is COUNTED whatever
  // else the flag says.
  expect(collateralDisclosure({ ...COUNTED, unpriced: true })).toBe("counted");
});

test("ONE ASSET, THREE DISCLOSURES, THREE DISTINCT KEYS — the collision the live book serves", () => {
  // The server itemizes by asset AND disclosure, so weETH legitimately appears
  // COUNTED and NOT COUNTED on one side: counted for the accounts that enabled
  // it as collateral, not counted for the accounts that did not. Both carry
  // `unpriced: false`, so the old `asset + unpriced` key gave them ONE key —
  // two rows claiming one identity, which React resolves across a rerun by
  // guessing.
  const keys = [COUNTED, UNPRICED, NOT_COUNTED].map((entry) =>
    collateralRowKey({ ...entry, asset: COUNTED.asset }),
  );
  expect(new Set(keys).size).toBe(3);
  // And the pair the OLD key collapsed is the one this test exists for.
  expect(collateralRowKey({ ...COUNTED, asset: COUNTED.asset })).not.toBe(
    collateralRowKey({ ...NOT_COUNTED, asset: COUNTED.asset }),
  );
  // The asset is still half the identity: the same disclosure on two assets
  // must not share a key either.
  expect(collateralRowKey(COUNTED)).not.toBe(
    collateralRowKey({ ...COUNTED, asset: UNPRICED.asset }),
  );
});
