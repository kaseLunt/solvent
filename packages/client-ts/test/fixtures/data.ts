// GENERATED FIXTURE DATA — see index.ts for provenance. Do not hand-edit.
//
// Each export is a fresh object literal checked with `satisfies` against the
// type GENERATED from api/openapi.yaml. That check is test category (1),
// type-level conformance, and it is enforced by `npm run typecheck`: a contract
// field renamed, retyped, made required, or removed breaks this file.
//
// `test/fixtures.test.ts` additionally proves each committed .json file is
// byte-identical in content to its literal here, so the recorded wire bytes and
// the type-checked object can never drift apart.

import type {
  AddressResponse,
  BookResponse,
  ErrorBody,
  MetaResponse,
  ObservatoryResponse,
  StreamPayload,
  StressResponse,
} from "../../src/types.js";

/** Every fixture's source file, keyed by export name. */
export const FIXTURE_FILES = {
  book: "book.json",
  bookEngineRefused: "book-engine-refused.json",
  addressAave: "address-aave.json",
  addressAaveRefused: "address-aave-refused.json",
  addressDM: "address-dm.json",
  addressDMRefused: "address-dm-refused.json",
  addressNotFound: "address-not-found.json",
  addressUnknowable: "address-unknowable.json",
  addressPartial: "address-partial.json",
  stressAave: "stress-aave.json",
  stressDM: "stress-dm.json",
  stressUnknowable: "stress-unknowable.json",
  observatory: "observatory.json",
  meta: "meta.json",
  metaNoBatch: "meta-no-batch.json",
  errorBadRequest: "errors/bad-request.json",
  errorNotFound: "errors/not-found.json",
  errorRateLimited: "errors/rate-limited.json",
  errorUnavailable: "errors/unavailable.json",
  errorInternal: "errors/internal.json",
  streamSnapshot: "stream/snapshot.json",
  streamSnapshotRecovered: "stream/snapshot-recovered.json",
  streamBatch: "stream/batch.json",
  streamDegradation: "stream/degradation.json",
  streamUnavailable: "stream/unavailable.json",
  streamUnavailableStale: "stream/unavailable-stale.json",
} as const;

export const book = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "refused_engines": [],
  "engines": [
    {
      "engine": "aave_v3_etherfi",
      "value_decimals": 8,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 1,
      "liquidatable_positions": 0,
      "refused": false,
      "refusal": null,
      "total_collateral": "800000000000",
      "total_debt": "600000000000",
      "refusals": [
        {
          "key": "G1",
          "count": 1
        }
      ],
      "flags": [
        {
          "key": "stale_price",
          "count": 1
        }
      ],
      "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    },
    {
      "engine": "debt_manager",
      "value_decimals": 6,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 0,
      "liquidatable_positions": 1,
      "refused": false,
      "refusal": null,
      "total_collateral": "4000000000",
      "total_debt": "4200000000",
      "refusals": [
        {
          "key": "SWEEP_NEVER",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    }
  ],
  "hf_histogram": {
    "wad_scale": "1000000000000000000",
    "engines": [
      {
        "refused": false,
        "refusal": null,
        "engine": "aave_v3_etherfi",
        "comparator": "hf_wad",
        "buckets": [
          {
            "label": "< 0.90",
            "lower_wad": null,
            "upper_wad": "900000000000000000",
            "count": 0
          },
          {
            "label": "0.90 – 1.00",
            "lower_wad": "900000000000000000",
            "upper_wad": "1000000000000000000",
            "count": 0
          },
          {
            "label": "1.00 – 1.05",
            "lower_wad": "1000000000000000000",
            "upper_wad": "1050000000000000000",
            "count": 0
          },
          {
            "label": "1.05 – 1.10",
            "lower_wad": "1050000000000000000",
            "upper_wad": "1100000000000000000",
            "count": 1
          },
          {
            "label": "1.10 – 1.25",
            "lower_wad": "1100000000000000000",
            "upper_wad": "1250000000000000000",
            "count": 0
          },
          {
            "label": "1.25 – 1.50",
            "lower_wad": "1250000000000000000",
            "upper_wad": "1500000000000000000",
            "count": 0
          },
          {
            "label": "1.50 – 2.00",
            "lower_wad": "1500000000000000000",
            "upper_wad": "2000000000000000000",
            "count": 0
          },
          {
            "label": ">= 2.00",
            "lower_wad": "2000000000000000000",
            "upper_wad": null,
            "count": 0
          }
        ],
        "infinite_count": 0,
        "refused_count": 1,
        "note": "buckets are the pool's own health-factor WAD. Aave liquidates STRICTLY BELOW 1e18, so `< 1.00` is the eligible set and exactly 1.00 is healthy."
      },
      {
        "refused": false,
        "refusal": null,
        "engine": "debt_manager",
        "comparator": "hf_num/hf_den",
        "buckets": [
          {
            "label": "< 0.90",
            "lower_wad": null,
            "upper_wad": "900000000000000000",
            "count": 1
          },
          {
            "label": "0.90 – 1.00",
            "lower_wad": "900000000000000000",
            "upper_wad": "1000000000000000000",
            "count": 0
          },
          {
            "label": "1.00 – 1.05",
            "lower_wad": "1000000000000000000",
            "upper_wad": "1050000000000000000",
            "count": 0
          },
          {
            "label": "1.05 – 1.10",
            "lower_wad": "1050000000000000000",
            "upper_wad": "1100000000000000000",
            "count": 0
          },
          {
            "label": "1.10 – 1.25",
            "lower_wad": "1100000000000000000",
            "upper_wad": "1250000000000000000",
            "count": 0
          },
          {
            "label": "1.25 – 1.50",
            "lower_wad": "1250000000000000000",
            "upper_wad": "1500000000000000000",
            "count": 0
          },
          {
            "label": "1.50 – 2.00",
            "lower_wad": "1500000000000000000",
            "upper_wad": "2000000000000000000",
            "count": 0
          },
          {
            "label": ">= 2.00",
            "lower_wad": "2000000000000000000",
            "upper_wad": null,
            "count": 0
          }
        ],
        "infinite_count": 0,
        "refused_count": 1,
        "note": "the Debt Manager has no health-factor wad: its liquidation test is the strict boolean `debt > maxBorrowLT`. These buckets are the EXACT rational maxBorrowLT/borrowings, a disclosure only — take eligibility from `liquidatable_positions`."
      }
    ]
  },
  "waterfall": {
    "scenario_id": "eth_minus_30",
    "scenario_version": "v1",
    "axis": "eth_usd",
    "grid_scale": "1000000000000000000",
    "points": [
      {
        "index": 0,
        "factor": "1000000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 0,
            "cumulative_debt_eligible_usd": "0",
            "cumulative_collateral_at_risk_usd": "0",
            "insolvent_if_liquidated_accounts": 0,
            "cumulative_bad_debt_usd": "0"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 1,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "4000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "239603961"
          }
        ]
      },
      {
        "index": 1,
        "factor": "900000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 1,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "600000000000",
            "cumulative_collateral_at_risk_usd": "630000000000",
            "insolvent_if_liquidated_accounts": 0,
            "cumulative_bad_debt_usd": "0"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "3600000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "635643565"
          }
        ]
      },
      {
        "index": 2,
        "factor": "800000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "600000000000",
            "cumulative_collateral_at_risk_usd": "630000000000",
            "insolvent_if_liquidated_accounts": 0,
            "cumulative_bad_debt_usd": "0"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "3200000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1031683169"
          }
        ]
      },
      {
        "index": 3,
        "factor": "700000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "600000000000",
            "cumulative_collateral_at_risk_usd": "560000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "66666666667"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2800000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1427722773"
          }
        ]
      },
      {
        "index": 4,
        "factor": "600000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "600000000000",
            "cumulative_collateral_at_risk_usd": "480000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "142857142858"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2400000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1823762377"
          }
        ]
      },
      {
        "index": 5,
        "factor": "500000000000000000",
        "engines": [
          {
            "engine": "aave_v3_etherfi",
            "usd_decimals": 8,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "600000000000",
            "cumulative_collateral_at_risk_usd": "400000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "219047619048"
          },
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "2219801981"
          }
        ]
      }
    ],
    "held_flat": [
      {
        "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "chain_id": 1,
        "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
        "value": "100000000"
      }
    ],
    "eligibility_note": "debt ELIGIBLE for liquidation; realized ≤ eligible (the Debt Manager closes in two passes, 50% then remainder)",
    "monotonicity": {
      "ok": true
    },
    "at_risk_note": "cumulative_collateral_at_risk_usd carries NO monotonicity invariant: it is measured AT each grid point, so it legitimately falls once already-crossed accounts are worth less. Do not render it as a monotone accumulation.",
    "excluded_engines": []
  },
  "bad_debt": [
    {
      "engine": "aave_v3_etherfi",
      "usd_decimals": 8,
      "current_bad_debt_usd": "0",
      "insolvent_positions": 0,
      "eligible_positions": 0,
      "eligible_debt_usd": "0",
      "collateral_at_risk_usd": "0",
      "refused": false,
      "refusal": null
    },
    {
      "engine": "debt_manager",
      "usd_decimals": 6,
      "current_bad_debt_usd": "239603961",
      "insolvent_positions": 1,
      "eligible_positions": 1,
      "eligible_debt_usd": "4200000000",
      "collateral_at_risk_usd": "4000000000",
      "refused": false,
      "refusal": null
    }
  ],
  "coverage": {
    "batch_positions": 4,
    "in_book": 2,
    "refused_in_batch": 2,
    "excluded_by_this_layer": 0,
    "excluded": [],
    "withheld_engines": [],
    "stress_coverage_is_full": true,
    "note": "every position the batch carries is on the wire. `excluded` lists positions this layer could not rebuild into the pure library's input form — they are absent from the stress and waterfall arithmetic and are named here rather than dropped."
  },
  "notes": [
    "Aave base values are 8-decimal and Debt Manager USD is 6-decimal: the two engines are reported separately and are NEVER summed.",
    "Refused positions are counted in `refused_positions` and broken down by code in `refusals`. The book is served with its refusals, never without the positions that produced them."
  ]
} satisfies BookResponse;

