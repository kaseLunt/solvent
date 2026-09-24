// web/tests/fixtures/demo/generate-demo-lab.mjs
//
// PROVENANCE. The Scenarios demo dataset (spec 2026-09-15 §8; plan 3 R16),
// derived — never hand-shaped — from committed bodies.
// Regenerate: `node tests/fixtures/demo/generate-demo-lab.mjs` (from web/).
//
// Nothing here is hand-shaped wire data:
//   * scenarios-demo.json is the contract's committed set (../scenarios.json)
//     verbatim, stamped with the demo Book's clock;
//   * run-book-demo-eth_minus_30.json: the envelope, notes, applied shocks,
//     held-flat inputs, lane vocabulary and the two engines' notes are the
//     contract's own 200 example (../run-book.eth_minus_30.json), verbatim; the
//     Inspector demo's own ETHFI mark (stress-demo-near.json) joins the held-flat
//     list, so every demo surface holds the same marks flat; the batch and the
//     coverage census are the demo Book's (book.demo.json); the Cash engine's
//     BEFORE side is the demo Book (engine card, bad-debt entry, waterfall base
//     point, histogram) and its AFTER side is the demo Book's own eth_minus_30
//     waterfall point at factor 0.70 — so the page's figures are the Book's, to
//     the dollar; the lane movement is the plan's table (a −30 % mark scales the
//     Cash cap by 0.7: lanes 1.00–1.25 all cross, 18 of lane 1.25–1.50 cross,
//     the rest step down), and the table must cross exactly the count the
//     waterfall states newly eligible; cell debts allocate the engine's total
//     debt across the measured cells in proportion to rows (the exact remainder
//     on the largest cell) and do not move — Cash debt is USD — while the
//     not-measured cell carries the wire's null; the histograms are the
//     example's shape with the table's margins as counts, and the Book's
//     histogram must state those same edges and counts; the movers are the demo
//     pages' own computed, non-liquidatable rows that cross under ×0.7
//     (num×7 < den×10), ranked as the service ranks Cash movers — by debt,
//     largest first — the top 20 of them, and `movers_total` is
//     the Book's newly-eligible count: the two positions pages are the WHOLE
//     1,412-row Cash book and bucket to the Book's histogram exactly (asserted
//     before anything is read from them), but the Book's transition table, not
//     a naive re-shock of the rows, is the law for the crossings — a reader who
//     re-shocks every row by ×0.7 by hand finds 207 (asserted, so this sentence
//     cannot go stale), most of them from lane 1.25–1.50, where the table moves
//     18; the movers_note is the example's ranking rule with the service's
//     own truncation sentence; the legacy engine's before side is the Book's Aave card,
//     bad-debt entry and histogram and its after side steps each bucket one
//     lane down with 14 crossing (a design assumption, as the demo waterfall's
//     Aave arm is), its two deltas the contract example's own; the legacy
//     movers are not carried and `movers_total` is its newly-eligible count;
//     collateral_by_asset rides from the contract example and is NOT welded to
//     the demo totals — a note on the body says so;
//   * run-book-set-demo.json: the contract's set-run example's envelope,
//     evaluation, notes and engine-row notes (../run-book-set.json), re-clocked
//     to the demo Book, its coverage census summed from the Book's engine
//     cards, one result per committed scenario in listing order, each result's
//     engine rows exactly the definition's coverage; the eth_minus_30 rows ARE
//     the run-book above (the legacy movement count is its lane-changed rows,
//     the Cash flip count its crossings); every result note and every engine
//     note is the example's own sentence with the demo's identity, coverage and
//     denominator figures in place of the example's; the reach shapes are the
//     contract's own arms — eth_minus_30 the example's every_mark_moved reach,
//     the weETH depeg and the rate step the contract generator's
//     no_shocks_declared and projection_no_spot_pass reaches
//     (../run-book-set.no-denominator.json), ETHFI −50 % an every_mark_moved
//     reach over the Inspector demo's own ETHFI applied shock — and the mark
//     census every held-flat list is drawn from is the example's marks plus
//     that ETHFI mark, sorted as the contract sorts them; the three results the
//     Book cannot state carry design figures, stated once here:
//       ETHFI −50 %: +$9,800 of eligible debt and +$1,200 of bad debt, 2
//         accounts flip; collateral and collateral at risk are held (the Book
//         does not decompose collateral, so no ETHFI share can be derived);
//       the weETH depeg: no HF movement; a market realization DERIVED from the
//         Book under the definition's own 5 percent — the shortfall is 5 percent
//         of the collateral at risk (seized pro rata, realised 5 percent under
//         the oracle), the bad debt at liquidation is the eligible debt less the
//         seized collateral realised at 95 percent, never less than the bad debt
//         already on the book; the rule is proven against the contract's own
//         weETH example (../run-book.weeth_market_depeg_oracles_held.json: it
//         must reproduce that body's every block, 200000000 / 820000000 on its
//         Cash engine) before it is applied, and the block's seizure model and
//         sentence are that example's;
//       the rate step: no HF movement; a delta-only projection over the Cash
//         book's whole debt at the Inspector demo's horizons, observation block
//         and sentence (stress-demo-near.json), floor(debt × bps × t / year) —
//         the formula is proven against the Inspector's own horizons before it
//         is applied — with no per-account verdict stated (null, not false);
//   * every body passes checkClocks() before it is written, and the trio count
//     the law finds in each is pinned here so this generator and the census in
//     tests/unit/fixture-clock-law.spec.ts cannot disagree.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));
const fail = (why) => {
  throw new Error(why);
};
const must = (value, what) => value ?? fail(`${what} is missing`);

