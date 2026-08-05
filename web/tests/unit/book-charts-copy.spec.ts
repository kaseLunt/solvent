// W-UX-D (charts supplement §§17–18 + captions a/b/c) — the pure builders
// behind the waterfall step grammar, the histogram reading lines, and the
// shared verbatim copy.
//
// Laws under test:
//   - waterfall labels come from factorDistancePercent ("−10%"), the
//     unshocked point is labeled "unshocked", subs carry "×0.90 · 46 acct",
//     residuals "{pct} bad debt · {n} insolvent" — and dust NEVER hides a
//     step: it only appends "· all dust" when Σ is provably < $10, while the
//     exact micro-string still prints.
//   - reading lines are COMPUTED from the served values (mutate the input,
//     the line changes) — never asserted, never hardcoded.
//   - the ruling's copy is pinned verbatim so no rewording can drift in.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { EngineHistogram, Waterfall } from "@solvent/client";
import {
  buildWaterfallSteps,
  factorTimesLabel,
  gridPercentLabel,
  waterfallAllDustLine,
  waterfallAllDustRungs,
} from "../../app/book/waterfallView";
import {
  BAD_DEBT_METHOD,
  LIQUIDATABLE_CARD_METHOD,
  badDebtAnswer,
  belowOneCount,
  engineStatsAnswer,
  engineStatsMethod,
  engineStatsSplitLine,
  engineStatsWithheldAnswer,
  histogramReadingLine,
  liquidatableCardSub,
  riskMapCellDetailLine,
  riskMapCoverageLine,
  riskMapCritStripNote,
  riskMapLaneDisclosure,
  riskMapMethodLine,
  riskMapReadingLine,
  RISK_MAP_EXACT_DATA,
  RISK_MAP_FORENSICS_SUMMARY,
} from "../../app/book/readingLines";
import type { RiskBinsResult } from "../../app/book/riskBins";
import {
  AT_RISK_READER_CAPTION,
  BAD_DEBT_LEGEND,
  ELIGIBLE_REALIZED_GLOSS,
  HELD_FLAT_VALUE_HEADER,
  heldFlatDetailsSummary,
  heldFlatSummary,
  RISK_BAND_HEADING,
  RISK_BAND_METHOD,
  riskBandDenominatorLine,
  riskBandNoDebtRow,
  riskBandPairAria,
  riskBandPanelAria,
  riskBandRefusedRow,
  WATERFALL_SECTION_NOTE,
  wireNotesSummary,
} from "../../lib/book-copy";
import { sharePercent, shareBarWidth } from "../../lib/book-format";
import { BOOK } from "../fixtures/book";

const WAD = 10n ** 18n;

function fixtureWaterfall(): Waterfall {
  if (BOOK.waterfall === null) throw new Error("fixture book.json must carry a waterfall");
  return BOOK.waterfall;
}

/**
 * W-VR defect 8 — THE TICK VOCABULARY, AS REGEXES. Every label is single
 * line and LEADS with its exact ×factor: "×0.90 · −10% · 47 acct" for flows,
 * "×0.90 · −10% bad debt · 48 insolvent" for residuals (Codex r55: the
 * percent truncates to one fraction digit, so a percent-only residual label
 * collides across legal neighbouring rungs). Counts take grouped thousands;
 * "all dust" never rides a tick label.
 */
const FLOW_TICK = /^×\d+\.\d{2,} · (unshocked|−\d+(\.\d+)?%) · \d{1,3}(,\d{3})* acct$/u;
const RESIDUAL_TICK =
  /^×\d+\.\d{2,} · (unshocked|−\d+(\.\d+)?%) bad debt · \d{1,3}(,\d{3})* insolvent$/u;

