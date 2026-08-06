// Wave W-TM — the run-book transition matrix's PURE DECISION LAYER
// (contract 1.7.0, `app/lab/labTransition.ts`).
//
// This module follows `matrixCells.ts`'s precedent: NOTHING IS CLASSIFIED
// BEFORE IT IS VALIDATED. The body can arrive from an older deployment or a
// broken one, and a flow picture whose ribbons do not sum to the bars printed
// beside them is a WRONG ANSWER THAT LOOKS COMPUTED — strictly worse than no
// answer at all.
//
// Laws under test:
//   - the served fixtures are read, so the law is not one that refuses
//     everything;
//   - a matrix whose margins disagree with EITHER served histogram is refused,
//     with a reason naming the disagreement;
//   - a matrix whose margins disagree with its OWN cells is refused, which is
//     the version-skew case a histogram comparison alone cannot see;
//   - a NULL movement count renders as "not measured" and NEVER as 0, and the
//     null/zero disagreement between the pair is itself a refusal;
//   - the crossings are derived FROM THE CELLS and are not `lane_changed_rows`;
//   - a cell's null debt is carried as a null and never coerced to a number.
//
// Wave W-SK-B adds (Codex r56):
//   - the unmeasured lane is DIAGONAL-ONLY: a cell with exactly one end there
//     is refused even when every margin balances (the margin-preserving swap);
//   - the visibility floor is DISCLOSED: floored ribbons are flagged, the
//     layout counts them, and the 10,000-row collision class is pinned;
//   - on the wad engine crit rides EVERY arrival below 1.00, held diagonals
//     included; the Debt Manager's identical shape takes none.
//
// Wave W-FIX-WEB adds:
//   - the margin tallies are keyed by lane KIND, never by position: a
//     reordered vocabulary whose swapped populations DIFFER reads clean, and
//     a body whose margins balance only BY POSITION over a reordered
//     vocabulary is refused with the four disagreements named.

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine, RunBookTransitions } from "../../lib/runbook";
import {
  belowOneLanes,
  crossingCounts,
  movementCountText,
  readTransitions,
  transitionRibbons,
} from "../../app/lab/labTransition";
import {
  FLOW_LABEL_W,
  FLOW_NODE_W,
  FLOW_RIBBON_MAX,
  FLOW_RIBBON_MIN,
  ribbonFloored,
  ribbonKind,
  ribbonThickness,
  transitionFlowLayout,
} from "../../app/lab/labTransitionFlow";
import { RUN_BOOK_ETH, RUN_BOOK_WEETH_BATCH_1 } from "../fixtures/lab-book";

function engineOf(response: { engines: readonly unknown[] }, name: string): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find((engine) => engine.engine === name);
  if (found === undefined) {
    throw new Error(`fixture carries no ${name} engine`);
  }
  return found;
}

/** The served engine with its matrix replaced by a mutant of the same shape. */
function withMatrix(
  engine: LabRunBookEngine,
  mutate: (t: RunBookTransitions) => RunBookTransitions,
): LabRunBookEngine {
  return { ...engine, hf_transitions: mutate(structuredClone(engine.hf_transitions)) };
}

function reasonsFor(engine: LabRunBookEngine): string[] {
  const reading = readTransitions(engine);
  if (reading.kind === "ok") {
    throw new Error("expected this body to be refused, and it was accepted");
  }
  return reading.reasons;
}

/** One side with `rows` added to one bucket AND to its account count. */
function bumpSide(
  side: LabRunBookEngine["before"],
  bucket: number,
  rows: number,
): LabRunBookEngine["before"] {
  return {
    ...side,
    accounts: side.accounts + rows,
    hf_histogram: {
      ...side.hf_histogram,
      buckets: side.hf_histogram.buckets.map((b, index) =>
        index === bucket ? { ...b, count: b.count + rows } : b,
      ),
    },
  };
}

/**
 * The engine with 2 rows ADDED that sit in `< 0.90` BEFORE the shock and stay
 * there: a held diagonal below 1.00, kept consistent on both sides (cells,
 * margins, histograms, account counts, totals) so `readTransitions` accepts
 * it as a valid body. Built the W-3L-D way: 2 rows against the Debt Manager's
 * committed 1-row held diagonal, so a mirror-image bug cannot satisfy both.
 */
function withHeldBelowOne(engine: LabRunBookEngine): LabRunBookEngine {
  const mutated = withMatrix(engine, (t) => ({
    ...t,
    outflows: t.outflows.map((outflow) =>
      outflow.from === 0
        ? {
            ...outflow,
            cells: [
              { to: 0, rows: 2, debt_before_usd: "120000000000", debt_after_usd: "119000000000" },
              ...outflow.cells,
            ],
          }
        : outflow,
    ),
    from_rows: t.from_rows.map((rows, index) => (index === 0 ? rows + 2 : rows)),
    to_rows: t.to_rows.map((rows, index) => (index === 0 ? rows + 2 : rows)),
    total_rows: t.total_rows + 2,
    measured_rows: t.measured_rows + 2,
    held_rows: (t.held_rows ?? 0) + 2,
  }));
  return {
    ...mutated,
    before: bumpSide(mutated.before, 0, 2),
    after: bumpSide(mutated.after, 0, 2),
  };
}

/**
 * The aave engine with its 3→0 fall widened from 1 row to 100, consistent on
 * both sides. The 1-row unmeasured diagonal then sits at 1/100 of the one
 * scale — 0.22px of honest ink — and must render at the floor, FLAGGED.
 */
