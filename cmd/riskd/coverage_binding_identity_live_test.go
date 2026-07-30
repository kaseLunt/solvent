package main

// THE WALKED SURFACE IN THE TWO CHANGE-DETECTION SURFACES.
//
// Round 7 found that CoverageBinding decided refuse-vs-compute but had joined
// NEITHER of the two places the other provenance fields joined in round 3: the
// recompute TRIGGER (watermarkVector.Changed via sameCoverage) and the
// materialization IDENTITY (the cursor line of the vector). The completion rule is
// now stated in riskfeed's audited-premises comment; these are its regressions.
//
// Both halves are required and neither substitutes for the other:
//
//	trigger missing  -> no pass is ever scheduled, so the stale verdict stays served
//	identity missing -> a forced pass derives the pre-repair key and ADOPTS the stale
//	                    batch, which the EMPTY-BOOK case makes unavoidable

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// setAaveBinding rewrites ONLY the persisted walked-surface binding.
//
// A direct UPDATE is the only way to hold every other watermark byte-fixed while the
// binding moves — which is precisely the endpoint the replay arrives at, and the
// state a daemon that observed no intermediate position would see.
func (f *riskdFixture) setAaveBinding(t *testing.T, binding string) {
	t.Helper()
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET coverage_binding = $1 WHERE engine = $2`,
		binding, risk.AaveEngine)
	require.NoError(t, err)
}

// aaveProvenanceFingerprint captures every OTHER trigger component, so a test can
// prove it isolated the binding rather than accidentally moving something else.
func aaveProvenanceFingerprint(t *testing.T, f *riskdFixture) [4]string {
	t.Helper()
	var lastBlock, ackedEpoch, chainID string
	var covered *string
	var rev string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT last_block::text, acked_epoch::text, chain_id::text,
		        covered_from_block::text, decoder_revision::text
		 FROM derive_cursors WHERE engine = $1`, risk.AaveEngine).
		Scan(&lastBlock, &ackedEpoch, &chainID, &covered, &rev))
	cov := "none"
	if covered != nil {
		cov = *covered
	}
	return [4]string{lastBlock + "/" + ackedEpoch + "/" + chainID, cov, rev, ""}
}

// TestRiskdBindingOnlyFlipTriggersARecompute is the round-7 [high] trigger half,
// FORWARD direction: a mismatched surface becomes the configured one.
//
// MUTANT THIS KILLS: drop the CoverageBinding leg from sameCoverage. pollTrigger then
// reports no change, no pass is scheduled, and the refused batch stays served.
func TestRiskdBindingOnlyFlipTriggersARecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// (A) The pre-replay endpoint: everything walked, but over a DIFFERENT surface
	// than the configuration now names.
	stale := store.CoverageBindingOf(1, []store.CoverageStream{
		{Address: fxAave.Bytes(), StartBlock: fxAaveGenesis},
		{Address: fxAaveDb.Bytes(), StartBlock: fxAaveGenesis},
	})
	require.NotEqual(t, fxAaveBinding, stale, "the premise: the surfaces differ")
	f.setAaveBinding(t, stale)

	refused, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aaveAggregateOf(t, f, refused.BatchID).RefusalCode,
		"a claim over another surface cannot license the book")
	baseline := refused.Vector
	fingerprintBefore := aaveProvenanceFingerprint(t, f)

	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.False(t, changed, "nothing has moved yet")

	// (B) THE REPLAY'S ENDPOINT — binding only.
	f.setAaveBinding(t, fxAaveBinding)
	require.Equal(t, fingerprintBefore, aaveProvenanceFingerprint(t, f),
		"height/epoch/chain/covered-from/revision must be BYTE-IDENTICAL, or this is not a binding-only test")

	changed, _, _, err = pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.True(t, changed,
		"the walked surface flipping the whole Aave book from refused to computable must wake the loop")

	healed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, healed.BatchID, refused.BatchID)
	require.Empty(t, aaveAggregateOf(t, f, healed.BatchID).RefusalCode)
}

