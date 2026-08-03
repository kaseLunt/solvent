// HEADROOM — the Book's ONE native distance per engine (Wave W-HR-A).
//
// THE DEFECT THIS FIXES: the liq-distance column answered "which downward
// price move along the committed axis liquidates you". For a stable-collateral
// account there is no such move, so the column said `no price path` over ~81%
// of the $1k+ book — including accounts carrying real debt at HF 1.02. Every
// one of those sentences was TRUE and the headline was WRONG: the reader saw
// "safe" over a book that is one interest accrual from the boundary.
//
// The replacement metric answers the question a risk lead actually asks:
//
//   HEADROOM = the share of the account's borrowing capacity still unused
//              before liquidation
//            = (threshold_value − debt) / threshold_value
//
// Both engines publish that ratio as their health factor's OWN num/den, so
// ONE formula serves both — no per-engine arithmetic fork:
//
//   HF = threshold_value / debt  ⇒  headroom = 1 − 1/HF = (num − den) / num
//
//   - debt_manager: `health_factor.num` is maxBorrowLT (the threshold value)
//     and `health_factor.den` is borrowings (the debt), both usd6 decimal
//     strings on the wire — so headroom = (max_borrow_lt − borrowings) /
//     max_borrow_lt, exactly the ruling's DM formula.
//   - aave_v3_etherfi: `health_factor.wad` is the pool's own 1e18-scaled HF —
//     so with (num, den) = (hf, 1e18), headroom = (hf − 1e18) / hf, exactly
//     the ruling's Aave formula. The WAD is used (not num/den) because the
//     wad is the chain's own comparator.
//
// EXACTNESS LAWS carried here:
//   - every comparison is bigint. A band edge is decided by cross-multiplying
//     (100 × (num − den) vs edge × num), never by forming a float and testing
//     it against 2.0 — a float boundary is where a 1.9999999999999998 becomes
//     a 2 and an account changes bands for no reason on the wire.
//   - the displayed percent FLOORS. For a positive headroom that is exactly
//     truncation: 1.99% renders "1.9%" and NEVER "2%", because a rounded-up
//     headroom is a claim of safety the arithmetic did not make. For a
//     negative (breached) headroom, floor keeps the same direction — −31.25%
//     renders "−31.3%", never the flattering "−31.2%".
//
// Relative imports are not needed here (no local deps), but this module is
// exercised by the unit specs under Playwright's transpiler as well as by
// Next, so it stays dependency-free and pure.

/**
 * The warn edge, in headroom percent. Any warn styling or warn disclosure on
 * a headroom surface derives from THIS number — presentation only. Crit is
 * still the engine's own sealed verdict, never a band.
 */
export const WARN_HEADROOM_PCT = 10;

/**
 * The band edges, in percent, ascending. The seven bands are: breached, then
 * [0,2), [2,5), [5,10), [10,25), [25,50), [50,∞).
 *
 * ONE RULE, EVERYWHERE: every band is LEFT-CLOSED — a headroom exactly AT an
 * edge belongs to the band ABOVE it (`>= edge`, decided by cross-multiplication
 * in bigint). That rule has always been what the code does; the TOP band's
 * label used to contradict it by saying ">50%" while admitting exactly 50%,
 * which made the label a false statement about its own members. The rule is
 * kept and the LABEL is corrected (see HEADROOM_BANDS): "≥50%".
 */
export const HEADROOM_BAND_EDGES = [2, 5, 10, 25, 50] as const;

export interface HeadroomBand {
  id: string;
  /** The axis / cell label. */
  label: string;
  /** The band in READER WORDS — what it means, not what its edges are. */
  meaning: string;
}

/**
 * The seven bands, top-down (index 0 is breached — the row a reader's eye
 * lands on first). `meaning` is the hover's own sentence: a band label is a
 * number range, and a number range is not an explanation.
 */
export const HEADROOM_BANDS: readonly HeadroomBand[] = [
  {
    id: "breached",
    label: "breached",
    meaning: "debt is already past the liquidation threshold — no capacity left at all",
  },
  {
    id: "0-2",
    label: "0–2%",
    meaning: "under 2% of borrowing capacity left — interest alone can cross the boundary",
  },
  { id: "2-5", label: "2–5%", meaning: "2–5% of borrowing capacity left before liquidation" },
  { id: "5-10", label: "5–10%", meaning: "5–10% of borrowing capacity left before liquidation" },
  { id: "10-25", label: "10–25%", meaning: "10–25% of borrowing capacity left before liquidation" },
  { id: "25-50", label: "25–50%", meaning: "25–50% of borrowing capacity left before liquidation" },
  // THE TOP BAND IS LEFT-CLOSED LIKE EVERY OTHER ONE (Wave W-HR-B). An
  // account at exactly 50% headroom lands here — `headroomBand` admits it with
  // `scaled >= edge * num` — so ">50% / more than half" was a label that
  // excluded a member it contained, and a reader checking the boundary case
  // would have found the map disagreeing with its own axis. The band rule is
  // unchanged; the LABEL and the MEANING now state it: at least half.
  {
    id: "50-plus",
    label: "≥50%",
    meaning: "at least half the borrowing capacity is still unused",
  },
] as const;

/** The breached band's index — named so no call-site writes a bare 0. */
export const HEADROOM_BREACHED_BAND = 0;

