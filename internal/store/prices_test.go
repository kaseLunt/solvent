package store

// Live-database tests for the price persistence surface (Task 8): ApplyPrices'
// gates and idempotence/divergence contract, RewindPrices' source-scoped
// atomic delete-and-ack, and the M4 consequence that PruneAckedReorgEpochs now
// waits for the price cursors too.

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	testPollEngine = "prices:poll:10"
	testFeedEngine = "prices:chainlink_feed:1"
	testPollSource = "priceproviderv2"
	testFeedSource = "chainlink:0xc9e1a09622afdb659913fefe800feae5dbbfe9d7"
	testRatioSrc   = "ratio:getrate:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"
)

// addr20 builds a distinct 20-byte address from one discriminating byte —
// ApplyPrices refuses anything that is not address-shaped.
func addr20(b byte) []byte {
	a := make([]byte, 20)
	a[19] = b
	return a
}

// po builds a PriceObservation for the given key, varying only what a test
// cares about.
func po(block uint64, asset byte, source string, price int64, decimals int32) PriceObservation {
	return PriceObservation{
		Asset: addr20(asset), Source: source, Price: big.NewInt(price),
		Decimals: decimals, BlockNumber: block,
	}
}

// priceRows reads every prices row of chainID keyed "assethex/source@block" →
// "price:decimals", so a test can assert exact row shape in one require.Equal.
func priceRows(t *testing.T, s *Store, chainID uint64) map[string]string {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT encode(asset,'hex') || '/' || source || '@' || block_number::text,
		        price::text || ':' || price_decimals::text
		 FROM prices WHERE chain_id = $1`, chainID)
	require.NoError(t, err)
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		require.NoError(t, rows.Scan(&k, &v))
		m[k] = v
	}
	require.NoError(t, rows.Err())
	return m
}

// cursorState reads an engine's derive_cursors row.
func cursorState(t *testing.T, s *Store, engine string) (chainID, lastBlock uint64, acked int64) {
	t.Helper()
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT chain_id, last_block, acked_epoch FROM derive_cursors WHERE engine = $1`,
		engine).Scan(&chainID, &lastBlock, &acked))
	return
}

// TestApplyPricesRoundTrip: a batch lands its rows and advances the cursor.
func TestApplyPricesRoundTrip(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	obs := []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
		po(100, 0xBB, testPollSource, 3_412_550_000, 6),
	}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, obs, 100)))

	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/priceproviderv2@100": "1000000:6",
		"00000000000000000000000000000000000000bb/priceproviderv2@100": "3412550000:6",
	}, priceRows(t, s, 10))

	chainID, last, acked := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(10), chainID)
	require.Equal(t, uint64(100), last)
	require.Equal(t, int64(0), acked, "no epoch on the chain: implicit first-write ack of 0")
}

// The isStableToken snap (exactly 1e6 inside a ±1% band) and any other value the
// oracle reports are stored VERBATIM — this layer never re-derives a price.
func TestApplyPricesRecordsOracleValueVerbatim(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	obs := []PriceObservation{
		po(200, 0xAA, testPollSource, 1_000_000, 6), // snapped stable: exactly 1e6
		po(200, 0xBB, testPollSource, 0, 6),         // zero: recorded + WARNed, never refused
		po(200, 0xCC, testPollSource, -5, 6),        // negative int256 answer: same posture
	}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, obs, 200)))
	rows := priceRows(t, s, 10)
	require.Equal(t, "1000000:6", rows["00000000000000000000000000000000000000aa/priceproviderv2@200"])
	require.Equal(t, "0:6", rows["00000000000000000000000000000000000000bb/priceproviderv2@200"])
	require.Equal(t, "-5:6", rows["00000000000000000000000000000000000000cc/priceproviderv2@200"])
}

