import { bookHeadlineRefused, type Headline } from "./book-headline";
import type { CashBookReading } from "./cash-book";
import { summarizeCash, unavailableHeadline, type CashSummary } from "./cash-summary";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { humanUsd } from "./human-usd";
import { plainCause } from "./refusal-phrasebook";
import { stressPreview, type StressPreview } from "./stress-preview";
import { readWirePopulation, readWireScale, wireBigInt } from "./wireGuard";

/** A chip on the identity strip; structurally the kit's IdentityChip, kept out of the component layer. */
export interface ViewChip {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
}

/** A wire money field read for display: the figure, an absence, or the malformed field named. */
export type MoneyReading =
  | { readonly kind: "value"; readonly value: bigint; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly field: string };

const ABSENT: MoneyReading = { kind: "absent" };

/**
 * The only path from a wire money string to a printed figure: the decimal
 * guard first, so `""` and `"0x10"` are named as malformed rather than
 * coerced into a measured zero or a plausible number.
 */
export function readWireMoney(value: unknown, decimals: number, field: string): MoneyReading {
  if (value === null || value === undefined) return ABSENT;
  const big = typeof value === "string" ? wireBigInt(value) : null;
  if (big === null) return { kind: "malformed", field };
  return { kind: "value", value: big, text: humanUsd(big, decimals) };
}

/** What a tile or stat prints for a money reading: the figure, or the dash. Never a coerced zero. */
export const moneyText = (m: MoneyReading): string => (m.kind === "value" ? m.text : "—");

/** The sub line that names a malformed money field. */
export const malformedSub = (field: string): string => `${field} is not a wire decimal`;

export interface BadDebtView {
  readonly reading: MoneyReading;
  readonly insolvent: number | null;
  /** The wire's own refusal of the figure, in plain words. */
  readonly cause: string | null;
}

/**
 * Everything the Book and the Overview print about the Cash book, derived
 * ONCE from a reading (spec 2026-09-15 §5.1, §5.2). The laws live here so
 * both pages inherit them: a withheld engine yields NO summary (no tile,
 * band or row may print a walk-derived figure under a refused headline);
 * every wire population and scale is classified before it is read; every
 * money string passes the decimal guard before it is formatted; the snapshot
 * chip wears the ratified tier; unsettled figures say so, and a walk that
 * stopped is named rather than settled.
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
  /** The walk stopped before its last page, with this cause; derived figures are a lower bound and no negative is claimed. */
  readonly walkStopped: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
  /** The stress preview — refused with the engine's cause when the engine is withheld. */
  readonly preview: StressPreview | null;
  readonly debt: MoneyReading;
  readonly collateral: MoneyReading;
  /** Null when the book is unloaded, the engine withheld or absent, or the wire reports no bad-debt row. */
  readonly badDebt: BadDebtView | null;
  /** The Book entry card's micro-stat: a figure only once the walk is complete. */
  readonly bookEntryLine: string;
  /** The Scenarios entry card's micro-stat: the ETH −30% line, or the withheld preview named. */
  readonly previewLine: string;
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
  // Every scale and population is classified before it is read; the throwing reads land in the route boundary.
  const decimals = engine === null ? 6 : readWireScale(engine.value_decimals, "engines[debt_manager].value_decimals");

  const positions = engine === null ? null : readWirePopulation(engine.positions, "engines[debt_manager].positions");
  const computedPositions =
    engine === null ? null : readWirePopulation(engine.computed_positions, "engines[debt_manager].computed_positions");
  const refusedPositions =
    engine === null ? null : readWirePopulation(engine.refused_positions, "engines[debt_manager].refused_positions");
  const refusedTiles = !loaded || withheld !== null || engineAbsent;

  const summary =
    loaded && engine !== null && withheld === null
      ? summarizeCash({
          rows: cash.rows,
          decimals,
          refusedPositions: refusedPositions ?? 0,
          walkComplete: cash.walkComplete,
          walkStopped: cash.walkFailure === null ? null : cash.walkFailure.message,
          refusedWhole: null,
        })
      : null;

  const failureMessage =
    reading.failure === null
      ? null
      : reading.failure.retryAfterSeconds === null
        ? reading.failure.message
        : `${reading.failure.message} (retry after ${String(reading.failure.retryAfterSeconds)}s)`;
  const withheldCause = withheld === null ? null : plainCause(withheld.code, withheld.detail);
  const headline: Headline =
    reading.phase === "loading"
      ? LOADING
      : !loaded
        ? unavailableHeadline(failureMessage ?? "the service did not answer")
        : withheldCause !== null
          ? bookHeadlineRefused(withheldCause)
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
  const walkStopped = summary === null ? null : summary.stopped;
  const preview: StressPreview | null =
    withheldCause !== null
      ? { kind: "refused", reason: withheldCause }
      : reading.book === null || reading.book.waterfall === null
        ? null
        : stressPreview(reading.book.waterfall, "debt_manager", reading.book.coverage);

  const debt = refusedTiles || engine === null ? ABSENT : readWireMoney(engine.total_debt, decimals, "engines[debt_manager].total_debt");
  const collateral =
    refusedTiles || engine === null ? ABSENT : readWireMoney(engine.total_collateral, decimals, "engines[debt_manager].total_collateral");
  const badDebtWire = refusedTiles ? null : cash.badDebt;
  const badDebt: BadDebtView | null =
    badDebtWire === null
      ? null
      : {
          reading: readWireMoney(
            badDebtWire.current_bad_debt_usd,
            readWireScale(badDebtWire.usd_decimals, "bad_debt[debt_manager].usd_decimals"),
            "bad_debt[debt_manager].current_bad_debt_usd",
          ),
          insolvent:
            badDebtWire.insolvent_positions === null
              ? null
              : readWirePopulation(badDebtWire.insolvent_positions, "bad_debt[debt_manager].insolvent_positions"),
          cause: badDebtWire.refused ? plainCause(badDebtWire.refusal?.code ?? "", badDebtWire.refusal?.detail ?? "") : null,
        };

  // A walk-derived figure is the entry card's micro-stat only once the walk is complete; before that the card says what the walk is doing.
  const bookEntryLine =
    summary === null
      ? "Live figures"
      : summary.stopped !== null
        ? "Walk stopped before the book was read"
        : !summary.settled
          ? "Walking the book…"
          : `${humanUsd(summary.nearCap.sum, decimals)} within 10% of cap`;
  const previewLine =
    preview === null
      ? "Committed scenarios"
      : preview.kind === "view"
        ? (preview.lines.find((l) => l.shock === "ETH −30%")?.text ?? preview.lines[0]?.text ?? "Committed scenarios")
        : preview.kind === "refused"
          ? `Preview withheld: ${preview.reason}`
          : "Preview withheld: the Cash engine is not on this batch's stress grid";

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
    refusedTiles,
    walking,
    settled: summary !== null && cash.walkComplete,
    walkStopped,
    tier,
    ageSeconds,
    preview,
    debt,
    collateral,
    badDebt,
    bookEntryLine,
    previewLine,
  };
}