export const bookEngineRefused = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 2,
    "refused_count": 1,
    "refused_engines": [
      "aave_v3_etherfi"
    ],
    "flagged_count": 0,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "refused_engines": [
    {
      "engine": "aave_v3_etherfi",
      "code": "FLAG_CUSTODY_UNPROVEN",
      "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
      "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
    }
  ],
  "engines": [
    {
      "engine": "aave_v3_etherfi",
      "value_decimals": 8,
      "positions": 0,
      "computed_positions": 0,
      "refused_positions": 0,
      "flagged_positions": 0,
      "liquidatable_positions": 0,
      "refused": true,
      "refusal": {
        "engine": "aave_v3_etherfi",
        "code": "FLAG_CUSTODY_UNPROVEN",
        "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
        "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
      },
      "total_collateral": null,
      "total_debt": null,
      "refusals": [
        {
          "key": "FLAG_CUSTODY_UNPROVEN",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    },
    {
      "engine": "debt_manager",
      "value_decimals": 6,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 0,
      "liquidatable_positions": 1,
      "refused": false,
      "refusal": null,
      "total_collateral": "4000000000",
      "total_debt": "4200000000",
      "refusals": [
        {
          "key": "SWEEP_NEVER",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    }
  ],
  "hf_histogram": {
    "wad_scale": "1000000000000000000",
    "engines": [
      {
        "refused": true,
        "refusal": {
          "engine": "aave_v3_etherfi",
          "code": "FLAG_CUSTODY_UNPROVEN",
          "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
          "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
        },
        "engine": "aave_v3_etherfi",
        "comparator": "hf_wad",
        "buckets": [
          {
            "label": "< 0.90",
            "lower_wad": null,
            "upper_wad": "900000000000000000",
            "count": 0
          },
          {
            "label": "0.90 – 1.00",
            "lower_wad": "900000000000000000",
            "upper_wad": "1000000000000000000",
            "count": 0
          },
          {
            "label": "1.00 – 1.05",
            "lower_wad": "1000000000000000000",
            "upper_wad": "1050000000000000000",
            "count": 0
          },
          {
            "label": "1.05 – 1.10",
            "lower_wad": "1050000000000000000",
            "upper_wad": "1100000000000000000",
            "count": 0
          },
          {
            "label": "1.10 – 1.25",
            "lower_wad": "1100000000000000000",
            "upper_wad": "1250000000000000000",
            "count": 0
          },
          {
            "label": "1.25 – 1.50",
            "lower_wad": "1250000000000000000",
            "upper_wad": "1500000000000000000",
            "count": 0
          },
          {
            "label": "1.50 – 2.00",
            "lower_wad": "1500000000000000000",
            "upper_wad": "2000000000000000000",
            "count": 0
          },
          {
            "label": ">= 2.00",
            "lower_wad": "2000000000000000000",
            "upper_wad": null,
            "count": 0
          }
        ],
        "infinite_count": 0,
        "refused_count": 0,
        "note": "buckets are the pool's own health-factor WAD. Aave liquidates STRICTLY BELOW 1e18, so `< 1.00` is the eligible set and exactly 1.00 is healthy."
      },
      {
        "refused": false,
        "refusal": null,
        "engine": "debt_manager",
        "comparator": "hf_num/hf_den",
        "buckets": [
          {
            "label": "< 0.90",
            "lower_wad": null,
            "upper_wad": "900000000000000000",
            "count": 1
          },
          {
            "label": "0.90 – 1.00",
            "lower_wad": "900000000000000000",
            "upper_wad": "1000000000000000000",
            "count": 0
          },
          {
            "label": "1.00 – 1.05",
            "lower_wad": "1000000000000000000",
            "upper_wad": "1050000000000000000",
            "count": 0
          },
          {
            "label": "1.05 – 1.10",
            "lower_wad": "1050000000000000000",
            "upper_wad": "1100000000000000000",
            "count": 0
          },
          {
            "label": "1.10 – 1.25",
            "lower_wad": "1100000000000000000",
            "upper_wad": "1250000000000000000",
            "count": 0
          },
          {
            "label": "1.25 – 1.50",
            "lower_wad": "1250000000000000000",
            "upper_wad": "1500000000000000000",
            "count": 0
          },
          {
            "label": "1.50 – 2.00",
            "lower_wad": "1500000000000000000",
            "upper_wad": "2000000000000000000",
            "count": 0
          },
          {
            "label": ">= 2.00",
            "lower_wad": "2000000000000000000",
            "upper_wad": null,
            "count": 0
          }
        ],
        "infinite_count": 0,
        "refused_count": 1,
        "note": "the Debt Manager has no health-factor wad: its liquidation test is the strict boolean `debt > maxBorrowLT`. These buckets are the EXACT rational maxBorrowLT/borrowings, a disclosure only — take eligibility from `liquidatable_positions`."
      }
    ]
  },
  "waterfall": {
    "scenario_id": "eth_minus_30",
    "scenario_version": "v1",
    "axis": "eth_usd",
    "grid_scale": "1000000000000000000",
    "points": [
      {
        "index": 0,
        "factor": "1000000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 1,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "4000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "239603961"
          }
        ]
      },
      {
        "index": 1,
        "factor": "900000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "3600000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "635643565"
          }
        ]
      },
      {
        "index": 2,
        "factor": "800000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "3200000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1031683169"
          }
        ]
      },
      {
        "index": 3,
        "factor": "700000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2800000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1427722773"
          }
        ]
      },
      {
        "index": 4,
        "factor": "600000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2400000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "1823762377"
          }
        ]
      },
      {
        "index": 5,
        "factor": "500000000000000000",
        "engines": [
          {
            "engine": "debt_manager",
            "usd_decimals": 6,
            "newly_eligible_accounts": 0,
            "cumulative_eligible_accounts": 1,
            "cumulative_debt_eligible_usd": "4200000000",
            "cumulative_collateral_at_risk_usd": "2000000000",
            "insolvent_if_liquidated_accounts": 1,
            "cumulative_bad_debt_usd": "2219801981"
          }
        ]
      }
    ],
    "held_flat": [
      {
        "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "chain_id": 1,
        "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
        "value": "100000000"
      }
    ],
    "eligibility_note": "debt ELIGIBLE for liquidation; realized ≤ eligible (the Debt Manager closes in two passes, 50% then remainder)",
    "monotonicity": {
      "ok": true
    },
    "at_risk_note": "cumulative_collateral_at_risk_usd carries NO monotonicity invariant: it is measured AT each grid point, so it legitimately falls once already-crossed accounts are worth less. Do not render it as a monotone accumulation.",
    "excluded_engines": [
      {
        "engine": "aave_v3_etherfi",
        "code": "FLAG_CUSTODY_UNPROVEN",
        "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
        "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
      }
    ]
  },
  "bad_debt": [
    {
      "engine": "aave_v3_etherfi",
      "usd_decimals": 8,
      "current_bad_debt_usd": null,
      "insolvent_positions": null,
      "eligible_positions": null,
      "eligible_debt_usd": null,
      "collateral_at_risk_usd": null,
      "refused": true,
      "refusal": {
        "engine": "aave_v3_etherfi",
        "code": "FLAG_CUSTODY_UNPROVEN",
        "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
        "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
      }
    },
    {
      "engine": "debt_manager",
      "usd_decimals": 6,
      "current_bad_debt_usd": "239603961",
      "insolvent_positions": 1,
      "eligible_positions": 1,
      "eligible_debt_usd": "4200000000",
      "collateral_at_risk_usd": "4000000000",
      "refused": false,
      "refusal": null
    }
  ],
  "coverage": {
    "batch_positions": 2,
    "in_book": 1,
    "refused_in_batch": 1,
    "excluded_by_this_layer": 0,
    "excluded": [],
    "withheld_engines": [
      {
        "engine": "aave_v3_etherfi",
        "code": "FLAG_CUSTODY_UNPROVEN",
        "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
        "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
      }
    ],
    "stress_coverage_is_full": false,
    "note": "every position the batch carries is on the wire. `excluded` lists positions this layer could not rebuild into the pure library's input form — they are absent from the stress and waterfall arithmetic and are named here rather than dropped."
  },
  "notes": [
    "Aave base values are 8-decimal and Debt Manager USD is 6-decimal: the two engines are reported separately and are NEVER summed.",
    "Refused positions are counted in `refused_positions` and broken down by code in `refusals`. The book is served with its refusals, never without the positions that produced them."
  ]
} satisfies BookResponse;

