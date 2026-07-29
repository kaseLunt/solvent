package risk

import (
	"errors"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// waterfallBook is three Debt Manager positions with identical collateral
// (1.0 weETH at $2,000, LT 80%, bonus 2%) and different debts, so they cross
// at three different grid points:
//
//	P1 debt $1,500 crosses below s = 0.9375
//	P2 debt $1,300 crosses below s = 0.8125
//	P3 debt $1,000 crosses below s = 0.6250
func waterfallBook(t *testing.T) []PositionInput {
	t.Helper()
	mk := func(acct string, debt string) PositionInput {
		return PositionInput{Engine: DMEngine, DM: &DMInput{
			Account: mustAddr(acct),
			DebtUSD: mustBig(t, debt),
			Collateral: []DMCollateral{
				{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
			},
			Params: []ParamRow{dmParam(dWeETH, "80000000000000000000", "2000000000000000000")},
			Prices: []PriceInput{enginePrice(dWeETH, "2000000000")},
		}}
	}
	return []PositionInput{
		mk(acctA.Hex(), "1500000000"),
		mk(acctB.Hex(), "1300000000"),
		mk(acctC.Hex(), "1000000000"),
	}
}

func wadGrid(t *testing.T, vals ...string) []*big.Int {
	t.Helper()
	out := make([]*big.Int, 0, len(vals))
	for _, v := range vals {
		out = append(out, mustBig(t, v))
	}
	return out
}

// TestWaterfallSingleFactorDownGrid pins the whole series exactly: first
// crossing, cumulative debt eligible, collateral at risk, and the
// insolvent-if-liquidated census.
//
// Every number below is computed by hand from the fixture, not read back from
// the function:
//
//	value(s)      = 2000000000 × s
//	maxBorrowLT   = floor(value × 80e18 / 100e18)
//	at risk       = min(value, floor(debt × 102e18 / 100e18))
//	recoverable   = floor(value × 100e18 / 102e18)
//	bad debt      = max(0, debt − recoverable), counted only once eligible
func TestWaterfallSingleFactorDownGrid(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	grid := wadGrid(t,
		"1000000000000000000", // 1.00
		"900000000000000000",  // 0.90
		"800000000000000000",  // 0.80
		"700000000000000000",  // 0.70
		"600000000000000000",  // 0.60
	)

	series, err := Waterfall(waterfallBook(t), grid, sc)
	require.NoError(t, err)
	require.Equal(t, "eth_minus_20", series.ScenarioID)
	require.Equal(t, "v1", series.ScenarioVersion)
	require.Equal(t, AxisRef{Axis: AxisETHUSD}, series.Axis)
	requireBig(t, "1000000000000000000", series.GridScale)
	require.Contains(t, series.EligibilityNote, "realized ≤ eligible")
	require.Empty(t, series.HeldFlat, "the ETH matrix covers every priced asset in this book")
	require.Len(t, series.Points, 5)

	want := []struct {
		newly, cumAccounts int
		debt, atRisk       string
		insolvent          int
		badDebt            string
	}{
		{0, 0, "0", "0", 0, "0"},
		{1, 1, "1500000000", "1530000000", 0, "0"},
		{1, 2, "2800000000", "2856000000", 0, "0"},
		{0, 2, "2800000000", "2726000000", 1, "127450981"},
		{1, 3, "3800000000", "3420000000", 2, "447058824"},
	}
	for k, w := range want {
		pt := series.Points[k]
		require.Equal(t, k, pt.Index)
		require.Equal(t, grid[k].String(), pt.Factor.String())
		e, ok := pt.Engine(DMEngine)
		require.True(t, ok)
		require.Equal(t, uint8(6), e.UsdDecimals)
		require.Equal(t, w.newly, e.NewlyEligibleAccounts, "grid[%d] newly eligible", k)
		require.Equal(t, w.cumAccounts, e.CumulativeEligibleAccounts, "grid[%d] cumulative accounts", k)
		requireBig(t, w.debt, e.CumulativeDebtEligibleUSD, "grid[%d] cumulative debt eligible", k)
		requireBig(t, w.atRisk, e.CumulativeCollateralAtRiskUSD, "grid[%d] collateral at risk", k)
		require.Equal(t, w.insolvent, e.InsolventIfLiquidatedAccounts, "grid[%d] insolvent census", k)
		requireBig(t, w.badDebt, e.CumulativeBadDebtUSD, "grid[%d] bad debt", k)
	}

	// The standing invariant, asserted on the produced series as well as
	// enforced inside the function.
	for k := 1; k < len(series.Points); k++ {
		prev, _ := series.Points[k-1].Engine(DMEngine)
		cur, _ := series.Points[k].Engine(DMEngine)
		require.GreaterOrEqual(t, cur.CumulativeDebtEligibleUSD.Cmp(prev.CumulativeDebtEligibleUSD), 0)
		require.GreaterOrEqual(t, cur.CumulativeEligibleAccounts, prev.CumulativeEligibleAccounts,
			"the eligible set latches on a down-grid")
	}

	// An engine with no crossings still gets a row at every point, so the
	// series can never silently omit one.
	_, ok := series.Points[0].Engine(AaveEngine)
	require.False(t, ok, "…but only for engines actually present in the book")
}

// TestWaterfallNonMonotoneIsSurfacedNeverSmoothed drives the invariant to
// FAIL, which is the only way to know the check is not decorative.
//
// The construction is honest, not contrived: the monotonicity premise is
// "single-factor down-shock WITH USD debt". Here the shocked axis IS the debt
// numéraire — an Aave position whose debt reserve is the shocked asset — so
// the debt measured at each grid point falls with the factor while the
// eligible set latches, and the cumulative series genuinely decreases.
func TestWaterfallNonMonotoneIsSurfacedNeverSmoothed(t *testing.T) {
	// Shock the DEBT asset's own USD price.
	sc := Scenario{
		ID: "synthetic_debt_asset_shock", Version: "test", Label: "L", Description: "D",
		PathAssumption: "P", Engines: []string{AaveEngine},
		Shocks: []Shock{{Axis: AxisAssetUSD, Asset: aUSDC.Hex(), FactorNum: 1, FactorDen: 1}},
		Propagation: []AssetResponse{{
			Asset: aUSDC.Hex(), ChainID: 1,
			RespondsTo: []AxisRef{{Axis: AxisAssetUSD, Asset: aUSDC.Hex()}},
		}},
		OutOfModel: []string{"synthetic: the shocked axis is the debt numeraire"},
	}

	// C = 1e8 at LT 8100 ⇒ weighted 8.1e11; D = 1e8 ⇒ HF = 0.81 < 1, so the
	// account is eligible from the very first grid point and stays latched.
	book := []PositionInput{{Engine: AaveEngine, Aave: &AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "100000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "100000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}}}

	grid := wadGrid(t, "1000000000000000000", "900000000000000000")
	series, err := Waterfall(book, grid, sc)
	require.Error(t, err)
	require.ErrorIs(t, err, ErrNonMonotone)

	var nm *NonMonotoneError
	require.True(t, errors.As(err, &nm))
	require.Equal(t, 1, nm.Index, "the offending grid point is named")
	requireBig(t, "900000000000000000", nm.Factor)
	require.Equal(t, AaveEngine, nm.Engine)
	requireBig(t, "100000000", nm.Previous)
	requireBig(t, "90000000", nm.Current)
	require.Contains(t, nm.Error(), "grid[1]")
	require.Contains(t, nm.Error(), AaveEngine)

	// The partial series comes back with the error: violations SURFACE.
	require.Len(t, series.Points, 2, "the series up to and including the violation is returned")
	require.NotEmpty(t, series.HeldFlat, "the weETH mark is outside this synthetic matrix and is disclosed")
	first, _ := series.Points[0].Engine(AaveEngine)
	requireBig(t, "100000000", first.CumulativeDebtEligibleUSD)
}

// TestWaterfallGridValidation covers the down-grid precondition and the
// single-axis precondition — both of which are what make the monotonicity
// check meaningful.
func TestWaterfallGridValidation(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	book := waterfallBook(t)

	_, err = Waterfall(book, nil, sc)
	require.ErrorIs(t, err, ErrGridNotDescending)
	require.Contains(t, err.Error(), "empty grid")

	_, err = Waterfall(book, wadGrid(t, "0"), sc)
	require.ErrorIs(t, err, ErrGridNotDescending)
	require.Contains(t, err.Error(), "not positive")

	_, err = Waterfall(book, []*big.Int{nil}, sc)
	require.ErrorIs(t, err, ErrGridNotDescending)

	_, err = Waterfall(book, wadGrid(t, "900000000000000000", "1000000000000000000"), sc)
	require.ErrorIs(t, err, ErrGridNotDescending)
	require.Contains(t, err.Error(), "is not below")

	_, err = Waterfall(book, wadGrid(t, "900000000000000000", "900000000000000000"), sc)
	require.ErrorIs(t, err, ErrGridNotDescending, "strictly descending: a repeated point is refused")

	// Multi-axis scenarios have no monotonicity guarantee, so they are refused
	// rather than walked.
	stable, err := LoadScenario("stable_depeg_098_unsnapped")
	require.NoError(t, err)
	_, err = Waterfall(book, wadGrid(t, "1000000000000000000"), stable)
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "exactly one shocked axis")

	_, err = Waterfall(book, wadGrid(t, "1000000000000000000"), Scenario{ID: "broken"})
	require.ErrorIs(t, err, ErrScenarioInvalid)

	_, err = Waterfall([]PositionInput{{Engine: "bogus"}}, wadGrid(t, "1000000000000000000"), sc)
	require.ErrorIs(t, err, ErrEngineMismatch)
}

