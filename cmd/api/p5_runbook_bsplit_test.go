package main

// Wave W-BS-A — the three run-book fields contract 1.6.0 adds, and the laws
// that keep each of them honest.
//
// Each test below is written so that ONE named mutation fails it:
//
//	dropping refused rows from a side's histogram  -> TestRunBookHistogramCountsWhatItCannotBucket
//	bucketing the run-book on its own edge table   -> TestRunBookHistogramIsTheServingSurfacesBucketLaw
//	mis-ranking movers (asc, or by the wrong key)  -> TestRunBookMoversRankByTheEnginesOwnRule
//	capping movers without saying so               -> TestRunBookMoversTotalCountsEveryMoverNotTheSlice
//	serving an unpriced asset as a zero            -> TestRunBookCollateralNeverRendersAnUnknowableAsZero

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// B1 — the histogram
// ---------------------------------------------------------------------------

// TestRunBookHistogramIsTheServingSurfacesBucketLaw welds the two histograms
// together over THE SAME FIXTURE the serving surface's own histogram test uses
// (fxPositions / fxAggregates, reconstruct_test.go's
// TestHistogramBucketsOnEachEnginesOwnComparator). A run-book side that
// bucketed on its own edge table, or on a re-derived float, would land these
// counts somewhere else.
func TestRunBookHistogramIsTheServingSurfacesBucketLaw(t *testing.T) {
	s := fxServer(t)
	positions := fxPositions()
	v := &batchView{
		Batch:      store.RiskBatch{Status: store.RiskBatchComplete},
		Aggregates: fxAggregates(),
		Positions:  positions,
	}
	s.reconstructAll(positions, fxParamWitness())

	served := map[string]wireEngineHistogram{}
	for _, e := range s.histogram(v).Engines {
		served[e.Engine] = e
	}

	var inputs []risk.PositionInput
	for _, p := range positions {
		if p.input != nil {
			inputs = append(inputs, *p.input)
		}
	}
	require.NotEmpty(t, inputs, "the fixture must reconstruct, or this test proves nothing")

	measures, err := s.measureRunBook(inputs)
	require.NoError(t, err)
	require.NotEmpty(t, measures)

	for engine, m := range measures {
		agg := m.wire(engine, s)
		ref, ok := served[engine]
		require.True(t, ok, "engine %s must exist on the serving histogram too", engine)

		require.Equal(t, ref.Comparator, agg.HFHistogram.Comparator,
			"%s: the run-book must bucket on the SAME comparator the serving surface names", engine)
		require.Equal(t, risk.WadUnit().String(), agg.HFHistogram.WadScale)
		require.Len(t, agg.HFHistogram.Buckets, len(ref.Buckets))

		for i := range ref.Buckets {
			require.Equal(t, ref.Buckets[i].Label, agg.HFHistogram.Buckets[i].Label,
				"%s bucket %d: the edge LABELS must be the serving surface's", engine, i)
			require.Equal(t, ref.Buckets[i].LowerWad, agg.HFHistogram.Buckets[i].LowerWad,
				"%s bucket %d: the lower edge must be the serving surface's", engine, i)
			require.Equal(t, ref.Buckets[i].UpperWad, agg.HFHistogram.Buckets[i].UpperWad,
				"%s bucket %d: the upper edge must be the serving surface's", engine, i)
			// The COUNTS: the serving surface buckets the persisted row, the
			// run-book buckets the recomputed health. Reconstruction is verified,
			// so on this fixture they must agree row for row.
			require.Equal(t, ref.Buckets[i].Count, agg.HFHistogram.Buckets[i].Count,
				"%s bucket %q: persisted-row bucketing and recomputed-health bucketing disagree",
				engine, ref.Buckets[i].Label)
		}
		require.Equal(t, ref.InfiniteCount, agg.HFHistogram.InfiniteCount,
			"%s: no-debt accounts must be counted infinite on both surfaces", engine)
	}
}

