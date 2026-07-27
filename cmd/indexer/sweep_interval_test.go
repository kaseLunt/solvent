package main

// Round-14 F4 / round-16 M4 / round-19 H1, daemon side. The cadence
// contract has two halves since round-19 H1:
//
//   - requireStartupSweepCadence (pre-loop) is MANDATORY AND FATAL: restart
//     does not roll current_generation, so a PREVIOUS instance's stamp
//     survives restart looking daemon-verified — the only way the readable
//     cadence provably belongs to the RUNNING instance is that no instance
//     runs without stamping it. Error is the ONLY fatal mode: a no-row
//     match is a healthy start (no row = nothing readable to mis-trust;
//     already-stamped-with-our-values = the invariant already holds).
//   - persistSweepInterval (per-round) TOLERATES failure — startup bound
//     the instance, so a failed retry can only leave the post-bump window
//     UNREADABLE (00010 mask), where reconcile fails CLOSED — but is never
//     SILENT: it joins the round's health composition under
//     conditionCadenceUnpersisted (its own key — stepSnapshotter owns
//     step_error for the same worker), asserted below.
//
// The wiring (startup fatal inside run, per-round beside the snapshot
// pass) is pinned structurally by TestStartupCadenceFatalWiredIntoRun; the
// store-side semantics (UPDATE-only, generation stamping, IS DISTINCT FROM
// idempotence, survival across open/complete, instance binding) are proven
// in internal/store (TestMigrateUpgradesV8AddingConfiguredIntervalNull-
// Everywhere, the 00010 generation-binding tests, and
// TestCadenceBindsToRunningInstanceNotGeneration).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type fakeSweepIntervalWriter struct {
	engines   []string
	intervals []time.Duration
	err       error
	// wrote forces the RowsAffected outcome when non-nil (the (false, nil)
	// no-row-match case of round-19 H1); nil derives it from err.
	wrote *bool
}

func (f *fakeSweepIntervalWriter) RecordSweepConfiguredInterval(_ context.Context, engine string, interval time.Duration) (bool, error) {
	f.engines = append(f.engines, engine)
	f.intervals = append(f.intervals, interval)
	if f.wrote != nil {
		return *f.wrote, f.err
	}
	return f.err == nil, f.err
}

func TestPersistSweepIntervalWritesConfiguredCadence(t *testing.T) {
	w := &fakeSweepIntervalWriter{}
	rc := roundConditions{}
	persistSweepInterval(context.Background(), w, "debt_manager", 2*time.Hour, rc)
	require.Equal(t, []string{"debt_manager"}, w.engines)
	require.Equal(t, []time.Duration{2 * time.Hour}, w.intervals,
		"the persisted cadence must be the CONFIGURED interval, verbatim — this is the durable fact reconcile evaluates 2×(interval+lastPass) from")
	require.False(t, rc.has(snapshotName, conditionCadenceUnpersisted),
		"a landed write publishes NO condition — the surfacing is failure-only, and round replacement is what clears a prior failure")
}

func TestPersistSweepIntervalToleratesWriteFailure(t *testing.T) {
	w := &fakeSweepIntervalWriter{err: errors.New("transient")}
	rc := roundConditions{}
	require.NotPanics(t, func() {
		persistSweepInterval(context.Background(), w, "debt_manager", time.Hour, rc)
	}, "a failed cadence write must never gate sweeps — reconcile fails closed on the missing value (round-16 M4 taint), and the next round retries")
	require.Len(t, w.engines, 1)

	// Round-16 M4: the failure is TOLERATED but never SILENT — it must land
	// in the round's health composition under its own condition key, so a
	// persistently-failing cadence write is visible on the health surface
	// for exactly as many rounds as it keeps failing.
	require.True(t, rc.has(snapshotName, conditionCadenceUnpersisted),
		"a failed cadence write must surface into the round's health composition (round-16 M4: reconcile taints while the cadence is unstamped, and an operator must be able to see why)")
	require.Contains(t, rc[snapshotName][conditionCadenceUnpersisted], "transient",
		"the condition must carry the underlying error")

}

// TestStartupCadenceStampIsMandatoryFatal is the round-19 H1 BINDING
// regression, Codex's scenario at the mechanism level: a daemon whose
// startup cadence write FAILS must refuse to run — under mechanism (b) the
// scenario's "reconcile receives 2h as verified while a 30m daemon runs"
// is unreachable because the 30m daemon never runs. (The DB half — the 2h
// stamp surviving restart and dying only to a successful overwrite, and
// the rollover window failing closed through the 00010 mask — is
// TestCadenceBindsToRunningInstanceNotGeneration in internal/store.)
func TestStartupCadenceStampIsMandatoryFatal(t *testing.T) {
	// The failing new instance: configured 30m, write refused.
	w := &fakeSweepIntervalWriter{err: errors.New("connection refused")}
	err := requireStartupSweepCadence(context.Background(), w, "debt_manager", 30*time.Minute)
	require.Error(t, err,
		"a daemon that cannot stamp its own cadence MUST NOT run (round-19 H1): tolerating this write failure is what let a prior instance's 2h stamp stay readable-as-verified under a 30m daemon")
	require.Len(t, w.engines, 1, "exactly one startup write attempt")
	require.Equal(t, []time.Duration{30 * time.Minute}, w.intervals,
		"the stamp attempted must be THIS instance's configured interval, verbatim")
	require.ErrorContains(t, err, "refusing to start")
	require.ErrorContains(t, err, "connection refused", "the refusal must carry the underlying write error")
	require.ErrorContains(t, err, "round-19 H1")

	// Success: the write landed — the readable cadence is now provably this
	// instance's. The daemon may run.
	ok := &fakeSweepIntervalWriter{}
	require.NoError(t, requireStartupSweepCadence(context.Background(), ok, "debt_manager", 30*time.Minute))

	// ERROR IS THE ONLY FATAL MODE: (false, nil) — zero rows matched — is a
	// healthy start. Either no sweep row exists yet (OpenSweepGeneration
	// owns row creation; nothing readable exists to mis-trust, and reconcile
	// taints on absence), or the row already carries exactly this instance's
	// values (IS DISTINCT FROM matched nothing). Both satisfy the invariant.
	noRow := &fakeSweepIntervalWriter{wrote: boolPtr(false)}
	require.NoError(t, requireStartupSweepCadence(context.Background(), noRow, "debt_manager", 30*time.Minute),
		"a no-row match is not a failure: fatality exists to bind the READABLE value to this instance, and both no-op cases already satisfy that")
}

func boolPtr(b bool) *bool { return &b }
