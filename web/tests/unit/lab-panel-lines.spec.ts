// The Lab panels' ANSWER / METHOD / FORENSICS copy (Wave W-3L), under the one
// law that makes a takeaway line worth rendering: EVERY WORD IS DERIVED.
//
// Why this file exists (Codex round 47, NOT-SHIP finding 4). The W-3L rollout
// moved a screen's worth of claims out of `title` attributes and into computed
// sentences, and then pinned those sentences with `toContainText` against a
// live page. That is a rendering check, not a derivation check: a helper
// rewritten to `return "3 re-priced this address's served states"` passes every
// one of them. The specs below drive the helpers DIRECTLY and MUTATE their
// inputs, so a hardcoded string fails on the second call.
//
// Laws under test:
//   - the state pair's equality test covers EVERY field a served state carries,
//     one mutation per field, and a pair with a missing side is never called
//     identical;
//   - the boundary group's ANSWER has three outcomes, and a withheld pair is
//     never counted as a re-pricing;
//   - the collateral ANSWER and METHOD keep the two meanings of a null value
//     APART: UNPRICED is unknowable, NOT COUNTED is exact-and-excluded, and the
//     word "unknowable" never attaches to a NOT COUNTED balance;
//   - the projection's ANSWER reads the LONGEST horizon whatever the array
//     order, and states `unknowable` as its own outcome;
//   - the matrix legend's key counts what it enumerates;
//   - every count, every money amount and every engine name in these lines
//     comes from the input.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  refineScenario,
  type components,
  type RefinedProjection,
  type RefinedScenario,
  type RefinedScenarioResult,
  type RefinedStressState,
  type Shortfall,
} from "@solvent/client";
import {
  BOOK_RESULT_METHOD,
  COLLATERAL_DISCLOSURE_METHOD,
  MATRIX_LEGEND_KEY,
  MATRIX_METHOD,
  appliedShocksDetailsSummary,
  appliedShocksSummary,
  bookResultAnswer,
  boundaryForensicsSummary,
  boundaryGroupAnswer,
  boundaryMemberTally,
  collateralGroupAnswer,
  compareStatePair,
  engineResultAnswer,
  engineResultForensicsSummary,
  engineResultMethod,
  projectionAnswer,
  projectionMethod,
  realizationAnswer,
  realizationMethod,
  runbookHistogramForensicsSummary,
  runbookHistogramMethod,
  shockFlagTally,
  statesBitIdentical,
  type RunBookEngineFacts,
} from "../../app/lab/labPanelLines";
import { MINUS_SIGN } from "../../lib/book-format";
import { RUN_BOOK_WEETH_BATCH_1 } from "../fixtures/lab-book";

type Schemas = components["schemas"];

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// Fixture-sourced inputs. Nothing below is hand-shaped wire data: every seed is
// a committed fixture, and the mutations are derived negatives off it.
// ---------------------------------------------------------------------------

const STRESS_DM = JSON.parse(fixture("stress-dm.json")) as {
  address: string;
  scenarios: Schemas["Scenario"][];
};
const STRESS_AAVE = JSON.parse(fixture("stress-aave.json")) as {
  scenarios: Schemas["Scenario"][];
};
const COLLISION = JSON.parse(
  fixture("run-book.collateral-collision.json"),
) as Schemas["RunBookResponse"];

function dmScenario(id: string): RefinedScenario {
  const found = STRESS_DM.scenarios.find((scenario) => scenario.id === id);
  if (found === undefined) throw new Error(`stress-dm.json carries no ${id}`);
  return refineScenario(found);
}

function aaveScenario(id: string): RefinedScenario {
  const found = STRESS_AAVE.scenarios.find((scenario) => scenario.id === id);
  if (found === undefined) throw new Error(`stress-aave.json carries no ${id}`);
  return refineScenario(found);
}

/** The fixture's own served BEFORE state, refined exactly as the page refines it. */
const DM_STATE: RefinedStressState = (() => {
  const before = dmScenario("stable_depeg_0995_in_band").results[0]?.before;
  if (before === undefined || before === null) {
    throw new Error("stress-dm.json serves no before state for the boundary member");
  }
  return before;
})();

/** The fixture's PROJECTION, refined. */
const DM_PROJECTION: RefinedProjection = (() => {
  const projection = dmScenario("dm_rate_horizon_plus_200bps").results[0]?.projection;
  if (projection === undefined || projection === null) {
    throw new Error("stress-dm.json serves no projection");
  }
  return projection;
})();

