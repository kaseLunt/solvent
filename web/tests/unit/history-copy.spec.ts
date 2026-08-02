// Wave R1 item 11 — the HF-history COPY layer, pinned.
//
// THE DEFECT: the panel counted "{n} point(s)" over a chart with no line,
// because every "point" was a gap. The vocabulary now separates what PLOTS
// from what is merely WITNESSED, an engine the account never touched gets a
// sentence instead of an empty frame, and an all-gap engine states its own
// breakdown inside the frame.

import { expect, test } from "@playwright/test";
import {
  allGapFrameText,
  buildHistorySeries,
  DM_DISCLOSURE_LINE,
  engineNeverPresent,
  engineNeverPresentLine,
  HF_HISTORY_HEAD,
  HISTORY_DOCTRINE_LINE,
  HISTORY_DOCTRINE_SUMMARY,
  historyMetaLine,
  tallyHistory,
} from "../../lib/history-series";
import { HISTORY } from "../fixtures/inspector";

const ENGINE = HISTORY.engines[0];
if (ENGINE === undefined) throw new Error("fixture invariant: one engine series expected");

test("the head says what the chart IS", () => {
  expect(HF_HISTORY_HEAD).toBe("Health factor across batches");
});

test("the tally separates what PLOTS from what is merely witnessed", () => {
  // The fixture engine carries one refused point and one computed point.
  const tally = tallyHistory(buildHistorySeries(ENGINE));
  expect(tally.witnessed).toBe(2);
  expect(tally.plotted).toBe(1);
  expect(tally.refused).toBe(1);
  expect(tally.noRow).toBe(0);
  expect(tally.withheld).toBe(0);
});

test("the meta line names plots, witnessed batches, the newest readout and the window", () => {
  const series = buildHistorySeries(ENGINE);
  expect(historyMetaLine(tallyHistory(series), series.newest, ENGINE.engine, 100)).toBe(
    "1 of 2 witnessed batches plot · newest: 1.08 · window: up to 100 batches",
  );
});

test("a NO-ROW newest reads as an absence, naming the engine — never a bare dash", () => {
  // Give the axis a batch this engine has no row in: the newest entry becomes
  // a no-row gap.
  const series = buildHistorySeries(ENGINE, [1, 2, 9]);
  const tally = tallyHistory(series);
  expect(series.newest?.kind).toBe("no-row");
  expect(historyMetaLine(tally, series.newest, ENGINE.engine, 100)).toContain(
    `newest: none — no ${ENGINE.engine} row in the newest witnessed batch`,
  );
});

test("a REFUSED newest keeps its own named display — a refusal is not an absence", () => {
  // points[1] is the fixture's REFUSED point (the wire is newest-first, so
  // points[0] is the computed batch-2 row).
  const refusedOnly = { ...ENGINE, points: [ENGINE.points[1]] } as typeof ENGINE;
  const series = buildHistorySeries(refusedOnly);
  expect(series.newest?.kind).toBe("refused");
  const line = historyMetaLine(tallyHistory(series), series.newest, ENGINE.engine, 100);
  expect(line).toContain("newest: REFUSED · G1");
  expect(line).not.toContain("no row in the newest");
});

test("ENGINE NEVER PRESENT: no point, no withheld batch — one line, no frame", () => {
  const untouched = { ...ENGINE, points: [], withheld_batch_ids: [] } as typeof ENGINE;
  expect(engineNeverPresent(untouched)).toBe(true);
  expect(engineNeverPresent(ENGINE)).toBe(false);
  // A withheld batch is NOT "never present" — the book was hidden, which is a
  // different statement from the account never holding a position.
  expect(engineNeverPresent({ ...ENGINE, points: [], withheld_batch_ids: [4] })).toBe(false);
  expect(engineNeverPresentLine("debt_manager")).toBe(
    "no debt_manager history — this address has never had a debt_manager position in the " +
      "retained window.",
  );
});

test("all-gap: the frame states the breakdown, and a gap is never a zero", () => {
  const allGap = { ...ENGINE, points: [], withheld_batch_ids: [3] } as typeof ENGINE;
  const series = buildHistorySeries(allGap, [1, 2, 3]);
  const tally = tallyHistory(series);
  expect(tally.plotted).toBe(0);
  expect(allGapFrameText(tally)).toBe(
    "nothing plots — all 3 witnessed batches are gaps for this engine (2 no-row · 0 refused · " +
      "1 withheld). A gap is an absence or a refusal, never a zero; hover each tick for its " +
      "named reason.",
  );
});

test("∞/unpublished gaps are counted too — the classes still sum to the witnessed total", () => {
  const tally = {
    witnessed: 4,
    plotted: 0,
    noRow: 1,
    refused: 1,
    withheld: 1,
    other: 1,
  };
  const text = allGapFrameText(tally);
  expect(text).toContain("1 no-row · 1 refused · 1 withheld · 1 ∞/unpublished");
});

test("the doctrine shrinks to ONE visible line; the DM disclosure stays visible", () => {
  expect(HISTORY_DOCTRINE_LINE).toBe(
    "gaps break the line — hover any tick for that batch's named reason.",
  );
  expect(HISTORY_DOCTRINE_SUMMARY).toBe("how gaps and the 1.0 line work");
  expect(DM_DISCLOSURE_LINE).toBe(
    "1.0 here is a disclosure ratio, not the verdict — the engine's own boolean decides.",
  );
});
