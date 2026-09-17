// The deep-link law for /lab: `?scenario=` runs one, `?scenarios=` runs the
// committed set, both together run nothing. Moved verbatim from the old Lab's
// tornadoLines.ts; the unit pins moved with it.

import { MAX_SET_RUN_SCENARIOS } from "./runbookSet";

/** What a /lab URL's two scenario params, read together, ask this page to do. */
export type DeepLinkDecision =
  /** Neither param present: nothing deep-linked. */
  | { kind: "none" }
  /** Only `?scenario=` — the existing single-run path decides, unchanged. */
  | { kind: "single" }
  /**
   * BOTH `?scenario=` AND `?scenarios=` — two mutually exclusive selections in
   * one URL is a link nobody wrote. Nothing runs, neither param is honoured,
   * and no precedence is guessed.
   */
  | { kind: "conflict"; notice: string }
  | {
      kind: "set";
      /** The ids the link asked for, deduplicated, in the link's own order. */
      askedIds: string[];
      /** The asked ids this deployment's listing publishes — what may dispatch. */
      runIds: string[];
      /** The asked ids it does NOT publish. Filtered BEFORE dispatch and NAMED. */
      filteredIds: string[];
      /** More publishable ids than the contract's cap: nothing dispatches. */
      overCap: boolean;
      /**
       * The visible PRE-dispatch sentence, PRESENT tense, describing the live
       * listing in hand; null when clean. Rendered only while no run has been
       * dispatched.
       */
      notice: string | null;
    };

/** "a, b and c" — the house list vocabulary. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/**
 * Decide what the URL's scenario params ask for, against the listing in hand.
 *
 * The wildcard rule is deliberate and its sentence is its own: there is no
 * `?scenarios=*`, because a link whose meaning changes when the committed set
 * changes is a link that lies to whoever opens it tomorrow — the same rule as
 * the request body's no-implicit-all. A `*` is not expanded; it lands among the
 * filtered ids (this deployment publishes no scenario named `*`) and the notice
 * states the refusal explicitly rather than leaving it to be inferred.
 */
export function deepLinkDecision(
  scenarioParam: string | null,
  scenariosParam: string | null,
  listedIds: readonly string[],
): DeepLinkDecision {
  if (scenariosParam === null) {
    return scenarioParam === null ? { kind: "none" } : { kind: "single" };
  }
  if (scenarioParam !== null) {
    return {
      kind: "conflict",
      notice:
        "This link names both ?scenario= and ?scenarios=. They are two mutually exclusive selections and no " +
        "precedence is guessed between them: NOTHING was run for either. Remove one of the two and open the " +
        "link again.",
    };
  }

  const askedIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of scenariosParam.split(",")) {
    const id = raw.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    askedIds.push(id);
  }

  const listed = new Set(listedIds);
  const runIds = askedIds.filter((id) => listed.has(id));
  const filteredIds = askedIds.filter((id) => !listed.has(id));
  const overCap = runIds.length > MAX_SET_RUN_SCENARIOS;

  // The tense-stable clauses: the wildcard refusal and the cap refusal state
  // facts that do not age.
  const wildcardClause = filteredIds.includes("*")
    ? "A * is never expanded: a link whose meaning changes when the committed set changes is a link that " +
      "lies to whoever opens it tomorrow, so this surface has no implicit all."
    : null;
  const overCapClause = overCap
    ? `This link names ${String(runIds.length)} published scenarios and the contract caps one set-run at ` +
      `${String(MAX_SET_RUN_SCENARIOS)}. Nothing was dispatched and nothing was silently truncated: trim ` +
      `the link to at most ${String(MAX_SET_RUN_SCENARIOS)} ids.`
    : null;
  const dispatchedTail = overCap
    ? ""
    : runIds.length > 0
      ? ` Only the ${String(runIds.length)} published one(s) were dispatched.`
      : " Nothing was dispatched.";

  const clauses: string[] = [];
  if (filteredIds.length > 0) {
    clauses.push(
      `You asked for ${String(askedIds.length)} scenario(s); this deployment publishes ` +
        `${String(runIds.length)} of them. Not published here: ${listWords(filteredIds)}.` +
        dispatchedTail,
    );
  }
  if (wildcardClause !== null) clauses.push(wildcardClause);
  if (overCapClause !== null) clauses.push(overCapClause);

  return {
    kind: "set",
    askedIds,
    runIds,
    filteredIds,
    overCap,
    notice: clauses.length === 0 ? null : clauses.join(" "),
  };
}
