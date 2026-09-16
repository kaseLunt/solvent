// web/tests/fixtures/demo/generate-demo.mjs
// Realistic-scale DEMO dataset (spec 2026-09-15 §8) + PROVENANCE.
// Regenerate: node tests/fixtures/demo/generate-demo.mjs (from web/)
//
// Nothing here is hand-shaped wire data:
//   * envelopes (book, positions pages, meta) are the committed contract
//     fixtures book.json / positions-dm-page-1.json / meta.json with ONLY the
//     batch identity and the aggregate fields recomputed from the rows;
//   * every Cash row is positions-dm-page-1.json's canonical COMPUTED row
//     (positions[0]) with account, debt, cap and collateral varied by a seeded
//     PRNG, or its REFUSED row (positions[1]) with account and debt varied
//     (health_factor / total_collateral stay null: unknown, never zero); all
//     other fields verbatim;
//   * a non-liquidatable row's liq_distance is the contract's `distance`
//     kind: the boundary price multiple at which cap falls to debt is the
//     exact rational debt/cap; its factor_asset is meta.json's chain-10 weETH
//     valuation witness (an Address, per contract) and factor_symbol its label;
//   * rows are ordered by the EXACT rational (cap − debt)/cap, account as the
//     tie-break — the server's `sort=headroom asc` total order;
//   * every batch block's `watermarks` and meta's `watermark_vector` carry the
//     real riskd heights (aave_v3_etherfi / aave_param 25714690, debt_manager
//     155323444) — the same map applied by engine;
//   * aggregates are SUMMED from the rows below — engine card, bad debt, the
//     Cash hf_histogram (cap/debt as a wad bucketed on the template's own
//     edges), meta's sweep counters — so the weld spec
//     (tests/unit/demo-fixture-weld.spec.ts) can prove them. The legacy
//     engine's figures are design assumptions with their invariants checked
//     here (histogram Σ = positions, `< 1.00` = liquidatable_positions).
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
const USD = (dollars) => BigInt(Math.round(dollars * 1e6)); // Cash value_decimals = 6
const WAD = 10n ** 18n;
// Real riskd watermark heights, applied by engine to every batch block and the live vector.
const HEIGHTS = { aave_v3_etherfi: 25714690, aave_param: 25714690, debt_manager: 155323444 };
const atHeights = (watermarks) => watermarks.map((w) => (Object.hasOwn(HEIGHTS, w.engine) ? { ...w, last_block: HEIGHTS[w.engine] } : w));

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
/** A refused Cash row: borrowings are known (varied like the book's), collateral is of UNKNOWN size — null, never zero. */
function refusedRow() {
  const debt = USD(Math.exp(between(Math.log(300), Math.log(120000))));
  return { ...refusedTemplate, account: account(), total_debt: debt.toString(), refusal: { ...refusedTemplate.refusal, code: "SWEEP_NEVER" } };
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
  rows.push(computedRow(size, between(0.12, 2.4)));
}
// Server ordering for sort=headroom asc: least room first as the EXACT rational (cap − debt)/cap, compared by
// cross-multiplication (cap > 0 on every computed row); breached (negative) first, refused (no cap) last; equal
// room and refused rows fall back to `account`, so the order is total and no rounding can invert a pair.
const room = (r) =>
  r.status !== "computed" ? null : { num: BigInt(r.health_factor.num) - BigInt(r.health_factor.den), den: BigInt(r.health_factor.num) };
rows.sort((a, b) => {
  const x = room(a);
  const y = room(b);
  if (x !== null && y !== null) {
    const lhs = x.num * y.den;
    const rhs = y.num * x.den;
    if (lhs !== rhs) return lhs < rhs ? -1 : 1;
  } else if (x === null && y !== null) return 1;
  else if (x !== null && y === null) return -1;
  return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
});

