package main

// The three supersession legs of design spec §4, each fired in isolation, plus
// the PRUNE-SURVIVAL case the legs exist for.

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

const (
	testAaveEngine = "aave_v3_etherfi"
	testDMEngine   = "debt_manager"
)

// supersessionCase builds a one-engine batchView: a stamp, a live cursor, and the
// chain's epoch maximum.
func supersessionCase(stampBlock uint64, stampEpoch int64,
	curBlock uint64, curEpoch int64, maxEpoch *int64) *batchView {

	v := &batchView{
		Now: time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC),
		Batch: store.RiskBatch{
			ID:         7,
			ComputedAt: time.Date(2026, 7, 29, 11, 59, 0, 0, time.UTC),
			Status:     store.RiskBatchComplete,
			Watermarks: []store.RiskBatchWatermark{{
				Engine: testAaveEngine, ChainID: 1,
				LastBlock: stampBlock, AckedEpoch: stampEpoch, MaxEpochAtCompute: stampEpoch,
			}},
		},
		Cursors: []store.DeriveCursorState{{
			Engine: testAaveEngine, ChainID: 1, LastBlock: curBlock, AckedEpoch: curEpoch,
		}},
		MaxEpochs: map[int64]int64{},
	}
	if maxEpoch != nil {
		v.MaxEpochs[1] = *maxEpoch
	}
	return v
}

func epoch(v int64) *int64 { return &v }

func TestSupersessionCleanBatchFiresNoLeg(t *testing.T) {
	// Cursor exactly where the batch was stamped, and the chain's max epoch equals
	// the ack. Nothing has moved, so nothing may be flagged.
	s := supersession(supersessionCase(1000, 4, 1000, 4, epoch(4)))
	require.False(t, s.Superseded)
	require.Empty(t, s.Legs)
	// Anti-vacuity: the note must be on the wire even in the clean case, because a
	// client has to know that the flag is served-with rather than refused-on.
	require.NotEmpty(t, s.Note)
}

func TestSupersessionLegOneAckedEpochMoved(t *testing.T) {
	// A rewind happened and was acknowledged: the engine's acked_epoch is above
	// the stamp. The cursor has already re-walked back to the same height, so
	// legs 2 and 3 are silent — this leg is the ONLY one that fires.
	s := supersession(supersessionCase(1000, 4, 1000, 5, epoch(5)))
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 1)
	require.Equal(t, legAckedEpochMoved, s.Legs[0].Leg)
	require.Equal(t, int64(4), s.Legs[0].StampedAckedEpoch)
	require.Equal(t, int64(5), *s.Legs[0].CurrentAckedEpoch)
	require.Contains(t, s.Legs[0].Detail, "a rewind happened since")
}

func TestSupersessionLegTwoLastBlockRewound(t *testing.T) {
	// A rewind IN PROGRESS: the cursor has dropped below the stamped height but
	// the ack has not moved yet (RewindDerived has not run).
	s := supersession(supersessionCase(1000, 4, 940, 4, epoch(4)))
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 1)
	require.Equal(t, legLastBlockRewound, s.Legs[0].Leg)
	require.Equal(t, uint64(1000), s.Legs[0].StampedLastBlock)
	require.Equal(t, uint64(940), *s.Legs[0].CurrentLastBlock)
	require.Contains(t, s.Legs[0].Detail, "a rewind is in progress")
}

func TestSupersessionLegThreeUnackedEpochRecorded(t *testing.T) {
	// An epoch is RECORDED on the chain above the engine's ack: the raw rewind
	// landed, the derived side has not acknowledged it, so derived rows may
	// describe deleted blocks. The cursor is otherwise exactly at the stamp.
	s := supersession(supersessionCase(1000, 4, 1000, 4, epoch(6)))
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 1)
	require.Equal(t, legUnackedEpoch, s.Legs[0].Leg)
	require.Equal(t, int64(6), *s.Legs[0].CurrentMaxEpoch)
	require.Contains(t, s.Legs[0].Detail, "may describe deleted blocks")
}

