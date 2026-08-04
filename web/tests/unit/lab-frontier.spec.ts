// W-SD-A — the loss frontier's view model and reading lines, pinned.
//
// Laws under test:
//   - the grid is read in READER WORDS ("unshocked", "−20%"), computed from
//     the served WAD factors by exact bigint arithmetic — no float ever holds
//     a value;
//   - engine scope survives the fold: one series per engine, each carrying its
//     OWN usd_decimals, and an engine missing from a point contributes a HOLE
//     rather than an interpolated zero;
//   - the cliff is defined once, in one place, and the baseline census is
//     never mistaken for it;
//   - the wire's `at_risk_note` and `eligibility_note` render VERBATIM —
//     paraphrasing a caveat is how a caveat stops working.

import { expect, test } from "@playwright/test";
import type { Waterfall } from "@solvent/client";
import { BOOK, BOOK_ENGINE_REFUSED } from "../fixtures/book";
import {
  axisWords,
  frontierSeries,
  frontierView,
  labUsd,
  leadEngineAtTerminal,
  moveLabel,
  moveProse,
  type FrontierSeries,
} from "../../app/lab/frontierView";
import {
  atRiskNoteVerbatim,
  cliffClause,
  eligibilityNoteVerbatim,
  frontierAxisTitles,
  frontierCliffLabel,
  frontierLedgerMaxChars,
  frontierLedgerRows,
  frontierMethodLine,
  frontierReadingLine,
  frontierSeparatorLine,
  frontierSeriesReadingLine,
  FRONTIER_ANSWER_SUPPLEMENT,
  FRONTIER_BAD_DEBT_ALL_ZERO,
  FRONTIER_INDEPENDENT_SCALE_WARNING,
  FRONTIER_NOT_SERVED,
  FRONTIER_NOT_SERVED_TITLE,
  FRONTIER_ROW1_LABEL,
  FRONTIER_ROW2_LABEL,
  FRONTIER_SHOCK_SAMPLING_CAVEAT,
} from "../../app/lab/labReadingLines";
import {
  renderSignedCount,
  renderSignedUsdAmount,
  renderUsdAmount,
} from "../../lib/book-format";

const MINUS = "−";
const BASE = BOOK.waterfall as unknown as Waterfall;
const WAD = 1_000_000_000_000_000_000n;

test("grid factors become reader words, by exact bigint arithmetic", () => {
  expect(moveLabel(WAD, WAD)).toBe("unshocked");
  expect(moveLabel(800_000_000_000_000_000n, WAD)).toBe(`${MINUS}20%`);
  expect(moveLabel(1_050_000_000_000_000_000n, WAD)).toBe("+5%");
  // A zero grid scale is unstatable, and says so rather than dividing by it.
  expect(moveLabel(WAD, 0n)).toBe("grid scale 0");

  expect(moveProse(800_000_000_000_000_000n, WAD)).toBe("down 20%");
  expect(moveProse(1_050_000_000_000_000_000n, WAD)).toBe("up 5%");
  // The unshocked point is not a move at all.
  expect(moveProse(WAD, WAD)).toBeNull();
});

test("the fold names the baseline and the cliff, and never confuses the two", () => {
  const view = frontierView(BASE);
  expect(view.steps).toHaveLength(6);
  expect(view.baselineIndex).toBe(0);
  expect(view.steps[0]?.isBaseline).toBe(true);
  expect(view.steps[0]?.move).toBe("unshocked");
  // debt_manager reports 1 newly eligible AT the baseline — a standing census.
  // The cliff search starts BELOW the baseline, so it lands on aave at step 1.
  expect(view.steps[0]?.cells.find((cell) => cell.engine === "debt_manager")?.newlyEligible).toBe(1);
  expect(view.cliffIndex).toBe(1);
  expect(view.cliffEngines).toEqual(["aave_v3_etherfi"]);
});

