package main

// Reconstruction: the identity-index algebra, the round trip back through the
// pure library, and the mismatch guard that keeps a disagreement from ever
// reaching a served number.

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// fxServer is a server with the fixture's chain bindings and the committed
// scenario set, and NO database. Every pure test uses it.
func fxServer(t *testing.T) *server {
	t.Helper()
	scenarios, err := risk.LoadScenarios()
	require.NoError(t, err)
	byID := map[string]risk.Scenario{}
	for _, sc := range scenarios {
		byID[sc.ID] = sc
	}
	grid, ok := byID[defaultWaterfallScenario]
	require.True(t, ok)
	return &server{
		scenarios:         scenarios,
		byID:              byID,
		waterfallScenario: grid,
		cfg: serverConfig{
			Aave: riskfeed.EngineBinding{
				Engine: risk.AaveEngine, ChainID: fxETHChain,
				ParamEngine: risk.AaveParamEngine, PriceEngine: store.PollOwnedEnginePrefix + "1",
			},
			DM: riskfeed.EngineBinding{
				Engine: risk.DMEngine, ChainID: fxOPChain,
				ParamEngine: risk.DMEngine, PriceEngine: store.PollOwnedEnginePrefix + "10",
			},
			WaterfallScenario:  defaultWaterfallScenario,
			WaterfallGrid:      defaultWaterfallGrid(),
			PriceBudgetSeconds: fxPriceBudgetSecs,
			StepBps:            2000,
			RateLimit:          defaultRateLimit,
			RateBurst:          defaultRateBurst,
			SSEHeartbeat:       defaultSSEHeartbeat,
			SSEPoll:            defaultSSEPoll,
			ObservatoryLimit:   defaultObservatoryLimit,
		},
	}
}

// TestIdentityIndexReproducesLiveAmounts is the algebra the reconstruction rests
// on, pinned with concrete integers rather than an argument in a comment.
//
// A batch persists LIVE amounts and the index's as-of BLOCK, not the index value.
// Feeding the live amount back with an identity index (1 RAY) must reproduce it
// exactly, in both rounding directions:
//
//	AaveLiveDebt(x, RAY)       = rayMulCeil(x, RAY)  = ceil(x·RAY/RAY)  = x
//	AaveLiveCollateral(x, RAY) = rayMulFloor(x, RAY) = floor(x·RAY/RAY) = x
//
// The vectors deliberately include the on-chain ceiling-law outputs (137216, 84)
// and odd/prime values, because a broken implementation would be most likely to
// survive on round numbers.
func TestIdentityIndexReproducesLiveAmounts(t *testing.T) {
	ray := risk.RayUnit()
	for _, s := range []string{
		"0", "1", "2", "83", "84", "125415", "137216", "999999999999999999",
		"2000000000000000000", "6000000000", "115792089237316195423570985008687907853269984665640564039457",
	} {
		x := bi(s)
		require.Equal(t, x.String(), risk.AaveLiveDebt(x, ray, risk.RegimeB).String(),
			"the CEILING leg must reproduce %s exactly under an identity index", s)
		require.Equal(t, x.String(), risk.AaveLiveCollateral(x, ray, risk.RegimeB).String(),
			"the FLOOR leg must reproduce %s exactly under an identity index", s)
	}
	// The discriminator: a NON-identity index must NOT reproduce the input, or the
	// assertions above would hold for any index and prove nothing about RAY.
	two := new(big.Int).Mul(ray, big.NewInt(2))
	require.NotEqual(t, "1000", risk.AaveLiveCollateral(bi("1000"), two, risk.RegimeB).String())
}

// TestReconstructAaveReproducesThePersistedVerdict is the core honesty property:
// the position rebuilt from the batch's rows recomputes to the batch's own
// numbers, exactly.
//
// It ALSO pins the fixture's hand-derived health factor against the library. If
// the documented derivation in fixture_test.go is wrong, this fails — which is
// the point: the literal is the expectation and the library is the subject.
func TestReconstructAaveReproducesThePersistedVerdict(t *testing.T) {
	s := fxServer(t)
	p := fxAavePosition()

	in, err := s.reconstruct(p)
	require.NoError(t, err)
	require.Equal(t, risk.AaveEngine, in.Engine)
	require.NotNil(t, in.Aave)
	require.NoError(t, verifyReconstruction(p, in, fxParamWitness()))

	h, err := risk.ComputeAaveHealth(*in.Aave)
	require.NoError(t, err)
	require.Equal(t, fxAaveHFWad, h.HealthFactorWad.String(),
		"the hand-derived health factor 8000 x 0.81 / 6000 = 1.08 must be what the pool's law produces")
	require.Equal(t, fxAaveCollateralBase, h.TotalCollateralBase.String())
	require.Equal(t, fxAaveDebtBase, h.TotalDebtBase.String())
	require.Equal(t, fxAaveWeightedLTSum, h.WeightedLTSum.String())
	require.Equal(t, fxAaveAvgLTBps, h.AvgLiquidationThresholdBps.String())
	require.False(t, h.IsInfinite)
	require.True(t, h.StalePriceInputs, "the weETH input is past its budget, so the position must carry the stale flag")
}

