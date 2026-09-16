### Task 10: The Inspector demo dataset — generated, clock-law checked, welded

**Files:**
- Create: `web/tests/fixtures/demo/generate-demo-inspector.mjs`
- Create (generated): `web/tests/fixtures/demo/{address-demo-near,address-demo-liquidatable,address-demo-healthy,address-demo-refused,history-demo-near,events-demo-near,params-demo-dm,stress-demo-near}.json`
- Modify: `web/tests/fixtures/demo/index.ts`
- Modify: `web/tests/unit/fixture-clock-law.spec.ts` (census)
- Test: `web/tests/unit/demo-inspector-weld.spec.ts`

**Interfaces:**
- Consumes `book.demo.json` (batch 18,251 identity and the `debt_manager` watermark), `meta.demo.json` (the chain-10 weETH witness: `priceproviderv2`, `engine-exact`, `4000000000` @ 6), `../scenarios.json` (the committed scenario definitions), `../stress-dm.json` (the projection note and the lookup note), `../clock-law.mjs` (`ageSeconds`, `checkClocks`).
- Produces from `tests/fixtures/demo/index.ts`: `DEMO_ADDRESS_NEAR`, `DEMO_ADDRESS_LIQUIDATABLE`, `DEMO_ADDRESS_HEALTHY`, `DEMO_ADDRESS_REFUSED: Schemas["AddressResponse"]`, `DEMO_HISTORY_NEAR: Schemas["AddressHistoryResponse"]`, `DEMO_EVENTS_NEAR: Schemas["EventsResponse"]`, `DEMO_PARAMS_DM: Schemas["ParamsResponse"]`, `DEMO_STRESS_NEAR: Schemas["StressResponse"]`, and the address constants `DEMO_NEAR_ADDR`, `DEMO_LIQUIDATABLE_ADDR`, `DEMO_HEALTHY_ADDR`, `DEMO_REFUSED_ADDR` (read off the bodies).
- The near account IS the mockup's: debt $4,822 · cap $5,012.50 · room $190.50 (3.8 %) · collateral $12,462.50 · weETH 2.1 @ $4,000.00 × 50 % · ETHFI 3,250 @ $1.25 × 20 % · boundary weETH below $3,818.57 (a 4.5 % fall) with ETHFI flat · 14 batches under the 10 % line · sweep 1 of 3 rows failed, gen 4 (from the batch watermark) · prices 35 s within 180 s.

- [ ] **Step 1: The failing weld spec**

