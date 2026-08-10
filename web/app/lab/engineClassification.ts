// THE FULL RunBookEngine SUBTREE CLASSIFIER (p1b-2, closes Codex r3
// finding 1).
//
// The p0-9 gate (`cellPrimaryOutcome`'s malformed arm) validated 4 of the
// ~40+ numeric wire fields the run-book detail subtree consumes. Every other
// field fed one of two dishonest paths on a malformed or version-skewed body:
//
//   - a THROWING renderer (`renderUsdAmount`/`labUsd`/`BigInt(...)` in the
//     detail panels), where the route boundary replaced the whole view; or
//   - a silently-PERMISSIVE coercion (`BigInt("")` → 0n in `belowOneLanes`,
//     where an empty `hf_transitions.wad_scale` wore a "0 entered / 0 exited"
//     costume — a wrong answer that looks computed).
//
// `classifyRunBookEngine` is exhaustive over that inventory: ONE law, ONE
// function, consulted by the matrix cell, the engine panel and the parent
// summary through `cellPrimaryOutcome`. Array fields are named PER INDEX
// (`movers[2].hf_before_wad`, `before.hf_histogram.buckets[0].upper_wad`) —
// on a capped, ranked list a bare group name is not an address.
//
// NULLABILITY MIRRORS THE GENERATED SCHEMA EXACTLY
// (`packages/client-ts/src/generated/schema.ts`, RunBookEngine and its
// parts): a `NullableDecimal` is judged only when non-null, because a
// schema-legal null is a STATEMENT — unbounded, unmeasured, unpriced, or
// not-this-engine's-vocabulary — and never malformed. `market_realization`
// and `projection` are judged only when served.
//
// THE WALKER NEVER THROWS. Bodies are JSON-cast without runtime validation,
// so a subtree may be missing or mis-shaped entirely; a classifier that
// threw on the bodies it exists to refuse would reopen the route-boundary
// hole it closes. A missing/mis-shaped required subtree is named as its own
// malformed field.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { LabRunBookEngine } from "../../lib/runbook";
import {
  isWireCount,
  isWireDecimal,
  isWireScale,
  malformedFields,
  type FieldCheck,
} from "../../lib/wireGuard";

/** A runtime object gate: the JSON cast guarantees nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The schema's `NullableDecimal`: null is a statement, non-null must parse. */
function isNullableWireDecimal(value: unknown): boolean {
  return value === null || isWireDecimal(value);
}

/**
 * The schema's `number | null` movement counts (`held_rows`,
 * `lane_changed_rows`): null is the wire's own "not measured" statement and
 * is NEVER malformed; a non-null value must be an integer (p1b-9, finding 2).
 */
function isNullableWireCount(value: unknown): boolean {
  return value === null || isWireCount(value);
}

/**
 * One aggregate side (`RunBookAggregate`): the two counts, the five Decimals,
 * the histogram's scale, per-index bucket bounds AND COUNTS, the two side
 * tallies, and the per-index collateral decomposition. `buckets[].upper_wad`
 * is nullable (the open-ended top bucket); `collateral_by_asset[].value_usd`
 * is nullable (an unpriced balance's worth is unknowable, not zero).
 *
 * p1b-9 (Codex round, finding 2): the histogram COUNTS used to bypass this
 * walk entirely — the schema types them `number`, but the JSON cast
 * guarantees nothing, and `count: ""` passed the gate to coerce into a
 * zero-share costume in `belowOneCount`/`measuredCount` (`0 + ""` is `"0"`).
 * Every count the reductions consume is now judged by `isWireCount`, per
 * side and per index.
 */