/**
 * The flagship's SHORTFALL, verbatim from the committed run book. The Debt
 * Manager's arm is the one carrying nonzero amounts, so the derivation is
 * visible rather than hidden behind two zeroes.
 */
const REALIZATION: Shortfall = (() => {
  const engine = RUN_BOOK_WEETH_BATCH_1.engines.find(
    (candidate) => candidate.engine === "debt_manager",
  );
  const realization = engine?.market_realization;
  if (realization === undefined || realization === null) {
    throw new Error("the flagship run book serves no market realization");
  }
  return realization;
})();

/** One engine's three ANSWER facts, from the committed run book. */
const ENGINE_FACTS: RunBookEngineFacts = (() => {
  const engine = RUN_BOOK_WEETH_BATCH_1.engines[0];
  if (engine === undefined) throw new Error("the flagship run book serves no engine");
  return {
    engine: engine.engine,
    usd_decimals: engine.usd_decimals,
    newly_eligible_accounts: engine.newly_eligible_accounts,
    eligible_debt_delta_usd: engine.eligible_debt_delta_usd,
    bad_debt_delta_usd: engine.bad_debt_delta_usd,
  };
})();

/** A scenario whose one result carries the state pair given. */
function scenarioWithStates(
  seed: RefinedScenario,
  before: RefinedStressState | null,
  after: RefinedStressState | null,
  overrides: Partial<RefinedScenarioResult> = {},
): RefinedScenario {
  const result = seed.results[0];
  if (result === undefined) throw new Error("seed scenario serves no result");
  return { ...seed, results: [{ ...result, before, after, ...overrides }] };
}

// ===========================================================================
// FIX 1 — the state pair's own equality test.
// ===========================================================================

test("statesBitIdentical: EVERY served field is compared, one mutation at a time", () => {
  expect(statesBitIdentical(DM_STATE, { ...DM_STATE })).toBe(true);

  // One derived negative per field. `max_borrow_lt` and `infinite` are the two
  // the round-47 finding named: the boundary tally compared neither and the
  // detail view compared only `infinite`, so a pair moving on `max_borrow_lt`
  // alone rendered the bit-identical banner over a table showing it move.
  const mutations: { field: string; after: RefinedStressState }[] = [
    { field: "health_factor_wad", after: { ...DM_STATE, health_factor_wad: "1" } },
    { field: "health_factor_num", after: { ...DM_STATE, health_factor_num: "1" } },
    { field: "health_factor_den", after: { ...DM_STATE, health_factor_den: "1" } },
    { field: "infinite", after: { ...DM_STATE, infinite: !DM_STATE.infinite } },
    { field: "eligible", after: { ...DM_STATE, eligible: !DM_STATE.eligible } },
    { field: "collateral_usd", after: { ...DM_STATE, collateral_usd: "1" } },
    { field: "debt_usd", after: { ...DM_STATE, debt_usd: "1" } },
    { field: "max_borrow_lt", after: { ...DM_STATE, max_borrow_lt: "1" } },
    {
      field: "liquidation_verdict",
      after: {
        ...DM_STATE,
        liquidation_verdict:
          DM_STATE.liquidation_verdict === "unknowable" ? "liquidatable" : "unknowable",
      },
    },
  ];
  for (const mutation of mutations) {
    expect(
      statesBitIdentical(DM_STATE, mutation.after),
      `${mutation.field} must break bit-identity`,
    ).toBe(false);
    expect(compareStatePair(DM_STATE, mutation.after)).toBe("moved");
  }
  // Every field of the served state is exercised above.
  expect(mutations.length).toBe(Object.keys(DM_STATE).length);
});

test("compareStatePair: a missing side is WITHHELD, never identical and never moved", () => {
  expect(compareStatePair(null, DM_STATE)).toBe("withheld");
  expect(compareStatePair(DM_STATE, null)).toBe("withheld");
  expect(compareStatePair(null, null)).toBe("withheld");
  expect(statesBitIdentical(null, null)).toBe(false);
  expect(statesBitIdentical(DM_STATE, null)).toBe(false);
});

