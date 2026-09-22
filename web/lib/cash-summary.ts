import { asSentence, bookHeadline, bookHeadlineRefused, stopWords, type Headline, type Sum, type WalkStopKind } from "./book-headline";
import {
  liquidatableRows,
  NEAR_CAP_BAND_IDS,
  nearCapRows,
  roomBands,
  roomPercentiles,
  sumDebt,
  unreadableRows,
  type CashRow,
  type RoomBand,
  type SizedCashRow,
} from "./cash-rows";
import { humanUsd } from "./human-usd";
import { MATERIAL_LINE_USD, partitionByMateriality, type MaterialityPartition } from "./materiality";
import { groupInt, plural } from "./prose";
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
  /**
   * Rows the engine calls computed that this page could not read, among the rows the walk landed. Counted on their
   * own — the engine refused none of them — and never inside a negative, a zero or a total.
   */
  readonly unreadable: number;
  /** Accounts the walk read with a known verdict. */
  readonly computed: number;
  readonly liquidatable: MaterialityPartition<SizedCashRow>;
  readonly nearCapRows: SizedCashRow[];
  readonly bands: RoomBand[];
  readonly percentiles: { median: string | null; p10: string | null };
  /** The walk reached its last page; until then the figures are a lower bound. */
  readonly settled: boolean;
  /**
   * The book was read WHOLE: the walk is complete and every row it landed could be read. The only state in which a
   * zero is a finding, a sum is a total and a negative may be said — a complete walk holding an unreadable row is
   * settled and not whole, and its figures are a lower bound over the rows this page could read.
   */
  readonly whole: boolean;
  /** The walk stopped before it was complete, with this cause; no negative is claimed over the rest. */
  readonly stopped: string | null;
  /**
   * How that walk ended; null exactly when `stopped` is. A walk past its census ("over") landed accounts the census
   * does not count, and a walk served an account twice ("duplicate") did not partition the book: the figures of
   * either are what it landed and are never called a lower bound.
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
  const unreadable = unreadableRows(input.rows).length;
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
          unreadable,
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
    unreadable,
    computed,
    liquidatable,
    nearCapRows: near,
    bands: roomBands(input.rows),
    percentiles: roomPercentiles(input.rows),
    settled: input.walkComplete,
    whole: input.walkComplete && unreadable === 0,
    stopped,
    stopKind,
  };
}

type WalkState = Pick<CashSummary, "settled" | "stopped" | "stopKind" | "unreadable">;

/**
 * The registers a walk-derived figure is said in, decided once. "whole": the book was read whole, and nothing is
 * qualified. "running" and "stopped": distinct accounts were read, so every figure is a lower bound. "over" and
 * "duplicate": the walk ran past its census, or was served an account twice — no figure over its rows is a total or a
 * lower bound. "unreadable": the walk is complete and landed a row this page could not read — a lower bound over the
 * rows it could.
 */
type WalkRegister = "whole" | "running" | "stopped" | "over" | "duplicate" | "unreadable";

function registerOf(walk: WalkState): WalkRegister {
  if (walk.stopped !== null) return walk.stopKind === "over" || walk.stopKind === "duplicate" ? walk.stopKind : "stopped";
  if (!walk.settled) return "running";
  return walk.unreadable > 0 ? "unreadable" : "whole";
}

const rowsWord = (n: number): string => `${String(n)} row${n === 1 ? "" : "s"}`;

/**
 * The qualifier a walk-derived finding wears until the book is read whole: the
 * running register, the stopped register, the unreadable register, or nothing
 * over a book read whole (and nothing where no summary exists to qualify). A
 * walk past its census, or served an account twice, claims no bound: it says
 * what its figures are not.
 */
export function walkQualifier(walk: WalkState | null): string {
  if (walk === null) return "";
  const register = registerOf(walk);
  if (register === "over") return " · the walk ran past its census, figures are not a bound";
  if (register === "duplicate") return " · the walk was served an account twice, figures are not a bound";
  if (register === "stopped") return " · the walk stopped, figures are a lower bound";
  if (register === "running") return " · walking the book, figures are a lower bound";
  return register === "unreadable" ? ` · ${rowsWord(walk.unreadable)} could not be read, figures are a lower bound` : "";
}

