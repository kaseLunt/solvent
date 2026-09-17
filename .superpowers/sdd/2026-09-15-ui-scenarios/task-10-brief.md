### Task 10: The Scenarios demo dataset — generated, clock-law checked, welded to the demo Book (R16)

**Files:**
- Create: `web/tests/fixtures/demo/generate-demo-lab.mjs`, `web/tests/fixtures/demo/scenarios-demo.json`, `web/tests/fixtures/demo/run-book-demo-eth_minus_30.json`, `web/tests/fixtures/demo/run-book-set-demo.json`
- Modify: `web/tests/fixtures/demo/index.ts`, `web/tests/unit/fixture-clock-law.spec.ts`
- Test: `web/tests/unit/demo-lab-weld.spec.ts`

**Interfaces:**
- Consumes: `tests/fixtures/demo/book.demo.json` (batch 18,251; `hf_histogram.engines[]`; `waterfall` for `eth_minus_30`; `bad_debt[]`; the engine cards), `positions-dm-demo-page-1.json` (the movers), the contract fixtures `scenarios.json`, `run-book.eth_minus_30.json`, `run-book-set.json` (envelopes, notes, lanes, reach shapes — verbatim where copied), `tests/fixtures/clock-law.mjs` (`checkClocks`), the plan's movement tables (R16 and the legacy one-lane-down rule).
- Produces: `DEMO_SCENARIOS: ScenariosResponse`, `DEMO_RUN_BOOK_ETH: RunBookResponse`, `DEMO_RUN_BOOK_SET: RunBookSetResponse` from `tests/fixtures/demo/index.ts`.

- [ ] **Step 1: The weld pins (failing)**

```ts
// web/tests/unit/demo-lab-weld.spec.ts
// The Scenarios demo bodies are the demo Book's own figures: the run-book's
// before side is the Book, its after side is the Book's eth_minus_30
// waterfall at factor 0.70, its lanes are the Book's histogram, and every
// count the page derives from it is a sum the pins can redo.
import { expect, test } from "@playwright/test";
import { laneReading } from "../../lib/lab-transitions";
import { compareRows } from "../../lib/lab-compare";
import { DEMO_BATCH_ID, DEMO_BOOK, DEMO_POSITIONS_DM_PAGE_1, DEMO_RUN_BOOK_ETH, DEMO_RUN_BOOK_SET, DEMO_SCENARIOS } from "../fixtures/demo";
import { SCENARIOS } from "../fixtures/lab-book";

const cash = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "debt_manager")!;
const legacy = () => DEMO_RUN_BOOK_ETH.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const bookCash = () => DEMO_BOOK.engines.find((e) => e.engine === "debt_manager")!;
const bookLegacy = () => DEMO_BOOK.engines.find((e) => e.engine === "aave_v3_etherfi")!;
const histogram = (engine: string) => DEMO_BOOK.hf_histogram.engines.find((e) => e.engine === engine)!.buckets.map((b) => b.count);
const waterfallAt = (factor: string, engine: string) => DEMO_BOOK.waterfall.points.find((p) => p.factor === factor)!.engines.find((e) => e.engine === engine)!;

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
  const debtBefore = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + BigInt(x.debt_before_usd), 0n);
  const debtAfter = t.outflows.flatMap((o) => o.cells).reduce((s, x) => s + BigInt(x.debt_after_usd), 0n);
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

test("the movers are the demo pages' own accounts that cross under ×0.7, ranked nearest the cap after, 20 of 118", () => {
  const c = cash();
  expect(c.movers).toHaveLength(20);
  expect(c.movers_total).toBe(118);
  const rows = new Map(DEMO_POSITIONS_DM_PAGE_1.positions.map((p) => [p.account.toLowerCase(), p]));
  let previous = 0n;
  for (const m of c.movers) {
    const row = rows.get(m.account.toLowerCase());
    expect(row).toBeDefined();
    expect(row!.liquidatable).toBe(false);
    expect(m.hf_before_num).toBe(row!.health_factor.num);
    expect(m.hf_before_den).toBe(row!.health_factor.den);
    expect(BigInt(m.hf_after_num!)).toBe(BigInt(m.hf_before_num!) * 7n);
    expect(BigInt(m.hf_after_den!)).toBe(BigInt(m.hf_before_den!) * 10n);
    expect(BigInt(m.hf_after_num!) < BigInt(m.hf_after_den!)).toBe(true);
    expect(m.became_eligible).toBe(true);
    expect(m.debt_usd).toBe(String(row!.total_debt));
    // ranked by the ratio after, ascending (nearest the cap first): num_after/den_after non-decreasing
    const ratio = (BigInt(m.hf_after_num!) * 1_000_000n) / BigInt(m.hf_after_den!);
    expect(ratio >= previous).toBe(true);
    previous = ratio;
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts`
Expected: FAIL — `DEMO_SCENARIOS` is not exported.

