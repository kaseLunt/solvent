// p1b-2 — THE FULL RunBookEngine SUBTREE CLASSIFIER (closes Codex r3
// finding 1). The p0-9 gate validated 4 of ~40+ numeric wire fields the
// run-book detail consumes; every other field fed a THROWING renderer (the
// route boundary took the page) or a silently-permissive `BigInt` coercion
// (a malformed body wearing a measured-zero costume). `classifyRunBookEngine`
// is exhaustive over that inventory, one law one function, with array fields
// named PER INDEX — `movers[2].hf_before_wad`, never a bare group name.
//
// The skeleton is the COMMITTED run-book fixture's own engine
// (`run-book.eth_minus_30.json`, the contract's 200 example): each test
// clones it, makes ONE documented corruption, and expects the classifier to
// name exactly that field. The untouched skeleton classifies CLEAN — the law
// is not one that refuses everything.
//
// NULLABILITY IS THE SCHEMA'S, EXACTLY. `NullableDecimal` fields
// (`buckets[].upper_wad`, `lanes[].upper_wad`, `cells[].debt_*_usd`,
// `movers[].hf_*_wad`/`debt_usd`, `collateral_by_asset[].value_usd`) are
// checked only when non-null: a schema-legal null is a STATEMENT (unbounded,
// unmeasured, unpriced, not-this-engine's-vocabulary), never malformed.

import { expect, test } from "@playwright/test";
import { classifyRunBookEngine } from "../../app/lab/engineClassification";
import type { LabRunBookEngine } from "../../lib/runbook";
import { RUN_BOOK_ETH } from "../fixtures/lab-book";

/**
 * The committed fixture's engine, cloned. The fixture's `projection` is null,
 * so the wire engine IS the Lab engine (refinement is the identity here) —
 * the same cast lab-transition.spec.ts reads the fixture through.
 */
function engineOf(name: string): LabRunBookEngine {
  const found = RUN_BOOK_ETH.engines.find((engine) => engine.engine === name);
  if (found === undefined) throw new Error(`fixture carries no ${name} engine`);
  return structuredClone(found) as unknown as LabRunBookEngine;
}

/** Clone the aave engine, apply ONE documented corruption, classify. */
function corrupted(mutate: (engine: LabRunBookEngine) => void): string[] {
  const engine = engineOf("aave_v3_etherfi");
  mutate(engine);
  return classifyRunBookEngine(engine).malformedFields;
}

/** A contract-legal Shortfall — api/openapi.yaml's own example values. */
function legalShortfall(): NonNullable<LabRunBookEngine["market_realization"]> {
  return {
    hfs_unchanged: true,
    execution_shortfall_usd: "3864",
    bad_debt_at_liquidation_usd: "0",
    usd_decimals: 8,
    seizure_model: "pro-rata-over-counted-collateral",
    note: "",
  };
}

/** A contract-legal REFINED projection (the shape LabRunBookEngine carries). */
function legalProjection(): NonNullable<LabRunBookEngine["projection"]> {
  return {
    label: "PROJECTION",
    basis: "delta-only",
    annual_delta_bps: 200,
    apy_observed_at_block: 123456,
    prices_held_flat: true,
    horizons: [
      {
        horizon_seconds: 2592000,
        debt_usd: "600000000000",
        projected_usd: "601000000000",
        additional_interest_usd: "1000000000",
        liquidation_verdict: "not-liquidatable",
      },
    ],
    note: "",
  };
}

// ---------------------------------------------------------------------------
// The clean arm: the committed fixture, and every schema-legal null in it.
// ---------------------------------------------------------------------------

test("p1b-2: both committed engines classify CLEAN — the law does not refuse the served book", () => {
  expect(classifyRunBookEngine(engineOf("aave_v3_etherfi")).malformedFields).toEqual([]);
  expect(classifyRunBookEngine(engineOf("debt_manager")).malformedFields).toEqual([]);
});

