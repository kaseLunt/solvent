// web/tests/unit/cash-rows.spec.ts
import { expect, test } from "@playwright/test";
import {
  liquidatableRows,
  nearCapRows,
  readCashRow,
  roomBands,
  roomPercentiles,
  sumDebt,
  type CashWireRow,
} from "../../lib/cash-rows";

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

test("a malformed wire integer is refused, not coerced", () => {
  // "4.62e9" is what Number() would silently coerce to 4620000000; the wire guard rejects it.
  const r = readCashRow(row({ account: "0xd", total_debt: "4.62e9" }));
  expect(r.computed).toBe(false);
  expect(r.debt).toBeNull();
});

test("selectors: liquidatable, near cap (<10%, sorted by room), bands, percentiles, sums", () => {
  const cap = (num: string, den: string) => ({ wad: null, num, den, infinite: false, note: "" });
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
