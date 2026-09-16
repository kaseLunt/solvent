// web/tests/unit/demo-lab-weld.spec.ts
// The Scenarios demo bodies are the demo Book's own figures: the run-book's
// before side is the Book, its after side is the Book's eth_minus_30
// waterfall at factor 0.70, its lanes are the Book's histogram, and every
// count the page derives from it is a sum the pins can redo.
import { expect, test } from "@playwright/test";
import { laneReading } from "../../lib/lab-transitions";
import { compareRows } from "../../lib/lab-compare";
import { DEMO_BATCH_ID, DEMO_BOOK, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2, DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET, DEMO_SCENARIOS } from "../fixtures/demo";
import { RUN_BOOK_WEETH_BATCH_1, SCENARIOS } from "../fixtures/lab-book";
import { DEFINITION_ETH } from "./helpers/run-book-engine";

const cash = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!;
const legacy = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const bookCash = () => DEMO_BOOK.engines.find((e) => e.engine === "debt_manager")!;
const bookLegacy = () => DEMO_BOOK.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const histogram = (engine: string) => DEMO_BOOK.hf_histogram.engines.find((e) => e.engine === engine)!.buckets.map((b) => b.count);
const waterfallAt = (factor: string, engine: string) => DEMO_BOOK.waterfall!.points.find((p) => p.factor === factor)!.engines.find((e) => e.engine === engine)!;

test("every body shares the Book's demo batch identity and clock", () => {
  for (const body of [DEMO_SCENARIOS, DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET]) expect(body.served_at).toBe(DEMO_BOOK.served_at);
  expect(DEMO_RUN_BOOK_ETH.batch).toEqual(DEMO_BOOK.batch);
  expect(DEMO_RUN_BOOK_SET.batch).toEqual(DEMO_BOOK.batch);
  expect(DEMO_RUN_BOOK_ETH.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_RUN_BOOK_SET.evaluation.newest_servable_batch_id).toBe(DEMO_BATCH_ID);
  expect(DEMO_RUN_BOOK_SET.evaluation.freshness).toBe("still_newest");
});

test("the listing is the committed set, verbatim", () => {
  expect(DEMO_SCENARIOS.scenarios).toEqual(SCENARIOS.scenarios);
  expect(DEMO_SCENARIOS.scenario_config_version).toBe(SCENARIOS.scenario_config_version);
  expect(DEMO_RUN_BOOK_ETH.scenario_id).toBe("eth_minus_30");
  expect(DEMO_RUN_BOOK_ETH.scenario_version).toBe(SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!.version);
  expect(DEMO_RUN_BOOK_ETH.label).toBe("ETH -30 percent");
});

test("the Cash before side IS the Book; the after side IS the waterfall at 0.70; the deltas are their difference", () => {
  const c = cash();
  const base = waterfallAt("1000000000000000000", "debt_manager");
  const shocked = waterfallAt("700000000000000000", "debt_manager");
  expect(c.usd_decimals).toBe(bookCash().value_decimals);
  expect(c.before.accounts).toBe(bookCash().computed_positions);
  expect(c.before.eligible_accounts).toBe(base.cumulative_eligible_accounts);
  expect(c.before.eligible_debt_usd).toBe(base.cumulative_debt_eligible_usd);
  expect(c.before.bad_debt_usd).toBe(base.cumulative_bad_debt_usd);
  expect(c.before.collateral_at_risk_usd).toBe(base.cumulative_collateral_at_risk_usd);
  expect(c.before.total_debt_usd).toBe(String(bookCash().total_debt));
  expect(c.before.total_collateral_usd).toBe(String(bookCash().total_collateral));
  expect(c.after.accounts).toBe(bookCash().computed_positions);
  expect(c.after.eligible_accounts).toBe(shocked.cumulative_eligible_accounts);
  expect(c.after.eligible_debt_usd).toBe(shocked.cumulative_debt_eligible_usd);
  expect(c.after.bad_debt_usd).toBe(shocked.cumulative_bad_debt_usd);
  expect(c.after.collateral_at_risk_usd).toBe(shocked.cumulative_collateral_at_risk_usd);
  expect(c.after.total_debt_usd).toBe(c.before.total_debt_usd);
  expect(BigInt(c.after.total_collateral_usd)).toBe((BigInt(c.before.total_collateral_usd) * 7n) / 10n);
  expect(c.newly_eligible_accounts).toBe(shocked.cumulative_eligible_accounts - base.cumulative_eligible_accounts);
  expect(c.newly_eligible_accounts).toBe(118);
  expect(BigInt(c.eligible_debt_delta_usd)).toBe(BigInt(c.after.eligible_debt_usd) - BigInt(c.before.eligible_debt_usd));
  expect(c.eligible_debt_delta_usd).toBe("1280000000000");
  expect(BigInt(c.bad_debt_delta_usd)).toBe(BigInt(c.after.bad_debt_usd) - BigInt(c.before.bad_debt_usd));
  expect(c.bad_debt_delta_usd).toBe("40780396039");
});

