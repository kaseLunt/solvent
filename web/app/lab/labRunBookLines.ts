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
import { belowOneLanes, crossingCounts, readTransitions } from "./labTransition";
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
 * The histogram pair's reading line: the NET population change AND the two
 * gross crossings that produced it.
 *
 * # What changed at contract 1.7.0, and why the old sentence had to go rather
 * # than be reworded
 *
 * This sentence used to carry an IMPOSSIBILITY CAVEAT: "this response serves
 * the two populations, not the crossings between them ... no gross crossing
 * count is claimed here". Its central claim — that computing the gross count
 * here was impossible from two histograms — was TRUE and is now FALSE.
 * `hf_transitions` serves the joint distribution, so the crossings are derived
 * from its cells, and a stale impossibility caveat printed beside a served
 * gross count is itself the defect the caveat existed to prevent.
 *
 * The NET is kept beside the gross rather than replaced by it: it is still the
 * population change, and the whole point of the pair is that on an offsetting
 * book they are different numbers.
 *
 * Two constraints the rewrite keeps:
 *
 *   - the denominator is the SERVER's `measured_rows`, not a recomputed
 *     `measuredCount`. The exclusion of the unmeasured tail is now a number the
 *     server publishes, and reading it is strictly better than reproducing it.
 *   - `lane_changed_rows` is NOT described as a 1.00-crossing count, because it
 *     is not one: it counts every lane change, including moves that never touch
 *     this boundary.
 *
 * The eligible-region count is the quantity both comparators can honestly
 * report — on Aave it is the engine's own liquidation set, on the Debt Manager
 * it is a DISCLOSURE and the sentence says so rather than passing it off as a
 * verdict. The unmeasured tail is named in the same breath, because a shift
 * measured over a book with rows missing from it is a shift over a different
 * book.
 */
export function histogramShiftReadingLine(engine: LabRunBookEngine): string {
  const before = engine.before;
  const after = engine.after;
  const reading = readTransitions(engine);
  const head = "What this shows: how the book's health factors moved under this scenario. ";

  // A MATRIX THIS BODY CONTRADICTS IS NOT READ, and the thing lost with it is
  // the ONE census the two sides share. While the matrix reconciles,
  // `measured_rows` is a single total both distributions answer to. When it
  // does not, each side carries its own measured total and the two are not
  // interchangeable: the before histogram may hold 3 measured rows while the
  // after holds 8. So the fallback states each side against ITS OWN
  // denominator, and it subtracts them only when the two totals agree. A
  // difference taken across two different populations is not a population
  // change, and printing one as "grew by N" is exactly the computed-looking
  // wrong answer this refusal path exists to prevent.
  if (reading.kind === "contradictory") {
    return (
      head +
      netOnlyMovement(
        belowOneCount(before),
        belowOneCount(after),
        measuredCount(before),
        measuredCount(after),
      ) +
      " The gross crossings are NOT stated here: this response's transition matrix disagrees with " +
      "the two distributions beside it, and a crossing count derived from it would not answer to " +
      `them. ${regionClause(before)}${unmeasuredTail(after, false)}`
    );
  }

  const t = reading.transitions;
  const measured = t.measured_rows;
  if (measured === 0) {
    // No row was measured at all. There is no shift to describe, and
    // "0 accounts moved" would claim a measurement nobody made.
    return (
      head +
      "This scenario measured no account on this engine, so there is no shift to read." +
      unmeasuredTail(after, true)
    );
  }

  const region = belowOneLanes(t);
  const { entries, exits, net } = crossingCounts(t, region);
  const from = belowOneCount(before);
  const to = belowOneCount(after);

  const movement =
    net === 0
      ? `${String(from)} of ${String(measured)} measured rows sat below 1.00 before the shock ` +
        `and ${String(to)} after: the below-1.00 population did not change.`
      : `${String(from)} of ${String(measured)} measured rows sat below 1.00 before the shock, ` +
        `${String(to)} after: the below-1.00 population ${net > 0 ? "grew" : "shrank"} by ` +
        `${String(Math.abs(net))}.`;

  // THE GROSS SPLIT, BESIDE THE NET RATHER THAN A CAVEAT INSTEAD OF IT. These
  // two are read off the transition matrix's cells — the joint distribution the
  // server computes — and the net is what is left when they cancel.
  const gross =
    ` The crossings behind that figure are served: ${String(entries)} ` +
    `${entries === 1 ? "row" : "rows"} moved INTO the region and ${String(exits)} ` +
    `${exits === 1 ? "row" : "rows"} moved OUT of it, so the net is what is left after they cancel.`;

  return `${head}${movement}${gross} ${regionClause(before)}${unmeasuredTail(after, true)}`;
}

