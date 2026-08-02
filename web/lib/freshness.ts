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

// ---------------------------------------------------------------------------
// THE ANCHOR (Wave R3, Codex round-10 MEDIUM): a wire age is a statement about
// an INSTANT, and rendering it forever turns a true statement into a false one.
//
// `age_seconds` is exactly right at the moment the response is built. Held on
// screen it decays into a lie: a tab left open across an afternoon kept
// reading "2m ago", and — worse — the LIVE ribbon's stale-batch suffix could
// never ENGAGE, because the number it tested was frozen 50s short of the hour
// and stayed there.
//
// So the wire age is ANCHORED at receipt and the elapsed interval is added:
//
//     rendered age = wire age_seconds + (now − receipt), monotonic
//
// LAW 1 OF THIS MODULE IS UNCHANGED, and the additive form is precisely how it
// survives: the age still ORIGINATES in the wire (the database clock minus the
// batch's compute time). The browser contributes only a DURATION — how long it
// has held the number — never a timestamp, and never an opinion about when the
// batch was computed.
//
// MONOTONIC, NOT WALL: the elapsed interval is measured with
// `performance.now()`. `Date.now()` can be stepped backwards or forwards by
// NTP correction, by suspend/resume, or by a user editing the system clock,
// and a stepped wall clock would make a rendered age jump or run backwards.
// `performance.now()` cannot be stepped.
// ---------------------------------------------------------------------------

/**
 * The monotonic clock this module measures elapsed time against. Named so a
 * caller (and a test) can see there is exactly one, and that it is not a wall
 * clock.
 */
export function monotonicNowMs(): number {
  return performance.now();
}

/** A wire `age_seconds` pinned to the monotonic reading taken at RECEIPT. */
export interface AgeAnchor {
  /** The wire's own number, verbatim — the only origin of the age. */
  readonly wireAgeSeconds: number;
  /** `performance.now()` when this tab was handed that number. */
  readonly receivedAtMs: number;
}

/** Pin a freshly-received wire age to the monotonic clock. */
export function anchorWireAge(wireAgeSeconds: number, nowMs: number = monotonicNowMs()): AgeAnchor {
  return { wireAgeSeconds, receivedAtMs: nowMs };
}

/**
 * The batch's age RIGHT NOW: the wire's age plus the interval since receipt.
 *
 * Elapsed floors at zero, so a monotonic reading that somehow moves backwards
 * renders the wire's own age rather than a younger one — an age this module
 * publishes is never fresher than the wire licensed.
 */
export function anchoredAgeSeconds(anchor: AgeAnchor, nowMs: number = monotonicNowMs()): number {
  return anchor.wireAgeSeconds + Math.max(0, nowMs - anchor.receivedAtMs) / 1000;
}

/**
 * The re-render cadence for an anchored age. A minute is coarse enough for a
 * TEXT age (nothing animates, so reduced-motion has no bearing) and fine
 * enough that every boundary this module renders — the second→minute step, the
 * minute→hour step, and the ribbon's 1h stale threshold — is crossed within
 * one tick of becoming true.
 */
export const AGE_TICK_MS = 60_000;

/**
 * The one freshness line every surface renders:
 *
 *   batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago
 *
 * `ageSeconds` is the ANCHORED age (see above). Omitted, it falls back to the
 * wire's own frozen number — correct at receipt, and the honest floor for any
 * caller that has not anchored.
 */
export function batchFreshnessLine(batch: FreshnessBatch, ageSeconds?: number): string {
  return `batch ${batchFreshnessStamp(batch, ageSeconds)}`;
}

/**
 * The same line MINUS its leading `batch ` — for the Stampline, whose own
 * `batch` label supplies that word. Rendered, the stamp reads the identical
 * sentence: `batch #5 · computed … · 24h 25m ago`.
 */
export function batchFreshnessStamp(batch: FreshnessBatch, ageSeconds?: number): string {
  const age = ageSeconds ?? batch.age_seconds;
  return `#${String(batch.id)} · computed ${batch.computed_at} · ${humanAge(age)} ago`;
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
 *
 * Fed the ANCHORED age (Wave R3), this suffix now ENGAGES while the page is
 * open: a batch received 50s inside the hour crosses the threshold on the
 * next tick and says so, instead of staying silent forever on a frozen number.
 */
export function ribbonBatchAgeSuffix(ageSeconds: number): string | null {
  if (ageSeconds <= RIBBON_STALE_BATCH_SECONDS) return null;
  return `· batch ${String(ageHours(ageSeconds))}h old`;
}