test.describe("waterfall step grammar (§18, single-line ticks per W-VR)", () => {
  test("factor labels pad to two fraction digits: ×0.90, ×1.00", () => {
    const scale = "1000000000000000000";
    expect(factorTimesLabel("1000000000000000000", scale)).toBe("×1.00");
    expect(factorTimesLabel("900000000000000000", scale)).toBe("×0.90");
    expect(factorTimesLabel("500000000000000000", scale)).toBe("×0.50");
    expect(factorTimesLabel("875000000000000000", scale)).toBe("×0.875");
  });

  test("percent labels come from factorDistancePercent, verbatim", () => {
    const scale = "1000000000000000000";
    expect(gridPercentLabel("900000000000000000", scale)).toBe("−10%");
    expect(gridPercentLabel("800000000000000000", scale)).toBe("−20%");
    expect(gridPercentLabel("700000000000000000", scale)).toBe("−30%");
  });

  test("DM steps from the fixture: single-line ticks — census, percent flows, insolvent residuals", () => {
    const steps = buildWaterfallSteps(fixtureWaterfall(), "debt_manager");
    // Point 0: the standing census + its residual annotation.
    expect(steps[0]).toMatchObject({
      label: "×1.00 · unshocked · 1 acct",
      display: "$4,200",
      kind: "flow",
    });
    expect(steps[1]).toMatchObject({
      label: "×1.00 · unshocked bad debt · 1 insolvent",
      display: "$239.603961", // the exact micro-string, never rounded
      kind: "residual",
    });
    // Point 1: the −10% projection keeps its ×factor prefix ALWAYS.
    expect(steps[2]).toMatchObject({
      label: "×0.90 · −10% · 1 acct",
      display: "$4,200",
      kind: "flow",
    });
    expect(steps[3]).toMatchObject({
      label: "×0.90 · −10% bad debt · 1 insolvent",
      display: "$635.643565",
      kind: "residual",
    });
  });

  test("EVERY tick label is single-line, matches the vocabulary, and carries no dust suffix", () => {
    for (const engine of ["debt_manager", "aave_v3_etherfi"]) {
      const steps = buildWaterfallSteps(fixtureWaterfall(), engine);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        // Single line: a tick label may never wrap or stack.
        expect(step.label).not.toContain("\n");
        // The two-line grammar is DEAD: no step carries a `sub` at all.
        expect("sub" in step).toBe(false);
        // The vocabulary regex — a clipped label ("lvent · all dust") or a
        // lost "×0.90 ·" prefix cannot match either arm.
        expect(step.label, step.label).toMatch(
          step.kind === "residual" ? RESIDUAL_TICK : FLOW_TICK,
        );
        expect(step.label).not.toContain("all dust");
      }
    }
  });

  test("aave steps: zero members render honestly; a true zero residual draws no step", () => {
    const steps = buildWaterfallSteps(fixtureWaterfall(), "aave_v3_etherfi");
    // Σ eligible at ×1.00 is "0" over ZERO accounts: the $0 prints — an
    // honest zero over a computed class — and no dust adjective describes it
    // anywhere (W-UX-C micro-ruling 1, now enforced on the disclosure line).
    expect(steps[0]).toMatchObject({
      label: "×1.00 · unshocked · 0 acct",
      display: "$0",
      kind: "flow",
    });
    // −10%: real money.
    expect(steps[1]).toMatchObject({
      label: "×0.90 · −10% · 1 acct",
      display: "$6,000",
      kind: "flow",
    });
    // Bad debt is "0" through −20%: NO residual steps exist for those points.
    expect(steps.filter((step) => step.kind === "residual")[0]).toMatchObject({
      label: "×0.70 · −30% bad debt · 1 insolvent",
      display: "$666.66666667",
    });
    // The fixture's classes are not dust, so the disclosure line is NULL —
    // absence of the fact, not an empty sentence.
    expect(waterfallAllDustLine(waterfallAllDustRungs(fixtureWaterfall(), "aave_v3_etherfi"))).toBeNull();
  });

  test("dust never hides a step, and the all-dust fact RELOCATES to the disclosure line", () => {
    const waterfall: Waterfall = {
      scenario_id: "t",
      scenario_version: "v1",
      axis: "eth_usd",
      grid_scale: "1000000000000000000",
      points: [
        {
          index: 0,
          factor: "1000000000000000000",
          engines: [
            {
              engine: "debt_manager",
              usd_decimals: 6,
              newly_eligible_accounts: 0,
              cumulative_eligible_accounts: 2,
              cumulative_debt_eligible_usd: "9999999", // $9.999999 — provably dust
              cumulative_collateral_at_risk_usd: "0",
              insolvent_if_liquidated_accounts: 2,
              cumulative_bad_debt_usd: "5", // $0.000005 — nonzero, provably dust
            },
          ],
        },
      ],
      held_flat: [],
      eligibility_note: "",
      monotonicity: { ok: true },
      at_risk_note: "",
      excluded_engines: [],
    };
    const steps = buildWaterfallSteps(waterfall, "debt_manager");
    expect(steps).toHaveLength(2); // the projection renders IN FULL, always
    expect(steps[0]).toMatchObject({
      label: "×1.00 · unshocked · 2 acct",
      display: "$9.999999", // exact, never rounded
    });
    expect(steps[1]).toMatchObject({
      label: "×1.00 · unshocked bad debt · 2 insolvent",
      display: "$0.000005", // the exact micro-string still prints
    });
    // The tick labels carry NO dust qualifier…
    for (const step of steps) expect(step.label).not.toContain("all dust");
    // …because the panel's disclosure line carries it WHOLE: the same wire
    // points, the same zero-member gate, every qualifying rung named.
    expect(waterfallAllDustRungs(waterfall, "debt_manager")).toEqual({
      eligible: ["unshocked"],
      badDebt: ["unshocked"],
    });
    expect(waterfallAllDustLine(waterfallAllDustRungs(waterfall, "debt_manager"))).toBe(
      "all dust: every eligible account at unshocked is dust-sized (Σ eligible debt < $10); " +
        "every insolvent account at unshocked bad debt is dust-sized (Σ bad debt < $10).",
    );
  });

  test("rung identity survives percent truncation: ×0.9999 and ×0.9998 never collide (Codex r55)", () => {
    // Both factors truncate to the SAME displayed percent (−0.1%), which is a
    // legal grid (strictly descending interior factors). Identity therefore
    // rides the exact ×factor: labels stay distinct, and the dust disclosure
    // names the factor so the fact can never attach to the wrong rung.
    const engineAt = (eligibleUsd: string, badUsd: string, insolvent: number) => ({
      engine: "debt_manager",
      usd_decimals: 6,
      newly_eligible_accounts: 0,
      cumulative_eligible_accounts: 1,
      cumulative_debt_eligible_usd: eligibleUsd,
      cumulative_collateral_at_risk_usd: "0",
      insolvent_if_liquidated_accounts: insolvent,
      cumulative_bad_debt_usd: badUsd,
    });
    const waterfall: Waterfall = {
      scenario_id: "t",
      scenario_version: "v1",
      axis: "eth_usd",
      grid_scale: "1000000000000000000",
      points: [
        { index: 0, factor: "1000000000000000000", engines: [engineAt("50000000", "0", 0)] },
        // ×0.9999 → −0.1% displayed; eligible Σ $9.999999 is provably dust.
        { index: 1, factor: "999900000000000000", engines: [engineAt("9999999", "3", 1)] },
        // ×0.9998 → the SAME −0.1% displayed; NOT dust ($50).
        { index: 2, factor: "999800000000000000", engines: [engineAt("50000000", "5", 1)] },
      ],
      held_flat: [],
      eligibility_note: "",
      monotonicity: { ok: true },
      at_risk_note: "",
      excluded_engines: [],
    };
    const steps = buildWaterfallSteps(waterfall, "debt_manager");
    const labels = steps.map((step) => step.label);
    // Every label is unique even though the two projections share a percent.
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("×0.9999 · −0.1% · 1 acct");
    expect(labels).toContain("×0.9998 · −0.1% · 1 acct");
    expect(labels).toContain("×0.9999 · −0.1% bad debt · 1 insolvent");
    expect(labels).toContain("×0.9998 · −0.1% bad debt · 1 insolvent");
    // The disclosure pins the fact to ×0.9999 ALONE, by factor, not percent.
    expect(waterfallAllDustRungs(waterfall, "debt_manager")).toEqual({
      eligible: ["×0.9999 (−0.1%)"],
      badDebt: ["×0.9999 (−0.1%)", "×0.9998 (−0.1%)"],
    });
    const line = waterfallAllDustLine(waterfallAllDustRungs(waterfall, "debt_manager"));
    expect(line).toBe(
      "all dust: every eligible account at ×0.9999 (−0.1%) is dust-sized " +
        "(Σ eligible debt < $10); every insolvent account at ×0.9999 (−0.1%), " +
        "×0.9998 (−0.1%) bad debt is dust-sized (Σ bad debt < $10).",
    );
  });

  test("the zero-member gate binds the disclosure line: 0 acct is never described as dust", () => {
    const waterfall: Waterfall = {
      scenario_id: "t",
      scenario_version: "v1",
      axis: "eth_usd",
      grid_scale: "1000000000000000000",
      points: [
        {
          index: 0,
          factor: "1000000000000000000",
          engines: [
            {
              engine: "debt_manager",
              usd_decimals: 6,
              newly_eligible_accounts: 0,
              cumulative_eligible_accounts: 0, // ZERO members…
              cumulative_debt_eligible_usd: "0", // …over a vacuously dust Σ
              cumulative_collateral_at_risk_usd: "0",
              insolvent_if_liquidated_accounts: 0,
              cumulative_bad_debt_usd: "0",
            },
          ],
        },
      ],
      held_flat: [],
      eligibility_note: "",
      monotonicity: { ok: true },
      at_risk_note: "",
      excluded_engines: [],
    };
    expect(waterfallAllDustRungs(waterfall, "debt_manager")).toEqual({
      eligible: [],
      badDebt: [],
    });
    expect(waterfallAllDustLine({ eligible: [], badDebt: [] })).toBeNull();
  });
});

