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
//
// ---------------------------------------------------------------------------
// WAVE R4, Codex round-11 MEDIUM: A MONOTONIC CLOCK CANNOT BE STEPPED — BUT IT
// CAN BE PAUSED, AND R3 DID NOT ACCOUNT FOR THAT.
//
// `performance.now()` stops advancing while the machine is suspended (WebKit
// bug 225610, Mozilla bug 1709767), and a page restored from the bfcache has
// had its timers suspended for however long it sat there. A lid closed at
// 14:00 and reopened at 20:00 came back to a tab whose monotonic clock
// believed six hours were a few milliseconds. R3's age therefore UNDER-STATED
// by six hours, and `ribbonBatchAgeSuffix` — which is nothing but a function
// of that age — stayed silent over a batch a day old. Under-stating an age is
// the one error this module may not make.
//
// So the elapsed interval is now measured against BOTH clocks and clamped:
//
//     rendered age = max(monotonic-derived, wallclock-derived, last-rendered)
//
//   · SLEEP cannot freeze it — the wall clock kept running while
//     `performance.now()` did not, so the wall-derived candidate wins.
//   · A STEPPED WALL CLOCK cannot rewind it — the monotonic candidate and the
//     floor are both untouched by an NTP correction, and the max takes them.
//   · NOTHING can move a rendered age BACKWARDS inside one receipt: the
//     last-rendered value is a floor. A spuriously forward wall step therefore
//     over-states permanently, until the next receipt corrects it — and of the
//     two errors available, over-stating is the one this product is allowed to
//     make.
//
// LAW 1 SURVIVES INTACT, for the same reason it survived R3: both candidates
// are `wireAge + a DURATION`. The browser still contributes only how long it
// has held the number — never a timestamp, and never an opinion about when the
// batch was computed. `Date.now()` appears here as a STOPWATCH (a difference
// of two readings), never as a clock read against `computed_at`.
//
// THE FLOOR IS PER-RECEIPT, not global. A genuinely NEW wire age is a new
// statement and resets it — otherwise the background re-fetch that exists to
// replace an estimate with a true number could never lower it, and a fresh
// batch would be rendered as old as the stale one it replaced.
// ---------------------------------------------------------------------------

/**
 * The monotonic clock this module measures elapsed time against. Named so a
 * caller (and a test) can see there is exactly one, and that it is not a wall
 * clock.
 */
export function monotonicNowMs(): number {
  return performance.now();
}

/**
 * The WALL clock, read in exactly one place (Wave R4). It is the FALLBACK
 * stopwatch, never the primary one and never a timestamp: only differences of
 * two readings leave this module, and every such difference is clamped by
 * `anchoredAgeSeconds` so a stepped clock cannot be believed downwards.
 */
export function wallNowMs(): number {
  return Date.now();
}

/** A wire `age_seconds` pinned to BOTH clock readings taken at RECEIPT. */
export interface AgeAnchor {
  /** The wire's own number, verbatim — the only origin of the age. */
  readonly wireAgeSeconds: number;
  /** `performance.now()` when this tab was handed that number. */
  readonly receivedAtMs: number;
  /**
   * `Date.now()` at the SAME receipt (Wave R4). Kept beside the monotonic
   * reading, not instead of it: the pair is what makes a sleep detectable —
   * a sleep is exactly the interval the two readings disagree about.
   */
  readonly receivedAtWallMs: number;
}

/** Pin a freshly-received wire age to both clocks. */
export function anchorWireAge(
  wireAgeSeconds: number,
  nowMs: number = monotonicNowMs(),
  wallMs: number = wallNowMs(),
): AgeAnchor {
  return { wireAgeSeconds, receivedAtMs: nowMs, receivedAtWallMs: wallMs };
}

/**
 * The batch's age RIGHT NOW: the wire's age plus the LARGEST honest interval
 * since receipt, and never less than what was last rendered.
 *
 * Each elapsed interval floors at zero, so a clock that moves backwards
 * contributes the wire's own age rather than a younger one — an age this
 * module publishes is never fresher than the wire licensed.
 *
 * `floorSeconds` is the caller's last RENDERED age for THIS anchor (see the
 * per-receipt note above). Omitted, there is no floor beyond the two clocks.
 */
export function anchoredAgeSeconds(
  anchor: AgeAnchor,
  nowMs: number = monotonicNowMs(),
  wallMs: number = wallNowMs(),
  floorSeconds = 0,
): number {
  const monotonicDerived = anchor.wireAgeSeconds + Math.max(0, nowMs - anchor.receivedAtMs) / 1000;
  const wallDerived = anchor.wireAgeSeconds + Math.max(0, wallMs - anchor.receivedAtWallMs) / 1000;
  return Math.max(monotonicDerived, wallDerived, floorSeconds);
}

// ---------------------------------------------------------------------------
// RECONCILIATION ON RESUME (Wave R4, part b).
//
// The minute tick cannot fire while the tab is suspended, so a resumed page
// would otherwise render a stale age for up to a full tick after the reader is
// looking at it again. These are the three events that mean "this tab may have
// been suspended", and a single resume fires ALL THREE — hence the coalescing
// window: three events, one reconcile, one background re-fetch.
// ---------------------------------------------------------------------------

/**
 * `pageshow` is the bfcache restore; `visibilitychange` covers a tab brought
 * forward or a screen unlocked; `focus` covers a window raised without either.
 * Listed here so the set is one fact in one place, and pinned by
 * tests/unit/freshness-resume.spec.ts.
 */
export const RESUME_EVENTS = ["pageshow", "visibilitychange", "focus"] as const;

/**
 * Resume signals closer together than this are ONE resume.
 *
 * It has two jobs, and the second sets the value. Collapsing the three-event
 * burst of a single restore needs only milliseconds. But `focus` also fires
 * every time the window is merely raised, and `/v1/book` is an aggregate the
 * surface already refuses to hammer (see BookSurface's heal-once batch guard),
 * so the window is wide enough to bound an alt-tabbing reader to a handful of
 * re-fetches a minute. Five seconds costs the reader NOTHING in honesty: the
 * age it suppresses recomputing is at most five seconds stale on a display
 * whose finest unit is a second and whose usual unit is a minute — and a
 * resume worth reconciling (a sleep, a bfcache restore) always shows a gap far
 * larger than this on at least one of the two clocks.
 */
export const RESUME_COALESCE_MS = 5_000;

/** Both clock readings taken at the last reconcile. */
export interface ResumeMark {
  readonly monotonicMs: number;
  readonly wallMs: number;
}

/**
 * Whether a resume signal is a NEW resume rather than the second or third
 * event of one the caller already handled.
 *
 * The elapsed test takes the LARGER of the two clocks' deltas, because the
 * whole finding is that either clock alone can be blind: after a sleep the
 * monotonic delta is ~0 and only the wall shows the gap, and after a backwards
 * wall step the wall delta is negative and only the monotonic clock shows it.
 * Requiring both to agree would coalesce away exactly the resumes that matter.
 */
export function shouldReconcileOnResume(
  last: ResumeMark | null,
  nowMs: number,
  wallMs: number,
): boolean {
  if (last === null) return true;
  const elapsedMs = Math.max(nowMs - last.monotonicMs, wallMs - last.wallMs);
  return elapsedMs >= RESUME_COALESCE_MS;
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
