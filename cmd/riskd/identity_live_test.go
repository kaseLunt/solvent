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

	"github.com/ethereum/go-ethereum/common"

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

// TestRiskdFreshnessPhaseCrossesOnAdvancingClockAlone isolates the freshness phase
// DETERMINISTICALLY.
//
// The earlier version seeded an as-of from PROCESS time, gave it a two-second fresh
// window, and then did database work plus a full pass before asserting freshness — so
// a loaded PostgreSQL or a scheduler hiccup could consume the window before the first
// assertion and produce a nondeterministic stale/over-ceiling result. It also slept
// five seconds to reach the later ceiling. Both are gone: the as-of is anchored to the
// DATABASE clock (and the fresh premise is asserted, not assumed), and time advances
// through the clock-skew seam. There is no sleep and no wall-clock deadline anywhere
// in it, so it cannot flap.
//
// MUTANT THIS KILLS: remove the freshness-phase section from the identity. The second
// pass then derives the first pass's key over byte-identical rows, adopts the batch
// whose disclosure says "fresh", and the newly-computed over-ceiling refusal is
// discarded.
func TestRiskdFreshnessPhaseCrossesOnAdvancingClockAlone(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)

	fresh, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	freshServed, err := f.store.RiskBatchPriceInputs(f.ctx, fresh.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, freshServed)
	require.Equal(t, riskfeed.VerdictFresh, freshServed[0].Verdict,
		"pass 1 must be inside the FRESH phase, or there is no crossing to observe")

	rowsBefore := priceRowFingerprint(t, f)
	cursorsBefore := cursorSnapshot(t, f)

	// ONLY THE CLOCK MOVES. The ceiling is 2x180s; +400s is past it.
	advanced := f.configWithSkew(t, 400*time.Second)

	require.Equal(t, rowsBefore, priceRowFingerprint(t, f),
		"the price rows must be BYTE-IDENTICAL, or this test is not isolating the clock")
	require.Equal(t, cursorsBefore, cursorSnapshot(t, f))

	crossed, err := runPass(f.ctx, f.store, advanced)
	require.NoError(t, err)
	require.NotEqual(t, fresh.MaterializationKey, crossed.MaterializationKey,
		"an advancing clock crossing the ceiling is a NEW materialization even over identical rows")
	require.Greater(t, crossed.BatchID, fresh.BatchID)
	require.Equal(t, 1, crossed.Refused, "and the refusal it computed is the one that gets published")

	served, err := f.store.RiskBatchPriceInputs(f.ctx, crossed.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, served)
	require.Equal(t, riskfeed.VerdictOverCeiling, served[0].Verdict)
}

// TestRiskdUnusedRegisteredAssetCrossingDoesNotChangeTheIdentity is the round-4
// [medium] finding.
//
// snapshotSpec fetches EVERY witness the registry declares, but Assemble judges only
// the assets referenced by current positions. So a registered asset with NO position
// affects no persisted position, disclosure or aggregate — and must not be able to
// change the materialization identity by crossing a freshness boundary. When it
// could, a restart declined to adopt, recomputed against the post-move baseline, and
// wrote an output-equivalent but UNFLAGGED newer batch over a large-step warning:
// exactly the erasure consumed-input scoping exists to prevent.
//
// MUTANT THIS KILLS: classify every row in inputs.Prices instead of the judged set.
// Asset B's crossing then changes the key, the restart does not adopt, and the G5
// assertion at the end fails.
func TestRiskdUnusedRegisteredAssetCrossingDoesNotChangeTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)

	// Asset B is REGISTERED (so it is fetched) but held by nobody: an OP Debt
	// Manager collateral token, while the only position in this fixture is on Aave.
	unusedAsset := common20(fxDMCollateral)
	_, err := f.store.ApplyPolledPrices(f.ctx, "prices:poll:10", 10, []store.PriceObservation{
		{Asset: unusedAsset, Source: "priceproviderv2", Price: mustBig("3000000000"), Decimals: 6,
			BlockNumber: 154790000, SourceAsOf: time.Now().UTC()},
	}, 154790000, store.PollAnchor{BlockNumber: 154790000, BlockHash: hash32(0x77)})
	require.NoError(t, err)
	// Age it so a modest clock advance crosses ITS staleness boundary while the used
	// Aave assets stay comfortably fresh.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE prices SET source_as_of = now() - make_interval(secs => 150) WHERE chain_id = 10`)
	require.NoError(t, err)

	// A BASELINE pass first: G5 compares against what the previous batch disclosed,
	// so without one there is no step to flag and the test would prove nothing.
	baseline, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// A large downward move on the USED asset: the next pass flags it.
	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")
	_, err = f.admin.Exec(f.ctx, `UPDATE prices SET source_as_of = now() WHERE chain_id = 1`)
	require.NoError(t, err)

	flagged, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, flagged.BatchID, baseline.BatchID)
	require.Equal(t, 1, flagged.Flagged)
	require.Contains(t, aavePositionOf(t, f, flagged.BatchID).Flags, riskfeed.FlagLargeStep)

	// PROVE the premise: asset B is in the FETCHED key set, and never judged.
	require.True(t, f.registryDeclares(unusedAsset), "asset B must be in the fetched key set")
	require.False(t, f.judgedInBatch(t, flagged.BatchID, unusedAsset),
		"and it must NOT appear as a judged disclosure on the batch")

	// THE RESTART, clock advanced 30s: asset B moves 150s -> 180s+30s = past its
	// staleness boundary, while the used Aave assets (as-of now) stay fresh.
	restarted := f.configWithSkew(t, 40*time.Second)

	afterRestart, err := runPass(f.ctx, f.store, restarted)
	require.NoError(t, err)
	require.Equal(t, flagged.MaterializationKey, afterRestart.MaterializationKey,
		"an UNUSED registered asset crossing a freshness boundary must not change the identity")
	require.Equal(t, flagged.BatchID, afterRestart.BatchID, "so the restart adopts")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n, "no third batch — the restart adopted instead of writing")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, flagged.BatchID, batch.ID)
	require.Equal(t, 1, batch.FlaggedCount,
		"the large-step warning SURVIVES an unused asset's boundary crossing")
	require.Contains(t, aavePositionOf(t, f, batch.ID).Flags, riskfeed.FlagLargeStep)
}

