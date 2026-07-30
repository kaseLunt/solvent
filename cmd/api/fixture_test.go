package main

// THE SEEDED FIXTURE — one source of numbers for every exact-value assertion.
//
// # Why the numbers are hand-derived and written here as literals
//
// A test that computes its expectation from the code under test proves only that
// the code is self-consistent. Every expectation below is derived BY HAND from
// the fixture's inputs, with the derivation written out, so an assertion failing
// means the arithmetic changed — not that two copies of the same bug disagree.
//
// The whole fixture, derived:
//
//	Aave (chain 1, base currency 8-dec)
//	  weETH 2e18 held as collateral, price 4000.00000000, LT 8100bps, bonus 10500bps
//	    collateral_base = floor(2e18 x 400000000000 / 1e18) =    800000000000  ($8,000)
//	    weighted_lt     = 800000000000 x 8100             = 6480000000000000
//	  USDC 6000e6 borrowed, price 1.00000000
//	    debt_base = ceil(6000000000 x 100000000 / 1e6)    =    600000000000  ($6,000)
//	  avg_lt_bps = 6480000000000000 / 800000000000        =            8100
//	  HF: inner = (6480000000000000 x 1e18 + floor(6e11/2)) / 6e11 = 10800000000000000000000
//	      hf    = inner / 1e4                                      =    1080000000000000000
//	      i.e. 1.08 = 8000 x 0.81 / 6000. Healthy, and one 10% ETH step from eligible.
//
//	Debt Manager (chain 10, USD 6-dec)
//	  weETH 1e18 held, price 4000.000000, LT 80e18/100e18, bonus 1e18 (additive, 1%)
//	    value_usd               = floor(1e18 x 4000000000 / 1e18) = 4000000000  ($4,000)
//	    max_borrow_contribution = floor(4000000000 x 80e18/100e18) = 3200000000  ($3,200)
//	  borrowings = 4200000000 ($4,200) > 3200000000  =>  LIQUIDATABLE
//	    recoverable = floor(4000000000 x 100e18/101e18)           = 3960396039
//	    bad debt    = 4200000000 - 3960396039                     =  239603961
//	    seizable    = min(4000000000, floor(4200000000 x 101/100)) = 4000000000
//	  So the book carries a STANDING bad debt at the unshocked grid point, which is
//	  what design spec §6 wants on the surface rather than buried under a shock.
//
// Two refused positions ride along — one per engine — because the acceptance
// obligation is that refusals are SERVED with their reasons and COUNTED in the
// aggregates, and a fixture with no refusals cannot demonstrate it.