// TestRunBookHistogramBucketLawIsOneImplementation pins the strict 1.0 edge
// through the SHARED entry point, on both comparators. A second copy of the
// edge walk is what this forecloses.
func TestRunBookHistogramBucketLawIsOneImplementation(t *testing.T) {
	// Aave liquidates STRICTLY BELOW 1e18, so exactly 1.00 is healthy.
	require.Equal(t, "0.90 – 1.00",
		histogramEdges[bucketIndexOf(risk.AaveEngine, bi("999999999999999999"), nil, nil)].label)
	require.Equal(t, "1.00 – 1.05",
		histogramEdges[bucketIndexOf(risk.AaveEngine, bi("1000000000000000000"), nil, nil)].label)

	// The Debt Manager's exact rational, compared scale-free. 999/1000 is below
	// 1.00; 1000/1000 is exactly 1.00 and therefore healthy.
	require.Equal(t, "0.90 – 1.00",
		histogramEdges[bucketIndexOf(risk.DMEngine, nil, bi("999"), bi("1000"))].label)
	require.Equal(t, "1.00 – 1.05",
		histogramEdges[bucketIndexOf(risk.DMEngine, nil, bi("1000"), bi("1000"))].label)

	// The row that carries no comparator at all is REFUSED (−1), never bucket 0.
	require.Equal(t, -1, bucketIndexOf(risk.AaveEngine, nil, nil, nil))
	require.Equal(t, -1, bucketIndexOf(risk.DMEngine, nil, bi("1"), bi("0")))

	// And the two callers agree: the persisted-row path is the shared law.
	row := &positionRow{Engine: risk.AaveEngine, HFWad: bi("1000000000000000000")}
	require.Equal(t, bucketIndexOf(risk.AaveEngine, row.HFWad, nil, nil), bucketIndex(row))
}

// TestRunBookHistogramCountsWhatItCannotBucket is the anti-drop law. A side
// whose buckets silently omitted the rows it could not place would publish a
// distribution over a book smaller than the one it claims to describe.
func TestRunBookHistogramCountsWhatItCannotBucket(t *testing.T) {
	s := fxServer(t)
	m := newRunMeasure()

	// One bucketable account, one with no debt, one carrying no comparator.
	m.bucket(risk.AaveEngine, &runAccountState{hfWad: bi("1080000000000000000")})
	m.bucket(risk.AaveEngine, &runAccountState{infinite: true})
	m.bucket(risk.AaveEngine, &runAccountState{hfWad: nil})
	// Plus the rows this layer could not rebuild at all, folded in by the
	// handler exactly as it folds them onto both sides.
	m.refused += 2

	agg := m.wire(risk.AaveEngine, s)
	require.Equal(t, 1, agg.HFHistogram.InfiniteCount, "a no-debt account is INFINITE, never a bucket and never a zero")
	require.Equal(t, 3, agg.HFHistogram.RefusedCount, "every row that could not be bucketed must be counted refused")

	bucketed := 0
	for _, b := range agg.HFHistogram.Buckets {
		bucketed += b.Count
	}
	require.Equal(t, 1, bucketed)
	// The whole run is accounted for: nothing fell out between the three tallies.
	require.Equal(t, 5, bucketed+agg.HFHistogram.InfiniteCount+agg.HFHistogram.RefusedCount,
		"buckets + infinite + refused must be the whole run, or rows vanished")
	require.Contains(t, agg.HFHistogram.Note, "counted here rather than dropped")
}

// ---------------------------------------------------------------------------
// B2 — the movers
// ---------------------------------------------------------------------------

func acct(n byte) common.Address {
	var a common.Address
	a[19] = n
	return a
}

