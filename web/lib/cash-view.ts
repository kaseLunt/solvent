import { bookHeadlineRefused, type Headline } from "./book-headline";
import type { CashBookReading } from "./cash-book";
import { BAD_DEBT_NOT_REPORTED, CASH_ENGINE_MISSING } from "./cash-refusal";
import {
  liquidatableTile,
  liquidatableTileLabel,
  medianRoomTile,
  nearCapTile,
  NO_VERDICT,
  NONE_COMPUTED_TILE,
  overviewLiveLine,
  stateTone,
  summarizeCash,
  unavailableHeadline,
  unreadableHeadline,
  walkEntryLine,
  type CashSummary,
  type TileTone,
  type TileView,
} from "./cash-summary";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { humanUsd } from "./human-usd";
import type { StateRegister } from "./kit";
import { plural } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { stressPreview, type StressPreview } from "./stress-preview";
import { readWirePopulation, readWireScale, wireBigInt } from "./wireGuard";

/** A chip on the identity strip; structurally the kit's IdentityChip, kept out of the component layer. */
export interface ViewChip {
  readonly label: string;
  /** The chip's value; empty for a label-only chip, which states its whole phrase and bolds none of it. */
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

/** A money reading as a sentence prints it: the figure, or the dash. Never a coerced zero. */
export const moneyText = (m: MoneyReading): string => (m.kind === "value" ? m.text : "—");

/** The sub line that names a malformed money field. */
export const malformedSub = (field: string): string => `${field} is not a wire decimal`;

/** A standalone line starts with a capital; the words the wire and the phrasebook give are mid-sentence words. */
const sentenceCase = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The word a figure's place prints when the book served no figure there, and no refusal said why. */
const NOT_REPORTED = "Not reported";

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
 * withheld its book did answer, and "withheld" is its word alone. A fetch
 * failure is never worded as an engine's refusal, nor drawn in its register.
 */
export interface CashAbsence {
  readonly kind: "loading" | "unavailable" | "unreadable" | "withheld";
  /** The register a tile with no figure is drawn in (lib/kit STATE_REGISTERS). */
  readonly state: StateRegister;
  /** What a figure's place prints: the register's word, or "…" while the read is in flight. */
  readonly word: string;
  /** A card's one line. */
  readonly line: string;
}

const ABSENCE_LOADING: CashAbsence = { kind: "loading", state: "pending", word: "…", line: "Loading…" };
const ABSENCE_UNAVAILABLE: CashAbsence = { kind: "unavailable", state: "unavailable", word: "Unavailable", line: "Unavailable." };
const ABSENCE_UNREADABLE: CashAbsence = { kind: "unreadable", state: "unreadable", word: "Unreadable", line: "Unreadable." };
const ABSENCE_WITHHELD: CashAbsence = { kind: "withheld", state: "refused", word: "Withheld", line: "Withheld." };

/** The census clause for each absence: the count's place is never left to a zero. */
const CENSUS_WORDS: Record<CashAbsence["kind"], string> = {
  loading: "accounts loading…",
  unavailable: "accounts unavailable",
  unreadable: "accounts unreadable",
  withheld: "accounts withheld",
};

/** A tile with no figure, in the absence's register: busy while the read is in flight, the absence's word once it is not. */
function absentTile(absence: CashAbsence, sub = ""): TileView {
  if (absence.kind === "loading") return { value: "", sub, tone: "neutral", pending: true };
  return { value: "", sub, tone: stateTone(absence.state), pending: false, state: absence.state, stateWord: absence.word };
}

/** One of the Book's six tiles: its figure, sub line and register decided here, its label named here. */
export interface BookTile extends TileView {
  /** The tile's place, which its test id carries. */
  readonly id: "debt" | "liquidatable" | "near" | "median" | "baddebt" | "notcomputed";
  readonly label: string;
}

/** One of the Overview live strip's three figures: what it prints, and whether that is an absence rather than a figure. */
export interface LiveStat {
  readonly id: "debt" | "collateral" | "accounts";
  readonly label: string;
  readonly text: string;
  readonly absent: boolean;
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
  /** The Book's identity strip. */
  readonly chips: ViewChip[];
  /** The Overview live strip's: the mockup's Batch · Snapshot · Coverage, and any fault the reading carries — no "Current" chip. */
  readonly liveChips: ViewChip[];
  /** Tiles state an absence rather than a figure: exactly when `absence` is not null. */
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
  /** The aggregate's debt; absent under an absence, and over a census the engine computed none of (its zero sums nothing). */
  readonly debt: MoneyReading;
  readonly collateral: MoneyReading;
  /** Null when the book is unloaded, the engine withheld or absent, or the wire reports no bad-debt row. */
  readonly badDebt: BadDebtView | null;
  /**
   * The Book's six tiles, in order: debt, liquidatable, near cap, median room, standing bad debt, and the accounts with
   * no verdict — the engine's refused accounts PLUS the rows the engine calls computed that this page could not read,
   * each in its own word in the sub line, because the engine refused none of the latter. A tile with no figure states
   * its absence in its register's word, never a dash.
   */
  readonly tiles: readonly BookTile[];
  /** The bad-debt card's finding: the standing figure in a sentence, or why there is none. */
  readonly badDebtFinding: string;
  /** The Overview live strip's three figures, each the figure or its absence's word — "…" in flight, never a bare dash. */
  readonly liveStats: readonly LiveStat[];
  /** The live strip's one line: facts over a book read whole, else the headline's dek; null while the read is in flight. */
  readonly liveLine: string | null;
  /** The Book entry card's micro-stat: a figure only over a book read whole. */
  readonly bookEntryLine: string;
  /** The Scenarios entry card's micro-stat: the ETH −30% line, or the withheld preview named. */
  readonly previewLine: string;
  /** The micro-stat is a projected figure, so it wears the PROJECTION badge; a withheld preview projects nothing. */
  readonly previewProjected: boolean;
}

const LOADING: Headline = {
  variant: "refused",
  tone: "absent",
  emphasis: "Loading the Cash book…",
  rest: "",
  dek: "Fetching the newest batch.",
};

const n = (value: number): string => value.toLocaleString("en-US");

/** The ETH −30% line leads the Scenarios entry card: the front door's own question. */
const ENTRY_SHOCK = "ETH −30%";

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
          ? ABSENCE_WITHHELD
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
  // A fresh batch is a fact of record, in ink; the age speaks in colour only once it ages.
  const tierTone = (t: FreshnessTier | null): ViewChip["tone"] =>
    t === null ? "refused" : t === "fresh" ? "neutral" : t === "aging" ? "warn" : "crit";
  // Withheld is the engine's refusal, drawn in its register; unavailable is no refusal, and is drawn solid.
  const coverage: ViewChip =
    computedPositions !== null && positions !== null
      ? { label: "Coverage", value: `${n(computedPositions)} / ${n(positions)} computed`, tone: "neutral" }
      : withheld !== null
        ? { label: "Coverage", value: "withheld", tone: "refused" }
        : { label: "Coverage", value: "unavailable", tone: "neutral" };
  // A later answer that could not be read did not replace this book: the strip says so, and names the fault on hover.
  const standing: ViewChip[] =
    reading.repairFault === null
      ? []
      : [{ label: "Re-read", value: "unreadable · this batch stands", tone: "warn", title: reading.repairFault }];
  const current: ViewChip = { label: "Current, not projected", value: "" };
  const identity: ViewChip[] | null =
    reading.book === null
      ? null
      : [
          { label: "Batch", value: n(reading.book.batch.id) },
          {
            label: "Snapshot",
            value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(),
            tone: tierTone(tier),
          },
          coverage,
        ];
  // An answer that could not be read is the dashed register; a read in flight or a fetch that failed refused nothing.
  const missing: ViewChip[] = [
    unreadableAnswer
      ? { label: "Identity", value: "unreadable", tone: "refused" }
      : { label: "Identity", value: reading.phase === "loading" ? "pending" : "unavailable", tone: "neutral" },
  ];
  const chips: ViewChip[] = identity === null ? missing : [...identity, current, ...standing];
  const liveChips: ViewChip[] = identity === null ? missing : [...identity, ...standing];
  const censusWords = positions !== null ? `${n(positions)} borrowing accounts` : CENSUS_WORDS[(absence ?? ABSENCE_UNAVAILABLE).kind];