test.describe("histogram reading lines (§17) — computed, never asserted", () => {
  const aaveHist = BOOK.hf_histogram.engines[0] as EngineHistogram;
  const dmHist = BOOK.hf_histogram.engines[1] as EngineHistogram;
  const aaveAgg = BOOK.engines[0];
  const dmAgg = BOOK.engines[1];
  const aaveBadDebt = BOOK.bad_debt[0];
  const dmBadDebt = BOOK.bad_debt[1];

  test("the aave line: sub-1.00 bucket sum over the computed denominator, Σ eligible debt", () => {
    // Zero eligible members (W-UX-C micro-ruling 1): NO "· all dust" over an
    // empty class — the $0 Σ still renders, honest over a computed book.
    expect(histogramReadingLine(aaveHist, aaveAgg, aaveBadDebt, WAD)).toBe(
      "What this shows: how many accounts sit at each health factor. 0 of 1 are below 1.00, " +
        "where the engine may liquidate. Σ eligible debt $0.",
    );
  });

  test("the DM line: a disclosure, with the engine's own verdict count", () => {
    expect(histogramReadingLine(dmHist, dmAgg, dmBadDebt, WAD)).toBe(
      "What this shows: how many accounts sit at each borrow-headroom ratio, which is a " +
        "disclosure rather than the engine's trigger. The engine's own verdict counts 1 of 1 " +
        "liquidatable. Σ eligible debt $4,200.",
    );
  });

  test("MUTATE the inputs and the line changes — nothing is hardcoded", () => {
    const mutatedHist = structuredClone(aaveHist);
    const bucket = mutatedHist.buckets.find((candidate) => candidate.label === "0.90 – 1.00");
    if (bucket === undefined || aaveAgg === undefined) throw new Error("fixture shape drifted");
    bucket.count = 2;
    const mutatedAgg = structuredClone(aaveAgg);
    mutatedAgg.computed_positions = 4;
    const line = histogramReadingLine(mutatedHist, mutatedAgg, aaveBadDebt, WAD);
    expect(line).toContain("2 of 4 are below 1.00");

    if (dmAgg === undefined || dmBadDebt === undefined) throw new Error("fixture shape drifted");
    const mutatedDmAgg = structuredClone(dmAgg);
    mutatedDmAgg.liquidatable_positions = 3;
    const mutatedDmBadDebt = structuredClone(dmBadDebt);
    mutatedDmBadDebt.eligible_debt_usd = "9000000"; // $9 — provably dust
    const dmLine = histogramReadingLine(dmHist, mutatedDmAgg, mutatedDmBadDebt, WAD);
    expect(dmLine).toContain("counts 3 of 1 liquidatable");
    expect(dmLine).toContain("Σ eligible debt $9 · all dust.");
  });

  test("belowOneCount sums exactly the buckets wholly at-or-below the wad", () => {
    expect(belowOneCount(aaveHist, WAD)).toBe(0);
    expect(belowOneCount(dmHist, WAD)).toBe(1); // the "< 0.90" bucket's one row
    const mutated = structuredClone(aaveHist);
    for (const bucket of mutated.buckets) bucket.count = 7;
    // Two buckets sit wholly at-or-below 1e18 (< 0.90 and 0.90 – 1.00).
    expect(belowOneCount(mutated, WAD)).toBe(14);
  });

  // W-3L moved the Σ from the Liquidatable card's `sub` into the block's
  // ANSWER. The law is unchanged and is re-pinned at equal strength on the
  // sentence that now carries the adjective.
  test("a withheld Σ renders the em dash — never the adjective without the Σ, never 0", () => {
    if (dmAgg === undefined || dmBadDebt === undefined) throw new Error("fixture shape drifted");
    expect(engineStatsAnswer(dmAgg, undefined)).toContain("Σ eligible debt —");
    expect(engineStatsAnswer(dmAgg, undefined)).not.toContain("$0");
    const withheld = structuredClone(dmBadDebt);
    withheld.eligible_debt_usd = null;
    expect(engineStatsAnswer(dmAgg, withheld)).toContain("Σ eligible debt —");
    expect(engineStatsAnswer(dmAgg, withheld)).not.toContain("$0");
  });

  test("the per-engine ANSWER carries the count, its denominator and the Σ", () => {
    if (dmAgg === undefined) throw new Error("fixture shape drifted");
    expect(engineStatsAnswer(dmAgg, dmBadDebt)).toBe(
      "debt_manager: 1 of 1 computed positions liquidatable · Σ eligible debt $4,200.",
    );
  });

  test("MUTATE the aggregate and the ANSWER changes — nothing is hardcoded (R4)", () => {
    if (dmAgg === undefined) throw new Error("fixture shape drifted");
    const mutated = structuredClone(dmAgg);
    mutated.liquidatable_positions = 1234;
    mutated.computed_positions = 5678;
    expect(engineStatsAnswer(mutated, dmBadDebt)).toContain(
      "1,234 of 5,678 computed positions liquidatable",
    );
  });

  test("the Liquidatable card sub narrows to the DENOMINATOR alone", () => {
    expect(liquidatableCardSub(8214)).toBe("of 8,214 computed positions");
    expect(liquidatableCardSub(8214)).not.toContain("Σ");
    expect(liquidatableCardSub(8214)).not.toContain("comparator");
  });

  test("the comparator clause is the card's METHOD slot, not its sub", () => {
    expect(LIQUIDATABLE_CARD_METHOD).toBe("engine's own comparator");
  });

  test("the withheld-engine ANSWER states unknown, never zero", () => {
    if (aaveAgg === undefined) throw new Error("fixture shape drifted");
    const refused = structuredClone(aaveAgg);
    refused.refused = true;
    refused.refusal = { engine: refused.engine, code: "ENGINE_WITHHELD", detail: "gate closed", note: "" };
    const line = engineStatsWithheldAnswer(refused);
    expect(line).toContain("ENGINE_WITHHELD");
    expect(line).toContain("unknown rather than zero");
    expect(line).not.toContain("0 of");
  });

  test("the position split is COMPUTED and groups its counts", () => {
    if (aaveAgg === undefined) throw new Error("fixture shape drifted");
    const mutated = structuredClone(aaveAgg);
    mutated.positions = 12345;
    mutated.computed_positions = 12000;
    mutated.refused_positions = 300;
    mutated.flagged_positions = 45;
    expect(engineStatsSplitLine(mutated)).toBe(
      "12,345 positions · 12,000 computed · 300 refused · 45 flagged",
    );
  });

  test("the engine METHOD line ends in the wire's own unit_note, verbatim", () => {
    if (aaveAgg === undefined) throw new Error("fixture shape drifted");
    expect(engineStatsMethod(aaveAgg)).toContain(aaveAgg.unit_note);
    expect(engineStatsMethod(aaveAgg)).toContain("engines are never combined");
  });
});

