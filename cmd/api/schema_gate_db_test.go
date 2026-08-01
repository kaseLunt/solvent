package main

// The schema gate — and the LIVE-DATABASE smoke that asserts the honest refusal.
//
// The live `solvent` database is behind this binary's expected migration version
// until the maintenance window applies the P3 migrations. The correct behaviour in
// that state is to REFUSE TO SERVE, loudly, naming both versions — a public
// surface running queries written against a schema the database does not have is
// how a wrong number gets a plausible shape. So the smoke asserts the refusal
// rather than skipping, and it is read-only either way.

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestSchemaGateRefusesAMismatchedDatabase drives the gate against the scratch
// database in both directions: at the expected version it passes, and one version
// off it refuses.
func TestSchemaGateRefusesAMismatchedDatabase(t *testing.T) {
	ctx := context.Background()
	dsn := apiTestDSN(t)
	require.NoError(t, store.Migrate(ctx, dsn))

	st, err := store.Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(st.Close)

	want, err := store.ExpectedSchemaVersion()
	require.NoError(t, err)
	require.Equal(t, int64(18), want,
		"this build's queries are written against migration 18 (P5: 00015 block_headers, 00016 observatory_points, 00017 read indexes, 00018 observatory sweep stamp); if the migration set moved, this expectation and the operator runbook both need updating deliberately")

	s := &server{store: st}
	require.NoError(t, s.requireSchema(ctx), "the migrated scratch database must satisfy the gate")
	require.Equal(t, want, s.schemaVersion)

	// EQUALITY, NOT "AT LEAST". A HIGHER applied version means the database may
	// have reshaped the tables these queries read, so it must be refused too.
	admin, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	_, err = admin.Exec(ctx,
		`INSERT INTO goose_db_version (version_id, is_applied, tstamp) VALUES ($1, true, now())`, want+1)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `DELETE FROM goose_db_version WHERE version_id = $1`, want+1)
	})

	err = s.requireSchema(ctx)
	require.Error(t, err, "a database ABOVE this build's expectation must be refused, not tolerated")
	require.Contains(t, err.Error(), "this binary expects")
	require.Contains(t, err.Error(), "migrate (or deploy the matching build)")
}

// TestLiveDatabaseSchemaGateRefusesUntilMigrated is the read-only live smoke.
//
// It runs ONLY when SOLVENT_DATABASE_URL is exported, opens the live database
// strictly read-only (one SELECT against goose_db_version), and asserts that the
// gate's verdict MATCHES the database's actual state — refusal when the versions
// differ, and a clean pass once the maintenance window has applied the
// migrations. It never writes and never migrates.
func TestLiveDatabaseSchemaGateRefusesUntilMigrated(t *testing.T) {
	dsn := os.Getenv("SOLVENT_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("SOLVENT_ACCEPTANCE") == "1" {
			t.Fatal("acceptance mode (SOLVENT_ACCEPTANCE=1): SOLVENT_DATABASE_URL is REQUIRED for the read-only live smoke")
		}
		t.Skip("SOLVENT_DATABASE_URL not set; the read-only live smoke needs it (dev-mode skip)")
	}
	ctx := context.Background()

	st, err := store.Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(st.Close)

	want, err := store.ExpectedSchemaVersion()
	require.NoError(t, err)
	got, err := store.SchemaVersion(ctx, st.Querier())
	require.NoError(t, err)

	s := &server{store: st}
	err = s.requireSchema(ctx)
	if got == want {
		require.NoError(t, err,
			"the live database is at version %d and this build expects %d, so the gate must pass", got, want)
		t.Logf("live database is at schema version %d: the gate passes and api would serve", got)
		return
	}
	require.Error(t, err,
		"the live database is at version %d while this build expects %d — a public surface must REFUSE rather than serve numbers through queries the schema does not support",
		got, want)
	require.Contains(t, err.Error(), "database schema version")
	t.Logf("live database is at schema version %d, this build expects %d: the gate REFUSES, which is the honest state until the migrations are applied", got, want)
}
