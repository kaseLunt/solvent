// Wave W-OBS / W-OBS-B — the HF sparkline's drawn y-domain and its labels,
// pinned PURE (lib/sparkline-scale):
//
//   - the domain is the finite extent UNION the 1.0 reference, padded 4% a
//     side — the disclosure line is never cropped, a series is never pinned
//     to a frame edge;
//   - a FLAT extent pads by max(4% of the value, 0.02) so a single point or
//     an unmoving HF renders mid-frame;
//   - the bound labels are OUTWARD-directed (W-OBS-B): the min label FLOORS
//     to 3dp and the max label CEILS to 3dp, so the printed range always
//     CONTAINS the drawn domain — rendered through the existing register
//     formatter, no new one;
//   - the newest-value label's placement is a pure rule with a deterministic
//     collision law: it never strikes a line drawn across the plot, never
//     overprints a line's own label, and keeps its point's side of every
//     line while that side has room;
//   - History's series chart places its peak label over the peak, at the
//     plot's edge, or on a row of its own — never on the newest figure — and
//     prints compact axis ends when the full ones would run together;
//   - the direct label the sparkline prints is composed PURE in
//     lib/history-series (newestPlottedLabel): the meta line's exact display
//     string, qualified with "(batch {id})" whenever the newest witnessed
//     batch is a gap.

import { expect, test } from "@playwright/test";
import {
  hfAxisMaxLabel,
  hfAxisMinLabel,
  LABEL_ASCENT_PX,
  LABEL_DESCENT_PX,
  LABEL_GLYPH_BOUND_PX,
  LINE_LABEL_GAP_PX,
  lineInDomain,
  lineLabelBaseline,
  NEWEST_LABEL_COLLISION_PX,
  NEWEST_LABEL_LINE_CLEAR_PX,
  NEWEST_LABEL_OFFSET_PX,
  NEWEST_LABEL_ROW_PX,
  paddedSparklineDomain,
  SERIES_EDGE_INSET_PX,
  SERIES_PEAK_RAISE_PX,
  seriesAxisEnds,
  seriesPeakLabelPlacement,
  seriesSpansAcross,
  SPARKLINE_FLAT_PAD_FLOOR,
  SPARKLINE_PAD_RATIO,
  sparklineNewestLabelPlacement,
} from "../../lib/sparkline-scale";
import { hfDisplayFromWad } from "../../lib/book-format";
import { buildHistorySeries, knownBatchAxis, newestPlottedLabel } from "../../lib/history-series";
import { HISTORY, HISTORY_FLAT, HISTORY_QUALIFIED } from "../fixtures/inspector";

const ENGINE = HISTORY.engines[0];
if (ENGINE === undefined) throw new Error("fixture invariant: one engine series expected");
const ENGINE_QUALIFIED = HISTORY_QUALIFIED.engines[0];
if (ENGINE_QUALIFIED === undefined) {
  throw new Error("fixture invariant: the qualified variant carries one engine series");
}
const ENGINE_FLAT = HISTORY_FLAT.engines[0];
if (ENGINE_FLAT === undefined) {
  throw new Error("fixture invariant: the flat variant carries one engine series");
}

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

  // Flat away from the reference, no reference drawn: pad is 4% of the
  // value, then the bounds land on thousandths OUTWARD (rule 5): raw
  // 1.0368/1.1232 become 1.036/1.124.
  const away = paddedSparklineDomain([1.08, 1.08]);
  expect(Math.round(away.min * 1000)).toBe(1036);
  expect(Math.round(away.max * 1000)).toBe(1124);
});

test("an empty domain keeps the historical [0, 1] fallback", () => {
  expect(paddedSparklineDomain([])).toEqual({ min: 0, max: 1 });
  expect(paddedSparklineDomain([null, null])).toEqual({ min: 0, max: 1 });
});

