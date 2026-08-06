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
//     adjacent mono text;
//   - the SWEEP MARK travels with every Debt Manager point (contract 1.2.1:
//     each point carries its OWN batch's persisted `sweep_block` — the
//     collateral clock behind that point's `liquidatable` verdict). A DM
//     point's hover title carries `S <block>` — or `S ∅` when 0, an ABSENT
//     sweep disclosed, never "swept at genesis" — so the mixed-clock
//     disclosure reaches the human (book-row marks grammar: Aave has no
//     sweeper and therefore no S mark).
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

/**
 * The sweep mark a Debt Manager point's hover title carries (contract 1.2.1):
 * the POINT's own persisted `sweep_block` — the collateral clock behind that
 * point's `liquidatable` verdict — as `S <block>`, or `S ∅` when 0 (an
 * ABSENT sweep, disclosed, never "swept at genesis"). Empty on every other
 * engine: Aave has no sweeper and no S mark (book-row marks grammar).
 */
function sweepMark(engineName: string, point: AddressHistoryPoint): string {
  if (engineName !== "debt_manager") return "";
  return point.sweep_block > 0 ? ` · S ${formatBlock(point.sweep_block)}` : " · S ∅";
}

function entryForPoint(point: AddressHistoryPoint, engineName: string): HistorySeriesEntry {
  const batchId = point.batch_id;
  // The sweep disclosure travels with EVERY persisted DM point — the verdict
  // rides computed points, and a refused point's S ∅ is the same absent-sweep
  // truth the refusal names.
  const sweep = sweepMark(engineName, point);
  if (point.status === "refused") {
    const code = point.refusal?.code ?? "unnamed";
    const detail = point.refusal?.detail ?? "";
    return {
      batchId,
      kind: "refused",
      value: null,
      title: `batch ${String(batchId)} · REFUSED · ${code}${detail === "" ? "" : `: ${detail}`}${sweep}`,
      display: `REFUSED · ${code}`,
    };
  }
  const hf = point.health_factor;
  if (hf === null) {
    return {
      batchId,
      kind: "unpublished",
      value: null,
      title: `batch ${String(batchId)} · no health factor published for this point${sweep}`,
      display: EM_DASH,
    };
  }
  if (hf.infinite) {
    return {
      batchId,
      kind: "infinite",
      value: null,
      title: `batch ${String(batchId)} · ∞ (no debt; the ratio is unbounded and has no finite geometry)${sweep}`,
      display: "∞",
    };
  }
  const value = displayRatio(hf);
  if (value === null) {
    return {
      batchId,
      kind: "unpublished",
      value: null,
      title: `batch ${String(batchId)} · health factor carries neither wad nor num/den${sweep}`,
      display: EM_DASH,
    };
  }
  const display = displayHf(hf) ?? EM_DASH;
  return {
    batchId,
    kind: "computed",
    value,
    title: `batch ${String(batchId)} · HF ${display} @ block ${formatBlock(point.balances_block)}${sweep}`,
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
    byBatch.set(point.batch_id, entryForPoint(point, engine.engine));
  }
  for (const batchId of engine.withheld_batch_ids) {
    if (byBatch.has(batchId)) continue;
    byBatch.set(batchId, {
      batchId,
      kind: "withheld",
      value: null,
      title:
        `batch ${String(batchId)} · ${engine.engine} book withheld, so this account's state ` +
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
        `batch ${String(batchId)} · no row in this batch: this account has no persisted ` +
        `${engine.engine} row here (an absence, not a value, so the line breaks rather than ` +
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

/**
 * The newest PLOTTED point's direct label (Wave W-OBS-B). ONE-SOURCE LAW,
 * both arms:
 *
 *   - when the last entry with finite geometry IS the newest witnessed batch
 *     on the axis, `directLabel` is `entry.display` VERBATIM — the exact
 *     string the meta line's "newest:" readout cites;
 *   - when it is NOT (the newest witnessed batch is a refused / withheld /
 *     no-row / ∞ gap), `directLabel` is that SAME string plus a
 *     "(batch {id})" qualifier naming which batch the figure belongs to.
 *     The meta line shows the gap's own register for the newest batch, and
 *     the chart must never print an older number unqualified beside it.
 *
 * Composed HERE, pure, so the component never re-derives it. Null when
 * nothing plots.
 */
export interface NewestPlottedLabel {
  /** The last entry with finite geometry — where the sparkline's label sits. */
  entry: HistorySeriesEntry;
  /** True exactly when that entry IS the newest witnessed batch on the axis. */
  atNewestBatch: boolean;
  /** `entry.display` verbatim, or `entry.display` + " (batch {id})". */
  directLabel: string;
}

export function newestPlottedLabel(series: HistorySeries): NewestPlottedLabel | null {
  for (let i = series.entries.length - 1; i >= 0; i -= 1) {
    const entry = series.entries[i];
    if (entry !== undefined && entry.value !== null) {
      const atNewestBatch = i === series.entries.length - 1;
      return {
        entry,
        atNewestBatch,
        directLabel: atNewestBatch
          ? entry.display
          : `${entry.display} (batch ${String(entry.batchId)})`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// WAVE R1 ITEM 11 — the history panel's COPY LAYER.
//
// THE DEFECT THIS FIXES: the panel said "{n} point(s), oldest → newest ·
// covering {limit} retained batches" over a chart that was, on this
// deployment, entirely empty — because every "point" was a gap. A reader saw
// a count, an axis and no line, and had no way to learn that the count WAS
// the gaps. The vocabulary now separates what PLOTS from what is merely
// witnessed, and the all-gap and never-present cases get their own sentences
// instead of an empty frame.
// ---------------------------------------------------------------------------

/** The section head — what the chart IS, in the reader's words. */
export const HF_HISTORY_HEAD = "Health factor across batches";

/** The one-line doctrine that stays VISIBLE. The rest moves behind a details. */
export const HISTORY_DOCTRINE_LINE =
  "gaps break the line. Hover any tick for that batch's named reason.";

/** The <details> summary carrying the full doctrine paragraph. */
export const HISTORY_DOCTRINE_SUMMARY = "how gaps and the 1.0 line work";

/**
 * The Debt Manager's reference-line disclosure stays VISIBLE (not folded into
 * the details): a 1.0 line over a DISCLOSURE ratio, on an engine whose verdict
 * is a strict boolean, is exactly the conflation the surface must keep
 * refusing in plain sight.
 */
export const DM_DISCLOSURE_LINE =
  "1.0 here is a disclosure ratio and not the verdict; the engine's own boolean decides.";

/** How one engine's witnessed axis breaks down. */
export interface HistoryTally {
  /** `w` — every witnessed batch on this engine's axis. */
  witnessed: number;
  /** `p` — entries that actually PLOT (a finite geometry value). */
  plotted: number;
  noRow: number;
  refused: number;
  withheld: number;
  /** ∞ and unpublished — real gaps that are neither an absence nor a refusal. */
  other: number;
}

export function tallyHistory(series: HistorySeries): HistoryTally {
  const tally: HistoryTally = {
    witnessed: series.entries.length,
    plotted: 0,
    noRow: 0,
    refused: 0,
    withheld: 0,
    other: 0,
  };
  for (const entry of series.entries) {
    if (entry.value !== null) {
      tally.plotted += 1;
      continue;
    }
    if (entry.kind === "no-row") tally.noRow += 1;
    else if (entry.kind === "refused") tally.refused += 1;
    else if (entry.kind === "withheld") tally.withheld += 1;
    else tally.other += 1;
  }
  return tally;
}

/**
 * TRUE when this engine has NO history for the account at all: the wire
 * carried neither a persisted point nor a withheld batch for it, so every
 * entry on the axis is a NO-ROW gap borrowed from other engines' batches.
 *
 * That is not a broken chart — it is "this account has never held a position
 * on this engine in the retained window", and it deserves a sentence, not an
 * empty frame with an axis.
 */
export function engineNeverPresent(engine: AddressHistoryEngine): boolean {
  return engine.points.length === 0 && engine.withheld_batch_ids.length === 0;
}

/** The never-present line that REPLACES the whole chart frame. */
export function engineNeverPresentLine(engineName: string): string {
  return (
    `no ${engineName} history: this address has never had a ${engineName} position in the ` +
    `retained window.`
  );
}

/** The newest readout when the newest witnessed batch has no row for this engine. */
export function newestNoRowPhrase(engineName: string): string {
  return `newest: none · no ${engineName} row in the newest witnessed batch`;
}

/**
 * The meta line: what PLOTS out of what is WITNESSED, the newest readout, and
 * the window the request asked for — three different numbers that the old
 * "{n} point(s) … covering {limit} retained batches" ran together.
 */
export function historyMetaLine(
  tally: HistoryTally,
  newest: HistorySeriesEntry | null,
  engineName: string,
  limit: number,
): string {
  const newestPart =
    newest !== null && newest.kind === "no-row"
      ? newestNoRowPhrase(engineName)
      : `newest: ${newest?.display ?? EM_DASH}`;
  return (
    `${String(tally.plotted)} of ${String(tally.witnessed)} witnessed batches plot · ` +
    `${newestPart} · window: up to ${String(limit)} batches`
  );
}

/**
 * The text rendered INSIDE the frame when the engine has history but none of
 * it plots — every witnessed batch is a gap. The breakdown is the point: a
 * reader must be able to tell an absence from a refusal from a withheld book.
 *
 * The ruling names three classes; ∞/unpublished gaps are a fourth the ruling
 * does not template, appended only when non-zero so the counts still sum to
 * `w`. Reported, not improvised silently.
 */
export function allGapFrameText(tally: HistoryTally): string {
  const other = tally.other > 0 ? ` · ${String(tally.other)} ∞/unpublished` : "";
  return (
    `nothing plots: all ${String(tally.witnessed)} witnessed batches are gaps for this engine ` +
    `(${String(tally.noRow)} no-row · ${String(tally.refused)} refused · ` +
    `${String(tally.withheld)} withheld${other}). A gap is an absence or a refusal, never a ` +
    `zero; hover each tick for its named reason.`
  );
}
