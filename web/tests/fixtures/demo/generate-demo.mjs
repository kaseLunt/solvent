// web/tests/fixtures/demo/generate-demo.mjs
// Realistic-scale DEMO dataset (spec 2026-09-15 §8) + PROVENANCE.
// Regenerate: node tests/fixtures/demo/generate-demo.mjs (from web/)
//
// Nothing here is hand-shaped wire data:
//   * envelopes (book, positions pages, meta) are the committed contract
//     fixtures book.json / positions-dm-page-1.json / meta.json with ONLY the
//     batch identity and the aggregate fields recomputed from the rows;
//   * every Cash row is positions-dm-page-1.json's canonical COMPUTED row
//     (positions[0]) or REFUSED row (positions[1]) with account, debt, cap
//     and collateral varied by a seeded PRNG; all other fields verbatim;
//   * a non-liquidatable row's liq_distance is the contract's `distance`
//     kind: the boundary price multiple at which cap falls to debt is the
//     exact rational debt/cap; its factor_asset is meta.json's chain-10 weETH
//     valuation witness (an Address, per contract) and factor_symbol its label;
//   * aggregates are SUMMED from the rows below, so the weld spec
//     (tests/unit/demo-fixture-weld.spec.ts) can prove them.
// Proportions are the design's assumptions (§8) until the hosted API reports
// the real split: 1,412 accounts · 49 liquidatable (2 material, 4 small,
// 43 dust) · 27 near cap · 6 refused · Σ debt ≈ $24.6M.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "..");
const read = (name) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));

const BATCH_ID = 18251;
const COMPUTED_AT = "2026-08-08T20:22:08Z";
const SERVED_AT = "2026-08-08T20:22:50Z";
const AGE_SECONDS = 42;
const DEC = 6; // Cash value_decimals
const USD = (dollars) => BigInt(Math.round(dollars * 1e6));

// mulberry32 — deterministic across runs and platforms.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(18251);
const between = (lo, hi) => lo + (hi - lo) * rand();
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const account = () => `0x${hex(40)}`;

const page1 = read("positions-dm-page-1.json");
const computedTemplate = page1.positions.find((p) => p.status === "computed");
const refusedTemplate = page1.positions.find((p) => p.status === "refused");
if (!computedTemplate || !refusedTemplate) throw new Error("positions-dm-page-1.json must carry one computed and one refused row");

// The Cash engine's factor asset: meta.json's chain-10 weETH price row (engine-exact, the DM's own valuation witness).
const meta = read("meta.json");
const factorWitness = meta.prices.find((p) => p.chain_id === 10 && p.symbol === "weETH");
if (!factorWitness) throw new Error("meta.json must carry the chain-10 weETH valuation witness");

/** A computed Cash row: debt, cap (maxBorrowLT) and collateral in 6-dec USD. cap/debt decide liquidatable. */
function computedRow(debtUsd, roomFraction) {
  const debt = USD(debtUsd);
  const cap = roomFraction >= 0 ? debt + USD(debtUsd * roomFraction) : debt - USD(debtUsd * -roomFraction);
  const collateral = (cap * 100n) / 40n; // cap ≈ 40% of collateral value
  const liquidatable = debt > cap;
  return {
    ...computedTemplate,
    account: account(),
    liquidatable,
    total_collateral: collateral.toString(),
    total_debt: debt.toString(),
    health_factor: { ...computedTemplate.health_factor, wad: null, num: cap.toString(), den: debt.toString(), infinite: false },
    liq_distance: liquidatable
      ? { kind: "breached", scale_factor_num: null, scale_factor_den: null, factor_asset: null, reason: null }
      : {
          ...computedTemplate.liq_distance,
          kind: "distance",
          scale_factor_num: debt.toString(),
          scale_factor_den: cap.toString(),
          factor_asset: factorWitness.asset,
          factor_symbol: factorWitness.symbol,
          reason: null,
        },
  };
}
function refusedRow() {
  return { ...refusedTemplate, account: account(), refusal: { ...refusedTemplate.refusal, code: "SWEEP_NEVER" } };
}