const computed = rows.filter((r) => r.status === "computed");
const liquidatable = computed.filter((r) => r.liquidatable);
const sum = (list, key) => list.reduce((s, r) => s + BigInt(r[key]), 0n);
const totalDebt = sum(computed, "total_debt");
const totalCollateral = sum(computed, "total_collateral");
const eligibleDebt = sum(liquidatable, "total_debt");
const eligibleCollateral = sum(liquidatable, "total_collateral");
const refusedCount = rows.length - computed.length;

// ---- positions pages (envelope from the committed page 1) ----
// Only the batch IDENTITY and the watermark heights are overridden; each envelope keeps its own batch block otherwise.
const batchIdentity = { id: BATCH_ID, computed_at: COMPUTED_AT, age_seconds: AGE_SECONDS, position_count: 9964, refused_count: refusedCount, flagged_count: 30 };
const batchFor = (template) => ({ ...template, ...batchIdentity, watermarks: atHeights(template.watermarks) });
const batch = batchFor(page1.batch);
const envelope = (positions, nextCursor) => ({ ...page1, served_at: SERVED_AT, batch, sort: "headroom", limit: 1000, total_positions: rows.length, positions, next_cursor: nextCursor });
writeFileSync(path.join(here, "positions-dm-demo-page-1.json"), JSON.stringify(envelope(rows.slice(0, 1000), "demo-cursor-2"), null, 2));
writeFileSync(path.join(here, "positions-dm-demo-page-2.json"), JSON.stringify(envelope(rows.slice(1000), null), null, 2));