function aggregateChecks(side: "before" | "after", aggregate: unknown): FieldCheck[] {
  if (!isRecord(aggregate)) return [[side, false]];
  const checks: FieldCheck[] = [
    [`${side}.accounts`, isWireCount(aggregate.accounts)],
    [`${side}.eligible_accounts`, isWireCount(aggregate.eligible_accounts)],
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
        checks.push([`${at}.count`, isWireCount(bucket.count)]);
      });
    }
    checks.push([`${side}.hf_histogram.infinite_count`, isWireCount(histogram.infinite_count)]);
    checks.push([`${side}.hf_histogram.refused_count`, isWireCount(histogram.refused_count)]);
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
 * The transition matrix (`RunBookTransitions`): its OWN `wad_scale` — the
 * controller-pinned field Task 1's review proved coerces to a
 * "0 entered / 0 exited" costume in `belowOneLanes` — the per-index lane
 * bounds, and every occupied cell's two nullable debts.
 *
 * p1b-9 (Codex round, finding 2): AND EVERY COUNT `readTransitions` and the
 * region reductions consume. The old header claimed the counts were "integers
 * the module's own `readTransitions` reconciles" — but a reconciliation over
 * unvalidated values is arithmetic over coercions (`0 + ""` is `"0"`, NaN
 * comparisons are silently false), and a body that failed the wire contract
 * deserves the MALFORMED register, not a contradiction sentence derived from
 * garbage. Judged in wire read order: `lanes[].index`, `outflows[].from`,
 * `cells[].to`/`rows`, the two margins per index, the five census totals,
 * and the two NULLABLE movement counts (null is a statement).
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
      checks.push([`${at}.index`, isWireCount(lane.index)]);
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
      checks.push([`hf_transitions.outflows[${String(from)}].from`, isWireCount(outflow.from)]);
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
        checks.push([`${at}.to`, isWireCount(cell.to)]);
        checks.push([`${at}.rows`, isWireCount(cell.rows)]);
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
        checks.push([`hf_transitions.${margin}[${String(index)}]`, isWireCount(value)]);
      });
    }
  }
  // THE CENSUS TOTALS, then the two nullable movement counts.
  checks.push(["hf_transitions.total_rows", isWireCount(transitions.total_rows)]);
  checks.push(["hf_transitions.measured_rows", isWireCount(transitions.measured_rows)]);
  checks.push(["hf_transitions.unmeasured_rows", isWireCount(transitions.unmeasured_rows)]);
  checks.push([
    "hf_transitions.unmeasured_refused_in_batch_rows",
    isWireCount(transitions.unmeasured_refused_in_batch_rows),
  ]);
  checks.push([
    "hf_transitions.unmeasured_excluded_by_this_layer_rows",
    isWireCount(transitions.unmeasured_excluded_by_this_layer_rows),
  ]);
  checks.push(["hf_transitions.held_rows", isNullableWireCount(transitions.held_rows)]);
  checks.push([
    "hf_transitions.lane_changed_rows",
    isNullableWireCount(transitions.lane_changed_rows),
  ]);
  return checks;
}

/**
 * CLASSIFY THE WHOLE ENGINE SUBTREE, in wire read order. Empty list =
 * renderable; a non-empty list is the p0-8 malformed register's content, per
 * index. `cellPrimaryOutcome`'s malformed arm delegates here (one law, one
 * function), so the matrix cell, the superseded payload, the engine panel
 * and the parent summary all refuse on the SAME classification.
 */
export function classifyRunBookEngine(engine: LabRunBookEngine): { malformedFields: string[] } {
  const e = engine as unknown as Record<string, unknown>;
  const checks: FieldCheck[] = [];

  checks.push(["usd_decimals", isWireScale(e.usd_decimals)]);
  checks.push(...aggregateChecks("before", e.before));
  checks.push(...aggregateChecks("after", e.after));
  checks.push(...transitionChecks(e.hf_transitions));
  checks.push(["newly_eligible_accounts", isWireCount(e.newly_eligible_accounts)]);
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
  // p1b-9 (finding 2): the FULL mover count — `moversDisclosure`'s own
  // denominator ("top 20 of N"). A malformed total rendered "NaN are not on
  // this page" as a computed-looking clause.
  checks.push(["movers_total", isWireCount(e.movers_total)]);

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
