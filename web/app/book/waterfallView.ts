// The waterfall's step grammar (solvent-design SUPPLEMENT §18, re-cut by
// W-VR defect 8), as a pure builder so the unit specs can pin it without
// rendering.
//
// SINGLE-LINE TICK LABELS, ALWAYS. The old two-line label/sub pair clipped
// from the LEFT inside a fixed gutter ("insolvent · all dust" rendered as
// "lvent · all dust"; the aave panel lost its "×0.60 · N" prefix outright).
// Every step now carries ONE line that names the whole rung:
//
//   projection — "×0.90 · −10% · 47 acct"
//   standing   — "×1.00 · unshocked · 48 acct"
//   residual   — "−10% bad debt · 48 insolvent"
//
// Dust NEVER hides a step: projections render in full, always. The "all
// dust" qualifier no longer rides a tick label — it is a REAL semantic
// (every counted account at that rung is dust-sized, Σ provably < $10) and
// it moves whole to the panel's all-dust disclosure line
// (`waterfallAllDustLine`), never deleted.

import { formatUnits, parseDecimal, type Waterfall } from "@solvent/client";
// `import type` on the chart primitive keeps this module pure (no CSS import
// reaches the unit-spec transpiler).
import type { WaterfallStep } from "../../components/charts/WaterfallSteps";
import { factorDistancePercent, groupDecimalString } from "../../lib/book-format";
import { sumProvablyDust } from "./dust";

