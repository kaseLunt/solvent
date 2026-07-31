// Inspector mock-route fixtures — generated FROM `api/openapi.yaml`'s own
// response examples, never hand-shaped:
//
//   - the batch envelope + the Aave position (incl. its STALE price verdict)
//     are the `/v1/positions` example, verbatim;
//   - the history body is the `/v1/address/{addr}/history` example, verbatim
//     (its batch-1 point is REFUSED · G1 — the sparkline-gap case);
//   - the events page is the `/v1/events` example, verbatim (its second row
//     carries `block_time: null` — the block-number-fallback case);
//   - the params page is the `/v1/params` example, verbatim (its weETH row's
//     effective_block 25,635,600 IS the position's params mark);
//   - the Debt Manager position is COMPOSED from example fragments (run-book
//     example's DM aggregates: debt 4620000000 > maxBorrowLT 4200000000 —
//     the engine's own strict comparator made visible; account + asset from
//     the events example; as-ofs from the batch watermarks / params example).
//     The only non-example literals are the DM price input's value/age, chosen
//     to satisfy the contract's own consistency (fresh ⇔ age < budget) and
//     commented inline.
//
// Addresses (all from the examples):
//   found      0xAAaA000000000000000000000000000000000001
//   not-found  0xBBbB000000000000000000000000000000000002 (the example liquidator)
//   unknowable 0xccCc000000000000000000000000000000000003 (the example DM borrower)

import type { components } from "@solvent/client";

type Schemas = components["schemas"];

export const FOUND_ADDR = "0xAAaA000000000000000000000000000000000001";
export const NOT_FOUND_ADDR = "0xBBbB000000000000000000000000000000000002";
export const UNKNOWABLE_ADDR = "0xccCc000000000000000000000000000000000003";

/** The `/v1/positions` example's batch envelope, verbatim. */
const BATCH: Schemas["Batch"] = {
  id: 1,
  computed_at: "2026-07-29T10:00:00Z",
  age_seconds: 5,
  producer: "riskd",
  status: "complete",
  position_count: 4,
  refused_count: 2,
  refused_engines: [],
  flagged_count: 1,
  watermarks: [
    {
      engine: "aave_v3_etherfi",
      chain_id: 1,
      last_block: 25635618,
      acked_epoch: 0,
      max_epoch_at_compute: 0,
      sweep: null,
    },
    {
      engine: "debt_manager",
      chain_id: 10,
      last_block: 154796552,
      acked_epoch: 0,
      max_epoch_at_compute: 0,
      sweep: {
        rows: 3,
        failed: 1,
        success_sum: "309593004",
        max_updated_at: "2026-07-29T09:40:00Z",
        age_seconds: 1200,
        generation: 4,
        generation_open: false,
      },
    },
  ],
  supersession: {
    superseded: false,
    legs: [],
    note: "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass.",
  },
};