test("one series per engine, each in its OWN decimals, never summed", () => {
  const series = frontierSeries(frontierView(BASE));
  expect(series.map((entry) => entry.engine)).toEqual(["aave_v3_etherfi", "debt_manager"]);
  expect(series[0]?.usdDecimals).toBe(8);
  expect(series[1]?.usdDecimals).toBe(6);
  // Peaks are per series — there is no book-wide ceiling anywhere.
  expect(labUsd(String(series[0]?.peakEligibleDebt), 8)).toBe("$6,000");
  expect(labUsd(String(series[1]?.peakEligibleDebt), 6)).toBe("$4,200");
});

test("an engine absent from the grid is a HOLE — no interpolated zero appears", () => {
  const view = frontierView(BOOK_ENGINE_REFUSED.waterfall as unknown as Waterfall);
  const series = frontierSeries(view);
  expect(series.map((entry) => entry.engine)).toEqual(["debt_manager"]);
  // The withheld engine is absent from the plot AND named in the refusal list.
  expect(
    (BOOK_ENGINE_REFUSED.waterfall as unknown as Waterfall).excluded_engines.map((r) => r.engine),
  ).toEqual(["aave_v3_etherfi"]);
});

test("the lead engine is picked by real-USD magnitude, never by summing", () => {
  const lead = leadEngineAtTerminal(frontierView(BASE));
  // aave $6,000 (8dp) beats debt_manager $4,200 (6dp) once each is read in its
  // own scale. The two are compared, never added.
  expect(lead?.engine).toBe("aave_v3_etherfi");
});

test("axis words are reader words, and an unknown axis passes through VERBATIM", () => {
  expect(axisWords("eth_usd")).toBe("ETH");
  expect(axisWords("borrow_apy")).toBe("the borrow rate");
  expect(axisWords("asset_usd", "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f")).toContain(
    "0xe008…fD3f",
  );
  // A surface that invents words for an axis it does not know will one day
  // describe the wrong shock.
  expect(axisWords("some_future_axis")).toBe("some_future_axis");
});

test("the reading lines are COMPUTED, and the axis titles are reader words", () => {
  expect(frontierAxisTitles(BASE)).toEqual({
    x: "if ETH fell by…",
    y: "debt the engine could liquidate",
  });
  const line = frontierReadingLine(BASE);
  expect(line).toContain("unshocked is the standing census");
  // AC-39 (bracket form): the grid samples DISCRETE shocks, so the sentence
  // names both ends. "First new eligibility lands at −10%" read as a measured
  // threshold; all the data supports is an interval.
  expect(line).toContain(`New eligibility first appears at the ${MINUS}10% sample`);
  expect(line).toContain("1 on aave_v3_etherfi");
  expect(line).toContain(`between the unshocked and ${MINUS}10% samples`);

  const series = frontierSeries(frontierView(BASE));
  const aave = series[0];
  if (aave === undefined) throw new Error("unreachable");
  const seriesLine = frontierSeriesReadingLine(aave);
  expect(seriesLine).toContain("Σ eligible debt $0 at unshocked");
  expect(seriesLine).toContain(`$6,000 at ${MINUS}50%`);
  expect(seriesLine).toContain("This engine's own USD at 8 decimals, never added to another");
});

test("a grid with NO new eligibility says so, rather than leaving the sentence open", () => {
  expect(frontierReadingLine(BOOK_ENGINE_REFUSED.waterfall as unknown as Waterfall)).toContain(
    "No step on this grid makes anything newly eligible.",
  );
});

test("the wire's caveats render VERBATIM — byte for byte, not paraphrased", () => {
  expect(atRiskNoteVerbatim(BASE)).toBe(BASE.at_risk_note);
  expect(eligibilityNoteVerbatim(BASE)).toBe(BASE.eligibility_note);
  expect(atRiskNoteVerbatim(BASE)).toContain("NO monotonicity invariant");
});

test("each panel marks ITS OWN cliff — the book's cliff is not drawn on an engine that has not crossed", () => {
  const series = frontierSeries(frontierView(BASE));
  const aave = series.find((entry) => entry.engine === "aave_v3_etherfi");
  const dm = series.find((entry) => entry.engine === "debt_manager");
  // aave crosses at −10%; debt_manager's only `newly` is at the ×1.00 CENSUS,
  // which is not a cliff — so its panel draws no cliff line at all.
  expect(aave?.cliffMove).toBe(`${MINUS}10%`);
  expect(dm?.cliffMove).toBeNull();
});

