package risk

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// The factor-level closed form.
// ---------------------------------------------------------------------------

// TestComputeLiquidationPriceFactorLevelClosedForm walks a hand-checkable
// Debt Manager position:
//
//	weETH  1.0 @ $2,000  LT 80%  →  value 2000000000, weight 2000000000×80e18
//	USDC   $1,000        LT 95%  →  value 1000000000, weight 1000000000×95e18
//	debt   $2,000
//
//	W·D          = 100e18 × 2000000000
//	Σ_{i∉F} wᵢ   = 1000000000 × 95e18        (the USDC leg, held)
//	Σ_{i∈F} wᵢ   = 2000000000 × 80e18        (the weETH leg, the factor)
//	s*           = (200000000000e18 − 95000000000e18) / 160000000000e18
//	             = 105/160 = 21/32 = 0.65625
//	P*           = 0.65625 × 2000000000 = 1312500000  ($1,312.50)
//
// The rational is kept exact; the floored display value is asserted too.
func TestComputeLiquidationPriceFactorLevelClosedForm(t *testing.T) {
	pos := PositionInput{
		Engine: DMEngine,
		Marks:  Watermarks{BalancesBlock: 154848114, ParamsBlock: 154848000, SweepBlock: 154840000},
		DM: &DMInput{
			Account: acctA,
			DebtUSD: mustBig(t, "2000000000"),
			Collateral: []DMCollateral{
				{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dUSDC, Amount: mustBig(t, "1000000000"), Decimals: 6},
			},
			Params: []ParamRow{
				dmParam(dWeETH, "80000000000000000000", "2000000000000000000"),
				dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
			},
			Prices: []PriceInput{enginePrice(dWeETH, "2000000000"), enginePrice(dUSDC, "1000000")},
		},
	}

	lp, inFactor, err := ComputeLiquidationPrice(pos, []common.Address{dWeETH})
	require.NoError(t, err)
	require.True(t, inFactor)
	require.True(t, lp.InFactor)
	require.False(t, lp.NeverLiquidatable)
	require.Equal(t, DMEngine, lp.Engine)
	require.Equal(t, acctA, lp.Account)

	// s* = 21/32 exactly. The stored form is un-reduced but must compare equal.
	require.Equal(t, 0, lp.ScaleFactor.Cmp(Rational{Num: big.NewInt(21), Den: big.NewInt(32)}))
	require.Equal(t, -1, lp.ScaleFactor.CmpScaled(big.NewInt(1), big.NewInt(1)),
		"s* < 1 ⇒ the position is healthy now and liquidates on the way down")
	require.False(t, lp.AlreadyBreached)

	require.Len(t, lp.Prices, 1)
	require.Equal(t, dWeETH, lp.Prices[0].Asset)
	requireBig(t, "2000000000", lp.Prices[0].CurrentPrice)
	require.Equal(t, uint8(6), lp.Prices[0].PriceDecimals)
	requireBig(t, "1312500000", lp.Prices[0].PriceFloor, "$1,312.50")
	requireBig(t, "1312500000", lp.Prices[0].LowestHealthyPrice, "P* is an exact integer here, so the two forms agree")
	require.Equal(t, 0, lp.Prices[0].Price.Cmp(Rational{Num: mustBig(t, "1312500000"), Den: big.NewInt(1)}))

	// Disclosures.
	require.Equal(t, []common.Address{dWeETH}, lp.Disclosures.FactorAssets)
	require.Equal(t, []common.Address{dUSDC}, lp.Disclosures.HeldAssets)
	require.True(t, lp.Disclosures.BoundaryIsHealthy)
	require.True(t, lp.Disclosures.PerTokenFloorOmitted, "the DM surface floors per token on-chain")
	require.True(t, lp.Disclosures.Diagnostic, "a single-asset factor over a multi-asset book is ceteris paribus")
	require.Equal(t, uint64(154848114), lp.Disclosures.Marks.BalancesBlock)

	// The boundary really is healthy: at exactly P* the position is not
	// liquidatable, one unit below it is.
	atStar := pos
	dmCopy := *pos.DM
	dmCopy.Prices = []PriceInput{enginePrice(dWeETH, "1312500000"), enginePrice(dUSDC, "1000000")}
	atStar.DM = &dmCopy
	h, err := ComputeDMHealth(*atStar.DM)
	require.NoError(t, err)
	requireBig(t, "2000000000", h.MaxBorrowLT, "1312.5×0.8 + 1000×0.95 = 1050 + 950")
	require.False(t, h.Liquidatable, "exactly at P* is HEALTHY (strict >)")

	dmCopy2 := *pos.DM
	dmCopy2.Prices = []PriceInput{enginePrice(dWeETH, "1312499999"), enginePrice(dUSDC, "1000000")}
	below := pos
	below.DM = &dmCopy2
	h, err = ComputeDMHealth(*below.DM)
	require.NoError(t, err)
	require.True(t, h.Liquidatable, "one unit below P* liquidates")
}

