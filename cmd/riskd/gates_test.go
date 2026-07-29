package main

// The watermark VECTOR and the batch STAMPS. The gate's own law lives with the
// predicate in internal/riskfeed (gate_test.go) now that it is importable; what
// is tested here is the daemon's composition of it: what goes into the vector,
// what counts as a change, and what gets stamped.

import (
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

func cur(engine string, chain int64, block uint64, acked int64) store.DeriveCursorState {
	return store.DeriveCursorState{Engine: engine, ChainID: chain, LastBlock: block, AckedEpoch: acked}
}

var consumed = []string{"aave_v3_etherfi", "aave_param", "debt_manager", "prices:poll:1", "prices:poll:10"}

// sweep builds a sweep aggregate for the vector.
func sweep(engine string, rows, failed int64, successSum int64, at time.Time, gen uint64, open bool) store.RiskSweepWatermark {
	w := store.RiskSweepWatermark{
		Engine: engine, Rows: rows, Failed: failed,
		SuccessSum: big.NewInt(successSum), Generation: gen, GenerationOpen: open,
	}
	if !at.IsZero() {
		w.HasUpdatedAt, w.MaxUpdatedAt = true, at
	}
	return w
}

var sweepT0 = time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)

// TestWatermarkVectorABARegression is the reason the trigger compares
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
		map[int64]int64{1: 4}, nil, consumed)

	during := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_600, 5)},
		map[int64]int64{1: 5}, nil, consumed)
	require.True(t, during.Changed(before))

	// The re-walk regains the ORIGINAL height. Same last_block, different ack.
	after := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_618, 5)},
		map[int64]int64{1: 5}, nil, consumed)

	require.Equal(t, before.Engines["aave_v3_etherfi"].LastBlock, after.Engines["aave_v3_etherfi"].LastBlock,
		"the fixture must actually regain the height, or it does not test ABA")
	require.True(t, after.Changed(before),
		"the acked_epoch leg must fire: last_block alone is blind to a completed rewind cycle")
}

func TestWatermarkVectorSurvivesEpochPruning(t *testing.T) {
	before := newWatermarkVector(
		[]store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)},
		map[int64]int64{}, nil, consumed)
	after := newWatermarkVector(
		[]store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 9)},
		map[int64]int64{}, nil, consumed)

	require.Equal(t, before.MaxEpochs, after.MaxEpochs, "pruning erased the epoch evidence...")
	require.True(t, after.Changed(before), "...and acked_epoch is what remains")
}

func TestWatermarkVectorUnchangedWhenNothingMoved(t *testing.T) {
	cursors := []store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 4),
		cur("prices:poll:1", 1, 25_635_600, 4),
	}
	sweeps := []store.RiskSweepWatermark{sweep("debt_manager", 3, 0, 300, sweepT0, 7, false)}
	a := newWatermarkVector(cursors, map[int64]int64{1: 4}, sweeps, consumed)
	b := newWatermarkVector(cursors, map[int64]int64{1: 4}, sweeps, consumed)
	require.False(t, b.Changed(a))
}

func TestWatermarkVectorTracksPriceCursors(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{cur("prices:poll:10", 10, 100, 0)},
		map[int64]int64{}, nil, consumed)
	b := newWatermarkVector([]store.DeriveCursorState{cur("prices:poll:10", 10, 101, 0)},
		map[int64]int64{}, nil, consumed)
	require.True(t, b.Changed(a))
}

func TestWatermarkVectorIgnoresUnconsumedEngines(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 100, 0),
		cur("chainlink_feed_something", 1, 100, 0),
	}, map[int64]int64{}, nil, consumed)
	b := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 100, 0),
		cur("chainlink_feed_something", 1, 999, 0),
	}, map[int64]int64{}, nil, consumed)
	require.False(t, b.Changed(a), "an engine this pass does not consume cannot trigger a recompute")
	require.Len(t, a.Engines, 1)
}

func TestWatermarkVectorVanishedEngineIsAChange(t *testing.T) {
	a := newWatermarkVector([]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 100, 0)},
		map[int64]int64{}, nil, consumed)
	b := newWatermarkVector(nil, map[int64]int64{}, nil, consumed)
	require.True(t, b.Changed(a))
}

func TestWatermarkVectorRecordedButUnackedEpochIsAChange(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("aave_v3_etherfi", 1, 25_635_618, 4)}
	a := newWatermarkVector(cursors, map[int64]int64{1: 4}, nil, consumed)
	b := newWatermarkVector(cursors, map[int64]int64{1: 5}, nil, consumed)
	require.True(t, b.Changed(a))
}

