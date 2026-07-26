package main

// Task 9 wave 14 — the daemon half of the bounded retention lease (Codex
// round-12 [high]: "...proving endpoint 1 is reached within a finite bound
// AND DAEMON SIBLINGS REMAIN SCHEDULED"). The walker half — the finite
// escape bound itself — lives in internal/ingest/walker_latency_test.go;
// this file asserts the SCHEDULING composition around it.
//
// FILE-PLACEMENT NOTE (disclosed in the wave-14 report): the brief allows a
// NEW cmd/indexer test file for exactly this assertion. stepWalkers,
// stepsPerRound, walkerState and retryBackoff are unexported package-main
// composition, so the assertion can only live here; it EXTENDS the R9
// harness (fakeIngestWorker, newTestHealth, publishRound — health_test.go /
// walker_discard_seam_test.go) rather than duplicating it, and it is a new
// file: zero collision surface with the parallel wave (which owns
// cmd/reconcile/** and must not touch cmd/indexer/**).
//
// WHY stepWalkers ITSELF DOES NOT CHANGE. Codex's schedule ("five Steps can
// occupy roughly 15 minutes before stepWalkers yields") is a WALL-TIME
// monopoly, and stepWalkers is deliberately time-blind: its per-round yield
// is a STEP bound (stepsPerRound), so the wall cost of one walker's round
// share is stepsPerRound x that walker's per-Step wall time — and the
// per-Step wall time is exactly what the walker-side lease bounds. The fix
// composes: the daemon grants a bounded number of Steps, the lease bounds
// how many of those Steps can stay pathological before the fast peer is
// probed. The two assertions below pin each half of that composition.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/ingest"
)

// THE SCHEDULING ASSERTION: a walker that lands every Step — which is
// precisely how the slow-successful posture arrives at this layer: the
// walker ADVANCES, it never errs — is bounded at stepsPerRound Steps per
// round, and its sibling is stepped IN THE SAME round. A slow walker can
// delay its siblings (the loop is serialized by design); it can never
// STARVE them, and its per-round grant never grows however much it lands.
func TestStepWalkersSlowLandingWalkerCannotStarveSiblings(t *testing.T) {
	h, clk := newTestHealth()
	slow := &fakeIngestWorker{name: "op:slow-landing"}
	for i := 0; i < stepsPerRound*3; i++ {
		slow.script(true, nil) // lands every Step, forever — the round-12 posture
	}
	sibling := &fakeIngestWorker{name: "eth:sibling"}
	sibling.script(true, nil)
	states := []*walkerState{
		{w: slow, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}},
		{w: sibling, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}},
	}

	rc := roundConditions{}
	require.True(t, stepWalkers(context.Background(), states, rc))
	publishRound(h, rc)

	require.Equal(t, stepsPerRound, slow.calls,
		"the yield bound: one round grants a walker stepsPerRound Steps and NO MORE, however much it advances")
	require.Equal(t, 2, sibling.calls,
		"the sibling was stepped in the SAME round — a landing-heavy walker delays it, but can never starve it")
	require.Zero(t, states[0].bo.failures, "landings are not failures: no backoff was burned")
	require.Zero(t, states[1].bo.failures)
	rep := h.report()
	require.NotContains(t, rep.Recoverable, "op:slow-landing/"+conditionStepError,
		"an all-landing round raises no step_error for either walker")
	require.NotContains(t, rep.Recoverable, "eth:sibling/"+conditionStepError)
}

// THE CROSS-LAYER BOUND, asserted where both constants are visible: the
// walker's retention lease spends AND its probe fires within a single
// stepWalkers round. Composed with the yield bound above, a slow-successful
// endpoint's monopoly of the serialized loop ends inside the very round the
// pathology starts in — bounded by the walker's OWN lease
// (MaxConsecutiveSlowLandings over-budget landings plus one probe Step),
// not by daemon patience or operator intervention. Pre-wave-14, the same
// round shape was five just-below-timeout Steps (~15 minutes) EVERY round,
// forever, with the fast peer never queried.
//
// This inequality is the "finite, stated bound" property in cross-layer
// form: if the lease ever drifts past the daemon's per-round step grant,
// the escape stops completing within the round that pays for it, and this
// pin is the place that refuses the drift.
func TestWalkerRetentionLeaseSpendsWithinOneDaemonRound(t *testing.T) {
	require.LessOrEqual(t, ingest.MaxConsecutiveSlowLandings+1, stepsPerRound,
		"lease length + probe must fit inside one stepWalkers round: the slow endpoint's monopoly ends in the round it starts in")
}
