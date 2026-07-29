package main

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func cur(engine string, chain int64, block uint64, acked int64) store.DeriveCursorState {
	return store.DeriveCursorState{Engine: engine, ChainID: chain, LastBlock: block, AckedEpoch: acked}
}

var consumed = []string{"aave_v3_etherfi", "aave_param", "debt_manager", "prices:poll:1", "prices:poll:10"}

// TestWatermarkVectorABARegression is THE reason the trigger compares
// (last_block, acked_epoch) and never last_block alone.
//
// The sequence is the real one: the walker rewinds (cursor drops, an epoch is
// recorded), the deriver acknowledges (acked_epoch bumps), the walker re-walks
// and the cursor REGAINS ITS ORIGINAL HEIGHT. A height-only comparison sees
// nothing changed and riskd keeps serving numbers computed from a chain that no
// longer exists. acked_epoch is monotone and survives PruneAckedReorgEpochs, so
// it is the leg that always moves.
func TestWatermarkVectorABARegression(t *testing.T) {
	before := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_618, 4)},
		map[int64]int64{1: 4}, consumed)

	// Mid-rewind: the cursor fell and the ack has landed.
	during := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_600, 5)},
		map[int64]int64{1: 5}, consumed)
	require.True(t, during.Changed(before))

	// The re-walk regains the ORIGINAL height. Same last_block, different ack.
	after := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_618, 5)},
		map[int64]int64{1: 5}, consumed)

	require.Equal(t, before.Engines["aave_v3_etherfi"].LastBlock, after.Engines["aave_v3_etherfi"].LastBlock,
		"the fixture must actually regain the height, or it does not test ABA")
	require.True(t, after.Changed(before),
		"the acked_epoch leg must fire: last_block alone is blind to a completed rewind cycle")
}

// TestWatermarkVectorSurvivesEpochPruning: after PruneAckedReorgEpochs deletes
// the acked epoch, MAX(reorg_epochs.epoch) goes back to zero — and the ack
// comparison still fires.
func TestWatermarkVectorSurvivesEpochPruning(t *testing.T) {
	before := newWatermarkVector(
		[]store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)},
		map[int64]int64{}, consumed)
	// Rewind, ack, re-walk, PRUNE: the epoch row is gone entirely.
	after := newWatermarkVector(
		[]store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 9)},
		map[int64]int64{}, consumed)

	require.Equal(t, before.MaxEpochs, after.MaxEpochs, "pruning erased the epoch evidence...")
	require.True(t, after.Changed(before), "...and acked_epoch is what remains")
}

func TestWatermarkVectorUnchangedWhenNothingMoved(t *testing.T) {
	cursors := []store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 4),
		cur("prices:poll:1", 1, 25_635_600, 4),
	}
	a := newWatermarkVector(cursors, map[int64]int64{1: 4}, consumed)
	b := newWatermarkVector(cursors, map[int64]int64{1: 4}, consumed)
	require.False(t, b.Changed(a))
}

// TestWatermarkVectorTracksPriceCursors: a price row landing changes the
// numbers, so a vector that ignored the poll cursors would recompute only when
// a block moved.
func TestWatermarkVectorTracksPriceCursors(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{cur("prices:poll:10", 10, 100, 0)},
		map[int64]int64{}, consumed)
	b := newWatermarkVector([]store.DeriveCursorState{cur("prices:poll:10", 10, 101, 0)},
		map[int64]int64{}, consumed)
	require.True(t, b.Changed(a))
}

func TestWatermarkVectorIgnoresUnconsumedEngines(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 100, 0),
		cur("chainlink_feed_something", 1, 100, 0),
	}, map[int64]int64{}, consumed)
	b := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 100, 0),
		cur("chainlink_feed_something", 1, 999, 0),
	}, map[int64]int64{}, consumed)
	require.False(t, b.Changed(a), "an engine this pass does not consume cannot trigger a recompute")
	require.Len(t, a.Engines, 1)
}

func TestWatermarkVectorVanishedEngineIsAChange(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 100, 0)},
		map[int64]int64{}, consumed)
	b := newWatermarkVector(nil, map[int64]int64{}, consumed)
	require.True(t, b.Changed(a))
}

// TestWatermarkVectorRecordedButUnackedEpochIsAChange is the complementary leg:
// a walker rewind committed whose derived ack has NOT landed moves neither
// cursor field, but its epoch row sits above the engine's ack.
func TestWatermarkVectorRecordedButUnackedEpochIsAChange(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_618, 4)}
	a := newWatermarkVector(cursors, map[int64]int64{1: 4}, consumed)
	b := newWatermarkVector(cursors, map[int64]int64{1: 5}, consumed)
	require.True(t, b.Changed(a))
}

