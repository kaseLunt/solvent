// Batch FRESHNESS, rendered (Wave R1, adjudicated ruling item 3).
//
// THE DEFECT THIS FIXES: `/v1/book` (and every lookup envelope) has always
// served `batch.computed_at` and `batch.age_seconds` — the database clock
// minus the batch's own compute time, never the server's wall clock — and
// the surfaces rendered neither. A page that shows "batch #5" without saying
// how old #5 is invites the reader to assume it is now. On this deployment
// the newest batch is routinely a day old; that is a fact the reader must be
// handed, not one they discover.
//
// Two laws in this module:
//   1. the age comes from the WIRE's `age_seconds`. It is not recomputed from
//      `computed_at` against the browser clock — a client clock is not the
//      database clock, and the contract already made that distinction.
//   2. `computed_at` renders VERBATIM (the ISO string the wire served). No
//      locale reformatting: a timestamp reformatted into the reader's zone is
//      a different statement from the one the service published.
//
// Pinned by tests/unit/freshness.spec.ts.

/**
 * A wire age in seconds as `{X}h {Y}m` — the coarse human form the stampline
 * and the head line carry. Under an hour it degrades to `{Y}m`, and under a
 * minute to `{S}s`, so a fresh batch never reads as "0h 0m".
 *
 * Negative input (a clock the service should never publish) floors at zero
 * rather than rendering a negative age.
 */
export function humanAge(ageSeconds: number): string {
  const total = Math.max(0, Math.floor(ageSeconds));
  if (total < 60) return `${String(total)}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

/** Whole hours, for the ribbon's coarse `· batch {X}h old` suffix. */
export function ageHours(ageSeconds: number): number {
  return Math.floor(Math.max(0, ageSeconds) / 3600);
}

/** The batch envelope fields this module reads — nothing else is needed. */
export interface FreshnessBatch {
  id: number;
  computed_at: string;
  age_seconds: number;
}

/**
 * The one freshness line every surface renders:
 *
 *   batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago
 */
export function batchFreshnessLine(batch: FreshnessBatch): string {
  return `batch ${batchFreshnessStamp(batch)}`;
}

/**
 * The same line MINUS its leading `batch ` — for the Stampline, whose own
 * `batch` label supplies that word. Rendered, the stamp reads the identical
 * sentence: `batch #5 · computed … · 24h 25m ago`.
 */
export function batchFreshnessStamp(batch: FreshnessBatch): string {
  return `#${String(batch.id)} · computed ${batch.computed_at} · ${humanAge(batch.age_seconds)} ago`;
}

/**
 * The stale threshold the PostureRibbon's suffix keys on: one hour. LIVE
 * describes the STREAM (it really is connected); the suffix describes the
 * BATCH (it really is old). Two subjects, two statements — the ribbon never
 * fakes a state it cannot know.
 */
export const RIBBON_STALE_BATCH_SECONDS = 3600;

/**
 * `· batch 24h old`, or null when the batch is inside the threshold. Null
 * means "render nothing" — the absence of the suffix is not a claim of
 * freshness beyond what LIVE already says.
 */
export function ribbonBatchAgeSuffix(ageSeconds: number): string | null {
  if (ageSeconds <= RIBBON_STALE_BATCH_SECONDS) return null;
  return `· batch ${String(ageHours(ageSeconds))}h old`;
}
