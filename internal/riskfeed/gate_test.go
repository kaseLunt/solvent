package riskfeed

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func gateCursor(engine string, chain int64, block uint64, acked int64) store.DeriveCursorState {
	return store.DeriveCursorState{Engine: engine, ChainID: chain, LastBlock: block, AckedEpoch: acked}
}

const (
	gateAave  = "aave_v3_etherfi"
	gateParam = "aave_param"
	gateDM    = "debt_manager"
)

// ---------------------------------------------------------------------------
// The three refusal classes.
// ---------------------------------------------------------------------------

// TestGateEpochsRefusesUnackedEpoch is Window A: an epoch is recorded on the
// engine's chain and its ack has not landed, so its derived rows may describe
// blocks the raw rewind already deleted.
func TestGateEpochsRefusesUnackedEpoch(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor(gateAave, 1, 25_635_618, 4),
			gateCursor(gateParam, 1, 25_635_618, 5),
		},
		map[int64]int64{1: 5},
		[]RequiredCursor{{gateAave, 1}, {gateParam, 1}})
	require.NoError(t, err)

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1)
	require.Equal(t, gateAave, v.Refusals[0].Engine)
	require.Equal(t, GateReasonUnackedEpoch, v.Refusals[0].Class)
	require.EqualValues(t, 4, v.Refusals[0].AckedEpoch)
	require.EqualValues(t, 5, v.Refusals[0].MaxEpoch)
	require.Contains(t, v.Reasons()[0], "already deleted")
}

// TestGateEpochsRefusesMissingCursor is the FIRST high finding, pinned.
//
// MUTANT THIS KILLS: the original implementation appended the engine to a
// `Missing` list and `continue`d with OK unchanged. Under that code the assertion
// below fails — a required engine that has never proven custody of any block
// sails through the gate, and riskd computes against an unproven parameter or
// position head. A blocker that is only reported is not a blocker.
func TestGateEpochsRefusesMissingCursor(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{gateCursor(gateAave, 1, 25_635_618, 0)},
		map[int64]int64{},
		[]RequiredCursor{{gateAave, 1}, {gateParam, 1}})
	require.NoError(t, err)

	require.False(t, v.OK, "a required engine with NO cursor must refuse the pass")
	require.Len(t, v.Refusals, 1)
	require.Equal(t, gateParam, v.Refusals[0].Engine)
	require.Equal(t, GateReasonMissingCursor, v.Refusals[0].Class)
	require.EqualValues(t, 1, v.Refusals[0].WantChainID)
	require.Contains(t, v.Reasons()[0], "NO derive cursor")
}

// TestGateEpochsRefusesEveryMissingCursorWhenNoneExist: the degenerate
// no-cursors-at-all case is the SAME law, not an exemption. A cold start is not a
// licence to compute.
func TestGateEpochsRefusesEveryMissingCursorWhenNoneExist(t *testing.T) {
	v, err := GateEpochs(nil, map[int64]int64{1: 5},
		[]RequiredCursor{{gateAave, 1}, {gateParam, 1}})
	require.NoError(t, err)
	require.False(t, v.OK)
	require.Len(t, v.Refusals, 2)
	require.Equal(t, []string{GateReasonMissingCursor, GateReasonMissingCursor}, v.Classes())
	require.Equal(t, []string{gateParam, gateAave},
		[]string{v.Refusals[0].Engine, v.Refusals[1].Engine}, "engine-ordered")
}

// TestGateEpochsRefusesWrongChainCursor is the second half of the first finding.
//
// MUTANT THIS KILLS: the original signature carried no expected ChainID at all,
// so this state was not merely unrefused — it was UNREPRESENTABLE. The cursor's
// own (wrong) chain was used to look up the epoch maximum, so an OP cursor was
// judged against OP's epochs and then its height went on to bound an ETH
// parameter query. Below, chain 10's epochs are fully acked while chain 1 carries
// an unacked epoch: a chain-blind gate reports "all clear" on exactly the input
// that must be refused.
func TestGateEpochsRefusesWrongChainCursor(t *testing.T) {
	v, err := GateEpochs(
		// The param engine is bound to OP (10), fully acked THERE...
		[]store.DeriveCursorState{gateCursor(gateParam, 10, 154_000_000, 7)},
		// ...while chain 10 has no unacked epoch and chain 1 does.
		map[int64]int64{10: 7, 1: 99},
		// ...but the pass requires it on ETH (1).
		[]RequiredCursor{{gateParam, 1}})
	require.NoError(t, err)

	require.False(t, v.OK, "a cursor bound to the wrong chain must refuse, not be judged against that chain")
	require.Len(t, v.Refusals, 1)
	require.Equal(t, GateReasonChainMismatch, v.Refusals[0].Class)
	require.EqualValues(t, 1, v.Refusals[0].WantChainID)
	require.EqualValues(t, 10, v.Refusals[0].GotChainID)
	require.Contains(t, v.Reasons()[0], "bound to chain 10")
	require.Contains(t, v.Reasons()[0], "requires chain 1")
}