export interface LegacyBand {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** The legacy Aave v3 section, derived once: a withheld engine names its cause and prints no population, no debt, no histogram. */
export interface LegacyView {
  /** The engine's whole book is withheld, with this plain cause. */
  readonly withheld: string | null;
  readonly decimals: number;
  readonly positions: number | null;
  readonly computed: number | null;
  readonly liquidatable: number | null;
  readonly refused: number | null;
  readonly debt: MoneyReading;
  readonly eligibleDebt: MoneyReading;
  /** Null when the wire serves no histogram for the engine, or withholds it. */
  readonly bands: LegacyBand[] | null;
  /** The histogram alone is withheld, with this plain cause. */
  readonly histogramWithheld: string | null;
  /** The collapsed section's one line. */
  readonly summaryLine: string;
}

export function deriveLegacyView(legacy: CashBookReading["legacy"]): LegacyView | null {
  const engine = legacy.engine;
  if (engine === null) return null;
  const decimals = readWireScale(engine.value_decimals, "engines[aave_v3_etherfi].value_decimals");
  const withheld = legacy.refusedWhole === null ? null : plainCause(legacy.refusedWhole.code, legacy.refusedWhole.detail);
  if (withheld !== null) {
    // The aggregate's populations under a withheld engine are placeholders, not counts: none is read.
    return {
      withheld,
      decimals,
      positions: null,
      computed: null,
      liquidatable: null,
      refused: null,
      debt: ABSENT,
      eligibleDebt: ABSENT,
      bands: null,
      histogramWithheld: null,
      summaryLine: `Legacy · Aave v3 market — withheld this batch: ${withheld}`,
    };
  }
  // Every population is a wire integer: classified before render, never coerced.
  const positions = readWirePopulation(engine.positions, "engines[legacy].positions");
  const computed = readWirePopulation(engine.computed_positions, "engines[legacy].computed_positions");
  const liquidatable = readWirePopulation(engine.liquidatable_positions, "engines[legacy].liquidatable_positions");
  const refused = readWirePopulation(engine.refused_positions, "engines[legacy].refused_positions");
  const debt = readWireMoney(engine.total_debt, decimals, "engines[aave_v3_etherfi].total_debt");
  const badDebt = legacy.badDebt;
  const eligibleDebt =
    badDebt === null
      ? ABSENT
      : readWireMoney(
          badDebt.eligible_debt_usd,
          readWireScale(badDebt.usd_decimals, "bad_debt[aave_v3_etherfi].usd_decimals"),
          "bad_debt[aave_v3_etherfi].eligible_debt_usd",
        );
  const histogram = legacy.histogram;
  const histogramWithheld =
    histogram !== null && histogram.refused ? plainCause(histogram.refusal?.code ?? "", histogram.refusal?.detail ?? "") : null;
  const bands =
    histogram === null || histogramWithheld !== null
      ? null
      : histogram.buckets.map((b, i) => ({
          id: b.label,
          label: b.label,
          count: readWirePopulation(b.count, `hf_histogram[aave_v3_etherfi].buckets[${String(i)}].count`),
        }));
  const debtWord = debt.kind === "value" ? `${debt.text} debt` : debt.kind === "absent" ? "debt withheld" : "debt unreadable";
  return {
    withheld: null,
    decimals,
    positions,
    computed,
    liquidatable,
    refused,
    debt,
    eligibleDebt,
    bands,
    histogramWithheld,
    summaryLine: `Legacy · Aave v3 market — ${n(positions)} positions · ${debtWord} · ${String(liquidatable)} liquidatable · ${String(refused)} refused`,
  };
}
