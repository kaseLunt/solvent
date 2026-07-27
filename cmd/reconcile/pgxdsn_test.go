// Round-16 M1/M2 BINDING regressions: the DSN claim follows PGX'S OWN
// database-selection semantics (cross-checked against pgconn.ParseConfig —
// the very library that will dial), the claimed-vs-connected comparison is
// verdict-bearing, and APPDATA taints exactly when it can select TLS trust
// material for the connection.
package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// TestDSNEffectiveClaimMatchesPgxParseConfig is the replication proof: for
// every DSN shape the guard ACCEPTS, the claim pgxdsn.go computes equals
// what pgx's own ParseConfig computes (with the ambient PG* surface
// neutralized, so ParseConfig's env layer contributes nothing — for a
// non-empty connection-string value the merge order at pgconn/config.go:245
// makes the two identical by construction; this test pins that the
// replication actually implements that construction). The two legs after
// the table are WHY production code replicates instead of calling
// ParseConfig directly: ParseConfig merges the ENVIRONMENT under the
// string, so its output cannot distinguish "the connection string pins the
// subject" from "the environment happened to fill it in".
func TestDSNEffectiveClaimMatchesPgxParseConfig(t *testing.T) {
	clearPgxEnv(t)
	for _, tc := range []struct {
		dsn      string
		database string
		host     string // "" = skip the host comparison (multi-host: pgx splits into Host+Fallbacks)
	}{
		{"postgres://solvent@db/claimed?sslmode=disable", "claimed", "db"},
		{"postgres://solvent:pw@localhost:5432/solvent_x?sslmode=disable", "solvent_x", "localhost"},
		// The dbname query parameter OVERRIDES the path — the round-16
		// finding's mechanism (pgconn/config.go:487-496).
		{"postgres://solvent@db/claimed?dbname=other&sslmode=disable", "other", "db"},
		// Repeated parameter: pgx takes the FIRST value (config.go:496,
		// settings[k] = v[0]).
		{"postgres://solvent@db/claimed?dbname=other&dbname=third&sslmode=disable", "other", "db"},
		// The host query parameter overrides the URL host the same way.
		{"postgres://solvent@db:5432/x?host=elsewhere&sslmode=disable", "x", "elsewhere"},
		// IPv6 literal: brackets trimmed (config.go:462, isIPOnly :502-504).
		{"postgresql://solvent@[::1]:5432/x?sslmode=disable", "x", "::1"},
		// Multi-host: our claim joins them exactly like parseURLSettings
		// (config.go:471-473); ParseConfig then splits Host/Fallbacks, so
		// only the database is compared 1:1.
		{"postgres://solvent@h1:5432,h2:5433/x?sslmode=disable", "x", ""},
	} {
		host, database, err := effectiveDSNClaim(tc.dsn)
		require.NoError(t, err, tc.dsn)
		require.Equal(t, tc.database, database, "claimed database for %s", tc.dsn)
		cfg, err := pgconn.ParseConfig(tc.dsn)
		require.NoError(t, err, tc.dsn)
		require.Equal(t, cfg.Database, database,
			"the replication must equal pgx's OWN ParseConfig for %s — the claim is what the library computes (round-16 M1)", tc.dsn)
		if tc.host != "" {
			require.Equal(t, tc.host, host, "claimed host for %s", tc.dsn)
			require.Equal(t, cfg.Host, host, "pgx's effective host for %s", tc.dsn)
		}
	}

	// LEG 1 — the reviewer's DSN, with a hostile ambient PGDATABASE: the
	// empty dbname override ERASES the path's claim and the environment
	// CANNOT put it back (an empty connection-string value still overwrites
	// the env layer — mergeSettings config.go:393-403 copies later sets
	// unconditionally). pgx would therefore omit the database from the
	// startup message (pgconn.go:326-328) and the SERVER would pick its
	// default. The guard refuses the DSN outright.
	t.Setenv("PGDATABASE", "ambient")
	cfg, err := pgconn.ParseConfig("postgres://solvent@db/claimed?dbname=&sslmode=disable")
	require.NoError(t, err)
	require.Equal(t, "", cfg.Database,
		"pgx ground truth: the empty dbname override wins over BOTH the path and ambient PGDATABASE — no environment can restore the erased claim")
	_, err = readOnlyDSN("postgres://solvent@db/claimed?dbname=&sslmode=disable")
	require.Error(t, err, "the reviewer's DSN must be refused (round-16 M1)")

	// LEG 2 — why production replicates instead of calling ParseConfig: a
	// database-less DSN under the same ambient PGDATABASE gets a database
	// FROM THE ENVIRONMENT in ParseConfig's output. A guard built on
	// ParseConfig would accept the partial DSN whenever the environment is
	// dirty — a rejection that depends on the environment being clean is
	// not a rejection.
	cfg, err = pgconn.ParseConfig("postgres://solvent@db?sslmode=disable")
	require.NoError(t, err)
	require.Equal(t, "ambient", cfg.Database, "pgx ground truth: env fills the gap the connection string left")
	_, err = readOnlyDSN("postgres://solvent@db?sslmode=disable")
	require.Error(t, err, "the guard must reject the partial DSN regardless of what the environment would fill in (round-14 F1)")
}

