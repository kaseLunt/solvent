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
 * The histogram pair's reading line: the NET population change between the two
 * distributions.
 *
 * # Why it says NET and says it out loud
 *
 * The only quantity derivable here is `belowOne(after) − belowOne(before)`, and
 * that is a difference of two POPULATIONS — not a count of accounts that
 * crossed. An account that fell below 1.00 and another that rose above it
 * cancel exactly, and this response carries nothing that would reveal either.
 * The earlier sentence called that difference "accounts that crossed/left",
 * which claimed a gross measurement the wire never served.
 *
 * The honest options were: serve the gross count (the API does not), compute it
 * here (impossible from two histograms), or DISCLOSE the limitation. This
 * sentence discloses it.
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

  // What "below 1.00" MEANS on this engine — a verdict on Aave, a disclosure on
  // the Debt Manager, and the sentence never lets the two read alike.
  const regionTail =
    before.hf_histogram.comparator === "hf_wad"
      ? "where this engine may liquidate"
      : "the borrow-headroom ratio — a DISCLOSURE, not this engine's trigger";

  // THE NET CAVEAT, in so many words. Two populations subtracted is a NET
  // change and nothing else: an account that fell below 1.00 and another that
  // rose above it cancel here, and neither is visible. Saying so is the only
  // honest option — a GROSS crossing count computed on this side would be an
  // invention, because no field on this response carries one.
  const netCaveat =
    " That is a NET figure: this response serves the two populations, not the crossings between " +
    "them, so accounts may have moved in BOTH directions and no gross crossing count is claimed here.";

  let movement: string;
  if (measured === 0) {
    // No account was measured at all. There is no shift to describe, and
    // "0 accounts moved" would claim a measurement nobody made.
    return (
      "What this shows: how the book's health factors moved under this scenario. " +
      "This scenario measured no account on this engine, so there is no shift to read." +
      refusedTail(after)
    );
  } else if (to === from) {
    movement =
      `${String(from)} of ${String(measured)} measured accounts sat below 1.00 before the shock ` +
      `and ${String(to)} after: the below-1.00 population did not change.`;
  } else {
    const verb = to > from ? "grew" : "shrank";
    movement =
      `${String(from)} of ${String(measured)} measured accounts sat below 1.00 before the shock, ` +
      `${String(to)} after: the below-1.00 population ${verb} by ${String(Math.abs(to - from))}.`;
  }

  return (
    "What this shows: how the book's health factors moved under this scenario. " +
    `${movement}${netCaveat} Below 1.00 is ${regionTail}.${refusedTail(after)}`
  );
}

/** The refused tail, named in the same breath as the shift or not at all. */
function refusedTail(after: RunBookAggregate): string {
  const refused = after.hf_histogram.refused_count;
  if (refused === 0) {
    return "";
  }
  return ` ${String(refused)} more ${refused === 1 ? "row is" : "rows are"} counted refused and sit in neither distribution.`;
}

/**
 * WHAT THE ENGINE ACTUALLY SELECTED FOR, in that engine's own vocabulary.
 *
 * `movers` is NOT "the accounts that moved". Each engine ranks a ONE-DIRECTION
 * list and the server's own `movers_note` says so: Aave admits only accounts
 * whose health factor STRICTLY DROPPED (a risen health factor is not a mover,
 * and neither is an account with no debt), and the Debt Manager admits only
 * eligibility flips false -> true (an account that flipped BACK to healthy is
 * not a mover). Calling either list "all accounts that moved" claims a
 * symmetry the wire does not have — and the histogram sentence beside it
 * already discloses that crossings in the other direction exist and are not
 * served.
 *
 * The comparator is the discriminator, exactly as it is everywhere else on
 * this surface: `hf_wad` is the pool's own liquidation test, anything else is
 * the Debt Manager's exact rational.
 */
function moversSubject(engine: LabRunBookEngine): {
  none: string;
  clause: string;
  ranking: string;
} {
  if (engine.before.hf_histogram.comparator === "hf_wad") {
    return {
      none: "No account's health factor dropped",
      clause: "whose health factor strictly dropped",
      ranking: "ranked by the drop",
    };
  }
  return {
    none: "No account's debt became eligible",
    clause: "whose debt became eligible",
    ranking: "ranked by that debt",
  };
}

/**
 * The movers table's disclosure line: "top 20 of 31", never a silent window.
 *
 * The shown count is the array's OWN length and the total is the wire's own
 * `movers_total` — this sentence derives the relationship rather than trusting
 * either number to imply the other. The SUBJECT is engine-specific, because
 * the two engines rank different one-direction lists (see `moversSubject`).
 */
export function moversDisclosure(engine: LabRunBookEngine): string {
  const shown = engine.movers.length;
  const total = engine.movers_total;
  const subject = moversSubject(engine);

  if (total === 0) {
    return `${subject.none} under this scenario on this engine.`;
  }
  if (shown >= total) {
    const noun = total === 1 ? "account" : "accounts";
    return `Showing all ${String(total)} ${noun} ${subject.clause}, ${subject.ranking}.`;
  }
  return (
    `Showing the top ${String(shown)} of ${String(total)} accounts ${subject.clause}, ` +
    `${subject.ranking} — ${String(total - shown)} are not on this page.`
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
/**
 * THE DISCLOSURE STATE of one collateral entry — the wire's own vocabulary.
 *
 * The server groups this itemization by asset AND disclosure (`runCollateralKey`
 * in `cmd/api/p5_runbook.go`), so ONE asset legitimately appears more than once
 * on one side: the live book already serves weETH twice for an Aave aggregate,
 * COUNTED for the accounts that enabled it as collateral and NOT COUNTED for
 * the accounts that did not. The three states are mutually exclusive and are
 * recovered here from the two fields that carry them, never guessed:
 *
 *   counted      value_usd is present — this value is inside total_collateral_usd
 *   unpriced     value_usd is null AND no price witness describes the balance
 *   not-counted  value_usd is null because the engine counts none of it
 */
export type CollateralDisclosure = "counted" | "unpriced" | "not-counted";

export function collateralDisclosure(
  entry: RunBookAggregate["collateral_by_asset"][number],
): CollateralDisclosure {
  if (entry.value_usd !== null) {
    return "counted";
  }
  return entry.unpriced ? "unpriced" : "not-counted";
}

/**
 * THE REACT KEY for a collateral row: asset + the FULL disclosure state.
 *
 * A key is an IDENTITY claim, and the identity of a row on this surface is the
 * pair the server itemized by. Keying on `asset + unpriced` collapsed COUNTED
 * and NOT-COUNTED onto one key — they share `unpriced: false` — so the two rows
 * the live book serves for weETH were, to React, the same row twice. Across a
 * rerun that is a reconciliation the renderer resolves by guessing: a row can
 * be dropped, duplicated, or updated with the other row's props.
 */
export function collateralRowKey(
  entry: RunBookAggregate["collateral_by_asset"][number],
): string {
  return `${entry.asset}::${collateralDisclosure(entry)}`;
}

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
