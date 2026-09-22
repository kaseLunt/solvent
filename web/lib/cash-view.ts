import { bookHeadlineRefused, type Headline } from "./book-headline";
import type { CashBookReading } from "./cash-book";
import { CASH_ENGINE_MISSING } from "./cash-refusal";
import { summarizeCash, unavailableHeadline, unreadableHeadline, walkEntryLine, type CashSummary } from "./cash-summary";
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
  /** The chip's hover text: the detail its few words stand for. */
  readonly title?: string;
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
 * Why the Cash book's figures are absent — decided here, never in a component.
 * Four states that are not one another: a read still in flight has not
 * failed; a book that could not be fetched (or that does not list the engine)
 * refused nothing and computed nothing; an answer that is not a book is here
 * and cannot be read — "unreadable", never "unavailable"; an engine that
 * withheld its book did answer, and "not computed" is its word alone. A fetch
 * failure is never worded as an engine's refusal.
 */
export interface CashAbsence {
  readonly kind: "loading" | "unavailable" | "unreadable" | "not-computed";
  /** A tile's sub line. */
  readonly word: string;
  /** A card's one line. */
  readonly line: string;
}

const ABSENCE_LOADING: CashAbsence = { kind: "loading", word: "loading…", line: "Loading…" };
const ABSENCE_UNAVAILABLE: CashAbsence = { kind: "unavailable", word: "unavailable", line: "Unavailable." };
const ABSENCE_UNREADABLE: CashAbsence = { kind: "unreadable", word: "unreadable", line: "Unreadable." };
const ABSENCE_NOT_COMPUTED: CashAbsence = { kind: "not-computed", word: "not computed", line: "Not computed." };

/** The census clause for each absence: the count's place is never left to a zero. */
const CENSUS_WORDS: Record<CashAbsence["kind"], string> = {
  loading: "accounts loading…",
  unavailable: "accounts unavailable",
  unreadable: "accounts unreadable",
  "not-computed": "accounts withheld",
};

/** The sixth tile as the Book prints it: the positions with no verdict here, and why. */
export interface NotComputedTile {
  readonly value: string;
  readonly sub: string;
}

/**
 * Everything the Book and the Overview print about the Cash book, derived
 * ONCE from a reading (spec 2026-09-15 §5.1, §5.2). The laws live here so
 * both pages inherit them: a withheld engine yields NO summary and NO census
 * (no tile, band, row, chip or head may print a figure under a refused
 * headline — its card's counts are placeholders); why the figures are absent
 * is decided here, so a failed fetch is never worded as a refusal nor a read
 * in flight as a failure; every wire population and scale is classified
 * before it is read; every money string passes the decimal guard before it
 * is formatted; the snapshot chip wears the ratified tier; unsettled figures
 * say so, and a walk that stopped is named rather than settled.
 */
export interface CashView {
  readonly decimals: number;
  readonly loaded: boolean;
  /** The engine is missing from `engines[]` altogether — an anomaly rendered as unavailable, never as zero. */
  readonly engineAbsent: boolean;
  readonly withheld: { code: string; detail: string } | null;
  /**
   * The engine's census as `/v1/book` states it. All three are null while the
   * book is unread, when the engine is absent, and when it is withheld: a
   * withheld card keeps integer counts because the contract requires the
   * fields, and they are placeholders "whatever the position counts say" — so
   * they are never read, and never printed as a census.
   */
  readonly positions: number | null;
  readonly computedPositions: number | null;
  readonly refusedPositions: number | null;
  /** The Cash section head's qualifier: the engine, the chain, and the census — or why there is no census. */
  readonly sectionQualifier: string;
  /** Null while loading, on failure, when the engine is absent, and when it is withheld. */
  readonly summary: CashSummary | null;
  readonly headline: Headline;
  readonly chips: ViewChip[];
  /** Tiles render in the refused register (dashed, "—"): exactly when `absence` is not null. */
  readonly refusedTiles: boolean;
  /** Why the book's figures are absent, in the words every tile and card prints; null when they are served. */
  readonly absence: CashAbsence | null;
  /** The walk is still paging; derived figures are a lower bound. */
  readonly walking: boolean;
  readonly settled: boolean;
  /** The walk stopped before it was complete, with this cause; derived figures are what it read and no negative is claimed. */
  readonly walkStopped: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
  /** The stress preview — refused with the engine's cause when the engine is withheld. */
  readonly preview: StressPreview | null;
  readonly debt: MoneyReading;
  readonly collateral: MoneyReading;
  /** Null when the book is unloaded, the engine withheld or absent, or the wire reports no bad-debt row. */
  readonly badDebt: BadDebtView | null;
  /**
   * The "Not computed" tile. Its count is the engine's refused positions PLUS the rows the engine calls computed that
   * this page could not read — each in its own word in the sub line, because the engine refused none of the latter;
   * a dash where there is no census to count.
   */
  readonly notComputedTile: NotComputedTile;
  /** The Book entry card's micro-stat: a figure only over a book read whole. */
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

