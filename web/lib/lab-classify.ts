// The run-book and set-run classifiers: the envelope that carries a result and
// every field an engine of it carries, checked against the wire contract
// before anything is read from it. A malformed body is refused by the names of
// its fields. The engine classifiers moved verbatim from the old Lab's
// engineClassification.ts and setRunClassification.ts.

import type { LabRunBook, LabRunBookEngine } from "./runbook";
import type { RunBookSetResponse, SetRunEngineSummary, SetRunScenarioResult } from "./runbookSet";
import {
  isWireDecimal,
  isWireOccupancy,
  isWirePopulation,
  isWireScale,
  isWireSignedCount,
  malformedFields,
  type FieldCheck,
} from "./wireGuard";

/** A runtime object gate: the JSON cast guarantees nothing. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The schema's `NullableDecimal`: null is a statement, non-null must parse. */
function isNullableWireDecimal(value: unknown): boolean {
  return value === null || isWireDecimal(value);
}

/**
 * The schema's `number | null` movement counts (`held_rows`,
 * `lane_changed_rows`): null is the wire's own "not measured" statement and
 * is NEVER malformed; a non-null value is a POPULATION — a diagonal or
 * off-diagonal tally of MEASURED rows, a nonnegative safe integer by the
 * schema's own semantics (the assignment table in wireGuard.ts).
 */
function isNullableWirePopulation(value: unknown): boolean {
  return value === null || isWirePopulation(value);
}

/**
 * One aggregate side (`RunBookAggregate`): the two counts, the five Decimals,
 * the histogram's scale, per-index bucket bounds AND COUNTS, the two side
 * tallies, and the per-index collateral decomposition. `buckets[].upper_wad`
 * is nullable (the open-ended top bucket); `collateral_by_asset[].value_usd`
 * is nullable (an unpriced balance's worth is unknowable, not zero).
 *
 * The histogram COUNTS are walked too: the schema types them `number`, but
 * the JSON cast guarantees nothing, and an unjudged `count: ""` coerces in
 * arithmetic into a zero-share costume (`0 + ""` is `"0"`). Every count a
 * reduction consumes is judged per side and per index by `isWirePopulation`:
 * these are all tallies of rows and accounts that exist — nonnegative safe
 * integers, per the assignment table in wireGuard.ts.
 */
function aggregateChecks(side: "before" | "after", aggregate: unknown): FieldCheck[] {
  if (!isRecord(aggregate)) return [[side, false]];
  const checks: FieldCheck[] = [
    [`${side}.accounts`, isWirePopulation(aggregate.accounts)],
    [`${side}.eligible_accounts`, isWirePopulation(aggregate.eligible_accounts)],
    [`${side}.total_collateral_usd`, isWireDecimal(aggregate.total_collateral_usd)],
    [`${side}.total_debt_usd`, isWireDecimal(aggregate.total_debt_usd)],
    [`${side}.eligible_debt_usd`, isWireDecimal(aggregate.eligible_debt_usd)],
    [`${side}.collateral_at_risk_usd`, isWireDecimal(aggregate.collateral_at_risk_usd)],
    [`${side}.bad_debt_usd`, isWireDecimal(aggregate.bad_debt_usd)],
  ];
  const histogram = aggregate.hf_histogram;
  if (!isRecord(histogram)) {
    checks.push([`${side}.hf_histogram`, false]);
  } else {
    checks.push([`${side}.hf_histogram.wad_scale`, isWireDecimal(histogram.wad_scale)]);
    const buckets = histogram.buckets;
    if (!Array.isArray(buckets)) {
      checks.push([`${side}.hf_histogram.buckets`, false]);
    } else {
      buckets.forEach((bucket: unknown, index) => {
        const at = `${side}.hf_histogram.buckets[${String(index)}]`;
        if (!isRecord(bucket)) {
          checks.push([at, false]);
          return;
        }
        checks.push([`${at}.upper_wad`, isNullableWireDecimal(bucket.upper_wad)]);
        checks.push([`${at}.count`, isWirePopulation(bucket.count)]);
      });
    }
    checks.push([`${side}.hf_histogram.infinite_count`, isWirePopulation(histogram.infinite_count)]);
    checks.push([`${side}.hf_histogram.refused_count`, isWirePopulation(histogram.refused_count)]);
  }
  const assets = aggregate.collateral_by_asset;
  if (!Array.isArray(assets)) {
    checks.push([`${side}.collateral_by_asset`, false]);
  } else {
    assets.forEach((asset: unknown, index) => {
      const at = `${side}.collateral_by_asset[${String(index)}]`;
      if (!isRecord(asset)) {
        checks.push([at, false]);
        return;
      }
      checks.push([`${at}.decimals`, isWireScale(asset.decimals)]);
      checks.push([`${at}.amount`, isWireDecimal(asset.amount)]);
      checks.push([`${at}.value_usd`, isNullableWireDecimal(asset.value_usd)]);
    });
  }
  return checks;
}

