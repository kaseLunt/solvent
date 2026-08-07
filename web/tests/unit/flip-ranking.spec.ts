// VIEW 5 (Debt Manager flip ranking) — the pure view-model's laws, pinned
// against the committed eth_minus_30 fixture plus DERIVED NEGATIVES
// documented at their sites.
//
// The laws under test (views spec view 5 + completeness critic Finding 2):
//   - the FOUR cells partition before.accounts EXACTLY; refused is a NAMED
//     ASIDE, never a fifth cell (the wire sums two populations under it);
//   - flips-to-healthy may lawfully EXCEED movers_total (negative net); only
//     a negative cell or a non-closing sum is a contradiction, and every
//     contradiction REFUSES the partition visibly;
//   - the welds run BEFORE the zero-mover exit (the r88 lesson, applied at
//     design time): a contradictory no-flip run refuses, it does not render
//     an unqualified nothing-flipped story;
//   - nothing totals the shown bars, and the takeaway SAYS the total is not
//     served;
//   - a flip with no served debt is named unbarrable, never $0;
//   - the served largest-debt ranking is welded: a violation is surfaced
//     beside the bars, never silently re-sorted away.

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine } from "../../lib/runbook";
import {
  FLIP_METHOD,
  flipCellLabel,
  flipRanking,
  flipRefusedAsideLine,
  flipTakeaway,
  flipUnbarrableLine,
} from "../../app/lab/flipRanking";
import { RUN_BOOK_ETH } from "../fixtures/lab-book";

function engineOf(response: { engines: readonly unknown[] }, name: string): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find(
    (engine) => engine.engine === name,
  );
  if (found === undefined) throw new Error(`fixture invariant: engine ${name} expected`);
  return found;
}

function dmClone(): LabRunBookEngine {
  return structuredClone(engineOf(RUN_BOOK_ETH, "debt_manager"));
}

function viewOf(engine: LabRunBookEngine) {
  const model = flipRanking(engine);
  if (model.kind !== "view") throw new Error(`expected a view, got ${model.kind}`);
  return model;
}

function refusedOf(engine: LabRunBookEngine): string {
  const model = flipRanking(engine);
  if (model.kind !== "refused") throw new Error(`expected refused, got ${model.kind}`);
  return model.reason;
}

test("the committed fixture's DM arm: four cells partition the run's 3 accounts exactly", () => {
  const model = viewOf(dmClone());
  // movers_total 1, newly 1 → 0 flips back; before 1 eligible of 3 accounts.
  expect(model.cells).toEqual({
    flipsToEligible: 1,
    flipsToHealthy: 0,
    stayedEligible: 1,
    stayedNotEligible: 1,
    total: 3,
  });
  // The refused row is the ASIDE, not a cell: 1+0+1+1 = 3 already closes.
  expect(model.refusedAside).toBe(1);
  expect(model.bars).toEqual([
    { account: "0x00000000000000000000000000000000000d0002", debtUsd: "1500000000" },
  ]);
  expect(model.unbarrable).toHaveLength(0);
  expect(model.maxDebtUsd).toBe("1500000000");
  expect(model.rankingContradiction).toBeNull();
});

test("a NEGATIVE NET is lawful: more flips back than in, and the partition still closes", () => {
  const engine = dmClone();
  // 10 accounts, 3 eligible before, 2 after (net -1), 2 gross flips in →
  // 3 flips back, 0 stayed eligible, 5 stayed out. Σ = 10. No contradiction.
  engine.before.accounts = 10;
  engine.after.accounts = 10;
  engine.before.eligible_accounts = 3;
  engine.after.eligible_accounts = 2;
  engine.movers_total = 2;
  engine.newly_eligible_accounts = -1;
  const model = viewOf(engine);
  expect(model.cells).toEqual({
    flipsToEligible: 2,
    flipsToHealthy: 3,
    stayedEligible: 0,
    stayedNotEligible: 5,
    total: 10,
  });
});

test("a NEGATIVE CELL refuses the partition — no honest partition holds fewer than zero accounts", () => {
  const engine = dmClone();
  // DERIVED NEGATIVE: 3 net flips over a 2-flip gross → -1 flips back.
  engine.before.eligible_accounts = 0;
  engine.after.eligible_accounts = 3;
  engine.movers_total = 2;
  engine.newly_eligible_accounts = 3;
  const reason = refusedOf(engine);
  expect(reason).toContain("PARTITION CONTRADICTION");
  expect(reason).toContain("negative cell");
});

test("the sides disagreeing on the ACCOUNT COUNT refuses the partition", () => {
  const engine = dmClone();
  engine.after.accounts = 4;
  const reason = refusedOf(engine);
  expect(reason).toContain("3 accounts before and 4 after");
});

