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
//	  USDC 4200000000 normalized borrowed, borrow index 1e18 (identity)
//	    live_debt = floor(4200000000 x 1e18 / 1e18) = 4200000000  ($4,200)
//	    (a PURE DEBT leg: no swept USDC collateral behind it, so amount /
//	    value_usd / max_borrow_contribution are NULL — absent, not zero)
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
	fxUSDCOp   = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85") // USDC on OP (Debt Manager borrow token)

	fxOracle = common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F") // AaveOracle

	fxAcctAave     = common.HexToAddress("0xAaAa000000000000000000000000000000000001")
	fxAcctAaveRef  = common.HexToAddress("0xBbBb000000000000000000000000000000000002")
	fxAcctDM       = common.HexToAddress("0xCcCc000000000000000000000000000000000003")
	fxAcctDMRef    = common.HexToAddress("0xDddd000000000000000000000000000000000004")
	fxAcctDMDebt   = common.HexToAddress("0x4444000000000000000000000000000000000044")
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

	fxDMCollateralUSD = "4000000000"
	fxDMMaxBorrowLT   = "3200000000"
	fxDMBorrowings    = "4200000000"
	fxDMHFNum         = "3200000000"
	fxDMHFDen         = "4200000000"
	// The DEBT-ONLY shape (Codex round 6 [HIGH]): nonzero debt, a successful
	// sweep that observed EMPTY collateral, no price witnesses at all. $1,000
	// at USD-6 — the figure the pre-fix scale-0 label inflated to $1B.
	fxDMDebtOnlyBorrowings = "1000000000"
	fxDMBadDebtAtPar  = "239603961"
	fxDMAtRiskAtPar   = "4000000000"
	fxAaveDebtAt90    = "600000000000"
	fxAaveAtRiskAt90  = "630000000000"
	fxDMBadDebtAt90   = "635643565"
	fxDMAtRiskAt90    = "3600000000"
	fxAaveLTBps       = "8100"
	fxAaveBonusBps    = "10500"
	fxDMLiqThreshold  = "80000000000000000000" // 80e18 over HUNDRED_PERCENT = 100e18
	fxDMLiqBonus      = "1000000000000000000"  // 1e18 additive => 1%
	// The merged-leg fixture (borrow token held as collateral, both sides on
	// ONE row — the live book's normal shape). Hand-derived:
	//	USDC value_usd     = floor(7240549 × 1000000 / 1e6)  = 7240549
	//	USDC contribution  = floor(7240549 × 80e18 / 100e18) = 5792439
	//	collateral total   = 4000000000 + 7240549            = 4007240549
	//	max borrow total   = 3200000000 + 5792439            = 3205792439
	//	borrowings 4200000000 > 3205792439                   => LIQUIDATABLE
	fxDMUSDCLiqThreshold = "80000000000000000000"
	fxDMUSDCAmount       = "7240549"
	fxDMUSDCValueUSD     = "7240549"
	fxDMUSDCContribution = "5792439"
	fxDMUSDCPrice        = "1000000" // $1.000000, 6-dec
	fxDMMergedCollateral = "4007240549"
	fxDMMergedMaxBorrow  = "3205792439"
	fxAaveWeETHAmount    = "2000000000000000000"
	fxAaveUSDCDebt       = "6000000000"
	fxDMWeETHAmount      = "1000000000000000000"
	fxAaveWeETHCollBse   = "800000000000"
	fxAaveUSDCDebtBase   = "600000000000"
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
		// THE DERIVED VERDICT, WRITTEN (Wave R2 Finding A). HFWad is 1.08e18,
		// above the bar, so the verdict is FALSE — a real boolean, not the NULL
		// every pre-revision-6 batch carried. Omitting it here is what made this
		// fixture agree with a broken daemon: the read-side verification had no
		// Aave verdict to weld, so a served rollup could count anything it liked.
		Liquidatable:        boolp(false),
		TotalCollateralBase: bi(fxAaveCollateralBase),
		TotalDebtBase:       bi(fxAaveDebtBase),
		WeightedLTSum:       bi(fxAaveWeightedLTSum),
		AvgLTBps:            bi(fxAaveAvgLTBps),
		BalancesBlock:       fxAaveBlock,
		ParamsBlock:         fxAaveParamBlock,
		OldestPriceInput:    timep(fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)),
		StalePriceInputs:    true,
		// EVERY leg column riskd writes is written here, ZEROS INCLUDED. riskd's
		// mergeAaveLegs assigns the recomputation's non-nil zero to the legs an asset
		// does not participate in, so a fixture leaving those NULL would not be the
		// row the daemon produces — and the per-leg verification (which compares
		// absent against zero as a genuine disagreement, because "not applicable" and
		// "zero" are different statements) would refuse it.
		Legs: []legRow{
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxUSDCEth.Bytes(), Decimals: 6,
				LiveDebt: bi(fxAaveUSDCDebt), DebtBase: bi(fxAaveUSDCDebtBase),
				LiveCollateral: bi("0"), CollateralBase: bi("0"), WeightedLT: bi("0"),
				UsedAsCollateral: boolp(false), DebtIndexBlock: u64p(fxAaveBlock),
			},
			{
				Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
				LiveCollateral: bi(fxAaveWeETHAmount), CollateralBase: bi(fxAaveWeETHCollBse),
				WeightedLT: bi(fxAaveWeightedLTSum),
				LiveDebt:   bi("0"), DebtBase: bi("0"),
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
		// TWO legs, because that is what riskd writes for a borrowing account:
		// the borrow token's PURE DEBT leg (amount and the collateral outputs
		// NULL — absent, not zero) and the swept collateral's leg. The debt-side
		// weld in verifyReconstruction demands Σ live_debt == borrowings, so a
		// fixture that persisted borrowings with no debt leg behind them would
		// be a state the daemon cannot produce AND one the serve layer refuses.
		Legs: []legRow{
			{
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxUSDCOp.Bytes(), Decimals: 6,
				ScaledDebt: bi(fxDMBorrowings), LiveDebt: bi(fxDMBorrowings),
				DebtIndexBlock: u64p(fxDMBlock),
			},
			{
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(), Decimals: 18,
				Amount: bi(fxDMWeETHAmount), ValueUSD: bi(fxDMCollateralUSD),
				MaxBorrowContribution: bi(fxDMMaxBorrowLT),
				LiqThreshold:          bi(fxDMLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
			},
		},
		Prices: []store.RiskBatchPriceInput{{
			Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(),
			ChainID: int64(fxOPChain), Source: fxDMSource, Provenance: risk.ProvenanceEngineExact,
			Value: bi(fxDMWeETHPrice), Decimals: i16p(6), BlockNumber: i64p(fxDMPriceBlock),
			SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
			BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
		}},
	}
}

