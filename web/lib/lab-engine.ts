// One engine of one result is read here, once, under the classifier and the
// wire guards; the page's workspace and the library's row both consume this
// reading, so one response can never earn two answers. The reading is by
// engine id: not covered when the definition does not model the engine,
// withheld by a listed refusal or by name (no row and no refusal), unreadable
// when the envelope or any field the reading would consume is outside the
// wire contract, contradictory when the lane matrix disagrees with itself, and
// a result only once every guard has passed — every BigInt sits behind its own
// named guard.
import type { components } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { classifyRunBookEngine, classifyRunBookEnvelope } from "./lab-classify";
import { moversTable, type MoversTable } from "./lab-movers";
import { laneReading, type HeatmapView } from "./lab-transitions";
import { plainCause } from "./refusal-phrasebook";
import type { LabRunBook, LabRunBookEngine, RunBookEngine } from "./runbook";

type ScenarioDefinition = components["schemas"]["ScenarioDefinition"];

export interface EngineResult {
  readonly engine: string;
  readonly decimals: number;
  /** The wire's SIGNED net: accounts newly liquidatable less any that flipped back to healthy. */
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly eligibleDebtBefore: bigint;
  readonly eligibleDebtAfter: bigint;
  readonly deltaEligibleDebt: bigint;
  readonly badDebtBefore: bigint;
  readonly badDebtAfter: bigint;
  readonly deltaBadDebt: bigint;
  readonly measured: number;
  readonly laneChanged: number | null;
  /** A contradictory matrix never reaches a result, so the heat of a result is always readable. */
  readonly heat: HeatmapView;
  readonly movers: MoversTable;
  readonly realization: RunBookEngine["market_realization"];
  readonly projection: LabRunBookEngine["projection"];
  readonly note: string;
  /** `hf_transitions.note`, verbatim — the wire's own words about its lanes, printed in the drawer. */
  readonly transitionsNote: string;
}
export type EngineReading =
  | { readonly kind: "result"; readonly result: EngineResult }
  | { readonly kind: "withheld"; readonly cause: string }
  | { readonly kind: "not-covered" }
  | { readonly kind: "contradictory"; readonly reasons: readonly string[] }
  | { readonly kind: "unreadable"; readonly fields: readonly string[] };

/** One engine's result, read by id under the classifier and the guards. */
export function readEngine(run: LabRunBook, engine: string, definition: ScenarioDefinition): EngineReading {
  // The envelope first, before the definition is consulted or a list is searched: a body whose envelope is outside
  // the contract is unreadable by the names of its fields, never dereferenced and never "not modelled" — a
  // version-skewed 2xx is a refusal, not a throw at render.
  const envelope = classifyRunBookEnvelope(run);
  if (envelope.length > 0) return { kind: "unreadable", fields: envelope };
  if (!definition.engines.includes(engine)) return { kind: "not-covered" };
  const refusal = run.excluded_engines.find((e) => e.engine === engine);
  if (refusal !== undefined) return { kind: "withheld", cause: `${engineName(engine)} — ${plainCause(refusal.code, refusal.detail)}` };
  const e = run.engines.find((x) => x.engine === engine);
  if (e === undefined) return { kind: "withheld", cause: `${engineName(engine)} — the result carries no row for this engine and no refusal` };
  // The classifier walks the whole subtree — the scale, both sides, the matrix, the signed net, every Decimal the
  // reading consumes, each behind its own named guard — and its faults are the reading's before any nested field
  // is touched: a null side or matrix is named by the field, never dereferenced.
  const malformed = classifyRunBookEngine(e).malformedFields;
  if (malformed.length > 0) return { kind: "unreadable", fields: [...new Set(malformed)] };
  const heat = laneReading(e, { merge: engine === CASH });
  if (heat.kind === "contradictory") return { kind: "contradictory", reasons: heat.reasons };
  return {
    kind: "result",
    result: {
      engine,
      decimals: e.usd_decimals,
      // `newly_eligible_accounts` is the wire's SIGNED net: a negative net is an answer, never a malformed field.
      newly: e.newly_eligible_accounts,
      beforeEligible: e.before.eligible_accounts,
      afterEligible: e.after.eligible_accounts,
      eligibleDebtBefore: BigInt(e.before.eligible_debt_usd),
      eligibleDebtAfter: BigInt(e.after.eligible_debt_usd),
      deltaEligibleDebt: BigInt(e.eligible_debt_delta_usd),
      badDebtBefore: BigInt(e.before.bad_debt_usd),
      badDebtAfter: BigInt(e.after.bad_debt_usd),
      deltaBadDebt: BigInt(e.bad_debt_delta_usd),
      measured: e.hf_transitions.measured_rows,
      laneChanged: e.hf_transitions.lane_changed_rows,
      heat: heat.view,
      movers: moversTable(e),
      realization: e.market_realization,
      projection: e.projection,
      note: e.note,
      transitionsNote: e.hf_transitions.note,
    },
  };
}

/**
 * A 2xx run-book READS as an answer, or it does not — asked of the body alone, so the record that holds a result may
 * ask it without a definition. It reads when its envelope is inside the contract and its Cash row, where the body
 * carries one that no listed refusal speaks for, classifies clean with a lane matrix that agrees with itself: a
 * result. A body with no Cash row, or with Cash among its refusals, reads too — withheld, or not modelled, is an
 * honest answer. A malformed or self-contradicting body is a failed answer: it never moves into the hold, so the
 * last body that read stands behind every one that does not.
 */
export function readsAsAnswer(run: LabRunBook): boolean {
  if (classifyRunBookEnvelope(run).length > 0) return false;
  if (run.excluded_engines.some((e) => e.engine === CASH)) return true;
  const cash = run.engines.find((e) => e.engine === CASH);
  if (cash === undefined) return true;
  return classifyRunBookEngine(cash).malformedFields.length === 0 && laneReading(cash, { merge: true }).kind !== "contradictory";
}
