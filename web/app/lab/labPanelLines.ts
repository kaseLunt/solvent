// WAVE W-3L — the Lab panels' ANSWER / METHOD / FORENSICS copy.
//
// Every line here is COMPUTED from the same wire object the panel it sits on
// renders (R4). None of them is a caption a designer can reword into a
// different claim: each one is derived, and the unit specs mutate the input
// and re-read the output.
//
// The frontier's own reading lines live in `labReadingLines.ts` and stay
// there — that panel's claim (a cliff across a grid) is a different sentence
// from any of these, and the inventory forbids merging or deduping the two.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import {
  compareRatio,
  type RefinedProjection,
  type RefinedScenario,
  type RefinedScenarioResult,
  type RefinedStressState,
  type Shortfall,
} from "@solvent/client";
import {
  renderSignedCount,
  renderSignedUsdAmount,
  renderUsdAmount,
} from "../../lib/book-format";

// ---------------------------------------------------------------------------
// LabRealization — the market-realization axis.
// ---------------------------------------------------------------------------

/**
 * SLOT 3 — the two cards as one sentence, with the delta-only basis IN the
 * visible takeaway (hazard: the basis may never move into an expandable).
 */
export function realizationAnswer(realization: Shortfall): string {
  const money = (value: string) => renderUsdAmount(value, realization.usd_decimals);
  return (
    `Execution shortfall ${money(realization.execution_shortfall_usd)} · bad debt at ` +
    `liquidation ${money(realization.bad_debt_at_liquidation_usd)}. Both are delta-only, ` +
    `measured against this scenario's own before state.`
  );
}

/**
 * SLOT 6 — the seizure model, plus the eligible-vs-realized gloss PROMOTED
 * out of a `title`. A gloss reachable only by hover is not a disclosure, and
 * this one is what stops "realized ≤ eligible" reading as missing data.
 */
export function realizationMethod(realization: Shortfall, gloss: string): string {
  return (
    `Seizure model: ${realization.seizure_model}, the disclosed assumption behind the ` +
    `shortfall arithmetic. Values are USD at ${String(realization.usd_decimals)} decimals. ` +
    `${gloss}`
  );
}

/** SLOT 7's summary. The wire note is the only thing behind it. */
export const REALIZATION_FORENSICS_SUMMARY = "Exact data: the wire's own note, verbatim";

// ---------------------------------------------------------------------------
// LabProjectionView — the rate axis over time.
// ---------------------------------------------------------------------------

/**
 * SLOT 3 — what happens at the LONGEST horizon, which is the question a
 * horizon table is read to answer and the one it made a reader scan for.
 *
 * `unknowable` is stated as its own outcome. An unknowable horizon is not a
 * "does not become liquidatable", and the sentence never rounds it into one.
 */
export function projectionAnswer(projection: RefinedProjection): string {
  const longest = projection.horizons.reduce<RefinedProjection["horizons"][number] | null>(
    (best, horizon) =>
      best === null || horizon.horizon_seconds > best.horizon_seconds ? horizon : best,
    null,
  );
  if (longest === null) {
    return (
      "This projection served no horizon, so it makes no claim about what interest does to " +
      "this position over time."
    );
  }
  const days = longest.horizon_seconds / 86_400;
  const horizon =
    longest.horizon_seconds > 0 && longest.horizon_seconds % 86_400 === 0
      ? `${String(days)} days`
      : `${longest.horizon_seconds.toLocaleString("en-US")} seconds`;
  const verdict =
    longest.liquidation_verdict === "liquidatable"
      ? "this position becomes liquidatable"
      : longest.liquidation_verdict === "not-liquidatable"
        ? "this position does not become liquidatable"
        : "whether this position becomes liquidatable is unknowable, which is not the same " +
          "statement as no";
  return `Over ${horizon}, the longest horizon served, ${verdict}.`;
}

/**
 * SLOT 6 — the basis and the HELD-INPUT disclosure. `prices_held_flat` is a
 * held input, so it belongs in the visible method line rather than beside an
 * APY block a reader has to open.
 */
