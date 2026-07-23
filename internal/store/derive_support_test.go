package store

// Live-db tests for the Task 7 additive runner/snapshotter support methods,
// the fix wave's transactional additions, and the sweep-durability wave's
// durable generation machinery: RawLogsInRange, HasUnackedReorg,
// PruneAckedReorgEpochs, SnapshotAccounts, SaveSnapshot (single-side
// enforced), CheckWriterLock, ApplyDerivedWithRates (window/rate atomicity),
// RewindDerived's in-transaction rate hygiene + orphaned-snapshot
// invalidation + generation bump, SaveSnapshots (bulk side-scoped documents),
// and the sweep-generation queue (SweepGeneration/OpenSweepGeneration/
// SweepWorkBatch/CompleteSweepGeneration/ApplySweepBatch). Same harness
// (testDeriveStore) and NUMERIC/BYTEA discipline as derive_test.go.

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

// TestSaveSnapshotRoundTripAndReplace: side-scoped JSONB decimal-string shape
// (the same {"side": s, "balances": {...}} document SaveSnapshots writes),
// uint256 extremes exact, same-key replacement (a replayed round converges) —
// and the sweep-durability wave's ENFORCED single-side rule: a mixed-side
// document is refused outright (a snapshots row claims one as-of block, and
// the two sides of a debt_manager position are observed at different blocks).
func TestSaveSnapshotRoundTripAndReplace(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	account := []byte{0xAA}

	huge, ok := new(big.Int).SetString("115792089237316195423570985008687907853269984665640564039457584007913129639935", 10)
	require.True(t, ok)
	require.NoError(t, s.SaveSnapshot(ctx, engine, account, 100, map[string]map[string]*big.Int{
		"bb": {"debt": huge},
		"cc": {"debt": big.NewInt(-7)},
	}))

	var doc map[string]any
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, account).Scan(&doc))
	require.Equal(t, map[string]any{
		"side":     "debt",
		"balances": map[string]any{"bb": huge.String(), "cc": "-7"},
	}, doc)

	// Same-key replace.
	require.NoError(t, s.SaveSnapshot(ctx, engine, account, 100, map[string]map[string]*big.Int{
		"bb": {"debt": big.NewInt(1)},
	}))
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, account).Scan(&doc))
	require.Equal(t, map[string]any{"side": "debt", "balances": map[string]any{"bb": "1"}}, doc)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM snapshots`).Scan(&n))
	require.Equal(t, 1, n)

	// MIXED-SIDE REFUSAL (was accepted pre-wave, storing a document that lied
	// about its as-of block): debt and collateral in one document error, and
	// nothing is written.
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101, map[string]map[string]*big.Int{
		"bb": {"debt": big.NewInt(5)},
		"cc": {"collateral": big.NewInt(9)},
	}), "mixes sides")
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM snapshots WHERE block_number = 101`).Scan(&n))
	require.Zero(t, n, "a refused mixed-side document must write nothing")

	// Other refusals: nil amount, malformed asset key, empty document (no
	// side derivable — SaveSnapshots carries the side explicitly for those).
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101,
		map[string]map[string]*big.Int{"bb": {"debt": nil}}), "nil amount")
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101,
		map[string]map[string]*big.Int{"zz": {"debt": big.NewInt(1)}}), "asset key")
	require.ErrorContains(t, s.SaveSnapshot(ctx, engine, account, 101,
		map[string]map[string]*big.Int{}), "no side can be derived")
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

// NOTE: TestRecordSnapshotSweepStates was retired with RecordSnapshotSweep —
// the block-stamp/status/staleness transitions it pinned are covered (at the
// atomic ApplySweepBatch API that replaced it) by TestApplySweepBatchLifecycle.

