// web/tests/fixtures/demo/generate-demo-secondary.mjs
//
// PROVENANCE. The History and Activity demo dataset (spec 2026-09-15 §8; plan 4
// Task 2, R9), derived — never hand-shaped — from committed bodies.
// Regenerate: `node tests/fixtures/demo/generate-demo-secondary.mjs` (from web/).
//
// Nothing here is hand-shaped wire data. Every figure names its source:
//   * THE CLOCK. served_at is the demo Book's (book.demo.json; meta.demo.json
//     must agree on the clock and the batch, asserted). The newest bucket is
//     the hour the Book's batch was computed in (computed_at 20:22:08Z, so the
//     20:00:00Z bucket); 168 hourly buckets walk back from it at the rollup's
//     native stride, so `from` is the oldest bucket and `to`/`step_seconds`
//     are the contract's nulls (every native bucket served).
//   * THE WELD. The newest bucket of each series IS the Book's engine card:
//     debt_usd = total_debt, collateral_usd = total_collateral, accounts =
//     positions, refused_positions and liquidatable_positions verbatim,
//     usd_decimals = value_decimals; batch_id = the Book's batch; last_block,
//     acked_epoch, max_epoch_at_compute and the sweep stamp = the Book's
//     watermark for the engine (the debt_manager sweep verbatim — its age 1205
//     is against the same served_at, re-derived here and asserted; the Aave
//     watermark's null sweep is the contract's "this engine has no sweeper"
//     state, served with sweep_recorded true). The weld is asserted before
//     anything is written.
//   * THE DRIFT (design figures: no history exists for the demo batch, so the
//     rule is the only source). debt, collateral and accounts each follow a
//     bounded walk in whole basis points around the Book's figure: offset(0)
//     = 0; offset(h) = offset(h−1) + step, the step drawn in [−40, +40] bps
//     (±0.4 percent an hour) by a glibc-constant LCG on BigInt seeded per
//     (engine, metric) and read from its high bits, reflected at ±800 bps;
//     value(h) = floor(book × (10000
//     + offset(h)) / 10000). So every bucket lands within 0.4 percent of the
//     Book's figure per hour of its neighbour, and the newest lands on the
//     Book exactly. liquidatable_positions is the Book's count L at the
//     newest bucket and L + ((7h + 1) mod 3) − 1 elsewhere — L − 1, L or
//     L + 1. refused_positions is the Book's on every captured bucket.
//   * THE HOLES. Hours 40 and 41 back carry NO point (no complete batch in the
//     bucket: the axis renders two absent buckets, never an interpolated
//     line); hour 90 back is WITHHELD: the point is present with refused
//     true, the contract example's own refusal code
//     (../observatory-series-dm.json's withheld point, FLAG_CUSTODY_UNPROVEN),
//     null totals, refused_positions 0 and no rates — the schema's exact
//     withheld shape. The walk advances through the holes, so neighbours
//     across a hole differ by up to one step per hour skipped.
//   * BATCHES AND BLOCKS. Bucket 1 observes the batch the Inspector demo's own
//     history (history-demo-near.json) computed last before the bucket
//     boundary — batch 18206 at 19:59:38Z — and that point's debt_manager
//     balances block, so the two demo surfaces agree where they overlap;
//     buckets 2..167 step 12 batches an hour below it (a five-minute batch
//     cadence: the history's own 30-second cadence over its 50 minutes would
//     run the ids out inside a week). Both engines observe the same batch per
//     bucket — a batch is cross-engine. last_block steps each chain's own
//     cadence: OP 1,800 blocks an hour (2-second blocks) below the history's
//     block from bucket 1; Ethereum 300 blocks an hour (12-second blocks) below
//     the Book's watermark from bucket 0 (no committed body states the Aave
//     watermark of batch 18206). The sweep stamp on older debt_manager buckets
//     is the Book's with max_updated_at shifted back by the bucket's offset
//     and age_seconds re-derived by the clock law's own ageSeconds(); rows,
//     failed, success_sum, generation and generation_open are verbatim.
//   * KEYS. materialization_key is sha256 over `solvent-demo:observatory:
//     <engine>:<batch_id>:<bucket_start>` — deterministic, 64 hex, never a
//     real materialization.
//   * RATES. One index row per captured bucket: the contract example's row
//     (../observatory-series-dm.json, points[0].rates[0]) with as_of_block =
//     last_block − 10 (the example's own trailing law) and the /v1/events
//     example's OP USDC as the asset (the contract example's rate row carries
//     the mainnet address on an OP engine; this generator does not copy that
//     onto the Debt Manager). The Aave row re-registers engine, kind and
//     scale to the pool's vocabulary (liquidity_index / ray-1e27), takes the
//     mainnet USDC from the Book's own waterfall held-flat mark, and carries
//     the example's 1.05 at ray scale. Older buckets unwind the index 5
//     percent a year, linear in hours (a design figure).
//   * THE FEED. One cross-engine page of GET /v1/events under the Book's
//     clock: envelope, defaulted filter and notes are the contract's own 200
//     example (../feed-cross-page-1.json IS that example); limit 50. 48 timed
//     rows newest first by block_time — each row's offset behind served_at
//     grows by a draw in [20, 400] seconds, so the page spans a few hours —
//     then a disclosed untimed tail of two (block_time null; chain_id DESC,
//     the OP row before the ETH row; their heights sit below every timed row
//     of their engine — a header backfill that has not reached them; the
//     tail's types are a Debt Manager repay and an Aave borrow). Heights step
//     down from the Book's watermarks at each chain's block cadence (12 s /
//     2 s); the chain ids are the example rows' and must be the Book's
//     watermark chain for the engine. The display vocabulary is read from
//     api/openapi.yaml's EventDisplayType enum (the generator fails if the
//     enum cannot be read) and every class is drawn (asserted); each row's
//     raw_type and amount_unit are internal/store/p5_events.go's
//     classification maps for its engine, pinned here (the collateral toggle
//     names are internal/store/collateralflags.go's constants). Debt Manager
//     accounts are the demo positions pages' own (liquidation rows: liquidatable
//     rows; every other row: computed, non-liquidatable rows by stride); the
//     demo has no Aave positions, so Aave accounts are sha256-derived
//     addresses, never real. tx hashes are sha256 over
//     `solvent-demo:feed:<chain>:<block>:<log_index>`. Amounts: a nominal in
//     dollars and cents drawn in [50.00, 25000.00] at 6 decimals, then carried
//     in the engine's accounting unit at the series' newest index 1.05 — the
//     USD-6 view of a normalized amount is value × index ÷ 1e18, and the
//     scaled Aave unit is the same division — so the wire carries
//     floor(nominal × 1e18 / index); repays, liquidations and write-offs are
//     negative on the debt side. Supply, withdraw and the collateral toggles
//     are record-only (unit none, amount null) — the store's own
//     classification. Exactly three liquidations: two Debt Manager rows whose
//     accounts are distinct liquidatable demo positions, before_debt_usd = the
//     position's total_debt and debt_repaid = half of it (the Book's own
//     eligibility note: "the Debt Manager closes in two passes, 50% then
//     remainder"), one seized weETH leg at the meta's chain-10 weETH witness
//     price with the bonus ../feed-liquidations.json's Debt Manager row states
//     in the contract's 100e18 denomination, interest_index the series' index,
//     debt_asset / deficit_paired / configured / realized bps null (the
//     schema: DM debt is USD-valued, the engine has no deficit pairing, and its
//     bonus denomination is not bps), the liquidator sha256-derived; one Aave
//     row carrying the contract example's own extract verbatim — repaid
//     $2,500, configured 500 bps, the seized weETH leg, the liquidator — except
//     deficit_paired true, because the deficit_created row that shares its
//     transaction follows at the next log index and serves first in DESC
//     order; the write-off's amount is a design figure ($180 of the account's
//     remaining debt, scaled).
//   * every body passes checkClocks() before it is written, and the trio count
//     the law finds in each is pinned in CLOCK_TRIOS so this generator and the
//     census in tests/unit/fixture-clock-law.spec.ts cannot disagree: every
//     debt_manager point carries the sweep stamp (one trio each, the withheld
//     point included — the stamp is capture-time evidence), the Aave series
//     has no sweeper, and the feed page carries no clock.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageSeconds, checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));
const fail = (why) => {
  throw new Error(why);
};
const must = (value, what) => value ?? fail(`${what} is missing`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const s = (v) => v.toString();
const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");
const sha = (seed) => createHash("sha256").update(`solvent-demo:${seed}`).digest("hex");

const book = read("book.demo.json");
const meta = read("meta.demo.json");
const history = read("history-demo-near.json");
const page1 = read("positions-dm-demo-page-1.json");
const page2 = read("positions-dm-demo-page-2.json");
const seriesExample = readFixture("observatory-series-dm.json"); // the contract's own GET /v1/observatory/series 200 example
const feedExample = readFixture("feed-cross-page-1.json"); // the contract's own GET /v1/events 200 example
const liquidationsExample = readFixture("feed-liquidations.json");
const contractText = readFileSync(path.join(here, "..", "..", "..", "..", "api", "openapi.yaml"), "utf8");

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const SERVED_AT = book.served_at;
if (meta.served_at !== SERVED_AT || meta.batch.id !== book.batch.id || meta.batch.computed_at !== book.batch.computed_at) {
  fail("meta.demo.json and book.demo.json disagree on the demo clock or batch");
}
const engineCard = (id) => must(book.engines.find((e) => e.engine === id), `book.demo.json engine card ${id}`);
const watermarkOf = (id) => must(book.batch.watermarks.find((w) => w.engine === id), `book.demo.json watermark ${id}`);

/**
 * glibc rand() constants on BigInt, seeded from the first 32 bits of a sha256
 * over the seed string. A draw is the state's HIGH 15 bits modulo n: a
 * power-of-two LCG's low bits cycle short (the lowest bit strictly
 * alternates), so drawing them would pattern every small-n choice.
 */
function lcg(seed) {
  let state = BigInt(parseInt(sha(seed).slice(0, 8), 16));
  return (n) => {
    state = (1103515245n * state + 12345n) % 2147483648n;
    return Number((state >> 16n) % BigInt(n));
  };
}

// ---- the series -----------------------------------------------------------------
const HOUR_MS = 3_600_000;
const HOURS = 168;
const ABSENT = new Set([40, 41]);
const WITHHELD = 90;
const newestBucketMs = Math.floor(Date.parse(book.batch.computed_at) / HOUR_MS) * HOUR_MS;
const bucketAt = (h) => iso(newestBucketMs - h * HOUR_MS);

const DRIFT_STEP_BPS = 40;
const DRIFT_CAP_BPS = 800;
/** offsets[h] in whole bps for h = 0..HOURS−1: a bounded walk from 0 (the newest bucket is the Book exactly). */
function walk(seed) {
  const draw = lcg(seed);
  const offsets = [0];
  for (let h = 1; h < HOURS; h += 1) {
    let next = offsets[h - 1] + draw(2 * DRIFT_STEP_BPS + 1) - DRIFT_STEP_BPS;
    if (next > DRIFT_CAP_BPS) next = 2 * DRIFT_CAP_BPS - next;
    if (next < -DRIFT_CAP_BPS) next = -2 * DRIFT_CAP_BPS - next;
    offsets.push(next);
  }
  return offsets;
}
const drifted = (bookValue, offsetBps) => (BigInt(bookValue) * BigInt(10_000 + offsetBps)) / 10_000n;

const BATCHES_PER_HOUR = 12;
const BLOCKS_PER_HOUR = { [LEGACY]: 300, [CASH]: 1800 }; // 12-second and 2-second blocks
const historyPoints = must(history.engines.find((e) => e.engine === CASH), "history-demo-near.json debt_manager series").points;
const priorBatch = historyPoints.filter((p) => p.computed_at < bucketAt(0)).sort((a, b) => b.batch_id - a.batch_id)[0];
if (priorBatch === undefined || priorBatch.batch_id >= book.batch.id || priorBatch.balances_block >= watermarkOf(CASH).last_block) {
  fail("history-demo-near.json carries no batch computed before the newest bucket, below the Book's");
}
if (priorBatch.batch_id - BATCHES_PER_HOUR * (HOURS - 2) <= 0) fail("the batch cadence runs the ids out inside the window");
const batchIdAt = (h) => (h === 0 ? book.batch.id : priorBatch.batch_id - BATCHES_PER_HOUR * (h - 1));
const lastBlockAt = (engine, h) => {
  if (h === 0) return watermarkOf(engine).last_block;
  if (engine === CASH) return priorBatch.balances_block - BLOCKS_PER_HOUR[CASH] * (h - 1);
  return watermarkOf(LEGACY).last_block - BLOCKS_PER_HOUR[LEGACY] * h;
};

const bookSweep = must(watermarkOf(CASH).sweep, "book.demo.json debt_manager sweep");
if (!same(bookSweep, engineCard(CASH).sweep)) fail("the Book's debt_manager watermark and engine card state different sweeps");
if (watermarkOf(LEGACY).sweep !== null || engineCard(LEGACY).sweep !== null) fail("the Book's Aave engine has grown a sweep; re-derive the Aave series' stamp");
if (Number(ageSeconds(bookSweep.max_updated_at, SERVED_AT)) !== bookSweep.age_seconds) fail("the Book's own sweep age is not against its served_at");
/** The Book's sweep with its stamp shifted back by the bucket's offset and the age re-derived; null on the sweeperless engine. */
const sweepAt = (engine, h) => {
  if (engine !== CASH) return null;
  const stamp = iso(Date.parse(bookSweep.max_updated_at) - h * HOUR_MS);
  return { ...bookSweep, max_updated_at: stamp, age_seconds: Number(ageSeconds(stamp, SERVED_AT)) };
};

const exampleCaptured = must(seriesExample.points.find((p) => p.refused === false), "the contract example's captured point");
const exampleWithheld = must(seriesExample.points.find((p) => p.refused === true), "the contract example's withheld point");
if (typeof exampleWithheld.refusal_code !== "string") fail("the contract example's withheld point names no refusal code");
const exampleRate = must(exampleCaptured.rates[0], "the contract example's rate row");
if (exampleRate.kind !== "borrow_index" || exampleRate.scale !== "index-1e18") fail("the contract example's rate row is no longer the Debt Manager's borrow index at index-1e18");
const AAVE_LIQ = must(feedExample.events.find((e) => e.engine === LEGACY && e.type === "liquidation"), "the /v1/events example's Aave liquidation");
const DM_BORROW = must(feedExample.events.find((e) => e.engine === CASH && e.type === "borrow"), "the /v1/events example's Debt Manager borrow");
const USDC_MAINNET = must(book.waterfall.held_flat.find((m) => m.chain_id === 1), "the Book's mainnet held-flat mark").asset;
if (USDC_MAINNET.toLowerCase() !== AAVE_LIQ.asset.toLowerCase()) fail("the Book's mainnet held-flat mark is not the /v1/events example's USDC");
const INDEX_1E18 = BigInt(exampleRate.value); // 1.05
const INDEX_APR_BPS = 500n;
const YEAR_HOURS = 8760n;
const indexAt = (h) => INDEX_1E18 - (INDEX_1E18 * INDEX_APR_BPS * BigInt(h)) / (10_000n * YEAR_HOURS);
const rateAt = (engine, h, lastBlock) =>
  engine === CASH
    ? { ...exampleRate, asset: DM_BORROW.asset, symbol: DM_BORROW.symbol, value: s(indexAt(h)), as_of_block: lastBlock - 10 }
    : { ...exampleRate, engine: LEGACY, asset: USDC_MAINNET, symbol: AAVE_LIQ.symbol, kind: "liquidity_index", scale: "ray-1e27", value: s(indexAt(h) * 10n ** 9n), as_of_block: lastBlock - 10 };

function seriesBody(engine) {
  const card = engineCard(engine);
  const w = watermarkOf(engine);
  if (card.refused || card.total_debt === null || card.total_collateral === null) fail(`${engine}: the Book's card is withheld; the weld has nothing to hold`);
  const walks = { debt: walk(`${engine}:debt_usd`), collateral: walk(`${engine}:collateral_usd`), accounts: walk(`${engine}:accounts`) };
  const points = [];
  for (let h = HOURS - 1; h >= 0; h -= 1) {
    if (ABSENT.has(h)) continue;
    const bucket_start = bucketAt(h);
    const batch_id = batchIdAt(h);
    const last_block = lastBlockAt(engine, h);
    const common = {
      bucket_start,
      last_block,
      batch_id,
      materialization_key: sha(`observatory:${engine}:${String(batch_id)}:${bucket_start}`),
      acked_epoch: w.acked_epoch,
      max_epoch_at_compute: w.max_epoch_at_compute,
      sweep_recorded: true,
      sweep: sweepAt(engine, h),
    };
    if (h === WITHHELD) {
      points.push({ ...common, refused: true, refusal_code: exampleWithheld.refusal_code, accounts: null, refused_positions: 0, liquidatable_positions: null, debt_usd: null, collateral_usd: null, rates: [] });
      continue;
    }
    points.push({
      ...common,
      refused: false,
      refusal_code: null,
      accounts: Number(drifted(card.positions, walks.accounts[h])),
      refused_positions: card.refused_positions,
      liquidatable_positions: card.liquidatable_positions + ((7 * h + 1) % 3) - 1,
      debt_usd: s(drifted(card.total_debt, walks.debt[h])),
      collateral_usd: s(drifted(card.total_collateral, walks.collateral[h])),
      rates: [rateAt(engine, h, last_block)],
    });
  }
  if (points.length !== HOURS - ABSENT.size) fail(`${engine}: ${String(points.length)} points for ${String(HOURS - ABSENT.size)} non-absent buckets`);
  // The weld, asserted before anything is written.
  const newest = points[points.length - 1];
  if (
    newest.bucket_start !== bucketAt(0) ||
    newest.debt_usd !== String(card.total_debt) ||
    newest.collateral_usd !== String(card.total_collateral) ||
    newest.accounts !== card.positions ||
    newest.refused_positions !== card.refused_positions ||
    newest.liquidatable_positions !== card.liquidatable_positions ||
    newest.batch_id !== book.batch.id ||
    newest.last_block !== w.last_block ||
    !same(newest.sweep, w.sweep)
  ) {
    fail(`${engine}: the newest bucket is not the Book's engine card`);
  }
  return {
    served_at: SERVED_AT,
    engine,
    usd_decimals: card.value_decimals,
    from: points[0].bucket_start,
    to: null,
    step_seconds: null,
    points,
    notes: seriesExample.notes,
  };
}

// ---- the feed page ----------------------------------------------------------------
const enumMatch = /EventDisplayType:\s*\n\s*type: string\s*\n\s*enum:\s*\n\s*\[([^\]]+)\]/.exec(contractText);
const DISPLAY_TYPES = must(enumMatch, "api/openapi.yaml's EventDisplayType enum")[1].split(",").map((t) => t.trim()).filter((t) => t !== "");
if (DISPLAY_TYPES.length !== 8) fail(`EventDisplayType carries ${String(DISPLAY_TYPES.length)} classes; this generator draws over 8`);