const book = read("book.demo.json");
const page1 = read("positions-dm-demo-page-1.json");
const page2 = read("positions-dm-demo-page-2.json");
const stressDemo = read("stress-demo-near.json");
const scenarios = readFixture("scenarios.json");
const runBookTemplate = readFixture("run-book.eth_minus_30.json");
const setTemplate = readFixture("run-book-set.json");
const setArms = readFixture("run-book-set.no-denominator.json");
const weethRunBook = readFixture("run-book.weeth_market_depeg_oracles_held.json");

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const SERVED_AT = book.served_at;
const engineCard = (id) => must(book.engines.find((e) => e.engine === id), `book.demo.json engine card ${id}`);
const badDebt = (id) => must(book.bad_debt.find((e) => e.engine === id), `book.demo.json bad_debt ${id}`);
const histogramOf = (id) => must(book.hf_histogram.engines.find((e) => e.engine === id), `book.demo.json histogram ${id}`);
const waterfallAt = (factor, id) =>
  must(must(book.waterfall.points.find((p) => p.factor === factor), `waterfall point ${factor}`).engines.find((e) => e.engine === id), `waterfall ${factor} ${id}`);
const templateEngine = (id) => must(runBookTemplate.engines.find((e) => e.engine === id), `run-book.eth_minus_30.json engine ${id}`);
const definitionOf = (id) => must(scenarios.scenarios.find((s) => s.id === id), `scenarios.json ${id}`);
const stressResult = (id) => must(stressDemo.scenarios.find((s) => s.id === id)?.results?.[0], `stress-demo-near.json ${id} result`);
const sameMark = (a, b) => a.chain_id === b.chain_id && a.asset.toLowerCase() === b.asset.toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- lanes ----------------------------------------------------------------
// The lane vocabulary is the contract's own (ten lanes: eight buckets, no-debt,
// not-measured), read from the example's Cash engine and required to be the
// same on its legacy engine; the Book's histogram buckets must be those lanes.
const LANES = templateEngine(CASH).hf_transitions.lanes;
if (!same(LANES, templateEngine(LEGACY).hf_transitions.lanes)) fail("the example's two engines state different lane vocabularies");
const INFINITE = LANES.findIndex((l) => l.kind === "infinite");
const UNMEASURED = LANES.findIndex((l) => l.kind === "unmeasured");
if (LANES.length !== 10 || INFINITE !== 8 || UNMEASURED !== 9) fail("the lane vocabulary is not eight buckets, no-debt, not-measured");

/**
 * table[from][to] = rows. Every margin, histogram count and total is summed
 * from it. Debt: the engine's total debt over the MEASURED cells in proportion
 * to rows, the exact remainder on the largest cell, the same on both sides;
 * the not-measured cell carries the wire's null.
 */
function transitionsOf(table, template, totalDebt, unmeasuredRefused) {
  const n = LANES.length;
  const from_rows = Array(n).fill(0);
  const to_rows = Array(n).fill(0);
  const cells = [];
  for (const [f, row] of Object.entries(table)) {
    for (const [t, rows] of Object.entries(row)) {
      const fi = Number(f);
      const ti = Number(t);
      if (!Number.isInteger(rows) || rows <= 0) fail(`table[${f}][${t}] = ${String(rows)} is not a positive row count`);
      if (fi < 0 || fi >= n || ti < 0 || ti >= n) fail(`table[${f}][${t}] names a lane outside the vocabulary`);
      if ((fi === UNMEASURED) !== (ti === UNMEASURED)) fail(`table[${f}][${t}]: no row enters or leaves the not-measured lane under a shock`);
      from_rows[fi] += rows;
      to_rows[ti] += rows;
      cells.push({ from: fi, to: ti, rows, debt: null });
    }
  }
  const measuredCells = cells.filter((c) => c.from !== UNMEASURED);
  const measuredRows = measuredCells.reduce((a, c) => a + c.rows, 0);
  if (measuredRows === 0) fail("the table measures no row");
  let allocated = 0n;
  let largest = measuredCells[0];
  for (const c of measuredCells) {
    c.debt = (totalDebt * BigInt(c.rows)) / BigInt(measuredRows);
    allocated += c.debt;
    if (c.rows > largest.rows) largest = c;
  }
  largest.debt += totalDebt - allocated;
  const held = measuredCells.filter((c) => c.from === c.to).reduce((a, c) => a + c.rows, 0);
  const total = from_rows.reduce((a, b) => a + b, 0);
  const unmeasured = from_rows[UNMEASURED];
  if (unmeasuredRefused > unmeasured) fail(`the card refuses ${String(unmeasuredRefused)} rows and the table holds ${String(unmeasured)} unmeasured`);
  const outflows = LANES.map((lane) => ({
    from: lane.index,
    cells: cells
      .filter((c) => c.from === lane.index)
      .sort((a, b) => a.to - b.to)
      .map((c) => ({
        to: c.to,
        rows: c.rows,
        debt_before_usd: c.debt === null ? null : c.debt.toString(),
        debt_after_usd: c.debt === null ? null : c.debt.toString(),
      })),
  }));
  return {
    comparator: template.hf_transitions.comparator,
    wad_scale: template.hf_transitions.wad_scale,
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
    lane_changed_rows: measuredRows - held,
    note: template.hf_transitions.note,
  };
}