// TestClaimedDBFollowsPgxOverride pins db_name_claimed to the EFFECTIVE
// database: wave 16's path-only reading reported "claimed" for a DSN whose
// dbname override made pgx connect to "other" — the claim is what the
// library computes.
func TestClaimedDBFollowsPgxOverride(t *testing.T) {
	require.Equal(t, "claimed", dbNameClaimed("postgres://solvent@db/claimed?sslmode=disable"))
	require.Equal(t, "other", dbNameClaimed("postgres://solvent@db/claimed?dbname=other&sslmode=disable"),
		"the dbname query override IS the claim (round-16 M1)")
	require.Equal(t, "(unparseable)", dbNameClaimed("host=db dbname=x"),
		"keyword/value DSNs are outside URL-form semantics — never a URL-shaped guess")
}

// TestKeywordAndForeignSchemeDSNsRefused: pgx dispatches URL parsing ONLY
// for postgres:// and postgresql:// prefixes (pgconn/config.go:232-238);
// anything else is keyword/value DSN territory whose semantics this guard
// deliberately refuses to imitate — accepting a claim under semantics the
// library would not apply would be a second copy of the round-16 bug.
func TestKeywordAndForeignSchemeDSNsRefused(t *testing.T) {
	for _, dsn := range []string{
		"host=db dbname=x sslmode=disable",
		"dbname=x",
		"mysql://db/x",
		"pg://db/x",
	} {
		_, err := readOnlyDSN(dsn)
		require.Error(t, err, "non-URL-form DSN %q must be refused", dsn)
	}
}

// TestClaimVsConnectedMismatchTaints makes the round-16 M1 verdict-bearing
// property binding: a disagreement between the DSN-effective claim and the
// server-reported identity taints in BOTH directions, through the same
// computeResult path as every other taint. (The mismatch is unreachable
// through an honest DSN — pgx connects where the effective claim points —
// so the regression drives the exact judge execute wires, with the
// connected identity injected.)
func TestClaimVsConnectedMismatchTaints(t *testing.T) {
	agree := snapshotdb.ConnectedIdentity{Database: "solvent"}
	require.Empty(t, claimVsConnectedTaint("solvent", agree), "agreement is clean")

	// Direction 1: the receipt names a database the run did not audit.
	msg := claimVsConnectedTaint("claimed", snapshotdb.ConnectedIdentity{Database: "other"})
	require.NotEmpty(t, msg, "claimed != connected must be VERDICT-BEARING (round-16 M1)")
	require.Contains(t, msg, `"claimed"`)
	require.Contains(t, msg, `"other"`)
	result, code := computeResult(0, 0, []string{msg})
	require.NotEqual(t, "pass", result, "a mismatch the verdict ignores is a mismatch an attacker can afford")
	require.NotEqual(t, exitPass, code)

	// Direction 2: the run audited a database the receipt does not name.
	msg = claimVsConnectedTaint("other", snapshotdb.ConnectedIdentity{Database: "claimed"})
	require.NotEmpty(t, msg, "the taint fires in BOTH directions")
	result, _ = computeResult(0, 0, []string{msg})
	require.NotEqual(t, "pass", result)

	// Exactness: database names are identifiers; near-misses are misses.
	require.NotEmpty(t, claimVsConnectedTaint("Solvent", agree), "comparison is exact — the server reports the one true spelling")
}