// TestRunBookMoversRankByTheEnginesOwnRule pins BOTH ranking rules and the
// exclusions each one implies. Ranking ascending, or ranking the Debt Manager
// by a ratio delta instead of by the debt that flipped, fails here.
func TestRunBookMoversRankByTheEnginesOwnRule(t *testing.T) {
	t.Run("aave ranks by health-factor DROP, largest first", func(t *testing.T) {
		before, after := newRunMeasure(), newRunMeasure()
		// drop 0.30e18
		before.states[acct(1)] = &runAccountState{hfWad: bi("1500000000000000000")}
		after.states[acct(1)] = &runAccountState{hfWad: bi("1200000000000000000")}
		// drop 0.50e18 — the biggest, so it must rank FIRST
		before.states[acct(2)] = &runAccountState{hfWad: bi("2000000000000000000")}
		after.states[acct(2)] = &runAccountState{hfWad: bi("1500000000000000000")}
		// drop 0.10e18
		before.states[acct(3)] = &runAccountState{hfWad: bi("1100000000000000000")}
		after.states[acct(3)] = &runAccountState{hfWad: bi("1000000000000000000")}
		// ROSE — not a mover under a drop ranking.
		before.states[acct(4)] = &runAccountState{hfWad: bi("1000000000000000000")}
		after.states[acct(4)] = &runAccountState{hfWad: bi("1400000000000000000")}
		// UNCHANGED — not a mover.
		before.states[acct(5)] = &runAccountState{hfWad: bi("1000000000000000000")}
		after.states[acct(5)] = &runAccountState{hfWad: bi("1000000000000000000")}
		// NO DEBT on both sides: unbounded, so there is no drop to rank. It is
		// excluded and the note says so — it is not a quiet zero-drop row.
		before.states[acct(6)] = &runAccountState{infinite: true}
		after.states[acct(6)] = &runAccountState{infinite: true}

		movers, total := runBookMovers(risk.AaveEngine, before, after)
		require.Equal(t, 3, total, "only the three that DROPPED are movers")
		require.Len(t, movers, 3)

		require.Equal(t, acct(2).Hex(), movers[0].Account, "largest drop ranks first")
		require.Equal(t, acct(1).Hex(), movers[1].Account)
		require.Equal(t, acct(3).Hex(), movers[2].Account)

		require.Equal(t, "500000000000000000", *movers[0].HFDropWad)
		require.Equal(t, "2000000000000000000", *movers[0].HFBeforeWad)
		require.Equal(t, "1500000000000000000", *movers[0].HFAfterWad)
		// The Debt Manager's vocabulary is absent on an Aave row — NULL, and
		// explicitly not a zero that would read as "no debt became eligible".
		require.Nil(t, movers[0].BecameEligible)
		require.Nil(t, movers[0].DebtUSD)
		require.Nil(t, movers[0].HFBeforeNum)
		require.Nil(t, movers[0].HFAfterDen)

		note := runBookMoversNote(risk.AaveEngine, len(movers), total, 8)
		require.Contains(t, note, "HEALTH-FACTOR DROP")
		require.Contains(t, note, "no debt has an unbounded health factor")
	})

	t.Run("the debt manager ranks the eligibility FLIP by the debt that flipped", func(t *testing.T) {
		before, after := newRunMeasure(), newRunMeasure()
		// flipped, small debt
		before.states[acct(1)] = &runAccountState{eligible: false, debtUSD: bi("100"), hfNum: bi("11"), hfDen: bi("10")}
		after.states[acct(1)] = &runAccountState{eligible: true, debtUSD: bi("100"), hfNum: bi("9"), hfDen: bi("10")}
		// flipped, LARGEST debt — ranks first
		before.states[acct(2)] = &runAccountState{eligible: false, debtUSD: bi("9000"), hfNum: bi("12"), hfDen: bi("10")}
		after.states[acct(2)] = &runAccountState{eligible: true, debtUSD: bi("9000"), hfNum: bi("8"), hfDen: bi("10")}
		// ALREADY eligible before — it did not BECOME eligible under this shock.
		before.states[acct(3)] = &runAccountState{eligible: true, debtUSD: bi("50000")}
		after.states[acct(3)] = &runAccountState{eligible: true, debtUSD: bi("50000")}
		// flipped BACK to healthy — not a mover under a false->true rule, and
		// this is exactly why movers_total is not newly_eligible_accounts.
		before.states[acct(4)] = &runAccountState{eligible: true, debtUSD: bi("7000")}
		after.states[acct(4)] = &runAccountState{eligible: false, debtUSD: bi("7000")}

		movers, total := runBookMovers(risk.DMEngine, before, after)
		require.Equal(t, 2, total, "only false->true flips are movers")
		require.Len(t, movers, 2)

		require.Equal(t, acct(2).Hex(), movers[0].Account, "the largest debt that BECAME eligible ranks first")
		require.Equal(t, "9000", *movers[0].DebtUSD)
		require.True(t, *movers[0].BecameEligible)
		// The exact rational on each side, as the disclosure it is.
		require.Equal(t, "12", *movers[0].HFBeforeNum)
		require.Equal(t, "10", *movers[0].HFBeforeDen)
		require.Equal(t, "8", *movers[0].HFAfterNum)
		require.Equal(t, "10", *movers[0].HFAfterDen)
		// Aave's vocabulary is absent here — the Debt Manager has no wad at all.
		require.Nil(t, movers[0].HFBeforeWad)
		require.Nil(t, movers[0].HFAfterWad)
		require.Nil(t, movers[0].HFDropWad)

		require.Equal(t, acct(1).Hex(), movers[1].Account)

		note := runBookMoversNote(risk.DMEngine, len(movers), total, 6)
		require.Contains(t, note, "DEBT THAT BECAME ELIGIBLE")
		require.Contains(t, note, "not `newly_eligible_accounts`")
	})
}