// fxDMMergedPosition is the borrow-token-held-as-collateral shape — USDC on
// BOTH sides of one position, carried by ONE merged leg, exactly as
// riskfeed.assembleDM writes it (risk_position_legs' primary key has no side
// column, so two rows for one asset is a duplicate-key write failure; the
// first full-book riskd pass died there, 2026-07-31). It is NOT part of
// fxPositions — the aggregate counts across the suite stay untouched — and
// exists for the reconstruction round trip: the serve layer must read the
// merged row ONCE, count both sides, and reproduce every persisted number.
func fxDMMergedPosition() *positionRow {
	return &positionRow{
		Engine:             risk.DMEngine,
		Account:            fxAcctDM.Bytes(),
		Status:             store.RiskPositionComputed,
		Flags:              []string{},
		ValueDecimals:      6,
		HFNum:              bi(fxDMMergedMaxBorrow),
		HFDen:              bi(fxDMBorrowings),
		CollateralValueUSD: bi(fxDMMergedCollateral),
		MaxBorrowLT:        bi(fxDMMergedMaxBorrow),
		Borrowings:         bi(fxDMBorrowings),
		Liquidatable:       boolp(true),
		BalancesBlock:      fxDMBlock,
		ParamsBlock:        fxDMBlock,
		SweepBlock:         fxDMSweepBlock,
		OldestPriceInput:   timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		Legs: []legRow{
			{
				// THE MERGED LEG: debt fields AND collateral fields on one row.
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxUSDCOp.Bytes(), Decimals: 6,
				ScaledDebt: bi(fxDMBorrowings), LiveDebt: bi(fxDMBorrowings),
				DebtIndexBlock: u64p(fxDMBlock),
				Amount:         bi(fxDMUSDCAmount), ValueUSD: bi(fxDMUSDCValueUSD),
				MaxBorrowContribution: bi(fxDMUSDCContribution),
				LiqThreshold:          bi(fxDMUSDCLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
			},
			{
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(), Decimals: 18,
				Amount: bi(fxDMWeETHAmount), ValueUSD: bi(fxDMCollateralUSD),
				MaxBorrowContribution: bi(fxDMMaxBorrowLT),
				LiqThreshold:          bi(fxDMLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
			},
		},
		Prices: []store.RiskBatchPriceInput{
			{
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxUSDCOp.Bytes(),
				ChainID: int64(fxOPChain), Source: fxDMSource, Provenance: risk.ProvenanceEngineExact,
				Value: bi(fxDMUSDCPrice), Decimals: i16p(6), BlockNumber: i64p(fxDMPriceBlock),
				SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
				BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
			},
			{
				Engine: risk.DMEngine, Account: fxAcctDM.Bytes(), Asset: fxWeETHOp.Bytes(),
				ChainID: int64(fxOPChain), Source: fxDMSource, Provenance: risk.ProvenanceEngineExact,
				Value: bi(fxDMWeETHPrice), Decimals: i16p(6), BlockNumber: i64p(fxDMPriceBlock),
				SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
				BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
			},
		},
	}
}

// fxDMDebtOnlyPosition is the DEBT-ONLY Debt Manager shape (Codex round 6
// [HIGH], wave H7): nonzero debt after a SUCCESSFUL sweep observed EMPTY
// collateral — ApplySweepBatch explicitly supports that state, and live
// batch 3 carried 44 such rows. It consults NO price witnesses, which is
// exactly what made the pre-fix assembler relabel its USD-6 borrowings with
// value_decimals 0. Like fxDMMergedPosition it is NOT part of fxPositions;
// it exists for the reconstruction round trip and the serve-time scale weld.
func fxDMDebtOnlyPosition() *positionRow {
	return &positionRow{
		Engine:             risk.DMEngine,
		Account:            fxAcctDMDebt.Bytes(),
		Status:             store.RiskPositionComputed,
		Flags:              []string{},
		ValueDecimals:      6,
		HFNum:              bi("0"),
		HFDen:              bi(fxDMDebtOnlyBorrowings),
		CollateralValueUSD: bi("0"),
		MaxBorrowLT:        bi("0"),
		Borrowings:         bi(fxDMDebtOnlyBorrowings),
		Liquidatable:       boolp(true),
		BalancesBlock:      fxDMBlock,
		ParamsBlock:        fxDMBlock,
		SweepBlock:         fxDMSweepBlock,
		// ONE pure-debt leg: the borrow token with no swept balance behind it.
		// The USD figures' scale is the position's value_decimals; the leg's
		// own decimals stay the USD figure's 6 exactly as assembleDM writes it.
		Legs: []legRow{{
			Engine: risk.DMEngine, Account: fxAcctDMDebt.Bytes(), Asset: fxUSDCOp.Bytes(), Decimals: 6,
			ScaledDebt: bi(fxDMDebtOnlyBorrowings), LiveDebt: bi(fxDMDebtOnlyBorrowings),
			DebtIndexBlock: u64p(fxDMBlock),
		}},
		Prices: []store.RiskBatchPriceInput{},
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

// ---------------------------------------------------------------------------
// THE MIXED-DIRECTION AAVE BOOK (Wave W-BS-B, finding 5).
// ---------------------------------------------------------------------------
//
// `movers_total` and `newly_eligible_accounts` are DIFFERENT MEASURES, and the
// serving layer's own `movers_note` says so. Until this fixture existed, the
// distinction was only ever asserted on books where the two COINCIDE — 0/0 on
// the Debt Manager and 1/1 on Aave — so a serving layer that simply serialized
// the net count as the mover count passed every assertion. A guard that cannot
// fail is not a guard.
//
// This book makes them differ, over three Aave accounts under eth_minus_30
// (ETH -30%: weETH-on-mainnet 400000000000 -> 280000000000, USDC held flat
// because the scenario's propagation matrix does not name it):
//
//	A  weETH collateral, USDC debt   HF 1.20    -> 0.840    CROSSES DOWN
//	B  weETH collateral, USDC debt   HF 1.08    -> 0.756    CROSSES DOWN
//	C  USDC collateral, weETH DEBT   HF 0.74375 -> 1.0625   CROSSES UP
//
// C is the row that separates the two numbers, and it is not a contrivance:
// Aave lets an account BORROW weETH, and a 30% ETH drawdown shrinks a
// weETH-denominated debt in USD terms while USDC collateral holds its mark. So
// its health factor RISES and it flips eligible -> healthy.
//
//	movers_total            = 2   A and B. `runBookMovers` admits STRICT DROPS
//	                              only, so C — whose health factor rose — is
//	                              not a mover in either direction.
//	newly_eligible_accounts = 1   after 2 (A, B) minus before 1 (C). A NET
//	                              count, and the flip back to healthy is
//	                              subtracted out of it.
//
// A serving layer that serialized the net count as `movers_total` reports 1
// where this book has 2, and the DB test fails.
//
// # Why this is the AAVE analogue and not the Debt Manager's
//
// The Debt Manager's eligibility is MONOTONE under every committed scenario, so
// the mixed-direction book is not constructible there from honest rows. Its
// test is `borrowings > maxBorrowLT`; `borrowings` is the USD-NORMALIZED debt
// leg, which no scenario re-prices (`stable_depeg_0995_in_band` says so in its
// own out_of_model: "a stable depeg re-prices stable COLLATERAL but not
// outstanding debt"), and every committed shock moves prices DOWN or holds
// them — the stable snap only pulls a shocked price toward par, never above the
// mark it started from. So maxBorrowLT can only fall and an eligible DM account
// can never become healthy. Building one anyway would mean inventing a price
// path the deployed provider cannot produce.
//
// # The arithmetic, hand-derived (aave.go's own rounding, not a paraphrase)
//
//	collateral_base = floor(amount x price / 10^dec)      per reserve
//	debt_base       = ceil (amount x price / 10^dec)      per reserve
//	weighted_lt     = collateral_base x lt_bps            counting reserves only
//	avg_lt_bps      = floor(Σ weighted_lt / Σ collateral_base)   DISCLOSURE only
//	hf_wad          = floor( floor((Σ weighted_lt x 1e18 + floor(D/2)) / D) / 1e4 )
//	hf rational     = Σ weighted_lt / (1e4 x D)           NOT reduced
//	liquidatable    = hf_wad < 1e18                       STRICT; 1e18 is healthy
//
//	A  weETH 2e18 @ 4e11    -> collateral_base 800000000000, weighted_lt 6480000000000000
//	   USDC 5400e6 @ 1e8    -> debt_base       540000000000
//	   avg_lt   = 6480000000000000 / 800000000000            = 8100
//	   inner    = (6480000000000000 x 1e18 + 270000000000) / 540000000000
//	            = 12000000000000000000000 + 0                = 1.2e22
//	   hf_wad   = 1.2e22 / 1e4                               = 1200000000000000000  HEALTHY
//	   AFTER: collateral_base floor(2e18 x 2.8e11/1e18)      =  560000000000
//	          weighted_lt 8100 x 560000000000                = 4536000000000000
//	          inner (4536000000000000 x 1e18 + 2.7e11)/5.4e11 = 8.4e21
//	          hf_wad                                          =  840000000000000000  ELIGIBLE
//	          drop = 1200000000000000000 - 840000000000000000 = 360000000000000000
//
//	B  weETH 1e18 @ 4e11    -> collateral_base 400000000000, weighted_lt 3240000000000000
//	   USDC 3000e6 @ 1e8    -> debt_base       300000000000
//	   avg_lt   = 3240000000000000 / 400000000000            = 8100
//	   inner    = (3240000000000000 x 1e18 + 150000000000) / 300000000000 = 1.08e22
//	   hf_wad                                                = 1080000000000000000  HEALTHY
//	   AFTER: collateral_base                                =  280000000000
//	          weighted_lt 8100 x 280000000000                = 2268000000000000
//	          inner (2268000000000000 x 1e18 + 1.5e11)/3e11  = 7.56e21
//	          hf_wad                                          =  756000000000000000  ELIGIBLE
//	          drop = 1080000000000000000 - 756000000000000000 = 324000000000000000
//
//	C  USDC 7000e6 @ 1e8    -> collateral_base 700000000000, weighted_lt 5950000000000000
//	                           (USDC's OWN threshold, 8500bps — a second ledger row)
//	   weETH 2e18 @ 4e11    -> debt_base       800000000000   ceil, and exact here
//	   avg_lt   = 5950000000000000 / 700000000000            = 8500
//	   inner    = (5950000000000000 x 1e18 + 400000000000) / 800000000000 = 7.4375e21
//	   hf_wad   = 7.4375e21 / 1e4                            =  743750000000000000  ELIGIBLE
//	   AFTER: collateral_base UNCHANGED (USDC is held flat)  =  700000000000
//	          debt_base ceil(2e18 x 2.8e11/1e18)             =  560000000000
//	          inner (5950000000000000 x 1e18 + 2.8e11)/5.6e11 = 1.0625e22
//	          hf_wad                                          = 1062500000000000000  HEALTHY
//	          the drop is NEGATIVE, so C is not a mover at all
//
// A's drop (3.6e17) exceeds B's (3.24e17), so the ranking is total and the
// order is not a tie the sort has to break.

var (
	fxMDAcctDropsA = common.HexToAddress("0xD0D0000000000000000000000000000000000001")
	fxMDAcctDropsB = common.HexToAddress("0xD0D0000000000000000000000000000000000002")
	fxMDAcctRises  = common.HexToAddress("0xD0D0000000000000000000000000000000000003")
)

// USDC's OWN Aave configuration for the mixed-direction book. It is a SECOND
// param-ledger row (weETH's is the one `seedSubstrate` writes), because C
// counts USDC as collateral and `weldLegParams` refuses a threshold no
// custodied row asserts.
const (
	fxMDUSDCLTV      = "8000"
	fxMDUSDCLTBps    = "8500"
	fxMDUSDCBonusBps = "10450"
)

// Hand-derived, every one of them, from the block comment above.
const (
	fxMDAWeETHAmount  = "2000000000000000000"
	fxMDACollBase     = "800000000000"
	fxMDAWeightedLT   = "6480000000000000"
	fxMDAUSDCDebt     = "5400000000"
	fxMDADebtBase     = "540000000000"
	fxMDAHFWad        = "1200000000000000000"
	fxMDAHFDen        = "5400000000000000"
	fxMDAHFWadAfter   = "840000000000000000"
	fxMDADropWad      = "360000000000000000"

	fxMDBWeETHAmount = "1000000000000000000"
	fxMDBCollBase    = "400000000000"
	fxMDBWeightedLT  = "3240000000000000"
	fxMDBUSDCDebt    = "3000000000"
	fxMDBDebtBase    = "300000000000"
	fxMDBHFWad       = "1080000000000000000"
	fxMDBHFDen       = "3000000000000000"
	fxMDBHFWadAfter  = "756000000000000000"
	fxMDBDropWad     = "324000000000000000"

	fxMDCUSDCAmount   = "7000000000"
	fxMDCCollBase     = "700000000000"
	fxMDCWeightedLT   = "5950000000000000"
	fxMDCWeETHDebt    = "2000000000000000000"
	fxMDCDebtBase     = "800000000000"
	fxMDCHFWad        = "743750000000000000"
	fxMDCHFDen        = "8000000000000000"
	fxMDCHFWadAfter   = "1062500000000000000"
)

// The Aave engine's persisted rollups over A + B + C:
//
//	collateral 800000000000 + 400000000000 + 700000000000 = 1900000000000
//	debt       540000000000 + 300000000000 + 800000000000 = 1640000000000
const (
	fxMDAaveTotalCollateral = "1900000000000"
	fxMDAaveTotalDebt       = "1640000000000"
)

// fxMDPrice is one 8-decimal Aave price witness, FRESH by the fixture's own
// budget (age 30s against a 180s budget), so `fresh <=> age < budget` holds
// rather than being asserted.
func fxMDPrice(account, asset common.Address, value string) store.RiskBatchPriceInput {
	return store.RiskBatchPriceInput{
		Engine: risk.AaveEngine, Account: account.Bytes(), Asset: asset.Bytes(),
		ChainID: int64(fxETHChain), Source: fxAaveSource, Provenance: risk.ProvenanceAdapterOutput,
		Value: bi(value), Decimals: i16p(8), BlockNumber: i64p(fxAavePriceBlock),
		SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
	}
}

// fxMDCollateralDown is one of the two accounts whose health factor CROSSES
// DOWN under the shock: weETH collateral against USDC debt, the ordinary shape.
// Every leg column riskd writes is written here, ZEROS INCLUDED, for the reason
// fxAavePosition sets out — an absent number and a zero are different claims and
// the per-leg verification treats them as such.
func fxMDCollateralDown(
	account common.Address,
	weETHAmount, collBase, weightedLT, usdcDebt, debtBase, hfWad, hfDen string,
) *positionRow {
	return &positionRow{
		Engine:              risk.AaveEngine,
		Account:             account.Bytes(),
		Status:              store.RiskPositionComputed,
		Flags:               []string{},
		ValueDecimals:       8,
		HFNum:               bi(weightedLT),
		HFDen:               bi(hfDen),
		HFWad:               bi(hfWad),
		Liquidatable:        boolp(false),
		TotalCollateralBase: bi(collBase),
		TotalDebtBase:       bi(debtBase),
		WeightedLTSum:       bi(weightedLT),
		AvgLTBps:            bi(fxAaveLTBps),
		BalancesBlock:       fxAaveBlock,
		ParamsBlock:         fxAaveParamBlock,
		OldestPriceInput:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		Legs: []legRow{
			{
				Engine: risk.AaveEngine, Account: account.Bytes(), Asset: fxUSDCEth.Bytes(), Decimals: 6,
				LiveDebt: bi(usdcDebt), DebtBase: bi(debtBase),
				LiveCollateral: bi("0"), CollateralBase: bi("0"), WeightedLT: bi("0"),
				UsedAsCollateral: boolp(false), DebtIndexBlock: u64p(fxAaveBlock),
			},
			{
				Engine: risk.AaveEngine, Account: account.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
				LiveCollateral: bi(weETHAmount), CollateralBase: bi(collBase), WeightedLT: bi(weightedLT),
				LiveDebt: bi("0"), DebtBase: bi("0"),
				UsedAsCollateral: boolp(true), CollateralIndexBlock: u64p(fxAaveBlock),
				LiqThreshold: bi(fxAaveLTBps), LiqBonus: bi(fxAaveBonusBps),
			},
		},
		Prices: []store.RiskBatchPriceInput{
			fxMDPrice(account, fxUSDCEth, fxAaveUSDCPrice),
			fxMDPrice(account, fxWeETHEth, fxAaveWeETHPrice),
		},
	}
}

// fxMDDebtInShockedAsset is the account that CROSSES UP: its DEBT is weETH and
// its collateral is USDC, so the same 30% ETH drawdown that sinks A and B
// shrinks this account's debt while its collateral holds its mark. It is
// eligible at par and healthy after the shock — the flip the NET count
// subtracts and the mover count never sees.
func fxMDDebtInShockedAsset() *positionRow {
	return &positionRow{
		Engine:              risk.AaveEngine,
		Account:             fxMDAcctRises.Bytes(),
		Status:              store.RiskPositionComputed,
		Flags:               []string{},
		ValueDecimals:       8,
		HFNum:               bi(fxMDCWeightedLT),
		HFDen:               bi(fxMDCHFDen),
		HFWad:               bi(fxMDCHFWad),
		Liquidatable:        boolp(true),
		TotalCollateralBase: bi(fxMDCCollBase),
		TotalDebtBase:       bi(fxMDCDebtBase),
		WeightedLTSum:       bi(fxMDCWeightedLT),
		AvgLTBps:            bi(fxMDUSDCLTBps),
		BalancesBlock:       fxAaveBlock,
		ParamsBlock:         fxAaveParamBlock,
		OldestPriceInput:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		Legs: []legRow{
			{
				// USDC as COLLATERAL — the leg that needs its own ledger row.
				Engine: risk.AaveEngine, Account: fxMDAcctRises.Bytes(), Asset: fxUSDCEth.Bytes(), Decimals: 6,
				LiveCollateral: bi(fxMDCUSDCAmount), CollateralBase: bi(fxMDCCollBase),
				WeightedLT: bi(fxMDCWeightedLT),
				LiveDebt:   bi("0"), DebtBase: bi("0"),
				UsedAsCollateral: boolp(true), CollateralIndexBlock: u64p(fxAaveBlock),
				LiqThreshold: bi(fxMDUSDCLTBps), LiqBonus: bi(fxMDUSDCBonusBps),
			},
			{
				// weETH as DEBT. It carries NO threshold: the account counts none
				// of it as collateral, so no param row is required or consulted.
				Engine: risk.AaveEngine, Account: fxMDAcctRises.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
				LiveDebt: bi(fxMDCWeETHDebt), DebtBase: bi(fxMDCDebtBase),
				LiveCollateral: bi("0"), CollateralBase: bi("0"), WeightedLT: bi("0"),
				UsedAsCollateral: boolp(false), DebtIndexBlock: u64p(fxAaveBlock),
			},
		},
		Prices: []store.RiskBatchPriceInput{
			fxMDPrice(fxMDAcctRises, fxUSDCEth, fxAaveUSDCPrice),
			fxMDPrice(fxMDAcctRises, fxWeETHEth, fxAaveWeETHPrice),
		},
	}
}

// fxMixedDirectionBatchWrite is the whole mixed-direction batch: the three Aave
// rows above plus the standard Debt Manager position, so the book has both
// engines and the DM's own honest pair (nothing flips there) rides along as the
// control. The aggregates are summed from the rows, which `store.WriteRiskBatch`
// requires and the serving completeness predicate re-checks.
func fxMixedDirectionBatchWrite(key string) store.RiskBatchWrite {
	positions := []*positionRow{
		fxMDCollateralDown(fxMDAcctDropsA, fxMDAWeETHAmount, fxMDACollBase, fxMDAWeightedLT,
			fxMDAUSDCDebt, fxMDADebtBase, fxMDAHFWad, fxMDAHFDen),
		fxMDCollateralDown(fxMDAcctDropsB, fxMDBWeETHAmount, fxMDBCollBase, fxMDBWeightedLT,
			fxMDBUSDCDebt, fxMDBDebtBase, fxMDBHFWad, fxMDBHFDen),
		fxMDDebtInShockedAsset(),
		fxDMPosition(),
	}
	w := store.RiskBatchWrite{
		Producer:             fxBatchProduce,
		Watermarks:           fxWatermarks(),
		RequiredEngines:      fxRequiredEngines(),
		RequiredSweepEngines: []string{risk.DMEngine},
		Retention:            100,
		MaterializationKey:   key,
		Notify:               notifyChannel,
		Aggregates: []store.RiskEngineAggregate{
			{
				Engine: risk.AaveEngine, ValueDecimals: 8,
				Positions: 3, ComputedPositions: 3, RefusedPositions: 0, FlaggedPositions: 0,
				// ONE eligible at par: C. A and B are healthy until the shock.
				LiquidatablePositions: 1,
				TotalCollateral:       bi(fxMDAaveTotalCollateral), TotalDebt: bi(fxMDAaveTotalDebt),
			},
			{
				Engine: risk.DMEngine, ValueDecimals: 6,
				Positions: 1, ComputedPositions: 1, RefusedPositions: 0, FlaggedPositions: 0,
				LiquidatablePositions: 1,
				TotalCollateral:       bi(fxDMCollateralUSD), TotalDebt: bi(fxDMBorrowings),
			},
		},
	}
	for _, p := range positions {
		w.Positions = append(w.Positions, toWrite(p))
	}
	return w
}

func fxPositions() []*positionRow {
	return []*positionRow{fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()}
}

// fxParamWitness is the PARAM LEDGER the fixture's legs are welded against —
// the independent second witness for each leg's liquidation threshold and bonus.
//
// It matches what the seeded `param_history` (Aave) and `position_events` (Debt
// Manager) rows fold to, so the pure tests and the live-database tests weld
// against the same facts.
func fxParamWitness() *paramWitness {
	return &paramWitness{byEngineBlock: map[string]map[uint64]map[common.Address]risk.ParamRow{
		risk.AaveEngine: {
			fxAaveParamBlock: {
				fxWeETHEth: {
					Engine: risk.AaveParamEngine, ChainID: fxETHChain, Asset: fxWeETHEth,
					LiqThreshold: bi(fxAaveLTBps), LiqBonus: bi(fxAaveBonusBps),
					EffectiveBlock: fxParamEffectiveBlock, Source: "param_history",
				},
			},
		},
		risk.DMEngine: {
			fxDMBlock: {
				fxWeETHOp: {
					Engine: risk.DMEngine, ChainID: fxOPChain, Asset: fxWeETHOp,
					LiqThreshold: bi(fxDMLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
					EffectiveBlock: fxDMParamEffectiveBlock, Source: "position_events",
				},
				// USDC is BOTH the borrow token and a collateral token — the
				// live book's normal shape. The merged-leg fixture's threshold
				// weld needs the ledger to assert USDC's own config.
				fxUSDCOp: {
					Engine: risk.DMEngine, ChainID: fxOPChain, Asset: fxUSDCOp,
					LiqThreshold: bi(fxDMUSDCLiqThreshold), LiqBonus: bi(fxDMLiqBonus),
					EffectiveBlock: fxDMParamEffectiveBlock, Source: "position_events",
				},
			},
		},
	}}
}

// fxParamEffectiveBlock / fxDMParamEffectiveBlock are where each engine's param
// row sits. Both are BELOW the position's params_block, which is the whole point:
// a param is effective from the log that set it.
const (
	fxParamEffectiveBlock   = fxAaveParamBlock - 1_000
	fxDMParamEffectiveBlock = fxDMBlock - 5_000
)

// ---------------------------------------------------------------------------
// The ENGINE-SCOPED refusal fixtures (Codex round 1 [critical]).
// ---------------------------------------------------------------------------

// fxWithheldAggregates is the honest maintenance state the collateral-flag replay
// produces: the Aave engine's whole book is WITHHELD with ZERO positions behind
// it, while the Debt Manager serves normally.
//
// This is the exact shape that used to serve as a clean, healthy, empty Aave book:
// zero positions, zero totals, and — before the fix — no refusal anywhere on the
// wire, because the refusal lives on the AGGREGATE rather than on any position row.
func fxWithheldAggregates() []store.RiskEngineAggregate {
	return []store.RiskEngineAggregate{
		{
			Engine: risk.AaveEngine, ValueDecimals: 8,
			Positions: 0, ComputedPositions: 0, RefusedPositions: 0, FlaggedPositions: 0,
			LiquidatablePositions: 0,
			TotalCollateral:       new(big.Int), TotalDebt: new(big.Int),
			RefusalCode:   riskfeed.GateFlagCustodyUnproven,
			RefusalDetail: fxWithheldDetail,
		},
		{
			Engine: risk.DMEngine, ValueDecimals: 6,
			Positions: 1, ComputedPositions: 1, RefusedPositions: 0, FlaggedPositions: 0,
			LiquidatablePositions: 1,
			TotalCollateral:       bi(fxDMCollateralUSD), TotalDebt: bi(fxDMBorrowings),
		},
	}
}

// fxProvenEmptyAggregates is the DISCRIMINATING CONTROL: an Aave engine that is
// byte-for-byte as empty as the withheld one — zero positions, zero totals — and
// GENUINELY PROVEN, carrying no refusal code.
//
// It exists because "the withheld engine is served as refused" is only meaningful
// if an identically-shaped PROVEN engine is served as an honest empty book. Without
// it, a serving path that marked every empty engine refused would pass.
func fxProvenEmptyAggregates() []store.RiskEngineAggregate {
	out := fxWithheldAggregates()
	out[0].RefusalCode, out[0].RefusalDetail = "", ""
	return out
}

const fxWithheldDetail = "aave_v3_etherfi derived state is not proven to have been walked from block 20625519 under a decode registry including the collateral-flag events"

// fxWithheldBatchWrite is a batch in which the Aave engine is withheld and only
// the Debt Manager position is present.
func fxWithheldBatchWrite(key string, aggregates []store.RiskEngineAggregate) store.RiskBatchWrite {
	w := store.RiskBatchWrite{
		Producer:             fxBatchProduce,
		Watermarks:           fxWatermarks(),
		Aggregates:           aggregates,
		RequiredEngines:      fxRequiredEngines(),
		RequiredSweepEngines: []string{risk.DMEngine},
		Retention:            100,
		MaterializationKey:   key,
		Notify:               notifyChannel,
		Positions:            []store.RiskPositionWrite{toWrite(fxDMPosition())},
	}
	return w
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
