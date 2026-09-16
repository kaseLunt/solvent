// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side.
import type { StressLookup } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal } from "./wireGuard";

type Scenario = StressLookup["response"]["scenarios"][number];
type Result = Scenario["results"][number];
type State = NonNullable<Result["before"]>;
type Withheld = StressLookup["withheldEngines"][number];

export interface StressSide {
  readonly debt: bigint | null;
  readonly cap: bigint | null;
  readonly room: bigint | null;
  readonly verdict: State["liquidation_verdict"];
}

export interface StressHorizon {
  readonly seconds: number;
  readonly extraInterest: bigint | null;
  readonly verdict: State["liquidation_verdict"];
}

/** The market-realization axis, when the scenario publishes one: USD figures at the wire's own `usd_decimals`. */
export interface StressShortfall {
  readonly shortfall: bigint | null;
  readonly badDebt: bigint | null;
  readonly decimals: number;
}

export interface StressRow {
  readonly id: string;
  readonly label: string;
  readonly applicable: boolean;
  readonly reason: string | null;
  readonly before: StressSide | null;
  readonly after: StressSide | null;
  /** before not liquidatable → after liquidatable. Null when the result is not applicable, or either side is missing or unknowable. */
  readonly flips: boolean | null;
  /** The projection's horizons; null when the wire carries none. */
  readonly projection: StressHorizon[] | null;
  /** The projection's own disclaimer (delta-only; the base accrual is absent), verbatim; null without a projection. */
  readonly projectionNote: string | null;
  readonly marketRealization: StressShortfall | null;
}

export type StressReading = { kind: "rows"; rows: StressRow[] } | { kind: "no-position" } | { kind: "withheld"; cause: string };

const wireInt = (v: string | null | undefined): bigint | null => (typeof v === "string" && isWireDecimal(v) ? BigInt(v) : null);

function side(state: State | null): StressSide | null {
  if (state === null) return null;
  const debt = wireInt(state.debt_usd);
  const cap = wireInt(state.max_borrow_lt);
  return { debt, cap, room: debt === null || cap === null ? null : cap - debt, verdict: state.liquidation_verdict };
}

function inapplicable(scenario: Scenario, reason: string): StressRow {
  return { id: scenario.id, label: scenario.label, applicable: false, reason, before: null, after: null, flips: null, projection: null, projectionNote: null, marketRealization: null };
}

function row(scenario: Scenario, account: string): StressRow {
  const [result, ...rest] = scenario.results.filter((r) => r.engine === CASH && r.account.toLowerCase() === account.toLowerCase());
  if (result === undefined) return inapplicable(scenario, "not evaluated for this account");
  // Two results for one (engine, account) is a contradiction the wire must not carry: named, never half-read.
  if (rest.length > 0) return inapplicable(scenario, "two results for this account — contradictory");
  const before = side(result.before);
  const after = side(result.after);
  const flips =
    !result.applicable || before === null || after === null || before.verdict === "unknowable" || after.verdict === "unknowable"
      ? null
      : before.verdict !== "liquidatable" && after.verdict === "liquidatable";
  const horizons = result.projection?.horizons ?? [];
  const projection =
    horizons.length === 0
      ? null
      : horizons.map((h) => ({ seconds: h.horizon_seconds, extraInterest: wireInt(h.additional_interest_usd), verdict: h.liquidation_verdict }));
  const mr = result.market_realization;
  const marketRealization =
    mr === null ? null : { shortfall: wireInt(mr.execution_shortfall_usd), badDebt: wireInt(mr.bad_debt_at_liquidation_usd), decimals: mr.usd_decimals };
  return {
    id: scenario.id,
    label: scenario.label,
    applicable: result.applicable,
    reason: result.reason ?? null,
    before,
    after,
    flips,
    projection,
    projectionNote: result.projection?.note ?? null,
    marketRealization,
  };
}

/** Every withheld engine, named, with its plain cause. */
function withheldCause(engines: readonly Withheld[]): string {
  return engines.map((w) => `${engineName(w.engine)} — ${plainCause(w.code, w.detail)}`).join("; ");
}

export function stressReading(lookup: StressLookup, account: string): StressReading {
  if (lookup.outcome === "unknowable") return { kind: "withheld", cause: withheldCause(lookup.withheldEngines) };
  if (lookup.outcome === "not-found") return { kind: "no-position" };
  // `found` is set whenever ANY position exists (an Aave one will do), so a withheld Cash book
  // can arrive under it. This reading is Cash-scoped: a withheld Cash engine makes it withheld
  // with its cause — "not evaluated for this account" would be a false one.
  if (lookup.withheldEngines.some((w) => w.engine === CASH)) return { kind: "withheld", cause: withheldCause(lookup.withheldEngines) };
  return { kind: "rows", rows: lookup.response.scenarios.map((s) => row(s, account)) };
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/**
 * A projection horizon as a label, in integer arithmetic only — every quotient is an exact division of a
 * multiple, never a rounded float: whole days ("30d"), a day-plus remainder in hours ("1d 12h"), hours under
 * a day ("3h"), minutes under an hour ("30m"). Truncation, so a horizon is never printed longer than it is.
 */
export function horizonLabel(seconds: number): string {
  if (seconds < HOUR) return `${String((seconds - (seconds % MINUTE)) / MINUTE)}m`;
  if (seconds < DAY) return `${String((seconds - (seconds % HOUR)) / HOUR)}h`;
  const days = (seconds - (seconds % DAY)) / DAY;
  const restHours = ((seconds % DAY) - (seconds % HOUR)) / HOUR;
  return restHours === 0 ? `${String(days)}d` : `${String(days)}d ${String(restHours)}h`;
}
