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
  expect(nearCapStreak(s)).toEqual({ batches: 3, spanSeconds: 120, newestKind: "computed" });
  const broken = roomSeries(engine([point(2, "5300000000"), point(3, null), point(4, "5012500000")]));
  expect(nearCapStreak(broken)).toEqual({ batches: 1, spanSeconds: null, newestKind: "computed" });
  expect(nearCapStreak(roomSeries(engine([point(4, "6000000000")])))).toEqual({ batches: 0, spanSeconds: null, newestKind: "computed" });
  expect(nearCapStreak(roomSeries(engine([])))).toEqual({ batches: 0, spanSeconds: null, newestKind: null });
});

test("review round: a zero cap is a point past the cap, out-of-contract ids throw, and the streak knows the newest kind", () => {
  /** The engine's debt-after-empty-sweep shape: a PUBLISHED zero cap with debt left — known, and past the cap. */
  const zeroCap = (batchId: number): AddressHistoryPoint => point(batchId, "0", "4822000000", { liquidatable: true });
  const z = roomSeries(engine([zeroCap(2)]));
  expect(z.points[0]?.kind).toBe("zero-cap");
  expect(z.points[0]?.display).toBe("0 cap");
  expect(z.points[0]?.value).toBeNull();
  expect(z.titles[0]).toContain("past the cap");
  expect(z.computedCount).toBe(0);
  // No room at all is under the line, so a zero-cap point COUNTS in the streak.
  const s = roomSeries(engine([point(1, "6000000000"), zeroCap(2), point(3, "5012500000")]));
  expect(nearCapStreak(s)).toEqual({ batches: 2, spanSeconds: 60, newestKind: "computed" });
  // A negative debt is refused by name — never "cap not positive".
  const neg = roomSeries(engine([point(1, "5012500000", "-1")]));
  expect(neg.points[0]?.kind).toBe("unpublished");
  expect(neg.titles[0]).toContain("negative debt");
  // A negative cap is refused by name too.
  const negCap = roomSeries(engine([point(1, "-1")]));
  expect(negCap.points[0]?.kind).toBe("unpublished");
  expect(negCap.titles[0]).toContain("negative cap on the wire");
  // The wire's own infinite shape: num and den are null when there is no debt.
  const inf = roomSeries(engine([point(1, null, "0", { health_factor: { wad: null, num: null, den: null, infinite: true, note: "" } })]));
  expect(inf.points[0]?.kind).toBe("computed");
  expect(inf.points[0]?.display).toBe("100%");
  expect(inf.titles[0]).toContain("@ block 155,323,001");
  // 0/0 is an undefined ratio (only reachable with an out-of-contract infinite: false): unknown, not past the cap, and it breaks the run.
  const undef = roomSeries(engine([point(1, "5012500000"), point(2, "0", "0")]));
  expect(undef.points[1]?.kind).toBe("unpublished");
  expect(undef.titles[1]).toContain("no cap and no debt");
  expect(nearCapStreak(undef)).toEqual({ batches: 0, spanSeconds: null, newestKind: "unpublished" });
  // Out of contract: a batch that appears twice among the points, and a caller id that is not a population.
  expect(() => roomSeries(engine([point(7, "5012500000"), point(7, null)]))).toThrow();
  expect(() => roomSeries(engine([point(1, "5012500000")]), [1.5 as never])).toThrow();
  // Reversed stamps (the newest point stamped earlier than the oldest in the run) have no honest span.
  const reversed = roomSeries(
    engine([
      point(1, "5300000000", "4822000000", { computed_at: "2026-08-08T20:05:00Z" }),
      point(2, "5012500000", "4822000000", { computed_at: "2026-08-08T20:01:00Z" }),
    ]),
  );
  expect(nearCapStreak(reversed)).toEqual({ batches: 2, spanSeconds: null, newestKind: "computed" });
  // A trailing withheld batch: the run cannot be read past it, and the streak says which kind stopped it.
  const trailing = roomSeries(engine([point(1, "5012500000"), point(2, "5012500000")], [3]));
  expect(nearCapStreak(trailing)).toEqual({ batches: 0, spanSeconds: null, newestKind: "withheld" });
});
