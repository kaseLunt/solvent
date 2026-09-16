// web/tests/unit/demo-inspector-weld.spec.ts
// The Inspector demo dataset welds to itself and to the Book's demo batch:
// the numbers the screenshot pins show are derivable from the bodies served.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import { boundaryOf, collateralTable, readCashPosition } from "../../lib/inspector-position";
import { nearCapStreak, roomSeries } from "../../lib/room-history";
import { stressReading } from "../../lib/address-stress";
import {
  DEMO_ADDRESS_HEALTHY,
  DEMO_ADDRESS_LIQUIDATABLE,
  DEMO_ADDRESS_NEAR,
  DEMO_ADDRESS_REFUSED,
  DEMO_BATCH_ID,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";

const cashOf = (body: typeof DEMO_ADDRESS_NEAR) => {
  const l = lookup(body);
  if (l.outcome !== "found") throw new Error("demo address must be found");
  const p = l.response.positions.find((x) => x.engine === "debt_manager");
  if (p === undefined) throw new Error("demo address must carry a Cash position");
  return p;
};

test("every body shares the Book's demo batch identity", () => {
  for (const body of [DEMO_ADDRESS_NEAR, DEMO_ADDRESS_LIQUIDATABLE, DEMO_ADDRESS_HEALTHY, DEMO_ADDRESS_REFUSED, DEMO_HISTORY_NEAR, DEMO_STRESS_NEAR]) {
    expect(body.batch.id).toBe(DEMO_BATCH_ID);
    expect(body.served_at).toBe(DEMO_BOOK.served_at);
    expect(body.batch.computed_at).toBe(DEMO_BOOK.batch.computed_at);
  }
  expect(DEMO_EVENTS_NEAR.served_at).toBe(DEMO_BOOK.served_at);
  expect(DEMO_PARAMS_DM.served_at).toBe(DEMO_BOOK.served_at);
});

test("the near account is the mockup's: cap, debt, room, legs, boundary", () => {
  const wire = cashOf(DEMO_ADDRESS_NEAR);
  const cash = readCashPosition(wire);
  expect(cash.debt).toBe(4822000000n);
  expect(cash.cap).toBe(5012500000n);
  expect(cash.room).toBe(190500000n);
  expect(cash.roomPercent).toBe("3.8%");
  expect(cash.status).toBe("near");
  const table = collateralTable(wire, cash);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  expect(table.legs.map((l) => [l.symbol, l.amount, l.price, l.ltv])).toEqual([
    ["weETH", "2.1", "$4,000.00", "50%"],
    ["ETHFI", "3,250", "$1.2500", "20%"],
  ]);
  const b = boundaryOf(wire, cash);
  expect(b.kind).toBe("boundary");
  if (b.kind === "boundary") expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
});

test("liquidatable, healthy and refused accounts read as their states", () => {
  expect(readCashPosition(cashOf(DEMO_ADDRESS_LIQUIDATABLE)).status).toBe("liquidatable");
  expect(readCashPosition(cashOf(DEMO_ADDRESS_HEALTHY)).status).toBe("healthy");
  const refused = readCashPosition(cashOf(DEMO_ADDRESS_REFUSED));
  expect(refused.computed).toBe(false);
  expect(refused.debt).toBe(4100000000n);
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
});

test("the history's newest point IS the position; 14 batches sit under the 10 % line; one refused point, two withheld batches", () => {
  const h = lookup(DEMO_HISTORY_NEAR);
  if (h.outcome !== "found") throw new Error("history must be found");
  const engine = h.response.engines.find((e) => e.engine === "debt_manager");
  if (engine === undefined) throw new Error("history must carry the Cash engine");
  const newest = engine.points[0];
  expect(newest?.batch_id).toBe(DEMO_BATCH_ID);
  expect(newest?.health_factor?.num).toBe("5012500000");
  expect(newest?.health_factor?.den).toBe("4822000000");
  expect(engine.points.filter((p) => p.status === "refused")).toHaveLength(1);
  expect(engine.withheld_batch_ids).toEqual([DEMO_BATCH_ID - 50, DEMO_BATCH_ID - 49]);
  const series = roomSeries(engine, engine.withheld_batch_ids);
  expect(series.computedCount).toBe(97);
  expect(nearCapStreak(series)).toEqual({ batches: 14, spanSeconds: 390, newestKind: "computed" });
});

test("stress: ETH −30 % and ETHFI −50 % flip the account; the rate projection does not", () => {
  const r = stressReading(lookup(DEMO_STRESS_NEAR), DEMO_NEAR_ADDR);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.map((x) => [x.id, x.flips])).toEqual([
    ["eth_minus_30", true],
    ["ethfi_minus_50", true],
    ["dm_rate_horizon_plus_200bps", false],
  ]);
  expect(r.rows[2]?.projection?.every((h) => h.verdict === "not-liquidatable")).toBe(true);
});

test("events: six rows for the near account, newest first, exactly one without a custodied time", () => {
  expect(DEMO_EVENTS_NEAR.events).toHaveLength(6);
  expect(DEMO_EVENTS_NEAR.events.every((e) => e.account === DEMO_NEAR_ADDR)).toBe(true);
  expect(DEMO_EVENTS_NEAR.events.filter((e) => e.block_time === null)).toHaveLength(1);
  const blocks = DEMO_EVENTS_NEAR.events.map((e) => e.block_number);
  expect([...blocks].sort((a, b) => b - a)).toEqual(blocks);
  expect(DEMO_PARAMS_DM.params[0]?.fields[0]?.name).toBe("borrow_apy");
});