import (
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// Chain bindings, matching config/contracts.json.
const (
	fxETHChain = uint64(1)
	fxOPChain  = uint64(10)
)

// Assets. The two weETH addresses are the ones the committed propagation matrix
// names for the eth_usd axis, so the waterfall genuinely propagates rather than
// holding the whole book flat.
var (
	fxWeETHEth = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee") // weETH on ETH (Aave)
	fxUSDCEth  = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") // USDC on ETH (Aave debt)
	fxWeETHOp  = common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF") // weETH on OP (Debt Manager)

	fxOracle = common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F") // AaveOracle

	fxAcctAave     = common.HexToAddress("0xAaAa000000000000000000000000000000000001")
	fxAcctAaveRef  = common.HexToAddress("0xBbBb000000000000000000000000000000000002")
	fxAcctDM       = common.HexToAddress("0xCcCc000000000000000000000000000000000003")
	fxAcctDMRef    = common.HexToAddress("0xDddd000000000000000000000000000000000004")
	fxAcctUnknown  = common.HexToAddress("0xEeEe000000000000000000000000000000000005")
	fxAaveSource   = "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"
	fxDMSource     = "priceproviderv2"
	fxBatchProduce = "riskd"
)

// Blocks and stamps.
const (
	fxAaveBlock       = uint64(25_635_618)
	fxAaveParamBlock  = uint64(25_635_600)
	fxAavePriceBlock  = int64(25_635_610)
	fxDMBlock         = uint64(154_796_552)
	fxDMSweepBlock    = uint64(154_796_500)
	fxDMPriceBlock    = int64(154_796_540)
	fxAaveAckedEpoch  = int64(0)
	fxDMAckedEpoch    = int64(0)
	fxPriceBudgetSecs = int64(180)
)

// The persisted price ages. They are PERSISTED, so every served age is this
// number and not a recomputation — which is what makes the
// no-serve-time-re-derivation law testable.
const (
	fxAaveWeETHAge = int64(210) // past the 180s budget, inside the 360s ceiling => G4 stale
	fxAaveUSDCAge  = int64(12)
	fxDMWeETHAge   = int64(30)
)

// Hand-derived expectations. Every one of these appears verbatim in an assertion.
const (
	fxAaveWeETHPrice = "400000000000" // $4,000.00000000, 8-dec
	fxAaveUSDCPrice  = "100000000"    // $1.00000000, 8-dec
	fxDMWeETHPrice   = "4000000000"   // $4,000.000000, 6-dec

	fxAaveCollateralBase = "800000000000"
	fxAaveDebtBase       = "600000000000"
	fxAaveWeightedLTSum  = "6480000000000000"
	fxAaveAvgLTBps       = "8100"
	fxAaveHFWad          = "1080000000000000000"
	fxAaveHFNum          = "6480000000000000"
	fxAaveHFDen          = "6000000000000000" // 1e4 x 6e11

	fxDMCollateralUSD  = "4000000000"
	fxDMMaxBorrowLT    = "3200000000"
	fxDMBorrowings     = "4200000000"
	fxDMHFNum          = "3200000000"
	fxDMHFDen          = "4200000000"
	fxDMBadDebtAtPar   = "239603961"
	fxDMAtRiskAtPar    = "4000000000"
	fxAaveDebtAt90     = "600000000000"
	fxAaveAtRiskAt90   = "630000000000"
	fxDMBadDebtAt90    = "635643565"
	fxDMAtRiskAt90     = "3600000000"
	fxAaveLTBps        = "8100"
	fxAaveBonusBps     = "10500"
	fxDMLiqThreshold   = "80000000000000000000" // 80e18 over HUNDRED_PERCENT = 100e18
	fxDMLiqBonus       = "1000000000000000000"  // 1e18 additive => 1%
	fxAaveWeETHAmount  = "2000000000000000000"
	fxAaveUSDCDebt     = "6000000000"
	fxDMWeETHAmount    = "1000000000000000000"
	fxAaveWeETHCollBse = "800000000000"
	fxAaveUSDCDebtBase = "600000000000"
)

// fxBase is the fixture's reference instant. Stored timestamps are relative to it
// so nothing depends on when the suite runs.
var fxBase = time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)

func bi(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("fixture: " + s + " is not an integer")
	}
	return v
}

func boolp(b bool) *bool           { return &b }
func i16p(v int16) *int16          { return &v }
func i64p(v int64) *int64          { return &v }
func u64p(v uint64) *uint64        { return &v }
func timep(t time.Time) *time.Time { return &t }

// ---------------------------------------------------------------------------
// The four positions, in the READ-SIDE shape.
// ---------------------------------------------------------------------------

