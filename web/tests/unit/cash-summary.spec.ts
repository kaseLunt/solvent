// summarizeCash — the one derivation both the Book and the Overview strip
// print from (spec 2026-09-15 §5.1, §5.2). Rows come from the committed DM
// page through the client's own refinement, exactly as the hook reads them.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { readCashRow } from "../../lib/cash-rows";
import { summarizeCash, unavailableHeadline } from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));

test("the committed DM page: one material liquidatable row, one refused", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: true, refusedWhole: null });
  expect(s.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(s.headline.rest).toBe(" across 1 account.");
  expect(s.material).toEqual({ sum: 4_200_000_000n, count: 1 });
  expect(s.belowLine).toEqual({ sum: 0n, count: 0 });
  expect(s.nearCap).toEqual({ sum: 0n, count: 0 });
  expect(s.notComputed).toBe(1);
  expect(s.settled).toBe(true);
  expect(s.bands.reduce((n, b) => n + b.count, 0)).toBe(1);
});

test("a whole-engine refusal yields the refused headline with the plain cause", () => {
  const s = summarizeCash({
    rows: [],
    decimals: 6,
    refusedPositions: 0,
    walkComplete: true,
    refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: null },
  });
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.dek).toBe("Collateral-flag custody unproven.");
});

test("an unfinished walk is not settled and headlines what it has", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, refusedWhole: null });
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("material");
});

test("load failure headline", () => {
  expect(unavailableHeadline("no servable batch").emphasis).toBe("The Cash book could not be loaded.");
  expect(unavailableHeadline("no servable batch").dek).toBe("No servable batch.");
  expect(unavailableHeadline("  ").dek).toBe("The service gave no reason.");
});
