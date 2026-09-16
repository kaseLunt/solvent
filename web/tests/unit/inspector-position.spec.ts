import { expect, test } from "@playwright/test";
import {
  boundaryOf,
  collateralTable,
  isComputedCash,
  pricesChip,
  readCashPosition,
  sourceDisplay,
} from "../../lib/inspector-position";
import { AAVE, ETHFI, near, WEETH } from "./helpers/cash-position";

test("readCashPosition: room, percents and the near-cap status from cap and debt", () => {
  const p = readCashPosition(near());
  expect(p.computed).toBe(true);
  expect(p.debt).toBe(4822000000n);
  expect(p.cap).toBe(5012500000n);
  expect(p.room).toBe(190500000n);
  expect(p.roomPercent).toBe("3.8%");
  expect(p.usedPercent).toBe("96.2%");
  expect(p.band).toBe(2); // 2–5 % room
  expect(p.status).toBe("near");
  expect(isComputedCash(p)).toBe(true);
});

test("readCashPosition: the engine's verdict decides liquidatable; healthy is room ≥ 10 %", () => {
  const liq = readCashPosition(near({ borrowings: "5400000000", liquidation_verdict: "liquidatable" }));
  expect(liq.status).toBe("liquidatable");
  expect(liq.room).toBe(-387500000n);
  expect(liq.roomPercent).toBe("−7.8%");
  expect(liq.usedPercent).toBe("107.8%"); // R15: the complement of room, never an independent truncation (107.7)
  const healthy = readCashPosition(near({ borrowings: "2100000000" }));
  expect(healthy.status).toBe("healthy");
  expect(healthy.roomPercent).toBe("58.1%");
  expect(healthy.usedPercent).toBe("41.9%");
  // a zero cap has no room percent and is still computed and liquidatable
  const zeroCap = readCashPosition(near({ max_borrow_lt: "0", liquidation_verdict: "liquidatable" }));
  expect(zeroCap.status).toBe("liquidatable");
  expect(zeroCap.roomPercent).toBeNull();
  expect(zeroCap.usedPercent).toBeNull();
  expect(isComputedCash(zeroCap)).toBe(true);
  // debt == cap is healthy by the strict rule, and sits in the near band
  const equal = readCashPosition(near({ borrowings: "5012500000" }));
  expect(equal.status).toBe("near");
  expect(equal.room).toBe(0n);
});

test("readCashPosition: a refused position keeps its readable debt and computes nothing", () => {
  const refused = readCashPosition(
    near({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "sweep failed", note: "" }, max_borrow_lt: null, liquidation_verdict: "unknowable", borrowings: "4100000000" }),
  );
  expect(refused.computed).toBe(false);
  expect(refused.status).toBe("refused");
  expect(refused.debt).toBe(4100000000n);
  expect(refused.cap).toBeNull();
  expect(refused.room).toBeNull();
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
  expect(isComputedCash(refused)).toBe(false);
  // a malformed decimal never becomes a number
  expect(readCashPosition(near({ borrowings: "4.62e9" })).computed).toBe(false);
});

test("collateralTable: amount, price, value, derived LTV, contribution, and the cap/collateral welds", () => {
  const p = near();
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs.map((l) => l.symbol)).toEqual(["weETH", "ETHFI"]);
  expect(table.legs[0]?.amount).toBe("2.1");
  expect(table.legs[0]?.price).toBe("$4,000.00");
  expect(table.legs[0]?.ltv).toBe("50%");
  expect(table.legs[1]?.amount).toBe("3,250");
  expect(table.legs[1]?.price).toBe("$1.2500");
  expect(table.legs[1]?.ltv).toBe("20%");
  expect(table.sumValue).toBe(12462500000n);
  expect(table.sumContribution).toBe(5012500000n);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  const drifted = near({ max_borrow_lt: "5000000000" });
  expect(collateralTable(drifted, readCashPosition(drifted)).capAgrees).toBe(false);
});

test("collateralTable: a leg with no price input prints no price; a zero value has no LTV", () => {
  const p = near({ price_inputs: [] });
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs[0]?.price).toBeNull();
  const zero = near();
  const leg = zero.legs[1];
  if (leg === undefined) throw new Error("leg");
  zero.legs[1] = { ...leg, value_usd: "0", max_borrow_contribution: "0" };
  expect(collateralTable(zero, readCashPosition(zero)).legs[1]?.ltv).toBeNull();
});

test("boundaryOf: the factor-level sentence names the fall, the floor, and what is held flat", () => {
  const p = near();
  const b = boundaryOf(p, readCashPosition(p));
  expect(b.kind).toBe("boundary");
  if (b.kind !== "boundary") return;
  expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
  expect(b.certified).toBe(true);
  expect(b.diagnostic).toBe(false);
});

