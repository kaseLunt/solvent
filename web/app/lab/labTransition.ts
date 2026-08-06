// The run-book transition matrix's PURE DECISION LAYER (contract 1.7.0).
//
// `matrixCells.ts` set the precedent this file follows: NOTHING IS CLASSIFIED
// BEFORE IT IS VALIDATED. A body can arrive from an older deployment or a
// broken one, and a Sankey whose ribbons do not sum to the bars printed beside
// them is a wrong answer given to an honest user — worse than no answer,
// because it looks computed.
//
// So the matrix is read through `readTransitions`, which either returns a
// matrix whose margins ARE the two histograms served beside it, or returns the
// reasons they disagree and renders nothing.
//
// Three further laws bind this module:
//
//   1. A NULL IS NOT A ZERO. `held_rows` and `lane_changed_rows` are null when
//      this run measured no row on this engine; `!t.held_rows` collapses that
//      with "every measured row changed lane", so the null is carried as a
//      distinct state and never coerced.
//   2. A CELL'S NULL DEBT IS AN UNKNOWABLE. `Number(cell.debt_before_usd)`
//      would make it 0. It is never coerced either.
//   3. THE CROSSINGS ARE DERIVED FROM THE CELLS, never from `lane_changed_rows`.
//      That field counts LANE changes and is not a crossing count of any
//      particular edge — the server's own note says so.
//   4. THE UNMEASURED LANE IS DIAGONAL-ONLY (W-SK-B). Refusal is row-level for
//      the whole run, so a cell with exactly one endpoint in the unmeasured
//      lane states a measurement nobody made — and it can do so while every
//      margin still balances, so the margins alone cannot catch it.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { LabRunBookEngine, RunBookTransitions } from "../../lib/runbook";

/** The lane vocabulary's two non-bucket kinds, named rather than indexed. */
export const LANE_KIND_BUCKET = "bucket";
export const LANE_KIND_INFINITE = "infinite";
export const LANE_KIND_UNMEASURED = "unmeasured";

/**
 * The matrix as this surface may use it, or the reasons it may not.
 *
 * `contradictory` is not an error state: it is a body this deployment cannot
 * honestly draw, and the reasons are the ones a reader is shown.
 */
export type TransitionReading =
  | { kind: "ok"; transitions: RunBookTransitions }
  | { kind: "contradictory"; reasons: string[] };

/**
 * The tally of one lane on one served histogram — keyed by the lane's KIND,
 * never by its position (W-FIX-WEB).
 *
 * The old read was positional (lane < buckets → buckets[lane], then infinite,
 * then unmeasured), which is the canonical ORDER of the vocabulary, not its
 * IDENTITY: over a reordered vocabulary it read a neighbour's tally, and
 * wherever two populations coincided the wrong read still balanced — a check
 * that compares the wrong pairs is vacuous exactly when it looks satisfied.
 *
 * So the lane record itself decides: the infinite lane reads
 * `infinite_count`, the unmeasured lane reads `refused_count`, and a bucket
 * lane reads the bucket it IS — the contract states a bucket lane's label and
 * edges are byte-identical to the histogram bucket it mirrors, so those bytes
 * are the join. Null means this histogram serves no such tally; for a bucket
 * lane the caller refuses on it, because a bucket lane the distribution does
 * not serve is a vocabulary the two bodies do not share.
 */
function tallyAt(
  histogram: LabRunBookEngine["before"]["hf_histogram"],
  lane: RunBookTransitions["lanes"][number],
): number | null {
  if (lane.kind === LANE_KIND_INFINITE) {
    return histogram.infinite_count;
  }
  if (lane.kind === LANE_KIND_UNMEASURED) {
    return histogram.refused_count;
  }
  if (lane.kind === LANE_KIND_BUCKET) {
    const bucket = histogram.buckets.find(
      (candidate) =>
        candidate.label === lane.label &&
        candidate.lower_wad === lane.lower_wad &&
        candidate.upper_wad === lane.upper_wad,
    );
    return bucket === undefined ? null : bucket.count;
  }
  return null;
}

/**
 * READ THE MATRIX, OR REFUSE IT.
 *
 * Every check here is a check the SERVER already makes at construction; making
 * them again on arrival is what makes this client independent of the
 * deployment's version rather than trusting it.
 */
