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
 * One aggregate side (`RunBookAggregate`): the two counts, the five Decimals,
 * the histogram's scale and per-index bucket bounds, and the per-index
 * collateral decomposition. `buckets[].upper_wad` is nullable (the open-ended
 * top bucket); `collateral_by_asset[].value_usd` is nullable (an unpriced
 * balance's worth is unknowable, not zero).
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
        checks.push([
          `${side}.hf_histogram.buckets[${String(index)}].upper_wad`,
          isRecord(bucket) && isNullableWireDecimal(bucket.upper_wad),
        ]);
      });
    }
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
 * bounds, and every occupied cell's two nullable debts. The lane and cell
 * COUNTS are integers the module's own `readTransitions` reconciles; the
 * fields here are the ones that reach BigInt or the money renderers.
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
      checks.push([
        `hf_transitions.lanes[${String(index)}].upper_wad`,
        isRecord(lane) && isNullableWireDecimal(lane.upper_wad),
      ]);
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
        checks.push([`${at}.debt_before_usd`, isNullableWireDecimal(cell.debt_before_usd)]);
        checks.push([`${at}.debt_after_usd`, isNullableWireDecimal(cell.debt_after_usd)]);
      });
    });
  }
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
