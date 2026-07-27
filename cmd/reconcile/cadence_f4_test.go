// Round-14 F4 BINDING regressions, corrected by round-16 M4: the freshness
// bound is evaluated from the cadence the daemon stamped onto the CURRENT
// sweep generation with the daemon's REAL rule 2×(interval+lastPass), the
// env variable is a cross-check that can only taint, and the ABSENCE of a
// generation-bound cadence TAINTS — the wave-15 fallback bound died in
// round 16 (it could be WIDER than the daemon's real rule: 30m daemon, 10m
// pass → real 80m vs fallback 2h; a fallback that can widen is a bypass).
//
//   - the fail-forever posture stays DEAD: a persisted 2h interval with
//     zero failures is a PASS (wave 15 exited 1 on it unconditionally);
//   - env-vs-persisted mismatch → taint, in BOTH directions, and the bound
//     always comes from the persisted value (mutation W16M6's shape —
//     persisted-read replaced by env-read — must die on the bound
//     assertions here);
//   - NO generation-bound cadence (NULL, pre-migration row, or a prior
//     generation's stamp — unreadable by construction, see
//     store.SweepGenerationRow) → unconditional taint + ADVISORY-labeled
//     bound that can never back a pass. NOT fail-forever: the daemon
//     stamps the current generation every round.
package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func sweepState(configuredSecs, lastPassSecs *int64) store.SweepGenerationState {
	return store.SweepGenerationState{
		Found:                     true,
		ConfiguredIntervalSeconds: configuredSecs,
		LastPassSeconds:           lastPassSecs,
	}
}

func i64(v int64) *int64 { return &v }

// TestPersistedDaemonCadenceGovernsFreshnessBound is the core F4 regression:
// a supported 2h cadence, durably written by the daemon, produces the
// daemon's own healthy bound and a CLEAN taint set — the round-14
// fail-forever posture is dead. The whole verdict chain is exercised: bound
// → evaluateFreshness (an account inside the daemon's real bound is fresh)
// → computeResult(0, 0, no taints) == pass.
func TestPersistedDaemonCadenceGovernsFreshnessBound(t *testing.T) {
	clearPgxEnv(t)
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")

	// Persisted 2h interval + 1h achieved pass: the daemon's rule permits
	// 2×(2h+1h) = 6h.
	sweep := sweepState(i64(7200), i64(3600))
	bound, inputs, taints := sweepCadenceEvaluation(sweep)
	require.Equal(t, 6*time.Hour, bound,
		"the daemon's REAL rule is additive — 2×(interval+lastPass); wave 15's max(2×interval, 2×lastPass) could not reproduce this, which is exactly the fail-forever mechanism")
	require.Empty(t, taints, "a persisted supported cadence with no env contradiction is CLEAN")
	require.Contains(t, inputs["snapshot_interval_source"], "configured_interval_seconds",
		"provenance must name the durable column, not the environment")
	require.Contains(t, inputs["formula"], "2*(interval+last_pass)")
	require.NotContains(t, inputs, "fallback")

	// A sweep 5h old is FRESH under the daemon's bound (it would have been
	// "stale" under wave 15's 4h = 2×2h computation, and the env route would
	// have tainted the run outright).
	now := time.Now()
	fiveHoursAgo := now.Add(-5 * time.Hour)
	res := evaluateFreshness([]store.AccountFreshness{
		{Account: []byte{0x01}, HasRow: true, Status: "success", LastSuccessBlock: 42, LastSuccessAt: &fiveHoursAgo},
	}, map[string]bool{"01": true}, bound, inputs, now)
	require.Equal(t, 0, res.GateFailures)
	require.Equal(t, "fresh", res.Sampled[0].Verdict)

	// Zero gated failures + zero taints == pass. THE fail-forever death.
	result, code := computeResult(0, 0, taints)
	require.Equal(t, "pass", result,
		"a legitimately-configured 2h deployment with zero failures must be able to PASS (round-14 F4)")
	require.Equal(t, exitPass, code)

	// A matching env restatement stays clean.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "2h")
	bound, _, taints = sweepCadenceEvaluation(sweep)
	require.Equal(t, 6*time.Hour, bound)
	require.Empty(t, taints, "an env value that AGREES with the persisted cadence contradicts nothing")
}

