package main

// Task 9 wave 12 — R9: the daemon-wrapper half of the walker discard seam
// (chain-truth consult F2; the round-3 [medium] recommendation transposed
// verbatim: "a multi-cadence test ... through the daemon worker wrapper,
// asserting that persistent [failure] involvement neither resets the backoff
// streak nor clears step_error").
//
// FILE-PLACEMENT NOTE (disclosed in the wave report): the wave-12 brief
// scoped cmd/indexer to "main.go, the stepWalkers seam only". stepWalkers,
// retryBackoff and roundConditions are unexported package-main composition,
// so the seam's regression can only live in this package; this is a NEW file
// (zero collision surface with the sibling wave, which owns cmd/reconcile,
// internal/store and the Makefile).

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/ingest"
)

func wave12Discard(round int) error {
	return &ingest.DiscardError{Stream: "op:debt-manager",
		Reason: fmt.Sprintf("tip header 149 changed mid-fetch on endpoint 0 (round %d)", round)}
}

// R2, daemon half — A PURE DISCARD LOOP IS A FAILURE STREAK. Pre-wave-12 the
// walker returned (false, nil) for a discarded window, stepWalkers counted it
// as success, and a deterministic discard loop (a stable split backend
// bracketing every fetch) reset the backoff every round and published
// NOTHING — the silent wedge. The law: every discard round consumes a
// backoff unit (the streak grows), the step_error condition names the
// discard, and only a genuine landing resets (mutation M3's target:
// counting a discard into bo.success()).
func TestStepWalkersDiscardRoundsGrowTheFailureStreak(t *testing.T) {
	h, clk := newTestHealth()
	w := &fakeIngestWorker{name: "op:debt-manager"}
	for round := 1; round <= 3; round++ {
		w.script(false, wave12Discard(round))
	}
	w.script(true, nil) // the eventual genuine landing (post-rotation, elsewhere)
	ws := &walkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	key := "op:debt-manager/" + conditionStepError

	wantDelays := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute}
	for round := 1; round <= 3; round++ {
		rc := roundConditions{}
		stepWalkers(context.Background(), []*walkerState{ws}, rc)
		publishRound(h, rc)

		require.Equal(t, round, ws.bo.failures,
			"round %d: the discard consumed a backoff unit — the streak GROWS, it is never reset", round)
		require.Equal(t, wantDelays[round-1], ws.retryIn,
			"round %d: exponential outage pacing is preserved through pure discards", round)
		rep := h.report()
		require.Contains(t, rep.Recoverable, key,
			"round %d: the discard is VISIBLE — no more silent wedge", round)
		require.Contains(t, rep.Recoverable[key], "DISCARDED (non-landing)",
			"round %d: the condition names the outcome distinctly where the operator reads", round)
		require.Contains(t, rep.Recoverable[key], fmt.Sprintf("%d consecutive round(s)", round))
		require.False(t, rep.Ready, "round %d: a discard-wedged stream fails readiness", round)

		clk.advance(retryBackoffCap * 2) // let the backoff elapse for the next round
	}

	// The genuine landing — and ONLY it — resets the streak and clears the
	// condition.
	rc := roundConditions{}
	require.True(t, stepWalkers(context.Background(), []*walkerState{ws}, rc))
	publishRound(h, rc)
	h.heartbeat()
	require.Zero(t, ws.bo.failures, "a genuine landing resets the streak")
	require.NotContains(t, h.report().Recoverable, key, "recovery is visible on the surface")
}

// R9 — MIXED POSTURE, MULTI-ROUND: endpoint 0 discards, endpoint 1 errors,
// persistently (at the walker that is a rotation between a splitting backend
// and an erroring peer; at this wrapper it arrives as alternating
// discard/error postures). The law: while NOTHING lands, the backoff streak
// grows MONOTONICALLY toward the cap regardless of which posture each round
// took, and step_error never flickers off — the reason text flips between
// the two namings, the KEY never disappears (round-3's exact finding: the
// alternation used to reset the backoff and clear the condition on every
// discard round).
func TestStepWalkersMixedDiscardErrorPostureNeverResetsPacingOrVisibility(t *testing.T) {
	h, clk := newTestHealth()
	w := &fakeIngestWorker{name: "op:aave-pool"}
	for round := 1; round <= 6; round++ {
		if round%2 == 1 {
			w.script(false, wave12Discard(round)) // endpoint 0's posture: discard
		} else {
			w.script(false, errors.New("logs [100,149]: connect refused (endpoint 1)")) // endpoint 1's posture: error
		}
	}
	ws := &walkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	key := "op:aave-pool/" + conditionStepError

	// base·2^(n-1) capped at 10m, jitter neutral at rand=0.5: the pacing the
	// discard loop used to destroy, now monotone to the cap.
	wantDelays := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute,
		4 * time.Minute, 8 * time.Minute, 10 * time.Minute}

	for round := 1; round <= 6; round++ {
		if round > 1 {
			clk.advance(retryBackoffCap * 2) // let the previous round's backoff elapse
		}
		rc := roundConditions{}
		require.False(t, stepWalkers(context.Background(), []*walkerState{ws}, rc),
			"round %d: nothing lands", round)
		publishRound(h, rc)

		require.Equal(t, round, ws.bo.failures,
			"round %d: the streak is MONOTONE across alternating postures — no posture resets it", round)
		require.Equal(t, wantDelays[round-1], ws.retryIn, "round %d: pacing climbs toward the cap", round)
		rep := h.report()
		require.Contains(t, rep.Recoverable, key,
			"round %d: step_error NEVER flickers off while nothing lands", round)
		if round%2 == 1 {
			require.Contains(t, rep.Recoverable[key], "DISCARDED (non-landing)")
		} else {
			require.Contains(t, rep.Recoverable[key], "ingest Step failed")
		}
		require.False(t, rep.Ready)
	}

	// And through the BACKOFF WINDOW itself (no Step attempted — the clock
	// has NOT elapsed round 6's 10-minute delay) the condition persists:
	// precisely when the signal matters.
	rc := roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	publishRound(h, rc)
	require.Equal(t, 6, ws.bo.failures, "no Step was attempted inside the backoff window")
	require.Contains(t, h.report().Recoverable, key)
}