/**
 * The transition matrix (`RunBookTransitions`): its OWN `wad_scale` — a
 * field which, unjudged, coerces into a "0 entered / 0 exited" costume — the
 * per-index lane bounds, and every occupied cell's two nullable debts.
 *
 * AND EVERY COUNT the lane reading and the region reductions consume: a
 * reconciliation over unvalidated values is arithmetic over coercions
 * (`0 + ""` is `"0"`, NaN comparisons are silently false), and a body that
 * failed the wire contract deserves the MALFORMED register, not a
 * contradiction sentence derived from garbage. Judged in wire read order:
 * `lanes[].index`, `outflows[].from`, `cells[].to`/`rows`, the two margins
 * per index, the five census totals, and the two NULLABLE movement counts
 * (null is a statement).
 */
function transitionChecks(transitions: unknown): FieldCheck[] {
  if (!isRecord(transitions)) return [["hf_transitions", false]];
  const checks: FieldCheck[] = [
    ["hf_transitions.wad_scale", isWireDecimal(transitions.wad_scale)],
  ];
  const lanes = transitions.lanes;
  if (!Array.isArray(lanes)) {
    checks.push(["hf_transitions.lanes", false]);
  } else {
    lanes.forEach((lane: unknown, index) => {
      const at = `hf_transitions.lanes[${String(index)}]`;
      if (!isRecord(lane)) {
        checks.push([at, false]);
        return;
      }
      checks.push([`${at}.index`, isWirePopulation(lane.index)]);
      checks.push([`${at}.upper_wad`, isNullableWireDecimal(lane.upper_wad)]);
    });
  }
  const outflows = transitions.outflows;
  if (!Array.isArray(outflows)) {
    checks.push(["hf_transitions.outflows", false]);
  } else {
    outflows.forEach((outflow: unknown, from) => {
      if (!isRecord(outflow)) {
        checks.push([`hf_transitions.outflows[${String(from)}]`, false]);
        return;
      }
      checks.push([`hf_transitions.outflows[${String(from)}].from`, isWirePopulation(outflow.from)]);
      const cells = outflow.cells;
      if (!Array.isArray(cells)) {
        checks.push([`hf_transitions.outflows[${String(from)}].cells`, false]);
        return;
      }
      cells.forEach((cell: unknown, index) => {
        const at = `hf_transitions.outflows[${String(from)}].cells[${String(index)}]`;
        if (!isRecord(cell)) {
          checks.push([at, false]);
          return;
        }
        checks.push([`${at}.to`, isWirePopulation(cell.to)]);
        // `rows` is the schema's `minimum: 1` — "A cell is emitted only when
        // it holds at least one row"; an empty cell is
        // ABSENT, never a row of zeros. A fake zero-row cell reconciles
        // EVERY margin and census sum (0 changes nothing), so this floor is
        // the only gate that refuses it.
        checks.push([`${at}.rows`, isWireOccupancy(cell.rows)]);
        checks.push([`${at}.debt_before_usd`, isNullableWireDecimal(cell.debt_before_usd)]);
        checks.push([`${at}.debt_after_usd`, isNullableWireDecimal(cell.debt_after_usd)]);
      });
    });
  }
  // THE TWO MARGINS, per index — `from_rows[i]`/`to_rows[i]` are the numbers
  // the histogram tallies answer to and the region reductions subtract.
  for (const margin of ["from_rows", "to_rows"] as const) {
    const values = transitions[margin];
    if (!Array.isArray(values)) {
      checks.push([`hf_transitions.${margin}`, false]);
    } else {
      values.forEach((value: unknown, index) => {
        checks.push([`hf_transitions.${margin}[${String(index)}]`, isWirePopulation(value)]);
      });
    }
  }
  // THE CENSUS TOTALS, then the two nullable movement counts.
  checks.push(["hf_transitions.total_rows", isWirePopulation(transitions.total_rows)]);
  checks.push(["hf_transitions.measured_rows", isWirePopulation(transitions.measured_rows)]);
  checks.push(["hf_transitions.unmeasured_rows", isWirePopulation(transitions.unmeasured_rows)]);
  checks.push([
    "hf_transitions.unmeasured_refused_in_batch_rows",
    isWirePopulation(transitions.unmeasured_refused_in_batch_rows),
  ]);
  checks.push([
    "hf_transitions.unmeasured_excluded_by_this_layer_rows",
    isWirePopulation(transitions.unmeasured_excluded_by_this_layer_rows),
  ]);
  checks.push(["hf_transitions.held_rows", isNullableWirePopulation(transitions.held_rows)]);
  checks.push([
    "hf_transitions.lane_changed_rows",
    isNullableWirePopulation(transitions.lane_changed_rows),
  ]);
  return checks;
}

