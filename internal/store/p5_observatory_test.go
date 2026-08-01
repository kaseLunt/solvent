package store

// Live-database tests for P5 Task B2's observatory rollup
// (migration 00016 + p5_observatory.go).
//
// THE LAW UNDER TEST: a point is an OBSERVATION of the newest complete risk
// batch at write time — idempotent per (bucket, engine), refreshed within the
// open bucket only when a NEWER batch lands, and never fabricated when no
// complete batch exists.
//
// MUTATION SPEC (written BEFORE the implementation loop; transcript at
// testdata/mutation-transcripts/p5-b2.md):
//
//   m3 (rollup non-idempotent): the upsert's conflict arm accumulates instead
//      of replacing (total_debt = existing + EXCLUDED, etc.), so a second tick
//      into the same bucket doubles the bucket. KILLED by
//      TestWriteObservatoryPointsIdempotentPerBucket, which double-ticks and
//      asserts the row equals the NEWEST batch's aggregate exactly.
//   m4 (point computed from derived state instead of the batch): the writer's
//      totals sourced from position_balances sums at tick time rather than
//      copied from risk_batch_aggregates. KILLED by
//      TestObservatoryPointsObserveTheBatchNotDerivedState, whose fixture
//      makes the two DISAGREE and requires the batch's numbers verbatim.
//   m5 (wave H5b, spec written BEFORE the loop; transcript at
//      testdata/mutation-transcripts/h5b.md): the rollup's SWEEP-COPY is
//      DROPPED — the writer stops copying the sweep stamp columns (00018)
//      from risk_batch_watermarks, so every new point lands in the
//      UNRECORDED state (sweep_applicable NULL) even though the batch's
//      stamp is right there. The CHECK constraint cannot catch it (NULL is
//      the legal pre-00018 state), which is exactly why
//      TestWriteObservatoryPointsCopySweepStampVerbatim exists: it requires
//      the DM point to carry the batch's stamp VERBATIM (applicable, rows,
//      failed, success_sum, max_updated_at, generation, generation_open)
//      and the Aave point to carry the RECORDED no-sweeper state
//      (sweep_applicable false), never NULL.

