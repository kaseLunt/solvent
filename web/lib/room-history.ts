// web/lib/room-history.ts
// Room over batches for one Cash account (plan 2 ruling R4). A Debt Manager
// history point's health_factor carries MaxBorrowLT / Borrowings as an exact
// rational (num / den), so room % per batch is the same arithmetic the Book
// uses. Everything the wire refused, withheld or never wrote is a GAP with a
// title — the line breaks rather than drawing across it. Values are geometry
// only (the printed figure is the tenths string).
//
// A ZERO cap with debt is the engine's own shape for debt left after an empty
// sweep (internal/risk/dm.go) — the cap WAS published, as zero, and the Book's
// headroomBand calls it breached. It is its own kind ("zero-cap"), never
// "unpublished": a percent of a zero cap has no geometry, so it stays a gap on
// the line, but its title says what is known. Every wire population passes
// readWirePopulation before it is printed or used, and a batch that appears
// twice among the points is refused, never silently overwritten — the same
// WireIntegerError arm the rest of the module uses.
import { formatBlock } from "./format";
import { headroomTenths, WARN_HEADROOM_PCT } from "./headroom";
import type { AddressHistoryEngine, AddressHistoryPoint } from "./inspector-data";
import { formatTenths } from "./percent";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation, wireBigInt, WireIntegerError } from "./wireGuard";

export type RoomPointKind = "computed" | "refused" | "withheld" | "no-row" | "unpublished" | "zero-cap";

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
  /** The newest point's kind, or null for an empty series — so a consumer can say "the newest batch is withheld" instead of nothing. */
  readonly newestKind: RoomPointKind | null;
}

/** The near-cap line, in tenths of a percent of the cap. */
export const NEAR_LINE_TENTHS = BigInt(WARN_HEADROOM_PCT) * 10n;

/**
 * The drawn y-domain of a room chart. 0% room is the cap. The domain always reaches it and never clips a negative
 * (over-cap) room; its top clears the near-cap line.
 */
export function roomDomain(values: readonly (number | null)[]): { min: number; max: number } {
  const plotted = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return { min: Math.min(0, ...plotted), max: Math.max(Number(NEAR_LINE_TENTHS) / 10 + 2, ...plotted) };
}

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
  /** The block behind this point, guarded before it is printed — read only by the arms that print it. */
  const atBlock = (): string => ` @ block ${formatBlock(readWirePopulation(point.balances_block, "balances_block"))}`;
  const computed = (tenths: bigint, title: string): RoomPoint => ({
    batchId,
    computedAt: point.computed_at,
    roomTenths: tenths,
    value: Number(tenths) / 10,
    kind: "computed",
    title: `batch ${String(batchId)} · ${title}`,
    display: formatTenths(tenths),
  });
  // The wire sends num: null, den: null when there is no debt, so the flag is read BEFORE the ratio.
  if (hf.infinite) return computed(1000n, `no debt · room is the whole cap${atBlock()}`);
  const num = hf.num === null ? null : wireBigInt(hf.num);
  const den = hf.den === null ? null : wireBigInt(hf.den);
  if (num === null || den === null) return gap(batchId, point.computed_at, "unpublished", "the ratio behind this point is not readable", "—");
  if (den < 0n) return gap(batchId, point.computed_at, "unpublished", "negative debt on the wire", "—");
  if (num < 0n) return gap(batchId, point.computed_at, "unpublished", "negative cap on the wire", "—");
  if (num === 0n) {
    // 0/0 is not a ratio (only reachable with an out-of-contract infinite: false) — an unknown, never a point past the cap.
    if (den === 0n) return gap(batchId, point.computed_at, "unpublished", "no cap and no debt · undefined ratio", "—");
    // A published zero cap with debt left: known, and past the cap. A percent of zero has no geometry.
    return gap(batchId, point.computed_at, "zero-cap", `zero cap · debt with no counted collateral — past the cap${atBlock()}`, "0 cap");
  }
  const tenths = headroomTenths(num, den);
  // Unreachable after the guards above (num > 0, den >= 0); kept for type honesty.
  if (tenths === null) return gap(batchId, point.computed_at, "unpublished", "cap not positive for this point", "—");
  return computed(tenths, `room ${formatTenths(tenths)} of cap${atBlock()}`);
}

export function roomSeries(engine: AddressHistoryEngine, knownBatchIds: readonly number[] = []): RoomSeries {
  const byBatch = new Map<number, RoomPoint>();
  for (const point of engine.points) {
    const entry = pointFor(point);
    // One persisted row per batch per engine: a second point for the same batch is the wire contradicting itself.
    if (byBatch.has(entry.batchId)) {
      throw new WireIntegerError(`history: batch ${String(entry.batchId)} appears twice in ${engine.engine} points`);
    }
    byBatch.set(entry.batchId, entry);
  }
  for (const id of engine.withheld_batch_ids) {
    const batchId = readWirePopulation(id, "withheld_batch_ids[]");
    if (!byBatch.has(batchId)) byBatch.set(batchId, gap(batchId, null, "withheld", 'Cash book withheld — cannot be established (never "no position")', "withheld"));
  }
  for (const id of knownBatchIds) {
    const batchId = readWirePopulation(id, "knownBatchIds[]");
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

/** Under the line: computed with room below NEAR_LINE_TENTHS, or a zero cap (no room at all). Any other kind breaks the run. */
function underLine(p: RoomPoint): boolean {
  if (p.kind === "zero-cap") return true;
  return p.kind === "computed" && p.roomTenths !== null && p.roomTenths < NEAR_LINE_TENTHS;
}

/** The newest run of consecutive points under the near-cap line, the time it spans, and what kind the newest point is. */
export function nearCapStreak(series: RoomSeries): Streak {
  let count = 0;
  let oldest: RoomPoint | null = null;
  for (let i = series.points.length - 1; i >= 0; i -= 1) {
    const p = series.points[i];
    if (p === undefined || !underLine(p)) break;
    count += 1;
    oldest = p;
  }
  const newest = series.newest;
  const span =
    count >= 2 && oldest?.computedAt != null && newest?.computedAt != null
      ? Math.floor((Date.parse(newest.computedAt) - Date.parse(oldest.computedAt)) / 1000)
      : null;
  // A NaN span is an unparseable stamp; a negative span is stamps running backwards — neither is a duration a reader may see.
  return {
    batches: count,
    spanSeconds: span === null || Number.isNaN(span) || span < 0 ? null : span,
    newestKind: newest?.kind ?? null,
  };
}
