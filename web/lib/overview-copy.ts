// The front door's words (spec 2026-09-15 §5.1; mockup front-door.html, option A): the hero, the live strip's labels,
// the three entry cards, the pipeline's sentences and the footer. The Overview prints these and composes none.
import type { CashSummary } from "./cash-summary";
import { GITHUB_URL } from "./chrome";
import { EM_DASH, shortHex } from "./format";
import type { StateRegister } from "./kit";
import { accountMoney } from "./money";
import { CASH_PRICE_SOURCE, CASH_PRICE_SOURCE_CHIP, PIPELINE_STEPS } from "./prose";
import type { PipelineLine, PipelineStep } from "./verification-view";

export const HERO_KICKER = "A live risk surface for ether.fi Cash";
// The hero carries no figure the system does not serve: the front door's count is the strip's census, and "each account" is its unit.
export const HERO_H1_LEAD = "People borrow against crypto to spend on a Visa card.";
export const HERO_H1_TAIL = " This is how close each account is to liquidation — right now.";
export const HERO_DEK_LEAD =
  "Solvent indexes the Cash lending book straight from chain, recomputes every account's distance to liquidation each batch, and shows its work: ";
export const HERO_DEK_STRONG = "every number opens its evidence";
export const HERO_DEK_TAIL = ", and anything it can't defend renders as a named refusal — never a guess, never a zero.";

/**
 * The hero's actions: two buttons to other pages, and the address field between them. The field's placeholder carries
 * its purpose because its hint is not shown on the hero (it stays the input's description for a screen reader).
 */
export const CTA = {
  book: "Open the book",
  scenarios: "Run a stress scenario",
  addressHint: "Inspect an address",
  addressPlaceholder: "Inspect an address · 0x…",
} as const;

/** The three entry cards: the reader's question, the page it opens (a link to another page: the arrow after the words), and what that page holds. */
export const ENTRIES = {
  book: {
    question: "What is at risk now?",
    name: "Book →",
    description: "The whole Cash lending book: what's liquidatable, what's close, what backs it, and where the bad debt sits.",
  },
  inspector: {
    question: "Is this address at risk?",
    name: "Inspector →",
    description: "One account: its distance to liquidation, the prices that decide it, and the exact calculation with its numbers substituted.",
  },
  scenarios: {
    question: "What if ETH falls 30%?",
    name: "Scenarios →",
    description: "Committed, versioned shocks run against the live book. Every shocked number is labeled a projection.",
  },
} as const;

/**
 * The Inspector entry's line and where it goes: the account nearest liquidation the walk has read — the first material
 * liquidatable account, else the first near cap — its room in the account register, an over-cap room worded "over cap
 * by" a positive figure (a minus sign never rides a dollar figure). With no such account, any address will do.
 */
export function inspectorEntry(summary: CashSummary | null): { readonly href: string; readonly line: string } {
  const nearest = summary?.liquidatable.material[0] ?? summary?.nearCapRows[0] ?? null;
  if (nearest === null) return { href: "/inspector", line: "Try any 0x address" };
  const href = `/inspector/${nearest.account}`;
  if (nearest.room === null) return { href, line: "Try any 0x address" };
  const money = accountMoney(nearest.decimals);
  const room = nearest.room < 0n ? `over cap by ${money(-nearest.room)}` : `${money(nearest.room)} from its cap`;
  return { href, line: `Try ${shortHex(nearest.account)} — ${room}` };
}

/** The pipeline's section head: its link is to another page, so its arrow follows the words. */
export const HOW_IT_WORKS = {
  title: "How it works",
  link: { href: "/proof#architecture", label: "Architecture & verification →" },
} as const;

/** The strip's name for assistive tech. */
export const PIPELINE_LABEL = "How Solvent works, in four steps";

/**
 * Each step's sentence at the front door's altitude. The step's name and ordinal are the shared vocabulary's
 * (lib/prose PIPELINE_STEPS); only the sentence is the front door's own.
 */
export const PIPELINE_DESCRIPTIONS: Readonly<Record<PipelineStep["key"], string>> = {
  index:
    "Raw logs from OP Mainnet and Ethereum into Postgres. Verified-ancestor rewind handles forks of any depth; every derived table rebuilds from raw logs.",
  compute: `Each batch recomputes every account with its engine's own rule — Cash's borrow cap, Aave's health factor — at that engine's own prices; Cash's come from ${CASH_PRICE_SOURCE}.`,
  verify:
    "Accounts are re-derived against live contract reads; drift is pinned as a proof. What can't be verified is refused and shown as refused.",
  serve:
    "Read-only JSON, every money value a decimal string, a typed TypeScript client, and a live stream. This site is a client of the same API.",
};

interface OverviewStepBase {
  readonly key: PipelineStep["key"];
  readonly ordinal: string;
  readonly name: string;
  readonly description: string;
  /** The step's register: a figure that stands prints in ink — a passed check is green on Verification, the page that owns it. */
  readonly tone: "neutral" | "warn" | "crit" | "refused";
}

/** A step as the front door prints it: its figure's line, or — with no figure — the state it is in and that state's word. */
export type OverviewStep = OverviewStepBase &
  (
    | { readonly line: PipelineLine; readonly state?: undefined; readonly stateWord?: undefined }
    | { readonly line: null; readonly state: StateRegister; readonly stateWord?: string }
  );

const sentenceCase = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The shared pipeline law's four steps (lib/verification-view `pipelineSteps`) in the front door's words. A read in
 * flight is pending — never failed; a step with no figure keeps the law's own state, word and tone — "Unavailable" for
 * a read that failed, the refused register and its word for an absence the wire stated — so one state wears one
 * register on both pages, never a dash; a refused census keeps its batch figure, in the refused register.
 */
export function overviewPipeline(steps: readonly PipelineStep[]): OverviewStep[] {
  return steps.map((step) => {
    const vocabulary = PIPELINE_STEPS[step.key];
    const base: OverviewStepBase = {
      key: step.key,
      ordinal: vocabulary.ordinal,
      name: vocabulary.name,
      description: PIPELINE_DESCRIPTIONS[step.key],
      tone: step.tone === "ok" ? "neutral" : step.tone,
    };
    if (step.pending) return { ...base, tone: "neutral", line: null, state: "pending", stateWord: step.stateWord };
    if (step.value === EM_DASH) {
      return { ...base, line: null, state: step.state ?? "unavailable", stateWord: step.stateWord ?? sentenceCase(step.sub) };
    }
    return { ...base, line: { ...step.line, before: sentenceCase(step.line.before) } };
  });
}

/** The footer: the stack the service is built with and reads from, and where its source lives. */
export const FOOTER = {
  stack: `Built with Go · PostgreSQL · Next.js · TypeScript · OP Mainnet + Ethereum · ${CASH_PRICE_SOURCE_CHIP}`,
  source: "Open source · ",
  repo: GITHUB_URL.replace(/^https:\/\//, ""),
  note: " · a portfolio project, not affiliated with ether.fi",
} as const;