// TestRiskdBindingOnlyLossTriggersARecompute is the REVERSE direction: a computed
// book must not keep standing on a surface that no longer matches the configuration.
func TestRiskdBindingOnlyLossTriggersARecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	computed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, store.RiskPositionComputed, aavePositionOf(t, f, computed.BatchID).Status)
	baseline := computed.Vector
	fingerprintBefore := aaveProvenanceFingerprint(t, f)

	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.False(t, changed)

	// The surface the database was walked over stops matching the configured one —
	// e.g. a stream added to the config, with the cursor already at head.
	f.setAaveBinding(t, store.CoverageBindingOf(1, []store.CoverageStream{
		{Address: fxAave.Bytes(), StartBlock: fxAaveGenesis},
		{Address: fxAaveDb.Bytes(), StartBlock: fxAaveGenesis},
	}))
	require.Equal(t, fingerprintBefore, aaveProvenanceFingerprint(t, f),
		"again, the binding and nothing else")

	changed, _, _, err = pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.True(t, changed,
		"a computed book must not keep standing on a surface that stopped matching")

	withheld, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aaveAggregateOf(t, f, withheld.BatchID).RefusalCode)

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, withheld.BatchID, batch.ID, "the SERVED batch is the withheld one")
	require.Contains(t, batch.RefusedEngines, risk.AaveEngine)
}

// TestRiskdEmptyBookBindingRepairIsNotAdopted is Codex's DECISIVE regression for the
// identity half, and the empty account set is what makes it decisive.
//
// With no Aave positions, every substrate row is identical across the repair — no
// balance, index, param, price or flag row moves — so the substrate digest CANNOT
// change. The vector is the only thing that can carry the difference, and before this
// round its cursor line omitted the persisted binding. So the healing pass derived the
// pre-repair key and ADOPTED the refused batch: the engine refusal stayed on the
// served rollup forever, over a ledger that was by then perfectly good.
//
// MUTANT THIS KILLS: remove `/walked%s` from the cursor line in
// ComputeMaterializationIdentity. The keys below become equal, no new batch is
// written, and the refusal is never cleared.
func TestRiskdEmptyBookBindingRepairIsNotAdopted(t *testing.T) {
	f := newRiskdFixture(t)
	// NO positions seeded: the Aave book is empty. seedRequiredCursors has already
	// established coverage from genesis over the fixture surface.

	// (A) The pre-repair state: coverage walked over a DIFFERENT surface.
	stale := store.CoverageBindingOf(1, []store.CoverageStream{
		{Address: fxAave.Bytes(), StartBlock: fxAaveGenesis},
		{Address: fxAaveDb.Bytes(), StartBlock: fxAaveGenesis},
	})
	f.setAaveBinding(t, stale)

	refused, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	agg := aaveAggregateOf(t, f, refused.BatchID)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, agg.RefusalCode,
		"an empty book over an unmatched surface is WITHHELD, not healthy-empty")
	require.Zero(t, agg.Positions, "and it really is empty — that is what makes the digest immovable")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Contains(t, batch.RefusedEngines, risk.AaveEngine)

	// (B) THE REPAIR: binding only. Nothing else in the database changes at all.
	f.setAaveBinding(t, fxAaveBinding)

	healed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	require.NotEqual(t, refused.MaterializationKey, healed.MaterializationKey,
		"the persisted surface is part of the identity, so this is a NEW materialization")
	require.NotEqual(t, refused.BatchID, healed.BatchID,
		"THE REFUSED BATCH MUST NOT BE ADOPTED — the whole point of the identity leg")
	require.Greater(t, healed.BatchID, refused.BatchID)

	// THE REFUSAL IS CLEARED ON THE HEALING BATCH.
	healedAgg := aaveAggregateOf(t, f, healed.BatchID)
	require.Empty(t, healedAgg.RefusalCode,
		"the engine is servable again: an empty book under a MATCHING surface is healthy-empty")
	require.Zero(t, healedAgg.Positions)

	batch, found, err = f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, healed.BatchID, batch.ID)
	require.Empty(t, batch.RefusedEngines,
		"and the served summary stops naming the engine")

	// The substrate really was identical across the repair — pinning WHY the vector
	// had to carry it. If this fails the test is passing for the wrong reason.
	var refusedDigest, healedDigest string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT substrate_digest FROM risk_batches WHERE id = $1`, refused.BatchID).Scan(&refusedDigest))
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT substrate_digest FROM risk_batches WHERE id = $1`, healed.BatchID).Scan(&healedDigest))
	require.Equal(t, refusedDigest, healedDigest,
		"identical substrate: the digest cannot distinguish these passes, so the VECTOR must")
}
