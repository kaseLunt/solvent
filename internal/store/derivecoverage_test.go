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
		DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: cvRev}))

	c := cvCursor(t, s, riskAaveEngine)
	require.NotNil(t, c.CoveredFromBlock)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock)
	require.Equal(t, cvRev, c.DecoderRevision)
	require.True(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))

	// A second window: the cursor advances, the coverage ORIGIN does not.
	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+150, 0x02)}, nil, cvGenesis+200,
		DerivationCoverage{FromBlock: cvGenesis + 101, DecoderRevision: cvRev}))

	c = cvCursor(t, s, riskAaveEngine)
	require.EqualValues(t, cvGenesis+200, c.LastBlock)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock,
		"coverage keeps the LOWEST from seen — the walk's origin, not the newest window's")
	require.True(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))
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
		DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: 1}))
	c := cvCursor(t, s, riskAaveEngine)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock)
	require.EqualValues(t, 1, c.DecoderRevision)
	require.False(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev),
		"revision 1 cannot vouch for events that entered the registry at revision 2")

	// The NEW binary resumes at the cursor under revision 2. Coverage restarts here.
	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+1100, 0x02)}, nil, cvGenesis+2000,
		DerivationCoverage{FromBlock: cvGenesis + 1001, DecoderRevision: cvRev}))

	c = cvCursor(t, s, riskAaveEngine)
	require.Equal(t, cvGenesis+1001, *c.CoveredFromBlock,
		"the upgraded binary has covered only from where IT began")
	require.Equal(t, cvRev, c.DecoderRevision)
	require.False(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev),
		"THE FINDING: a head cursor under the new registry is still not genesis coverage")
}

// TestCoverageIsClearedByANonAssertingWindow: a caller that does not know what it
// walked must not be able to leave a claim standing that it did.
func TestCoverageIsClearedByANonAssertingWindow(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+100,
		DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: cvRev}))
	require.True(t, CoverageProvenBack(cvCursor(t, s, riskAaveEngine).CoveredFromBlock,
		cvCursor(t, s, riskAaveEngine).DecoderRevision, cvGenesis, cvRev))

	// The coverage-free entry point — a tool or a fixture.
	require.NoError(t, s.ApplyDerivedWithRates(ctx, riskAaveEngine, 1,
		[]PositionEvent{cvEvent(cvGenesis+150, 0x02)}, nil, cvGenesis+200))

	c := cvCursor(t, s, riskAaveEngine)
	require.Nil(t, c.CoveredFromBlock,
		"after a window nobody vouched for, the stored range is no longer attributable to a known walk")
	require.EqualValues(t, 0, c.DecoderRevision)
	require.False(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))
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
			DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: cvRev}))

		require.NoError(t, s.RewindDerived(ctx, riskAaveEngine, 1, cvGenesis+500))
		c := cvCursor(t, s, riskAaveEngine)
		require.NotNil(t, c.CoveredFromBlock)
		require.Equal(t, cvGenesis, *c.CoveredFromBlock,
			"the range lost its top, not its origin, and re-derivation continues upward from the target")
		require.Equal(t, cvRev, c.DecoderRevision)
		require.True(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))
	})

	t.Run("deep rewind clears it", func(t *testing.T) {
		s := testDeriveStore(t)
		require.NoError(t, s.ApplyDerivedWindow(ctx, riskAaveEngine, 1,
			[]PositionEvent{cvEvent(cvGenesis+10, 0x01)}, nil, cvGenesis+1000,
			DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: cvRev}))

		// Exactly the backfill's first step: rewind to StartBlock-1.
		require.NoError(t, s.RewindDerived(ctx, riskAaveEngine, 1, cvGenesis-1))
		c := cvCursor(t, s, riskAaveEngine)
		require.Nil(t, c.CoveredFromBlock,
			"every row the claim described was just deleted, so the claim goes with them")
		require.EqualValues(t, 0, c.DecoderRevision)
		require.False(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))

		// And the ledger really is empty — the two facts are consistent, which is
		// the point of clearing atomically.
		flags, err := CollateralFlagsAsOf(ctx, s.pool, riskAaveEngine, 1, cvGenesis+1000)
		require.NoError(t, err)
		require.Empty(t, flags)
	})
}

// TestCoverageProvenBackFailsClosed pins the pure predicate every consumer shares.
func TestCoverageProvenBackFailsClosed(t *testing.T) {
	genesis := cvGenesis
	above := cvGenesis + 1

	require.True(t, CoverageProvenBack(&genesis, cvRev, cvGenesis, cvRev), "exactly at genesis")
	require.True(t, CoverageProvenBack(&genesis, cvRev+1, cvGenesis, cvRev), "a LATER revision still satisfies it")

	require.False(t, CoverageProvenBack(nil, cvRev, cvGenesis, cvRev), "nil is unknown, not genesis")
	require.False(t, CoverageProvenBack(&above, cvRev, cvGenesis, cvRev), "one block late is late")
	require.False(t, CoverageProvenBack(&genesis, cvRev-1, cvGenesis, cvRev), "an older registry cannot vouch")
	require.False(t, CoverageProvenBack(&genesis, 0, cvGenesis, cvRev), "revision 0 asserts nothing")
	require.False(t, CoverageProvenBack(&genesis, cvRev, 0, cvRev),
		"an UNCONFIGURED genesis must refuse, or the gate would pass everything")
	require.False(t, CoverageProvenBack(&genesis, cvRev, cvGenesis, 0),
		"a zero requirement is a misconfigured caller, not a satisfied one")
}
