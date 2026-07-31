package store

// P5 Task B1 live-db tests for EvidenceInputs: the database-owned halves of
// the /v1/evidence manifest — the newest SERVABLE batch's identity triple
// and the applied schema version. Code-owned manifest fields (service
// commit, registry/algorithm revisions, feeds hash) are deliberately absent
// here; Task B3 composes them from their authoritative sources.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEvidenceInputsWithNoServableBatch(t *testing.T) {
	s := testB1Store(t)
	ev, err := s.EvidenceInputs(context.Background())
	require.NoError(t, err)
	require.False(t, ev.HasBatch, "no batch exists — the manifest says so instead of inventing identity")
	require.Zero(t, ev.BatchID)
	require.Empty(t, ev.SubstrateDigest)
	// The schema version comes from goose's own ledger; this tree carries
	// migration 00017 (siblings may add higher numbers later).
	require.GreaterOrEqual(t, ev.SchemaVersion, int64(17))
}

func TestEvidenceInputsCarriesTheNewestServableBatchIdentity(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	key := newTestKey()
	id, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)

	ev, err := s.EvidenceInputs(ctx)
	require.NoError(t, err)
	require.True(t, ev.HasBatch)
	require.Equal(t, id, ev.BatchID)
	require.Equal(t, key, ev.MaterializationKey)
	require.Equal(t, "vector("+key+")", ev.MaterializationVector)
	require.Equal(t, "substrate("+key+")", ev.SubstrateDigest)
	require.Equal(t, "riskd-test", ev.Producer)
	require.Equal(t, 2, ev.PositionCount)
	require.Equal(t, 1, ev.RefusedCount)
	require.Equal(t, 1, ev.FlaggedCount)
	require.False(t, ev.ComputedAt.IsZero())
}

// The evidence read uses the SAME servability predicate as every serving
// path: a torn newest batch must fall back to the older servable one.
func TestEvidenceInputsSkipsTornBatches(t *testing.T) {
	s := testB1Store(t)
	ctx := context.Background()

	id1, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	id2, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)

	_, err = s.pool.Exec(ctx, `UPDATE risk_batches SET position_count = position_count + 1 WHERE id = $1`, id2)
	require.NoError(t, err)

	ev, err := s.EvidenceInputs(ctx)
	require.NoError(t, err)
	require.True(t, ev.HasBatch)
	require.Equal(t, id1, ev.BatchID, "the torn newest batch is unservable; evidence names the servable one")
}
