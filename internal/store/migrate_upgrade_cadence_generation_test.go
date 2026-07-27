package store

// Live upgrade-path test for migration 00010 (the cadence's GENERATION
// binding — round-16 M4) from the pushed baseline, version 9, plus the
// binding's own DB-backed regression: a cadence stamped under a prior
// generation is UNREADABLE BY CONSTRUCTION — the CASE mask in
// SweepGenerationRow's SQL never lets it leave the database, so no Go-side
// judgment can be reverted into trusting it.
//
// The honesty obligation mirrors 00009's: a 00009-era value has NO recorded
// writing generation, and inventing a stamp for it would manufacture the
// binding this migration exists to prove. So the new column arrives NULL
// everywhere, existing cadence values read as ABSENT (reconcile taints on
// that — round-16 M4, fail-closed), and the first post-upgrade daemon round
// stamps the current generation — never fail-forever.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV9AddingCadenceGenerationUnstamped(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v9_cadgen"
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

	// (a) The pushed v9 baseline, and proof it truly IS that baseline.
	require.NoError(t, migrateUpTo(ctx, scratch, 9))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'sweep_generations' AND column_name = 'configured_interval_generation'`,
		schema).Scan(&n))
	require.Zero(t, n, "the v9 baseline must NOT carry configured_interval_generation")

	// (b) A 00009-era row: a live deployment whose daemon already persisted
	// its cadence under the UNBOUND schema — the reviewer's "prior
	// instance" value.
	opened := time.Now().Add(-3 * time.Hour).UTC()
	_, err = s.pool.Exec(ctx, `INSERT INTO sweep_generations
		(engine, current_generation, opened_at, completed_at, last_pass_seconds, configured_interval_seconds)
		VALUES ($1, 4, $2, $3, 600, 7200)`,
		engine, opened, opened.Add(10*time.Minute))
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00010 must land on top of the v9 baseline")

	// (d) NOTHING IS INVENTED, AND THE UNSTAMPED VALUE IS UNREADABLE: the
	// 00009-era cadence survives as a column value (history is not
	// destroyed) but carries no generation stamp, so the reconcile read
	// reports ABSENT — the round-16 M4 taint state, not the stale 2h.
	var rawSecs int64
	var rawGen *int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT configured_interval_seconds, configured_interval_generation
		 FROM sweep_generations WHERE engine = $1`, engine).Scan(&rawSecs, &rawGen))
	require.EqualValues(t, 7200, rawSecs, "the migration must not rewrite the 00009-era value")
	require.Nil(t, rawGen, "and must not invent a stamp for it — no writing generation was ever recorded")
	row, err := SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.True(t, row.Found)
	require.Nil(t, row.ConfiguredIntervalSeconds,
		"an unstamped cadence is unreadable by construction — reconcile must taint, never evaluate 2×(2h+lastPass) from a value no running daemon vouches for (round-16 M4)")
	require.NotNil(t, row.LastPassSeconds)
	require.EqualValues(t, 600, *row.LastPassSeconds)

	// (e) The first post-upgrade daemon round stamps the CURRENT generation
	// in the same UPDATE as the seconds — readable again, fail-closed never
	// fail-forever. The stamp must equal the row's own current_generation.
	wrote, err := s.RecordSweepConfiguredInterval(ctx, engine, 2*time.Hour)
	require.NoError(t, err)
	require.True(t, wrote, "the generation half of the guard must fire even though the seconds are unchanged")
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT configured_interval_seconds, configured_interval_generation
		 FROM sweep_generations WHERE engine = $1`, engine).Scan(&rawSecs, &rawGen))
	require.EqualValues(t, 7200, rawSecs)
	require.NotNil(t, rawGen)
	require.EqualValues(t, 4, *rawGen, "the stamp is the row's OWN current_generation, read inside the UPDATE")
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 7200, *row.ConfiguredIntervalSeconds)

	// Idempotence now covers BOTH halves: same seconds + current stamp is a
	// no-op every round.
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 2*time.Hour)
	require.NoError(t, err)
	require.False(t, wrote)
}

// TestSweepCadenceUnreadableFromPriorGeneration is the round-16 M4 binding
// regression at the store layer, against a fully-migrated schema: every
// generation bump (OpenSweepGeneration here; RewindDerived performs the
// byte-identical bump in its own transaction) retires the stamp, the
// retired value never crosses the read boundary, and one daemon write
// restores readability. This is the test that must kill the
// prior-generation-read mutant (the CASE mask reverted to the bare column).
func TestSweepCadenceUnreadableFromPriorGeneration(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_cadgen_binding"
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
	require.NoError(t, Migrate(ctx, scratch))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	// Generation 1 opens; the daemon stamps its cadence onto it.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.EqualValues(t, 1, gen)
	wrote, err := s.RecordSweepConfiguredInterval(ctx, engine, 30*time.Minute)
	require.NoError(t, err)
	require.True(t, wrote)
	row, err := SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds)

	// The bump: generation 2 opens and the generation-1 stamp is retired.
	// The value survives in the column; the READ refuses it — unreadable by
	// construction, not filtered by judgment.
	gen, err = s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.EqualValues(t, 2, gen)
	var rawSecs, rawGen int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT configured_interval_seconds, configured_interval_generation
		 FROM sweep_generations WHERE engine = $1`, engine).Scan(&rawSecs, &rawGen))
	require.EqualValues(t, 1800, rawSecs, "history survives the bump")
	require.EqualValues(t, 1, rawGen, "the stamp still names the generation that wrote it")
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.Nil(t, row.ConfiguredIntervalSeconds,
		"a prior generation's cadence must be UNREADABLE (round-16 M4): reconcile's evaluation can only taint on what it cannot see")

	// One daemon round later: re-stamped onto generation 2, readable again.
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 30*time.Minute)
	require.NoError(t, err)
	require.True(t, wrote)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds)
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT configured_interval_generation FROM sweep_generations WHERE engine = $1`, engine).Scan(&rawGen))
	require.EqualValues(t, 2, rawGen)
}