import (
	"context"
	"encoding/json"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type obsRow struct {
	BatchID         int64
	Key             string
	ChainID         int64
	LastBlock       int64
	AckedEpoch      int64
	MaxEpoch        int64
	ValueDecimals   int16
	Positions       int
	Computed        int
	Refused         int
	Flagged         int
	Liquidatable    int
	TotalCollateral string
	TotalDebt       string
	RefusalCode     string
	Rates           string
	BucketStart     time.Time
	ObservedAt      time.Time

	// The 00018 sweep stamp, raw: pointers so the three states (unrecorded /
	// no-sweeper / stamped) stay distinguishable in assertions.
	SweepApplicable *bool
	SweepRows       *int64
	SweepFailed     *int64
	SweepSum        *string
	SweepUpdatedAt  *time.Time
	SweepGen        *int64
	SweepOpen       *bool
}

func readObsRows(t *testing.T, s *Store) map[string]obsRow {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT engine, batch_id, materialization_key, chain_id, last_block, acked_epoch,
		        max_epoch_at_compute, value_decimals, positions, computed_positions,
		        refused_positions, flagged_positions, liquidatable_positions,
		        total_collateral::text, total_debt::text, refusal_code, rates::text,
		        bucket_start, observed_at,
		        sweep_applicable, sweep_rows, sweep_failed, sweep_success_sum::text,
		        sweep_max_updated_at, sweep_generation, sweep_generation_open
		 FROM observatory_points ORDER BY engine, bucket_start`)
	require.NoError(t, err)
	defer rows.Close()
	out := map[string]obsRow{}
	for rows.Next() {
		var engine string
		var r obsRow
		require.NoError(t, rows.Scan(&engine, &r.BatchID, &r.Key, &r.ChainID, &r.LastBlock,
			&r.AckedEpoch, &r.MaxEpoch, &r.ValueDecimals,
			&r.Positions, &r.Computed, &r.Refused, &r.Flagged, &r.Liquidatable,
			&r.TotalCollateral, &r.TotalDebt, &r.RefusalCode, &r.Rates,
			&r.BucketStart, &r.ObservedAt,
			&r.SweepApplicable, &r.SweepRows, &r.SweepFailed, &r.SweepSum,
			&r.SweepUpdatedAt, &r.SweepGen, &r.SweepOpen))
		_, dup := out[engine]
		require.False(t, dup, "one row per (bucket, engine): engine %s appeared twice", engine)
		out[engine] = r
	}
	require.NoError(t, rows.Err())
	return out
}

func TestWriteObservatoryPointsObservesNewestCompleteBatch(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	// Rate observations through the real writer: two kinds for one asset, the
	// borrow APY observed twice — the SNAPSHOT must carry the newest per
	// (asset, kind), each with its own as-of block.
	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, nil, []RateObservation{
		{Asset: addr20(0xC1), Block: 25_600_100, Kind: "borrow_apy", Value: big.NewInt(111)},
		{Asset: addr20(0xC1), Block: 25_600_200, Kind: "borrow_apy", Value: big.NewInt(222)},
		{Asset: addr20(0xC1), Block: 25_600_150, Kind: "liquidity_index", Value: big.NewInt(333)},
	}, 25_600_200))

	key := newTestKey()
	id, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)

	res, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, res.BatchID)
	require.ElementsMatch(t, []string{riskAaveEngine, riskDMEngine}, res.Engines,
		"one point per AGGREGATE engine; the param and poll watermark rows carry no book and get no point")

	got := readObsRows(t, s)
	require.Len(t, got, 2)

	aave := got[riskAaveEngine]
	require.Equal(t, id, aave.BatchID)
	require.Equal(t, key, aave.Key,
		"the point retains the batch's deterministic materialization key: traceable after retention prunes the batch row")
	require.EqualValues(t, 1, aave.ChainID)
	require.EqualValues(t, 25_635_618, aave.LastBlock, "the chain-side anchor is the engine's own watermark block")
	require.EqualValues(t, 4, aave.AckedEpoch)
	require.EqualValues(t, 4, aave.MaxEpoch)
	require.EqualValues(t, 8, aave.ValueDecimals)
	require.Equal(t, 1, aave.Positions)
	require.Equal(t, 1, aave.Computed)
	require.Equal(t, 1, aave.Flagged)
	require.Equal(t, "300000000000", aave.TotalCollateral)
	require.Equal(t, "100000000000", aave.TotalDebt)
	require.Equal(t, "", aave.RefusalCode)

	dm := got[riskDMEngine]
	require.EqualValues(t, 10, dm.ChainID)
	require.EqualValues(t, 154_796_552, dm.LastBlock)
	require.EqualValues(t, 9, dm.AckedEpoch)
	require.EqualValues(t, 9, dm.MaxEpoch)
	require.EqualValues(t, 6, dm.ValueDecimals)
	require.Equal(t, 1, dm.Refused)
	require.Equal(t, "0", dm.TotalCollateral)
	require.Equal(t, "0", dm.TotalDebt)

	// The bucket is the DB clock's hour — an observation time, never a chain
	// time — and observed_at falls inside it. Judged IN the database so no
	// session-timezone conversion can skew the comparison.
	require.Equal(t, res.Bucket.UTC(), aave.BucketStart.UTC())
	var bucketIsHourOfObservation bool
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT bool_and(bucket_start = date_trunc('hour', observed_at)) FROM observatory_points`).
		Scan(&bucketIsHourOfObservation))
	require.True(t, bucketIsHourOfObservation)

	// Rates snapshot: newest per (asset, kind), values as DECIMAL STRINGS with
	// their own as-of blocks; the DM (no rate observations) carries absence.
	var rates map[string]map[string]struct {
		Value string `json:"value"`
		Block int64  `json:"block"`
	}
	require.NoError(t, json.Unmarshal([]byte(aave.Rates), &rates))
	asset := "00000000000000000000000000000000000000c1"
	require.Contains(t, rates, asset)
	require.Equal(t, "222", rates[asset]["borrow_apy"].Value, "the newest observation wins; 111@25_600_100 is superseded")
	require.EqualValues(t, 25_600_200, rates[asset]["borrow_apy"].Block)
	require.Equal(t, "333", rates[asset]["liquidity_index"].Value)
	require.EqualValues(t, 25_600_150, rates[asset]["liquidity_index"].Block)
	require.Equal(t, "{}", dm.Rates)
}

