// Round-14 F4 BINDING regressions: the freshness bound is evaluated from the
// DAEMON'S PERSISTED cadence with the daemon's REAL rule 2×(interval+lastPass),
// the env variable is a cross-check that can only taint, and rows predating
// migration 00009 fall back to the wave-15 law — fail-closed, never
// fail-forever, never silently widened.
//
//   - the fail-forever posture DIES: a persisted 2h interval with zero
//     failures is a PASS (wave 15 exited 1 on it unconditionally);
//   - env-vs-persisted mismatch → taint, in BOTH directions, and the bound
//     always comes from the persisted value (mutation W16M5 — persisted-read
//     replaced by env-read — must die on the bound assertions here);
//   - pre-migration rows (no persisted interval) → wave-15 fallback bound +
//     taint whenever the env claims wider than the 1h default.
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

// TestPreMigrationRowsFallBackFailClosed: no persisted interval (the row
// predates migration 00009, or no daemon has written it yet) → the wave-15
// law verbatim — max(2×env-or-default, 2×lastPass) with the 1h acceptance
// cap — plus a documented fallback marker in bound_inputs. Fail-closed: a 2h
// deployment stays tainted until its daemon persists the cadence (one
// restart), never forever, and never silently widened.
func TestPreMigrationRowsFallBackFailClosed(t *testing.T) {
	clearPgxEnv(t)

	// Env unset: the canonical default, wave-15 shape.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	bound, inputs, taints := sweepCadenceEvaluation(sweepState(nil, i64(3600)))
	require.Equal(t, 2*time.Hour, bound, "wave-15 shape: max(2×1h, 2×1h) = 2h")
	require.Empty(t, taints)
	require.Contains(t, inputs, "fallback")
	require.Contains(t, inputs["snapshot_interval_source"], "default")

	// The lastPass channel still widens (the daemon-written, durable one).
	bound, _, taints = sweepCadenceEvaluation(sweepState(nil, i64(3*3600)))
	require.Equal(t, 6*time.Hour, bound, "wave-15 shape: max(2×1h, 2×3h) = 6h — the durable channel widens, taint-free")
	require.Empty(t, taints)

	// Env claims wider with nothing durable to check it against: recorded
	// honestly (no silent clamp) AND tainted — the wave-15 law.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "2h")
	bound, _, taints = sweepCadenceEvaluation(sweepState(nil, i64(3600)))
	require.Equal(t, 4*time.Hour, bound, "no silent clamp: the recorded bound tells the whole story")
	require.NotEmpty(t, taints, "a loose env claim with no persisted cadence to verify it is the wave-15 taint, unchanged")
	require.Contains(t, taints[0], "last_pass_seconds")
	result, _ := computeResult(0, 0, taints)
	require.NotEqual(t, "pass", result)

	// A CORRUPT persisted value (nonpositive) is not treated as usable state:
	// fallback bound + its own taint.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	_, _, taints = sweepCadenceEvaluation(sweepState(i64(0), i64(3600)))
	require.NotEmpty(t, taints)
	require.Contains(t, taints[0], "not a positive cadence")
}