  // A withheld card's counts are placeholders, not a census: none is read, so none can print — and none can throw.
  const census = engine === null || withheld !== null ? null : engine;
  const positions = census === null ? null : readWirePopulation(census.positions, "engines[debt_manager].positions");
  const computedPositions =
    census === null ? null : readWirePopulation(census.computed_positions, "engines[debt_manager].computed_positions");
  const refusedPositions =
    census === null ? null : readWirePopulation(census.refused_positions, "engines[debt_manager].refused_positions");
  // The service answered and the body is not a book: neither a failed read nor an absence the wire stated.
  const unreadableAnswer = !loaded && reading.failure !== null && reading.failure.unreadable;
  // In flight before failed, the engine's own refusal before an engine the book does not list.
  const absence: CashAbsence | null =
    reading.phase === "loading"
      ? ABSENCE_LOADING
      : !loaded
        ? unreadableAnswer
          ? ABSENCE_UNREADABLE
          : ABSENCE_UNAVAILABLE
        : withheld !== null
          ? ABSENCE_NOT_COMPUTED
          : engineAbsent
            ? ABSENCE_UNAVAILABLE
            : null;
  const refusedTiles = absence !== null;

  const summary =
    loaded && engine !== null && withheld === null
      ? summarizeCash({
          rows: cash.rows,
          decimals,
          refusedPositions: refusedPositions ?? 0,
          walkComplete: cash.walkComplete,
          walkStopped: cash.walkFailure === null ? null : cash.walkFailure.message,
          walkStopKind: cash.walkFailure === null ? null : cash.walkStop,
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
        ? unreadableAnswer
          ? unreadableHeadline(failureMessage ?? "")
          : unavailableHeadline(failureMessage ?? "the service did not answer")
        : withheldCause !== null
          ? bookHeadlineRefused(withheldCause)
          : engineAbsent
            ? unavailableHeadline(CASH_ENGINE_MISSING)
            : (summary?.headline ?? LOADING);

  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, constants);
  const tierTone = (t: FreshnessTier | null): ViewChip["tone"] =>
    t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit";
  const coverage: ViewChip =
    computedPositions === null || positions === null
      ? { label: "Coverage", value: withheld !== null ? "withheld" : "unavailable", tone: "refused" }
      : { label: "Coverage", value: `${n(computedPositions)} / ${n(positions)} computed`, tone: "neutral" };
  // A later answer that could not be read did not replace this book: the strip says so, and names the fault on hover.
  const standing: ViewChip[] =
    reading.repairFault === null
      ? []
      : [{ label: "Re-read", value: "unreadable · this batch stands", tone: "warn", title: reading.repairFault }];
  const chips: ViewChip[] =
    reading.book === null
      ? [{ label: "Identity", value: reading.phase === "loading" ? "pending" : unreadableAnswer ? "unreadable" : "unavailable", tone: "refused" }]
      : [
          { label: "Batch", value: n(reading.book.batch.id) },
          {
            label: "Snapshot",
            value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(),
            tone: tierTone(tier),
          },
          coverage,
          { label: "Current", value: "not projected" },
          ...standing,
        ];
  const censusWords = positions !== null ? `${n(positions)} borrowing accounts` : CENSUS_WORDS[(absence ?? ABSENCE_UNAVAILABLE).kind];

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

  // A walk-derived figure is the entry card's micro-stat only over a book read whole; short of that the card says what happened to the walk.
  const bookEntryLine = summary === null ? "Live figures" : walkEntryLine(summary);

  // The withheld engine's cause first; then why there is no count at all; only a served census names its refusals —
  // and the rows this page could not read are counted with them, in their own word.
  const refusalKey = engine?.refusals[0]?.key;
  const unread = summary?.unreadable ?? 0;
  const refusedSub =
    refusedPositions === null
      ? (absence?.word ?? "")
      : refusalKey !== undefined
        ? plainCause(refusalKey)
        : refusedPositions === 0
          ? "nothing refused"
          : "cause not stated";
  const unreadSub = unread === 0 ? "" : ` · ${String(unread)} unreadable${walking ? " so far" : ""}`;
  const notComputedTile: NotComputedTile = {
    value: refusedPositions === null ? "—" : String(refusedPositions + unread),
    sub: withheldCause ?? `${refusedSub}${refusedPositions === null ? "" : unreadSub}`,
  };
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
    sectionQualifier: `Debt Manager engine · OP Mainnet · ${censusWords}`,
    summary,
    headline,
    chips,
    refusedTiles,
    absence,
    walking,
    settled: summary !== null && cash.walkComplete,
    walkStopped,
    tier,
    ageSeconds,
    preview,
    debt,
    collateral,
    badDebt,
    notComputedTile,
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
  // The line states the market's own finding over the positions it computed; with none computed no liquidatable
  // clause is said (a negative over nothing), and the population stands in its place. Never a Cash figure.
  const finding =
    computed > 0
      ? `${n(liquidatable)} of ${n(computed)} computed ${computed === 1 ? "position is" : "positions are"} liquidatable`
      : `${n(positions)} position${positions === 1 ? "" : "s"}`;
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
    summaryLine: `Legacy · Aave v3 market — ${finding} · ${debtWord} · ${n(refused)} refused`,
  };
}
