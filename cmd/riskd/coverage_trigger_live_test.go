package main

// THE RECOMPUTE TRIGGER AND DERIVATION COVERAGE.
//
// Round 2 [medium]: `watermarkVector.Changed` compared only LastBlock, AckedEpoch
// and ChainID, while coverage now switches the Aave engine between REFUSED and
// COMPUTED. The identity's cov/rev distinction is necessary but not sufficient —
// `ComputeMaterializationIdentity` only runs if something first decides a pass is
// worth doing, and the trigger is that something.
//
// The blind spot is an ENDPOINT ABA, and it is scheduled rather than hypothetical:
// the owner-gated replay rewinds and re-derives back to the SAME height with the
// SAME acked epoch. A daemon that observes no intermediate cursor position — polling
// paused for maintenance, or failing throughout it — sees identical height, epoch
// and chain at both ends. Under the old comparison it would report "nothing changed"
// and keep serving the refused pre-replay batch indefinitely.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// setAaveCoverage writes the coverage provenance directly.
//
// A direct UPDATE is the only way to model the ENDPOINT of the replay while holding
// every other component fixed: the production writers necessarily move the cursor
// too, which is exactly the intermediate observation this test must deny itself.
func (f *riskdFixture) setAaveCoverage(t *testing.T, coveredFrom *uint64, rev int32) {
	t.Helper()
	var arg any
	if coveredFrom != nil {
		arg = int64(*coveredFrom)
	}
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET covered_from_block = $1, decoder_revision = $2 WHERE engine = $3`,
		arg, rev, risk.AaveEngine)
	require.NoError(t, err)
}

// aaveCursorFingerprint captures every trigger component EXCEPT coverage, so a test
// can prove it isolated coverage rather than accidentally moving something else.
func aaveCursorFingerprint(t *testing.T, f *riskdFixture) [3]int64 {
	t.Helper()
	var lastBlock, ackedEpoch, chainID int64
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT last_block, acked_epoch, chain_id FROM derive_cursors WHERE engine = $1`,
		risk.AaveEngine).Scan(&lastBlock, &ackedEpoch, &chainID))
	return [3]int64{lastBlock, ackedEpoch, chainID}
}

// TestRiskdCoverageOnlyFlipTriggersARecompute is the demanded endpoint-ABA test:
// every existing component unchanged, coverage flips NULL/0 → genesis/current
// revision, and the loop must recompute.
//
// MUTANT THIS KILLS: drop the sameCoverage leg from watermarkVector.Changed. The
// trigger then reports no change, the refused batch stays served, and the identity's
// cov/rev key never gets the chance to distinguish anything.
func TestRiskdCoverageOnlyFlipTriggersARecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// (A) The pre-replay endpoint: balances at head, ledger unwalked, coverage unknown.
	f.unprovenAaveCoverage(t)
	f.dropFlagLedger(t)

	refused, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aaveAggregateOf(t, f, refused.BatchID).RefusalCode)
	baseline := refused.Vector
	fingerprintBefore := aaveCursorFingerprint(t, f)

	// A quiet tick changes nothing — the premise, so the assertion below is about
	// coverage and not about the trigger firing on everything.
	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.False(t, changed, "nothing has moved yet")

	// (B) THE REPLAY'S ENDPOINT. Coverage alone flips to proven; height, epoch and
	// chain are untouched, which is what makes this an ABA the old comparison missed.
	genesis := fxAaveGenesis
	f.setAaveCoverage(t, &genesis, decode.RegistryRevision)
	require.Equal(t, fingerprintBefore, aaveCursorFingerprint(t, f),
		"height/epoch/chain must be BYTE-IDENTICAL, or this test is not isolating coverage")

	changed, _, _, err = pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.True(t, changed,
		"a coverage-only transition flips the whole Aave book from refused to computable, so the trigger must fire")

	// And the recompute really does heal the book (the trigger is worth firing).
	f.seedHealthyAavePosition(t)
	healed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, healed.BatchID, refused.BatchID)
	require.Empty(t, aaveAggregateOf(t, f, healed.BatchID).RefusalCode)
	require.NotEqual(t, refused.MaterializationKey, healed.MaterializationKey,
		"and it is a genuinely new materialization, so it cannot adopt the refused batch")
}