export function projectionMethod(projection: RefinedProjection): string {
  const sign = projection.annual_delta_bps > 0 ? "+" : "";
  const held = projection.prices_held_flat
    ? "Prices are held flat across every horizon, so this axis moves interest and nothing else."
    : "Prices are not held flat on this axis.";
  return (
    `Basis ${projection.basis}, annual Δ ${sign}${String(projection.annual_delta_bps)} bps. ` +
    `${held}`
  );
}

/** SLOT 7's summary. */
export const PROJECTION_FORENSICS_SUMMARY =
  "Exact data: the APY observation block, the native-scale caption, and the wire's own note";

// ---------------------------------------------------------------------------
// THE STATE PAIR'S OWN EQUALITY TEST: one helper, both callers.
// ---------------------------------------------------------------------------

/**
 * Every field of a served state this app puts on a screen.
 *
 * THE DEFECT THIS CLOSES (Codex round 47). Two comparisons existed, they
 * disagreed, and both were short. The boundary group's tally omitted `infinite`
 * and `max_borrow_lt`; the scenario detail's `bitIdentical` omitted
 * `max_borrow_lt`. `LabStatePair` renders both of them. An infinite health
 * factor is a whole different cell and `max_borrow_lt` has its own row, so a
 * pair that moved only there rendered "before ≡ after · the served states are
 * bit-identical" directly beneath a table showing the two values differing.
 *
 * The list is exhaustive against `RefinedStressState` rather than against what
 * a component happens to read today: a wire field that starts being served and
 * starts being rendered must not be able to slip past the claim silently. The
 * type alias below is what enforces it: add a field to the contract and this
 * file stops compiling until the field is listed here.
 */
const COMPARED_STATE_FIELDS = [
  "health_factor_wad",
  "health_factor_num",
  "health_factor_den",
  "infinite",
  "eligible",
  "collateral_usd",
  "debt_usd",
  "max_borrow_lt",
  "liquidation_verdict",
] as const satisfies readonly (keyof RefinedStressState)[];

type ComparedStateField = (typeof COMPARED_STATE_FIELDS)[number];

/** `T` must be `never`, or this alias fails its own constraint. */
type AssertNever<T extends never> = T;

/**
 * COMPILE-TIME EXHAUSTIVENESS. Resolves only while `COMPARED_STATE_FIELDS`
 * names every field of a served state; a field the list forgets makes the
 * `Exclude` non-empty and the constraint above rejects it.
 */
export type EveryServedStateFieldIsCompared = AssertNever<
  Exclude<keyof RefinedStressState, ComparedStateField>
>;

/**
 * What a before/after pair actually is.
 *
 * `withheld` is its own answer and never folds into `moved`: a result that
 * served no state pair did not re-price anything, and counting it as a
 * re-pricing invents a movement out of an absence. `LabStatePair` renders that
 * case as "state pair withheld", so the count beside it has to agree.
 */
export type StatePairComparison = "identical" | "moved" | "withheld";

export function compareStatePair(
  before: RefinedStressState | null,
  after: RefinedStressState | null,
): StatePairComparison {
  if (before === null || after === null) return "withheld";
  return COMPARED_STATE_FIELDS.every((field) => before[field] === after[field])
    ? "identical"
    : "moved";
}

/**
 * THE ONE PREDICATE BEHIND EVERY "bit-identical" WORD ON THIS PAGE. A pair with
 * a missing side is not identical: there is nothing to have been identical to.
 */
export function statesBitIdentical(
  before: RefinedStressState | null,
  after: RefinedStressState | null,
): boolean {
  return compareStatePair(before, after) === "identical";
}

// ---------------------------------------------------------------------------
// LabBoundaryGroup — the stable-snap boundary set.
// ---------------------------------------------------------------------------

/**
 * WHICH COMMITTED SCENARIOS THE BOUNDARY PANEL RENDERS, derived from the wire:
 * every member whose shocks all ride the sealed `stable_usd` axis, closest to
 * par first. No id list is consulted, so the group is exactly what the served
 * set carries — and when it carries none the panel does not render at all (a
 * missing boundary point is absent, never invented).
 *
 * IT LIVES HERE RATHER THAN BESIDE THE COMPONENT so the group's ANSWER and the
 * group the ANSWER is computed over come from ONE module a spec can import.
 * `LabBoundaryGroup.tsx` pulls in CSS modules and the `@/` alias, so a test
 * reaching for this derivation there would have had to re-implement it — and a
 * weld that re-implements half of what it is welding proves nothing.
 */
