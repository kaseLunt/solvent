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

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine, RunBookTransitions } from "../../lib/runbook";
import {
  belowOneLanes,
  crossingCounts,
  movementCountText,
  readTransitions,
  transitionRibbons,
} from "../../app/lab/labTransition";
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
