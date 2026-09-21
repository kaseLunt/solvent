import { asSentence, bookHeadline, bookHeadlineRefused, type Headline, type Sum, type WalkStopKind } from "./book-headline";
import {
  liquidatableRows,
  NEAR_CAP_BAND_IDS,
  nearCapRows,
  roomBands,
  roomPercentiles,
  sumDebt,
  type CashRow,
  type RoomBand,
  type SizedCashRow,
} from "./cash-rows";
import { humanUsd } from "./human-usd";
import { MATERIAL_LINE_USD, partitionByMateriality, type MaterialityPartition } from "./materiality";
import { plainCause } from "./refusal-phrasebook";

export interface CashSummaryInput {
  readonly rows: readonly CashRow[];
  readonly decimals: number;
  readonly refusedPositions: number;
  readonly walkComplete: boolean;
  /** The walk stopped before it was complete, with this cause. */
  readonly walkStopped: string | null;
  /** How that walk ended; null exactly when `walkStopped` is. */
  readonly walkStopKind: WalkStopKind | null;
  readonly refusedWhole: { code: string; detail: string | null } | null;
}

/** Everything the Book and the Overview strip print about the Cash book, from one walk. */
export interface CashSummary {
  readonly decimals: number;
  readonly headline: Headline;
  readonly material: Sum;
  readonly belowLine: Sum;
  readonly nearCap: Sum;
  readonly notComputed: number;
  /** Accounts the walk read with a known verdict. */
  readonly computed: number;
  readonly liquidatable: MaterialityPartition<SizedCashRow>;
  readonly nearCapRows: SizedCashRow[];
  readonly bands: RoomBand[];
  readonly percentiles: { median: string | null; p10: string | null };
  /** The walk reached its last page; until then the figures are a lower bound. */
  readonly settled: boolean;
  /** The walk stopped before it was complete, with this cause; no negative is claimed over the rest. */
  readonly stopped: string | null;
  /**
   * How that walk ended; null exactly when `stopped` is. A walk past its census ("over") may have landed an account
   * twice, so its figures are what it landed and are never called a lower bound.
   */
  readonly stopKind: WalkStopKind | null;
}

export function summarizeCash(input: CashSummaryInput): CashSummary {
  const liquidatable = partitionByMateriality(liquidatableRows(input.rows), input.decimals);
  const near = nearCapRows(input.rows);
  const material: Sum = { sum: liquidatable.sums.material, count: liquidatable.counts.material };
  const belowLine: Sum = { sum: liquidatable.sums.belowLine, count: liquidatable.counts.belowLine };
  const nearCap: Sum = { sum: sumDebt(near), count: near.length };
  const computed = input.rows.filter((r) => r.computed).length;
  const stopped = input.walkComplete ? null : input.walkStopped;
  const stopKind = stopped === null ? null : input.walkStopKind;
  const headline =
    input.refusedWhole !== null
      ? bookHeadlineRefused(plainCause(input.refusedWhole.code, input.refusedWhole.detail))
      : bookHeadline({
          decimals: input.decimals,
          material,
          belowLine,
          nearCap,
          notComputed: input.refusedPositions,
          computed,
          complete: input.walkComplete,
          stopped,
          stopKind,
        });
  return {
    decimals: input.decimals,
    headline,
    material,
    belowLine,
    nearCap,
    notComputed: input.refusedPositions,
    computed,
    liquidatable,
    nearCapRows: near,
    bands: roomBands(input.rows),
    percentiles: roomPercentiles(input.rows),
    settled: input.walkComplete,
    stopped,
    stopKind,
  };
}

type WalkState = Pick<CashSummary, "settled" | "stopped" | "stopKind">;

/** A walk past its census: its rows may count an account twice, so nothing over them is a total or a lower bound. */
const pastCensus = (walk: WalkState): boolean => walk.stopped !== null && walk.stopKind === "over";

/**
 * The qualifier a walk-derived finding wears until the walk is complete: the
 * running register, the stopped register, or nothing over a settled book (and
 * nothing where no summary exists to qualify). A walk past its census claims
 * no bound: it says what its figures are not.
 */
export function walkQualifier(walk: WalkState | null): string {
  if (walk === null) return "";
  if (pastCensus(walk)) return " · the walk ran past its census, figures are not a bound";
  if (walk.stopped !== null) return " · the walk stopped, figures are a lower bound";
  return walk.settled ? "" : " · walking the book, figures are a lower bound";
}

/**
 * The note a walk-derived tile wears beside its figure until the walk is
 * complete — the tiles' short form of `walkQualifier`, in the same registers.
 */
export function tileBoundNote(walk: WalkState | null): string {
  if (walk === null || (walk.settled && walk.stopped === null)) return "";
  if (pastCensus(walk)) return " · not a bound, the walk ran past its census";
  return walk.stopped !== null ? " · lower bound, walk stopped" : " · lower bound, walking";
}

