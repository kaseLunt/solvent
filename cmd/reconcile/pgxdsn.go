// The DSN claim follows PGX'S OWN database-selection semantics (round-16 M1).
//
// Round 14 taught that the taint domain includes what the linked libraries
// READ (ambient PG*); round 16 taught that the claim's PARSER must be the
// linked library's own parser too. readOnlyDSN checked only the URL path, but
// pgx derives the database from the path and then lets the `dbname` QUERY
// PARAMETER overwrite it — even with an empty value:
//
//   - pgconn/config.go:438 `parseURLSettings` (reached from ParseConfig,
//     config.go:216→224, for postgres:// / postgresql:// strings,
//     config.go:232-236): the path is read at line 482
//     (`database := strings.TrimLeft(url.Path, "/")`) and applied only when
//     non-empty (lines 483-485); then EVERY query parameter is folded into
//     the settings map at lines 491-497 with `settings[k] = v[0]` (line 496)
//     — unconditionally, INCLUDING an empty value — after the nameMap at
//     lines 487-489 renames `dbname` → `database`. So `?dbname=` OVERWRITES
//     the path's database with the empty string, and `?host=` overwrites the
//     URL's host part the same way (the hosts block is lines 453-478).
//   - pgconn/config.go:245 `mergeSettings(defaultSettings, envSettings,
//     connStringSettings)`: connection-string settings — including that empty
//     override — win over env and defaults, so no ambient variable can put
//     the database back.
//   - pgconn/pgconn.go:326-328: an empty `config.Database` is simply OMITTED
//     from the startup message, so the SERVER falls back to its default
//     database (the role name). `postgres://solvent@db/claimed?dbname=`
//     therefore passes a path-only guard while pgx connects to a database
//     named by nobody in the receipt.
//
// This file replicates exactly the connection-string half of that precedence
// — path, then query-parameter override including the empty-value case — and
// nothing else: env and defaults are deliberately EXCLUDED, because the guard
// must reject a DSN whose connection string does not pin the subject even
// when an ambient PGDATABASE would happen to fill it in (that ambient
// variable already presence-taints, and a rejection that depends on the
// environment being clean is not a rejection). Where the connection string
// DOES pin a non-empty database, pgx's merge order makes this value exactly
// what ParseConfig computes — TestDSNEffectiveClaimMatchesPgxParseConfig
// cross-checks the replication against pgx's own ParseConfig for every
// accepted shape.
package main

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// pgxConnStringSettings replicates pgconn's parseURLSettings
// (pgconn/config.go:438-500, v5.5.1) for URL-form DSNs: the settings map pgx
// derives from the CONNECTION STRING ALONE, before env and defaults are
// merged underneath it (config.go:245). Keyword/value DSNs are refused by
// readOnlyDSN before this is consulted, mirroring its wave-16 posture.
func pgxConnStringSettings(dsn string) (map[string]string, error) {
	// pgx dispatches URL parsing ONLY for these two prefixes
	// (pgconn/config.go:232-236); every other string is parsed under
	// KEYWORD/VALUE semantics (parseDSNSettings, config.go:238). Replicating
	// URL semantics for a string pgx would parse differently would make the
	// claim diverge from what the library computes, so anything non-URL-form
	// is refused here (readOnlyDSN turns that into the precondition abort).
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return nil, fmt.Errorf("not a postgres:// or postgresql:// URL — pgx parses anything else under keyword/value DSN semantics (pgconn/config.go:232-238), which this guard refuses outright")
	}
	settings := map[string]string{}
	u, err := url.Parse(dsn)
	if err != nil {
		return nil, err
	}

	// Hosts: pgconn/config.go:453-478 — split on ",", IP literals trimmed of
	// brackets, host:port split otherwise; empty parts skipped.
	var hosts []string
	for _, host := range strings.Split(u.Host, ",") {
		if host == "" {
			continue
		}
		if isIPOnlyHost(host) {
			hosts = append(hosts, strings.Trim(host, "[]"))
			continue
		}
		h, _, err := net.SplitHostPort(host)
		if err != nil {
			return nil, fmt.Errorf("failed to split host:port in '%s', err: %w", host, err)
		}
		if h != "" {
			hosts = append(hosts, h)
		}
	}
	if len(hosts) > 0 {
		settings["host"] = strings.Join(hosts, ",")
	}

	// Database from the path: pgconn/config.go:482-485 (empty NOT set).
	if database := strings.TrimLeft(u.Path, "/"); database != "" {
		settings["database"] = database
	}

	// Query parameters: pgconn/config.go:487-497 — dbname renamed to
	// database, then EVERY parameter overwrites unconditionally with its
	// FIRST value (`settings[k] = v[0]`, line 496), empty values included.
	// That unconditional overwrite is the whole finding: an empty dbname (or
	// host) query value ERASES the path's claim.
	for k, v := range u.Query() {
		if k == "dbname" {
			k = "database"
		}
		settings[k] = v[0]
	}
	return settings, nil
}

