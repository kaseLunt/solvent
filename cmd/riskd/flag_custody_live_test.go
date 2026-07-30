package main

// Flag-custody provenance, end to end through the real daemon pass.
//
// This file exists because the round-1 collateral-flag wave shipped a law whose
// PRECONDITION was not enforced, and the finding's whole force was operational: not
// "the law is wrong" but "an honest deploy of this binary, before the owner-gated
// replay, produces a false liquidation alarm". A unit test on the assembler cannot
// close that; the shape has to be unwritable through the daemon's own pass.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// unprovenAaveCoverage puts the Aave cursor into the state a PRE-FLAG BINARY
// leaves: same head block, no coverage provenance at all.
//
// It is a direct UPDATE rather than a store call on purpose — no writer in this
// repo can produce a proven stamp without walking the range, which is the property
// the fix rests on, so the only way to model the legacy state is to write the
// legacy row. That is exactly what migration 00014 leaves behind on the live
// database, and TestMigrateUpgradesV13BaselineWithDerivationCoverage proves it.
func (f *riskdFixture) unprovenAaveCoverage(t *testing.T) {
	t.Helper()
	// ALL THREE provenance fields, because that is what a pre-00014 row is: the
	// columns did not exist, so none of them can carry a claim. Clearing only two
	// would model a database that no migration and no writer can produce.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET covered_from_block = NULL, decoder_revision = 0,
		        coverage_binding = ''
		 WHERE engine = $1`, risk.AaveEngine)
	require.NoError(t, err)
}

// dropFlagLedger removes every derived collateral-flag row — the other half of the
// pre-replay state, since a binary that could not decode those events derived none.
// Unproven coverage over a POPULATED ledger is a database that cannot exist.
func (f *riskdFixture) dropFlagLedger(t *testing.T) {
	t.Helper()
	_, err := f.admin.Exec(f.ctx,
		`DELETE FROM position_events WHERE event_type IN ($1, $2)`,
		store.AaveCollateralEnabledEvent, store.AaveCollateralDisabledEvent)
	require.NoError(t, err)
}

// TestRiskdRefusesTheAaveBookOnAnUnbackfilledFlagLedger is the round-1 [high]
// regression AT THE DAEMON LEVEL — the shape Codex demanded be made unwritable.
//
// THE HISTORY IT FORBIDS, exactly as it would have happened: this release is
// deployed against the live database BEFORE the owner-gated replay. The Aave cursor
// is at head and passes every existing gate — schema version, required cursors,
// epoch acks — but the flag ledger was never derived, because the binary that
// walked it could not decode those events. The collateral law would read that
// emptiness as "nobody has ever used anything as collateral" and publish HF 0 for
// the borrowers whose weETH genuinely IS enabled (23 of them on the live book): a
// false liquidation alarm, and strictly worse than the assume-true posture this
// wave retired.
//
// MUTANT THIS KILLS: any of — drop the `if !a.flagCustody` refusal in assembleAave;
// make store.CoverageClaim.Satisfies accept a nil covered-from; stop wiring
// Aave.GenesisBlock in loadConfig; have seedRequiredCursors claim coverage it never
// walked. Each one turns the refusal below back into a published health factor of 0.
func TestRiskdRefusesTheAaveBookOnAnUnbackfilledFlagLedger(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	f.unprovenAaveCoverage(t)

	// The flag ledger is emptied too, because that is inseparable from the state
	// being modelled: a binary that could not decode the flag events derived NO flag
	// rows. Leaving the fixture's enable witness in place would model an impossible
	// database — unproven coverage over a populated ledger — and would let this test
	// pass for the wrong reason.
	f.dropFlagLedger(t)

	var flagRows int
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT count(*) FROM position_events WHERE event_type IN ($1, $2)`,
		store.AaveCollateralEnabledEvent, store.AaveCollateralDisabledEvent).Scan(&flagRows))
	require.Zero(t, flagRows, "this test is about an UNBACKFILLED flag ledger")

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err, "the pass still completes - this is a refusal, not a crash")

	positions, err := f.store.RiskBatchPositions(f.ctx, res.BatchID)
	require.NoError(t, err)
	require.Len(t, positions, 1)
	p := positions[0]

	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "rewind-and-rederive",
		"the refusal names the remedy, so an operator is not left to infer it")

	// THE EXACT SHAPE THE FINDING DESCRIBED, PROVEN ABSENT: no health factor of
	// zero reached the served surface, in any form.
	require.Nil(t, p.HFWad, "an HF of 0 over an unproven ledger is what this test exists to forbid")
	require.Nil(t, p.TotalCollateralBase)
	require.Equal(t, 1, res.Refused)

	// The batch's own aggregate agrees: nothing computed, nothing summed. An
	// understated total would be the same lie in a different column.
	aggs, err := f.store.RiskBatchAggregates(f.ctx, res.BatchID)
	require.NoError(t, err)
	for _, a := range aggs {
		if a.Engine == risk.AaveEngine {
			require.Equal(t, 1, a.RefusedPositions)
			require.Equal(t, 0, a.ComputedPositions)
			require.Equal(t, "0", a.TotalCollateral.String())
		}
	}

	// AND THE VECTOR SAYS WHY — an operator reading a refused book must be able to
	// see the provenance gap without attaching a debugger.
	var vector string
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT materialization_vector FROM risk_batches WHERE id = $1`, res.BatchID).Scan(&vector))
	require.Contains(t, vector, risk.AaveEngine+"@1/")
	require.Contains(t, vector, "/covnone/rev0/walked;",
		"all three provenance fields read as unknown in the persisted vector — and the walked "+
			"surface is one of them, so a binding-only repair mints a new key")
}

// TestRiskdComputesTheAaveBookOnceCoverageIsProven is the COUNTERWEIGHT, and it
// matters as much as the refusal: a gate that refused unconditionally would pass
// the test above while making the product useless.
//
// The two fixtures differ ONLY in the coverage stamp and the witness behind it —
// which is to say, only in what the owner-gated replay changes.
func TestRiskdComputesTheAaveBookOnceCoverageIsProven(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// seedRequiredCursors established coverage from the engine's genesis, and
	// seedHealthyAavePosition supplied the enable witness. Assert the premise.
	var covered *int64
	var rev int32
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT covered_from_block, decoder_revision FROM derive_cursors WHERE engine = $1`,
		risk.AaveEngine).Scan(&covered, &rev))
	require.NotNil(t, covered, "the proven fixture must actually carry coverage")
	require.EqualValues(t, fxAaveGenesis, *covered)
	require.GreaterOrEqual(t, int(rev), decode.RevisionAaveCollateralFlags)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	positions, err := f.store.RiskBatchPositions(f.ctx, res.BatchID)
	require.NoError(t, err)
	require.Len(t, positions, 1)
	p := positions[0]
	require.Equal(t, store.RiskPositionComputed, p.Status,
		"proven coverage plus a witnessed enable means the book is servable")
	require.Equal(t, "2430000000000000000", p.HFWad.String(),
		"and it is the SAME hand-computed health factor the rest of the wave pins")
	require.Equal(t, "300000000000", p.TotalCollateralBase.String())
}

