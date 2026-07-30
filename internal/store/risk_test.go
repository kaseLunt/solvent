package store

// Live-database tests for the risk materialization surface (P3 Task 5):
// the RR snapshot read, the one-transaction batch write, torn-batch
// unservability, retention, the post-batch price-mutation regression and the
// riskd role's structural read-only posture.

import (
	"context"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

const (
	riskAaveEngine  = "aave_v3_etherfi"
	riskParamEngine = "aave_param"
	riskDMEngine    = "debt_manager"
	riskPollEngine1 = "prices:poll:1"
)

var riskAaveOracleSource = "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f"

// testRiskStore is testDeriveStore plus the risk tables. Children cascade from
// risk_batches, so truncating it alone would leave the sequence — which the
// retention test reads — so every risk table is named and the sequence restarts.
func testRiskStore(t *testing.T) *Store {
	t.Helper()
	s := testDeriveStore(t)
	_, err := s.pool.Exec(context.Background(),
		`TRUNCATE risk_batches, risk_batch_watermarks, risk_positions, risk_position_legs,
		          risk_price_inputs, risk_batch_aggregates, risk_scenarios, risk_waterfall
		 RESTART IDENTITY CASCADE`)
	require.NoError(t, err)
	return s
}

func riskAsOf(offset time.Duration) *time.Time {
	t := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC).Add(offset)
	return &t
}

func i16(v int16) *int16    { return &v }
func u64p(v uint64) *uint64 { return &v }
func i64p(v int64) *int64   { return &v }
func boolp(v bool) *bool    { return &v }

// sampleBatch is one complete, servable batch: two positions (one computed, one
// refused), legs, full price snapshots, aggregates and stamps.
func sampleBatch(retention int) RiskBatchWrite {
	return sampleBatchKeyed(retention, newTestKey())
}

// testKeySeq mints distinct idempotency keys, since the column is UNIQUE and
// every legitimately-distinct prepared pass must carry its own.
var testKeySeq int64

func newTestKey() string {
	testKeySeq++
	return fmt.Sprintf("test-key-%d-%d", time.Now().UnixNano(), testKeySeq)
}