// ---------------------------------------------------------------------------
// The sweep leg of the vector.
// ---------------------------------------------------------------------------
//
// Each case below holds EVERY derive cursor and epoch fixed, so the only thing
// that can make Changed fire is the sweep aggregate. Delete the sweep leg from
// Changed and every one of these returns false — which is exactly the state in
// which the corresponding stale publication survives.

func TestWatermarkVectorSweepFirstSuccessIsAChange(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)}
	// Never swept: no rows at all.
	before := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 0, 0, 0, time.Time{}, 0, false)}, consumed)
	// The first sweep succeeds: a row exists and a success block is recorded.
	after := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 1, 0, 154_790_000, sweepT0, 1, false)}, consumed)

	require.Equal(t, before.Engines, after.Engines, "no cursor moved — this is the sweep leg or nothing")
	require.True(t, after.Changed(before),
		"a first successful sweep must recompute: otherwise a published SWEEP_NEVER refusal stands over collateral that is now known")
}

func TestWatermarkVectorSweepFailureAfterSuccessIsAChange(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)}
	before := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 1, 0, 154_790_000, sweepT0, 1, false)}, consumed)
	// The next sweep FAILS. Row count and success sum are unchanged — only the
	// failure count and the update stamp move.
	after := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 1, 1, 154_790_000, sweepT0.Add(time.Hour), 2, false)}, consumed)

	require.Equal(t, before.Engines, after.Engines)
	require.True(t, after.Changed(before),
		"a post-success failure must recompute: otherwise the previous UNFLAGGED result stands with no staleness disclosure")
}

// TestWatermarkVectorSweepSuccessSumUsesSumNotMax: a lagging account catching up
// BEHIND an already-higher peer moves the sum but not the max. A MAX-based key
// would miss it entirely.
func TestWatermarkVectorSweepSuccessSumUsesSumNotMax(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)}
	before := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 2, 0, 100+500, sweepT0, 1, false)}, consumed)
	// Account A moves 100 → 200; the peer is still at 500, so MAX(500) is
	// unchanged while the SUM moves 600 → 700.
	after := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 2, 0, 200+500, sweepT0, 1, false)}, consumed)
	require.True(t, after.Changed(before))
}

func TestWatermarkVectorSweepGenerationOpenIsAChange(t *testing.T) {
	cursors := []store.DeriveCursorState{cur("debt_manager", 10, 154_796_552, 0)}
	before := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 1, 0, 100, sweepT0, 1, false)}, consumed)
	after := newWatermarkVector(cursors, map[int64]int64{},
		[]store.RiskSweepWatermark{sweep("debt_manager", 1, 0, 100, sweepT0, 2, true)}, consumed)
	require.True(t, after.Changed(before))
}

// TestSweepEqualComparesBigIntByValue: a pointer comparison would report every
// read as a change and recompute forever.
func TestSweepEqualComparesBigIntByValue(t *testing.T) {
	a := sweep("debt_manager", 1, 0, 12345, sweepT0, 1, false)
	b := sweep("debt_manager", 1, 0, 12345, sweepT0, 1, false)
	require.NotSame(t, a.SuccessSum, b.SuccessSum, "distinct pointers, equal values")
	require.True(t, sweepEqual(a, b))

	c := sweep("debt_manager", 1, 0, 12346, sweepT0, 1, false)
	require.False(t, sweepEqual(a, c))
}

// TestSweepEqualDistinguishesAbsentTimestamp: "never swept" must not compare
// equal to "swept at the zero time".
func TestSweepEqualDistinguishesAbsentTimestamp(t *testing.T) {
	never := sweep("debt_manager", 0, 0, 0, time.Time{}, 0, false)
	zeroTime := never
	zeroTime.HasUpdatedAt = true
	require.False(t, sweepEqual(never, zeroTime))
}

// ---------------------------------------------------------------------------
// Batch stamps.
// ---------------------------------------------------------------------------

func TestStampsForCarriesEveryConsumedEngine(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 4),
		cur("prices:poll:1", 1, 25_635_600, 4),
		cur("debt_manager", 10, 154_796_552, 9),
	}, map[int64]int64{1: 4, 10: 9},
		[]store.RiskSweepWatermark{sweep("debt_manager", 2, 1, 600, sweepT0, 3, false)}, consumed)

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

	// The CONSUMED sweep state is stamped on the engine that has one, and only
	// on that engine — nil stays nil rather than becoming an all-zero row.
	require.NotNil(t, byEngine["debt_manager"].Sweep)
	require.EqualValues(t, 2, byEngine["debt_manager"].Sweep.Rows)
	require.EqualValues(t, 1, byEngine["debt_manager"].Sweep.Failed)
	require.Equal(t, "600", byEngine["debt_manager"].Sweep.SuccessSum.String())
	require.Nil(t, byEngine["aave_v3_etherfi"].Sweep, "the Aave engine has no collateral sweep")
	require.Nil(t, byEngine["prices:poll:1"].Sweep)
}