/** Rows that moved from a healthy bucket (lane 2 up) into an eligible one (lanes 0–1): the table's crossings. */
const crossings = (t) => t.outflows.reduce((n, o) => n + (o.from >= 2 && o.from < INFINITE ? o.cells.filter((c) => c.to <= 1).reduce((m, c) => m + c.rows, 0) : 0), 0);

/** The example's histogram shape with the table's margin as counts; the Book's histogram must state the same edges. */
function histogramFromRows(template, bookHistogram, rows) {
  const edges = (h) => h.buckets.map((b) => [b.label, b.lower_wad, b.upper_wad]);
  if (!same(edges(template), edges(bookHistogram))) fail("the Book's histogram buckets are not the example's lanes");
  if (template.comparator !== bookHistogram.comparator) fail(`the Book states comparator ${bookHistogram.comparator} and the example ${template.comparator}`);
  return {
    ...template,
    buckets: template.buckets.map((b, i) => ({ ...b, count: rows[i] })),
    infinite_count: rows[INFINITE],
    refused_count: rows[UNMEASURED],
  };
}

/** The Book's histogram IS the table's before margin, lane for lane, tallies included. */
function weldHistogram(engine, hist, t) {
  if (!same(hist.buckets.map((b) => b.count), t.from_rows.slice(0, INFINITE))) fail(`the ${engine} table's from_rows must be the Book's histogram`);
  if (hist.infinite_count !== t.from_rows[INFINITE]) fail(`the ${engine} table's no-debt lane must be the Book's infinite_count`);
  if (hist.refused_count !== t.from_rows[UNMEASURED]) fail(`the ${engine} table's not-measured lane must be the Book's refused_count`);
}

/** The two positions pages ARE the whole Cash book: one row per position, bucketed exactly as the Book's histogram, tallies included. */
const PAGES = [...page1.positions, ...page2.positions];
function weldPages(card, hist) {
  if (PAGES.length !== card.positions || page1.total_positions !== card.positions || page2.next_cursor !== null) fail("the positions pages are not the whole Cash book");
  const WAD = 10n ** 18n;
  const counts = hist.buckets.map(() => 0);
  let infinite = 0;
  let refused = 0;
  for (const r of PAGES) {
    if (r.status !== "computed") {
      refused += 1;
      continue;
    }
    if (r.health_factor.infinite) {
      infinite += 1;
      continue;
    }
    const n = BigInt(r.health_factor.num);
    const d = BigInt(r.health_factor.den);
    const lane = hist.buckets.findIndex((b) => (b.lower_wad === null || n * WAD >= BigInt(b.lower_wad) * d) && (b.upper_wad === null || n * WAD < BigInt(b.upper_wad) * d));
    if (lane < 0) fail(`a page row's ratio ${n.toString()}/${d.toString()} falls in no bucket`);
    counts[lane] += 1;
  }
  if (!same(counts, hist.buckets.map((b) => b.count)) || infinite !== hist.infinite_count || refused !== hist.refused_count) fail("the positions pages do not bucket to the Book's histogram");
}
/** What a reader re-shocking every page row by ×0.7 by hand finds crossing; stated in the header, so pinned here. */
const NAIVE_CROSSINGS = 207;