// TestGateEpochsChainMismatchOutranksEpochCheck: a wrong-chain cursor is refused
// on the binding, never "fixed" by comparing it against the right chain's epochs.
func TestGateEpochsChainMismatchOutranksEpochCheck(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{gateCursor(gateParam, 10, 100, 0)},
		map[int64]int64{1: 0, 10: 0}, // nothing lagging anywhere
		[]RequiredCursor{{gateParam, 1}})
	require.NoError(t, err)
	require.False(t, v.OK, "fully-acked-on-the-wrong-chain is still a refusal")
	require.Equal(t, []string{GateReasonChainMismatch}, v.Classes())
}

func TestGateEpochsAdmitsAckedEpoch(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{gateCursor(gateDM, 10, 154_796_552, 9)},
		map[int64]int64{10: 9},
		[]RequiredCursor{{gateDM, 10}})
	require.NoError(t, err)
	require.True(t, v.OK)
	require.Empty(t, v.Refusals)
	require.Empty(t, v.Reasons())
}

// TestGateEpochsReportsEveryOffendingEngine — a gate that named only the first
// refusal would hide the rest of the outage, and would let a fix of one engine
// look like a fix of all.
func TestGateEpochsReportsEveryOffendingEngine(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor(gateAave, 1, 100, 0),   // lagging
			gateCursor(gateParam, 10, 100, 0), // wrong chain
			// debt_manager: missing entirely
		},
		map[int64]int64{1: 3, 10: 7},
		[]RequiredCursor{{gateAave, 1}, {gateParam, 1}, {gateDM, 10}})
	require.NoError(t, err)

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 3, "all three classes surface together")
	require.Equal(t, []string{gateParam, gateAave, gateDM},
		[]string{v.Refusals[0].Engine, v.Refusals[1].Engine, v.Refusals[2].Engine},
		"refusals are engine-ordered, so two runs produce the same message")
	require.ElementsMatch(t,
		[]string{GateReasonChainMismatch, GateReasonUnackedEpoch, GateReasonMissingCursor},
		v.Classes())
}

// TestGateEpochsPerChain: an epoch on one chain must not refuse an engine bound
// to the other.
func TestGateEpochsPerChain(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{
			gateCursor(gateAave, 1, 100, 0),
			gateCursor(gateDM, 10, 200, 0),
		},
		map[int64]int64{10: 7}, // only OP carries an epoch
		[]RequiredCursor{{gateAave, 1}, {gateDM, 10}})
	require.NoError(t, err)

	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1)
	require.Equal(t, gateDM, v.Refusals[0].Engine)
}

func TestGateEpochsDeduplicatesPairsAndIgnoresBlanks(t *testing.T) {
	// The Debt Manager's param engine IS its position engine, so a caller's
	// requirement list legitimately contains the same PAIR twice.
	v, err := GateEpochs(
		[]store.DeriveCursorState{gateCursor(gateDM, 10, 200, 0)},
		map[int64]int64{10: 7},
		[]RequiredCursor{{gateDM, 10}, {gateDM, 10}, {"", 0}})
	require.NoError(t, err)
	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1, "one pair, one refusal, however many times it was named")
}

// TestGateEpochsSameEngineOnTwoChainsCannotBothPass: requiring one engine on two
// chains is a caller bug, and collapsing it would hide that. At most one binding
// can hold, so the other must refuse.
func TestGateEpochsSameEngineOnTwoChainsCannotBothPass(t *testing.T) {
	v, err := GateEpochs(
		[]store.DeriveCursorState{gateCursor(gateDM, 10, 200, 0)},
		map[int64]int64{},
		[]RequiredCursor{{gateDM, 10}, {gateDM, 1}})
	require.NoError(t, err)
	require.False(t, v.OK)
	require.Len(t, v.Refusals, 1)
	require.Equal(t, GateReasonChainMismatch, v.Refusals[0].Class)
	require.EqualValues(t, 1, v.Refusals[0].WantChainID)
}

// TestGateEpochsEmptyRequirementSetIsAnError closes the degenerate case as a HARD
// ERROR rather than an allow.
//
// MUTANT THIS KILLS: returning `EpochGateVerdict{OK: true}, nil` for an empty
// set. A caller whose requirement list came out empty — an unconfigured engine
// set, a typo — would then receive a green light from the very check meant to
// stop it, and every downstream refusal path would be dead code.
func TestGateEpochsEmptyRequirementSetIsAnError(t *testing.T) {
	for _, required := range [][]RequiredCursor{nil, {}, {{Engine: "", ChainID: 0}}} {
		_, err := GateEpochs(
			[]store.DeriveCursorState{gateCursor(gateAave, 1, 100, 0)},
			map[int64]int64{1: 99}, required)
		require.ErrorIs(t, err, ErrNoRequiredCursors)
	}
}