func TestWatermarkVectorStringIsDeterministic(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("debt_manager", 10, 200, 1),
		cur("aave_v3_etherfi", 1, 100, 0),
	}, map[int64]int64{10: 1, 1: 0}, nil, consumed)
	first := v.String()
	for i := 0; i < 20; i++ {
		require.Equal(t, first, v.String())
	}
	require.Contains(t, first, "aave_v3_etherfi@100/ack0")
	require.Contains(t, first, "chain10:maxepoch1")
}

// ---------------------------------------------------------------------------
// The daemon's composition of the gate.
// ---------------------------------------------------------------------------

// TestGatePassRefusesMissingRequiredCursor is the finding this fix closes at the
// DAEMON level: the pass gate must refuse an engine with no cursor, not merely
// note it and continue.
func TestGatePassRefusesMissingRequiredCursor(t *testing.T) {
	v := newWatermarkVector(
		[]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 100, 0)},
		map[int64]int64{}, nil, consumed)

	g, err := gatePass(v, []riskfeed.RequiredCursor{
		{Engine: "aave_v3_etherfi", ChainID: 1},
		{Engine: "aave_param", ChainID: 1}, // never applied a window
	})
	require.NoError(t, err)
	require.False(t, g.OK, "a missing param cursor must REFUSE the pass, not pass it with a note")
	require.Contains(t, g.Err().Error(), "aave_param")
}

func TestGatePassRefusesWrongChainCursor(t *testing.T) {
	v := newWatermarkVector(
		// The param engine's cursor is bound to OP, but the pass needs ETH.
		[]store.DeriveCursorState{cur("aave_param", 10, 154_000_000, 0)},
		map[int64]int64{}, nil, consumed)

	g, err := gatePass(v, []riskfeed.RequiredCursor{{Engine: "aave_param", ChainID: 1}})
	require.NoError(t, err)
	require.False(t, g.OK)
	require.Contains(t, g.Err().Error(), "bound to chain 10")
}

func TestGatePassAdmitsFullyAckedSet(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{
		cur("aave_v3_etherfi", 1, 25_635_618, 5),
		cur("aave_param", 1, 25_635_618, 5),
	}, map[int64]int64{1: 5}, nil, consumed)

	g, err := gatePass(v, []riskfeed.RequiredCursor{
		{Engine: "aave_v3_etherfi", ChainID: 1},
		{Engine: "aave_param", ChainID: 1},
	})
	require.NoError(t, err)
	require.True(t, g.OK)
	require.NoError(t, g.Err())
}

// TestGatePassEmptyRequirementSetIsAHardError: a gate that could only ever allow
// must not silently allow.
func TestGatePassEmptyRequirementSetIsAHardError(t *testing.T) {
	v := newWatermarkVector([]store.DeriveCursorState{cur("aave_v3_etherfi", 1, 100, 0)},
		map[int64]int64{1: 99}, nil, consumed)
	_, err := gatePass(v, nil)
	require.ErrorIs(t, err, riskfeed.ErrNoRequiredCursors)
}

// TestGatedEnginesCarriesChainBindings proves the daemon actually supplies the
// PAIRS — a config that emitted bare names would leave the wrong-chain leg with
// nothing to compare against.
func TestGatedEnginesCarriesChainBindings(t *testing.T) {
	cfg := &daemonConfig{
		Aave: riskfeed.EngineBinding{Engine: "aave_v3_etherfi", ChainID: 1, ParamEngine: "aave_param"},
		DM:   riskfeed.EngineBinding{Engine: "debt_manager", ChainID: 10, ParamEngine: "debt_manager"},
	}
	got := cfg.gatedEngines()
	require.ElementsMatch(t, []riskfeed.RequiredCursor{
		{Engine: "aave_v3_etherfi", ChainID: 1},
		{Engine: "aave_param", ChainID: 1},
		{Engine: "debt_manager", ChainID: 10},
	}, got, "the DM param engine IS its position engine, so the pair deduplicates")
	for _, r := range got {
		require.NotZero(t, r.ChainID, "every requirement must name its chain")
	}
}
