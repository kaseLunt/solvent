package store

// P5 Task B1 live-db tests for PriceSeries: full-history reads including
// invalid rows, exact downsampling, THE VALIDITY-BOUNDARY SPLIT (the wave's
// second named mutant), quarantined-range summarization, per-source
// separation, and the decimals-change split.
//
// Rows are written through ApplyPrices, the production writer: a
// non-positive observation is RECORDED with valid=false and the migration
// 00005 reason — exactly the shape the live table carries — so the series
// under test is the real storage shape, not hand-inserted rows.

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	p5PriceEngine = "prices:chainlink_feed:1"
	p5PriceSource = "chainlink:0x00000000000000000000000000000000000000d1"
)

var p5PriceAsset = addr20(0xD7)

// seedP5Prices writes blocks 100..109 for one source: rising 100..104,
// INVALID at 105-106 (non-positive answers), recovering 107..109.
func seedP5Prices(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	var obs []PriceObservation
	price := func(block uint64, v int64) PriceObservation {
		return PriceObservation{Asset: p5PriceAsset, Source: p5PriceSource,
			Price: big.NewInt(v), Decimals: 8, BlockNumber: block}
	}
	obs = append(obs,
		price(100, 1000), price(101, 1010), price(102, 1020), price(103, 1030),
		price(104, 1040),
		price(105, 0),  // recorded, valid=false
		price(106, -5), // recorded, valid=false
		price(107, 1070), price(108, 1080), price(109, 1090),
	)
	_, err := s.ApplyPrices(ctx, p5PriceEngine, 1, obs, 109)
	require.NoError(t, err)
}

func TestPriceSeriesRawIncludesInvalidRows(t *testing.T) {
	s := testB1Store(t)
	seedP5Prices(t, s)

	res, err := s.PriceSeries(context.Background(), PriceSeriesQuery{
		ChainID: 1, Asset: p5PriceAsset, Source: p5PriceSource})
	require.NoError(t, err)
	require.Len(t, res.Points, 10, "full history INCLUDING the invalid rows")
	require.Empty(t, res.Buckets)

	byBlock := map[uint64]PricePoint{}
	for _, p := range res.Points {
		byBlock[p.BlockNumber] = p
	}
	require.True(t, byBlock[104].Valid)
	require.Equal(t, "1040", byBlock[104].Price.String())
	require.Equal(t, p5PriceEngine, byBlock[104].OwnerEngine)
	// The invalid rows are FACTS: recorded price, valid=false, the 00005
	// reason — never dropped, never smoothed.
	require.False(t, byBlock[105].Valid)
	require.Equal(t, "0", byBlock[105].Price.String())
	require.Equal(t, invalidReasonNonPositive, byBlock[105].InvalidReason)
	require.False(t, byBlock[106].Valid)
	// This writer path custodies no chain as-of; nil stays nil (never
	// substituted with observed_at).
	require.Nil(t, byBlock[104].SourceAsOf)
	require.False(t, byBlock[104].ObservedAt.IsZero())
}

// THE VALIDITY-BOUNDARY LAW (named mutant M2): with step=4 anchored at 100,
// the bucket [104..107] contains valid(104), invalid(105,106), valid(107) —
// it MUST emit three runs. A downsampler that merged them would fold
// quarantined values into a trusted min/max/sum, the exact smoothing the
// spec forbids.
func TestPriceSeriesDownsamplingNeverCrossesValidityBoundary(t *testing.T) {
	s := testB1Store(t)
	seedP5Prices(t, s)

	from := uint64(100)
	res, err := s.PriceSeries(context.Background(), PriceSeriesQuery{
		ChainID: 1, Asset: p5PriceAsset, Source: p5PriceSource, FromBlock: &from, Step: 4})
	require.NoError(t, err)
	require.Empty(t, res.Points)
	require.Len(t, res.Buckets, 5)

	// Bucket [100..103]: one clean valid run, exact aggregates.
	b0 := res.Buckets[0]
	require.True(t, b0.Valid)
	require.EqualValues(t, 100, b0.FromBlock)
	require.EqualValues(t, 103, b0.ToBlock)
	require.EqualValues(t, 4, b0.Rows)
	require.Equal(t, "1000", b0.Open.String())
	require.Equal(t, "1030", b0.Close.String())
	require.Equal(t, "1000", b0.Min.String())
	require.Equal(t, "1030", b0.Max.String())
	require.Equal(t, "4060", b0.Sum.String())

	// Bucket [104..107] SPLITS at both validity flips.
	b1, b2, b3 := res.Buckets[1], res.Buckets[2], res.Buckets[3]
	require.True(t, b1.Valid)
	require.EqualValues(t, 104, b1.FromBlock)
	require.EqualValues(t, 104, b1.ToBlock)
	require.Equal(t, "1040", b1.Sum.String())

	require.False(t, b2.Valid)
	require.EqualValues(t, 105, b2.FromBlock)
	require.EqualValues(t, 106, b2.ToBlock)
	require.EqualValues(t, 2, b2.Rows)
	// An invalid run summarizes; it never serves price aggregates.
	require.Nil(t, b2.Open)
	require.Nil(t, b2.Min)
	require.Nil(t, b2.Max)
	require.Nil(t, b2.Sum)
	require.Equal(t, []string{invalidReasonNonPositive}, b2.InvalidReasons)

	require.True(t, b3.Valid)
	require.EqualValues(t, 107, b3.FromBlock)
	require.EqualValues(t, 107, b3.ToBlock)
	require.Equal(t, "1070", b3.Sum.String())

	// Bucket [108..111]: the two remaining rows.
	b4 := res.Buckets[4]
	require.True(t, b4.Valid)
	require.EqualValues(t, 108, b4.FromBlock)
	require.EqualValues(t, 109, b4.ToBlock)
	require.Equal(t, "2170", b4.Sum.String())
}