test("p1b-2: schema-legal nulls are statements, never malformed", () => {
  // The fixture already carries them all — an unpriced collateral entry
  // (value_usd null), the open-ended top bucket (upper_wad null), the
  // non-bucket lanes, the (N+1,N+1) cell's null debts, the aave mover's null
  // debt_usd — but each is also pinned EXPLICITLY so the nullable arms cannot
  // regress one at a time.
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.upper_wad = null;
    }),
  ).toEqual([]);
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[3];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.upper_wad = null;
    }),
  ).toEqual([]);
  expect(
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      mover.hf_drop_wad = null;
    }),
  ).toEqual([]);
  expect(
    corrupted((engine) => {
      const asset = engine.before.collateral_by_asset[1];
      if (!asset) throw new Error("fixture shape: collateral entry missing");
      asset.value_usd = null;
    }),
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// The engine scalars and the two aggregates.
// ---------------------------------------------------------------------------

test("p1b-2: a fractional usd_decimals is named — the scale the money renderers exponentiate", () => {
  expect(corrupted((engine) => (engine.usd_decimals = 2.5))).toEqual(["usd_decimals"]);
});

test("p1b-2: an aggregate Decimal outside the contract is named by side and field", () => {
  expect(corrupted((engine) => (engine.before.total_debt_usd = ""))).toEqual([
    "before.total_debt_usd",
  ]);
  expect(corrupted((engine) => (engine.after.bad_debt_usd = "0.0"))).toEqual([
    "after.bad_debt_usd",
  ]);
  // a non-string smuggled past the JSON cast is malformed, not a coerced read
  expect(
    corrupted((engine) => (engine.after.eligible_debt_usd = 5 as unknown as string)),
  ).toEqual(["after.eligible_debt_usd"]);
});

test("p1b-2: an aggregate count outside integrality is named", () => {
  expect(corrupted((engine) => (engine.before.accounts = 1.5))).toEqual(["before.accounts"]);
  expect(corrupted((engine) => (engine.after.eligible_accounts = Number.NaN))).toEqual([
    "after.eligible_accounts",
  ]);
});

test("p1b-2: a histogram scale outside the contract is named per side", () => {
  expect(corrupted((engine) => (engine.before.hf_histogram.wad_scale = ""))).toEqual([
    "before.hf_histogram.wad_scale",
  ]);
});

test("p1b-2: a bucket bound is named PER INDEX", () => {
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[2];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.upper_wad = "0x10";
    }),
  ).toEqual(["before.hf_histogram.buckets[2].upper_wad"]);
});

test("p1b-2: a collateral entry's decimals, amount and value are named per side and index", () => {
  expect(
    corrupted((engine) => {
      const asset = engine.before.collateral_by_asset[0];
      if (!asset) throw new Error("fixture shape: collateral entry missing");
      asset.decimals = -1;
    }),
  ).toEqual(["before.collateral_by_asset[0].decimals"]);
  expect(
    corrupted((engine) => {
      const asset = engine.after.collateral_by_asset[1];
      if (!asset) throw new Error("fixture shape: collateral entry missing");
      asset.amount = " 800";
    }),
  ).toEqual(["after.collateral_by_asset[1].amount"]);
  expect(
    corrupted((engine) => {
      const asset = engine.after.collateral_by_asset[1];
      if (!asset) throw new Error("fixture shape: collateral entry missing");
      asset.value_usd = "";
    }),
  ).toEqual(["after.collateral_by_asset[1].value_usd"]);
});

// ---------------------------------------------------------------------------
// The transition matrix — the controller's explicit unit pins. Task 1's
// review proved `hf_transitions.wad_scale: ""` passes `readTransitions`'
// margin arithmetic untouched and coerces to a "0 entered / 0 exited"
// costume in `belowOneLanes`; the classifier refuses the body FIRST.
// ---------------------------------------------------------------------------

test("p1b-2: hf_transitions.wad_scale has its OWN unit pin — an empty scale is named, never a 0n costume", () => {
  expect(corrupted((engine) => (engine.hf_transitions.wad_scale = ""))).toEqual([
    "hf_transitions.wad_scale",
  ]);
});

test("p1b-2: a lane bound is named PER INDEX", () => {
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[1];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.upper_wad = " 1";
    }),
  ).toEqual(["hf_transitions.lanes[1].upper_wad"]);
});

