// web/tests/unit/demo-fixture-weld.spec.ts
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { liquidatableRows, nearCapRows, readCashRow, sumDebt } from "../../lib/cash-rows";
import { partitionByMateriality } from "../../lib/materiality";
import { DEMO_BATCH_ID, DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";

const pages = [DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2];
// The wire's nullable-boolean `liquidatable` becomes the sealed `liquidation_verdict`
// through the client's OWN refinement — the same read the app performs — never a cast.
const wire = pages.flatMap((p) => p.positions).map(refinePositionSummary);
const rows = wire.map(readCashRow);
const cash = DEMO_BOOK.engines.find((e) => e.engine === "debt_manager");
const cashBadDebt = DEMO_BOOK.bad_debt.find((e) => e.engine === "debt_manager");
if (cash === undefined || cashBadDebt === undefined) throw new Error("demo book must carry the Cash engine");

test("pages chain and cover the population", () => {
  expect(DEMO_POSITIONS_DM_PAGE_1.next_cursor).not.toBeNull();
  expect(DEMO_POSITIONS_DM_PAGE_2.next_cursor).toBeNull();
  expect(wire.length).toBe(1412);
  expect(DEMO_POSITIONS_DM_PAGE_1.total_positions).toBe(1412);
  expect(cash.positions).toBe(1412);
  for (const p of pages) expect(p.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_BOOK.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_META.batch?.id).toBe(DEMO_BATCH_ID);
});

test("every row carries the canonical row's keys", () => {
  const template = Object.keys(DEMO_POSITIONS_DM_PAGE_1.positions[0] ?? {}).sort();
  for (const row of pages.flatMap((p) => p.positions)) expect(Object.keys(row).sort()).toEqual(template);
});

test("the engine aggregates reconcile to the rows", () => {
  const computed = rows.filter((r) => r.computed);
  expect(computed.length).toBe(cash.computed_positions);
  expect(rows.length - computed.length).toBe(cash.refused_positions);
  expect(cash.refused_positions).toBe(6);
  expect(sumDebt(computed.map((r) => ({ debt: r.debt ?? 0n })))).toBe(BigInt(cash.total_debt ?? "0"));
  const liq = liquidatableRows(rows);
  expect(liq.length).toBe(cash.liquidatable_positions);
  expect(liq.length).toBe(cashBadDebt.eligible_positions);
  expect(sumDebt(liq)).toBe(BigInt(cashBadDebt.eligible_debt_usd ?? "0"));
});

test("materiality and near-cap proportions are the designed ones", () => {
  const p = partitionByMateriality(liquidatableRows(rows), 6);
  expect(p.counts).toEqual({ material: 2, small: 4, dust: 43, belowLine: 47 });
  expect(nearCapRows(rows).length).toBe(27);
});

test("rows are served least room first, breached before everything", () => {
  const tenths = rows.filter((r) => r.roomTenths !== null).map((r) => r.roomTenths as bigint);
  for (let i = 1; i < tenths.length; i += 1) expect(tenths[i]! >= tenths[i - 1]!).toBe(true);
});