test("the Cash lanes are the Book's histogram and the plan's movement table; every derived count re-sums", () => {
  const c = cash();
  const t = c.hf_transitions;
  expect(t.from_rows.slice(0, 8)).toEqual(histogram("debt_manager"));
  expect(t.from_rows).toEqual([41, 8, 14, 13, 73, 153, 300, 804, 0, 6]);
  expect(t.to_rows).toEqual([155, 12, 135, 43, 129, 188, 320, 424, 0, 6]);
  expect(t.total_rows).toBe(bookCash().positions);
  expect(t.unmeasured_rows).toBe(bookCash().refused_positions);
  expect(t.measured_rows).toBe(bookCash().computed_positions);
  expect(t.held_rows).toBe(465);
  expect(t.lane_changed_rows).toBe(941);
  expect(c.before.hf_histogram.buckets.map((b) => b.count)).toEqual(t.from_rows.slice(0, 8));
  expect(c.after.hf_histogram.buckets.map((b) => b.count)).toEqual(t.to_rows.slice(0, 8));
  // The not-measured cell's two debts are the contract's null ("null and never \"0\""): it reached no arithmetic and adds nothing here.
  const debtBefore = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + (x.debt_before_usd === null ? 0n : BigInt(x.debt_before_usd)), 0n);
  const debtAfter = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + (x.debt_after_usd === null ? 0n : BigInt(x.debt_after_usd)), 0n);
  expect(debtBefore).toBe(BigInt(c.before.total_debt_usd));
  expect(debtAfter).toBe(BigInt(c.after.total_debt_usd));
  const r = laneReading(c, { merge: true });
  if (r.kind !== "ok") throw new Error(r.reasons.join("; "));
  expect(r.view.merged).toBe(true);
  expect(r.view.crossedCap).toBe(118);
  expect(r.view.bandChanged).toBe(425);
  expect(r.view.improved).toBe(0);
  expect(r.view.nearToday).toBe(27);
  expect(r.view.nearCrossed).toBe(27);
});

test("the movers are the demo pages' own accounts that cross under ×0.7, ascending by the ratio after (furthest past the cap first), 20 of 118", () => {
  const c = cash();
  expect(c.movers).toHaveLength(20);
  expect(c.movers_total).toBe(118);
  // The note states the order the rows below are checked in, and the truncation.
  expect(c.movers_note).toContain("ranked here by the exact ratio AFTER the shock, ascending: the account furthest past the cap first");
  expect(c.movers_note).toContain("`movers` carries the 20 furthest past the cap; the other 98 are not on this page.");
  // The two pages are the whole Cash book; a mover may come from either.
  const rows = new Map([...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => [p.account.toLowerCase(), p]));
  let previous = 0n;
  for (const m of c.movers) {
    const row = rows.get(m.account.toLowerCase());
    expect(row).toBeDefined();
    expect(row!.liquidatable).toBe(false);
    expect(m.hf_before_num).toBe(row!.health_factor!.num);
    expect(m.hf_before_den).toBe(row!.health_factor!.den);
    expect(BigInt(m.hf_after_num!)).toBe(BigInt(m.hf_before_num!) * 7n);
    expect(BigInt(m.hf_after_den!)).toBe(BigInt(m.hf_before_den!) * 10n);
    expect(BigInt(m.hf_after_num!) < BigInt(m.hf_after_den!)).toBe(true);
    expect(m.became_eligible).toBe(true);
    expect(m.debt_usd).toBe(String(row!.total_debt));
    // ascending by the ratio after (row 1 is the account furthest past the cap): num_after/den_after non-decreasing
    const ratio = (BigInt(m.hf_after_num!) * 1_000_000n) / BigInt(m.hf_after_den!);
    expect(ratio >= previous).toBe(true);
    previous = ratio;
  }
});

