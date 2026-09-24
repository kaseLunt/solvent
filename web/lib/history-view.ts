// History's one view model: the verdict header, the identity chips, the four
// newest-point tiles, the chart's finding line, the state card that stands in
// for a chart the page cannot draw, and the drawer's doctrine, decided once
// from one engine's series reading. The headline and the dek ARE
// `observatoryTakeaway(...)`'s parts and the finding IS `gridReadingLine(...)`
// — the module's own sentences, by identity, so the header and the reading
// cannot drift. A statement of record wears ink: an answered series is
// `neutral`, and a hole's severity rides the census chip, never the headline's
// colour. A record the page cannot show says which absence it is — not served
// on this deployment, unavailable (a fetch that failed, never a refusal), or
// unreadable — each with its own card. Every figure passes the wire guards
// before it is formatted; a bucket the rollup withheld or never recorded — or a
// figure that fails its guard — is a dashed tile with the gap's word, never a 0
// and never a throw. The surface prints this and decides nothing twice.
import { EM_DASH, MINUS, formatBlock, truncateAddress } from "./format";
import { humanUsd } from "./human-usd";
import { exactUtc, humanUtc } from "./human-utc";
import { engineName } from "./inspector-headline";
import type { LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { signedBookMoney } from "./money";
import type {
  ObservatoryEngine,
  ObservatorySeriesPoint,
  ObservatorySeriesResponse,
  RateIndex,
} from "./observatory-data";
import {
  buildBucketAxis,
  buildMetricSeries,
  describeRange,
  describeStride,
  displayMetric,
  gridReadingLine,
  isMoneyMetric,
  metricLabel,
  metricUnreadable,
  observatoryTakeaway,
  pointDetailTakeaway,
  rangeWords,
  strideWord,
  UNREADABLE,
  type BucketAxis,
  type BucketEntry,
  type BucketKind,
  type BucketMetric,
  type GapKind,
} from "./observatory-series";
import { engineInProse, groupInt, plural } from "./prose";
import { isWireDecimal, isWirePopulation, isWireScale, readWirePopulation, wireBigInt } from "./wireGuard";

export type HistoryState = "loading" | "degraded" | "unavailable" | "ok";
export type HistoryTileKey = "debt" | "collateral" | "accounts" | "liquidatable";

export interface HistoryTile {
  readonly key: HistoryTileKey;
  readonly label: string;
  /** The figure; empty when the tile states an absence instead. */
  readonly value: string;
  readonly sub: string;
  readonly tone: "neutral" | "refused";
  /** The register of the absence the tile states in place of a figure (lib/kit STATE_REGISTERS); null when it has one. */
  readonly state: "refused" | "unreadable" | null;
  /** The gap's own word, printed where the figure would be — never a dash; null when the tile has a figure. */
  readonly stateWord: string | null;
}

/** The chart a page cannot draw, stated in its place: which absence it is, why, the service's words, the way forward. */
export interface HistoryStateCard {
  readonly state: "not-served" | "unavailable" | "unreadable";
  readonly title: string;
  readonly cause: string;
  readonly serviceSaid: { readonly label: string; readonly text: string } | null;
  /** The one way forward: the Book (for today's figures), a retry, or none. */
  readonly action: "book" | "retry" | null;
}

export interface HistoryView {
  readonly state: HistoryState;
  /** "History · Cash" | "History · Aave v3 market (legacy)". */
  readonly kicker: string;
  /** Emphasis, rest and dek = observatoryTakeaway(...)'s parts, or a no-answer sentence with its own dek. */
  readonly headline: LabHeadline;
  /** Stride ("hourly") · Range · Hours ("165 recorded · 1 withheld · 2 absent") · Served — the engine is the kicker's and the switch's. */
  readonly chips: LabChip[];
  /** The four metrics' newest captured points; empty until the series answers. */
  readonly tiles: readonly HistoryTile[];
  /** gridReadingLine(...) for the drawn metric — the chart card's finding line; null until the series answers. */
  readonly finding: string | null;
  /** The chart's accessible name for the selected metric; null until the series answers. */
  readonly chartLabel: string | null;
  /** The key to the hole marks the selected metric's chart draws in this window; empty when it draws none. */
  readonly marks: readonly HistoryMark[];
  /** The card that stands where the chart would, when the record cannot be drawn; null while loading and when it can. */
  readonly stateCard: HistoryStateCard | null;
  /** The drawer's paragraphs, verbatim: the intro, the chart's method notes, the stride's sentence, then the wire's own notes. */
  readonly doctrine: readonly string[];
}

export interface HistoryReading {
  readonly engine: ObservatoryEngine;
  readonly metric: BucketMetric;
  /** `foreign`: the body that came back answers for another engine than the one asked, and was never committed. */
  readonly phase: "loading" | "ok" | "degraded" | "error" | "foreign";
  readonly response: ObservatorySeriesResponse | null;
  /** The degraded envelope's own message, the error's, or `foreignSeries(...)`'s sentence; null otherwise. */
  readonly message: string | null;
  /** The service's own words, verbatim, for the state card's disclosure (status, code, message and URL); null when there are none. */
  readonly serviceSaid?: string | null;
  /** The HTTP status a failed fetch answered with; null when the request never reached the service. */
  readonly status?: number | null;
}

/**
 * The engines the switch offers, in the page's order: Cash first — it is the product's book, and the page opens on
 * it. Every engine the contract serves is here exactly once; one engine per view, never combined.
 */
export const HISTORY_ENGINES = ["debt_manager", "aave_v3_etherfi"] as const satisfies readonly ObservatoryEngine[];

/** The page's chrome, every word of it: what the components print between the view's figures. */
export const HISTORY_COPY = {
  drawer: "Methodology & evidence",
  engine: "Engine",
  show: "Show",
  chartTitle: "How the book moved",
  openBook: "Open the Book →",
  retry: "Try again",
  marksLabel: "Marks on the chart",
} as const;

/** The disclosure's label over the service's verbatim words: relocated from the headline, never removed. */
export const SERVICE_SAID = "What the service said";

/** The loading dek says what will be here; nothing is counted before the series answers. */
export function historyLoadingDek(engine: ObservatoryEngine): string {
  return `The hourly record of this engine's debt, collateral, accounts and liquidatable ${engine === "debt_manager" ? "accounts" : "positions"}.`;
}

/** The degraded arm's dek: what this deployment has not built, in reader words, and where today's figures are. */
export const HISTORY_DEGRADED_DEK =
  "This deployment has not built its hourly history yet, so there is nothing to chart. Today's figures are on the Book.";

/** The intro paragraph: the page's doctrine lives in the drawer, verbatim — the header states facts about the window. */
export const HISTORY_INTRO =
  "How each engine's book has moved, hour by hour, in a record that outlives batch retention. An hour in which no complete batch was observed renders as a hole, which is never smoothed over and never drawn as a zero; one engine per view, never combined onto one axis.";

/**
 * The chart's method notes — the line, then one note for EVERY hole mark the key can show (each opens with the
 * mark's own word), the two drawing notes, the source — verbatim.
 */
export const HISTORY_METHOD: readonly string[] = [
  "Captured hours: the line never interpolates across a gap.",
  "Absent hour: no complete batch was observed in it.",
  "Withheld hour: the book was refused, so its totals are null and never 0.",
  `${UNREADABLE.charAt(0).toUpperCase()}${UNREADABLE.slice(1)} figure: the hour was recorded, but this figure is not the exact decimal the contract allows, so it is a hole and never 0.`,
  "Zero floor drawn: the scale never crops it away.",
  "Select any hour for its record.",
  "Source: the observatory_points rollup; its points survive batch retention, and it keeps each point's batch and materialization identity.",
];

export const HISTORY_DOCTRINE: readonly string[] = [HISTORY_INTRO, ...HISTORY_METHOD];

/** What a degraded rollup means for this deployment: a fact about the deployment, never an empty history. */
export const HISTORY_DEGRADED_NOTE =
  "This deployment's database predates the observatory rollup (migration 00016): the durable series does not exist here yet. That is a fact about the deployment, and it is never rendered as an empty history, a flat line or a zero. Live per-batch posture still exists on the Book.";

/** An unfetched record is never shown as an empty one. */
export const HISTORY_UNAVAILABLE_CLAUSE = "The record is unavailable, and none of it is being shown as empty.";

/** A series whose scale is outside the wire contract: no figure on it prints at any other scale than its own. */
export const HISTORY_UNREADABLE_SCALE = "The series states a value scale outside the contract, so none of its dollar figures can be placed.";

/** Why a series that answers for another engine is refused whole: the two engines' figures never stand in for each other. */
export const HISTORY_FOREIGN_CLAUSE = "One engine's figures are never shown under another's name.";

/** The chip of a series refused because it answers for another engine than the one asked. */
const FOREIGN_RECORD_WORD = "wrong engine";

/** The refusal's sentence when the reading carries none of its own. */
const FOREIGN_UNNAMED = "The service answered for another engine than the one asked for.";

/** An engine in the refusal's sentence: its name in prose, then the wire's own id, so the two are told apart by both. */
const namedWithId = (engine: ObservatoryEngine): string => `${engineInProse(engine)} (${engine})`;

/**
 * A series answers for the engine that was ASKED. The body's own `engine` is compared with the request's before the
 * body is committed or a figure of it is read: a body naming another engine — the other of the two, one this page
 * does not chart, or none at all — is refused whole, in this sentence. Null exactly when the body is the asked
 * engine's. The legacy market's figures never appear under Cash's name, nor Cash's under the legacy market's.
 */
export function foreignSeries(requested: ObservatoryEngine, response: ObservatorySeriesResponse): string | null {
  const answered: unknown = response.engine;
  if (answered === requested) return null;
  const known = HISTORY_ENGINES.find((engine) => engine === answered);
  const series =
    known !== undefined
      ? `the series of ${namedWithId(known)}`
      : typeof answered === "string" && answered.trim() !== ""
        ? `the series of an engine this page does not chart (${answered.trim()})`
        : "a series that names no engine";
  return `The service answered with ${series} where ${namedWithId(requested)} was asked for.`;
}

export interface HistoryTileSpec {
  readonly key: HistoryTileKey;
  readonly metric: BucketMetric;
  readonly label: string;
}

/** The four tiles, in reading order: the same four in every state, the liquidatable count named in its engine's noun. */
export function historyTiles(engine: string): readonly HistoryTileSpec[] {
  return [
    { key: "debt", metric: "debt_usd", label: "Debt" },
    { key: "collateral", metric: "collateral_usd", label: "Collateral" },
    { key: "accounts", metric: "accounts", label: "Accounts" },
    { key: "liquidatable", metric: "liquidatable_positions", label: metricLabel("liquidatable_positions", engine) },
  ];
}

/**
 * A tile with no figure: the gap's own word in the figure's place — never a dash, never a 0 — in the register of its
 * gap: an unreadable figure is the unreadable register, every other gap (withheld, not observed, not stated, no hour
 * at all) the refused one. The sub names the hour the word is about.
 */
const dashed = (spec: HistoryTileSpec, word: string, sub = LATEST_HOUR): HistoryTile => ({
  key: spec.key,
  label: spec.label,
  value: "",
  sub,
  tone: "refused",
  state: word === GAP_WORDS.unreadable ? "unreadable" : "refused",
  stateWord: word,
});

/** The hour a gap tile's word is about. */
const LATEST_HOUR = "In the latest hour";

/** A window that holds no hour at all: nothing was recorded, and the tile says that — not that no batch existed. */
const NO_HOUR_WORD = "No hour recorded";

/** A tile whose first recorded hour is its latest, or states no comparable figure: no change is claimed. */
const LATEST_ONLY = "Latest recorded hour";

/**
 * The tile's word for a metric that plots nothing at the newest bucket — the chart's own gap kind for that bucket,
 * said once: the bucket was withheld, no batch was observed in it, the served bucket states this metric as null
 * (null is not zero), or states it as a value that fails its wire guard (unreadable is not zero).
 */
const GAP_WORDS: Record<GapKind, string> = {
  withheld: "Withheld",
  absent: "None observed",
  null: "Not stated",
  unreadable: "Unreadable",
};

/** A count's change with its sign stated — "+1", "−52" — the display minus, never a hyphen. */
const signedCount = (delta: number): string => (delta > 0 ? `+${groupInt(delta)}` : `${MINUS}${groupInt(-delta)}`);

/**
 * The tile's sub: how the figure moved since the window's first recorded hour, from the same two wire rows the
 * headline and the finding read — "+$1.8M since Aug 1, 21:00 UTC". A first hour that IS the latest, or that states no
 * readable figure of this metric, licenses no change: the sub says the figure is the latest recorded hour's.
 */
function changeSince(spec: HistoryTileSpec, first: ObservatorySeriesPoint | undefined, last: ObservatorySeriesPoint, response: ObservatorySeriesResponse, scale: number): string {
  if (first === undefined || first === last) return LATEST_ONLY;
  const since = `since ${humanUtc(first.bucket_start, response.served_at)}`;
  if (isMoneyMetric(spec.metric)) {
    const a = spec.metric === "debt_usd" ? first.debt_usd : first.collateral_usd;
    const b = spec.metric === "debt_usd" ? last.debt_usd : last.collateral_usd;
    if (a === null || b === null || !isWireDecimal(a) || !isWireDecimal(b)) return LATEST_ONLY;
    const delta = BigInt(b) - BigInt(a);
    return delta === 0n ? `Unchanged ${since}` : `${signedBookMoney(scale)(delta)} ${since}`;
  }
  const a = spec.metric === "accounts" ? first.accounts : first.liquidatable_positions;
  const b = spec.metric === "accounts" ? last.accounts : last.liquidatable_positions;
  if (!isWirePopulation(a) || !isWirePopulation(b)) return LATEST_ONLY;
  return a === b ? `Unchanged ${since}` : `${signedCount(b - a)} ${since}`;
}

/**
 * One tile: the metric at the newest bucket on the axis, exactly when the chart plots a point there. The judgement
 * is the series builder's — the tile's word IS that bucket's gap kind, so the tile and the chart cannot disagree —
 * and an older figure never stands in for a newest bucket that refused, stated nothing or stated something
 * unreadable: that tile is dashed with the gap's word. Money is the Book's tier at the classified scale after the
 * decimal passes its guard; the sub is the change since the first recorded hour. (A COUNT outside the contract keeps
 * the throwing read: the module's sentences read counts through it, so such a count lands at the route boundary
 * before any tile is decided.)
 */
function tileOf(
  spec: HistoryTileSpec,
  axis: BucketAxis,
  response: ObservatorySeriesResponse,
  scale: number,
  first: ObservatorySeriesPoint | undefined,
): HistoryTile {
  const last = axis.entries[axis.entries.length - 1];
  if (last === undefined) return dashed(spec, NO_HOUR_WORD, "");
  const series = buildMetricSeries(axis, response, spec.metric);
  const gap = series.gapKinds[series.gapKinds.length - 1] ?? null;
  if (last.point === null) return dashed(spec, GAP_WORDS.absent);
  if (gap !== null) return dashed(spec, GAP_WORDS[gap]);
  const point = last.point;
  const sub = changeSince(spec, first, point, response, scale);
  if (spec.metric === "debt_usd" || spec.metric === "collateral_usd") {
    const raw = spec.metric === "debt_usd" ? point.debt_usd : point.collateral_usd;
    const value = raw === null ? null : wireBigInt(raw);
    if (value === null) return dashed(spec, GAP_WORDS.unreadable);
    return { key: spec.key, label: spec.label, value: humanUsd(value, scale), sub, tone: "neutral", state: null, stateWord: null };
  }
  const raw = spec.metric === "accounts" ? point.accounts : point.liquidatable_positions;
  if (!isWirePopulation(raw)) return dashed(spec, GAP_WORDS.unreadable);
  return { key: spec.key, label: spec.label, value: groupInt(raw), sub, tone: "neutral", state: null, stateWord: null };
}

/** The census chip before the series answers, and its label in every state: the window is counted in hours. */
const HOURS_CHIP = "Hours";

/** The money metrics, by identity: the figures an hour can state and still leave unreadable. */
const MONEY_METRICS = historyTiles("").map((spec) => spec.metric).filter(isMoneyMetric);

/**
 * The recorded hours that state a money figure no guard can read — in either money metric, whichever one the chart
 * is on: the census is the window's, not the selected series'. Such an hour WAS recorded, so it is counted inside
 * the recorded hours, never as a fourth kind of hour beside them.
 */
function unreadableHours(axis: BucketAxis): number {
  return axis.entries.filter((entry) => {
    const point = entry.kind === "captured" ? entry.point : null;
    return point !== null && MONEY_METRICS.some((metric) => metricUnreadable(point, metric));
  }).length;
}

/**
 * The identity strip of an answered series: the tally is warn-toned whenever a hole exists — a withheld hour, an
 * absent one, or a recorded hour with an unreadable figure — and ink when none does: a full census is a record, not a
 * health verdict. Every instant is the reader's, its wire ISO the chip's title.
 */
function okChips(response: ObservatorySeriesResponse, axis: BucketAxis): LabChip[] {
  const unreadable = unreadableHours(axis);
  const holes = axis.withheldCount > 0 || axis.absentCount > 0 || unreadable > 0;
  const recorded =
    unreadable > 0
      ? `${groupInt(axis.capturedCount)} recorded (${groupInt(unreadable)} with an ${UNREADABLE} figure)`
      : `${groupInt(axis.capturedCount)} recorded`;
  const census = `${recorded} · ${groupInt(axis.withheldCount)} withheld · ${groupInt(axis.absentCount)} absent`;
  return [
    // The reader's word on the chip; the method sentence is its title and a drawer paragraph.
    { label: "Stride", value: strideWord(response.step_seconds), title: describeStride(response.step_seconds) },
    { label: "Range", value: rangeWords(response.from, response.to, response.served_at), title: describeRange(response.from, response.to) },
    holes ? { label: HOURS_CHIP, value: census, tone: "warn" } : { label: HOURS_CHIP, value: census },
    // The envelope carries served_at and no age: the wire's own instant, never a browser-clock age.
    { label: "Served", value: humanUtc(response.served_at, response.served_at), title: response.served_at },
  ];
}

/** A no-answer headline: the whole line in the absent register when there is simply no answer here, dashed when the page refused what it was handed. */
const noAnswer = (emphasis: string, dek: string, tone: "absent" | "refused"): LabHeadline => ({ emphasis, rest: "", tone, dek });

/** What a fetch that failed says at reader altitude: the one system token, the status, in parentheses. */
function unavailableDek(status: number | null | undefined): string {
  const said = typeof status === "number" ? `The service did not return the hourly record (HTTP ${String(status)}).` : "The request for the hourly record did not reach the service.";
  return `${said} ${HISTORY_UNAVAILABLE_CLAUSE}`;
}

const saidOf = (text: string | null | undefined): HistoryStateCard["serviceSaid"] =>
  text === null || text === undefined || text.trim() === "" ? null : { label: SERVICE_SAID, text };

export function deriveHistoryView(reading: HistoryReading): HistoryView {
  const kicker = `History · ${engineName(reading.engine)}`;
  const base = { kicker, tiles: [], finding: null, chartLabel: null, marks: [], stateCard: null, doctrine: HISTORY_DOCTRINE } as const;
  const inProse = engineInProse(reading.engine);
  if (reading.phase === "loading") {
    return {
      ...base,
      state: "loading",
      headline: noAnswer(`Loading the history of ${inProse}…`, historyLoadingDek(reading.engine), "absent"),
      chips: [{ label: HOURS_CHIP, value: "pending" }],
    };
  }
  if (reading.phase === "degraded") {
    return {
      ...base,
      state: "degraded",
      headline: noAnswer(`No hourly history exists for ${inProse} on this deployment yet.`, HISTORY_DEGRADED_DEK, "absent"),
      chips: [{ label: "Hourly record", value: "not served here" }],
      stateCard: {
        state: "not-served",
        title: "No hourly history on this deployment",
        cause: "The hourly rollup is not available on this deployment's database.",
        serviceSaid: saidOf(reading.serviceSaid ?? reading.message),
        action: "book",
      },
      doctrine: [...HISTORY_DOCTRINE, HISTORY_DEGRADED_NOTE],
    };
  }
  // A body that answers for another engine than the one asked is refused whole, before its scale is classified or a
  // figure of it is read: nothing of it reaches the headline, the tiles, the chart or the drawer's notes.
  const foreign =
    reading.phase === "foreign"
      ? (reading.message ?? FOREIGN_UNNAMED)
      : reading.phase === "ok" && reading.response !== null
        ? foreignSeries(reading.engine, reading.response)
        : null;
  if (foreign !== null) {
    return {
      ...base,
      state: "unavailable",
      headline: noAnswer(`The history of ${inProse} cannot be shown.`, `${foreign} ${HISTORY_FOREIGN_CLAUSE}`, "refused"),
      chips: [{ label: "Record", value: FOREIGN_RECORD_WORD, tone: "refused" }],
      stateCard: {
        state: "unreadable",
        title: "A series for another engine",
        cause: `Nothing of it is charted here: ${HISTORY_FOREIGN_CLAUSE.charAt(0).toLowerCase()}${HISTORY_FOREIGN_CLAUSE.slice(1)}`,
        serviceSaid: null,
        action: "retry",
      },
    };
  }
  if (reading.phase === "error" || reading.response === null) {
    return {
      ...base,
      state: "unavailable",
      headline: noAnswer(`The history of ${inProse} could not be fetched.`, unavailableDek(reading.status), "absent"),
      chips: [{ label: "Hourly record", value: "unavailable" }],
      stateCard: {
        state: "unavailable",
        title: "Hourly record unavailable",
        cause: "Nothing of this engine's record was read, so nothing is charted.",
        serviceSaid: saidOf(reading.serviceSaid ?? reading.message),
        action: "retry",
      },
    };
  }
  const response = reading.response;
  // The scale is classified before any figure is formatted at it, as every money string is classified before it
  // meets a formatter: either would otherwise reach the formatter's own throw. A record whose scale is outside
  // the contract cannot be read at all, and the page says so by name instead of unmounting; a single figure that
  // fails its guard is a named hole in an otherwise readable record.
  if (!isWireScale(response.usd_decimals)) {
    return {
      ...base,
      state: "unavailable",
      headline: noAnswer(`The history of ${inProse} cannot be read.`, HISTORY_UNREADABLE_SCALE, "refused"),
      chips: [{ label: "Record", value: "unreadable", tone: "refused" }],
      stateCard: {
        state: "unreadable",
        title: "An unreadable value scale",
        cause: "Its figures are not printed at a scale nobody licensed, so nothing is charted.",
        serviceSaid: null,
        action: "retry",
      },
    };
  }
  const scale = response.usd_decimals;
  const axis = buildBucketAxis(response);
  // The series answered when its latest recorded hour stated a debt figure. A record is ink, never the colour of a
  // health verdict — holes included: their severity is the census chip's. A withheld latest hour, one that states no
  // debt or an unreadable one, or a window with no recorded hour is a refusal the takeaway states in its own words.
  const takeaway = observatoryTakeaway(response, axis, reading.engine);
  const first = axis.entries.find((entry) => entry.point !== null && !entry.point.refused)?.point ?? undefined;
  return {
    state: "ok",
    kicker,
    headline: { emphasis: takeaway.emphasis, rest: takeaway.rest, tone: takeaway.answered ? "neutral" : "refused", dek: takeaway.dek },
    chips: okChips(response, axis),
    tiles: historyTiles(reading.engine).map((spec) => tileOf(spec, axis, response, scale, first)),
    finding: gridReadingLine(response, axis, reading.metric),
    chartLabel: `${metricLabel(reading.metric, reading.engine)} for ${engineName(reading.engine)}, hour by hour`,
    marks: marksFor(buildMetricSeries(axis, response, reading.metric).gapKinds),
    stateCard: null,
    doctrine: [...HISTORY_DOCTRINE, describeStride(response.step_seconds), ...response.notes],
  };
}

// ---------------------------------------------------------------------------
// The chart's hole marks and their words — the key beside the finding line
// maps each glyph the plot draws to its meaning. The method notes stay in the
// drawer; this is the one thing no other element on the page states. A key
// explains marks that are ON the chart: a window (of the selected metric) with
// no hole carries no key.
// ---------------------------------------------------------------------------

export interface HistoryMark {
  readonly mark: "absent" | "withheld" | "unreadable";
  readonly label: string;
}

/** Every mark the plot can draw for a hole, in the key's order. An absent hour is one no complete batch was OBSERVED in. */
export const HISTORY_MARKS: readonly HistoryMark[] = [
  { mark: "absent", label: "No complete batch observed" },
  { mark: "withheld", label: "Batch present, figures withheld" },
  { mark: "unreadable", label: "Figure unreadable" },
];

/** The key for one drawn series: the marks whose gap kind occurs in it, in the key's order. */
export function marksFor(gapKinds: readonly (GapKind | null)[]): readonly HistoryMark[] {
  return HISTORY_MARKS.filter((mark) => gapKinds.includes(mark.mark));
}

// ---------------------------------------------------------------------------
// The hour record: a card, not a list. Every sentence the record prints is
// decided here; HistoryPoint prints it. Provenance on detail, not buried in a
// tooltip: the hour's as-of, the engine's balances watermark at capture time,
// the refusal posture, the exact totals (null renders as an em dash, NEVER 0),
// and the rate-index snapshot where every index carries its OWN as-of block.
// An ABSENT hour gets the same record, stating the absence by name — the
// rollup captured nothing in that hour, and the record says so instead of
// pretending the hour never existed.
// ---------------------------------------------------------------------------

export interface RecordRow {
  readonly key: string;
  /** The row's name, in sentence case. */
  readonly label: string;
  /** The row's leading text. */
  readonly value: string;
  /** The clause after the value, carrying its own leading separator; null when the value stands alone. */
  readonly note: string | null;
  /**
   * What the clause IS: a caption (provenance in parentheses — the dim ink) or a state (why a figure is missing,
   * withheld or unreadable — never the caption ink, which is reserved for ornament).
   */
  readonly noteTone: "caption" | "state";
  /** refused: the withheld state word (a pill, the wire code as its title); crit: a biting reorg disclosure. */
  readonly tone: "neutral" | "crit" | "refused";
  /** The value is an identifier, set in mono; a figure is the page's tabular sans. */
  readonly mono: boolean;
  /** The row's copy action — the exact string it places on the clipboard and its accessible name; null when it offers none. */
  readonly copy: RecordCopy | null;
  /** The value's exact layer on hover (a wire ISO under a typeset instant); null when the value is already it. */
  readonly title: string | null;
  readonly testId: string | null;
}

export interface RecordCopy {
  readonly text: string;
  /** "Copy debt (USD)": a sentence-case line, so the row's name loses its leading capital. */
  readonly label: string;
}

/** A copy action on a record row, named by the row: "Materialization key" → "Copy materialization key". */
function copyOf(label: string, text: string): RecordCopy {
  return { text, label: `Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}` };
}

export interface RateRow {
  readonly key: string;
  readonly kind: string;
  /** The asset's full address (the cell's title). */
  readonly asset: string;
  /** The wire's symbol, or the truncated address when it named none. */
  readonly assetName: string;
  readonly assetShort: string;
  /** The wire's exact decimal string, verbatim. */
  readonly value: string;
  /** The scale from the closed per-kind vocabulary, or the unstated word. */
  readonly scale: string;
  readonly scaleStated: boolean;
  /** The index's OWN as-of block, grouped. */
  readonly block: string;
  readonly note: string;
}

export interface RecordColumn {
  readonly key: keyof RateRow;
  readonly header: string;
  readonly align?: "left" | "right";
}

/** The rate snapshot's columns, in reading order. */
export const HISTORY_RATE_COLUMNS: readonly RecordColumn[] = [
  { key: "kind", header: "Rate index" },
  { key: "assetName", header: "Asset" },
  { key: "value", header: "Value (raw decimal)", align: "right" },
  { key: "scale", header: "Scale" },
  { key: "block", header: "Its own as-of block", align: "right" },
  { key: "note", header: "Note" },
];

export interface PointRecord {
  /** "Latest hour · Aug 8, 20:00 UTC" — which hour this record is, in the reader's words. */
  readonly title: string;
  /** The hour's wire ISO: the title's exact layer. */
  readonly bucket: string;
  readonly kind: BucketKind;
  /** pointDetailTakeaway(entry) — the record's one-line state. */
  readonly takeaway: string;
  /** The absent bucket's paragraph; null when a wire row exists. */
  readonly absentNote: string | null;
  /** The wire code behind the withheld state word; null otherwise. */
  readonly refusalCode: string | null;
  /** The rows visible without a click: the state, the totals, and every hazard exactly when it bites. */
  readonly answer: readonly RecordRow[];
  /** The counted fold's summary; null for an absent bucket (nothing to fold). */
  readonly forensicSummary: string | null;
  /** Pure provenance, plus the reorg and sweep rows exactly when they carry no hazard. */
  readonly forensic: readonly RecordRow[];
  readonly rates: readonly RateRow[];
  /** Printed where the rate table would stand when the bucket carries no snapshot; null when it does. */
  readonly ratesEmpty: string | null;
  /** True when a rate's scale is unstated: the table is a disclosure and stands OUTSIDE the fold. */
  readonly ratesOutside: boolean;
  readonly provenance: string;
}

/** The record names its hour: the latest one on the axis, or the one the reader selected. */
export function recordTitle(bucketStart: string, servedAt: string, latest: boolean): string {
  return `${latest ? "Latest hour" : "Selected hour"} · ${humanUtc(bucketStart, servedAt)}`;
}

export const HISTORY_ABSENT_NOTE =
  "The rollup wrote no row for this hour: no complete risk batch was observed in it. Either none existed when the rollup looked, or the rollup did not look or could not write — the record cannot tell these apart. Nobody refused it. An absent hour is a hole in the record, stated by name: nothing is interpolated across it, and it never renders as zero.";

export const HISTORY_PROVENANCE =
  "Provenance: this point was captured from the newest complete risk batch in its hour (the observatory_points rollup law) and survives batch retention. Rate values are the wire's exact decimal strings, rendered verbatim.";

/** The clauses after a value, each carrying the separator it follows the value with. */
const NULL_TOTAL_CLAUSE = ", null because the book was withheld and never zero";
const UNSTATED_TOTAL_CLAUSE = ", not stated for this hour and never zero";
const UNREADABLE_TOTAL_CLAUSE = `, ${UNREADABLE}: the wire's value is not an exact decimal, and it is never shown as zero`;
const WITHHELD_STATE_CLAUSE = "the engine's whole book was withheld at capture time";
const WATERMARK_CLAUSE = " (the engine's balances watermark at capture, never a chain head observed later)";
const BATCH_CLAUSE = " (the complete batch this hour observed; the batch itself may since have been pruned by retention)";
const KEY_CLAUSE = " (copied at write time, so the attribution survives retention)";
const REORG_CLAUSE = " (the stamp pair copied from the observed batch's watermark vector)";
const SWEEP_UNRECORDED_CLAUSE =
  " unrecorded: this point predates migration 00018 and its batch was pruned before the stamp could be recovered. The record is missing here, and it is not a claim that the engine has no sweeper.";
const SWEEP_NONE_CLAUSE = " (recorded: this engine has no collateral sweep, so its balances are event-derived)";
const SWEEP_STAMP_CLAUSE =
  " · the observed batch's own sweep stamp; the liquidatable count above aggregates this sweep-cut, not the hour's block clock. Last successful write ";
const UNSTATED_SCALE = "unstated · kind outside the known vocabulary";

/** A record field's instant: every wire field typeset, the zone named; the wire's own ISO is its title. */
const exactUtcTitle = (iso: string): { readonly text: string; readonly title: string } => ({ text: exactUtc(iso), title: iso });

const plain = (key: string, label: string, value: string, note: string | null = null): RecordRow => ({
  key,
  label,
  value,
  note,
  noteTone: "caption",
  tone: "neutral",
  mono: false,
  copy: null,
  title: null,
  testId: null,
});

/**
 * The sweep stamp (the count's collateral clock), three states, each honest:
 * UNRECORDED (a pre-00018 point whose batch was pruned before the backfill —
 * the record is missing, which is not a claim that the engine has no sweeper),
 * recorded NONE (the engine has no collateral sweep and the record says so),
 * or the observed batch's own stamp. Sweep tallies are wire populations,
 * guarded reads; the last write is a record field, its wire ISO the title.
 */
function sweepRowOf(point: ObservatorySeriesPoint): RecordRow {
  const base = {
    key: "sweep",
    label: "Sweep stamp (the count's collateral clock)",
    noteTone: "caption" as const,
    tone: "neutral" as const,
    mono: false,
    copy: null,
    title: null,
    testId: "history-point-sweep",
  };
  // A missing stamp is a disclosure about the record's state, not a caption.
  if (!point.sweep_recorded) return { ...base, value: EM_DASH, note: SWEEP_UNRECORDED_CLAUSE, noteTone: "state" };
  if (point.sweep === null) return { ...base, value: "None", note: SWEEP_NONE_CLAUSE };
  const s = point.sweep;
  const value =
    `${String(readWirePopulation(s.rows, "sweep.rows"))} swept · ` +
    `${String(readWirePopulation(s.failed, "sweep.failed"))} failed · ` +
    `gen ${String(readWirePopulation(s.generation, "sweep.generation"))}` +
    (s.generation_open ? " (pass in flight)" : " (pass complete)");
  const lastWrite = s.max_updated_at === null ? `${EM_DASH} (no successful write recorded)` : exactUtcTitle(s.max_updated_at).text;
  return { ...base, value, note: `${SWEEP_STAMP_CLAUSE}${lastWrite}`, title: s.max_updated_at };
}

/** One rate index of the snapshot: the wire's own strings; a scale outside the closed vocabulary is named unstated. */
function rateRowOf(rate: RateIndex): RateRow {
  const short = truncateAddress(rate.asset);
  const stated = rate.scale !== "unstated";
  return {
    key: `${rate.kind}-${rate.asset}`,
    kind: rate.kind,
    asset: rate.asset,
    assetName: rate.symbol ?? short,
    assetShort: short,
    value: rate.value,
    scale: stated ? rate.scale : UNSTATED_SCALE,
    scaleStated: stated,
    block: formatBlock(rate.as_of_block),
    note: rate.note,
  };
}

/**
 * The selected hour's full record. Hazard fences: three rows are
 * disclosures, not provenance, and a record carrying one keeps it in the
 * ANSWER, outside the counted fold — unacked reorg epochs at compute, an
 * UNRECORDED sweep stamp, a rate whose scale is unstated. Both epoch stamps
 * pass the population guard BEFORE the subtraction that decides (and later
 * prints) the unacked disclosure; every count passes it before it prints.
 * The liquidatable and no-verdict rows name the count in its engine's noun.
 */
export function pointRecord(entry: BucketEntry, response: ObservatorySeriesResponse, latest = false): PointRecord {
  const engine = response.engine;
  const base = {
    title: recordTitle(entry.bucketStart, response.served_at, latest),
    bucket: entry.bucketStart,
    kind: entry.kind,
    takeaway: pointDetailTakeaway(entry),
    provenance: HISTORY_PROVENANCE,
  };
  const point = entry.point;
  if (point === null) {
    return {
      ...base,
      absentNote: HISTORY_ABSENT_NOTE,
      refusalCode: null,
      answer: [],
      forensicSummary: null,
      forensic: [],
      rates: [],
      ratesEmpty: null,
      ratesOutside: false,
    };
  }
  // The four totals print through the one chokepoint the marks' titles use: grouped money at the engine's own
  // scale, grouped counts after the population guard, an em dash for a null or an unreadable figure — never 0.
  const total = (metric: BucketMetric): string => displayMetric(point, metric, response.usd_decimals);
  // A dashed money total says WHY, and the true why: the book was withheld, the hour did not state the figure, or
  // the figure fails its wire guard. A stated figure carries its copy action: the exact string, whole.
  const money = (key: string, metric: "debt_usd" | "collateral_usd"): RecordRow => {
    const stated = metric === "debt_usd" ? point.debt_usd : point.collateral_usd;
    const unreadable = metricUnreadable(point, metric);
    const note = unreadable ? UNREADABLE_TOTAL_CLAUSE : stated !== null ? null : point.refused ? NULL_TOTAL_CLAUSE : UNSTATED_TOTAL_CLAUSE;
    const value = total(metric);
    const label = metricLabel(metric, engine);
    return {
      ...plain(key, label, value, note),
      noteTone: note === null ? "caption" : "state",
      copy: note === null && value !== EM_DASH ? copyOf(label, value) : null,
    };
  };

  const maxEpochAtCompute = readWirePopulation(point.max_epoch_at_compute, "max_epoch_at_compute");
  const ackedEpoch = readWirePopulation(point.acked_epoch, "acked_epoch");
  const unacked = maxEpochAtCompute - ackedEpoch > 0;
  const sweepUnrecorded = !point.sweep_recorded;
  const rates = point.rates.map(rateRowOf);
  const ratesOutside = rates.some((rate) => !rate.scaleStated);

  const reorgRow: RecordRow = {
    ...plain(
      "reorg",
      "Reorg posture at compute",
      unacked ? `${plural(maxEpochAtCompute - ackedEpoch, "unacked epoch")} · acked ${String(ackedEpoch)} of ${String(maxEpochAtCompute)}` : "None unacked",
      REORG_CLAUSE,
    ),
    tone: unacked ? "crit" : "neutral",
    testId: "history-point-epochs",
  };
  const sweepRow = sweepRowOf(point);
  const code = point.refusal_code ?? "unnamed";
  const stateRow: RecordRow = point.refused
    ? // The refusal code and its clause are the row's STATE, in the state ink — never the caption's.
      { ...plain("state", "State", "Withheld", ` · ${code} · ${WITHHELD_STATE_CLAUSE}`), noteTone: "state", tone: "refused" }
    : plain("state", "State", "Captured");
  const noun = engine === "debt_manager" ? "Accounts" : "Positions";

  const answer: RecordRow[] = [
    stateRow,
    money("debt", "debt_usd"),
    money("collateral", "collateral_usd"),
    plain("accounts", metricLabel("accounts", engine), total("accounts")),
    plain("refused-rows", `${noun} with no verdict`, groupInt(readWirePopulation(point.refused_positions, "refused_positions"))),
    plain("liquidatable", metricLabel("liquidatable_positions", engine), total("liquidatable_positions")),
    // Hazard rows surface in the answer, exactly when they bite.
    ...(unacked ? [reorgRow] : []),
    ...(sweepUnrecorded ? [sweepRow] : []),
  ];
  const hour = exactUtcTitle(point.bucket_start);
  const forensic: RecordRow[] = [
    { ...plain("bucket", "Hour (its own as-of)", hour.text), title: hour.title },
    plain("watermark", "Watermark", `block ${formatBlock(point.last_block)}`, WATERMARK_CLAUSE),
    { ...plain("batch", "Observed batch", `#${String(readWirePopulation(point.batch_id, "batch_id"))}`, BATCH_CLAUSE), testId: "history-point-batch" },
    {
      ...plain("key", "Materialization key", point.materialization_key, KEY_CLAUSE),
      mono: true,
      copy: copyOf("Materialization key", point.materialization_key),
      testId: "history-point-mkey",
    },
    ...(unacked ? [] : [reorgRow]),
    ...(sweepUnrecorded ? [] : [sweepRow]),
  ];
  // What the fold holds, COUNTED in its own summary: pure provenance (hour, watermark, batch, key) plus the
  // reorg/sweep rows and the rate table exactly when they carry no hazard.
  const forensicRowCount = 4 + (unacked ? 0 : 1) + (sweepUnrecorded ? 0 : 1);
  const ratesSuffix = ratesOutside ? "" : rates.length > 0 ? " + the rate snapshot" : " + the rate-snapshot note";
  return {
    ...base,
    absentNote: null,
    refusalCode: point.refused ? code : null,
    answer,
    forensicSummary: `${plural(forensicRowCount, "provenance row")}${ratesSuffix}`,
    forensic,
    rates,
    ratesEmpty:
      rates.length > 0
        ? null
        : `No rate snapshot was captured with this hour${point.refused ? " (the whole book was withheld)" : ""}.`,
    ratesOutside,
  };
}
