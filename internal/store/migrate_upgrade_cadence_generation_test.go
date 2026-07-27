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

// TestCadenceBindsToRunningInstanceNotGeneration is the round-19 H1 BINDING
// regression at the store layer — Codex's exact scenario (2h prior stamp,
// 30m new daemon), DB-backed. Generation binding is NOT instance binding:
// restart does not roll current_generation, so a PREVIOUS instance's stamp
// (generation == current) survives a restart looking daemon-verified.
// Mechanism (b) — requireStartupSweepCadence in cmd/indexer, mandatory and
// fatal — closes it at the process level; what THIS test pins is the DB
// half of that argument, step by step:
//
//	(1) the hazard is real — the prior instance's 2h stamp really does stay
//	    readable across a "restart" (nothing here rolls the generation);
//	(2) the only admission path for a new instance — a successful startup
//	    overwrite — RETIRES the stale value in the same single UPDATE, so a
//	    running 30m daemon and a readable 2h cadence cannot coexist;
//	(3) mid-run generation rollover with a FAILED re-stamp fails closed:
//	    migration 00010's mask makes the cadence unreadable, and reconcile
//	    taints on the NULL (TestUnverifiedCadenceTaintsAcceptance,
//	    cmd/reconcile) rather than reading either instance's stale number —
//	    which is exactly why per-round write failures may STAY tolerated
//	    under mechanism (b).
//
// The failing-write half of the scenario (startup write fails → the daemon
// NEVER RUNS, so no sweep evidence is ever produced under a rule the stamp
// does not describe) is process behavior, proven in cmd/indexer:
// TestStartupCadenceStampIsMandatoryFatal (the fatality) and
// TestStartupCadenceFatalWiredIntoRun (the wiring).
func TestCadenceBindsToRunningInstanceNotGeneration(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_cadence_instance_binding"
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

	// The PREVIOUS instance: configured 2h, stamped onto the open generation.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.EqualValues(t, 1, gen)
	wrote, err := s.RecordSweepConfiguredInterval(ctx, engine, 2*time.Hour)
	require.NoError(t, err)
	require.True(t, wrote)

	// (1) THE HAZARD: the process "restarts" — which changes NOTHING in this
	// table. The 2h stamp still reads as daemon-verified: generation binding
	// alone cannot tell a dead instance's stamp from a running one's.
	row, err := SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 7200, *row.ConfiguredIntervalSeconds,
		"the prior instance's stamp SURVIVES restart, readable-as-verified — this is why the new instance must overwrite at startup or refuse to run (round-19 H1)")

	// (2) THE ONLY ADMISSION PATH: the new 30m instance's startup overwrite
	// succeeds. (Had it failed, requireStartupSweepCadence would have
	// refused to run the daemon — no rounds, no snapshots, no sweep evidence
	// produced under a rule the stamp does not describe.) The same single
	// UPDATE that admits the instance retires the stale value: a running 30m
	// daemon and a readable 2h cadence cannot coexist.
	wrote, err = s.RecordSweepConfiguredInterval(ctx, engine, 30*time.Minute)
	require.NoError(t, err)
	require.True(t, wrote)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.NotNil(t, row.ConfiguredIntervalSeconds)
	require.EqualValues(t, 1800, *row.ConfiguredIntervalSeconds,
		"after the mandatory startup stamp, reconcile can only read THIS instance's cadence — 2×(2h+lastPass) is unreachable while a 30m daemon runs")

	// (3) MID-RUN ROLLOVER WITH A FAILED RE-STAMP FAILS CLOSED: the bump
	// retires the 30m stamp; the per-round re-stamp "fails" here by never
	// being attempted; the 00010 mask reports ABSENT, and reconcile taints
	// on the NULL (round-16 M4) instead of trusting either instance's stale
	// number.
	gen, err = s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.EqualValues(t, 2, gen)
	row, err = SweepGenerationRow(ctx, s.pool, engine)
	require.NoError(t, err)
	require.Nil(t, row.ConfiguredIntervalSeconds,
		"post-rollover, an un-re-stamped cadence is UNREADABLE (00010 mask) — the failed-write window taints, it never widens")
}
