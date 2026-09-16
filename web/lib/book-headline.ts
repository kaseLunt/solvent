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
  readonly notComputed: number;
}

export interface Headline {
  readonly variant: "material" | "quiet" | "refused";
  readonly tone: "crit" | "ok" | "refused";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export function nearCapSentence(nearCap: Sum, decimals: number): string {
  if (nearCap.count === 0) return "No account is within 10% of its borrow cap.";
  const one = nearCap.count === 1;
  return `${plural(nearCap.count, "account")} ${one ? "is" : "are"} within 10% of ${one ? "its" : "their"} borrow cap, carrying ${humanUsd(nearCap.sum, decimals)}.`;
}

export function notComputedSentence(n: number): string | null {
  if (n === 0) return null;
  const one = n === 1;
  return `${plural(n, "position")} could not be computed this batch and ${one ? "is" : "are"} counted, not hidden.`;
}

function joinSentences(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(" ");
}

export function bookHeadline(input: BookHeadlineInput): Headline {
  const below = belowLineSentence({ belowLine: input.belowLine.count }, { belowLine: input.belowLine.sum }, input.decimals);
  const near = nearCapSentence(input.nearCap, input.decimals);
  const notComputed = notComputedSentence(input.notComputed);
  if (input.material.count > 0) {
    return {
      variant: "material",
      tone: "crit",
      emphasis: `${humanUsd(input.material.sum, input.decimals)} of Cash debt is liquidatable right now,`,
      rest: ` across ${plural(input.material.count, "account")}.`,
      dek: joinSentences([below, near, notComputed]),
    };
  }
  return {
    variant: "quiet",
    tone: "ok",
    emphasis: "Nothing material is liquidatable on the Cash book right now.",
    rest: "",
    dek: joinSentences([below ?? "No position is liquidatable.", near, notComputed]),
  };
}

export function bookHeadlineRefused(cause: string): Headline {
  const trimmed = cause.trim();
  const first = trimmed.charAt(0).toUpperCase();
  const sentence =
    trimmed.length === 0 ? "The engine gave no reason." : `${first}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
  return { variant: "refused", tone: "refused", emphasis: "The Cash book could not be computed this batch.", rest: "", dek: sentence };
}