// ---------------------------------------------------------------------------
// W-3L — the bad-debt census ANSWER: per engine, never summed, and a withheld
// engine present IN the sentence as unknown rather than dropped from it.
// ---------------------------------------------------------------------------

test.describe("the bad-debt census answer", () => {
  test("names every engine and never sums them", () => {
    const line = badDebtAnswer(BOOK.bad_debt);
    expect(line).toContain("aave_v3_etherfi");
    expect(line).toContain("debt_manager");
    expect(line).toContain("Engine books are never summed.");
  });

  test("a withheld engine renders an em dash IN the sentence, never a zero", () => {
    const rows = structuredClone(BOOK.bad_debt);
    const first = rows[0];
    if (first === undefined) throw new Error("fixture shape drifted");
    first.refused = true;
    first.refusal = { engine: first.engine, code: "ENGINE_WITHHELD", detail: "gate closed", note: "" };
    first.current_bad_debt_usd = null;
    const line = badDebtAnswer(rows);
    expect(line).toContain(`— on ${first.engine} (ENGINE_WITHHELD, unknown rather than zero)`);
    expect(line).toContain(first.engine);
  });

  test("an empty census states the service fact, and reports no zero", () => {
    const line = badDebtAnswer([]);
    expect(line).toContain("is reported as zero");
    expect(line).not.toContain("$0");
  });

  test("the census METHOD carries the null-never-zero law", () => {
    expect(BAD_DEBT_METHOD).toContain("never 0");
  });
});