/**
 * The note a walk-derived tile wears beside its figure until the book is read
 * whole — the tiles' short form of `walkQualifier`, in the same registers.
 */
export function tileBoundNote(walk: WalkState | null): string {
  if (walk === null) return "";
  const register = registerOf(walk);
  if (register === "over") return " · not a bound, the walk ran past its census";
  if (register === "duplicate") return " · not a bound, the walk was served an account twice";
  if (register === "stopped") return " · lower bound, walk stopped";
  if (register === "running") return " · lower bound, walking";
  return register === "unreadable" ? ` · lower bound, ${rowsWord(walk.unreadable)} unreadable` : "";
}

/** The liquidatable tile's label: the material line it headlines, from the one constant that places it. */
export const liquidatableTileLabel = `Liquidatable · ≥ $${MATERIAL_LINE_USD.toString()}`;

/**
 * The liquidatable tile's sub: the material accounts, the positions under the line, and — over a book read whole only —
 * the partition's total, the same liquidatable count the engine card carries. Short of a whole read no total is claimed:
 * the bound note keeps its place and says in which register the two counts stand.
 */
export function liquidatableTileSub(summary: Pick<CashSummary, "material" | "belowLine" | "whole">, boundNote: string): string {
  const counts = `${plural(summary.material.count, "account")} · ${groupInt(summary.belowLine.count)} more under $${MATERIAL_LINE_USD.toString()}`;
  const total = summary.whole ? ` · ${groupInt(summary.material.count + summary.belowLine.count)} in all` : "";
  return `${counts}${total}${boundNote}`;
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

/** What the distance chart's bars say of themselves in each register short of a book read whole. */
function barsNoteOf(register: Exclude<WalkRegister, "whole">, unreadable: number): string {
  if (register === "over") {
    return "The walk ran past its census: it landed more accounts than the book counts, so no bar or count here is a total or a lower bound.";
  }
  if (register === "duplicate") {
    return "The walk was served an account twice: pages that repeat an account do not partition the book, so no bar or count here is a total or a lower bound.";
  }
  if (register === "stopped") return "The walk stopped: every bar and every count is a lower bound over the accounts it read.";
  if (register === "running") return "Walking the book: every bar and every count is a lower bound over the accounts read so far.";
  return `${rowsWord(unreadable)} could not be read: every bar and every count is a lower bound over the accounts this page could read.`;
}

/** The state named after a declined zero, in each register short of a book read whole. */
function zeroStateOf(register: Exclude<WalkRegister, "whole">, unreadable: number): string {
  if (register === "over") return "the walk ran past its census";
  if (register === "duplicate") return "the walk was served an account twice";
  if (register === "stopped") return "the walk stopped";
  if (register === "running") return "the walk is still running";
  return `${rowsWord(unreadable)} could not be read`;
}

/**
 * The distance chart's finding. Over a book read whole the figure within 10%
 * of the cap stands as read. Short of that — a walk still running or stopped,
 * or a complete one that landed a row this page could not read — the chart
 * carries two lower bounds and each wears its own qualifier: the figure is a
 * floor in its own words ("at least"), and the bars say that their dollars and
 * counts are. A walk past its census, or served an account twice, is the
 * exception: no figure over its rows bounds the book, so the figure is what
 * the walk landed — never "at least" — and the bars say they bound nothing. A
 * walk-derived zero is a finding only over a book read whole: before that it
 * is a dash, never "$0", and the clause after the dash names the state
 * without qualifying a figure the sentence has just declined to print.
 */
export function bandsFinding(
  summary: Pick<CashSummary, "bands" | "decimals" | "settled" | "stopped" | "stopKind" | "unreadable">,
): BandsFinding {
  const lead = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  const near = summary.bands.filter((b) => NEAR_CAP_BAND_IDS.has(b.id));
  const sum = near.reduce((s, b) => s + b.debt, 0n);
  const count = near.reduce((c, b) => c + b.count, 0);
  const register = registerOf(summary);
  if (register === "whole") {
    return { lead, figure: humanUsd(sum, summary.decimals), rest: " sits within 10% of the cap", barsNote: null };
  }
  const barsNote = barsNoteOf(register, summary.unreadable);
  if (count === 0) {
    // The dash declines the figure, so the clause after it names the state and qualifies no figure.
    const law = register === "unreadable" ? "a zero is claimed only over a book read whole" : "a zero is claimed only by a complete walk";
    return { lead, figure: "—", rest: ` within 10% of the cap: ${law} · ${zeroStateOf(register, summary.unreadable)}`, barsNote };
  }
  const figure = humanUsd(sum, summary.decimals);
  if (register === "over" || register === "duplicate") {
    return { lead, figure, rest: ` sits within 10% of the cap among the rows the walk landed${walkQualifier(summary)}`, barsNote };
  }
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
 * sentence: a zero is claimed only over a book read whole. Until then a band
 * nothing has been read in is unknown so far — no figure and no count, never
 * "$0 · 0" — and a band the walk has read in prints what it read, which the
 * chart's note names a lower bound. An unreadable row sits in no band, and may
 * belong in any: only once the book is read whole is every band the book's,
 * zeros included.
 */
export function bandsSoFar(summary: Pick<CashSummary, "bands" | "whole">): BandSoFar[] {
  return summary.bands.map((b) => ({
    id: b.id,
    label: b.label,
    count: summary.whole || b.count > 0 ? b.count : null,
    debt: summary.whole || b.debt > 0n ? b.debt : null,
  }));
}

/**
 * The attention table's line when it shows no row. "No account needs
 * attention" is a negative over the book: it is said only over a book read
 * whole, and never while the display line hides a liquidatable position behind
 * the toggle — that position is counted, not cleared. A walk that did not
 * complete says how it ended, in the stop's own frame.
 */
export function attentionEmptyText(
  summary: Pick<CashSummary, "settled" | "stopped" | "stopKind" | "unreadable" | "belowLine" | "decimals">,
): string {
  if (summary.stopped !== null) return `${stopWords(summary.stopKind)}; no account is cleared.`;
  if (!summary.settled) return "Walking the book…";
  if (summary.unreadable > 0) return `${rowsWord(summary.unreadable)} could not be read; no account is cleared.`;
  const n = summary.belowLine.count;
  if (n > 0) {
    return `Nothing material needs attention; ${String(n)} liquidatable position${n === 1 ? "" : "s"} under $${MATERIAL_LINE_USD.toString()} (${humanUsd(summary.belowLine.sum, summary.decimals)}) ${n === 1 ? "is" : "are"} behind the small & dust toggle.`;
  }
  return "No account needs attention.";
}

/**
 * The entry card's one line about the walk, from the summary alone. A
 * walk-derived figure is the card's micro-stat only over a book read whole;
 * short of that the card says what happened — a stop in its own frame, never
 * one frame for every ending.
 */
export function walkEntryLine(summary: Pick<CashSummary, "settled" | "stopped" | "stopKind" | "unreadable" | "nearCap" | "decimals">): string {
  if (summary.stopped !== null) return stopWords(summary.stopKind);
  if (!summary.settled) return "Walking the book…";
  if (summary.unreadable > 0) return `${rowsWord(summary.unreadable)} of the book could not be read`;
  return `${humanUsd(summary.nearCap.sum, summary.decimals)} within 10% of cap`;
}

/**
 * The service answered `/v1/book` and the body is not a book: a read that
 * failed is "unavailable", an engine's refusal is "not computed", and this is
 * neither — the answer is here and cannot be read, named by what is wrong.
 */
export function unreadableHeadline(fault: string): Headline {
  const answered = "The service answered, and the body is not a book";
  const named = fault.trim();
  return {
    variant: "refused",
    tone: "refused",
    emphasis: "The Cash book's answer could not be read.",
    rest: "",
    dek: named.length === 0 ? `${answered}.` : asSentence(`${answered}: ${named}`, `${answered}.`),
  };
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