/** internal/store/p5_events.go's classification per engine: display class → [raw_type, amount_unit]. */
const CLASSIFICATION = {
  [LEGACY]: {
    borrow: ["aave_borrow", "aave_scaled"],
    repay: ["aave_repay", "aave_scaled"],
    supply: ["aave_supply", "none"],
    withdraw: ["aave_withdraw", "none"],
    liquidation: ["aave_liquidation_call", "aave_scaled"],
    collateral_enabled: ["aave_collateral_enabled", "none"], // collateralflags.go AaveCollateralEnabledEvent
    collateral_disabled: ["aave_collateral_disabled", "none"], // collateralflags.go AaveCollateralDisabledEvent
    deficit_created: ["aave_deficit_created", "aave_scaled"],
  },
  [CASH]: {
    borrow: ["borrow", "dm_normalized_debt"],
    repay: ["repay", "dm_normalized_debt"],
    supply: ["supplied", "none"],
    withdraw: ["withdraw_borrow_token", "none"],
    liquidation: ["liquidation", "dm_normalized_debt"],
  },
};
for (const [engine, classes] of Object.entries(CLASSIFICATION)) {
  for (const t of Object.keys(classes)) if (!DISPLAY_TYPES.includes(t)) fail(`${engine} classifies ${t}, which is not in the contract's display vocabulary`);
}
for (const t of DISPLAY_TYPES) if (!Object.values(CLASSIFICATION).some((classes) => t in classes)) fail(`no engine emits the display class ${t}`);
if (AAVE_LIQ.raw_type !== CLASSIFICATION[LEGACY].liquidation[0] || AAVE_LIQ.amount_unit !== CLASSIFICATION[LEGACY].liquidation[1]) fail("the /v1/events example's Aave liquidation is not classified as pinned here");
if (DM_BORROW.raw_type !== CLASSIFICATION[CASH].borrow[0] || DM_BORROW.amount_unit !== CLASSIFICATION[CASH].borrow[1]) fail("the /v1/events example's Debt Manager borrow is not classified as pinned here");

