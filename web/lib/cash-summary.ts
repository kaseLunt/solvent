import { asSentence, bookHeadline, bookHeadlineRefused, stopWords, type Headline, type Sum, type WalkStopKind } from "./book-headline";
import {
  liquidatableRows,
  NEAR_CAP_BAND_IDS,
  nearCapRows,
  refusedDebtUnserved,
  roomBands,
  roomPercentiles,
  sumDebt,
  unreadableRows,
  type CashRow,
  type RoomBand,
  type SizedCashRow,
} from "./cash-rows";
import { humanUsd } from "./human-usd";
import type { StateRegister } from "./kit";
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
          refusedDebtUnserved: refusedDebtUnserved(input.rows),
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
export const NONE_COMPUTED_SUB = "No account computed";

/** The state word of the engine-refused population — the tile, the row's pill and the dek say the same two words. */
export const NO_VERDICT = "No verdict";

/** The median room's word over computed accounts none of which has a borrow cap: a room is a share of a cap. */
export const ROOM_NOT_MEASURABLE = "Not measurable";

/** What the median room tile says beneath that word. */
export const ROOM_NOT_MEASURABLE_SUB = "No account has a borrow cap to measure room against";

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
  /** The figure; empty where the tile states an absence instead. */
  readonly value: string;
  readonly sub: string;
  readonly tone: TileTone;
  /** The figure is still being read: the tile shows its busy mark in place of the value. */
  readonly pending: boolean;
  /**
   * The tile has no figure, and says which absence it is (lib/kit STATE_REGISTERS): the register draws the frame and
   * the value slot prints its word — never a dash, never a zero.
   */
  readonly state?: StateRegister;
  /** The lib's own word for that absence ("No verdict", "Withheld"); absent, the register's word prints. */
  readonly stateWord?: string;
}

/**
 * The tone a tile with no figure carries: the refused and unreadable registers are the grammar's refused row; an
 * unavailable, pending or not-served figure refused nothing, and carries none of it.
 */
export function stateTone(state: StateRegister): TileTone {
  return state === "refused" || state === "unreadable" ? "refused" : "neutral";
}

/** The tile over a book the engine computed none of: no figure; the population's word, and why. */
export const NONE_COMPUTED_TILE: TileView = { value: "", sub: NONE_COMPUTED_SUB, tone: "refused", pending: false, state: "refused", stateWord: NO_VERDICT };

/**
 * The register of a tile that declines its figure short of a book read whole: the walk ended short of it — stopped,
 * past its census, or served an account twice — so the figure is unavailable; or it landed a row this page could not
 * read, so the figure is unreadable. A dash is never the answer.
 */
function declinedState(register: Exclude<WalkRegister, "whole" | "running">): StateRegister {
  return register === "unreadable" ? "unreadable" : "unavailable";
}

/** What a tile with no figure says of the walk short of a book read whole, in a sub line's own words. */
function declinedSub(register: Exclude<WalkRegister, "whole" | "running">, unreadable: number): string {
  if (register === "over") return "Walk ran past its census";
  if (register === "duplicate") return "Walk served an account twice";
  if (register === "unreadable") return `${rowsWord(unreadable)} unreadable`;
  return "Walk stopped";
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
 * A walk-derived tile over one of the summary's sums, in every register. (No summary is the view's to word: the tile
 * then states the absence the view decided.) A counted sum is printed in the tile's own register beside the bound note
 * of the walk's register: a lower bound while the walk runs, after it stopped, or beside a row this page could not
 * read; neither a total nor a bound after a walk ran past its census or was served an account twice; unqualified only
 * over a book read whole. A zero is a finding only over a book read whole, and never over one the engine computed none
 * of: while the walk runs the tile is busy; a walk that ended short of whole prints no figure — the unavailable
 * register, or the unreadable one beside a row this page could not read; and a book the engine computed none of prints
 * the population's word, "No verdict", and says that no account was computed.
 */