// TestRiskdFlagCustodyRefusalSparesTheDebtManager: the refusal is engine-scoped. An
// unproven AAVE ledger must not withhold the OP book, which has no absence-reading
// law and whose derivation is unaffected — withholding it would turn one engine's
// provenance gap into a total outage.
func TestRiskdFlagCustodyRefusalSparesTheDebtManager(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)
	f.seedDMPosition(t)
	f.unprovenAaveCoverage(t)

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	positions, err := f.store.RiskBatchPositions(f.ctx, res.BatchID)
	require.NoError(t, err)
	var sawAaveRefusal, sawDM bool
	for _, p := range positions {
		switch p.Engine {
		case risk.AaveEngine:
			require.Equal(t, store.RiskPositionRefused, p.Status)
			require.Equal(t, riskfeed.GateFlagCustodyUnproven, p.RefusalCode)
			sawAaveRefusal = true
		case risk.DMEngine:
			require.NotEqual(t, riskfeed.GateFlagCustodyUnproven, p.RefusalCode,
				"the Debt Manager must never be refused for an Aave provenance gap")
			sawDM = true
		}
	}
	require.True(t, sawAaveRefusal, "the Aave refusal must be a ROW, not an omission")
	require.True(t, sawDM, "and the DM position must still be in the batch")
}
