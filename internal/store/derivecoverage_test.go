package store

// Live tests for the DERIVATION-COVERAGE stamp: the merge rule on apply, the
// clearing rule on rewind, and the fail-closed defaults.
//
// The property under test is not "a column round-trips". It is that the stamp
// cannot come to assert coverage of a range that was not walked — because the one
// consumer of it (riskfeed's collateral law) reads a missing witness as chain
// truth, and a stamp that over-claimed would license exactly the false liquidation
// alarm the round-1 finding described.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	cvGenesis = uint64(20_625_519)
	cvRev     = int32(2)
)

// cvBinding is the WALKED SURFACE these fixtures claim: one address at cvGenesis.
// Spelled through the production helper rather than as a literal, so a change to the
// binding's own encoding cannot silently make every fixture claim a stale surface.
var cvBinding = CoverageBindingOf(1, []CoverageStream{{Address: addr20(0xC1), StartBlock: cvGenesis}})

// cvReq is the requirement every fixture below is judged against.
func cvReq() CoverageRequirement {
	return CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}
}

// cvCoverage is the claim a walker of that surface would stamp.
func cvCoverage(from uint64) DerivationCoverage {
	return DerivationCoverage{FromBlock: from, DecoderRevision: cvRev, Binding: cvBinding}
}

func cvCursor(t *testing.T, s *Store, engine string) DeriveCursorState {
	t.Helper()
	states, err := DeriveCursorStates(context.Background(), s.pool)
	require.NoError(t, err)
	for _, c := range states {
		if c.Engine == engine {
			return c
		}
	}
	t.Fatalf("no derive cursor for %q", engine)
	return DeriveCursorState{}
}

func cvEvent(block uint64, tx byte) PositionEvent {
	return PositionEvent{
		ChainID: 1, Engine: riskAaveEngine, BlockNumber: block, TxHash: []byte{tx}, LogIndex: 0,
		EventType: AaveCollateralEnabledEvent, Account: addr20(0xA1), Asset: addr20(0xC1),
	}
}

// TestCoverageIsEstablishedAndExtendedByWalkingWindows: the first window sets the
// low end, later windows extend the high end without moving it.
func TestCoverageIsEstablishedAndExtendedByWalkingWindows(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+100,
		cvCoverage(cvGenesis)))

	c := cvCursor(t, s, riskAaveEngine)
	require.NotNil(t, c.CoveredFromBlock)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock)
	require.Equal(t, cvRev, c.DecoderRevision)
	require.True(t, c.CoverageClaim().Satisfies(cvReq()))

	// A second window: the cursor advances, the coverage ORIGIN does not.
	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+150, 0x02)}, nil, cvGenesis+200,
		cvCoverage(cvGenesis+101)))

	c = cvCursor(t, s, riskAaveEngine)
	require.EqualValues(t, cvGenesis+200, c.LastBlock)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock,
		"coverage keeps the LOWEST from seen — the walk's origin, not the newest window's")
	require.True(t, c.CoverageClaim().Satisfies(cvReq()))
}

// TestCoverageRestartsWhenTheDecoderRevisionChanges is the case the whole mechanism
// exists for: a binary that newly decodes an event must report that it has only
// covered from where IT started, never inherit the previous walk's reach.
//
// MUTANT THIS KILLS: drop the `decoder_revision <> EXCLUDED.decoder_revision`
// branch from the merge rule (so coverage merely extends). The upgraded binary then
// claims coverage from genesis over rows its predecessor decoded without the flag
// topics — precisely the false-custody state, and the gate would pass.
func TestCoverageRestartsWhenTheDecoderRevisionChanges(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// The OLD binary walks from genesis under revision 1.
	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+1000,
		DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: 1, Binding: cvBinding}))
	c := cvCursor(t, s, riskAaveEngine)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock)
	require.EqualValues(t, 1, c.DecoderRevision)
	require.False(t, c.CoverageClaim().Satisfies(cvReq()),
		"revision 1 cannot vouch for events that entered the registry at revision 2")

	// The NEW binary resumes at the cursor under revision 2. Coverage restarts here.
	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+1100, 0x02)}, nil, cvGenesis+2000,
		cvCoverage(cvGenesis+1001)))

	c = cvCursor(t, s, riskAaveEngine)
	require.Equal(t, cvGenesis+1001, *c.CoveredFromBlock,
		"the upgraded binary has covered only from where IT began")
	require.Equal(t, cvRev, c.DecoderRevision)
	require.False(t, c.CoverageClaim().Satisfies(cvReq()),
		"THE FINDING: a head cursor under the new registry is still not genesis coverage")
}

