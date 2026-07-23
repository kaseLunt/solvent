package store

// Live-db tests for the Task 7 additive runner/snapshotter support methods:
// RawLogsInRange, HasUnackedReorg, PruneAckedReorgEpochs,
// DeleteRateIndexesAbove, SnapshotAccounts, SaveSnapshot, CheckWriterLock.
// Same harness (testDeriveStore) and NUMERIC/BYTEA discipline as
// derive_test.go.

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestRawLogsInRangeFiltersAndOrders: the windowed read returns only the
// requested chain + address set + block range, ordered by
// (block_number, log_index) — the runner's serial derivation order.
func TestRawLogsInRangeFiltersAndOrders(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	mk := func(block uint64, logIndex uint32, addr byte, tx byte) RawLog {
		return RawLog{
			ChainID: 10, BlockNumber: block, BlockHash: []byte{0xbb, byte(block)},
			TxHash: []byte{0x77, tx}, LogIndex: logIndex, Address: []byte{addr},
			Topics: [][]byte{{0x01}, {0x02}}, Data: []byte{0x03, 0x04},
		}
	}
	logs := []RawLog{
		mk(100, 5, 0xA1, 1),
		mk(100, 2, 0xA1, 2), // same block, lower log index: must sort first
		mk(101, 0, 0xA2, 3), // second engine address
		mk(101, 1, 0xF0, 4), // OUTSIDE the address set: excluded
		mk(102, 0, 0xA1, 5), // outside the block range: excluded
	}
	otherChain := RawLog{ChainID: 99, BlockNumber: 100, BlockHash: []byte{0xcc},
		TxHash: []byte{0x78}, LogIndex: 0, Address: []byte{0xA1},
		Topics: [][]byte{{0x01}}, Data: []byte{0x05}}
	require.NoError(t, s.SaveBatch(ctx, "s1", 10, logs, 102, []byte{0xbb, 102}))
	require.NoError(t, s.SaveBatch(ctx, "s2", 99, []RawLog{otherChain}, 100, []byte{0xcc}))

	got, err := s.RawLogsInRange(ctx, 10, [][]byte{{0xA1}, {0xA2}}, 100, 101)
	require.NoError(t, err)
	require.Equal(t, []RawLog{logs[1], logs[0], logs[2]}, got)

	// Empty range: no rows, no error.
	got, err = s.RawLogsInRange(ctx, 10, [][]byte{{0xA1}}, 500, 600)
	require.NoError(t, err)
	require.Empty(t, got)
}

// TestHasUnackedReorgLifecycle pins the proactive check against the full
// epoch lifecycle: no epochs, then a recorded epoch (true, including for a
// cursor-less engine — the bootstrap case), then RewindDerived acks (false),
// then a second rewind re-arms it.
func TestHasUnackedReorgLifecycle(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	unacked, err := s.HasUnackedReorg(ctx, engine, 10)
	require.NoError(t, err)
	require.False(t, unacked, "no epochs: nothing to ack")

	// Engine applies, then the chain rewinds (epoch recorded).
	require.NoError(t, s.ApplyDerived(ctx, engine, 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 5)}, 100))
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 90, []byte{0x01}))

	unacked, err = s.HasUnackedReorg(ctx, engine, 10)
	require.NoError(t, err)
	require.True(t, unacked, "recorded epoch not yet acked")

	// A cursor-less engine on the same chain is unacked by definition
	// (bootstrap gate).
	unacked, err = s.HasUnackedReorg(ctx, "aave_v3_etherfi", 10)
	require.NoError(t, err)
	require.True(t, unacked, "no-cursor engine on an epoch-carrying chain must bootstrap")

	// RewindDerived acks.
	require.NoError(t, s.RewindDerived(ctx, engine, 10, 90))
	unacked, err = s.HasUnackedReorg(ctx, engine, 10)
	require.NoError(t, err)
	require.False(t, unacked, "RewindDerived acked the epoch")

	// A later rewind re-arms the check.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 80, []byte{0x02}))
	unacked, err = s.HasUnackedReorg(ctx, engine, 10)
	require.NoError(t, err)
	require.True(t, unacked)
}

