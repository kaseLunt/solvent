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
} from "../../app/lab/frontierView";
import {
  atRiskNoteVerbatim,
  eligibilityNoteVerbatim,
  frontierAxisTitles,
  frontierReadingLine,
  frontierSeriesReadingLine,
} from "../../app/lab/labReadingLines";

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
  expect(line).toContain(`First new eligibility lands at ${MINUS}10%`);
  expect(line).toContain("1 on aave_v3_etherfi");

  const series = frontierSeries(frontierView(BASE));
  const aave = series[0];
  if (aave === undefined) throw new Error("unreachable");
  const seriesLine = frontierSeriesReadingLine(aave);
  expect(seriesLine).toContain("Σ eligible debt $0 at unshocked");
  expect(seriesLine).toContain(`$6,000 at ${MINUS}50%`);
  expect(seriesLine).toContain("This engine's own USD at 8 decimals — never added to another");
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
