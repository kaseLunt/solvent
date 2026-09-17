// web/tests/unit/cash-rows.spec.ts
import { expect, test } from "@playwright/test";
import { refinePositionsResponse, type RefinedPositionsResponse } from "@solvent/client";
import {
  liquidatableRows,
  nearCapRows,
  notComputedCause,
  readCashPage,
  readCashRow,
  roomBands,
  roomPercentiles,
  sumDebt,
  type CashWireRow,
} from "../../lib/cash-rows";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";

function row(over: Partial<CashWireRow> & { account: string }): CashWireRow {
  return {
    engine: "debt_manager",
    status: "computed",
    value_decimals: 6,
    refusal: null,
    flags: [],
    health_factor: { wad: null, num: "4804000000", den: "4620000000", infinite: false, note: "" },
    liquidation_verdict: "not-liquidatable",
    total_collateral: "12050000000",
    total_debt: "4620000000",
    liq_distance: { kind: "distance", scale_factor_num: "1", scale_factor_den: "1", factor_asset: "weETH", reason: null },
    balances_block: 1,
    params_block: 1,
    sweep_block: 1,
    ...over,
  } as CashWireRow;
}

const cap = (num: string, den: string) => ({ wad: null, num, den, infinite: false, note: "" });

test("a computed Cash row: room = cap − debt, percent and band from headroom.ts", () => {
  const r = readCashRow(row({ account: "0xa" }));
  expect(r.computed).toBe(true);
  expect(r.debt).toBe(4_620_000_000n);
  expect(r.cap).toBe(4_804_000_000n);
  expect(r.room).toBe(184_000_000n);
  expect(r.roomPercent).toBe("3.8%");
  expect(r.band).toBe(2); // 2–5%
  expect(r.verdict).toBe("not-liquidatable");
});

test("a liquidatable row has negative room and the breached band", () => {
  const r = readCashRow(
    row({
      account: "0xb",
      liquidation_verdict: "liquidatable",
      health_factor: { wad: null, num: "3200000000", den: "4200000000", infinite: false, note: "" },
      total_debt: "4200000000",
    }),
  );
  expect(r.room).toBe(-1_000_000_000n);
  expect(r.band).toBe(0);
  expect(r.roomPercent).toBe("−31.3%"); // headroomTenths floors: floorDiv(−1e12, 3.2e9) = −313
});

test("a refused row reads as not computed with null figures — never zero", () => {
  const r = readCashRow(
    row({
      account: "0xc",
      status: "refused",
      refusal: { code: "SWEEP_NEVER", detail: "the sweep never ran", note: "" },
      health_factor: null,
      total_debt: null,
      total_collateral: null,
      liquidation_verdict: "unknowable",
    }),
  );
  expect(r.computed).toBe(false);
  expect(r.debt).toBeNull();
  expect(r.room).toBeNull();
  expect(r.band).toBeNull();
  expect(r.refusal).toEqual({ code: "SWEEP_NEVER", detail: "the sweep never ran" });
  expect(notComputedCause(r)).toBe("collateral sweep never ran · SWEEP_NEVER");
});

test("a refused row keeps a readable debt for display but never enters the liquidatable sum", () => {
  const r = readCashRow(
    row({
      account: "0xe",
      status: "refused",
      refusal: { code: "SWEEP_NEVER", detail: "", note: "" },
      health_factor: null,
      total_debt: "1500000000",
      liquidation_verdict: "liquidatable",
    }),
  );
  expect(r.computed).toBe(false);
  expect(r.debt).toBe(1_500_000_000n);
  expect(liquidatableRows([r])).toEqual([]);
  expect(nearCapRows([r])).toEqual([]);
  expect(roomBands([r]).reduce((n, b) => n + b.count, 0)).toBe(0);
});

