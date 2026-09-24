// web/lib/inspector-headline.ts
// The Inspector's verdict sentences (spec 2026-09-15 §3.5).
// One source per state; the surface renders these strings verbatim and the
// e2e contract pins them. Money through humanUsdFull (never compacted), percents from the position.
import { humanAge } from "./freshness";
import { humanUsdFull } from "./human-price";
import { CASH, LEGACY, type ComputedCash } from "./inspector-position";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import type { Streak } from "./room-history";

export type InspectorVariant =
  | "liquidatable"
  | "near"
  | "healthy"
  | "no-position"
  | "cannot-compute"
  | "not-computed"
  | "other-engine"
  | "loading"
  | "unavailable"
  | "invalid";

/**
 * A headline that states an answer is ink or its verdict's tone — a definitive empty answer ("No Cash or Aave
 * position") included. One that states there is no answer is the absent register, whole line: `refused` when the
 * engine or the service withheld or refused it, `absent` when there is simply none here (in flight, a failed lookup).
 */
export interface InspectorHeadline {
  readonly variant: InspectorVariant;
  readonly tone: "crit" | "warn" | "ok" | "neutral" | "refused" | "absent";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

/** The same words the kit's AddressField shows; kept here so lib never imports a component. */
export const INVALID_ADDRESS_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

/** A fragment as one sentence: capitalised once, ending in exactly one period. An empty fragment is no sentence. */
const sentence = (fragment: string): string => {
  const t = fragment.trim().replace(/\.$/u, "");
  return t.length === 0 ? "" : `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
};

/** Sentences joined by one space; an empty sentence leaves no gap. */
const paragraph = (...sentences: readonly string[]): string => sentences.filter((s) => s.length > 0).join(" ");

export function engineName(wire: string): string {
  if (wire === CASH) return "Cash";
  if (wire === LEGACY) return "Aave v3 market (legacy)";
  return wire;
}

export function cashHeadline(p: ComputedCash, extras: { streak: Streak | null; floor: string | null }): InspectorHeadline {
  const money = (v: bigint): string => humanUsdFull(v, p.decimals);
  // A zero cap has no percent to print (usedPercent is null): the clause is omitted, never a placeholder.
  const used = p.usedPercent === null ? "" : ` — ${p.usedPercent} used`;
  const base = `Borrowing ${money(p.debt)} against a ${money(p.cap)} cap${used}.`;
  const floor = extras.floor === null ? "" : ` ${extras.floor}`;
  if (p.status === "liquidatable") {
    return {
      variant: "liquidatable",
      tone: "crit",
      emphasis: `Liquidatable now — ${money(p.debt)} against a ${money(p.cap)} cap.`,
      rest: "",
      dek: `${base} Over cap by ${money(-p.room)}: the strict rule is debt > cap.${floor}`,
    };
  }
  if (p.status === "near") {
    const s = extras.streak;
    // A non-positive span is no span: the parenthesis prints only for a positive one.
    const span = s !== null && s.spanSeconds !== null && s.spanSeconds > 0 ? ` (≈${humanAge(s.spanSeconds)})` : "";
    const streak = s !== null && s.batches >= 2 ? ` It has been within 10% of its cap for the last ${String(s.batches)} batches${span}.` : "";
    return {
      variant: "near",
      tone: "warn",
      emphasis: `Within ${money(p.room)} of its borrow cap.`,
      rest: "Not liquidatable yet.",
      // Room is floored to tenths and the rule is strict (debt > cap), so this fall or this debt reaches the cap — it does not cross it.
      dek: `${base} A ${p.roomPercent ?? "—"} fall in collateral value, or ${money(p.room)} more debt, brings this account to its cap.${streak}${floor}`,
    };
  }
  // near and healthy imply a positive cap (a band exists), so roomPercent is non-null here; the fallback is type honesty only.
  return {
    variant: "healthy",
    tone: "ok",
    emphasis: `${p.roomPercent ?? "—"} of its borrow cap unused.`,
    rest: "Not close to liquidation.",
    dek: `${base} Collateral value would have to fall ${p.roomPercent ?? "—"} before this account reaches its cap.${floor}`,
  };
}

export function noPositionHeadline(batchId: number): InspectorHeadline {
  return {
    variant: "no-position",
    tone: "neutral",
    emphasis: `No Cash or Aave position in batch ${groupInt(batchId)}.`,
    rest: "",
    dek: "The lookup was complete: every engine was available to be asked and none withheld its book, so this is a definitive answer for this batch.",
  };
}

export function cannotComputeHeadline(withheld: readonly { engine: string; code: string; detail: string }[]): InspectorHeadline {
  const names = withheld.map((w) => engineName(w.engine));
  const causes = Array.from(new Set(withheld.map((w) => plainCause(w.code, w.detail)))).join("; ");
  // No engine named is unreachable by the client's invariant; it still reads as a sentence.
  const books = names.length === 0 ? "the book is" : `the ${joinAnd(names)} book${names.length === 1 ? " is" : "s are"}`;
  return {
    variant: "cannot-compute",
    tone: "refused",
    emphasis: `Cannot say — ${books} withheld this batch.`,
    rest: "",
    dek: paragraph(sentence(causes), "A withheld book is never “no position”: this account may hold a position the service cannot currently read."),
  };
}

export function notComputedHeadline(cause: string, lastDebt: string | null): InspectorHeadline {
  return {
    variant: "not-computed",
    tone: "refused",
    emphasis: "Cannot say — this account's Cash position was not computed this batch.",
    rest: "",
    dek: paragraph(sentence(cause), lastDebt === null ? "No verdict is served for it." : `Its last readable debt is ${lastDebt}; no verdict is served for it.`),
  };
}

const LEGACY_DEK = "The legacy market is judged by its own health factor, below. The two books are never added together.";
const FOREIGN_DEK = "Only the Cash book and the legacy Aave v3 market are read here.";

export function otherEngineHeadline(batchId: number, engines: readonly string[]): InspectorHeadline {
  // Legacy is read on this page (its health factor renders below); every other engine is foreign to it.
  const foreign = engines.filter((e) => e !== LEGACY).map(engineName);
  const hasLegacy = foreign.length !== engines.length;
  const where = `No Cash position in batch ${groupInt(batchId)}`;
  if (hasLegacy) {
    const also =
      foreign.length === 0
        ? ""
        : foreign.length === 1
          ? `A position on ${joinAnd(foreign)} is not read here.`
          : `Positions on ${joinAnd(foreign)} are not read here.`;
    return {
      variant: "other-engine",
      tone: "neutral",
      emphasis: `${where}; a legacy Aave v3 position exists.`,
      rest: "",
      dek: paragraph(LEGACY_DEK, also),
    };
  }
  if (foreign.length === 0) {
    // Unreachable by the client's invariant (a found lookup names at least one engine); defensive.
    return { variant: "other-engine", tone: "neutral", emphasis: `${where}.`, rest: "", dek: FOREIGN_DEK };
  }
  return {
    variant: "other-engine",
    tone: "neutral",
    emphasis: `${where}; ${foreign.length === 1 ? "a position exists" : "positions exist"} on ${joinAnd(foreign)}, which this page does not read.`,
    rest: "",
    dek: FOREIGN_DEK,
  };
}

export function unavailableLookupHeadline(message: string): InspectorHeadline {
  return {
    variant: "unavailable",
    tone: "absent",
    emphasis: "The lookup could not be completed.",
    rest: "",
    dek: paragraph(sentence(message), "This is neither “no position” nor a position — an error is not an answer."),
  };
}

export const LOADING_HEADLINE: InspectorHeadline = { variant: "loading", tone: "absent", emphasis: "Looking up this address…", rest: "", dek: "Fetching the newest batch." };
export const INVALID_HEADLINE: InspectorHeadline = { variant: "invalid", tone: "refused", emphasis: "Not an address.", rest: "", dek: INVALID_ADDRESS_COPY };
