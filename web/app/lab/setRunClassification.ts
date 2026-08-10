// THE SetRunEngineSummary CLASSIFIER (p1b-3, closes Codex r3 finding 3).
//
// The tornado/set-run path had ZERO decimal validation. `barLength` called
// bare `BigInt` on two wire strings — `""` coerced to a silent `0n` (an empty
// denominator wore the no-denominator sentence, an empty delta wore the
// measured-zero costume: measured-zero LAUNDERING), and `"-"` threw a
// SyntaxError the route boundary ate — and the ledger's money renderers
// (`renderSignedUsdAmount`/`renderUsdAmount`) threw on malformed deltas,
// scales, realization and projection fields. `classifySetRunEngine` is the
// ONE law those surfaces consult BEFORE any number is read: `tornadoCellState`
// refuses a malformed row into its own named state, so no malformed value
// ever reaches a renderer that throws or a BigInt that coerces.
//
// It is a SIBLING of `engineClassification.ts` (p1b-2), not a widening of it:
// `RunBookEngine` and `SetRunEngineSummary` are different wire shapes under
// different schemas, and one walker judging both would judge one of them
// against the wrong contract. The conventions are shared — wireGuard
// primitives, per-index naming (`projection.horizons[1].projected_usd`),
// nullability mirrored from the generated schema EXACTLY
// (`packages/client-ts/src/generated/schema.ts`, SetRunEngineSummary):
// `flipped_to_eligible` / `hf_dropped_accounts` are the engines' own
// vocabulary statements when null, and the `market_realization` /
// `projection` blocks are judged only when served.
//
// # SCOPE — THE CONSUMED SET, BY DECISION
//
// The inventory is exactly what the tornado surfaces READ off an engine row:
//
//   - `usd_decimals` — the scale every money renderer exponentiates;
//   - `accounts`, `movement_excluded_accounts`, and the two nullable movement
//     subjects — `movementSentence`'s denominator arithmetic;
//   - `eligible_debt_delta_usd`, `total_debt_usd_before` — the ONLY
//     sanctioned ratio (`barLength`) and the ledger's two money columns;
//   - `market_realization.{execution_shortfall_usd,
//     bad_debt_at_liquidation_usd, usd_decimals}` when served — the
//     market-realization ledger block;
//   - `projection.horizons[].{debt_usd, projected_usd,
//     additional_interest_usd}` when served — the projection ledger block.
//
// Fields the wire serves but NO tornado surface consumes
// (`before_eligible_debt_usd`, `before_bad_debt_usd`, `bad_debt_delta_usd`,
// both `*_collateral_at_risk_usd` sides, `total_debt_usd_after`, both
// `total_collateral_usd_*` sides, and the census counts `infinite_accounts` /
// `refused_in_batch_positions` / `unrebuildable_positions` /
// `before_eligible_accounts` / `after_eligible_accounts` /
// `eligible_accounts_delta`) are OUT OF SCOPE by decision: a classifier that
// refused a renderable row over a field no renderer reads would refuse real
// answers over dead weight. A surface that starts consuming one of those owes
// this module the check FIRST — the scope pin in
// `tests/unit/set-run-classification.spec.ts` is where that obligation shows.
//
// THE WALKER NEVER THROWS. Bodies are JSON-cast without runtime validation,
// so a block may be missing or mis-shaped entirely; a classifier that threw
// on the bodies it exists to refuse would reopen the route-boundary hole it
// closes. A mis-shaped served block is named as its own malformed field.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { SetRunEngineSummary } from "../../lib/runbookSet";
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

/** The schema's nullable counts: null is an engine's own statement, non-null must be an integer. */
function isNullableWireCount(value: unknown): boolean {
  return value === null || isWireCount(value);
}

/**
 * CLASSIFY ONE ENGINE ROW, in wire read order. Empty list = renderable; a
 * non-empty list is the p0-8 malformed register's content. `tornadoCellState`
 * composes this per answered engine and names each failure
 * `engines[i].<field>` — one law, one function, so the row state, the header
 * clause and the ledger register all refuse on the SAME classification.
 */
export function classifySetRunEngine(engine: SetRunEngineSummary): { malformedFields: string[] } {
  const e = engine as unknown as Record<string, unknown>;
  const checks: FieldCheck[] = [
    ["usd_decimals", isWireScale(e.usd_decimals)],
    ["accounts", isWireCount(e.accounts)],
    ["movement_excluded_accounts", isWireCount(e.movement_excluded_accounts)],
    ["flipped_to_eligible", isNullableWireCount(e.flipped_to_eligible)],
    ["hf_dropped_accounts", isNullableWireCount(e.hf_dropped_accounts)],
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