func sampleBatchKeyed(retention int, key string) RiskBatchWrite {
	return RiskBatchWrite{
		Producer:  "riskd-test",
		Retention: retention,
		// The identity travels WITH the key, so adoption can verify rather than
		// assume. Derived from the key here so two fixtures with the same key
		// carry the same identity and two with different keys do not.
		MaterializationKey:    key,
		MaterializationVector: "vector(" + key + ")",
		SubstrateDigest:       "substrate(" + key + ")",
		Watermarks: []RiskBatchWatermark{
			{Engine: riskAaveEngine, ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 4, MaxEpochAtCompute: 4},
			{Engine: riskParamEngine, ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 4, MaxEpochAtCompute: 4},
			{Engine: riskPollEngine1, ChainID: 1, LastBlock: 25_635_600, AckedEpoch: 4, MaxEpochAtCompute: 4},
			{Engine: riskDMEngine, ChainID: 10, LastBlock: 154_796_552, AckedEpoch: 9, MaxEpochAtCompute: 9,
				Sweep: &RiskSweepWatermark{
					Engine: riskDMEngine, Rows: 2, Failed: 1,
					SuccessSum: big.NewInt(309_580_000), HasUpdatedAt: true,
					MaxUpdatedAt: time.Date(2026, 7, 29, 11, 59, 0, 0, time.UTC),
					Generation:   3, GenerationOpen: false,
				}},
		},
		Positions: []RiskPositionWrite{
			{
				Engine: riskAaveEngine, Account: addr20(0xA1), Status: RiskPositionComputed,
				Flags: []string{"stale_price"}, ValueDecimals: 8,
				HFNum: big.NewInt(2430000000000000), HFDen: big.NewInt(1000000000000000),
				HFWad:               bigStr("2430000000000000000"),
				TotalCollateralBase: bigStr("300000000000"),
				TotalDebtBase:       bigStr("100000000000"),
				WeightedLTSum:       bigStr("2430000000000000"),
				AvgLTBps:            big.NewInt(8100),
				BalancesBlock:       25_635_618, ParamsBlock: 25_635_618,
				OldestPriceInput: riskAsOf(-30 * time.Second), StalePriceInputs: true,
				Legs: []RiskLegWrite{{
					Asset: addr20(0xC1), Decimals: 18,
					ScaledCollateral:     bigStr("1000000000000000000"),
					LiveCollateral:       bigStr("1000000000000000000"),
					CollateralBase:       bigStr("300000000000"),
					WeightedLT:           bigStr("2430000000000000"),
					UsedAsCollateral:     boolp(true),
					CollateralIndexBlock: u64p(25_600_000),
					LiqThreshold:         big.NewInt(8100),
					LiqBonus:             big.NewInt(10600),
				}},
				Prices: []RiskPriceInputWrite{{
					Asset: addr20(0xC1), ChainID: 1, Source: riskAaveOracleSource,
					Provenance: "adapter-output", Value: bigStr("300000000000"),
					Decimals: i16(8), BlockNumber: u64p(25_635_600),
					SourceAsOf:    riskAsOf(-30 * time.Second),
					BudgetSeconds: 180, Verdict: "fresh", AgeSeconds: i64p(30),
				}},
			},
			{
				Engine: riskDMEngine, Account: addr20(0xB2), Status: RiskPositionRefused,
				RefusalCode: "SWEEP_NEVER", RefusalDetail: "collateral never read",
				ValueDecimals: 6, BalancesBlock: 154_796_552, ParamsBlock: 154_796_552,
			},
		},
		Aggregates: []RiskEngineAggregate{
			{Engine: riskAaveEngine, ValueDecimals: 8, Positions: 1, ComputedPositions: 1,
				FlaggedPositions: 1, TotalCollateral: bigStr("300000000000"), TotalDebt: bigStr("100000000000")},
			{Engine: riskDMEngine, ValueDecimals: 6, Positions: 1, RefusedPositions: 1,
				TotalCollateral: new(big.Int), TotalDebt: new(big.Int)},
		},
	}
}

// riskHash32 builds a distinct 32-byte block hash — poll anchors refuse
// anything that is not hash-shaped.
func riskHash32(b byte) []byte {
	h := make([]byte, 32)
	h[31] = b
	return h
}

func bigStr(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad integer literal: " + s)
	}
	return v
}