  const walking = summary !== null && !cash.walkComplete && cash.walkFailure === null;
  const walkStopped = summary === null ? null : summary.stopped;
  const preview: StressPreview | null =
    withheldCause !== null
      ? { kind: "refused", reason: withheldCause }
      : reading.book === null || reading.book.waterfall === null
        ? null
        : stressPreview(reading.book.waterfall, "debt_manager", reading.book.coverage);

  // The aggregate adds debt and collateral over computed positions only: over a census the engine computed none of,
  // its zeros are no position's figures and neither is read as one. An empty book refused nothing, and totals zero.
  const censusNoneComputed = computedPositions === 0 && refusedPositions !== null && refusedPositions > 0;
  const unsummed = refusedTiles || engine === null || censusNoneComputed;
  const debt = unsummed ? ABSENT : readWireMoney(engine.total_debt, decimals, "engines[debt_manager].total_debt");
  const collateral = unsummed ? ABSENT : readWireMoney(engine.total_collateral, decimals, "engines[debt_manager].total_collateral");
  const debtTile: TileView =
    absence !== null
      ? absentTile(absence)
      : censusNoneComputed
        ? NONE_COMPUTED_TILE
        : debt.kind === "malformed"
          ? { value: "", sub: malformedSub(debt.field), tone: "refused", pending: false, state: "unreadable" }
          : {
              ...(debt.kind === "value"
                ? { value: debt.text, tone: "neutral" as const, pending: false }
                : { value: "", tone: "neutral" as const, pending: false, state: "not-served" as const, stateWord: NOT_REPORTED }),
              sub:
                collateral.kind === "malformed"
                  ? `Collateral unreadable: ${malformedSub(collateral.field)}`
                  : collateral.kind === "absent"
                    ? "Collateral not reported"
                    : `Against ${collateral.text} collateral`,
            };
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
  const badDebtTile = badDebtTileOf(badDebt, absence);