// An identical replay is a no-op; the cursor may re-land on the same block.
func TestApplyPricesIdempotentReplay(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	obs := []PriceObservation{po(100, 0xAA, testPollSource, 999_999, 6)}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, obs, 100)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, obs, 100)), "identical replay is idempotent")

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM prices`).Scan(&count))
	require.Equal(t, 1, count)
}

// A DIVERGENT value under an existing key aborts the WHOLE batch — a recorded
// price fact is never overwritten, and the batch's other rows do not sneak in.
func TestApplyPricesDivergentValueAbortsWholeBatch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1_000_000, 6)}, 100)))

	_, err := s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(150, 0xBB, testPollSource, 5, 6),         // fresh row, must NOT land
		po(100, 0xAA, testPollSource, 1_000_001, 6), // divergent replay
	}, 150)
	require.ErrorContains(t, err, "price divergence")

	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/priceproviderv2@100": "1000000:6",
	}, priceRows(t, s, 10), "rollback left only the original row")
	_, last, _ := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(100), last, "the cursor did not advance")
}

// The SCALE is part of a row's identity: the same digits at a different scale is
// a different price, not an idempotent replay.
func TestApplyPricesDivergentDecimalsAborts(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1_000_000, 6)}, 100)))
	_, err := s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1_000_000, 8)}, 100)
	require.ErrorContains(t, err, "price divergence")
	require.ErrorContains(t, err, "(6 dec)")
}

// An observation above the batch's through-block would live outside the cursor's
// coverage and survive a rewind that targets the cursor.
func TestApplyPricesRefusesObservationAboveThroughBlock(t *testing.T) {
	s := testDeriveStore(t)
	_, err := s.ApplyPrices(context.Background(), testPollEngine, 10,
		[]PriceObservation{po(101, 0xAA, testPollSource, 1, 6)}, 100)
	require.ErrorContains(t, err, "above the batch through-block")
}

func TestApplyPricesValidation(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	nilPrice := po(100, 0xAA, testPollSource, 1, 6)
	nilPrice.Price = nil
	require.ErrorContains(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{nilPrice}, 100)), "nil price")

	noSource := po(100, 0xAA, "", 1, 6)
	require.ErrorContains(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{noSource}, 100)), "empty source")

	shortAsset := po(100, 0xAA, testPollSource, 1, 6)
	shortAsset.Asset = []byte{0xAA}
	require.ErrorContains(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{shortAsset}, 100)), "want a 20-byte address")

	require.ErrorContains(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, -1)}, 100)), "price decimals")
	require.ErrorContains(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 99)}, 100)), "price decimals")

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM prices`).Scan(&count))
	require.Zero(t, count, "validation runs before any write")
}

// An empty batch still advances the cursor: the cursor is a reorg-ack anchor,
// and letting an all-oracles-reverted round stall it would wedge the epoch gate.
func TestApplyPricesEmptyBatchAdvancesCursor(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, nil, 500)))
	_, last, _ := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(500), last)
}

// A through-block behind the recorded cursor is refused with
// ErrDeriveCursorRegression — the store-side detection of a frozen RPC endpoint
// that the poller routes around.
func TestApplyPricesCursorRegression(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1, 6)}, 500)))

	_, err := s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(400, 0xAA, testPollSource, 2, 6)}, 400)
	require.ErrorIs(t, err, ErrDeriveCursorRegression)
	require.Equal(t, 1, len(priceRows(t, s, 10)), "the stale round's row rolled back with the cursor refusal")
}

// Equal is admitted (a replayed round at the same block converges).
func TestApplyPricesSameBlockReadmitted(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1, 6)}, 500)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1, 6)}, 500)))
}

func TestApplyPricesChainMismatch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)))
	_, err := s.ApplyPrices(ctx, testPollEngine, 1,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)
}

// The epoch gate: an unacknowledged reorg epoch refuses every price batch until
// RewindPrices acks it.
func TestApplyPricesEpochGate(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)))
	// A walker rewind records a chain-wide epoch.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 95, []byte{0x95}))

	_, err := s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(120, 0xAA, testPollSource, 2, 6)}, 120)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
	require.ErrorContains(t, err, "rewind prices before applying")

	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 100, 0))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(120, 0xAA, testPollSource, 2, 6)}, 120)), "admitted after the ack")
}

// A price writer with NO cursor on a chain that already carries epochs must
// bootstrap through RewindPrices — the same hole ApplyDerived closes for a new
// derive engine.
func TestApplyPricesBootstrapRefusedOnEpochChain(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 95, []byte{0x95}))

	_, err := s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
	require.ErrorContains(t, err, "bootstrap via RewindPrices")

	// Bootstrap at block 0: nothing of this writer's exists to delete.
	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 0, 0))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)))
}

// RewindPrices deletes ONLY the caller's own sources above the target, in the
// same transaction as the ack: another writer's rows on the same chain survive.
func TestRewindPricesDeletesOnlyOwnSources(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Two writers on chain 1: the feed deriver and the ETH ratio poller.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1, []PriceObservation{
		po(100, 0xAA, testFeedSource, 99_990_000, 8),
		po(150, 0xAA, testFeedSource, 100_010_000, 8),
	}, 150)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:poll:1", 1, []PriceObservation{
		po(120, 0xBB, testRatioSrc, 1_060_000_000_000_000_000, 18),
		po(160, 0xBB, testRatioSrc, 1_060_100_000_000_000_000, 18),
	}, 160)))

	require.NoError(t, s.RewindPrices(ctx, testFeedEngine, 1, 120, 0))

	rows := priceRows(t, s, 1)
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@100": "99990000:8",
		"00000000000000000000000000000000000000bb/" + testRatioSrc + "@120":   "1060000000000000000:18",
		"00000000000000000000000000000000000000bb/" + testRatioSrc + "@160":   "1060100000000000000:18",
	}, rows, "only the feed engine's row above 120 was deleted")

	_, last, _ := cursorState(t, s, testFeedEngine)
	require.Equal(t, uint64(120), last)
	_, otherLast, _ := cursorState(t, s, "prices:poll:1")
	require.Equal(t, uint64(160), otherLast, "the other writer's cursor is untouched")
}

