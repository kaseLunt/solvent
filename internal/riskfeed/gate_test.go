package riskfeed

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func gateCursor(engine string, chain int64, block uint64, acked int64) store.DeriveCursorState {
	return store.DeriveCursorState{Engine: engine, ChainID: chain, LastBlock: block, AckedEpoch: acked}
}

// TestGateEpochsRefusesUnackedEpoch is Window A: an epoch is recorded on the
// engine's chain and its ack has not landed, so its derived rows may describe
// blocks the raw rewind already deleted.
func TestGateEpochsRefusesUnackedEpoch(t *testing.T) {
	v := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor("aave_v3_etherfi", 1, 25_635_618, 4),
			gateCursor("aave_param", 1, 25_635_618, 5),
		},
		map[int64]int64{1: 5},
		[]string{"aave_v3_etherfi", "aave_param"})

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1)
	require.Equal(t, "aave_v3_etherfi", v.Refusals[0].Engine)
	require.EqualValues(t, 4, v.Refusals[0].AckedEpoch)
	require.EqualValues(t, 5, v.Refusals[0].MaxEpoch)
	require.Contains(t, v.Reasons()[0], "already deleted")
	require.Empty(t, v.Missing)
}

func TestGateEpochsAdmitsAckedEpoch(t *testing.T) {
	v := GateEpochs(
		[]store.DeriveCursorState{gateCursor("debt_manager", 10, 154_796_552, 9)},
		map[int64]int64{10: 9},
		[]string{"debt_manager"})
	require.True(t, v.OK)
	require.Empty(t, v.Refusals)
	require.Empty(t, v.Reasons())
}

// TestGateEpochsColdStartIsReportedNotRefused pins the distinction the harness
// asserts on: an engine with no cursor row has never applied a window, so it has
// no rows a rewind could have invalidated.
func TestGateEpochsColdStartIsReportedNotRefused(t *testing.T) {
	v := GateEpochs(nil, map[int64]int64{1: 5}, []string{"aave_v3_etherfi", "aave_param"})
	require.True(t, v.OK, "a cold start is not a reorg")
	require.Empty(t, v.Refusals)
	require.Equal(t, []string{"aave_param", "aave_v3_etherfi"}, v.Missing,
		"...but it IS reported, engine-ordered, so a caller that cares can act on it")
}

// TestGateEpochsReportsEveryOffendingEngine — a gate that named only the first
// refusal would hide the rest of the outage.
func TestGateEpochsReportsEveryOffendingEngine(t *testing.T) {
	v := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor("aave_v3_etherfi", 1, 100, 0),
			gateCursor("aave_param", 1, 100, 0),
			gateCursor("debt_manager", 10, 200, 0),
		},
		map[int64]int64{1: 3, 10: 7},
		[]string{"aave_v3_etherfi", "aave_param", "debt_manager"})

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 3)
	require.Equal(t, []string{"aave_param", "aave_v3_etherfi", "debt_manager"},
		[]string{v.Refusals[0].Engine, v.Refusals[1].Engine, v.Refusals[2].Engine},
		"refusals are engine-ordered, so two runs produce the same message")
}

// TestGateEpochsPerChain: an epoch on one chain must not refuse an engine bound
// to the other.
func TestGateEpochsPerChain(t *testing.T) {
	v := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor("aave_v3_etherfi", 1, 100, 0),
			gateCursor("debt_manager", 10, 200, 0),
		},
		map[int64]int64{10: 7}, // only OP carries an epoch
		[]string{"aave_v3_etherfi", "debt_manager"})

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1)
	require.Equal(t, "debt_manager", v.Refusals[0].Engine)
}

func TestGateEpochsDeduplicatesAndIgnoresBlanks(t *testing.T) {
	// The Debt Manager's param engine IS its position engine, so a caller's
	// engine list legitimately contains the same name twice.
	v := GateEpochs(
		[]store.DeriveCursorState{gateCursor("debt_manager", 10, 200, 0)},
		map[int64]int64{10: 7},
		[]string{"debt_manager", "debt_manager", ""})
	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1, "one engine, one refusal, however many times it was named")
}

// TestGateEpochsEmptyRequirementSetCannotRefuse states the honest limitation
// plainly: with nothing required, there is nothing to refuse. Callers must pass
// the engines they actually consume.
func TestGateEpochsEmptyRequirementSetCannotRefuse(t *testing.T) {
	v := GateEpochs(
		[]store.DeriveCursorState{gateCursor("aave_v3_etherfi", 1, 100, 0)},
		map[int64]int64{1: 99}, nil)
	require.True(t, v.OK)
	require.Empty(t, v.Refusals)
}