test("W-OBS-B: bound labels are OUTWARD-directed — min floors, max ceils, no rounding in", () => {
  // A bound already ON a 3dp boundary keeps the register's exact string in
  // BOTH directions (the same string `hfDisplayFromWad` renders) — this
  // kills the fuzz-blind mutant Math.ceil(bound * 1000), for which
  // 1.08 * 1000 = 1080.0000000000002 ceils to "1.081".
  expect(hfAxisMinLabel(1.08)).toBe(hfDisplayFromWad("1080000000000000000"));
  expect(hfAxisMinLabel(1.08)).toBe("1.08");
  expect(hfAxisMaxLabel(1.08)).toBe("1.08");

  // The min label FLOORS (the old truncation direction, kept on this side).
  expect(hfAxisMinLabel(0.9968)).toBe("0.996");
  expect(hfAxisMinLabel(1.0832)).toBe("1.083");

  // The max label CEILS: the printed ceiling never sits below the drawn max.
  // This kills the truncate-both-bounds mutant (the retired `hfAxisLabel`),
  // which printed "1.083" under a drawn max of 1.0832.
  expect(hfAxisMaxLabel(1.0832)).toBe("1.084");
});

test("W-OBS-B: Codex round-62 boundary cases — the round-then-truncate mutant is dead", () => {
  // The retired implementation rounded at micros BEFORE truncating:
  // Math.round(0.9969996e6) = 997000 printed "0.997" while the register
  // claimed truncation. The min label must floor: "0.996", never "0.997".
  expect(hfAxisMinLabel(0.9969996)).toBe("0.996");
  expect(hfAxisMinLabel(0.9969996)).not.toBe("0.997");

  // The max side of the same shape ceils: "1.084" (a truncate mutant prints
  // "1.083"; note Math.round agrees with ceil here, so the truncate case
  // above and the 1.0832 case carry the max-side mutant kills).
  expect(hfAxisMaxLabel(1.0839996)).toBe("1.084");

  // A negative bound floors AWAY from zero on the min side: −0.0005 labels
  // "−0.001" — a truncate-toward-zero mutant prints "0" and so does
  // Math.round (round(−0.5) is −0).
  expect(hfAxisMinLabel(-0.0005)).toBe("−0.001");
  expect(hfAxisMinLabel(-0.9965)).toBe("−0.997");
  // The max side of a negative bound ceils TOWARD zero — outward for a max.
  expect(hfAxisMaxLabel(-0.0005)).toBe("0");
});

test("the fixture engine's drawn domain and its labels derive from ONE source", () => {
  // HISTORY: batch 1 REFUSED (gap), batch 2 computed at HF 1.08.
  const series = buildHistorySeries(ENGINE);
  const domain = paddedSparklineDomain(series.values, 1);
  // Extent [1.0, 1.08] (reference included), padded 4% of the 0.08 span,
  // then landed on thousandths OUTWARD (rule 5): raw 0.9968/1.0832 become
  // exactly 0.996/1.084.
  expect(Math.round(domain.min * 1000)).toBe(996);
  expect(Math.round(domain.max * 1000)).toBe(1084);
  expect(domain.min).toBeLessThan(1);
  expect(domain.max).toBeGreaterThan(1.08);
  // The bound labels ARE the drawn bounds VERBATIM — same object, same
  // register (the law the e2e checks against the rendered SVG).
  expect(hfAxisMaxLabel(domain.max)).toBe("1.084");
  expect(hfAxisMinLabel(domain.min)).toBe("0.996");
  // CONTAINMENT is identity under rule 5: the label parses back to the
  // exact drawn bound on both sides.
  expect(Number(hfAxisMinLabel(domain.min))).toBe(domain.min);
  expect(Number(hfAxisMaxLabel(domain.max))).toBe(domain.max);
});

test("r63 rule 5: an honest bound a hair past a 3dp boundary can never print inside the domain", () => {
  // Codex round 63's honest scenario: one plotted HF at 1.0009615388461537
  // with the 1.0 reference. The float pad arithmetic lands the raw max at
  // ~1.0010000004 — 4e-10 PAST the 1.001 boundary. r62's label path rounded
  // that back to "1.001" while the DRAWN max stayed above it: a printed
  // ceiling below the drawn domain. Rule 5 quantizes the DOMAIN itself
  // outward-with-shed, so the drawn max IS 1.001, the label renders it
  // verbatim, and the plotted value sits strictly inside.
  const value = 1.0009615388461537;
  const domain = paddedSparklineDomain([value], 1);
  expect(Math.round(domain.max * 1000)).toBe(1001);
  expect(hfAxisMaxLabel(domain.max)).toBe("1.001");
  expect(value).toBeLessThan(domain.max);
  expect(Number(hfAxisMaxLabel(domain.max))).toBe(domain.max);
  // The min side of the same shape: raw 0.9990 - pad lands below 0.999 and
  // floors outward; the plotted reference stays strictly inside too.
  expect(domain.min).toBeLessThan(1);
  expect(Number(hfAxisMinLabel(domain.min))).toBe(domain.min);
});