/** The `/v1/positions` example's Aave position, verbatim (stale price verdict included). */
const AAVE_POSITION: Schemas["Position"] = {
  engine: "aave_v3_etherfi",
  account: FOUND_ADDR,
  status: "computed",
  value_decimals: 8,
  refusal: null,
  flags: ["stale_price"],
  health_factor: {
    wad: "1080000000000000000",
    num: "6480000000000000",
    den: "6000000000000000",
    infinite: false,
    note: "compare against 1e18 ON THE WAD; do not re-derive a float from num/den to decide eligibility.",
  },
  liquidatable: null,
  total_collateral_base: "800000000000",
  total_debt_base: "600000000000",
  weighted_lt_sum: "6480000000000000",
  avg_lt_bps: "8100",
  collateral_value_usd: null,
  max_borrow_lt: null,
  borrowings: null,
  legs: [
    {
      asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      symbol: "weETH",
      decimals: 18,
      live_debt: null,
      live_collateral: "2000000000000000000",
      debt_base: null,
      collateral_base: "800000000000",
      weighted_lt: "6480000000000000",
      used_as_collateral: true,
      debt_index_block: null,
      collateral_index_block: 25635618,
      amount: null,
      value_usd: null,
      max_borrow_contribution: null,
      liq_threshold: "8100",
      liq_bonus: "10500",
    },
  ],
  price_inputs: [
    {
      asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      chain_id: 1,
      source: "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
      provenance: "adapter-output",
      value: "400000000000",
      decimals: 8,
      block_number: 25635610,
      source_as_of: "2026-07-29T09:56:30Z",
      budget_seconds: 180,
      verdict: "stale",
      age_seconds: 210,
      fresh: false,
      note: "older than its budget but within the ceiling: COMPUTED AND FLAGGED, and the flag propagates into every aggregate containing it.",
    },
  ],
  as_of: {
    balances_block: 25635618,
    params_block: 25635600,
    sweep_block: 0,
    oldest_price_input: "2026-07-29T09:56:30Z",
    stale_price_inputs: true,
    note: "each leg additionally carries its OWN rate-index as-of block.",
  },
  liquidation_price: {
    in_factor: true,
    never_liquidatable: false,
    scale_factor_num: "6000000000000000",
    scale_factor_den: "6480000000000000",
    already_breached: false,
    prices: [
      {
        asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
        current_price: "400000000000",
        price_decimals: 8,
        price_floor: "370370370370",
        lowest_healthy_price: "370370370371",
      },
    ],
    factor_assets: ["0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"],
    held_assets: ["0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"],
    boundary_is_healthy: true,
    per_token_floor_omitted: false,
    diagnostic: false,
    axis: "eth_usd",
    note: "at exactly this price the position is HEALTHY — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil.",
  },
};

/**
 * A Debt Manager position COMPOSED from example fragments: the run-book
 * example's DM engine block establishes debt 4,620.000000 > maxBorrowLT
 * 4,200.000000 (eligible), collateral 4,000.000000, usd 6-dec; account/asset
 * from the events example; as-ofs from the batch watermark (154,796,552),
 * the params example's DM effective_block (154,790,000) and the events
 * example's DM block (154,796,490).
 */
const DM_POSITION: Schemas["Position"] = {
  engine: "debt_manager",
  account: FOUND_ADDR,
  status: "computed",
  value_decimals: 6,
  refusal: null,
  flags: [],
  health_factor: null,
  liquidatable: true,
  total_collateral_base: "4000000000",
  total_debt_base: "4620000000",
  weighted_lt_sum: null,
  avg_lt_bps: null,
  collateral_value_usd: "4000000000",
  max_borrow_lt: "4200000000",
  borrowings: "4620000000",
  legs: [
    {
      asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      symbol: "USDC",
      decimals: 6,
      live_debt: null,
      live_collateral: null,
      debt_base: null,
      collateral_base: null,
      weighted_lt: null,
      used_as_collateral: null,
      debt_index_block: null,
      collateral_index_block: null,
      amount: "4620000000",
      value_usd: "4620000000",
      max_borrow_contribution: "4200000000",
      liq_threshold: null,
      liq_bonus: null,
    },
  ],
  price_inputs: [
    {
      asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      chain_id: 10,
      source: "priceproviderv2",
      provenance: "engine-exact",
      // 1.00 at 8 decimals (the stable par the contract's snap-band prose is
      // written against); age 90 < budget 180 so `fresh` is self-consistent.
      value: "100000000",
      decimals: 8,
      block_number: 154793990,
      source_as_of: "2026-07-29T09:56:30Z",
      budget_seconds: 180,
      verdict: "fresh",
      age_seconds: 90,
      fresh: true,
      note: "engine-exact custody: the value the engine itself computed with.",
    },
  ],
  as_of: {
    balances_block: 154796552,
    params_block: 154790000,
    sweep_block: 154796490,
    oldest_price_input: "2026-07-29T09:56:30Z",
    stale_price_inputs: false,
    note: "each leg additionally carries its OWN rate-index as-of block.",
  },
  liquidation_price: null,
};

const LOOKUP_NOTE =
  "every engine was available in the newest servable batch, so `found` is a definitive answer there; older points speak only for their own batches.";

/** found: true — both engines, one address (the aave leg carries the STALE verdict). */
export const ADDRESS_FOUND: Schemas["AddressResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  batch: BATCH,
  address: FOUND_ADDR,
  positions: [AAVE_POSITION, DM_POSITION],
  found: true,
  lookup_complete: true,
  withheld_engines: [],
  lookup_complete_note: LOOKUP_NOTE,
  notes: [],
};