// A rewind's deletion reaches the DEEPEST unacknowledged epoch, not the caller's
// target: acking every epoch while only deleting to a shallower block would
// bless rows for blocks the raw rewind already removed.
func TestRewindPricesLowersToDeepestUnackedEpoch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(60, 0xAA, testPollSource, 1, 6),
		po(70, 0xAA, testPollSource, 2, 6),
		po(90, 0xAA, testPollSource, 3, 6),
	}, 90)))
	// Stacked epochs: rewound to 50, then to 80.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 50, []byte{0x50}))
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 80, []byte{0x80}))

	// Caller passes its cursor (90) and no verified floor; the store must lower
	// the target to 50.
	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 90, 0))
	require.Empty(t, priceRows(t, s, 10), "every row above 50 is gone")
	_, last, acked := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(50), last)

	var maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 10`).Scan(&maxEpoch))
	require.Equal(t, maxEpoch, acked, "the ack reaches the chain's max epoch")
}

func TestRewindPricesChainMismatch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)))
	err := s.RewindPrices(ctx, testPollEngine, 1, 100, 0)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)
	require.Equal(t, 1, len(priceRows(t, s, 10)), "nothing was deleted before the refusal")
}

// A writer that owns no row acks without deleting anything, and must still be
// able to bootstrap.
func TestRewindPricesWithNoOwnedRowsStillAcks(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 95, []byte{0x95}))
	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 0, 0))
	_, last, acked := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(0), last)
	require.Greater(t, acked, int64(0))
}

// M4 (the accepted resolution's obligation): because the price writers hold
// derive cursors, PruneAckedReorgEpochs must wait for THEM too — an epoch a
// derive engine has acked but a price writer has not must survive.
func TestPruneAckedReorgEpochsWaitsForPriceCursor(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// A derive engine and a price writer, both bound to chain 10.
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(100, 0xAA, testPollSource, 1, 6)}, 100)))

	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 95, []byte{0x95}))

	// Only the derive engine acks.
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 100))
	pruned, err := s.PruneAckedReorgEpochs(ctx)
	require.NoError(t, err)
	require.Zero(t, pruned, "the epoch is held for the price cursor that has not acked")

	var remaining int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM reorg_epochs`).Scan(&remaining))
	require.Equal(t, 1, remaining)

	// Now the price writer acks too.
	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 100, 0))
	pruned, err = s.PruneAckedReorgEpochs(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(1), pruned, "both cursors acked: the epoch is prunable")
}

// Two writers with distinct pseudo-engine keys on the SAME chain keep separate
// cursors — the reason the keys are colon-namespaced and chain-qualified.
func TestPriceCursorsAreIndependentPerWriter(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1,
		[]PriceObservation{po(100, 0xAA, testFeedSource, 1, 8)}, 100)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:poll:1", 1,
		[]PriceObservation{po(200, 0xBB, testRatioSrc, 1, 18)}, 200)))

	_, feedLast, _ := cursorState(t, s, testFeedEngine)
	_, pollLast, _ := cursorState(t, s, "prices:poll:1")
	require.Equal(t, uint64(100), feedLast)
	require.Equal(t, uint64(200), pollLast)

	// And neither collides with a derive engine's cursor.
	require.NoError(t, s.ApplyDerived(ctx, "aave_v3_etherfi", 1,
		[]PositionEvent{{ChainID: 1, Engine: "aave_v3_etherfi", BlockNumber: 300,
			TxHash: []byte{0x09}, EventType: "test", Account: []byte{0x01},
			Asset: []byte{0x02}, Side: "debt", Delta: big.NewInt(7)}}, 300))
	_, engineLast, _ := cursorState(t, s, "aave_v3_etherfi")
	require.Equal(t, uint64(300), engineLast)
	_, feedLast, _ = cursorState(t, s, testFeedEngine)
	require.Equal(t, uint64(100), feedLast, "the derive engine's apply did not move the feed cursor")
}
