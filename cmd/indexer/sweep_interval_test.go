package main

// Round-14 F4 / round-16 M4, daemon side: persistSweepInterval writes the
// CONFIGURED sweep cadence through the narrow store surface and TOLERATES
// failure — the value is evidence for reconcile, which fails CLOSED on its
// absence (the round-16 M4 unverified-cadence taint), so an unlanded write
// may only ever make reconcile stricter. But since round-16 M4 the failure
// is NO LONGER SILENT: it joins the round's health composition under
// conditionCadenceUnpersisted (its own key — stepSnapshotter owns
// step_error for the same worker), asserted below. The wiring calls it once
// at startup (nil rc — no round composition exists yet) and once per round
// beside the snapshot pass; the store-side semantics (UPDATE-only,
// generation stamping, IS DISTINCT FROM idempotence, survival across
// open/complete) are proven in internal/store's upgrade tests
// (TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere and the
// 00010 generation-binding tests).

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
}

func (f *fakeSweepIntervalWriter) RecordSweepConfiguredInterval(_ context.Context, engine string, interval time.Duration) (bool, error) {
	f.engines = append(f.engines, engine)
	f.intervals = append(f.intervals, interval)
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

	// The startup call site has no round composition yet: nil rc must be
	// tolerated (log-only), never a panic — round 1 re-runs with a live rc.
	require.NotPanics(t, func() {
		persistSweepInterval(context.Background(), w, "debt_manager", time.Hour, nil)
	}, "the pre-loop startup call passes nil rc; surfacing begins with round 1's composition")
}
