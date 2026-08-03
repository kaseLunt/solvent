// The full-book bin module's pins.
//
// W-HR-A CHANGED THE Y AXIS. The bins were keyed on liquidation distance —
// "how far must the committed price axis fall" — which does not exist for a
// stable-collateral account, so the majority of the book fell into a `never`
// aside and the map drew the minority. The y axis is now the seven HEADROOM
// bands, native to both engines, so the accounts nearest the boundary are on
// the grid instead of beside it.
//
// Laws under test (the ruling's own unit-spec pins):
//   - CRIT NEVER BINNED: a row with verdict === "liquidatable" passes through
//     as an unbinned point; no bin ever counts it.
//   - EXHAUSTIVE OR ASIDE: every row lands in exactly one bin, or in the
//     crit pass-through, or in the counted aside — Σ bins + crit + aside
//     equals the row count, always.
//   - BAND ASSIGNMENT over a mixed book follows lib/headroom's exact bigint
//     edges, and a breached account is never averaged into a live band.
//   - Σ DEBT IS EXACT per bin and per band — bigint, in the engine's own unit.
//   - DETERMINISTIC: the same rows in any order produce the identical result.
//   - the 4-step count-opacity ramp is quantized at 1/10/100/1000 — stepped,
//     never a gradient.
//   - top-12 debt outliers are named (truncated address), ranked by exact
//     debt (bigint, never a float).
//   - sub-dollar decades are mono-scientific ("$1e-3"), never cent notation.

import { expect, test } from "@playwright/test";
import {
  buildRiskBins,
  HEADROOM_BANDS,
  OPACITY_LEGEND,
  opacityStep,
  usdExponentLabel,
} from "../../app/book/riskBins";
import {
  headroomBand,
  headroomBelowWarn,
  headroomBreached,
  headroomPercent,
} from "../../lib/headroom";
import type { PositionRow, RowHeadroom } from "../../app/book/positionRow";

let seq = 0;

/** The row's headroom arm, derived the SAME way positionRow derives it. */
function hr(num: bigint, den: bigint): RowHeadroom {
  const band = headroomBand(num, den);
  if (band === null) return { kind: "unknown", reason: null };
  const breached = headroomBreached(num, den);
  return {
    kind: "headroom",
    display: headroomPercent(num, den),
    band,
    breached,
    belowWarn: headroomBelowWarn(num, den),
  };
}

/** A pair whose headroom is exactly `pct` percent (integers, no float). */
function atPercent(pct: number): { num: bigint; den: bigint } {
  const num = 10000n;
  return { num, den: num - BigInt(Math.round(pct * 100)) };
}

interface RowOptions {
  account?: string;
  debt?: string | null;
  decimals?: number;
  verdict?: PositionRow["verdict"];
  status?: "computed" | "refused";
  headroom?: RowHeadroom;
}

function makeRow(options: RowOptions = {}): PositionRow {
  seq += 1;
  const pair = atPercent(7.5); // the default row sits in the 5–10% band
  return {
    engine: "aave_v3_etherfi",
    account: options.account ?? `0x${String(seq).padStart(40, "0")}`,
    status: options.status ?? "computed",
    refusalCode: null,
    refusalDetail: null,
    hf: { display: null, ratio: null, infinite: false, disclosureOnly: false },
    verdict: options.verdict ?? "not-liquidatable",
    totals: {
      collateral: null,
      debt: options.debt === undefined ? "15000000000" : options.debt, // $150 @ 8dp
      decimals: options.decimals ?? 8,
    },
    liqDistance: { kind: "distance", display: "−7.5%", assetLabel: null },
    headroom: options.headroom ?? hr(pair.num, pair.den),
    marks: [],
    flags: [],
  };
}

function headroomAt(pct: number): RowHeadroom {
  const pair = atPercent(pct);
  return hr(pair.num, pair.den);
}

/** A breached row: debt strictly above the threshold (the DM fixture's pair). */
function breached(): RowHeadroom {
  return hr(3200000000n, 4200000000n); // −31.3% headroom
}

function binTotal(result: ReturnType<typeof buildRiskBins>): number {
  return result.bins.reduce((sum, bin) => sum + bin.count, 0);
}