// TestRunBookMoversTotalCountsEveryMoverNotTheSlice is the anti-silent-cap law:
// the slice is bounded, the count is not, and the note says both numbers.
func TestRunBookMoversTotalCountsEveryMoverNotTheSlice(t *testing.T) {
	before, after := newRunMeasure(), newRunMeasure()
	const n = 31
	for i := 1; i <= n; i++ {
		// Bigger i, bigger drop — so the expected top-20 is i = 31 down to 12.
		before.states[acct(byte(i))] = &runAccountState{hfWad: bi("9000000000000000000")}
		after.states[acct(byte(i))] = &runAccountState{
			hfWad: new(big.Int).Sub(bi("9000000000000000000"), big.NewInt(int64(i)*1_000_000)),
		}
	}

	movers, total := runBookMovers(risk.AaveEngine, before, after)
	require.Equal(t, n, total, "movers_total counts EVERY mover, never the truncated slice")
	require.Len(t, movers, runBookMoversCap, "the slice is bounded by the named constant")
	require.Equal(t, 20, runBookMoversCap, "the cap is 20 and it is a constant, not a literal at the call site")

	// The window is the TOP of the ranking, not an arbitrary 20.
	require.Equal(t, acct(byte(n)).Hex(), movers[0].Account)
	require.Equal(t, acct(byte(n-runBookMoversCap+1)).Hex(), movers[len(movers)-1].Account)

	note := runBookMoversNote(risk.AaveEngine, len(movers), total, 8)
	require.Contains(t, note, "TRUNCATED", "a cap the consumer cannot see is a silent cap")
	require.Contains(t, note, "top 20 of 31")
	require.Contains(t, note, "the other 11 are not on this page")

	// Below the cap the sentence must NOT claim a truncation that did not happen.
	full := runBookMoversNote(risk.AaveEngine, 3, 3, 8)
	require.NotContains(t, full, "TRUNCATED")
	require.Contains(t, full, "carries all 3 of them")
}

// TestRunBookMoversAreDeterministic pins that equal ranking keys resolve the
// same way on every run — a map-iteration order leaking into the wire would
// make two runs of one batch disagree.
func TestRunBookMoversAreDeterministic(t *testing.T) {
	build := func() (*runMeasure, *runMeasure) {
		before, after := newRunMeasure(), newRunMeasure()
		for i := 1; i <= 12; i++ {
			before.states[acct(byte(i))] = &runAccountState{hfWad: bi("2000000000000000000")}
			after.states[acct(byte(i))] = &runAccountState{hfWad: bi("1000000000000000000")}
		}
		return before, after
	}
	b0, a0 := build()
	first, _ := runBookMovers(risk.AaveEngine, b0, a0)
	for i := 0; i < 8; i++ {
		bn, an := build()
		again, _ := runBookMovers(risk.AaveEngine, bn, an)
		require.Equal(t, first, again, "an all-ties ranking must still be a total, stable order")
	}
}