export const addressAave = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xAAaA000000000000000000000000000000000001",
  "positions": [
    {
      "engine": "aave_v3_etherfi",
      "account": "0xAAaA000000000000000000000000000000000001",
      "status": "computed",
      "value_decimals": 8,
      "refusal": null,
      "flags": [
        "stale_price"
      ],
      "health_factor": {
        "wad": "1080000000000000000",
        "num": "6480000000000000",
        "den": "6000000000000000",
        "infinite": false,
        "note": "`wad` is the pool's own health factor, a half-up composite over the exact weighted sum. Compare against 1e18 on the WAD; do not re-derive a float from num/den to decide eligibility."
      },
      "liquidatable": null,
      "total_collateral_base": "800000000000",
      "total_debt_base": "600000000000",
      "weighted_lt_sum": "6480000000000000",
      "avg_lt_bps": "8100",
      "collateral_value_usd": null,
      "max_borrow_lt": null,
      "borrowings": null,
      "legs": [
        {
          "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "symbol": "USDC",
          "decimals": 6,
          "live_debt": "6000000000",
          "live_collateral": null,
          "debt_base": "600000000000",
          "collateral_base": null,
          "weighted_lt": null,
          "used_as_collateral": false,
          "debt_index_block": 25635618,
          "collateral_index_block": null,
          "amount": null,
          "value_usd": null,
          "max_borrow_contribution": null,
          "liq_threshold": null,
          "liq_bonus": null
        },
        {
          "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
          "symbol": "weETH",
          "decimals": 18,
          "live_debt": null,
          "live_collateral": "2000000000000000000",
          "debt_base": null,
          "collateral_base": "800000000000",
          "weighted_lt": "6480000000000000",
          "used_as_collateral": true,
          "debt_index_block": null,
          "collateral_index_block": 25635618,
          "amount": null,
          "value_usd": null,
          "max_borrow_contribution": null,
          "liq_threshold": "8100",
          "liq_bonus": "10500"
        }
      ],
      "price_inputs": [
        {
          "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "chain_id": 1,
          "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
          "provenance": "adapter-output",
          "value": "100000000",
          "decimals": 8,
          "block_number": 25635610,
          "source_as_of": "2026-07-29T09:59:48Z",
          "budget_seconds": 180,
          "verdict": "fresh",
          "age_seconds": 12,
          "fresh": true,
          "note": "within this input's own budget at compute time."
        },
        {
          "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
          "chain_id": 1,
          "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
          "provenance": "adapter-output",
          "value": "400000000000",
          "decimals": 8,
          "block_number": 25635610,
          "source_as_of": "2026-07-29T09:56:30Z",
          "budget_seconds": 180,
          "verdict": "stale",
          "age_seconds": 210,
          "fresh": false,
          "note": "older than its budget but within the ceiling: COMPUTED AND FLAGGED (G4), and the flag propagates into every aggregate containing it."
        }
      ],
      "as_of": {
        "balances_block": 25635618,
        "params_block": 25635600,
        "sweep_block": 0,
        "oldest_price_input": "2026-07-29T09:56:30Z",
        "stale_price_inputs": true,
        "note": "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5])."
      },
      "liquidation_price": {
        "in_factor": true,
        "never_liquidatable": false,
        "scale_factor_num": "6000000000000000",
        "scale_factor_den": "6480000000000000",
        "already_breached": false,
        "prices": [
          {
            "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
            "current_price": "400000000000",
            "price_decimals": 8,
            "price_floor": "370370370370",
            "lowest_healthy_price": "370370370371"
          }
        ],
        "factor_assets": [
          "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"
        ],
        "held_assets": [
          "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"
        ],
        "boundary_is_healthy": true,
        "per_token_floor_omitted": false,
        "diagnostic": false,
        "axis": "eth_usd",
        "note": "at exactly this price the position is HEALTHY on both engines — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil."
      }
    }
  ],
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressAaveRefused = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xBbbb000000000000000000000000000000000002",
  "positions": [
    {
      "engine": "aave_v3_etherfi",
      "account": "0xBbbb000000000000000000000000000000000002",
      "status": "refused",
      "value_decimals": 8,
      "refusal": {
        "code": "G1",
        "detail": "aave health: no usable price input for asset 0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
        "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
        "note": "G1: no usable price input for the named asset — absent, carrying no chain-asserted as-of, or older than the ceiling (2x the budget). An unpriced asset is REFUSED, never silently dropped."
      },
      "flags": [],
      "health_factor": null,
      "liquidatable": null,
      "total_collateral_base": null,
      "total_debt_base": null,
      "weighted_lt_sum": null,
      "avg_lt_bps": null,
      "collateral_value_usd": null,
      "max_borrow_lt": null,
      "borrowings": null,
      "legs": [
        {
          "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
          "symbol": "weETH",
          "decimals": 18,
          "live_debt": null,
          "live_collateral": "500000000000000000",
          "debt_base": null,
          "collateral_base": null,
          "weighted_lt": null,
          "used_as_collateral": true,
          "debt_index_block": null,
          "collateral_index_block": 25635618,
          "amount": null,
          "value_usd": null,
          "max_borrow_contribution": null,
          "liq_threshold": null,
          "liq_bonus": null
        }
      ],
      "price_inputs": [
        {
          "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
          "chain_id": 1,
          "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
          "provenance": "adapter-output",
          "value": null,
          "decimals": null,
          "block_number": null,
          "source_as_of": null,
          "budget_seconds": 180,
          "verdict": "missing",
          "age_seconds": null,
          "fresh": false,
          "note": "no usable row at all: REFUSED (G1). The asset is named on the position that refused because of it."
        }
      ],
      "as_of": {
        "balances_block": 25635618,
        "params_block": 25635600,
        "sweep_block": 0,
        "oldest_price_input": null,
        "stale_price_inputs": false,
        "note": "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5])."
      },
      "liquidation_price": null
    }
  ],
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressDM = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xccCc000000000000000000000000000000000003",
  "positions": [
    {
      "engine": "debt_manager",
      "account": "0xccCc000000000000000000000000000000000003",
      "status": "computed",
      "value_decimals": 6,
      "refusal": null,
      "flags": [],
      "health_factor": {
        "wad": null,
        "num": "3200000000",
        "den": "4200000000",
        "infinite": false,
        "note": "the Debt Manager has no on-chain health factor: `num/den` is the exact ratio maxBorrowLT/borrowings, a disclosure. The liquidation test is the strict boolean `liquidatable`."
      },
      "liquidatable": true,
      "total_collateral_base": null,
      "total_debt_base": null,
      "weighted_lt_sum": null,
      "avg_lt_bps": null,
      "collateral_value_usd": "4000000000",
      "max_borrow_lt": "3200000000",
      "borrowings": "4200000000",
      "legs": [
        {
          "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
          "symbol": "weETH",
          "decimals": 18,
          "live_debt": null,
          "live_collateral": null,
          "debt_base": null,
          "collateral_base": null,
          "weighted_lt": null,
          "used_as_collateral": null,
          "debt_index_block": null,
          "collateral_index_block": null,
          "amount": "1000000000000000000",
          "value_usd": "4000000000",
          "max_borrow_contribution": "3200000000",
          "liq_threshold": "80000000000000000000",
          "liq_bonus": "1000000000000000000"
        }
      ],
      "price_inputs": [
        {
          "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
          "chain_id": 10,
          "source": "priceproviderv2",
          "provenance": "engine-exact",
          "value": "4000000000",
          "decimals": 6,
          "block_number": 154796540,
          "source_as_of": "2026-07-29T09:59:30Z",
          "budget_seconds": 180,
          "verdict": "fresh",
          "age_seconds": 30,
          "fresh": true,
          "note": "within this input's own budget at compute time."
        }
      ],
      "as_of": {
        "balances_block": 154796552,
        "params_block": 154796552,
        "sweep_block": 154796500,
        "oldest_price_input": "2026-07-29T09:59:30Z",
        "stale_price_inputs": false,
        "note": "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5])."
      },
      "liquidation_price": {
        "in_factor": true,
        "never_liquidatable": false,
        "scale_factor_num": "4200000000",
        "scale_factor_den": "3200000000",
        "already_breached": true,
        "prices": [
          {
            "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
            "current_price": "4000000000",
            "price_decimals": 6,
            "price_floor": "5250000000",
            "lowest_healthy_price": "5250000000"
          }
        ],
        "factor_assets": [
          "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF"
        ],
        "held_assets": [
          "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF"
        ],
        "boundary_is_healthy": true,
        "per_token_floor_omitted": false,
        "diagnostic": false,
        "axis": "eth_usd",
        "note": "at exactly this price the position is HEALTHY on both engines — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil."
      }
    }
  ],
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressDMRefused = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xddDD000000000000000000000000000000000004",
  "positions": [
    {
      "engine": "debt_manager",
      "account": "0xddDD000000000000000000000000000000000004",
      "status": "refused",
      "value_decimals": 6,
      "refusal": {
        "code": "SWEEP_NEVER",
        "detail": "account has never had a successful collateral sweep (last_success_block 0)",
        "note": "SWEEP_NEVER: this account has never had a successful collateral sweep, so its collateral is of UNKNOWN size — not zero. Serving a health factor near zero over it would be a false liquidation alarm."
      },
      "flags": [],
      "health_factor": null,
      "liquidatable": null,
      "total_collateral_base": null,
      "total_debt_base": null,
      "weighted_lt_sum": null,
      "avg_lt_bps": null,
      "collateral_value_usd": null,
      "max_borrow_lt": null,
      "borrowings": "1500000000",
      "legs": [],
      "price_inputs": [],
      "as_of": {
        "balances_block": 154796552,
        "params_block": 154796552,
        "sweep_block": 0,
        "oldest_price_input": null,
        "stale_price_inputs": false,
        "note": "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5])."
      },
      "liquidation_price": null
    }
  ],
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressNotFound = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xEeEE000000000000000000000000000000000005",
  "positions": [],
  "found": false,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressUnknowable = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 2,
    "refused_count": 1,
    "refused_engines": [
      "aave_v3_etherfi"
    ],
    "flagged_count": 0,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xAAaA000000000000000000000000000000000001",
  "positions": [],
  "found": null,
  "lookup_complete": false,
  "withheld_engines": [
    {
      "engine": "aave_v3_etherfi",
      "code": "FLAG_CUSTODY_UNPROVEN",
      "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
      "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
    }
  ],
  "lookup_complete_note": "one or more engines are withheld and could not be consulted, so this lookup is INCOMPLETE. `found: null` means the answer cannot be established — never that no position exists; `found: true` under an incomplete lookup is a FLOOR, not a total.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const addressPartial = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 2,
    "refused_count": 1,
    "refused_engines": [
      "aave_v3_etherfi"
    ],
    "flagged_count": 0,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xccCc000000000000000000000000000000000003",
  "positions": [
    {
      "engine": "debt_manager",
      "account": "0xccCc000000000000000000000000000000000003",
      "status": "computed",
      "value_decimals": 6,
      "refusal": null,
      "flags": [],
      "health_factor": {
        "wad": null,
        "num": "3200000000",
        "den": "4200000000",
        "infinite": false,
        "note": "the Debt Manager has no on-chain health factor: `num/den` is the exact ratio maxBorrowLT/borrowings, a disclosure. The liquidation test is the strict boolean `liquidatable`."
      },
      "liquidatable": true,
      "total_collateral_base": null,
      "total_debt_base": null,
      "weighted_lt_sum": null,
      "avg_lt_bps": null,
      "collateral_value_usd": "4000000000",
      "max_borrow_lt": "3200000000",
      "borrowings": "4200000000",
      "legs": [
        {
          "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
          "symbol": "weETH",
          "decimals": 18,
          "live_debt": null,
          "live_collateral": null,
          "debt_base": null,
          "collateral_base": null,
          "weighted_lt": null,
          "used_as_collateral": null,
          "debt_index_block": null,
          "collateral_index_block": null,
          "amount": "1000000000000000000",
          "value_usd": "4000000000",
          "max_borrow_contribution": "3200000000",
          "liq_threshold": "80000000000000000000",
          "liq_bonus": "1000000000000000000"
        }
      ],
      "price_inputs": [
        {
          "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
          "chain_id": 10,
          "source": "priceproviderv2",
          "provenance": "engine-exact",
          "value": "4000000000",
          "decimals": 6,
          "block_number": 154796540,
          "source_as_of": "2026-07-29T09:59:30Z",
          "budget_seconds": 180,
          "verdict": "fresh",
          "age_seconds": 30,
          "fresh": true,
          "note": "within this input's own budget at compute time."
        }
      ],
      "as_of": {
        "balances_block": 154796552,
        "params_block": 154796552,
        "sweep_block": 154796500,
        "oldest_price_input": "2026-07-29T09:59:30Z",
        "stale_price_inputs": false,
        "note": "each leg additionally carries its OWN rate-index as-of block: `rate_indexes` updates only on ReserveDataUpdated and can trail the balances cursor, so one balances watermark over an old index would hide the debt leg's true shelf life (design spec §5, Codex round 1 [H5])."
      },
      "liquidation_price": {
        "in_factor": true,
        "never_liquidatable": false,
        "scale_factor_num": "4200000000",
        "scale_factor_den": "3200000000",
        "already_breached": true,
        "prices": [
          {
            "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
            "current_price": "4000000000",
            "price_decimals": 6,
            "price_floor": "5250000000",
            "lowest_healthy_price": "5250000000"
          }
        ],
        "factor_assets": [
          "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF"
        ],
        "held_assets": [
          "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF"
        ],
        "boundary_is_healthy": true,
        "per_token_floor_omitted": false,
        "diagnostic": false,
        "axis": "eth_usd",
        "note": "at exactly this price the position is HEALTHY on both engines — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil."
      }
    }
  ],
  "found": true,
  "lookup_complete": false,
  "withheld_engines": [
    {
      "engine": "aave_v3_etherfi",
      "code": "FLAG_CUSTODY_UNPROVEN",
      "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
      "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
    }
  ],
  "lookup_complete_note": "one or more engines are withheld and could not be consulted, so this lookup is INCOMPLETE. `found: null` means the answer cannot be established — never that no position exists; `found: true` under an incomplete lookup is a FLOOR, not a total.",
  "notes": [
    "Every price disclosure below is the SNAPSHOT the batch persisted — value, decimals, block, as-of, source, provenance, budget and verdict. Nothing here is re-read or re-judged at request time (design spec §7).",
    "`source_as_of` is the chain-asserted as-of (a poll anchor's block timestamp or an AnswerUpdated updatedAt). Database insert time is NEVER substituted for it.",
    "Debt Manager collateral comes from a sweep with a worst case of 5580 seconds; its prices are 60-second samples. Read `sweep_block` for the collateral as-of, never the price age.",
    "The two engines are never blended: Aave publishes a continuous health factor, the Debt Manager a strict liquidatable boolean."
  ]
} satisfies AddressResponse;