test.describe("crit is never binned", () => {
  test("liquidatable rows pass through as unbinned points; bins exclude them", () => {
    const rows = [
      makeRow({ verdict: "liquidatable", headroom: breached(), debt: "220000000000000" }),
      makeRow({ verdict: "liquidatable", headroom: breached() }),
      makeRow(),
      makeRow(),
    ];
    const result = buildRiskBins(rows);
    expect(result.crit).toHaveLength(2);
    expect(binTotal(result)).toBe(2);
    expect(result.aside.total).toBe(0);
    expect(binTotal(result) + result.crit.length + result.aside.total).toBe(rows.length);
  });

  test("crit points keep exact-debt titles — the table's renderer, never a float", () => {
    const account = "0x3c190000000000000000000000000000000088af";
    const result = buildRiskBins([
      makeRow({
        account,
        verdict: "liquidatable",
        headroom: breached(),
        debt: "220000000000000",
      }),
    ]);
    expect(result.crit[0]?.title).toBe(
      "0x3c19…88af · debt 2,200,000 · headroom −31.3% · liquidatable",
    );
    // Crit lives on the breached band, on top — never inside a bin rect.
    expect(result.crit[0]?.band).toBe(0);
    expect(result.bins).toHaveLength(0);
  });

  test("a breached account without a crit verdict is BINNED on the breached row — visible, never averaged into a live band", () => {
    const result = buildRiskBins([makeRow({ headroom: breached() })]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.band).toBe(0);
    expect(result.crit).toHaveLength(0); // crit is the ENGINE's verdict only
  });
});

test.describe("exhaustive-or-aside", () => {
  test("every row lands in exactly one bin, the crit pass-through, or the counted aside", () => {
    const rows = [
      makeRow({ headroom: headroomAt(7.5) }),
      makeRow({ headroom: headroomAt(32) }),
      makeRow({ headroom: breached() }), // breached WITHOUT a crit verdict: binned
      makeRow({ headroom: { kind: "no-debt" } }),
      makeRow({ headroom: { kind: "unknown", reason: null } }),
      makeRow({
        status: "refused",
        verdict: "unknowable",
        debt: null,
        headroom: { kind: "unknown", reason: "G1" },
      }),
      makeRow({ debt: null }), // computed, banded, but unplottable on a log axis
      makeRow({ verdict: "liquidatable", headroom: breached() }),
      makeRow({ verdict: "liquidatable", headroom: breached(), debt: "0" }), // crit, no positive debt
    ];
    const result = buildRiskBins(rows);
    expect(binTotal(result)).toBe(3);
    expect(result.crit).toHaveLength(1);
    expect(result.aside).toEqual({ noDebt: 1, unknown: 1, refused: 1, unplottable: 2, total: 5 });
    expect(binTotal(result) + result.crit.length + result.aside.total).toBe(rows.length);
    expect(result.total).toBe(rows.length);
  });

  test("a refused row is counted as refused whatever else it carries", () => {
    const result = buildRiskBins([
      makeRow({ status: "refused", verdict: "unknowable", headroom: headroomAt(7.5) }),
    ]);
    expect(result.aside.refused).toBe(1);
    expect(result.bins).toHaveLength(0);
    expect(result.crit).toHaveLength(0);
  });
});

