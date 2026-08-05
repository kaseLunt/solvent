// Verbatim copy from the solvent-design SUPPLEMENT ruling (16–18 + captions
// a/b/c), shared across the Book and Lab surfaces so the same sentence can
// never fork. Tests pin every string independently — a reword here fails the
// suite, which is the point.

/**
 * W-HR-A — the risk map's dek. It names the two axes in reader words and the
 * marginal that makes the grid readable; it does NOT name a scatter, because
 * there is no longer a scatter and a dek that describes a dead register is a
 * lie with good intentions.
 */
// "plotted debt", never "the book's debt" (Codex r55): the map excludes the
// source-filtered rows, so its Σ is NOT the on-book Σ the summary cards carry.
// A dek that says "the book's" beside an ANSWER that says "mapped here" hands
// the reader two contradictory totals under one name.
export const RISK_MAP_DEK =
  "Where plotted debt sits by headroom: the share of borrowing capacity each account has " +
  "left before liquidation. Rows are headroom bands, columns are debt size, and the right " +
  "margin carries each band's exact Σ debt. A band holding few accounts can still carry more " +
  "debt than a crowded one.";

/** §18 — the waterfall section note, verbatim. */
export const WATERFALL_SECTION_NOTE =
  "If the shocked asset fell step by step, how much debt could the engine liquidate, and " +
  "how much would it lose? Bars: cumulative eligible debt at each price. ×1.00 is the " +
  "standing census; every lower point is a projection.";

/** §18 — the one dim legend line under the waterfall panel grid, verbatim. */
export const BAD_DEBT_LEGEND =
  "bad debt = debt still owed after all collateral is seized, the protocol's loss at that price.";

/** Caption (b) — the eligible-vs-realized primary gloss, verbatim. */
export const ELIGIBLE_REALIZED_GLOSS =
  '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
  "closes can be less: the Debt Manager liquidates in two passes, half the debt, then " +
  "the remainder.";

/**
 * Caption (a) — the always-visible held-flat summary, verbatim template.
 * Count-aware (W-UX-C micro-ruling 3): "1 price input held flat" at n = 1 —
 * prose pluralizes; label-value grammar elsewhere may stay invariant.
 */
export function heldFlatSummary(n: number): string {
  const head = n === 1 ? "1 price input held flat" : `${String(n)} price inputs held flat`;
  return (
    `${head}. The scenario did not move these prices, so ` +
    "positions priced by them are stressed at stale marks. Each one keeps its standing value, " +
    "and the scenario is blind to where it would have gone."
  );
}

/** Caption (a) — the counted <details> summary line, verbatim template. */
export function heldFlatDetailsSummary(n: number): string {
  return `held flat: ${String(n)} inputs named`;
}

/**
 * WAVE W-3L — the Book waterfall's FORENSICS summary (template slot 7).
 *
 * It COUNTS the held-flat inputs it hides, because the count itself stays
 * visible in STATE and this line must agree with it. What sits behind the
 * disclosure is a named list, a definition and a wire note: no refusal, no
 * unknowable, and no count that exists nowhere else (R3).
 */
export function waterfallForensicsSummary(n: number): string {
  const held = n === 0 ? "no held-flat inputs" : `${String(n)} held-flat inputs named`;
  return `Exact data: ${held}, the bad-debt definition, and the wire's eligibility note`;
}

/**
 * Caption (a) — the held-flat value column header. The wire declares no
 * decimals for `held_flat[].value`, so scaling it to USD would be
 * fabrication; the header says so instead.
 */
export const HELD_FLAT_VALUE_HEADER = "held value (source's raw units, unscaled by design)";

/** Caption (c) — the collateral-at-risk reader caption (title text), verbatim. */
export const AT_RISK_READER_CAPTION =
  "collateral at risk is re-measured at each price step, so it can fall as prices fall, " +
  "because the same collateral is worth less. A dip in the line comes from that arithmetic, " +
  "not from missing data.";

