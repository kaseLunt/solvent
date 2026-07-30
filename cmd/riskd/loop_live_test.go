package main

// The STEADY-STATE SCHEDULER, driven through runLoop rather than by calling
// runPass by hand.
//
// That distinction is the whole point of this file. The previous
// freshness-crossing test slept and then invoked runPass directly, which passes
// happily while the production loop never fires at all — precisely the bug it was
// supposed to be guarding. The recompute trigger watches cursors, epochs and sweep
// state, and NONE of those move when a price merely ages, so in an honest outage
// (ingestion stops while prices are fresh) nothing wakes the daemon as inputs cross
// 180s and then 360s. The newest batch keeps a persisted "fresh" verdict
// indefinitely instead of gaining G4 and then refusing at G1.
//
// # ONE loop, held across the crossing
//
// Every test here starts a single loop and advances the clock while it RUNS. That is
// not stylistic: restarting the loop fires its mandatory startup pass, which produces
// a new batch whether or not the freshness arm exists — so a test that stops and
// restarts the loop cannot distinguish the fix from its absence. It is exactly the
// mistake the first version of this file made, and the mutant survived it.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// liveLoop starts the real scheduler and returns a stop function. Nothing here
// calls runPass.
func liveLoop(t *testing.T, f *riskdFixture, cfg *daemonConfig) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(f.ctx)
	errCh := make(chan error, 1)
	go func() { errCh <- runLoop(ctx, f.store, cfg) }()
	stopped := false
	return func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		select {
		case err := <-errCh:
			require.NoError(t, err)
		case <-time.After(5 * time.Second):
			t.Fatal("runLoop did not return after cancellation")
		}
	}
}

// waitForBatches blocks until the batch count reaches n, or fails.
func waitForBatches(t *testing.T, f *riskdFixture, n int, why string) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for batchCount(t, f) < n {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %d batches (%s); have %d", n, why, batchCount(t, f))
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func batchCount(t *testing.T, f *riskdFixture) int {
	t.Helper()
	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	return n
}

// TestRiskdLoopForcesAPassWhenAPriceCrossesTheStalenessBudget is the HIGH finding,
// exercised through the real scheduler in ONE continuous loop.
//
// The sequence is the honest outage: the loop materializes a batch with a FRESH
// verdict, then ingestion stops completely — no cursor moves, no epoch lands, no
// sweep runs, no price row is written — and the clock advances past the staleness
// budget. The loop must force a pass on its own and publish the G4 flag.
//
// MUTANT THIS KILLS: remove the `freshnessDue` arm from runLoop. Nothing in the
// vector has moved, so the loop sits idle forever, the batch count never reaches 2,
// and this test times out.
func TestRiskdLoopForcesAPassWhenAPriceCrossesTheStalenessBudget(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)
	f.cfg.PollInterval = 30 * time.Millisecond

	stop := liveLoop(t, f, f.cfg)
	defer stop()

	waitForBatches(t, f, 1, "the loop's mandatory startup pass")
	first, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	prices, err := f.store.RiskBatchPriceInputs(f.ctx, first.ID)
	require.NoError(t, err)
	require.NotEmpty(t, prices)
	require.Equal(t, riskfeed.VerdictFresh, prices[0].Verdict)
	require.NotContains(t, aavePositionOf(t, f, first.ID).Flags, riskfeed.FlagStalePrice,
		"the baseline batch must NOT carry a stale flag, or there is no transition to observe")

	cursorsBefore := cursorSnapshot(t, f)
	rowsBefore := priceRowFingerprint(t, f)

	// THE OUTAGE, on the SAME running loop. Budget is 180s, so +200s crosses
	// fresh -> stale and nothing else.
	f.cfg.setSkew(200 * time.Second)

	waitForBatches(t, f, 2, "the freshness boundary forcing a pass")

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f),
		"NOT ONE cursor or epoch moved — the loop was woken by freshness alone")
	require.Equal(t, rowsBefore, priceRowFingerprint(t, f),
		"and no price row changed either")

	second, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Greater(t, second.ID, first.ID,
		"the loop MATERIALIZED rather than adopted: the crossing changed the phase, so it changed the identity")

	served, err := f.store.RiskBatchPriceInputs(f.ctx, second.ID)
	require.NoError(t, err)
	require.NotEmpty(t, served)
	require.Equal(t, riskfeed.VerdictStale, served[0].Verdict,
		"the served verdict moved from fresh to stale without anything else changing")

	pos := aavePositionOf(t, f, second.ID)
	require.Contains(t, pos.Flags, riskfeed.FlagStalePrice,
		"the G4 stale flag is published by the loop, unprompted")
	require.Equal(t, store.RiskPositionComputed, pos.Status,
		"G4 computes and flags; it does not refuse")
}