// TestSweepGenerationLifecycle pins the durable generation state machine:
// never-opened → open (increment, completed_at cleared) → guarded completion
// (stamps only the CURRENT open generation; a superseded or repeated stamp
// reports stamped=false) → reopen increments again.
func TestSweepGenerationLifecycle(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	gen, open, completedAt, err := s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, [3]any{uint64(0), false, true}, [3]any{gen, open, completedAt.IsZero()},
		"never opened: generation 0, closed, no completion time")

	gen, err = s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(1), gen)
	gen, open, completedAt, err = s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.True(t, open, "an opened generation reads back OPEN — the restart-resume signal")
	require.Equal(t, uint64(1), gen)
	require.True(t, completedAt.IsZero())

	// Guarded completion: the wrong generation number stamps nothing.
	failed, stamped, err := s.CompleteSweepGeneration(ctx, engine, 99)
	require.NoError(t, err)
	require.False(t, stamped, "a non-current generation must not stamp completion")
	require.Zero(t, failed)

	failed, stamped, err = s.CompleteSweepGeneration(ctx, engine, 1)
	require.NoError(t, err)
	require.True(t, stamped)
	require.Zero(t, failed)
	gen, open, completedAt, err = s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.False(t, open)
	require.Equal(t, uint64(1), gen)
	require.False(t, completedAt.IsZero(), "completion stamps the cadence anchor")

	// A repeated stamp is a no-op (stamped=false), and reopening increments.
	_, stamped, err = s.CompleteSweepGeneration(ctx, engine, 1)
	require.NoError(t, err)
	require.False(t, stamped)
	gen, err = s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(2), gen)
	_, open, completedAt, err = s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.True(t, open)
	require.True(t, completedAt.IsZero(), "reopening clears the completion stamp")
}

// TestSweepWorkBatchOrderingAndRetryBudget pins the durable queue read:
// lagging accounts (no row / older generation) drain oldest-first before
// current-generation failed retries; nonzero-debt accounts lead within a
// bucket; stamped-current successes and budget-exhausted failures owe
// nothing; the limit bounds one batch.
func TestSweepWorkBatchOrderingAndRetryBudget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	maxAttempts := 4 // 1 fresh + 3 retries, the snapshotter's budget

	// Registry: a1 (debt repaid to zero), a2/a3 (nonzero debt) — priority
	// order is a2, a3, a1 (nonzero-debt first, bytewise within groups).
	require.NoError(t, s.ApplyDerived(ctx, engine, 10, []PositionEvent{
		pe(100, 1, 0xA1, 0xBB, "debt", 40),
		pe(101, 2, 0xA1, 0xBB, "debt", -40),
		pe(100, 3, 0xA3, 0xBB, "debt", 10),
		pe(100, 4, 0xA2, 0xBB, "debt", 25),
	}, 101))

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)

	// Fresh generation: every account lags, priority order, limit respected.
	got, err := s.SweepWorkBatch(ctx, engine, gen, maxAttempts, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA2}, {0xA3}, {0xA1}}, got)
	got, err = s.SweepWorkBatch(ctx, engine, gen, maxAttempts, 2)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA2}, {0xA3}}, got, "the limit bounds one batch")

	// a2 succeeds, a3 fails: a3 stays in the work list (retry-eligible), a2
	// owes nothing, and the still-lagging a1 drains BEFORE a3's retry.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 500, []SweepResult{
		{Account: []byte{0xA2}, OK: true, Balances: map[string]map[string]*big.Int{}},
		{Account: []byte{0xA3}, OK: false},
	}))
	got, err = s.SweepWorkBatch(ctx, engine, gen, maxAttempts, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA1}, {0xA3}}, got,
		"lagging accounts drain before current-generation retries — oldest-first fairness")

	// a3 burns the whole budget: after maxAttempts failures it owes nothing
	// this generation (skipped, stays status=failed).
	for i := 0; i < maxAttempts-1; i++ {
		require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 501+uint64(i), []SweepResult{
			{Account: []byte{0xA3}, OK: false},
		}))
	}
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 600, []SweepResult{
		{Account: []byte{0xA1}, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	got, err = s.SweepWorkBatch(ctx, engine, gen, maxAttempts, 100)
	require.NoError(t, err)
	require.Empty(t, got, "budget-exhausted failures owe nothing: the generation is complete (degraded)")
	failed, stamped, err := s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)
	require.True(t, stamped)
	require.Equal(t, int64(1), failed, "the exhausted account is the DEGRADED signal")

	// A new generation re-lags everyone — including the exhausted account,
	// whose budget resets. Ordering now keys off the OLD stamps ascending
	// (all equal here), then priority.
	gen2, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	got, err = s.SweepWorkBatch(ctx, engine, gen2, maxAttempts, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA2}, {0xA3}, {0xA1}}, got)
}

