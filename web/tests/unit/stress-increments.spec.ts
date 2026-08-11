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
  incrementScaleClause,
  incrementStepValues,
  stressIncrements,
  type IncrementStep,
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
  // r98 RE-LAW: the OTHER engine runs the FULL grid — asserted on its steps,
  // not merely on the absence of a stop sentence. The fixture serves aave at
  // all six points, so a truncated or empty lawful-looking prefix is a FAIL.
  const aave = viewOf(waterfall, "aave_v3_etherfi");
  expect(aave.stopped).toBeNull();
  expect(aave.steps).toHaveLength(5);
  expect(aave.steps[0]?.fromTimes).toBe("×1.00");
  expect(aave.steps[4]?.toTimes).toBe("×0.50");
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

// ---------------------------------------------------------------------------
// p1b-6 item 6 — the coercion residue. `BigInt("")` is a silent 0n; every
// wire read below now goes through wireBigInt and a malformed value routes
// to the module's own refusal arm, never to a coerced number.
// ---------------------------------------------------------------------------

test("p1b-6: a malformed factor REFUSES the grid — \"\" is never read as a lawfully-descending 0", () => {
  const waterfall = waterfallClone();
  // DERIVED NEGATIVE: the LAST point's factor emptied. The old bare BigInt
  // coerced "" to 0n, which DESCENDS below every positive factor — the grid
  // weld passed silently and the step label rendered garbage.
  const last = waterfall.points[waterfall.points.length - 1];
  if (last === undefined) throw new Error("fixture invariant");
  last.factor = "";
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("GRID CONTRADICTION");
  expect(reason).toContain("wire Decimal contract");
});

test("p1b-6: a malformed cumulative REFUSES — \"\" is never the zero side of a difference", () => {
  const waterfall = waterfallClone();
  // DERIVED NEGATIVE: one point's cumulative emptied. Coerced to 0n it made
  // the next step's whole cumulative look like an increase (a measured-zero
  // costume) — the committed fixture's flat zeros would have yielded a view.
  const at = waterfall.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (at === undefined) throw new Error("fixture invariant");
  at.cumulative_debt_eligible_usd = "";
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("SERIES CONTRADICTION");
  expect(reason).toContain("wire Decimal contract");
});

test("p1b-6: incrementStepValues refuses a malformed increase — never a zero-length bar", () => {
  const step: IncrementStep = {
    fromTimes: "×1.00",
    toTimes: "×0.90",
    newlyEligible: 0,
    debtIncreaseUsd: "",
    usdDecimals: 6,
  };
  const refused = incrementStepValues([step]);
  expect(refused.kind).toBe("refused");
  if (refused.kind === "refused") {
    expect(refused.reason).toContain("wire Decimal contract");
    expect(refused.reason).toContain("×1.00");
  }
  const ok = incrementStepValues([{ ...step, debtIncreaseUsd: "5" }]);
  expect(ok.kind).toBe("ok");
  if (ok.kind === "ok") {
    expect(ok.max).toBe(5n);
    expect(ok.rows.map((row) => row.value)).toEqual([5n]);
  }
});

test("p1b-6: a malformed scale anchor yields NO clause — never the \"$0, no bar\" claim", () => {
  // The old bare BigInt("") === 0n took the zero arm: a body nobody could
  // read rendered as the positive claim that every increase is $0.
  expect(incrementScaleClause("", 6)).toBeNull();
  expect(incrementScaleClause("0", 6)).toBe(
    "Every increase in this window is $0, so no bar is drawn.",
  );
});

// ---------------------------------------------------------------------------
// p1b-15 (Codex round 7) — THE INDEX CONTRACT JOINS THE GRID WELD. The weld
// ORDERED indexes it never validated: `1 <= -0` is false, so a first-point
// index token `-1e-324` (which parses to NEGATIVE ZERO) read as a strictly
// rising sequence and the view rendered as if the grid were lawful. The
// p1b-14 audit recorded WaterfallPoint `index` as needing no guard — that
// row was INCORRECT and is struck-and-corrected this wave.
// ---------------------------------------------------------------------------