test("boundaryGroupAnswer: identical, moved, withheld and not-applicable are FOUR different counts", () => {
  const seed = dmScenario("stable_depeg_0995_in_band");

  // The fixture as served: one member, both states bit-identical.
  const identical = boundaryGroupAnswer([seed]);
  expect(identical).toContain("1 committed member");
  expect(identical).toContain("0 re-priced");
  expect(identical).not.toContain("served no state pair");
  expect(identical).not.toContain("served no applicable result");

  // MOVED, on the field the old tally never compared. This is the round-47
  // finding in one assertion: before the fix this input produced "0 re-priced".
  const before = seed.results[0]?.before;
  if (before === undefined || before === null) throw new Error("no before state");
  const moved = boundaryGroupAnswer([
    scenarioWithStates(seed, before, { ...before, max_borrow_lt: "999" }),
  ]);
  expect(moved).toContain("1 re-priced");

  // WITHHELD: applicable, but no pair to compare. It is its own clause and is
  // NOT in the re-priced count.
  const withheld = boundaryGroupAnswer([scenarioWithStates(seed, null, null)]);
  expect(withheld).toContain("0 re-priced");
  expect(withheld).toContain("1 served no state pair to compare");
  expect(withheld).toContain("withheld measurement and not a re-pricing");

  // NOT APPLICABLE keeps its own clause and does not become a withheld pair.
  const notApplicable = boundaryGroupAnswer([
    scenarioWithStates(seed, null, null, { applicable: false }),
  ]);
  expect(notApplicable).toContain("1 served no applicable result");
  expect(notApplicable).not.toContain("served no state pair");
  expect(notApplicable).toContain("0 re-priced");
});

test("boundaryGroupAnswer: the member count and the snap totals are read off the input", () => {
  const boundary = dmScenario("stable_depeg_0995_in_band");
  expect(boundaryGroupAnswer([])).toContain("0 committed members");
  expect(boundaryGroupAnswer([boundary, boundary])).toContain("2 committed members");

  // The snap flags live on a result that actually applies a shock, so the
  // totals are seeded from the aave fixture's served `applied_shocks` entry.
  const seed = aaveScenario("eth_minus_30");
  const result = seed.results[0];
  if (result === undefined) throw new Error("no result");
  const shock = result.applied_shocks[0];
  if (shock === undefined) throw new Error("the boundary member applies no shock");
  const snapped: RefinedScenario = {
    ...seed,
    results: [
      {
        ...result,
        applied_shocks: [
          { ...shock, snapped: true, base_snapped: false },
          { ...shock, snapped: false, base_snapped: true },
        ],
      },
    ],
  };
  const line = boundaryGroupAnswer([snapped]);
  expect(line).toContain("1 shocks snapped to a cap and 1 snapped at the base");
  expect(boundaryMemberTally(snapped.results[0] as RefinedScenarioResult).applied).toBe(2);
});

test("boundaryMemberTally: `identical` needs applicability AND a served pair", () => {
  const seed = dmScenario("stable_depeg_0995_in_band");
  const served = seed.results[0];
  if (served === undefined) throw new Error("no result");
  expect(boundaryMemberTally(served).identical).toBe(true);
  expect(boundaryMemberTally({ ...served, applicable: false }).identical).toBe(false);
  expect(boundaryMemberTally({ ...served, before: null }).identical).toBe(false);
  expect(boundaryMemberTally({ ...served, before: null }).comparison).toBe("withheld");

  // The aave fixture's genuinely MOVED pair, unmutated.
  const moved = aaveScenario("eth_minus_30").results[0];
  if (moved === undefined) throw new Error("no aave result");
  expect(boundaryMemberTally(moved).comparison).toBe("moved");
  expect(boundaryMemberTally(moved).identical).toBe(false);
});

test("boundaryForensicsSummary counts the members it holds", () => {
  expect(boundaryForensicsSummary(1)).toContain("for 1 members");
  expect(boundaryForensicsSummary(4)).toContain("for 4 members");
});

// ===========================================================================
// FIX 2 — the two meanings of a null collateral value.
// ===========================================================================

type CollateralEntry = { value_usd: string | null; unpriced: boolean };

function sides(before: CollateralEntry[], after: CollateralEntry[]) {
  return {
    before: { collateral_by_asset: before },
    after: { collateral_by_asset: after },
  };
}

const COUNTED: CollateralEntry = { value_usd: "800000000000", unpriced: false };
const UNPRICED: CollateralEntry = { value_usd: null, unpriced: true };
const NOT_COUNTED: CollateralEntry = { value_usd: null, unpriced: false };

test("collateralGroupAnswer: every holding counted makes the positive claim and no absence clause", () => {
  const line = collateralGroupAnswer(sides([COUNTED], [COUNTED]));
  expect(line).toContain("Every holding on both sides carries a counted value");
  expect(line).not.toContain("UNPRICED");
  expect(line).not.toContain("NOT COUNTED");
});