// isIPOnlyHost mirrors pgconn's isIPOnly (pgconn/config.go:502-504).
func isIPOnlyHost(host string) bool {
	return net.ParseIP(strings.Trim(host, "[]")) != nil || !strings.Contains(host, ":")
}

// effectiveDSNClaim computes the EFFECTIVE host and database a URL-form DSN
// pins through its connection string, under pgx's own precedence (path, then
// query-parameter override, empty values overriding too). An empty return
// for either means the connection string does NOT pin it — pgx would fall
// through to env/defaults (config.go:245) or omit the database from the
// startup message entirely (pgconn.go:326-328) — and readOnlyDSN refuses the
// DSN. db_name_claimed records THIS database value: the claim is what the
// library computes, never what a path-only reading wishes it were.
func effectiveDSNClaim(dsn string) (host, database string, err error) {
	settings, err := pgxConnStringSettings(dsn)
	if err != nil {
		return "", "", err
	}
	return settings["host"], settings["database"], nil
}

// trustMaterialPinned reports whether a DSN's connection string makes pgx's
// APPDATA-derived TLS trust-material DEFAULTS unreachable (round-16 M2). The
// predicate, justified against pgx v5.5.1's own loading logic:
//
//   - sslmode=disable: configTLS returns a nil TLS config IMMEDIATELY
//     (pgconn/config.go:629-630), before any certificate path is consulted —
//     trust material is irrelevant, APPDATA cannot matter.
//   - otherwise the connection may negotiate TLS, and configTLS consumes
//     three settings that pgconn's Windows defaults derive from %APPDATA%
//     when the DSN does not pin them (defaults_windows.go:20 reads APPDATA;
//     :32-39 default sslcert/sslkey, :41-44 default sslrootcert, each applied
//     when the file exists): the root CA is loaded into RootCAs/ClientCAs at
//     config.go:685-699 (used by verify-ca's VerifyPeerCertificate closure,
//     :645-678, and verify-full's standard verification, :679-680), sslmode
//     "require" is silently UPGRADED to verify-ca semantics when a root-cert
//     setting is present (:638-643) — so an APPDATA-planted root.crt changes
//     even a non-verify mode's behavior — and the client cert/key pair is
//     loaded and PRESENTED under every TLS mode (:704-757). Only a
//     connection string that pins ALL THREE (mergeSettings :245 —
//     connection-string settings override the defaults) makes every one of
//     those paths APPDATA-independent.
//
// Fail-closed on the parse: an unparseable DSN proves nothing and returns
// false (readOnlyDSN refuses it independently).
func trustMaterialPinned(dsn string) bool {
	settings, err := pgxConnStringSettings(dsn)
	if err != nil {
		return false
	}
	if settings["sslmode"] == "disable" {
		return true
	}
	return settings["sslrootcert"] != "" && settings["sslcert"] != "" && settings["sslkey"] != ""
}
