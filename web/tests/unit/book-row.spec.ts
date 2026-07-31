// The Book row view model + display helpers, pinned (W1; C2 swapped the
// source to the wire's lean PositionSummary).
//
// Laws under test:
//   - `toPositionRow` maps REFINED wire PositionSummary rows (the same
//     `refinePositionSummary` the client's primary positions() path applies)
//     to the row model without inventing anything: refused rows keep null
//     totals and an UNKNOWABLE verdict; the DM's sealed verdict is the ONLY
//     source of a DM crit; Aave's verdict comes from the wad comparator.
//   - display strings are exact-derived (string/bigint surgery, truncation
//     never rounding) — "1.08" from the wad, "0.761" from the DM disclosure,
//     "−7.4%" from the factor solve.
//   - marks grammar: aave has no S mark; a DM sweep_block of 0 is S ∅
//     (absent, visible), never a dropped mark.

import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { factorDistancePercent, groupDecimalString, hfDisplayFromRatio, hfDisplayFromWad, renderEngineAmount } from "../../lib/book-format";
import { EM_DASH } from "../../lib/format";
import { toPositionRow } from "../../app/book/positionRow";
import {
  POSITIONS_AAVE_PAGE_1,
  POSITIONS_AAVE_PAGE_2,
  POSITIONS_DM_PAGE_1,
} from "../fixtures/book";

test.describe("book-format", () => {
  test("groupDecimalString is string surgery only", () => {
    expect(groupDecimalString("4200000")).toBe("4,200,000");
    expect(groupDecimalString("4200000.123456")).toBe("4,200,000.123456");
    expect(groupDecimalString("−7.5")).toBe("−7.5");
    expect(groupDecimalString("123")).toBe("123");
  });

  test("renderEngineAmount: null is an em dash, never 0", () => {
    expect(renderEngineAmount(null, 8)).toBe(EM_DASH);
    expect(renderEngineAmount("800000000000", 8)).toBe("8,000");
    expect(renderEngineAmount("4200000000", 6)).toBe("4,200");
  });

  test("hf displays truncate (never round) and derive exactly", () => {
    expect(hfDisplayFromWad("1080000000000000000")).toBe("1.08");
    // 1.0439999... truncates to 1.043 — understating health, the conservative direction.
    expect(hfDisplayFromWad("1043999999999999999")).toBe("1.043");
    expect(hfDisplayFromRatio(3200000000n, 4200000000n)).toBe("0.761");
    expect(hfDisplayFromRatio(1n, 0n)).toBeNull();
  });

  test("factorDistancePercent: signed, one truncated fraction digit", () => {
    // The contract example's factor solve: 6000/6480 → −7.5%.
    expect(factorDistancePercent(6000000000000000n, 6480000000000000n)).toBe("−7.5%");
    expect(factorDistancePercent(1n, 0n)).toBeNull();
  });
});

test.describe("toPositionRow — the PositionSummary mapping", () => {
  // The wire fixtures are RAW summaries; the client's primary path refines
  // them before any component sees a row, so the spec applies the same seal.
  const aaveComputed = POSITIONS_AAVE_PAGE_1.positions[0];
  const aaveRefused = POSITIONS_AAVE_PAGE_2.positions[0];
  const dmLiquidatable = POSITIONS_DM_PAGE_1.positions[0];
  const dmRefused = POSITIONS_DM_PAGE_1.positions[1];

  test("aave computed: wad comparator verdict, warn-band ratio, factor distance", () => {
    if (aaveComputed === undefined) throw new Error("fixture lost its aave row");
    const row = toPositionRow(refinePositionSummary(aaveComputed));
    expect(row.verdict).toBe("not-liquidatable"); // 1.08e18 >= 1e18, ON THE WAD
    expect(row.hf.display).toBe("1.08");
    expect(row.hf.ratio).toBeCloseTo(1.08, 6); // display-precision, warn band only
    expect(row.hf.disclosureOnly).toBe(false);
    expect(row.totals.collateral).toBe("800000000000");
    expect(row.totals.debt).toBe("600000000000");
    expect(row.liqDistance).toEqual({ kind: "distance", display: "−7.5%", assetLabel: "weETH" });
    // No sweeper on this engine: B and P only, no S mark at all.
    expect(row.marks).toEqual([
      { letter: "B", block: 25635618 },
      { letter: "P", block: 25635600 },
    ]);
  });

  test("aave refused: verdict UNKNOWABLE, totals stay null, refusal named", () => {
    if (aaveRefused === undefined) throw new Error("fixture lost its refused aave row");
    const row = toPositionRow(refinePositionSummary(aaveRefused));
    expect(row.status).toBe("refused");
    expect(row.refusalCode).toBe("G1");
    expect(row.verdict).toBe("unknowable"); // NEVER 'not-liquidatable'
    expect(row.hf.display).toBeNull();
    expect(row.totals.collateral).toBeNull(); // null stays null — em dash downstream, not 0
    expect(row.totals.debt).toBeNull();
    expect(row.liqDistance.kind).toBe("none");
  });

  test("dm liquidatable: crit from the engine's strict boolean, hf is a labeled disclosure", () => {
    if (dmLiquidatable === undefined) throw new Error("fixture lost its dm row");
    const row = toPositionRow(refinePositionSummary(dmLiquidatable));
    expect(row.verdict).toBe("liquidatable"); // the strict boolean, not a ratio re-derivation
    expect(row.hf.disclosureOnly).toBe(true);
    expect(row.hf.display).toBe("0.761"); // maxBorrowLT/borrowings, truncated
    expect(row.liqDistance.kind).toBe("breached");
    // DM totals come from the engine's own fields (usd 6-dec).
    expect(row.totals.collateral).toBe("4000000000");
    expect(row.totals.debt).toBe("4200000000");
    expect(row.totals.decimals).toBe(6);
    // The DM has a sweeper: S carries its own block.
    expect(row.marks).toEqual([
      { letter: "B", block: 154796552 },
      { letter: "P", block: 154796552 },
      { letter: "S", block: 154796500 },
    ]);
  });

  test("dm refused (SWEEP_NEVER): S mark is ABSENT (∅), visible — never dropped", () => {
    if (dmRefused === undefined) throw new Error("fixture lost its refused dm row");
    const row = toPositionRow(refinePositionSummary(dmRefused));
    expect(row.refusalCode).toBe("SWEEP_NEVER");
    expect(row.verdict).toBe("unknowable");
    expect(row.marks).toEqual([
      { letter: "B", block: 154796552 },
      { letter: "P", block: 154796552 },
      { letter: "S", block: null }, // renders S ∅
    ]);
  });
});