test("collateralGroupAnswer: UNPRICED is the unknowable one, and says so", () => {
  const line = collateralGroupAnswer(sides([COUNTED, UNPRICED], [COUNTED]));
  expect(line).toContain("1 holding is listed with no value");
  expect(line).toContain("1 is UNPRICED");
  expect(line).toContain("no price witness");
  expect(line).toContain("unknowable rather than zero");
  // The other meaning is absent, because the input carries none of it.
  expect(line).not.toContain("NOT COUNTED");
});

test("collateralGroupAnswer: NOT COUNTED is EXACT AND EXCLUDED, and is never called unknowable", () => {
  const line = collateralGroupAnswer(sides([COUNTED, NOT_COUNTED], [COUNTED]));
  expect(line).toContain("1 is NOT COUNTED");
  expect(line).toContain("the balance is exact and known");
  expect(line).toContain("assigns it no counted USD value");
  // THE ROUND-47 DEFECT, pinned: this sentence used to describe every
  // null-valued holding as "unknowable rather than zero", which is a claim
  // about missing data. A NOT COUNTED balance is not missing; it is excluded.
  expect(line).not.toContain("unknowable");
  expect(line).not.toContain("no price witness");
});

test("collateralGroupAnswer: both kinds together stay separately counted", () => {
  const line = collateralGroupAnswer(
    sides([COUNTED, UNPRICED, NOT_COUNTED], [UNPRICED, NOT_COUNTED, NOT_COUNTED]),
  );
  expect(line).toContain("5 holdings are listed with no value across the two sides");
  expect(line).toContain("2 are UNPRICED");
  expect(line).toContain("3 are NOT COUNTED");
  expect(line).toContain("Neither kind sits inside a total on this panel");
});

