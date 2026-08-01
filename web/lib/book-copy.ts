// Verbatim copy from the solvent-design SUPPLEMENT ruling (16–18 + captions
// a/b/c), shared across the Book and Lab surfaces so the same sentence can
// never fork. Tests pin every string independently — a reword here fails the
// suite, which is the point.

/** §18 — the waterfall section note, verbatim. */
export const WATERFALL_SECTION_NOTE =
  "If the shocked asset fell step by step, how much debt could the engine liquidate — and " +
  "how much would it lose? Bars: cumulative eligible debt at each price. ×1.00 is the " +
  "standing census; every lower point is a projection.";

/** §18 — the one dim legend line under the waterfall panel grid, verbatim. */
export const BAD_DEBT_LEGEND =
  "bad debt = debt still owed after all collateral is seized — the protocol's loss at that price.";

/** Caption (b) — the eligible-vs-realized primary gloss, verbatim. */
export const ELIGIBLE_REALIZED_GLOSS =
  '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
  "closes can be less — the Debt Manager liquidates in two passes: half the debt, then " +
  "the remainder.";

/**
 * Caption (a) — the always-visible held-flat summary, verbatim template.
 * Count-aware (W-UX-C micro-ruling 3): "1 price input held flat" at n = 1 —
 * prose pluralizes; label-value grammar elsewhere may stay invariant.
 */
export function heldFlatSummary(n: number): string {
  const head = n === 1 ? "1 price input held flat" : `${String(n)} price inputs held flat`;
  return (
    `${head} — the scenario did not move these prices; ` +
    "positions priced by them are stressed at stale marks. A blind spot, not a zero."
  );
}

/** Caption (a) — the counted <details> summary line, verbatim template. */
export function heldFlatDetailsSummary(n: number): string {
  return `held flat — ${String(n)} inputs named`;
}

/**
 * Caption (a) — the held-flat value column header. The wire declares no
 * decimals for `held_flat[].value`, so scaling it to USD would be
 * fabrication; the header says so instead.
 */
export const HELD_FLAT_VALUE_HEADER = "held value (source's raw units — unscaled by design)";

/** Caption (c) — the collateral-at-risk reader caption (title text), verbatim. */
export const AT_RISK_READER_CAPTION =
  "collateral at risk is re-measured at each price step — it can fall as prices fall, " +
  "because the same collateral is worth less. A dip is honest arithmetic, not missing data.";

/** Caption (c) — the Lab book panel's counted wire-notes summary, verbatim template. */
export function wireNotesSummary(n: number): string {
  return `wire notes — ${String(n)}, verbatim`;
}