test("r63 rule 5: drawn bounds always land on thousandths, both sides, across shapes", () => {
  // The micro-span guard (SPARKLINE_MIN_PAD) keeps quantization from ever
  // landing a bound at or inside the data: two values 1e-9 apart still get
  // a pad four orders above the 5e-10 shed.
  const shapes: ReadonlyArray<ReadonlyArray<number>> = [
    [1.0000000001, 1.0000000002],
    [0.9968, 1.0832],
    [49.9, 50.1],
  ];
  for (const values of shapes) {
    const domain = paddedSparklineDomain(values, 1);
    expect(Math.abs(domain.min * 1000 - Math.round(domain.min * 1000))).toBeLessThan(1e-9);
    expect(Math.abs(domain.max * 1000 - Math.round(domain.max * 1000))).toBeLessThan(1e-9);
    for (const value of values) {
      expect(value).toBeGreaterThan(domain.min);
      expect(value).toBeLessThan(domain.max);
    }
  }
});

// ---------------------------------------------------------------------------
// The newest-value label's placement: a value label never strikes a line
// drawn across the plot, never overprints a line's own label, and stays on
// its point's side of every line while that side has room.
// ---------------------------------------------------------------------------

/** The obstacles a Sparkline passes for one reference line and its label (named above the line, as it draws it). */
function referenceAt(lineY: number, height: number) {
  return { lineYs: [lineY], labelYs: [lineLabelBaseline(lineY, height, "above")] };
}

test("placement: without a reference the historical rule is unchanged", () => {
  // Above the point with headroom.
  expect(sparklineNewestLabelPlacement({ pointX: 100, pointY: 40, midX: 80, height: 72 })).toEqual(
    { y: 34, anchorEnd: true },
  );
  // No headroom: below the point, clamped inside the frame.
  expect(sparklineNewestLabelPlacement({ pointX: 50, pointY: 10, midX: 80, height: 72 })).toEqual({
    y: 24,
    anchorEnd: false,
  });
});

test("line label: a line's own label sits just above it, or just below it when the frame has no room above", () => {
  // Above: the ink's lowest descender keeps LINE_LABEL_GAP_PX from the line.
  expect(lineLabelBaseline(40, 72, "above")).toBe(40 - LINE_LABEL_GAP_PX - LABEL_DESCENT_PX);
  expect(lineLabelBaseline(40, 72, "above")).toBe(35);
  // A line 10px from the top leaves no room for 11px of ink above it: the label is set below the line, never
  // clipped by the frame and never struck by the line it names.
  expect(lineLabelBaseline(10, 72, "above")).toBe(10 + LINE_LABEL_GAP_PX + LABEL_ASCENT_PX);
  expect(lineLabelBaseline(10, 72, "above")).toBe(23);
  // The mirror: a boundary label prefers the side past the boundary, and takes the other side near the floor.
  expect(lineLabelBaseline(40, 72, "below")).toBe(53);
  expect(lineLabelBaseline(65, 72, "below")).toBe(60);
  // A frame too short for either side keeps the preferred side rather than inventing a third place.
  expect(lineLabelBaseline(8, 14, "above")).toBe(3);
});

test("line: a boundary line is drawn only where the drawn domain reaches it, and never widens the domain", () => {
  expect(lineInDomain(0, { min: -2.5, max: 30 })).toBe(true);
  // Inclusive at both bounds: a series that touches the boundary shows it.
  expect(lineInDomain(0, { min: 0, max: 30 })).toBe(true);
  expect(lineInDomain(30, { min: 0, max: 30 })).toBe(true);
  // A domain that stays above the boundary draws no boundary: nothing is cropped, nothing is manufactured.
  expect(lineInDomain(0, { min: 3.8, max: 30 })).toBe(false);
  expect(lineInDomain(Number.NaN, { min: 0, max: 30 })).toBe(false);
});

