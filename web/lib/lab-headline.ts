// The Scenarios verdict header's sentences (spec §3.5 templates, plan R3).
// Every state the workspace can be in has its own sentence; a definition, a
// run in flight and every refusal use the dashed tone, because none of them is
// a verdict. Money is the Book's tiers (plan R11).
import { humanUsd, MINUS } from "./human-usd";
import { engineName } from "./inspector-headline";
import { LEGACY } from "./inspector-position";
import type { HeatmapView } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";

export interface LabHeadline {
  readonly emphasis: string;
  readonly rest: string;
  readonly tone: "crit" | "warn" | "ok" | "refused";
  readonly dek: string;
}

export function signedUsd(value: bigint, decimals: number): string {
  return value < 0n ? `${MINUS}${humanUsd(-value, decimals)}` : `+${humanUsd(value, decimals)}`;
}

/** The text as given, ended with a full stop unless it already ends a sentence. */
function terminated(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** A sentence of its own: capitalised and terminated. */
function sentence(text: string): string {
  const t = terminated(text);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const accounts = (n: number): string => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });

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
  return ` ${n} ${h.bandChanged === 1 ? "account changes" : "accounts change"} band; ${groupInt(h.improved)} improve.`;
}

function nearSentence(h: HeatmapView): string {
  // Silent when nothing moved: the headline already said so, and "none cross it" would restate it.
  if (h.nearLabel === null || h.nearToday === 0 || h.bandChanged === 0) return "";
  const who = h.nearToday === 1 ? `the 1 account within ${h.nearLabel} of its cap today` : `the ${groupInt(h.nearToday)} accounts within ${h.nearLabel} of their cap today`;
  const crossed = h.nearCrossed === 0 ? "none" : h.nearCrossed === h.nearToday ? `all ${groupInt(h.nearCrossed)}` : groupInt(h.nearCrossed);
  return ` Of ${who}, ${crossed} cross it.`;
}

export function resultHeadline(f: ResultFigures): LabHeadline {
  const movement =
    f.heat === null
      ? f.heatReason === null
        ? ""
        : ` Where accounts move could not be read: ${f.heatReason}.`
      : `${movementSentence(f.heat)}${nearSentence(f.heat)}`;
  const dek = `${badDebtSentence(f)}${movement}`;
  if (f.newly > 0 && f.deltaEligibleDebt > 0n) {
    return { emphasis: `${humanUsd(f.deltaEligibleDebt, f.decimals)} more Cash debt becomes liquidatable,`, rest: `across ${accounts(f.newly)}.`, tone: "crit", dek };
  }
  if (f.newly > 0) return { emphasis: `${accounts(f.newly)} become liquidatable under ${f.label}.`, rest: "", tone: "crit", dek };
  const moves = f.heat?.bandChanged ?? 0;
  if (moves === 0) return { emphasis: `No Cash account changes band under ${f.label}.`, rest: "", tone: "ok", dek };
  return { emphasis: `No Cash account becomes liquidatable under ${f.label},`, rest: `but ${groupInt(moves)} change band.`, tone: "warn", dek };
}

export function notRunHeadline(def: { label: string; description: string; path_assumption: string; shocks: number }): LabHeadline {
  const shocks =
    def.shocks === 0
      ? "no committed shock (a market-realization or projection scenario)"
      : `${String(def.shocks)} committed shock${def.shocks === 1 ? "" : "s"}`;
  // The path assumption is the wire's own clause after "Path:", quoted as given, not recapitalised.
  return { emphasis: def.label, rest: `— ${shocks}, not run yet.`, tone: "refused", dek: `${sentence(def.description)} Path: ${terminated(def.path_assumption)}` };
}

export const runningHeadline = (label: string): LabHeadline =>
  refused(`Running ${label}…`, "One evaluation against the newest complete batch; nothing is written.");

export const withheldHeadline = (label: string, cause: string): LabHeadline =>
  refused(`Cannot say — the Cash book is withheld under ${label}.`, `${sentence(cause)} A withheld book is not a computed book, and this page never fills it in.`);

/** An engine as the object of "models": the legacy market takes its article; any other engine is named as `engineName` names it. */
const modelled = (id: string): string => (id === LEGACY ? `the ${engineName(id)}` : engineName(id));

export function notCoveredHeadline(label: string, engines: readonly string[], legacyBelow: boolean): LabHeadline {
  const models = engines.length === 0 ? "It models no engine this deployment serves." : `It models ${joinAnd(engines.map(modelled))}.`;
  return refused(`${label} does not model the Cash book.`, legacyBelow ? `${models} The legacy result is below.` : models);
}

export const contradictoryHeadline = (label: string, reasons: readonly string[]): LabHeadline =>
  refused(`The result for ${label} contradicts itself.`, `${reasons.join("; ")}. Nothing from it is drawn.`);

export const definitionChangedHeadline = (label: string, fields: readonly string[]): LabHeadline =>
  refused(`${label} changed since this result was computed.`, `Changed: ${joinAnd(fields)}. Run it again for the current definition.`);

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

export function failureHeadline(kind: FailureKind, d: FailureDetail): LabHeadline {
  switch (kind) {
    case "not-served":
      return refused("Book-wide stress is not served by this deployment.", "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.");
    case "no-batch":
      return refused("No servable batch.", `${sentence(d.message ?? "no complete risk batch is available").replace(/\.$/, "")} (503). ${retry(d.retryAfterSeconds)}`);
    case "rate-limited":
      return refused("Rate limited (429).", retry(d.retryAfterSeconds));
    case "busy": {
      const slots =
        typeof d.inFlight === "number" && typeof d.maxInFlight === "number"
          ? `${String(d.inFlight)} of ${String(d.maxInFlight)} slots in use.`
          : "The service did not state its capacity.";
      return refused("The evaluator is busy.", `${sentence(d.message ?? "busy")} ${slots}`);
    }
    case "unreachable":
      return refused("The service could not be reached.", sentence(d.message ?? "no HTTP response"));
    case "failed":
      return refused(`The service answered ${String(d.status ?? 0)}.`, sentence(d.message ?? "without the contract's error envelope"));
    case "refused-locally":
      return refused("Nothing was sent.", sentence(d.message ?? "the request was refused before dispatch"));
  }
}

/** A set whose membership does not answer the request: every fault in one sentence, the dashed tone, nothing drawn. */
export const setMembershipHeadline = (faults: readonly string[]): LabHeadline =>
  refused("The set does not answer the request.", `${sentence(faults.join("; "))} Nothing from it is drawn.`);

export const LISTING_LOADING: LabHeadline = refused(
  "Loading the committed scenarios…",
  "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed.",
);

export const listingUnavailableHeadline = (message: string): LabHeadline =>
  refused("The committed scenarios could not be listed.", `${sentence(message)} Nothing can run until the listing answers.`);

export const EMPTY_LISTING: LabHeadline = refused("No committed scenarios are listed.", "This deployment serves an empty committed set. Nothing can run.");
