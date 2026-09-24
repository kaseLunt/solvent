// The Scenarios verdict header's sentences (spec §3.5 templates).
// Every state the workspace can be in has its own sentence. None of the states without a result is a verdict: a
// refusal by the service or the engine wears the refused register, and every other absence — not run, running, not
// served, a failed fetch — the absent one, because a fetch that failed is never a refusal. Money is the Book's tiers:
// a book-level figure is never printed to the cent.
import { humanUsd, MINUS } from "./human-usd";
import { engineName } from "./inspector-headline";
import { LEGACY } from "./inspector-position";
import type { CompareRow, CompareView } from "./lab-compare";
import type { HeatmapView } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";

export interface LabHeadline {
  readonly emphasis: string;
  readonly rest: string;
  readonly tone: "crit" | "warn" | "ok" | "neutral" | "refused" | "absent";
  readonly dek: string;
}

/** The text as given, ended with a full stop unless it already ends a sentence. */
export function terminated(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** A sentence of its own: capitalised and terminated. */
export function sentence(text: string): string {
  const t = terminated(text);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const accounts = (n: number): string => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
/** A refusal's headline — the service or the engine declined to answer: the refused register and no rest, in book mode and one-address mode alike. */
export const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });
/** No answer here — not run, running, not served, a fetch that failed: the absent register, never worn as a refusal. */
export const absent = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "absent", dek });

/** A signed count in the money formatters' convention: a negative prints the true minus; a count at or above zero prints as the count it is — no plus, because a count is not a delta. */
export function signedCount(n: number): string {
  return n < 0 ? `${MINUS}${groupInt(-n)}` : groupInt(n);
}

/** The page's word for a figure whose scale the wire guard refused: a figure prints at no other scale than its own. */
export { UNREADABLE_SCALE } from "./money";

export interface ResultFigures {
  readonly label: string;
  readonly decimals: number;
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly deltaEligibleDebt: bigint;
  readonly deltaBadDebt: bigint;
  /** Null when the matrix contradicted itself; then `heatReason` says why. */
  readonly heat: HeatmapView | null;
  readonly heatReason: string | null;
}

function badDebtSentence(f: ResultFigures): string {
  if (f.deltaBadDebt > 0n) {
    return `Bad debt would rise by ${humanUsd(f.deltaBadDebt, f.decimals)} if all ${groupInt(f.afterEligible)} were liquidated at the shocked prices.`;
  }
  if (f.deltaBadDebt < 0n) return `Bad debt at liquidation would fall by ${humanUsd(-f.deltaBadDebt, f.decimals)}.`;
  return "Bad debt at liquidation does not change.";
}

function movementSentence(h: HeatmapView): string {
  if (h.bandChanged === 0) return "";
  const n = groupInt(h.bandChanged);
  const verb = h.bandChanged === 1 ? "moves" : "move";
  if (h.improved === 0) return ` ${n} ${h.bandChanged === 1 ? "account" : "accounts"} ${verb} to a worse band; none improve.`;
  return ` ${n} ${h.bandChanged === 1 ? "account changes" : "accounts change"} band; ${groupInt(h.improved)} improve${h.improved === 1 ? "s" : ""}.`;
}

function nearSentence(h: HeatmapView): string {
  // Silent when nothing moved: the headline already said so, and "none cross it" would restate it.
  if (h.nearLabel === null || h.nearToday === 0 || h.bandChanged === 0) return "";
  const who = h.nearToday === 1 ? `the 1 account within ${h.nearLabel} of its cap today` : `the ${groupInt(h.nearToday)} accounts within ${h.nearLabel} of their cap today`;
  const crossed = h.nearCrossed === 0 ? "none" : h.nearCrossed === h.nearToday ? `all ${groupInt(h.nearCrossed)}` : groupInt(h.nearCrossed);
  return ` Of ${who}, ${crossed} cross it.`;
}

/** The wire's net below zero, as a count of accounts: "{n} fewer Cash accounts are liquidatable", in the singular when it is one. */
const fewer = (n: number): string => `${groupInt(n)} fewer Cash account${n === 1 ? " is" : "s are"} liquidatable`;

/**
 * The tone of the newly-liquidatable figure, the headline's and its tile's alike, so the two can never disagree: crit
 * when the net is above zero; at or below zero the net says nothing of the accounts that crossed the cap while others
 * left it, so crossings in the lanes are warn; fewer liquidatable with none crossing is ok; a net of zero is ok only
 * when no account changes band, and warn when any does.
 */
export function newlyTone(newly: number, heat: HeatmapView | null): "crit" | "warn" | "ok" {
  if (newly > 0) return "crit";
  if ((heat?.crossedCap ?? 0) > 0) return "warn";
  if (newly < 0) return "ok";
  return (heat?.bandChanged ?? 0) === 0 ? "ok" : "warn";
}