// TestApplySweepBatchLifecycle pins the atomic per-batch write: wholesale
// snapshot-balance replacement + collateral-side history document at the
// multicall block + generation-stamped status rows with durable attempt
// counting; failures retain the last success block for staleness measurement.
func TestApplySweepBatchLifecycle(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	a1, a2 := []byte{0xA1}, []byte{0xA2}

	readRow := func(account []byte) (gen, attempts, attempt, success uint64, status string) {
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT generation, attempts, last_attempt_block, last_success_block, status
			 FROM snapshot_sweeps WHERE engine = $1 AND account = $2`, engine, account).
			Scan(&gen, &attempts, &attempt, &success, &status))
		return
	}

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 100, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{
			"bb": {"collateral": big.NewInt(555)},
			"cc": {"collateral": big.NewInt(7)},
		}},
		{Account: a2, OK: false},
	}))

	// Balances: wholesale snapshot rows at the multicall block.
	require.Equal(t, map[string]string{
		"bb/collateral": "555@100",
		"cc/collateral": "7@100",
	}, balanceRows(t, s, engine, a1, "snapshot"))
	// History: the side-scoped collateral document at the SAME block.
	var doc map[string]any
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		engine, a1).Scan(&doc))
	require.Equal(t, map[string]any{
		"side":     "collateral",
		"balances": map[string]any{"bb": "555", "cc": "7"},
	}, doc)
	// Status: generation-stamped, attempts counted.
	g, at, attempt, success, status := readRow(a1)
	require.Equal(t, []uint64{gen, 1, 100, 100}, []uint64{g, at, attempt, success})
	require.Equal(t, "success", status)
	g, at, attempt, success, status = readRow(a2)
	require.Equal(t, []uint64{gen, 1, 100, 0}, []uint64{g, at, attempt, success})
	require.Equal(t, "failed", status)

	// Second batch: a1 fails (keeps its success block), a2 recovers with an
	// EMPTY read — the wholesale replacement clears nothing (it had nothing)
	// but writes the zero-collateral history document, and its status flips.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 200, []SweepResult{
		{Account: a1, OK: false},
		{Account: a2, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	g, at, attempt, success, status = readRow(a1)
	require.Equal(t, []uint64{gen, 2, 200, 100}, []uint64{g, at, attempt, success},
		"a failure under the same generation increments attempts and retains the last success block")
	require.Equal(t, "failed", status)
	require.Equal(t, map[string]string{
		"bb/collateral": "555@100", "cc/collateral": "7@100",
	}, balanceRows(t, s, engine, a1, "snapshot"), "a failed attempt keeps the previous snapshot")
	g, at, attempt, success, status = readRow(a2)
	require.Equal(t, []uint64{gen, 2, 200, 200}, []uint64{g, at, attempt, success})
	require.Equal(t, "success", status)
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 200`,
		engine, a2).Scan(&doc))
	require.Equal(t, map[string]any{"side": "collateral", "balances": map[string]any{}}, doc,
		"zero-collateral success still writes its history document")

	// A NEW generation resets the attempts counter; a success replaces the
	// old snapshot wholesale (vanished assets clear).
	gen2, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 300, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{
			"dd": {"collateral": big.NewInt(9)},
		}},
	}))
	g, at, attempt, success, status = readRow(a1)
	require.Equal(t, []uint64{gen2, 1, 300, 300}, []uint64{g, at, attempt, success},
		"a new generation resets the attempts budget")
	require.Equal(t, "success", status)
	require.Equal(t, map[string]string{"dd/collateral": "9@300"},
		balanceRows(t, s, engine, a1, "snapshot"), "wholesale replacement: bb/cc vanish")

	// Refusals: empty account, non-collateral side, nil amount, empty batch OK.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 301, nil))
	require.ErrorContains(t, s.ApplySweepBatch(ctx, engine, gen2, 301,
		[]SweepResult{{Account: nil, OK: false}}), "empty account")
	require.ErrorContains(t, s.ApplySweepBatch(ctx, engine, gen2, 301, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{"bb": {"debt": big.NewInt(1)}}},
	}), "collateral-side only")
	require.ErrorContains(t, s.ApplySweepBatch(ctx, engine, gen2, 301, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{"bb": {"collateral": nil}}},
	}), "nil amount")
}