// TestRiskdLoopForcesARefusalWhenAPriceCrossesTheCeiling is the second boundary: the
// outage continues and the input passes the ceiling, so the standing flag must become
// a G1 REFUSAL — again on one running loop with nothing but the clock moving.
func TestRiskdLoopForcesARefusalWhenAPriceCrossesTheCeiling(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)
	f.cfg.PollInterval = 30 * time.Millisecond

	stop := liveLoop(t, f, f.cfg)
	defer stop()

	waitForBatches(t, f, 1, "startup pass")
	cursorsBefore := cursorSnapshot(t, f)

	// Ceiling is 2 x 180s = 360s. +400s crosses it.
	f.cfg.setSkew(400 * time.Second)
	waitForBatches(t, f, 2, "the ceiling forcing a pass")

	require.Equal(t, cursorsBefore, cursorSnapshot(t, f))

	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 1, batch.RefusedCount,
		"past the ceiling the input is REFUSED, not merely flagged")

	pos := aavePositionOf(t, f, batch.ID)
	require.Equal(t, store.RiskPositionRefused, pos.Status)
	require.Equal(t, riskfeed.GateMissingInput, pos.RefusalCode)
	require.Nil(t, pos.HFWad, "a refused position serves no health factor")

	served, err := f.store.RiskBatchPriceInputs(f.ctx, batch.ID)
	require.NoError(t, err)
	require.NotEmpty(t, served)
	require.Equal(t, riskfeed.VerdictOverCeiling, served[0].Verdict)
}

// TestRiskdLoopDoesNotSpinWithinAPhase is the counterweight, and it matters as much
// as the arming itself: a deadline computed wrongly (or re-armed at an instant
// already past) would make the loop recompute on every tick forever. Inside one
// phase, with nothing moving, the loop must stay quiet.
func TestRiskdLoopDoesNotSpinWithinAPhase(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)
	f.cfg.PollInterval = 20 * time.Millisecond

	stop := liveLoop(t, f, f.cfg)
	defer stop()

	waitForBatches(t, f, 1, "startup pass")

	// Let the loop run for ~30 poll intervals with nothing at all changing.
	time.Sleep(600 * time.Millisecond)

	require.Equal(t, 1, batchCount(t, f),
		"inside one freshness phase with a quiet vector the loop must NOT recompute; a spinning loop would rewrite the book every tick")
}

// TestRiskdLoopStillRecomputesOnVectorMovement: arming on freshness must not have
// displaced the ordinary trigger.
func TestRiskdLoopStillRecomputesOnVectorMovement(t *testing.T) {
	f := newRiskdFixture(t)
	f.seedFreshPrices(t)
	f.cfg.PollInterval = 20 * time.Millisecond

	stop := liveLoop(t, f, f.cfg)
	defer stop()

	waitForBatches(t, f, 1, "startup pass")

	// A consumed cursor advances — the ordinary path.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET last_block = last_block + 1 WHERE engine = $1`, "aave_v3_etherfi")
	require.NoError(t, err)

	waitForBatches(t, f, 2, "cursor movement")
}

// TestFreshnessDueIsMeasuredOnTheDatabaseClock pins the small predicate.
func TestFreshnessDueIsMeasuredOnTheDatabaseClock(t *testing.T) {
	at := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	require.False(t, freshnessDue(time.Time{}, at), "no armed deadline is never due")
	require.False(t, freshnessDue(at.Add(time.Second), at))
	require.True(t, freshnessDue(at, at), "exactly at the deadline IS due")
	require.True(t, freshnessDue(at.Add(-time.Second), at))
}
