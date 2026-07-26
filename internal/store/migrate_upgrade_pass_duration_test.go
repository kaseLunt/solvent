package store

// Live upgrade-path test for migration 00008 (the durable achieved-pass duration)
// from the CURRENT PUSHED BASELINE, version 7.
//
// The risk in this migration is not the column — it is the BACKFILL's reach, and the
// honest admission of where it does not reach. sweep_generations holds ONE row per
// engine, and both OpenSweepGeneration and RewindDerived's bump NULL completed_at, so
// at upgrade time there are exactly two pre-existing shapes:
//
//	a CLOSED generation   both timestamps survive, so its duration is recoverable
//	                      exactly and the backfill must recover it;
//	an OPEN generation    completed_at is already NULL and the previous generation's
//	                      duration was overwritten before this migration ever ran.
//	                      Nothing can recover it. The column must stay NULL, the
//	                      reported duration must stay zero, and the bound must degrade
//	                      to the same naive formula the old code used — never worse
//	                      than the behaviour being replaced, and correct from the first
//	                      completion under the new code.
//
// A migration that invented a number for the second shape would look better in this
// test and would be lying about a pass nobody measured, so the second case asserts
// the NULL deliberately.
//
// The baseline is reconstructed with goose's UpTo against the SAME embedded migration
// set store.Migrate uses, inside a scratch schema pinned via the DSN's search_path.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV7GenerationBaselineRecoveringOnlyWhatSurvived(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()
	const schema = "solvent_migtest_v7_passdur"
	const closedEngine, openEngine = "debt_manager", "aave"

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

	// (a) The pushed v7 baseline, and proof it truly IS that baseline — the guard
	// against 00008's shapes creeping into an already-applied migration, which is the
	// process failure 00004 exists to remember.
	require.NoError(t, migrateUpTo(ctx, scratch, 7))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'sweep_generations' AND column_name = 'last_pass_seconds'`,
		schema).Scan(&n))
	require.Zero(t, n, "the v7 baseline must NOT carry last_pass_seconds")

	// (b) Pre-existing v7 data in both shapes.
	opened := time.Now().Add(-2 * time.Hour).UTC()
	_, err = s.pool.Exec(ctx, `INSERT INTO sweep_generations (engine, current_generation, opened_at, completed_at) VALUES
		($1, 6, $3, $4),
		($2, 3, $3, NULL)`,
		closedEngine, openEngine, opened, opened.Add(45*time.Minute))
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point, exactly as a restarted
	// indexer at the new code would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00008 must land on top of the v7 baseline")

	// (d) WHAT SURVIVED IS RECOVERED. The closed generation's 45-minute pass is
	// readable through both the bound's per-round path and the daemon's hydration
	// path, which is the point of the migration.
	d, found, err := s.SweepLastPassDuration(ctx, closedEngine)
	require.NoError(t, err)
	require.True(t, found)
	require.InDelta(t, (45 * time.Minute).Seconds(), d.Seconds(), 2,
		"a generation that was closed at upgrade time carries both its timestamps, so its duration is recoverable exactly")

	// (e) WHAT DID NOT SURVIVE IS NOT INVENTED. The open generation's predecessor was
	// already overwritten; the column stays NULL and the reported duration stays zero.
	var passSeconds *int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT last_pass_seconds FROM sweep_generations WHERE engine = $1`, openEngine).Scan(&passSeconds))
	require.Nil(t, passSeconds,
		"a generation OPEN at upgrade time lost its predecessor's duration before this migration existed; inventing one would be a fabricated cadence")
	d, found, err = s.SweepLastPassDuration(ctx, openEngine)
	require.NoError(t, err)
	require.False(t, found)
	require.Zero(t, d)

	// (f) AND IT SELF-HEALS on the first completion under the new code: the guarded
	// close stamps the duration durably, and the NEXT open — the statement that used
	// to destroy it — leaves it standing.
	_, err = s.pool.Exec(ctx,
		`UPDATE sweep_generations SET opened_at = now() - interval '20 minutes' WHERE engine = $1`, openEngine)
	require.NoError(t, err)
	_, stamped, err := s.CompleteSweepGeneration(ctx, openEngine, 3)
	require.NoError(t, err)
	require.True(t, stamped)
	closedDur, found, err := s.SweepLastPassDuration(ctx, openEngine)
	require.NoError(t, err)
	require.True(t, found)
	require.InDelta(t, (20 * time.Minute).Seconds(), closedDur.Seconds(), 5)

	_, err = s.OpenSweepGeneration(ctx, openEngine)
	require.NoError(t, err)
	afterOpen, found, err := s.SweepLastPassDuration(ctx, openEngine)
	require.NoError(t, err)
	require.True(t, found, "the open that clears completed_at must not clear the duration")
	require.Equal(t, closedDur, afterOpen)
}