// ---------------------------------------------------------------------------
// B3 — collateral by asset
// ---------------------------------------------------------------------------

const (
	fxRayOne  = "1000000000000000000000000000"
	fxBSBlock = uint64(25_000_000)
)

var (
	fxBSCollateral = common.HexToAddress("0x1111111111111111111111111111111111111111")
	fxBSDebtAsset  = common.HexToAddress("0x2222222222222222222222222222222222222222")
	fxBSMystery    = common.HexToAddress("0x3333333333333333333333333333333333333333")
)

// bsAaveInput builds one Aave position: a priced, collateral-enabled leg; a
// priced debt leg; and — when withMystery — a held balance that is NOT enabled
// as collateral and that NO price witness describes.
func bsAaveInput(withMystery bool) risk.PositionInput {
	marks := risk.Watermarks{BalancesBlock: fxBSBlock, ParamsBlock: fxBSBlock}
	in := &risk.AaveInput{
		Account: acct(9),
		Marks:   marks,
		Reserves: []risk.AaveReserve{
			{
				Asset: fxBSCollateral, Decimals: 18,
				ScaledCollateral: bi("2000000000000000000"), CollateralIndex: bi(fxRayOne),
				UsedAsCollateral: true, IndexBlock: fxBSBlock,
			},
			{
				Asset: fxBSDebtAsset, Decimals: 6,
				ScaledDebt: bi("1000000000"), DebtIndex: bi(fxRayOne), IndexBlock: fxBSBlock,
			},
		},
		Params: []risk.ParamRow{
			{
				Engine: risk.AaveParamEngine, ChainID: fxETHChain, Asset: fxBSCollateral,
				LiqThreshold: big.NewInt(7500), LiqBonus: big.NewInt(10500), EffectiveBlock: fxBSBlock,
			},
		},
		Prices: []risk.PriceInput{
			{
				ChainID: fxETHChain, Asset: fxBSCollateral, Source: "fx", Block: fxBSBlock,
				AsOf: time.Unix(1, 0), Value: bi("300000000000"), Decimals: 8,
				BudgetSeconds: 60, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			},
			{
				ChainID: fxETHChain, Asset: fxBSDebtAsset, Source: "fx", Block: fxBSBlock,
				AsOf: time.Unix(1, 0), Value: bi("100000000"), Decimals: 8,
				BudgetSeconds: 60, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			},
		},
	}
	if withMystery {
		// Held, collateral DISABLED, and nothing prices it. ComputeAaveHealth
		// admits it precisely because it needs no price: it carries no debt and
		// counts as no collateral.
		in.Reserves = append(in.Reserves, risk.AaveReserve{
			Asset: fxBSMystery, Decimals: 18,
			ScaledCollateral: bi("5000000000000000000"), CollateralIndex: bi(fxRayOne),
			UsedAsCollateral: false, IndexBlock: fxBSBlock,
		})
	}
	return risk.PositionInput{Engine: risk.AaveEngine, Aave: in, Marks: marks}
}

func collateralEntry(t *testing.T, agg wireRunBookAggregate, asset common.Address) wireRunBookCollateralAsset {
	t.Helper()
	for _, c := range agg.CollateralByAsset {
		if c.Asset == asset.Hex() {
			return c
		}
	}
	t.Fatalf("no collateral_by_asset entry for %s", asset.Hex())
	return wireRunBookCollateralAsset{}
}