/**
 * The Headroom column's one-sentence legend, RENDERED (not hover-only) so a
 * reader without a mouse gets the metric's definition.
 */
export const HEADROOM_LEGEND =
  "Headroom = the share of this account's borrowing capacity still unused before " +
  "liquidation — (liquidation threshold − debt) ÷ liquidation threshold, in the engine's own " +
  "comparator; 0% is the boundary and `breached` is already past it.";

/** The Headroom column header's own title attribute. */
export const HEADROOM_HEADER_TITLE =
  "how much of this account's borrowing capacity is still unused before liquidation — " +
  "truncated, never rounded up.";

/** What a row with no debt gets instead of a percent — never a 100% claim. */
export const HEADROOM_NO_DEBT_LABEL = "no debt";
export const HEADROOM_NO_DEBT_TITLE =
  "No debt — there is no liquidation boundary to have headroom from. Not a zero, and not " +
  "the safest account on the book: an account with nothing borrowed is simply outside this " +
  "metric.";

/** What a row whose headroom cannot be derived gets — an unknowable, not a zero. */
export const HEADROOM_UNKNOWN_TITLE =
  "Headroom is not derivable for this row: the engine published no usable threshold/debt " +
  "pair. Unknown — never a zero, and never 'safe'.";

/** Floor division for bigints (JS `/` truncates toward zero; this floors). */
function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  if (numerator % denominator !== 0n && numerator < 0n) return quotient - 1n;
  return quotient;
}

/**
 * Headroom in TENTHS OF A PERCENT, floored — the exact integer the display
 * string is rendered from, exposed so specs can pin the truncation without
 * parsing prose.
 *
 * `num`/`den` are the health factor's own numerator and denominator:
 * (max_borrow_lt, borrowings) for the Debt Manager, (hf_wad, 1e18) for Aave.
 *
 * Null when the ratio has no threshold to measure against (`num <= 0`): a
 * position with no borrowing capacity published has an UNKNOWN headroom, and
 * an unknown must never arrive at a caller as a number.
 */
export function headroomTenths(num: bigint, den: bigint): bigint | null {
  if (num <= 0n || den < 0n) return null;
  return floorDiv(1000n * (num - den), num);
}

/**
 * The DISPLAY percent, one fraction digit, FLOORED — "7.4%", "−31.3%", "0%".
 *
 * Floor, not round: 1.99% must never display as 2%, because a rounded-up
 * headroom overstates the capacity the account actually has. On the negative
 * (breached) side floor keeps pointing the same way, so a displayed headroom
 * is never friendlier than the true one.
 */
export function headroomPercent(num: bigint, den: bigint): string | null {
  const tenths = headroomTenths(num, den);
  if (tenths === null) return null;
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  const body = tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
  return `${negative ? "−" : ""}${body}%`;
}

/**
 * The breach predicate, exact: debt strictly above the threshold value.
 *
 * In HF terms that is den > num (HF < 1) — the SAME statement the engines
 * make, kept in integer space so an account at HF 0.9999999999999999 is never
 * rounded onto the safe side of the boundary.
 */
export function headroomBreached(num: bigint, den: bigint): boolean {
  if (num < 0n || den < 0n) return false;
  return den > num;
}

/**
 * The band index for an exact (num, den), or null when no band can be
 * claimed (`num === 0 && den === 0` — no capacity AND no debt: a ratio of
 * 0/0, which is not a band, not a zero, and not "safe").
 *
 * EVERY edge is decided by cross-multiplication in bigint:
 *
 *   headroom% ≥ edge   ⟺   100 × (num − den)  ≥  edge × num
 *
 * so 1.9999…% lands in [0,2) and exactly 2% lands in [2,5) — with no float
 * anywhere near the decision.
 */
export function headroomBand(num: bigint, den: bigint): number | null {
  if (num < 0n || den < 0n) return null;
  if (den > num) return HEADROOM_BREACHED_BAND;
  if (num === 0n) return null; // 0/0 — undefined, never a band
  const scaled = 100n * (num - den);
  for (let index = HEADROOM_BAND_EDGES.length - 1; index >= 0; index -= 1) {
    const edge = HEADROOM_BAND_EDGES[index];
    if (edge !== undefined && scaled >= BigInt(edge) * num) return index + 2;
  }
  return 1;
}

/**
 * True when the headroom is strictly below the warn edge — exact, same
 * cross-multiplication. Presentation only: this drives styling and the warn
 * disclosure, never a verdict.
 */
export function headroomBelowWarn(num: bigint, den: bigint): boolean {
  if (num <= 0n || den < 0n) return false;
  return 100n * (num - den) < BigInt(WARN_HEADROOM_PCT) * num;
}

/** The band's label, or "?" for an index outside the vocabulary. */
export function headroomBandLabel(band: number): string {
  return HEADROOM_BANDS[band]?.label ?? "?";
}

/** The band's reader-words meaning, or "" for an index outside the vocabulary. */
export function headroomBandMeaning(band: number): string {
  return HEADROOM_BANDS[band]?.meaning ?? "";
}

/** The warn-band disclosure for headroom surfaces — derived, never retyped. */
export const WARN_HEADROOM_DISCLOSURE = `presentation band < ${String(
  WARN_HEADROOM_PCT,
)}% headroom — not an engine threshold`;
