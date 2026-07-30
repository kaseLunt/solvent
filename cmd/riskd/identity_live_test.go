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
	"fmt"
	"testing"
	"time"

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

// TestRiskdUnconsumedCursorDoesNotChangeTheIdentity is the round-3 [medium] #1
// regression, and it reopened round-2's M1 through an unfiltered input.
//
// The live indexer maintains cursors riskd never values from — `prices:chainlink_feed:1`
// is the real one: the UNCAPPED feed stream, deliberately excluded from Aave
// valuation. The identity used to serialize every row DeriveCursorStates returned,
// so that cursor advancing gave an otherwise-identical materialization a NEW key.
//
// Honest sequence, exactly as Codex specified: a flagged batch commits, the feed
// cursor advances, riskd restarts with an identical CONSUMED vector and substrate.
//
// MUTANT THIS KILLS: pass the raw `cursors` slice to
// ComputeMaterializationIdentity instead of `vector.consumedCursors()`. The keys
// then differ, the restart does not adopt, its post-move-baselined UNFLAGGED
// computation writes a newer batch, and the G5 assertion at the end fails.
func TestRiskdUnconsumedCursorDoesNotChangeTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	_, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// A −40% move: the next pass FLAGS it.
	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")
	flagged, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, 1, flagged.Flagged)
	require.Contains(t, aavePositionOf(t, f, flagged.BatchID).Flags, riskfeed.FlagLargeStep)

	// THE UNCONSUMED CURSOR ADVANCES. This is the Chainlink feed deriver doing its
	// ordinary work: riskd values nothing from it (the registry admits only
	// adapter-output rows), so nothing it does can change a single number riskd
	// publishes.
	_, err = f.admin.Exec(f.ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch)
		VALUES ('prices:chainlink_feed:1', 1, 25635000, 0)
		ON CONFLICT (engine) DO UPDATE SET last_block = EXCLUDED.last_block`)
	require.NoError(t, err)

	// Proof the cursor really is present and really is unconsumed.
	var present bool
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT EXISTS(SELECT 1 FROM derive_cursors WHERE engine = 'prices:chainlink_feed:1')`).Scan(&present))
	require.True(t, present)
	require.NotContains(t, f.cfg.consumedEngines(), "prices:chainlink_feed:1",
		"the fixture's premise: this engine is NOT consumed by the pass")

	// THE RESTART. Identical consumed vector, identical substrate.
	restarted := f.restartedConfig(t)
	afterRestart, err := runPass(f.ctx, f.store, restarted)
	require.NoError(t, err)
	require.Equal(t, flagged.MaterializationKey, afterRestart.MaterializationKey,
		"an UNCONSUMED cursor advancing must not change the materialization identity")
	require.Equal(t, flagged.BatchID, afterRestart.BatchID, "so the restart adopts")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n, "no third batch")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 1, batch.FlaggedCount,
		"the large-step warning SURVIVES an unrelated cursor advancing — round-2 M1 stays closed")
	require.Contains(t, aavePositionOf(t, f, batch.ID).Flags, riskfeed.FlagLargeStep)
}

// TestRiskdWiresTheRevisionAndRegistryFingerprint checks the DAEMON'S WIRING, not
// the identity function.
//
// The unit tests prove that a different revision or registry fingerprint yields a
// different key. They cannot prove riskd actually PASSES the real ones — and an
// identity that silently receives 0 and "" is exactly as blind to a math change or a
// corrected token-decimals as having no such fields at all. The persisted vector is
// the evidence, so it is read back from the database and matched against the live
// values.
//
// MUTANT THIS KILLS: pass AlgorithmRevision: 0 / RegistryFingerprint: "" in pass.go
// (i.e. declare the fields and forget to wire them). Every unit test still passes;
// this one fails.
func TestRiskdWiresTheRevisionAndRegistryFingerprint(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	var vector string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT materialization_vector FROM risk_batches WHERE id = $1`, res.BatchID).Scan(&vector))

	require.Contains(t, vector, fmt.Sprintf("rev=%d;", riskfeed.AlgorithmRevision),
		"the batch must record the REAL algorithm revision, or a math change adopts the old code's batch")
	require.NotContains(t, vector, "rev=0;",
		"revision 0 means the field was declared and never wired")

	fingerprint := f.cfg.Registry.Fingerprint()
	require.NotEmpty(t, fingerprint)
	require.Contains(t, vector, "registry="+fingerprint,
		"the batch must record the REAL registry fingerprint, or a corrected token-decimals adopts the mis-scaled result")
	require.NotContains(t, vector, "registry=;",
		"an empty fingerprint means the field was declared and never wired")
}

// TestRiskdConsumedCursorStillChangesTheIdentity is the counterweight: filtering
// must not go so far that a CONSUMED cursor stops mattering.
func TestRiskdConsumedCursorStillChangesTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// The Aave position engine's own cursor advances — squarely consumed.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET last_block = last_block + 1 WHERE engine = $1`, risk.AaveEngine)
	require.NoError(t, err)

	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, first.MaterializationKey, second.MaterializationKey,
		"a CONSUMED cursor advancing IS a new materialization")
	require.Greater(t, second.BatchID, first.BatchID)
}

