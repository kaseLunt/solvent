### Task 5: `room-history` — room % per batch from `/history`, and the near-cap streak

**Files:**
- Create: `web/lib/room-history.ts`
- Test: `web/tests/unit/room-history.spec.ts`

**Interfaces:**
- Consumes `AddressHistoryEngine`, `AddressHistoryPoint` from `./inspector-data`; `headroomTenths`, `WARN_HEADROOM_PCT` from `./headroom`; `formatTenths` from `./percent`; `plainCause` from `./refusal-phrasebook`; `readWirePopulation`, `wireBigInt` from `./wireGuard`; `formatBlock` from `./format`.
- Produces:

```ts
export type RoomPointKind = "computed" | "refused" | "withheld" | "no-row" | "unpublished";
export interface RoomPoint { readonly batchId: number; readonly computedAt: string | null; readonly roomTenths: bigint | null; readonly value: number | null; readonly kind: RoomPointKind; readonly title: string; readonly display: string }
export interface RoomSeries { readonly points: RoomPoint[]; readonly values: (number | null)[]; readonly titles: string[]; readonly newest: RoomPoint | null; readonly computedCount: number }
export interface Streak { readonly batches: number; readonly spanSeconds: number | null }
export const NEAR_LINE_TENTHS: bigint; // 10 % as tenths = 100n
export function roomSeries(engine: AddressHistoryEngine, knownBatchIds?: readonly number[]): RoomSeries;
export function nearCapStreak(series: RoomSeries): Streak;
```

- [ ] **Step 1: The failing spec**

```ts
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
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/room-history.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/room-history.ts
// Room over batches for one Cash account (plan 2 ruling R4). A Debt Manager
// history point's health_factor carries MaxBorrowLT / Borrowings as an exact
// rational (num / den), so room % per batch is the same arithmetic the Book
// uses. Everything the wire refused, withheld or never wrote is a GAP with a
// title — the line breaks rather than drawing across it. Values are geometry
// only (the printed figure is the tenths string).
import { formatBlock } from "./format";
import { headroomTenths, WARN_HEADROOM_PCT } from "./headroom";
import type { AddressHistoryEngine, AddressHistoryPoint } from "./inspector-data";
import { formatTenths } from "./percent";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation, wireBigInt } from "./wireGuard";

export type RoomPointKind = "computed" | "refused" | "withheld" | "no-row" | "unpublished";

export interface RoomPoint {
  readonly batchId: number;
  readonly computedAt: string | null;
  readonly roomTenths: bigint | null;
  readonly value: number | null;
  readonly kind: RoomPointKind;
  readonly title: string;
  readonly display: string;
}

export interface RoomSeries {
  readonly points: RoomPoint[];
  readonly values: (number | null)[];
  readonly titles: string[];
  readonly newest: RoomPoint | null;
  readonly computedCount: number;
}

export interface Streak {
  readonly batches: number;
  readonly spanSeconds: number | null;
}

/** The near-cap line, in tenths of a percent of the cap. */
export const NEAR_LINE_TENTHS = BigInt(WARN_HEADROOM_PCT) * 10n;

const gap = (batchId: number, computedAt: string | null, kind: RoomPointKind, title: string, display: string): RoomPoint => ({
  batchId,
  computedAt,
  roomTenths: null,
  value: null,
  kind,
  title: `batch ${String(batchId)} · ${title}`,
  display,
});

function pointFor(point: AddressHistoryPoint): RoomPoint {
  const batchId = readWirePopulation(point.batch_id, "batch_id");
  if (point.status === "refused") {
    const code = point.refusal?.code ?? "unnamed";
    return gap(batchId, point.computed_at, "refused", `not computed · ${plainCause(code, point.refusal?.detail)}`, "not computed");
  }
  const hf = point.health_factor;
  if (hf === null) return gap(batchId, point.computed_at, "unpublished", "no cap published for this point", "—");
  const computed = (tenths: bigint, title: string): RoomPoint => ({
    batchId,
    computedAt: point.computed_at,
    roomTenths: tenths,
    value: Number(tenths) / 10,
    kind: "computed",
    title: `batch ${String(batchId)} · ${title}`,
    display: formatTenths(tenths),
  });
  if (hf.infinite) return computed(1000n, "no debt · room is the whole cap");
  const num = hf.num === null ? null : wireBigInt(hf.num);
  const den = hf.den === null ? null : wireBigInt(hf.den);
  if (num === null || den === null) return gap(batchId, point.computed_at, "unpublished", "the ratio behind this point is not readable", "—");
  const tenths = headroomTenths(num, den);
  if (tenths === null) return gap(batchId, point.computed_at, "unpublished", "cap not positive for this point", "—");
  return computed(tenths, `room ${formatTenths(tenths)} of cap @ block ${formatBlock(point.balances_block)}`);
}

export function roomSeries(engine: AddressHistoryEngine, knownBatchIds: readonly number[] = []): RoomSeries {
  const byBatch = new Map<number, RoomPoint>();
  for (const point of engine.points) {
    const entry = pointFor(point);
    byBatch.set(entry.batchId, entry);
  }
  for (const id of engine.withheld_batch_ids) {
    const batchId = readWirePopulation(id, "withheld_batch_ids[]");
    if (!byBatch.has(batchId)) byBatch.set(batchId, gap(batchId, null, "withheld", 'Cash book withheld — cannot be established (never "no position")', "withheld"));
  }
  for (const batchId of knownBatchIds) {
    if (!byBatch.has(batchId)) byBatch.set(batchId, gap(batchId, null, "no-row", "no row for this account in this batch", "no row"));
  }
  const points = [...byBatch.values()].sort((a, b) => a.batchId - b.batchId);
  return {
    points,
    values: points.map((p) => p.value),
    titles: points.map((p) => p.title),
    newest: points.length === 0 ? null : (points[points.length - 1] ?? null),
    computedCount: points.filter((p) => p.kind === "computed").length,
  };
}

/** The newest run of consecutive computed points under the near-cap line, and the time it spans. */
export function nearCapStreak(series: RoomSeries): Streak {
  let count = 0;
  let oldest: RoomPoint | null = null;
  for (let i = series.points.length - 1; i >= 0; i -= 1) {
    const p = series.points[i];
    if (p === undefined || p.kind !== "computed" || p.roomTenths === null || p.roomTenths >= NEAR_LINE_TENTHS) break;
    count += 1;
    oldest = p;
  }
  const newest = series.newest;
  const span =
    count >= 2 && oldest?.computedAt != null && newest?.computedAt != null
      ? Math.floor((Date.parse(newest.computedAt) - Date.parse(oldest.computedAt)) / 1000)
      : null;
  return { batches: count, spanSeconds: span === null || Number.isNaN(span) ? null : span };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/room-history.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/room-history.ts web/tests/unit/room-history.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): room over batches from the address history - the engine's exact rational per point, gaps as gaps, the near-cap streak"
```

---

