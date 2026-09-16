// web/tests/fixtures/demo/generate-demo-inspector.mjs
//
// PROVENANCE. The Inspector's demo dataset (spec 2026-09-15 §8; plan 2 Task 10),
// derived — never hand-shaped — from committed bodies:
//   - batch identity, served_at and the debt_manager watermark (sweep: 1 of 3
//     rows failed, generation 4) are read VERBATIM from book.demo.json, so the
//     Inspector agrees with the Book and the Overview on batch 18,251;
//   - the weETH price witness (chain 10, priceproviderv2, engine-exact,
//     4000000000 @ 6 decimals) is read from meta.demo.json;
//   - scenario definitions are read VERBATIM from ../scenarios.json by id; the
//     projection note and the lookup note from ../stress-dm.json;
//   - the ETHFI asset is READ from ../scenarios.json — the committed
//     ethfi_minus_50 scenario's shock asset (the generator throws if it is
//     absent); USDC is the /v1/events example's OP USDC;
//   - tx hashes are sha256 over a `solvent-demo:<seed>` string: deterministic,
//     distinct, well-formed, and never a real transaction.
// The near account is the mockup's (pages-console.html:224-247): debt $4,822,
// cap $5,012.50, room $190.50 (3.8 %), two collateral legs, 14 batches under
// the 10 % line. Every age is derived from its stamp against served_at with
// the clock law's own ageSeconds(), and every body passes checkClocks() before
// it is written. Regenerate: `node tests/fixtures/demo/generate-demo-inspector.mjs` (from web/).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageSeconds, checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));

const book = read("book.demo.json");
const meta = read("meta.demo.json");
const scenarios = readFixture("scenarios.json");
const stressTemplate = readFixture("stress-dm.json");

const BATCH = book.batch;
const SERVED_AT = book.served_at;
const servedMs = Date.parse(SERVED_AT);
const computedMs = Date.parse(BATCH.computed_at);
const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");
const age = (stamp) => Number(ageSeconds(stamp, SERVED_AT));
const dm = BATCH.watermarks.find((w) => w.engine === "debt_manager");
if (dm === undefined) throw new Error("book.demo.json must carry the debt_manager watermark");
const weethWitness = meta.prices.find((p) => p.chain_id === 10 && p.symbol === "weETH");
if (weethWitness === undefined) throw new Error("meta.demo.json must carry the chain-10 weETH witness");
const LOOKUP_NOTE = stressTemplate.lookup_complete_note;
/** A committed scenario definition, by id — spread VERBATIM into the stress body. */
const scenarioDef = (id) => {
  const d = scenarios.scenarios.find((x) => x.id === id);
  if (d === undefined) throw new Error(`scenarios.json lacks ${id}`);
  return d;
};
const ethfiShock = scenarioDef("ethfi_minus_50").shocks[0];
if (ethfiShock === undefined || typeof ethfiShock.asset !== "string") throw new Error("scenarios.json's ethfi_minus_50 must carry its asset on shocks[0]");
const projectionScenario = stressTemplate.scenarios.find((x) => x.id === "dm_rate_horizon_plus_200bps");
const PROJECTION_NOTE = projectionScenario?.results?.[0]?.projection?.note;
if (typeof PROJECTION_NOTE !== "string") throw new Error("stress-dm.json must carry the dm_rate_horizon_plus_200bps projection note");
const HF_NOTE = "the Debt Manager's MaxBorrowLT / Borrowings as an exact rational — a disclosure, not the verdict; the strict boolean decides.";
const REFUSAL_NOTE = "a refused row keeps its persisted debt for display; no verdict is served for it.";

const NEAR_ADDR = "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e";
const LIQ_ADDR = "0x5d11c0ffee00000000000000000000000000a1b2";
const HEALTHY_ADDR = "0x9e0d1c2b3a49586776655443322110ffeeddccbb";
const REFUSED_ADDR = "0x4444444444444444444444444444444444444404";
const USDC = { asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 };
const WEETH = { asset: weethWitness.asset, symbol: "weETH", decimals: 18 };
const ETHFI = { asset: ethfiShock.asset, symbol: "ETHFI", decimals: 18 };