// TestRiskdFreshnessCrossingProducesANewBatch is the live half of finding #2: a
// poller stops, DB time crosses the ceiling, and the pass now computes a G1
// refusal. It must NOT adopt the pre-crossing batch and leave its "fresh"
// disclosure standing.
//
// MUTANT THIS KILLS: remove the freshness-phase section from the identity. The
// refusing pass then derives the fresh batch's key, adopts it, and the served
// verdict stays "fresh" over an input that is now over-ceiling.
func TestRiskdFreshnessCrossingProducesANewBatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	fresh, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	prices, err := f.store.RiskBatchPriceInputs(f.ctx, fresh.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, prices)
	require.Equal(t, riskfeed.VerdictFresh, prices[0].Verdict)

	// The poller stopped: the SAME rows are now far past the ceiling. Nothing else
	// changed — no cursor moved, no price row was added.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE prices SET source_as_of = now() - interval '2 hours' WHERE chain_id = 1`)
	require.NoError(t, err)

	crossed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, fresh.MaterializationKey, crossed.MaterializationKey,
		"crossing the ceiling changes the verdict, so it must be a new materialization")
	require.Greater(t, crossed.BatchID, fresh.BatchID)
	require.Equal(t, 1, crossed.Refused, "and the new batch carries the G1 refusal")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, crossed.BatchID, batch.ID)
	served, err := f.store.RiskBatchPriceInputs(f.ctx, batch.ID)
	require.NoError(t, err)
	require.NotEmpty(t, served)
	require.Equal(t, riskfeed.VerdictOverCeiling, served[0].Verdict,
		"the served verdict reflects the crossing rather than a stale 'fresh'")
}

// TestRiskdFreshnessPhaseCrossesOnElapsedTimeAlone isolates the freshness phase in
// a way the test above cannot.
//
// TestRiskdFreshnessCrossingProducesANewBatch shifts `source_as_of`, which also
// moves the substrate digest — so it proves the end-to-end behaviour but does NOT
// prove the phase is load-bearing. Here the price rows are byte-identical and
// untouched; the ONLY thing that changes between the two passes is elapsed database
// time crossing the budget and ceiling. That is the production scenario exactly: a
// poller stops and nothing in the database changes at all.
//
// The budget is deliberately tiny so real time crosses it. The sleep is
// load-bearing rather than incidental — the database clock cannot be frozen from
// here, and elapsed time IS the variable under test.
//
// MUTANT THIS KILLS: remove the freshness-phase section from the identity. The
// second pass then derives the first pass's key over byte-identical rows, adopts the
// batch whose disclosure says "fresh", and the newly-computed over-ceiling refusal
// is discarded.
func TestRiskdFreshnessPhaseCrossesOnElapsedTimeAlone(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	// Budget 2s ⇒ ceiling 4s. The base fixture seeds its as-of 30s in the past,
	// which under this budget is ALREADY over-ceiling — so a genuinely fresh row is
	// seeded at a new block first. Without it both passes sit in the same
	// (over-ceiling) phase and the test would pass for no reason.
	f.seedPricesAt(t, fxPriceBlock+5, "300000000000", "100000000")
	f.cfg.Budget = riskfeed.PriceBudget{Seconds: 2}

	fresh, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	freshServed, err := f.store.RiskBatchPriceInputs(f.ctx, fresh.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, freshServed)
	require.Equal(t, riskfeed.VerdictFresh, freshServed[0].Verdict,
		"pass 1 must be inside the FRESH phase, or there is no crossing to observe")

	rowsBefore := priceRowFingerprint(t, f)

	// Only time passes. No cursor moves, no row is written, no poller runs.
	time.Sleep(5 * time.Second)

	require.Equal(t, rowsBefore, priceRowFingerprint(t, f),
		"the price rows must be BYTE-IDENTICAL across the two passes, or this test is not isolating elapsed time")

	crossed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, fresh.MaterializationKey, crossed.MaterializationKey,
		"elapsed time crossing the ceiling is a NEW materialization even over identical rows")
	require.Greater(t, crossed.BatchID, fresh.BatchID)
	require.Equal(t, 1, crossed.Refused, "and the refusal it computed is the one that gets published")

	served, err := f.store.RiskBatchPriceInputs(f.ctx, crossed.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, served)
	require.Equal(t, riskfeed.VerdictOverCeiling, served[0].Verdict)
}

// priceRowFingerprint renders every price row's value-bearing columns, so a test can
// prove the substrate did not move.
func priceRowFingerprint(t *testing.T, f *riskdFixture) string {
	t.Helper()
	var out string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT COALESCE(string_agg(
		     encode(asset,'hex') || '/' || source || '/' || price::text || '/' ||
		     block_number::text || '/' || COALESCE(source_as_of::text,'none') || '/' || valid::text,
		     '|' ORDER BY asset, source, block_number), '')
		 FROM prices WHERE chain_id = 1`).Scan(&out))
	return out
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
