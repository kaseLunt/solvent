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
// WAVE R5, Codex round-12 MEDIUM (1): WHAT MAKES A RECEIPT *NEW*.
//
// R3/R4 keyed re-anchoring on the wire VALUE: a response whose `age_seconds`
// differed from the one on screen was a new receipt; a response repeating the
// same integer kept the older anchor, so the rendered age kept climbing rather
// than snapping back.
//
// That was right about which error to prefer and wrong about the test.
// `age_seconds` is an INTEGER of seconds, and a page that re-fetches on resume
// asks for a fresh batch at whatever cadence the reader's lifecycle produces.
// When the request cadence and the batch cadence line up — and they do, because
// both hang off the same publishing loop — batch #7 fetched two minutes after
// it was computed carries EXACTLY the `age_seconds` batch #6 carried two
// minutes after IT was computed. Under the value test that new, genuinely
// fresher receipt inherited the old anchor AND the old accumulated interval,
// and a batch two minutes old rendered as an hour and two minutes old: fresh
// data presented as stale, with no path back short of a reload.
//
// Over-stating is the error R4 licensed the floor to make — but only until the
// next receipt corrected it. The correction has to be able to LAND.
//
// So identity moves off the value and onto the RECEIPT: `served_at` — the
// instant the SERVICE built the response, which every /v1 envelope carries and
// which is distinct per response — plus the batch id where the caller has one.
// Any new successful receipt re-anchors, at equal `age_seconds` or not. A
// FAILED re-fetch produces no receipt at all and therefore still cannot
// re-anchor anything (live-age.ts's `keepOnFailure` path is untouched).
// ---------------------------------------------------------------------------

/** A wire age together with the identity of the receipt that carried it. */
export interface AgeReceipt {
  /** The wire's own `age_seconds`, from THIS response. */
  readonly ageSeconds: number;
  /**
   * The identity of that successful receipt — see `receiptIdentity`. Two
   * different responses never share one; one response re-rendered always does.
   */
  readonly receiptId: string;
}

/**
 * The identity of ONE successful receipt.
 *
 * `servedAt` is the envelope's `served_at` (the database clock at the instant
 * the service built the response). It is used here ONLY as an identity: it is
 * never differenced against a browser clock and never contributes to an age.
 * LAW 1 IS UNTOUCHED — the age still originates in the wire's `age_seconds`,
 * and the browser still contributes only a duration.
 *
 * `batchId` is folded in where the caller has one, so two responses a coarse
 * `served_at` could not separate are still separated by the batch they describe.
 */
