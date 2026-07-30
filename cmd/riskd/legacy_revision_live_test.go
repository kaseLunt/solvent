package main

// THE ADOPTION SEAM AND THE REVISION BUMP.
//
// Round 3 [high]: `WriteRiskBatch` adopts an existing complete batch whose vector and
// substrate digest match. A revision-3 binary materializes the empty/unproven Aave
// state WITHOUT an engine refusal (it had no such concept); if the revision had not
// been bumped, the corrected binary would compute the refusal, derive the IDENTICAL
// key, adopt the legacy batch, and `NewestCompleteBatch` would keep reporting
// RefusedEngines=[] / RefusedCount=0 — the original vacuous green, re-entered through
// the adoption path instead of the account loop.
//
// The legacy batch here is not hand-assembled. It is written by the PRODUCTION path
// and then rewritten into the legacy shape, which is both less fragile than
// constructing a batch that satisfies every completeness conjunct by hand and a
// closer model of what a rev-3 binary actually left on disk.

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// materializationKey is the identity's own key formula. It is duplicated here ON
// PURPOSE and immediately cross-checked against the key production actually stored
// (see the assertion in the test): if riskfeed's formula ever changes, this test
// fails loudly rather than silently constructing a key nobody would have derived.
func materializationKey(vector, digest string) string {
	sum := sha256.Sum256([]byte(vector + "substrate:" + digest))
	return hex.EncodeToString(sum[:])
}

type storedIdentity struct {
	key    string
	vector string
	digest string
}

func identityOf(t *testing.T, f *riskdFixture, batchID int64) storedIdentity {
	t.Helper()
	var got storedIdentity
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT materialization_key, materialization_vector, substrate_digest
		 FROM risk_batches WHERE id = $1`, batchID).
		Scan(&got.key, &got.vector, &got.digest))
	return got
}

// TestRiskdDoesNotAdoptALegacyRevisionBatchOverTheEmptyUnprovenState is the round-3
// [high] regression.
//
// MUTANT THIS KILLS: revert AlgorithmRevision to 3. The pass then derives the legacy
// key, ADOPTS the legacy batch, no new batch is written, and the served summary keeps
// reporting an unrefused Aave engine over an explicitly unproven ledger.
func TestRiskdDoesNotAdoptALegacyRevisionBatchOverTheEmptyUnprovenState(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// The exact state the finding is about: the replay's rewind window — no Aave
	// accounts, no flag ledger, coverage unknown.
	require.NoError(t, f.store.RewindDerived(f.ctx, risk.AaveEngine, 1, fxAaveGenesis-1))
	f.dropFlagLedger(t)

	// ---- A production-written batch over that state, at the CURRENT revision.
	current, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	id := identityOf(t, f, current.BatchID)

	// The key formula this test uses is the one production used. Without this the
	// legacy key below would be a fabrication.
	require.Equal(t, id.key, materializationKey(id.vector, id.digest),
		"the identity key formula must match production's, or this test proves nothing")
	require.Contains(t, id.vector, "rev=4;", "the current revision is serialized in the vector")

	// ---- Rewrite it into what a REVISION-3 binary would have left behind: the same
	// materialization, keyed at rev 3, with NO engine refusal on the rollup.
	legacyVector := strings.Replace(id.vector, "rev=4;", "rev=3;", 1)
	require.NotEqual(t, id.vector, legacyVector)
	legacyKey := materializationKey(legacyVector, id.digest)
	require.NotEqual(t, id.key, legacyKey)

	_, err = f.admin.Exec(f.ctx,
		`UPDATE risk_batches SET materialization_key = $1, materialization_vector = $2 WHERE id = $3`,
		legacyKey, legacyVector, current.BatchID)
	require.NoError(t, err)
	_, err = f.admin.Exec(f.ctx,
		`UPDATE risk_batch_aggregates SET refusal_code = '', refusal_detail = '' WHERE batch_id = $1`,
		current.BatchID)
	require.NoError(t, err)

	// THE HAZARD IS LIVE: the legacy batch is complete, servable, and reads healthy
	// over an unproven ledger. If the assertions below did not hold, this is what a
	// consumer would keep getting.
	legacyBatch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, current.BatchID, legacyBatch.ID)
	require.Empty(t, legacyBatch.RefusedEngines, "the legacy shape: no engine refusal...")
	require.Zero(t, legacyBatch.RefusedCount, "...and no refused positions either — a clean-looking batch")

	// ---- THE PASS THAT MUST NOT ADOPT.
	replacement, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.NotEqual(t, current.BatchID, replacement.BatchID,
		"the revision bump must prevent adoption: a REFUSED REPLACEMENT is written, not the legacy batch reused")
	require.Greater(t, replacement.BatchID, current.BatchID)
	require.Equal(t, id.key, replacement.MaterializationKey,
		"and the replacement carries the CURRENT revision's key")

	agg := aaveAggregateOf(t, f, replacement.BatchID)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, agg.RefusalCode,
		"the replacement states the refusal the legacy batch could not express")

	served, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, replacement.BatchID, served.ID,
		"and the SERVED batch is the refused replacement, not the healthy-looking legacy one")
	require.Contains(t, served.RefusedEngines, risk.AaveEngine)
}

// TestRiskdStillAdoptsAMatchingCurrentRevisionBatch is the counterweight, and without
// it the test above proves only that adoption is broken.
//
// Same state, same everything — but the batch on disk carries the CURRENT revision's
// key. It must be ADOPTED, so the non-adoption above is attributable to the revision
// difference and to nothing else.
func TestRiskdStillAdoptsAMatchingCurrentRevisionBatch(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	require.NoError(t, f.store.RewindDerived(f.ctx, risk.AaveEngine, 1, fxAaveGenesis-1))
	f.dropFlagLedger(t)

	first, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	// Nothing about the substrate changed, and the key is untouched.
	second, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, first.BatchID, second.BatchID,
		"an unchanged materialization at the SAME revision is adopted, not duplicated")
	require.Equal(t, first.MaterializationKey, second.MaterializationKey)

	var batches int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&batches))
	require.Equal(t, 1, batches, "no duplicate was written")
}

// TestRiskdRevisionIsSerializedIntoEveryBatchVector guards the wiring the test above
// depends on: a revision that never reached the vector could not discriminate
// anything, and both tests would pass while the hole stayed open.
func TestRiskdRevisionIsSerializedIntoEveryBatchVector(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	id := identityOf(t, f, res.BatchID)

	require.Contains(t, id.vector, "rev=4;",
		"riskfeed.AlgorithmRevision must be 4 AND actually serialized; bump the constant and this expectation together")
	require.NotContains(t, id.vector, "rev=3;")

	// And GenesisBlock — the round-3 [medium] — is in the binding, so a corrected
	// start block cannot adopt a batch computed under the old bar. The WALKED SURFACE
	// (round-5) rides in the same token for the same reason.
	require.Contains(t, id.vector, "/genesis20625519/surface"+fxAaveBinding+";",
		"the flag-custody bar AND the walked surface are both part of the identity")
}