function withWideFall(engine: LabRunBookEngine): LabRunBookEngine {
  const mutated = withMatrix(engine, (t) => ({
    ...t,
    outflows: t.outflows.map((outflow) =>
      outflow.from === 3
        ? {
            ...outflow,
            cells: outflow.cells.map((cell) =>
              cell.to === 0 ? { ...cell, rows: cell.rows + 99 } : cell,
            ),
          }
        : outflow,
    ),
    from_rows: t.from_rows.map((rows, index) => (index === 3 ? rows + 99 : rows)),
    to_rows: t.to_rows.map((rows, index) => (index === 0 ? rows + 99 : rows)),
    total_rows: t.total_rows + 99,
    measured_rows: t.measured_rows + 99,
    lane_changed_rows: (t.lane_changed_rows ?? 0) + 99,
  }));
  return {
    ...mutated,
    before: bumpSide(mutated.before, 3, 99),
    after: bumpSide(mutated.after, 0, 99),
  };
}

// ---------------------------------------------------------------------------
// The served bodies are read
// ---------------------------------------------------------------------------

test("every engine of every committed run-book fixture reads clean", () => {
  let engines = 0;
  for (const response of [RUN_BOOK_ETH, RUN_BOOK_WEETH_BATCH_1]) {
    for (const engine of response.engines as LabRunBookEngine[]) {
      const reading = readTransitions(engine);
      expect(reading.kind, `${engine.engine}: ${JSON.stringify(reading)}`).toBe("ok");
      engines += 1;
    }
  }
  // A law that read nothing would pass here too.
  expect(engines).toBeGreaterThanOrEqual(3);
});

// ---------------------------------------------------------------------------
// THE REFUSALS
// ---------------------------------------------------------------------------

test("a margin that disagrees with the BEFORE histogram is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken: LabRunBookEngine = {
    ...engine,
    before: {
      ...engine.before,
      hf_histogram: {
        ...engine.before.hf_histogram,
        buckets: engine.before.hf_histogram.buckets.map((bucket, index) =>
          index === 0 ? { ...bucket, count: bucket.count + 3 } : bucket,
        ),
      },
    },
  };
  const reasons = reasonsFor(broken);
  expect(reasons.join(" ")).toContain("the before distribution beside it counts");
});

test("a margin that disagrees with the AFTER histogram is refused too", () => {
  // Both sides are checked, so a deployment that got one right and one wrong is
  // still refused. Checking only the before side is the shape that would let an
  // after-side drift render.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken: LabRunBookEngine = {
    ...engine,
    after: {
      ...engine.after,
      hf_histogram: {
        ...engine.after.hf_histogram,
        infinite_count: engine.after.hf_histogram.infinite_count + 1,
      },
    },
  };
  expect(reasonsFor(broken).join(" ")).toContain("the after distribution beside it counts");
});

test("a margin that disagrees with its OWN cells is refused", () => {
  // THE CASE A HISTOGRAM COMPARISON ALONE CANNOT SEE. Move a margin AND the
  // histogram together and the two agree with each other while the cells under
  // them say something else — a ribbon set that does not sum to its own bar.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => {
    const bumped = { ...t, from_rows: [...t.from_rows] };
    bumped.from_rows[0] = (bumped.from_rows[0] ?? 0) + 2;
    return bumped;
  });
  const alsoBumped: LabRunBookEngine = {
    ...broken,
    before: {
      ...broken.before,
      hf_histogram: {
        ...broken.before.hf_histogram,
        buckets: broken.before.hf_histogram.buckets.map((bucket, index) =>
          index === 0 ? { ...bucket, count: bucket.count + 2 } : bucket,
        ),
      },
    },
  };
  const reasons = reasonsFor(alsoBumped);
  expect(reasons.join(" ")).toContain("while its own cells hold");
});

test("a comparator the distribution does not share is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => ({ ...t, comparator: "hf_wad" }));
  expect(reasonsFor(broken).join(" ")).toContain("the matrix is stated on comparator hf_wad");
});

test("a cause split that does not add up to the population it splits is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => ({
    ...t,
    unmeasured_refused_in_batch_rows: t.unmeasured_refused_in_batch_rows + 1,
  }));
  expect(reasonsFor(broken).join(" ")).toContain("two unmeasured causes do not add up");
});

test("a measured count the two sides do not support is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => ({
    ...t,
    measured_rows: t.measured_rows + 1,
    total_rows: t.total_rows + 1,
  }));
  expect(reasonsFor(broken).join(" ")).toContain("while the two sides beside it report");
});

/**
 * r57 item 10 — THE LANE VOCABULARY REORDERED so the unmeasured lane sits at a
 * NON-standard index (0, not 9), margins adjusted consistently.
 *
 * The permutation swaps lanes 0 and 9 (an involution): the lane objects trade
 * places (each keeping `index` == its new position), the two margins trade
 * entries 0↔9, and every outflow/cell index is remapped. It reads CLEAN on the
 * committed DM engine because both swapped lanes tally 1 row on both sides —
 * the '< 0.90' bucket count and the refused count are each 1 — so every
 * margin-versus-histogram comparison still balances. What changes is ONLY
 * which KIND sits at which index, which is exactly what an index-hardcoded
 * implementation cannot see.
 */
