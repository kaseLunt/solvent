// THE FULL RunBookEngine SUBTREE CLASSIFIER. Every numeric wire field the
// run-book detail consumes is judged before it is read: an unjudged field
// feeds a THROWING renderer (the route boundary takes the page) or a
// silently-permissive `BigInt` coercion (a malformed body wearing a
// measured-zero costume). `classifyRunBookEngine` is exhaustive over that
// inventory, one law one function, with array fields named PER INDEX —
// `movers[2].hf_before_wad`, never a bare group name.
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
import { classifyRunBookEngine } from "../../lib/lab-classify";
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

test("both committed engines classify CLEAN — the law does not refuse the served book", () => {
  expect(classifyRunBookEngine(engineOf("aave_v3_etherfi")).malformedFields).toEqual([]);
  expect(classifyRunBookEngine(engineOf("debt_manager")).malformedFields).toEqual([]);
});

test("schema-legal nulls are statements, never malformed", () => {
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

test("a fractional usd_decimals is named — the scale the money renderers exponentiate", () => {
  expect(corrupted((engine) => (engine.usd_decimals = 2.5))).toEqual(["usd_decimals"]);
});

test("an aggregate Decimal outside the contract is named by side and field", () => {
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

test("an aggregate count outside integrality is named", () => {
  expect(corrupted((engine) => (engine.before.accounts = 1.5))).toEqual(["before.accounts"]);
  expect(corrupted((engine) => (engine.after.eligible_accounts = Number.NaN))).toEqual([
    "after.eligible_accounts",
  ]);
});

test("a histogram scale outside the contract is named per side", () => {
  expect(corrupted((engine) => (engine.before.hf_histogram.wad_scale = ""))).toEqual([
    "before.hf_histogram.wad_scale",
  ]);
});

test("a bucket bound is named PER INDEX", () => {
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[2];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.upper_wad = "0x10";
    }),
  ).toEqual(["before.hf_histogram.buckets[2].upper_wad"]);
});

test("a collateral entry's decimals, amount and value are named per side and index", () => {
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
// The transition matrix. An unjudged `hf_transitions.wad_scale: ""` passes
// `readTransitions`' margin arithmetic untouched and coerces to a "0 entered /
// 0 exited" costume in `belowOneLanes`; the classifier refuses the body FIRST.
// ---------------------------------------------------------------------------

test("hf_transitions.wad_scale has its OWN unit pin — an empty scale is named, never a 0n costume", () => {
  expect(corrupted((engine) => (engine.hf_transitions.wad_scale = ""))).toEqual([
    "hf_transitions.wad_scale",
  ]);
});

test("a lane bound is named PER INDEX", () => {
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[1];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.upper_wad = " 1";
    }),
  ).toEqual(["hf_transitions.lanes[1].upper_wad"]);
});