// TestPruneAckedReorgEpochs: an epoch is deletable only once EVERY engine on
// its chain has acked it; chains with no derive cursor keep their epochs.
func TestPruneAckedReorgEpochs(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Two engines on chain 10, plus one orphan epoch on cursor-less chain 99.
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 5)}, 100))
	e2 := pe(100, 2, 0xAA, 0xBB, "debt", 7)
	e2.Engine = "engine_b"
	require.NoError(t, s.ApplyDerived(ctx, "engine_b", 10, []PositionEvent{e2}, 100))
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 90, []byte{0x01}))
	require.NoError(t, s.Rewind(ctx, "other:stream", 99, 50, []byte{0x02}))

	// Only debt_manager acks: nothing on chain 10 is prunable yet.
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 90))
	n, err := s.PruneAckedReorgEpochs(ctx)
	require.NoError(t, err)
	require.Zero(t, n, "engine_b has not acked; the epoch must survive")

	// engine_b acks too: chain 10's epoch becomes prunable; chain 99's
	// cursor-less epoch is kept.
	require.NoError(t, s.RewindDerived(ctx, "engine_b", 10, 90))
	n, err = s.PruneAckedReorgEpochs(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(1), n)

	var remaining int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM reorg_epochs`).Scan(&remaining))
	require.Equal(t, 1, remaining, "chain 99's cursor-less epoch is retained")
	var chain uint64
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT chain_id FROM reorg_epochs`).Scan(&chain))
	require.Equal(t, uint64(99), chain)
}

// TestDeleteRateIndexesAbove: only the named engine's rows above the block
// go, and the divergence poison the delete exists to prevent is gone after.
func TestDeleteRateIndexesAbove(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.SaveRateIndex(ctx, "debt_manager", []byte{0xBB}, 100, "borrow_index", big.NewInt(1)))
	require.NoError(t, s.SaveRateIndex(ctx, "debt_manager", []byte{0xBB}, 101, "borrow_index", big.NewInt(2)))
	require.NoError(t, s.SaveRateIndex(ctx, "aave_v3_etherfi", []byte{0xCC}, 101, "liquidity_index", big.NewInt(3)))

	require.NoError(t, s.DeleteRateIndexesAbove(ctx, "debt_manager", 100))

	v, block, found, err := s.LatestRateIndex(ctx, "debt_manager", []byte{0xBB}, 200, "borrow_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(1), v)
	require.Equal(t, uint64(100), block)

	// A post-reorg re-derivation may observe a DIFFERENT value at the same
	// key; after the delete, re-saving succeeds instead of being refused.
	require.NoError(t, s.SaveRateIndex(ctx, "debt_manager", []byte{0xBB}, 101, "borrow_index", big.NewInt(9)))

	// The other engine's row above the block is untouched.
	v, _, found, err = s.LatestRateIndex(ctx, "aave_v3_etherfi", []byte{0xCC}, 200, "liquidity_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(3), v)
}

// TestSnapshotAccountsRegistryAndPriority: distinct debt-side accounts from
// position_events, nonzero-debt accounts first, bytewise within each group.
func TestSnapshotAccountsRegistryAndPriority(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	// 0xA1: borrowed then fully repaid (zero balance, row persists).
	// 0xA2, 0xA3: nonzero debt. 0xA4: collateral-side only — NOT in the debt
	// registry.
	events := []PositionEvent{
		pe(100, 1, 0xA1, 0xBB, "debt", 40),
		pe(101, 2, 0xA1, 0xBB, "debt", -40),
		pe(100, 3, 0xA3, 0xBB, "debt", 10),
		pe(100, 4, 0xA2, 0xBB, "debt", 25),
		pe(100, 5, 0xA4, 0xBB, "collateral", 7),
	}
	require.NoError(t, s.ApplyDerived(ctx, engine, 10, events, 101))

	got, err := s.SnapshotAccounts(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA2}, {0xA3}, {0xA1}}, got,
		"nonzero-debt accounts first (bytewise), zero-balance account last, collateral-only account absent")

	// Another engine's events never leak into this registry.
	other := pe(100, 6, 0xA9, 0xBB, "debt", 3)
	other.Engine = "engine_b"
	require.NoError(t, s.ApplyDerived(ctx, "engine_b", 10, []PositionEvent{other}, 100))
	got, err = s.SnapshotAccounts(ctx, engine)
	require.NoError(t, err)
	require.Len(t, got, 3)
}

