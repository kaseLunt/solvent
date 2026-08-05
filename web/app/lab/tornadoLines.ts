// The TORNADO surface's pure composition layer (Wave W-TN): the composed
// header of rev2 §9.6, the deep-link decision of §9.2, the bodyless-settlement
// register of §9.3, and the bar geometry the renderer places rects with.
//
// It is a sibling of `tornadoCells.ts` in the same way `labPanelLines.ts` is a
// sibling of the panels: the DECISIONS live in `tornadoCells` (which cell state
// a result is in, whether a bar may draw at all) and are not re-derived here;
// this file only COMPOSES sentences and pixel placements from decisions already
// made. Pure — no React, no fetch — so every string a reader meets is pinned by
// `tests/unit/tornado-lines.spec.ts` without a browser.
//
// THE RATIO IS A LAYOUT QUANTITY AND THIS FILE IS WHERE THAT LAW LANDS ON
// PIXELS. `barLength` hands over a dimensionless number; `tornadoBarGeometry`
// turns it into rendered CSS px (LAW-3) and nothing else. No ratio is ever
// returned as a string, no tick value is computed from it, and the VISUAL that
// consumes this geometry prints NO numbers at all: every printed number on the
// tornado is the wire's exact decimal string, in the LEDGER (LAW-5).

import type { RunBookOutcome } from "../../lib/runbook";
import {
  MAX_SET_RUN_SCENARIOS,
  type RunBookSetResponse,
  type SetRunOutcome,
} from "../../lib/runbookSet";
import { freshnessClause } from "./tornadoCells";

// ---------------------------------------------------------------------------
// §9.2 — the deep link. Parsed against the LISTING IN HAND, never dispatched
// blind: an unknown id 404s the WHOLE set, so the client filters first and
// DISCLOSES what it filtered.
// ---------------------------------------------------------------------------

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
      /** The visible sentence for whatever was filtered or refused; null when clean. */
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

  const clauses: string[] = [];
  if (filteredIds.length > 0) {
    clauses.push(
      `You asked for ${String(askedIds.length)} scenario(s); this deployment publishes ` +
        `${String(runIds.length)} of them. Not published here: ${listWords(filteredIds)}.` +
        (overCap
          ? ""
          : runIds.length > 0
            ? ` Only the ${String(runIds.length)} published one(s) were dispatched.`
            : " Nothing was dispatched."),
    );
  }
  if (filteredIds.includes("*")) {
    clauses.push(
      "A * is never expanded: a link whose meaning changes when the committed set changes is a link that " +
        "lies to whoever opens it tomorrow, so this surface has no implicit all.",
    );
  }
  if (overCap) {
    clauses.push(
      `This link names ${String(runIds.length)} published scenarios and the contract caps one set-run at ` +
        `${String(MAX_SET_RUN_SCENARIOS)}. Nothing was dispatched and nothing was silently truncated: trim ` +
        `the link to at most ${String(MAX_SET_RUN_SCENARIOS)} ids.`,
    );
  }

  return {
    kind: "set",
    askedIds,
    runIds,
    filteredIds,
    overCap,
    notice: clauses.length === 0 ? null : clauses.join(" "),
  };
}

// ---------------------------------------------------------------------------
// §9.6 — THE COMPOSED HEADER. One line, composed once, rendered by every
// tornado surface (the file's habit since R13: a header that is a pure function
// of named sets cannot contradict the cells below it).
// ---------------------------------------------------------------------------

/** One refused result, for the header's refusal clause (r57 item 4). */
export interface TornadoHeaderRefusal {
  scenarioId: string;
  /** The why-class, from `refusalClassOf`. */
  why: string;
}

export interface TornadoHeaderInput {
  response: RunBookSetResponse;
  /**
   * The scenario ids that actually rendered AT LEAST ONE bar rect, AFTER every
   * gate: the reach states, the denominator, the §9.5 cohort rule — and, r57
   * item 8, the measured-zero rule: a scenario whose every answerable engine
   * measured exactly zero renders no rect and is NOT in this list. Supplied by
   * the renderer because those gates are not knowable from the response alone.
   */
  drawnScenarioIds: readonly string[];
  /** The §9.2 filtered deep-link ids; empty when the run was not deep-linked. */
  filteredDeepLinkIds: readonly string[];
  /**
   * R57 item 4 — the results the cell layer REFUSED (contradictory result,
   * coverage skew, definition changed, unlisted result). They contribute to NO
   * other clause of this line: not the reach counts, not the absence count.
   */
  refusals?: readonly TornadoHeaderRefusal[];
  /**
   * R57 item 8 — drawable, in-cohort scenarios whose every answerable engine
   * measured exactly zero: zero rects rendered, excluded from the drawn count,
   * and counted in their own appended clause when nonzero.
   */
  measuredZeroScenarioIds?: readonly string[];
}