const CHAIN = { [LEGACY]: AAVE_LIQ.chain_id, [CASH]: DM_BORROW.chain_id };
for (const engine of [LEGACY, CASH]) if (CHAIN[engine] !== watermarkOf(engine).chain_id) fail(`${engine}: the example row's chain is not the Book's watermark chain`);
const SECONDS_PER_BLOCK = { [LEGACY]: 12, [CASH]: 2 };
const weethOp = must(meta.prices.find((p) => p.chain_id === CHAIN[CASH] && p.symbol === "weETH"), "meta.demo.json chain-10 weETH witness");
const seizedExample = must(AAVE_LIQ.liquidation?.seized?.[0], "the example liquidation's seized leg");
const USDC = { [LEGACY]: { asset: AAVE_LIQ.asset, symbol: AAVE_LIQ.symbol }, [CASH]: { asset: DM_BORROW.asset, symbol: DM_BORROW.symbol } };
const WEETH = { [LEGACY]: { asset: seizedExample.asset, symbol: seizedExample.symbol }, [CASH]: { asset: weethOp.asset, symbol: weethOp.symbol } };
const dmLiquidationExample = must(liquidationsExample.events.find((e) => e.engine === CASH && e.type === "liquidation")?.liquidation, "../feed-liquidations.json's Debt Manager liquidation");
const DM_BONUS_100E18 = must(dmLiquidationExample.seized?.[0]?.bonus, "../feed-liquidations.json's Debt Manager seizure bonus");