function withUnmeasuredLaneAtZero(t: RunBookTransitions): RunBookTransitions {
  const remap = (index: number) => (index === 0 ? 9 : index === 9 ? 0 : index);
  const lanes = [...t.lanes];
  const reordered = lanes.map((_, index) => {
    const source = lanes[remap(index)];
    if (source === undefined) throw new Error("the fixture lost a lane");
    return { ...source, index };
  });
  return {
    ...t,
    lanes: reordered,
    from_rows: t.from_rows.map((_, index) => t.from_rows[remap(index)] ?? 0),
    to_rows: t.to_rows.map((_, index) => t.to_rows[remap(index)] ?? 0),
    outflows: t.outflows.map((outflow) => ({
      ...outflow,
      from: remap(outflow.from),
      cells: outflow.cells.map((cell) => ({ ...cell, to: remap(cell.to) })),
    })),
  };
}

test("r57 item 10 — the reordered vocabulary reads CLEAN: the reorder itself is consistent", () => {
  // The acceptance half, so the refusal law below cannot pass for the wrong
  // reason (a margin mismatch introduced by a sloppy permutation).
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const reordered = withMatrix(engine, withUnmeasuredLaneAtZero);
  expect(reordered.hf_transitions.lanes[0]?.kind).toBe("unmeasured");
  expect(reordered.hf_transitions.lanes[9]?.kind).toBe("bucket");
  const reading = readTransitions(reordered);
  expect(reading.kind, JSON.stringify(reading)).toBe("ok");
});

test("r57 item 10 — a one-ended cell against the unmeasured lane AT INDEX 0 is refused BY KIND", () => {
  // KILLS: an implementation that hardcodes the unmeasured lane at index 9 (or
  // lanes.length - 1). The offending cells here are (0→6) and (6→0) — neither
  // touches index 9 — so an index-9 reading finds no one-ended cell, every sum
  // still balances, and the body renders fabricated measured movement. Only
  // the lane-KIND law can name these two cells.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const mutated = withMatrix(engine, (t) => {
    const reordered = withUnmeasuredLaneAtZero(t);
    return {
      ...reordered,
      outflows: reordered.outflows.map((outflow) => {
        // The unmeasured diagonal now sits at (0→0) and a balanced held bucket
        // diagonal at (6→6): swap them into (0→6) and (6→0). Both cells hold
        // 1 row, so every margin and every histogram tally is UNCHANGED.
        if (outflow.from === 0) {
          return {
            ...outflow,
            cells: outflow.cells.map((cell) => (cell.to === 0 ? { ...cell, to: 6 } : cell)),
          };
        }
        if (outflow.from === 6) {
          return {
            ...outflow,
            cells: outflow.cells.map((cell) => (cell.to === 6 ? { ...cell, to: 0 } : cell)),
          };
        }
        return outflow;
      }),
    };
  });
  const reasons = reasonsFor(mutated);
  // Exactly the two one-ended cells, and nothing else fired — proof the mutant
  // is margin-preserving and the refusal is the kind law's own.
  expect(reasons).toHaveLength(2);
  for (const reason of reasons) {
    expect(reason).toContain("exactly one end in the unmeasured lane");
    expect(reason).toContain("unmeasured on both sides");
    expect(reason).not.toContain("lane 9");
  }
  expect(reasons.join(" ")).toContain("lane 0 (not measured) → lane 6 (1.50 – 2.00)");
  expect(reasons.join(" ")).toContain("lane 6 (1.50 – 2.00) → lane 0 (not measured)");
});

/**
 * W-FIX-WEB — the PERMUTED engine with 2 rows ADDED to its unmeasured
 * population, consistently on every surface that states it: the (0,0)
 * unmeasured diagonal, both margins at index 0, the totals, the cause split,
 * and both histograms' `refused_count`. Accounts are untouched — an
 * unmeasured row is not a measured account.
 *
 * The point is to BREAK the count coincidence r57 item 10's permutation rides
 * on. The committed DM body tallies 1 row in BOTH swapped lanes, so even a
 * POSITIONAL tally read of the permuted body balanced — by luck, not by law.
 * After this bump the unmeasured population (3) differs from the `< 0.90`
 * bucket's (1), and the coincidence is gone.
 */
function withBiggerUnmeasuredPopulation(engine: LabRunBookEngine): LabRunBookEngine {
  const mutated = withMatrix(engine, (t) => ({
    ...t,
    outflows: t.outflows.map((outflow) =>
      outflow.from === 0
        ? {
            ...outflow,
            cells: outflow.cells.map((cell) =>
              cell.to === 0 ? { ...cell, rows: cell.rows + 2 } : cell,
            ),
          }
        : outflow,
    ),
    from_rows: t.from_rows.map((rows, index) => (index === 0 ? rows + 2 : rows)),
    to_rows: t.to_rows.map((rows, index) => (index === 0 ? rows + 2 : rows)),
    total_rows: t.total_rows + 2,
    unmeasured_rows: t.unmeasured_rows + 2,
    unmeasured_refused_in_batch_rows: t.unmeasured_refused_in_batch_rows + 2,
  }));
  const bumpRefused = (side: LabRunBookEngine["before"]): LabRunBookEngine["before"] => ({
    ...side,
    hf_histogram: {
      ...side.hf_histogram,
      refused_count: side.hf_histogram.refused_count + 2,
    },
  });
  return { ...mutated, before: bumpRefused(mutated.before), after: bumpRefused(mutated.after) };
}