- [ ] **Step 3: The generator**

```js
// web/tests/fixtures/demo/generate-demo-lab.mjs
// The Scenarios demo dataset (spec 2026-09-15 §8; plan 3 R16) + PROVENANCE.
// Regenerate: node tests/fixtures/demo/generate-demo-lab.mjs (from web/)
//
// Nothing here is hand-shaped wire data:
//   * scenarios-demo.json is the contract's committed set (tests/fixtures/
//     scenarios.json) verbatim, stamped with the demo Book's clock;
//   * run-book-demo-eth_minus_30.json: the envelope, notes, applied shocks,
//     held-flat inputs, lane vocabulary and movers_note are the contract's own
//     200 example (tests/fixtures/run-book.eth_minus_30.json), verbatim; the
//     batch is the demo Book's batch; the Cash engine's BEFORE side is the
//     demo Book (engine card, bad_debt entry, waterfall base point, histogram)
//     and its AFTER side is the demo Book's own eth_minus_30 waterfall point at
//     factor 0.70 — so the page's figures are the Book's, to the dollar; the
//     lane movement is the plan's table (a −30 % mark scales the Cash cap by
//     0.7: lanes 1.00–1.25 all cross, 18 of lane 1.25–1.50 cross, the rest
//     step down); cell debts allocate the engine's total debt across cells in
//     proportion to rows (the remainder on the largest cell) and do not move —
//     Cash debt is USD; the movers are the demo pages' own computed rows that
//     cross under ×0.7 (num×7 < den×10), ranked by the ratio after, 20 of the
//     118; the legacy engine's before side is the Book's Aave card and
//     histogram and its after side steps each bucket one lane down with 14
//     crossing (a design assumption, as the demo waterfall's Aave arm is);
//   * run-book-set-demo.json: the contract's set-run example's envelope,
//     evaluation, coverage and reach shapes (tests/fixtures/run-book-set.json),
//     re-clocked to the demo Book, one result per committed scenario; the
//     eth_minus_30 Cash summary IS the run-book above; the other three carry
//     design figures stated below (ETHFI −50 %: +$9,800, 2 accounts; the weETH
//     depeg: no HF movement, a market-realization shortfall; the rate step:
//     no HF movement, a projection);
//   * every body passes checkClocks() before it is written.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));

const book = read("book.demo.json");
const page1 = read("positions-dm-demo-page-1.json");
const scenarios = readFixture("scenarios.json");
const runBookTemplate = readFixture("run-book.eth_minus_30.json");
const setTemplate = readFixture("run-book-set.json");

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const SERVED_AT = book.served_at;
const engineCard = (id) => book.engines.find((e) => e.engine === id);
const badDebt = (id) => book.bad_debt.find((e) => e.engine === id);
const histogramOf = (id) => book.hf_histogram.engines.find((e) => e.engine === id);
const waterfallAt = (factor, id) => book.waterfall.points.find((p) => p.factor === factor).engines.find((e) => e.engine === id);
const templateEngine = (id) => runBookTemplate.engines.find((e) => e.engine === id);

// ---- lanes ----------------------------------------------------------------
// The lane vocabulary is the contract's own (ten lanes: eight buckets, no-debt,
// not-measured); the buckets' edges are the Book histogram's.
const LANES = templateEngine(CASH).hf_transitions.lanes;
const INFINITE = 8;
const UNMEASURED = 9;

/** table[from][to] = rows. Every margin, histogram count and total is summed from it. */
function transitionsOf(table, comparator, totalDebt, unmeasuredRefused) {
  const n = LANES.length;
  const from_rows = Array(n).fill(0);
  const to_rows = Array(n).fill(0);
  const cells = [];
  for (const [f, row] of Object.entries(table)) {
    for (const [t, rows] of Object.entries(row)) {
      const fi = Number(f);
      const ti = Number(t);
      from_rows[fi] += rows;
      to_rows[ti] += rows;
      cells.push({ from: fi, to: ti, rows });
    }
  }
  const total = from_rows.reduce((a, b) => a + b, 0);
  const unmeasured = from_rows[UNMEASURED];
  // Debt allocation: proportional to rows over the MEASURED cells, exact remainder on the largest cell.
  const measuredCells = cells.filter((c) => c.from !== UNMEASURED && c.to !== UNMEASURED);
  const measuredRows = measuredCells.reduce((a, c) => a + c.rows, 0);
  let allocated = 0n;
  let largest = measuredCells[0];
  for (const c of measuredCells) {
    c.debt = (totalDebt * BigInt(c.rows)) / BigInt(measuredRows);
    allocated += c.debt;
    if (c.rows > largest.rows) largest = c;
  }
  largest.debt += totalDebt - allocated;
  for (const c of cells) if (c.debt === undefined) c.debt = 0n;
  let held = 0;
  let changed = 0;
  for (const c of measuredCells) {
    if (c.from === c.to) held += c.rows;
    else changed += c.rows;
  }
  const outflows = LANES.map((lane) => ({
    from: lane.index,
    cells: cells
      .filter((c) => c.from === lane.index)
      .map((c) => ({ to: c.to, rows: c.rows, debt_before_usd: c.debt.toString(), debt_after_usd: c.debt.toString() })),
  }));
  return {
    comparator,
    wad_scale: templateEngine(CASH).hf_transitions.wad_scale,
    lanes: LANES,
    outflows,
    from_rows,
    to_rows,
    total_rows: total,
    measured_rows: total - unmeasured,
    unmeasured_rows: unmeasured,
    unmeasured_refused_in_batch_rows: unmeasuredRefused,
    unmeasured_excluded_by_this_layer_rows: unmeasured - unmeasuredRefused,
    held_rows: held,
    lane_changed_rows: changed,
    note: templateEngine(CASH).hf_transitions.note,
  };
}

function histogramFromRows(template, rows) {
  return { ...template, buckets: template.buckets.map((b, i) => ({ ...b, count: rows[i] })) };
}

// ---- the Cash engine (plan R16) ---------------------------------------------
const CASH_TABLE = {
  0: { 0: 41 },
  1: { 0: 8 },
  2: { 0: 14 },
  3: { 0: 13 },
  4: { 0: 73 },
  5: { 0: 6, 1: 12, 2: 135 },
  6: { 3: 43, 4: 129, 5: 128 },
  7: { 5: 60, 6: 320, 7: 424 },
  9: { 9: 6 },
};

function cashEngine() {
  const card = engineCard(CASH);
  const hist = histogramOf(CASH);
  const base = waterfallAt("1000000000000000000", CASH);
  const shocked = waterfallAt("700000000000000000", CASH);
  const totalDebt = BigInt(card.total_debt);
  const t = transitionsOf(CASH_TABLE, hist.comparator, totalDebt, card.refused_positions);
  const template = templateEngine(CASH);
  if (t.from_rows.slice(0, 8).join() !== hist.buckets.map((b) => b.count).join()) throw new Error("the Cash table's from_rows must be the Book's histogram");
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: base.cumulative_eligible_accounts,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: base.cumulative_debt_eligible_usd,
    collateral_at_risk_usd: base.cumulative_collateral_at_risk_usd,
    bad_debt_usd: base.cumulative_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.from_rows),
    collateral_by_asset: template.before.collateral_by_asset,
  };
  const after = {
    accounts: card.computed_positions,
    eligible_accounts: shocked.cumulative_eligible_accounts,
    total_collateral_usd: ((BigInt(card.total_collateral) * 7n) / 10n).toString(),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: shocked.cumulative_debt_eligible_usd,
    collateral_at_risk_usd: shocked.cumulative_collateral_at_risk_usd,
    bad_debt_usd: shocked.cumulative_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  // Movers: the demo pages' computed, non-liquidatable rows that cross under ×0.7, nearest the cap after first.
  const crossing = page1.positions
    .filter((p) => p.status === "computed" && p.liquidatable === false && p.health_factor.num !== null && p.health_factor.den !== null)
    .filter((p) => BigInt(p.health_factor.num) * 7n < BigInt(p.health_factor.den) * 10n)
    .map((p) => ({ p, ratio: (BigInt(p.health_factor.num) * 7_000_000n) / (BigInt(p.health_factor.den) * 10n) }))
    .sort((a, b) => (a.ratio < b.ratio ? -1 : a.ratio > b.ratio ? 1 : a.p.account.localeCompare(b.p.account)));
  const movers = crossing.slice(0, 20).map(({ p }) => ({
    account: p.account,
    engine: CASH,
    hf_before_wad: null,
    hf_after_wad: null,
    hf_drop_wad: null,
    hf_before_num: p.health_factor.num,
    hf_before_den: p.health_factor.den,
    hf_after_num: (BigInt(p.health_factor.num) * 7n).toString(),
    hf_after_den: (BigInt(p.health_factor.den) * 10n).toString(),
    became_eligible: true,
    debt_usd: String(p.total_debt),
  }));
  const newly = shocked.cumulative_eligible_accounts - base.cumulative_eligible_accounts;
  return {
    engine: CASH,
    usd_decimals: card.value_decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: newly,
    eligible_debt_delta_usd: (BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)).toString(),
    bad_debt_delta_usd: (BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)).toString(),
    movers,
    movers_total: newly,
    movers_note: template.movers_note,
    market_realization: null,
    projection: null,
    note: template.note,
  };
}

// ---- the legacy engine (one lane down; 14 cross) -------------------------------
const LEGACY_TABLE = {
  0: { 0: 40 },
  1: { 0: 6 },
  2: { 1: 14, 2: 13 },
  3: { 2: 318 },
  4: { 3: 1204 },
  5: { 4: 2890 },
  6: { 5: 4055 },
  7: { 6: 12 },
};

function legacyEngine() {
  const card = engineCard(LEGACY);
  const hist = histogramOf(LEGACY);
  const bad = badDebt(LEGACY);
  const template = templateEngine(LEGACY);
  const t = transitionsOf(LEGACY_TABLE, hist.comparator, BigInt(card.total_debt), card.refused_positions);
  if (t.from_rows.slice(0, 8).join() !== hist.buckets.map((b) => b.count).join()) throw new Error("the legacy table's from_rows must be the Book's histogram");
  const newly = 14;
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: bad.eligible_debt_usd,
    collateral_at_risk_usd: bad.collateral_at_risk_usd,
    bad_debt_usd: bad.current_bad_debt_usd,
    hf_histogram: histogramFromRows(hist, t.from_rows),
    collateral_by_asset: template.before.collateral_by_asset,
  };
  const eligibleDebtDelta = 600_000_000_000n; // $6,000 at 8 decimals: the contract example's own delta
  const badDebtDelta = 66_666_666_667n; // $666.67 at 8 decimals: the contract example's own delta
  const after = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions + newly,
    total_collateral_usd: ((BigInt(card.total_collateral) * 7n) / 10n).toString(),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: (BigInt(bad.eligible_debt_usd) + eligibleDebtDelta).toString(),
    collateral_at_risk_usd: ((BigInt(bad.collateral_at_risk_usd) * 7n) / 10n).toString(),
    bad_debt_usd: (BigInt(bad.current_bad_debt_usd) + badDebtDelta).toString(),
    hf_histogram: histogramFromRows(hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  return {
    engine: LEGACY,
    usd_decimals: card.value_decimals,
    before,
    after,
    hf_transitions: t,
    newly_eligible_accounts: newly,
    eligible_debt_delta_usd: eligibleDebtDelta.toString(),
    bad_debt_delta_usd: badDebtDelta.toString(),
    movers: [],
    movers_total: newly,
    movers_note: "the legacy market's movers are not carried on the demo wire; the count is the newly eligible accounts",
    market_realization: null,
    projection: null,
    note: template.note,
  };
}

// ---- bodies -------------------------------------------------------------------
const ETH_DEF = scenarios.scenarios.find((s) => s.id === "eth_minus_30");

function scenariosBody() {
  return { ...scenarios, served_at: SERVED_AT };
}

function runBookBody() {
  return {
    ...runBookTemplate,
    served_at: SERVED_AT,
    batch: book.batch,
    scenario_config_version: scenarios.scenario_config_version,
    scenario_id: ETH_DEF.id,
    scenario_version: ETH_DEF.version,
    label: ETH_DEF.label,
    description: ETH_DEF.description,
    path_assumption: ETH_DEF.path_assumption,
    shocks: ETH_DEF.shocks,
    out_of_model: ETH_DEF.out_of_model,
    engines: [legacyEngine(), cashEngine()],
    excluded_engines: [],
  };
}

function setBody(runBook) {
  const cashRun = runBook.engines.find((e) => e.engine === CASH);
  const legacyRun = runBook.engines.find((e) => e.engine === LEGACY);
  const templateResult = setTemplate.results.find((r) => r.scenario_id === "eth_minus_30");
  const templateCash = templateResult.engines.find((e) => e.engine === CASH);
  const templateLegacy = templateResult.engines.find((e) => e.engine === LEGACY);
  const noShockReach = setTemplate.results.find((r) => r.shock_reach.every((s) => s.declared_shocks === 0))?.shock_reach ?? templateResult.shock_reach;
  const summary = (template, engine, figures) => ({
    ...template,
    engine: engine.engine,
    usd_decimals: engine.usd_decimals,
    accounts: engine.before.accounts,
    before_eligible_accounts: engine.before.eligible_accounts,
    before_eligible_debt_usd: engine.before.eligible_debt_usd,
    before_bad_debt_usd: engine.before.bad_debt_usd,
    before_collateral_at_risk_usd: engine.before.collateral_at_risk_usd,
    total_debt_usd_before: engine.before.total_debt_usd,
    total_collateral_usd_before: engine.before.total_collateral_usd,
    ...figures,
  });
  const cashFigures = (after, delta, badDelta, flipped, dropped, collateralAfter, debtAfter, collateralAtRiskAfter) => ({
    after_eligible_accounts: after,
    eligible_accounts_delta: after - cashRun.before.eligible_accounts,
    flipped_to_eligible: flipped,
    hf_dropped_accounts: dropped,
    eligible_debt_delta_usd: delta,
    bad_debt_delta_usd: badDelta,
    after_collateral_at_risk_usd: collateralAtRiskAfter,
    total_debt_usd_after: debtAfter,
    total_collateral_usd_after: collateralAfter,
  });
  const results = scenarios.scenarios.map((def) => {
    const base = { ...templateResult, scenario_id: def.id, scenario_version: def.version, label: def.label, path_assumption: def.path_assumption, shocks: def.shocks, covered_engines: def.engines, withheld_engines: [], unmeasurable_engines: [] };
    const cashCovered = def.engines.includes(CASH);
    const legacyCovered = def.engines.includes(LEGACY);
    let engines = [];
    let shock_reach = def.shocks.length === 0 ? noShockReach : templateResult.shock_reach;
    if (def.id === "eth_minus_30") {
      engines = [
        summary(templateLegacy, legacyRun, cashFigures(legacyRun.after.eligible_accounts, legacyRun.eligible_debt_delta_usd, legacyRun.bad_debt_delta_usd, null, legacyRun.hf_transitions.lane_changed_rows, legacyRun.after.total_collateral_usd, legacyRun.after.total_debt_usd, legacyRun.after.collateral_at_risk_usd)),
        summary(templateCash, cashRun, cashFigures(cashRun.after.eligible_accounts, cashRun.eligible_debt_delta_usd, cashRun.bad_debt_delta_usd, cashRun.newly_eligible_accounts, cashRun.hf_transitions.lane_changed_rows, cashRun.after.total_collateral_usd, cashRun.after.total_debt_usd, cashRun.after.collateral_at_risk_usd)),
      ];
    } else if (def.id === "ethfi_minus_50") {
      engines = [summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts + 2, "9800000000", "1200000000", 2, 61, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd))];
    } else if (def.id === "weeth_market_depeg_oracles_held") {
      engines = [
        ...(legacyCovered ? [summary(templateLegacy, legacyRun, cashFigures(legacyRun.before.eligible_accounts, "0", "0", null, 0, legacyRun.before.total_collateral_usd, legacyRun.before.total_debt_usd, legacyRun.before.collateral_at_risk_usd))] : []),
        {
          ...summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts, "0", "0", 0, 0, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd)),
          market_realization: { hfs_unchanged: true, execution_shortfall_usd: "838000000000", bad_debt_at_liquidation_usd: "41020000000", usd_decimals: cashRun.usd_decimals, seizure_model: "pro-rata-over-counted-collateral", note: "oracle marks held exactly; the market price is 5 percent under redemption, so a liquidator realises less than the oracle value of the seized weETH" },
        },
      ];
    } else if (def.id === "dm_rate_horizon_plus_200bps") {
      const projection = runBookTemplate.engines.find((e) => e.projection !== null)?.projection ?? setTemplate.results.flatMap((r) => r.engines).find((e) => e.projection !== null)?.projection;
      if (!projection) throw new Error("no projection template on the contract fixtures; read openapi.yaml's Projection example and copy it here");
      engines = [{ ...summary(templateCash, cashRun, cashFigures(cashRun.before.eligible_accounts, "0", "0", null, 0, cashRun.before.total_collateral_usd, cashRun.before.total_debt_usd, cashRun.before.collateral_at_risk_usd)), projection }];
    }
    if (!cashCovered) engines = engines.filter((e) => e.engine !== CASH);
    return { ...base, engines, shock_reach, positions_answered: engines.reduce((n, e) => n + e.accounts, 0), positions_withheld: 0 };
  });
  return {
    ...setTemplate,
    served_at: SERVED_AT,
    batch: book.batch,
    evaluation: { ...setTemplate.evaluation, resolved_at: SERVED_AT, probed_at: SERVED_AT, scenarios_evaluated: results.length, freshness: "still_newest", newest_servable_batch_id: book.batch.id },
    scenario_config_version: scenarios.scenario_config_version,
    requested_scenario_ids: scenarios.scenarios.map((s) => s.id),
    results,
    excluded_engines: [],
    coverage: { ...setTemplate.coverage, batch_positions: book.batch.position_count, in_book: book.coverage.in_book, refused_in_batch: book.coverage.refused_in_batch, excluded_by_this_layer: 0, excluded: [], book_is_measurable: true },
  };
}

function writeChecked(name, body) {
  const report = checkClocks(body);
  if (report.violations.length > 0) throw new Error(`${name}: ${report.violations.join("; ")}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.trios ?? "?")} clock trios)`);
}

const runBook = runBookBody();
writeChecked("scenarios-demo.json", scenariosBody());
writeChecked("run-book-demo-eth_minus_30.json", runBook);
writeChecked("run-book-set-demo.json", setBody(runBook));
```