// TestEnvVsPersistedMismatchTaintsAndNeverWidens: the env variable is a
// cross-check, demoted from a bound input. Any disagreement taints — wider
// (the loosening attack) AND tighter (still a lie about the deployment) —
// and the bound is computed from the persisted value in every case. These
// bound assertions are what kill the persisted-read→env-read mutant: with
// env=3h the mutant computes 8h, with env unset it computes 4h; both differ
// from the persisted-rule 6h asserted here and in the test above.
func TestEnvVsPersistedMismatchTaintsAndNeverWidens(t *testing.T) {
	clearPgxEnv(t)
	sweep := sweepState(i64(7200), i64(3600)) // persisted 2h + 1h pass → 6h

	// Wider claim: bound must NOT widen, and the run taints.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "3h")
	bound, _, taints := sweepCadenceEvaluation(sweep)
	require.Equal(t, 6*time.Hour, bound, "the bound comes from the PERSISTED value — an env claim never widens it (round-14 F4)")
	require.NotEmpty(t, taints)
	require.Contains(t, taints[0], "contradicts the daemon-persisted cadence")
	result, code := computeResult(0, 0, taints)
	require.NotEqual(t, "pass", result)
	require.NotEqual(t, exitPass, code)

	// Tighter claim: still a mismatch, still a taint (some environment is
	// lying about the deployment), and the bound is still the persisted rule.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "1h")
	bound, _, taints = sweepCadenceEvaluation(sweep)
	require.Equal(t, 6*time.Hour, bound)
	require.NotEmpty(t, taints, "a tighter env claim is still a contradiction of durable daemon state")

	// Unparseable env with a healthy persisted row: syntax belt still holds.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "bogus")
	_, _, taints = sweepCadenceEvaluation(sweep)
	require.NotEmpty(t, taints)
	require.Contains(t, taints[0], "not a positive duration")
}

// TestUnverifiedCadenceTaintsAcceptance is the round-16 M4 BINDING
// regression: no cadence stamped on the CURRENT sweep generation (NULL, a
// pre-migration row, or a prior generation's value — which
// store.SweepGenerationRow makes unreadable by construction, proven
// DB-backed in internal/store's TestSweepCadenceUnreadableFromPriorGeneration)
// → unconditional taint, ADVISORY-labeled bound, and the wave-15 fallback
// bound is structurally gone. The reviewer's exact scenario is the first
// leg: prior-gen 2h persisted (arrives here as nil — unreadable), current
// generation absent, env unset → taint, and the bound is NEVER
// 2×(2h+lastPass).
func TestUnverifiedCadenceTaintsAcceptance(t *testing.T) {
	clearPgxEnv(t)

	// THE REVIEWER'S SCENARIO. A prior daemon persisted 2h; the current
	// generation carries no stamp; env unset. The 2h value cannot even REACH
	// this evaluation (the store read masks it to NULL by construction), so
	// the state arriving here is nil — and nil must taint, with a bound that
	// is the ADVISORY default shape, never the stale 2×(2h+1h)=6h.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	bound, inputs, taints := sweepCadenceEvaluation(sweepState(nil, i64(3600)))
	require.NotEmpty(t, taints, "an absent generation-bound cadence must TAINT — an acceptance verdict never rests on an unverified cadence (round-16 M4)")
	require.Contains(t, taints[0], "no daemon-verified sweep cadence",
		"the taint must name the mechanism")
	require.Contains(t, taints[0], "NOT fail-forever",
		"the taint must state the acceptance-taint distinction: the daemon stamps every round, one round clears it (the round-14 distinction, preserved)")
	require.Equal(t, 2*(time.Hour+time.Hour), bound, "advisory bound = daemon rule shape with the canonical default: 2×(1h default + 1h lastPass)")
	require.NotEqual(t, 6*time.Hour, bound, "NEVER 2×(2h+lastPass) — the prior generation's 2h is unreadable by construction")
	require.Contains(t, inputs["label"], "advisory", "the bound must be LABELED advisory — it cannot back a pass")
	require.Contains(t, inputs["snapshot_interval_source"], "ADVISORY")
	require.Contains(t, inputs, "advisory")
	result, code := computeResult(0, 0, taints)
	require.NotEqual(t, "pass", result, "NULL cadence in an acceptance run is structurally non-pass (round-16 M4)")
	require.NotEqual(t, exitPass, code)

	// The wave-15 fallback is DEAD in both arms it had: env never feeds the
	// advisory bound (a 24h env claim moves nothing), and the max() shape is
	// gone (a 3h lastPass yields the additive 2×(1h+3h)=8h, not max-form 6h).
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "24h")
	bound, _, taints = sweepCadenceEvaluation(sweepState(nil, i64(3600)))
	require.Equal(t, 4*time.Hour, bound, "the env claim must not move the advisory bound — env feeds NO bound on any path (round-16 M4)")
	require.NotEmpty(t, taints)
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	bound, _, _ = sweepCadenceEvaluation(sweepState(nil, i64(3*3600)))
	require.Equal(t, 8*time.Hour, bound, "additive advisory shape 2×(default+lastPass), not wave-15's max(2×default, 2×lastPass)")

	// No row at all (engine never opened a sweep): same law, fail-closed.
	_, inputs, taints = sweepCadenceEvaluation(store.SweepGenerationState{})
	require.NotEmpty(t, taints)
	require.Contains(t, inputs["label"], "advisory")

	// A CORRUPT persisted value (nonpositive) carries its OWN taint on top
	// of the unverified-cadence taint.
	_, _, taints = sweepCadenceEvaluation(sweepState(i64(0), i64(3600)))
	require.GreaterOrEqual(t, len(taints), 2)
	require.Contains(t, taints[0], "not a positive cadence")
	require.Contains(t, taints[1], "no daemon-verified sweep cadence")

	// Syntax belt still holds on this arm.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "bogus")
	_, _, taints = sweepCadenceEvaluation(sweepState(nil, i64(3600)))
	joined := ""
	for _, m := range taints {
		joined += m + "\n"
	}
	require.Contains(t, joined, "not a positive duration")
}
