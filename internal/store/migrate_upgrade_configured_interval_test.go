package store

// Live upgrade-path test for migration 00009 (the daemon's durable CONFIGURED
// sweep cadence — round-14 F4) from the pushed baseline, version 8.
//
// The risk profile is the inverse of 00008's: there is NO backfill to get
// wrong, and the honesty obligation is exactly that — no historical record of
// the configured interval exists (it lived in process environments), so the
// column must arrive NULL everywhere and STAY NULL until a running daemon
// writes it. A migration that "backfilled" the 1h default would manufacture
// the very unverifiable operator assertion the column exists to replace, and
// reconcile's fallback (the wave-15 1h-default bound, fail-closed) would
// silently stop being exercisable.
//
// The write path is asserted here too: RecordSweepConfiguredInterval is
// UPDATE-only (OpenSweepGeneration owns row creation), idempotent via IS
// DISTINCT FROM, refuses nonpositive cadences, and — like last_pass_seconds,
// 00008's load-bearing omission — the value survives every statement that
// opens or completes a generation.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v8_cfgint"
	const engine = "debt_manager"

	admin, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	_, err = admin.pool.Exec(ctx, "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	})
	scratch := scratchSchemaDSN(t, dsn, schema)

	// (a) The pushed v8 baseline, and proof it truly IS that baseline.
	require.NoError(t, migrateUpTo(ctx, scratch, 8))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'sweep_generations' AND column_name = 'configured_interval_seconds'`,
		schema).Scan(&n))
	require.Zero(t, n, "the v8 baseline must NOT carry configured_interval_seconds")

	// (b) A pre-existing v8 row (a closed generation with a recorded pass).
	opened := time.Now().Add(-2 * time.Hour).UTC()
	_, err = s.pool.Exec(ctx, `INSERT INTO sweep_generations
		(engine, current_generation, opened_at, completed_at, last_pass_seconds)
		VALUES ($1, 6, $2, $3, 2700)`,
		engine, opened, opened.Add(45*time.Minute))
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00009 must land on top of the v8 baseline")

	// (d) NOTHING IS INVENTED: the pre-existing row's interval is NULL, and
	// the reconcile read reports exactly that (the fail-closed fallback
	// state), while everything that DID survive is untouched.
	row, err := SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.True(t, row.Found)
	require.Nil(t, row.ConfiguredIntervalSeconds,
		"no daemon wrote a cadence to a pre-migration row; a backfilled default would be a fabricated operator assertion")
	require.NotNil(t, row.LastPassSeconds)
	require.EqualValues(t, 2700, *row.LastPassSeconds)

	// (e) The write path, end to end.
	// No row for this engine yet: UPDATE-only means no write, no error, no
	// invented row — OpenSweepGeneration owns creation.
	wrote, err := s.RecordSweepConfiguredInterval(ctx, "aave_v3_etherfi", 2*time.Hour)
	require.NoError(t, err)
	require.False(t, wrote, "no sweep_generations row exists for this engine; the recorder must not invent one")
	missing, err := SweepGenerationRow(ctx, s.pool, "aave_v3_etherfi")
	require.NoError(t, err)
	require.False(t, missing.Found)

	// Existing row: the write lands and the reconcile read sees it.
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 2*time.Hour)
	require.NoError(t, err)
	require.True(t, wrote)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 7200, *row.ConfiguredIntervalSeconds)

	// Idempotent: the same value is a no-op write (the daemon calls this
	// every round).
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 2*time.Hour)
	require.NoError(t, err)
	require.False(t, wrote, "IS DISTINCT FROM must make the per-round write a no-op once landed")

	// A reconfigured daemon updates it.
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 30*time.Minute)
	require.NoError(t, err)
	require.True(t, wrote)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds)

	// Nonpositive cadence: refused loudly (config.Load would never produce
	// one; a zero here is a caller bug, not a fact to persist).
	_, err = s.RecordSweepConfiguredInterval(ctx, engine, 0)
	require.Error(t, err)

	// (f) SURVIVAL: opening and completing generations — the statements that
	// clear completed_at and stamp durations — must leave the configured
	// cadence standing, exactly like last_pass_seconds (00008's law).
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds, "OpenSweepGeneration must not clear the configured cadence")
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds)

	_, stamped, err := s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)
	require.True(t, stamped)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds, "CompleteSweepGeneration must not clear the configured cadence")
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds)
}
