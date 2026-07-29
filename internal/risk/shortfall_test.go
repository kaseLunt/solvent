package risk

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// depegBook builds a two-position Debt Manager book against the weETH market
// depeg:
//
//	acctA — HEALTHY:      1.0 weETH @ $2,000 oracle, LT 80%, debt $1,000
//	                      maxBorrowLT = $1,600 > $1,000 ⇒ not liquidatable
//	acctB — LIQUIDATABLE: 1.0 weETH @ $2,000 oracle, LT 80%, debt $1,900
//	                      maxBorrowLT = $1,600 < $1,900 ⇒ liquidatable
func depegBook(t *testing.T) []PositionInput {
	t.Helper()
	mk := func(account, debt string) PositionInput {
		return PositionInput{Engine: DMEngine, DM: &DMInput{
			Marks:   testDMMarks,
			Account: mustAddr(account),
			DebtUSD: mustBig(t, debt),
			Collateral: []DMCollateral{
				{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
			},
			Params: []ParamRow{dmParam(dWeETH, "80000000000000000000", "2000000000000000000")},
			Prices: []PriceInput{enginePrice(dWeETH, "2000000000")},
		}}
	}
	return []PositionInput{
		mk(acctA.Hex(), "1000000000"),
		mk(acctB.Hex(), "1900000000"),
	}
}

// TestExecutionShortfallOraclesHeldHFsBitIdentical is the pinned market-depeg
// test design spec §6 and Codex round 1 [M8] require: with oracles held, every
// health factor must come out BIT-IDENTICAL while the shortfall is strictly
// positive. The forbidden implementation is a health-factor shock wearing a
// depeg label, and this test is what catches it.
func TestExecutionShortfallOraclesHeldHFsBitIdentical(t *testing.T) {
	book := depegBook(t)

	// Health BEFORE, captured as raw integers.
	type snap struct {
		liquidatable bool
		hfNum, hfDen string
		maxBorrow    string
	}
	before := make([]snap, len(book))
	for i, p := range book {
		h, err := ComputeDMHealth(*p.DM)
		require.NoError(t, err)
		before[i] = snap{h.Liquidatable, h.HealthFactor.Num.String(), h.HealthFactor.Den.String(), h.MaxBorrowLT.String()}
	}
	require.False(t, before[0].liquidatable)
	require.True(t, before[1].liquidatable)

	sc, err := LoadScenario("weeth_market_depeg_oracles_held")
	require.NoError(t, err)
	res, err := ExecutionShortfall(book, sc.MarketRealizationsFor())
	require.NoError(t, err)

	require.True(t, res.HFsUnchanged, "the depeg axis must not move a single oracle mark")

	// Health AFTER, recomputed from the SAME book: bit-identical.
	for i, p := range book {
		h, err := ComputeDMHealth(*p.DM)
		require.NoError(t, err)
		require.Equal(t, before[i].liquidatable, h.Liquidatable)
		require.Equal(t, before[i].hfNum, h.HealthFactor.Num.String())
		require.Equal(t, before[i].hfDen, h.HealthFactor.Den.String())
		require.Equal(t, before[i].maxBorrow, h.MaxBorrowLT.String())
	}

	// …and the shortfall is real.
	require.Equal(t, DMEngine, res.SingleEngineScale)
	require.NotNil(t, res.ExecutionShortfallUSD)
	require.Positive(t, res.ExecutionShortfallUSD.Sign(), "shortfall must be strictly positive")

	// Exact arithmetic on the liquidatable position (acctB):
	//   collateral oracle       = $2,000.000000        = 2000000000
	//   bonus                   = 2e18 over 100e18     ⇒ 1.02×
	//   seizable at oracle      = min(2000000000, floor(1900000000 × 102/100))
	//                           = min(2000000000, 1938000000) = 1938000000
	//   market ratio            = 0.95
	//   seizable at market      = floor(1938000000 × (2000000000×0.95e18) / (1e18×2000000000))
	//                           = floor(1938000000 × 0.95) = 1841100000
	//   execution shortfall     = 1938000000 − 1841100000 = 96900000  ($96.90)
	//   realizable collateral   = floor(2000000000 × 0.95) = 1900000000
	//   bad debt                = max(0, 1900000000 − 1900000000) = 0
	require.Len(t, res.Positions, 2)
	b := res.Positions[1]
	require.True(t, b.Liquidatable)
	requireBig(t, "2000000000", b.CollateralOracleUSD)
	requireBig(t, "1938000000", b.SeizableOracleUSD)
	requireBig(t, "1841100000", b.SeizableMarketUSD)
	requireBig(t, "96900000", b.ExecutionShortfallUSD)
	requireBig(t, "1900000000", b.RealizableCollateralUSD)
	requireBig(t, "0", b.BadDebtUSD, "at 0.95 the collateral still exactly covers this debt")

	// The healthy position contributes nothing to the aggregates.
	requireBig(t, "96900000", res.ExecutionShortfallUSD)
	requireBig(t, "0", res.BadDebtAtLiquidationUSD)
	require.Equal(t, 1, res.PerEngine[DMEngine].LiquidatablePositions)
	require.Equal(t, 0, res.PerEngine[DMEngine].InsolventPositions)
	require.Equal(t, uint8(6), res.PerEngine[DMEngine].UsdDecimals)
	// The seizure assumption is stamped ON THE WIRE: a shortfall number is
	// only interpretable next to the model that produced it.
	require.Equal(t, "pro-rata-over-counted-collateral", SeizureModelProRata)
	require.Equal(t, SeizureModelProRata, res.SeizureModel)
}

// TestExecutionShortfallProducesBadDebt: push the depeg deep enough that the
// realizable collateral no longer covers the debt, and the bad-debt census
// fires.
func TestExecutionShortfallProducesBadDebt(t *testing.T) {
	book := depegBook(t)
	// 0.80 of oracle: realizable = floor(2000000000 × 0.8) = 1600000000,
	// bad debt on acctB = 1900000000 − 1600000000 = 300000000 ($300).
	res, err := ExecutionShortfall(book, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "800000000000000000")},
	})
	require.NoError(t, err)
	require.True(t, res.HFsUnchanged)
	requireBig(t, "300000000", res.BadDebtAtLiquidationUSD)
	require.Equal(t, 1, res.PerEngine[DMEngine].InsolventPositions)

	// seizable at market = floor(1938000000 × 0.8) = 1550400000
	// execution shortfall = 1938000000 − 1550400000 = 387600000
	requireBig(t, "387600000", res.ExecutionShortfallUSD)

	// The healthy position's row still carries its own numbers for
	// inspection, but is excluded from the aggregates.
	require.False(t, res.Positions[0].Liquidatable)
	requireBig(t, "1600000000", res.Positions[0].RealizableCollateralUSD)
	requireBig(t, "0", res.Positions[0].BadDebtUSD, "$1,000 debt against $1,600 realizable")
}

