package main

// Round-14 F4, daemon side: persistSweepInterval writes the CONFIGURED sweep
// cadence through the narrow store surface and TOLERATES failure — the value
// is evidence for reconcile, whose absence-fallback is fail-closed (the
// wave-15 1h-default bound), so an unlanded write may only ever make
// reconcile stricter. The wiring calls it once at startup and once per round
// beside the snapshot pass; the store-side semantics (UPDATE-only,
// IS DISTINCT FROM idempotence, survival across open/complete) are proven in
// internal/store's TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere.

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
	persistSweepInterval(context.Background(), w, "debt_manager", 2*time.Hour)
	require.Equal(t, []string{"debt_manager"}, w.engines)
	require.Equal(t, []time.Duration{2 * time.Hour}, w.intervals,
		"the persisted cadence must be the CONFIGURED interval, verbatim — this is the durable fact reconcile evaluates 2×(interval+lastPass) from")
}

func TestPersistSweepIntervalToleratesWriteFailure(t *testing.T) {
	w := &fakeSweepIntervalWriter{err: errors.New("transient")}
	require.NotPanics(t, func() {
		persistSweepInterval(context.Background(), w, "debt_manager", time.Hour)
	}, "a failed cadence write must never gate sweeps — reconcile's absence-fallback is fail-closed, and the next round retries")
	require.Len(t, w.engines, 1)
}