/** Caption (c) — the Lab book panel's counted wire-notes summary, verbatim template. */
export function wireNotesSummary(n: number): string {
  return `wire notes: ${String(n)}, verbatim`;
}

// ---------------------------------------------------------------------------
// CX-5 / CX-6 — the risk-band distribution.
//
// THE RENAME. "HF histogram" named the wire field, not the thing. Only one of
// the two engines publishes a health factor as its comparator at all: the Debt
// Manager's buckets are the exact rational maxBorrowLT/borrowings, a
// DISCLOSURE rather than a trigger. A reader who takes "HF histogram" at face
// value reads one engine's disclosure as the other engine's verdict. The wire
// field `hf_histogram` and every testid are UNCHANGED — this is display only.
//
// THE PERCENT AXIS. Bar length used to be `count / largestBucket`, so the
// tallest bucket was always full width and the axis had no meaning. Within one
// engine that differs from `count / engineTotal` by a constant factor, so the
// within-engine SHAPE survives the change — and a named denominator on a
// common 0–100% axis is a reading rather than a ranking. Percentages are
// dimensionless (LAW-2), so the two engine panels may sit side by side without
// creating a forbidden cross-engine aggregate; each still names its own
// denominator.
// ---------------------------------------------------------------------------

/** The section heading (CX-5). */
export const RISK_BAND_HEADING = "Risk-band distribution: each engine on its own comparator";

/** The per-panel accessible name (CX-5). */
export function riskBandPanelAria(engine: string, comparator: string): string {
  return `risk-band distribution for ${engine} on comparator ${comparator}`;
}

/** The run-book before/after pair's accessible name (CX-5). */
export function riskBandPairAria(engine: string): string {
  return `risk-band distribution before and after for ${engine}`;
}

/** The section's METHOD line (CX-6). */
export const RISK_BAND_METHOD =
  "Buckets are policy bands of unequal width. Bar length is each bucket's share of this " +
  "engine's debt-bearing accounts with a finite comparator, on a common 0 to 100 percent axis. " +
  "Exact counts sit beside each bar.";

/**
 * The denominator, NAMED on the panel (CX-6). A share without its denominator
 * is not a disclosure.
 */
export function riskBandDenominatorLine(denominator: number): string {
  return (
    `denominator: ${denominator.toLocaleString("en-US")} debt-bearing accounts with a finite ` +
    `comparator`
  );
}

/**
 * The accounting rows (CX-6): `infinite_count` and `refused_count` render
 * BENEATH the bars as their own rows, never folded into the denominator
 * silently. An account with no debt has no comparator to bucket, and a refused
 * account is an unknowable — neither is a small bucket.
 */
export function riskBandNoDebtRow(count: number): string {
  return `no debt (no comparator): ${count.toLocaleString("en-US")}`;
}

export function riskBandRefusedRow(count: number): string {
  return `refused: ${count.toLocaleString("en-US")}`;
}

/**
 * WAVE W-3L — THE TINT ASYMMETRY, SAID OUT LOUD (template slot 6).
 *
 * Sub-1.00 buckets tint crit on the wad comparator and on no other, and the
 * only place that was explained was inside the wire note and an SVG `<title>`.
 * A `<title>` is hover sugar (LAW-5) and a wire note is not a method line, so
 * the rule now renders as a sentence on the panel that obeys it.
 */
export function riskBandTintClause(comparator: string): string {
  return comparator === "hf_wad"
    ? "Buckets below 1.00 are tinted because this engine's own comparator makes that region " +
        "eligible for liquidation."
    : "No bucket is tinted: this engine's buckets are a disclosure and its eligibility comes " +
        "from a strict boolean, not from a bucket boundary.";
}

/** WAVE W-3L — the risk-band panel's FORENSICS summary (template slot 7). */
export function riskBandForensicsSummary(buckets: number): string {
  return `Exact data: the wire's own note and ${String(buckets)} bucket boundaries`;
}