// TestWriteRiskBatchRoundTrip: everything a batch carries survives the trip,
// exactly, through NUMERIC and back.
func TestWriteRiskBatchRoundTrip(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	id, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	require.Positive(t, id)

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID)
	require.Equal(t, RiskBatchComplete, batch.Status)
	require.Equal(t, 2, batch.PositionCount)
	require.Equal(t, 1, batch.RefusedCount)
	require.Equal(t, 1, batch.FlaggedCount)
	require.Equal(t, "riskd-test", batch.Producer)
	require.False(t, batch.ComputedAt.IsZero(), "computed_at is the DATABASE clock")

	// The stamp vector — per engine (last_block, acked_epoch) + the chain's
	// max epoch at compute time.
	require.Len(t, batch.Watermarks, 4)
	byEngine := map[string]RiskBatchWatermark{}
	for _, w := range batch.Watermarks {
		byEngine[w.Engine] = w
	}
	require.EqualValues(t, 25_635_618, byEngine[riskAaveEngine].LastBlock)
	require.EqualValues(t, 4, byEngine[riskAaveEngine].AckedEpoch)
	require.EqualValues(t, 4, byEngine[riskAaveEngine].MaxEpochAtCompute)
	require.EqualValues(t, 25_635_600, byEngine[riskPollEngine1].LastBlock)

	positions, err := s.RiskBatchPositions(ctx, id)
	require.NoError(t, err)
	require.Len(t, positions, 2)
	var aave, dm RiskBatchPosition
	for _, p := range positions {
		switch p.Engine {
		case riskAaveEngine:
			aave = p
		case riskDMEngine:
			dm = p
		}
	}
	require.Equal(t, "2430000000000000000", aave.HFWad.String())
	require.Equal(t, "2430000000000000", aave.HFNum.String())
	require.Equal(t, "300000000000", aave.TotalCollateralBase.String())
	require.Equal(t, []string{"stale_price"}, aave.Flags)
	require.True(t, aave.StalePriceInputs)
	require.EqualValues(t, 8, aave.ValueDecimals)
	require.EqualValues(t, 25_635_618, aave.BalancesBlock)

	require.Equal(t, RiskPositionRefused, dm.Status)
	require.Equal(t, "SWEEP_NEVER", dm.RefusalCode)
	require.Nil(t, dm.HFWad, "a refusal carries no health factor")
	require.Nil(t, dm.Liquidatable, "and asserts no liquidatable verdict")

	prices, err := s.RiskBatchPriceInputs(ctx, id)
	require.NoError(t, err)
	require.Len(t, prices, 1)
	require.Equal(t, "300000000000", prices[0].Value.String())
	require.EqualValues(t, 8, *prices[0].Decimals)
	require.EqualValues(t, 25_635_600, *prices[0].BlockNumber)
	require.Equal(t, "adapter-output", prices[0].Provenance)
	require.EqualValues(t, 180, prices[0].BudgetSeconds)
	require.Equal(t, "fresh", prices[0].Verdict)
	require.EqualValues(t, 30, *prices[0].AgeSeconds)

	aggs, err := s.RiskBatchAggregates(ctx, id)
	require.NoError(t, err)
	require.Len(t, aggs, 2)
	for _, a := range aggs {
		if a.Engine == riskAaveEngine {
			require.Equal(t, 1, a.FlaggedPositions)
			require.Equal(t, "300000000000", a.TotalCollateral.String())
			require.EqualValues(t, 8, a.ValueDecimals)
		} else {
			require.Equal(t, 1, a.RefusedPositions)
			require.EqualValues(t, 6, a.ValueDecimals)
		}
	}

	// Legs carry the PER-ASSET index as-of; a single position-level block would
	// be the Task-7 finding class.
	var indexBlock int64
	var bonus string
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT collateral_index_block, liq_bonus::text FROM risk_position_legs
		 WHERE batch_id = $1 AND engine = $2`, id, riskAaveEngine).Scan(&indexBlock, &bonus))
	require.EqualValues(t, 25_600_000, indexBlock)
	require.Equal(t, "10600", bonus, "the liquidation bonus reached storage; without it recovery arithmetic uses par")
}

func TestWriteRiskBatchRefusesIncoherentInput(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	b := sampleBatch(10)
	b.Watermarks = nil
	_, err := s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)

	b = sampleBatch(10)
	b.Positions = append(b.Positions, b.Positions[0])
	_, err = s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskBatchIncomplete)

	b = sampleBatch(0)
	_, err = s.WriteRiskBatch(ctx, b)
	require.ErrorIs(t, err, ErrRiskRetentionInvalid)

	// None of the refusals left a partial batch behind.
	_, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.False(t, found)
}

// TestWriteRiskBatchRetentionPrunesInTheWriteTransaction: newest N survive,
// children cascade, and the prune is part of the same commit.
func TestWriteRiskBatchRetentionPrunesInTheWriteTransaction(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	var ids []int64
	for i := 0; i < 5; i++ {
		id, err := s.WriteRiskBatch(ctx, sampleBatch(3))
		require.NoError(t, err)
		ids = append(ids, id)
	}

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&count))
	require.Equal(t, 3, count, "retention keeps the newest 3")

	var surviving []int64
	rows, err := s.pool.Query(ctx, `SELECT id FROM risk_batches ORDER BY id`)
	require.NoError(t, err)
	for rows.Next() {
		var id int64
		require.NoError(t, rows.Scan(&id))
		surviving = append(surviving, id)
	}
	rows.Close()
	require.Equal(t, ids[2:], surviving)

	// Children of the pruned batches went with them.
	var orphans int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM risk_positions WHERE batch_id = ANY($1)`, ids[:2]).Scan(&orphans))
	require.Zero(t, orphans)
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM risk_price_inputs WHERE batch_id = ANY($1)`, ids[:2]).Scan(&orphans))
	require.Zero(t, orphans)
}

// TestRiskBatchSnapshotSurvivesPostBatchPriceMutation is the [H6] regression.
//
// A batch persists FULL price snapshots rather than identity references. After
// it commits, the source row is (1) NEUTRALIZED — D-012 flips `valid` in place
// on the very row the batch consumed — and then (2) SUPERSEDED by a later poll
// at a higher block with a different value. A serve-time join back into `prices`
// would now disclose a different number, or none at all. The persisted
// disclosure must be byte-identical.
func TestRiskBatchSnapshotSurvivesPostBatchPriceMutation(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	asset := addr20(0xC1)
	const engine = "prices:poll:1"

	// The source row the batch will consume.
	asOf := time.Date(2026, 7, 29, 11, 59, 30, 0, time.UTC)
	_, err := s.ApplyPolledPrices(ctx, engine, 1, []PriceObservation{{
		Asset: asset, Source: riskAaveOracleSource, Price: bigStr("300000000000"),
		Decimals: 8, BlockNumber: 25_635_600, SourceAsOf: asOf,
	}}, 25_635_600, PollAnchor{BlockNumber: 25_635_600, BlockHash: riskHash32(0xab)})
	require.NoError(t, err)

	// riskd reads it through the same predicate it uses in a pass.
	read, err := RiskUsablePrices(ctx, s.pool, []RiskPriceKey{
		{ChainID: 1, Asset: asset, Source: riskAaveOracleSource},
	})
	require.NoError(t, err)
	require.Len(t, read, 1)
	require.Equal(t, "300000000000", read[0].Value.String())
	require.True(t, read[0].HasSourceAsOf)

	b := sampleBatch(10)
	b.Positions[0].Prices[0].Value = new(big.Int).Set(read[0].Value)
	b.Positions[0].Prices[0].SourceAsOf = &asOf
	id, err := s.WriteRiskBatch(ctx, b)
	require.NoError(t, err)

	before, err := s.RiskBatchPriceInputs(ctx, id)
	require.NoError(t, err)
	require.Len(t, before, 1)

	// (1) NEUTRALIZE — the batch's own row is marked unusable IN PLACE.
	//
	// The target is the block the reorg rewound TO, and the store marks rows
	// strictly ABOVE it: a polled row above the rewind target was read from a
	// chain that may no longer exist, and nothing can re-derive a point-in-time
	// contract read (D-012 clause 1). So the fixture rewinds to one block below
	// the row the batch consumed, which is the shallowest reorg that puts that
	// row in the unverifiable suffix.
	_, quarantined, err := s.NeutralizeUnverifiablePrices(ctx, engine, 1, 25_635_599, 0)
	require.NoError(t, err)
	require.Positive(t, quarantined, "the fixture must actually neutralize the row, or it proves nothing")

	// Proof the flip landed on the row the batch consumed: it is gone from the
	// usable-price read entirely.
	gone, err := RiskUsablePrices(ctx, s.pool, []RiskPriceKey{
		{ChainID: 1, Asset: asset, Source: riskAaveOracleSource},
	})
	require.NoError(t, err)
	require.Empty(t, gone, "the batch's own input is now quarantined and unusable")

	// (2) SUPERSEDE — a later poll lands a DIFFERENT value on the same key.
	_, err = s.ApplyPolledPrices(ctx, engine, 1, []PriceObservation{{
		Asset: asset, Source: riskAaveOracleSource, Price: bigStr("111111111111"),
		Decimals: 8, BlockNumber: 25_635_700,
		SourceAsOf: asOf.Add(time.Minute),
	}}, 25_635_700, PollAnchor{BlockNumber: 25_635_700, BlockHash: riskHash32(0xef)})
	require.NoError(t, err)

	// A serve-time re-read would now say something else entirely — proven, so
	// the assertion below is not vacuous.
	reread, err := RiskUsablePrices(ctx, s.pool, []RiskPriceKey{
		{ChainID: 1, Asset: asset, Source: riskAaveOracleSource},
	})
	require.NoError(t, err)
	require.Len(t, reread, 1)
	require.Equal(t, "111111111111", reread[0].Value.String(),
		"the live read moved: a serve-time join would disclose a value the batch never used")

	after, err := s.RiskBatchPriceInputs(ctx, id)
	require.NoError(t, err)
	require.Equal(t, before, after, "the persisted disclosure is a COPY and must be byte-identical after the mutation")
	require.Equal(t, "300000000000", after[0].Value.String())
	require.EqualValues(t, 25_635_600, *after[0].BlockNumber)
	require.Equal(t, asOf.UTC(), after[0].SourceAsOf.UTC())
}

// TestWriteRiskBatchFiresDoorbellExactlyOnCommit: pg_notify is enqueued inside
// the write transaction, so it is delivered if and only if the batch landed.
func TestWriteRiskBatchFiresDoorbellExactlyOnCommit(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	conn, err := s.pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()
	_, err = conn.Exec(ctx, `LISTEN risk_batch`)
	require.NoError(t, err)

	// A REFUSED write must ring nothing.
	bad := sampleBatch(10)
	bad.Watermarks = nil
	_, err = s.WriteRiskBatch(ctx, bad)
	require.Error(t, err)

	b := sampleBatch(10)
	b.Notify = "risk_batch"
	id, err := s.WriteRiskBatch(ctx, b)
	require.NoError(t, err)

	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	n, err := conn.Conn().WaitForNotification(waitCtx)
	require.NoError(t, err)
	require.Equal(t, "risk_batch", n.Channel)
	require.Equal(t, big.NewInt(id).String(), n.Payload,
		"the payload is the batch id and nothing else — a doorbell, never a truth channel")
}

// ---------------------------------------------------------------------------
// The RR snapshot read.
// ---------------------------------------------------------------------------

func TestRiskInputSnapshotReadsTheSubstrateInOneTransaction(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1,
		[]PositionEvent{{
			ChainID: 1, Engine: riskAaveEngine, BlockNumber: 100, TxHash: []byte{0x01},
			LogIndex: 0, EventType: "atoken_mint", Account: addr20(0xA1), Asset: addr20(0xC1),
			Side: "collateral", Delta: bigStr("1000000000000000000"),
		}},
		[]RateObservation{{Asset: addr20(0xC1), Block: 90, Kind: "liquidity_index", Value: bigStr("1000000000000000000000000000")}},
		100))
	require.NoError(t, s.ApplyParamEvents(ctx, riskParamEngine, 1, []ParamRow{{
		Engine: riskParamEngine, ChainID: 1, Asset: addr20(0xC1),
		LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
		EffectiveBlock: 50, EffectiveLogIndex: 3,
		SourceEvent: "aave_cfg_collateral_configuration_changed", TxHash: []byte{0x0c},
	}}, 100))
	_, err := s.ApplyPolledPrices(ctx, riskPollEngine1, 1, []PriceObservation{{
		Asset: addr20(0xC1), Source: riskAaveOracleSource, Price: bigStr("300000000000"),
		Decimals: 8, BlockNumber: 95, SourceAsOf: time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC),
	}}, 95, PollAnchor{BlockNumber: 95, BlockHash: riskHash32(0x9a)})
	require.NoError(t, err)

	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()

	in, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{
		PositionEngines: []string{riskAaveEngine, riskDMEngine},
		IndexBounds:     map[string]uint64{riskAaveEngine: 100},
		AaveParamEngine: riskParamEngine, AaveParamChain: 1, AaveParamBlock: 100,
		Prices: []RiskPriceKey{
			{ChainID: 1, Asset: addr20(0xC1), Source: riskAaveOracleSource},
			// A key with no usable row: absent from the result, never an error.
			{ChainID: 1, Asset: addr20(0xC9), Source: riskAaveOracleSource},
		},
	})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))

	require.False(t, in.ReadAt.IsZero(), "the snapshot clock is the DATABASE's now()")
	require.Len(t, in.Balances, 1)
	require.Equal(t, "1000000000000000000", in.Balances[0].Amount.String())
	require.Equal(t, "event", in.Balances[0].Source)
	require.Empty(t, in.BalanceConflicts)

	require.Len(t, in.Indexes, 1)
	require.EqualValues(t, 90, in.Indexes[0].Block, "the index as-of trails the cursor and is carried")
	require.Equal(t, "liquidity_index", in.Indexes[0].Kind)

	require.Len(t, in.AaveParams, 1)
	require.Equal(t, "8100", in.AaveParams[0].LiqThreshold.String())

	require.Len(t, in.Prices, 1, "a key with no usable row is ABSENT, not an error")
	require.Equal(t, "300000000000", in.Prices[0].Value.String())
	require.True(t, in.Prices[0].HasSourceAsOf)

	// The vector came from the same snapshot.
	byEngine := map[string]DeriveCursorState{}
	for _, c := range in.Cursors {
		byEngine[c.Engine] = c
	}
	require.EqualValues(t, 100, byEngine[riskAaveEngine].LastBlock)
	require.EqualValues(t, 95, byEngine[riskPollEngine1].LastBlock)
}

// TestRiskSweepStateForAggregatesTheSweepTables: the durable key the recompute
// trigger's sweep leg compares. `ApplySweepBatch` moves these rows and NO derive
// cursor, so this read is the only thing that can see a sweep transition.
func TestRiskSweepStateForAggregatesTheSweepTables(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()
	const engine = riskDMEngine

	// A never-swept engine still yields a row: "no sweep has ever happened" is a
	// state the trigger must be able to see CHANGE, and an absent row would make
	// the first sweep look like nothing at all.
	state, err := RiskSweepStateFor(ctx, s.pool, []string{engine})
	require.NoError(t, err)
	require.Len(t, state, 1)
	require.Equal(t, engine, state[0].Engine)
	require.Zero(t, state[0].Rows)
	require.Equal(t, "0", state[0].SuccessSum.String())
	require.False(t, state[0].HasUpdatedAt, "never swept carries NO timestamp, not the zero time")
	require.Zero(t, state[0].Generation)

	// One success and one failure.
	_, err = s.pool.Exec(ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status) VALUES
		($1, $2, 120, 120, 'success'),
		($1, $3, 130, 0,  'failed')`, engine, addr20(0xB1), addr20(0xB2))
	require.NoError(t, err)

	state, err = RiskSweepStateFor(ctx, s.pool, []string{engine})
	require.NoError(t, err)
	require.EqualValues(t, 2, state[0].Rows)
	require.EqualValues(t, 1, state[0].Failed, "a non-success status counts as failed")
	require.Equal(t, "120", state[0].SuccessSum.String())
	require.True(t, state[0].HasUpdatedAt)

	// The SUM moves when a lagging account catches up behind a higher peer — a
	// MAX would not.
	_, err = s.pool.Exec(ctx,
		`UPDATE snapshot_sweeps SET last_success_block = 90, status = 'success'
		 WHERE engine = $1 AND account = $2`, engine, addr20(0xB2))
	require.NoError(t, err)
	state, err = RiskSweepStateFor(ctx, s.pool, []string{engine})
	require.NoError(t, err)
	require.Equal(t, "210", state[0].SuccessSum.String(), "120 + 90 — the sum, not the max")
	require.Zero(t, state[0].Failed)

	// The generation leg, including open/closed.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	state, err = RiskSweepStateFor(ctx, s.pool, []string{engine})
	require.NoError(t, err)
	require.EqualValues(t, gen, state[0].Generation)
	require.True(t, state[0].GenerationOpen, "an open generation means a sweep pass is in flight")
}