test("collateralGroupAnswer: the committed collision fixture drives both counts", () => {
  // The live book itemizes weETH twice for one Aave aggregate (COUNTED and NOT
  // COUNTED) beside an UNPRICED holding. That is the shape this copy exists for.
  const aave = COLLISION.engines.find((engine) => engine.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("the collision fixture serves no aave engine");
  const unpriced = [aave.before, aave.after]
    .flatMap((side) => side.collateral_by_asset)
    .filter((entry) => entry.value_usd === null && entry.unpriced).length;
  const notCounted = [aave.before, aave.after]
    .flatMap((side) => side.collateral_by_asset)
    .filter((entry) => entry.value_usd === null && !entry.unpriced).length;
  expect(unpriced).toBeGreaterThan(0);
  expect(notCounted).toBeGreaterThan(0);

  const line = collateralGroupAnswer(aave);
  expect(line).toContain(`${String(unpriced + notCounted)} holdings are listed with no value`);
  expect(line).toContain(`${String(unpriced)} are UNPRICED`);
  expect(line).toContain(`${String(notCounted)} are NOT COUNTED`);

  // The debt_manager side of the same body carries only counted holdings, so
  // it takes the positive arm. Same helper, same body, two arms.
  const dm = COLLISION.engines.find((engine) => engine.engine === "debt_manager");
  if (dm === undefined) throw new Error("the collision fixture serves no debt_manager engine");
  expect(collateralGroupAnswer(dm)).toContain("Every holding on both sides carries a counted value");
});

test("COLLATERAL_DISCLOSURE_METHOD names three disclosures and promises no hidden figure", () => {
  expect(COLLATERAL_DISCLOSURE_METHOD).toContain("COUNTED");
  expect(COLLATERAL_DISCLOSURE_METHOD).toContain("UNPRICED");
  expect(COLLATERAL_DISCLOSURE_METHOD).toContain("NOT COUNTED");
  expect(COLLATERAL_DISCLOSURE_METHOD).toContain("the balance is exact and known");
  // It used to say a value EXISTS for a NOT COUNTED row, which the wire never
  // serves and this panel therefore cannot show.
  expect(COLLATERAL_DISCLOSURE_METHOD).not.toContain("a value exists");
  expect(COLLATERAL_DISCLOSURE_METHOD).toContain("only COUNTED is inside the total");
});

// ===========================================================================
// FIX 3 — the legend's key counts what it enumerates.
// ===========================================================================

test("MATRIX_LEGEND_KEY: the number word matches the states listed, and calls them exceptional", () => {
  const match = /^(\w+) exceptional cell states: (.+)\.$/.exec(MATRIX_LEGEND_KEY);
  expect(match, "the key must read '<count> exceptional cell states: …'").not.toBeNull();
  const [, countWord, body] = match as RegExpExecArray;
  const listed = (body ?? "").split(" · ").filter((word) => word.trim().length > 0);
  const words: Record<string, number> = {
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
  };
  expect(words[countWord ?? ""]).toBe(listed.length);
  // The grid has nine states in all; this key enumerates the exceptional ones,
  // so it may not call itself the whole vocabulary.
  expect(MATRIX_LEGEND_KEY).not.toContain("Six cell states");
  for (const state of [
    "NOT COVERED",
    "WITHHELD",
    "SUPERSEDED",
    "UNANSWERED",
    "CONTRADICTORY BOOK",
    "DEFINITION CHANGED",
  ]) {
    expect(listed).toContain(state);
  }
});

test("MATRIX_METHOD states the delta-only basis once and refuses a total column", () => {
  expect(MATRIX_METHOD).toContain("DELTA-ONLY");
  expect(MATRIX_METHOD).toContain("no total column");
  expect(MATRIX_METHOD).toContain("never summed");
});

// ===========================================================================
// The remaining ANSWER / METHOD helpers, each mutated.
// ===========================================================================

test("realizationAnswer and realizationMethod are read off the served shortfall", () => {
  const base = realizationAnswer(REALIZATION);
  expect(base).toContain("delta-only");
  expect(base).toContain("measured against this scenario's own before state");
  const moved = realizationAnswer({
    ...REALIZATION,
    execution_shortfall_usd: "1234000000",
  });
  expect(moved).not.toBe(base);
  expect(moved).toContain("$1,234");

  // Decimals are the wire's, not this file's: the SAME integer at a different
  // scale is a different sentence.
  const shifted = realizationAnswer({
    ...REALIZATION,
    execution_shortfall_usd: "1234000000",
    usd_decimals: 2,
  });
  expect(shifted).not.toBe(moved);
  expect(shifted).toContain("$12,340,000");

  const method = realizationMethod(REALIZATION, "GLOSS-TOKEN");
  expect(method).toContain(REALIZATION.seizure_model);
  expect(method).toContain(String(REALIZATION.usd_decimals));
  // The gloss is PROMOTED verbatim: it is what stops "realized ≤ eligible"
  // reading as missing data, so it may not be paraphrased.
  expect(method).toContain("GLOSS-TOKEN");
});

test("projectionAnswer reads the LONGEST horizon whatever the array order", () => {
  const longest = DM_PROJECTION.horizons.reduce((best, horizon) =>
    horizon.horizon_seconds > best.horizon_seconds ? horizon : best,
  );
  expect(DM_PROJECTION.horizons.length).toBeGreaterThan(1);
  const days = longest.horizon_seconds / 86_400;

  const forward = projectionAnswer(DM_PROJECTION);
  const reversed = projectionAnswer({
    ...DM_PROJECTION,
    horizons: [...DM_PROJECTION.horizons].reverse(),
  });
  expect(forward).toBe(reversed);
  expect(forward).toContain(`Over ${String(days)} days, the longest horizon served`);
  expect(forward).toContain("becomes liquidatable");
});

test("projectionAnswer: unknowable is its own outcome and never a no", () => {
  const horizons = DM_PROJECTION.horizons.map((horizon) => ({
    ...horizon,
    liquidation_verdict: "unknowable" as const,
  }));
  const line = projectionAnswer({ ...DM_PROJECTION, horizons });
  expect(line).toContain("unknowable");
  expect(line).toContain("not the same statement as no");
  expect(line).not.toContain("does not become liquidatable");

  const negative = projectionAnswer({
    ...DM_PROJECTION,
    horizons: DM_PROJECTION.horizons.map((horizon) => ({
      ...horizon,
      liquidation_verdict: "not-liquidatable" as const,
    })),
  });
  expect(negative).toContain("does not become liquidatable");

  // A projection that served no horizon makes NO claim about time at all.
  const empty = projectionAnswer({ ...DM_PROJECTION, horizons: [] });
  expect(empty).toContain("served no horizon");
  expect(empty).not.toContain("liquidatable.");
});

test("projectionMethod carries the basis, the signed bps and the held-input disclosure", () => {
  const held = projectionMethod(DM_PROJECTION);
  expect(held).toContain(`annual Δ +${String(DM_PROJECTION.annual_delta_bps)} bps`);
  expect(held).toContain("Prices are held flat across every horizon");

  const notHeld = projectionMethod({ ...DM_PROJECTION, prices_held_flat: false });
  expect(notHeld).toContain("Prices are not held flat on this axis");
  expect(notHeld).not.toContain("held flat across every horizon");

  const negative = projectionMethod({ ...DM_PROJECTION, annual_delta_bps: -50 });
  expect(negative).toContain("annual Δ -50 bps");
});

test("engineResultAnswer: signed counts, signed money, this engine's own unit", () => {
  const base = engineResultAnswer(ENGINE_FACTS);
  expect(base).toContain(ENGINE_FACTS.engine);
  expect(base).toContain("delta-only");

  const up = engineResultAnswer({ ...ENGINE_FACTS, newly_eligible_accounts: 3 });
  const down = engineResultAnswer({ ...ENGINE_FACTS, newly_eligible_accounts: -3 });
  expect(up).toContain("+3");
  expect(down).toContain(`${MINUS_SIGN}3`);
  expect(down).not.toContain("+3");

  const renamed = engineResultAnswer({ ...ENGINE_FACTS, engine: "debt_manager" });
  expect(renamed).toContain("debt_manager");
  expect(renamed).not.toBe(base);
});

test("engineResultMethod states the decimals, the never-summed law and the caption verbatim", () => {
  const method = engineResultMethod(ENGINE_FACTS, "AT-RISK-CAPTION");
  expect(method).toContain(String(ENGINE_FACTS.usd_decimals));
  expect(method).toContain("never");
  expect(method).toContain("summed across engines");
  expect(method).toContain("AT-RISK-CAPTION");
  expect(engineResultMethod({ ...ENGINE_FACTS, usd_decimals: 2 }, "x")).toContain("2 decimals");
});

test("bookResultAnswer: no engine makes no claim; two engines are never summed", () => {
  expect(bookResultAnswer([])).toContain("served no engine result");

  const other: RunBookEngineFacts = {
    ...ENGINE_FACTS,
    engine: "debt_manager",
    usd_decimals: 6,
    newly_eligible_accounts: 2,
  };
  const both = bookResultAnswer([ENGINE_FACTS, other]);
  expect(both).toContain(ENGINE_FACTS.engine);
  expect(both).toContain("debt_manager");
  expect(both).toContain("engine books are never summed");
  expect(both).toContain("+2 on debt_manager");
  expect(bookResultAnswer([ENGINE_FACTS])).not.toContain("debt_manager");
  expect(BOOK_RESULT_METHOD).toContain("never added together");
});

test("engineResultForensicsSummary and runbookHistogramForensicsSummary count their rows", () => {
  expect(engineResultForensicsSummary(7)).toContain("7-row");
  expect(engineResultForensicsSummary(2)).toContain("2-row");
  expect(runbookHistogramForensicsSummary(9)).toContain("9 bucket boundaries");
});

test("runbookHistogramMethod: the tint clause follows the engine's own comparator", () => {
  const wad = runbookHistogramMethod("hf_wad", "BASE.");
  expect(wad).toContain("BASE.");
  expect(wad).toContain("SAME 0 to 100 percent axis");
  expect(wad).toContain("Buckets below 1.00 are tinted");

  const strict = runbookHistogramMethod("hf_num/hf_den", "BASE.");
  expect(strict).toContain("No bucket is tinted");
  expect(strict).toContain("strict boolean");
});

test("appliedShocksSummary: the three modelling disclosures are counted, never described", () => {
  const shocks = [
    { snapped: true, base_snapped: false, cap_bound: true },
    { snapped: false, base_snapped: true, cap_bound: false },
    { snapped: false, base_snapped: false, cap_bound: false },
  ];
  const tally = shockFlagTally(shocks);
  expect(tally).toEqual({ applied: 3, snapped: 1, baseSnapped: 1, capBound: 1 });

  const line = appliedShocksSummary(tally);
  expect(line).toContain("3 shocks applied");
  expect(line).toContain("1 snapped to a cap");
  expect(line).toContain("1 snapped at the base");
  expect(line).toContain("1 cap-bound");
  expect(line).toContain("A snapped shock is not the shock the scenario asked for");

  expect(appliedShocksSummary(shockFlagTally([shocks[0] as (typeof shocks)[number]]))).toContain(
    "1 shock applied",
  );
  expect(appliedShocksDetailsSummary(3)).toContain("applied shocks: 3 named");
});