test("an unknowable verdict on a row the engine calls computed is a withheld verdict: not computed, in no band, never near cap", () => {
  // Room 5% under the cap with $95 of debt — the shape that would read as "Near cap" if the verdict were taken as known.
  const r = readCashRow(
    row({ account: "0xu", liquidation_verdict: "unknowable", health_factor: cap("100000000", "95000000"), total_debt: "95000000" }),
  );
  expect(r.computed).toBe(false);
  expect(r.verdict).toBe("unknowable");
  expect(r.refusal).toBeNull();
  expect(r.band).toBeNull();
  expect(r.debt).toBe(95_000_000n);
  expect(nearCapRows([r])).toEqual([]);
  expect(liquidatableRows([r])).toEqual([]);
  expect(roomBands([r]).reduce((n, b) => n + b.count, 0)).toBe(0);
  expect(roomPercentiles([r])).toEqual({ median: null, p10: null });
  expect(notComputedCause(r)).toBe("the engine served no liquidation verdict for this account");
});

test("a malformed wire integer is refused, not coerced", () => {
  // "4.62e9" is what Number() would silently coerce to 4620000000; the wire guard rejects it.
  const r = readCashRow(row({ account: "0xd", total_debt: "4.62e9" }));
  expect(r.computed).toBe(false);
  expect(r.debt).toBeNull();
});