export const stressAave = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xAAaA000000000000000000000000000000000001",
  "scenario_config_version": "v1",
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "scenarios": [
    {
      "id": "eth_minus_30",
      "version": "v1",
      "label": "ETH -30 percent",
      "description": "Factor shock on ETH/USD. Every ETH-linked collateral moves jointly because each one's USD price is composed from ETH/USD by construction; weETH additionally carries its redemption rate, held flat here.",
      "path_assumption": "instantaneous mark at the shocked level; single-step, no path, no cascade feedback, no partial closes",
      "engines": [
        "aave_v3_etherfi",
        "debt_manager"
      ],
      "shocks": [
        {
          "axis": "eth_usd",
          "factor_num": 70,
          "factor_den": 100
        }
      ],
      "out_of_model": [
        "oracle lag and heartbeat behaviour during the move: the shock is applied as an instantaneous mark, while the real feeds update on deviation or heartbeat",
        "deviation-trigger discreteness (a feed moves in rounds, not continuously)",
        "liquidator liquidity, gas costs, execution latency and cascade dynamics",
        "market correlations not mechanically implied by the read paths recorded in recon/derivation-notes.md",
        "intra-sample price wicks: prices are 60-second point samples and an intra-interval spike is invisible by construction (D-012)",
        "Aave price caps are checked, not assumed: a down-shock leaves them slack, and any cap that did bind is reported per input"
      ],
      "results": [
        {
          "engine": "aave_v3_etherfi",
          "account": "0xAAaA000000000000000000000000000000000001",
          "applicable": true,
          "before": {
            "health_factor_wad": "1080000000000000000",
            "health_factor_num": "6480000000000000",
            "health_factor_den": "6000000000000000",
            "infinite": false,
            "liquidatable": null,
            "eligible": false,
            "collateral_usd": "800000000000",
            "debt_usd": "600000000000",
            "max_borrow_lt": null
          },
          "after": {
            "health_factor_wad": "756000000000000000",
            "health_factor_num": "4536000000000000",
            "health_factor_den": "6000000000000000",
            "infinite": false,
            "liquidatable": null,
            "eligible": true,
            "collateral_usd": "560000000000",
            "debt_usd": "600000000000",
            "max_borrow_lt": null
          },
          "applied_shocks": [
            {
              "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
              "chain_id": 1,
              "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
              "factor_num": "70",
              "factor_den": "100",
              "before": "400000000000",
              "after": "280000000000",
              "snapped": false,
              "base_snapped": false,
              "cap_bound": false
            }
          ],
          "held_flat": [
            {
              "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              "chain_id": 1,
              "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
              "value": "100000000"
            }
          ],
          "market_realization": null,
          "projection": null
        }
      ]
    },
    {
      "id": "weeth_market_depeg_oracles_held",
      "version": "v1",
      "label": "weETH market depeg to 0.95 (oracles held)",
      "description": "weETH trades 5 percent below its redemption value while the redemption rate is unchanged. This is EXPLICITLY NOT a health-factor event: neither protocol reads a secondary-market weETH price, so every health factor is bit-identical and no position becomes liquidatable.",
      "path_assumption": "oracle marks held exactly; market value is a separate axis applied only to realized proceeds",
      "engines": [
        "aave_v3_etherfi",
        "debt_manager"
      ],
      "shocks": [],
      "out_of_model": [
        "oracle lag and heartbeat behaviour during the move: the shock is applied as an instantaneous mark, while the real feeds update on deviation or heartbeat",
        "deviation-trigger discreteness (a feed moves in rounds, not continuously)",
        "liquidator liquidity, gas costs, execution latency and cascade dynamics",
        "market correlations not mechanically implied by the read paths recorded in recon/derivation-notes.md",
        "intra-sample price wicks: prices are 60-second point samples and an intra-interval spike is invisible by construction (D-012)",
        "seizure is modeled PRO-RATA over a position's counted collateral; a real liquidator picks a preference order and would take the least-impaired asset first, so this is neutral rather than conservative"
      ],
      "results": [
        {
          "engine": "aave_v3_etherfi",
          "account": "0xAAaA000000000000000000000000000000000001",
          "applicable": true,
          "before": {
            "health_factor_wad": "1080000000000000000",
            "health_factor_num": "6480000000000000",
            "health_factor_den": "6000000000000000",
            "infinite": false,
            "liquidatable": null,
            "eligible": false,
            "collateral_usd": "800000000000",
            "debt_usd": "600000000000",
            "max_borrow_lt": null
          },
          "after": {
            "health_factor_wad": "1080000000000000000",
            "health_factor_num": "6480000000000000",
            "health_factor_den": "6000000000000000",
            "infinite": false,
            "liquidatable": null,
            "eligible": false,
            "collateral_usd": "800000000000",
            "debt_usd": "600000000000",
            "max_borrow_lt": null
          },
          "applied_shocks": [],
          "held_flat": [],
          "market_realization": {
            "hfs_unchanged": true,
            "execution_shortfall_usd": "0",
            "bad_debt_at_liquidation_usd": "0",
            "usd_decimals": 8,
            "seizure_model": "pro-rata-over-counted-collateral",
            "note": "market value is NOT an oracle mark: neither protocol reads a secondary-market price, so this scenario moves NO health factor (`hfs_unchanged` asserts it). The output is the gap the protocol is not seeing."
          },
          "projection": null
        }
      ]
    },
    {
      "id": "dm_rate_horizon_plus_200bps",
      "version": "v1",
      "label": "Debt Manager borrow APY +200bps (PROJECTION)",
      "description": "A rate change does not move a spot health factor, so this ships as a closed-form HORIZON PROJECTION, never as a spot shock.",
      "path_assumption": "collateral prices held flat at the current sample; the APY steps once, at t=0, and holds for the whole horizon",
      "engines": [
        "debt_manager"
      ],
      "shocks": [
        {
          "axis": "borrow_apy",
          "factor_num": 1,
          "factor_den": 1
        }
      ],
      "out_of_model": [
        "oracle lag and heartbeat behaviour during the move: the shock is applied as an instantaneous mark, while the real feeds update on deviation or heartbeat",
        "deviation-trigger discreteness (a feed moves in rounds, not continuously)",
        "liquidator liquidity, gas costs, execution latency and cascade dynamics",
        "market correlations not mechanically implied by the read paths recorded in recon/derivation-notes.md",
        "intra-sample price wicks: prices are 60-second point samples and an intra-interval spike is invisible by construction (D-012)",
        "borrower behaviour: no repayment, no top-up, no new borrowing over the horizon",
        "the Aave engine is excluded (utilization-driven rates over a residual dust book)"
      ],
      "results": [
        {
          "engine": "aave_v3_etherfi",
          "account": "0xAAaA000000000000000000000000000000000001",
          "applicable": false,
          "reason": "scenario dm_rate_horizon_plus_200bps is not defined for engine aave_v3_etherfi",
          "before": null,
          "after": null,
          "applied_shocks": [],
          "held_flat": [],
          "market_realization": null,
          "projection": null
        }
      ]
    }
  ],
  "notes": [
    "Shocks are EXACT rationals applied to primitive axes and propagated through each engine's actual pricing transforms.",
    "Assets the propagation matrix does not cover are named in `held_flat` rather than silently held at their pre-shock price."
  ]
} satisfies StressResponse;

