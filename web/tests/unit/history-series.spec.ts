// The null-gap law for the HF history series (lib/history-series.ts), pinned:
// a refused batch is a GAP carrying its named reason; a withheld batch is a
// gap saying "cannot be established"; ∞ has no finite geometry; nothing is
// ever interpolated across any of them.

import { expect, test } from "@playwright/test";
import { buildHistorySeries, displayHf, displayRatio } from "../../lib/history-series";
import { HISTORY } from "../fixtures/inspector";

const ENGINE = HISTORY.engines[0];
if (ENGINE === undefined) throw new Error("fixture invariant: one engine series expected");

test("a refused point is a GAP carrying its named refusal — never a value", () => {
  const series = buildHistorySeries(ENGINE);
  // Oldest first: batch 1 (refused) then batch 2 (computed).
  expect(series.entries.map((entry) => entry.batchId)).toEqual([1, 2]);
  expect(series.values).toEqual([null, 1.08]);
  expect(series.entries[0]?.kind).toBe("refused");
  expect(series.titles[0]).toContain("REFUSED · G1");
  expect(series.titles[0]).toContain("weETH/aaveoracle price input missing at compute time");
  expect(series.newest?.display).toBe("1.08");
});

test("a withheld batch is a gap saying cannot-be-established, on the batch axis", () => {
  const series = buildHistorySeries({ ...ENGINE, withheld_batch_ids: [3] });
  expect(series.values).toEqual([null, 1.08, null]);
  expect(series.entries[2]?.kind).toBe("withheld");
  expect(series.titles[2]).toContain("withheld");
  expect(series.titles[2]).toContain("cannot be established");
});

test("∞ (no debt) is a gap, never a plotted number", () => {
  const computed = ENGINE.points[0];
  if (computed === undefined) throw new Error("fixture invariant: computed point expected");
  const infinitePoint = {
    ...computed,
    batch_id: 5,
    health_factor: { wad: null, num: null, den: null, infinite: true, note: "no debt" },
  };
  const series = buildHistorySeries({ ...ENGINE, points: [infinitePoint, ...ENGINE.points] });
  const entry = series.entries.find((candidate) => candidate.batchId === 5);
  expect(entry?.kind).toBe("infinite");
  expect(entry?.value).toBeNull();
  expect(entry?.display).toBe("∞");
});

test("displayRatio prefers the wad and falls back to num/den at display precision", () => {
  const note = "";
  expect(displayRatio({ wad: "1080000000000000000", num: null, den: null, infinite: false, note })).toBe(1.08);
  expect(
    displayRatio({ wad: null, num: "6480000000000000", den: "6000000000000000", infinite: false, note }),
  ).toBe(1.08);
  expect(displayRatio({ wad: null, num: null, den: null, infinite: false, note })).toBeNull();
  expect(displayRatio({ wad: null, num: "1", den: "0", infinite: false, note })).toBeNull();
});

test("displayHf: exact trimmed wad; num/den marked approximate; ∞ verbatim", () => {
  const note = "";
  expect(displayHf({ wad: "1080000000000000000", num: null, den: null, infinite: false, note })).toBe("1.08");
  expect(
    displayHf({ wad: null, num: "6480000000000000", den: "6000000000000000", infinite: false, note }),
  ).toBe("≈1.0800");
  expect(displayHf({ wad: null, num: null, den: null, infinite: true, note })).toBe("∞");
});