test("W-FIX-WEB — tallies are keyed by lane KIND: a reordered vocabulary with DIFFERING swapped populations reads CLEAN", () => {
  // KILLS: the positional tallyAt (lane < buckets → buckets[lane], then
  // infinite, then unmeasured). On this HONEST body the unmeasured lane sits
  // at index 0 holding 3 rows while `< 0.90` sits at index 9 holding 1; a
  // positional read compares margin[0] (3) against buckets[0].count (1) and
  // margin[9] (1) against refused_count (3), and refuses a body whose every
  // stated number is true. Only a read keyed by the lane's KIND accepts it.
  const engine = withBiggerUnmeasuredPopulation(
    withMatrix(engineOf(RUN_BOOK_ETH, "debt_manager"), withUnmeasuredLaneAtZero),
  );
  expect(engine.hf_transitions.lanes[0]?.kind).toBe("unmeasured");
  // The coincidence r57 item 10 rode on is really broken on this body.
  expect(engine.before.hf_histogram.refused_count).not.toBe(
    engine.before.hf_histogram.buckets[0]?.count,
  );
  const reading = readTransitions(engine);
  expect(reading.kind, JSON.stringify(reading)).toBe("ok");
});

test("W-FIX-WEB — the positional blind spot: margins balanced BY POSITION over a reordered vocabulary are refused BY KIND", () => {
  // THE COINCIDENTALLY-BALANCED MUTANT CASE, constructed. Start from the
  // honest differing body above, then restate the two swapped lanes at each
  // other's populations — margin[0] = 1 (which IS buckets[0].count) and
  // margin[9] = 3 (which IS refused_count) — and rebalance the two diagonals
  // so every cell sum, the total and the cause split still hold. EVERY
  // positional comparison now balances, so a positional tallyAt accepts this
  // body WHOLE while it states the unmeasured lane at a third of the
  // population both histograms count there. The kind-keyed read names all
  // four disagreements.
  const engine = withBiggerUnmeasuredPopulation(
    withMatrix(engineOf(RUN_BOOK_ETH, "debt_manager"), withUnmeasuredLaneAtZero),
  );
  const lying = withMatrix(engine, (t) => ({
    ...t,
    outflows: t.outflows.map((outflow) => {
      if (outflow.from === 0) {
        return {
          ...outflow,
          cells: outflow.cells.map((cell) => (cell.to === 0 ? { ...cell, rows: 1 } : cell)),
        };
      }
      if (outflow.from === 9) {
        return {
          ...outflow,
          cells: outflow.cells.map((cell) => (cell.to === 9 ? { ...cell, rows: 3 } : cell)),
        };
      }
      return outflow;
    }),
    from_rows: t.from_rows.map((rows, index) => (index === 0 ? 1 : index === 9 ? 3 : rows)),
    to_rows: t.to_rows.map((rows, index) => (index === 0 ? 1 : index === 9 ? 3 : rows)),
  }));
  const reasons = reasonsFor(lying);
  // Exactly the four margin-versus-distribution disagreements — two lanes on
  // two sides — and NOTHING else fired: the proof that the cell sums, the
  // totals, the cause split and the diagonal law all balance, which is
  // precisely the body a positional read waves through.
  expect(reasons).toHaveLength(4);
  for (const reason of reasons) {
    expect(reason).toContain("distribution beside it counts");
  }
  expect(reasons.join(" ")).toContain("the before margin states 1 rows in lane 0");
  expect(reasons.join(" ")).toContain("the after margin states 1 rows in lane 0");
  expect(reasons.join(" ")).toContain("the before margin states 3 rows in lane 9");
  expect(reasons.join(" ")).toContain("the after margin states 3 rows in lane 9");
});

test("a cell with exactly ONE end in the unmeasured lane is refused: the margin-preserving swap", () => {
  // Codex r56's mutant. The Debt Manager's balanced diagonals — (0→0) holds
  // 1 row, (9→9) holds 1 row — swapped into (0→9) and (9→0). EVERY margin is
  // unchanged: row sums, column sums, both histograms, all totals. Every sum
  // check passes, and the picture would draw a measured row dissolving into
  // the unmeasured lane and an unmeasured row materializing out of it — two
  // measurements nobody made, rendered as measured movement. Only the
  // lane-KIND law can refuse it: a row unmeasured in this run is unmeasured
  // on BOTH sides, because refusal is row-level for the whole run.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const swapped = withMatrix(engine, (t) => ({
    ...t,
    outflows: t.outflows.map((outflow) => {
      if (outflow.from === 0) {
        return {
          ...outflow,
          cells: outflow.cells.map((cell) => (cell.to === 0 ? { ...cell, to: 9 } : cell)),
        };
      }
      if (outflow.from === 9) {
        return {
          ...outflow,
          cells: outflow.cells.map((cell) => (cell.to === 9 ? { ...cell, to: 0 } : cell)),
        };
      }
      return outflow;
    }),
  }));
  const reasons = reasonsFor(swapped);
  // BOTH offending cells are named — and NOTHING else fired, which is the
  // proof the mutant really is margin-preserving: without this check the body
  // would have been accepted whole.
  expect(reasons).toHaveLength(2);
  for (const reason of reasons) {
    expect(reason).toContain("exactly one end in the unmeasured lane");
    expect(reason).toContain("unmeasured on both sides");
  }
  expect(reasons.join(" ")).toContain("lane 0 (< 0.90) → lane 9 (not measured)");
  expect(reasons.join(" ")).toContain("lane 9 (not measured) → lane 0 (< 0.90)");
});

