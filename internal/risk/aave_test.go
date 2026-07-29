package risk

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// End-to-end: the golden borrower, from scaled balances to the chain's HF.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthGoldenBorrowerEndToEnd walks all seven components with
// the REAL probe vectors on both ray legs and lands on the REAL chain health
// factor.
//
// Construction (stated, because half of it is synthetic):
//
//   - Collateral leg uses probe vector F-A verbatim: scaled 58420665095130 ×
//     index 1000002131081530318762840784 → 58420789594330 wei of weETH (floor).
//   - Debt leg uses probe vector C-A verbatim: scaled 125415 × index
//     1094089501745475497022017896 → 137216 units of USDC (ceil).
//   - The two PRICES are synthetic, chosen so the base totals land exactly on
//     the recorded golden-borrower values C = 12305519 and D = 13720591
//     (8-decimal base currency, i.e. $0.12305519 and $0.13720591 — this is one
//     of the three sub-1.0 dust positions the probe found live at the pin).
//     weETH at 210635958286 is $2106.36; USDC at 99992647 is $0.99992647. Both
//     are plausible marks, but they are solved-for, not read.
//   - LT = 8100 bps is the real weETH configuration (the single
//     CollateralConfigurationChanged the configurator ever emitted).
//
// The ASSERTION — 726460718055075032 — is the chain's own healthFactor.
func TestComputeAaveHealthGoldenBorrowerEndToEnd(t *testing.T) {
	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			{
				Asset: aWeETH, Decimals: 18,
				ScaledCollateral: mustBig(t, "58420665095130"),
				CollateralIndex:  mustBig(t, "1000002131081530318762840784"),
				ScaledDebt:       big.NewInt(0),
				IndexBlock:       25635610, IndexTime: fixedTime,
				UsedAsCollateral: true,
			},
			{
				Asset: aUSDC, Decimals: 6,
				ScaledCollateral: big.NewInt(0),
				ScaledDebt:       mustBig(t, "125415"),
				DebtIndex:        mustBig(t, "1094089501745475497022017896"),
				IndexBlock:       25635612, IndexTime: fixedTime,
				UsedAsCollateral: false,
			},
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "210635958286"),
			adapterPrice(aUSDC, "99992647"),
		},
	}

	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)

	// Components 2 and 3.
	requireBig(t, "58420789594330", h.Reserves[0].LiveCollateral, "component 3: rayMulFloor")
	requireBig(t, "0", h.Reserves[0].LiveDebt)
	requireBig(t, "137216", h.Reserves[1].LiveDebt, "component 2: rayMulCeil")
	requireBig(t, "0", h.Reserves[1].LiveCollateral)

	// Component 4/5.
	requireBig(t, "12305519", h.Reserves[0].CollateralBase)
	requireBig(t, "13720591", h.Reserves[1].DebtBase)
	requireBig(t, "12305519", h.TotalCollateralBase)
	requireBig(t, "13720591", h.TotalDebtBase)
	require.Equal(t, uint8(8), h.BaseDecimals)

	// Component 6 — disclosure. Uniform LT, so the average is exactly 8100.
	requireBig(t, "99674703900", h.WeightedLTSum, "12305519 × 8100")
	requireBig(t, "8100", h.AvgLiquidationThresholdBps)

	// Component 7 — the chain's own number.
	requireBig(t, "726460718055075032", h.HealthFactorWad)
	require.False(t, h.IsInfinite)

	// The exact rational carries the same quantity un-rounded, and re-flooring
	// it to WAD must reproduce the same integer.
	requireBig(t, "99674703900", h.HealthFactor.Num)
	requireBig(t, "137205910000", h.HealthFactor.Den, "10000 × totalDebtBase")
	v, ok := h.HealthFactor.FloorScaled(WadUnit())
	require.True(t, ok)
	requireBig(t, "726460718055075032", v)

	// Below 1.0 — this really is one of the sub-1.0 dust positions.
	require.Equal(t, -1, h.HealthFactor.CmpScaled(big.NewInt(1), big.NewInt(1)))

	require.False(t, h.StalePriceInputs)
	require.Equal(t, fixedTime, h.OldestPriceInput)
	require.Equal(t, RegimeB, h.Regime)
}

