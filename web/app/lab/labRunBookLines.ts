// The run-book detail's COMPUTED reading lines (contract 1.6.0, Wave W-BS-A).
//
// The Book surface established the register (`app/book/readingLines.ts`) and
// the Lab owns its own sentences for the same reason `labReadingLines.ts`
// does: the Lab's claim is a BEFORE/AFTER pair under one named scenario, not a
// standing census, and a shared sentence would eventually describe the wrong
// one.
//
// Every line here is DERIVED from the same response the charts render — never
// asserted, never hardcoded. Three laws bind them:
//
//   1. An unknowable never renders as a zero. A side with no comparator to
//      report says so; it does not report 0.
//   2. Engine sums are never added. Every figure is one engine's own USD at
//      that engine's own decimals, and the sentence says whose.
//   3. A cap is never silent. `moversDisclosure` states the shown count AND
//      the full total whenever they differ.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { LabRunBookEngine, RunBookAggregate } from "../../lib/runbook";
import { labUsd } from "./frontierView";

/** Σ of bucket counts whose whole range sits at-or-below the wad scale. */
export function belowOneCount(aggregate: RunBookAggregate): number {
  const scale = BigInt(aggregate.hf_histogram.wad_scale);
  return aggregate.hf_histogram.buckets.reduce(
    (sum, bucket) =>
      bucket.upper_wad !== null && BigInt(bucket.upper_wad) <= scale ? sum + bucket.count : sum,
    0,
  );
}

/** buckets + infinite — the accounts this side actually measured. */
export function measuredCount(aggregate: RunBookAggregate): number {
  return (
    aggregate.hf_histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0) +
    aggregate.hf_histogram.infinite_count
  );
}

/**
 * The histogram pair's reading line: what MOVED between the two distributions.
 *
 * The eligible-region count is the quantity both comparators can honestly
 * report — on Aave it is the engine's own liquidation set, on the Debt Manager
 * it is a DISCLOSURE and the sentence says so rather than passing it off as a
 * verdict. The refused tail is named in the same breath, because a shift
 * measured over a book with rows missing from it is a shift over a different
 * book.
 */
export function histogramShiftReadingLine(engine: LabRunBookEngine): string {
  const before = engine.before;
  const after = engine.after;
  const from = belowOneCount(before);
  const to = belowOneCount(after);
  const measured = measuredCount(after);

  const disclosure =
    before.hf_histogram.comparator === "hf_wad"
      ? "below 1.00, where this engine may liquidate"
      : "below 1.00 on the borrow-headroom ratio — a DISCLOSURE, not this engine's trigger";

  let movement: string;
  if (measured === 0) {
    // No account was measured at all. There is no shift to describe, and
    // "0 accounts moved" would claim a measurement nobody made.
    movement = "This scenario measured no account on this engine, so there is no shift to read.";
  } else if (to === from) {
    movement = `Nothing crossed: ${String(from)} of ${String(measured)} accounts sit ${disclosure}, before and after.`;
  } else {
    const verb = to > from ? "crossed into" : "left";
    movement =
      `${String(Math.abs(to - from))} of ${String(measured)} accounts ${verb} that region — ` +
      `${String(from)} ${disclosure} before, ${String(to)} after.`;
  }

  const refused = after.hf_histogram.refused_count;
  const refusedClause =
    refused === 0
      ? ""
      : ` ${String(refused)} more ${refused === 1 ? "row is" : "rows are"} counted refused and sit in neither distribution.`;

  return `What this shows: how the book's health factors moved under this scenario. ${movement}${refusedClause}`;
}

/**
 * The movers table's disclosure line: "top 20 of 31", never a silent window.
 *
 * The shown count is the array's OWN length and the total is the wire's own
 * `movers_total` — this sentence derives the relationship rather than trusting
 * either number to imply the other.
 */
export function moversDisclosure(engine: LabRunBookEngine): string {
  const shown = engine.movers.length;
  const total = engine.movers_total;
  if (total === 0) {
    return "No account moved under this scenario on this engine.";
  }
  if (shown >= total) {
    return `Showing all ${String(total)} ${total === 1 ? "account" : "accounts"} that moved.`;
  }
  return (
    `Showing the top ${String(shown)} of ${String(total)} accounts that moved — ` +
    `${String(total - shown)} are not on this page.`
  );
}

/**
 * The collateral breakdown's reading line for ONE side.
 *
 * The counted entries sum to `total_collateral_usd` by the contract's own law,
 * so the sentence's job is the REMAINDER: holdings this engine counted no
 * value for. Reporting them as a count of entries — never as a summed dollar
 * figure — is the point. There is no honest total for balances whose worth is
 * unknowable, and inventing one is exactly the failure the null exists to
 * prevent.
 */
export function collateralReadingLine(
  aggregate: RunBookAggregate,
  usdDecimals: number,
  side: "before" | "after",
): string {
  const entries = aggregate.collateral_by_asset;
  const counted = entries.filter((entry) => entry.value_usd !== null);
  const uncounted = entries.filter((entry) => entry.value_usd === null);
  const unpriced = uncounted.filter((entry) => entry.unpriced);

  const total = labUsd(aggregate.total_collateral_usd, usdDecimals);
  const head =
    `What this shows: which assets make up this engine's collateral ${side} the shock. ` +
    `${String(counted.length)} ${counted.length === 1 ? "asset sums" : "assets sum"} to ${total}, ` +
    `this engine's own USD at ${String(usdDecimals)} decimals — never added to another engine's.`;

  if (uncounted.length === 0) {
    return head;
  }
  const unpricedClause =
    unpriced.length === 0
      ? ""
      : ` ${String(unpriced.length)} of those ${unpriced.length === 1 ? "carries" : "carry"} no price at all, so ${unpriced.length === 1 ? "its worth is" : "their worth is"} UNKNOWABLE — not zero.`;
  return (
    `${head} ${String(uncounted.length)} further ${uncounted.length === 1 ? "holding is" : "holdings are"} ` +
    `listed with NO value, and ${uncounted.length === 1 ? "it is" : "they are"} outside that total.${unpricedClause}`
  );
}
