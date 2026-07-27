// Round-14 F1 BINDING regressions: ambient PG* variables cannot silently
// redirect acceptance.
//
// The finding (verbatim shape): pgx v5.5.1 merges PGHOST / PGDATABASE / etc.
// UNDER a partial DSN (pgconn/config.go:245 mergeSettings — connString wins,
// env fills the gaps), so `postgres:///solvent` + ambient PGHOST connected
// to a DIFFERENT server while the artifact recorded db_name=solvent. Three
// mechanisms close it, each pinned here:
//
//  1. REJECTION: readOnlyDSN refuses any DSN without an explicit host AND
//     database (exit-2 precondition in execute) — the partial-DSN merge path
//     never reaches a connection.
//  2. TAINT: every pgx-read PG* variable presence-taints through the closed
//     env table (the pipeline legs live in TestEnvSurfaceClosed; the
//     finding's own variables are re-driven here) — mutation W16M1 (PG*
//     sweep removed) must die on these assertions.
//  3. RECORDED TRUTH: the artifact's db identity is what the SERVER said
//     over the snapshot's own connection (snapshotdb.Data.Identity →
//     run.db_name / run.db_identity), never the DSN's parsed intent — so
//     even a run that somehow connected elsewhere RECORDS elsewhere. The DB
//     legs below first REPRODUCE the redirect against a second scratch
//     database (proving the finding's mechanism is real in this exact pgx
//     version), then show the recorded identity following the server, and a
//     COMPLETE DSN shrugging the ambient variable off.
package main

import (
	"bytes"
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
)

// TestPartialDSNIsRejected: host and database must be explicit — anything
// less delegates the claim's subject to the environment and is refused
// before any connection exists.
func TestPartialDSNIsRejected(t *testing.T) {
	for _, dsn := range []string{
		"postgres:///solvent?sslmode=disable",                   // no host: ambient PGHOST would choose the server
		"postgres://solvent:pw@localhost:5432/?sslmode=disable", // no database: ambient PGDATABASE would choose the subject
		"postgres://solvent:pw@localhost:5432?sslmode=disable",  // no path at all
		"postgres:///?sslmode=disable",                          // neither
		"postgres://:5432/solvent?sslmode=disable",              // empty host, port only
		// Round-16 M1: "pinned" is judged under PGX'S OWN precedence — the
		// dbname/host query parameters overwrite the path/host EVEN WITH AN
		// EMPTY VALUE (pgconn/config.go:482-497), erasing the claim while a
		// path-only guard still sees one.
		"postgres://solvent@db/claimed?dbname=",                 // the reviewer's exact DSN: path claim erased, server picks its default
		"postgres://solvent@db/claimed?dbname=&sslmode=disable", // same, with other parameters present
		"postgres://solvent@db/claimed?sslmode=disable&dbname=", // parameter order is irrelevant to a map
		"postgres://solvent@db/solvent_x?host=&sslmode=disable", // the HOST claim erased the same way
		"postgres://solvent@db/claimed?dbname=&dbname=real",     // repeated param: pgx takes v[0] (config.go:496) — the FIRST value is empty, the claim stays erased
	} {
		_, err := readOnlyDSN(dsn)
		require.Error(t, err, "partial/erased DSN %q must be refused (round-14 F1 / round-16 M1)", dsn)
		require.Contains(t, err.Error(), "PG*", "the refusal must say WHY: %q", dsn)
	}
	// Complete DSNs still pass and still gain the read-only session option.
	out, err := readOnlyDSN("postgres://solvent:pw@localhost:5432/solvent_x?sslmode=disable")
	require.NoError(t, err)
	require.Contains(t, out, "default_transaction_read_only")
	// A NON-EMPTY dbname override is a legitimate pin — of the OVERRIDE
	// value: the DSN is accepted and the claim follows pgx (round-16 M1;
	// see TestClaimedDBFollowsPgxOverride).
	out, err = readOnlyDSN("postgres://solvent:pw@localhost:5432/ignored?dbname=solvent_x&sslmode=disable")
	require.NoError(t, err)
	require.Contains(t, out, "default_transaction_read_only")
}

