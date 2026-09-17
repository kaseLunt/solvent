// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side.
import type { StressLookup } from "@solvent/client";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal, isWirePopulation } from "./wireGuard";

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
  /** The wire's `horizon_seconds`, unread: `horizonLabel` guards it, and a duration the guard refuses carries the unknowable verdict. */
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

/**
 * The stress response's own batch rides every arm: the position lookup and the stress lookup are two requests, and
 * the batch each answers for is its own. Null only when the wire carries no batch id the population guard admits —
 * a figure is shown for the batch it names, so a stress body with no readable batch names none.
 */
export type StressReading =
  | { kind: "rows"; rows: StressRow[]; batchId: number | null }
  | { kind: "no-position"; batchId: number | null }
  | { kind: "withheld"; cause: string; batchId: number | null };

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
  // A horizon whose duration is not a wire population is not a horizon a reader may be told about: it carries no
  // verdict, whatever the wire said for it, so the row is a cannot-say that names it rather than a "No" or a "Within".
  const projection =
    horizons.length === 0
      ? null
      : horizons.map((h) => ({
          seconds: h.horizon_seconds,
          extraInterest: wireInt(h.additional_interest_usd),
          verdict: isWirePopulation(h.horizon_seconds) ? h.liquidation_verdict : "unknowable",
        }));
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
  // The batch this body answers for, through the population guard: an id the guard refuses names no batch.
  const id: unknown = lookup.response.batch.id;
  const batchId = isWirePopulation(id) ? id : null;
  if (lookup.outcome === "unknowable") return { kind: "withheld", cause: withheldCause(lookup.withheldEngines), batchId };
  if (lookup.outcome === "not-found") return { kind: "no-position", batchId };
  // `found` is set whenever ANY position exists (an Aave one will do), so a withheld Cash book
  // can arrive under it. This reading is Cash-scoped: a withheld Cash engine makes it withheld
  // with its cause — "not evaluated for this account" would be a false one.
  if (lookup.withheldEngines.some((w) => w.engine === CASH)) return { kind: "withheld", cause: withheldCause(lookup.withheldEngines), batchId };
  return { kind: "rows", rows: lookup.response.scenarios.map((s) => row(s, account)), batchId };
}

/**
 * One row's "Becomes liquidatable?" judgement, decided once. The gate first: a result the engine did not apply, or a
 * side that is missing or unknowable, earns no verdict word. A projection is then judged by its horizons, never by its
 * `after` (that is the spot, unchanged by construction): an unknowable horizon is a cannot-say that names the horizon;
 * a liquidatable one names the first horizon it happens within; otherwise the account holds through the longest. A spot
 * shock speaks through its flip, and a position liquidatable on both sides is said so — never a "No".
 */
export type StressVerdict =
  | { readonly kind: "not-applicable"; readonly reason: string }
  /** `horizon` is the unknowable horizon when one refused the row; null when a side did. */
  | { readonly kind: "cannot-say"; readonly horizon: StressHorizon | null }
  /** `within`: the first horizon a projection flips within; null for a spot shock. `already`: liquidatable before the shock too. */
  | { readonly kind: "liquidatable"; readonly within: StressHorizon | null; readonly already: boolean }
  /** `through`: the longest horizon a projection holds through; null for a spot shock. */
  | { readonly kind: "inside"; readonly through: StressHorizon | null };

export function stressVerdict(row: StressRow): StressVerdict {
  if (!row.applicable) return { kind: "not-applicable", reason: row.reason ?? "not applicable" };
  // `flips` is null exactly when a side is missing or unknowable: nothing past this line speaks for such a row.
  if (row.flips === null) return { kind: "cannot-say", horizon: null };
  if (row.projection !== null) {
    const unknowable = row.projection.find((h) => h.verdict === "unknowable");
    if (unknowable !== undefined) return { kind: "cannot-say", horizon: unknowable };
    const within = row.projection.find((h) => h.verdict === "liquidatable");
    if (within !== undefined) return { kind: "liquidatable", within, already: false };
    const longest = row.projection.reduce<StressHorizon | null>((a, h) => (a === null || h.seconds > a.seconds ? h : a), null);
    // Unreachable: a projection is null when it has no horizons. Kept so an empty list is never "inside".
    if (longest === null) return { kind: "cannot-say", horizon: null };
    return { kind: "inside", through: longest };
  }
  if (row.flips) return { kind: "liquidatable", within: null, already: false };
  if (row.after?.verdict === "liquidatable") return { kind: "liquidatable", within: null, already: true };
  return { kind: "inside", through: null };
}

/** The verdict's cell: its words, the pill tone it wears (null for plain text), and the demoted detail for the hover. */
export interface StressVerdictWords {
  readonly text: string;
  readonly tone: "crit" | "warn" | "refused" | null;
  readonly title: string | null;
}

export function stressVerdictWords(verdict: StressVerdict): StressVerdictWords {
  switch (verdict.kind) {
    case "not-applicable":
      return { text: verdict.reason, tone: null, title: null };
    case "cannot-say":
      return {
        text: "Cannot say",
        tone: "refused",
        title:
          verdict.horizon === null
            ? "one side of the comparison is withheld or unknowable"
            : isWirePopulation(verdict.horizon.seconds)
              ? `the ${horizonLabel(verdict.horizon.seconds)} horizon carries no verdict`
              : "a horizon with an unreadable duration carries no verdict",
      };
    case "liquidatable":
      if (verdict.within !== null) return { text: `Within ${horizonLabel(verdict.within.seconds)}`, tone: "warn", title: null };
      return verdict.already
        ? { text: "Already liquidatable", tone: "crit", title: "liquidatable before the shock and after it" }
        : { text: "Yes", tone: "crit", title: null };
    case "inside":
      return verdict.through === null
        ? { text: "No", tone: null, title: null }
        : { text: `Not within ${horizonLabel(verdict.through.seconds)}`, tone: null, title: "a projection speaks only through its longest horizon" };
  }
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/** The refused word for a duration the population guard did not admit: never a plausible length of time. */
export const UNREADABLE_HORIZON = "—";

/**
 * A projection horizon as a label, in integer arithmetic only — every quotient is an exact division of a
 * multiple, never a rounded float: whole days ("30d"), a day-plus remainder in hours ("1d 12h"), hours under
 * a day ("3h"), minutes under an hour ("30m"). Truncation, so a horizon is never printed longer than it is.
 * The duration is a wire population first: a fraction or a negative reaches no comparison, remainder or
 * division, and prints the refused word — "60.5" is never "1m", "-1" never "<1m".
 */
export function horizonLabel(seconds: number): string {
  if (!isWirePopulation(seconds)) return UNREADABLE_HORIZON;
  if (seconds < MINUTE) return "<1m";
  if (seconds < HOUR) return `${String((seconds - (seconds % MINUTE)) / MINUTE)}m`;
  if (seconds < DAY) return `${String((seconds - (seconds % HOUR)) / HOUR)}h`;
  const days = (seconds - (seconds % DAY)) / DAY;
  const restHours = ((seconds % DAY) - (seconds % HOUR)) / HOUR;
  return restHours === 0 ? `${String(days)}d` : `${String(days)}d ${String(restHours)}h`;
}