// TestExecutionShortfallUnrealizedAssetsKeepFullValue: an asset with no
// realization entry realizes at par (ratio 1.0), never at zero.
func TestExecutionShortfallUnrealizedAssetsKeepFullValue(t *testing.T) {
	book := depegBook(t)
	res, err := ExecutionShortfall(book, nil)
	require.NoError(t, err)
	require.True(t, res.HFsUnchanged)
	requireBig(t, "0", res.ExecutionShortfallUSD, "no realization ⇒ no gap")
	requireBig(t, "2000000000", res.Positions[1].RealizableCollateralUSD)
	requireBig(t, "0", res.BadDebtAtLiquidationUSD)
}

// TestExecutionShortfallEnginesAreNeverBlended: the two engines use different
// USD scales (8-decimal base vs 6-decimal USD), so a mixed book gets NO flat
// aggregate at all — reading one would be reading a sum of incommensurable
// numbers.
func TestExecutionShortfallEnginesAreNeverBlended(t *testing.T) {
	dm := depegBook(t)
	aave := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Marks:   testAaveMarks,
		Account: acctC,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "100000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "95000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}}

	mixed := append(append([]PositionInput{}, dm...), aave)
	res, err := ExecutionShortfall(mixed, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "950000000000000000")},
		{Asset: aWeETH, ChainID: 1, MarketOverOracle: mustBig(t, "950000000000000000")},
	})
	require.NoError(t, err)
	require.True(t, res.HFsUnchanged)
	require.Equal(t, "", res.SingleEngineScale)
	require.Nil(t, res.ExecutionShortfallUSD, "no flat aggregate across two USD scales")
	require.Nil(t, res.BadDebtAtLiquidationUSD)
	require.Len(t, res.PerEngine, 2)
	require.Equal(t, uint8(6), res.PerEngine[DMEngine].UsdDecimals)
	require.Equal(t, uint8(8), res.PerEngine[AaveEngine].UsdDecimals)

	// The Aave position: C=1e8, LT=8100 ⇒ weighted 8.1e11; D=95000000.
	// HF = floor(8.1e11 × 1e18 / (1e4 × 9.5e7)) = 852631578947368421 < 1e18.
	require.Equal(t, 1, res.PerEngine[AaveEngine].LiquidatablePositions)
	a := res.Positions[2]
	require.True(t, a.Liquidatable)
	// bonus 10600 bps ⇒ seizable = min(1e8, floor(95000000 × 10600/10000))
	//                            = min(100000000, 100700000) = 100000000
	requireBig(t, "100000000", a.SeizableOracleUSD)
	requireBig(t, "95000000", a.SeizableMarketUSD, "floor(1e8 × 0.95)")
	requireBig(t, "5000000", a.ExecutionShortfallUSD)
	requireBig(t, "0", a.BadDebtUSD, "realizable 95000000 == debt 95000000")
}