```ts
// web/tests/unit/demo-inspector-weld.spec.ts
// The Inspector demo dataset welds to itself and to the Book's demo batch:
// the numbers the screenshot pins show are derivable from the bodies served.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import { boundaryOf, collateralTable, readCashPosition } from "../../lib/inspector-position";
import { nearCapStreak, roomSeries } from "../../lib/room-history";
import { stressReading } from "../../lib/address-stress";
import {
  DEMO_ADDRESS_HEALTHY,
  DEMO_ADDRESS_LIQUIDATABLE,
  DEMO_ADDRESS_NEAR,
  DEMO_ADDRESS_REFUSED,
  DEMO_BATCH_ID,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";

const cashOf = (body: typeof DEMO_ADDRESS_NEAR) => {
  const l = lookup(body);
  if (l.outcome !== "found") throw new Error("demo address must be found");
  const p = l.response.positions.find((x) => x.engine === "debt_manager");
  if (p === undefined) throw new Error("demo address must carry a Cash position");
  return p;
};

test("every body shares the Book's demo batch identity", () => {
  for (const body of [DEMO_ADDRESS_NEAR, DEMO_ADDRESS_LIQUIDATABLE, DEMO_ADDRESS_HEALTHY, DEMO_ADDRESS_REFUSED, DEMO_HISTORY_NEAR, DEMO_STRESS_NEAR]) {
    expect(body.batch.id).toBe(DEMO_BATCH_ID);
    expect(body.served_at).toBe(DEMO_BOOK.served_at);
    expect(body.batch.computed_at).toBe(DEMO_BOOK.batch.computed_at);
  }
  expect(DEMO_EVENTS_NEAR.served_at).toBe(DEMO_BOOK.served_at);
  expect(DEMO_PARAMS_DM.served_at).toBe(DEMO_BOOK.served_at);
});

test("the near account is the mockup's: cap, debt, room, legs, boundary", () => {
  const wire = cashOf(DEMO_ADDRESS_NEAR);
  const cash = readCashPosition(wire);
  expect(cash.debt).toBe(4822000000n);
  expect(cash.cap).toBe(5012500000n);
  expect(cash.room).toBe(190500000n);
  expect(cash.roomPercent).toBe("3.8%");
  expect(cash.status).toBe("near");
  const table = collateralTable(wire, cash);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  expect(table.legs.map((l) => [l.symbol, l.amount, l.price, l.ltv])).toEqual([
    ["weETH", "2.1", "$4,000.00", "50%"],
    ["ETHFI", "3,250", "$1.2500", "20%"],
  ]);
  const b = boundaryOf(wire, cash);
  expect(b.kind).toBe("boundary");
  if (b.kind === "boundary") expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
});

test("liquidatable, healthy and refused accounts read as their states", () => {
  expect(readCashPosition(cashOf(DEMO_ADDRESS_LIQUIDATABLE)).status).toBe("liquidatable");
  expect(readCashPosition(cashOf(DEMO_ADDRESS_HEALTHY)).status).toBe("healthy");
  const refused = readCashPosition(cashOf(DEMO_ADDRESS_REFUSED));
  expect(refused.computed).toBe(false);
  expect(refused.debt).toBe(4100000000n);
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
});

test("the history's newest point IS the position; 14 batches sit under the 10 % line; one refused point, two withheld batches", () => {
  const h = lookup(DEMO_HISTORY_NEAR);
  if (h.outcome !== "found") throw new Error("history must be found");
  const engine = h.response.engines.find((e) => e.engine === "debt_manager");
  if (engine === undefined) throw new Error("history must carry the Cash engine");
  const newest = engine.points[0];
  expect(newest?.batch_id).toBe(DEMO_BATCH_ID);
  expect(newest?.health_factor?.num).toBe("5012500000");
  expect(newest?.health_factor?.den).toBe("4822000000");
  expect(engine.points.filter((p) => p.status === "refused")).toHaveLength(1);
  expect(engine.withheld_batch_ids).toEqual([DEMO_BATCH_ID - 50, DEMO_BATCH_ID - 49]);
  const series = roomSeries(engine, engine.withheld_batch_ids);
  expect(series.computedCount).toBe(97);
  expect(nearCapStreak(series)).toEqual({ batches: 14, spanSeconds: 390, newestKind: "computed" });
});

test("stress: ETH −30 % and ETHFI −50 % flip the account; the rate projection does not", () => {
  const r = stressReading(lookup(DEMO_STRESS_NEAR), DEMO_NEAR_ADDR);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.map((x) => [x.id, x.flips])).toEqual([
    ["eth_minus_30", true],
    ["ethfi_minus_50", true],
    ["dm_rate_horizon_plus_200bps", false],
  ]);
  expect(r.rows[2]?.projection?.every((h) => h.verdict === "not-liquidatable")).toBe(true);
});

test("events: six rows for the near account, newest first, exactly one without a custodied time", () => {
  expect(DEMO_EVENTS_NEAR.events).toHaveLength(6);
  expect(DEMO_EVENTS_NEAR.events.every((e) => e.account === DEMO_NEAR_ADDR)).toBe(true);
  expect(DEMO_EVENTS_NEAR.events.filter((e) => e.block_time === null)).toHaveLength(1);
  const blocks = DEMO_EVENTS_NEAR.events.map((e) => e.block_number);
  expect([...blocks].sort((a, b) => b - a)).toEqual(blocks);
  expect(DEMO_PARAMS_DM.params[0]?.fields[0]?.name).toBe("borrow_apy");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts`
Expected: FAIL — the demo index has no `DEMO_ADDRESS_NEAR`.

- [ ] **Step 3: The generator**