// TestWriteObservatoryPointsIdempotentPerBucket is the m3 killer: a double
// tick must not double a bucket — the same batch re-observed writes nothing,
// and a NEWER batch in the same bucket REPLACES the row with its own values
// exactly (never accumulates them).
func TestWriteObservatoryPointsIdempotentPerBucket(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	idA, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	res1, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, idA, res1.BatchID)
	require.Len(t, res1.Engines, 2)

	// Tick again, same batch, same bucket: NOTHING is written.
	res2, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, idA, res2.BatchID)
	require.Empty(t, res2.Engines, "an unchanged observation re-written every tick would be churn pretending to be signal")

	got := readObsRows(t, s)
	require.Len(t, got, 2)
	require.Equal(t, "100000000000", got[riskAaveEngine].TotalDebt, "double-tick must not double the bucket")

	// A NEWER batch with different totals lands inside the same bucket: the
	// open bucket is REFRESHED to the new observation, exactly, in place.
	b := sampleBatchKeyed(10, newTestKey())
	b.Aggregates[0].TotalCollateral = bigStr("500000000000")
	b.Aggregates[0].TotalDebt = bigStr("250000000000")
	idB, err := s.WriteRiskBatch(ctx, b)
	require.NoError(t, err)
	require.Greater(t, idB, idA)

	res3, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, idB, res3.BatchID)
	require.Len(t, res3.Engines, 2)

	got = readObsRows(t, s)
	require.Len(t, got, 2, "a newer batch refreshes the open bucket; it must not mint a second row")
	require.Equal(t, idB, got[riskAaveEngine].BatchID)
	require.Equal(t, "500000000000", got[riskAaveEngine].TotalCollateral)
	require.Equal(t, "250000000000", got[riskAaveEngine].TotalDebt,
		"the refresh REPLACES the observation; 100000000000+250000000000 here is the accumulate mutant")
}

func TestWriteObservatoryPointsNoCompleteBatchWritesNothing(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	_, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.False(t, found, "no complete batch means NO observation — absence, never a fabricated zero point")
	require.Empty(t, readObsRows(t, s))
}

// TestWriteObservatoryPointsCarriesEngineRefusal: a withheld book stays
// visibly withheld in the series — zero positions WITH a refusal code must
// never read as an empty healthy book.
func TestWriteObservatoryPointsCarriesEngineRefusal(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	b := sampleBatchKeyed(10, newTestKey())
	b.Aggregates[0].RefusalCode = "FLAG_CUSTODY_UNPROVEN"
	b.Aggregates[0].RefusalDetail = "coverage provenance missing"
	_, err := s.WriteRiskBatch(ctx, b)
	require.NoError(t, err)

	_, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)

	got := readObsRows(t, s)
	require.Equal(t, "FLAG_CUSTODY_UNPROVEN", got[riskAaveEngine].RefusalCode)
}