/**
 * CLASSIFY THE WHOLE ENGINE SUBTREE, in wire read order. Empty list =
 * renderable; a non-empty list is the malformed register's content, per
 * index. `readEngine` in lab-engine delegates here (one law, one function),
 * so the workspace, the library row and the drawer all refuse on the SAME
 * classification.
 */
export function classifyRunBookEngine(engine: LabRunBookEngine): { malformedFields: string[] } {
  const e = engine as unknown as Record<string, unknown>;
  const checks: FieldCheck[] = [];

  checks.push(["usd_decimals", isWireScale(e.usd_decimals)]);
  checks.push(...aggregateChecks("before", e.before));
  checks.push(...aggregateChecks("after", e.after));
  checks.push(...transitionChecks(e.hf_transitions));
  // The schema's own SIGNED net ("a NET count that also subtracts any flip
  // back to healthy") — a negative value is an ANSWER, never malformed.
  checks.push(["newly_eligible_accounts", isWireSignedCount(e.newly_eligible_accounts)]);
  checks.push(["eligible_debt_delta_usd", isWireDecimal(e.eligible_debt_delta_usd)]);
  checks.push(["bad_debt_delta_usd", isWireDecimal(e.bad_debt_delta_usd)]);

  const movers = e.movers;
  if (!Array.isArray(movers)) {
    checks.push(["movers", false]);
  } else {
    movers.forEach((mover: unknown, index) => {
      if (!isRecord(mover)) {
        checks.push([`movers[${String(index)}]`, false]);
        return;
      }
      // The four mover fields the detail subtree feeds into BigInt or the
      // money renderers. All four are the schema's NullableDecimal — the
      // Aave and Debt Manager arms differ in WHICH are null, and a null on
      // either engine is that engine's own statement, never malformed.
      for (const field of ["hf_before_wad", "hf_after_wad", "hf_drop_wad", "debt_usd"] as const) {
        checks.push([`movers[${String(index)}].${field}`, isNullableWireDecimal(mover[field])]);
      }
    });
  }
  // The FULL mover count — the movers caption's own denominator ("showing 20
  // of N"). Unjudged, a malformed total renders "NaN are not on this page" as
  // a computed-looking clause.
  checks.push(["movers_total", isWirePopulation(e.movers_total)]);

  const realization = e.market_realization;
  if (realization !== null) {
    if (!isRecord(realization)) {
      checks.push(["market_realization", false]);
    } else {
      checks.push([
        "market_realization.execution_shortfall_usd",
        isWireDecimal(realization.execution_shortfall_usd),
      ]);
      checks.push([
        "market_realization.bad_debt_at_liquidation_usd",
        isWireDecimal(realization.bad_debt_at_liquidation_usd),
      ]);
      checks.push(["market_realization.usd_decimals", isWireScale(realization.usd_decimals)]);
    }
  }

  const projection = e.projection;
  if (projection !== null) {
    if (!isRecord(projection)) {
      checks.push(["projection", false]);
    } else {
      const horizons = projection.horizons;
      if (!Array.isArray(horizons)) {
        checks.push(["projection.horizons", false]);
      } else {
        horizons.forEach((horizon: unknown, index) => {
          const at = `projection.horizons[${String(index)}]`;
          if (!isRecord(horizon)) {
            checks.push([at, false]);
            return;
          }
          checks.push([`${at}.debt_usd`, isWireDecimal(horizon.debt_usd)]);
          checks.push([`${at}.projected_usd`, isWireDecimal(horizon.projected_usd)]);
          checks.push([
            `${at}.additional_interest_usd`,
            isWireDecimal(horizon.additional_interest_usd),
          ]);
        });
      }
    }
  }

  return { malformedFields: malformedFields(checks) };
}