// TestAppdataTrustMaterialTaint is the round-16 M2 BINDING regression:
// APPDATA present + a DSN that leaves any TLS trust-material input to the
// platform defaults → taint (fail CLOSED); the two provably-pinned postures
// (sslmode=disable in the connection string, or all three of
// sslrootcert+sslcert+sslkey pinned) stay clean, as does a cleared APPDATA.
func TestAppdataTrustMaterialTaint(t *testing.T) {
	clearPgxEnv(t)
	t.Setenv("APPDATA", `C:\Users\example\AppData\Roaming`)

	// The reviewer's scenario: verify-full with no explicit sslrootcert —
	// pgx would inherit %APPDATA%\postgresql\root.crt as the trust root
	// (defaults_windows.go:41-44 → config.go:685-699).
	msg := appdataTrustTaint("postgres://solvent@db/solvent?sslmode=verify-full")
	require.NotEmpty(t, msg, "verify-full without pinned trust material + APPDATA present must taint (round-16 M2)")
	require.Contains(t, msg, "APPDATA")
	result, code := computeResult(0, 0, []string{msg})
	require.NotEqual(t, "pass", result)
	require.NotEqual(t, exitPass, code)

	// Partial pinning fails closed: the root CA alone leaves the CLIENT
	// pair to the APPDATA defaults (presented under every TLS mode,
	// config.go:702-754 — a subject input via cert-based auth).
	require.NotEmpty(t, appdataTrustTaint("postgres://solvent@db/solvent?sslmode=verify-full&sslrootcert=/pinned/root.crt"),
		"pinning only the root CA is not pinning the trust material")

	// sslmode=require is NOT safe either: a root-cert setting silently
	// upgrades it to verify-ca semantics (config.go:638-643), so an
	// APPDATA-planted root.crt changes even a non-verify mode's behavior.
	require.NotEmpty(t, appdataTrustTaint("postgres://solvent@db/solvent?sslmode=require"))

	// Provably pinned posture 1: TLS never negotiated — configTLS returns
	// nil immediately (config.go:629-631), trust material is irrelevant.
	require.Empty(t, appdataTrustTaint("postgres://solvent@db/solvent?sslmode=disable"),
		"a connection-string-pinned sslmode=disable makes APPDATA unreachable")

	// Provably pinned posture 2: every trust-material input pgx's Windows
	// defaults could supply is pinned by the connection string
	// (mergeSettings config.go:245 — connString beats defaults).
	require.Empty(t, appdataTrustTaint("postgres://solvent@db/solvent?sslmode=verify-full&sslrootcert=/r.crt&sslcert=/c.crt&sslkey=/c.key"))

	// An unparseable / non-URL-form DSN proves nothing: fail closed
	// (readOnlyDSN refuses it independently, exit 2).
	require.NotEmpty(t, appdataTrustTaint("host=db dbname=x sslmode=disable"))

	// Cleared APPDATA is absent under pgx's own emptiness convention: no
	// trust material can be derived from it, no taint — the neutralization
	// channel, exactly like the PG* rows.
	t.Setenv("APPDATA", "")
	require.Empty(t, appdataTrustTaint("postgres://solvent@db/solvent?sslmode=verify-full"))
}

// TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns pins the vacuity
// argument that kept APPDATA presence-taint-free in wave 16, now in its
// corrected form: APPDATA is unconditionally set on Windows, so the
// acceptance posture (this repo's own DSNs pin sslmode=disable in the
// connection string) must stay clean — the taint is reserved for runs whose
// trust material the environment could actually choose.
func TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns(t *testing.T) {
	clearPgxEnv(t)
	t.Setenv("APPDATA", `C:\Users\example\AppData\Roaming`)
	require.Empty(t, appdataTrustTaint("postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable"),
		"the house acceptance DSN shape must not taint on Windows")
	require.Empty(t, envAcceptanceTaints(),
		"and the value-only table sweep must not taint on APPDATA either (the judge is DSN-aware)")
}
