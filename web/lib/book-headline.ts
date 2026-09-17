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
  /** Positions the batch refused, from the book's own aggregate. */
  readonly notComputed: number;
  /** Accounts the walk has read with a known verdict. */
  readonly computed: number;
  /** The walk reached its last page. Only a complete walk may claim a negative over the book. */
  readonly complete: boolean;
  /** The walk stopped before its last page, with this cause; null while it runs or once it is complete. */
  readonly stopped: string | null;
}

export interface Headline {
  readonly variant: "material" | "quiet" | "refused" | "pending";
  readonly tone: "crit" | "ok" | "refused";
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

export function notComputedSentence(n: number): string | null {
  if (n === 0) return null;
  const one = n === 1;
  return `${plural(n, "position")} could not be computed this batch and ${one ? "is" : "are"} counted, not hidden.`;
}

/** A stop cause as parenthetical words: trimmed, unterminated, or the fallback when the wire gave none. */
function causeWords(stopped: string): string {
  const trimmed = stopped.trim().replace(/\.$/, "");
  return trimmed.length === 0 ? "the service gave no reason" : trimmed;
}

/** How far the walk got, when it did not get to the end: every figure is then a lower bound, and the dek says so. */
export function walkSentence(input: Pick<BookHeadlineInput, "complete" | "stopped" | "computed">): string | null {
  if (input.complete) return null;
  const read = plural(input.computed, "computed account");
  return input.stopped === null
    ? `The walk is still running; every figure is a lower bound over the ${read} read so far.`
    : `The walk stopped before the last page (${causeWords(input.stopped)}); every figure is a lower bound over the ${read} it read.`;
}

function joinSentences(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(" ");
}

/**
 * The Book's headline. A positive finding stands as soon as it is read (the
 * walk lands the least room first); a negative — nothing material, no
 * position liquidatable, no account near cap — is claimed only over the
 * computed accounts of a complete walk. An unfinished walk is pending, a
 * stopped one is named, and refused accounts are never inside a negative.
 */
export function bookHeadline(input: BookHeadlineInput): Headline {
  const below = belowLineSentence({ belowLine: input.belowLine.count }, { belowLine: input.belowLine.sum }, input.decimals);
  const near = nearCapSentence(input.nearCap, input.decimals, input.complete);
  const notComputed = notComputedSentence(input.notComputed);
  const walk = walkSentence(input);
  if (input.material.count > 0) {
    return {
      variant: "material",
      tone: "crit",
      emphasis: `${humanUsd(input.material.sum, input.decimals)} of Cash debt is liquidatable right now,`,
      rest: ` across ${plural(input.material.count, "account")}.`,
      dek: joinSentences([below, near, notComputed, walk]),
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
        tone: "refused",
        emphasis: "Walking the Cash book…",
        rest: "",
        dek: joinSentences([readSoFar, "The verdict settles when the walk ends.", below, notComputed]),
      };
    }
    return {
      variant: "refused",
      tone: "refused",
      emphasis: "The Cash book could not be fully read this batch.",
      rest: "",
      dek: joinSentences([
        `The walk stopped before the last page (${causeWords(input.stopped)}).`,
        readSoFar,
        "No verdict is claimed over the rest.",
        below,
        notComputed,
      ]),
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
  const negative = input.notComputed > 0 ? "No computed position is liquidatable." : "No position is liquidatable.";
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