export function readTransitions(engine: LabRunBookEngine): TransitionReading {
  const t = engine.hf_transitions;
  const reasons: string[] = [];
  const buckets = engine.before.hf_histogram.buckets.length;
  const laneCount = t.lanes.length;

  if (laneCount !== buckets + 2) {
    reasons.push(
      `the matrix states ${String(laneCount)} lanes over ${String(buckets)} risk bands, and the ` +
        `vocabulary is the bands plus the two tallies beside them and nothing else`,
    );
  }
  if (t.outflows.length !== laneCount || t.from_rows.length !== laneCount || t.to_rows.length !== laneCount) {
    reasons.push("the matrix's lanes, outflows and two margins are not the same length");
  }
  if (t.comparator !== engine.before.hf_histogram.comparator) {
    reasons.push(
      `the matrix is stated on comparator ${t.comparator} and the distribution beside it on ` +
        `${engine.before.hf_histogram.comparator}`,
    );
  }

  // THE UNMEASURED LANE IS DIAGONAL-ONLY. A row unmeasured in this run is
  // unmeasured on BOTH sides — refusal is row-level for the whole run — so a
  // cell with exactly ONE endpoint in the unmeasured lane states a measurement
  // nobody made. It is a shape check, not a sum check: swap two balanced
  // diagonal cells into (measured→unmeasured, unmeasured→measured) and every
  // margin still balances while the picture draws fabricated measured
  // movement. Lane KIND, never a hardcoded index.
  for (const outflow of t.outflows) {
    const fromUnmeasured = t.lanes[outflow.from]?.kind === LANE_KIND_UNMEASURED;
    for (const cell of outflow.cells) {
      const toUnmeasured = t.lanes[cell.to]?.kind === LANE_KIND_UNMEASURED;
      if (fromUnmeasured !== toUnmeasured) {
        reasons.push(
          `the matrix states an outflow with exactly one end in the unmeasured lane, ` +
            `lane ${String(outflow.from)} (${t.lanes[outflow.from]?.label ?? "unknown"}) → ` +
            `lane ${String(cell.to)} (${t.lanes[cell.to]?.label ?? "unknown"}), and a row ` +
            `this run did not measure is unmeasured on both sides`,
        );
      }
    }
  }

  // THE MARGINS ARE THE TWO HISTOGRAMS, and they are also the cells' own sums.
  const rowSums = new Array<number>(laneCount).fill(0);
  const colSums = new Array<number>(laneCount).fill(0);
  let cellTotal = 0;
  for (const outflow of t.outflows) {
    for (const cell of outflow.cells) {
      if (outflow.from >= 0 && outflow.from < laneCount) {
        rowSums[outflow.from] = (rowSums[outflow.from] ?? 0) + cell.rows;
      }
      if (cell.to >= 0 && cell.to < laneCount) {
        colSums[cell.to] = (colSums[cell.to] ?? 0) + cell.rows;
      }
      cellTotal += cell.rows;
    }
  }
  for (let lane = 0; lane < laneCount; lane += 1) {
    const record = t.lanes[lane];
    for (const [name, margin, sums, histogram] of [
      ["before", t.from_rows, rowSums, engine.before.hf_histogram],
      ["after", t.to_rows, colSums, engine.after.hf_histogram],
    ] as const) {
      const stated = margin[lane];
      // W-FIX-WEB: the tally is the LANE RECORD's, by kind — never the tally
      // that happens to sit at this position in a canonically-ordered body.
      const tally = record === undefined ? null : tallyAt(histogram, record);
      if (stated !== sums[lane]) {
        reasons.push(
          `the ${name} margin states ${String(stated)} rows in lane ${String(lane)} while its own ` +
            `cells hold ${String(sums[lane])}`,
        );
      }
      if (tally !== null && stated !== tally) {
        reasons.push(
          `the ${name} margin states ${String(stated)} rows in lane ${String(lane)} while the ` +
            `${name} distribution beside it counts ${String(tally)}`,
        );
      }
      // A bucket lane the distribution does not serve is not a skippable
      // unknown: the vocabulary claims a band the histogram beside it never
      // stated, so the two bodies cannot be about the same book.
      if (tally === null && record !== undefined && record.kind === LANE_KIND_BUCKET) {
        reasons.push(
          `the matrix states lane ${String(lane)} (${record.label}) as a risk band the ` +
            `${name} distribution beside it does not serve`,
        );
      }
    }
  }
  if (cellTotal !== t.total_rows) {
    reasons.push(
      `the matrix states ${String(t.total_rows)} rows in total while its cells hold ${String(cellTotal)}`,
    );
  }
  if (t.measured_rows + t.unmeasured_rows !== t.total_rows) {
    reasons.push("the matrix's measured and unmeasured rows do not add up to its total");
  }
  if (
    t.unmeasured_refused_in_batch_rows + t.unmeasured_excluded_by_this_layer_rows !==
    t.unmeasured_rows
  ) {
    reasons.push("the matrix's two unmeasured causes do not add up to the population they split");
  }
  if (t.measured_rows !== engine.before.accounts || t.measured_rows !== engine.after.accounts) {
    reasons.push(
      `the matrix measured ${String(t.measured_rows)} rows while the two sides beside it report ` +
        `${String(engine.before.accounts)} and ${String(engine.after.accounts)} accounts`,
    );
  }
  // NULL AND ZERO ARE DIFFERENT STATEMENTS, and the pair must agree about which
  // one this body is making.
  const nulls = [t.held_rows === null, t.lane_changed_rows === null];
  if (nulls[0] !== nulls[1]) {
    reasons.push("the matrix withholds one movement count and states the other");
  }
  if (nulls[0] !== (t.measured_rows === 0)) {
    reasons.push(
      t.measured_rows === 0
        ? "the matrix states a movement count over a book it measured no row of"
        : "the matrix withholds its movement counts over a book it did measure",
    );
  }

  return reasons.length === 0 ? { kind: "ok", transitions: t } : { kind: "contradictory", reasons };
}