/** The Book's engine card IS the table's row census. */
function weldCard(engine, card, t) {
  if (card.positions !== t.total_rows) fail(`${engine}: the card holds ${String(card.positions)} positions and the table ${String(t.total_rows)} rows`);
  if (card.computed_positions !== t.measured_rows) fail(`${engine}: the card computed ${String(card.computed_positions)} and the table measured ${String(t.measured_rows)}`);
  if (card.refused_positions !== t.unmeasured_rows) fail(`${engine}: the card refused ${String(card.refused_positions)} and the table left ${String(t.unmeasured_rows)} unmeasured`);
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
const MOVERS_CARRIED = 20;

function cashEngine() {
  const card = engineCard(CASH);
  const hist = histogramOf(CASH);
  const bad = badDebt(CASH);
  const base = waterfallAt("1000000000000000000", CASH);
  const shocked = waterfallAt("700000000000000000", CASH);
  const template = templateEngine(CASH);
  const t = transitionsOf(CASH_TABLE, template, BigInt(card.total_debt), card.refused_positions);
  weldHistogram(CASH, hist, t);
  weldCard(CASH, card, t);
  // The Book's three statements of today's eligible set agree before any is copied.
  if (card.liquidatable_positions !== base.cumulative_eligible_accounts || bad.eligible_positions !== base.cumulative_eligible_accounts) fail("the Book's Cash card, bad-debt entry and waterfall base disagree on the eligible set");
  if (bad.eligible_debt_usd !== base.cumulative_debt_eligible_usd || bad.collateral_at_risk_usd !== base.cumulative_collateral_at_risk_usd || bad.current_bad_debt_usd !== base.cumulative_bad_debt_usd) {
    fail("the Book's Cash bad-debt entry and waterfall base disagree on today's figures");
  }
  const newly = shocked.cumulative_eligible_accounts - base.cumulative_eligible_accounts;
  if (crossings(t) !== newly) fail(`the plan's table crosses ${String(crossings(t))} rows and the Book's waterfall states ${String(newly)} newly eligible at 0.70`);
  if (t.to_rows[0] + t.to_rows[1] !== shocked.cumulative_eligible_accounts) fail("the table's after side does not hold the waterfall's eligible set at 0.70");
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: base.cumulative_eligible_accounts,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: base.cumulative_debt_eligible_usd,
    collateral_at_risk_usd: base.cumulative_collateral_at_risk_usd,
    bad_debt_usd: base.cumulative_bad_debt_usd,
    hf_histogram: histogramFromRows(template.before.hf_histogram, hist, t.from_rows),
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
    hf_histogram: histogramFromRows(template.after.hf_histogram, hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  // Movers: the whole book's computed, non-liquidatable rows that cross under
  // ×0.7, ranked as the service ranks Cash movers — by debt, largest first
  // (cmd/api/p5_runbook.go runBookMoversNote), account ascending on a tie.
  // The table above, not this re-shock, is the law for how many cross.
  weldPages(card, hist);
  const crossing = PAGES.filter((p) => p.status === "computed" && p.liquidatable === false && p.health_factor.num !== null && p.health_factor.den !== null)
    .filter((p) => BigInt(p.health_factor.num) * 7n < BigInt(p.health_factor.den) * 10n)
    .map((p) => ({ p, debt: BigInt(p.total_debt) }))
    .sort((a, b) => (a.debt > b.debt ? -1 : a.debt < b.debt ? 1 : a.p.account.localeCompare(b.p.account)));
  if (crossing.length !== NAIVE_CROSSINGS) fail(`${String(crossing.length)} page rows cross under a naive ×0.7 and the header states ${String(NAIVE_CROSSINGS)}; restate it`);
  if (crossing.length < MOVERS_CARRIED) fail(`only ${String(crossing.length)} rows cross under ×0.7; never pad the list`);
  const movers = crossing.slice(0, MOVERS_CARRIED).map(({ p }) => ({
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
  // The example's movers_note states the service's debt ranking (kept: this demo
  // ranks the same way) and a complete list; the demo carries 20 of the Book's
  // newly eligible, so the carry sentence becomes the service's own truncation.
  const ranking = "ranked by their debt in this engine's 6-decimal USD, largest first";
  const carries = /`movers` carries all \d+ of them\.$/;
  if (!template.movers_note.includes(ranking) || !carries.test(template.movers_note)) fail("the example's Cash movers_note no longer states the ranking and the carry sentence this generator restates");
  const movers_note = template.movers_note.replace(
    carries,
    `\`movers\` is TRUNCATED to the top ${String(movers.length)} of ${String(newly)}; \`movers_total\` is the full count and the other ${String(newly - movers.length)} are not on this page.`,
  );
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
    movers_note,
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
  const t = transitionsOf(LEGACY_TABLE, template, BigInt(card.total_debt), card.refused_positions);
  weldHistogram(LEGACY, hist, t);
  weldCard(LEGACY, card, t);
  if (bad.eligible_positions !== card.liquidatable_positions) fail("the Book's Aave card and bad-debt entry disagree on the eligible set");
  const newly = crossings(t);
  const eligibleDebtDelta = BigInt(template.eligible_debt_delta_usd); // the contract example's own delta
  const badDebtDelta = BigInt(template.bad_debt_delta_usd); // the contract example's own delta
  const before = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions,
    total_collateral_usd: String(card.total_collateral),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: bad.eligible_debt_usd,
    collateral_at_risk_usd: bad.collateral_at_risk_usd,
    bad_debt_usd: bad.current_bad_debt_usd,
    hf_histogram: histogramFromRows(template.before.hf_histogram, hist, t.from_rows),
    collateral_by_asset: template.before.collateral_by_asset,
  };
  const after = {
    accounts: card.computed_positions,
    eligible_accounts: card.liquidatable_positions + newly,
    total_collateral_usd: ((BigInt(card.total_collateral) * 7n) / 10n).toString(),
    total_debt_usd: String(card.total_debt),
    eligible_debt_usd: (BigInt(bad.eligible_debt_usd) + eligibleDebtDelta).toString(),
    collateral_at_risk_usd: ((BigInt(bad.collateral_at_risk_usd) * 7n) / 10n).toString(),
    bad_debt_usd: (BigInt(bad.current_bad_debt_usd) + badDebtDelta).toString(),
    hf_histogram: histogramFromRows(template.after.hf_histogram, hist, t.to_rows),
    collateral_by_asset: template.after.collateral_by_asset,
  };
  if (after.eligible_accounts !== t.to_rows[0] + t.to_rows[1]) fail("the legacy table's after side does not hold the eligible set it states");
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
const ETH_DEF = definitionOf("eth_minus_30");
const COLLATERAL_NOTE = "collateral_by_asset carries the contract example's rows and is not welded to the demo totals; the page does not read it";

function scenariosBody() {
  return { ...scenarios, served_at: SERVED_AT };
}

function runBookBody() {
  const legacy = legacyEngine();
  const cash = cashEngine();
  const counted = (side) => side.collateral_by_asset.filter((r) => !r.unpriced).reduce((s, r) => s + BigInt(r.value_usd), 0n);
  const welded = [legacy, cash].every((e) => [e.before, e.after].every((side) => counted(side) === BigInt(side.total_collateral_usd)));
  const notes = welded ? runBookTemplate.notes : [...runBookTemplate.notes, COLLATERAL_NOTE];
  const held_flat = [...runBookTemplate.held_flat];
  for (const h of stressResult("eth_minus_30").held_flat) if (!held_flat.some((x) => sameMark(x, h))) held_flat.push(h);
  for (const a of runBookTemplate.applied_shocks) if (held_flat.some((h) => sameMark(h, a))) fail("a mark is both applied and held flat");
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
    held_flat,
    engines: [legacy, cash],
    excluded_engines: [],
    coverage: book.coverage,
    notes,
  };
}

// ---- the set run --------------------------------------------------------------
const ETHFI_DESIGN = { flips: 2, eligibleDebtDelta: 9_800_000_000n, badDebtDelta: 1_200_000_000n }; // Cash's 6-decimal USD: +$9,800, +$1,200
const YEAR_SECONDS = 31_536_000n;

/** The example's marks plus the Inspector demo's ETHFI mark, deduplicated on (chain, address) and sorted as the contract sorts them. */
function markCensus(templateReach) {
  const marks = [];
  for (const m of [...templateReach.applied_shocks, ...templateReach.held_flat_assets, ...stressResult("ethfi_minus_50").applied_shocks]) {
    if (!marks.some((x) => sameMark(x, m))) marks.push({ chain_id: m.chain_id, asset: m.asset });
  }
  return marks.sort((a, b) => a.chain_id - b.chain_id || a.asset.toLowerCase().localeCompare(b.asset.toLowerCase()));
}

/** The reach a set-run result carries under its arm, over the demo's mark census. */
function reachOf(def, templateResult, marks) {
  const example = templateResult.shock_reach;
  const heldBeside = (applied, chains) => marks.filter((m) => chains.includes(m.chain_id) && !applied.some((a) => sameMark(a, m)));
  const withHeld = (reach, applied, chains) => {
    const held_flat_assets = heldBeside(applied, chains);
    return { ...reach, held_flat_assets, held_flat_marks: held_flat_assets.length };
  };
  const armOf = (id, arm) => {
    const r = must(setArms.results.find((x) => x.scenario_id === id), `run-book-set.no-denominator.json result ${id}`).shock_reach;
    if (r.reach !== arm) fail(`${id}'s contract reach is ${r.reach}, not ${arm}`);
    if (r.declared_shocks !== def.shocks.length || r.applied_shocks.length !== 0 || r.marks_moved !== 0) fail(`${id}'s contract reach is not a definition-level arm over an empty pass`);
    return r;
  };
  const chains = [...new Set(marks.map((m) => m.chain_id))];
  switch (def.id) {
    case "eth_minus_30":
      if (example.reach !== "every_mark_moved" || example.declared_shocks !== def.shocks.length) fail("the example's eth_minus_30 reach is no longer every_mark_moved over the definition's shocks");
      return withHeld(example, example.applied_shocks, chains);
    case "weeth_market_depeg_oracles_held":
      return withHeld(armOf(def.id, "no_shocks_declared"), [], chains);
    case "dm_rate_horizon_plus_200bps":
      return armOf(def.id, "projection_no_spot_pass");
    case "ethfi_minus_50": {
      const applied = stressResult(def.id).applied_shocks;
      const shock = must(def.shocks[0], "ethfi_minus_50's shock");
      if (applied.length !== 1 || def.shocks.length !== 1) fail("ethfi_minus_50 is not one declared shock over one applied mark");
      const row = applied[0];
      if (row.asset.toLowerCase() !== shock.asset.toLowerCase() || row.factor_num !== String(shock.factor_num) || row.factor_den !== String(shock.factor_den) || row.before === row.after) {
        fail("the Inspector demo's ETHFI applied shock is not the definition's own shock, moved");
      }
      const flags = (key) => applied.filter((a) => a[key] === true).length;
      const counted = /\(\d+ of \d+\)/;
      if (!counted.test(example.note)) fail("the example's every_mark_moved sentence no longer counts its marks");
      return withHeld(
        {
          ...example,
          declared_shocks: def.shocks.length,
          declared_shocks_at_identity: def.shocks.filter((s) => s.factor_num === s.factor_den).length,
          reach: "every_mark_moved",
          applied_shocks: applied,
          marks_moved: applied.length,
          marks_held_by_declared_factor: 0,
          marks_held_by_transform: 0,
          marks_held_by_arithmetic: 0,
          marks_snapped: flags("snapped"),
          marks_base_snapped: flags("base_snapped"),
          marks_cap_bound: flags("cap_bound"),
          note: example.note.replace(counted, `(${String(applied.length)} of ${String(applied.length)})`),
        },
        applied,
        [10],
      );
    }
    default:
      return fail(`no reach for ${def.id}: the committed set moved; design its result here`);
  }
}

/**
 * The weETH depeg's realization rule over one before side: the market is 5
 * percent under the oracle, so the seized collateral (pro rata) realises 5
 * percent less than its oracle value, and the bad debt at liquidation is the
 * eligible debt less the seized collateral realised at 95 percent, never less
 * than the bad debt already on the book.
 */
const DEPEG_BPS = 500n;
function realizationFigures(before) {
  const car = BigInt(before.collateral_at_risk_usd);
  const shortfall = (car * DEPEG_BPS) / 10_000n;
  const uncovered = BigInt(before.eligible_debt_usd) - (car - shortfall);
  const current = BigInt(before.bad_debt_usd);
  return { shortfall, atLiquidation: uncovered > current ? uncovered : current };
}
// The rule is the contract's: it must reproduce every realization block of the
// contract's own weETH example from that body's before sides before it is applied.
for (const e of weethRunBook.engines) {
  const contract = must(e.market_realization, `run-book.weeth_market_depeg_oracles_held.json ${e.engine} market_realization`);
  const figures = realizationFigures(e.before);
  if (figures.shortfall.toString() !== contract.execution_shortfall_usd || figures.atLiquidation.toString() !== contract.bad_debt_at_liquidation_usd) {
    fail(`the realization rule does not reproduce the contract's weETH example on ${e.engine} (${contract.execution_shortfall_usd} / ${contract.bad_debt_at_liquidation_usd})`);
  }
}

/** The market realization the weETH depeg states on one engine, derived from the Book's own figures under the definition's 5 percent. */
function realizationOf(def, engine) {
  if (!def.description.includes("5 percent below")) fail("the weETH depeg no longer states its 5 percent; re-derive the realization");
  const contract = must(weethRunBook.engines.find((e) => e.engine === engine.engine)?.market_realization, `run-book.weeth_market_depeg_oracles_held.json ${engine.engine} market_realization`);
  const figures = realizationFigures(engine.before);
  return {
    hfs_unchanged: true,
    execution_shortfall_usd: figures.shortfall.toString(),
    bad_debt_at_liquidation_usd: figures.atLiquidation.toString(),
    usd_decimals: engine.usd_decimals,
    seizure_model: contract.seizure_model,
    note: contract.note,
  };
}

/** The delta-only projection over the whole Cash book: the Inspector demo's horizons, block and sentence; its formula proven against the Inspector's own figures first. */
function projectionOf(engine) {
  const template = must(stressResult("dm_rate_horizon_plus_200bps").projection, "stress-demo-near.json rate projection");
  const dm = must(book.batch.watermarks.find((w) => w.engine === CASH), "book.demo.json debt_manager watermark");
  if (template.apy_observed_at_block !== dm.last_block) fail("the Inspector demo observes the APY at a block that is not the Book's debt_manager watermark");
  const bps = BigInt(template.annual_delta_bps);
  const interestOn = (debt, seconds) => (debt * bps * BigInt(seconds)) / (10_000n * YEAR_SECONDS);
  for (const h of template.horizons) {
    if (interestOn(BigInt(h.debt_usd), h.horizon_seconds) !== BigInt(h.additional_interest_usd)) fail("the Inspector demo's projection is not floor(debt × bps × t / year); re-derive this one");
  }
  const debt = BigInt(engine.before.total_debt_usd);
  return {
    ...template,
    horizons: template.horizons.map((h) => {
      const interest = interestOn(debt, h.horizon_seconds);
      return { horizon_seconds: h.horizon_seconds, debt_usd: debt.toString(), projected_usd: (debt + interest).toString(), additional_interest_usd: interest.toString(), becomes_liquidatable: null };
    }),
  };
}

function setBody(runBook) {
  const cashRun = must(runBook.engines.find((e) => e.engine === CASH), "the run-book's Cash engine");
  const legacyRun = must(runBook.engines.find((e) => e.engine === LEGACY), "the run-book's legacy engine");
  const templateResult = must(setTemplate.results.find((r) => r.scenario_id === "eth_minus_30"), "run-book-set.json eth_minus_30");
  const templateCash = must(templateResult.engines.find((e) => e.engine === CASH), "run-book-set.json Cash row");
  const templateLegacy = must(templateResult.engines.find((e) => e.engine === LEGACY), "run-book-set.json legacy row");
  const marks = markCensus(templateResult.shock_reach);

  // The example's own sentences, with the demo's figures in place of the example's.
  const identityOf = (note) => must(/^(IDENTITY: this result is scenario )(\S+)( at version )(\S+)(, under the envelope's [^]*?is being read wrong\.)/.exec(note), "the example's IDENTITY sentence");
  const identity = identityOf(templateResult.note);
  const identitySentence = (def) => `${identity[1]}${def.id}${identity[3]}${def.version}${identity[5]}`;
  const uncovered = must(setTemplate.results.find((r) => !r.covered_engines.includes(LEGACY)), "an example result that does not cover the legacy engine");
  const notCovered = must(/NOT COVERED: (\S+) carry rows in this batch[^]*?never withholding\./.exec(uncovered.note), "the example's NOT COVERED sentence");
  if (notCovered[1] !== LEGACY) fail("the example's NOT COVERED sentence names an engine this generator does not restate");
  const resultNote = (def, reach) => `${identitySentence(def)} ${def.engines.includes(LEGACY) ? "" : `${notCovered[0]} `}SHOCK REACH: ${reach.note}`;
  // Proven the server's composition: both example notes re-compose from their parts.
  if (resultNote(ETH_DEF, templateResult.shock_reach) !== templateResult.note) fail("the example's eth_minus_30 note is not IDENTITY + SHOCK REACH");
  const uncoveredDef = { id: uncovered.scenario_id, version: uncovered.scenario_version, engines: uncovered.covered_engines };
  if (resultNote(uncoveredDef, uncovered.shock_reach) !== uncovered.note) fail("the example's uncovered note is not IDENTITY + NOT COVERED + SHOCK REACH");
  const denominator = /\((\d+) minus (\d+) = (\d+)\)/;

  /** One engine's summary: the example's row shape and sentence, every figure the engine's, the sides `after` against the engine's before. */
  const summary = (template, engine, after, movement) => {
    if (template.engine !== engine.engine || !denominator.test(template.note)) fail(`the example's ${engine.engine} row no longer states the denominator sentence`);
    const accounts = engine.before.accounts;
    const infinite = engine.hf_transitions.from_rows[INFINITE];
    // Aave excludes no-debt accounts from its movement count; the Debt Manager only before-side rows with no after side, and this run measured every row on both sides.
    const excluded = engine.engine === LEGACY ? infinite : 0;
    return {
      ...template,
      engine: engine.engine,
      usd_decimals: engine.usd_decimals,
      accounts,
      infinite_accounts: infinite,
      movement_excluded_accounts: excluded,
      refused_in_batch_positions: engine.hf_transitions.unmeasured_refused_in_batch_rows,
      unrebuildable_positions: engine.hf_transitions.unmeasured_excluded_by_this_layer_rows,
      before_eligible_accounts: engine.before.eligible_accounts,
      after_eligible_accounts: after.eligible_accounts,
      eligible_accounts_delta: after.eligible_accounts - engine.before.eligible_accounts,
      ...(engine.engine === CASH ? { flipped_to_eligible: movement, hf_dropped_accounts: null } : { flipped_to_eligible: null, hf_dropped_accounts: movement }),
      before_eligible_debt_usd: engine.before.eligible_debt_usd,
      eligible_debt_delta_usd: (BigInt(after.eligible_debt_usd) - BigInt(engine.before.eligible_debt_usd)).toString(),
      before_bad_debt_usd: engine.before.bad_debt_usd,
      bad_debt_delta_usd: (BigInt(after.bad_debt_usd) - BigInt(engine.before.bad_debt_usd)).toString(),
      before_collateral_at_risk_usd: engine.before.collateral_at_risk_usd,
      after_collateral_at_risk_usd: after.collateral_at_risk_usd,
      total_debt_usd_before: engine.before.total_debt_usd,
      total_debt_usd_after: after.total_debt_usd,
      total_collateral_usd_before: engine.before.total_collateral_usd,
      total_collateral_usd_after: after.total_collateral_usd,
      market_realization: null,
      projection: null,
      note: template.note.replace(denominator, `(${String(accounts)} minus ${String(excluded)} = ${String(accounts - excluded)})`),
    };
  };
  const unshocked = (template, engine) => summary(template, engine, engine.before, 0);

  const results = scenarios.scenarios.map((def) => {
    const reach = reachOf(def, templateResult, marks);
    let engines;
    switch (def.id) {
      case "eth_minus_30":
        engines = [summary(templateLegacy, legacyRun, legacyRun.after, legacyRun.hf_transitions.lane_changed_rows), summary(templateCash, cashRun, cashRun.after, crossings(cashRun.hf_transitions))];
        break;
      case "ethfi_minus_50":
        engines = [
          summary(
            templateCash,
            cashRun,
            {
              ...cashRun.before,
              eligible_accounts: cashRun.before.eligible_accounts + ETHFI_DESIGN.flips,
              eligible_debt_usd: (BigInt(cashRun.before.eligible_debt_usd) + ETHFI_DESIGN.eligibleDebtDelta).toString(),
              bad_debt_usd: (BigInt(cashRun.before.bad_debt_usd) + ETHFI_DESIGN.badDebtDelta).toString(),
            },
            ETHFI_DESIGN.flips,
          ),
        ];
        break;
      case "weeth_market_depeg_oracles_held":
        engines = [legacyRun, cashRun].map((engine) => ({ ...unshocked(engine.engine === CASH ? templateCash : templateLegacy, engine), market_realization: realizationOf(def, engine) }));
        break;
      case "dm_rate_horizon_plus_200bps":
        engines = [{ ...unshocked(templateCash, cashRun), projection: projectionOf(cashRun) }];
        break;
      default:
        fail(`no design for ${def.id}: the committed set moved`);
    }
    engines = engines.filter((e) => def.engines.includes(e.engine));
    if (!same(engines.map((e) => e.engine).sort(), [...def.engines].sort())) fail(`${def.id}: the engine rows do not partition the definition's coverage`);
    const result = {
      scenario_id: def.id,
      scenario_version: def.version,
      label: def.label,
      path_assumption: def.path_assumption,
      shocks: def.shocks,
      shock_reach: reach,
      covered_engines: def.engines,
      withheld_engines: [],
      unmeasurable_engines: [],
      engines,
      positions_answered: engines.reduce((n, e) => n + e.accounts, 0),
      positions_withheld: 0,
      note: resultNote(def, reach),
    };
    if (!same(Object.keys(result).sort(), Object.keys(templateResult).sort())) fail("a demo result does not carry the example's exact keys");
    return result;
  });

  // The batch census, summed from the Book's engine cards; the three classes partition the batch exactly.
  const coverageEngines = book.engines.map((card) => ({
    engine: card.engine,
    positions_in_batch: card.positions,
    measurable: card.computed_positions,
    refused_in_batch: card.refused_positions,
    unrebuildable: 0,
    withheld: card.refused,
  }));
  const sum = (key) => coverageEngines.reduce((n, e) => n + e[key], 0);
  if (sum("positions_in_batch") !== book.batch.position_count || sum("measurable") !== book.coverage.in_book || sum("refused_in_batch") !== book.coverage.refused_in_batch) {
    fail("the Book's engine cards do not sum to its batch and coverage");
  }
  if (book.coverage.in_book + book.coverage.refused_in_batch + book.coverage.excluded_by_this_layer !== book.batch.position_count) fail("the Book's coverage does not partition its batch");
  const evaluationNote = setTemplate.evaluation.note.replace(/^Batch \d+ /, `Batch ${String(book.batch.id)} `);
  if (evaluationNote === setTemplate.evaluation.note) fail("the example's evaluation note no longer opens with its batch id");
  return {
    ...setTemplate,
    served_at: SERVED_AT,
    batch: book.batch,
    evaluation: {
      ...setTemplate.evaluation,
      resolved_at: SERVED_AT,
      probed_at: SERVED_AT,
      scenarios_evaluated: results.length,
      freshness: "still_newest",
      newest_servable_batch_id: book.batch.id,
      note: evaluationNote,
    },
    scenario_config_version: scenarios.scenario_config_version,
    requested_scenario_ids: scenarios.scenarios.map((s) => s.id),
    results,
    excluded_engines: [],
    coverage: {
      ...setTemplate.coverage,
      batch_positions: book.batch.position_count,
      in_book: book.coverage.in_book,
      refused_in_batch: book.coverage.refused_in_batch,
      excluded_by_this_layer: book.coverage.excluded_by_this_layer,
      excluded: book.coverage.excluded,
      book_is_measurable: true,
      engines: coverageEngines,
    },
  };
}

// ---- write, under the clock law -------------------------------------------------
/** The trios the law resolves in each body: the batch's age over computed_at and the debt_manager sweep's over max_updated_at; a listing carries no clock. */
const CLOCK_TRIOS = { "scenarios-demo.json": 0, "run-book-demo-eth_minus_30.json": 2, "run-book-set-demo.json": 2 };

function writeChecked(name, body) {
  const report = checkClocks(body);
  if (report.failures.length > 0) fail(`${name} violates the clock law:\n${report.failures.join("\n")}`);
  if (report.checked !== CLOCK_TRIOS[name]) fail(`${name}: the law checked ${String(report.checked)} trios and this generator pins ${String(CLOCK_TRIOS[name])}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.checked)} clocks checked)`);
}

const runBook = runBookBody();
writeChecked("scenarios-demo.json", scenariosBody());
writeChecked("run-book-demo-eth_minus_30.json", runBook);
writeChecked("run-book-set-demo.json", setBody(runBook));