export const stressDM = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xccCc000000000000000000000000000000000003",
  "scenario_config_version": "v1",
  "found": true,
  "lookup_complete": true,
  "withheld_engines": [],
  "lookup_complete_note": "every engine was available to be consulted for this lookup, so `found` is a definitive answer.",
  "scenarios": [
    {
      "id": "dm_rate_horizon_plus_200bps",
      "version": "v1",
      "label": "Debt Manager borrow APY +200bps (PROJECTION)",
      "description": "A rate change does not move a spot health factor, so this ships as a closed-form HORIZON PROJECTION, never as a spot shock.",
      "path_assumption": "collateral prices held flat at the current sample; the APY steps once, at t=0, and holds for the whole horizon",
      "engines": [
        "debt_manager"
      ],
      "shocks": [
        {
          "axis": "borrow_apy",
          "factor_num": 1,
          "factor_den": 1
        }
      ],
      "out_of_model": [
        "oracle lag and heartbeat behaviour during the move: the shock is applied as an instantaneous mark, while the real feeds update on deviation or heartbeat",
        "deviation-trigger discreteness (a feed moves in rounds, not continuously)",
        "liquidator liquidity, gas costs, execution latency and cascade dynamics",
        "market correlations not mechanically implied by the read paths recorded in recon/derivation-notes.md",
        "intra-sample price wicks: prices are 60-second point samples and an intra-interval spike is invisible by construction (D-012)",
        "borrower behaviour: no repayment, no top-up, no new borrowing over the horizon",
        "the Aave engine is excluded (utilization-driven rates over a residual dust book)"
      ],
      "results": [
        {
          "engine": "debt_manager",
          "account": "0xccCc000000000000000000000000000000000003",
          "applicable": true,
          "before": {
            "health_factor_wad": null,
            "health_factor_num": "3200000000",
            "health_factor_den": "4200000000",
            "infinite": false,
            "liquidatable": true,
            "eligible": true,
            "collateral_usd": "4000000000",
            "debt_usd": "4200000000",
            "max_borrow_lt": "3200000000"
          },
          "after": {
            "health_factor_wad": null,
            "health_factor_num": "3200000000",
            "health_factor_den": "4200000000",
            "infinite": false,
            "liquidatable": true,
            "eligible": true,
            "collateral_usd": "4000000000",
            "debt_usd": "4200000000",
            "max_borrow_lt": "3200000000"
          },
          "applied_shocks": [],
          "held_flat": [],
          "market_realization": null,
          "projection": {
            "label": "PROJECTION",
            "basis": "delta-only",
            "annual_delta_bps": 200,
            "apy_observed_at_block": 154796552,
            "prices_held_flat": true,
            "horizons": [
              {
                "horizon_seconds": 2592000,
                "debt_usd": "4200000000",
                "projected_usd": "4206904109",
                "additional_interest_usd": "6904109",
                "becomes_liquidatable": true
              },
              {
                "horizon_seconds": 7776000,
                "debt_usd": "4200000000",
                "projected_usd": "4220712328",
                "additional_interest_usd": "20712328",
                "becomes_liquidatable": true
              }
            ],
            "note": "DELTA-ONLY: this is the additional interest the +200bps step contributes over the horizon. A batch carries no borrow-APY observation and this service makes no chain calls, so the base accrual is absent. No time-to-liquidatable is published from a path that would understate debt growth."
          }
        }
      ]
    },
    {
      "id": "stable_depeg_0995_in_band",
      "version": "v1",
      "label": "Stablecoin depeg to 0.995 (inside the snap band)",
      "description": "The Debt Manager's stable snap band is OPEN — (990000, 1010000) exclusive — so 0.995 is swallowed and this is a true no-op on a weETH-only position.",
      "path_assumption": "instantaneous mark at the shocked level",
      "engines": [
        "aave_v3_etherfi",
        "debt_manager"
      ],
      "shocks": [
        {
          "axis": "stable_usd",
          "factor_num": 995,
          "factor_den": 1000
        }
      ],
      "out_of_model": [
        "oracle lag and heartbeat behaviour during the move: the shock is applied as an instantaneous mark, while the real feeds update on deviation or heartbeat",
        "deviation-trigger discreteness (a feed moves in rounds, not continuously)",
        "liquidator liquidity, gas costs, execution latency and cascade dynamics",
        "market correlations not mechanically implied by the read paths recorded in recon/derivation-notes.md",
        "intra-sample price wicks: prices are 60-second point samples and an intra-interval spike is invisible by construction (D-012)"
      ],
      "results": [
        {
          "engine": "debt_manager",
          "account": "0xccCc000000000000000000000000000000000003",
          "applicable": true,
          "before": {
            "health_factor_wad": null,
            "health_factor_num": "3200000000",
            "health_factor_den": "4200000000",
            "infinite": false,
            "liquidatable": true,
            "eligible": true,
            "collateral_usd": "4000000000",
            "debt_usd": "4200000000",
            "max_borrow_lt": "3200000000"
          },
          "after": {
            "health_factor_wad": null,
            "health_factor_num": "3200000000",
            "health_factor_den": "4200000000",
            "infinite": false,
            "liquidatable": true,
            "eligible": true,
            "collateral_usd": "4000000000",
            "debt_usd": "4200000000",
            "max_borrow_lt": "3200000000"
          },
          "applied_shocks": [],
          "held_flat": [],
          "market_realization": null,
          "projection": null
        }
      ]
    }
  ],
  "notes": [
    "Shocks are EXACT rationals applied to primitive axes and propagated through each engine's actual pricing transforms.",
    "Assets the propagation matrix does not cover are named in `held_flat` rather than silently held at their pre-shock price."
  ]
} satisfies StressResponse;