/**
 * The lanes whose WHOLE range sits at or below 1.00 — the same rule
 * `belowOneCount` applies to the histogram's buckets, applied to the lane
 * vocabulary that contains them.
 *
 * The two non-bucket lanes are never below one: an unbounded health factor is
 * not a small number and a row nobody measured has no health factor at all.
 */
export function belowOneLanes(transitions: RunBookTransitions): number[] {
  const scale = BigInt(transitions.wad_scale);
  const out: number[] = [];
  for (const lane of transitions.lanes) {
    if (lane.kind !== LANE_KIND_BUCKET) continue;
    if (lane.upper_wad !== null && BigInt(lane.upper_wad) <= scale) out.push(lane.index);
  }
  return out;
}

/**
 * THE GROSS CROSSINGS, derived from the CELLS.
 *
 * `entries` are rows that arrived in the region from outside it and `exits` are
 * rows that left it — two numbers the two histograms structurally could not
 * give, because a row that fell in and a row that rose out cancel exactly in
 * their difference. `net` is that difference, kept beside them rather than
 * replaced by them: it is still the population change, and the three together
 * are what make the offsetting case readable.
 *
 * NOT `lane_changed_rows`. That counts every lane change, including moves that
 * never touch this boundary, and it is not a crossing count of any particular
 * edge.
 */
export function crossingCounts(
  transitions: RunBookTransitions,
  lanes: readonly number[],
): { entries: number; exits: number; net: number } {
  const region = new Set(lanes);
  let entries = 0;
  let exits = 0;
  for (const outflow of transitions.outflows) {
    const fromInside = region.has(outflow.from);
    for (const cell of outflow.cells) {
      const toInside = region.has(cell.to);
      if (!fromInside && toInside) entries += cell.rows;
      if (fromInside && !toInside) exits += cell.rows;
    }
  }
  let net = 0;
  for (const lane of region) {
    net += (transitions.to_rows[lane] ?? 0) - (transitions.from_rows[lane] ?? 0);
  }
  return { entries, exits, net };
}

/**
 * One cell as the ribbon layer consumes it: the lane pair, the weight, and the
 * two debts left EXACTLY as the wire states them.
 *
 * `debtBefore`/`debtAfter` are `string | null` and stay that way. A null is the
 * unknowable this run measured nothing for, and the one thing this layer must
 * never do is turn it into a number.
 */
export interface TransitionRibbon {
  from: number;
  to: number;
  rows: number;
  fromLabel: string;
  toLabel: string;
  debtBefore: string | null;
  debtAfter: string | null;
  held: boolean;
  /** True for the (N+1, N+1) cell: rows this run measured on neither side. */
  unmeasured: boolean;
}

export function transitionRibbons(transitions: RunBookTransitions): TransitionRibbon[] {
  const labelOf = (index: number) => transitions.lanes[index]?.label ?? `lane ${String(index)}`;
  const kindOf = (index: number) => transitions.lanes[index]?.kind;
  const out: TransitionRibbon[] = [];
  for (const outflow of transitions.outflows) {
    for (const cell of outflow.cells) {
      out.push({
        from: outflow.from,
        to: cell.to,
        rows: cell.rows,
        fromLabel: labelOf(outflow.from),
        toLabel: labelOf(cell.to),
        debtBefore: cell.debt_before_usd,
        debtAfter: cell.debt_after_usd,
        held: outflow.from === cell.to,
        unmeasured:
          kindOf(outflow.from) === LANE_KIND_UNMEASURED && kindOf(cell.to) === LANE_KIND_UNMEASURED,
      });
    }
  }
  return out;
}

/**
 * How a movement count RENDERS. A null never renders as 0 and never renders as
 * an em dash that could read as "none": it says the book was not measured.
 */
export function movementCountText(value: number | null): string {
  return value === null ? "not measured" : String(value);
}