// ---- book (envelope from the committed book.json; aggregates from the rows) ----
const book = read("book.json");
book.served_at = SERVED_AT;
book.batch = batchFor(book.batch);
const LEGACY = { positions: 8552, liquidatable: 46, flagged: 30 };
book.engines = book.engines.map((e) =>
  e.engine === "debt_manager"
    ? { ...e, positions: rows.length, computed_positions: computed.length, refused_positions: refusedCount, flagged_positions: 0, liquidatable_positions: liquidatable.length, total_collateral: totalCollateral.toString(), total_debt: totalDebt.toString(), refusals: [{ key: "SWEEP_NEVER", count: refusedCount }], flags: [] }
    : { ...e, positions: LEGACY.positions, computed_positions: LEGACY.positions, refused_positions: 0, flagged_positions: LEGACY.flagged, liquidatable_positions: LEGACY.liquidatable, total_collateral: "410000000000000", total_debt: "190000000000000", refusals: [], flags: [{ key: "stale_price", count: LEGACY.flagged }] },
);
book.bad_debt = book.bad_debt.map((b) =>
  b.engine === "debt_manager"
    ? { ...b, current_bad_debt_usd: "239603961", insolvent_positions: 1, eligible_positions: liquidatable.length, eligible_debt_usd: eligibleDebt.toString(), collateral_at_risk_usd: eligibleCollateral.toString() }
    : { ...b, current_bad_debt_usd: "0", insolvent_positions: 0, eligible_positions: LEGACY.liquidatable, eligible_debt_usd: "4600", collateral_at_risk_usd: "9100" },
);
// Buckets are [lower_wad, upper_wad) with null-open ends (the template's note: strictly below 1e18 is eligible, exactly 1.00 is healthy).
const inBucket = (wad, b) => (b.lower_wad === null || wad >= BigInt(b.lower_wad)) && (b.upper_wad === null || wad < BigInt(b.upper_wad));
const bucketSum = (h) => h.buckets.reduce((n, b) => n + b.count, 0);
const belowOne = (h) => h.buckets.filter((b) => b.upper_wad !== null && BigInt(b.upper_wad) <= WAD).reduce((n, b) => n + b.count, 0);
// Legacy HF histogram: design counts per template bucket, danger concentrated low; the card's invariants are checked, not assumed:
// Σ = positions (nothing refused, nothing infinite) and the `< 1.00` buckets = liquidatable_positions (Aave liquidates strictly below 1e18).
const legacyHist = book.hf_histogram.engines.find((e) => e.engine === "aave_v3_etherfi");
if (!legacyHist) throw new Error("book.json must carry the legacy histogram");
{
  const counts = [40, 6, 27, 318, 1204, 2890, 4055, 12];
  if (counts.length !== legacyHist.buckets.length) throw new Error(`legacy histogram has ${String(legacyHist.buckets.length)} buckets — give it exactly that many counts`);
  legacyHist.buckets = legacyHist.buckets.map((bucket, i) => ({ ...bucket, count: counts[i] }));
  legacyHist.infinite_count = 0;
  legacyHist.refused_count = 0;
  if (bucketSum(legacyHist) !== LEGACY.positions) throw new Error("legacy histogram must sum to the legacy position count");
  if (belowOne(legacyHist) !== LEGACY.liquidatable) throw new Error("legacy histogram's `< 1.00` buckets must equal liquidatable_positions");
}
// Cash HF histogram: DERIVED from the rows — cap/debt as a wad (the template's comparator hf_num/hf_den), floored, on the template's edges.
const cashHist = book.hf_histogram.engines.find((e) => e.engine === "debt_manager");
if (!cashHist) throw new Error("book.json must carry the Cash histogram");
const ratioWad = (r) => (BigInt(r.health_factor.num) * WAD) / BigInt(r.health_factor.den);
cashHist.buckets = cashHist.buckets.map((bucket) => ({ ...bucket, count: computed.filter((r) => inBucket(ratioWad(r), bucket)).length }));
cashHist.infinite_count = 0;
cashHist.refused_count = refusedCount;
if (bucketSum(cashHist) !== computed.length) throw new Error("Cash histogram must place every computed row in exactly one bucket");
if (belowOne(cashHist) !== liquidatable.length) throw new Error("Cash histogram's `< 1.00` buckets must equal the liquidatable rows (debt > cap ⇔ cap/debt < 1)");
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
    // Point 0 is the book as it stands: collateral at risk is the liquidatable rows' own (= bad_debt.collateral_at_risk_usd).
    const atRisk = i === 0 ? eligibleCollateral : (c.debt * 100n) / 40n;
    return { ...e, newly_eligible_accounts: c.acc - (i === 0 ? 0 : prev.acc), cumulative_eligible_accounts: c.acc, cumulative_debt_eligible_usd: c.debt.toString(), cumulative_collateral_at_risk_usd: atRisk.toString(), insolvent_if_liquidated_accounts: i === 0 ? 1 : 1 + i * 3, cumulative_bad_debt_usd: c.bad.toString() };
  }),
}));
book.coverage = { ...book.coverage, batch_positions: 9964, in_book: 9964 - refusedCount, refused_in_batch: refusedCount };
writeFileSync(path.join(here, "book.demo.json"), JSON.stringify(book, null, 2));

// ---- meta (envelope from the committed meta.json; batch identity, real heights, sweep counters from the rows) ----
meta.served_at = SERVED_AT;
meta.batch = batchFor(meta.batch);
meta.watermark_vector = atHeights(meta.watermark_vector);
// SweepCounts partitions the sweep table's rows (template: 3 = 1 never_swept + 1 failed_since_success + 1 success):
// one row per Cash account, the refused ones never swept; `failed_since_success` keeps the template's figure.
meta.sweeps = meta.sweeps.map((s) =>
  s.engine === "debt_manager"
    ? { ...s, rows: rows.length, never_swept: refusedCount, success: rows.length - refusedCount - s.failed_since_success }
    : s,
);
meta.sweep_never_refusals_in_batch = refusedCount;
writeFileSync(path.join(here, "meta.demo.json"), JSON.stringify(meta, null, 2));
console.log(`wrote demo dataset: ${String(rows.length)} Cash rows · ${String(liquidatable.length)} liquidatable · Σ debt ${totalDebt.toString()} (6-dec)`);