test("boundaryOf: several factor assets fall together; a diagnostic solve says so; an uncertified boundary says near", () => {
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const two = near({
    liquidation_price: {
      ...p.liquidation_price,
      factor_assets: [WEETH, ETHFI],
      held_assets: [WEETH, ETHFI],
      prices: [
        ...p.liquidation_price.prices,
        { asset: ETHFI, current_price: "1250000", price_decimals: 6, price_floor: "1193303", lowest_healthy_price: "1193304" },
      ],
    },
  });
  const b = boundaryOf(two, readCashPosition(two));
  if (b.kind !== "boundary") throw new Error(b.kind);
  expect(b.sentence).toBe("Liquidatable if weETH and ETHFI fall 4.5% together — weETH below $3,818.57, ETHFI below $1.1933.");
  const diag = near({ liquidation_price: { ...p.liquidation_price, diagnostic: true } });
  const d = boundaryOf(diag, readCashPosition(diag));
  if (d.kind !== "boundary") throw new Error(d.kind);
  expect(d.sentence.startsWith("Single-asset diagnostic: ")).toBe(true);
  const uncertified = near({ liquidation_price: { ...p.liquidation_price, boundary_is_healthy: false } });
  const u = boundaryOf(uncertified, readCashPosition(uncertified));
  if (u.kind !== "boundary") throw new Error(u.kind);
  expect(u.certified).toBe(false);
  expect(u.sentence).toContain("near $3,818.57");
});

test("boundaryOf: absent, breached, no-price-path and unreadable arms", () => {
  const absent = near({ liquidation_price: null });
  expect(boundaryOf(absent, readCashPosition(absent)).kind).toBe("absent");
  // a liquidatable verdict is past the boundary — even when the wire also says never_liquidatable
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const liq = near({ borrowings: "5400000000", liquidation_verdict: "liquidatable", liquidation_price: { ...p.liquidation_price, never_liquidatable: true } });
  expect(boundaryOf(liq, readCashPosition(liq)).kind).toBe("breached");
  const never = near({ liquidation_price: { ...p.liquidation_price, never_liquidatable: true, reason: "position holds no counted collateral in the factor" } });
  const n = boundaryOf(never, readCashPosition(never));
  expect(n.kind).toBe("no-price-path");
  if (n.kind === "no-price-path") {
    expect(n.sentence).toBe("No downward move of weETH alone reaches the boundary.");
    expect(n.title).toContain("position holds no counted collateral in the factor");
  }
  // p1b-4: a null entry and a deleted price_decimals are classified before any read
  const nullEntry = near({ liquidation_price: { ...p.liquidation_price, prices: [null as never] } });
  expect(boundaryOf(nullEntry, readCashPosition(nullEntry)).kind).toBe("unreadable");
  const first = p.liquidation_price.prices[0];
  if (first === undefined) throw new Error("price");
  const noScale = { ...first };
  delete (noScale as { price_decimals?: number }).price_decimals;
  const unscaled = near({ liquidation_price: { ...p.liquidation_price, prices: [noScale as never] } });
  const u = boundaryOf(unscaled, readCashPosition(unscaled));
  expect(u.kind).toBe("unreadable");
  if (u.kind === "unreadable") expect(u.fields).toContain("price_decimals");
  // p0-8: a served entry without a boundary price is "absent", not a health claim
  const noFloor = near({ liquidation_price: { ...p.liquidation_price, prices: [{ ...first, lowest_healthy_price: null }] } });
  expect(boundaryOf(noFloor, readCashPosition(noFloor)).kind).toBe("absent");
  // p0-9: the observed prices:null serialization folds into the absent arm
  const nullPrices = near({ liquidation_price: { ...p.liquidation_price, prices: null as never } });
  expect(boundaryOf(nullPrices, readCashPosition(nullPrices)).kind).toBe("absent");
});

test("pricesChip: source display, oldest age, worst verdict", () => {
  expect(pricesChip(near().price_inputs)).toEqual({ label: "Prices", value: "PriceProvider v2 · 35s", tone: "ok" });
  const stale = near().price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(pricesChip(stale)).toEqual({ label: "Prices", value: "PriceProvider v2 · 3m", tone: "warn" });
  expect(pricesChip([...near().price_inputs, ...AAVE.price_inputs]).value).toBe("PriceProvider v2 + Aave oracle · 3m");
  expect(pricesChip([{ ...near().price_inputs[0]!, verdict: "missing", value: null, age_seconds: null }]).tone).toBe("crit");
  expect(pricesChip([])).toEqual({ label: "Prices", value: "no inputs", tone: "refused" });
  expect(sourceDisplay("priceproviderv2")).toBe("PriceProvider v2");
  expect(sourceDisplay("aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f")).toBe("Aave oracle");
  expect(sourceDisplay("redstone-classic")).toBe("redstone-classic");
});