test.describe("the ruling's copy, pinned verbatim", () => {
  test("waterfall section note", () => {
    expect(WATERFALL_SECTION_NOTE).toBe(
      "If the shocked asset fell step by step, how much debt could the engine liquidate, and " +
        "how much would it lose? Bars: cumulative eligible debt at each price. ×1.00 is the " +
        "standing census; every lower point is a projection.",
    );
  });

  test("bad-debt legend line", () => {
    expect(BAD_DEBT_LEGEND).toBe(
      "bad debt = debt still owed after all collateral is seized, the protocol's loss at that price.",
    );
  });

  test("eligible-vs-realized gloss", () => {
    expect(ELIGIBLE_REALIZED_GLOSS).toBe(
      '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
        "closes can be less: the Debt Manager liquidates in two passes, half the debt, then " +
        "the remainder.",
    );
  });

  test("held-flat copy builders", () => {
    expect(heldFlatSummary(3)).toBe(
      "3 price inputs held flat. The scenario did not move these prices, so positions priced by " +
        "them are stressed at stale marks. Each one keeps its standing value, and the scenario " +
        "is blind to where it would have gone.",
    );
    expect(heldFlatDetailsSummary(3)).toBe("held flat: 3 inputs named");
    expect(HELD_FLAT_VALUE_HEADER).toBe("held value (source's raw units, unscaled by design)");
  });

  test("held-flat summary pluralizes: singular prose at n = 1 (W-UX-C micro-ruling 3)", () => {
    expect(heldFlatSummary(1)).toBe(
      "1 price input held flat. The scenario did not move these prices, so positions priced by " +
        "them are stressed at stale marks. Each one keeps its standing value, and the scenario " +
        "is blind to where it would have gone.",
    );
    // The counted label-value line may stay invariant — pinned so the ruling's
    // scope is deliberate.
    expect(heldFlatDetailsSummary(1)).toBe("held flat: 1 inputs named");
  });

  test("collateral-at-risk reader caption and wire-notes summary", () => {
    expect(AT_RISK_READER_CAPTION).toBe(
      "collateral at risk is re-measured at each price step, so it can fall as prices fall, " +
        "because the same collateral is worth less. A dip in the line comes from that " +
        "arithmetic, not from missing data.",
    );
    expect(wireNotesSummary(2)).toBe("wire notes: 2, verbatim");
  });
});

