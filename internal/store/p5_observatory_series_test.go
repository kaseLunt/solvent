package store

// P5 Task B1 live-db tests for ObservatorySeries — the READ side of Task
// B2's observatory_points rollup. Points are produced through B2's own
// writer (WriteObservatoryPoints observing a real complete batch), so the
// reader is tested against rows shaped exactly as production writes them.
//
// The ErrObservatoryUnavailable path (table absent) is structurally
// untestable here without dropping a migrated table out from under the
// sibling wave's tests, which share this scratch database; the guard is a
// three-line to_regclass check exercised on any pre-00016 database. Stated
// rather than hidden.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// seedObservatory writes one complete batch and rolls it up into the given
// bucket via the production writer, returning the batch id.
func seedObservatory(t *testing.T, s *Store, bucket time.Time) int64 {
	t.Helper()
	ctx := context.Background()
	id, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	// The writer buckets under the database clock; tests pin the bucket by
	// updating the written row's key afterwards (the writer's own bucketing
	// is B2's test surface, not this reader's).
	_, wrote, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, wrote)
	_, err = s.pool.Exec(ctx,
		`UPDATE observatory_points SET bucket_start = $1 WHERE bucket_start = date_trunc('hour', now())`, bucket)
	require.NoError(t, err)
	return id
}

func TestObservatorySeriesReadsEngineSeriesAscending(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	h1 := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	h2 := time.Date(2026, 7, 30, 11, 0, 0, 0, time.UTC)
	seedObservatory(t, s, h1)
	id2 := seedObservatory(t, s, h2)

	points, err := s.ObservatorySeries(ctx, riskAaveEngine, nil, nil, 100)
	require.NoError(t, err)
	require.Len(t, points, 2)
	require.Equal(t, h1, points[0].BucketStart)
	require.Equal(t, h2, points[1].BucketStart)

	// The newest point carries the sampleBatch aggregate verbatim: exact
	// totals in the engine's own scale, counts, watermark block, provenance.
	p := points[1]
	require.Equal(t, riskAaveEngine, p.Engine)
	require.Equal(t, id2, p.BatchID)
	require.NotEmpty(t, p.MaterializationKey, "the deterministic key survives batch retention on the point")
	require.EqualValues(t, 1, p.ChainID)
	require.EqualValues(t, 25_635_618, p.LastBlock)
	require.EqualValues(t, 4, p.AckedEpoch)
	require.EqualValues(t, 4, p.MaxEpochAtCompute)
	require.EqualValues(t, 8, p.ValueDecimals)
	require.Equal(t, 1, p.Positions)
	require.Equal(t, 1, p.ComputedPositions)
	require.Equal(t, 0, p.RefusedPositions)
	require.Equal(t, 1, p.FlaggedPositions)
	require.Equal(t, "300000000000", p.TotalCollateral.String())
	require.Equal(t, "100000000000", p.TotalDebt.String())
	require.Empty(t, p.RefusalCode)
	require.NotEmpty(t, p.Rates, "the rates snapshot travels verbatim (at least '{}')")
	require.False(t, p.BatchComputedAt.IsZero())

	// The sweep stamp (00018): the aave engine's absence is RECORDED — the
	// batch stated "no sweeper", which is not the unrecorded state.
	require.True(t, p.SweepRecorded)
	require.Nil(t, p.Sweep, "aave has no collateral sweep; nil Sweep under SweepRecorded=true is the disclosed no-sweeper state")

	// Engines never blend: the DM series is its own, in its own scale.
	dm, err := s.ObservatorySeries(ctx, riskDMEngine, nil, nil, 100)
	require.NoError(t, err)
	require.Len(t, dm, 2)
	require.EqualValues(t, 6, dm[0].ValueDecimals)
	require.Equal(t, 1, dm[0].RefusedPositions)

	// The DM point serves the batch's sweep stamp VERBATIM (sampleBatch's DM
	// watermark), so the bucket's liquidatable count travels with the
	// sweep-cut it aggregates.
	require.True(t, dm[0].SweepRecorded)
	require.NotNil(t, dm[0].Sweep)
	require.EqualValues(t, 2, dm[0].Sweep.Rows)
	require.EqualValues(t, 1, dm[0].Sweep.Failed)
	require.Equal(t, "309580000", dm[0].Sweep.SuccessSum.String())
	require.True(t, dm[0].Sweep.HasUpdatedAt)
	require.True(t, dm[0].Sweep.MaxUpdatedAt.Equal(time.Date(2026, 7, 29, 11, 59, 0, 0, time.UTC)))
	require.EqualValues(t, 3, dm[0].Sweep.Generation)
	require.False(t, dm[0].Sweep.GenerationOpen)
}

// TestObservatorySeriesDisclosesAnUnrecordedSweepStamp: a pre-00018 point
// whose batch was pruned before the backfill has NO sweep record, and the
// reader must serve that as SweepRecorded=false — never as "no sweeper",
// which is a claim the store cannot back. The row is seeded the way the
// migration leaves such history: every sweep column NULL.
func TestObservatorySeriesDisclosesAnUnrecordedSweepStamp(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	h := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	seedObservatory(t, s, h)
	_, err := s.pool.Exec(ctx, `UPDATE observatory_points SET
		sweep_applicable = NULL, sweep_rows = NULL, sweep_failed = NULL,
		sweep_success_sum = NULL, sweep_max_updated_at = NULL,
		sweep_generation = NULL, sweep_generation_open = NULL
		WHERE engine = $1`, riskDMEngine)
	require.NoError(t, err)

	dm, err := s.ObservatorySeries(ctx, riskDMEngine, nil, nil, 100)
	require.NoError(t, err)
	require.Len(t, dm, 1)
	require.False(t, dm[0].SweepRecorded, "NULL sweep_applicable is the UNRECORDED state — pre-00018 history whose batch is gone")
	require.Nil(t, dm[0].Sweep)
}

func TestObservatorySeriesRangeAndValidation(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	h1 := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	h2 := time.Date(2026, 7, 30, 11, 0, 0, 0, time.UTC)
	seedObservatory(t, s, h1)
	seedObservatory(t, s, h2)

	points, err := s.ObservatorySeries(ctx, riskAaveEngine, &h2, nil, 100)
	require.NoError(t, err)
	require.Len(t, points, 1)
	require.Equal(t, h2, points[0].BucketStart)

	points, err = s.ObservatorySeries(ctx, riskAaveEngine, nil, &h1, 100)
	require.NoError(t, err)
	require.Len(t, points, 1)
	require.Equal(t, h1, points[0].BucketStart)

	_, err = s.ObservatorySeries(ctx, "", nil, nil, 100)
	require.ErrorContains(t, err, "engine is required")
	_, err = s.ObservatorySeries(ctx, riskAaveEngine, nil, nil, 0)
	require.ErrorContains(t, err, "limit must be positive")

	unknown, err := s.ObservatorySeries(ctx, "no_such_engine", nil, nil, 100)
	require.NoError(t, err)
	require.Empty(t, unknown)
}