// ---------------------------------------------------------------------------
// The pass gate.
// ---------------------------------------------------------------------------

func TestGatePassRefusesUnackedEpoch(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 4),
		cur("aave_param", 1, 25_635_618, 5),
	}, map[int64]int64{1: 5}, consumed)

	g := gatePass(v, []string{"aave_v3_etherfi", "aave_param"})
	require.False(t, g.OK)
	require.Len(t, g.Reasons, 1)
	require.Contains(t, g.Reasons[0], "aave_v3_etherfi")
	require.ErrorIs(t, g.Err(), errPassGated)
	require.Contains(t, g.Err().Error(), "already deleted")
}

func TestGatePassAdmitsAckedEpoch(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 5),
		cur("aave_param", 1, 25_635_618, 5),
	}, map[int64]int64{1: 5}, consumed)
	g := gatePass(v, []string{"aave_v3_etherfi", "aave_param"})
	require.True(t, g.OK)
	require.NoError(t, g.Err())
}

// TestGatePassIgnoresPriceEngines: G2 handles them per position, so an
// unacknowledged price epoch must not refuse the whole pass.
func TestGatePassIgnoresPriceEngines(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("debt_manager", 10, 154_796_552, 9),
		cur("prices:poll:10", 10, 154_796_500, 3),
	}, map[int64]int64{10: 9}, consumed)

	g := gatePass(v, []string{"debt_manager"})
	require.True(t, g.OK, "the price engine's lag is position-scoped (G2), never pass-fatal")
}

// TestGatePassColdStartIsNotAReorg: an engine with no cursor row has never
// applied a window, so it has no rows to be stale.
func TestGatePassColdStartIsNotAReorg(t *testing.T) {
	v := newWatermarkVector(nil, map[int64]int64{1: 5}, consumed)
	g := gatePass(v, []string{"aave_v3_etherfi"})
	require.True(t, g.OK)
}

func TestGatePassReportsEveryOffendingEngine(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 100, 0),
		cur("aave_param", 1, 100, 0),
		cur("debt_manager", 10, 200, 0),
	}, map[int64]int64{1: 3, 10: 7}, consumed)

	g := gatePass(v, []string{"aave_v3_etherfi", "aave_param", "debt_manager"})
	require.False(t, g.OK)
	require.Len(t, g.Reasons, 3, "every gated engine is named, not just the first")
}

// ---------------------------------------------------------------------------
// Batch stamps.
// ---------------------------------------------------------------------------

// TestStampsForCarriesEveryConsumedEngine: the supersession check needs the
// PRICE engines' pairs too, because a price reorg after compute time supersedes
// a batch exactly as a position reorg does.
func TestStampsForCarriesEveryConsumedEngine(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 4),
		cur("prices:poll:1", 1, 25_635_600, 4),
		cur("debt_manager", 10, 154_796_552, 9),
	}, map[int64]int64{1: 4, 10: 9}, consumed)

	stamps := stampsFor(v)
	require.Len(t, stamps, 3)
	require.Equal(t, "aave_v3_etherfi", stamps[0].Engine, "stamps are ordered deterministically")
	require.Equal(t, "debt_manager", stamps[1].Engine)
	require.Equal(t, "prices:poll:1", stamps[2].Engine)

	byEngine := map[string]store.RiskBatchWatermark{}
	for _, s := range stamps {
		byEngine[s.Engine] = s
	}
	require.EqualValues(t, 4, byEngine["aave_v3_etherfi"].AckedEpoch)
	require.EqualValues(t, 4, byEngine["aave_v3_etherfi"].MaxEpochAtCompute)
	require.EqualValues(t, 9, byEngine["debt_manager"].MaxEpochAtCompute,
		"the per-CHAIN max epoch is stamped on each engine's row for that engine's chain")
	require.EqualValues(t, 25_635_600, byEngine["prices:poll:1"].LastBlock)
}

func TestWatermarkVectorStringIsDeterministic(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("debt_manager", 10, 200, 1),
		cur("aave_v3_etherfi", 1, 100, 0),
	}, map[int64]int64{10: 1, 1: 0}, consumed)
	first := v.String()
	for i := 0; i < 20; i++ {
		require.Equal(t, first, v.String())
	}
	require.Contains(t, first, "aave_v3_etherfi@100/ack0")
	require.Contains(t, first, "chain10:maxepoch1")
}
