// THE FIXTURE PROVENANCE RECORD.
//
// ===========================================================================
// Where these numbers come from, and which ones are load-bearing
// ===========================================================================
//
// `cmd/api` has a seeded exact-value suite (`cmd/api/fixture_test.go` +
// `cmd/api/seeded_db_test.go`) whose expectations are derived BY HAND from the
// fixture's inputs, with the arithmetic written out. Those numbers are the
// contract's behaviour pinned on the server side.
//
// The fixtures here mirror THE SAME NUMBERS, so that the client suite and the
// server suite pin one set of values rather than two. `PINNED` below is that
// mirror, and every entry in it is quoted from a named Go constant or a named Go
// assertion. If the server's number changes, both suites must change together —
// which is the point.
//
// ---------------------------------------------------------------------------
// The three provenance grades, stated plainly
// ---------------------------------------------------------------------------
//
// MIRRORED — the value appears verbatim in `cmd/api`'s Go suite (as a `fx*`
//   constant or as a literal in an assertion). Listed in `PINNED`. These are the
//   only values the client tests assert as facts about the server.
//
// DERIVED — the value is not in the Go suite, and was computed here by the SAME
//   hand-derivation the Go fixture documents, using a model that reproduces
//   every MIRRORED value exactly. Concretely: waterfall grid points 2..5, the
//   Aave health-factor series below −10%, the Debt Manager projection horizons,
//   and the Debt Manager liquidation-price solve. They make the fixture a
//   realistic whole response instead of a stub, they are checked for INTERNAL
//   consistency and contract invariants (monotonicity, engine comparators), and
//   they are NOT asserted as server-pinned values.
//
// SHAPE-ONLY — the fixtures covering contract surfaces added AFTER commit
//   328bd0f by the Task-7 review train, for which `cmd/api` has no committed Go
//   expectations yet. NO number in them is asserted as a server value; what is
//   asserted is the RULE each surface exists for.
//
//     `book-engine-refused.json` — whole-engine refusals (`refused_engines`,
//       `EngineRefusal`, per-engine `refused`/`refusal`, `excluded_engines`,
//       nullable totals). Rule: a withheld engine's totals are NULL rather than
//       zero, it is named at every level of the document, and nothing in this
//       client turns that null into a 0. Round-2 additionally made
//       `coverage.stress_coverage_is_full` the book-wide claim its name promises,
//       with `coverage.withheld_engines[]` beside it — so this fixture reports
//       coverage NOT full even though nothing failed to rebuild.
//
//     `stream/snapshot-recovered.json`, `stream/unavailable-stale.json` — the
//       stream's `recovered` / `stale_since_seconds` / `last_good_batch_id`.
//
//     `address-unknowable.json`, `address-partial.json`,
//       `stress-unknowable.json` — `lookup_complete`, `withheld_engines[]` and
//       `lookup_complete_note` are shape-only.
//
//   ONE EXCEPTION, and it is deliberate: the SEMANTICS of three-valued `found`
//   are asserted as CONTRACT LAW in `test/lookup.test.ts`, not as fixture shape.
//   `null` means the answer cannot be established and must never render as "no
//   position"; `false` is a definitive negative and requires a complete lookup;
//   `true` under an incomplete lookup is a floor, not a total. Those are rules
//   the contract states in prose and a client can get catastrophically wrong
//   without any number being involved, so they are tested rather than trusted.
//
// ILLUSTRATIVE — deployment policy or prose the client has no business pinning:
//   `service.version`, `service.registry_fingerprint`, `decoder_revision`,
//   `covered_from_block` for the poll engines, timestamps, and the note strings
//   (those note strings that ARE quoted verbatim from cmd/api are marked in the
//   generator, but no test asserts prose).
//
//   `service.schema_version` is deliberately ILLUSTRATIVE: it is the goose
//   migration count and moves whenever any wave adds a migration. The
//   compatibility tests therefore exercise the MECHANISM against the fixture's
//   own value (match passes, off-by-one refuses) and never hard-code 14.
//
// ---------------------------------------------------------------------------
// Which revision of the contract this package tracks
// ---------------------------------------------------------------------------
//
// The LIVE `api/openapi.yaml`, not a vendored snapshot. `test/drift.test.ts`
// regenerates from it in process and fails if `src/generated/schema.ts` has
// drifted — which is the only thing that makes a checked-in generated file
// trustworthy.
//
// That file has moved twice while this package was being written — the
// whole-engine-refusal surface, then round-2's three-valued `found` and book-wide
// coverage claim (commit da5ed0a). Both times the drift test is what said so, and
// both times the fix was `npm run gen` plus the new required fixture fields.
// That loop working twice is the gate earning its place.
//
// ---------------------------------------------------------------------------
// Why the fixture is not a recorded HTTP capture
// ---------------------------------------------------------------------------
//
// Recording one requires a live Postgres with the seeded batch written through
// `store.WriteRiskBatch`. These fixtures are instead reconstructed from the Go
// suite's own hand-derived expectations plus the wire shapes in
// `cmd/api/handlers.go` and `cmd/api/meta.go`, and they are proven
// contract-valid by `test/fixtures.test.ts`, which validates every one against
// `api/openapi.yaml` itself — `additionalProperties: false`, the `Decimal`
// pattern, required fields and enums included. A fixture that drifted from the
// contract fails there, and one that drifted from its type fails `typecheck`.
//
// ---------------------------------------------------------------------------
// One excerpt, declared
// ---------------------------------------------------------------------------
//
// `stress-aave.json` carries THREE scenarios; the real response carries the
// whole committed set of eleven (the Go suite asserts exactly that count). The
// three are the ones the Go suite pins values for — `eth_minus_30`,
// `weeth_market_depeg_oracles_held` and `dm_rate_horizon_plus_200bps`. A
// three-entry `scenarios` array is contract-valid, and asserting a count of
// eleven over a three-entry excerpt would be a lie, so the client tests select
// scenarios BY ID and never assert the count.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_FILES } from "./data.js";