test("placement: clear of every line and label, the candidate stays where it was", () => {
  // The point sits 25px under the line: the candidate's ink box (113–127) keeps 8px from it.
  expect(
    sparklineNewestLabelPlacement({ pointX: 500, pointY: 130, midX: 250, height: 140, lineYs: [105] }),
  ).toEqual({ y: 124, anchorEnd: true });
});

test("placement: a point just under the line keeps its label under the line — never across the threshold", () => {
  // The inspector's shape: the newest room (9%) sits just under the 10% line. The candidate (104) would strike
  // the line (105). Above the line is nearer (98) but reads as a value above the threshold; the label keeps the
  // point's side: 105 + 4 + 11 = 120. Kills a nearest-regardless-of-side mutant.
  expect(
    sparklineNewestLabelPlacement({ pointX: 500, pointY: 110, midX: 250, height: 140, lineYs: [105] }),
  ).toEqual({ y: 120, anchorEnd: true });
});

test("placement: a point just over the line keeps its label over the line", () => {
  // The candidate (98.5) would graze the line (105) by half a pixel of clearance; over the line is the point's side.
  expect(
    sparklineNewestLabelPlacement({ pointX: 500, pointY: 104.5, midX: 250, height: 140, lineYs: [105] }),
  ).toEqual({ y: 98, anchorEnd: true });
});

test("placement: the label crosses a line only when its own side has no room", () => {
  // Under the line (60) the frame ends at 66: a label clear of the line needs a baseline of 75. It takes the far
  // side (53) rather than striking the line.
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 64, midX: 80, height: 72, lineYs: [60] }),
  ).toEqual({ y: 53, anchorEnd: true });
});

test("placement: flat on the line, the label rises a full row past the line's own label", () => {
  // The flat-at-1.0 geometry at the inspector's height (72): the point rides the line mid-frame (36), the line's
  // label sits at 31, and the candidate (30) strikes both. A point ON the line counts as over it, so the label
  // takes that side, one row past the line's label: 31 - 16 = 15. Kills the no-displacement mutant (30).
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 36, midX: 80, height: 72, ...referenceAt(36, 72) }),
  ).toEqual({ y: 15, anchorEnd: true });
});

test("placement: a point under the line and its label goes under the line, not over its label", () => {
  // Candidate 40 strikes the line (36). Over the line's label (15) would put the figure across the threshold from
  // its point (46); under the line (36 + 15 = 51) is the point's side. Kills an always-displace-up mutant.
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 46, midX: 80, height: 72, ...referenceAt(36, 72) }),
  ).toEqual({ y: 51, anchorEnd: true });
});

test("placement: with no room under the line, a point on it takes the row over the line's label", () => {
  // Line at 63 in a 72px frame (label at 58): under the line needs 78, outside the frame; the label lands a row
  // over the line's label, 58 - 16 = 42. Kills a mutant that skips straight to the last-resort anchor flip.
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 63, midX: 80, height: 72, ...referenceAt(63, 72) }),
  ).toEqual({ y: 42, anchorEnd: true });
});

test("placement: when no place is clear, the label leaves the right-edge column", () => {
  // A short frame (36): every clear baseline falls outside [12, 30], so the baseline keeps the candidate (17) and
  // the anchor is FORCED to end — the label extends left of its point, out from under the line label's right-edge
  // x span. Kills a mutant that drops the horizontal fallback (anchorEnd would stay false for this left-half point).
  expect(
    sparklineNewestLabelPlacement({ pointX: 10, pointY: 23, midX: 50, height: 36, ...referenceAt(23, 36) }),
  ).toEqual({ y: 17, anchorEnd: true });
});

test("placement: 12px between baselines is INSIDE the label collision band", () => {
  // Clear of the line (36) but 12px over its label (31): a 12px label's ink box is 14px tall, so the boxes still
  // overlap. The label moves a row past it: 31 - 16 = 15. Kills a `< 12` band.
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 25, midX: 80, height: 72, ...referenceAt(36, 72) }),
  ).toEqual({ y: 15, anchorEnd: true });
});