test("p1b-2: a transition cell's debt is named per outflow and cell index", () => {
  // outflows[3].cells[0] is the fixture's occupied measured cell (3→0).
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.debt_before_usd = "1.0";
    }),
  ).toEqual(["hf_transitions.outflows[3].cells[0].debt_before_usd"]);
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.debt_after_usd = "-";
    }),
  ).toEqual(["hf_transitions.outflows[3].cells[0].debt_after_usd"]);
});

// ---------------------------------------------------------------------------
// Movers — per-index naming is the register's whole value on a capped list.
// ---------------------------------------------------------------------------

test("p1b-2: a mover wad is named PER INDEX — movers[2], never a bare group name", () => {
  expect(
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      // three rows so the index is discriminating: only [2] is corrupted
      engine.movers = [structuredClone(mover), structuredClone(mover), structuredClone(mover)];
      const third = engine.movers[2];
      if (!third) throw new Error("unreachable: just built three movers");
      third.hf_before_wad = "1e5";
    }),
  ).toEqual(["movers[2].hf_before_wad"]);
});

test("p1b-2: a mover's debt_usd is judged under the same nullable law", () => {
  expect(
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      mover.debt_usd = "12.5";
    }),
  ).toEqual(["movers[0].debt_usd"]);
});

// ---------------------------------------------------------------------------
// The two optional subtrees — checked ONLY when served (null is a statement).
// ---------------------------------------------------------------------------

test("p1b-2: a served market_realization is judged whole; a null one is not judged at all", () => {
  // the fixture serves null — pinned clean by the clean-arm test above
  expect(
    corrupted((engine) => (engine.market_realization = legalShortfall())),
  ).toEqual([]);
  expect(
    corrupted((engine) => {
      engine.market_realization = legalShortfall();
      engine.market_realization.bad_debt_at_liquidation_usd = "";
    }),
  ).toEqual(["market_realization.bad_debt_at_liquidation_usd"]);
  expect(
    corrupted((engine) => {
      engine.market_realization = legalShortfall();
      engine.market_realization.usd_decimals = 1001;
    }),
  ).toEqual(["market_realization.usd_decimals"]);
});

test("p1b-2: a served projection's horizon Decimals are named per index; null projection is legal", () => {
  expect(corrupted((engine) => (engine.projection = legalProjection()))).toEqual([]);
  expect(
    corrupted((engine) => {
      engine.projection = legalProjection();
      const horizon = engine.projection.horizons[0];
      if (!horizon) throw new Error("unreachable: just built one horizon");
      horizon.projected_usd = "6.01e11";
    }),
  ).toEqual(["projection.horizons[0].projected_usd"]);
});

// ---------------------------------------------------------------------------
// The folded p0-8/p0-9 four keep their exact names, and the order is the
// wire's read order.
// ---------------------------------------------------------------------------

test("p1b-2: the four p0 fields fold in under their unchanged names", () => {
  expect(corrupted((engine) => (engine.newly_eligible_accounts = 1.5))).toEqual([
    "newly_eligible_accounts",
  ]);
  expect(
    corrupted((engine) => {
      engine.eligible_debt_delta_usd = "";
      engine.bad_debt_delta_usd = "-";
    }),
  ).toEqual(["eligible_debt_delta_usd", "bad_debt_delta_usd"]);
  expect(
    corrupted((engine) => {
      engine.market_realization = legalShortfall();
      engine.market_realization.execution_shortfall_usd = ".";
    }),
  ).toEqual(["market_realization.execution_shortfall_usd"]);
});

// ---------------------------------------------------------------------------
// p1b-9 (Codex round, finding 2) — the COUNTS join the classifier.
//
// The histogram counts (`buckets[].count`, `infinite_count`, `refused_count`)
// and every transition count the reductions consume (`lanes[].index`,
// `outflows[].from`, `cells[].to`/`rows`, the two margins per index, the five
// census totals, the two nullable movement counts, `movers_total`) bypassed
// the p1b-2 gate: the schema types them `number`, but a JSON cast guarantees
// nothing — `count: ""` passed the classifier and coerced to a zero share in
// `belowOneCount`/`measuredCount` (`0 + ""` is `"0"`, a string costume), a
// float or NaN walked into `readTransitions`' margin arithmetic. Each class
// (string-as-never, float, NaN) is pinned by name, per side and per index.
// ---------------------------------------------------------------------------

