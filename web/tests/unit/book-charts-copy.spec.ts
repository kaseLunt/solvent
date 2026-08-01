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

import { expect, test } from "@playwright/test";
import type { EngineHistogram, Waterfall } from "@solvent/client";
import {
  buildWaterfallSteps,
  factorTimesLabel,
  gridPercentLabel,
} from "../../app/book/waterfallView";
import {
  belowOneCount,
  histogramReadingLine,
  liquidatableCardSub,
} from "../../app/book/readingLines";
import {
  AT_RISK_READER_CAPTION,
  BAD_DEBT_LEGEND,
  ELIGIBLE_REALIZED_GLOSS,
  HELD_FLAT_VALUE_HEADER,
  heldFlatDetailsSummary,
  heldFlatSummary,
  WATERFALL_SECTION_NOTE,
  wireNotesSummary,
} from "../../lib/book-copy";
import { BOOK } from "../fixtures/book";

const WAD = 10n ** 18n;

function fixtureWaterfall(): Waterfall {
  if (BOOK.waterfall === null) throw new Error("fixture book.json must carry a waterfall");
  return BOOK.waterfall;
}

test.describe("waterfall step grammar (§18)", () => {
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

  test("DM steps from the fixture: unshocked census, percent flows, insolvent residuals", () => {
    const steps = buildWaterfallSteps(fixtureWaterfall(), "debt_manager");
    // Point 0: the standing census + its residual annotation.
    expect(steps[0]).toMatchObject({
      label: "unshocked",
      sub: "×1.00 · 1 acct",
      display: "$4,200",
      kind: "flow",
    });
    expect(steps[1]).toMatchObject({
      label: "unshocked bad debt",
      sub: "1 insolvent",
      display: "$239.603961", // the exact micro-string, never rounded
      kind: "residual",
    });
    // Point 1: the −10% projection.
    expect(steps[2]).toMatchObject({
      label: "−10%",
      sub: "×0.90 · 1 acct",
      display: "$4,200",
      kind: "flow",
    });
    expect(steps[3]).toMatchObject({
      label: "−10% bad debt",
      sub: "1 insolvent",
      display: "$635.643565",
      kind: "residual",
    });
  });

  test("aave steps: a zero-Σ census wears the literal all-dust proof; a true zero residual draws no step", () => {
    const steps = buildWaterfallSteps(fixtureWaterfall(), "aave_v3_etherfi");
    // Σ eligible at ×1.00 is "0" — provably < $10 by the ruling's literal
    // arithmetic, so the sub carries the suffix (pinned; vacuous case flagged
    // to design in the wave report).
    expect(steps[0]).toMatchObject({
      label: "unshocked",
      sub: "×1.00 · 0 acct · all dust",
      display: "$0",
      kind: "flow",
    });
    // −10%: real money, no dust suffix.
    expect(steps[1]).toMatchObject({
      label: "−10%",
      sub: "×0.90 · 1 acct",
      display: "$6,000",
      kind: "flow",
    });
    // Bad debt is "0" through −20%: NO residual steps exist for those points.
    expect(steps.filter((step) => step.kind === "residual")[0]).toMatchObject({
      label: "−30% bad debt",
      sub: "1 insolvent",
      display: "$666.66666667",
    });
  });

  test("dust never hides a step: a provably-dust residual renders in full with the suffix", () => {
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
      label: "unshocked",
      sub: "×1.00 · 2 acct · all dust",
      display: "$9.999999", // exact, never rounded
    });
    expect(steps[1]).toMatchObject({
      label: "unshocked bad debt",
      sub: "2 insolvent · all dust",
      display: "$0.000005", // the exact micro-string still prints
    });
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
    expect(histogramReadingLine(aaveHist, aaveAgg, aaveBadDebt, WAD)).toBe(
      "What this shows: how many accounts sit at each health factor. 0 of 1 are below 1.00, " +
        "where the engine may liquidate — Σ eligible debt $0 · all dust.",
    );
  });

  test("the DM line: a disclosure, with the engine's own verdict count", () => {
    expect(histogramReadingLine(dmHist, dmAgg, dmBadDebt, WAD)).toBe(
      "What this shows: how many accounts sit at each borrow-headroom ratio — a disclosure, " +
        "not the engine's trigger. The engine's own verdict counts 1 of 1 liquidatable — " +
        "Σ eligible debt $4,200.",
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

  test("a withheld Σ renders the em dash — never the adjective without the Σ, never 0", () => {
    expect(liquidatableCardSub(undefined)).toBe(
      "of computed positions, engine's own comparator · Σ eligible debt —",
    );
    if (dmBadDebt === undefined) throw new Error("fixture shape drifted");
    const withheld = structuredClone(dmBadDebt);
    withheld.eligible_debt_usd = null;
    expect(liquidatableCardSub(withheld)).toBe(
      "of computed positions, engine's own comparator · Σ eligible debt —",
    );
  });

  test("the Liquidatable card sub carries the Σ", () => {
    expect(liquidatableCardSub(dmBadDebt)).toBe(
      "of computed positions, engine's own comparator · Σ eligible debt $4,200",
    );
  });
});

test.describe("the ruling's copy, pinned verbatim", () => {
  test("waterfall section note", () => {
    expect(WATERFALL_SECTION_NOTE).toBe(
      "If the shocked asset fell step by step, how much debt could the engine liquidate — and " +
        "how much would it lose? Bars: cumulative eligible debt at each price. ×1.00 is the " +
        "standing census; every lower point is a projection.",
    );
  });

  test("bad-debt legend line", () => {
    expect(BAD_DEBT_LEGEND).toBe(
      "bad debt = debt still owed after all collateral is seized — the protocol's loss at that price.",
    );
  });

  test("eligible-vs-realized gloss", () => {
    expect(ELIGIBLE_REALIZED_GLOSS).toBe(
      '"Eligible" = debt the engine is entitled to liquidate at that price. What actually ' +
        "closes can be less — the Debt Manager liquidates in two passes: half the debt, then " +
        "the remainder.",
    );
  });

  test("held-flat copy builders", () => {
    expect(heldFlatSummary(3)).toBe(
      "3 price inputs held flat — the scenario did not move these prices; positions priced by " +
        "them are stressed at stale marks. A blind spot, not a zero.",
    );
    expect(heldFlatDetailsSummary(3)).toBe("held flat — 3 inputs named");
    expect(HELD_FLAT_VALUE_HEADER).toBe("held value (source's raw units — unscaled by design)");
  });

  test("collateral-at-risk reader caption and wire-notes summary", () => {
    expect(AT_RISK_READER_CAPTION).toBe(
      "collateral at risk is re-measured at each price step — it can fall as prices fall, " +
        "because the same collateral is worth less. A dip is honest arithmetic, not missing data.",
    );
    expect(wireNotesSummary(2)).toBe("wire notes — 2, verbatim");
  });
});