  // A walk-derived figure is the entry card's micro-stat only over a book read whole; short of that the card says what happened to the walk.
  const bookEntryLine = summary === null ? "Live figures" : walkEntryLine(summary);

  // The withheld engine's cause first; then why there is no count at all; only a served census names its refusals —
  // and the rows this page could not read are counted with them, in their own word.
  const refusalKey = engine?.refusals[0]?.key;
  const unread = summary?.unreadable ?? 0;
  const refusedSub =
    refusalKey !== undefined ? sentenceCase(plainCause(refusalKey)) : refusedPositions === 0 ? "Nothing refused" : "Cause not stated";
  const unreadSub = unread === 0 ? "" : ` · ${String(unread)} unreadable${walking ? " so far" : ""}`;
  const noVerdictTile: TileView =
    refusedPositions === null
      ? absentTile(absence ?? ABSENCE_UNAVAILABLE, withheldCause === null ? "" : sentenceCase(withheldCause))
      : { value: String(refusedPositions + unread), sub: `${refusedSub}${unreadSub}`, tone: "refused", pending: false };
  const walkTileOf = (derive: (s: CashSummary) => TileView): TileView =>
    summary === null ? absentTile(absence ?? ABSENCE_UNAVAILABLE) : derive(summary);
  const tiles: BookTile[] = [
    { id: "debt", label: "Debt outstanding", ...debtTile },
    { id: "liquidatable", label: liquidatableTileLabel, ...walkTileOf(liquidatableTile) },
    { id: "near", label: "Near cap · <10% room", ...walkTileOf(nearCapTile) },
    { id: "median", label: "Median room", ...walkTileOf(medianRoomTile) },
    { id: "baddebt", label: "Standing bad debt", ...badDebtTile },
    { id: "notcomputed", label: NO_VERDICT, ...noVerdictTile },
  ];

  const previewText =
    preview !== null && preview.kind === "view"
      ? (preview.lines.find((l) => l.shock === ENTRY_SHOCK)?.text ?? preview.lines[0]?.text ?? null)
      : null;
  const previewLine =
    previewText !== null
      ? previewText
      : preview === null || preview.kind === "view"
        ? "Committed scenarios"
        : preview.kind === "refused"
          ? `Preview withheld: ${preview.reason}`
          : "Preview withheld: the Cash engine is not on this batch's stress grid";