// TestRiskInputSnapshotCarriesSweepState: the pass reads the same aggregate
// inside its own snapshot, so the poll and the pass cannot drift into two
// different notions of "the sweep moved".
func TestRiskInputSnapshotCarriesSweepState(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	_, err := s.pool.Exec(ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 500, 500, 'success')`, riskDMEngine, addr20(0xB1))
	require.NoError(t, err)

	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()
	in, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{
		PositionEngines: []string{riskAaveEngine, riskDMEngine},
	})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))

	byEngine := map[string]RiskSweepWatermark{}
	for _, w := range in.SweepState {
		byEngine[w.Engine] = w
	}
	require.Len(t, byEngine, 2, "one row per requested engine, swept or not")
	require.Equal(t, "500", byEngine[riskDMEngine].SuccessSum.String())
	require.Zero(t, byEngine[riskAaveEngine].Rows)
}

// TestRiskInputSnapshotIsReadOnly proves the READ ONLY half structurally.
func TestRiskInputSnapshotIsReadOnly(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block) VALUES ('x', 1, 1)`)
	require.Error(t, err, "riskd's snapshot transaction cannot write P2 state — the transaction refuses it")
}

// TestRiskInputSnapshotWithholdsConflictedAccounts: an account holding one
// (asset, side) under BOTH sources reports the conflict and yields NO rows,
// exactly as BalancesFor and ReconBalancesForAccounts do.
func TestRiskInputSnapshotWithholdsConflictedAccounts(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	_, err := s.pool.Exec(ctx, `INSERT INTO position_balances
		(engine, account, asset, side, source, amount, updated_block) VALUES
		($1, $2, $3, 'collateral', 'event', 5, 10),
		($1, $2, $3, 'collateral', 'snapshot', 7, 11),
		($1, $4, $3, 'collateral', 'event', 9, 12)`,
		riskDMEngine, addr20(0xB1), addr20(0xC1), addr20(0xB2))
	require.NoError(t, err)

	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()
	in, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{PositionEngines: []string{riskDMEngine}})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))

	require.Len(t, in.BalanceConflicts, 1)
	require.Len(t, in.Balances, 1, "the conflicted account's rows are WITHHELD; the clean account's survive")
	require.Equal(t, addr20(0xB2), in.Balances[0].Account)
}