// fxAavePosition is the computed Aave position: healthy at par, eligible one
// 10% ETH step down, and FLAGGED because its weETH input is past its budget.
func fxAavePosition() *positionRow {
	return &positionRow{
		Engine:              risk.AaveEngine,
		Account:             fxAcctAave.Bytes(),
		Status:              store.RiskPositionComputed,
		Flags:               []string{riskfeed.FlagStalePrice},
		ValueDecimals:       8,
		HFNum:               bi(fxAaveHFNum),
		HFDen:               bi(fxAaveHFDen),
		HFWad:               bi(fxAaveHFWad),
		TotalCollateralBase: bi(fxAaveCollateralBase),
		TotalDebtBase:       bi(fxAaveDebtBase),
		WeightedLTSum:       bi(fxAaveWeightedLTSum),
		AvgLTBps:            bi(fxAaveAvgLTBps),
		BalancesBlock:       fxAaveBlock,
		ParamsBlock:         fxAaveParamBlock,
		OldestPriceInput:    timep(fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)),
		StalePriceInputs:    true,
		Legs: []legRow{
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxUSDCEth.Bytes(), Decimals: 6,
				LiveDebt: bi(fxAaveUSDCDebt), DebtBase: bi(fxAaveUSDCDebtBase),
				UsedAsCollateral: boolp(false), DebtIndexBlock: u64p(fxAaveBlock),
			},
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
				LiveCollateral: bi(fxAaveWeETHAmount), CollateralBase: bi(fxAaveWeETHCollBse),
				WeightedLT:       bi(fxAaveWeightedLTSum),
				UsedAsCollateral: boolp(true), CollateralIndexBlock: u64p(fxAaveBlock),
				LiqThreshold: bi(fxAaveLTBps), LiqBonus: bi(fxAaveBonusBps),
			},
		},
		Prices: []store.RiskBatchPriceInput{
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxUSDCEth.Bytes(),
				ChainID: int64(fxETHChain), Source: fxAaveSource, Provenance: risk.ProvenanceAdapterOutput,
				Value: bi(fxAaveUSDCPrice), Decimals: i16p(8), BlockNumber: i64p(fxAavePriceBlock),
				SourceAsOf:    timep(fxBase.Add(-time.Duration(fxAaveUSDCAge) * time.Second)),
				BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxAaveUSDCAge),
			},
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxWeETHEth.Bytes(),
				ChainID: int64(fxETHChain), Source: fxAaveSource, Provenance: risk.ProvenanceAdapterOutput,
				Value: bi(fxAaveWeETHPrice), Decimals: i16p(8), BlockNumber: i64p(fxAavePriceBlock),
				SourceAsOf:    timep(fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)),
				BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictStale, AgeSeconds: i64p(fxAaveWeETHAge),
			},
		},
	}
}

// fxAaveRefused is a G1 refusal: the weETH input is absent, so the position
// cannot be valued and is served as a refused row naming the asset.
func fxAaveRefused() *positionRow {
	return &positionRow{
		Engine:        risk.AaveEngine,
		Account:       fxAcctAaveRef.Bytes(),
		Status:        store.RiskPositionRefused,
		RefusalCode:   riskfeed.GateMissingInput,
		RefusalDetail: "aave health: no usable price input for asset " + fxWeETHEth.Hex(),
		RefusalAsset:  fxWeETHEth.Bytes(),
		Flags:         []string{},
		ValueDecimals: 8,
		BalancesBlock: fxAaveBlock,
		ParamsBlock:   fxAaveParamBlock,
		Legs: []legRow{{
			Engine: risk.AaveEngine, Account: fxAcctAaveRef.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
			LiveCollateral: bi("500000000000000000"), UsedAsCollateral: boolp(true),
			CollateralIndexBlock: u64p(fxAaveBlock),
		}},
		Prices: []store.RiskBatchPriceInput{{
			Engine: risk.AaveEngine, Account: fxAcctAaveRef.Bytes(), Asset: fxWeETHEth.Bytes(),
			ChainID: int64(fxETHChain), Source: fxAaveSource, Provenance: risk.ProvenanceAdapterOutput,
			BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictMissing,
		}},
	}
}