/** The refusal clause's fixed class order — grep-stable, never alphabetized per body. */
const REFUSAL_CLASS_ORDER = [
  "contradictory result",
  "coverage skew",
  "definition changed",
  "unlisted result",
] as const;

/**
 * The one header line. Its clauses, in order: the batch id with the freshness
 * arm in force (from `freshnessClause`, which carries the newer id in the
 * `superseded` arm, the older id and the word OLDER in `newest_is_older`, and
 * the disabled-re-run reason in `none_servable`); bars drawn against scenarios
 * requested; the no-reach count and — SEPARATELY, because collapsing the two is
 * the collapse rev2 exists to undo — the declared-no-move count; the count of
 * engines named absent rather than drawn; and, when non-empty, the deep-link
 * ids that were filtered.
 */
export function tornadoHeaderLine(input: TornadoHeaderInput): string {
  const { response, drawnScenarioIds, filteredDeepLinkIds } = input;
  const refusals = input.refusals ?? [];
  const measuredZero = input.measuredZeroScenarioIds ?? [];
  // R57 item 4 — a REFUSED result contributes NOTHING to the reach and absence
  // counts: a row this surface declined to read may not be counted as a fact
  // about the book. The refusal clause below is its only appearance here.
  const refusedIds = new Set(refusals.map((refusal) => refusal.scenarioId));
  const admitted = response.results.filter((result) => !refusedIds.has(result.scenario_id));
  const noReach = admitted.filter(
    (result) =>
      result.shock_reach.reach === "no_mark_moved" ||
      result.shock_reach.reach === "no_shock_reached_the_book",
  ).length;
  const declaredNoMove = admitted.filter(
    (result) => result.shock_reach.reach === "all_shocks_declared_at_identity",
  ).length;
  const absentEngines = admitted.reduce(
    (count, result) =>
      count + result.withheld_engines.length + result.unmeasurable_engines.length,
    0,
  );
  const parts = [
    freshnessClause(response),
    `bars drawn for ${String(drawnScenarioIds.length)} of ` +
      `${String(response.requested_scenario_ids.length)} requested scenario(s)`,
  ];
  // R57 item 8 — the drawn count counts scenarios that rendered at least one
  // RECT; an all-zero-reached scenario rendered none and gets its own clause,
  // only when the count is nonzero.
  if (measuredZero.length > 0) {
    parts.push(`measured zero: ${String(measuredZero.length)}`);
  }
  parts.push(
    `shock did not reach: ${String(noReach)}`,
    `declared no move: ${String(declaredNoMove)}`,
    `engines named absent rather than drawn: ${String(absentEngines)}`,
  );
  if (refusals.length > 0) {
    const byClass = REFUSAL_CLASS_ORDER.flatMap((why) => {
      const count = refusals.filter((refusal) => refusal.why === why).length;
      return count === 0 ? [] : [`${why}: ${String(count)}`];
    });
    parts.push(`results refused, not read: ${String(refusals.length)} (${byClass.join(", ")})`);
  }
  if (filteredDeepLinkIds.length > 0) {
    parts.push(
      `filtered from the deep link, not published here: ${filteredDeepLinkIds.join(", ")}`,
    );
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// §9.5 — the cohort rule's own sentence, per row pulled out of the chart.
// ---------------------------------------------------------------------------

/**
 * A row re-run singly since the set settled, now pinned to a NEWER batch than
 * the set's. A tornado is one sentence across scenarios, so a bar from another
 * batch breaks it: the row leaves the chart into this state — never drawn
 * shorter, greyer, or beside the others — and the affordance is a re-run of
 * the SET, which is the only thing that puts every row back on one batch.
 */
export function pinnedElsewhereSentence(
  scenarioId: string,
  rowBatchId: number,
  setBatchId: number,
): string {
  return (
    `${scenarioId} is not drawn: it was re-run singly and now pins batch #${String(rowBatchId)}, ` +
    `not this set's batch #${String(setBatchId)}. A tornado is one sentence across scenarios, so a bar ` +
    `from another batch is never drawn shorter or greyer beside the others. Re-run the SET to move ` +
    `every row onto one batch.`
  );
}

/**
 * A result whose identity triple disagrees with the listing this page shows.
 * The register is `matrixCells`' DEFINITION CHANGED, at result granularity:
 * no bar, no ledger judgement, and a listing refresh is what resolves it.
 */
export function tornadoDefinitionChangedSentence(fields: readonly string[]): string {
  return (
    `DEFINITION CHANGED · this result answered for a committed definition this page is no longer ` +
    `showing (${fields.join(", ")} disagree). No bar is drawn from it and none of its numbers are read: ` +
    `a result computed for one definition is never read against the coverage of another. Refresh the ` +
    `listing to read it against the definition it was computed for.`
  );
}

// ---------------------------------------------------------------------------
// §9.3 — THE BODYLESS SETTLEMENT, NAMED PER ARM. One request, one failure, N
// disclosures: every row of the set keeps whatever it held at its own pin, and
// the failure record beside it names WHICH of the arms refused the set.
// ---------------------------------------------------------------------------

/** A settled set-run that produced no set body to read. */
export type BodylessSetOutcome = Exclude<SetRunOutcome, { kind: "ok" }>;

/**
 * The arm's own sentence, composed once and written into every affected row's
 * `rerunFailed.reason` (R16's record) as well as the set-level notice — so the
 * matrix banner and the tornado surface cannot give two accounts of one
 * settlement. The BUSY arm never borrows the rate-limit or no-batch sentence:
 * it is a statement about the evaluator's capacity and about nothing in the
 * book, and it offers no retry instant because none computes.
 */
export function setRunFailureReason(outcome: BodylessSetOutcome): string {
  switch (outcome.kind) {
    case "busy":
      return (
        `SERVICE BUSY (503 set_run_busy): this deployment evaluates at most ` +
        `${String(outcome.maxInFlight)} set-run(s) at once and ${String(outcome.inFlight)} ` +
        `are running, so the set was refused before any batch was read. This says nothing ` +
        `about the book, and no retry time exists to offer.`
      );
    case "no-batch":
      return (
        `NO SERVABLE BATCH (503 unavailable): ${outcome.message}` +
        (outcome.retryAfterSeconds === null
          ? ""
          : ` Retry after ${String(outcome.retryAfterSeconds)}s.`)
      );
    case "rate-limited":
      return (
        `RATE LIMITED (429): ${outcome.message}` +
        (outcome.retryAfterSeconds === null
          ? ""
          : ` Retry after ${String(outcome.retryAfterSeconds)}s.`)
      );
    case "unreachable":
      return (
        `UNREACHABLE: the set-run produced no HTTP response (${outcome.message}). ` +
        `This says nothing about the book.`
      );
    case "not-served":
      return (
        "NOT SERVED: this deployment answered 404 without the contract's envelope for " +
        "POST /v1/scenarios/run-book-set. A fact about the DEPLOYMENT, not about any scenario."
      );
    case "refused":
      return (
        `REFUSED (${String(outcome.status)}${outcome.code === "" ? "" : ` ${outcome.code}`}): ` +
        outcome.message
      );
  }
}

/**
 * The failed settlement as a `RunBookOutcome`, for a row that held NO ok body
 * to keep: `run()`'s own convention (a failure record needs an outcome to sit
 * beside, and a first-run failure IS the row's outcome). The mapping loses
 * nothing R8 protects — a failure replacing a failure is not an erased
 * measurement — and the two arms `RunBookOutcome` cannot carry verbatim (busy,
 * an unknown refusal) ride its `failed` arm WITH the full arm-naming sentence,
 * because `RunBookOutcome`'s own rate-limited arm is the one that discards
 * messages and the busy arm exists precisely to keep its message.
 */
export function setFailureAsRunBookOutcome(outcome: BodylessSetOutcome): RunBookOutcome {
  switch (outcome.kind) {
    case "no-batch":
      return {
        kind: "no-batch",
        message: outcome.message,
        retryAfterSeconds: outcome.retryAfterSeconds,
      };
    case "unreachable":
      return { kind: "unreachable", message: outcome.message };
    case "not-served":
      return { kind: "not-served" };
    case "busy":
      return { kind: "failed", status: 503, message: setRunFailureReason(outcome) };
    case "rate-limited":
      return { kind: "failed", status: 429, message: setRunFailureReason(outcome) };
    case "refused":
      return { kind: "failed", status: outcome.status, message: setRunFailureReason(outcome) };
  }
}

// ---------------------------------------------------------------------------
// Bar geometry — RENDERED CSS PIXELS (LAW-3), and nothing but pixels.
// ---------------------------------------------------------------------------

export interface TornadoBarInput {
  scenarioId: string;
  /** `barLength(...).ratio` — signed, dimensionless, layout-only. */
  ratio: number;
}

/** The tornado's visibility floor, rendered CSS px — the same 1.5 the flow discloses. */
export const TORNADO_BAR_FLOOR = 1.5;

export interface TornadoBarPlacement {
  scenarioId: string;
  ratio: number;
  /** Left edge of the rect, px from the plot's left edge. */
  x: number;
  /** Rect width in px. EXACTLY 0 for a true measured zero: no ink for a zero. */
  width: number;
  /** True when the delta is negative — the bar extends LEFT of the axis. */
  negative: boolean;
  /**
   * R57 item 7 — TRUE when the 1.5px visibility floor, not the panel's scale,
   * set this width: the one place the picture and the advertised scale
   * disagree, so it is flagged here, carried as `data-floored` on the rect,
   * and COUNTED into the panel's disclosure sentence.
   */
  floored: boolean;
}

export interface TornadoGeometry {
  /** The zero axis, px from the plot's left edge — the diverging center. */
  axisX: number;
  /** Sorted by |ratio| descending (the tornado's reading order); ties keep input order. */
  bars: TornadoBarPlacement[];
  maxAbsRatio: number;
  /** How many bars the visibility floor lifted off the panel's own scale. */
  flooredCount: number;
}

/**
 * Place one engine panel's bars. The scale is per PANEL — one axis per engine,
 * never one across engines — and the longest bar spans the half-width, so the
 * only thing a length claims is its ratio to its neighbours on the SAME axis.
 *
 * A nonzero never vanishes (the 1.5px floor, the frontier's own doctrine) and
 * a TRUE zero draws no ink at all: width 0, decided here so the renderer
 * cannot floor a measured zero into a fake sliver. A FLOORED bar is DISCLOSED
 * (r57 item 7, the W-SK-B remedy): the floor breaks the scale for exactly the
 * bars it lifts, so each one is flagged and the panel prints the count.
 */
export function tornadoBarGeometry(
  rows: readonly TornadoBarInput[],
  innerWidth: number,
): TornadoGeometry {
  const axisX = innerWidth / 2;
  const halfSpan = Math.max(axisX - 8, 1);
  const maxAbsRatio = rows.reduce((max, row) => Math.max(max, Math.abs(row.ratio)), 0);
  const bars = [...rows]
    .sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio))
    .map((row) => {
      const negative = row.ratio < 0;
      const scaledWidth =
        row.ratio === 0 || maxAbsRatio === 0
          ? 0
          : (Math.abs(row.ratio) / maxAbsRatio) * halfSpan;
      const floored = scaledWidth > 0 && scaledWidth < TORNADO_BAR_FLOOR;
      const width = scaledWidth === 0 ? 0 : Math.max(scaledWidth, TORNADO_BAR_FLOOR);
      return {
        scenarioId: row.scenarioId,
        ratio: row.ratio,
        x: negative ? axisX - width : axisX,
        width,
        negative,
        floored,
      };
    });
  return {
    axisX,
    bars,
    maxAbsRatio,
    flooredCount: bars.filter((bar) => bar.floored).length,
  };
}