// ---------------------------------------------------------------------------
// Debt Manager params from already-custodied position_events.
// ---------------------------------------------------------------------------

func dmConfigEvent(block uint64, tx byte, asset []byte, ltv, lt, bonus string) PositionEvent {
	return PositionEvent{
		ChainID: 10, Engine: riskDMEngine, BlockNumber: block, TxHash: []byte{tx}, LogIndex: 0,
		EventType: "collateral_token_config_set", Account: []byte{}, Asset: asset,
		Payload: map[string]string{
			"ltv": ltv, "liquidation_threshold": lt, "liquidation_bonus": bonus,
		},
	}
}

func TestDMParamsAsOfReadsAlreadyCustodiedEvents(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerived(ctx, riskDMEngine, 10, []PositionEvent{
		dmConfigEvent(100, 0x01, addr20(0xC1), "80000000000000000000", "85000000000000000000", "1000000000000000000"),
		dmConfigEvent(200, 0x02, addr20(0xC1), "82000000000000000000", "87000000000000000000", "2000000000000000000"),
		dmConfigEvent(150, 0x03, addr20(0xC2), "50000000000000000000", "60000000000000000000", "5000000000000000000"),
	}, 300))

	rows, err := DMParamsAsOf(ctx, s.pool, 300)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	byAsset := map[string]ParamRow{}
	for _, r := range rows {
		byAsset[string(r.Asset)] = r
		require.Equal(t, riskDMEngine, r.Engine, "the engine tag is what keeps the 100e18 denominator identifiable")
		require.EqualValues(t, 10, r.ChainID)
	}
	require.Equal(t, "87000000000000000000", byAsset[string(addr20(0xC1))].LiqThreshold.String(),
		"the LATER config wins for that asset")
	require.EqualValues(t, 200, byAsset[string(addr20(0xC1))].EffectiveBlock)
	require.Equal(t, "60000000000000000000", byAsset[string(addr20(0xC2))].LiqThreshold.String())

	// As-of bounding: reading at block 150 sees only what had happened by then.
	rows, err = DMParamsAsOf(ctx, s.pool, 150)
	require.NoError(t, err)
	byAsset = map[string]ParamRow{}
	for _, r := range rows {
		byAsset[string(r.Asset)] = r
	}
	require.Equal(t, "85000000000000000000", byAsset[string(addr20(0xC1))].LiqThreshold.String())
}

