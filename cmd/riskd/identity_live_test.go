package main

// The materialization identity and the single-writer lock, against a live
// database.
//
// What these defend, in one sentence: a published large-step warning must survive
// a restart, a second instance, and a reconciliation that failed — because in each
// of those the daemon recomputes a pass whose G5 baseline has moved, and the
// recomputation is UNFLAGGED. If it can write a newer batch, the warning is gone.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// TestRiskdIdentityIsStableAcrossPassesOfTheSameMaterialization: two passes over
// an unchanged database derive the SAME key, so the second adopts the first.
//
// MUTANT THIS KILLS: restore the random per-attempt key. The keys then differ, the
// second pass writes a second batch, and the count assertion fails.
func TestRiskdIdentityIsStableAcrossPassesOfTheSameMaterialization(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEmpty(t, first.MaterializationKey)

	// Nothing in the database changed. The pass is re-run exactly as a restart
	// would run its mandatory first pass.
	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, first.MaterializationKey, second.MaterializationKey,
		"the same materialization must derive the same key")
	require.Equal(t, first.BatchID, second.BatchID,
		"and therefore ADOPT the committed batch rather than duplicating it")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 1, n, "one materialization, one batch")
}

// TestRiskdRestartDoesNotEraseALargeStepFlag is the round-1-M4 harm, killed at the
// daemon level through the RESTART path rather than a simulated commit failure.
//
// The sequence is entirely ordinary:
//
//	pass 1  discloses price 300000000000
//	poll    lands 180000000000 (a −40% move)
//	pass 2  FLAGS the step and commits
//	restart the daemon (a new fixture over the SAME database)
//	pass 3  its baseline is now the committed post-move price, so its own
//	        computation is UNFLAGGED
//
// MUTANT THIS KILLS: the random per-attempt key. Pass 3 then mints a new key,
// writes a newer unflagged batch, and NewestCompleteBatch serves a book with no
// large-step warning on it — the assertion at the end fails on exactly that.
func TestRiskdRestartDoesNotEraseALargeStepFlag(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// A −40% move on the collateral asset.
	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")

	flagged, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, flagged.BatchID, first.BatchID)
	require.Equal(t, 1, flagged.Flagged)
	require.Contains(t, aavePositionOf(t, f, flagged.BatchID).Flags, riskfeed.FlagLargeStep)

	// THE RESTART. A fresh daemon config over the same database — no in-memory
	// baseline, so its first pass is mandatory and its G5 baseline is whatever the
	// newest batch disclosed (the post-move price).
	restarted := f.restartedConfig(t)
	afterRestart, err := runPass(f.ctx, f.store, restarted)
	require.NoError(t, err)
	require.Equal(t, flagged.MaterializationKey, afterRestart.MaterializationKey,
		"a restart over unchanged state is the SAME materialization")
	require.Equal(t, flagged.BatchID, afterRestart.BatchID, "so it adopts rather than rewrites")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n, "no third batch — the restart wrote nothing")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, flagged.BatchID, batch.ID)
	require.Equal(t, 1, batch.FlaggedCount,
		"the large-step warning SURVIVES the restart — losing it is the harm this closes")
	require.Contains(t, aavePositionOf(t, f, batch.ID).Flags, riskfeed.FlagLargeStep)
}

// TestRiskdSecondInstanceDoesNotEraseALargeStepFlag is the same law through the
// OTHER honest history: a second riskd process starting after the flagged batch
// committed. Its mandatory first pass sees 180000000000 as both previous and
// current price, so its computation is unflagged.
func TestRiskdSecondInstanceDoesNotEraseALargeStepFlag(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	_, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")
	flagged, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, 1, flagged.Flagged)

	// A SECOND INSTANCE: its own store handle, its own config, same database.
	second := f.secondInstance(t)
	res, err := runPass(f.ctx, second.store, second.cfg)
	require.NoError(t, err)
	require.Equal(t, flagged.BatchID, res.BatchID,
		"a second instance computing the same materialization adopts it")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n)

	batch, _, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.Equal(t, 1, batch.FlaggedCount, "the warning survives a second instance too")
}

// TestRiskdSubstrateChangeStillProducesANewBatch is the counterweight, and it
// matters: if adoption were too eager the daemon would stop publishing. A real
// substrate change must still mint a new materialization.
func TestRiskdSubstrateChangeStillProducesANewBatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	f.seedPricesAt(t, fxPriceBlock+10, "310000000000", "100000000")

	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, first.MaterializationKey, second.MaterializationKey,
		"a new price is a new materialization")
	require.Greater(t, second.BatchID, first.BatchID)

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n)
}

// ---------------------------------------------------------------------------
// The single-writer advisory lock.
// ---------------------------------------------------------------------------

// TestRiskMaterializerLockExcludesASecondHolder: concurrent honest instances are
// STRUCTURALLY excluded, not merely tolerated.
func TestRiskMaterializerLockExcludesASecondHolder(t *testing.T) {
	f := newRiskdFixture(t)

	release, err := f.store.AcquireRiskMaterializerLock(f.ctx)
	require.NoError(t, err)

	// A second store handle on the same database — a second process, for the
	// purposes of an advisory lock.
	second, err := store.Open(f.ctx, f.dsn)
	require.NoError(t, err)
	t.Cleanup(second.Close)

	_, err = second.AcquireRiskMaterializerLock(f.ctx)
	require.ErrorIs(t, err, store.ErrRiskMaterializerLocked,
		"a second materializer must be refused while the first holds the lock")

	// Released, the lock is available again — a restart must not be locked out by
	// its own predecessor.
	release()
	release() // idempotent

	again, err := second.AcquireRiskMaterializerLock(f.ctx)
	require.NoError(t, err, "after release the lock is free for the next process")
	again()
}

func aavePositionOf(t *testing.T, f *riskdFixture, batchID int64) store.RiskBatchPosition {
	t.Helper()
	positions, err := f.store.RiskBatchPositions(f.ctx, batchID)
	require.NoError(t, err)
	for _, p := range positions {
		if p.Engine == risk.AaveEngine {
			return p
		}
	}
	t.Fatalf("no aave position in batch %d", batchID)
	return store.RiskBatchPosition{}
}

var _ = context.Background