// TestComputeLiquidationPriceMultiAssetFactor: with both assets in the factor
// the whole book scales together and the solve is not a diagnostic.
func TestComputeLiquidationPriceMultiAssetFactor(t *testing.T) {
	pos := PositionInput{
		Engine: DMEngine,
		DM: &DMInput{
			Account: acctA,
			DebtUSD: mustBig(t, "1000000000"), // $1,000
			Collateral: []DMCollateral{
				{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dWETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
			},
			Params: []ParamRow{
				dmParam(dWeETH, "80000000000000000000", "2000000000000000000"),
				dmParam(dWETH, "80000000000000000000", "2000000000000000000"),
			},
			Prices: []PriceInput{enginePrice(dWeETH, "1000000000"), enginePrice(dWETH, "1000000000")},
		},
	}
	// Σw = 2000000000 × 80e18; W·D = 100e18 × 1000000000.
	// s* = 100000000000e18 / 160000000000e18 = 5/8 = 0.625.
	lp, inFactor, err := ComputeLiquidationPrice(pos, []common.Address{dWeETH, dWETH})
	require.NoError(t, err)
	require.True(t, inFactor)
	require.Equal(t, 0, lp.ScaleFactor.Cmp(Rational{Num: big.NewInt(5), Den: big.NewInt(8)}))
	require.Len(t, lp.Prices, 2)
	for _, p := range lp.Prices {
		requireBig(t, "625000000", p.PriceFloor, "$625.00")
	}
	require.Empty(t, lp.Disclosures.HeldAssets)
	require.False(t, lp.Disclosures.Diagnostic, "a whole-book factor is the headline, not a diagnostic")
}

// TestComputeLiquidationPriceDegenerateCases covers every marker.
func TestComputeLiquidationPriceDegenerateCases(t *testing.T) {
	build := func(debt string, includeWeETH bool) PositionInput {
		dm := &DMInput{
			Account: acctA,
			DebtUSD: mustBig(t, debt),
			Collateral: []DMCollateral{
				{Asset: dUSDC, Amount: mustBig(t, "1000000000"), Decimals: 6},
			},
			Params: []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
			Prices: []PriceInput{enginePrice(dUSDC, "1000000")},
		}
		if includeWeETH {
			dm.Collateral = append(dm.Collateral,
				DMCollateral{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18})
			dm.Params = append(dm.Params, dmParam(dWeETH, "80000000000000000000", "2000000000000000000"))
			dm.Prices = append(dm.Prices, enginePrice(dWeETH, "2000000000"))
		}
		return PositionInput{Engine: DMEngine, DM: dm}
	}

	t.Run("not in factor: the position holds none of the factor's assets", func(t *testing.T) {
		lp, inFactor, err := ComputeLiquidationPrice(build("500000000", false), []common.Address{dWeETH})
		require.NoError(t, err)
		require.False(t, inFactor)
		require.False(t, lp.InFactor)
		require.True(t, lp.NeverLiquidatable)
		require.Equal(t, "position holds no counted collateral in the factor", lp.Reason)
		require.Empty(t, lp.Prices)
		require.True(t, lp.ScaleFactor.Infinite == false && lp.ScaleFactor.Num == nil)
	})

	t.Run("no debt: nothing can liquidate it", func(t *testing.T) {
		lp, inFactor, err := ComputeLiquidationPrice(build("0", true), []common.Address{dWeETH})
		require.NoError(t, err)
		require.True(t, inFactor)
		require.True(t, lp.NeverLiquidatable)
		require.Equal(t, "position carries no debt", lp.Reason)
	})

	t.Run("held collateral already covers the debt at threshold", func(t *testing.T) {
		// $1,000 USDC at 95% = $950 of threshold-weighted collateral held
		// OUTSIDE the factor, against $500 of debt: the weETH leg can go to
		// zero and the position stays healthy.
		lp, inFactor, err := ComputeLiquidationPrice(build("500000000", true), []common.Address{dWeETH})
		require.NoError(t, err)
		require.True(t, inFactor)
		require.True(t, lp.NeverLiquidatable)
		require.Equal(t, "collateral outside the factor already covers the debt at threshold", lp.Reason)
	})

	t.Run("exactly covered by held collateral is also never-liquidatable", func(t *testing.T) {
		// debt = $950 exactly equals the held threshold-weighted collateral;
		// the numerator is zero, so s* ≤ 0.
		lp, _, err := ComputeLiquidationPrice(build("950000000", true), []common.Address{dWeETH})
		require.NoError(t, err)
		require.True(t, lp.NeverLiquidatable)
	})

	t.Run("already breached: s* >= 1 at current prices", func(t *testing.T) {
		// debt $2,550 against $950 held + $1,600 factor-weighted:
		// W·D − held = 255000000000e18 − 95000000000e18 = 160000000000e18,
		// exactly the factor weight ⇒ s* = 1.
		lp, _, err := ComputeLiquidationPrice(build("2550000000", true), []common.Address{dWeETH})
		require.NoError(t, err)
		require.False(t, lp.NeverLiquidatable)
		require.True(t, lp.AlreadyBreached)
		require.Equal(t, 0, lp.ScaleFactor.Cmp(Rational{Num: big.NewInt(1), Den: big.NewInt(1)}))
		requireBig(t, "2000000000", lp.Prices[0].PriceFloor, "P* == the current price")
	})

	t.Run("an empty factor set is not in factor", func(t *testing.T) {
		lp, inFactor, err := ComputeLiquidationPrice(build("500000000", true), nil)
		require.NoError(t, err)
		require.False(t, inFactor)
		require.True(t, lp.NeverLiquidatable)
	})
}

// TestComputeLiquidationPriceAaveSurface covers the Aave arm, whose weights
// use basis points and whose per-token floor is NOT omitted.
func TestComputeLiquidationPriceAaveSurface(t *testing.T) {
	pos := PositionInput{
		Engine: AaveEngine,
		Aave: &AaveInput{
			Account: acctA,
			Reserves: []AaveReserve{
				simpleReserve(aWeETH, 8, "200000000", "0", true),
				simpleReserve(aUSDC, 8, "0", "100000000", false),
			},
			Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
		},
	}
	// C = 200000000, LT = 8100, D = 100000000.
	// s* = (1e4 × 1e8 − 0) / (2e8 × 8100) = 1e12 / 1.62e12 = 100/162 = 50/81.
	lp, inFactor, err := ComputeLiquidationPrice(pos, []common.Address{aWeETH})
	require.NoError(t, err)
	require.True(t, inFactor)
	require.Equal(t, 0, lp.ScaleFactor.Cmp(Rational{Num: big.NewInt(50), Den: big.NewInt(81)}))
	require.False(t, lp.Disclosures.PerTokenFloorOmitted, "Aave's threshold sum has no per-token floor")
	require.False(t, lp.Disclosures.Diagnostic, "single collateral asset, nothing held")
	requireBig(t, "61728395", lp.Prices[0].PriceFloor, "floor(1e8 × 50/81) = floor(61728395.06…)")
	requireBig(t, "61728396", lp.Prices[0].LowestHealthyPrice, "ceil(61728395.06…)")

	// P* is FRACTIONAL here, so floor(P*) is already a liquidating price and
	// ceil(P*) is the lowest price at which the position still stands. A
	// surface that rendered only the floor would be off by one unit in the
	// dangerous direction.
	for _, tc := range []struct {
		price    string
		healthy  bool
		whatever string
	}{
		{"61728396", true, "LowestHealthyPrice = ceil(P*) is healthy"},
		{"61728395", false, "PriceFloor = floor(P*) already liquidates"},
		{"61728394", false, "further below"},
	} {
		cp := *pos.Aave
		cp.Prices = []PriceInput{adapterPrice(aWeETH, tc.price), adapterPrice(aUSDC, "100000000")}
		h, err := ComputeAaveHealth(cp)
		require.NoError(t, err)
		require.Equal(t, tc.healthy, h.HealthFactorWad.Cmp(WadUnit()) >= 0, tc.whatever)
	}
}

// TestComputeLiquidationPriceRefusals: input errors propagate rather than
// producing a number.
func TestComputeLiquidationPriceRefusals(t *testing.T) {
	_, _, err := ComputeLiquidationPrice(PositionInput{Engine: "bogus"}, nil)
	require.ErrorIs(t, err, ErrEngineMismatch)

	bad := PositionInput{Engine: DMEngine, DM: &DMInput{
		Account:    acctA,
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: big.NewInt(1), Decimals: 6}},
	}}
	_, _, err = ComputeLiquidationPrice(bad, []common.Address{dUSDC})
	require.ErrorIs(t, err, ErrMissingPrice)

	badAave := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "1", "0", true)},
	}}
	_, _, err = ComputeLiquidationPrice(badAave, []common.Address{aWeETH})
	require.ErrorIs(t, err, ErrMissingPrice)
}