export * from "./data.js";
export { FIXTURE_FILES };

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root, four levels up from `packages/client-ts/test/fixtures`. */
export const REPO_ROOT = join(HERE, "..", "..", "..", "..");

/** The contract itself. The one file this whole package is generated from. */
export const CONTRACT_PATH = join(REPO_ROOT, "api", "openapi.yaml");

/** Read a fixture's committed bytes — the wire body, exactly as served. */
export function fixtureBytes(file: string): string {
  return readFileSync(join(HERE, file), "utf8");
}

/** Read and parse a fixture file. */
export function fixtureJson(file: string): unknown {
  return JSON.parse(fixtureBytes(file));
}

// ===========================================================================
// PINNED — every value MIRRORED from cmd/api's Go suite.
// ===========================================================================
//
// Each comment names the Go constant or the Go assertion it is quoted from.
// Nothing else in this package asserts a server value.

export const PINNED = {
  /** `fxAcct*` addresses, as `common.Address.Hex()` emits them (EIP-55). */
  accounts: {
    aave: "0xAAaA000000000000000000000000000000000001",
    aaveRefused: "0xBbbb000000000000000000000000000000000002",
    dm: "0xccCc000000000000000000000000000000000003",
    dmRefused: "0xddDD000000000000000000000000000000000004",
    unknown: "0xEeEE000000000000000000000000000000000005",
  },
  assets: {
    weethEth: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", // fxWeETHEth
    usdcEth: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // fxUSDCEth
    weethOp: "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF", // fxWeETHOp
  },
  engines: {
    aave: "aave_v3_etherfi", // risk.AaveEngine
    aaveParam: "aave_param", // risk.AaveParamEngine
    dm: "debt_manager", // risk.DMEngine
  },
  sources: {
    aave: "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f", // fxAaveSource
    dm: "priceproviderv2", // fxDMSource
  },

  /** The batch envelope, from `assertBookExactValues`. */
  batch: {
    positionCount: 4,
    refusedCount: 2,
    flaggedCount: 1,
    status: "complete", // store.RiskBatchComplete
    superseded: false,
    watermarkCount: 5,
  },

  blocks: {
    aave: 25_635_618, // fxAaveBlock
    aaveParam: 25_635_600, // fxAaveParamBlock
    aavePrice: 25_635_610, // fxAavePriceBlock
    dm: 154_796_552, // fxDMBlock
    dmSweep: 154_796_500, // fxDMSweepBlock
    dmPrice: 154_796_540, // fxDMPriceBlock
    aaveCoveredFrom: 20_625_519, // seeded_db_test.go: covered_from_block
    rateIndex: 25_635_618 - 900, // fxRateIndexBlock
  },

  ages: {
    aaveWeETH: 210, // fxAaveWeETHAge — past the 180s budget, inside the 360s ceiling
    aaveUSDC: 12, // fxAaveUSDCAge
    dmWeETH: 30, // fxDMWeETHAge
    priceBudget: 180, // fxPriceBudgetSecs
  },

  /** Aave engine — 8-decimal base currency. */
  aave: {
    valueDecimals: 8,
    weethPrice: "400000000000", // fxAaveWeETHPrice   $4,000.00000000
    usdcPrice: "100000000", // fxAaveUSDCPrice    $1.00000000
    weethAmount: "2000000000000000000", // fxAaveWeETHAmount
    usdcDebt: "6000000000", // fxAaveUSDCDebt
    collateralBase: "800000000000", // fxAaveCollateralBase
    debtBase: "600000000000", // fxAaveDebtBase
    weightedLTSum: "6480000000000000", // fxAaveWeightedLTSum
    avgLTBps: "8100", // fxAaveAvgLTBps  (DISCLOSURE ONLY)
    hfWad: "1080000000000000000", // fxAaveHFWad  = 1.08
    hfNum: "6480000000000000", // fxAaveHFNum
    hfDen: "6000000000000000", // fxAaveHFDen  = 1e4 x 6e11
    ltBps: "8100", // fxAaveLTBps
    bonusBps: "10500", // fxAaveBonusBps
    refusedRefusalCode: "G1", // riskfeed.GateMissingInput
    flag: "stale_price", // riskfeed.FlagStalePrice
    histogramBucket: "1.05 – 1.10", // seeded_db_test.go: HF 1.08 lands here
    histogramComparator: "hf_wad",
    /** The factor-level liquidation-price solve. */
    priceFloor: "370370370370",
    lowestHealthyPrice: "370370370371",
    /** ETH -30%: 4000 x 70/100, and the resulting state. */
    shockedWeethPrice: "280000000000",
    shockedCollateral: "560000000000",
    shockedHFWad: "756000000000000000", // = 0.756, eligible
  },

  /** Debt Manager engine — 6-decimal USD, strict `liquidatable` boolean. */
  dm: {
    valueDecimals: 6,
    weethPrice: "4000000000", // fxDMWeETHPrice   $4,000.000000
    weethAmount: "1000000000000000000", // fxDMWeETHAmount
    collateralUSD: "4000000000", // fxDMCollateralUSD
    maxBorrowLT: "3200000000", // fxDMMaxBorrowLT
    borrowings: "4200000000", // fxDMBorrowings
    hfNum: "3200000000", // fxDMHFNum
    hfDen: "4200000000", // fxDMHFDen  -> 0.7619…
    liqThreshold: "80000000000000000000", // fxDMLiqThreshold  80e18 over 100e18
    liqBonus: "1000000000000000000", // fxDMLiqBonus      1e18 additive => 1%
    badDebtAtPar: "239603961", // fxDMBadDebtAtPar   the STANDING bad debt
    atRiskAtPar: "4000000000", // fxDMAtRiskAtPar
    refusedRefusalCode: "SWEEP_NEVER", // riskfeed.GateSweepNever
    refusedBorrowings: "1500000000",
    histogramBucket: "< 0.90", // 3200/4200 = 0.7619…
    histogramComparator: "hf_num/hf_den",
    liquidatable: true,
    sweep: { rows: 3, neverSwept: 1, failedSinceSuccess: 1, success: 1, successSum: "309593004" },
  },

  /** The waterfall, from `assertBookExactValues`. */
  waterfall: {
    scenarioId: "eth_minus_30", // defaultWaterfallScenario
    scenarioVersion: "v1",
    axis: "eth_usd", // risk.AxisETHUSD
    wadScale: "1000000000000000000", // risk.WadUnit()
    pointCount: 6,
    unshockedFactor: "1000000000000000000",
    minus10Factor: "900000000000000000",
    aaveDebtAt90: "600000000000", // fxAaveDebtAt90
    aaveAtRiskAt90: "630000000000", // fxAaveAtRiskAt90
    dmBadDebtAt90: "635643565", // fxDMBadDebtAt90
    dmAtRiskAt90: "3600000000", // fxDMAtRiskAt90
  },

  coverage: { batchPositions: 4, inBook: 2, refusedInBatch: 2, excludedByThisLayer: 0 },

  /** `/v1/meta`, from `TestMetaServesTheFullPosture`. */
  meta: {
    serviceName: "solvent-api",
    scenarioConfigVersion: "v1",
    seizureModel: "pro-rata-over-counted-collateral", // risk.SeizureModelProRata
    algorithmRevision: 4, // riskfeed.AlgorithmRevision
    legNames: ["acked_epoch_moved", "last_block_rewound", "unacked_epoch_recorded"],
    livePriceAfterBatch: "999900000000", // fxLivePriceAfterBatch
    quarantinedRows: 1,
    highestQuarantinedBlock: 25_635_610 - 100,
    neutralizedRows: 1,
    sweepNeverRefusalsInBatch: 1,
    rateIndexValue: "1023456789012345678901234567", // fxRateIndexValue
    heartbeat: {
      verifiedProxy: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // fxProxyVerified
      verifiedSeconds: 3600,
      verifiedGrace: 1800,
      unverifiedProxy: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // fxProxyUnverified
    },
    constants: {
      confirmationBlocks: 5,
      pricePollSeconds: 60,
      dmSweepWorstCaseSeconds: 5580,
      priceBudgetSeconds: 180,
      priceCeilingSeconds: 360,
    },
    minDisclosures: 8,
  },

  /**
   * Three-valued `found` (contract round-2, commit da5ed0a). The VOCABULARY is
   * contract law; see the SHAPE-ONLY exception in the header.
   */
  lookup: {
    definitiveNegative: false,
    unknowable: null,
    outcomes: ["found", "not-found", "unknowable"],
  },

  /** `/v1/address/{addr}/stress`, from the two stress tests. */
  stress: {
    configVersion: "v1",
    ethMinus30Id: "eth_minus_30",
    depegId: "weeth_market_depeg_oracles_held",
    rateId: "dm_rate_horizon_plus_200bps",
    inBandId: "stable_depeg_0995_in_band",
    projectionLabel: "PROJECTION",
    projectionBasis: "delta-only",
    rateNotApplicableReason: "not defined for engine",
  },
} as const;
