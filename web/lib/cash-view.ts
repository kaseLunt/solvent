import { bookHeadlineRefused, type Headline } from "./book-headline";
import type { CashBookReading } from "./cash-book";
import { summarizeCash, unavailableHeadline, type CashSummary } from "./cash-summary";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { plainCause } from "./refusal-phrasebook";
import { stressPreview, type StressPreview } from "./stress-preview";
import { readWirePopulation } from "./wireGuard";

/** A chip on the identity strip; structurally the kit's IdentityChip, kept out of the component layer. */
export interface ViewChip {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
}

/**
 * Everything the Book and the Overview print about the Cash book, derived
 * ONCE from a reading (spec 2026-09-15 §5.1, §5.2). The laws live here so
 * both pages inherit them: a withheld engine yields NO summary (no tile,
 * band or row may print a walk-derived figure under a refused headline);
 * every wire population is classified before it is read; the snapshot chip
 * wears the ratified tier; unsettled figures say so.
 */
export interface CashView {
  readonly decimals: number;
  readonly loaded: boolean;
  /** The engine is missing from `engines[]` altogether — an anomaly rendered as unavailable, never as zero. */
  readonly engineAbsent: boolean;
  readonly withheld: { code: string; detail: string } | null;
  readonly positions: number | null;
  readonly computedPositions: number | null;
  readonly refusedPositions: number | null;
  /** Null while loading, on failure, when the engine is absent, and when it is withheld. */
  readonly summary: CashSummary | null;
  readonly headline: Headline;
  readonly chips: ViewChip[];
  /** Tiles render in the refused register (dashed, "—"). */
  readonly refusedTiles: boolean;
  /** The walk is still paging; derived figures are a lower bound. */
  readonly walking: boolean;
  readonly settled: boolean;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
  readonly preview: StressPreview | null;
}

const LOADING: Headline = {
  variant: "refused",
  tone: "refused",
  emphasis: "Loading the Cash book…",
  rest: "",
  dek: "Fetching the newest batch.",
};

const n = (value: number): string => value.toLocaleString("en-US");

export function deriveCashView(reading: CashBookReading, constants: TierConstants): CashView {
  const cash = reading.cash;
  const loaded = reading.phase === "ok";
  const engine = cash.engine;
  const engineAbsent = loaded && engine === null;
  const withheld = cash.refusedWhole;
  const decimals = engine?.value_decimals ?? 6;

  const positions = engine === null ? null : readWirePopulation(engine.positions, "engines[debt_manager].positions");
  const computedPositions =
    engine === null ? null : readWirePopulation(engine.computed_positions, "engines[debt_manager].computed_positions");
  const refusedPositions =
    engine === null ? null : readWirePopulation(engine.refused_positions, "engines[debt_manager].refused_positions");

  const summary =
    loaded && engine !== null && withheld === null
      ? summarizeCash({
          rows: cash.rows,
          decimals,
          refusedPositions: refusedPositions ?? 0,
          walkComplete: cash.walkComplete,
          refusedWhole: null,
        })
      : null;

  const failureMessage =
    reading.failure === null
      ? null
      : reading.failure.retryAfterSeconds === null
        ? reading.failure.message
        : `${reading.failure.message} (retry after ${String(reading.failure.retryAfterSeconds)}s)`;
  const headline: Headline =
    reading.phase === "loading"
      ? LOADING
      : !loaded
        ? unavailableHeadline(failureMessage ?? "the service did not answer")
        : withheld !== null
          ? bookHeadlineRefused(plainCause(withheld.code, withheld.detail))
          : engineAbsent
            ? unavailableHeadline("the Cash engine is missing from this batch")
            : (summary?.headline ?? LOADING);

  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, constants);
  const tierTone = (t: FreshnessTier | null): ViewChip["tone"] =>
    t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit";
  const chips: ViewChip[] =
    reading.book === null
      ? [{ label: "Identity", value: reading.phase === "loading" ? "pending" : "unavailable", tone: "refused" }]
      : [
          { label: "Batch", value: n(reading.book.batch.id) },
          {
            label: "Snapshot",
            value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(),
            tone: tierTone(tier),
          },
          {
            label: "Coverage",
            value:
              computedPositions === null || positions === null
                ? "unavailable"
                : `${n(computedPositions)} / ${n(positions)} computed`,
            tone: computedPositions === null ? "refused" : "neutral",
          },
          { label: "Current", value: "not projected" },
        ];

  const walking = summary !== null && !cash.walkComplete && cash.walkFailure === null;
  const preview =
    reading.book === null || reading.book.waterfall === null ? null : stressPreview(reading.book.waterfall, "debt_manager");

  return {
    decimals,
    loaded,
    engineAbsent,
    withheld,
    positions,
    computedPositions,
    refusedPositions,
    summary,
    headline,
    chips,
    refusedTiles: !loaded || withheld !== null || engineAbsent,
    walking,
    settled: summary !== null && cash.walkComplete,
    tier,
    ageSeconds,
    preview,
  };
}