export function receiptIdentity(servedAt: string, batchId: number | null = null): string {
  return batchId === null ? servedAt : `${servedAt}#${String(batchId)}`;
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

// ---------------------------------------------------------------------------
// WAVE R5, Codex round-12 MEDIUM (2): TWO BLIND CLOCKS ARE NOT AN ABSENCE OF
// EVIDENCE.
//
// R4 decided whether a lifecycle event was a real resume by asking the two
// clocks how much time had passed. Both can be blind AT ONCE: a multi-hour
// suspend PAUSES `performance.now()` (delta ~ 0) and, on that same wake, the OS
// corrects a skewed wall clock BACKWARD by a comparable interval (delta <= 0).
// Both readings fall inside the coalescing window, the lifecycle burst is
// dismissed as the second and third events of a resume nobody ever handled, and
// the page reconciles NOTHING — no recompute, no repair re-fetch. The age, and
// the stale-batch ribbon that is nothing but a function of it, stay hours
// fresher than the truth. That is stale data presented as fresh, which is the
// exact direction this module exists to prevent.
//
// The clocks were never the only evidence available. Two lifecycle facts PROVE
// a resume with no arithmetic at all:
//
//   · `pageshow` with `persisted === true` — the document was restored FROM the
//     bfcache. It was not running; now it is.
//   · a signal arriving VISIBLE when this page has been observed HIDDEN since
//     its last reconcile — it went away, and it is back. (`visibilitychange`
//     hidden->visible is exactly this pair of facts.)
//
// Neither is an inference from a duration, so neither can be defeated by a
// clock. Both force the reconcile path outright.
//
// COALESCING SURVIVES, and not by measuring: the away evidence is CONSUMED by
// the reconcile it triggers. A restore fires pageshow, then visibilitychange,
// then focus; the first forces a reconcile, clears the away flag and re-marks
// both clocks, and the remaining two — no longer carrying definitive evidence —
// fall back to the delta test against a mark taken AFTER the resume, where the
// clocks are honest again. One resume, one reconcile, one re-fetch. A LATER
// suspend re-arms the flag on its own way out (visibilitychange to hidden,
// pagehide), so the second restore is proven exactly as the first was rather
// than being trusted to a clock that has already been shown to lie.
//
// A `pageshow` is the exception that needs its own guard: it states its own
// case and does not consult the flag, so a restore delivering its events in
// any other order would prove itself twice. A definitive signal arriving after
// a reconcile that was ITSELF proven, with no departure recorded since, is the
// same restore speaking again — see `ResumeTracker.lastReconcileProven`.
//
// A BARE `focus` — no persisted pageshow, no recorded hide — stays delta-gated.
// A window merely raised is not evidence that anything was suspended, and
// re-fetching an aggregate every time a reader alt-tabs would be a cost paid
// for no truth.
// ---------------------------------------------------------------------------

/** What a lifecycle signal PROVES about a resume, before any clock is read. */
export type ResumeEvidence = "definitive" | "ambiguous";

/**
 * The events that mean "this page is going AWAY" — the evidence that the next
 * return is a resume. `visibilitychange` also carries a departure, but it earns
 * that by its own `visible: false` reading rather than by name, so it stays
 * listed once, in RESUME_EVENTS.
 */
export const HIDE_EVENTS = ["pagehide"] as const;

/** One lifecycle event, reduced to the facts that decide a reconcile. */
export interface ResumeSignal {
  /** The event's `type`. */
  readonly type: string;
  /** `PageTransitionEvent.persisted` — true ONLY for a bfcache restore. */
  readonly persisted?: boolean;
  /** `document.visibilityState === "visible"`, READ AT THE EVENT. */
  readonly visible?: boolean;
}

/** Everything the resume path remembers between signals. */
export interface ResumeTracker {
  /** Both clock readings taken at the last reconcile — null before the first. */
  readonly lastResume: ResumeMark | null;
  /**
   * This page has been observed HIDDEN (or stowed in the bfcache) since that
   * reconcile. It is the definitive half of the evidence, and it is CONSUMED —
   * not merely tested — by the reconcile it triggers.
   */
  readonly hiddenSinceReconcile: boolean;
  /**
   * That last reconcile was itself forced by definitive evidence, rather than
   * taken at a receipt or earned on the clocks.
   *
   * It is what makes the burst coalesce in ANY order. A `pageshow` states its
   * own case and does not need the away flag — so a restore that delivers
   * `visibilitychange` first would otherwise reconcile twice, once on each. A
   * definitive signal arriving after a PROVEN reconcile, with no departure
   * recorded since, is the same restore speaking again; it is delta-gated like
   * any echo. A genuinely later suspend always records its departure first, so
   * this can never suppress a second real resume.
   */
  readonly lastReconcileProven: boolean;
}

// ---------------------------------------------------------------------------
// WAVE R6, Codex round-13 MEDIUM (1 and 2): A RESUME THE EVIDENCE PROVES AND
// THE CLOCKS CANNOT MEASURE IS AN UNKNOWN AGE, NOT A SMALL ONE.
//
// R5 made definitive lifecycle evidence outrank both clocks, so the resume is
// no longer DISMISSED. But being handled is not being measured. On the wake R5
// exists for — `performance.now()` paused by a three-hour suspend, the wall
// clock stepped backward on the same wake — the reconcile that now runs
// recomputes `max(monotonic-derived, wall-derived, floor)` and adds NOTHING.
// The evidence proves an interval passed; neither clock will say how long.
//
// R5 answered that with a re-fetch, and a re-fetch is the right repair. It is
// not a guarantee:
//
//   · THE RIBBON (round-13 finding 1) had no repair path at all. Its batch
//     arrives on the SSE stream, and a healthy-but-idle stream — heartbeats,
//     no new snapshot or batch frame — delivers no new receipt for as long as
//     the publishing loop is quiet. A batch received at 130s before a
//     three-hour sleep therefore kept rendering under the one-hour threshold
//     for another ~58 minutes: `LIVE · WATERMARKED`, no stale suffix, over
//     data hours old.
//   · THE SURFACES THAT DO OWN A FETCH (round-13 finding 2) consumed the
//     departure evidence and re-marked both clocks BEFORE the fire-and-forget
//     re-fetch. When that fetch failed — and `keepOnFailure` hides the failure,
//     correctly, because a woken laptop with no network must not lose its data
//     — "2m ago" stood, the proof of the missing interval was already spent,
//     and every later tick added only post-wake time.
//
// Both are the same defect: an age the page cannot measure, rendered as a
// number. So the law gains ONE new fact, and the callers gain ONE new state.
//
// A BLIND RESUME is a reconcile that (a) was forced by DEFINITIVE evidence and
// (b) the delta test alone would have refused. The evidence proves a gap; the
// clocks certify none of it; the recompute is therefore an UNDERSTATEMENT of
// unknown size. A CLOCK-CERTIFIED resume — deltas at or past the coalescing
// window — is NOT blind: the recompute measures it, and the number that comes
// out is a true statement about the batch, exactly as R4 established.
//
// The caller learns this as `ResumeOutcome.blind`, and what it owes the reader
// is in live-age.ts and the surfaces: while a blind resume stands unrepaired
// the age renders UNKNOWN — never the understated number, and never a claim of
// staleness either, because "I cannot say" is a refusal to state, not a
// verdict. THE ONLY DISCHARGE IS A NEW RECEIPT. A later clock-certified
// lifecycle reconcile does not clear it: measuring the time since the wake says
// nothing about the interval the wake itself swallowed.
// ---------------------------------------------------------------------------

/** The decision, and the tracker to carry into the next signal. */
export interface ResumeOutcome {
  readonly reconcile: boolean;
  /**
   * This reconcile was PROVEN by evidence and MEASURED by neither clock (Wave
   * R6) — see `isBlindResume`. False on every non-reconcile, on every
   * clock-certified resume, and on the first signal of a page that has no mark
   * to measure against.
   */
  readonly blind: boolean;
  readonly tracker: ResumeTracker;
}

/**
 * THE BLIND-RESUME PREDICATE, in one place so the surfaces and the tests read
 * the same sentence:
 *
 *     blind = the evidence forced this reconcile
 *             AND the clock deltas alone would have refused it
 *
 * `provenByEvidence` is `trackResumeSignal`'s own `proven` — definitive
 * evidence that is not the echo of a resume already handled. `clockCertified`
 * is `shouldReconcileOnResume` with NO evidence: the pure delta test.
 *
 * Both halves are required. Definitive evidence with certified deltas is a
 * resume the recompute genuinely measures (a sleep the wall clock saw), and
 * calling that unknown would raise a false alarm over an age the page can state
 * exactly. Certified deltas without definitive evidence is R4's ordinary path,
 * likewise measured.
 */
export function isBlindResume(provenByEvidence: boolean, clockCertified: boolean): boolean {
  return provenByEvidence && !clockCertified;
}

/** The tracker a page starts with: nothing reconciled, nothing hidden. */
export const INITIAL_RESUME_TRACKER: ResumeTracker = {
  lastResume: null,
  hiddenSinceReconcile: false,
  lastReconcileProven: false,
};

/** Whether this signal says the page LEFT, rather than that it came back. */
export function isHideSignal(signal: ResumeSignal): boolean {
  if (signal.type === "pagehide") return true;
  return signal.type === "visibilitychange" && signal.visible === false;
}

/**
 * Whether this signal PROVES a resume, independent of every clock.
 *
 * `hiddenSinceReconcile` is the caller's record of a departure it has not yet
 * reconciled against — see `trackResumeSignal`, which consumes it.
 */
export function resumeEvidenceOf(
  signal: ResumeSignal,
  hiddenSinceReconcile: boolean,
): ResumeEvidence {
  // A bfcache restore states its own case, and states it first: the flag is not
  // consulted, because a restore is proof whether or not this tab saw the stow.
  if (signal.type === "pageshow" && signal.persisted === true) return "definitive";
  if (hiddenSinceReconcile && signal.visible === true) return "definitive";
  return "ambiguous";
}

/**
 * Whether a resume signal is a NEW resume rather than the second or third
 * event of one the caller already handled.
 *
 * DEFINITIVE EVIDENCE OUTRANKS BOTH CLOCKS (Wave R5). Without it, the elapsed
 * test takes the LARGER of the two clocks' deltas, because either clock alone
 * can be blind: after a sleep the monotonic delta is ~0 and only the wall shows
 * the gap, and after a backwards wall step the wall delta is negative and only
 * the monotonic clock shows it. Requiring both to agree would coalesce away
 * exactly the resumes that matter — and R5's finding is that requiring EITHER
 * still coalesces away the resume where both are blind at once.
 */
export function shouldReconcileOnResume(
  last: ResumeMark | null,
  nowMs: number,
  wallMs: number,
  evidence: ResumeEvidence = "ambiguous",
): boolean {
  if (last === null) return true;
  if (evidence === "definitive") return true;
  const elapsedMs = Math.max(nowMs - last.monotonicMs, wallMs - last.wallMs);
  return elapsedMs >= RESUME_COALESCE_MS;
}

/**
 * ONE lifecycle signal folded into the resume state: whether to reconcile now,
 * and what to remember for the next signal.
 *
 * This is the whole decision, kept pure so it can be driven event by event with
 * both clocks under a test's control — the resume defects of R4 and R5 both
 * live in the gap between what a clock says and what actually happened.
 */
export function trackResumeSignal(
  tracker: ResumeTracker,
  signal: ResumeSignal,
  nowMs: number,
  wallMs: number,
): ResumeOutcome {
  // A departure is never a resume — it is the evidence that the next return is.
  if (isHideSignal(signal)) {
    return {
      reconcile: false,
      blind: false,
      tracker: { ...tracker, hiddenSinceReconcile: true },
    };
  }
  // What the clocks alone would say. Consulted three times below: once to
  // recognise an echo of a resume already proven, once as the fallback for a
  // signal that proves nothing, and once — as the second half of
  // `isBlindResume` — to ask whether this reconcile was MEASURED as well as
  // proven.
  const clocksAgree = shouldReconcileOnResume(tracker.lastResume, nowMs, wallMs);
  const evidence = resumeEvidenceOf(signal, tracker.hiddenSinceReconcile);
  // THE ECHO: definitive evidence arriving after a reconcile that was ITSELF
  // proven, with no departure recorded since and both clocks showing a burst's
  // worth of time. That is one restore speaking twice, not two restores.
  const echo =
    evidence === "definitive" &&
    tracker.lastReconcileProven &&
    !tracker.hiddenSinceReconcile &&
    !clocksAgree;
  const proven = evidence === "definitive" && !echo;
  if (!proven && !clocksAgree) return { reconcile: false, blind: false, tracker };
  // The reconcile CONSUMES the away evidence and re-marks both clocks, so the
  // rest of this burst is measured against a reading taken after the resume.
  return {
    reconcile: true,
    // WAVE R6: proven, and measured by neither clock. The recompute this
    // reconcile is about to run cannot add the interval the evidence proves,
    // so the age it produces is an understatement of unknown size and the
    // caller must stop presenting it as the age.
    blind: isBlindResume(proven, clocksAgree),
    tracker: {
      lastResume: { monotonicMs: nowMs, wallMs },
      hiddenSinceReconcile: false,
      lastReconcileProven: proven,
    },
  };
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
 * THE BOUNDED REPAIR SCHEDULE for a blind resume (Wave R6).
 *
 * The first attempt is IMMEDIATE and is not in this list — it is the reconcile
 * itself. These are the delays before the retries that follow a FAILED attempt,
 * in order. The list ENDS: a page that cannot be repaired says so and stops,
 * because an unbounded retry over an endpoint that is not answering is a
 * denial-of-service the reader never asked for, and because "still trying"
 * forever is not more honest than "I could not".
 *
 * Two retries at 5s and 15s cover the failure this exists for — a woken laptop
 * whose network interface is not up yet, which is a matter of seconds — without
 * turning a genuinely-down service into a polling loop. Nothing is hidden by
 * stopping: the surface keeps disclosing that the age is unknown.
 */
export const RESUME_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/**
 * The delay before retry number `retriesMade` (0-based), or null when the
 * schedule is spent. Null is the whole bound — there is no branch that can
 * produce another delay.
 */
export function resumeRetryDelayMs(retriesMade: number): number | null {
  return RESUME_RETRY_DELAYS_MS[retriesMade] ?? null;
}

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

// ---------------------------------------------------------------------------
// THE UNKNOWN REGISTER (Wave R6). One vocabulary, three surfaces.
//
// What is unknown is the AGE, and only the age. The batch id and its
// `computed_at` are facts the wire published and they keep rendering verbatim
// — withholding them would be a second, invented refusal. The data itself is
// never blanked: a table is not made more honest by being emptied.
//
// AND THIS IS NOT A STALENESS CLAIM. "I cannot say how old this is" is a
// refusal to state, not a verdict that the batch is old. The ribbon therefore
// does NOT render its `· batch Xh old` suffix while the age is unknown: that
// suffix is a computed claim, and there is nothing left to compute it from.
// ---------------------------------------------------------------------------

/** The age line while a blind resume's repair is still being attempted. */
export const AGE_UNKNOWN_REFRESHING = "age UNKNOWN since resume · refreshing";

/**
 * The age line once the bounded repair schedule is spent. The data stays; only
 * the age is withheld, and the reader is told which of the two it is looking at.
 */
export const AGE_UNKNOWN_REFRESH_FAILED =
  "age UNKNOWN since resume · refresh failed, data retained";

/** The one phrase, chosen by whether anything is still being attempted. */
export function unknownAgePhrase(refreshFailed: boolean): string {
  return refreshFailed ? AGE_UNKNOWN_REFRESH_FAILED : AGE_UNKNOWN_REFRESHING;
}

/**
 * `batchFreshnessStamp` with the age REFUSED rather than stated (Wave R6).
 * Same shape, same separators, same verbatim `computed_at` — the reader's eye
 * lands in the same place and finds a refusal instead of a number.
 */
export function batchFreshnessStampUnknown(batch: FreshnessBatch, refreshFailed: boolean): string {
  return `#${String(batch.id)} · computed ${batch.computed_at} · ${unknownAgePhrase(refreshFailed)}`;
}

/** The head-line form of the same statement. */
export function batchFreshnessLineUnknown(batch: FreshnessBatch, refreshFailed: boolean): string {
  return `batch ${batchFreshnessStampUnknown(batch, refreshFailed)}`;
}

/**
 * The RIBBON's suffix while the age is unknown — the slot `ribbonBatchAgeSuffix`
 * would have filled, carrying a refusal instead of a computed `Xh old`.
 *
 * It is never null: the whole finding is that SILENCE in this slot reads as
 * freshness, and a page that cannot state the age must not fall silent.
 */
export function ribbonBatchAgeUnknown(refreshFailed: boolean): string {
  return `· batch ${unknownAgePhrase(refreshFailed)}`;
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