// TestSaveSnapshotRoundTripAndReplace: JSONB decimal-string shape, uint256
// extremes exact, and same-key replacement (a replayed round converges).
func TestSaveSnapshotRoundTripAndReplace(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	account := []byte{0xAA}

	huge, ok := new(big.Int).SetString("115792089237316195423570985008687907853269984665640564039457584007913129639935", 10)
	require.True(t, ok)
	require.NoError(t, s.SaveSnapshot(ctx, engine, account, 100, map[string]map[string]*big.Int{
		"bb": {"debt": huge},
		"cc": {"collateral": big.NewInt(-7)},
	}))

	var doc map[string]map[string]string
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, account).Scan(&doc))
	require.Equal(t, map[string]map[string]string{
		"bb": {"debt": huge.String()},
		"cc": {"collateral": "-7"},
	}, doc)

	// Same-key replace.
	require.NoError(t, s.SaveSnapshot(ctx, engine, account, 100, map[string]map[string]*big.Int{
		"bb": {"debt": big.NewInt(1)},
	}))
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, account).Scan(&doc))
	require.Equal(t, map[string]map[string]string{"bb": {"debt": "1"}}, doc)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM snapshots`).Scan(&n))
	require.Equal(t, 1, n)

	// Refusals: nil amount, malformed asset key.
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101,
		map[string]map[string]*big.Int{"bb": {"debt": nil}}), "nil amount")
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101,
		map[string]map[string]*big.Int{"zz": {"debt": big.NewInt(1)}}), "asset key")
}

// TestApplyDerivedWithRatesCommitsAtomically: the happy path lands events,
// balances, cursor AND rate rows in one commit; an identical full replay
// (events + rates) is a no-op.
func TestApplyDerivedWithRatesCommitsAtomically(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	events := []PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 40)}
	rates := []RateObservation{
		{Asset: []byte{0xBB}, Block: 100, Kind: "borrow_index", Value: big.NewInt(111)},
		{Asset: []byte{0xCC}, Block: 100, Kind: "liquidity_index", Value: big.NewInt(222)},
	}
	require.NoError(t, s.ApplyDerivedWithRates(ctx, engine, 10, events, rates, 100))

	v, block, found, err := s.LatestRateIndex(ctx, engine, []byte{0xBB}, 200, "borrow_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(111), v)
	require.Equal(t, uint64(100), block)
	cur, found, err := s.DeriveCursor(ctx, engine)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), cur)

	// Identical replay (re-derived window): events AND rates are no-ops.
	require.NoError(t, s.ApplyDerivedWithRates(ctx, engine, 10, events, rates, 100))
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM rate_indexes`).Scan(&n))
	require.Equal(t, 2, n)

	// Nil rate value is refused before any transaction.
	require.ErrorContains(t, s.ApplyDerivedWithRates(ctx, engine, 10, nil,
		[]RateObservation{{Asset: []byte{0xBB}, Block: 101, Kind: "borrow_index"}}, 101), "nil value")
}

// TestApplyDerivedWithRatesRollbackLeavesNoRateRows is the named
// apply-rollback-with-real-state failure injection: a clean ApplyDerived
// failure (divergent event replay, detected AFTER the rate rows were written
// inside the transaction) must roll the rate rows back with everything else.
func TestApplyDerivedWithRatesRollbackLeavesNoRateRows(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	require.NoError(t, s.ApplyDerived(ctx, engine, 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 40)}, 100))

	// Same PK, divergent delta → the whole batch aborts.
	divergent := pe(100, 1, 0xAA, 0xBB, "debt", 41)
	err := s.ApplyDerivedWithRates(ctx, engine, 10, []PositionEvent{divergent},
		[]RateObservation{{Asset: []byte{0xBB}, Block: 101, Kind: "borrow_index", Value: big.NewInt(9)}}, 101)
	require.ErrorContains(t, err, "divergent replay")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM rate_indexes`).Scan(&n))
	require.Zero(t, n, "the aborted window's rate rows must not survive the rollback")
	cur, _, err := s.DeriveCursor(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(100), cur, "cursor must not advance on an aborted window")
}

// TestApplyDerivedWithRatesDivergentRateAbortsEverything: a divergent rate
// value under an existing key aborts the window — events, balances and cursor
// all roll back and the original rate row survives untouched.
func TestApplyDerivedWithRatesDivergentRateAbortsEverything(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	require.NoError(t, s.SaveRateIndex(ctx, engine, []byte{0xBB}, 100, "borrow_index", big.NewInt(111)))

	err := s.ApplyDerivedWithRates(ctx, engine, 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 40)},
		[]RateObservation{{Asset: []byte{0xBB}, Block: 100, Kind: "borrow_index", Value: big.NewInt(999)}}, 100)
	require.ErrorContains(t, err, "divergence")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM position_events`).Scan(&n))
	require.Zero(t, n, "events of a rate-divergent window must not land")
	_, found, err := s.DeriveCursor(ctx, engine)
	require.NoError(t, err)
	require.False(t, found, "cursor must not be created by an aborted window")
	v, _, found, err := s.LatestRateIndex(ctx, engine, []byte{0xBB}, 200, "borrow_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(111), v, "the original observation survives the refused batch")
}