test("the weETH realization is the depeg rule over the Book's figures, and the rule reproduces the contract's own weETH example", () => {
  // The rule: the market is 5 percent under the oracle, so the seized collateral
  // (pro rata) realises 5 percent less than its oracle value; the bad debt at
  // liquidation is the eligible debt less the collateral realised at 95 percent,
  // never less than the bad debt already on the book.
  const rule = (before: { collateral_at_risk_usd: string; eligible_debt_usd: string; bad_debt_usd: string }) => {
    const car = BigInt(before.collateral_at_risk_usd);
    const shortfall = (car * 500n) / 10_000n;
    const uncovered = BigInt(before.eligible_debt_usd) - (car - shortfall);
    const current = BigInt(before.bad_debt_usd);
    return [shortfall.toString(), (uncovered > current ? uncovered : current).toString()];
  };
  const block = (m: { execution_shortfall_usd: string; bad_debt_at_liquidation_usd: string } | null) => [m!.execution_shortfall_usd, m!.bad_debt_at_liquidation_usd];
  // The contract's own example, both engines: the rule IS the server's arithmetic.
  for (const e of RUN_BOOK_WEETH_BATCH_1.engines) expect(rule(e.before), e.engine).toEqual(block(e.market_realization));
  expect(block(RUN_BOOK_WEETH_BATCH_1.engines.find((e) => e.engine === "debt_manager")!.market_realization)).toEqual(["200000000", "820000000"]);
  // The demo: the same rule over the run-book's before sides (which ARE the Book's, pinned above), on both covered engines.
  const weeth = DEMO_RUN_BOOK_SET.results.find((r) => r.scenario_id === "weeth_market_depeg_oracles_held")!;
  for (const engine of [cash(), legacy()]) {
    const row = weeth.engines.find((e) => e.engine === engine.engine)!;
    expect(block(row.market_realization), engine.engine).toEqual(rule(engine.before));
    expect(row.market_realization!.hfs_unchanged).toBe(true);
    expect(row.market_realization!.usd_decimals).toBe(engine.usd_decimals);
    expect(row.eligible_debt_delta_usd).toBe("0");
  }
  expect(block(weeth.engines.find((e) => e.engine === "debt_manager")!.market_realization)).toEqual(["838426962", "239603961"]);
});

test("the helper's DEFINITION_ETH is the demo listing's eth_minus_30, field for field", () => {
  const listed = DEMO_SCENARIOS.scenarios.find((s) => s.id === "eth_minus_30")!;
  for (const field of ["id", "version", "label", "description", "path_assumption", "engines", "shocks", "out_of_model"] as const) {
    expect(DEFINITION_ETH[field], field).toEqual(listed[field]);
  }
});

test("the legacy engine welds to the Book's engine card and histogram, one lane down, 14 crossing", () => {
  const l = legacy();
  expect(l.usd_decimals).toBe(bookLegacy().value_decimals);
  expect(l.before.accounts).toBe(bookLegacy().computed_positions);
  expect(l.before.eligible_accounts).toBe(bookLegacy().liquidatable_positions);
  expect(l.hf_transitions.from_rows.slice(0, 8)).toEqual(histogram("aave_v3_etherfi"));
  expect(l.hf_transitions.from_rows).toEqual([40, 6, 27, 318, 1204, 2890, 4055, 12, 0, 0]);
  expect(l.hf_transitions.to_rows).toEqual([46, 14, 331, 1204, 2890, 4055, 12, 0, 0, 0]);
  expect(l.newly_eligible_accounts).toBe(14);
  expect(l.after.eligible_accounts).toBe(60);
  const r = laneReading(l, { merge: false });
  if (r.kind !== "ok") throw new Error(r.reasons.join("; "));
  expect(r.view.merged).toBe(false);
  expect(r.view.crossedCap).toBe(14);
  expect(r.view.improved).toBe(0);
});

test("the set run carries the four committed scenarios; the eth row IS the run-book's Cash figures; the shares read", () => {
  expect(DEMO_RUN_BOOK_SET.requested_scenario_ids).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  expect(DEMO_RUN_BOOK_SET.results.map((r) => r.scenario_id)).toEqual(SCENARIOS.scenarios.map((s) => s.id));
  const eth = DEMO_RUN_BOOK_SET.results.find((r) => r.scenario_id === "eth_minus_30")!.engines.find((e) => e.engine === "debt_manager")!;
  const c = cash();
  expect(eth.before_eligible_accounts).toBe(c.before.eligible_accounts);
  expect(eth.after_eligible_accounts).toBe(c.after.eligible_accounts);
  expect(eth.eligible_debt_delta_usd).toBe(c.eligible_debt_delta_usd);
  expect(eth.bad_debt_delta_usd).toBe(c.bad_debt_delta_usd);
  expect(eth.total_debt_usd_before).toBe(c.before.total_debt_usd);
  expect(eth.flipped_to_eligible).toBe(118);
  const v = compareRows(DEMO_RUN_BOOK_SET, "debt_manager");
  expect(v.rows.map((r) => [r.id, r.kind, r.shareText])).toEqual([
    ["eth_minus_30", "point", "+4.5%"],
    ["ethfi_minus_50", "point", "+<0.1%"],
    ["weeth_market_depeg_oracles_held", "point", "0%"],
    ["dm_rate_horizon_plus_200bps", "point", "0%"],
  ]);
});