const PRICE_DECIMALS = weethWitness.decimals; // 6
const WEETH_PRICE = BigInt(weethWitness.value); // $4,000.00
const ETHFI_PRICE = 1250000n; // $1.25
const LTV_BPS = { weETH: 5000n, ETHFI: 2000n };
const USD = (dollars) => BigInt(Math.round(dollars * 1e6)); // Cash value_decimals = 6
const TOKEN = (units) => BigInt(Math.round(units * 1e6)) * 10n ** 12n; // 18-dec amounts, 6 places of precision
const ceilDiv = (a, b) => (a + b - 1n) / b;
const s = (v) => v.toString();
const hash = (seed) => `0x${createHash("sha256").update(`solvent-demo:${String(seed)}`).digest("hex")}`;

const PRICE_AS_OF = iso(servedMs - 35_000);
const priceInput = (token, value) => ({
  asset: token.asset,
  chain_id: 10,
  source: weethWitness.source,
  provenance: weethWitness.provenance,
  value: s(value),
  decimals: PRICE_DECIMALS,
  block_number: dm.last_block - 14,
  source_as_of: PRICE_AS_OF,
  budget_seconds: 180,
  verdict: "fresh",
  age_seconds: age(PRICE_AS_OF),
  fresh: true,
  note: "engine-exact custody: the value the engine itself computed with.",
});

function legsFor(weethUnits, ethfiUnits) {
  return [
    [WEETH, weethUnits, WEETH_PRICE, LTV_BPS.weETH],
    [ETHFI, ethfiUnits, ETHFI_PRICE, LTV_BPS.ETHFI],
  ].map(([token, units, price, ltv]) => {
    const amount = TOKEN(units);
    const value = (amount * price) / 10n ** 18n; // 6-dec USD
    return { token, amount, value, contribution: (value * ltv) / 10_000n };
  });
}

