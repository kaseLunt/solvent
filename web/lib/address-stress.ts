// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side. The row's one
// verdict and its room words are decided here, for the Inspector's table and
// the Scenarios page's one-address mode alike.
import type { StressLookup } from "@solvent/client";
import { humanUsdFull } from "./human-price";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { UNREADABLE_SCALE } from "./lab-headline";
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
 * A side's figures are read only when its debt and cap are both present and
 * non-negative — the Inspector's rule for a position. A negative wire decimal
 * is a legal string and not a figure: nothing prints from it, the room included.
 */
function readableSide(side: StressSide | null): { readonly debt: bigint; readonly cap: bigint; readonly room: bigint } | null {
  if (side === null || side.debt === null || side.cap === null || side.debt < 0n || side.cap < 0n) return null;
  return { debt: side.debt, cap: side.cap, room: side.cap - side.debt };
}

/**
 * A side is computable when its verdict is known and its figures are a
 * position — the one condition the verdict, the room words, the tiles and the
 * headline share, so a side one of them refuses yields no figure and no verdict
 * word anywhere, on the Inspector and on the Scenarios page alike.
 */
export function computableSide(side: StressSide | null): ReturnType<typeof readableSide> {
  return side !== null && side.verdict !== "unknowable" ? readableSide(side) : null;
}

/** Negative room is worded "over cap by" a positive figure: a minus sign on a dollar figure never prints as room. */
export function roomWords(room: bigint, decimals: number): string {
  return room < 0n ? `over cap by ${humanUsdFull(-room, decimals)}` : humanUsdFull(room, decimals);
}

/**
 * A side's room words, the one register every room cell and tile shares on both pages: "not computed" for a
 * missing, unreadable or unknowable side — never a figure beside a refused register or an unknowable verdict; a
 * negative room "over cap by" a positive figure — never a minus on a dollar figure; the refused scale word where the
 * position's scale did not pass the guard — a figure prints at no other scale than its own.
 */
export function sideRoomWords(side: StressSide | null, decimals: number | null): string {
  const figures = computableSide(side);
  if (figures === null) return "not computed";
  return decimals === null ? UNREADABLE_SCALE : roomWords(figures.room, decimals);
}

/**
 * One row's verdict, decided once, for every surface that prints the row: the gate over both sides, then the
 * projection's horizons, then the spot flip. The Inspector's table, the Scenarios page's headline, its table and its
 * library word all speak from it, so no two can disagree about the same row. A projection is judged by its horizons,
 * never by its `after` — that is the spot, unchanged by construction: an unknowable horizon is a refusal that names
 * the horizon; a liquidatable one names the first horizon it happens within; otherwise the account holds through the
 * longest horizon. A position liquidatable on both sides is said so — never a "No".
 */
export type RowVerdict =
  | { readonly kind: "not-applicable"; readonly reason: string }
  | { readonly kind: "cannot-say"; readonly cause: "not-a-position" | "withheld" | "no-horizon" }
  | { readonly kind: "cannot-say"; readonly cause: "horizon-unknowable"; readonly horizon: StressHorizon }
  | { readonly kind: "liquidatable"; readonly within: StressHorizon | null; readonly already: boolean }
  | { readonly kind: "inside"; readonly through: StressHorizon | null };

export function rowVerdict(row: StressRow): RowVerdict {
  if (!row.applicable) return { kind: "not-applicable", reason: row.reason ?? "the engine gave no reason" };
  // A side that is not computable — missing, unreadable or unknowable — yields no verdict word in any row kind. The
  // gate asks both sides as they are, a missing side included, before either arm may speak.
  const sides = [row.before, row.after];
  if (sides.some((s) => computableSide(s) === null)) {
    // Figures that are present but not a position are the truer cause; a missing or unknowable side is withheld.
    return { kind: "cannot-say", cause: sides.some((s) => s !== null && readableSide(s) === null) ? "not-a-position" : "withheld" };
  }
  if (row.projection !== null) {
    const longest = row.projection.reduce<StressHorizon | null>((a, h) => (a === null || h.seconds > a.seconds ? h : a), null);
    if (longest === null) return { kind: "cannot-say", cause: "no-horizon" };
    const unknowable = row.projection.find((h) => h.verdict === "unknowable");
    if (unknowable !== undefined) return { kind: "cannot-say", cause: "horizon-unknowable", horizon: unknowable };
    const within = row.projection.find((h) => h.verdict === "liquidatable");
    if (within !== undefined) return { kind: "liquidatable", within, already: false };
    return { kind: "inside", through: longest };
  }
  // Past the gate both sides are computable, so the reader's flip is a boolean: null is exactly a missing or unknowable side.
  if (row.flips === true) return { kind: "liquidatable", within: null, already: false };
  if (row.after?.verdict === "liquidatable") return { kind: "liquidatable", within: null, already: true };
  return { kind: "inside", through: null };
}

/** Why a row earns no verdict word — the hover's words, the same on both pages. A horizon whose duration the guard refused is never named by a length of time. */
export function cannotSayTitle(verdict: Extract<RowVerdict, { kind: "cannot-say" }>): string {
  switch (verdict.cause) {
    case "not-a-position":
      return "the shocked figures are not a position";
    case "withheld":
      return "one side of the comparison is withheld or unknowable";
    case "no-horizon":
      return "the projection carries no horizon";
    case "horizon-unknowable":
      return isWirePopulation(verdict.horizon.seconds) ? `the ${horizonLabel(verdict.horizon.seconds)} horizon carries no verdict` : "a horizon with an unreadable duration carries no verdict";
  }
}

/** The verdict's cell: its words, the pill tone it wears (null for plain text), and the demoted detail for the hover. */
export interface StressVerdictWords {
  readonly text: string;
  readonly tone: "crit" | "warn" | "refused" | null;
  readonly title: string | null;
}

/**
 * The "Becomes liquidatable?" cell, spoken from `rowVerdict` — the ONE word function for the Inspector's table and the
 * Scenarios page's one-address table, so the same row under the same header reads the same on both. A projection
 * answers only in its horizons' terms: "Within 90d" for the first horizon it flips within, "Not within 90d" through
 * its longest — never a bare "Yes" or "No", which are a spot shock's words.
 */
export function stressVerdictWords(verdict: RowVerdict): StressVerdictWords {
  switch (verdict.kind) {
    case "not-applicable":
      return { text: verdict.reason, tone: null, title: null };
    case "cannot-say":
      return { text: "Cannot say", tone: "refused", title: cannotSayTitle(verdict) };
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