export const stressUnknowable = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 2,
    "refused_count": 1,
    "refused_engines": [
      "aave_v3_etherfi"
    ],
    "flagged_count": 0,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "address": "0xAAaA000000000000000000000000000000000001",
  "scenario_config_version": "v1",
  "found": null,
  "lookup_complete": false,
  "withheld_engines": [
    {
      "engine": "aave_v3_etherfi",
      "code": "FLAG_CUSTODY_UNPROVEN",
      "detail": "the Aave engine's derived state cannot be shown to have been walked from its start block under a decode registry including the collateral-flag events",
      "note": "FLAG_CUSTODY_UNPROVEN: reading flag ABSENCE as chain truth is not licensed. This refusal is WHOLE-ENGINE by design; the other engine serves normally."
    }
  ],
  "lookup_complete_note": "one or more engines are withheld and could not be consulted, so this lookup is INCOMPLETE. `found: null` means the answer cannot be established — never that no position exists; `found: true` under an incomplete lookup is a FLOOR, not a total.",
  "scenarios": [],
  "notes": [
    "Shocks are EXACT rationals applied to primitive axes and propagated through each engine's actual pricing transforms.",
    "Assets the propagation matrix does not cover are named in `held_flat` rather than silently held at their pre-shock price."
  ]
} satisfies StressResponse;

export const observatory = {
  "served_at": "2026-07-29T10:00:00Z",
  "limit": 50,
  "series": [
    {
      "batch_id": 1,
      "computed_at": "2026-07-29T10:00:00Z",
      "age_seconds": 0,
      "engines": [
        {
          "engine": "aave_v3_etherfi",
          "value_decimals": 8,
          "positions": 2,
          "computed_positions": 1,
          "refused_positions": 1,
          "flagged_positions": 1,
          "liquidatable_positions": 0,
          "refused": false,
          "refusal": null,
          "total_collateral": "800000000000",
          "total_debt": "600000000000",
          "refusals": [
            {
              "key": "G1",
              "count": 1
            }
          ],
          "flags": [
            {
              "key": "stale_price",
              "count": 1
            }
          ],
          "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
        },
        {
          "engine": "debt_manager",
          "value_decimals": 6,
          "positions": 2,
          "computed_positions": 1,
          "refused_positions": 1,
          "flagged_positions": 0,
          "liquidatable_positions": 1,
          "refused": false,
          "refusal": null,
          "total_collateral": "4000000000",
          "total_debt": "4200000000",
          "refusals": [
            {
              "key": "SWEEP_NEVER",
              "count": 1
            }
          ],
          "flags": [],
          "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
        }
      ]
    }
  ],
  "rate_indexes": [
    {
      "engine": "aave_v3_etherfi",
      "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      "symbol": "weETH",
      "kind": "liquidity_index",
      "scale": "ray-1e27",
      "value": "1023456789012345678901234567",
      "as_of_block": 25634718,
      "note": "as-of-last-ReserveDataUpdated: this index can trail the derive cursor. `as_of_block` is its OWN as-of and is the only honest freshness statement about it."
    }
  ],
  "notes": [
    "Each point is one materialization. The series is newest first and is never interpolated.",
    "Per-engine aggregates are in each engine's own unit and are NEVER summed across engines."
  ]
} satisfies ObservatoryResponse;

export const meta = {
  "served_at": "2026-07-29T10:00:00Z",
  "service": {
    "name": "solvent-api",
    "version": "0.1.0",
    "schema_version": 14,
    "algorithm_revision": 4,
    "scenario_config_version": "v1",
    "registry_fingerprint": "sha256:fixture-registry-fingerprint",
    "seizure_model": "pro-rata-over-counted-collateral"
  },
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "watermark_vector": [
    {
      "engine": "aave_v3_etherfi",
      "chain_id": 1,
      "last_block": 25635618,
      "acked_epoch": 0,
      "covered_from_block": 20625519,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "aave_param",
      "chain_id": 1,
      "last_block": 25635600,
      "acked_epoch": 0,
      "covered_from_block": 20625519,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "prices:poll:1",
      "chain_id": 1,
      "last_block": 25635610,
      "acked_epoch": 0,
      "covered_from_block": null,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "debt_manager",
      "chain_id": 10,
      "last_block": 154796552,
      "acked_epoch": 0,
      "covered_from_block": 118000000,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "prices:poll:10",
      "chain_id": 10,
      "last_block": 154796540,
      "acked_epoch": 0,
      "covered_from_block": null,
      "decoder_revision": 1,
      "consumed_by_risk": true
    }
  ],
  "reorg_posture": {
    "max_epochs": [],
    "superseded": false,
    "legs": [],
    "leg_names": [
      "acked_epoch_moved",
      "last_block_rewound",
      "unacked_epoch_recorded"
    ],
    "note": "the three legs are evaluated per STAMPED ENGINE against a live cursor read: one chain's rewind does not invalidate the other chain's book."
  },
  "prices": [
    {
      "chain_id": 1,
      "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      "symbol": "weETH",
      "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
      "owner_engine": "prices:poll:1",
      "provenance": "adapter-output",
      "value": "999900000000",
      "decimals": 8,
      "block_number": 25635660,
      "anchor_block": 25635660,
      "observed_at": "2026-07-29T09:59:55Z",
      "source_as_of": "2026-07-29T09:59:55Z",
      "age_seconds": 5,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 1,
      "highest_quarantined_block": 25635510,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    },
    {
      "chain_id": 1,
      "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "symbol": "USDC",
      "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
      "owner_engine": "prices:poll:1",
      "provenance": "adapter-output",
      "value": "100000000",
      "decimals": 8,
      "block_number": 25635610,
      "anchor_block": 25635610,
      "observed_at": "2026-07-29T09:59:48Z",
      "source_as_of": "2026-07-29T09:59:48Z",
      "age_seconds": 12,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 0,
      "highest_quarantined_block": null,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    },
    {
      "chain_id": 10,
      "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
      "symbol": "weETH",
      "source": "priceproviderv2",
      "owner_engine": "prices:poll:10",
      "provenance": "engine-exact",
      "value": "4000000000",
      "decimals": 6,
      "block_number": 154796540,
      "anchor_block": 154796540,
      "observed_at": "2026-07-29T09:59:30Z",
      "source_as_of": "2026-07-29T09:59:30Z",
      "age_seconds": 30,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 0,
      "highest_quarantined_block": null,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    }
  ],
  "neutralized_prices": [
    {
      "owner_engine": "prices:poll:1",
      "chain_id": 1,
      "rows": 1,
      "oldest_observed_at": "2026-07-29T09:00:00Z",
      "newest_observed_at": "2026-07-29T09:00:00Z",
      "highest_block": 25635510
    }
  ],
  "sweeps": [
    {
      "engine": "debt_manager",
      "rows": 3,
      "never_swept": 1,
      "failed_since_success": 1,
      "success": 1,
      "note": "never_swept is collateral of UNKNOWN size, never zero: those accounts are REFUSED rather than valued at zero."
    }
  ],
  "sweep_never_refusals_in_batch": 1,
  "heartbeat_provenance": [
    {
      "chain_id": 1,
      "symbol": "weETH",
      "proxy": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      "aggregator": "0x00c7A37B03690fb9f41b5C5AF8131735C7275446",
      "heartbeat_seconds": 3600,
      "grace_seconds": 1800,
      "provenance_grade": "verified",
      "observed_max_gap_seconds": null,
      "tested_budget_seconds": null,
      "budget_refuted": false,
      "basis": "deployed code observed consuming this exact proxy with a 3600-second heartbeat (constructor evidence at 0x641169f048ee8de8b3037c9d9c840060fe03e463); recon/derivation-notes.md heartbeat-provenance table"
    },
    {
      "chain_id": 1,
      "symbol": "USDC",
      "proxy": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      "aggregator": "0x789190466E21a8b78b8027866CBBDc151542A26C",
      "heartbeat_seconds": 86400,
      "grace_seconds": 3600,
      "provenance_grade": "published-not-verified",
      "observed_max_gap_seconds": null,
      "tested_budget_seconds": null,
      "budget_refuted": false,
      "basis": "the published Chainlink mainnet heartbeat for this feed; NOT independently confirmed from bytecode or from a consumer's constructor by this repo (recon/derivation-notes.md heartbeat-provenance table)"
    }
  ],
  "constants": {
    "confirmation_blocks": 5,
    "price_poll_seconds": 60,
    "dm_sweep_interval_seconds": 3600,
    "dm_sweep_pass_seconds": 1980,
    "dm_sweep_worst_case_seconds": 5580,
    "price_budget_seconds": 180,
    "price_ceiling_seconds": 360,
    "large_price_step_bps": 2000,
    "rate_limit_requests_per_second": 20,
    "rate_limit_burst": 40,
    "sse_heartbeat_seconds": 15,
    "note": "every value here is a POLICY OF THIS DEPLOYMENT or a published cadence, not a measurement. The price ceiling is 2x the budget (design spec §7, R = 2 x T_f): an input past it is REFUSED rather than served stale."
  },
  "disclosures": [
    "Prices are 60-second samples: intra-interval wicks are invisible BY CONSTRUCTION, and no surface here implies otherwise (D-012).",
    "There is exactly one price view per asset. For `priceproviderv2` inputs these numbers are exactly as manipulable as the Debt Manager itself — no more, no less; there is no second witness to disagree with.",
    "Debt Manager collateral is sweep-dominated: worst case 5580 seconds behind, while its prices are 60 seconds. Never read a fresh price age as a fresh collateral age.",
    "`rate_indexes` is as-of-last-ReserveDataUpdated, so a debt leg's index can trail the balances cursor badly. Every leg carries its own index as-of block.",
    "Aave borrow-rate scenarios are excluded from the stress set (utilization-driven, residual dust book) and the Debt Manager rate axis is a labeled PROJECTION, never a spot health-factor shock.",
    "A price sample used by a batch and neutralized afterwards is invisible to the three supersession legs; the batch recomputes within one materializer cadence (design spec §4, D-012 class).",
    "Aave base values are 8-decimal and Debt Manager USD is 6-decimal. The two engines are NEVER summed into one number.",
    "Refused positions are served WITH their reason and are counted in every aggregate's refusal count. This surface never omits a position it could not compute.",
    "This service makes zero RPC calls. Every age is the database clock minus a durable stamp, so nothing here is measured against a chain head observed at request time."
  ]
} satisfies MetaResponse;