/**
 * CLASSIFY ONE ENGINE ROW, in wire read order. Empty list = renderable; a
 * non-empty list is the malformed register's content. `compareRows` in
 * lab-compare composes this per answered engine and names each failure
 * `engines[i].<field>` — one law, one function, so every surface that reads
 * a set result refuses on the SAME classification.
 */
export function classifySetRunEngine(engine: SetRunEngineSummary): { malformedFields: string[] } {
  const e = engine as unknown as Record<string, unknown>;
  const checks: FieldCheck[] = [
    ["usd_decimals", isWireScale(e.usd_decimals)],
    ["accounts", isWirePopulation(e.accounts)],
    ["movement_excluded_accounts", isWirePopulation(e.movement_excluded_accounts)],
    ["flipped_to_eligible", isNullableWirePopulation(e.flipped_to_eligible)],
    ["hf_dropped_accounts", isNullableWirePopulation(e.hf_dropped_accounts)],
    ["eligible_debt_delta_usd", isWireDecimal(e.eligible_debt_delta_usd)],
    ["total_debt_usd_before", isWireDecimal(e.total_debt_usd_before)],
  ];

  const realization = e.market_realization;
  if (realization !== null) {
    if (!isRecord(realization)) {
      checks.push(["market_realization", false]);
    } else {
      checks.push([
        "market_realization.execution_shortfall_usd",
        isWireDecimal(realization.execution_shortfall_usd),
      ]);
      checks.push([
        "market_realization.bad_debt_at_liquidation_usd",
        isWireDecimal(realization.bad_debt_at_liquidation_usd),
      ]);
      checks.push(["market_realization.usd_decimals", isWireScale(realization.usd_decimals)]);
    }
  }

  const projection = e.projection;
  if (projection !== null) {
    if (!isRecord(projection)) {
      checks.push(["projection", false]);
    } else {
      const horizons = projection.horizons;
      if (!Array.isArray(horizons)) {
        checks.push(["projection.horizons", false]);
      } else {
        horizons.forEach((horizon: unknown, index) => {
          const at = `projection.horizons[${String(index)}]`;
          if (!isRecord(horizon)) {
            checks.push([at, false]);
            return;
          }
          checks.push([`${at}.debt_usd`, isWireDecimal(horizon.debt_usd)]);
          checks.push([`${at}.projected_usd`, isWireDecimal(horizon.projected_usd)]);
          checks.push([
            `${at}.additional_interest_usd`,
            isWireDecimal(horizon.additional_interest_usd),
          ]);
        });
      }
    }
  }

  return { malformedFields: malformedFields(checks) };
}


/**
 * A list member of an envelope: not a list, it is named by the field; a list, each element the contract does not
 * admit is named per index. A list that is not one is never dereferenced, and an element that is not what the list
 * holds is never read as one.
 */
function listChecks(field: string, value: unknown, admits: (element: unknown) => boolean): FieldCheck[] {
  if (!Array.isArray(value)) return [[field, false]];
  return value.map((element: unknown, index): FieldCheck => [`${field}[${String(index)}]`, admits(element)]);
}

const isString = (value: unknown): boolean => typeof value === "string";
/** An object member or element of an envelope: a JSON object, never a list standing where one belongs. */
const isObject = (value: unknown): value is Record<string, unknown> => isRecord(value) && !Array.isArray(value);

/** The schema's `number | null` batch id (`newest_servable_batch_id`): null is the wire's own "none was servable". */
function isNullableBatchId(value: unknown): boolean {
  return value === null || isWirePopulation(value);
}