export function resultHeadline(f: ResultFigures): LabHeadline {
  const tone = newlyTone(f.newly, f.heat);
  const movement =
    f.heat === null
      ? f.heatReason === null
        ? ""
        : ` Where accounts move could not be read: ${f.heatReason}.`
      : `${movementSentence(f.heat)}${nearSentence(f.heat)}`;
  const dek = `${badDebtSentence(f)}${movement}`;
  if (f.newly > 0 && f.deltaEligibleDebt > 0n) {
    return { emphasis: `${humanUsd(f.deltaEligibleDebt, f.decimals)} more Cash debt becomes liquidatable,`, rest: `across ${accounts(f.newly)}.`, tone, dek };
  }
  if (f.newly > 0) return { emphasis: `${accounts(f.newly)} become${f.newly === 1 ? "s" : ""} liquidatable under ${f.label}.`, rest: "", tone, dek };
  // The wire's count is a NET: at or below zero it says nothing of the accounts that crossed the cap while others left
  // it. Where the merged lanes show crossings, the net and the gross are both stated, and neither is worded as a "no".
  const crossed = f.heat?.crossedCap ?? 0;
  if (crossed > 0) {
    const net = f.newly === 0 ? "no more Cash accounts are liquidatable" : fewer(-f.newly);
    return { emphasis: `Net, ${net} under ${f.label},`, rest: `though ${accounts(crossed)} cross${crossed === 1 ? "es" : ""} the cap.`, tone, dek };
  }
  if (f.newly < 0) return { emphasis: `${fewer(-f.newly)} under ${f.label}.`, rest: "", tone, dek };
  const moves = f.heat?.bandChanged ?? 0;
  if (moves === 0) return { emphasis: `No Cash account changes band under ${f.label}.`, rest: "", tone, dek };
  return { emphasis: `No Cash account becomes liquidatable under ${f.label},`, rest: `but ${groupInt(moves)} change${moves === 1 ? "s" : ""} band.`, tone, dek };
}

/**
 * A served scenario that has not been run: the absent register and the one way forward, which the Run button beside
 * it takes. A scenario that does not model Cash is never promised a Cash answer. The definition's own description and
 * path assumption are the drawer's.
 */
export function notRunHeadline(name: string, coversCash: boolean): LabHeadline {
  return absent(
    `${name} has not been run.`,
    coversCash ? "Run it to see how much Cash debt becomes liquidatable and which accounts move." : "It does not model the Cash book; run it to see the legacy market’s result below.",
  );
}

export const runningHeadline = (name: string): LabHeadline =>
  absent(`Running ${name}…`, "One evaluation against the newest complete batch; nothing is written.");

export const withheldHeadline = (label: string, cause: string): LabHeadline =>
  refused(`Cannot say — the Cash book is withheld under ${label}.`, `${sentence(cause)} A withheld book is not a computed book, and this page never fills it in.`);

/** An engine as the object of "models": the legacy market takes its article; any other engine is named as `engineName` names it. */
const modelled = (id: string): string => (id === LEGACY ? `the ${engineName(id)}` : engineName(id));

export function notCoveredHeadline(label: string, engines: readonly string[], legacyBelow: boolean): LabHeadline {
  const models = engines.length === 0 ? "It models no engine this deployment serves." : `It models ${joinAnd(engines.map(modelled))}.`;
  return absent(`${label} does not model the Cash book.`, legacyBelow ? `${models} The legacy result is below.` : models);
}

export const contradictoryHeadline = (label: string, reasons: readonly string[]): LabHeadline =>
  refused(`The result for ${label} contradicts itself.`, `${reasons.join("; ")}. Nothing from it is drawn.`);

export const definitionChangedHeadline = (label: string, fields: readonly string[]): LabHeadline =>
  absent(`${label} changed since this result was computed.`, `Changed: ${joinAnd(fields)}. Run it again for the current definition.`);

export type FailureKind = "not-served" | "no-batch" | "rate-limited" | "busy" | "unreachable" | "failed" | "refused-locally";
export interface FailureDetail {
  readonly message?: string;
  readonly retryAfterSeconds?: number | null;
  readonly status?: number;
  readonly inFlight?: number | null;
  readonly maxInFlight?: number | null;
}

function retry(seconds: number | null | undefined): string {
  return typeof seconds === "number" ? `Retry after ${String(seconds)}s.` : "The service did not say when to retry.";
}

