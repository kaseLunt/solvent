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

/**
 * The book was read whole and the engine computed none of its accounts: every one it served was refused on its own.
 * A walk-derived zero over it sums nothing and counts nothing, so no tile or line prints it as a finding — neither a
 * figure nor a count; each says that no account was computed. An empty book refused nothing, and its zero is its own.
 */
export function noneComputed(summary: Pick<CashSummary, "whole" | "computed" | "notComputed">): boolean {
  return summary.whole && summary.computed === 0 && summary.notComputed > 0;
}

/** What a tile says in place of a figure over a book the engine computed none of. */
export const NONE_COMPUTED_SUB = "no account computed";

/** The liquidatable tile's label: the material line it headlines, from the one constant that places it. */
export const liquidatableTileLabel = `Liquidatable · ≥ $${MATERIAL_LINE_USD.toString()}`;

/**
 * The liquidatable tile's sub: the material accounts, the positions under the line, and — over a book read whole only —
 * the partition's total, the same count as the batch aggregate's liquidatable_positions. Short of a whole read no total
 * is claimed: the bound note keeps its place and says in which register the two counts stand. A total is a finding only
 * over a computed population, and a zero total is said only where no refused account could sit inside it — the same
 * scope the headline gives its own negative. Over a book the engine computed none of, no count is said at all.
 */
export function liquidatableTileSub(
  summary: Pick<CashSummary, "material" | "belowLine" | "whole" | "computed" | "notComputed">,
  boundNote: string,
): string {
  if (noneComputed(summary)) return `${NONE_COMPUTED_SUB}${boundNote}`;
  const counts = `${plural(summary.material.count, "account")} · ${groupInt(summary.belowLine.count)} more under $${MATERIAL_LINE_USD.toString()}`;
  const inAll = summary.material.count + summary.belowLine.count;
  const stated = summary.whole && summary.computed > 0 && (inAll > 0 || summary.notComputed === 0);
  const total = stated ? ` · ${groupInt(inAll)} in all` : "";
  return `${counts}${total}${boundNote}`;
}

/** A tile's register, as the kit's tiles take it; kept out of the component layer. */
export type TileTone = "neutral" | "crit" | "warn" | "refused";

/** A tile as the Book prints it: decided here, printed by the component as given. */
export interface TileView {
  readonly value: string;
  readonly sub: string;
  readonly tone: TileTone;
  /** The figure is still being read: the tile shows its busy mark in place of the value. */
  readonly pending: boolean;
}

/** How a walk-derived tile is decided: the sum it prints, the register a counted sum wears, its sub line, and when it is busy. */
interface WalkTileRule {
  readonly figure: (s: CashSummary) => Sum;
  readonly foundTone: TileTone;
  readonly sub: (s: CashSummary, boundNote: string) => string;
  /** While the walk runs: busy throughout, or only until the walk has counted something. */
  readonly busy: "while-walking" | "until-counted";
}

/**
 * A walk-derived tile over one of the summary's sums, in every register. No summary: the absence's own word, refused.
 * A counted sum is printed in the tile's own register beside the bound note of the walk's register: a lower bound
 * while the walk runs, after it stopped, or beside a row this page could not read; neither a total nor a bound after a
 * walk ran past its census or was served an account twice; unqualified only over a book read whole. A zero is a
 * finding only over a book read whole, and never over one the engine computed none of: while the walk runs the tile
 * is busy, a walk that ended short of whole prints a dash in the refused register, and a book the engine computed none
 * of prints a dash and says that no account was computed.
 */
function walkTile(summary: CashSummary | null, absentWord: string, rule: WalkTileRule): TileView {
  if (summary === null) return { value: "—", sub: absentWord, tone: "refused", pending: false };
  const boundNote = tileBoundNote(summary);
  if (noneComputed(summary)) return { value: "—", sub: `${NONE_COMPUTED_SUB}${boundNote}`, tone: "refused", pending: false };
  const register = registerOf(summary);
  const { sum, count } = rule.figure(summary);
  return {
    value: count > 0 || register === "whole" ? humanUsd(sum, summary.decimals) : "—",
    sub: rule.sub(summary, boundNote),
    tone: count > 0 ? rule.foundTone : register === "whole" || register === "running" ? "neutral" : "refused",
    pending: register === "running" && (rule.busy === "while-walking" || count === 0),
  };
}

/** The liquidatable tile: the material sum in the crit register, over the partition's counts. */
export function liquidatableTile(summary: CashSummary | null, absentWord: string): TileView {
  return walkTile(summary, absentWord, { figure: (s) => s.material, foundTone: "crit", sub: liquidatableTileSub, busy: "until-counted" });
}