/** One Cash position. Returns the wire body and the bigints the other bodies weld to. */
function cashPosition({ account, weethUnits, ethfiUnits, debt, refused = false }) {
  const legs = legsFor(weethUnits, ethfiUnits);
  const collateral = legs.reduce((sum, l) => sum + l.value, 0n);
  const cap = legs.reduce((sum, l) => sum + l.contribution, 0n);
  const debtUsd = USD(debt);
  const liquidatable = debtUsd > cap;
  const wireLegs = legs.map((l) => ({
    asset: l.token.asset,
    symbol: l.token.symbol,
    decimals: l.token.decimals,
    live_debt: null,
    live_collateral: null,
    debt_base: null,
    collateral_base: null,
    weighted_lt: null,
    used_as_collateral: refused ? null : true,
    debt_index_block: null,
    collateral_index_block: null,
    amount: s(l.amount),
    value_usd: refused ? null : s(l.value),
    max_borrow_contribution: refused ? null : s(l.contribution),
    liq_threshold: null,
    liq_bonus: null,
  }));
  const base = {
    engine: "debt_manager",
    account,
    value_decimals: 6,
    // The DM rational, disclosed on the position as the Book's rows and this account's history points disclose it.
    health_factor: refused ? null : { wad: null, num: s(cap), den: s(debtUsd), infinite: false, note: HF_NOTE },
    total_collateral_base: refused ? null : s(collateral),
    total_debt_base: s(debtUsd),
    weighted_lt_sum: null,
    avg_lt_bps: null,
    legs: wireLegs,
    price_inputs: [priceInput(WEETH, WEETH_PRICE), priceInput(ETHFI, ETHFI_PRICE)],
    as_of: {
      balances_block: dm.last_block,
      params_block: 155300000,
      sweep_block: refused ? 0 : dm.last_block - 54, // 0: never swept — the refusal below is SWEEP_NEVER
      oldest_price_input: PRICE_AS_OF,
      stale_price_inputs: false,
      note: "each leg additionally carries its OWN rate-index as-of block.",
    },
  };
  if (refused) {
    const position = {
      ...base,
      status: "refused",
      flags: [],
      // SWEEP_NEVER is the code the engine actually emits for a row it cannot value (internal/riskfeed/assemble.go):
      // a sweep that fails AFTER a success does not refuse the row — it is served against its last good sweep.
      refusal: { code: "SWEEP_NEVER", detail: "collateral sweep never ran for this account", note: REFUSAL_NOTE },
      liquidatable: null,
      collateral_value_usd: null,
      max_borrow_lt: null,
      borrowings: s(debtUsd),
      liquidation_price: null,
    };
    return { position, cap: null, collateral: null, debt: debtUsd, legs };
  }
  // Boundary: weETH alone falls with ETHFI flat — ethfi + weeth·k = debt ⇒ k = (debt − ethfi) / weeth.
  const [weeth, ethfi] = legs;
  const num = debtUsd - ethfi.contribution;
  const den = weeth.contribution;
  const never = num <= 0n;
  const position = {
    ...base,
    status: "computed",
    flags: [],
    refusal: null,
    liquidatable,
    collateral_value_usd: s(collateral),
    max_borrow_lt: s(cap),
    borrowings: s(debtUsd),
    liquidation_price: {
      in_factor: true,
      never_liquidatable: never,
      ...(never ? { reason: "collateral outside the factor already covers the debt at threshold" } : {}),
      scale_factor_num: never ? null : s(num),
      scale_factor_den: never ? null : s(den),
      already_breached: liquidatable,
      prices: never
        ? []
        : [{ asset: WEETH.asset, current_price: s(WEETH_PRICE), price_decimals: PRICE_DECIMALS, price_floor: s((WEETH_PRICE * num) / den), lowest_healthy_price: s(ceilDiv(WEETH_PRICE * num, den)) }],
      factor_assets: [WEETH.asset],
      held_assets: [WEETH.asset, ETHFI.asset],
      boundary_is_healthy: true,
      per_token_floor_omitted: false,
      diagnostic: false,
      axis: "eth_usd",
      note: "at exactly this price the position is HEALTHY — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil.",
    },
  };
  return { position, cap, collateral, debt: debtUsd, legs };
}

const addressBody = (account, position) => ({
  served_at: SERVED_AT,
  batch: BATCH,
  address: account,
  positions: [position],
  found: true,
  lookup_complete: true,
  withheld_engines: [],
  lookup_complete_note: LOOKUP_NOTE,
  notes: [],
});

/** 100 batches at a 30-second cadence; room drifts from ~38 % to 3.8 %; the last 14 sit under 10 %. */
function historyBody(account, near) {
  const COUNT = 100;
  const CADENCE_MS = 30_000;
  const BLOCKS_PER_BATCH = 15;
  const withheld = [BATCH.id - 50, BATCH.id - 49];
  const refusedAt = BATCH.id - 81;
  // An integer wobble of ±0.4 pt (tenths of a percent) over the drift — no float trig on the path to a byte.
  const wobbleTenths = (k) => ((k * 7919) % 9) - 4;
  const points = [];
  for (let k = 0; k < COUNT; k += 1) {
    const back = COUNT - 1 - k;
    const id = BATCH.id - back;
    if (withheld.includes(id)) continue;
    const balancesBlock = dm.last_block - back * BLOCKS_PER_BATCH;
    const common = { batch_id: id, computed_at: iso(computedMs - back * CADENCE_MS), balances_block: balancesBlock, sweep_block: balancesBlock - 54 };
    if (id === refusedAt) {
      // SWEEP_NEVER at that batch: no successful sweep persisted, so the point's sweep_block is 0 (the contract's own wording).
      points.push({ ...common, sweep_block: 0, status: "refused", refusal: { code: "SWEEP_NEVER", detail: "collateral sweep never ran for this account", note: REFUSAL_NOTE }, health_factor: null, liquidatable: null, total_collateral_base: null, total_debt_base: null });
      continue;
    }
    let cap;
    let collateral;
    if (k === COUNT - 1) {
      cap = near.cap;
      collateral = near.collateral;
    } else {
      const t = k / (COUNT - 1);
      const roomPct = 38 - 34.2 * t ** 1.4 + (k < 84 ? wobbleTenths(k) / 10 : 0); // k ≥ 86 → under 10 %
      cap = USD(Number(near.debt) / 1e6 / (1 - roomPct / 100));
      collateral = (cap * near.collateral) / near.cap;
    }
    points.push({
      ...common,
      status: "computed",
      refusal: null,
      health_factor: { wad: null, num: s(cap), den: s(near.debt), infinite: false, note: HF_NOTE },
      liquidatable: false,
      total_collateral_base: s(collateral),
      total_debt_base: s(near.debt),
    });
  }
  points.reverse(); // newest first, as the wire serves it
  return {
    served_at: SERVED_AT,
    batch: BATCH,
    address: account,
    limit: 100,
    engines: [{ engine: "debt_manager", value_decimals: 6, points, withheld_batch_ids: withheld, note: "one persisted row per batch; a refused batch is a point, not a gap." }],
    found: true,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: LOOKUP_NOTE,
    notes: [],
  };
}