// TestAmbientPGHostTaintsAcceptance re-drives the finding's own variables
// through the REAL generator-to-verdict pipeline (the full per-variable
// sweep lives in TestEnvSurfaceClosed step 6).
func TestAmbientPGHostTaintsAcceptance(t *testing.T) {
	clearPgxEnv(t)
	var errBuf bytes.Buffer
	for _, name := range []string{"PGHOST", "PGDATABASE", "PGPORT", "PGUSER", "PGSERVICE"} {
		t.Setenv(name, "staging.example.internal")
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		taints := acceptanceTaints(o)
		require.NotEmpty(t, taints, "%s must taint (round-14 F1)", name)
		require.Contains(t, strings.Join(taints, "\n"), name)
		result, code := computeResult(0, 0, taints)
		require.NotEqual(t, "pass", result)
		require.NotEqual(t, exitPass, code)
		t.Setenv(name, "")
	}
}

// TestConnectedIdentityRecordsServerTruth is the DB-backed leg (guarded by
// the same destructive-split discipline as the gate lifecycle test; FATAL in
// acceptance, skip in dev).
func TestConnectedIdentityRecordsServerTruth(t *testing.T) {
	clearPgxEnv(t)
	ctx := context.Background()
	gateDSN := ensureGateDB(t, ctx, gateTestBaseDSN(t))
	u, err := url.Parse(gateDSN)
	require.NoError(t, err)
	gateDB := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, gateDB)

	cfg := &config.Config{Chains: map[string]config.Chain{}}
	collect := func(dsn string) (*snapshotdb.Data, error) {
		return snapshotdb.Collect(ctx, snapshotdb.Params{}, cfg, dsn, snapshotdb.GoldenSpec{}, false, false, nil)
	}

	// Independent server-truth reference, over a SEPARATE connection.
	control, err := pgx.Connect(ctx, gateDSN)
	require.NoError(t, err)
	defer control.Close(ctx)
	var refSysID string
	var refOID int64
	require.NoError(t, control.QueryRow(ctx,
		`SELECT (SELECT system_identifier::text FROM pg_control_system()),
		        (SELECT oid::bigint FROM pg_database WHERE datname = current_database())`).
		Scan(&refSysID, &refOID))

	// Leg 1 — THE FINDING IS REAL: a partial DSN (no database) + ambient
	// PGDATABASE really does choose the connection's subject in pgx v5.5.1.
	// Collect is called directly with the partial DSN — readOnlyDSN would
	// refuse it (TestPartialDSNIsRejected), which is mechanism 1; this leg
	// proves mechanism 3 catches what mechanism 1 exists to prevent: the
	// RECORDED identity follows the SERVER, not the URL's claim.
	partial := *u
	partial.Path = "/"
	t.Setenv("PGDATABASE", gateDB)
	snap, err := collect(partial.String())
	require.NoError(t, err, "pgx must resolve the missing database from ambient PGDATABASE — the redirect mechanism the finding names")
	require.Equal(t, gateDB, snap.Identity.Database,
		"the recorded identity is where the connection LANDED (chosen by the ambient variable) — a URL-parsed db_name would have claimed %q", "")
	require.Equal(t, refSysID, snap.Identity.SystemIdentifier, "physical cluster identity must match the independent reference")
	require.Equal(t, refOID, snap.Identity.DatabaseOID)
	require.NotEmpty(t, snap.Identity.ServerVersion)
	require.NotEmpty(t, snap.Identity.ServerAddr)

	// Leg 2 — a COMPLETE DSN is immune: ambient PGDATABASE points at the
	// LIVE database's name, but connection-string settings override env
	// settings (pgconn/config.go:245 mergeSettings order), so the connection
	// lands where the DSN says and the identity records exactly that.
	t.Setenv("PGDATABASE", "solvent")
	roDSN, err := readOnlyDSN(gateDSN)
	require.NoError(t, err)
	snap, err = collect(roDSN)
	require.NoError(t, err)
	require.Equal(t, gateDB, snap.Identity.Database,
		"an explicit database in the DSN must win over ambient PGDATABASE (pgx merge order) — and the recorded fact proves it")
	require.Equal(t, refSysID, snap.Identity.SystemIdentifier)
}
