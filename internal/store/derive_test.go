package store

import (
	"context"
	"encoding/hex"
	"math/big"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// testDeriveStore mirrors testStore but also truncates the nine derivation
// tables (position_events, position_balances, derive_cursors, prices,
// snapshots, snapshot_sweeps, sweep_generations, rate_indexes, reorg_epochs)
// alongside the Task-2 ingestion tables, so derivation tests never see state
// left over from a prior test or the ingestion suite. reorg_epochs' BIGSERIAL
// sequence is deliberately NOT restarted: every epoch comparison in the store
// is relative (acked vs chain max), so absolute epoch values never matter.
// The DSN comes from destructiveTestDSN — the shared round-10 F1 guard that
// proves the physical split before this helper is allowed to TRUNCATE.
func testDeriveStore(t *testing.T) *Store {
	t.Helper()
	dsn := destructiveTestDSN(t)
	require.NoError(t, Migrate(context.Background(), dsn))
	s, err := Open(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	_, err = s.pool.Exec(context.Background(),
		"TRUNCATE position_events, position_balances, derive_cursors, prices, price_poll_anchors, snapshots, snapshot_sweeps, sweep_generations, rate_indexes, reorg_epochs, raw_logs, ingest_cursors, param_history")
	require.NoError(t, err)
	return s
}

// balanceRows reads engine's position_balances rows for account filtered by
// source, keyed "assethex/side" → "amount@updated_block", so tests can assert
// exact row shape (including amount-zero rows and source separation) in one
// require.Equal.
func balanceRows(t *testing.T, s *Store, engine string, account []byte, source string) map[string]string {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT encode(asset, 'hex') || '/' || side, amount::text || '@' || updated_block::text
		 FROM position_balances WHERE engine = $1 AND account = $2 AND source = $3`,
		engine, account, source)
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

// pe builds a minimal PositionEvent for chain 10 / engine "debt_manager"
// (override .Engine for other-engine fixtures), varying only what a given
// test cares about.
func pe(block uint64, tx byte, account, asset byte, side string, delta int64) PositionEvent {
	return PositionEvent{
		ChainID: 10, Engine: "debt_manager", BlockNumber: block,
		TxHash: []byte{tx}, LogIndex: 0, EventType: "test",
		Account: []byte{account}, Asset: []byte{asset}, Side: side,
		Delta: big.NewInt(delta),
	}
}

// TestApplyDerivedRoundTrip: two events on the same account/asset/side sum
// into one balance row, readable via BalancesFor, and the derive cursor
// advances to throughBlock.
func TestApplyDerivedRoundTrip(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	events := []PositionEvent{
		pe(100, 1, 0xAA, 0xBB, "collateral", 50),
		pe(100, 2, 0xAA, 0xBB, "collateral", 30),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 100))

	balances, err := s.BalancesFor(ctx, "debt_manager", []byte{0xAA})
	require.NoError(t, err)
	assetHex := hex.EncodeToString([]byte{0xBB})
	require.Equal(t, big.NewInt(80), balances[assetHex]["collateral"])

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), block)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 2, n)
}

// TestApplyDerivedIdempotentReplay: re-applying the exact same events (same
// PK, same payload) is a no-op — no error, no double-counted balance, no
// duplicate row.
func TestApplyDerivedIdempotentReplay(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	events := []PositionEvent{
		pe(100, 1, 0xAA, 0xBB, "debt", 40),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 100))
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 100))

	balances, err := s.BalancesFor(ctx, "debt_manager", []byte{0xAA})
	require.NoError(t, err)
	assetHex := hex.EncodeToString([]byte{0xBB})
	require.Equal(t, big.NewInt(40), balances[assetHex]["debt"])

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n)
}

// TestApplyDerivedRejectsDivergentReplay: replaying the same PK with a
// different delta aborts the whole batch (error) and rolls back — the
// original balance and event row are untouched.
func TestApplyDerivedRejectsDivergentReplay(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 40)}, 100))

	mutated := []PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 999)} // same PK, different delta
	err := s.ApplyDerived(ctx, "debt_manager", 10, mutated, 100)
	require.ErrorContains(t, err, "divergent")

	balances, err := s.BalancesFor(ctx, "debt_manager", []byte{0xAA})
	require.NoError(t, err)
	assetHex := hex.EncodeToString([]byte{0xBB})
	require.Equal(t, big.NewInt(40), balances[assetHex]["debt"]) // unchanged

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // nothing extra persisted
}

// TestApplyDerivedRejectsCursorRegression: a throughBlock behind the current
// derive cursor is refused, and the whole batch (event insert + balance
// application) rolls back with it.
func TestApplyDerivedRejectsCursorRegression(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))

	err := s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(90, 2, 0xAA, 0xBB, "debt", 5)}, 90)
	require.ErrorContains(t, err, "cursor regression")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // regressed batch's event never persisted

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), block) // cursor unchanged
}

// TestRewindDerivedRebuildsBalances: events at blocks 100/110/120; rewinding
// to 105 must delete events above 105, rebuild position_balances wholesale
// from the survivors (only the block-100 effect remains), and reset the
// derive cursor to 105.
func TestRewindDerivedRebuildsBalances(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	events := []PositionEvent{
		pe(100, 1, 0xAA, 0xBB, "collateral", 100),
		pe(110, 2, 0xAA, 0xBB, "collateral", 50),
		pe(120, 3, 0xAA, 0xBB, "collateral", 25),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 120))

	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 105))

	balances, err := s.BalancesFor(ctx, "debt_manager", []byte{0xAA})
	require.NoError(t, err)
	assetHex := hex.EncodeToString([]byte{0xBB})
	require.Equal(t, big.NewInt(100), balances[assetHex]["collateral"]) // only block-100 effect survives

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(105), block)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n)
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events WHERE block_number > 105").Scan(&n))
	require.Equal(t, 0, n)
}

// TestRewindDerivedEngineIsolation: rewinding one engine's derived state must
// not touch another engine's events or balances, even on the same chain and
// account/asset.
func TestRewindDerivedEngineIsolation(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	debtEvents := []PositionEvent{
		pe(100, 1, 0xAA, 0xBB, "debt", 10),
		pe(110, 2, 0xAA, 0xBB, "debt", 20),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, debtEvents, 110))

	aaveEv := pe(100, 3, 0xAA, 0xBB, "collateral", 77)
	aaveEv.Engine = "aave_v3_etherfi"
	require.NoError(t, s.ApplyDerived(ctx, "aave_v3_etherfi", 10, []PositionEvent{aaveEv}, 100))

	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 105))

	assetHex := hex.EncodeToString([]byte{0xBB})

	debtBalances, err := s.BalancesFor(ctx, "debt_manager", []byte{0xAA})
	require.NoError(t, err)
	require.Equal(t, big.NewInt(10), debtBalances[assetHex]["debt"]) // block-110 effect rewound away

	aaveBalances, err := s.BalancesFor(ctx, "aave_v3_etherfi", []byte{0xAA})
	require.NoError(t, err)
	require.Equal(t, big.NewInt(77), aaveBalances[assetHex]["collateral"]) // untouched

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events WHERE engine = 'aave_v3_etherfi'").Scan(&n))
	require.Equal(t, 1, n)
}

// TestApplyDerivedMultiEventPerLog: one raw log can fan out into multiple
// derived events discriminated by Seq (e.g. a liquidation emitting several
// seize movements). Two events sharing (chain_id, tx_hash, log_index) with
// seq 0/1 must both persist and both apply; replay stays idempotent.
func TestApplyDerivedMultiEventPerLog(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	seize0 := pe(100, 1, 0xAA, 0xBB, "collateral", 100) // seq 0
	seize1 := pe(100, 1, 0xAA, 0xCC, "collateral", 40)  // same log identity, second seize
	seize1.Seq = 1
	batch := []PositionEvent{seize0, seize1}

	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 100))

	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT count(*) FROM position_events WHERE tx_hash = '\\x01' AND log_index = 0").Scan(&n))
	require.Equal(t, 2, n) // both rows persisted under one log identity

	require.Equal(t, map[string]string{
		"bb/collateral": "100@100",
		"cc/collateral": "40@100",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event"))

	// replay of the full fan-out is a no-op
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 100))
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 2, n)
	require.Equal(t, "100@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"])
}

// TestApplyDerivedSeqDivergence: Seq participates in event identity — the
// same (chain_id, tx_hash, log_index, seq) replayed with a different delta is
// divergent and aborts the batch, while a NEW seq under the same log identity
// is simply another event.
func TestApplyDerivedSeqDivergence(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	ev := pe(100, 1, 0xAA, 0xBB, "collateral", 40)
	ev.Seq = 1
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{ev}, 100))

	mutated := ev
	mutated.Delta = big.NewInt(999) // same identity+seq, different delta
	err := s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{mutated}, 100)
	require.ErrorContains(t, err, "divergent")

	fresh := ev
	fresh.Seq = 2
	fresh.Delta = big.NewInt(7) // new seq: distinct identity, not a divergence
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{fresh}, 100))

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 2, n)
	require.Equal(t, "47@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"])
}

// TestApplyDerivedIntraBatchDuplicates: a batch containing the same event
// twice byte-identically coalesces (applied once); a batch containing the
// same identity+seq with divergent fields aborts wholesale.
func TestApplyDerivedIntraBatchDuplicates(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	ev := pe(100, 1, 0xAA, 0xBB, "collateral", 50)
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{ev, ev}, 100))

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // coalesced, not double-inserted
	require.Equal(t, "50@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"]) // applied once

	good := pe(101, 2, 0xAA, 0xBB, "collateral", 5)
	bad := good
	bad.Delta = big.NewInt(999) // same identity+seq, divergent delta, same batch
	err := s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{good, bad}, 101)
	require.ErrorContains(t, err, "divergent")

	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // aborted batch persisted nothing
	require.Equal(t, "50@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"]) // unchanged
}

// TestApplyDerivedNumericExtremes: delta/amount are NUMERIC and must
// round-trip exactly at integer extremes — uint256-max, an 80-digit value, a
// large negative, and nil (record-only). Replay after persistence exercises
// the ::text parse path against the same extremes.
func TestApplyDerivedNumericExtremes(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	uint256Max, ok := new(big.Int).SetString(
		"115792089237316195423570985008687907853269984665640564039457584007913129639935", 10)
	require.True(t, ok)
	eighty, ok := new(big.Int).SetString(strings.Repeat("7", 80), 10)
	require.True(t, ok)
	negBig, ok := new(big.Int).SetString("-"+strings.Repeat("9", 40), 10)
	require.True(t, ok)

	evMax := pe(100, 1, 0xAA, 0x01, "collateral", 0)
	evMax.Delta = uint256Max
	ev80 := pe(100, 2, 0xAA, 0x02, "collateral", 0)
	ev80.Delta = eighty
	evNeg := pe(100, 3, 0xAA, 0x03, "debt", 0)
	evNeg.Delta = negBig
	evNil := pe(100, 4, 0xAA, 0x04, "", 0) // record-only
	evNil.Delta = nil
	evNil.EventType = "ops"
	batch := []PositionEvent{evMax, ev80, evNeg, evNil}

	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 100))

	require.Equal(t, map[string]string{
		"01/collateral": uint256Max.String() + "@100",
		"02/collateral": eighty.String() + "@100",
		"03/debt":       negBig.String() + "@100",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")) // no row for the record-only asset

	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT count(*) FROM position_events WHERE delta IS NULL").Scan(&n))
	require.Equal(t, 1, n) // record-only event persisted with NULL delta

	// identical replay must parse the stored extremes back and judge them equal
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 100))
	require.Equal(t, uint256Max.String()+"@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["01/collateral"]) // not double-applied
}

// TestUpsertSnapshotBalances: snapshot rows round-trip under source='snapshot'
// and a re-upsert replaces THAT account's snapshot rows wholesale — stale
// assets vanish — while event-sourced rows on the very same logical key and
// other accounts' snapshots survive.
func TestUpsertSnapshotBalances(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "aave_v3_etherfi"

	// event row on the same (engine, account, asset, side) the snapshot uses:
	// both must coexist (source is part of the key) and only one is replaced
	ev := pe(100, 1, 0xAA, 0xBB, "collateral", 111)
	ev.Engine = engine
	require.NoError(t, s.ApplyDerived(ctx, engine, 10, []PositionEvent{ev}, 100))

	require.NoError(t, s.UpsertSnapshotBalances(ctx, engine, []byte{0xAA}, map[string]map[string]*big.Int{
		"bb": {"collateral": big.NewInt(500), "debt": big.NewInt(20)},
		"cc": {"debt": big.NewInt(70)},
	}, 1000))
	require.NoError(t, s.UpsertSnapshotBalances(ctx, engine, []byte{0xAB}, map[string]map[string]*big.Int{
		"bb": {"collateral": big.NewInt(4)},
	}, 1000))

	require.Equal(t, map[string]string{
		"bb/collateral": "500@1000",
		"bb/debt":       "20@1000",
		"cc/debt":       "70@1000",
	}, balanceRows(t, s, engine, []byte{0xAA}, "snapshot"))

	// wholesale replacement: bb/cc vanish, only dd remains
	require.NoError(t, s.UpsertSnapshotBalances(ctx, engine, []byte{0xAA}, map[string]map[string]*big.Int{
		"dd": {"collateral": big.NewInt(9)},
	}, 1100))

	require.Equal(t, map[string]string{
		"dd/collateral": "9@1100",
	}, balanceRows(t, s, engine, []byte{0xAA}, "snapshot"))
	require.Equal(t, map[string]string{
		"bb/collateral": "111@100",
	}, balanceRows(t, s, engine, []byte{0xAA}, "event")) // event row untouched
	require.Equal(t, map[string]string{
		"bb/collateral": "4@1000",
	}, balanceRows(t, s, engine, []byte{0xAB}, "snapshot")) // other account untouched
}

// TestRateIndexSaveAndLatest: SaveRateIndex round-trips per (engine, asset,
// block, kind); LatestRateIndex picks the highest block at or below the
// requested height per kind; identical re-save is a no-op; divergent re-save
// under the same key is refused.
func TestRateIndexSaveAndLatest(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine, asset := "aave_v3_etherfi", []byte{0xEE}

	ray, ok := new(big.Int).SetString("1000000000000000000000000001", 10)
	require.True(t, ok)
	ray2 := new(big.Int).Add(ray, big.NewInt(5000))

	require.NoError(t, s.SaveRateIndex(ctx, engine, asset, 100, "liquidity_index", ray))
	require.NoError(t, s.SaveRateIndex(ctx, engine, asset, 200, "liquidity_index", ray2))
	require.NoError(t, s.SaveRateIndex(ctx, engine, asset, 100, "variable_borrow_index", big.NewInt(42)))

	v, block, found, err := s.LatestRateIndex(ctx, engine, asset, 150, "liquidity_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), block)
	require.Equal(t, ray.String(), v.String()) // block-200 value not visible at 150

	v, block, found, err = s.LatestRateIndex(ctx, engine, asset, 200, "liquidity_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(200), block)
	require.Equal(t, ray2.String(), v.String())

	_, _, found, err = s.LatestRateIndex(ctx, engine, asset, 99, "liquidity_index")
	require.NoError(t, err)
	require.False(t, found) // nothing at or below 99

	_, _, found, err = s.LatestRateIndex(ctx, engine, asset, 300, "borrow_apy")
	require.NoError(t, err)
	require.False(t, found) // kind isolation

	require.NoError(t, s.SaveRateIndex(ctx, engine, asset, 100, "liquidity_index", ray)) // identical re-save: no-op
	err = s.SaveRateIndex(ctx, engine, asset, 100, "liquidity_index", ray2)              // divergent re-save
	require.ErrorContains(t, err, "diverge")

	v, _, _, err = s.LatestRateIndex(ctx, engine, asset, 100, "liquidity_index")
	require.NoError(t, err)
	require.Equal(t, ray.String(), v.String()) // original survives the refused overwrite
}

// TestRewindDerivedPreservesZeroNetRows: live application of +100/−100 leaves
// an amount=0 row (upsert-add never deletes); a rewind-rebuild must produce
// the SAME shape — the zero-net row exists with the correct updated_block —
// rather than dropping it, so readers can distinguish "position closed" from
// "never had a position" and rebuilds are equivalent to live application.
func TestRewindDerivedPreservesZeroNetRows(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	batch := []PositionEvent{
		pe(100, 1, 0xAA, 0xBB, "collateral", 100),
		pe(110, 2, 0xAA, 0xBB, "collateral", -100),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 110))

	want := map[string]string{"bb/collateral": "0@110"}
	require.Equal(t, want, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")) // live-apply shape

	// rewind ABOVE both events: everything survives, rebuild must keep the zero row
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 115))
	require.Equal(t, want, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event"))

	// re-apply the same events: identical replay, shape still identical
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, batch, 115))
	require.Equal(t, want, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event"))

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(115), block)
}

// TestRewindDerivedLeavesSnapshotRowsUntouched: RewindDerived rebuilds ONLY
// source='event' rows; a REGISTRY-SURVIVING account (one that keeps a
// debt-side event below the target) keeps its snapshot rows verbatim — the
// event-balance rebuild never clobbers the snapshotter's observations. (An
// account whose registry membership does NOT survive is the orphan case,
// pinned separately by TestRewindDerivedInvalidatesOrphanedSnapshots.)
func TestRewindDerivedLeavesSnapshotRowsUntouched(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.UpsertSnapshotBalances(ctx, "debt_manager", []byte{0xAA},
		map[string]map[string]*big.Int{"bb": {"collateral": big.NewInt(555)}}, 90))

	events := []PositionEvent{
		pe(95, 3, 0xAA, 0xBB, "debt", 7), // survives the rewind: keeps 0xAA in the registry
		pe(100, 1, 0xAA, 0xBB, "collateral", 100),
		pe(110, 2, 0xAA, 0xBB, "collateral", 50),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 110))

	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 105))

	require.Equal(t, map[string]string{
		"bb/debt":       "7@95",
		"bb/collateral": "100@100",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")) // block-110 effect rewound away
	require.Equal(t, map[string]string{
		"bb/collateral": "555@90",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "snapshot")) // untouched
}

// TestApplyDerivedCrossChainCursorRejection: an engine's derive cursor is
// bound to its chain — a batch claiming a different chain must be refused
// with a distinct "chain mismatch" error (not a height regression) and roll
// back wholly.
func TestApplyDerivedCrossChainCursorRejection(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))

	alien := pe(200, 2, 0xAA, 0xBB, "debt", 5)
	alien.ChainID = 999
	err := s.ApplyDerived(ctx, "debt_manager", 999, []PositionEvent{alien}, 200)
	require.ErrorContains(t, err, "derive cursor chain mismatch")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT count(*) FROM position_events WHERE chain_id = 999").Scan(&n))
	require.Equal(t, 0, n) // rolled back with the refused cursor move

	var chainID uint64
	var lastBlock uint64
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT chain_id, last_block FROM derive_cursors WHERE engine = 'debt_manager'").Scan(&chainID, &lastBlock))
	require.Equal(t, uint64(10), chainID)
	require.Equal(t, uint64(100), lastBlock) // binding and height unchanged
}

// TestReorgEpochCrashWindow pins the crash-recoverable ordering of the
// durable reorg protocol: store.Rewind's raw rewind atomically records a
// chain-wide reorg epoch; from that instant EVERY engine on the chain is
// refused further ApplyDerived (even across a process crash — the epoch is a
// row, not memory) until that engine acknowledges by RewindDerived; engines
// ack independently; an engine with no cursor yet on a chain with recorded
// epochs must bootstrap-ack via RewindDerived (implicit first-write ack
// exists only on epoch-free chains).
func TestReorgEpochCrashWindow(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// two engines on one chain (pure test data — chain 10 for both)
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))
	bEv := pe(100, 2, 0xAA, 0xBB, "collateral", 20)
	bEv.Engine = "aave_v3_etherfi"
	require.NoError(t, s.ApplyDerived(ctx, "aave_v3_etherfi", 10, []PositionEvent{bEv}, 100))

	// raw rewind: writes the reorg epoch atomically with the raw-log deletion
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 95, []byte{0x95}))

	// crash window: BEFORE any RewindDerived, both engines refuse to advance
	bNext := pe(101, 3, 0xAA, 0xBB, "collateral", 5)
	bNext.Engine = "aave_v3_etherfi"
	err := s.ApplyDerived(ctx, "aave_v3_etherfi", 10, []PositionEvent{bNext}, 101)
	require.ErrorContains(t, err, "unacknowledged reorg epoch")

	aNext := pe(101, 4, 0xAA, 0xBB, "debt", 5)
	err = s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{aNext}, 101)
	require.ErrorContains(t, err, "unacknowledged reorg epoch")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 2, n) // the refused batches wrote nothing

	// engine B acks via RewindDerived and may proceed
	require.NoError(t, s.RewindDerived(ctx, "aave_v3_etherfi", 10, 95))
	require.NoError(t, s.ApplyDerived(ctx, "aave_v3_etherfi", 10, []PositionEvent{bNext}, 101))

	// engine A has NOT acked: still refused (acks are per-engine)
	err = s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{aNext}, 101)
	require.ErrorContains(t, err, "unacknowledged reorg epoch")

	// engine A acks and proceeds
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 95))
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{aNext}, 101))

	// a brand-new engine (no cursor row) on a chain that HAS epochs gets no
	// implicit ack: it must bootstrap via RewindDerived before first write
	fresh := pe(100, 9, 0xAA, 0xBB, "collateral", 1)
	fresh.Engine = "fresh_engine"
	err = s.ApplyDerived(ctx, "fresh_engine", 10, []PositionEvent{fresh}, 100)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
	require.NoError(t, s.RewindDerived(ctx, "fresh_engine", 10, 100))
	require.NoError(t, s.ApplyDerived(ctx, "fresh_engine", 10, []PositionEvent{fresh}, 100))

	// ...and is then gated by the NEXT epoch like everyone else
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 90, []byte{0x90}))
	fresh2 := fresh
	fresh2.TxHash = []byte{0x0A}
	fresh2.BlockNumber = 101
	err = s.ApplyDerived(ctx, "fresh_engine", 10, []PositionEvent{fresh2}, 101)
	require.ErrorContains(t, err, "unacknowledged reorg epoch")
}

// TestRewindDerivedUsesDeepestUnackedTarget: acking every epoch obliges the
// rebuild to reach the DEEPEST unacknowledged rewind target, not merely the
// caller's toBlock — stacked epochs (rewound to 50, then 80) with a caller
// passing 80 must still purge events in (50, 80].
func TestRewindDerivedUsesDeepestUnackedTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	events := []PositionEvent{
		pe(45, 1, 0xAA, 0xBB, "collateral", 10),
		pe(60, 2, 0xAA, 0xBB, "collateral", 20),
		pe(90, 3, 0xAA, 0xBB, "collateral", 40),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 90))

	// stacked raw rewinds: epoch1 rewound_to=50, then epoch2 rewound_to=80
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 50, []byte{0x50}))
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 80, []byte{0x80}))

	// caller names the shallow target 80; the effective target must be 50
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 80))

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // events at 60 AND 90 deleted; only block-45 survives
	require.Equal(t, map[string]string{
		"bb/collateral": "10@45",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event"))

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(50), block) // cursor at the effective target, not the caller's 80

	var acked, maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT acked_epoch FROM derive_cursors WHERE engine = 'debt_manager'").Scan(&acked))
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 10").Scan(&maxEpoch))
	require.Equal(t, maxEpoch, acked) // both epochs acked in the same call

	// the engine may immediately re-derive the purged range
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(60, 4, 0xAA, 0xBB, "collateral", 20)}, 90))
	require.Equal(t, "30@60",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"])
}

// TestRewindDerivedShallowerCallerTargetLowered: even a SINGLE unacked epoch
// (rewound_to=50) lowers a caller's shallower toBlock=80 to 50 — the ack must
// never cover blocks the rebuild did not reach.
func TestRewindDerivedShallowerCallerTargetLowered(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	events := []PositionEvent{
		pe(45, 1, 0xAA, 0xBB, "collateral", 10),
		pe(60, 2, 0xAA, 0xBB, "collateral", 20),
	}
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, events, 60))
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 50, []byte{0x50}))

	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 80))

	block, found, err := s.DeriveCursor(ctx, "debt_manager")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(50), block) // rebuild landed at the epoch's 50, not the caller's 80

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events WHERE block_number > 50").Scan(&n))
	require.Equal(t, 0, n)
	require.Equal(t, map[string]string{
		"bb/collateral": "10@45",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event"))
}

// TestRewindDerivedWrongChainRejected: a RewindDerived naming a chain the
// engine's cursor is not bound to must refuse with
// ErrDeriveCursorChainMismatch BEFORE deleting or acking anything.
func TestRewindDerivedWrongChainRejected(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))
	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 95, []byte{0x95}))

	err := s.RewindDerived(ctx, "debt_manager", 999, 50)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n) // nothing deleted
	require.Equal(t, map[string]string{
		"bb/debt": "10@100",
	}, balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")) // balances untouched

	var lastBlock uint64
	var acked, maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT last_block, acked_epoch FROM derive_cursors WHERE engine = 'debt_manager'").Scan(&lastBlock, &acked))
	require.Equal(t, uint64(100), lastBlock) // cursor untouched
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 10").Scan(&maxEpoch))
	require.Less(t, acked, maxEpoch) // chain 10's epoch NOT acked by the refused call
}

// TestNewEngineRequiresBootstrapAckWhenEpochsExist: on a chain with recorded
// reorg epochs, an engine with no cursor row gets no implicit first-write ack
// — ApplyDerived refuses until a RewindDerived bootstrap has acked.
func TestNewEngineRequiresBootstrapAckWhenEpochsExist(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.Rewind(ctx, "op:aave", 10, 95, []byte{0x95}))

	ev := pe(100, 1, 0xAA, 0xBB, "collateral", 5)
	err := s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{ev}, 100)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 0, n) // refused batch persisted nothing

	// bootstrap: RewindDerived creates the cursor and acks every epoch
	require.NoError(t, s.RewindDerived(ctx, "debt_manager", 10, 100))
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10, []PositionEvent{ev}, 100))
	require.Equal(t, "5@100",
		balanceRows(t, s, "debt_manager", []byte{0xAA}, "event")["bb/collateral"])
}

// TestSentinelErrorsMatchable: refusal errors carry their sentinels through
// the contextual wrapping, so callers can branch with errors.Is instead of
// substring matching.
func TestSentinelErrorsMatchable(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "debt", 10)}, 100))

	err := s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(90, 2, 0xAA, 0xBB, "debt", 5)}, 90)
	require.ErrorIs(t, err, ErrDeriveCursorRegression)

	alien := pe(200, 3, 0xAA, 0xBB, "debt", 5)
	alien.ChainID = 999
	err = s.ApplyDerived(ctx, "debt_manager", 999, []PositionEvent{alien}, 200)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)
}

// TestBalancesForRejectsDualSourceConflict: an (asset, side) carrying BOTH an
// event- and a snapshot-sourced row violates source exclusivity — BalancesFor
// must refuse rather than let scan order nondeterministically pick a winner.
func TestBalancesForRejectsDualSourceConflict(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	// overlapping sources on account 0xAA: event AND snapshot both claim bb/collateral
	require.NoError(t, s.ApplyDerived(ctx, engine, 10,
		[]PositionEvent{pe(100, 1, 0xAA, 0xBB, "collateral", 111)}, 100))
	require.NoError(t, s.UpsertSnapshotBalances(ctx, engine, []byte{0xAA},
		map[string]map[string]*big.Int{"bb": {"collateral": big.NewInt(500)}}, 100))

	_, err := s.BalancesFor(ctx, engine, []byte{0xAA})
	require.ErrorIs(t, err, ErrBalanceSourceConflict)

	// non-overlapping account: event owns bb/collateral, snapshot owns bb/debt
	require.NoError(t, s.ApplyDerived(ctx, engine, 10,
		[]PositionEvent{pe(100, 2, 0xAB, 0xBB, "collateral", 7)}, 100))
	require.NoError(t, s.UpsertSnapshotBalances(ctx, engine, []byte{0xAB},
		map[string]map[string]*big.Int{"bb": {"debt": big.NewInt(9)}}, 100))

	balances, err := s.BalancesFor(ctx, engine, []byte{0xAB})
	require.NoError(t, err)
	assetHex := hex.EncodeToString([]byte{0xBB})
	require.Equal(t, big.NewInt(7), balances[assetHex]["collateral"])
	require.Equal(t, big.NewInt(9), balances[assetHex]["debt"])
}