// TestComputeAaveHealthSecondGoldenVector pins the 0x849b5e51 borrower with a
// single-reserve construction where the base values are set directly (both
// indexes RAY, both prices 1e8 at 8 decimals, so base value == token amount).
func TestComputeAaveHealthSecondGoldenVector(t *testing.T) {
	in := AaveInput{
		Account: acctC,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "10000153", "0", true),
			simpleReserve(aUSDC, 8, "0", "9604879", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "100000000"),
			adapterPrice(aUSDC, "100000000"),
		},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "10000153", h.TotalCollateralBase)
	requireBig(t, "9604879", h.TotalDebtBase)
	requireBig(t, "843334302285328112", h.HealthFactorWad)
}

// ---------------------------------------------------------------------------
// The weighted-sum vs aggregate-LT distinction (P-2's disclosed caveat).
// ---------------------------------------------------------------------------

// TestComputeAaveHealthMixedLTUsesWeightedSum is the synthetic mixed-LT
// discriminator P-2 asks for. The live book has uniform LT = 8100 bps, so
// "fused over Σ(Cᵢ·LTᵢ)" and "fused over C_total × avgLT" coincide on every
// real borrower and no chain vector can separate them. These two vectors can.
//
// # Vector M-2 — the minimal, last-digit discriminator
//
// Constructed so the weighted sum leaves remainder EXACTLY 1 when divided by
// the total collateral, which is the smallest possible truncation loss in the
// average-threshold step:
//
//	s = C₁·LT₁ + C₂·LT₂ = 7500·C + 600·C₁   with LT₁=8100, LT₂=7500, C=C₁+C₂
//	so   s mod C = (600·C₁) mod C
//	pick 600·C₁ − 1 = 301·C  (i.e. C₁ ≡ 150 mod 301), giving s mod C = 1
//	  C₁ = 63999999999967, C₂ = 63574750830532, C = 127574750830499
//	  s  = 995210631228722700, avgLT_floor = s/C = 7801 (remainder 1)
//
// With D = 1e14 the fused scale 1e18/(1e4·1e14) is exactly 1, so
//
//	weighted-sum-fused  = s     = 995210631228722700
//	aggregate-LT-fused  = s − 1 = 995210631228722699
//
// # Vector M-1 — the realistic, gross divergence
//
// Ordinary magnitudes, no construction: the average-threshold truncation
// throws away s mod C = 46000000000000, and the two forms differ by that much
// (46 trillion wad = 4.6e-5 of health factor). A mixed-LT book does not need a
// contrived vector to expose the difference; M-2 only shows the floor is
// reached.
func TestComputeAaveHealthMixedLTUsesWeightedSum(t *testing.T) {
	cases := []struct {
		name                      string
		c1, c2, debt              string
		wantWeightedSum           string
		wantAvgLT                 string
		wantHFWeightedSumFused    string
		refutedHFAggregateLTFused string
	}{
		{
			name: "M-2 constructed last-digit discriminator",
			c1:   "63999999999967", c2: "63574750830532", debt: "100000000000000",
			wantWeightedSum:           "995210631228722700",
			wantAvgLT:                 "7801",
			wantHFWeightedSumFused:    "995210631228722700",
			refutedHFAggregateLTFused: "995210631228722699",
		},
		{
			name: "M-1 realistic gross divergence",
			c1:   "64000000000000", c2: "63000000000000", debt: "100000000000000",
			wantWeightedSum:           "990900000000000000",
			wantAvgLT:                 "7802",
			wantHFWeightedSumFused:    "990900000000000000",
			refutedHFAggregateLTFused: "990854000000000000",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Both prices are 1e8 at 8 decimals, so base value == amount and
			// the test is purely about the threshold fusion.
			in := AaveInput{
				Account: acctA,
				Reserves: []AaveReserve{
					simpleReserve(aWeETH, 8, tc.c1, "0", true),
					simpleReserve(aPYUSD, 8, tc.c2, "0", true),
					simpleReserve(aUSDC, 8, "0", tc.debt, false),
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
			}
			h, err := ComputeAaveHealth(in)
			require.NoError(t, err)

			requireBig(t, tc.wantWeightedSum, h.WeightedLTSum)
			requireBig(t, tc.wantAvgLT, h.AvgLiquidationThresholdBps)
			requireBig(t, tc.wantHFWeightedSumFused, h.HealthFactorWad,
				"the shipped law fuses over the exact weighted sum")

			// The refuted form, computed here from the SAME totals, must be
			// the recorded aggregate-LT value and must differ from what
			// shipped.
			aggregate, ok := FusedHealthFactorWad(
				new(big.Int).Mul(h.TotalCollateralBase, h.AvgLiquidationThresholdBps),
				h.TotalDebtBase)
			require.True(t, ok)
			requireBig(t, tc.refutedHFAggregateLTFused, aggregate)
			require.NotEqual(t, h.HealthFactorWad.String(), aggregate.String(),
				"the two fusion forms must be distinguishable on this vector, or it proves nothing")
		})
	}
}