/** found: false — the DEFINITIVE negative (complete lookup, nothing withheld). */
export const ADDRESS_NOT_FOUND: Schemas["AddressResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  batch: BATCH,
  address: NOT_FOUND_ADDR,
  positions: [],
  found: false,
  lookup_complete: true,
  withheld_engines: [],
  lookup_complete_note: LOOKUP_NOTE,
  notes: [],
};

/** The engine-scoped refusal for the unknowable case (EngineRefusal schema; code from the observatory example). */
const DM_WITHHELD: Schemas["EngineRefusal"] = {
  engine: "debt_manager",
  code: "FLAG_CUSTODY_UNPROVEN",
  detail: "the engine's whole book is withheld: collateral-flag custody is unproven for this window",
  note: "a withheld engine is NEVER representable as an empty healthy one: its totals are null rather than zero.",
};

/** found: null — CANNOT be established (a whole book withheld). Never "no position". */
export const ADDRESS_UNKNOWABLE: Schemas["AddressResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  batch: {
    ...BATCH,
    // Batch.refused_engines is the NAME list; the full refusal rides withheld_engines.
    refused_engines: [DM_WITHHELD.engine],
  },
  address: UNKNOWABLE_ADDR,
  positions: [],
  found: null,
  lookup_complete: false,
  withheld_engines: [DM_WITHHELD],
  lookup_complete_note:
    "a relevant engine's whole book is withheld, so this lookup cannot establish a definitive answer.",
  notes: [],
};

/** The `/v1/address/{addr}/history` example, verbatim (batch 1 is REFUSED · G1). */
export const HISTORY: Schemas["AddressHistoryResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  batch: {
    id: 2,
    computed_at: "2026-07-29T10:00:00Z",
    age_seconds: 5,
    producer: "riskd",
    status: "complete",
    position_count: 4,
    refused_count: 2,
    refused_engines: [],
    flagged_count: 1,
    watermarks: [
      {
        engine: "aave_v3_etherfi",
        chain_id: 1,
        last_block: 25635618,
        acked_epoch: 0,
        max_epoch_at_compute: 0,
        sweep: null,
      },
    ],
    supersession: {
      superseded: false,
      legs: [],
      note: "evaluated against a live read of the cursor and epoch tables.",
    },
  },
  address: FOUND_ADDR,
  limit: 100,
  engines: [
    {
      engine: "aave_v3_etherfi",
      value_decimals: 8,
      points: [
        {
          batch_id: 2,
          computed_at: "2026-07-29T10:00:00Z",
          balances_block: 25635618,
          sweep_block: 0,
          status: "computed",
          refusal: null,
          health_factor: {
            wad: "1080000000000000000",
            num: "6480000000000000",
            den: "6000000000000000",
            infinite: false,
            note: "compare against 1e18 ON THE WAD.",
          },
          liquidatable: null,
          total_collateral_base: "800000000000",
          total_debt_base: "600000000000",
        },
        {
          batch_id: 1,
          computed_at: "2026-07-29T09:45:00Z",
          balances_block: 25635540,
          sweep_block: 0,
          status: "refused",
          refusal: {
            code: "G1",
            detail: "weETH/aaveoracle price input missing at compute time",
            note: "a refused batch is a POINT in this history, not a gap: the position existed and could not honestly be valued.",
          },
          health_factor: null,
          liquidatable: null,
          total_collateral_base: null,
          total_debt_base: null,
        },
      ],
      withheld_batch_ids: [],
      note: "points are persisted rows from retained batches, newest first; nothing is recomputed for this response.",
    },
  ],
  found: true,
  lookup_complete: true,
  withheld_engines: [],
  lookup_complete_note: LOOKUP_NOTE,
  notes: [
    "retention bounds this history: batches outside the retention window are gone from this surface, and their absence is stated by `limit`, never rendered as a flat line.",
  ],
};