/**
 * The net-only sentence, used when the matrix cannot be read.
 *
 * TWO DENOMINATORS, NOT ONE. This function used to take a single `measured` and
 * print it on both halves of the sentence. That was only ever true because the
 * matrix reconciled the two sides into one census, which is precisely what has
 * just failed here. A before histogram of 3 measured rows beside an after
 * histogram of 8 is two populations, and "1 of 8 measured rows sat below 1.00
 * before" states a denominator the before side never had.
 *
 * The subtraction answers to the same rule. `to - from` is a population change
 * only while the two populations are the same book; across two censuses it is a
 * difference of unrelated counts, so no growth and no shrink is claimed and the
 * sentence says which fact is missing rather than filling it with arithmetic.
 */
function netOnlyMovement(
  from: number,
  to: number,
  measuredBefore: number,
  measuredAfter: number,
): string {
  if (measuredBefore === 0 && measuredAfter === 0) {
    return "This scenario measured no account on this engine, so there is no shift to read.";
  }
  if (measuredBefore !== measuredAfter) {
    // A side that measured NOTHING says so. "0 of 0 measured rows sat below
    // 1.00" reads as a finding about a book nobody looked at.
    const beforeSide =
      measuredBefore === 0
        ? "No row was measured before the shock"
        : `${String(from)} of ${String(measuredBefore)} measured rows sat below 1.00 before the shock`;
    const afterSide =
      measuredAfter === 0
        ? "no row was measured after it"
        : `${String(to)} of ${String(measuredAfter)} measured rows sat below 1.00 after it`;
    return (
      `${beforeSide}; ${afterSide}. The two histograms measure different row totals, so no net ` +
      "movement is computed here: a difference taken across two censuses is not a population change."
    );
  }
  const measured = measuredBefore;
  if (to === from) {
    return (
      `${String(from)} of ${String(measured)} measured rows sat below 1.00 before the shock ` +
      `and ${String(to)} after: the below-1.00 population did not change.`
    );
  }
  return (
    `${String(from)} of ${String(measured)} measured rows sat below 1.00 before the shock, ` +
    `${String(to)} after: the below-1.00 population ${to > from ? "grew" : "shrank"} by ` +
    `${String(Math.abs(to - from))}.`
  );
}

/**
 * What "below 1.00" MEANS on this engine — a verdict on Aave, a DISCLOSURE on
 * the Debt Manager, and the sentence never lets the two read alike. Serving the
 * joint changes nothing about this: a move into a below-1.00 lane is still not
 * an eligibility flip on an engine whose lanes are a ratio it does not
 * liquidate on.
 */
function regionClause(before: RunBookAggregate): string {
  return before.hf_histogram.comparator === "hf_wad"
    ? "Below 1.00 is where this engine may liquidate."
    : "Below 1.00 is the borrow-headroom ratio, a DISCLOSURE rather than this engine's trigger.";
}

/**
 * The unmeasured tail, named in the same breath as the shift or not at all.
 *
 * CORRECTED at 1.7.0. This clause used to say those rows "sit in neither
 * distribution", and the second half is now false: they sit in the matrix's
 * last lane, which IS a position in the joint distribution, with both margins
 * carrying them and the cause split beside them. The naming obligation is
 * unchanged; what changed is that there is now somewhere to point.
 *
 * CORRECTED AGAIN. The somewhere to point IS the matrix, so the pointing is
 * licensed only while the matrix is read. A sentence that refuses the matrix in
 * one clause and cites its final lane in the next is citing a body it has just
 * declared unusable, which is the same defect in a smaller frame. `matrixRead`
 * carries that distinction: the refusal variant keeps the COUNT, which the
 * histogram beside it carries on its own, and drops the LOCATION, which only
 * the refused matrix could have given.
 */