test("placement: exactly 15px between baselines is OUTSIDE the band — the boundary is pinned", () => {
  // |16 - 31| = 15 does not displace (strict < 15): two baselines 15px apart hold 1px of clear space between their
  // 14px ink boxes. A `<= 15` band would move the label to 15.
  expect(NEWEST_LABEL_COLLISION_PX).toBe(LABEL_ASCENT_PX + LABEL_DESCENT_PX + 1);
  expect(
    sparklineNewestLabelPlacement({ pointX: 137, pointY: 22, midX: 80, height: 72, ...referenceAt(36, 72) }),
  ).toEqual({ y: 16, anchorEnd: true });
});

test("placement: past a boundary line, the label stays past it and clear of the boundary's own label", () => {
  // Room over cap: the near-cap line at 60 (its label over it, 55), the over-cap boundary at 100 (its label under
  // it, 113), the newest point just past the boundary (104). The candidate (98) strikes the boundary. Nearest clear
  // is 93 — back across the boundary. Under both lines and a row under the boundary's label is 129.
  expect(
    sparklineNewestLabelPlacement({
      pointX: 500,
      pointY: 104,
      midX: 250,
      height: 140,
      lineYs: [60, 100],
      labelYs: [lineLabelBaseline(60, 140, "above"), lineLabelBaseline(100, 140, "below")],
    }),
  ).toEqual({ y: 129, anchorEnd: true });
});

test("series span: the height a plotted run covers across a label's span, its ends interpolated", () => {
  const run = [
    { x: 0, y: 100 },
    { x: 20, y: 120 },
    { x: 40, y: 100 },
  ];
  // Across [10, 30] both ends interpolate to 110 and the vertex at 20 reaches 120.
  expect(seriesSpansAcross([run], 10, 30)).toEqual([{ top: 110, bottom: 120 }]);
  // Each run is its own span (a gap breaks the line), and a run that never enters the span adds nothing.
  const away = [
    { x: 50, y: 10 },
    { x: 60, y: 20 },
  ];
  expect(seriesSpansAcross([run, away], 10, 30)).toEqual([{ top: 110, bottom: 120 }]);
  expect(seriesSpansAcross([run], 41, 60)).toEqual([]);
  // An isolated point (a run of one) counts where it falls.
  expect(seriesSpansAcross([[{ x: 15, y: 70 }]], 10, 30)).toEqual([{ top: 70, bottom: 70 }]);
});

/**
 * The Inspector demo's room chart (the History card): 140 tall, 100 batches on a [3.8, 38.3] domain, the 10% line
 * at 112.92, the newest room (3.8%) in the bottom-right corner — the series falls into its point from the upper
 * left, crossing under the line. The Sparkline's own scale, over the last eight batches; the frame is 1190px at
 * 1440 and 320px at 390.
 */
