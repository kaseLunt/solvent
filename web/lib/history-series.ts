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
//   - values are DISPLAY-PRECISION geometry only. Crit/severity is never
//     derived from them (lib/severity.ts law) and exact numbers belong in
//     adjacent mono text.
//
// Pure functions — pinned by tests/unit/history-series.spec.ts.

import { formatUnits, type HealthFactor } from "@solvent/client";
import type { AddressHistoryEngine, AddressHistoryPoint } from "./inspector-data";
import { EM_DASH, formatBlock } from "./format";

export type HistoryEntryKind = "computed" | "refused" | "withheld" | "infinite" | "unpublished";

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

/**
 * Build the sparkline series for one engine's history: points and
 * withheld-batch holes merged onto one batch-id axis, oldest first.
 *
 * A batch id present in BOTH `points` and `withheld_batch_ids` keeps the
 * point (a persisted row is evidence; the list entry would be a service
 * inconsistency this renderer does not paper over).
 */
export function buildHistorySeries(engine: AddressHistoryEngine): HistorySeries {
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
  const entries = [...byBatch.values()].sort((a, b) => a.batchId - b.batchId);
  return {
    entries,
    values: entries.map((entry) => entry.value),
    titles: entries.map((entry) => entry.title),
    newest: entries.length > 0 ? (entries[entries.length - 1] ?? null) : null,
  };
}
