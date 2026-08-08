// VIEW 7 (scenario bad-debt rate) — the pure view-model's laws, pinned
// against the committed eth_minus_30 fixture plus DERIVED NEGATIVES.
//
// The laws under test (views spec view 7 + critic Findings 3/4):
//   - the rate is exact bigint tenths, truncated — never a float division;
//   - zero eligible → UNDEFINED (never 0%, never 100%); nonzero bad debt
//     over zero eligible → a surfaced CONTRADICTION, not a division;
//   - a sub-tenth rate over real bad debt prints "<0.1%", never "0.0%";
//   - the absolutes always ride the rate, and dust suppresses visual weight
//     only — the number stands;
//   - the baseline is the envelope's OWN before side (critic F3) — this
//     module reads exactly one engine of one response and nothing else.

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine } from "../../lib/runbook";
import {
  RATE_DUST_FLOOR_USD,
  RATE_METHOD,
  badDebtRate,
  ratePercentLabel,
  rateSideLine,
} from "../../app/lab/badDebtRate";
import { RUN_BOOK_ETH } from "../fixtures/lab-book";

function engineOf(response: { engines: readonly unknown[] }, name: string): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find(
    (engine) => engine.engine === name,
  );
  if (found === undefined) throw new Error(`fixture invariant: engine ${name} expected`);
  return found;
}

function rateOf(side: ReturnType<typeof badDebtRate>["before"]) {
  if (side.kind !== "rate") throw new Error(`expected a rate, got ${side.kind}`);
  return side;
}

test("the committed DM arm: exact truncated tenths on both sides, absolutes riding", () => {
  const model = badDebtRate(engineOf(RUN_BOOK_ETH, "debt_manager"));
  // 659603961 * 1000 / 4620000000 = 142.77… → 142 tenths → 14.2%.
  expect(rateOf(model.before).percentTenths).toBe("142");
  expect(ratePercentLabel(rateOf(model.before))).toBe("14.2%");
  // 1847722773 * 1000 / 6120000000 = 301.9… → 301 → 30.1%.
  expect(rateOf(model.after).percentTenths).toBe("301");
  expect(rateSideLine(model.after, "after", 6)).toBe(
    "after the shock: 30.1% of $6,120 eligible is bad debt ($1,847.722773).",
  );
});

test("the committed Aave arm: a 0/0 before side is UNDEFINED — never 0% and never 100%", () => {
  const model = badDebtRate(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi"));
  expect(model.before.kind).toBe("undefined");
  const line = rateSideLine(model.before, "before", 8);
  expect(line).toContain("no eligible debt to measure against");
  expect(line).toContain("UNDEFINED");
  expect(line).not.toContain("0%eligible");
  // The after side is a real rate: 66666666667 * 1000 / 600000000000 = 111 → 11.1%.
  expect(rateOf(model.after).percentTenths).toBe("111");
});

test("nonzero bad debt over ZERO eligible is a surfaced contradiction, not a division", () => {
  const engine = structuredClone(engineOf(RUN_BOOK_ETH, "debt_manager"));
  engine.before.eligible_debt_usd = "0";
  const model = badDebtRate(engine);
  expect(model.before.kind).toBe("contradiction");
  if (model.before.kind !== "contradiction") throw new Error("unreachable");
  expect(model.before.reason).toContain("RATE CONTRADICTION");
  expect(model.before.reason).toContain("not to divide");
});

test("a sub-tenth rate over REAL bad debt prints <0.1%, never a computed-zero costume", () => {
  const engine = structuredClone(engineOf(RUN_BOOK_ETH, "debt_manager"));
  engine.before.bad_debt_usd = "1"; // one micro-dollar of bad debt
  const model = badDebtRate(engine);
  const side = rateOf(model.before);
  expect(side.percentTenths).toBe("0");
  expect(ratePercentLabel(side)).toBe("<0.1%");
  // And a true zero stays 0.0% — the two are different facts.
  engine.before.bad_debt_usd = "0";
  expect(ratePercentLabel(rateOf(badDebtRate(engine).before))).toBe("0.0%");
});

test("the LIVE hazard: 100% of a dust denominator keeps its number and gains the dust flag", () => {
  const engine = structuredClone(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi"));
  // $4.10 of eligible debt, all of it bad — the rate the audit warns this API
  // will actually serve. 8 decimals: 410000000.
  engine.after.bad_debt_usd = "410000000";
  engine.after.eligible_debt_usd = "410000000";
  const model = badDebtRate(engine);
  const side = rateOf(model.after);
  expect(ratePercentLabel(side)).toBe("100.0%");
  expect(side.dust).toBe(true);
  const line = rateSideLine(model.after, "after", 8);
  // labUsd trims the trailing zero — the register's own law, pinned in
  // lab-frontier: "$4.1", not the audit prose's "$4.10".
  expect(line).toContain("100.0% of $4.1 eligible");
  expect(line).toContain("DUST");
  expect(line).toContain("the number stands, the visual weight does not");
});

test("the dust floor is a NAMED view policy and the boundary is exact bigint", () => {
  const engine = structuredClone(engineOf(RUN_BOOK_ETH, "debt_manager"));
  const floor = RATE_DUST_FLOOR_USD * 10n ** 6n; // $1,000 at 6 decimals
  engine.before.eligible_debt_usd = floor.toString();
  engine.before.bad_debt_usd = "0";
  expect(rateOf(badDebtRate(engine).before).dust).toBe(false); // exactly at the floor: not dust
  engine.before.eligible_debt_usd = (floor - 1n).toString();
  expect(rateOf(badDebtRate(engine).before).dust).toBe(true); // one micro-dollar under: dust
  // Grouped per the Lab's money law (AC-51) — "$1000" ungrouped was caught
  // by the page-wide sweep the moment this copy landed.
  expect(RATE_METHOD).toContain("$1,000");
  expect(RATE_METHOD).toContain("never its number");
  expect(RATE_METHOD).toContain("never pooled");
});

test("a rate above 100% is printed, not clamped — insolvency past eligibility is a served fact", () => {
  const engine = structuredClone(engineOf(RUN_BOOK_ETH, "debt_manager"));
  engine.after.bad_debt_usd = "9240000000"; // 2× the eligible 4620000000
  engine.after.eligible_debt_usd = "4620000000";
  expect(ratePercentLabel(rateOf(badDebtRate(engine).after))).toBe("200.0%");
});
