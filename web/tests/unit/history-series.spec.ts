// The null-gap law for the HF history series (lib/history-series.ts), pinned:
// a refused batch is a GAP carrying its named reason; a withheld batch is a
// gap saying "cannot be established"; ∞ has no finite geometry; a WITNESSED
// batch with no row is a NO-ROW gap (ruling 11 — a closed position's absence
// breaks the line); nothing is ever interpolated across any of them.
//
// Plus the SWEEP-MARK law (contract 1.2.1): every Debt Manager point's hover
// title carries the point's OWN persisted sweep watermark — `S <block>`, or
// `S ∅` when 0 (an absent sweep disclosed, never "swept at genesis") — so
// the collateral clock behind the DM `liquidatable` verdict reaches the
// human. Aave has no sweeper and no S mark (book-row marks grammar).

import { expect, test } from "@playwright/test";
import {
  allGapFrameText,
  buildHistorySeries,
  historyTakeaway,
  tallyHistory,
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

// ---------------------------------------------------------------------------
// The sweep-mark law (contract 1.2.1) — the DM verdict's collateral clock
// reaches the hover title; Aave never wears an S mark.
// ---------------------------------------------------------------------------

const REFUSED =
  ENGINE.points[1] ??
  (() => {
    throw new Error("fixture invariant: refused point expected");
  })();
if (REFUSED.status !== "refused") {
  throw new Error("fixture invariant: oldest point is the refused one");
}

/** A Debt Manager series built from the fixture's points (types intact). */
const DM_ENGINE = {
  ...ENGINE,
  engine: "debt_manager",
  value_decimals: 6,
  points: [
    // A swept, liquidatable account: the verdict's own collateral clock.
    { ...COMPUTED, liquidatable: true, sweep_block: 154796490 },
    // A SWEEP_NEVER refusal: sweep_block 0 is the absent sweep, disclosed.
    { ...REFUSED, sweep_block: 0 },
  ],
};

test("a DM point's hover title carries its OWN sweep watermark — S <block>", () => {
  const series = buildHistorySeries(DM_ENGINE);
  const computed = series.entries.find((entry) => entry.kind === "computed");
  expect(computed?.title).toContain("S 154,796,490");
});

test("a DM sweep_block of 0 is S ∅ — an absent sweep disclosed, never 'swept at genesis'", () => {
  const series = buildHistorySeries(DM_ENGINE);
  const refused = series.entries.find((entry) => entry.kind === "refused");
  expect(refused?.title).toContain("REFUSED · G1");
  expect(refused?.title).toContain("S ∅");
  // A COMPUTED point with an unswept clock discloses the same absence.
  const unswept = buildHistorySeries({
    ...DM_ENGINE,
    points: [{ ...COMPUTED, liquidatable: true, sweep_block: 0 }],
  });
  expect(unswept.entries[0]?.title).toContain("S ∅");
});

test("Aave points never carry an S mark — no sweeper, no sweep clock", () => {
  const series = buildHistorySeries(ENGINE);
  for (const title of series.titles) {
    expect(title).not.toContain("· S ");
    expect(title).not.toContain("S ∅");
  }
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

// ---------------------------------------------------------------------------
// W-3L — historyTakeaway: the per-engine takeaway in the entries' OWN display
// strings. Expectations fixture-composed, never the helper echoed back.
// ---------------------------------------------------------------------------

test.describe("W-3L — historyTakeaway", () => {
  test("movement between the first and last PLOTTED points, in their own display strings", () => {
    // Two plotted points: the fixture computed point plus its re-pin at an
    // older batch (the spec-local geometry helper).
    const series = buildHistorySeries({ ...ENGINE, points: [computedAt(3), ...ENGINE.points] });
    const plotted = series.entries.filter((entry) => entry.value !== null);
    const first = plotted[0];
    const last = plotted[plotted.length - 1];
    if (first === undefined || last === undefined || plotted.length < 2) {
      throw new Error("fixture invariant: at least two plotted points expected");
    }
    expect(historyTakeaway(series, "aave_v3_etherfi")).toBe(
      `HF moved ${first.display} → ${last.display} across ${String(plotted.length)} of ` +
        `${String(series.entries.length)} witnessed batches (batches ${String(first.batchId)} → ` +
        `${String(last.batchId)}).`,
    );
  });

  test("the DM arm names the DISCLOSURE ratio, never HF; the unknown arm claims nothing", () => {
    const series = buildHistorySeries(ENGINE);
    expect(historyTakeaway(series, "debt_manager").startsWith("disclosure ratio ")).toBe(true);
    expect(historyTakeaway(series, "debt_manager")).not.toContain("HF");
    expect(historyTakeaway(series, "engine_x").startsWith("plotted series ")).toBe(true);
  });

  test("nothing plotted: the all-gap frame text IS the takeaway — absence at movement's weight", () => {
    const series = buildHistorySeries({ ...ENGINE, points: [], withheld_batch_ids: [1, 2] });
    const tally = tallyHistory(series);
    expect(tally.plotted).toBe(0);
    expect(historyTakeaway(series, "aave_v3_etherfi")).toBe(allGapFrameText(tally));
  });
});