// TestApplySweepBatchMidTxFailureRollsBackEverything is the sweep-durability
// wave's REAL-boundary failure injection: the batch's FIRST result executes
// its full statement run (balance delete+insert, history upsert, status
// upsert) inside the transaction, then the SECOND result's inline validation
// aborts — validation is deliberately per-result, in statement order, so this
// failure genuinely happens MID-TRANSACTION after real writes. All three
// tables (position_balances, snapshots, snapshot_sweeps) must roll back to
// their pre-batch state: balances-without-status (or any partial subset) can
// never be observed, even across a crash at this exact point.
func TestApplySweepBatchMidTxFailureRollsBackEverything(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	a1, a2 := []byte{0xA1}, []byte{0xA2}

	// Pre-state: a1 already carries an older snapshot + status row, so the
	// rollback must also restore (not just empty) state.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 100, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{
			"bb": {"collateral": big.NewInt(555)},
		}},
	}))

	// The injected batch: result[0] (a1) is valid and fully executes — its
	// delete would remove the 555 row — then result[1] (a2) carries a nil
	// amount and aborts the transaction mid-flight.
	err = s.ApplySweepBatch(ctx, engine, gen, 200, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{
			"bb": {"collateral": big.NewInt(777)},
		}},
		{Account: a2, OK: true, Balances: map[string]map[string]*big.Int{
			"bb": {"collateral": nil},
		}},
	})
	require.ErrorContains(t, err, "nil amount")

	// position_balances: a1's PRE-batch snapshot survives verbatim (the
	// in-tx delete and 777 insert both rolled back); a2 has nothing.
	require.Equal(t, map[string]string{"bb/collateral": "555@100"},
		balanceRows(t, s, engine, a1, "snapshot"))
	require.Empty(t, balanceRows(t, s, engine, a2, "snapshot"))

	// snapshots: no block-200 history row for either account.
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE block_number = 200`).Scan(&n))
	require.Zero(t, n, "the aborted batch's history rows must not survive")

	// snapshot_sweeps: a1's status still shows the block-100 attempt only;
	// a2 has no row at all.
	var attempts, attempt uint64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT attempts, last_attempt_block FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
		engine, a1).Scan(&attempts, &attempt))
	require.Equal(t, []uint64{1, 100}, []uint64{attempts, attempt})
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshot_sweeps WHERE account = $1`, a2).Scan(&n))
	require.Zero(t, n)
}