Read `tests/fixtures/clock-law.mjs`'s `checkClocks` return shape first (Plan 2's generator uses it at `generate-demo-inspector.mjs:395`) and match `writeChecked` to it exactly — the field names above (`violations`, `trios`) are the ones to confirm. `SetRunEngineSummary` and `SetRunScenarioResult` carry fields this generator does not set (`infinite_accounts`, `movement_excluded_accounts`, `refused_in_batch_positions`, `unrebuildable_positions`, `movement_rule`, `note`, `shock_reach`, `positions_*`): they ride from the template by spread — verify each templated value is TRUE for the demo (e.g. `movement_rule` per engine is the template's per engine; `infinite_accounts` is the from_rows infinite lane = 0; `refused_in_batch_positions` for Cash is 6) and override the ones that are not; list every override in the report. `collateral_by_asset` rides from the template verbatim; if its rows do not sum to the demo totals, push this note onto the body's `notes`: `"collateral_by_asset carries the contract example's rows and is not welded to the demo totals; the page does not read it"`.

- [ ] **Step 4: Generate, export, census**

Run: `cd web && node tests/fixtures/demo/generate-demo-lab.mjs`
Expected: three `wrote …` lines. Then append to `web/tests/fixtures/demo/index.ts`:

```ts
/** GENERATED by generate-demo-lab.mjs — see its provenance header. The run-book welds to the Book's eth_minus_30 waterfall. */
export const DEMO_SCENARIOS: Schemas["ScenariosResponse"] = load("scenarios-demo.json");
export const DEMO_RUN_BOOK_ETH: Schemas["RunBookResponse"] = load("run-book-demo-eth_minus_30.json");
export const DEMO_RUN_BOOK_SET: Schemas["RunBookSetResponse"] = load("run-book-set-demo.json");
```

Run: `cd web && npx playwright test --project=unit tests/unit/fixture-clock-law.spec.ts`
Expected: FAIL naming the three new files and the trio counts it found; add those three entries to `CENSUS` in `tests/unit/fixture-clock-law.spec.ts` with the counts the failure names and move `CENSUS_TOTAL` by their sum. Re-run: PASS.

- [ ] **Step 5: Run the weld to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/demo-lab-weld.spec.ts tests/unit/fixture-clock-law.spec.ts`
Expected: all passed. If the movers pin finds fewer than 20 crossing rows on page 1, read page 2 as well (`positions-dm-demo-page-2.json`) in the generator and the pin; never pad the list.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/fixtures/demo/generate-demo-lab.mjs web/tests/fixtures/demo/scenarios-demo.json web/tests/fixtures/demo/run-book-demo-eth_minus_30.json web/tests/fixtures/demo/run-book-set-demo.json web/tests/fixtures/demo/index.ts web/tests/unit/demo-lab-weld.spec.ts web/tests/unit/fixture-clock-law.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Scenarios demo dataset - generated, clock-law checked, the run-book welded to the demo Book's own eth_minus_30 waterfall and histogram" -- web/tests/fixtures/demo/generate-demo-lab.mjs web/tests/fixtures/demo/scenarios-demo.json web/tests/fixtures/demo/run-book-demo-eth_minus_30.json web/tests/fixtures/demo/run-book-set-demo.json web/tests/fixtures/demo/index.ts web/tests/unit/demo-lab-weld.spec.ts web/tests/unit/fixture-clock-law.spec.ts
```

---