export const metaNoBatch = {
  "served_at": "2026-07-29T10:00:00Z",
  "service": {
    "name": "solvent-api",
    "version": "0.1.0",
    "schema_version": 14,
    "algorithm_revision": 4,
    "scenario_config_version": "v1",
    "registry_fingerprint": "sha256:fixture-registry-fingerprint",
    "seizure_model": "pro-rata-over-counted-collateral"
  },
  "batch": null,
  "watermark_vector": [
    {
      "engine": "aave_v3_etherfi",
      "chain_id": 1,
      "last_block": 25635618,
      "acked_epoch": 0,
      "covered_from_block": 20625519,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "aave_param",
      "chain_id": 1,
      "last_block": 25635600,
      "acked_epoch": 0,
      "covered_from_block": 20625519,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "prices:poll:1",
      "chain_id": 1,
      "last_block": 25635610,
      "acked_epoch": 0,
      "covered_from_block": null,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "debt_manager",
      "chain_id": 10,
      "last_block": 154796552,
      "acked_epoch": 0,
      "covered_from_block": 118000000,
      "decoder_revision": 1,
      "consumed_by_risk": true
    },
    {
      "engine": "prices:poll:10",
      "chain_id": 10,
      "last_block": 154796540,
      "acked_epoch": 0,
      "covered_from_block": null,
      "decoder_revision": 1,
      "consumed_by_risk": true
    }
  ],
  "reorg_posture": {
    "max_epochs": [],
    "superseded": false,
    "legs": [],
    "leg_names": [
      "acked_epoch_moved",
      "last_block_rewound",
      "unacked_epoch_recorded"
    ],
    "note": "the three legs are evaluated per STAMPED ENGINE against a live cursor read: one chain's rewind does not invalidate the other chain's book."
  },
  "prices": [
    {
      "chain_id": 1,
      "asset": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      "symbol": "weETH",
      "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
      "owner_engine": "prices:poll:1",
      "provenance": "adapter-output",
      "value": "999900000000",
      "decimals": 8,
      "block_number": 25635660,
      "anchor_block": 25635660,
      "observed_at": "2026-07-29T09:59:55Z",
      "source_as_of": "2026-07-29T09:59:55Z",
      "age_seconds": 5,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 1,
      "highest_quarantined_block": 25635510,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    },
    {
      "chain_id": 1,
      "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "symbol": "USDC",
      "source": "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f",
      "owner_engine": "prices:poll:1",
      "provenance": "adapter-output",
      "value": "100000000",
      "decimals": 8,
      "block_number": 25635610,
      "anchor_block": 25635610,
      "observed_at": "2026-07-29T09:59:48Z",
      "source_as_of": "2026-07-29T09:59:48Z",
      "age_seconds": 12,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 0,
      "highest_quarantined_block": null,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    },
    {
      "chain_id": 10,
      "asset": "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
      "symbol": "weETH",
      "source": "priceproviderv2",
      "owner_engine": "prices:poll:10",
      "provenance": "engine-exact",
      "value": "4000000000",
      "decimals": 6,
      "block_number": 154796540,
      "anchor_block": 154796540,
      "observed_at": "2026-07-29T09:59:30Z",
      "source_as_of": "2026-07-29T09:59:30Z",
      "age_seconds": 30,
      "valid": true,
      "invalid_reason": "",
      "quarantined_rows": 0,
      "highest_quarantined_block": null,
      "is_valuation_witness": true,
      "valuation_witness_note": "this key is what values an Aave position: only engine-exact and adapter-output provenance may do so."
    }
  ],
  "neutralized_prices": [
    {
      "owner_engine": "prices:poll:1",
      "chain_id": 1,
      "rows": 1,
      "oldest_observed_at": "2026-07-29T09:00:00Z",
      "newest_observed_at": "2026-07-29T09:00:00Z",
      "highest_block": 25635510
    }
  ],
  "sweeps": [
    {
      "engine": "debt_manager",
      "rows": 3,
      "never_swept": 1,
      "failed_since_success": 1,
      "success": 1,
      "note": "never_swept is collateral of UNKNOWN size, never zero: those accounts are REFUSED rather than valued at zero."
    }
  ],
  "sweep_never_refusals_in_batch": 1,
  "heartbeat_provenance": [
    {
      "chain_id": 1,
      "symbol": "weETH",
      "proxy": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      "aggregator": "0x00c7A37B03690fb9f41b5C5AF8131735C7275446",
      "heartbeat_seconds": 3600,
      "grace_seconds": 1800,
      "provenance_grade": "verified",
      "observed_max_gap_seconds": null,
      "tested_budget_seconds": null,
      "budget_refuted": false,
      "basis": "deployed code observed consuming this exact proxy with a 3600-second heartbeat (constructor evidence at 0x641169f048ee8de8b3037c9d9c840060fe03e463); recon/derivation-notes.md heartbeat-provenance table"
    },
    {
      "chain_id": 1,
      "symbol": "USDC",
      "proxy": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      "aggregator": "0x789190466E21a8b78b8027866CBBDc151542A26C",
      "heartbeat_seconds": 86400,
      "grace_seconds": 3600,
      "provenance_grade": "published-not-verified",
      "observed_max_gap_seconds": null,
      "tested_budget_seconds": null,
      "budget_refuted": false,
      "basis": "the published Chainlink mainnet heartbeat for this feed; NOT independently confirmed from bytecode or from a consumer's constructor by this repo (recon/derivation-notes.md heartbeat-provenance table)"
    }
  ],
  "constants": {
    "confirmation_blocks": 5,
    "price_poll_seconds": 60,
    "dm_sweep_interval_seconds": 3600,
    "dm_sweep_pass_seconds": 1980,
    "dm_sweep_worst_case_seconds": 5580,
    "price_budget_seconds": 180,
    "price_ceiling_seconds": 360,
    "large_price_step_bps": 2000,
    "rate_limit_requests_per_second": 20,
    "rate_limit_burst": 40,
    "sse_heartbeat_seconds": 15,
    "note": "every value here is a POLICY OF THIS DEPLOYMENT or a published cadence, not a measurement. The price ceiling is 2x the budget (design spec §7, R = 2 x T_f): an input past it is REFUSED rather than served stale."
  },
  "disclosures": [
    "Prices are 60-second samples: intra-interval wicks are invisible BY CONSTRUCTION, and no surface here implies otherwise (D-012).",
    "There is exactly one price view per asset. For `priceproviderv2` inputs these numbers are exactly as manipulable as the Debt Manager itself — no more, no less; there is no second witness to disagree with.",
    "Debt Manager collateral is sweep-dominated: worst case 5580 seconds behind, while its prices are 60 seconds. Never read a fresh price age as a fresh collateral age.",
    "`rate_indexes` is as-of-last-ReserveDataUpdated, so a debt leg's index can trail the balances cursor badly. Every leg carries its own index as-of block.",
    "Aave borrow-rate scenarios are excluded from the stress set (utilization-driven, residual dust book) and the Debt Manager rate axis is a labeled PROJECTION, never a spot health-factor shock.",
    "A price sample used by a batch and neutralized afterwards is invisible to the three supersession legs; the batch recomputes within one materializer cadence (design spec §4, D-012 class).",
    "Aave base values are 8-decimal and Debt Manager USD is 6-decimal. The two engines are NEVER summed into one number.",
    "Refused positions are served WITH their reason and are counted in every aggregate's refusal count. This surface never omits a position it could not compute.",
    "This service makes zero RPC calls. Every age is the database clock minus a durable stamp, so nothing here is measured against a chain head observed at request time."
  ],
  "batch_unavailable_reason": "no complete risk batch is available: this is a statement about this service, NOT a claim that the book is empty"
} satisfies MetaResponse;

export const errorBadRequest = {
  "error": {
    "code": "bad_request",
    "message": "addr must be a 0x-prefixed 20-byte address"
  }
} satisfies ErrorBody;

export const errorNotFound = {
  "error": {
    "code": "not_found",
    "message": "no such route: this API serves /v1/book, /v1/address/{addr}, /v1/address/{addr}/stress, /v1/observatory, /v1/stream and /v1/meta"
  }
} satisfies ErrorBody;

export const errorRateLimited = {
  "error": {
    "code": "rate_limited",
    "message": "rate limit exceeded: this surface admits 20 requests per second per client address, burst 40",
    "retry_after_seconds": 3
  }
} satisfies ErrorBody;