// TestRewindDerivedInvalidatesOrphanedSnapshots pins reorg-orphaned snapshot
// invalidation INSIDE RewindDerived's transaction: an account whose ONLY
// debt-side event sits above the rewind target loses its snapshot balance
// rows, its sweep status row AND its entire snapshots HISTORY (its registry
// membership was reorged away); every engine history row above the effective
// target is deleted for ALL sides and ALL accounts (those rows describe
// replaced blocks); the engine's sweep generation is bumped (the post-rewind
// re-sweep is durably opened, atomic with the epoch ack); and surviving
// accounts keep their rows — including at/below-target history — but LAG the
// new generation.
func TestRewindDerivedInvalidatesOrphanedSnapshots(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	orphan, survivor := []byte{0xA1}, []byte{0xA2}

	// orphan's only debt event is at block 100 (above the rewind target);
	// survivor borrowed at block 50 (below it).
	require.NoError(t, s.ApplyDerived(ctx, engine, 10, []PositionEvent{
		pe(100, 1, 0xA1, 0xBB, "debt", 40),
		pe(50, 2, 0xA2, 0xBB, "debt", 10),
	}, 100))

	// Debt-side history below the target for BOTH accounts (the survivor's
	// must outlive the rewind; the orphan's must not — the anti-join takes an
	// orphan's WHOLE history), plus a survivor debt row above the target.
	require.NoError(t, s.SaveSnapshots(ctx, engine, 80, map[string]SnapshotDoc{
		"a1": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(40)}},
		"a2": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(10)}},
	}))
	require.NoError(t, s.SaveSnapshots(ctx, engine, 100, map[string]SnapshotDoc{
		"a2": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(10)}},
	}))

	// Both were swept: snapshot balances + collateral history rows at the
	// multicall block (above the target) + generation-1 status rows.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(1), gen)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 100, []SweepResult{
		{Account: orphan, OK: true, Balances: map[string]map[string]*big.Int{"bb": {"collateral": big.NewInt(555)}}},
		{Account: survivor, OK: true, Balances: map[string]map[string]*big.Int{"bb": {"collateral": big.NewInt(7)}}},
	}))
	_, _, err = s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)

	// Another engine's history row above the target must survive the rewind
	// (per-engine hygiene).
	require.NoError(t, s.SaveSnapshots(ctx, "aave_v3_etherfi", 100, map[string]SnapshotDoc{
		"a9": {Side: "debt", Balances: map[string]*big.Int{"cc": big.NewInt(3)}},
	}))

	// The reorg: raw truth rewinds to 90, the derived ack follows.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 90, []byte{0x90}))
	require.NoError(t, s.RewindDerived(ctx, engine, 10, 90))

	// Orphan: no snapshot balance rows, no sweep row, and NO history rows at
	// all — not even the block-80 one below the target: its registry
	// membership never existed on the canonical chain.
	require.Empty(t, balanceRows(t, s, engine, orphan, "snapshot"))
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
		engine, orphan).Scan(&n))
	require.Zero(t, n)
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE engine = $1 AND account = $2`,
		engine, orphan).Scan(&n))
	require.Zero(t, n, "an orphaned account loses its ENTIRE history, below-target rows included")

	// Engine-wide: nothing above the effective target survives, any side, any
	// account — the survivor's block-100 debt AND collateral rows are gone.
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE engine = $1 AND block_number > 90`,
		engine).Scan(&n))
	require.Zero(t, n, "history above the effective target describes replaced blocks")

	// The survivor's at/below-target history survives, exactly.
	var block uint64
	var side string
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT block_number, side FROM snapshots WHERE engine = $1 AND account = $2`,
		engine, survivor).Scan(&block, &side))
	require.Equal(t, uint64(80), block)
	require.Equal(t, "debt", side)

	// The other engine's above-target row is untouched.
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE engine = 'aave_v3_etherfi' AND block_number = 100`).Scan(&n))
	require.Equal(t, 1, n, "rewind history hygiene is per-engine")

	// Survivor: keeps balances and status row...
	require.Equal(t, map[string]string{"bb/collateral": "7@100"},
		balanceRows(t, s, engine, survivor, "snapshot"))
	var survivorGen uint64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT generation FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
		engine, survivor).Scan(&survivorGen))
	require.Equal(t, uint64(1), survivorGen)

	// ...but LAGS the bumped generation: the post-rewind re-sweep is durably
	// open (completed_at cleared in the same commit as the ack) and the
	// survivor is exactly its work list.
	newGen, open, _, err := s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(2), newGen, "RewindDerived bumps the generation in its own transaction")
	require.True(t, open, "the post-rewind sweep is durably OPEN — a crash right here loses nothing")
	work, err := s.SweepWorkBatch(ctx, engine, newGen, 4, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{survivor}, work, "the survivor lags; the orphan is gone from the registry")
}