// TestRiskdJudgedAssetCrossingStillChangesTheIdentity is the counterweight demanded
// alongside: scoping must not go so far that a JUDGED asset stops mattering.
func TestRiskdJudgedAssetCrossingStillChangesTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// The USED collateral asset crosses fresh -> stale.
	advanced := f.configWithSkew(t, 200*time.Second)
	second, err := runPass(f.ctx, f.store, advanced)
	require.NoError(t, err)
	require.NotEqual(t, first.MaterializationKey, second.MaterializationKey,
		"a JUDGED asset crossing a boundary IS a new materialization")
	require.Greater(t, second.BatchID, first.BatchID)
}

// registryDeclares reports whether the pass would FETCH a price for this asset.
func (f *riskdFixture) registryDeclares(asset []byte) bool {
	for _, k := range f.cfg.Registry.PriceKeys() {
		if string(k.Asset) == string(asset) {
			return true
		}
	}
	return false
}

// judgedInBatch reports whether the asset appears as a price disclosure on a batch —
// i.e. whether Assemble actually judged it.
func (f *riskdFixture) judgedInBatch(t *testing.T, batchID int64, asset []byte) bool {
	t.Helper()
	rows, err := f.store.RiskBatchPriceInputs(f.ctx, batchID)
	require.NoError(t, err)
	for _, r := range rows {
		if string(r.Asset) == string(asset) {
			return true
		}
	}
	return false
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

// TestRiskdUnusedRowNeutralizedInPlaceDoesNotChangeTheIdentity is the round-5
// [medium] finding: the last door on the scoping law.
//
// Round 4 restricted the freshness PHASES to the consulted set but left the substrate
// digest hashing every FETCHED row. An honest D-012 repair can neutralize or supersede
// an UNRELATED registered asset in place, moving no cursor — so on restart the
// assembler never consults that asset, recomputes the used price against its
// already-published value (producing no G5 flag), and yet the unused row's changed
// digest mints a new key. A clean batch then lands over the flagged one.
//
// This is deliberately the variant the round-4 test could not see: that one moved only
// elapsed time and left every fetched row byte-identical, so the digest never entered
// the picture. Here the row's VALUE and VALIDITY change on disk and the vector does
// not move at all.
//
// MUTANT THIS KILLS: hash inputs.Prices in substrateDigest instead of the consulted
// set. The restart derives a different key, declines to adopt, and writes an unflagged
// batch — the FlagLargeStep assertion at the end fails.
func TestRiskdUnusedRowNeutralizedInPlaceDoesNotChangeTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)

	// A REGISTERED but unheld asset: an OP Debt Manager collateral token, while the
	// only position in this fixture is on Aave. It is FETCHED every pass and
	// CONSULTED by none.
	unusedAsset := common20(fxDMCollateral)
	_, err := f.store.ApplyPolledPrices(f.ctx, "prices:poll:10", 10, []store.PriceObservation{
		{Asset: unusedAsset, Source: "priceproviderv2", Price: mustBig("3000000000"), Decimals: 6,
			BlockNumber: 154790000, SourceAsOf: time.Now().UTC()},
	}, 154790000, store.PollAnchor{BlockNumber: 154790000, BlockHash: hash32(0x78)})
	require.NoError(t, err)

	// Baseline, then a large downward move on the USED asset so the next pass flags it.
	baseline, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	f.seedPricesAt(t, fxPriceBlock+10, "180000000000", "100000000")
	_, err = f.admin.Exec(f.ctx, `UPDATE prices SET source_as_of = now() WHERE chain_id = 1`)
	require.NoError(t, err)

	flagged, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, flagged.BatchID, baseline.BatchID)
	require.Equal(t, 1, flagged.Flagged)
	require.Contains(t, aavePositionOf(t, f, flagged.BatchID).Flags, riskfeed.FlagLargeStep)

	// PROVE the premise: fetched, never consulted.
	require.True(t, f.registryDeclares(unusedAsset), "asset B must be in the FETCHED key set")
	require.False(t, f.judgedInBatch(t, flagged.BatchID, unusedAsset),
		"and it must NOT appear as a consulted disclosure on the batch")

	cursorsBefore := cursorSnapshot(t, f)
	usedRowsBefore := priceRowFingerprint(t, f)

	// THE IN-PLACE D-012 REPAIR on the unused row: validity flipped and a superseding
	// row landed. No cursor moves; the used asset's rows are untouched.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE prices SET valid = false, invalid_reason = 'unverifiable after a reorg: no surviving poll anchor covers this observation'
		 WHERE chain_id = 10 AND asset = $1`, unusedAsset)
	require.NoError(t, err)
	_, err = f.admin.Exec(f.ctx,
		`INSERT INTO prices (chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, source_as_of)
		 VALUES (10, $1, 'priceproviderv2', 999999, 6, 154790001, 'prices:poll:10', true, now())`,
		unusedAsset)
	require.NoError(t, err)

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f),
		"NOT ONE cursor moved — the repair is in place")
	require.Equal(t, usedRowsBefore, priceRowFingerprint(t, f),
		"and the USED asset's rows are byte-identical")

	// THE RESTART. Its own recomputation is re-baselined and therefore UNFLAGGED, so
	// if it writes a batch the warning is gone.
	restarted := f.restartedConfig(t)
	afterRestart, err := runPass(f.ctx, f.store, restarted)
	require.NoError(t, err)
	require.Equal(t, flagged.MaterializationKey, afterRestart.MaterializationKey,
		"an UNCONSULTED row repaired in place must not change the materialization identity")
	require.Equal(t, flagged.BatchID, afterRestart.BatchID, "so the restart ADOPTS")

	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 2, n, "no third batch — the restart adopted instead of writing")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, flagged.BatchID, batch.ID)
	require.Equal(t, 1, batch.FlaggedCount)
	require.Contains(t, aavePositionOf(t, f, batch.ID).Flags, riskfeed.FlagLargeStep,
		"the large-step warning SURVIVES an in-place repair of an unrelated row")
}

// TestRiskdConsumedRowNeutralizedInPlaceChangesTheIdentity is the counterweight
// demanded alongside: the SAME in-place mutation on a CONSULTED witness must change
// the key AND the verdict. Scoping the digest must not make a real repair invisible.
func TestRiskdConsumedRowNeutralizedInPlaceChangesTheIdentity(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	before, err := f.store.RiskBatchPriceInputs(f.ctx, first.BatchID)
	require.NoError(t, err)
	require.NotEmpty(t, before)
	collateralBefore := priceOfAsset(t, before, fxAave)
	require.Equal(t, "300000000000", collateralBefore)

	cursorsBefore := cursorSnapshot(t, f)

	// The same repair shape, on the CONSUMED collateral witness: the row the batch
	// actually valued is neutralized and superseded in place.
	_, err = f.admin.Exec(f.ctx,
		`UPDATE prices SET valid = false, invalid_reason = 'unverifiable after a reorg: no surviving poll anchor covers this observation'
		 WHERE chain_id = 1 AND asset = $1`, fxAave.Bytes())
	require.NoError(t, err)
	_, err = f.admin.Exec(f.ctx,
		`INSERT INTO prices (chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, source_as_of)
		 VALUES (1, $1, $2, 250000000000, 8, $3, 'prices:poll:1', true, now())`,
		fxAave.Bytes(), "aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f", fxPriceBlock+1)
	require.NoError(t, err)

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f),
		"the repair is in place: no cursor moved here either")

	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, first.MaterializationKey, second.MaterializationKey,
		"a CONSUMED witness repaired in place IS a new materialization")
	require.Greater(t, second.BatchID, first.BatchID)

	after, err := f.store.RiskBatchPriceInputs(f.ctx, second.BatchID)
	require.NoError(t, err)
	require.Equal(t, "250000000000", priceOfAsset(t, after, fxAave),
		"and the repaired value is what gets served")
}

// priceOfAsset pulls one asset's disclosed price value out of a batch's snapshots.
func priceOfAsset(t *testing.T, rows []store.RiskBatchPriceInput, asset common.Address) string {
	t.Helper()
	for _, r := range rows {
		if common.BytesToAddress(r.Asset) == asset && r.Value != nil {
			return r.Value.String()
		}
	}
	t.Fatalf("no disclosed price for %s", asset.Hex())
	return ""
}