export function stableBoundaryScenarios(
  scenarios: readonly RefinedScenario[],
): RefinedScenario[] {
  const group = scenarios.filter(
    (scenario) =>
      scenario.shocks.length > 0 && scenario.shocks.every((shock) => shock.axis === "stable_usd"),
  );
  // Closest to par first (factor descending) — the band walk reads outward.
  return [...group].sort((a, b) => {
    const fa = a.shocks[0];
    const fb = b.shocks[0];
    if (fa === undefined || fb === undefined) return 0;
    return compareRatio(
      BigInt(fb.factor_num),
      BigInt(fb.factor_den),
      BigInt(fa.factor_num),
      BigInt(fa.factor_den),
    );
  });
}

/** How one member's served states came out, and how it was snapped. */
export interface BoundaryMemberTally {
  /** Which of the three the served pair is, before applicability is applied. */
  comparison: StatePairComparison;
  /** Both states served and bit-identical on every rendered field. */
  identical: boolean;
  snapped: number;
  baseSnapped: number;
  applied: number;
}

/** Compare one result's before/after on every field the panel calls served. */
export function boundaryMemberTally(result: RefinedScenarioResult): BoundaryMemberTally {
  const comparison = compareStatePair(result.before, result.after);
  return {
    comparison,
    identical: result.applicable && comparison === "identical",
    snapped: result.applied_shocks.filter((shock) => shock.snapped).length,
    baseSnapped: result.applied_shocks.filter((shock) => shock.base_snapped).length,
    applied: result.applied_shocks.length,
  };
}

/**
 * SLOT 3 — members, re-pricings, and the SNAP COUNT.
 *
 * The snap count rides the visible sentence deliberately: a `snapped` or
 * `base_snapped` YES is a modelling disclosure, so the per-member breakdown
 * may collapse only while its total stays in the open.
 */
export function boundaryGroupAnswer(group: readonly RefinedScenario[]): string {
  let repriced = 0;
  let withheld = 0;
  let snapped = 0;
  let baseSnapped = 0;
  let notApplicable = 0;
  for (const scenario of group) {
    for (const result of scenario.results) {
      const tally = boundaryMemberTally(result);
      // THREE OUTCOMES, NOT TWO. An applicable result that served no state
      // pair is a withheld measurement, and it used to land in the re-priced
      // count purely because the equality test could not be true of a null.
      if (!result.applicable) notApplicable += 1;
      else if (tally.comparison === "withheld") withheld += 1;
      else if (tally.comparison === "moved") repriced += 1;
      snapped += tally.snapped;
      baseSnapped += tally.baseSnapped;
    }
  }
  const members = group.length === 1 ? "1 committed member" : `${String(group.length)} committed members`;
  const naClause = notApplicable === 0 ? "" : ` ${String(notApplicable)} served no applicable result.`;
  const withheldClause =
    withheld === 0
      ? ""
      : ` ${String(withheld)} served no state pair to compare, which is a withheld measurement ` +
        `and not a re-pricing.`;
  return (
    `${members} on the stable_usd axis. ${String(repriced)} re-priced this address's served ` +
    `states.${naClause}${withheldClause} ${String(snapped)} shocks snapped to a cap and ` +
    `${String(baseSnapped)} snapped at the base.`
  );
}

/** SLOT 7's summary, counting what it holds. */
export function boundaryForensicsSummary(members: number): string {
  return `Exact data: the per-member snap counts for ${String(members)} members`;
}

// ---------------------------------------------------------------------------
// LabBookPanel — EngineResult and BookResult.
// ---------------------------------------------------------------------------

/** The shape both answers read. Structural, so the specs can build one. */
export interface RunBookEngineFacts {
  engine: string;
  usd_decimals: number;
  newly_eligible_accounts: number;
  eligible_debt_delta_usd: string;
  bad_debt_delta_usd: string;
}

/**
 * SLOT 3 for one engine's result: the three cards as one sentence.
 *
 * CX-2 binds here as much as it binds the card: the count is a SIGNED NET
 * delta and renders with its sign, and a favourable movement is never worded
 * as a favourable scenario.
 */