test.describe("band assignment over a mixed book", () => {
  test("each headroom lands in its own band, and the bands read in reader words", () => {
    const cases: [number, string][] = [
      [0.5, "0–2%"],
      [1.99, "0–2%"],
      [2, "2–5%"],
      [4.99, "2–5%"],
      [5, "5–10%"],
      [9.99, "5–10%"],
      [10, "10–25%"],
      [24.99, "10–25%"],
      [25, "25–50%"],
      [49.99, "25–50%"],
      [50, ">50%"],
      [93.7, ">50%"],
    ];
    for (const [pct, label] of cases) {
      const result = buildRiskBins([makeRow({ headroom: headroomAt(pct) })]);
      const band = result.bins[0]?.band;
      expect(band, `headroom ${String(pct)}%`).not.toBeUndefined();
      expect(HEADROOM_BANDS[band ?? -1]?.label, `headroom ${String(pct)}%`).toBe(label);
    }
  });

  test("a mixed book fills every band, and the marginals partition the rows", () => {
    const rows = [
      makeRow({ headroom: breached() }),
      makeRow({ headroom: headroomAt(1) }),
      makeRow({ headroom: headroomAt(3) }),
      makeRow({ headroom: headroomAt(7) }),
      makeRow({ headroom: headroomAt(20) }),
      makeRow({ headroom: headroomAt(40) }),
      makeRow({ headroom: headroomAt(80) }),
    ];
    const result = buildRiskBins(rows);
    expect(result.bandTotals).toHaveLength(HEADROOM_BANDS.length);
    expect(result.bandTotals.map((marginal) => marginal.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    // Σ over the marginals equals the plotted rows — nothing double-counted.
    const marginalTotal = result.bandTotals.reduce((sum, marginal) => sum + marginal.count, 0);
    expect(marginalTotal).toBe(binTotal(result) + result.crit.length);
  });
});

test.describe("Σ debt — exact bigint, per bin and per band", () => {
  test("the bin's Σ is the exact sum of its rows' debts", () => {
    const result = buildRiskBins([
      makeRow({ headroom: headroomAt(7.5), debt: "15000000000" }), // $150
      makeRow({ headroom: headroomAt(6), debt: "20000000000" }), // $200
    ]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.debt).toBe(35000000000n);
    expect(result.bins[0]?.title).toBe(
      "2 accounts · debt $100–$316 · headroom 5–10% · Σ debt 350 · " +
        "5–10% of borrowing capacity left before liquidation",
    );
  });

  test("the band marginal sums ACROSS debt columns — count and Σ, with the band's meaning", () => {
    const result = buildRiskBins([
      makeRow({ headroom: headroomAt(7.5), debt: "15000000000" }), // $150
      makeRow({ headroom: headroomAt(7.5), debt: "600000000000000" }), // $6,000,000
    ]);
    const marginal = result.bandTotals[3];
    expect(marginal?.count).toBe(2);
    expect(marginal?.debt).toBe(600015000000000n);
    expect(marginal?.debtDisplay).toBe("6,000,150");
    expect(marginal?.title).toBe(
      "2 accounts at headroom 5–10% · Σ debt 6,000,150 · " +
        "5–10% of borrowing capacity left before liquidation",
    );
  });

  test("a crit row's debt counts toward its band's Σ — crit is unbinned, never uncounted", () => {
    const result = buildRiskBins([
      makeRow({ verdict: "liquidatable", headroom: breached(), debt: "220000000000000" }),
    ]);
    expect(result.bandTotals[0]?.count).toBe(1);
    expect(result.bandTotals[0]?.debt).toBe(220000000000000n);
  });

  test("an empty band states a true zero, not an em dash — the walk covered it", () => {
    const result = buildRiskBins([makeRow({ headroom: headroomAt(7.5) })]);
    expect(result.bandTotals[6]?.count).toBe(0);
    expect(result.bandTotals[6]?.debt).toBe(0n);
    expect(result.bandTotals[6]?.debtDisplay).toBe("0");
  });
});

test.describe("deterministic output", () => {
  test("the same rows in any order produce the identical result", () => {
    const rows = [
      makeRow({ headroom: headroomAt(7.5), debt: "15000000000" }),
      makeRow({ headroom: headroomAt(2), debt: "990000000000" }),
      makeRow({ verdict: "liquidatable", headroom: breached(), debt: "220000000000000" }),
      makeRow({ headroom: { kind: "no-debt" } }),
      makeRow({
        status: "refused",
        verdict: "unknowable",
        debt: null,
        headroom: { kind: "unknown", reason: "G1" },
      }),
      makeRow({ headroom: headroomAt(7.6), debt: "15100000000" }),
    ];
    const shuffled = [rows[3], rows[5], rows[0], rows[4], rows[2], rows[1]].filter(
      (row): row is PositionRow => row !== undefined,
    );
    expect(buildRiskBins(shuffled)).toEqual(buildRiskBins(rows));
  });
});

test.describe("the 4-step count-opacity ramp", () => {
  test("quantized at 1/10/100/1000 — stepped, never a gradient", () => {
    expect(opacityStep(1)).toBe(1);
    expect(opacityStep(9)).toBe(1);
    expect(opacityStep(10)).toBe(2);
    expect(opacityStep(99)).toBe(2);
    expect(opacityStep(100)).toBe(3);
    expect(opacityStep(999)).toBe(3);
    expect(opacityStep(1000)).toBe(4);
    expect(opacityStep(50000)).toBe(4);
  });

  test("a built bin carries its quantized step", () => {
    const rows = Array.from({ length: 10 }, () => makeRow());
    const result = buildRiskBins(rows);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.count).toBe(10);
    expect(result.bins[0]?.step).toBe(2);
  });

  test("the legend copy is the ruling's, verbatim", () => {
    expect(OPACITY_LEGEND).toBe("1 · 10 · 100 · 1,000 accounts");
  });
});

test.describe("top-12 debt outliers", () => {
  test("named by truncated address, ranked by exact debt, capped at 12", () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      makeRow({
        account: `0xaaa${String(index).padStart(37, "0")}`,
        // Distinct exact debts: (index+1) × $1,000 at 8dp.
        debt: `${String(index + 1)}00000000000`,
      }),
    );
    const result = buildRiskBins(rows);
    expect(result.outliers).toHaveLength(12);
    // Ranked by debt DESC: the two smallest ($1,000 and $2,000) are absent.
    const labeled = result.outliers.map((outlier) => outlier.account);
    expect(labeled).not.toContain(rows[0]?.account);
    expect(labeled).not.toContain(rows[1]?.account);
    expect(result.outliers[0]?.account).toBe(rows[13]?.account);
    // The direct label is the truncated address.
    expect(result.outliers[0]?.label).toBe("0xaaa0…0013");
  });

  test("crit rows compete for the outlier labels too — they are plotted rows", () => {
    const whale = makeRow({
      account: "0xbbb0000000000000000000000000000000000001",
      verdict: "liquidatable",
      headroom: breached(),
      debt: "990000000000000", // $9.9M — the biggest debt on the map
    });
    const result = buildRiskBins([whale, makeRow()]);
    expect(result.outliers[0]?.account).toBe(whale.account);
    expect(result.outliers[0]?.band).toBe(0);
  });
});

