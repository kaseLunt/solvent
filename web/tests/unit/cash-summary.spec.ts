// summarizeCash — the one derivation both the Book and the Overview strip
// print from (spec 2026-09-15 §5.1, §5.2). Rows come from the committed DM
// page through the client's own refinement, exactly as the hook reads them.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { readCashRow } from "../../lib/cash-rows";
import { attentionEmptyText, summarizeCash, unavailableHeadline } from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));
const settled = { walkComplete: true, walkStopped: null, refusedWhole: null } as const;

test("the committed DM page: one material liquidatable row, one refused", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(s.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(s.headline.rest).toBe(" across 1 account.");
  expect(s.material).toEqual({ sum: 4_200_000_000n, count: 1 });
  expect(s.belowLine).toEqual({ sum: 0n, count: 0 });
  expect(s.nearCap).toEqual({ sum: 0n, count: 0 });
  expect(s.notComputed).toBe(1);
  expect(s.computed).toBe(1);
  expect(s.settled).toBe(true);
  expect(s.stopped).toBeNull();
  expect(s.bands.reduce((n, b) => n + b.count, 0)).toBe(1);
});

test("a whole-engine refusal yields the refused headline with the plain cause", () => {
  const s = summarizeCash({
    rows: [],
    decimals: 6,
    refusedPositions: 0,
    walkComplete: true,
    walkStopped: null,
    refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: null },
  });
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.dek).toBe("Collateral-flag custody unproven.");
});

test("an unfinished walk is not settled and headlines the positive it has, as a lower bound", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, refusedWhole: null });
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("material");
  expect(s.headline.dek).toContain("every figure is a lower bound");
});

test("an unfinished walk with no rows is pending — never a quiet verdict, never a near-cap negative", () => {
  const s = summarizeCash({ rows: [], decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, refusedWhole: null });
  expect(s.headline.variant).toBe("pending");
  expect(s.headline.emphasis).toBe("Walking the Cash book…");
  expect(s.headline.dek).not.toContain("No account is within 10%");
  expect(s.headline.dek).not.toContain("No position is liquidatable");
});

test("a stopped walk is named on the summary and in the headline; a complete walk carries no stop", () => {
  const s = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, walkComplete: false, walkStopped: "Failed to fetch", refusedWhole: null });
  expect(s.stopped).toBe("Failed to fetch");
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(s.headline.dek).toContain("Failed to fetch");
  const done = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: true, walkStopped: "stale", refusedWhole: null });
  expect(done.stopped).toBeNull();
  expect(done.headline.variant).toBe("material");
});

test("the attention table's empty line never clears the book over an unfinished walk or a hidden liquidatable position", () => {
  const nothing = { belowLine: { sum: 0n, count: 0 }, decimals: 6 };
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing })).toBe("No account needs attention.");
  expect(attentionEmptyText({ settled: false, stopped: null, ...nothing })).toBe("Walking the book…");
  expect(attentionEmptyText({ settled: false, stopped: "Failed to fetch", ...nothing })).toBe(
    "The walk stopped before the book was read; no account is cleared.",
  );
  expect(attentionEmptyText({ settled: true, stopped: null, belowLine: { sum: 50_000_000n, count: 1 }, decimals: 6 })).toBe(
    "Nothing material needs attention; 1 liquidatable position under $100 ($50) is behind the small & dust toggle.",
  );
  expect(attentionEmptyText({ settled: true, stopped: null, belowLine: { sum: 61_500_000n, count: 3 }, decimals: 6 })).toBe(
    "Nothing material needs attention; 3 liquidatable positions under $100 ($61.50) are behind the small & dust toggle.",
  );
});

test("load failure headline", () => {
  expect(unavailableHeadline("no servable batch").emphasis).toBe("The Cash book could not be loaded.");
  expect(unavailableHeadline("no servable batch").dek).toBe("No servable batch.");
  expect(unavailableHeadline("  ").dek).toBe("The service gave no reason.");
});