// ---------------------------------------------------------------------------
// CHART SPEC v4 — the risk map's FINAL COPY, and CX-5 / CX-6 / CX-8.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// W-VR defect 2 — the risk map's ANSWER is ONE computed sentence: the warn-
// edge finding over the plotted book, grouped counts, exact Σs through the
// engine-unit renderer. The dek carries the panel's claim; the STATE coverage
// line carries coverage; the ANSWER repeats neither.
// ---------------------------------------------------------------------------

/** A minimal bin result: only the fields the reading line reads. */
function readingFixture(): RiskBinsResult {
  const marginal = (band: number, count: number, debt: bigint) => ({
    band,
    label: `band-${String(band)}`,
    count,
    debt,
    debtDisplay: "",
    title: "",
  });
  return {
    bins: [],
    crit: [],
    outliers: [],
    bandTotals: [
      marginal(0, 4, 100_000000n), // breached — inside the warn edge
      marginal(1, 0, 0n),
      marginal(2, 0, 0n),
      marginal(3, 360, 538_829_784427n), // 5–10% — still inside the warn edge
      marginal(4, 0, 0n),
      marginal(5, 8338, 22_230_308_119167n), // outside the warn edge
      marginal(6, 0, 0n),
    ],
    aside: { noDebt: 0, unknown: 0, refused: 1, unplottable: 0, total: 1 },
    belowOne: { count: 0, debt: 0n },
    xMinExp: 0,
    xMaxExp: 1,
    total: 8703,
    decimals: 6,
  };
}

test.describe("the risk map's ANSWER — computed, single-statement (W-VR)", () => {
  test("counts are grouped, both Σs are exact, and nothing else rides the sentence", () => {
    expect(riskMapReadingLine(readingFixture())).toBe(
      "364 of 8,702 plotted accounts have less than 10% of their borrowing capacity left, " +
        "carrying Σ debt 538,929.784427 of the 22,769,237.903594 mapped here.",
    );
  });

  test("the dek's claim, the coverage clause and the old lead are all GONE from the ANSWER", () => {
    const line = riskMapReadingLine(readingFixture());
    expect(line).not.toContain("What this shows");
    expect(line).not.toContain("every walked row is plotted");
    expect(line).not.toContain("counted aside");
    expect(line).not.toContain("Where accounts cluster");
    expect(line).not.toContain("in the engine's own unit");
    // The Σ spans plotted accounts only; "the book's" would hand the reader a
    // second, contradictory book total (the cards above carry the real one).
    expect(line).not.toContain("the book's");
  });

  test("MUTATE the bands and the sentence changes — computed, never hardcoded (R4)", () => {
    const mutated = readingFixture();
    const breached = mutated.bandTotals[0];
    if (breached === undefined) throw new Error("fixture shape drifted");
    breached.count = 5;
    breached.debt = 200_000000n;
    expect(riskMapReadingLine(mutated)).toBe(
      "365 of 8,702 plotted accounts have less than 10% of their borrowing capacity left, " +
        "carrying Σ debt 539,029.784427 of the 22,769,337.903594 mapped here.",
    );
  });
});