test("a transition cell's debt is named per outflow and cell index", () => {
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

test("a mover wad is named PER INDEX — movers[2], never a bare group name", () => {
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

test("a mover's debt_usd is judged under the same nullable law", () => {
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

test("a served market_realization is judged whole; a null one is not judged at all", () => {
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

test("a served projection's horizon Decimals are named per index; null projection is legal", () => {
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
// The four top-level fields keep their exact wire names, and the order is the
// wire's read order.
// ---------------------------------------------------------------------------

test("the four p0 fields fold in under their unchanged names", () => {
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
// The COUNTS are judged like the decimals.
//
// The histogram counts (`buckets[].count`, `infinite_count`, `refused_count`)
// and every transition count the reductions consume (`lanes[].index`,
// `outflows[].from`, `cells[].to`/`rows`, the two margins per index, the five
// census totals, the two nullable movement counts, `movers_total`): the schema
// types them `number`, but a JSON cast guarantees nothing — an unjudged
// `count: ""` coerces to a zero share in `belowOneCount`/`measuredCount`
// (`0 + ""` is `"0"`, a string costume), and a float or NaN walks into
// `readTransitions`' margin arithmetic. Each class (string-as-never, float,
// NaN) is pinned by name, per side and per index.
// ---------------------------------------------------------------------------

test("a histogram bucket COUNT outside integrality is named per side and index", () => {
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.count = "" as never;
    }),
  ).toEqual(["before.hf_histogram.buckets[0].count"]);
});

test("the histogram's two side tallies are named per side", () => {
  expect(corrupted((engine) => (engine.after.hf_histogram.infinite_count = 2.5))).toEqual([
    "after.hf_histogram.infinite_count",
  ]);
  expect(
    corrupted((engine) => (engine.before.hf_histogram.refused_count = Number.NaN)),
  ).toEqual(["before.hf_histogram.refused_count"]);
});

test("the matrix's lane, outflow and cell counts are named per index", () => {
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

test("the two margins are named per index — the histograms' own tallies answer to them", () => {
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

test("the five census totals are named; a null movement count stays a statement", () => {
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

test("movers_total joins the classifier — the disclosure sentence's own denominator", () => {
  expect(corrupted((engine) => (engine.movers_total = "" as never))).toEqual(["movers_total"]);
  expect(corrupted((engine) => (engine.movers_total = 2.5))).toEqual(["movers_total"]);
});

// ---------------------------------------------------------------------------
// The counts are classified by their SCHEMA SEMANTICS. Number.isInteger alone
// admits NEGATIVE populations (a bucket count of -1; movers_total -1 →
// "Showing all -1 accounts" as a computed clause) and UNSAFE integers (JSON
// parses 9007199254740992.5 into 2^53, and exact arithmetic over the rounded
// value renders a computed-looking wrong answer). Populations — tallies of
// rows/accounts that exist, and the lane indices — are nonnegative SAFE
// integers; `newly_eligible_accounts` is the schema's own SIGNED net ("a NET
// count that also subtracts any flip back to healthy") and keeps its sign.
// ---------------------------------------------------------------------------

test("a NEGATIVE population is named — a tally of things that exist cannot be -1", () => {
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.count = -1;
    }),
  ).toEqual(["before.hf_histogram.buckets[0].count"]);
  // movers_total -1 is the disclosure sentence's "-1 are not on this page".
  expect(corrupted((engine) => (engine.movers_total = -1))).toEqual(["movers_total"]);
  expect(corrupted((engine) => (engine.hf_transitions.measured_rows = -2))).toEqual([
    "hf_transitions.measured_rows",
  ]);
});

test("an UNSAFE integer population is named — 2^53 is JSON's rounding, not a measurement", () => {
  expect(corrupted((engine) => (engine.hf_transitions.total_rows = 9007199254740992))).toEqual([
    "hf_transitions.total_rows",
  ]);
  expect(
    corrupted((engine) => (engine.after.hf_histogram.infinite_count = 9007199254740992)),
  ).toEqual(["after.hf_histogram.infinite_count"]);
});

test("newly_eligible_accounts is the schema's SIGNED net — negative stays legal, unsafe does not", () => {
  // "a NET count that also subtracts any flip back to healthy" — a scenario
  // that flips accounts back to healthy nets negative, and that is an ANSWER.
  expect(corrupted((engine) => (engine.newly_eligible_accounts = -3))).toEqual([]);
  expect(
    corrupted((engine) => (engine.newly_eligible_accounts = -9007199254740992)),
  ).toEqual(["newly_eligible_accounts"]);
});

// ---------------------------------------------------------------------------
// Negative zero and the schema's occupancy floor.
//
// The guards judge the PARSED binary64, and JSON.parse("-1e-324") rounds to
// -0 — which is === 0 and passes `>= 0`, so without the sign check a fractional
// token wears a legal population. And `RunBookTransitionCell.rows` is the schema's
// `minimum: 1` ("A cell is emitted only when it holds at least one row"; an
// empty cell is ABSENT, never a row of zeros), and a fake `{rows: 0}` cell
// reconciles EVERY margin and census sum — 0 changes nothing — so the
// classifier's occupancy floor is the only gate that can refuse it.
// ---------------------------------------------------------------------------

test("a NEGATIVE-ZERO population is named — -1e-324 parses to -0, and -0 passed >= 0", () => {
  expect(corrupted((engine) => (engine.movers_total = -0))).toEqual(["movers_total"]);
  expect(
    corrupted((engine) => {
      const bucket = engine.before.hf_histogram.buckets[0];
      if (!bucket) throw new Error("fixture shape: bucket missing");
      bucket.count = -0;
    }),
  ).toEqual(["before.hf_histogram.buckets[0].count"]);
});

test("a ZERO-ROW occupied cell is named per index — the schema floors rows at 1", () => {
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.rows = 0;
    }),
  ).toEqual(["hf_transitions.outflows[3].cells[0].rows"]);
  // rows: 1 — the fixture's own value, re-stated — stays legal: the floor is
  // exactly the schema's, not a wider refusal.
  expect(
    corrupted((engine) => {
      const cell = engine.hf_transitions.outflows[3]?.cells[0];
      if (!cell) throw new Error("fixture shape: occupied cell missing");
      cell.rows = 1;
    }),
  ).toEqual([]);
});

test("fields are named in wire read order across the whole subtree", () => {
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

/** A value standing where a required string belongs: absent, null, a number, an object, a list. */
const NOT_TEXT: readonly unknown[] = [undefined, null, 7, { text: "0x" }, ["0x"]];
const set = (target: object, member: string, value: unknown): void => {
  if (value === undefined) delete (target as Record<string, unknown>)[member];
  else (target as Record<string, unknown>)[member] = value;
};

test("a mover names the account its row links to: an account that is not a string is named per index, before the row's decimals — the address is never truncated off a null", () => {
  for (const value of NOT_TEXT) {
    expect(
      corrupted((engine) => {
        const mover = engine.movers[0];
        if (!mover) throw new Error("fixture shape: mover missing");
        // A served mover stands before it: the fault is named at its own index.
        engine.movers = [structuredClone(mover), mover];
        set(mover, "account", value);
      }),
    ).toEqual(["movers[1].account"]);
  }
  // Wire read order inside the mover: the account, then its decimals.
  expect(
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      set(mover, "account", null);
      mover.debt_usd = "x";
    }),
  ).toEqual(["movers[0].account", "movers[0].debt_usd"]);
});

test("the two notes the drawer prints verbatim are text: the engine's `note` and `hf_transitions.note` are named when they are not strings; an empty note is the wire's own and stays", () => {
  for (const value of NOT_TEXT) {
    expect(corrupted((engine) => set(engine, "note", value))).toEqual(["note"]);
    expect(corrupted((engine) => set(engine.hf_transitions, "note", value))).toEqual(["hf_transitions.note"]);
  }
  expect(corrupted((engine) => set(engine, "note", ""))).toEqual([]);
  expect(corrupted((engine) => set(engine.hf_transitions, "note", ""))).toEqual([]);
  // Wire read order: the matrix's note closes the matrix, the engine's note closes the engine.
  expect(
    corrupted((engine) => {
      set(engine.hf_transitions, "note", null);
      engine.movers_total = -1;
      set(engine, "note", 3);
    }),
  ).toEqual(["hf_transitions.note", "movers_total", "note"]);
});

test("a lane's label is text before it is a header cell: `hf_transitions.lanes[i].label` is named per index when it is not a string, after the lane's index and before its bound; an empty label is the wire's own and stays", () => {
  for (const value of NOT_TEXT) {
    expect(
      corrupted((engine) => {
        const lane = engine.hf_transitions.lanes[1];
        if (!lane) throw new Error("fixture shape: lane missing");
        set(lane, "label", value);
      }),
    ).toEqual(["hf_transitions.lanes[1].label"]);
  }
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[0];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.label = "";
    }),
  ).toEqual([]);
  // Wire read order inside the lane: index, label, upper bound.
  expect(
    corrupted((engine) => {
      const lane = engine.hf_transitions.lanes[0];
      if (!lane) throw new Error("fixture shape: lane missing");
      lane.index = -1;
      set(lane, "label", { text: "below 1.00" });
      lane.upper_wad = "1e18";
    }),
  ).toEqual(["hf_transitions.lanes[0].index", "hf_transitions.lanes[0].label", "hf_transitions.lanes[0].upper_wad"]);
});

test("a mover's flip is a boolean or the wire's own null: an ABSENT `became_eligible` is named and is never the word No, a string is named and is never the word Yes; null is a statement and stays", () => {
  const withFlip = (value: unknown): string[] =>
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      set(mover, "became_eligible", value);
    });
  for (const value of [undefined, "false", "true", 0, 1, {}, []]) expect(withFlip(value)).toEqual(["movers[0].became_eligible"]);
  for (const value of [true, false, null]) expect(withFlip(value)).toEqual([]);
  // Wire read order inside the mover: the account, the ratio's decimals, the flip, the debt it is ranked by.
  expect(
    corrupted((engine) => {
      const mover = engine.movers[0];
      if (!mover) throw new Error("fixture shape: mover missing");
      set(mover, "account", null);
      mover.hf_drop_wad = "x";
      set(mover, "became_eligible", "false");
      mover.debt_usd = "x";
    }),
  ).toEqual(["movers[0].account", "movers[0].hf_drop_wad", "movers[0].became_eligible", "movers[0].debt_usd"]);
});

test("the movers' note is text like the two notes beside it: `movers_note` is named when it is not a string — an object never reaches a tooltip as [object Object]; an empty note is the wire's own and stays", () => {
  for (const value of NOT_TEXT) expect(corrupted((engine) => set(engine, "movers_note", value))).toEqual(["movers_note"]);
  expect(corrupted((engine) => set(engine, "movers_note", ""))).toEqual([]);
  // Wire read order: the movers, their total, their note.
  expect(
    corrupted((engine) => {
      engine.movers_total = -1;
      set(engine, "movers_note", 3);
      set(engine, "note", 3);
    }),
  ).toEqual(["movers_total", "movers_note", "note"]);
});

test("a horizon is sealed by the client, never by the wire: a horizon still carrying the wire's `becomes_liquidatable` was never sealed, and a stray wire member named `liquidation_verdict` beside it does not make it one", () => {
  const withHorizon = (edit: (horizon: Record<string, unknown>) => void): string[] =>
    corrupted((engine) => {
      engine.projection = legalProjection();
      const horizon = engine.projection.horizons[0];
      if (!horizon) throw new Error("unreachable: just built one horizon");
      edit(horizon as unknown as Record<string, unknown>);
    });
  // Unsealed — the wire's verdict was outside true / false / null — and carrying the sealed field's name as a stray member.
  expect(withHorizon((h) => (h.becomes_liquidatable = "yes"))).toEqual(["projection.horizons[0].becomes_liquidatable"]);
  // The stray member alone is no seal either, whatever the wire's own verdict says.
  for (const wire of [true, false, null]) expect(withHorizon((h) => (h.becomes_liquidatable = wire))).toEqual(["projection.horizons[0].becomes_liquidatable"]);
  // Neither field: never sealed.
  expect(withHorizon((h) => delete h.liquidation_verdict)).toEqual(["projection.horizons[0].becomes_liquidatable"]);
  // Sealed: the verdict alone, the wire's field gone.
  expect(withHorizon(() => {})).toEqual([]);
});