test("selectors: liquidatable, near cap (<10%, sorted by room), bands, percentiles, sums", () => {
  const rows = [
    readCashRow(row({ account: "0xliq", liquidation_verdict: "liquidatable", health_factor: cap("3200000000", "4200000000"), total_debt: "4200000000" })),
    readCashRow(row({ account: "0xnear1" })), // 3.8%
    readCashRow(row({ account: "0xnear2", health_factor: cap("10000000000", "9100000000"), total_debt: "9100000000" })), // 9%
    readCashRow(row({ account: "0xfar", health_factor: cap("10000000000", "5000000000"), total_debt: "5000000000" })), // 50%
    readCashRow(row({ account: "0xref", status: "refused", refusal: { code: "SWEEP_NEVER", detail: "", note: "" }, health_factor: null, total_debt: null, liquidation_verdict: "unknowable" })),
  ];
  expect(liquidatableRows(rows).map((r) => r.account)).toEqual(["0xliq"]);
  expect(nearCapRows(rows).map((r) => r.account)).toEqual(["0xnear1", "0xnear2"]);
  expect(sumDebt(nearCapRows(rows))).toBe(4_620_000_000n + 9_100_000_000n);
  const bands = roomBands(rows);
  expect(bands.map((b) => b.id)).toEqual(["breached", "0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]);
  expect(bands[0]).toMatchObject({ count: 1, debt: 4_200_000_000n });
  expect(bands[2]).toMatchObject({ count: 1, debt: 4_620_000_000n });
  expect(bands[3]).toMatchObject({ count: 1, debt: 9_100_000_000n });
  expect(bands[6]).toMatchObject({ count: 1, debt: 5_000_000_000n });
  expect(bands.reduce((n, b) => n + b.count, 0)).toBe(4); // the refused row is in no band
  // computed rows' room tenths sorted: −313, 38, 90, 500 → lower median 38 → "3.8%"; p10 → "−31.3%"
  expect(roomPercentiles(rows)).toEqual({ median: "3.8%", p10: "−31.3%" });
  expect(roomPercentiles([rows[4]!])).toEqual({ median: null, p10: null });
});

// ---------------------------------------------------------------------------
// readCashPage — one page judged before any row is derived.
// ---------------------------------------------------------------------------

const EXPECT = { engine: "debt_manager", decimals: 6, census: 2 } as const;
type Page = RefinedPositionsResponse;
type PageRow = Page["positions"][number];

function page(over: Partial<Page> = {}): Page {
  return { ...refinePositionsResponse(POSITIONS_DM_PAGE_1), ...over };
}

test("readCashPage: the committed page reads as rows, last, with its census", () => {
  const p = readCashPage(page(), EXPECT);
  expect(p.kind).toBe("rows");
  if (p.kind !== "rows") return;
  expect(p.rows.map((r) => r.account)).toEqual(POSITIONS_DM_PAGE_1.positions.map((r) => r.account));
  expect(p.last).toBe(true);
  expect(p.total).toBe(2);
  expect(readCashPage(page({ next_cursor: "more" }), EXPECT)).toMatchObject({ kind: "rows", last: false });
});

test("readCashPage: a refused page is the engine's refusal with its cause — never an empty book", () => {
  const refused = page({
    refused: true,
    refusal: { engine: "debt_manager", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" },
    total_positions: null,
    positions: [],
    next_cursor: null,
  });
  expect(readCashPage(refused, EXPECT)).toEqual({ kind: "refused", code: "SWEEP_FAILED", detail: "collateral sweep failed" });
  expect(readCashPage(page({ refused: true, refusal: null, total_positions: null, positions: [] }), EXPECT)).toEqual({
    kind: "refused",
    code: null,
    detail: null,
  });
});

test("readCashPage: a foreign engine never enters the Cash walk — the page's own engine, and any one row's", () => {
  expect(readCashPage(page({ engine: "aave_v3_etherfi" }), EXPECT)).toEqual({
    kind: "malformed",
    fault: 'the page answers for engine "aave_v3_etherfi", not debt_manager',
  });
  const mixed = page();
  mixed.positions[1] = { ...mixed.positions[1]!, engine: "aave_v3_etherfi" };
  const out = readCashPage(mixed, EXPECT);
  expect(out.kind).toBe("malformed");
  if (out.kind !== "malformed") return;
  expect(out.fault).toContain("positions[1]");
  expect(out.fault).toContain("aave_v3_etherfi");
  expect(out.fault).toContain("never enters the Cash walk");
});

test("readCashPage: the census — a null total on a page that is not refused, and a total the book contradicts, are malformed", () => {
  const nul = readCashPage(page({ total_positions: null }), EXPECT);
  expect(nul.kind).toBe("malformed");
  if (nul.kind === "malformed") expect(nul.fault).toContain("total_positions");
  expect(readCashPage(page({ total_positions: 3 }), EXPECT)).toEqual({
    kind: "malformed",
    fault: "the page advertises 3 rows; the book's aggregate counts 2",
  });
  // With no census from the book, the page's own total stands; the walk reconciles the rows it delivers against it.
  expect(readCashPage(page({ total_positions: 3 }), { ...EXPECT, census: null })).toMatchObject({ kind: "rows", total: 3 });
  expect(readCashPage(page({ total_positions: -0 }), { ...EXPECT, census: null }).kind).toBe("malformed");
});

test("readCashPage: a row without a health factor is a malformed page, never a throw and never a not-computed row", () => {
  const p = page();
  const bare = { ...p.positions[0]! } as Record<string, unknown>;
  delete bare.health_factor;
  p.positions[0] = bare as unknown as PageRow;
  expect(() => readCashPage(p, EXPECT)).not.toThrow();
  expect(readCashPage(p, EXPECT)).toEqual({
    kind: "malformed",
    fault: "positions[0].health_factor is neither null nor an object (got undefined)",
  });
});

test("readCashPage: a row at another scale, or at a scale the guard refuses, never enters a sum at the book's", () => {
  const eighteen = page();
  eighteen.positions[0] = { ...eighteen.positions[0]!, value_decimals: 18 };
  expect(readCashPage(eighteen, EXPECT)).toEqual({
    kind: "malformed",
    fault: "positions[0] (0xccCc000000000000000000000000000000000003) is at 18 decimals; the book is at 6",
  });
  const negativeZero = page();
  negativeZero.positions[0] = { ...negativeZero.positions[0]!, value_decimals: -0 };
  const out = readCashPage(negativeZero, EXPECT);
  expect(out.kind).toBe("malformed");
  if (out.kind === "malformed") expect(out.fault).toBe("positions[0].value_decimals is not a wire scale (got -0)");
});

test("readCashPage: a page whose shape is not the contract's is malformed by name", () => {
  expect(readCashPage(page({ positions: "rows" as unknown as PageRow[] }), EXPECT)).toEqual({
    kind: "malformed",
    fault: 'positions is not an array (got "rows")',
  });
  expect(readCashPage(page({ refused: "yes" as unknown as boolean }), EXPECT)).toEqual({
    kind: "malformed",
    fault: 'refused is not a boolean (got "yes")',
  });
  expect(readCashPage(page({ next_cursor: 7 as unknown as string }), EXPECT)).toEqual({
    kind: "malformed",
    fault: "next_cursor is neither a string nor null (got 7)",
  });
});