func TestReconstructDMReproducesThePersistedVerdict(t *testing.T) {
	s := fxServer(t)
	p := fxDMPosition()

	in, err := s.reconstruct(p)
	require.NoError(t, err)
	require.NotNil(t, in.DM)
	require.NoError(t, verifyReconstruction(p, in, fxParamWitness()))

	h, err := risk.ComputeDMHealth(*in.DM)
	require.NoError(t, err)
	require.Equal(t, fxDMCollateralUSD, h.CollateralValueUSD.String())
	require.Equal(t, fxDMMaxBorrowLT, h.MaxBorrowLT.String(),
		"floor($4,000 x 80e18 / 100e18) = $3,200")
	require.Equal(t, fxDMBorrowings, h.Borrowings.String())
	require.True(t, h.Liquidatable, "$4,200 of debt against a $3,200 threshold is liquidatable, strictly")
}

// TestVerifyReconstructionRejectsEveryTamperedField is the discriminating negative
// for the guard: if the persisted row disagrees with the recomputation in ANY
// compared field, the position must be refused rather than served.
func TestVerifyReconstructionRejectsEveryTamperedField(t *testing.T) {
	s := fxServer(t)

	t.Run("aave", func(t *testing.T) {
		for name, tamper := range map[string]func(*positionRow){
			"health factor wad off by one": func(p *positionRow) {
				p.HFWad = new(big.Int).Add(p.HFWad, big.NewInt(1))
			},
			"total collateral base off by one": func(p *positionRow) {
				p.TotalCollateralBase = new(big.Int).Add(p.TotalCollateralBase, big.NewInt(1))
			},
			"total debt base off by one": func(p *positionRow) {
				p.TotalDebtBase = new(big.Int).Sub(p.TotalDebtBase, big.NewInt(1))
			},
			"weighted lt sum off by one": func(p *positionRow) {
				p.WeightedLTSum = new(big.Int).Add(p.WeightedLTSum, big.NewInt(1))
			},
			"infinite claimed over a real ratio": func(p *positionRow) {
				p.HFInfinite = true
			},
		} {
			t.Run(name, func(t *testing.T) {
				p := fxAavePosition()
				tamper(p)
				in, err := s.reconstruct(p)
				require.NoError(t, err, "reconstruction itself still succeeds; it is the VERIFICATION that must catch this")
				require.Error(t, verifyReconstruction(p, in, fxParamWitness()))
			})
		}
	})

	t.Run("debt manager", func(t *testing.T) {
		for name, tamper := range map[string]func(*positionRow){
			"liquidatable flipped": func(p *positionRow) { p.Liquidatable = boolp(false) },
			"collateral value off by one": func(p *positionRow) {
				p.CollateralValueUSD = new(big.Int).Add(p.CollateralValueUSD, big.NewInt(1))
			},
			"max borrow threshold off by one": func(p *positionRow) {
				p.MaxBorrowLT = new(big.Int).Sub(p.MaxBorrowLT, big.NewInt(1))
			},
			"liquidatable verdict absent": func(p *positionRow) { p.Liquidatable = nil },
		} {
			t.Run(name, func(t *testing.T) {
				p := fxDMPosition()
				tamper(p)
				in, err := s.reconstruct(p)
				require.NoError(t, err)
				require.Error(t, verifyReconstruction(p, in, fxParamWitness()))
			})
		}
	})
}

// TestReconstructAllRefusesRatherThanDropping pins the never-a-silent-hole rule
// at this layer: a position that cannot be rebuilt is marked, kept, and excluded
// from the book — not omitted.
func TestReconstructAllRefusesRatherThanDropping(t *testing.T) {
	s := fxServer(t)
	good := fxAavePosition()
	bad := fxAavePosition()
	bad.Account = fxAcctAaveRef.Bytes()
	bad.HFWad = new(big.Int).Add(bad.HFWad, big.NewInt(7))

	rows := []*positionRow{good, bad}
	s.reconstructAll(rows, fxParamWitness())

	require.NotNil(t, good.input)
	require.Empty(t, good.reconstructionErr)
	require.Nil(t, bad.input)
	require.NotEmpty(t, bad.reconstructionErr)

	b := book(rows)
	require.Len(t, b, 1, "only the position that reproduced its verdict may enter the book")

	// And the exclusion is REPORTED.
	cov := coverage(rows, len(b), nil)
	require.Equal(t, 2, cov.BatchPositions)
	require.Equal(t, 1, cov.InBook)
	require.Equal(t, 1, cov.ExcludedByThisLayer)
	require.False(t, cov.StressCoverageIsFull)
	require.Len(t, cov.Excluded, 1)
	require.Equal(t, refusalReconstruction, cov.Excluded[0].Code)
	require.Equal(t, fxAcctAaveRef.Hex(), cov.Excluded[0].Account)
}

