// web/tests/unit/room-history.spec.ts
import { expect, test } from "@playwright/test";
import type { AddressHistoryEngine, AddressHistoryPoint } from "../../lib/inspector-data";
import { NEAR_LINE_TENTHS, nearCapStreak, roomSeries } from "../../lib/room-history";

/** A Debt Manager point: num = cap, den = debt (the engine's exact rational, internal/risk/types.go:774). */
function point(batchId: number, cap: string | null, debt = "4822000000", extra: Partial<AddressHistoryPoint> = {}): AddressHistoryPoint {
  return {
    batch_id: batchId,
    computed_at: `2026-08-08T20:${String(batchId).padStart(2, "0")}:00Z`,
    balances_block: 155_323_000 + batchId,
    sweep_block: 155_322_900 + batchId,
    status: "computed",
    refusal: null,
    health_factor: cap === null ? null : { wad: null, num: cap, den: debt, infinite: false, note: "" },
    liquidatable: false,
    total_collateral_base: "12462500000",
    total_debt_base: debt,
    ...extra,
  };
}
const engine = (points: AddressHistoryPoint[], withheld: number[] = []): AddressHistoryEngine => ({
  engine: "debt_manager",
  value_decimals: 6,
  points,
  withheld_batch_ids: withheld,
  note: "",
});

test("room per point is (cap − debt) / cap in tenths; the series is ascending by batch; newest is last", () => {
  const s = roomSeries(engine([point(12, "5012500000"), point(10, "6000000000"), point(11, "5500000000")]));
  expect(s.points.map((p) => p.batchId)).toEqual([10, 11, 12]);
  expect(s.points.map((p) => p.display)).toEqual(["19.6%", "12.3%", "3.8%"]);
  expect(s.values).toEqual([19.6, 12.3, 3.8]);
  expect(s.newest?.batchId).toBe(12);
  expect(s.computedCount).toBe(3);
  expect(s.titles[2]).toContain("batch 12 · room 3.8% of cap @ block 155,323,012");
});

test("gaps: refused, withheld, no-row, no cap published, malformed — each a titled null, never a value", () => {
  const s = roomSeries(
    engine(
      [
        point(5, "5012500000"),
        point(4, null, "4822000000", { status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, total_collateral_base: null, total_debt_base: null }),
        point(3, null),
        point(1, "4.62e9"),
      ],
      [2],
    ),
    [0],
  );
  expect(s.points.map((p) => [p.batchId, p.kind, p.value])).toEqual([
    [0, "no-row", null],
    [1, "unpublished", null],
    [2, "withheld", null],
    [3, "unpublished", null],
    [4, "refused", null],
    [5, "computed", 3.8],
  ]);
  expect(s.titles[4]).toContain("not computed");
  expect(s.titles[4]).toContain("sweep failed");
  expect(s.titles[2]).toContain("withheld");
  expect(s.titles[2]).toContain("never");
  expect(s.computedCount).toBe(1);
});

test("a no-debt point is room 100 % — a knowable value, not a gap", () => {
  const s = roomSeries(engine([point(1, "5012500000", "0", { health_factor: { wad: null, num: "5012500000", den: "0", infinite: true, note: "" } })]));
  expect(s.points[0]?.kind).toBe("computed");
  expect(s.points[0]?.display).toBe("100%");
  expect(s.values).toEqual([100]);
});

test("nearCapStreak counts the newest run under the 10 % line and spans it from the stamps", () => {
  expect(NEAR_LINE_TENTHS).toBe(100n);
  const s = roomSeries(engine([point(1, "6000000000"), point(2, "5300000000"), point(3, "5200000000"), point(4, "5012500000")]));
  // 2: (5300−4822)/5300 = 9.0 % ✓, 3: 7.2 % ✓, 4: 3.8 % ✓, 1: 19.6 % ✗
  expect(nearCapStreak(s)).toEqual({ batches: 3, spanSeconds: 120 });
  const broken = roomSeries(engine([point(2, "5300000000"), point(3, null), point(4, "5012500000")]));
  expect(nearCapStreak(broken)).toEqual({ batches: 1, spanSeconds: null });
  expect(nearCapStreak(roomSeries(engine([point(4, "6000000000")])))).toEqual({ batches: 0, spanSeconds: null });
  expect(nearCapStreak(roomSeries(engine([])))).toEqual({ batches: 0, spanSeconds: null });
});