// TestComputeAaveHealthUniformLTFusionFormsCoincide records WHY the live book
// cannot discriminate: with one LT the two forms are equal by construction.
func TestComputeAaveHealthUniformLTFusionFormsCoincide(t *testing.T) {
	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "12305519", "0", true),
			simpleReserve(aUSDC, 8, "0", "13720591", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	aggregate, ok := FusedHealthFactorWad(
		new(big.Int).Mul(h.TotalCollateralBase, h.AvgLiquidationThresholdBps), h.TotalDebtBase)
	require.True(t, ok)
	require.Equal(t, h.HealthFactorWad.String(), aggregate.String(),
		"uniform LT: the forms coincide, which is exactly why the live book cannot separate them")
}

// ---------------------------------------------------------------------------
// Zero-debt and empty positions.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthZeroDebtIsInfiniteNotABigNumber: the chain returns
// type(uint256).max; this package returns a typed marker and a nil value.
func TestComputeAaveHealthZeroDebtIsInfiniteNotABigNumber(t *testing.T) {
	in := AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "100000000", "0", true)},
		Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	require.Nil(t, h.HealthFactorWad, "no fake big number")
	require.True(t, h.HealthFactor.Infinite)
	require.Nil(t, h.HealthFactor.Num)
	require.Nil(t, h.HealthFactor.Den)
	requireBig(t, "0", h.TotalDebtBase)
	requireBig(t, "100000000", h.TotalCollateralBase)
	requireBig(t, "8100", h.AvgLiquidationThresholdBps)
}

// TestComputeAaveHealthEmptyPosition covers the empty-set probe class: an
// account with no reserves at all, and one whose reserves are all zero.
func TestComputeAaveHealthEmptyPosition(t *testing.T) {
	h, err := ComputeAaveHealth(AaveInput{Account: acctA})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	requireBig(t, "0", h.TotalCollateralBase)
	requireBig(t, "0", h.TotalDebtBase)
	requireBig(t, "0", h.WeightedLTSum)
	require.Nil(t, h.AvgLiquidationThresholdBps, "no collateral ⇒ no average threshold, not a zero one")
	require.Empty(t, h.Reserves)
	require.True(t, h.OldestPriceInput.IsZero())

	// Zero balances, and therefore no price or param needed at all.
	h, err = ComputeAaveHealth(AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 18, "0", "0", true)},
	})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	requireBig(t, "0", h.TotalCollateralBase)
	require.Len(t, h.Reserves, 1)
	requireBig(t, "0", h.Reserves[0].LiveCollateral)

	// Nil balances behave as zero, not as an error.
	h, err = ComputeAaveHealth(AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{{Asset: aWeETH, Decimals: 18, UsedAsCollateral: true}},
	})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
}

// ---------------------------------------------------------------------------
// Stale-index disclosure (Codex round 1 [H5]).
// ---------------------------------------------------------------------------

// TestComputeAaveHealthStaleIndexIntervalSurfacesItsAsOf: rate_indexes updates
// only on ReserveDataUpdated and can trail the derive cursor badly. The math
// still computes with the last index it has — refusing would be worse — but
// the index's own as-of must come out on the row, so a current balances
// watermark cannot hide the debt leg's true shelf life.
func TestComputeAaveHealthStaleIndexIntervalSurfacesItsAsOf(t *testing.T) {
	balancesBlock := uint64(25635618)
	indexBlock := uint64(25630000) // 5,618 blocks behind
	indexTime := fixedTime.Add(-19 * time.Hour)

	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			{
				Asset: aWeETH, Decimals: 8,
				ScaledCollateral: mustBig(t, "20000000"),
				CollateralIndex:  RayUnit(),
				ScaledDebt:       big.NewInt(0),
				IndexBlock:       indexBlock, IndexTime: indexTime,
				UsedAsCollateral: true,
			},
			{
				Asset: aUSDC, Decimals: 8,
				ScaledDebt: mustBig(t, "10000000"),
				DebtIndex:  RayUnit(),
				IndexBlock: indexBlock, IndexTime: indexTime,
			},
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	h.Marks = Watermarks{BalancesBlock: balancesBlock, ParamsBlock: 25635618}

	require.Greater(t, h.Marks.BalancesBlock-h.Reserves[0].IndexBlock, uint64(1000),
		"the fixture must actually exercise a badly trailing index")
	for _, r := range h.Reserves {
		require.Equal(t, indexBlock, r.IndexBlock, "the index as-of must survive onto the row")
		require.Equal(t, indexTime, r.IndexTime)
	}
	// And it still computed, with the last index it had.
	requireBig(t, "162000000000", h.WeightedLTSum, "20000000 × 8100")
	requireBig(t, "1620000000000000000", h.HealthFactorWad)
}