// TestReconstructPricesUsesThePersistedVerdict pins that freshness is READ, not
// re-judged: the `Fresh` boolean comes off the persisted verdict, so a batch that
// disclosed a stale input keeps disclosing it.
func TestReconstructPricesUsesThePersistedVerdict(t *testing.T) {
	p := fxAavePosition()
	prices, err := reconstructPrices(p)
	require.NoError(t, err)
	require.Len(t, prices, 2)

	byAsset := map[string]risk.PriceInput{}
	for _, pr := range prices {
		byAsset[pr.Asset.Hex()] = pr
	}
	weeth := byAsset[fxWeETHEth.Hex()]
	require.Equal(t, fxAaveWeETHPrice, weeth.Value.String())
	require.Equal(t, uint8(8), weeth.Decimals)
	require.Equal(t, uint64(fxAavePriceBlock), weeth.Block)
	require.Equal(t, fxPriceBudgetSecs, weeth.BudgetSeconds)
	require.False(t, weeth.Fresh, "verdict `stale` must not be republished as fresh")
	require.Equal(t, risk.ProvenanceAdapterOutput, weeth.Provenance)

	usdc := byAsset[fxUSDCEth.Hex()]
	require.True(t, usdc.Fresh, "verdict `fresh` must survive the round trip; if everything came back false the assertion above would prove nothing")

	// A missing input carries no value and is DROPPED from the pure-library input —
	// the position that refused because of it is a refused row, so no computed
	// position can depend on it.
	refused := fxAaveRefused()
	none, err := reconstructPrices(refused)
	require.NoError(t, err)
	require.Empty(t, none)
	require.Equal(t, riskfeed.VerdictMissing, refused.Prices[0].Verdict)
}

// TestReconstructRefusesAValueWithNoDecimals pins the one malformed-row case that
// would otherwise scale a price by 10^0.
func TestReconstructRefusesAValueWithNoDecimals(t *testing.T) {
	p := fxAavePosition()
	p.Prices[0].Decimals = nil
	_, err := reconstructPrices(p)
	require.ErrorContains(t, err, "no decimals")
}

// TestHistogramBucketsOnEachEnginesOwnComparator pins the 1.0 edge and the
// engine-specific comparator choice.
func TestHistogramBucketsOnEachEnginesOwnComparator(t *testing.T) {
	s := fxServer(t)
	v := &batchView{
		Batch:      store.RiskBatch{Status: store.RiskBatchComplete},
		Aggregates: fxAggregates(),
		Positions:  fxPositions(),
	}
	h := s.histogram(v)
	require.Equal(t, risk.WadUnit().String(), h.WadScale)
	require.Len(t, h.Engines, 2)

	byEngine := map[string]wireEngineHistogram{}
	for _, e := range h.Engines {
		byEngine[e.Engine] = e
	}

	aave := byEngine[risk.AaveEngine]
	require.Equal(t, "hf_wad", aave.Comparator)
	require.Equal(t, 1, aave.RefusedCount)
	// HF 1.08 lands in [1.05, 1.10).
	require.Equal(t, 1, bucketCount(t, aave, "1.05 – 1.10"))
	require.Equal(t, 0, bucketCount(t, aave, "1.00 – 1.05"))
	require.Equal(t, 0, bucketCount(t, aave, "< 0.90"))

	dm := byEngine[risk.DMEngine]
	require.Equal(t, "hf_num/hf_den", dm.Comparator)
	require.Equal(t, 1, dm.RefusedCount)
	// 3200/4200 = 0.7619..., which is below 0.90.
	require.Equal(t, 1, bucketCount(t, dm, "< 0.90"))
	require.Equal(t, 0, bucketCount(t, dm, "0.90 – 1.00"))
	require.Contains(t, dm.Note, "strict boolean")
}

func bucketCount(t *testing.T, e wireEngineHistogram, label string) int {
	t.Helper()
	for _, b := range e.Buckets {
		if b.Label == label {
			return b.Count
		}
	}
	t.Fatalf("no bucket labelled %q", label)
	return 0
}

// TestBucketIndexHonoursTheStrictOneEdge is the boundary discriminator: exactly
// 1e18 is HEALTHY on Aave, so it must not fall in the `< 1.00` bucket.
func TestBucketIndexHonoursTheStrictOneEdge(t *testing.T) {
	just := &positionRow{Engine: risk.AaveEngine, HFWad: bi("999999999999999999")}
	exactly := &positionRow{Engine: risk.AaveEngine, HFWad: bi("1000000000000000000")}
	require.Equal(t, "0.90 – 1.00", histogramEdges[bucketIndex(just)].label)
	require.Equal(t, "1.00 – 1.05", histogramEdges[bucketIndex(exactly)].label)
}