export const errorUnavailable = {
  "error": {
    "code": "unavailable",
    "message": "no complete risk batch is available. This is a statement about the SERVICE, NOT a claim that the book is empty.",
    "retry_after_seconds": 5
  }
} satisfies ErrorBody;

export const errorInternal = {
  "error": {
    "code": "internal",
    "message": "the service failed to build this response"
  }
} satisfies ErrorBody;

export const streamSnapshot = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "engines": [
    {
      "engine": "aave_v3_etherfi",
      "value_decimals": 8,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 1,
      "liquidatable_positions": 0,
      "refused": false,
      "refusal": null,
      "total_collateral": "800000000000",
      "total_debt": "600000000000",
      "refusals": [
        {
          "key": "G1",
          "count": 1
        }
      ],
      "flags": [
        {
          "key": "stale_price",
          "count": 1
        }
      ],
      "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    },
    {
      "engine": "debt_manager",
      "value_decimals": 6,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 0,
      "liquidatable_positions": 1,
      "refused": false,
      "refusal": null,
      "total_collateral": "4000000000",
      "total_debt": "4200000000",
      "refusals": [
        {
          "key": "SWEEP_NEVER",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    }
  ],
  "degradation": {
    "engines": [
      {
        "engine": "aave_v3_etherfi",
        "refused_positions": 1,
        "flagged_positions": 1,
        "liquidatable_positions": 0,
        "refusals": [
          {
            "key": "G1",
            "count": 1
          }
        ],
        "flags": [
          {
            "key": "stale_price",
            "count": 1
          }
        ]
      },
      {
        "engine": "debt_manager",
        "refused_positions": 1,
        "flagged_positions": 0,
        "liquidatable_positions": 1,
        "refusals": [
          {
            "key": "SWEEP_NEVER",
            "count": 1
          }
        ],
        "flags": []
      }
    ],
    "superseded": false,
    "supersession_legs": [],
    "refused_engines": [],
    "note": "a degradation event is a TRANSITION in this posture, not a new fact about the chain. Refusals are named, counted and served; the book is never published with a position quietly missing."
  },
  "listener_connected": true,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks."
} satisfies StreamPayload;

export const streamSnapshotRecovered = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "engines": [
    {
      "engine": "aave_v3_etherfi",
      "value_decimals": 8,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 1,
      "liquidatable_positions": 0,
      "refused": false,
      "refusal": null,
      "total_collateral": "800000000000",
      "total_debt": "600000000000",
      "refusals": [
        {
          "key": "G1",
          "count": 1
        }
      ],
      "flags": [
        {
          "key": "stale_price",
          "count": 1
        }
      ],
      "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    },
    {
      "engine": "debt_manager",
      "value_decimals": 6,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 0,
      "liquidatable_positions": 1,
      "refused": false,
      "refusal": null,
      "total_collateral": "4000000000",
      "total_debt": "4200000000",
      "refusals": [
        {
          "key": "SWEEP_NEVER",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    }
  ],
  "degradation": {
    "engines": [
      {
        "engine": "aave_v3_etherfi",
        "refused_positions": 1,
        "flagged_positions": 1,
        "liquidatable_positions": 0,
        "refusals": [
          {
            "key": "G1",
            "count": 1
          }
        ],
        "flags": [
          {
            "key": "stale_price",
            "count": 1
          }
        ]
      },
      {
        "engine": "debt_manager",
        "refused_positions": 1,
        "flagged_positions": 0,
        "liquidatable_positions": 1,
        "refusals": [
          {
            "key": "SWEEP_NEVER",
            "count": 1
          }
        ],
        "flags": []
      }
    ],
    "superseded": false,
    "supersession_legs": [],
    "refused_engines": [],
    "note": "a degradation event is a TRANSITION in this posture, not a new fact about the chain. Refusals are named, counted and served; the book is never published with a position quietly missing."
  },
  "listener_connected": true,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks.",
  "recovered": true
} satisfies StreamPayload;

export const streamBatch = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 2,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "engines": [
    {
      "engine": "aave_v3_etherfi",
      "value_decimals": 8,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 1,
      "liquidatable_positions": 0,
      "refused": false,
      "refusal": null,
      "total_collateral": "800000000000",
      "total_debt": "600000000000",
      "refusals": [
        {
          "key": "G1",
          "count": 1
        }
      ],
      "flags": [
        {
          "key": "stale_price",
          "count": 1
        }
      ],
      "unit_note": "values are integers at 8 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    },
    {
      "engine": "debt_manager",
      "value_decimals": 6,
      "positions": 2,
      "computed_positions": 1,
      "refused_positions": 1,
      "flagged_positions": 0,
      "liquidatable_positions": 1,
      "refused": false,
      "refusal": null,
      "total_collateral": "4000000000",
      "total_debt": "4200000000",
      "refusals": [
        {
          "key": "SWEEP_NEVER",
          "count": 1
        }
      ],
      "flags": [],
      "unit_note": "values are integers at 6 decimals in this engine's own unit (Aave: the pool's base currency; Debt Manager: USD)"
    }
  ],
  "degradation": {
    "engines": [
      {
        "engine": "aave_v3_etherfi",
        "refused_positions": 1,
        "flagged_positions": 1,
        "liquidatable_positions": 0,
        "refusals": [
          {
            "key": "G1",
            "count": 1
          }
        ],
        "flags": [
          {
            "key": "stale_price",
            "count": 1
          }
        ]
      },
      {
        "engine": "debt_manager",
        "refused_positions": 1,
        "flagged_positions": 0,
        "liquidatable_positions": 1,
        "refusals": [
          {
            "key": "SWEEP_NEVER",
            "count": 1
          }
        ],
        "flags": []
      }
    ],
    "superseded": false,
    "supersession_legs": [],
    "refused_engines": [],
    "note": "a degradation event is a TRANSITION in this posture, not a new fact about the chain. Refusals are named, counted and served; the book is never published with a position quietly missing."
  },
  "listener_connected": true,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks."
} satisfies StreamPayload;

export const streamDegradation = {
  "served_at": "2026-07-29T10:00:00Z",
  "batch": {
    "id": 1,
    "computed_at": "2026-07-29T10:00:00Z",
    "age_seconds": 0,
    "producer": "riskd",
    "status": "complete",
    "position_count": 4,
    "refused_count": 2,
    "refused_engines": [],
    "flagged_count": 1,
    "watermarks": [
      {
        "engine": "aave_v3_etherfi",
        "chain_id": 1,
        "last_block": 25635618,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "aave_param",
        "chain_id": 1,
        "last_block": 25635600,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "prices:poll:1",
        "chain_id": 1,
        "last_block": 25635610,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      },
      {
        "engine": "debt_manager",
        "chain_id": 10,
        "last_block": 154796552,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": {
          "rows": 3,
          "failed": 1,
          "success_sum": "309593004",
          "max_updated_at": "2026-07-29T09:40:00Z",
          "age_seconds": 1200,
          "generation": 4,
          "generation_open": false
        }
      },
      {
        "engine": "prices:poll:10",
        "chain_id": 10,
        "last_block": 154796540,
        "acked_epoch": 0,
        "max_epoch_at_compute": 0,
        "sweep": null
      }
    ],
    "supersession": {
      "superseded": false,
      "legs": [],
      "note": "a superseded batch is still served: the flag is the contract and it heals at the next materializer pass (design spec §4). The legs are evaluated against a LIVE read of the cursor and epoch tables inside the same snapshot as the database clock."
    }
  },
  "degradation": {
    "engines": [
      {
        "engine": "aave_v3_etherfi",
        "refused_positions": 1,
        "flagged_positions": 1,
        "liquidatable_positions": 0,
        "refusals": [
          {
            "key": "G1",
            "count": 1
          }
        ],
        "flags": [
          {
            "key": "stale_price",
            "count": 1
          }
        ]
      },
      {
        "engine": "debt_manager",
        "refused_positions": 1,
        "flagged_positions": 0,
        "liquidatable_positions": 1,
        "refusals": [
          {
            "key": "SWEEP_NEVER",
            "count": 1
          }
        ],
        "flags": []
      }
    ],
    "superseded": true,
    "supersession_legs": [
      "acked_epoch_moved"
    ],
    "refused_engines": [],
    "note": "a degradation event is a TRANSITION in this posture, not a new fact about the chain. Refusals are named, counted and served; the book is never published with a position quietly missing."
  },
  "transitions": [
    {
      "key": "supersession|acked_epoch_moved",
      "from": 0,
      "to": 1
    }
  ],
  "listener_connected": true,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks."
} satisfies StreamPayload;

export const streamUnavailable = {
  "served_at": "2026-07-29T10:00:00Z",
  "reason": "no complete risk batch is available yet: this is a statement about this service, not a claim that the book is empty",
  "batch": null,
  "engines": null,
  "degradation": null,
  "listener_connected": false,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks."
} satisfies StreamPayload;

export const streamUnavailableStale = {
  "served_at": "2026-07-29T10:00:00Z",
  "reason": "no complete risk batch is available yet: this is a statement about this service, not a claim that the book is empty",
  "batch": null,
  "engines": null,
  "degradation": null,
  "listener_connected": false,
  "poll_interval_seconds": 5,
  "note": "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks.",
  "stale_since_seconds": 240,
  "last_good_batch_id": 1
} satisfies StreamPayload;
