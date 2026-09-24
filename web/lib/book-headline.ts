import { humanUsd } from "./human-usd";
import { belowLineSentence } from "./materiality";

export interface Sum {
  readonly sum: bigint;
  readonly count: number;
}

export interface BookHeadlineInput {
  readonly decimals: number;
  readonly material: Sum;
  readonly belowLine: Sum;
  readonly nearCap: Sum;
  /** Accounts the batch refused, from the book's own aggregate (one Cash position is one account). */
  readonly notComputed: number;
  /**
   * At least one refused row has landed and none carries a debt figure. Absent means nothing is said about their
   * debt: a refused row served with a figure makes any sentence about absence false.
   */
  readonly refusedDebtUnserved?: boolean;
  /** Accounts the walk has read with a known verdict. */
  readonly computed: number;
  /**
   * Rows the engine calls computed that this page could not read. Absent means none. One of them is enough to
   * withhold every negative: a row nobody could read is not a row that was cleared.
   */
  readonly unreadable?: number;
  /** The walk reached its last page. Only a complete walk, read whole, may claim a negative over the book. */
  readonly complete: boolean;
  /** The walk stopped before it was complete, with this cause; null while it runs or once it is complete. */
  readonly stopped: string | null;
  /** How that walk ended; null exactly when `stopped` is. */
  readonly stopKind: WalkStopKind | null;
}

/**
 * How a walk that did not complete ended — the dek words what happened, never
 * one frame for all three. "before-end": the walk never read its last page (a
 * failed request, a moved batch, a page that could not be read, a census
 * fault mid-walk). "at-end": it reached its last page and its rows do not
 * reconcile with the census the wire advertised. "over": it delivered more
 * rows than the census, on any page — it landed accounts the census does not
 * count. "duplicate": a page delivered an account the walk had already read —
 * pages that repeat an account do not partition the book, and the two readings
 * of that account cannot both stand. Over the last two, no figure is a total
 * OR a lower bound.
 */
export type WalkStopKind = "before-end" | "at-end" | "over" | "duplicate";

