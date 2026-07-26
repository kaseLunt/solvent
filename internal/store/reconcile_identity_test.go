// Tests for the F4 physical-identity mechanism and the F1 shared
// destructive-test guard (Task 9 wave 11, round-10 findings 1 and 4).
//
// The properties under test, stated:
//   - identity is the (pg_control system_identifier, database OID, database
//     name) TUPLE — two DSN spellings of one database MUST collide
//     (alias-equivalence), two databases on one cluster MUST NOT
//     (distinct-DB), and an unresolvable identity is an ERROR, never a
//     shrugged-off pass (fail closed);
//   - the guard refuses same-database configurations and unresolvable
//     configurations with the runbook message, and an unset
//     TEST_DATABASE_URL is fatal in acceptance mode.
package store

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestDestructiveEnvDecision(t *testing.T) {
	require.Equal(t, guardProceed, destructiveEnvDecision(false, true))
	require.Equal(t, guardProceed, destructiveEnvDecision(true, true))
	require.Equal(t, guardSkip, destructiveEnvDecision(false, false),
		"dev mode keeps skip-when-unset ergonomics")
	require.Equal(t, guardFatal, destructiveEnvDecision(true, false),
		"acceptance mode: an unset TEST_DATABASE_URL is FATAL, never a skip — a skipped live-db suite cannot be suite-green evidence")
}

// TestDestructiveGuardRefusesSameDatabase is the F1 kill (mutation
// guard-bypassed): the shared split decision must refuse — fail closed, with
// the runbook message — when test and live resolve to the same physical
// database, and when the live identity cannot be resolved at all.
func TestDestructiveGuardRefusesSameDatabase(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := VerifyDestructiveSplit(ctx, dsn, dsn)
	require.Error(t, err, "same database on both sides is THE hazard — the guard must die before any helper could truncate")
	require.Contains(t, err.Error(), "physical split required", "the runbook message, verbatim")

	// Unresolvable live identity: empty and unreachable both fail CLOSED.
	err = VerifyDestructiveSplit(ctx, dsn, "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failing CLOSED")
	shortCtx, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	err = VerifyDestructiveSplit(shortCtx, dsn, "postgres://solvent:x@127.0.0.1:9/solvent?sslmode=disable&connect_timeout=2")
	require.Error(t, err, "an unreachable live DSN is unresolvable — fail closed, never 'probably fine'")
}

// TestVerifyDestructiveSplitFailsClosedWithoutADatabase covers the
// no-database-needed unresolvable arms (pure fail-closed shape).
func TestVerifyDestructiveSplitFailsClosedWithoutADatabase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, c := range [][2]string{
		{"", ""},
		{"", "postgres://x"},
		{"postgres://x", ""},
		{"not a dsn at all \x00", "also not one \x00"},
	} {
		err := VerifyDestructiveSplit(ctx, c[0], c[1])
		require.Error(t, err, "test=%q live=%q", c[0], c[1])
		require.Contains(t, err.Error(), SplitRunbookMsg)
	}
}

// aliasDSNs derives other SPELLINGS of the same database: loopback host
// respellings (IPv4 vs IPv6 vs name — the exact aliases the round-10 F4
// finding names) plus a query-parameter respelling that provably reaches the
// same route. Unreachable aliases are tolerated by the caller (a machine may
// listen on one stack only); at least one always resolves.
func aliasDSNs(t *testing.T, dsn string) []string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	var out []string
	host, port := u.Hostname(), u.Port()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		for _, h := range []string{"localhost", "127.0.0.1", "[::1]"} {
			if strings.Trim(h, "[]") == host {
				continue
			}
			alias := *u
			alias.Host = h + ":" + port
			out = append(out, alias.String())
		}
	}
	respelled := *u
	q := respelled.Query()
	q.Set("application_name", "solvent_identity_alias_check")
	respelled.RawQuery = q.Encode()
	out = append(out, respelled.String())
	return out
}

// TestDatabaseIdentityTupleAndAliasEquivalence is the F4 kill (mutation
// string-identity-revert): the identity is the pg_control tuple, so every
// alias spelling of one database resolves to the SAME identity, and the
// tuple's fields provably come from pg_control_system() and pg_database —
// not from the connection's transport (inet_server_addr forks across
// IPv4/IPv6/socket aliases, which is exactly how the old identity failed
// open).
func TestDatabaseIdentityTupleAndAliasEquivalence(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	base, err := ResolveDSNIdentity(ctx, dsn)
	require.NoError(t, err)

	// The tuple's provenance, cross-checked against the catalog directly:
	// a transport-derived identity cannot match these.
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	defer conn.Close(ctx)
	var sid, name string
	var oid uint32
	require.NoError(t, conn.QueryRow(ctx,
		`SELECT system_identifier::text FROM pg_control_system()`).Scan(&sid))
	require.NoError(t, conn.QueryRow(ctx,
		`SELECT oid, datname FROM pg_database WHERE datname = current_database()`).Scan(&oid, &name))
	require.Equal(t, sid, base.SystemIdentifier, "identity carries the CLUSTER id from pg_control, not a transport address")
	require.Equal(t, oid, base.DatabaseOID)
	require.Equal(t, name, base.DatabaseName)

	resolved := 0
	for _, alias := range aliasDSNs(t, dsn) {
		id, err := ResolveDSNIdentity(ctx, alias)
		if err != nil {
			t.Logf("alias unreachable on this machine (tolerated): %v", err)
			continue
		}
		resolved++
		require.True(t, SameDatabase(base, id),
			"alias-equivalence: two DSN spellings of one database MUST collide — got %s vs %s", base, id)
	}
	require.GreaterOrEqual(t, resolved, 1, "at least one alias spelling must resolve")
	t.Logf("alias equivalence held across %d alias spelling(s)", resolved)
}

// TestDatabaseIdentityDistinguishesDatabasesOnOneCluster: same cluster,
// different database ⇒ different identity (the distinct-DB pass), with the
// cluster half of the tuple EQUAL — proving the tuple separates cluster
// identity from database identity instead of conflating either.
func TestDatabaseIdentityDistinguishesDatabasesOnOneCluster(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	base, err := ResolveDSNIdentity(ctx, dsn)
	require.NoError(t, err)

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/postgres" // the maintenance database always exists
	other, err := ResolveDSNIdentity(ctx, u.String())
	require.NoError(t, err)

	require.False(t, SameDatabase(base, other), "different databases on one cluster must NOT collide")
	require.Equal(t, base.SystemIdentifier, other.SystemIdentifier, "same cluster — the system_identifier half agrees")
	require.NotEqual(t, base.DatabaseOID, other.DatabaseOID)
	require.NotEqual(t, base.DatabaseName, other.DatabaseName)

	// And the split guard accepts exactly this shape: same cluster,
	// physically distinct databases.
	require.NoError(t, VerifyDestructiveSplit(ctx, dsn, u.String()))
}

// TestDatabaseIdentityFailsClosedOnDeadConnection: an identity that cannot
// be read is an error — the caller's fail-closed contract starts here.
func TestDatabaseIdentityFailsClosedOnDeadConnection(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	require.NoError(t, conn.Close(ctx))
	_, err = DatabaseIdentity(ctx, conn)
	require.Error(t, err)
	require.Contains(t, err.Error(), "failing CLOSED")
}