function demoRoomChart(width: number) {
  const height = 140;
  const pad = 3;
  const count = 100;
  const min = 3.8;
  const span = 38.3 - min;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (count - 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const tail = [7.1, 6.6, 6.1, 5.7, 5.2, 4.7, 4.2, 3.8];
  const run = tail.map((v, k) => ({ x: x(count - tail.length + k), y: y(v) }));
  const point = run.at(-1);
  if (point === undefined) throw new Error("fixture invariant: the demo run has a newest point");
  const labelWidth = "3.8%".length * LABEL_GLYPH_BOUND_PX;
  const placement = sparklineNewestLabelPlacement({
    pointX: point.x,
    pointY: point.y,
    midX: width / 2,
    height,
    lineYs: [y(10)],
    series: [run],
    labelWidth,
  });
  const [across] = seriesSpansAcross([run], point.x - NEWEST_LABEL_OFFSET_PX - labelWidth, point.x - NEWEST_LABEL_OFFSET_PX);
  if (across === undefined) throw new Error("fixture invariant: the series runs under the label");
  return { lineY: y(10), point, placement, across };
}

test("placement: the demo's 3.8% clears the series it names and the 10% line, and stays under the line", () => {
  const { lineY, point, placement, across } = demoRoomChart(1190);
  // Where it printed while only the lines were obstacles — 6px over its point — the falling series runs through
  // the figure's ink.
  expect(point.y - 6 + LABEL_DESCENT_PX).toBeGreaterThan(across.top);
  // Under the line there is no place 4px clear of it; at the named-line gap from both, the figure fits between the
  // line and the series. Kills a series-blind mutant (131), a 4px-only mutant (131, over the series) and a
  // cross-before-tightening mutant (105.92, over the line).
  expect(placement.anchorEnd).toBe(true);
  expect(placement.y).toBeCloseTo(126.22, 2);
  expect(placement.y - LABEL_ASCENT_PX - lineY).toBeGreaterThanOrEqual(LINE_LABEL_GAP_PX);
  expect(across.top - (placement.y + LABEL_DESCENT_PX)).toBeCloseTo(LINE_LABEL_GAP_PX, 9);
});

test("placement: where its own series fills the room under the line, the figure keeps its side over the series", () => {
  // The same chart at 390: the series covers everything between the line and the frame's floor across the label's
  // span. Over the line is clear, but a 3.8% printed there reads as above the 10% threshold; the figure keeps its
  // place 6px over its point, 4px clear of the line, and its halo knocks the series out beneath it. Kills a mutant
  // that crosses the threshold before it overprints its own series (105.92).
  const { lineY, point, placement, across } = demoRoomChart(320);
  expect(across.top - lineY).toBeLessThan(LINE_LABEL_GAP_PX + LABEL_ASCENT_PX + LABEL_DESCENT_PX + LINE_LABEL_GAP_PX);
  expect(placement).toEqual({ y: point.y - 6, anchorEnd: true });
  expect(placement.y - LABEL_ASCENT_PX - lineY).toBeGreaterThanOrEqual(NEWEST_LABEL_LINE_CLEAR_PX);
});

test("placement: a flat series keeps the historical place — 6px over its point is clear of the line it names", () => {
  // The ink box ends 3px over the flat line: the named-line gap (2), not the 4px a value keeps from a line it does
  // not name. Kills a 4px-from-the-series mutant (73).
  const flat = [
    { x: 400, y: 80 },
    { x: 450, y: 80 },
    { x: 500, y: 80 },
  ];
  expect(
    sparklineNewestLabelPlacement({ pointX: 500, pointY: 80, midX: 250, height: 140, series: [flat], labelWidth: 32 }),
  ).toEqual({ y: 74, anchorEnd: true });
});

test("placement: a series falling steeply into its point tucks the figure under the line it names", () => {
  // Leftward of (500, 100) the series climbs 1px per px: across the label's span [462, 494] it covers 62–94. The
  // candidate (94) sits on it; over it (57) is further than under it (94 + 2 + 11 = 107).
  const steep = [
    { x: 400, y: 0 },
    { x: 500, y: 100 },
  ];
  expect(
    sparklineNewestLabelPlacement({ pointX: 500, pointY: 100, midX: 250, height: 140, series: [steep], labelWidth: 32 }),
  ).toEqual({ y: 107, anchorEnd: true });
});

test("placement: a rightward label checks the series to the RIGHT of its point", () => {
  // A left-half point labels rightward, across [106, 138], where the series climbs from 44 to 12. The candidate (44)
  // sits on it and over it has no headroom, so the figure goes under: 44 + 2 + 11 = 57. Kills a mutant that reads
  // the series left of the point (nothing there: the candidate would stand).
  const rising = [
    { x: 100, y: 50 },
    { x: 200, y: -50 },
  ];
  expect(
    sparklineNewestLabelPlacement({ pointX: 100, pointY: 50, midX: 250, height: 140, series: [rising], labelWidth: 32 }),
  ).toEqual({ y: 57, anchorEnd: false });
});

// ---------------------------------------------------------------------------
// History's series chart: the peak label never overprints the newest figure,
// and the axis ends fit the plot or print their compact forms.
// ---------------------------------------------------------------------------

/** A wide plot: the peak at x 300, the newest figure at the right end, both labels in the top strip. */
const WIDE = { width: 800, padX: 6, glyphPx: 8, labelChars: 10, peakBaselineY: 16 } as const;
const NEWEST_RIGHT = { left: 700, right: 790, baselineY: 14 } as const;

test("peak label: centred over the peak when it clears the newest figure", () => {
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 300, newest: NEWEST_RIGHT })).toEqual({
    place: "peak",
    x: 300,
    anchor: "middle",
  });
  // Clamped into the frame: half the label's width plus a pixel from either end.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 10, newest: NEWEST_RIGHT })).toEqual({
    place: "peak",
    x: 41,
    anchor: "middle",
  });
  // No newest figure: nothing to clear.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 750, newest: null }).place).toBe("peak");
});