// TestSupersessionLegOneSurvivesEpochPruning is the reason leg 1 exists.
//
// PruneAckedReorgEpochs DELETES acked epochs, so after rewind → ack → prune →
// re-walk:
//
//	MAX(reorg_epochs.epoch) is back to its pre-rewind value (or absent entirely),
//	last_block has regained its old height,
//
// and legs 2 and 3 are both blind. That is the ABA blindspot. Acks are monotone
// and never pruned, so the acked_epoch leg still fires — which is exactly what
// keeps a pre-rewind batch from being served as current.
func TestSupersessionLegOneSurvivesEpochPruning(t *testing.T) {
	// The pruned world: NO epoch row for the chain at all, cursor back at the
	// stamped height. Only the ack betrays the rewind.
	v := supersessionCase(1000, 4, 1000, 5, nil)
	s := supersession(v)
	require.True(t, s.Superseded,
		"after rewind+ack+prune+re-walk the block height and the epoch maximum are both back to their pre-rewind values; the acked-epoch leg is the only thing left that can detect it")
	require.Len(t, s.Legs, 1)
	require.Equal(t, legAckedEpochMoved, s.Legs[0].Leg)
	require.Nil(t, s.Legs[0].CurrentMaxEpoch, "the epoch row was pruned, so there is no maximum to report")

	// The DISCRIMINATOR: with the same pruned epoch table and an UNCHANGED ack,
	// nothing fires. If this also reported superseded, the test above would prove
	// nothing about the ack.
	clean := supersession(supersessionCase(1000, 4, 1000, 4, nil))
	require.False(t, clean.Superseded)
}

func TestSupersessionAllThreeLegsCanFireTogether(t *testing.T) {
	// A rewind acknowledged, a re-walk still below the stamp, and a further epoch
	// recorded above the new ack. All three are independent facts and all three
	// are reported: collapsing them into one boolean would lose which one an
	// operator has to act on.
	s := supersession(supersessionCase(1000, 4, 900, 5, epoch(9)))
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 3)
	got := []string{s.Legs[0].Leg, s.Legs[1].Leg, s.Legs[2].Leg}
	require.ElementsMatch(t, []string{legAckedEpochMoved, legLastBlockRewound, legUnackedEpoch}, got)
}

// TestSupersessionCursorAbsentFailsClosed pins the degenerate case: a stamped
// engine whose cursor is gone cannot be JUDGED, so it must not pass.
func TestSupersessionCursorAbsentFailsClosed(t *testing.T) {
	v := supersessionCase(1000, 4, 1000, 4, epoch(4))
	v.Cursors = nil
	s := supersession(v)
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 1)
	require.Equal(t, legCursorAbsent, s.Legs[0].Leg)
	require.Nil(t, s.Legs[0].CurrentAckedEpoch)
	require.Nil(t, s.Legs[0].CurrentLastBlock)
}

// TestSupersessionIsPerEngine pins that one engine's rewind does not condemn the
// other engine's stamp — the legs are per-engine because the chains are.
func TestSupersessionIsPerEngine(t *testing.T) {
	v := supersessionCase(1000, 4, 1000, 4, epoch(4))
	v.Batch.Watermarks = append(v.Batch.Watermarks, store.RiskBatchWatermark{
		Engine: testDMEngine, ChainID: 10, LastBlock: 5000, AckedEpoch: 2, MaxEpochAtCompute: 2,
	})
	v.Cursors = append(v.Cursors, store.DeriveCursorState{
		Engine: testDMEngine, ChainID: 10, LastBlock: 4900, AckedEpoch: 2,
	})
	s := supersession(v)
	require.True(t, s.Superseded)
	require.Len(t, s.Legs, 1, "only the Debt Manager's rewind should be reported")
	require.Equal(t, testDMEngine, s.Legs[0].Engine)
	require.Equal(t, legLastBlockRewound, s.Legs[0].Leg)
	require.Equal(t, int64(10), s.Legs[0].ChainID)
}

// TestAgeSecondsFloorsAtZero pins that a stamp in the future never publishes a
// NEGATIVE age, which would read as freshness.
func TestAgeSecondsFloorsAtZero(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	require.Equal(t, int64(0), ageSeconds(now, now.Add(time.Hour)))
	require.Equal(t, int64(90), ageSeconds(now, now.Add(-90*time.Second)))
	require.Equal(t, int64(0), ageSeconds(now, now))
}