function eventsBody(account) {
  // `block_time` follows the history's own cadence — OP's 2-second blocks, 15 per 30-second batch — so two
  // distinct blocks never share a stamp; one row is left untimed on purpose (its header not yet custodied).
  const ev = (blocksBack, timed, type, token, amount, unit, logIndex) => ({
    chain_id: 10,
    engine: "debt_manager",
    block_number: dm.last_block - blocksBack,
    block_time: timed ? iso(servedMs - blocksBack * 2000) : null,
    tx_hash: hash((dm.last_block - blocksBack) * 1000 + logIndex),
    log_index: logIndex,
    seq: 0,
    type,
    raw_type: type,
    account,
    asset: token.asset,
    symbol: token.symbol,
    amount,
    amount_unit: unit,
    amount_decimals: null, // the contract: null on every row it serves; `opaque` never carries a scale
    liquidation: null,
  });
  return {
    served_at: SERVED_AT,
    filter: { engine: null, account, types: [], since_block: null },
    limit: 25,
    events: [
      ev(344, true, "borrow", USDC, "622000000", "dm_normalized_debt", 12),
      ev(1444, true, "supply", WEETH, s(TOKEN(0.6)), "opaque", 4),
      ev(1454, true, "collateral_enabled", WEETH, null, "none", 3),
      ev(2944, true, "supply", ETHFI, s(TOKEN(1250)), "opaque", 7),
      ev(5444, true, "borrow", USDC, "4200000000", "dm_normalized_debt", 2),
      // The SIGNED delta: a repay is negative on the debt side (the contract's ChainEvent.amount).
      ev(8444, false, "repay", USDC, "-150000000", "dm_normalized_debt", 9),
    ],
    next_cursor: null,
    notes: ["`block_time` is null until the block's header is custodied — never fabricated. Render the block number in the meantime."],
  };
}

const paramsBody = () => ({
  served_at: SERVED_AT,
  engine: "debt_manager",
  asset: null,
  params: [
    {
      engine: "debt_manager",
      chain_id: 10,
      asset: null,
      fields: [{ name: "borrow_apy", value: "50000000000000000", address: null, prior: "40000000000000000", unit: "per-second-1e18" }],
      effective_block: 155300000,
      effective_log_index: 3,
      source_event: "borrow_apy_set",
      tx_hash: hash(155300000003),
      block_time: iso(servedMs - 3 * 3_600_000),
    },
  ],
  next_cursor: null,
  notes: ["denominations are the ENGINE's own and are named per field; the Debt Manager's percent scale is 100e18."],
});