// TestComputeAaveHealthStaleFlagPropagates: a not-fresh input flags the whole
// row, and the oldest as-of is reported as the min (never as a blend).
func TestComputeAaveHealthStaleFlagPropagates(t *testing.T) {
	old := fixedTime.Add(-26 * time.Hour)
	stale := adapterPrice(aUSDC, "100000000")
	stale.Fresh = false
	stale.AsOf = old

	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), stale},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.True(t, h.StalePriceInputs)
	require.Equal(t, old, h.OldestPriceInput)
	require.False(t, h.Reserves[1].Price.Fresh)

	// All fresh ⇒ no flag.
	in.Prices[1].Fresh = true
	in.Prices[1].AsOf = fixedTime
	h, err = ComputeAaveHealth(in)
	require.NoError(t, err)
	require.False(t, h.StalePriceInputs)
	require.Equal(t, fixedTime, h.OldestPriceInput)
}

// ---------------------------------------------------------------------------
// Refusals: never silently drop, never silently pick.
// ---------------------------------------------------------------------------

func TestComputeAaveHealthRefusals(t *testing.T) {
	base := func() AaveInput {
		return AaveInput{
			Account: acctA,
			Reserves: []AaveReserve{
				simpleReserve(aWeETH, 8, "20000000", "0", true),
				simpleReserve(aUSDC, 8, "0", "10000000", false),
			},
			Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
		}
	}

	t.Run("missing price on a debt leg is refused, never dropped", func(t *testing.T) {
		in := base()
		in.Prices = in.Prices[:1]
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), aUSDC.Hex())
	})

	t.Run("missing price on a collateral leg is refused", func(t *testing.T) {
		in := base()
		in.Prices = in.Prices[1:]
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), aWeETH.Hex())
	})

	t.Run("missing liquidation threshold is refused, never treated as zero", func(t *testing.T) {
		in := base()
		in.Params = nil
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)
		require.Contains(t, err.Error(), aWeETH.Hex())

		in = base()
		in.Params[0].LiqThreshold = nil
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)
	})

	t.Run("a Debt Manager param row on the Aave surface is refused", func(t *testing.T) {
		in := base()
		// 8100 in the DM's convention would be 0.0000000000000081%, and 81e18
		// read as bps would be astronomically wrong. The engine tag is the
		// only evidence of which one this row is.
		in.Params = []ParamRow{dmParam(aWeETH, "81000000000000000000", "1000000000000000000")}
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrParamEngineMismatch)
		require.Contains(t, err.Error(), "row engine debt_manager, want aave_param")
	})

	t.Run("duplicate price inputs are refused, never silently picked", func(t *testing.T) {
		in := base()
		in.Prices = append(in.Prices, adapterPrice(aWeETH, "200000000"))
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrDuplicatePriceInput)
	})

	t.Run("duplicate param rows are refused", func(t *testing.T) {
		in := base()
		in.Params = append(in.Params, aaveParam(aWeETH, "7000", "10600"))
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrDuplicateParamRow)
	})

	t.Run("an uncapped feed row is refused on the Aave surface", func(t *testing.T) {
		in := base()
		in.Prices[0].Provenance = ProvenanceUncappedFeed
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrProvenanceNotAllowed)
		require.Contains(t, err.Error(), ProvenanceUncappedFeed)

		in = base()
		in.Prices[0].Provenance = ProvenanceRatioReference
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrProvenanceNotAllowed)
	})

	t.Run("engine-exact is accepted on the Aave surface", func(t *testing.T) {
		in := base()
		in.Prices[0].Provenance = ProvenanceEngineExact
		in.Prices[1].Provenance = ProvenanceEngineExact
		_, err := ComputeAaveHealth(in)
		require.NoError(t, err)
	})

	t.Run("mixed price decimals are refused", func(t *testing.T) {
		in := base()
		in.Prices[1].Decimals = 18
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMixedPriceDecimals)
	})

	t.Run("a non-positive price is refused", func(t *testing.T) {
		in := base()
		in.Prices[0].Value = big.NewInt(0)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)

		in = base()
		in.Prices[0].Value = nil
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)

		in = base()
		in.Prices[0].Value = big.NewInt(-1)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)
	})

	t.Run("negative balances are refused", func(t *testing.T) {
		in := base()
		in.Reserves[0].ScaledCollateral = big.NewInt(-1)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)

		in = base()
		in.Reserves[1].ScaledDebt = big.NewInt(-1)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)
	})

	t.Run("a negative liquidation threshold is refused", func(t *testing.T) {
		in := base()
		in.Params[0].LiqThreshold = big.NewInt(-1)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)
	})

	t.Run("a nonzero scaled balance with no index is refused", func(t *testing.T) {
		in := base()
		in.Reserves[0].CollateralIndex = nil
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingIndex)
		require.Contains(t, err.Error(), "liquidity index")

		in = base()
		in.Reserves[1].DebtIndex = big.NewInt(0)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingIndex)
		require.Contains(t, err.Error(), "variable borrow index")
	})

	t.Run("a nonzero eMode category is refused", func(t *testing.T) {
		in := base()
		in.EMode = 1
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrEModeUnsupported)
		require.Contains(t, err.Error(), "category 1")
	})
}

