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

test("the takeaway names the gross, the counter-flow, the page — and the total it may NOT claim", () => {
  const model = viewOf(dmClone());
  // r90 F3 RE-LAW: the page holds SERVED ROWS, and only a row with a served
  // debt draws a bar — so the takeaway says "on this page", and the drawing
  // claim lives with the bars. "All 1 are drawn below" beside an unbarrable
  // row was two mutually exclusive sentences on one page.
  expect(flipTakeaway(model)).toBe(
    "This scenario flips 1 account to liquidation-eligible — the 1 flip is on this page. " +
      "No total of flipped debt is served, so none is claimed.",
  );
  // The truncation arm: one fully-served bar under a 130-flip population.
  const truncated = viewOf(dmClone());
  truncated.cells.flipsToEligible = 130;
  expect(flipTakeaway(truncated)).toBe(
    "This scenario flips 130 accounts to liquidation-eligible — the 1 largest by flipped debt " +
      "are on this page. No total of flipped debt is served, so none is claimed.",
  );
  // The counter-flow clause, when it exists, is named with the gross.
  const withBack = viewOf(dmClone());
  withBack.cells.flipsToEligible = 5;
  withBack.cells.flipsToHealthy = 3;
  expect(flipTakeaway(withBack)).toContain("while 3 flip back to healthy");
});

test("r91: a window holding a NULL-DEBT row earns no ranking claim — capped or not", () => {
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [
    base,
    { ...base, account: "0x8888888888888888888888888888888888888888", debt_usd: null },
  ];
  // CAPPED: 2 shown of 3 flips — the old arm called both "largest by
  // flipped debt", debt-ranking a row with no served debt. The book is
  // widened to 10 accounts so the partition itself stays lawful.
  engine.before.accounts = 10;
  engine.after.accounts = 10;
  engine.movers_total = 3;
  engine.newly_eligible_accounts = 3;
  engine.after.eligible_accounts = engine.before.eligible_accounts + 3;
  const line = flipTakeaway(viewOf(engine));
  expect(line).toContain("the served window of 2 rows is on this page");
  expect(line).not.toContain("largest by flipped debt");
  // And the method line claims ranking only where every row carries a debt.
  expect(FLIP_METHOD).toContain("ranked only where every row carries a served debt");
  expect(FLIP_METHOD).not.toContain("served largest-debt ranking");
});

test("r91: a verdict-refused window makes NO window claim — never `the 0 largest`", () => {
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [{ ...base, became_eligible: false }];
  const model = viewOf(engine);
  expect(model.barsRefused).not.toBeNull();
  const line = flipTakeaway(model);
  expect(line).toContain("no window claim is made");
  expect(line).not.toContain("0 largest");
  expect(line).not.toContain("on this page");
});

test("r90: a REVERSE-FLOW run is a view, never `none` — the counter-flow is the whole point", () => {
  // r90 F1: 3 eligible before, 2 after, zero flips in, one flip back. The
  // old zero-mover exit swallowed this partition whole, and an honest user
  // read only that nobody became eligible.
  const engine = dmClone();
  engine.movers = [];
  engine.movers_total = 0;
  engine.newly_eligible_accounts = -1;
  engine.before.eligible_accounts = 3;
  engine.after.eligible_accounts = 2;
  engine.before.accounts = 10;
  engine.after.accounts = 10;
  const model = viewOf(engine);
  expect(model.cells).toEqual({
    flipsToEligible: 0,
    flipsToHealthy: 1,
    stayedEligible: 2,
    stayedNotEligible: 7,
    total: 10,
  });
  expect(model.bars).toHaveLength(0);
  expect(flipTakeaway(model)).toBe(
    "This scenario flips no accounts to liquidation-eligible, while 1 flips back to healthy — " +
      "the served flow is the reverse one. No total of flipped debt is served, so none is claimed.",
  );
});

test("r90: a counted flip population with an EMPTY mover window is a contradiction, never `none`", () => {
  const engine = dmClone();
  engine.movers = [];
  // movers_total 1 with no served window: the ranking this view draws does
  // not exist on the wire.
  const reason = refusedOf(engine);
  expect(reason).toContain("WINDOW CONTRADICTION");
  expect(reason).toContain("empty mover window");
});

test("r90: a mover window LARGER than its population is a contradiction", () => {
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [base, { ...base, account: "0x6666666666666666666666666666666666666666" }];
  // movers_total stays 1: two windowed rows over a one-flip population.
  const reason = refusedOf(engine);
  expect(reason).toContain("WINDOW CONTRADICTION");
  expect(reason).toContain("larger than");
});

test("r90: a shown mover WITHOUT a true became_eligible verdict refuses the bars, visibly", () => {
  // r90 F2: eligibility comes from the served verdict, never from array
  // membership. A false or null verdict row must not be charted as a flip.
  const engine = dmClone();
  const base = engine.movers[0];
  if (base === undefined) throw new Error("fixture invariant: one DM mover expected");
  engine.movers = [base, { ...base, account: "0x7777777777777777777777777777777777777777", became_eligible: false }];
  engine.movers_total = 2;
  engine.newly_eligible_accounts = 2;
  engine.after.eligible_accounts = engine.before.eligible_accounts + 2;
  const model = viewOf(engine);
  expect(model.barsRefused).not.toBeNull();
  expect(model.barsRefused).toContain("VERDICT CONTRADICTION");
  expect(model.bars).toHaveLength(0);
  // A null verdict is refused the same way — null is not a yes.
  engine.movers = [base, { ...base, account: "0x7777777777777777777777777777777777777777", became_eligible: null }];
  expect(viewOf(engine).barsRefused).not.toBeNull();
  // And the honest window keeps its bars.
  engine.movers = [base];
  engine.movers_total = 1;
  engine.newly_eligible_accounts = 1;
  engine.after.eligible_accounts = engine.before.eligible_accounts + 1;
  expect(viewOf(engine).barsRefused).toBeNull();
});

test("the refused aside claims ONLY what the unsplit wire supports (r90 F4 re-law)", () => {
  // The old sentence said refused rows "belong to no cell and are never
  // zero" — but the wire's count MIXES rows already inside the four cells
  // with rows outside `accounts`, and it can legitimately be zero. The
  // sentence now claims membership in nothing.
  expect(flipRefusedAsideLine(1)).toBe(
    "Beside the partition: 1 refused row — an unsplit mix of rows with no usable comparator " +
      "and rows never rebuilt; the wire serves no split, so no cell membership is claimed and " +
      "the count sits outside the partition arithmetic.",
  );
});

test("the kind gates and the method line", () => {
  expect(flipRanking(engineOf(RUN_BOOK_ETH, "aave_v3_etherfi")).kind).toBe("not-dm");
  expect(flipCellLabel("flipsToEligible")).toBe("flipped to eligible");
  expect(flipCellLabel("stayedNotEligible")).toBe("stayed not eligible");
  expect(FLIP_METHOD).toContain("became_eligible");
  expect(FLIP_METHOD).toContain("disclosure, not a comparator");
  expect(FLIP_METHOD).toContain("window onto the flips");
});