// TestExecutionShortfallZeroCollateralPosition covers the divide-by-zero guard
// on the pro-rata blend.
func TestExecutionShortfallZeroCollateralPosition(t *testing.T) {
	res, err := ExecutionShortfall([]PositionInput{
		{Engine: DMEngine, DM: &DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: mustBig(t, "1000000")}},
	}, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "950000000000000000")},
	})
	require.NoError(t, err)
	require.True(t, res.Positions[0].Liquidatable, "debt with no collateral is liquidatable")
	requireBig(t, "0", res.Positions[0].SeizableOracleUSD)
	requireBig(t, "0", res.Positions[0].SeizableMarketUSD)
	requireBig(t, "0", res.Positions[0].ExecutionShortfallUSD)
	requireBig(t, "1000000", res.Positions[0].BadDebtUSD, "all of it is bad debt")
}

// TestExecutionShortfallEmptyBook.
func TestExecutionShortfallEmptyBook(t *testing.T) {
	res, err := ExecutionShortfall(nil, nil)
	require.NoError(t, err)
	require.True(t, res.HFsUnchanged)
	require.Empty(t, res.Positions)
	require.Empty(t, res.PerEngine)
	require.Equal(t, "", res.SingleEngineScale)
	require.Nil(t, res.ExecutionShortfallUSD)
}

// TestExecutionShortfallRefusals.
func TestExecutionShortfallRefusals(t *testing.T) {
	book := depegBook(t)

	_, err := ExecutionShortfall(book, []MarketRealization{{Asset: dWeETH, ChainID: 10}})
	require.ErrorIs(t, err, ErrNegativeAmount)

	_, err = ExecutionShortfall(book, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: big.NewInt(0)},
	})
	require.ErrorIs(t, err, ErrNegativeAmount)

	_, err = ExecutionShortfall(book, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: big.NewInt(1)},
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: big.NewInt(2)},
	})
	require.ErrorIs(t, err, ErrDuplicatePriceInput)

	_, err = ExecutionShortfall([]PositionInput{{Engine: "bogus"}}, nil)
	require.ErrorIs(t, err, ErrEngineMismatch)

	_, err = ExecutionShortfall([]PositionInput{
		{Engine: DMEngine, DM: &DMInput{
			Marks:      testDMMarks,
			Account:    acctA,
			Collateral: []DMCollateral{{Asset: dUSDC, Amount: big.NewInt(1), Decimals: 6}},
		}},
	}, nil)
	require.ErrorIs(t, err, ErrMissingPrice)

	_, err = ExecutionShortfall([]PositionInput{
		{Engine: AaveEngine, Aave: &AaveInput{
			Marks:    testAaveMarks,
			Account:  acctA,
			Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "1", "0", true)},
		}},
	}, nil)
	require.ErrorIs(t, err, ErrMissingPrice)
}