// TestDMParamsAsOfDropsRemovedCollateral: a delisted token yields NO param row,
// so a position still holding it refuses on a missing threshold rather than
// being valued at the threshold it had before the lens stopped counting it.
func TestDMParamsAsOfDropsRemovedCollateral(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	removal := PositionEvent{
		ChainID: 10, Engine: riskDMEngine, BlockNumber: 300, TxHash: []byte{0x09}, LogIndex: 0,
		EventType: "collateral_token_removed", Account: []byte{}, Asset: addr20(0xC1),
	}
	readd := removal
	readd.BlockNumber, readd.TxHash, readd.EventType = 400, []byte{0x0a}, "collateral_token_added"

	require.NoError(t, s.ApplyDerived(ctx, riskDMEngine, 10, []PositionEvent{
		dmConfigEvent(100, 0x01, addr20(0xC1), "80000000000000000000", "85000000000000000000", "1000000000000000000"),
		removal,
	}, 350))

	rows, err := DMParamsAsOf(ctx, s.pool, 350)
	require.NoError(t, err)
	require.Empty(t, rows, "a removed collateral token is a valuation DISCONTINUITY, not a stale parameter")

	// Re-adding restores it, config and all.
	require.NoError(t, s.ApplyDerived(ctx, riskDMEngine, 10, []PositionEvent{readd}, 450))
	rows, err = DMParamsAsOf(ctx, s.pool, 450)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "85000000000000000000", rows[0].LiqThreshold.String())
}