// TestWaterfallHeldFlatIsDisclosed: an asset the propagation matrix does not
// describe is held at its pre-shock price, and the series says so. Silently
// holding a chunk of TVL flat is oracle-sentinel R4's named failure.
func TestWaterfallHeldFlatIsDisclosed(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)

	book := waterfallBook(t)
	// Give the first position an extra collateral asset the ETH matrix does
	// not describe.
	dm := *book[0].DM
	dm.Collateral = append(dm.Collateral, DMCollateral{Asset: dLiqBTC, Amount: mustBig(t, "100000000"), Decimals: 8})
	dm.Params = append(dm.Params, dmParam(dLiqBTC, "75000000000000000000", "3000000000000000000"))
	dm.Prices = append(dm.Prices, enginePrice(dLiqBTC, "95000000000"))
	book[0].DM = &dm

	series, err := Waterfall(book, wadGrid(t, "1000000000000000000", "500000000000000000"), sc)
	require.NoError(t, err)
	require.Len(t, series.HeldFlat, 1)
	require.Equal(t, dLiqBTC, series.HeldFlat[0].Asset)
	require.Equal(t, uint64(10), series.HeldFlat[0].ChainID)
	requireBig(t, "95000000000", series.HeldFlat[0].Value)
	require.Contains(t, series.HeldFlat[0].Source, "priceproviderv2")
}

