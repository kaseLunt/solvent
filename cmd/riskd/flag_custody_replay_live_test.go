package main

// The OWNER-GATED REPLAY WINDOW, driven through the real daemon.
//
// Round 2 found that the round-1 custody refusal was enforced only inside the
// per-account loop, so it evaporated in the one state the replay is guaranteed to
// pass through: `RewindDerived(StartBlock-1)` deletes every event-sourced Aave
// balance, the loop iterates zero accounts, and the pass persisted an Aave rollup
// of positions=0 / refused=0 / totals=0 — structurally complete and readable as
// "this engine has no risk". A vacuous green in the repair window is worse than a
// loud refusal, because it is the state an operator is least likely to be watching.
//
// These tests walk the replay in order and assert the SERVED state at each step.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// aaveAggregateOf returns the Aave rollup row of a batch.
func aaveAggregateOf(t *testing.T, f *riskdFixture, batchID int64) store.RiskEngineAggregate {
	t.Helper()
	aggs, err := f.store.RiskBatchAggregates(f.ctx, batchID)
	require.NoError(t, err)
	for _, a := range aggs {
		if a.Engine == risk.AaveEngine {
			return a
		}
	}
	t.Fatalf("no Aave aggregate on batch %d", batchID)
	return store.RiskEngineAggregate{}
}

// TestRiskdRefusesTheAaveBookMidReplayWithNoAccountsLeft is Codex's demanded
// regression: run the daemon IMMEDIATELY after the deep rewind and BEFORE the first
// re-derivation window, and assert the served state is a REFUSAL, not an empty book.
//
// MUTANT THIS KILLS: remove the engineRefusals leg from riskfeed.Assemble /
// aggregate() (i.e. keep the custody refusal only inside the account loop). Every
// assertion below still finds a complete batch — and it reports zero positions, zero
// refusals and zero totals with no refusal code, which is exactly the vacuous green
// the finding described.
func TestRiskdRefusesTheAaveBookMidReplayWithNoAccountsLeft(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedHealthyAavePosition(t)

	// ---- Step 0: THE LIVE PRE-REPLAY STATE, not a healthy one.
	//
	// Balances at head, but the flag ledger was never derived and coverage is
	// unknown — a database walked by a binary that could not decode the flag events.
	// Modelling this step as "healthy" would make step 3 recreate step 0's exact
	// materialization, and the pass would correctly ADOPT that batch rather than
	// write a new one, so the test would be asserting against the wrong history.
	f.unprovenAaveCoverage(t)
	f.dropFlagLedger(t)

	before, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aavePositionOf(t, f, before.BatchID).RefusalCode,
		"pre-replay the accounts still exist, so the refusal lands per POSITION (the round-1 fix)")
	require.Equal(t, riskfeed.GateFlagCustodyUnproven,
		aaveAggregateOf(t, f, before.BatchID).RefusalCode,
		"and on the engine rollup as well — the two are consistent, one wording")

	// ---- Step 1: the replay's first move, through the PRODUCTION path.
	// RewindDerived(StartBlock-1) deletes every event-sourced Aave balance AND
	// clears the coverage stamp in the same transaction.
	require.NoError(t, f.store.RewindDerived(f.ctx, risk.AaveEngine, 1, fxAaveGenesis-1))

	// The premise, asserted: no accounts, no coverage. This is the exact window.
	var balances int
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT count(*) FROM position_balances WHERE engine = $1 AND source = 'event'`,
		risk.AaveEngine).Scan(&balances))
	require.Zero(t, balances, "the deep rewind emptied the Aave account set — that is the hazard")
	var covered *int64
	var rev int32
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT covered_from_block, decoder_revision FROM derive_cursors WHERE engine = $1`,
		risk.AaveEngine).Scan(&covered, &rev))
	require.Nil(t, covered, "and coverage went with the rows it described")
	require.EqualValues(t, 0, rev)

	// ---- Step 2: an honest riskd tick lands mid-window.
	mid, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err, "the tick completes; the question is what it publishes")

	// THE SERVED STATE IS A REFUSAL. There are no positions to carry it, so the
	// engine's own rollup row must.
	agg := aaveAggregateOf(t, f, mid.BatchID)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, agg.RefusalCode,
		"an empty-and-unproven Aave book must be REPRESENTED AS REFUSED, never as empty")
	require.Contains(t, agg.RefusalDetail, "rewind-and-rederive")
	require.Zero(t, agg.Positions, "there genuinely are no accounts...")
	require.Equal(t, "0", agg.TotalCollateral.String(), "...and no totals are claimed")

	// And the batch SUMMARY — what a serving path reads without touching the
	// per-engine rows — names the withheld engine. RefusedCount counts refused
	// POSITION rows and is therefore 0 here, which is precisely why the summary
	// needs its own signal.
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, mid.BatchID, batch.ID, "the mid-replay batch is what is being served")
	require.Contains(t, batch.RefusedEngines, risk.AaveEngine,
		"the served summary must say ENGINE REFUSED; RefusedCount alone cannot, and here it is zero")
	require.Zero(t, batch.RefusedCount,
		"pinning the trap: the position-level counter really is 0, so a reader trusting it would see a clean batch")

	// ---- Step 3: the replay completes — balances re-derived AND the flag ledger
	// populated AND coverage vouched for, all from the one walk. Coverage returns and
	// the book computes again: the gate is a gate, not a wall.
	f.seedHealthyAavePosition(t)
	after, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)
	require.Greater(t, after.BatchID, mid.BatchID)
	require.Empty(t, aaveAggregateOf(t, f, after.BatchID).RefusalCode,
		"once the walk vouches for the ledger the engine is servable again")
	require.Equal(t, store.RiskPositionComputed, aavePositionOf(t, f, after.BatchID).Status)

	batch, found, err = f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Empty(t, batch.RefusedEngines,
		"and the served summary stops naming it — the refusal does not become sticky")
}

// TestRiskdEmptyAaveBookIsDistinguishableFromAWithheldOne is the counterweight, and
// it is the assertion that makes the refusal MEAN something.
//
// A genuinely empty engine — proven coverage, no accounts — must NOT be refused.
// Without this, "refuse whenever positions==0" would pass the test above while
// withholding every honest empty book.
func TestRiskdEmptyAaveBookIsDistinguishableFromAWithheldOne(t *testing.T) {
	f := newRiskdFixture(t)
	// seedRequiredCursors already established PROVEN coverage from genesis; no
	// positions are seeded, so the Aave book is honestly empty.

	res, err := runPass(f.ctx, f.store, f.cfg)
	require.NoError(t, err)

	agg := aaveAggregateOf(t, f, res.BatchID)
	require.Zero(t, agg.Positions)
	require.Empty(t, agg.RefusalCode,
		"zero positions under PROVEN coverage is an empty book, not a withheld one")

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Empty(t, batch.RefusedEngines)
}