test("p1b-15: a first-point index of -0 REFUSES the grid — never a lawful-looking view", () => {
  const waterfall = waterfallClone();
  const first = waterfall.points[0];
  if (first === undefined) throw new Error("fixture invariant");
  // The defect input: the raw token -1e-324 parses to NEGATIVE ZERO.
  first.index = JSON.parse("-1e-324") as number;
  expect(Object.is(first.index, -0)).toBe(true);
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("GRID CONTRADICTION");
  expect(reason).toContain("wire population contract");
});

// ---------------------------------------------------------------------------
// p1b-16 — THE STOP INDEX JOINS THE GRID WELD. p1b-15 welded the POINT
// indexes but the truncation compare (`b.index >= stopIndex`) still consumed
// the server-named monotonicity index raw: a stop-index token `-1e-324`
// parses to NEGATIVE ZERO, every lawful point index satisfies `>= -0`, and
// the series silently stopped at the first step — an empty step list wearing
// the legitimate stop sentence. Named as a p1b-15 concern; closed here.
// ---------------------------------------------------------------------------

test("p1b-16: a -0 monotonicity stop index REFUSES the grid — the series is never silently truncated", () => {
  const waterfall = waterfallOf(BOOK_MONOTONICITY_VIOLATION);
  // The defect input: the raw token -1e-324 parses to NEGATIVE ZERO.
  waterfall.monotonicity.index = JSON.parse("-1e-324") as number;
  expect(Object.is(waterfall.monotonicity.index, -0)).toBe(true);
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("GRID CONTRADICTION");
  expect(reason).toContain("wire population contract");
  // The stop is ENGINE-SCOPED: the unnamed engine still runs the full grid.
  const aave = viewOf(waterfall, "aave_v3_etherfi");
  expect(aave.stopped).toBeNull();
  expect(aave.steps).toHaveLength(5);
});

// ---------------------------------------------------------------------------
// p1b-17 — THE SCALES ARE CLASSIFIED BEFORE THE WELD COMPARES THEM. The
// SCALE weld read `b.at.usd_decimals !== a.at.usd_decimals` RAW: a MATCHED
// NEGATIVE-ZERO pair (`-0 !== -0` is false) slipped PAST the weld into the
// rendered step and refused only downstream (formatUnits → assertScale, the
// route register instead of this module's own arm), and a MISMATCHED pair's
// SCALE CONTRADICTION prose printed `String(-0)` as "0" — claiming the scale
// "changed" where the truth is that it cannot be read. Named as p1b-16
// residue 1; closed here — the last unclassified read in this module.
// ---------------------------------------------------------------------------

test("p1b-17: a MATCHED -0 scale pair refuses in THIS module — never a step handed to the route register", () => {
  const waterfall = waterfallClone();
  // The defect input: EVERY point's scale is the raw token -1e-324, which
  // parses to NEGATIVE ZERO — the pair MATCHES, so the raw weld passed and
  // the -0 rode `step.usdDecimals` out of the module.
  for (const point of waterfall.points) {
    const at = point.engines.find((e) => e.engine === "debt_manager");
    if (at === undefined) throw new Error("fixture invariant");
    at.usd_decimals = JSON.parse("-1e-324") as number;
    expect(Object.is(at.usd_decimals, -0)).toBe(true);
  }
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("SCALE CONTRADICTION");
  expect(reason).toContain("cannot be read");
});

test("p1b-17: a MISMATCHED pair with a -0 side says CANNOT BE READ — never \"changed\" printing -0 as 0", () => {
  const waterfall = waterfallClone();
  const at = waterfall.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (at === undefined) throw new Error("fixture invariant");
  // One side out of contract: the old arm fired, but its prose printed
  // `String(-0)` as "0" and claimed the scale CHANGED (6 to 0) — a
  // computed-looking claim about a value that cannot be read.
  at.usd_decimals = JSON.parse("-1e-324") as number;
  expect(Object.is(at.usd_decimals, -0)).toBe(true);
  const reason = refusedOf(waterfall, "debt_manager");
  expect(reason).toContain("SCALE CONTRADICTION");
  expect(reason).toContain("cannot be read");
  expect(reason).not.toContain("changed");
});