test("Codex r65 — the bucket join is the WHOLE identity: a drifted edge under a matching label refuses", () => {
  // KILLS: the label-only join (candidate.label === lane.label alone). Rev2
  // §2.1 makes (label, lower_wad, upper_wad) the bucket identity — a body
  // whose histogram keeps a bucket's display label while one exact edge
  // drifts is two vocabularies wearing one name, and joining them renders
  // reconciled-looking margins over bands that are not the same band. The
  // three-field join finds no such bucket and refuses; a label-only mutant
  // finds it and reads this body CLEAN.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const lane = engine.hf_transitions.lanes.find((candidate) => candidate.kind === "bucket");
  if (lane === undefined) throw new Error("fixture invariant: a bucket lane exists");
  const drifted: typeof engine = {
    ...engine,
    before: {
      ...engine.before,
      hf_histogram: {
        ...engine.before.hf_histogram,
        buckets: engine.before.hf_histogram.buckets.map((bucket) =>
          bucket.label === lane.label
            ? { ...bucket, lower_wad: `${bucket.lower_wad}1` }
            : bucket,
        ),
      },
    },
  };
  const reading = readTransitions(drifted);
  expect(reading.kind).toBe("contradictory");
  if (reading.kind !== "contradictory") return;
  expect(reading.reasons.join(" ")).toContain(
    `lane ${String(engine.hf_transitions.lanes.indexOf(lane))} (${lane.label})`,
  );
  expect(reading.reasons.join(" ")).toContain("does not serve");
  // The after side is untouched, so ONLY the before side refused — the join
  // really is per histogram, not a shared verdict.
  expect(reading.reasons.filter((reason) => reason.includes("does not serve"))).toHaveLength(1);
});

test("Codex r65 — a lane kind outside the closed vocabulary refuses; unknown never means skip", () => {
  // KILLS: the silent-skip arm. tallyAt returns null for an unknown kind and
  // the old caller refused null only for kind === "bucket" — a renamed or
  // typoed kind from a newer/broken deployment (runtime JSON is cast, not
  // validated) turned OFF the margin-versus-distribution comparison for that
  // lane while belowOneLanes went on publishing crossing counts over it.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const unknownKind: typeof engine = {
    ...engine,
    hf_transitions: {
      ...engine.hf_transitions,
      lanes: engine.hf_transitions.lanes.map((laneRecord, index) =>
        index === 0 ? { ...laneRecord, kind: "buckett" as typeof laneRecord.kind } : laneRecord,
      ),
    },
  };
  const reading = readTransitions(unknownKind);
  expect(reading.kind).toBe("contradictory");
  if (reading.kind !== "contradictory") return;
  const vocab = reading.reasons.filter((reason) =>
    reason.includes("outside the contract's closed vocabulary"),
  );
  // ONCE per lane, naming the kind verbatim.
  expect(vocab).toHaveLength(1);
  expect(vocab[0]).toContain('"buckett"');
});

// ---------------------------------------------------------------------------
// NULL IS NOT ZERO
// ---------------------------------------------------------------------------

test("a NULL movement count renders as `not measured`, never as 0", () => {
  expect(movementCountText(null)).toBe("not measured");
  // And a real zero renders as a zero. The two must not collapse in either
  // direction: `0` means every measured row held its lane, and `null` means
  // this run measured no row at all.
  expect(movementCountText(0)).toBe("0");
  expect(movementCountText(3)).toBe("3");
  expect(movementCountText(null)).not.toBe("0");
});

test("a matrix that states a movement count over a book it measured no row of is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => ({
    ...t,
    measured_rows: 0,
    total_rows: t.unmeasured_rows,
    // The zero that would read as "this scenario moved nobody" over a book
    // nobody measured — the exact shape the server refuses to compose.
    held_rows: 0,
    lane_changed_rows: 0,
    from_rows: t.from_rows.map((_, index) => (index === t.lanes.length - 1 ? t.unmeasured_rows : 0)),
    to_rows: t.to_rows.map((_, index) => (index === t.lanes.length - 1 ? t.unmeasured_rows : 0)),
    outflows: t.outflows.map((outflow) =>
      outflow.from === t.lanes.length - 1 ? outflow : { ...outflow, cells: [] },
    ),
  }));
  expect(reasonsFor(broken).join(" ")).toContain(
    "states a movement count over a book it measured no row of",
  );
});

test("a matrix that withholds ONE movement count and states the other is refused", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const broken = withMatrix(engine, (t) => ({ ...t, held_rows: null }));
  expect(reasonsFor(broken).join(" ")).toContain("withholds one movement count and states the other");
});

// ---------------------------------------------------------------------------
// THE CROSSINGS ARE DERIVED FROM THE CELLS
// ---------------------------------------------------------------------------

test("belowOneLanes is the bucket lanes whose WHOLE range sits at or below 1.00", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const lanes = belowOneLanes(engine.hf_transitions);
  expect(lanes).toEqual([0, 1]);
  // The two non-bucket lanes are NEVER in the region: an unbounded health
  // factor is not a small number, and a row nobody measured has none at all.
  const kinds = lanes.map((lane) => engine.hf_transitions.lanes[lane]?.kind);
  expect(kinds.every((kind) => kind === "bucket")).toBe(true);
  expect(lanes).not.toContain(engine.hf_transitions.lanes.length - 1);
  expect(lanes).not.toContain(engine.hf_transitions.lanes.length - 2);
});

