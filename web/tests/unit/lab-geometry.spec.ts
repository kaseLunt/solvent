// Geometry only: an opacity and an x coordinate. Nothing here is ever printed.
import { expect, test } from "@playwright/test";
import { dotPlotScale, heatIntensity } from "../../lib/lab-geometry";

test("heatIntensity: the square root of a share of the largest cell, in [0, 1]; an empty, absent or absurd max is 0, never NaN", () => {
  expect(heatIntensity(10, 10)).toBe(1);
  expect(heatIntensity(5, 10)).toBeCloseTo(Math.SQRT1_2, 12);
  // Over one global maximum, so one opacity means one count in every movement class: 18 and 135 against the 932 held
  // cell read apart, where a linear share left both near the floor.
  expect(heatIntensity(18, 932)).toBeCloseTo(0.139, 3);
  expect(heatIntensity(135, 932)).toBeCloseTo(0.381, 3);
  expect(heatIntensity(0, 10)).toBe(0);
  expect(heatIntensity(3, 0)).toBe(0);
  expect(heatIntensity(30, 10)).toBe(1);
  expect(heatIntensity(Number.NaN, 10)).toBe(0);
});

test("dotPlotScale: a symmetric domain around zero, the extremes on the pads, an all-null set still has a domain", () => {
  const s = dotPlotScale([46n, -12n, null], 400, 12);
  expect(s.maxAbsTenths).toBe(46n);
  expect(s.zeroX).toBe(200);
  expect(s.x(46n)).toBe(388);
  expect(s.x(-46n)).toBe(12);
  expect(s.x(0n)).toBe(200);
  const empty = dotPlotScale([null, null], 400);
  expect(empty.maxAbsTenths).toBe(10n);
  expect(empty.x(0n)).toBe(empty.zeroX);
  const narrow = dotPlotScale([1n], 10, 12);
  expect(narrow.right).toBeGreaterThan(narrow.left);
});