```js
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
//   - the ETHFI asset is the committed ethfi_minus_50 scenario's asset;
//     USDC is the /v1/events example's OP USDC.
// The near account is the mockup's (pages-console.html:224-247): debt $4,822,
// cap $5,012.50, room $190.50 (3.8 %), two collateral legs, 14 batches under
// the 10 % line. Every age is derived from its stamp against served_at with
// the clock law's own ageSeconds(), and every body passes checkClocks() before
// it is written. Regenerate: `node tests/fixtures/demo/generate-demo-inspector.mjs` (from web/).
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

const NEAR_ADDR = "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e";
const LIQ_ADDR = "0x5d11c0ffee00000000000000000000000000a1b2";
const HEALTHY_ADDR = "0x9e0d1c2b3a49586776655443322110ffeeddccbb";
const REFUSED_ADDR = "0x4444444444444444444444444444444444444404";
const USDC = { asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 };
const WEETH = { asset: weethWitness.asset, symbol: "weETH", decimals: 18 };
const ETHFI = { asset: "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f", symbol: "ETHFI", decimals: 18 };

const PRICE_DECIMALS = weethWitness.decimals; // 6
const WEETH_PRICE = BigInt(weethWitness.value); // $4,000.00
const ETHFI_PRICE = 1250000n; // $1.25
const LTV_BPS = { weETH: 5000n, ETHFI: 2000n };
const USD = (dollars) => BigInt(Math.round(dollars * 1e6)); // Cash value_decimals = 6
const TOKEN = (units) => BigInt(Math.round(units * 1e6)) * 10n ** 12n; // 18-dec amounts, 6 places of precision
const ceilDiv = (a, b) => (a + b - 1n) / b;
const s = (v) => v.toString();
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;

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
    health_factor: null,
    total_collateral_base: refused ? null : s(collateral),
    total_debt_base: s(debtUsd),
    weighted_lt_sum: null,
    avg_lt_bps: null,
    legs: wireLegs,
    price_inputs: [priceInput(WEETH, WEETH_PRICE), priceInput(ETHFI, ETHFI_PRICE)],
    as_of: {
      balances_block: dm.last_block,
      params_block: 155300000,
      sweep_block: dm.last_block - 54,
      oldest_price_input: PRICE_AS_OF,
      stale_price_inputs: false,
      note: "each leg additionally carries its OWN rate-index as-of block.",
    },
  };
  if (refused) {
    const position = {
      ...base,
      status: "refused",
      flags: ["sweep_failed"],
      refusal: { code: "SWEEP_FAILED", detail: "collateral sweep failed for this account in this batch", note: "a refused row keeps its persisted debt for display; no verdict is served for it." },
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
  const points = [];
  for (let k = 0; k < COUNT; k += 1) {
    const back = COUNT - 1 - k;
    const id = BATCH.id - back;
    if (withheld.includes(id)) continue;
    const balancesBlock = dm.last_block - back * BLOCKS_PER_BATCH;
    const common = { batch_id: id, computed_at: iso(computedMs - back * CADENCE_MS), balances_block: balancesBlock, sweep_block: balancesBlock - 54 };
    if (id === refusedAt) {
      points.push({ ...common, status: "refused", refusal: { code: "SWEEP_FAILED", detail: "collateral sweep failed for this account in this batch", note: "" }, health_factor: null, liquidatable: null, total_collateral_base: null, total_debt_base: null });
      continue;
    }
    let cap;
    let collateral;
    if (k === COUNT - 1) {
      cap = near.cap;
      collateral = near.collateral;
    } else {
      const t = k / (COUNT - 1);
      const wobble = k < 84 ? 0.4 * Math.sin(k * 1.7) : 0;
      const roomPct = 38 - 34.2 * t ** 1.4 + wobble; // k ≥ 86 → under 10 %
      cap = USD(Number(near.debt) / 1e6 / (1 - roomPct / 100));
      collateral = (cap * near.collateral) / near.cap;
    }
    points.push({
      ...common,
      status: "computed",
      refusal: null,
      health_factor: { wad: null, num: s(cap), den: s(near.debt), infinite: false, note: "the Debt Manager's MaxBorrowLT / Borrowings as an exact rational — a disclosure, not the verdict; the strict boolean decides." },
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
  const ev = (blocksBack, minutesAgo, type, token, amount, unit, decimals, logIndex) => ({
    chain_id: 10,
    engine: "debt_manager",
    block_number: dm.last_block - blocksBack,
    block_time: minutesAgo === null ? null : iso(servedMs - minutesAgo * 60_000),
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
    amount_decimals: decimals,
    liquidation: null,
  });
  return {
    served_at: SERVED_AT,
    filter: { engine: null, account, types: [], since_block: null },
    limit: 25,
    events: [
      ev(344, 9, "borrow", USDC, "622000000", "dm_normalized_debt", null, 12),
      ev(1444, 25, "supply", WEETH, s(TOKEN(0.6)), "opaque", 18, 4),
      ev(1454, 25, "collateral_enabled", WEETH, null, "none", null, 3),
      ev(2944, 48, "supply", ETHFI, s(TOKEN(1250)), "opaque", 18, 7),
      ev(5444, 110, "borrow", USDC, "4200000000", "dm_normalized_debt", null, 2),
      ev(8444, null, "repay", USDC, "150000000", "dm_normalized_debt", null, 9),
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
  const def = (id) => {
    const d = scenarios.scenarios.find((x) => x.id === id);
    if (d === undefined) throw new Error(`scenarios.json lacks ${id}`);
    return d;
  };
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
    note: stressTemplate.scenarios[0].results[0].projection.note,
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
      { ...def("eth_minus_30"), results: [result(shocked(WEETH, 70n, 100n))] },
      { ...def("ethfi_minus_50"), results: [result(shocked(ETHFI, 50n, 100n))] },
      { ...def("dm_rate_horizon_plus_200bps"), results: [result({ after: before, applied_shocks: [], held_flat: [], projection })] },
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
```