test.describe("the USD half-decade axis", () => {
  test("a single account reads singular", () => {
    const result = buildRiskBins([makeRow({ debt: "15000000000" })]);
    expect(result.bins[0]?.title).toContain("1 account · debt $100–$316 · headroom 5–10%");
  });

  test("exact powers land on the LOWER edge of their half-decade", () => {
    // $100 exactly → [$100, $316), never [$32, $100).
    const result = buildRiskBins([makeRow({ debt: "10000000000" })]);
    expect(result.bins[0]?.title).toContain("debt $100–$316");
  });

  test("decade labels: named power vocabulary above $1, mono-scientific below", () => {
    expect(usdExponentLabel(0)).toBe("$1");
    expect(usdExponentLabel(1)).toBe("$10");
    expect(usdExponentLabel(2)).toBe("$100");
    expect(usdExponentLabel(3)).toBe("$1k");
    expect(usdExponentLabel(4)).toBe("$10k");
    expect(usdExponentLabel(5)).toBe("$100k");
    expect(usdExponentLabel(6)).toBe("$1M");
    expect(usdExponentLabel(9)).toBe("$1B");
    // Sub-dollar decades: mono-scientific, NEVER invented cent notation.
    expect(usdExponentLabel(-3)).toBe("$1e-3");
    expect(usdExponentLabel(-6)).toBe("$1e-6");
    // Half-decade edges: the rounded exact power, grouped.
    expect(usdExponentLabel(2.5)).toBe("$316");
    expect(usdExponentLabel(3.5)).toBe("$3,162");
  });

  test("sub-dollar rows bin honestly on the same log axis", () => {
    // $0.005 at 6dp → log10 ≈ −2.3 → half-decade [−2.5, −2).
    const result = buildRiskBins([makeRow({ debt: "5000", decimals: 6 })]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.title).toContain("1 account · debt $3.2e-3–$1e-2 · headroom 5–10%");
  });

  test("the domain spans the data's true decades", () => {
    const result = buildRiskBins([
      makeRow({ debt: "15000000000" }), // $150 → [2, 2.5)
      makeRow({ headroom: headroomAt(2), debt: "600000000000000" }), // $6M → [6.5, 7)
    ]);
    expect(result.xMinExp).toBe(2);
    expect(result.xMaxExp).toBe(7);
  });

  test("the engine's decimals travel with the result — the Σ unit is never guessed", () => {
    expect(buildRiskBins([makeRow({ decimals: 6 })]).decimals).toBe(6);
    expect(buildRiskBins([]).decimals).toBe(0);
  });
});