// TestRiskdCoverageLossTriggersARecompute is the REVERSE direction, and it is the
// one that protects against serving a number whose provenance has just evaporated.
//
// Proven → unproven must not leave a previously COMPUTED batch standing.
func TestRiskdCoverageLossTriggersARecompute(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	computed, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, store.RiskPositionComputed, aavePositionOf(t, f, computed.BatchID).Status)
	baseline := computed.Vector
	fingerprintBefore := aaveCursorFingerprint(t, f)

	changed, _, _, err := pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.False(t, changed)

	// Coverage is lost with nothing else moving — e.g. a window applied by a tool
	// that could not vouch for what it walked (store.ApplyDerivedWithRates clears
	// the stamp by design).
	f.setAaveCoverage(t, nil, 0)
	require.Equal(t, fingerprintBefore, aaveCursorFingerprint(t, f),
		"again, coverage and nothing else")

	changed, _, _, err = pollTrigger(f.ctx, f.store, f.cfg, baseline)
	require.NoError(t, err)
	require.True(t, changed,
		"provenance evaporating is a change: a computed book must not keep standing on it")

	// And the recompute withholds the book, so no stale computed batch is served.
	withheld, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, withheld.BatchID, computed.BatchID)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aaveAggregateOf(t, f, withheld.BatchID).RefusalCode)

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, withheld.BatchID, batch.ID,
		"the SERVED batch is the withheld one, not the earlier computed one")
	require.Contains(t, batch.RefusedEngines, risk.AaveEngine)
}

// TestChangedComparesCoverageExactly pins the comparison itself, including the leg a
// naive implementation gets wrong: nil is not zero.
//
// A `*uint64` compared by pointer identity, or dereferenced without a nil guard,
// would either report spurious changes forever or panic. Treating nil as 0 would
// make "no walk vouches for this state" indistinguishable from "walked from block
// zero" — and block zero is a legal covered-from for a chain whose engine starts there.
func TestChangedComparesCoverageExactly(t *testing.T) {
	genesis := uint64(20_625_519)
	sameGenesis := uint64(20_625_519) // distinct pointer, equal value
	other := uint64(20_625_520)
	zero := uint64(0)

	vec := func(coveredFrom *uint64, rev int32) watermarkVector {
		return watermarkVector{
			Engines: map[string]store.DeriveCursorState{
				risk.AaveEngine: {
					Engine: risk.AaveEngine, ChainID: 1, LastBlock: 100, AckedEpoch: 3,
					CoveredFromBlock: coveredFrom, DecoderRevision: rev,
				},
			},
			MaxEpochs: map[int64]int64{1: 3},
			Sweep:     map[string]store.RiskSweepWatermark{},
		}
	}

	base := vec(&genesis, 2)

	require.False(t, base.Changed(vec(&sameGenesis, 2)),
		"EQUAL VALUES through DIFFERENT POINTERS are not a change — a pointer-identity comparison would recompute forever")
	require.True(t, base.Changed(vec(nil, 0)), "proven -> unproven is a change")
	require.True(t, vec(nil, 0).Changed(base), "and unproven -> proven is a change")
	require.True(t, base.Changed(vec(&other, 2)), "a different covered-from is a change")
	require.True(t, base.Changed(vec(&genesis, 3)), "a different decoder revision is a change")
	require.True(t, vec(nil, 0).Changed(vec(&zero, 0)),
		"NIL IS NOT ZERO: unknown provenance must not equal 'walked from block 0'")
	require.False(t, vec(nil, 0).Changed(vec(nil, 0)), "two unknowns are the same unknown")
}
