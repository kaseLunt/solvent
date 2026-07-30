package store

// Live-database tests for the collateral-flag fold: ordering, bounding, absence,
// and the rewind interaction. Every one runs against the destructive scratch DSN
// through the SAME writer production uses (ApplyDerivedWithRates), never a hand
// INSERT — a fold tested against rows a test made up is a fold tested against a
// shape the deriver may not produce.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

var (
	cfReserve = mustHexBytes("cd5fe23c85820f7b72d0926fc9b05b43e359b7ee") // weETH
	cfOther   = mustHexBytes("a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") // a second reserve
	cfUserA   = mustHexBytes("464c71f6c2f760dda6093dcb91c24c39e5d6e18c")
	cfUserB   = mustHexBytes("2c64a1d5d602e7fb6d21da6211dcecc6e17a0649")
)

func mustHexBytes(s string) []byte {
	b := make([]byte, len(s)/2)
	for i := 0; i < len(b); i++ {
		var v byte
		for j := 0; j < 2; j++ {
			c := s[i*2+j]
			switch {
			case c >= '0' && c <= '9':
				v = v<<4 | (c - '0')
			case c >= 'a' && c <= 'f':
				v = v<<4 | (c - 'a' + 10)
			default:
				panic("bad hex: " + s)
			}
		}
		b[i] = v
	}
	return b
}

// flagEvent builds one collateral-flag position_event the way the Aave deriver
// does: account = user, asset = reserve, side empty, delta nil.
func flagEvent(block uint64, tx byte, logIndex uint32, eventType string, reserve, user []byte) PositionEvent {
	return PositionEvent{
		ChainID: 1, Engine: riskAaveEngine, BlockNumber: block,
		TxHash: []byte{tx}, LogIndex: logIndex,
		EventType: eventType, Account: user, Asset: reserve,
	}
}

func flagsByPair(rows []CollateralFlagRow) map[string]CollateralFlagRow {
	out := map[string]CollateralFlagRow{}
	for _, r := range rows {
		out[string(r.Reserve)+"/"+string(r.User)] = r
	}
	return out
}

// TestCollateralFlagsAsOfFoldsLatestPerPair is the core fold law: last event in
// (block, log_index) order wins, INDEPENDENTLY per (reserve, user) pair.
func TestCollateralFlagsAsOfFoldsLatestPerPair(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		// userA: enabled, disabled, enabled again → ENABLED.
		flagEvent(20_713_917, 0x01, 194, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		flagEvent(20_800_000, 0x02, 10, AaveCollateralDisabledEvent, cfReserve, cfUserA),
		flagEvent(21_000_000, 0x03, 5, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		// userB on the same reserve: enabled then disabled → DISABLED. Independent
		// of userA's later re-enable, which is what "per pair" means.
		flagEvent(20_900_000, 0x04, 7, AaveCollateralEnabledEvent, cfReserve, cfUserB),
		flagEvent(22_551_863, 0x05, 342, AaveCollateralDisabledEvent, cfReserve, cfUserB),
		// userA on a DIFFERENT reserve: enabled → ENABLED. Independent of the same
		// user's history on cfReserve.
		flagEvent(21_100_000, 0x06, 1, AaveCollateralEnabledEvent, cfOther, cfUserA),
	}, nil, 23_000_000))

	rows, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 23_000_000)
	require.NoError(t, err)
	require.Len(t, rows, 3, "three (reserve, user) pairs, one folded row each")

	byPair := flagsByPair(rows)
	a := byPair[string(cfReserve)+"/"+string(cfUserA)]
	require.True(t, a.Enabled, "userA's LAST event on this reserve is an enable")
	require.EqualValues(t, 21_000_000, a.Block, "the fold reports the WITNESS's own block")
	require.EqualValues(t, 5, a.LogIndex)

	b := byPair[string(cfReserve)+"/"+string(cfUserB)]
	require.False(t, b.Enabled)
	require.EqualValues(t, 22_551_863, b.Block)

	other := byPair[string(cfOther)+"/"+string(cfUserA)]
	require.True(t, other.Enabled)

	// Engine and chain are stamped from the query's own bounds, so a consumer
	// cannot mistake which engine's ledger it is reading.
	for _, r := range rows {
		require.Equal(t, riskAaveEngine, r.Engine)
		require.EqualValues(t, 1, r.ChainID)
	}
}