function unmeasuredTail(after: RunBookAggregate, matrixRead: boolean): string {
  const refused = after.hf_histogram.refused_count;
  if (refused === 0) {
    return "";
  }
  if (!matrixRead) {
    return (
      ` ${String(refused)} more ${refused === 1 ? "row is" : "rows are"} counted refused, outside ` +
      `every measured count above. Where ${refused === 1 ? "it sits" : "they sit"} in the matrix ` +
      `is NOT claimed here: the matrix this response served is the one being refused.`
    );
  }
  return (
    ` ${String(refused)} more ${refused === 1 ? "row is" : "rows are"} counted refused; ` +
    `${refused === 1 ? "it sits" : "they sit"} in the matrix's "not measured" lane, inside both ` +
    `margins and outside every measured count above.`
  );
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
    `${subject.ranking}; ${String(total - shown)} are not on this page.`
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
export type CollateralDisclosure = "counted" | "unpriced" | "not-counted" | "contradictory";

export function collateralDisclosure(
  entry: RunBookAggregate["collateral_by_asset"][number],
): CollateralDisclosure {
  if (entry.value_usd !== null) {
    // r89: `unpriced: true` asserts NO price witness exists and the value is
    // OUTSIDE the total — beside a served dollar figure that is a row
    // contradicting itself, and blessing it as counted was how a disputed
    // number reached the page as money. It is its own disclosure, rendered in
    // the refusal register and summed into nothing.
    return entry.unpriced ? "contradictory" : "counted";
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
  const uncounted = entries.filter((entry) => entry.value_usd === null);
  const unpriced = uncounted.filter((entry) => entry.unpriced);

  // THE SUM WELD (r89). The sentence below repeats the contract's own
  // reconciliation claim — "the counted entries sum exactly to this side's
  // total" — so the arithmetic is performed BEFORE the claim is made, in
  // bigint over the exact wire strings. A contradictory row (a value beside
  // the no-price-witness flag) is inside neither the count nor the sum.
  let countedCount = 0;
  let countedSum = 0n;
  let contradictoryCount = 0;
  for (const entry of entries) {
    if (entry.value_usd === null) continue;
    if (entry.unpriced) {
      contradictoryCount++;
      continue;
    }
    countedCount++;
    countedSum += BigInt(entry.value_usd);
  }

  const contradictoryClause =
    contradictoryCount === 0
      ? ""
      : ` ${String(contradictoryCount)} ${contradictoryCount === 1 ? "entry carries" : "entries carry"} ` +
        `BOTH a dollar value and the no-price-witness flag — CONTRADICTORY, listed without a ` +
        `value, outside every sum here.`;

  const total = labUsd(aggregate.total_collateral_usd, usdDecimals);
  if (countedSum !== BigInt(aggregate.total_collateral_usd)) {
    return (
      `COLLATERAL CONTRADICTION: the ${String(countedCount)} counted ` +
      `${countedCount === 1 ? "entry sums" : "entries sum"} to ` +
      `${labUsd(countedSum.toString(), usdDecimals)} but the engine claims ${total} ${side} ` +
      `the shock — the decomposition does not reconcile, so no sum claim is made.` +
      contradictoryClause
    );
  }

  const head =
    `What this shows: which assets make up this engine's collateral ${side} the shock. ` +
    `${String(countedCount)} ${countedCount === 1 ? "asset sums" : "assets sum"} to ${total}, ` +
    `this engine's own USD at ${String(usdDecimals)} decimals, never added to another engine's.`;

  if (uncounted.length === 0) {
    return `${head}${contradictoryClause}`;
  }
  const unpricedClause =
    unpriced.length === 0
      ? ""
      : ` ${String(unpriced.length)} of those ${unpriced.length === 1 ? "carries" : "carry"} no price at all, so ${unpriced.length === 1 ? "its worth is" : "their worth is"} UNKNOWABLE rather than zero.`;
  return (
    `${head} ${String(uncounted.length)} further ${uncounted.length === 1 ? "holding is" : "holdings are"} ` +
    `listed with NO value, and ${uncounted.length === 1 ? "it is" : "they are"} outside that total.${unpricedClause}${contradictoryClause}`
  );
}