// TestWaterfallEnginesReportedSeparately: a mixed book produces one row per
// engine at every point, each in its own USD scale, never summed.
func TestWaterfallEnginesReportedSeparately(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)

	book := waterfallBook(t)
	book = append(book, PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account: acctC,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "100000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "50000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}})

	series, err := Waterfall(book, wadGrid(t, "1000000000000000000", "500000000000000000"), sc)
	require.NoError(t, err)
	for _, pt := range series.Points {
		require.Len(t, pt.Engines, 2)
		require.Equal(t, AaveEngine, pt.Engines[0].Engine, "engines are sorted for deterministic output")
		require.Equal(t, DMEngine, pt.Engines[1].Engine)
		a, _ := pt.Engine(AaveEngine)
		d, _ := pt.Engine(DMEngine)
		require.Equal(t, uint8(8), a.UsdDecimals, "Aave base currency")
		require.Equal(t, uint8(6), d.UsdDecimals, "Debt Manager USD")
	}

	// At 0.5× the Aave position's weETH mark halves: C = 5e7, weighted
	// 4.05e11, D = 5e7 ⇒ HF = floor(4.05e11 × 1e18 / (1e4 × 5e7)) = 8.1e17 < 1.
	last, _ := series.Points[1].Engine(AaveEngine)
	require.Equal(t, 1, last.CumulativeEligibleAccounts)
	requireBig(t, "50000000", last.CumulativeDebtEligibleUSD)
}