export interface Headline {
  readonly variant: "material" | "quiet" | "refused" | "pending";
  /**
   * `refused` when the engine declined to answer; `absent` when there is simply no answer to show yet or here — a read
   * in flight, a fetch that failed, a walk that stopped, an answer this page could not read. One look, two words: a
   * fetch failure is never a refusal.
   */
  readonly tone: "crit" | "ok" | "refused" | "absent";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** A reason as one sentence: capitalized, terminated, or the fallback when the wire gave none. */
export function asSentence(reason: string, fallback: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return fallback;
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
}

/**
 * The near-cap sentence. A negative over the book ("no account is within
 * 10%") is claimed only by a complete walk; a count of zero mid-walk is
 * silence, not a finding. A positive count is stated whenever it is known.
 */
export function nearCapSentence(nearCap: Sum, decimals: number, complete = true): string | null {
  if (nearCap.count === 0) return complete ? "No account is within 10% of its borrow cap." : null;
  const one = nearCap.count === 1;
  return `${plural(nearCap.count, "account")} ${one ? "is" : "are"} within 10% of ${one ? "its" : "their"} borrow cap, carrying ${humanUsd(nearCap.sum, decimals)}.`;
}

/**
 * The no-verdict sentence, true of every refusal code: a cause may be permanent, so it says what the batch holds — no
 * verdict — and never that the accounts "could not be computed this batch". Where no refused row carries a debt
 * figure it says their debt is not known, so a column of dashes cannot read as a table still loading; it is never a
 * zero and never a sum. It states facts only: that these accounts are counted, never hidden, is said once, in the
 * Methodology drawer.
 */
export function notComputedSentence(n: number, debtUnserved = false): string | null {
  if (n === 0) return null;
  const one = n === 1;
  const noVerdict = `${plural(n, "account")} ${one ? "has" : "have"} no verdict in this batch`;
  return debtUnserved ? `${noVerdict}; ${one ? "its" : "their"} debt is not known.` : `${noVerdict}.`;
}

/**
 * The unreadable rows' sentence. The engine computed these accounts and refused nothing: what failed is this page's
 * reading of them, and the sentence says so — never among the refused accounts.
 */
export function unreadableSentence(n: number): string | null {
  if (n === 0) return null;
  return `${plural(n, "account")} the engine calls computed could not be read by this page.`;
}

/** A stop cause as parenthetical words: trimmed, unterminated, or the fallback when the wire gave none. */
function causeWords(stopped: string): string {
  const trimmed = stopped.trim().replace(/\.$/, "");
  return trimmed.length === 0 ? "the service gave no reason" : trimmed;
}

/** What happened to a walk that did not complete, in the stop's own frame — one frame is never said of all four endings. */
export function stopWords(kind: WalkStopKind | null): string {
  if (kind === "at-end") return "The walk reached its last page and its rows do not reconcile with the census";
  if (kind === "over") return "The walk ran past its census";
  if (kind === "duplicate") return "The walk was served an account twice";
  return "The walk stopped before the last page";
}

/** The same frame as the clause that opens the dek, with the stop's cause. */
export function stopFrame(kind: WalkStopKind | null, stopped: string): string {
  return `${stopWords(kind)} (${causeWords(stopped)})`;
}

/** Why no figure over a walk that ended this way is a total or a lower bound; null for an ending whose rows still bound the book. */
function noBoundReason(kind: WalkStopKind | null): string | null {
  if (kind === "over") return "it landed more accounts than the census counts";
  if (kind === "duplicate") return "pages that repeat an account do not partition the book";
  return null;
}

/**
 * How far the reading got, when it did not read the whole book. A running
 * walk and a walk that stopped short read distinct accounts, so every figure
 * is a lower bound and the dek says so — as does a complete walk that landed
 * a row this page could not read. A walk past its census, or one served an
 * account twice, cannot say that: a sum over its rows bounds nothing.
 */
export function walkSentence(
  input: Pick<BookHeadlineInput, "complete" | "stopped" | "stopKind" | "computed" | "unreadable">,
): string | null {
  const read = plural(input.computed, "computed account");
  if (input.complete) {
    return (input.unreadable ?? 0) > 0 ? `Every figure is a lower bound over the ${read} this page could read.` : null;
  }
  if (input.stopped === null) return `The walk is still running; every figure is a lower bound over the ${read} read so far.`;
  const frame = stopFrame(input.stopKind, input.stopped);
  const noBound = noBoundReason(input.stopKind);
  return noBound !== null
    ? `${frame}; ${noBound}, so no figure here is a total or a lower bound.`
    : `${frame}; every figure is a lower bound over the ${read} it read.`;
}

/**
 * The census fault's words: the walk's delivered rows disagree with the census
 * the wire advertised. A short walk delivered "N of the M rows"; a walk past
 * its census delivered N rows FOR a census of M — "N of the M" is a part of a
 * whole, and is never said of an N larger than M.
 */
export function censusFaultWords(delivered: number, census: number): string {
  return delivered > census
    ? `the walk delivered ${plural(delivered, "row")} for a census of ${String(census)}`
    : `the walk delivered ${String(delivered)} of the ${String(census)} rows the wire advertised`;
}

/**
 * The duplicate fault's words: WHICH account, and on WHICH pages — the first
 * delivery and the one that repeated it (1-based, in walk order) — and how
 * many further rows of that page repeated an account. The account is printed
 * as the repeating page spelled it; identity itself ignores the address's case.
 */
export function duplicateFaultWords(account: string, firstPage: number, againPage: number, others = 0): string {
  const where =
    firstPage === againPage
      ? `twice on page ${String(againPage)}`
      : `on page ${String(firstPage)} and again on page ${String(againPage)}`;
  const more = others === 0 ? "" : `, and ${plural(others, "more repeated row")} on that page`;
  return `account ${account} was delivered ${where}${more}`;
}

function joinSentences(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(" ");
}

/**
 * The Book's headline. A positive finding stands as soon as it is read (the
 * walk lands the least room first); a negative — nothing material, no
 * account liquidatable, no account near cap — is claimed only over the
 * computed accounts of a complete walk whose every row this page could read.
 * An unfinished walk is pending, a stopped one is named, refused accounts are
 * never inside a negative — and one unreadable row withholds them all: the
 * engine computed it, and nobody here knows what it says.
 */
export function bookHeadline(input: BookHeadlineInput): Headline {
  const unreadable = input.unreadable ?? 0;
  const below = belowLineSentence({ belowLine: input.belowLine.count }, { belowLine: input.belowLine.sum }, input.decimals);
  const near = nearCapSentence(input.nearCap, input.decimals, input.complete && unreadable === 0);
  const notComputed = notComputedSentence(input.notComputed, input.refusedDebtUnserved ?? false);
  const unread = unreadableSentence(unreadable);
  const walk = walkSentence(input);
  if (input.material.count > 0) {
    return {
      variant: "material",
      tone: "crit",
      emphasis: `${humanUsd(input.material.sum, input.decimals)} of Cash debt is liquidatable right now,`,
      rest: ` across ${plural(input.material.count, "account")}.`,
      dek: joinSentences([below, near, notComputed, unread, walk]),
    };
  }
  if (!input.complete) {
    const readSoFar =
      input.computed === 0
        ? "No page has landed yet."
        : `Nothing material is liquidatable among the ${plural(input.computed, "computed account")} read so far.`;
    if (input.stopped === null) {
      return {
        variant: "pending",
        tone: "absent",
        emphasis: "Walking the Cash book…",
        rest: "",
        dek: joinSentences([readSoFar, "The verdict settles when the walk ends.", below, notComputed, unread]),
      };
    }
    return {
      variant: "refused",
      tone: "absent",
      emphasis: "The Cash book could not be fully read this batch.",
      rest: "",
      dek: joinSentences([
        `${stopFrame(input.stopKind, input.stopped)}.`,
        readSoFar,
        "No verdict is claimed over the rest.",
        below,
        notComputed,
        unread,
      ]),
    };
  }
  if (unreadable > 0) {
    // The walk is complete and a row on it could not be read: no all-clear, in any of its forms, is said over it.
    return {
      variant: "refused",
      tone: "absent",
      emphasis: "The Cash book could not be fully read this batch.",
      rest: "",
      dek: joinSentences([unread, `No verdict is claimed over ${unreadable === 1 ? "it" : "them"}.`, below, near, notComputed]),
    };
  }
  if (input.computed === 0 && input.notComputed > 0) {
    return {
      variant: "refused",
      tone: "refused",
      emphasis: "No Cash account could be computed this batch.",
      rest: "",
      dek: joinSentences([notComputed]),
    };
  }
  // Refused accounts are counted beside the negative, never inside it.
  const negative = input.notComputed > 0 ? "No computed account is liquidatable." : "No account is liquidatable.";
  return {
    variant: "quiet",
    tone: "ok",
    emphasis: "Nothing material is liquidatable on the Cash book right now.",
    rest: "",
    dek: joinSentences([below ?? negative, near, notComputed]),
  };
}

export function bookHeadlineRefused(cause: string): Headline {
  return {
    variant: "refused",
    tone: "refused",
    emphasis: "The Cash book could not be computed this batch.",
    rest: "",
    dek: asSentence(cause, "The engine gave no reason."),
  };
}
