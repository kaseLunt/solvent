package main

// The daemonConfig CLONE SURFACE, closed.
//
// `restartedConfig` copies daemonConfig field by field rather than with `*f.cfg`,
// for two reasons: the value atomic makes a wholesale copy a vet copylocks
// violation, and — the reason that predates vet noticing — the old copy duplicated
// a POINTER to one shared clock between two configs the tests treat as independent
// daemons, so advancing one advanced the other.
//
// Field-by-field copying trades that bug for a drift hazard: a new daemonConfig
// field would simply not be carried, silently, and a restart would quietly differ
// from the process it claims to be restarting. This test is the guard. It is the
// same shape as cmd/reconcile's TestFlagSurfaceClosed / TestEnvSurfaceClosed: the
// surface is enumerated here, and growing it without a decision fails.

import (
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// cloneSurface classifies every daemonConfig field.
//
//   - carried: a POLICY value a restarted process of the same build must reproduce,
//     because the materialization identity depends on it (a restart that derived a
//     different key would write a duplicate batch instead of adopting).
//   - deliberatelyReset: state that must NOT survive a restart.
var cloneSurface = map[string]string{
	"Registry":     "carried (rebuilt from the same feeds — same fingerprint, pinned by TestRegistryFingerprintMovesWithTokenDecimals)",
	"Aave":         "carried (engine binding, incl. GenesisBlock: the flag-custody bar must not move across a restart)",
	"DM":           "carried (engine binding)",
	"PollInterval": "carried (scheduler policy)",
	"Retention":    "carried (tests tune it; a restart must keep the tuned value)",
	"Budget":       "carried (freshness policy — in the identity)",
	"StepBps":      "carried (step policy — in the identity)",
	"Producer":     "carried (deployment role — in the identity)",

	"clockSkewNanos": "deliberatelyReset (test-only clock; a restarted process starts at the real clock, and the whole point of the value atomic is that there is no pointer to share)",
}

func TestDaemonConfigCloneSurfaceIsClosed(t *testing.T) {
	typ := reflect.TypeOf(daemonConfig{})
	seen := map[string]bool{}
	for i := 0; i < typ.NumField(); i++ {
		name := typ.Field(i).Name
		reason, classified := cloneSurface[name]
		require.Truef(t, classified,
			"daemonConfig field %q is UNCLASSIFIED — decide whether restartedConfig must carry it "+
				"(a silently uncarried field makes a 'restart' a different daemon) and add it to cloneSurface",
			name)
		require.NotEmpty(t, reason, "field %q carries no justification", name)
		seen[name] = true
	}
	for name := range cloneSurface {
		require.Truef(t, seen[name],
			"cloneSurface classifies %q, which daemonConfig no longer has — remove the stale entry", name)
	}
}

// TestRestartedConfigCarriesEveryPolicyField proves the classification above is not
// just prose: each carried field is really reproduced, using a value distinct from
// the fixture default so a dropped copy cannot pass.
func TestRestartedConfigCarriesEveryPolicyField(t *testing.T) {
	f := newRiskdFixture(t)

	f.cfg.PollInterval = 7 * time.Second
	f.cfg.Retention = 11
	f.cfg.Budget.Seconds = 99
	f.cfg.StepBps = 1234
	f.cfg.Producer = "riskd-clone-probe"
	f.cfg.Aave.GenesisBlock = 20_625_519
	f.cfg.DM.ChainID = 10

	got := f.restartedConfig(t)

	require.Equal(t, 7*time.Second, got.PollInterval)
	require.Equal(t, 11, got.Retention)
	require.EqualValues(t, 99, got.Budget.Seconds)
	require.EqualValues(t, 1234, got.StepBps)
	require.Equal(t, "riskd-clone-probe", got.Producer)
	require.Equal(t, f.cfg.Aave, got.Aave, "the whole binding, GenesisBlock included")
	require.Equal(t, f.cfg.DM, got.DM)
	require.NotNil(t, got.Registry)
	require.Equal(t, f.cfg.Registry.Fingerprint(), got.Registry.Fingerprint(),
		"a restart of the same build must derive the same registry fingerprint, or it cannot adopt")

	// The clock is the one field that must NOT survive.
	require.Zero(t, got.skew(), "a restarted process starts at the real clock")
}

// TestConfigWithSkewGivesAnIndependentClock is the regression for the bug the value
// atomic closed at the fixture level: two configs must not share one clock.
//
// MUTANT THIS KILLS: make restartedConfig copy the struct wholesale again (or share
// a pointer to one atomic). The original's skew then moves with the clone's, and the
// "ONLY THE CLOCK MOVES" identity tests silently stop isolating anything.
func TestConfigWithSkewGivesAnIndependentClock(t *testing.T) {
	f := newRiskdFixture(t)
	require.Zero(t, f.cfg.skew())

	advanced := f.configWithSkew(t, 400*time.Second)
	require.Equal(t, 400*time.Second, advanced.skew())
	require.Zero(t, f.cfg.skew(),
		"moving the clone's clock must NOT move the original's — they are different daemons")

	// And the reverse direction, so the independence is not one-way by accident.
	f.cfg.setSkew(5 * time.Second)
	require.Equal(t, 5*time.Second, f.cfg.skew())
	require.Equal(t, 400*time.Second, advanced.skew())
}