// TestWaterfallEmptyBook: no positions, but the grid still walks and produces
// an (empty) point per grid value.
func TestWaterfallEmptyBook(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	series, err := Waterfall(nil, wadGrid(t, "1000000000000000000", "800000000000000000"), sc)
	require.NoError(t, err)
	require.Len(t, series.Points, 2)
	for _, pt := range series.Points {
		require.Empty(t, pt.Engines)
	}
	require.Empty(t, series.HeldFlat)
}

// TestWaterfallPointEngineLookupMiss covers the accessor's miss path.
func TestWaterfallPointEngineLookupMiss(t *testing.T) {
	pt := WaterfallPoint{Engines: []EngineWaterfall{{Engine: DMEngine}}}
	_, ok := pt.Engine(AaveEngine)
	require.False(t, ok)
	e, ok := pt.Engine(DMEngine)
	require.True(t, ok)
	require.Equal(t, DMEngine, e.Engine)
}

// TestEngineDecimalsHintFallbacks covers the priceless-position paths.
func TestEngineDecimalsHintFallbacks(t *testing.T) {
	require.Equal(t, uint8(0), engineDecimalsHint(PositionInput{Engine: AaveEngine, Aave: &AaveInput{}}))
	require.Equal(t, uint8(0), engineDecimalsHint(PositionInput{Engine: DMEngine, DM: &DMInput{}}))
	require.Equal(t, uint8(0), engineDecimalsHint(PositionInput{Engine: "other"}))
	require.Equal(t, uint8(8), engineDecimalsHint(PositionInput{Engine: AaveEngine,
		Aave: &AaveInput{Prices: []PriceInput{adapterPrice(aWeETH, "1")}}}))
	require.Equal(t, uint8(6), engineDecimalsHint(PositionInput{Engine: DMEngine,
		DM: &DMInput{Prices: []PriceInput{enginePrice(dWeETH, "1")}}}))
}

// TestBadDebtFromIsZeroForHealthyAccounts: presenting a healthy account's
// headroom as bad debt would be noise; presenting an underwater one's as
// recoverable would be spreadsheet solvency.
func TestBadDebtFromIsZeroForHealthyAccounts(t *testing.T) {
	debt := mustBig(t, "1000")
	requireBig(t, "0", badDebtFrom(debt, mustBig(t, "500"), false))
	requireBig(t, "500", badDebtFrom(debt, mustBig(t, "500"), true))
	requireBig(t, "0", badDebtFrom(debt, mustBig(t, "2000"), true))
	requireBig(t, "0", badDebtFrom(debt, mustBig(t, "1000"), true), "exactly covered is not bad debt")
}