const ROWS = [...page1.positions, ...page2.positions];
const liquidatableRows = ROWS.filter((p) => p.status === "computed" && p.liquidatable === true);
const healthyRows = ROWS.filter((p) => p.status === "computed" && p.liquidatable === false);
if (liquidatableRows.length < 2 || healthyRows.length < 60) fail("the demo positions pages carry too few rows to draw the feed's accounts from");
const aaveAccount = (i) => `0x${sha(`aave-account:${String(i)}`).slice(0, 40)}`;

const FEED_ROWS = 50;
const TIMED_ROWS = 48;
const DEFICIT_AT = 4; // the Aave write-off; its liquidation is the next row (same block and transaction)
const LIQUIDATION_AT = { 5: LEGACY, 19: CASH, 37: CASH };
const INDEX = indexAt(0);
/** The wire's accounting unit for a 6-decimal nominal at the series' newest index: normalized (Cash) and scaled (Aave) are the same division. */
const atIndex = (nominal) => (nominal * 10n ** 18n) / INDEX;
const draw = lcg("feed");
const dollars = () => BigInt(5_000 + draw(2_495_001)) * 10n ** 4n; // [$50.00, $25,000.00] at 6 decimals
const servedMs = Date.parse(SERVED_AT);
const heightAt = (engine, secondsBack) => watermarkOf(engine).last_block - Math.floor(secondsBack / SECONDS_PER_BLOCK[engine]);
const txHash = (engine, block, logIndex) => `0x${sha(`feed:${String(CHAIN[engine])}:${String(block)}:${String(logIndex)}`)}`;

