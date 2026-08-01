// W-UX-D (charts supplement §16) — the pure bin module's pins.
//
// Laws under test (the ruling's own unit-spec pins):
//   - CRIT NEVER BINNED: a row with verdict === "liquidatable" passes through
//     as an unbinned point; no bin ever counts it.
//   - EXHAUSTIVE OR ASIDE: every row lands in exactly one bin, or in the
//     crit pass-through, or in the counted aside — Σ bins + crit + aside
//     equals the row count, always.
//   - DETERMINISTIC: the same rows in any order produce the identical result.
//   - the 4-step count-opacity ramp is quantized at 1/10/100/1000 — stepped,
//     never a gradient.
//   - top-12 debt outliers are named (truncated address), ranked by exact
//     debt (bigint, never a float).
//   - bin titles carry the exact grammar: "2 accounts · debt $100–$316 · −5…−10%".
//   - sub-dollar decades are mono-scientific ("$1e-3"), never cent notation.

import { expect, test } from "@playwright/test";
import {
  buildRiskBins,
  DISTANCE_BANDS,
  OPACITY_LEGEND,
  opacityStep,
  usdExponentLabel,
} from "../../app/book/riskBins";
import type { PositionRow, RowLiqDistance } from "../../app/book/positionRow";

let seq = 0;

interface RowOptions {
  account?: string;
  debt?: string | null;
  decimals?: number;
  verdict?: PositionRow["verdict"];
  status?: "computed" | "refused";
  liq?: RowLiqDistance;
}

function makeRow(options: RowOptions = {}): PositionRow {
  seq += 1;
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
    liqDistance: options.liq ?? { kind: "distance", display: "−7.5%", assetLabel: null },
    marks: [],
    flags: [],
  };
}

function distance(display: string): RowLiqDistance {
  return { kind: "distance", display, assetLabel: null };
}

function binTotal(result: ReturnType<typeof buildRiskBins>): number {
  return result.bins.reduce((sum, bin) => sum + bin.count, 0);
}

test.describe("crit is never binned", () => {
  test("liquidatable rows pass through as unbinned points; bins exclude them", () => {
    const rows = [
      makeRow({ verdict: "liquidatable", liq: { kind: "breached" }, debt: "220000000000000" }),
      makeRow({ verdict: "liquidatable", liq: { kind: "breached" } }),
      makeRow({ liq: distance("−7.5%") }),
      makeRow({ liq: distance("−7.5%") }),
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
      makeRow({ account, verdict: "liquidatable", liq: { kind: "breached" }, debt: "220000000000000" }),
    ]);
    expect(result.crit[0]?.title).toBe("0x3c19…88af · debt 2,200,000 · liquidatable");
    // Crit lives on the breached band, on top — never inside a bin rect.
    expect(result.crit[0]?.band).toBe(0);
    expect(result.bins).toHaveLength(0);
  });
});

test.describe("exhaustive-or-aside", () => {
  test("every row lands in exactly one bin, the crit pass-through, or the counted aside", () => {
    const rows = [
      makeRow({ liq: distance("−7.5%") }),
      makeRow({ liq: distance("−32%") }),
      makeRow({ liq: { kind: "breached" } }), // breached WITHOUT a crit verdict: binned on the breached band
      makeRow({ liq: { kind: "never", reason: "no debt" } }),
      makeRow({ liq: { kind: "none", reason: "no factor solve" } }),
      makeRow({ status: "refused", verdict: "unknowable", debt: null, liq: { kind: "none", reason: null } }),
      makeRow({ debt: null }), // computed but unpriceable — counted, not dropped
      makeRow({ verdict: "liquidatable", liq: { kind: "breached" } }),
      makeRow({ verdict: "liquidatable", liq: { kind: "breached" }, debt: "0" }), // crit with no positive debt
    ];
    const result = buildRiskBins(rows);
    expect(binTotal(result)).toBe(3);
    expect(result.crit).toHaveLength(1);
    expect(result.aside).toEqual({ never: 1, none: 1, refused: 1, unplottable: 2, total: 5 });
    expect(binTotal(result) + result.crit.length + result.aside.total).toBe(rows.length);
    expect(result.total).toBe(rows.length);
  });

  test("band edges: −5 stays in 0…−5%, −5.1 falls to −5…−10%, and so on down", () => {
    const cases: [string, string][] = [
      ["−0.1%", "0…−5%"],
      ["−5%", "0…−5%"],
      ["−5.1%", "−5…−10%"],
      ["−10%", "−5…−10%"],
      ["−10.1%", "−10…−25%"],
      ["−25%", "−10…−25%"],
      ["−25.1%", "−25…−50%"],
      ["−50%", "−25…−50%"],
      ["−50.1%", "<−50%"],
    ];
    for (const [display, bandLabel] of cases) {
      const result = buildRiskBins([makeRow({ liq: distance(display) })]);
      const band = result.bins[0]?.band;
      expect(band).not.toBeUndefined();
      expect(DISTANCE_BANDS[band ?? -1]?.label).toBe(bandLabel);
    }
  });
});