// ---------------------------------------------------------------------------
// The structural read-only posture.
// ---------------------------------------------------------------------------

// TestRiskdRoleIsSelectOnlyOnP2Tables proves migration 00013's GRANT block did
// what its comment claims. It SKIPS when the role was not provisioned — the
// migration's exception handler is deliberate, so its absence is a documented
// outcome and not a failure.
func TestRiskdRoleIsSelectOnlyOnP2Tables(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	var exists bool
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solvent_riskd')`).Scan(&exists))
	if !exists {
		t.Skip("solvent_riskd was not provisioned (migration 00013's insufficient_privilege arm); the structural posture is unavailable on this database")
	}

	priv := func(table, p string) bool {
		var ok bool
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT has_table_privilege('solvent_riskd', $1, $2)`, table, p).Scan(&ok))
		return ok
	}

	for _, table := range []string{"position_balances", "position_events", "derive_cursors",
		"rate_indexes", "reorg_epochs", "prices", "snapshot_sweeps", "param_history", "raw_logs"} {
		require.True(t, priv(table, "SELECT"), "riskd must be able to read %s", table)
		for _, write := range []string{"INSERT", "UPDATE", "DELETE"} {
			require.False(t, priv(table, write),
				"riskd must NOT be able to %s %s — D-004's single-writer contract, enforced by the database", write, table)
		}
	}
	for _, table := range []string{"risk_batches", "risk_positions", "risk_price_inputs",
		"risk_batch_watermarks", "risk_position_legs", "risk_batch_aggregates"} {
		for _, p := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
			require.True(t, priv(table, p), "riskd owns %s and needs %s on it", table, p)
		}
	}
}

var _ pgx.Tx = nil