/** The `/v1/events` example, verbatim (second row: block_time null → block-number fallback). */
export const EVENTS: Schemas["EventsResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  filter: {
    engine: null,
    account: null,
    types: [],
    since_block: null,
  },
  limit: 2,
  events: [
    {
      chain_id: 1,
      engine: "aave_v3_etherfi",
      block_number: 25635601,
      block_time: "2026-07-29T09:57:11Z",
      tx_hash: "0x9c33269e9d8f01d1db494ca4cf693c99377f78f9628c1b74d5a1a8592e0f2a11",
      log_index: 42,
      seq: 0,
      type: "liquidation",
      raw_type: "aave_liquidation_call",
      account: FOUND_ADDR,
      asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      amount: "-2499100000",
      amount_unit: "aave_scaled",
      amount_decimals: null,
      liquidation: {
        liquidator: NOT_FOUND_ADDR,
        debt_asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        debt_repaid: "2500000000",
        debt_decimals: 6,
        deficit_paired: false,
        before_debt_usd: null,
        interest_index: null,
        seized: [
          {
            asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
            symbol: "weETH",
            amount: "656250000000000000",
            decimals: 18,
            bonus: null,
          },
        ],
        realized_bonus_bps: null,
        configured_bonus_bps: "500",
        note: "extracted from the event's own structured payload; amounts are in each asset's own token units. `configured_bonus_bps` is the ledger's bonus AT THIS EVENT's effective params; `realized_bonus_bps` would need event-time prices this service does not re-read, so it is null — never estimated.",
      },
    },
    {
      chain_id: 10,
      engine: "debt_manager",
      block_number: 154796490,
      block_time: null,
      tx_hash: "0x51f0b3e2a4c1d99e21b7a30e12cf5a2b9a4a7c1de00b53219a6f2f41c86a7702",
      log_index: 7,
      seq: 0,
      type: "borrow",
      raw_type: "borrow",
      account: UNKNOWABLE_ADDR,
      asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      symbol: "USDC",
      amount: "1199403000",
      amount_unit: "dm_normalized_debt",
      amount_decimals: null,
      liquidation: null,
    },
  ],
  next_cursor: null,
  notes: [
    "`block_time` is null until the block's header is custodied — header time is chain-asserted or absent, never fabricated. Render the block number in the meantime.",
    "ordering is (block_number, tx_hash, log_index, seq) DESC across engines; the block numbers of two chains are not comparable as TIME.",
  ],
};

/** The `/v1/params` example, verbatim (weETH row @ 25,635,600 = the position's params mark). */
export const PARAMS: Schemas["ParamsResponse"] = {
  served_at: "2026-07-29T10:00:05Z",
  engine: null,
  asset: null,
  params: [
    {
      engine: "aave_v3_etherfi",
      chain_id: 1,
      asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      symbol: "weETH",
      fields: [
        { name: "ltv", value: "7800", address: null, prior: null, unit: "bps" },
        { name: "liq_threshold", value: "8100", address: null, prior: null, unit: "bps" },
        { name: "liq_bonus", value: "10500", address: null, prior: null, unit: "bps" },
      ],
      effective_block: 25635600,
      effective_log_index: 12,
      source_event: "CollateralConfigurationChanged",
      tx_hash: "0x2b8a1f0e6c33269e9d8f01d1db494ca4cf693c99377f78f9628c1b74d5a1a859",
      block_time: "2026-07-29T09:57:00Z",
    },
    {
      engine: "debt_manager",
      chain_id: 10,
      asset: null,
      fields: [
        {
          name: "borrow_apy",
          value: "50000000000000000",
          address: null,
          prior: "40000000000000000",
          unit: "per-second-1e18",
        },
      ],
      effective_block: 154790000,
      effective_log_index: 3,
      source_event: "borrow_apy_set",
      tx_hash: "0x7702a4c1d99e21b7a30e12cf5a2b9a4a7c1de00b53219a6f2f41c86a51f0b3e2",
      block_time: null,
    },
  ],
  next_cursor: null,
  notes: [
    "denominations are the ENGINE's own and are named per field: Aave publishes bps (1e4 scale); the Debt Manager's percent scale is 100e18. No cross-engine normalization exists.",
    "`block_time` is null until the block's header is custodied — never fabricated.",
  ],
};
