// The waterfall's step grammar (solvent-design SUPPLEMENT §18), as a pure
// builder so the unit specs can pin it without rendering.
//
//   flow      — label "−10%" (factorDistancePercent), sub "×0.90 · 46 acct"
//   unshocked — label "unshocked",                    sub "×1.00 · 9,738 acct"
//   residual  — label "−20% bad debt",                sub "46 insolvent"
//
// Dust NEVER hides a step: projections render in full, always; a step whose
// Σ is provably < $10 gets "· all dust" APPENDED to its sub while the exact
// micro-string still prints — never rounded, never suppressed.

import { formatUnits, parseDecimal, type Waterfall } from "@solvent/client";
// `import type` on the chart primitive keeps this module pure (no CSS import
// reaches the unit-spec transpiler).
import type { WaterfallStep } from "../../components/charts/WaterfallSteps";
import { factorDistancePercent, groupDecimalString } from "../../lib/book-format";
import { ALL_DUST_SUFFIX, sumProvablyDust } from "./dust";

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
    // Zero-member gate (W-UX-C micro-ruling 1): the suffix renders only when
    // the counted class HAS members — "0 acct · all dust" described nobody.
    // The Σ still prints in full, however small.
    const eligibleDust =
      at.cumulative_eligible_accounts > 0 &&
      sumProvablyDust(at.cumulative_debt_eligible_usd, at.usd_decimals)
        ? ALL_DUST_SUFFIX
        : "";
    steps.push({
      label: percent,
      sub: `${times} · ${groupDecimalString(String(at.cumulative_eligible_accounts))} acct${eligibleDust}`,
      value: geometry(at.cumulative_debt_eligible_usd, at.usd_decimals),
      display: usd(at.cumulative_debt_eligible_usd, at.usd_decimals),
      kind: "flow",
    });
    // Exact string surgery, not a literal compare: a wire form like
    // "0.000000" is still zero, and a floored zero would fabricate a crit
    // residual bar for bad debt that does not exist (design ruling 1).
    if (/[1-9]/.test(at.cumulative_bad_debt_usd)) {
      // Same zero-member gate on the residual's own count.
      const badDebtDust =
        at.insolvent_if_liquidated_accounts > 0 &&
        sumProvablyDust(at.cumulative_bad_debt_usd, at.usd_decimals)
          ? ALL_DUST_SUFFIX
          : "";
      steps.push({
        label: `${percent} bad debt`,
        sub: `${groupDecimalString(String(at.insolvent_if_liquidated_accounts))} insolvent${badDebtDust}`,
        value: geometry(at.cumulative_bad_debt_usd, at.usd_decimals),
        display: usd(at.cumulative_bad_debt_usd, at.usd_decimals),
        kind: "residual",
      });
    }
  }
  return steps;
}