/**
 * The envelope's `batch`, as far as the page reads it: the id every figure is shown for, and — where the page anchors
 * an age or states a supersession on it — the age and the supersession's own boolean.
 */
function batchChecks(batch: unknown, reads: { readonly age: boolean; readonly supersession: boolean }): FieldCheck[] {
  if (!isObject(batch)) return [["batch", false]];
  const checks: FieldCheck[] = [["batch.id", isWirePopulation(batch.id)]];
  if (reads.age) checks.push(["batch.age_seconds", isWirePopulation(batch.age_seconds)]);
  if (reads.supersession) {
    const supersession = batch.supersession;
    if (!isObject(supersession)) checks.push(["batch.supersession", false]);
    else checks.push(["batch.supersession.superseded", typeof supersession.superseded === "boolean"]);
  }
  return checks;
}

/**
 * CLASSIFY THE RUN-BOOK ENVELOPE, in wire read order, before anything is read from the body. Empty list = the
 * envelope is inside the contract; a non-empty list names every fault: an object member (`batch`, `coverage`) that is
 * missing or not an object, the batch fields the page reads, every list that is not a list, and every element that
 * is not what its list holds. A version-skewed 2xx is a refusal by the field's name, never a throw at render. The
 * engine rows themselves are `classifyRunBookEngine`'s; this is the law of what carries them.
 */
export function classifyRunBookEnvelope(run: LabRunBook): string[] {
  const r = run as unknown as Record<string, unknown>;
  return malformedFields([
    ...batchChecks(r.batch, { age: true, supersession: true }),
    ...listChecks("shocks", r.shocks, isObject),
    ...listChecks("out_of_model", r.out_of_model, isString),
    ...listChecks("applied_shocks", r.applied_shocks, isObject),
    ...listChecks("held_flat", r.held_flat, isObject),
    ...listChecks("engines", r.engines, isObject),
    ...listChecks("excluded_engines", r.excluded_engines, isObject),
    ["coverage", isObject(r.coverage)],
    ...listChecks("notes", r.notes, isString),
  ]);
}

const SET_FRESHNESS: ReadonlySet<unknown> = new Set(["still_newest", "superseded", "newest_is_older", "none_servable"]);

/**
 * CLASSIFY THE SET ENVELOPE, in wire read order, before anything is read from the body: `batch`, `evaluation` and
 * `coverage` as objects, the evaluation's own fields the comparison prints, every list, and each result an object.
 * A result's own engine lists are `classifySetResult`'s — a result that breaks them is one refused row, never the
 * refusal of the rows beside it.
 */
export function classifySetEnvelope(set: RunBookSetResponse): string[] {
  const s = set as unknown as Record<string, unknown>;
  const evaluation = s.evaluation;
  return malformedFields([
    ...batchChecks(s.batch, { age: false, supersession: false }),
    ...(isObject(evaluation)
      ? ([
          ["evaluation.scenarios_evaluated", isWirePopulation(evaluation.scenarios_evaluated)],
          ["evaluation.freshness", SET_FRESHNESS.has(evaluation.freshness)],
          ["evaluation.newest_servable_batch_id", isNullableBatchId(evaluation.newest_servable_batch_id)],
        ] satisfies FieldCheck[])
      : ([["evaluation", false]] satisfies FieldCheck[])),
    ...listChecks("requested_scenario_ids", s.requested_scenario_ids, isString),
    ...listChecks("results", s.results, isObject),
    ...listChecks("excluded_engines", s.excluded_engines, isObject),
    ["coverage", isObject(s.coverage)],
    ...listChecks("notes", s.notes, isString),
  ]);
}

/**
 * CLASSIFY ONE SET RESULT'S ENGINE LISTS, in wire read order: the coverage and the three parts that partition it.
 * Each that is not a list is named, and each element that is not what its list holds — before the census reads an
 * id from any of them.
 */
export function classifySetResult(result: SetRunScenarioResult): string[] {
  const r = result as unknown as Record<string, unknown>;
  return malformedFields([
    ...listChecks("covered_engines", r.covered_engines, isString),
    ...listChecks("withheld_engines", r.withheld_engines, isString),
    ...listChecks("unmeasurable_engines", r.unmeasurable_engines, isObject),
    ...listChecks("engines", r.engines, isObject),
  ]);
}