// TestWaterfallPropagatesPerPositionErrors: a book position that cannot be
// shocked or cannot be valued stops the walk with a grid-and-index-labeled
// error rather than producing a series with a hole in it.
func TestWaterfallPropagatesPerPositionErrors(t *testing.T) {
	t.Run("ApplyScenario failure", func(t *testing.T) {
		// A stable-snap propagation row against a non-6-decimal price.
		sc := Scenario{
			ID: "snap_wrong_scale", Version: "test", Label: "L", Description: "D",
			PathAssumption: "P", Engines: []string{DMEngine},
			Shocks: []Shock{{Axis: AxisStableUSD, Asset: dUSDC.Hex(), FactorNum: 98, FactorDen: 100}},
			Propagation: []AssetResponse{{
				Asset: dUSDC.Hex(), ChainID: 10, StableSnap: true,
				RespondsTo: []AxisRef{{Axis: AxisStableUSD, Asset: dUSDC.Hex()}},
			}},
			OutOfModel: []string{"synthetic"},
		}
		p := enginePrice(dUSDC, "1000000")
		p.Decimals = 8
		book := []PositionInput{{Engine: DMEngine, DM: &DMInput{
			Account:    acctA,
			Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "1"), Decimals: 6}},
			Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "0")},
			Prices:     []PriceInput{p},
		}}}
		_, err := Waterfall(book, wadGrid(t, "1000000000000000000"), sc)
		require.ErrorIs(t, err, ErrMixedPriceDecimals)
		require.Contains(t, err.Error(), "grid[0] book[0]")
	})

	t.Run("valuation failure", func(t *testing.T) {
		sc, err := LoadScenario("eth_minus_20")
		require.NoError(t, err)
		// Collateral with no price at all: ApplyScenario has nothing to shock,
		// and the valuation refuses rather than dropping the asset.
		book := []PositionInput{{Engine: DMEngine, DM: &DMInput{
			Account:    acctA,
			Collateral: []DMCollateral{{Asset: dWeETH, Amount: mustBig(t, "1"), Decimals: 18}},
		}}}
		_, err = Waterfall(book, wadGrid(t, "1000000000000000000"), sc)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), "grid[0] book[0]")

		aaveBook := []PositionInput{{Engine: AaveEngine, Aave: &AaveInput{
			Account:  acctA,
			Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "1", "0", true)},
		}}}
		_, err = Waterfall(aaveBook, wadGrid(t, "1000000000000000000"), sc)
		require.ErrorIs(t, err, ErrMissingPrice)
	})

	t.Run("grid factor outside the scenario schema", func(t *testing.T) {
		sc, err := LoadScenario("eth_minus_20")
		require.NoError(t, err)
		huge := new(big.Int).Lsh(big.NewInt(1), 100)
		grid := []*big.Int{huge, new(big.Int).Sub(huge, big.NewInt(1))}
		_, err = Waterfall(waterfallBook(t), grid, sc)
		require.ErrorIs(t, err, ErrScenarioInvalid)
		require.Contains(t, err.Error(), "int64")
	})
}

// TestWaterfallDoesNotMislabelUsdDecimals: an engine row's stated unit must
// come from a position that actually carried a price. A priceless position
// reports 0 decimals, and stamping that over a real 6 or 8 would mislabel the
// unit on a row whose numbers are in that unit.
func TestWaterfallDoesNotMislabelUsdDecimals(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)

	book := waterfallBook(t)
	// A never-seen account: no collateral, no debt, no prices.
	book = append(book, PositionInput{Engine: DMEngine, DM: &DMInput{Account: mustAddr(
		"0x00000000000000000000000000000000000000ff")}})

	series, err := Waterfall(book, wadGrid(t, "1000000000000000000", "500000000000000000"), sc)
	require.NoError(t, err)
	for _, pt := range series.Points {
		e, ok := pt.Engine(DMEngine)
		require.True(t, ok)
		require.Equal(t, uint8(6), e.UsdDecimals,
			"the empty position must not stamp 0 over the engine's real scale")
	}
}

// TestWaterfallAtRiskColumnIsMeasuredAtPointAndMayFall documents on the suite
// what WaterfallSeries documents on the wire: the monotonicity invariant
// covers the DEBT series only. Collateral at risk is measured at each grid
// point, and it legitimately falls once the already-crossed accounts are worth
// less than they were.
func TestWaterfallAtRiskColumnIsMeasuredAtPointAndMayFall(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	grid := wadGrid(t,
		"1000000000000000000", "900000000000000000", "800000000000000000",
		"700000000000000000", "600000000000000000")

	series, err := Waterfall(waterfallBook(t), grid, sc)
	require.NoError(t, err, "the DEBT series is monotone, so the walk completes")

	atRisk := make([]*big.Int, len(series.Points))
	for i, pt := range series.Points {
		e, ok := pt.Engine(DMEngine)
		require.True(t, ok)
		atRisk[i] = e.CumulativeCollateralAtRiskUSD
	}
	// 2856000000 -> 2726000000 between grid points 2 and 3: a real decrease,
	// and NOT a violation of anything.
	require.Equal(t, -1, atRisk[3].Cmp(atRisk[2]),
		"the at-risk column falls here, which is correct and must not be smoothed")
	for i := 1; i < len(series.Points); i++ {
		prev, _ := series.Points[i-1].Engine(DMEngine)
		cur, _ := series.Points[i].Engine(DMEngine)
		require.GreaterOrEqual(t, cur.CumulativeDebtEligibleUSD.Cmp(prev.CumulativeDebtEligibleUSD), 0,
			"the DEBT series, by contrast, carries the invariant")
	}
}