// TestCollateralFlagsAsOfBreaksSameBlockTiesByLogIndex is the ordering leg that a
// block-only ORDER BY would get wrong non-deterministically.
//
// Two flag events for one pair in one block is legal on chain: a transfer that
// zeroes a balance emits a disable, and a later supply in the same block re-enables
// it. Ordering by block alone lets Postgres return either row.
//
// MUTANT THIS KILLS: drop `log_index DESC` from the fold's ORDER BY.
func TestCollateralFlagsAsOfBreaksSameBlockTiesByLogIndex(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		// SAME BLOCK. The enable is at the LOWER log index, so the disable wins.
		flagEvent(21_000_000, 0x01, 3, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		flagEvent(21_000_000, 0x02, 91, AaveCollateralDisabledEvent, cfReserve, cfUserA),
	}, nil, 21_000_000))

	rows, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 21_000_000)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.False(t, rows[0].Enabled,
		"within one block the LATER log index is the later chain fact")
	require.EqualValues(t, 91, rows[0].LogIndex)

	// The fold is stable, not accidentally right once.
	for i := 0; i < 10; i++ {
		again, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 21_000_000)
		require.NoError(t, err)
		require.Equal(t, rows, again, "iteration %d", i)
	}
}

// TestCollateralFlagsAsOfRespectsTheBlockBound: a flag above the bound describes a
// block the engine has not claimed custody of, and reading it would judge the two
// halves of one position at two different blocks.
func TestCollateralFlagsAsOfRespectsTheBlockBound(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		flagEvent(20_713_917, 0x01, 194, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		flagEvent(22_551_863, 0x02, 342, AaveCollateralDisabledEvent, cfReserve, cfUserA),
	}, nil, 23_000_000))

	// AT the disable block: disabled.
	at, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 22_551_863)
	require.NoError(t, err)
	require.Len(t, at, 1)
	require.False(t, at[0].Enabled, "the bound is inclusive: <= block")

	// ONE BLOCK BELOW it: still enabled. The as-of is a real as-of.
	before, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 22_551_862)
	require.NoError(t, err)
	require.Len(t, before, 1)
	require.True(t, before[0].Enabled)
	require.EqualValues(t, 20_713_917, before[0].Block)

	// BELOW THE FIRST EVENT: no rows at all, which the consumer reads as "never
	// enabled" — the no-history law, and the correct answer for that block.
	none, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 20_713_916)
	require.NoError(t, err)
	require.Empty(t, none)
}

// TestCollateralFlagsAsOfIsScopedByEngineAndChain: the fold must not pick up
// another engine's or another chain's rows. `event_type` alone does not scope a
// read — position_events is one table for every engine.
func TestCollateralFlagsAsOfIsScopedByEngineAndChain(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		flagEvent(21_000_000, 0x01, 1, AaveCollateralEnabledEvent, cfReserve, cfUserA),
	}, nil, 21_000_000))

	rows, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 25_000_000)
	require.NoError(t, err)
	require.Len(t, rows, 1)

	wrongEngine, err := CollateralFlagsAsOf(ctx, s.pool, riskDMEngine, 1, 25_000_000)
	require.NoError(t, err)
	require.Empty(t, wrongEngine, "the DM engine has no collateral-flag ledger")

	wrongChain, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 10, 25_000_000)
	require.NoError(t, err)
	require.Empty(t, wrongChain, "chain 10 is not where this market lives")

	// An empty engine name reads NOTHING rather than everything: riskd passes it
	// when the Aave cursor does not exist yet, and a predicate that degraded to
	// "all engines" there would fold the DM's rows into the Aave posture.
	noEngine, err := CollateralFlagsAsOf(ctx, s.pool, "", 1, 25_000_000)
	require.NoError(t, err)
	require.Empty(t, noEngine)
}