/**
 * R57 item 7 — the floor's disclosure, one computed sentence per panel, ONLY
 * when the count is nonzero: a standing disclaimer over zero floored bars is
 * noise a reader learns to skip, and silence over a nonzero count is a lie
 * about the scale. Singular grammar at one.
 */
export function tornadoFloorSentence(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) {
    return (
      "1 bar is shorter than the 1.5px visibility floor and renders at it, off that scale; " +
      "its exact figures are in the table."
    );
  }
  return (
    `${String(count)} bars are shorter than the 1.5px visibility floor and render at it, ` +
    "off that scale; their exact figures are in the table."
  );
}

// ---------------------------------------------------------------------------
// Fixed copy — composed once, pinned once.
// ---------------------------------------------------------------------------

/** SLOT 6 (METHOD) for the tornado. One line, 12px, stated once for the surface. */
export const TORNADO_METHOD =
  "Bar length is eligible_debt_delta_usd over total_debt_usd_before on that engine's own row: " +
  "a dimensionless layout quantity, never printed and never rounded into a claim. Every printed " +
  "number is the wire's exact decimal string at the engine's own usd_decimals. One axis per engine, " +
  "never one across engines; no cross-engine total, sum or average exists anywhere on this surface.";

/**
 * The dispatch affordance's charge disclosure, in the run-hint register the
 * single-run affordance already uses (no new register): the server charges one
 * rate-limit token per scenario, so the cost is named where it is incurred.
 */
export function tornadoChargeHint(pickedCount: number): string {
  return (
    "POST /v1/scenarios/run-book-set · one batch, N scenarios, computed on request; writes nothing · " +
    `charges one rate-limit token per scenario: running ${String(pickedCount)} charges ` +
    `${String(pickedCount)} token(s)`
  );
}