test.describe("the risk map's FINAL COPY block, verbatim", () => {
  // AC-27 — the lane disclosure computes its own lower bound.
  test("the lane disclosure names the COMPUTED bound and the incomparability", () => {
    expect(riskMapLaneDisclosure(-6)).toBe(
      "Sub-$1 debts occupy an order-preserving compressed log lane spanning $1e-6 to <$1 in " +
        "this snapshot. Horizontal distances in this lane are not comparable with the main axis.",
    );
    // Computed, not asserted: a different domain gives a different bound.
    expect(riskMapLaneDisclosure(-3)).toContain("spanning $1e-3 to <$1");
  });

  // AC-26 — the coverage line's exact grammar.
  test("the coverage line reads `{plotted} plotted of {book} · {aside} counted aside`", () => {
    expect(riskMapCoverageLine(8214, 8646, 432)).toBe("8,214 plotted of 8,646 · 432 counted aside");
    // RM-15 / R7: it renders with ZERO refusals too, and says so honestly.
    expect(riskMapCoverageLine(2, 2, 0)).toBe("2 plotted of 2 · 0 counted aside");
  });

  test("the conditional crit note names the count and where the rest is listed", () => {
    expect(riskMapCritStripNote(20)).toBe(
      "20 liquidatable marks share a debt neighbourhood and are stacked so each stays " +
        "individually reachable. Every one is listed with its exact debt below.",
    );
    // W-VR defect 4: the callout-overflow note died with the drawn callouts —
    // nothing is drawn, so nothing can overflow.
  });

  test("the activated cell's sentence carries count, Σ, range and band", () => {
    expect(riskMapCellDetailLine(37, "1,204,556", "$1k", "$3,162", "0–2%", 24)).toBe(
      "37 accounts, Σ debt 1,204,556, debt $1k to $3,162, headroom 0–2%. " +
        "Showing the top 24 by debt of 37, all counted.",
    );
  });

  test("METHOD names the encoding, the unit and the as-of", () => {
    expect(riskMapMethodLine(1)).toBe(
      "Cell shading counts accounts on a four-step ramp. Rows are headroom bands, the " +
        "horizontal axis is debt size, and the right-margin bars carry each band's exact total " +
        "debt on one common scale. Exact counts and totals are in the ledger below, as of " +
        "batch #1.",
    );
  });

  test("FORENSICS names what it holds, and the control names itself", () => {
    expect(RISK_MAP_FORENSICS_SUMMARY).toBe(
      "Exact data: band totals, every bin, top exposures with full addresses, and " +
        "liquidatable accounts",
    );
    expect(RISK_MAP_EXACT_DATA).toBe("Exact data");
  });
});

// AC-52 / CX-5
test.describe("CX-5 — the risk-band distribution rename (display only)", () => {
  test("the heading and the two aria strings are the spec's, verbatim", () => {
    expect(RISK_BAND_HEADING).toBe("Risk-band distribution: each engine on its own comparator");
    expect(riskBandPanelAria("debt_manager", "hf_num/hf_den")).toBe(
      "risk-band distribution for debt_manager on comparator hf_num/hf_den",
    );
    expect(riskBandPairAria("aave_v3_etherfi")).toBe(
      "risk-band distribution before and after for aave_v3_etherfi",
    );
  });

  test("no copy constant says `HF histogram` or `health-factor histogram`", () => {
    const strings = [
      RISK_BAND_HEADING,
      RISK_BAND_METHOD,
      riskBandPanelAria("e", "c"),
      riskBandPairAria("e"),
      riskBandDenominatorLine(0),
      riskBandNoDebtRow(0),
      riskBandRefusedRow(0),
    ];
    for (const value of strings) {
      expect(value).not.toContain("HF histogram");
      expect(value).not.toContain("health-factor histogram");
      expect(value).not.toContain("HF distribution");
    }
  });

  test("the METHOD line names the denominator the bars are a share OF", () => {
    expect(RISK_BAND_METHOD).toBe(
      "Buckets are policy bands of unequal width. Bar length is each bucket's share of this " +
        "engine's debt-bearing accounts with a finite comparator, on a common 0 to 100 percent " +
        "axis. Exact counts sit beside each bar.",
    );
    expect(riskBandDenominatorLine(1204)).toBe(
      "denominator: 1,204 debt-bearing accounts with a finite comparator",
    );
  });

  test("the accounting rows are their own rows, in the reader's words", () => {
    expect(riskBandNoDebtRow(46)).toBe("no debt (no comparator): 46");
    expect(riskBandRefusedRow(2)).toBe("refused: 2");
  });
});

