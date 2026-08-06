// Wave W-OBS — the HF sparkline's drawn y-domain, pinned PURE
// (lib/sparkline-scale):
//
//   - the domain is the finite extent UNION the 1.0 reference, padded 4% a
//     side — the disclosure line is never cropped, a series is never pinned
//     to a frame edge;
//   - a FLAT extent pads by max(4% of the value, 0.02) so a single point or
//     an unmoving HF renders mid-frame;
//   - the bound labels ride the EXISTING HF truncation register
//     (truncateToDisplay via hfAxisLabel — truncation, never rounding, no
//     new formatter), and they derive from the SAME domain the geometry uses.

import { expect, test } from "@playwright/test";
import {
  hfAxisLabel,
  paddedSparklineDomain,
  SPARKLINE_FLAT_PAD_FLOOR,
  SPARKLINE_PAD_RATIO,
} from "../../lib/sparkline-scale";
import { hfDisplayFromWad } from "../../lib/book-format";
import { buildHistorySeries } from "../../lib/history-series";
import { HISTORY } from "../fixtures/inspector";

const ENGINE = HISTORY.engines[0];
if (ENGINE === undefined) throw new Error("fixture invariant: one engine series expected");

test("the domain pads 4% around [min, max] and ALWAYS contains the 1.0 line", () => {
  // Values far above the boundary: the reference still enters the extent
  // BEFORE padding, so the padded domain contains it strictly.
  const domain = paddedSparklineDomain([1.4, null, 1.5], 1);
  expect(domain.min).toBeCloseTo(1 - 0.5 * SPARKLINE_PAD_RATIO, 10); // 0.98
  expect(domain.max).toBeCloseTo(1.5 + 0.5 * SPARKLINE_PAD_RATIO, 10); // 1.52
  expect(domain.min).toBeLessThan(1);
  expect(domain.max).toBeGreaterThan(1.5);
});

test("a flat series is never pinned to an edge — the flat pad floor applies", () => {
  // A single point equal to the reference: extent is flat at 1.0.
  const flat = paddedSparklineDomain([1], 1);
  expect(flat.min).toBeCloseTo(1 - Math.max(SPARKLINE_PAD_RATIO, SPARKLINE_FLAT_PAD_FLOOR), 10);
  expect(flat.max).toBeCloseTo(1 + Math.max(SPARKLINE_PAD_RATIO, SPARKLINE_FLAT_PAD_FLOOR), 10);
  expect(flat.max).toBeGreaterThan(flat.min);

  // Flat away from the reference, no reference drawn: pad is 4% of the value.
  const away = paddedSparklineDomain([1.08, 1.08]);
  expect(away.min).toBeCloseTo(1.08 - 1.08 * SPARKLINE_PAD_RATIO, 10);
  expect(away.max).toBeCloseTo(1.08 + 1.08 * SPARKLINE_PAD_RATIO, 10);
});

test("an empty domain keeps the historical [0, 1] fallback", () => {
  expect(paddedSparklineDomain([])).toEqual({ min: 0, max: 1 });
  expect(paddedSparklineDomain([null, null])).toEqual({ min: 0, max: 1 });
});

test("bound labels ride the EXISTING HF truncation register — never a new formatter", () => {
  // The same value through the register's wad path and the axis path agree.
  expect(hfAxisLabel(1.08)).toBe(hfDisplayFromWad("1080000000000000000"));
  expect(hfAxisLabel(1.08)).toBe("1.08");
  // Truncation, NEVER rounding up: 0.9968 states 0.996, 1.0832 states 1.083.
  expect(hfAxisLabel(0.9968)).toBe("0.996");
  expect(hfAxisLabel(1.0832)).toBe("1.083");
});

test("the fixture engine's drawn domain and its labels derive from ONE source", () => {
  // HISTORY: batch 1 REFUSED (gap), batch 2 computed at HF 1.08.
  const series = buildHistorySeries(ENGINE);
  const domain = paddedSparklineDomain(series.values, 1);
  // Extent [1.0, 1.08] (reference included), padded 4% of the 0.08 span.
  expect(domain.min).toBeCloseTo(0.9968, 10);
  expect(domain.max).toBeCloseTo(1.0832, 10);
  expect(domain.min).toBeLessThan(1);
  expect(domain.max).toBeGreaterThan(1.08);
  // The y-max label IS the formatter output of the drawn max — same object,
  // same register (the law the e2e checks against the rendered SVG).
  expect(hfAxisLabel(domain.max)).toBe("1.083");
  expect(hfAxisLabel(domain.min)).toBe("0.996");
});