// TestAssetErrorShape covers the error wrapper's own surface.
func TestAssetErrorShape(t *testing.T) {
	e := &AssetError{Op: "op", Engine: AaveEngine, Asset: aWeETH, Wrapped: ErrMissingPrice}
	require.Contains(t, e.Error(), "op")
	require.Contains(t, e.Error(), aWeETH.Hex())
	require.NotContains(t, e.Error(), "(")
	require.ErrorIs(t, e, ErrMissingPrice)

	e.Detail = "why"
	require.Contains(t, e.Error(), "(why)")
}

// ---------------------------------------------------------------------------
// Collateral flags, purity of inputs.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthNonCollateralBalanceIsExcluded: an aToken balance whose
// isUsingAsCollateral bit is off contributes nothing to the collateral total,
// exactly as the protocol treats it — and needs no param row.
func TestComputeAaveHealthNonCollateralBalanceIsExcluded(t *testing.T) {
	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aFRAX, 8, "50000000", "0", false), // held but not pledged
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "100000000"),
			adapterPrice(aFRAX, "100000000"),
			adapterPrice(aUSDC, "100000000"),
		},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "20000000", h.TotalCollateralBase, "the unpledged aToken balance must not count")
	requireBig(t, "50000000", h.Reserves[1].LiveCollateral, "…but it is still reported")
	requireBig(t, "0", h.Reserves[1].CollateralBase)
	require.Nil(t, h.Reserves[1].LiquidationThresholdBps)

	// It also needs no price at all when it is not counted anywhere.
	in.Prices = []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")}
	h, err = ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "0", h.Reserves[1].CollateralBase)
}

// TestComputeAaveHealthDoesNotMutateInput guards against the classic *big.Int
// aliasing bug: a computed row must never share storage with its input.
func TestComputeAaveHealthDoesNotMutateInput(t *testing.T) {
	in := AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)

	h.TotalCollateralBase.SetInt64(1)
	h.WeightedLTSum.SetInt64(1)
	h.Reserves[0].LiquidationThresholdBps.SetInt64(1)
	h.Reserves[0].LiveCollateral.SetInt64(1)

	requireBig(t, "20000000", in.Reserves[0].ScaledCollateral)
	requireBig(t, "8100", in.Params[0].LiqThreshold)
	requireBig(t, "100000000", in.Prices[0].Value)

	h2, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "20000000", h2.TotalCollateralBase, "a second call must produce the same numbers")
}

// TestComputeAaveHealthReservesAreOrderStable: output order follows input
// order, so a serialized batch is deterministic.
func TestComputeAaveHealthReservesAreOrderStable(t *testing.T) {
	order := []common.Address{aFRAX, aWeETH, aPYUSD, aUSDC}
	in := AaveInput{Account: acctA}
	for _, a := range order {
		in.Reserves = append(in.Reserves, simpleReserve(a, 8, "0", "0", false))
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.Len(t, h.Reserves, 4)
	for i, a := range order {
		require.Equal(t, a, h.Reserves[i].Asset)
	}
}