// ---------------------------------------------------------------------------
// CHART SPEC v4 — the loss frontier.
//
// THE REFERENCE FIXTURE. The spec's acceptance table names a grid whose cliff
// sits at −20% with 18 accounts. The committed `book.json` is a different
// scenario, so the reference is built HERE by structuredClone surgery over
// that body — the repo's own "computed, never hardcoded" pattern. Nothing
// below knows the grid's LENGTH: every column count is read off the served
// points, so the wire is free to grow the grid without touching a test.
// ---------------------------------------------------------------------------

/** The spec's reference grid: aave gains 18 accounts at the −20% sample. */
function referenceWaterfall(): Waterfall {
  const waterfall = structuredClone(BASE);
  for (const point of waterfall.points) {
    for (const engine of point.engines) {
      if (engine.engine === "aave_v3_etherfi") engine.newly_eligible_accounts = 0;
    }
  }
  const cliff = waterfall.points[2]?.engines.find(
    (engine) => engine.engine === "aave_v3_etherfi",
  );
  if (cliff === undefined) throw new Error("fixture shape drifted: no aave at point 2");
  cliff.newly_eligible_accounts = 18;
  return waterfall;
}

/** The same grid with aave absent from ONE sample — a hole, never a zero. */
function holedWaterfall(): Waterfall {
  const waterfall = referenceWaterfall();
  const point = waterfall.points[3];
  if (point === undefined) throw new Error("fixture shape drifted: no point 3");
  point.engines = point.engines.filter((engine) => engine.engine !== "aave_v3_etherfi");
  return waterfall;
}

function aaveSeries(waterfall: Waterfall): FrontierSeries {
  const series = frontierSeries(frontierView(waterfall)).find(
    (entry) => entry.engine === "aave_v3_etherfi",
  );
  if (series === undefined) throw new Error("fixture shape drifted: no aave series");
  return series;
}

test.describe("the cliff, bracketed (LF-5, AC-38, AC-39)", () => {
  test("AC-39: cliffClause names BOTH ends of the interval it actually knows", () => {
    const clause = cliffClause(frontierView(referenceWaterfall()));
    expect(clause).toContain(`New eligibility first appears at the ${MINUS}20% sample`);
    expect(clause).toContain("18 on aave_v3_etherfi");
    expect(clause).toContain(`between the ${MINUS}10% and ${MINUS}20% samples`);
  });

  test("AC-38: the cliff LABEL is the spec's copy over this engine's own count", () => {
    const series = aaveSeries(referenceWaterfall());
    expect(series.cliffMove).toBe(`${MINUS}20%`);
    expect(series.cliffIndex).toBe(2);
    expect(series.cliffNewlyEligible).toBe(18);
    expect(series.cliffPreviousMove).toBe(`${MINUS}10%`);
    expect(frontierCliffLabel(series.cliffNewlyEligible ?? 0)).toBe(
      "first sampled shock with new eligibility · 18 accounts",
    );
  });

  test("a cliff at the FIRST served sample is not bracketed against a sample nobody served", () => {
    const waterfall = structuredClone(BASE);
    waterfall.points = waterfall.points.slice(1); // drop the unshocked baseline
    const clause = cliffClause(frontierView(waterfall));
    expect(clause).toContain("no earlier sample was served");
    expect(clause).not.toContain("between the");
  });
});

