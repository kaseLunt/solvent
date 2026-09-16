// web/lib/inspector-headline.ts
// The Inspector's verdict sentences (spec 2026-09-15 §3.5, plan 2 ruling R6).
// One source per state; the surface renders these strings verbatim and the
// e2e contract pins them. Money through humanUsdFull (never compacted), percents from the position.
import { humanAge } from "./freshness";
import { humanUsdFull } from "./human-price";
import { LEGACY, type ComputedCash } from "./inspector-position";
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

export interface InspectorHeadline {
  readonly variant: InspectorVariant;
  readonly tone: "crit" | "warn" | "ok" | "refused";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

/** The same words the kit's AddressField shows; kept here so lib never imports a component. */
export const INVALID_ADDRESS_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

const n = (value: number): string => value.toLocaleString("en-US");
const capitalize = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

export function engineName(wire: string): string {
  if (wire === "debt_manager") return "Cash";
  if (wire === LEGACY) return "Aave v3 market (legacy)";
  return wire;
}

export function engineList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

export function cashHeadline(p: ComputedCash, extras: { streak: Streak | null; floor: string | null }): InspectorHeadline {
  const money = (v: bigint): string => humanUsdFull(v, p.decimals);
  const base = `Borrowing ${money(p.debt)} against a ${money(p.cap)} cap — ${p.usedPercent ?? "—"} used.`;
  const floor = extras.floor === null ? "" : ` ${extras.floor}`;
  if (p.status === "liquidatable") {
    return {
      variant: "liquidatable",
      tone: "crit",
      emphasis: `Liquidatable now — ${money(p.debt)} against a ${money(p.cap)} cap.`,
      rest: "",
      dek: `${base} ${money(-p.room)} over the line: the strict rule is debt > cap.${floor}`,
    };
  }
  if (p.status === "near") {
    const s = extras.streak;
    const streak =
      s !== null && s.batches >= 2
        ? ` It has been within 10% of its cap for the last ${String(s.batches)} batches${s.spanSeconds === null ? "" : ` (≈${humanAge(s.spanSeconds)})`}.`
        : "";
    return {
      variant: "near",
      tone: "warn",
      emphasis: `Within ${money(p.room)} of its borrow cap.`,
      rest: "Not liquidatable yet.",
      dek: `${base} A ${p.roomPercent ?? "—"} fall in collateral value, or ${money(p.room)} more debt, makes this account liquidatable.${streak}${floor}`,
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
    tone: "refused",
    emphasis: `No Cash or Aave position in batch ${n(batchId)}.`,
    rest: "",
    dek: "The lookup was complete: every engine was available to be asked and none withheld its book, so this is a definitive answer for this batch.",
  };
}

export function cannotComputeHeadline(withheld: readonly { engine: string; code: string; detail: string }[]): InspectorHeadline {
  const names = withheld.map((w) => engineName(w.engine));
  const causes = withheld.map((w) => plainCause(w.code, w.detail)).join("; ");
  return {
    variant: "cannot-compute",
    tone: "refused",
    emphasis: `Cannot say — the ${engineList(names)} book${names.length === 1 ? " is" : "s are"} withheld this batch.`,
    rest: "",
    dek: `${capitalize(causes)}. A withheld book is never “no position”: this account may hold a position the service cannot currently read.`,
  };
}

export function notComputedHeadline(cause: string, lastDebt: string | null): InspectorHeadline {
  return {
    variant: "not-computed",
    tone: "refused",
    emphasis: "Cannot say — this account's Cash position was not computed this batch.",
    rest: "",
    dek: `${capitalize(cause)}. ${lastDebt === null ? "No verdict is served for it." : `Its last readable debt is ${lastDebt}; no verdict is served for it.`}`,
  };
}

export function otherEngineHeadline(batchId: number, engines: readonly string[]): InspectorHeadline {
  const legacyOnly = engines.length === 1 && engines[0] === LEGACY;
  return {
    variant: "other-engine",
    tone: "refused",
    emphasis: legacyOnly
      ? `No Cash position in batch ${n(batchId)}; a legacy Aave v3 position exists.`
      : `No Cash position in batch ${n(batchId)}; a position exists on ${engineList(engines.map(engineName))}, which this page does not read.`,
    rest: "",
    dek: legacyOnly
      ? "The legacy market is judged by its own health factor, below. The two books are never added together."
      : "Only the Cash book and the legacy Aave v3 market are read here.",
  };
}

export function unavailableLookupHeadline(message: string): InspectorHeadline {
  return {
    variant: "unavailable",
    tone: "refused",
    emphasis: "The lookup could not be completed.",
    rest: "",
    dek: `${capitalize(message)}. This is neither “no position” nor a position — an error is not an answer.`,
  };
}

export const LOADING_HEADLINE: InspectorHeadline = { variant: "loading", tone: "refused", emphasis: "Looking up this address…", rest: "", dek: "Fetching the newest batch." };
export const INVALID_HEADLINE: InspectorHeadline = { variant: "invalid", tone: "refused", emphasis: "Not an address.", rest: "", dek: INVALID_ADDRESS_COPY };
