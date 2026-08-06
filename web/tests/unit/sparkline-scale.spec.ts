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
//     collision law: within 12px of the reference label's baseline it
//     displaces a full row to the far side, so flat-at-1.0 shows two labels;
//   - the direct label the sparkline prints is composed PURE in
//     lib/history-series (newestPlottedLabel): the meta line's exact display
//     string, qualified with "(batch {id})" whenever the newest witnessed
//     batch is a gap.

import { expect, test } from "@playwright/test";
import {
  hfAxisMaxLabel,
  hfAxisMinLabel,
  paddedSparklineDomain,
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

  // Flat away from the reference, no reference drawn: pad is 4% of the value.
  const away = paddedSparklineDomain([1.08, 1.08]);
  expect(away.min).toBeCloseTo(1.08 - 1.08 * SPARKLINE_PAD_RATIO, 10);
  expect(away.max).toBeCloseTo(1.08 + 1.08 * SPARKLINE_PAD_RATIO, 10);
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
  // Extent [1.0, 1.08] (reference included), padded 4% of the 0.08 span.
  expect(domain.min).toBeCloseTo(0.9968, 10);
  expect(domain.max).toBeCloseTo(1.0832, 10);
  expect(domain.min).toBeLessThan(1);
  expect(domain.max).toBeGreaterThan(1.08);
  // The bound labels ARE the outward-directed renderings of the drawn
  // domain — same object, same register (the law the e2e checks against the
  // rendered SVG). The max CEILS: the drawn 1.0832 sits under "1.084".
  expect(hfAxisMaxLabel(domain.max)).toBe("1.084");
  expect(hfAxisMinLabel(domain.min)).toBe("0.996");
  // CONTAINMENT, stated as the law it is: the labelled range contains the
  // drawn domain on both sides.
  expect(Number(hfAxisMinLabel(domain.min))).toBeLessThanOrEqual(domain.min);
  expect(Number(hfAxisMaxLabel(domain.max))).toBeGreaterThanOrEqual(domain.max);
});

// ---------------------------------------------------------------------------
// W-OBS-B — the newest-value label's placement rule (fix 4b), pure.
// ---------------------------------------------------------------------------

test("placement: without a reference label the historical rule is unchanged", () => {
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

test("placement: flat-at-1.0 displaces the label a full row past the reference label", () => {
  // The flat-at-1.0 geometry at the inspector's height (72): the point rides
  // the reference line mid-frame (36), the reference label sits at 33, and
  // the candidate (30) lands inside the 12px collision band. The label
  // crosses to the FAR side: 33 + 16 = 49. This kills the no-displacement
  // mutant (the historical rule alone), which parks the label at 30 — 3px
  // from the reference label's baseline.
  expect(
    sparklineNewestLabelPlacement({
      pointX: 137,
      pointY: 36,
      midX: 80,
      height: 72,
      referenceLabelY: 33,
    }),
  ).toEqual({ y: 49, anchorEnd: true });
});

test("placement: a candidate BELOW the reference label crosses to the far side ABOVE it", () => {
  // Candidate 40 sits below the reference label (33): the far side is above,
  // 33 - 16 = 17 — which also clears the point (46) the candidate tracks.
  // This kills an always-displace-below mutant (49 would crowd the point).
  expect(
    sparklineNewestLabelPlacement({
      pointX: 137,
      pointY: 46,
      midX: 80,
      height: 72,
      referenceLabelY: 33,
    }),
  ).toEqual({ y: 17, anchorEnd: true });
});

test("placement: when the far side leaves the frame, the near side takes the label", () => {
  // Reference label at 60 in a 72px frame: the far side (76) is outside, so
  // the label lands a full row on the NEAR side instead (44). This kills a
  // mutant that skips straight to the last-resort anchor flip.
  expect(
    sparklineNewestLabelPlacement({
      pointX: 137,
      pointY: 63,
      midX: 80,
      height: 72,
      referenceLabelY: 60,
    }),
  ).toEqual({ y: 44, anchorEnd: true });
});

test("placement: when neither side fits, the label leaves the right-edge column", () => {
  // A short frame (36): both displacement rows fall outside [12, 30], so the
  // baseline keeps the candidate (17) and the anchor is FORCED to end — the
  // label extends left of its point, out from under the reference label's
  // right-edge x span. This kills a mutant that drops the horizontal
  // fallback (anchorEnd would stay false for this left-half point).
  expect(
    sparklineNewestLabelPlacement({
      pointX: 10,
      pointY: 23,
      midX: 50,
      height: 36,
      referenceLabelY: 20,
    }),
  ).toEqual({ y: 17, anchorEnd: true });
});

test("placement: exactly 12px of separation is OUTSIDE the collision band", () => {
  // |candidate - referenceLabelY| = 12 does not displace: the band is a
  // strict `< 12`. Pins the boundary so the band cannot silently widen.
  expect(
    sparklineNewestLabelPlacement({
      pointX: 137,
      pointY: 51,
      midX: 80,
      height: 72,
      referenceLabelY: 33,
    }),
  ).toEqual({ y: 45, anchorEnd: true });
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
