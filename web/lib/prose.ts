// web/lib/prose.ts
// The prose helpers and shared words no module may own twice: an "a, b and c"
// joiner (no Oxford comma), en-US digit grouping for a printed integer, the
// engines' names, the price source's name and the pipeline's step names.
// Words and counts only — no money, no percent and no wire scalar is
// formatted here; those have their own guarded modules.

/** "a" · "a and b" · "a, b and c" · "" for an empty list. */
export function joinAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** An integer with en-US thousands grouping: 18251 → "18,251". A bigint groups the same way. */
export function groupInt(value: number | bigint): string {
  return value.toLocaleString("en-US");
}

/** A grouped count with its noun, singular exactly at one: "1 liquidation", "1,200 chain actions", "0 hours". */
export function plural(n: number, noun: string): string {
  return `${groupInt(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * An engine as a SENTENCE names it, in one phrasing: Cash by its name, the legacy market with its article and its
 * qualifier first ("the legacy Aave v3 market") — the label form, "Aave v3 market (legacy)", reads as a label and
 * stays on chips, kickers and switches. An engine this product does not name prints as the wire's own id, never as
 * one of the two. The ids are the contract's (`debt_manager`, `aave_v3_etherfi`), welded to the app's constants by
 * this module's unit spec: it cannot import them without importing its own importers.
 */
export function engineInProse(wire: string): string {
  if (wire === "debt_manager") return "Cash";
  if (wire === "aave_v3_etherfi") return "the legacy Aave v3 market";
  return wire;
}

/** An engine as a LABEL names it — the chips', kickers' and switches' form. */
function engineLabel(wire: string): string {
  if (wire === "debt_manager") return "Cash";
  if (wire === "aave_v3_etherfi") return "Aave v3 market (legacy)";
  return wire;
}

/** The order a list of engines is read in: Cash, then the legacy market, then any other in the order given. */
const ENGINE_ORDER: readonly string[] = ["debt_manager", "aave_v3_etherfi"];

/**
 * Engines as a list of labels, each named once, Cash first: "Cash and Aave v3 market (legacy)" whatever order the
 * wire listed them in. A list, never a sum — nothing here adds one engine's figure to another's.
 */
export function engineList(engines: readonly string[]): string {
  const unique = [...new Set(engines)];
  const known = ENGINE_ORDER.filter((engine) => unique.includes(engine));
  const other = unique.filter((engine) => !ENGINE_ORDER.includes(engine));
  return joinAnd([...known, ...other].map(engineLabel));
}

/** The legacy market's fold, titled once for every page that folds it away. */
export const LEGACY_FOLD_TITLE = "Legacy · Aave v3 market";

/**
 * Where Cash's prices come from. The Debt Manager prices every collateral through its own contract on OP Mainnet,
 * PriceProviderV2, at borrow, repay and liquidation; the service polls that same function. Behind it sit Chainlink
 * feeds, ether.fi exchange-rate and accountant feeds and custom push feeds, asset by asset — no RedStone feed is read
 * anywhere in this system, so no copy may name one.
 */
export const CASH_PRICE_SOURCE = "Cash's own price contract, PriceProvider v2 on OP Mainnet";

/** The price source on a chip: the contract's name alone. */
export const CASH_PRICE_SOURCE_CHIP = "PriceProvider v2";

/** A pipeline step as every page heads it: its ordinal, its name, and the two joined. */
export interface PipelineStepName {
  readonly ordinal: string;
  readonly name: string;
  /** "01 · Index". */
  readonly heading: string;
}

const pipelineStep = (ordinal: string, name: string): PipelineStepName => ({ ordinal, name, heading: `${ordinal} · ${name}` });

/**
 * The four steps of the pipeline, in order, named once. A page's sentence about a step may differ by altitude; the
 * step's name and ordinal never do.
 */
export const PIPELINE_STEPS: Readonly<Record<"index" | "compute" | "verify" | "serve", PipelineStepName>> = {
  index: pipelineStep("01", "Index"),
  compute: pipelineStep("02", "Compute"),
  verify: pipelineStep("03", "Verify"),
  serve: pipelineStep("04", "Serve"),
};