  const moneyStat = (m: MoneyReading): Pick<LiveStat, "text" | "absent"> =>
    absence !== null
      ? { text: absence.word, absent: true }
      : m.kind === "value"
        ? { text: m.text, absent: false }
        : m.kind === "malformed"
          ? { text: ABSENCE_UNREADABLE.word, absent: true }
          : { text: censusNoneComputed ? NO_VERDICT : NOT_REPORTED, absent: true };
  const liveStats: LiveStat[] = [
    { id: "debt", label: "Cash debt outstanding", ...moneyStat(debt) },
    { id: "collateral", label: "Collateral", ...moneyStat(collateral) },
    {
      id: "accounts",
      label: "Accounts",
      ...(positions === null ? { text: (absence ?? ABSENCE_UNAVAILABLE).word, absent: true } : { text: n(positions), absent: false }),
    },
  ];
  const liveLine = reading.phase === "loading" ? null : ((summary === null ? null : overviewLiveLine(summary)) ?? headline.dek);

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
    liveChips,
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
    tiles,
    badDebtFinding: badDebtFindingOf(badDebt, absence),
    liveStats,
    liveLine,
    bookEntryLine,
    previewLine,
    previewProjected: previewText !== null,
  };
}

/**
 * The standing bad-debt tile. No row for the engine: the absence's word, or — over a served book — "Not reported"; a
 * figure the decimal guard refuses is unreadable, by field; a figure the wire withheld names its cause; a figure served
 * stands in the warn register once it is not zero, beside the insolvent accounts it counts.
 */
function badDebtTileOf(badDebt: BadDebtView | null, absence: CashAbsence | null): TileView {
  if (badDebt === null) {
    return absence !== null ? absentTile(absence) : { value: "", sub: "", tone: "neutral", pending: false, state: "not-served", stateWord: NOT_REPORTED };
  }
  const { reading, insolvent, cause } = badDebt;
  if (reading.kind === "malformed") return { value: "", sub: malformedSub(reading.field), tone: "refused", pending: false, state: "unreadable" };
  if (reading.kind === "absent") {
    return cause === null
      ? { value: "", sub: "", tone: "neutral", pending: false, state: "not-served", stateWord: NOT_REPORTED }
      : { value: "", sub: sentenceCase(cause), tone: "refused", pending: false, state: "refused", stateWord: "Withheld" };
  }
  return {
    value: reading.text,
    sub: cause !== null ? sentenceCase(cause) : insolvent === null ? "Accounts unknown" : plural(insolvent, "account"),
    tone: reading.value > 0n ? "warn" : "neutral",
    pending: false,
  };
}

/** The bad-debt card's finding: the standing figure in a sentence of record, or why there is none — never a zero. */
function badDebtFindingOf(badDebt: BadDebtView | null, absence: CashAbsence | null): string {
  if (badDebt === null) return absence !== null ? absence.line : BAD_DEBT_NOT_REPORTED;
  const { reading, insolvent, cause } = badDebt;
  if (reading.kind === "malformed") return `Standing bad debt is unreadable: ${malformedSub(reading.field)}.`;
  if (reading.kind === "absent") return cause === null ? BAD_DEBT_NOT_REPORTED : `Standing bad debt withheld: ${cause}.`;
  const across = insolvent === null ? "an unknown number of accounts" : plural(insolvent, "account");
  return `${reading.text} of debt is no longer covered by collateral, across ${across}.`;
}