function row({ engine, type, secondsBack, timed, logIndex, account, token, amount, tx, liquidation }) {
  const [raw_type, amount_unit] = must(CLASSIFICATION[engine][type], `${engine} does not emit ${type}`);
  if ((amount_unit === "none") !== (amount === null)) fail(`${engine} ${type}: unit ${amount_unit} with amount ${String(amount)}`);
  const block_number = heightAt(engine, secondsBack);
  return {
    chain_id: CHAIN[engine],
    engine,
    block_number,
    block_time: timed ? iso(servedMs - secondsBack * 1000) : null,
    tx_hash: tx ?? txHash(engine, block_number, logIndex),
    log_index: logIndex,
    seq: 0,
    type,
    raw_type,
    account,
    asset: token.asset,
    symbol: token.symbol,
    amount: amount === null ? null : s(amount),
    amount_unit,
    amount_decimals: null,
    liquidation,
  };
}

/** A Debt Manager liquidation: the position's own debt, half of it closed (the Book's first pass), one weETH leg at the OP witness price plus the bonus. */
function dmLiquidation(position) {
  const before = BigInt(position.total_debt);
  const repaid = before / 2n;
  const bonus = BigInt(DM_BONUS_100E18); // 5e18 = 5 percent in the contract's 100e18 denomination
  const seizedWei = (repaid * (100n * 10n ** 18n + bonus) * 10n ** 18n) / (100n * 10n ** 18n * BigInt(weethOp.value) * 10n ** BigInt(6 - weethOp.decimals));
  return {
    liquidator: `0x${sha(`liquidator:${position.account}`).slice(0, 40)}`,
    debt_asset: null,
    debt_repaid: s(repaid),
    debt_decimals: engineCard(CASH).value_decimals,
    deficit_paired: null,
    before_debt_usd: s(before),
    interest_index: s(INDEX),
    seized: [{ asset: WEETH[CASH].asset, symbol: WEETH[CASH].symbol, amount: s(seizedWei), decimals: 18, bonus: s(bonus) }],
    realized_bonus_bps: null,
    configured_bonus_bps: null,
    note: dmLiquidationExample.note,
  };
}