/** The near-cap tile: the debt within 10% of the cap in the warn register, over its accounts. */
export function nearCapTile(summary: CashSummary | null, absentWord: string): TileView {
  return walkTile(summary, absentWord, {
    figure: (s) => s.nearCap,
    foundTone: "warn",
    sub: (s, boundNote) => `${plural(s.nearCap.count, "account")}${boundNote}`,
    busy: "while-walking",
  });
}

/**
 * The median-room tile: the lower median of the room the walk read, beside its 10th percentile, busy while the walk
 * runs. No summary: the absence's own word, refused. A stopped walk says so in place of a figure. Over a book the
 * engine computed none of no room was read: a dash in the refused register, saying that no account was computed —
 * never the neutral dash of a book with no account in it.
 */
export function medianRoomTile(summary: CashSummary | null, absentWord: string): TileView {
  if (summary === null) return { value: "—", sub: absentWord, tone: "refused", pending: false };
  if (summary.stopped !== null) return { value: "—", sub: "walk stopped", tone: "refused", pending: false };
  if (noneComputed(summary)) return { value: "—", sub: NONE_COMPUTED_SUB, tone: "refused", pending: false };
  const { median, p10 } = summary.percentiles;
  return {
    value: median ?? "—",
    sub: p10 === null ? "of borrow cap" : `of borrow cap · 10th pct ${p10}`,
    tone: "neutral",
    pending: registerOf(summary) === "running",
  };
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
  /**
   * The bars' own note wherever a bar is not the book's figure — a walk short of whole, or a book the engine computed
   * none of; null once every bar is the book's.
   */
  readonly barsNote: string | null;
}

/** What the distance chart's bars say of themselves over a book the engine computed none of. */
const BARS_NONE_COMPUTED =
  "No account was computed this batch: the bands group computed accounts only, so no bar holds a figure or a count.";

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
 * without qualifying a figure the sentence has just declined to print. Over
 * a book read whole that the engine computed none of, the bands hold no
 * computed account, so their zero is no finding either: the figure is a dash,
 * the clause says that no account was computed, and the bars say the same.
 */
export function bandsFinding(
  summary: Pick<
    CashSummary,
    "bands" | "decimals" | "settled" | "whole" | "stopped" | "stopKind" | "unreadable" | "computed" | "notComputed"
  >,
): BandsFinding {
  const lead = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  if (noneComputed(summary)) {
    return { lead, figure: "—", rest: ` within 10% of the cap: ${NONE_COMPUTED_SUB}`, barsNote: BARS_NONE_COMPUTED };
  }
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
 * zeros included — unless the engine computed none of it. The bands group
 * computed accounts only, so over such a book every band's zero counts
 * nothing, and no bar prints one.
 */
export function bandsSoFar(summary: Pick<CashSummary, "bands" | "whole" | "computed" | "notComputed">): BandSoFar[] {
  const zerosAreFindings = summary.whole && !noneComputed(summary);
  return summary.bands.map((b) => ({
    id: b.id,
    label: b.label,
    count: zerosAreFindings || b.count > 0 ? b.count : null,
    debt: zerosAreFindings || b.debt > 0n ? b.debt : null,
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
 * The near-cap fold's label: the rows the attention table hides and their debt. It counts only rows the page holds,
 * so it grows with the walk and claims no total — never "all N", which a tile still walking refuses to state.
 */
export function nearCapToggleLabel(hidden: readonly SizedCashRow[], decimals: number): string {
  const n = hidden.length;
  return `Show ${groupInt(n)} more near-cap account${n === 1 ? "" : "s"} (${humanUsd(sumDebt(hidden), decimals)})`;
}

/** The small & dust fold's label: the positions under the line the table hides, and their debt together. */
export function belowLineToggleLabel(count: number, sum: bigint, decimals: number): string {
  return `Show ${groupInt(count)} small & dust position${count === 1 ? "" : "s"} (${humanUsd(sum, decimals)})`;
}

/**
 * The entry card's one line about the walk, from the summary alone. A
 * walk-derived figure is the card's micro-stat only over a book read whole;
 * short of that the card says what happened — a stop in its own frame, never
 * one frame for every ending — and over a book the engine computed none of,
 * that no account could be computed.
 */
export function walkEntryLine(
  summary: Pick<CashSummary, "settled" | "whole" | "stopped" | "stopKind" | "unreadable" | "computed" | "notComputed" | "nearCap" | "decimals">,
): string {
  if (summary.stopped !== null) return stopWords(summary.stopKind);
  if (!summary.settled) return "Walking the book…";
  if (summary.unreadable > 0) return `${rowsWord(summary.unreadable)} of the book could not be read`;
  if (noneComputed(summary)) return "No account could be computed this batch";
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
