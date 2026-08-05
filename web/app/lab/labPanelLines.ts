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

import type {
  RefinedProjection,
  RefinedScenario,
  RefinedScenarioResult,
  Shortfall,
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
// LabBoundaryGroup — the stable-snap boundary set.
// ---------------------------------------------------------------------------

/** How one member's served states came out, and how it was snapped. */
export interface BoundaryMemberTally {
  /** Both states served and bit-identical on every compared field. */
  identical: boolean;
  snapped: number;
  baseSnapped: number;
  applied: number;
}

/** Compare one result's before/after on every field the panel calls served. */
export function boundaryMemberTally(result: RefinedScenarioResult): BoundaryMemberTally {
  const identical =
    result.applicable &&
    result.before !== null &&
    result.after !== null &&
    result.before.health_factor_wad === result.after.health_factor_wad &&
    result.before.health_factor_num === result.after.health_factor_num &&
    result.before.health_factor_den === result.after.health_factor_den &&
    result.before.collateral_usd === result.after.collateral_usd &&
    result.before.debt_usd === result.after.debt_usd &&
    result.before.eligible === result.after.eligible;
  return {
    identical,
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
  let snapped = 0;
  let baseSnapped = 0;
  let notApplicable = 0;
  for (const scenario of group) {
    for (const result of scenario.results) {
      const tally = boundaryMemberTally(result);
      if (!result.applicable) notApplicable += 1;
      else if (!tally.identical) repriced += 1;
      snapped += tally.snapped;
      baseSnapped += tally.baseSnapped;
    }
  }
  const members = group.length === 1 ? "1 committed member" : `${String(group.length)} committed members`;
  const naClause = notApplicable === 0 ? "" : ` ${String(notApplicable)} served no applicable result.`;
  return (
    `${members} on the stable_usd axis. ${String(repriced)} re-priced this address's served ` +
    `states.${naClause} ${String(snapped)} shocks snapped to a cap and ` +
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
 */
export const MATRIX_LEGEND_KEY =
  "Six cell states: NOT COVERED · WITHHELD · SUPERSEDED · UNANSWERED · CONTRADICTORY BOOK · " +
  "DEFINITION CHANGED.";

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
  const uncounted = uncountedBefore + uncountedAfter;
  const unpriced = unpricedBefore + unpricedAfter;
  if (uncounted === 0) {
    return (
      "Collateral by asset, before and after the shock. Every holding on both sides carries a " +
      "counted value."
    );
  }
  return (
    `Collateral by asset, before and after the shock. ${String(uncounted)} ` +
    `${uncounted === 1 ? "holding is" : "holdings are"} listed with no value across the two ` +
    `sides, ${String(unpriced)} of them with no price witness at all. Those balances are ` +
    `unknowable rather than zero, and they sit outside every total on this panel.`
  );
}

/** SLOT 6 for the collateral breakdown: the three disclosure kinds, named. */
export const COLLATERAL_DISCLOSURE_METHOD =
  "Every row carries one of three disclosures: COUNTED (a served value, inside the total), " +
  "UNPRICED (no price witness, so no value exists to serve), or NOT COUNTED (a value exists " +
  "but this engine does not count it). Amounts stay exact on all three.";