// TestCollateralFlagsAsOfIgnoresOtherEventTypes: the Aave deriver writes several
// record-only types on the same account/asset keys, and a predicate that matched
// them would fold `aave_supply` into a boolean.
func TestCollateralFlagsAsOfIgnoresOtherEventTypes(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		flagEvent(21_000_000, 0x01, 1, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		// A LATER record-only event on the same (account, asset) pair. If the
		// predicate leaked, this would become the "latest flag" and the fold's
		// event_type re-check would refuse it — either way the test fails loudly
		// rather than serving a wrong boolean.
		flagEvent(22_000_000, 0x02, 1, "aave_supply", cfReserve, cfUserA),
		flagEvent(22_000_001, 0x03, 1, "atoken_transfer", cfReserve, cfUserA),
	}, nil, 23_000_000))

	rows, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 23_000_000)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.True(t, rows[0].Enabled)
	require.EqualValues(t, 21_000_000, rows[0].Block,
		"the newest FLAG event is the fold's answer, not the newest event of any kind")
}

// TestCollateralFlagsAsOfFollowsARewind is the rewind leg, and it is the reason
// the flags were written as position_events rather than into a private table.
//
// RewindDerived deletes derived rows above the target and rebuilds balances. The
// flag ledger is those same rows, so it rewinds with them — no separate reorg
// story to get wrong, and the fold's answer moves back to what it was at the
// rewind target.
func TestCollateralFlagsAsOfFollowsARewind(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		flagEvent(20_713_917, 0x01, 194, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		flagEvent(22_551_863, 0x02, 342, AaveCollateralDisabledEvent, cfReserve, cfUserA),
	}, nil, 23_000_000))

	before, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 23_000_000)
	require.NoError(t, err)
	require.Len(t, before, 1)
	require.False(t, before[0].Enabled)

	require.NoError(t, s.RewindDerived(ctx, riskAaveEngine, 1, 21_000_000))

	after, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, 23_000_000)
	require.NoError(t, err)
	require.Len(t, after, 1)
	require.True(t, after[0].Enabled,
		"the disable at 22,551,863 was rewound away with every other derived row")
	require.EqualValues(t, 20_713_917, after[0].Block)
}

// TestRiskInputSnapshotCarriesTheCollateralFlags: the fold has to arrive through
// the snapshot the assembler actually reads, inside the same RR transaction as
// every other input. A reader that ran outside it would be a second snapshot, and
// the mid-flush race the whole design closes would be reopened for this one family.
func TestRiskInputSnapshotCarriesTheCollateralFlags(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1, []PositionEvent{
		flagEvent(20_713_917, 0x01, 194, AaveCollateralEnabledEvent, cfReserve, cfUserA),
		flagEvent(22_551_863, 0x02, 342, AaveCollateralDisabledEvent, cfReserve, cfUserB),
	}, nil, 23_000_000))

	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()

	in, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{
		PositionEngines:      []string{riskAaveEngine},
		CollateralFlagEngine: riskAaveEngine,
		CollateralFlagChain:  1,
		CollateralFlagBlock:  23_000_000,
	})
	require.NoError(t, err)
	require.Len(t, in.CollateralFlags, 2)

	byPair := flagsByPair(in.CollateralFlags)
	require.True(t, byPair[string(cfReserve)+"/"+string(cfUserA)].Enabled)
	require.False(t, byPair[string(cfReserve)+"/"+string(cfUserB)].Enabled)

	// And an unconfigured flag engine reads nothing rather than everything.
	bare, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{
		PositionEngines: []string{riskAaveEngine},
	})
	require.NoError(t, err)
	require.Empty(t, bare.CollateralFlags)
}