// TestSnapshotHistorySidesCoexistAtSameBlock pins the side-keyed history PK
// (migration 00004): the debt writer (the runner's SaveSnapshots at its
// derive through-block) and the collateral writer (ApplySweepBatch at its
// multicall execution block) landing on the SAME (engine, account, block)
// must BOTH stay queryable — the old three-column PK let either wholesale-
// replace the other whenever the multicall executed at the derive block.
// Same-side re-saves still replace their own row only.
func TestSnapshotHistorySidesCoexistAtSameBlock(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	account := []byte{0xA1}

	require.NoError(t, s.SaveSnapshots(ctx, engine, 100, map[string]SnapshotDoc{
		"a1": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(40)}},
	}))
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 100, []SweepResult{
		{Account: account, OK: true, Balances: map[string]map[string]*big.Int{"cc": {"collateral": big.NewInt(9)}}},
	}))

	readSides := func() map[string]map[string]any {
		rows, err := s.pool.Query(ctx,
			`SELECT side, balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
			engine, account)
		require.NoError(t, err)
		defer rows.Close()
		out := map[string]map[string]any{}
		for rows.Next() {
			var side string
			var doc map[string]any
			require.NoError(t, rows.Scan(&side, &doc))
			out[side] = doc
		}
		require.NoError(t, rows.Err())
		return out
	}

	require.Equal(t, map[string]map[string]any{
		"debt":       {"side": "debt", "balances": map[string]any{"bb": "40"}},
		"collateral": {"side": "collateral", "balances": map[string]any{"cc": "9"}},
	}, readSides(), "both writers' rows coexist at one (engine, account, block)")

	// A same-side replay (SaveSnapshot, the single-row writer) replaces ONLY
	// its own side's row; the collateral row is untouched.
	require.NoError(t, s.SaveSnapshot(ctx, engine, account, 100, map[string]map[string]*big.Int{
		"bb": {"debt": big.NewInt(41)},
	}))
	require.Equal(t, map[string]map[string]any{
		"debt":       {"side": "debt", "balances": map[string]any{"bb": "41"}},
		"collateral": {"side": "collateral", "balances": map[string]any{"cc": "9"}},
	}, readSides())
}

// TestApplySweepBatchRejectsStaleExecutionBlocks is the monotonic
// stale-failover regression: after a sweep succeeds at block 200, a batch
// served by a lagging failed-over endpoint at block 150 is refused — an
// ALL-stale batch returns ErrStaleSweepBatch and applies NOTHING; a mixed
// batch commits its fresh results and skips the stale account WITHOUT
// advancing its generation (it stays lagging and re-pulls); a later batch at
// 201 lands normally; a SAME-block replay stays admitted (crash-replay
// idempotence); and failed results are always recorded, whatever block
// served them.
func TestApplySweepBatchRejectsStaleExecutionBlocks(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"
	a1, a2 := []byte{0xA1}, []byte{0xA2}

	require.NoError(t, s.ApplyDerived(ctx, engine, 10, []PositionEvent{
		pe(100, 1, 0xA1, 0xBB, "debt", 40),
		pe(100, 2, 0xA2, 0xBB, "debt", 10),
	}, 100))

	readRow := func(account []byte) (gen, attempts, attempt, success uint64, status string) {
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT generation, attempts, last_attempt_block, last_success_block, status
			 FROM snapshot_sweeps WHERE engine = $1 AND account = $2`, engine, account).
			Scan(&gen, &attempts, &attempt, &success, &status))
		return
	}
	ok := func(account []byte, amount int64) SweepResult {
		return SweepResult{Account: account, OK: true, Balances: map[string]map[string]*big.Int{
			"bb": {"collateral": big.NewInt(amount)},
		}}
	}

	// Generation 1: a1 sweeps successfully at block 200.
	gen1, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen1, 200, []SweepResult{ok(a1, 555)}))
	_, _, err = s.CompleteSweepGeneration(ctx, engine, gen1)
	require.NoError(t, err)

	// Generation 2 opens; a failed-over endpoint serves block 150. The whole
	// batch is stale: typed refusal, NOTHING applied — balances keep 555@200,
	// the status row keeps its generation-1 stamp (a1 still LAGS gen2 and
	// re-pulls next batch), and no block-150 history row exists.
	gen2, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	err = s.ApplySweepBatch(ctx, engine, gen2, 150, []SweepResult{ok(a1, 111)})
	require.ErrorIs(t, err, ErrStaleSweepBatch)
	require.Equal(t, map[string]string{"bb/collateral": "555@200"}, balanceRows(t, s, engine, a1, "snapshot"))
	g, at, attempt, success, status := readRow(a1)
	require.Equal(t, []uint64{gen1, 1, 200, 200}, []uint64{g, at, attempt, success},
		"a stale success must not touch the status row or advance its generation")
	require.Equal(t, "success", status)
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshots WHERE block_number = 150`).Scan(&n))
	require.Zero(t, n, "a stale success writes no history row")
	work, err := s.SweepWorkBatch(ctx, engine, gen2, 4, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA2}, {0xA1}}, work, "the stale-skipped account still lags and re-pulls")

	// MIXED batch at 150: a1 is stale again (skipped, still lagging), but a2
	// has never succeeded — the guard admits it, the batch commits.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 150, []SweepResult{ok(a1, 111), ok(a2, 7)}))
	require.Equal(t, map[string]string{"bb/collateral": "555@200"}, balanceRows(t, s, engine, a1, "snapshot"))
	require.Equal(t, map[string]string{"bb/collateral": "7@150"}, balanceRows(t, s, engine, a2, "snapshot"))
	work, err = s.SweepWorkBatch(ctx, engine, gen2, 4, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{{0xA1}}, work, "the fresh result advanced; the stale one still owes work")

	// The caught-up endpoint at 201 lands normally...
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 201, []SweepResult{ok(a1, 999)}))
	require.Equal(t, map[string]string{"bb/collateral": "999@201"}, balanceRows(t, s, engine, a1, "snapshot"))
	g, at, attempt, success, status = readRow(a1)
	require.Equal(t, []uint64{gen2, 1, 201, 201}, []uint64{g, at, attempt, success})
	require.Equal(t, "success", status)

	// ...a SAME-block replay stays admitted (the crash-replay idempotence
	// contract: only attempts overcounts)...
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 201, []SweepResult{ok(a1, 999)}))
	g, at, _, success, _ = readRow(a1)
	require.Equal(t, []uint64{gen2, 2, 201}, []uint64{g, at, success})

	// ...and a FAILED result bypasses the guard entirely: the attempt is
	// recorded at whatever block served it, last_success_block untouched.
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen2, 150, []SweepResult{{Account: a1, OK: false}}))
	g, at, attempt, success, status = readRow(a1)
	require.Equal(t, []uint64{gen2, 3, 150, 201}, []uint64{g, at, attempt, success})
	require.Equal(t, "failed", status)
	require.Equal(t, map[string]string{"bb/collateral": "999@201"}, balanceRows(t, s, engine, a1, "snapshot"),
		"a failed attempt keeps the previous snapshot")
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