test.describe("the grid, whole (LF-8, AC-40, AC-41)", () => {
  // AC-40 — and the grid LENGTH is never named: it is read off the wire.
  test("one grid entry per SERVED WATERFALL POINT, not per point this engine served", () => {
    const waterfall = holedWaterfall();
    const series = aaveSeries(waterfall);
    expect(series.grid).toHaveLength(waterfall.points.length);
    expect(series.points.length).toBe(waterfall.points.length - 1);
    expect(series.grid[3]?.cell).toBeNull();
    expect(series.grid[2]?.cell).not.toBeNull();
  });

  test("a longer grid simply yields more columns — nothing is pinned to six", () => {
    const waterfall = referenceWaterfall();
    const extra = structuredClone(waterfall.points[waterfall.points.length - 1]);
    if (extra === undefined) throw new Error("fixture shape drifted");
    extra.index = waterfall.points.length;
    extra.factor = "400000000000000000";
    waterfall.points.push(extra);
    expect(aaveSeries(waterfall).grid).toHaveLength(waterfall.points.length);
  });

  // AC-41
  test("a hole renders an em dash in EVERY cell of its column; a computed zero renders $0", () => {
    const series = aaveSeries(holedWaterfall());
    const rows = frontierLedgerRows(series);
    for (const row of rows) {
      expect(row.cells[3], row.key).toBe("—");
    }
    // The unshocked point IS served and IS zero: a computed zero, printed.
    const eligible = rows.find((row) => row.key === "eligible-debt");
    expect(eligible?.cells[0]).toBe("$0");
    const badDebt = rows.find((row) => row.key === "bad-debt");
    expect(badDebt?.cells[0]).toBe("$0");
  });

  // AC-44
  test("every ledger string is a direct render of the wire field, character for character", () => {
    const waterfall = referenceWaterfall();
    const series = aaveSeries(waterfall);
    const rows = frontierLedgerRows(series);
    waterfall.points.forEach((point, index) => {
      const wire = point.engines.find((engine) => engine.engine === "aave_v3_etherfi");
      if (wire === undefined) return;
      expect(rows.find((row) => row.key === "eligible-debt")?.cells[index]).toBe(
        renderUsdAmount(wire.cumulative_debt_eligible_usd, wire.usd_decimals),
      );
      expect(rows.find((row) => row.key === "bad-debt")?.cells[index]).toBe(
        renderUsdAmount(wire.cumulative_bad_debt_usd, wire.usd_decimals),
      );
      expect(rows.find((row) => row.key === "collateral-at-risk")?.cells[index]).toBe(
        renderUsdAmount(wire.cumulative_collateral_at_risk_usd, wire.usd_decimals),
      );
      expect(rows.find((row) => row.key === "first-eligible")?.cells[index]).toBe(
        wire.newly_eligible_accounts.toLocaleString("en-US"),
      );
    });
  });

  // AC-50 / CX-3
  test("the ledger's own vocabulary: `first eligible on grid`, never `first crossings`", () => {
    const rows = frontierLedgerRows(aaveSeries(referenceWaterfall()));
    expect(rows.map((row) => row.label)).toEqual([
      "Σ eligible debt",
      "bad debt",
      "first eligible on grid",
      "eligible accounts",
      "collateral at risk",
    ]);
    const firstEligible = rows.find((row) => row.key === "first-eligible");
    expect(firstEligible?.title).toBe(
      "Accounts first observed eligible at this grid point. At unshocked, this is the standing " +
        "census; at later points, first sampled eligibility. Each account appears once and " +
        "remains in cumulative eligible accounts thereafter.",
    );
    for (const row of rows) {
      expect(row.label).not.toContain("first crossings");
      // CX-1: CX-2 and CX-3 must share NO phrase.
      expect(row.label).not.toContain("Net change in eligible accounts");
    }
  });

  test("maxChars is measured over exactly the strings that will be printed", () => {
    const rows = frontierLedgerRows(aaveSeries(referenceWaterfall()));
    const longest = rows.flatMap((row) => row.cells).reduce((max, cell) => Math.max(max, cell.length), 0);
    expect(frontierLedgerMaxChars(rows)).toBe(longest);
  });
});

// AC-46 / LF-7
test("an all-zero bad-debt series states the zero rather than drawing an empty row", () => {
  const waterfall = structuredClone(BASE);
  for (const point of waterfall.points) {
    for (const engine of point.engines) engine.cumulative_bad_debt_usd = "0";
  }
  const series = aaveSeries(waterfall);
  expect(series.peakBadDebt).toBe(0n);
  expect(FRONTIER_BAD_DEBT_ALL_ZERO).toBe(
    "Bad debt is $0 at every step on this grid. That is a computed zero from the served waterfall.",
  );
  // …and the row's own ledger cells still print the computed zero, exactly.
  const badDebt = frontierLedgerRows(series).find((row) => row.key === "bad-debt");
  expect(badDebt?.cells.every((cell) => cell === "$0")).toBe(true);
});