Run: `node tests/fixtures/demo/generate-demo-inspector.mjs` (from `web/`)
Expected: eight `wrote …` lines. If `checkClocks` reports a failure, the age is wrong relative to its stamp — fix the STAMP or the derivation; never hand-edit an `age_seconds`. If `scenarios.json`'s `scenario_config_version` is absent, read it from `stress-dm.json` instead.

- [ ] **Step 4: The index**

Append to `web/tests/fixtures/demo/index.ts`:

```ts
/** GENERATED by generate-demo-inspector.mjs — see its provenance header. The near account is the mockup's. */
export const DEMO_ADDRESS_NEAR: Schemas["AddressResponse"] = load("address-demo-near.json");
export const DEMO_ADDRESS_LIQUIDATABLE: Schemas["AddressResponse"] = load("address-demo-liquidatable.json");
export const DEMO_ADDRESS_HEALTHY: Schemas["AddressResponse"] = load("address-demo-healthy.json");
export const DEMO_ADDRESS_REFUSED: Schemas["AddressResponse"] = load("address-demo-refused.json");
export const DEMO_HISTORY_NEAR: Schemas["AddressHistoryResponse"] = load("history-demo-near.json");
export const DEMO_EVENTS_NEAR: Schemas["EventsResponse"] = load("events-demo-near.json");
export const DEMO_PARAMS_DM: Schemas["ParamsResponse"] = load("params-demo-dm.json");
export const DEMO_STRESS_NEAR: Schemas["StressResponse"] = load("stress-demo-near.json");
export const DEMO_NEAR_ADDR: string = DEMO_ADDRESS_NEAR.address;
export const DEMO_LIQUIDATABLE_ADDR: string = DEMO_ADDRESS_LIQUIDATABLE.address;
export const DEMO_HEALTHY_ADDR: string = DEMO_ADDRESS_HEALTHY.address;
export const DEMO_REFUSED_ADDR: string = DEMO_ADDRESS_REFUSED.address;
```

- [ ] **Step 5: The census**

Run: `npx playwright test --project=unit tests/unit/fixture-clock-law.spec.ts`
Expected: FAIL with the census message naming each new demo file that "states an age nobody pinned", with its checked-clock count. Add one `"demo/<file>.json": <count>` entry per named file to `CENSUS` in `web/tests/unit/fixture-clock-law.spec.ts` (keyed the way the existing `demo/…` entries are), and raise `CENSUS_TOTAL` by the sum of the new counts. Re-run — Expected: PASS. (The `directories` pin stays `["demo"]`; the batch-bearing pin, if it counts files, rises by the six batch-bearing bodies — the four address bodies, the history and the stress — move it by six.)

- [ ] **Step 6: Run the weld spec and the whole unit project**

Run: `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts && npx playwright test --project=unit`
Expected: 6 passed; the whole unit project green.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/fixtures/demo/generate-demo-inspector.mjs web/tests/fixtures/demo/address-demo-near.json web/tests/fixtures/demo/address-demo-liquidatable.json web/tests/fixtures/demo/address-demo-healthy.json web/tests/fixtures/demo/address-demo-refused.json web/tests/fixtures/demo/history-demo-near.json web/tests/fixtures/demo/events-demo-near.json web/tests/fixtures/demo/params-demo-dm.json web/tests/fixtures/demo/stress-demo-near.json web/tests/fixtures/demo/index.ts web/tests/unit/fixture-clock-law.spec.ts web/tests/unit/demo-inspector-weld.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Inspector demo dataset - the mockup's near-cap account on batch 18,251, generated under the clock law and welded to the Book's demo"
```

---

