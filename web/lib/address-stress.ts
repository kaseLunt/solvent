// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side.
import type { StressLookup } from "@solvent/client";
import { CASH } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal } from "./wireGuard";

type Scenario = StressLookup["response"]["scenarios"][number];
type Result = Scenario["results"][number];
type State = NonNullable<Result["before"]>;

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

export interface StressRow {
  readonly id: string;
  readonly label: string;
  readonly applicable: boolean;
  readonly reason: string | null;
  readonly before: StressSide | null;
  readonly after: StressSide | null;
  /** before not liquidatable → after liquidatable. Null when either side is missing or unknowable. */
  readonly flips: boolean | null;
  readonly projection: StressHorizon[] | null;
}

export type StressReading = { kind: "rows"; rows: StressRow[] } | { kind: "no-position" } | { kind: "withheld"; cause: string };

const wireInt = (v: string | null | undefined): bigint | null => (typeof v === "string" && isWireDecimal(v) ? BigInt(v) : null);

function side(state: State | null): StressSide | null {
  if (state === null) return null;
  const debt = wireInt(state.debt_usd);
  const cap = wireInt(state.max_borrow_lt);
  return { debt, cap, room: debt === null || cap === null ? null : cap - debt, verdict: state.liquidation_verdict };
}

function row(scenario: Scenario, account: string): StressRow {
  const result = scenario.results.find((r) => r.engine === CASH && r.account.toLowerCase() === account.toLowerCase());
  if (result === undefined) {
    return { id: scenario.id, label: scenario.label, applicable: false, reason: "not evaluated for this account", before: null, after: null, flips: null, projection: null };
  }
  const before = side(result.before);
  const after = side(result.after);
  const flips =
    before === null || after === null || before.verdict === "unknowable" || after.verdict === "unknowable"
      ? null
      : before.verdict !== "liquidatable" && after.verdict === "liquidatable";
  const projection =
    result.projection === null
      ? null
      : result.projection.horizons.map((h) => ({ seconds: h.horizon_seconds, extraInterest: wireInt(h.additional_interest_usd), verdict: h.liquidation_verdict }));
  return { id: scenario.id, label: scenario.label, applicable: result.applicable, reason: result.reason ?? null, before, after, flips, projection };
}

export function stressReading(lookup: StressLookup, account: string): StressReading {
  if (lookup.outcome === "unknowable") {
    return { kind: "withheld", cause: lookup.withheldEngines.map((w) => plainCause(w.code, w.detail)).join("; ") };
  }
  if (lookup.outcome === "not-found") return { kind: "no-position" };
  return { kind: "rows", rows: lookup.response.scenarios.map((s) => row(s, account)) };
}