test("peak label: the plot's left edge when over the peak it would touch the newest figure", () => {
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 690, newest: NEWEST_RIGHT })).toEqual({
    place: "edge",
    x: WIDE.padX + SERIES_EDGE_INSET_PX,
    anchor: "start",
  });
  // No index named: the edge, where the label's word still says what it is.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: null, newest: NEWEST_RIGHT }).place).toBe("edge");
  // A label wider than the plot is never centred.
  expect(seriesPeakLabelPlacement({ ...WIDE, labelChars: 120, peakX: 300, newest: null }).place).toBe("edge");
});

test("peak label: its own row when neither over the peak nor at the edge clears the newest figure", () => {
  // A phone-width plot: the newest figure's label spans most of it. The peak label is raised, centred over the
  // peak. Kills the old two-placement rule, which parked it at the edge on top of the newest figure.
  const narrow = { ...WIDE, width: 300 };
  const newest = { left: 60, right: 294, baselineY: 14 };
  expect(seriesPeakLabelPlacement({ ...narrow, peakX: 200, newest })).toEqual({
    place: "raised",
    x: 200,
    anchor: "middle",
  });
  // Raised with no index: at the edge inset, on its own row.
  expect(seriesPeakLabelPlacement({ ...narrow, peakX: null, newest })).toEqual({
    place: "raised",
    x: narrow.padX + SERIES_EDGE_INSET_PX,
    anchor: "start",
  });
  expect(SERIES_PEAK_RAISE_PX).toBe(NEWEST_LABEL_ROW_PX);
});

test("peak label: two labels a full band apart vertically never collide, whatever their x", () => {
  // The newest figure prints 44px under the peak's: centred over the peak is clear. Kills a horizontal-only rule.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 740, newest: { ...NEWEST_RIGHT, baselineY: 60 } }).place).toBe(
    "peak",
  );
  // Exactly 15px apart: clear (strict < 15); 14px apart: the band holds.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 740, newest: { ...NEWEST_RIGHT, baselineY: 31 } }).place).toBe(
    "peak",
  );
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 740, newest: { ...NEWEST_RIGHT, baselineY: 30 } }).place).toBe(
    "edge",
  );
});

test("peak label: a glyph of air is kept between the two labels", () => {
  // Centred at 300 the label spans 260–340; the newest figure starting 8px (one glyph) past it collides, 9px clears.
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 300, newest: { ...NEWEST_RIGHT, left: 348 } }).place).toBe("edge");
  expect(seriesPeakLabelPlacement({ ...WIDE, peakX: 300, newest: { ...NEWEST_RIGHT, left: 349 } }).place).toBe("peak");
});

const ENDS = { start: "Aug 1, 21:00 UTC", end: "Aug 8, 20:00 UTC", startCompact: "Aug 1, 21:00", endCompact: "Aug 8, 20:00" };

test("axis ends: the full strings while both fit the plot with two glyphs between them", () => {
  // (16 + 16 + 2) × 7.9 = 268.6 ≤ 400 − 12.
  expect(seriesAxisEnds({ ...ENDS, width: 400, padX: 6, glyphPx: 7.9 })).toEqual({
    start: ENDS.start,
    end: ENDS.end,
    compact: false,
  });
  // Exactly equal still fits (strict >).
  expect(seriesAxisEnds({ ...ENDS, width: 34 * 8 + 12, padX: 6, glyphPx: 8 }).compact).toBe(false);
});

test("axis ends: the compact forms when the full strings would run together", () => {
  // 268.6 > 280 − 12: the ends would run into each other at a phone's width.
  expect(seriesAxisEnds({ ...ENDS, width: 280, padX: 6, glyphPx: 7.9 })).toEqual({
    start: ENDS.startCompact,
    end: ENDS.endCompact,
    compact: true,
  });
  expect(seriesAxisEnds({ ...ENDS, width: 34 * 8 + 11, padX: 6, glyphPx: 8 }).compact).toBe(true);
});