export interface LegacyBand {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** A tile of the legacy fold as the fold prints it: decided here, printed by the component as given. */
export interface LegacyTile {
  readonly label: string;
  /** The figure; empty where the tile states an absence instead. */
  readonly value: string;
  /** Absent where the tile carries no sub line. */
  readonly sub?: string;
  readonly tone: TileTone;
  /** The tile has no figure, and says which absence it is (lib/kit STATE_REGISTERS) — never a dash. */
  readonly state?: StateRegister;
  /** The lib's own word for that absence ("Withheld", "No verdict"). */
  readonly stateWord?: string;
}

/** The legacy Aave v3 section, derived once: a withheld engine names its cause and prints no population, no debt, no histogram. */
export interface LegacyView {
  /** The engine's whole book is withheld, with this plain cause. */
  readonly withheld: string | null;
  readonly decimals: number;
  readonly positions: number | null;
  readonly computed: number | null;
  /** Null under a withheld engine, and where the engine computed no position and refused some: a count over nothing. */
  readonly liquidatable: number | null;
  readonly refused: number | null;
  /** Absent under a withheld engine, and where the engine computed no position and refused some: a sum over nothing. */
  readonly debt: MoneyReading;
  readonly eligibleDebt: MoneyReading;
  /**
   * Null when the wire serves no histogram for the engine, or withholds it — and where the engine computed no position
   * and refused some: the buckets count computed positions only, so each zero counts nothing.
   */
  readonly bands: LegacyBand[] | null;
  /** What the fold prints in place of a served histogram whose zeros count nothing; null wherever the bars stand. */
  readonly bandsNote: string | null;
  /** The histogram alone is withheld, with this plain cause. */
  readonly histogramWithheld: string | null;
  /** The collapsed fold's summary beside its title (lib/prose LEGACY_FOLD_TITLE): the market's own finding, or why there is none. */
  readonly summary: string;
  /** Why the market is shown at all, and that it is never added to the Cash book. */
  readonly note: string;
  /** The whole-book withholding in the fold's own sentence; null unless the engine withheld its book. */
  readonly withheldNote: string | null;
  readonly tiles: {
    readonly positions: LegacyTile;
    readonly debt: LegacyTile;
    readonly liquidatable: LegacyTile;
    readonly notComputed: LegacyTile;
  };
  /** The histogram's own withholding in the fold's sentence; null unless the histogram alone is withheld. */
  readonly histogramWithheldNote: string | null;
  /** The caption over the bars: what they bucket, where liquidation sits, and that they count positions, not dollars. */
  readonly bandsCaption: string;
}

const LEGACY_NOTE =
  "The ether.fi Aave v3 market is being wound down. Its figures are shown for completeness and are never added to the Cash book.";
const LEGACY_BANDS_CAPTION = "Positions by health factor · liquidation at 1.00 · counts, not dollars";

/** A legacy tile with no figure because the engine withheld its whole book. */
const LEGACY_WITHHELD = { value: "", tone: "refused", state: "refused", stateWord: "Withheld" } as const;

/** A legacy tile with no figure because the engine computed none of the market: the population's word, and why. */
const LEGACY_NONE_COMPUTED = { value: "", sub: "No position computed", tone: "refused", state: "refused", stateWord: NO_VERDICT } as const;

/**
 * The fold's four tiles from the view's own decisions. A withheld engine prints no population — each tile says
 * "Withheld"; a count or a sum over nothing computed prints no figure, the population's word "No verdict" in its place;
 * a malformed debt is unreadable, by field; the eligible debt beside the liquidatable count is the figure, or why it is
 * not there — withheld where the wire serves none, unreadable where it serves one the decimal guard refuses.
 */
function legacyTiles(
  v: Pick<LegacyView, "withheld" | "positions" | "computed" | "liquidatable" | "refused" | "debt" | "eligibleDebt">,
): LegacyView["tiles"] {
  if (v.withheld !== null || v.positions === null || v.computed === null || v.refused === null) {
    return {
      positions: { label: "Positions", ...LEGACY_WITHHELD },
      debt: { label: "Debt", ...LEGACY_WITHHELD },
      liquidatable: { label: "Liquidatable", ...LEGACY_WITHHELD },
      notComputed: { label: NO_VERDICT, ...LEGACY_WITHHELD },
    };
  }
  const eligible =
    v.eligibleDebt.kind === "value"
      ? `${v.eligibleDebt.text} eligible debt`
      : v.eligibleDebt.kind === "absent"
        ? "Σ withheld"
        : "Σ unreadable";
  const debt: LegacyTile =
    v.debt.kind === "value"
      ? { label: "Debt", value: v.debt.text, tone: "neutral" }
      : v.debt.kind === "malformed"
        ? { label: "Debt", value: "", sub: malformedSub(v.debt.field), tone: "refused", state: "unreadable" }
        : v.computed === 0 && v.refused > 0
          ? { label: "Debt", ...LEGACY_NONE_COMPUTED }
          : { label: "Debt", value: "", tone: "neutral", state: "not-served", stateWord: NOT_REPORTED };
  return {
    positions: { label: "Positions", value: n(v.positions), sub: `${n(v.computed)} computed`, tone: "neutral" },
    debt,
    liquidatable:
      v.liquidatable === null
        ? { label: "Liquidatable", ...LEGACY_NONE_COMPUTED }
        : { label: "Liquidatable", value: n(v.liquidatable), sub: eligible, tone: v.liquidatable > 0 ? "crit" : "neutral" },
    notComputed: { label: NO_VERDICT, value: n(v.refused), tone: "refused" },
  };
}

/** The legacy fold's line in place of the histogram, over a market the engine computed none of. */
export const LEGACY_BANDS_NONE_COMPUTED =
  "No position was computed this batch: the histogram counts computed positions only, so no bucket holds a count.";

export function deriveLegacyView(legacy: CashBookReading["legacy"]): LegacyView | null {
  const engine = legacy.engine;
  if (engine === null) return null;
  const decimals = readWireScale(engine.value_decimals, "engines[aave_v3_etherfi].value_decimals");
  const withheld = legacy.refusedWhole === null ? null : plainCause(legacy.refusedWhole.code, legacy.refusedWhole.detail);
  if (withheld !== null) {
    // The aggregate's populations under a withheld engine are placeholders, not counts: none is read.
    const counts = { withheld, positions: null, computed: null, liquidatable: null, refused: null, debt: ABSENT, eligibleDebt: ABSENT };
    return {
      ...counts,
      decimals,
      bands: null,
      bandsNote: null,
      histogramWithheld: null,
      summary: `Withheld this batch: ${withheld}`,
      note: LEGACY_NOTE,
      withheldNote: `The engine withheld its whole book this batch: ${withheld}. Its populations, debt and histogram are not computed.`,
      tiles: legacyTiles(counts),
      histogramWithheldNote: null,
      bandsCaption: LEGACY_BANDS_CAPTION,
    };
  }
  // Every population is a wire integer: classified before render, never coerced.
  const positions = readWirePopulation(engine.positions, "engines[legacy].positions");
  const computed = readWirePopulation(engine.computed_positions, "engines[legacy].computed_positions");
  const liquidatable = readWirePopulation(engine.liquidatable_positions, "engines[legacy].liquidatable_positions");
  const refused = readWirePopulation(engine.refused_positions, "engines[legacy].refused_positions");
  // The aggregate sums debt, and counts liquidatable positions, over computed positions only: with none computed and
  // some refused, its zeros are no position's figures. The line, the Debt tile, the Liquidatable tile and the histogram
  // read this one decision, and none prints them. A market with no positions refused nothing: its zero is its own.
  const nothingComputed = computed === 0 && refused > 0;
  const debt = nothingComputed ? ABSENT : readWireMoney(engine.total_debt, decimals, "engines[aave_v3_etherfi].total_debt");
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
  // Every bucket count is classified, whatever the market computed: a malformed count refuses by name.
  const served =
    histogram === null || histogramWithheld !== null
      ? null
      : histogram.buckets.map((b, i) => ({
          id: b.label,
          label: b.label,
          count: readWirePopulation(b.count, `hf_histogram[aave_v3_etherfi].buckets[${String(i)}].count`),
        }));
  // The buckets count computed positions only (a refused one is counted apart from them): with none computed and some
  // refused, every bucket's zero counts nothing, so no bar is drawn and the fold says why in its place.
  const bands = nothingComputed ? null : served;
  const bandsNote = nothingComputed && served !== null ? LEGACY_BANDS_NONE_COMPUTED : null;
  const debtWord =
    nothingComputed
      ? "debt not computed"
      : debt.kind === "value"
        ? `${debt.text} debt`
        : debt.kind === "absent"
          ? "debt withheld"
          : "debt unreadable";
  // The line states the market's own finding over the positions it computed; with none computed no liquidatable
  // clause is said (a negative over nothing), and the population stands in its place. Never a Cash figure.
  const finding =
    computed > 0
      ? `${n(liquidatable)} of ${n(computed)} computed ${computed === 1 ? "position is" : "positions are"} liquidatable`
      : `${n(positions)} position${positions === 1 ? "" : "s"}`;
  const counts = { withheld: null, positions, computed, liquidatable: nothingComputed ? null : liquidatable, refused, debt, eligibleDebt };
  return {
    ...counts,
    decimals,
    bands,
    bandsNote,
    histogramWithheld,
    summary: `${finding} · ${debtWord} · ${n(refused)} refused`,
    note: LEGACY_NOTE,
    withheldNote: null,
    tiles: legacyTiles(counts),
    histogramWithheldNote: histogramWithheld === null ? null : `Histogram withheld: ${histogramWithheld}.`,
    bandsCaption: LEGACY_BANDS_CAPTION,
  };
}

/** The Cash book's kicker, one on both pages: the book right now, and — while the walk runs, or once it stopped — which. */
export function cashBookKicker(view: Pick<CashView, "walking" | "walkStopped">): string {
  return `Cash book · right now${view.walking ? " · walking" : view.walkStopped !== null ? " · walk stopped" : ""}`;
}