test("a served net that disagrees with ITS OWN DEFINITION refuses the partition", () => {
  const engine = dmClone();
  // DERIVED NEGATIVE: newly says 1, but the two sides' eligible counts say 0.
  engine.after.eligible_accounts = engine.before.eligible_accounts;
  const reason = refusedOf(engine);
  expect(reason).toContain("disagrees with its own definition");
});

test("the welds run BEFORE the zero-flip exit — a contradictory no-flip run refuses, never `none`", () => {
  const engine = dmClone();
  engine.movers = [];
  engine.movers_total = 0;
  engine.newly_eligible_accounts = 0;
  engine.after.eligible_accounts = engine.before.eligible_accounts;
  engine.after.accounts = 4; // the contradiction
  expect(flipRanking(engine).kind).toBe("refused");
  // And the honest zero-flip run is `none`, not a refusal — the guard is
  // not always-on.
  engine.after.accounts = engine.before.accounts;
  expect(flipRanking(engine).kind).toBe("none");
});

test("a flip with NO SERVED DEBT is named unbarrable — never dropped, never $0", () => {
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [
    base,
    { ...base, account: "0x4444444444444444444444444444444444444444", debt_usd: null },
  ];
  engine.movers_total = 2;
  engine.newly_eligible_accounts = 2;
  engine.after.eligible_accounts = engine.before.eligible_accounts + 2;
  const model = viewOf(engine);
  expect(model.bars).toHaveLength(1);
  expect(model.unbarrable).toEqual(["0x4444444444444444444444444444444444444444"]);
  expect(model.bars.length + model.unbarrable.length).toBe(engine.movers.length);
  expect(flipUnbarrableLine(1)).toBe(
    "1 shown flip carries no served debt figure and draws no bar — listed in the table below, " +
      "never rendered as $0.",
  );
});

test("a served order that breaks its own largest-first rule is SURFACED, never re-sorted", () => {
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [
    base, // 1500000000
    { ...base, account: "0x5555555555555555555555555555555555555555", debt_usd: "9000000000" },
  ];
  engine.movers_total = 2;
  engine.newly_eligible_accounts = 2;
  engine.after.eligible_accounts = engine.before.eligible_accounts + 2;
  const model = viewOf(engine);
  expect(model.rankingContradiction).not.toBeNull();
  expect(model.rankingContradiction).toContain("0x5555555555555555555555555555555555555555");
  // The SERVED order stays — the contradiction qualifies it, nothing hides it.
  expect(model.bars.map((bar) => bar.debtUsd)).toEqual(["1500000000", "9000000000"]);
  expect(model.maxDebtUsd).toBe("9000000000");
});

test("the takeaway names the gross, the counter-flow, the window — and the total it may NOT claim", () => {
  const model = viewOf(dmClone());
  expect(flipTakeaway(model, 1)).toBe(
    "This scenario flips 1 account to liquidation-eligible — all 1 are drawn below, ranked by " +
      "flipped debt. No total of flipped debt is served, so none is claimed.",
  );
  // The truncation arm, live-book shaped: top 20 of 130 with 0 flips back.
  const truncated = viewOf(dmClone());
  truncated.cells.flipsToEligible = 130;
  expect(flipTakeaway(truncated, 20)).toBe(
    "This scenario flips 130 accounts to liquidation-eligible — the 20 largest by flipped debt " +
      "are drawn below. No total of flipped debt is served, so none is claimed.",
  );
  // The counter-flow clause, when it exists, is named with the gross.
  const withBack = viewOf(dmClone());
  withBack.cells.flipsToEligible = 5;
  withBack.cells.flipsToHealthy = 3;
  expect(flipTakeaway(withBack, 5)).toContain("while 3 flip back to healthy");
});

test("the refused aside carries Finding 2's caveat: two populations, no split, no cell, no zero", () => {
  expect(flipRefusedAsideLine(1)).toBe(
    "Beside the partition, not inside it: 1 refused row — the wire counts rows with no usable " +
      "comparator and rows it could not rebuild under one number, so they belong to no cell " +
      "and are never zero.",
  );
});

test("the kind gates and the method line", () => {
  expect(flipRanking(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi")).kind).toBe("not-dm");
  expect(flipCellLabel("flipsToEligible")).toBe("flipped to eligible");
  expect(flipCellLabel("stayedNotEligible")).toBe("stayed not eligible");
  expect(FLIP_METHOD).toContain("became_eligible");
  expect(FLIP_METHOD).toContain("disclosure, not a comparator");
  expect(FLIP_METHOD).toContain("a window");
});
