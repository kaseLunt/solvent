// The null-gap law for the HF history series (lib/history-series.ts), pinned:
// a refused batch is a GAP carrying its named reason; a withheld batch is a
// gap saying "cannot be established"; ∞ has no finite geometry; a WITNESSED
// batch with no row is a NO-ROW gap (ruling 11 — a closed position's absence
// breaks the line); nothing is ever interpolated across any of them.

import { expect, test } from "@playwright/test";
import {
  buildHistorySeries,
  displayHf,
  displayRatio,
  knownBatchAxis,
} from "../../lib/history-series";
import { HISTORY } from "../fixtures/inspector";

const ENGINE = HISTORY.engines[0];
if (ENGINE === undefined) throw new Error("fixture invariant: one engine series expected");

const COMPUTED =
  ENGINE.points[0] ??
  (() => {
    throw new Error("fixture invariant: computed point expected");
  })();
if (COMPUTED.status !== "computed") {
  throw new Error("fixture invariant: newest point is the computed one");
}

/** The fixture's computed point re-pinned to another batch id (test geometry only). */
function computedAt(batchId: number) {
  return { ...COMPUTED, batch_id: batchId };
}

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

// ---------------------------------------------------------------------------
// Ruling 11 — NO-ROW gaps on the witnessed batch axis.
// ---------------------------------------------------------------------------

test("closed mid-window: witnessed batches with no row BREAK the line as no-row gaps", () => {
  // Points at batches 1 and 4; batches 2 and 3 witnessed elsewhere in the
  // response (another engine / the vantage batch). Without ruling 11 the
  // sparkline drew a line straight across the closed span.
  const series = buildHistorySeries(
    { ...ENGINE, points: [computedAt(4), computedAt(1)], withheld_batch_ids: [] },
    [1, 2, 3, 4],
  );
  expect(series.entries.map((entry) => entry.batchId)).toEqual([1, 2, 3, 4]);
  expect(series.values).toEqual([1.08, null, null, 1.08]);
  expect(series.entries[1]?.kind).toBe("no-row");
  expect(series.entries[2]?.kind).toBe("no-row");
  expect(series.titles[1]).toContain("no row in this batch");
  expect(series.titles[1]).toContain("an absence, not a value");
});

test("never absent: an axis equal to the engine's own ids inserts NO phantom gaps", () => {
  const series = buildHistorySeries(ENGINE, [1, 2]);
  expect(series.entries.map((entry) => entry.batchId)).toEqual([1, 2]);
  expect(series.values).toEqual([null, 1.08]);
  expect(series.entries.some((entry) => entry.kind === "no-row")).toBe(false);
});

test("absence at the window edges: gaps at both ends, and `newest` is the no-row gap", () => {
  const series = buildHistorySeries(
    { ...ENGINE, points: [computedAt(3), computedAt(2)], withheld_batch_ids: [] },
    [1, 2, 3, 4],
  );
  expect(series.values).toEqual([null, 1.08, 1.08, null]);
  expect(series.entries[0]?.kind).toBe("no-row");
  expect(series.entries[3]?.kind).toBe("no-row");
  // The newest entry is the ABSENCE — the readout must not carry the stale
  // batch-3 value forward as if it were current.
  expect(series.newest?.kind).toBe("no-row");
  expect(series.newest?.display).toBe("no row");
});

test("withheld precedence: a witnessed id in withheld_batch_ids stays a WITHHELD gap", () => {
  const series = buildHistorySeries({ ...ENGINE, withheld_batch_ids: [3] }, [1, 2, 3]);
  expect(series.entries[2]?.kind).toBe("withheld");
  expect(series.titles[2]).toContain("cannot be established");
});

test("the honest boundary: UNWITNESSED intermediate ids are never fabricated", () => {
  // The wire does not enumerate the retained set — ids 2..8 may or may not
  // exist as retained batches, so no gap is invented for them.
  const series = buildHistorySeries(
    { ...ENGINE, points: [computedAt(9), computedAt(1)], withheld_batch_ids: [] },
    [1, 9],
  );
  expect(series.entries.map((entry) => entry.batchId)).toEqual([1, 9]);
  expect(series.values).toEqual([1.08, 1.08]);
});

test("knownBatchAxis: the union of every engine's points, withheld ids and the vantage batch", () => {
  expect(knownBatchAxis(HISTORY)).toEqual([1, 2]);
  const widened = {
    batch: { id: 7 },
    engines: [
      { points: [{ batch_id: 2 }, { batch_id: 1 }], withheld_batch_ids: [5] },
      { points: [{ batch_id: 6 }], withheld_batch_ids: [] },
    ],
  };
  expect(knownBatchAxis(widened)).toEqual([1, 2, 5, 6, 7]);
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
