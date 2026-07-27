// Round-16 M1/M2 BINDING regressions (M2 made platform-true by round-19
// H2): the DSN claim follows PGX'S OWN database-selection semantics
// (cross-checked against pgconn.ParseConfig — the very library that will
// dial), the claimed-vs-connected comparison is verdict-bearing AND wired
// into execute (round-19 L4 protects the wiring, not just the judge), and
// the platform trust-default judge matches pgx's per-platform behavior
// exactly: Windows taints whenever the DSN leaves trust material to the
// defaults (empty APPDATA included — the CWD-relative case), non-Windows
// ignores APPDATA entirely.
package main

import (
	"runtime"
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

// TestAppdataTrustMaterialTaint is the round-16 M2 BINDING regression, made
// PLATFORM-TRUE by round-19 H2: on a WINDOWS pgx build, a DSN that leaves
// any TLS trust-material input to the platform defaults taints — WHATEVER
// APPDATA holds, EMPTY INCLUDED (defaults_windows.go:30-44 join the path
// unguarded, so an empty APPDATA makes the default trust paths CWD-relative
// and a planted postgresql\root.crt in the working directory satisfies
// them) — and only the two provably-pinned postures (sslmode=disable in the
// connection string, or all three of sslrootcert+sslcert+sslkey pinned)
// stay clean. The legs drive appdataTrustTaintFor with goos pinned to
// "windows" so the Windows direction is asserted on every development
// platform (the GOOS-parameterized seam is round-19 H2's test obligation;
// production binds runtime.GOOS — TestAppdataTaintBindsRuntimePlatform).
func TestAppdataTrustMaterialTaint(t *testing.T) {
	const appdataSet = `C:\Users\example\AppData\Roaming`

	// The round-16 scenario: verify-full with no explicit sslrootcert — pgx
	// would inherit %APPDATA%\postgresql\root.crt as the trust root
	// (defaults_windows.go:41-44 → config.go:685-699).
	msg := appdataTrustTaintFor("windows", appdataSet, "postgres://solvent@db/solvent?sslmode=verify-full")
	require.NotEmpty(t, msg, "verify-full without pinned trust material on Windows must taint (round-16 M2)")
	require.Contains(t, msg, "APPDATA")
	result, code := computeResult(0, 0, []string{msg})
	require.NotEqual(t, "pass", result)
	require.NotEqual(t, exitPass, code)

	// THE ROUND-19 H2 LEG: an EMPTY APPDATA does not neutralize on Windows.
	// pgx still computes filepath.Join("", "postgresql", "root.crt") — the
	// RELATIVE path postgresql\root.crt, resolved against the process
	// working directory by the os.Stat probes (defaults_windows.go:34-35,
	// :42) — so unpinned trust material stays unverified with APPDATA empty.
	// Wave 19 returned clean here; that was the round-19 finding.
	msg = appdataTrustTaintFor("windows", "", "postgres://solvent@db/solvent?sslmode=verify-full")
	require.NotEmpty(t, msg, "EMPTY APPDATA + unpinned trust material on Windows must still taint (round-19 H2: the relative-path case)")
	require.Contains(t, msg, "CWD-relative", "the taint must name the relative-path mechanism — clearing APPDATA is not a remedy and the message must not suggest it is")
	result, _ = computeResult(0, 0, []string{msg})
	require.NotEqual(t, "pass", result)

	// Every remaining posture must judge IDENTICALLY under a set and an
	// empty APPDATA: the value decides where the default paths point
	// (absolute vs CWD-relative), never whether they exist.
	for _, appdata := range []string{appdataSet, ""} {
		// Partial pinning fails closed: the root CA alone leaves the CLIENT
		// pair to the platform defaults (presented under every TLS mode,
		// config.go:702-755 — a subject input via cert-based auth).
		require.NotEmpty(t, appdataTrustTaintFor("windows", appdata, "postgres://solvent@db/solvent?sslmode=verify-full&sslrootcert=/pinned/root.crt"),
			"pinning only the root CA is not pinning the trust material (appdata=%q)", appdata)

		// sslmode=require is NOT safe either: a root-cert setting silently
		// upgrades it to verify-ca semantics (config.go:638-643), so a
		// default-supplied root.crt changes even a non-verify mode.
		require.NotEmpty(t, appdataTrustTaintFor("windows", appdata, "postgres://solvent@db/solvent?sslmode=require"), "appdata=%q", appdata)

		// Provably pinned posture 1: TLS never negotiated — configTLS
		// returns nil immediately (config.go:629-631).
		require.Empty(t, appdataTrustTaintFor("windows", appdata, "postgres://solvent@db/solvent?sslmode=disable"),
			"a connection-string-pinned sslmode=disable makes the platform defaults irrelevant (appdata=%q)", appdata)

		// Provably pinned posture 2: every trust-material input the Windows
		// defaults could supply is pinned by the connection string
		// (mergeSettings config.go:245 — connString beats defaults).
		require.Empty(t, appdataTrustTaintFor("windows", appdata, "postgres://solvent@db/solvent?sslmode=verify-full&sslrootcert=/r.crt&sslcert=/c.crt&sslkey=/c.key"), "appdata=%q", appdata)

		// An unparseable / non-URL-form DSN proves nothing: fail closed
		// (readOnlyDSN refuses it independently, exit 2).
		require.NotEmpty(t, appdataTrustTaintFor("windows", appdata, "host=db dbname=x sslmode=disable"), "appdata=%q", appdata)
	}
}

// TestAppdataJudgeIgnoresNonWindowsPlatforms is round-19 H2's OTHER
// direction: non-Windows builds of pgx never read APPDATA — the platform
// defaults file compiled everywhere else (pgconn/defaults.go, //go:build
// !windows) contains no os.Getenv at all, its trust-material defaults
// deriving from user.Current().HomeDir (defaults.go:21-38) — so an
// unrelated nonempty APPDATA value proves nothing about the connection and
// must NOT taint. Wave 19's judge false-tainted exactly here (any nonempty
// APPDATA + unpinned DSN tainted regardless of platform).
func TestAppdataJudgeIgnoresNonWindowsPlatforms(t *testing.T) {
	for _, goos := range []string{"linux", "darwin", "freebsd"} {
		require.Empty(t, appdataTrustTaintFor(goos, `C:\anything`, "postgres://solvent@db/solvent?sslmode=verify-full"),
			"nonempty APPDATA on %s must NOT taint: pgx's non-Windows defaults never read it (round-19 H2, the false-taint direction)", goos)
		require.Empty(t, appdataTrustTaintFor(goos, "", "postgres://solvent@db/solvent?sslmode=verify-full"), goos)
		// Even a non-URL-form DSN: the APPDATA judge has nothing to say off
		// Windows (readOnlyDSN refuses such DSNs independently, exit 2).
		require.Empty(t, appdataTrustTaintFor(goos, "planted", "host=db dbname=x"), goos)
	}
}

// TestAppdataTaintBindsRuntimePlatform pins the production wrapper to the
// seam: appdataTrustTaint judges with runtime.GOOS and the ambient APPDATA.
// runtime.GOOS is the right platform input because the judge and the pgx
// build it judges are linked into the SAME binary — the GOOS that selected
// pgconn's defaults file is by construction the GOOS this process reports.
// The expectation is computed through the same seam, so this test is
// platform-independent; what it proves is the BINDING (which inputs the
// wrapper feeds the seam), while the two directional tests above prove the
// seam's judgment on each platform.
func TestAppdataTaintBindsRuntimePlatform(t *testing.T) {
	clearPgxEnv(t)
	for _, tc := range []struct{ appdata, dsn string }{
		{`C:\Users\example\AppData\Roaming`, "postgres://solvent@db/solvent?sslmode=verify-full"},
		{"", "postgres://solvent@db/solvent?sslmode=verify-full"},
		{`C:\Users\example\AppData\Roaming`, "postgres://solvent@db/solvent?sslmode=disable"},
	} {
		t.Setenv("APPDATA", tc.appdata)
		require.Equal(t, appdataTrustTaintFor(runtime.GOOS, tc.appdata, tc.dsn), appdataTrustTaint(tc.dsn),
			"the wrapper must bind runtime.GOOS and the ambient APPDATA (appdata=%q dsn=%q)", tc.appdata, tc.dsn)
	}
}

// TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns pins the vacuity
// argument that kept APPDATA presence-taint-free in wave 16, in its
// round-19 form: APPDATA is unconditionally set on Windows and its VALUE no
// longer decides anything (round-19 H2 — empty is as unverified as set), so
// what keeps the acceptance posture clean is TRUST PINNING alone: this
// repo's own DSNs pin sslmode=disable in the connection string. The taint
// is reserved for runs whose trust material the platform defaults could
// actually choose. (Wrapper-driven, so this leg also holds on the Linux
// race container, where the judge ignores APPDATA entirely.)
func TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns(t *testing.T) {
	clearPgxEnv(t)
	t.Setenv("APPDATA", `C:\Users\example\AppData\Roaming`)
	require.Empty(t, appdataTrustTaint("postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable"),
		"the house acceptance DSN shape must not taint on Windows")
	require.Empty(t, envAcceptanceTaints(),
		"and the value-only table sweep must not taint on APPDATA either (the judge is DSN-aware)")
}