test("p1b-9: a histogram bucket COUNT outside integrality is named per side and index", () => {
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.count = "" as never;
    }),
  ).toEqual(["before.hf_histogram.buckets[0].count"]);
});

test("p1b-9: the histogram's two side tallies are named per side", () => {
  expect(corrupted((engine) => (engine.after.hf_histogram.infinite_count = 2.5))).toEqual([
    "after.hf_histogram.infinite_count",
  ]);
  expect(
    corrupted((engine) => (engine.before.hf_histogram.refused_count = Number.NaN)),
  ).toEqual(["before.hf_histogram.refused_count"]);
});

test("p1b-9: the matrix's lane, outflow and cell counts are named per index", () => {
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[1];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.index = "" as never;
    }),
  ).toEqual(["hf_transitions.lanes[1].index"]);
  expect(
    corrupted((engine) => {
      const outflow = engine.hf_transitions.outflows[3];
      if (!outflow) throw new Error("fixture shape: outflow missing");
      outflow.from = 2.5;
    }),
  ).toEqual(["hf_transitions.outflows[3].from"]);
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.to = Number.NaN;
    }),
  ).toEqual(["hf_transitions.outflows[3].cells[0].to"]);
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.rows = "" as never;
    }),
  ).toEqual(["hf_transitions.outflows[3].cells[0].rows"]);
});

test("p1b-9: the two margins are named per index — the histograms' own tallies answer to them", () => {
  expect(
    corrupted((engine) => {
      engine.hf_transitions.from_rows[2] = "" as never;
    }),
  ).toEqual(["hf_transitions.from_rows[2]"]);
  expect(
    corrupted((engine) => {
      engine.hf_transitions.to_rows[0] = Number.NaN;
    }),
  ).toEqual(["hf_transitions.to_rows[0]"]);
});

test("p1b-9: the five census totals are named; a null movement count stays a statement", () => {
  expect(corrupted((engine) => (engine.hf_transitions.total_rows = Number.NaN))).toEqual([
    "hf_transitions.total_rows",
  ]);
  expect(
    corrupted((engine) => (engine.hf_transitions.measured_rows = "" as never)),
  ).toEqual(["hf_transitions.measured_rows"]);
  expect(corrupted((engine) => (engine.hf_transitions.unmeasured_rows = 1.5))).toEqual([
    "hf_transitions.unmeasured_rows",
  ]);
  expect(
    corrupted(
      (engine) => (engine.hf_transitions.unmeasured_refused_in_batch_rows = "" as never),
    ),
  ).toEqual(["hf_transitions.unmeasured_refused_in_batch_rows"]);
  expect(
    corrupted(
      (engine) => (engine.hf_transitions.unmeasured_excluded_by_this_layer_rows = 2.5),
    ),
  ).toEqual(["hf_transitions.unmeasured_excluded_by_this_layer_rows"]);
  // The nullable pair: null is the wire's own "not measured" statement and is
  // NEVER malformed; a non-null value must be an integer.
  expect(
    corrupted((engine) => {
      engine.hf_transitions.held_rows = null;
      engine.hf_transitions.lane_changed_rows = null;
    }),
  ).toEqual([]);
  expect(corrupted((engine) => (engine.hf_transitions.held_rows = 1.5))).toEqual([
    "hf_transitions.held_rows",
  ]);
  expect(
    corrupted((engine) => (engine.hf_transitions.lane_changed_rows = "" as never)),
  ).toEqual(["hf_transitions.lane_changed_rows"]);
});

test("p1b-9: movers_total joins the classifier — the disclosure sentence's own denominator", () => {
  expect(corrupted((engine) => (engine.movers_total = "" as never))).toEqual(["movers_total"]);
  expect(corrupted((engine) => (engine.movers_total = 2.5))).toEqual(["movers_total"]);
});

test("p1b-2: fields are named in wire read order across the whole subtree", () => {
  expect(
    corrupted((engine) => {
      engine.usd_decimals = 2.5;
      engine.after.bad_debt_usd = "";
      engine.hf_transitions.wad_scale = "";
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      mover.debt_usd = "x";
    }),
  ).toEqual(["usd_decimals", "after.bad_debt_usd", "hf_transitions.wad_scale", "movers[0].debt_usd"]);
});
