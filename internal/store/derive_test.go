package store

import (
	"context"
	"encoding/hex"
	"math/big"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// testDeriveStore mirrors testStore but also truncates the five Task-3
// derivation tables (position_events, position_balances, derive_cursors,
// prices, snapshots) alongside the Task-2 ingestion tables, so derivation
// tests never see state left over from a prior test or the ingestion suite.
func testDeriveStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	require.NoError(t, Migrate(context.Background(), dsn))
	s, err := Open(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	_, err = s.pool.Exec(context.Background(),
		"TRUNCATE position_events, position_balances, derive_cursors, prices, snapshots, raw_logs, ingest_cursors")
	require.NoError(t, err)
	return s
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