// AC-53 arithmetic / CX-6 / CX-8
test.describe("CX-6 — percent share by exact integer arithmetic", () => {
  test("count × 1000 / denominator, TRUNCATED, rendered in tenths", () => {
    expect(sharePercent(1, 1)).toBe("100");
    expect(sharePercent(1, 2)).toBe("50");
    expect(sharePercent(1, 3)).toBe("33.3"); // 333/10 — truncated, never 33.4
    expect(sharePercent(2, 3)).toBe("66.6"); // 666/10 — truncated, never 66.7
    expect(sharePercent(0, 5)).toBe("0");
    expect(sharePercent(1, 8)).toBe("12.5");
  });

  test("a bucket at 100% spans the full axis, and a zero bucket draws none", () => {
    expect(shareBarWidth(1, 1, 240)).toBe(240);
    expect(shareBarWidth(0, 4, 240)).toBe(0);
    expect(shareBarWidth(1, 4, 240)).toBeCloseTo(60, 9);
    expect(shareBarWidth(1, 2, 168)).toBeCloseTo(84, 9);
  });

  // W-CH-B finding 4: the geometry carries the TRUE share, at a precision the
  // old permille fraction did not have, and with NO width floor on top of it.
  //
  // The old path was `max(trunc(count*1000/den)/1000 * BAR_MAX, 1.5)`. On the
  // Book's 240px axis that floor is 0.625% of the axis, so a bucket the row
  // label truthfully printed as `0%` drew MORE ink than a bucket at a real
  // 0.5%, and every share below 0.1% collapsed to the same three shapes.
  test("a tiny share renders its TRUE width, with no floor and no permille collapse", () => {
    // 1 of 10,000 is 0.01%: 0.024px on a 240px axis. The old permille path
    // truncated the share to 0 and then floored the bar to 1.5px — 62x too
    // long, and identical to the bar drawn for 1 of 1,000,000.
    expect(shareBarWidth(1, 10_000, 240)).toBeCloseTo(0.024, 6);
    expect(shareBarWidth(1, 1_000_000, 240)).toBeCloseTo(0.00024, 8);
    // Two shares three orders of magnitude apart draw three orders of
    // magnitude apart. Under the floor they were the same 1.5px.
    expect(shareBarWidth(1, 10_000, 240) / shareBarWidth(1, 1_000_000, 240)).toBeCloseTo(100, 4);
    // Nothing is rounded UP to a visible width, on either axis.
    expect(shareBarWidth(1, 10_000, 240)).toBeLessThan(1);
    expect(shareBarWidth(1, 10_000, 168)).toBeLessThan(1);
    // The 0.625% overstatement the floor produced is gone: a bucket printed
    // as `0%` now occupies less than a tenth of a percent of the axis.
    expect(sharePercent(1, 10_000)).toBe("0");
    expect(shareBarWidth(1, 10_000, 240) / 240).toBeLessThan(0.001);
  });

  test("the width is exact-integer derived and never exceeds the axis", () => {
    // A denominator smaller than the count cannot draw past the axis end.
    expect(shareBarWidth(5, 1, 240)).toBe(240);
    // TRUNCATION, never rounding: 1/7 of 240 is 34.285714285…, and the
    // rendered width is the truncated micro-pixel, which can only understate.
    expect(shareBarWidth(1, 7, 240)).toBe(34.285714);
    expect(shareBarWidth(1, 7, 240)).toBeLessThan(240 / 7);
  });

  // CX-8
  test("NO percentage renders against a zero denominator", () => {
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, 0)).toBeNull();
    expect(shareBarWidth(5, 0, 240)).toBe(0);
  });

  // CX-8
  test("a percentage above 9,999% reads `from near-zero`", () => {
    // The boundary is INCLUSIVE of 9,999%: above it, the number is a statement
    // about the denominator rather than about the numerator.
    expect(sharePercent(9_999, 100)).toBe("9999");
    expect(sharePercent(10_000, 100)).toBe("from near-zero");
    expect(sharePercent(10_000, 1)).toBe("from near-zero");
    expect(sharePercent(1, 0)).toBeNull();
  });

  test("the share TRUNCATES at book scale — no double ever holds the ratio", () => {
    // 8,214 of 8,646 is 95.00…%; a float path drifts here, integer work does
    // not. Truncation always understates, which is the conservative direction.
    expect(sharePercent(8_214, 8_646)).toBe("95");
    expect(sharePercent(8_215, 8_646)).toBe("95");
    expect(sharePercent(8_300, 8_646)).toBe("95.9"); // 959 permille, never 96
  });
});

// AC-55 — no changed file references a token that does not exist.
test("R8 / AC-55: no `--ink-1` reference survives in any file this wave touched", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, "../..");
  const touched = [
    "app/book/riskBins.ts",
    "app/book/BookRiskMap.tsx",
    "app/book/BookHistogram.tsx",
    "app/book/readingLines.ts",
    "app/book/dust.ts",
    "app/book/book.module.css",
    "app/lab/LabFrontier.tsx",
    "app/lab/frontierScale.ts",
    "app/lab/frontierView.ts",
    "app/lab/labReadingLines.ts",
    "app/lab/LabBookPanel.tsx",
    "app/lab/LabRealization.tsx",
    "app/lab/LabRunBookDetail.tsx",
    "app/lab/lab.module.css",
    "components/charts/DensityMap.tsx",
    "components/charts/RiskMapLedger.tsx",
    "components/charts/FrontierLedger.tsx",
    "components/charts/charts.module.css",
    "lib/book-format.ts",
    "lib/book-copy.ts",
    "lib/useMeasuredWidth.ts",
    "app/globals.css",
    "app/tokens.css",
  ];
  for (const file of touched) {
    const source = readFileSync(path.join(root, file), "utf8");
    expect(source, file).not.toContain("--ink-1");
  }
});