export function failureHeadline(kind: "failed", d: FailureDetail & { readonly status: number }): LabHeadline;
export function failureHeadline(kind: Exclude<FailureKind, "failed">, d: FailureDetail): LabHeadline;
export function failureHeadline(kind: FailureKind, d: FailureDetail): LabHeadline {
  switch (kind) {
    case "not-served":
      return absent("Book-wide stress is not served by this deployment.", "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.");
    case "no-batch":
      return absent("No servable batch.", `${sentence(d.message ?? "no complete risk batch is available").replace(/\.$/, "")} (503). ${retry(d.retryAfterSeconds)}`);
    // A throttle and a busy slot are reads that did not complete, not the service declining the book: the absent
    // register, as every other surface prints the same status.
    case "rate-limited":
      return absent("Rate limited (429).", retry(d.retryAfterSeconds));
    case "busy": {
      const slots =
        typeof d.inFlight === "number" && typeof d.maxInFlight === "number"
          ? `${String(d.inFlight)} of ${String(d.maxInFlight)} slots in use.`
          : "The service did not state its capacity.";
      return absent("The evaluator is busy.", `${sentence(d.message ?? "busy")} ${slots}`);
    }
    case "unreachable":
      return absent("The service could not be reached.", sentence(d.message ?? "no HTTP response"));
    case "failed": {
      // The overload makes the status a requirement of this arm: "answered" never prints without its number. A 4xx is
      // the service declining the request; a 5xx is an answer that did not come.
      const status = d.status ?? 0;
      return (status >= 500 ? absent : refused)(`The service answered ${String(d.status)}.`, sentence(d.message ?? "without the contract's error envelope"));
    }
    case "refused-locally":
      return refused("Nothing was sent.", sentence(d.message ?? "the request was refused before dispatch"));
  }
}

/** A failure's own words inside a sentence about what it left standing: its emphasis, its rest where it has one, its dek. */
const failureWords = (failure: LabHeadline | null): string =>
  failure === null ? "the service gave no reason." : [failure.emphasis, failure.rest, failure.dek].filter((part) => part !== "").join(" ");

/**
 * A re-run that failed over what it did not replace, in one shape for the page's two actions: the action, the
 * failure's own words, then what stands below and for which batch. A computed result is never replaced by a failure.
 */
const rerunFailedLine = (action: "Run" | "Compare", failure: LabHeadline | null, stands: string): string => `${action} again failed — ${failureWords(failure)} ${stands}`;

/** A failed Compare with nothing held beneath it: the failure's own words are the finding. */
export const compareFailedLine = (failure: LabHeadline): string => failureWords(failure);

/** A failed Compare over the comparison it left standing: the failure named, and the batch the dots below are for. */
export const compareRerunFailedLine = (failure: LabHeadline, batchId: number): string =>
  rerunFailedLine("Compare", failure, `The comparison below stands for batch ${groupInt(batchId)}.`);

/** What stands over a result that keeps its figures, or beside a retained body that is not shown. */
export type Banner = "stale-input" | "superseded" | "rerun-failed" | "retained-refused" | null;
/** The held result's own condition, said beside the failure that left it standing. */
export type HeldCondition = "stale-input" | "superseded" | null;
/** A retained body the page does not show: its definition changed since it was computed. */
export interface Retained {
  readonly batchId: number;
  readonly skew: readonly string[];
}

export interface StaleBannerInput {
  readonly kind: Exclude<Banner, null>;
  readonly skew: readonly string[];
  /** The batch of the result the banner sits on; null only where no result is shown. */
  readonly batchId: number | null;
  readonly failure: LabHeadline | null;
  readonly heldCondition: HeldCondition;
  readonly retained: Retained | null;
}

/**
 * The banner's sentence. A result for a previous input, a superseded batch, or a re-run that failed keeps its
 * figures, and the banner says which — and, when a failure left a held result standing, the held result's own
 * condition beside it. A retained body the page does not show (its definition changed) is disclosed, never mistaken
 * for the answer. A result is never silently replaced.
 */
export function staleBannerLine(b: StaleBannerInput): string {
  const superseded = `${b.batchId === null ? "Its batch" : `Batch ${groupInt(b.batchId)}`} has been superseded: a newer complete batch exists.`;
  const stale = `Results for a previous input: the listing's ${joinAnd(b.skew)} changed since this run.`;
  switch (b.kind) {
    case "superseded":
      return `${superseded} This result stands for the batch it names.`;
    case "stale-input":
      return `${stale} This result stands for the definition it was computed under.`;
    case "rerun-failed": {
      const stands = `The result below stands for ${b.batchId === null ? "the batch it names" : `batch ${groupInt(b.batchId)}`}.`;
      const condition = b.heldCondition === "superseded" ? ` ${superseded}` : b.heldCondition === "stale-input" ? ` ${stale}` : "";
      return `${rerunFailedLine("Run", b.failure, stands)}${condition}`;
    }
    case "retained-refused":
      return b.retained === null
        ? "A result is retained but not shown: its definition changed since it was computed. The failure above is this request's own."
        : `A result for batch ${groupInt(b.retained.batchId)} is retained but not shown: the definition's ${joinAnd(b.retained.skew)} changed since it was computed. The failure above is this request's own.`;
  }
}