const rows = [];
// 2 material liquidatable, 4 small, 43 dust — room slightly negative.
rows.push(computedRow(4620, -0.04), computedRow(2220, -0.019));
for (let i = 0; i < 4; i += 1) rows.push(computedRow(between(2, 60), -between(0.01, 0.2)));
for (let i = 0; i < 43; i += 1) rows.push(computedRow(between(0.000001, 0.9), -between(0.01, 0.5)));
// 27 near cap: room 0.2%–9.9%, debts $900–$61,300.
for (let i = 0; i < 27; i += 1) rows.push(computedRow(between(900, 61300), between(0.002, 0.099)));
// 6 refused.
for (let i = 0; i < 6; i += 1) rows.push(refusedRow());
// The rest: 1,412 − 82 = 1,330 accounts, room 12%–80% of debt, log-ish debt sizes to land near $24.6M.
// (`roomFraction` is debt-relative; the client's near-cap rule is cap-relative, (cap − debt)/cap < 10%,
// i.e. r/(1+r) — a debt-relative draw below 1/9 would land in the 5–10% band, so the floor is 0.12 ≈ 10.7% of cap.)
for (let i = 0; i < 1330; i += 1) {
  const size = Math.exp(between(Math.log(300), Math.log(120000)));
  rows.push(computedRow(size, between(0.12, 0.8)));
}
// Server ordering for sort=headroom asc: breached first (most negative room), then rising room; refused last.
const roomTenths = (r) => (r.status !== "computed" ? null : ((BigInt(r.health_factor.num) - BigInt(r.health_factor.den)) * 1000n) / BigInt(r.health_factor.num));
rows.sort((a, b) => {
  const x = roomTenths(a);
  const y = roomTenths(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
});

const computed = rows.filter((r) => r.status === "computed");
const liquidatable = computed.filter((r) => r.liquidatable);
const sum = (list, key) => list.reduce((s, r) => s + BigInt(r[key]), 0n);
const totalDebt = sum(computed, "total_debt");
const totalCollateral = sum(computed, "total_collateral");
const eligibleDebt = sum(liquidatable, "total_debt");

// ---- positions pages (envelope from the committed page 1) ----
// Only the batch IDENTITY is overridden; each envelope keeps its own batch block (watermarks, supersession) verbatim.
const batchIdentity = { id: BATCH_ID, computed_at: COMPUTED_AT, age_seconds: AGE_SECONDS, position_count: 9964, refused_count: 6, flagged_count: 30 };
const batch = { ...page1.batch, ...batchIdentity };
const envelope = (positions, nextCursor) => ({ ...page1, served_at: SERVED_AT, batch, sort: "headroom", limit: 1000, total_positions: rows.length, positions, next_cursor: nextCursor });
writeFileSync(path.join(here, "positions-dm-demo-page-1.json"), JSON.stringify(envelope(rows.slice(0, 1000), "demo-cursor-2"), null, 2));
writeFileSync(path.join(here, "positions-dm-demo-page-2.json"), JSON.stringify(envelope(rows.slice(1000), null), null, 2));

// ---- book (envelope from the committed book.json; aggregates from the rows) ----
const book = read("book.json");
book.served_at = SERVED_AT;
book.batch = { ...book.batch, ...batchIdentity };
book.engines = book.engines.map((e) =>
  e.engine === "debt_manager"
    ? { ...e, positions: rows.length, computed_positions: computed.length, refused_positions: rows.length - computed.length, flagged_positions: 0, liquidatable_positions: liquidatable.length, total_collateral: totalCollateral.toString(), total_debt: totalDebt.toString(), refusals: [{ key: "SWEEP_NEVER", count: rows.length - computed.length }], flags: [] }
    : { ...e, positions: 8552, computed_positions: 8552, refused_positions: 0, flagged_positions: 30, liquidatable_positions: 46, total_collateral: "410000000000000", total_debt: "190000000000000", refusals: [], flags: [{ key: "stale_price", count: 30 }] },
);
book.bad_debt = book.bad_debt.map((b) =>
  b.engine === "debt_manager"
    ? { ...b, current_bad_debt_usd: "239603961", insolvent_positions: 1, eligible_positions: liquidatable.length, eligible_debt_usd: eligibleDebt.toString(), collateral_at_risk_usd: sum(liquidatable, "total_collateral").toString() }
    : { ...b, current_bad_debt_usd: "0", insolvent_positions: 0, eligible_positions: 46, eligible_debt_usd: "4600", collateral_at_risk_usd: "9100" },
);
// Legacy HF histogram: counts only, summing to 8,552, danger concentrated in the low buckets.
const legacyHist = book.hf_histogram.engines.find((e) => e.engine === "aave_v3_etherfi");
if (legacyHist) {
  const counts = [46, 12, 27, 318, 1204, 2890, 4055];
  legacyHist.buckets = legacyHist.buckets.map((bucket, i) => ({ ...bucket, count: counts[i] ?? 0 }));
  if (legacyHist.buckets.reduce((n, b) => n + b.count, 0) !== 8552) throw new Error("legacy histogram must sum to 8552 — adjust counts to the bucket count");
}
// Cash waterfall: the same eth_minus_30 grid, cumulative figures scaled to this book (monotone, so `monotonicity` stays "holds").
const cashCum = [
  { debt: eligibleDebt, acc: liquidatable.length, bad: 239603961n },
  { debt: eligibleDebt + USD(118000), acc: liquidatable.length + 9, bad: USD(1204) },
  { debt: eligibleDebt + USD(312000), acc: liquidatable.length + 27, bad: USD(8410) },
  { debt: eligibleDebt + USD(1280000), acc: liquidatable.length + 118, bad: USD(41020) },
  { debt: eligibleDebt + USD(2900000), acc: liquidatable.length + 252, bad: USD(118300) },
  { debt: eligibleDebt + USD(5100000), acc: liquidatable.length + 463, bad: USD(402000) },
];
book.waterfall.points = book.waterfall.points.map((point, i) => ({
  ...point,
  engines: point.engines.map((e) => {
    if (e.engine !== "debt_manager") return e;
    const c = cashCum[Math.min(i, cashCum.length - 1)];
    const prev = i === 0 ? c : cashCum[Math.min(i - 1, cashCum.length - 1)];
    return { ...e, newly_eligible_accounts: c.acc - (i === 0 ? 0 : prev.acc), cumulative_eligible_accounts: c.acc, cumulative_debt_eligible_usd: c.debt.toString(), cumulative_collateral_at_risk_usd: ((c.debt * 100n) / 40n).toString(), insolvent_if_liquidated_accounts: i === 0 ? 1 : 1 + i * 3, cumulative_bad_debt_usd: c.bad.toString() };
  }),
}));
book.coverage = { ...book.coverage, batch_positions: 9964, in_book: 9958, refused_in_batch: 6 };
writeFileSync(path.join(here, "book.demo.json"), JSON.stringify(book, null, 2));

// ---- meta (envelope from the committed meta.json; batch + real watermark heights) ----
meta.served_at = SERVED_AT;
meta.batch = { ...meta.batch, ...batchIdentity };
meta.watermark_vector = meta.watermark_vector.map((w) =>
  w.engine === "aave_v3_etherfi" || w.engine === "aave_param" ? { ...w, last_block: 25714690 } : w.engine === "debt_manager" ? { ...w, last_block: 155323444 } : w,
);
writeFileSync(path.join(here, "meta.demo.json"), JSON.stringify(meta, null, 2));
console.log(`wrote demo dataset: ${String(rows.length)} Cash rows · ${String(liquidatable.length)} liquidatable · Σ debt ${totalDebt.toString()} (6-dec)`);