function feedBody() {
  const rows = [];
  let secondsBack = 0;
  let healthyIndex = 0;
  let aaveIndex = 0;
  let liquidatableIndex = 0;
  const nextHealthy = () => healthyRows[(healthyIndex++ * 23) % healthyRows.length].account;
  const nextLiquidatable = () => liquidatableRows[(liquidatableIndex++ * 7) % liquidatableRows.length].account;
  const nextAave = () => aaveAccount(aaveIndex++);
  const ordinary = (engine) => Object.keys(CLASSIFICATION[engine]).filter((t) => t !== "liquidation" && t !== "deficit_created");

  for (let i = 0; i < TIMED_ROWS; i += 1) {
    if (i === DEFICIT_AT + 1) continue; // built with the deficit row below
    secondsBack += 20 + draw(381);
    if (i === DEFICIT_AT) {
      // The Aave liquidation and the deficit it pairs with: one transaction, one block, the write-off at the next log index.
      const account = nextAave();
      const logIndex = 1 + draw(40);
      const liquidation = row({
        engine: LEGACY,
        type: "liquidation",
        secondsBack,
        timed: true,
        logIndex,
        account,
        token: USDC[LEGACY],
        amount: -atIndex(BigInt(AAVE_LIQ.liquidation.debt_repaid)),
        liquidation: { ...AAVE_LIQ.liquidation, deficit_paired: true },
      });
      const deficit = row({ engine: LEGACY, type: "deficit_created", secondsBack, timed: true, logIndex: logIndex + 1, account, token: USDC[LEGACY], amount: -atIndex(180n * 10n ** 6n), tx: liquidation.tx_hash, liquidation: null });
      rows.push(deficit, liquidation);
      continue;
    }
    const engine = LIQUIDATION_AT[i] ?? (draw(2) === 0 ? LEGACY : CASH);
    const logIndex = 1 + draw(40);
    if (LIQUIDATION_AT[i] !== undefined) {
      const position = liquidatableRows.find((p) => p.account === nextLiquidatable());
      const liquidation = dmLiquidation(position);
      rows.push(row({ engine, type: "liquidation", secondsBack, timed: true, logIndex, account: position.account, token: USDC[CASH], amount: -atIndex(BigInt(liquidation.debt_repaid)), liquidation }));
      continue;
    }
    const classes = ordinary(engine);
    const type = classes[draw(classes.length)];
    const account = engine === CASH ? nextHealthy() : nextAave();
    const debtSide = type === "borrow" || type === "repay";
    const token = debtSide ? USDC[engine] : WEETH[engine];
    const amount = debtSide ? (type === "borrow" ? 1n : -1n) * atIndex(dollars()) : null;
    rows.push(row({ engine, type, secondsBack, timed: true, logIndex, account, token, amount, liquidation: null }));
  }
  // The disclosed untimed tail: chain_id DESC, heights below every timed row of the engine.
  secondsBack += 300 + draw(301);
  rows.push(row({ engine: CASH, type: "repay", secondsBack, timed: false, logIndex: 1 + draw(40), account: nextHealthy(), token: USDC[CASH], amount: -atIndex(dollars()), liquidation: null }));
  secondsBack += 300 + draw(301);
  rows.push(row({ engine: LEGACY, type: "borrow", secondsBack, timed: false, logIndex: 1 + draw(40), account: nextAave(), token: USDC[LEGACY], amount: atIndex(dollars()), liquidation: null }));

  // The page's own laws, asserted before it is written.
  if (rows.length !== FEED_ROWS) fail(`${String(rows.length)} rows for a page of ${String(FEED_ROWS)}`);
  const drawn = new Set(rows.map((r) => r.type));
  for (const t of DISPLAY_TYPES) if (!drawn.has(t)) fail(`the draw never produced ${t}; move the seed rather than pad the page`);
  if (rows.filter((r) => r.type === "liquidation").length !== 3) fail("the page does not carry exactly three liquidations");
  if (rows.filter((r) => r.type === "deficit_created").length !== 1) fail("the page does not carry exactly one write-off");
  for (const r of rows) if (!same(Object.keys(r), Object.keys(AAVE_LIQ))) fail("a row does not carry the contract example's exact keys in order");
  const timed = rows.filter((r) => r.block_time !== null);
  if (timed.length !== TIMED_ROWS || rows.slice(TIMED_ROWS).some((r) => r.block_time !== null)) fail("the untimed tail is not exactly the last two rows");
  for (let i = 1; i < timed.length; i += 1) if (Date.parse(timed[i].block_time) > Date.parse(timed[i - 1].block_time)) fail("the timed section is not newest first");
  const dmLiquidations = rows.filter((r) => r.type === "liquidation" && r.engine === CASH);
  if (new Set(dmLiquidations.map((r) => r.account)).size !== 2) fail("the two Debt Manager liquidations are not distinct accounts");
  const last = rows[rows.length - 1];
  return {
    served_at: SERVED_AT,
    filter: feedExample.filter,
    limit: FEED_ROWS,
    events: rows,
    // OPAQUE: the demo's keyset token is base64url over the last row's coordinates; the UI never decodes it.
    next_cursor: Buffer.from(`untimed.${String(last.chain_id)}.${String(last.block_number)}.${last.tx_hash.slice(0, 6)}.${String(last.log_index)}.${String(last.seq)}`).toString("base64url"),
    notes: feedExample.notes,
  };
}

// ---- write, under the clock law -------------------------------------------------
/** The trios the law resolves in each body: one per debt_manager point (the sweep stamp over max_updated_at); the Aave series has no sweeper and the feed no clock. */
const CLOCK_TRIOS = {
  "observatory-demo-dm.json": 166,
  "observatory-demo-aave.json": 0,
  "events-demo-feed-page-1.json": 0,
};

function writeChecked(name, body) {
  const report = checkClocks(body);
  if (report.failures.length > 0) fail(`${name} violates the clock law:\n${report.failures.join("\n")}`);
  if (report.checked !== CLOCK_TRIOS[name]) fail(`${name}: the law checked ${String(report.checked)} trios and this generator pins ${String(CLOCK_TRIOS[name])}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.checked)} clocks checked)`);
}

writeChecked("observatory-demo-dm.json", seriesBody(CASH));
writeChecked("observatory-demo-aave.json", seriesBody(LEGACY));
writeChecked("events-demo-feed-page-1.json", feedBody());