// TestRewindDerivedDeletesRateIndexesTransactionally: rate hygiene lives
// INSIDE RewindDerived — rows above the effective target go with the same
// commit that acks (never a separable follow-up call), the effective target
// honors deepest-unacked-epoch lowering, and other engines are untouched.
func TestRewindDerivedDeletesRateIndexesTransactionally(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	require.NoError(t, s.ApplyDerivedWithRates(ctx, engine, 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 40)},
		[]RateObservation{
			{Asset: []byte{0xBB}, Block: 95, Kind: "borrow_index", Value: big.NewInt(1)},
			{Asset: []byte{0xBB}, Block: 100, Kind: "borrow_index", Value: big.NewInt(2)},
		}, 100))
	require.NoError(t, s.SaveRateIndex(ctx, "aave_v3_etherfi", []byte{0xCC}, 100, "liquidity_index", big.NewInt(3)))

	// A raw rewind to 90 records an epoch DEEPER than the caller's target:
	// the effective target (90) governs the rate deletion too.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 90, []byte{0x01}))
	require.NoError(t, s.RewindDerived(ctx, engine, 10, 100))

	v, block, found, err := s.LatestRateIndex(ctx, engine, []byte{0xBB}, 200, "borrow_index")
	require.NoError(t, err)
	require.False(t, found, "every observation above the EFFECTIVE target (90) must be gone, got %s@%d", v, block)

	// The divergence poison is gone: a post-reorg re-derivation observing a
	// DIFFERENT value at the same key re-records cleanly.
	require.NoError(t, s.SaveRateIndex(ctx, engine, []byte{0xBB}, 100, "borrow_index", big.NewInt(7)))

	// The other engine's row is untouched (per-engine hygiene).
	v, _, found, err = s.LatestRateIndex(ctx, "aave_v3_etherfi", []byte{0xCC}, 200, "liquidity_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(3), v)
}

// TestSaveSnapshotsBulkRoundTripAndReplace: the bulk writer lands one
// side-scoped JSONB document per account in one transaction, and a re-save of
// the same (engine, account, block) key replaces wholesale.
func TestSaveSnapshotsBulkRoundTripAndReplace(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	huge, ok := new(big.Int).SetString("115792089237316195423570985008687907853269984665640564039457584007913129639935", 10)
	require.True(t, ok)
	require.NoError(t, s.SaveSnapshots(ctx, engine, 100, map[string]SnapshotDoc{
		"aa": {Side: "debt", Balances: map[string]*big.Int{"bb": huge}},
		"ac": {Side: "debt", Balances: map[string]*big.Int{}},
	}))

	var doc map[string]any
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, []byte{0xAA}).Scan(&doc))
	require.Equal(t, map[string]any{
		"side":     "debt",
		"balances": map[string]any{"bb": huge.String()},
	}, doc, "side marker + uint256-exact decimal strings")

	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, []byte{0xAC}).Scan(&doc))
	require.Equal(t, map[string]any{"side": "debt", "balances": map[string]any{}}, doc,
		"an empty side-scoped document is a valid zero-position snapshot")

	// Same-key replace, still one row per account.
	require.NoError(t, s.SaveSnapshots(ctx, engine, 100, map[string]SnapshotDoc{
		"aa": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(1)}},
	}))
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, []byte{0xAA}).Scan(&doc))
	require.Equal(t, map[string]any{"side": "debt", "balances": map[string]any{"bb": "1"}}, doc)

	// Refusals: empty side, bad account key, bad asset key, nil amount.
	require.ErrorContains(t, s.SaveSnapshots(ctx, engine, 101,
		map[string]SnapshotDoc{"aa": {Balances: map[string]*big.Int{}}}), "side")
	require.ErrorContains(t, s.SaveSnapshots(ctx, engine, 101,
		map[string]SnapshotDoc{"zz": {Side: "debt"}}), "account key")
	require.ErrorContains(t, s.SaveSnapshots(ctx, engine, 101,
		map[string]SnapshotDoc{"aa": {Side: "debt", Balances: map[string]*big.Int{"zz": big.NewInt(1)}}}), "asset key")
	require.ErrorContains(t, s.SaveSnapshots(ctx, engine, 101,
		map[string]SnapshotDoc{"aa": {Side: "debt", Balances: map[string]*big.Int{"bb": nil}}}), "nil amount")
}