export function engineResultAnswer(engine: RunBookEngineFacts): string {
  return (
    `${engine.engine}: net change in eligible accounts ` +
    `${renderSignedCount(engine.newly_eligible_accounts)} · Δ eligible debt ` +
    `${renderSignedUsdAmount(engine.eligible_debt_delta_usd, engine.usd_decimals)} · Δ bad debt ` +
    `${renderSignedUsdAmount(engine.bad_debt_delta_usd, engine.usd_decimals)}. All three are ` +
    `delta-only, in this engine's own USD.`
  );
}

/**
 * SLOT 6 for one engine's result: the unit, the never-summed law, and the
 * collateral-at-risk caption PROMOTED out of a `title` on a table row that now
 * sits in FORENSICS. The hazard is explicit — that caption moves UP, never
 * further down: a dip in that series is honest arithmetic, and a reader who
 * never hovers reads it as missing data.
 */
export function engineResultMethod(engine: RunBookEngineFacts, atRiskCaption: string): string {
  return (
    `Values are this engine's own USD at ${String(engine.usd_decimals)} decimals and are never ` +
    `summed across engines. ${atRiskCaption}`
  );
}

/** SLOT 7's summary for one engine's result. */
export function engineResultForensicsSummary(rows: number): string {
  return `Exact data: the ${String(rows)}-row before and after table, and the wire's own note`;
}

/**
 * SLOT 3 for the whole run book: what the scenario did, per engine, never
 * summed. Computed from `response.engines` (R4).
 */
export function bookResultAnswer(engines: readonly RunBookEngineFacts[]): string {
  if (engines.length === 0) {
    return (
      "This run served no engine result, so it makes no claim about what the scenario does to " +
      "either book."
    );
  }
  const counts = engines
    .map((engine) => `${renderSignedCount(engine.newly_eligible_accounts)} on ${engine.engine}`)
    .join(" and ");
  const debts = engines
    .map(
      (engine) =>
        `${renderSignedUsdAmount(engine.eligible_debt_delta_usd, engine.usd_decimals)} on ` +
        `${engine.engine}`,
    )
    .join(" and ");
  return (
    `This scenario changes eligible accounts by ${counts}. Δ eligible debt ${debts}. Every ` +
    `figure is delta-only and engine books are never summed.`
  );
}

/** SLOT 6 for the whole run book. */
export const BOOK_RESULT_METHOD =
  "Every delta is after minus before for this scenario's own run, on each engine's own book. " +
  "The two engines carry different units and are never added together.";

/** SLOT 7's summary for the whole run book. */
export const BOOK_RESULT_FORENSICS_SUMMARY =
  "Exact data: the path assumption, the shock list, and the coverage counts";

// ---------------------------------------------------------------------------
// LabMatrix — the grid's method line and the legend's key.
// ---------------------------------------------------------------------------

/**
 * SLOT 6 for the grid. The DELTA-ONLY basis used to be repeated in every
 * result cell's sub AND in every result cell's `title`; it is stated once
 * here, which is what lets each cell's sub shrink to its own two facts.
 */
export const MATRIX_METHOD =
  "Every value is Δ eligible debt on a DELTA-ONLY basis: after minus before, this scenario's " +
  "own contribution, in that engine's own USD. There is no total column, because engine books " +
  "are never summed.";

/**
 * The legend's one-line KEY. It names the six state words and nothing else;
 * every definition that describes an absence or a refusal renders in full
 * beneath it, in the open.
 *
 * "Six cell states" was a MISCOUNT (Codex round 47). `LabCellState` has NINE
 * arms: these six plus `not-run`, `running` and `result`, which are the three
 * ordinary ones a reader never needs a legend for. The legend never defined
 * those three and was never going to, so the fix is the word the sentence was
 * missing rather than three more definitions: what this key enumerates is the
 * EXCEPTIONAL states, and it now says so instead of claiming the grid has six
 * states in total.
 */
export const MATRIX_LEGEND_KEY =
  "Six exceptional cell states: NOT COVERED · WITHHELD · SUPERSEDED · UNANSWERED · " +
  "CONTRADICTORY BOOK · DEFINITION CHANGED.";

/** SLOT 7's summary for the matrix legend. */
export const MATRIX_FORENSICS_SUMMARY =
  "Exact data: what NOT COVERED means, the one state knowable before any run";

