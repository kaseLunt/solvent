// One engine of one result is read here, once, under the classifier and the
// wire guards; the page's workspace and the library's row both consume this
// reading, so one response can never earn two answers. The reading is by
// engine id, and what the BODY says comes before what the definition says:
// unreadable when the envelope is outside the wire contract; withheld by a
// listed refusal or by name (no row and no refusal); unreadable when any field
// the reading would consume is outside the contract, contradictory when the
// lane matrix disagrees with itself; not covered when the definition does not
// model the engine; and a result only once every guard has passed — every
// BigInt sits behind its own named guard. The same judgement of the Cash row,
// asked of the body alone, is the one rule that holds a result and releases it
// (`answerFault`).
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

/** A served row that does not read: outside the wire contract by the names of its fields, or a lane matrix that disagrees with itself. */
export type RowFault = Extract<EngineReading, { readonly kind: "unreadable" | "contradictory" }>;

/**
 * One served row judged on its own, with no definition in hand. The classifier walks the whole subtree — the scale,
 * both sides, the matrix, the signed net, every Decimal and every text the reading consumes, each behind its own
 * named guard — and its faults are the row's before any nested field is touched: a null side or matrix is named by
 * the field, never dereferenced. A row that classifies clean is then read for its lanes, which must agree with
 * themselves.
 */
function judgeRow(e: LabRunBookEngine, engine: string): RowFault | { readonly kind: "reads"; readonly heat: HeatmapView } {
  const malformed = classifyRunBookEngine(e).malformedFields;
  if (malformed.length > 0) return { kind: "unreadable", fields: [...new Set(malformed)] };
  const heat = laneReading(e, { merge: engine === CASH });
  if (heat.kind === "contradictory") return { kind: "contradictory", reasons: heat.reasons };
  return { kind: "reads", heat: heat.view };
}

/**
 * One engine's result, read by id under the classifier and the guards. What the BODY says of the engine is asked
 * before what the definition says of it: a served row that does not read is that fault under any definition — never
 * "not modelled" — so the reading of the Cash row and `answerFault` below can never disagree about one body.
 */
export function readEngine(run: LabRunBook, engine: string, definition: ScenarioDefinition): EngineReading {
  // The envelope first, before the definition is consulted or a list is searched: a body whose envelope is outside
  // the contract is unreadable by the names of its fields, never dereferenced and never "not modelled" — a
  // version-skewed 2xx is a refusal, not a throw at render. Past this line every refusal names its engine and
  // carries a string code, so the phrasebook below is never handed anything else.
  const envelope = classifyRunBookEnvelope(run);
  if (envelope.length > 0) return { kind: "unreadable", fields: envelope };
  const modelled = definition.engines.includes(engine);
  // A listed refusal speaks for its engine: the row beside it, if the body carries one, is not judged.
  const refusal = run.excluded_engines.find((e) => e.engine === engine);
  if (refusal !== undefined) return modelled ? { kind: "withheld", cause: `${engineName(engine)} — ${plainCause(refusal.code, refusal.detail)}` } : { kind: "not-covered" };
  const e = run.engines.find((x) => x.engine === engine);
  if (e === undefined) return modelled ? { kind: "withheld", cause: `${engineName(engine)} — the result carries no row for this engine and no refusal` } : { kind: "not-covered" };
  const row = judgeRow(e, engine);
  if (row.kind !== "reads") return row;
  if (!modelled) return { kind: "not-covered" };
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
      heat: row.heat,
      movers: moversTable(e),
      realization: e.market_realization,
      projection: e.projection,
      note: e.note,
      transitionsNote: e.hf_transitions.note,
    },
  };
}

/**
 * Why a 2xx run-book is a FAILED answer, asked of the body alone — or null when it READS. It reads when its envelope
 * is inside the contract and its Cash row, where the body carries one that no listed refusal speaks for, classifies
 * clean with a lane matrix that agrees with itself: a result. A body with no Cash row, or with Cash among its
 * refusals, reads too — withheld, or not modelled, is an honest answer.
 *
 * This is the ONE rule that holds a result and releases it. The record asks it to decide what may move into the
 * hold; the view asks it FIRST — before the body's version and before the definition's coverage — to decide whether
 * the hold stands. A malformed or self-contradicting body is a failed answer whatever else it says: it never moves
 * into the hold, and it never takes a computed result off the page.
 */
export function answerFault(run: LabRunBook): RowFault | null {
  const envelope = classifyRunBookEnvelope(run);
  if (envelope.length > 0) return { kind: "unreadable", fields: envelope };
  if (run.excluded_engines.some((e) => e.engine === CASH)) return null;
  const cash = run.engines.find((e) => e.engine === CASH);
  if (cash === undefined) return null;
  const row = judgeRow(cash, CASH);
  return row.kind === "reads" ? null : row;
}

/** A 2xx run-book reads as an answer exactly when it carries no fault: `answerFault`, as a yes or a no. */
export const readsAsAnswer = (run: LabRunBook): boolean => answerFault(run) === null;