/** The book a compare view is a share of, as the sentences name it: "Cash" for the Cash engine, "legacy" for the legacy market. */
const compareBook = (engine: string): string => (engine === LEGACY ? "legacy" : engineName(engine));

const COMPARE_KIND_WORD: Record<Exclude<CompareRow["kind"], "point" | "not-covered">, string> = {
  projection: "projection, no spot pass",
  withheld: "withheld",
  unmeasurable: "unmeasurable",
  contradictory: "contradictory",
  "no-denominator": "no denominator",
  unreadable: "unreadable",
};

/**
 * A compare row's words, the value column's and the finding's alike. A point is its share, then its absolute delta.
 * A refusal is the kind's word, the wire's reason in brackets unless it is the word itself; not covered is said for
 * the engine, once. A refusal of the share is not a refusal of the figure: where the wire gave a delta, it stands
 * beside the word. The share's denominator is the caption's word, never the row's.
 */
export function compareRowWords(row: CompareRow, engine: string): string {
  if (row.kind === "point") return `${row.shareText} · ${row.deltaText}`;
  const word = row.kind === "not-covered" ? `not modelled for ${engine === LEGACY ? "the legacy market" : engineName(engine)}` : COMPARE_KIND_WORD[row.kind];
  const reason = row.kind === "not-covered" || row.reason === null || row.reason === word ? "" : ` (${row.reason})`;
  const delta = row.deltaUsd === null ? "" : ` · ${row.deltaText}`;
  return `${word}${reason}${delta}`;
}

/** A compare row's words as its value cell prints them: a standalone line, so it starts with a capital. */
export function compareCellWords(row: CompareRow, engine: string): string {
  const words = compareRowWords(row, engine);
  return words.charAt(0).toUpperCase() + words.slice(1);
}


/** The wire's freshness states other than the newest, in the caption's words: what was true of the evaluated batch when the response was built. */
const COMPARE_FRESHNESS: Record<Exclude<CompareView["freshness"], "still_newest">, string> = {
  superseded: "superseded",
  newest_is_older: "the newest servable batch is now older",
  none_servable: "no batch was servable when probed",
};

/** One line of plain words under the plot: what the shares are shares of, and the batch — its freshness named only when it is not the newest. */
export function compareCaption(view: CompareView): string {
  const book = compareBook(view.engine);
  const batch = `batch ${groupInt(view.batchId)}${view.freshness === "still_newest" ? "" : ` — ${COMPARE_FRESHNESS[view.freshness]}`}`;
  return `Change in liquidatable ${book} debt per scenario, as a share of the ${book} book (${batch}).`;
}

/**
 * A set whose membership does not answer the request: every fault in one sentence behind a fixed lead, the dashed
 * tone, nothing drawn. The lead is fixed so a fault that begins with a scenario id is never recapitalised: the
 * config is the law, and the page does not rename it.
 */
export const setMembershipHeadline = (faults: readonly string[]): LabHeadline =>
  refused("The set does not answer the request.", `Faults: ${terminated(faults.join("; "))} Nothing from it is drawn.`);

/**
 * A set that answers its request and does not read — an engine figure outside the contract, or a result whose parts
 * do not partition its coverage: every fault in one sentence behind a fixed lead, each under the scenario it sits
 * in, the dashed tone, nothing drawn.
 */
export const setUnreadableHeadline = (faults: readonly string[]): LabHeadline =>
  refused("The set cannot be read.", `Faults: ${terminated(faults.join("; "))} Nothing from it is drawn.`);

export const LISTING_LOADING: LabHeadline = absent(
  "Loading the committed scenarios…",
  "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed.",
);

export const listingUnavailableHeadline = (message: string): LabHeadline =>
  absent("The committed scenarios could not be listed.", `${sentence(message)} Nothing can run until the listing answers.`);

/**
 * A listing that answered and cannot be read: not a failed fetch ("could not be listed") and not an empty set — the
 * service answered 2xx with a body outside the wire contract, every fault named behind the fixed lead.
 */
export const listingUnreadableHeadline = (faults: readonly string[]): LabHeadline =>
  refused("The committed scenarios could not be read.", `Faults: ${terminated(faults.join("; "))} Nothing can run until the listing reads.`);

/** An empty listing is the listing's own answer, stated in ink. */
export const EMPTY_LISTING: LabHeadline = { emphasis: "No committed scenarios are listed.", rest: "", tone: "neutral", dek: "This deployment serves an empty committed set. Nothing can run." };