// TestSameWadHealth covers the nil handling of the bit-identity comparator.
func TestSameWadHealth(t *testing.T) {
	require.True(t, sameWadHealth(nil, nil))
	require.False(t, sameWadHealth(big.NewInt(1), nil))
	require.False(t, sameWadHealth(nil, big.NewInt(1)))
	require.True(t, sameWadHealth(big.NewInt(1), big.NewInt(1)))
	require.False(t, sameWadHealth(big.NewInt(1), big.NewInt(2)))
}

// TestExecutionShortfallDetectsAMovedOracle proves the HFsUnchanged guard is
// LIVE. Through the public API the market-realization pass never touches a
// price, so the false branch is unreachable and indistinguishable from a
// hard-coded `true`. Swapping the pass for one that DOES move a price must
// flip the flag — otherwise the pinned oracles-held assertion proves nothing.
func TestExecutionShortfallDetectsAMovedOracle(t *testing.T) {
	saved := marketRealizationPass
	t.Cleanup(func() { marketRealizationPass = saved })

	// The forbidden implementation: a "market realization" that shocks the
	// oracle mark.
	marketRealizationPass = func(pos PositionInput) PositionInput {
		out := pos
		cp := *pos.DM
		cp.Prices = append([]PriceInput(nil), pos.DM.Prices...)
		cp.Prices[0].Value = MulDivFloor(cp.Prices[0].Value, big.NewInt(95), big.NewInt(100))
		out.DM = &cp
		return out
	}

	res, err := ExecutionShortfall(depegBook(t), []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "950000000000000000")},
	})
	require.NoError(t, err)
	require.False(t, res.HFsUnchanged,
		"an HF shock wearing a depeg label MUST be detected — this is the forbidden implementation")

	// And with the real pass restored, it is true again.
	marketRealizationPass = saved
	res, err = ExecutionShortfall(depegBook(t), []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "950000000000000000")},
	})
	require.NoError(t, err)
	require.True(t, res.HFsUnchanged)
}

// TestExecutionShortfallSkipsZeroValueLegs covers the zero-collateral leg path
// in the pro-rata blend.
func TestExecutionShortfallSkipsZeroValueLegs(t *testing.T) {
	pos := PositionInput{Engine: DMEngine, DM: &DMInput{
		Marks:   testDMMarks,
		Account: acctA,
		DebtUSD: mustBig(t, "1900000000"),
		Collateral: []DMCollateral{
			{Asset: dUSDT, Amount: big.NewInt(0), Decimals: 6},
			{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
		},
		Params: []ParamRow{dmParam(dWeETH, "80000000000000000000", "2000000000000000000")},
		Prices: []PriceInput{enginePrice(dWeETH, "2000000000")},
	}}
	res, err := ExecutionShortfall([]PositionInput{pos}, []MarketRealization{
		{Asset: dWeETH, ChainID: 10, MarketOverOracle: mustBig(t, "950000000000000000")},
	})
	require.NoError(t, err)
	require.True(t, res.Positions[0].Liquidatable)
	requireBig(t, "96900000", res.Positions[0].ExecutionShortfallUSD,
		"the zero-amount leg contributes nothing and does not dilute the blend")
}

// TestExecutionShortfallPropagatesRealizedPassErrors covers the second health
// computation's failure path, reachable only through the seam.
func TestExecutionShortfallPropagatesRealizedPassErrors(t *testing.T) {
	saved := marketRealizationPass
	t.Cleanup(func() { marketRealizationPass = saved })

	marketRealizationPass = func(pos PositionInput) PositionInput {
		out := pos
		if pos.DM != nil {
			cp := *pos.DM
			cp.Prices = nil // the realized copy can no longer be valued
			out.DM = &cp
		}
		if pos.Aave != nil {
			cp := *pos.Aave
			cp.Prices = nil
			out.Aave = &cp
		}
		return out
	}

	_, err := ExecutionShortfall(depegBook(t), nil)
	require.ErrorIs(t, err, ErrMissingPrice)

	_, err = ExecutionShortfall([]PositionInput{{Engine: AaveEngine, Aave: &AaveInput{
		Marks:    testAaveMarks,
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "100000000", "0", true)},
		Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
	}}}, nil)
	require.ErrorIs(t, err, ErrMissingPrice)
}