test("axis ends: without compact forms the full strings print as before", () => {
  expect(seriesAxisEnds({ start: ENDS.start, end: ENDS.end, width: 120, padX: 6, glyphPx: 8 })).toEqual({
    start: ENDS.start,
    end: ENDS.end,
    compact: false,
  });
  // One compact form: that end shortens, the other keeps its full string.
  expect(seriesAxisEnds({ start: ENDS.start, end: ENDS.end, endCompact: ENDS.endCompact, width: 120, padX: 6, glyphPx: 8 })).toEqual({
    start: ENDS.start,
    end: ENDS.endCompact,
    compact: true,
  });
  // A one-entry axis has only a start; its own length decides.
  expect(seriesAxisEnds({ start: ENDS.start, startCompact: ENDS.startCompact, width: 160, padX: 6, glyphPx: 8 })).toEqual({
    start: ENDS.start,
    end: undefined,
    compact: false,
  });
  expect(seriesAxisEnds({ start: ENDS.start, startCompact: ENDS.startCompact, width: 150, padX: 6, glyphPx: 8 })).toEqual({
    start: ENDS.startCompact,
    end: undefined,
    compact: true,
  });
});

// ---------------------------------------------------------------------------
// W-OBS-B — the direct label the sparkline prints (fix 1), composed pure in
// lib/history-series and pinned here beside the scale it labels.
// ---------------------------------------------------------------------------

test("newestPlottedLabel: plain arm — the newest witnessed batch plots, no qualifier", () => {
  // HISTORY: batch 2 (the newest witnessed batch) is the plotted point, so
  // the direct label IS the meta line's display string, verbatim. Kills an
  // always-qualify mutant ("1.08 (batch 2)" here would be wrong: the reader
  // needs the qualifier exactly when the label is NOT the newest row).
  const series = buildHistorySeries(ENGINE, knownBatchAxis(HISTORY));
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("the HISTORY series must have a plotted point");
  expect(newest.atNewestBatch).toBe(true);
  expect(newest.entry.display).toBe("1.08");
  expect(newest.directLabel).toBe(newest.entry.display);
});

test("newestPlottedLabel: qualified arm — an older figure states WHICH batch it is", () => {
  // HISTORY_QUALIFIED: two finite points with DISTINCT values (1.02 at batch
  // 1, 1.08 at batch 2) and a REFUSED batch 3 as the newest witnessed batch.
  const series = buildHistorySeries(ENGINE_QUALIFIED, knownBatchAxis(HISTORY_QUALIFIED));
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("the qualified series must have a plotted point");

  // The scan runs newest-first: batch 2's 1.08, NEVER batch 1's 1.02 — the
  // distinct values kill the oldest-finite scan mutant the single-finite
  // HISTORY fixture let pass.
  expect(newest.entry.batchId).toBe(2);
  expect(newest.entry.display).toBe("1.08");

  // The qualified arm is the plain display string PLUS the qualifier —
  // never a retyped value (one source).
  expect(newest.atNewestBatch).toBe(false);
  expect(newest.directLabel).toBe(`${newest.entry.display} (batch 2)`);
  expect(newest.directLabel).toBe("1.08 (batch 2)");
});

test("newestPlottedLabel: null when nothing plots — no label is ever invented", () => {
  const gapsOnly = buildHistorySeries(
    { ...ENGINE_QUALIFIED, points: [], withheld_batch_ids: [7] },
    [7],
  );
  expect(newestPlottedLabel(gapsOnly)).toBeNull();
});

test("the flat-at-1.0 variant: exact-boundary bounds keep their register strings", () => {
  // HISTORY_FLAT plots [1, 1] against the 1.0 reference: the flat pad floor
  // gives [0.96, 1.04], and bounds already at 3dp boundaries render as the
  // register's own strings in BOTH directions (no outward drift on exact
  // values). The plain-arm direct label is the display "1".
  const series = buildHistorySeries(ENGINE_FLAT, knownBatchAxis(HISTORY_FLAT));
  const domain = paddedSparklineDomain(series.values, 1);
  expect(domain.min).toBeCloseTo(0.96, 10);
  expect(domain.max).toBeCloseTo(1.04, 10);
  expect(hfAxisMinLabel(domain.min)).toBe("0.96");
  expect(hfAxisMaxLabel(domain.max)).toBe("1.04");
  const newest = newestPlottedLabel(series);
  if (newest === null) throw new Error("the flat series must have a plotted point");
  expect(newest.atNewestBatch).toBe(true);
  expect(newest.directLabel).toBe("1");
});