function walkTile(summary: CashSummary, rule: WalkTileRule): TileView {
  if (noneComputed(summary)) return NONE_COMPUTED_TILE;
  const boundNote = tileBoundNote(summary);
  const register = registerOf(summary);
  const { sum, count } = rule.figure(summary);
  const sub = rule.sub(summary, boundNote);
  if (count > 0 || register === "whole") {
    return { value: humanUsd(sum, summary.decimals), sub, tone: count > 0 ? rule.foundTone : "neutral", pending: register === "running" && rule.busy === "while-walking" };
  }
  if (register === "running") return { value: "", sub, tone: "neutral", pending: true };
  const state = declinedState(register);
  return { value: "", sub, tone: stateTone(state), pending: false, state };
}

/** The liquidatable tile: the material sum in the crit register, over the partition's counts. */
export function liquidatableTile(summary: CashSummary): TileView {
  return walkTile(summary, { figure: (s) => s.material, foundTone: "crit", sub: liquidatableTileSub, busy: "until-counted" });
}

/** The near-cap tile: the debt within 10% of the cap in the warn register, over its accounts. */
export function nearCapTile(summary: CashSummary): TileView {
  return walkTile(summary, {
    figure: (s) => s.nearCap,
    foundTone: "warn",
    sub: (s, boundNote) => `${plural(s.nearCap.count, "account")}${boundNote}`,
    busy: "while-walking",
  });
}

/**
 * The median-room tile: the lower median of the room the walk read, beside its 10th percentile, at one fixed decimal,
 * busy while the walk runs. (No summary is the view's to word.) A walk that ended short of whole says so in place of a
 * figure. Over a book the engine computed none of no room was read: the population's word, "No verdict". An empty book
 * refused nothing and holds no room to measure: it says so, in ink — never a dash. A book whose computed accounts all
 * carry no borrow cap holds accounts and no room to take a median of: "Not measurable", in the unavailable register —
 * never "No accounts", and never a refusal, since the engine refused none of them.
 */