test("THE OFFSETTING BOOK: two in, one out, a net of one, and three lane changes", () => {
  // The §5.3 committed shape, stated as its JOINT. This is the discriminating
  // case: FOUR numbers about the same three rows, and no two of them agree.
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const t: RunBookTransitions = {
    ...engine.hf_transitions,
    from_rows: [1, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    to_rows: [2, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    outflows: engine.hf_transitions.outflows.map((outflow) => {
      const cell = (to: number) => [{ to, rows: 1, debt_before_usd: "0", debt_after_usd: "0" }];
      if (outflow.from === 4) return { ...outflow, cells: cell(0) };
      if (outflow.from === 3) return { ...outflow, cells: cell(0) };
      if (outflow.from === 0) return { ...outflow, cells: cell(3) };
      return { ...outflow, cells: [] };
    }),
    total_rows: 3,
    measured_rows: 3,
    unmeasured_rows: 0,
    unmeasured_refused_in_batch_rows: 0,
    unmeasured_excluded_by_this_layer_rows: 0,
    held_rows: 0,
    lane_changed_rows: 3,
  };

  const { entries, exits, net } = crossingCounts(t, belowOneLanes(t));
  expect(entries).toBe(2);
  expect(exits).toBe(1);
  expect(net).toBe(1);
  // AND THE CROSSINGS ARE NOT `lane_changed_rows`. All four are different, and
  // `entries + exits === lane_changed_rows` holds here only because no measured
  // row on this book changes lane without crossing the boundary — a coincidence
  // of the fixture, never a law.
  expect(t.lane_changed_rows).toBe(3);
  expect(entries).not.toBe(t.lane_changed_rows);
  expect(net).not.toBe(t.lane_changed_rows);

  // A row that moves BETWEEN two bands on the same side of 1.00 changes lane
  // and crosses nothing — which is what makes the two counts different kinds.
  const inside: RunBookTransitions = {
    ...t,
    from_rows: [0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    to_rows: [0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    outflows: t.outflows.map((outflow) =>
      outflow.from === 4
        ? { ...outflow, cells: [{ to: 3, rows: 1, debt_before_usd: "0", debt_after_usd: "0" }] }
        : outflow.from === 3
          ? { ...outflow, cells: [{ to: 3, rows: 1, debt_before_usd: "0", debt_after_usd: "0" }] }
          : { ...outflow, cells: [] },
    ),
    total_rows: 2,
    measured_rows: 2,
    held_rows: 1,
    lane_changed_rows: 1,
  };
  const insideCounts = crossingCounts(inside, belowOneLanes(inside));
  expect(insideCounts).toEqual({ entries: 0, exits: 0, net: 0 });
  expect(inside.lane_changed_rows).toBe(1);
});

// ---------------------------------------------------------------------------
// A NULL CELL DEBT IS AN UNKNOWABLE
// ---------------------------------------------------------------------------

test("the ribbon layer carries a null cell debt as a NULL and never as a number", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const ribbons = transitionRibbons(engine.hf_transitions);
  expect(ribbons.length).toBeGreaterThan(0);

  const unmeasured = ribbons.filter((ribbon) => ribbon.unmeasured);
  expect(unmeasured).toHaveLength(1);
  expect(unmeasured[0]?.debtBefore).toBeNull();
  expect(unmeasured[0]?.debtAfter).toBeNull();
  // `Number(null)` is 0, and that coercion is the whole hazard: it would render
  // "this run measured nothing" as "$0.00".
  expect(Number(unmeasured[0]?.debtBefore)).toBe(0);
  expect(unmeasured[0]?.debtBefore).not.toBe("0");
  expect(unmeasured[0]?.toLabel).toBe("not measured");

  // Every MEASURED cell carries both figures, so the null is a disclosure
  // rather than a gap the wire has everywhere.
  for (const ribbon of ribbons.filter((r) => !r.unmeasured)) {
    expect(ribbon.debtBefore).not.toBeNull();
    expect(ribbon.debtAfter).not.toBeNull();
  }
});

// ---------------------------------------------------------------------------
// THE FLOW'S GEOMETRY LAWS (Wave W-SK) — pure, no browser
// ---------------------------------------------------------------------------

test("ribbon thickness: one linear scale, anchored at the widest cell, floored at visibility", () => {
  // The widest cell takes the maximum, exactly.
  expect(ribbonThickness(100, 100)).toBe(FLOW_RIBBON_MAX);
  expect(ribbonThickness(1, 1)).toBe(FLOW_RIBBON_MAX);
  // A 1-row cell in a large matrix stays visible as the hairline floor — and
  // the floor cannot be confused with a larger cell, which draws thicker.
  expect(ribbonThickness(1, 1000)).toBe(FLOW_RIBBON_MIN);
  expect(ribbonThickness(1, 1000)).toBeLessThan(ribbonThickness(500, 1000));
  // ONE LINEAR SCALE above the floor: twice the rows is twice the ink.
  expect(ribbonThickness(50, 100)).toBeCloseTo(FLOW_RIBBON_MAX / 2);
  expect(ribbonThickness(25, 100) * 2).toBeCloseTo(ribbonThickness(50, 100));
  // An absent cell draws NOTHING. `transitionRibbons` never emits rows 0, and
  // the scale refuses to invent ink for one anyway.
  expect(ribbonThickness(0, 100)).toBe(0);
});

test("the floor's collision class is FLAGGED: widest 10,000, rows 1 and 681 render identical ink", () => {
  // Codex r56's numbers, pinned exactly. With a 10,000-row widest cell the
  // linear scale gives a 1-row cell 0.0022px and a 681-row cell 1.4982px —
  // both render at the 1.5px floor, identical ink across a 681× difference —
  // and BOTH carry the floored flag, because that identity is the one place
  // the picture and the advertised scale disagree.
  expect(ribbonThickness(1, 10000)).toBe(FLOW_RIBBON_MIN);
  expect(ribbonThickness(681, 10000)).toBe(FLOW_RIBBON_MIN);
  expect(ribbonThickness(681, 10000)).toBe(ribbonThickness(1, 10000));
  expect(ribbonFloored(1, 10000)).toBe(true);
  expect(ribbonFloored(681, 10000)).toBe(true);
  // 682 rows is the first cell OFF the floor: unflagged and STRICTLY thicker.
  expect(ribbonFloored(682, 10000)).toBe(false);
  expect(ribbonThickness(682, 10000)).toBeGreaterThan(FLOW_RIBBON_MIN);
  expect(ribbonThickness(682, 10000)).toBeGreaterThan(ribbonThickness(681, 10000));
  // The widest cell is never floored, and an absent cell draws nothing rather
  // than a flagged nothing.
  expect(ribbonFloored(10000, 10000)).toBe(false);
  expect(ribbonFloored(0, 10000)).toBe(false);
  expect(ribbonFloored(1, 0)).toBe(false);
});

test("the layout counts its floored ribbons, and zero floored means zero disclosure", () => {
  // Widen aave's fall to 100 rows, consistently on both sides — a VALID body,
  // proven by the reader before the layout is asked anything.
  const wide = withWideFall(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi"));
  expect(readTransitions(wide).kind).toBe("ok");
  const layout = transitionFlowLayout(wide.hf_transitions, 900);

  // The 1-row unmeasured diagonal sits at 1/100 of the scale — 0.22px of
  // honest ink — so it renders AT the floor and is flagged; the 100-row fall
  // keeps the 22px anchor, unflagged.
  const fall = layout.ribbons.find((flow) => flow.ribbon.from === 3 && flow.ribbon.to === 0);
  const diagonal = layout.ribbons.find((flow) => flow.ribbon.from === 9 && flow.ribbon.to === 9);
  expect(fall?.thickness).toBe(FLOW_RIBBON_MAX);
  expect(fall?.floored).toBe(false);
  expect(diagonal?.thickness).toBe(FLOW_RIBBON_MIN);
  expect(diagonal?.floored).toBe(true);
  expect(layout.flooredCount).toBe(1);
  expect(layout.flooredCount).toBe(layout.ribbons.filter((flow) => flow.floored).length);

  // And the committed fixtures, whose widest cell IS 1 row, floor nothing:
  // the disclosure exists only when a ribbon is actually on the floor, never
  // as a standing disclaimer.
  for (const name of ["aave_v3_etherfi", "debt_manager"]) {
    const served = transitionFlowLayout(engineOf(RUN_BOOK_ETH, name).hf_transitions, 900);
    expect(served.flooredCount).toBe(0);
    for (const flow of served.ribbons) {
      expect(flow.floored).toBe(false);
    }
  }
});

test("the unmeasured diagonal is its OWN class, never held and never changed", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const ribbons = transitionRibbons(engine.hf_transitions);

  const unmeasured = ribbons.find((ribbon) => ribbon.unmeasured);
  if (unmeasured === undefined) throw new Error("the fixture carries no unmeasured cell");
  // It IS a diagonal cell — and still not "held": nothing was measured, so
  // nothing can be said to have held its lane.
  expect(unmeasured.from).toBe(unmeasured.to);
  expect(unmeasured.held).toBe(true);
  expect(ribbonKind(unmeasured)).toBe("unmeasured");

  const held = ribbons.find((ribbon) => ribbon.held && !ribbon.unmeasured);
  if (held === undefined) throw new Error("the fixture carries no held-measured cell");
  expect(ribbonKind(held)).toBe("held");
  expect(ribbonKind(held)).not.toBe(ribbonKind(unmeasured));

  const changed = ribbons.find((ribbon) => !ribbon.held);
  if (changed === undefined) throw new Error("the fixture carries no lane-changed cell");
  expect(ribbonKind(changed)).toBe("changed");
});

test("the flow lays out ONLY what exists: occupied cells, nonempty nodes, the whole vocabulary", () => {
  const engine = engineOf(RUN_BOOK_ETH, "aave_v3_etherfi");
  const t = engine.hf_transitions;
  const layout = transitionFlowLayout(t, 900);

  // One ribbon per OCCUPIED cell — an absent cell is absent from the layout.
  expect(layout.ribbons).toHaveLength(transitionRibbons(t).length);
  for (const flow of layout.ribbons) {
    expect(flow.thickness).toBeGreaterThan(0);
    expect(flow.x1).toBeLessThan(flow.x2);
  }

  // NONEMPTY-ONLY NODES: exactly the lanes whose side margin is nonzero, and
  // each node carries the wire's own margin integer.
  const nonzero = (margin: readonly number[]) =>
    margin.flatMap((rows, lane) => (rows > 0 ? [lane] : []));
  const beforeNodes = layout.nodes.filter((node) => node.side === "before");
  const afterNodes = layout.nodes.filter((node) => node.side === "after");
  expect(beforeNodes.map((node) => node.lane)).toEqual(nonzero(t.from_rows));
  expect(afterNodes.map((node) => node.lane)).toEqual(nonzero(t.to_rows));
  for (const node of layout.nodes) {
    const margin = node.side === "before" ? t.from_rows[node.lane] : t.to_rows[node.lane];
    expect(node.rows).toBe(margin);
    expect(node.height).toBeGreaterThan(0);
  }

  // THE COMPLETE VOCABULARY: every lane labels BOTH sides, dimmed exactly where
  // that side's margin is zero, and every printed count is the wire's integer.
  expect(layout.labels).toHaveLength(t.lanes.length * 2);
  for (const label of layout.labels) {
    const margin =
      (label.side === "before" ? t.from_rows[label.lane] : t.to_rows[label.lane]) ?? 0;
    expect(label.empty).toBe(margin === 0);
    expect(label.text).toBe(`${t.lanes[label.lane]?.label ?? ""} · ${String(margin)}`);
  }

  // The measured width is respected: nothing is laid out past either edge.
  expect(layout.width).toBe(900);
  for (const node of layout.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(FLOW_LABEL_W);
    expect(node.width).toBe(FLOW_NODE_W);
    expect(node.x + node.width).toBeLessThanOrEqual(900 - FLOW_LABEL_W);
  }
});

test("the crit tint follows the comparator asymmetry, never the lane alone", () => {
  const aave = engineOf(RUN_BOOK_ETH, "aave_v3_etherfi");
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const aaveLayout = transitionFlowLayout(aave.hf_transitions, 900);
  const dmLayout = transitionFlowLayout(dm.hf_transitions, 900);

  // On the wad engine, crit rides EXACTLY the arrivals below 1.00. The KIND
  // does not gate it (W-SK-B ruling: a held row below 1.00 is still in the
  // liquidation set); the destination lane does, and only there.
  const region = new Set(belowOneLanes(aave.hf_transitions));
  for (const flow of aaveLayout.ribbons) {
    expect(flow.crit).toBe(region.has(flow.ribbon.to));
  }
  expect(aaveLayout.ribbons.filter((flow) => flow.crit)).toHaveLength(1);

  // The Debt Manager HAS a below-1.00 arrival on this very book (lane 5 to
  // lane 1) and it still takes no crit: its lanes are the exact rational
  // maxBorrowLT/borrowings, a DISCLOSURE and not its liquidation trigger. The
  // two engines' arrivals are asymmetric on purpose (5→1 versus 3→0), so a
  // mirror-image bug cannot satisfy both assertions.
  const arrival = dmLayout.ribbons.find(
    (flow) => flow.ribbon.from === 5 && flow.ribbon.to === 1,
  );
  if (arrival === undefined) throw new Error("the DM fixture lost its below-1.00 arrival");
  expect(arrival.kind).toBe("changed");
  expect(arrival.crit).toBe(false);
  expect(dmLayout.ribbons.some((flow) => flow.crit)).toBe(false);
});

test("crit rides EVERY arrival below 1.00 on the wad engine, held diagonals included", () => {
  // The W-SK-B ruling: the ledger's semantic wins. A row that STAYED below
  // 1.00 through the shock is still in the liquidation set, and a reader
  // using the tint to find that set must see it. The held/changed distinction
  // stays on the emphasis classes; the HUE is crit for every arrival.
  const aave = withHeldBelowOne(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi"));
  expect(readTransitions(aave).kind).toBe("ok");
  const layout = transitionFlowLayout(aave.hf_transitions, 900);

  const held = layout.ribbons.find((flow) => flow.ribbon.from === 0 && flow.ribbon.to === 0);
  if (held === undefined) throw new Error("the mutated book lost its held diagonal");
  expect(held.kind).toBe("held");
  expect(held.crit).toBe(true);

  const fall = layout.ribbons.find((flow) => flow.ribbon.from === 3 && flow.ribbon.to === 0);
  if (fall === undefined) throw new Error("the mutated book lost its arrival");
  expect(fall.kind).toBe("changed");
  expect(fall.crit).toBe(true);

  // The unmeasured diagonal can NEVER be crit: its lane is not a bucket lane,
  // so it is never in the below-1.00 region — no verdict over an unknowable.
  const diagonal = layout.ribbons.find((flow) => flow.kind === "unmeasured");
  expect(diagonal?.crit).toBe(false);
  expect(layout.ribbons.filter((flow) => flow.crit)).toHaveLength(2);

  // The Debt Manager's COMMITTED book holds the identical shape — a held
  // diagonal sitting in `< 0.90` — and takes no crit anywhere: that region is
  // a disclosure there, not a liquidation verdict. Asymmetric on purpose:
  // aave holds 2 rows below 1.00 and the DM holds 1, so a mirror-image bug
  // cannot satisfy both books.
  expect(held.ribbon.rows).toBe(2);
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const dmLayout = transitionFlowLayout(dm.hf_transitions, 900);
  const dmHeld = dmLayout.ribbons.find((flow) => flow.ribbon.from === 0 && flow.ribbon.to === 0);
  if (dmHeld === undefined) throw new Error("the DM fixture lost its held diagonal");
  expect(dmHeld.ribbon.rows).toBe(1);
  expect(dmHeld.kind).toBe("held");
  expect(dmHeld.crit).toBe(false);
  expect(dmLayout.ribbons.some((flow) => flow.crit)).toBe(false);
});

test("the ribbons are the OCCUPIED cells only, each labelled by its two lanes", () => {
  const engine = engineOf(RUN_BOOK_ETH, "debt_manager");
  const t = engine.hf_transitions;
  const ribbons = transitionRibbons(t);
  // Sparse: an absent cell is a KNOWABLE zero, made knowable by the dense
  // margins beside it — so the ribbon count is the occupied count, not 100.
  expect(ribbons.length).toBeLessThan(t.lanes.length * t.lanes.length);
  expect(ribbons.reduce((sum, ribbon) => sum + ribbon.rows, 0)).toBe(t.total_rows);
  for (const ribbon of ribbons) {
    expect(ribbon.rows).toBeGreaterThanOrEqual(1);
    expect(ribbon.fromLabel).toBe(t.lanes[ribbon.from]?.label);
    expect(ribbon.toLabel).toBe(t.lanes[ribbon.to]?.label);
    expect(ribbon.held).toBe(ribbon.from === ribbon.to);
  }
});