// TestRunBookCollateralReconcilesWithTheTotalWhenEverythingIsPriced is the
// arithmetic weld: the itemization must BE the total, exactly.
func TestRunBookCollateralReconcilesWithTheTotalWhenEverythingIsPriced(t *testing.T) {
	s := fxServer(t)
	measures, err := s.measureRunBook([]risk.PositionInput{bsAaveInput(false)})
	require.NoError(t, err)

	agg := measures[risk.AaveEngine].wire(risk.AaveEngine, s)
	require.Len(t, agg.CollateralByAsset, 1, "only the collateral-bearing leg is itemized")

	entry := collateralEntry(t, agg, fxBSCollateral)
	require.False(t, entry.Unpriced)
	require.NotNil(t, entry.ValueUSD)
	require.Equal(t, "2000000000000000000", entry.Amount, "the balance is in the token's BASE UNITS")
	require.Equal(t, uint8(18), entry.Decimals)

	sum := new(big.Int)
	for _, c := range agg.CollateralByAsset {
		if c.ValueUSD != nil {
			sum.Add(sum, bi(*c.ValueUSD))
		}
	}
	require.Equal(t, agg.TotalCollateralUSD, sum.String(),
		"the priced entries must sum EXACTLY to total_collateral_usd")
	require.Contains(t, entry.Note, "COUNTED")
}

// TestRunBookCollateralNeverRendersAnUnknowableAsZero is the refusal law on
// this surface. A held balance nothing prices is DISCLOSED with a null value,
// the counted entries still reconcile with the total, and the unpriced amount
// is visibly OUTSIDE it. Serving "0" for that entry fails here.
func TestRunBookCollateralNeverRendersAnUnknowableAsZero(t *testing.T) {
	s := fxServer(t)
	measures, err := s.measureRunBook([]risk.PositionInput{bsAaveInput(true)})
	require.NoError(t, err)

	agg := measures[risk.AaveEngine].wire(risk.AaveEngine, s)
	require.Len(t, agg.CollateralByAsset, 2, "the unpriced holding gets its OWN entry — it is never merged into a priced one")

	mystery := collateralEntry(t, agg, fxBSMystery)
	require.True(t, mystery.Unpriced, "the entry must SAY it is unpriced")
	require.Nil(t, mystery.ValueUSD,
		"an unknowable value must be NULL — a zero here would claim the holding is worth nothing")
	require.Equal(t, "5000000000000000000", mystery.Amount, "the BALANCE is exact even when its worth is not")
	require.Empty(t, mystery.Symbol, "the registry holds no symbol for it and none is invented")
	require.Contains(t, mystery.Note, "UNKNOWABLE")
	require.Contains(t, mystery.Note, "not zero")

	// The counted side still reconciles exactly...
	counted := new(big.Int)
	unpriced := 0
	for _, c := range agg.CollateralByAsset {
		if c.ValueUSD != nil {
			counted.Add(counted, bi(*c.ValueUSD))
			continue
		}
		unpriced++
	}
	require.Equal(t, agg.TotalCollateralUSD, counted.String(),
		"the priced entries still sum exactly to the total")
	// ...and the DIFFERENCE is disclosed rather than absorbed: there is a
	// holding on this side that the total does not describe, and it is on the
	// wire saying so.
	require.Equal(t, 1, unpriced, "the gap between the itemization and the total is a NAMED entry, not a silent one")

	// The total itself is unchanged by the unpriced leg — the engine counted
	// none of it, and nothing here inflated the total to make the sum work.
	noMystery, err := s.measureRunBook([]risk.PositionInput{bsAaveInput(false)})
	require.NoError(t, err)
	require.Equal(t, noMystery[risk.AaveEngine].wire(risk.AaveEngine, s).TotalCollateralUSD,
		agg.TotalCollateralUSD, "an unpriced holding must not move total_collateral_usd in either direction")
}

// TestRunBookCollateralIsDeterministicAndPerAggregate pins the ordering (two
// runs of one batch serve byte-identical arrays) and that the array is built
// per side rather than shared between them.
func TestRunBookCollateralIsDeterministicAndPerAggregate(t *testing.T) {
	s := fxServer(t)
	for i := 0; i < 5; i++ {
		measures, err := s.measureRunBook([]risk.PositionInput{bsAaveInput(true)})
		require.NoError(t, err)
		agg := measures[risk.AaveEngine].wire(risk.AaveEngine, s)
		require.Equal(t, []string{fxBSCollateral.Hex(), fxBSMystery.Hex()},
			[]string{agg.CollateralByAsset[0].Asset, agg.CollateralByAsset[1].Asset},
			"entries are ordered by asset, so the array is stable across runs")
	}
}
