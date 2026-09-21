import { asSentence, bookHeadline, bookHeadlineRefused, type Headline, type Sum } from "./book-headline";
import {
  liquidatableRows,
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
  /** The walk stopped before its last page, with this cause. */
  readonly walkStopped: string | null;
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
  /** The walk stopped before its last page, with this cause; the figures are a lower bound and no negative is claimed. */
  readonly stopped: string | null;
}

export function summarizeCash(input: CashSummaryInput): CashSummary {
  const liquidatable = partitionByMateriality(liquidatableRows(input.rows), input.decimals);
  const near = nearCapRows(input.rows);
  const material: Sum = { sum: liquidatable.sums.material, count: liquidatable.counts.material };
  const belowLine: Sum = { sum: liquidatable.sums.belowLine, count: liquidatable.counts.belowLine };
  const nearCap: Sum = { sum: sumDebt(near), count: near.length };
  const computed = input.rows.filter((r) => r.computed).length;
  const stopped = input.walkComplete ? null : input.walkStopped;
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
  };
}

type WalkState = Pick<CashSummary, "settled" | "stopped">;

/**
 * The qualifier a walk-derived finding wears until the walk is complete: the
 * running register, the stopped register, or nothing over a settled book (and
 * nothing where no summary exists to qualify).
 */
export function walkQualifier(walk: WalkState | null): string {
  if (walk === null) return "";
  if (walk.stopped !== null) return " · the walk stopped, figures are a lower bound";
  return walk.settled ? "" : " · walking the book, figures are a lower bound";
}

/** The room bands that sit within 10% of the borrow cap. */
const NEAR_BAND_IDS: ReadonlySet<string> = new Set(["0-2", "2-5", "5-10"]);

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
 * dollars and counts are. A walk-derived zero is a finding only once the walk
 * is complete: before that it is a dash, never "$0".
 */
export function bandsFinding(summary: Pick<CashSummary, "bands" | "decimals" | "settled" | "stopped">): BandsFinding {
  const lead = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  const near = summary.bands.filter((b) => NEAR_BAND_IDS.has(b.id));
  const sum = near.reduce((s, b) => s + b.debt, 0n);
  const count = near.reduce((c, b) => c + b.count, 0);
  if (summary.settled) {
    return { lead, figure: humanUsd(sum, summary.decimals), rest: " sits within 10% of the cap", barsNote: null };
  }
  const qualifier = walkQualifier(summary);
  const barsNote =
    summary.stopped !== null
      ? "The walk stopped: every bar and every count is a lower bound over the accounts it read."
      : "Walking the book: every bar and every count is a lower bound over the accounts read so far.";
  if (count === 0) {
    return { lead, figure: "—", rest: ` within 10% of the cap: a zero is claimed only by a complete walk${qualifier}`, barsNote };
  }
  return { lead: `${lead}at least `, figure: humanUsd(sum, summary.decimals), rest: ` sits within 10% of the cap${qualifier}`, barsNote };
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