func TestPriceSeriesQuarantinedRangeSummaries(t *testing.T) {
	s := testB1Store(t)
	seedP5Prices(t, s)

	// Quarantine summaries are computed in BOTH modes.
	for _, step := range []uint64{0, 4} {
		res, err := s.PriceSeries(context.Background(), PriceSeriesQuery{
			ChainID: 1, Asset: p5PriceAsset, Source: p5PriceSource, Step: step})
		require.NoError(t, err)
		require.Len(t, res.Quarantined, 1, "step=%d", step)
		qr := res.Quarantined[0]
		require.Equal(t, p5PriceSource, qr.Source)
		require.EqualValues(t, 105, qr.FromBlock)
		require.EqualValues(t, 106, qr.ToBlock)
		require.EqualValues(t, 2, qr.Rows)
		require.Equal(t, []string{invalidReasonNonPositive}, qr.Reasons)
	}
}

func TestPriceSeriesRangeFilterAndValidation(t *testing.T) {
	s := testB1Store(t)
	seedP5Prices(t, s)
	ctx := context.Background()

	from, to := uint64(103), uint64(105)
	res, err := s.PriceSeries(ctx, PriceSeriesQuery{
		ChainID: 1, Asset: p5PriceAsset, Source: p5PriceSource, FromBlock: &from, ToBlock: &to})
	require.NoError(t, err)
	require.Len(t, res.Points, 3)
	require.EqualValues(t, 103, res.Points[0].BlockNumber)
	require.EqualValues(t, 105, res.Points[2].BlockNumber)
	// A quarantined range clipped by the window reports what the window saw.
	require.Len(t, res.Quarantined, 1)
	require.EqualValues(t, 105, res.Quarantined[0].FromBlock)
	require.EqualValues(t, 105, res.Quarantined[0].ToBlock)

	_, err = s.PriceSeries(ctx, PriceSeriesQuery{ChainID: 1})
	require.ErrorContains(t, err, "asset is required")
}

// Sources are separate series: same asset, second source, its rows must
// bucket alone (never merged into another source's aggregates).
func TestPriceSeriesSourcesNeverMerge(t *testing.T) {
	s := testB1Store(t)
	seedP5Prices(t, s)
	ctx := context.Background()

	const source2 = "chainlink:0x00000000000000000000000000000000000000d2"
	_, err := s.ApplyPrices(ctx, "prices:chainlink_feed2:1", 1, []PriceObservation{
		{Asset: p5PriceAsset, Source: source2, Price: big.NewInt(5000), Decimals: 8, BlockNumber: 101},
		{Asset: p5PriceAsset, Source: source2, Price: big.NewInt(5100), Decimals: 8, BlockNumber: 102},
	}, 102)
	require.NoError(t, err)

	from := uint64(100)
	res, err := s.PriceSeries(ctx, PriceSeriesQuery{ChainID: 1, Asset: p5PriceAsset, FromBlock: &from, Step: 100})
	require.NoError(t, err)
	// One giant bucket per source per validity run: source1 → 3 runs
	// (valid, invalid, valid), source2 → 1 run.
	require.Len(t, res.Buckets, 4)
	require.Equal(t, p5PriceSource, res.Buckets[0].Source)
	require.Equal(t, source2, res.Buckets[3].Source)
	require.Equal(t, "10100", res.Buckets[3].Sum.String())
	require.EqualValues(t, 2, res.Buckets[3].Rows)
}

// A decimals change is a scale boundary: aggregating across it would be a
// silent 10^k error, so the run splits exactly as at a validity flip.
func TestPriceSeriesDecimalsChangeSplitsRun(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()
	_, err := s.ApplyPrices(ctx, p5PriceEngine, 1, []PriceObservation{
		{Asset: p5PriceAsset, Source: p5PriceSource, Price: big.NewInt(1000), Decimals: 8, BlockNumber: 200},
		{Asset: p5PriceAsset, Source: p5PriceSource, Price: big.NewInt(10000000000000), Decimals: 18, BlockNumber: 201},
	}, 201)
	require.NoError(t, err)

	from := uint64(200)
	res, err := s.PriceSeries(ctx, PriceSeriesQuery{
		ChainID: 1, Asset: p5PriceAsset, Source: p5PriceSource, FromBlock: &from, Step: 10})
	require.NoError(t, err)
	require.Len(t, res.Buckets, 2)
	require.EqualValues(t, 8, res.Buckets[0].Decimals)
	require.EqualValues(t, 18, res.Buckets[1].Decimals)
}
