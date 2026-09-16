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
