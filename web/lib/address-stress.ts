// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side. The row's one
// verdict and its room words are decided here, for the Inspector's table and
// the Scenarios page's one-address mode alike.
import type { StressLookup } from "@solvent/client";
import { headroomTenths } from "./headroom";
import { humanUsdFull } from "./human-price";
import { engineName } from "./inspector-headline";
import { CASH } from "./inspector-position";
import { UNREADABLE_SCALE } from "./lab-headline";
import { formatTenths } from "./percent";
import { plainCause } from "./refusal-phrasebook";
import { scenarioName } from "./scenario-name";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

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
  /** The scenario's one name, built from its definition (`scenarioName`). */
  readonly name: string;
  /** The wire's own label, verbatim: the name's title. */
  readonly label: string;
  readonly applicable: boolean;
  readonly reason: string | null;
  readonly before: StressSide | null;
  readonly after: StressSide | null;
  /** before not liquidatable → after liquidatable. Null when the result is not applicable, or either side is missing or unknowable. */
  readonly flips: boolean | null;
  /**
   * The projection's horizons. Null exactly when the wire carries NO PROJECTION (a spot row); an empty list is a
   * projection that carries no horizon — a different fact, which `rowVerdict` answers with its `no-horizon` arm.
   */
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

/** The scenario's name from its own shocks; a shocks list that is not a list of objects is never read, and the wire's label stands. */
function nameOf(scenario: Scenario): string {
  const shocks: unknown = scenario.shocks;
  return Array.isArray(shocks) && shocks.every((shock) => typeof shock === "object" && shock !== null) ? scenarioName(scenario) : scenario.label;
}