// ---------------------------------------------------------------------------
// LabAppliedShocks — the shared fragment that had no summary at all.
// ---------------------------------------------------------------------------

/** The three modelling disclosures the applied-shock table carries. */
export interface ShockFlagTally {
  applied: number;
  snapped: number;
  baseSnapped: number;
  capBound: number;
}

export function shockFlagTally(
  shocks: readonly { snapped: boolean; base_snapped: boolean; cap_bound: boolean }[],
): ShockFlagTally {
  return {
    applied: shocks.length,
    snapped: shocks.filter((shock) => shock.snapped).length,
    baseSnapped: shocks.filter((shock) => shock.base_snapped).length,
    capBound: shocks.filter((shock) => shock.cap_bound).length,
  };
}

/**
 * The always-visible COUNTED summary, on the LabHeldFlat / LabOutOfModel
 * pattern the inventory names as this rollout's reference implementation.
 *
 * A `snapped`, `base_snapped` or `cap_bound` YES is a MODELLING DISCLOSURE:
 * the shock the scenario asked for is not the shock that was applied. Those
 * three counts therefore ride the visible line, and only the per-row flags
 * move behind the disclosure.
 */
export function appliedShocksSummary(tally: ShockFlagTally): string {
  const head =
    tally.applied === 1 ? "1 shock applied" : `${String(tally.applied)} shocks applied`;
  return (
    `${head} · ${String(tally.snapped)} snapped to a cap · ` +
    `${String(tally.baseSnapped)} snapped at the base · ${String(tally.capBound)} cap-bound. ` +
    `A snapped shock is not the shock the scenario asked for.`
  );
}

/** The counted `<details>` summary line. */
export function appliedShocksDetailsSummary(applied: number): string {
  return `applied shocks: ${String(applied)} named, with their exact factors and flags`;
}

// ---------------------------------------------------------------------------
// LabRunBookDetail — the three 1.6.0 sub-panels.
// ---------------------------------------------------------------------------

/**
 * SLOT 6 for the before/after histogram pair.
 *
 * The SHARED COUNT SCALE is the whole reason the two charts sit side by side,
 * and it was documented only in a source comment — a decision a reader has to
 * take on trust is not a disclosure. The tint asymmetry gets the same
 * treatment: it renders as a sentence on the panel that obeys it.
 */
export function runbookHistogramMethod(comparator: string, base: string): string {
  const tint =
    comparator === "hf_wad"
      ? "Buckets below 1.00 are tinted because this engine's own comparator makes that region " +
        "eligible for liquidation."
      : "No bucket is tinted: this engine's buckets are a disclosure and its eligibility comes " +
        "from a strict boolean, not from a bucket boundary.";
  return (
    `${base} Both sides are drawn on the SAME 0 to 100 percent axis, so their bar lengths are ` +
    `comparable; scaling each side to its own maximum would draw two charts that look ` +
    `identical while describing a real shift. ${tint}`
  );
}

/** SLOT 7's summary for the histogram pair. */
export function runbookHistogramForensicsSummary(buckets: number): string {
  return `Exact data: the wire's own note and ${String(buckets)} bucket boundaries`;
}

/**
 * SLOT 6 for the movers table: the RANKING RULE, in the panel's own words.
 *
 * The verbatim `movers_note` may sit in FORENSICS only while the truncation
 * count stays in the visible ANSWER — `moversDisclosure` carries it, and if it
 * ever stops, the note has to come back out.
 */
export const MOVERS_METHOD =
  "Each engine ranks a one-direction list of its own: this table shows that ranking, and the " +
  "count above states how much of it fits on this page. An account with no served verdict " +
  "renders an em dash, which is not a no.";

/** SLOT 7's summary for the movers table. */
export const MOVERS_FORENSICS_SUMMARY =
  "Exact data: the server's own statement of its ranking rule and its cap, verbatim";

