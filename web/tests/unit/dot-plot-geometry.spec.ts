// Geometry only: the dot plot's two text columns in whole CSS pixels. Nothing here is ever printed.
//
// LF-8: a mono column is measured, never estimated. `dotPlotColumns` takes the glyph
// width the probe measured and turns the longest text of each column into a width; the
// floors and the label ceiling are the plot's own law, pinned here so the component never
// carries a per-character guess again. The law lives in the pure geometry module beside
// `dotPlotScale`: the unit project loads no CSS module, so a component file is out of its reach.
import { expect, test } from "@playwright/test";
import {
  DOT_PLOT_LABEL_MAX,
  DOT_PLOT_LABEL_MIN,
  DOT_PLOT_LABEL_PAD,
  DOT_PLOT_VALUE_MIN,
  DOT_PLOT_VALUE_PAD,
  dotPlotColumns,
} from "../../lib/lab-geometry";

const LABELS = ["ETH -30 percent", "a"] as const;
const VALUES = ["+4.5% · +$1.2M", "<0.1% · +$9,800"] as const;

test("dotPlotColumns: the longest text of each column times the measured glyph plus the column's pad; the label floor holds a short column", () => {
  // 15 glyphs each side. At 7px the label column (113) sits under its 160 floor; the value column (121) clears its 120 floor by one.
  expect(dotPlotColumns(LABELS, VALUES, 7)).toEqual({
    labelW: DOT_PLOT_LABEL_MIN,
    valueW: 15 * 7 + DOT_PLOT_VALUE_PAD,
  });
  // At 12px both columns are the glyph's, not a floor's.
  expect(dotPlotColumns(LABELS, VALUES, 12)).toEqual({
    labelW: 15 * 12 + DOT_PLOT_LABEL_PAD,
    valueW: 15 * 12 + DOT_PLOT_VALUE_PAD,
  });
});

test("dotPlotColumns: a longer value widens the value column only", () => {
  const base = dotPlotColumns(LABELS, VALUES, 7);
  const wide = dotPlotColumns(LABELS, [...VALUES, "+12.5% · +$123,456,789"], 7);
  expect(wide.labelW).toBe(base.labelW);
  expect(wide.valueW).toBe(22 * 7 + DOT_PLOT_VALUE_PAD);
  expect(wide.valueW).toBeGreaterThan(base.valueW);
});

test("dotPlotColumns: a longer label widens the label column only, up to its ceiling", () => {
  const base = dotPlotColumns(LABELS, VALUES, 7);
  const thirty = "x".repeat(30);
  const wide = dotPlotColumns([...LABELS, thirty], VALUES, 7);
  expect(wide.valueW).toBe(base.valueW);
  expect(wide.labelW).toBe(30 * 7 + DOT_PLOT_LABEL_PAD);
  const sixty = "x".repeat(60);
  expect(dotPlotColumns([sixty], VALUES, 7).labelW).toBe(DOT_PLOT_LABEL_MAX);
});

test("dotPlotColumns: a fractional glyph rounds each column up to a whole pixel, never down", () => {
  // 15 × 7.92 + 16 = 134.8 → 135: a column is never a fraction narrower than its text.
  const cols = dotPlotColumns(LABELS, VALUES, 7.92);
  expect(cols.valueW).toBe(135);
  expect(Number.isInteger(cols.labelW)).toBe(true);
  expect(Number.isInteger(cols.valueW)).toBe(true);
});

test("dotPlotColumns: an unmeasurable glyph or an empty column falls to the floors, never NaN", () => {
  const floors = { labelW: DOT_PLOT_LABEL_MIN, valueW: DOT_PLOT_VALUE_MIN };
  expect(dotPlotColumns(LABELS, VALUES, Number.NaN)).toEqual(floors);
  expect(dotPlotColumns(LABELS, VALUES, 0)).toEqual(floors);
  expect(dotPlotColumns(LABELS, VALUES, -3)).toEqual(floors);
  expect(dotPlotColumns([], [], 7)).toEqual(floors);
});