// fxDMPosition is the computed Debt Manager position: liquidatable at par AND
// insolvent if liquidated, which is where the standing bad-debt line comes from.
func fxDMPosition() *positionRow {
	return &positionRow{
		Engine:             risk.DMEngine,
		Account:            fxAcctDM.Bytes(),
		Status:             store.RiskPositionComputed,
		Flags:              []string{},
		ValueDecimals:      6,
		HFNum:              bi(fxDMHFNum),
		HFDen:              bi(fxDMHFDen),
		CollateralValueUSD: bi(fxDMCollateralUSD),
		MaxBorrowLT:        bi(fxDMMaxBorrowLT),
		Borrowings:         bi(fxDMBorrowings),
		Liquidatable:       boolp(true),
		BalancesBlock:      fxDMBlock,
		ParamsBlock:        fxDMBlock,
		SweepBlock:         fxDMSweepBlock,
		OldestPriceInput:   timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		Legs: []legRow{{
			Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(), Decimals: 18,
			Amount: bi(fxDMWeETHAmount), ValueUSD: bi(fxDMCollateralUSD),
			MaxBorrowContribution: bi(fxDMMaxBorrowLT),
			LiqThreshold:          bi(fxDMLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
		}},
		Prices: []store.RiskBatchPriceInput{{
			Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(),
			ChainID: int64(fxOPChain), Source: fxDMSource, Provenance: risk.ProvenanceEngineExact,
			Value: bi(fxDMWeETHPrice), Decimals: i16p(6), BlockNumber: i64p(fxDMPriceBlock),
			SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
			BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
		}},
	}
}

// fxDMRefused is the `0xe957…bf20` posture at the row level: an account that has
// never had a successful collateral sweep. Its collateral is of UNKNOWN size, so
// it is REFUSED rather than valued at zero.
func fxDMRefused() *positionRow {
	return &positionRow{
		Engine:        risk.DMEngine,
		Account:       fxAcctDMRef.Bytes(),
		Status:        store.RiskPositionRefused,
		RefusalCode:   riskfeed.GateSweepNever,
		RefusalDetail: "account has never had a successful collateral sweep (last_success_block 0)",
		Flags:         []string{},
		ValueDecimals: 6,
		Borrowings:    bi("1500000000"),
		BalancesBlock: fxDMBlock,
		ParamsBlock:   fxDMBlock,
		Legs:          []legRow{},
		Prices:        []store.RiskBatchPriceInput{},
	}
}

func fxPositions() []*positionRow {
	return []*positionRow{fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()}
}

// fxAggregates are the per-engine rollups. They are the engine's own persisted
// totals: computed positions only, refusals counted separately.
func fxAggregates() []store.RiskEngineAggregate {
	return []store.RiskEngineAggregate{
		{
			Engine: risk.AaveEngine, ValueDecimals: 8,
			Positions: 2, ComputedPositions: 1, RefusedPositions: 1, FlaggedPositions: 1,
			LiquidatablePositions: 0,
			TotalCollateral:       bi(fxAaveCollateralBase), TotalDebt: bi(fxAaveDebtBase),
		},
		{
			Engine: risk.DMEngine, ValueDecimals: 6,
			Positions: 2, ComputedPositions: 1, RefusedPositions: 1, FlaggedPositions: 0,
			LiquidatablePositions: 1,
			TotalCollateral:       bi(fxDMCollateralUSD), TotalDebt: bi(fxDMBorrowings),
		},
	}
}

// fxWatermarks stamps every engine the api judges supersession for.
func fxWatermarks() []store.RiskBatchWatermark {
	return []store.RiskBatchWatermark{
		{Engine: risk.AaveEngine, ChainID: int64(fxETHChain), LastBlock: fxAaveBlock, AckedEpoch: fxAaveAckedEpoch},
		{Engine: risk.AaveParamEngine, ChainID: int64(fxETHChain), LastBlock: fxAaveParamBlock, AckedEpoch: fxAaveAckedEpoch},
		{Engine: store.PollOwnedEnginePrefix + "1", ChainID: int64(fxETHChain), LastBlock: uint64(fxAavePriceBlock), AckedEpoch: fxAaveAckedEpoch},
		{
			Engine: risk.DMEngine, ChainID: int64(fxOPChain), LastBlock: fxDMBlock, AckedEpoch: fxDMAckedEpoch,
			Sweep: &store.RiskSweepWatermark{
				Engine: risk.DMEngine, Rows: 3, Failed: 1,
				SuccessSum: bi("309593004"), HasUpdatedAt: true, MaxUpdatedAt: fxBase.Add(-20 * time.Minute),
				Generation: 4, GenerationOpen: false,
			},
		},
		{Engine: store.PollOwnedEnginePrefix + "10", ChainID: int64(fxOPChain), LastBlock: uint64(fxDMPriceBlock), AckedEpoch: fxDMAckedEpoch},
	}
}

// fxRequiredEngines mirrors the stamped set.
func fxRequiredEngines() []string {
	out := make([]string, 0, 5)
	for _, m := range fxWatermarks() {
		out = append(out, m.Engine)
	}
	return out
}

// ---------------------------------------------------------------------------
// Read-side shape -> write-side shape.
// ---------------------------------------------------------------------------

// toWrite converts a fixture position into the store's write form, so the seeded
// database is populated through `store.WriteRiskBatch` — the SAME function riskd
// uses, with the same validation and the same completeness accounting. Seeding
// with hand-written INSERTs would let the fixture create a state the writer
// cannot produce, and then the suite would be testing a database no daemon makes.
func toWrite(p *positionRow) store.RiskPositionWrite {
	w := store.RiskPositionWrite{
		Engine: p.Engine, Account: p.Account, Status: p.Status,
		RefusalCode: p.RefusalCode, RefusalDetail: p.RefusalDetail, RefusalAsset: p.RefusalAsset,
		Flags:         p.Flags,
		ValueDecimals: uint8(p.ValueDecimals),
		HFNum:         p.HFNum, HFDen: p.HFDen, HFWad: p.HFWad, HFInfinite: p.HFInfinite,
		TotalCollateralBase: p.TotalCollateralBase, TotalDebtBase: p.TotalDebtBase,
		WeightedLTSum: p.WeightedLTSum, AvgLTBps: p.AvgLTBps,
		CollateralValueUSD: p.CollateralValueUSD, MaxBorrowLT: p.MaxBorrowLT,
		Borrowings: p.Borrowings, Liquidatable: p.Liquidatable,
		BalancesBlock: p.BalancesBlock, ParamsBlock: p.ParamsBlock, SweepBlock: p.SweepBlock,
		OldestPriceInput: p.OldestPriceInput, StalePriceInputs: p.StalePriceInputs,
	}
	for _, l := range p.Legs {
		w.Legs = append(w.Legs, store.RiskLegWrite{
			Asset: l.Asset, Decimals: uint8(l.Decimals),
			ScaledDebt: l.ScaledDebt, ScaledCollateral: l.ScaledCollateral,
			LiveDebt: l.LiveDebt, LiveCollateral: l.LiveCollateral,
			DebtBase: l.DebtBase, CollateralBase: l.CollateralBase,
			WeightedLT: l.WeightedLT, UsedAsCollateral: l.UsedAsCollateral,
			DebtIndexBlock: l.DebtIndexBlock, CollateralIndexBlock: l.CollateralIndexBlock,
			Amount: l.Amount, ValueUSD: l.ValueUSD, MaxBorrowContribution: l.MaxBorrowContribution,
			LiqThreshold: l.LiqThreshold, LiqBonus: l.LiqBonus,
		})
	}
	for _, pr := range p.Prices {
		var block *uint64
		if pr.BlockNumber != nil {
			b := uint64(*pr.BlockNumber)
			block = &b
		}
		w.Prices = append(w.Prices, store.RiskPriceInputWrite{
			Asset: pr.Asset, ChainID: uint64(pr.ChainID), Source: pr.Source, Provenance: pr.Provenance,
			Value: pr.Value, Decimals: pr.Decimals, BlockNumber: block, SourceAsOf: pr.SourceAsOf,
			BudgetSeconds: pr.BudgetSeconds, Verdict: pr.Verdict, AgeSeconds: pr.AgeSeconds,
		})
	}
	return w
}

// fxBatchWrite is the whole fixture batch, ready for store.WriteRiskBatch.
func fxBatchWrite(materializationKey string) store.RiskBatchWrite {
	w := store.RiskBatchWrite{
		Producer:             fxBatchProduce,
		Watermarks:           fxWatermarks(),
		Aggregates:           fxAggregates(),
		RequiredEngines:      fxRequiredEngines(),
		RequiredSweepEngines: []string{risk.DMEngine},
		Retention:            100,
		MaterializationKey:   materializationKey,
		Notify:               notifyChannel,
	}
	for _, p := range fxPositions() {
		w.Positions = append(w.Positions, toWrite(p))
	}
	return w
}