/** The attention card's finding: the table's order, under the walk's own qualifier. */
export function attentionFinding(walk: WalkState | null): string {
  return `Material first, then by room${walkQualifier(walk)}`;
}

/** The distance chart's finding as the parts the card renders: words, the emphasized figure, words. */
export interface BandsFinding {
  readonly lead: string;
  readonly figure: string;
  readonly rest: string;
  /** The bars' own qualifier while the walk is incomplete; null once every bar is the book's. */
  readonly barsNote: string | null;
}

/**
 * The distance chart's finding. Over a complete walk the figure within 10% of
 * the cap stands as read. Over an incomplete one — still running or stopped —
 * the chart carries two lower bounds and each wears its own qualifier: the
 * figure is a floor in its own words ("at least"), and the bars say that their
 * dollars and counts are. A walk past its census is the exception: its rows
 * may count an account twice, so the figure is what the walk landed — never
 * "at least" — and the bars say they bound nothing. A walk-derived zero is a
 * finding only once the walk is complete: before that it is a dash, never
 * "$0", and the clause after the dash names the walk's state without
 * qualifying a figure the sentence has just declined to print.
 */
export function bandsFinding(summary: Pick<CashSummary, "bands" | "decimals" | "settled" | "stopped" | "stopKind">): BandsFinding {
  const lead = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  const near = summary.bands.filter((b) => NEAR_CAP_BAND_IDS.has(b.id));
  const sum = near.reduce((s, b) => s + b.debt, 0n);
  const count = near.reduce((c, b) => c + b.count, 0);
  if (summary.settled) {
    return { lead, figure: humanUsd(sum, summary.decimals), rest: " sits within 10% of the cap", barsNote: null };
  }
  const over = pastCensus(summary);
  const barsNote = over
    ? "The walk ran past its census: its rows may count an account twice, so no bar or count here is a total or a lower bound."
    : summary.stopped !== null
      ? "The walk stopped: every bar and every count is a lower bound over the accounts it read."
      : "Walking the book: every bar and every count is a lower bound over the accounts read so far.";
  if (count === 0) {
    // The dash declines the figure, so the clause after it names the walk's state and qualifies no figure.
    const state = over ? "the walk ran past its census" : summary.stopped !== null ? "the walk stopped" : "the walk is still running";
    return { lead, figure: "—", rest: ` within 10% of the cap: a zero is claimed only by a complete walk · ${state}`, barsNote };
  }
  const figure = humanUsd(sum, summary.decimals);
  if (over) return { lead, figure, rest: ` sits within 10% of the cap among the rows the walk landed${walkQualifier(summary)}`, barsNote };
  return { lead: `${lead}at least `, figure, rest: ` sits within 10% of the cap${walkQualifier(summary)}`, barsNote };
}

/** A room band as the distance chart prints it: null where the walk cannot yet say. */
export interface BandSoFar {
  readonly id: string;
  readonly label: string;
  readonly count: number | null;
  readonly debt: bigint | null;
}

/**
 * The bands as the distance chart's bars print them, under the card's own
 * sentence: a zero is claimed only by a complete walk. Until then a band the
 * walk has read nothing in is unknown so far — no figure and no count, never
 * "$0 · 0" — and a band it has read in prints what it read, which the chart's
 * note names a lower bound. Once the walk is complete every band is the
 * book's, zeros included.
 */
export function bandsSoFar(summary: Pick<CashSummary, "bands" | "settled">): BandSoFar[] {
  return summary.bands.map((b) => ({
    id: b.id,
    label: b.label,
    count: summary.settled || b.count > 0 ? b.count : null,
    debt: summary.settled || b.debt > 0n ? b.debt : null,
  }));
}

/**
 * The attention table's line when it shows no row. "No account needs
 * attention" is a negative over the book: it is said only by a complete walk,
 * and never while the display line hides a liquidatable position behind the
 * toggle — that position is counted, not cleared.
 */
export function attentionEmptyText(summary: Pick<CashSummary, "settled" | "stopped" | "belowLine" | "decimals">): string {
  if (summary.stopped !== null) return "The walk stopped before the book was read; no account is cleared.";
  if (!summary.settled) return "Walking the book…";
  const n = summary.belowLine.count;
  if (n > 0) {
    return `Nothing material needs attention; ${String(n)} liquidatable position${n === 1 ? "" : "s"} under $${MATERIAL_LINE_USD.toString()} (${humanUsd(summary.belowLine.sum, summary.decimals)}) ${n === 1 ? "is" : "are"} behind the small & dust toggle.`;
  }
  return "No account needs attention.";
}

/** The book could not be fetched at all (503 no batch, transport) — distinct from an engine refusing. */
export function unavailableHeadline(reason: string): Headline {
  return {
    variant: "refused",
    tone: "refused",
    emphasis: "The Cash book could not be loaded.",
    rest: "",
    dek: asSentence(reason, "The service gave no reason."),
  };
}