// TestComputeLiquidationPriceSkipsZeroValueLegs covers the weight-collection
// guards: a zero-value collateral leg carries no weight on either side of the
// factor split.
func TestComputeLiquidationPriceSkipsZeroValueLegs(t *testing.T) {
	pos := PositionInput{Engine: DMEngine, DM: &DMInput{
		Account: acctA,
		DebtUSD: mustBig(t, "1000000000"),
		Collateral: []DMCollateral{
			{Asset: dUSDT, Amount: big.NewInt(0), Decimals: 6},
			{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
		},
		Params: []ParamRow{dmParam(dWeETH, "80000000000000000000", "2000000000000000000")},
		Prices: []PriceInput{enginePrice(dWeETH, "2000000000")},
	}}
	lp, inFactor, err := ComputeLiquidationPrice(pos, []common.Address{dWeETH, dUSDT})
	require.NoError(t, err)
	require.True(t, inFactor)
	require.Equal(t, []common.Address{dWeETH}, lp.Disclosures.FactorAssets,
		"the zero-value leg carries no weight and is not a factor member")
	require.Empty(t, lp.Disclosures.HeldAssets)
	// s* = (100e18 x 1000000000) / (2000000000 x 80e18) = 1e29/1.6e29 = 5/8.
	require.Equal(t, 0, lp.ScaleFactor.Cmp(Rational{Num: big.NewInt(5), Den: big.NewInt(8)}))

	// Same on the Aave surface: a reserve with zero base value is skipped.
	aavePos := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aPYUSD, 8, "0", "0", true),
			simpleReserve(aWeETH, 8, "200000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "100000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}}
	lp, _, err = ComputeLiquidationPrice(aavePos, []common.Address{aWeETH, aPYUSD})
	require.NoError(t, err)
	require.Equal(t, []common.Address{aWeETH}, lp.Disclosures.FactorAssets)
}