test.describe("the FINAL COPY block, verbatim (LF-2, LF-8, LF-11)", () => {
  test("row labels name what the height MEANS, not the wire field", () => {
    expect(FRONTIER_ROW1_LABEL).toBe("debt the engine could liquidate ↑");
    expect(FRONTIER_ROW2_LABEL).toBe("bad debt still owed after all collateral is seized ↑");
  });

  test("the separator carries row 2's own maximum", () => {
    expect(frontierSeparatorLine("$2,000,000")).toBe(
      "The row below is drawn on its own y scale, with a maximum of $2,000,000. " +
        "Read each row against its own axis.",
    );
  });

  test("the STATE caveats", () => {
    expect(FRONTIER_INDEPENDENT_SCALE_WARNING).toBe(
      "The two rows carry separate y axes. Bar heights are comparable within a row and never " +
        "between rows.",
    );
    expect(FRONTIER_SHOCK_SAMPLING_CAVEAT).toBe(
      "This grid samples discrete shocks. Values between samples were not computed.",
    );
  });

  test("the not-served column", () => {
    expect(FRONTIER_NOT_SERVED).toBe("not served");
    expect(FRONTIER_NOT_SERVED_TITLE).toBe(
      "This engine served no point at this sample. The values are unknown rather than zero.",
    );
  });

  test("METHOD names the encoding, the unit and the as-of", () => {
    expect(frontierMethodLine(6, 1)).toBe(
      "Two rows on one shock axis, each on its own y scale. All values are this engine's own " +
        "USD at 6 decimals and are never added to another engine's. As of batch #1.",
    );
  });

  test("the ANSWER supplement describes the TWO ROWS, never an inset bar", () => {
    expect(FRONTIER_ANSWER_SUPPLEMENT).toBe(
      "Each engine panel carries two rows on one shock axis. The top row is the debt the " +
        "engine could liquidate, and the lower row is bad debt still owed after all collateral " +
        "is seized. The dashed line marks this engine's own first sampled shock with new " +
        "eligibility, and engines cross at different samples.",
    );
    // LF-1: the inset crit bar is gone, and so is every sentence about it.
    expect(FRONTIER_ANSWER_SUPPLEMENT).not.toContain("inner bar");
  });
});

// AC-51 — CX-4's one grouped-USD renderer.
test("renderUsdAmount groups, trims, and keeps null an em dash", () => {
  expect(renderUsdAmount("1234567890", 6)).toBe("$1,234.56789");
  expect(renderUsdAmount(null, 6)).toBe("—");
  expect(renderUsdAmount("0", 6)).toBe("$0");
  expect(renderUsdAmount("4200000000", 6)).toBe("$4,200");
  // Every Lab money value at or above 1000 is grouped.
  for (const value of ["1000000000", "4200000000", "1877357544497"]) {
    expect(renderUsdAmount(value, 6)).toMatch(/^\$\d{1,3}(,\d{3})*(\.\d+)?$/);
  }
  // `labUsd` is the SAME renderer, so the Lab cannot disagree with itself.
  expect(labUsd("1234567890", 6)).toBe(renderUsdAmount("1234567890", 6));
});

// AC-49 / CX-2 / CX-8 — the signed net delta.
test("a net delta always carries its sign, with U+2212 for negatives", () => {
  expect(renderSignedCount(164)).toBe("+164");
  expect(renderSignedCount(-3)).toBe("−3");
  expect(renderSignedCount(0)).toBe("0");
  expect(renderSignedCount(-3).charCodeAt(0)).toBe(0x2212);
  expect(renderSignedCount(12345)).toBe("+12,345");
  expect(renderSignedUsdAmount("4200000000", 6)).toBe("+$4,200");
  expect(renderSignedUsdAmount("-4200000000", 6)).toBe("−$4,200");
  expect(renderSignedUsdAmount("0", 6)).toBe("$0");
  expect(renderSignedUsdAmount(null, 6)).toBe("—");
});