// TestAaveSeizableUsesEachTokensOwnBonus is BLOCKER-2's Aave arm. Two equal
// 1e8 collateral legs at bonuses 10600 and 10500 bps against 1e8 of debt:
//
//	per-token: min(1e8, floor(1e8 x 1e8 x 10600 / (2e8 x 1e4)))   = 53000000
//	         + min(1e8, floor(1e8 x 1e8 x 10500 / (2e8 x 1e4)))   = 52500000
//	                                                              = 105500000
//	min-bonus collapse: min(2e8, floor(1e8 x 10500/1e4))          = 105000000
//
// and on the recovery side the collapse OVERSTATES what the collateral can
// retire, which is the direction that hides bad debt.
func TestAaveSeizableUsesEachTokensOwnBonus(t *testing.T) {
	h, err := ComputeAaveHealth(AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "100000000", "0", true),
			simpleReserve(aPYUSD, 8, "100000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "100000000", false),
		},
		Params: []ParamRow{
			aaveParam(aWeETH, "8100", "10600"),
			aaveParam(aPYUSD, "7500", "10500"),
		},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "100000000"),
			adapterPrice(aPYUSD, "100000000"),
			adapterPrice(aUSDC, "100000000"),
		},
	})
	require.NoError(t, err)

	legs := aaveBonusLegs(h)
	require.Len(t, legs, 2)
	requireBig(t, "105500000", seizableValue(h.TotalDebtBase, legs))
	requireBig(t, "189577717", recoverableDebt(legs),
		"floor(1e8 x 1e4/10600) + floor(1e8 x 1e4/10500)")

	// The REFUTED min-bonus collapse, computed here from the same totals.
	requireBig(t, "105000000", minBig(h.TotalCollateralBase,
		MulDivFloor(h.TotalDebtBase, big.NewInt(10500), BpsUnit())))
	collapsed := MulDivFloor(h.TotalCollateralBase, BpsUnit(), big.NewInt(10500))
	requireBig(t, "190476190", collapsed)
	require.Equal(t, 1, collapsed.Cmp(recoverableDebt(legs)),
		"the collapse OVERSTATES recovery, which understates bad debt")
}

// TestAaveEligibilityIsStrictAtExactlyOne: Aave liquidates only BELOW a health
// factor of exactly 1e18, so HF == 1e18 is HEALTHY. Kills a `<` to `<=`
// mutation on both the waterfall and shortfall eligibility tests; the Debt
// Manager analog is TestComputeDMHealthStrictInequalityBoundary.
//
//	C = 1e8, LT = 8100 bps, D = 81000000
//	HF = floor(1e8 x 8100 x 1e18 / (1e4 x 81000000)) = 1000000000000000000 exactly
func TestAaveEligibilityIsStrictAtExactlyOne(t *testing.T) {
	build := func(debt string) PositionInput {
		return PositionInput{Engine: AaveEngine, Aave: &AaveInput{
			Marks:   testAaveMarks,
			Account: acctA,
			Reserves: []AaveReserve{
				simpleReserve(aWeETH, 8, "100000000", "0", true),
				simpleReserve(aUSDC, 8, "0", debt, false),
			},
			Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
		}}
	}

	at := build("81000000")
	h, err := ComputeAaveHealth(*at.Aave)
	require.NoError(t, err)
	requireBig(t, "1000000000000000000", h.HealthFactorWad, "exactly 1.0")

	m, err := measurePosition(at)
	require.NoError(t, err)
	require.False(t, m.eligible, "HF == 1e18 is HEALTHY: the protocol liquidates strictly below")
	requireBig(t, "0", m.badDebt)

	res, err := ExecutionShortfall([]PositionInput{at}, nil)
	require.NoError(t, err)
	require.False(t, res.Positions[0].Liquidatable)
	require.Equal(t, 0, res.PerEngine[AaveEngine].LiquidatablePositions)

	// One unit of debt more and it crosses.
	over := build("81000001")
	h, err = ComputeAaveHealth(*over.Aave)
	require.NoError(t, err)
	requireBig(t, "999999987654321140", h.HealthFactorWad)
	m, err = measurePosition(over)
	require.NoError(t, err)
	require.True(t, m.eligible)

	res, err = ExecutionShortfall([]PositionInput{over}, nil)
	require.NoError(t, err)
	require.True(t, res.Positions[0].Liquidatable)
}
