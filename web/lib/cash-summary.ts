import { bookHeadline, bookHeadlineRefused, type Headline, type Sum } from "./book-headline";
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
import { partitionByMateriality, type MaterialityPartition } from "./materiality";
import { plainCause } from "./refusal-phrasebook";

export interface CashSummaryInput {
  readonly rows: readonly CashRow[];
  readonly decimals: number;
  readonly refusedPositions: number;
  readonly walkComplete: boolean;
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
  readonly liquidatable: MaterialityPartition<SizedCashRow>;
  readonly nearCapRows: SizedCashRow[];
  readonly bands: RoomBand[];
  readonly percentiles: { median: string | null; p10: string | null };
  /** The walk reached its last page; until then the figures are a lower bound. */
  readonly settled: boolean;
}

export function summarizeCash(input: CashSummaryInput): CashSummary {
  const liquidatable = partitionByMateriality(liquidatableRows(input.rows), input.decimals);
  const near = nearCapRows(input.rows);
  const material: Sum = { sum: liquidatable.sums.material, count: liquidatable.counts.material };
  const belowLine: Sum = { sum: liquidatable.sums.belowLine, count: liquidatable.counts.belowLine };
  const nearCap: Sum = { sum: sumDebt(near), count: near.length };
  const headline =
    input.refusedWhole !== null
      ? bookHeadlineRefused(plainCause(input.refusedWhole.code, input.refusedWhole.detail))
      : bookHeadline({ decimals: input.decimals, material, belowLine, nearCap, notComputed: input.refusedPositions });
  return {
    decimals: input.decimals,
    headline,
    material,
    belowLine,
    nearCap,
    notComputed: input.refusedPositions,
    liquidatable,
    nearCapRows: near,
    bands: roomBands(input.rows),
    percentiles: roomPercentiles(input.rows),
    settled: input.walkComplete,
  };
}

/** The book could not be fetched at all (503 no batch, transport) — distinct from an engine refusing. */
export function unavailableHeadline(reason: string): Headline {
  const trimmed = reason.trim();
  const dek =
    trimmed.length === 0
      ? "The service gave no reason."
      : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
  return { variant: "refused", tone: "refused", emphasis: "The Cash book could not be loaded.", rest: "", dek };
}