export function medianRoomTile(summary: CashSummary): TileView {
  const register = registerOf(summary);
  if (register === "stopped" || register === "over" || register === "duplicate") {
    return { value: "", sub: declinedSub(register, summary.unreadable), tone: "neutral", pending: false, state: "unavailable" };
  }
  if (noneComputed(summary)) return NONE_COMPUTED_TILE;
  const { median, p10 } = summary.percentiles;
  if (median === null) {
    if (register === "running") return { value: "", sub: "Of borrow cap", tone: "neutral", pending: true };
    if (register === "whole") {
      if (summary.computed === 0) return { value: "No accounts", sub: "No room to measure", tone: "neutral", pending: false };
      return { value: "", sub: ROOM_NOT_MEASURABLE_SUB, tone: stateTone("unavailable"), pending: false, state: "unavailable", stateWord: ROOM_NOT_MEASURABLE };
    }
    const state = declinedState(register);
    return { value: "", sub: declinedSub(register, summary.unreadable), tone: stateTone(state), pending: false, state };
  }
  return {
    value: median,
    sub: p10 === null ? "Of borrow cap" : `Of borrow cap · 10th pct ${p10}`,
    tone: "neutral",
    pending: register === "running",
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
    "bands" | "decimals" | "settled" | "whole" | "stopped" | "stopKind" | "unreadable" | "computed" | "notComputed" | "belowLine"
  >,
): BandsFinding {
  const lead = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  if (noneComputed(summary)) {
    return { lead, figure: "—", rest: " within 10% of the cap: no account computed", barsNote: BARS_NONE_COMPUTED };
  }
  const near = summary.bands.filter((b) => NEAR_CAP_BAND_IDS.has(b.id));
  const sum = near.reduce((s, b) => s + b.debt, 0n);
  const count = near.reduce((c, b) => c + b.count, 0);
  const register = registerOf(summary);
  if (register === "whole") {
    // The over-cap bar holds every liquidatable account; the headline counts the material ones: the clause reconciles the two.
    const below = summary.belowLine.count;
    const reconcile = below === 0 ? "" : ` · the over-cap bar includes the ${plural(below, "account")} under $${MATERIAL_LINE_USD.toString()}`;
    return { lead, figure: humanUsd(sum, summary.decimals), rest: ` sits within 10% of the cap${reconcile}`, barsNote: null };
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

/** A bar of the Book's distance chart: the band's name, its figure and count (null where the walk cannot yet say), its tone. */
export interface BookBar {
  readonly id: string;
  readonly label: string;
  readonly count: number | null;
  readonly value: bigint | null;
  readonly tone: "crit" | "warn" | "neutral";
}

/** The Book's names for the bands its bars stand for; a band not named here keeps the headroom vocabulary's label. */
const BOOK_BAND_LABEL: Readonly<Record<string, string>> = { breached: "Over cap", "0-2": "< 2% room", "50-plus": "≥ 50% room" };

/**
 * The Book's bars: the bands as `bandsSoFar` prints them, each named — the breached band is "Over cap", the band's
 * name — and toned: over cap crit, within 10% of the cap warn, the rest ink.
 */
export function bookBars(summary: Pick<CashSummary, "bands" | "whole" | "computed" | "notComputed">): BookBar[] {
  return bandsSoFar(summary).map((b) => ({
    id: b.id,
    label: BOOK_BAND_LABEL[b.id] ?? b.label,
    count: b.count,
    value: b.debt,
    tone: b.id === "breached" ? "crit" : NEAR_CAP_BAND_IDS.has(b.id) ? "warn" : "neutral",
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
    return `Nothing material needs attention; ${plural(n, "liquidatable account")} under $${MATERIAL_LINE_USD.toString()} (${humanUsd(summary.belowLine.sum, summary.decimals)}) ${n === 1 ? "is" : "are"} folded under the toggle below.`;
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

/** The fold under the materiality line: the accounts under it the table hides, and their debt together. */
export function belowLineToggleLabel(count: number, sum: bigint, decimals: number): string {
  return `Show ${plural(count, "account")} under $${MATERIAL_LINE_USD.toString()} (${humanUsd(sum, decimals)})`;
}

/**
 * The Overview's live line: one line of facts over a book read whole, its clauses joined with " · " and each omitted
 * when zero — the accounts under the $100 line, those within 10% of their cap, those with no verdict. Null short of a
 * whole read, over a book the engine computed none of, and when every clause is zero: the headline's dek speaks then.
 */
export function overviewLiveLine(summary: CashSummary): string | null {
  if (!summary.whole || noneComputed(summary)) return null;
  const money = (sum: bigint): string => humanUsd(sum, summary.decimals);
  const below = summary.belowLine;
  const near = summary.nearCap;
  const line = `$${MATERIAL_LINE_USD.toString()} line`;
  const clauses = [
    below.count === 0
      ? null
      : `${groupInt(below.count)} ${summary.material.count > 0 ? "more" : "liquidatable"} under the ${line} (${money(below.sum)}${below.count === 1 ? "" : " together"})`,
    near.count === 0 ? null : `${plural(near.count, "account")} within 10% of ${near.count === 1 ? "its" : "their"} cap (${money(near.sum)})`,
    summary.notComputed === 0 ? null : `${groupInt(summary.notComputed)} with no verdict`,
  ].filter((clause): clause is string => clause !== null);
  return clauses.length === 0 ? null : clauses.join(" · ");
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
    tone: "absent",
    emphasis: "The Cash book's answer could not be read.",
    rest: "",
    dek: named.length === 0 ? `${answered}.` : asSentence(`${answered}: ${named}`, `${answered}.`),
  };
}

/** The book could not be fetched at all (503 no batch, transport) — distinct from an engine refusing. */
export function unavailableHeadline(reason: string): Headline {
  return {
    variant: "refused",
    tone: "absent",
    emphasis: "The Cash book could not be loaded.",
    rest: "",
    dek: asSentence(reason, "The service gave no reason."),
  };
}