function inapplicable(scenario: Scenario, reason: string): StressRow {
  return { id: scenario.id, name: nameOf(scenario), label: scenario.label, applicable: false, reason, before: null, after: null, flips: null, projection: null, projectionNote: null, marketRealization: null };
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
  // "No projection" and "a projection with no horizon" are two wire facts and stay two: the first is a spot row, the
  // second is a projection that states nothing — it reaches the judge as an empty list, whose arm is a cannot-say.
  // Erasing it to null would hand the row to the spot path and its "No".
  //
  // A horizon whose duration is not a wire population is not a horizon a reader may be told about: it carries no
  // verdict, whatever the wire said for it, so the row is a cannot-say that names it rather than a "No" or a "Within".
  const projection =
    result.projection === null || result.projection === undefined
      ? null
      : (result.projection.horizons ?? []).map((h) => ({
          seconds: h.horizon_seconds,
          extraInterest: wireInt(h.additional_interest_usd),
          verdict: isWirePopulation(h.horizon_seconds) ? h.liquidation_verdict : ("unknowable" as const),
        }));
  const mr = result.market_realization;
  const marketRealization =
    mr === null ? null : { shortfall: wireInt(mr.execution_shortfall_usd), badDebt: wireInt(mr.bad_debt_at_liquidation_usd), decimals: mr.usd_decimals };
  return {
    id: scenario.id,
    name: nameOf(scenario),
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
 * Why a stress figure has no scale to print at. The scale is the lookup's Cash position's own, so there are four
 * causes and they are not one another: the position's scale failed the guard; the lookup found no Cash position;
 * the lookup's Cash book is withheld; the lookup did not complete. Only the first is an unreadable scale.
 */
export type ScaleAbsence = "unreadable" | "no-position" | "withheld" | "no-lookup";

const SCALE_ABSENCE_WORDS: Readonly<Record<ScaleAbsence, string>> = {
  unreadable: UNREADABLE_SCALE,
  "no-position": "no Cash position in the lookup",
  withheld: "Cash book withheld in the lookup",
  "no-lookup": "lookup not completed",
};

/** The cell's words where no figure prints for want of a scale: the true cause, or — handed none — the scale's own word. */
export function scaleAbsenceWords(absence: ScaleAbsence | null): string {
  return SCALE_ABSENCE_WORDS[absence ?? "unreadable"];
}

/**
 * A side's room words, the one register every room cell and tile shares on both pages: "not computed" for a
 * missing, unreadable or unknowable side — never a figure beside a refused register or an unknowable verdict; a
 * negative room "over cap by" a positive figure — never a minus on a dollar figure; and where there is no scale to
 * print at, the cause the view states (`ScaleAbsence`) — a figure prints at no other scale than its own, and "unreadable
 * scale" is said only of a scale that was read and refused.
 */
export function sideRoomWords(side: StressSide | null, decimals: number | null, absence: ScaleAbsence | null = null): string {
  const figures = computableSide(side);
  if (figures === null) return "not computed";
  return decimals === null ? scaleAbsenceWords(absence) : roomWords(figures.room, decimals);
}

/** A table cell is a standalone line: it starts with a capital. */
const cellCase = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** A table's room cell: the text, the dollar room behind it, and whether it is over the cap (crit ink). */
export interface RoomCell {
  readonly text: string;
  readonly title: string | null;
  readonly over: boolean;
}

/**
 * A room cell as every table prints it — one unit down the column: the room as a signed percent of the cap, floored
 * to a fixed tenth (the Book's headroom rule, so an over-cap room is never friendlier than it is), over the cap
 * negative, and the dollar room in the title in the prose's own words. A zero cap over debt has no percent and says
 * so. A side that is not computable prints no figure; with no scale the cell names the true cause.
 */
export function roomCell(side: StressSide | null, decimals: number | null, absence: ScaleAbsence | null = null): RoomCell {
  const figures = computableSide(side);
  if (figures === null) return { text: "Not computed", title: null, over: false };
  if (decimals === null) return { text: cellCase(scaleAbsenceWords(absence)), title: null, over: false };
  const over = figures.room < 0n;
  const title = over ? cellCase(roomWords(figures.room, decimals)) : `Room ${roomWords(figures.room, decimals)}`;
  const tenths = headroomTenths(figures.cap, figures.debt);
  if (tenths === null) return figures.debt > 0n ? { text: "Over cap", title, over: true } : { text: "No debt", title: null, over: false };
  return { text: formatTenths(tenths, { fixed: true }), title, over };
}

/**
 * The market-realization axis under a row's room, where the scenario publishes one: its shortfall and its bad debt at
 * the wire's own scale, as a sentence-case line. Null when the axis is absent, its scale unreadable, or it states
 * neither figure.
 */
export function realizationWords(m: StressShortfall | null): string | null {
  if (m === null || !isWireScale(m.decimals)) return null;
  const part = (label: string, v: bigint | null): string | null => (v === null ? null : `${label} ${humanUsdFull(v, m.decimals)}`);
  const parts = [part("shortfall", m.shortfall), part("bad debt", m.badDebt)].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : cellCase(parts.join(" · "));
}

/** A projection that lists no horizon, in its sub-line: the words beside the verdict's "Cannot say". */
const NO_HORIZON_WORDS = "no horizon in the projection";

/**
 * A projection's interest by each horizon, as prose clauses at the position's scale: "+$7.92 interest by 30 days",
 * then "+$23.77 by 90 days" — the noun once, on the first. A horizon with no interest, or a negative one (out of
 * contract, never "+−$"), says "interest not computed by 30 days".
 */
export function projectionInterestClauses(horizons: readonly StressHorizon[], decimals: number): string[] {
  let named = false;
  return horizons.map((h) => {
    const by = `by ${horizonWords(h.seconds)}`;
    if (h.extraInterest === null || h.extraInterest < 0n) {
      named = true;
      return `interest not computed ${by}`;
    }
    const figure = `+${humanUsdFull(h.extraInterest, decimals)}`;
    const clause = named ? `${figure} ${by}` : `${figure} interest ${by}`;
    named = true;
    return clause;
  });
}

/**
 * The line under a projection row's name: its interest by each horizon. With no scale to print at it is the one true
 * cause, said once — never "+— interest" per horizon. A projection that carries no horizon says so, whatever the
 * scale: a missing scale is not why it has nothing to list. It follows a " · " in the sub-line, so it starts lower case.
 */
export function projectionSubLine(horizons: readonly StressHorizon[], decimals: number | null, absence: ScaleAbsence | null = null): string {
  if (horizons.length === 0) return NO_HORIZON_WORDS;
  if (decimals === null) return scaleAbsenceWords(absence);
  return projectionInterestClauses(horizons, decimals).join(", ");
}

/**
 * A projection row's Room after cell: a state word, never a blank or a dash. A rate horizon holds prices flat, so its
 * spot room is unchanged; printing it would read as a shocked room.
 */
export const PROJECTION_ROOM_CELL = {
  text: "Interest only",
  title: "A rate horizon holds prices flat; its extra interest by each horizon is listed under its name.",
} as const;

/** What a stress table's Room after cells print, said once under the table. */
export const STRESS_ROOM_DEFINITION = "Room after is the share of each scenario’s cap left unborrowed; below zero, the account is over its cap.";

/**
 * Room today, once for a whole table: every applicable row's before side is the same computable figure, so it is
 * stated in the column's unit (the signed percent) and in dollars. Null when the rows disagree, a side has no figure
 * or no percent, there is no scale, or no row applies — and the table keeps its Room today column.
 */
export function agreedRoomToday(rows: readonly StressRow[], decimals: number | null, absence: ScaleAbsence | null = null): { percent: string; dollars: string } | null {
  if (decimals === null) return null;
  const agreed = new Map<string, { percent: string; dollars: string }>();
  for (const r of rows) {
    if (!r.applicable) continue;
    const figures = computableSide(r.before);
    if (figures === null || headroomTenths(figures.cap, figures.debt) === null) return null;
    const today = { percent: roomCell(r.before, decimals, absence).text, dollars: sideRoomWords(r.before, decimals, absence) };
    agreed.set(`${today.percent}|${today.dollars}`, today);
  }
  return agreed.size === 1 ? ([...agreed.values()][0] ?? null) : null;
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
      return { text: cellCase(verdict.reason), tone: null, title: null };
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

/** A number and its unit never part across a line: the age grammar's joiner (U+00A0). */
const NBSP = "\u00a0";

/**
 * A projection horizon as a label, in the age grammar ("30 min", "3 h") and integer arithmetic only — every
 * quotient is an exact division of a multiple, never a rounded float: whole days ("30 d"), a day-plus remainder in
 * hours ("1 d 12 h"), hours under a day ("3 h"), minutes under an hour ("30 min"). Truncation, so a horizon is never
 * printed longer than it is. The duration is a wire population first: a fraction or a negative reaches no
 * comparison, remainder or division, and prints the refused word — "60.5" is never "1 min", "-1" never "<1 min".
 */
export function horizonLabel(seconds: number): string {
  if (!isWirePopulation(seconds)) return UNREADABLE_HORIZON;
  if (seconds < MINUTE) return `<1${NBSP}min`;
  if (seconds < HOUR) return `${String((seconds - (seconds % MINUTE)) / MINUTE)}${NBSP}min`;
  if (seconds < DAY) return `${String((seconds - (seconds % HOUR)) / HOUR)}${NBSP}h`;
  const days = (seconds - (seconds % DAY)) / DAY;
  const restHours = ((seconds % DAY) - (seconds % HOUR)) / HOUR;
  return restHours === 0 ? `${String(days)}${NBSP}d` : `${String(days)}${NBSP}d ${String(restHours)}${NBSP}h`;
}

/** A count and its unit, singular for one, never parted across a line. */
const unit = (n: number, one: string): string => `${String(n)}${NBSP}${n === 1 ? one : `${one}s`}`;

/**
 * The prose form of `horizonLabel` — "30 days", "1 day", "12 hours", "45 minutes", "<1 minute" — for sentences; the
 * label's abbreviations stay in dense table cells. The same guard and the same integer truncation, so a horizon is
 * never printed longer than it is, and a duration the guard refuses prints the refused word.
 */
export function horizonWords(seconds: number): string {
  if (!isWirePopulation(seconds)) return UNREADABLE_HORIZON;
  if (seconds < MINUTE) return `<1${NBSP}minute`;
  if (seconds < HOUR) return unit((seconds - (seconds % MINUTE)) / MINUTE, "minute");
  if (seconds < DAY) return unit((seconds - (seconds % HOUR)) / HOUR, "hour");
  const days = unit((seconds - (seconds % DAY)) / DAY, "day");
  const restHours = ((seconds % DAY) - (seconds % HOUR)) / HOUR;
  return restHours === 0 ? days : `${days} ${unit(restHours, "hour")}`;
}