// TestSaveSnapshotsCancelLeavesNoPartialRows is the named
// partial-snapshot-cancel failure injection: a context canceled mid-write
// must leave ZERO rows — the bulk write is one transaction, so history never
// shows half a round.
func TestSaveSnapshotsCancelLeavesNoPartialRows(t *testing.T) {
	s := testDeriveStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // canceled before the batch can commit

	docs := map[string]SnapshotDoc{}
	for i := 0; i < 50; i++ {
		docs[hex.EncodeToString([]byte{byte(i + 1)})] = SnapshotDoc{
			Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(int64(i))},
		}
	}
	require.Error(t, s.SaveSnapshots(ctx, "debt_manager", 100, docs))

	var n int
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM snapshots`).Scan(&n))
	require.Zero(t, n, "a canceled bulk write must be all-or-nothing")
}

// TestRecordSnapshotSweepStates pins the three-way disambiguation: success
// stamps attempt+success blocks, failure stamps attempt only (retaining the
// last success block), status always reflects the LAST attempt, and an
// account never attempted has no row at all.
func TestRecordSnapshotSweepStates(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	a1, a2 := []byte{0xA1}, []byte{0xA2}

	readRow := func(account []byte) (attempt, success uint64, status string, found bool) {
		err := s.pool.QueryRow(ctx,
			`SELECT last_attempt_block, last_success_block, status FROM snapshot_sweeps
			 WHERE engine = $1 AND account = $2`, engine, account).Scan(&attempt, &success, &status)
		if err != nil {
			return 0, 0, "", false
		}
		return attempt, success, status, true
	}

	// Batch 1 at block 100: a1 fails (never succeeded), a2 succeeds with
	// ZERO collateral — its success row is what distinguishes "swept and
	// empty" from "never swept".
	require.NoError(t, s.RecordSnapshotSweep(ctx, engine, 100, []SweepOutcome{
		{Account: a1, Success: false},
		{Account: a2, Success: true},
	}))
	attempt, success, status, found := readRow(a1)
	require.True(t, found)
	require.Equal(t, [3]any{uint64(100), uint64(0), "failed"}, [3]any{attempt, success, status})
	attempt, success, status, found = readRow(a2)
	require.True(t, found)
	require.Equal(t, [3]any{uint64(100), uint64(100), "success"}, [3]any{attempt, success, status})

	// Batch 2 at block 200: a1 recovers, a2 now fails — its last success
	// block survives so staleness is measurable.
	require.NoError(t, s.RecordSnapshotSweep(ctx, engine, 200, []SweepOutcome{
		{Account: a1, Success: true},
		{Account: a2, Success: false},
	}))
	attempt, success, status, _ = readRow(a1)
	require.Equal(t, [3]any{uint64(200), uint64(200), "success"}, [3]any{attempt, success, status})
	attempt, success, status, _ = readRow(a2)
	require.Equal(t, [3]any{uint64(200), uint64(100), "failed"}, [3]any{attempt, success, status})

	// Never-attempted account: no row.
	_, _, _, found = readRow([]byte{0xA9})
	require.False(t, found, "never-swept means NO row, not a zero row")

	// Empty outcome set and empty account are refused/no-ops.
	require.NoError(t, s.RecordSnapshotSweep(ctx, engine, 300, nil))
	require.ErrorContains(t, s.RecordSnapshotSweep(ctx, engine, 300,
		[]SweepOutcome{{Account: nil, Success: true}}), "empty account")
}

// TestCheckWriterLockLivenessAndLoss: before acquisition the check refuses;
// while held it passes; after a server-side release on the SAME session it
// reports the lock lost.
func TestCheckWriterLockLivenessAndLoss(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	require.ErrorContains(t, s.CheckWriterLock(ctx), "no pinned lock session")

	require.NoError(t, s.AcquireWriterLock(ctx))
	require.NoError(t, s.CheckWriterLock(ctx))

	// Simulate loss without killing the session: release the advisory lock
	// on the lock's own connection.
	var released bool
	require.NoError(t, s.writerConn.QueryRow(ctx,
		`SELECT pg_advisory_unlock($1)`, writerLockKey).Scan(&released))
	require.True(t, released)

	require.ErrorContains(t, s.CheckWriterLock(ctx), "writer lock lost")
}