test.describe("deterministic output", () => {
  test("the same rows in any order produce the identical result", () => {
    const rows = [
      makeRow({ liq: distance("−7.5%"), debt: "15000000000" }),
      makeRow({ liq: distance("−2%"), debt: "990000000000" }),
      makeRow({ verdict: "liquidatable", liq: { kind: "breached" }, debt: "220000000000000" }),
      makeRow({ liq: { kind: "never", reason: null } }),
      makeRow({ status: "refused", verdict: "unknowable", debt: null, liq: { kind: "none", reason: null } }),
      makeRow({ liq: distance("−7.6%"), debt: "15100000000" }),
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
    const rows = Array.from({ length: 10 }, () => makeRow({ liq: distance("−7.5%") }));
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
        liq: distance("−7.5%"),
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
      liq: { kind: "breached" },
      debt: "990000000000000", // $9.9M — the biggest debt on the map
    });
    const result = buildRiskBins([whale, makeRow({ liq: distance("−7.5%") })]);
    expect(result.outliers[0]?.account).toBe(whale.account);
    expect(result.outliers[0]?.band).toBe(0);
  });
});

test.describe("bin grammar and the USD half-decade axis", () => {
  test('per-bin title: "2 accounts · debt $100–$316 · −5…−10%"', () => {
    const rows = [
      makeRow({ liq: distance("−7.5%"), debt: "15000000000" }), // $150
      makeRow({ liq: distance("−6%"), debt: "20000000000" }), // $200
    ];
    const result = buildRiskBins(rows);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.title).toBe("2 accounts · debt $100–$316 · −5…−10%");
  });

  test("a single account reads singular", () => {
    const result = buildRiskBins([makeRow({ liq: distance("−7.5%"), debt: "15000000000" })]);
    expect(result.bins[0]?.title).toBe("1 account · debt $100–$316 · −5…−10%");
  });

  test("exact powers land on the LOWER edge of their half-decade", () => {
    // $100 exactly → [$100, $316), never [$32, $100).
    const result = buildRiskBins([makeRow({ liq: distance("−7.5%"), debt: "10000000000" })]);
    expect(result.bins[0]?.title).toBe("1 account · debt $100–$316 · −5…−10%");
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
    const result = buildRiskBins([
      makeRow({ liq: distance("−7.5%"), debt: "5000", decimals: 6 }),
    ]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.title).toBe("1 account · debt $3.2e-3–$1e-2 · −5…−10%");
  });

  test("the domain spans the data's true decades", () => {
    const result = buildRiskBins([
      makeRow({ liq: distance("−7.5%"), debt: "15000000000" }), // $150 → [2, 2.5)
      makeRow({ liq: distance("−2%"), debt: "600000000000000" }), // $6M → [6.5, 7)
    ]);
    expect(result.xMinExp).toBe(2);
    expect(result.xMaxExp).toBe(7);
  });
});