// TestObservatoryPointsObserveTheBatchNotDerivedState is the m4 killer: the
// fixture makes CURRENT derived state and the newest complete batch DISAGREE
// — live balances say one thing, the batch's audited aggregate another — and
// the point must carry the BATCH's numbers verbatim. A writer that recomputes
// from position_balances at tick time bypasses the batch pipeline's gates,
// refusals, price snapshot and stamps, and can disagree with the public Book;
// this fixture is where that mutant dies.
func TestObservatoryPointsObserveTheBatchNotDerivedState(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	// CURRENT derived state: a live Aave debt balance that is wildly unlike
	// the batch's totals (the batch below says debt 100000000000).
	require.NoError(t, s.ApplyDerived(ctx, riskAaveEngine, 1, []PositionEvent{{
		ChainID: 1, Engine: riskAaveEngine, BlockNumber: 25_635_700,
		TxHash: []byte{0x79, 0x01}, LogIndex: 0, EventType: "borrow",
		Account: addr20(0xA1), Asset: addr20(0xC1), Side: "debt",
		Delta: bigStr("999999999999999999"),
	}}, 25_635_700))

	// The audited batch — older watermark, different totals — is what the API
	// serves; it is therefore what the series must record.
	_, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	_, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)

	got := readObsRows(t, s)
	require.Equal(t, "100000000000", got[riskAaveEngine].TotalDebt,
		"the point must copy the BATCH's aggregate; 999999999999999999 here means the writer recomputed from live derived state (m4)")
	require.Equal(t, "300000000000", got[riskAaveEngine].TotalCollateral)
	require.EqualValues(t, 25_635_618, got[riskAaveEngine].LastBlock,
		"the as-of is the batch's watermark, not the live cursor the recompute would have stamped")
}

// TestWriteObservatoryPointsCopySweepStampVerbatim is the m5 killer (wave
// H5b): the SWEEP STAMP is part of the copied watermark vector, and a writer
// that drops the copy leaves every new point in the UNRECORDED state
// (sweep_applicable NULL) — legal under the 00018 CHECK, because NULL is the
// honest pre-00018 state, so only this test stands between the mutant and a
// series whose liquidatable counts have no sweep clock.
func TestWriteObservatoryPointsCopySweepStampVerbatim(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	_, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	_, found, err := s.WriteObservatoryPoints(ctx)
	require.NoError(t, err)
	require.True(t, found)

	got := readObsRows(t, s)

	// The DM point carries the batch's stamp VERBATIM (sampleBatch's DM
	// watermark: rows 2, failed 1, success_sum 309_580_000, max_updated_at
	// 2026-07-29T11:59:00Z, generation 3, closed).
	dm := got[riskDMEngine]
	require.NotNil(t, dm.SweepApplicable, "a point written under 00018 is NEVER in the unrecorded state — that state is reserved for pre-00018 history (m5)")
	require.True(t, *dm.SweepApplicable)
	require.NotNil(t, dm.SweepRows)
	require.EqualValues(t, 2, *dm.SweepRows)
	require.NotNil(t, dm.SweepFailed)
	require.EqualValues(t, 1, *dm.SweepFailed)
	require.NotNil(t, dm.SweepSum)
	require.Equal(t, "309580000", *dm.SweepSum)
	require.NotNil(t, dm.SweepUpdatedAt)
	require.True(t, dm.SweepUpdatedAt.UTC().Equal(time.Date(2026, 7, 29, 11, 59, 0, 0, time.UTC)),
		"max_updated_at is the batch's own stamp, never a clock this writer invented")
	require.NotNil(t, dm.SweepGen)
	require.EqualValues(t, 3, *dm.SweepGen)
	require.NotNil(t, dm.SweepOpen)
	require.False(t, *dm.SweepOpen)

	// The Aave point carries the RECORDED no-sweeper state: applicable false,
	// every stamp column NULL. False and NULL are different statements —
	// "this engine has no sweeper" versus "the record does not exist".
	aave := got[riskAaveEngine]
	require.NotNil(t, aave.SweepApplicable, "no-sweeper is a RECORDED fact, never the unrecorded NULL (m5)")
	require.False(t, *aave.SweepApplicable)
	require.Nil(t, aave.SweepRows)
	require.Nil(t, aave.SweepFailed)
	require.Nil(t, aave.SweepSum)
	require.Nil(t, aave.SweepUpdatedAt)
	require.Nil(t, aave.SweepGen)
	require.Nil(t, aave.SweepOpen)
}
