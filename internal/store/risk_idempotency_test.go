package store

// The indeterminate commit, and why it needs a key.
//
// A Commit error does NOT mean "not committed". PostgreSQL may have committed and
// the acknowledgement may have died on the wire, and from the client the two
// outcomes are indistinguishable. Everything below exists because the harm of
// guessing wrong is not a duplicate row — it is a LOST WARNING:
//
//	pass N   writes price 100
//	pass N+1 sees 200, flags the 100→200 step, commits, ack is LOST
//	retry    recomputes; its baseline is now the committed N+1 (200), so the
//	         move reads 200→200 and the flag DISAPPEARS from the newest batch
//
// An operator who was supposed to see a 100% single-interval price move sees
// nothing. The key turns the second write into a detectable no-op.

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// withLostCommitAck makes the NEXT commit succeed in the database and report
// failure to the caller — the one state that cannot be provoked honestly.
func withLostCommitAck(t *testing.T) {
	t.Helper()
	original := commitRiskBatchTx
	fired := false
	commitRiskBatchTx = func(ctx context.Context, tx pgx.Tx) error {
		if fired {
			return original(ctx, tx)
		}
		fired = true
		// COMMIT REALLY HAPPENS. Only the reply is lost.
		if err := original(ctx, tx); err != nil {
			return err
		}
		return errors.New("simulated lost commit acknowledgement (connection reset)")
	}
	t.Cleanup(func() { commitRiskBatchTx = original })
}

// TestWriteRiskBatchReconcilesALostCommitAck: the write landed, the ack was lost,
// and WriteRiskBatch reports the batch it actually committed rather than an error.
func TestWriteRiskBatchReconcilesALostCommitAck(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()
	withLostCommitAck(t)

	b := sampleBatch(10)
	id, err := s.WriteRiskBatch(ctx, b)
	require.NoError(t, err,
		"a committed batch whose ack was lost must be reported as the success it was, not as a failure")
	require.Positive(t, id)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 1, n, "exactly one batch exists")

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID)
}

// TestWriteRiskBatchRetryWithTheSameKeyDoesNotDoubleWrite: the daemon retries the
// SAME prepared pass. The UNIQUE key makes the second attempt resolve to the
// already-committed batch instead of creating a duplicate.
func TestWriteRiskBatchRetryWithTheSameKeyDoesNotDoubleWrite(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	key := newTestKey()
	first, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err)

	// The retry of the same prepared pass. Its INSERT collides on the unique key,
	// the transaction aborts, and the reconciliation resolves the key.
	second, err := s.WriteRiskBatch(ctx, sampleBatchKeyed(10, key))
	require.NoError(t, err, "a replay of the same prepared pass is a no-op, not an error")
	require.Equal(t, first, second, "and it resolves to the batch that already landed")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 1, n, "no duplicate batch")
}

// TestDistinctPassesGetDistinctBatches is the guard against over-correcting: two
// legitimately different prepared passes must BOTH land. A vector-derived key
// would collide on a quiet chain and silently skip the second.
func TestDistinctPassesGetDistinctBatches(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	first, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	second, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.NoError(t, err)
	require.NotEqual(t, first, second)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n)
}

// TestLostCommitAckRetainsTheLargeStepFlag is the FINDING ITSELF, end to end.
//
// MUTANT THIS KILLS: drop the idempotency key (or the commit reconciliation) and
// the retry writes a SECOND batch. That duplicate becomes the newest, its own
// baseline is the already-committed flagged batch's post-move price, so the step
// reads 200→200 and the newest batch carries NO flag. The assertion below then
// fails on exactly the operator-visible warning that went missing.
func TestLostCommitAckRetainsTheLargeStepFlag(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	// Pass N: the baseline batch, disclosing price 100.
	base := sampleBatch(10)
	base.Positions[0].Prices[0].Value = big.NewInt(100)
	base.Positions[0].Flags = nil
	baseID, err := s.WriteRiskBatch(ctx, base)
	require.NoError(t, err)

	baseline := priceBaselineOf(t, s, baseID)
	require.Equal(t, "100", baseline.String())

	// Pass N+1: price moved 100 → 200, so the pass FLAGS the step. Its commit
	// lands and the acknowledgement is lost.
	withLostCommitAck(t)
	moved := sampleBatch(10)
	moved.Positions[0].Prices[0].Value = big.NewInt(200)
	moved.Positions[0].Flags = []string{"large_price_step"}
	movedID, err := s.WriteRiskBatch(ctx, moved)
	require.NoError(t, err, "the lost ack is reconciled, not retried into a duplicate")
	require.Greater(t, movedID, baseID)

	// The newest batch is the FLAGGED one, and there is no duplicate above it.
	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, movedID, batch.ID)
	require.Equal(t, 1, batch.FlaggedCount,
		"the large-step warning must survive the ambiguous commit — losing it is the harm the key prevents")

	positions, err := s.RiskBatchPositions(ctx, batch.ID)
	require.NoError(t, err)
	var flags []string
	for _, p := range positions {
		if p.Engine == riskAaveEngine {
			flags = p.Flags
		}
	}
	require.Contains(t, flags, "large_price_step")

	// And the served baseline for the NEXT pass is the moved price — 200 — read
	// from the flagged batch rather than from a duplicate that never should have
	// existed.
	require.Equal(t, "200", priceBaselineOf(t, s, batch.ID).String())

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n, "two passes, two batches — no duplicate from the retry")
}

// priceBaselineOf reads the single disclosed price value of a batch, which is
// what the next pass's step comparison uses as its baseline.
func priceBaselineOf(t *testing.T, s *Store, batchID int64) *big.Int {
	t.Helper()
	rows, err := s.RiskBatchPriceInputs(context.Background(), batchID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.NotNil(t, rows[0].Value)
	return rows[0].Value
}

// TestWriteRiskBatchSurfacesAGenuineRollback: when the transaction really did NOT
// commit, the reconciliation finds no key and the error is reported honestly.
// Swallowing it would be the mirror-image failure of double-writing.
func TestWriteRiskBatchSurfacesAGenuineRollback(t *testing.T) {
	s := testRiskStore(t)
	ctx := context.Background()

	original := commitRiskBatchTx
	commitRiskBatchTx = func(ctx context.Context, tx pgx.Tx) error {
		_ = tx.Rollback(ctx) // genuinely NOT committed
		return errors.New("simulated commit failure with a real rollback")
	}
	t.Cleanup(func() { commitRiskBatchTx = original })

	_, err := s.WriteRiskBatch(ctx, sampleBatch(10))
	require.Error(t, err, "a real rollback must surface, not be swallowed by the reconciliation")
	require.Contains(t, err.Error(), "commit risk batch")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Zero(t, n)
}
