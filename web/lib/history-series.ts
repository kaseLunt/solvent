// The HF-history series builder: one engine's persisted per-batch points,
// turned into a Sparkline-ready series WITHOUT ever interpolating over a
// point the service refused or withheld.
//
// The null-gap law, applied to /v1/address/{addr}/history:
//
//   - a REFUSED batch is a POINT in the history (the position existed and
//     could not honestly be valued) — it renders as a GAP carrying its named
//     refusal as the hover reason, never as a value and never smoothed over;
//   - a WITHHELD batch (the engine's whole book withheld — listed in
//     `withheld_batch_ids`) has no row for ANY account, so it enters the axis
//     as a gap saying "cannot be established" — never "no position";
//   - an INFINITE health factor (no debt) has no finite geometry; it is a gap
//     that says ∞, not a plotted lie;
//   - a batch the response itself WITNESSES (another engine's row, a withheld
//     listing, the vantage batch) in which this engine has neither a point nor
//     a withheld entry is a NO-ROW gap (design ruling 11): a closed-then-
//     reopened position's absence is neither a point nor withheld, and without
//     the inserted gap the sparkline would draw a line straight across it;
//   - values are DISPLAY-PRECISION geometry only. Crit/severity is never
//     derived from them (lib/severity.ts law) and exact numbers belong in
//     adjacent mono text.
//
// HONEST BOUNDARY (ruling 11): the wire does NOT enumerate the covered
// window's full retained-batch id set — `/v1/address/{addr}/history` carries
// only per-engine points and withheld ids (see cmd/api/p5_history.go: the
// window is read server-side and never serialized). The axis here is
// therefore the KNOWN ids the response itself witnesses; a retained batch no
// part of the response mentions cannot be told apart from an unminted id, so
// no gap is fabricated for it. CONTRACT GAP, reported: the response should
// carry the covered batch-id set for a complete axis.
//
// Pure functions — pinned by tests/unit/history-series.spec.ts.

import { formatUnits, type HealthFactor } from "@solvent/client";
import type { AddressHistoryEngine, AddressHistoryPoint } from "./inspector-data";
import { EM_DASH, formatBlock } from "./format";

export type HistoryEntryKind =
  | "computed"
  | "refused"
  | "withheld"
  | "infinite"
  | "unpublished"
  | "no-row";

export interface HistorySeriesEntry {
  batchId: number;
  kind: HistoryEntryKind;
  /** Sparkline geometry. Null is a GAP — refused / withheld / ∞ / unpublished. */
  value: number | null;
  /** The hover reason. For gaps this is the WHY; for values, the number + block. */
  title: string;
  /** Compact display string ("1.08", "∞", "REFUSED · G1", em dash). */
  display: string;
}

export interface HistorySeries {
  /** Oldest batch first (the wire is newest-first; the sparkline reads left→right). */
  entries: HistorySeriesEntry[];
  /** `entries[].value`, ready for `Sparkline.values`. */
  values: (number | null)[];
  /** `entries[].title`, ready for `Sparkline.pointTitles`. */
  titles: string[];
  /** The newest entry (last of `entries`), for the adjacent mono readout. */
  newest: HistorySeriesEntry | null;
}

/**
 * A display-precision ratio from a published health factor: the wad when the
 * engine publishes one (Aave), else num/den at 4 display decimals (the Debt
 * Manager's exact rational). Null when neither is published. GEOMETRY ONLY.
 */