/** Display an exact USD amount: "$4,200" — string surgery, no float. */
function usd(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/** Geometry-only number for bar widths. Display strings stay exact. */
function geometry(value: string, decimals: number): number {
  return Number(formatUnits(value, decimals, { trim: true }));
}

/**
 * "×0.90" from the wad-scaled grid factor — padded to AT LEAST two fraction
 * digits (§18's sub grammar), full precision kept beyond that ("×0.875").
 */
export function factorTimesLabel(factor: string, gridScale: string): string {
  const display = formatUnits(factor, gridScale.length - 1, { trim: true });
  const [whole = "0", fraction = ""] = display.split(".");
  return `×${whole}.${fraction.padEnd(2, "0")}`;
}

/** "−10%" — the signed percent distance of the grid factor from ×1.00. */
export function gridPercentLabel(factor: string, gridScale: string): string {
  return factorDistancePercent(parseDecimal(factor), parseDecimal(gridScale)) ?? "?";
}

/**
 * WAVE W-3L, SLOT 3 — the per-engine ANSWER, COMPUTED from the same points
 * the bars render (R4).
 *
 * The Book drew this grid and never said what it meant; the Lab computes
 * exactly this sentence one route over. The derivation is reused, not the
 * copy: this panel's claim is about the DEEPEST SAMPLED point of a Book-side
 * down-grid, which is not the Lab's cliff claim.
 *
 * It states the bad-debt figure in reader words, so the definitional legend
 * that used to sit beside the grid is no longer load-bearing for the reading.
 */
export function waterfallEngineAnswer(waterfall: Waterfall, engine: string): string {
  let deepest: { index: number; factor: string; at: Waterfall["points"][number]["engines"][number] } | null =
    null;
  for (const point of waterfall.points) {
    const at = point.engines.find((candidate) => candidate.engine === engine);
    if (at === undefined) continue;
    if (deepest === null || point.index > deepest.index) {
      deepest = { index: point.index, factor: point.factor, at };
    }
  }
  if (deepest === null) {
    return (
      `${engine} is absent from every point of this waterfall, so this grid makes no claim ` +
      `about it.`
    );
  }
  const { at } = deepest;
  const where =
    deepest.index === 0
      ? "At the unshocked point"
      : `By ${gridPercentLabel(deepest.factor, waterfall.grid_scale)}`;
  return (
    `${where}, ${engine} could liquidate ${usd(at.cumulative_debt_eligible_usd, at.usd_decimals)} ` +
    `of debt across ${groupDecimalString(String(at.cumulative_eligible_accounts))} accounts, and ` +
    `${usd(at.cumulative_bad_debt_usd, at.usd_decimals)} would still be owed after all ` +
    `collateral is seized. Engine books are never summed.`
  );
}

/** Build one engine's step list from the wire waterfall — pure, exact. */
export function buildWaterfallSteps(waterfall: Waterfall, engine: string): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  for (const point of waterfall.points) {
    const at = point.engines.find((candidate) => candidate.engine === engine);
    if (at === undefined) continue;
    // Grid point 0 is the UNSHOCKED standing census; every later point is a
    // projection and labels itself by its percent distance from ×1.00.
    const percent =
      point.index === 0 ? "unshocked" : gridPercentLabel(point.factor, waterfall.grid_scale);
    const times = factorTimesLabel(point.factor, waterfall.grid_scale);
    steps.push({
      label:
        `${times} · ${percent} · ` +
        `${groupDecimalString(String(at.cumulative_eligible_accounts))} acct`,
      value: geometry(at.cumulative_debt_eligible_usd, at.usd_decimals),
      display: usd(at.cumulative_debt_eligible_usd, at.usd_decimals),
      kind: "flow",
    });
    // Exact string surgery, not a literal compare: a wire form like
    // "0.000000" is still zero, and a floored zero would fabricate a crit
    // residual bar for bad debt that does not exist (design ruling 1).
    if (/[1-9]/.test(at.cumulative_bad_debt_usd)) {
      steps.push({
        label:
          `${percent} bad debt · ` +
          `${groupDecimalString(String(at.insolvent_if_liquidated_accounts))} insolvent`,
        value: geometry(at.cumulative_bad_debt_usd, at.usd_decimals),
        display: usd(at.cumulative_bad_debt_usd, at.usd_decimals),
        kind: "residual",
      });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// W-VR defect 8 — the "all dust" semantic, RELOCATED (never deleted).
//
// The zero-member gate (W-UX-C micro-ruling 1) is unchanged: a rung qualifies
// only when its counted class HAS members AND its Σ is provably < $10
// ("0 acct · all dust" described nobody). What changed is WHERE the fact
// renders: it left the tick labels and became one disclosure line per panel,
// in the method register, naming every qualifying rung.
// ---------------------------------------------------------------------------

/** The rungs whose counted classes are provably all dust, per class. */
export interface WaterfallDustRungs {
  /** Percent labels of flow rungs ("unshocked", "−10%", …). */
  eligible: string[];
  /** Percent labels of bad-debt rungs whose insolvent class is all dust. */
  badDebt: string[];
}

/** Walk the SAME wire points the bars render and collect the dust rungs. */
export function waterfallAllDustRungs(waterfall: Waterfall, engine: string): WaterfallDustRungs {
  const rungs: WaterfallDustRungs = { eligible: [], badDebt: [] };
  for (const point of waterfall.points) {
    const at = point.engines.find((candidate) => candidate.engine === engine);
    if (at === undefined) continue;
    const percent =
      point.index === 0 ? "unshocked" : gridPercentLabel(point.factor, waterfall.grid_scale);
    if (
      at.cumulative_eligible_accounts > 0 &&
      sumProvablyDust(at.cumulative_debt_eligible_usd, at.usd_decimals)
    ) {
      rungs.eligible.push(percent);
    }
    if (
      /[1-9]/.test(at.cumulative_bad_debt_usd) &&
      at.insolvent_if_liquidated_accounts > 0 &&
      sumProvablyDust(at.cumulative_bad_debt_usd, at.usd_decimals)
    ) {
      rungs.badDebt.push(percent);
    }
  }
  return rungs;
}

/**
 * The panel's all-dust disclosure line, or null when no rung qualifies.
 * `ALL_DUST_SUFFIX`'s meaning, stated in full where a reader can hold it:
 * a Σ under $10 proves every member of the summed class is dust-sized.
 */
export function waterfallAllDustLine(rungs: WaterfallDustRungs): string | null {
  const clauses: string[] = [];
  if (rungs.eligible.length > 0) {
    clauses.push(
      `every eligible account at ${rungs.eligible.join(", ")} is dust-sized ` +
        `(Σ eligible debt < $10)`,
    );
  }
  if (rungs.badDebt.length > 0) {
    clauses.push(
      `every insolvent account at ${rungs.badDebt.join(", ")} bad debt is dust-sized ` +
        `(Σ bad debt < $10)`,
    );
  }
  if (clauses.length === 0) return null;
  return `all dust: ${clauses.join("; ")}.`;
}