function stressBody(account, near) {
  const state = (cap, debt, collateral) => ({
    health_factor_wad: null,
    health_factor_num: s(cap),
    health_factor_den: s(debt),
    infinite: false,
    liquidatable: debt > cap,
    eligible: debt > cap,
    collateral_usd: s(collateral),
    debt_usd: s(debt),
    max_borrow_lt: s(cap),
  });
  const before = state(near.cap, near.debt, near.collateral);
  const priceOf = (token) => (token.symbol === "weETH" ? WEETH_PRICE : ETHFI_PRICE);
  /** One factor asset falls by num/den; the other is held flat. */
  const shocked = (token, num, den) => {
    const legs = near.legs.map((l) => (l.token.symbol === token.symbol ? { ...l, value: (l.value * num) / den, contribution: (l.contribution * num) / den } : l));
    const cap = legs.reduce((a, l) => a + l.contribution, 0n);
    const collateral = legs.reduce((a, l) => a + l.value, 0n);
    const other = token.symbol === "weETH" ? ETHFI : WEETH;
    return {
      after: state(cap, near.debt, collateral),
      applied_shocks: [{ asset: token.asset, chain_id: 10, source: weethWitness.source, factor_num: s(num), factor_den: s(den), before: s(priceOf(token)), after: s((priceOf(token) * num) / den), snapped: false, base_snapped: false, cap_bound: false }],
      held_flat: [{ asset: other.asset, chain_id: 10, source: weethWitness.source, value: s(priceOf(other)) }],
    };
  };
  const result = (extra) => ({ engine: "debt_manager", account, applicable: true, before, market_realization: null, projection: null, ...extra });
  const horizon = (seconds) => {
    const extra = (near.debt * 200n * BigInt(seconds)) / (10_000n * 31_536_000n);
    const projected = near.debt + extra;
    return { horizon_seconds: seconds, debt_usd: s(near.debt), projected_usd: s(projected), additional_interest_usd: s(extra), becomes_liquidatable: projected > near.cap };
  };
  const projection = {
    label: "PROJECTION",
    basis: "delta-only",
    annual_delta_bps: 200,
    apy_observed_at_block: dm.last_block,
    prices_held_flat: true,
    horizons: [horizon(2_592_000), horizon(7_776_000)],
    note: PROJECTION_NOTE,
  };
  return {
    served_at: SERVED_AT,
    batch: BATCH,
    address: account,
    scenario_config_version: scenarios.scenario_config_version,
    found: true,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: LOOKUP_NOTE,
    scenarios: [
      { ...scenarioDef("eth_minus_30"), results: [result(shocked(WEETH, 70n, 100n))] },
      { ...scenarioDef("ethfi_minus_50"), results: [result(shocked(ETHFI, 50n, 100n))] },
      { ...scenarioDef("dm_rate_horizon_plus_200bps"), results: [result({ after: before, applied_shocks: [], held_flat: [], projection })] },
    ],
    notes: stressTemplate.notes,
  };
}

const writeChecked = (name, body) => {
  const report = checkClocks(body);
  if (report.failures.length > 0) throw new Error(`${name} violates the clock law:\n${report.failures.join("\n")}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.checked)} clocks checked)`);
};

const near = cashPosition({ account: NEAR_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 4822 });
const liq = cashPosition({ account: LIQ_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 5400 });
const healthy = cashPosition({ account: HEALTHY_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 2100 });
const refused = cashPosition({ account: REFUSED_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 4100, refused: true });

writeChecked("address-demo-near.json", addressBody(NEAR_ADDR, near.position));
writeChecked("address-demo-liquidatable.json", addressBody(LIQ_ADDR, liq.position));
writeChecked("address-demo-healthy.json", addressBody(HEALTHY_ADDR, healthy.position));
writeChecked("address-demo-refused.json", addressBody(REFUSED_ADDR, refused.position));
writeChecked("history-demo-near.json", historyBody(NEAR_ADDR, near));
writeChecked("events-demo-near.json", eventsBody(NEAR_ADDR));
writeChecked("params-demo-dm.json", paramsBody());
writeChecked("stress-demo-near.json", stressBody(NEAR_ADDR, near));