export function displayRatio(hf: HealthFactor): number | null {
  if (hf.wad !== null) {
    const n = Number(formatUnits(hf.wad, 18));
    return Number.isFinite(n) ? n : null;
  }
  if (hf.num !== null && hf.den !== null) {
    const den = BigInt(hf.den);
    if (den === 0n) return null;
    const scaled = (BigInt(hf.num) * 10_000n) / den;
    const n = Number(scaled) / 10_000;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A compact display string for a published health factor (exact wad, trimmed; num/den prefixed ≈). */
export function displayHf(hf: HealthFactor): string | null {
  if (hf.infinite) return "∞";
  if (hf.wad !== null) return formatUnits(hf.wad, 18, { trim: true });
  const ratio = displayRatio(hf);
  return ratio === null ? null : `≈${ratio.toFixed(4)}`;
}

function entryForPoint(point: AddressHistoryPoint): HistorySeriesEntry {
  const batchId = point.batch_id;
  if (point.status === "refused") {
    const code = point.refusal?.code ?? "unnamed";
    const detail = point.refusal?.detail ?? "";
    return {
      batchId,
      kind: "refused",
      value: null,
      title: `batch ${String(batchId)} — REFUSED · ${code}${detail === "" ? "" : ` — ${detail}`}`,
      display: `REFUSED · ${code}`,
    };
  }
  const hf = point.health_factor;
  if (hf === null) {
    return {
      batchId,
      kind: "unpublished",
      value: null,
      title: `batch ${String(batchId)} — no health factor published for this point`,
      display: EM_DASH,
    };
  }
  if (hf.infinite) {
    return {
      batchId,
      kind: "infinite",
      value: null,
      title: `batch ${String(batchId)} — ∞ (no debt; the ratio is unbounded and has no finite geometry)`,
      display: "∞",
    };
  }
  const value = displayRatio(hf);
  if (value === null) {
    return {
      batchId,
      kind: "unpublished",
      value: null,
      title: `batch ${String(batchId)} — health factor carries neither wad nor num/den`,
      display: EM_DASH,
    };
  }
  const display = displayHf(hf) ?? EM_DASH;
  return {
    batchId,
    kind: "computed",
    value,
    title: `batch ${String(batchId)} · HF ${display} @ block ${formatBlock(point.balances_block)}`,
    display,
  };
}

/** The slice of `AddressHistoryResponse` the batch axis is derived from. */
export interface HistoryAxisSource {
  batch: { id: number };
  engines: readonly {
    points: readonly { batch_id: number }[];
    withheld_batch_ids: readonly number[];
  }[];
}

/**
 * The KNOWN batch-id axis of one history response: every batch id the wire
 * itself witnesses — each engine's points, each engine's withheld list, and
 * the vantage batch the response is served from (all of them retained-window
 * members by the handler's construction). Sorted ascending, unique.
 *
 * This is deliberately NOT "the retained set" — see the honest-boundary note
 * in this file's header: an id no part of the response mentions is unknowable
 * here, so gaps are inserted only at these witnessed ids.
 */
export function knownBatchAxis(response: HistoryAxisSource): number[] {
  const ids = new Set<number>([response.batch.id]);
  for (const engine of response.engines) {
    for (const point of engine.points) ids.add(point.batch_id);
    for (const batchId of engine.withheld_batch_ids) ids.add(batchId);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Build the sparkline series for one engine's history: points,
 * withheld-batch holes and NO-ROW gaps merged onto one batch-id axis,
 * oldest first.
 *
 * A batch id present in BOTH `points` and `withheld_batch_ids` keeps the
 * point (a persisted row is evidence; the list entry would be a service
 * inconsistency this renderer does not paper over).
 *
 * `knownBatchIds` (ruling 11) is the response-level axis from
 * `knownBatchAxis`: a known id absent from BOTH this engine's points and its
 * withheld list becomes a NO-ROW gap — the account has no persisted row at
 * that batch, which is an ABSENCE, never a value, and the line breaks there
 * instead of drawing across it.
 */
export function buildHistorySeries(
  engine: AddressHistoryEngine,
  knownBatchIds: readonly number[] = [],
): HistorySeries {
  const byBatch = new Map<number, HistorySeriesEntry>();
  for (const point of engine.points) {
    byBatch.set(point.batch_id, entryForPoint(point));
  }
  for (const batchId of engine.withheld_batch_ids) {
    if (byBatch.has(batchId)) continue;
    byBatch.set(batchId, {
      batchId,
      kind: "withheld",
      value: null,
      title:
        `batch ${String(batchId)} — ${engine.engine} book withheld — ` +
        `cannot be established (never "no position")`,
      display: "withheld",
    });
  }
  for (const batchId of knownBatchIds) {
    if (byBatch.has(batchId)) continue;
    byBatch.set(batchId, {
      batchId,
      kind: "no-row",
      value: null,
      title:
        `batch ${String(batchId)} — no row in this batch: this account has no persisted ` +
        `${engine.engine} row here (an absence, not a value — the line breaks rather than ` +
        `drawing across it)`,
      display: "no row",
    });
  }
  const entries = [...byBatch.values()].sort((a, b) => a.batchId - b.batchId);
  return {
    entries,
    values: entries.map((entry) => entry.value),
    titles: entries.map((entry) => entry.title),
    newest: entries.length > 0 ? (entries[entries.length - 1] ?? null) : null,
  };
}
