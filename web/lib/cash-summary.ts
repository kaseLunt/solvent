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