/**
 * SLOT 3 for the collateral breakdown, across BOTH sides.
 *
 * The count of holdings with no price witness rides the visible sentence: the
 * inventory makes that count a condition of anything else on this panel
 * collapsing, and an unpriced balance is a refusal with an intact amount.
 *
 * THE TWO MEANINGS OF A NULL VALUE ARE SEPARATE SENTENCES (Codex round 47).
 * `value_usd: null` is served for two unrelated reasons, and this line used to
 * pool them and then call the pool "unknowable rather than zero":
 *
 *   UNPRICED (unpriced: true)     no price witness describes the balance, so
 *                                 no USD figure is knowable at all.
 *   NOT COUNTED (unpriced: false) the balance is exact and known, and this
 *                                 engine assigns it no counted USD value.
 *
 * A NOT COUNTED holding is not unknowable. The wire's own note says the
 * arithmetic assigned it no value, so describing it that way told a reader the
 * data was missing when what is actually true is that the engine excluded it.
 * Each count now carries its own clause, and the shared clause claims only what
 * is true of both: neither is inside a total.
 */
export function collateralGroupAnswer(engine: {
  before: { collateral_by_asset: readonly { value_usd: string | null; unpriced: boolean }[] };
  after: { collateral_by_asset: readonly { value_usd: string | null; unpriced: boolean }[] };
}): string {
  const count = (
    side: readonly { value_usd: string | null; unpriced: boolean }[],
    predicate: (entry: { value_usd: string | null; unpriced: boolean }) => boolean,
  ) => side.filter(predicate).length;
  const uncountedBefore = count(engine.before.collateral_by_asset, (e) => e.value_usd === null);
  const uncountedAfter = count(engine.after.collateral_by_asset, (e) => e.value_usd === null);
  const unpricedBefore = count(
    engine.before.collateral_by_asset,
    (e) => e.value_usd === null && e.unpriced,
  );
  const unpricedAfter = count(
    engine.after.collateral_by_asset,
    (e) => e.value_usd === null && e.unpriced,
  );
  // r89: a value beside the no-price-witness flag is a row contradicting
  // itself. It blocks the all-counted blessing and is named on the page.
  const contradictory =
    count(engine.before.collateral_by_asset, (e) => e.value_usd !== null && e.unpriced) +
    count(engine.after.collateral_by_asset, (e) => e.value_usd !== null && e.unpriced);
  const uncounted = uncountedBefore + uncountedAfter;
  const unpriced = unpricedBefore + unpricedAfter;
  const notCounted = uncounted - unpriced;
  const contradictoryClause =
    contradictory === 0
      ? ""
      : ` ${String(contradictory)} ${contradictory === 1 ? "row carries" : "rows carry"} BOTH a ` +
        `dollar value and the no-price-witness flag — CONTRADICTORY, counted in no total here.`;
  if (uncounted === 0) {
    if (contradictory > 0) {
      return `Collateral by asset, before and after the shock.${contradictoryClause}`;
    }
    return (
      "Collateral by asset, before and after the shock. Every holding on both sides carries a " +
      "counted value."
    );
  }
  const clauses: string[] = [];
  if (unpriced > 0) {
    clauses.push(
      `${String(unpriced)} ${unpriced === 1 ? "is" : "are"} UNPRICED: no price witness ` +
        `describes ${unpriced === 1 ? "that balance" : "those balances"}, so ` +
        `${unpriced === 1 ? "its" : "their"} worth is unknowable rather than zero.`,
    );
  }
  if (notCounted > 0) {
    clauses.push(
      `${String(notCounted)} ${notCounted === 1 ? "is" : "are"} NOT COUNTED: the balance is ` +
        `exact and known, and this engine assigns it no counted USD value.`,
    );
  }
  return (
    `Collateral by asset, before and after the shock. ${String(uncounted)} ` +
    `${uncounted === 1 ? "holding is" : "holdings are"} listed with no value across the two ` +
    `sides. ${clauses.join(" ")} Neither kind sits inside a total on this panel.${contradictoryClause}`
  );
}

/**
 * SLOT 6 for the collateral breakdown: the three disclosure kinds, named.
 *
 * NOT COUNTED used to read "a value exists but this engine does not count it",
 * which promises a figure the wire never served and the panel therefore cannot
 * show. What exists is the BALANCE, exact; the USD value was never assigned.
 */
export const COLLATERAL_DISCLOSURE_METHOD =
  "Every row carries one of three disclosures: COUNTED (a served value, inside the total), " +
  "UNPRICED (no price witness describes the balance, so no USD value is knowable and none is " +
  "invented), or NOT COUNTED (the balance is exact and known, and this engine assigns it no " +
  "counted USD value). Amounts stay exact on all three, and only COUNTED is inside the total.";
