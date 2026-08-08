// VIEW 3 (incremental stress) — the pure view-model's laws, pinned against
// the committed book fixtures plus DERIVED NEGATIVES documented at their
// sites.
//
// The laws under test (views spec view 3 + critic Finding 9):
//   - only the ACCOUNT series is entry-exact, and its latch identity
//     (cum[b] == cum[a] + newly[b]) is welded before any step is drawn;
//   - the debt figure is an INCREASE between two named factors — a wire
//     whose cumulative decreases while the server asserts monotonicity is a
//     contradiction, refused, never a negative bar;
//   - the series STOPS before a server-named monotonicity violation, and
//     only for the engine the server named;
//   - a disordered grid refuses — "between ×a and ×b" has no meaning there;
//   - forbidden series (bad debt / collateral / insolvency) are never
//     differenced: the model exposes no such field;
//   - absent and single-point gates make no claim.

import { expect, test } from "@playwright/test";
import type { Waterfall } from "@solvent/client";
import {
  STRESS_INC_METHOD,
  incrementAccountsClause,
  stressIncrements,
} from "../../app/book/stressIncrements";
import { BOOK, BOOK_MONOTONICITY_VIOLATION } from "../fixtures/book";

function waterfallOf(source: { waterfall: Waterfall | null }): Waterfall {
  if (source.waterfall === null) throw new Error("fixture invariant: waterfall expected");
  return structuredClone(source.waterfall);
}

function waterfallClone(): Waterfall {
  return waterfallOf(BOOK);
}

function viewOf(waterfall: Waterfall, engine: string) {
  const model = stressIncrements(waterfall, engine);
  if (model.kind !== "view") throw new Error(`expected a view, got ${model.kind}`);
  return model;
}

function refusedOf(waterfall: Waterfall, engine: string): string {
  const model = stressIncrements(waterfall, engine);
  if (model.kind !== "refused") throw new Error(`expected refused, got ${model.kind}`);
  return model.reason;
}

test("the committed fixture's DM series: five steps, all-zero increments stay COMPUTED ZEROS", () => {
  const model = viewOf(waterfallClone(), "debt_manager");
  expect(model.steps).toHaveLength(5);
  expect(model.stopped).toBeNull();
  const first = model.steps[0];
  if (first === undefined) throw new Error("model invariant: a first step");
  // The step names ITS OWN served factors — never an assumed spacing.
  expect(first.fromTimes).toBe("×1.00");
  expect(first.toTimes).toBe("×0.90");
  // A flat book yields exact zeros — a computed zero, not an unknowable.
  expect(first.debtIncreaseUsd).toBe("0");
  expect(first.newlyEligible).toBe(0);
  expect(incrementAccountsClause(first)).toBe("no account first crossed at this step");
});

test("a REAL increment is the exact bigint difference, and the entry count is the SERVED latch", () => {
  const waterfall = waterfallClone();
  const target = waterfall.points[2]?.engines.find((e) => e.engine === "debt_manager");
  if (target === undefined) throw new Error("fixture invariant");
  // DERIVED CASE: two accounts enter at ×0.80 and the latched set re-measures
  // up — the live book's own shape (46 → 48 accounts, dust → $5,757).
  target.newly_eligible_accounts = 2;
  target.cumulative_eligible_accounts = 3;
  target.cumulative_debt_eligible_usd = "5757234070";
  // Deeper points keep the latch identity by carrying the new cumulative.
  for (const point of waterfall.points.slice(3)) {
    const at = point.engines.find((e) => e.engine === "debt_manager");
    if (at !== undefined) {
      at.cumulative_eligible_accounts = 3;
      at.cumulative_debt_eligible_usd = "5757234070";
    }
  }
  const model = viewOf(waterfall, "debt_manager");
  const step = model.steps[1];
  if (step === undefined) throw new Error("model invariant");
  expect(step.debtIncreaseUsd).toBe((5757234070n - 4200000000n).toString());
  expect(step.newlyEligible).toBe(2);
  expect(incrementAccountsClause(step)).toBe("2 accounts first crossed at this step");
});

test("the LATCH WELD: a cumulative series the entry counts cannot reproduce is refused", () => {
  const waterfall = waterfallClone();
  const target = waterfall.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (target === undefined) throw new Error("fixture invariant");
  // DERIVED NEGATIVE: the cumulative jumps without a served entry.
  target.cumulative_eligible_accounts = 5;
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("LATCH CONTRADICTION");
  expect(reason).toContain("the latch identity fails");
});

test("a DECREASING cumulative under asserted monotonicity is refused — never a negative bar", () => {
  const waterfall = waterfallClone();
  const target = waterfall.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (target === undefined) throw new Error("fixture invariant");
  target.cumulative_debt_eligible_usd = "4100000000"; // fell, but monotonicity.ok stays true
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("SERIES CONTRADICTION");
  expect(reason).toContain("DECREASED");
});

test("the series STOPS before a server-named violation — and only for the named engine", () => {
  const waterfall = waterfallOf(BOOK_MONOTONICITY_VIOLATION);
  // The fixture names debt_manager at index 2: only the ×1.00→×0.90 step
  // survives, and the stop is stated in words.
  const dm = viewOf(waterfall, "debt_manager");
  expect(dm.steps).toHaveLength(1);
  expect(dm.stopped).not.toBeNull();
  expect(dm.stopped).toContain("monotonicity violation");
  expect(dm.stopped).toContain("stops before that point");
  // The OTHER engine's series is not the named one and runs the full grid.
  const aave = stressIncrements(waterfall, "aave_v3_etherfi");
  if (aave.kind === "view") {
    expect(aave.stopped).toBeNull();
  } else {
    // The fixture may not serve aave on every point; absence is lawful.
    expect(aave.kind === "absent" || aave.kind === "single").toBe(true);
  }
});

test("a DISORDERED grid refuses — between-step readings need a descending grid", () => {
  const waterfall = waterfallClone();
  const point = waterfall.points[1];
  if (point === undefined) throw new Error("fixture invariant");
  point.factor = "1100000000000000000"; // rises above ×1.00
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("GRID CONTRADICTION");
});

test("the gates: an engine on no point is ABSENT; one point yields no differences", () => {
  const waterfall = waterfallClone();
  expect(stressIncrements(waterfall, "no_such_engine").kind).toBe("absent");
  waterfall.points = waterfall.points.slice(0, 1);
  expect(stressIncrements(waterfall, "debt_manager").kind).toBe("single");
});

test("the method keeps the two claims apart and names the forbidden series", () => {
  expect(STRESS_INC_METHOD).toContain("INCREASE in eligible debt");
  expect(STRESS_INC_METHOD).toContain("never called the debt that became eligible");
  expect(STRESS_INC_METHOD).toContain("never differenced");
  expect(STRESS_INC_METHOD).toContain("nothing here assumes even spacing");
});