// TestCoverageIsClearedByANonAssertingWindow: a caller that does not know what it
// walked must not be able to leave a claim standing that it did.
func TestCoverageIsClearedByANonAssertingWindow(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+100,
		cvCoverage(cvGenesis)))
	require.True(t, cvCursor(t, s, riskAaveEngine).CoverageClaim().Satisfies(cvReq()))

	// The coverage-free entry point — a tool or a fixture.
	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+150, 0x02)}, nil, cvGenesis+200))

	c := cvCursor(t, s, riskAaveEngine)
	require.Nil(t, c.CoveredFromBlock,
		"after a window nobody vouched for, the stored range is no longer attributable to a known walk")
	require.EqualValues(t, 0, c.DecoderRevision)
	require.False(t, c.CoverageClaim().Satisfies(cvReq()))
}

// TestCoverageSurvivesAShallowRewindAndIsClearedByADeepOne is the atomicity half.
//
// A rewind that removes only the TOP of a covered range leaves the range's origin
// intact; a rewind BELOW the origin removes every row the claim described, so the
// claim must die with them. If it survived, a rewind to StartBlock−1 — the backfill
// operation itself — would leave a stamp asserting genesis coverage over an empty
// ledger: the false-custody state, manufactured by the repair.
//
// MUTANT THIS KILLS: drop the covered_from_block CASE from RewindDerived's cursor
// reset. The deep-rewind assertion then finds coverage still claimed.
func TestCoverageSurvivesAShallowRewindAndIsClearedByADeepOne(t *testing.T) {
	ctx := context.Background()

	t.Run("shallow rewind keeps the origin", func(t *testing.T) {
		s := testDeriveStore(t)
		require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
			[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+1000,
			cvCoverage(cvGenesis)))

		require.NoError(t, s.RewindDerived(ctx, riskAaveEngine, 1, cvGenesis+500))
		c := cvCursor(t, s, riskAaveEngine)
		require.NotNil(t, c.CoveredFromBlock)
		require.Equal(t, cvGenesis, *c.CoveredFromBlock,
			"the range lost its top, not its origin, and re-derivation continues upward from the target")
		require.Equal(t, cvRev, c.DecoderRevision)
		require.True(t, c.CoverageClaim().Satisfies(cvReq()))
	})

	t.Run("deep rewind clears it", func(t *testing.T) {
		s := testDeriveStore(t)
		require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
			[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+1000,
			cvCoverage(cvGenesis)))

		// Exactly the backfill's first step: rewind to StartBlock-1.
		require.NoError(t, s.RewindDerived(ctx, riskAaveEngine, 1, cvGenesis-1))
		c := cvCursor(t, s, riskAaveEngine)
		require.Nil(t, c.CoveredFromBlock,
			"every row the claim described was just deleted, so the claim goes with them")
		require.EqualValues(t, 0, c.DecoderRevision)
		require.False(t, c.CoverageClaim().Satisfies(cvReq()))

		// And the ledger really is empty — the two facts are consistent, which is
		// the point of clearing atomically.
		flags, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, cvGenesis+1000)
		require.NoError(t, err)
		require.Empty(t, flags)
	})
}

// TestCoverageClaimSatisfiesFailsClosed pins the pure predicate every consumer shares.
func TestCoverageClaimSatisfiesFailsClosed(t *testing.T) {
	genesis := cvGenesis
	above := cvGenesis + 1

	require.True(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "exactly at genesis")
	require.True(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev + 1, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "a LATER revision still satisfies it")

	require.False(t, CoverageClaim{CoveredFromBlock: nil, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "nil is unknown, not genesis")
	require.False(t, CoverageClaim{CoveredFromBlock: &above, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "one block late is late")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev - 1, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "an older registry cannot vouch")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: 0, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: cvBinding}), "revision 0 asserts nothing")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: 0, MinDecoderRevision: cvRev, Binding: cvBinding}),
		"an UNCONFIGURED genesis must refuse, or the gate would pass everything")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: 0, Binding: cvBinding}),
		"a zero requirement is a misconfigured caller, not a satisfied one")

	// THE BINDING LEGS. A claim over a DIFFERENT walked surface cannot license a
	// requirement, however far back it reaches.
	other := CoverageBindingOf(1, []CoverageStream{
		{Address: addr20(0xC1), StartBlock: cvGenesis},
		{Address: addr20(0xC2), StartBlock: cvGenesis}, // a stream ADDED
	})
	require.NotEqual(t, cvBinding, other, "adding a stream must change the binding")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: other}),
		"coverage walked over the OLD surface cannot vouch for a newly added address")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: ""}.Satisfies(cvReq()),
		"an empty claim binding asserts nothing")
	require.False(t, CoverageClaim{CoveredFromBlock: &genesis, DecoderRevision: cvRev, Binding: cvBinding}.Satisfies(CoverageRequirement{GenesisBlock: cvGenesis, MinDecoderRevision: cvRev, Binding: ""}),
		"an empty REQUIREMENT binding is an unwired reader, refused rather than satisfied")
}
